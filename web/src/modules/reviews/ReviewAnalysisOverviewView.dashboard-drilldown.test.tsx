import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	changeWithAct,
	clickWithAct,
	hoverWithAct,
	mockedAxios,
	registerReviewAnalysisOverviewTestLifecycle,
	renderReviewAnalysisOverviewView,
} from './ReviewAnalysisOverviewView.testUtils';
import { ReviewAnalysisOverviewView } from './ReviewAnalysisOverviewView';

describe('ReviewAnalysisOverviewView dashboard/drilldown', () => {
	registerReviewAnalysisOverviewTestLifecycle();

	it('전문 분석 대시보드 데이터를 불러와 KPI와 카테고리, 키워드, 실행 제안을 표시한다', async () => {
		mockedAxios.get.mockResolvedValue({
			data: {
				ok: true,
				date_from: '2026-04-01',
				date_to: '2026-04-07',
				product_url: null,
				summary: {
					total_reviews: 42,
					average_rating: 4.3,
					positive_reviews: 28,
					neutral_reviews: 8,
					negative_reviews: 6,
					positive_ratio: 66.7,
					negative_ratio: 14.3,
					latest_review_count: 120,
					previous_review_count: 100,
					review_growth_rate: 20,
					latest_average_rating: 4.3,
					previous_average_rating: 4.1,
					rating_delta: 0.2,
					high_risk_category: '배송',
					top_positive_category: '효과',
					insight_summary: '배송 이슈를 우선 관리하면서 효과/향 강점을 계속 노출해야 합니다.',
				},
				rating_distribution: {
					total_reviews: 220,
					average_rating: 4.3,
					counts: { '1': 4, '2': 6, '3': 20, '4': 70, '5': 120 },
					ratios: { '1': 1.8, '2': 2.7, '3': 9.1, '4': 31.8, '5': 54.5 },
				},
				trend: [
					{ date: '2026-04-01', review_count: 5, average_rating: 4.1, low_rating_count: 1, low_rating_ratio: 20 },
					{ date: '2026-04-02', review_count: 8, average_rating: 4.4, low_rating_count: 0, low_rating_ratio: 0 },
				],
				category_overview: [
					{
						category: '배송',
						mention_count: 10,
						positive_count: 5,
						neutral_count: 1,
						negative_count: 4,
						positive_ratio: 50,
						negative_ratio: 40,
						average_rating: 3.2,
						top_keywords: ['배송', '도착', '지연'],
						positive_examples: [
							{
								review_key: 'rv-pos-1',
								review_text: '배송이 빨라서 좋았어요.',
								product_url: 'https://smartstore.naver.com/testmall/products/1',
								product_title: '상품 A',
								review_written_at: '2026-04-03',
								rating: 5,
							},
						],
						negative_examples: [
							{
								review_key: 'rv-neg-1',
								review_text: '배송이 늦고 박스가 찌그러졌어요.',
								product_url: 'https://smartstore.naver.com/testmall/products/1',
								product_title: '상품 A',
								review_written_at: '2026-04-04',
								rating: 2,
							},
						],
						headline: '배송 언급량은 높지만 지연 불만 비중이 큽니다.',
						value_summary: '빠른 도착 경험은 재구매 의향과 연결됩니다.',
						concern_summary: '지연/파손 조합이 반복되어 CS 리스크가 있습니다.',
						target_summary: '급하게 구매하는 고객군에서 민감도가 높습니다.',
					},
				],
				keyword_insights: {
					top_keywords: [{ keyword: '배송', count: 10, positive_count: 5, negative_count: 4, positive_ratio: 50, negative_ratio: 40 }],
					rising_keywords: [{ keyword: '파손', count: 4, positive_count: 0, negative_count: 4, positive_ratio: 0, negative_ratio: 100 }],
					risk_keywords: [{ keyword: '지연', count: 5, positive_count: 0, negative_count: 5, positive_ratio: 0, negative_ratio: 100 }],
				},
				action_items: [
					{ title: '배송 지연 응대 문구 강화', detail: '저평점 배송 리뷰에 대한 안내 문구를 답글 템플릿에 반영합니다.', priority: 'high' },
				],
				source_info: {
					raw_review_count: 42,
					daily_snapshot_count: 7,
					product_count: 3,
					last_review_date: '2026-04-07',
				},
				product_overview: [
					{
						product_url: 'https://smartstore.naver.com/testmall/products/1',
						product_title: '상품 A',
						review_count: 30,
						average_rating: 4.6,
						positive_ratio: 70,
						negative_ratio: 10,
					},
				],
			},
		});

		await renderReviewAnalysisOverviewView(<ReviewAnalysisOverviewView apiBaseUrl="http://localhost:5189" />);

		await waitFor(() => {
			expect(mockedAxios.get).toHaveBeenCalledWith(
				'http://localhost:5189/reviews/analysis-dashboard',
				expect.objectContaining({
					params: expect.objectContaining({
						from_date: expect.any(String),
						to_date: expect.any(String),
					}),
				}),
			);
		});

		expect(await screen.findByText('리뷰 분석')).toBeTruthy();
		expect(screen.getByText('총 리뷰')).toBeTruthy();
		expect(screen.getByText('42건')).toBeTruthy();
		expect(screen.getByText('AI 리뷰 분석')).toBeTruthy();
		expect(screen.getByText('최신 누적 리뷰 수')).toBeTruthy();
		expect(screen.getByText('직전 누적 리뷰 수')).toBeTruthy();
		const trendSection = screen.getByText('리뷰 추이').closest('section');
		const keywordSection = screen.getByText('키워드 인사이트').closest('section');
		expect(trendSection).toBeTruthy();
		expect(keywordSection).toBeTruthy();
		expect(Boolean(trendSection && keywordSection && (trendSection.compareDocumentPosition(keywordSection) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
		expect(screen.getByText('핵심 요약')).toBeTruthy();
		expect(screen.getByText('긍정 포인트')).toBeTruthy();
		expect(screen.getByText('위험 신호')).toBeTruthy();
		expect(screen.getByText('활용 대상')).toBeTruthy();
		expect(screen.getAllByText('배송 이슈를 우선 관리하면서 효과/향 강점을 계속 노출해야 합니다.').length).toBeGreaterThan(0);
		expect(screen.getByText('종합 분석')).toBeTruthy();
		expect(screen.getByText('카테고리 심층 분석')).toBeTruthy();
		expect(screen.getAllByText('배송 언급량은 높지만 지연 불만 비중이 큽니다.').length).toBeGreaterThan(0);
		expect(screen.getByText('긍정적 평가')).toBeTruthy();
		expect(screen.getByText('부정적 평가')).toBeTruthy();
		expect(screen.getByText('상위 키워드')).toBeTruthy();
		expect(screen.getAllByText('X축 날짜').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Y축 리뷰 건수').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Y축 저평점 비율').length).toBeGreaterThan(0);
		expect(screen.getByLabelText('배송 긍정 바 5건')).toBeTruthy();
		expect(screen.getByLabelText('배송 부정 바 4건')).toBeTruthy();
		expect(screen.getByText('배송 지연 응대 문구 강화')).toBeTruthy();
		expect(screen.getByRole('button', { name: '전체 분석 다운로드' })).toBeTruthy();
		expect(screen.getByText('상품별 비교')).toBeTruthy();
		expect(screen.getByRole('button', { name: '리뷰 관리로 이동' })).toBeTruthy();

		await hoverWithAct(screen.getAllByRole('button', { name: '위험 카테고리 설명 보기: 배송' })[0]!);
		expect(await screen.findByText('배송 속도, 도착 상태, 출고 지연, 택배 경험처럼 상품이 고객에게 전달되는 과정의 평가입니다.')).toBeTruthy();

		await hoverWithAct(screen.getByRole('button', { name: '리뷰 수 추이 포인트 2026-04-01 5건' }));
		expect(await screen.findByText('2026-04-01 · 5건')).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '배송이 늦고 박스가 찌그러졌어요.' }));

		expect(await screen.findByText('근거 리뷰 상세')).toBeTruthy();
		expect(screen.getAllByText('상품 A').length).toBeGreaterThan(0);
		expect(screen.getByText('작성일 2026-04-04')).toBeTruthy();
		expect(screen.getByText('평점 2.0')).toBeTruthy();
		expect(screen.getByRole('button', { name: '상품 상세 열기' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '상품 상세 열기' }));

		expect(window.open).toHaveBeenCalledWith('https://smartstore.naver.com/testmall/products/1', '_blank', 'noopener,noreferrer');
	});

	it('상품 필터를 변경하면 해당 product_url로 다시 조회한다', async () => {
		mockedAxios.get
			.mockResolvedValueOnce({
				data: {
					ok: true,
					date_from: '2026-04-01',
					date_to: '2026-04-07',
					product_url: null,
					summary: {
						total_reviews: 10,
						average_rating: 4.4,
						positive_reviews: 7,
						neutral_reviews: 2,
						negative_reviews: 1,
						positive_ratio: 70,
						negative_ratio: 10,
						latest_review_count: 30,
						previous_review_count: 28,
						review_growth_rate: 7.1,
						latest_average_rating: 4.5,
						previous_average_rating: 4.3,
						rating_delta: 0.2,
						high_risk_category: '배송',
						top_positive_category: '효과',
						insight_summary: '초기 요약',
					},
					rating_distribution: { total_reviews: 10, average_rating: 4.4, counts: { '1': 1, '2': 0, '3': 1, '4': 3, '5': 5 }, ratios: { '1': 10, '2': 0, '3': 10, '4': 30, '5': 50 } },
					trend: [],
					category_overview: [],
					keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
					action_items: [],
					source_info: { raw_review_count: 10, daily_snapshot_count: 2, product_count: 2, last_review_date: '2026-04-07' },
					product_overview: [
						{
							product_url: 'https://smartstore.naver.com/testmall/products/1',
							product_title: '상품 A',
							review_count: 6,
							average_rating: 4.7,
							positive_ratio: 80,
							negative_ratio: 5,
						},
						{
							product_url: 'https://smartstore.naver.com/testmall/products/2',
							product_title: '상품 B',
							review_count: 4,
							average_rating: 4.0,
							positive_ratio: 55,
							negative_ratio: 20,
						},
					],
				},
			})
			.mockResolvedValueOnce({
				data: {
					ok: true,
					date_from: '2026-04-01',
					date_to: '2026-04-07',
					product_url: 'https://smartstore.naver.com/testmall/products/2',
					summary: {
						total_reviews: 4,
						average_rating: 4.0,
						positive_reviews: 2,
						neutral_reviews: 1,
						negative_reviews: 1,
						positive_ratio: 50,
						negative_ratio: 25,
						latest_review_count: 12,
						previous_review_count: 10,
						review_growth_rate: 20,
						latest_average_rating: 4.0,
						previous_average_rating: 3.8,
						rating_delta: 0.2,
						high_risk_category: '가격/가성비',
						top_positive_category: '효과',
						insight_summary: '상품 B 요약',
					},
					rating_distribution: { total_reviews: 4, average_rating: 4.0, counts: { '1': 0, '2': 1, '3': 1, '4': 1, '5': 1 }, ratios: { '1': 0, '2': 25, '3': 25, '4': 25, '5': 25 } },
					trend: [],
					category_overview: [],
					keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
					action_items: [],
					source_info: { raw_review_count: 4, daily_snapshot_count: 2, product_count: 1, last_review_date: '2026-04-07' },
					product_overview: [
						{
							product_url: 'https://smartstore.naver.com/testmall/products/2',
							product_title: '상품 B',
							review_count: 4,
							average_rating: 4.0,
							positive_ratio: 50,
							negative_ratio: 25,
						},
					],
				},
			});

		await renderReviewAnalysisOverviewView(<ReviewAnalysisOverviewView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByRole('option', { name: '상품 A' })).toBeTruthy();

		await changeWithAct(screen.getByLabelText('review-analysis-product-filter'), {
			target: { value: 'https://smartstore.naver.com/testmall/products/2' },
		});

		await waitFor(() => {
			expect(mockedAxios.get).toHaveBeenLastCalledWith(
				'http://localhost:5189/reviews/analysis-dashboard',
				expect.objectContaining({
					params: expect.objectContaining({
						product_url: 'https://smartstore.naver.com/testmall/products/2',
					}),
				}),
			);
		});
		await waitFor(() => {
			expect(screen.getAllByText('상품 B 요약').length).toBeGreaterThan(0);
		});
	});

	it('상품 비교에서 상품을 클릭하면 해당 상품으로 드릴다운한다', async () => {
		mockedAxios.get
			.mockResolvedValueOnce({
				data: {
					ok: true,
					date_from: '2026-04-01',
					date_to: '2026-04-07',
					product_url: null,
					summary: {
						total_reviews: 10,
						average_rating: 4.4,
						positive_reviews: 7,
						neutral_reviews: 2,
						negative_reviews: 1,
						positive_ratio: 70,
						negative_ratio: 10,
						latest_review_count: 30,
						previous_review_count: 28,
						review_growth_rate: 7.1,
						latest_average_rating: 4.5,
						previous_average_rating: 4.3,
						rating_delta: 0.2,
						high_risk_category: '배송',
						top_positive_category: '효과',
						insight_summary: '초기 요약',
					},
					rating_distribution: { total_reviews: 10, average_rating: 4.4, counts: { '1': 1, '2': 0, '3': 1, '4': 3, '5': 5 }, ratios: { '1': 10, '2': 0, '3': 10, '4': 30, '5': 50 } },
					trend: [],
					category_overview: [],
					keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
					action_items: [],
					source_info: { raw_review_count: 10, daily_snapshot_count: 2, product_count: 2, last_review_date: '2026-04-07' },
					product_overview: [
						{
							product_url: 'https://smartstore.naver.com/testmall/products/1',
							product_title: '상품 A',
							review_count: 6,
							average_rating: 4.7,
							positive_ratio: 80,
							negative_ratio: 5,
						},
						{
							product_url: 'https://smartstore.naver.com/testmall/products/2',
							product_title: '상품 B',
							review_count: 4,
							average_rating: 4.0,
							positive_ratio: 55,
							negative_ratio: 20,
						},
					],
				},
			})
			.mockResolvedValueOnce({
				data: {
					ok: true,
					date_from: '2026-04-01',
					date_to: '2026-04-07',
					product_url: 'https://smartstore.naver.com/testmall/products/1',
					summary: {
						total_reviews: 6,
						average_rating: 4.7,
						positive_reviews: 5,
						neutral_reviews: 1,
						negative_reviews: 0,
						positive_ratio: 83.3,
						negative_ratio: 0,
						latest_review_count: 18,
						previous_review_count: 16,
						review_growth_rate: 12.5,
						latest_average_rating: 4.8,
						previous_average_rating: 4.6,
						rating_delta: 0.2,
						high_risk_category: '배송',
						top_positive_category: '효과',
						insight_summary: '상품 A 요약',
					},
					rating_distribution: { total_reviews: 6, average_rating: 4.7, counts: { '1': 0, '2': 0, '3': 1, '4': 1, '5': 4 }, ratios: { '1': 0, '2': 0, '3': 16.7, '4': 16.7, '5': 66.6 } },
					trend: [],
					category_overview: [],
					keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
					action_items: [],
					source_info: { raw_review_count: 6, daily_snapshot_count: 2, product_count: 1, last_review_date: '2026-04-07' },
					product_overview: [
						{
							product_url: 'https://smartstore.naver.com/testmall/products/1',
							product_title: '상품 A',
							review_count: 6,
							average_rating: 4.7,
							positive_ratio: 83.3,
							negative_ratio: 0,
						},
					],
				},
			});

		await renderReviewAnalysisOverviewView(<ReviewAnalysisOverviewView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByRole('button', { name: '상품 A' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '상품 A' }));

		await waitFor(() => {
			expect(mockedAxios.get).toHaveBeenLastCalledWith(
				'http://localhost:5189/reviews/analysis-dashboard',
				expect.objectContaining({
					params: expect.objectContaining({
						product_url: 'https://smartstore.naver.com/testmall/products/1',
					}),
				}),
			);
		});
		await waitFor(() => {
			expect(screen.getAllByText('상품 A 요약').length).toBeGreaterThan(0);
		});
		expect(screen.getByText('선택 상품: 상품 A')).toBeTruthy();
		expect(screen.getByText(/현재 보고서 범위:/)).toBeTruthy();
		expect(screen.getByRole('button', { name: '전체 상품 보기' })).toBeTruthy();
	});
});
