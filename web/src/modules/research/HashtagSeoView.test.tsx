import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HashtagSeoView } from './HashtagSeoView';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
			post: vi.fn(),
		},
	};
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import axios from 'axios';

describe('HashtagSeoView - 5-2 조회 트리거', () => {
	beforeEach(() => {
		vi.useRealTimers();
		(axios as any).get.mockReset();
		(axios as any).post.mockReset();
	});

	it('키워드 입력 중에는 자동으로 API를 호출하지 않는다(조회 버튼/Enter 전까지)', async () => {
		render(<HashtagSeoView apiBaseUrl="http://localhost:5189" />);

		vi.useFakeTimers();
		fireEvent.change(screen.getByLabelText('키워드'), { target: { value: '헤' } });
		vi.advanceTimersByTime(1500);
		expect((axios as any).get).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText('키워드'), { target: { value: '헤나염색약' } });
		vi.advanceTimersByTime(1500);
		expect((axios as any).get).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('조회 버튼을 누르면 tags 모드에서 shopping-tags API를 호출한다', async () => {
		(axios as any).get.mockResolvedValueOnce({
			data: { keyword: '헤나', productCount: 0, products: [] },
		});

		render(<HashtagSeoView apiBaseUrl="http://localhost:5189" />);

		fireEvent.change(screen.getByLabelText('키워드'), { target: { value: '헤나' } });
		fireEvent.click(screen.getByRole('button', { name: '조회' }));

		await waitFor(() => expect((axios as any).get).toHaveBeenCalled());
		expect((axios as any).get).toHaveBeenCalledWith(
			'http://localhost:5189/research/seo/shopping-tags',
			expect.objectContaining({ params: { keyword: '헤나', limit: 40, scrape_products: 0 } }),
		);
	});

	it('Enter를 누르면 조회가 실행된다', async () => {
		(axios as any).get.mockResolvedValueOnce({
			data: { keyword: '헤나', productCount: 0, products: [] },
		});

		render(<HashtagSeoView apiBaseUrl="http://localhost:5189" />);

		const input = screen.getByLabelText('키워드');
		fireEvent.change(input, { target: { value: '헤나' } });
		fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

		await waitFor(() => expect((axios as any).get).toHaveBeenCalled());
		expect((axios as any).get).toHaveBeenCalledWith(
			'http://localhost:5189/research/seo/shopping-tags',
			expect.objectContaining({ params: { keyword: '헤나', limit: 40, scrape_products: 0 } }),
		);
	});

	it('Top 상품 수 변경만으로는 API를 호출하지 않는다', async () => {
		render(<HashtagSeoView apiBaseUrl="http://localhost:5189" />);

		fireEvent.change(screen.getByLabelText('키워드'), { target: { value: '헤나' } });
		expect((axios as any).get).not.toHaveBeenCalled();
	});
});


