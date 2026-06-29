import axios from 'axios';

export type GetIdTokenLike =
	| ((options?: { forceRefresh?: boolean }) => Promise<string | null | undefined> | undefined)
	| null
	| undefined;

type AuthRetryClient = Pick<typeof axios, 'get' | 'post'>;

export function isRoleProtectedAuthError(error: any): boolean {
	const status = Number(error?.response?.status || 0);
	if (status === 401 || status === 403) return true;
	const detail = String(error?.response?.data?.detail ?? error?.message ?? '').toLowerCase();
	return detail.includes('token_verification_failed') || detail.includes('invalididtokenerror');
}

export async function buildRoleProtectedHeaders(
	getIdToken: GetIdTokenLike,
	forceRefresh = false,
): Promise<Record<string, string>> {
	try {
		const token = await getIdToken?.({ forceRefresh });
		return token ? { Authorization: `Bearer ${token}` } : {};
	} catch {
		return {};
	}
}

async function buildRoleProtectedHeadersWithRefreshFallback(getIdToken: GetIdTokenLike): Promise<Record<string, string>> {
	const headers = await buildRoleProtectedHeaders(getIdToken, false);
	if (headers.Authorization) return headers;
	return await buildRoleProtectedHeaders(getIdToken, true);
}

export async function authRetryGet<T>(
	client: AuthRetryClient,
	getIdToken: GetIdTokenLike,
	url: string,
	config?: Record<string, any>,
): Promise<{ data: T }> {
	const request = async (forceRefresh = false) =>
		await client.get(url, {
			...(config || {}),
			headers: forceRefresh
				? await buildRoleProtectedHeaders(getIdToken, true)
				: await buildRoleProtectedHeadersWithRefreshFallback(getIdToken),
		});
	try {
		return (await request(false)) as { data: T };
	} catch (requestError: any) {
		if (!isRoleProtectedAuthError(requestError)) throw requestError;
		return (await request(true)) as { data: T };
	}
}

export async function authRetryPost<T>(
	client: AuthRetryClient,
	getIdToken: GetIdTokenLike,
	url: string,
	body?: any,
	config?: Record<string, any>,
): Promise<{ data: T }> {
	const request = async (forceRefresh = false) =>
		await client.post(url, body, {
			...(config || {}),
			headers: forceRefresh
				? await buildRoleProtectedHeaders(getIdToken, true)
				: await buildRoleProtectedHeadersWithRefreshFallback(getIdToken),
		});
	try {
		return (await request(false)) as { data: T };
	} catch (requestError: any) {
		if (!isRoleProtectedAuthError(requestError)) throw requestError;
		return (await request(true)) as { data: T };
	}
}

export async function authRetryRequest<T>(
	client: AuthRetryClient,
	getIdToken: GetIdTokenLike,
	method: 'get' | 'post',
	url: string,
	options?: {
		body?: any;
		params?: Record<string, any>;
		config?: Record<string, any>;
	},
): Promise<{ data: T }> {
	if (method === 'get') {
		return await authRetryGet<T>(client, getIdToken, url, {
			...(options?.config || {}),
			params: options?.params,
		});
	}
	return await authRetryPost<T>(client, getIdToken, url, options?.body, {
		...(options?.config || {}),
		params: options?.params,
	});
}
