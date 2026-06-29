import React from 'react';
import { beforeEach, vi } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import { fetchKeywordDaily, fetchSearchwordDaily } from './adsApi';

vi.mock('axios', () => {
	return {
		default: {
			post: vi.fn().mockResolvedValue({ data: {} }),
		},
	};
});

vi.mock('./adsApi', () => {
	return {
		fetchKeywordDaily: vi.fn(),
		fetchSearchwordDaily: vi.fn().mockResolvedValue([]),
		fetchSearchwordDailyAll: vi.fn().mockResolvedValue([]),
		fetchCampaignDaily: vi.fn().mockResolvedValue([]),
		fetchAdgroupDaily: vi.fn().mockResolvedValue([]),
		fetchCreativeDaily: vi.fn().mockResolvedValue([]),
	};
});

export const mockedAxios = axios as any;
export const fetchKeywordDailyMock = fetchKeywordDaily as any;
export const fetchSearchwordDailyMock = fetchSearchwordDaily as any;

export async function renderAdsKeywordsUnifiedView(view: React.ReactElement): Promise<RenderResult> {
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

export function registerAdsKeywordsUnifiedTestLifecycle(): void {
	beforeEach(() => {
		vi.clearAllMocks();
		try {
			localStorage.removeItem('ads.dateState.v1');
			localStorage.removeItem('ads.performance.campaignKinds.v1');
			localStorage.removeItem('ads.keywords.unified.hiddenColumns.v1');
		} catch {
			// ignore
		}
	});
}
