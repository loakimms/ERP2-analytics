import { describe, expect, expectTypeOf, it } from 'vitest';

import { mapSalesItemToDecisionCard, mapSalesOverinvestmentItemToDecisionCard } from './AiOpsDecisionCardMappers';
import type { AiOpsSalesDecisionCard, AiOpsSalesOverinvestmentDecisionCard } from './AiOpsDecisionCardTypes';
import type { AiOpsSalesItem, AiOpsSalesOverinvestmentItem } from './AiOpsAdsSalesTypes';

describe('AiOpsDecisionCardMappers sales', () => {
	it('sales item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsSalesItem = {
			product_id: 9002,
			product_name: '환불 위험 상품',
			category_large: '식품',
			order_count: 6,
			refund_order_count: 2,
			amount: 220000,
			refund_amount: 80000,
			net_amount: 140000,
			refund_ratio: 0.3636,
			action_bucket: 'RISK_HOLD',
			top_issue: '환불 비중이 높아 확대보다 품질/운영 보정이 먼저입니다.',
			recommended_action: '확대 보류 및 환불 원인 점검',
			priority: 'P1',
			approval_recommendation: 'REVIEW',
			approval_recommendation_reason: '실매출이 약해 바로 확대보다 과투입 여부를 먼저 검토해야 합니다.',
		};

		const card = mapSalesItemToDecisionCard(item);
		expectTypeOf(card).toEqualTypeOf<AiOpsSalesDecisionCard>();
		expectTypeOf(card.raw).toEqualTypeOf<AiOpsSalesItem>();

		expect(card.domain).toBe('sales');
		expect(card.entityType).toBe('product');
		expect(card.entityId).toBe('9002');
		expect(card.title).toBe('환불 위험 상품');
		expect(card.actionBucket).toBe('RISK_HOLD');
		expect(card.actionBucketLabel).toBe('확대 보류');
		expect(card.badgeLabel).toBe('RISK_HOLD · P1');
		expect(card.contextLine).toBe('상품 ID 9002 / 카테고리 식품');
		expect(card.summary).toBe('환불 비중이 높아 확대보다 품질/운영 보정이 먼저입니다.');
		expect(card.recommendedAction).toBe('확대 보류 및 환불 원인 점검');
		expect(card.approvalLine).toBe('승인 추천 REVIEW · 실매출이 약해 바로 확대보다 과투입 여부를 먼저 검토해야 합니다.');
		expect(card.metrics).toEqual([
			{ label: '총매출', value: '220,000', tone: 'neutral' },
			{ label: '환불', value: '80,000', tone: 'warn' },
			{ label: '순매출', value: '140,000', tone: 'good' },
			{ label: '환불률', value: '36%', tone: 'warn' },
		]);
		expect(card.links.source.label).toBe('판매 대시보드 열기');
		expect(card.links.source.path).toBe('/analytics/sales/dashboard');
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=RISK_HOLD');
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=RISK_HOLD');
	});

	it('sales overinvestment item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsSalesOverinvestmentItem = {
			product_id: 9010,
			product_name: '광고 착시 상품',
			keyword: '착시키워드',
			order_count: 2,
			amount: 110000,
			refund_amount: 0,
			net_amount: 110000,
			ad_cost: 55000,
			ad_purchase_conversions: 3,
			ad_purchase_revenue: 200000,
			ad_roas: 363.6,
			ad_spend_ratio: 0.5,
			action_bucket: 'AD_OVERINVESTMENT',
			top_issue: '광고 성과는 좋아 보이지만 순매출 대비 광고비 비중이 과도합니다.',
			recommended_action: '광고 과투입 점검 및 예산 축소 테스트',
			priority: 'P1',
			approval_recommendation: 'APPROVE',
			approval_recommendation_reason: '동일 키워드 과투입 축소 학습상 개선율이 높아 우선 승인해볼 만합니다.',
		};

		const card = mapSalesOverinvestmentItemToDecisionCard(item);
		expectTypeOf(card).toEqualTypeOf<AiOpsSalesOverinvestmentDecisionCard>();
		expectTypeOf(card.raw).toEqualTypeOf<AiOpsSalesOverinvestmentItem>();

		expect(card.domain).toBe('sales');
		expect(card.entityType).toBe('product');
		expect(card.entityId).toBe('9010');
		expect(card.title).toBe('광고 착시 상품');
		expect(card.actionBucket).toBe('AD_OVERINVESTMENT');
		expect(card.actionBucketLabel).toBe('광고 과투입 점검');
		expect(card.badgeLabel).toBe('AD_OVERINVESTMENT · P1');
		expect(card.contextLine).toBe('상품 ID 9010 / 대표 키워드 착시키워드');
		expect(card.recommendedAction).toBe('광고 과투입 점검 및 예산 축소 테스트');
		expect(card.metrics).toEqual([
			{ label: '순매출', value: '110,000', tone: 'good' },
			{ label: '광고비', value: '55,000', tone: 'warn' },
			{ label: '광고 ROAS', value: '364', tone: 'neutral' },
			{ label: '광고비 비중', value: '50%', tone: 'warn' },
		]);
		expect(card.links.source.label).toBe('광고 운영 판단 열기');
		expect(card.links.source.path).toBe('/analytics/ai/ads?action_bucket=AD_OVERINVESTMENT');
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=AD_OVERINVESTMENT');
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=AD_OVERINVESTMENT');
	});
});
