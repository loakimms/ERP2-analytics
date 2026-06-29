import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	buildRankChartData,
	buildRankMatrixData,
	getLatestRankSummary,
	type RankHistory,
} from './rankUtils';

const sampleHistory: RankHistory = {
	dates: ['2025-12-20', '2025-12-21', '2025-12-22'],
	series: [
		{
			keyword: '새치염색',
			series: [
				{ date: '2025-12-20', rank: 10 },
				{ date: '2025-12-21', rank: 8 },
				{ date: '2025-12-22', rank: 9 },
			],
		},
		{
			keyword: '천연염색',
			series: [
				{ date: '2025-12-20', rank: 3 },
				{ date: '2025-12-22', rank: 4 },
			],
		},
	],
};

describe('rankUtils.buildRankChartData', () => {
	it('선택된 키워드만 포함한 차트 데이터를 생성한다', () => {
		const data = buildRankChartData(sampleHistory, ['새치염색', '천연염색']);

		expect(data).toHaveLength(3);
		expect(data[0]).toEqual({
			date: '2025-12-20',
			새치염색: 10,
			천연염색: 3,
		});
		expect(data[1]).toEqual({
			date: '2025-12-21',
			새치염색: 8,
			천연염색: null,
		});
		expect(data[2]).toEqual({
			date: '2025-12-22',
			새치염색: 9,
			천연염색: 4,
		});
	});

	it('history가 없거나 선택 키워드가 없으면 빈 배열을 반환한다', () => {
		expect(buildRankChartData(null, ['키워드'])).toEqual([]);
		expect(buildRankChartData(sampleHistory, [])).toEqual([]);
	});

	it('custom dates를 전달하면 그 날짜(순서 포함)를 기준으로 차트 데이터를 만든다', () => {
		const data = buildRankChartData(sampleHistory, ['새치염색'], ['2025-12-22', '2025-12-21']);
		expect(data).toEqual([
			{ date: '2025-12-22', 새치염색: 9 },
			{ date: '2025-12-21', 새치염색: 8 },
		]);
	});
});

describe('rankUtils.getLatestRankSummary', () => {
	it('상품별 history에서만 최신 rank/delta를 계산한다', () => {
		const s = getLatestRankSummary(sampleHistory, '새치염색');
		expect(s.rank).toBe(9);
		expect(s.delta).toBe(-1); // 8 -> 9, 1계단 하락
	});

	it('키워드가 없거나 history가 없으면 null을 반환한다', () => {
		expect(getLatestRankSummary(null, 'x')).toEqual({ rank: null, delta: null });
		expect(getLatestRankSummary(sampleHistory, '없는키워드')).toEqual({ rank: null, delta: null });
	});
});

describe('rankUtils.buildRankMatrixData', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-12-22T12:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('키워드 × 날짜 매트릭스 데이터를 생성한다', () => {
		const rows = buildRankMatrixData(sampleHistory, 3);

		expect(rows).toHaveLength(2);

		const first = rows[0]!;
		expect(first.keyword).toBe('새치염색');
		expect(first.cells).toEqual([
			{ date: '2025-12-22', rank: 9, delta: -1 }, // 8 -> 9, 1계단 하락
			{ date: '2025-12-21', rank: 8, delta: 2 }, // 10 -> 8, 2계단 상승
			{ date: '2025-12-20', rank: 10, delta: null },
		]);

		const second = rows[1]!;
		expect(second.keyword).toBe('천연염색');
		expect(second.cells).toEqual([
			{ date: '2025-12-22', rank: 4, delta: -1 }, // 20일(3위) → 22일(4위) 한 번에 비교
			{ date: '2025-12-21', rank: null, delta: null },
			{ date: '2025-12-20', rank: 3, delta: null },
		]);
	});

	it('history가 없으면 빈 배열을 반환한다', () => {
		expect(buildRankMatrixData(null, 7)).toEqual([]);
	});

	it('KST(Asia/Seoul) 기준으로 "오늘" 날짜 키를 만든다(UTC 오프셋 방지)', () => {
		// 2025-12-22 15:30Z == 2025-12-23 00:30 KST
		vi.setSystemTime(new Date('2025-12-22T15:30:00Z'));
		const rows = buildRankMatrixData(sampleHistory, 1);
		expect(rows[0]!.cells[0]!.date).toBe('2025-12-23');
	});
});


