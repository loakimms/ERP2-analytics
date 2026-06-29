import { describe, expect, it } from 'vitest';
import {
	describeReviewCategory,
	formatSignedReviewNumber,
	formatSignedReviewPercent,
	labelReviewAnalysisPriority,
} from './reviewPresentation';

describe('reviewPresentation', () => {
	it('리뷰 카테고리 설명을 제공한다', () => {
		expect(describeReviewCategory('배송')).toContain('고객에게 전달되는 과정');
		expect(describeReviewCategory('')).toBe('분류 정보가 아직 집계되지 않았습니다.');
		expect(describeReviewCategory('커스텀')).toBe('커스텀 관련 리뷰를 하나의 주제로 묶어 보여주는 분석 카테고리입니다.');
	});

	it('리뷰 분석 우선순위를 한국어 라벨로 변환한다', () => {
		expect(labelReviewAnalysisPriority('high')).toBe('우선');
		expect(labelReviewAnalysisPriority('low')).toBe('관찰');
		expect(labelReviewAnalysisPriority('medium')).toBe('중요');
		expect(labelReviewAnalysisPriority('')).toBe('중요');
	});

	it('부호 포함 리뷰 지표 포맷을 제공한다', () => {
		expect(formatSignedReviewPercent(20)).toBe('+20.0%');
		expect(formatSignedReviewPercent(-3.4)).toBe('-3.4%');
		expect(formatSignedReviewNumber(0.25)).toBe('+0.25');
		expect(formatSignedReviewNumber(-0.2)).toBe('-0.20');
	});
});
