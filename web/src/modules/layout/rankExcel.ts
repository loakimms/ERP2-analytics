import { formatKstDateKey } from './rankUtils';

export type RankExcelTableRow = {
	keyword: string;
	cells: string[];
};

export type RankExcelTable = {
	dates: string[];
	rows: RankExcelTableRow[];
};

export type RankUploadItem = {
	keyword: string;
	date: string; // YYYY-MM-DD
	rank: number;
};

export type KeywordMeta = {
	keyword: string;
	monthly_search_volume: number | null;
};

function cellText(v: unknown): string {
	if (v == null) return '';
	if (typeof v === 'string') return v.trim();
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
	if (v instanceof Date) return formatKstDateKey(v);
	return String(v).trim();
}

function parseMonthDay(label: string): { month: number; day: number } | null {
	const s = String(label || '').trim();
	if (!s) return null;

	// 1) YYYY-MM-DD or YYYY.MM.DD
	const m1 = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
	if (m1) {
		const month = Number(m1[2]);
		const day = Number(m1[3]);
		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
	}

	// 2) MM.DD (요일 등 뒤에 붙어도 허용)
	const m2 = s.match(/(\d{1,2})[.\-\/](\d{1,2})/);
	if (m2) {
		const month = Number(m2[1]);
		const day = Number(m2[2]);
		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
	}

	return null;
}

export function normalizeDateLabelsToIso(labels: string[], referenceDate = new Date()): string[] {
	const refYear = referenceDate.getFullYear();
	if (!labels.length) return [];

	// 우선, 라벨에 연도가 이미 포함된 경우엔 그대로 YYYY-MM-DD로 normalize
	const out: string[] = [];
	let inferredYear = refYear;
	let prevMonth: number | null = null;

	for (const raw of labels) {
		const s = String(raw || '').trim();
		const ymd = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
		if (ymd) {
			const y = Number(ymd[1]);
			const m = String(Number(ymd[2])).padStart(2, '0');
			const d = String(Number(ymd[3])).padStart(2, '0');
			out.push(`${y}-${m}-${d}`);
			prevMonth = Number(m);
			inferredYear = y;
			continue;
		}

		const md = parseMonthDay(s);
		if (!md) {
			throw new Error(`날짜 헤더를 해석할 수 없습니다: "${s}"`);
		}

		// 엑셀은 보통 "최근→과거" 방향(01.xx ... 12.xx)로 나열된다.
		// month가 갑자기 커지면(1 → 12) 연도를 1년 내린다(연말/연초 구간).
		if (prevMonth != null && md.month > prevMonth) {
			inferredYear -= 1;
		}
		prevMonth = md.month;

		out.push(`${inferredYear}-${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}`);
	}

	return out;
}

export function extractRankFromCell(text: string): number | null {
	const s = String(text || '').trim();
	if (!s) return null;
	if (/^[-–—]+$/.test(s) || /순위\s*밖/.test(s)) return 0;
	// "6위", "6위 - 1P 6D", "6위\n▲1" 등에서 첫 번째 순위 숫자만 추출
	const m = s.match(/(\d+)\s*위/);
	if (m) {
		const n = Number(m[1]);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	const m2 = s.match(/\b(\d+)\b/);
	if (m2) {
		const n = Number(m2[1]);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	return null;
}

export function splitKeywordAndVolume(raw: string): { keyword: string; monthly_search_volume: number | null } {
	const s = String(raw || '').trim();
	if (!s) return { keyword: '', monthly_search_volume: null };

	// 가장 안전한 케이스: 줄바꿈으로 분리된 경우 (키워드 \n 10,630)
	const lines = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
	if (lines.length >= 2) {
		const kw = lines[0] ?? '';
		const volRaw = lines[1] ?? '';
		const volNum = Number(String(volRaw).replace(/[^\d]/g, ''));
		return {
			keyword: kw.trim(),
			monthly_search_volume: Number.isFinite(volNum) && volNum > 0 ? volNum : null,
		};
	}

	// 붙어서 오는 케이스:
	// - "키워드10,630" / "키워드 10,630"
	// - "키워드700" (3자리 이하도 실제 월간 검색량일 수 있음)
	// - "키워드 (4,730)" / "키워드(60)" 같은 괄호 표기도 허용
	const m = s.match(/^(.*?)[\s(]*((?:\d{1,3}(?:,\d{3})+)|\d{1,6})\)?$/);
	if (m) {
		const kw = String(m[1] || '').trim();
		const volNum = Number(String(m[2] || '').replace(/,/g, ''));
		if (kw && Number.isFinite(volNum) && volNum > 0) {
			return { keyword: kw, monthly_search_volume: volNum };
		}
	}

	return { keyword: s, monthly_search_volume: null };
}

export function buildRankUploadItems(table: RankExcelTable, referenceDate = new Date()): RankUploadItem[] {
	const isoDates = normalizeDateLabelsToIso(table.dates, referenceDate);
	const items: RankUploadItem[] = [];

	for (const row of table.rows) {
		const meta = splitKeywordAndVolume(row.keyword);
		const keyword = meta.keyword;
		if (!keyword) continue;
		for (let i = 0; i < isoDates.length; i++) {
			const cell = row.cells[i] ?? '';
			const rank = extractRankFromCell(cell);
			if (rank == null) continue;
			items.push({ keyword, date: isoDates[i]!, rank });
		}
	}

	return items;
}

export function buildKeywordMeta(table: RankExcelTable): KeywordMeta[] {
	const map = new Map<string, number | null>();
	for (const row of table.rows) {
		const meta = splitKeywordAndVolume(row.keyword);
		const keyword = meta.keyword;
		if (!keyword) continue;
		// 같은 키워드가 반복되면, 유효한 값이 있으면 우선 채움
		if (!map.has(keyword)) {
			map.set(keyword, meta.monthly_search_volume ?? null);
			continue;
		}
		const cur = map.get(keyword);
		if (cur == null && meta.monthly_search_volume != null) {
			map.set(keyword, meta.monthly_search_volume);
		}
	}
	return Array.from(map.entries()).map(([keyword, monthly_search_volume]) => ({ keyword, monthly_search_volume }));
}

/**
 * 공식 순위 엑셀(1행=날짜 헤더, 1열=키워드) 형태를 "표 그대로" 렌더링하기 위한 매트릭스 파서.
 *
 * 입력 예:
 * - 1행: ["", "01.11.(일)", "01.10.(토)", ...]
 * - 2행~: ["새치염색", "6위\n▲1", "9위\n▼2", ...]
 */
export function parseRankExcelMatrix(matrix: unknown[][]): RankExcelTable {
	const rows = Array.isArray(matrix) ? matrix : [];
	if (rows.length === 0) return { dates: [], rows: [] };

	const header = Array.isArray(rows[0]) ? rows[0] : [];
	const dates = header.slice(1).map(cellText).filter(Boolean);
	if (dates.length === 0) return { dates: [], rows: [] };

	const bodyRows: RankExcelTableRow[] = [];
	for (let r = 1; r < rows.length; r++) {
		const currentRow = rows[r];
		const row = Array.isArray(currentRow) ? currentRow : [];
		const keyword = cellText(row[0]);
		if (!keyword) continue;
		const cells = dates.map((_, i) => cellText(row[i + 1]));
		bodyRows.push({ keyword, cells });
	}
	return { dates, rows: bodyRows };
}

export async function parseRankExcelFile(file: File): Promise<RankExcelTable> {
	if (!file) throw new Error('파일이 없습니다.');
	const name = String(file.name || '').toLowerCase();
	if (!name.endsWith('.xlsx')) {
		throw new Error('xlsx 파일만 업로드할 수 있습니다.');
	}

	const buf = await file.arrayBuffer();
	const XLSX = await import('xlsx');

	const wb = XLSX.read(buf, { type: 'array' });
	const sheetName = wb.SheetNames?.[0];
	if (!sheetName) throw new Error('시트를 찾을 수 없습니다.');
	const ws = wb.Sheets[sheetName];
	if (!ws) throw new Error('시트를 읽을 수 없습니다.');

	const matrix = XLSX.utils.sheet_to_json(ws, {
		header: 1,
		raw: false,
		blankrows: false,
	}) as unknown[][];

	return parseRankExcelMatrix(matrix);
}

export async function parseKeywordVolumeExcelFile(
	file: File,
): Promise<Array<{ keyword: string; monthly_search_volume: number | null }>> {
	if (!file) throw new Error('파일이 없습니다.');
	const name = String(file.name || '').toLowerCase();
	if (!name.endsWith('.xlsx')) {
		throw new Error('xlsx 파일만 업로드할 수 있습니다.');
	}
	const buf = await file.arrayBuffer();
	const XLSX = await import('xlsx');
	const wb = XLSX.read(buf, { type: 'array' });
	const sheetName = wb.SheetNames?.[0];
	if (!sheetName) throw new Error('시트를 찾을 수 없습니다.');
	const ws = wb.Sheets[sheetName];
	if (!ws) throw new Error('시트를 읽을 수 없습니다.');
	const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false }) as unknown[][];
	const rows = Array.isArray(matrix) ? matrix : [];
	if (rows.length === 0) return [];
	const out = new Map<string, number | null>();
	for (let r = 0; r < rows.length; r += 1) {
		const currentRow = rows[r];
		const row = Array.isArray(currentRow) ? currentRow : [];
		const c0 = cellText(row[0]);
		const c1 = cellText(row[1]);
		if (!c0) continue;
		// header skip
		if (r === 0 && /키워드|keyword/i.test(c0)) continue;
		const kw = String(c0).trim();
		if (!kw) continue;
		const volCandidate = c1 ? `${kw} ${c1}` : kw;
		const meta = splitKeywordAndVolume(volCandidate);
		out.set(kw, meta.monthly_search_volume ?? null);
	}
	return Array.from(out.entries()).map(([keyword, monthly_search_volume]) => ({ keyword, monthly_search_volume }));
}