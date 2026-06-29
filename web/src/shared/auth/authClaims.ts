export type AnalyticsRoleId = 'superadmin' | 'ops_admin' | 'accounting' | 'sales' | 'marketing';

export function decodeJwtPayload(token: string): any | null {
	try {
		const parts = String(token || '').split('.');
		if (parts.length < 2) return null;
		let p = parts[1] || '';
		p = p.replace(/-/g, '+').replace(/_/g, '/');
		const pad = p.length % 4;
		if (pad === 2) p += '==';
		else if (pad === 3) p += '=';
		else if (pad === 1) return null;
		return JSON.parse(atob(p));
	} catch {
		return null;
	}
}

export function normalizeAnalyticsRolesFromClaims(input: { role?: unknown; roles?: unknown }): AnalyticsRoleId[] {
	const out = new Set<AnalyticsRoleId>();
	const rawRoles = Array.isArray((input as any)?.roles) ? ((input as any).roles as any[]) : [];
	for (const one of rawRoles) {
		let value = String(one ?? '').trim().toLowerCase();
		if (!value) continue;
		if (value === 'admin') value = 'superadmin';
		if (value === 'superadmin' || value === 'ops_admin' || value === 'accounting' || value === 'sales' || value === 'marketing') {
			out.add(value as AnalyticsRoleId);
		}
	}
	if (!out.size) {
		const legacy = String((input as any)?.role ?? '').trim().toLowerCase();
		if (legacy === 'admin') out.add('superadmin');
		if (legacy === 'accounting' || legacy === 'sales' || legacy === 'marketing') out.add(legacy as AnalyticsRoleId);
	}
	return Array.from(out);
}

export function primaryAnalyticsRole(roles: Array<string | null | undefined>): AnalyticsRoleId | '' {
	const normalized = new Set((roles || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
	if (normalized.has('superadmin')) return 'superadmin';
	if (normalized.has('ops_admin')) return 'ops_admin';
	if (normalized.has('accounting')) return 'accounting';
	if (normalized.has('sales')) return 'sales';
	if (normalized.has('marketing')) return 'marketing';
	return '';
}
