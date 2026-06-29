export type AiOpsViewProps = {
	apiBaseUrl: string;
};

export type OverinvestmentLearningSummary = {
	action_count?: number | null;
	verified_count?: number | null;
	improved_count?: number | null;
	mixed_count?: number | null;
	declined_count?: number | null;
	improvement_rate?: number | null;
	avg_net_amount_delta?: number | null;
	avg_ad_spend_ratio_delta?: number | null;
	avg_ad_cost_delta?: number | null;
	avg_cost_delta?: number | null;
	avg_purchase_conversions_delta?: number | null;
	avg_purchase_revenue_delta?: number | null;
	avg_roas_delta?: number | null;
};

export type AiOpsFreshnessMeta = {
	health_as_of?: string | null;
	ads_as_of?: string | null;
	sales_as_of?: string | null;
	health_days_stale?: number | null;
	ads_days_stale?: number | null;
	sales_days_stale?: number | null;
	health_missing?: boolean;
	ads_missing?: boolean;
	sales_missing?: boolean;
};

export type QuickLink = {
	label: string;
	path: string;
	testId?: string;
};
