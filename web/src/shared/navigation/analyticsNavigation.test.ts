import { describe, expect, it } from 'vitest';
import {
	buildAiOpsPathWithActionBucket,
	buildAiOpsSourceEvidencePath,
	buildKeywordInsightsPath,
	buildPurchaseKeywordsPath,
	buildQnaAnalysisPath,
	buildQnaManagementPath,
	buildReviewAnalysisPath,
	buildReviewManagementPath,
	readInitialKeywordInsightsNavigationQuery,
	readInitialPurchaseKeywordsNavigationQuery,
	readInitialQnaAnalysisNavigationQuery,
	readInitialQnaManagementNavigationQuery,
	readInitialReviewAnalysisNavigationQuery,
	readInitialReviewManagementNavigationQuery,
	selectedActionBucketFromSearch,
} from './analyticsNavigation';

describe('analyticsNavigation', () => {
	it('Q&A 분석에서 관리 화면 deep link를 만든다', () => {
		expect(
			buildQnaManagementPath({
				qnaKind: 'product',
				search: '테스트',
				fromYmd: '2026-04-01',
				toYmd: '2026-04-07',
				productName: '샴푸',
				category: '불만',
				issueTag: '냄새',
				responseState: 'rejected',
			}),
		).toBe(
			'/analytics/reviews/qna?qna_kind=product&from_date=2026-04-01&to_date=2026-04-07&search=%ED%85%8C%EC%8A%A4%ED%8A%B8+%EC%83%B4%ED%91%B8+%EB%B6%88%EB%A7%8C&issue_tag=%EB%83%84%EC%83%88&response_state=rejected',
		);
	});

	it('Q&A 관리에서 분석 화면 deep link를 만들고 issue_tag에 따라 section을 정한다', () => {
		expect(
			buildQnaAnalysisPath({
				qnaKind: 'all',
				search: '테스트',
				fromYmd: '2026-04-01',
				toYmd: '2026-04-07',
				issueTag: '색상',
				responseState: 'generated',
			}),
		).toBe(
			'/analytics/reviews/qna-analysis?qna_kind=all&from_date=2026-04-01&to_date=2026-04-07&response_state=generated&search=%ED%85%8C%EC%8A%A4%ED%8A%B8&issue_tag=%EC%83%89%EC%83%81&section=quality',
		);
	});

	it('Q&A 분석 초기 컨텍스트를 복원한다', () => {
		expect(
			readInitialQnaAnalysisNavigationQuery(
				'?qna_kind=product&search=%ED%85%8C%EC%8A%A4%ED%8A%B8&from_date=2026-04-01&to_date=2026-04-07&issue_tag=%EC%83%89%EC%83%81&section=quality&response_state=rejected',
				{ fromYmd: '2026-03-01', toYmd: '2026-03-07' },
			),
		).toEqual({
			qnaKind: 'product',
			search: '테스트',
			fromYmd: '2026-04-01',
			toYmd: '2026-04-07',
			issueTag: '색상',
			section: 'quality',
			responseState: 'rejected',
			hasResponseStateContext: true,
		});
	});

	it('Q&A 관리 초기 컨텍스트를 복원한다', () => {
		expect(
			readInitialQnaManagementNavigationQuery(
				'?qna_kind=customer&search=%ED%85%8C%EC%8A%A4%ED%8A%B8&from_date=2026-04-01&to_date=2026-04-07&issue_tag=%EB%83%84%EC%83%88&response_state=approved',
				{ fromYmd: '2026-03-01', toYmd: '2026-03-07' },
			),
		).toEqual({
			qnaKind: 'customer',
			search: '테스트',
			fromYmd: '2026-04-01',
			toYmd: '2026-04-07',
			issueTag: '냄새',
			responseState: 'approved',
		});
	});

	it('리뷰 분석/관리 경로를 현재 pathname 기준 sibling 경로로 만든다', () => {
		expect(
			buildReviewManagementPath('/analytics/reviews/review-analysis', {
				fromYmd: '2026-04-01',
				toYmd: '2026-04-07',
				productUrl: 'https://smartstore.naver.com/testmall/products/1',
			}),
		).toBe(
			'/analytics/reviews/review-management?from_date=2026-04-01&to_date=2026-04-07&product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1',
		);
		expect(
			buildReviewAnalysisPath('/analytics/reviews/review-management', {
				fromYmd: '2026-04-01',
				toYmd: '2026-04-07',
				productUrl: 'https://smartstore.naver.com/testmall/products/1',
			}),
		).toBe(
			'/analytics/reviews/review-analysis?product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1&from_date=2026-04-01&to_date=2026-04-07',
		);
	});

	it('리뷰 분석/관리 초기 컨텍스트를 복원한다', () => {
		expect(
			readInitialReviewAnalysisNavigationQuery(
				'?from_date=2026-04-01&to_date=2026-04-07&product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1',
				{ fromYmd: '2026-03-01', toYmd: '2026-03-07' },
			),
		).toEqual({
			fromYmd: '2026-04-01',
			toYmd: '2026-04-07',
			productUrl: 'https://smartstore.naver.com/testmall/products/1',
		});
		expect(
			readInitialReviewManagementNavigationQuery(
				'?from_date=2026-04-01&to_date=2026-04-07&product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1001',
				{ from: '2026-03-01', to: '2026-03-07' },
			),
		).toEqual({
			productUrl: 'https://smartstore.naver.com/testmall/products/1001',
			dateFrom: '2026-04-01',
			dateTo: '2026-04-07',
		});
	});

	it('AI 운영 센터 action bucket 경로와 query 복원을 처리한다', () => {
		expect(buildAiOpsPathWithActionBucket('/analytics/ai/ads', 'budget_increase')).toBe('/analytics/ai/ads?action_bucket=BUDGET_INCREASE');
		expect(selectedActionBucketFromSearch('?action_bucket=budget_increase')).toBe('BUDGET_INCREASE');
	});

	it('AI 운영 홈 카드에서 버킷별 원천 분석 경로를 만든다', () => {
		expect(
			buildAiOpsSourceEvidencePath({
				productName: '상품A',
				actionBucket: 'FAQ_CONTENT_IMPROVEMENT',
				policyType: 'FAQ_CONTENT_IMPROVEMENT',
				topIssue: '구매 직전 FAQ 공백',
				recommendedAction: 'FAQ 보강',
				fromYmd: '2026-04-01',
				toYmd: '2026-04-07',
			}),
		).toEqual({
			label: 'Q&A 분석 열기',
			path: '/analytics/reviews/qna-analysis?qna_kind=product&from_date=2026-04-01&to_date=2026-04-07&response_state=all&search=%EC%83%81%ED%92%88A&section=items',
		});
		expect(
			buildAiOpsSourceEvidencePath({
				productUrl: 'https://smartstore.naver.com/testmall/products/1001',
				productName: '상품VOC',
				actionBucket: 'VOC_IMPROVEMENT',
				policyType: 'VOC_IMPROVEMENT_PRIORITY',
				topIssue: '리뷰 부정 비율 상승',
				recommendedAction: '리뷰 개선 우선',
				fromYmd: '2026-04-01',
				toYmd: '2026-04-07',
			}),
		).toEqual({
			label: '리뷰 분석 열기',
			path: '/analytics/reviews/review-analysis?product_url=https%3A%2F%2Fsmartstore.naver.com%2Ftestmall%2Fproducts%2F1001&from_date=2026-04-01&to_date=2026-04-07',
		});
		expect(
			buildAiOpsSourceEvidencePath({
				productName: '상품B',
				actionBucket: 'BUDGET_INCREASE',
				policyType: 'AD_GROWTH',
				topIssue: '광고 확장 기회',
				recommendedAction: '예산 증액 테스트',
				keyword: '확장키워드',
				fromYmd: '2026-04-01',
				toYmd: '2026-04-07',
			}),
		).toEqual({
			label: '구매 키워드 분석 열기',
			path: '/analytics/performance/purchase-keywords?product=%EC%83%81%ED%92%88B&keyword=%ED%99%95%EC%9E%A5%ED%82%A4%EC%9B%8C%EB%93%9C',
		});
	});

	it('키워드 인사이트 deep link를 만들고 초기 컨텍스트를 복원한다', () => {
		expect(
			buildKeywordInsightsPath({
				keyword: '헤어에센스',
				fromYmd: '2026-03-01',
				toYmd: '2026-03-30',
				autoRun: true,
			}),
		).toBe('/analytics/rank/insights?keyword=%ED%97%A4%EC%96%B4%EC%97%90%EC%84%BC%EC%8A%A4&from_date=2026-03-01&to_date=2026-03-30&auto_run=1');
		expect(
			readInitialKeywordInsightsNavigationQuery('?keyword=%ED%97%A4%EC%96%B4%EC%97%90%EC%84%BC%EC%8A%A4&from_date=2026-03-01&to_date=2026-03-30&auto_run=1', {
				keyword: '기본키워드',
				fromYmd: '2026-01-01',
				toYmd: '2026-01-31',
				autoRun: false,
			}),
		).toEqual({
			keyword: '헤어에센스',
			fromYmd: '2026-03-01',
			toYmd: '2026-03-30',
			autoRun: true,
		});
	});

	it('구매 키워드 분석 deep link를 만들고 초기 필터를 복원한다', () => {
		expect(
			buildPurchaseKeywordsPath({
				productName: '집중케어 트리트먼트',
				keyword: '손상모',
			}),
		).toBe('/analytics/performance/purchase-keywords?product=%EC%A7%91%EC%A4%91%EC%BC%80%EC%96%B4+%ED%8A%B8%EB%A6%AC%ED%8A%B8%EB%A8%BC%ED%8A%B8&keyword=%EC%86%90%EC%83%81%EB%AA%A8');
		expect(
			readInitialPurchaseKeywordsNavigationQuery(
				'?product=%EC%A7%91%EC%A4%91%EC%BC%80%EC%96%B4+%ED%8A%B8%EB%A6%AC%ED%8A%B8%EB%A8%BC%ED%8A%B8&keyword=%EC%86%90%EC%83%81%EB%AA%A8',
			),
		).toEqual({
			productName: '집중케어 트리트먼트',
			keyword: '손상모',
		});
	});
});
