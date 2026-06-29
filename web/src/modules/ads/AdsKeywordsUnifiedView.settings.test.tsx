import React from 'react';
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { clickWithAct, fetchSearchwordDailyMock, registerAdsKeywordsUnifiedTestLifecycle, renderAdsKeywordsUnifiedView } from './AdsKeywordsUnifiedView.testUtils';
import { AdsKeywordsPerformanceView } from './AdsViews';

describe('AdsKeywordsUnifiedPerformanceView settings', () => {
	registerAdsKeywordsUnifiedTestLifecycle();

	it('광고 검색어 분석도 캠페인 분석과 같은 헤더 설정 모달을 제공하고 구매전환 헤더를 숨길 수 있다', async () => {
		fetchSearchwordDailyMock.mockResolvedValue([
			{
				date: '2026-01-01',
				searchword: '구매검색어',
				campaign_name: 'CAMP_A',
				adgroup_name: 'ADG_A',
				impressions: 10,
				clicks: 2,
				cost: 100,
				conversions: 2,
				revenue: 10000,
				purchase_conversions: 1,
				purchase_revenue: 3000,
				ctr: 0.2,
				cpc: 50,
				cvr: 1,
				roas: 10000,
				device: 'ALL',
				source: 'test',
			},
		]);

		await renderAdsKeywordsUnifiedView(<AdsKeywordsPerformanceView apiBaseUrl="http://example.test" />);

		await waitFor(() => expect(fetchSearchwordDailyMock).toHaveBeenCalled());

		expect(screen.getByText('총전환수')).toBeTruthy();
		expect(screen.getByText('구매전환수')).toBeTruthy();
		expect(screen.getByText('총전환매출액')).toBeTruthy();
		expect(screen.getByText('구매전환매출액')).toBeTruthy();
		expect(screen.getByText('구매전환수익율(%)')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '사용자 설정' }));
		const dialog = screen.getByRole('dialog', { name: '광고 검색어 분석 헤더 설정' });
		expect(dialog).toBeTruthy();
		expect(screen.getByLabelText('구매전환수')).toBeTruthy();
		expect(screen.getByLabelText('구매전환매출액')).toBeTruthy();
		expect(screen.getByLabelText('구매전환수익율(%)')).toBeTruthy();

		await clickWithAct(screen.getByLabelText('구매전환수'));
		await clickWithAct(screen.getByLabelText('구매전환매출액'));
		await clickWithAct(screen.getByLabelText('구매전환수익율(%)'));
		await clickWithAct(screen.getAllByRole('button', { name: '닫기' })[0]!);

		await waitFor(() => {
			const headers = screen.getAllByRole('columnheader').map((node) => node.textContent || '');
			expect(headers).not.toContain('구매전환수');
			expect(headers).not.toContain('구매전환매출액');
			expect(headers).not.toContain('구매전환수익율(%)');
		});
	});

	it('검색어 통합 상태에서 헤더 설정을 바꿔도 숨김 상태가 유지되고 재조회하지 않는다', async () => {
		fetchSearchwordDailyMock.mockResolvedValue([
			{
				date: '2026-01-01',
				searchword: 'merge-safe',
				campaign_name: 'CAMP_A',
				adgroup_name: 'ADG_A',
				impressions: 10,
				clicks: 2,
				cost: 100,
				conversions: 1,
				revenue: 10000,
				purchase_conversions: 1,
				purchase_revenue: 5000,
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

		await clickWithAct(screen.getByRole('button', { name: '사용자 설정' }));
		expect(screen.getByRole('dialog', { name: '광고 검색어 분석 헤더 설정' })).toBeTruthy();
		await clickWithAct(screen.getByLabelText('캠페인'));
		await clickWithAct(screen.getAllByRole('button', { name: '닫기' })[0]!);

		await waitFor(() => {
			const headers = screen.getAllByRole('columnheader').map((node) => node.textContent || '');
			expect(headers).not.toContain('캠페인');
		});

		const callsBefore = (fetchSearchwordDailyMock.mock?.calls ?? []).length;
		await clickWithAct(screen.getByRole('button', { name: '검색어 통합' }));

		await waitFor(() => {
			const callsAfter = (fetchSearchwordDailyMock.mock?.calls ?? []).length;
			expect(callsAfter).toBe(callsBefore);
		});

		await clickWithAct(screen.getByRole('button', { name: '사용자 설정' }));
		expect(screen.getByRole('dialog', { name: '광고 검색어 분석 헤더 설정' })).toBeTruthy();
		await clickWithAct(screen.getByLabelText('노출수'));
		await clickWithAct(screen.getAllByRole('button', { name: '닫기' })[0]!);

		await waitFor(() => {
			const headers = screen.getAllByRole('columnheader').map((node) => node.textContent || '');
			expect(headers).not.toContain('노출수');
		});

		await clickWithAct(screen.getByRole('button', { name: '검색어 통합' }));

		await waitFor(() => {
			const callsAfter = (fetchSearchwordDailyMock.mock?.calls ?? []).length;
			expect(callsAfter).toBe(callsBefore);
			const headers = screen.getAllByRole('columnheader').map((node) => node.textContent || '');
			expect(headers).not.toContain('캠페인');
			expect(headers).not.toContain('노출수');
		});
	});
});
