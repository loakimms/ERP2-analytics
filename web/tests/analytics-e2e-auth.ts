import type { Page } from '@playwright/test';

export const ANALYTICS_FIREBASE_SESSION_STORAGE_KEY = 'analytics:firebase_session_v1';

const DEFAULT_ANALYTICS_E2E_SESSION = {
	idToken: 'e2e-token',
	refreshToken: 'e2e-refresh',
	uid: 'e2e-user',
	email: 'e2e@example.com',
	displayName: 'E2E User',
};

type AnalyticsE2eSession = typeof DEFAULT_ANALYTICS_E2E_SESSION & {
	expiresAtMs: number;
};

type TestWithBeforeEach = {
	beforeEach: (hook: (args: { page: Page }) => Promise<void>) => void;
};

export async function seedAnalyticsE2eAuthSession(
	page: Page,
	overrides: Partial<Omit<AnalyticsE2eSession, 'expiresAtMs'>> = {},
): Promise<void> {
	await page.addInitScript(
		({ storageKey, session }) => {
			window.localStorage.setItem(storageKey, JSON.stringify(session));
		},
		{
			storageKey: ANALYTICS_FIREBASE_SESSION_STORAGE_KEY,
			session: {
				...DEFAULT_ANALYTICS_E2E_SESSION,
				...overrides,
				expiresAtMs: Date.now() + 60 * 60 * 1000,
			},
		},
	);
}

export function registerAnalyticsAuthBootstrap(testApi: TestWithBeforeEach): void {
	testApi.beforeEach(async ({ page }) => {
		await seedAnalyticsE2eAuthSession(page);
	});
}
