import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
	changeWithAct,
	clickWithAct,
	mockedAxios,
	registerReviewAnalysisTestLifecycle,
	renderReviewAnalysisView,
} from './ReviewAnalysisView.testUtils';

describe('ReviewAnalysisView', () => {
	registerReviewAnalysisTestLifecycle();

	it('사용자정의 스타일, 기간 모달, 전체 리뷰 표 작업 흐름을 보여준다', async () => {
		const axiosAny = mockedAxios;
		const batchRequests: Array<any> = [];
		const collectRequests: Array<any> = [];
		const regenerateRequests: Array<any> = [];
		const statusRequests: Array<any> = [];
		const uploadRequests: Array<any> = [];
		const backfillStartRequests: Array<any> = [];
		const workbenchGetRequests: Array<any> = [];
		let backfillStatusCalls = 0;
		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) {
				return Promise.resolve({
					data: {
						'tracked-0': { title: '헤나 염색 샴푸', image_url: null, site_name: 'testmall', price: null, product_id: 1001 },
						'tracked-1': { title: '헤나 오일', image_url: null, site_name: 'testmall', price: null, product_id: 1002 },
					},
				});
			}
			if (u.includes('/reviews/collect-tracked')) {
				collectRequests.push(body);
				return Promise.resolve({
					data: {
						total_targets: 2,
						processed_targets: 2,
						date_from: body?.date_from || '2026-03-02',
						date_to: body?.date_to || '2026-04-01',
						fetched: 5,
						saved_reviews: 2,
						saved_replies: 1,
						skipped: 0,
						items: [
							{ product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', status: 'done', status_label: '완료', fetched: 3, saved_reviews: 2, saved_replies: 1, skipped: 0, detail: '수집 완료 3건' },
							{ product_url: 'https://smartstore.naver.com/testmall/products/1002', product_title: '헤나 오일', status: 'skipped', status_label: '신규 없음', fetched: 2, saved_reviews: 0, saved_replies: 0, skipped: 0, detail: '수집 완료 0건' },
						],
					},
				});
			}
			if (u.includes('/reviews/import-smartstore-file')) {
				uploadRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						filename: 'review_upload.csv',
						processed_rows: 2,
						saved_reviews: 2,
						saved_replies: 0,
						reply_exists_rows: 1,
						reply_backfill_targets: 1,
						imported_date_from: '2026-01-01',
						imported_date_to: '2026-02-28',
						detail: '답글여부=Y 이면서 본문이 없는 리뷰는 판매자센터 보강 대상으로 저장했습니다.',
					},
				});
			}
			if (u.includes('/reviews/reply-backfill/start')) {
				backfillStartRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: true,
						job_id: 'job-backfill-1',
						status: 'STARTED',
						pending_targets: 1,
						processed: 0,
						collected: 0,
						failed: 0,
						skipped: 0,
						detail: '답글 본문 보강 작업을 시작했습니다.',
					},
				});
			}
			if (u.includes('/reviews/reply-drafts/generate-batch')) {
				batchRequests.push(body);
				return Promise.resolve({ data: { ok: true, requested: 10, processed: 2, generated: 2, reused: 0, skipped_replied: 0, skipped_existing: 0, items: [] } });
			}
			if (u.includes('/reviews/reply-drafts/generate')) {
				regenerateRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						review_key: body?.review_key || 'naver_review:newest',
						draft_id: 'draft-generated',
						status: 'generated',
						draft_text: '재생성된 초안입니다.',
						model_name: body?.model || 'gpt-5.2',
						generated_now: true,
						style_level: body?.style_level || 3,
						style_preset_name: body?.style_level === 6 ? '사용자정의' : '균형형',
						style_controls: body?.style_controls || {},
					},
				});
			}
			if (u.includes('/reviews/reply-drafts/update')) {
				return Promise.resolve({ data: { ok: true, draft_id: body?.draft_id || 'draft-approved', review_key: 'naver_review:approved', status: 'generated', draft_text: body?.draft_text || '' } });
			}
			if (u.includes('/reviews/reply-drafts/status')) {
				statusRequests.push(body);
				return Promise.resolve({
					data: {
						ok: true,
						draft_id: body?.draft_id || 'draft-approved',
						review_key: 'naver_review:approved',
						status: body?.status || 'approved',
						rejection_comment: body?.rejection_comment || null,
						rejection_problem_summary: body?.status === 'rejected' ? '감사만 반복하고 공감이 없는 답글 패턴' : null,
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		(axiosAny.get as any).mockImplementation((url: string, config?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({
					data: [
						{ id: 1, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나염색약가격' },
						{ id: 2, product_url: 'https://smartstore.naver.com/testmall/products/1001', keyword: '헤나천연염색' },
						{ id: 3, product_url: 'https://smartstore.naver.com/testmall/products/1002', keyword: '헤나오일' },
					],
				});
			}
			if (u.includes('/reviews/reply-style/preset-recommendations')) {
				return Promise.resolve({
					data: {
						ok: true,
						product_url: 'https://smartstore.naver.com/testmall/products/1001',
						corpus_examples: 12,
						recommended_fields: [
							{ id: 'greeting_density', label: '인사/호칭 강도', description: '첫 문장 인사 강도', why: '브랜드 첫 인상에 큰 영향을 줍니다.' },
						],
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
				return Promise.resolve({ data: { ok: true, total_examples: 12, source_counts: { actual_reply: 10, approved_draft: 2 }, review_type_counts: { positive: 9, complaint: 2, mixed: 1 }, duplicate_examples: 1, product_count: 1 } });
			}
			if (u.includes('/reviews/workbench')) {
				workbenchGetRequests.push(config?.params || null);
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 7, new_reviews: 2, completed_count: 1, enrichment_target_count: 1, unreplied_count: 5, draft_pending_count: 1, approved_count: 1, rejected_count: 1 },
						items: [
							{ review_key: 'naver_review:newest', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-31', rating: 5, option_text: '라벤더', review_text: '향이 좋아서 만족합니다.', reviewer_masked_id: 'user****', reply_status: 'pending', reply_status_label: '검토대기', draft_id: 'draft-generated', draft_status: 'generated', draft_text: '생성된 초안입니다.', can_copy: false, style_level: 3, style_preset_name: '균형형', style_controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
							{ review_key: 'naver_review:approved', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-30', rating: 5, option_text: '브라운', review_text: '선물용으로도 좋았습니다.', reviewer_masked_id: 'gift****', reply_status: 'approved', reply_status_label: '승인', draft_id: 'draft-approved', draft_status: 'approved', draft_text: '승인된 초안입니다.', can_copy: true, style_level: 6, style_preset_name: '사용자정의', style_controls: { greeting_density: 5, gratitude_intensity: 4, empathy_intensity: 2, detail_depth: 3, closing_strength: 1 } },
							{ review_key: 'naver_review:completed', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-29', rating: 4, option_text: '블랙', review_text: '이미 답글이 달렸습니다.', reviewer_masked_id: 'done****', reply_status: 'enrichment_target', reply_status_label: '보강 대상', reply_exists_flag: true, reply_collect_status: 'pending', can_copy: false, style_controls: {} },
						],
					},
				});
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				backfillStatusCalls += 1;
				if (backfillStatusCalls === 1) {
					return Promise.resolve({
						data: {
							ok: true,
							scheduled: false,
							status: 'SUCCESS',
							pending_targets: 0,
							processed: 0,
							collected: 0,
							failed: 0,
							skipped: 0,
							detail: '보강할 답글 대상이 없습니다.',
						},
					});
				}
				if (backfillStatusCalls === 2) {
					return Promise.resolve({
						data: {
							ok: true,
							scheduled: false,
							job_id: 'job-backfill-1',
							status: 'STARTED',
							pending_targets: 1,
							processed: 0,
							collected: 0,
							failed: 0,
							skipped: 0,
							detail: '답글 본문 보강 작업을 진행 중입니다.',
						},
					});
				}
				return Promise.resolve({
					data: {
						ok: true,
						scheduled: false,
						job_id: 'job-backfill-1',
						status: 'SUCCESS',
						pending_targets: 0,
						processed: 1,
						collected: 1,
						failed: 0,
						skipped: 0,
						detail: '답글 본문 보강 작업이 완료되었습니다.',
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByText('리뷰 작업 대시보드')).toBeTruthy();
		expect(await screen.findByText('새로운 리뷰')).toBeTruthy();
		expect(await screen.findByText('답글 미작성')).toBeTruthy();
		expect(await screen.findByLabelText('리뷰 상태 필터 답글 보강')).toBeTruthy();
		expect(screen.getByLabelText('리뷰 상태 필터 답글 보강').getAttribute('title')).toContain('답글은 존재하지만');
		expect(await screen.findByText('전체 7건')).toBeTruthy();
		expect(await screen.findByText('답글 보강 1건')).toBeTruthy();
		expect(await screen.findByText('미작성 2건')).toBeTruthy();
		expect(await screen.findByText('완료 1건')).toBeTruthy();
		expect(await screen.findByText('반려 1건')).toBeTruthy();
		expect(await screen.findByRole('table', { name: 'review-workbench-table' })).toBeTruthy();
		expect(screen.getByLabelText('draft-approve-naver_review:newest').className).toContain('btn-primary');
		expect(screen.getByLabelText('draft-submit-naver_review:newest').className).toContain('btn-ghost');
		expect(screen.getByLabelText('draft-approve-naver_review:approved').className).toContain('btn-ghost');
		expect(screen.getByLabelText('draft-submit-naver_review:approved').className).toContain('btn-primary');
		expect(await screen.findByRole('option', { name: '헤나 염색 샴푸' })).toBeTruthy();
		expect(screen.queryByRole('option', { name: '모든 상품' })).toBeNull();
		expect(await screen.findByRole('option', { name: '상품별 보기 선택' })).toBeTruthy();
		expect(await screen.findByLabelText('평점 전체 선택')).toBeTruthy();
		expect(screen.getByLabelText('평점 5점 선택').className).toContain('btn-primary');
		expect(screen.getByLabelText('평점 4점 선택').className).toContain('btn-primary');
		expect(workbenchGetRequests[0]?.rating_filters).toEqual(['5', '4', '3', '2', '1']);
		expect(workbenchGetRequests[0]?.status_filter).toBe('all');
		expect((await screen.findAllByText((_, el) => String(el?.textContent || '').includes('리뷰 수집은 선택 상품과 무관하게 전체 활성 추적 상품'))).length).toBeGreaterThan(0);
		expect(screen.getByLabelText('수집 상태 토글')).toHaveTextContent('펼치기');
		expect(screen.queryByLabelText('review-collect-status-list')).toBeNull();
		expect(
			screen.getAllByText('검토대기').some((el) => String(el.getAttribute('title') || '').includes('초안은 생성되었지만')),
		).toBe(true);
		expect(await screen.findByText('실제 답글 있음, 본문 보강 대기')).toBeTruthy();

		const uploadInput = screen.getByLabelText('스마트스토어 리뷰 파일') as HTMLInputElement;
		const uploadFile = new File(['dummy'], 'review_upload.csv', { type: 'text/csv' });
		fireEvent.change(uploadInput, { target: { files: [uploadFile] } });
		fireEvent.click(screen.getByRole('button', { name: '스마트스토어 리뷰 업로드' }));
		expect(await screen.findByText('리뷰 업로드 완료: 리뷰 2건 저장, 답글 있음 1건, 본문 보강 대상 1건')).toBeTruthy();
		expect(uploadRequests).toHaveLength(1);
		await waitFor(() => {
			expect(workbenchGetRequests.some((params) => params?.date_from === '2026-01-01' && params?.date_to === '2026-02-28')).toBe(true);
		});

		await clickWithAct(screen.getByRole('button', { name: '답글 본문 보강' }));
		expect(await screen.findByText('답글 본문 보강 완료: 수집 1건, 미매칭 0건, 실패 0건')).toBeTruthy();
		expect(backfillStartRequests[0]?.limit).toBe(0);
		expect(backfillStartRequests[0]?.max_pages).toBe(30);

		await clickWithAct(screen.getByRole('button', { name: '전체 상품 리뷰 수집' }));
		expect(await screen.findByText('전체 추적 상품 리뷰 수집 완료: 대상 2개, 리뷰 2건, 답글 1건 저장')).toBeTruthy();
		expect(collectRequests[0]?.product_url).toBeUndefined();
		expect(collectRequests[0]?.date_from).toBe('2026-01-01');
		expect(collectRequests[0]?.date_to).toBe('2026-02-28');
		expect(collectRequests[0]?.max_targets).toBe(0);
		expect(screen.getByLabelText('수집 상태 토글')).toHaveTextContent('접기');
		expect(screen.getByLabelText('review-collect-status-list')).toBeTruthy();
		expect(await screen.findByText('수집 완료 3건')).toBeTruthy();
		expect(await screen.findByText('수집 완료 0건')).toBeTruthy();
		await clickWithAct(screen.getByLabelText('수집 상태 토글'));
		await waitFor(() => expect(screen.queryByLabelText('review-collect-status-list')).toBeNull());
		expect(screen.getByLabelText('수집 상태 토글')).toHaveTextContent('펼치기');

		await clickWithAct(screen.getByLabelText('세부 생성 옵션 토글'));
		await waitFor(() => expect(screen.queryByLabelText('답글 생성 모델')).toBeNull());
		await clickWithAct(screen.getByLabelText('세부 생성 옵션 토글'));
		expect(await screen.findByLabelText('답글 생성 모델')).toBeTruthy();

		await clickWithAct(screen.getByLabelText('sales-date-range'));
		expect(await screen.findByRole('dialog', { name: '조회 기간 선택' })).toBeTruthy();
		expect(await screen.findByText('빠른 선택')).toBeTruthy();
		expect(await screen.findByText('최근 30일(오늘 제외)')).toBeTruthy();
		await clickWithAct(screen.getByText('최근 7일(오늘 제외)'));
		await clickWithAct(screen.getByRole('button', { name: '적용' }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: '조회 기간 선택' })).toBeNull());

		await clickWithAct(screen.getByRole('button', { name: /사용자정의/ }));
		await changeWithAct(screen.getByLabelText('스타일 인사'), { target: { value: '5' } });
		await clickWithAct(screen.getByRole('button', { name: '검토대기 초안 재생성' }));
		expect(await screen.findByText('검토대기 초안 재생성 완료: 1건')).toBeTruthy();
		expect(regenerateRequests[0]?.review_key).toBe('naver_review:newest');
		expect(regenerateRequests[0]?.force_regenerate).toBe(true);
		expect(regenerateRequests[0]?.style_level).toBe(6);
		expect(regenerateRequests[0]?.style_controls?.greeting_density).toBe(5);
		await clickWithAct(screen.getByRole('button', { name: '신규 리뷰 초안 생성' }));
		expect(await screen.findByText('초안 생성 완료: 신규 2건, 재사용 0건, 기존/답글존재 스킵 0건')).toBeTruthy();
		expect(batchRequests[0]?.style_level).toBe(6);
		expect(batchRequests[0]?.style_controls?.greeting_density).toBe(5);
		expect(batchRequests[0]?.date_from).toBe('2026-03-26');
		expect(batchRequests[0]?.date_to).toBe('2026-04-01');
		expect(batchRequests[0]?.rating_filters).toEqual(['5', '4', '3', '2', '1']);

		expect(screen.queryByLabelText('draft-delete-naver_review:newest')).toBeNull();

		await changeWithAct(screen.getByLabelText('draft-editor-naver_review:approved'), { target: { value: '관리자가 최종 다듬은 초안입니다.' } });
		await clickWithAct(screen.getByLabelText('draft-approve-naver_review:approved'));
		expect(await screen.findByText('초안을 저장 후 승인했습니다.')).toBeTruthy();

		await clickWithAct(screen.getByLabelText('draft-copy-naver_review:approved'));
		await waitFor(() => {
			expect((navigator.clipboard.writeText as any)).toHaveBeenCalledWith('관리자가 최종 다듬은 초안입니다.');
		});
		expect(await screen.findByText('초안을 클립보드에 복사했습니다.')).toBeTruthy();

		await clickWithAct(screen.getByLabelText('draft-reject-naver_review:newest'));
		expect(await screen.findByRole('dialog', { name: '반려 사유 입력' })).toBeTruthy();
		await changeWithAct(screen.getByLabelText('반려 사유 입력값'), { target: { value: '감사만 반복하고 고객 불편에 대한 공감이 없습니다.' } });
		await clickWithAct(screen.getByRole('button', { name: '저장+새로작성' }));
		expect(await screen.findByText('반려 사유를 저장하고 GPT가 새 초안을 작성했습니다.')).toBeTruthy();
		expect(statusRequests.at(-1)?.status).toBe('rejected');
		expect(statusRequests.at(-1)?.rejection_comment).toBe('감사만 반복하고 고객 불편에 대한 공감이 없습니다.');

		await clickWithAct(screen.getByLabelText('리뷰 상태 필터 답글 보강'));
		expect(await screen.findByText('실제 답글 있음, 본문 보강 대기')).toBeTruthy();
		expect(screen.queryByText('선물용으로도 좋았습니다.')).toBeNull();
		await clickWithAct(screen.getByLabelText('평점 5점 선택'));
		expect(await screen.findByText('이미 답글이 달렸습니다.')).toBeTruthy();
		expect(screen.queryByText('향이 좋아서 만족합니다.')).toBeNull();
		await waitFor(() => {
			expect(window.scrollTo).toHaveBeenCalledWith({ left: 0, top: 640, behavior: 'auto' });
		});
		expect(screen.getByLabelText('평점 5점 선택').className).toContain('btn-ghost');
		expect(screen.getByLabelText('평점 4점 선택').className).toContain('btn-primary');
		await clickWithAct(screen.getByLabelText('평점 전체 선택'));
		expect(screen.getByLabelText('평점 5점 선택').className).toContain('btn-primary');
		expect(screen.getByLabelText('평점 4점 선택').className).toContain('btn-primary');
	});

	it('URL 초기 컨텍스트를 읽어 상품 필터를 복원하고 분석 화면으로 역방향 deep link 한다', async () => {
		const axiosAny = mockedAxios;
		const navigateSpy = vi.fn();
		const workbenchGetRequests: Array<any> = [];
		window.history.replaceState(
			{},
			'',
			'/analytics/reviews/review-management?product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1001&from_date=2026-04-01&to_date=2026-04-07',
		);
		(axiosAny.post as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) {
				return Promise.resolve({
					data: {
						'tracked-0': { title: '헤나 염색 샴푸' },
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
				return Promise.resolve({ data: { ok: true, product_url: 'https://smartstore.naver.com/testmall/products/1001', corpus_examples: 0, recommended_fields: [], presets: [] } });
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) {
				return Promise.resolve({ data: { ok: true, product_url: 'https://smartstore.naver.com/testmall/products/1001', total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 1 } });
			}
			if (u.includes('/reviews/reply-drafts/rejection-history')) {
				return Promise.resolve({ data: [] });
			}
			if (u.includes('/reviews/workbench')) {
				workbenchGetRequests.push(config?.params || null);
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-04-01',
						date_to: '2026-04-07',
						product_url: 'https://smartstore.naver.com/testmall/products/1001',
						dashboard: {
							total_reviews: 1,
							new_reviews: 1,
							completed_count: 0,
							enrichment_target_count: 0,
							unreplied_count: 1,
							draft_pending_count: 0,
							approved_count: 0,
							rejected_count: 0,
							rejection_history_count: 0,
						},
						items: [
							{
								review_key: 'naver_review:selected',
								product_url: 'https://smartstore.naver.com/testmall/products/1001',
								product_title: '헤나 염색 샴푸',
								review_written_at: '2026-04-05',
								rating: 5,
								option_text: '라벤더',
								review_text: '향이 좋아서 만족합니다.',
								reviewer_masked_id: 'user****',
								reply_status: 'new',
								reply_status_label: '미작성',
								can_copy: false,
								style_controls: {},
							},
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView({ onNavigate: navigateSpy });

		expect(await screen.findByText('향이 좋아서 만족합니다.')).toBeTruthy();
		await waitFor(() => {
			expect(workbenchGetRequests[0]?.product_url).toBe('https://smartstore.naver.com/testmall/products/1001');
			expect(workbenchGetRequests[0]?.date_from).toBe('2026-04-01');
			expect(workbenchGetRequests[0]?.date_to).toBe('2026-04-07');
		});
		expect(screen.getByText('선택 상품 필터: 헤나 염색 샴푸')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '리뷰 분석에서 보기' }));

		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('/analytics/reviews/review-analysis?'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('from_date=2026-04-01'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('to_date=2026-04-07'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1001'));
	});
});