import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	mockedAxios,
	registerRankTrackingDetailTestLifecycle,
	renderRankTrackingDetailView,
	sampleHistory,
	sampleProduct,
} from './RankTrackingDetailView.testUtils';
import { RankTrackingDetailView } from './RankTrackingDetailView';
import type { RankHistory } from './rankUtils';

describe('RankTrackingDetailView manual keywords', () => {
	registerRankTrackingDetailTestLifecycle();

	it('수기 입력 키워드 데일리 표에서 선택 삭제를 누르면 /search-rank/manual-keywords/delete-meta로 POST한다', async () => {
		mockedAxios.post.mockResolvedValue({ data: { deleted: 2 } });
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

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

		await clickWithAct(screen.getByLabelText('수기 키워드 선택 수기키워드A'));
		const manualCard = screen.getByText('수기 입력 키워드').closest('.card') as HTMLElement;
		await clickWithAct(within(manualCard).getByRole('button', { name: '선택 삭제' }));

		await waitFor(() => {
			const calls = mockedAxios.post.mock.calls.map((c: any[]) => ({ url: String(c[0] || ''), payload: c[1] }));
			const delCall = calls.find((c: { url: string; payload: unknown }) => c.url.includes('/search-rank/manual-keywords/delete-meta'));
			expect(delCall).toBeTruthy();
		});

		confirmSpy.mockRestore();
	});

	it('수기 입력 키워드 표에서 등록 키워드 검색으로 행을 필터링할 수 있다', async () => {
		const manualHistory: RankHistory = {
			dates: ['2026-01-18'],
			series: [
				{ keyword: '수기키워드A', series: [{ date: '2026-01-18', rank: 3 }] },
				{ keyword: '수기키워드B', series: [{ date: '2026-01-18', rank: 8 }] },
			],
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

		const manualCard = screen.getByText('수기 입력 키워드').closest('.card') as HTMLElement;
		expect(within(manualCard).getByText('수기키워드A')).toBeTruthy();
		expect(within(manualCard).getByText('수기키워드B')).toBeTruthy();

		await changeWithAct(within(manualCard).getByLabelText('수기 키워드 검색'), { target: { value: 'A' } });
		expect(within(manualCard).getByText('수기키워드A')).toBeTruthy();
		expect(within(manualCard).queryByText('수기키워드B')).toBeNull();
	});

	it('수기 입력 키워드 표에서 월검색량/추천키워드(추적) 정렬이 동작한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url || '').includes('/search-rank/manual-keywords')) {
				return Promise.resolve({
					data: [
						{ keyword: '수기키워드A', monthly_search_volume: 100, monthly_search_volume_label: null },
						{ keyword: '수기키워드B', monthly_search_volume: 200, monthly_search_volume_label: null },
					],
				});
			}
			return Promise.resolve({ data: [] });
		});

		const manualHistory: RankHistory = {
			dates: ['2026-01-18'],
			series: [
				{ keyword: '수기키워드A', series: [{ date: '2026-01-18', rank: 3 }] },
				{ keyword: '수기키워드B', series: [{ date: '2026-01-18', rank: 8 }] },
			],
		};

		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				manualHistory={manualHistory}
				trackedKeywords={[{ keyword: '수기키워드A', monthly_search_volume: 100 }]}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);

		const manualCard = screen.getByText('수기 입력 키워드').closest('.card') as HTMLElement;

		await clickWithAct(within(manualCard).getByRole('button', { name: '수기 표 정렬 월검색량' }));
		const rows1 = manualCard.querySelectorAll('tbody tr');
		expect(rows1.length).toBeGreaterThan(0);
		expect(rows1[0]?.textContent || '').toContain('수기키워드A');

		await clickWithAct(within(manualCard).getByRole('button', { name: '수기 표 정렬 월검색량' }));
		await waitFor(() => {
			const rows2 = manualCard.querySelectorAll('tbody tr');
			expect(rows2.length).toBeGreaterThan(0);
			expect(rows2[0]?.textContent || '').toContain('수기키워드B');
		});
	});
});
