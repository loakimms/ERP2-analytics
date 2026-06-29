import { splitKeywordAndVolume } from './rankExcel';

function cellText(v: unknown): string {
	if (v == null) return '';
	if (typeof v === 'string') return v.trim();
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	return String(v).trim();
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
		if (r === 0 && /키워드|keyword/i.test(c0)) continue;

		const kw = String(c0).trim();
		if (!kw) continue;

		const volCandidate = c1 ? `${kw} ${c1}` : kw;
		const meta = splitKeywordAndVolume(volCandidate);
		out.set(kw, meta.monthly_search_volume ?? null);
	}

	return Array.from(out.entries()).map(([keyword, monthly_search_volume]) => ({ keyword, monthly_search_volume }));
}

