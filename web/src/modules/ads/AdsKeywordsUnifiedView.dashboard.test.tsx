import React from 'react';
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { clickWithAct, fetchSearchwordDailyMock, mockedAxios, registerAdsKeywordsUnifiedTestLifecycle, renderAdsKeywordsUnifiedView } from './AdsKeywordsUnifiedView.testUtils';
import { AdsKeywordsPerformanceView } from './AdsViews';

describe('AdsKeywordsUnifiedPerformanceView dashboard', () => {
	registerAdsKeywordsUnifiedTestLifecycle();

	it('상단 스크롤바가 존재하고, 대시보드(캠페인별 전환매출액/전환수)가 렌더링된다', async () => {
		fetchSearchwordDailyMock.mockResolvedValue([
			{
				date: '2026-01-01',
				searchword: 'q1',
				campaign_name: 'CAMP_A',
				adgroup_name: 'ADG_A',
				impressions: 10,
				clicks: 2,
				cost: 100,
				conversions: 1,
				revenue: 10000,
				purchase_conversions: 1,
				purchase_revenue: 7000,
				ctr: 0.2,
				cpc: 50,
				cvr: 0.5,
				roas: 10000,
				device: 'ALL',
				source: 'test',
			},
			{
				date: '2026-01-01',
				searchword: 'q2',
				campaign_name: 'CAMP_A',
				adgroup_name: 'ADG_A',
				impressions: 10,
				clicks: 1,
				cost: 50,
				conversions: 1,
				revenue: 5000,
				purchase_conversions: 0,
				purchase_revenue: 2000,
				ctr: 0.1,
				cpc: 50,
				cvr: 1.0,
				roas: 10000,
				device: 'ALL',
				source: 'test',
			},
		]);

		await renderAdsKeywordsUnifiedView(<AdsKeywordsPerformanceView apiBaseUrl="http://example.test" />);

		await waitFor(() => expect(fetchSearchwordDailyMock).toHaveBeenCalled());

		expect(mockedAxios.post).not.toHaveBeenCalledWith(expect.stringMatching(/\/ads\/collect\b/), expect.anything(), expect.anything());
		expect(screen.getAllByText(/광고 검색어 분석/).length).toBeGreaterThan(0);
		expect(screen.getByText('캠페인별 총전환/구매전환 대시보드 (기여도 추정)')).toBeTruthy();
		expect(screen.getByText('캠페인별 총전환매출액/구매전환매출액')).toBeTruthy();
		expect(screen.getByText('캠페인별 총전환수/구매전환수')).toBeTruthy();
		expect(screen.getByText('Top10 캠페인의 키워드별 총전환매출액/구매전환매출액')).toBeTruthy();
		expect(screen.getAllByText('구매전환매출액').length).toBeGreaterThan(0);
		expect(screen.getAllByText('구매전환수').length).toBeGreaterThan(0);
		expect(screen.getByLabelText('ads-table-scrollbar-top')).toBeTruthy();
	});

	it('쇼핑검색(검색어)은 searchword daily의 원본 searchword만 노출한다(캠페인/그룹명으로 추측 대체 금지)', async () => {
		fetchSearchwordDailyMock.mockResolvedValue([
			{
				date: '2026-01-01',
				searchword: '정확한검색어',
				campaign_name: 'CAMP_SHOP',
				adgroup_name: 'ADG_SHOP',
				impressions: 10,
				clicks: 2,
				cost: 100,
				conversions: 1,
				revenue: 10000,
				ctr: 0.2,
				cpc: 50,
				cvr: 0.5,
				roas: 10000,
				device: 'PC',
				source: 'test',
			},
		]);

		await renderAdsKeywordsUnifiedView(<AdsKeywordsPerformanceView apiBaseUrl="http://example.test" />);

		await waitFor(() => expect(fetchSearchwordDailyMock).toHaveBeenCalled());
		expect(screen.getAllByText('정확한검색어').length).toBeGreaterThan(0);
	});

	it('검색어 통합(merge)은 재조회 없이 기존 데이터로 재집계한다(프리징/부하 방지)', async () => {
		fetchSearchwordDailyMock.mockResolvedValue([
			{
				date: '2026-01-01',
				searchword: 'q1',
				campaign_name: 'CAMP_A',
				adgroup_name: 'ADG_A',
				impressions: 10,
				clicks: 2,
				cost: 100,
				conversions: 1,
				revenue: 10000,
				ctr: 0.2,
				cpc: 50,
				cvr: 0.5,
				roas: 10000,
				device: 'ALL',
				source: 'test',
			},
		]);

		await renderAdsKeywordsUnifiedView(<AdsKeywordsPerformanceView apiBaseUrl="http://example.test" />);

		await waitFor(() => expect(fetchSearchwordDailyMock).toHaveBeenCalled());
		const callsBefore = (fetchSearchwordDailyMock.mock?.calls ?? []).length;

		await clickWithAct(screen.getByRole('button', { name: '검색어 통합' }));

		await waitFor(() => {
			const callsAfter = (fetchSearchwordDailyMock.mock?.calls ?? []).length;
			expect(callsAfter).toBe(callsBefore);
		});
	});
});
