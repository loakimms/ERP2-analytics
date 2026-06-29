export type QueryPrimitive = string | number | boolean | null | undefined;
export type QueryValue = QueryPrimitive | Array<QueryPrimitive>;

export function serializeQueryParams(params: Record<string, QueryValue>): string {
	const searchParams = new URLSearchParams();
	Object.entries(params).forEach(([key, value]) => {
		if (Array.isArray(value)) {
			value.forEach((item) => {
				const text = String(item ?? '').trim();
				if (text) searchParams.append(key, text);
			});
			return;
		}
		const text = String(value ?? '').trim();
		if (!text) return;
		searchParams.append(key, text);
	});
	return searchParams.toString();
}

export function buildPathWithQuery(path: string, params: Record<string, QueryValue>): string {
	const query = serializeQueryParams(params);
	return query ? `${path}?${query}` : path;
}

export function readQueryParam(search: string | null | undefined, key: string): string {
	return String(new URLSearchParams(String(search || '')).get(key) || '').trim();
}
