import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
	clickWithAct,
	makeJwt,
	mockedAxios,
	registerReviewAnalysisTestLifecycle,
	renderReviewAnalysisView,
	useMaybeAuthMock,
} from './ReviewAnalysisView.testUtils';

describe('ReviewAnalysisView resilience', () => {
	registerReviewAnalysisTestLifecycle();

	it('슈퍼관리자 일괄 단계 미리보기는 초기 인증 오류 후 재시도해 숫자를 표시한다', async () => {
		const axiosAny = mockedAxios;
		let previewCalls = 0;
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'super-2', email: 'super@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['superadmin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string, config?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({
					data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }],
				});
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
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 0, draft_pending_count: 0, approved_count: 1, rejected_count: 0 },
						items: [
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			if (u.includes('/reviews/reply-bulk-stage/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', filtered_total: 0, pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 슈퍼관리자 일괄 단계 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/preview')) {
				previewCalls += 1;
				if (previewCalls === 1) {
					return Promise.reject({ response: { status: 401, data: { detail: 'token_verification_failed:InvalidIdTokenError' } } });
				}
				return Promise.resolve({
					data: {
						ok: true,
						filtered_total: 10,
						filter_summary: '현재 필터 기준 리뷰 10건',
						generate_count: 1,
						approve_count: 2,
						reject_count: 2,
						submit_count: 7,
						backfill_count: 3,
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByRole('button', { name: '슈퍼관리자 일괄 단계 승인 답글 자동 게시' })).toHaveTextContent('승인 답글 자동 게시 7건');
		expect(screen.getByRole('button', { name: '슈퍼관리자 일괄 단계 답글 본문 보강' })).toHaveTextContent('답글 본문 보강 3건');
		expect(previewCalls).toBe(2);
	});

	it('권한 보호 상태 조회는 초기 401 후 토큰 새로고침으로 재시도한다', async () => {
		const axiosAny = mockedAxios;
		let bulkSubmitStatusCalls = 0;
		let bulkStageStatusCalls = 0;
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'super-3', email: 'super@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['superadmin'] })),
		} as any);

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
				bulkSubmitStatusCalls += 1;
				if (bulkSubmitStatusCalls === 1) {
					return Promise.reject({ response: { status: 401, data: { detail: 'token_verification_failed:InvalidIdTokenError' } } });
				}
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/status')) {
				bulkStageStatusCalls += 1;
				if (bulkStageStatusCalls === 1) {
					return Promise.reject({ response: { status: 401, data: { detail: 'token_verification_failed:InvalidIdTokenError' } } });
				}
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', filtered_total: 0, pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 슈퍼관리자 일괄 단계 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/preview')) {
				return Promise.resolve({ data: { ok: true, filtered_total: 1, filter_summary: '현재 필터 기준 리뷰 1건', generate_count: 0, approve_count: 0, reject_count: 0, submit_count: 1, backfill_count: 0 } });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 0, draft_pending_count: 0, approved_count: 1, rejected_count: 0 },
						items: [
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		await screen.findByLabelText('superadmin-bulk-stage-panel');
		await waitFor(() => {
			expect(bulkSubmitStatusCalls).toBe(2);
			expect(bulkStageStatusCalls).toBe(2);
		});
		expect(screen.queryByText(/token_verification_failed/i)).toBeNull();
	});

	it('단건 자동 게시 성공 시 이전 오류 문구를 지운다', async () => {
		const axiosAny = mockedAxios;
		let submitCalls = 0;
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'ops-1', email: 'ops@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['ops_admin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/submit')) {
				submitCalls += 1;
				if (submitCalls === 1) {
					return Promise.reject({ response: { status: 404, data: { detail: 'seller_review_not_found' } } });
				}
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: body?.draft_id || 'draft-approved',
						review_key: 'naver_review:approved',
						status: 'completed',
						detail: '판매자센터에서 삭제되었거나 더 이상 노출되지 않는 리뷰로 확인되어 완료 처리했습니다.',
						reply_written_at: null,
					},
				});
			}
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
			if (u.includes('/reviews/reply-bulk-stage/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', filtered_total: 0, pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 슈퍼관리자 일괄 단계 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/preview')) {
				return Promise.resolve({ data: { ok: true, filtered_total: 1, filter_summary: '현재 필터 기준 리뷰 1건', generate_count: 0, approve_count: 0, reject_count: 0, submit_count: 1, backfill_count: 0 } });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 0, draft_pending_count: 0, approved_count: 1, rejected_count: 0 },
						items: [
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		const submitButton = await screen.findByLabelText('draft-submit-naver_review:approved');
		await clickWithAct(submitButton);
		expect(await screen.findByText('판매자센터에서 해당 리뷰글번호를 찾지 못했습니다.')).toBeTruthy();

		await clickWithAct(await screen.findByLabelText('draft-submit-naver_review:approved'));
		expect(await screen.findByText('자동 게시 완료: 판매자센터에서 삭제되었거나 더 이상 노출되지 않는 리뷰로 확인되어 완료 처리했습니다.')).toBeTruthy();
		expect(screen.queryByText('판매자센터에서 해당 리뷰글번호를 찾지 못했습니다.')).toBeNull();
	});

	it('단건 자동 게시는 초기 401 후 토큰 새로고침으로 재시도한다', async () => {
		const axiosAny = mockedAxios;
		let submitCalls = 0;
		const getIdToken = vi.fn(async () => makeJwt({ roles: ['ops_admin'] }));
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'ops-submit-401', email: 'ops@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken,
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/submit')) {
				submitCalls += 1;
				if (submitCalls === 1) {
					return Promise.reject({ response: { status: 401, data: { detail: 'token_verification_failed:InvalidIdTokenError' } } });
				}
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: body?.draft_id || 'draft-approved',
						review_key: 'naver_review:approved',
						status: 'completed',
						detail: '판매자센터에 답글을 등록했습니다.',
						reply_written_at: '2026-04-04',
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
			if (u.includes('/reviews/reply-bulk-stage/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', filtered_total: 0, pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 슈퍼관리자 일괄 단계 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/preview')) {
				return Promise.resolve({ data: { ok: true, filtered_total: 1, filter_summary: '현재 필터 기준 리뷰 1건', generate_count: 0, approve_count: 0, reject_count: 0, submit_count: 1, backfill_count: 0 } });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 0, draft_pending_count: 0, approved_count: 1, rejected_count: 0, rejection_history_count: 0 },
						items: [
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, has_rejection_history: false, rejection_history_count: 0, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		await clickWithAct(await screen.findByLabelText('draft-submit-naver_review:approved'));
		expect(await screen.findByText('자동 게시 완료: 판매자센터에 답글을 등록했습니다.')).toBeTruthy();
		expect(submitCalls).toBe(2);
		expect(
			getIdToken.mock.calls.some((args) =>
				Boolean(((args as Array<{ forceRefresh?: boolean } | undefined>)[0])?.forceRefresh),
			),
		).toBe(true);
		expect(screen.queryByText(/token_verification_failed/i)).toBeNull();
	});

	it('슈퍼관리자 일괄 단계 실행 실패도 raw validation detail 대신 정제된 문구를 보여준다', async () => {
		const axiosAny = mockedAxios;
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'super-4', email: 'super@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['superadmin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-bulk-stage/start')) {
				return Promise.reject({ response: { status: 409, data: { detail: 'reply_submit_validation_failed: 삭제 또는 블라인드 처리된 리뷰입니다.' } } });
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
				return Promise.resolve({ data: { ok: true, filtered_total: 1, filter_summary: '현재 필터 기준 리뷰 1건', generate_count: 0, approve_count: 0, reject_count: 0, submit_count: 1, backfill_count: 0 } });
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 0, draft_pending_count: 0, approved_count: 1, rejected_count: 0 },
						items: [
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		await clickWithAct(await screen.findByRole('button', { name: '슈퍼관리자 일괄 단계 승인 답글 자동 게시' }));
		expect(await screen.findByText('판매자센터 입력 조건을 먼저 확인해주세요. 삭제 또는 블라인드 처리된 리뷰입니다.')).toBeTruthy();
		expect(screen.queryByText(/reply_submit_validation_failed/i)).toBeNull();
		confirmSpy.mockRestore();
	});
});
