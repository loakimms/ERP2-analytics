import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SalesDecisionExtraContent, SalesOverinvestmentExtraContent } from './AiOpsAdsSalesPresentation';

describe('AiOpsAdsSalesPresentation', () => {
	it('판매 판단 보조 정보는 주문/환불/환불률과 학습 요약을 표시한다', () => {
		render(
			<SalesDecisionExtraContent
				orderCount={12}
				refundOrderCount={2}
				refundRateLabel="17%"
				learningSummary={{
					action_count: 2,
					verified_count: 1,
					improved_count: 1,
					mixed_count: 0,
					declined_count: 0,
					improvement_rate: 1,
					avg_net_amount_delta: 15000,
					avg_ad_spend_ratio_delta: -0.12,
				}}
			/>,
		);

		expect(screen.getByText(/주문 12 \/ 환불주문 2 \/ 환불률 17%/)).toBeTruthy();
		expect(screen.getByText(/검증 1건 \/ 개선율 100%/)).toBeTruthy();
		expect(screen.getByText(/평균 광고비 비중 -12% \/ 평균 순매출 \+15,000/)).toBeTruthy();
	});

	it('광고-판매 과투입 보조 정보는 광고 구매전환/광고비 비중과 학습 요약을 표시한다', () => {
		render(
			<SalesOverinvestmentExtraContent
				adPurchaseConversions={3}
				adSpendRatioLabel="50%"
				learningSummary={{
					action_count: 2,
					verified_count: 2,
					improved_count: 2,
					mixed_count: 0,
					declined_count: 0,
					improvement_rate: 1,
					avg_cost_delta: -8000,
					avg_purchase_conversions_delta: 1,
					avg_roas_delta: 30.5,
				}}
			/>,
		);

		expect(screen.getByText(/광고 구매전환 3 \/ 광고비 비중 50%/)).toBeTruthy();
		expect(screen.getByText(/검증 2건 \/ 개선율 100%/)).toBeTruthy();
		expect(screen.getByText(/평균 구매전환 \+1 \/ 평균 ROAS \+30.5/)).toBeTruthy();
	});
});
