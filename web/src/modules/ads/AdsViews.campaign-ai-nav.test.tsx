import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
	getAdsJobCacheMocks,
	mockedAxios,
	registerAdsViewsTestLifecycle,
	renderAdsRoutes,
	renderAdsRoutesWithLocation,
} from './AdsViews.testUtils';

const adsJobCacheMocks = getAdsJobCacheMocks();

describe('AdsViews campaign/ai/navigation', () => {
	registerAdsViewsTestLifecycle();

	it('캠페인 화면에 새로고침 버튼이 있고 클릭 시 재요청을 트리거한다', async () => {
		render(renderAdsRoutes('/analytics/campaign/campaigns'));

		const btn = screen.getByRole('button', { name: '새로고침' });
		expect(btn).toBeTruthy();

		expect(adsJobCacheMocks.start).toHaveBeenCalled();
		const callsBefore = adsJobCacheMocks.start.mock.calls.length;

		fireEvent.click(btn);

		expect(adsJobCacheMocks.invalidate).toHaveBeenCalled();
		expect(adsJobCacheMocks.start.mock.calls.length).toBeGreaterThan(callsBefore);
	});

	it('캠페인 화면 상단에 선택형 성과 그래프가 표시되고 지표를 변경할 수 있다', async () => {
		adsJobCacheMocks.subscribe.mockImplementationOnce((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					rows: [
						{
							key: 'CAMP_A',
							primary: 'CAMP_A',
							secondary: null,
							tertiary: null,
							metrics: { impressions: 300, clicks: 30, ctr: 10, cpc: 1000, cost: 30000, conversions: 3, cvr: 10, revenue: 70000, roas: 233.33 },
							prevMetrics: { impressions: 200, clicks: 20, ctr: 10, cpc: 900, cost: 18000, conversions: 2, cvr: 10, revenue: 40000, roas: 222.22 },
							deltas: {
								impressions: { diff: 100, pct: 50 },
								clicks: { diff: 10, pct: 50 },
								ctr: { diff: 0, pct: 0 },
								cpc: { diff: 100, pct: 11.11 },
								cost: { diff: 12000, pct: 66.67 },
								conversions: { diff: 1, pct: 50 },
								cvr: { diff: 0, pct: 0 },
								revenue: { diff: 30000, pct: 75 },
								roas: { diff: 11.11, pct: 5 },
							},
							purchaseMetrics: { conversions: 2, revenue: 50000 },
							prevPurchaseMetrics: { conversions: 1, revenue: 20000 },
							status: { label: 'ELIGIBLE', isActive: true },
						},
					],
					totalRow: null,
					trendPoints: [
						{ date: '2026-03-12', label: '03.12', impressions: 100, clicks: 10, ctr: 10, cpc: 1000, cost: 10000, conversions: 1, purchase_conversions: 1, cvr: 10, revenue: 20000, purchase_revenue: 15000, purchase_roas: 150, roas: 200 },
						{ date: '2026-03-13', label: '03.13', impressions: 120, clicks: 12, ctr: 10, cpc: 1000, cost: 12000, conversions: 1, purchase_conversions: 0, cvr: 8.33, revenue: 22000, purchase_revenue: 0, purchase_roas: 0, roas: 183.33 },
						{ date: '2026-03-14', label: '03.14', impressions: 80, clicks: 8, ctr: 10, cpc: 1000, cost: 8000, conversions: 1, purchase_conversions: 1, cvr: 12.5, revenue: 28000, purchase_revenue: 35000, purchase_roas: 437.5, roas: 350 },
					],
				},
			});
			return () => {};
		});

		render(renderAdsRoutes('/analytics/campaign/campaigns'));

		expect(await screen.findByText('성과지표 추이')).toBeTruthy();
		expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('총비용');
		expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('총전환매출액');

		fireEvent.change(screen.getByLabelText('ads-performance-trend-left-metric'), { target: { value: 'clicks' } });
		fireEvent.change(screen.getByLabelText('ads-performance-trend-right-metric'), { target: { value: 'purchase_revenue' } });

		await waitFor(() => {
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('클릭수');
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('구매전환매출액');
		});
	});

	it('선택형 성과 그래프 지표 선택은 저장되고 표 행 선택 시 해당 항목 추이로 전환된다', async () => {
		adsJobCacheMocks.subscribe.mockImplementation((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					rows: [
						{
							key: 'CAMP_A',
							primary: 'CAMP_A',
							secondary: null,
							tertiary: null,
							metrics: { impressions: 300, clicks: 30, ctr: 10, cpc: 1000, cost: 30000, conversions: 3, cvr: 10, revenue: 70000, roas: 233.33 },
							prevMetrics: { impressions: 200, clicks: 20, ctr: 10, cpc: 900, cost: 18000, conversions: 2, cvr: 10, revenue: 40000, roas: 222.22 },
							deltas: {
								impressions: { diff: 100, pct: 50 },
								clicks: { diff: 10, pct: 50 },
								ctr: { diff: 0, pct: 0 },
								cpc: { diff: 100, pct: 11.11 },
								cost: { diff: 12000, pct: 66.67 },
								conversions: { diff: 1, pct: 50 },
								cvr: { diff: 0, pct: 0 },
								revenue: { diff: 30000, pct: 75 },
								roas: { diff: 11.11, pct: 5 },
							},
							purchaseMetrics: { conversions: 2, revenue: 50000 },
							prevPurchaseMetrics: { conversions: 1, revenue: 20000 },
							status: { label: 'ELIGIBLE', isActive: true },
						},
						{
							key: 'CAMP_B',
							primary: 'CAMP_B',
							secondary: null,
							tertiary: null,
							metrics: { impressions: 200, clicks: 20, ctr: 10, cpc: 900, cost: 18000, conversions: 2, cvr: 10, revenue: 42000, roas: 233.33 },
							prevMetrics: { impressions: 180, clicks: 18, ctr: 10, cpc: 850, cost: 15300, conversions: 1, cvr: 5.55, revenue: 20000, roas: 130.72 },
							deltas: {
								impressions: { diff: 20, pct: 11.11 },
								clicks: { diff: 2, pct: 11.11 },
								ctr: { diff: 0, pct: 0 },
								cpc: { diff: 50, pct: 5.88 },
								cost: { diff: 2700, pct: 17.65 },
								conversions: { diff: 1, pct: 100 },
								cvr: { diff: 4.45, pct: 80.18 },
								revenue: { diff: 22000, pct: 110 },
								roas: { diff: 102.61, pct: 78.49 },
							},
							purchaseMetrics: { conversions: 1, revenue: 15000 },
							prevPurchaseMetrics: { conversions: 0, revenue: 0 },
							status: { label: 'ELIGIBLE', isActive: true },
						},
					],
					totalRow: null,
					trendPoints: [
						{ date: '2026-03-12', label: '03.12', impressions: 210, clicks: 21, ctr: 10, cpc: 952.38, cost: 20000, conversions: 2, purchase_conversions: 0, cvr: 9.52, revenue: 45000, purchase_revenue: 0, purchase_roas: 0, roas: 225 },
						{ date: '2026-03-13', label: '03.13', impressions: 150, clicks: 15, ctr: 10, cpc: 1000, cost: 15000, conversions: 1, purchase_conversions: 0, cvr: 6.67, revenue: 32000, purchase_revenue: 0, purchase_roas: 0, roas: 213.33 },
					],
					trendByRowKey: {
						CAMP_A: [
							{ date: '2026-03-12', label: '03.12', impressions: 110, clicks: 11, ctr: 10, cpc: 1000, cost: 11000, conversions: 1, purchase_conversions: 0, cvr: 9.09, revenue: 25000, purchase_revenue: 0, purchase_roas: 0, roas: 227.27 },
							{ date: '2026-03-13', label: '03.13', impressions: 190, clicks: 19, ctr: 10, cpc: 1000, cost: 19000, conversions: 2, purchase_conversions: 0, cvr: 10.53, revenue: 45000, purchase_revenue: 0, purchase_roas: 0, roas: 236.84 },
						],
						CAMP_B: [
							{ date: '2026-03-12', label: '03.12', impressions: 100, clicks: 10, ctr: 10, cpc: 900, cost: 9000, conversions: 1, purchase_conversions: 0, cvr: 10, revenue: 20000, purchase_revenue: 0, purchase_roas: 0, roas: 222.22 },
							{ date: '2026-03-13', label: '03.13', impressions: 60, clicks: 6, ctr: 10, cpc: 1000, cost: 6000, conversions: 0, purchase_conversions: 0, cvr: 0, revenue: 12000, purchase_revenue: 0, purchase_roas: 0, roas: 200 },
						],
					},
				},
			});
			return () => {};
		});

		const { unmount } = render(renderAdsRoutes('/analytics/campaign/campaigns'));

		fireEvent.change(screen.getByLabelText('ads-performance-trend-left-metric'), { target: { value: 'clicks' } });
		fireEvent.change(screen.getByLabelText('ads-performance-trend-right-metric'), { target: { value: 'purchase_revenue' } });
		await waitFor(() => {
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('클릭수');
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('구매전환매출액');
		});

		fireEvent.click(screen.getByRole('button', { name: /CAMP_A/ }).closest('tr') as HTMLElement);
		await waitFor(() => {
			expect(screen.getByTestId('ads-performance-trend-active-metrics')).toHaveTextContent('CAMP_A');
		});
		expect(screen.getByRole('button', { name: '그래프 선택 해제' })).toBeTruthy();

		unmount();

		render(renderAdsRoutes('/analytics/campaign/campaigns'));

		await waitFor(() => {
			expect((screen.getByLabelText('ads-performance-trend-left-metric') as HTMLSelectElement).value).toBe('clicks');
			expect((screen.getByLabelText('ads-performance-trend-right-metric') as HTMLSelectElement).value).toBe('purchase_revenue');
		});
	});

	it('캠페인 화면에서 AI 분석 버튼을 누르면 모달이 열리고, 분석 실행 시 결과가 표시된다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/models')) return Promise.resolve({ data: { ok: true, models: [{ id: 'gpt-4o-mini' }] } });
			return Promise.resolve({ data: [] });
		});
		mockedAxios.post.mockImplementation((url: string) => {
			if (String(url).includes('/ai/analyze/ads')) return Promise.resolve({ data: { ok: true, analysis: '분석 결과 텍스트' } });
			return Promise.resolve({ data: {} });
		});

		render(renderAdsRoutes('/analytics/campaign/campaigns'));

		const openBtn = screen.getByRole('button', { name: 'AI 분석' });
		expect(openBtn).toBeTruthy();
		fireEvent.click(openBtn);

		expect(screen.getByRole('dialog', { name: 'AI 분석' })).toBeTruthy();

		const runBtn = screen.getByRole('button', { name: '분석 실행' });
		fireEvent.click(runBtn);

		await waitFor(() => {
			expect(screen.getByText('분석 결과 텍스트')).toBeTruthy();
		});
	});

	it('AI 분석 모달에서 추가 질문을 이어서 하면 대화가 누적된다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/models')) return Promise.resolve({ data: { ok: true, models: [{ id: 'gpt-4o-mini' }] } });
			return Promise.resolve({ data: [] });
		});
		let call = 0;
		mockedAxios.post.mockImplementation((url: string) => {
			if (!String(url).includes('/ai/analyze/ads')) return Promise.resolve({ data: {} });
			call += 1;
			if (call === 1) return Promise.resolve({ data: { ok: true, analysis: '첫 분석' } });
			return Promise.resolve({ data: { ok: true, analysis: '후속 답변' } });
		});

		render(renderAdsRoutes('/analytics/campaign/campaigns'));

		fireEvent.click(screen.getByRole('button', { name: 'AI 분석' }));
		fireEvent.click(screen.getByRole('button', { name: '분석 실행' }));
		await waitFor(() => expect(screen.getByText('첫 분석')).toBeTruthy());

		const follow = screen.getByLabelText('ads-ai-followup') as HTMLTextAreaElement;
		fireEvent.change(follow, { target: { value: '추가 질문' } });
		fireEvent.click(screen.getByRole('button', { name: '질문 전송' }));
		await waitFor(() => expect(screen.getByText('후속 답변')).toBeTruthy());
	});

	it('수집 진행 메시지(예: 1/7)가 있으면 진행 바(progressbar)가 노출된다', () => {
		adsJobCacheMocks.subscribe.mockImplementationOnce((key: string, listener: any) => {
			listener({ status: 'loading', message: '데이터가 없어 자동 수집 중… (keyword) 1/7 (2026-01-01 ~ 2026-01-07)', data: null, error: null });
			return () => {};
		});

		render(renderAdsRoutes('/analytics/campaign/campaigns'));
		expect(screen.getByRole('progressbar', { name: '수집 진행률' })).toBeTruthy();
	});

	it('캠페인 분석에서 캠페인명을 클릭하면 광고 그룹 분석으로 이동하고 campaign 쿼리가 설정된다', () => {
		adsJobCacheMocks.subscribe.mockImplementationOnce((key: string, listener: any) => {
			listener({
				status: 'success',
				message: null,
				error: null,
				data: {
					rows: [
						{
							key: 'CAMP_A',
							primary: 'CAMP_A',
							secondary: null,
							tertiary: null,
							metrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
							prevMetrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
							deltas: {
								impressions: { diff: 0, pct: null },
								clicks: { diff: 0, pct: null },
								ctr: { diff: 0, pct: null },
								cpc: { diff: 0, pct: null },
								cost: { diff: 0, pct: null },
								conversions: { diff: 0, pct: null },
								cvr: { diff: 0, pct: null },
								revenue: { diff: 0, pct: null },
								roas: { diff: 0, pct: null },
							},
							status: { label: 'ELIGIBLE', isActive: true },
						},
					],
					totalRow: null,
				},
			});
			return () => {};
		});

		render(renderAdsRoutesWithLocation('/analytics/campaign/campaigns'));

		fireEvent.click(screen.getByRole('button', { name: /CAMP_A/ }));
		expect(screen.getByTestId('location').textContent).toContain('/analytics/campaign/adgroups?campaign=CAMP_A');
	});

	it('광고 그룹 분석 화면 상단의 캠페인명을 클릭하면 캠페인 분석으로 이동한다', () => {
		render(renderAdsRoutesWithLocation('/analytics/campaign/adgroups?campaign=CAMP_X'));

		fireEvent.click(screen.getByRole('button', { name: 'CAMP_X' }));
		expect(screen.getByTestId('location').textContent).toContain('/analytics/campaign/campaigns');
	});

	it('소재 분석 화면 상단의 광고그룹명을 클릭하면 광고 그룹 분석으로 이동한다', () => {
		render(renderAdsRoutesWithLocation('/analytics/campaign/creatives?campaign=CAMP1&adgroup=GRP1'));

		fireEvent.click(screen.getByRole('button', { name: 'GRP1' }));
		expect(screen.getByTestId('location').textContent).toContain('/analytics/campaign/adgroups');
	});

	it('소재 분석 화면 상단의 캠페인명을 클릭하면 캠페인 분석으로 이동한다', () => {
		render(renderAdsRoutesWithLocation('/analytics/campaign/creatives?campaign=CAMP1&adgroup=GRP1'));

		fireEvent.click(screen.getByRole('button', { name: 'CAMP1' }));
		expect(screen.getByTestId('location').textContent).toContain('/analytics/campaign/campaigns');
	});

	it('광고 그룹 분석은 URL 쿼리(campaign)를 jobKey에 포함해 필터 상태가 캐시/분리된다', () => {
		render(renderAdsRoutes('/analytics/campaign/adgroups?campaign=CAMP_X'));
		expect(adsJobCacheMocks.start).toHaveBeenCalled();
		const key = String(adsJobCacheMocks.start.mock.calls[0]?.[0] ?? '');
		expect(key).toContain('campaign=');
		expect(key).toContain('CAMP_X');
	});
});
