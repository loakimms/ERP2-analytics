import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderQnaManagementView, clickWithAct, registerQnaManagementTestLifecycle } from './QnaManagementView.testUtils';
import axios from 'axios';
import { QnaManagementView } from './QnaManagementView';

describe('QnaManagementView workbench/draft', () => {
	registerQnaManagementTestLifecycle();

	it('워크벤치 목록을 불러오고 단건 초안 생성을 호출한다', async () => {
		const axiosAny = axios as any;
		const workbenchPayload = {
			ok: true,
			qna_kind: 'all',
			response_state: 'all',
			dashboard: {
				total_items: 1,
				unanswered_count: 1,
				generated_count: 0,
				approved_count: 0,
				submitted_count: 0,
				failed_submit_count: 0,
				customer_count: 1,
				product_count: 0,
				last_collected_at: '2026-04-04T12:00:00+09:00',
			},
			items: [
				{
					qna_key: 'customer:101',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '101',
					title: '배송 문의',
					category: '배송',
					inquiry_text: '언제 도착하나요?',
					answered: false,
					product_name: '테스트 샴푸',
					customer_name: '홍길동',
					draft_id: null,
					draft_status: null,
					draft_text: null,
					last_submit_success: null,
					last_submit_status_code: null,
					last_submit_error: null,
					last_submit_at: null,
					can_generate: true,
					can_approve: false,
					can_reject: false,
					can_submit: false,
				},
			],
		};
		(axiosAny.get as any).mockResolvedValue({ data: workbenchPayload });
		(axiosAny.post as any).mockResolvedValue({
			data: {
				draft_text: '안녕하세요 고객님, 배송 일정 확인 후 안내드리겠습니다.',
			},
		});

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(axiosAny.get).toHaveBeenCalled();
		});
		expect(screen.getByText('조회 기간')).toBeTruthy();
		expect(axiosAny.get).toHaveBeenCalledWith(
			'http://localhost:5189/qna/workbench',
			expect.objectContaining({
				params: expect.objectContaining({
					from_date: expect.any(String),
					to_date: expect.any(String),
				}),
			}),
		);
		await waitFor(() => {
			expect(screen.queryByText('Q&A 목록을 불러오는 중...')).toBeNull();
		});
		expect(await screen.findByText('배송 문의')).toBeTruthy();
		expect(screen.getByText('Q&A 관리')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '문의 수집' }));

		await waitFor(() => {
			expect(axiosAny.post).toHaveBeenCalledWith(
				'http://localhost:5189/qna/sync',
				expect.objectContaining({
					start_date: expect.any(String),
					end_date: expect.any(String),
				}),
				{ headers: { Authorization: 'Bearer test-token' } },
			);
		});
		const workbenchRequest = (axiosAny.get as any).mock.calls[0]?.[1];
		const syncRequest = (axiosAny.post as any).mock.calls[0]?.[1];
		expect(syncRequest?.start_date).toBe(workbenchRequest?.params?.from_date);
		expect(syncRequest?.end_date).toBe(workbenchRequest?.params?.to_date);

		await clickWithAct(await screen.findByLabelText('draft-generate-customer:101'));

		await waitFor(() => {
			expect(axiosAny.post).toHaveBeenCalledWith(
				'http://localhost:5189/qna/drafts/generate',
				{ qna_key: 'customer:101', model: 'gpt-4o-mini' },
				{ headers: { Authorization: 'Bearer test-token' } },
			);
		});
	});

	it('기존 초안이 있으면 force regenerate로 새 초안을 생성한다', async () => {
		const axiosAny = axios as any;
		const workbenchPayload = {
			ok: true,
			qna_kind: 'all',
			response_state: 'all',
			dashboard: {
				total_items: 1,
				unanswered_count: 0,
				generated_count: 1,
				approved_count: 0,
				submitted_count: 0,
				failed_submit_count: 0,
				customer_count: 1,
				product_count: 0,
				last_collected_at: '2026-04-04T12:00:00+09:00',
			},
			items: [
				{
					qna_key: 'customer:202',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '202',
					title: '배송 일정 재문의',
					category: '배송',
					inquiry_text: '초안 다시 만들어 주세요',
					answered: false,
					product_name: '테스트 샴푸',
					customer_name: '홍길동',
					draft_id: 'draft-202',
					draft_status: 'generated',
					draft_text: '기존 초안입니다.',
					model_name: 'gpt-4o-mini',
					last_submit_success: null,
					last_submit_status_code: null,
					last_submit_error: null,
					last_submit_at: null,
					can_generate: false,
					can_approve: true,
					can_reject: true,
					can_submit: false,
				},
			],
		};
		(axiosAny.get as any).mockResolvedValue({ data: workbenchPayload });
		(axiosAny.post as any).mockResolvedValue({
			data: {
				draft_text: '안녕하세요 고객님, 주문 정보를 확인한 뒤 배송 일정을 다시 안내드리겠습니다.',
			},
		});

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('배송 일정 재문의')).toBeTruthy();

		await clickWithAct(await screen.findByLabelText('draft-regenerate-customer:202'));

		await waitFor(() => {
			expect(axiosAny.post).toHaveBeenCalledWith(
				'http://localhost:5189/qna/drafts/generate',
				{ qna_key: 'customer:202', model: 'gpt-4o-mini', force_regenerate: true },
				{ headers: { Authorization: 'Bearer test-token' } },
			);
		});
	});
});
