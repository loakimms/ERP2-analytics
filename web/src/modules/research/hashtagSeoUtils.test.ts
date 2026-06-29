import { describe, expect, it } from 'vitest';
import { buildFinalOkTagList, formatTagWithHash } from './hashtagSeoUtils';

describe('hashtagSeoUtils', () => {
	it('formatTagWithHash는 #을 보장한다', () => {
		expect(formatTagWithHash('비건')).toBe('#비건');
		expect(formatTagWithHash('#천연')).toBe('#천연');
		expect(formatTagWithHash('')).toBe('');
	});

	it('buildFinalOkTagList는 okTags를 #태그 배열로 만든다', () => {
		const list = buildFinalOkTagList(
			{
				keyword: '헤나',
				productCount: 1,
				products: [],
				summary: {
					okTags: [{ tag: '비건', count: 3 }, { tag: '#천연', count: 2 }],
					filteredTags: [],
				},
			},
			10,
		);
		expect(list).toEqual(['#비건', '#천연']);
	});
});


