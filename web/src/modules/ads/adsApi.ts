import axios from 'axios';

export type AdsPlatform = 'sa' | 'gfa';

export type KeywordDailyRow = {
	date: string; // YYYY-MM-DD
	campaign_name: string;
	adgroup_name: string;
	keyword: string;
	device: string;
	creative_id?: string | null;
	ad_id?: string | null;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
	ctr: number;
	cpc: number;
	cvr: number;
	roas: number;
	source: string;
};

export type SearchwordDailyRow = {
	date: string;
	campaign_name: string;
	adgroup_name: string;
	searchword: string;
	matched_keyword?: string | null;
	device: string;
	creative_id?: string | null;
	ad_id?: string | null;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
	ctr: number;
	cpc: number;
	cvr: number;
	roas: number;
	source: string;
};

export type CampaignDailyAggRow = {
	date: string;
	campaign_name: string;
	campaign_status?: string | null;
	ended_on?: string | null;
	campaign_status_basis?: string | null;
	status_collected_at?: string | null;
	is_active?: boolean | null;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
	ctr: number;
	cpc: number;
	cvr: number;
	roas: number;
};

export type CampaignInventoryRow = {
	campaign_id?: string | null;
	campaign_name: string;
	campaign_type?: string | null;
	menu_label?: string | null;
	onoff?: string | null;
	daily_budget?: string | null;
	campaign_status?: string | null;
	ended_on?: string | null;
	campaign_status_basis?: string | null;
	status_collected_at?: string | null;
	is_active?: boolean | null;
};

export type AdgroupInventoryRow = {
	campaign_id?: string | null;
	campaign_name: string;
	adgroup_id?: string | null;
	adgroup_name: string;
	campaign_type?: string | null;
	menu_label?: string | null;
	onoff?: string | null;
	daily_budget?: string | null;
	campaign_status?: string | null;
	adgroup_status?: string | null;
	ended_on?: string | null;
	adgroup_status_basis?: string | null;
	status_collected_at?: string | null;
	is_active?: boolean | null;
};

export type CreativeInventoryRow = {
	campaign_id?: string | null;
	campaign_name: string;
	adgroup_id?: string | null;
	adgroup_name: string;
	creative_id: string;
	creative_name: string;
	creative_status?: string | null;
	ended_on?: string | null;
	creative_status_basis?: string | null;
	status_collected_at?: string | null;
	is_active?: boolean | null;
	image_url?: string | null;
	detail_collected_at?: string | null;
	detail_last_error?: string | null;
	creative_type?: string | null;
	profile_name?: string | null;
	profile_image_url?: string | null;
	primary_text?: string | null;
	headline?: string | null;
	description?: string | null;
	cta?: string | null;
	landing_url?: string | null;
	ad_type?: string | null;
};

export type AdgroupDailyAggRow = {
	date: string;
	campaign_name: string;
	adgroup_name: string;
	campaign_status?: string | null;
	adgroup_status?: string | null;
	ended_on?: string | null;
	adgroup_status_basis?: string | null;
	status_collected_at?: string | null;
	is_active?: boolean | null;
	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
	ctr: number;
	cpc: number;
	cvr: number;
	roas: number;
};

export type CreativeDailyRow = {
	date: string;
	campaign_name: string;
	adgroup_name: string;
	creative_id: string;
	device: string;
	creative_status?: string | null;
	ended_on?: string | null;
	creative_status_basis?: string | null;
	status_collected_at?: string | null;
	is_active?: boolean | null;

	creative_name: string;
	display_keyword?: string | null;
	product_title?: string | null;
	image_url?: string | null;
	detail_collected_at?: string | null;
	detail_last_error?: string | null;
	creative_type?: string | null;
	profile_name?: string | null;
	profile_image_url?: string | null;
	primary_text?: string | null;
	headline?: string | null;
	description?: string | null;
	cta?: string | null;
	landing_url?: string | null;
	ad_type?: string | null;
	current_bid?: number | null;
	quality_index?: number | null;
	avg_rank?: number | null;
	organic_keyword?: string | null;
	organic_rank?: number | null;
	organic_rank_source?: string | null;
	organic_rank_date?: string | null;
	match_status?: string | null;
	match_rule?: string | null;
	matched_product_url?: string | null;
	matched_product_title?: string | null;

	impressions: number;
	clicks: number;
	cost: number;
	conversions: number;
	revenue: number;
	purchase_conversions?: number;
	purchase_revenue?: number;
	ctr: number;
	cpc: number;
	cvr: number;
	roas: number;
	source: string;
};

export type AdsAvailability = {
	ok: boolean;
	kind: 'keyword' | 'searchword' | 'creative';
	from: string;
	to: string;
	hasAny: boolean;
	missingDates: string[];
};

export type GfaStrategyMetricSnapshot = {
	impressions: number;
	clicks: number;
	cost: number;
	total_conversions: number;
	total_revenue: number;
	total_cvr: number;
	total_roas: number;
	cart_conversions: number;
	cart_revenue: number;
	cart_cvr: number;
	cart_roas: number;
	purchase_conversions: number;
	purchase_revenue: number;
	purchase_cvr: number;
	purchase_roas: number;
	ctr: number;
	cpc: number;
};

export type GfaStrategyRankRow = GfaStrategyMetricSnapshot & {
	name?: string;
	dimension?: string;
	audience?: string;
	media?: string;
	placement?: string;
	campaign_id?: string;
	campaign_name?: string;
	adgroup_id?: string;
	adgroup_name?: string;
	creative_id?: string;
	creative_name?: string;
	image_type?: string;
	message_type?: string;
	appeal_point?: string;
	appeal_points?: string[];
	visual_subject?: string;
	visual_subjects?: string[];
	hair_condition?: string;
	hair_condition_tags?: string[];
	scene?: string;
	scene_tags?: string[];
	emotion?: string;
	emotion_tags?: string[];
	composition?: string;
	composition_tags?: string[];
	color_mood?: string;
	color_mood_tags?: string[];
	product_visibility?: string;
	core_keyword?: string;
	core_keywords?: string[];
	pain_point?: string;
	pain_points?: string[];
	copy_appeal_type?: string;
	copy_appeal_types?: string[];
	message_tone?: string;
	cta_type?: string;
	image_element?: string;
	copy_element?: string;
	primary_text?: string;
	headline?: string;
	description?: string;
	cta?: string;
	image_url?: string;
	creative_count?: number;
	sample_sufficient?: boolean;
	sample_status?: string;
	sample_reason?: string;
	data_started_on?: string | null;
	data_ended_on?: string | null;
	data_days?: number;
};

export type GfaStrategyDiagnosis = {
	level: 'campaign' | 'adgroup' | 'creative' | string;
	id: string;
	name: string;
	campaign_id?: string;
	campaign_name?: string;
	adgroup_id?: string;
	adgroup_name?: string;
	creative_id?: string;
	creative_name?: string;
	severity: 'danger' | 'warn' | 'good' | 'info' | string;
	issues: string[];
	reason: string;
	action: string;
	metrics: GfaStrategyMetricSnapshot;
};

export type GfaStrategyGoalRecommendation = {
	goal: 'click' | 'cart' | 'conversion' | 'purchase' | string;
	label: string;
	summary: string;
	primary_metric: string;
	recommended_audience: string;
	recommended_media?: string;
	recommended_placement: string;
	recommended_creative_type: string;
	recommended_appeal_or_message: string;
	test_candidates: GfaStrategyRankRow[];
	operating_candidates: GfaStrategyRankRow[];
};

export type GfaStrategyGoalMatrixRow = {
	goal: 'click' | 'conversion' | 'purchase' | string;
	goal_label: string;
	decision_metric: string;
	recommended_gender?: string;
	recommended_age?: string;
	recommended_audience?: string;
	recommended_media?: string;
	recommended_placement?: string;
	recommended_creative?: string;
	ad_product_type?: string;
	ad_product_purpose?: string;
	purpose_fit?: string;
	purpose_fit_reason?: string;
	recommended_image_elements?: string;
	recommended_copy_elements?: string;
	creative_direction?: string;
	operation_action?: string;
	grade?: string;
	metric_value?: number;
};

export type GfaStrategyBlueprintRow = GfaStrategyGoalMatrixRow & {
	strategic_role?: string;
	exposure_formula?: string;
	creative_formula?: string;
	success_formula?: string;
	avoid_formula?: string;
	decision_rule?: string;
	next_test?: string;
};

export type GfaStrategyConditionGapRow = GfaStrategyRankRow & {
	level?: string;
	level_label?: string;
	best_goal?: string;
	best_goal_label?: string;
	baseline_name?: string;
	baseline_metric_label?: string;
	baseline_metric_value?: number;
	current_metric_value?: number;
	metric_gap?: number;
	gap_summary?: string;
	problem_cause?: string;
	grade?: string;
	recommendation?: string;
	ad_product_type?: string;
	ad_product_purpose?: string;
	purpose_fit?: string;
	purpose_fit_reason?: string;
};

export type GfaStrategyOperationCompareRow = GfaStrategyRankRow & {
	rank?: number;
	axis?: string;
	axis_label?: string;
	goal?: string;
	goal_label?: string;
	metric_label?: string;
	metric_value?: number;
	gender?: string;
	age?: string;
	grade?: string;
	judgment?: string;
	operation_suggestion?: string;
};

export type GfaStrategyCreativeCompareRow = GfaStrategyRankRow & {
	recommended_goal?: string;
	recommended_goal_label?: string;
	grade?: string;
	ctr_rank?: number | null;
	total_cvr_rank?: number | null;
	purchase_cvr_rank?: number | null;
	image_summary?: string;
	copy_summary?: string;
	opencv_summary?: string;
	creative_direction?: string;
	ad_product_type?: string;
	ad_product_purpose?: string;
	purpose_fit?: string;
	purpose_fit_reason?: string;
	image_analysis_status?: string;
	copy_analysis_status?: string;
	image_url?: string;
	copy_feature_layer?: Record<string, unknown>;
	copy_feature_hook?: string;
	copy_buyer_stage?: string;
	copy_psychology_triggers?: string[];
	copy_benefits?: string[];
	copy_evidence_types?: string[];
	copy_usp_categories?: string[];
	copy_cta_action_type?: string;
	copy_message_focus_score?: number;
	copy_complexity_score?: number;
	copy_trust_score?: number;
	copy_weighted_feature_layer?: Record<string, unknown>;
	copy_design_plan?: Record<string, unknown>;
	copy_success_factors?: Record<string, unknown>;
	copy_feature_importance?: Record<string, unknown>;
	copy_creative_dna?: Record<string, unknown>;
	copy_success_dna?: Record<string, { score?: number; stars?: number } | unknown>;
	copy_creative_prompt?: Record<string, unknown>;
	copy_cta_strength_score?: number;
	copy_differentiation?: Record<string, unknown>;
	visual_strategy?: Record<string, unknown>;
	visual_hierarchy_path?: string[];
	visual_weight?: Record<string, number>;
	color_psychology?: Array<Record<string, unknown>>;
	copy_image_alignment?: Record<string, unknown>;
	copy_image_alignment_score?: number;
	novelty_score?: number;
	fatigue_risk?: string;
};

export type GfaStrategyActionRow = {
	name?: string;
	level_label?: string;
	action_type?: string;
	grade?: string;
	reason?: string;
	recommendation?: string;
	cost?: number;
	ctr?: number;
	total_cvr?: number;
	purchase_cvr?: number;
	purchase_roas?: number;
};

export type GfaCreativeGeneratorTemplate = {
	type: string;
	label: string;
	best_for?: string[];
	structure?: string[];
	psychology?: string;
};

export type GfaCreativeGeneratorFont = {
	id: string;
	label: string;
	filename?: string;
	family?: string;
	style?: string;
	source?: 'default' | 'windows' | 'container' | string;
};

export type GfaCreativeGeneratorCandidate = {
	creative_id?: string;
	creative_name?: string;
	recommended_goal?: string;
	recommended_goal_label?: string;
	grade?: string;
	image_url?: string;
	image_summary?: string;
	copy_summary?: string;
	opencv_summary?: string;
	creative_direction?: string;
	copy_feature_layer?: Record<string, unknown>;
	copy_creative_dna?: Record<string, unknown>;
	copy_success_dna?: Record<string, unknown>;
	copy_creative_prompt?: Record<string, unknown>;
	copy_cta_strength_score?: number;
	copy_image_alignment_score?: number;
	novelty_score?: number;
	fatigue_risk?: string;
	ad_product_type?: string;
	ad_product_purpose?: string;
	metrics?: Record<string, number>;
	source_row?: Record<string, unknown>;
};

export type GfaCreativeGeneratorSources = {
	ok: boolean;
	date_from?: string;
	date_to?: string;
	guide?: Record<string, unknown>;
	templates?: GfaCreativeGeneratorTemplate[];
	creative_blueprints?: GfaStrategyBlueprintRow[];
	goal_matrix?: GfaStrategyGoalMatrixRow[];
	candidates?: GfaCreativeGeneratorCandidate[];
};

export type GfaCreativeGeneratorRun = {
	id: string;
	batch_id?: string | null;
	candidate_index?: number;
	candidate_count?: number;
	goal: string;
	goal_label: string;
	template_type: string;
	template_label: string;
	source_creative_id?: string | null;
	history_id?: string | null;
	source_creative_name?: string | null;
	generation_source?: string | null;
	appeal_point_id?: string | null;
	source_snapshot?: GfaCreativeGeneratorCandidate;
	guide_rules?: Record<string, unknown>;
	brief?: Record<string, unknown>;
	combination_strategy?: Record<string, unknown>;
	generation_explanation?: {
		summary?: string;
		why_image?: string[];
		why_copy?: string[];
		guide_checklist?: string[];
		feedback_hint?: string;
		[key: string]: unknown;
	};
	copy_prompt?: string;
	image_prompt?: string;
	copy_result?: {
		headline?: string;
		subcopy?: string;
		proof_line?: string;
		cta?: string;
		cta_enabled?: boolean;
		overlay_layout?: Record<string, any>;
		variants?: Array<{ headline?: string; cta?: string; angle?: string }>;
		landing_message?: string;
		risk_notes?: string[];
		creative_score?: number;
		creative_score_detail?: Record<string, unknown>;
		[key: string]: unknown;
	};
	base_image_url?: string;
	image_url?: string;
	image_mime_type?: string;
	can_lock_image?: boolean;
	openai_model?: string;
	gemini_model?: string;
	status: string;
	error?: string;
	reviewer_status: string;
	reviewer_note?: string;
	usage_status?: string;
	used_campaign_name?: string;
	used_adgroup_name?: string;
	used_creative_name?: string;
	used_at?: string | null;
	feedback_summary?: string;
	events?: Array<{
		event_id: string;
		run_id: string;
		batch_id?: string | null;
		event_type: string;
		actor?: string;
		note?: string;
		payload?: Record<string, unknown>;
		created_at?: string | null;
	}>;
	created_at?: string | null;
	updated_at?: string | null;
};

export type GfaStrategyAnalysis = {
	ok: boolean;
	date_from: string;
	date_to: string;
	metric_definitions?: Record<string, Record<string, string>>;
	executive_summary?: string[];
	goal_matrix?: GfaStrategyGoalMatrixRow[];
	operation_blueprints?: GfaStrategyBlueprintRow[];
	creative_blueprints?: GfaStrategyBlueprintRow[];
	strategy_blueprints?: GfaStrategyBlueprintRow[];
	high_performance_baselines?: Record<string, any[]>;
	condition_hierarchy?: {
		campaigns?: GfaStrategyConditionGapRow[];
		adgroups?: GfaStrategyConditionGapRow[];
		creatives?: GfaStrategyConditionGapRow[];
	};
	condition_gap_rows?: GfaStrategyConditionGapRow[];
	operation_compare_rows?: GfaStrategyOperationCompareRow[];
	creative_compare_rows?: GfaStrategyCreativeCompareRow[];
	action_rows?: GfaStrategyActionRow[];
	campaign_condition?: {
		campaigns?: GfaStrategyDiagnosis[];
		adgroups?: GfaStrategyDiagnosis[];
		creatives?: GfaStrategyDiagnosis[];
	};
	operating_factor_analysis?: {
		audience?: Record<string, { top?: GfaStrategyRankRow[]; weak?: GfaStrategyRankRow[] }>;
		media?: Record<string, { top?: GfaStrategyRankRow[]; weak?: GfaStrategyRankRow[] }>;
		placement?: Record<string, { top?: GfaStrategyRankRow[]; weak?: GfaStrategyRankRow[] }>;
		audience_placement?: Record<string, { top?: GfaStrategyRankRow[]; weak?: GfaStrategyRankRow[] }>;
		audience_media_placement?: Record<string, { top?: GfaStrategyRankRow[]; weak?: GfaStrategyRankRow[] }>;
		note?: string;
	};
	creative_factor_analysis?: {
		top_ctr?: GfaStrategyRankRow[];
		top_total_cvr?: GfaStrategyRankRow[];
		top_purchase_cvr?: GfaStrategyRankRow[];
		patterns?: Record<string, GfaStrategyRankRow[]>;
		feature_performance?: Record<string, Record<string, GfaStrategyRankRow[]>>;
		image_elements?: Record<string, Record<string, GfaStrategyRankRow[]>>;
		copy_elements?: Record<string, Record<string, GfaStrategyRankRow[]>>;
		image_copy_combinations?: Record<string, Record<string, GfaStrategyRankRow[]>>;
		meta_coverage?: Record<string, number>;
	};
	goal_recommendations?: Record<string, GfaStrategyGoalRecommendation>;
	strong_combinations?: GfaStrategyRankRow[];
	weak_combinations?: GfaStrategyRankRow[];
	suggestions?: string[];
};

export type GfaStrategySnapshotPeriod = {
	start?: string | null;
	end?: string | null;
};

export type GfaStrategyLatestSnapshot = {
	ok: boolean;
	snapshot_id: string;
	status: string;
	as_of_date?: string | null;
	period?: GfaStrategySnapshotPeriod;
	published_at?: string | null;
	analysis_version?: string | null;
	snapshot_origin?: string | null;
	source_result_id?: string | null;
	source_fingerprint?: string | null;
	payload_hash?: string | null;
	payload: GfaStrategyAnalysis;
};

export const GFA_STRATEGY_NO_PUBLISHED_SNAPSHOT = 'NO_PUBLISHED_STRATEGY_SNAPSHOT';

export type GfaCreativeImageAnalysis = {
	creative_id: string;
	image_url?: string | null;
	visual_subjects?: string[];
	hair_condition_tags?: string[];
	scene_tags?: string[];
	emotion_tags?: string[];
	composition_tags?: string[];
	color_mood_tags?: string[];
	product_visibility?: string | null;
	cv_metrics?: Record<string, any> | null;
	confidence?: number;
	model_name?: string | null;
	status?: string | null;
	reviewed_at?: string | null;
	analyzed_at?: string | null;
	updated_at?: string | null;
};

export type GfaCreativeCopyAnalysis = {
	creative_id: string;
	primary_text?: string | null;
	headline?: string | null;
	description?: string | null;
	cta?: string | null;
	core_keywords?: string[];
	pain_points?: string[];
	appeal_types?: string[];
	message_tone?: string | null;
	cta_type?: string | null;
	confidence?: number;
	model_name?: string | null;
	status?: string | null;
	reviewed_at?: string | null;
	analyzed_at?: string | null;
	updated_at?: string | null;
};

export type GfaCreativeAnalysis = {
	ok?: boolean;
	creative_id: string;
	image_analysis?: GfaCreativeImageAnalysis | null;
	copy_analysis?: GfaCreativeCopyAnalysis | null;
};

export async function fetchAdsAvailability(params: {
	baseUrl: string;
	kind: 'keyword' | 'searchword' | 'campaign' | 'adgroup' | 'creative';
	dateFrom: string;
	dateTo: string;
	campaignKind?: 'powerlink' | 'shopping' | 'non_powerlink';
	platform?: AdsPlatform;
}): Promise<AdsAvailability> {
	const prefix = params.platform === 'gfa' ? '/gfa' : '';
	const res = await axios.get<AdsAvailability>(`${params.baseUrl}${prefix}/ads/availability`, {
		params: { kind: params.kind, date_from: params.dateFrom, date_to: params.dateTo, campaign_kind: params.campaignKind },
	});
	return res.data as any;
}

export async function fetchKeywordDaily(params: {
	baseUrl: string;
	dateFrom: string;
	dateTo: string;
	limit?: number;
	offset?: number;
	campaign?: string;
	adgroup?: string;
	campaignKind?: 'powerlink' | 'shopping' | 'non_powerlink';
}): Promise<KeywordDailyRow[]> {
	const res = await axios.get<KeywordDailyRow[]>(`${params.baseUrl}/keywords/daily`, {
		params: {
			date_from: params.dateFrom,
			date_to: params.dateTo,
			campaign: params.campaign,
			adgroup: params.adgroup,
			campaign_kind: params.campaignKind,
			limit: params.limit ?? 5000,
			offset: params.offset ?? 0,
		},
	});
	return res.data || [];
}

export async function fetchSearchwordDaily(params: {
	baseUrl: string;
	dateFrom: string;
	dateTo: string;
	limit?: number;
	offset?: number;
	campaign?: string;
	adgroup?: string;
	campaignKind?: 'powerlink' | 'shopping' | 'non_powerlink';
	source?: 'combined' | 'ui_csv_upload' | 'searchad_api' | 'all';
}): Promise<SearchwordDailyRow[]> {
	const res = await axios.get<SearchwordDailyRow[]>(`${params.baseUrl}/searchwords/daily`, {
		params: {
			date_from: params.dateFrom,
			date_to: params.dateTo,
			campaign: params.campaign,
			adgroup: params.adgroup,
			campaign_kind: params.campaignKind,
			source: params.source,
			limit: params.limit ?? 5000,
			offset: params.offset ?? 0,
		},
	});
	return res.data || [];
}

export async function fetchSearchwordDailyAll(params: {
	baseUrl: string;
	dateFrom: string;
	dateTo: string;
	campaign?: string;
	adgroup?: string;
	campaignKind?: 'powerlink' | 'shopping' | 'non_powerlink';
	source?: 'combined' | 'ui_csv_upload' | 'searchad_api' | 'all';
}): Promise<SearchwordDailyRow[]> {
	const res = await axios.get<SearchwordDailyRow[]>(`${params.baseUrl}/searchwords/daily/export`, {
		params: {
			date_from: params.dateFrom,
			date_to: params.dateTo,
			campaign: params.campaign,
			adgroup: params.adgroup,
			campaign_kind: params.campaignKind,
			source: params.source,
		},
	});
	return res.data || [];
}

export async function fetchGfaStrategyAnalysis(params: {
	baseUrl: string;
	dateFrom: string;
	dateTo: string;
	forceRefresh?: boolean;
}): Promise<GfaStrategyAnalysis> {
	const res = await axios.post<GfaStrategyAnalysis>(`${params.baseUrl}/gfa/strategy/analyze`, {
		date_from: params.dateFrom,
		date_to: params.dateTo,
		force_refresh: Boolean(params.forceRefresh),
	});
	return res.data;
}

export async function getLatestGfaStrategySnapshot(params: {
	baseUrl: string;
}): Promise<GfaStrategyLatestSnapshot> {
	const res = await axios.get<GfaStrategyLatestSnapshot>(`${params.baseUrl}/gfa/strategy/snapshot/latest`);
	return res.data;
}

export function isNoPublishedGfaStrategySnapshotError(err: unknown): boolean {
	if (!axios.isAxiosError(err)) return false;
	const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
	return err.response?.status === 404 && String(detail || '') === GFA_STRATEGY_NO_PUBLISHED_SNAPSHOT;
}

export function gfaStrategyPayloadFromSnapshot(snapshot: GfaStrategyLatestSnapshot): GfaStrategyAnalysis {
	const payload = snapshot.payload && typeof snapshot.payload === 'object' ? snapshot.payload : ({} as GfaStrategyAnalysis);
	return {
		...payload,
		ok: payload.ok !== false,
		date_from: String(payload.date_from || snapshot.period?.start || ''),
		date_to: String(payload.date_to || snapshot.period?.end || ''),
	};
}

export async function fetchGfaCreativeGeneratorSources(params: {
	baseUrl: string;
	dateFrom?: string;
	dateTo?: string;
}): Promise<GfaCreativeGeneratorSources> {
	const res = await axios.get<GfaCreativeGeneratorSources>(`${params.baseUrl}/gfa/creative-generator/sources`, {
		params: {
			date_from: params.dateFrom,
			date_to: params.dateTo,
		},
	});
	return res.data;
}

export async function fetchGfaCreativeGeneratorRuns(params: {
	baseUrl: string;
	limit?: number;
}): Promise<GfaCreativeGeneratorRun[]> {
	const res = await axios.get<{ ok: boolean; runs: GfaCreativeGeneratorRun[] }>(`${params.baseUrl}/gfa/creative-generator/runs`, {
		params: { limit: params.limit ?? 50 },
	});
	return res.data?.runs || [];
}

export async function fetchGfaCreativeGeneratorFonts(params: {
	baseUrl: string;
}): Promise<GfaCreativeGeneratorFont[]> {
	const res = await axios.get<{ ok: boolean; fonts: GfaCreativeGeneratorFont[] }>(`${params.baseUrl}/gfa/creative-generator/fonts`);
	return res.data?.fonts || [];
}

export type GfaBannerAnalysisFactor = {
	key: string;
	label: string;
	target?: number;
	score: number;
	good?: string;
	weak?: string;
	improvement?: string;
};

export type GfaHistoricalEvidenceStrength = {
	level: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' | string;
	display_label?: string;
	basis?: Record<string, any>;
};

export type GfaHistoricalEvidenceFeature = {
	feature: string;
	value: string;
	display_label?: string;
	tier?: string;
	creative_count?: number;
	performance?: Record<string, any>;
	baseline?: Record<string, any>;
	comparison_to_baseline?: Record<string, any>;
	concentration?: Record<string, any>;
	evidence_strength?: GfaHistoricalEvidenceStrength;
	source_lineage?: Record<string, any>;
	interpretation_guardrail?: string;
};

export type GfaHistoricalEvidenceResult = {
	ok?: boolean;
	status?: 'available' | 'unavailable' | string;
	title?: string;
	reason?: string;
	message?: string;
	guardrails?: Record<string, any>;
	similar_creative_evidence?: {
		title?: string;
		selection_rule?: string;
		candidate_count?: number;
		strict_comparable_candidate_count?: number;
		rejected_by_similarity_gate_count?: number;
		comparable_creative_count?: number;
		performance?: Record<string, any>;
		concentration?: Record<string, any>;
		evidence_strength?: GfaHistoricalEvidenceStrength;
		top_similar_creatives?: Array<{
			creative_id?: string;
			overall_similarity?: number;
			matched_features?: Array<Record<string, any>>;
			unmatched_features?: Array<Record<string, any>>;
			unavailable_features?: Array<Record<string, any>>;
			limited_matches_not_scored?: Array<Record<string, any>>;
			performance?: Record<string, any>;
		}>;
		interpretation_guardrail?: string;
	};
	feature_performance_evidence?: {
		title?: string;
		baseline?: Record<string, any>;
		features?: GfaHistoricalEvidenceFeature[];
	};
	feature_similar_creative_evidence?: {
		title?: string;
		selection_rule?: string;
		features?: Array<{
			feature?: string;
			value?: string;
			display_label?: string;
			tier?: string;
			creative_count?: number;
			performance?: Record<string, any>;
			concentration?: Record<string, any>;
			evidence_strength?: GfaHistoricalEvidenceStrength;
			top_creatives?: Array<Record<string, any>>;
		}>;
	};
	similarity_distribution?: Record<string, number>;
	unknown_metric_semantics?: Record<string, any>;
	forbidden_outputs?: Record<string, any>;
};

export type GfaBannerAnalysisResult = {
	ok: boolean;
	filename?: string;
	model?: string;
	criteria?: Record<string, any>;
	content_context_v1?: Record<string, any>;
	overall_score: number;
	grade?: string;
	verdict?: string;
	factor_scores: GfaBannerAnalysisFactor[];
	element_analysis?: Array<{
		key?: string;
		title?: string;
		observation?: string;
		strategic_meaning?: string;
		strength?: string;
		weakness?: string;
		improvement?: string;
	}>;
	expert_analysis_v2?: {
		taxonomy_version?: string;
		dimensions?: Array<{
			key?: string;
			title?: string;
			score?: number;
			summary?: string;
			criteria?: Array<{
				key?: string;
				label?: string;
				score?: number;
				observation?: string;
				interpretation?: string;
				risk?: string;
				improvement?: string;
			}>;
			score_anchors?: Record<string, string>;
		}>;
		priority_actions?: string[];
		policy_conflict_guard?: Record<string, any>;
	};
	programmatic_analysis_v1?: {
		version?: string;
		source?: string;
		dimension_scores?: Record<string, number>;
		checks?: Array<{
			key?: string;
			label?: string;
			score?: number;
			status?: string;
			evidence?: string;
			issue?: string;
			action?: string;
		}>;
		priority_actions?: string[];
		opencv_metrics?: Record<string, any>;
		limits?: string;
	};
	vision_tags?: Record<string, any>;
	strengths?: string[];
	weaknesses?: string[];
	recommendations?: string[];
	expert_advice?: {
		good_points?: string[];
		fix_first?: string[];
		experiments?: string[];
		policy_risk_promoted_to_fix?: boolean;
	};
	historical_evidence?: GfaHistoricalEvidenceResult;
	history?: GfaBannerAnalysisHistoryItem;
	generation_result_v1?: GfaBannerAnalysisGenerationResult;
};

export type GfaBannerAnalysisHistoryItem = {
	history_id: string;
	filename?: string;
	content_type?: string;
	image_size_bytes?: number;
	note?: string;
	model?: string;
	overall_score?: number;
	grade?: string;
	verdict?: string;
	created_at?: string | null;
	generated_count?: number;
	latest_generated_run_id?: string | null;
	latest_generated_image_url?: string | null;
	generation_updated_at?: string | null;
};

export type GfaBannerAnalysisHistoryDetail = GfaBannerAnalysisHistoryItem & {
	result?: GfaBannerAnalysisResult;
	image_data_url?: string;
	generation_result_v1?: GfaBannerAnalysisGenerationResult;
};

export type GfaBannerAnalysisGenerationResult = {
	ok: boolean;
	runs: GfaCreativeGeneratorRun[];
	generation_brief?: Record<string, any>;
	priority_changes?: Array<Record<string, any>>;
	generation_prompt_contract?: Record<string, any>;
};

export type GfaBannerContentContextItem = {
	sku_id: string;
	title?: string;
	product_url?: string;
	phase1_enabled?: boolean;
	product_image_count?: number;
	detail_page_count?: number;
	analyzed_detail_page_count?: number;
	reference_media_count?: number;
	primary_product_image_url?: string;
	primary_product_asset_id?: string;
	ready?: boolean;
};

export async function analyzeGfaBannerImage(params: {
	baseUrl: string;
	file: File;
	note?: string;
	skuId?: string;
}): Promise<GfaBannerAnalysisResult> {
	const body = new FormData();
	body.append('file', params.file);
	if (params.note) body.append('note', params.note);
	if (params.skuId) body.append('sku_id', params.skuId);
	const res = await axios.post<GfaBannerAnalysisResult>(`${params.baseUrl}/gfa/banner-analysis/analyze`, body);
	return res.data;
}

export async function fetchGfaBannerAnalysisHistory(params: {
	baseUrl: string;
	limit?: number;
}): Promise<GfaBannerAnalysisHistoryItem[]> {
	const res = await axios.get<{ ok: boolean; items: GfaBannerAnalysisHistoryItem[] }>(`${params.baseUrl}/gfa/banner-analysis/history`, {
		params: { limit: params.limit ?? 50 },
	});
	return res.data?.items || [];
}

export async function fetchGfaBannerAnalysisHistoryDetail(params: {
	baseUrl: string;
	historyId: string;
}): Promise<GfaBannerAnalysisHistoryDetail> {
	const res = await axios.get<{ ok: boolean; item: GfaBannerAnalysisHistoryDetail }>(`${params.baseUrl}/gfa/banner-analysis/history/${encodeURIComponent(params.historyId)}`);
	return res.data.item;
}

export async function fetchGfaBannerContentContexts(params: {
	baseUrl: string;
}): Promise<GfaBannerContentContextItem[]> {
	const res = await axios.get<{ ok: boolean; items: GfaBannerContentContextItem[] }>(`${params.baseUrl}/gfa/banner-analysis/content-contexts`);
	return res.data?.items || [];
}

export async function generateGfaBannerFromAnalysis(params: {
	baseUrl: string;
	result: GfaBannerAnalysisResult;
	imageDataUrl?: string;
	historyId?: string;
	note?: string;
	skuId?: string;
	goal?: string;
	adMedia?: string;
	adPlacement?: string;
	generationFocus?: 'source_image_focus' | 'similar_creative_focus';
	candidateCount?: number;
}): Promise<GfaBannerAnalysisGenerationResult> {
	const res = await axios.post<GfaBannerAnalysisGenerationResult>(`${params.baseUrl}/gfa/banner-analysis/generate-from-analysis`, {
		result: params.result,
		image_data_url: params.imageDataUrl,
		history_id: params.historyId,
		note: params.note,
		sku_id: params.skuId,
		goal: params.goal || 'click',
		ad_media: params.adMedia || 'naver_gfa',
		ad_placement: params.adPlacement || 'feed',
		generation_focus: params.generationFocus || 'source_image_focus',
		candidate_count: params.candidateCount ?? 1,
	});
	return res.data;
}

export async function createGfaCreativeGeneratorRun(params: {
	baseUrl: string;
	goal: string;
	templateType: string;
	sourceCreativeId?: string;
	dateFrom?: string;
	dateTo?: string;
	candidateCount?: number;
	additionalReferenceText?: string;
	referenceFiles?: File[];
	generationSource?: 'existing' | 'appeal' | 'hybrid';
	appealPointId?: string;
}): Promise<GfaCreativeGeneratorRun[]> {
	const hasReferences = Boolean(String(params.additionalReferenceText || '').trim()) || Boolean(params.referenceFiles?.length);
	const payload = {
		goal: params.goal,
		template_type: params.templateType,
		source_creative_id: params.sourceCreativeId,
		date_from: params.dateFrom,
		date_to: params.dateTo,
		candidate_count: params.candidateCount ?? 3,
		additional_reference_text: params.additionalReferenceText,
		generation_source: params.generationSource,
		appeal_point_id: params.appealPointId,
	};
	const body = hasReferences ? new FormData() : payload;
	if (hasReferences && body instanceof FormData) {
		Object.entries(payload).forEach(([key, value]) => {
			if (value !== undefined && value !== null && String(value).trim() !== '') body.append(key, String(value));
		});
		(params.referenceFiles || []).forEach((file) => body.append('reference_files', file));
	}
	const res = await axios.post<{ ok: boolean; run?: GfaCreativeGeneratorRun; runs?: GfaCreativeGeneratorRun[] }>(`${params.baseUrl}/gfa/creative-generator/runs`, body);
	return res.data.runs || (res.data.run ? [res.data.run] : []);
}

export async function replaceGfaCreativeGeneratorRunImage(params: {
	baseUrl: string;
	runId: string;
	file: File;
	note?: string;
}): Promise<GfaCreativeGeneratorRun> {
	const body = new FormData();
	body.append('file', params.file);
	if (params.note) body.append('note', params.note);
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image`,
		body,
	);
	return res.data.run;
}

export async function stageGfaCreativeImageReplacement(params: {
	baseUrl: string;
	runId: string;
	file: File;
	note?: string;
}): Promise<{ run: GfaCreativeGeneratorRun; current_unchanged?: boolean }> {
	const body = new FormData();
	body.append('file', params.file);
	if (params.note) body.append('note', params.note);
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun; current_unchanged?: boolean }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image/replacement`,
		body,
	);
	return { run: res.data.run, current_unchanged: res.data.current_unchanged };
}

export async function applyGfaCreativeImageReplacement(params: {
	baseUrl: string;
	runId: string;
}): Promise<{ run: GfaCreativeGeneratorRun; current_unchanged?: boolean }> {
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun; current_unchanged?: boolean }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image/replacement/apply`,
	);
	return { run: res.data.run, current_unchanged: res.data.current_unchanged };
}

export async function cancelGfaCreativeImageReplacement(params: {
	baseUrl: string;
	runId: string;
}): Promise<{ run: GfaCreativeGeneratorRun; current_unchanged?: boolean }> {
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun; current_unchanged?: boolean }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image/replacement/cancel`,
	);
	return { run: res.data.run, current_unchanged: res.data.current_unchanged };
}

export function gfaCreativeImageReplacementPreviewUrl(baseUrl: string, runId: string, cacheKey?: string): string {
	const url = `${baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(runId)}/image/replacement/preview`;
	return cacheKey ? `${url}?v=${encodeURIComponent(cacheKey)}` : url;
}

export function gfaCreativeImageDownloadUrl(baseUrl: string, runId: string): string {
	return `${baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(runId)}/image/download`;
}

export async function updateGfaCreativeGeneratorRunCopy(params: {
	baseUrl: string;
	runId: string;
	headline?: string;
	subcopy?: string;
	proofLine?: string;
	cta?: string;
	ctaEnabled?: boolean;
	overlayLayout?: Record<string, any>;
	landingMessage?: string;
	note?: string;
}): Promise<GfaCreativeGeneratorRun> {
	const res = await axios.patch<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/copy`,
		{
			headline: params.headline,
			subcopy: params.subcopy,
			proof_line: params.proofLine,
			cta: params.cta,
			cta_enabled: params.ctaEnabled,
			overlay_layout: params.overlayLayout,
			landing_message: params.landingMessage,
			note: params.note,
		},
	);
	return res.data.run;
}

export async function regenerateGfaCreativeGeneratorRunCopy(params: {
	baseUrl: string;
	runId: string;
	model?: string;
	note?: string;
}): Promise<GfaCreativeGeneratorRun> {
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/copy/regenerate`,
		{
			model: params.model,
			note: params.note,
		},
	);
	return res.data.run;
}

export async function regenerateGfaCreativeGeneratorRunImage(params: {
	baseUrl: string;
	runId: string;
	model?: string;
	imageLocked?: boolean;
	note?: string;
}): Promise<GfaCreativeGeneratorRun> {
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image/regenerate`,
		{
			model: params.model,
			image_locked: params.imageLocked,
			note: params.note,
		},
	);
	return res.data.run;
}

export async function editGfaCreativeGeneratorRunImageOnly(params: {
	baseUrl: string;
	runId: string;
	prompt: string;
	model?: string;
	note?: string;
}): Promise<GfaCreativeGeneratorRun> {
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image/edit`,
		{
			prompt: params.prompt,
			model: params.model,
			note: params.note,
		},
	);
	return res.data.run;
}

export async function editGfaCreativeGeneratorRunImageMasked(params: {
	baseUrl: string;
	runId: string;
	prompt: string;
	mask: Blob;
	referenceImages?: File[];
	model?: string;
	note?: string;
	editMode?: 'default' | 'hair_native_transform';
}): Promise<{ run: GfaCreativeGeneratorRun; preview?: { image_url: string; base_image_url?: string; image_mime_type?: string; model?: string; prompt?: string; edit_mode?: string; reference_image_count?: number; created_at?: string } }> {
	const body = new FormData();
	body.append('prompt', params.prompt);
	body.append('mask', params.mask, 'edit-mask.png');
	(params.referenceImages || []).slice(0, 4).forEach((file) => body.append('reference_images', file));
	if (params.model) body.append('model', params.model);
	if (params.note) body.append('note', params.note);
	if (params.editMode && params.editMode !== 'default') body.append('edit_mode', params.editMode);
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image/edit-mask`,
		body,
	);
	return { run: res.data.run, preview: (res.data as any).preview };
}

export async function applyGfaCreativeGeneratorRunImagePreview(params: {
	baseUrl: string;
	runId: string;
	imageUrl: string;
	baseImageUrl?: string;
	prompt?: string;
	editMode?: string;
	note?: string;
}): Promise<GfaCreativeGeneratorRun> {
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/image/apply-preview`,
		{
			image_url: params.imageUrl,
			base_image_url: params.baseImageUrl,
			prompt: params.prompt,
			edit_mode: params.editMode,
			note: params.note,
		},
	);
	return res.data.run;
}

export async function reviewGfaCreativeGeneratorRun(params: {
	baseUrl: string;
	runId: string;
	reviewerStatus: string;
	reviewerNote?: string;
}): Promise<GfaCreativeGeneratorRun> {
	const res = await axios.patch<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/review`,
		{
			reviewer_status: params.reviewerStatus,
			reviewer_note: params.reviewerNote,
		},
	);
	return res.data.run;
}

export async function addGfaCreativeGeneratorEvent(params: {
	baseUrl: string;
	runId: string;
	eventType: 'selected' | 'ad_used' | 'feedback' | 'note';
	note?: string;
	usageStatus?: string;
	usedCampaignName?: string;
	usedAdgroupName?: string;
	usedCreativeName?: string;
	feedbackSummary?: string;
	payload?: Record<string, unknown>;
}): Promise<GfaCreativeGeneratorRun> {
	const res = await axios.post<{ ok: boolean; run: GfaCreativeGeneratorRun }>(
		`${params.baseUrl}/gfa/creative-generator/runs/${encodeURIComponent(params.runId)}/events`,
		{
			event_type: params.eventType,
			note: params.note,
			usage_status: params.usageStatus,
			used_campaign_name: params.usedCampaignName,
			used_adgroup_name: params.usedAdgroupName,
			used_creative_name: params.usedCreativeName,
			feedback_summary: params.feedbackSummary,
			payload: params.payload || {},
		},
	);
	return res.data.run;
}

export async function fetchGfaCreativeAnalysis(params: {
	baseUrl: string;
	creativeId: string;
}): Promise<GfaCreativeAnalysis> {
	const res = await axios.get<GfaCreativeAnalysis>(`${params.baseUrl}/gfa/creatives/${encodeURIComponent(params.creativeId)}/analysis`);
	return res.data;
}

export async function runGfaCreativeAnalysis(params: {
	baseUrl: string;
	creativeId: string;
	force?: boolean;
	allowFallback?: boolean;
}): Promise<GfaCreativeAnalysis> {
	const res = await axios.post<GfaCreativeAnalysis>(`${params.baseUrl}/gfa/creatives/${encodeURIComponent(params.creativeId)}/analysis/run`, {
		force: Boolean(params.force),
		allow_fallback: Boolean(params.allowFallback),
	});
	return res.data;
}

export async function runGfaCreativeAnalysisBatch(params: {
	baseUrl: string;
	creativeIds?: string[];
	limit?: number;
	force?: boolean;
	allowFallback?: boolean;
}): Promise<{ ok: boolean; count: number; results: Array<GfaCreativeAnalysis & { creative_id?: string; error?: string }> }> {
	const res = await axios.post(`${params.baseUrl}/gfa/creatives/analysis/run`, {
		creative_ids: params.creativeIds,
		limit: params.limit,
		force: Boolean(params.force),
		allow_fallback: Boolean(params.allowFallback),
	});
	return res.data;
}

export async function updateGfaCreativeImageAnalysis(params: {
	baseUrl: string;
	creativeId: string;
	payload: Partial<GfaCreativeImageAnalysis>;
}): Promise<GfaCreativeAnalysis> {
	const res = await axios.put<GfaCreativeAnalysis>(`${params.baseUrl}/gfa/creatives/${encodeURIComponent(params.creativeId)}/analysis/image`, params.payload);
	return res.data;
}

export async function updateGfaCreativeCopyAnalysis(params: {
	baseUrl: string;
	creativeId: string;
	payload: Partial<GfaCreativeCopyAnalysis>;
}): Promise<GfaCreativeAnalysis> {
	const res = await axios.put<GfaCreativeAnalysis>(`${params.baseUrl}/gfa/creatives/${encodeURIComponent(params.creativeId)}/analysis/copy`, params.payload);
	return res.data;
}

export async function fetchCampaignDaily(params: {
	baseUrl: string;
	dateFrom: string;
	dateTo: string;
	limit?: number;
	offset?: number;
	campaign?: string;
	source?: 'keyword' | 'creative';
	platform?: AdsPlatform;
}): Promise<CampaignDailyAggRow[]> {
	const prefix = params.platform === 'gfa' ? '/gfa' : '';
	const res = await axios.get<CampaignDailyAggRow[]>(`${params.baseUrl}${prefix}/campaigns/daily`, {
		params: {
			date_from: params.dateFrom,
			date_to: params.dateTo,
			campaign: params.campaign,
			source: params.platform === 'gfa' ? undefined : params.source,
			limit: params.limit ?? 2000,
			offset: params.offset ?? 0,
			include_status_snapshot: params.platform === 'gfa' ? false : undefined,
		},
	});
	return res.data || [];
}

export async function fetchGfaCampaignInventory(params: {
	baseUrl: string;
	limit?: number;
	offset?: number;
	campaign?: string;
}): Promise<CampaignInventoryRow[]> {
	const res = await axios.get<CampaignInventoryRow[]>(`${params.baseUrl}/gfa/campaigns/inventory`, {
		params: {
			campaign: params.campaign,
			limit: params.limit ?? 5000,
			offset: params.offset ?? 0,
			include_status_snapshot: false,
		},
	});
	return res.data || [];
}

export async function fetchGfaAdgroupInventory(params: {
	baseUrl: string;
	limit?: number;
	offset?: number;
	campaign?: string;
	adgroup?: string;
}): Promise<AdgroupInventoryRow[]> {
	const res = await axios.get<AdgroupInventoryRow[]>(`${params.baseUrl}/gfa/adgroups/inventory`, {
		params: {
			campaign: params.campaign,
			adgroup: params.adgroup,
			limit: params.limit ?? 10000,
			offset: params.offset ?? 0,
			include_status_snapshot: false,
		},
	});
	return res.data || [];
}

export async function fetchGfaCreativeInventory(params: {
	baseUrl: string;
	limit?: number;
	offset?: number;
	campaign?: string;
	adgroup?: string;
}): Promise<CreativeInventoryRow[]> {
	const res = await axios.get<CreativeInventoryRow[]>(`${params.baseUrl}/gfa/creatives/inventory`, {
		params: {
			campaign: params.campaign,
			adgroup: params.adgroup,
			limit: params.limit ?? 20000,
			offset: params.offset ?? 0,
			include_status_snapshot: false,
		},
	});
	return res.data || [];
}

export async function fetchAdgroupDaily(params: {
	baseUrl: string;
	dateFrom: string;
	dateTo: string;
	limit?: number;
	offset?: number;
	campaign?: string;
	adgroup?: string;
	source?: 'keyword' | 'creative';
	platform?: AdsPlatform;
}): Promise<AdgroupDailyAggRow[]> {
	const prefix = params.platform === 'gfa' ? '/gfa' : '';
	const res = await axios.get<AdgroupDailyAggRow[]>(`${params.baseUrl}${prefix}/adgroups/daily`, {
		params: {
			date_from: params.dateFrom,
			date_to: params.dateTo,
			campaign: params.campaign,
			adgroup: params.adgroup,
			source: params.platform === 'gfa' ? undefined : params.source,
			limit: params.limit ?? 2000,
			offset: params.offset ?? 0,
			include_status_snapshot: params.platform === 'gfa' ? false : undefined,
		},
	});
	return res.data || [];
}

export async function fetchCreativeDaily(params: {
	baseUrl: string;
	dateFrom: string;
	dateTo: string;
	limit?: number;
	offset?: number;
	campaign?: string;
	adgroup?: string;
	platform?: AdsPlatform;
	// NOTE: true면 SearchAd 메타(/ncc/ads)까지 합쳐 "메타만 존재하는 소재"를 포함하려 시도한다.
	// 메뉴 진입 시 매번 true로 두면 느려질 수 있어, 기본은 false 권장.
	includeMetaOnly?: boolean;
}): Promise<CreativeDailyRow[]> {
	const prefix = params.platform === 'gfa' ? '/gfa' : '';
	const res = await axios.get<CreativeDailyRow[]>(`${params.baseUrl}${prefix}/creatives/daily`, {
		params: {
			date_from: params.dateFrom,
			date_to: params.dateTo,
			campaign: params.campaign,
			adgroup: params.adgroup,
			include_meta_only: Boolean(params.includeMetaOnly),
			limit: params.limit ?? 5000,
			offset: params.offset ?? 0,
			include_status_snapshot: params.platform === 'gfa' ? false : undefined,
		},
	});
	return res.data || [];
}


