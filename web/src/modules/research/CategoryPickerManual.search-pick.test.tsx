import React from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { mockedAxios, registerCategoryPickerManualTestLifecycle, renderCategoryPickerManual } from './CategoryPickerManual.testUtils';
import { CategoryPickerManual } from './CategoryPickerManual';

describe('CategoryPickerManual search/pick', () => {
	registerCategoryPickerManualTestLifecycle();

	it('서버 카테고리 사전 목록을 불러와 자동완성 후보에 사용한다', async () => {
		mockedAxios.get.mockResolvedValue({
			data: {
				items: [
					{ id: '50000000', path: '화장품/미용>헤어스타일링>염색약', saved_at: '2026-01-01T00:00:00.000Z', source_filename: 'category_a.csv' },
					{ id: '50000001', path: '가구/인테리어>DIY자재/용품>가구부속품', saved_at: '2026-01-02T00:00:00.000Z', source_filename: 'category_b.csv' },
				],
				total: 2,
				active_batch_id: 'batch-b',
				latest_upload: {
					filename: 'category_b.csv',
					parsed_rows: 2,
					saved_at: '2026-01-02T00:00:00.000Z',
				},
				files: [{ batch_id: 'batch-b', filename: 'category_b.csv', parsed_rows: 2, uploaded_at: '2026-01-02T00:00:00.000Z', applied_at: '2026-01-02T00:00:00.000Z', is_active: true }],
			},
		});

		renderCategoryPickerManual(<CategoryPickerManual apiBaseUrl="http://localhost:5189" value={null} onChange={() => {}} />);

		await waitFor(() => {
			expect(mockedAxios.get).toHaveBeenCalledWith('http://localhost:5189/seo/category-dictionary');
		});

		expect(screen.getByText('카테고리명을 입력하면 자동완성 후보가 표시됩니다.')).toBeTruthy();
		expect(screen.queryByText('50000000')).toBeNull();
		fireEvent.change(screen.getByLabelText('카테고리 입력(자동완성)'), { target: { value: '염색' } });
		expect(screen.getByText('50000000')).toBeTruthy();
	});

	it('서버 카테고리 사전으로 트리 선택 탭을 구성할 수 있다', async () => {
		mockedAxios.get.mockResolvedValue({
			data: {
				items: [{ id: '50000000', path: '화장품/미용>헤어스타일링>염색약', saved_at: '2026-01-01T00:00:00.000Z', source_filename: 'category_a.csv' }],
				total: 1,
				latest_upload: null,
				active_batch_id: null,
				files: [],
			},
		});

		renderCategoryPickerManual(<CategoryPickerManual apiBaseUrl="http://localhost:5189" value={null} onChange={() => {}} showSearchTab={false} showPickTab />);

		await screen.findByRole('button', { name: '화장품 ›' });
		expect(screen.getByText('메인')).toBeTruthy();
		expect(screen.getByRole('button', { name: '화장품 ›' })).toBeTruthy();
	});
});
