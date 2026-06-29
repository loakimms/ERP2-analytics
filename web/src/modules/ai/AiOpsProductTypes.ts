export type AiOpsProductItem = {
	date?: string | null;
	sku_id?: string;
	product_url?: string | null;
	product_name?: string | null;
	policy_type?: string | null;
	policy_pack_id?: string | null;
	top_issue?: string | null;
	priority_score?: number | null;
	confidence_score?: number | null;
	data_quality_score?: number | null;
	recommended_action_primary?: string | null;
};

export type AiOpsProductsResponse = {
	ok?: boolean;
	summary?: {
		snapshot_date?: string | null;
		total_items?: number;
		policy_pack_ids?: string[];
		selected_policy_pack_id?: string | null;
	};
	items?: AiOpsProductItem[];
};
