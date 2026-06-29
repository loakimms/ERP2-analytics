import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './AuthProvider';
import { AuthGate } from './AuthGate';

function makeFakeClient(params: { user: any }) {
	return {
		getCurrentUser: () => params.user ?? null,
		onAuthStateChanged: (cb: any) => {
			cb(params.user ?? null);
			return () => {};
		},
		signInWithEmailPassword: async () => params.user ?? { uid: 'u1', email: 'a@b.com', displayName: null },
		signOut: async () => {},
		getIdToken: async () => null,
	};
}

describe('AuthGate', () => {
	it('미로그인 상태에서는 인트로 로그인 화면을 보여준다', async () => {
		render(
			<MemoryRouter initialEntries={['/analytics/rank/tracking']}>
				<AuthProvider client={makeFakeClient({ user: null }) as any}>
					<AuthGate>
						<div>APP</div>
					</AuthGate>
				</AuthProvider>
			</MemoryRouter>,
		);

		expect(screen.getByText('ERP Analytics')).toBeTruthy();
		// children은 보여주지 않아야 한다.
		expect(screen.queryByText('APP')).toBeNull();
	});

	it('Firebase 설정이 없어도 앱이 크래시(빈 화면)하지 않고 로그인 화면을 보여준다', async () => {
		// createFirebaseAuthClient()가 throw 하면 React 렌더링이 중단되어 "빈 화면"이 된다.
		// 설정 누락 시에는 disabled client가 동작해, 로그인 화면이 렌더링되어야 한다.
		render(
			<MemoryRouter initialEntries={['/analytics/rank/tracking']}>
				<AuthProvider>
					<AuthGate>
						<div>APP</div>
					</AuthGate>
				</AuthProvider>
			</MemoryRouter>,
		);

		expect(screen.getByText('ERP Analytics')).toBeTruthy();
	});

	it('로그인 상태에서는 children을 렌더링한다', async () => {
		render(
			<MemoryRouter initialEntries={['/analytics/rank/tracking']}>
				<AuthProvider client={makeFakeClient({ user: { uid: 'u1', email: 'a@b.com', displayName: null } }) as any}>
					<AuthGate>
						<div>APP</div>
					</AuthGate>
				</AuthProvider>
			</MemoryRouter>,
		);

		expect(screen.getByText('APP')).toBeTruthy();
	});
});

