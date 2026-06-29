import type {
	AiOpsQnaProductItem,
	AiOpsQnaQueueRequest,
	AiOpsReviewProductItem,
	AiOpsReviewsQueueRequest,
} from './AiOpsQualitativeTypes';

function trimmedText(value: string | null | undefined): string {
	return String(value ?? '').trim();
}

function nullableText(value: string | null | undefined): string | null {
	const trimmed = trimmedText(value);
	return trimmed ? trimmed : null;
}

export function buildAiOpsReviewQueueRequest(item: AiOpsReviewProductItem): AiOpsReviewsQueueRequest | null {
	const skuId = trimmedText(item.sku_id);
	if (!skuId) {
		return null;
	}

	return {
		source_scope: 'ai-ops-reviews',
		entity_type: 'sku',
		entity_id: skuId,
		action_type: 'QUEUE_PRIMARY_ACTION',
		priority: 'P1',
		payload: {
			title: trimmedText(item.recommended_action_primary) || 'VOC 개선',
			product_name: nullableText(item.product_name),
			action_bucket: nullableText(item.action_bucket),
			top_issue: nullableText(item.top_issue),
		},
	};
}

export function buildAiOpsQnaQueueRequest(item: AiOpsQnaProductItem): AiOpsQnaQueueRequest | null {
	const skuId = trimmedText(item.sku_id);
	if (!skuId) {
		return null;
	}

	return {
		source_scope: 'ai-ops-qna',
		entity_type: 'sku',
		entity_id: skuId,
		action_type: 'QUEUE_PRIMARY_ACTION',
		priority: 'P1',
		payload: {
			title: trimmedText(item.recommended_action_primary) || 'FAQ 등록',
			product_name: nullableText(item.product_name),
			action_bucket: nullableText(item.action_bucket),
			top_issue: nullableText(item.top_issue),
		},
	};
}
