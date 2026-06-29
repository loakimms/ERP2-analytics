import { describe, it, expect } from 'vitest';
import { deriveTrackedProductLabel } from './productLabel';

describe('deriveTrackedProductLabel', () => {
	it('metaTitle이 있으면 metaTitle을 우선 사용한다', () => {
		const label = deriveTrackedProductLabel({
			url: 'https://smartstore.naver.com/a/products/110',
			index1: 1,
			metaTitle: '메타 상품명',
			summaryTitle: '요약 상품명',
			metricsTitle: '메트릭 상품명',
		});
		expect(label).toBe('메타 상품명');
	});

	it('metaTitle이 없으면 summaryTitle을 사용한다', () => {
		const label = deriveTrackedProductLabel({
			url: 'https://smartstore.naver.com/a/products/110',
			index1: 2,
			metaTitle: null,
			summaryTitle: '요약 상품명',
			metricsTitle: '메트릭 상품명',
		});
		expect(label).toBe('요약 상품명');
	});

	it('metaTitle/summaryTitle이 없으면 metricsTitle을 사용한다', () => {
		const label = deriveTrackedProductLabel({
			url: 'https://smartstore.naver.com/a/products/110',
			index1: 3,
			metaTitle: '',
			summaryTitle: '',
			metricsTitle: '메트릭 상품명',
		});
		expect(label).toBe('메트릭 상품명');
	});

	it('모두 없으면 스마트스토어 productId 기반 라벨을 만든다', () => {
		const label = deriveTrackedProductLabel({
			url: 'https://smartstore.naver.com/thesujata/products/11043833896?x=1',
			index1: 4,
		});
		expect(label).toContain('11043833896');
	});

	it('summaryTitle이 비어 있으면 URL 기반 안전 라벨로 내려앉는다', () => {
		const label = deriveTrackedProductLabel({
			url: 'https://smartstore.naver.com/thesujata/products/12874366496',
			index1: 5,
			metaTitle: null,
			summaryTitle: null,
			metricsTitle: null,
		});
		expect(label).toBe('스마트스토어 상품 12874366496');
	});
});

