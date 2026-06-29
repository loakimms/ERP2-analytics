export type ProductIndexScores = {
	click: number;
	sales: number;
	review: number;
	recency: number;
	penalty: number;
	final: number;
};

export type ProductIndexInputs = Record<string, unknown> & {
	sources?: Record<string, unknown>;
};

export type ProductIndexHistoryDetailedItem = {
	date: string;
	scores: ProductIndexScores;
	inputs: ProductIndexInputs;
};

export type ProductIndexDriver = {
	key: keyof ProductIndexScores;
	label: string;
	deltaScore: number | null;
	weight: number;
	deltaWeighted: number | null;
};

export type ProductIndexTrendRow = {
	date: string;
	scores: ProductIndexScores;
	inputs: ProductIndexInputs;
	deltas: Partial<Record<keyof ProductIndexScores, number | null>>;
	inputDeltas: Partial<Record<string, number | null>>;
	drivers: ProductIndexDriver[];
};

export const PRODUCT_INDEX_WEIGHTS: Record<keyof ProductIndexScores, number> = {
	click: 0.2,
	sales: 0.35,
	review: 0.25,
	recency: 0.1,
	penalty: 0,
	final: 1,
};

const LABELS: Record<keyof ProductIndexScores, string> = {
	click: '클릭',
	sales: '판매',
	review: '리뷰',
	recency: '최신성',
	penalty: '패널티',
	final: '인기종합',
};

function num(v: unknown): number | null {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

export function computeProductIndexTrend(items: ProductIndexHistoryDetailedItem[]): ProductIndexTrendRow[] {
	const sorted = [...(items || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
	const out: ProductIndexTrendRow[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const cur = sorted[i];
		if (!cur) continue;
		const prev = i > 0 ? sorted[i - 1] : null;

		const deltas: Partial<Record<keyof ProductIndexScores, number | null>> = {};
		(
			['click', 'sales', 'review', 'recency', 'penalty', 'final'] as const satisfies readonly (keyof ProductIndexScores)[]
		).forEach((k) => {
			const c = num(cur?.scores?.[k]);
			const p = num(prev?.scores?.[k]);
			deltas[k] = c == null || p == null ? null : c - p;
		});

		const drivers: ProductIndexDriver[] = (['click', 'sales', 'review', 'recency'] as const).map((k) => {
			const ds = deltas[k] ?? null;
			const w = PRODUCT_INDEX_WEIGHTS[k] || 0;
			return {
				key: k,
				label: LABELS[k],
				deltaScore: ds,
				weight: w,
				deltaWeighted: ds == null ? null : ds * w,
			};
		});
		drivers.sort((a, b) => Math.abs(b.deltaWeighted ?? 0) - Math.abs(a.deltaWeighted ?? 0));

		const inputDeltas: Partial<Record<string, number | null>> = {};
		(['weekly_views_7d', 'wishes', 'sales_7d', 'sales_30d', 'days_since_reg'] as const).forEach((k) => {
			const c = num((cur?.inputs as any)?.[k]);
			const p = num((prev?.inputs as any)?.[k]);
			inputDeltas[k] = c == null || p == null ? null : c - p;
		});

		out.push({
			date: String(cur.date),
			scores: cur.scores,
			inputs: cur.inputs || {},
			deltas,
			inputDeltas,
			drivers,
		});
	}

	return out;
}

