import { describe, it, expect } from 'vitest';
import { parseRankExcelMatrix, normalizeDateLabelsToIso, extractRankFromCell, buildRankUploadItems, splitKeywordAndVolume, buildKeywordMeta } from './rankExcel';

describe('rankExcel.parseRankExcelMatrix', () => {
	it('첫 행(날짜 헤더) + 키워드 행을 표 데이터로 변환한다', () => {
		const matrix: unknown[][] = [
			['', '01.11.(일)', '01.10.(토)'],
			['새치염색', '6위\n▲1', '9위\n▼2'],
			['천연염색', '1위', '1위'],
		];

		const out = parseRankExcelMatrix(matrix);
		expect(out.dates).toEqual(['01.11.(일)', '01.10.(토)']);
		expect(out.rows).toHaveLength(2);
		expect(out.rows[0]).toEqual({ keyword: '새치염색', cells: ['6위\n▲1', '9위\n▼2'] });
		expect(out.rows[1]).toEqual({ keyword: '천연염색', cells: ['1위', '1위'] });
	});

	it('빈 키워드 행은 무시하고, 누락 셀은 빈 문자열로 채운다', () => {
		const matrix: unknown[][] = [
			['', '01.11.(일)', '01.10.(토)'],
			['', '6위', '9위'],
			['헤나', '1위'],
		];

		const out = parseRankExcelMatrix(matrix);
		expect(out.rows).toEqual([{ keyword: '헤나', cells: ['1위', ''] }]);
	});
});

describe('rankExcel.normalizeDateLabelsToIso', () => {
	it('연도 없는 MM.DD 헤더를 기준 연도에서 추정하고, 1월→12월 구간에서 연도를 1년 내린다', () => {
		const labels = ['01.11.(일)', '01.10.(토)', '12.31.(수)', '12.30.(화)'];
		// 기준일이 2026-01-11이라고 가정
		const iso = normalizeDateLabelsToIso(labels, new Date('2026-01-11T00:00:00Z'));
		expect(iso).toEqual(['2026-01-11', '2026-01-10', '2025-12-31', '2025-12-30']);
	});
});

describe('rankExcel.extractRankFromCell', () => {
	it('셀 텍스트에서 순위 숫자를 추출한다', () => {
		expect(extractRankFromCell('6위\n▲1')).toBe(6);
		expect(extractRankFromCell('10위 - 1P 3D')).toBe(10);
		expect(extractRankFromCell('순위 밖')).toBe(0);
		expect(extractRankFromCell('-')).toBe(0);
		expect(extractRankFromCell('')).toBe(null);
	});
});

describe('rankExcel.buildRankUploadItems', () => {
	it('테이블에서 (키워드, 일자, 순위) 업로드 아이템을 만든다', () => {
		const table = {
			dates: ['01.11.(일)', '01.10.(토)'],
			rows: [
				{ keyword: '새치염색\n10,630', cells: ['6위\n▲1', '9위\n▼2'] },
				{ keyword: '천연염색', cells: ['1위', '순위 밖'] },
				{ keyword: '헤나', cells: ['-', ''] },
			],
		};

		const items = buildRankUploadItems(table as any, new Date('2026-01-11T00:00:00Z'));
		expect(items).toEqual([
			{ keyword: '새치염색', date: '2026-01-11', rank: 6 },
			{ keyword: '새치염색', date: '2026-01-10', rank: 9 },
			{ keyword: '천연염색', date: '2026-01-11', rank: 1 },
			{ keyword: '천연염색', date: '2026-01-10', rank: 0 },
			{ keyword: '헤나', date: '2026-01-11', rank: 0 },
		]);
	});
});

describe('rankExcel.splitKeywordAndVolume', () => {
	it('키워드 셀에서 (키워드, 월간 검색량)을 분리한다', () => {
		expect(splitKeywordAndVolume('새치염색약\n10,630')).toEqual({ keyword: '새치염색약', monthly_search_volume: 10630 });
		expect(splitKeywordAndVolume('새치염색약10,630')).toEqual({ keyword: '새치염색약', monthly_search_volume: 10630 });
		expect(splitKeywordAndVolume('유기농헤나60')).toEqual({ keyword: '유기농헤나', monthly_search_volume: 60 });
		expect(splitKeywordAndVolume('천연헤나(700)')).toEqual({ keyword: '천연헤나', monthly_search_volume: 700 });
		expect(splitKeywordAndVolume('새치 (4,730)')).toEqual({ keyword: '새치', monthly_search_volume: 4730 });
		expect(splitKeywordAndVolume('천연염색')).toEqual({ keyword: '천연염색', monthly_search_volume: null });
	});
});

describe('rankExcel.buildKeywordMeta', () => {
	it('테이블에서 키워드별 검색량 메타 목록을 만든다', () => {
		const table = {
			dates: ['01.11.(일)'],
			rows: [
				{ keyword: '새치염색약\n10,630', cells: ['6위'] },
				{ keyword: '천연염색', cells: ['1위'] },
			],
		};
		const meta = buildKeywordMeta(table as any);
		expect(meta).toEqual([
			{ keyword: '새치염색약', monthly_search_volume: 10630 },
			{ keyword: '천연염색', monthly_search_volume: null },
		]);
	});
});

