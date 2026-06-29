import type { AuthClient, AuthUser, AuthStateListener } from './authClient';

type FirebaseEnv = { apiKey: string };

type StoredSession = {
	idToken: string;
	refreshToken: string;
	expiresAtMs: number;
	uid: string;
	email: string | null;
	displayName: string | null;
};

const LS_KEY = 'analytics:firebase_session_v1';

function readFirebaseEnv(): FirebaseEnv | null {
	// ERP(web)에서 사용하는 VITE_FIREBASE_* 네이밍을 그대로 재사용한다.
	const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
	if (!apiKey) return null;
	return { apiKey };
}

function safeJsonParse<T>(s: string | null): T | null {
	try {
		if (!s) return null;
		return JSON.parse(s) as T;
	} catch {
		return null;
	}
}

function loadSession(): StoredSession | null {
	try {
		const raw = window.localStorage.getItem(LS_KEY);
		const s = safeJsonParse<StoredSession>(raw);
		if (!s?.idToken || !s?.refreshToken || !s?.expiresAtMs) return null;
		return s;
	} catch {
		return null;
	}
}

function saveSession(s: StoredSession | null): void {
	try {
		if (!s) {
			window.localStorage.removeItem(LS_KEY);
			return;
		}
		window.localStorage.setItem(LS_KEY, JSON.stringify(s));
	} catch {
		// ignore
	}
}

function mapUserFromSession(s: StoredSession): AuthUser {
	return {
		uid: String(s.uid || ''),
		email: s.email ? String(s.email) : null,
		displayName: s.displayName ? String(s.displayName) : null,
	};
}

function mapFirebaseAuthErrorMessage(code: unknown): string {
	const c = String(code || '').trim();
	// Firebase Identity Toolkit error codes:
	// https://firebase.google.com/docs/reference/rest/auth#section-sign-in-email-password
	switch (c) {
		case 'INVALID_LOGIN_CREDENTIALS':
		case 'INVALID_PASSWORD':
		case 'EMAIL_NOT_FOUND':
			return '이메일 또는 비밀번호가 올바르지 않습니다.';
		case 'USER_DISABLED':
			return '이 계정은 비활성화되어 있습니다. 관리자에게 문의해 주세요.';
		case 'TOO_MANY_ATTEMPTS_TRY_LATER':
			return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
		case 'OPERATION_NOT_ALLOWED':
			return '이 Firebase 프로젝트에서 이메일/비밀번호 로그인이 비활성화되어 있습니다.';
		default:
			return c || '로그인에 실패했습니다.';
	}
}

async function signInWithPassword(params: { apiKey: string; email: string; password: string }): Promise<StoredSession> {
	const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(params.apiKey)}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: params.email, password: params.password, returnSecureToken: true }),
	});
	const data: any = await res.json().catch(() => ({}));
	if (!res.ok) {
		const msg = mapFirebaseAuthErrorMessage(data?.error?.message);
		throw new Error(msg);
	}
	const expiresInSec = Number(data?.expiresIn || 0);
	const expiresAtMs = Date.now() + Math.max(0, Math.trunc(expiresInSec * 1000) - 10_000);
	return {
		idToken: String(data?.idToken || ''),
		refreshToken: String(data?.refreshToken || ''),
		expiresAtMs,
		uid: String(data?.localId || ''),
		email: data?.email ? String(data.email) : null,
		displayName: data?.displayName ? String(data.displayName) : null,
	};
}

async function refreshIdToken(params: { apiKey: string; refreshToken: string }): Promise<{ idToken: string; refreshToken: string; expiresAtMs: number }> {
	const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(params.apiKey)}`;
	const body = new URLSearchParams();
	body.set('grant_type', 'refresh_token');
	body.set('refresh_token', params.refreshToken);
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
	const data: any = await res.json().catch(() => ({}));
	if (!res.ok) {
		// securetoken 응답은 error가 string일 때도 있어 보수적으로 처리
		const msg = mapFirebaseAuthErrorMessage(data?.error || data?.error?.message);
		throw new Error(msg || '토큰 갱신에 실패했습니다.');
	}
	const expiresInSec = Number(data?.expires_in || 0);
	const expiresAtMs = Date.now() + Math.max(0, Math.trunc(expiresInSec * 1000) - 10_000);
	return {
		idToken: String(data?.id_token || ''),
		refreshToken: String(data?.refresh_token || params.refreshToken),
		expiresAtMs,
	};
}

/**
 * Firebase 인증(ERP와 동일 프로젝트) 구현체(REST 기반).
 *
 * - firebase SDK 의존성을 없애 “윈도우 npm 설치/권한 이슈”를 피한다.
 * - Firebase 프로젝트는 ERP와 동일(VITE_FIREBASE_API_KEY 재사용).
 * - ID token은 localStorage에 저장하고 만료 시 refresh token으로 갱신한다.
 */
export function createFirebaseAuthClient(): AuthClient {
	const env = readFirebaseEnv();
	if (!env) {
		// 중요:
		// - 빌드/배포 환경에서 VITE_FIREBASE_API_KEY가 누락되면 앱이 렌더링 단계에서 throw 하며 "빈 화면"이 된다.
		// - 여기서는 throw 하지 말고 "비활성 클라이언트"를 반환해 UI가 에러 메시지를 표시할 수 있게 한다.
		const msg = 'Firebase 설정이 없습니다. VITE_FIREBASE_API_KEY 를 설정해 주세요.';
		return {
			getCurrentUser: () => null,
			onAuthStateChanged: (cb) => {
				try {
					cb(null);
				} catch {
					// ignore
				}
				return () => {};
			},
			signInWithEmailPassword: async () => {
				throw new Error(msg);
			},
			signOut: async () => {},
			getIdToken: async () => null,
		};
	}

	let current: StoredSession | null = null;
	let listeners: AuthStateListener[] = [];

	const emit = () => {
		const u = current ? mapUserFromSession(current) : null;
		for (const cb of listeners) {
			try {
				cb(u);
			} catch {
				// ignore
			}
		}
	};

	// 초기 로드
	try {
		current = loadSession();
	} catch {
		current = null;
	}

	const getCurrentUser = (): AuthUser | null => {
		return current ? mapUserFromSession(current) : null;
	};

	const onAuthStateChanged = (cb: AuthStateListener) => {
		listeners = listeners.concat([cb]);
		// 즉시 1회 호출
		try {
			cb(getCurrentUser());
		} catch {
			// ignore
		}
		return () => {
			listeners = listeners.filter((x) => x !== cb);
		};
	};

	const signInWithEmailPassword = async (email: string, password: string) => {
		const e = String(email || '').trim().toLowerCase();
		const p = String(password ?? '');
		const s = await signInWithPassword({ apiKey: env.apiKey, email: e, password: p });
		current = s;
		saveSession(s);
		emit();
		return mapUserFromSession(s);
	};

	const signOut = async () => {
		current = null;
		saveSession(null);
		emit();
	};

	const getIdToken = async (opts?: { forceRefresh?: boolean }) => {
		if (!current?.idToken) return null;
		const force = Boolean(opts?.forceRefresh);
		const now = Date.now();
		if (!force && Number(current.expiresAtMs || 0) > now) {
			return current.idToken;
		}
		try {
			const next = await refreshIdToken({ apiKey: env.apiKey, refreshToken: current.refreshToken });
			current = { ...current, idToken: next.idToken, refreshToken: next.refreshToken, expiresAtMs: next.expiresAtMs };
			saveSession(current);
			return current.idToken;
		} catch {
			// 갱신 실패 시 세션을 정리(다시 로그인 유도)
			current = null;
			saveSession(null);
			emit();
			return null;
		}
	};

	return {
		getCurrentUser,
		onAuthStateChanged,
		signInWithEmailPassword,
		signOut,
		getIdToken,
	};
}

