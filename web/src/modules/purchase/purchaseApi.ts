import axios from 'axios';

export type PurchaseKeywordRow = {
	date: string; // YYYY-MM-DD
	category1: string | null;
	category2: string | null;
	category3: string | null;
	category4: string | null;
	product_name: string | null;
	product_id: number;
	channel_group: string;
	channel_name: string;
	keyword: string;
	payments: number; // 기여도(소수 가능)
	amount: number; // 기여도(소수 가능)
};

export type PurchaseKeywordsDashboard = {
	ok: boolean;
	from: string;
	to: string;
	source_used?: string;
	totals: { amount: number; payments: number };
	products: Array<{
		product_id: number;
		product_name: string | null;
		amount: number;
		payments: number;
		keywords: Array<{ keyword: string; amount: number; payments: number }>;
	}>;
};

export async function uploadPurchaseKeywordsReport(params: {
	apiBaseUrl: string;
	file: File;
	targetDate?: string | null;
}): Promise<{
	ok: boolean;
	dates: string[];
	processed_dates: string[];
	inserted_total: number;
	parsed_totals?: { rows: number; payments: number; amount: number; payments_raw_sum?: number; amount_raw_sum?: number; payments_non_integer_rows?: number };
	stored_totals?: { rows: number; payments: number; amount: number };
	parsed_by_date?: Record<
		string,
		{
			rows: number;
			payments_raw_sum?: number;
			payments_trunc_sum?: number;
			payments_half_up_sum?: number;
			payments_non_integer_rows?: number;
			payments_positive_fraction_rows?: number;
			amount_raw_sum?: number;
			amount_trunc_sum?: number;
			amount_half_up_sum?: number;
			amount_non_integer_rows?: number;
		}
	>;
	stored_by_date?: Record<string, { rows: number; payments: number; amount: number }>;
}> {
	const fd = new FormData();
	fd.append('file', params.file);
	const res = await axios.post(`${params.apiBaseUrl}/purchase/keywords/upload`, fd, {
		headers: { 'Content-Type': 'multipart/form-data' },
		params: params.targetDate ? { target_date: params.targetDate } : undefined,
	});
	return res.data as any;
}

export async function fetchPurchaseKeywordsDaily(params: {
	apiBaseUrl: string;
	from: string;
	to: string;
	source?: 'auto' | 'purchase_upload' | 'purchase_commerce_api';
	filters?: Partial<{
		category1: string;
		category2: string;
		category3: string;
		product_id: number;
		channel_group: string;
		channel_name: string;
		keyword: string;
	}>;
	limit?: number;
	offset?: number;
}): Promise<PurchaseKeywordRow[]> {
	const res = await axios.get(`${params.apiBaseUrl}/purchase/keywords/daily`, {
		params: {
			date_from: params.from,
			date_to: params.to,
			source: params.source ?? 'auto',
			limit: params.limit ?? 5000,
			offset: params.offset ?? 0,
			...(params.filters || {}),
		},
	});
	return (res.data || []) as PurchaseKeywordRow[];
}

export async function fetchPurchaseKeywordsDashboard(params: {
	apiBaseUrl: string;
	from: string;
	to: string;
	source?: 'auto' | 'purchase_upload' | 'purchase_commerce_api';
	filters?: Partial<{
		category1: string;
		category2: string;
		category3: string;
		channel_group: string;
		channel_name: string;
		keyword: string;
	}>;
	limitProducts?: number;
	limitKeywords?: number;
}): Promise<PurchaseKeywordsDashboard> {
	const res = await axios.get(`${params.apiBaseUrl}/purchase/keywords/dashboard`, {
		params: {
			date_from: params.from,
			date_to: params.to,
			source: params.source ?? 'auto',
			limit_products: params.limitProducts ?? 10,
			limit_keywords: params.limitKeywords ?? 10,
			...(params.filters || {}),
		},
	});
	return res.data as PurchaseKeywordsDashboard;
}

export async function hasPurchaseKeywordsForDate(params: {
	apiBaseUrl: string;
	ymd: string;
	source?: 'purchase_upload' | 'purchase_commerce_api' | 'auto';
}): Promise<boolean> {
	const d = String(params.ymd || '').trim();
	if (!d) return false;
	const res = await axios.get(`${params.apiBaseUrl}/purchase/keywords/daily`, {
		params: { date_from: d, date_to: d, source: params.source ?? 'purchase_upload', limit: 1, offset: 0 },
	});
	const rows = (res.data || []) as any[];
	return Array.isArray(rows) && rows.length > 0;
}

export async function syncPurchaseKeywords(params: { apiBaseUrl: string; from: string; to?: string }): Promise<any> {
	const res = await axios.post(`${params.apiBaseUrl}/purchase/keywords/sync`, {
		date_from: params.from,
		date_to: params.to ?? params.from,
	});
	return res.data;
}

export async function syncPurchaseKeywordsYesterday(params: { apiBaseUrl: string }): Promise<any> {
	const res = await axios.post(`${params.apiBaseUrl}/purchase/keywords/sync/yesterday`, {});
	return res.data;
}

