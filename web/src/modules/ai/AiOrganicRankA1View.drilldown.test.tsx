import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import {
	clickWithAct,
	mockedAxios,
	registerAiOrganicRankA1ViewTestLifecycle,
	renderAiOrganicRankA1View,
} from './AiOrganicRankA1View.testUtils';
import { AiOrganicRankA1View } from './AiOrganicRankA1View';

describe('AiOrganicRankA1View drilldown', () => {
	registerAiOrganicRankA1ViewTestLifecycle();

	it('집중 관리 요청(하락 주도 키워드)에서 키워드 클릭 시 상세 패널로 드릴다운된다', async () => {
		mockedAxios.post.mockResolvedValueOnce({
			data: {
				ok: true,
				analysis_type: 'A-1',
				days: 30,
				rules_used: {},
				product_count: 1,
				products: [
					{
						product_url: 'https://smartstore.naver.com/test/products/1',
						product_title: '테스트 상품',
						keyword_count: 2,
						decision_rollup: 'UNSTABLE',
						status_tier: 'RISK',
						status_prev_tier: 'STABLE',
						status_change: 'DOWN',
						band_counts: { top_1_3: 0, top_4_6: 0, top_7_10: 1, other_11_plus: 1, missing: 0, total: 2 },
						metrics_rollup: { best_rank_latest: 2, worst_rank_latest: 10, avg_rank_14d_mean: 6.2, keywords_computed: 2 },
						top_movers: [{ keyword: 'K1', rank_latest: 10, rank_change_7d: 3, decision: 'UNSTABLE' }],
					},
				],
			},
		});

		mockedAxios.get.mockResolvedValueOnce({
			data: {
				ok: true,
				analysis_type: 'A-1',
				days: 30,
				product_url: 'https://smartstore.naver.com/test/products/1',
				product_title: '테스트 상품',
				keyword_count: 2,
				keywords: [
					{ keyword: 'K1', decision: 'UNSTABLE', confidence: 0.6, issue_score: 50, trend: 'DOWN', rank_series_14d: [{ date: '2026-03-01', rank: 10 }], metrics: { rank_latest: 10, rank_change_7d: 3, valid_days_14d: 14, down_days_7d: 2, search_volume_month: 1200 } },
					{ keyword: 'K2', decision: 'STABLE', confidence: 0.8, issue_score: 0, trend: 'FLAT', rank_series_14d: [{ date: '2026-03-01', rank: 2 }], metrics: { rank_latest: 2, rank_change_7d: 0, valid_days_14d: 14, down_days_7d: 0, search_volume_month: 800 } },
				],
				movers_up: [],
				movers_down: ['K1'],
				issues_persistent: ['K1'],
			},
		});

		await renderAiOrganicRankA1View(<AiOrganicRankA1View apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getAllByText('테스트 상품').length).toBeGreaterThanOrEqual(1);
		});
		await waitFor(() => {
			expect(screen.getByText('집중 관리 요청(상태 악화/위험 감지)')).toBeTruthy();
		});

		await clickWithAct(screen.getByRole('button', { name: 'focus-down-driver-K1' }));

		const preview = await screen.findByTestId('a1-keyword-preview');
		expect(within(preview).getByText('K1')).toBeTruthy();
	});
});
