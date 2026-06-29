import { addDays, differenceInCalendarDays, startOfDay, subDays, subMonths } from 'date-fns';

export type DateRange = { from: Date; to: Date }; // inclusive, local date

export type CompareMode = 'prev_day' | 'prev_week' | 'prev_month';

export function toLocalStartOfDay(d: Date): Date {
	return startOfDay(d);
}

export function toYmd(d: Date): string {
	// local date -> YYYY-MM-DD
	const x = toLocalStartOfDay(d);
	const y = x.getFullYear();
	const m = String(x.getMonth() + 1).padStart(2, '0');
	const dd = String(x.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

export function fromYmd(ymd: string): Date | null {
	const s = (ymd || '').trim();
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return null;
	const y = Number(m[1]);
	const mm = Number(m[2]);
	const dd = Number(m[3]);
	if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
	const d = new Date(y, mm - 1, dd);
	// JS Date auto-rollover guard (e.g. 2025-02-31)
	if (d.getFullYear() !== y || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
	return startOfDay(d);
}

export function normalizeRange(range: DateRange): DateRange {
	const from = toLocalStartOfDay(range.from);
	const to = toLocalStartOfDay(range.to);
	return from.getTime() <= to.getTime() ? { from, to } : { from: to, to: from };
}

export function defaultYesterdayRange(now = new Date()): DateRange {
	const today = startOfDay(now);
	const y = subDays(today, 1);
	return { from: y, to: y };
}

export function rangeLengthDays(range: DateRange): number {
	const r = normalizeRange(range);
	return differenceInCalendarDays(r.to, r.from) + 1;
}

export function shiftRange(range: DateRange, mode: CompareMode): DateRange {
	const r = normalizeRange(range);
	const len = rangeLengthDays(r);
	if (mode === 'prev_day') {
		// 바로 직전 동일 길이 구간(예: 12/10~12/12 -> 12/7~12/9)
		return {
			from: subDays(r.from, len),
			to: subDays(r.to, len),
		};
	}
	if (mode === 'prev_week') {
		// 7일 전 동일 날짜 구간(요일 정렬)
		return {
			from: subDays(r.from, 7),
			to: subDays(r.to, 7),
		};
	}
	// prev_month: "달" 기준 비교(같은 일자를 1개월 이동, 말일은 자동 보정)
	return {
		from: subMonths(r.from, 1),
		to: subMonths(r.to, 1),
	};
}

export type Delta = { diff: number; pct: number | null }; // pct: (diff/prev)*100, null if prev==0

export function calcDelta(curr: number, prev: number): Delta {
	const c = Number(curr);
	const p = Number(prev);
	const diff = (Number.isFinite(c) ? c : 0) - (Number.isFinite(p) ? p : 0);
	if (!Number.isFinite(p) || p === 0) return { diff, pct: null };
	return { diff, pct: (diff / p) * 100 };
}

export function addRangeDays(range: DateRange, days: number): DateRange {
	const r = normalizeRange(range);
	return { from: addDays(r.from, days), to: addDays(r.to, days) };
}


