import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthClient, AuthUser } from './authClient';
import { createFirebaseAuthClient } from './firebaseAuthClient';
import { installAxiosBearerToken } from './setupAxiosAuth';

type AuthContextValue = {
	loading: boolean;
	user: AuthUser | null;
	error: string | null;
	signIn: (email: string, password: string) => Promise<void>;
	signOut: () => Promise<void>;
	getIdToken: (opts?: { forceRefresh?: boolean }) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
	const v = useContext(AuthContext);
	if (!v) throw new Error('useAuth must be used within AuthProvider');
	return v;
}

/**
 * Provider 밖에서도 화면이 “크래시”하지 않도록, optional hook을 제공한다.
 * - 예: 단순 라우팅/메뉴 테스트에서 AuthProvider를 감싸지 않는 경우
 */
export function useMaybeAuth(): AuthContextValue | null {
	return useContext(AuthContext);
}

export function AuthProvider(props: {
	children: React.ReactNode;
	/**
	 * 테스트에서 fake AuthClient를 주입할 수 있게 열어둔다.
	 */
	client?: AuthClient;
}): JSX.Element {
	const client = useMemo(() => props.client ?? createFirebaseAuthClient(), [props.client]);
	const [loading, setLoading] = useState(true);
	const [user, setUser] = useState<AuthUser | null>(null);
	const [error, setError] = useState<string | null>(null);

	// axios interceptor는 1번만 설치하고, token getter만 최신으로 유지한다.
	const getTokenRef = useRef<() => Promise<string | null>>(() => Promise.resolve(null));
	getTokenRef.current = async () => {
		try {
			return await client.getIdToken();
		} catch {
			return null;
		}
	};

	useEffect(() => {
		const eject = installAxiosBearerToken(() => getTokenRef.current());
		return () => eject();
	}, []);

	useEffect(() => {
		setLoading(true);
		setError(null);
		const unsub = client.onAuthStateChanged((u) => {
			setUser(u);
			setLoading(false);
		});
		return () => {
			try {
				unsub?.();
			} catch {
				// ignore
			}
		};
	}, [client]);

	const value = useMemo<AuthContextValue>(() => {
		return {
			loading,
			user,
			error,
			signIn: async (email: string, password: string) => {
				setError(null);
				try {
					await client.signInWithEmailPassword(String(email || '').trim(), String(password ?? ''));
				} catch (e: any) {
					const msg = String(e?.message ?? e ?? '로그인에 실패했습니다.');
					setError(msg);
					throw e;
				}
			},
			signOut: async () => {
				setError(null);
				try {
					await client.signOut();
				} catch (e: any) {
					const msg = String(e?.message ?? e ?? '로그아웃에 실패했습니다.');
					setError(msg);
					throw e;
				}
			},
			getIdToken: async (opts?: { forceRefresh?: boolean }) => {
				return await client.getIdToken(opts);
			},
		};
	}, [client, error, loading, user]);

	return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

