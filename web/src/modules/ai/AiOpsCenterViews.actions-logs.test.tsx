import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';

import { changeWithAct, clickWithAct, mockedAxios, registerAiOpsTestLifecycle, renderAiOpsView } from './AiOpsCenterViews.testUtils';
import { AiOpsActionsView, AiOpsLogsView } from '.';

function LocationProbe(props: { children: React.ReactNode }): JSX.Element {
	const location = useLocation();
	return (
		<>
			<div data-testid="current-location">{`${location.pathname}${location.search}`}</div>
			{props.children}
		</>
	);
}

describe('AiOpsCenterViews actions/logs', () => {
	registerAiOpsTestLifecycle();

	it('실행 큐 화면은 대기중 액션 목록을 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 1, listed_count: 1 },
						items: [
							{
								queue_id: 'queue-1',
								entity_id: 'SKU-1',
								action_type: 'QUEUE_PRIMARY_ACTION',
								priority: 'P1',
								status: 'PENDING',
								payload: { title: '방어 광고 3일 테스트' },
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsActionsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('운영 플로우')).toBeTruthy();
		expect(screen.getByText('3. 실행 큐')).toBeTruthy();
		expect(screen.getByRole('button', { name: '검증 로그' })).toBeTruthy();
		expect(screen.getByText(/현재 단계: 실행 큐 - 실행 큐/)).toBeTruthy();
		expect(await screen.findByText('대기중 1건')).toBeTruthy();
		expect(screen.getByText('방어 광고 3일 테스트')).toBeTruthy();
		expect(screen.getByText('PENDING')).toBeTruthy();
	});

	it('실행 큐 화면은 정책 비교 액션의 diff를 함께 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 1, listed_count: 1 },
						items: [
							{
								queue_id: 'queue-compare-1',
								entity_id: 'SKU-COMPARE-1',
								action_type: 'QUEUE_POLICY_COMPARE_ACTION',
								priority: 'P1',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '추천 점수 88점으로 즉시 테스트 승인을 권장합니다.',
								status: 'PENDING',
								verification: {
									status: 'READY_7D',
									label: '7일 검증 가능',
									outcome: 'IMPROVED',
									baseline_date: '2026-04-11',
									latest_date: '2026-04-18',
									metrics: {
										sales_growth_delta: 24,
										organic_strength_delta: 18,
										review_risk_delta: -28,
										qna_barrier_delta: -40,
									},
								},
								payload: {
									title: '[브랜드A 정책팩] 광고 확대 테스트',
									current_policy_pack_id: 'AI_OPS',
									current_policy_type: 'FAQ_CONTENT_IMPROVEMENT',
									current_recommended_action: 'FAQ 보강',
									target_policy_pack_id: 'AI_OPS_BRAND_A',
									target_policy_pack_title: '브랜드A 정책팩',
									target_policy_type: 'AD_GROWTH',
									target_recommended_action: '광고 확대 테스트',
									target_recommendation_score: 88,
									target_recommendation_reason: '검증 개선율 100% / 평균 매출성장 +24',
									approval_recommendation: 'APPROVE',
									approval_recommendation_reason: '추천 점수 88점으로 즉시 테스트 승인을 권장합니다.',
									changed_fields: ['policy_type', 'recommended_action_primary'],
								},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsActionsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('[브랜드A 정책팩] 광고 확대 테스트')).toBeTruthy();
		expect(screen.getByText(/현재 정책팩 AI_OPS · FAQ_CONTENT_IMPROVEMENT/)).toBeTruthy();
		expect(screen.getByText(/대상 정책팩 브랜드A 정책팩 · AD_GROWTH/)).toBeTruthy();
		expect(screen.getByText(/현재 액션: FAQ 보강/)).toBeTruthy();
		expect(screen.getByText(/대상 액션: 광고 확대 테스트/)).toBeTruthy();
		expect(screen.getByText((content) => content.trim() === '추천 점수 88')).toBeTruthy();
		expect(screen.getByText(/승인 추천 APPROVE/)).toBeTruthy();
		expect(screen.getAllByText(/즉시 테스트 승인을 권장/).length).toBeGreaterThan(0);
		expect(screen.getByText(/변경 필드: policy_type, recommended_action_primary/)).toBeTruthy();
		expect(screen.getByText(/7일 검증 가능/)).toBeTruthy();
		expect(screen.getByText(/판정 IMPROVED/)).toBeTruthy();
	});

	it('실행 큐 화면은 과투입 판매 액션의 검증 지표를 함께 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 0, listed_count: 1 },
						items: [
							{
								queue_id: 'queue-sales-verify-1',
								entity_id: '9401',
								action_type: 'QUEUE_SALES_ACTION',
								priority: 'P1',
								status: 'APPROVED',
								payload: {
									title: '[판매 AD_OVERINVESTMENT] 과투입 검증 상품',
									product_id: 9401,
									action_bucket: 'AD_OVERINVESTMENT',
									keyword: '검증과투입키워드',
								},
								verification: {
									status: 'READY_7D',
									label: '7일 검증 가능',
									outcome: 'IMPROVED',
									baseline_date: '2026-04-11',
									latest_date: '2026-04-18',
									metrics: {
										net_amount_delta: 70000,
										ad_spend_ratio_delta: -0.3611,
										ad_cost_delta: -30000,
										ad_roas_delta: 476.4,
									},
								},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsActionsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('[판매 AD_OVERINVESTMENT] 과투입 검증 상품')).toBeTruthy();
		expect(screen.getByText(/7일 검증 가능/)).toBeTruthy();
		expect(screen.getByText(/판정 IMPROVED/)).toBeTruthy();
		expect(screen.getByText(/순매출 \+70,000/)).toBeTruthy();
		expect(screen.getByText(/광고비 비중 -36%/)).toBeTruthy();
		expect(screen.getByText(/광고비 -30,000/)).toBeTruthy();
		expect(screen.getByText(/광고ROAS \+476.4/)).toBeTruthy();
	});

	it('실행 큐 화면은 광고 예산 액션의 검증 지표를 함께 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 0, listed_count: 1 },
						items: [
							{
								queue_id: 'queue-ad-budget-verify-1',
								entity_id: '브랜드 캠페인::방어 그룹::브랜드 키워드',
								action_type: 'QUEUE_AD_BUDGET_ACTION',
								priority: 'P1',
								status: 'APPROVED',
								payload: {
									title: '[광고 예산] 브랜드 키워드',
									keyword: '브랜드 키워드',
									action_kind: 'CANNIBALIZATION_DECREASE',
								},
								verification: {
									status: 'READY_7D',
									label: '7일 검증 가능',
									outcome: 'IMPROVED',
									baseline_date: '2026-04-11',
									latest_date: '2026-04-18',
									metrics: {
										ad_cost_delta: -17000,
										purchase_conversions_delta: 1,
										ad_roas_delta: 55.8,
									},
								},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsActionsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('[광고 예산] 브랜드 키워드')).toBeTruthy();
		expect(screen.getByText(/7일 검증 가능/)).toBeTruthy();
		expect(screen.getByText(/판정 IMPROVED/)).toBeTruthy();
		expect(screen.getAllByText(/광고비 -17,000/).length).toBeGreaterThan(0);
		expect(screen.getByText(/구매전환 \+1/)).toBeTruthy();
		expect(screen.getByText(/광고ROAS \+55.8/)).toBeTruthy();
	});

	it('실행 큐 화면은 action_bucket query로 관련 액션만 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 1, listed_count: 2 },
						items: [
							{
								queue_id: 'queue-budget-increase-1',
								entity_id: '성장 캠페인::확장 그룹::확장 키워드',
								action_type: 'QUEUE_AD_BUDGET_ACTION',
								priority: 'P1',
								status: 'PENDING',
								payload: {
									title: '[광고 예산] 확장 키워드',
									action_kind: 'BUDGET_INCREASE',
									keyword: '확장 키워드',
								},
							},
							{
								queue_id: 'queue-voc-1',
								entity_id: 'SKU-VOC-1',
								action_type: 'QUEUE_PRIMARY_ACTION',
								priority: 'P1',
								status: 'PENDING',
								payload: {
									title: '리뷰 개선 우선',
									action_bucket: 'VOC_IMPROVEMENT',
								},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<AiOpsActionsView apiBaseUrl="http://localhost:5189" />,
			['/analytics/ai/actions?action_bucket=BUDGET_INCREASE'],
		);

		expect(await screen.findByText(/현재 필터: 예산 증액/)).toBeTruthy();
		expect(screen.getByText('[광고 예산] 확장 키워드')).toBeTruthy();
		expect(screen.queryByText('리뷰 개선 우선')).toBeNull();
	});

	it('실행 큐 화면에서 원천 분석 화면으로 이동한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 1, listed_count: 1 },
						items: [
							{
								queue_id: 'queue-faq-1',
								entity_id: 'SKU-FAQ-1',
								action_type: 'QUEUE_PRIMARY_ACTION',
								priority: 'P1',
								status: 'PENDING',
								payload: {
									title: 'FAQ 보강',
									product_name: 'FAQ 상품',
									action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
									top_issue: '구매 직전 FAQ 공백',
								},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<LocationProbe>
				<AiOpsActionsView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/actions'],
		);

		expect(await screen.findByText('FAQ 보강')).toBeTruthy();
		expect(screen.getByText('검증 경로')).toBeTruthy();
		expect(screen.getByRole('button', { name: '검증 로그 보기' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: 'action-item-source-queue-faq-1' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain('/analytics/reviews/qna-analysis?');
			expect(screen.getByTestId('current-location').textContent).toContain('qna_kind=product');
			expect(screen.getByTestId('current-location').textContent).toContain('search=FAQ+%EC%83%81%ED%92%88');
		});
	});

	it('실행 큐 화면에서 메모와 함께 상태를 승인으로 변경할 수 있다', async () => {
		let listCallCount = 0;
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				listCallCount += 1;
				if (listCallCount === 1) {
					return Promise.resolve({
						data: {
							ok: true,
							summary: { pending_count: 1, listed_count: 1 },
							items: [
								{
									queue_id: 'queue-1',
									entity_id: 'SKU-1',
									action_type: 'QUEUE_PRIMARY_ACTION',
									priority: 'P1',
									status: 'PENDING',
									payload: { title: '방어 광고 3일 테스트' },
								},
							],
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 0, listed_count: 1 },
						items: [
							{
								queue_id: 'queue-1',
								entity_id: 'SKU-1',
								action_type: 'QUEUE_PRIMARY_ACTION',
								priority: 'P1',
								status: 'APPROVED',
								reviewer: 'ai-ops-ui',
								review_note: '3일간 테스트 승인',
								payload: { title: '방어 광고 3일 테스트' },
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});
		mockedAxios.post.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions/queue-1/status')) {
				return Promise.resolve({
					data: {
						ok: true,
						item: {
							queue_id: 'queue-1',
							status: 'APPROVED',
							reviewer: 'ai-ops-ui',
							review_note: '3일간 테스트 승인',
						},
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOpsView(<AiOpsActionsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('방어 광고 3일 테스트')).toBeTruthy();
		await changeWithAct(screen.getByPlaceholderText('검토 메모를 입력하세요'), {
			target: { value: '3일간 테스트 승인' },
		});
		await clickWithAct(screen.getByRole('button', { name: '승인' }));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/actions/queue-1/status',
				expect.objectContaining({
					status: 'APPROVED',
					reviewer: 'ai-ops-ui',
					review_note: '3일간 테스트 승인',
				}),
			);
		});
		expect(await screen.findByText('APPROVED')).toBeTruthy();
		expect(screen.getByDisplayValue('3일간 테스트 승인')).toBeTruthy();
	});

	it('실행 큐 화면에서 승인 추천 액션은 추천 사유를 메모에 자동 반영한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { pending_count: 1, listed_count: 1 },
						items: [
							{
								queue_id: 'queue-approve-1',
								entity_id: 'SKU-APPROVE-1',
								action_type: 'QUEUE_POLICY_COMPARE_ACTION',
								priority: 'P1',
								status: 'PENDING',
								approval_recommendation: 'APPROVE',
								approval_recommendation_reason: '추천 점수 88점 / SKU 긴급도 84점으로 즉시 테스트 승인을 권장합니다.',
								payload: {
									title: '[브랜드A 정책팩] 광고 확대 테스트',
									approval_recommendation: 'APPROVE',
									approval_recommendation_reason: '추천 점수 88점 / SKU 긴급도 84점으로 즉시 테스트 승인을 권장합니다.',
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
					queue_id: 'queue-approve-1',
					status: 'APPROVED',
					reviewer: 'ai-ops-ui',
					review_note: '추천 점수 88점 / SKU 긴급도 84점으로 즉시 테스트 승인을 권장합니다.',
				},
			},
		});

		await renderAiOpsView(<AiOpsActionsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('[브랜드A 정책팩] 광고 확대 테스트')).toBeTruthy();
		expect(screen.getByRole('button', { name: '추천 승인' })).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '추천 승인' }));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/actions/queue-approve-1/status',
				expect.objectContaining({
					status: 'APPROVED',
					reviewer: 'ai-ops-ui',
					review_note: '추천 점수 88점 / SKU 긴급도 84점으로 즉시 테스트 승인을 권장합니다.',
				}),
			);
		});
	});

	it('검증 로그 화면은 판단 근거와 실행 상태를 함께 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/logs')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 1 },
						items: [
							{
								sku_id: 'SKU-LOG-1',
								product_name: '로그 상품',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								policy_pack_id: 'AI_OPS_BRAND_A',
								top_issue: 'FAQ 보강 필요',
								latest_action_status: 'APPROVED',
								latest_action_note: '이번 주 상세페이지 FAQ 먼저 반영',
								rules_triggered: ['qna_barrier_high', 'faq_candidate_detected', 'ad_overinvestment_detected'],
								recommended_actions: ['FAQ 보강', '광고 과투입 점검 및 예산 축소 테스트'],
								analysis_text: 'Q&A에서 FAQ 후보가 반복되어 상세 보강이 우선이며, 광고 과투입도 함께 점검해야 합니다.',
								evidence: {
									sales: {
										net_amount: 120000,
										ad_overinvestment: {
											keyword: '착시키워드',
											ad_cost: 55000,
											ad_roas: 363.6,
											ad_spend_ratio: 0.4583,
										},
									},
									qna: { faq_candidate_count: 2 },
								},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsLogsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('로그 상품')).toBeTruthy();
		expect(screen.getByText('APPROVED')).toBeTruthy();
		expect(screen.getByText('이번 주 상세페이지 FAQ 먼저 반영')).toBeTruthy();
		expect(screen.getByText('qna_barrier_high')).toBeTruthy();
		expect(screen.getByText('ad_overinvestment_detected')).toBeTruthy();
		expect(screen.getByText('FAQ 보강')).toBeTruthy();
		expect(screen.getByText('광고 과투입 점검 및 예산 축소 테스트')).toBeTruthy();
		expect(screen.getAllByText(/정책팩 AI_OPS_BRAND_A/).length).toBeGreaterThan(0);
		expect(screen.getByText(/광고 과투입도 함께 점검해야 합니다/)).toBeTruthy();
		expect(screen.getByText(/광고 과투입 · 키워드 착시키워드/)).toBeTruthy();
	});

	it('검증 로그 화면은 action_bucket query로 관련 로그만 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/logs')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 2 },
						items: [
							{
								sku_id: 'SKU-LOG-OVER-1',
								product_name: '과투입 로그 상품',
								policy_type: 'AD_DEFENSE',
								policy_pack_id: 'AI_OPS',
								top_issue: '광고 과투입 점검 필요',
								latest_action_status: 'APPROVED',
								latest_action_type: 'QUEUE_SALES_ACTION',
								latest_action_payload: {
									action_bucket: 'AD_OVERINVESTMENT',
									title: '광고 과투입 점검 및 예산 축소 테스트',
								},
								recommended_actions: ['광고 과투입 점검 및 예산 축소 테스트'],
								analysis_text: '광고 효율은 좋아 보여도 순매출 대비 광고비 비중이 높습니다.',
								evidence: {
									sales: {
										ad_overinvestment: {
											keyword: '착시키워드',
											ad_cost: 55000,
											ad_roas: 363.6,
											ad_spend_ratio: 0.4583,
										},
									},
								},
							},
							{
								sku_id: 'SKU-LOG-FAQ-1',
								product_name: 'FAQ 로그 상품',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								policy_pack_id: 'AI_OPS',
								top_issue: 'FAQ 보강 필요',
								latest_action_status: 'PENDING',
								latest_action_payload: {
									action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
									title: 'FAQ 보강',
								},
								recommended_actions: ['FAQ 보강'],
								analysis_text: '반복 질문이 많아 FAQ 보강이 먼저입니다.',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<AiOpsLogsView apiBaseUrl="http://localhost:5189" />,
			['/analytics/ai/logs?action_bucket=AD_OVERINVESTMENT'],
		);

		expect(await screen.findByText(/현재 필터: 광고 과투입 점검/)).toBeTruthy();
		expect(screen.getByText('과투입 로그 상품')).toBeTruthy();
		expect(screen.queryByText('FAQ 로그 상품')).toBeNull();
	});

	it('검증 로그 화면은 운영 리포트 요약을 함께 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/logs')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 3 },
						items: [
							{
								sku_id: 'SKU-REPORT-1',
								product_name: '증액 성공 상품',
								policy_type: 'AD_GROWTH',
								policy_pack_id: 'AI_OPS',
								latest_action_status: 'APPROVED',
								latest_action_payload: {
									action_kind: 'BUDGET_INCREASE',
									title: '예산 증액 테스트',
								},
								latest_action_verification: {
									status: 'READY_7D',
									label: '7일 검증 가능',
									outcome: 'IMPROVED',
								},
								recommended_actions: ['예산 증액 테스트'],
								analysis_text: '검증 이후 증액 유지 후보입니다.',
							},
							{
								sku_id: 'SKU-REPORT-2',
								product_name: '증액 보류 상품',
								policy_type: 'AD_GROWTH',
								policy_pack_id: 'AI_OPS',
								latest_action_status: 'REJECTED',
								latest_action_payload: {
									action_kind: 'BUDGET_INCREASE',
									title: '예산 증액 테스트',
								},
								latest_action_verification: {
									status: 'READY_7D',
									label: '7일 검증 가능',
									outcome: 'DECLINED',
								},
								recommended_actions: ['예산 증액 테스트'],
								analysis_text: '증액 후 효율 악화 가능성이 보여 반려했습니다.',
							},
							{
								sku_id: 'SKU-REPORT-3',
								product_name: '리뷰 개선 상품',
								policy_type: 'VOC_IMPROVEMENT_PRIORITY',
								policy_pack_id: 'AI_OPS',
								latest_action_status: 'APPROVED',
								latest_action_payload: {
									action_bucket: 'VOC_IMPROVEMENT',
									title: '리뷰 개선 우선',
								},
								recommended_actions: ['리뷰 개선 우선'],
								analysis_text: '리뷰 대응이 먼저 필요한 상품입니다.',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsLogsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('운영 플로우')).toBeTruthy();
		expect(screen.getByText('4. 검증 로그')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'A-1 Trace' })).toBeTruthy();
		expect(screen.getByText(/현재 단계: 검증 로그 - 검증\/설명 로그/)).toBeTruthy();
		expect(await screen.findByText('운영 리포트 요약')).toBeTruthy();
		expect(screen.getByText(/승인율 67%/)).toBeTruthy();
		expect(screen.getByText(/검증 개선율 50%/)).toBeTruthy();
		expect(screen.getByText(/주요 버킷 예산 증액 2건/)).toBeTruthy();
	});

	it('검증 로그 화면은 감사추적용 상세 요약 블록을 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/logs')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 1 },
						items: [
							{
								sku_id: 'SKU-AUDIT-1',
								product_name: '감사 로그 상품',
								policy_type: 'AD_GROWTH',
								policy_pack_id: 'AI_OPS_BRAND_A',
								latest_action_status: 'APPROVED',
								latest_action_payload: {
									action_kind: 'BUDGET_INCREASE',
									title: '예산 증액 테스트',
								},
								latest_action_verification: {
									status: 'READY_7D',
									label: '7일 검증 가능',
									outcome: 'IMPROVED',
								},
								rules_triggered: ['growth_signal_high', 'roas_stable', 'inventory_safe'],
								recommended_actions: ['예산 증액 테스트', '상세페이지 확장'],
								analysis_text: '검증 가능한 성장 액션입니다.',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsLogsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('감사 로그 상품')).toBeTruthy();
		expect(screen.getByText(/감사 요약/)).toBeTruthy();
		expect(screen.getByText((content) => content.includes('버킷 예산 증액') && content.includes('검증 상태 7일 검증 가능'))).toBeTruthy();
		expect(screen.getAllByText(/정책팩 AI_OPS_BRAND_A/).length).toBeGreaterThan(0);
		expect(screen.getByText(/룰 3개/)).toBeTruthy();
		expect(screen.getByText(/추천 액션 2개/)).toBeTruthy();
	});

	it('검증 로그 화면은 정책 비교 액션 diff를 함께 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/logs')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 1 },
						items: [
							{
								sku_id: 'SKU-LOG-COMPARE-1',
								product_name: '로그 비교 상품',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								policy_pack_id: 'AI_OPS',
								top_issue: 'FAQ 보강 필요',
								latest_action_status: 'APPROVED',
								latest_action_note: '브랜드 정책팩 기준으로 확대 승인',
								latest_action_type: 'QUEUE_POLICY_COMPARE_ACTION',
								latest_action_verification: {
									status: 'READY_7D',
									label: '7일 검증 가능',
									outcome: 'IMPROVED',
									baseline_date: '2026-04-11',
									latest_date: '2026-04-18',
									metrics: {
										sales_growth_delta: 24,
										organic_strength_delta: 18,
										review_risk_delta: -28,
										qna_barrier_delta: -40,
									},
								},
								latest_action_payload: {
									current_policy_pack_id: 'AI_OPS',
									current_policy_type: 'FAQ_CONTENT_IMPROVEMENT',
									current_recommended_action: 'FAQ 보강',
									target_policy_pack_id: 'AI_OPS_BRAND_A',
									target_policy_pack_title: '브랜드A 정책팩',
									target_policy_type: 'AD_GROWTH',
									target_recommended_action: '광고 확대 테스트',
									changed_fields: ['policy_type', 'recommended_action_primary'],
								},
								rules_triggered: ['qna_barrier_high'],
								recommended_actions: ['FAQ 보강'],
								analysis_text: '현재는 FAQ 보강 우선이나 정책 비교가 필요합니다.',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsLogsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('로그 비교 상품')).toBeTruthy();
		expect(screen.getByText(/정책 비교 액션/)).toBeTruthy();
		expect(screen.getByText(/현재 정책팩 AI_OPS · FAQ_CONTENT_IMPROVEMENT/)).toBeTruthy();
		expect(screen.getByText(/대상 정책팩 브랜드A 정책팩 · AD_GROWTH/)).toBeTruthy();
		expect(screen.getByText(/현재 액션: FAQ 보강/)).toBeTruthy();
		expect(screen.getByText(/대상 액션: 광고 확대 테스트/)).toBeTruthy();
		expect(screen.getByText(/변경 필드: policy_type, recommended_action_primary/)).toBeTruthy();
		expect(screen.getAllByText(/7일 검증 가능/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/판정 IMPROVED/).length).toBeGreaterThan(0);
	});

	it('검증 로그 화면에서 정책팩 필터를 적용할 수 있다', async () => {
		let requestedPolicyPackId: string | null = null;
		mockedAxios.get.mockImplementation((url: string, config?: any) => {
			if (String(url).includes('/ai/ops/logs')) {
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
									sku_id: 'SKU-LOG-BRAND',
									product_name: '브랜드 로그 상품',
									policy_type: 'FAQ_CONTENT_IMPROVEMENT',
									policy_pack_id: 'AI_OPS_BRAND_A',
									top_issue: 'FAQ 보강 필요',
									latest_action_status: 'APPROVED',
									rules_triggered: ['qna_barrier_high'],
									recommended_actions: ['FAQ 보강'],
									analysis_text: '브랜드 정책팩으로 FAQ 보강이 우선입니다.',
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
								sku_id: 'SKU-LOG-BRAND',
								product_name: '브랜드 로그 상품',
								policy_type: 'FAQ_CONTENT_IMPROVEMENT',
								policy_pack_id: 'AI_OPS_BRAND_A',
								top_issue: 'FAQ 보강 필요',
								latest_action_status: 'APPROVED',
								rules_triggered: ['qna_barrier_high'],
								recommended_actions: ['FAQ 보강'],
								analysis_text: '브랜드 정책팩으로 FAQ 보강이 우선입니다.',
							},
							{
								sku_id: 'SKU-LOG-COMMON',
								product_name: '공통 로그 상품',
								policy_type: 'AD_DEFENSE',
								policy_pack_id: 'AI_OPS',
								top_issue: '공통 방어 필요',
								latest_action_status: 'PENDING',
								rules_triggered: ['organic_strength_low'],
								recommended_actions: ['방어 광고'],
								analysis_text: '공통 정책팩으로 방어 광고가 우선입니다.',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(<AiOpsLogsView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('브랜드 로그 상품')).toBeTruthy();
		await changeWithAct(screen.getByLabelText('logs-policy-pack-filter'), {
			target: { value: 'AI_OPS_BRAND_A' },
		});

		await waitFor(() => {
			expect(requestedPolicyPackId).toBe('AI_OPS_BRAND_A');
		});
		await waitFor(() => {
			expect(screen.queryByText('공통 로그 상품')).toBeNull();
		});
	});

	it('검증 로그 화면에서 원천 분석 화면으로 이동한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/ops/logs')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: { snapshot_date: '2026-04-11', total_items: 1 },
						items: [
							{
								date: '2026-04-11',
								sku_id: 'SKU-LOG-1',
								product_name: '과투입 로그 상품',
								policy_type: 'AD_DEFENSE',
								policy_pack_id: 'AI_OPS',
								top_issue: '광고 과투입 의심',
								confidence_score: 0.88,
								latest_action_status: 'APPROVED',
								latest_action_type: 'QUEUE_SALES_ACTION',
								latest_action_payload: {
									title: '[판매 AD_OVERINVESTMENT] 과투입 로그 상품',
									action_bucket: 'AD_OVERINVESTMENT',
									keyword: '과투입키워드',
								},
								evidence: {
									sales: {
										ad_overinvestment: {
											keyword: '과투입키워드',
										},
									},
								},
								recommended_actions: ['광고 과투입 점검 및 예산 축소 테스트'],
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<LocationProbe>
				<AiOpsLogsView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/logs'],
		);

		expect(await screen.findByText('과투입 로그 상품')).toBeTruthy();
		expect(screen.getByText('검증 경로')).toBeTruthy();
		expect(screen.getByRole('button', { name: '실행 큐 보기' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: 'log-item-source-SKU-LOG-1' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain('/analytics/performance/purchase-keywords?');
			expect(screen.getByTestId('current-location').textContent).toContain('product=%EA%B3%BC%ED%88%AC%EC%9E%85+%EB%A1%9C%EA%B7%B8+%EC%83%81%ED%92%88');
			expect(screen.getByTestId('current-location').textContent).toContain('keyword=%EA%B3%BC%ED%88%AC%EC%9E%85%ED%82%A4%EC%9B%8C%EB%93%9C');
		});
	});
});
