import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { IntroLoginView } from './IntroLoginView';

/**
 * 인증 게이트:
 * - 로그인 전: 인트로 로그인 화면
 * - 로그인 후: children 렌더링
 *
 * 참고:
 * - NAS에서 ERP와 Analytics를 서로 다른 포트로 운영하면, 브라우저 저장소가 공유되지 않아
 *   사용자 입장에선 Analytics에서도 1회 로그인 절차가 필요하다.
 * - 하지만 Firebase 프로젝트(계정/권한 체계)는 ERP와 동일한 설정을 재사용한다.
 */
export function AuthGate(props: { children: React.ReactNode; defaultNextPath?: string }): JSX.Element {
	const { loading, user, error, signIn } = useAuth();
	const nav = useNavigate();
	const loc = useLocation();

	const isLoginPath = String(loc.pathname || '') === '/login';
	const nextParam = new URLSearchParams(String(loc.search || '')).get('next');
	const defaultNext = String(props.defaultNextPath || '/analytics/rank/tracking');
	const nextPath = String(nextParam || '').trim() || defaultNext;

	useEffect(() => {
		if (loading) return;
		if (!user && !isLoginPath) {
			const next = encodeURIComponent(String(loc.pathname || '/') + String(loc.search || '') + String(loc.hash || ''));
			nav(`/login?next=${next}`, { replace: true });
			return;
		}
		if (user && isLoginPath) {
			nav(nextPath, { replace: true });
		}
	}, [isLoginPath, loading, loc.hash, loc.pathname, loc.search, nav, nextPath, user]);

	if (loading) {
		return (
			<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1020', color: '#94a3b8' }}>
				로딩 중…
			</div>
		);
	}

	if (!user) {
		return <IntroLoginView loading={false} error={error} onSubmit={signIn} />;
	}

	return <>{props.children}</>;
}

