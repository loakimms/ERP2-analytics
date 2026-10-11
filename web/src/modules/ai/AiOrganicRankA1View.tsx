import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { buildA1RangePayload, defaultA1LastNDaysRange, type A1DateRange } from './a1DateRange';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type MetricKey =
	| 'best_rank_latest'
	| 'worst_rank_latest'
	| 'avg_rank_14d_mean'
	| 'keywords_computed'
	| 'rank_latest'
	| 'rank_change_7d'
	| 'avg_rank_14d'
	| 'rank_volatility_14d'
	| 'valid_days_14d'
	| 'missing_ratio_14d'
	| 'search_volume_month';

const METRIC_LABELS: Record<MetricKey, string> = {
	// 상품 요약(rollup)
	best_rank_latest: '최근 최고 순위',
	worst_rank_latest: '최근 최저 순위',
	avg_rank_14d_mean: '14일 평균 순위',
	keywords_computed: '분석 키워드 수',

	// 키워드 상세(metrics)
	rank_latest: '현재 순위',
	rank_change_7d: '7일 순위 변동',
	avg_rank_14d: '14일 평균 순위',
	rank_volatility_14d: '14일 변동성',
	valid_days_14d: '14일 유효 일수',
	missing_ratio_14d: '14일 미노출 비율',
	search_volume_month: '월 검색량',
};

function metricLabel(key: string): string {
	return (METRIC_LABELS as Record<string, string>)[key] ?? key;
}

type ProductTopMover = {
	keyword: string;
	rank_latest?: number | null;
	rank_change_7d?: number | null;
	down_days_7d?: number | null;
	decision?: string | null;
};

type ProductSummary = {
	product_url: string;
	product_title: string;
	keyword_count: number;
	decision_rollup: string;
	status_tier?: 'VERY_STABLE' | 'STABLE' | 'RISK' | 'NEED_GROWTH';
	status_prev_tier?: 'VERY_STABLE' | 'STABLE' | 'RISK' | 'NEED_GROWTH' | null;
	status_change?: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN' | null;
	band_counts?: Record<string, number>;
	band_counts_prev?: Record<string, number>;
	metrics_rollup: Record<string, any>;
	top_movers: ProductTopMover[];
};

type ProductsResponse = {
	ok: boolean;
	analysis_type: string;
	days: number;
	rules_used: any;
	product_count: number;
	products: ProductSummary[];
};

type ProductKeywordDetail = {
	keyword: string;
	decision: string;
	confidence?: number | null;
	metrics?: Record<string, any>;
	trend?: string;
	issue_score?: number;
	rank_series_14d?: { date: string; rank: number }[];
};

type ProductDetailResponse = {
	ok: boolean;
	analysis_type: string;
	days: number;
	product_url: string;
	product_title: string;
	keyword_count: number;
	keywords: ProductKeywordDetail[];
	movers_up: string[];
	movers_down: string[];
	issues_persistent: string[];
};

type ProductGptAction = {
	title: string;
	why: string;
	how: string;
	priority: string;
	evidence_refs?: string[];
};

type ProductGptResponse = {
	ok: boolean;
	analysis_type: string;
	days: number;
	product_url: string;
	product_title: string;
	keyword_mode: string;
	selected_keywords: string[];
	decision?: string | null;
	confidence?: number | null;
	rules_triggered?: string[];
	recommended_actions: ProductGptAction[];
	analysis_markdown: string;
	trace_run_id?: string | null;
	trace_sku_id?: string | null;
};

function prioDecision(d: string): number {
	const m: Record<string, number> = { WEAK: 0, UNSTABLE: 1, UNCERTAIN: 2, STABLE: 3 };
	return m[(d || '').toUpperCase()] ?? 9;
}

type StatusTier = 'VERY_STABLE' | 'STABLE' | 'RISK' | 'NEED_GROWTH';
function tierLabel(t: StatusTier | null | undefined): string {
	switch (t) {
		case 'VERY_STABLE': return '매우 안정적';
		case 'STABLE': return '안정적';
		case 'RISK': return '위험';
		case 'NEED_GROWTH': return '성장 필요';
		default: return '미정';
	}
}
function tierColor(t: StatusTier | null | undefined): { fg: string; bg: string; bd: string } {
	switch (t) {
		case 'VERY_STABLE': return { fg: '#bbf7d0', bg: 'rgba(34,197,94,0.12)', bd: 'rgba(34,197,94,0.35)' };
		case 'STABLE': return { fg: '#93c5fd', bg: 'rgba(59,130,246,0.12)', bd: 'rgba(59,130,246,0.35)' };
		case 'RISK': return { fg: '#fde68a', bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.35)' };
		case 'NEED_GROWTH': return { fg: '#fda4af', bg: 'rgba(244,63,94,0.10)', bd: 'rgba(244,63,94,0.35)' };
		default: return { fg: '#e2e8f0', bg: 'rgba(148,163,184,0.10)', bd: 'rgba(148,163,184,0.20)' };
	}
}
function changeLabel(c: ProductSummary['status_change']): string {
	if (!c) return '-';
	if (c === 'UP') return '개선';
	if (c === 'DOWN') return '악화';
	if (c === 'FLAT') return '유지';
	return '판단불가';
}

function bandBar(counts: Record<string, number> | undefined, height: number = 8): JSX.Element | null {
	if (!counts) return null;
	const total = Math.max(0, Number(counts.total ?? 0));
	if (!total) return null;
	const segs: { k: string; label: string; v: number; color: string }[] = [
		{ k: 'top_1_3', label: '1~3', v: Number(counts.top_1_3 ?? 0), color: 'rgba(34,197,94,0.9)' },
		{ k: 'top_4_6', label: '4~6', v: Number(counts.top_4_6 ?? 0), color: 'rgba(59,130,246,0.9)' },
		{ k: 'top_7_10', label: '7~10', v: Number(counts.top_7_10 ?? 0), color: 'rgba(245,158,11,0.9)' },
		{ k: 'other_11_plus', label: '11+', v: Number(counts.other_11_plus ?? 0), color: 'rgba(148,163,184,0.8)' },
		{ k: 'missing', label: '미노출', v: Number(counts.missing ?? 0), color: 'rgba(100,116,139,0.9)' },
	];
	return (
		<div title={`밴드 분포(총 ${total})`} style={{ height, display: 'flex', borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.18)' }}>
			{segs.map((s) => {
				const w = total > 0 ? (s.v / total) * 100 : 0;
				return <div key={s.k} style={{ width: `${w}%`, background: s.color }} title={`${s.label}: ${s.v}`} />;
			})}
		</div>
	);
}

function fmt(v: any): string {
	if (v == null) return '-';
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return String(v);
}

function fmtRank(v: any): string {
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isFinite(n)) return '-';
	if (n <= 0) return '-';
	if (n >= 999) return '미노출';
	return String(n);
}

function pickMetric(m: Record<string, any> | undefined, key: string, keyValid?: string): any {
	if (!m) return undefined;
	if (keyValid && m[keyValid] != null) return m[keyValid];
	return m[key];
}

function kwRiskLabel(rankLatest: any, delta7d: any, downDays7d: any): { label: string; color: string; title: string } {
	const r = typeof rankLatest === 'number' ? rankLatest : Number(rankLatest);
	const d = typeof delta7d === 'number' ? delta7d : Number(delta7d);
	const downDays = typeof downDays7d === 'number' ? downDays7d : Number(downDays7d);
	const rankOk = Number.isFinite(r) && r > 0 && r < 999;
	const deltaOk = Number.isFinite(d);
	const downOk = Number.isFinite(downDays);

	// 위험: 하락 폭이 크거나(>=3) 하락일이 많음(>=3), 또는 현재 11위권 밖
	if ((deltaOk && d >= 3) || (downOk && downDays >= 3) || (rankOk && r >= 11)) {
		return { label: '위험', color: '#fda4af', title: '하락 폭/하락일/11위권 밖 기준' };
	}
	// 주의: 7~10위권이거나 소폭 하락(>0)
	if ((rankOk && r >= 7 && r <= 10) || (deltaOk && d > 0)) {
		return { label: '주의', color: '#fde68a', title: '7~10위권 또는 소폭 하락' };
	}
	return { label: '안정', color: '#86efac', title: '유지/개선 또는 상위권 유지' };
}

type TrendPoint = { date: string; rank: number | null };
function toTrendSeries(series14: { date: string; rank: number }[] | undefined | null): TrendPoint[] {
	const src = Array.isArray(series14) ? series14 : [];
	return src
		.map((x) => {
			const d = String((x as any)?.date || '').trim();
			const rk = Number((x as any)?.rank);
			if (!d) return null;
			if (!Number.isFinite(rk)) return { date: d.slice(5), rank: null };
			// 999는 미노출로 취급(차트에서는 끊어서 표시)
			if (rk >= 999) return { date: d.slice(5), rank: null };
			return { date: d.slice(5), rank: rk };
		})
		.filter(Boolean) as TrendPoint[];
}

function RankTrendChart(props: { series14?: { date: string; rank: number }[] | null }): JSX.Element {
	const data = useMemo(() => toTrendSeries(props.series14), [props.series14]);
	return (
		<div style={{ height: 220, width: '100%' }}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={data}>
					<CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" vertical={false} />
					<XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
					<YAxis
						stroke="#94a3b8"
						fontSize={11}
						tickLine={false}
						axisLine={false}
						reversed
						allowDecimals={false}
						domain={['dataMin', 'dataMax']}
					/>
					<Tooltip
						contentStyle={{
							background: 'rgba(2,6,23,0.95)',
							border: '1px solid rgba(148,163,184,0.22)',
							borderRadius: 10,
							color: '#e2e8f0',
							fontSize: 12,
						}}
						labelStyle={{ color: '#cbd5e1' }}
						formatter={(v: any) => (v == null ? '미노출' : String(v))}
					/>
					<Line type="monotone" dataKey="rank" stroke="#22c55e" strokeWidth={2.5} dot={false} connectNulls={false} />
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

function KpiCard(props: { title: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }): JSX.Element {
	const tone = props.tone || 'neutral';
	const accent =
		tone === 'good'
			? '#86efac'
			: tone === 'warn'
				? '#fde68a'
				: tone === 'bad'
					? '#fda4af'
					: '#e2e8f0';
	return (
		<div className="a1-kpi-card">
			<div className="a1-kpi-title">{props.title}</div>
			<div className="a1-kpi-value">
				<strong style={{ color: accent }}>{props.value}</strong>
			</div>
			{props.sub ? <div className="a1-kpi-sub">{props.sub}</div> : null}
		</div>
	);
}

export function AiOrganicRankA1View(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;
	const navigate = useNavigate();

	const [dateRange, setDateRange] = useState<A1DateRange>(() => defaultA1LastNDaysRange(30));
	const rangePayload = useMemo(() => buildA1RangePayload(dateRange, 90), [dateRange]);
	const days = rangePayload.days;
	const [model, setModel] = useState<string>('gpt-4o-mini');

	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	// (1) 상품 리스트
	const [productsRes, setProductsRes] = useState<ProductsResponse | null>(null);
	const [selectedProductUrl, setSelectedProductUrl] = useState<string>('');

	// (2) 상품 상세(키워드 진단)
	const [detailLoading, setDetailLoading] = useState(false);
	const [productDetail, setProductDetail] = useState<ProductDetailResponse | null>(null);
	const [kwTab, setKwTab] = useState<'down' | 'up' | 'issue' | 'all'>('down');
	const [kwTopN, setKwTopN] = useState<number>(10);
	const [kwSearch, setKwSearch] = useState<string>('');
	const [kwSort, setKwSort] = useState<'issue' | 'delta_down' | 'rank' | 'volume'>('issue');
	const [kwViewMode, setKwViewMode] = useState<'split' | 'tab'>('split');
	const [selectedKeywords, setSelectedKeywords] = useState<Record<string, boolean>>({});
	const [selectedKeywordForPreview, setSelectedKeywordForPreview] = useState<string>('');

	// (3~4) GPT 의뢰/결과
	const [gptRunning, setGptRunning] = useState(false);
	const [gptMode, setGptMode] = useState<'topN' | 'specific' | 'all'>('topN');
	const [gptTopN, setGptTopN] = useState<number>(10);
	const [gptResult, setGptResult] = useState<ProductGptResponse | null>(null);

	// 메뉴 진입/기간 변경 시 자동 로드(과다 호출 방지용 디바운스)
	const autoTimerRef = useRef<number | null>(null);

	useEffect(() => {
		if (!toast) return;
		const t = window.setTimeout(() => setToast(null), 1600);
		return () => window.clearTimeout(t);
	}, [toast]);

	const runProducts = async () => {
		setRunning(true);
		setError(null);
		try {
			const res = await axios.post<ProductsResponse>(`${apiBaseUrl}/ai/analyze/organic-rank/a1/products`, {
				days: Math.max(7, Math.min(90, Number(days || 30))),
				date_from: rangePayload.date_from,
				date_to: rangePayload.date_to,
				max_products: 200,
				max_keywords_per_product: 30,
			});
			setProductsRes(res.data || null);
			const list = (res.data?.products || []) as ProductSummary[];
			const first = list[0]?.product_url ?? '';
			setSelectedProductUrl((prev) => {
				const p = String(prev || '').trim();
				if (p && list.some((x) => x?.product_url === p)) return p;
				return first;
			});
			setToast('상품 요약 로딩 완료');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '상품 목록 로딩 실패';
			setError(String(msg));
		} finally {
			setRunning(false);
		}
	};

	// 요구사항: 메뉴 진입 시 “바로” 각 제품별 분석(요약)을 실행한다.
	useEffect(() => {
		// 디바운스: 날짜 입력 중 연속 변경을 흡수
		if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
		autoTimerRef.current = window.setTimeout(() => {
			if (running) return;
			void runProducts();
		}, 350) as any;
		return () => {
			if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
			autoTimerRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rangePayload.date_from, rangePayload.date_to]);

	const fetchDetail = async (productUrl: string) => {
		if (!productUrl) return;
		setDetailLoading(true);
		setError(null);
		try {
			const res = await axios.get<ProductDetailResponse>(`${apiBaseUrl}/ai/analyze/organic-rank/a1/product/detail`, {
				params: {
					product_url: productUrl,
					days: Math.max(7, Math.min(90, Number(days || 30))),
					date_from: rangePayload.date_from,
					date_to: rangePayload.date_to,
					limit_keywords: 400,
				},
				timeout: 30000,
			});
			setProductDetail(res.data || null);
			setSelectedKeywords({});
			setSelectedKeywordForPreview('');
			setGptResult(null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '상품 상세 로딩 실패';
			setError(String(msg));
			setProductDetail(null);
		} finally {
			setDetailLoading(false);
		}
	};

	useEffect(() => {
		if (!selectedProductUrl) return;
		void fetchDetail(selectedProductUrl);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedProductUrl, days, rangePayload.date_from, rangePayload.date_to]);

	const selectedProduct = useMemo(() => {
		const list = productsRes?.products || [];
		return list.find((p) => p.product_url === selectedProductUrl) || null;
	}, [productsRes?.products, selectedProductUrl]);

	const attentionNeeded = useMemo(() => {
		const p = selectedProduct;
		if (!p) return false;
		const prev = (p.status_prev_tier || null) as any as StatusTier | null;
		const curr = (p.status_tier || 'NEED_GROWTH') as StatusTier;
		if (curr === 'RISK' || curr === 'NEED_GROWTH') return true;
		if (prev === 'VERY_STABLE' && curr === 'STABLE') return true;
		return false;
	}, [selectedProduct]);

	const representativeKeyword = useMemo(() => {
		const d = productDetail;
		if (!d) return '';
		const pick =
			String(selectedKeywordForPreview || '').trim() ||
			String((d.movers_down || [])[0] || '').trim() ||
			String((d.issues_persistent || [])[0] || '').trim() ||
			String((d.movers_up || [])[0] || '').trim() ||
			String((d.keywords || [])[0]?.keyword || '').trim();
		return pick;
	}, [productDetail, selectedKeywordForPreview]);

	const kpi = useMemo(() => {
		const p = selectedProduct;
		const d = productDetail;
		const tier = (p?.status_tier || 'NEED_GROWTH') as StatusTier;
		const tierLbl = tierLabel(tier);
		const band = (p?.band_counts || {}) as any;
		const top3 = Number(band.top_1_3 ?? 0);
		const top10 = Number(band.top_7_10 ?? 0) + Number(band.top_4_6 ?? 0) + Number(band.top_1_3 ?? 0);
		const missing = Number(band.missing ?? 0);
		const moversDown = (d?.movers_down || []).length;
		const issues = (d?.issues_persistent || []).length;
		const moversUp = (d?.movers_up || []).length;
		return {
			tierLbl,
			top3,
			top10,
			missing,
			moversDown,
			issues,
			moversUp,
			best: p?.metrics_rollup?.best_rank_latest,
			worst: p?.metrics_rollup?.worst_rank_latest,
			avg14: p?.metrics_rollup?.avg_rank_14d_mean,
		};
	}, [productDetail, selectedProduct]);

	const keywordByName = useMemo(() => {
		const m: Record<string, ProductKeywordDetail> = {};
		for (const k of productDetail?.keywords || []) {
			const name = String(k.keyword || '').trim();
			if (name) m[name] = k;
		}
		return m;
	}, [productDetail?.keywords]);

	const representativeSeries14 = useMemo(() => {
		const kw = representativeKeyword;
		if (!kw) return null;
		const info = keywordByName[kw];
		return info?.rank_series_14d || null;
	}, [keywordByName, representativeKeyword]);

	type KeywordRow = {
		keyword: string;
		rank_latest: number | null;
		rank_change_7d: number | null;
		down_days_7d: number | null;
		search_volume_month: number | null;
		issue_score: number;
		trend: string;
	};

	function keywordRowFor(kw: string): KeywordRow {
		const info = keywordByName[kw];
		const m = info?.metrics || {};
		const delta7 = pickMetric(m, 'rank_change_7d', 'rank_change_7d_valid');
		const issueScore = Number(info?.issue_score ?? 0);
		return {
			keyword: kw,
			rank_latest: (m.rank_latest ?? null) as any,
			rank_change_7d: (delta7 ?? null) as any,
			down_days_7d: (m.down_days_7d ?? null) as any,
			search_volume_month: (m.search_volume_month ?? null) as any,
			issue_score: Number.isFinite(issueScore) ? issueScore : 0,
			trend: String(info?.trend || '').trim() || 'UNKNOWN',
		};
	}

	const keywordRowsForTab = useMemo((): KeywordRow[] => {
		const d = productDetail;
		if (!d) return [];
		const base =
			kwTab === 'down'
				? (d.movers_down || [])
				: kwTab === 'up'
					? (d.movers_up || [])
					: kwTab === 'issue'
						? (d.issues_persistent || [])
						: (d.keywords || []).map((x) => x.keyword);
		const filtered = (base || []).map((k) => String(k || '').trim()).filter(Boolean);
		const q = String(kwSearch || '').trim();
		const out0 = q ? filtered.filter((k) => k.includes(q)) : filtered;

		const rows: KeywordRow[] = out0.map((kw) => keywordRowFor(kw));

		const rows2 = [...rows];
		rows2.sort((a, b) => {
			if (kwSort === 'rank') {
				const ra = Number(a.rank_latest ?? 9999);
				const rb = Number(b.rank_latest ?? 9999);
				return ra - rb;
			}
			if (kwSort === 'volume') {
				const sa = Number(a.search_volume_month ?? -1);
				const sb = Number(b.search_volume_month ?? -1);
				return sb - sa;
			}
			if (kwSort === 'delta_down') {
				const da = Number(a.rank_change_7d ?? -9999);
				const db = Number(b.rank_change_7d ?? -9999);
				return db - da;
			}
			// issue
			return Number(b.issue_score ?? 0) - Number(a.issue_score ?? 0);
		});

		return rows2.slice(0, Math.max(1, Math.min(200, Number(kwTopN || 10))));
	}, [productDetail, kwTab, kwSearch, kwTopN, kwSort, keywordByName]);

	const keywordRowsSplit = useMemo((): { issues: KeywordRow[]; opportunities: KeywordRow[] } => {
		const d = productDetail;
		if (!d) return { issues: [], opportunities: [] };
		const all = (d.keywords || []).map((x) => String((x as any)?.keyword || '').trim()).filter(Boolean);
		const q = String(kwSearch || '').trim();
		const filtered = q ? all.filter((k) => k.includes(q)) : all;

		const issues: KeywordRow[] = [];
		const opportunities: KeywordRow[] = [];

		for (const kw of filtered) {
			const r = keywordRowFor(kw);
			const risk = kwRiskLabel(r.rank_latest, r.rank_change_7d, r.down_days_7d);
			const d7 = Number(r.rank_change_7d ?? 0);
			const down7 = Number(r.down_days_7d ?? 0);
			const latest = Number(r.rank_latest ?? 9999);
			const isIssue =
				r.issue_score >= 10 ||
				(d7 > 0) ||
				(down7 >= 2) ||
				(Number.isFinite(latest) && latest >= 11 && latest < 999) ||
				risk.label === '위험';
			const isOpp =
				(d7 < 0) ||
				(Number.isFinite(latest) && latest > 0 && latest <= 10 && (d7 <= 0 || r.trend === 'UP')) ||
				(Number.isFinite(latest) && latest > 0 && latest <= 3);

			if (isIssue) {
				issues.push(r);
			} else if (isOpp) {
				opportunities.push(r);
			} else {
				// 중립: 기회로 분류(상용 UX에서 "할 일 없음"보다 관찰 대상으로 노출이 유리)
				opportunities.push(r);
			}
		}

		issues.sort((a, b) => {
			const s = Number(b.issue_score ?? 0) - Number(a.issue_score ?? 0);
			if (s !== 0) return s;
			return Number(b.rank_change_7d ?? 0) - Number(a.rank_change_7d ?? 0);
		});
		opportunities.sort((a, b) => {
			const ra = Number(a.rank_latest ?? 9999);
			const rb = Number(b.rank_latest ?? 9999);
			if (ra !== rb) return ra - rb;
			return Number(a.rank_change_7d ?? 0) - Number(b.rank_change_7d ?? 0);
		});

		const n = Math.max(1, Math.min(200, Number(kwTopN || 10)));
		return { issues: issues.slice(0, n), opportunities: opportunities.slice(0, n) };
	}, [productDetail, kwSearch, kwTopN, keywordByName]);

	const downDriverRows = useMemo(() => {
		const d = productDetail;
		if (!d) return [];
		const kws = d.movers_down || [];
		const rows = kws
			.map((kw) => {
				const info = keywordByName[kw];
				const m = info?.metrics || {};
				const delta = pickMetric(m, 'rank_change_7d', 'rank_change_7d_valid');
				return {
					keyword: kw,
					rank_latest: m.rank_latest,
					rank_change_7d: delta,
					down_days_7d: m.down_days_7d,
					search_volume_month: m.search_volume_month,
				};
			})
			.filter((x) => String(x.keyword || '').trim());
		return rows;
	}, [keywordByName, productDetail]);

	const recommendedAdKeywords = useMemo(() => {
		// 추천 기준(보수적):
		// - 최근 7일 악화(Δ7d > 0)
		// - 월 검색량이 있으면 우선(>=100)
		const rows = [...downDriverRows];
		rows.sort((a, b) => {
			const svA = Number(a.search_volume_month ?? -1);
			const svB = Number(b.search_volume_month ?? -1);
			if (svA !== svB) return svB - svA;
			const dA = Number(a.rank_change_7d ?? -999);
			const dB = Number(b.rank_change_7d ?? -999);
			return dB - dA;
		});
		const picked = rows.filter((r) => {
			const d = Number(r.rank_change_7d ?? 0);
			const sv = Number(r.search_volume_month ?? 0);
			return Number.isFinite(d) && d > 0 && (sv >= 100 || sv === 0);
		});
		return picked.slice(0, 8);
	}, [downDriverRows]);

	const focusKeywordFromRiskTable = (kw: string) => {
		const k0 = String(kw || '').trim();
		if (!k0) return;
		// 사용자가 "집중 관리 요청"에서 클릭했을 때는
		// - 탭(기존) 모드로 전환해 "하락 Top" 맥락을 유지
		// - 검색어는 초기화해 키워드가 리스트에서 바로 보이게 한다.
		setKwViewMode('tab');
		setKwTab('down');
		setKwSearch('');
		setSelectedKeywordForPreview(k0);
	};

	const toggleKeyword = (kw: string) => {
		setSelectedKeywords((prev) => ({ ...prev, [kw]: !prev[kw] }));
	};

	const selectedKeywordList = useMemo(() => Object.keys(selectedKeywords).filter((k) => selectedKeywords[k]), [selectedKeywords]);

	const runProductGpt = async () => {
		if (!selectedProductUrl || gptRunning) return;
		setGptRunning(true);
		setError(null);
		try {
			const payload: any = {
				product_url: selectedProductUrl,
				days: Math.max(7, Math.min(90, Number(days || 30))),
				date_from: rangePayload.date_from,
				date_to: rangePayload.date_to,
				model: String(model || '').trim() || 'gpt-4o-mini',
				keyword_mode: gptMode,
				top_n: Math.max(1, Math.min(50, Number(gptTopN || 10))),
			};
			if (gptMode === 'specific') {
				payload.keywords = selectedKeywordList;
			}
			const res = await axios.post<ProductGptResponse>(`${apiBaseUrl}/ai/analyze/organic-rank/a1/product/gpt`, payload, { timeout: 90000 });
			setGptResult(res.data || null);
			setToast('GPT 제안 생성 완료');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? 'GPT 의뢰 실패';
			setError(String(msg));
			setGptResult(null);
		} finally {
			setGptRunning(false);
		}
	};

	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<div className="card">
				<div className="card-title">A-1. 오가닉(검색/쇼핑) 순위 분석 — 상품 중심</div>
				<div className="card-caption">
					상품별 이슈 탐지(방어) + 성장 기회 발굴(확장)을 한 화면에서 빠르게 판단합니다.
				</div>

				<div style={{ display: 'flex', gap: 10, alignItems: 'end', marginTop: 10, flexWrap: 'wrap' }}>
					<div style={{ display: 'grid', gap: 6, minWidth: 320 }}>
						<label className="field-label">기간(사용자 지정)</label>
						<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
							<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
								<input
									className="input"
									style={{ width: 160 }}
									type="date"
									value={dateRange.fromYmd}
									onChange={(e) => setDateRange((prev) => ({ ...prev, fromYmd: String(e.target.value || '').trim() }))}
								/>
								<span style={{ color: '#94a3b8', fontWeight: 900 }}>~</span>
								<input
									className="input"
									style={{ width: 160 }}
									type="date"
									value={dateRange.toYmd}
									onChange={(e) => setDateRange((prev) => ({ ...prev, toYmd: String(e.target.value || '').trim() }))}
								/>
							</div>
							<div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
								<button type="button" className="btn-ghost" onClick={() => setDateRange(defaultA1LastNDaysRange(7))} disabled={running}>
									최근 7일
								</button>
								<button type="button" className="btn-ghost" onClick={() => setDateRange(defaultA1LastNDaysRange(30))} disabled={running}>
									최근 30일
								</button>
								<button type="button" className="btn-ghost" onClick={() => setDateRange(defaultA1LastNDaysRange(90))} disabled={running}>
									최근 90일
								</button>
								<span style={{ fontSize: 12, fontWeight: 900, color: '#cbd5e1' }} title="서버 분석 기준 일수(최대 90일)">
									{days}일
								</span>
							</div>
						</div>
						<div style={{ fontSize: 11, color: '#94a3b8' }}>
							기간이 90일을 초과하면 자동으로 <b>끝 날짜를 기준으로 90일</b>로 축소됩니다.
						</div>
					</div>
					<div style={{ display: 'grid', gap: 6, width: 180 }}>
						<label className="field-label">GPT 모델</label>
						<select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
							<option value="gpt-4o-mini">gpt-4o-mini (기본)</option>
							<option value="gpt-4o">gpt-4o</option>
							<option value="gpt-5.4-mini">gpt-5.4-mini</option>
							<option value="gpt-5.4">gpt-5.4</option>
							<option value="gpt-5.5">gpt-5.5</option>
						</select>
					</div>
					<div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
						{toast ? <span style={{ fontSize: 12, fontWeight: 900, color: '#bbf7d0' }}>{toast}</span> : null}
						{error ? <span style={{ fontSize: 12, fontWeight: 900, color: '#fda4af' }}>{error}</span> : null}
						<button type="button" className="btn-ghost" onClick={() => navigate('/analytics/ai/organic-rank/trace')} disabled={running}>
							A-1 검증(역추적)
						</button>
						<button type="button" className="btn-primary" onClick={runProducts} disabled={running}>
							{running ? '로딩 중…' : '새로고침'}
						</button>
					</div>
				</div>
			</div>

			<div className="a1-layout" data-testid="a1-layout">
				{/* (1) 상품 리스트 */}
				<div className="card" style={{ padding: 12 }}>
					<div className="card-title">1) 상품별 주요 핵심 지표</div>
					<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
						상품명으로만 노출됩니다. (내부키는 product_url이지만 화면에는 숨김)
					</div>

					<div
						className="a1-products-list"
						data-testid="a1-products-list"
						style={{
							marginTop: 10,
							display: 'grid',
							gap: 6,
							// 화면 높이에 맞춰 자동 조절(내부 세로 스크롤은 유지)
							maxHeight: 'calc(100vh - 280px)',
							overflowX: 'hidden',
							overflowY: 'auto',
							paddingRight: 10,
						}}
					>
						{(productsRes?.products || []).map((p) => {
							const active = p.product_url === selectedProductUrl;
							const best = p.metrics_rollup?.best_rank_latest;
							const worst = p.metrics_rollup?.worst_rank_latest;
							const avg14 = p.metrics_rollup?.avg_rank_14d_mean;
							const tier = (p.status_tier || 'NEED_GROWTH') as StatusTier;
							const tierS = tierColor(tier);
							const downDrivers = (p.top_movers || []).filter((x) => typeof x.rank_change_7d === 'number' && (x.rank_change_7d as number) > 0).slice(0, 2);
							const bc = (p.band_counts || {}) as any;
							return (
								<button
									key={p.product_url}
									type="button"
									className="btn-ghost"
									onClick={() => setSelectedProductUrl(p.product_url)}
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
											title={p.product_title || '(제목 미수집)'}
											style={{
												fontWeight: 950,
												minWidth: 0,
												flex: 1,
												// 좌우 스크롤 없이 더 많이 보이도록: 2줄까지 허용(너무 길면 2줄에서만 생략)
												overflow: 'hidden',
												display: '-webkit-box',
												WebkitBoxOrient: 'vertical',
												WebkitLineClamp: 2,
												overflowWrap: 'anywhere',
												wordBreak: 'break-word',
												lineHeight: 1.25,
											}}
										>
											{p.product_title || '(제목 미수집)'}
										</div>
										<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
											<span
												style={{
													fontSize: 12,
													fontWeight: 950,
													padding: '2px 8px',
													borderRadius: 999,
													color: tierS.fg,
													background: tierS.bg,
													border: `1px solid ${tierS.bd}`,
													minWidth: 84,
													textAlign: 'center',
												}}
												title="상품 상태(오가닉) 요약"
											>
												{tierLabel(tier)}
											</span>
											<span style={{ fontSize: 11, fontWeight: 900, color: p.status_change === 'DOWN' ? '#fda4af' : p.status_change === 'UP' ? '#86efac' : '#94a3b8' }}>
												{changeLabel(p.status_change ?? null)}
											</span>
										</div>
									</div>
									<div style={{ marginTop: 6 }}>{bandBar(p.band_counts, 10)}</div>
									<div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
										<span>1~3위 {Number(bc.top_1_3 ?? 0)}</span>
										<span>4~6위 {Number(bc.top_4_6 ?? 0)}</span>
										<span>7~10위 {Number(bc.top_7_10 ?? 0)}</span>
										<span>11위+ {Number(bc.other_11_plus ?? 0)}</span>
										<span>미노출 {Number(bc.missing ?? 0)}</span>
									</div>
									<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
										<span>키워드 {p.keyword_count}</span>
										<span>최고 {fmtRank(best)}</span>
										<span>최저 {fmtRank(worst)}</span>
										<span>14일 평균 {typeof avg14 === 'number' ? avg14.toFixed(1) : fmt(avg14)}</span>
										{downDrivers.length ? (
											<span
												style={{ color: '#cbd5e1', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
												title="최근 7일 하락(악화) 기여 키워드(상위)"
											>
												하락: {downDrivers.map((d) => `${d.keyword}(+${d.rank_change_7d})`).join(', ')}
											</span>
										) : null}
									</div>
								</button>
							);
						})}
						{(productsRes?.products || []).length === 0 ? (
							<div style={{ fontSize: 12, color: '#94a3b8' }}>상단에서 “상품 핵심지표 로드”를 먼저 실행하세요.</div>
						) : null}
					</div>
				</div>

				{/* (2~6) 상품 상세 */}
				<div className="a1-dashboard">
					<div className="card" style={{ padding: 12 }}>
						<div className="card-title">2) 선택 상품 대시보드</div>
						{selectedProduct ? (
							<div style={{ marginTop: 8, display: 'grid', gap: 10 }}>
								<div style={{ fontSize: 13, fontWeight: 950, color: '#e2e8f0' }}>{selectedProduct.product_title || '(제목 미수집)'}</div>

								{/* 상태 인포그래프 */}
								<div className="card" style={{ padding: 10, border: '1px solid rgba(148,163,184,0.18)' }}>
									<div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
										<div className="field-label" style={{ margin: 0 }}>
											상품 상태(오가닉)
										</div>
										{(() => {
											const t = (selectedProduct.status_tier || 'NEED_GROWTH') as StatusTier;
											const s = tierColor(t);
											return (
												<span style={{ fontSize: 12, fontWeight: 950, padding: '2px 8px', borderRadius: 999, color: s.fg, background: s.bg, border: `1px solid ${s.bd}` }}>
													{tierLabel(t)}
												</span>
											);
										})()}
										<span style={{ fontSize: 11, fontWeight: 900, color: selectedProduct.status_change === 'DOWN' ? '#fda4af' : selectedProduct.status_change === 'UP' ? '#86efac' : '#94a3b8' }}>
											전주 대비: {changeLabel(selectedProduct.status_change ?? null)}
										</span>
										<span style={{ fontSize: 11, color: '#94a3b8' }}>
											(전주: {tierLabel((selectedProduct.status_prev_tier || null) as any)})
										</span>
									</div>
									<div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
										<div>
											<div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>오늘</div>
											{bandBar(selectedProduct.band_counts, 12)}
										</div>
										<div style={{ opacity: 0.75 }}>
											<div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>전주(7d 추정)</div>
											{bandBar(selectedProduct.band_counts_prev, 12)}
										</div>
									</div>
									<div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
										{(() => {
											const c = selectedProduct.band_counts || {};
											return (
												<>
													<span>1~3위 {Number(c.top_1_3 ?? 0)}</span>
													<span>4~6위 {Number(c.top_4_6 ?? 0)}</span>
													<span>7~10위 {Number(c.top_7_10 ?? 0)}</span>
													<span>11위+ {Number(c.other_11_plus ?? 0)}</span>
													<span>미노출 {Number(c.missing ?? 0)}</span>
												</>
											);
										})()}
									</div>
								</div>

								<div className="a1-kpi-grid">
									<KpiCard title="상품 상태(오가닉)" value={kpi.tierLbl} sub={`전주 대비: ${changeLabel(selectedProduct.status_change ?? null)}`} tone={attentionNeeded ? 'bad' : 'good'} />
									<KpiCard title="상위 키워드(1~3)" value={`${kpi.top3}개`} sub={`Top10 합계: ${kpi.top10}개`} tone={kpi.top3 >= 5 ? 'good' : 'neutral'} />
									<KpiCard title="이슈 키워드" value={`${kpi.issues}개`} sub={`하락 Top: ${kpi.moversDown}개`} tone={kpi.issues > 0 ? 'warn' : 'neutral'} />
									<KpiCard title="성장 기회" value={`${kpi.moversUp}개`} sub={`최고 ${fmtRank(kpi.best)} · 최저 ${fmtRank(kpi.worst)}`} tone={kpi.moversUp > 0 ? 'good' : 'neutral'} />
								</div>

								<div className="card" style={{ padding: 12, border: '1px solid rgba(148,163,184,0.18)' }}>
									<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
										<div>
											<div className="card-title" style={{ marginBottom: 0 }}>성과 트렌드</div>
											<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
												대표 키워드: <b style={{ color: '#e2e8f0' }}>{representativeKeyword || '-'}</b> (미노출은 끊김)
											</div>
										</div>
										<div style={{ fontSize: 11, color: '#94a3b8' }}>{rangePayload.date_from} ~ {rangePayload.date_to}</div>
									</div>
									<div style={{ marginTop: 10 }}>
										<RankTrendChart series14={representativeSeries14} />
									</div>
								</div>

								{/* 집중 관리(상태 악화/위험 구간) */}
								{attentionNeeded ? (
									<div className="card" style={{ padding: 12, border: '1px solid rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.06)' }}>
										<div className="card-title">집중 관리 요청(상태 악화/위험 감지)</div>
										<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>
											<b>상태 변화</b>: {tierLabel((selectedProduct.status_prev_tier || null) as any)} → {tierLabel((selectedProduct.status_tier || 'NEED_GROWTH') as any)} ({changeLabel(selectedProduct.status_change ?? null)})
										</div>
										<div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
											<div>
												<div className="field-label">하락 주도 키워드(최근 7일 악화 Top)</div>
												<div style={{ marginTop: 6, overflowX: 'auto' }}>
													<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
														<thead>
															<tr style={{ textAlign: 'left', color: '#94a3b8' }}>
																<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>키워드</th>
																<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>상태</th>
																<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>현재순위</th>
																<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>Δ7d</th>
																<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>하락일(7d)</th>
																<th style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>월검색량</th>
															</tr>
														</thead>
														<tbody style={{ color: '#e2e8f0' }}>
															{downDriverRows.slice(0, 10).map((r) => {
																const risk = kwRiskLabel(r.rank_latest, r.rank_change_7d, r.down_days_7d);
																const d7 = Number(r.rank_change_7d ?? 0);
																return (
																	<tr key={r.keyword}>
														<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.10)' }}>
															<button
																type="button"
																className="btn-ghost"
																style={{ padding: 0, fontWeight: 950, textAlign: 'left' }}
																aria-label={`focus-down-driver-${r.keyword}`}
																onClick={() => focusKeywordFromRiskTable(r.keyword)}
															>
																{r.keyword}
															</button>
														</td>
																		<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.10)', fontWeight: 950, color: risk.color }} title={risk.title}>
																			{risk.label}
																		</td>
																		<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.10)' }}>{fmtRank(r.rank_latest)}</td>
																		<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.10)', fontWeight: 950, color: d7 > 0 ? '#fda4af' : d7 < 0 ? '#86efac' : '#e2e8f0' }}>
																			{Number.isFinite(d7) ? (d7 > 0 ? `+${d7}` : String(d7)) : '-'}
																		</td>
																		<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.10)' }}>{fmt(r.down_days_7d)}</td>
																		<td style={{ padding: '8px 8px', borderBottom: '1px solid rgba(148,163,184,0.10)' }}>{fmt(r.search_volume_month)}</td>
																	</tr>
																);
															})}
															{downDriverRows.length === 0 ? (
																<tr>
																	<td colSpan={6} style={{ padding: '10px 8px', color: '#94a3b8' }}>
																		하락 키워드 데이터가 없습니다.
																	</td>
																</tr>
															) : null}
														</tbody>
													</table>
												</div>
											</div>

											<div>
												<div className="field-label">추천 광고 키워드(우선순위)</div>
												<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
													최근 악화 + (월검색량 우선) 기준으로 추렸습니다. 실제 집행 전 “소재 분석/구매 키워드”와 함께 검증하세요.
												</div>
												<div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
													{recommendedAdKeywords.map((r) => (
														<span key={r.keyword} style={{ fontSize: 12, fontWeight: 950, padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(15,23,42,0.35)', color: '#e2e8f0' }}>
															{r.keyword} <span style={{ color: '#94a3b8' }}>{fmtRank(r.rank_latest)} / Δ{fmt(r.rank_change_7d)}</span>
														</span>
													))}
													{recommendedAdKeywords.length === 0 ? <span style={{ fontSize: 12, color: '#94a3b8' }}>추천 후보가 없습니다.</span> : null}
												</div>
												<div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
													<button
														type="button"
														className="btn-ghost"
														onClick={() =>
															navigate(
																`/analytics/campaign/creatives?product_url=${encodeURIComponent(selectedProduct.product_url || '')}&product=${encodeURIComponent(
																	selectedProduct.product_title || '',
																)}`,
															)
														}
													>
														광고 소재 분석에서 확인
													</button>
													<button
														type="button"
														className="btn-ghost"
														onClick={() => navigate(`/analytics/performance/purchase-keywords?product=${encodeURIComponent(selectedProduct.product_title || '')}`)}
													>
														구매 키워드 분석에서 확인
													</button>
												</div>
											</div>
										</div>
									</div>
								) : null}

								<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
									{(['best_rank_latest', 'worst_rank_latest', 'avg_rank_14d_mean', 'keywords_computed'] as const).map((k) => (
										<div key={k} className="card" style={{ padding: 10 }}>
											<div className="field-label">{metricLabel(k)}</div>
											<div style={{ fontSize: 14, fontWeight: 900 }}>{fmt(selectedProduct.metrics_rollup?.[k])}</div>
										</div>
									))}
								</div>

								<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
									<div className="field-label" style={{ margin: 0 }}>
										키워드 보기
									</div>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setKwViewMode('split')}
										style={{ fontWeight: kwViewMode === 'split' ? 950 : undefined, borderColor: kwViewMode === 'split' ? 'rgba(34,197,94,0.45)' : undefined }}
										title="이슈/기회 섹션을 한 화면에"
									>
										요약(이슈/기회)
									</button>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setKwViewMode('tab')}
										style={{ fontWeight: kwViewMode === 'tab' ? 950 : undefined, borderColor: kwViewMode === 'tab' ? 'rgba(34,197,94,0.45)' : undefined }}
										title="기존 탭 방식(하락/상승/이슈/전체)"
									>
										탭(기존)
									</button>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setKwTab('down')}
										style={{ fontWeight: kwTab === 'down' ? 950 : undefined, borderColor: kwTab === 'down' ? 'rgba(34,197,94,0.45)' : undefined }}
										disabled={kwViewMode !== 'tab'}
									>
										하락 Top
									</button>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setKwTab('up')}
										style={{ fontWeight: kwTab === 'up' ? 950 : undefined, borderColor: kwTab === 'up' ? 'rgba(34,197,94,0.45)' : undefined }}
										disabled={kwViewMode !== 'tab'}
									>
										상승 Top
									</button>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setKwTab('issue')}
										style={{ fontWeight: kwTab === 'issue' ? 950 : undefined, borderColor: kwTab === 'issue' ? 'rgba(34,197,94,0.45)' : undefined }}
										disabled={kwViewMode !== 'tab'}
									>
										지속 이슈
									</button>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setKwTab('all')}
										style={{ fontWeight: kwTab === 'all' ? 950 : undefined, borderColor: kwTab === 'all' ? 'rgba(34,197,94,0.45)' : undefined }}
										disabled={kwViewMode !== 'tab'}
									>
										전체
									</button>
									<div style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>
										선택 키워드: <b style={{ color: '#e2e8f0' }}>{selectedKeywordForPreview ? selectedKeywordForPreview : '-'}</b>
									</div>
									<div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
										<select className="input" value={kwSort} onChange={(e) => setKwSort(e.target.value as any)} style={{ width: 160 }} aria-label="kw-sort">
											<option value="issue">정렬: 이슈점수</option>
											<option value="delta_down">정렬: Δ7d(하락)</option>
											<option value="rank">정렬: 현재순위(상위)</option>
											<option value="volume">정렬: 월검색량</option>
										</select>
										<input
											className="input"
											placeholder="키워드 검색"
											value={kwSearch}
											onChange={(e) => setKwSearch(e.target.value)}
											style={{ width: 200 }}
										/>
										<input className="input" type="number" min={1} max={200} value={kwTopN} onChange={(e) => setKwTopN(Number(e.target.value))} style={{ width: 90 }} />
									</div>
								</div>

								{detailLoading ? <div style={{ fontSize: 12, color: '#94a3b8' }}>상세 로딩 중…</div> : null}

								<div className="a1-detail-grid" data-testid="a1-detail-grid">
									<div style={{ overflow: 'hidden' }}>
										{(() => {
											const renderRow = (row: KeywordRow) => {
												const kw = row.keyword;
												const info = keywordByName[kw];
												const m = info?.metrics || {};
												const active = selectedKeywordForPreview === kw;
												const delta7 = pickMetric(m, 'rank_change_7d', 'rank_change_7d_valid');
												const risk = kwRiskLabel(m.rank_latest, delta7, m.down_days_7d);
												return (
													<div key={kw} className={`a1-keyword-item ${active ? 'active' : ''}`}>
														<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
															<button type="button" className="btn-ghost" onClick={() => setSelectedKeywordForPreview(kw)} style={{ padding: 0, fontWeight: 950, textAlign: 'left' }}>
																{kw} {active ? <span style={{ fontSize: 11, color: '#86efac' }}>(선택됨)</span> : null}
															</button>
															<span className={`a1-pill ${risk.label === '안정' ? 'good' : risk.label === '주의' ? 'warn' : 'bad'}`} title={risk.title}>
																{risk.label}
															</span>
															<label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#cbd5e1' }}>
																<input type="checkbox" checked={!!selectedKeywords[kw]} onChange={() => toggleKeyword(kw)} />
																GPT 포함
															</label>
														</div>
														<div className="a1-kv">
															<span>{metricLabel('rank_latest')} <b style={{ color: '#e2e8f0' }}>{fmtRank(row.rank_latest)}</b></span>
															<span>{metricLabel('rank_change_7d')} <b style={{ color: Number(row.rank_change_7d ?? 0) > 0 ? '#fda4af' : Number(row.rank_change_7d ?? 0) < 0 ? '#86efac' : '#e2e8f0' }}>{fmt(row.rank_change_7d)}</b></span>
															<span>하락일(7d) <b style={{ color: '#e2e8f0' }}>{fmt(row.down_days_7d)}</b></span>
															<span>{metricLabel('search_volume_month')} <b style={{ color: '#e2e8f0' }}>{fmt(row.search_volume_month)}</b></span>
															<span>이슈점수 <b style={{ color: '#e2e8f0' }}>{fmt(row.issue_score)}</b></span>
														</div>
													</div>
												);
											};

											if (kwViewMode === 'split') {
												const issues = keywordRowsSplit.issues;
												const opps = keywordRowsSplit.opportunities;
												return (
													<div style={{ display: 'grid', gap: 12, maxHeight: 340, overflow: 'auto' }}>
														<div>
															<div className="a1-section-head">
																<div className="title">이슈(방어)</div>
																<div className="meta">Top {issues.length}</div>
															</div>
															<div style={{ display: 'grid', gap: 6 }}>
																{issues.map(renderRow)}
																{issues.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>이슈 키워드가 없습니다.</div> : null}
															</div>
														</div>
														<div>
															<div className="a1-section-head">
																<div className="title">기회(성장)</div>
																<div className="meta">Top {opps.length}</div>
															</div>
															<div style={{ display: 'grid', gap: 6 }}>
																{opps.map(renderRow)}
																{opps.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>기회 키워드가 없습니다.</div> : null}
															</div>
														</div>
													</div>
												);
											}

											// tab
											return (
												<div style={{ display: 'grid', gap: 6, maxHeight: 340, overflow: 'auto' }}>
													{keywordRowsForTab.map(renderRow)}
													{keywordRowsForTab.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>표시할 키워드가 없습니다.</div> : null}
												</div>
											);
										})()}
									</div>

									{/* 키워드 미리보기 */}
									<div className="card" style={{ padding: 12 }} data-testid="a1-keyword-preview">
										<div className="card-title" style={{ marginBottom: 6 }}>
											키워드 상세
										</div>
										{selectedKeywordForPreview ? (
											(() => {
												const info = keywordByName[selectedKeywordForPreview];
												if (!info) return <div style={{ fontSize: 12, color: '#94a3b8' }}>데이터가 없습니다.</div>;
												const m = info.metrics || {};
												const series = info.rank_series_14d || [];
												return (
													<div style={{ display: 'grid', gap: 8 }}>
														<div style={{ fontWeight: 950, color: '#e2e8f0' }}>{selectedKeywordForPreview}</div>
														<div style={{ fontSize: 12, color: '#cbd5e1' }}>
															<b>판정</b>: {info.decision} {typeof info.confidence === 'number' ? `· ${(info.confidence * 100).toFixed(0)}%` : ''}
														</div>
														<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
															{(['rank_latest', 'rank_change_7d', 'avg_rank_14d', 'rank_volatility_14d', 'valid_days_14d', 'missing_ratio_14d'] as const).map((k) => (
																<div key={k} className="card" style={{ padding: 10 }}>
																	<div className="field-label">{metricLabel(k)}</div>
																	<div style={{ fontSize: 14, fontWeight: 900 }}>
																		{k === 'rank_latest'
																			? fmtRank(m.rank_latest)
																			: k === 'rank_change_7d'
																				? fmt(pickMetric(m, 'rank_change_7d', 'rank_change_7d_valid'))
																				: fmt(m[k])}
																	</div>
																</div>
															))}
														</div>
														<div>
															<div className="field-label">최근 14일 트렌드(순위)</div>
															<div className="card" style={{ padding: 10, border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.18)' }}>
																<RankTrendChart series14={series} />
															</div>
															<details style={{ marginTop: 8 }}>
																<summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 900, color: '#cbd5e1' }}>원본(텍스트) 보기</summary>
																<pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: '#e2e8f0', background: 'rgba(15,23,42,0.35)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 8, padding: 10, maxHeight: 180, overflow: 'auto' }}>
																	{series
																		.map((x) => {
																			const rk = (x as any)?.rank;
																			const out = typeof rk === 'number' && rk >= 999 ? '미노출' : String(rk);
																			return `${x.date}: ${out}`;
																		})
																		.join('\n')}
																</pre>
															</details>
														</div>
													</div>
												);
											})()
										) : (
											<div style={{ fontSize: 12, color: '#94a3b8' }}>좌측에서 키워드를 클릭하세요.</div>
										)}
									</div>
								</div>

								{/* (3) GPT 의뢰 */}
								<div className="card" style={{ padding: 12, border: '1px solid rgba(148,163,184,0.18)' }}>
									<div className="card-title">3) GPT 분석 의뢰</div>
									<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
										상품 단위로 선택한 키워드 범위를 GPT에 전달하고, 제안은 Trace로 검증할 수 있습니다.
									</div>
									<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginTop: 10 }}>
										<div style={{ display: 'grid', gap: 6 }}>
											<label className="field-label">키워드 범위</label>
											<select className="input" value={gptMode} onChange={(e) => setGptMode(e.target.value as any)}>
												<option value="topN">Top N(이슈 상위)</option>
												<option value="specific">선택 키워드(체크)</option>
												<option value="all">전체(최대 50)</option>
											</select>
										</div>
										{gptMode === 'topN' ? (
											<div style={{ display: 'grid', gap: 6, width: 120 }}>
												<label className="field-label">Top N</label>
												<input className="input" type="number" min={1} max={50} value={gptTopN} onChange={(e) => setGptTopN(Number(e.target.value))} />
											</div>
										) : null}
										{gptMode === 'specific' ? (
											<div style={{ fontSize: 12, color: '#cbd5e1' }}>
												선택됨: <b>{selectedKeywordList.length}</b>
											</div>
										) : null}
										<div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
											<button type="button" className="btn-primary" onClick={runProductGpt} disabled={gptRunning || (gptMode === 'specific' && selectedKeywordList.length === 0)}>
												{gptRunning ? 'GPT 분석 중…' : '실행'}
											</button>
										</div>
									</div>
								</div>

								{/* (4) GPT 결과 */}
								{gptResult ? (
									<div className="card" style={{ padding: 12 }}>
										<div className="card-title">4) GPT 분석 내용(제안)</div>
										<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>
											<b>대상 키워드</b>: {gptResult.selected_keywords.join(', ')}
										</div>
										<div style={{ marginTop: 10 }}>
											<div className="field-label">요약</div>
											<pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: '#e2e8f0', background: 'rgba(15,23,42,0.35)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 8, padding: 10, minHeight: 120 }}>
												{gptResult.analysis_markdown || ''}
											</pre>
										</div>
										<div style={{ marginTop: 10 }}>
											<div className="field-label">추천 액션</div>
											<div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
												{(gptResult.recommended_actions || []).map((a, idx) => (
													<div key={idx} className="card" style={{ padding: 10, border: '1px solid rgba(148,163,184,0.18)' }}>
														<div style={{ fontWeight: 950, color: '#e2e8f0' }}>
															[{a.priority || 'P?'}] {a.title}
														</div>
														<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>
															<b>이유</b>: {a.why}
														</div>
														<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>
															<b>방법</b>: {a.how}
														</div>
													</div>
												))}
												{(gptResult.recommended_actions || []).length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>추천 액션이 없습니다.</div> : null}
											</div>
										</div>

										<div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
											<button
												type="button"
												className="btn-primary"
												onClick={() => {
													const rid = String(gptResult.trace_run_id || '').trim();
													const sid = String(gptResult.trace_sku_id || '').trim();
													if (!rid || !sid) return;
													navigate(`/analytics/ai/organic-rank/trace?run_id=${encodeURIComponent(rid)}&sku_id=${encodeURIComponent(sid)}`);
												}}
												disabled={!gptResult.trace_run_id || !gptResult.trace_sku_id}
											>
												5) 제안 검증(Trace 열기)
											</button>
											<div style={{ fontSize: 11, color: '#94a3b8' }}>
												Trace 화면에서 원본/규칙/요약을 클릭으로 검증하고, 액션별 수락/미수락 기록을 남깁니다.
											</div>
										</div>
									</div>
								) : null}
							</div>
						) : (
							<div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
								좌측에서 상품을 선택하거나, 먼저 “상품 핵심지표 로드”를 실행하세요.
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

