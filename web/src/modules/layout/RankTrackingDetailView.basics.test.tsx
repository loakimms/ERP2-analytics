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
import type { RankTrackingDetailProduct } from './RankTrackingDetailView';
import type { RankHistory } from './rankUtils';

describe('RankTrackingDetailView basics', () => {
	registerRankTrackingDetailTestLifecycle();

	it('월검색량 텍스트를 저장하면 /search-rank/manual-keywords/import로 POST한다', async () => {
		mockedAxios.post.mockResolvedValue({ data: { saved: 2, total_active: 2 } });

		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);

		await changeWithAct(screen.getByLabelText('월검색량 입력 텍스트'), {
			target: { value: '염색약 51000\n헤나 7440' },
		});
		await clickWithAct(screen.getByRole('button', { name: '월검색량 저장' }));

		await waitFor(() => {
			const calls = mockedAxios.post.mock.calls.map((c: any[]) => ({ url: String(c[0] || ''), payload: c[1] }));
			const call = calls.find((c: { url: string; payload: unknown }) => c.url.includes('/search-rank/manual-keywords/import'));
			expect(call).toBeTruthy();
		});
	});

	it('추적 키워드 모드가 상품별로 저장되어 서로 영향이 없어야 한다', async () => {
		mockedAxios.post.mockResolvedValue({ data: { saved: 0, total_active: 0 } });
		mockedAxios.get.mockResolvedValue({ data: [] });

		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);
		expect(screen.getByRole('button', { name: '초기단계' })).toHaveStyle({ fontWeight: '900' });

		const p2: RankTrackingDetailProduct = { ...sampleProduct, id: 'p2', name: '다른 상품' };
		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={p2}
				history={sampleHistory}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);
		const focusButtons = screen.getAllByRole('button', { name: '집중단계' });
		expect(focusButtons[focusButtons.length - 1]).toHaveStyle({ fontWeight: '900' });
	});

	it('상품 기본 정보를 렌더링한다', async () => {
		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				trackedKeywords={[{ keyword: '새치염색', monthly_search_volume: 10630 }]}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);

		expect(screen.getByText(sampleProduct.name)).toBeTruthy();
		expect(screen.getByText('수자타헤나')).toBeTruthy();
		expect(screen.getByText(/14,000원/)).toBeTruthy();
		expect(screen.getByText(/리뷰 31,810/)).toBeTruthy();
		expect(screen.getByText(/평점 4\.68/)).toBeTruthy();
	});

	it('엑셀 업로드 버튼을 누르면 업로드 모달이 열린다', async () => {
		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);

		await clickWithAct(screen.getByRole('button', { name: '엑셀 업로드' }));
		expect(screen.getByRole('dialog', { name: '순위 엑셀 업로드' })).toBeTruthy();
	});

	it('추적 키워드를 10개 초과로 등록해도 상세 화면 리스트(칩)에는 전체가 노출된다', async () => {
		const tracked = Array.from({ length: 11 }, (_, i) => `키워드${i + 1}`);
		const limitedHistory: RankHistory = {
			dates: ['2025-12-20', '2025-12-21'],
			series: tracked.slice(0, 10).map((kw) => ({
				keyword: kw,
				series: [{ date: '2025-12-21', rank: 10 }],
			})),
		};

		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={limitedHistory}
				trackedKeywords={tracked.map((k) => ({ keyword: k, monthly_search_volume: null }))}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={vi.fn()}
			/>,
		);

		const chips = document.querySelector('.tracking-keyword-chips') as HTMLElement | null;
		expect(chips).toBeTruthy();
		const chipScope = within(chips as HTMLElement);

		for (const kw of tracked) {
			expect(chipScope.getByText(kw)).toBeTruthy();
		}
	});

	it('기간 셀렉트를 변경하면 콜백을 호출한다', async () => {
		const handlePeriod = vi.fn();

		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				period="7d"
				onPeriodChange={handlePeriod}
				onBackToList={vi.fn()}
			/>,
		);

		await changeWithAct(screen.getByDisplayValue('7일'), { target: { value: '30d' } });
		expect(handlePeriod).toHaveBeenCalledWith('30d');
	});

	it('목록으로 버튼을 누르면 뒤로가기 콜백을 호출한다', async () => {
		const handleBack = vi.fn();

		await renderRankTrackingDetailView(
			<RankTrackingDetailView
				apiBaseUrl="http://localhost:5189"
				product={sampleProduct}
				history={sampleHistory}
				period="7d"
				onPeriodChange={vi.fn()}
				onBackToList={handleBack}
			/>,
		);

		await clickWithAct(screen.getByRole('button', { name: '목록으로' }));
		expect(handleBack).toHaveBeenCalled();
	});
});
