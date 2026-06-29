import { describe, expect, it } from 'vitest';
import { buildA1RangePayload, clampA1Range } from './a1DateRange';

describe('a1DateRange', () => {
	it('clampA1Range swaps and computes days', () => {
		const { range, days } = clampA1Range({ fromYmd: '2026-03-10', toYmd: '2026-03-01' }, 90);
		expect(range.fromYmd).toBe('2026-03-01');
		expect(range.toYmd).toBe('2026-03-10');
		expect(days).toBe(10);
	});

	it('buildA1RangePayload clamps to maxDays by fixing end', () => {
		const p = buildA1RangePayload({ fromYmd: '2026-01-01', toYmd: '2026-04-30' }, 90);
		expect(p.days).toBe(90);
		expect(p.date_to).toBe('2026-04-30');
		// from should be 89 days before to (inclusive 90 days)
		expect(p.date_from).toBe('2026-01-31');
	});
});

