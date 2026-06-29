import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { mockSalesAnalysisApi, registerSalesAnalysisTestLifecycle, renderSalesAnalysisView } from './SalesAnalysisView.testUtils';
import { SalesAnalysisView } from './SalesAnalysisView';

describe('SalesAnalysisView coverage', () => {
	registerSalesAnalysisTestLifecycle();

	it('주문 기반 조회 시 커버리지 진단 카드와 하이라이트를 표시한다', async () => {
		mockSalesAnalysisApi();

		await renderSalesAnalysisView(<SalesAnalysisView apiBaseUrl="http://localhost:9999" />);

		expect(await screen.findByText('데이터 커버리지 진단')).toBeTruthy();
		expect(
			await screen.findByText((_, el) => String(el?.textContent || '').replace(/\s+/g, '') === '실패일1일'),
		).toBeTruthy();
		expect(
			await screen.findByText((_, el) => String(el?.textContent || '').replace(/\s+/g, '') === '미확인일1일'),
		).toBeTruthy();
		expect(
			await screen.findByText((_, el) => String(el?.textContent || '').replace(/\s+/g, '') === 'raw만있는날짜1일'),
		).toBeTruthy();
		expect(
			await screen.findByText((_, el) => String(el?.textContent || '').replace(/\s+/g, '') === '지연확인중날짜1일'),
		).toBeTruthy();
		expect(
			await screen.findByText((_, el) => String(el?.textContent || '').replace(/\s+/g, '') === '현재소스기준빈날짜1일'),
		).toBeTruthy();
		expect(await screen.findByText(/2026-03-10/)).toBeTruthy();
		expect(
			await screen.findByText((_, el) => String(el?.textContent || '').replace(/\s+/g, '') === '주문원천재확인날짜1일'),
		).toBeTruthy();

		const failedHighlight = await screen.findByTestId('sales-coverage-highlight-row-2026-03-12');
		expect(failedHighlight).toHaveTextContent('2026-03-12');
		expect(failedHighlight).toHaveTextContent('수집 실패');
		expect(failedHighlight).toHaveTextContent('허용 IP 미등록');
		expect(failedHighlight).toHaveTextContent('커머스 API 센터의 허용 IP에 현재 공인 IP를 추가해야 합니다.');
		expect(failedHighlight).toHaveTextContent('원인 코드: GW.IP_NOT_ALLOWED');
		expect(failedHighlight).toHaveClass('sales-coverage-highlight-item is-danger');

		const normalHighlight = await screen.findByTestId('sales-coverage-highlight-chip-2026-03-11');
		expect(normalHighlight).toHaveTextContent('2026-03-11');
		expect(normalHighlight).toHaveTextContent('raw만 있음');
		expect(await screen.findByText(/2026-03-13/)).toBeTruthy();
	});
});
