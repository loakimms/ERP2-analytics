import { fromYmd, normalizeRange, rangeLengthDays, toLocalStartOfDay, toYmd, type DateRange } from '../ads/dateRangeUtils';

export type A1DateRange = { fromYmd: string; toYmd: string }; // inclusive

export function defaultA1LastNDaysRange(n: number, now = new Date()): A1DateRange {
	const nn = Math.max(1, Math.min(90, Number(n || 30)));
	const today = toLocalStartOfDay(now);
	const to = today;
	const from = new Date(today);
	from.setDate(from.getDate() - (nn - 1));
	return { fromYmd: toYmd(from), toYmd: toYmd(to) };
}

export function toDateRangeOrNull(r: A1DateRange): DateRange | null {
	const f = fromYmd(r.fromYmd);
	const t = fromYmd(r.toYmd);
	if (!f || !t) return null;
	return normalizeRange({ from: f, to: t });
}

export function clampA1Range(r: A1DateRange, maxDays = 90): { range: A1DateRange; days: number } {
	const dr = toDateRangeOrNull(r);
	if (!dr) {
		const fallback = defaultA1LastNDaysRange(30);
		return { range: fallback, days: 30 };
	}
	const days = rangeLengthDays(dr);
	const md = Math.max(1, Math.min(3650, Number(maxDays || 90)));
	if (days <= md) {
		return { range: { fromYmd: toYmd(dr.from), toYmd: toYmd(dr.to) }, days };
	}
	// 너무 길면 "끝(to) 고정" + maxDays로 축소
	const to = dr.to;
	const from = new Date(to);
	from.setDate(from.getDate() - (md - 1));
	return { range: { fromYmd: toYmd(from), toYmd: toYmd(to) }, days: md };
}

export function buildA1RangePayload(r: A1DateRange, maxDays = 90): { days: number; date_from: string; date_to: string } {
	const { range, days } = clampA1Range(r, maxDays);
	return { days, date_from: range.fromYmd, date_to: range.toYmd };
}

