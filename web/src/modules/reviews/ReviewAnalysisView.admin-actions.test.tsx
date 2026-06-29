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

describe('ReviewAnalysisView admin actions', () => {
	registerReviewAnalysisTestLifecycle();

	it('승인 행 자동 게시와 ADMIN 일괄 자동 게시를 처리한다', async () => {
		const axiosAny = mockedAxios;
		let bulkStatusCalls = 0;
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'admin-1', email: 'admin@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['ops_admin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/submit')) {
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: body?.draft_id || 'draft-approved',
						review_key: 'naver_review:approved',
						status: 'completed',
						detail: '판매자센터에 답글을 등록했습니다.',
						reply_written_at: '2026-04-01',
					},
				});
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/start')) {
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: true,
						job_id: 'job-submit-1',
						status: 'STARTED',
						pending_targets: 1,
						processed: 0,
						succeeded: 0,
						failed: 0,
						detail: '승인 답글 자동 게시 작업을 시작했습니다.',
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({
					data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }],
				});
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({
					data: {
						ok: true,
						product_url: null,
						corpus_examples: 0,
						recommended_fields: [],
						presets: [
							{ level: 1, id: 'concise', name: '간결형', summary: '짧고 담백한 톤', controls: { greeting_density: 2, gratitude_intensity: 2, empathy_intensity: 2, detail_depth: 1, closing_strength: 2 } },
							{ level: 2, id: 'light', name: '절제형', summary: '절제된 톤', controls: { greeting_density: 3, gratitude_intensity: 2, empathy_intensity: 2, detail_depth: 2, closing_strength: 2 } },
							{ level: 3, id: 'balanced', name: '균형형', summary: '기본 톤', controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
							{ level: 4, id: 'attentive', name: '세심형', summary: '세심한 톤', controls: { greeting_density: 4, gratitude_intensity: 4, empathy_intensity: 4, detail_depth: 4, closing_strength: 4 } },
							{ level: 5, id: 'warm', name: '온화형', summary: '풍부한 톤', controls: { greeting_density: 5, gratitude_intensity: 5, empathy_intensity: 5, detail_depth: 4, closing_strength: 5 } },
							{ level: 6, id: 'custom', name: '사용자정의', summary: '직접 조절', controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				bulkStatusCalls += 1;
				if (bulkStatusCalls === 1) {
					return Promise.resolve({
						data: {
							ok: true,
							scheduled: false,
							job_id: 'job-submit-1',
							status: 'STARTED',
							pending_targets: 1,
							processed: 0,
							succeeded: 0,
							failed: 0,
							skipped: 0,
							detail: '승인 답글 자동 게시 작업을 진행 중입니다.',
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: false,
						job_id: 'job-submit-1',
						status: 'SUCCESS',
						pending_targets: 0,
						processed: 1,
						succeeded: 1,
						failed: 0,
						skipped: 0,
						detail: '승인 답글 자동 게시 작업이 완료되었습니다.',
					},
				});
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 0, approved_count: 1 },
						items: [
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByRole('button', { name: '승인건 일괄 자동 게시' })).toBeTruthy();
		expect(await screen.findByLabelText('draft-submit-naver_review:approved')).toBeTruthy();

		await clickWithAct(screen.getByLabelText('draft-submit-naver_review:approved'));
		expect(await screen.findByText('자동 게시 완료: 판매자센터에 답글을 등록했습니다.')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '승인건 일괄 자동 게시' }));
		await waitFor(() => expect(bulkStatusCalls).toBeGreaterThan(0));
		expect(await screen.findByText('승인 답글 자동 게시 완료: 성공 1건, 실패 0건, 스킵 0건')).toBeTruthy();
	});

	it('단건 자동 게시가 기존 답글 감지 전이 문구를 그대로 보여준다', async () => {
		const axiosAny = mockedAxios;
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'admin-1', email: 'admin@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['ops_admin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/submit')) {
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: body?.draft_id || 'draft-approved',
						review_key: 'naver_review:approved-existing',
						status: 'enrichment_target',
						result_type: 'existing_reply_enrichment',
						detail: '이미 등록된 답글 존재를 확인해 보강 대상으로 전이했습니다.',
						reply_written_at: null,
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
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
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 0, draft_pending_count: 0, approved_count: 1, rejected_count: 0, rejection_history_count: 0 },
						items: [
							{ review_key: 'naver_review:approved-existing', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '이미 답글 존재가 감지된 리뷰입니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		await clickWithAct(await screen.findByLabelText('draft-submit-naver_review:approved-existing'));
		expect(await screen.findByText('자동 게시 완료: 이미 등록된 답글 존재를 확인해 보강 대상으로 전이했습니다.')).toBeTruthy();
	});

	it('실제 답글 있음 보강 대상에 관리자 수동 완료 처리 버튼을 노출하고 실행한다', async () => {
		const axiosAny = mockedAxios;
		const manualCompleteRequests: Array<any> = [];
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'admin-1', email: 'admin@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['ops_admin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/manual-complete')) {
				manualCompleteRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: body?.draft_id || 'draft-enrichment',
						review_key: 'naver_review:enrichment-existing',
						status: 'completed',
						result_type: 'manual_completed',
						detail: '관리자가 기존 답글 존재를 확인해 완료 처리했습니다.',
						reply_written_at: null,
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
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
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 1, unreplied_count: 0, draft_pending_count: 0, approved_count: 0, rejected_count: 0, rejection_history_count: 0 },
						items: [
							{ review_key: 'naver_review:enrichment-existing', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '실제 답글은 있으나 본문이 미수집된 리뷰입니다.', reviewer_masked_id: 'gift****', reply_text: null, reply_exists_flag: true, reply_collect_status: 'pending', reply_status: 'enrichment_target', reply_status_label: '보강 대상', draft_id: 'draft-enrichment', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		const completeButton = await screen.findByLabelText('draft-manual-complete-naver_review:enrichment-existing');
		await clickWithAct(completeButton);
		expect(await screen.findByText('관리자가 기존 답글 존재를 확인해 완료 처리했습니다.')).toBeTruthy();
		expect(manualCompleteRequests).toEqual([{ draft_id: 'draft-enrichment' }]);
	});

	it('승인건 일괄 자동 게시 진행 중 버튼을 다시 누르면 중지 요청을 보낸다', async () => {
		const axiosAny = mockedAxios;
		let bulkStatusCalls = 0;
		const stopRequests: Array<any> = [];
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'admin-1', email: 'admin@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['ops_admin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/bulk-submit/start')) {
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: true,
						job_id: 'job-submit-stop-1',
						status: 'STARTED',
						pending_targets: 2,
						processed: 0,
						succeeded: 0,
						failed: 0,
						skipped: 0,
						cancel_requested: false,
						detail: '승인 답글 자동 게시 작업을 시작했습니다.',
					},
				});
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/stop')) {
				stopRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: false,
						job_id: 'job-submit-stop-1',
						status: 'STARTED',
						pending_targets: 2,
						processed: 1,
						succeeded: 1,
						failed: 0,
						skipped: 0,
						cancel_requested: true,
						detail: '승인 답글 자동 게시 중지 요청을 접수했습니다.',
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({
					data: [{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' }],
				});
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({
					data: {
						ok: true,
						product_url: null,
						corpus_examples: 0,
						recommended_fields: [],
						presets: [],
					},
				});
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-drafts/bulk-submit/status')) {
				bulkStatusCalls += 1;
				if (bulkStatusCalls === 1) {
					return Promise.resolve({
						data: {
							ok: true,
							scheduled: false,
							status: 'IDLE',
							pending_targets: 2,
							processed: 0,
							succeeded: 0,
							failed: 0,
							skipped: 0,
							cancel_requested: false,
							detail: '아직 시작된 승인 답글 자동 게시 작업이 없습니다.',
						},
					});
				}
				if (bulkStatusCalls === 2) {
					return Promise.resolve({
						data: {
							ok: true,
							scheduled: false,
							job_id: 'job-submit-stop-1',
							status: 'STARTED',
							pending_targets: 2,
							processed: 0,
							succeeded: 0,
							failed: 0,
							skipped: 0,
							cancel_requested: false,
							detail: '승인 답글 자동 게시 작업을 진행 중입니다.',
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: false,
						job_id: 'job-submit-stop-1',
						status: 'CANCELLED',
						pending_targets: 1,
						processed: 1,
						succeeded: 1,
						failed: 0,
						skipped: 0,
						cancel_requested: true,
						detail: '승인 답글 자동 게시 작업을 사용자 요청으로 중단했습니다.',
					},
				});
			}
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 0, approved_count: 1 },
						items: [
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		const startButton = await screen.findByRole('button', { name: '승인건 일괄 자동 게시' });
		await clickWithAct(startButton);
		expect(await screen.findByRole('button', { name: '승인건 자동 게시 중지' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '승인건 자동 게시 중지' }));
		expect(await screen.findByText('승인 답글 자동 게시 중지 요청을 보냈습니다. 현재 처리 중인 건까지 마무리한 뒤 멈춥니다.')).toBeTruthy();
		expect(stopRequests).toEqual([{ job_id: 'job-submit-stop-1' }]);
	});

	it('슈퍼관리자 단계별 일괄 적용 패널이 현재 필터 기준으로 실행된다', async () => {
		const axiosAny = mockedAxios;
		const previewRequests: Array<any> = [];
		const startRequests: Array<any> = [];
		const workbenchGetRequests: Array<any> = [];
		let stageStatusCalls = 0;
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'super-1', email: 'super@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['superadmin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-bulk-stage/start')) {
				startRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: true,
						job_id: 'job-stage-1',
						stage: body?.stage || 'approve',
						stage_label: '검토대기 일괄 승인',
						status: 'STARTED',
						filtered_total: 1,
						pending_targets: 1,
						processed: 0,
						succeeded: 0,
						failed: 0,
						skipped: 0,
						detail: '검토대기 일괄 승인 작업을 시작했습니다.',
					},
				});
			}
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
				return Promise.resolve({
					data: {
						ok: true,
						product_url: null,
						corpus_examples: 0,
						recommended_fields: [],
						presets: [
							{ level: 3, id: 'balanced', name: '균형형', summary: '기본 톤', controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
							{ level: 6, id: 'custom', name: '사용자정의', summary: '직접 조절', controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/reply-bulk-stage/preview')) {
				previewRequests.push(config?.params || null);
				return Promise.resolve({
					data: {
						ok: true,
						filtered_total: 1,
						filter_summary: '기간 2026-03-26~2026-04-01 / 상태 검토대기 / 평점 5점,4점,3점,2점,1점 / 상품 전체',
						generate_count: 0,
						approve_count: 1,
						reject_count: 1,
						submit_count: 0,
						backfill_count: 0,
					},
				});
			}
			if (u.includes('/reviews/reply-bulk-stage/status')) {
				const jobId = String(config?.params?.job_id || '').trim();
				if (!jobId) {
					return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', filtered_total: 0, pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 슈퍼관리자 일괄 단계 작업이 없습니다.' } });
				}
				stageStatusCalls += 1;
				if (stageStatusCalls === 1) {
					return Promise.resolve({
						data: {
							ok: true,
							scheduled: false,
							job_id: 'job-stage-1',
							stage: 'approve',
							stage_label: '검토대기 일괄 승인',
							status: 'STARTED',
							filtered_total: 1,
							pending_targets: 1,
							processed: 0,
							succeeded: 0,
							failed: 0,
							skipped: 0,
							detail: '검토대기 일괄 승인 작업을 진행 중입니다.',
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: false,
						job_id: 'job-stage-1',
						stage: 'approve',
						stage_label: '검토대기 일괄 승인',
						status: 'SUCCESS',
						filtered_total: 1,
						pending_targets: 0,
						processed: 1,
						succeeded: 1,
						failed: 0,
						skipped: 0,
						detail: '검토대기 일괄 승인 작업이 완료되었습니다.',
					},
				});
			}
			if (u.includes('/reviews/workbench')) {
				workbenchGetRequests.push(config?.params || null);
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 0, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 1, approved_count: 0, rejected_count: 0 },
						items: [
							{ review_key: 'naver_review:pending', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-31', rating: 5, option_text: '라벤더', review_text: '검토대기 대상 리뷰입니다.', reviewer_masked_id: 'user****', reply_status: 'pending', reply_status_label: '검토대기', draft_id: 'draft-pending', draft_status: 'generated', draft_text: '검토대기 초안입니다.', can_copy: false, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByLabelText('superadmin-bulk-stage-panel')).toBeTruthy();
		expect(screen.queryByRole('button', { name: '승인건 일괄 자동 게시' })).toBeNull();
		await waitFor(() => {
			expect(previewRequests.some((params) => params?.status_filter === 'all')).toBe(true);
		});

		await clickWithAct(screen.getByLabelText('리뷰 상태 필터 검토대기'));
		await waitFor(() => {
			expect(previewRequests.some((params) => params?.status_filter === 'pending')).toBe(true);
		});
		await waitFor(() => {
			expect(workbenchGetRequests.at(-1)?.status_filter).toBe('pending');
		});
		await clickWithAct(screen.getByLabelText('평점 4점 선택'));
		await waitFor(() => {
			expect(workbenchGetRequests.at(-1)?.rating_filters).toEqual(['5', '3', '2', '1']);
		});

		await clickWithAct(screen.getByLabelText('슈퍼관리자 일괄 단계 검토대기 일괄 승인'));
		expect(await screen.findByText('검토대기 일괄 승인 진행 중: 처리 0건, 성공 0건, 실패 0건, 스킵 0건')).toBeTruthy();
		expect(stageStatusCalls).toBeGreaterThan(0);
		expect(startRequests[0]?.stage).toBe('approve');
		expect(startRequests[0]?.status_filter).toBe('pending');
		expect(startRequests[0]?.rating_filters).toEqual(['5', '3', '2', '1']);
	});

	it('슈퍼관리자 submit 단계 진행 중 버튼을 다시 누르면 중지 요청을 보낸다', async () => {
		const axiosAny = mockedAxios;
		const stopRequests: Array<any> = [];
		let statusCalls = 0;
		useMaybeAuthMock.mockReturnValue({
			loading: false,
			user: { uid: 'super-1', email: 'super@test.com' },
			error: null,
			signIn: vi.fn(),
			signOut: vi.fn(),
			getIdToken: vi.fn(async () => makeJwt({ roles: ['superadmin'] })),
		} as any);

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-bulk-stage/start')) {
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: true,
						job_id: 'job-stage-submit-stop-1',
						stage: 'submit',
						stage_label: '승인 답글 자동 게시',
						status: 'STARTED',
						filtered_total: 1,
						pending_targets: 1,
						processed: 0,
						succeeded: 0,
						failed: 0,
						skipped: 0,
						cancel_requested: false,
						detail: '승인 답글 자동 게시 작업을 시작했습니다.',
					},
				});
			}
			if (u.includes('/reviews/reply-bulk-stage/stop')) {
				stopRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: false,
						job_id: 'job-stage-submit-stop-1',
						stage: 'submit',
						stage_label: '승인 답글 자동 게시',
						status: 'STARTED',
						filtered_total: 1,
						pending_targets: 1,
						processed: 0,
						succeeded: 0,
						failed: 0,
						skipped: 0,
						cancel_requested: true,
						detail: '슈퍼관리자 일괄 단계 작업 중지 요청을 접수했습니다.',
					},
				});
			}
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
			if (u.includes('/reviews/reply-bulk-stage/preview')) {
				return Promise.resolve({
					data: {
						ok: true,
						filtered_total: 1,
						filter_summary: '현재 필터 기준 리뷰 1건',
						generate_count: 0,
						approve_count: 0,
						reject_count: 0,
						submit_count: 1,
						backfill_count: 0,
					},
				});
			}
			if (u.includes('/reviews/reply-bulk-stage/status')) {
				const jobId = String(config?.params?.job_id || '').trim();
				if (!jobId) {
					return Promise.resolve({ data: { ok: true, scheduled: false, status: 'IDLE', filtered_total: 0, pending_targets: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, detail: '아직 시작된 슈퍼관리자 일괄 단계 작업이 없습니다.' } });
				}
				statusCalls += 1;
				if (statusCalls === 1) {
					return Promise.resolve({
						data: {
							ok: true,
							scheduled: false,
							job_id: 'job-stage-submit-stop-1',
							stage: 'submit',
							stage_label: '승인 답글 자동 게시',
							status: 'STARTED',
							filtered_total: 1,
							pending_targets: 1,
							processed: 0,
							succeeded: 0,
							failed: 0,
							skipped: 0,
							cancel_requested: false,
							detail: '승인 답글 자동 게시 작업을 진행 중입니다.',
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: false,
						job_id: 'job-stage-submit-stop-1',
						stage: 'submit',
						stage_label: '승인 답글 자동 게시',
						status: 'CANCELLED',
						filtered_total: 1,
						pending_targets: 0,
						processed: 0,
						succeeded: 0,
						failed: 0,
						skipped: 0,
						cancel_requested: true,
						detail: '슈퍼관리자 일괄 단계 작업을 사용자 요청으로 중단했습니다.',
					},
				});
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

		const startButton = await screen.findByRole('button', { name: '슈퍼관리자 일괄 단계 승인 답글 자동 게시' });
		await clickWithAct(startButton);
		expect(await screen.findByRole('button', { name: '슈퍼관리자 일괄 단계 승인 답글 자동 게시' })).toHaveTextContent('승인 답글 자동 게시 중지');

		await clickWithAct(screen.getByRole('button', { name: '슈퍼관리자 일괄 단계 승인 답글 자동 게시' }));
		expect(await screen.findByText('슈퍼관리자 일괄 단계 중지 요청을 보냈습니다. 현재 처리 중인 건까지 마무리한 뒤 멈춥니다.')).toBeTruthy();
		expect(stopRequests).toEqual([{ job_id: 'job-stage-submit-stop-1' }]);
	});
});
