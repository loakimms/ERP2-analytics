import { describe, expect, it } from 'vitest';
import {
	addRangeDays,
	calcDelta,
	defaultYesterdayRange,
	fromYmd,
	rangeLengthDays,
	shiftRange,
	toYmd,
	type DateRange,
} from './dateRangeUtils';

describe('dateRangeUtils', () => {
	it('toYmd/fromYmd roundtrip', () => {
		const d = fromYmd('2025-12-30');
		expect(d).not.toBeNull();
		expect(toYmd(d!)).toBe('2025-12-30');
	});

	it('fromYmd rejects invalid dates', () => {
		expect(fromYmd('')).toBeNull();
		expect(fromYmd('2025-2-01')).toBeNull();
		expect(fromYmd('2025-02-31')).toBeNull();
	});

	it('defaultYesterdayRange uses local yesterday', () => {
		const base = new Date(2025, 11, 31, 10, 0, 0); // 2025-12-31
		const r = defaultYesterdayRange(base);
		expect(toYmd(r.from)).toBe('2025-12-30');
		expect(toYmd(r.to)).toBe('2025-12-30');
	});

	it('rangeLengthDays counts inclusive days', () => {
		const r: DateRange = { from: new Date(2025, 11, 30), to: new Date(2025, 11, 31) };
		expect(rangeLengthDays(r)).toBe(2);
	});

	it('shiftRange prev_day shifts by range length', () => {
		const r: DateRange = { from: new Date(2025, 11, 10), to: new Date(2025, 11, 12) }; // 3d
		const prev = shiftRange(r, 'prev_day');
		expect(toYmd(prev.from)).toBe('2025-12-07');
		expect(toYmd(prev.to)).toBe('2025-12-09');
	});

	it('shiftRange prev_week shifts by 7 days', () => {
		const r: DateRange = { from: new Date(2025, 11, 30), to: new Date(2025, 11, 30) };
		const prev = shiftRange(r, 'prev_week');
		expect(toYmd(prev.from)).toBe('2025-12-23');
		expect(toYmd(prev.to)).toBe('2025-12-23');
	});

	it('shiftRange prev_month handles month edge', () => {
		const r: DateRange = { from: new Date(2025, 2, 31), to: new Date(2025, 2, 31) }; // 2025-03-31
		const prev = shiftRange(r, 'prev_month');
		// 2025-02-28 (non-leap year)로 자동 보정
		expect(toYmd(prev.from)).toBe('2025-02-28');
	});

	it('calcDelta returns pct when prev != 0', () => {
		const d = calcDelta(120, 100);
		expect(d.diff).toBe(20);
		expect(d.pct).toBeCloseTo(20);
	});

	it('calcDelta returns null pct when prev == 0', () => {
		const d = calcDelta(10, 0);
		expect(d.diff).toBe(10);
		expect(d.pct).toBeNull();
	});

	it('addRangeDays shifts both from/to', () => {
		const r: DateRange = { from: new Date(2025, 11, 30), to: new Date(2025, 11, 31) };
		const next = addRangeDays(r, 1);
		expect(toYmd(next.from)).toBe('2025-12-31');
		expect(toYmd(next.to)).toBe('2026-01-01');
	});
});


