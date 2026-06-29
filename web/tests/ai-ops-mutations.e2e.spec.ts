import { expect, test } from '@playwright/test';
import { registerAnalyticsAuthBootstrap } from './analytics-e2e-auth';
import {
	buildPolicyCompareItem,
	buildProductDecisionItem,
	buildQnaDecisionItem,
	buildQueueItem,
	buildReviewDecisionItem,
	capturePostJson,
	mockAiOpsActionsRoute,
	okJson,
} from './ai-ops-mutations.fixtures';

registerAnalyticsAuthBootstrap(test);

test('상품별 운영 판단에서 실행 큐 적재 요청을 보낸다', async ({ page }) => {
	let capturedBody: Record<string, unknown> | null = null;

	await page.route('**/ai/ops/products**', async (route) => {
		await route.fulfill(
			okJson({
				summary: {
					snapshot_date: '2026-04-13',
					total_items: 1,
					policy_pack_ids: ['AI_OPS'],
				},
				items: [buildProductDecisionItem()],
			}),
		);
	});

	await mockAiOpsActionsRoute({
		page,
		onPostCapture: (body) => {
			capturedBody = body;
		},
	});

	await page.goto('/analytics/ai/products');

	await page.getByRole('button', { name: '실행 큐로 보내기' }).click();

	await expect(page.getByText('테스트 상품 액션을 실행 큐에 적재했습니다.')).toBeVisible();
	expect(capturedBody).toEqual({
		source_scope: 'ai-ops-products',
		entity_type: 'sku',
		entity_id: 'SKU-PRODUCT-1',
		action_type: 'QUEUE_PRIMARY_ACTION',
		priority: 'P1',
		payload: {
			title: 'FAQ 보강',
			product_name: '테스트 상품',
			policy_type: 'FAQ_CONTENT_IMPROVEMENT',
			top_issue: 'FAQ 보강 필요',
		},
	});
});

test('리뷰 VOC 판단에서 실행 큐 적재 요청을 보낸다', async ({ page }) => {
	let capturedBody: Record<string, unknown> | null = null;

	await page.route('**/ai/ops/reviews/summary**', async (route) => {
		await route.fulfill(
			okJson({
				summary: {
					total_products: 1,
					urgent_count: 1,
					reply_improvement_count: 0,
					avg_negative_ratio: 0.42,
				},
			}),
		);
	});

	await page.route('**/ai/ops/reviews/products**', async (route) => {
		await route.fulfill(
			okJson({
				items: [
					buildReviewDecisionItem(),
				],
			}),
		);
	});

	await page.route('**/ai/ops/reviews/actions**', async (route) => {
		await route.fulfill(okJson({ actions: [] }));
	});

	await mockAiOpsActionsRoute({
		page,
		onPostCapture: (body) => {
			capturedBody = body;
		},
	});

	await page.goto('/analytics/ai/reviews');

	await page.getByRole('button', { name: 'VOC 실행 큐로 보내기' }).click();

	await expect(page.getByText('리뷰 상품 액션을 실행 큐에 적재했습니다.')).toBeVisible();
	expect(capturedBody).toEqual({
		source_scope: 'ai-ops-reviews',
		entity_type: 'sku',
		entity_id: 'SKU-REVIEW-1',
		action_type: 'QUEUE_PRIMARY_ACTION',
		priority: 'P1',
		payload: {
			title: 'VOC 개선',
			product_name: '리뷰 상품',
			action_bucket: 'VOC_IMPROVEMENT',
			top_issue: '배송 불만 반복',
		},
	});
});

test('Q&A 전환장벽 판단에서 실행 큐 적재 요청을 보낸다', async ({ page }) => {
	let capturedBody: Record<string, unknown> | null = null;

	await page.route('**/ai/ops/qna/summary**', async (route) => {
		await route.fulfill(
			okJson({
				summary: {
					total_products: 1,
					barrier_count: 1,
					faq_gap_count: 1,
					prepurchase_ratio: 0.87,
				},
			}),
		);
	});

	await page.route('**/ai/ops/qna/products**', async (route) => {
		await route.fulfill(
			okJson({
				items: [
					buildQnaDecisionItem(),
				],
			}),
		);
	});

	await page.route('**/ai/ops/qna/actions**', async (route) => {
		await route.fulfill(okJson({ actions: [] }));
	});

	await mockAiOpsActionsRoute({
		page,
		onPostCapture: (body) => {
			capturedBody = body;
		},
	});

	await page.goto('/analytics/ai/qna');

	await page.getByRole('button', { name: 'Q&A 실행 큐로 보내기' }).click();

	await expect(page.getByText('Q&A 상품 액션을 실행 큐에 적재했습니다.')).toBeVisible();
	expect(capturedBody).toEqual({
		source_scope: 'ai-ops-qna',
		entity_type: 'sku',
		entity_id: 'SKU-QNA-1',
		action_type: 'QUEUE_PRIMARY_ACTION',
		priority: 'P1',
		payload: {
			title: 'FAQ 등록',
			product_name: 'Q&A 상품',
			action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
			top_issue: '성분 문의 반복',
		},
	});
});

test('실행 큐에서 검토 메모와 함께 승인 요청을 보낸다', async ({ page }) => {
	let capturedBody: Record<string, unknown> | null = null;

	await mockAiOpsActionsRoute({
		page,
		summary: {
			pending_count: 1,
		},
		items: [
			buildQueueItem({
				queue_id: 'QUEUE-1',
				entity_id: 'SKU-ACTION-1',
				approval_recommendation_reason: '추천 점수 88점',
				payload: {
					title: 'FAQ 보강',
					product_name: '승인 대상 상품',
					action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
					top_issue: 'FAQ 부재',
					policy_type: 'FAQ_CONTENT_IMPROVEMENT',
				},
			}),
		],
	});

	await capturePostJson({
		page,
		url: '**/ai/ops/actions/QUEUE-1/status',
		onCapture: (body) => {
			capturedBody = body;
		},
	});

	await page.goto('/analytics/ai/actions');

	await page.getByPlaceholder('검토 메모를 입력하세요').fill('운영 검토 후 승인');
	await page.getByRole('button', { name: '추천 승인' }).click();

	await expect(page.getByText('실행 큐 상태를 APPROVED로 변경했습니다.')).toBeVisible();
	expect(capturedBody).toEqual({
		status: 'APPROVED',
		reviewer: 'ai-ops-ui',
		review_note: '운영 검토 후 승인',
	});
});

test('실행 큐에서 반려 요청 시 기본 반려 메모를 보낸다', async ({ page }) => {
	let capturedBody: Record<string, unknown> | null = null;

	await mockAiOpsActionsRoute({
		page,
		summary: {
			pending_count: 1,
		},
		items: [
			buildQueueItem({
				queue_id: 'QUEUE-REJECT-1',
				entity_id: 'SKU-ACTION-2',
				approval_recommendation: 'REVIEW',
				approval_recommendation_reason: '증거 부족',
				payload: {
					title: '광고 확대 테스트',
					product_name: '반려 대상 상품',
					action_bucket: 'BUDGET_INCREASE',
					top_issue: '표본 부족',
					policy_type: 'AD_GROWTH',
				},
			}),
		],
	});

	await capturePostJson({
		page,
		url: '**/ai/ops/actions/QUEUE-REJECT-1/status',
		onCapture: (body) => {
			capturedBody = body;
		},
	});

	await page.goto('/analytics/ai/actions');

	await page.getByRole('button', { name: '반려' }).click();

	await expect(page.getByText('실행 큐 상태를 REJECTED로 변경했습니다.')).toBeVisible();
	expect(capturedBody).toEqual({
		status: 'REJECTED',
		reviewer: 'ai-ops-ui',
		review_note: '추천 결과와 다르게 반려: 증거 부족',
	});
});

test('실행 큐에서 완료 요청 시 기본 완료 메모를 보낸다', async ({ page }) => {
	let capturedBody: Record<string, unknown> | null = null;

	await mockAiOpsActionsRoute({
		page,
		summary: {
			pending_count: 1,
		},
		items: [
			buildQueueItem({
				queue_id: 'QUEUE-DONE-1',
				entity_id: 'SKU-ACTION-3',
				status: 'APPROVED',
				approval_recommendation_reason: '성과 기대치 높음',
				payload: {
					title: 'FAQ 보강',
					product_name: '완료 대상 상품',
					action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
					top_issue: 'FAQ 부재',
					policy_type: 'FAQ_CONTENT_IMPROVEMENT',
				},
			}),
		],
	});

	await capturePostJson({
		page,
		url: '**/ai/ops/actions/QUEUE-DONE-1/status',
		onCapture: (body) => {
			capturedBody = body;
		},
	});

	await page.goto('/analytics/ai/actions');

	await page.getByRole('button', { name: '완료' }).click();

	await expect(page.getByText('실행 큐 상태를 DONE로 변경했습니다.')).toBeVisible();
	expect(capturedBody).toEqual({
		status: 'DONE',
		reviewer: 'ai-ops-ui',
		review_note: '추천 결과 기반 실행 완료: 성과 기대치 높음',
	});
});

test('액션 버킷 필터를 해제할 수 있다', async ({ page }) => {
	await mockAiOpsActionsRoute({
		page,
		summary: {
			pending_count: 1,
		},
		items: [
			buildQueueItem({
				queue_id: 'QUEUE-FILTER-1',
				entity_id: 'SKU-ACTION-4',
				payload: {
					title: 'FAQ 보강',
					product_name: '필터 테스트 상품',
					action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
					top_issue: 'FAQ 부재',
					policy_type: 'FAQ_CONTENT_IMPROVEMENT',
				},
			}),
		],
	});

	await page.goto('/analytics/ai/actions?action_bucket=FAQ_CONTENT_IMPROVEMENT');

	await expect(page.getByText('현재 필터: FAQ 보강')).toBeVisible();
	await page.getByRole('button', { name: '필터 해제' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/actions$/);
});

test('정책 센터에서 비교 액션 실행 큐 적재 요청을 보낸다', async ({ page }) => {
	let capturedBody: Record<string, unknown> | null = null;

	await page.route('**/ai/ops/policies/compare', async (route) => {
		await route.fulfill(
			okJson({
				summary: {
					selected_sku_id: 'SKU-COMPARE-1',
					selected_product_name: '비교 SKU 1',
					current_policy_pack_id: 'AI_OPS',
					recommended_policy_pack_id: 'AI_OPS_BRAND_A',
				},
				candidates: [
					{ sku_id: 'SKU-COMPARE-1', product_name: '비교 SKU 1', current_policy_pack_id: 'AI_OPS' },
				],
				items: [
					buildPolicyCompareItem(),
					buildPolicyCompareItem({
						policy_pack_id: 'AI_OPS_BRAND_A',
						policy_pack_title: '브랜드A 정책팩',
						policy_type: 'AD_GROWTH',
						top_issue: '확장 가능합니다.',
						recommended_action_primary: '광고 확대 테스트',
						recommendation_score: 94,
						recommendation_reason: '검증 개선율 높음',
						recommended: true,
						matches_current_pack: false,
					}),
				],
			}),
		);
	});

	await page.route('**/ai/ops/policies', async (route) => {
		await route.fulfill(
			okJson({
				summary: {
					total_skus: 1,
					policy_count: 1,
					rule_pack_count: 2,
					format_version: 'v2',
					common_rules_len: 8,
				},
				items: [],
				learning_items: [],
			}),
		);
	});

	await capturePostJson({
		page,
		url: '**/ai/ops/policies/compare/actions',
		onCapture: (body) => {
			capturedBody = body;
		},
	});

	await page.goto('/analytics/ai/policies');

	await page.getByRole('button', { name: '이 액션을 실행 큐로 보내기' }).click();

	await expect(page.getByText('비교 SKU 1 비교 액션을 실행 큐에 적재했습니다.')).toBeVisible();
	expect(capturedBody).toEqual({
		sku_id: 'SKU-COMPARE-1',
		target_policy_pack_id: 'AI_OPS_BRAND_A',
	});
});
