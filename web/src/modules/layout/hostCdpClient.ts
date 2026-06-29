function stripPort(hostOrIp: string): string {
	const s = String(hostOrIp || '').trim();
	if (!s) return '';
	// ipv6는 여기서 다루지 않는다(현재 UI/서버 모두 IPv4 private 대역 전제)
	const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(s);
	return m?.[1] ?? s;
}

export function rewriteCdpHttpUrlForNas(inputUrl: string, pcIp: string): string {
	const raw = String(inputUrl || '').trim();
	if (!raw) return '';
	const ip = stripPort(pcIp);
	if (!isPrivateOrLoopbackIpv4(ip)) return raw;
	try {
		const u = new URL(raw);
		const host = String(u.hostname || '').trim().toLowerCase();
		if (host === '127.0.0.1' || host === 'localhost') {
			u.hostname = ip;
			return u.toString();
		}
		return raw;
	} catch {
		// fallback: very small best-effort replacement for non-URL strings
		return raw
			.replace(/^http:\/\/127\.0\.0\.1(?=:\d+|\/|$)/, `http://${ip}`)
			.replace(/^http:\/\/localhost(?=:\d+|\/|$)/, `http://${ip}`);
	}
}

export type DiscoverHostCdpResponse = {
	found?: boolean;
	ip?: string | null;
};

export function isValidIpv4(ip: string): boolean {
	const s = stripPort(ip);
	const parts = s.split('.');
	if (parts.length !== 4) return false;
	return parts.every((p) => {
		if (!/^\d{1,3}$/.test(p)) return false;
		const n = Number(p);
		return Number.isFinite(n) && n >= 0 && n <= 255;
	});
}

export function isPrivateOrLoopbackIpv4(ip: string): boolean {
	const s = stripPort(ip);
	if (!isValidIpv4(s)) return false;
	if (s === '127.0.0.1') return true;
	const parts = s.split('.').map((x) => Number(x));
	const a = parts[0] ?? -1;
	const b = parts[1] ?? -1;
	// RFC1918
	if (a === 10) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	return false;
}

export function isSameIpv4Subnet24(ip: string, hostOrIp: string): boolean {
	const a0 = stripPort(ip);
	const b0 = stripPort(hostOrIp);
	if (!isValidIpv4(a0) || !isValidIpv4(b0)) return false;
	const aa = a0.split('.');
	const bb = b0.split('.');
	return aa[0] === bb[0] && aa[1] === bb[1] && aa[2] === bb[2];
}

export function isRoutableNasHostCdpIpv4(ip: string, nasHost: string): boolean {
	const s = stripPort(ip);
	if (!isPrivateOrLoopbackIpv4(s)) return false;
	// NAS 모드에서 127.0.0.1/localhost는 사용자의 PC가 아니라 NAS 자신을 가리키므로 제외한다.
	if (s === '127.0.0.1') return false;
	const nas = stripPort(nasHost);
	if (!isValidIpv4(nas)) return true;
	return isSameIpv4Subnet24(s, nas);
}

export function deriveCidr24FromIpv4Host(hostOrIp: string): string | null {
	const s0 = stripPort(hostOrIp);
	if (!isValidIpv4(s0)) return null;
	const parts = s0.split('.');
	return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export function buildErp2ClientIpHeaders(ip: string | null | undefined): Record<string, string> | undefined {
	const s = String(ip || '').trim();
	if (!s) return undefined;
	if (!isPrivateOrLoopbackIpv4(s)) return undefined;
	return { 'x-erp2-client-ip': stripPort(s) };
}

export async function discoverNasHostCdpIp(params: {
	currentIp?: string | null;
	nasHost?: string | null;
	requestLocalAgent?: () => Promise<string | null>;
	request: (cidr?: string) => Promise<DiscoverHostCdpResponse>;
	allowCached?: boolean;
}): Promise<string | null> {
	const nasHost = String(params.nasHost || '').trim();
	const currentIp = String(params.currentIp || '').trim();
	if (params.allowCached !== false && currentIp && isRoutableNasHostCdpIpv4(currentIp, nasHost)) return stripPort(currentIp);

	try {
		const agentIp = stripPort(String((await params.requestLocalAgent?.()) || '').trim());
		if (agentIp && isRoutableNasHostCdpIpv4(agentIp, nasHost)) return agentIp;
	} catch {
		// localhost host-agent가 없거나 구버전일 수 있으므로, 서버 추정/스캔으로 계속 진행한다.
	}

	try {
		const res = await params.request();
		const found = Boolean(res?.found);
		const ip = stripPort(String(res?.ip || '').trim());
		if (found && ip && isRoutableNasHostCdpIpv4(ip, nasHost)) return ip;
	} catch {
		// 후보 헤더가 없는 환경에서는 cidr_required(400)로 끝날 수 있으므로, 곧바로 대역 스캔으로 폴백한다.
	}

	const cidr = deriveCidr24FromIpv4Host(nasHost);
	if (!cidr) return null;

	try {
		const res = await params.request(cidr);
		const found = Boolean(res?.found);
		const ip = stripPort(String(res?.ip || '').trim());
		if (found && ip && isRoutableNasHostCdpIpv4(ip, nasHost)) return ip;
	} catch {
		// ignore
	}
	return null;
}

