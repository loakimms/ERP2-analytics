type CdpDebugSummary = {
	level: 'info' | 'warn';
	title: string;
	lines: string[];
	links: Array<{ label: string; url: string }>;
};

function s(v: unknown): string {
	return String(v ?? '').trim();
}

export function summarizeCaptchaSessionDebug(debug: any): CdpDebugSummary {
	const mode = s(debug?.mode) || 'unknown';
	const cdp = debug?.cdp ?? {};
	const nas = debug?.nas_debug ?? {};
	const enabled = Boolean(cdp?.enabled);
	const hostHttp = s(cdp?.host_http);
	const containerHttp = s(cdp?.container_http);
	const reachable = cdp?.container_http_reachable;
	const lastErr = s(cdp?.lastError) || s(cdp?.last_error);
	const lastErrDetail = s(cdp?.lastErrorDetail) || s(cdp?.last_error_detail);

	const lines: string[] = [];
	lines.push(`mode=${mode}`);
	lines.push(`cdp.enabled=${enabled ? 'true' : 'false'}`);
	if (hostHttp) lines.push(`cdp.host_http=${hostHttp}`);
	if (containerHttp) lines.push(`cdp.container_http=${containerHttp}`);
	if (reachable === true) lines.push('cdp.container_http_reachable=true');
	else if (reachable === false) lines.push('cdp.container_http_reachable=false');
	if (lastErr) lines.push(`cdp.lastError=${lastErr}`);
	if (lastErrDetail) lines.push(`cdp.lastErrorDetail=${lastErrDetail}`);

	// NAS 디버깅 가시성(서버가 실제로 어떤 IP/URL로 붙으려 했는지)
	const pickedIp = s(nas?.picked_ip);
	const overrideUrl = s(nas?.override_url);
	const reqHost = s(nas?.request_client_host);
	const xff = s(nas?.x_forwarded_for);
	const xip = s(nas?.x_erp2_client_ip);
	const ipParam = s(nas?.client_ip_param);
	const tcpOpen = nas?.override_tcp_open;
	const httpOk = nas?.override_http_ok;
	const httpSt = nas?.override_http_status;
	const httpErr = s(nas?.override_http_error);
	if (ipParam) lines.push(`nas.client_ip_param=${ipParam}`);
	if (xip) lines.push(`nas.x_erp2_client_ip=${xip}`);
	if (xff) lines.push(`nas.x_forwarded_for=${xff}`);
	if (reqHost) lines.push(`nas.request_client_host=${reqHost}`);
	if (pickedIp) lines.push(`nas.picked_ip=${pickedIp}`);
	if (overrideUrl) lines.push(`nas.override_url=${overrideUrl}`);
	if (tcpOpen === true) lines.push('nas.override_tcp_open=true');
	else if (tcpOpen === false) lines.push('nas.override_tcp_open=false');
	if (httpOk === true) lines.push(`nas.override_http_ok=true${httpSt ? ` (status=${httpSt})` : ''}`);
	else if (httpOk === false) lines.push(`nas.override_http_ok=false${httpSt ? ` (status=${httpSt})` : ''}`);
	if (httpErr) lines.push(`nas.override_http_error=${httpErr}`);

	const links: Array<{ label: string; url: string }> = [];
	if (hostHttp) links.push({ label: '호스트 CDP json/list 열기', url: `${hostHttp.replace(/\/+$/, '')}/json/list` });
	if (containerHttp) links.push({ label: '컨테이너→호스트 json/version', url: `${containerHttp.replace(/\/+$/, '')}/json/version` });
	if (overrideUrl) links.push({ label: 'NAS override json/version', url: `${overrideUrl.replace(/\/+$/, '')}/json/version` });

	let level: 'info' | 'warn' = 'info';
	let title = 'CDP 진단 결과';
	if (!enabled) {
		level = 'warn';
		title = 'CDP가 비활성화(USE_HOST_CHROME=0) 상태입니다.';
	} else if (mode !== 'host_cdp') {
		// NAS는 REQUIRE_HOST_CDP=1 이므로, 여기로 떨어지면 거의 항상 연결 실패/폴백 문제다.
		level = 'warn';
		title = '현재 host_cdp로 연결되지 않았습니다.';
	} else if (reachable === false) {
		level = 'warn';
		title = '컨테이너에서 호스트 CDP(/json/version)에 연결이 안 됩니다.';
	}

	return { level, title, lines, links };
}

