import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	registerQnaManagementTestLifecycle,
	renderQnaManagementView,
} from './QnaManagementView.testUtils';
import axios from 'axios';
import { QnaManagementView } from './QnaManagementView';

describe('QnaManagementView regenerate/approval', () => {
	registerQnaManagementTestLifecycle();

	it('검토대기와 반려 초안을 일괄 재생성한다', async () => {
		const axiosAny = axios as any;
		const workbenchPayload = {
			ok: true,
			qna_kind: 'all',
			response_state: 'all',
			dashboard: {
				total_items: 3,
				unanswered_count: 0,
				generated_count: 1,
				approved_count: 0,
				submitted_count: 0,
				failed_submit_count: 0,
				customer_count: 2,
				product_count: 1,
				last_collected_at: '2026-04-04T12:00:00+09:00',
			},
			items: [
				{
					qna_key: 'customer:301',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '301',
					title: '배송 재확인',
					category: '배송',
					inquiry_text: '배송 언제 오나요?',
					answered: false,
					product_name: '테스트 샴푸',
					customer_name: '홍길동',
					draft_id: 'draft-301',
					draft_status: 'generated',
					draft_text: '기존 초안 1',
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
				{
					qna_key: 'product:302',
					qna_kind: 'product',
					qna_kind_label: '상품 문의',
					external_inquiry_id: '302',
					title: '성분 문의',
					category: '상품',
					inquiry_text: '민감성도 써도 되나요?',
					answered: false,
					product_name: '테스트 오일',
					customer_name: null,
					draft_id: 'draft-302',
					draft_status: 'rejected',
					draft_text: '기존 초안 2',
					model_name: 'gpt-4o-mini',
					last_submit_success: null,
					last_submit_status_code: null,
					last_submit_error: null,
					last_submit_at: null,
					can_generate: false,
					can_approve: false,
					can_reject: true,
					can_submit: false,
				},
				{
					qna_key: 'customer:303',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '303',
					title: '기존 등록 문의',
					category: '교환',
					inquiry_text: '이미 등록된 문의',
					answered: true,
					product_name: '테스트 샴푸',
					customer_name: '임꺽정',
					draft_id: 'draft-303',
					draft_status: 'submitted',
					draft_text: '등록된 답변',
					model_name: 'gpt-4o-mini',
					last_submit_success: true,
					last_submit_status_code: 200,
					last_submit_error: null,
					last_submit_at: '2026-04-04T13:00:00+09:00',
					can_generate: false,
					can_approve: false,
					can_reject: false,
					can_submit: false,
				},
			],
		};
		(axiosAny.get as any).mockResolvedValue({ data: workbenchPayload });
		(axiosAny.post as any).mockResolvedValue({
			data: {
				draft_text: '재생성 초안',
			},
		});

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('배송 재확인')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '검토대기/반려 초안 재생성' }));

		await waitFor(() => {
			const regenerateCalls = (axiosAny.post as any).mock.calls.filter(
				(call: any[]) => call[0] === 'http://localhost:5189/qna/drafts/generate',
			);
			expect(regenerateCalls).toHaveLength(2);
			expect(regenerateCalls[0]?.[1]).toEqual({
				qna_key: 'customer:301',
				model: 'gpt-4o-mini',
				force_regenerate: true,
			});
			expect(regenerateCalls[1]?.[1]).toEqual({
				qna_key: 'product:302',
				model: 'gpt-4o-mini',
				force_regenerate: true,
			});
		});

		expect(await screen.findByText('검토대기/반려 초안 재생성 완료: 2건')).toBeTruthy();
	});

	it('초안 자동 검증 결과를 화면에 표시한다', async () => {
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
					qna_key: 'customer:401',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '401',
					title: '배송 일정 검증',
					category: '배송',
					inquiry_text: '배송 일정이 궁금합니다.',
					answered: false,
					product_name: '테스트 샴푸',
					customer_name: '홍길동',
					draft_id: 'draft-401',
					draft_status: 'generated',
					draft_text: '안녕하세요 고객님, 주문 정보를 확인한 뒤 배송 일정을 다시 안내드리겠습니다.',
					model_name: 'gpt-4o-mini',
					validation_result: {
						status: 'rewritten_passed',
						initial_issues: ['근거 없는 확정 표현을 쓰지 마세요.'],
						final_issues: [],
						rewrite_attempted: true,
						rewrite_succeeded: true,
					},
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
		(axiosAny.post as any).mockResolvedValue({ data: {} });

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('배송 일정 검증')).toBeTruthy();
		expect(screen.getByText('자동 교정 후 통과')).toBeTruthy();
		expect(screen.getByText(/초기 이슈 근거 없는 확정 표현을 쓰지 마세요\./)).toBeTruthy();
	});

	it('수정된 초안을 저장 후 재검증한다', async () => {
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
					qna_key: 'customer:501',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '501',
					title: '재검증 테스트',
					category: '배송',
					inquiry_text: '배송 일정 문의',
					answered: false,
					product_name: '테스트 샴푸',
					customer_name: '홍길동',
					draft_id: 'draft-501',
					draft_status: 'generated',
					draft_text: '기존 초안입니다.',
					model_name: 'gpt-4o-mini',
					validation_result: {
						status: 'needs_recheck',
						initial_issues: [],
						final_issues: [],
						rewrite_attempted: false,
						rewrite_succeeded: false,
					},
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
				ok: true,
				draft_id: 'draft-501',
				qna_key: 'customer:501',
				validation_result: {
					status: 'passed',
					initial_issues: [],
					final_issues: [],
					rewrite_attempted: false,
					rewrite_succeeded: false,
				},
			},
		});

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('재검증 테스트')).toBeTruthy();
		await changeWithAct(screen.getByLabelText('draft-editor-customer:501'), {
			target: { value: '수정된 초안입니다.' },
		});
		await clickWithAct(screen.getByLabelText('draft-validate-customer:501'));

		await waitFor(() => {
			expect(axiosAny.post).toHaveBeenCalledWith(
				'http://localhost:5189/qna/drafts/update',
				{ draft_id: 'draft-501', draft_text: '수정된 초안입니다.' },
				{ headers: { Authorization: 'Bearer test-token' } },
			);
			expect(axiosAny.post).toHaveBeenCalledWith(
				'http://localhost:5189/qna/drafts/validate',
				{ draft_id: 'draft-501' },
				{ headers: { Authorization: 'Bearer test-token' } },
			);
		});
	});

	it('검증 실패 또는 재검증 필요 상태에서는 승인 버튼을 비활성화한다', async () => {
		const axiosAny = axios as any;
		const workbenchPayload = {
			ok: true,
			qna_kind: 'all',
			response_state: 'all',
			dashboard: {
				total_items: 2,
				unanswered_count: 0,
				generated_count: 2,
				approved_count: 0,
				submitted_count: 0,
				failed_submit_count: 0,
				customer_count: 2,
				product_count: 0,
				last_collected_at: '2026-04-04T12:00:00+09:00',
			},
			items: [
				{
					qna_key: 'customer:601',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '601',
					title: '승인 차단 테스트1',
					category: '배송',
					inquiry_text: '배송 일정 문의',
					answered: false,
					product_name: '테스트 샴푸',
					customer_name: '홍길동',
					draft_id: 'draft-601',
					draft_status: 'generated',
					draft_text: '초안 1',
					model_name: 'gpt-4o-mini',
					validation_result: {
						status: 'failed',
						initial_issues: [],
						final_issues: ['근거 없는 확정 표현을 수정하세요.'],
						rewrite_attempted: false,
						rewrite_succeeded: false,
					},
					last_submit_success: null,
					last_submit_status_code: null,
					last_submit_error: null,
					last_submit_at: null,
					can_generate: false,
					can_approve: true,
					can_reject: true,
					can_submit: false,
				},
				{
					qna_key: 'customer:602',
					qna_kind: 'customer',
					qna_kind_label: '고객 문의',
					external_inquiry_id: '602',
					title: '승인 차단 테스트2',
					category: '배송',
					inquiry_text: '배송 일정 문의',
					answered: false,
					product_name: '테스트 샴푸',
					customer_name: '임꺽정',
					draft_id: 'draft-602',
					draft_status: 'generated',
					draft_text: '초안 2',
					model_name: 'gpt-4o-mini',
					validation_result: {
						status: 'needs_recheck',
						initial_issues: [],
						final_issues: [],
						rewrite_attempted: false,
						rewrite_succeeded: false,
					},
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
		(axiosAny.post as any).mockResolvedValue({ data: {} });

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('승인 차단 테스트1')).toBeTruthy();
		expect(screen.getByLabelText('draft-approve-customer:601')).toBeDisabled();
		expect(screen.getByLabelText('draft-approve-customer:602')).toBeDisabled();
		expect(screen.getByText('승인 불가: 남은 이슈 1건')).toBeTruthy();
		expect(screen.getByText('승인 불가: 재검증 필요')).toBeTruthy();
	});
});
