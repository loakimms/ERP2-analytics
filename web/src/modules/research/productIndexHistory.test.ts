import { describe, expect, it } from 'vitest';
import { computeProductIndexTrend } from './productIndexHistory';

describe('computeProductIndexTrend', () => {
	it('일자별 Δ와 주요 드라이버(가중치 기여) 순서를 계산한다', () => {
		const rows = computeProductIndexTrend([
			{
				date: '2026-01-26',
				scores: { click: 10, sales: 10, review: 10, recency: 10, penalty: 0, final: 10 },
				inputs: { weekly_views_7d: 100, wishes: 1 },
			},
			{
				date: '2026-01-27',
				scores: { click: 20, sales: 12, review: 10, recency: 10, penalty: 0, final: 15 },
				inputs: { weekly_views_7d: 200, wishes: 2 },
			},
		]);

		expect(rows).toHaveLength(2);
		expect(rows[0]!.deltas.final).toBeNull();
		expect(rows[1]!.deltas.click).toBe(10);
		expect(rows[1]!.deltas.sales).toBe(2);
		expect(rows[1]!.inputDeltas.wishes).toBe(1);
		// click delta 10 * 0.2 = 2, sales delta 2 * 0.35 = 0.7 -> click이 우선
		expect(rows[1]!.drivers[0]!.key).toBe('click');
	});
});

