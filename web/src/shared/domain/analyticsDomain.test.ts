import { describe, expect, it } from 'vitest';
import {
	actionTextMatchesAiOpsBucket,
	aiOpsLogMatchesActionBucket,
	buildReviewProductOverview,
	canonicalizeReviewProductUrl,
	extractReviewProductIdentity,
	getAiOpsLogPrimaryActionBucket,
	inferAiOpsActionBucketFromTexts,
	isTransientPollingError,
	normalizeReviewRatingFilterValue,
	qnaStatusClassName,
	replyCollectStatusClassName,
	replyStatusClassName,
	replyStatusDescription,
	resolveQnaGuideSection,
} from './analyticsDomain';

describe('analyticsDomain', () => {
	it('Q&A 상태에 따라 CSS class를 결정한다', () => {
		expect(qnaStatusClassName('submitted')).toBe('is-completed');
		expect(qnaStatusClassName('approved')).toBe('is-approved');
		expect(qnaStatusClassName('generated')).toBe('is-pending');
		expect(qnaStatusClassName('rejected')).toBe('is-rejected');
		expect(qnaStatusClassName('unanswered')).toBe('is-new');
	});

	it('리뷰 답글 상태에 따라 class와 설명을 제공한다', () => {
		expect(replyStatusClassName('pending')).toBe('is-pending');
		expect(replyStatusClassName('approved')).toBe('is-approved');
		expect(replyStatusClassName('completed')).toBe('is-completed');
		expect(replyStatusClassName('rejected')).toBe('is-rejected');
		expect(replyStatusClassName('new')).toBe('is-new');
		expect(replyStatusDescription('enrichment_target')).toContain('보강 대상');
		expect(replyStatusDescription('pending')).toContain('검토대기');
		expect(replyStatusDescription('unknown')).toBe('현재 답글 작업 상태입니다.');
	});

	it('리뷰 수집 상태에 따라 class를 제공한다', () => {
		expect(replyCollectStatusClassName('done')).toBe('is-approved');
		expect(replyCollectStatusClassName('skipped')).toBe('is-completed');
		expect(replyCollectStatusClassName('failed')).toBe('is-rejected');
		expect(replyCollectStatusClassName('queued')).toBe('is-pending');
	});

	it('리뷰 평점 필터 값을 1~5 범위의 정수 문자열로 정규화한다', () => {
		expect(normalizeReviewRatingFilterValue(4.2)).toBe('4');
		expect(normalizeReviewRatingFilterValue('5')).toBe('5');
		expect(normalizeReviewRatingFilterValue(0)).toBeNull();
		expect(normalizeReviewRatingFilterValue(6)).toBeNull();
		expect(normalizeReviewRatingFilterValue('bad')).toBeNull();
	});

	it('일시적 polling 오류를 감지한다', () => {
		expect(isTransientPollingError({ code: 'ECONNABORTED' })).toBe(true);
		expect(isTransientPollingError({ code: 'err_network' })).toBe(true);
		expect(isTransientPollingError({ response: { status: 503 } })).toBe(true);
		expect(isTransientPollingError({ message: 'network timeout while polling' })).toBe(true);
		expect(isTransientPollingError({ response: { status: 400 }, message: 'validation failed' })).toBe(false);
	});

	it('리뷰 상품 URL을 정규화하고 상품 identity를 추출한다', () => {
		expect(canonicalizeReviewProductUrl('smartstore.naver.com/testmall/products/123?nl-query=abc')).toBe(
			'https://smartstore.naver.com/testmall/products/123',
		);
		expect(canonicalizeReviewProductUrl('smartstore-review-upload://product/123?sheet=1')).toBe(
			'smartstore-review-upload://product/123',
		);
		expect(extractReviewProductIdentity('smartstore-review-upload://product/123')).toBe('123');
		expect(extractReviewProductIdentity('https://smartstore.naver.com/testmall/products/123?x=1')).toBe('123');
	});

	it('리뷰 상품 overview를 동일 상품 기준으로 병합하고 실제 상품 URL을 우선한다', () => {
		const items = buildReviewProductOverview([
			{
				product_url: 'smartstore-review-upload://product/1',
				product_title: '상품 A',
				review_count: 2,
				average_rating: 5,
				positive_ratio: 100,
				negative_ratio: 0,
			},
			{
				product_url: 'https://smartstore.naver.com/testmall/products/1?nl-query=abc',
				product_title: '상품 A',
				review_count: 3,
				average_rating: 3,
				positive_ratio: 40,
				negative_ratio: 40,
			},
			{
				product_url: 'https://smartstore.naver.com/testmall/products/2',
				product_title: '상품 B',
				review_count: 1,
				average_rating: 4,
				positive_ratio: 50,
				negative_ratio: 0,
			},
		]);

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			product_url: 'https://smartstore.naver.com/testmall/products/1',
			product_title: '상품 A',
			review_count: 5,
		});
		expect(items[0]?.average_rating).toBeCloseTo(3.8, 5);
		expect(items[0]?.positive_ratio).toBeCloseTo(64, 5);
		expect(items[0]?.negative_ratio).toBeCloseTo(24, 5);
		expect(items[1]?.product_title).toBe('상품 B');
	});

	it('Q&A 가이드 문구에서 관련 섹션을 추론한다', () => {
		expect(resolveQnaGuideSection({ title: 'FAQ 먼저 보강', target_area: '상세페이지 FAQ' })).toBe('faq');
		expect(resolveQnaGuideSection({ title: '품질 이슈 점검', target_area: '상품 개선' })).toBe('quality');
		expect(resolveQnaGuideSection({ title: '광고 문구 개선', target_area: '마케팅' })).toBe('marketing');
		expect(resolveQnaGuideSection({ title: '랜딩 전환 최적화', target_area: '전환' })).toBe('conversion');
		expect(resolveQnaGuideSection({ title: '기타', target_area: '운영' })).toBe('summary');
	});

	it('AI 운영 버킷 텍스트 매칭과 추론을 처리한다', () => {
		expect(actionTextMatchesAiOpsBucket('예산 증액 테스트', 'BUDGET_INCREASE')).toBe(true);
		expect(actionTextMatchesAiOpsBucket('광고 과투입 점검 및 예산 축소 테스트', 'AD_OVERINVESTMENT')).toBe(true);
		expect(inferAiOpsActionBucketFromTexts(['FAQ 보강', '광고 확대 테스트'])).toBe('FAQ_CONTENT_IMPROVEMENT');
		expect(inferAiOpsActionBucketFromTexts(['리뷰 개선 우선'])).toBe('VOC_IMPROVEMENT');
	});

	it('AI 운영 로그에서 우선 버킷을 추론하고 매칭한다', () => {
		const item = {
			latest_action_payload: { title: 'FAQ 보강' },
			recommended_actions: ['광고 과투입 점검 및 예산 축소 테스트'],
			evidence: {},
		};
		expect(getAiOpsLogPrimaryActionBucket(item)).toBe('FAQ_CONTENT_IMPROVEMENT');
		expect(aiOpsLogMatchesActionBucket(item, 'FAQ_CONTENT_IMPROVEMENT')).toBe(true);
		expect(aiOpsLogMatchesActionBucket(item, 'AD_OVERINVESTMENT')).toBe(false);
	});

	it('광고 과투입 evidence만 있어도 버킷을 보존한다', () => {
		const item = {
			latest_action_payload: {},
			recommended_actions: [],
			evidence: {
				sales: {
					ad_overinvestment: {
						keyword: '과투입키워드',
					},
				},
			},
		};
		expect(getAiOpsLogPrimaryActionBucket(item)).toBe('AD_OVERINVESTMENT');
	});
});
