import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	clickWithAct,
	mockedAxios,
	navigateMock,
	registerAiOrganicRankA1ViewTestLifecycle,
	renderAiOrganicRankA1View,
} from './AiOrganicRankA1View.testUtils';
import { AiOrganicRankA1View } from './AiOrganicRankA1View';

describe('AiOrganicRankA1View summary/trace', () => {
	registerAiOrganicRankA1ViewTestLifecycle();

	it('메뉴 진입 시 자동으로 상품 요약을 로드하고, 상품 리스트는 가로 스크롤(overflow-x)을 열지 않는다', async () => {
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
						keyword_count: 1,
						decision_rollup: 'UNSTABLE',
						status_tier: 'RISK',
						status_prev_tier: 'STABLE',
						status_change: 'DOWN',
						band_counts: { top_1_3: 0, top_4_6: 0, top_7_10: 1, other_11_plus: 0, missing: 0, total: 1 },
						metrics_rollup: { best_rank_latest: 2, worst_rank_latest: 10, avg_rank_14d_mean: 6.2, keywords_computed: 1 },
						top_movers: [{ keyword: 'K1', rank_latest: 10, rank_change_7d: 3, decision: 'UNSTABLE' }],
					},
				],
			},
		});

		mockedAxios.get.mockResolvedValue({ data: { ok: true } });

		await renderAiOrganicRankA1View(<AiOrganicRankA1View apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getAllByText('테스트 상품').length).toBeGreaterThanOrEqual(1);
		});
		expect(mockedAxios.post).toHaveBeenCalled();

		const list = screen.getByTestId('a1-products-list') as HTMLElement;
		expect(list.style.overflowX).toBe('hidden');
	});

	it('상품 중심 흐름에서 GPT 제안 후 Trace로 이동한다', async () => {
		mockedAxios.post.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/analyze/organic-rank/a1/products')) {
				return Promise.resolve({
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
								band_counts_prev: { top_1_3: 1, top_4_6: 0, top_7_10: 0, other_11_plus: 1, missing: 0, total: 2 },
								metrics_rollup: { best_rank_latest: 2, worst_rank_latest: 10, avg_rank_14d_mean: 6.2, keywords_computed: 2 },
								top_movers: [{ keyword: 'K1', rank_latest: 10, rank_change_7d: 3, decision: 'UNSTABLE' }],
							},
						],
					},
				});
			}
			if (u.includes('/ai/analyze/organic-rank/a1/product/gpt')) {
				return Promise.resolve({
					data: {
						ok: true,
						analysis_type: 'A-1',
						days: 30,
						product_url: 'https://smartstore.naver.com/test/products/1',
						product_title: '테스트 상품',
						keyword_mode: 'topN',
						selected_keywords: ['K1'],
						decision: 'UNSTABLE',
						confidence: 0.7,
						recommended_actions: [{ title: '액션1', why: '이유', how: '방법', priority: 'P0', evidence_refs: ['node:RankRowsQuery'] }],
						analysis_markdown: '## 요약',
						trace_run_id: 'run-123',
						trace_sku_id: 'https://smartstore.naver.com/test/products/1',
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		mockedAxios.get.mockImplementation((url: string) => {
			if (String(url || '').includes('/ai/analyze/organic-rank/a1/product/detail')) {
				return Promise.resolve({
					data: {
						ok: true,
						analysis_type: 'A-1',
						days: 30,
						product_url: 'https://smartstore.naver.com/test/products/1',
						product_title: '테스트 상품',
						keyword_count: 2,
						keywords: [
							{ keyword: 'K1', decision: 'UNSTABLE', confidence: 0.6, metrics: { rank_latest: 10, rank_change_7d: 3, valid_days_14d: 14, down_days_7d: 2 } },
							{ keyword: 'K2', decision: 'STABLE', confidence: 0.8, metrics: { rank_latest: 2, rank_change_7d: 0, valid_days_14d: 14, down_days_7d: 0 } },
						],
						movers_up: [],
						movers_down: ['K1'],
						issues_persistent: ['K1'],
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOrganicRankA1View(<AiOrganicRankA1View apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getAllByText('테스트 상품').length).toBeGreaterThanOrEqual(1);
		});

		await clickWithAct(screen.getByRole('button', { name: '실행' }));

		await waitFor(() => {
			expect(screen.getByText('4) GPT 분석 내용(제안)')).toBeTruthy();
		});

		await clickWithAct(screen.getByRole('button', { name: '5) 제안 검증(Trace 열기)' }));
		await waitFor(() => expect(navigateMock).toHaveBeenCalled());
		expect(String(navigateMock.mock.calls?.[0]?.[0] || '')).toContain('/analytics/ai/organic-rank/trace?run_id=');
	});
});
