import React from 'react';
import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import { AppShell } from './AppShell';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
			post: vi.fn(),
			patch: vi.fn(),
			put: vi.fn(),
		},
	};
});

vi.mock('../auth/AuthProvider', () => {
	return {
		useMaybeAuth: () => ({
			getIdToken: vi.fn().mockResolvedValue('test-firebase-token'),
		}),
	};
});

let latestView: RenderResult | null = null;

export const mockedAxios = axios as any;

export function registerAppShellTestLifecycle(): void {
	beforeEach(() => {
		if (!HTMLElement.prototype.scrollTo) {
			HTMLElement.prototype.scrollTo = vi.fn();
		}
		window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '0');
		window.localStorage.setItem('analytics:page_metrics:auto_sync_v1', '0');
	});

	afterEach(() => {
		try {
			window.localStorage.removeItem('analytics:collect_modal:auto_open_v1');
			window.localStorage.removeItem('analytics:page_metrics:auto_sync_v1');
		} catch {
			// ignore
		}
		try {
			latestView?.unmount();
		} catch {
			// ignore
		}
		latestView = null;
		cleanup();
		vi.restoreAllMocks();
	});
}

export async function flushReactEffects(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});
}

export async function clickWithAct(target: Element): Promise<void> {
	await act(async () => {
		fireEvent.click(target);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export async function renderAppShell(initialEntry: string): Promise<RenderResult> {
	let renderedView!: RenderResult;
	await act(async () => {
		latestView?.unmount();
		renderedView = render(
			<MemoryRouter initialEntries={[initialEntry]}>
				<AppShell />
			</MemoryRouter>,
		);
		latestView = renderedView;
		await Promise.resolve();
		await Promise.resolve();
	});
	return renderedView;
}
