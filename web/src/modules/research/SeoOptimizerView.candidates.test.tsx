import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	mockedAxios,
	registerSeoOptimizerTestLifecycle,
	renderSeoOptimizerView,
	runSeoAnalysis,
} from './SeoOptimizerView.testUtils';
import { SeoOptimizerView } from './SeoOptimizerView';

describe('SeoOptimizerView candidates', () => {
	registerSeoOptimizerTestLifecycle();

	it('카테고리 미선택 상태에서 분석 실행을 눌러도 결과/리스트가 렌더링되지 않는다', async () => {
		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await changeWithAct(screen.getByLabelText('상품명(prefix)'), { target: { value: '수자타 헤나' } });
		await changeWithAct(screen.getByLabelText('메인 키워드'), { target: { value: '헤나' } });
		await clickWithAct(screen.getByRole('button', { name: '분석 실행' }));

		await waitFor(() => {
			expect((screen.getByText(/상세 카테고리를 선택하세요/).textContent || '')).toContain('상세 카테고리');
		});
		expect(mockedAxios.post).not.toHaveBeenCalled();
		expect(screen.queryByText('쇼핑 Top 상품명(최대 40)')).toBeNull();
		expect(document.querySelector('table.table')).toBeNull();
	});

	it('후보 키워드 표에 필터(포함 검색/범위) 입력이 있고, 필터 적용 시 행이 줄어든다', async () => {
		mockedAxios.post.mockResolvedValueOnce({
			data: {
				productName: '수자타 헤나',
				category: { id: '50000000', path: 'A>B>C' },
				mainKeyword: '헤나',
				dateFrom: '2025-12-01',
				dateTo: '2025-12-30',
				shopping: { needsCaptcha: false, titles: [] },
				titleTokens: [
					{ token: '천연', freq: 10 },
					{ token: '헤나', freq: 10 },
					{ token: '염색약', freq: 10 },
				],
				searchAd: { related: [] },
				candidates: [
					{ keyword: '염색약', titleFreq: 25, totalSearchQcCnt: 47910, compIdx: '높음', avgCtr: 2.14 },
					{ keyword: '천연헤나염색약', titleFreq: 1, totalSearchQcCnt: 4330, compIdx: '높음', avgCtr: 3.16 },
					{ keyword: '흰머리', titleFreq: 3, totalSearchQcCnt: 3400, compIdx: '높음', avgCtr: 18.93 },
				],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();

		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		expect(screen.getByLabelText('후보 필터: 포함 검색')).toBeTruthy();
		expect(screen.getByLabelText('후보 필터: 최소 검색량')).toBeTruthy();
		expect(screen.getByLabelText('후보 필터: 최소 CTR(%)')).toBeTruthy();

		await changeWithAct(screen.getByLabelText('후보 필터: 최소 검색량'), { target: { value: '10000' } });

		await waitFor(() => {
			expect(screen.queryByText('천연헤나염색약')).toBeNull();
			expect(screen.queryByText('흰머리')).toBeNull();

			const bodyRows = document.querySelectorAll('tbody tr');
			expect(bodyRows.length).toBe(1);
			expect(bodyRows[0]!.textContent || '').toContain('염색약');
		});
	});

	it('선택 키워드만 표시: 토글 ON 시 체크된 토큰이 포함된 후보 행만 남는다', async () => {
		mockedAxios.post.mockResolvedValueOnce({
			data: {
				productName: '수자타 헤나',
				category: { id: '50000000', path: 'A>B>C' },
				mainKeyword: '헤나',
				dateFrom: '2025-12-01',
				dateTo: '2025-12-30',
				shopping: { needsCaptcha: false, titles: [] },
				titleTokens: [{ token: '천연', freq: 10 }],
				searchAd: { related: [] },
				candidates: [
					{ keyword: '염색약', titleFreq: 25, totalSearchQcCnt: 47910, compIdx: '높음', avgCtr: 2.14 },
					{ keyword: '흰머리', titleFreq: 3, totalSearchQcCnt: 3400, compIdx: '높음', avgCtr: 18.93 },
				],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();
		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		const table = document.querySelector('table.table') as HTMLElement | null;
		expect(table).toBeTruthy();

		const findRow = () =>
			Array.from((table as HTMLElement).querySelectorAll('tbody tr')).find((tr) => (tr.textContent || '').includes('염색약')) as
				| HTMLElement
				| undefined;
		const row = findRow();
		expect(row).toBeTruthy();
		const tokenCb = (row as HTMLElement).querySelector('td:nth-child(2) input[type="checkbox"]') as HTMLInputElement | null;
		expect(tokenCb).toBeTruthy();
		expect((tokenCb as HTMLInputElement).disabled).toBe(false);
		await clickWithAct(tokenCb as HTMLInputElement);

		await waitFor(() => {
			const row2 = findRow()!;
			const cb2 = row2.querySelector('td:nth-child(2) input[type="checkbox"]') as HTMLInputElement;
			expect(cb2.checked).toBe(true);
		});

		await clickWithAct(screen.getByRole('button', { name: /선택 키워드만 표시/ }));
		await waitFor(() => {
			const btn = screen.getByRole('button', { name: /선택 키워드만 표시/ });
			expect((btn.textContent || '').toUpperCase()).toContain('ON');
		});

		await waitFor(() => {
			const tableEl = document.querySelector('table.table') as HTMLElement | null;
			expect(tableEl).toBeTruthy();
			const scope2 = within(tableEl as HTMLElement);
			expect(scope2.queryByText('흰머리')).toBeNull();

			const bodyRows = (tableEl as HTMLElement).querySelectorAll('tbody tr');
			expect(bodyRows.length).toBe(1);
			expect(bodyRows[0]!.textContent || '').toContain('염색약');
		});
	});

	it('후보 키워드 표 헤더 클릭으로 정렬(오름/내림차순)이 적용된다', async () => {
		mockedAxios.post.mockResolvedValueOnce({
			data: {
				productName: '수자타 헤나',
				category: { id: '50000000', path: 'A>B>C' },
				mainKeyword: '헤나',
				dateFrom: '2025-12-01',
				dateTo: '2025-12-30',
				shopping: { needsCaptcha: false, titles: [] },
				titleTokens: [],
				searchAd: { related: [] },
				candidates: [
					{ keyword: 'A', titleFreq: 1, totalSearchQcCnt: 100, compIdx: '중간', avgCtr: 1.0 },
					{ keyword: 'B', titleFreq: 10, totalSearchQcCnt: 200, compIdx: '높음', avgCtr: 2.0 },
					{ keyword: 'C', titleFreq: 5, totalSearchQcCnt: 50, compIdx: '낮음', avgCtr: 3.0 },
				],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();
		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		const rowsBefore = Array.from(document.querySelectorAll('tbody tr')).map((tr) => (tr.textContent || '').trim());
		expect(rowsBefore.length).toBeGreaterThan(0);

		await clickWithAct(screen.getByRole('button', { name: /정렬: 빈도/ }));
		await waitFor(() => {
			const firstRow = document.querySelectorAll('tbody tr')[0]!;
			expect(firstRow.textContent || '').toContain('B');
		});

		await clickWithAct(screen.getByRole('button', { name: /정렬: 빈도/ }));
		await waitFor(() => {
			const firstRow = document.querySelectorAll('tbody tr')[0]!;
			expect(firstRow.textContent || '').toContain('A');
		});
	});

	it('SEO 규칙/카테고리 사전 안내 문구가 존재한다(편집 UI는 설정 메뉴로 이동)', async () => {
		mockedAxios.post.mockResolvedValueOnce({
			data: {
				productName: '수자타 헤나',
				category: { id: '50000000', path: 'A>B>C' },
				mainKeyword: '헤나',
				dateFrom: '2025-12-01',
				dateTo: '2025-12-30',
				shopping: { needsCaptcha: false, titles: [] },
				titleTokens: [],
				searchAd: { related: [] },
				candidates: [{ keyword: '무료배송', titleFreq: 1, totalSearchQcCnt: 1000, compIdx: '높음', avgCtr: 1.0 }],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();

		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		expect(screen.getByText('SEO 규칙/카테고리 사전')).toBeTruthy();
		expect(screen.getByText(/메뉴 6/)).toBeTruthy();
	});

	it('후보 확장: Top40 토큰과 SearchAd 연관검색어가 후보 표에 함께 포함된다(브랜드 제외 입력 포함)', async () => {
		mockedAxios.post.mockResolvedValueOnce({
			data: {
				productName: '수자타 헤나',
				category: { id: '50000000', path: 'A>B>C' },
				mainKeyword: '헤나',
				dateFrom: '2025-12-01',
				dateTo: '2025-12-30',
				shopping: { needsCaptcha: false, titles: [] },
				titleTokens: [{ token: '천연', freq: 10 }],
				searchAd: { related: [{ relKeyword: '헤나염색약', totalSearchQcCnt: 1234, compIdx: '높음', avgCtr: 1.2 }] },
				candidates: [{ keyword: '염색약', titleFreq: 25, totalSearchQcCnt: 47910, compIdx: '높음', avgCtr: 2.14 }],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();

		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		const table = document.querySelector('table.table') as HTMLElement | null;
		expect(table).toBeTruthy();
		const scope = within(table as HTMLElement);
		expect(scope.queryAllByText('천연').length).toBeGreaterThan(0);
		expect(scope.queryAllByText('헤나염색약').length).toBeGreaterThan(0);
		expect(screen.getByText('상품 기본 정보(키워드 생성 포함 여부)')).toBeTruthy();
		expect(screen.getByLabelText('브랜드명 제외(Top40/연관검색어 확장 시)')).toBeTruthy();
	});
});
