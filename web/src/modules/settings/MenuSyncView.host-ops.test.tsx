import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import {
	changeWithAct,
	clickWithAct,
	getFetchMock,
	mockedAxios,
	registerMenuSyncTestLifecycle,
	renderMenuSyncView,
} from './MenuSyncView.testUtils';

function hostAgentVersionResponse() {
	return {
		ok: true,
		json: vi.fn().mockResolvedValue({
			ok: true,
			agentVersion: '2026.08.18-menu-sync-agent-repo-protocol',
			agentManageNo: '20260818-0097',
			installMode: 'repo',
			menuSyncSupported: true,
			capabilities: { menuSync: true },
		}),
	};
}

function oldStandaloneVersionResponse() {
	return {
		ok: true,
		json: vi.fn().mockResolvedValue({
			ok: true,
			agentVersion: '2026.08.15-old',
			agentManageNo: '20260815-0001',
			installMode: 'standalone',
			menuSyncSupported: false,
			capabilities: { menuSync: false },
		}),
	};
}

function latestStandaloneVersionResponse() {
	return {
		ok: true,
		json: vi.fn().mockResolvedValue({
			ok: true,
			agentVersion: '2026.08.18-menu-sync-agent-repo-protocol',
			agentManageNo: '20260818-0097',
			installMode: 'standalone',
			menuSyncSupported: false,
			capabilities: { menuSync: false },
		}),
	};
}

function findFetchCall(urlPart: string) {
	const call = getFetchMock().mock.calls.find((item: any[]) => String(item[0]).includes(urlPart));
	if (!call) throw new Error(`fetch call not found: ${urlPart}`);
	return call;
}

describe('MenuSyncView host ops', () => {
	registerMenuSyncTestLifecycle();

	it('생성된 번들로 호스트 NAS push 실행을 요청한다', async () => {
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
					get: () => 'attachment; filename="menu_sync_review_qna.zip"',
				},
			})
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					ok: true,
					action: 'menu-sync-export',
					bundlePath: 'D:\\dev\\ERP2-analytics\\artifacts\\menu-sync\\menu_sync_review_qna.zip',
				}),
			})
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					ok: true,
					action: 'menu-sync-push',
					bundlePath: 'D:\\dev\\ERP2-analytics\\artifacts\\menu-sync\\menu_sync_review_qna.zip',
					output: { raw: 'push-complete' },
					imported_tables: [{ table_name: 'commerce_qna_raw', row_count: 1172, source_row_count: 1172, file_name: 'menus/review_qna/raw.json' }],
					import_response: {
						imported_tables: [{ table_name: 'commerce_qna_analysis', row_count: 1172, source_row_count: 1172, file_name: 'menus/review_qna/analysis.json' }],
					},
				}),
			});

		await renderMenuSyncView();

		await screen.findByLabelText('리뷰 Q&A');
		await clickWithAct(screen.getByRole('button', { name: '동기화 번들 생성' }));
		await waitFor(() => {
			expect(getFetchMock().mock.calls.length).toBeGreaterThan(0);
		});

		await clickWithAct(screen.getByRole('button', { name: '호스트에서 NAS push 실행' }));

		await waitFor(() => {
			expect(getFetchMock().mock.calls.length).toBeGreaterThan(2);
		});
		const [url, init] = findFetchCall('/menu-sync/push');
		expect(String(url)).toBe('http://127.0.0.1:9230/menu-sync/push');
		expect(String(init.method)).toBe('POST');
		const body = JSON.parse(String(init.body));
		expect(body.menuIds).toEqual(['review_qna']);
		expect(body.bundleFileName).toBe('menu_sync_review_qna.zip');
		expect(body.localApiBaseUrl).toBe('http://localhost:3000/api');
		expect(body.nasApiBaseUrl).toBe('http://192.168.0.50:6188/api');
		expect(body.localBearerToken).toBe('test-firebase-token');
		expect(body.nasBearerToken).toBe('test-firebase-token');
		expect(await screen.findByText(/최근 호스트 실행 상태:/)).toBeTruthy();
		expect(screen.getByText(/성공/)).toBeTruthy();
		expect(screen.getByText(/commerce_qna_raw 추가 1172건 \/ 번들 1172건/)).toBeTruthy();
		expect(screen.getByText(/\{"raw":"push-complete"\}/)).toBeTruthy();
		expect((screen.getByLabelText('호스트 import 번들 경로 또는 파일명') as HTMLInputElement).value).toBe(
			'D:\\dev\\ERP2-analytics\\artifacts\\menu-sync\\menu_sync_review_qna.zip',
		);
	});

	it('내 상품 추적 번들 생성 시 날짜 범위를 함께 전달한다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'product_tracking', label: '내 상품 추적', description: '추적 데이터 전체', status: 'active' }],
			},
		});
		getFetchMock()
			.mockResolvedValueOnce({
				ok: true,
				blob: vi.fn().mockResolvedValue(new Blob(['zip-bytes'], { type: 'application/zip' })),
				headers: {
					get: () => 'attachment; filename="menu_sync_product_tracking.zip"',
				},
			})
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					ok: true,
					action: 'menu-sync-export',
					bundlePath: 'D:\\dev\\ERP2-analytics\\artifacts\\menu-sync\\menu_sync_product_tracking.zip',
				}),
			});

		await renderMenuSyncView();

		await changeWithAct(await screen.findByLabelText('동기화 시작일'), { target: { value: '2026-01-01' } });
		await changeWithAct(screen.getByLabelText('동기화 종료일'), { target: { value: '2026-04-08' } });
		await clickWithAct(screen.getByRole('button', { name: '동기화 번들 생성' }));

		await waitFor(() => {
			expect(getFetchMock().mock.calls.length).toBeGreaterThan(1);
		});
		const [exportUrl, exportInit] = getFetchMock().mock.calls[0];
		expect(String(exportUrl)).toBe('/api/menu-sync/export');
		expect(JSON.parse(String(exportInit.body))).toEqual({
			menu_ids: ['product_tracking'],
			date_from: '2026-01-01',
			date_to: '2026-04-08',
		});
		const [hostUrl, hostInit] = findFetchCall('http://127.0.0.1:9230/menu-sync/export');
		expect(String(hostUrl)).toBe('http://127.0.0.1:9230/menu-sync/export');
		expect(JSON.parse(String(hostInit.body))).toMatchObject({
			menuIds: ['product_tracking'],
			dateFrom: '2026-01-01',
			dateTo: '2026-04-08',
			bearerToken: 'test-firebase-token',
		});
	});

	it('번들 파일명을 입력하면 호스트 NAS import 실행을 요청한다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' }],
			},
		});
		getFetchMock()
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ ok: true, action: 'menu-sync-import', bundlePath: 'artifacts/menu-sync/manual_bundle.zip' }),
			});

		await renderMenuSyncView();

		await changeWithAct(await screen.findByLabelText('호스트 import 번들 경로 또는 파일명'), {
			target: { value: 'manual_bundle.zip' },
		});
		await clickWithAct(screen.getByRole('button', { name: '호스트에서 NAS import 실행' }));

		await waitFor(() => {
			expect(getFetchMock().mock.calls.length).toBeGreaterThan(0);
		});
		const [url, init] = findFetchCall('/menu-sync/import');
		expect(String(url)).toBe('http://127.0.0.1:9230/menu-sync/import');
		const body = JSON.parse(String(init.body));
		expect(body.bundleFileName).toBe('manual_bundle.zip');
		expect(body.nasApiBaseUrl).toBe('http://192.168.0.50:6188/api');
		expect(body.bearerToken).toBe('test-firebase-token');
	});

	it('Host Agent가 구버전이면 self-update 후 메뉴 동기화를 실행한다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' }],
			},
		});
		getFetchMock()
			.mockResolvedValueOnce(oldStandaloneVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ ok: true, action: 'self-update' }),
			})
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ ok: true, action: 'menu-sync-import', bundlePath: 'artifacts/menu-sync/manual_bundle.zip' }),
			});

		await renderMenuSyncView();

		await changeWithAct(await screen.findByLabelText('호스트 import 번들 경로 또는 파일명'), {
			target: { value: 'manual_bundle.zip' },
		});
		await clickWithAct(screen.getByRole('button', { name: '호스트에서 NAS import 실행' }));

		await waitFor(() => {
			expect(findFetchCall('/self-update')).toBeTruthy();
			expect(findFetchCall('/menu-sync/import')).toBeTruthy();
		});
	});

	it('최신 standalone Agent면 repo Agent로 전환한 뒤 메뉴 동기화를 실행한다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' }],
			},
		});
		getFetchMock()
			.mockResolvedValueOnce(latestStandaloneVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ ok: true }),
			})
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ ok: true, action: 'menu-sync-import', bundlePath: 'artifacts/menu-sync/manual_bundle.zip' }),
			});

		await renderMenuSyncView();

		await changeWithAct(await screen.findByLabelText('호스트 import 번들 경로 또는 파일명'), {
			target: { value: 'manual_bundle.zip' },
		});
		await clickWithAct(screen.getByRole('button', { name: '호스트에서 NAS import 실행' }));

		await waitFor(() => {
			expect(findFetchCall('/shutdown')).toBeTruthy();
			expect(findFetchCall('/menu-sync/import')).toBeTruthy();
		}, { timeout: 4000 });
	});

	it('호스트 NAS import가 실패하면 실패 상태와 오류를 표시한다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' }],
			},
		});
		getFetchMock()
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: vi.fn().mockResolvedValue({ ok: false, action: 'menu-sync-import', error: 'http_status=404 body={\"detail\":\"Not Found\"}' }),
			});

		await renderMenuSyncView();

		await changeWithAct(await screen.findByLabelText('호스트 import 번들 경로 또는 파일명'), {
			target: { value: 'D:\\dev\\ERP2-analytics\\artifacts\\menu-sync\\manual_bundle.zip' },
		});
		await clickWithAct(screen.getByRole('button', { name: '호스트에서 NAS import 실행' }));

		expect(await screen.findByText(/최근 호스트 실행 상태:/)).toBeTruthy();
		expect(screen.getByText(/실패/)).toBeTruthy();
		expect(screen.getAllByText(/http_status=404 body=/).length).toBeGreaterThan(0);
	});

	it('내 상품 추적 결측 분석을 호스트로 요청하고 누락 날짜를 표시한다', async () => {
		(mockedAxios.get as any).mockResolvedValue({
			data: {
				ok: true,
				menus: [{ id: 'product_tracking', label: '내 상품 추적', description: '추적 데이터 전체', status: 'active' }],
			},
		});
		getFetchMock()
			.mockResolvedValueOnce(hostAgentVersionResponse())
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					ok: true,
					action: 'menu-sync-tracking-gap-analyze',
					missing_date_count: 2,
					missing_dates: ['2026-03-14', '2026-03-28'],
					gap_items: [
						{
							date: '2026-03-14',
							table_name: 'tracked_product_page_daily',
							local_row_count: 12,
							nas_row_count: 0,
							missing_key_count: 12,
							missing_keys: ['p1'],
						},
					],
				}),
			});

		await renderMenuSyncView();

		await changeWithAct(await screen.findByLabelText('동기화 시작일'), { target: { value: '2026-01-01' } });
		await changeWithAct(screen.getByLabelText('동기화 종료일'), { target: { value: '2026-04-08' } });
		await clickWithAct(screen.getByRole('button', { name: '호스트에서 결측 분석 실행' }));

		await waitFor(() => {
			expect(getFetchMock().mock.calls.length).toBeGreaterThan(0);
		});
		const [url, init] = findFetchCall('/menu-sync/tracking-gap-analyze');
		expect(String(url)).toBe('http://127.0.0.1:9230/menu-sync/tracking-gap-analyze');
		expect(JSON.parse(String(init.body))).toMatchObject({
			localApiBaseUrl: 'http://localhost:3000/api',
			nasApiBaseUrl: 'http://192.168.0.50:6188/api',
			dateFrom: '2026-01-01',
			dateTo: '2026-04-08',
			localBearerToken: 'test-firebase-token',
			nasBearerToken: 'test-firebase-token',
		});
		expect(await screen.findByText(/누락 날짜 수:/)).toBeTruthy();
		expect(screen.getByText(/2026-03-14, 2026-03-28/)).toBeTruthy();
	});
});
