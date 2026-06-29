import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AdsTable, type AdsRow } from './AdsTables';

function mkRow(partial: Partial<AdsRow> & Pick<AdsRow, 'key' | 'primary'>): AdsRow {
	return {
		key: partial.key,
		status: partial.status,
		primary: partial.primary,
		secondary: partial.secondary ?? null,
		tertiary: partial.tertiary ?? null,
		metrics: partial.metrics ?? {
			impressions: 0,
			clicks: 0,
			ctr: 0,
			cpc: 0,
			cost: 0,
			conversions: 0,
			cvr: 0,
			revenue: 0,
			roas: 0,
		},
		prevMetrics: partial.prevMetrics ?? {
			impressions: 0,
			clicks: 0,
			ctr: 0,
			cpc: 0,
			cost: 0,
			conversions: 0,
			cvr: 0,
			revenue: 0,
			roas: 0,
		},
		deltas: partial.deltas ?? {
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
		purchaseMetrics: partial.purchaseMetrics,
		prevPurchaseMetrics: partial.prevPurchaseMetrics,
	};
}

describe('AdsTable', () => {
	it('columns 순서대로 헤더와 바디가 동일한 순서로 렌더링된다 (secondary -> primary)', () => {
		const rows: AdsRow[] = [mkRow({ key: '1', primary: 'ADGROUP_A', secondary: 'CAMP_A' })];

		render(
			<AdsTable
				title="광고 그룹 분석"
				columns={[
					{ key: 'secondary', label: '캠페인' },
					{ key: 'primary', label: '광고그룹' },
				]}
				rows={rows}
			/>,
		);

		// 헤더는 columns 순서대로
		const header = screen.getAllByRole('row')[0];
		const headerCells = within(header!).getAllByRole('columnheader');
		expect(headerCells[0]?.textContent ?? '').toContain('캠페인');
		expect(headerCells[1]?.textContent ?? '').toContain('광고그룹');

		// 바디도 columns 순서대로: (캠페인=CAMP_A) -> (광고그룹=ADGROUP_A)
		const bodyRow = screen.getAllByRole('row')[1];
		const bodyCells = within(bodyRow!).getAllByRole('cell');
		expect(bodyCells[0]?.textContent).toBe('CAMP_A');
		expect(bodyCells[1]?.textContent).toBe('ADGROUP_A');
	});

	it('기본 정렬은 비용(cost) 내림차순이다', () => {
		const rows: AdsRow[] = [
			mkRow({ key: 'a', primary: 'A', metrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 100, conversions: 0, cvr: 0, revenue: 0, roas: 0 } }),
			mkRow({ key: 'b', primary: 'B', metrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 300, conversions: 0, cvr: 0, revenue: 0, roas: 0 } }),
			mkRow({ key: 'c', primary: 'C', metrics: { impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 200, conversions: 0, cvr: 0, revenue: 0, roas: 0 } }),
		];

		render(
			<AdsTable
				title="광고 캠페인 분석"
				columns={[{ key: 'primary', label: '캠페인' }]}
				rows={rows}
			/>,
		);

		// 첫 번째 바디 행이 cost=300(B) 이어야 한다.
		const bodyRows = screen.getAllByRole('row').slice(1); // header 제외
		expect(bodyRows.length).toBeGreaterThanOrEqual(3);
		const firstRowCells = within(bodyRows[0]!).getAllByRole('cell');
		expect(firstRowCells[0]?.textContent).toBe('B');
	});

	it('구매전환 지표가 있으면 총/구매 전환 헤더를 함께 렌더링한다', () => {
		const rows: AdsRow[] = [
			mkRow({
				key: 'a',
				primary: 'A',
				purchaseMetrics: { conversions: 2, revenue: 10000 },
				prevPurchaseMetrics: { conversions: 1, revenue: 5000 },
			}),
		];

		render(
			<AdsTable
				title="캠페인 분석"
				columns={[{ key: 'primary', label: '캠페인' }]}
				rows={rows}
			/>,
		);

		expect(screen.getByText('총전환수')).toBeTruthy();
		expect(screen.getByText('구매전환수')).toBeTruthy();
		expect(screen.getByText('구매전환율(%)')).toBeTruthy();
		expect(screen.getByText('총전환매출액')).toBeTruthy();
		expect(screen.getByText('구매전환매출액')).toBeTruthy();
		expect(screen.getByText('구매전환수익율(%)')).toBeTruthy();
	});

	it('visibleMetricKeys로 성과 헤더를 개별 숨길 수 있다', () => {
		const rows: AdsRow[] = [mkRow({ key: 'a', primary: 'A' })];

		render(
			<AdsTable
				title="캠페인 분석"
				columns={[{ key: 'primary', label: '캠페인' }]}
				rows={rows}
				visibleMetricKeys={['impressions', 'cost']}
			/>,
		);

		expect(screen.getByText('노출수')).toBeTruthy();
		expect(screen.getByText('총비용')).toBeTruthy();
		expect(screen.queryByText('클릭수')).toBeNull();
		expect(screen.queryByText(/전환수/)).toBeNull();
	});

	it('변동 %는 소수점 없이 정수로 표시한다', () => {
		const rows: AdsRow[] = [
			mkRow({
				key: 'a',
				primary: 'A',
				metrics: { impressions: 100, clicks: 0, ctr: 0, cpc: 0, cost: 1000, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
				prevMetrics: { impressions: 90, clicks: 0, ctr: 0, cpc: 0, cost: 900, conversions: 0, cvr: 0, revenue: 0, roas: 0 },
				deltas: {
					impressions: { diff: 10, pct: (10 / 90) * 100 },
					clicks: { diff: 0, pct: null },
					ctr: { diff: 0, pct: null },
					cpc: { diff: 0, pct: null },
					cost: { diff: 100, pct: (100 / 900) * 100 },
					conversions: { diff: 0, pct: null },
					cvr: { diff: 0, pct: null },
					revenue: { diff: 0, pct: null },
					roas: { diff: 0, pct: null },
				},
			}),
		];

		render(
			<AdsTable
				title="캠페인 분석"
				columns={[{ key: 'primary', label: '캠페인' }]}
				rows={rows}
			/>,
		);

		expect(screen.getAllByText(/\(11%\)/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/\(11\.11%\)/)).toBeNull();
	});
});

