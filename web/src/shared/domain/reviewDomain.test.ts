import { describe, expect, it } from 'vitest';
import {
	buildReviewProductOverview,
	canonicalizeReviewProductUrl,
	extractReviewProductIdentity,
	normalizeReviewRatingFilterValue,
	replyCollectStatusClassName,
	replyStatusClassName,
	replyStatusDescription,
} from './reviewDomain';

describe('reviewDomain', () => {
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
});
