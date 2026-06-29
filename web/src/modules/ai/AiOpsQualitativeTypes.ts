export type AiOpsReviewProductItem = {
	sku_id?: string;
	product_name?: string | null;
	action_bucket?: string | null;
	top_issue?: string | null;
	recommended_action_primary?: string | null;
	negative_review_ratio?: number | null;
	negative_review_count?: number | null;
	severity?: string | null;
	risk_topics?: string[];
	strength_topics?: string[];
};

export type AiOpsReviewsSourceScope = 'ai-ops-reviews';
export type AiOpsQnaSourceScope = 'ai-ops-qna';
export type AiOpsQualitativeSourceScope = AiOpsReviewsSourceScope | AiOpsQnaSourceScope;

export type AiOpsQualitativeQueuePayload = {
	title: string;
	product_name: string | null;
	action_bucket: string | null;
	top_issue: string | null;
};

type AiOpsQualitativeQueueRequestBase<TSourceScope extends AiOpsQualitativeSourceScope> = {
	source_scope: TSourceScope;
	entity_type: 'sku';
	entity_id: string;
	action_type: 'QUEUE_PRIMARY_ACTION';
	priority: 'P1';
	payload: AiOpsQualitativeQueuePayload;
};

export type AiOpsReviewsQueueRequest = AiOpsQualitativeQueueRequestBase<AiOpsReviewsSourceScope>;
export type AiOpsQnaQueueRequest = AiOpsQualitativeQueueRequestBase<AiOpsQnaSourceScope>;

export type AiOpsReviewsProductsResponse = {
	ok?: boolean;
	items?: AiOpsReviewProductItem[];
};

export type AiOpsReviewsSummaryResponse = {
	ok?: boolean;
	summary?: {
		total_products?: number;
		urgent_count?: number;
		reply_improvement_count?: number;
		hold_count?: number;
		avg_negative_ratio?: number | null;
	};
};

export type AiOpsRecommendedActionItem = {
	title?: string | null;
	action_bucket?: string | null;
	expected_effect?: string | null;
	owner?: string | null;
};

export type AiOpsReviewsActionsResponse = {
	ok?: boolean;
	actions?: AiOpsRecommendedActionItem[];
};

export type AiOpsQnaProductItem = {
	sku_id?: string;
	product_name?: string | null;
	action_bucket?: string | null;
	top_issue?: string | null;
	recommended_action_primary?: string | null;
	faq_gap_count?: number | null;
	prepurchase_question_ratio?: number | null;
	severity?: string | null;
	issue_tags?: string[];
};

export type AiOpsQnaProductsResponse = {
	ok?: boolean;
	items?: AiOpsQnaProductItem[];
};

export type AiOpsQnaSummaryResponse = {
	ok?: boolean;
	summary?: {
		total_products?: number;
		barrier_count?: number;
		faq_gap_count?: number;
		detail_gap_count?: number;
		prepurchase_ratio?: number | null;
	};
};

export type AiOpsQnaActionsResponse = {
	ok?: boolean;
	actions?: AiOpsRecommendedActionItem[];
};
