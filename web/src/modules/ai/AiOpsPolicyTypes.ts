import type { OverinvestmentLearningSummary } from './AiOpsCommonTypes';

export type AiOpsPolicyItem = {
	policy_type?: string | null;
	sku_count?: number;
	avg_priority_score?: number | null;
	top_product_name?: string | null;
	top_priority_score?: number | null;
	top_recommended_action?: string | null;
	top_policy_pack_id?: string | null;
};

export type AiOpsPoliciesResponse = {
	ok?: boolean;
	summary?: {
		snapshot_date?: string | null;
		total_skus?: number;
		policy_count?: number;
		rule_pack_count?: number;
		format_version?: string | null;
		common_rules_len?: number;
	};
	learning_items?: Array<{
		policy_pack_id?: string | null;
		policy_pack_title?: string | null;
		action_count?: number;
		verified_count?: number;
		improved_count?: number;
		mixed_count?: number;
		declined_count?: number;
		improvement_rate?: number | null;
		avg_sales_growth_delta?: number | null;
	}>;
	items?: AiOpsPolicyItem[];
};

export type AiOpsPolicyCompareCandidate = {
	sku_id?: string;
	product_name?: string | null;
	policy_type?: string | null;
	current_policy_pack_id?: string | null;
	priority_score?: number | null;
};

export type AiOpsPolicyCompareItem = {
	policy_pack_id?: string | null;
	policy_pack_title?: string | null;
	scope?: {
		mall_names?: string[];
	};
	thresholds?: {
		qna_barrier_high?: number;
		review_risk_high?: number;
	};
	policy_type?: string | null;
	top_issue?: string | null;
	recommended_action_primary?: string | null;
	rules_triggered?: string[];
	matches_current_pack?: boolean;
	recommendation_score?: number | null;
	recommendation_reason?: string | null;
	recommended?: boolean;
	learning_summary?: {
		action_count?: number;
		verified_count?: number;
		improved_count?: number;
		mixed_count?: number;
		declined_count?: number;
		improvement_rate?: number | null;
		avg_sales_growth_delta?: number | null;
	};
	operation_learning_summary?: OverinvestmentLearningSummary | null;
};

export type AiOpsPolicyCompareResponse = {
	ok?: boolean;
	summary?: {
		snapshot_date?: string | null;
		selected_sku_id?: string | null;
		selected_product_name?: string | null;
		current_policy_pack_id?: string | null;
		recommended_policy_pack_id?: string | null;
	};
	candidates?: AiOpsPolicyCompareCandidate[];
	items?: AiOpsPolicyCompareItem[];
};
