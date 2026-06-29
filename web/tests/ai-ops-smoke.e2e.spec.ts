import { expect, test } from '@playwright/test';
import { registerAnalyticsAuthBootstrap } from './analytics-e2e-auth';
import { AI_OPS_ROUTE_DEFINITIONS } from './ai-ops-routes';

registerAnalyticsAuthBootstrap(test);

for (const route of AI_OPS_ROUTE_DEFINITIONS) {
	test(`${route.title} 화면이 기본 구조와 함께 열린다`, async ({ page }) => {
		await page.goto(route.path);

		await expect(page.getByText('운영 플로우')).toBeVisible();
		await expect(page.getByText(route.title, { exact: true }).last()).toBeVisible();
		await expect(page.getByRole('button', { name: '1. 오늘의 실행' })).toBeVisible();
		await expect(page.getByRole('button', { name: '5. 정책 학습' })).toBeVisible();
	});
}

test('오늘의 실행에서 주요 단계로 빠르게 이동할 수 있다', async ({ page }) => {
	await page.goto('/analytics/ai/home');

	await page.getByRole('button', { name: '실행 큐 열기' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/actions/);
	await expect(page.getByText('실행 큐', { exact: true }).last()).toBeVisible();

	await page.getByRole('button', { name: '검증 로그 열기' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/logs/);
	await expect(page.getByText('검증\/설명 로그', { exact: true }).last()).toBeVisible();

	await page.getByRole('button', { name: 'SKU 정책 센터' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/policies/);
	await expect(page.getByText('SKU 정책 센터', { exact: true }).last()).toBeVisible();
});

test('액션 버킷 필터를 유지한 채 다른 단계로 이동할 수 있다', async ({ page }) => {
	await page.goto('/analytics/ai/actions?action_bucket=AD_OVERINVESTMENT');

	await expect(page.getByText('현재 필터: 광고 과투입')).toBeVisible();

	await page.getByRole('button', { name: '검증 로그로 이동' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/logs\?action_bucket=AD_OVERINVESTMENT/);
	await expect(page.getByText('현재 필터: 광고 과투입')).toBeVisible();

	await page.getByRole('button', { name: '홈으로 돌아가기' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/home\?action_bucket=AD_OVERINVESTMENT/);
	await expect(page.getByText('현재 필터: 광고 과투입')).toBeVisible();
});

test('정책 센터에서 상품 판단 화면으로 연결할 수 있다', async ({ page }) => {
	await page.goto('/analytics/ai/policies');

	await page.getByRole('button', { name: '상품별 운영 판단 열기' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/products/);
	await expect(page.getByText('상품별 운영 판단', { exact: true }).last()).toBeVisible();
});
