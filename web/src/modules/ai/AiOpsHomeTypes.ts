import type { AiOpsFreshnessMeta, OverinvestmentLearningSummary } from './AiOpsCommonTypes';

export type AiOpsHomeItem = {
	sku_id?: string;
	product_name?: string | null;
	policy_type?: string | null;
	action_bucket?: string | null;
	top_issue?: string | null;
	recommended_action_primary?: string | null;
	priority_score?: number | null;
	effective_priority_score?: number | null;
	priority_reason?: string | null;
	operation_learning_summary?: OverinvestmentLearningSummary | null;
};

export type AiOpsHomeResponse = {
	ok?: boolean;
	summary?: {
		snapshot_date?: string | null;
		urgent_count?: number;
		pending_action_count?: number;
		high_priority_voc_count?: number;
		growth_opportunity_count?: number;
		faq_gap_count?: number;
		avg_data_quality_score?: number;
		operation_verified_count?: number;
		operation_improvement_rate?: number;
		operation_learning_note?: string | null;
		action_bucket_counts?: Record<string, number>;
	};
	items?: AiOpsHomeItem[];
	freshness?: AiOpsFreshnessMeta | null;
};
