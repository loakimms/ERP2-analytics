import type { Page, Route } from '@playwright/test';

type JsonMap = Record<string, unknown>;

type ProductDecisionItem = {
	sku_id: string;
	product_name: string;
	policy_type: string;
	policy_pack_id: string;
	top_issue: string;
	priority_score: number;
	confidence_score: number;
	data_quality_score: number;
	recommended_action_primary: string;
	[key: string]: unknown;
};

type ReviewDecisionItem = {
	sku_id: string;
	product_name: string;
	action_bucket: string;
	top_issue: string;
	recommended_action_primary: string;
	negative_review_ratio: number;
	negative_review_count: number;
	severity: string;
	risk_topics: string[];
	strength_topics: string[];
	[key: string]: unknown;
};

type QnaDecisionItem = {
	sku_id: string;
	product_name: string;
	action_bucket: string;
	top_issue: string;
	recommended_action_primary: string;
	faq_gap_count: number;
	prepurchase_question_ratio: number;
	severity: string;
	issue_tags: string[];
	[key: string]: unknown;
};

type PolicyCompareItem = {
	policy_pack_id: string;
	policy_pack_title: string;
	policy_type: string;
	top_issue: string;
	recommended_action_primary: string;
	recommendation_score: number;
	recommendation_reason: string;
	recommended: boolean;
	matches_current_pack: boolean;
	[key: string]: unknown;
};

type QueuePayload = {
	title?: string;
	product_name?: string;
	action_bucket?: string;
	top_issue?: string;
	policy_type?: string;
	[key: string]: unknown;
};

type QueueItem = {
	queue_id: string;
	entity_id: string;
	action_type: string;
	status: string;
	priority: string;
	approval_recommendation?: string | null;
	approval_recommendation_reason?: string | null;
	payload: QueuePayload;
	verification: unknown | null;
	review_note: string | null;
	[key: string]: unknown;
};

export function okJson<T extends JsonMap>(payload: T): { json: { ok: true } & T } {
	return {
		json: {
			ok: true,
			...payload,
		},
	};
}

export function buildQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
	const payloadOverrides = (overrides.payload as QueuePayload | undefined) ?? {};
	return {
		queue_id: 'QUEUE-DEFAULT-1',
		entity_id: 'SKU-DEFAULT-1',
		action_type: 'QUEUE_PRIMARY_ACTION',
		status: 'PENDING',
		priority: 'P1',
		approval_recommendation: 'APPROVE',
		approval_recommendation_reason: null,
		payload: {
			title: '기본 액션',
			product_name: '기본 상품',
			action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
			top_issue: '기본 이슈',
			policy_type: 'FAQ_CONTENT_IMPROVEMENT',
			...payloadOverrides,
		},
		verification: null,
		review_note: null,
		...overrides,
		payload: {
			title: '기본 액션',
			product_name: '기본 상품',
			action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
			top_issue: '기본 이슈',
			policy_type: 'FAQ_CONTENT_IMPROVEMENT',
			...payloadOverrides,
		},
	};
}

export function buildProductDecisionItem(overrides: Partial<ProductDecisionItem> = {}): ProductDecisionItem {
	return {
		sku_id: 'SKU-PRODUCT-1',
		product_name: '테스트 상품',
		policy_type: 'FAQ_CONTENT_IMPROVEMENT',
		policy_pack_id: 'AI_OPS',
		top_issue: 'FAQ 보강 필요',
		priority_score: 92,
		confidence_score: 0.88,
		data_quality_score: 0.91,
		recommended_action_primary: 'FAQ 보강',
		...overrides,
	};
}

export function buildReviewDecisionItem(overrides: Partial<ReviewDecisionItem> = {}): ReviewDecisionItem {
	return {
		sku_id: 'SKU-REVIEW-1',
		product_name: '리뷰 상품',
		action_bucket: 'VOC_IMPROVEMENT',
		top_issue: '배송 불만 반복',
		recommended_action_primary: 'VOC 개선',
		negative_review_ratio: 0.42,
		negative_review_count: 12,
		severity: 'HIGH',
		risk_topics: ['배송'],
		strength_topics: ['발색'],
		...overrides,
	};
}

export function buildQnaDecisionItem(overrides: Partial<QnaDecisionItem> = {}): QnaDecisionItem {
	return {
		sku_id: 'SKU-QNA-1',
		product_name: 'Q&A 상품',
		action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
		top_issue: '성분 문의 반복',
		recommended_action_primary: 'FAQ 등록',
		faq_gap_count: 5,
		prepurchase_question_ratio: 0.87,
		severity: 'HIGH',
		issue_tags: ['성분'],
		...overrides,
	};
}

export function buildPolicyCompareItem(overrides: Partial<PolicyCompareItem> = {}): PolicyCompareItem {
	return {
		policy_pack_id: 'AI_OPS',
		policy_pack_title: '공통 정책팩',
		policy_type: 'FAQ_CONTENT_IMPROVEMENT',
		top_issue: 'FAQ 보강 필요',
		recommended_action_primary: 'FAQ 보강',
		recommendation_score: 18,
		recommendation_reason: '현재 정책팩 유지',
		recommended: false,
		matches_current_pack: true,
		...overrides,
	};
}

export async function mockAiOpsActionsRoute(args: {
	page: Page;
	items?: QueueItem[];
	summary?: JsonMap;
	onPostCapture?: (body: Record<string, unknown>) => void;
}): Promise<void> {
	const { page, items = [], summary = {}, onPostCapture } = args;
	await page.route('**/ai/ops/actions', async (route: Route) => {
		const method = route.request().method();
		if (method === 'GET') {
			await route.fulfill(
				okJson({
					summary,
					items,
				}),
			);
			return;
		}
		if (method === 'POST' && onPostCapture) {
			onPostCapture(route.request().postDataJSON() as Record<string, unknown>);
			await route.fulfill(okJson({}));
			return;
		}
		await route.fallback();
	});
}

export async function capturePostJson(args: {
	page: Page;
	url: string;
	onCapture: (body: Record<string, unknown>) => void;
}): Promise<void> {
	await args.page.route(args.url, async (route: Route) => {
		args.onCapture(route.request().postDataJSON() as Record<string, unknown>);
		await route.fulfill(okJson({}));
	});
}
