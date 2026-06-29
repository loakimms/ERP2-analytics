import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { PurchaseKeywordsView } from './PurchaseKeywordsView';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
			post: vi.fn(),
		},
	};
});

describe('PurchaseKeywordsView', () => {
	it('상품ID 필터는 노출하지 않고, 엑셀업로드 버튼을 노출한다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockImplementation((url: string) => {
			if (String(url).includes('/purchase/keywords/dashboard')) {
				return Promise.resolve({
					data: { ok: true, from: '2026-01-01', to: '2026-01-01', source_used: 'purchase_upload', totals: { amount: 0, payments: 0 }, products: [] },
				});
			}
			if (String(url).includes('/purchase/keywords/daily')) {
				return Promise.resolve({ data: [] });
			}
			return Promise.resolve({ data: [] });
		});

		render(
			<MemoryRouter>
				<PurchaseKeywordsView apiBaseUrl="http://localhost:9999" />
			</MemoryRouter>,
		);

		// 엑셀업로드 버튼(데이터와 무관하게 노출)
		expect(await screen.findByRole('button', { name: '엑셀업로드' })).toBeTruthy();
		// 자동 수집 버튼(데이터와 무관하게 노출)
		expect(await screen.findByRole('button', { name: '자동수집(어제)' })).toBeTruthy();
		expect(await screen.findByRole('button', { name: '수동수집(기간)' })).toBeTruthy();

		// 상세 필터에 상품ID 입력/라벨이 없어야 함
		expect(screen.queryByText('상품ID')).toBeNull();
	});

	it('자동수집(어제) 버튼을 누르면 수집 API를 호출하고 결과 패널을 표시한다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockImplementation((url: string) => {
			if (String(url).includes('/purchase/keywords/dashboard')) {
				return Promise.resolve({
					data: { ok: true, from: '2026-01-01', to: '2026-01-01', source_used: 'purchase_upload', totals: { amount: 0, payments: 0 }, products: [] },
				});
			}
			if (String(url).includes('/purchase/keywords/daily')) {
				return Promise.resolve({ data: [] });
			}
			return Promise.resolve({ data: [] });
		});
		(axiosAny.post as any).mockResolvedValue({
			data: {
				ok: true,
				status: 'SUCCESS',
				date: '2026-03-08',
				result: { ok: true, processed_dates: ['2026-03-08'], raw_upserted_total: 3, fact_rows_by_date: { '2026-03-08': 2 }, errors: {} },
			},
		});

		render(
			<MemoryRouter>
				<PurchaseKeywordsView apiBaseUrl="http://localhost:9999" />
			</MemoryRouter>,
		);

		const btn = await screen.findByRole('button', { name: '자동수집(어제)' });
		fireEvent.click(btn);

		// API 호출
		expect((axiosAny.post as any).mock.calls.some((c: any[]) => String(c?.[0] ?? '').includes('/purchase/keywords/sync/yesterday'))).toBe(true);

		// 결과 패널 표시
		expect(await screen.findByText('커머스 API 수집 결과')).toBeTruthy();
		expect(await screen.findByRole('table', { name: 'purchase-keywords-sync-result-table' })).toBeTruthy();
	});

	it('bizdata 권한 오류(BIZDATA_FORBIDDEN)가 있으면 API 세팅으로 이동 버튼을 노출한다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockImplementation((url: string) => {
			if (String(url).includes('/purchase/keywords/dashboard')) {
				return Promise.resolve({
					data: { ok: true, from: '2026-01-01', to: '2026-01-01', source_used: 'purchase_upload', totals: { amount: 0, payments: 0 }, products: [] },
				});
			}
			if (String(url).includes('/purchase/keywords/daily')) {
				return Promise.resolve({ data: [] });
			}
			return Promise.resolve({ data: [] });
		});
		(axiosAny.post as any).mockResolvedValue({
			data: {
				ok: false,
				status: 'FAILED',
				date: '2026-03-08',
				result: {
					ok: false,
					processed_dates: [],
					raw_upserted_total: 0,
					fact_rows_by_date: {},
					errors: { '2026-03-08': 'BIZDATA_FORBIDDEN: 판매분석 API 접근 권한이 없습니다.' },
				},
			},
		});

		render(
			<MemoryRouter>
				<PurchaseKeywordsView apiBaseUrl="http://localhost:9999" />
			</MemoryRouter>,
		);

		const btn = await screen.findByRole('button', { name: '자동수집(어제)' });
		fireEvent.click(btn);

		expect(await screen.findByText('커머스 API 수집 결과')).toBeTruthy();
		expect(await screen.findByRole('button', { name: 'API 세팅으로 이동' })).toBeTruthy();
	});

	it('URL query로 받은 상품명/키워드 필터를 초기 반영한다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockImplementation((url: string, config?: any) => {
			if (String(url).includes('/purchase/keywords/dashboard')) {
				return Promise.resolve({
					data: { ok: true, from: '2026-01-01', to: '2026-01-01', source_used: 'purchase_upload', totals: { amount: 0, payments: 0 }, products: [] },
				});
			}
			if (String(url).includes('/purchase/keywords/daily')) {
				return Promise.resolve({ data: [] });
			}
			return Promise.resolve({ data: [] });
		});

		render(
			<MemoryRouter initialEntries={['/analytics/performance/purchase-keywords?product=%EC%A7%91%EC%A4%91%EC%BC%80%EC%96%B4+%ED%8A%B8%EB%A6%AC%ED%8A%B8%EB%A8%BC%ED%8A%B8&keyword=%EC%86%90%EC%83%81%EB%AA%A8']}>
				<PurchaseKeywordsView apiBaseUrl="http://localhost:9999" />
			</MemoryRouter>,
		);

		expect(await screen.findByText(/A-1 연동 상품 필터 적용됨/)).toBeTruthy();
		expect(screen.getByText(/집중케어 트리트먼트/)).toBeTruthy();
		expect(screen.getByText(/AI Ops 키워드 필터 적용됨/)).toBeTruthy();
		expect(screen.getByText(/손상모/)).toBeTruthy();

		const keywordCall = (axiosAny.get as any).mock.calls.find(
			(callArgs: any[]) =>
				String(callArgs?.[0] ?? '').includes('/purchase/keywords/dashboard') && String(callArgs?.[1]?.params?.keyword ?? '') === '손상모',
		);
		expect(keywordCall).toBeTruthy();
	});
});

