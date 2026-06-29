type SessionPrepDebugSummary = {
	title: string;
	lines: string[];
} | null;

function pickLine(lines: string[], prefix: string): string {
	return lines.find((line) => String(line || '').startsWith(prefix)) ?? '';
}

function prettifySummaryLine(line: string): string {
	const raw = String(line || '').trim();
	if (!raw) return '';
	if (raw.startsWith('cdp.lastErrorDetail=')) return `상세: ${raw.slice('cdp.lastErrorDetail='.length)}`;
	if (raw.startsWith('cdp.lastError=')) return `CDP 오류: ${raw.slice('cdp.lastError='.length)}`;
	if (raw.startsWith('nas.override_url=')) return `대상 CDP 주소: ${raw.slice('nas.override_url='.length)}`;
	if (raw.startsWith('nas.override_http_error=')) return `NAS override probe 오류: ${raw.slice('nas.override_http_error='.length)}`;
	if (raw.startsWith('nas.override_http_ok=')) return `NAS override probe 결과: ${raw.slice('nas.override_http_ok='.length)}`;
	if (raw.startsWith('cdp.container_http_reachable=')) return `컨테이너->호스트 연결: ${raw.slice('cdp.container_http_reachable='.length)}`;
	return raw;
}

export function formatSessionPrepErrorMessage(
	rawMessage: unknown,
	debugSummary?: SessionPrepDebugSummary,
): string {
	const base = String(rawMessage || '').trim() || '호스트 크롬 세션 탭 열기에 실패했습니다.';
	const lines = Array.isArray(debugSummary?.lines) ? debugSummary!.lines.filter(Boolean) : [];
	const detailCandidates = [
		pickLine(lines, 'cdp.lastErrorDetail='),
		pickLine(lines, 'nas.override_http_error='),
		pickLine(lines, 'nas.override_http_ok='),
		pickLine(lines, 'cdp.container_http_reachable='),
		pickLine(lines, 'nas.override_url='),
	]
		.map(prettifySummaryLine)
		.filter(Boolean);

	if (base.includes('host_cdp_required')) {
		return [
			'호스트 Chrome(CDP) 연결이 필요하지만 서버가 세션을 열지 못했습니다.',
			debugSummary?.title ? `진단: ${debugSummary.title}` : '',
			...detailCandidates,
		]
			.filter(Boolean)
			.join('\n');
	}

	if (base === 'Request failed with status code 503' && debugSummary) {
		return [
			'NAS 세션 준비가 503으로 중단되었습니다.',
			`진단: ${debugSummary.title}`,
			...detailCandidates,
		]
			.filter(Boolean)
			.join('\n');
	}

	return base;
}
