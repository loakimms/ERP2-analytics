import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AdsCreativesTable } from './AdsCreativesTable';
import { createCreativeRow } from './AdsCreativesTable.testUtils';

describe('AdsCreativesTable organic rank', () => {
	it('쇼핑 소재 모드에서는 평균노출순위 옆에 오가닉순위 헤더/값을 표시한다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				adgroupName: '#01_02_헤나염색약',
				adType: 'SHOPPING_PRODUCT_AD',
				creativeName: '',
				productTitle: '헤나 염색약 1팩',
				imageUrl: 'http://img.test/p.png',
				organicKeyword: '헤나염색약',
				organicRank: 12,
				prevOrganicRank: 15,
				organicRankSource: 'tracked_excel',
			}),
		];

		render(<AdsCreativesTable title="t" rows={rows} mode="shopping" />);
		expect(screen.getByText('오가닉순위')).toBeTruthy();
		expect(screen.getByText('12')).toBeTruthy();
		expect(screen.getByText(/▲/)).toBeTruthy();
	});

	it('오가닉순위 툴팁에 실패 단계(제품/키워드/순위)를 표시한다', () => {
		const rows = [
			createCreativeRow({
				key: 'k1',
				adgroupName: '#01_02_헤나염색약',
				creativeId: 'nad-a001-02-1',
				adType: 'SHOPPING_PRODUCT_AD',
				creativeName: '',
				productTitle: '헤나 염색약 1팩',
				imageUrl: 'http://img.test/p.png',
				organicKeyword: '헤나염색약',
				organicRank: null,
				organicRankSource: null,
				matchStatus: 'unmatched',
				matchedProductUrl: null,
			}),
			createCreativeRow({
				key: 'k2',
				adgroupName: '#01_02_헤나염색약',
				creativeId: 'nad-a001-02-2',
				adType: 'SHOPPING_PRODUCT_AD',
				creativeName: '',
				productTitle: '헤나 염색약 1팩',
				imageUrl: 'http://img.test/p.png',
				organicKeyword: null,
				organicRank: null,
				organicRankSource: null,
				matchStatus: 'matched',
				matchedProductUrl: 'http://p.test',
			}),
		];

		render(<AdsCreativesTable title="t" rows={rows} mode="shopping" />);
		expect(screen.getByTitle(/제품 매칭 실패/)).toBeTruthy();
		expect(screen.getByTitle(/키워드 추출 실패/)).toBeTruthy();
	});
});
