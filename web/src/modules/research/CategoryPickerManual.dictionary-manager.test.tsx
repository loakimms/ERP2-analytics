import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { mockedAxios, registerCategoryPickerManualTestLifecycle, renderCategoryPickerManual } from './CategoryPickerManual.testUtils';
import { CategoryPickerManual } from './CategoryPickerManual';

describe('CategoryPickerManual dictionary manager', () => {
	registerCategoryPickerManualTestLifecycle();

	it('설정(카테고리 사전) 화면에서 카테고리 목록을 키워드로 필터링해 출력한다', async () => {
		mockedAxios.get.mockResolvedValue({
			data: {
				items: [
					{ id: '50000000', path: '화장품/미용>헤어스타일링>염색약', saved_at: '2026-01-01T00:00:00.000Z', source_filename: 'category_a.csv' },
					{ id: '50000001', path: '가구/인테리어>DIY자재/용품>바닥재>장판', saved_at: '2026-01-02T00:00:00.000Z', source_filename: 'category_a.csv' },
					{ id: '50000002', path: '가구/인테리어>DIY자재/용품>벽지>뮤럴벽지', saved_at: '2026-01-03T00:00:00.000Z', source_filename: 'category_b.csv' },
				],
				total: 3,
				active_batch_id: 'batch-b',
				latest_upload: {
					filename: 'category_b.csv',
					parsed_rows: 1,
					saved_at: '2026-01-03T00:00:00.000Z',
				},
				files: [
					{ batch_id: 'batch-a', filename: 'category_a.csv', parsed_rows: 2, uploaded_at: '2026-01-02T00:00:00.000Z', applied_at: null, is_active: false },
					{ batch_id: 'batch-b', filename: 'category_b.csv', parsed_rows: 1, uploaded_at: '2026-01-03T00:00:00.000Z', applied_at: '2026-01-03T00:00:00.000Z', is_active: true },
				],
			},
		});

		renderCategoryPickerManual(
			<CategoryPickerManual
				apiBaseUrl="http://localhost:5189"
				value={null}
				onChange={() => {}}
				showSearchTab={false}
				showPickTab={false}
				showDictionaryManager
				showDictionaryStatusList
				importMode="manual"
			/>,
		);

		expect(await screen.findByText(/마지막 저장:/)).toBeTruthy();
		expect(screen.getByText('현재 등록 현황')).toBeTruthy();
		expect(screen.getByText('업로드 파일명')).toBeTruthy();
		expect(screen.getByText('업로드 일자')).toBeTruthy();
		expect(screen.getAllByText('category_a.csv').length).toBeGreaterThan(0);
		fireEvent.change(screen.getByLabelText('카테고리 검색(키워드 포함)'), { target: { value: '염색' } });
		expect(screen.getByText('50000000')).toBeTruthy();
		expect(screen.queryByText('50000001')).toBeNull();
		expect(screen.queryByText('50000002')).toBeNull();
		expect(screen.getAllByRole('button', { name: '적용' }).length).toBeGreaterThan(0);
	});

	it('서버 DB 표에서 업로드 파일 적용과 삭제를 수행할 수 있다', async () => {
		const onChange = vi.fn();
		const getMock = mockedAxios.get as any;
		const postMock = mockedAxios.post as any;

		getMock
			.mockResolvedValueOnce({
				data: {
					items: [
						{ id: '50000000', path: '화장품/미용>헤어스타일링>염색약', saved_at: '2026-01-01T00:00:00.000Z', source_filename: 'category_a.csv' },
					],
					total: 1,
					active_batch_id: null,
					latest_upload: {
						filename: 'category_a.csv',
						parsed_rows: 1,
						saved_at: '2026-01-01T00:00:00.000Z',
					},
					files: [{ batch_id: 'batch-a', filename: 'category_a.csv', parsed_rows: 1, uploaded_at: '2026-01-01T00:00:00.000Z', applied_at: null, is_active: false }],
				},
			})
			.mockResolvedValueOnce({
				data: {
					items: [],
					total: 0,
					latest_upload: null,
					active_batch_id: 'batch-a',
					files: [{ batch_id: 'batch-a', filename: 'category_a.csv', parsed_rows: 1, uploaded_at: '2026-01-01T00:00:00.000Z', applied_at: '2026-01-01T00:00:00.000Z', is_active: true }],
				},
			})
			.mockResolvedValueOnce({
				data: {
					items: [],
					total: 0,
					latest_upload: null,
					active_batch_id: null,
					files: [],
				},
			});
		postMock
			.mockResolvedValueOnce({
				data: {
					batch_id: 'batch-a',
					filename: 'category_a.csv',
					total_active: 1,
					applied_at: '2026-01-01T00:00:00.000Z',
				},
			})
			.mockResolvedValueOnce({
				data: {
					deleted: 1,
					deleted_entries: 1,
					total_active: 0,
					active_batch_id: null,
				},
			});

		renderCategoryPickerManual(
			<CategoryPickerManual
				apiBaseUrl="http://localhost:5189"
				value={null}
				onChange={onChange}
				showSearchTab={false}
				showPickTab={false}
				showDictionaryManager
				showDictionaryStatusList
				importMode="manual"
			/>,
		);

		expect(await screen.findByText('category_a.csv')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: '적용' }));
		await waitFor(() => {
			expect(postMock).toHaveBeenCalledWith('http://localhost:5189/seo/category-dictionary/apply', {
				batch_id: 'batch-a',
			});
		});

		fireEvent.click(screen.getByRole('button', { name: '삭제' }));
		await waitFor(() => {
			expect(postMock).toHaveBeenCalledWith('http://localhost:5189/seo/category-dictionary/delete', {
				batch_id: 'batch-a',
			});
		});
		await waitFor(() => {
			expect(getMock).toHaveBeenCalledTimes(3);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it('수동 업로드 저장은 서버 import 호출 후 서버 목록을 다시 불러온다', async () => {
		const csv = ['id,lv1,lv2,lv3', '50000002,화장품/미용,헤어스타일링,염색약'].join('\n');
		const file = new File([csv], 'category_test.csv', { type: 'text/csv' });
		Object.defineProperty(file, 'arrayBuffer', {
			value: async () => new TextEncoder().encode(csv).buffer,
		});
		const getMock = mockedAxios.get as any;
		const postMock = mockedAxios.post as any;

		getMock
			.mockResolvedValueOnce({
				data: { items: [], total: 0, latest_upload: null, active_batch_id: null, files: [] },
			})
			.mockResolvedValueOnce({
				data: {
					items: [
						{ id: '50000002', path: '화장품/미용>헤어스타일링>염색약', saved_at: '2026-01-24T04:12:30.000Z', source_filename: 'category_test.csv' },
					],
					total: 1,
					active_batch_id: 'batch-test',
					latest_upload: {
						filename: 'category_test.csv',
						parsed_rows: 1,
						saved_at: '2026-01-24T04:12:30.000Z',
					},
					files: [{ batch_id: 'batch-test', filename: 'category_test.csv', parsed_rows: 1, uploaded_at: '2026-01-24T04:12:30.000Z', applied_at: '2026-01-24T04:12:30.000Z', is_active: true }],
				},
			});
		postMock.mockResolvedValue({
			data: {
				parsed: 1,
				inserted: 1,
				skipped: 0,
				total_active: 1,
				saved_at: '2026-01-24T04:12:30.000Z',
				filename: 'category_test.csv',
				batch_id: 'batch-test',
			},
		});

		renderCategoryPickerManual(
			<CategoryPickerManual
				apiBaseUrl="http://localhost:5189"
				value={null}
				onChange={() => {}}
				showSearchTab={false}
				showPickTab={false}
				showDictionaryManager
				showDictionaryStatusList
				importMode="manual"
			/>,
		);

		await waitFor(() => {
			expect(getMock).toHaveBeenCalledWith('http://localhost:5189/seo/category-dictionary');
		});

		fireEvent.change(screen.getByLabelText('카테고리 CSV'), {
			target: { files: [file] },
		});
		await waitFor(() => {
			expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
		});

		fireEvent.click(screen.getByRole('button', { name: '저장' }));

		await waitFor(() => {
			expect(postMock).toHaveBeenCalledWith('http://localhost:5189/seo/category-dictionary/import', {
				filename: 'category_test.csv',
				items: [{ id: '50000002', path: '화장품/미용>헤어스타일링>염색약' }],
			});
		});
		await waitFor(() => {
			expect(getMock).toHaveBeenCalledTimes(2);
		});

		expect(await screen.findByText('category_test.csv')).toBeTruthy();
		expect(screen.getAllByText(/category_test\.csv/).length).toBeGreaterThan(0);
	});
});
