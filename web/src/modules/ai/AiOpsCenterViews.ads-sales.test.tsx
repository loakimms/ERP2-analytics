import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { clickWithAct, mockedAxios, registerAiOpsTestLifecycle, renderAiOpsView } from './AiOpsCenterViews.testUtils';
import { AiOpsAdsView, AiOpsSalesView } from '.';

describe('AiOpsCenterViews ads/sales', () => {
	registerAiOpsTestLifecycle();

	it('광고 운영 판단 화면은 광고 액션 후보를 표시하고 실행 큐로 적재할 수 있다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/ads')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_keywords: 2,
							listed_count: 2,
							action_buckets: ['STOP', 'SCALE'],
							cannibalization_count: 1,
							budget_count: 2,
						},
						items: [
							{
								campaign_name: '브랜드 캠페인',
								adgroup_name: '방어 그룹',
								keyword: '브랜드 키워드',
								cost: 15000,
								clicks: 12,
								purchase_conversions: 0,
								purchase_revenue: 0,
								roas: 0,
								action_bucket: 'STOP',
								top_issue: '비용이 누적되지만 실제 구매 전환이 없습니다.',
								recommended_action: '비효율 키워드 중단',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
							},
							{
								campaign_name: '성장 캠페인',
								adgroup_name: '확장 그룹',
								keyword: '확장 키워드',
								cost: 12000,
								clicks: 18,
								purchase_conversions: 3,
								purchase_revenue: 60000,
								roas: 500,
								action_bucket: 'SCALE',
								top_issue: '실구매 전환과 ROAS가 모두 우수해 예산 확대 후보입니다.',
								recommended_action: '증액 테스트',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
							},
						],
						cannibalization_items: [
							{
								campaign_name: '브랜드 캠페인',
								adgroup_name: '방어 그룹',
								keyword: '브랜드 키워드',
								cost: 18000,
								roas: 66.7,
								organic_rank: 1,
								action_kind: 'CANNIBALIZATION_DECREASE',
								top_issue: '오가닉 1위인데 광고 비용이 계속 지출되고 있습니다.',
								recommended_action: '잠식 감액 테스트',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '잠식 감액 학습상 비용 절감과 전환 방어가 확인돼 우선 실행을 권장합니다.',
								learning_summary: {
									action_count: 1,
									verified_count: 1,
									improved_count: 1,
									mixed_count: 0,
									declined_count: 0,
									improvement_rate: 1,
									avg_cost_delta: -14000,
									avg_purchase_conversions_delta: 1,
									avg_roas_delta: 55.8,
								},
							},
						],
						budget_items: [
							{
								campaign_name: '브랜드 캠페인',
								adgroup_name: '방어 그룹',
								keyword: '브랜드 키워드',
								cost: 18000,
								roas: 66.7,
								budget_direction: 'DECREASE',
								action_kind: 'BUDGET_DECREASE',
								top_issue: '실구매 전환 대비 비용 비중이 높아 감액이 필요합니다.',
								recommended_action: '예산 감액 테스트',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '과투입 축소 학습상 개선율이 높아 우선 감액 테스트를 권장합니다.',
								learning_summary: {
									action_count: 1,
									verified_count: 1,
									improved_count: 1,
									mixed_count: 0,
									declined_count: 0,
									improvement_rate: 1,
									avg_cost_delta: -8000,
									avg_purchase_conversions_delta: 0,
									avg_roas_delta: 30.5,
								},
							},
							{
								campaign_name: '성장 캠페인',
								adgroup_name: '확장 그룹',
								keyword: '확장 키워드',
								cost: 12000,
								roas: 500,
								budget_direction: 'INCREASE',
								action_kind: 'BUDGET_INCREASE',
								top_issue: '실구매 ROAS가 우수해 예산 확대 여력이 있습니다.',
								recommended_action: '예산 증액 테스트',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '예산 증액 학습상 전환 증가가 반복돼 확대 테스트를 권장합니다.',
								learning_summary: {
									action_count: 2,
									verified_count: 2,
									improved_count: 2,
									mixed_count: 0,
									declined_count: 0,
									improvement_rate: 1,
									avg_cost_delta: 6000,
									avg_purchase_conversions_delta: 2,
									avg_roas_delta: 45.5,
								},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});
		mockedAxios.post.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/ads/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						item: {
							queue_id: 'ad-queue-1',
							entity_id: '브랜드 캠페인::방어 그룹::브랜드 키워드',
							action_type: 'QUEUE_AD_KEYWORD_ACTION',
							status: 'PENDING',
						},
					},
				});
			}
			if (String(url).includes('/ai/ops/ads/budget-actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						item: {
							queue_id: 'ad-budget-queue-1',
							entity_id: '브랜드 캠페인::방어 그룹::브랜드 키워드',
							action_type: 'QUEUE_AD_BUDGET_ACTION',
							status: 'PENDING',
						},
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOpsView(<AiOpsAdsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('운영 플로우')).toBeTruthy();
		expect(screen.getByText('2. 판단 생성')).toBeTruthy();
		expect(screen.getByRole('button', { name: '오가닉 A-1' })).toBeTruthy();
		expect(screen.getByText(/현재 단계: 판단 생성 - 광고 운영 판단/)).toBeTruthy();
		expect((await screen.findAllByText('브랜드 키워드')).length).toBeGreaterThan(0);
		expect(screen.getByText(/비효율 키워드 중단/)).toBeTruthy();
		expect(screen.getAllByText(/증액 테스트/).length).toBeGreaterThan(0);
		expect(screen.getByText(/잠식 감액 테스트/)).toBeTruthy();
		expect(screen.getByText(/예산 증액 테스트/)).toBeTruthy();
		expect(screen.getAllByText((content) => content.includes('검증 1건') && content.includes('개선율 100%')).length).toBeGreaterThan(0);
		expect(screen.getByText(/평균 구매전환 \+1/)).toBeTruthy();
		expect(screen.getByText(/평균 ROAS \+55.8/)).toBeTruthy();
		expect(screen.getByText(/평균 구매전환 \+2/)).toBeTruthy();
		await clickWithAct(screen.getAllByRole('button', { name: '광고 액션 실행 큐로 보내기' })[0]!);
		await clickWithAct(screen.getByRole('button', { name: '잠식 감액 액션 큐로 보내기' }));
		await clickWithAct(screen.getAllByRole('button', { name: '예산 이동 액션 큐로 보내기' })[0]!);

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/ads/actions',
				expect.objectContaining({
					campaign_name: '브랜드 캠페인',
					adgroup_name: '방어 그룹',
					keyword: '브랜드 키워드',
				}),
			);
		});
		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/ads/budget-actions',
				expect.objectContaining({
					campaign_name: '브랜드 캠페인',
					adgroup_name: '방어 그룹',
					keyword: '브랜드 키워드',
					action_kind: 'CANNIBALIZATION_DECREASE',
				}),
			);
		});
		expect(await screen.findByText(/광고 예산 액션을 실행 큐에 적재했습니다/)).toBeTruthy();
	});

	it('광고 운영 판단 화면은 action_bucket query로 관련 버킷만 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/ads')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_keywords: 2,
							listed_count: 2,
							action_buckets: ['STOP', 'SCALE'],
							cannibalization_count: 0,
							budget_count: 2,
						},
						items: [
							{
								campaign_name: '브랜드 캠페인',
								adgroup_name: '방어 그룹',
								keyword: '브랜드 키워드',
								cost: 15000,
								clicks: 12,
								purchase_conversions: 0,
								roas: 0,
								action_bucket: 'STOP',
								recommended_action: '비효율 키워드 중단',
								priority: 'P1',
							},
							{
								campaign_name: '성장 캠페인',
								adgroup_name: '확장 그룹',
								keyword: '확장 키워드',
								cost: 12000,
								clicks: 18,
								purchase_conversions: 3,
								roas: 500,
								action_bucket: 'SCALE',
								recommended_action: '증액 테스트',
								priority: 'P1',
							},
						],
						cannibalization_items: [],
						budget_items: [
							{
								campaign_name: '성장 캠페인',
								adgroup_name: '확장 그룹',
								keyword: '확장 키워드',
								cost: 12000,
								roas: 500,
								budget_direction: 'INCREASE',
								action_kind: 'BUDGET_INCREASE',
								recommended_action: '예산 증액 테스트',
								priority: 'P1',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<AiOpsAdsView apiBaseUrl="http://localhost:5189" />,
			['/analytics/ai/ads?action_bucket=BUDGET_INCREASE'],
		);

		expect(await screen.findByText(/현재 필터: 예산 증액/)).toBeTruthy();
		expect(screen.getByText('확장 키워드')).toBeTruthy();
		expect(screen.queryByText('브랜드 키워드')).toBeNull();
	});

	it('광고 운영 판단 화면은 필터 해제를 지원한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/ads')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_keywords: 2,
							listed_count: 2,
							action_buckets: ['STOP', 'SCALE'],
							cannibalization_count: 0,
							budget_count: 1,
						},
						items: [
							{
								campaign_name: '브랜드 캠페인',
								adgroup_name: '방어 그룹',
								keyword: '브랜드 키워드',
								cost: 15000,
								clicks: 12,
								purchase_conversions: 0,
								roas: 0,
								action_bucket: 'STOP',
								recommended_action: '비효율 키워드 중단',
								priority: 'P1',
							},
							{
								campaign_name: '성장 캠페인',
								adgroup_name: '확장 그룹',
								keyword: '확장 키워드',
								cost: 12000,
								clicks: 18,
								purchase_conversions: 3,
								roas: 500,
								action_bucket: 'SCALE',
								recommended_action: '증액 테스트',
								priority: 'P1',
							},
						],
						cannibalization_items: [],
						budget_items: [],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<AiOpsAdsView apiBaseUrl="http://localhost:5189" />,
			['/analytics/ai/ads?action_bucket=BUDGET_INCREASE'],
		);

		expect(await screen.findByText(/현재 필터: 예산 증액/)).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '필터 해제' }));

		await waitFor(() => {
			expect(screen.queryByText(/현재 필터: 예산 증액/)).toBeNull();
		});
		expect(screen.getByText('브랜드 키워드')).toBeTruthy();
		expect(screen.getByText('확장 키워드')).toBeTruthy();
	});

	it('광고 운영 판단 화면은 같은 버킷으로 다른 상세 화면 이동 버튼을 제공한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/ads')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_keywords: 1,
							listed_count: 1,
							action_buckets: ['SCALE'],
							cannibalization_count: 0,
							budget_count: 1,
						},
						items: [
							{
								campaign_name: '성장 캠페인',
								adgroup_name: '확장 그룹',
								keyword: '확장 키워드',
								cost: 12000,
								clicks: 18,
								purchase_conversions: 3,
								roas: 500,
								action_bucket: 'SCALE',
								recommended_action: '증액 테스트',
								priority: 'P1',
							},
						],
						cannibalization_items: [],
						budget_items: [
							{
								campaign_name: '성장 캠페인',
								adgroup_name: '확장 그룹',
								keyword: '확장 키워드',
								cost: 12000,
								roas: 500,
								budget_direction: 'INCREASE',
								action_kind: 'BUDGET_INCREASE',
								recommended_action: '예산 증액 테스트',
								priority: 'P1',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<AiOpsAdsView apiBaseUrl="http://localhost:5189" />,
			['/analytics/ai/ads?action_bucket=BUDGET_INCREASE'],
		);

		expect(await screen.findByText(/현재 필터: 예산 증액/)).toBeTruthy();
		expect(screen.getByRole('button', { name: '홈으로 돌아가기' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '판매·전환 판단으로 이동' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '실행 큐로 이동' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '검증 로그로 이동' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '광고 운영 판단으로 이동' })).toBeNull();
	});

	it('판매·전환 판단 화면은 판매 액션 후보를 표시하고 실행 큐로 적재할 수 있다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/sales')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_products: 3,
							listed_count: 3,
							action_buckets: ['FOCUS', 'RISK_HOLD', 'LOW_CONTRIBUTION'],
							focus_count: 1,
							risk_hold_count: 1,
							low_contribution_count: 1,
							overinvestment_count: 1,
						},
						items: [
							{
								product_id: 9001,
								product_name: '집중 상품',
								order_count: 8,
								refund_order_count: 0,
								amount: 420000,
								refund_amount: 10000,
								net_amount: 410000,
								refund_ratio: 0.0238,
								action_bucket: 'FOCUS',
								top_issue: '실매출과 주문이 안정적으로 높아 집중 투자 후보입니다.',
								recommended_action: '상위 매출 SKU 집중 운영',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '실매출 기여가 높아 집중 투자 액션을 바로 검토할 만합니다.',
							},
							{
								product_id: 9002,
								product_name: '환불 위험 상품',
								order_count: 6,
								refund_order_count: 2,
								amount: 220000,
								refund_amount: 80000,
								net_amount: 140000,
								refund_ratio: 0.3636,
								action_bucket: 'RISK_HOLD',
								top_issue: '환불 비중이 높아 확대보다 품질/운영 보정이 먼저입니다.',
								recommended_action: '확대 보류 및 환불 원인 점검',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '환불 리스크가 높아 즉시 확대 보류하는 편이 안전합니다.',
							},
							{
								product_id: 9003,
								product_name: '과투입 점검 상품',
								order_count: 1,
								refund_order_count: 0,
								amount: 50000,
								refund_amount: 0,
								net_amount: 50000,
								refund_ratio: 0,
								action_bucket: 'LOW_CONTRIBUTION',
								top_issue: '실매출 기여가 낮아 광고/운영 과투입 여부를 다시 점검해야 합니다.',
								recommended_action: '과투입 점검 및 예산 재검토',
								priority: 'P2',
								approval_recommendation: 'REVIEW',
								approval_recommendation_reason: '실매출이 약해 바로 확대보다 과투입 여부를 먼저 검토해야 합니다.',
							},
						],
						overinvestment_items: [
							{
								product_id: 9010,
								product_name: '광고 착시 상품',
								keyword: '착시키워드',
								order_count: 2,
								amount: 110000,
								refund_amount: 0,
								net_amount: 110000,
								ad_cost: 55000,
								ad_purchase_conversions: 3,
								ad_purchase_revenue: 200000,
								ad_roas: 363.6,
								ad_spend_ratio: 0.5,
								action_bucket: 'AD_OVERINVESTMENT',
								top_issue: '광고 성과는 좋아 보이지만 순매출 대비 광고비 비중이 과도합니다.',
								recommended_action: '광고 과투입 점검 및 예산 축소 테스트',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '동일 키워드 과투입 축소 학습상 개선율이 높아 우선 승인해볼 만합니다.',
								learning_summary: {
									action_count: 1,
									verified_count: 1,
									improved_count: 1,
									mixed_count: 0,
									declined_count: 0,
									improvement_rate: 1,
									avg_ad_spend_ratio_delta: -0.25,
								},
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
					queue_id: 'sales-queue-1',
					entity_id: '9002',
					action_type: 'QUEUE_SALES_ACTION',
					status: 'PENDING',
				},
			},
		});

		await renderAiOpsView(<AiOpsSalesView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('집중 상품')).toBeTruthy();
		expect(screen.getByText(/확대 보류 및 환불 원인 점검/)).toBeTruthy();
		expect(screen.getByText(/과투입 점검 및 예산 재검토/)).toBeTruthy();
		expect(screen.getByText(/광고 과투입 점검 및 예산 축소 테스트/)).toBeTruthy();
		expect(screen.getByText(/착시키워드/)).toBeTruthy();
		expect(screen.getByText((content) => content.includes('검증 1건') && content.includes('개선율 100%'))).toBeTruthy();
		expect(screen.getByText('3개')).toBeTruthy();
		await clickWithAct(screen.getAllByRole('button', { name: '판매 액션 실행 큐로 보내기' })[1]!);
		await clickWithAct(screen.getByRole('button', { name: '과투입 점검 액션 큐로 보내기' }));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/sales/actions',
				expect.objectContaining({
					product_id: 9002,
					action_bucket: 'RISK_HOLD',
				}),
			);
		});
		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/sales/actions',
				expect.objectContaining({
					product_id: 9010,
					action_bucket: 'AD_OVERINVESTMENT',
				}),
			);
		});
		expect(await screen.findByText(/광고 착시 상품 판매 액션을 실행 큐에 적재했습니다/)).toBeTruthy();
	});

	it('판매·전환 판단 화면은 action_bucket query로 관련 버킷만 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/sales')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_products: 3,
							listed_count: 3,
							action_buckets: ['FOCUS', 'RISK_HOLD', 'LOW_CONTRIBUTION', 'AD_OVERINVESTMENT'],
							focus_count: 1,
							risk_hold_count: 1,
							low_contribution_count: 1,
							overinvestment_count: 1,
						},
						items: [
							{
								product_id: 9001,
								product_name: '집중 상품',
								order_count: 8,
								refund_order_count: 0,
								amount: 420000,
								refund_amount: 10000,
								net_amount: 410000,
								refund_ratio: 0.0238,
								action_bucket: 'FOCUS',
								top_issue: '실매출과 주문이 안정적으로 높아 집중 투자 후보입니다.',
								recommended_action: '상위 매출 SKU 집중 운영',
								priority: 'P1',
							},
							{
								product_id: 9002,
								product_name: '환불 위험 상품',
								order_count: 6,
								refund_order_count: 2,
								amount: 220000,
								refund_amount: 80000,
								net_amount: 140000,
								refund_ratio: 0.3636,
								action_bucket: 'RISK_HOLD',
								top_issue: '환불 비중이 높아 확대보다 품질/운영 보정이 먼저입니다.',
								recommended_action: '확대 보류 및 환불 원인 점검',
								priority: 'P1',
							},
						],
						overinvestment_items: [
							{
								product_id: 9010,
								product_name: '광고 착시 상품',
								keyword: '착시키워드',
								order_count: 2,
								amount: 110000,
								refund_amount: 0,
								net_amount: 110000,
								ad_cost: 55000,
								ad_purchase_conversions: 3,
								ad_purchase_revenue: 200000,
								ad_roas: 363.6,
								ad_spend_ratio: 0.5,
								action_bucket: 'AD_OVERINVESTMENT',
								top_issue: '광고 성과는 좋아 보이지만 순매출 대비 광고비 비중이 과도합니다.',
								recommended_action: '광고 과투입 점검 및 예산 축소 테스트',
								priority: 'P1',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<AiOpsSalesView apiBaseUrl="http://localhost:5189" />,
			['/analytics/ai/sales?action_bucket=AD_OVERINVESTMENT'],
		);

		expect(await screen.findByText(/현재 필터: 광고 과투입 점검/)).toBeTruthy();
		expect(screen.getByText('광고 착시 상품')).toBeTruthy();
		expect(screen.queryByText('집중 상품')).toBeNull();
		expect(screen.queryByText('환불 위험 상품')).toBeNull();
	});
});
