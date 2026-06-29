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


