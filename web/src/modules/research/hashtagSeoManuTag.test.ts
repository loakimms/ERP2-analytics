import { describe, it, expect } from 'vitest';
import {
	aggregateMatchedTags,
	matchTopProductsToManuTags,
	parseManuTagText,
	normalizeProductName,
} from './hashtagSeoManuTag';

describe('hashtagSeoManuTag.normalizeProductName', () => {
	it('공백/기호/대소문자 차이를 제거해 매칭 키를 만든다', () => {
		expect(normalizeProductName('  새치 헤나 염색약 (1개)  ')).toBe(normalizeProductName('새치-헤나염색약 1개'));
	});
});

describe('hashtagSeoManuTag.parseManuTagText', () => {
	it('JSON에서 productName/manuTag를 추출한다', () => {
		const sample = JSON.stringify({
			searchAdResult: {
				products: [
					{ productName: '상품A', manuTag: '오늘출발,무료반품' },
					{ productName: '상품B', manuTag: '' },
				],
			},
		});
		const r = parseManuTagText(sample);
		expect(r.errors).toEqual([]);
		const names = r.products.map((p) => p.productName);
		expect(names).toContain('상품A');
		const a = r.products.find((p) => p.productName === '상품A')!;
		expect(a.tags).toEqual(['오늘출발', '무료반품']);
	});
});

describe('hashtagSeoManuTag.matchTopProductsToManuTags', () => {
	it('Top 상품 타이틀을 manuTag 상품명과 매칭해 태그를 부여한다', () => {
		const manu = [
			{ productName: '새치 헤나 염색약 유기농 비건', tags: ['저자극염색약', '손상없는'] },
		];
		const top = [{ rank: 1, title: '새치-헤나 염색약 유기농 비건', link: null }];
		const rows = matchTopProductsToManuTags({ topProducts: top, manuProducts: manu, minScore: 0.5 });
		expect(rows[0]!.matched).toBe(true);
		expect(rows[0]!.tags).toEqual(['저자극염색약', '손상없는']);
	});
});

describe('hashtagSeoManuTag.aggregateMatchedTags', () => {
	it('매칭된 상품들에서 태그를 집계한다', () => {
		const stats = aggregateMatchedTags([
			{ rank: 1, title: 'A', matched: true, tags: ['t1', 't2'], matchScore: 1 },
			{ rank: 2, title: 'B', matched: true, tags: ['t1'], matchScore: 1 },
			{ rank: 3, title: 'C', matched: false, tags: ['t1'], matchScore: 0 },
		] as any);
		expect(stats.find((s) => s.tag === 't1')?.count).toBe(2);
	});
});

