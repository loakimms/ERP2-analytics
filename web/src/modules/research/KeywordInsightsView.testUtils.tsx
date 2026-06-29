import React from 'react';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
		},
	};
});

export const mockedAxios = axios as any;

export async function renderKeywordInsightsView(view: React.ReactElement, initialEntries: string[] = ['/']): Promise<RenderResult> {
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

export async function flushKeywordInsightsEffects(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

export function registerKeywordInsightsTestLifecycle(): void {
	beforeEach(() => {
		mockedAxios.get.mockReset();
		localStorage.clear();
	});
}
