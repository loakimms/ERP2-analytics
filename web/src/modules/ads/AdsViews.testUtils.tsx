import React from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AdgroupDailyView, CampaignDailyView, CreativesDailyView } from './AdsViews';

const hoistedAxiosMocks = vi.hoisted(() => ({
	post: vi.fn(),
	get: vi.fn(),
}));

vi.mock('axios', () => ({
	default: hoistedAxiosMocks,
}));

const hoistedAdsJobCacheMocks = vi.hoisted(() => {
	const start = vi.fn().mockResolvedValue({ rows: [], totalRow: null });
	const subscribe = vi.fn((key: string, listener: any) => {
		listener({ status: 'idle', message: null, data: null, error: null });
		return () => {};
	});
	const invalidate = vi.fn();
	const cancel = vi.fn();
	const getState = vi.fn(() => ({ status: 'idle', message: null, data: null, error: null }));
	const findLatestLoadingKey = vi.fn(() => null);
	return { start, subscribe, invalidate, cancel, getState, findLatestLoadingKey };
});

vi.mock('./adsJobCache', () => ({
	adsJobCache: {
		start: hoistedAdsJobCacheMocks.start,
		subscribe: hoistedAdsJobCacheMocks.subscribe,
		invalidate: hoistedAdsJobCacheMocks.invalidate,
		cancel: hoistedAdsJobCacheMocks.cancel,
		getState: hoistedAdsJobCacheMocks.getState,
		findLatestLoadingKey: hoistedAdsJobCacheMocks.findLatestLoadingKey,
	},
}));

export const mockedAxios = axios as any;

export function getAdsJobCacheMocks() {
	return hoistedAdsJobCacheMocks;
}

function LocationDisplay(): JSX.Element {
	const loc = useLocation();
	return <div data-testid="location">{loc.pathname}{loc.search}</div>;
}

export function TestRoutes(props: { apiBaseUrl: string }): JSX.Element {
	return (
		<Routes>
			<Route path="/analytics/campaign/campaigns" element={<CampaignDailyView apiBaseUrl={props.apiBaseUrl} />} />
			<Route path="/analytics/campaign/adgroups" element={<AdgroupDailyView apiBaseUrl={props.apiBaseUrl} />} />
			<Route path="/analytics/campaign/creatives" element={<CreativesDailyView apiBaseUrl={props.apiBaseUrl} />} />
			<Route path="*" element={<LocationDisplay />} />
		</Routes>
	);
}

export function renderAdsRoutes(initialEntry: string): JSX.Element {
	return (
		<MemoryRouter initialEntries={[initialEntry]}>
			<TestRoutes apiBaseUrl="http://example.test" />
		</MemoryRouter>
	);
}

export function renderAdsRoutesWithLocation(initialEntry: string): JSX.Element {
	return (
		<MemoryRouter initialEntries={[initialEntry]}>
			<LocationDisplay />
			<TestRoutes apiBaseUrl="http://example.test" />
		</MemoryRouter>
	);
}

export function registerAdsViewsTestLifecycle(): void {
	beforeEach(() => {
		try {
			localStorage.removeItem('ads.dateState.v1');
			localStorage.removeItem('ads.campaign.statusFilter.v1');
			localStorage.removeItem('ads.adgroup.statusFilter.v1');
			localStorage.removeItem('ads.creative.trendMetrics.v1');
			localStorage.removeItem('ads.campaign.hiddenColumns.v1');
			localStorage.removeItem('ads.adgroup.hiddenColumns.v1');
			localStorage.removeItem('ads.creative.hiddenColumns.v1');
			localStorage.removeItem('ads.campaign.trendMetrics.v1');
			localStorage.removeItem('ads.adgroup.trendMetrics.v1');
		} catch {
			// ignore
		}
		hoistedAdsJobCacheMocks.start.mockReset();
		hoistedAdsJobCacheMocks.start.mockResolvedValue({ rows: [], totalRow: null });
		hoistedAdsJobCacheMocks.subscribe.mockReset();
		hoistedAdsJobCacheMocks.subscribe.mockImplementation((key: string, listener: any) => {
			listener({ status: 'idle', message: null, data: null, error: null });
			return () => {};
		});
		hoistedAdsJobCacheMocks.invalidate.mockReset();
		hoistedAdsJobCacheMocks.cancel.mockReset();
		hoistedAdsJobCacheMocks.getState.mockReset();
		hoistedAdsJobCacheMocks.getState.mockImplementation(() => ({ status: 'idle', message: null, data: null, error: null }));
		hoistedAdsJobCacheMocks.findLatestLoadingKey.mockReset();
		hoistedAdsJobCacheMocks.findLatestLoadingKey.mockImplementation(() => null);
		mockedAxios.post.mockReset();
		mockedAxios.post.mockImplementation((url: string) => {
			if (String(url).includes('/ads/validate-fix')) {
				return Promise.resolve({ data: { processed: [] } });
			}
			return Promise.resolve({ data: {} });
		});
		mockedAxios.get.mockReset();
		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url).includes('/ai/models')) {
				return Promise.resolve({ data: { ok: true, models: [] } });
			}
			return Promise.resolve({ data: [] });
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});
}
