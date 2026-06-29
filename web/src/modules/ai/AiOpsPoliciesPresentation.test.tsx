import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { AiOpsPolicyCompareCandidate, AiOpsPolicyCompareItem, AiOpsPolicyItem } from './AiOpsPolicyTypes';
import {
	AiOpsPolicyComparePanel,
	AiOpsPolicyDistributionList,
	AiOpsPolicyLearningGrid,
} from './AiOpsPoliciesPresentation';

describe('AiOpsPoliciesPresentation', () => {
	it('정책 분포 리스트는 정책 타입별 대표 정보를 표시한다', () => {
		const items: AiOpsPolicyItem[] = [
			{
				policy_type: 'FAQ_CONTENT_IMPROVEMENT',
				top_policy_pack_id: 'AI_OPS_BRAND_A',
				sku_count: 2,
				avg_priority_score: 80,
				top_product_name: '정책 상품 A',
				top_recommended_action: 'FAQ 보강',
			},
		];

		render(<AiOpsPolicyDistributionList items={items} />);

		expect(screen.getByText('FAQ_CONTENT_IMPROVEMENT')).toBeTruthy();
		expect(screen.getByText(/평균 우선순위 80점 · 대표 SKU 정책 상품 A/)).toBeTruthy();
		expect(screen.getByText(/대표 정책팩: AI_OPS_BRAND_A/)).toBeTruthy();
		expect(screen.getByText(/대표 액션: FAQ 보강/)).toBeTruthy();
	});

	it('정책팩 학습 그리드는 개선율과 검증/액션 통계를 표시한다', () => {
		render(
			<AiOpsPolicyLearningGrid
				items={[
					{
						policy_pack_id: 'AI_OPS_BRAND_A',
						policy_pack_title: '브랜드A 정책팩',
						action_count: 2,
						verified_count: 2,
						improved_count: 1,
						mixed_count: 1,
						declined_count: 0,
						improvement_rate: 0.5,
						avg_sales_growth_delta: 18,
					},
				]}
			/>,
		);

		expect(screen.getByText('브랜드A 정책팩')).toBeTruthy();
		expect(screen.getByText(/개선율 50%/)).toBeTruthy();
		expect(screen.getByText(/검증 2건 \/ 액션 2건/)).toBeTruthy();
		expect(screen.getByText(/평균 매출성장 변화 18/)).toBeTruthy();
	});

	it('정책팩 비교 패널은 SKU 선택과 비교 액션 적재를 처리한다', () => {
		const handleSelectSku = vi.fn();
		const handleQueue = vi.fn();
		const candidates: AiOpsPolicyCompareCandidate[] = [
			{ sku_id: 'SKU-COMPARE-1', product_name: '비교 SKU 1' },
			{ sku_id: 'SKU-COMPARE-2', product_name: '비교 SKU 2' },
		];
		const items: AiOpsPolicyCompareItem[] = [
			{
				policy_pack_id: 'AI_OPS',
				policy_pack_title: '공통 정책팩',
				policy_type: 'FAQ_CONTENT_IMPROVEMENT',
				top_issue: 'FAQ 보강 필요',
				recommended_action_primary: 'FAQ 보강',
				recommendation_score: 18,
				recommendation_reason: '현재 정책팩 유지',
				matches_current_pack: true,
			},
			{
				policy_pack_id: 'AI_OPS_BRAND_A',
				policy_pack_title: '브랜드A 정책팩',
				policy_type: 'AD_GROWTH',
				top_issue: '확장 가능합니다.',
				recommended_action_primary: '광고 확대 테스트',
				recommendation_score: 94,
				recommendation_reason: '검증 개선율 100%',
				recommended: true,
				matches_current_pack: false,
				learning_summary: {
					verified_count: 3,
					improvement_rate: 1,
				},
				operation_learning_summary: {
					verified_count: 1,
					improvement_rate: 1,
				},
			},
		];

		render(
			<AiOpsPolicyComparePanel
				candidates={candidates}
				selectedCompareSkuId="SKU-COMPARE-1"
				onSelectSku={handleSelectSku}
				currentPolicyPackId="AI_OPS"
				recommendedPolicyPackId="AI_OPS_BRAND_A"
				selectedProductName="비교 SKU 1"
				queueMessage="큐 적재 완료"
				items={items}
				onQueueCompareAction={handleQueue}
			/>,
		);

		expect(screen.getByText(/현재 적용 정책팩: AI_OPS/)).toBeTruthy();
		expect(screen.getByText(/추천 정책팩: AI_OPS_BRAND_A/)).toBeTruthy();
		expect(screen.getByText(/선택 SKU: 비교 SKU 1/)).toBeTruthy();
		expect(screen.getByText('큐 적재 완료')).toBeTruthy();
		expect(screen.getByText(/추천 점수: 94/)).toBeTruthy();
		expect(screen.getByText(/학습 검증 3건 \/ 개선율 100%/)).toBeTruthy();
		expect(screen.getByText(/운영 학습 검증 1건 \/ 개선율 100%/)).toBeTruthy();

		fireEvent.change(screen.getByLabelText('policy-compare-sku-select'), {
			target: { value: 'SKU-COMPARE-2' },
		});
		expect(handleSelectSku).toHaveBeenCalledWith('SKU-COMPARE-2');

		fireEvent.click(screen.getByLabelText('queue-compare-action-AI_OPS_BRAND_A'));
		expect(handleQueue).toHaveBeenCalledWith(items[1]);
	});
});
