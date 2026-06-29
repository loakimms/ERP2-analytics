import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import {
	clickWithAct,
	mockedAxios,
	registerReviewAnalysisOverviewTestLifecycle,
	renderReviewAnalysisOverviewView,
} from './ReviewAnalysisOverviewView.testUtils';
import { ReviewAnalysisOverviewView } from './ReviewAnalysisOverviewView';

describe('ReviewAnalysisOverviewView navigation/modal', () => {
	registerReviewAnalysisOverviewTestLifecycle();

	it('현재 분석 컨텍스트를 리뷰 관리 화면 deep link로 전달한다', async () => {
		const navigateSpy = vi.fn();
		mockedAxios.get.mockResolvedValue({
			data: {
				ok: true,
				date_from: '2026-04-01',
				date_to: '2026-04-07',
				product_url: 'https://smartstore.naver.com/testmall/products/1',
				summary: {
					total_reviews: 30,
					average_rating: 4.6,
					positive_reviews: 22,
					neutral_reviews: 5,
					negative_reviews: 3,
					positive_ratio: 73.3,
					negative_ratio: 10,
					latest_review_count: 30,
					previous_review_count: 28,
					review_growth_rate: 7.1,
					latest_average_rating: 4.6,
					previous_average_rating: 4.4,
					rating_delta: 0.2,
					high_risk_category: '배송',
					top_positive_category: '효과',
					insight_summary: '상품 A 요약',
				},
				rating_distribution: { total_reviews: 30, average_rating: 4.6, counts: { '1': 1, '2': 1, '3': 2, '4': 8, '5': 18 }, ratios: { '1': 3.3, '2': 3.3, '3': 6.7, '4': 26.7, '5': 60 } },
				trend: [],
				category_overview: [],
				keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
				action_items: [],
				source_info: { raw_review_count: 30, daily_snapshot_count: 7, product_count: 1, last_review_date: '2026-04-07' },
				product_overview: [
					{
						product_url: 'https://smartstore.naver.com/testmall/products/1',
						product_title: '상품 A',
						review_count: 30,
						average_rating: 4.6,
						positive_ratio: 73.3,
						negative_ratio: 10,
					},
				],
			},
		});

		await renderReviewAnalysisOverviewView(<ReviewAnalysisOverviewView apiBaseUrl="http://localhost:5189" onNavigate={navigateSpy} />, {
			initialPath:
				'/analytics/reviews/review-analysis?from_date=2026-04-01&to_date=2026-04-07&product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1',
		});

		expect(await screen.findByText('선택 상품: 상품 A')).toBeTruthy();
		await clickWithAct(screen.getByRole('button', { name: '리뷰 관리로 이동' }));

		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('/analytics/reviews/review-management?'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('from_date=2026-04-01'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('to_date=2026-04-07'));
		expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1'));
	});

	it('상품별 비교에서 중복 상품명이 들어와도 하나로 합쳐 보여준다', async () => {
		mockedAxios.get.mockResolvedValue({
			data: {
				ok: true,
				date_from: '2026-04-01',
				date_to: '2026-04-07',
				product_url: null,
				summary: {
					total_reviews: 20,
					average_rating: 4.3,
					positive_reviews: 14,
					neutral_reviews: 3,
					negative_reviews: 3,
					positive_ratio: 70,
					negative_ratio: 15,
					latest_review_count: 20,
					previous_review_count: 18,
					review_growth_rate: 11.1,
					latest_average_rating: 4.3,
					previous_average_rating: 4.1,
					rating_delta: 0.2,
					high_risk_category: '배송',
					top_positive_category: '효과',
					insight_summary: '중복 상품 비교 테스트',
				},
				rating_distribution: { total_reviews: 20, average_rating: 4.3, counts: { '1': 1, '2': 1, '3': 2, '4': 6, '5': 10 }, ratios: { '1': 5, '2': 5, '3': 10, '4': 30, '5': 50 } },
				trend: [],
				category_overview: [],
				keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
				action_items: [],
				source_info: { raw_review_count: 20, daily_snapshot_count: 3, product_count: 2, last_review_date: '2026-04-07' },
				product_overview: [
					{
						product_url: 'smartstore-review-upload://product/1',
						product_title: '상품 A',
						review_count: 8,
						average_rating: 4.5,
						positive_ratio: 75,
						negative_ratio: 12.5,
					},
					{
						product_url: 'https://smartstore.naver.com/testmall/products/1',
						product_title: '상품 A',
						review_count: 4,
						average_rating: 4.0,
						positive_ratio: 50,
						negative_ratio: 25,
					},
					{
						product_url: 'https://smartstore.naver.com/testmall/products/2',
						product_title: '상품 B',
						review_count: 8,
						average_rating: 4.4,
						positive_ratio: 80,
						negative_ratio: 10,
					},
				],
			},
		});

		await renderReviewAnalysisOverviewView(<ReviewAnalysisOverviewView apiBaseUrl="http://localhost:5189" />);

		expect(await screen.findByText('상품별 비교')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: '상품 A' }).length).toBe(1);
		expect(screen.getAllByRole('option', { name: '상품 A' }).length).toBe(1);
		expect(screen.getAllByRole('button', { name: '상품 B' }).length).toBe(1);
	});

	it('근거 리뷰 모달에서 해당 상품으로 다시 분석할 수 있다', async () => {
		mockedAxios.get
			.mockResolvedValueOnce({
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
						insight_summary: '전체 상품 요약',
					},
					rating_distribution: {
						total_reviews: 220,
						average_rating: 4.3,
						counts: { '1': 4, '2': 6, '3': 20, '4': 70, '5': 120 },
						ratios: { '1': 1.8, '2': 2.7, '3': 9.1, '4': 31.8, '5': 54.5 },
					},
					trend: [],
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
							positive_examples: [],
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
					keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
					action_items: [],
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
			})
			.mockResolvedValueOnce({
				data: {
					ok: true,
					date_from: '2026-04-01',
					date_to: '2026-04-07',
					product_url: 'https://smartstore.naver.com/testmall/products/1',
					summary: {
						total_reviews: 30,
						average_rating: 4.6,
						positive_reviews: 21,
						neutral_reviews: 6,
						negative_reviews: 3,
						positive_ratio: 70,
						negative_ratio: 10,
						latest_review_count: 80,
						previous_review_count: 72,
						review_growth_rate: 11.1,
						latest_average_rating: 4.6,
						previous_average_rating: 4.4,
						rating_delta: 0.2,
						high_risk_category: '배송',
						top_positive_category: '효과',
						insight_summary: '상품 A 재분석 요약',
					},
					rating_distribution: {
						total_reviews: 30,
						average_rating: 4.6,
						counts: { '1': 1, '2': 1, '3': 2, '4': 8, '5': 18 },
						ratios: { '1': 3.3, '2': 3.3, '3': 6.7, '4': 26.7, '5': 60.0 },
					},
					trend: [],
					category_overview: [],
					keyword_insights: { top_keywords: [], rising_keywords: [], risk_keywords: [] },
					action_items: [],
					source_info: {
						raw_review_count: 30,
						daily_snapshot_count: 7,
						product_count: 1,
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

		await clickWithAct(await screen.findByRole('button', { name: '배송이 늦고 박스가 찌그러졌어요.' }));
		await clickWithAct(screen.getByRole('button', { name: '이 상품으로 분석' }));

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
		expect(screen.queryByText('근거 리뷰 상세')).toBeNull();
		await waitFor(() => {
			expect(screen.getAllByText('상품 A 재분석 요약').length).toBeGreaterThan(0);
		});
		expect(screen.getByText(/현재 보고서 범위:/)).toBeTruthy();
	});
});
