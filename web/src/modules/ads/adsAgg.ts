import { addTotals, aggregateByKey, calcMetricDeltas, computeMetrics, type MetricComputed, type MetricDeltas, type MetricTotals } from './adsMetrics';

export type CampaignKindKey = 'powerlink' | 'non_powerlink';

export type AggTermRow = {
	campaign_name: string;
	adgroup_name: string;
	term: string;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
};

// AdsTables.tsx의 AdsRow와 구조적으로 동일(React 의존을 피하기 위해 여기서 재정의)
export type AdsAggRow = {
	key: string;
	primary: string;
	secondary?: string | null;
	tertiary?: string | null;
	metrics: MetricComputed;
	prevMetrics: MetricComputed;
	deltas: MetricDeltas;
	purchaseMetrics?: { conversions: number; revenue: number };
	prevPurchaseMetrics?: { conversions: number; revenue: number };
};

export type CampaignDashRow = {
	campaign: string;
	revenue: number;
	purchase_revenue: number;
	purchase_revenue_prev: number;
	cost: number;
	conversions: number;
	purchase_conversions: number;
	conversions_prev: number;
	purchase_conversions_prev: number;
	costDiff: number;
	costPct: number | null;
	revenueDiff: number;
	revenuePct: number | null;
	purchaseRevenueDiff: number;
	purchaseRevenuePct: number | null;
	convDiff: number;
	convPct: number | null;
	purchaseConvDiff: number;
	purchaseConvPct: number | null;
};

export type TopCampaignKeywordCard = {
	campaign: string;
	totalRevenue: number;
	totalPurchaseRevenue: number;
	items: Array<{ keyword: string; revenue: number; purchaseRevenue: number }>;
};

export type AdsKeywordsUnifiedAggResult = {
	rows: AdsAggRow[];
	totalRow: AdsAggRow | null;
	totalsByKind: Record<CampaignKindKey, MetricTotals>;
	campaignDashRows: CampaignDashRow[];
	topCampaignKeywordCards: TopCampaignKeywordCard[];
};

// AdsCampaignView 집계용(캠페인/그룹 일간 집계 결과)
export type CampaignDailyAggRow = {
	campaign_name: string;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
	// optional status fields (API 응답에 따라 존재)
	is_active?: boolean | null;
	campaign_status?: string | null;
	ended_on?: string | null;
	campaign_status_basis?: string | null;
	status_collected_at?: string | null;
};

export type AdgroupDailyAggRow = {
	campaign_name: string;
	adgroup_name: string;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
	is_active?: boolean | null;
	adgroup_status?: string | null;
	ended_on?: string | null;
	adgroup_status_basis?: string | null;
	status_collected_at?: string | null;
};

export type AdsCampaignAggRow = AdsAggRow & {
	status?: { label: string; isActive: boolean | null };
	ended_on?: string | null;
};

export type AdsCampaignAggResult = {
	rows: AdsCampaignAggRow[];
	totalRow: AdsAggRow | null;
};

function totalsFromRow(row: AggTermRow): MetricTotals {
	return {
		impressions: Number(row.impressions) || 0,
		clicks: Number(row.clicks) || 0,
		cost: Number(row.cost) || 0,
		conversions: Number(row.conversions) || 0,
		revenue: Number(row.revenue) || 0,
	};
}

function purchaseTotalsFromRow(row: AggTermRow): { conversions: number; revenue: number } {
	return {
		conversions: Number((row as any)?.purchase_conversions) || 0,
		revenue: Number((row as any)?.purchase_revenue) || 0,
	};
}

function normKeyPart(x: unknown): string {
	return String(x ?? '').trim().replace(/^#+/, '').trim();
}

function normPrimary(s: unknown): string {
	// "(기타)"는 단어로 오인될 수 있어, 리포트 성격에 맞게 "-"로 표시한다.
	const x = String(s ?? '').trim();
	if (!x) return '-';
	if (x === '(기타)') return '-';
	return x;
}

function keyOf(row: AggTermRow, mergeMode: boolean): string {
	const base = normPrimary(row.term);
	if (mergeMode) return base;
	return `${base}||${normKeyPart(row.campaign_name)}||${normKeyPart(row.adgroup_name)}`;
}

function labelOf(row: AggTermRow, mergeMode: boolean): { primary: string; secondary?: string | null; tertiary?: string | null } {
	const base = normPrimary(row.term);
	return {
		primary: base,
		secondary: mergeMode ? null : String(row.campaign_name ?? '').trim(),
		tertiary: mergeMode ? null : String(row.adgroup_name ?? '').trim(),
	};
}

function sumTotals(list: AggTermRow[]): MetricTotals {
	let acc: MetricTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
	for (const r of list || []) acc = addTotals(acc, totalsFromRow(r));
	return acc;
}

function aggregateByKeyMany<T>(
	lists: T[][],
	keyFn: (row: T) => string,
	totalsFn: (row: T) => MetricTotals,
): Map<string, MetricComputed> {
	const totalsByKey = new Map<string, MetricTotals>();
	for (const rows of lists || []) {
		for (const row of rows || []) {
			const k = keyFn(row);
			const t = totalsFn(row);
			const prev = totalsByKey.get(k);
			totalsByKey.set(k, prev ? addTotals(prev, t) : { ...t });
		}
	}
	const out = new Map<string, MetricComputed>();
	for (const [k, t] of totalsByKey.entries()) {
		out.set(k, computeMetrics(t));
	}
	return out;
}

function buildRows(params: {
	curr: Map<string, MetricComputed>;
	prev: Map<string, MetricComputed>;
	labelByKey: Map<string, { primary: string; secondary?: string | null; tertiary?: string | null }>;
}): { rows: AdsAggRow[]; totalRow: AdsAggRow | null } {
	const keys = new Set<string>([...params.curr.keys(), ...params.prev.keys()]);
	const rows: AdsAggRow[] = [];

	let totalCurr: MetricTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
	let totalPrev: MetricTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };

	for (const k of keys) {
		const label = params.labelByKey.get(k) ?? { primary: k };
		const curr = params.curr.get(k) ?? computeMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
		const prev = params.prev.get(k) ?? computeMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
		const deltas = calcMetricDeltas(curr, prev);

		totalCurr = addTotals(totalCurr, curr);
		totalPrev = addTotals(totalPrev, prev);

		rows.push({
			key: k,
			primary: label.primary,
			secondary: label.secondary,
			tertiary: label.tertiary,
			metrics: curr,
			prevMetrics: prev,
			deltas,
		});
	}

	// 기본 정렬: 비용(cost) 내림차순
	rows.sort((a, b) => (Number(b.metrics.cost) || 0) - (Number(a.metrics.cost) || 0));

	const totalCurrComputed = computeMetrics(totalCurr);
	const totalPrevComputed = computeMetrics(totalPrev);
	const totalRow: AdsAggRow = {
		key: '__total__',
		primary: '전체 합계',
		secondary: null,
		tertiary: null,
		metrics: totalCurrComputed,
		prevMetrics: totalPrevComputed,
		deltas: calcMetricDeltas(totalCurrComputed, totalPrevComputed),
	};

	return { rows, totalRow };
}

export function computeAdsKeywordsUnifiedAgg(params: {
	currByKind: Record<CampaignKindKey, AggTermRow[]>;
	prevByKind: Record<CampaignKindKey, AggTermRow[]>;
	mergeMode: boolean;
}): AdsKeywordsUnifiedAggResult {
	const currPL = params.currByKind.powerlink || [];
	const currNP = params.currByKind.non_powerlink || [];
	const prevPL = params.prevByKind.powerlink || [];
	const prevNP = params.prevByKind.non_powerlink || [];

	const totalsByKind: Record<CampaignKindKey, MetricTotals> = {
		powerlink: sumTotals(currPL),
		non_powerlink: sumTotals(currNP),
	};

	// labelByKey는 curr/prev를 각각 1회씩만 순회한다.
	const labelByKey = new Map<string, { primary: string; secondary?: string | null; tertiary?: string | null }>();
	for (const row of currPL) labelByKey.set(keyOf(row, params.mergeMode), labelOf(row, params.mergeMode));
	for (const row of currNP) labelByKey.set(keyOf(row, params.mergeMode), labelOf(row, params.mergeMode));
	for (const row of prevPL) labelByKey.set(keyOf(row, params.mergeMode), labelOf(row, params.mergeMode));
	for (const row of prevNP) labelByKey.set(keyOf(row, params.mergeMode), labelOf(row, params.mergeMode));

	const keyFn = (row: AggTermRow) => keyOf(row, params.mergeMode);
	const currAgg = aggregateByKeyMany([currPL, currNP], keyFn, totalsFromRow);
	const prevAgg = aggregateByKeyMany([prevPL, prevNP], keyFn, totalsFromRow);
	const built = buildRows({ curr: currAgg, prev: prevAgg, labelByKey });
	const purchaseKeyMap = (rows: AggTermRow[]) => {
		const out = new Map<string, { conversions: number; revenue: number }>();
		for (const row of rows || []) {
			const k = keyFn(row);
			const cur = out.get(k) ?? { conversions: 0, revenue: 0 };
			const add = purchaseTotalsFromRow(row);
			cur.conversions += add.conversions;
			cur.revenue += add.revenue;
			out.set(k, cur);
		}
		return out;
	};
	const currPurchase = purchaseKeyMap([...currPL, ...currNP]);
	const prevPurchase = purchaseKeyMap([...prevPL, ...prevNP]);
	const outRows: AdsAggRow[] = built.rows.map((row) => ({
		...row,
		purchaseMetrics: currPurchase.get(row.key) ?? { conversions: 0, revenue: 0 },
		prevPurchaseMetrics: prevPurchase.get(row.key) ?? { conversions: 0, revenue: 0 },
	}));
	const totalRow = built.totalRow
		? {
			...built.totalRow,
			purchaseMetrics: Array.from(currPurchase.values()).reduce(
				(acc, cur) => ({ conversions: acc.conversions + cur.conversions, revenue: acc.revenue + cur.revenue }),
				{ conversions: 0, revenue: 0 },
			),
			prevPurchaseMetrics: Array.from(prevPurchase.values()).reduce(
				(acc, cur) => ({ conversions: acc.conversions + cur.conversions, revenue: acc.revenue + cur.revenue }),
				{ conversions: 0, revenue: 0 },
			),
		}
		: null;

	// -------- 대시보드(캠페인 기준): 전환매출액/전환수 + Top10 캠페인별 키워드 --------
	const normCampaign = (s: unknown) => {
		const x = String(s ?? '').trim();
		return x ? x : '(캠페인 미지정)';
	};
	const campKeyFn = (row: AggTermRow) => normCampaign(row.campaign_name);
	const campCurr = aggregateByKeyMany([currPL, currNP], campKeyFn, totalsFromRow);
	const campPrev = aggregateByKeyMany([prevPL, prevNP], campKeyFn, totalsFromRow);
	const purchaseByCampaign = (rows: AggTermRow[]) => {
		const out = new Map<string, { conversions: number; revenue: number }>();
		for (const row of rows || []) {
			const k = campKeyFn(row);
			const cur = out.get(k) ?? { conversions: 0, revenue: 0 };
			const add = purchaseTotalsFromRow(row);
			cur.conversions += add.conversions;
			cur.revenue += add.revenue;
			out.set(k, cur);
		}
		return out;
	};
	const campCurrPurchase = purchaseByCampaign([...currPL, ...currNP]);
	const campPrevPurchase = purchaseByCampaign([...prevPL, ...prevNP]);
	const campKeys = new Set<string>([...campCurr.keys(), ...campPrev.keys()]);

	const dash: CampaignDashRow[] = Array.from(campKeys.values()).map((k) => {
		const c = campCurr.get(k) ?? computeMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
		const p = campPrev.get(k) ?? computeMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
		const cp = campCurrPurchase.get(k) ?? { conversions: 0, revenue: 0 };
		const pp = campPrevPurchase.get(k) ?? { conversions: 0, revenue: 0 };
		const revenueDiff = c.revenue - p.revenue;
		const revenuePct = p.revenue > 0 ? (revenueDiff / p.revenue) * 100 : null;
		const purchaseRevenueDiff = cp.revenue - pp.revenue;
		const purchaseRevenuePct = pp.revenue > 0 ? (purchaseRevenueDiff / pp.revenue) * 100 : null;
		const costDiff = c.cost - p.cost;
		const costPct = p.cost > 0 ? (costDiff / p.cost) * 100 : null;
		const convDiff = c.conversions - p.conversions;
		const convPct = p.conversions > 0 ? (convDiff / p.conversions) * 100 : null;
		const purchaseConvDiff = cp.conversions - pp.conversions;
		const purchaseConvPct = pp.conversions > 0 ? (purchaseConvDiff / pp.conversions) * 100 : null;
		return {
			campaign: k,
			revenue: c.revenue,
			purchase_revenue: cp.revenue,
			purchase_revenue_prev: pp.revenue,
			cost: c.cost,
			conversions: c.conversions,
			purchase_conversions: cp.conversions,
			conversions_prev: p.conversions,
			purchase_conversions_prev: pp.conversions,
			costDiff,
			costPct,
			revenueDiff,
			revenuePct,
			purchaseRevenueDiff,
			purchaseRevenuePct,
			convDiff,
			convPct,
			purchaseConvDiff,
			purchaseConvPct,
		};
	});
	dash.sort((a, b) => b.revenue - a.revenue);

	// Top10 캠페인별 키워드 Top10 (총전환/구매전환매출액 기준, 현재기간)
	const topCampaigns = dash.slice(0, 10).filter((x) => x.revenue > 0 || x.purchase_revenue > 0);
	const topSet = new Set<string>(topCampaigns.map((x) => x.campaign));
	const kwRevenueByCampaign = new Map<string, Map<string, { revenue: number; purchaseRevenue: number }>>();
	const addKwRevenue = (row: AggTermRow) => {
		const camp = normCampaign(row.campaign_name);
		if (!topSet.has(camp)) return;
		const kw = String(row.term ?? '').trim() || '-';
		const rev = Number(row.revenue) || 0;
		const purchaseRev = Number(row.purchase_revenue) || 0;
		if (rev <= 0 && purchaseRev <= 0) return;
		let m = kwRevenueByCampaign.get(camp);
		if (!m) {
			m = new Map<string, { revenue: number; purchaseRevenue: number }>();
			kwRevenueByCampaign.set(camp, m);
		}
		const cur = m.get(kw) ?? { revenue: 0, purchaseRevenue: 0 };
		cur.revenue += rev;
		cur.purchaseRevenue += purchaseRev;
		m.set(kw, cur);
	};
	for (const r of currPL) addKwRevenue(r);
	for (const r of currNP) addKwRevenue(r);

	const cards: TopCampaignKeywordCard[] = [];
	for (const c of topCampaigns) {
		const m = kwRevenueByCampaign.get(c.campaign);
		if (!m) continue;
		const items = Array.from(m.entries())
			.map(([keyword, metrics]) => ({ keyword, revenue: metrics.revenue, purchaseRevenue: metrics.purchaseRevenue }))
			.sort((a, b) => (b.revenue + b.purchaseRevenue) - (a.revenue + a.purchaseRevenue))
			.slice(0, 10);
		if (items.length > 0) {
			cards.push({
				campaign: c.campaign,
				totalRevenue: c.revenue,
				totalPurchaseRevenue: c.purchase_revenue,
				items,
			});
		}
	}

	return {
		rows: outRows,
		totalRow,
		totalsByKind,
		campaignDashRows: dash,
		topCampaignKeywordCards: cards,
	};
}

function totalsFromCampaignRow(row: CampaignDailyAggRow | AdgroupDailyAggRow): MetricTotals {
	return {
		impressions: Number((row as any)?.impressions) || 0,
		clicks: Number((row as any)?.clicks) || 0,
		cost: Number((row as any)?.cost) || 0,
		conversions: Number((row as any)?.conversions) || 0,
		revenue: Number((row as any)?.revenue) || 0,
	};
}

function purchaseTotalsFromCampaignRow(row: CampaignDailyAggRow | AdgroupDailyAggRow): { conversions: number; revenue: number } {
	return {
		conversions: Number((row as any)?.purchase_conversions) || 0,
		revenue: Number((row as any)?.purchase_revenue) || 0,
	};
}

export function computeAdsCampaignAgg(params: {
	viewKind: 'campaign' | 'adgroup';
	curr: Array<CampaignDailyAggRow | AdgroupDailyAggRow>;
	prev: Array<CampaignDailyAggRow | AdgroupDailyAggRow>;
}): AdsCampaignAggResult {
	const curr = params.curr || [];
	const prev = params.prev || [];

	const labelByKey = new Map<string, { primary: string; secondary?: string | null; tertiary?: string | null }>();
	const statusByKey = new Map<string, { label: string; isActive: boolean | null }>();
	const endedOnByKey = new Map<string, string | null>();

	const isActiveFromRow = (row: CampaignDailyAggRow | AdgroupDailyAggRow): boolean | null => {
		const v = (row as any)?.is_active;
		return typeof v === 'boolean' ? v : null;
	};

	const statusLabelFromRow = (row: CampaignDailyAggRow | AdgroupDailyAggRow): string => {
		const active = isActiveFromRow(row);
		if (active === true) return '운영중';
		if (active === false) return '종료';
		const raw = params.viewKind === 'campaign'
			? String((row as any)?.campaign_status ?? '').trim()
			: String((row as any)?.adgroup_status ?? '').trim();
		const compact = raw.replace(/\s+/g, '');
		if (['운영가능', '운영중', '진행중', 'ACTIVE', 'ENABLED', 'ON', 'RUNNING'].includes(compact.toUpperCase())) return '운영중';
		if (['중지', '종료', '삭제', '운영불가', 'PAUSED', 'DELETED', 'OFF', 'ENDED'].includes(compact.toUpperCase())) return '종료';
		return raw || 'UNKNOWN';
	};

	const keyFn = (row: CampaignDailyAggRow | AdgroupDailyAggRow): string => {
		if (params.viewKind === 'campaign') {
			return normKeyPart((row as CampaignDailyAggRow).campaign_name);
		}
		const rr = row as AdgroupDailyAggRow;
		return `${normKeyPart(rr.campaign_name)}||${normKeyPart(rr.adgroup_name)}`;
	};

	const setLabel = (row: CampaignDailyAggRow | AdgroupDailyAggRow) => {
		if (params.viewKind === 'campaign') {
			const rawName = String((row as CampaignDailyAggRow).campaign_name ?? '').trim();
			const k = normKeyPart(rawName);
			if (!labelByKey.has(k)) labelByKey.set(k, { primary: rawName || k });
			if (!statusByKey.has(k)) statusByKey.set(k, { label: statusLabelFromRow(row), isActive: isActiveFromRow(row) });
			if (!endedOnByKey.has(k)) endedOnByKey.set(k, String((row as CampaignDailyAggRow).ended_on ?? '').trim() || null);
			return;
		}
		const rr = row as AdgroupDailyAggRow;
		const k = `${normKeyPart(rr.campaign_name)}||${normKeyPart(rr.adgroup_name)}`;
		if (!labelByKey.has(k)) {
			labelByKey.set(k, { primary: String(rr.adgroup_name ?? '').trim(), secondary: String(rr.campaign_name ?? '').trim() });
		}
		if (!statusByKey.has(k)) statusByKey.set(k, { label: statusLabelFromRow(row), isActive: isActiveFromRow(row) });
		if (!endedOnByKey.has(k)) endedOnByKey.set(k, String(rr.ended_on ?? '').trim() || null);
	};

	for (const r of curr) setLabel(r);
	for (const r of prev) setLabel(r);

	const currAgg = aggregateByKeyMany([curr as any], keyFn as any, totalsFromCampaignRow as any);
	const prevAgg = aggregateByKeyMany([prev as any], keyFn as any, totalsFromCampaignRow as any);
	const built = buildRows({ curr: currAgg, prev: prevAgg, labelByKey });
	const purchaseKeyMap = (rows: Array<CampaignDailyAggRow | AdgroupDailyAggRow>) => {
		const out = new Map<string, { conversions: number; revenue: number }>();
		for (const row of rows || []) {
			const k = keyFn(row);
			const cur = out.get(k) ?? { conversions: 0, revenue: 0 };
			const add = purchaseTotalsFromCampaignRow(row);
			cur.conversions += add.conversions;
			cur.revenue += add.revenue;
			out.set(k, cur);
		}
		return out;
	};
	const currPurchase = purchaseKeyMap(curr);
	const prevPurchase = purchaseKeyMap(prev);

	const outRows: AdsCampaignAggRow[] = built.rows.map((r) => ({
		...r,
		status: statusByKey.get(r.key) ?? undefined,
		ended_on: endedOnByKey.get(r.key) ?? null,
		purchaseMetrics: currPurchase.get(r.key) ?? { conversions: 0, revenue: 0 },
		prevPurchaseMetrics: prevPurchase.get(r.key) ?? { conversions: 0, revenue: 0 },
	}));
	const totalRow = built.totalRow
		? {
			...built.totalRow,
			purchaseMetrics: Array.from(currPurchase.values()).reduce(
				(acc, cur) => ({ conversions: acc.conversions + cur.conversions, revenue: acc.revenue + cur.revenue }),
				{ conversions: 0, revenue: 0 },
			),
			prevPurchaseMetrics: Array.from(prevPurchase.values()).reduce(
				(acc, cur) => ({ conversions: acc.conversions + cur.conversions, revenue: acc.revenue + cur.revenue }),
				{ conversions: 0, revenue: 0 },
			),
		}
		: null;
	return { rows: outRows, totalRow };
}

