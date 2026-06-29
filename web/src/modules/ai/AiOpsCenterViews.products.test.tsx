import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';

import {
	changeWithAct,
	clickWithAct,
	mockedAxios,
	registerAiOpsTestLifecycle,
	renderAiOpsView,
} from './AiOpsCenterViews.testUtils';
import { AiOpsProductsView } from '.';

function LocationProbe(props: { children: React.ReactNode }): JSX.Element {
	const location = useLocation();
	return (
		<>
			<div data-testid="current-location">{`${location.pathname}${location.search}`}</div>
			{props.children}
		</>
	);
}

describe('AiOpsCenterViews products', () => {
	registerAiOpsTestLifecycle();

	it('상품별 운영 판단 화면에서 실행 큐로 적재할 수 있다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/products')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 1 },
						items: [
							{
								sku_id: 'SKU-1',
								product_name: '테스트 상품',
								policy_type: 'AD_DEFENSE',
								policy_pack_id: 'AI_OPS_BRAND_A',
								top_issue: '핵심 키워드 방어 필요',
								priority_score: 82.5,
								confidence_score: 0.87,
								data_quality_score: 0.93,
								recommended_action_primary: '방어 광고 3일 테스트',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});
		mockedAxios.post.mockResolvedValue({
			data: {
				ok: true,
				item: {
					queue_id: 'q-1',
					entity_id: 'SKU-1',
					action_type: 'QUEUE_PRIMARY_ACTION',
					status: 'PENDING',
				},
			},
		});

		await renderAiOpsView(<AiOpsProductsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('테스트 상품')).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '실행 큐로 보내기' }));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/actions',
				expect.objectContaining({
					entity_id: 'SKU-1',
					action_type: 'QUEUE_PRIMARY_ACTION',
					priority: 'P1',
				}),
			);
		});
		expect(await screen.findByText(/실행 큐에 적재했습니다/)).toBeTruthy();
		expect(screen.getAllByText(/정책팩 AI_OPS_BRAND_A/).length).toBeGreaterThan(0);
	});

	it('상품별 운영 판단 화면에서 정책팩 필터를 적용할 수 있다', async () => {
		let requestedPolicyPackId: string | null = null;
		mockedAxios.get.mockImplementation((url: string, config?: any) => {
			if (String(url).includes('/ai/ops/products')) {
				requestedPolicyPackId = config?.params?.policy_pack_id ?? null;
				if (requestedPolicyPackId === 'AI_OPS_BRAND_A') {
					return Promise.resolve({
						data: {
							ok: true,
							summary: {
								snapshot_date: '2026-04-11',
								total_items: 1,
								policy_pack_ids: ['AI_OPS_BRAND_A', 'AI_OPS'],
							},
							items: [
								{
									sku_id: 'SKU-BRAND',
									product_name: '브랜드 정책 상품',
									policy_type: 'AD_GROWTH',
									policy_pack_id: 'AI_OPS_BRAND_A',
									top_issue: '브랜드 확장 기회',
									priority_score: 85,
									confidence_score: 0.91,
									data_quality_score: 0.95,
									recommended_action_primary: '광고 확대',
								},
							],
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_items: 2,
							policy_pack_ids: ['AI_OPS_BRAND_A', 'AI_OPS'],
						},
						items: [
							{
								sku_id: 'SKU-BRAND',
								product_name: '브랜드 정책 상품',
								policy_type: 'AD_GROWTH',
								policy_pack_id: 'AI_OPS_BRAND_A',
								top_issue: '브랜드 확장 기회',
								priority_score: 85,
								confidence_score: 0.91,
								data_quality_score: 0.95,
								recommended_action_primary: '광고 확대',
							},
							{
								sku_id: 'SKU-COMMON',
								product_name: '공통 정책 상품',
								policy_type: 'AD_DEFENSE',
								policy_pack_id: 'AI_OPS',
								top_issue: '공통 방어 필요',
								priority_score: 61,
								confidence_score: 0.82,
								data_quality_score: 0.88,
								recommended_action_primary: '방어 광고',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsProductsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('브랜드 정책 상품')).toBeTruthy();
		await changeWithAct(screen.getByLabelText('products-policy-pack-filter'), {
			target: { value: 'AI_OPS_BRAND_A' },
		});

		await waitFor(() => {
			expect(requestedPolicyPackId).toBe('AI_OPS_BRAND_A');
		});
		await waitFor(() => {
			expect(screen.queryByText('공통 정책 상품')).toBeNull();
		});
	});

	it('상품별 운영 판단 화면에서 원천 분석 화면으로 이동한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/products')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 1 },
						items: [
							{
								sku_id: 'SKU-REVIEW-1',
								product_url: 'https://smartstore.naver.com/testmall/products/1001',
								product_name: '리뷰 위험 상품',
								policy_type: 'VOC_IMPROVEMENT_PRIORITY',
								policy_pack_id: 'AI_OPS',
								top_issue: '리뷰 부정 비율 급등',
								priority_score: 87,
								confidence_score: 0.9,
								data_quality_score: 0.92,
								recommended_action_primary: '리뷰 개선 우선',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<LocationProbe>
				<AiOpsProductsView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/products'],
		);

		expect(await screen.findByText('리뷰 위험 상품')).toBeTruthy();
		expect(screen.getByText('검증 경로')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: '검증 로그 보기' }).length).toBeGreaterThan(0);

		await clickWithAct(screen.getByRole('button', { name: 'product-item-source-SKU-REVIEW-1' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain('/analytics/reviews/review-analysis?');
			expect(screen.getByTestId('current-location').textContent).toContain('product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1001');
		});
	});
});
