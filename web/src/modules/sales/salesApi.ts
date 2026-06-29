import axios from 'axios';

export type SalesDailyPoint = {
	date: string; // YYYY-MM-DD
	amount: number;
	order_count: number;
	quantity: number;
	product_count: number;
};

export type SalesProductAgg = {
	product_id: number;
	product_name: string | null;
	amount: number;
	order_count: number;
	quantity: number;
};

export type SalesDashboardResponse = {
	ok: boolean;
	from: string;
	to: string;
	source_used: string;
	totals: { amount: number; order_count: number; quantity: number; refund_amount?: number; refund_order_count?: number; refund_quantity?: number };
	daily: SalesDailyPoint[];
	products: SalesProductAgg[];
	categories?: Array<{ category: string; amount: number }>;
};

export type SalesCoverageItem = {
	date: string;
	raw_count: number | null;
	aggregate_count: number;
	job_status?: string | null;
	failure_reason?: string | null;
	direct_order_checked?: boolean;
	direct_order_supported?: boolean | null;
	direct_order_candidate_count?: number;
	coverage_status: 'covered' | 'pending_empty' | 'confirmed_empty' | 'failed' | 'raw_only' | 'missing' | 'missing_aggregate';
};

export type SalesCoverageResponse = {
	ok: boolean;
	from: string;
	to: string;
	source_used: string;
	raw_days_count: number;
	aggregate_days_count: number;
	missing_days: string[];
	failed_days: string[];
	raw_only_days: string[];
	pending_empty_days: string[];
	confirmed_empty_days: string[];
	items: SalesCoverageItem[];
};

export async function fetchSalesDashboard(params: {
	apiBaseUrl: string;
	from: string;
	to: string;
	source?: 'commerce_orders' | 'bizdata_product_detail';
	limitProducts?: number;
	breakdown?: 'large' | 'middle' | 'small' | 'detail';
}): Promise<SalesDashboardResponse> {
	const res = await axios.get(`${params.apiBaseUrl}/sales/dashboard`, {
		params: {
			date_from: params.from,
			date_to: params.to,
			source: params.source ?? 'commerce_orders',
			limit_products: params.limitProducts ?? 10,
			breakdown: params.breakdown ?? 'small',
		},
	});
	return res.data as SalesDashboardResponse;
}

export async function fetchSalesCoverage(params: {
	apiBaseUrl: string;
	from: string;
	to: string;
	source?: 'commerce_orders' | 'bizdata_product_detail';
}): Promise<SalesCoverageResponse> {
	const res = await axios.get(`${params.apiBaseUrl}/sales/coverage`, {
		params: {
			date_from: params.from,
			date_to: params.to,
			source: params.source ?? 'commerce_orders',
		},
	});
	return res.data as SalesCoverageResponse;
}

export async function syncSalesYesterday(params: { apiBaseUrl: string }): Promise<any> {
	const res = await axios.post(`${params.apiBaseUrl}/sales/sync/yesterday`, {});
	return res.data;
}

export async function syncSalesCommerceOrdersRange(params: {
	apiBaseUrl: string;
	from: string;
	to: string;
	lagDays?: number;
}): Promise<any> {
	const res = await axios.post(`${params.apiBaseUrl}/sales/sync`, {
		date_from: params.from,
		date_to: params.to,
		lag_days: params.lagDays ?? 7,
	});
	return res.data;
}

export async function syncSalesBizdataProductDetail(params: {
	apiBaseUrl: string;
	from: string;
	to: string;
	channelNo?: number | null;
}): Promise<any> {
	const res = await axios.post(`${params.apiBaseUrl}/sales/sync/bizdata-product-detail`, {
		date_from: params.from,
		date_to: params.to,
		channel_no: params.channelNo ?? null,
		sort: 'payAmount',
	});
	return res.data;
}

