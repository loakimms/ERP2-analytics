import { describe, expect, it } from 'vitest';
import {
	appShellAnalyticsRoleChipClass,
	labelAnalyticsRole,
	userManagementRoleChipClass,
} from './authPresentation';

describe('authPresentation', () => {
	it('analytics role을 한국어 라벨로 변환한다', () => {
		expect(labelAnalyticsRole('superadmin')).toBe('슈퍼관리자');
		expect(labelAnalyticsRole('ops_admin')).toBe('운영관리자');
		expect(labelAnalyticsRole('marketing')).toBe('마케팅');
		expect(labelAnalyticsRole('')).toBe('-');
		expect(labelAnalyticsRole('unknown', 'unknown')).toBe('unknown');
	});

	it('AppShell role chip class를 반환한다', () => {
		expect(appShellAnalyticsRoleChipClass('superadmin')).toBe('role-superadmin');
		expect(appShellAnalyticsRoleChipClass('ops_admin')).toBe('role-admin');
		expect(appShellAnalyticsRoleChipClass('sales')).toBe('role-user');
		expect(appShellAnalyticsRoleChipClass('')).toBe('role-none');
	});

	it('UserManagement role chip class를 반환한다', () => {
		expect(userManagementRoleChipClass('superadmin')).toBe('chip superadmin');
		expect(userManagementRoleChipClass('ops_admin')).toBe('chip ops_admin');
		expect(userManagementRoleChipClass('marketing')).toBe('chip marketing');
		expect(userManagementRoleChipClass('user')).toBe('chip user');
	});
});
