import type { HashtagAuditResponse, HashtagAuditSummaryRow } from './hashtagSeoTypes';

export function formatTagWithHash(tag: string): string {
	const t = String(tag || '').trim();
	if (!t) return '';
	return t.startsWith('#') ? t : `#${t}`;
}

export function topTags(rows: HashtagAuditSummaryRow[], max: number): HashtagAuditSummaryRow[] {
	const m = Math.max(0, Math.min(500, max));
	return (rows || []).slice(0, m);
}

export function buildFinalOkTagList(resp: HashtagAuditResponse | null | undefined, max: number): string[] {
	if (!resp) return [];
	const rows = topTags(resp.summary?.okTags || [], max);
	return rows.map((r) => formatTagWithHash(r.tag)).filter(Boolean);
}


