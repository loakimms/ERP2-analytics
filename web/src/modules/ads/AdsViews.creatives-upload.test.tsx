import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockedAxios, registerAdsViewsTestLifecycle, renderAdsRoutes } from './AdsViews.testUtils';

describe('AdsViews (creatives upload)', () => {
	registerAdsViewsTestLifecycle();

	it('소재 보고서 업로드 성공 시 "오가닉 반영"까지 완료 메시지를 표시한다', async () => {
		mockedAxios.post.mockResolvedValueOnce({
			data: {
				ok: true,
				filename: 'creatives.csv',
				dates: ['2026-01-16', '2026-01-17'],
				processed_dates: ['2026-01-16', '2026-01-17'],
				skipped_dates: [],
				inserted_total: 2,
				derived_recomputed_dates: ['2026-01-16', '2026-01-17'],
			},
		});

		render(renderAdsRoutes('/analytics/campaign/creatives'));

		fireEvent.click(screen.getByRole('button', { name: '소재 보고서 업로드' }));
		expect(screen.getByRole('dialog', { name: '소재 보고서 업로드' })).toBeTruthy();

		const input = screen.getByLabelText('소재 보고서 업로드').querySelector('input[type="file"]') as HTMLInputElement;
		expect(input).toBeTruthy();
		const f = new File(['x'], 'creatives.csv', { type: 'text/csv' });
		fireEvent.change(input, { target: { files: [f] } });

		fireEvent.click(screen.getByRole('button', { name: '업로드' }));

		await waitFor(() => {
			expect(screen.getByText(/오가닉 반영 2일/)).toBeTruthy();
		});
	});
});
