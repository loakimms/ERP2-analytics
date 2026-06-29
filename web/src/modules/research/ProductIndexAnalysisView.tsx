import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { computeProductIndexTrend, type ProductIndexHistoryDetailedItem as TrendItem, PRODUCT_INDEX_WEIGHTS } from './productIndexHistory';

type TrackedKeywordRow = {
	id: number;
	product_url: string | null;
	keyword: string;
	is_active: boolean;
};

type PageMetricsRow = {
	product_url: string;
	title?: string | null;
	image_url?: string | null;
};

type ProductIndexScores = {
	click: number;
	sales: number;
	review: number;
	recency: number;
	penalty: number;
	final: number;
};

type ProductIndexDeltas = Partial<Record<keyof ProductIndexScores, number | null>>;

type ProductIndexAnalyzeResponse = {
	product_url: string;
	date: string;
	title?: string | null;
	image_url?: string | null;
	scores: ProductIndexScores;
	deltas: ProductIndexDeltas;
	inputs: any;
	explain?: any;
};

type ProductIndexHistoryItem = { date: string; scores: ProductIndexScores };

type ProductIndexHistoryResponse = {
	product_url: string;
	items: ProductIndexHistoryItem[];
};

type ProductIndexHistoryDetailedResponse = {
	product_url: string;
	items: TrendItem[];
};

type ProductIndexRankPredictionItem = {
	date: string;
	score_final?: number | null;
	delta_score_final?: number | null;
	best_rank?: number | null;
	delta_best_rank?: number | null;
	benchmark_best_rank?: number | null;
	gap_best_rank?: number | null;
	weighted_rank?: number | null;
	delta_weighted_rank?: number | null;
	benchmark_weighted_rank?: number | null;
	gap_weighted_rank?: number | null;
	signal?: string;
	accel?: number | null;
};

type ProductIndexRankPredictionResponse = {
	product_url: string;
	days: number;
	benchmark_product_url?: string | null;
	items: ProductIndexRankPredictionItem[];
};

type ProductIndexBatchRunResponse = {
	date: string;
	status: string;
	total_targets: number;
	analyzed: number;
	failed: number;
	detail?: string | null;
};

type ProductIndexBackfillResponse = {
	date_from: string;
	date_to: string;
	days: number;
	total_targets: number;
	analyzed: number;
	failed: number;
	detail?: string | null;
};

type ProductIndexCoverageResponse = {
	product_url: string;
	date_from: string;
	date_to: string;
	score_days_count: number;
	page_days_count: number;
	missing_score_days: string[];
	missing_page_days: string[];
};

type ProductIndexLatestBatchItem = {
	requested_url: string;
	product_url: string;
	date?: string | null;
	scores?: ProductIndexScores | null;
	deltas?: ProductIndexDeltas | null;
	signal?: string | null;
};

function cleanupProductTitle(raw: string): string {
	const t = String(raw || '').trim();
	if (!t) return '';
	// 일부 데이터 소스에서 "상품명:상점명" 형태로 뒤에 상점명이 붙는 케이스가 있어,
	// 리스트에서는 상점명 suffix만 제거한다.
	// (주의) 상품명에 콜론이 실제로 포함될 수도 있어, "끝에 한 번만" 붙는 경우만 제한적으로 처리.
	const m = /^(.*?)(?:\s*:\s*[^:\n]{1,30})$/.exec(t);
	if (!m) return t;
	const left = String(m[1] || '').trim();
	if (left.length < 4) return t;
	return left;
}

function signalKorean(sig: string | null | undefined): string {
	const s = String(sig || '').toUpperCase();
	if (s === 'GOLDEN') return '상승신호';
	if (s === 'DEAD') return '하락경고';
	if (s === 'TRAP') return '정체';
	if (s === 'MIXED') return '혼재';
	return '데이터부족';
}

function statusStyleForSignalKR(label: string): { fg: string; bg: string; bd: string; bar: string } {
	if (label === '상승신호') return { fg: '#052e16', bg: 'rgba(134,239,172,0.95)', bd: 'rgba(34,197,94,0.60)', bar: 'rgba(34,197,94,0.70)' };
	if (label === '하락경고') return { fg: '#450a0a', bg: 'rgba(253,164,175,0.95)', bd: 'rgba(244,63,94,0.60)', bar: 'rgba(244,63,94,0.70)' };
	if (label === '정체') return { fg: '#0f172a', bg: 'rgba(226,232,240,0.92)', bd: 'rgba(148,163,184,0.55)', bar: 'rgba(148,163,184,0.65)' };
	if (label === '혼재') return { fg: '#0f172a', bg: 'rgba(147,197,253,0.92)', bd: 'rgba(59,130,246,0.45)', bar: 'rgba(59,130,246,0.60)' };
	return { fg: '#0f172a', bg: 'rgba(203,213,225,0.88)', bd: 'rgba(148,163,184,0.35)', bar: 'rgba(100,116,139,0.55)' };
}

function signalOrderKR(s: string): number {
	if (s === '하락경고') return 0;
	if (s === '혼재') return 1;
	if (s === '정체') return 2;
	if (s === '상승신호') return 3;
	return 9; // 데이터부족
}

function renderSignalPill(label: string, count: number): JSX.Element {
	const s = statusStyleForSignalKR(label);
	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 6,
				fontSize: 12,
				fontWeight: 950,
				padding: '2px 10px',
				borderRadius: 999,
				color: s.fg,
				background: s.bg,
				border: `1px solid ${s.bd}`,
				whiteSpace: 'nowrap',
			}}
			title="최근 신호 분포(상품별)"
		>
			{label} <span style={{ fontWeight: 950, opacity: 0.85 }}>{count}</span>
		</span>
	);
}

function renderSignalStackBar(counts: Record<string, number>): JSX.Element | null {
	const keys = Object.keys(counts);
	const total = keys.reduce((acc, k) => acc + Math.max(0, Number(counts[k] ?? 0)), 0);
	if (!total) return null;
	const segs = keys
		.map((k) => ({ label: k, v: Math.max(0, Number(counts[k] ?? 0)), style: statusStyleForSignalKR(k) }))
		.filter((x) => x.v > 0)
		.sort((a, b) => signalOrderKR(a.label) - signalOrderKR(b.label));

	return (
		<div
			style={{
				height: 10,
				display: 'flex',
				borderRadius: 999,
				overflow: 'hidden',
				border: '1px solid rgba(148,163,184,0.18)',
				background: 'rgba(15,23,42,0.35)',
			}}
			title="신호 분포(좌→우)"
			data-testid="pi-signal-bar"
		>
			{segs.map((s) => {
				const w = total > 0 ? (s.v / total) * 100 : 0;
				return (
					<div
						key={s.label}
						data-testid={`pi-signal-bar-${s.label}`}
						style={{ width: `${w}%`, background: s.style.bar }}
						title={`${s.label}: ${s.v}`}
					/>
				);
			})}
		</div>
	);
}

function signalRuleExplain(sig: string | null | undefined): string {
	const s = String(sig || '').toUpperCase();
	if (s === 'GOLDEN') return '전일 대비 인기종합 점수가 상승(+Δ)했습니다.';
	if (s === 'TRAP') return '전일 대비 인기종합 점수 변화가 없습니다(0Δ).';
	if (s === 'DEAD') return '전일 대비 인기종합 점수가 하락(-Δ)해 경고로 분류됩니다.';
	if (s === 'MIXED') return '구버전 신호입니다. 오늘 분석을 다시 저장하면 전일 대비 1일 기준으로 갱신됩니다.';
	return '오늘/전일 스냅샷 또는 광고·판매·리뷰·등록일 등 필수 입력 데이터가 하루라도 부족합니다.';
}

function formatDriversCompact(drivers: Array<{ label?: string; deltaWeighted?: number | null }> | null | undefined): string {
	const arr = Array.isArray(drivers) ? drivers : [];
	if (!arr.length) return '-';
	return arr
		.slice(0, 2)
		.map((d) => {
			const label = String(d?.label || '').trim() || '-';
			const v = d?.deltaWeighted;
			const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
			const s = n == null ? '-' : n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
			return `${label}(${s})`;
		})
		.join(' · ');
}

function recommendActionsForSignal(params: {
	signalRaw: string;
	drivers: Array<{ label?: string; deltaWeighted?: number | null }> | null;
	sources: Record<string, string>;
}): string[] {
	const signalRaw = String(params.signalRaw || '').toUpperCase();
	const drivers = Array.isArray(params.drivers) ? params.drivers : [];
	const sources = params.sources || {};
	const actions: string[] = [];

	// 공통(데이터/신뢰도)
	if (!sources.sales_30d || sources.sales_30d === 'none') {
		actions.push('판매(30일) 데이터가 비어있으면 신호가 흔들립니다. 구매키워드 업로드 또는 수기 입력으로 sales_30d를 먼저 채우세요.');
	}
	if (!sources.sales_7d || sources.sales_7d === 'none') {
		actions.push('최근 7일 판매(sales_7d)가 없으면 판매 항목 변동 해석이 어렵습니다. 필요 시 override를 보강하세요.');
	}
	if (!sources.weekly_views_7d || sources.weekly_views_7d === 'none') {
		actions.push('조회/클릭 Proxy 입력이 없으면 클릭 항목 변동이 왜곡될 수 있습니다. 자동값이 없으면 수기 보강하세요.');
	}

	// 드라이버 기반(원인 → 액션)
	const hasSales = drivers.some((d) => String(d.label || '').includes('판매'));
	const hasClick = drivers.some((d) => String(d.label || '').includes('클릭'));
	const hasReview = drivers.some((d) => String(d.label || '').includes('리뷰'));

	if (hasSales) actions.push('판매가 원인이라면: 가격/재고/배송/리뷰/쿠폰/노출 키워드(광고·구매 키워드)부터 점검하세요.');
	if (hasClick) actions.push('클릭이 원인이라면: 광고 소재/CTR(카테고리 평균 대비)/유입 키워드를 먼저 점검하고, 대표 썸네일·타이틀도 함께 점검하세요.');
	if (hasReview) actions.push('리뷰가 원인이라면: 평점/리뷰 수 변화가 있는지 확인하고, 최근 부정 리뷰 대응/CS/품질 이슈를 우선 처리하세요.');

	// 신호별(현상 → 다음 단계)
	if (signalRaw === 'DEAD') {
		actions.unshift('하락경고: 오늘-내일은 “방어 모드”로 운영(광고/재고/가격/쿠폰 즉시 점검)하고, 하락 원인 1~2개를 먼저 고정하세요.');
	} else if (signalRaw === 'MIXED') {
		actions.unshift('혼재: 원인이 하루 단위로 바뀌고 있습니다. “최근 점수 추이”에서 오늘/어제 drivers를 비교해 가장 큰 축(판매/클릭/리뷰)을 1개로 좁혀 안정화하세요.');
	} else if (signalRaw === 'TRAP') {
		actions.unshift('정체: 점수/순위가 멈춰 있습니다. 클릭(CTR) 개선 또는 판매(전환) 개선 중 하나를 목표로 실험(소재/키워드/가격)을 하세요.');
	} else if (signalRaw === 'GOLDEN') {
		actions.unshift('상승신호: 상승 원인이 “판매/클릭/리뷰” 중 어디인지 확인하고, 잘 먹히는 축을 그대로 증폭(예산/소재/키워드 확장)하세요.');
	} else {
		actions.unshift('데이터부족: 오늘/전일 분석 스냅샷과 광고·판매·리뷰·등록일 입력을 먼저 채운 뒤 신호를 해석하세요.');
	}

	// 너무 길면 상위 5개만
	return actions.filter(Boolean).slice(0, 5);
}

type ProductIndexManual = {
	product_url: string;
	weekly_views_7d?: number | null;
	wishes?: number | null;
	sales_7d_override?: number | null;
	sales_30d?: number | null;
	days_since_reg?: number | null;
};

type ProductIndexSuggestedInputs = {
	product_url: string;
	date_to: string;
	date_from_7d: string;
	date_from_30d: string;
	weekly_views_7d?: number | null;
	wishes?: number | null;
	days_since_reg?: number | null;
	sales_7d?: number | null;
	sales_30d?: number | null;
	matched_rows_30d: number;
	source: string;
	sources?: Record<string, string>;
};

function deltaText(v: number | null | undefined): string {
	if (v == null) return '';
	if (v === 0) return '(±0)';
	return v > 0 ? `(+${v})` : `(${v})`;
}

function deltaColor(v: number | null | undefined): string {
	if (v == null) return '#94a3b8';
	if (v > 0) return '#86efac';
	if (v < 0) return '#fda4af';
	return '#e2e8f0';
}

function toInt(v: string): number {
	if (v.trim() === '') return 0;
	const n = Number(v);
	return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseNonNegativeInt(raw: string): number {
	const digits = String(raw || '').replace(/[^\d]/g, '');
	if (!digits) return 0;
	// "000123" -> "123", 단 "0"은 유지
	const normalized = digits.replace(/^0+(?=\d)/, '');
	const n = Number(normalized);
	return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function displayNullableInt(v: unknown): string {
	if (v == null) return '';
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isFinite(n)) return '';
	return String(Math.max(0, Math.trunc(n)));
}

function updateManualIntField(
	setManual: React.Dispatch<React.SetStateAction<ProductIndexManual | null>>,
	selectedUrl: string,
	key: keyof ProductIndexManual,
	raw: string,
): void {
	const trimmed = String(raw ?? '').trim();
	if (trimmed === '') {
		setManual((p) => ({ ...(p || { product_url: selectedUrl }), [key]: null }));
		return;
	}
	const val = parseNonNegativeInt(trimmed);
	setManual((p) => ({ ...(p || { product_url: selectedUrl }), [key]: val }));
}

export function ProductIndexAnalysisView(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	// (레이아웃) 사이드바/패딩 때문에 "윈도우 폭"과 실제 컨텐츠 폭이 달라
	// 2컬럼이 겹치는 현상이 발생할 수 있다.
	// 따라서 "컨텐츠 컨테이너 폭"을 기준으로 1/2 컬럼을 자동 전환한다.
	const layoutRef = useRef<HTMLDivElement | null>(null);
	const [isTwoCol, setIsTwoCol] = useState<boolean>(true);
	useEffect(() => {
		try {
			const el = layoutRef.current;
			if (!el) return;
			const compute = () => {
				const w = Math.max(0, Math.trunc(el.getBoundingClientRect().width || 0));
				// 좌측 최소 360px + gap + 우측 최소 640px 정도는 되어야 "겹침 없이" 2컬럼이 유지된다.
				setIsTwoCol(w >= 1040);
			};

			compute();

			const ro = typeof (window as any).ResizeObserver === 'function' ? new (window as any).ResizeObserver(compute) : null;
			if (ro) ro.observe(el);
			window.addEventListener('resize', compute);
			return () => {
				try {
					if (ro) ro.disconnect();
					window.removeEventListener('resize', compute);
				} catch {
					// ignore
				}
			};
		} catch {
			return;
		}
	}, []);

	const [tracked, setTracked] = useState<TrackedKeywordRow[]>([]);
	const productUrls = useMemo(() => {
		const s = new Set<string>();
		for (const r of tracked) {
			const u = String(r.product_url || '').trim();
			if (u) s.add(u);
		}
		return Array.from(s.values());
	}, [tracked]);

	const [pageMeta, setPageMeta] = useState<Record<string, PageMetricsRow>>({});
	const [latestByUrl, setLatestByUrl] = useState<Record<string, ProductIndexLatestBatchItem>>({});
	const refreshLatestBatch = async (urls: string[]) => {
		const list = Array.isArray(urls) ? urls.map((u) => String(u || '').trim()).filter(Boolean) : [];
		if (!list.length) return;
		try {
			const res = await axios.post<ProductIndexLatestBatchItem[]>(`${apiBaseUrl}/search-rank/product-index/latest/batch`, { urls: list });
			const m: Record<string, ProductIndexLatestBatchItem> = {};
			const arr = Array.isArray(res.data) ? res.data : [];
			for (const it of arr) {
				const req = String((it as any).requested_url || '').trim();
				const canon = String((it as any).product_url || '').trim();
				if (req) m[req] = it;
				if (canon) m[canon] = it;
			}
			setLatestByUrl(m);
		} catch {
			// best-effort (표시만 깨지지 않게)
		}
	};

	const [selectedUrl, setSelectedUrl] = useState<string>('');
	const [analyzed, setAnalyzed] = useState<ProductIndexAnalyzeResponse | null>(null);
	const [showEvidence, setShowEvidence] = useState(false);
	const [history, setHistory] = useState<TrendItem[]>([]);
	const [trendDays, setTrendDays] = useState<number>(30); // 그래프/표 표시 범위
	const [trendDetailed, setTrendDetailed] = useState<boolean>(false);

	const [manual, setManual] = useState<ProductIndexManual | null>(null);
	const [manualSaving, setManualSaving] = useState(false);
	const [batchRunning, setBatchRunning] = useState(false);
	const [backfillRunning, setBackfillRunning] = useState(false);
	const [suggested, setSuggested] = useState<ProductIndexSuggestedInputs | null>(null);
	const [rankPred, setRankPred] = useState<ProductIndexRankPredictionResponse | null>(null);
	const [benchmarkUrl, setBenchmarkUrl] = useState<string>('');
	const [coverage, setCoverage] = useState<ProductIndexCoverageResponse | null>(null);
	const [showFormulas, setShowFormulas] = useState(false);

	useEffect(() => {
		if (!toast) return;
		const t = window.setTimeout(() => setToast(null), 1800);
		return () => window.clearTimeout(t);
	}, [toast]);

	useEffect(() => {
		const load = async () => {
			setLoading(true);
			setError(null);
			try {
				const res = await axios.get<TrackedKeywordRow[]>(`${apiBaseUrl}/search-rank/tracked`);
				setTracked(res.data || []);
			} catch (e: any) {
				setError(String(e?.response?.data?.detail ?? e?.message ?? '내 상품 추적 목록 로딩 실패'));
			} finally {
				setLoading(false);
			}
		};
		void load();
	}, [apiBaseUrl]);

	useEffect(() => {
		if (!productUrls.length) return;
		const loadMeta = async () => {
			try {
				const res = await axios.post<PageMetricsRow[]>(`${apiBaseUrl}/search-rank/page-metrics/batch`, { urls: productUrls });
				const m: Record<string, PageMetricsRow> = {};
				for (const r of res.data || []) {
					const u = String((r as any).product_url || '').trim();
					if (!u) continue;
					m[u] = { product_url: u, title: (r as any).title, image_url: (r as any).image_url };
				}
				setPageMeta(m);
			} catch {
				// 메타는 best-effort
			}
		};
		void loadMeta();
	}, [apiBaseUrl, productUrls]);

	useEffect(() => {
		if (!productUrls.length) return;
		void refreshLatestBatch(productUrls);
	}, [apiBaseUrl, productUrls]);

	const loadManual = async (u: string) => {
		try {
			const res = await axios.get<ProductIndexManual>(`${apiBaseUrl}/search-rank/product-index-manual`, { params: { product_url: u } });
			const m = res.data || { product_url: u };
			// 방어적 정규화: 문자열로 저장된 케이스(예: "04136")가 있어도 UI에서는 숫자 형태로만 보여준다.
			setManual({
				product_url: u,
				weekly_views_7d: m.weekly_views_7d == null ? null : parseNonNegativeInt(String(m.weekly_views_7d)),
				wishes: m.wishes == null ? null : parseNonNegativeInt(String(m.wishes)),
				sales_7d_override: m.sales_7d_override == null ? null : parseNonNegativeInt(String(m.sales_7d_override)),
				sales_30d: m.sales_30d == null ? null : parseNonNegativeInt(String(m.sales_30d)),
				days_since_reg: m.days_since_reg == null ? null : parseNonNegativeInt(String(m.days_since_reg)),
			});
		} catch {
			setManual({ product_url: u });
		}
	};

	const loadSuggested = async (u: string) => {
		try {
			const res = await axios.get<ProductIndexSuggestedInputs>(`${apiBaseUrl}/search-rank/product-index/suggested-inputs`, { params: { product_url: u } });
			setSuggested(res.data || null);
		} catch {
			setSuggested(null);
		}
	};

	const loadHistory = async (u: string) => {
		try {
			const res = await axios.get<ProductIndexHistoryDetailedResponse>(`${apiBaseUrl}/search-rank/product-index/history-detailed`, { params: { product_url: u, days: 365 } });
			setHistory(res.data?.items || []);
		} catch {
			setHistory([]);
		}
	};

	const loadRankPrediction = async (u: string, bench?: string) => {
		try {
			const res = await axios.get<ProductIndexRankPredictionResponse>(`${apiBaseUrl}/search-rank/product-index/rank-prediction`, {
				params: { product_url: u, days: 30, benchmark_product_url: (bench || '').trim() || undefined },
			});
			setRankPred(res.data || null);
		} catch {
			setRankPred(null);
		}
	};

	const loadCoverage = async (u: string) => {
		try {
			const res = await axios.get<ProductIndexCoverageResponse>(`${apiBaseUrl}/search-rank/product-index/coverage`, {
				params: { product_url: u, days: 14 },
			});
			setCoverage(res.data || null);
		} catch {
			setCoverage(null);
		}
	};

	const loadLatest = async (u: string) => {
		try {
			const res = await axios.get<ProductIndexAnalyzeResponse>(`${apiBaseUrl}/search-rank/product-index/latest`, { params: { product_url: u } });
			setAnalyzed(res.data || null);
			setShowEvidence(false);
		} catch {
			// 저장된 분석이 없으면 조용히 비움(사용자가 "분석"을 실행하면 됨)
			setAnalyzed(null);
		}
	};

	const analyze = async (u: string) => {
		if (!u) return;
		setLoading(true);
		setError(null);
		try {
			const res = await axios.post<ProductIndexAnalyzeResponse>(`${apiBaseUrl}/search-rank/product-index/analyze`, { product_url: u });
			setAnalyzed(res.data || null);
			setShowEvidence(false);
			void loadHistory(u);
			// (중요) 오늘 분석 저장 후, 좌측 리스트의 "최신 점수/등락"도 즉시 갱신되어야 한다.
			// 그렇지 않으면 최신 리스트가 어제 데이터(하루 전 Δ)를 계속 보여 혼동이 발생한다.
			void refreshLatestBatch(productUrls);
			// IMPORTANT: 같은 날짜의 점수와 예측표가 다르게 보이는 문제를 막기 위해,
			// 분석 저장 후 예측표도 즉시 재로딩한다.
			void loadRankPrediction(u, benchmarkUrl);
			void loadCoverage(u);
			setToast('상품지수 분석 저장 완료');
		} catch (e: any) {
			setError(String(e?.response?.data?.detail ?? e?.message ?? '상품지수 분석 실패'));
			setAnalyzed(null);
		} finally {
			setLoading(false);
		}
	};

	const onSelect = async (u: string) => {
		setSelectedUrl(u);
		setAnalyzed(null); // 즉시 비우고, 최신 저장값을 로드
		setShowEvidence(false);
		setHistory([]);
		setSuggested(null);
		setRankPred(null);
		setBenchmarkUrl('');
		setCoverage(null);
		setShowFormulas(false);
		await loadManual(u);
		void loadLatest(u);
		void loadSuggested(u);
		void loadHistory(u);
		void loadRankPrediction(u);
		void loadCoverage(u);
	};

	const saveManual = async () => {
		if (!manual?.product_url) return;
		setManualSaving(true);
		setError(null);
		try {
			await axios.put(`${apiBaseUrl}/search-rank/product-index-manual`, manual);
			await analyze(manual.product_url);
		} catch (e: any) {
			setError(String(e?.response?.data?.detail ?? e?.message ?? '수기 입력 저장 실패'));
		} finally {
			setManualSaving(false);
		}
	};

	const applySuggested = () => {
		if (!selectedUrl || !suggested) return;
		setManual((p) => {
			const cur = p || { product_url: selectedUrl };
			return {
				...cur,
				weekly_views_7d: cur.weekly_views_7d == null ? (suggested.weekly_views_7d ?? null) : cur.weekly_views_7d,
				wishes: cur.wishes == null ? (suggested.wishes ?? null) : cur.wishes,
				sales_7d_override: cur.sales_7d_override == null ? (suggested.sales_7d ?? null) : cur.sales_7d_override,
				sales_30d: cur.sales_30d == null ? (suggested.sales_30d ?? null) : cur.sales_30d,
				days_since_reg: cur.days_since_reg == null ? (suggested.days_since_reg ?? null) : cur.days_since_reg,
			};
		});
		setToast('자동값을 수기 입력 칸에 채웠습니다(빈 칸만).');
	};

	const runBatchToday = async () => {
		if (batchRunning) return;
		setBatchRunning(true);
		setError(null);
		try {
			const res = await axios.post<ProductIndexBatchRunResponse>(`${apiBaseUrl}/search-rank/product-index/analyze-today-batch`, {});
			const d = res.data;
			setToast(`오늘 분석 저장: ${d.analyzed}/${d.total_targets} (실패 ${d.failed})`);
			void refreshLatestBatch(productUrls);
		} catch (e: any) {
			setError(String(e?.response?.data?.detail ?? e?.message ?? '오늘 전체 분석 저장 실패'));
		} finally {
			setBatchRunning(false);
		}
	};

	const runBackfill14d = async () => {
		if (backfillRunning) return;
		setBackfillRunning(true);
		setError(null);
		try {
			const res = await axios.post<ProductIndexBackfillResponse>(`${apiBaseUrl}/search-rank/product-index/backfill-batch`, {
				days: 14,
				product_url: selectedUrl || undefined,
			});
			const d = res.data;
			setToast(`최근 ${d.days}일 점수 채움: ${d.analyzed}건 (실패 ${d.failed})`);
			void refreshLatestBatch(productUrls);
			if (selectedUrl) {
				void loadLatest(selectedUrl);
				void loadHistory(selectedUrl);
				void loadRankPrediction(selectedUrl, benchmarkUrl);
				void loadCoverage(selectedUrl);
			}
		} catch (e: any) {
			setError(String(e?.response?.data?.detail ?? e?.message ?? '최근 14일 점수 채우기 실패'));
		} finally {
			setBackfillRunning(false);
		}
	};

	const rows = useMemo(() => {
		return productUrls.map((u) => {
			const m = pageMeta[u];
			const titleRaw = (m?.title || '').trim();
			const title = cleanupProductTitle(titleRaw);
			return { url: u, title: title || titleRaw || u };
		});
	}, [productUrls, pageMeta]);

	const signalCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const r of rows) {
			const latest = latestByUrl[r.url];
			const label = signalKorean(latest?.signal ?? null);
			counts[label] = (counts[label] ?? 0) + 1;
		}
		// 표시 순서 고정(없으면 0도 넣어 UI가 "통일"되게)
		for (const k of ['상승신호', '혼재', '정체', '하락경고', '데이터부족']) {
			if (counts[k] == null) counts[k] = 0;
		}
		return counts;
	}, [rows, latestByUrl]);

	const trendRows = useMemo(() => computeProductIndexTrend(history), [history]);
	const trendRowsWindow = useMemo(() => {
		if (!trendRows.length) return [];
		return trendRows.slice(Math.max(0, trendRows.length - Math.max(1, trendDays)));
	}, [trendDays, trendRows]);

	const chartPoints = useMemo(() => {
		const rows0 = trendRowsWindow;
		if (!rows0.length) return [];
		return rows0.map((r, idx) => ({ idx, date: r.date, score: r.scores.final }));
	}, [trendRowsWindow]);

	function renderMiniLineChart(): JSX.Element | null {
		const pts = chartPoints;
		if (pts.length < 2) return null;
		const w = 760;
		const h = 180;
		const padX = 44; // y축 라벨 공간
		const padY = 22; // x축 라벨 공간
		const min = 0;
		const max = 100;
		const span = 100;
		const xStep = (w - padX * 2) / Math.max(1, pts.length - 1);
		const y = (score: number) => padY + (h - padY * 2) * (1 - Math.max(0, Math.min(100, score)) / span);
		const x = (i: number) => padX + xStep * i;

		const d = pts
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.score).toFixed(2)}`)
			.join(' ');

		const dateLabel = (iso: string) => {
			// "2026-01-31" -> "01/31"
			const s = String(iso || '');
			const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
			return m ? `${m[2]}/${m[3]}` : s;
		};
		// 날짜 라벨은 너무 빽빽해지므로 간격을 둔다(최소 7개 정도 보이도록)
		const labelEvery = Math.max(1, Math.ceil(pts.length / 7));
		const gridYs = [0, 25, 50, 75, 100];

		return (
			<div className="card" style={{ marginTop: 10, padding: 12 }}>
				<div className="card-title">인기종합 점수 그래프</div>
				<div style={{ marginTop: 8, overflowX: 'auto' }}>
					<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
						{/* 가이드라인(0~100) */}
						{gridYs.map((v) => (
							<g key={v}>
								<line
									x1={padX}
									x2={w - padX}
									y1={y(v)}
									y2={y(v)}
									stroke="rgba(148,163,184,0.18)"
									strokeDasharray={v === 0 || v === 100 ? undefined : '4 4'}
								/>
								<text x={padX - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fontWeight="800" fill="rgba(148,163,184,0.95)">
									{v}
								</text>
							</g>
						))}

						{/* 축 */}
						<line x1={padX} x2={padX} y1={padY} y2={h - padY} stroke="rgba(148,163,184,0.35)" />
						<line x1={padX} x2={w - padX} y1={h - padY} y2={h - padY} stroke="rgba(148,163,184,0.35)" />

						<path d={d} fill="none" stroke="rgba(34,197,94,0.95)" strokeWidth={2.2} />
						{pts.map((p, i) => (
							<g key={p.date}>
								<circle cx={x(i)} cy={y(p.score)} r={3.2} fill="rgba(226,232,240,0.95)">
									<title>
										{p.date} · {p.score}점
									</title>
								</circle>
								<text
									x={x(i)}
									y={Math.max(10, y(p.score) - 10)}
									textAnchor="middle"
									fontSize="11"
									fontWeight="900"
									fill="rgba(226,232,240,0.95)"
								>
									{p.score}
								</text>
								{i % labelEvery === 0 || i === pts.length - 1 ? (
									<text
										x={x(i)}
										y={h - 6}
										textAnchor="middle"
										fontSize="10"
										fontWeight="800"
										fill="rgba(148,163,184,0.95)"
									>
										{dateLabel(p.date)}
									</text>
								) : null}
							</g>
						))}
					</svg>
				</div>
				<div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
					0~100점 기준 (최근 {pts.length}일)
				</div>
			</div>
		);
	}

	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<div className="card">
				<div className="card-title">상품지수분석 (5-3)</div>
				<div className="card-caption">
					내 상품 추적에 등록된 상품을 선택한 뒤 “상품지수 분석”을 실행하면, 항목별 점수와 전일 대비 변화(Δ)를 보여줍니다. 분석 결과는 매일 저장됩니다.
				</div>
				<div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
					<button type="button" className="btn-ghost" onClick={() => void runBatchToday()} disabled={batchRunning}>
						{batchRunning ? '저장 중…' : '오늘 전체 분석 저장'}
					</button>
					<button type="button" className="btn-ghost" onClick={() => void runBackfill14d()} disabled={backfillRunning} title="선택된 상품이 있으면 해당 상품만, 없으면 내 상품 전체를 최근 14일치로 채웁니다.">
						{backfillRunning ? '채우는 중…' : '최근 14일 점수 채우기'}
					</button>
					{toast ? <span style={{ fontSize: 12, fontWeight: 900, color: '#bbf7d0' }}>{toast}</span> : null}
				</div>
				{error ? <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: '#fda4af' }}>{error}</div> : null}
			</div>

			{/* (상단) 내 상품 목록 + 평가점수/현재상황 (겹침 방지: 컨테이너 폭 기반 1/2컬럼 자동 전환) */}
			<div
				ref={layoutRef}
				style={{
					display: 'grid',
					gridTemplateColumns: isTwoCol ? 'minmax(360px, 520px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
					gap: 12,
					alignItems: 'start',
				}}
			>
				<div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
					<div
						className="card"
						style={{
							padding: 12,
							// (요청) 우측 '현재 상황'과 높이를 맞추기 위해,
							// 2컬럼일 때는 좌측 리스트를 고정 높이로 두고 내부 스크롤을 사용한다.
							height: isTwoCol ? 720 : undefined,
							display: 'flex',
							flexDirection: 'column',
							minHeight: 0,
						}}
					>
						<div className="card-title">내 상품 목록</div>
						{/* (요청) 한눈에 상태 파악: 혼재/정체/하락경고 등 신호를 통일된 배지+바로 표현 */}
						<div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
							<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
								{renderSignalPill('하락경고', signalCounts['하락경고'] || 0)}
								{renderSignalPill('혼재', signalCounts['혼재'] || 0)}
								{renderSignalPill('정체', signalCounts['정체'] || 0)}
								{renderSignalPill('상승신호', signalCounts['상승신호'] || 0)}
								{renderSignalPill('데이터부족', signalCounts['데이터부족'] || 0)}
							</div>
							{renderSignalStackBar(signalCounts)}
							<div style={{ fontSize: 11, color: '#94a3b8' }}>
								신호 기준: 전일 대비 1일 Δ 기준(GOLDEN=+Δ, TRAP=0Δ, DEAD=-Δ), 하루라도 필수 입력이 부족하면 데이터부족
							</div>
						</div>
						<div
							style={{
								marginTop: 10,
								display: 'grid',
								gap: 6,
								flex: 1,
								minHeight: 0,
								overflowY: 'auto',
								overflowX: 'hidden',
								paddingRight: 10,
							}}
						>
							{rows.map((r) => {
							const active = r.url === selectedUrl;
							const latest = latestByUrl[r.url];
							const final = latest?.scores?.final ?? null;
							const dFinal = (latest?.deltas as any)?.final as number | null | undefined;
							const status = signalKorean(latest?.signal ?? null);
							const statusStyle = statusStyleForSignalKR(status);
							return (
								<button
									key={r.url}
									type="button"
									className="btn-ghost"
									onClick={() => void onSelect(r.url)}
									style={{
										display: 'block',
										width: '100%',
										textAlign: 'left',
										padding: '10px 10px',
										border: active ? '1px solid rgba(34,197,94,0.55)' : '1px solid rgba(148,163,184,0.18)',
										background: active ? 'rgba(34,197,94,0.08)' : 'transparent',
									}}
								>
									<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
										<div
											title={r.title}
											style={{
												fontWeight: 950,
												minWidth: 0,
												flex: 1,
												overflow: 'hidden',
												display: '-webkit-box',
												WebkitBoxOrient: 'vertical',
												WebkitLineClamp: 2,
												overflowWrap: 'anywhere',
												wordBreak: 'break-word',
												lineHeight: 1.25,
											}}
										>
											{r.title}
										</div>
										<div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}>
											<span
												style={{
													fontSize: 12,
													fontWeight: 950,
													padding: '2px 8px',
													borderRadius: 999,
													color: statusStyle.fg,
													background: statusStyle.bg,
													border: `1px solid ${statusStyle.bd}`,
													minWidth: 72,
													textAlign: 'center',
												}}
												title="오가닉 순위 예측(Δ/가속도)와 동일 규칙의 신호"
											>
												{status}
											</span>
											{final != null ? <span style={{ fontSize: 12, fontWeight: 950, color: '#e2e8f0' }}>{final}점</span> : null}
											{dFinal != null ? <span style={{ fontSize: 11, fontWeight: 900, color: deltaColor(dFinal) }}>{deltaText(dFinal)}</span> : null}
										</div>
									</div>
									{final != null ? (
										<div style={{ marginTop: 6 }}>
											<div style={{ height: 10, borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.35)' }}>
												<div style={{ width: `${Math.max(0, Math.min(100, Number(final))) }%`, height: '100%', background: statusStyle.bar }} />
											</div>
										</div>
									) : null}
									<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</div>
								</button>
							);
							})}
							{loading && rows.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>로딩 중…</div> : null}
							{!loading && rows.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>내 상품 추적에 등록된 상품이 없습니다.</div> : null}
						</div>
					</div>
				</div>

				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: 12,
						minWidth: 0,
						// (요청) 좌측 '내 상품 목록' 카드 높이와 동일 유지
						height: isTwoCol ? 720 : undefined,
					}}
				>
					<div className="card" style={{ padding: 12 }}>
						<div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
							<div className="card-title" style={{ margin: 0 }}>
								평가 점수
							</div>
							<div style={{ marginLeft: 'auto' }}>
								<button type="button" className="btn-primary" disabled={!selectedUrl || loading} onClick={() => void analyze(selectedUrl)}>
									{loading ? '분석 중…' : '상품지수 분석'}
								</button>
							</div>
						</div>

						{!selectedUrl ? (
							<div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>좌측에서 상품을 선택하세요.</div>
						) : analyzed ? (
							<div style={{ marginTop: 12 }}>
								<div style={{ fontSize: 12, color: '#94a3b8' }}>기준일: {analyzed.date}</div>

								<div className="card" style={{ marginTop: 10, padding: 14 }}>
									<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
										<div style={{ fontSize: 12, fontWeight: 900, color: '#cbd5e1' }}>항목 점검</div>
										<button type="button" className="btn-ghost" onClick={() => setShowFormulas((v) => !v)}>
											{showFormulas ? '수식 닫기' : '수식 보기'}
										</button>
									</div>
									<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
										{([
											{ k: 'click', label: '클릭점수', weight: '20%' },
											{ k: 'sales', label: '판매점수', weight: '35%' },
											{ k: 'review', label: '리뷰점수', weight: '25%' },
											{ k: 'recency', label: '최신성', weight: '10%' },
											{ k: 'final', label: '인기종합', weight: '최종' },
										] as const).map((x) => {
											const val = (analyzed.scores as any)[x.k] as number;
											const d = (analyzed.deltas as any)[x.k] as number | null | undefined;
											return (
												<div key={x.k} style={{ textAlign: 'center', borderLeft: x.k === 'click' ? undefined : '1px solid rgba(148,163,184,0.18)', paddingLeft: x.k === 'click' ? 0 : 10 }}>
													<div style={{ fontSize: 12, fontWeight: 900, color: '#e2e8f0' }}>{x.label}</div>
													<div style={{ marginTop: 6, fontSize: 18, fontWeight: 950, color: x.k === 'final' ? '#86efac' : '#e2e8f0' }}>
														{val}점{' '}
														<span style={{ fontSize: 12, fontWeight: 900, color: deltaColor(d) }}>
															{deltaText(d)}
														</span>
													</div>
													<div style={{ marginTop: 2, fontSize: 11, color: '#94a3b8' }}>{x.weight}</div>
												</div>
											);
										})}
									</div>
									{showFormulas && (analyzed as any).explain ? (
										<div style={{ marginTop: 12, borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: 10, display: 'grid', gap: 8, fontSize: 12 }}>
											{(() => {
												const ex = (analyzed as any).explain || {};
												const weights = ex?.weights || PRODUCT_INDEX_WEIGHTS;
												const click = ex?.click || {};
												const sales = ex?.sales || {};
												const review = ex?.review || {};
												const recency = ex?.recency || {};
												const final = ex?.final || {};
												return (
													<>
														<div style={{ color: '#cbd5e1', fontWeight: 950 }}>클릭점수</div>
														<div style={{ color: '#b8d4e8', lineHeight: 1.4 }}>
															클릭 수·전환 수·클릭률(CTR)을 카테고리 평균과 비교해 점수화(최대 100점)
														</div>
														<div style={{ color: '#94a3b8' }}>수식: {String(click.formula || '')}</div>
														<div style={{ color: '#e2e8f0' }}>
															입력: C={click?.inputs?.C ?? 0}, V={click?.inputs?.V ?? 0}, CTR={Number(click?.inputs?.CTR ?? 0).toFixed?.(4) ?? click?.inputs?.CTR}, CTR_cat_avg={Number(click?.inputs?.CTR_cat_avg ?? 0).toFixed?.(4) ?? click?.inputs?.CTR_cat_avg}
															{' '}→ 점수 {click?.score ?? 0}
														</div>

														<div style={{ color: '#cbd5e1', fontWeight: 950, marginTop: 6 }}>판매점수</div>
														<div style={{ color: '#b8d4e8', lineHeight: 1.4 }}>
															최근 7일·30일 판매량을 합산해 5천 건 기준으로 로그 스케일 점수화(최대 100점)
														</div>
														<div style={{ color: '#94a3b8' }}>수식: {String(sales.formula || '')}</div>
														<div style={{ color: '#e2e8f0' }}>
															입력: sales_7d={sales?.inputs?.sales_7d ?? 0}, sales_30d={sales?.inputs?.sales_30d ?? 0} → 점수 {sales?.score ?? 0}
														</div>

														<div style={{ color: '#cbd5e1', fontWeight: 950, marginTop: 6 }}>리뷰점수</div>
														<div style={{ color: '#b8d4e8', lineHeight: 1.4 }}>
															별점과 리뷰 수를 반영. 별점 3점 미만이면 50% 감점(최대 100점)
														</div>
														<div style={{ color: '#94a3b8' }}>수식: {String(review.formula || '')}</div>
														<div style={{ color: '#e2e8f0' }}>
															입력: rating={review?.inputs?.rating ?? 0}, review_count={review?.inputs?.review_count ?? 0} → 점수 {review?.score ?? 0}
														</div>

														<div style={{ color: '#cbd5e1', fontWeight: 950, marginTop: 6 }}>최신성</div>
														<div style={{ color: '#b8d4e8', lineHeight: 1.4 }}>
															등록일 기준 30일 이내 100점, 90일 이내 70점, 180일 이내 40점, 그 이상 0점
														</div>
														<div style={{ color: '#94a3b8' }}>규칙: {String(recency.rule || '')}</div>
														<div style={{ color: '#e2e8f0' }}>
															입력: days_since_reg={recency?.inputs?.days_since_reg ?? 0} (bucket={String(recency.bucket || '')}) → 점수 {recency?.score ?? 0}
														</div>

														<div style={{ color: '#cbd5e1', fontWeight: 950, marginTop: 6 }}>인기종합</div>
														<div style={{ color: '#b8d4e8', lineHeight: 1.4 }}>
															클릭 20%, 판매 35%, 리뷰 25%, 최신성 10% 가중 평균으로 종합 점수
														</div>
														<div style={{ color: '#94a3b8' }}>수식: {String(final.formula || '')}</div>
														<div style={{ color: '#e2e8f0' }}>
															가중치: click={weights.click}, sales={weights.sales}, review={weights.review}, recency={weights.recency} → 최종 {final?.score ?? 0}
														</div>
													</>
												);
											})()}
										</div>
									) : null}
								</div>
							</div>
						) : (
							<div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
								저장된 분석이 없거나 아직 로딩 중입니다. 필요하면 “상품지수 분석”을 눌러 점수를 계산하세요.
							</div>
						)}
					</div>

					{/* (요청) '현재 상황'은 좌측 리스트와 같은 높이로 맞추기 위해 별도 카드로 분리 */}
					<div
						className="card"
						style={{
							padding: 12,
							flex: isTwoCol ? 1 : undefined,
							minHeight: 0,
							overflow: isTwoCol ? 'auto' : undefined,
						}}
					>
						{!selectedUrl ? (
							<div style={{ fontSize: 12, color: '#94a3b8' }}>좌측에서 상품을 선택하세요.</div>
						) : analyzed ? (
							(() => {
								const latest = latestByUrl[selectedUrl] ?? null;
								const sigRaw = String(latest?.signal ?? '').toUpperCase() || 'UNKNOWN';
								const sigKR = signalKorean(sigRaw);
								const s = statusStyleForSignalKR(sigKR);
								const latestTrend = trendRows[trendRows.length - 1] ?? null;
								const latestDelta = latestTrend?.deltas?.final ?? null;
								const latestDeltaText =
									latestTrend && latestDelta != null
										? `${latestTrend.date}:${latestDelta > 0 ? `+${latestDelta}` : String(latestDelta)}`
										: '데이터 부족';
								const todayDrivers = (trendRows[trendRows.length - 1]?.drivers || []).slice(0, 2);
								return (
									<>
										<div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
											<div className="card-title" style={{ margin: 0 }}>
												현재 상황
											</div>
											<span
												style={{
													fontSize: 12,
													fontWeight: 950,
													padding: '2px 10px',
													borderRadius: 999,
													color: s.fg,
													background: s.bg,
													border: `1px solid ${s.bd}`,
													minWidth: 72,
													textAlign: 'center',
												}}
												title="오가닉 순위 예측(Δ/가속도)와 동일 규칙의 신호"
											>
												{sigKR}
											</span>
											<span style={{ fontSize: 11, color: '#94a3b8' }}>
												{signalRuleExplain(sigRaw)}
											</span>
										</div>

										<div style={{ marginTop: 10, display: 'grid', gap: 10, fontSize: 12, color: '#e2e8f0' }}>
											<div>
												<div style={{ color: '#94a3b8', fontWeight: 950 }}>현상(전일 대비)</div>
												<div style={{ marginTop: 6 }}>
													<span style={{ color: '#94a3b8', fontWeight: 900 }}>최근 Δ(인기종합): </span>
													{latestDeltaText}
												</div>
											</div>

											<div>
												<div style={{ color: '#94a3b8', fontWeight: 950 }}>원인(오늘 기준)</div>
												<div style={{ marginTop: 6 }}>
													{todayDrivers.length
														? todayDrivers
																.map((d) => `${d.label}(${d.deltaWeighted == null ? '-' : d.deltaWeighted > 0 ? `+${d.deltaWeighted.toFixed(2)}` : d.deltaWeighted.toFixed(2)})`)
																.join(' · ')
														: '데이터 부족'}
												</div>
												<div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>
													(가중치 기여 = 항목 점수 변화(Δ) × 항목 가중치)
												</div>
												{sigRaw === 'MIXED' ? (
													<div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
														혼재 원인 비교(오늘 vs 어제): 오늘 {formatDriversCompact(trendRows[trendRows.length - 1]?.drivers)} / 어제 {formatDriversCompact(trendRows[trendRows.length - 2]?.drivers)}
													</div>
												) : null}
											</div>

											<div>
												<div style={{ color: '#94a3b8', fontWeight: 950 }}>향후(추천 액션)</div>
												<div style={{ marginTop: 6, display: 'grid', gap: 4, color: '#cbd5e1' }}>
													{(() => {
														const src = ((trendRows[trendRows.length - 1]?.inputs as any)?.sources || {}) as Record<string, string>;
														const actions = recommendActionsForSignal({ signalRaw: sigRaw, drivers: todayDrivers as any, sources: src });
														return actions.map((a, i) => <div key={i}>- {a}</div>);
													})()}
												</div>
											</div>
										</div>
									</>
								);
							})()
						) : (
							<div style={{ fontSize: 12, color: '#94a3b8' }}>
								저장된 분석이 없거나 아직 로딩 중입니다. 필요하면 “상품지수 분석”을 눌러 점수를 계산하세요.
							</div>
						)}
					</div>
				</div>
			</div>

			{/* (하단) 근거보기/최근점수추이: 화면 폭에 맞게 "전체 너비" 사용 */}
			{selectedUrl ? (
				<div className="card" style={{ padding: 12 }}>
					<div className="card-title">근거보기 · 최근 점수 추이</div>
					<div className="card-caption">
						아래 표에서 <b>입력값 변화</b>와 <b>가중치 기여(원인)</b>를 같이 보면서 “왜 이런 신호가 나왔는지”를 확인하세요.
					</div>

					<div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
						<button type="button" className="btn-ghost" onClick={() => setShowEvidence((v) => !v)} disabled={!analyzed}>
							{showEvidence ? '근거 닫기' : '근거 보기'}
						</button>
						{!analyzed ? (
							<span style={{ fontSize: 11, color: '#94a3b8' }}>저장된 분석이 없으면 근거를 표시할 수 없습니다. 먼저 “상품지수 분석”을 실행하세요.</span>
						) : null}
						{history.length ? <span style={{ fontSize: 11, color: '#94a3b8' }}>히스토리: {history.length}일</span> : null}
					</div>

					{coverage ? (
						<div className="card" style={{ marginTop: 10, padding: 12 }}>
							<div className="card-title">데이터 커버리지(최근 14일)</div>
							<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 8 }}>
								점수 스냅샷: {coverage.score_days_count}일 / 페이지 수집: {coverage.page_days_count}일
							</div>
							{coverage.missing_score_days?.length ? (
								<div style={{ marginTop: 6, fontSize: 11, color: '#fda4af', fontWeight: 900 }}>
									점수 미생성 날짜: {coverage.missing_score_days.slice(0, 14).join(', ')}
									{coverage.missing_score_days.length > 14 ? ` 외 ${coverage.missing_score_days.length - 14}일` : ''}
									{' '}→ “최근 14일 점수 채우기”를 실행하면 채워집니다.
								</div>
							) : (
								<div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>최근 14일은 점수 스냅샷이 모두 존재합니다.</div>
							)}
						</div>
					) : null}

					{showEvidence && analyzed ? (
						<div className="card" style={{ marginTop: 10, padding: 12 }}>
							<div className="card-title">근거(입력값/출처/계산)</div>
							<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
								이 정보는 분석 실행 시점에 함께 저장되며, 전일 대비 변화(Δ) 계산에도 사용됩니다.
							</div>
							<pre
								style={{
									marginTop: 10,
									whiteSpace: 'pre-wrap',
									wordBreak: 'break-word',
									fontSize: 12,
									color: '#e2e8f0',
									background: 'rgba(15,23,42,0.35)',
									border: '1px solid rgba(148,163,184,0.18)',
									borderRadius: 8,
									padding: 10,
									maxHeight: 260,
									overflow: 'auto',
								}}
							>
								{JSON.stringify((analyzed as any).inputs || {}, null, 2)}
							</pre>
						</div>
					) : null}

					{trendRows.length ? (
						<div className="card" style={{ marginTop: 10, padding: 12 }}>
							<div className="card-title">최근 점수 추이(일자별 · 원인/입력값)</div>
							<div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
								{([7, 14, 30, 60, 90, 365] as const).map((d) => (
									<button
										key={d}
										type="button"
										className="btn-ghost"
										onClick={() => setTrendDays(d)}
										style={{
											border: d === trendDays ? '1px solid rgba(34,197,94,0.55)' : '1px solid rgba(148,163,184,0.18)',
											background: d === trendDays ? 'rgba(34,197,94,0.08)' : 'transparent',
										}}
									>
										{d === 365 ? '1년' : `${d}일`}
									</button>
								))}
								<button type="button" className="btn-ghost" onClick={() => setTrendDetailed((v) => !v)}>
									{trendDetailed ? '간략하게' : '자세하게'}
								</button>
							</div>
							<div style={{ marginTop: 10, overflowX: 'auto' }}>
								<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
									<thead>
										<tr style={{ color: '#94a3b8', textAlign: 'left' }}>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>날짜</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>인기종합</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>Δ</th>
											{trendDetailed ? (
												<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>수기/입력(검증)</th>
											) : null}
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>증감 원인(가중치 기여)</th>
										</tr>
									</thead>
									<tbody style={{ color: '#e2e8f0' }}>
										{trendRowsWindow
											.slice()
											.reverse()
											.map((r) => {
												const df = r.deltas.final;
												const c = df == null ? '#94a3b8' : df > 0 ? '#86efac' : df < 0 ? '#fda4af' : '#e2e8f0';
												const src = (r.inputs as any)?.sources || {};
												const inp = (k: string) => {
													const v = (r.inputs as any)?.[k];
													return v == null ? '-' : String(v);
												};
												const inpDelta = (k: string) => {
													const v = (r as any)?.inputDeltas?.[k] as number | null | undefined;
													if (v == null) return '';
													if (v === 0) return '(±0)';
													return v > 0 ? `(+${v})` : `(${v})`;
												};
												const srcText = (k: string) => {
													const s = src?.[k];
													return s ? String(s) : '';
												};
												const label = (k: string) => {
													if (k === 'weekly_views_7d') return '최근 7일 조회수(Proxy)';
													if (k === 'wishes') return '찜';
													if (k === 'sales_7d') return '최근 7일 판매';
													if (k === 'sales_30d') return '최근 30일 판매';
													if (k === 'days_since_reg') return '등록 후 경과일';
													return k;
												};
												const drivers = (r.drivers || []).slice(0, 2);
												return (
													<tr key={r.date}>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }}>{r.date}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', fontWeight: 900 }}>{r.scores.final}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: c, fontWeight: 900 }}>
															{df == null ? '-' : df > 0 ? `+${df}` : String(df)}
														</td>
														{trendDetailed ? (
															<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: '#cbd5e1' }}>
																<div style={{ display: 'grid', gap: 2 }}>
																	<div>
																		{label('weekly_views_7d')}: {inp('weekly_views_7d')}{' '}
																		<span style={{ color: '#94a3b8', fontWeight: 900 }}>{inpDelta('weekly_views_7d')}</span>
																		<span style={{ color: '#94a3b8' }}>{srcText('weekly_views_7d') ? ` (${srcText('weekly_views_7d')})` : ''}</span>
																	</div>
																	<div>
																		{label('wishes')}: {inp('wishes')}{' '}
																		<span style={{ color: '#94a3b8', fontWeight: 900 }}>{inpDelta('wishes')}</span>{' '}
																		<span style={{ color: '#94a3b8' }}>{srcText('wishes') ? ` (${srcText('wishes')})` : ''}</span>
																	</div>
																	<div>
																		{label('sales_7d')}: {inp('sales_7d')}{' '}
																		<span style={{ color: '#94a3b8', fontWeight: 900 }}>{inpDelta('sales_7d')}</span>{' '}
																		<span style={{ color: '#94a3b8' }}>{srcText('sales_7d') ? ` (${srcText('sales_7d')})` : ''}</span>
																	</div>
																	<div>
																		{label('sales_30d')}: {inp('sales_30d')}{' '}
																		<span style={{ color: '#94a3b8', fontWeight: 900 }}>{inpDelta('sales_30d')}</span>
																		<span style={{ color: '#94a3b8' }}>{srcText('sales_30d') ? ` (${srcText('sales_30d')})` : ''}</span>
																	</div>
																	<div>
																		{label('days_since_reg')}: {inp('days_since_reg')}{' '}
																		<span style={{ color: '#94a3b8', fontWeight: 900 }}>{inpDelta('days_since_reg')}</span>{' '}
																		<span style={{ color: '#94a3b8' }}>{srcText('days_since_reg') ? ` (${srcText('days_since_reg')})` : ''}</span>
																	</div>
																</div>
															</td>
														) : null}
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: '#e2e8f0' }}>
															{drivers.length ? (
																<div style={{ display: 'grid', gap: 2 }}>
																	{drivers.map((d) => (
																		<div key={String(d.key)}>
																			{d.label}: Δ{d.deltaScore == null ? '-' : d.deltaScore > 0 ? `+${d.deltaScore}` : String(d.deltaScore)} → 가중치 기여{' '}
																			{d.deltaWeighted == null ? '-' : d.deltaWeighted > 0 ? `+${d.deltaWeighted.toFixed(2)}` : d.deltaWeighted.toFixed(2)}
																		</div>
																	))}
																</div>
															) : (
																'-'
															)}
														</td>
													</tr>
												);
											})}
									</tbody>
								</table>
							</div>

							{/* 그래프(데일리 인기종합) */}
							{renderMiniLineChart()}
						</div>
					) : (
						<div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
							점수 히스토리가 없습니다. 분석이 저장된 뒤에 표시됩니다.
						</div>
					)}
				</div>
			) : null}

			{/* (하단) 오가닉 예측 + 수기 입력: 화면 폭에 맞게 전체 너비 사용 */}
			<div style={{ display: 'grid', gap: 12 }}>
					{/* (요청) 오가닉 순위 예측을 “근거/추이” 아래로 유지 */}
					{rankPred?.items?.length ? (
						<div className="card" style={{ padding: 12 }}>
							<div className="card-title">오가닉 순위 예측(Δ/가속도)</div>
							<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
								점수 변화(Δ)/가속도(Δ-Δ)와 오가닉 순위(최고순위 + 가중평균순위)를 함께 기록해 “상승/하락 전조”를 빠르게 파악합니다. (전일 대비: GOLDEN=+Δ, DEAD=-Δ, TRAP=0Δ, 입력 부족=데이터부족)
							</div>
							<div style={{ marginTop: 10, overflowX: 'auto' }}>
								<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
									<div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>벤치마크(경쟁사) 상품 URL</div>
									<input
										className="input"
										type="text"
										placeholder="(선택) https://smartstore.naver.com/.../products/..."
										style={{ minWidth: 240, flex: 1 }}
										value={benchmarkUrl}
										onChange={(e) => setBenchmarkUrl(e.target.value)}
									/>
									<button
										className="btn"
										onClick={() => {
											if (!selectedUrl) return;
											void loadRankPrediction(selectedUrl, benchmarkUrl);
										}}
									>
										Gap 적용
									</button>
								</div>
								<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
									<thead>
										<tr style={{ color: '#94a3b8', textAlign: 'left' }}>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>날짜</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>인기종합</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>Δ</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>가속도</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>최고 순위</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>Δ순위</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>가중 순위</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>Δ가중</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>벤치</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>Gap</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>벤치(가중)</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>Gap(가중)</th>
											<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>신호</th>
										</tr>
									</thead>
									<tbody style={{ color: '#e2e8f0' }}>
										{(rankPred.items || [])
											.slice()
											.reverse()
											.slice(0, 14)
											.map((it) => {
												const ds = it.delta_score_final;
												const dr = it.delta_best_rank;
												const dwr = it.delta_weighted_rank;
												const sigRaw = String(it.signal || 'UNKNOWN');
												const sig =
													sigRaw === 'GOLDEN' ? '상승신호' :
													sigRaw === 'DEAD' ? '하락경고' :
													sigRaw === 'TRAP' ? '정체' :
													sigRaw === 'MIXED' ? '혼재' :
													'데이터부족';
												const sigColor =
													sigRaw === 'GOLDEN' ? '#86efac' :
													sigRaw === 'DEAD' ? '#fda4af' :
													sigRaw === 'TRAP' ? '#fde68a' :
													'#cbd5e1';
												const fmtRank = (v: any) => {
													if (v == null) return '-';
													const n = Number(v);
													if (!Number.isFinite(n)) return '-';
													return n.toFixed(2);
												};
												const fmtDeltaRank = (v: any) => {
													if (v == null) return '';
													const n = Number(v);
													if (!Number.isFinite(n)) return '';
													if (n === 0) return '(±0)';
													return n > 0 ? `(+${n.toFixed(2)})` : `(${n.toFixed(2)})`;
												};
												return (
													<tr key={it.date}>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: '#94a3b8' }}>{it.date}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', fontWeight: 900 }}>{it.score_final ?? '-'}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: deltaColor(ds), fontWeight: 900 }}>{deltaText(ds)}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: deltaColor(it.accel), fontWeight: 900 }}>{deltaText(it.accel)}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>{it.best_rank ?? '-'}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: dr == null ? '#94a3b8' : dr < 0 ? '#86efac' : dr > 0 ? '#fda4af' : '#e2e8f0', fontWeight: 900 }}>
															{dr == null ? '' : dr === 0 ? '(±0)' : dr > 0 ? `(+${dr})` : `(${dr})`}
														</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>{fmtRank(it.weighted_rank)}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: deltaColor(dwr as any), fontWeight: 900 }}>{fmtDeltaRank(dwr)}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: '#cbd5e1' }}>{it.benchmark_best_rank ?? '-'}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: it.gap_best_rank == null ? '#94a3b8' : it.gap_best_rank > 0 ? '#fda4af' : it.gap_best_rank < 0 ? '#86efac' : '#e2e8f0', fontWeight: 900 }}>
															{it.gap_best_rank == null ? '' : it.gap_best_rank === 0 ? '(0)' : it.gap_best_rank > 0 ? `(+${it.gap_best_rank})` : `(${it.gap_best_rank})`}
														</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: '#cbd5e1' }}>{fmtRank(it.benchmark_weighted_rank)}</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', color: it.gap_weighted_rank == null ? '#94a3b8' : Number(it.gap_weighted_rank) > 0 ? '#fda4af' : Number(it.gap_weighted_rank) < 0 ? '#86efac' : '#e2e8f0', fontWeight: 900 }}>
															{fmtDeltaRank(it.gap_weighted_rank)}
														</td>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.12)', fontWeight: 950, color: sigColor }}>{sig}</td>
													</tr>
												);
											})}
									</tbody>
								</table>
							</div>
						</div>
					) : null}

					{/* (요청) 수기 입력: 좌측 컬럼 고정 */}
					{selectedUrl ? (
						<div className="card" style={{ padding: 12 }}>
							<div className="card-title">수기 입력(점수 계산 보강)</div>
							<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
								조회수/판매량(30일) 등 자동 수집이 어려운 항목은 수기로 보강할 수 있습니다. (패널티는 미적용)
							</div>

							<div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
								<button type="button" className="btn-ghost" disabled={!suggested} onClick={applySuggested} title="빈 칸(미입력)만 자동값으로 채웁니다.">
									자동값 채우기
								</button>
								{suggested ? (
									<span style={{ fontSize: 11, color: '#94a3b8' }}>
										자동 소스: {suggested.source} · page rows(30d) {suggested.matched_rows_30d}
									</span>
								) : (
									<span style={{ fontSize: 11, color: '#94a3b8' }}>자동값을 불러오는 중이거나 아직 없습니다.</span>
								)}
							</div>

							<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
								<div style={{ display: 'grid', gap: 6 }}>
									<label className="field-label">최근 7일 조회수(Proxy: 광고 노출수)</label>
									<input
										className="input"
										type="text"
										inputMode="numeric"
										pattern="\\d*"
										placeholder="(수기 입력)"
										value={displayNullableInt(manual?.weekly_views_7d)}
										onChange={(e) => updateManualIntField(setManual, selectedUrl, 'weekly_views_7d', e.target.value)}
									/>
									<div style={{ fontSize: 11, color: '#94a3b8' }}>
										자동: {suggested?.weekly_views_7d ?? '-'} {suggested?.sources?.weekly_views_7d ? `(${suggested.sources.weekly_views_7d})` : ''}
									</div>
								</div>
								<div style={{ display: 'grid', gap: 6 }}>
									<label className="field-label">찜 수(override)</label>
									<input
										className="input"
										type="text"
										inputMode="numeric"
										pattern="\\d*"
										placeholder="(수기 입력)"
										value={displayNullableInt(manual?.wishes)}
										onChange={(e) => updateManualIntField(setManual, selectedUrl, 'wishes', e.target.value)}
									/>
									<div style={{ fontSize: 11, color: '#94a3b8' }}>
										자동: {suggested?.wishes ?? '-'} {suggested?.sources?.wishes ? `(${suggested.sources.wishes})` : ''}
									</div>
								</div>
								<div style={{ display: 'grid', gap: 6 }}>
									<label className="field-label">최근 30일 판매량(추정)</label>
									<input
										className="input"
										type="text"
										inputMode="numeric"
										pattern="\\d*"
										placeholder="(수기 입력)"
										value={displayNullableInt(manual?.sales_30d)}
										onChange={(e) => updateManualIntField(setManual, selectedUrl, 'sales_30d', e.target.value)}
									/>
									<div style={{ fontSize: 11, color: '#94a3b8' }}>
										자동: {suggested?.sales_30d ?? '-'} {suggested?.sources?.sales_30d ? `(${suggested.sources.sales_30d})` : ''}
									</div>
								</div>

								<div style={{ display: 'grid', gap: 6 }}>
									<label className="field-label">최근 7일 판매량(override)</label>
									<input
										className="input"
										type="text"
										inputMode="numeric"
										pattern="\\d*"
										placeholder="(수기 입력)"
										value={displayNullableInt(manual?.sales_7d_override)}
										onChange={(e) => updateManualIntField(setManual, selectedUrl, 'sales_7d_override', e.target.value)}
									/>
									<div style={{ fontSize: 11, color: '#94a3b8' }}>
										자동: {suggested?.sales_7d ?? '-'} {suggested?.sources?.sales_7d ? `(${suggested.sources.sales_7d})` : ''}
									</div>
								</div>
								<div style={{ display: 'grid', gap: 6 }}>
									<label className="field-label">등록 후 경과일(override)</label>
									<input
										className="input"
										type="text"
										inputMode="numeric"
										pattern="\\d*"
										placeholder="(수기 입력)"
										value={displayNullableInt(manual?.days_since_reg)}
										onChange={(e) => updateManualIntField(setManual, selectedUrl, 'days_since_reg', e.target.value)}
									/>
									<div style={{ fontSize: 11, color: '#94a3b8' }}>
										자동: {suggested?.days_since_reg ?? '-'} {suggested?.sources?.days_since_reg ? `(${suggested.sources.days_since_reg})` : ''}
									</div>
								</div>
								<div style={{ display: 'flex', alignItems: 'end' }}>
									<button type="button" className="btn-primary" onClick={() => void saveManual()} disabled={manualSaving}>
										{manualSaving ? '저장 중…' : '저장 + 재분석'}
									</button>
								</div>
							</div>
						</div>
					) : null}
			</div>

		</div>
	);
}

