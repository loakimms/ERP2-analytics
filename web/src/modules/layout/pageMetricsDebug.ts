export type PageMetricsScrapeOnceResponse = {
	product_url: string;
	http_status?: number | null;
	error?: string | null;
	via?: string | null;
	debug?: Record<string, unknown> | null;
};

export type CaptchaSessionStatus = {
	running?: boolean;
	mode?: string | null;
	cdp?: {
		enabled?: boolean;
		host_http?: string | null;
		lastError?: string | null;
	} | null;
	worker_thread_id?: number | null;
	pages?: Array<{ index: number; url?: string | null; closed?: boolean | null }>;
	registry?: Record<string, { url?: string | null; closed?: boolean | null }>;
};

export function buildCaptchaSessionSummary(
	status: CaptchaSessionStatus | null,
): { title: string; detail: string } | null {
	if (!status) return null;
	const pages = status.pages ?? [];
	const registry = status.registry ?? {};
	const totalPages = pages.length;
	const openPages = pages.filter((p) => p.closed === false).length;
	const registryEntries = Object.values(registry);
	const totalRegistry = registryEntries.length;
	const activeRegistry = registryEntries.filter((r) => r.closed === false).length;
	if (totalPages === 0 && totalRegistry === 0) return null;

	const title = `세션 탭 ${openPages}/${totalPages}`;
	const worker = status.worker_thread_id != null ? String(status.worker_thread_id) : '-';
	const baseDetail = `레지스트리 ${activeRegistry}/${totalRegistry} · 워커 ${worker}`;

	// 구버전 서버 응답(=mode/cdp 미포함)과의 호환성을 위해,
	// mode/cdp 정보가 없으면 기존 포맷을 그대로 유지한다.
	const mode = String(status.mode ?? '').trim();
	const cdp = status.cdp ?? null;
	const hasModeOrCdp = Boolean(mode) || Boolean(cdp);
	if (!hasModeOrCdp) return { title, detail: baseDetail };

	const modeLabel = mode === 'host_cdp' ? 'host_cdp(호스트 크롬 세션)' : mode || 'unknown';
	const cdpHint =
		mode === 'host_cdp'
			? `호스트 Chrome DevTools 사용 (${cdp?.host_http ? `${cdp.host_http}/json/list` : 'json/list'})`
			: '컨테이너 DevTools 사용(19222)';
	const cdpErr = cdp?.lastError ? ` / cdpError=${cdp.lastError}` : '';
	const detail = `${modeLabel} · ${cdpHint}${cdpErr} · ${baseDetail}`;
	return { title, detail };
}

export function getScrapeOnceBodySample(resp: PageMetricsScrapeOnceResponse | null): string | null {
	const s = String((resp?.debug as any)?.body_text_sample ?? '').trim();
	return s ? s : null;
}

export function derivePageMetricsBlockHint(
	resp: PageMetricsScrapeOnceResponse | null,
): { level: 'info' | 'warn'; title: string; detail: string } | null {
	if (!resp) return null;
	const err = String(resp.error ?? '').trim();
	const hs = typeof resp.http_status === 'number' ? resp.http_status : null;
	const body = (getScrapeOnceBodySample(resp) || '').toLowerCase();

	if (err === 'host_cdp_required') {
		const hostHttp = String(((resp?.debug as any)?.cdp as any)?.host_http ?? '').trim();
		const jsonList = hostHttp ? `${hostHttp}/json/list` : '';
		return {
			level: 'warn',
			title: '호스트(내 PC) 크롬 로그인 세션이 필요합니다.',
			detail:
				'현재 수집은 호스트 크롬(CDP) 세션을 강제하도록 설정되어 있습니다.\n' +
				'1) `pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\\dev\\ERP2-analytics\\tools\\collect-via-modal.ps1"` 실행\n' +
				'2) 열린 크롬에서 네이버/스마트스토어에 로그인 후, 쇼핑 페이지를 한 번 접속\n' +
				(jsonList ? `3) 필요 시 DevTools 목록: ${jsonList}\n` : '') +
				'그 다음 “지금 수집(강제)”를 다시 눌러주세요.',
		};
	}

	const looksLikeSecurityReceipt =
		body.includes('보안 확인') ||
		body.includes('영수증') ||
		body.includes('이 절차는 귀하가 실제 사용자임을 확인') ||
		body.includes('갈천길');

	const looksLikeServiceBlocked =
		err === 'service_blocked' ||
		body.includes('현재 서비스 접속이 불가능합니다') ||
		body.includes('에러페이지') ||
		body.includes('시스템오류');

	if (looksLikeServiceBlocked) {
		const mode = String((resp?.debug as any)?.mode ?? '').trim();
		const isHostCdp = mode === 'host_cdp';
		const devtools = (resp?.debug as any)?.devtools_url || (resp?.debug as any)?.json_list_url;
		const sessionLabel = isHostCdp ? '호스트(내 PC) 크롬 세션' : '컨테이너 세션';
		return {
			level: 'warn',
			title: `${sessionLabel}에서 “서비스 접속 불가(차단/오류)” 화면이 감지되었습니다.`,
			detail:
				'네이버가 비정상 트래픽/정책/일시 장애로 상품 페이지 접근을 제한할 때 나타납니다.\n' +
				'해결:\n' +
				' - 호스트 크롬에서 해당 상품 URL을 직접 새로고침/재접속하여 정상 화면이 뜨는지 확인\n' +
				' - 로그인/보안확인(영수증/캡차)이 있으면 먼저 해결\n' +
				' - 회사망/보안SW 환경이면 잠시 대기(5~10분) 후 재시도 또는 네트워크 변경\n' +
				(devtools ? `\nDevTools 힌트: ${String(devtools)}` : '') +
				'\n정상 화면이 뜬 뒤 “NAS 수집/지금 수집”을 다시 눌러주세요.',
		};
	}

	if (looksLikeSecurityReceipt || (err === 'captcha_detected' && hs === 490)) {
		const mode = String((resp?.debug as any)?.mode ?? '').trim();
		const isHostCdp = mode === 'host_cdp';
		const devtools = (resp?.debug as any)?.devtools_url || (resp?.debug as any)?.json_list_url;
		const sessionLabel = isHostCdp ? '호스트(내 PC) 크롬 세션' : '컨테이너 세션';
		return {
			level: 'warn',
			title: `${sessionLabel}이 “보안 확인(영수증)” 화면을 보고 있어 수집이 실패했습니다.`,
			detail:
				`${isHostCdp ? '호스트 크롬(CDP) 모드에서는 호스트 DevTools에서 캡차를 풀어야 합니다.' : '컨테이너 모드에서는 컨테이너 DevTools에서 캡차를 풀어야 합니다.'}` +
				(devtools ? `\nDevTools 힌트: ${String(devtools)}` : '') +
				'\n캡차/접속 제한을 해결한 뒤 “지금 수집(강제)”를 다시 눌러주세요.',
		};
	}

	if (err && err !== 'parse_failed') {
		const mode = String((resp?.debug as any)?.mode ?? '').trim();
		const isHostCdp = mode === 'host_cdp';
		const sessionLabel = isHostCdp ? '호스트(내 PC) 크롬 세션' : '컨테이너 세션';
		return {
			level: 'warn',
			title: `${sessionLabel}에서 페이지 수집이 아직 정상 상태가 아닙니다.`,
			detail: `error=${err}${hs != null ? ` / http=${hs}` : ''}`,
		};
	}

	return null;
}


