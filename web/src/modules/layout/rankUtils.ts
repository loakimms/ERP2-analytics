export type RankPoint = {
	date: string;
	rank: number;
};

export type RankSeries = {
	keyword: string;
	series: RankPoint[];
};

export type RankHistory = {
	dates: string[];
	series: RankSeries[];
};

export function formatKstDateKey(d: Date): string {
	// sv-SE locale은 "YYYY-MM-DD" 포맷을 안정적으로 반환한다.
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(d);
}

function parseYmdToUtcDate(ymd: string): Date | null {
	const s = String(ymd || '').trim();
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
	return new Date(Date.UTC(y, mo - 1, d));
}

export function getLatestRankSummary(
	history: RankHistory | null,
	keyword: string,
): { rank: number | null; delta: number | null } {
	if (!history) return { rank: null, delta: null };
	const kw = String(keyword || '').trim();
	if (!kw) return { rank: null, delta: null };
	const series = history.series.find((s) => s.keyword === kw);
	if (!series || !Array.isArray(series.series) || series.series.length === 0) {
		return { rank: null, delta: null };
	}
	const sorted = [...series.series].sort((a, b) => a.date.localeCompare(b.date));
	const latest = sorted[sorted.length - 1]!;
	const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
	const delta = prev ? prev.rank - latest.rank : null; // +: 순위 상승
	return { rank: latest.rank, delta };
}

// 주어진 날짜 배열을 기준으로, 최소~최대 날짜 사이의 모든 날짜(연속된 일자)를 생성한다.
function buildContinuousDatesAsc(dates: string[]): string[] {
	if (!dates || dates.length === 0) return [];

	const sorted = [...dates].sort(); // 오름차순
	const start = parseYmdToUtcDate(sorted[0] as string);
	const end = parseYmdToUtcDate(sorted[sorted.length - 1] as string);
	if (!start || !end) return [];

	const result: string[] = [];
	const DAY_MS = 24 * 60 * 60 * 1000;
	for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
		result.push(formatKstDateKey(new Date(t)));
	}
	return result;
}

/**
 * 시계열 랭킹 데이터를 Recharts LineChart에서 사용할 수 있는 형태로 변환한다.
 *
 * 입력:
 * - history: { dates: string[]; series: { keyword, series: { date, rank }[] }[] }
 * - selectedKeywords: 그래프에 표시할 키워드 목록 (최대 N개)
 *
 * 출력:
 * - [{ date: '2025-12-20', '키워드1': 3, '키워드2': 5, ... }, ...]
 */
export function buildRankChartData(
	history: RankHistory | null,
	selectedKeywords: string[],
	dates?: string[],
): Array<Record<string, string | number | null>> {
	if (!history || selectedKeywords.length === 0) return [];

	const baseDates = (dates && dates.length > 0 ? dates : history.dates) ?? [];
	// 성능 최적화:
	// - 기존: 날짜 × 키워드마다 find/find로 O(D*K*N) 탐색
	// - 개선: 키워드별로 (date -> rank) 맵을 만들어 O(D*K)로 조회
	const seriesMap = new Map<string, Map<string, number>>();
	for (const s of history.series || []) {
		const m = new Map<string, number>();
		for (const p of s.series || []) {
			if (p && typeof p.date === 'string') m.set(p.date, Number(p.rank));
		}
		seriesMap.set(s.keyword, m);
	}

	return baseDates.map((date) => {
		const row: Record<string, string | number | null> = { date };
		for (const kw of selectedKeywords) {
			const m = seriesMap.get(kw);
			row[kw] = m?.get(date) ?? null;
		}
		return row;
	});
}

export type KeywordDailyCell = {
	date: string;
	rank: number | null;
	delta: number | null;
};

export type KeywordDailyRow = {
	keyword: string;
	cells: KeywordDailyCell[];
};

/**
 * 키워드 × 날짜 매트릭스 테이블용 데이터로 변환한다.
 *
 * - rows: 각 키워드별 행
 * - 각 셀에는 해당 날짜의 순위와 전일 대비 증감(delta)이 포함된다.
 */
export function buildRankMatrixData(
	history: RankHistory | null,
	days?: number,
): KeywordDailyRow[] {
	if (!history || !days || days <= 0) return [];

	// 오늘 기준으로 days 만큼의 날짜를 생성한다. (예: 7일, 30일 등)
	// - 표에는 이 날짜들을 모두 보여주고
	// - 데이터가 없는 날짜는 rank/delta 를 null 로 두어 '-' 로 표시한다.
	const now = new Date();
	const displayDatesDesc: string[] = [];
	const DAY_MS = 24 * 60 * 60 * 1000;
	for (let i = 0; i < days; i++) {
		displayDatesDesc.push(formatKstDateKey(new Date(now.getTime() - i * DAY_MS)));
	}
	// 내부 계산 편의를 위해 오름차순 버전도 만든다.
	const displayDatesAsc = [...displayDatesDesc].sort((a, b) => a.localeCompare(b));

	// 성능 최적화(기존 동작 유지):
	// - delta는 "전일"이 아니라 "직전으로 존재하는 데이터 포인트" 기준으로 계산한다.
	// - 기존 구현은 findIndex로 날짜 포인트를 찾은 뒤, idx-1 포인트를 prev로 사용했다.
	// - 여기서는 정렬된 포인트를 1회 순회해 (date -> {rank, prevRank}) 맵을 만든다.
	return (history.series || []).map((series) => {
		const points = [...(series.series || [])].sort((a, b) => a.date.localeCompare(b.date));
		const rankByDate = new Map<string, number>();
		const prevRankByDate = new Map<string, number | null>();
		for (let i = 0; i < points.length; i++) {
			const p = points[i]!;
			const prev = i > 0 ? points[i - 1]! : null;
			rankByDate.set(p.date, Number(p.rank));
			prevRankByDate.set(p.date, prev ? Number(prev.rank) : null);
		}

		const cellsAsc: KeywordDailyCell[] = displayDatesAsc.map((date) => {
			if (!rankByDate.has(date)) return { date, rank: null, delta: null };
			const rank = rankByDate.get(date)!;
			const prevRank = prevRankByDate.get(date) ?? null;
			const delta = prevRank == null ? null : prevRank - rank; // +: 순위 상승
			return { date, rank, delta };
		});

		// 최신 날짜 왼쪽(내림차순)
		return { keyword: series.keyword, cells: [...cellsAsc].reverse() };
	});
}


