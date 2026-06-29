import React from 'react';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
	},
}));

vi.mock('../auth/AuthProvider', () => ({
	useMaybeAuth: () => ({
		getIdToken: vi.fn().mockResolvedValue('test-token'),
	}),
}));

export async function renderQnaManagementView(
	view: React.ReactElement,
	props?: { initialPath?: string },
): Promise<RenderResult> {
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

export function registerQnaManagementTestLifecycle(): void {
	beforeEach(() => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockReset();
		(axiosAny.post as any).mockReset();
		window.history.replaceState({}, '', '/analytics/reviews/qna');
	});
}
