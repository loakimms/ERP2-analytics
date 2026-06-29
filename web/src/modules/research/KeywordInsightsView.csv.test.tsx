import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';

import {
	clickWithAct,
	flushKeywordInsightsEffects,
	mockedAxios,
	registerKeywordInsightsTestLifecycle,
	renderKeywordInsightsView,
} from './KeywordInsightsView.testUtils';
import { KeywordInsightsView } from './KeywordInsightsView';

describe('KeywordInsightsView CSV download', () => {
	registerKeywordInsightsTestLifecycle();

	it('엑셀 다운로드(CSV)는 UTF-8 BOM을 포함해 한글이 깨지지 않게 한다', async () => {
		if (!(URL as any).createObjectURL) (URL as any).createObjectURL = () => 'blob:mock';
		if (!(URL as any).revokeObjectURL) (URL as any).revokeObjectURL = () => {};

		const createUrlSpy = vi.spyOn(URL as any, 'createObjectURL').mockReturnValue('blob:mock');
		const revokeSpy = vi.spyOn(URL as any, 'revokeObjectURL').mockImplementation(() => {});
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

		let capturedBlob: Blob | null = null;
		createUrlSpy.mockImplementation((b: any) => {
			capturedBlob = b as any;
			return 'blob:mock';
		});

		mockedAxios.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/research/keyword-insights')) {
				return Promise.resolve({
					data: {
						keyword: '헤나',
						date_from: '2026-01-01',
						date_to: '2026-01-02',
						cached: false,
						searchedAt: '2026-01-24T00:41:42.784Z',
						keywordSummary: null,
						trend: { points: [], estimatedDailySearches: null },
						distributions: { gender: [], age: [], device: [], dayOfWeek: [] },
						shopping: { category: null, productCount: 0, categoryPath: null },
						relatedKeywords: [
							{
								relKeyword: '헤어에센스',
								monthlyPcQcCnt: 5100,
								monthlyMobileQcCnt: 36300,
								totalSearchQcCnt: 41400,
								monthlyAvePcClkCnt: 18.5,
								totalAdClkCnt: 278.5,
								compIdx: '높음',
								searchedAt: '2026-01-24T00:41:42.784Z',
							},
						],
					},
				});
			}
			return Promise.resolve({ data: {} });
		});

		await renderKeywordInsightsView(<KeywordInsightsView apiBaseUrl="http://localhost:5189" />);

		await clickWithAct(screen.getByRole('button', { name: '조회' }));
		await flushKeywordInsightsEffects();

		const dlBtn = await screen.findByRole('button', { name: '엑셀 다운로드(CSV)' });
		await vi.waitFor(() => {
			expect(dlBtn).not.toBeDisabled();
		});

		await clickWithAct(dlBtn);

		expect(capturedBlob).toBeTruthy();
		const readAsArrayBuffer = async (b: any): Promise<ArrayBuffer> => {
			if (b && typeof b.arrayBuffer === 'function') return await b.arrayBuffer();
			return await new Promise<ArrayBuffer>((resolve, reject) => {
				const r = new FileReader();
				r.onerror = () => reject(r.error);
				r.onload = () => resolve(r.result as ArrayBuffer);
				r.readAsArrayBuffer(b);
			});
		};
		const ab = await readAsArrayBuffer(capturedBlob as any);
		const u8 = new Uint8Array(ab);
		expect(u8[0]).toBe(0xef);
		expect(u8[1]).toBe(0xbb);
		expect(u8[2]).toBe(0xbf);
		const text = new TextDecoder('utf-8').decode(u8);
		expect(text).toContain('키워드');
		expect(text).toContain('쇼핑성/정보성');

		createUrlSpy.mockRestore();
		revokeSpy.mockRestore();
		clickSpy.mockRestore();
	});
});
