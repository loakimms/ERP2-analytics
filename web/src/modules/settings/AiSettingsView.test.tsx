import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AiSettingsView } from './AiSettingsView';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();

vi.mock('axios', () => {
	return {
		default: {
			get: (...args: any[]) => mockGet(...args),
			put: (...args: any[]) => mockPut(...args),
			post: (...args: any[]) => mockPost(...args),
			isAxiosError: () => false,
		},
	};
});

describe('AiSettingsView', () => {
	beforeEach(() => {
		mockGet.mockReset();
		mockPut.mockReset();
		mockPost.mockReset();
	});

	it('최근 로그로 복구 버튼이 restore API를 호출하고, 이후 settings를 다시 불러온다', async () => {
		mockGet.mockResolvedValueOnce({ data: { format_version: 'v2', common_rules: '', rule_packs: [] } });
		mockPost.mockResolvedValueOnce({
			data: { ok: true, restored: true, source: 'ai_decision_log', current_common_len: 4, current_rules_count: 1 },
		});
		mockGet.mockResolvedValueOnce({
			data: {
				format_version: 'v2',
				common_rules: '복구된 공통',
				rule_packs: [{ id: 'A-1', enabled: true, title: 't', a1: { thresholds: { stable: { avg_rank_14d_max: 3.0 } }, prompt_templates: { inputs_json: '{}', outputs_template: 'out' } } }],
			},
		});

		render(<AiSettingsView apiBaseUrl="http://example.test" />);

		await waitFor(() => expect(mockGet).toHaveBeenCalledWith('http://example.test/settings/ai'));

		const btn = await screen.findByRole('button', { name: '최근 로그로 복구' });
		fireEvent.click(btn);

		await waitFor(() => expect(mockPost).toHaveBeenCalledWith('http://example.test/settings/ai/restore-latest'));
		await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

		expect(screen.getByText(/복구 완료/)).toBeTruthy();
	});

	it('백업 목록 버튼이 backups API를 호출한다', async () => {
		mockGet.mockResolvedValueOnce({ data: { format_version: 'v2', common_rules: '', rule_packs: [] } });
		mockGet.mockResolvedValueOnce({ data: { ok: true, items: [{ key: 'ai:settings:backup:x', updated_at: 't', len: 10 }] } });

		render(<AiSettingsView apiBaseUrl="http://example.test" />);
		await waitFor(() => expect(mockGet).toHaveBeenCalledWith('http://example.test/settings/ai'));

		const btn = await screen.findByRole('button', { name: '백업 목록' });
		fireEvent.click(btn);

		await waitFor(() =>
			expect(mockGet).toHaveBeenCalledWith('http://example.test/settings/ai/backups', { params: { limit: 30 } }),
		);
		expect(screen.getByText('AI 세팅 백업 스냅샷')).toBeTruthy();
	});

	it('AI Ops 정책 기준 탭에서 임계값을 수정하고 저장할 수 있다', async () => {
		mockGet.mockResolvedValueOnce({ data: { format_version: 'v2', common_rules: '', rule_packs: [] } });
		mockPut.mockResolvedValueOnce({ data: { ok: true } });

		render(<AiSettingsView apiBaseUrl="http://example.test" />);
		await waitFor(() => expect(mockGet).toHaveBeenCalledWith('http://example.test/settings/ai'));

		fireEvent.click(await screen.findByRole('button', { name: 'AI Ops 정책 기준' }));
		fireEvent.change(screen.getByLabelText('ai_ops.qna_barrier_high'), { target: { value: '92' } });
		fireEvent.click(screen.getByRole('button', { name: '저장' }));

		await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
		const savedPayload = mockPut.mock.calls[0]![1];
		const aiOpsPack = (savedPayload?.rule_packs || []).find((pack: any) => String(pack?.id) === 'AI_OPS');

		expect(aiOpsPack).toBeTruthy();
		expect(aiOpsPack.ai_ops.thresholds.qna_barrier_high).toBe(92);
	});

	it('브랜드별 AI Ops 정책팩을 추가하고 mall_name 스코프와 함께 저장할 수 있다', async () => {
		mockGet.mockResolvedValueOnce({ data: { format_version: 'v2', common_rules: '', rule_packs: [] } });
		mockPut.mockResolvedValueOnce({ data: { ok: true } });

		render(<AiSettingsView apiBaseUrl="http://example.test" />);
		await waitFor(() => expect(mockGet).toHaveBeenCalledWith('http://example.test/settings/ai'));

		fireEvent.click(await screen.findByRole('button', { name: 'AI Ops 정책 기준' }));
		fireEvent.click(screen.getByRole('button', { name: '정책팩 추가' }));
		fireEvent.change(screen.getByLabelText('ai_ops.pack.AI_OPS_SCOPE_2.scope.mall_names'), {
			target: { value: '브랜드A몰, 브랜드B몰' },
		});
		fireEvent.change(screen.getByLabelText('ai_ops.pack.AI_OPS_SCOPE_2.qna_barrier_high'), {
			target: { value: '95' },
		});
		fireEvent.click(screen.getByRole('button', { name: '저장' }));

		await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1));
		const savedPayload = mockPut.mock.calls[0]![1];
		const scopedPack = (savedPayload?.rule_packs || []).find((pack: any) => String(pack?.id) === 'AI_OPS_SCOPE_2');

		expect(scopedPack).toBeTruthy();
		expect(scopedPack.ai_ops.scope.mall_names).toEqual(['브랜드A몰', '브랜드B몰']);
		expect(scopedPack.ai_ops.thresholds.qna_barrier_high).toBe(95);
	});
});

