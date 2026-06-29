import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
	clickWithAct,
	getFetchMock,
	mockedAxios,
	registerMenuSyncTestLifecycle,
	renderMenuSyncView,
} from './MenuSyncView.testUtils';

describe('MenuSyncView browser sync', () => {
	registerMenuSyncTestLifecycle();

	it('활성 메뉴 목록을 렌더링하고 비활성 메뉴는 체크할 수 없다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [
					{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' },
					{ id: 'sales', label: '판매 분석', description: '준비 중', status: 'planned' },
				],
			},
		});

		await renderMenuSyncView();

		expect(await screen.findByText('메뉴동기화')).toBeTruthy();
		expect(screen.getByLabelText('리뷰 Q&A')).toBeTruthy();
		expect(screen.getByLabelText('판매 분석')).toBeDisabled();
	});

	it('선택한 메뉴로 번들 생성을 요청하고 생성 결과를 보여준다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' }],
			},
		});
		getFetchMock()
			.mockResolvedValueOnce({
				ok: true,
				blob: vi.fn().mockResolvedValue(new Blob(['zip-bytes'], { type: 'application/zip' })),
				headers: {
					get: (name: string) =>
						name.toLowerCase() === 'content-disposition'
							? 'attachment; filename="menu_sync_review_qna.zip"'
							: null,
				},
			})
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					ok: true,
					action: 'menu-sync-export',
					bundlePath: 'D:\\dev\\ERP2-analytics\\artifacts\\menu-sync\\menu_sync_review_qna.zip',
				}),
			});

		await renderMenuSyncView();

		await screen.findByLabelText('리뷰 Q&A');
		await clickWithAct(screen.getByRole('button', { name: '동기화 번들 생성' }));

		await waitFor(() => {
			expect(getFetchMock().mock.calls.length).toBeGreaterThan(0);
		});
		const [url, init] = getFetchMock().mock.calls[0];
		expect(String(url)).toBe('/api/menu-sync/export');
		expect(JSON.parse(String(init.body))).toEqual({ menu_ids: ['review_qna'] });
		expect(screen.getByText(/최근 브라우저 다운로드 번들:/)).toBeTruthy();
		expect(screen.getAllByText(/menu_sync_review_qna\.zip/).length).toBeGreaterThan(0);
		expect(screen.getByText(/menu-sync-nas-push\.ps1/)).toBeTruthy();
		expect((screen.getByLabelText('호스트 import 번들 경로 또는 파일명') as HTMLInputElement).value).toBe(
			'D:\\dev\\ERP2-analytics\\artifacts\\menu-sync\\menu_sync_review_qna.zip',
		);
	});

	it('번들 파일을 선택하면 import 요청을 보내고 결과를 렌더링한다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' }],
			},
		});
		getFetchMock().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				ok: true,
				imported_tables: [
					{ table_name: 'commerce_qna_raw', row_count: 1, source_row_count: 1 },
					{ table_name: 'commerce_qna_draft', row_count: 1, source_row_count: 1 },
				],
			}),
		});

		await renderMenuSyncView();

		const fileInput = await screen.findByLabelText('동기화 번들 업로드');
		fireEvent.change(fileInput, {
			target: {
				files: [new File(['zip'], 'menu_sync_review_qna.zip', { type: 'application/zip' })],
			},
		});
		await clickWithAct(screen.getByRole('button', { name: '로컬 Import 실행' }));

		await waitFor(() => {
			expect(getFetchMock().mock.calls.length).toBeGreaterThan(0);
		});
		const [, importInit] = getFetchMock().mock.calls[0];
		expect(String(importInit.method)).toBe('POST');
		expect(importInit.body).toBeInstanceOf(FormData);
		expect(await screen.findByText(/commerce_qna_raw 추가 1건 \/ 번들 1건/)).toBeTruthy();
	});

	it('로컬 import가 413을 반환하면 읽기 쉬운 안내 메시지를 보여준다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'review_reply', label: '리뷰 관리', description: '리뷰 전체 테이블', status: 'active' }],
			},
		});
		getFetchMock().mockResolvedValue({
			ok: false,
			status: 413,
			text: vi
				.fn()
				.mockResolvedValue('<html><head><title>413 Request Entity Too Large</title></head><body>nginx</body></html>'),
		});

		await renderMenuSyncView();

		const fileInput = await screen.findByLabelText('동기화 번들 업로드');
		fireEvent.change(fileInput, {
			target: {
				files: [new File(['zip'], 'menu_sync_review_reply.zip', { type: 'application/zip' })],
			},
		});
		await clickWithAct(screen.getByRole('button', { name: '로컬 Import 실행' }));

		expect(await screen.findByText(/업로드한 번들이 서버 업로드 제한을 초과했습니다/)).toBeTruthy();
	});

	it('로컬 import가 추가 0건이어도 번들 총 건수를 함께 보여준다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'product_tracking', label: '내 상품 추적', description: '추적 데이터 전체', status: 'active' }],
			},
		});
		getFetchMock().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				ok: true,
				imported_tables: [
					{ table_name: 'tracked_product_meta', row_count: 0, source_row_count: 130, file_name: 'menus/product_tracking/tracked_product_meta.json' },
				],
			}),
		});

		await renderMenuSyncView();

		const fileInput = await screen.findByLabelText('동기화 번들 업로드');
		fireEvent.change(fileInput, {
			target: {
				files: [new File(['zip'], 'menu_sync_product_tracking.zip', { type: 'application/zip' })],
			},
		});
		await clickWithAct(screen.getByRole('button', { name: '로컬 Import 실행' }));

		expect(await screen.findByText(/tracked_product_meta 추가 0건 \/ 번들 130건/)).toBeTruthy();
	});
});
