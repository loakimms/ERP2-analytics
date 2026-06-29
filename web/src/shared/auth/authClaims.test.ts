import { describe, expect, it } from 'vitest';
import {
	decodeJwtPayload,
	normalizeAnalyticsRolesFromClaims,
	primaryAnalyticsRole,
} from './authClaims';

function makeJwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
	return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

describe('authClaims', () => {
	it('JWT payload를 안전하게 decode한다', () => {
		expect(decodeJwtPayload(makeJwt({ roles: ['ops_admin'] }))).toMatchObject({ roles: ['ops_admin'] });
		expect(decodeJwtPayload('invalid.token')).toBeNull();
		expect(decodeJwtPayload('')).toBeNull();
	});

	it('claims에서 analytics roles를 정규화한다', () => {
		expect(normalizeAnalyticsRolesFromClaims({ roles: ['ops_admin', 'marketing'] })).toEqual(['ops_admin', 'marketing']);
		expect(normalizeAnalyticsRolesFromClaims({ roles: ['admin', 'unknown'] })).toEqual(['superadmin']);
		expect(normalizeAnalyticsRolesFromClaims({ role: 'admin' })).toEqual(['superadmin']);
		expect(normalizeAnalyticsRolesFromClaims({ role: 'sales' })).toEqual(['sales']);
		expect(normalizeAnalyticsRolesFromClaims({ roles: ['marketing'], role: 'sales' })).toEqual(['marketing']);
	});

	it('analytics roles에서 primary role을 우선순위대로 선택한다', () => {
		expect(primaryAnalyticsRole(['marketing', 'ops_admin'])).toBe('ops_admin');
		expect(primaryAnalyticsRole(['sales', 'superadmin'])).toBe('superadmin');
		expect(primaryAnalyticsRole(['accounting'])).toBe('accounting');
		expect(primaryAnalyticsRole([])).toBe('');
	});
});
