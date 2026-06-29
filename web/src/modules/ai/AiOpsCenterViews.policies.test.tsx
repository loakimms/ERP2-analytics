import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { changeWithAct, clickWithAct, mockedAxios, registerAiOpsTestLifecycle, renderAiOpsView } from './AiOpsCenterViews.testUtils';

describe('AiOpsCenterViews policies', () => {
	registerAiOpsTestLifecycle();

	it('SKU 정책 센터 화면은 정책 분포와 정책팩 정보를 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/policies')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_skus: 3,
							policy_count: 2,
							rule_pack_count: 2,
							format_version: 'v2',
							common_rules_len: 8,
						},
						learning_items: [
							{
								policy_pack_id: 'AI_OPS_BRAND_A',
								policy_pack_title: '브랜드A 정책팩',
								action_count: 2,
								verified_count: 2,
								improved_count: 1,
								mixed_count: 1,
								declined_count: 0,
								improvement_rate: 0.5,
								avg_sales_growth_delta: 18,
							},
						],
						items: [
							{
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								top_policy_pack_id: 'AI_OPS_BRAND_A',
								sku_count: 2,
								avg_priority_score: 80,
								top_product_name: '정책 상품 A',
								top_priority_score: 88,
								top_recommended_action: 'FAQ 보강',
							},
							{
								policy_type: 'AD_GROWTH',
								top_policy_pack_id: 'AI_OPS',
								sku_count: 1,
								avg_priority_score: 66,
								top_product_name: '정책 상품 C',
								top_priority_score: 66,
								top_recommended_action: '광고 확대 테스트',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		const { AiOpsPoliciesView } = await import('.');
		await renderAiOpsView(<AiOpsPoliciesView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('운영 플로우')).toBeTruthy();
		expect(screen.getByText('5. 정책 학습')).toBeTruthy();
		expect(screen.getByRole('button', { name: '오늘의 실행' })).toBeTruthy();
		expect(screen.getByText(/현재 단계: 정책 학습 - SKU 정책 센터/)).toBeTruthy();
		expect(await screen.findByText('3개')).toBeTruthy();
		expect(screen.getAllByText('2개').length).toBeGreaterThan(0);
		expect(screen.getByText('v2')).toBeTruthy();
		expect(screen.getByText('FAQ_CONTENT_IMPROVEMENT')).toBeTruthy();
		expect(screen.getByText((content) => content.includes('대표 SKU') && content.includes('정책 상품 A'))).toBeTruthy();
		expect(screen.getByText(/대표 정책팩: AI_OPS_BRAND_A/)).toBeTruthy();
		expect(screen.getByText((content) => content.includes('대표 액션:') && content.includes('광고 확대 테스트'))).toBeTruthy();
		expect(screen.getByText('정책팩 학습 결과')).toBeTruthy();
		expect(screen.getByText(/브랜드A 정책팩/)).toBeTruthy();
		expect(screen.getByText(/개선율 50%/)).toBeTruthy();
	});

	it('SKU 정책 센터 화면에서 정책팩 비교 시뮬레이션을 볼 수 있다', async () => {
		let requestedSkuId: string | null = null;
		mockedAxios.get.mockImplementation((url: string, config?: { params?: { sku_id?: string } }) => {
			if (String(url).includes('/ai/ops/policies/compare')) {
				requestedSkuId = config?.params?.sku_id ?? null;
				if (requestedSkuId === 'SKU-COMPARE-2') {
					return Promise.resolve({
						data: {
							ok: true,
							summary: {
								snapshot_date: '2026-04-11',
								selected_sku_id: 'SKU-COMPARE-2',
								selected_product_name: '비교 SKU 2',
								current_policy_pack_id: 'AI_OPS_BRAND_A',
								recommended_policy_pack_id: 'AI_OPS_BRAND_A',
							},
							candidates: [
								{ sku_id: 'SKU-COMPARE-1', product_name: '비교 SKU 1', current_policy_pack_id: 'AI_OPS' },
								{ sku_id: 'SKU-COMPARE-2', product_name: '비교 SKU 2', current_policy_pack_id: 'AI_OPS_BRAND_A' },
							],
							items: [
								{
									policy_pack_id: 'AI_OPS',
									policy_pack_title: '공통 정책팩',
									policy_type: 'AD_DEFENSE',
									top_issue: '방어가 우선입니다.',
									recommended_action_primary: '방어 광고 3일 테스트',
									recommendation_score: 26,
									recommendation_reason: '대안이지만 학습 이력은 아직 없음',
									recommended: false,
									matches_current_pack: false,
								},
								{
									policy_pack_id: 'AI_OPS_BRAND_A',
									policy_pack_title: '브랜드A 정책팩',
									policy_type: 'AD_GROWTH',
									top_issue: '확장 가능합니다.',
									recommended_action_primary: '광고 확대 테스트',
									recommendation_score: 88,
									recommendation_reason: '검증 개선율 100% / 평균 매출성장 +24 / 운영 학습 개선율 100%',
									recommended: true,
									learning_summary: {
										verified_count: 3,
										improvement_rate: 1,
									},
									operation_learning_summary: {
										verified_count: 1,
										improvement_rate: 1,
										avg_purchase_conversions_delta: 2,
										avg_roas_delta: 45.5,
									},
									matches_current_pack: true,
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
							selected_sku_id: 'SKU-COMPARE-1',
							selected_product_name: '비교 SKU 1',
							current_policy_pack_id: 'AI_OPS',
							recommended_policy_pack_id: 'AI_OPS_BRAND_A',
						},
						candidates: [
							{ sku_id: 'SKU-COMPARE-1', product_name: '비교 SKU 1', current_policy_pack_id: 'AI_OPS' },
							{ sku_id: 'SKU-COMPARE-2', product_name: '비교 SKU 2', current_policy_pack_id: 'AI_OPS_BRAND_A' },
						],
						items: [
							{
								policy_pack_id: 'AI_OPS',
								policy_pack_title: '공통 정책팩',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								top_issue: 'FAQ 보강 필요',
								recommended_action_primary: 'FAQ 보강',
								recommendation_score: 18,
								recommendation_reason: '현재 정책팩 유지',
								recommended: false,
								matches_current_pack: true,
							},
							{
								policy_pack_id: 'AI_OPS_BRAND_A',
								policy_pack_title: '브랜드A 정책팩',
								policy_type: 'AD_GROWTH',
								top_issue: '확장 가능합니다.',
								recommended_action_primary: '광고 확대 테스트',
								recommendation_score: 94,
								recommendation_reason: '검증 개선율 100% / 평균 매출성장 +28 / 운영 학습 개선율 100%',
								recommended: true,
								operation_learning_summary: {
									verified_count: 1,
									improvement_rate: 1,
									avg_purchase_conversions_delta: 2,
									avg_roas_delta: 45.5,
								},
								matches_current_pack: false,
							},
						],
					},
				});
			}
			if (String(url).includes('/ai/ops/policies')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_skus: 2,
							policy_count: 2,
							rule_pack_count: 2,
							format_version: 'v2',
							common_rules_len: 8,
						},
						items: [],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		const { AiOpsPoliciesView } = await import('.');
		await renderAiOpsView(<AiOpsPoliciesView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('정책팩 비교 시뮬레이션')).toBeTruthy();
		expect(screen.getByText(/선택 SKU: 비교 SKU 1/)).toBeTruthy();
		expect(screen.getByText(/현재 적용 정책팩: AI_OPS/)).toBeTruthy();

		await changeWithAct(screen.getByLabelText('policy-compare-sku-select'), {
			target: { value: 'SKU-COMPARE-2' },
		});

		await waitFor(() => {
			expect(requestedSkuId).toBe('SKU-COMPARE-2');
		});
		expect(await screen.findByText(/현재 적용 정책팩: AI_OPS_BRAND_A/)).toBeTruthy();
		expect(screen.getByText(/추천 정책팩: AI_OPS_BRAND_A/)).toBeTruthy();
		expect(screen.getByText(/공통 정책팩/)).toBeTruthy();
		expect(screen.getByText(/브랜드A 정책팩/)).toBeTruthy();
		expect(screen.getByText(/광고 확대 테스트/)).toBeTruthy();
		expect(screen.getByText(/추천 점수: 88/)).toBeTruthy();
		expect(screen.getByText(/검증 개선율 100%/)).toBeTruthy();
		expect(screen.getByText(/운영 학습 개선율 100%/)).toBeTruthy();
		expect(screen.getByText(/운영 학습 검증 1건 \/ 개선율 100%/)).toBeTruthy();
	});

	it('SKU 정책 센터 화면에서 비교 결과를 실행 큐로 적재할 수 있다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/policies/compare')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							selected_sku_id: 'SKU-COMPARE-1',
							selected_product_name: '비교 SKU 1',
							current_policy_pack_id: 'AI_OPS',
						},
						candidates: [
							{ sku_id: 'SKU-COMPARE-1', product_name: '비교 SKU 1', current_policy_pack_id: 'AI_OPS' },
						],
						items: [
							{
								policy_pack_id: 'AI_OPS',
								policy_pack_title: '공통 정책팩',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								top_issue: 'FAQ 보강 필요',
								recommended_action_primary: 'FAQ 보강',
								matches_current_pack: true,
							},
							{
								policy_pack_id: 'AI_OPS_BRAND_A',
								policy_pack_title: '브랜드A 정책팩',
								policy_type: 'AD_GROWTH',
								top_issue: '확장 가능합니다.',
								recommended_action_primary: '광고 확대 테스트',
								matches_current_pack: false,
							},
						],
					},
				});
			}
			if (String(url).includes('/ai/ops/policies')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_skus: 2,
							policy_count: 2,
							rule_pack_count: 2,
							format_version: 'v2',
							common_rules_len: 8,
						},
						items: [],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});
		mockedAxios.post.mockResolvedValue({
			data: {
				ok: true,
				item: {
					queue_id: 'compare-queue-1',
					entity_id: 'SKU-COMPARE-1',
					action_type: 'QUEUE_POLICY_COMPARE_ACTION',
					status: 'PENDING',
				},
			},
		});

		const { AiOpsPoliciesView } = await import('.');
		await renderAiOpsView(<AiOpsPoliciesView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('정책팩 비교 시뮬레이션')).toBeTruthy();
		await clickWithAct(screen.getByLabelText('queue-compare-action-AI_OPS_BRAND_A'));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/policies/compare/actions',
				{
					sku_id: 'SKU-COMPARE-1',
					target_policy_pack_id: 'AI_OPS_BRAND_A',
				},
			);
		});
		expect(await screen.findByText(/비교 SKU 1 비교 액션을 실행 큐에 적재했습니다/)).toBeTruthy();
	});

	it('SKU 정책 센터 화면은 action_bucket query를 받아 같은 버킷 정책만 우선 보여준다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/policies/compare')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							selected_sku_id: 'SKU-COMPARE-1',
							selected_product_name: '비교 SKU 1',
							current_policy_pack_id: 'AI_OPS',
							recommended_policy_pack_id: 'AI_OPS_BRAND_A',
						},
						candidates: [{ sku_id: 'SKU-COMPARE-1', product_name: '비교 SKU 1', current_policy_pack_id: 'AI_OPS' }],
						items: [
							{
								policy_pack_id: 'AI_OPS',
								policy_pack_title: '공통 정책팩',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								top_issue: 'FAQ 보강 필요',
								recommended_action_primary: 'FAQ 보강',
								matches_current_pack: true,
							},
							{
								policy_pack_id: 'AI_OPS_BRAND_A',
								policy_pack_title: '브랜드A 정책팩',
								policy_type: 'AD_GROWTH',
								top_issue: '확장 가능합니다.',
								recommended_action_primary: '예산 증액 테스트',
								matches_current_pack: false,
							},
						],
					},
				});
			}
			if (String(url).includes('/ai/ops/policies')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							snapshot_date: '2026-04-11',
							total_skus: 2,
							policy_count: 2,
							rule_pack_count: 2,
							format_version: 'v2',
							common_rules_len: 8,
						},
						items: [
							{
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								top_policy_pack_id: 'AI_OPS',
								sku_count: 1,
								avg_priority_score: 52,
								top_product_name: 'FAQ 상품',
								top_recommended_action: 'FAQ 보강',
							},
							{
								policy_type: 'AD_GROWTH',
								top_policy_pack_id: 'AI_OPS_BRAND_A',
								sku_count: 1,
								avg_priority_score: 88,
								top_product_name: '확장 상품',
								top_recommended_action: '예산 증액 테스트',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		const { AiOpsPoliciesView } = await import('.');
		await renderAiOpsView(<AiOpsPoliciesView apiBaseUrl="http://localhost:5189" />, [
			'/analytics/ai/policies?action_bucket=BUDGET_INCREASE',
		]);

		expect(await screen.findByText(/현재 필터: 예산 증액/)).toBeTruthy();
		expect(screen.getAllByText(/AD_GROWTH/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/FAQ 상품/)).toBeNull();
		expect(screen.queryByText(/FAQ 보강 필요/)).toBeNull();
		expect(screen.getAllByText(/예산 증액 테스트/).length).toBeGreaterThan(0);
	});
});
