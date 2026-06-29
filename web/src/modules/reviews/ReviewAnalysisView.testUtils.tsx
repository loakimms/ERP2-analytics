import React from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import axios from 'axios';
import { ReviewAnalysisView } from './ReviewAnalysisView';
import { useMaybeAuth } from '../auth/AuthProvider';

vi.mock('axios', () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
	},
}));

vi.mock('../auth/AuthProvider', () => ({
	useMaybeAuth: vi.fn(() => null),
}));

export const mockedAxios = axios as any;
export const useMaybeAuthMock = vi.mocked(useMaybeAuth);

export function makeJwt(payload: Record<string, unknown>): string {
	const base64Url = (value: unknown) =>
		Buffer.from(JSON.stringify(value), 'utf8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url(payload)}.`;
}

export async function renderReviewAnalysisView(props?: { onNavigate?: (path: string) => void }): Promise<RenderResult> {
	let view!: RenderResult;
	await act(async () => {
		view = render(<ReviewAnalysisView apiBaseUrl="http://localhost:5189" onNavigate={props?.onNavigate} />);
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

export async function changeWithAct(target: Element, value: Record<string, any>): Promise<void> {
	await act(async () => {
		fireEvent.change(target, value);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export function registerReviewAnalysisTestLifecycle(): void {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-04-02T12:00:00+09:00'));
		window.localStorage.clear();
		window.history.replaceState({}, '', '/analytics/reviews/review-management');
		useMaybeAuthMock.mockReturnValue(null);
		vi.stubGlobal('confirm', vi.fn(() => true));
		Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true });
		Object.defineProperty(window, 'scrollY', { value: 640, writable: true, configurable: true });
		Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true, configurable: true });
		Object.assign(navigator, {
			clipboard: {
				writeText: vi.fn(() => Promise.resolve()),
			},
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});
}
