export type ManuTagProduct = {
	productName: string;
	tags: string[];
};

export type ManuTagParseResult = {
	products: ManuTagProduct[];
	errors: string[];
};

function normTag(x: string): string {
	return String(x || '')
		.trim()
		.replace(/^#+/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function normalizeProductName(x: string): string {
	// 매칭 강화를 위해 공백/기호/대소문자 차이를 최대한 제거한다.
	return String(x || '')
		.trim()
		.toLowerCase()
		.replace(/<[^>]+>/g, '') // 혹시 HTML 태그가 섞이면 제거
		.replace(/[^\p{L}\p{N}]+/gu, '') // 한글/영문/숫자 외 제거
		.trim();
}

function splitManuTagString(s: string): string[] {
	const raw = String(s || '').trim();
	if (!raw) return [];
	const parts = raw.split(',').map((x) => normTag(x)).filter(Boolean);
	return Array.from(new Set(parts));
}

function collectProductsFromAny(obj: any, out: ManuTagProduct[]): void {
	if (!obj) return;
	if (Array.isArray(obj)) {
		for (const x of obj) collectProductsFromAny(x, out);
		return;
	}
	if (typeof obj !== 'object') return;

	// 이 파일 형태는 searchAdResult.products[*].productName + manuTag 로 내려오는 케이스가 많다.
	const pn = typeof obj.productName === 'string' ? obj.productName : null;
	const mt = typeof obj.manuTag === 'string' ? obj.manuTag : null;
	if (pn && mt != null) {
		out.push({ productName: pn, tags: splitManuTagString(mt) });
	}

	for (const v of Object.values(obj)) collectProductsFromAny(v as any, out);
}

export function parseManuTagText(text: string): ManuTagParseResult {
	const s = String(text || '').trim();
	if (!s) return { products: [], errors: ['empty_file'] };

	// 1) JSON으로 파싱 시도
	try {
		const j = JSON.parse(s);
		const products: ManuTagProduct[] = [];
		collectProductsFromAny(j, products);

		// productName 중복 병합(태그 합집합)
		const merged = new Map<string, { productName: string; tags: Set<string> }>();
		for (const p of products) {
			const name = String(p.productName || '').trim();
			if (!name) continue;
			const key = normalizeProductName(name);
			if (!key) continue;
			const cur = merged.get(key) ?? { productName: name, tags: new Set<string>() };
			for (const t of p.tags || []) {
				const tt = normTag(t);
				if (tt) cur.tags.add(tt);
			}
			merged.set(key, cur);
		}

		const out = [...merged.values()].map((x) => ({
			productName: x.productName,
			tags: Array.from(x.tags),
		}));
		return { products: out, errors: [] };
	} catch (e: any) {
		return { products: [], errors: [`json_parse_failed:${String(e?.message ?? e)}`] };
	}
}

export type MatchedTopProduct = {
	rank: number;
	title: string;
	link?: string | null;
	matched: boolean;
	matchedProductName?: string | null;
	tags: string[];
	matchScore: number; // 0~1
};

function tokenSet(x: string): Set<string> {
	const s = String(x || '')
		.toLowerCase()
		.replace(/<[^>]+>/g, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!s) return new Set();
	return new Set(s.split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter += 1;
	const union = a.size + b.size - inter;
	return union > 0 ? inter / union : 0;
}

export function matchTopProductsToManuTags(params: {
	topProducts: Array<{ rank: number; title: string; link?: string | null }>;
	manuProducts: ManuTagProduct[];
	minScore?: number; // 기본 0.6
}): MatchedTopProduct[] {
	const minScore = params.minScore ?? 0.6;
	const manuByKey = new Map<string, ManuTagProduct>();
	const manuTokenByKey = new Map<string, Set<string>>();
	for (const p of params.manuProducts || []) {
		const key = normalizeProductName(p.productName);
		if (!key) continue;
		manuByKey.set(key, p);
		manuTokenByKey.set(key, tokenSet(p.productName));
	}

	const keys = [...manuByKey.keys()];

	return (params.topProducts || []).map((tp) => {
		const title = String(tp.title || '').trim();
		const rank = Number(tp.rank) || 0;
		const tpKey = normalizeProductName(title);
		if (tpKey && manuByKey.has(tpKey)) {
			const hit = manuByKey.get(tpKey)!;
			return {
				rank,
				title,
				link: tp.link ?? null,
				matched: true,
				matchedProductName: hit.productName,
				tags: hit.tags || [],
				matchScore: 1,
			};
		}

		// contains 기반(기호 제거 전/후)
		const tpKeyRaw = tpKey;
		let bestKey: string | null = null;
		let bestScore = 0;

		// 1) 빠른 contains(정규화 문자열)
		if (tpKeyRaw) {
			for (const k of keys) {
				if (!k) continue;
				if (tpKeyRaw.includes(k) || k.includes(tpKeyRaw)) {
					// 길이 비율 기반 점수(짧은 쪽이 너무 짧으면 오탐 가능)
					const shorter = Math.min(tpKeyRaw.length, k.length);
					const longer = Math.max(tpKeyRaw.length, k.length);
					const score = longer > 0 ? shorter / longer : 0;
					if (score > bestScore) {
						bestScore = score;
						bestKey = k;
					}
				}
			}
		}

		// 2) 토큰 자카드(느리지만 정확도 보강)
		const tpTokens = tokenSet(title);
		for (const k of keys) {
			const mt = manuTokenByKey.get(k);
			if (!mt) continue;
			const score = jaccard(tpTokens, mt);
			if (score > bestScore) {
				bestScore = score;
				bestKey = k;
			}
		}

		if (bestKey && bestScore >= minScore) {
			const hit = manuByKey.get(bestKey)!;
			return {
				rank,
				title,
				link: tp.link ?? null,
				matched: true,
				matchedProductName: hit.productName,
				tags: hit.tags || [],
				matchScore: bestScore,
			};
		}

		return {
			rank,
			title,
			link: tp.link ?? null,
			matched: false,
			matchedProductName: null,
			tags: [],
			matchScore: bestScore,
		};
	});
}

export type TagStat = { tag: string; count: number; ranks: number[] };

export function aggregateMatchedTags(rows: MatchedTopProduct[]): TagStat[] {
	const map = new Map<string, { count: number; ranks: Set<number> }>();
	for (const r of rows || []) {
		if (!r.matched) continue;
		const rk = Number(r.rank) || 0;
		for (const t of r.tags || []) {
			const tag = normTag(t);
			if (!tag) continue;
			const cur = map.get(tag) ?? { count: 0, ranks: new Set<number>() };
			cur.count += 1;
			if (rk > 0) cur.ranks.add(rk);
			map.set(tag, cur);
		}
	}
	return [...map.entries()]
		.map(([tag, v]) => ({ tag, count: v.count, ranks: [...v.ranks].sort((a, b) => a - b) }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

