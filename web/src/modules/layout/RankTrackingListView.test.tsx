import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RankTrackingListView, trackedProductsToJson, computeKeywordPopoverStyle, type TrackedProductListItem } from './RankTrackingListView';

const sampleProducts: TrackedProductListItem[] = [
	{
		id: 'p1',
		name: '새치 헤나 염색약 유기농 비건 천연 염색약 가루 1개',
		price: 14000,
		reviewCount: 31810,
		rating: 4.68,
		imageUrl: null,
		keywords: [
			{ keyword: '새치염색', rank: 14, delta: -6 },
			{ keyword: '천연염색', rank: 1, delta: 0 },
			{ keyword: '염색약', rank: 10, delta: -2 },
			{ keyword: '새치염색약', rank: 10, delta: 0 },
			{ keyword: '헤나', rank: 1, delta: 0 },
			{ keyword: '새치', rank: 15, delta: 0 },
		],
	},
];

describe('RankTrackingListView', () => {
	it('trackedProductsToJson은 product_url(id) 목록을 dedupe하여 urls JSON을 만든다', () => {
		const json = trackedProductsToJson([
			{ id: ' https://smartstore.naver.com/a/products/1 ', name: 'A', keywords: [] },
			{ id: 'https://smartstore.naver.com/a/products/1', name: 'A2', keywords: [] },
			{ id: 'https://smartstore.naver.com/b/products/2#x', name: 'B', keywords: [] },
		]);
		expect(json).toContain('"urls"');
		expect(json).toContain('https://smartstore.naver.com/a/products/1');
		expect(json).toContain('https://smartstore.naver.com/b/products/2');
		// hash 제거 확인
		expect(json).not.toContain('#x');
	});

	it('상단 URL 입력 폼에서 상품 추가를 호출한다', () => {
		const handleAdd = vi.fn();
		const handleSelect = vi.fn();
		const handleDelete = vi.fn();

		render(
			<RankTrackingListView
				channel="naver"
				products={sampleProducts}
				onAddProduct={handleAdd}
				onSelectProduct={handleSelect}
				onDeleteProduct={handleDelete}
			/>,
		);

		const input = screen.getByPlaceholderText('스마트스토어 상품 URL을 입력하세요');
		fireEvent.change(input, { target: { value: 'https://smartstore.naver.com/item/1' } });

		const button = screen.getByRole('button', { name: '상품 추가' });
		fireEvent.click(button);

		expect(handleAdd).toHaveBeenCalledWith('https://smartstore.naver.com/item/1');
	});

	it('상품 카드를 클릭하면 상세 선택 콜백을 호출한다', () => {
		const handleAdd = vi.fn();
		const handleSelect = vi.fn();
		const handleDelete = vi.fn();

		render(
			<RankTrackingListView
				channel="naver"
				products={sampleProducts}
				onAddProduct={handleAdd}
				onSelectProduct={handleSelect}
				onDeleteProduct={handleDelete}
			/>,
		);

		const card = screen.getByText(sampleProducts[0]!.name);
		fireEvent.click(card);

		expect(handleSelect).toHaveBeenCalledWith('p1');
	});

	it('전체보기 팝오버는 화면 아래로 넘치면 위로 뒤집어 배치한다', () => {
		const rect = { top: 920, bottom: 940, left: 100, right: 160, width: 60, height: 20 };
		const { style, placement } = computeKeywordPopoverStyle({
			anchorRect: rect as any,
			viewportWidth: 1280,
			viewportHeight: 960,
			maxHeight: 360,
			padding: 8,
			gap: 2,
		});
		expect(placement).toBe('top');
		// top 배치에서는 bottom 기준으로 붙여서 계산한다(간격 과다 문제 방지)
		expect(typeof style.bottom).toBe('number');
		expect((style.bottom as number) > 0).toBeTruthy();
		// CSS top(110%) 같은 값이 남아있어도 inline에서 auto로 무력화되어야 한다
		expect(style.top).toBe('auto');
	});

	it('화면 하단 영역(리스트 하단)에서는 여유가 있어도 위로 뜬다', () => {
		const rect = { top: 700, bottom: 720, left: 100, right: 160, width: 60, height: 20 };
		const { placement } = computeKeywordPopoverStyle({
			anchorRect: rect as any,
			viewportWidth: 1280,
			viewportHeight: 960,
			// 아래로 펼쳐도 충분히 안 넘치지만,
			maxHeight: 180,
			padding: 8,
			gap: 2,
			preferTopIfAnchorBelowRatio: 0.55,
		});
		expect(placement).toBe('top');
	});

	// (정리) 'URL JSON 다운로드' / '실행 명령 복사'는 디버그/보조 기능이라 UI에서 제거됨
});


