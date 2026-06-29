import { describe, expect, it } from 'vitest';
import {
	buildErp2ClientIpHeaders,
	discoverNasHostCdpIp,
	deriveCidr24FromIpv4Host,
	isPrivateOrLoopbackIpv4,
	isRoutableNasHostCdpIpv4,
	isSameIpv4Subnet24,
	isValidIpv4,
	rewriteCdpHttpUrlForNas,
} from './hostCdpClient';

describe('hostCdpClient', () => {
	it('isValidIpv4', () => {
		expect(isValidIpv4('127.0.0.1')).toBe(true);
		expect(isValidIpv4('192.168.0.50')).toBe(true);
		expect(isValidIpv4('192.168.0.50:6188')).toBe(true);
		expect(isValidIpv4('999.1.1.1')).toBe(false);
		expect(isValidIpv4('abc')).toBe(false);
	});

	it('isPrivateOrLoopbackIpv4', () => {
		expect(isPrivateOrLoopbackIpv4('127.0.0.1')).toBe(true);
		expect(isPrivateOrLoopbackIpv4('10.0.0.12')).toBe(true);
		expect(isPrivateOrLoopbackIpv4('172.16.0.1')).toBe(true);
		expect(isPrivateOrLoopbackIpv4('172.32.0.1')).toBe(false);
		expect(isPrivateOrLoopbackIpv4('192.168.0.50')).toBe(true);
		expect(isPrivateOrLoopbackIpv4('8.8.8.8')).toBe(false);
	});

	it('deriveCidr24FromIpv4Host', () => {
		expect(deriveCidr24FromIpv4Host('192.168.0.50')).toBe('192.168.0.0/24');
		expect(deriveCidr24FromIpv4Host('192.168.0.50:6188')).toBe('192.168.0.0/24');
		expect(deriveCidr24FromIpv4Host('localhost')).toBe(null);
	});

	it('isSameIpv4Subnet24', () => {
		expect(isSameIpv4Subnet24('192.168.0.105', '192.168.0.50')).toBe(true);
		expect(isSameIpv4Subnet24('172.20.0.1', '192.168.0.50')).toBe(false);
	});

	it('isRoutableNasHostCdpIpv4', () => {
		expect(isRoutableNasHostCdpIpv4('192.168.0.105', '192.168.0.50')).toBe(true);
		expect(isRoutableNasHostCdpIpv4('172.20.0.1', '192.168.0.50')).toBe(false);
		expect(isRoutableNasHostCdpIpv4('127.0.0.1', '192.168.0.50')).toBe(false);
	});

	it('buildErp2ClientIpHeaders', () => {
		expect(buildErp2ClientIpHeaders(null)).toBe(undefined);
		expect(buildErp2ClientIpHeaders('')).toBe(undefined);
		expect(buildErp2ClientIpHeaders('8.8.8.8')).toBe(undefined);
		expect(buildErp2ClientIpHeaders('192.168.0.50')).toEqual({ 'x-erp2-client-ip': '192.168.0.50' });
		expect(buildErp2ClientIpHeaders('192.168.0.50:6188')).toEqual({ 'x-erp2-client-ip': '192.168.0.50' });
	});

	it('rewriteCdpHttpUrlForNas rewrites localhost to pc ip', () => {
		expect(rewriteCdpHttpUrlForNas('http://127.0.0.1:9223/json/list', '192.168.0.52')).toBe('http://192.168.0.52:9223/json/list');
		expect(rewriteCdpHttpUrlForNas('http://localhost:9223/json/list', '192.168.0.52')).toBe('http://192.168.0.52:9223/json/list');
		// non-private ip should not rewrite
		expect(rewriteCdpHttpUrlForNas('http://127.0.0.1:9223/json/list', '8.8.8.8')).toBe('http://127.0.0.1:9223/json/list');
		// already ip-based should keep as-is
		expect(rewriteCdpHttpUrlForNas('http://192.168.0.52:9223/json/list', '192.168.0.52')).toBe('http://192.168.0.52:9223/json/list');
	});

	it('discoverNasHostCdpIp falls back to cidr scan when first probe errors', async () => {
		const calls: Array<string | undefined> = [];
		const out = await discoverNasHostCdpIp({
			currentIp: '',
			nasHost: '192.168.0.50',
			request: async (cidr?: string) => {
				calls.push(cidr);
				if (!cidr) throw new Error('cidr_required');
				return { found: true, ip: '192.168.0.105' };
			},
		});
		expect(out).toBe('192.168.0.105');
		expect(calls).toEqual([undefined, '192.168.0.0/24']);
	});

	it('discoverNasHostCdpIp returns current cached ip when valid', async () => {
		const out = await discoverNasHostCdpIp({
			currentIp: '192.168.0.105',
			nasHost: '192.168.0.50',
			request: async () => ({ found: false, ip: null }),
		});
		expect(out).toBe('192.168.0.105');
	});

	it('discoverNasHostCdpIp prefers localhost host-agent LAN ip when available', async () => {
		const calls: Array<string | undefined> = [];
		const out = await discoverNasHostCdpIp({
			currentIp: '',
			nasHost: '192.168.0.50',
			requestLocalAgent: async () => '192.168.0.23',
			request: async (cidr?: string) => {
				calls.push(cidr);
				return { found: false, ip: null };
			},
		});
		expect(out).toBe('192.168.0.23');
		expect(calls).toEqual([]);
	});

	it('discoverNasHostCdpIp ignores localhost host-agent bridge ip', async () => {
		const calls: Array<string | undefined> = [];
		const out = await discoverNasHostCdpIp({
			currentIp: '',
			nasHost: '192.168.0.50',
			requestLocalAgent: async () => '172.20.0.1',
			request: async (cidr?: string) => {
				calls.push(cidr);
				if (!cidr) return { found: false, ip: null };
				return { found: true, ip: '192.168.0.105' };
			},
		});
		expect(out).toBe('192.168.0.105');
		expect(calls).toEqual([undefined, '192.168.0.0/24']);
	});

	it('discoverNasHostCdpIp ignores cached bridge ip and falls back to same lan scan', async () => {
		const calls: Array<string | undefined> = [];
		const out = await discoverNasHostCdpIp({
			currentIp: '172.20.0.1',
			nasHost: '192.168.0.50',
			request: async (cidr?: string) => {
				calls.push(cidr);
				if (!cidr) return { found: true, ip: '172.20.0.1' };
				return { found: true, ip: '192.168.0.105' };
			},
		});
		expect(out).toBe('192.168.0.105');
		expect(calls).toEqual([undefined, '192.168.0.0/24']);
	});

	it('discoverNasHostCdpIp refreshes even when cached ip exists if allowCached=false', async () => {
		const calls: Array<string | undefined> = [];
		const out = await discoverNasHostCdpIp({
			currentIp: '192.168.0.105',
			nasHost: '192.168.0.50',
			allowCached: false,
			request: async (cidr?: string) => {
				calls.push(cidr);
				return { found: true, ip: '192.168.0.110' };
			},
		});
		expect(out).toBe('192.168.0.110');
		expect(calls).toEqual([undefined]);
	});
});

