import type { OverinvestmentLearningSummary } from './AiOpsCommonTypes';

export type AiOpsAdsItem = {
	campaign_name?: string | null;
	adgroup_name?: string | null;
	keyword?: string | null;
	campaign_kind?: string | null;
	impressions?: number | null;
	clicks?: number | null;
	cost?: number | null;
	purchase_conversions?: number | null;
	purchase_revenue?: number | null;
	ctr?: number | null;
	roas?: number | null;
	action_bucket?: string | null;
	top_issue?: string | null;
	recommended_action?: string | null;
	priority?: string | null;
	approval_recommendation?: string | null;
	approval_recommendation_reason?: string | null;
	learning_summary?: OverinvestmentLearningSummary | null;
	learning_score?: number | null;
};

export type AiOpsAdsCannibalizationItem = {
	campaign_name?: string | null;
	adgroup_name?: string | null;
	keyword?: string | null;
	cost?: number | null;
	roas?: number | null;
	organic_rank?: number | null;
	action_kind?: string | null;
	top_issue?: string | null;
	recommended_action?: string | null;
	priority?: string | null;
	approval_recommendation?: string | null;
	approval_recommendation_reason?: string | null;
	learning_summary?: OverinvestmentLearningSummary | null;
	learning_score?: number | null;
};

export type AiOpsAdsBudgetItem = {
	campaign_name?: string | null;
	adgroup_name?: string | null;
	keyword?: string | null;
	cost?: number | null;
	roas?: number | null;
	budget_direction?: string | null;
	action_kind?: string | null;
	top_issue?: string | null;
	recommended_action?: string | null;
	priority?: string | null;
	approval_recommendation?: string | null;
	approval_recommendation_reason?: string | null;
	learning_summary?: OverinvestmentLearningSummary | null;
	learning_score?: number | null;
};

export type AiOpsAdsResponse = {
	ok?: boolean;
	summary?: {
		snapshot_date?: string | null;
		total_keywords?: number;
		listed_count?: number;
		action_buckets?: string[];
		cannibalization_count?: number;
		budget_count?: number;
		selected_action_bucket?: string | null;
	};
	items?: AiOpsAdsItem[];
	cannibalization_items?: AiOpsAdsCannibalizationItem[];
	budget_items?: AiOpsAdsBudgetItem[];
};

export type AiOpsSalesItem = {
	product_id?: number | null;
	product_name?: string | null;
	category_large?: string | null;
	order_count?: number | null;
	refund_order_count?: number | null;
	amount?: number | null;
	refund_amount?: number | null;
	net_amount?: number | null;
	refund_ratio?: number | null;
	action_bucket?: string | null;
	top_issue?: string | null;
	recommended_action?: string | null;
	priority?: string | null;
	approval_recommendation?: string | null;
	approval_recommendation_reason?: string | null;
	learning_summary?: OverinvestmentLearningSummary | null;
};

export type AiOpsSalesOverinvestmentItem = {
	product_id?: number | null;
	product_name?: string | null;
	keyword?: string | null;
	order_count?: number | null;
	amount?: number | null;
	refund_amount?: number | null;
	net_amount?: number | null;
	ad_cost?: number | null;
	ad_purchase_conversions?: number | null;
	ad_purchase_revenue?: number | null;
	ad_roas?: number | null;
	ad_spend_ratio?: number | null;
	action_bucket?: string | null;
	top_issue?: string | null;
	recommended_action?: string | null;
	priority?: string | null;
	approval_recommendation?: string | null;
	approval_recommendation_reason?: string | null;
	learning_summary?: OverinvestmentLearningSummary | null;
	learning_score?: number | null;
};

export type AiOpsSalesResponse = {
	ok?: boolean;
	summary?: {
		snapshot_date?: string | null;
		total_products?: number;
		listed_count?: number;
		action_buckets?: string[];
		focus_count?: number;
		risk_hold_count?: number;
		low_contribution_count?: number;
		overinvestment_count?: number;
	};
	items?: AiOpsSalesItem[];
	overinvestment_items?: AiOpsSalesOverinvestmentItem[];
};
