import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	flushKeywordInsightsEffects,
	mockedAxios,
	registerKeywordInsightsTestLifecycle,
	renderKeywordInsightsView,
} from './KeywordInsightsView.testUtils';
import { KeywordInsightsView } from './KeywordInsightsView';

describe('KeywordInsightsView category behavior', () => {
	registerKeywordInsightsTestLifecycle();

	it('고급 설정(캡차/CDP) UI는 제거되고, 카테고리 검색으로 선택한 ID가 조회 파라미터에 반영된다', async () => {
		mockedAxios.get.mockImplementation((url: string, cfg: any) => {
			const u = String(url || '');
			if (u.includes('/seo/category-dictionary')) {
				return Promise.resolve({
					data: {
						items: [
							{ id: '50000002', path: '화장품/미용>헤어스타일링>염색약', saved_at: '2026-01-01T00:00:00.000Z', source_filename: 'category_a.csv' },
							{ id: '50000004', path: '가구/인테리어>DIY자재/용품>바닥재>장판', saved_at: '2026-01-02T00:00:00.000Z', source_filename: 'category_b.csv' },
						],
						total: 2,
						latest_upload: null,
					},
				});
			}
			if (u.includes('/research/keyword-insights')) {
				return Promise.resolve({
					data: {
						keyword: '헤나',
						date_from: '2026-01-01',
						date_to: '2026-01-02',
						cached: false,
						searchedAt: '2026-01-24T00:41:42.784Z',
						keywordSummary: null,
						trend: { points: [], estimatedDailySearches: null },
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						shopping: { category: cfg?.params?.shopping_category ?? null, productCount: 0, categoryPath: null },
						relatedKeywords: [],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderKeywordInsightsView(<KeywordInsightsView apiBaseUrl="http://localhost:5189" />);

		expect(screen.queryByRole('button', { name: /고급 설정/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /쇼핑 세션 열기/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /CDP/i })).toBeNull();

		await clickWithAct(screen.getByRole('button', { name: '카테고리 검색' }));
		await changeWithAct(screen.getByLabelText('카테고리 검색어'), { target: { value: '염색' } });
		await clickWithAct(await screen.findByRole('button', { name: /50000002/i }));

		await clickWithAct(screen.getByRole('button', { name: '조회' }));
		await flushKeywordInsightsEffects();
		expect(mockedAxios.get).toHaveBeenCalledWith('http://localhost:5189/research/keyword-insights', expect.anything());
		const lastCall = mockedAxios.get.mock.calls.find((c: any[]) => String(c?.[0] || '').includes('/research/keyword-insights'));
		expect(lastCall?.[1]?.params?.shopping_category).toBe('50000002');
	});

	it('URL query로 받은 키워드와 기간을 초기값으로 복원하고 자동 조회한다', async () => {
		mockedAxios.get.mockImplementation((url: string, cfg: any) => {
			const u = String(url || '');
			if (!u.includes('/research/keyword-insights')) return Promise.resolve({ data: {} });
			return Promise.resolve({
				data: {
					keyword: String(cfg?.params?.keyword || ''),
					date_from: String(cfg?.params?.date_from || ''),
					date_to: String(cfg?.params?.date_to || ''),
					cached: false,
					searchedAt: '2026-04-12T00:00:00.000Z',
					keywordSummary: {
						pcSearch: 100,
						mobileSearch: 200,
						totalSearch: 300,
						productCount: 10,
						posts: 5,
						pcCtr: 1.1,
						mobileCtr: 1.2,
						avgCtr: 1.15,
						searchedAt: '2026-04-12T00:00:00.000Z',
					},
					trend: { points: [], estimatedDailySearches: null },
					distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
					shopping: { category: null, productCount: 10, categoryPath: null },
					relatedKeywords: [],
				},
			});
		});

		await renderKeywordInsightsView(
			<KeywordInsightsView apiBaseUrl="http://localhost:5189" />,
			['/analytics/rank/insights?keyword=%ED%97%A4%EC%96%B4%EC%97%90%EC%84%BC%EC%8A%A4&from_date=2026-03-01&to_date=2026-03-30&auto_run=1'],
		);

		expect(screen.getByLabelText('키워드 1')).toHaveValue('헤어에센스');
		expect(screen.getByLabelText('시작일')).toHaveValue('2026-03-01');
		expect(screen.getByLabelText('종료일')).toHaveValue('2026-03-30');

		const lastCall = mockedAxios.get.mock.calls.find((c: any[]) => String(c?.[0] || '').includes('/research/keyword-insights'));
		expect(lastCall?.[1]?.params?.keyword).toBe('헤어에센스');
		expect(lastCall?.[1]?.params?.date_from).toBe('2026-03-01');
		expect(lastCall?.[1]?.params?.date_to).toBe('2026-03-30');
	});

	it('키워드가 서로 다른 카테고리로 응답되면, 불일치 키워드는 빨간색으로 표시되고 집계에서 제외된다', async () => {
		mockedAxios.get.mockImplementation((url: string, cfg: any) => {
			const u = String(url || '');
			if (!u.includes('/research/keyword-insights')) return Promise.resolve({ data: {} });
			const kw = String(cfg?.params?.keyword || '');
			if (kw === '헤나') {
				return Promise.resolve({
					data: {
						keyword: '헤나',
						date_from: '2026-01-01',
						date_to: '2026-01-02',
						cached: false,
						searchedAt: '2026-01-24T00:41:42.784Z',
						keywordSummary: {
							pcSearch: 1000,
							mobileSearch: 2000,
							totalSearch: 3000,
							productCount: 10,
							posts: 7,
							pcCtr: 0.1,
							mobileCtr: 0.2,
							avgCtr: 0.15,
							searchedAt: '2026-01-24T00:41:42.784Z',
						},
						trend: { points: [], estimatedDailySearches: null },
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						shopping: { category: '50000002', productCount: 0, categoryPath: '화장품/미용>...' },
						relatedKeywords: [],
					},
				});
			}
			if (kw === '장판') {
				return Promise.resolve({
					data: {
						keyword: '장판',
						date_from: '2026-01-01',
						date_to: '2026-01-02',
						cached: false,
						searchedAt: '2026-01-24T00:41:42.784Z',
						keywordSummary: {
							pcSearch: 9999,
							mobileSearch: 9999,
							totalSearch: 9999,
							productCount: 9999,
							posts: 9999,
							pcCtr: 0.99,
							mobileCtr: 0.99,
							avgCtr: 0.99,
							searchedAt: '2026-01-24T00:41:42.784Z',
						},
						trend: { points: [], estimatedDailySearches: null },
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						shopping: { category: '50000004', productCount: 0, categoryPath: '가구/인테리어>...' },
						relatedKeywords: [],
					},
				});
			}
			return Promise.resolve({
				data: {
					keyword: kw,
					date_from: '2026-01-01',
					date_to: '2026-01-02',
					cached: false,
					searchedAt: '2026-01-24T00:41:42.784Z',
					keywordSummary: null,
					trend: { points: [], estimatedDailySearches: null },
					distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
					shopping: { category: null, productCount: 0, categoryPath: null },
					relatedKeywords: [],
				},
			});
		});

		await renderKeywordInsightsView(<KeywordInsightsView apiBaseUrl="http://localhost:5189" />);

		await clickWithAct(screen.getByRole('button', { name: '키워드 추가' }));
		await changeWithAct(screen.getByLabelText('키워드 1'), { target: { value: '헤나' } });
		await changeWithAct(screen.getByLabelText('키워드 2'), { target: { value: '장판' } });

		await clickWithAct(screen.getByRole('button', { name: '조회' }));
		await flushKeywordInsightsEffects();

		expect(await screen.findByText('장판 (제외)')).toBeTruthy();
		expect(await screen.findByText('1,000')).toBeTruthy();
		expect(screen.queryByText('9,999')).toBeNull();
	});

	it('조회 완료 후 키워드 입력란은 잠기고, 키워드 뱃지 클릭으로 포함/제외가 즉시 재집계된다', async () => {
		mockedAxios.get.mockImplementation((url: string, cfg: any) => {
			const u = String(url || '');
			if (!u.includes('/research/keyword-insights')) return Promise.resolve({ data: {} });
			const kw = String(cfg?.params?.keyword || '');
			if (kw === '헤나') {
				return Promise.resolve({
					data: {
						keyword: '헤나',
						date_from: '2026-01-01',
						date_to: '2026-01-02',
						cached: false,
						searchedAt: '2026-01-24T00:41:42.784Z',
						keywordSummary: {
							pcSearch: 1000,
							mobileSearch: 0,
							totalSearch: 1000,
							productCount: 0,
							posts: 0,
							pcCtr: null,
							mobileCtr: null,
							avgCtr: null,
							searchedAt: '2026-01-24T00:41:42.784Z',
						},
						trend: { points: [], estimatedDailySearches: null },
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						shopping: { category: '50000002', productCount: 0, categoryPath: '화장품/미용>...' },
						relatedKeywords: [],
					},
				});
			}
			if (kw === '헤어에센스') {
				return Promise.resolve({
					data: {
						keyword: '헤어에센스',
						date_from: '2026-01-01',
						date_to: '2026-01-02',
						cached: false,
						searchedAt: '2026-01-24T00:41:42.784Z',
						keywordSummary: {
							pcSearch: 500,
							mobileSearch: 0,
							totalSearch: 500,
							productCount: 0,
							posts: 0,
							pcCtr: null,
							mobileCtr: null,
							avgCtr: null,
							searchedAt: '2026-01-24T00:41:42.784Z',
						},
						trend: { points: [], estimatedDailySearches: null },
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						shopping: { category: '50000002', productCount: 0, categoryPath: '화장품/미용>...' },
						relatedKeywords: [],
					},
				});
			}
			return Promise.resolve({
				data: {
					keyword: kw,
					date_from: '2026-01-01',
					date_to: '2026-01-02',
					cached: false,
					searchedAt: '2026-01-24T00:41:42.784Z',
					keywordSummary: null,
					trend: { points: [], estimatedDailySearches: null },
					distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
					shopping: { category: null, productCount: 0, categoryPath: null },
					relatedKeywords: [],
				},
			});
		});

		await renderKeywordInsightsView(<KeywordInsightsView apiBaseUrl="http://localhost:5189" />);

		await clickWithAct(screen.getByRole('button', { name: '키워드 추가' }));
		await changeWithAct(screen.getByLabelText('키워드 1'), { target: { value: '헤나' } });
		await changeWithAct(screen.getByLabelText('키워드 2'), { target: { value: '헤어에센스' } });

		await clickWithAct(screen.getByRole('button', { name: '조회' }));
		await flushKeywordInsightsEffects();

		await vi.waitFor(() => {
			const kw1 = screen.getByLabelText('키워드 1') as HTMLInputElement;
			expect(kw1.disabled).toBe(true);
		});

		expect((await screen.findAllByText('1,500')).length).toBeGreaterThan(0);

		await clickWithAct(screen.getByRole('button', { name: /헤어에센스/i }));
		await vi.waitFor(() => {
			expect(screen.getAllByText('1,000').length).toBeGreaterThan(0);
		});

		await clickWithAct(screen.getByRole('button', { name: /헤어에센스/i }));
		await vi.waitFor(() => {
			expect(screen.getAllByText('1,500').length).toBeGreaterThan(0);
		});
	});
});
