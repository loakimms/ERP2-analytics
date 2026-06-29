import { describe, it, expect } from 'vitest';
import { chunkYmdRange, groupContiguousDates } from './adsRangeChunking';

describe('adsRangeChunking', () => {
	it('chunkYmdRange: 10일 범위를 7일 단위로 쪼갠다', () => {
		const out = chunkYmdRange('2026-01-01', '2026-01-10', 7);
		expect(out).toEqual([
			{ from: '2026-01-01', to: '2026-01-07' },
			{ from: '2026-01-08', to: '2026-01-10' },
		]);
	});

	it('groupContiguousDates: 연속된 날짜를 구간으로 묶는다(중복/정렬 포함)', () => {
		const out = groupContiguousDates([
			'2026-01-03',
			'2026-01-01',
			'2026-01-02',
			'2026-01-02',
			'2026-01-10',
			'2026-01-12',
			'2026-01-11',
		]);
		expect(out).toEqual([
			{ from: '2026-01-01', to: '2026-01-03' },
			{ from: '2026-01-10', to: '2026-01-12' },
		]);
	});
});

