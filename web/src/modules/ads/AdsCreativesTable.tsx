import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatFloatUpTo2, formatInt, formatPct, formatPctInt, formatWon } from './format';
import type { MetricComputed, MetricDeltas } from './adsMetrics';

export type CreativeAggRow = {
	key: string;
	campaignName: string;
	adgroupName: string;
	creativeId: string;
	adType?: string | null;
	creativeName: string;
	displayKeyword?: string | null;
	productTitle?: string | null;
	imageUrl?: string | null;
	detailCollectedAt?: string | null;
	detailLastError?: string | null;
	creativeType?: string | null;
	profileName?: string | null;
	profileImageUrl?: string | null;
	primaryText?: string | null;
	headline?: string | null;
	description?: string | null;
	cta?: string | null;
	landingUrl?: string | null;
	currentBid?: number | null;
	prevCurrentBid?: number | null;
	qualityIndex?: number | null;
	prevQualityIndex?: number | null;
	avgRank?: number | null;
	prevAvgRank?: number | null;
	organicKeyword?: string | null;
	organicRank?: number | null;
	prevOrganicRank?: number | null;
	organicRankSource?: string | null;
	organicRankDate?: string | null;
	prevOrganicRankDate?: string | null;
	matchStatus?: string | null;
	matchRule?: string | null;
	matchedProductUrl?: string | null;
	matchedProductTitle?: string | null;

	metrics: MetricComputed;
	prevMetrics: MetricComputed;
	deltas: MetricDeltas;
	purchaseMetrics?: { conversions: number; revenue: number };
	prevPurchaseMetrics?: { conversions: number; revenue: number };
	cpa: number; // cost per acquisition
	prevCpa: number;
	cpaDiff: number;
	cpaPct: number | null;
};

export type CreativeColumnKey =
	| 'creative'
	| 'creativeCondition'
	| 'detailStatus'
	| 'bid'
	| 'quality'
	| 'avgRank'
	| 'organicRank'
	| 'impressions'
	| 'clicks'
	| 'ctr'
	| 'cpc'
	| 'cost'
	| 'conversions'
	| 'purchase_conversions'
	| 'purchase_cvr'
	| 'cvr'
	| 'revenue'
	| 'purchase_revenue'
	| 'purchase_roas'
	| 'roas'
	| 'cpa';

const DETAIL_COMPLETED_STATUS_LABELS: Record<string, string> = {
	gfa_creative_detail_completed_empty_editor: '완료(데이터 없음)',
	gfa_creative_detail_completed_remote_error_page: '완료(광고센터 오류)',
};

function getDetailStatusMeta(detailLastError?: string | null, detailCollectedAt?: string | null): { label: string; color: string; title: string; sortText: string } {
	const error = String(detailLastError || '').trim();
	const collectedAt = String(detailCollectedAt || '').trim();
	const completedLabel = DETAIL_COMPLETED_STATUS_LABELS[error];
	if (completedLabel) {
		return {
			label: completedLabel,
			color: '#fcd34d',
			title: error,
			sortText: `완료: ${completedLabel}`,
		};
	}
	if (error) {
		return {
			label: '오류',
			color: '#fca5a5',
			title: error,
			sortText: `오류: ${error}`,
		};
	}
	if (collectedAt) {
		return {
			label: '완료',
			color: '#86efac',
			title: `수집시각: ${collectedAt}`,
			sortText: `완료: ${collectedAt}`,
		};
	}
	return {
		label: '미수집',
		color: '#94a3b8',
		title: 'GFA 소재 컨디션 수집 전',
		sortText: '미수집',
	};
}

function DeltaBadge(props: { diff: number; pct: number | null; kind: 'int' | 'won' | 'pct' | 'float'; computed: boolean }): JSX.Element {
	const diff = props.diff;
	if (!props.computed || !Number.isFinite(diff)) {
		return (
			<span className="delta-badge na" title="비교기간 대비 증감(비교불가/미수집)">
				N/A
			</span>
		);
	}
	if (diff === 0) {
		return (
			<span className="delta-badge flat" title="비교기간 대비 증감(변동없음)">
				-
			</span>
		);
	}
	const up = diff > 0;
	const cls = up ? 'delta-badge up' : 'delta-badge down';
	const arrow = up ? '▲' : '▼';
	const absDiff = Math.abs(diff);
	const absPct = props.pct == null ? null : Math.abs(props.pct);

	const diffText =
		props.kind === 'won' ? `${arrow} ${formatInt(absDiff)}원` :
		props.kind === 'float' ? `${arrow} ${formatFloatUpTo2(absDiff)}` :
		props.kind === 'pct' ? `${arrow} ${formatPctInt(absDiff)}` :
		`${arrow} ${formatInt(absDiff)}`;
	const pctText = absPct == null ? null : `(${formatPctInt(absPct)})`;

	return (
		<span className={cls} title="비교기간 대비 증감">
			<span className="delta-diff">{diffText}</span>
			{pctText ? <span className="delta-pct">{pctText}</span> : null}
		</span>
	);
}

function MetricCell(props: { value: number; diff: number; pct: number | null; kind: 'int' | 'won' | 'pct' }): JSX.Element {
	const text =
		props.kind === 'won' ? formatWon(props.value) :
		props.kind === 'pct' ? formatPct(props.value) :
		formatInt(props.value);
	return (
		<div className="metric-cell">
			<div className="metric-value">{text}</div>
			<DeltaBadge diff={props.diff} pct={props.pct} kind={props.kind} computed={true} />
		</div>
	);
}

function renderNumberOrDash(v: number | null | undefined, suffix?: string): string {
	if (v == null || !Number.isFinite(Number(v))) return '-';
	if (suffix) return `${formatInt(Number(v))}${suffix}`;
	return formatInt(Number(v));
}

function metaPct(curr: number | null | undefined, prev: number | null | undefined): number | null {
	const c = curr == null ? null : Number(curr);
	const p = prev == null ? null : Number(prev);
	if (c == null || p == null) return null;
	if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
	return ((c - p) / p) * 100;
}

function MetaCell(props: {
	value: number | null | undefined;
	prev: number | null | undefined;
	kind: 'won' | 'float';
}): JSX.Element {
	const v = props.value == null ? null : Number(props.value);
	const p = props.prev == null ? null : Number(props.prev);
	const computed = (v != null && p != null && Number.isFinite(v) && Number.isFinite(p));
	const diff = computed ? (v as number) - (p as number) : 0;
	const pct = metaPct(v, p);
	const text =
		props.kind === 'won' ? formatWon(v) : formatFloatUpTo2(v);
	return (
		<div className="metric-cell">
			<div className="metric-value">{text}</div>
			<DeltaBadge diff={diff} pct={pct} kind={props.kind === 'won' ? 'won' : 'float'} computed={computed} />
		</div>
	);
}

export function AdsCreativesTable(props: {
	title: string;
	rows: CreativeAggRow[];
	collapsed?: boolean;
	mode?: 'powerlink' | 'shopping';
	validationStatus?: 'ok' | 'fix' | 'unknown';
	visibleColumnKeys?: CreativeColumnKey[];
	onRowClick?: (row: CreativeAggRow) => void;
	selectedRowKey?: string | null;
}): JSX.Element {
	type SortKey = CreativeColumnKey;

	const showOrganicRank = (props.mode ?? 'shopping') === 'shopping';
	const hasPurchaseMetrics = useMemo(
		() => props.rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics),
		[props.rows],
	);
	const hasCreativeDetail = useMemo(
		() => props.rows.some((row) =>
			Boolean(row.detailCollectedAt || row.detailLastError || row.creativeType || row.profileName || row.primaryText || row.headline || row.description || row.cta || row.landingUrl),
		),
		[props.rows],
	);
	const hasGfaRows = useMemo(
		() => props.rows.some((row) => String(row.adType || '').toUpperCase() === 'GFA'),
		[props.rows],
	);

	const defaultColumnKeys = useMemo<CreativeColumnKey[]>(
		() => [
			'creative',
			...(hasCreativeDetail || hasGfaRows ? (['creativeCondition', 'detailStatus'] as CreativeColumnKey[]) : []),
			'bid',
			'quality',
			'avgRank',
			...(showOrganicRank ? (['organicRank'] as CreativeColumnKey[]) : []),
			'impressions',
			'clicks',
			'ctr',
			'cpc',
			'cost',
			'conversions',
			...(hasPurchaseMetrics ? (['purchase_conversions'] as CreativeColumnKey[]) : []),
			...(hasPurchaseMetrics ? (['purchase_cvr'] as CreativeColumnKey[]) : []),
			'cvr',
			'revenue',
			...(hasPurchaseMetrics ? (['purchase_revenue'] as CreativeColumnKey[]) : []),
			...(hasPurchaseMetrics ? (['purchase_roas'] as CreativeColumnKey[]) : []),
			'roas',
			'cpa',
		],
		[hasCreativeDetail, hasGfaRows, hasPurchaseMetrics, showOrganicRank],
	);

	const visibleColumnKeys = useMemo<CreativeColumnKey[]>(() => {
		if (!props.visibleColumnKeys || props.visibleColumnKeys.length === 0) return defaultColumnKeys;
		const allowed = new Set<CreativeColumnKey>(defaultColumnKeys);
		const filtered = props.visibleColumnKeys.filter((key) => allowed.has(key));
		return filtered.length > 0 ? filtered : defaultColumnKeys;
	}, [defaultColumnKeys, props.visibleColumnKeys]);

	const [sortKey, setSortKey] = useState<SortKey>('cost');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
	const tableRef = useRef<HTMLTableElement | null>(null);
	const topScrollRef = useRef<HTMLDivElement | null>(null);
	const bottomScrollRef = useRef<HTMLDivElement | null>(null);
	const syncingRef = useRef<'top' | 'bottom' | null>(null);
	const [scrollWidthPx, setScrollWidthPx] = useState(0);

	useEffect(() => {
		if (visibleColumnKeys.includes(sortKey)) return;
		setSortKey((visibleColumnKeys[0] ?? 'cost') as SortKey);
		setSortDir('desc');
	}, [sortKey, visibleColumnKeys]);

	const sorted = useMemo(() => {
		const dir = sortDir === 'asc' ? 1 : -1;
		const valueOf = (r: CreativeAggRow): string | number => {
			switch (sortKey) {
				case 'creative': return ((props.mode ?? 'shopping') === 'powerlink' ? (r.displayKeyword || r.creativeName) : r.creativeName) || '';
				case 'creativeCondition': return [r.creativeType, r.profileName, r.primaryText, r.headline, r.cta].filter(Boolean).join(' ');
				case 'detailStatus': return getDetailStatusMeta(r.detailLastError, r.detailCollectedAt).sortText;
				case 'bid': return Number(r.currentBid ?? -1);
				case 'quality': return Number(r.qualityIndex ?? -1);
				case 'avgRank': return Number(r.avgRank ?? -1);
				case 'organicRank': return Number(r.organicRank ?? -1);
				case 'impressions': return r.metrics.impressions;
				case 'clicks': return r.metrics.clicks;
				case 'ctr': return r.metrics.ctr;
				case 'cpc': return r.metrics.cpc;
				case 'cost': return r.metrics.cost;
				case 'conversions': return r.metrics.conversions;
				case 'purchase_conversions': return r.purchaseMetrics?.conversions ?? 0;
				case 'purchase_cvr': {
					const purchaseConversions = r.purchaseMetrics?.conversions ?? 0;
					const clicks = r.metrics.clicks ?? 0;
					return clicks > 0 ? (purchaseConversions / clicks) * 100 : 0;
				}
				case 'cvr': return r.metrics.cvr;
				case 'revenue': return r.metrics.revenue;
				case 'purchase_revenue': return r.purchaseMetrics?.revenue ?? 0;
				case 'purchase_roas': {
					const purchaseRevenue = r.purchaseMetrics?.revenue ?? 0;
					const cost = r.metrics.cost ?? 0;
					return cost > 0 ? (purchaseRevenue / cost) * 100 : 0;
				}
				case 'roas': return r.metrics.roas;
				case 'cpa': return r.cpa;
				default: return r.metrics.cost;
			}
		};
		const cp = [...props.rows];
		cp.sort((a, b) => {
			const va = valueOf(a);
			const vb = valueOf(b);
			if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
			return String(va).localeCompare(String(vb), 'ko') * dir;
		});
		return cp;
	}, [props.rows, sortKey, sortDir]);

	const total = useMemo(() => {
		const rows = props.rows || [];
		const sum = {
			impressions: 0,
			clicks: 0,
			cost: 0,
			conversions: 0,
			revenue: 0,
			purchaseConversions: 0,
			purchaseRevenue: 0,
		};
		const prev = { ...sum };
		for (const r of rows) {
			sum.impressions += Number(r.metrics.impressions) || 0;
			sum.clicks += Number(r.metrics.clicks) || 0;
			sum.cost += Number(r.metrics.cost) || 0;
			sum.conversions += Number(r.metrics.conversions) || 0;
			sum.revenue += Number(r.metrics.revenue) || 0;
			sum.purchaseConversions += Number(r.purchaseMetrics?.conversions) || 0;
			sum.purchaseRevenue += Number(r.purchaseMetrics?.revenue) || 0;

			prev.impressions += Number(r.prevMetrics.impressions) || 0;
			prev.clicks += Number(r.prevMetrics.clicks) || 0;
			prev.cost += Number(r.prevMetrics.cost) || 0;
			prev.conversions += Number(r.prevMetrics.conversions) || 0;
			prev.revenue += Number(r.prevMetrics.revenue) || 0;
			prev.purchaseConversions += Number(r.prevPurchaseMetrics?.conversions) || 0;
			prev.purchaseRevenue += Number(r.prevPurchaseMetrics?.revenue) || 0;
		}

		const compute = (t: typeof sum): MetricComputed => {
			const imp = t.impressions;
			const clk = t.clicks;
			const cost = t.cost;
			const conv = t.conversions;
			const rev = t.revenue;
			const ctr = imp > 0 ? (clk / imp) * 100.0 : 0;
			const cpc = clk > 0 ? cost / clk : 0;
			const cvr = clk > 0 ? (conv / clk) * 100.0 : 0;
			const roas = cost > 0 ? (rev / cost) * 100.0 : 0;
			return { impressions: imp, clicks: clk, cost, conversions: conv, revenue: rev, ctr, cpc, cvr, roas };
		};

		const currM = compute(sum);
		const prevM = compute(prev);
		const deltas: MetricDeltas = {
			impressions: { diff: currM.impressions - prevM.impressions, pct: prevM.impressions > 0 ? ((currM.impressions - prevM.impressions) / prevM.impressions) * 100 : null },
			clicks: { diff: currM.clicks - prevM.clicks, pct: prevM.clicks > 0 ? ((currM.clicks - prevM.clicks) / prevM.clicks) * 100 : null },
			cost: { diff: currM.cost - prevM.cost, pct: prevM.cost > 0 ? ((currM.cost - prevM.cost) / prevM.cost) * 100 : null },
			conversions: { diff: currM.conversions - prevM.conversions, pct: prevM.conversions > 0 ? ((currM.conversions - prevM.conversions) / prevM.conversions) * 100 : null },
			revenue: { diff: currM.revenue - prevM.revenue, pct: prevM.revenue > 0 ? ((currM.revenue - prevM.revenue) / prevM.revenue) * 100 : null },
			ctr: { diff: currM.ctr - prevM.ctr, pct: prevM.ctr > 0 ? ((currM.ctr - prevM.ctr) / prevM.ctr) * 100 : null },
			cpc: { diff: currM.cpc - prevM.cpc, pct: prevM.cpc > 0 ? ((currM.cpc - prevM.cpc) / prevM.cpc) * 100 : null },
			cvr: { diff: currM.cvr - prevM.cvr, pct: prevM.cvr > 0 ? ((currM.cvr - prevM.cvr) / prevM.cvr) * 100 : null },
			roas: { diff: currM.roas - prevM.roas, pct: prevM.roas > 0 ? ((currM.roas - prevM.roas) / prevM.roas) * 100 : null },
		};

		const cpa = currM.conversions > 0 ? Math.round(currM.cost / currM.conversions) : 0;
		const prevCpa = prevM.conversions > 0 ? Math.round(prevM.cost / prevM.conversions) : 0;
		const cpaDiff = cpa - prevCpa;
		const cpaPct = prevCpa > 0 ? (cpaDiff / prevCpa) * 100 : null;

		return {
			currM,
			prevM,
			deltas,
			cpa,
			cpaDiff,
			cpaPct,
			purchaseCurr: { conversions: sum.purchaseConversions, revenue: sum.purchaseRevenue },
			purchasePrev: { conversions: prev.purchaseConversions, revenue: prev.purchaseRevenue },
		};
	}, [props.rows]);

	const toggleSort = (k: SortKey) => {
		setSortKey((cur) => {
			if (cur === k) {
				setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
				return cur;
			}
			setSortDir('desc');
			return k;
		});
	};
	const sortIndicator = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '↕');
	const SortTh = (p: { sortKey: SortKey; className: string; label: string }) => (
		<th className={p.className}>
			<button
				type="button"
				onClick={() => toggleSort(p.sortKey)}
				style={{
					all: 'unset',
					cursor: 'pointer',
					display: 'flex',
					alignItems: 'center',
					justifyContent: p.className === 'th-left' ? 'flex-start' : 'flex-end',
					gap: 6,
					width: '100%',
					fontWeight: 900,
				}}
			>
				<span
					style={{
						flex: '1 1 auto',
						minWidth: 0,
						whiteSpace: 'normal',
						wordBreak: 'keep-all',
						lineHeight: 1.25,
						textAlign: p.className === 'th-left' ? 'left' : 'right',
					}}
				>
					{p.label}
				</span>
				<span style={{ opacity: sortKey === p.sortKey ? 1 : 0.35, flex: '0 0 auto' }}>{sortIndicator(p.sortKey)}</span>
			</button>
		</th>
	);

	const colSpan = visibleColumnKeys.length;
	// table-layout: fixed 이라서, 첫 컬럼 폭을 명시하지 않으면 "소재명" 영역이 과도하게 좁아져 텍스트가 잘릴 수 있다.
	// (스크린샷: 소재명 헤더 폭이 너무 좁음)
	const creativeColWidthPx = 340;

	const columnWidthPx: Record<CreativeColumnKey, number> = {
		creative: creativeColWidthPx,
		creativeCondition: 360,
		detailStatus: 120,
		bid: 108,
		quality: 92,
		avgRank: 108,
		organicRank: 96,
		impressions: 92,
		clicks: 82,
		ctr: 88,
		cpc: 108,
		cost: 110,
		conversions: 84,
		purchase_conversions: 96,
		purchase_cvr: 104,
		cvr: 88,
		revenue: 126,
		purchase_revenue: 126,
		purchase_roas: 132,
		roas: 120,
		cpa: 110,
	};
	const tableMinWidthPx = useMemo(
		() => visibleColumnKeys.reduce((sum, key) => sum + (columnWidthPx[key] ?? 100), 0),
		[visibleColumnKeys],
	);

	useEffect(() => {
		const updateScrollWidth = () => {
			const width = tableRef.current?.scrollWidth ?? tableMinWidthPx;
			setScrollWidthPx(width);
		};
		updateScrollWidth();
		if (typeof window === 'undefined') return;
		window.addEventListener('resize', updateScrollWidth);
		return () => window.removeEventListener('resize', updateScrollWidth);
	}, [props.rows, tableMinWidthPx, visibleColumnKeys]);

	const columnLabel = (key: CreativeColumnKey): string => {
		switch (key) {
			case 'creative': return (props.mode ?? 'shopping') === 'powerlink' ? '키워드' : '소재명';
			case 'creativeCondition': return '소재 컨디션';
			case 'detailStatus': return '상세수집';
			case 'bid': return '현재입찰가(CPC)';
			case 'quality': return (props.mode ?? 'shopping') === 'powerlink' ? '광고 연관지수' : '품질지수';
			case 'avgRank':
				return (props.mode ?? 'shopping') === 'powerlink' ? '클릭 기대지수' : '평균노출순위';
			case 'organicRank': return '오가닉순위';
			case 'impressions': return '노출수';
			case 'clicks': return '클릭수';
			case 'ctr': return '클릭율(%)';
			case 'cpc': return '평균클릭비용';
			case 'cost': return '총비용';
			case 'conversions': return hasPurchaseMetrics ? '총전환수' : '전환수';
			case 'purchase_conversions': return '구매전환수';
			case 'purchase_cvr': return '구매전환율(%)';
			case 'cvr': return '전환율(%)';
			case 'revenue': return hasPurchaseMetrics ? '총전환매출액' : '전환매출액';
			case 'purchase_revenue': return '구매전환매출액';
			case 'purchase_roas': return '구매전환수익율(%)';
			case 'roas': return '광고수익율(%)';
			case 'cpa': return '전환당비용';
			default: return '';
		}
	};

	const purchaseRoasValue = (row: CreativeAggRow): number => {
		const purchaseRevenue = row.purchaseMetrics?.revenue ?? 0;
		const cost = row.metrics.cost ?? 0;
		return cost > 0 ? (purchaseRevenue / cost) * 100 : 0;
	};

	const purchaseRoasPrevValue = (row: CreativeAggRow): number => {
		const purchaseRevenue = row.prevPurchaseMetrics?.revenue ?? 0;
		const cost = row.prevMetrics.cost ?? 0;
		return cost > 0 ? (purchaseRevenue / cost) * 100 : 0;
	};

	const purchaseCvrValue = (row: CreativeAggRow): number => {
		const purchaseConversions = row.purchaseMetrics?.conversions ?? 0;
		const clicks = row.metrics.clicks ?? 0;
		return clicks > 0 ? (purchaseConversions / clicks) * 100 : 0;
	};

	const purchaseCvrPrevValue = (row: CreativeAggRow): number => {
		const purchaseConversions = row.prevPurchaseMetrics?.conversions ?? 0;
		const clicks = row.prevMetrics.clicks ?? 0;
		return clicks > 0 ? (purchaseConversions / clicks) * 100 : 0;
	};

	const organicTooltip = (r: CreativeAggRow): string => {
		const kw = String(r.organicKeyword || '').trim();
		if (!kw) return '키워드 추출 실패(광고그룹명: ##_##_키워드 규칙 확인)';

		const ms = String(r.matchStatus || '').trim();
		const matchedUrl = String(r.matchedProductUrl || '').trim();
		if (!matchedUrl || (ms && ms !== 'matched')) {
			const st = ms || 'unknown';
			return `제품 매칭 실패(${st}) · 키워드: ${kw}`;
		}

		const src = String(r.organicRankSource || 'none');
		const d = String(r.organicRankDate || '').trim();
		const datePart = d ? ` · 적용일: ${d}` : '';
		if (r.organicRank == null || !Number.isFinite(Number(r.organicRank))) {
			return `순위 데이터 없음(미수집/범위밖) · 키워드: ${kw}${datePart} · source: ${src}`;
		}
		const prev = r.prevOrganicRank == null || !Number.isFinite(Number(r.prevOrganicRank)) ? null : Number(r.prevOrganicRank);
		const prevPart = prev == null ? '' : ` · 비교: ${renderNumberOrDash(prev)}`;
		return `키워드: ${kw} · 오가닉순위: ${renderNumberOrDash(r.organicRank)}${prevPart}${datePart} · source: ${src}`;
	};

	const OrganicRankCell = (p: { curr: number | null | undefined; prev: number | null | undefined }): JSX.Element => {
		const c = p.curr == null ? null : Number(p.curr);
		const pr = p.prev == null ? null : Number(p.prev);
		const computed = c != null && pr != null && Number.isFinite(c) && Number.isFinite(pr);
		// 순위는 작을수록 좋음 → 개선이면 ▲가 뜨도록 (prev - curr)을 diff로 사용
		const diff = computed ? (pr as number) - (c as number) : 0;
		return (
			<div className="metric-cell">
				<div className="metric-value">{renderNumberOrDash(c)}</div>
				<DeltaBadge diff={diff} pct={null} kind="int" computed={computed} />
			</div>
		);
	};

	const renderCreativeInfoCell = (r: CreativeAggRow): JSX.Element => (
		<td className="td-left" style={{ width: creativeColWidthPx }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
				{r.imageUrl ? (
					<img
						src={r.imageUrl}
						alt=""
						style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(148,163,184,0.18)' }}
					/>
				) : (
					<div
						style={{
							width: 42,
							height: 42,
							borderRadius: 8,
							background: 'rgba(148,163,184,0.12)',
							border: '1px solid rgba(148,163,184,0.18)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: 10,
							fontWeight: 900,
							color: '#9ca3af',
							flex: '0 0 auto',
						}}
						title="이미지 없음(텍스트 소재일 수 있음)"
					>
						TEXT
					</div>
				)}
				<div style={{ minWidth: 0 }}>
					{(() => {
						const isPowerlink = (props.mode ?? 'shopping') === 'powerlink';
						const name = String(r.creativeName || '').trim();
						const id = String(r.creativeId || '').trim();
						const displayKeyword = String(r.displayKeyword || '').trim();
						const productTitle = String(r.productTitle || '').trim();
						const isNameOk = Boolean(name) && name !== id;
						const displayName = isPowerlink
							? (displayKeyword || (isNameOk ? name : '키워드(미수집)'))
							: (isNameOk ? name : (productTitle ? productTitle : '소재명(미수집)'));
						const rawSub = isPowerlink
							? null
							: ((!isNameOk && productTitle) ? null : (productTitle ? productTitle : (!r.imageUrl ? '텍스트 소재(이미지 없음)' : null)));
						const sub = (rawSub && String(rawSub).trim() === displayName) ? null : rawSub;
						const showId = (displayName === '소재명(미수집)' || displayName === '키워드(미수집)') && Boolean(id);
						return (
							<>
								<div style={{ fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
									{displayName}
								</div>
								{sub ? (
									<div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
										{sub}
									</div>
								) : null}
								{showId ? (
									<div style={{ fontSize: 11, color: 'rgba(148,163,184,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
										소재ID: {id}
									</div>
								) : null}
							</>
						);
					})()}
				</div>
			</div>
		</td>
	);

	const renderCreativeConditionCell = (r: CreativeAggRow): JSX.Element => {
		const primary = String(r.primaryText || r.headline || r.description || '').trim();
		const headline = String(r.headline || '').trim();
		const description = String(r.description || '').trim();
		const type = String(r.creativeType || '').trim();
		const profile = String(r.profileName || '').trim();
		const cta = String(r.cta || '').trim();
		const landingUrl = String(r.landingUrl || '').trim();
		const lines = [primary, headline && headline !== primary ? headline : '', description && description !== primary && description !== headline ? description : ''].filter(Boolean);
		return (
			<td className="td-left">
				<div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
					<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
						{type ? <span className="badge-muted">{type}</span> : null}
						{profile ? <span className="badge-muted">{profile}</span> : null}
						{cta ? <span className="badge-muted">{cta}</span> : null}
					</div>
					{lines.length > 0 ? (
						<div style={{ fontSize: 12, color: '#e5e7eb', lineHeight: 1.35, whiteSpace: 'normal', wordBreak: 'break-word' }}>
							{lines.slice(0, 2).join(' / ')}
						</div>
					) : (
						<div style={{ fontSize: 12, color: '#64748b' }}>상세 조건 미수집</div>
					)}
					{landingUrl ? (
						<div style={{ fontSize: 11, color: '#93c5fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
							{landingUrl}
						</div>
					) : null}
				</div>
			</td>
		);
	};

	const renderDetailStatusCell = (r: CreativeAggRow): JSX.Element => {
		const collectedAt = String(r.detailCollectedAt || '').trim();
		const status = getDetailStatusMeta(r.detailLastError, r.detailCollectedAt);
		return (
			<td className="td-left" title={status.title}>
				<div style={{ fontSize: 12, fontWeight: 900, color: status.color }}>{status.label}</div>
				{collectedAt ? <div style={{ fontSize: 11, color: '#64748b' }}>{collectedAt.slice(0, 10)}</div> : null}
			</td>
		);
	};

	const renderMetricCell = (r: CreativeAggRow, key: CreativeColumnKey): JSX.Element => {
		switch (key) {
			case 'creative':
				return renderCreativeInfoCell(r);
			case 'creativeCondition':
				return renderCreativeConditionCell(r);
			case 'detailStatus':
				return renderDetailStatusCell(r);
			case 'bid':
				return <td className="td-right"><MetaCell value={r.currentBid} prev={r.prevCurrentBid} kind="won" /></td>;
			case 'quality':
				return <td className="td-right"><MetaCell value={r.qualityIndex} prev={r.prevQualityIndex} kind="float" /></td>;
			case 'avgRank':
				return <td className="td-right"><MetaCell value={r.avgRank} prev={r.prevAvgRank} kind="float" /></td>;
			case 'organicRank':
				return <td className="td-right" title={organicTooltip(r)}><OrganicRankCell curr={r.organicRank} prev={r.prevOrganicRank} /></td>;
			case 'impressions':
				return <td className="td-right"><MetricCell value={r.metrics.impressions} diff={r.deltas.impressions.diff} pct={r.deltas.impressions.pct} kind="int" /></td>;
			case 'clicks':
				return <td className="td-right"><MetricCell value={r.metrics.clicks} diff={r.deltas.clicks.diff} pct={r.deltas.clicks.pct} kind="int" /></td>;
			case 'ctr':
				return <td className="td-right"><MetricCell value={r.metrics.ctr} diff={r.deltas.ctr.diff} pct={r.deltas.ctr.pct} kind="pct" /></td>;
			case 'cpc':
				return <td className="td-right"><MetricCell value={r.metrics.cpc} diff={r.deltas.cpc.diff} pct={r.deltas.cpc.pct} kind="won" /></td>;
			case 'cost':
				return <td className="td-right"><MetricCell value={r.metrics.cost} diff={r.deltas.cost.diff} pct={r.deltas.cost.pct} kind="won" /></td>;
			case 'conversions':
				return <td className="td-right"><MetricCell value={r.metrics.conversions} diff={r.deltas.conversions.diff} pct={r.deltas.conversions.pct} kind="int" /></td>;
			case 'purchase_conversions':
				return (
					<td className="td-right">
						<MetricCell
							value={r.purchaseMetrics?.conversions ?? 0}
							diff={(r.purchaseMetrics?.conversions ?? 0) - (r.prevPurchaseMetrics?.conversions ?? 0)}
							pct={
								(r.prevPurchaseMetrics?.conversions ?? 0) > 0
									? (((r.purchaseMetrics?.conversions ?? 0) - (r.prevPurchaseMetrics?.conversions ?? 0)) / (r.prevPurchaseMetrics?.conversions ?? 0)) * 100
									: null
							}
							kind="int"
						/>
					</td>
				);
			case 'purchase_cvr': {
				const currPurchaseCvr = purchaseCvrValue(r);
				const prevPurchaseCvr = purchaseCvrPrevValue(r);
				return (
					<td className="td-right">
						<MetricCell
							value={currPurchaseCvr}
							diff={currPurchaseCvr - prevPurchaseCvr}
							pct={prevPurchaseCvr > 0 ? ((currPurchaseCvr - prevPurchaseCvr) / prevPurchaseCvr) * 100 : null}
							kind="pct"
						/>
					</td>
				);
			}
			case 'cvr':
				return <td className="td-right"><MetricCell value={r.metrics.cvr} diff={r.deltas.cvr.diff} pct={r.deltas.cvr.pct} kind="pct" /></td>;
			case 'revenue':
				return <td className="td-right"><MetricCell value={r.metrics.revenue} diff={r.deltas.revenue.diff} pct={r.deltas.revenue.pct} kind="won" /></td>;
			case 'purchase_revenue':
				return (
					<td className="td-right">
						<MetricCell
							value={r.purchaseMetrics?.revenue ?? 0}
							diff={(r.purchaseMetrics?.revenue ?? 0) - (r.prevPurchaseMetrics?.revenue ?? 0)}
							pct={
								(r.prevPurchaseMetrics?.revenue ?? 0) > 0
									? (((r.purchaseMetrics?.revenue ?? 0) - (r.prevPurchaseMetrics?.revenue ?? 0)) / (r.prevPurchaseMetrics?.revenue ?? 0)) * 100
									: null
							}
							kind="won"
						/>
					</td>
				);
			case 'purchase_roas': {
				const currPurchaseRoas = purchaseRoasValue(r);
				const prevPurchaseRoas = purchaseRoasPrevValue(r);
				return (
					<td className="td-right">
						<MetricCell
							value={currPurchaseRoas}
							diff={currPurchaseRoas - prevPurchaseRoas}
							pct={prevPurchaseRoas > 0 ? ((currPurchaseRoas - prevPurchaseRoas) / prevPurchaseRoas) * 100 : null}
							kind="pct"
						/>
					</td>
				);
			}
			case 'roas':
				return <td className="td-right"><MetricCell value={r.metrics.roas} diff={r.deltas.roas.diff} pct={r.deltas.roas.pct} kind="pct" /></td>;
			case 'cpa':
				return <td className="td-right"><MetricCell value={r.cpa} diff={r.cpaDiff} pct={r.cpaPct} kind="won" /></td>;
			default:
				return <td className="td-right" />;
		}
	};

	const renderTotalCell = (key: CreativeColumnKey): JSX.Element => {
		switch (key) {
			case 'creative':
				return (
					<td className="td-left" style={{ width: creativeColWidthPx, fontWeight: 900 }}>
						<span className={`valid-dot ${props.validationStatus ?? 'unknown'}`} title={props.validationStatus === 'ok' ? '검증완료' : props.validationStatus === 'fix' ? '보정필요' : '미검증'} />
						소계(그룹합계)
					</td>
				);
			case 'bid':
			case 'quality':
			case 'avgRank':
			case 'organicRank':
			case 'creativeCondition':
			case 'detailStatus':
				return <td className="td-right" style={{ fontWeight: 900 }}>-</td>;
			case 'impressions':
				return <td className="td-right"><MetricCell value={total.currM.impressions} diff={total.deltas.impressions.diff} pct={total.deltas.impressions.pct} kind="int" /></td>;
			case 'clicks':
				return <td className="td-right"><MetricCell value={total.currM.clicks} diff={total.deltas.clicks.diff} pct={total.deltas.clicks.pct} kind="int" /></td>;
			case 'ctr':
				return <td className="td-right"><MetricCell value={total.currM.ctr} diff={total.deltas.ctr.diff} pct={total.deltas.ctr.pct} kind="pct" /></td>;
			case 'cpc':
				return <td className="td-right"><MetricCell value={total.currM.cpc} diff={total.deltas.cpc.diff} pct={total.deltas.cpc.pct} kind="won" /></td>;
			case 'cost':
				return <td className="td-right"><MetricCell value={total.currM.cost} diff={total.deltas.cost.diff} pct={total.deltas.cost.pct} kind="won" /></td>;
			case 'conversions':
				return <td className="td-right"><MetricCell value={total.currM.conversions} diff={total.deltas.conversions.diff} pct={total.deltas.conversions.pct} kind="int" /></td>;
			case 'purchase_conversions':
				return (
					<td className="td-right">
						<MetricCell
							value={total.purchaseCurr.conversions}
							diff={total.purchaseCurr.conversions - total.purchasePrev.conversions}
							pct={
								total.purchasePrev.conversions > 0
									? ((total.purchaseCurr.conversions - total.purchasePrev.conversions) / total.purchasePrev.conversions) * 100
									: null
							}
							kind="int"
						/>
					</td>
				);
			case 'purchase_cvr': {
				const currPurchaseCvr = total.currM.clicks > 0 ? (total.purchaseCurr.conversions / total.currM.clicks) * 100 : 0;
				const prevPurchaseCvr = total.prevM.clicks > 0 ? (total.purchasePrev.conversions / total.prevM.clicks) * 100 : 0;
				return (
					<td className="td-right">
						<MetricCell
							value={currPurchaseCvr}
							diff={currPurchaseCvr - prevPurchaseCvr}
							pct={prevPurchaseCvr > 0 ? ((currPurchaseCvr - prevPurchaseCvr) / prevPurchaseCvr) * 100 : null}
							kind="pct"
						/>
					</td>
				);
			}
			case 'cvr':
				return <td className="td-right"><MetricCell value={total.currM.cvr} diff={total.deltas.cvr.diff} pct={total.deltas.cvr.pct} kind="pct" /></td>;
			case 'revenue':
				return <td className="td-right"><MetricCell value={total.currM.revenue} diff={total.deltas.revenue.diff} pct={total.deltas.revenue.pct} kind="won" /></td>;
			case 'purchase_revenue':
				return (
					<td className="td-right">
						<MetricCell
							value={total.purchaseCurr.revenue}
							diff={total.purchaseCurr.revenue - total.purchasePrev.revenue}
							pct={
								total.purchasePrev.revenue > 0
									? ((total.purchaseCurr.revenue - total.purchasePrev.revenue) / total.purchasePrev.revenue) * 100
									: null
							}
							kind="won"
						/>
					</td>
				);
			case 'purchase_roas': {
				const currPurchaseRoas = total.currM.cost > 0 ? (total.purchaseCurr.revenue / total.currM.cost) * 100 : 0;
				const prevPurchaseRoas = total.prevM.cost > 0 ? (total.purchasePrev.revenue / total.prevM.cost) * 100 : 0;
				return (
					<td className="td-right">
						<MetricCell
							value={currPurchaseRoas}
							diff={currPurchaseRoas - prevPurchaseRoas}
							pct={prevPurchaseRoas > 0 ? ((currPurchaseRoas - prevPurchaseRoas) / prevPurchaseRoas) * 100 : null}
							kind="pct"
						/>
					</td>
				);
			}
			case 'roas':
				return <td className="td-right"><MetricCell value={total.currM.roas} diff={total.deltas.roas.diff} pct={total.deltas.roas.pct} kind="pct" /></td>;
			case 'cpa':
				return <td className="td-right"><MetricCell value={total.cpa} diff={total.cpaDiff} pct={total.cpaPct} kind="won" /></td>;
			default:
				return <td className="td-right" />;
		}
	};

	return (
		<div className="card">
			<div className="card-title">{props.title}</div>
			<div
				className="ads-table-scrollbar-top"
				ref={topScrollRef}
				onScroll={() => {
					if (syncingRef.current === 'bottom') return;
					const top = topScrollRef.current;
					const bottom = bottomScrollRef.current;
					if (!top || !bottom) return;
					syncingRef.current = 'top';
					bottom.scrollLeft = top.scrollLeft;
					window.requestAnimationFrame(() => {
						if (syncingRef.current === 'top') syncingRef.current = null;
					});
				}}
				aria-label="ads-creatives-table-scrollbar-top"
			>
				<div className="ads-table-scrollbar-top-spacer" style={{ width: Math.max(scrollWidthPx, 1), height: 1 }} />
			</div>
			<div className="ads-table-wrap">
				<div
					ref={bottomScrollRef}
					className="ads-table-scroll"
					aria-label="ads-creatives-table-scrollbar-bottom"
					onScroll={() => {
						if (syncingRef.current === 'top') return;
						const top = topScrollRef.current;
						const bottom = bottomScrollRef.current;
						if (!top || !bottom) return;
						syncingRef.current = 'bottom';
						top.scrollLeft = bottom.scrollLeft;
						window.requestAnimationFrame(() => {
							if (syncingRef.current === 'bottom') syncingRef.current = null;
						});
					}}
				>
					<table
						ref={tableRef}
						className="ads-table ads-table-creatives"
						style={{ minWidth: tableMinWidthPx, width: 'max-content', tableLayout: 'auto' }}
					>
						<colgroup>
							{visibleColumnKeys.map((key) => (
								<col key={key} style={{ width: columnWidthPx[key] }} />
							))}
						</colgroup>
						<thead>
							<tr>
								{visibleColumnKeys.map((key) => (
									<SortTh key={key} sortKey={key} className={key === 'creative' ? 'th-left' : 'th-right'} label={columnLabel(key)} />
								))}
							</tr>
						</thead>
						<tbody>
							<tr className="ads-row total">
								{visibleColumnKeys.map((key) => (
									<React.Fragment key={key}>{renderTotalCell(key)}</React.Fragment>
								))}
							</tr>
							{!props.collapsed && sorted.map((r) => (
								<tr
									key={r.key}
									className="ads-row"
									data-selected={props.selectedRowKey === r.key ? 'true' : 'false'}
									style={props.selectedRowKey === r.key ? { background: 'rgba(56,189,248,0.12)' } : undefined}
									onClick={() => props.onRowClick?.(r)}
								>
									{visibleColumnKeys.map((key) => (
										<React.Fragment key={key}>{renderMetricCell(r, key)}</React.Fragment>
									))}
								</tr>
							))}

							{(!props.rows || props.rows.length === 0) && (
								<tr>
									<td className="td-empty" colSpan={colSpan}>
										표시할 데이터가 없습니다.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

