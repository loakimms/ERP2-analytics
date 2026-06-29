import { describe, expect, expectTypeOf, it } from 'vitest';

import {
	mapAdsBudgetItemToDecisionCard,
	mapAdsCannibalizationItemToDecisionCard,
	mapAdsItemToDecisionCard,
} from './AiOpsDecisionCardMappers';
import type {
	AiOpsAdsBudgetDecisionCard,
	AiOpsAdsCannibalizationDecisionCard,
	AiOpsAdsDecisionCard,
} from './AiOpsDecisionCardTypes';
import type { AiOpsAdsBudgetItem, AiOpsAdsCannibalizationItem, AiOpsAdsItem } from './AiOpsAdsSalesTypes';

describe('AiOpsDecisionCardMappers ads', () => {
	it('ads item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsAdsItem = {
			campaign_name: '브랜드 캠페인',
			adgroup_name: '방어 그룹',
			keyword: '브랜드 키워드',
			cost: 15000,
			clicks: 12,
			purchase_conversions: 0,
			purchase_revenue: 0,
			roas: 0,
			action_bucket: 'STOP',
			top_issue: '비용이 누적되지만 실제 구매 전환이 없습니다.',
			recommended_action: '비효율 키워드 중단',
			priority: 'P1',
			approval_recommendation: 'APPROVE',
		};
		const card = mapAdsItemToDecisionCard(item);
		expectTypeOf(card).toEqualTypeOf<AiOpsAdsDecisionCard>();
		expectTypeOf(card.raw).toEqualTypeOf<AiOpsAdsItem>();

		expect(card.domain).toBe('ads');
		expect(card.entityType).toBe('keyword');
		expect(card.entityId).toBe('브랜드 캠페인::방어 그룹::브랜드 키워드');
		expect(card.title).toBe('브랜드 키워드');
		expect(card.actionBucket).toBe('STOP');
		expect(card.badgeLabel).toBe('STOP · P1');
		expect(card.contextLine).toBe('캠페인 브랜드 캠페인 / 그룹 방어 그룹');
		expect(card.metrics).toEqual([
			{ label: '비용', value: '15,000', tone: 'warn' },
			{ label: '클릭', value: '12', tone: 'neutral' },
			{ label: '구매전환', value: '0', tone: 'warn' },
			{ label: 'ROAS', value: '0', tone: 'neutral' },
		]);
	});

	it('ads cannibalization item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsAdsCannibalizationItem = {
			campaign_name: '브랜드 캠페인',
			adgroup_name: '방어 그룹',
			keyword: '브랜드 키워드',
			cost: 18000,
			roas: 66.7,
			organic_rank: 1,
			action_kind: 'CANNIBALIZATION_DECREASE',
			top_issue: '오가닉 1위인데 광고 비용이 계속 지출되고 있습니다.',
			recommended_action: '잠식 감액 테스트',
			priority: 'P1',
			approval_recommendation: 'APPROVE',
			approval_recommendation_reason: '잠식 감액 학습상 비용 절감과 전환 방어가 확인돼 우선 실행을 권장합니다.',
		};
		const card = mapAdsCannibalizationItemToDecisionCard(item);
		expectTypeOf(card).toEqualTypeOf<AiOpsAdsCannibalizationDecisionCard>();
		expectTypeOf(card.raw).toEqualTypeOf<AiOpsAdsCannibalizationItem>();

		expect(card.actionBucket).toBe('CANNIBALIZATION_DECREASE');
		expect(card.badgeLabel).toBe('오가닉 1위 · P1');
		expect(card.metrics).toEqual([
			{ label: '비용', value: '18,000', tone: 'warn' },
			{ label: 'ROAS', value: '67', tone: 'neutral' },
		]);
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=CANNIBALIZATION_DECREASE');
	});

	it('ads budget item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsAdsBudgetItem = {
			campaign_name: '성장 캠페인',
			adgroup_name: '확장 그룹',
			keyword: '확장 키워드',
			cost: 12000,
			roas: 500,
			budget_direction: 'INCREASE',
			action_kind: 'BUDGET_INCREASE',
			top_issue: '실구매 ROAS가 우수해 예산 확대 여력이 있습니다.',
			recommended_action: '예산 증액 테스트',
			priority: 'P1',
			approval_recommendation: 'APPROVE',
		};
		const card = mapAdsBudgetItemToDecisionCard(item);
		expectTypeOf(card).toEqualTypeOf<AiOpsAdsBudgetDecisionCard>();
		expectTypeOf(card.raw).toEqualTypeOf<AiOpsAdsBudgetItem>();

		expect(card.actionBucket).toBe('BUDGET_INCREASE');
		expect(card.badgeLabel).toBe('INCREASE · P1');
		expect(card.metrics).toEqual([
			{ label: '비용', value: '12,000', tone: 'warn' },
			{ label: 'ROAS', value: '500', tone: 'neutral' },
		]);
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=BUDGET_INCREASE');
	});
});
