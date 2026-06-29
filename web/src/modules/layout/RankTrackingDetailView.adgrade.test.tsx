import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import {
	fetchPurchaseKeywordsDailyMock,
	fetchSearchwordDailyMock,
	mockedAxios,
	registerRankTrackingDetailTestLifecycle,
	renderRankTrackingDetailView,
	sampleHistory,
	sampleProduct,
} from './RankTrackingDetailView.testUtils';
import { RankTrackingDetailView, calcAdGradePopoverLayout } from './RankTrackingDetailView';
import type { RankHistory } from './rankUtils';

describe('RankTrackingDetailView ad grade', () => {
	registerRankTrackingDetailTestLifecycle();

	it('광고전환등급 배지에 마우스를 올리면 등급 선별 조건 팝오버를 보여준다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url || '').includes('/search-rank/manual-keywords')) {
				return Promise.resolve({
					data: [{ keyword: '수기키워드A', monthly_search_volume: 100, monthly_search_volume_label: null }],
				});
			}
			return Promise.resolve({ data: [] });
		});

		fetchSearchwordDailyMock.mockResolvedValue([
			{
				date: '2026-01-18',
				searchword: '수기키워드A',
				campaign_name: '캠페인A',
				adgroup_name: '그룹A',
				conversions: 5,
				clicks: 20,
				cvr: 25,
			},
			{
				date: '2026-01-18',
				searchword: '기타키워드',
				campaign_name: '캠페인B',
				adgroup_name: '그룹B',
				conversions: 1,
				clicks: 10,
				cvr: 10,
			},
		]);
		fetchPurchaseKeywordsDailyMock.mockResolvedValue([
			{
				date: '2026-01-18',
				product_name: sampleProduct.name,
				keyword: '수기키워드A',
				payments: 2,
			},
		]);

		const manualHistory: RankHistory = {
			dates: ['2026-01-18'],
			series: [{ keyword: '수기키워드A', series: [{ date: '2026-01-18', rank: 3 }] }],
		};

		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				manualHistory={manualHistory}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);

		const badge = await screen.findByText('매우우수');
		const anchor = badge.closest('.rank-detail-ad-grade-anchor') as HTMLElement | null;
		expect(anchor).toBeTruthy();
		fireEvent.mouseEnter(anchor as HTMLElement);

		const tooltip = await screen.findByRole('tooltip', { name: '광고전환등급 기준 안내 매우우수' });
		expect(tooltip).toBeTruthy();
		expect(tooltip.parentElement).toBe(document.body);
		expect(tooltip).toHaveStyle({ position: 'fixed' });
		expect(screen.getByText('최근 30일 광고 전환 기준')).toBeTruthy();
		expect(screen.getByText(/전환수 5건 이상/)).toBeTruthy();
		expect(screen.getByText(/전환수 2건 이상이면서 전체 광고 전환의 10% 이상/)).toBeTruthy();
		expect(screen.getByText(/현재 키워드 기준/)).toBeTruthy();
		expect(screen.getByText(/광고 전환 비중 83\.33%/)).toBeTruthy();
	});

	it('광고전환등급 팝오버 위치를 화면 하단에서는 위쪽으로 자동 조정한다', () => {
		const layout = calcAdGradePopoverLayout({
			anchorRect: {
				top: 620,
				left: 420,
				bottom: 650,
				width: 72,
			},
			viewportWidth: 1024,
			viewportHeight: 720,
			popoverWidth: 320,
			popoverHeight: 340,
		});

		expect(layout.dataPlacement).toBe('top');
		expect(layout.top).toBeLessThan(620);
		expect(layout.left).toBeGreaterThanOrEqual(12);
	});

	it('광고전환등급 팝오버 위치를 화면 좌우 경계 안으로 자동 보정한다', () => {
		const leftEdgeLayout = calcAdGradePopoverLayout({
			anchorRect: {
				top: 240,
				left: 4,
				bottom: 270,
				width: 60,
			},
			viewportWidth: 360,
			viewportHeight: 740,
			popoverWidth: 320,
			popoverHeight: 340,
		});
		const rightEdgeLayout = calcAdGradePopoverLayout({
			anchorRect: {
				top: 240,
				left: 330,
				bottom: 270,
				width: 48,
			},
			viewportWidth: 390,
			viewportHeight: 740,
			popoverWidth: 320,
			popoverHeight: 340,
		});

		expect(leftEdgeLayout.left).toBe(12);
		expect(rightEdgeLayout.left).toBeLessThanOrEqual(390 - Number(rightEdgeLayout.width) - 12);
		expect(leftEdgeLayout.dataPlacement).toBe('bottom');
		expect(rightEdgeLayout.dataPlacement).toBe('bottom');
	});

	it('광고전환등급 팝오버 크기를 화면 크기에 맞게 줄인다', () => {
		const desktopLayout = calcAdGradePopoverLayout({
			anchorRect: {
				top: 300,
				left: 500,
				bottom: 330,
				width: 72,
			},
			viewportWidth: 1280,
			viewportHeight: 900,
			popoverWidth: 520,
			popoverHeight: 720,
		});
		const mobileLayout = calcAdGradePopoverLayout({
			anchorRect: {
				top: 240,
				left: 120,
				bottom: 270,
				width: 72,
			},
			viewportWidth: 320,
			viewportHeight: 640,
			popoverWidth: 520,
			popoverHeight: 720,
		});

		expect(desktopLayout.width).toBe(380);
		expect(desktopLayout.maxHeight).toBeLessThanOrEqual(440);
		expect(mobileLayout.width).toBeLessThanOrEqual(320 - 24);
		expect(mobileLayout.maxHeight).toBeLessThanOrEqual(340);
	});
});
