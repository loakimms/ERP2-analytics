import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fetchKeywordDaily, fetchSearchwordDaily } from './adsApi';
import axios from 'axios';

// 성과 화면은 adsJobCache를 사용하지 않고 직접 API를 호출하므로, 네트워크 호출을 모두 mock한다.
vi.mock('axios', () => {
	return {
		default: {
			post: vi.fn().mockResolvedValue({ data: {} }),
			get: vi.fn().mockResolvedValue({ data: { supported: false } }),
		},
	};
});

vi.mock('./adsApi', () => {
	return {
		fetchAdsAvailability: vi.fn().mockResolvedValue({ missingDates: [] }),
		fetchKeywordDaily: vi.fn().mockResolvedValue([]),
		fetchSearchwordDaily: vi.fn().mockResolvedValue([]),
		fetchSearchwordDailyAll: vi.fn().mockResolvedValue([]),
		// 아래 export들은 AdsViews.tsx에서 함께 import되지만, 이 테스트에서는 호출되지 않는다.
		fetchCampaignDaily: vi.fn().mockResolvedValue([]),
		fetchAdgroupDaily: vi.fn().mockResolvedValue([]),
		fetchCreativeDaily: vi.fn().mockResolvedValue([]),
	};
});

import { MemoryRouter } from 'react-router-dom';
import { KeywordsPerformanceView, SearchwordPerformanceView } from './AdsViews';

describe('AdsPerformanceViews', () => {
	beforeEach(() => {
		try {
			localStorage.removeItem('ads.dateState.v1');
			localStorage.removeItem('ads.autocollect.cooldown.v1');
		} catch {
			// ignore
		}
		vi.clearAllMocks();
	});

	it('키워드(파워링크) 효율 분석 화면이 ReferenceError 없이 렌더링된다', async () => {
		render(
			<MemoryRouter>
				<KeywordsPerformanceView apiBaseUrl="http://example.test" />
			</MemoryRouter>,
		);
		expect(screen.getAllByText(/키워드 효율 분석/).length).toBeGreaterThan(0);
		expect(screen.getByText('키워드 통합')).toBeTruthy();
		// 파워링크만: API 파라미터로 필터링
		await waitFor(() => expect(fetchKeywordDaily).toHaveBeenCalled());
		const calls = (fetchKeywordDaily as any).mock?.calls ?? [];
		const firstArgs = calls?.[0]?.[0];
		expect(firstArgs?.campaignKind).toBe('powerlink');
	});

	it('검색어(쇼핑검색) 효율 분석 화면이 ReferenceError 없이 렌더링된다', async () => {
		render(
			<MemoryRouter>
				<SearchwordPerformanceView apiBaseUrl="http://example.test" />
			</MemoryRouter>,
		);
		expect(screen.getAllByText(/검색어 효율 분석/).length).toBeGreaterThan(0);
		expect(screen.getByText('검색어 통합')).toBeTruthy();
		// 우선 searchword daily를 시도한다.
		await waitFor(() => expect(fetchSearchwordDaily).toHaveBeenCalled());
		const swCalls = (fetchSearchwordDaily as any).mock?.calls ?? [];
		const swFirstArgs = swCalls?.[0]?.[0];
		expect(swFirstArgs?.campaignKind).toBe('non_powerlink');
		// searchword가 비어있으면 keyword daily(non_powerlink)로 폴백한다.
		await waitFor(() => expect(fetchKeywordDaily).toHaveBeenCalled());
		const kwCalls = (fetchKeywordDaily as any).mock?.calls ?? [];
		const kwAnyNonPowerlink = kwCalls.some((c: any[]) => String(c?.[0]?.campaignKind) === 'non_powerlink');
		expect(kwAnyNonPowerlink).toBe(true);
	});

	it('메뉴 이동(언마운트/리마운트) 시 쇼핑검색 searchword 자동수집이 반복 호출되지 않는다(쿨다운)', async () => {
		const { fetchAdsAvailability } = await import('./adsApi');
		(fetchAdsAvailability as any).mockResolvedValue({ missingDates: ['2026-01-01'] });

		const first = render(
			<MemoryRouter>
				<SearchwordPerformanceView apiBaseUrl="http://example.test" />
			</MemoryRouter>,
		);

		await waitFor(() => expect((axios as any).post).toHaveBeenCalled());
		const calledOnce = ((axios as any).post as any).mock.calls.length;
		expect(calledOnce).toBe(1);

		first.unmount();

		render(
			<MemoryRouter>
				<SearchwordPerformanceView apiBaseUrl="http://example.test" />
			</MemoryRouter>,
		);

		// effect가 한 번 돌아갈 시간을 준 뒤에도 collect가 추가 호출되지 않아야 한다.
		await waitFor(() => {
			const n = ((axios as any).post as any).mock.calls.length;
			expect(n).toBe(1);
		});
	});
});

