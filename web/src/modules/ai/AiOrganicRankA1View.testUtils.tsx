import React from 'react';
import { beforeEach, vi } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

vi.mock('axios', () => {
	return {
		default: {
			post: vi.fn(),
			get: vi.fn(),
		},
	};
});

export const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
	const actual: any = await vi.importActual('react-router-dom');
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

export const mockedAxios = axios as any;

export async function renderAiOrganicRankA1View(view: React.ReactElement): Promise<RenderResult> {
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

export function registerAiOrganicRankA1ViewTestLifecycle(): void {
	beforeEach(() => {
		vi.clearAllMocks();
	});
}
