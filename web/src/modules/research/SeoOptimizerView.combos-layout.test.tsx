import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	mockedAxios,
	registerSeoOptimizerTestLifecycle,
	renderSeoOptimizerView,
	runSeoAnalysis,
} from './SeoOptimizerView.testUtils';
import { SeoOptimizerView } from './SeoOptimizerView';

describe('SeoOptimizerView combos/layout', () => {
	registerSeoOptimizerTestLifecycle();

	it('추천 조합(템플릿 고정): 4슬롯 선택 UI가 존재한다', async () => {
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
					{ keyword: '염색약', titleFreq: 10, totalSearchQcCnt: 10000, compIdx: '높음', avgCtr: 2.0 },
					{ keyword: '구매', titleFreq: 1, totalSearchQcCnt: 5000, compIdx: '중간', avgCtr: 1.0 },
					{ keyword: '저자극', titleFreq: 1, totalSearchQcCnt: 3000, compIdx: '낮음', avgCtr: 1.0 },
					{ keyword: '크림', titleFreq: 1, totalSearchQcCnt: 2000, compIdx: '낮음', avgCtr: 1.0 },
				],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis({ productType: '크림' });

		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		expect(screen.getByText('추천 조합(템플릿 고정)')).toBeTruthy();
		expect(screen.getByLabelText('메인 단일 키워드(1)')).toBeTruthy();
		expect(screen.getByLabelText('구매의도 키워드(1)')).toBeTruthy();
		expect(screen.getByLabelText('구매의도 키워드(2)')).toBeTruthy();
		expect(screen.getByLabelText('안전/차별 키워드(1)')).toBeTruthy();
		expect(screen.getByLabelText('안전/차별 키워드(2)')).toBeTruthy();
		expect(screen.getByLabelText('형태 키워드(1)')).toBeTruthy();

		const formSelect = screen.getByLabelText('형태 키워드(1)') as HTMLSelectElement;
		const options = Array.from(formSelect.querySelectorAll('option')).map((o) => o.textContent || '');
		expect(options.join('|')).toContain('크림');
	});

	it('조합 시뮬레이션은 후보 키워드 표보다 위에 렌더링된다', async () => {
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
				candidates: [{ keyword: '염색약', titleFreq: 25, totalSearchQcCnt: 47910, compIdx: '높음', avgCtr: 2.14 }],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();
		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		const simTitle = screen.getByText(/조합 시뮬레이션\(상품명 \+ 선택 키워드\)/);
		const simBox = simTitle.closest('.seo-sim-box') as HTMLElement | null;
		expect(simBox).toBeTruthy();

		const table = document.querySelector('table.table') as HTMLElement | null;
		expect(table).toBeTruthy();

		const pos = (simBox as HTMLElement).compareDocumentPosition(table as HTMLElement);
		expect(Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
	});

	it('후보 키워드 표 접기/펼치기 토글이 동작한다', async () => {
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
				candidates: [{ keyword: '염색약', titleFreq: 25, totalSearchQcCnt: 47910, compIdx: '높음', avgCtr: 2.14 }],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();
		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		expect(document.querySelector('table.table')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: /후보 키워드 표 접기/ }));
		await waitFor(() => {
			expect(document.querySelector('table.table')).toBeNull();
		});

		await clickWithAct(screen.getByRole('button', { name: /후보 키워드 표 펼치기/ }));
		await waitFor(() => {
			expect(document.querySelector('table.table')).toBeTruthy();
		});
	});

	it('후보 키워드 입력 필터 영역은 스크롤 없이 한 행(가로 1줄)로 구성된다', async () => {
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
				candidates: [{ keyword: '염색약', titleFreq: 25, totalSearchQcCnt: 47910, compIdx: '높음', avgCtr: 2.14 }],
				recommendedCombos: [],
				constraints: { maxTokensTotal: 8 },
			},
		});

		await renderSeoOptimizerView(<SeoOptimizerView apiBaseUrl="http://localhost:5189" />);
		await runSeoAnalysis();
		await waitFor(() => expect(mockedAxios.post).toHaveBeenCalled());

		const filters = screen.getByTestId('cand-filters');
		expect(filters).toBeTruthy();
		expect((filters as HTMLElement).style.display).toBe('flex');
		expect((filters as HTMLElement).style.flexWrap).toBe('nowrap');
	});

	it('추천 조합(템플릿 고정)에서 저장을 누르면 저장된 조합 리스트(최종 검토)가 노출되고 항목이 추가된다', async () => {
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
		const row = Array.from((table as HTMLElement).querySelectorAll('tbody tr')).find((tr) => (tr.textContent || '').includes('염색약')) as HTMLElement | undefined;
		expect(row).toBeTruthy();
		const tokenCb = (row as HTMLElement).querySelector('td:nth-child(2) input[type="checkbox"]') as HTMLInputElement | null;
		expect(tokenCb).toBeTruthy();
		await clickWithAct(tokenCb as HTMLInputElement);

		await waitFor(() => {
			expect(screen.getByText('추천 조합(템플릿 고정)')).toBeTruthy();
		});
		const saveBtn = screen.getByRole('button', { name: /조합 저장/ });
		await clickWithAct(saveBtn);

		await waitFor(() => {
			const saved = screen.getByTestId('saved-combos');
			expect(saved).toBeTruthy();
			expect(saved.textContent || '').toContain('저장된 조합');
			expect(saved.textContent || '').toContain('수자타');
		});
	});
});
