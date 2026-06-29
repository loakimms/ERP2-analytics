import { expect, test } from '@playwright/test';
import { registerAnalyticsAuthBootstrap } from './analytics-e2e-auth';

registerAnalyticsAuthBootstrap(test);

test('캠페인 분석 헤더를 사용자 설정으로 숨길 수 있다', async ({ page }) => {
	await page.goto('/analytics/test/ads-columns');

	const section = page.getByTestId('e2e-campaign-section');
	await expect(section.getByRole('button', { name: '사용자 설정' })).toBeVisible();
	await expect(section.getByRole('columnheader', { name: /노출수/ })).toBeVisible();

	await section.getByRole('button', { name: '사용자 설정' }).click();
	const dialog = page.getByRole('dialog', { name: '캠페인 분석 헤더 설정' });
	await dialog.getByLabel('노출수').uncheck();

	await expect(section.getByRole('columnheader', { name: /노출수/ })).toHaveCount(0);
	await expect(section.getByRole('columnheader', { name: /클릭수/ })).toBeVisible();
});

test('소재 분석에서 구매전환 컬럼과 정수 변동 퍼센트를 확인할 수 있다', async ({ page }) => {
	await page.goto('/analytics/test/ads-columns');

	const section = page.getByTestId('e2e-creative-section');
	await expect(section.getByRole('button', { name: '사용자 설정' })).toBeVisible();
	await expect(section.locator('th', { hasText: /^구매전환수/ }).first()).toBeVisible();
	await expect(section.getByRole('columnheader', { name: '구매전환매출액' })).toBeVisible();
	await expect(section.getByRole('columnheader', { name: '구매전환수익율(%)' })).toBeVisible();
	await expect(section.locator('.delta-pct', { hasText: '(11%)' }).first()).toBeVisible();
	await expect(section.getByText('(11.11%)')).toHaveCount(0);
});

test('광고 그룹 분석도 사용자 설정 모달에서 헤더를 제어할 수 있다', async ({ page }) => {
	await page.goto('/analytics/test/ads-columns');

	const section = page.getByTestId('e2e-adgroup-section');
	await expect(section.getByRole('button', { name: '사용자 설정' })).toBeVisible();
	await expect(section.getByRole('columnheader', { name: /광고그룹/ })).toBeVisible();

	await section.getByRole('button', { name: '사용자 설정' }).click();
	const dialog = page.getByRole('dialog', { name: '광고 그룹 분석 헤더 설정' });
	await dialog.getByLabel('광고그룹').uncheck();

	await expect(section.getByRole('columnheader', { name: /광고그룹/ })).toHaveCount(0);
	await expect(section.getByRole('columnheader', { name: /캠페인/ })).toBeVisible();
});
