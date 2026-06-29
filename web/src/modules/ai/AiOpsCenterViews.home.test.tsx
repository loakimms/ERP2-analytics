import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';

import { clickWithAct, mockedAxios, registerAiOpsTestLifecycle, renderAiOpsView } from './AiOpsCenterViews.testUtils';
import { AiOpsHomeView } from '.';

function LocationProbe(props: { children: React.ReactNode }): JSX.Element {
	const location = useLocation();
	return (
		<>
			<div data-testid="current-location">{`${location.pathname}${location.search}`}</div>
			{props.children}
		</>
	);
}

describe('AiOpsCenterViews home', () => {
	registerAiOpsTestLifecycle();

	it('오늘의 실행 화면은 실제 홈 요약 데이터를 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/home')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							urgent_count: 3,
							pending_action_count: 2,
							high_priority_voc_count: 1,
							growth_opportunity_count: 1,
							faq_gap_count: 1,
							avg_data_quality_score: 0.91,
							operation_verified_count: 1,
							operation_learning_note: '예산 증액 학습 1건 검증 / 개선율 100%',
							action_bucket_counts: {
								BUDGET_INCREASE: 1,
								VOC_IMPROVEMENT: 1,
								FAQ_CONTENT_IMPROVEMENT: 1,
							},
						},
						items: [
							{
								sku_id: 'SKU-B',
								product_name: '상품B',
								policy_type: 'AD_GROWTH',
								action_bucket: 'BUDGET_INCREASE',
								top_issue: '광고 확장 기회',
								recommended_action_primary: '광고 확대',
								effective_priority_score: 95,
								priority_reason: '운영 학습 가중치 +19점: 예산 증액 검증 개선율 100%',
							},
							{
								sku_id: 'SKU-A',
								product_name: '상품A',
								policy_type: 'VOC_IMPROVEMENT_PRIORITY',
								action_bucket: 'VOC_IMPROVEMENT',
								top_issue: '리뷰 부정 비율 상승',
								recommended_action_primary: '리뷰 개선 우선',
								effective_priority_score: 88,
								priority_reason: '기본 우선순위 유지',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsHomeView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('운영 플로우')).toBeTruthy();
		expect(screen.getByText('1. 오늘의 실행')).toBeTruthy();
		expect(screen.getByRole('button', { name: '상품 판단' })).toBeTruthy();
		expect(screen.getByText(/현재 단계: 오늘의 실행 - 오늘의 실행/)).toBeTruthy();
		expect(await screen.findByText('3건')).toBeTruthy();
		expect(screen.getByText('2건')).toBeTruthy();
		expect(screen.getByText('91%')).toBeTruthy();
		expect(screen.getAllByText('1건').length).toBeGreaterThan(0);
		expect(screen.getByText(/예산 증액 학습 1건 검증/)).toBeTruthy();
		expect(screen.getByText(/예산 증액 1건/)).toBeTruthy();
		expect(screen.getByText(/리뷰 개선 1건/)).toBeTruthy();
		expect(screen.getByText('버킷별 운영 허브')).toBeTruthy();
		expect(screen.getByText(/대표 SKU 상품B/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'home-bucket-actions-BUDGET_INCREASE' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'home-bucket-policies-BUDGET_INCREASE' })).toBeTruthy();
		expect(screen.getAllByText(/상품B/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/상품A/).length).toBeGreaterThan(0);
		expect(screen.getByText(/BUDGET_INCREASE/)).toBeTruthy();
		expect(screen.getByText(/운영 학습 가중치 \+19점/)).toBeTruthy();
		expect(screen.getByText('리뷰 개선 우선')).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '예산 증액 1건' }));
		expect(screen.getByText('상품B')).toBeTruthy();
		expect(screen.queryByText('상품A')).toBeNull();
		expect(screen.getByText(/현재 필터: 예산 증액/)).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '전체 보기' }));
		expect(screen.getByText('상품A')).toBeTruthy();
	});

	it('오늘 실행 버킷 카드에서 같은 버킷 컨텍스트로 실행 큐와 정책 센터로 이동한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/home')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							urgent_count: 3,
							pending_action_count: 2,
							high_priority_voc_count: 1,
							avg_data_quality_score: 0.91,
							action_bucket_counts: {
								BUDGET_INCREASE: 1,
								VOC_IMPROVEMENT: 1,
							},
						},
						items: [
							{
								sku_id: 'SKU-B',
								product_name: '상품B',
								policy_type: 'AD_GROWTH',
								action_bucket: 'BUDGET_INCREASE',
								top_issue: '광고 확장 기회',
								recommended_action_primary: '광고 확대',
								effective_priority_score: 95,
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		const firstView = await renderAiOpsView(
			<LocationProbe>
				<AiOpsHomeView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/home'],
		);

		expect(await screen.findByText('버킷별 운영 허브')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: 'home-bucket-actions-BUDGET_INCREASE' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain('/analytics/ai/actions?action_bucket=BUDGET_INCREASE');
		});
	});

	it('오늘 우선 SKU 카드에서 버킷별 원천 분석 화면으로 이동한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/home')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							urgent_count: 2,
							pending_action_count: 1,
							high_priority_voc_count: 1,
							avg_data_quality_score: 0.91,
							action_bucket_counts: {
								BUDGET_INCREASE: 1,
								FAQ_CONTENT_IMPROVEMENT: 1,
							},
						},
						items: [
							{
								sku_id: 'SKU-B',
								product_name: '상품B',
								policy_type: 'AD_GROWTH',
								action_bucket: 'BUDGET_INCREASE',
								top_issue: '광고 확장 기회',
								recommended_action_primary: '예산 증액 테스트',
								effective_priority_score: 95,
							},
							{
								sku_id: 'SKU-A',
								product_name: '상품A',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
								top_issue: '구매 직전 FAQ 공백',
								recommended_action_primary: 'FAQ 보강',
								effective_priority_score: 88,
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		const firstView = await renderAiOpsView(
			<LocationProbe>
				<AiOpsHomeView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/home'],
		);

		expect(await screen.findByText('상품B')).toBeTruthy();
		expect(screen.getAllByText('검증 경로').length).toBeGreaterThan(0);
		expect(screen.getAllByRole('button', { name: '검증 로그 보기' }).length).toBeGreaterThan(0);

		await clickWithAct(screen.getByRole('button', { name: 'home-item-source-SKU-B' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain(
				'/analytics/performance/purchase-keywords?product=%EC%83%81%ED%92%88B',
			);
		});

		firstView.unmount();

		await renderAiOpsView(
			<LocationProbe>
				<AiOpsHomeView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/home'],
		);

		expect(await screen.findByText('상품A')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: 'home-item-source-SKU-A' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain('/analytics/reviews/qna-analysis?');
			expect(screen.getByTestId('current-location').textContent).toContain('qna_kind=product');
			expect(screen.getByTestId('current-location').textContent).toContain('search=%EC%83%81%ED%92%88A');
		});
	});

	it('오늘의 실행 화면은 action_bucket query로 필터를 초기화한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/home')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							urgent_count: 2,
							pending_action_count: 1,
							high_priority_voc_count: 1,
							growth_opportunity_count: 1,
							faq_gap_count: 0,
							avg_data_quality_score: 0.91,
							action_bucket_counts: {
								BUDGET_INCREASE: 1,
								VOC_IMPROVEMENT: 1,
							},
						},
						items: [
							{
								sku_id: 'SKU-B',
								product_name: '상품B',
								policy_type: 'AD_GROWTH',
								action_bucket: 'BUDGET_INCREASE',
								top_issue: '광고 확장 여지',
								recommended_action_primary: '예산 증액 테스트',
								effective_priority_score: 97,
							},
							{
								sku_id: 'SKU-A',
								product_name: '상품A',
								policy_type: 'VOC_IMPROVEMENT_PRIORITY',
								action_bucket: 'VOC_IMPROVEMENT',
								top_issue: '리뷰 부정 비율 상승',
								recommended_action_primary: '리뷰 개선 우선',
								effective_priority_score: 88,
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<AiOpsHomeView apiBaseUrl="http://localhost:5189" />,
			['/analytics/ai/home?action_bucket=BUDGET_INCREASE'],
		);

		expect(await screen.findByText(/현재 필터: 예산 증액/)).toBeTruthy();
		expect(screen.getByText('상품B')).toBeTruthy();
		expect(screen.queryByText('상품A')).toBeNull();
	});

	it('오늘의 실행 화면에서 스냅샷 재생성을 실행하면 홈 데이터를 다시 불러온다', async () => {
		let homeCallCount = 0;
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/home')) {
				homeCallCount += 1;
				if (homeCallCount === 1) {
					return Promise.resolve({
						data: {
							ok: true,
							summary: {
								snapshot_date: '2026-04-10',
								urgent_count: 1,
								pending_action_count: 0,
								high_priority_voc_count: 0,
								growth_opportunity_count: 0,
								faq_gap_count: 0,
								avg_data_quality_score: 0.5,
							},
							items: [],
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							urgent_count: 4,
							pending_action_count: 1,
							high_priority_voc_count: 1,
							growth_opportunity_count: 1,
							faq_gap_count: 1,
							avg_data_quality_score: 0.91,
						},
						items: [{ sku_id: 'SKU-Z', product_name: '재생성 상품', recommended_action_primary: 'FAQ 보강' }],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});
		mockedAxios.post.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/product-health/rebuild')) {
				return Promise.resolve({ data: { ok: true, date: '2026-04-11', saved: 4 } });
			}
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOpsView(<AiOpsHomeView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('1건')).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '스냅샷 재생성' }));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith('http://localhost:5189/ai/ops/product-health/rebuild', {});
		});
		expect(await screen.findByText(/스냅샷을 재생성했습니다/)).toBeTruthy();
		expect(await screen.findByText('4건')).toBeTruthy();
		expect(screen.getByText('재생성 상품')).toBeTruthy();
	});
});
