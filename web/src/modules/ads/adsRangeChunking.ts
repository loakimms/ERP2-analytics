export type YmdRange = { from: string; to: string };

function ymdToDate(ymd: string): Date | null {
	const s = String(ymd || '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
	const d = new Date(`${s}T00:00:00`);
	return Number.isFinite(d.getTime()) ? d : null;
}

function dateToYmd(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

/** YYYY-MM-DD 범위를 maxDays 단위로 쪼갠다(양끝 포함). */
export function chunkYmdRange(from: string, to: string, maxDays: number): YmdRange[] {
	const start = ymdToDate(from);
	const end = ymdToDate(to);
	if (!start || !end || !Number.isFinite(maxDays) || maxDays <= 0) return [{ from, to }];

	const s = start.getTime() <= end.getTime() ? start : end;
	const e = start.getTime() <= end.getTime() ? end : start;

	const out: YmdRange[] = [];
	let cur = new Date(s);
	while (cur.getTime() <= e.getTime()) {
		const segFrom = new Date(cur);
		const segTo = new Date(cur);
		segTo.setDate(segTo.getDate() + (maxDays - 1));
		if (segTo.getTime() > e.getTime()) segTo.setTime(e.getTime());

		out.push({ from: dateToYmd(segFrom), to: dateToYmd(segTo) });

		cur = new Date(segTo);
		cur.setDate(cur.getDate() + 1);
	}
	return out;
}

/** YYYY-MM-DD 목록을 정렬/중복제거 후, 연속된 날짜를 구간으로 묶는다. */
export function groupContiguousDates(dates: string[]): YmdRange[] {
	const parsed: Array<{ ymd: string; ts: number }> = [];
	for (const s of dates || []) {
		const d = ymdToDate(s);
		if (!d) continue;
		const ymd = dateToYmd(d);
		parsed.push({ ymd, ts: d.getTime() });
	}
	parsed.sort((a, b) => a.ts - b.ts);

	// dedupe
	const uniq: Array<{ ymd: string; ts: number }> = [];
	for (const x of parsed) {
		if (uniq.length === 0 || uniq[uniq.length - 1]!.ymd !== x.ymd) uniq.push(x);
	}

	const out: YmdRange[] = [];
	let runFrom: { ymd: string; ts: number } | null = null;
	let prev: { ymd: string; ts: number } | null = null;
	const dayMs = 24 * 60 * 60 * 1000;

	for (const x of uniq) {
		if (!runFrom) {
			runFrom = x;
			prev = x;
			continue;
		}
		if (prev && x.ts === prev.ts + dayMs) {
			prev = x;
			continue;
		}
		out.push({ from: runFrom.ymd, to: (prev ?? runFrom).ymd });
		runFrom = x;
		prev = x;
	}
	if (runFrom) out.push({ from: runFrom.ymd, to: (prev ?? runFrom).ymd });

	return out;
}

