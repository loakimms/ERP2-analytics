import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	clickWithAct,
	mockedAxios,
	registerAiOrganicRankA1TraceExplorerTestLifecycle,
	renderAiOrganicRankA1TraceExplorerView,
} from './AiOrganicRankA1TraceExplorerView.testUtils';
import { AiOrganicRankA1TraceExplorerView } from './AiOrganicRankA1TraceExplorerView';

describe('AiOrganicRankA1TraceExplorerView tree/actions', () => {
	registerAiOrganicRankA1TraceExplorerTestLifecycle();

	it('Run 조회 → SKU 조회 → trace(export) 조회 흐름으로 트리를 렌더링한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/a1/runs')) {
				return Promise.resolve({
					data: { ok: true, items: [{ run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated', status: 'SUCCESS' }] },
				});
			}
			if (u.includes('/ai/a1/trace/skus')) {
				return Promise.resolve({ data: { ok: true, run_id: 'run-1', skus: ['SKU-1'] } });
			}
			if (u.includes('/ai/a1/trace/export')) {
				return Promise.resolve({
					data: {
						ok: true,
						run: { run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated' },
						sku_id: 'SKU-1',
						nodes: [
							{ node_id: 'n1', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'FinalRecommendation', title: '최종 제안', sort_key: 10, tags_json: '{"alias":"FinalRecommendation"}' },
							{ node_id: 'n2', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'AutomationResult', title: '자동화 결과(상태/이벤트/근거)', sort_key: 40, tags_json: '{"alias":"AutomationResult"}' },
						],
						edges: [{ from_node_id: 'n1', to_node_id: 'n2', edge_type: 'uses', label: '입력' }],
						blobs: [],
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOrganicRankA1TraceExplorerView(<AiOrganicRankA1TraceExplorerView apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getByText('최종 제안')).toBeTruthy();
		});
		expect(screen.getByText('자동화 결과(상태/이벤트/근거)')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: /최종 제안/ }));
		expect(screen.getByText('노드 상세')).toBeTruthy();
	});

	it('추천 액션의 왜? 버튼이 근거 하이라이트를 트리에서 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/a1/runs')) {
				return Promise.resolve({
					data: { ok: true, items: [{ run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated', status: 'SUCCESS' }] },
				});
			}
			if (u.includes('/ai/a1/trace/skus')) {
				return Promise.resolve({ data: { ok: true, run_id: 'run-1', skus: ['SKU-1'] } });
			}
			if (u.includes('/ai/a1/trace/export')) {
				return Promise.resolve({
					data: {
						ok: true,
						run: { run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated' },
						sku_id: 'SKU-1',
						nodes: [
							{ node_id: 'n1', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'GptOutput', title: 'GPT 결과(JSON)', sort_key: 20, tags_json: '{"alias":"GptOutput"}', blob_id: 'b1' },
							{ node_id: 'n2', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'AutomationResult', title: '자동화 결과(상태/이벤트/근거)', sort_key: 40, tags_json: '{"alias":"AutomationResult"}' },
						],
						edges: [{ from_node_id: 'n1', to_node_id: 'n2', edge_type: 'uses', label: '자동화' }],
						blobs: [
							{
								blob_id: 'b1',
								content_type: 'json',
								content_hash: 'h',
								size: 1,
								content_text: JSON.stringify({
									recommended_actions: [{ title: '상품정보 점검', why: '노출', how: '점검', priority: 'P0', evidence_refs: ['node:AutomationResult'] }],
								}),
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOrganicRankA1TraceExplorerView(<AiOrganicRankA1TraceExplorerView apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getByText('GPT 결과(JSON)')).toBeTruthy();
		});
		await waitFor(() => {
			expect(screen.getByText(/상품정보\s*점검/)).toBeTruthy();
		});

		await clickWithAct(screen.getByRole('button', { name: '왜? (근거)' }));

		await waitFor(() => {
			expect(screen.getByText('자동화 결과(상태/이벤트/근거)')).toBeTruthy();
		});
	});

	it('결정론 액션(ActionHints)을 최종 요약에 노출하고 GPT 액션과 diff 라벨을 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/a1/runs')) {
				return Promise.resolve({
					data: { ok: true, items: [{ run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated', status: 'SUCCESS' }] },
				});
			}
			if (u.includes('/ai/a1/trace/skus')) {
				return Promise.resolve({ data: { ok: true, run_id: 'run-1', skus: ['SKU-1'] } });
			}
			if (u.includes('/ai/a1/trace/export')) {
				return Promise.resolve({
					data: {
						ok: true,
						run: { run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated' },
						sku_id: 'SKU-1',
						nodes: [
							{ node_id: 'n1', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'GptOutput', title: 'GPT 결과(JSON)', sort_key: 20, tags_json: '{"alias":"GptOutput"}', blob_id: 'b1' },
							{ node_id: 'n2', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'ActionHints', title: '결정론 액션 템플릿', sort_key: 59, tags_json: '{"alias":"ActionHints"}', blob_id: 'b2' },
							{ node_id: 'n3', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'AutomationResult', title: '자동화 결과(상태/이벤트/근거)', sort_key: 40, tags_json: '{"alias":"AutomationResult"}' },
						],
						edges: [
							{ from_node_id: 'n1', to_node_id: 'n3', edge_type: 'uses', label: '자동화' },
							{ from_node_id: 'n2', to_node_id: 'n3', edge_type: 'uses', label: '근거' },
						],
						blobs: [
							{
								blob_id: 'b1',
								content_type: 'json',
								content_hash: 'h1',
								size: 1,
								content_text: JSON.stringify({
									recommended_actions: [
										{ title: '상품정보 점검', why: '노출', how: '점검', priority: 'P0', evidence_refs: ['node:AutomationResult'] },
										{ title: 'AI 단독 액션', why: 'x', how: 'y', priority: 'P1', evidence_refs: ['node:AutomationResult'] },
									],
								}),
							},
							{
								blob_id: 'b2',
								content_type: 'json',
								content_hash: 'h2',
								size: 1,
								content_text: JSON.stringify([
									{ title: '상품정보 점검', why: '기본', how: '점검', priority: 'P1', evidence_refs: ['node:AutomationResult'] },
									{ title: '템플릿 단독 액션', why: '기준', how: '수정', priority: 'P0', evidence_refs: ['node:AutomationResult'] },
								]),
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOrganicRankA1TraceExplorerView(<AiOrganicRankA1TraceExplorerView apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getByText('GPT 결과(JSON)')).toBeTruthy();
		});
		await waitFor(() => {
			expect(screen.getByText(/결정론 액션\(템플릿\)/)).toBeTruthy();
		});
		expect(screen.getByText(/템플릿 단독 액션/)).toBeTruthy();
		await waitFor(() => {
			expect(screen.getAllByText(/\(충돌\)/).length).toBeGreaterThanOrEqual(1);
		});

		await clickWithAct(screen.getByRole('button', { name: /GPT 단독 액션 보기/ }));
		await waitFor(() => {
			expect(screen.getByText(/\(GPT 단독\)/)).toBeTruthy();
		});
	});
});
