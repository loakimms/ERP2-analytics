import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	mockedAxios,
	registerAiOrganicRankA1TraceExplorerTestLifecycle,
	renderAiOrganicRankA1TraceExplorerView,
} from './AiOrganicRankA1TraceExplorerView.testUtils';
import { AiOrganicRankA1TraceExplorerView } from './AiOrganicRankA1TraceExplorerView';

describe('AiOrganicRankA1TraceExplorerView save feedback', () => {
	registerAiOrganicRankA1TraceExplorerTestLifecycle();

	it('액션 수락/미수락 저장 시 저장 완료 메시지를 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/a1/runs')) {
				return Promise.resolve({ data: { ok: true, items: [{ run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated', status: 'SUCCESS' }] } });
			}
			if (u.includes('/ai/a1/trace/skus')) {
				return Promise.resolve({ data: { ok: true, run_id: 'run-1', skus: ['SKU-1'], labels: { 'SKU-1': '테스트 SKU' } } });
			}
			if (u.includes('/ai/a1/reviews/actions')) {
				return Promise.resolve({ data: { ok: true, run_id: 'run-1', sku_id: 'SKU-1', items: [] } });
			}
			if (u.includes('/ai/a1/trace/export')) {
				return Promise.resolve({
					data: {
						ok: true,
						run: { run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated' },
						sku_id: 'SKU-1',
						nodes: [{ node_id: 'n2', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'ActionHints', title: '결정론 액션 템플릿', sort_key: 10, tags_json: '{"alias":"ActionHints"}', blob_id: 'b2' }],
						edges: [],
						blobs: [
							{
								blob_id: 'b2',
								content_type: 'json',
								content_hash: 'h2',
								size: 1,
								content_text: JSON.stringify([{ title: '상품정보 점검', why: '기본', how: '점검', priority: 'P1', evidence_refs: [] }]),
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		mockedAxios.post.mockImplementation((url: string) => {
			if (String(url || '').includes('/ai/a1/reviews/actions')) return Promise.resolve({ data: { ok: true } });
			return Promise.resolve({ data: { ok: true } });
		});

		await renderAiOrganicRankA1TraceExplorerView(<AiOrganicRankA1TraceExplorerView apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getByText(/결정론 액션\(템플릿\)/)).toBeTruthy();
		});

		await clickWithAct(screen.getByRole('button', { name: '저장' }));

		await waitFor(() => {
			expect(screen.getByLabelText('save-feedback')).toBeTruthy();
		});
		expect(screen.getByLabelText('save-feedback').textContent || '').toMatch(/저장 완료/);
		expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();

		await changeWithAct(screen.getByPlaceholderText(/결정 이유\/추가 메모/), { target: { value: '변경' } });
		expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled();
	});

	it('액션 저장 실패 시 저장 실패 메시지를 표시한다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/a1/runs')) {
				return Promise.resolve({ data: { ok: true, items: [{ run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated', status: 'SUCCESS' }] } });
			}
			if (u.includes('/ai/a1/trace/skus')) {
				return Promise.resolve({ data: { ok: true, run_id: 'run-1', skus: ['SKU-1'] } });
			}
			if (u.includes('/ai/a1/reviews/actions')) {
				return Promise.resolve({ data: { ok: true, run_id: 'run-1', sku_id: 'SKU-1', items: [] } });
			}
			if (u.includes('/ai/a1/trace/export')) {
				return Promise.resolve({
					data: {
						ok: true,
						run: { run_id: 'run-1', run_date: '2026-01-25', surface: 'mobile_integrated' },
						sku_id: 'SKU-1',
						nodes: [{ node_id: 'n2', run_id: 'run-1', sku_id: 'SKU-1', node_type: 'ActionHints', title: '결정론 액션 템플릿', sort_key: 10, tags_json: '{"alias":"ActionHints"}', blob_id: 'b2' }],
						edges: [],
						blobs: [
							{
								blob_id: 'b2',
								content_type: 'json',
								content_hash: 'h2',
								size: 1,
								content_text: JSON.stringify([{ title: '상품정보 점검', why: '기본', how: '점검', priority: 'P1', evidence_refs: [] }]),
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true } });
		});

		mockedAxios.post.mockRejectedValue(new Error('boom'));

		await renderAiOrganicRankA1TraceExplorerView(<AiOrganicRankA1TraceExplorerView apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(screen.getByText(/결정론 액션\(템플릿\)/)).toBeTruthy();
		});

		await clickWithAct(screen.getByRole('button', { name: '저장' }));

		await waitFor(() => {
			expect(screen.getByText(/저장 실패/)).toBeTruthy();
		});
	});
});
