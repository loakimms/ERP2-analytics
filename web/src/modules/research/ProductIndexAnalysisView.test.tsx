import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { ProductIndexAnalysisView } from './ProductIndexAnalysisView';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn().mockResolvedValue({ data: {} }),
			post: vi.fn().mockResolvedValue({ data: {} }),
			put: vi.fn().mockResolvedValue({ data: {} }),
			// AdsViews 등에서 사용(에러 처리 경로 안전)
			isAxiosError: vi.fn(() => false),
		},
	};
});

describe('ProductIndexAnalysisView', () => {
	it('상품을 클릭하면 마지막 저장 분석이 표시되고, 재분석 시 Δ가 표시된다', async () => {
		const axiosAny = axios as any;
		const getMock = axiosAny.get as any;
		const postMock = axiosAny.post as any;

		getMock.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({
					data: [{ id: 1, product_url: 'https://smartstore.naver.com/test/products/1', keyword: 'K1', is_active: true }],
				});
			}
			if (u.includes('/search-rank/product-index-manual')) {
				return Promise.resolve({ data: { product_url: 'https://smartstore.naver.com/test/products/1' } });
			}
			if (u.includes('/search-rank/product-index/latest')) {
				return Promise.resolve({
					data: {
						product_url: 'https://smartstore.naver.com/test/products/1',
						date: '2026-01-26',
						title: '테스트 상품',
						image_url: null,
						scores: { click: 10, sales: 10, review: 10, recency: 10, penalty: 0, final: 10 },
						deltas: { click: null, sales: null, review: null, recency: null, penalty: null, final: null },
						inputs: {},
						explain: { final: { formula: 'round(...)', score: 10 }, weights: { click: 0.2, sales: 0.35, review: 0.25, recency: 0.1, penalty: 0 } },
					},
				});
			}
			if (u.includes('/search-rank/product-index/history-detailed')) {
				return Promise.resolve({ data: { product_url: 'https://smartstore.naver.com/test/products/1', items: [] } });
			}
			if (u.includes('/search-rank/product-index/suggested-inputs')) {
				return Promise.resolve({ data: null });
			}
			return Promise.resolve({ data: [] });
		});

		postMock.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/page-metrics/batch')) {
				return Promise.resolve({
					data: [{ product_url: 'https://smartstore.naver.com/test/products/1', title: '테스트 상품', image_url: null }],
				});
			}
			if (u.includes('/search-rank/product-index/latest/batch')) {
				// 첫 로딩은 어제 스냅샷(Δ=0) → 분석 저장 후 재조회는 오늘 스냅샷(Δ=+3)로 갱신되는 시나리오
				const calls = (postMock as any).mock.calls.filter((c: any[]) => String(c?.[0] || '').includes('/search-rank/product-index/latest/batch')).length;
				const deltaFinal = calls >= 2 ? 3 : 0;
				const date = calls >= 2 ? '2026-01-27' : '2026-01-26';
				return Promise.resolve({
					data: [
						{
							requested_url: 'https://smartstore.naver.com/test/products/1',
							product_url: 'https://smartstore.naver.com/test/products/1',
							date,
							scores: { click: 10, sales: 10, review: 10, recency: 10, penalty: 0, final: 45 },
							deltas: { final: deltaFinal },
							signal: 'DEAD',
						},
					],
				});
			}
			if (u.includes('/search-rank/product-index/analyze')) {
				return Promise.resolve({
					data: {
						product_url: 'https://smartstore.naver.com/test/products/1',
						date: '2026-01-27',
						title: '테스트 상품',
						image_url: null,
						scores: { click: 40, sales: 60, review: 100, recency: 0, penalty: 0, final: 60 },
						deltas: { click: 1, sales: -2, review: 0, recency: null, penalty: null, final: 3 },
						inputs: {},
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		render(<ProductIndexAnalysisView apiBaseUrl="http://localhost:5189" />);

		// 목록 로딩 후 상품 선택
		await waitFor(() => expect(screen.getByText('테스트 상품')).toBeTruthy());
		// 상단 상태 요약(배지+바)
		expect(screen.getAllByText('하락경고').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByTestId('pi-signal-bar')).toBeTruthy();

		fireEvent.click(screen.getByText('테스트 상품'));

		// 클릭만으로 마지막 저장 분석이 표시되어야 한다.
		await waitFor(() => {
			expect(screen.getByText(/기준일:/)).toBeTruthy();
			expect(screen.getAllByText(/10점/).length).toBeGreaterThan(0);
		});

		// 분석 실행(재분석)
		fireEvent.click(screen.getByRole('button', { name: '상품지수 분석' }));

		await waitFor(() => {
			expect(screen.getByText(/클릭점수/)).toBeTruthy();
			expect(screen.getByText(/40점/)).toBeTruthy();
			expect(screen.getByText(/\(\+1\)/)).toBeTruthy();
			expect(screen.getByText(/\(-2\)/)).toBeTruthy();
			expect(screen.getAllByText(/\(±0\)/).length).toBeGreaterThanOrEqual(1);
			expect(screen.getByText(/\(\+3\)/)).toBeTruthy();
		});

		// 분석 저장 후 latest/batch를 다시 불러 좌측 리스트(요약)의 Δ가 갱신되어야 한다.
		expect(
			(postMock as any).mock.calls.filter((c: any[]) => String(c?.[0] || '').includes('/search-rank/product-index/latest/batch')).length,
		).toBeGreaterThanOrEqual(2);
	});
});

