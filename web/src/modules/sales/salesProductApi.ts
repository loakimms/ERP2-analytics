import axios from 'axios';

export type SalesProductSeriesResponse = {
	ok: boolean;
	product_id: number;
	product_name: string | null;
	categories: { large: string | null; middle: string | null; small: string | null; detail: string | null };
	from: string;
	to: string;
	source_used: string;
	totals: {
		amount: number;
		order_count: number;
		quantity: number;
		refund_amount?: number;
		refund_order_count?: number;
		refund_quantity?: number;
	};
	points: Array<{
		date: string;
		amount: number;
		order_count: number;
		quantity: number;
		refund_amount?: number;
		refund_order_count?: number;
		refund_quantity?: number;
	}>;
};

export async function fetchSalesProductSeries(params: {
	apiBaseUrl: string;
	productId: number;
	from: string;
	to: string;
	source?: 'bizdata_product_detail' | 'commerce_orders';
}): Promise<SalesProductSeriesResponse> {
	const res = await axios.get(`${params.apiBaseUrl}/sales/product/series`, {
		params: {
			product_id: params.productId,
			date_from: params.from,
			date_to: params.to,
			source: params.source ?? 'bizdata_product_detail',
		},
	});
	return res.data as SalesProductSeriesResponse;
}

