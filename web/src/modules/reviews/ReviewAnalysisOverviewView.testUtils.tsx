import React from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import axios from 'axios';

vi.mock('axios', () => ({
	default: {
		get: vi.fn(),
	},
}));

vi.mock('../auth/AuthProvider', () => ({
	useMaybeAuth: () => null,
}));

export const mockedAxios = axios as any;

export async function renderReviewAnalysisOverviewView(view: React.ReactElement, props?: { initialPath?: string }): Promise<RenderResult> {
	let rendered!: RenderResult;
	await act(async () => {
		if (props?.initialPath) {
			window.history.replaceState({}, '', props.initialPath);
		}
		rendered = render(view);
		await Promise.resolve();
		await Promise.resolve();
	});
	return rendered;
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

export async function hoverWithAct(target: Element): Promise<void> {
	await act(async () => {
		fireEvent.mouseEnter(target);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export function registerReviewAnalysisOverviewTestLifecycle(): void {
	beforeEach(() => {
		mockedAxios.get.mockReset();
		window.open = vi.fn();
		window.history.replaceState({}, '', '/analytics/reviews/review-analysis');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});
}
