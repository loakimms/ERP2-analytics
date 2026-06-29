import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AiOpsLogActionChips, AiOpsLogHighlights, AiOpsLogsReportSummary } from './AiOpsLogsPresentation';

describe('AiOpsLogsPresentation', () => {
	it('운영 리포트 요약은 승인율과 검증 개선율, 주요 버킷을 표시한다', () => {
		render(
			<AiOpsLogsReportSummary
				approvalRate={0.67}
				approvedCount={2}
				rejectedCount={1}
				doneCount={0}
				improvementRate={0.5}
				verifiedCount={2}
				improvedCount={1}
				topBucket="BUDGET_INCREASE"
				topBucketCount={2}
			/>,
		);

		expect(screen.getByText('운영 리포트 요약')).toBeTruthy();
		expect(screen.getByText(/승인율 67%/)).toBeTruthy();
		expect(screen.getByText(/검증 개선율 50%/)).toBeTruthy();
		expect(screen.getByText(/주요 버킷 예산 증액 2건/)).toBeTruthy();
	});

	it('로그 하이라이트는 최신 메모와 과투입 요약을 표시한다', () => {
		render(
			<AiOpsLogHighlights
				latestActionNote="브랜드 정책팩 기준으로 확대 승인"
				overinvestmentKeyword="착시키워드"
				adCostLabel="55,000"
				adSpendRatioLabel="46%"
			/>,
		);

		expect(screen.getByText('브랜드 정책팩 기준으로 확대 승인')).toBeTruthy();
		expect(screen.getByText(/광고 과투입 · 키워드 착시키워드 · 광고비 55,000 · 광고비 비중 46%/)).toBeTruthy();
	});

	it('로그 액션 칩은 룰과 추천 액션 태그를 표시한다', () => {
		render(
			<AiOpsLogActionChips
				rulesTriggered={['qna_barrier_high', 'faq_candidate_detected']}
				recommendedActions={['FAQ 보강', '상세페이지 보강']}
			/>,
		);

		expect(screen.getByText('qna_barrier_high')).toBeTruthy();
		expect(screen.getByText('faq_candidate_detected')).toBeTruthy();
		expect(screen.getByText('FAQ 보강')).toBeTruthy();
		expect(screen.getByText('상세페이지 보강')).toBeTruthy();
	});
});
