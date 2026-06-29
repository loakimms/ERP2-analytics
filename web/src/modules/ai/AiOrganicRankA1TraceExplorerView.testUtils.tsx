import React from 'react';
import { beforeEach, vi } from 'vitest';
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

export async function renderAiOrganicRankA1TraceExplorerView(view: React.ReactElement): Promise<RenderResult> {
	let rendered!: RenderResult;
	await act(async () => {
		rendered = render(<MemoryRouter>{view}</MemoryRouter>);
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

export function registerAiOrganicRankA1TraceExplorerTestLifecycle(): void {
	beforeEach(() => {
		mockedAxios.get.mockReset();
		mockedAxios.post.mockReset();
	});
}
