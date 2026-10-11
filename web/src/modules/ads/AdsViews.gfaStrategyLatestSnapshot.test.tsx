import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GfaStrategyView } from './AdsViews';
import {
	fetchGfaStrategyAnalysis,
	getLatestGfaStrategySnapshot,
	type GfaStrategyAnalysis,
	type GfaStrategyLatestSnapshot,
} from './adsApi';

vi.mock('./adsApi', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./adsApi')>();
	return {
		...actual,
		getLatestGfaStrategySnapshot: vi.fn(),
		fetchGfaStrategyAnalysis: vi.fn(),
	};
});

const getLatest = getLatestGfaStrategySnapshot as unknown as ReturnType<typeof vi.fn>;
const analyze = fetchGfaStrategyAnalysis as unknown as ReturnType<typeof vi.fn>;

function publishedSnapshot(): GfaStrategyLatestSnapshot {
	return {
		ok: true,
		snapshot_id: 'snap-2026-09-18',
		status: 'PUBLISHED',
		as_of_date: '2026-09-18',
		period: { start: '2024-01-01', end: '2026-09-18' },
		published_at: '2026-09-19T06:31:00+09:00',
		payload: {
			ok: true,
			date_from: '2024-01-01',
			date_to: '2026-09-18',
			executive_summary: ['저장된 전략 핵심 결론'],
			goal_matrix: [],
			operation_blueprints: [],
			creative_blueprints: [],
			condition_hierarchy: { campaigns: [], adgroups: [], creatives: [] },
			operation_compare_rows: [],
			creative_compare_rows: [],
			action_rows: [],
			creative_factor_analysis: { meta_coverage: { total_creatives: 3 } },
		},
	};
}

function renderView() {
	return render(
		<MemoryRouter>
			<GfaStrategyView apiBaseUrl="http://example.test" />
		</MemoryRouter>,
	);
}

describe('GfaStrategyView latest snapshot read', () => {
	beforeEach(() => {
		getLatest.mockReset();
		analyze.mockReset();
		try {
			localStorage.removeItem('ads.dateState.v1');
		} catch {
			// ignore
		}
	});

	it('메뉴 진입 로딩은 분석 중이 아니라 저장 결과 조회로 표시한다', async () => {
		let resolveLatest: (value: GfaStrategyLatestSnapshot) => void = () => undefined;
		getLatest.mockReturnValue(new Promise<GfaStrategyLatestSnapshot>((resolve) => {
			resolveLatest = resolve;
		}));
		renderView();
		expect(await screen.findByTestId('gfa-strategy-loading')).toBeTruthy();
		expect(screen.getByText('저장된 전략 결과를 불러오는 중입니다.')).toBeTruthy();
		expect(screen.queryByText('분석 중...')).toBeNull();
		expect(analyze).not.toHaveBeenCalled();
		resolveLatest(publishedSnapshot());
		expect(await screen.findByTestId('gfa-strategy-snapshot-meta')).toBeTruthy();
	});

	it('메뉴 진입 시 latest snapshot만 읽고 analyze는 호출하지 않는다', async () => {
		getLatest.mockResolvedValue(publishedSnapshot());
		renderView();

		expect(await screen.findByTestId('gfa-strategy-snapshot-meta')).toBeTruthy();
		await waitFor(() => expect(screen.getByTestId('gfa-strategy-view').getAttribute('data-load-state')).toBe('LOADED'));
		expect(screen.getByText('● 저장된 전략')).toBeTruthy();
		expect(screen.getByText('데이터 기준 2024.01.01 ~ 2026.09.18')).toBeTruthy();
		expect(screen.getByText('데이터 기준일 2026.09.18')).toBeTruthy();
		expect(screen.getByText(/저장된 전략 핵심 결론/)).toBeTruthy();
		expect(screen.queryByText('수동 분석 결과')).toBeNull();
		expect(getLatest).toHaveBeenCalledTimes(1);
		expect(analyze).not.toHaveBeenCalled();
	});

	it('latest snapshot 없음이면 EMPTY를 보여주고 analyze로 넘어가지 않는다', async () => {
		getLatest.mockRejectedValue({
			isAxiosError: true,
			response: { status: 404, data: { detail: 'NO_PUBLISHED_STRATEGY_SNAPSHOT' } },
		});
		renderView();

		expect(await screen.findByTestId('gfa-strategy-empty')).toBeTruthy();
		expect(screen.getByText('저장된 전략 결과가 없습니다.')).toBeTruthy();
		expect(screen.getByText('관리자 분석 또는 일일 배치 실행이 필요합니다.')).toBeTruthy();
		expect(screen.getByTestId('gfa-strategy-view').getAttribute('data-load-state')).toBe('EMPTY');
		expect(analyze).not.toHaveBeenCalled();
	});

	it('latest snapshot 오류면 ERROR를 보여주고 analyze로 넘어가지 않는다', async () => {
		getLatest.mockRejectedValue(new Error('network down'));
		renderView();

		expect(await screen.findByTestId('gfa-strategy-error')).toBeTruthy();
		expect(screen.getByText('전략 결과를 불러오지 못했습니다.')).toBeTruthy();
		expect(screen.getByTestId('gfa-strategy-view').getAttribute('data-load-state')).toBe('ERROR');
		expect(analyze).not.toHaveBeenCalled();
	});

	it('전략 분석 실행을 눌렀을 때만 /analyze를 호출하고 수동 분석 결과로 구분한다', async () => {
		getLatest.mockResolvedValue(publishedSnapshot());
		const manual: GfaStrategyAnalysis = {
			ok: true,
			date_from: '2026-09-01',
			date_to: '2026-09-10',
			executive_summary: ['수동 분석 핵심 결론'],
		};
		analyze.mockResolvedValue(manual);
		renderView();
		await screen.findByTestId('gfa-strategy-snapshot-meta');

		fireEvent.click(screen.getByRole('button', { name: '전략 분석 실행' }));
		expect(await screen.findByTestId('gfa-strategy-manual-meta')).toBeTruthy();
		expect(screen.getByText('수동 분석 결과')).toBeTruthy();
		expect(screen.getByText(/수동 분석 핵심 결론/)).toBeTruthy();
		expect(screen.queryByText('● 저장된 전략')).toBeNull();
		expect(analyze).toHaveBeenCalledTimes(1);
		expect(analyze.mock.calls[0]?.[0]).toMatchObject({
			baseUrl: 'http://example.test',
			forceRefresh: true,
		});
		expect(getLatest).toHaveBeenCalledTimes(1);
	});
});
