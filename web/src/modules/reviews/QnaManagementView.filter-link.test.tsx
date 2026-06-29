import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	registerQnaManagementTestLifecycle,
	renderQnaManagementView,
} from './QnaManagementView.testUtils';
import axios from 'axios';
import { QnaManagementView } from './QnaManagementView';

describe('QnaManagementView filter/link', () => {
	registerQnaManagementTestLifecycle();

	it('분석 화면에서 전달한 URL 필터를 초기 상태로 읽어 워크벤치를 조회한다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockResolvedValue({
			data: {
				ok: true,
				qna_kind: 'customer',
				response_state: 'all',
				dashboard: {
					total_items: 0,
					unanswered_count: 0,
					generated_count: 0,
					approved_count: 0,
					submitted_count: 0,
					failed_submit_count: 0,
					customer_count: 0,
					product_count: 0,
					last_collected_at: null,
				},
				items: [],
			},
		});

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />, {
			initialPath:
				'/analytics/reviews/qna?qna_kind=customer&search=%ED%85%8C%EC%8A%A4%ED%8A%B8%20%EC%83%B4%ED%91%B8&from_date=2026-04-01&to_date=2026-04-07',
		});

		await waitFor(() => {
			expect(axiosAny.get).toHaveBeenCalledWith(
				'http://localhost:5189/qna/workbench',
				expect.objectContaining({
					params: expect.objectContaining({
						qna_kind: 'customer',
						search: '테스트 샴푸',
						from_date: '2026-04-01',
						to_date: '2026-04-07',
					}),
				}),
			);
		});
	});

	it('분석 화면에서 전달한 issue_tag를 초기 상태로 읽어 워크벤치를 조회하고 해제할 수 있다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockResolvedValue({
			data: {
				ok: true,
				qna_kind: 'all',
				response_state: 'all',
				dashboard: {
					total_items: 0,
					unanswered_count: 0,
					generated_count: 0,
					approved_count: 0,
					submitted_count: 0,
					failed_submit_count: 0,
					customer_count: 0,
					product_count: 0,
					last_collected_at: null,
					issue_tag_counts: { 냄새: 1, 색상: 1 },
				},
				items: [],
			},
		});

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />, {
			initialPath: '/analytics/reviews/qna?issue_tag=%EB%83%84%EC%83%88&from_date=2026-04-01&to_date=2026-04-07',
		});

		await waitFor(() => {
			expect(axiosAny.get).toHaveBeenCalledWith(
				'http://localhost:5189/qna/workbench',
				expect.objectContaining({
					params: expect.objectContaining({
						issue_tag: '냄새',
						from_date: '2026-04-01',
						to_date: '2026-04-07',
					}),
				}),
			);
		});
		expect(screen.getByText('선택된 이슈 태그: 냄새')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '이슈 태그 필터 해제' }));

		await waitFor(() => {
			const calls = (axiosAny.get as any).mock.calls;
			const lastCall = calls[calls.length - 1];
			expect(lastCall?.[1]?.params?.issue_tag).toBeUndefined();
		});
	});

	it('Q&A 관리 화면은 이슈 태그 칩을 표시하고 다른 태그로 전환 조회할 수 있다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockResolvedValue({
			data: {
				ok: true,
				qna_kind: 'all',
				response_state: 'all',
				dashboard: {
					total_items: 2,
					unanswered_count: 2,
					generated_count: 0,
					approved_count: 0,
					submitted_count: 0,
					failed_submit_count: 0,
					customer_count: 1,
					product_count: 1,
					last_collected_at: null,
					issue_tag_counts: { 냄새: 1, 색상: 1 },
				},
				items: [
					{
						qna_key: 'product:701',
						qna_kind: 'product',
						qna_kind_label: '상품 문의',
						external_inquiry_id: '701',
						title: '냄새 문의',
						category: '불만',
						inquiry_text: '냄새가 너무 강합니다.',
						answered: false,
						product_name: '테스트 오일',
						masked_writer_id: 'abc***',
						issue_tags: ['냄새'],
						can_generate: true,
						can_approve: false,
						can_reject: false,
						can_submit: false,
					},
					{
						qna_key: 'product:702',
						qna_kind: 'product',
						qna_kind_label: '상품 문의',
						external_inquiry_id: '702',
						title: '색상 문의',
						category: '불만',
						inquiry_text: '색상이 사진과 다릅니다.',
						answered: false,
						product_name: '테스트 크림',
						masked_writer_id: 'def***',
						issue_tags: ['색상'],
						can_generate: true,
						can_approve: false,
						can_reject: false,
						can_submit: false,
					},
				],
			},
		});

		await renderQnaManagementView(<QnaManagementView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('냄새 문의')).toBeTruthy();
		expect(screen.getByText('색상 문의')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Q&A 이슈 태그 냄새 1건' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Q&A 이슈 태그 색상 1건' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: 'Q&A 이슈 태그 색상 1건' }));

		await waitFor(() => {
			const lastCall = (axiosAny.get as any).mock.calls.at(-1);
			expect(lastCall?.[1]?.params?.issue_tag).toBe('색상');
		});
	});

	it('현재 관리 컨텍스트를 Q&A 분석 화면으로 역방향 deep link 한다', async () => {
		const axiosAny = axios as any;
		const navigateSpy = vi.fn();
		(axiosAny.get as any).mockResolvedValue({
			data: {
				ok: true,
				qna_kind: 'all',
				response_state: 'all',
				dashboard: {
					total_items: 1,
					unanswered_count: 0,
					generated_count: 0,
					approved_count: 0,
					submitted_count: 0,
					failed_submit_count: 0,
					customer_count: 0,
					product_count: 1,
					last_collected_at: null,
					issue_tag_counts: { 냄새: 1 },
				},
				items: [
					{
						qna_key: 'product:801',
						qna_kind: 'product',
						qna_kind_label: '상품 문의',
						external_inquiry_id: '801',
						title: '냄새 문의',
						category: '불만',
						inquiry_text: '냄새가 강합니다.',
						answered: false,
						product_name: '테스트 오일',
						issue_tags: ['냄새'],
						can_generate: true,
						can_approve: false,
						can_reject: false,
						can_submit: false,
					},
				],
			},
		});

		await renderQnaManagementView(
			<QnaManagementView apiBaseUrl="http://localhost:5189" onNavigate={navigateSpy} />,
			{
				initialPath:
					'/analytics/reviews/qna?issue_tag=%EB%83%84%EC%83%88&from_date=2026-04-01&to_date=2026-04-07&search=%ED%85%8C%EC%8A%A4%ED%8A%B8',
			},
		);

		expect(await screen.findByText('냄새 문의')).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: 'Q&A 분석에서 보기' }));

		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('/analytics/reviews/qna-analysis?'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('issue_tag=%EB%83%84%EC%83%88'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('response_state=all'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('section=quality'));
	});
});
