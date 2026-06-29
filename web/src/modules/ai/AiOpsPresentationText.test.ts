import { describe, expect, it } from 'vitest';

import {
	formatAiOpsAverageSalesGrowthLine,
	formatAiOpsLearningRateLine,
	formatAiOpsLogsApprovalSummaryLine,
	formatAiOpsLogsVerificationSummaryLine,
	formatAiOpsOverinvestmentHighlightLine,
	formatAiOpsPolicyDistributionSummaryLine,
	formatAiOpsTopBucketSummaryLine,
} from './AiOpsPresentationText';

describe('AiOpsPresentationText', () => {
	it('정책 분포 요약 문장을 만든다', () => {
		expect(formatAiOpsPolicyDistributionSummaryLine(80, '정책 상품 A')).toBe('평균 우선순위 80점 · 대표 SKU 정책 상품 A');
	});

	it('학습 검증 문장을 만든다', () => {
		expect(formatAiOpsLearningRateLine('학습 검증', 3, 1)).toBe('학습 검증 3건 / 개선율 100%');
		expect(formatAiOpsLearningRateLine('운영 학습 검증', 1, 1)).toBe('운영 학습 검증 1건 / 개선율 100%');
	});

	it('로그 요약 문장을 만든다', () => {
		expect(formatAiOpsLogsApprovalSummaryLine(0.67, 2, 1, 0)).toBe('승인율 67% · 승인 2건 · 반려 1건 · 완료 0건');
		expect(formatAiOpsLogsVerificationSummaryLine(0.5, 2, 1)).toBe('검증 개선율 50% · 검증 2건 · 개선 1건');
		expect(formatAiOpsTopBucketSummaryLine('BUDGET_INCREASE', 2)).toBe('주요 버킷 예산 증액 2건');
	});

	it('과투입 하이라이트 문장을 만든다', () => {
		expect(formatAiOpsOverinvestmentHighlightLine('착시키워드', '55,000', '46%')).toBe(
			'광고 과투입 · 키워드 착시키워드 · 광고비 55,000 · 광고비 비중 46%',
		);
	});

	it('평균 매출성장 문장을 만든다', () => {
		expect(formatAiOpsAverageSalesGrowthLine(18)).toBe('평균 매출성장 변화 18');
	});
});
