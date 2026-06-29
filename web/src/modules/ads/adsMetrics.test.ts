import { describe, expect, it } from 'vitest';
import { aggregateByKey, calcMetricDeltas, computeMetrics } from './adsMetrics';

describe('adsMetrics', () => {
	it('computeMetrics uses totals to compute derived metrics', () => {
		const m = computeMetrics({
			impressions: 1000,
			clicks: 10,
			cost: 5000,
			conversions: 2,
			revenue: 20000,
		});
		expect(m.ctr).toBeCloseTo(1.0);
		expect(m.cpc).toBeCloseTo(500);
		expect(m.cvr).toBeCloseTo(20);
		expect(m.roas).toBeCloseTo(400);
	});

	it('aggregateByKey sums totals across rows then recomputes derived metrics', () => {
		const rows = [
			{ key: 'A', impressions: 100, clicks: 1, cost: 1000, conversions: 0, revenue: 0 },
			{ key: 'A', impressions: 300, clicks: 9, cost: 9000, conversions: 2, revenue: 20000 },
		];
		const map = aggregateByKey(
			rows,
			(r) => r.key,
			(r) => ({
				impressions: r.impressions,
				clicks: r.clicks,
				cost: r.cost,
				conversions: r.conversions,
				revenue: r.revenue,
			}),
		);
		const m = map.get('A')!;
		expect(m.impressions).toBe(400);
		expect(m.clicks).toBe(10);
		expect(m.cost).toBe(10000);
		expect(m.conversions).toBe(2);
		expect(m.revenue).toBe(20000);
		expect(m.ctr).toBeCloseTo(2.5);
		expect(m.roas).toBeCloseTo(200);
	});

	it('calcMetricDeltas compares all metrics', () => {
		const curr = computeMetrics({ impressions: 100, clicks: 10, cost: 1000, conversions: 1, revenue: 2000 });
		const prev = computeMetrics({ impressions: 200, clicks: 10, cost: 2000, conversions: 1, revenue: 1000 });
		const d = calcMetricDeltas(curr, prev);
		expect(d.impressions.diff).toBe(-100);
		expect(d.clicks.diff).toBe(0);
		expect(d.cost.diff).toBe(-1000);
		expect(d.revenue.diff).toBe(1000);
	});
});


