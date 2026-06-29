export type AiOpsActionItem = {
	queue_id?: string;
	entity_id?: string;
	action_type?: string;
	priority?: string;
	status?: string;
	approval_recommendation?: string | null;
	approval_recommendation_reason?: string | null;
	reviewer?: string | null;
	review_note?: string | null;
	verification?: {
		status?: string | null;
		label?: string | null;
		outcome?: string | null;
		baseline_date?: string | null;
		latest_date?: string | null;
		days_elapsed?: number | null;
		latest_policy_type?: string | null;
		metrics?: {
			sales_growth_delta?: number | null;
			organic_strength_delta?: number | null;
			review_risk_delta?: number | null;
			qna_barrier_delta?: number | null;
			net_amount_delta?: number | null;
			ad_spend_ratio_delta?: number | null;
			ad_cost_delta?: number | null;
			ad_roas_delta?: number | null;
			purchase_conversions_delta?: number | null;
			purchase_revenue_delta?: number | null;
		};
	};
	payload?: {
		title?: string;
		[key: string]: unknown;
	};
};

export type AiOpsActionsResponse = {
	ok?: boolean;
	summary?: {
		pending_count?: number;
		listed_count?: number;
	};
	items?: AiOpsActionItem[];
};
