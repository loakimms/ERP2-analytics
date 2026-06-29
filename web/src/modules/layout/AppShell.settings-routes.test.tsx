import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flushReactEffects, mockedAxios, registerAppShellTestLifecycle, renderAppShell } from './AppShell.testUtils';

registerAppShellTestLifecycle();

describe('AppShell settings routes', () => {
	it('메뉴6(설정) 경로에서는 설정 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });
		await renderAppShell('/analytics/settings');
		await flushReactEffects();

		expect(await screen.findByText('카테고리 사전', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('사전 업로드')).toBeTruthy();
	});

	it('메뉴6(설정) - SEO규칙등록 경로에서는 규칙 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });
		await renderAppShell('/analytics/settings/seo-rules');
		await flushReactEffects();

		expect(await screen.findByText('SEO 규칙 등록', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('금칙어(1줄 1단어) - 조합/후보/토큰에서 완전 배제')).toBeTruthy();
	});

	it('메뉴6(설정) - API 세팅 경로에서는 API 세팅 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
			if (String(url).includes('/settings/api')) return Promise.resolve({ data: { NAVER_KEY: '', NAVER_SECRET: '' } });
			return Promise.resolve({ data: [] });
		});
		axiosAny.put.mockResolvedValue({ data: { ok: true } });

		await renderAppShell('/analytics/settings/api');
		await flushReactEffects();

		expect(await screen.findByText('API 세팅', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('1. 네이버 쇼핑 OpenAPI', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('NAVER_KEY')).toBeTruthy();
		expect(await screen.findByText('NAVER_SECRET')).toBeTruthy();
	});

	it('메뉴6(설정) - AI 세팅 경로에서는 AI 세팅 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
			if (String(url).includes('/settings/ai')) return Promise.resolve({ data: { format_version: 'v2', common_rules: '', rule_packs: [] } });
			return Promise.resolve({ data: [] });
		});
		axiosAny.put.mockResolvedValue({ data: { ok: true } });

		await renderAppShell('/analytics/settings/ai');
		await flushReactEffects();

		expect(await screen.findByText('AI 세팅', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('공통 규칙')).toBeTruthy();
		expect(await screen.findByText('A-1 규칙(숫자 조정)')).toBeTruthy();
	});

	it('메뉴6(설정) - 데이터 수집 경로에서는 수집 허브를 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/collection/tasks')) {
				return Promise.resolve({
					data: {
						ok: true,
						tasks: [
							{
								task_id: 'page_metrics_cdp',
								label: '상품 상세 메트릭(CDP)',
								domain: 'rank',
								source_type: 'host_cdp',
								preferred_runtime: 'collector_pc',
								requires_installed_collector: true,
								target_tables: ['tracked_product_page_daily'],
								enabled: true,
								schedule_enabled: false,
								schedule_time: '05:00',
								runnable: true,
							},
						],
						coverage: {},
					},
				});
			}
			if (u.includes('/collection/jobs')) return Promise.resolve({ data: { ok: true, jobs: [] } });
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/settings/data-collection');
		await flushReactEffects();

		expect(await screen.findByText('데이터 수집', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('상품 상세 메트릭(CDP)')).toBeTruthy();
		expect(await screen.findByText('24시간 PC Collector', { selector: '.card-title' })).toBeTruthy();
	});

	it('메뉴6(설정) - 사용자관리 경로에서는 사용자관리 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });

		await renderAppShell('/analytics/settings/users');
		await flushReactEffects();

		expect(await screen.findByText('사용자관리', { selector: '.card-title' })).toBeTruthy();
	});

	it('메뉴6(설정) - 버전관리 경로에서는 버전관리 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/version.json')) return Promise.resolve({ data: { appVersion: 't', imageTag: 't' } });
			if (u.includes('/version')) return Promise.resolve({ data: { status: 'ok', imageTag: 't' } });
			if (u.includes('/health')) return Promise.resolve({ data: { ok: true } });
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/settings/version');
		await flushReactEffects();

		expect(await screen.findByText('버전관리', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('현재 버전')).toBeTruthy();
		expect(await screen.findByText('변경 버전')).toBeTruthy();
		expect(await screen.findByText('확인')).toBeTruthy();
	});

	it('메뉴6(설정) - 메뉴동기화 경로에서는 메뉴동기화 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/menu-sync/menus')) {
				return Promise.resolve({
					data: {
						ok: true,
						menus: [{ id: 'review_qna', label: '리뷰 Q&A', description: 'Q&A 전체 테이블', status: 'active' }],
					},
				});
			}
			return Promise.resolve({ data: [] });
		});

		await renderAppShell('/analytics/settings/menu-sync');
		await flushReactEffects();

		expect(await screen.findByText('메뉴동기화', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByRole('checkbox', { name: '리뷰 Q&A' })).toBeTruthy();
	});
});
