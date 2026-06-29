import React from 'react';
import { beforeEach, vi } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import axios from 'axios';
import { fetchKeywordDaily, fetchSearchwordDaily } from '../ads/adsApi';
import { fetchPurchaseKeywordsDaily } from '../purchase/purchaseApi';
import type { RankHistory } from './rankUtils';
import type { RankTrackingDetailProduct } from './RankTrackingDetailView';

vi.mock('axios', () => {
	return {
		default: {
			post: vi.fn(),
			get: vi.fn(),
			put: vi.fn(() => Promise.resolve({ data: {} })),
		},
	};
});

vi.mock('../ads/adsApi', () => {
	return {
		fetchKeywordDaily: vi.fn(),
		fetchSearchwordDaily: vi.fn(),
	};
});

vi.mock('../purchase/purchaseApi', () => {
	return {
		fetchPurchaseKeywordsDaily: vi.fn(),
	};
});

export const mockedAxios = axios as any;
export const fetchSearchwordDailyMock = fetchSearchwordDaily as any;
export const fetchKeywordDailyMock = fetchKeywordDaily as any;
export const fetchPurchaseKeywordsDailyMock = fetchPurchaseKeywordsDaily as any;

export const sampleProduct: RankTrackingDetailProduct = {
	id: 'p1',
	name: '새치 헤나 염색약 유기농 비건 천연 염색약 가루 1개',
	sellerName: '수자타헤나',
	categoryPath: '화장품/미용 > 헤어스타일링 > 염색약',
	price: 14000,
	reviewCount: 31810,
	rating: 4.68,
	hashtags: ['새치염색', '천연염색', '염색약'],
};

export const sampleHistory: RankHistory = {
	dates: ['2025-12-20', '2025-12-21'],
	series: [
		{
			keyword: '새치염색',
			series: [
				{ date: '2025-12-20', rank: 10 },
				{ date: '2025-12-21', rank: 8 },
			],
		},
		{
			keyword: '천연염색',
			series: [{ date: '2025-12-20', rank: 3 }],
		},
	],
};

export async function renderRankTrackingDetailView(view: React.ReactElement): Promise<RenderResult> {
	let rendered!: RenderResult;
	await act(async () => {
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

export function registerRankTrackingDetailTestLifecycle(): void {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchSearchwordDailyMock.mockResolvedValue([]);
		fetchKeywordDailyMock.mockResolvedValue([]);
		fetchPurchaseKeywordsDailyMock.mockResolvedValue([]);
		mockedAxios.get.mockResolvedValue({ data: [] });
		mockedAxios.post.mockResolvedValue({ data: {} });

		try {
			window.localStorage.setItem('analytics:rank:tracking_mode_v2::p1', 'initial');
		} catch {
			// ignore
		}
	});
}
