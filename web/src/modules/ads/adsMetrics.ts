import { calcDelta, type Delta } from './dateRangeUtils';

export type MetricTotals = {
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
};

export type MetricComputed = MetricTotals & {
	ctr: number; // percent
	cpc: number; // won
	cvr: number; // percent
	roas: number; // percent
};

export type MetricDeltas = {
	impressions: Delta;
	clicks: Delta;
	cost: Delta;
	conversions: Delta;
	revenue: Delta;
	ctr: Delta;
	cpc: Delta;
	cvr: Delta;
	roas: Delta;
};

export function computeMetrics(t: MetricTotals): MetricComputed {
	const impressions = Number(t.impressions) || 0;
	const clicks = Number(t.clicks) || 0;
	const cost = Number(t.cost) || 0;
	const conversions = Number(t.conversions) || 0;
	const revenue = Number(t.revenue) || 0;
	const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
	const cpc = clicks > 0 ? cost / clicks : 0;
	const cvr = clicks > 0 ? (conversions / clicks) * 100 : 0;
	const roas = cost > 0 ? (revenue / cost) * 100 : 0;
	return { impressions, clicks, cost, conversions, revenue, ctr, cpc, cvr, roas };
}

export function addTotals(a: MetricTotals, b: MetricTotals): MetricTotals {
	return {
		impressions: (Number(a.impressions) || 0) + (Number(b.impressions) || 0),
		clicks: (Number(a.clicks) || 0) + (Number(b.clicks) || 0),
		cost: (Number(a.cost) || 0) + (Number(b.cost) || 0),
		conversions: (Number(a.conversions) || 0) + (Number(b.conversions) || 0),
		revenue: (Number(a.revenue) || 0) + (Number(b.revenue) || 0),
	};
}

export function calcMetricDeltas(curr: MetricComputed, prev: MetricComputed): MetricDeltas {
	return {
		impressions: calcDelta(curr.impressions, prev.impressions),
		clicks: calcDelta(curr.clicks, prev.clicks),
		cost: calcDelta(curr.cost, prev.cost),
		conversions: calcDelta(curr.conversions, prev.conversions),
		revenue: calcDelta(curr.revenue, prev.revenue),
		ctr: calcDelta(curr.ctr, prev.ctr),
		cpc: calcDelta(curr.cpc, prev.cpc),
		cvr: calcDelta(curr.cvr, prev.cvr),
		roas: calcDelta(curr.roas, prev.roas),
	};
}

export function aggregateByKey<T>(
	rows: T[],
	keyFn: (row: T) => string,
	totalsFn: (row: T) => MetricTotals,
): Map<string, MetricComputed> {
	const totalsByKey = new Map<string, MetricTotals>();
	for (const row of rows) {
		const k = keyFn(row);
		const t = totalsFn(row);
		const prev = totalsByKey.get(k);
		totalsByKey.set(k, prev ? addTotals(prev, t) : { ...t });
	}
	const out = new Map<string, MetricComputed>();
	for (const [k, t] of totalsByKey.entries()) {
		out.set(k, computeMetrics(t));
	}
	return out;
}


