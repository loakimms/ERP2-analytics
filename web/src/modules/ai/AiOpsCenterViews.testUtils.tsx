import React from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
			post: vi.fn(),
		},
	};
});

export const mockedAxios = axios as any;

export async function renderAiOpsView(view: React.ReactElement, initialEntries: string[] = ['/']): Promise<RenderResult> {
	let rendered!: RenderResult;
	await act(async () => {
		rendered = render(<MemoryRouter initialEntries={initialEntries}>{view}</MemoryRouter>);
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

export function registerAiOpsTestLifecycle(): void {
	beforeEach(() => {
		mockedAxios.get.mockReset();
		mockedAxios.post.mockReset();
		mockedAxios.get.mockImplementation(() => Promise.resolve({ data: { ok: true, items: [] } }));
		mockedAxios.post.mockImplementation(() => Promise.resolve({ data: { ok: true } }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});
}
