import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
	changeWithAct,
	clickWithAct,
	makeJwt,
	mockedAxios,
	registerReviewAnalysisTestLifecycle,
	renderReviewAnalysisView,
	useMaybeAuthMock,
} from './ReviewAnalysisView.testUtils';

describe('ReviewAnalysisView rejection flow', () => {
	registerReviewAnalysisTestLifecycle();

	it('반려건은 AI 분석을 보여주고 반려 반영 재작성을 실행할 수 있다', async () => {
		const axiosAny = mockedAxios;
		const rewriteRequests: Array<any> = [];

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/rewrite-from-rejection')) {
				rewriteRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						review_key: 'naver_review:rejected',
						draft_id: 'draft-rewritten',
						status: 'generated',
						draft_text: '불편을 드려 죄송합니다. 남겨주신 내용을 바탕으로 바로 확인하겠습니다.',
						model_name: 'gpt-4o-mini',
						generated_now: true,
						rejection_comment: '감사 표현만 있고 사과가 빠져 있습니다.',
						rejection_problem_summary: '불만 리뷰에 공감/사과가 빠지는 패턴',
						style_level: 3,
						style_preset_name: '균형형',
						style_controls: {},
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({ data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }] });
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({ data: { ok: true, product_url: null, corpus_examples: 0, recommended_fields: [], presets: [] } });
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 0, draft_pending_count: 0, approved_count: 0, rejected_count: 1 },
						items: [
							{
								review_key: 'naver_review:rejected',
								product_url: 'https://smartstore.naver.com/testmall/products/1001',
								product_title: '헤나 염색 샴푸',
								review_written_at: '2026-03-30',
								rating: 2,
								option_text: '브라운',
								review_text: '배송이 늦고 응답이 아쉬웠습니다.',
								reviewer_masked_id: 'sad****',
								reply_status: 'rejected',
								reply_status_label: '반려',
								draft_id: 'draft-rejected',
								draft_status: 'rejected',
								draft_text: '안녕하세요 고객님. 구매 감사합니다.',
								can_copy: false,
								rejection_comment: '감사 표현만 있고 사과가 빠져 있습니다.',
								rejection_problem_summary: '불만 리뷰에 공감/사과가 빠지는 패턴',
								rejection_analysis: {
									must_avoid: ['감사만 반복'],
									rewrite_guidance: ['첫 문장에 사과', '확인 의지 포함'],
								},
								can_rewrite_from_rejection: true,
								style_level: 3,
								style_preset_name: '균형형',
								style_controls: {},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByText('불만 리뷰에 공감/사과가 빠지는 패턴')).toBeTruthy();
		expect(screen.getByText('감사 표현만 있고 사과가 빠져 있습니다.')).toBeTruthy();
		await clickWithAct(screen.getByLabelText('draft-feedback-history-naver_review:rejected'));
		expect(await screen.findByRole('dialog', { name: '반려 피드백 이력' })).toBeTruthy();
		expect(screen.getByText('감사만 반복')).toBeTruthy();
		expect(screen.getByText('첫 문장에 사과')).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '닫기' }));
		await clickWithAct(screen.getByLabelText('draft-rewrite-from-rejection-naver_review:rejected'));
		expect(await screen.findByText('반려 사유를 반영해 초안을 새로 작성했습니다.')).toBeTruthy();
		expect(rewriteRequests[0]?.draft_id).toBe('draft-rejected');
	});

	it('검토대기 상태와 반려 이력을 분리 표시하고 반려 이력 필터를 API로 적용한다', async () => {
		const axiosAny = mockedAxios;
		const workbenchGetRequests: Array<any> = [];

		(axiosAny.post as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string, config?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({ data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }] });
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({ data: { ok: true, product_url: null, corpus_examples: 0, recommended_fields: [], presets: [] } });
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/workbench')) {
				workbenchGetRequests.push(config?.params || null);
				const historyOnly = Boolean(config?.params?.has_rejection_history_only);
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: {
							total_reviews: 2,
							new_reviews: 0,
							completed_count: 0,
							enrichment_target_count: 0,
							unreplied_count: 2,
							draft_pending_count: 2,
							approved_count: 0,
							rejected_count: 0,
							rejection_history_count: 1,
						},
						items: historyOnly
							? [
									{
										review_key: 'naver_review:history-pending',
										product_url: 'https://smartstore.naver.com/testmall/products/1001',
										product_title: '헤나 염색 샴푸',
										review_written_at: '2026-03-30',
										rating: 2,
										option_text: '브라운',
										review_text: '배송이 늦어 아쉬웠습니다.',
										reviewer_masked_id: 'sad****',
										reply_status: 'pending',
										reply_status_label: '검토대기',
										draft_id: 'draft-history-generated',
										draft_status: 'generated',
										draft_text: '불편을 드려 죄송합니다. 바로 확인하겠습니다.',
										can_copy: false,
										rejection_comment: '사과가 빠져 있습니다.',
										rejection_problem_summary: '불만 리뷰에 공감/사과가 빠지는 패턴',
										rejection_analysis: {},
										can_rewrite_from_rejection: false,
										has_rejection_history: true,
										rejection_history_count: 1,
										style_level: 3,
										style_preset_name: '균형형',
										style_controls: {},
									},
							  ]
							: [
									{
										review_key: 'naver_review:history-pending',
										product_url: 'https://smartstore.naver.com/testmall/products/1001',
										product_title: '헤나 염색 샴푸',
										review_written_at: '2026-03-30',
										rating: 2,
										option_text: '브라운',
										review_text: '배송이 늦어 아쉬웠습니다.',
										reviewer_masked_id: 'sad****',
										reply_status: 'pending',
										reply_status_label: '검토대기',
										draft_id: 'draft-history-generated',
										draft_status: 'generated',
										draft_text: '불편을 드려 죄송합니다. 바로 확인하겠습니다.',
										can_copy: false,
										rejection_comment: '사과가 빠져 있습니다.',
										rejection_problem_summary: '불만 리뷰에 공감/사과가 빠지는 패턴',
										rejection_analysis: {},
										can_rewrite_from_rejection: false,
										has_rejection_history: true,
										rejection_history_count: 1,
										style_level: 3,
										style_preset_name: '균형형',
										style_controls: {},
									},
									{
										review_key: 'naver_review:plain-pending',
										product_url: 'https://smartstore.naver.com/testmall/products/1001',
										product_title: '헤나 염색 샴푸',
										review_written_at: '2026-03-29',
										rating: 4,
										option_text: '기본',
										review_text: '향이 좋아서 만족합니다.',
										reviewer_masked_id: 'happy****',
										reply_status: 'pending',
										reply_status_label: '검토대기',
										draft_id: 'draft-plain-generated',
										draft_status: 'generated',
										draft_text: '소중한 리뷰 감사합니다.',
										can_copy: false,
										rejection_comment: null,
										rejection_problem_summary: null,
										rejection_analysis: {},
										can_rewrite_from_rejection: false,
										has_rejection_history: false,
										rejection_history_count: 0,
										style_level: 3,
										style_preset_name: '균형형',
										style_controls: {},
									},
							  ],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByText('반려 이력 있음 1건')).toBeTruthy();
		expect(screen.getAllByText('반려 이력 있음').length).toBeGreaterThan(0);
		expect(screen.getByText('향이 좋아서 만족합니다.')).toBeTruthy();

		await clickWithAct(screen.getByLabelText('반려 이력 필터'));

		await waitFor(() => {
			expect(workbenchGetRequests.at(-1)?.has_rejection_history_only).toBe(true);
		});
		expect(await screen.findByText('배송이 늦어 아쉬웠습니다.')).toBeTruthy();
		expect(screen.queryByText('향이 좋아서 만족합니다.')).toBeNull();
	});

	it('반려 이력 전용 표에서 커멘트를 수정하고 삭제할 수 있다', async () => {
		const axiosAny = mockedAxios;
		const updateRequests: Array<any> = [];
		const deleteRequests: Array<any> = [];
		let historyItems: Array<any> = [
			{
				draft_id: 'draft-history-only-1',
				review_key: 'naver_review:history-only-1',
				status: 'rejected',
				draft_text: '감사합니다.',
				generated_at: '2026-04-04T10:20:00+09:00',
				product_url: 'https://smartstore.naver.com/testmall/products/1001',
				review_written_at: '2026-04-04',
				review_text: '배송 지연이 아쉽습니다.',
				option_text: '기본',
				rating: 2,
				reviewer_masked_id: 'sad****',
				style_controls: {},
				rejection_comment: '사과가 빠져 있습니다.',
				rejection_problem_summary: '불만 리뷰에 공감/사과가 빠지는 패턴',
				rejection_analysis: { rewrite_guidance: ['첫 문장에 사과'] },
			},
		];
		let workbenchItems: Array<any> = [
			{
				review_key: 'naver_review:history-only-1',
				product_url: 'https://smartstore.naver.com/testmall/products/1001',
				product_title: '헤나 염색 샴푸',
				review_written_at: '2026-04-04',
				rating: 2,
				option_text: '기본',
				review_text: '배송 지연이 아쉽습니다.',
				reviewer_masked_id: 'sad****',
				reply_status: 'pending',
				reply_status_label: '검토대기',
				draft_id: 'draft-current-1',
				draft_status: 'generated',
				draft_text: '불편을 드려 죄송합니다.',
				can_copy: false,
				rejection_comment: '사과가 빠져 있습니다.',
				rejection_problem_summary: '불만 리뷰에 공감/사과가 빠지는 패턴',
				rejection_analysis: { rewrite_guidance: ['첫 문장에 사과'] },
				can_rewrite_from_rejection: false,
				has_rejection_history: true,
				rejection_history_count: 1,
				style_level: 3,
				style_preset_name: '균형형',
				style_controls: {},
			},
		];

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/rejection-comment/update')) {
				updateRequests.push(body);
				historyItems = historyItems.map((item) =>
					item.draft_id === body?.draft_id
						? { ...item, rejection_comment: body?.rejection_comment, rejection_analysis: { rewrite_guidance: ['첫 문장에 사과', '원인 확인 의지'] } }
						: item,
				);
				workbenchItems = workbenchItems.map((item) => ({ ...item, rejection_comment: body?.rejection_comment }));
				return Promise.resolve({ data: historyItems[0] });
			}
			if (u.includes('/reviews/reply-drafts/rejection-comment/delete')) {
				deleteRequests.push(body);
				historyItems = [];
				workbenchItems = workbenchItems.map((item) => ({ ...item, rejection_comment: null, rejection_problem_summary: null, rejection_analysis: {}, has_rejection_history: false, rejection_history_count: 0 }));
				return Promise.resolve({ data: { ok: true, draft_id: body?.draft_id || 'draft-history-only-1', review_key: 'naver_review:history-only-1' } });
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({ data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }] });
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({ data: { ok: true, product_url: null, corpus_examples: 0, recommended_fields: [], presets: [] } });
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', filtered_total: 0, pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 슈퍼관리자 일괄 단계 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/preview')) {
				return Promise.resolve({ data: { ok: true, filtered_total: 1, filter_summary: '현재 필터 기준 리뷰 1건', generate_count: 0, approve_count: 0, reject_count: 0, submit_count: 0, backfill_count: 0 } });
			}
			if (u.includes('/reviews/reply-drafts/rejection-history')) {
				return Promise.resolve({ data: historyItems });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-04-01',
						date_to: '2026-04-04',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 1, approved_count: 0, rejected_count: 0, rejection_history_count: historyItems.length },
						items: workbenchItems,
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByRole('table', { name: 'rejection-history-table' })).toBeTruthy();
		await changeWithAct(await screen.findByLabelText('rejection-history-comment-draft-history-only-1'), {
			target: { value: '사과와 원인 확인 안내가 필요합니다.' },
		});
		await clickWithAct(screen.getByLabelText('rejection-history-save-draft-history-only-1'));
		expect(await screen.findByText('반려 커멘트를 수정했습니다.')).toBeTruthy();
		expect(updateRequests[0]?.rejection_comment).toBe('사과와 원인 확인 안내가 필요합니다.');

		await clickWithAct(screen.getByLabelText('rejection-history-delete-draft-history-only-1'));
		expect(await screen.findByText('반려 커멘트를 삭제했습니다.')).toBeTruthy();
		expect(deleteRequests[0]?.draft_id).toBe('draft-history-only-1');
		expect(await screen.findByText('현재 조건에 맞는 반려 이력이 없습니다.')).toBeTruthy();
	});

	it('반려 사유 입력 후 저장+새로작성 버튼으로 GPT 재작성 요청을 보낸다', async () => {
		const axiosAny = mockedAxios;
		const statusRequests: Array<any> = [];
		const rewriteRequests: Array<any> = [];

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/status')) {
				statusRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: body?.draft_id || 'draft-generated',
						review_key: 'naver_review:newest',
						status: 'rejected',
						rejection_comment: body?.rejection_comment || null,
						rejection_problem_summary: '공감이 빠진 답글 패턴',
						rejection_analysis: { rewrite_guidance: ['공감 문장 먼저'] },
					},
				});
			}
			if (u.includes('/reviews/reply-drafts/rewrite-from-rejection')) {
				rewriteRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						review_key: 'naver_review:newest',
						draft_id: 'draft-rewritten-2',
						status: 'generated',
						draft_text: '불편을 드려 죄송합니다. 남겨주신 내용을 확인해 더 나은 답변을 드리겠습니다.',
						model_name: 'gpt-5.2',
						generated_now: true,
						rejection_comment: '공감이 없고 감사만 반복합니다.',
						rejection_problem_summary: '공감이 빠진 답글 패턴',
						style_level: 3,
						style_controls: {},
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({ data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }] });
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({ data: { ok: true, product_url: null, corpus_examples: 0, recommended_fields: [], presets: [] } });
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 1, approved_count: 0, rejected_count: 0 },
						items: [
							{
								review_key: 'naver_review:newest',
								product_url: 'https://smartstore.naver.com/testmall/products/1001',
								product_title: '헤나 염색 샴푸',
								review_written_at: '2026-03-31',
								rating: 2,
								option_text: '라벤더',
								review_text: '배송이 늦어서 아쉬웠습니다.',
								reviewer_masked_id: 'user****',
								reply_status: 'pending',
								reply_status_label: '검토대기',
								draft_id: 'draft-generated',
								draft_status: 'generated',
								draft_text: '안녕하세요 고객님. 구매 감사합니다.',
								can_copy: false,
								style_level: 3,
								style_preset_name: '균형형',
								style_controls: {},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		await clickWithAct(await screen.findByLabelText('draft-reject-naver_review:newest'));
		expect(await screen.findByRole('dialog', { name: '반려 사유 입력' })).toBeTruthy();
		const rejectionInput = screen.getByLabelText('반려 사유 입력값') as HTMLTextAreaElement;
		await waitFor(() => expect(document.activeElement).toBe(rejectionInput));
		fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog', { name: '반려 사유 입력' })).toBeNull());

		await clickWithAct(await screen.findByLabelText('draft-reject-naver_review:newest'));
		expect(await screen.findByRole('dialog', { name: '반려 사유 입력' })).toBeTruthy();
		await changeWithAct(screen.getByLabelText('반려 사유 입력값'), {
			target: { value: '공감이 없고 감사만 반복합니다.' },
		});
		await clickWithAct(screen.getByRole('button', { name: '저장+새로작성' }));
		expect(await screen.findByText('반려 사유를 저장하고 GPT가 새 초안을 작성했습니다.')).toBeTruthy();
		expect(statusRequests[0]?.draft_id).toBe('draft-generated');
		expect(statusRequests[0]?.rejection_comment).toBe('공감이 없고 감사만 반복합니다.');
		expect(rewriteRequests[0]?.draft_id).toBe('draft-generated');
	});

	it('반려 저장과 재작성은 초기 401 후 토큰 새로고침으로 재시도한다', async () => {
		const axiosAny = mockedAxios;
		let statusCalls = 0;
		let rewriteCalls = 0;
		const getIdToken = vi.fn(async () => makeJwt({ roles: ['ops_admin'] }));
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'ops-reject-1', email: 'ops@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken,
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/status')) {
				statusCalls += 1;
				if (statusCalls === 1) {
					return Promise.reject({ response: { status: 401, data: { detail: 'token_verification_failed:InvalidIdTokenError' } } });
				}
				return Promise.resolve({ data: { ok: true, draft_id: body?.draft_id || 'draft-generated', status: 'rejected' } });
			}
			if (u.includes('/reviews/reply-drafts/rewrite-from-rejection')) {
				rewriteCalls += 1;
				if (rewriteCalls === 1) {
					return Promise.reject({ response: { status: 401, data: { detail: 'token_verification_failed:InvalidIdTokenError' } } });
				}
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: 'draft-generated-2',
						review_key: body?.draft_id || 'draft-generated',
						status: 'generated',
						draft_text: '반려를 반영한 새 초안입니다.',
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({ data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }] });
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({ data: { ok: true, product_url: null, corpus_examples: 0, recommended_fields: [], presets: [] } });
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 1, approved_count: 0, rejected_count: 0 },
						items: [
							{
								review_key: 'naver_review:retry-case',
								product_url: 'https://smartstore.naver.com/testmall/products/1001',
								product_title: '헤나 염색 샴푸',
								review_written_at: '2026-03-31',
								rating: 2,
								option_text: '라벤더',
								review_text: '배송이 늦어서 아쉬웠습니다.',
								reviewer_masked_id: 'user****',
								reply_status: 'pending',
								reply_status_label: '검토대기',
								draft_id: 'draft-generated',
								draft_status: 'generated',
								draft_text: '안녕하세요 고객님. 구매 감사합니다.',
								can_copy: false,
								style_level: 3,
								style_preset_name: '균형형',
								style_controls: {},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		await clickWithAct(await screen.findByLabelText('draft-reject-naver_review:retry-case'));
		await changeWithAct(await screen.findByLabelText('반려 사유 입력값'), {
			target: { value: '공감이 빠져 있고 원인 설명도 없습니다.' },
		});
		await clickWithAct(screen.getByRole('button', { name: '저장+새로작성' }));

		expect(await screen.findByText('반려 사유를 저장하고 GPT가 새 초안을 작성했습니다.')).toBeTruthy();
		expect(statusCalls).toBe(2);
		expect(rewriteCalls).toBe(2);
		expect(
			getIdToken.mock.calls.some((args) =>
				Boolean(((args as Array<{ forceRefresh?: boolean } | undefined>)[0])?.forceRefresh),
			),
		).toBe(true);
		expect(screen.queryByText(/token_verification_failed/i)).toBeNull();
	});
});
