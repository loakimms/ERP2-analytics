import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AdsCreativesTable } from './AdsCreativesTable';
import { createCreativeRow } from './AdsCreativesTable.testUtils';

describe('AdsCreativesTable metrics/columns', () => {
	it('메타 값(입찰가/지수/점수)은 소수점이 과도하게 길게 나오지 않고, 비교기간 대비 변동 뱃지를 표시한다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				creativeId: 'nad-a001-01-000000000000001',
				creativeName: '헤드라인',
				currentBid: 1154,
				prevCurrentBid: 1000,
				qualityIndex: 7.857142857142857,
				prevQualityIndex: 7.0,
				avgRank: 9.714285714285714,
				prevAvgRank: 9.0,
				deltas: {
					impressions: { diff: 0, pct: 0 },
					clicks: { diff: 0, pct: 0 },
					cost: { diff: 100, pct: (100 / 900) * 100 },
					conversions: { diff: 0, pct: null },
					revenue: { diff: 0, pct: null },
					ctr: { diff: 0, pct: 0 },
					cpc: { diff: 100, pct: (100 / 900) * 100 },
					cvr: { diff: 0, pct: null },
					roas: { diff: 0, pct: null },
				},
				prevMetrics: { impressions: 10, clicks: 1, cost: 900, conversions: 0, revenue: 0, ctr: 10, cpc: 900, cvr: 0, roas: 0 },
			}),
			createCreativeRow({
				key: 'k2',
				creativeId: 'nad-a001-01-000000000000003',
				creativeName: '헤드라인2',
				qualityIndex: null,
				prevQualityIndex: null,
				avgRank: null,
				prevAvgRank: null,
				metrics: { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0, ctr: 0, cpc: 0, cvr: 0, roas: 0 },
				prevMetrics: { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0, ctr: 0, cpc: 0, cvr: 0, roas: 0 },
			}),
		];

		render(<AdsCreativesTable title="t" rows={rows} mode="powerlink" />);

		expect(screen.getByText('1,154원')).toBeTruthy();
		expect(screen.getByText('7.86')).toBeTruthy();
		expect(screen.getByText('9.71')).toBeTruthy();
		expect(screen.getAllByText(/▲/).length).toBeGreaterThan(0);
		expect(screen.getAllByTitle('비교기간 대비 증감(변동없음)').length).toBeGreaterThan(0);
		expect(screen.getAllByTitle('비교기간 대비 증감(비교불가/미수집)').length).toBeGreaterThan(0);
	});

	it('소재 분석도 구매전환 컬럼을 표시할 수 있다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				adType: 'SHOPPING_PRODUCT_AD',
				productTitle: '상품A',
				currentBid: 1000,
				prevCurrentBid: 900,
				prevQualityIndex: 6,
				prevAvgRank: 3.0,
				metrics: { impressions: 100, clicks: 10, cost: 10000, conversions: 4, revenue: 40000, ctr: 10, cpc: 1000, cvr: 40, roas: 400 },
				prevMetrics: { impressions: 80, clicks: 8, cost: 8000, conversions: 2, revenue: 20000, ctr: 10, cpc: 1000, cvr: 25, roas: 250 },
				deltas: {
					impressions: { diff: 20, pct: 25 },
					clicks: { diff: 2, pct: 25 },
					cost: { diff: 2000, pct: 25 },
					conversions: { diff: 2, pct: 100 },
					revenue: { diff: 20000, pct: 100 },
					ctr: { diff: 0, pct: 0 },
					cpc: { diff: 0, pct: 0 },
					cvr: { diff: 15, pct: 60 },
					roas: { diff: 150, pct: 60 },
				},
				purchaseMetrics: { conversions: 3, revenue: 30000 },
				prevPurchaseMetrics: { conversions: 1, revenue: 10000 },
				cpa: 2500,
				prevCpa: 4000,
				cpaDiff: -1500,
				cpaPct: -37.5,
			}),
		];

		render(<AdsCreativesTable title="t" rows={rows} mode="shopping" />);

		expect(screen.getByText('구매전환수')).toBeTruthy();
		expect(screen.getByText('구매전환율(%)')).toBeTruthy();
		expect(screen.getByText('구매전환매출액')).toBeTruthy();
		expect(screen.getByText('구매전환수익율(%)')).toBeTruthy();
		expect(screen.getAllByText('3').length).toBeGreaterThan(0);
		expect(screen.getAllByText('30.00%').length).toBeGreaterThan(0);
		expect(screen.getAllByText('30,000원').length).toBeGreaterThan(0);
		expect(screen.getAllByText('300.00%').length).toBeGreaterThan(0);
	});

	it('소계(그룹합계)에 구매전환수익율을 계산해 표시한다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				adType: 'SHOPPING_PRODUCT_AD',
				productTitle: '상품A',
				metrics: { impressions: 100, clicks: 10, cost: 10000, conversions: 4, revenue: 40000, ctr: 10, cpc: 1000, cvr: 40, roas: 400 },
				prevMetrics: { impressions: 80, clicks: 8, cost: 8000, conversions: 2, revenue: 20000, ctr: 10, cpc: 1000, cvr: 25, roas: 250 },
				deltas: {
					impressions: { diff: 20, pct: 25 },
					clicks: { diff: 2, pct: 25 },
					cost: { diff: 2000, pct: 25 },
					conversions: { diff: 2, pct: 100 },
					revenue: { diff: 20000, pct: 100 },
					ctr: { diff: 0, pct: 0 },
					cpc: { diff: 0, pct: 0 },
					cvr: { diff: 15, pct: 60 },
					roas: { diff: 150, pct: 60 },
				},
				purchaseMetrics: { conversions: 3, revenue: 30000 },
				prevPurchaseMetrics: { conversions: 1, revenue: 10000 },
			}),
			createCreativeRow({
				key: 'k2',
				adType: 'SHOPPING_PRODUCT_AD',
				productTitle: '상품B',
				metrics: { impressions: 40, clicks: 4, cost: 5000, conversions: 1, revenue: 8000, ctr: 10, cpc: 1250, cvr: 25, roas: 160 },
				prevMetrics: { impressions: 30, clicks: 3, cost: 4000, conversions: 1, revenue: 7000, ctr: 10, cpc: 1333.33, cvr: 33.33, roas: 175 },
				deltas: {
					impressions: { diff: 10, pct: (10 / 30) * 100 },
					clicks: { diff: 1, pct: (1 / 3) * 100 },
					cost: { diff: 1000, pct: 25 },
					conversions: { diff: 0, pct: 0 },
					revenue: { diff: 1000, pct: (1000 / 7000) * 100 },
					ctr: { diff: 0, pct: 0 },
					cpc: { diff: 1250 - 1333.33, pct: ((1250 - 1333.33) / 1333.33) * 100 },
					cvr: { diff: 25 - 33.33, pct: ((25 - 33.33) / 33.33) * 100 },
					roas: { diff: 160 - 175, pct: ((160 - 175) / 175) * 100 },
				},
				purchaseMetrics: { conversions: 1, revenue: 5000 },
				prevPurchaseMetrics: { conversions: 1, revenue: 4000 },
			}),
		];

		render(<AdsCreativesTable title="t" rows={rows} mode="shopping" />);

		expect(screen.getAllByText('233.33%').length).toBeGreaterThan(0);
	});

	it('헤더가 많을 때 하단 가로 스크롤 영역을 렌더링한다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				adType: 'SHOPPING_PRODUCT_AD',
				productTitle: '상품A',
				purchaseMetrics: { conversions: 1, revenue: 15000 },
				prevPurchaseMetrics: { conversions: 0, revenue: 0 },
			}),
		];

		render(<AdsCreativesTable title="t" rows={rows} mode="shopping" />);

		expect(screen.getByLabelText('ads-creatives-table-scrollbar-top')).toBeTruthy();
		expect(screen.getByLabelText('ads-creatives-table-scrollbar-bottom')).toBeTruthy();
	});

	it('visibleColumnKeys로 소재 헤더를 개별 숨길 수 있다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				currentBid: 1000,
				prevCurrentBid: 900,
				prevQualityIndex: 6,
				prevAvgRank: 3.0,
				metrics: { impressions: 100, clicks: 10, cost: 10000, conversions: 4, revenue: 40000, ctr: 10, cpc: 1000, cvr: 40, roas: 400 },
				prevMetrics: { impressions: 80, clicks: 8, cost: 8000, conversions: 2, revenue: 20000, ctr: 10, cpc: 1000, cvr: 25, roas: 250 },
				deltas: {
					impressions: { diff: 20, pct: 25 },
					clicks: { diff: 2, pct: 25 },
					cost: { diff: 2000, pct: 25 },
					conversions: { diff: 2, pct: 100 },
					revenue: { diff: 20000, pct: 100 },
					ctr: { diff: 0, pct: 0 },
					cpc: { diff: 0, pct: 0 },
					cvr: { diff: 15, pct: 60 },
					roas: { diff: 150, pct: 60 },
				},
				purchaseMetrics: { conversions: 3, revenue: 30000 },
				prevPurchaseMetrics: { conversions: 1, revenue: 10000 },
				cpa: 2500,
				prevCpa: 4000,
				cpaDiff: -1500,
				cpaPct: -37.5,
			}),
		];

		render(
			<AdsCreativesTable
				title="t"
				rows={rows}
				mode="powerlink"
				visibleColumnKeys={['creative', 'conversions', 'purchase_conversions', 'purchase_cvr', 'revenue', 'purchase_revenue', 'purchase_roas']}
			/>,
		);

		expect(screen.getByText('키워드')).toBeTruthy();
		expect(screen.getByText('구매전환수')).toBeTruthy();
		expect(screen.getByText('구매전환율(%)')).toBeTruthy();
		expect(screen.getByText('구매전환수익율(%)')).toBeTruthy();
		expect(screen.queryByText('현재입찰가')).toBeNull();
		expect(screen.queryByText('클릭수')).toBeNull();
	});

	it('소재 분석의 변동 %도 소수점 없이 정수로 표시한다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				currentBid: 1000,
				prevCurrentBid: 1000,
				metrics: { impressions: 100, clicks: 10, cost: 1000, conversions: 1, revenue: 5000, ctr: 10, cpc: 100, cvr: 10, roas: 500 },
				prevMetrics: { impressions: 90, clicks: 9, cost: 900, conversions: 1, revenue: 4500, ctr: 10, cpc: 100, cvr: 11.111111, roas: 500 },
				deltas: {
					impressions: { diff: 10, pct: (10 / 90) * 100 },
					clicks: { diff: 1, pct: (1 / 9) * 100 },
					cost: { diff: 100, pct: (100 / 900) * 100 },
					conversions: { diff: 0, pct: 0 },
					revenue: { diff: 500, pct: (500 / 4500) * 100 },
					ctr: { diff: 0, pct: 0 },
					cpc: { diff: 0, pct: 0 },
					cvr: { diff: -1.111111, pct: -10 },
					roas: { diff: 0, pct: 0 },
				},
				cpa: 1000,
				prevCpa: 900,
				cpaDiff: 100,
				cpaPct: (100 / 900) * 100,
			}),
		];

		render(<AdsCreativesTable title="t" rows={rows} mode="powerlink" />);

		expect(screen.getAllByText(/\(11%\)/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/\(11\.11%\)/)).toBeNull();
	});
});
