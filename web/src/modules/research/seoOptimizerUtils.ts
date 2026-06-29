export type CandidateLike = {
	keyword: string;
	titleFreq?: number | null;
	totalSearchQcCnt?: number | null;
	avgCtr?: number | null; // percent (e.g. 2.14)
	compIdx?: string | null;
};

export type ScoreWeights = {
	search: number; // 검색량
	freq: number; // 사용빈도(상품명 패턴)
	ctr: number; // CTR
};

export type CandidateScoresV2 = {
	search: number; // 1..10
	freq: number; // 1..10
	ctr: number; // 1..10
	total: number; // 1..10 (weighted)
};

export type CandidateWithTokens<T extends CandidateLike> = T & {
	tokens: string[];
	scoresV2: CandidateScoresV2;
};

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

function toNum(v: unknown): number | null {
	if (v == null) return null;
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	return n;
}

function scale01(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return 0;
	if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
	if (max <= min) return 1; // 모든 값이 동일하면 최고점 처리
	return clamp((value - min) / (max - min), 0, 1);
}

export function normalizeScore1to10(value: number, min: number, max: number): number {
	const s01 = scale01(value, min, max);
	return Math.round((1 + s01 * 9) * 100) / 100;
}

export function computeScoresV2<T extends CandidateLike>(
	candidates: T[],
	weights: ScoreWeights,
): Array<T & { scoresV2: CandidateScoresV2 }> {
	const searchVals = candidates.map((c) => toNum(c.totalSearchQcCnt) ?? 0);
	const freqVals = candidates.map((c) => toNum(c.titleFreq) ?? 0);
	const ctrVals = candidates.map((c) => toNum(c.avgCtr) ?? 0);

	const sMin = Math.min(...searchVals);
	const sMax = Math.max(...searchVals);
	const fMin = Math.min(...freqVals);
	const fMax = Math.max(...freqVals);
	const cMin = Math.min(...ctrVals);
	const cMax = Math.max(...ctrVals);

	const wSum = (weights.search || 0) + (weights.freq || 0) + (weights.ctr || 0);
	const w = wSum > 0 ? weights : { search: 1, freq: 0, ctr: 0 };
	const wNorm = {
		search: (w.search || 0) / (wSum > 0 ? wSum : 1),
		freq: (w.freq || 0) / (wSum > 0 ? wSum : 1),
		ctr: (w.ctr || 0) / (wSum > 0 ? wSum : 1),
	};

	return candidates.map((c) => {
		const search = normalizeScore1to10(toNum(c.totalSearchQcCnt) ?? 0, sMin, sMax);
		const freq = normalizeScore1to10(toNum(c.titleFreq) ?? 0, fMin, fMax);
		const ctr = normalizeScore1to10(toNum(c.avgCtr) ?? 0, cMin, cMax);
		const total = Math.round((search * wNorm.search + freq * wNorm.freq + ctr * wNorm.ctr) * 100) / 100;
		return { ...c, scoresV2: { search, freq, ctr, total } };
	});
}

export function buildVocabTokens(params: {
	titleTokens?: Array<{ token: string; freq: number }>;
	productName?: string;
	mainKeyword?: string;
	extra?: string[];
}): string[] {
	const set = new Set<string>();
	const push = (s: string) => {
		const t = (s || '').trim();
		if (!t) return;
		set.add(t);
	};

	for (const t of params.titleTokens || []) {
		if (t && typeof t.token === 'string') push(t.token);
	}
	for (const part of String(params.productName || '').split(/\s+/g)) push(part);
	for (const part of String(params.mainKeyword || '').split(/\s+/g)) push(part);
	for (const e of params.extra || []) push(e);

	// 길이가 긴 토큰 우선(그리디 매칭에서 유리)
	return Array.from(set)
		.map((x) => x.replace(/\s+/g, '').trim())
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);
}

export function segmentKoreanCompound(input: string, vocab: string[]): string[] {
	const raw = String(input || '').trim();
	if (!raw) return [];

	// 공백이 있으면 일단 공백 단위로 분해한 뒤, 각 파트를 다시 시도
	if (/\s+/.test(raw)) {
		const parts = raw.split(/\s+/g).filter(Boolean);
		const out: string[] = [];
		for (const p of parts) out.push(...segmentKoreanCompound(p, vocab));
		return out.length > 0 ? out : parts;
	}

	const s = raw.replace(/\s+/g, '');
	if (s.length <= 2) return [s];

	// vocab 기반 그리디 longest-match
	const tokens: string[] = [];
	let i = 0;
	while (i < s.length) {
		let matched: string | null = null;
		for (const v of vocab) {
			if (!v) continue;
			if (v.length < 2) continue;
			if (s.startsWith(v, i)) {
				matched = v;
				break;
			}
		}
		if (matched) {
			tokens.push(matched);
			i += matched.length;
			continue;
		}
		// 매칭 실패 시: 남은 길이가 2 이상이면 2글자씩 묶어(너무 잘게 쪼개는 것 방지)
		const remain = s.length - i;
		const step = remain >= 2 ? 2 : 1;
		tokens.push(s.slice(i, i + step));
		i += step;
	}

	// 정리: 빈 토큰 제거 + 중복 제거(연속 중복)
	const normalized: string[] = [];
	for (const t of tokens.map((x) => x.trim()).filter(Boolean)) {
		if (normalized.length > 0 && normalized[normalized.length - 1] === t) continue;
		normalized.push(t);
	}
	return normalized.length > 0 ? normalized : [s];
}

/**
 * 후보 키워드(조합형)를 UI 선택 단위로 "앞 토큰 + 원문" 형태로 세분화한다.
 *
 * 요구사항 예:
 * - 헤나염색약 => [헤나, 헤나염색약]
 * - 천연염색약 => [천연, 천연염색약]
 *
 * - 공백이 있는 키워드(이미 조합형)는 기존 segmentedTokens를 그대로 사용한다.
 * - segmentedTokens가 2개 이상이면 조합형으로 보고, 첫 토큰 + 원문을 반환한다.
 */
export function expandCompoundKeywordForSelection(params: {
	keyword: string;
	segmentedTokens: string[];
}): string[] {
	const kw = String(params.keyword || '').trim();
	if (!kw) return [];
	if (/\s+/.test(kw)) {
		// 띄어쓰기 조합형은 분해 토큰을 그대로 노출(사용자가 조합형 유지/선택 가능)
		return (params.segmentedTokens || []).map((x) => String(x || '').trim()).filter(Boolean);
	}
	const seg = (params.segmentedTokens || []).map((x) => String(x || '').trim()).filter(Boolean);
	if (seg.length >= 2) {
		const first = seg[0]!;
		return Array.from(new Set([first, kw].filter(Boolean)));
	}
	return seg.length > 0 ? seg : [kw];
}

export type CandidateFilters = {
	includeText?: string;
	minSearch?: number | null;
	maxSearch?: number | null;
	minFreq?: number | null;
	maxFreq?: number | null;
	minCtr?: number | null;
	maxCtr?: number | null;
	competition?: 'all' | '높음' | '중간' | '낮음';
};

export function filterCandidates<T extends CandidateLike>(items: T[], f: CandidateFilters): T[] {
	const q = String(f.includeText || '').trim();
	const qLower = q.toLowerCase();

	const minSearch = f.minSearch ?? null;
	const maxSearch = f.maxSearch ?? null;
	const minFreq = f.minFreq ?? null;
	const maxFreq = f.maxFreq ?? null;
	const minCtr = f.minCtr ?? null;
	const maxCtr = f.maxCtr ?? null;
	const comp = f.competition || 'all';

	return (items || []).filter((c) => {
		const kw = String(c.keyword || '');
		if (qLower && !kw.toLowerCase().includes(qLower)) return false;

		const search = toNum(c.totalSearchQcCnt) ?? 0;
		const freq = toNum(c.titleFreq) ?? 0;
		const ctr = toNum(c.avgCtr) ?? 0;

		if (minSearch != null && search < minSearch) return false;
		if (maxSearch != null && search > maxSearch) return false;
		if (minFreq != null && freq < minFreq) return false;
		if (maxFreq != null && freq > maxFreq) return false;
		if (minCtr != null && ctr < minCtr) return false;
		if (maxCtr != null && ctr > maxCtr) return false;

		if (comp !== 'all') {
			const cidx = String(c.compIdx || '').trim();
			if (cidx !== comp) return false;
		}

		return true;
	});
}

export type TokenMetric = {
	token: string;
	search: number;
	freq: number;
	ctr: number;
};

export type ComboStats = {
	totalSearch: number | null;
	totalFreq: number;
	avgCtr: number | null; // percent
	totalScore: number | null; // 0..10 scale derived from available metrics
	missingTokenCount: number;
};

export function computeComboStats(params: {
	comboTokens: string[];
	prefix: string;
	tokenMetrics: Record<string, TokenMetric>;
	metricBounds: { sMin: number; sMax: number; fMin: number; fMax: number; cMin: number; cMax: number };
	weights: ScoreWeights;
}): ComboStats | null {
	const prefixTokens = String(params.prefix || '')
		.trim()
		.split(/\s+/g)
		.filter(Boolean);
	const slotTokens = (params.comboTokens || []).slice(prefixTokens.length);
	if (slotTokens.length === 0) return null;

	const tokenMetrics = params.tokenMetrics || {};
	let missingTokenCount = 0;
	const items = slotTokens
		.map((t) => String(t || '').trim())
		.filter(Boolean)
		.map((t) => ({ t, m: tokenMetrics[t] }))
		.filter((x) => {
			if (!x.m) {
				missingTokenCount += 1;
				return false;
			}
			return true;
		});
	if (items.length === 0) return null;

	const totalSearchRaw = items.reduce((acc, x) => acc + Number(x.m!.search || 0), 0);
	const totalSearch = totalSearchRaw > 0 ? totalSearchRaw : null;
	const totalFreq = items.reduce((acc, x) => acc + Number(x.m!.freq || 0), 0);

	const hasAnyCtr = items.some((x) => Number(x.m!.ctr || 0) > 0);
	const avgCtr =
		hasAnyCtr && totalSearchRaw > 0
			? items.reduce((acc, x) => acc + Number(x.m!.ctr || 0) * Number(x.m!.search || 0), 0) / totalSearchRaw
			: hasAnyCtr
				? items.reduce((acc, x) => acc + Number(x.m!.ctr || 0), 0) / items.length
				: null;

	// (핵심) 데이터가 없을 때 0이 아니라 "미집계"로 다루기 위해, 각 축의 가용성을 체크한다.
	const b = params.metricBounds;
	const canSearch = Number.isFinite(b.sMax) && b.sMax > 0;
	const canFreq = Number.isFinite(b.fMax) && b.fMax > 0;
	const canCtr = Number.isFinite(b.cMax) && b.cMax > 0;

	const w = params.weights || { search: 0.6, freq: 0.3, ctr: 0.1 };
	const wAvail = {
		search: canSearch ? w.search : 0,
		freq: canFreq ? w.freq : 0,
		ctr: canCtr ? w.ctr : 0,
	};
	const wSum = (wAvail.search || 0) + (wAvail.freq || 0) + (wAvail.ctr || 0);
	if (wSum <= 0) {
		return { totalSearch, totalFreq, avgCtr, totalScore: null, missingTokenCount };
	}
	const wNorm = { search: wAvail.search / wSum, freq: wAvail.freq / wSum, ctr: wAvail.ctr / wSum };

	const norm = (v: number, min: number, max: number): number => {
		// 범위가 0이면 "데이터 없음" 취급: 값이 0이면 0점, 값이 있으면 10점
		if (!Number.isFinite(max) || !Number.isFinite(min) || max <= min) return v > 0 ? 10 : 0;
		return normalizeScore1to10(v, min, max);
	};

	const avgSearchScore = canSearch ? items.reduce((acc, x) => acc + norm(Number(x.m!.search || 0), b.sMin, b.sMax), 0) / items.length : 0;
	const avgFreqScore = canFreq ? items.reduce((acc, x) => acc + norm(Number(x.m!.freq || 0), b.fMin, b.fMax), 0) / items.length : 0;
	const avgCtrScore = canCtr ? items.reduce((acc, x) => acc + norm(Number(x.m!.ctr || 0), b.cMin, b.cMax), 0) / items.length : 0;
	const totalScore = Math.round((avgSearchScore * wNorm.search + avgFreqScore * wNorm.freq + avgCtrScore * wNorm.ctr) * 100) / 100;

	return { totalSearch, totalFreq, avgCtr, totalScore, missingTokenCount };
}

/**
 * 용량/수량 토큰(숫자 + 단위/개/입 등)을 후보 키워드에서 제외하기 위한 판별기.
 *
 * 제외 예:
 * - 100g, 30 g, 0.5kg
 * - 200ml, 200 mL, 500㎖, 1L
 * - 1개, 2개입, 10매, 3장
 * - 100g*2, 100g×2, 200mlx3
 */
export function isCapacityLikeToken(input: string): boolean {
	const s = String(input || '').trim();
	if (!s) return false;

	// 공백 제거(예: "30 g" -> "30g")
	const compact = s.replace(/\s+/g, '');

	const unit = '(?:ml|mL|㎖|l|L|ℓ|g|G|kg|KG|oz|OZ)';
	const qty = '(?:개|개입|입|매|장)';
	const num = '(?:\\d+(?:\\.\\d+)?)';

	// 100g / 0.5kg / 200ml / 1L
	if (new RegExp(`^${num}${unit}$`).test(compact)) return true;
	// 1개 / 2개입 / 10매 / 3장
	if (new RegExp(`^${num}${qty}$`).test(compact)) return true;
	// 100g*2 / 100g×2 / 200mlx3
	if (new RegExp(`^${num}${unit}[xX*×]${num}$`).test(compact)) return true;
	// 2개*3 / 10매x2
	if (new RegExp(`^${num}${qty}[xX*×]${num}$`).test(compact)) return true;

	return false;
}

export type SeoRulesLike = {
	stopwords: string[];
	synonymGroups: string[][];
	maxChars: number;
};

function normalizeTokenKey(s: string): string {
	return String(s || '').trim().replace(/\s+/g, '');
}

export function buildSynonymIndex(groups: string[][]): {
	toCanonical: Record<string, string>;
	groupOf: Record<string, string>;
	canonToGroup: Record<string, string[]>;
} {
	const toCanonical: Record<string, string> = {};
	const groupOf: Record<string, string> = {};
	const canonToGroup: Record<string, string[]> = {};

	for (const gRaw of groups || []) {
		const g = (gRaw || []).map((x) => String(x || '').trim()).filter(Boolean);
		if (g.length < 2) continue;
		const canon = g[0]!;
		canonToGroup[canon] = g;
		for (const w of g) {
			const k = normalizeTokenKey(w);
			if (!k) continue;
			toCanonical[k] = canon;
			groupOf[k] = canon;
		}
	}
	return { toCanonical, groupOf, canonToGroup };
}

export function applyRulesToToken(token: string, rules: SeoRulesLike): string | null {
	const t = String(token || '').trim();
	if (!t) return null;
	const stop = new Set((rules.stopwords || []).map((x) => normalizeTokenKey(x)).filter(Boolean));
	const key = normalizeTokenKey(t);
	if (stop.has(key)) return null;

	const idx = buildSynonymIndex(rules.synonymGroups || []);
	const canon = idx.toCanonical[key] || t;
	const canonKey = normalizeTokenKey(canon);
	if (!canonKey || stop.has(canonKey)) return null;
	return canon;
}

export function buildTokenMetrics<T extends CandidateLike & { tokens: string[] }>(cands: T[]): Record<string, TokenMetric> {
	const out: Record<string, TokenMetric> = {};
	for (const c of cands || []) {
		const search = toNum(c.totalSearchQcCnt) ?? 0;
		const freq = toNum(c.titleFreq) ?? 0;
		const ctr = toNum(c.avgCtr) ?? 0;
		for (const t of c.tokens || []) {
			const key = String(t || '').trim();
			if (!key) continue;
			const cur = out[key] || { token: key, search: 0, freq: 0, ctr: 0 };
			// 검색량은 "해당 토큰이 포함된 후보 중 최대값"을 사용(과대 합산 방지)
			cur.search = Math.max(cur.search, search);
			// 빈도는 "합" (상품명 내 등장 신호를 누적)
			cur.freq += freq;
			// CTR은 최대값(보수적으로 좋았던 케이스를 반영)
			cur.ctr = Math.max(cur.ctr, ctr);
			out[key] = cur;
		}
	}
	return out;
}

export function buildLiveCombos(params: {
	productName: string;
	mainKeyword?: string;
	selectedTokens: string[];
	tokenMetrics: Record<string, TokenMetric>;
	maxTokensTotal: number;
	maxChars?: number;
	rules?: SeoRulesLike;
	comboCount: number;
}): Array<{ name: string; tokens: string[] }> {
	const prefix = (params.productName || '').trim();
	const maxTotal = Math.max(2, params.maxTokensTotal || 8);
	const count = Math.max(1, params.comboCount || 10);
	const maxChars = Math.max(5, params.maxChars || 25);
	const rules = params.rules;

	const idx = rules ? buildSynonymIndex(rules.synonymGroups || []) : null;
	const stop = rules ? new Set((rules.stopwords || []).map((x) => normalizeTokenKey(x)).filter(Boolean)) : null;

	const canonicalize = (t: string): string | null => {
		const raw = String(t || '').trim();
		if (!raw) return null;
		const key = normalizeTokenKey(raw);
		if (stop && stop.has(key)) return null;
		const canon = idx?.toCanonical[key] || raw;
		const canonKey = normalizeTokenKey(canon);
		if (!canonKey) return null;
		if (stop && stop.has(canonKey)) return null;
		return canon;
	};

	const prefixTokens = prefix.split(/\s+/g).filter(Boolean);
	const prefixLower = prefix.replace(/\s+/g, '').toLowerCase();

	const baseSelected = (params.selectedTokens || [])
		.map((t) => canonicalize(String(t || '')))
		.filter(Boolean) as string[];

	// mainKeyword의 토큰(공백 분해)도 우선 포함(단, prefix/금칙어/동의어 처리)
	const mainParts = String(params.mainKeyword || '')
		.split(/\s+/g)
		.map((x) => canonicalize(x))
		.filter(Boolean) as string[];

	const uniq = Array.from(
		new Set(
			[...mainParts, ...baseSelected]
				.map((t) => String(t || '').trim())
				.filter(Boolean)
				.filter((t) => !prefixLower.includes(t.toLowerCase())),
		),
	);

	// 동의어 그룹 중복 제거: 같은 그룹(대표어)에서 1개만 남긴다(이미 canonical로 정규화되어 대표어 기준)
	if (idx) {
		const seenGroup = new Set<string>();
		const next: string[] = [];
		for (const t of uniq) {
			const g = idx.groupOf[normalizeTokenKey(t)] || t;
			if (seenGroup.has(g)) continue;
			seenGroup.add(g);
			next.push(t);
		}
		uniq.splice(0, uniq.length, ...next);
	}

	// 중요도(검색량>빈도>CTR) 기준 정렬
	uniq.sort((a, b) => {
		const am = params.tokenMetrics[a] || { search: 0, freq: 0, ctr: 0 };
		const bm = params.tokenMetrics[b] || { search: 0, freq: 0, ctr: 0 };
		if (bm.search !== am.search) return bm.search - am.search;
		if (bm.freq !== am.freq) return bm.freq - am.freq;
		return bm.ctr - am.ctr;
	});

	const budget = Math.max(0, maxTotal - prefixTokens.length);
	const base = uniq.slice(0, budget);
	if (base.length === 0) return [{ name: prefix || '-', tokens: prefixTokens }];

	const withinCharLimit = (tokens: string[]): boolean => {
		const name = tokens.join(' ').replace(/\s+/g, ' ').trim();
		return name.length <= maxChars;
	};

	// 전환 목표에 맞춘 간단한 역할 기반 정렬(문장형성 개선)
	const roleOf = (t: string): 'core' | 'problem' | 'benefit' | 'target' | 'form' | 'other' => {
		const s = normalizeTokenKey(t);
		if (!s) return 'other';
		// 핵심(메인키워드) 토큰은 core로
		if (mainParts.some((m) => normalizeTokenKey(m) === s)) return 'core';
		if (/(새치|흰머리|탈모|가려움|비듬|손상|커버)/.test(s)) return 'problem';
		if (/(천연|식물|저자극|무암모니아|논암모니아|순한|약산성|민감)/.test(s)) return 'benefit';
		if (/(남성|여성|임산부|청소년|중년|시니어)/.test(s)) return 'target';
		if (/(샴푸|크림|폼|스프레이|트리트먼트|팩|오일)/.test(s)) return 'form';
		return 'other';
	};

	const orderByRole = (arr: string[]) =>
		arr
			.slice()
			.sort((a, b) => {
				const ra = roleOf(a);
				const rb = roleOf(b);
				const rank = (r: string) =>
					r === 'core' ? 0 : r === 'problem' ? 1 : r === 'benefit' ? 2 : r === 'target' ? 3 : r === 'form' ? 4 : 9;
				const da = rank(ra);
				const db = rank(rb);
				if (da !== db) return da - db;
				const am = params.tokenMetrics[a] || { search: 0, freq: 0, ctr: 0 };
				const bm = params.tokenMetrics[b] || { search: 0, freq: 0, ctr: 0 };
				if (bm.search !== am.search) return bm.search - am.search;
				if (bm.freq !== am.freq) return bm.freq - am.freq;
				return bm.ctr - am.ctr;
			});

	const out: Array<{ name: string; tokens: string[] }> = [];
	for (let i = 0; i < count; i++) {
		// 변형: 핵심(core) 유지 + 나머지 역할별로 회전
		const sorted = orderByRole(base);
		const rotate = i % Math.max(1, sorted.length);
		const rotated = sorted.slice(rotate).concat(sorted.slice(0, rotate));

		const desiredLen = clamp(Math.min(rotated.length, Math.max(2, rotated.length - (i % 3))), 2, rotated.length);
		const picked = rotated.slice(0, desiredLen);

		// 글자수(25자) 제한에 맞게 뒤에서부터 제거
		let tokens = [...prefixTokens, ...picked].slice(0, maxTotal);
		while (tokens.length > prefixTokens.length && !withinCharLimit(tokens)) {
			tokens = tokens.slice(0, -1);
		}

		const name = tokens.join(' ').replace(/\s+/g, ' ').trim() || '-';
		// 중복 조합 제거
		if (out.some((x) => x.name === name)) continue;
		// prefix만 남았는데 길이 제한에 걸리면(비정상) 제외
		if (!withinCharLimit(tokens)) continue;
		out.push({ name, tokens });
		if (out.length >= count) break;
	}
	return out;
}

export type ConversionTemplateInput = {
	productName: string; // prefix
	mainToken: string; // 메인 단일 키워드(1)
	intentToken1: string; // 구매의도(1)
	intentToken2: string; // 구매의도(2)
	safetyToken1: string; // 안전/차별(1)
	safetyToken2: string; // 안전/차별(2)
	formToken: string; // 형태(1)
	slotOrder?: Array<'main' | 'intent1' | 'intent2' | 'safety1' | 'safety2' | 'form'>; // 드래그로 재정렬된 슬롯 순서(옵션)
	maxTokensTotal: number;
	maxChars: number; // 공백 포함 글자수
	rules?: SeoRulesLike;
};

export type ConversionTemplateResult =
	| { ok: true; name: string; tokens: string[] }
	| { ok: false; reason: string };

export function buildConversionTemplateCombo(input: ConversionTemplateInput): ConversionTemplateResult {
	const maxChars = Math.max(5, input.maxChars || 25);
	const maxTokensTotal = Math.max(2, input.maxTokensTotal || 8);
	const rules = input.rules;

	const idx = rules ? buildSynonymIndex(rules.synonymGroups || []) : null;
	const stop = rules ? new Set((rules.stopwords || []).map((x) => normalizeTokenKey(x)).filter(Boolean)) : null;

	const canonicalize = (t: string): string | null => {
		const raw = String(t || '').trim();
		if (!raw) return null;
		const key = normalizeTokenKey(raw);
		if (stop && stop.has(key)) return null;
		const canon = idx?.toCanonical[key] || raw;
		const canonKey = normalizeTokenKey(canon);
		if (!canonKey) return null;
		if (stop && stop.has(canonKey)) return null;
		return canon;
	};

	const prefix = String(input.productName || '').trim();
	const prefixTokens = prefix.split(/\s+/g).filter(Boolean);
	const prefixLower = prefix.replace(/\s+/g, '').toLowerCase();

	const main = canonicalize(input.mainToken);
	const intent1 = canonicalize(input.intentToken1);
	const intent2 = canonicalize(input.intentToken2);
	const safety1 = canonicalize(input.safetyToken1);
	const safety2 = canonicalize(input.safetyToken2);
	const form = canonicalize(input.formToken);

	if (!main) return { ok: false, reason: '메인 단일 키워드가 비어있거나 금칙어입니다.' };
	if (/\s+/.test(main)) return { ok: false, reason: '메인 키워드는 공백 없는 “단일 키워드”여야 합니다.' };
	if (!intent1) return { ok: false, reason: '구매의도 키워드(1)가 비어있거나 금칙어입니다.' };
	if (!intent2) return { ok: false, reason: '구매의도 키워드(2)가 비어있거나 금칙어입니다.' };
	if (!safety1) return { ok: false, reason: '안전/차별 키워드(1)가 비어있거나 금칙어입니다.' };
	if (!safety2) return { ok: false, reason: '안전/차별 키워드(2)가 비어있거나 금칙어입니다.' };
	if (!form) return { ok: false, reason: '형태 키워드가 비어있거나 금칙어입니다.' };

	// prefix에 이미 포함된 토큰은 제거(중복 방지)
	// (요청) 슬롯은 고정 개수(1/2/2/1) + 순서는 slotOrder로 재배치 가능
	const tokenById: Record<string, string> = {
		main: main!,
		intent1: intent1!,
		intent2: intent2!,
		safety1: safety1!,
		safety2: safety2!,
		form: form!,
	};
	const order =
		(Array.isArray(input.slotOrder) && input.slotOrder.length === 6
			? input.slotOrder
			: (['main', 'intent1', 'intent2', 'safety1', 'safety2', 'form'] as const)) as Array<
			'main' | 'intent1' | 'intent2' | 'safety1' | 'safety2' | 'form'
		>;
	const rawSlots = order.map((id) => tokenById[id]).filter(Boolean) as string[];
	const slots = rawSlots.filter((t) => !prefixLower.includes(normalizeTokenKey(t).toLowerCase()));

	// 슬롯 간 중복 제거(대표어 정규화 이후 기준)
	const uniqSlots: string[] = [];
	for (const t of slots) {
		if (uniqSlots.some((x) => normalizeTokenKey(x) === normalizeTokenKey(t))) continue;
		uniqSlots.push(t);
	}

	const tokens = [...prefixTokens, ...uniqSlots];
	if (tokens.length > maxTokensTotal) {
		return { ok: false, reason: `토큰 수 초과입니다. (현재 ${tokens.length} / 제한 ${maxTokensTotal})` };
	}

	const name = tokens.join(' ').replace(/\s+/g, ' ').trim();
	if (name.length > maxChars) {
		return { ok: false, reason: `글자수(공백 포함) ${maxChars}자 초과입니다. (현재 ${name.length}자)` };
	}
	if (!name) return { ok: false, reason: '조합 결과가 비어있습니다.' };

	return { ok: true, name, tokens };
}


