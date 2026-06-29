import { describe, expect, it } from 'vitest';

import { mapActionItemToDecisionCard, mapLogItemToDecisionCard, mapProductItemToDecisionCard } from './AiOpsDecisionCardMappers';

describe('AiOpsDecisionCardMappers remaining', () => {
	it('product item을 공통 판단 카드로 변환한다', () => {
		const card = mapProductItemToDecisionCard(
			{
				sku_id: 'SKU-1',
				product_url: 'https://smartstore.naver.com/test/products/1',
				product_name: '테스트 상품',
				policy_type: 'AD_DEFENSE',
				policy_pack_id: 'AI_OPS_BRAND_A',
				top_issue: '핵심 키워드 방어 필요',
				priority_score: 82.5,
				confidence_score: 0.87,
				data_quality_score: 0.93,
				recommended_action_primary: '방어 광고 3일 테스트',
			},
			{ fromYmd: '2026-03-13', toYmd: '2026-04-11' },
		);

		expect(card.domain).toBe('products');
		expect(card.entityType).toBe('sku');
		expect(card.entityId).toBe('SKU-1');
		expect(card.title).toBe('테스트 상품');
		expect(card.badgeLabel).toBe('AD_DEFENSE');
		expect(card.contextLine).toBe('정책팩 AI_OPS_BRAND_A');
		expect(card.summary).toBe('핵심 키워드 방어 필요');
		expect(card.recommendedAction).toBe('방어 광고 3일 테스트');
		expect(card.metrics).toEqual([
			{ label: '우선순위', value: '83%', tone: 'warn' },
			{ label: '신뢰도', value: '87%', tone: 'good' },
			{ label: '데이터 품질', value: '93%', tone: 'good' },
		]);
	});

	it('action item을 공통 판단 카드로 변환한다', () => {
		const card = mapActionItemToDecisionCard(
			{
				queue_id: 'queue-1',
				entity_id: 'SKU-1',
				action_type: 'QUEUE_PRIMARY_ACTION',
				priority: 'P1',
				status: 'PENDING',
				approval_recommendation: 'APPROVE',
				approval_recommendation_reason: '추천 점수 88점',
				payload: {
					title: '방어 광고 3일 테스트',
					action_bucket: 'AD_DEFENSE',
					product_name: '테스트 상품',
					policy_type: 'AD_DEFENSE',
					top_issue: '핵심 키워드 방어 필요',
				},
			},
			{ fromYmd: '2026-03-13', toYmd: '2026-04-11' },
		);

		expect(card.domain).toBe('actions');
		expect(card.entityType).toBe('action');
		expect(card.entityId).toBe('queue-1');
		expect(card.title).toBe('방어 광고 3일 테스트');
		expect(card.badgeLabel).toBe('PENDING');
		expect(card.contextLine).toBe('대상 SKU-1 · 우선순위 P1');
		expect(card.approvalLine).toBe('승인 추천 워크플로우 가이드: APPROVE · 추천 점수 88점');
		expect(card.links.source.label).toBe('근거 보기');
		expect(card.links.source.path).toContain('/analytics/ai/organic-rank/trace?');
		expect(card.links.source.path).toContain('product=%ED%85%8C%EC%8A%A4%ED%8A%B8%20%EC%83%81%ED%92%88');
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=AD_DEFENSE');
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=AD_DEFENSE');
	});

	it('action item의 action bucket이 비어 있으면 기본 경로를 사용한다', () => {
		const card = mapActionItemToDecisionCard(
			{
				queue_id: 'queue-empty',
				entity_id: 'SKU-EMPTY',
				action_type: 'QUEUE_PRIMARY_ACTION',
				status: 'PENDING',
				payload: { title: '버킷 없는 액션' },
			},
			{ fromYmd: '2026-03-13', toYmd: '2026-04-11' },
		);

		expect(card.actionBucket).toBe('');
		expect(card.actionBucketLabel).toBe('미분류');
		expect(card.links.source.path).toContain('/analytics/ai/organic-rank/trace?');
		expect(card.links.queue.path).toBe('/analytics/ai/actions');
		expect(card.links.logs.path).toBe('/analytics/ai/logs');
	});

	it('log item을 공통 판단 카드로 변환한다', () => {
		const card = mapLogItemToDecisionCard(
			{
				sku_id: 'SKU-LOG-1',
				product_name: '로그 상품',
				policy_type: 'FAQ_CONTENT_IMPROVEMENT',
				policy_pack_id: 'AI_OPS',
				top_issue: '구매 직전 FAQ 공백',
				confidence_score: 0.91,
				latest_action_status: 'APPROVED',
				analysis_text: 'FAQ 보강이 우선입니다.',
				latest_action_payload: {
					title: 'FAQ 보강',
					action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
				},
			},
			{ fromYmd: '2026-03-13', toYmd: '2026-04-11' },
		);

		expect(card.domain).toBe('logs');
		expect(card.entityType).toBe('sku');
		expect(card.entityId).toBe('SKU-LOG-1');
		expect(card.title).toBe('로그 상품');
		expect(card.badgeLabel).toBe('APPROVED');
		expect(card.contextLine).toBe('SKU SKU-LOG-1');
		expect(card.summary).toBe('FAQ 보강이 우선입니다.');
		expect(card.metrics).toEqual([{ label: '신뢰도', value: '91%', tone: 'good' }]);
		expect(card.links.source.label).toBe('근거 보기');
		expect(card.links.source.path).toContain('/analytics/ai/organic-rank/trace?');
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=FAQ_CONTENT_IMPROVEMENT');
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=FAQ_CONTENT_IMPROVEMENT');
	});
});
