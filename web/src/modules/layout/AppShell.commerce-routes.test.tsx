import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flushReactEffects, mockedAxios, registerAppShellTestLifecycle, renderAppShell } from './AppShell.testUtils';

registerAppShellTestLifecycle();

describe('AppShell commerce routes', () => {
	it('메뉴2(키워드 분석) - 구매 키워드 분석 경로에서는 구매 키워드 분석 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
			if (String(url).includes('/purchase/keywords/dashboard')) {
				return Promise.resolve({ data: { ok: true, from: '2026-01-01', to: '2026-01-01', totals: { amount: 0, payments: 0 }, products: [] } });
			}
			if (String(url).includes('/purchase/keywords/daily')) return Promise.resolve({ data: [] });
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/performance/purchase-keywords');
		await flushReactEffects();

		expect((await screen.findAllByText('구매 키워드 분석')).length).toBeGreaterThan(0);
	});

	it('판매 분석 경로에서는 판매 분석 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
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
			if (String(url).includes('/sales/coverage')) {
				return Promise.resolve({
					data: {
						ok: true,
						from: '2026-01-01',
						to: '2026-01-01',
						source_used: 'commerce_orders',
						aggregate_days_count: 1,
						raw_days_count: 1,
						failed_days: [],
						missing_days: [],
						raw_only_days: [],
						pending_empty_days: [],
						confirmed_empty_days: [],
						items: [],
					},
				});
			}
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/sales/dashboard');
		await flushReactEffects();

		expect((await screen.findAllByText('판매 분석')).length).toBeGreaterThan(0);
	});

	it('판매 분석 상품 상세 경로에서는 상품 상세 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
			if (String(url).includes('/sales/product/series')) {
				return Promise.resolve({
					data: {
						ok: true,
						product_id: 111,
						product_name: 'A',
						categories: { large: null, middle: null, small: null, detail: null },
						from: '2026-01-01',
						to: '2026-01-01',
						source_used: 'bizdata_product_detail',
						totals: { amount: 0, order_count: 0, quantity: 0 },
						points: [],
					},
				});
			}
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
			if (String(url).includes('/sales/coverage')) {
				return Promise.resolve({
					data: {
						ok: true,
						from: '2026-01-01',
						to: '2026-01-01',
						source_used: 'commerce_orders',
						aggregate_days_count: 1,
						raw_days_count: 1,
						failed_days: [],
						missing_days: [],
						raw_only_days: [],
						pending_empty_days: [],
						confirmed_empty_days: [],
						items: [],
					},
				});
			}
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/sales/product?product_id=111&from=2026-01-01&to=2026-01-01&source=bizdata_product_detail');
		await flushReactEffects();

		expect(await screen.findByText('상품 판매 상세', { selector: '.card-title' })).toBeTruthy();
	});
});
