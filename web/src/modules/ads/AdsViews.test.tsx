import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
	getAdsJobCacheMocks,
	registerAdsViewsTestLifecycle,
	renderAdsRoutes,
} from './AdsViews.testUtils';

const adsJobCacheMocks = getAdsJobCacheMocks();

describe('AdsViews campaign settings', () => {
	registerAdsViewsTestLifecycle();

	it('캠페인 분석에서 사용자 설정 모달로 헤더를 숨길 수 있다', async () => {
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
							metrics: { impressions: 100, clicks: 10, ctr: 10, cpc: 1000, cost: 10000, conversions: 2, cvr: 20, revenue: 20000, roas: 200 },
							prevMetrics: { impressions: 90, clicks: 9, ctr: 10, cpc: 1000, cost: 9000, conversions: 1, cvr: 11.11, revenue: 10000, roas: 111.11 },
							deltas: {
								impressions: { diff: 10, pct: 11.11 },
								clicks: { diff: 1, pct: 11.11 },
								ctr: { diff: 0, pct: 0 },
								cpc: { diff: 0, pct: 0 },
								cost: { diff: 1000, pct: 11.11 },
								conversions: { diff: 1, pct: 100 },
								cvr: { diff: 8.89, pct: 80 },
								revenue: { diff: 10000, pct: 100 },
								roas: { diff: 88.89, pct: 80 },
							},
							status: { label: 'ELIGIBLE', isActive: true },
						},
					],
					totalRow: null,
				},
			});
			return () => {};
		});

		render(renderAdsRoutes('/analytics/campaign/campaigns'));

		fireEvent.click(screen.getByRole('button', { name: '사용자 설정' }));
		const dialog = screen.getByRole('dialog', { name: '캠페인 분석 헤더 설정' });
		expect(dialog).toBeTruthy();
		fireEvent.click(screen.getByLabelText('노출수'));
		fireEvent.click(within(dialog).getAllByRole('button', { name: '닫기' })[0]!);

		await waitFor(() => expect(screen.queryByText('노출수')).toBeNull());
		expect(screen.getByText('클릭수')).toBeTruthy();
	});
});

