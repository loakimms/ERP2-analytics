import { describe, expect, it } from 'vitest';

import { buildAiOpsQnaQueueRequest, buildAiOpsReviewQueueRequest } from './AiOpsQualitativeActions';

describe('AiOpsQualitativeActions', () => {
	it('review item으로 실행 큐 요청을 생성한다', () => {
		const request = buildAiOpsReviewQueueRequest({
			sku_id: 'SKU-REVIEW-1',
			product_name: '리뷰 위험 상품',
			action_bucket: 'VOC_IMPROVEMENT',
			top_issue: '배송 지연 불만이 반복됩니다.',
			recommended_action_primary: 'VOC 개선 후 재광고',
		});

		expect(request).toEqual({
			source_scope: 'ai-ops-reviews',
			entity_type: 'sku',
			entity_id: 'SKU-REVIEW-1',
			action_type: 'QUEUE_PRIMARY_ACTION',
			priority: 'P1',
			payload: {
				title: 'VOC 개선 후 재광고',
				product_name: '리뷰 위험 상품',
				action_bucket: 'VOC_IMPROVEMENT',
				top_issue: '배송 지연 불만이 반복됩니다.',
			},
		});
	});

	it('qna item으로 실행 큐 요청을 생성한다', () => {
		const request = buildAiOpsQnaQueueRequest({
			sku_id: 'SKU-QNA-1',
			product_name: '문의 장벽 상품',
			action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
			top_issue: '구매 전 성분 문의가 반복됩니다.',
			recommended_action_primary: 'FAQ 등록 후 상세페이지 보강',
		});

		expect(request).toEqual({
			source_scope: 'ai-ops-qna',
			entity_type: 'sku',
			entity_id: 'SKU-QNA-1',
			action_type: 'QUEUE_PRIMARY_ACTION',
			priority: 'P1',
			payload: {
				title: 'FAQ 등록 후 상세페이지 보강',
				product_name: '문의 장벽 상품',
				action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
				top_issue: '구매 전 성분 문의가 반복됩니다.',
			},
		});
	});

	it('sku id가 없으면 요청을 만들지 않는다', () => {
		expect(
			buildAiOpsReviewQueueRequest({
				product_name: '리뷰 위험 상품',
			}),
		).toBeNull();

		expect(
			buildAiOpsQnaQueueRequest({
				sku_id: '   ',
				product_name: '문의 장벽 상품',
			}),
		).toBeNull();
	});
});
