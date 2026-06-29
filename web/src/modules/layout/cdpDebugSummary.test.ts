import { describe, expect, it } from 'vitest';
import { summarizeCaptchaSessionDebug } from './cdpDebugSummary';

describe('summarizeCaptchaSessionDebug', () => {
	it('builds links and warns when not host_cdp', () => {
		const out = summarizeCaptchaSessionDebug({
			mode: 'container_chromium',
			cdp: {
				enabled: true,
				host_http: 'http://127.0.0.1:9223',
				container_http: 'http://192.168.0.23:9223',
				container_http_reachable: false,
				lastError: 'connect_over_cdp_failed',
				lastErrorDetail: 'TimeoutError: cdp_unreachable',
			},
			nas_debug: {
				picked_ip: '192.168.0.23',
				override_url: 'http://192.168.0.23:9223',
				override_tcp_open: false,
				override_http_ok: false,
				override_http_error: 'TimeoutError',
			},
		});
		expect(out.level).toBe('warn');
		expect(out.title.length).toBeGreaterThan(0);
		expect(out.lines.join('\n')).toContain('mode=container_chromium');
		expect(out.links.map((x) => x.url)).toContain('http://127.0.0.1:9223/json/list');
		expect(out.links.map((x) => x.url)).toContain('http://192.168.0.23:9223/json/version');
		expect(out.links.map((x) => x.url)).toContain('http://192.168.0.23:9223/json/version');
		expect(out.lines.join('\n')).toContain('nas.override_url=http://192.168.0.23:9223');
	});

	it('info when host_cdp and reachable', () => {
		const out = summarizeCaptchaSessionDebug({
			mode: 'host_cdp',
			cdp: {
				enabled: true,
				host_http: 'http://127.0.0.1:9223',
				container_http: 'http://192.168.0.23:9223',
				container_http_reachable: true,
			},
		});
		expect(out.level).toBe('info');
		expect(out.lines.join('\n')).toContain('cdp.container_http_reachable=true');
	});
});

