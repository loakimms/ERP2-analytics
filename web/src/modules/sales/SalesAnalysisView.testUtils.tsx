import React from 'react';
import { beforeEach, vi } from 'vitest';
import { act, render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
			post: vi.fn(),
		},
	};
});

export const mockedAxios = axios as any;

export function mockSalesAnalysisApi(): void {
	mockedAxios.get.mockImplementation((url: string) => {
		const u = String(url || '');
		if (u.includes('/sales/dashboard')) {
			return Promise.resolve({
				data: {
					ok: true,
					from: '2026-03-01',
					to: '2026-03-14',
					source_used: 'commerce_orders',
					totals: { amount: 10000, order_count: 1, quantity: 1, refund_amount: 0 },
					daily: [{ date: '2026-03-14', amount: 10000, order_count: 1, quantity: 1, product_count: 1, refund_amount: 0 }],
					products: [{ product_id: 1, product_name: '테스트 상품', amount: 10000, order_count: 1, quantity: 1 }],
					categories: [],
				},
			});
		}
		if (u.includes('/sales/coverage')) {
			return Promise.resolve({
				data: {
					ok: true,
					from: '2026-03-01',
					to: '2026-03-14',
					source_used: 'commerce_orders',
					raw_days_count: 2,
					aggregate_days_count: 1,
					missing_days: ['2026-03-13'],
					failed_days: ['2026-03-12'],
					raw_only_days: ['2026-03-11'],
					pending_empty_days: ['2026-03-10'],
					confirmed_empty_days: ['2026-03-09'],
					items: [
						{
							date: '2026-03-12',
							raw_count: 0,
							aggregate_count: 0,
							job_status: 'FAILED',
							coverage_status: 'failed',
							failure_reason: 'GW.IP_NOT_ALLOWED',
						},
						{
							date: '2026-03-11',
							raw_count: 1,
							aggregate_count: 0,
							job_status: 'SUCCESS',
							coverage_status: 'raw_only',
						},
						{
							date: '2026-03-10',
							raw_count: 0,
							aggregate_count: 0,
							job_status: 'SUCCESS',
							coverage_status: 'pending_empty',
							direct_order_checked: true,
							direct_order_supported: true,
							direct_order_candidate_count: 0,
						},
					],
				},
			});
		}
		return Promise.resolve({ data: [] });
	});
	mockedAxios.post.mockResolvedValue({ data: {} });
}

export async function renderSalesAnalysisView(view: React.ReactElement): Promise<RenderResult> {
	let rendered!: RenderResult;
	await act(async () => {
		rendered = render(<MemoryRouter>{view}</MemoryRouter>);
		await Promise.resolve();
		await Promise.resolve();
	});
	return rendered;
}

export function registerSalesAnalysisTestLifecycle(): void {
	beforeEach(() => {
		mockedAxios.get.mockReset();
		mockedAxios.post.mockReset();
	});
}
