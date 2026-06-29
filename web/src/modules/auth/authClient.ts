export type AuthUser = {
	uid: string;
	email: string | null;
	displayName: string | null;
};

export type AuthStateListener = (user: AuthUser | null) => void;

/**
 * UI가 의존하는 최소 인증 클라이언트 인터페이스.
 * - 구현체는 Firebase(ERP와 동일 프로젝트) 기반을 기본으로 한다.
 * - 테스트에서는 fake client를 주입한다.
 */
export type AuthClient = {
	/**
	 * 현재 로그인 사용자(없으면 null)
	 */
	getCurrentUser: () => AuthUser | null;

	/**
	 * auth 상태 변경 구독
	 * @returns unsubscribe
	 */
	onAuthStateChanged: (cb: AuthStateListener) => () => void;

	/**
	 * 이메일/비밀번호 로그인
	 */
	signInWithEmailPassword: (email: string, password: string) => Promise<AuthUser>;

	/**
	 * 로그아웃
	 */
	signOut: () => Promise<void>;

	/**
	 * API 호출용 Firebase ID token
	 * - 가능한 최신 토큰을 반환(만료/갱신 고려)
	 */
	getIdToken: (opts?: { forceRefresh?: boolean }) => Promise<string | null>;
};

