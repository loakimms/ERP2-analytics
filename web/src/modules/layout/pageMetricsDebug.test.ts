import { describe, expect, it } from 'vitest';
import {
	buildCaptchaSessionSummary,
	derivePageMetricsBlockHint,
	type CaptchaSessionStatus,
} from './pageMetricsDebug';

describe('buildCaptchaSessionSummary', () => {
	it('세션 탭/레지스트리 요약을 계산한다', () => {
		const status: CaptchaSessionStatus = {
			running: true,
			worker_thread_id: 7,
			pages: [
				{ index: 0, url: 'https://example.com/a', closed: false },
				{ index: 1, url: 'https://example.com/b', closed: true },
			],
			registry: {
				'111': { url: 'https://smartstore.naver.com/a/products/1', closed: false },
				'222': { url: 'https://smartstore.naver.com/a/products/2', closed: true },
			},
		};

		const summary = buildCaptchaSessionSummary(status);
		expect(summary).toBeTruthy();
		expect(summary?.title).toBe('세션 탭 1/2');
		expect(summary?.detail).toBe('레지스트리 1/2 · 워커 7');
	});
});

describe('pageMetricsDebug', () => {
	it('보안 확인(영수증) 페이지를 감지하면 안내를 반환한다', () => {
		const hint = derivePageMetricsBlockHint({
			product_url: 'https://smartstore.naver.com/a/products/1',
			http_status: 490,
			error: 'captcha_detected',
			debug: {
				body_text_sample: 'NAVER\n보안 확인을 완료해 주세요.\n영수증의 가게 위치는 갈천길 [?] 입니다.',
			},
		});
		expect(hint?.level).toBe('warn');
		expect(hint?.title).toMatch(/보안 확인/);
	});

	it('서비스 접속 불가(차단/오류) 페이지를 감지하면 안내를 반환한다', () => {
		const hint = derivePageMetricsBlockHint({
			product_url: 'https://smartstore.naver.com/a/products/1',
			http_status: 490,
			error: 'service_blocked',
			debug: {
				body_text_sample: '현재 서비스 접속이 불가능합니다.\n새로고침을 눌러주세요.',
				mode: 'host_cdp',
			},
		});
		expect(hint?.level).toBe('warn');
		expect(hint?.title).toMatch(/서비스 접속 불가/);
	});

	it('정상/알 수 없는 케이스는 null을 반환한다', () => {
		const hint = derivePageMetricsBlockHint({
			product_url: 'x',
			http_status: 200,
			error: null,
			debug: { body_text_sample: 'ok' },
		});
		expect(hint).toBeNull();
	});
});


