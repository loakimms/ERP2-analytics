import { describe, expect, it } from 'vitest';

import { mapHomeItemToDecisionCard } from './AiOpsDecisionCardMappers';
import type { AiOpsHomeItem } from './AiOpsHomeTypes';

describe('AiOpsDecisionCardMappers home', () => {
	it('home item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsHomeItem = {
			sku_id: 'SKU-B',
			product_name: '상품B',
			policy_type: 'AD_GROWTH',
			action_bucket: 'BUDGET_INCREASE',
			top_issue: '광고 확장 기회',
			recommended_action_primary: '예산 증액 테스트',
			priority_score: 76,
			effective_priority_score: 95,
			priority_reason: '운영 학습 가중치 +19점',
		};

		const card = mapHomeItemToDecisionCard(item, {
			fromYmd: '2026-03-13',
			toYmd: '2026-04-11',
		});

		expect(card.domain).toBe('home');
		expect(card.entityType).toBe('sku');
		expect(card.entityId).toBe('SKU-B');
		expect(card.title).toBe('상품B');
		expect(card.actionBucket).toBe('BUDGET_INCREASE');
		expect(card.actionBucketLabel).toBe('예산 증액');
		expect(card.policyLabel).toBe('AD_GROWTH');
		expect(card.summary).toBe('광고 확장 기회');
		expect(card.recommendedAction).toBe('예산 증액 테스트');
		expect(card.priorityReason).toBe('운영 학습 가중치 +19점');
		expect(card.metrics).toEqual([
			{ label: '유효 우선순위', value: '95', tone: 'warn' },
			{ label: '기준 우선순위', value: '76', tone: 'neutral' },
		]);
		expect(card.links.source.label).toBe('구매 키워드 분석 열기');
		expect(card.links.source.path).toContain('/analytics/performance/purchase-keywords?product=');
		expect(card.links.source.ariaLabel).toBe('home-item-source-SKU-B');
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=BUDGET_INCREASE');
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=BUDGET_INCREASE');
	});

	it('bucket과 점수가 비어 있어도 기본값으로 안전하게 변환한다', () => {
		const item: AiOpsHomeItem = {
			product_name: '무명 상품',
			top_issue: null,
			recommended_action_primary: null,
		};

		const card = mapHomeItemToDecisionCard(item, {
			fromYmd: '2026-03-13',
			toYmd: '2026-04-11',
		});

		expect(card.entityId).toBe('unknown');
		expect(card.actionBucket).toBe('');
		expect(card.actionBucketLabel).toBe('미분류');
		expect(card.summary).toBe('주요 이슈 없음');
		expect(card.recommendedAction).toBe('추가 판단 필요');
		expect(card.metrics).toEqual([
			{ label: '유효 우선순위', value: '0', tone: 'warn' },
			{ label: '기준 우선순위', value: '0', tone: 'neutral' },
		]);
		expect(card.links.queue.path).toBe('/analytics/ai/actions');
		expect(card.links.logs.path).toBe('/analytics/ai/logs');
	});
});
