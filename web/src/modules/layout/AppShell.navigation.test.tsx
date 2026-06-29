import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppShell } from './AppShell';
import { clickWithAct, flushReactEffects, mockedAxios, registerAppShellTestLifecycle, renderAppShell } from './AppShell.testUtils';

registerAppShellTestLifecycle();

describe('AppShell navigation', () => {
	function LocationProbe(props: { onChange: (pathname: string) => void }): null {
		const location = useLocation();
		props.onChange(location.pathname);
		return null;
	}

	it('좌측 메뉴에서 판매 분석은 SEO 분석보다 먼저 보인다', async () => {
		const axiosAny = mockedAxios;
		(axiosAny.post as any).mockResolvedValue({ data: {} });
		(axiosAny.get as any).mockResolvedValue({ data: [] });

		await renderAppShell('/analytics/rank/tracking');
		await flushReactEffects();

		const toggles = screen.getAllByTestId(/^sidebar-group-toggle-/);
		const labels = toggles.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
		const salesIndex = labels.findIndex((label) => label.startsWith('판매 분석'));
		const researchIndex = labels.findIndex((label) => label.startsWith('SEO 분석'));
		expect(salesIndex).toBeGreaterThanOrEqual(0);
		expect(researchIndex).toBeGreaterThanOrEqual(0);
		expect(salesIndex).toBeLessThan(researchIndex);
	});

	it('좌측 메뉴는 아코디언처럼 접혀 있다가 상위 메뉴를 누르면 해당 서브 메뉴만 펼쳐진다', async () => {
		const axiosAny = mockedAxios;
		(axiosAny.post as any).mockResolvedValue({ data: {} });
		(axiosAny.get as any).mockImplementation((url: string) => {
			if (String(url).includes('/search-rank/tracked')) return Promise.resolve({ data: [] });
			if (String(url).includes('/sales/dashboard')) {
				return Promise.resolve({
					data: {
						ok: true,
						from: '2026-01-01',
						to: '2026-01-01',
						source_used: 'bizdata_product_detail',
						totals: { amount: 0, order_count: 0, quantity: 0 },
						daily: [],
						products: [],
					},
				});
			}
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/rank/tracking');
		await flushReactEffects();

		expect(screen.getByRole('button', { name: '키워드 인사이트' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '상품별 판매 현황' })).toBeNull();

		await clickWithAct(screen.getByTestId('sidebar-group-toggle-menu7-sales'));
		await flushReactEffects();

		expect(screen.getByRole('button', { name: '상품별 판매 현황' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '키워드 인사이트' })).toBeNull();
	});

	it('AI 운영 센터 경로에서는 서브메뉴가 상황판/판단/실행/검증/정책 학습 그룹으로 묶여 보인다', async () => {
		const axiosAny = mockedAxios;
		(axiosAny.post as any).mockResolvedValue({ data: {} });
		(axiosAny.get as any).mockResolvedValue({ data: { ok: true, items: [] } });

		await renderAppShell('/analytics/ai/home');
		await flushReactEffects();

		expect(screen.getByTestId('sidebar-subgroup-menu1-dashboard-situation')).toHaveTextContent('상황판');
		expect(screen.getByTestId('sidebar-subgroup-menu1-dashboard-analysis')).toHaveTextContent('판단 생성');
		expect(screen.getByTestId('sidebar-subgroup-menu1-dashboard-execution')).toHaveTextContent('실행');
		expect(screen.getByTestId('sidebar-subgroup-menu1-dashboard-verification')).toHaveTextContent('검증');
		expect(screen.getByTestId('sidebar-subgroup-menu1-dashboard-policy')).toHaveTextContent('정책 학습');
		expect(screen.getByRole('button', { name: '오늘의 실행' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '상품별 운영 판단' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '실행 큐' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '검증/설명 로그' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'SKU 정책 센터' })).toBeTruthy();
	});

	it('리뷰 Q&A 관리 경로에서는 리뷰 관리 canonical path와 4개 서브메뉴를 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		const getMock = axiosAny.get as any;
		(axiosAny.post as any).mockResolvedValue({ data: {} });
		getMock.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/reviews/summary')) {
				return Promise.resolve({
					data: {
						ok: true,
						settings: {
							commerce_api_configured: true,
							shopping_openapi_configured: true,
						},
						review_daily: {
							total_rows: 0,
							min_date: null,
							max_date: null,
							latest_items: [],
						},
						current_runtime: {
							ui_review_source: 'page_metrics_html',
							official_review_api_verified: false,
							shopping_openapi_has_review_fields: false,
							review_daily_pipeline_connected: true,
						},
					},
				});
			}
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/reviews/review-management');
		await flushReactEffects();

		expect(await screen.findByRole('button', { name: '리뷰 관리' })).toBeTruthy();
		expect(screen.getByTestId('sidebar-group-toggle-menu8-review-qa')).toBeTruthy();
		expect(screen.getByRole('button', { name: '리뷰 분석' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Q&A 관리' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Q&A 분석' })).toBeTruthy();
	});

	it('legacy 리뷰 관리 경로는 review-management canonical path로 redirect된다', async () => {
		const axiosAny = mockedAxios;
		const getMock = axiosAny.get as any;
		const seenPathnames: string[] = [];
		(axiosAny.post as any).mockResolvedValue({ data: {} });
		getMock.mockImplementation((url: string) => {
			if (String(url).includes('/reviews/summary')) {
				return Promise.resolve({
					data: {
						ok: true,
						settings: {
							commerce_api_configured: true,
							shopping_openapi_configured: true,
						},
						review_daily: {
							total_rows: 0,
							min_date: null,
							max_date: null,
							latest_items: [],
						},
						current_runtime: {
							ui_review_source: 'page_metrics_html',
							official_review_api_verified: false,
							shopping_openapi_has_review_fields: false,
							review_daily_pipeline_connected: true,
						},
					},
				});
			}
			return Promise.resolve({ data: [] });
		});

		render(
			<MemoryRouter initialEntries={['/analytics/reviews/analysis']}>
				<LocationProbe onChange={(pathname) => seenPathnames.push(pathname)} />
				<AppShell />
			</MemoryRouter>,
		);
		await flushReactEffects();

		expect(await screen.findByRole('button', { name: '리뷰 관리' })).toBeTruthy();
		expect(seenPathnames).toContain('/analytics/reviews/analysis');
		expect(seenPathnames).toContain('/analytics/reviews/review-management');
		expect(seenPathnames[seenPathnames.length - 1]).toBe('/analytics/reviews/review-management');
	});

	it('리뷰 Q&A 분석 경로에서는 Q&A 분석 화면을 렌더링한다', async () => {
		await renderAppShell('/analytics/reviews/qna-analysis');
		await flushReactEffects();

		expect(await screen.findByRole('button', { name: '리뷰 관리' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '리뷰 분석' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Q&A 관리' })).toBeTruthy();
	});

	it('내 상품 추적(리스트) 진입 시 자동 동기화 없이 /search-rank/tracked만 먼저 호출한다', async () => {
		const axiosAny = mockedAxios;
		const getMock = axiosAny.get as any;
		const postMock = axiosAny.post as any;

		postMock.mockResolvedValue({ data: {} });
		getMock.mockImplementation((url: string, config?: any) => {
			if (String(url).includes('/search-rank/tracked')) return Promise.resolve({ data: [] });
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/rank/tracking');

		await vi.waitFor(() => {
			const calls = getMock.mock.calls.map((c: any[]) => ({ url: String(c[0] || ''), cfg: c[1] }));
			const call = calls.find((c: any) => c.url.includes('/search-rank/tracked'));
			expect(call).toBeTruthy();
			expect(call!.cfg?.params?.include_today_rank).toBe(1);
		});

		const postCalls = postMock.mock.calls.map((c: any[]) => String(c[0] || ''));
		expect(postCalls.some((u: string) => u.includes('/search-rank/fetch-today'))).toBe(false);
		expect(postCalls.some((u: string) => u.includes('/search-rank/refresh-product-metadata'))).toBe(false);
	});
});
