import React from 'react';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
	},
}));

vi.mock('../auth/AuthProvider', () => ({
	useMaybeAuth: () => ({
		getIdToken: vi.fn().mockResolvedValue('test-token'),
	}),
}));

export const mockedAxios = axios as any;

export async function renderQnaAnalysisView(view: React.ReactElement): Promise<RenderResult> {
	let rendered!: RenderResult;
	await act(async () => {
		rendered = render(view);
		await Promise.resolve();
		await Promise.resolve();
	});
	return rendered;
}

export async function clickWithAct(target: Element): Promise<void> {
	await act(async () => {
		fireEvent.click(target);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export async function changeWithAct(target: Element, value: Record<string, unknown>): Promise<void> {
	await act(async () => {
		fireEvent.change(target, value);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export function mockGetByUrl(url: string): any {
	if (url.includes('/qna/analysis/summary')) {
		return {
			data: {
				ok: true,
				summary: {
					total_items: 12,
					purchase_ready_count: 4,
					negative_count: 3,
					high_conversion_count: 5,
					faq_candidate_count: 6,
					customer_count: 8,
					product_count: 4,
					answered_count: 7,
					unanswered_count: 5,
					analysis_coverage_rate: 100,
				},
				inquiry_type_counts: { 효과문의: 4, 안전성문의: 3, 불만문의: 2 },
				purchase_stage_counts: { 구매직전: 4, 비교검토: 3, 구매후사용: 2 },
				sentiment_counts: { POSITIVE: 2, NEUTRAL: 7, NEGATIVE: 3 },
				category_counts: { 효과: 4, 상품: 3, 불만: 2 },
				top_products: [{ product_name: '테스트 샴푸', total_items: 7, high_conversion_count: 3, negative_count: 1, faq_candidate_count: 4 }],
				action_guides: [
					{
						title: 'FAQ 먼저 보강',
						why: '구매직전/FAQ 후보 문의가 반복됩니다.',
						what_to_do: '지속력과 안전성 질문을 FAQ와 상세페이지 상단에 반영하세요.',
						target_area: 'FAQ/상세페이지',
						priority: 'high',
					},
					{
						title: '품질 이슈 검토',
						why: '냄새와 자극 관련 부정 문의가 확인됩니다.',
						what_to_do: '상품기획/품질팀과 함께 냄새/자극 이슈를 우선 점검하세요.',
						target_area: '상품 개선',
						priority: 'high',
					},
				],
			},
		};
	}
	if (url.includes('/qna/analysis/trends')) {
		return {
			data: {
				ok: true,
				points: [
					{ date: '2026-04-01', total_items: 3, negative_count: 1, faq_candidate_count: 1, high_conversion_count: 1 },
					{ date: '2026-04-02', total_items: 4, negative_count: 1, faq_candidate_count: 2, high_conversion_count: 2 },
				],
			},
		};
	}
	if (url.includes('/qna/analysis/conversion-barriers')) {
		return {
			data: {
				ok: true,
				items: [
					{
						qna_key: 'customer:101',
						product_name: '테스트 샴푸',
						inquiry_text: '얼마나 지속되나요?',
						inquiry_type: '효과문의',
						purchase_stage: '구매직전',
						conversion_impact_score: 86,
						faq_candidate: true,
						recommended_action: 'FAQ와 상세페이지 지속력 섹션을 강화하세요.',
					},
				],
			},
		};
	}
	if (url.includes('/qna/analysis/quality-issues')) {
		return {
			data: {
				ok: true,
				items: [
					{
						qna_key: 'product:201',
						product_name: '테스트 오일',
						inquiry_text: '냄새가 너무 강하고 따갑습니다.',
						issue_tags: ['냄새', '자극'],
						sentiment: 'NEGATIVE',
						severity: 'HIGH',
						recommended_action: '품질 검토와 사용 가이드 보강이 필요합니다.',
					},
					{
						qna_key: 'product:202',
						product_name: '테스트 크림',
						inquiry_text: '색상이 사진과 많이 다릅니다.',
						issue_tags: ['색상'],
						sentiment: 'NEGATIVE',
						severity: 'MEDIUM',
						recommended_action: '상세페이지 색상 안내를 점검하세요.',
					},
				],
			},
		};
	}
	if (url.includes('/qna/analysis/faq-candidates')) {
		return {
			data: {
				ok: true,
				items: [
					{
						qna_key: 'customer:301',
						product_name: '테스트 샴푸',
						inquiry_text: '민감한 두피도 사용 가능한가요?',
						faq_candidate: true,
						conversion_impact_score: 78,
						recommended_answer: '민감성 두피 고객을 위한 사용 전 안내 문구가 필요합니다.',
						recommended_section: 'FAQ > 안전성',
					},
				],
			},
		};
	}
	if (url.includes('/qna/analysis/marketing-insights')) {
		return {
			data: {
				ok: true,
				top_keywords: [
					{ keyword: '민감성 두피', count: 5, sentiment: 'NEUTRAL', recommended_usage: '상세페이지 안전성 카피' },
				],
				copy_candidates: [
					{ phrase: '민감한 두피도 안심하고 사용할 수 있을까요?', source_count: 3, recommended_channel: '상세페이지 첫 화면' },
				],
			},
		};
	}
	if (url.includes('/qna/analysis/items')) {
		return {
			data: {
				ok: true,
				total_items: 2,
				items: [
					{
						qna_key: 'customer:401',
						qna_kind: 'customer',
						product_name: '테스트 샴푸',
						inquiry_text: '얼마나 지속되나요?',
						inquiry_registered_at: '2026-04-02T09:00:00+09:00',
						analysis: {
							inquiry_type: '효과문의',
							purchase_stage: '구매직전',
							sentiment: 'NEUTRAL',
							conversion_impact_score: 86,
							keywords: ['지속력'],
							issue_tags: ['ODOR', '냄새'],
							summary_text: '구매 직전 지속력 확인 문의',
						},
						recommended_action: 'FAQ 등록',
					},
					{
						qna_key: 'product:402',
						qna_kind: 'product',
						product_name: '테스트 크림',
						inquiry_text: '색상이 사진과 달라요.',
						inquiry_registered_at: '2026-04-03T11:00:00+09:00',
						analysis: {
							inquiry_type: '불만문의',
							purchase_stage: '구매후사용',
							sentiment: 'NEGATIVE',
							conversion_impact_score: 22,
							keywords: ['색상'],
							issue_tags: ['COLOR_DIFF', '색상'],
							summary_text: '구매 후 색상 차이 불만 문의',
						},
						recommended_action: '색상 안내 보강',
					},
				],
			},
		};
	}
	return { data: { ok: true } };
}

export function registerQnaAnalysisTestLifecycle(): void {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState({}, '', '/analytics/reviews/qna-analysis');
		mockedAxios.get.mockImplementation((url: string) => Promise.resolve(mockGetByUrl(String(url || ''))));
		mockedAxios.post.mockResolvedValue({ data: { ok: true, requested_count: 12, analyzed_count: 12, skipped_count: 0 } });
	});
}
