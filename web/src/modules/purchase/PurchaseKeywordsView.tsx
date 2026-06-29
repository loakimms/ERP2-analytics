import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AdsDateControls, loadAdsDateState, saveAdsDateState, type AdsDateState } from '../ads/AdsDateControls';
import { fromYmd as parseYmd, normalizeRange, shiftRange, toYmd } from '../ads/dateRangeUtils';
import { readInitialPurchaseKeywordsNavigationQuery } from '../../shared/navigation/analyticsNavigation';
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
	fetchPurchaseKeywordsDaily,
	fetchPurchaseKeywordsDashboard,
	hasPurchaseKeywordsForDate,
	syncPurchaseKeywords,
	syncPurchaseKeywordsYesterday,
	uploadPurchaseKeywordsReport,
	type PurchaseKeywordRow,
	type PurchaseKeywordsDashboard,
} from './purchaseApi';

type FetchState = { loading: boolean; error: string | null };

function fmtInt(n: number): string {
	try {
		return new Intl.NumberFormat('ko-KR').format(Number(n) || 0);
	} catch {
		return String(n ?? 0);
	}
}

function fmtNum(n: number, maxFrac: number = 3): string {
	const x = Number(n);
	if (!Number.isFinite(x)) return '0';
	// 거의 정수면 정수로 표시
	if (Math.abs(x - Math.round(x)) < 1e-9) return fmtInt(Math.round(x));
	return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: maxFrac }).format(x);
}

function roundHalfUp(n: number): number {
	const x = Number(n);
	if (!Number.isFinite(x)) return 0;
	return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

function uniqSorted(arr: string[]): string[] {
	const s = new Set(arr.map((x) => String(x || '').trim()).filter(Boolean));
	return Array.from(s).sort((a, b) => a.localeCompare(b));
}

function fmtWon(n: number): string {
	// 금액(기여도)이 소수여도 화면은 원 단위로 보이도록 반올림 표시
	return `${fmtInt(roundHalfUp(n))}원`;
}

function inferYmdFromFilename(filename: string): string | null {
	const s = String(filename || '').trim();
	if (!s) return null;
	// YYYY-MM-DD / YYYY.MM.DD / YYYY_MM_DD
	let m = /(20\d{2})[.\-_](\d{1,2})[.\-_](\d{1,2})/.exec(s);
	if (m) {
		const y = m[1];
		const mm = String(m[2]).padStart(2, '0');
		const dd = String(m[3]).padStart(2, '0');
		return `${y}-${mm}-${dd}`;
	}
	// YYYYMMDD
	m = /(20\d{2})(\d{2})(\d{2})/.exec(s);
	if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	return null;
}

export function PurchaseKeywordsView(props: { apiBaseUrl: string }): JSX.Element {
	const [dateState, setDateState] = useState<AdsDateState>(() => loadAdsDateState());
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const initialNavigationQuery = useMemo(
		() => readInitialPurchaseKeywordsNavigationQuery(`?${searchParams.toString()}`),
		[searchParams],
	);
	const [fetchState, setFetchState] = useState<FetchState>({ loading: false, error: null });
	const [dashboard, setDashboard] = useState<PurchaseKeywordsDashboard | null>(null);
	const [rows, setRows] = useState<PurchaseKeywordRow[]>([]);
	const [prevRows, setPrevRows] = useState<PurchaseKeywordRow[]>([]);
	const [uploadedPeriod, setUploadedPeriod] = useState<{ from: string; to: string } | null>(null);
	const [syncState, setSyncState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
	const [lastSyncResult, setLastSyncResult] = useState<any | null>(null);
	const [syncModalOpen, setSyncModalOpen] = useState(false);

	// filters (사용자가 직접 "조회"를 눌러 반영)
	const [fCat1, setFCat1] = useState<string>('');
	const [fCat2, setFCat2] = useState<string>('');
	const [fCat3, setFCat3] = useState<string>(''); // 카테고리(소) 필터
	const [fCg, setFCg] = useState<string>('');
	const [fCn, setFCn] = useState<string>('');
	const [fKw, setFKw] = useState<string>(() => initialNavigationQuery.keyword);
	const [fProductName, setFProductName] = useState<string>(() => initialNavigationQuery.productName); // 프론트(표) 필터: 상품명 드롭다운(정확 일치)

	// A-1 / AI Ops 연동: URL 쿼리로 상품/키워드 필터 자동 적용
	const productParam = initialNavigationQuery.productName;
	const keywordParam = initialNavigationQuery.keyword;
	useEffect(() => {
		if (productParam) {
			// 상품명 컬럼은 핵심이므로 강제로 표시
			setHideProduct(false);
			setFProductName(productParam);
		}
		if (keywordParam) {
			setHideKeyword(false);
			setFKw(keywordParam);
		}
	}, [keywordParam, productParam]);

	type SortKey = 'category1' | 'category2' | 'category3' | 'product_name' | 'channel_group' | 'channel_name' | 'keyword' | 'payments' | 'amount';
	const [sortKey, setSortKey] = useState<SortKey>('amount');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

	// column visibility controls (요청사항: 헤더 위 버튼으로 숨기기)
	const [hideCategoryGroup, setHideCategoryGroup] = useState(false); // 카테고리(대/중/소)
	const [hideProduct, setHideProduct] = useState(false); // 상품명
	const [hideChannelGroup, setHideChannelGroup] = useState(false); // 채널그룹/채널명
	const [hideKeyword, setHideKeyword] = useState(false); // 키워드
	const [hideWarn, setHideWarn] = useState<string>('');

	const toggleHide = (target: 'category' | 'product' | 'channel' | 'keyword') => {
		const next = {
			hideCategoryGroup: target === 'category' ? !hideCategoryGroup : hideCategoryGroup,
			hideProduct: target === 'product' ? !hideProduct : hideProduct,
			hideChannelGroup: target === 'channel' ? !hideChannelGroup : hideChannelGroup,
			hideKeyword: target === 'keyword' ? !hideKeyword : hideKeyword,
		};
		// 요구사항: 최소 1개 항목(그룹)은 강제로 남기기
		if (next.hideCategoryGroup && next.hideProduct && next.hideChannelGroup && next.hideKeyword) {
			setHideWarn('최소 1개 항목은 남아야 합니다.');
			return;
		}
		setHideWarn('');
		setHideCategoryGroup(next.hideCategoryGroup);
		setHideProduct(next.hideProduct);
		setHideChannelGroup(next.hideChannelGroup);
		setHideKeyword(next.hideKeyword);
	};

	const range = useMemo(() => normalizeRange(dateState.range), [dateState.range]);
	const fromYmdStr = useMemo(() => toYmd(range.from), [range.from]);
	const toYmd2 = useMemo(() => toYmd(range.to), [range.to]);
	const prevRange = useMemo(() => shiftRange(range, 'prev_day'), [range]);
	const prevFromYmdStr = useMemo(() => toYmd(prevRange.from), [prevRange.from]);
	const prevToYmdStr = useMemo(() => toYmd(prevRange.to), [prevRange.to]);

	const appliedFilters = useMemo(() => {
		const f: any = {};
		if (fCat1) f.category1 = fCat1;
		if (fCat2) f.category2 = fCat2;
		if (fCat3) f.category3 = fCat3;
		if (fCg) f.channel_group = fCg;
		if (fCn) f.channel_name = fCn;
		if (fKw) f.keyword = fKw;
		return f as Record<string, any>;
	}, [fCat1, fCat2, fCat3, fCg, fCn, fKw]);

	const refresh = useCallback(async () => {
		setFetchState({ loading: true, error: null });
		try {
			const [dash, list, prevList] = await Promise.all([
				fetchPurchaseKeywordsDashboard({
					apiBaseUrl: props.apiBaseUrl,
					from: fromYmdStr,
					to: toYmd2,
					source: 'auto',
					filters: appliedFilters,
					limitProducts: 10,
					limitKeywords: 10,
				}),
				fetchPurchaseKeywordsDaily({
					apiBaseUrl: props.apiBaseUrl,
					from: fromYmdStr,
					to: toYmd2,
					source: 'auto',
					filters: appliedFilters,
					limit: 5000,
					offset: 0,
				}),
				fetchPurchaseKeywordsDaily({
					apiBaseUrl: props.apiBaseUrl,
					from: prevFromYmdStr,
					to: prevToYmdStr,
					source: 'auto',
					filters: appliedFilters,
					limit: 5000,
					offset: 0,
				}),
			]);
			setDashboard(dash);
			setRows(list);
			setPrevRows(prevList);
			setFetchState({ loading: false, error: null });
		} catch (e: any) {
			const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '데이터를 불러오지 못했습니다.');
			setFetchState({ loading: false, error: msg });
		}
	}, [props.apiBaseUrl, fromYmdStr, toYmd2, prevFromYmdStr, prevToYmdStr, appliedFilters]);

	// 기간/필터 변경 시 자동 갱신
	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fromYmdStr, toYmd2, appliedFilters]);

	// 업로드 일자 정책:
	// - 기본: 파일명에서 날짜를 추출하여 서버가 사용하도록 한다(일자 컬럼이 없을 때).
	// - 예외: 파일명에 날짜가 없으면, 사용자가 수동으로 업로드 기준일을 입력할 수 있다.
	const [manualTargetDate, setManualTargetDate] = useState<string>(''); // 기본값: 항상 빈값
	const [manualPickerOpen, setManualPickerOpen] = useState(false);
	const [lastPickedFileName, setLastPickedFileName] = useState<string>('');
	const [inferredDateFromFile, setInferredDateFromFile] = useState<string | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmText, setConfirmText] = useState<string>('');
	const [confirmKind, setConfirmKind] = useState<'mismatch' | 'overwrite' | null>(null);
	const pendingFileRef = useRef<File | null>(null);
	const pendingInferredRef = useRef<string | null>(null);

	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const [uploadState, setUploadState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });

	const onPickUploadFile = () => uploadInputRef.current?.click();

	const doUpload = useCallback(
		async (file: File, inferred: string | null) => {
			setUploadState({ busy: true, message: '업로드 중…' });
			try {
				const effectiveTargetDate = manualTargetDate ? manualTargetDate : inferred ? inferred : null;
				const res = await uploadPurchaseKeywordsReport({
					apiBaseUrl: props.apiBaseUrl,
					file,
					targetDate: effectiveTargetDate,
				});

				// 업로드된 날짜(서버 기준)를 조회기간에 자동 반영해서 "업로드했는데 0건" 혼란을 줄인다.
				const dates = (res.processed_dates?.length ? res.processed_dates : res.dates) || [];
				const ds = Array.from(new Set(dates.map((d) => String(d || '').trim()).filter(Boolean))).sort();
				if (ds.length > 0) {
					const firstDate = ds[0]!;
					const lastDate = ds[ds.length - 1]!;
					setUploadedPeriod({ from: firstDate, to: lastDate });
					const d0 = parseYmd(firstDate);
					const d1 = parseYmd(lastDate);
					if (d0 && d1) {
						const next: AdsDateState = { ...dateState, range: normalizeRange({ from: d0, to: d1 }) };
						setDateState(next);
						saveAdsDateState(next);
					}
				} else if (inferred) {
					setUploadedPeriod({ from: inferred, to: inferred });
					// fallback: 파일명에서 추출한 날짜라도 기간에 반영
					const d0 = parseYmd(inferred);
					if (d0) {
						const next: AdsDateState = { ...dateState, range: normalizeRange({ from: d0, to: d0 }) };
						setDateState(next);
						saveAdsDateState(next);
					}
				}

				setUploadState({
					busy: false,
					message: (() => {
						const base = `업로드 완료: ${res.dates?.join(', ') || '-'} (저장 ${fmtInt(res.inserted_total || 0)}건)`;
						const parsed = (res as any)?.parsed_totals;
						const stored = (res as any)?.stored_totals;

						const parsedOk = parsed && (Number(parsed.rows) || 0) > 0;
						const storedOk = stored && (Number(stored.rows) || 0) > 0;
						if (!parsedOk && !storedOk) return base;

						const pTxt = parsedOk
							? `파일합계 결제수 ${fmtNum(Number(parsed.payments) || 0, 3)} · 결제금액 ${fmtWon(Number(parsed.amount) || 0)}`
							: '';
						const pRaw =
							parsedOk && Number.isFinite(Number((parsed as any).payments_raw_sum))
								? ` (원본합 ${Number((parsed as any).payments_raw_sum).toFixed(2)} / 소수행 ${fmtInt(Number((parsed as any).payments_non_integer_rows) || 0)})`
								: '';
						const sTxt = storedOk
							? `저장합계 결제수 ${fmtNum(Number(stored.payments) || 0, 3)} · 결제금액 ${fmtWon(Number(stored.amount) || 0)}`
							: '';
						const mismatch =
							parsedOk && storedOk
								? (Number(parsed.payments) || 0) !== (Number(stored.payments) || 0) || (Number(parsed.amount) || 0) !== (Number(stored.amount) || 0)
								: false;
						const warn = mismatch ? ' · (주의: 파일합계와 저장합계가 다릅니다)' : '';
						return `${base} · ${[pTxt ? `${pTxt}${pRaw}` : '', sTxt].filter(Boolean).join(' | ')}${warn}`;
					})(),
				});
				await refresh();
			} catch (e: any) {
				const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '업로드 실패');
				setUploadState({ busy: false, message: `업로드 실패: ${msg}` });
			} finally {
				try {
					if (uploadInputRef.current) uploadInputRef.current.value = '';
				} catch {
					// ignore
				}
			}
		},
		[props.apiBaseUrl, manualTargetDate, dateState, refresh],
	);

	const onUploadFile = async (file: File | null) => {
		if (!file) return;
		const inferred = inferYmdFromFilename(file.name);
		setLastPickedFileName(file.name || '');
		setInferredDateFromFile(inferred);

		// 파일명 날짜 vs 입력 날짜 불일치 확인
		const manual = (manualTargetDate || '').trim();
		if (manual && inferred && manual !== inferred) {
			pendingFileRef.current = file;
			pendingInferredRef.current = inferred;
			setConfirmText(`입력날짜 확인. ${manual} 맞나요? (파일명 날짜: ${inferred})`);
			setConfirmKind('mismatch');
			setConfirmOpen(true);
			return;
		}

		// 이미 저장된 일자면 "갱신 여부"를 확인한다.
		// - 우선순위: 수동 입력 날짜 > 파일명 날짜(자동 추출)
		const effective = manual || inferred || '';
		if (effective) {
			try {
				const exists = await hasPurchaseKeywordsForDate({ apiBaseUrl: props.apiBaseUrl, ymd: effective, source: 'purchase_upload' });
				if (exists) {
					pendingFileRef.current = file;
					pendingInferredRef.current = inferred;
					setConfirmText(`저장된 일자입니다. 지금 데이터로 갱신할까요? (${effective})`);
					setConfirmKind('overwrite');
					setConfirmOpen(true);
					return;
				}
			} catch {
				// ignore - if check fails, proceed with upload (server will validate anyway)
			}
		}

		await doUpload(file, inferred);
	};

	const confirmYes = async () => {
		setConfirmOpen(false);
		const kind = confirmKind;
		setConfirmKind(null);
		const f = pendingFileRef.current;
		const inferred = pendingInferredRef.current ?? null;
		pendingFileRef.current = null;
		pendingInferredRef.current = null;
		if (!f) return;

		// mismatch 확인의 "예"를 눌렀다면, 그 다음 overwrite 확인도 필요할 수 있다.
		if (kind === 'mismatch') {
			const manual = (manualTargetDate || '').trim();
			const effective = manual || inferred || '';
			if (effective) {
				try {
					const exists = await hasPurchaseKeywordsForDate({ apiBaseUrl: props.apiBaseUrl, ymd: effective, source: 'purchase_upload' });
					if (exists) {
						pendingFileRef.current = f;
						pendingInferredRef.current = inferred;
						setConfirmText(`저장된 일자입니다. 지금 데이터로 갱신할까요? (${effective})`);
						setConfirmKind('overwrite');
						setConfirmOpen(true);
						return;
					}
				} catch {
					// ignore
				}
			}
		}

		await doUpload(f, inferred);
	};

	const confirmNo = () => {
		setConfirmOpen(false);
		setConfirmKind(null);
		pendingFileRef.current = null;
		pendingInferredRef.current = null;
		setUploadState({ busy: false, message: '업로드 취소됨' });
		try {
			if (uploadInputRef.current) uploadInputRef.current.value = '';
		} catch {
			// ignore
		}
	};

	const filterOptions = useMemo(() => {
		const cat1 = uniqSorted(rows.map((r) => r.category1 || '').filter(Boolean));
		const cat2 = uniqSorted(rows.map((r) => r.category2 || '').filter(Boolean));
		const cat3 = uniqSorted(rows.map((r) => r.category3 || '').filter(Boolean));
		const cgs = uniqSorted(rows.map((r) => r.channel_group || '').filter(Boolean));
		const cns = uniqSorted(rows.map((r) => r.channel_name || '').filter(Boolean));
		return { cat1, cat2, cat3, cgs, cns };
	}, [rows]);

	type AggRow = {
		category1: string | null;
		category2: string | null;
		category3: string | null;
		product_name: string | null;
		channel_group: string;
		channel_name: string;
		keyword: string;
		payments: number;
		amount: number;
	};

	const visibleDims = useMemo(() => {
		const dims: SortKey[] = [];
		if (!hideCategoryGroup) dims.push('category1', 'category2', 'category3');
		if (!hideProduct) dims.push('product_name');
		if (!hideChannelGroup) dims.push('channel_group', 'channel_name');
		if (!hideKeyword) dims.push('keyword');
		return dims;
	}, [hideCategoryGroup, hideProduct, hideChannelGroup, hideKeyword]);

	// 상세 테이블은 기간 내 합계로 보여준다.
	// - 숨긴 컬럼은 집계 키에서 제거되어 "자동 합산"된다.
	// - (요청사항3) 결제수/결제금액 외 1개 헤더만 남으면 그 헤더 기준으로 합산됨.
	const detailRows = useMemo(() => {
		const m = new Map<string, AggRow>();
		for (const r of rows) {
			const kParts = visibleDims.map((k) => {
				if (k === 'category1') return r.category1 || '';
				if (k === 'category2') return r.category2 || '';
				if (k === 'category3') return r.category3 || '';
				if (k === 'product_name') return r.product_name || '';
				if (k === 'channel_group') return r.channel_group || '';
				if (k === 'channel_name') return r.channel_name || '';
				if (k === 'keyword') return r.keyword || '';
				return '';
			});
			const key = kParts.join('||');
			const prev = m.get(key);
			if (!prev) {
				m.set(key, {
					category1: visibleDims.includes('category1') ? r.category1 : null,
					category2: visibleDims.includes('category2') ? r.category2 : null,
					category3: visibleDims.includes('category3') ? r.category3 : null,
					product_name: visibleDims.includes('product_name') ? r.product_name : null,
					channel_group: visibleDims.includes('channel_group') ? r.channel_group : '',
					channel_name: visibleDims.includes('channel_name') ? r.channel_name : '',
					keyword: visibleDims.includes('keyword') ? r.keyword : '',
					payments: Number(r.payments) || 0,
					amount: Number(r.amount) || 0,
				});
			} else {
				prev.payments += Number(r.payments) || 0;
				prev.amount += Number(r.amount) || 0;
			}
		}
		return Array.from(m.values());
	}, [rows, visibleDims]);

	const prevDetailRows = useMemo(() => {
		const m = new Map<string, AggRow>();
		for (const r of prevRows) {
			const kParts = visibleDims.map((k) => {
				if (k === 'category1') return r.category1 || '';
				if (k === 'category2') return r.category2 || '';
				if (k === 'category3') return r.category3 || '';
				if (k === 'product_name') return r.product_name || '';
				if (k === 'channel_group') return r.channel_group || '';
				if (k === 'channel_name') return r.channel_name || '';
				if (k === 'keyword') return r.keyword || '';
				return '';
			});
			const key = kParts.join('||');
			const prev = m.get(key);
			if (!prev) {
				m.set(key, {
					category1: visibleDims.includes('category1') ? r.category1 : null,
					category2: visibleDims.includes('category2') ? r.category2 : null,
					category3: visibleDims.includes('category3') ? r.category3 : null,
					product_name: visibleDims.includes('product_name') ? r.product_name : null,
					channel_group: visibleDims.includes('channel_group') ? r.channel_group : '',
					channel_name: visibleDims.includes('channel_name') ? r.channel_name : '',
					keyword: visibleDims.includes('keyword') ? r.keyword : '',
					payments: Number(r.payments) || 0,
					amount: Number(r.amount) || 0,
				});
			} else {
				prev.payments += Number(r.payments) || 0;
				prev.amount += Number(r.amount) || 0;
			}
		}
		return m;
	}, [prevRows, visibleDims]);

	const productNameOptions = useMemo(() => {
		const names = uniqSorted(detailRows.map((r) => String(r.product_name || '').trim()).filter(Boolean));
		const hasEmpty = detailRows.some((r) => !String(r.product_name || '').trim());
		return { names, hasEmpty };
	}, [detailRows]);

	const visibleDetailRows = useMemo(() => {
		const key = String(fProductName || '').trim();
		const filtered = hideProduct
			? detailRows
			: key === ''
				? detailRows
				: key === '__EMPTY__'
					? detailRows.filter((r) => !String(r.product_name || '').trim())
					: detailRows.filter((r) => String(r.product_name || '').trim() === key);

		const dir = sortDir === 'asc' ? 1 : -1;
		const getText = (v: any) => String(v ?? '').toLowerCase();
		const getNum = (v: any) => Number(v) || 0;
		return [...filtered].sort((a: any, b: any) => {
			if (sortKey === 'payments' || sortKey === 'amount') {
				return (getNum(a[sortKey]) - getNum(b[sortKey])) * dir;
			}
			return getText(a[sortKey]).localeCompare(getText(b[sortKey])) * dir;
		});
	}, [detailRows, fProductName, sortKey, sortDir, hideProduct]);

	const formatDelta = (curr: number, prev: number, unit: 'count' | 'won'): { text: string; cls: string } => {
		const c = Number(curr) || 0;
		const p = Number(prev) || 0;
		const d = c - p;
		const cls = d > 0 ? 'delta-up' : d < 0 ? 'delta-down' : 'delta-zero';
		const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '·';
		const abs = Math.abs(d);
		const base = unit === 'won' ? fmtInt(roundHalfUp(abs)) : fmtNum(abs, 3);
		const pct = p > 0 ? ` (${((d / p) * 100).toFixed(1)}%)` : '';
		if (d === 0) return { text: `· 0${pct}`, cls };
		return { text: `${arrow} ${base}${pct}`, cls };
	};

	const toggleSort = (k: SortKey) => {
		if (k === sortKey) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(k);
		// 기본값: 텍스트는 asc, 숫자는 desc
		setSortDir(k === 'payments' || k === 'amount' ? 'desc' : 'asc');
	};

	const sortMark = (k: SortKey) => (k !== sortKey ? '' : sortDir === 'asc' ? '▲' : '▼');

	useEffect(() => {
		// 숨김 상태 변경 시, 숨겨진 컬럼에 sort가 걸려 있으면 안전하게 amount로 되돌린다.
		const sortVisible =
			(sortKey === 'category1' || sortKey === 'category2' || sortKey === 'category3') ? !hideCategoryGroup :
			sortKey === 'product_name' ? !hideProduct :
			(sortKey === 'channel_group' || sortKey === 'channel_name') ? !hideChannelGroup :
			sortKey === 'keyword' ? !hideKeyword :
			true;
		if (!sortVisible) {
			setSortKey('amount');
			setSortDir('desc');
		}
		// 숨겨진 필터가 남는 것을 방지(UX)
		if (hideCategoryGroup) {
			setFCat1('');
			setFCat2('');
			setFCat3('');
		}
		if (hideChannelGroup) {
			setFCg('');
			setFCn('');
		}
		if (hideProduct) {
			setFProductName('');
		}
		if (hideKeyword) {
			setFKw('');
		}
	}, [hideCategoryGroup, hideChannelGroup, hideProduct, hideKeyword, sortKey]);

	const tableCols = useMemo(() => {
		type Col = { key: SortKey; weight: number };
		const cols: Col[] = [];
		// UX: 카테고리 그룹(대/중/소)은 폭을 조금 줄이고, 상품명은 폭을 넓게 확보한다.
		if (!hideCategoryGroup) cols.push({ key: 'category1', weight: 8 }, { key: 'category2', weight: 8 }, { key: 'category3', weight: 8 });
		if (!hideProduct) cols.push({ key: 'product_name', weight: 34 });
		if (!hideChannelGroup) cols.push({ key: 'channel_group', weight: 9 }, { key: 'channel_name', weight: 15 });
		if (!hideKeyword) cols.push({ key: 'keyword', weight: 12 });
		// 결제수/결제금액은 2줄(본값+증감)을 표시하므로 폭을 넓게 배정한다.
		cols.push({ key: 'payments', weight: 10 }, { key: 'amount', weight: 12 });
		const total = Math.max(1, cols.reduce((a, c) => a + c.weight, 0));
		return cols.map((c) => ({ ...c, widthPct: `${((c.weight / total) * 100).toFixed(4)}%` }));
	}, [hideCategoryGroup, hideProduct, hideChannelGroup, hideKeyword]);

	const categoryChannelDash = useMemo(() => {
		// 카테고리(소) 기준(없으면 중/대 fallback)
		const catKey = (r: PurchaseKeywordRow) =>
			(r.category3 || '').trim() || (r.category2 || '').trim() || (r.category1 || '').trim() || '(미분류)';
		const channelKey = (r: PurchaseKeywordRow) => (r.channel_name || '').trim() || (r.channel_group || '').trim() || '(채널미상)';

		const byCat = new Map<string, Map<string, number>>();
		const catTotals = new Map<string, number>();
		const chTotals = new Map<string, number>();

		for (const r of rows) {
			const cat = catKey(r);
			const ch = channelKey(r);
			const amt = Number(r.amount) || 0;
			if (!byCat.has(cat)) byCat.set(cat, new Map());
			const m = byCat.get(cat)!;
			m.set(ch, (m.get(ch) || 0) + amt);
			catTotals.set(cat, (catTotals.get(cat) || 0) + amt);
			chTotals.set(ch, (chTotals.get(ch) || 0) + amt);
		}

		const topCats = Array.from(catTotals.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([cat]) => cat);
		const topChannels = Array.from(chTotals.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([ch]) => ch);

		const dataAmount = topCats.map((cat) => {
			const row: any = { category: cat, total: catTotals.get(cat) || 0 };
			const m = byCat.get(cat) || new Map();
			for (const ch of topChannels) row[ch] = m.get(ch) || 0;
			return row;
		});

		const dataPct = topCats.map((cat) => {
			const total = Math.max(1, catTotals.get(cat) || 0);
			const row: any = { category: cat, total };
			const m = byCat.get(cat) || new Map();
			for (const ch of topChannels) row[ch] = ((m.get(ch) || 0) / total) * 100;
			return row;
		});

		return { topCats, topChannels, dataAmount, dataPct };
	}, [rows]);

	const channelColors = useMemo(() => {
		const palette = [
			'#22c55e',
			'#a78bfa',
			'#f472b6',
			'#fb923c',
			'#60a5fa',
			'#fbbf24',
			'#34d399',
			'#94a3b8',
		];
		const m = new Map<string, string>();
		categoryChannelDash.topChannels.forEach((ch, i) => m.set(ch, palette[i % palette.length] ?? palette[0]!));
		return m;
	}, [categoryChannelDash.topChannels]);

	const title = '구매 키워드 분석';
	const subtitle = `${fromYmdStr} ~ ${toYmd2}`;
	const sourceUsed = String((dashboard as any)?.source_used ?? '').trim();
	const isCommerce = sourceUsed === 'purchase_commerce_api';
	const metricLabel = isCommerce ? '주문기반' : '기여도 추정';
	const keywordLabel = isCommerce ? '유입상세' : '키워드';

	const runSyncYesterday = useCallback(async () => {
		setSyncState({ busy: true, message: '자동수집(어제) 실행 중…' });
		setSyncModalOpen(true);
		try {
			const res = await syncPurchaseKeywordsYesterday({ apiBaseUrl: props.apiBaseUrl });
			const ok = Boolean((res as any)?.ok ?? true);
			const st = String((res as any)?.status ?? '');
			const r2 = (res as any)?.result ?? null;
			setLastSyncResult({
				kind: 'yesterday',
				ok,
				status: st || (ok ? 'SUCCESS' : 'FAILED'),
				date: String((res as any)?.date ?? ''),
				result: r2,
				at: new Date().toISOString(),
			});
			setSyncState({ busy: false, message: ok ? `자동수집 완료 (${st || 'OK'})` : `자동수집 실패 (${st || 'FAILED'})` });
			await refresh();
		} catch (e: any) {
			const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '자동수집 실패');
			setSyncState({ busy: false, message: `자동수집 실패: ${msg}` });
			setLastSyncResult({ kind: 'yesterday', ok: false, status: 'FAILED', date: '', error: msg, at: new Date().toISOString() });
		}
		setSyncModalOpen(false);
	}, [props.apiBaseUrl, refresh]);

	const runSyncRange = useCallback(async () => {
		setSyncState({ busy: true, message: `수동수집 실행 중… (${fromYmdStr}~${toYmd2})` });
		setSyncModalOpen(true);
		try {
			const res = await syncPurchaseKeywords({ apiBaseUrl: props.apiBaseUrl, from: fromYmdStr, to: toYmd2 });
			const ok = Boolean((res as any)?.ok ?? true);
			const errs = (res as any)?.errors;
			const errCnt = errs && typeof errs === 'object' ? Object.keys(errs).length : 0;
			setSyncState({ busy: false, message: ok ? `수동수집 완료` : `수동수집 완료(오류 ${errCnt}일)` });
			setLastSyncResult({
				kind: 'range',
				ok,
				status: ok ? 'SUCCESS' : 'FAILED',
				from: fromYmdStr,
				to: toYmd2,
				result: res,
				at: new Date().toISOString(),
			});
			await refresh();
		} catch (e: any) {
			const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '수동수집 실패');
			setSyncState({ busy: false, message: `수동수집 실패: ${msg}` });
			setLastSyncResult({ kind: 'range', ok: false, status: 'FAILED', from: fromYmdStr, to: toYmd2, error: msg, at: new Date().toISOString() });
		}
		setSyncModalOpen(false);
	}, [props.apiBaseUrl, fromYmdStr, toYmd2, refresh]);

	const goApiSettings = useCallback(() => {
		try {
			navigate('/analytics/settings/api');
		} catch {
			// ignore
		}
	}, [navigate]);
	const uploadPeriodLabel = useMemo(() => {
		if (uploadedPeriod?.from && uploadedPeriod?.to) {
			return `${uploadedPeriod.from} ~ ${uploadedPeriod.to}`;
		}
		if (inferredDateFromFile) return `${inferredDateFromFile}`;
		return '';
	}, [uploadedPeriod, inferredDateFromFile]);

	const SmartstoreTooltip = useCallback((tp: any) => {
		if (!tp?.active) return null;
		const label = String(tp?.label ?? '');
		const payload: any[] = Array.isArray(tp?.payload) ? tp.payload : [];
		const items = payload
			.map((p) => ({ name: String(p?.name ?? ''), value: Number(p?.value) || 0, color: String(p?.color ?? '#94a3b8') }))
			.filter((x) => x.name && Number.isFinite(x.value) && x.value !== 0)
			.sort((a, b) => b.value - a.value)
			.slice(0, 8);

		return (
			<div className="ss-tooltip">
				<div className="ss-tooltip-title">{label}</div>
				<div className="ss-tooltip-body">
					{items.map((it) => (
						<div key={it.name} className="ss-tooltip-row">
							<div className="ss-tooltip-name">
								<span className="ss-tooltip-dot" style={{ background: it.color }} />
								<span className="ss-tooltip-text">{it.name}</span>
							</div>
							<div className="ss-tooltip-val">{tp?.pct ? `${it.value.toFixed(1)}%` : fmtWon(it.value)}</div>
						</div>
					))}
					{items.length === 0 ? <div className="ss-tooltip-empty">표시할 값이 없습니다.</div> : null}
				</div>
			</div>
		);
	}, []);

	return (
		<div>
			{syncModalOpen ? (
				<div
					role="dialog"
					aria-label="purchase-keywords-sync-running"
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.55)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 9999,
						padding: 16,
					}}
				>
					<div className="card" style={{ maxWidth: 520, width: '100%', padding: 14 }}>
						<div className="card-title">커머스 API 수집 실행 중</div>
						<div className="card-caption" style={{ marginTop: 6 }}>
							{syncState.message || '실행 중…'} <span style={{ color: '#94a3b8' }}>(완료되면 자동으로 닫힙니다)</span>
						</div>
						<div style={{ marginTop: 12, height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden' }}>
							<div style={{ width: '65%', height: '100%', background: 'rgba(34,197,94,0.6)' }} />
						</div>
					</div>
				</div>
			) : null}
			{productParam || keywordParam ? (
				<div className="card" style={{ padding: 10, marginBottom: 10, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.06)' }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
						<div style={{ fontSize: 12, color: '#cbd5e1' }}>
							{productParam ? (
								<>
									A-1 연동 상품 필터 적용됨: <b style={{ color: '#e2e8f0' }}>{productParam}</b>
								</>
							) : null}
							{productParam && keywordParam ? ' / ' : null}
							{keywordParam ? (
								<>
									AI Ops 키워드 필터 적용됨: <b style={{ color: '#e2e8f0' }}>{keywordParam}</b>
								</>
							) : null}
						</div>
						<button
							type="button"
							className="btn-ghost"
							style={{ fontSize: 11, padding: '2px 8px' }}
							onClick={() => {
								const next = new URLSearchParams(searchParams);
								next.delete('product');
								next.delete('keyword');
								setSearchParams(next, { replace: true } as any);
								setFProductName('');
								setFKw('');
							}}
						>
							필터 해제
						</button>
					</div>
					<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
						상품명이 데이터와 정확히 일치하지 않으면 결과가 0건일 수 있습니다. 이 경우 상단 “상품명” 드롭다운에서 직접 선택하세요.
					</div>
				</div>
			) : null}
			{manualPickerOpen ? (
				<div
					role="dialog"
					aria-label="manual-date-picker"
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.55)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 9999,
						padding: 16,
					}}
				>
					<div className="card" style={{ maxWidth: 520, width: '100%', padding: 14 }}>
						<div className="card-title">업로드 기준일 선택</div>
						<div className="card-caption" style={{ marginTop: 6 }}>
							파일에 일자 컬럼이 없을 때만 사용됩니다. (파일명 날짜가 있으면 보통 입력이 필요 없습니다)
						</div>
						<div style={{ marginTop: 10 }}>
							<DatePicker
								inline
								selected={parseYmd(manualTargetDate) ?? new Date()}
								onChange={(d) => {
									if (d instanceof Date && Number.isFinite(d.getTime())) {
										setManualTargetDate(toYmd(d));
									}
									setManualPickerOpen(false);
								}}
							/>
						</div>
						<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
							<button
								type="button"
								className="btn-ghost"
								onClick={() => {
									setManualTargetDate('');
									setManualPickerOpen(false);
								}}
							>
								비우기
							</button>
							<button type="button" className="btn-primary" onClick={() => setManualPickerOpen(false)}>
								닫기
							</button>
						</div>
					</div>
				</div>
			) : null}

			{confirmOpen ? (
				<div
					role="dialog"
					aria-label="upload-date-confirm"
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.55)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 9999,
						padding: 16,
					}}
				>
					<div className="card" style={{ maxWidth: 520, width: '100%', padding: 14 }}>
						<div className="card-title">입력날짜 확인</div>
						<div className="card-caption" style={{ marginTop: 6 }}>
							{confirmText}
						</div>
						<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
							<button type="button" className="btn-ghost" onClick={confirmNo}>
								아니오(취소)
							</button>
							<button type="button" className="btn-primary" onClick={() => void confirmYes()}>
								예(저장)
							</button>
						</div>
					</div>
				</div>
			) : null}

			<div className="card" style={{ marginBottom: 12 }}>
				<div className="pk-topbar">
					<div className="pk-topbar-left">
						<div className="pk-title-row">
							<div className="card-title pk-title-main">{title}</div>
							<div className="pk-title-sub">: 상품판매 유입이 어디서/어떻게 발생했는지 확인해봅시다</div>
						</div>

						<div className="pk-uploadline">
							<div className="pk-field">
								<div className="pk-label">업로드일자(자동추출)</div>
								<input className="input pk-input" value={inferredDateFromFile || ''} readOnly title={lastPickedFileName || ''} />
							</div>

							<div className="pk-field">
								<div className="pk-label">업로드일자(수동입력)</div>
								<input className="input pk-input" value={manualTargetDate} readOnly placeholder="" onClick={() => setManualPickerOpen(true)} />
							</div>

							<div className="pk-field pk-upload">
								<div className="pk-label">&nbsp;</div>
								<input
									ref={uploadInputRef}
									type="file"
									accept=".xlsx,.xls,.csv"
									style={{ display: 'none' }}
									onChange={(e) => void onUploadFile(e.target.files?.[0] ?? null)}
								/>
								<button type="button" className="btn-primary pk-upload-btn" onClick={onPickUploadFile} disabled={uploadState.busy}>
									엑셀업로드
								</button>
							</div>

							<div className="pk-field pk-upload">
								<div className="pk-label">&nbsp;</div>
								<button type="button" className="btn-ghost pk-upload-btn" onClick={() => void runSyncYesterday()} disabled={syncState.busy}>
									자동수집(어제)
								</button>
							</div>

							<div className="pk-field pk-upload">
								<div className="pk-label">&nbsp;</div>
								<button type="button" className="btn-ghost pk-upload-btn" onClick={() => void runSyncRange()} disabled={syncState.busy}>
									수동수집(기간)
								</button>
							</div>

							<div className="pk-field pk-upload-period">
								<div className="pk-label">기간(업로드)</div>
								<input className="input pk-input" value={uploadPeriodLabel} readOnly />
							</div>
						</div>
					</div>

					<div className="pk-topbar-right">
						<div className="pk-period">
							<AdsDateControls value={dateState} onChange={setDateState} />
						</div>
					</div>
				</div>

				{uploadState.message || fetchState.error ? (
					<div className="pk-status">
						<div className="pk-status-left">{uploadState.message || ''}</div>
						<div className="pk-status-right">{fetchState.error || syncState.message || subtitle}</div>
					</div>
				) : syncState.message ? (
					<div className="pk-status">
						<div className="pk-status-left">{syncState.message}</div>
						<div className="pk-status-right">{subtitle}</div>
					</div>
				) : null}
			</div>

			{lastSyncResult ? (
				<div className="card" style={{ marginBottom: 12 }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
						<div className="card-title">커머스 API 수집 결과</div>
						<div style={{ fontSize: 11, color: '#94a3b8' }}>
							마지막 실행: {String(lastSyncResult.at || '').replace('T', ' ').slice(0, 19)}
						</div>
					</div>
					<div className="card-caption" style={{ marginTop: 6 }}>
						상태:{' '}
						<b style={{ color: lastSyncResult.ok ? '#86efac' : '#fda4af' }}>
							{String(lastSyncResult.status || (lastSyncResult.ok ? 'SUCCESS' : 'FAILED'))}
						</b>
						{lastSyncResult.kind === 'yesterday' ? ` · 대상일자 ${String(lastSyncResult.date || '')}` : ` · 기간 ${String(lastSyncResult.from)} ~ ${String(lastSyncResult.to)}`}
					</div>

					{(() => {
						const r = (lastSyncResult.result ?? null) as any;
						const processed: string[] = Array.isArray(r?.processed_dates) ? r.processed_dates : [];
						const factByDate: Record<string, number> = (r?.fact_rows_by_date && typeof r.fact_rows_by_date === 'object') ? r.fact_rows_by_date : {};
						const errors: Record<string, string> = (r?.errors && typeof r.errors === 'object') ? r.errors : {};
						const rawUp = Number(r?.raw_upserted_total ?? 0) || 0;
						const dates = Array.from(new Set([...processed, ...Object.keys(factByDate || {}), ...Object.keys(errors || {})])).sort();
						const errCnt = Object.keys(errors || {}).length;

						if (!r && lastSyncResult.error) {
							return <div style={{ marginTop: 10, fontSize: 12, color: '#fca5a5' }}>오류: {String(lastSyncResult.error)}</div>;
						}

						return (
							<div style={{ marginTop: 10 }}>
								<div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
									<div>
										원천 upsert: <b>{fmtInt(rawUp)}</b>건
									</div>
									<div>
										처리 일자: <b>{fmtInt(dates.length)}</b>일
									</div>
									<div>
										오류: <b style={{ color: errCnt ? '#fca5a5' : '#86efac' }}>{fmtInt(errCnt)}</b>일
									</div>
								</div>

								<div className="purchase-table-wrap" style={{ marginTop: 10 }}>
									<table className="table purchase-table" aria-label="purchase-keywords-sync-result-table">
										<thead>
											<tr>
												<th>일자</th>
												<th className="num">저장건수</th>
												<th>오류</th>
											</tr>
										</thead>
										<tbody>
											{dates.map((d) => (
												<tr key={d}>
													<td>{d}</td>
													<td className="num">{fmtInt(Number((factByDate || {})[d] ?? 0) || 0)}</td>
													<td style={{ color: (errors || {})[d] ? '#fca5a5' : '#94a3b8' }}>
														{(errors || {})[d] ? (
															<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
																<span>{String((errors || {})[d])}</span>
																{String((errors || {})[d]).includes('GW.IP_NOT_ALLOWED') ||
																String((errors || {})[d]).includes('IP_NOT_ALLOWED') ||
																String((errors || {})[d]).includes('BIZDATA_FORBIDDEN') ||
																(String((errors || {})[d]).includes('bizdata') && String((errors || {})[d]).includes('GW.AUTHN')) ? (
																	<button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={goApiSettings}>
																		API 세팅으로 이동
																	</button>
																) : null}
															</div>
														) : (
															'-'
														)}
													</td>
												</tr>
											))}
											{dates.length === 0 ? (
												<tr>
													<td colSpan={3} style={{ padding: 10, color: '#94a3b8' }}>
														표시할 결과가 없습니다.
													</td>
												</tr>
											) : null}
										</tbody>
									</table>
								</div>
							</div>
						);
					})()}
				</div>
			) : null}

			{/* 카테고리(소) × 채널 대시보드 2종 */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="card-title">상품카테고리(소)에 따른 검색채널별 결제금액/비율 ({metricLabel})</div>
				<div className="card-caption">
					기간 내 데이터에서 카테고리(소) 기준으로 채널별 결제금액 합계와 비율을 스택 막대로 표시합니다. (상위 10개 카테고리)
				</div>

				{rows.length === 0 ? (
					<div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>데이터가 없습니다.</div>
				) : (
					<div className="ss-grid-2">
						<div className="ss-panel">
							<div className="ss-panel-title">상품카테고리(소)에 따른 검색채널별 결제금액({metricLabel})</div>
							<div className="ss-chart">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={categoryChannelDash.dataAmount} layout="vertical" margin={{ left: 12, right: 12 }}>
										<YAxis type="category" dataKey="category" width={110} tick={{ fill: '#cbd5e1', fontSize: 11 }} />
										<XAxis
											type="number"
											tick={{ fill: '#94a3b8', fontSize: 11 }}
											tickFormatter={(v) => fmtInt(Number(v) || 0)}
										/>
										<Tooltip content={SmartstoreTooltip as any} cursor={false} />
										<Legend wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
										{categoryChannelDash.topChannels.map((ch) => (
											<Bar key={ch} dataKey={ch} stackId="a" fill={channelColors.get(ch) || '#94a3b8'} isAnimationActive={false} />
										))}
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>

						<div className="ss-panel">
							<div className="ss-panel-title">상품카테고리(소)에 따른 검색채널별 결제금액 비율({metricLabel})</div>
							<div className="ss-chart">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={categoryChannelDash.dataPct} layout="vertical" margin={{ left: 12, right: 12 }}>
										<YAxis type="category" dataKey="category" width={110} tick={{ fill: '#cbd5e1', fontSize: 11 }} />
										<XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
										<Tooltip content={(p: any) => <SmartstoreTooltip {...p} pct />} cursor={false} />
										<Legend wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
										{categoryChannelDash.topChannels.map((ch) => (
											<Bar key={ch} dataKey={ch} stackId="p" fill={channelColors.get(ch) || '#94a3b8'} isAnimationActive={false} />
										))}
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* 대시보드 */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="card-title">결제금액 Top 10상품의 {keywordLabel}별 결제금액 ({metricLabel})</div>
				<div className="card-caption">
					Top 상품(결제금액 기준)별로, 키워드 기여 결제금액 상위 항목을 막대그래프로 보여줍니다.
				</div>

				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
					{(dashboard?.products || []).map((p) => {
						const max = Math.max(1, ...(p.keywords || []).map((k) => Number(k.amount) || 0));
						return (
							<div key={p.product_id} className="card" style={{ padding: 12 }}>
								<div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, color: '#e5e7eb' }}>
									{p.product_name || '(상품명 없음)'}
								</div>
								<div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
									상품ID {p.product_id} · 합계 {fmtWon(p.amount)} · 결제수(기여도) {fmtNum(p.payments, 3)}
								</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
									{(p.keywords || []).map((k) => {
										const w = Math.max(0, Math.min(100, Math.round(((Number(k.amount) || 0) / max) * 100)));
										return (
											<div key={k.keyword} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr auto', gap: 8, alignItems: 'center' }}>
												<div style={{ fontSize: 11, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
													{k.keyword}
												</div>
												<div style={{ height: 10, borderRadius: 999, background: 'rgba(148,163,184,0.14)', overflow: 'hidden' }}>
													<div style={{ width: `${w}%`, height: '100%', background: 'rgba(34,197,94,0.65)' }} />
												</div>
												<div style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 900, textAlign: 'right' }}>
													{fmtInt(roundHalfUp(k.amount))}
												</div>
											</div>
										);
									})}
									{!p.keywords?.length ? <div style={{ fontSize: 12, color: '#94a3b8' }}>키워드 데이터가 없습니다.</div> : null}
								</div>
							</div>
						);
					})}
					{dashboard && !dashboard.products?.length ? (
						<div style={{ fontSize: 12, color: '#94a3b8' }}>해당 기간/필터에 데이터가 없습니다.</div>
					) : null}
				</div>
			</div>

			{/* 상세 */}
			<div className="card">
				<div className="card-title">키워드 상세 내역</div>
				<div className="card-caption">
					기간 내 데이터를 카테고리/상품/채널/{keywordLabel} 기준으로 합산하여 표시합니다.
					{isCommerce ? ' (커머스 API 주문 기반 집계: 판매자센터 기여도추정과 동일 의미가 아닐 수 있습니다)' : ''}
				</div>

				<div className="purchase-hidebar">
					<button type="button" className={`btn-ghost ${hideCategoryGroup ? 'hide-on' : ''}`} onClick={() => toggleHide('category')}>
						{hideCategoryGroup ? '카테고리그룹 보이기' : '카테고리그룹 숨기기'}
					</button>
					<button type="button" className={`btn-ghost ${hideProduct ? 'hide-on' : ''}`} onClick={() => toggleHide('product')}>
						{hideProduct ? '상품명 보이기' : '상품명 숨기기'}
					</button>
					<button type="button" className={`btn-ghost ${hideChannelGroup ? 'hide-on' : ''}`} onClick={() => toggleHide('channel')}>
						{hideChannelGroup ? '채널그룹 보이기' : '채널그룹 숨기기'}
					</button>
					<button type="button" className={`btn-ghost ${hideKeyword ? 'hide-on' : ''}`} onClick={() => toggleHide('keyword')}>
						{hideKeyword ? '키워드 보이기' : '키워드 숨기기'}
					</button>
					{hideWarn ? <div className="purchase-hidebar-warn">{hideWarn}</div> : null}
				</div>

				{/* 필터 폭을 표 헤더 폭과 맞추기 위해 colgroup과 동일한 비율로 렌더링 */}
				<div className="purchase-filterbar" style={{ gridTemplateColumns: tableCols.map((c: any) => c.widthPct).join(' ') }}>
					{tableCols.map((c: any) => {
						const k = c.key as SortKey;
						if (k === 'category1') {
							return (
								<div key="f-cat1">
									<label className="field-label">카테고리(대)</label>
									<select className="input" value={fCat1} onChange={(e) => setFCat1(e.target.value)}>
										<option value="">전체</option>
										{filterOptions.cat1.map((x) => (
											<option key={x} value={x}>
												{x}
											</option>
										))}
									</select>
								</div>
							);
						}
						if (k === 'category2') {
							return (
								<div key="f-cat2">
									<label className="field-label">카테고리(중)</label>
									<select className="input" value={fCat2} onChange={(e) => setFCat2(e.target.value)}>
										<option value="">전체</option>
										{filterOptions.cat2.map((x) => (
											<option key={x} value={x}>
												{x}
											</option>
										))}
									</select>
								</div>
							);
						}
						if (k === 'category3') {
							return (
								<div key="f-cat3">
									<label className="field-label">카테고리(소)</label>
									<select className="input" value={fCat3} onChange={(e) => setFCat3(e.target.value)}>
										<option value="">전체</option>
										{filterOptions.cat3.map((x) => (
											<option key={x} value={x}>
												{x}
											</option>
										))}
									</select>
								</div>
							);
						}
						if (k === 'product_name') {
							return (
								<div key="f-pn">
									<label className="field-label">상품명</label>
									<select className="input" value={fProductName} onChange={(e) => setFProductName(e.target.value)}>
										<option value="">전체</option>
										{productNameOptions.hasEmpty ? <option value="__EMPTY__">(상품명 없음)</option> : null}
										{productNameOptions.names.map((x) => (
											<option key={x} value={x}>
												{x}
											</option>
										))}
									</select>
								</div>
							);
						}
						if (k === 'channel_group') {
							return (
								<div key="f-cg">
									<label className="field-label">채널그룹</label>
									<select className="input" value={fCg} onChange={(e) => setFCg(e.target.value)}>
										<option value="">전체</option>
										{filterOptions.cgs.map((x) => (
											<option key={x} value={x}>
												{x}
											</option>
										))}
									</select>
								</div>
							);
						}
						if (k === 'channel_name') {
							return (
								<div key="f-cn">
									<label className="field-label">채널명</label>
									<select className="input" value={fCn} onChange={(e) => setFCn(e.target.value)}>
										<option value="">전체</option>
										{filterOptions.cns.map((x) => (
											<option key={x} value={x}>
												{x}
											</option>
										))}
									</select>
								</div>
							);
						}
						if (k === 'keyword') {
							return (
								<div key="f-kw">
									<label className="field-label">{keywordLabel}(포함)</label>
									<input className="input" value={fKw} onChange={(e) => setFKw(e.target.value)} placeholder="예: 헤나, 염색약" />
								</div>
							);
						}
						// category3 / payments / amount 등: 필터 없음(정렬로만)
						return <div key={`f-${k}`} />;
					})}
				</div>

				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
					<div style={{ fontSize: 12, color: '#94a3b8' }}>
						총 {fmtInt(visibleDetailRows.length)}건 · 결제수 {fmtNum(visibleDetailRows.reduce((a, r) => a + (Number(r.payments) || 0), 0), 3)} · 결제금액{' '}
						{fmtWon(visibleDetailRows.reduce((a, r) => a + (Number(r.amount) || 0), 0))}
					</div>
					{fetchState.loading ? <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 900 }}>로딩중…</div> : null}
				</div>

				<div className="purchase-table-wrap">
					<table className="table purchase-table" aria-label="purchase-keywords-table">
						<colgroup>
							{tableCols.map((c: any) => (
								<col key={`col-${c.key}`} style={{ width: c.widthPct }} />
							))}
						</colgroup>
						<thead>
							<tr>
								{tableCols.map((c: any) => {
									const k = c.key as SortKey;
									if (k === 'category1')
										return (
											<th key="h-cat1" className="sortable" onClick={() => toggleSort('category1')}>
												카테고리(대) <span className="sort-mark">{sortMark('category1')}</span>
											</th>
										);
									if (k === 'category2')
										return (
											<th key="h-cat2" className="sortable" onClick={() => toggleSort('category2')}>
												카테고리(중) <span className="sort-mark">{sortMark('category2')}</span>
											</th>
										);
									if (k === 'category3')
										return (
											<th key="h-cat3" className="sortable" onClick={() => toggleSort('category3')}>
												카테고리(소) <span className="sort-mark">{sortMark('category3')}</span>
											</th>
										);
									if (k === 'product_name')
										return (
											<th key="h-pn" className="sortable" onClick={() => toggleSort('product_name')}>
												상품명 <span className="sort-mark">{sortMark('product_name')}</span>
											</th>
										);
									if (k === 'channel_group')
										return (
											<th key="h-cg" className="sortable" onClick={() => toggleSort('channel_group')}>
												채널그룹 <span className="sort-mark">{sortMark('channel_group')}</span>
											</th>
										);
									if (k === 'channel_name')
										return (
											<th key="h-cn" className="sortable" onClick={() => toggleSort('channel_name')}>
												채널명 <span className="sort-mark">{sortMark('channel_name')}</span>
											</th>
										);
									if (k === 'keyword')
										return (
											<th key="h-kw" className="sortable" onClick={() => toggleSort('keyword')}>
												{keywordLabel} <span className="sort-mark">{sortMark('keyword')}</span>
											</th>
										);
									if (k === 'payments')
										return (
											<th key="h-pay" className="num sortable" onClick={() => toggleSort('payments')}>
												결제수 <span className="sort-mark">{sortMark('payments')}</span>
											</th>
										);
									return (
										<th key="h-amt" className="num sortable" onClick={() => toggleSort('amount')}>
											결제금액 <span className="sort-mark">{sortMark('amount')}</span>
										</th>
									);
								})}
							</tr>
						</thead>
						<tbody>
							{visibleDetailRows.map((r, idx) => (
								<tr key={`${r.category1}-${r.category2}-${r.category3}-${r.product_name}-${r.channel_group}-${r.channel_name}-${r.keyword}-${idx}`}>
									{tableCols.map((c: any) => {
										const k = c.key as SortKey;
										if (k === 'category1') return <td key="b-cat1" className="cell-ellipsis">{r.category1 || ''}</td>;
										if (k === 'category2') return <td key="b-cat2" className="cell-ellipsis">{r.category2 || ''}</td>;
										if (k === 'category3') return <td key="b-cat3" className="cell-ellipsis">{r.category3 || ''}</td>;
										if (k === 'product_name') return <td key="b-pn" className="cell-ellipsis">{r.product_name || ''}</td>;
										if (k === 'channel_group') return <td key="b-cg" className="cell-ellipsis">{r.channel_group || ''}</td>;
										if (k === 'channel_name') return <td key="b-cn" className="cell-ellipsis">{r.channel_name || ''}</td>;
										if (k === 'keyword') return <td key="b-kw" className="cell-ellipsis">{r.keyword}</td>;
										if (k === 'payments') {
											const key = visibleDims
												.map((kk) => {
													if (kk === 'category1') return r.category1 || '';
													if (kk === 'category2') return r.category2 || '';
													if (kk === 'category3') return r.category3 || '';
													if (kk === 'product_name') return r.product_name || '';
													if (kk === 'channel_group') return r.channel_group || '';
													if (kk === 'channel_name') return r.channel_name || '';
													if (kk === 'keyword') return r.keyword || '';
													return '';
												})
												.join('||');
											const pr = prevDetailRows.get(key);
											const d = formatDelta(Number(r.payments) || 0, Number(pr?.payments) || 0, 'count');
											return (
												<td key="b-pay" className="num">
													<div className="num-main">{fmtNum(r.payments, 3)}</div>
													<div className={`num-delta ${d.cls}`}>{d.text}</div>
												</td>
											);
										}
										if (k === 'amount') {
											const key = visibleDims
												.map((kk) => {
													if (kk === 'category1') return r.category1 || '';
													if (kk === 'category2') return r.category2 || '';
													if (kk === 'category3') return r.category3 || '';
													if (kk === 'product_name') return r.product_name || '';
													if (kk === 'channel_group') return r.channel_group || '';
													if (kk === 'channel_name') return r.channel_name || '';
													if (kk === 'keyword') return r.keyword || '';
													return '';
												})
												.join('||');
											const pr = prevDetailRows.get(key);
											const d = formatDelta(Number(r.amount) || 0, Number(pr?.amount) || 0, 'won');
											return (
												<td key="b-amt" className="num">
													<div className="num-main">{fmtInt(roundHalfUp(r.amount))}</div>
													<div className={`num-delta ${d.cls}`}>{d.text}</div>
												</td>
											);
										}
										return <td key={`b-${k}`} />;
									})}
								</tr>
							))}
							{visibleDetailRows.length === 0 ? (
								<tr>
									<td colSpan={9} style={{ padding: 10, color: '#94a3b8' }}>
										데이터가 없습니다. (기간/필터를 조정하거나 엑셀 업로드를 진행하세요)
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

