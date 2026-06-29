import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';

import { clickWithAct, mockedAxios, registerAiOpsTestLifecycle, renderAiOpsView } from './AiOpsCenterViews.testUtils';
import { AiOpsQnaView, AiOpsReviewsView, AiOpsTrendsView } from '.';

function LocationProbe(props: { children: React.ReactNode }): JSX.Element {
	const location = useLocation();
	return (
		<>
			<div data-testid="current-location">{`${location.pathname}${location.search}`}</div>
			{props.children}
		</>
	);
}

describe('AiOpsCenterViews qualitative flows', () => {
	registerAiOpsTestLifecycle();

	it('리뷰·VOC 판단 화면은 우선 상품과 실행 제안을 표시하고 실행 큐로 적재할 수 있다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/ops/reviews/summary')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							total_products: 12,
							urgent_count: 3,
							reply_improvement_count: 2,
							hold_count: 1,
							avg_negative_ratio: 0.27,
						},
					},
				});
			}
			if (u.includes('/ai/ops/reviews/products')) {
				return Promise.resolve({
					data: {
						ok: true,
						items: [
							{
								sku_id: 'SKU-REVIEW-1',
								product_name: '리뷰 위험 상품',
								action_bucket: 'VOC_IMPROVEMENT',
								top_issue: '배송 지연 불만이 반복됩니다.',
								recommended_action_primary: 'VOC 개선 후 재광고',
								negative_review_ratio: 0.41,
								negative_review_count: 12,
								severity: 'HIGH',
								risk_topics: ['배송', '포장'],
								strength_topics: ['발색'],
							},
						],
					},
				});
			}
			if (u.includes('/ai/ops/reviews/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						actions: [
							{
								title: '답글 정책 재정비',
								action_bucket: 'VOC_IMPROVEMENT',
								expected_effect: '부정 리뷰 확산 속도 완화',
								owner: 'VOC 운영',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});
		mockedAxios.post.mockResolvedValue({ data: { ok: true } });

		await renderAiOpsView(
			<LocationProbe>
				<AiOpsReviewsView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/reviews'],
		);

		expect(await screen.findByText('리뷰 위험 상품')).toBeTruthy();
		expect(screen.getByText('12개')).toBeTruthy();
		expect(screen.getByText('3개')).toBeTruthy();
		expect(screen.getByText('27%')).toBeTruthy();
		expect(screen.getByText(/배송 지연 불만/)).toBeTruthy();
		expect(screen.getByText(/답글 정책 재정비/)).toBeTruthy();
		expect(screen.getByRole('button', { name: '관련 실행 큐 보기' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '관련 검증 로그 보기' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '관련 실행 큐 보기' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain('/analytics/ai/actions?action_bucket=VOC_IMPROVEMENT');
		});

		await clickWithAct(screen.getByRole('button', { name: 'VOC 실행 큐로 보내기' }));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/actions',
				expect.objectContaining({
					source_scope: 'ai-ops-reviews',
					entity_id: 'SKU-REVIEW-1',
					action_type: 'QUEUE_PRIMARY_ACTION',
				}),
			);
		});
		expect(await screen.findByText(/리뷰 위험 상품 액션을 실행 큐에 적재했습니다/)).toBeTruthy();
	});

	it('Q&A 전환장벽 판단 화면은 FAQ/상세페이지 보강 후보를 표시하고 실행 큐로 적재할 수 있다', async () => {
		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/ai/ops/qna/summary')) {
				return Promise.resolve({
					data: {
						ok: true,
						summary: {
							total_products: 7,
							barrier_count: 2,
							faq_gap_count: 3,
							detail_gap_count: 1,
							prepurchase_ratio: 0.64,
						},
					},
				});
			}
			if (u.includes('/ai/ops/qna/products')) {
				return Promise.resolve({
					data: {
						ok: true,
						items: [
							{
								sku_id: 'SKU-QNA-1',
								product_name: '문의 장벽 상품',
								action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
								top_issue: '구매 전 성분 문의가 반복됩니다.',
								recommended_action_primary: 'FAQ 등록 후 상세페이지 보강',
								faq_gap_count: 5,
								prepurchase_question_ratio: 0.88,
								severity: 'HIGH',
								issue_tags: ['성분', '사용법'],
							},
						],
					},
				});
			}
			if (u.includes('/ai/ops/qna/actions')) {
				return Promise.resolve({
					data: {
						ok: true,
						actions: [
							{
								title: 'FAQ 등록',
								action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
								expected_effect: '구매 직전 문의 감소',
								owner: '콘텐츠 운영',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});
		mockedAxios.post.mockResolvedValue({ data: { ok: true } });

		await renderAiOpsView(
			<LocationProbe>
				<AiOpsQnaView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/qna'],
		);

		expect(await screen.findByText('문의 장벽 상품')).toBeTruthy();
		expect(screen.getByText('7개')).toBeTruthy();
		expect(screen.getByText('64%')).toBeTruthy();
		expect(screen.getByText('실행 제안 묶음')).toBeTruthy();
		expect(screen.getAllByText(/FAQ 등록/).length).toBeGreaterThan(0);
		expect(screen.getAllByRole('button', { name: 'Q&A 분석 열기' }).length).toBeGreaterThan(0);
		expect(screen.getByRole('button', { name: '관련 실행 큐 보기' })).toBeTruthy();

		await clickWithAct(screen.getByRole('button', { name: '관련 실행 큐 보기' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain('/analytics/ai/actions?action_bucket=FAQ_CONTENT_IMPROVEMENT');
		});

		await clickWithAct(screen.getByRole('button', { name: 'Q&A 실행 큐로 보내기' }));

		await waitFor(() => {
			expect(mockedAxios.post).toHaveBeenCalledWith(
				'http://localhost:5189/ai/ops/actions',
				expect.objectContaining({
					source_scope: 'ai-ops-qna',
					entity_id: 'SKU-QNA-1',
				}),
			);
		});
		expect(await screen.findByText(/문의 장벽 상품 액션을 실행 큐에 적재했습니다/)).toBeTruthy();
	});

	it('수요·트렌드 판단 화면은 키워드 인사이트 응답으로 시나리오를 계산하고 후속 단계로 연결한다', async () => {
		mockedAxios.get.mockImplementation((url: string, config?: any) => {
			const u = String(url || '');
			if (u.includes('/research/keyword-insights')) {
				return Promise.resolve({
					data: {
						keyword: String(config?.params?.keyword || '헤어에센스'),
						date_from: '2026-03-01',
						date_to: '2026-03-30',
						cached: false,
						keywordSummary: {
							pcSearch: 12000,
							mobileSearch: 42000,
							totalSearch: 54000,
							productCount: 1200,
							posts: 180,
							pcCtr: 1.7,
							mobileCtr: 2.4,
							avgCtr: 2.1,
							searchedAt: '2026-04-12T10:00:00.000Z',
						},
						trend: {
							points: [],
							estimatedDailySearches: {
								baselineDays: 30,
								baselineFrom: '2026-03-01',
								baselineTo: '2026-03-30',
								monthlyTotal: 54000,
								points: [
									{ date: '2026-03-01', searches: 1200 },
									{ date: '2026-03-15', searches: 1700 },
									{ date: '2026-03-30', searches: 2200 },
								],
							},
						},
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						relatedKeywords: [
							{ relKeyword: '헤어에센스 추천', totalSearchQcCnt: 12000, avgCtr: 2.3 },
							{ relKeyword: '손상모 에센스', totalSearchQcCnt: 8000, avgCtr: 1.9 },
						],
						shopping: {
							category: '50000002',
							productCount: 1200,
							categoryPath: '화장품/미용 > 헤어케어',
						},
					},
				});
			}
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAiOpsView(
			<LocationProbe>
				<AiOpsTrendsView apiBaseUrl="http://localhost:5189" />
			</LocationProbe>,
			['/analytics/ai/trends'],
		);

		expect(await screen.findByText('트렌드 스냅샷')).toBeTruthy();
		expect(screen.getByDisplayValue('헤어에센스')).toBeTruthy();
		expect(screen.getByText('54,000')).toBeTruthy();
		expect(screen.getByText('2,200')).toBeTruthy();
		expect(screen.getByText(/증가율 83%/)).toBeTruthy();
		expect(screen.getByText(/현재 수요 판단/)).toBeTruthy();
		expect(screen.getByText(/확장 시나리오/)).toBeTruthy();
		expect(screen.getByText(/실행 버킷 예산 증액/)).toBeTruthy();
		expect(screen.getByText(/헤어에센스 추천/)).toBeTruthy();

		await clickWithAct(screen.getAllByRole('button', { name: '키워드 인사이트 열기' })[0]!);
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toContain(
				'/analytics/rank/insights?keyword=%ED%97%A4%EC%96%B4%EC%97%90%EC%84%BC%EC%8A%A4&from_date=2026-03-01&to_date=2026-03-30&auto_run=1',
			);
		});
	});
});
