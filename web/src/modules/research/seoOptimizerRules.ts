export type SeoRules = {
	/**
	 * 금칙어/불용어: 조합/후보/토큰에서 완전 배제
	 * - 예: 무료배송, 당일, 특가, 최저가, 1+1 ...
	 */
	stopwords: string[];
	/**
	 * 동의어 그룹: "염색=염색약=염색제" 같은 형태를 라인으로 관리
	 * - 대표어는 그룹의 첫번째 항목
	 */
	synonymGroups: string[][];
	/**
	 * 전환 목표 템플릿/제약
	 */
	maxChars: number;
};

const LS_SEO_RULES_KEY = 'seoRules.v1';

export function defaultSeoRules(): SeoRules {
	return {
		stopwords: [
			'무료배송',
			'당일',
			'당일배송',
			'빠른배송',
			'특가',
			'할인',
			'쿠폰',
			'사은품',
			'증정',
			'1+1',
			'2+1',
			'세일',
			'최저가',
			'정품',
			'공식',
			'인기',
			'베스트',
			'추천',
			'대용량',
			'특대',
			'리필',
			'세트',
		],
		synonymGroups: [
			['염색약', '염색', '염색제'],
			['새치', '흰머리'],
		],
		maxChars: 25,
	};
}

function safeJsonParse<T>(s: string | null, fallback: T): T {
	try {
		if (!s) return fallback;
		return JSON.parse(s) as T;
	} catch {
		return fallback;
	}
}

function normalizeWord(s: string): string {
	return String(s || '').trim().replace(/\s+/g, ' ');
}

export function loadSeoRules(): SeoRules {
	const base = defaultSeoRules();
	const raw = safeJsonParse<Partial<SeoRules>>(localStorage.getItem(LS_SEO_RULES_KEY), {});
	const stopwords = Array.isArray(raw.stopwords) ? raw.stopwords.map(normalizeWord).filter(Boolean) : base.stopwords;
	const synonymGroups = Array.isArray(raw.synonymGroups)
		? raw.synonymGroups
				.map((g) => (Array.isArray(g) ? g.map(normalizeWord).filter(Boolean) : []))
				.filter((g) => g.length >= 2)
		: base.synonymGroups;
	const maxChars = typeof raw.maxChars === 'number' && Number.isFinite(raw.maxChars) ? raw.maxChars : base.maxChars;
	return { stopwords, synonymGroups, maxChars };
}

export function saveSeoRules(rules: SeoRules): void {
	try {
		localStorage.setItem(LS_SEO_RULES_KEY, JSON.stringify(rules));
	} catch {
		// ignore
	}
}

export function parseStopwordsFromText(text: string): string[] {
	return String(text || '')
		.split(/\r?\n/g)
		.map(normalizeWord)
		.filter(Boolean);
}

export function serializeStopwordsToText(stopwords: string[]): string {
	return (stopwords || []).map(normalizeWord).filter(Boolean).join('\n');
}

export function parseSynonymGroupsFromText(text: string): string[][] {
	const lines = String(text || '')
		.split(/\r?\n/g)
		.map((x) => x.trim())
		.filter(Boolean);
	const groups: string[][] = [];
	for (const line of lines) {
		// 지원: "A=B=C" 또는 "A, B, C"
		const raw = line.includes('=') ? line.split('=') : line.split(',');
		const g = raw.map(normalizeWord).filter(Boolean);
		if (g.length >= 2) groups.push(g);
	}
	return groups;
}

export function serializeSynonymGroupsToText(groups: string[][]): string {
	return (groups || [])
		.filter((g) => Array.isArray(g) && g.length >= 2)
		.map((g) => g.map(normalizeWord).filter(Boolean).join('='))
		.join('\n');
}





