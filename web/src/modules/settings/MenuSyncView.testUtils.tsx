import React from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import axios from 'axios';
import { MenuSyncView } from './MenuSyncView';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
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

export const mockedAxios = axios as any;

export async function renderMenuSyncView(): Promise<RenderResult> {
	let view!: RenderResult;
	await act(async () => {
		view = render(<MenuSyncView apiBaseUrl="/api" />);
		await Promise.resolve();
		await Promise.resolve();
	});
	return view;
}

export async function clickWithAct(target: Element): Promise<void> {
	await act(async () => {
		fireEvent.click(target);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export async function changeWithAct(target: Element, value: Record<string, unknown>): Promise<void> {
	await act(async () => {
		fireEvent.change(target, value);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export function getFetchMock(): any {
	return globalThis.fetch as any;
}

export function registerMenuSyncTestLifecycle(): void {
	beforeEach(() => {
		(mockedAxios.get as any).mockReset();
		(globalThis.fetch as any) = vi.fn();
		(globalThis.URL.createObjectURL as any) = vi.fn(() => 'blob:menu-sync');
		(globalThis.URL.revokeObjectURL as any) = vi.fn();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});
}
