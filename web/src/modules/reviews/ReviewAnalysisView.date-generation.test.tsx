import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
	clickWithAct,
	mockedAxios,
	registerReviewAnalysisTestLifecycle,
	renderReviewAnalysisView,
} from './ReviewAnalysisView.testUtils';

describe('ReviewAnalysisView date and generation', () => {
	registerReviewAnalysisTestLifecycle();

	it('조회기간은 기본 최근 7일(오늘 포함)이며 새로고침 후에도 유지된다', async () => {
		const axiosAny = mockedAxios;
		const workbenchRequests: Array<any> = [];

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
				workbenchRequests.push(config?.params || null);
				return Promise.resolve({
					data: {
						ok: true,
						date_from: String(config?.params?.date_from || '2026-03-27'),
						date_to: String(config?.params?.date_to || '2026-04-02'),
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 1, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 0, approved_count: 0, rejected_count: 0 },
						items: [
							{ review_key: 'naver_review:newest', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-04-02', rating: 5, option_text: '라벤더', review_text: '향이 좋아서 만족합니다.', reviewer_masked_id: 'user****', reply_status: 'new', reply_status_label: '미작성', can_copy: false, style_controls: {} },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		const { unmount } = await renderReviewAnalysisView();

		expect(await screen.findByText('리뷰 작업 대시보드')).toBeTruthy();
		await waitFor(() => expect(workbenchRequests.length).toBeGreaterThan(0));
		expect(workbenchRequests[0]?.date_from).toBe('2026-03-27');
		expect(workbenchRequests[0]?.date_to).toBe('2026-04-02');
		expect(screen.getByLabelText('sales-date-range')).toHaveTextContent('2026.03.27. ~ 2026.04.02.');

		await clickWithAct(screen.getByLabelText('sales-date-range'));
		expect(await screen.findByRole('dialog', { name: '조회 기간 선택' })).toBeTruthy();
		await clickWithAct(screen.getByText('최근 30일(오늘 제외)'));
		await clickWithAct(screen.getByRole('button', { name: '적용' }));

		await waitFor(() => {
			expect(workbenchRequests.some((params) => params?.date_from === '2026-03-03' && params?.date_to === '2026-04-01')).toBe(true);
		});
		await waitFor(() => {
			expect(window.localStorage.getItem('erp2-analytics.review-analysis.date-range.v1')).toContain('"from":"2026-03-03"');
			expect(window.localStorage.getItem('erp2-analytics.review-analysis.date-range.v1')).toContain('"to":"2026-04-01"');
		});

		unmount();
		await renderReviewAnalysisView();

		expect(await screen.findByText('리뷰 작업 대시보드')).toBeTruthy();
		await waitFor(() => {
			expect(workbenchRequests.some((params) => params?.date_from === '2026-03-03' && params?.date_to === '2026-04-01')).toBe(true);
		});
		await waitFor(() => {
			expect(screen.getByLabelText('sales-date-range')).toHaveTextContent('2026.03.03. ~ 2026.04.01.');
		});
	});

	it('신규 리뷰 초안 생성을 더 생성할 대상이 없을 때까지 반복 실행한다', async () => {
		const axiosAny = mockedAxios;
		const batchRequests: Array<any> = [];
		let batchCallCount = 0;

		(axiosAny.post as any).mockImplementation((url: string, body?: any) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) return Promise.resolve({ data: {} });
			if (u.includes('/reviews/reply-drafts/generate-batch')) {
				batchRequests.push(body);
				batchCallCount += 1;
				if (batchCallCount === 1) {
					return Promise.resolve({ data: { ok: true, requested: 10, processed: 2, generated: 2, reused: 0, skipped_replied: 0, skipped_existing: 0, exhausted: false, items: [] } });
				}
				return Promise.resolve({ data: { ok: true, requested: 10, processed: 2, generated: 2, reused: 0, skipped_replied: 0, skipped_existing: 0, exhausted: true, items: [] } });
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
				return Promise.resolve({ data: { ok: true, product_url: null, corpus_examples: 0, recommended_fields: [], presets: [
					{ level: 1, id: 'concise', name: '간결형', summary: '짧고 담백한 톤', controls: { greeting_density: 2, gratitude_intensity: 2, empathy_intensity: 2, detail_depth: 1, closing_strength: 2 } },
					{ level: 2, id: 'light', name: '절제형', summary: '절제된 톤', controls: { greeting_density: 3, gratitude_intensity: 2, empathy_intensity: 2, detail_depth: 2, closing_strength: 2 } },
					{ level: 3, id: 'balanced', name: '균형형', summary: '기본 톤', controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
					{ level: 4, id: 'attentive', name: '세심형', summary: '세심한 톤', controls: { greeting_density: 4, gratitude_intensity: 4, empathy_intensity: 4, detail_depth: 4, closing_strength: 4 } },
					{ level: 5, id: 'warm', name: '온화형', summary: '풍부한 톤', controls: { greeting_density: 5, gratitude_intensity: 5, empathy_intensity: 5, detail_depth: 4, closing_strength: 5 } },
					{ level: 6, id: 'custom', name: '사용자정의', summary: '직접 조절', controls: { greeting_density: 3, gratitude_intensity: 3, empathy_intensity: 3, detail_depth: 3, closing_strength: 3 } },
				] } });
			}
			if (u.includes('/reviews/reply-style/corpus-summary')) return Promise.resolve({ data: { ok: true, total_examples: 0, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 0 } });
			if (u.includes('/reviews/reply-backfill/status')) return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			if (u.includes('/reviews/workbench')) {
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 12, new_reviews: 12, completed_count: 0, enrichment_target_count: 0, unreplied_count: 12, draft_pending_count: 0, approved_count: 0 },
						items: [{ review_key: 'naver_review:new-1', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-31', rating: 5, option_text: '라벤더', review_text: '향이 좋아서 만족합니다.', reviewer_masked_id: 'user****', reply_status: 'new', reply_status_label: '미작성', can_copy: false, style_controls: {} }],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		await screen.findByRole('button', { name: '신규 리뷰 초안 생성' });
		await screen.findByLabelText('대상 추적 상품');
		await waitFor(() => {
			expect(screen.getByLabelText('대상 추적 상품')).not.toBeDisabled();
		});
		await waitFor(() => {
			expect(screen.getByRole('button', { name: '신규 리뷰 초안 생성' })).not.toBeDisabled();
		});
		await clickWithAct(screen.getByRole('button', { name: '신규 리뷰 초안 생성' }));

		await waitFor(() => {
			expect(batchRequests).toHaveLength(2);
		});
		expect(batchCallCount).toBe(2);
		expect(batchRequests[0]?.max_items).toBe(10);
		expect(batchRequests[1]?.max_items).toBe(10);
		expect(await screen.findByText('초안 생성 완료: 신규 4건, 재사용 0건, 기존/답글존재 스킵 0건')).toBeTruthy();
	});

	it('조회 기간 변경 시 목록만 다시 불러오고 스타일 메타는 재호출하지 않는다', async () => {
		const axiosAny = mockedAxios;
		let presetCalls = 0;
		let corpusCalls = 0;
		let workbenchCalls = 0;

		(axiosAny.post as any).mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/product-metadata/batch')) {
				return Promise.resolve({
					data: {
						'tracked-0': { title: '헤나 염색 샴푸', image_url: null, site_name: 'testmall', price: null, product_id: 1001 },
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
				presetCalls += 1;
				return Promise.resolve({
					data: {
						ok: true,
						product_url: null,
						corpus_examples: 1,
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
				corpusCalls += 1;
				return Promise.resolve({ data: { ok: true, total_examples: 1, source_counts: {}, review_type_counts: {}, duplicate_examples: 0, product_count: 1 } });
			}
			if (u.includes('/reviews/reply-backfill/status')) {
				return Promise.resolve({ data: { ok: true, scheduled: false, status: 'SUCCESS', pending_targets: 0, processed: 0, collected: 0, failed: 0, skipped: 0, detail: '보강할 답글 대상이 없습니다.' } });
			}
			if (u.includes('/reviews/workbench')) {
				workbenchCalls += 1;
				return Promise.resolve({
					data: {
						ok: true,
						date_from: '2026-03-01',
						date_to: '2026-03-31',
						product_url: null,
						dashboard: { total_reviews: 1, new_reviews: 1, completed_count: 0, enrichment_target_count: 0, unreplied_count: 1, draft_pending_count: 0, approved_count: 0 },
						items: [
							{ review_key: 'naver_review:newest', product_url: 'https://smartstore.naver.com/testmall/products/1001', product_title: '헤나 염색 샴푸', review_written_at: '2026-03-31', rating: 5, option_text: '라벤더', review_text: '향이 좋아서 만족합니다.', reviewer_masked_id: 'user****', reply_status: 'new', reply_status_label: '미작성', can_copy: false, style_controls: {} },
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderReviewAnalysisView();

		expect(await screen.findByText('리뷰 작업 대시보드')).toBeTruthy();
		expect(await screen.findByLabelText('draft-submit-naver_review:newest')).toHaveTextContent('자동 게시');
		await waitFor(() => {
			expect(presetCalls).toBe(1);
			expect(corpusCalls).toBe(1);
			expect(workbenchCalls).toBe(1);
		});
		const initialWorkbenchCalls = workbenchCalls;

		await clickWithAct(screen.getByLabelText('sales-date-range'));
		expect(await screen.findByRole('dialog', { name: '조회 기간 선택' })).toBeTruthy();
		await clickWithAct(screen.getByText('최근 7일(오늘 제외)'));
		await clickWithAct(screen.getByRole('button', { name: '적용' }));

		await waitFor(() => {
			expect(workbenchCalls).toBeGreaterThan(initialWorkbenchCalls);
		});
		expect(presetCalls).toBe(1);
		expect(corpusCalls).toBe(1);
	});
});
