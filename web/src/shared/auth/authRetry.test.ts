import { describe, expect, it, vi } from 'vitest';
import {
	authRetryGet,
	authRetryPost,
	authRetryRequest,
	buildRoleProtectedHeaders,
	isRoleProtectedAuthError,
} from './authRetry';

describe('authRetry', () => {
	it('토큰이 있으면 Bearer Authorization 헤더를 만든다', async () => {
		const getIdToken = vi.fn(async (options?: { forceRefresh?: boolean }) =>
			options?.forceRefresh ? 'token-refreshed' : 'token-initial',
		);
		await expect(buildRoleProtectedHeaders(getIdToken, false)).resolves.toEqual({ Authorization: 'Bearer token-initial' });
		await expect(buildRoleProtectedHeaders(getIdToken, true)).resolves.toEqual({ Authorization: 'Bearer token-refreshed' });
	});

	it('권한 보호 인증 오류를 감지한다', () => {
		expect(isRoleProtectedAuthError({ response: { status: 401 } })).toBe(true);
		expect(isRoleProtectedAuthError({ response: { status: 403 } })).toBe(true);
		expect(isRoleProtectedAuthError({ response: { data: { detail: 'token_verification_failed:InvalidIdTokenError' } } })).toBe(true);
		expect(isRoleProtectedAuthError({ message: 'InvalidIdTokenError' })).toBe(true);
		expect(isRoleProtectedAuthError({ response: { status: 500 }, message: 'server error' })).toBe(false);
	});

	it('GET 요청은 auth 오류에서 한 번 forceRefresh 재시도한다', async () => {
		const getIdToken = vi
			.fn()
			.mockResolvedValueOnce('token-1')
			.mockResolvedValueOnce('token-2');
		const client = {
			get: vi
				.fn()
				.mockRejectedValueOnce({ response: { status: 401, data: { detail: 'token_verification_failed' } } })
				.mockResolvedValueOnce({ data: { ok: true } }),
			post: vi.fn(),
		};

		const res = await authRetryGet<{ ok: boolean }>(client, getIdToken, '/secure', { params: { a: 1 } });

		expect(res.data.ok).toBe(true);
		expect(client.get).toHaveBeenCalledTimes(2);
		expect(getIdToken.mock.calls).toEqual([[{ forceRefresh: false }], [{ forceRefresh: true }]]);
	});

	it('POST 요청은 비인증 오류면 재시도하지 않는다', async () => {
		const getIdToken = vi.fn().mockResolvedValue('token-1');
		const error = { response: { status: 400, data: { detail: 'bad request' } } };
		const client = {
			get: vi.fn(),
			post: vi.fn().mockRejectedValue(error),
		};

		await expect(authRetryPost(client, getIdToken, '/secure', { ok: true })).rejects.toBe(error);
		expect(client.post).toHaveBeenCalledTimes(1);
	});

	it('공용 request helper는 GET/POST를 모두 처리한다', async () => {
		const getIdToken = vi.fn().mockResolvedValue('token-1');
		const client = {
			get: vi.fn().mockResolvedValue({ data: { mode: 'get' } }),
			post: vi.fn().mockResolvedValue({ data: { mode: 'post' } }),
		};

		const getRes = await authRetryRequest<{ mode: string }>(client, getIdToken, 'get', '/a', { params: { q: '1' } });
		const postRes = await authRetryRequest<{ mode: string }>(client, getIdToken, 'post', '/b', { body: { q: '2' } });

		expect(getRes.data.mode).toBe('get');
		expect(postRes.data.mode).toBe('post');
	});
});
