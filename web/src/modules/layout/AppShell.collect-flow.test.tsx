import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { clickWithAct, mockedAxios, registerAppShellTestLifecycle, renderAppShell } from './AppShell.testUtils';

registerAppShellTestLifecycle();

describe('AppShell collect flow', () => {
	it('수집 모달을 열어도 자동으로 scrape-once(진단)를 호출하지 않는다(403/차단 방지)', async () => {
		window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

		const axiosAny = mockedAxios;
		const getMock = axiosAny.get as any;
		const postMock = axiosAny.post as any;

		postMock.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
			if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
			return Promise.resolve({ data: {} });
		});
		getMock.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({
					data: [
						{
							id: 1,
							product_url: 'https://smartstore.naver.com/example/products/1',
							keyword: '새치염색',
							monthly_search_volume: null,
							is_active: true,
							created_at: '2026-01-01T00:00:00Z',
						},
					],
				});
			}
			if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
			if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/rank/tracking');

		await vi.waitFor(() => {
			expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			expect(screen.getByText('오늘 상품 상세 메트릭 수집')).toBeTruthy();
		});

		const calls = getMock.mock.calls.map((c: any[]) => String(c[0] || ''));
		expect(calls.some((u: string) => u.includes('/search-rank/page-metrics/scrape-once'))).toBe(false);
	});

	it('상품 메트릭 미수집 상태에서는 CDP(호스트 세션) 준비 전 "지금 수집"이 막힌다(403 구조 방지)', async () => {
		window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

		const axiosAny = mockedAxios;
		const getMock = axiosAny.get as any;
		const postMock = axiosAny.post as any;

		postMock.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
			if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
			if (u.includes('/search-rank/page-metrics/collect-now')) return Promise.resolve({ data: [] });
			return Promise.resolve({ data: {} });
		});
		getMock.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/search-rank/tracked')) {
				return Promise.resolve({
					data: [
						{
							id: 1,
							product_url: 'https://smartstore.naver.com/example/products/1',
							keyword: '새치염색',
							monthly_search_volume: null,
							is_active: true,
							created_at: '2026-01-01T00:00:00Z',
						},
					],
				});
			}
			if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
			if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/rank/tracking');

		await vi.waitFor(() => {
			expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
		});

		expect(screen.getByRole('button', { name: '지금 수집' })).toBeTruthy();
		expect(
			screen.getByText(/먼저 3번 버튼으로 호스트 크롬\(CDP\)에서 상품 페이지를 열고 로그인\/보안확인을 완료/),
		).toBeTruthy();

		const postCalls = postMock.mock.calls.map((c: any[]) => String(c[0] || ''));
		expect(postCalls.some((u: string) => u.includes('/search-rank/page-metrics/collect-now'))).toBe(false);
	});

	it(
		'세션 준비(로컬)는 팝업 차단을 피하기 위해 about:blank 1회만 열고, captcha-session/start를 호출한다',
		async () => {
			window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

			const axiosAny = mockedAxios;
			const getMock = axiosAny.get as any;
			const postMock = axiosAny.post as any;

			postMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/page-metrics/captcha-session/start')) {
					return Promise.resolve({
						data: { devtools_url: 'http://127.0.0.1:9223/devtools/inspector.html?ws=127.0.0.1:9223/devtools/page/ABC' },
					});
				}
				return Promise.resolve({ data: {} });
			});
			getMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/tracked')) {
					return Promise.resolve({
						data: [
							{
								id: 1,
								product_url: 'https://smartstore.naver.com/example/products/1',
								keyword: '새치염색',
								monthly_search_volume: null,
								is_active: true,
								created_at: '2026-01-01T00:00:00Z',
							},
						],
					});
				}
				if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
				if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
				if (u.includes('/search-rank/page-metrics/host-cdp/probe')) {
					return Promise.resolve({ data: { enabled: true, container_http: 'http://192.168.65.254:9223', container_http_reachable: true } });
				}
				return Promise.resolve({ data: [] });
			});

			const fakePopup: any = { closed: false, location: { href: '' } };
			const openSpy = vi.spyOn(window, 'open').mockImplementation(() => fakePopup);
			const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation((input: any) => {
				const url =
					typeof input === 'string'
						? input
						: input && typeof input === 'object' && 'url' in input
							? String((input as any).url || '')
							: String(input || '');
				if (url.includes('http://127.0.0.1:9230/start-host-chrome')) {
					return Promise.resolve({
						ok: true,
						status: 200,
						json: async () => ({ ok: true, ready: true, action: 'start-host-chrome', port: 9223 }),
					} as any);
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					json: async () => ({ ok: true }),
				} as any);
			});

			await renderAppShell('/analytics/rank/tracking');

			await vi.waitFor(() => {
				expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			});
			await vi.waitFor(() => {
				expect(screen.getAllByText('새치염색').length).toBeGreaterThan(0);
			});

			await clickWithAct(screen.getByRole('button', { name: '로컬 세션 준비' }));

			await vi.waitFor(() => {
				expect(openSpy).toHaveBeenCalled();
			});
			await vi.waitFor(() => {
				expect(fetchSpy).toHaveBeenCalled();
			});

			const fetchUrls = (fetchSpy.mock.calls || []).map((c: any[]) => {
				const a = c?.[0];
				if (typeof a === 'string') return a;
				if (a && typeof a === 'object' && 'url' in a) return String((a as any).url || '');
				return String(a || '');
			});
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/health'))).toBe(true);
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/start-host-chrome'))).toBe(true);
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9223/json/version'))).toBe(false);

			const args = openSpy.mock.calls.map((c) => String(c[0] || ''));
			expect(args[0]).toBe('about:blank');
			expect(args.some((u) => u.includes('smartstore.naver.com'))).toBe(false);
		},
		15_000,
	);

	it(
		'세션 준비가 실패하면 hostSessionOpenedOnce를 올리지 않아 collect-now를 막는다',
		async () => {
			window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

			const axiosAny = mockedAxios;
			const getMock = axiosAny.get as any;
			const postMock = axiosAny.post as any;

			postMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/page-metrics/captcha-session/start')) {
					return Promise.reject({ response: { data: { detail: 'host_cdp_required' } } });
				}
				if (u.includes('/search-rank/page-metrics/collect-now')) return Promise.resolve({ data: [] });
				return Promise.resolve({ data: {} });
			});
			getMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/tracked')) {
					return Promise.resolve({
						data: [
							{
								id: 1,
								product_url: 'https://smartstore.naver.com/example/products/1',
								keyword: '새치염색',
								monthly_search_volume: null,
								is_active: true,
								created_at: '2026-01-01T00:00:00Z',
							},
						],
					});
				}
				if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
				if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
				if (u.includes('/search-rank/page-metrics/host-cdp/probe')) {
					return Promise.resolve({ data: { enabled: true, container_http: 'http://192.168.65.254:9223', container_http_reachable: true } });
				}
				return Promise.resolve({ data: [] });
			});

			const fakePopup: any = { closed: false, location: { href: '' }, close: vi.fn() };
			vi.spyOn(window, 'open').mockImplementation(() => fakePopup);
			vi.spyOn(globalThis, 'fetch' as any).mockImplementation((input: any) => {
				const url =
					typeof input === 'string'
						? input
						: input && typeof input === 'object' && 'url' in input
							? String((input as any).url || '')
							: String(input || '');
				if (url.includes('http://127.0.0.1:9230/start-host-chrome')) {
					return Promise.resolve({
						ok: true,
						status: 200,
						json: async () => ({ ok: true, ready: true, action: 'start-host-chrome', port: 9223 }),
					} as any);
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					json: async () => ({ ok: true }),
				} as any);
			});

			await renderAppShell('/analytics/rank/tracking');

			await vi.waitFor(() => {
				expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			});
			await vi.waitFor(() => {
				expect(screen.getAllByText('새치염색').length).toBeGreaterThan(0);
			});

			await clickWithAct(screen.getByRole('button', { name: '로컬 세션 준비' }));

			await vi.waitFor(() => {
				expect(screen.getByText(/host_cdp_required/)).toBeTruthy();
			});

			await clickWithAct(screen.getByRole('button', { name: '지금 수집' }));

			await vi.waitFor(() => {
				expect(
					screen.getAllByText(/먼저 3번\(세션 준비\) 버튼으로 호스트 크롬에서 상품 페이지를 열고 로그인\/보안확인을 완료한 뒤 수집/).length,
				).toBeGreaterThan(0);
			});

			const postCalls = postMock.mock.calls.map((c: any[]) => String(c[0] || ''));
			expect(postCalls.filter((u: string) => u.includes('/search-rank/page-metrics/collect-now')).length).toBe(0);
		},
		15_000,
	);

	it(
		'정리(중지/삭제) 버튼은 4번 수집 전에도 활성이며 스크립트 다운로드를 연다',
		async () => {
			window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

			const axiosAny = mockedAxios;
			const getMock = axiosAny.get as any;
			const postMock = axiosAny.post as any;

			postMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/page-metrics/captcha-session/start')) return Promise.resolve({ data: {} });
				if (u.includes('/search-rank/page-metrics/collect-now')) return Promise.resolve({ data: [] });
				return Promise.resolve({ data: {} });
			});
			getMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/tracked')) {
					return Promise.resolve({
						data: [
							{
								id: 1,
								product_url: 'https://smartstore.naver.com/example/products/1',
								keyword: '새치염색',
								monthly_search_volume: null,
								is_active: true,
								created_at: '2026-01-01T00:00:00Z',
							},
						],
					});
				}
				if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
				if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
				return Promise.resolve({ data: [] });
			});

			const fakePopup: any = { closed: false, location: { href: '' } };
			const openSpy = vi.spyOn(window, 'open').mockImplementation(() => fakePopup);
			const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ ok: true, ready: true, action: 'start-host-chrome', port: 9223 }),
			} as any);

			await renderAppShell('/analytics/rank/tracking');

			await vi.waitFor(() => {
				expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			});
			await vi.waitFor(() => {
				expect(screen.getAllByText('새치염색').length).toBeGreaterThan(0);
			});

			await clickWithAct(screen.getByRole('button', { name: '로컬 세션 준비' }));
			await vi.waitFor(() => {
				expect(fetchSpy).toHaveBeenCalled();
			});

			const cleanupBtn0 = screen.getByRole('button', { name: 'cleanup-host-setup' }) as HTMLButtonElement;
			expect(cleanupBtn0.disabled).toBe(false);

			await clickWithAct(screen.getByRole('button', { name: 'cleanup-host-setup' }));
			await vi.waitFor(() => {
				const args = openSpy.mock.calls.map((c) => String(c[0] || ''));
				expect(args.some((u) => u === '/local/Cleanup-Analytics-HostSetup.ps1')).toBe(true);
			});
		},
		15_000,
	);

	it(
		'수집 모달을 닫으면 API 세션만 정리하고 Host Chrome/Agent는 재사용을 위해 유지한다',
		async () => {
			window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

			const axiosAny = mockedAxios;
			const getMock = axiosAny.get as any;
			const postMock = axiosAny.post as any;

			postMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/page-metrics/captcha-session/start')) {
					return Promise.resolve({
						data: { devtools_url: 'http://127.0.0.1:9223/devtools/inspector.html?ws=127.0.0.1:9223/devtools/page/ABC' },
					});
				}
				if (u.includes('/search-rank/page-metrics/captcha-session/stop')) return Promise.resolve({ data: { ok: true } });
				return Promise.resolve({ data: {} });
			});
			getMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/tracked')) {
					return Promise.resolve({
						data: [
							{
								id: 1,
								product_url: 'https://smartstore.naver.com/example/products/1',
								keyword: '새치염색',
								monthly_search_volume: null,
								is_active: true,
								created_at: '2026-01-01T00:00:00Z',
							},
						],
					});
				}
				if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
				if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
				if (u.includes('/search-rank/page-metrics/host-cdp/probe')) {
					return Promise.resolve({ data: { enabled: true, container_http: 'http://192.168.65.254:9223', container_http_reachable: true } });
				}
				return Promise.resolve({ data: [] });
			});

			const fakePopup: any = { closed: false, location: { href: '' }, close: vi.fn() };
			vi.spyOn(window, 'open').mockImplementation(() => fakePopup);
			const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation((input: any) => {
				const url =
					typeof input === 'string'
						? input
						: input && typeof input === 'object' && 'url' in input
							? String((input as any).url || '')
							: String(input || '');
				if (url.includes('http://127.0.0.1:9230/start-host-chrome')) {
					return Promise.resolve({
						ok: true,
						status: 200,
						json: async () => ({ ok: true, ready: true, action: 'start-host-chrome', port: 9223 }),
					} as any);
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					json: async () => ({ ok: true }),
				} as any);
			});

			await renderAppShell('/analytics/rank/tracking');

			await vi.waitFor(() => {
				expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			});
			await vi.waitFor(() => {
				expect(screen.getAllByText('새치염색').length).toBeGreaterThan(0);
			});

			await clickWithAct(screen.getByRole('button', { name: '로컬 세션 준비' }));
			await vi.waitFor(() => {
				expect(fetchSpy).toHaveBeenCalled();
			});

			await clickWithAct(screen.getAllByRole('button', { name: '닫기' })[0]!);

			await vi.waitFor(() => {
				expect(screen.queryByRole('dialog', { name: '오늘 수집 안내' })).toBeNull();
			});

			const postCalls = postMock.mock.calls.map((c: any[]) => String(c[0] || ''));
			expect(postCalls.some((u: string) => u.includes('/search-rank/page-metrics/captcha-session/stop'))).toBe(true);

			const fetchUrls = (fetchSpy.mock.calls || []).map((c: any[]) => {
				const a = c?.[0];
				if (typeof a === 'string') return a;
				if (a && typeof a === 'object' && 'url' in a) return String((a as any).url || '');
				return String(a || '');
			});
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/stop-host-chrome'))).toBe(false);
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/shutdown'))).toBe(false);
		},
		15_000,
	);

	it(
		'수집 모달에서 강제 종료를 눌러도 모달은 닫히지 않는다',
		async () => {
			window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

			const axiosAny = mockedAxios;
			const getMock = axiosAny.get as any;
			const postMock = axiosAny.post as any;

			postMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/page-metrics/captcha-session/stop')) return Promise.resolve({ data: { ok: true } });
				return Promise.resolve({ data: {} });
			});
			getMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/tracked')) {
					return Promise.resolve({
						data: [
							{
								id: 1,
								product_url: 'https://smartstore.naver.com/example/products/1',
								keyword: '새치염색',
								monthly_search_volume: null,
								is_active: true,
								created_at: '2026-01-01T00:00:00Z',
							},
						],
					});
				}
				if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
				if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
				return Promise.resolve({ data: [] });
			});

			const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation((input: any) => {
				const url =
					typeof input === 'string'
						? input
						: input && typeof input === 'object' && 'url' in input
							? String((input as any).url || '')
							: String(input || '');
				if (url.includes('http://127.0.0.1:9230/health')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as any);
				if (url.includes('http://127.0.0.1:9230/stop-host-chrome')) {
					return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, action: 'stop-host-chrome' }) } as any);
				}
				if (url.includes('http://127.0.0.1:9230/shutdown')) {
					return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, action: 'shutdown' }) } as any);
				}
				return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as any);
			});
			vi.spyOn(window, 'open').mockImplementation(() => null as any);

			await renderAppShell('/analytics/rank/tracking');

			await vi.waitFor(() => {
				expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			});
			await vi.waitFor(() => {
				expect(screen.getAllByText('새치염색').length).toBeGreaterThan(0);
			});

			await clickWithAct(screen.getByRole('button', { name: '로컬 세션 준비' }));
			await vi.waitFor(() => {
				expect(fetchSpy).toHaveBeenCalled();
			});
			await clickWithAct(screen.getByRole('button', { name: 'force-stop-collect-scripts' }));

			expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();

			await vi.waitFor(() => {
				const fetchUrls = (fetchSpy.mock.calls || []).map((c: any[]) => {
					const a = c?.[0];
					if (typeof a === 'string') return a;
					if (a && typeof a === 'object' && 'url' in a) return String((a as any).url || '');
					return String(a || '');
				});
				expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/health'))).toBe(true);
				expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/stop-host-chrome'))).toBe(true);
				expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/shutdown?cleanup=1'))).toBe(true);
			});
		},
		15_000,
	);

	it(
		'활성 호스트 세션이 없으면 강제 종료가 localhost 종료 호출을 생략한다',
		async () => {
			window.localStorage.setItem('analytics:collect_modal:auto_open_v1', '1');

			const axiosAny = mockedAxios;
			const getMock = axiosAny.get as any;
			const postMock = axiosAny.post as any;

			postMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/page-metrics/batch')) return Promise.resolve({ data: [] });
				if (u.includes('/search-rank/crawl/today-status')) return Promise.resolve({ data: [] });
				return Promise.resolve({ data: {} });
			});
			getMock.mockImplementation((url: string) => {
				const u = String(url || '');
				if (u.includes('/search-rank/tracked')) {
					return Promise.resolve({
						data: [
							{
								id: 1,
								product_url: 'https://smartstore.naver.com/example/products/1',
								keyword: '새치염색',
								monthly_search_volume: null,
								is_active: true,
								created_at: '2026-01-01T00:00:00Z',
							},
						],
					});
				}
				if (u.includes('/search-rank/history')) return Promise.resolve({ data: { dates: [], series: [] } });
				if (u.includes('/search-rank/page-metrics/status')) return Promise.resolve({ data: { status: 'IDLE', detail: null } });
				return Promise.resolve({ data: [] });
			});

			const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation((input: any) => {
				const url =
					typeof input === 'string'
						? input
						: input && typeof input === 'object' && 'url' in input
							? String((input as any).url || '')
							: String(input || '');
				if (url.includes('http://127.0.0.1:9230/health')) return Promise.reject(new Error('ECONNREFUSED'));
				return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as any);
			});

			await renderAppShell('/analytics/rank/tracking');

			await vi.waitFor(() => {
				expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			});
			await vi.waitFor(() => {
				expect(screen.getAllByText('새치염색').length).toBeGreaterThan(0);
			});

			await clickWithAct(screen.getByRole('button', { name: 'force-stop-collect-scripts' }));

			await vi.waitFor(() => {
				expect(screen.getByRole('dialog', { name: '오늘 수집 안내' })).toBeTruthy();
			});

			const fetchUrls = (fetchSpy.mock.calls || []).map((c: any[]) => {
				const a = c?.[0];
				if (typeof a === 'string') return a;
				if (a && typeof a === 'object' && 'url' in a) return String((a as any).url || '');
				return String(a || '');
			});
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/health'))).toBe(true);
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/stop-host-chrome'))).toBe(false);
			expect(fetchUrls.some((u: string) => u.includes('http://127.0.0.1:9230/shutdown'))).toBe(false);
		},
		15_000,
	);
});
