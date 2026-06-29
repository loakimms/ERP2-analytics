import type { AiOpsActionItem } from './AiOpsActionTypes';

export type AiOpsLogItem = {
	date?: string | null;
	sku_id?: string;
	product_name?: string | null;
	policy_type?: string | null;
	policy_pack_id?: string | null;
	top_issue?: string | null;
	confidence_score?: number | null;
	latest_action_status?: string | null;
	latest_action_note?: string | null;
	latest_action_reviewer?: string | null;
	latest_action_type?: string | null;
	latest_action_payload?: Record<string, any>;
	latest_action_verification?: AiOpsActionItem['verification'];
	rules_triggered?: string[];
	recommended_actions?: string[];
	analysis_text?: string | null;
	evidence?: Record<string, any>;
};

export type AiOpsLogsResponse = {
	ok?: boolean;
	summary?: {
		snapshot_date?: string | null;
		total_items?: number;
		policy_pack_ids?: string[];
		selected_policy_pack_id?: string | null;
	};
	items?: AiOpsLogItem[];
};
