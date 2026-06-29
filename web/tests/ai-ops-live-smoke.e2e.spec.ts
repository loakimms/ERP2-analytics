import { expect, test, type Page } from '@playwright/test';
import { registerAnalyticsAuthBootstrap } from './analytics-e2e-auth';
import { AI_OPS_ROUTE_DEFINITIONS } from './ai-ops-routes';

registerAnalyticsAuthBootstrap(test);

const AI_OPS_ROUTE_BY_PATH = new Map(AI_OPS_ROUTE_DEFINITIONS.map((route) => [route.path, route]));

async function assertLiveRouteLoaded(
	page: Page,
	route: (typeof AI_OPS_ROUTE_DEFINITIONS)[number],
	consoleErrors?: string[],
): Promise<void> {
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('운영 플로우')).toBeVisible();
	await expect(page.getByText(route.title, { exact: true }).last()).toBeVisible();
	await expect(page.getByRole('button', { name: '1. 오늘의 실행' })).toBeVisible();
	await expect(page.getByRole('button', { name: '5. 정책 학습' })).toBeVisible();
	await expect(page.getByText(route.live.stableBlockTitle, { exact: false }).first()).toBeVisible();
	await expect(page.getByText(route.live.loadingText, { exact: true })).toHaveCount(0);
	await expect(page.getByText(route.live.errorText, { exact: true })).toHaveCount(0);
	if (consoleErrors) {
		expect(consoleErrors).toEqual([]);
	}
}

for (const route of AI_OPS_ROUTE_DEFINITIONS) {
	test(`live: ${route.title} 화면이 실제 API 기준으로 렌더링된다`, async ({ page }) => {
		const consoleErrors: string[] = [];
		page.on('pageerror', (error) => {
			consoleErrors.push(String(error));
		});

		await page.goto(route.path);
		await assertLiveRouteLoaded(page, route, consoleErrors);
	});
}

test('live: 공통 운영 플로우 버튼으로 홈과 정책 학습 화면을 이동할 수 있다', async ({ page }) => {
	const homeRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/home');
	const policiesRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/policies');
	const logsRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/logs');

	expect(homeRoute).toBeTruthy();
	expect(policiesRoute).toBeTruthy();
	expect(logsRoute).toBeTruthy();

	await page.goto('/analytics/ai/logs');
	await assertLiveRouteLoaded(page, logsRoute!);

	await page.getByTestId('ai-ops-flow-step-home').click();
	await expect(page).toHaveURL(/\/analytics\/ai\/home$/);
	await assertLiveRouteLoaded(page, homeRoute!);

	await page.getByTestId('ai-ops-flow-step-policies').click();
	await expect(page).toHaveURL(/\/analytics\/ai\/policies$/);
	await assertLiveRouteLoaded(page, policiesRoute!);
});

test('live: action bucket query를 유지한 채 실행 큐, 검증 로그, 홈을 이동할 수 있다', async ({ page }) => {
	const selectedBucket = 'FAQ_CONTENT_IMPROVEMENT';
	const actionsRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/actions');
	const logsRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/logs');
	const homeRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/home');

	expect(actionsRoute).toBeTruthy();
	expect(logsRoute).toBeTruthy();
	expect(homeRoute).toBeTruthy();

	await page.goto(`/analytics/ai/actions?action_bucket=${selectedBucket}`);
	await assertLiveRouteLoaded(page, actionsRoute!);
	await expect(page.getByText('현재 필터: FAQ 보강')).toBeVisible();

	await page.getByRole('button', { name: '검증 로그로 이동' }).click();
	await expect(page).toHaveURL(new RegExp(`/analytics/ai/logs\\?action_bucket=${selectedBucket}$`));
	await assertLiveRouteLoaded(page, logsRoute!);
	await expect(page.getByText('현재 필터: FAQ 보강')).toBeVisible();

	await page.getByRole('button', { name: '홈으로 돌아가기' }).click();
	await expect(page).toHaveURL(new RegExp(`/analytics/ai/home\\?action_bucket=${selectedBucket}$`));
	await assertLiveRouteLoaded(page, homeRoute!);
	await expect(page.getByText('현재 필터: FAQ 보강')).toBeVisible();
});

test('live: 정책 학습 화면의 빠른 이동 버튼으로 홈, 실행 큐, 검증 로그를 이동할 수 있다', async ({ page }) => {
	const policiesRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/policies');
	const homeRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/home');
	const actionsRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/actions');
	const logsRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/logs');

	expect(policiesRoute).toBeTruthy();
	expect(homeRoute).toBeTruthy();
	expect(actionsRoute).toBeTruthy();
	expect(logsRoute).toBeTruthy();

	await page.goto('/analytics/ai/policies');
	await assertLiveRouteLoaded(page, policiesRoute!);

	await page.getByTestId('ai-ops-flow-quicklink-home').click();
	await expect(page).toHaveURL(/\/analytics\/ai\/home$/);
	await assertLiveRouteLoaded(page, homeRoute!);

	await page.goto('/analytics/ai/policies');
	await assertLiveRouteLoaded(page, policiesRoute!);

	await page.getByTestId('ai-ops-flow-quicklink-actions').click();
	await expect(page).toHaveURL(/\/analytics\/ai\/actions$/);
	await assertLiveRouteLoaded(page, actionsRoute!);

	await page.goto('/analytics/ai/policies');
	await assertLiveRouteLoaded(page, policiesRoute!);

	await page.getByTestId('ai-ops-flow-quicklink-logs').click();
	await expect(page).toHaveURL(/\/analytics\/ai\/logs$/);
	await assertLiveRouteLoaded(page, logsRoute!);
});

test('live: 홈 화면에서 action bucket 필터를 해제하면 query가 제거되고 배너가 사라진다', async ({ page }) => {
	const selectedBucket = 'FAQ_CONTENT_IMPROVEMENT';
	const homeRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/home');

	expect(homeRoute).toBeTruthy();

	await page.goto(`/analytics/ai/home?action_bucket=${selectedBucket}`);
	await assertLiveRouteLoaded(page, homeRoute!);
	await expect(page.getByText('현재 필터: FAQ 보강')).toBeVisible();

	await page.getByRole('button', { name: '필터 해제' }).click();
	await expect(page).toHaveURL(/\/analytics\/ai\/home$/);
	await assertLiveRouteLoaded(page, homeRoute!);
	await expect(page.getByText('현재 필터: FAQ 보강')).toHaveCount(0);
});

test('live: 검증 로그 화면의 정책팩 필터는 기본값을 보여주고 옵션이 있으면 변경할 수 있다', async ({ page }) => {
	const logsRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/logs');

	expect(logsRoute).toBeTruthy();

	await page.goto('/analytics/ai/logs');
	await assertLiveRouteLoaded(page, logsRoute!);

	const filter = page.getByLabel('logs-policy-pack-filter');
	await expect(filter).toBeVisible();
	await expect(filter).toHaveValue('ALL');
	await expect(page.getByRole('option', { name: '전체 정책팩' })).toBeVisible();

	const options = page.locator('select[aria-label="logs-policy-pack-filter"] option');
	const optionCount = await options.count();
	if (optionCount <= 1) return;

	const initialPackNotes = page.locator('text=/정책팩 /');
	const initialPackNoteTexts = (await initialPackNotes.allTextContents()).map((text) => text.trim()).filter(Boolean);
	const nextValue = await options.nth(1).getAttribute('value');
	const nextLabel = (await options.nth(1).innerText()).trim();
	if (!nextValue) return;

	await filter.selectOption(nextValue);
	await expect(filter).toHaveValue(nextValue);
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(logsRoute!.live.errorText, { exact: true })).toHaveCount(0);
	await expect(page.getByRole('option', { name: nextLabel })).toBeVisible();

	const emptyBanner = page.getByText('표시할 검증 로그가 없습니다.', { exact: true });
	if ((await emptyBanner.count()) > 0 && (await emptyBanner.first().isVisible())) return;

	const filteredPackNote = page.getByText(`정책팩 ${nextValue}`, { exact: false }).first();
	await expect(filteredPackNote).toBeVisible();

	const nextPackNoteTexts = (await page.locator('text=/정책팩 /').allTextContents()).map((text) => text.trim()).filter(Boolean);
	expect(nextPackNoteTexts.length).toBeGreaterThan(0);
	expect(nextPackNoteTexts.every((text) => text.includes(`정책팩 ${nextValue}`))).toBe(true);

	if (initialPackNoteTexts.length > 0) {
		expect(nextPackNoteTexts).not.toEqual(initialPackNoteTexts);
	}
});

test('live: 정책 비교 SKU 선택기는 기본 선택을 보여주고 후보가 여러 개면 전환할 수 있다', async ({ page }) => {
	const policiesRoute = AI_OPS_ROUTE_BY_PATH.get('/analytics/ai/policies');

	expect(policiesRoute).toBeTruthy();

	await page.goto('/analytics/ai/policies');
	await assertLiveRouteLoaded(page, policiesRoute!);

	const skuSelect = page.getByLabel('policy-compare-sku-select');
	await expect(skuSelect).toBeVisible();
	await expect(page.getByText(/현재 적용 정책팩:/)).toBeVisible();
	await expect(page.getByText(/추천 정책팩:/)).toBeVisible();

	const options = page.locator('select[aria-label="policy-compare-sku-select"] option');
	const optionCount = await options.count();
	expect(optionCount).toBeGreaterThan(0);

	const initialValue = await skuSelect.inputValue();
	expect(initialValue.length).toBeGreaterThan(0);
	const selectedSkuLine = page.getByText(/선택 SKU:/).first();
	const initialSelectedSkuText = ((await selectedSkuLine.textContent()) || '').trim();
	await expect(selectedSkuLine).toBeVisible();
	const currentPolicyPackLine = page.getByText(/현재 적용 정책팩:/).first();
	const recommendedPolicyPackLine = page.getByText(/추천 정책팩:/).first();
	const initialCurrentPolicyPackText = ((await currentPolicyPackLine.textContent()) || '').trim();
	const initialRecommendedPolicyPackText = ((await recommendedPolicyPackLine.textContent()) || '').trim();

	const recommendedBadge = page.getByText('추천', { exact: true }).first();
	const currentBadge = page.getByText('현재 적용', { exact: true }).first();
	if ((await recommendedBadge.count()) > 0) {
		await expect(recommendedBadge).toBeVisible();
	}
	if ((await currentBadge.count()) > 0) {
		await expect(currentBadge).toBeVisible();
	}

	if (optionCount <= 1) return;

	const nextValue = await options.nth(1).getAttribute('value');
	if (!nextValue || nextValue === initialValue) return;

	await skuSelect.selectOption(nextValue);
	await expect(skuSelect).toHaveValue(nextValue);
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(policiesRoute!.live.errorText, { exact: true })).toHaveCount(0);
	await expect(selectedSkuLine).toBeVisible();

	const nextSelectedSkuText = ((await selectedSkuLine.textContent()) || '').trim();
	const nextCurrentPolicyPackText = ((await currentPolicyPackLine.textContent()) || '').trim();
	const nextRecommendedPolicyPackText = ((await recommendedPolicyPackLine.textContent()) || '').trim();
	expect(nextSelectedSkuText.length).toBeGreaterThan(0);
	expect(
		nextSelectedSkuText !== initialSelectedSkuText ||
			nextCurrentPolicyPackText !== initialCurrentPolicyPackText ||
			nextRecommendedPolicyPackText !== initialRecommendedPolicyPackText,
	).toBe(true);
});
