import { describe, expect, it, vi } from 'vitest';
import {
	REVIEW_ANALYSIS_DATE_RANGE_STORAGE_KEY,
	defaultReviewAnalysisDateRange,
	loadStoredReviewAnalysisDateRange,
	storeReviewAnalysisDateRange,
} from './reviewDateRange';

describe('reviewDateRange', () => {
	it('기본 리뷰 분석 기간을 최근 7일 범위로 계산한다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-11T10:00:00+09:00'));

		expect(defaultReviewAnalysisDateRange()).toEqual({
			from: '2026-04-05',
			to: '2026-04-11',
		});

		vi.useRealTimers();
	});

	it('저장된 리뷰 분석 기간을 복원한다', () => {
		const storage = {
			getItem: vi.fn(() => JSON.stringify({ from: '2026-04-01', to: '2026-04-07' })),
		};

		expect(loadStoredReviewAnalysisDateRange(storage)).toEqual({
			from: '2026-04-01',
			to: '2026-04-07',
		});
		expect(storage.getItem).toHaveBeenCalledWith(REVIEW_ANALYSIS_DATE_RANGE_STORAGE_KEY);
	});

	it('저장값이 없거나 형식이 잘못되면 기본 기간으로 되돌린다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-11T10:00:00+09:00'));

		expect(loadStoredReviewAnalysisDateRange({ getItem: vi.fn(() => null) })).toEqual({
			from: '2026-04-05',
			to: '2026-04-11',
		});
		expect(loadStoredReviewAnalysisDateRange({ getItem: vi.fn(() => '{"from":"bad","to":"2026-04-07"}') })).toEqual({
			from: '2026-04-05',
			to: '2026-04-11',
		});
		expect(loadStoredReviewAnalysisDateRange({ getItem: vi.fn(() => '{"from":"2026-04-08","to":"2026-04-07"}') })).toEqual({
			from: '2026-04-05',
			to: '2026-04-11',
		});

		vi.useRealTimers();
	});

	it('리뷰 분석 기간 저장은 storage 예외를 삼킨다', () => {
		const storage = {
			setItem: vi.fn(() => {
				throw new Error('quota exceeded');
			}),
		};

		expect(() =>
			storeReviewAnalysisDateRange(storage, {
				from: '2026-04-01',
				to: '2026-04-07',
			}),
		).not.toThrow();
	});
});
