import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
	getAdsJobCacheMocks,
	mockedAxios,
	registerAdsViewsTestLifecycle,
	renderAdsRoutes,
} from './AdsViews.testUtils';

const adsJobCacheMocks = getAdsJobCacheMocks();

describe('AdsViews creatives flow', () => {
	registerAdsViewsTestLifecycle();

	it('소재 분석 사용자 설정 모달에 구매전환 헤더가 포함되고 숨길 수 있다', async () => {
		adsJobCacheMocks.subscribe.mockImplementationOnce((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					groups: [
						{
							key: 'CAMP1||GRP1',
							title: 'CAMP1 / GRP1',
							rows: [
								{
									key: 'CAMP1||GRP1||nad-x',
									campaignName: 'CAMP1',
									adgroupName: 'GRP1',
									creativeId: 'nad-x',
									creativeName: 'ADNAME_X',
									productTitle: '상품A',
									imageUrl: null,
									currentBid: 1000,
									prevCurrentBid: 900,
									qualityIndex: 7,
									prevQualityIndex: 6,
									avgRank: 2.5,
									prevAvgRank: 3.0,
									metrics: { impressions: 10, clicks: 1, ctr: 10, cpc: 1100, cost: 1100, conversions: 2, cvr: 200, revenue: 5000, roas: 454.5 },
									prevMetrics: { impressions: 5, clicks: 1, ctr: 20, cpc: 1000, cost: 1000, conversions: 1, cvr: 100, revenue: 2000, roas: 200 },
									deltas: {
										impressions: { diff: 5, pct: 100 },
										clicks: { diff: 0, pct: 0 },
										ctr: { diff: -10, pct: -50 },
										cpc: { diff: 100, pct: 10 },
										cost: { diff: 100, pct: 10 },
										conversions: { diff: 1, pct: 100 },
										cvr: { diff: 100, pct: 100 },
										revenue: { diff: 3000, pct: 150 },
										roas: { diff: 254.5, pct: 127.25 },
									},
									purchaseMetrics: { conversions: 1, revenue: 3000 },
									prevPurchaseMetrics: { conversions: 1, revenue: 1000 },
									cpa: 550,
									prevCpa: 1000,
									cpaDiff: -450,
									cpaPct: -45,
								},
							],
						},
					],
				},
			});
			return () => {};
		});

		render(renderAdsRoutes('/analytics/campaign/creatives'));

		fireEvent.click(screen.getByRole('button', { name: '사용자 설정' }));
		const dialog = screen.getByRole('dialog', { name: '소재 분석 헤더 설정' });
		expect(dialog).toBeTruthy();
		expect(screen.getByLabelText('구매전환수')).toBeTruthy();
		expect(screen.getByLabelText('구매전환율(%)')).toBeTruthy();
		expect(screen.getByLabelText('구매전환수익율(%)')).toBeTruthy();
		fireEvent.click(screen.getByLabelText('구매전환수'));
		fireEvent.click(within(dialog).getAllByRole('button', { name: '닫기' })[0]!);

		await waitFor(() => expect(screen.queryByText('구매전환수')).toBeNull());
	});

	it('소재 분석은 광고그룹 단위로 그룹핑하여 섹션을 렌더링한다', () => {
		adsJobCacheMocks.subscribe.mockImplementationOnce((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					groups: [
						{
							key: 'CAMP1||GRP1',
							title: 'CAMP1 / GRP1',
							rows: [
								{
									key: 'CAMP1||GRP1||nad-x',
									campaignName: 'CAMP1',
									adgroupName: 'GRP1',
									creativeId: 'nad-x',
									creativeName: 'ADNAME_X',
									productTitle: '상품A',
									imageUrl: 'http://img.test/a.png',
									currentBid: 1000,
									qualityIndex: 7,
									avgRank: 2.5,
									metrics: { impressions: 10, clicks: 1, ctr: 10, cpc: 1100, cost: 1100, conversions: 1, cvr: 100, revenue: 5000, roas: 454.5 },
									prevMetrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
									deltas: {
										impressions: { diff: 10, pct: null },
										clicks: { diff: 1, pct: null },
										ctr: { diff: 10, pct: null },
										cpc: { diff: 1100, pct: null },
										cost: { diff: 1100, pct: null },
										conversions: { diff: 1, pct: null },
										cvr: { diff: 100, pct: null },
										revenue: { diff: 5000, pct: null },
										roas: { diff: 454.5, pct: null },
									},
									cpa: 1100,
									prevCpa: 0,
									cpaDiff: 1100,
									cpaPct: null,
								},
							],
						},
					],
				},
			});
			return () => {};
		});

		render(renderAdsRoutes('/analytics/campaign/creatives'));

		expect(screen.getByText(/CAMP1 \/ GRP1/)).toBeTruthy();
		expect(screen.getByText('ADNAME_X')).toBeTruthy();
		expect(screen.getByText('소재 분석 지표 안내')).toBeTruthy();
		expect(screen.getAllByText(/총전환매출액/).length).toBeGreaterThan(0);
	});

	it('소재 분석 상단에도 선택형 성과 그래프가 표시되고 행 선택 및 선택값 저장이 동작한다', async () => {
		adsJobCacheMocks.subscribe.mockImplementation((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					groups: [
						{
							key: 'CAMP1||GRP1',
							title: 'CAMP1 / GRP1',
							rows: [
								{
									key: 'CAMP1||GRP1||nad-x',
									campaignName: 'CAMP1',
									adgroupName: 'GRP1',
									creativeId: 'nad-x',
									creativeName: 'ADNAME_X',
									productTitle: '상품A',
									imageUrl: null,
									currentBid: 1000,
									prevCurrentBid: 900,
									qualityIndex: 7,
									prevQualityIndex: 6,
									avgRank: 2.5,
									prevAvgRank: 3.0,
									metrics: { impressions: 30, clicks: 3, ctr: 10, cpc: 1000, cost: 3000, conversions: 2, cvr: 66.67, revenue: 9000, roas: 300 },
									prevMetrics: { impressions: 20, clicks: 2, ctr: 10, cpc: 900, cost: 1800, conversions: 1, cvr: 50, revenue: 4000, roas: 222.22 },
									deltas: {
										impressions: { diff: 10, pct: 50 },
										clicks: { diff: 1, pct: 50 },
										ctr: { diff: 0, pct: 0 },
										cpc: { diff: 100, pct: 11.11 },
										cost: { diff: 1200, pct: 66.67 },
										conversions: { diff: 1, pct: 100 },
										cvr: { diff: 16.67, pct: 33.34 },
										revenue: { diff: 5000, pct: 125 },
										roas: { diff: 77.78, pct: 35 },
									},
									purchaseMetrics: { conversions: 1, revenue: 5000 },
									prevPurchaseMetrics: { conversions: 0, revenue: 0 },
									cpa: 1500,
									prevCpa: 1800,
									cpaDiff: -300,
									cpaPct: -16.67,
								},
							],
						},
					],
					trendPoints: [
						{ date: '2026-03-12', label: '03.12', impressions: 10, clicks: 1, ctr: 10, cpc: 1000, cost: 1000, conversions: 1, purchase_conversions: 0, cvr: 100, revenue: 3000, purchase_revenue: 0, purchase_roas: 0, roas: 300 },
						{ date: '2026-03-13', label: '03.13', impressions: 20, clicks: 2, ctr: 10, cpc: 1000, cost: 2000, conversions: 1, purchase_conversions: 1, cvr: 50, revenue: 6000, purchase_revenue: 5000, purchase_roas: 250, roas: 300 },
					],
					trendByRowKey: {
						'CAMP1||GRP1||nad-x': [
							{ date: '2026-03-12', label: '03.12', impressions: 10, clicks: 1, ctr: 10, cpc: 1000, cost: 1000, conversions: 1, purchase_conversions: 0, cvr: 100, revenue: 3000, purchase_revenue: 0, purchase_roas: 0, roas: 300 },
							{ date: '2026-03-13', label: '03.13', impressions: 20, clicks: 2, ctr: 10, cpc: 1000, cost: 2000, conversions: 1, purchase_conversions: 1, cvr: 50, revenue: 6000, purchase_revenue: 5000, purchase_roas: 250, roas: 300 },
						],
					},
				},
			});
			return () => {};
		});

		const { unmount } = render(renderAdsRoutes('/analytics/campaign/creatives'));

		expect(await screen.findByText('성과지표 추이')).toBeTruthy();
		fireEvent.change(screen.getByLabelText('ads-performance-trend-left-metric'), { target: { value: 'clicks' } });
		fireEvent.change(screen.getByLabelText('ads-performance-trend-right-metric'), { target: { value: 'purchase_revenue' } });
		await waitFor(() => {
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('클릭수');
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('구매전환매출액');
		});

		fireEvent.click(screen.getByText('ADNAME_X').closest('tr') as HTMLElement);
		await waitFor(() => {
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('ADNAME_X');
		});
		expect(screen.getByRole('button', { name: '그래프 선택 해제' })).toBeTruthy();

		unmount();

		render(renderAdsRoutes('/analytics/campaign/creatives'));

		await waitFor(() => {
			expect((screen.getByLabelText('ads-performance-trend-left-metric') as HTMLSelectElement).value).toBe('clicks');
			expect((screen.getByLabelText('ads-performance-trend-right-metric') as HTMLSelectElement).value).toBe('purchase_revenue');
		});
	});

	it('소재 분석 필터(캠페인/광고그룹)는 다중 선택이 가능하고, 선택된 항목만 표시한다', async () => {
		adsJobCacheMocks.subscribe.mockImplementation((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					allCampaigns: ['CAMP1', 'CAMP2'],
					allAdgroupsByCampaign: { CAMP1: ['GRP1'], CAMP2: ['GRP2'] },
					groups: [
						{
							key: 'CAMP1||GRP1',
							title: 'CAMP1 / GRP1',
							rows: [
								{
									key: 'CAMP1||GRP1||nad-x',
									campaignName: 'CAMP1',
									adgroupName: 'GRP1',
									creativeId: 'nad-x',
									creativeName: 'ADNAME_X',
									productTitle: '상품A',
									imageUrl: null,
									currentBid: null,
									qualityIndex: null,
									avgRank: null,
									metrics: { impressions: 10, clicks: 1, ctr: 10, cpc: 1100, cost: 1100, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
									prevMetrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
									deltas: {
										impressions: { diff: 10, pct: null },
										clicks: { diff: 1, pct: null },
										ctr: { diff: 10, pct: null },
										cpc: { diff: 1100, pct: null },
										cost: { diff: 1100, pct: null },
										conversions: { diff: 0, pct: null },
										cvr: { diff: 0, pct: null },
										revenue: { diff: 0, pct: null },
										roas: { diff: 0, pct: null },
									},
									cpa: 0,
									prevCpa: 0,
									cpaDiff: 0,
									cpaPct: null,
								},
							],
						},
						{
							key: 'CAMP2||GRP2',
							title: 'CAMP2 / GRP2',
							rows: [
								{
									key: 'CAMP2||GRP2||nad-y',
									campaignName: 'CAMP2',
									adgroupName: 'GRP2',
									creativeId: 'nad-y',
									creativeName: 'ADNAME_Y',
									productTitle: '상품B',
									imageUrl: null,
									currentBid: null,
									qualityIndex: null,
									avgRank: null,
									metrics: { impressions: 10, clicks: 1, ctr: 10, cpc: 1100, cost: 1100, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
									prevMetrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
									deltas: {
										impressions: { diff: 10, pct: null },
										clicks: { diff: 1, pct: null },
										ctr: { diff: 10, pct: null },
										cpc: { diff: 1100, pct: null },
										cost: { diff: 1100, pct: null },
										conversions: { diff: 0, pct: null },
										cvr: { diff: 0, pct: null },
										revenue: { diff: 0, pct: null },
										roas: { diff: 0, pct: null },
									},
									cpa: 0,
									prevCpa: 0,
									cpaDiff: 0,
									cpaPct: null,
								},
							],
						},
					],
				},
			});
			return () => {};
		});

		render(renderAdsRoutes('/analytics/campaign/creatives'));

		expect(screen.getByText(/CAMP1 \/ GRP1/)).toBeTruthy();
		expect(screen.getByText(/CAMP2 \/ GRP2/)).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: /캠페인 전체/ }));
		fireEvent.click(screen.getByLabelText('CAMP1'));
		fireEvent.click(screen.getByRole('button', { name: '닫기' }));

		await screen.findByText(/CAMP1 \/ GRP1/);
		await waitFor(() => expect(screen.queryByText(/CAMP2 \/ GRP2/)).toBeNull());
	});

	it('소재 분석에서 "키워드 인사이트" 버튼을 누르면 모달이 열리고, 광고그룹명 마지막 토큰으로 1년 조회를 수행한다', async () => {
		adsJobCacheMocks.subscribe.mockImplementationOnce((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					groups: [
						{
							key: 'CAMP1||#OO_OO_천연염색약',
							title: 'CAMP1 / #OO_OO_천연염색약',
							rows: [],
						},
					],
				},
			});
			return () => {};
		});

		mockedAxios.get.mockImplementation((url: string, cfg?: any) => {
			if (String(url).includes('/research/keyword-insights')) {
				return Promise.resolve({
					data: {
						keyword: String(cfg?.params?.keyword || ''),
						date_from: cfg?.params?.date_from,
						date_to: cfg?.params?.date_to,
						cached: false,
						searchedAt: '2026-01-24T00:00:00Z',
						keywordSummary: null,
						trend: { points: [], estimatedDailySearches: null },
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						relatedKeywords: [],
						shopping: { category: null, productCount: 0, categoryPath: null },
					},
				});
			}
			return Promise.resolve({ data: [] });
		});
		mockedAxios.post.mockResolvedValue({ data: {} });

		render(renderAdsRoutes('/analytics/campaign/creatives?campaign=CAMP1&adgroup=%23OO_OO_%EC%B2%9C%EC%97%B0%EC%97%BC%EC%83%89%EC%95%BD'));

		const btn = screen.getByRole('button', { name: '키워드 인사이트' });
		expect(btn).toBeTruthy();
		fireEvent.click(btn);

		expect(screen.getByRole('dialog', { name: '키워드 인사이트' })).toBeTruthy();

		await waitFor(() => {
			const calls: Array<{ url: string; params?: Record<string, unknown> }> = mockedAxios.get.mock.calls.map(
				(callArgs: [unknown, { params?: Record<string, unknown> }?]) => ({
				url: String(callArgs[0] || ''),
				params: callArgs[1]?.params,
				}),
			);
			const call = calls.find((candidate) => candidate.url.includes('/research/keyword-insights'));
			expect(call).toBeTruthy();
			if (!call?.params) {
				throw new Error('키워드 인사이트 요청 파라미터를 찾지 못했습니다.');
			}
			expect(call.params.keyword).toBe('천연염색약');
			expect(String(call.params.date_from || '')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(String(call.params.date_to || '')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});
});
