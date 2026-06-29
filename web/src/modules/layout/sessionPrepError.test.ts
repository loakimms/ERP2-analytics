import { describe, expect, it } from 'vitest';
import { formatSessionPrepErrorMessage } from './sessionPrepError';

describe('formatSessionPrepErrorMessage', () => {
	it('일반적인 503 에러를 디버그 요약으로 사람이 읽을 수 있게 바꾼다', () => {
		const out = formatSessionPrepErrorMessage('Request failed with status code 503', {
			title: '현재 host_cdp로 연결되지 않았습니다.',
			lines: [
				'cdp.lastError=connect_over_cdp_failed',
				'cdp.lastErrorDetail=Error: connect ECONNREFUSED 192.168.0.105:9223',
				'nas.override_http_ok=false',
				'nas.override_url=http://192.168.0.105:9223',
			],
		});

		expect(out).toContain('NAS 세션 준비가 503으로 중단되었습니다.');
		expect(out).toContain('진단: 현재 host_cdp로 연결되지 않았습니다.');
		expect(out).toContain('상세: Error: connect ECONNREFUSED 192.168.0.105:9223');
		expect(out).toContain('대상 CDP 주소: http://192.168.0.105:9223');
	});

	it('host_cdp_required 상세를 우선적으로 노출한다', () => {
		const out = formatSessionPrepErrorMessage('host_cdp_required: connect timeout', {
			title: '컨테이너에서 호스트 CDP(/json/version)에 연결이 안 됩니다.',
			lines: [
				'cdp.container_http_reachable=false',
				'cdp.lastErrorDetail=TimeoutError: timed out waiting for websocket endpoint',
			],
		});

		expect(out).toContain('호스트 Chrome(CDP) 연결이 필요하지만 서버가 세션을 열지 못했습니다.');
		expect(out).toContain('진단: 컨테이너에서 호스트 CDP(/json/version)에 연결이 안 됩니다.');
		expect(out).toContain('상세: TimeoutError: timed out waiting for websocket endpoint');
	});

	it('진단 정보가 없으면 원본 메시지를 그대로 둔다', () => {
		expect(formatSessionPrepErrorMessage('plain error')).toBe('plain error');
	});
});
