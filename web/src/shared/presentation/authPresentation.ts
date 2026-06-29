import type { AnalyticsRoleId } from '../auth/authClaims';

export function labelAnalyticsRole(role: string | null | undefined, fallback = '-'): string {
	const value = String(role || '').trim().toLowerCase();
	if (value === 'superadmin') return '슈퍼관리자';
	if (value === 'ops_admin') return '운영관리자';
	if (value === 'accounting') return '회계';
	if (value === 'sales') return '영업';
	if (value === 'marketing') return '마케팅';
	return value || fallback;
}

export function appShellAnalyticsRoleChipClass(role: string | null | undefined): string {
	const value = String(role || '').trim().toLowerCase();
	if (value === 'superadmin') return 'role-superadmin';
	if (value === 'ops_admin') return 'role-admin';
	if (value === 'accounting') return 'role-user';
	if (value === 'sales') return 'role-user';
	if (value === 'marketing') return 'role-user';
	return 'role-none';
}

export function userManagementRoleChipClass(role: AnalyticsRoleId | 'user'): string {
	if (role === 'superadmin') return 'chip superadmin';
	if (role === 'ops_admin') return 'chip ops_admin';
	if (role === 'accounting') return 'chip accounting';
	if (role === 'sales') return 'chip sales';
	if (role === 'marketing') return 'chip marketing';
	return 'chip user';
}
