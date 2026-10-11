import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { clickWithAct, flushReactEffects, mockedAxios, registerAppShellTestLifecycle, renderAppShell } from './AppShell.testUtils';

registerAppShellTestLifecycle();

describe('AppShell primary routes', () => {
	it('기본으로 4-1 내 상품 추적(일간 랭킹추적) 화면을 보여준다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });
		await renderAppShell('/analytics/rank/tracking');
		await flushReactEffects();

		expect(screen.getByText('일간 랭킹추적')).toBeTruthy();
		expect(screen.getByText('상품 목록')).toBeTruthy();
	});

	it('메뉴1은 AI 운영 센터 라벨로 노출되고 오늘의 실행 경로를 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });

		await renderAppShell('/analytics/ai/home');
		await flushReactEffects();

		expect(screen.getAllByText('AI 운영 센터').length).toBeGreaterThan(0);
		expect(await screen.findByText('오늘의 실행', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('오늘 바로 검토해야 할 위험과 기회를 한 화면에서 정리합니다.')).toBeTruthy();
	});

	it('상품별 운영 판단 경로에서는 통합 판단 허브 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });

		await renderAppShell('/analytics/ai/products');
		await flushReactEffects();

		expect(await screen.findByText('상품별 운영 판단', { selector: '.card-title' })).toBeTruthy();
		expect(await screen.findByText('오가닉, 광고, 판매, 리뷰, Q&A 신호를 SKU 기준으로 묶어 이번 주 운영 정책을 제시합니다.')).toBeTruthy();
		expect(await screen.findByRole('button', { name: '오가닉 A-1 보기' })).toBeTruthy();
	});

	it('AI 콘텐츠 센터 경로에서는 오늘의 콘텐츠 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: { ok: true } });
		axiosAny.patch.mockResolvedValue({ data: { ok: true } });
		axiosAny.get.mockImplementation((url: string) => {
			const u = String(url || '');
			if (u.includes('/content/sku-scope')) {
				return Promise.resolve({ data: { ok: true, items: [{ sku_id: '4743750201', title: '수자타 헤나 염색약', product_group: 'henna', phase1_enabled: true }] } });
			}
			if (u.includes('/content/appeals')) {
				return Promise.resolve({ data: { ok: true, items: [{ appeal_id: 'AP-001', sku_id: '4743750201', label: '반복 새치 관리 부담', appeal_text: '반복되는 새치 관리의 부담', status: 'ACTIVE', scores: { overall: 83 }, evidence_count: 3 }] } });
			}
			if (u.includes('/content/today')) {
				return Promise.resolve({ data: { ok: true, data_ready: { ready: true }, items: [] } });
			}
			if (u.includes('/content/artifacts')) return Promise.resolve({ data: { ok: true, items: [] } });
			if (u.includes('/content/learning')) return Promise.resolve({ data: { ok: true, counts: { OBSERVE: 1 }, items: [] } });
			return Promise.resolve({ data: { ok: true, items: [] } });
		});

		await renderAppShell('/analytics/content/today');
		await flushReactEffects();

		expect(screen.getAllByText('AI 콘텐츠 센터').length).toBeGreaterThan(0);
		expect(await screen.findByTestId('content-center-react')).toBeTruthy();
		expect(await screen.findByText('오늘의 콘텐츠 큐')).toBeTruthy();
	});

	it('오가닉 A-1 전용 경로에서는 상품 중심 A-1 화면을 직접 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: { ok: true, products: [] } });
		axiosAny.get.mockResolvedValue({ data: { ok: true } });

		await renderAppShell('/analytics/ai/organic-rank');
		await flushReactEffects();

		expect(await screen.findByText('A-1. 오가닉(검색/쇼핑) 순위 분석 — 상품 중심')).toBeTruthy();
		expect(await screen.findByText('A-1 검증(역추적)')).toBeTruthy();
	});

	it('오가닉 A-1 Trace 전용 경로에서는 근거 트리 화면을 직접 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: { ok: true, runs: [] } });
		axiosAny.get.mockResolvedValue({ data: { ok: true, items: [] } });

		await renderAppShell('/analytics/ai/organic-rank/trace');
		await flushReactEffects();

		expect(await screen.findByText('A-1 검증(역추적) — 최종 제안 근거 트리')).toBeTruthy();
		expect(await screen.findByRole('button', { name: '배치 실행(Trace 생성)' })).toBeTruthy();
	});

	it('검색 순위 개요(키워드별 상품 리스트) 서브 메뉴를 누르면 개요 섹션으로 전환된다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });

		await renderAppShell('/analytics/rank/tracking');
		await flushReactEffects();

		await clickWithAct(screen.getByRole('button', { name: /키워드 인사이트/ }));
		await flushReactEffects();

		expect(await screen.findByText('키워드 인사이트', { selector: '.card-title' })).toBeTruthy();
	});

	it('메뉴5(SEO 분석) - 상품명 SEO 경로에서는 상품명 SEO 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: {} });
		axiosAny.get.mockResolvedValue({ data: [] });
		await renderAppShell('/analytics/research/keyword-insights');
		await flushReactEffects();

		expect(await screen.findByText('상품명 SEO (5-1)')).toBeTruthy();
	});

	it('메뉴5(SEO 분석) - 상품지수분석 경로에서는 상품지수분석 화면을 렌더링한다', async () => {
		const axiosAny = mockedAxios;
		axiosAny.post.mockResolvedValue({ data: [] });
		axiosAny.get.mockResolvedValue({ data: [] });
		await renderAppShell('/analytics/seo/product-index');
		await flushReactEffects();

		expect(await screen.findByText('상품지수분석 (5-3)')).toBeTruthy();
	});
});
