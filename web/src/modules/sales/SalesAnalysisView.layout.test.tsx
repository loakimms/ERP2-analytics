import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { mockSalesAnalysisApi, registerSalesAnalysisTestLifecycle, renderSalesAnalysisView } from './SalesAnalysisView.testUtils';
import { SalesAnalysisView } from './SalesAnalysisView';

describe('SalesAnalysisView layout/source policy', () => {
	registerSalesAnalysisTestLifecycle();

	it('주문 기반 조회 시 소스 선택 UI 없이 레이아웃과 안내 문구를 유지한다', async () => {
		mockSalesAnalysisApi();

		await renderSalesAnalysisView(<SalesAnalysisView apiBaseUrl="http://localhost:9999" />);

		expect(screen.queryByLabelText('sales-source')).toBeNull();
		expect(screen.queryByLabelText('sales-category-breakdown')).toBeNull();
		expect(screen.getByTestId('sales-top-right-panel')).toHaveClass('sales-top-panel sales-top-panel-wide');
		expect(screen.queryByTestId('sales-top-right-actions')).toBeNull();
		expect(screen.getByTestId('sales-left-actions')).toHaveClass('sales-top-actions-grid');
		expect(screen.getByTestId('sales-coverage-metrics')).toHaveClass('sales-coverage-grid sales-coverage-grid-row');
		expect(screen.getByTestId('sales-sync-actions')).toHaveClass('sales-sync-grid sales-sync-grid-row');
		expect(screen.getByTestId('sales-charts-layout')).toHaveClass('sales-charts-layout');
		expect(screen.getByTestId('sales-chart-category-card')).toHaveClass('sales-chart-card-secondary');
		expect(screen.getByTestId('sales-chart-product-card')).toHaveClass('sales-chart-card-primary sales-chart-card-readable');
		expect(await screen.findByText(/차트는 Top 7만 보여줍니다/)).toBeTruthy();
		expect(await screen.findByText(/줄바꿈 없이 한 줄로 유지하고/)).toBeTruthy();
	});
});
