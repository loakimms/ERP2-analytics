import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { CategoryPickerManual, type CategoryValue } from './CategoryPickerManual';
import {
	buildLiveCombos,
	buildTokenMetrics,
	buildVocabTokens,
	buildConversionTemplateCombo,
	computeScoresV2,
	computeComboStats,
	expandCompoundKeywordForSelection,
	isCapacityLikeToken,
	filterCandidates,
	segmentKoreanCompound,
	applyRulesToToken,
	buildSynonymIndex,
	type CandidateFilters,
	type ScoreWeights,
} from './seoOptimizerUtils';
import { loadSeoRules, type SeoRules } from './seoOptimizerRules';

type OptimizerCandidate = {
	keyword: string;
	titleFreq?: number | null;
	totalSearchQcCnt?: number | null;
	compIdx?: string | null;
	avgCtr?: number | null;
	autoMatch?: boolean;
	scores?: {
		freq: number;
		search: number;
		competition: number;
		ctr: number;
		autocomplete: number;
		total: number;
	};
};

type TitleOptimizerResponse = {
	productName: string;
	category: { id: string; path: string };
	mainKeyword: string;
	dateFrom: string;
	dateTo: string;
	shopping: {
		needsCaptcha: boolean;
		error?: string | null;
		debug?: Record<string, unknown>;
		titles: string[];
	};
	titleTokens: Array<{ token: string; freq: number }>;
	searchAd: { error?: string | null; related: Array<Record<string, unknown>> };
	autocomplete?: {
		enabled: boolean;
		bySource?: Record<string, string[]>;
		merged?: string[];
	};
	candidates: OptimizerCandidate[];
	recommendedCombos: Array<{ name: string; tokens: string[] }>;
	constraints?: { maxTokensTotal: number };
	scoringPolicy?: { note?: string; weights?: Record<string, number> };
};

const LS_MANUAL_CHECKS_KEY = 'seoManualChecks.v2';
const LS_CAND_TABLE_OPEN_KEY = 'seoCandTableOpen.v1';
const LS_SAVED_COMBOS_KEY = 'seoSavedCombos.v1';
const LS_SAVED_COMBOS_OPEN_KEY = 'seoSavedCombosOpen.v1';

type SavedCombo = {
	id: string;
	name: string;
	tokens: string[];
	source: 'template';
	createdAt: string; // ISO
	stats?: {
		totalSearch: number | null;
		totalFreq: number;
		avgCtr: number | null; // percent
		totalScore: number | null;
		missingTokenCount: number;
	};
};

type ManualCheck = {
	autoCompleteChecked?: boolean;
	note?: string;
	updatedAt?: string;
};

function safeJsonParse<T>(s: string | null, fallback: T): T {
	try {
		if (!s) return fallback;
		return JSON.parse(s) as T;
	} catch {
		return fallback;
	}
}

function formatPct(v: number | null | undefined): string {
	if (v == null || Number.isNaN(v)) return '-';
	return `${v.toFixed(2)}%`;
}

export function SeoOptimizerView(props: { apiBaseUrl: string }): JSX.Element {
	const api = props.apiBaseUrl;
	const SCORE_WEIGHTS: ScoreWeights = { search: 0.6, freq: 0.3, ctr: 0.1 };
	const [seoRules, setSeoRules] = useState<SeoRules>(() => loadSeoRules());
	useEffect(() => {
		const onRulesUpdated = () => setSeoRules(loadSeoRules());
		try {
			window.addEventListener('seo:rules-updated', onRulesUpdated as any);
			return () => window.removeEventListener('seo:rules-updated', onRulesUpdated as any);
		} catch {
			return;
		}
	}, []);

	// 상품 정보(추가 입력): 제품 타입 / 용량
	const PRODUCT_TYPE_OPTIONS = [
		'로션',
		'오일',
		'젤',
		'크림',
		'무스',
		'파운데이션',
		'스프레이',
		'쿠션',
		'리퀴드',
		'스틱',
		'파우더',
		'섀도우',
		'샴푸',
		'브러쉬',
		'고체',
		'시트(티슈)',
	] as const;
	const [productType, setProductType] = useState<string>('');
	const [volumeText, setVolumeText] = useState<string>('');
	// 상품 기본 정보 포함 여부(요청): 후보/조합 생성에 넣을지 선택
	const [includeNameInGen, setIncludeNameInGen] = useState(true);
	const [includeTypeInGen, setIncludeTypeInGen] = useState(true);
	const [includeVolumeInGen, setIncludeVolumeInGen] = useState(true);
	// 브랜드 제외(요청): Top40 토큰/연관검색어 확장 시 제외할 브랜드명(들)
	const [brandExcludeText, setBrandExcludeText] = useState<string>('');

	// 전환 템플릿(고정): 메인 단일 + 구매의도 + 안전/차별 + 형태
	const [tplMain, setTplMain] = useState<string>('');
	const [tplIntent1, setTplIntent1] = useState<string>('');
	const [tplIntent2, setTplIntent2] = useState<string>('');
	const [tplSafety1, setTplSafety1] = useState<string>('');
	const [tplSafety2, setTplSafety2] = useState<string>('');
	const [tplForm, setTplForm] = useState<string>('');
	type TemplateSlotId = 'main' | 'intent1' | 'intent2' | 'safety1' | 'safety2' | 'form';
	const [tplOrder, setTplOrder] = useState<TemplateSlotId[]>(['main', 'intent1', 'intent2', 'safety1', 'safety2', 'form']);
	const [tplDragging, setTplDragging] = useState<TemplateSlotId | null>(null);

	const [productName, setProductName] = useState<string>('');
	const [mainKeyword, setMainKeyword] = useState<string>('');
	const [dateFrom, setDateFrom] = useState<Date>(() => {
		const d = new Date();
		d.setDate(d.getDate() - 30);
		return d;
	});
	const [dateTo, setDateTo] = useState<Date>(() => new Date());

	const [selectedCategory, setSelectedCategory] = useState<{ id: string; path: string } | null>(null);
	const [includeAutocomplete, setIncludeAutocomplete] = useState(false);
	const [topTitlesOpen, setTopTitlesOpen] = useState(true);
	const [candTableOpen, setCandTableOpen] = useState<boolean>(() =>
		safeJsonParse<boolean>(localStorage.getItem(LS_CAND_TABLE_OPEN_KEY), true),
	);
	const [savedCombos, setSavedCombos] = useState<SavedCombo[]>(() =>
		safeJsonParse<SavedCombo[]>(localStorage.getItem(LS_SAVED_COMBOS_KEY), []),
	);
	const [savedCombosOpen, setSavedCombosOpen] = useState<boolean>(() => {
		const open = safeJsonParse<boolean>(localStorage.getItem(LS_SAVED_COMBOS_OPEN_KEY), false);
		const existing = safeJsonParse<SavedCombo[]>(localStorage.getItem(LS_SAVED_COMBOS_KEY), []);
		return open || (existing || []).length > 0;
	});

	// 결과
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<TitleOptimizerResponse | null>(null);
	const [runError, setRunError] = useState<string | null>(null);
	// 선택 단어(토큰) - 조합 시뮬레이션/추천의 기반
	const [selectedWords, setSelectedWords] = useState<Record<string, boolean>>({});
	const [manualChecks, setManualChecks] = useState<Record<string, ManualCheck>>(() =>
		safeJsonParse<Record<string, ManualCheck>>(localStorage.getItem(LS_MANUAL_CHECKS_KEY), {}),
	);

	// 후보 키워드 필터(4-1 연관키워드 표 스타일)
	const [candFilterText, setCandFilterText] = useState('');
	const [candMinSearch, setCandMinSearch] = useState<string>('');
	const [candMaxSearch, setCandMaxSearch] = useState<string>('');
	const [candMinFreq, setCandMinFreq] = useState<string>('');
	const [candMaxFreq, setCandMaxFreq] = useState<string>('');
	const [candMinCtr, setCandMinCtr] = useState<string>('');
	const [candMaxCtr, setCandMaxCtr] = useState<string>('');
	const [candCompetition, setCandCompetition] = useState<'all' | '높음' | '중간' | '낮음'>('all');
	const [candSort, setCandSort] = useState<{
		key: 'keyword' | 'freq' | 'search' | 'competition' | 'ctr' | 'total';
		dir: 'asc' | 'desc';
	}>({ key: 'total', dir: 'desc' });
	const [candSelectedOnly, setCandSelectedOnly] = useState(false);

	useEffect(() => {
		try {
			localStorage.setItem(LS_MANUAL_CHECKS_KEY, JSON.stringify(manualChecks));
		} catch {
			// ignore
		}
	}, [manualChecks]);

	useEffect(() => {
		try {
			localStorage.setItem(LS_CAND_TABLE_OPEN_KEY, JSON.stringify(candTableOpen));
		} catch {
			// ignore
		}
	}, [candTableOpen]);

	useEffect(() => {
		try {
			localStorage.setItem(LS_SAVED_COMBOS_KEY, JSON.stringify(savedCombos));
		} catch {
			// ignore
		}
	}, [savedCombos]);

	useEffect(() => {
		try {
			localStorage.setItem(LS_SAVED_COMBOS_OPEN_KEY, JSON.stringify(savedCombosOpen));
		} catch {
			// ignore
		}
	}, [savedCombosOpen]);

	// 카테고리가 비어있으면(초기/해제) 결과 리스트가 노출되지 않도록 즉시 초기화한다.
	useEffect(() => {
		if (selectedCategory) return;
		setResult(null);
		setSelectedWords({});
		setRunError(null);
	}, [selectedCategory]);

	// SEO 규칙(전환 목표)은 메뉴6(설정)에서 저장/관리한다.

	const appliedCategoryText = useMemo(() => {
		if (!selectedCategory) return '-';
		return `${selectedCategory.path} (${selectedCategory.id})`;
	}, [selectedCategory]);

	const combinedPrefix = useMemo(() => {
		const parts = [
			includeNameInGen ? productName : '',
			includeVolumeInGen ? volumeText : '',
			includeTypeInGen ? productType : '',
		]
			.map((x) => String(x || '').trim())
			.filter(Boolean);
		return parts.join(' ').replace(/\s+/g, ' ').trim();
	}, [includeNameInGen, includeTypeInGen, includeVolumeInGen, productName, productType, volumeText]);

	const candidateFilters: CandidateFilters = useMemo(() => {
		const toNumOrNull = (s: string): number | null => {
			const raw = String(s || '').trim();
			if (!raw) return null;
			const n = Number(raw);
			return Number.isFinite(n) ? n : null;
		};
		return {
			includeText: candFilterText.trim() || undefined,
			minSearch: toNumOrNull(candMinSearch),
			maxSearch: toNumOrNull(candMaxSearch),
			minFreq: toNumOrNull(candMinFreq),
			maxFreq: toNumOrNull(candMaxFreq),
			minCtr: toNumOrNull(candMinCtr),
			maxCtr: toNumOrNull(candMaxCtr),
			competition: candCompetition,
		};
	}, [
		candCompetition,
		candFilterText,
		candMaxCtr,
		candMaxFreq,
		candMaxSearch,
		candMinCtr,
		candMinFreq,
		candMinSearch,
	]);

	const enrichedCandidates = useMemo(() => {
		const baseList = result?.candidates || [];

		// (요청) 후보 확장: Top40 토큰 + SearchAd 연관검색어를 최대한 포함(브랜드 제외)
		const brandExcludes = String(brandExcludeText || '')
			.split(/[\r\n,]+/g)
			.map((x) => x.trim())
			.filter(Boolean);
		const stopSet = new Set<string>(
			[...(seoRules.stopwords || []), ...brandExcludes].map((x) => String(x || '').trim()).filter(Boolean),
		);

		const merged: Record<string, OptimizerCandidate> = {};
		const upsert = (c: OptimizerCandidate) => {
			const k = String(c.keyword || '').trim();
			if (!k) return;
			if (stopSet.has(k)) return;
			if (isCapacityLikeToken(k)) return;
			const cur = merged[k] || { keyword: k };
			merged[k] = {
				keyword: k,
				titleFreq: Math.max(Number(cur.titleFreq || 0), Number(c.titleFreq || 0)) || undefined,
				totalSearchQcCnt:
					(cur.totalSearchQcCnt ?? null) != null ? cur.totalSearchQcCnt : c.totalSearchQcCnt ?? null,
				compIdx: (cur.compIdx ?? null) != null ? cur.compIdx : c.compIdx ?? null,
				avgCtr: (cur.avgCtr ?? null) != null ? cur.avgCtr : c.avgCtr ?? null,
				autoMatch: Boolean(cur.autoMatch || c.autoMatch),
				scores: cur.scores ?? c.scores,
			};
		};

		for (const c of baseList) upsert(c);
		for (const t of result?.titleTokens || []) {
			const token = String(t.token || '').trim();
			if (!token) continue;
			if (stopSet.has(token)) continue;
			if (isCapacityLikeToken(token)) continue;
			upsert({ keyword: token, titleFreq: Number(t.freq || 0) });
		}
		for (const r of result?.searchAd?.related || []) {
			const kw = String((r as any).relKeyword ?? (r as any).keyword ?? '').trim();
			if (!kw) continue;
			if (stopSet.has(kw)) continue;
			if (isCapacityLikeToken(kw)) continue;
			const total =
				(r as any).totalSearchQcCnt != null
					? Number((r as any).totalSearchQcCnt)
					: Number((r as any).monthlyPcQcCnt || 0) + Number((r as any).monthlyMobileQcCnt || 0);
			const ctr = (r as any).avgCtr != null ? Number((r as any).avgCtr) : null;
			const comp = (r as any).compIdx != null ? String((r as any).compIdx) : null;
			upsert({
				keyword: kw,
				titleFreq: 0,
				totalSearchQcCnt: Number.isFinite(total) && total > 0 ? total : null,
				avgCtr: Number.isFinite(ctr as any) ? (ctr as number) : null,
				compIdx: comp,
			});
		}

		const expanded = Object.values(merged);
		const scored = computeScoresV2(expanded, SCORE_WEIGHTS);
		const vocab = buildVocabTokens({
			titleTokens: result?.titleTokens || [],
			productName: combinedPrefix,
			mainKeyword,
			extra: scored.map((c) => String(c.keyword || '')),
		});

		const synIdx = buildSynonymIndex(seoRules.synonymGroups || []);
		const toCanon = (t: string): string | null => applyRulesToToken(t, seoRules);

		const withTokens = scored.map((c) => {
			const kw = String(c.keyword || '');
			const segmented = segmentKoreanCompound(kw, vocab);
			const rawTokens = expandCompoundKeywordForSelection({ keyword: kw, segmentedTokens: segmented });
			// (표시/선택 분리) 라벨은 원문(raw), 선택 키는 규칙 적용(canon)으로 분리한다.
			// - 빈도는 "키워드(행)" 기준이므로, 라벨을 바꾸면 사용자가 오해할 수 있음
			// - 동의어 중복 제거는 canon 기준으로 수행
			const tokenOptions: Array<{ label: string; key: string }> = [];
			const uniq: string[] = [];
			const seenGroup = new Set<string>();
			for (const rt of rawTokens) {
				const label = String(rt || '').trim();
				if (!label) continue;
				if (isCapacityLikeToken(label)) continue;
				const canon = toCanon(label);
				if (!canon) continue;
				const canonKey = String(canon || '').replace(/\s+/g, '').trim();
				const g = synIdx.groupOf[canonKey] || canonKey;
				if (seenGroup.has(g)) continue;
				seenGroup.add(g);
				uniq.push(canon);
				tokenOptions.push({ label, key: canon });
			}
			return { ...c, tokens: uniq, tokenOptions };
		});
		const filtered = filterCandidates(withTokens, candidateFilters);
		// 기본 정렬(초기값): 총점(가중) desc
		filtered.sort((a, b) => {
			const as = a.scoresV2?.total ?? 0;
			const bs = b.scoresV2?.total ?? 0;
			if (bs !== as) return bs - as;
			return String(a.keyword || '').localeCompare(String(b.keyword || ''));
		});
		return filtered;
	}, [
		SCORE_WEIGHTS,
		brandExcludeText,
		candidateFilters,
		combinedPrefix,
		mainKeyword,
		result?.candidates,
		result?.searchAd?.related,
		result?.titleTokens,
		seoRules.stopwords,
		seoRules.synonymGroups,
	]);

	const sortedCandidates = useMemo(() => {
		// (옵션) 선택된 토큰이 포함된 행만 표시
		const base = [...(enrichedCandidates || [])];
		const norm = (s: unknown): string => String(s || '').trim().replace(/\s+/g, '');
		const selectedSet = new Set(
			Object.entries(selectedWords)
				.filter(([, v]) => v)
				.map(([k]) => norm(k))
				.filter(Boolean),
		);
		const list =
			candSelectedOnly && selectedSet.size > 0
				? base.filter((c: any) => {
						const toks: string[] = Array.isArray(c?.tokens) ? c.tokens : [];
						// "선택 키워드만 표시"는 부분문자열(contains)이 아니라,
						// 선택된 토큰(정규화 키)이 후보 행의 토큰 목록에 **정확히 포함**될 때만 노출한다.
						return toks.some((t) => selectedSet.has(norm(t)));
					})
				: base;
		const isAsc = candSort.dir === 'asc';
		const compScore = (v: string | null | undefined): number => {
			const s = String(v || '').trim();
			if (s === '높음') return 3;
			if (s === '중간') return 2;
			if (s === '낮음') return 1;
			return 0;
		};
		list.sort((a, b) => {
			let av: number | string = '';
			let bv: number | string = '';
			switch (candSort.key) {
				case 'keyword':
					av = String(a.keyword || '');
					bv = String(b.keyword || '');
					break;
				case 'freq':
					av = Number(a.titleFreq || 0);
					bv = Number(b.titleFreq || 0);
					break;
				case 'search':
					av = Number(a.totalSearchQcCnt || 0);
					bv = Number(b.totalSearchQcCnt || 0);
					break;
				case 'ctr':
					av = Number(a.avgCtr || 0);
					bv = Number(b.avgCtr || 0);
					break;
				case 'competition':
					av = compScore(a.compIdx);
					bv = compScore(b.compIdx);
					break;
				case 'total':
					av = Number((a as any).scoresV2?.total || 0);
					bv = Number((b as any).scoresV2?.total || 0);
					break;
				default:
					av = 0;
					bv = 0;
			}

			if (typeof av === 'number' && typeof bv === 'number') {
				// 숫자 정렬: asc => av-bv, desc => bv-av
				if (bv !== av) return isAsc ? av - bv : bv - av;
				// tie-breaker: keyword asc
				return String(a.keyword || '').localeCompare(String(b.keyword || ''));
			}
			const cmp = String(av).localeCompare(String(bv));
			if (cmp !== 0) return isAsc ? cmp : -cmp;
			return String(a.keyword || '').localeCompare(String(b.keyword || ''));
		});
		return list;
	}, [candSelectedOnly, candSort.dir, candSort.key, enrichedCandidates, selectedWords]);

	function toggleSort(nextKey: 'keyword' | 'freq' | 'search' | 'competition' | 'ctr' | 'total'): void {
		setCandSort((prev) => {
			if (prev.key === nextKey) {
				return { key: nextKey, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
			}
			// 숫자형 컬럼은 desc가 기본, 키워드는 asc
			const defaultDir: 'asc' | 'desc' = nextKey === 'keyword' ? 'asc' : 'desc';
			return { key: nextKey, dir: defaultDir };
		});
	}

	function sortIcon(key: string): string {
		if (candSort.key !== (key as any)) return '';
		return candSort.dir === 'asc' ? ' ▲' : ' ▼';
	}

	const tokenMetrics = useMemo(() => buildTokenMetrics(enrichedCandidates), [enrichedCandidates]);
	const metricBounds = useMemo(() => {
		const list = Object.values(tokenMetrics || {});
		const searchVals = list.map((m) => Number(m.search || 0));
		const freqVals = list.map((m) => Number(m.freq || 0));
		const ctrVals = list.map((m) => Number(m.ctr || 0));
		return {
			sMin: searchVals.length ? Math.min(...searchVals) : 0,
			sMax: searchVals.length ? Math.max(...searchVals) : 0,
			fMin: freqVals.length ? Math.min(...freqVals) : 0,
			fMax: freqVals.length ? Math.max(...freqVals) : 0,
			cMin: ctrVals.length ? Math.min(...ctrVals) : 0,
			cMax: ctrVals.length ? Math.max(...ctrVals) : 0,
		};
	}, [tokenMetrics]);

	const selectedTokens = useMemo(
		() =>
			Object.entries(selectedWords)
				.filter(([, v]) => v)
				.map(([k]) => k),
		[selectedWords],
	);

	const selectedTokensSorted = useMemo(() => {
		const uniq = Array.from(new Set(selectedTokens.map((t) => String(t || '').trim()).filter(Boolean)));
		uniq.sort((a, b) => {
			const am = tokenMetrics[a] || { search: 0, freq: 0, ctr: 0 };
			const bm = tokenMetrics[b] || { search: 0, freq: 0, ctr: 0 };
			if (bm.search !== am.search) return bm.search - am.search;
			if (bm.freq !== am.freq) return bm.freq - am.freq;
			return bm.ctr - am.ctr;
		});
		return uniq;
	}, [selectedTokens, tokenMetrics]);

	const tplFormOptions = useMemo(() => {
		const base = (selectedTokensSorted || []).map((t) => String(t || '').trim()).filter(Boolean);
		const pt = String(productType || '').trim();
		const out: string[] = [];
		if (pt) out.push(pt); // (요청) 제품타입을 형태 키워드 후보로 항상 노출
		for (const t of base) if (!out.includes(t)) out.push(t);
		return out;
	}, [productType, selectedTokensSorted]);

	// 템플릿 드롭다운 초기값: 선택 토큰이 바뀌면 비어있는 슬롯만 자동 채움
	useEffect(() => {
		if (selectedTokensSorted.length === 0) return;
		const first = selectedTokensSorted[0] || '';
		setTplMain((v) => (v ? v : first));
		setTplIntent1((v) => (v ? v : selectedTokensSorted[1] || first));
		setTplIntent2((v) => (v ? v : selectedTokensSorted[2] || first));
		setTplSafety1((v) => (v ? v : selectedTokensSorted[3] || first));
		setTplSafety2((v) => (v ? v : selectedTokensSorted[4] || first));
		// 형태 키워드는 제품타입이 있으면 우선 자동 채움
		setTplForm((v) => (v ? v : String(productType || '').trim() || selectedTokensSorted[3] || first));
	}, [productType, selectedTokensSorted]);

	const simulatedTitle = useMemo(() => {
		const base = (combinedPrefix || '').trim();
		const tokens = [base, ...selectedTokensSorted].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
		return tokens || '-';
	}, [combinedPrefix, selectedTokensSorted]);

	const simulatedLen = useMemo(() => {
		const s = (simulatedTitle || '').trim();
		return { withSpaces: s.length, withoutSpaces: s.replace(/\s+/g, '').length };
	}, [simulatedTitle]);

	const templateCombo = useMemo(() => {
		if (!result) return null;
		return buildConversionTemplateCombo({
			productName: combinedPrefix.trim(),
			mainToken: tplMain,
			intentToken1: tplIntent1,
			intentToken2: tplIntent2,
			safetyToken1: tplSafety1,
			safetyToken2: tplSafety2,
			formToken: tplForm,
			slotOrder: tplOrder,
			maxTokensTotal: result.constraints?.maxTokensTotal ?? 8,
			maxChars: 25,
			rules: seoRules,
		});
	}, [combinedPrefix, result, seoRules, tplForm, tplIntent1, tplIntent2, tplMain, tplOrder, tplSafety1, tplSafety2]);

	function comboStats(tokens: string[]) {
		return computeComboStats({
			comboTokens: tokens,
			prefix: combinedPrefix,
			tokenMetrics,
			metricBounds,
			weights: SCORE_WEIGHTS,
		});
	}

	function saveTemplateCombo(): void {
		if (!templateCombo || !templateCombo.ok) return;
		const name = String(templateCombo.name || '').trim();
		const tokens = Array.isArray(templateCombo.tokens) ? templateCombo.tokens : [];
		if (!name || name === '-') return;
		const st = comboStats(tokens);
		const nowIso = new Date().toISOString();
		const mkId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

		setSavedCombos((prev) => {
			const cleaned = (prev || []).filter((x) => x && typeof x.name === 'string');
			// 같은 조합명은 중복 저장하지 않고 최신으로 끌어올린다.
			const withoutDup = cleaned.filter((x) => String(x.name || '').trim() !== name);
			const next: SavedCombo = {
				id: mkId(),
				name,
				tokens,
				source: 'template',
				createdAt: nowIso,
				stats: st
					? {
							totalSearch: st.totalSearch ?? null,
							totalFreq: st.totalFreq,
							avgCtr: st.avgCtr ?? null,
							totalScore: st.totalScore ?? null,
							missingTokenCount: st.missingTokenCount,
						}
					: undefined,
			};
			return [next, ...withoutDup].slice(0, 200);
		});
		setSavedCombosOpen(true);
	}

	function handleTplDragStart(id: TemplateSlotId, e: React.DragEvent<HTMLDivElement>): void {
		setTplDragging(id);
		try {
			e.dataTransfer.setData('text/plain', id);
			e.dataTransfer.effectAllowed = 'move';
		} catch {
			// ignore
		}
	}
	function handleTplDrop(targetId: TemplateSlotId, e: React.DragEvent<HTMLDivElement>): void {
		e.preventDefault();
		const dragged = ((): TemplateSlotId | null => {
			if (tplDragging) return tplDragging;
			try {
				return (e.dataTransfer.getData('text/plain') as TemplateSlotId) || null;
			} catch {
				return null;
			}
		})();
		if (!dragged || dragged === targetId) return;
		setTplOrder((prev) => {
			const next = prev.slice();
			const from = next.indexOf(dragged);
			const to = next.indexOf(targetId);
			if (from < 0 || to < 0) return prev;
			next.splice(from, 1);
			next.splice(to, 0, dragged);
			return next;
		});
		setTplDragging(null);
	}
	function handleTplDragOver(e: React.DragEvent<HTMLDivElement>): void {
		e.preventDefault();
		try {
			e.dataTransfer.dropEffect = 'move';
		} catch {
			// ignore
		}
	}

	async function run(): Promise<void> {
		setRunError(null);
		setResult(null);
		setSelectedWords({});
		setCandFilterText('');
		setCandMinSearch('');
		setCandMaxSearch('');
		setCandMinFreq('');
		setCandMaxFreq('');
		setCandMinCtr('');
		setCandMaxCtr('');
		setCandCompetition('all');

		const pn = combinedPrefix.trim();
		const mk = mainKeyword.trim();
		if (!pn) {
			setRunError('상품명 prefix를 입력하세요.');
			return;
		}
		if (!mk) {
			setRunError('메인 키워드를 입력하세요.');
			return;
		}
		if (!selectedCategory) {
			setRunError('상세 카테고리를 선택하세요. (템플릿 또는 카테고리 후보)');
			return;
		}

		const df = dateFrom.toISOString().slice(0, 10);
		const dt = dateTo.toISOString().slice(0, 10);

		setRunning(true);
		try {
			const resp = await axios.post<TitleOptimizerResponse>(`${api}/research/seo/title-optimizer`, null, {
				params: {
					product_name: pn,
					main_keyword: mk,
					category_id: selectedCategory.id,
					category_path: selectedCategory.path,
					date_from: df,
					date_to: dt,
					limit_titles: 40,
					candidate_count: 20,
					combo_count: 10,
					max_tokens_total: 8,
					include_autocomplete: includeAutocomplete,
				},
			});
			setResult(resp.data);
		} catch (e: any) {
			setRunError(e?.response?.data?.detail || e?.message || '분석 실패');
		} finally {
			setRunning(false);
		}
	}

	function setTokenSelected(t: string, checked: boolean): void {
		const key = String(t || '').trim();
		if (!key) return;
		setSelectedWords((prev) => ({ ...prev, [key]: Boolean(checked) }));
	}

	function copyText(s: string): void {
		const text = (s || '').trim();
		if (!text) return;
		try {
			void navigator.clipboard.writeText(text);
		} catch {
			// ignore
		}
	}

	function openShoppingSearch(k: string): void {
		const q = (k || '').trim();
		if (!q) return;
		const url = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}`;
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	function updateManualCheck(keyword: string, patch: Partial<ManualCheck>): void {
		const k = (keyword || '').trim();
		if (!k) return;
		setManualChecks((prev) => {
			const cur: ManualCheck = prev[k] || { autoCompleteChecked: false };
			const next: ManualCheck = {
				...cur,
				...patch,
				updatedAt: new Date().toISOString(),
			};
			return { ...prev, [k]: next };
		});
	}

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">상품명 SEO (5-1)</div>
				<div className="card-caption">
					쇼핑 Top40 상품명 + SearchAd + 자동완성 신호를 결합해 후보(15~20개) 점수화(1~10) 및 조합을 생성합니다.
				</div>

				<div className="seo-header-grid">
					<div>
						<label className="field-label" htmlFor="seo-productName">
							상품명(prefix)
						</label>
						<input
							id="seo-productName"
							className="input"
							placeholder="예: 염색약"
							value={productName}
							onChange={(e) => setProductName(e.target.value)}
						/>
						<div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 800, marginTop: 4 }}>
							실제 prefix는 <b>상품명 + 용량 + 제품타입</b>을 합쳐서 사용합니다.
						</div>
					</div>
					<div>
						<label className="field-label" htmlFor="seo-productType">
							제품타입유형
						</label>
						<select
							id="seo-productType"
							className="input"
							value={productType}
							onChange={(e) => setProductType(e.target.value)}
						>
							<option value="">선택</option>
							{PRODUCT_TYPE_OPTIONS.map((t) => (
								<option key={t} value={t}>
									{t}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className="field-label" htmlFor="seo-volume">
							용량
						</label>
						<input
							id="seo-volume"
							className="input"
							placeholder="예: 200ml / 30g / 1개"
							value={volumeText}
							onChange={(e) => setVolumeText(e.target.value)}
						/>
					</div>
					<div>
						<label className="field-label" htmlFor="seo-mainKeyword">
							메인 키워드
						</label>
						<input
							id="seo-mainKeyword"
							className="input"
							placeholder="예: 새치 염색약"
							value={mainKeyword}
							onChange={(e) => {
								setMainKeyword(e.target.value);
							}}
						/>
					</div>
					<div>
						<label className="field-label">기간</label>
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
							<DatePicker
								selected={dateFrom}
								onChange={(d) => d && setDateFrom(d)}
								className="input"
								dateFormat="yyyy-MM-dd"
							/>
							<DatePicker
								selected={dateTo}
								onChange={(d) => d && setDateTo(d)}
								className="input"
								dateFormat="yyyy-MM-dd"
							/>
						</div>
					</div>
					<div>
						<label className="field-label">적용 카테고리</label>
						<div className="seo-applied-category">{appliedCategoryText}</div>
					</div>
				</div>

				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
					<button type="button" className="btn-primary" onClick={run} disabled={running}>
						{running ? '분석 중…' : '분석 실행'}
					</button>
					<label
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							fontSize: 12,
							color: '#cbd5e1',
							fontWeight: 800,
						}}
					>
						<input
							type="checkbox"
							checked={includeAutocomplete}
							onChange={(e) => setIncludeAutocomplete(e.target.checked)}
						/>
						자동완성 후보도 수집(선택)
					</label>
				</div>

				{runError ? (
					<div style={{ marginTop: 10, color: '#fca5a5', fontSize: 12, fontWeight: 800 }}>
						{runError}
					</div>
				) : null}
			</div>

			<div className="card">
				<div className="card-title">카테고리 선택(상세)</div>
				<div className="card-caption">
					카테고리는 쇼핑 크롤링 없이 <b>수동으로 선택</b>합니다. 저장된 카테고리 텍스트가 있으면 입력 시 자동완성으로 선택됩니다.
				</div>
				<div style={{ marginTop: 10 }}>
					<CategoryPickerManual
						apiBaseUrl={api}
						value={selectedCategory as CategoryValue}
						onChange={(v) => {
							if (!v) return;
							setSelectedCategory(v);
						}}
						showDictionaryManager={false}
					/>
				</div>
			</div>

			<div className="card">
				<div className="card-title">SEO 규칙/카테고리 사전</div>
				<div className="card-caption">
					금칙어/동의어(전환 목표) 및 카테고리 사전(CSV 가져오기/추가)은 <b>메뉴 6 “설정”</b>에서 관리합니다.
				</div>
			</div>

			{result && selectedCategory ? (
				<>
					<div className="card">
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
							<div className="card-title">쇼핑 Top 상품명(최대 40)</div>
							<button
								type="button"
								className="btn-ghost"
								aria-label={topTitlesOpen ? '쇼핑 Top 상품명 접기' : '쇼핑 Top 상품명 펼치기'}
								title={topTitlesOpen ? '접기' : '펼치기'}
								onClick={() => setTopTitlesOpen((v) => !v)}
								style={{
									whiteSpace: 'nowrap',
									minWidth: 96,
									padding: '10px 14px',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontWeight: 900,
									fontSize: 14,
									lineHeight: 1,
									gap: 10,
									borderRadius: 12,
									border: '1px solid rgba(148,163,184,0.25)',
									background: 'rgba(2,6,23,0.35)',
								}}
							>
								<span style={{ fontSize: 12, letterSpacing: 0.2 }}>{topTitlesOpen ? '접기' : '펼치기'}</span>
								<span style={{ fontSize: 18, lineHeight: 1 }}>{topTitlesOpen ? '▾' : '▸'}</span>
							</button>
						</div>
						<div className="card-caption">
							{result.shopping.needsCaptcha ? (
								<span style={{ color: '#fcd34d', fontWeight: 900 }}>
									캡차/차단 가능성이 있습니다. “쇼핑 페이지 열기(캡차)”로 해결 후 재시도하세요.
								</span>
							) : (
								<span style={{ color: '#bbf7d0', fontWeight: 900 }}>정상 로드</span>
							)}
						</div>
						{result.shopping.error ? (
							<div style={{ fontSize: 12, color: '#fca5a5', fontWeight: 800 }}>{result.shopping.error}</div>
						) : null}
						{topTitlesOpen ? (
							<div className="seo-titles">
								{(result.shopping.titles || []).slice(0, 40).map((t, i) => (
									<div key={i} className="seo-title-row">
										<div className="seo-title-idx">{i + 1}</div>
										<div className="seo-title-text">{t}</div>
									</div>
								))}
							</div>
						) : null}
					</div>

					<div className="card">
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
							<div className="card-title">후보 키워드(점수화)</div>
							<button
								type="button"
								className="btn-ghost"
								aria-label={candTableOpen ? '후보 키워드 표 접기' : '후보 키워드 표 펼치기'}
								title={candTableOpen ? '접기' : '펼치기'}
								onClick={() => setCandTableOpen((v) => !v)}
								style={{
									whiteSpace: 'nowrap',
									minWidth: 96,
									padding: '10px 14px',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontWeight: 900,
									fontSize: 14,
									lineHeight: 1,
									gap: 10,
									borderRadius: 12,
									border: '1px solid rgba(148,163,184,0.25)',
									background: 'rgba(2,6,23,0.35)',
								}}
							>
								<span style={{ fontSize: 12, letterSpacing: 0.2 }}>{candTableOpen ? '접기' : '펼치기'}</span>
								<span style={{ fontSize: 18, lineHeight: 1 }}>{candTableOpen ? '▾' : '▸'}</span>
							</button>
						</div>
						<div className="card-caption">
							점수 기준을 <b>검색량 &gt; 사용빈도 &gt; CTR</b> 순으로 고정했습니다. (가중치: 검색량 {SCORE_WEIGHTS.search}, 빈도{' '}
							{SCORE_WEIGHTS.freq}, CTR {SCORE_WEIGHTS.ctr}) · 자동완성/공식 키워드툴 확인은 아래에서 <b>자동완성 확인</b>으로 체크하세요.
							(띄어쓰기 포함 “조합형”은 필수)
						</div>
						{result.scoringPolicy?.note ? (
							<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 800, marginBottom: 8 }}>
								{result.scoringPolicy.note}
							</div>
						) : null}
						<div
							style={{
								display: 'grid',
								gap: 8,
								padding: '10px 12px',
								border: '1px solid rgba(148,163,184,0.18)',
								borderRadius: 8,
								background: 'rgba(2,6,23,0.35)',
								marginBottom: 10,
							}}
						>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
								<div style={{ fontSize: 12, fontWeight: 900 }}>상품 기본 정보(키워드 생성 포함 여부)</div>
								<div style={{ fontSize: 11, fontWeight: 900, color: '#9ca3af' }}>
									현재 prefix: <span style={{ color: '#e2e8f0' }}>{combinedPrefix || '-'}</span>
								</div>
							</div>
							<div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
								<label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 900, color: '#cbd5e1' }}>
									<input type="checkbox" checked={includeNameInGen} onChange={(e) => setIncludeNameInGen(e.target.checked)} />
									제품명: <span style={{ color: '#e2e8f0' }}>{productName || '-'}</span>
								</label>
								<label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 900, color: '#cbd5e1' }}>
									<input type="checkbox" checked={includeTypeInGen} onChange={(e) => setIncludeTypeInGen(e.target.checked)} />
									제품타입: <span style={{ color: '#e2e8f0' }}>{productType || '-'}</span>
								</label>
								<label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 900, color: '#cbd5e1' }}>
									<input type="checkbox" checked={includeVolumeInGen} onChange={(e) => setIncludeVolumeInGen(e.target.checked)} />
									용량: <span style={{ color: '#e2e8f0' }}>{volumeText || '-'}</span>
								</label>
							</div>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
								<div>
									<label className="field-label" htmlFor="seo-brand-exclude">
										브랜드명 제외(Top40/연관검색어 확장 시)
									</label>
									<input
										id="seo-brand-exclude"
										className="input"
										placeholder="예: 수자타, 헤어플러스 (콤마/줄바꿈 구분)"
										value={brandExcludeText}
										onChange={(e) => setBrandExcludeText(e.target.value)}
									/>
								</div>
								<div style={{ fontSize: 11, fontWeight: 800, color: '#9ca3af', alignSelf: 'end' }}>
									Top40 토큰/연관검색어를 <b>최대한 많이</b> 후보에 포함하되, 브랜드/금칙어는 제외합니다.
								</div>
							</div>
						</div>
						{(() => {
							const list = enrichedCandidates || [];
							const requiredUnchecked = list.some((c) => {
								const k = String(c.keyword || '');
								const required = /\s+/.test(k.trim());
								if (!required) return false;
								const mc = manualChecks[k] || {};
								return !mc.autoCompleteChecked;
							});
							if (!requiredUnchecked) return null;
							return (
								<div style={{ fontSize: 12, color: '#fca5a5', fontWeight: 900, marginBottom: 8 }}>
									띄어쓰기 포함 “조합형” 키워드는 자동완성 확인이 필요합니다. 미체크 항목은 선택/조합에 포함되지 않습니다.
								</div>
							);
						})()}

						{/* 조합 시뮬레이션(표 위로 이동) */}
						<div className="seo-sim-box">
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
								<div style={{ fontWeight: 900 }}>조합 시뮬레이션(상품명 + 선택 키워드)</div>
								<div
									style={{
										fontSize: 12,
										fontWeight: 900,
										color: simulatedLen.withSpaces > 25 ? '#fca5a5' : '#9ca3af',
									}}
									title="기준: 공백 포함 글자수 25자"
								>
									글자수 {simulatedLen.withSpaces}/25 (공백 제외 {simulatedLen.withoutSpaces})
								</div>
								<button
									type="button"
									className="btn-ghost"
									onClick={() => copyText(simulatedTitle)}
									style={{ whiteSpace: 'nowrap', minWidth: 56, padding: '6px 10px', display: 'inline-flex', justifyContent: 'center' }}
								>
									복사
								</button>
							</div>
							<div className="seo-sim-title">{simulatedTitle}</div>
						</div>

						{candTableOpen ? (
							<>
						{/* 필터(기본+범위) */}
						<div
							data-testid="cand-filters"
							style={{
								display: 'flex',
								flexWrap: 'nowrap',
								gap: 10,
								marginTop: 10,
								marginBottom: 10,
								alignItems: 'end',
								width: '100%',
							}}
						>
							<div style={{ flex: '2 1 0', minWidth: 0 }}>
								<label className="field-label" htmlFor="seo-cand-filter-text">
									후보 필터: 포함 검색
								</label>
								<input
									id="seo-cand-filter-text"
									className="input"
									placeholder="예: 염색"
									value={candFilterText}
									onChange={(e) => setCandFilterText(e.target.value)}
								/>
							</div>

							<div style={{ flex: '0 0 auto' }}>
								<label className="field-label">표시</label>
								<button
									type="button"
									className="btn-ghost"
									aria-pressed={candSelectedOnly}
									onClick={() => setCandSelectedOnly((v) => !v)}
									style={{
										whiteSpace: 'nowrap',
										padding: '8px 10px',
										borderRadius: 10,
										border: '1px solid rgba(148,163,184,0.22)',
										background: candSelectedOnly ? 'rgba(34,197,94,0.10)' : 'rgba(2,6,23,0.20)',
										fontSize: 12,
										fontWeight: 900,
										color: candSelectedOnly ? '#bbf7d0' : '#cbd5e1',
									}}
									title="선택된 토큰이 포함된 후보 행만 표시"
								>
									선택 키워드만 표시 {candSelectedOnly ? 'ON' : 'OFF'}
								</button>
							</div>

							<div style={{ flex: '1.2 1 0', minWidth: 0 }}>
								<label className="field-label">검색량(최소~최대)</label>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
									<input
										id="seo-cand-min-search"
										className="input"
										inputMode="numeric"
										placeholder="최소"
										value={candMinSearch}
										onChange={(e) => setCandMinSearch(e.target.value)}
										aria-label="후보 필터: 최소 검색량"
									/>
									<input
										id="seo-cand-max-search"
										className="input"
										inputMode="numeric"
										placeholder="최대"
										value={candMaxSearch}
										onChange={(e) => setCandMaxSearch(e.target.value)}
										aria-label="최대 검색량"
									/>
								</div>
							</div>

							<div style={{ flex: '1 1 0', minWidth: 0 }}>
								<label className="field-label">빈도(최소~최대)</label>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
									<input
										id="seo-cand-min-freq"
										className="input"
										inputMode="numeric"
										placeholder="최소"
										value={candMinFreq}
										onChange={(e) => setCandMinFreq(e.target.value)}
										aria-label="최소 빈도"
									/>
									<input
										id="seo-cand-max-freq"
										className="input"
										inputMode="numeric"
										placeholder="최대"
										value={candMaxFreq}
										onChange={(e) => setCandMaxFreq(e.target.value)}
										aria-label="최대 빈도"
									/>
								</div>
							</div>

							<div style={{ flex: '1 1 0', minWidth: 0 }}>
								<label className="field-label">CTR%(최소~최대)</label>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
									<input
										id="seo-cand-min-ctr"
										className="input"
										inputMode="decimal"
										placeholder="최소"
										value={candMinCtr}
										onChange={(e) => setCandMinCtr(e.target.value)}
										aria-label="후보 필터: 최소 CTR(%)"
									/>
									<input
										id="seo-cand-max-ctr"
										className="input"
										inputMode="decimal"
										placeholder="최대"
										value={candMaxCtr}
										onChange={(e) => setCandMaxCtr(e.target.value)}
										aria-label="최대 CTR(%)"
									/>
								</div>
							</div>

							<div style={{ flex: '0.8 1 0', minWidth: 0 }}>
								<label className="field-label" htmlFor="seo-cand-competition">
									경쟁강도
								</label>
								<select
									id="seo-cand-competition"
									className="input"
									value={candCompetition}
									onChange={(e) => setCandCompetition(e.target.value as any)}
								>
									<option value="all">전체</option>
									<option value="높음">높음</option>
									<option value="중간">중간</option>
									<option value="낮음">낮음</option>
								</select>
							</div>

							<div style={{ flex: '0 0 auto' }}>
								<label className="field-label" style={{ visibility: 'hidden' }}>
									초기화
								</label>
								<button
									type="button"
									className="btn-ghost"
									onClick={() => {
										setCandFilterText('');
										setCandMinSearch('');
										setCandMaxSearch('');
										setCandMinFreq('');
										setCandMaxFreq('');
										setCandMinCtr('');
										setCandMaxCtr('');
										setCandCompetition('all');
									}}
									style={{ whiteSpace: 'nowrap' }}
								>
									초기화
								</button>
							</div>
						</div>

						<div style={{ overflowX: 'auto' }}>
							<table className="table">
								<thead>
									<tr>
										<th>
											<button
												type="button"
												className="btn-ghost"
												aria-label={`정렬: 키워드${sortIcon('keyword')}`}
												onClick={() => toggleSort('keyword')}
											>
												키워드{sortIcon('keyword')}
											</button>
										</th>
										<th style={{ minWidth: 260 }}>단어 선택(세분화)</th>
										<th className="num">
											<button
												type="button"
												className="btn-ghost"
												aria-label={`정렬: 빈도${sortIcon('freq')}`}
												onClick={() => toggleSort('freq')}
											>
												빈도{sortIcon('freq')}
											</button>
										</th>
										<th className="num">
											<button
												type="button"
												className="btn-ghost"
												aria-label={`정렬: 검색량${sortIcon('search')}`}
												onClick={() => toggleSort('search')}
											>
												검색량{sortIcon('search')}
											</button>
										</th>
										<th className="num">
											<button
												type="button"
												className="btn-ghost"
												aria-label={`정렬: 경쟁${sortIcon('competition')}`}
												onClick={() => toggleSort('competition')}
											>
												경쟁{sortIcon('competition')}
											</button>
										</th>
										<th className="num">
											<button
												type="button"
												className="btn-ghost"
												aria-label={`정렬: CTR${sortIcon('ctr')}`}
												onClick={() => toggleSort('ctr')}
											>
												CTR{sortIcon('ctr')}
											</button>
										</th>
										<th className="num">
											<button
												type="button"
												className="btn-ghost"
												aria-label={`정렬: 총점${sortIcon('total')}`}
												onClick={() => toggleSort('total')}
											>
												총점(가중){sortIcon('total')}
											</button>
										</th>
										<th style={{ width: 220 }}>자동완성 확인</th>
									</tr>
								</thead>
								<tbody>
									{sortedCandidates.map((c) => {
										const k = c.keyword;
										const required = /\s+/.test(String(k || '').trim());
										const mc = manualChecks[k] || { autoCompleteChecked: false };
										const checked = Boolean(mc.autoCompleteChecked);
										const warn = required && !checked;
										const tokenOptions = Array.isArray((c as any).tokenOptions)
											? ((c as any).tokenOptions as Array<{ label: string; key: string }>)
											: Array.isArray((c as any).tokens)
												? (((c as any).tokens as string[]).map((t) => ({ label: String(t || ''), key: String(t || '') })) as Array<{
														label: string;
														key: string;
													}>)
												: [{ label: String(k || '').trim(), key: String(k || '').trim() }];
										return (
											<tr key={k}>
												<td style={{ fontWeight: 900, color: warn ? '#fca5a5' : undefined }}>
													{k}
													{warn ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 900 }}>(자동완성 확인 필요)</span> : null}
												</td>
												<td>
													<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
														{tokenOptions.map((opt) => {
															const label = String(opt?.label || '').trim();
															const key = String(opt?.key || '').trim();
															if (!label || !key) return null;
															return (
																<label
																	key={`${key}|${label}`}
																	style={{
																		display: 'flex',
																		alignItems: 'center',
																		gap: 6,
																		padding: '2px 8px',
																		border: '1px solid rgba(148,163,184,0.25)',
																		borderRadius: 999,
																		fontSize: 12,
																		fontWeight: 900,
																		color: warn ? '#fca5a5' : '#e2e8f0',
																		opacity: warn ? 0.6 : 1,
																	}}
																	title={warn ? '조합형 키워드는 자동완성 확인 후 선택할 수 있습니다.' : undefined}
																>
																	<input
																		type="checkbox"
																		checked={Boolean(selectedWords[key])}
																		onChange={(e) => setTokenSelected(key, e.target.checked)}
																		disabled={warn}
																	/>
																	{label}
																	{label !== key ? (
																		<span style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8' }} title={`정규화 키: ${key}`}>
																			(≈)
																		</span>
																	) : null}
																</label>
															);
														})}
													</div>
												</td>
												<td className="num">{c.titleFreq ?? '-'}</td>
												<td className="num">{c.totalSearchQcCnt ?? '-'}</td>
												<td className="num">{c.compIdx ?? '-'}</td>
												<td className="num">{formatPct(c.avgCtr ?? null)}</td>
												<td className="num" style={{ fontWeight: 900, color: '#bbf7d0' }}>
													{c.scoresV2?.total ?? '-'}
												</td>
												<td>
													<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
														<label
															style={{
																display: 'flex',
																alignItems: 'center',
																gap: 8,
																fontSize: 12,
																fontWeight: 900,
																color: warn ? '#fca5a5' : '#cbd5e1',
															}}
														>
															<input
																type="checkbox"
																checked={checked}
																onChange={(e) => updateManualCheck(k, { autoCompleteChecked: e.target.checked })}
															/>
															{required ? '조합형 확인 완료(필수)' : '확인 완료(선택)'}
														</label>
														<button type="button" className="btn-ghost" onClick={() => openShoppingSearch(k)}>
															쇼핑 열기
														</button>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
							</>
						) : null}
					</div>

					<div className="card">
						<div className="card-title">추천 조합(템플릿 고정)</div>
						<div className="card-caption">
							형식: <b>[메인 단일 1]</b> + <b>[구매의도 2]</b> + <b>[안전/차별 2]</b> + <b>[형태 1]</b> (규칙: 금칙어 완전 배제, 글자수 25자, 토큰 제한)
						</div>

						{selectedTokensSorted.length === 0 ? (
							<div style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5' }}>
								먼저 “단어 선택(세분화)”에서 토큰을 체크한 뒤, 아래 슬롯에 배치하세요.
							</div>
						) : null}

						<div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
							<div style={{ fontSize: 12, fontWeight: 900, color: '#9ca3af' }}>슬롯을 드래그해서 순서를 바꿀 수 있습니다.</div>
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(160px, 1fr))', gap: 10 }}>
								{tplOrder.map((slotId) => {
									const isForm = slotId === 'form';
									const label =
										slotId === 'main'
											? '메인 단일 키워드(1)'
											: slotId === 'intent1'
												? '구매의도 키워드(1)'
												: slotId === 'intent2'
													? '구매의도 키워드(2)'
													: slotId === 'safety1'
														? '안전/차별 키워드(1)'
														: slotId === 'safety2'
															? '안전/차별 키워드(2)'
															: '형태 키워드(1)';

									const value =
										slotId === 'main'
											? tplMain
											: slotId === 'intent1'
												? tplIntent1
												: slotId === 'intent2'
													? tplIntent2
													: slotId === 'safety1'
														? tplSafety1
														: slotId === 'safety2'
															? tplSafety2
															: tplForm;
									const setValue =
										slotId === 'main'
											? setTplMain
											: slotId === 'intent1'
												? setTplIntent1
												: slotId === 'intent2'
													? setTplIntent2
													: slotId === 'safety1'
														? setTplSafety1
														: slotId === 'safety2'
															? setTplSafety2
															: setTplForm;
									const options = isForm ? tplFormOptions : selectedTokensSorted;

									return (
										<div
											key={slotId}
											draggable
											onDragStart={(e) => handleTplDragStart(slotId, e)}
											onDragOver={handleTplDragOver}
											onDrop={(e) => handleTplDrop(slotId, e)}
											onDragEnd={() => setTplDragging(null)}
											style={{
												border: '1px solid rgba(148,163,184,0.22)',
												borderRadius: 12,
												padding: '10px 10px 12px',
												background: tplDragging === slotId ? 'rgba(148,163,184,0.08)' : 'rgba(2,6,23,0.25)',
												cursor: 'grab',
											}}
											title="드래그해서 순서 변경"
										>
											<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
												<label className="field-label" htmlFor={`seo-tpl-${slotId}`} style={{ margin: 0 }}>
													{label}
												</label>
												<span aria-hidden="true" style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>
													↕
												</span>
											</div>
											<select
												id={`seo-tpl-${slotId}`}
												className="input"
												value={value}
												onChange={(e) => setValue(e.target.value)}
											>
												<option value="">선택</option>
												{options.map((t) => (
													<option key={`${slotId}:${t}`} value={t}>
														{t}
													</option>
												))}
											</select>
										</div>
									);
								})}
							</div>
						</div>

						<div style={{ marginTop: 12 }}>
							{templateCombo ? (
								templateCombo.ok ? (
									<div className="seo-combo-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
										<div style={{ fontWeight: 900 }}>1.</div>
										<div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
											<div className="seo-combo-text">{templateCombo.name}</div>
											{(() => {
												const st = comboStats(templateCombo.tokens);
												if (!st) return null;
												return (
													<div style={{ fontSize: 11, fontWeight: 900, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
														검색합 {st.totalSearch != null ? st.totalSearch.toLocaleString() : '-'} · 빈도합 {st.totalFreq.toLocaleString()} · 평균CTR{' '}
														{st.avgCtr != null ? `${st.avgCtr.toFixed(2)}%` : '-'} · 총점 {st.totalScore != null ? st.totalScore : '-'}
														{st.missingTokenCount > 0 ? ` · 미집계 ${st.missingTokenCount}` : ''}
													</div>
												);
											})()}
										</div>
										<div style={{ fontSize: 11, fontWeight: 900, color: '#9ca3af', whiteSpace: 'nowrap' }}>{templateCombo.name.length}/25</div>
										<button
											type="button"
											className="btn-ghost"
											aria-label="조합 저장"
											onClick={() => saveTemplateCombo()}
											style={{
												whiteSpace: 'nowrap',
												minWidth: 56,
												padding: '6px 10px',
												display: 'inline-flex',
												justifyContent: 'center',
												fontWeight: 900,
												color: '#bbf7d0',
												background: 'rgba(34,197,94,0.10)',
												border: '1px solid rgba(148,163,184,0.22)',
												borderRadius: 10,
											}}
										>
											저장
										</button>
										<button
											type="button"
											className="btn-ghost"
											aria-label="조합 복사"
											onClick={() => copyText(templateCombo.name)}
											style={{ whiteSpace: 'nowrap', minWidth: 56, padding: '6px 10px', display: 'inline-flex', justifyContent: 'center' }}
										>
											복사
										</button>
									</div>
								) : (
									<div style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5' }}>{templateCombo.reason}</div>
								)
							) : null}
						</div>

						{savedCombosOpen || (savedCombos || []).length > 0 ? (
							<div data-testid="saved-combos" style={{ marginTop: 14 }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
									<div style={{ fontWeight: 900 }}>저장된 조합(최종 검토)</div>
									<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
										<div style={{ fontSize: 12, fontWeight: 900, color: '#9ca3af' }}>총 {(savedCombos || []).length}개</div>
										<button
											type="button"
											className="btn-ghost"
											onClick={() => setSavedCombosOpen((v) => !v)}
											aria-label={savedCombosOpen ? '저장된 조합 접기' : '저장된 조합 펼치기'}
											style={{ whiteSpace: 'nowrap' }}
										>
											{savedCombosOpen ? '접기' : '펼치기'}
										</button>
										<button
											type="button"
											className="btn-ghost"
											onClick={() => setSavedCombos([])}
											aria-label="저장된 조합 전체 삭제"
											style={{ whiteSpace: 'nowrap' }}
										>
											전체 삭제
										</button>
									</div>
								</div>

								{savedCombosOpen ? (
									<div className="seo-combo-list" style={{ marginTop: 10 }}>
										{(savedCombos || []).length === 0 ? (
											<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 800 }}>아직 저장된 조합이 없습니다.</div>
										) : (
											(savedCombos || []).slice(0, 100).map((c, idx) => (
												<div key={c.id} className="seo-combo-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
													<div style={{ fontWeight: 900 }}>{idx + 1}.</div>
													<div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
														<div className="seo-combo-text">{c.name}</div>
														{c.stats ? (
															<div style={{ fontSize: 11, fontWeight: 900, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
																검색합 {c.stats.totalSearch != null ? c.stats.totalSearch.toLocaleString() : '-'} · 빈도합 {c.stats.totalFreq.toLocaleString()} · 평균CTR{' '}
																{c.stats.avgCtr != null ? `${c.stats.avgCtr.toFixed(2)}%` : '-'} · 총점 {c.stats.totalScore != null ? c.stats.totalScore : '-'}
																{c.stats.missingTokenCount > 0 ? ` · 미집계 ${c.stats.missingTokenCount}` : ''}
															</div>
														) : null}
													</div>
													<div style={{ fontSize: 11, fontWeight: 900, color: '#9ca3af', whiteSpace: 'nowrap' }}>{c.name.length}/25</div>
													<button
														type="button"
														className="btn-ghost"
														onClick={() => copyText(c.name)}
														aria-label={`저장 조합 복사: ${c.name}`}
														style={{ whiteSpace: 'nowrap', minWidth: 56, padding: '6px 10px', display: 'inline-flex', justifyContent: 'center' }}
													>
														복사
													</button>
													<button
														type="button"
														className="btn-ghost"
														onClick={() => setSavedCombos((prev) => (prev || []).filter((x) => x.id !== c.id))}
														aria-label={`저장 조합 삭제: ${c.name}`}
														style={{ whiteSpace: 'nowrap', minWidth: 56, padding: '6px 10px', display: 'inline-flex', justifyContent: 'center', color: '#fca5a5' }}
													>
														삭제
													</button>
												</div>
											))
										)}
									</div>
								) : null}
							</div>
						) : null}
					</div>

					<div className="card">
						<div className="card-title">추천 조합(실시간)</div>
						<div className="card-caption">
							자동 추천을 중단하고, 사용자가 선택한 단어만으로 조합을 생성합니다. (정렬: 검색량&gt;빈도&gt;CTR, 최대 {result.constraints?.maxTokensTotal ?? 8} 토큰)
						</div>
						<div className="seo-combo-list">
							{(() => {
								if (selectedTokensSorted.length === 0) {
									return (
										<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 800 }}>
											위 표에서 단어를 선택하면 실시간으로 조합을 생성합니다.
										</div>
									);
								}
								const combos = buildLiveCombos({
									productName: productName.trim(),
									mainKeyword: mainKeyword.trim(),
									selectedTokens: selectedTokensSorted,
									tokenMetrics,
									maxTokensTotal: result.constraints?.maxTokensTotal ?? 8,
									maxChars: 25,
									rules: seoRules,
									comboCount: 10,
								});
								return combos.map((c, i) => (
									<div key={c.name} className="seo-combo-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
										<div style={{ fontWeight: 900 }}>{i + 1}.</div>
										<div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
											<div className="seo-combo-text">{c.name}</div>
											{(() => {
												const st = comboStats(c.tokens);
												if (!st) return null;
												return (
													<div style={{ fontSize: 11, fontWeight: 900, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
														검색합 {st.totalSearch != null ? st.totalSearch.toLocaleString() : '-'} · 빈도합 {st.totalFreq.toLocaleString()} · 평균CTR{' '}
														{st.avgCtr != null ? `${st.avgCtr.toFixed(2)}%` : '-'} · 총점 {st.totalScore != null ? st.totalScore : '-'}
														{st.missingTokenCount > 0 ? ` · 미집계 ${st.missingTokenCount}` : ''}
													</div>
												);
											})()}
										</div>
										<div style={{ fontSize: 11, fontWeight: 900, color: '#9ca3af', whiteSpace: 'nowrap' }}>{c.name.length}/25</div>
										<button
											type="button"
											className="btn-ghost"
											onClick={() => copyText(c.name)}
											style={{ whiteSpace: 'nowrap', minWidth: 56, padding: '6px 10px', display: 'inline-flex', justifyContent: 'center' }}
										>
											복사
										</button>
									</div>
								));
							})()}
						</div>
					</div>
				</>
			) : null}

			{/* 카테고리는 수동 선택 + 저장 사전(자동완성) 기반으로 통일 */}
		</div>
	);
}


