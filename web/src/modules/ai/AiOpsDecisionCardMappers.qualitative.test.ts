import { describe, expect, expectTypeOf, it } from 'vitest';

import { mapQnaItemToDecisionCard, mapReviewItemToDecisionCard } from './AiOpsDecisionCardMappers';
import type { AiOpsQnaDecisionCard, AiOpsReviewDecisionCard } from './AiOpsDecisionCardTypes';
import type { AiOpsQnaProductItem, AiOpsReviewProductItem } from './AiOpsQualitativeTypes';

describe('AiOpsDecisionCardMappers qualitative', () => {
	it('review item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsReviewProductItem = {
			sku_id: 'SKU-REVIEW-1',
			product_name: '리뷰 위험 상품',
			action_bucket: 'VOC_IMPROVEMENT',
			top_issue: '배송 지연 불만이 반복됩니다.',
			recommended_action_primary: 'VOC 개선 후 재광고',
			negative_review_ratio: 0.41,
			negative_review_count: 12,
			severity: 'HIGH',
			risk_topics: ['배송', '포장'],
			strength_topics: ['발색'],
		};
		const card = mapReviewItemToDecisionCard(item);
		expectTypeOf(card).toEqualTypeOf<AiOpsReviewDecisionCard>();
		expectTypeOf(card.raw).toEqualTypeOf<AiOpsReviewProductItem>();

		expect(card.domain).toBe('reviews');
		expect(card.entityType).toBe('sku');
		expect(card.entityId).toBe('SKU-REVIEW-1');
		expect(card.title).toBe('리뷰 위험 상품');
		expect(card.actionBucket).toBe('VOC_IMPROVEMENT');
		expect(card.actionBucketLabel).toBe('리뷰 개선');
		expect(card.badgeLabel).toBe('리뷰 개선');
		expect(card.summary).toBe('배송 지연 불만이 반복됩니다.');
		expect(card.recommendedAction).toBe('VOC 개선 후 재광고');
		expect(card.metrics).toEqual([
			{ label: '부정 리뷰', value: '12개', tone: 'warn' },
			{ label: '부정 비율', value: '41%', tone: 'warn' },
		]);
		expect(card.links.source.label).toBe('리뷰 분석 열기');
		expect(card.links.source.path).toBe('/analytics/reviews/review-analysis');
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=VOC_IMPROVEMENT');
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=VOC_IMPROVEMENT');
		expect(card.raw).toBe(item);
	});

	it('qna item을 공통 판단 카드로 변환한다', () => {
		const item: AiOpsQnaProductItem = {
			sku_id: 'SKU-QNA-1',
			product_name: '문의 장벽 상품',
			action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
			top_issue: '구매 전 성분 문의가 반복됩니다.',
			recommended_action_primary: 'FAQ 등록 후 상세페이지 보강',
			faq_gap_count: 5,
			prepurchase_question_ratio: 0.88,
			severity: 'HIGH',
			issue_tags: ['성분', '사용법'],
		};
		const card = mapQnaItemToDecisionCard(item);
		expectTypeOf(card).toEqualTypeOf<AiOpsQnaDecisionCard>();
		expectTypeOf(card.raw).toEqualTypeOf<AiOpsQnaProductItem>();

		expect(card.domain).toBe('qna');
		expect(card.entityType).toBe('sku');
		expect(card.entityId).toBe('SKU-QNA-1');
		expect(card.title).toBe('문의 장벽 상품');
		expect(card.actionBucket).toBe('FAQ_CONTENT_IMPROVEMENT');
		expect(card.actionBucketLabel).toBe('FAQ 보강');
		expect(card.badgeLabel).toBe('FAQ 보강');
		expect(card.summary).toBe('구매 전 성분 문의가 반복됩니다.');
		expect(card.recommendedAction).toBe('FAQ 등록 후 상세페이지 보강');
		expect(card.metrics).toEqual([
			{ label: 'FAQ 공백', value: '5건', tone: 'warn' },
			{ label: '구매 직전 문의 비중', value: '88%', tone: 'warn' },
		]);
		expect(card.links.source.label).toBe('Q&A 분석 열기');
		expect(card.links.source.path).toBe('/analytics/reviews/qna-analysis');
		expect(card.links.queue.path).toBe('/analytics/ai/actions?action_bucket=FAQ_CONTENT_IMPROVEMENT');
		expect(card.links.logs.path).toBe('/analytics/ai/logs?action_bucket=FAQ_CONTENT_IMPROVEMENT');
		expect(card.raw).toBe(item);
	});

	it('review item의 action bucket이 비어 있으면 미분류와 기본 경로를 사용한다', () => {
		const card = mapReviewItemToDecisionCard({
			sku_id: 'SKU-REVIEW-EMPTY',
			product_name: '버킷 없는 리뷰 상품',
			action_bucket: null,
			top_issue: null,
			recommended_action_primary: null,
			negative_review_ratio: null,
			negative_review_count: null,
		});

		expect(card.actionBucket).toBe('');
		expect(card.actionBucketLabel).toBe('미분류');
		expect(card.badgeLabel).toBe('미분류');
		expect(card.links.queue.path).toBe('/analytics/ai/actions');
		expect(card.links.logs.path).toBe('/analytics/ai/logs');
	});
});
