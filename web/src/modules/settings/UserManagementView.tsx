import React, { useEffect, useMemo, useState } from 'react';
import { useMaybeAuth } from '../auth/AuthProvider';
import {
	type AnalyticsRoleId,
	decodeJwtPayload,
	normalizeAnalyticsRolesFromClaims,
} from '../../shared/auth/authClaims';
import {
	labelAnalyticsRole,
	userManagementRoleChipClass,
} from '../../shared/presentation/authPresentation';

type RoleId = AnalyticsRoleId;
type LegacyRole = 'admin' | 'accounting' | 'sales' | 'marketing' | null;

type UserSummary = {
	uid: string;
	email: string | null;
	displayName: string | null;
	// ERP 호환: legacy 단일 role + 신형 roles[]
	role: LegacyRole;
	roles: RoleId[] | null;
	disabled: boolean;
};

function isValidEmail(s: string): boolean {
	const v = String(s || '').trim();
	// 간단 검증(ERP와 동일한 수준의 UX)
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isStrongPassword(s: string): boolean {
	// 최소 8자 (ERP/운영 관점에서 강제)
	return String(s || '').length >= 8;
}

function toggleBtnClass(active: boolean): string {
	return active ? 'btn btn-toggle-on' : 'btn';
}

async function readErrorBody(res: Response): Promise<string> {
	try {
		const j: any = await res.json();
		return String(j?.detail ?? j?.message ?? j?.error ?? `HTTP ${res.status}`);
	} catch {
		try {
			return String((await res.text()) || `HTTP ${res.status}`);
		} catch {
			return `HTTP ${res.status}`;
		}
	}
}

export function UserManagementView(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;
	const auth = useMaybeAuth();
	const getIdToken = auth?.getIdToken ?? (async () => null);
	const signOut = auth?.signOut ?? (async () => {});

	const [meRoles, setMeRoles] = useState<RoleId[]>([]);
	const [users, setUsers] = useState<UserSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [adminStatus, setAdminStatus] = useState<any>(null);
	const [adminStatusError, setAdminStatusError] = useState<string | null>(null);

	const [newEmail, setNewEmail] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [newDisplayName, setNewDisplayName] = useState('');
	const [newRoles, setNewRoles] = useState<RoleId[]>(['marketing']);

	const isSuperadmin = meRoles.includes('superadmin');
	const isOpsAdmin = meRoles.includes('ops_admin');
	const canManageUsers = isSuperadmin || isOpsAdmin;
	const canDelete = isSuperadmin;

	const canSubmitNew = useMemo(() => {
		return isValidEmail(newEmail) && isStrongPassword(newPassword) && !creating && newRoles.length > 0 && canManageUsers;
	}, [canManageUsers, creating, newEmail, newPassword, newRoles.length]);

	const authHeaders = async (): Promise<Record<string, string>> => {
		const t = await getIdToken();
		if (!t) return {};
		return { Authorization: `Bearer ${t}` };
	};

	const authHeadersFresh = async (): Promise<Record<string, string>> => {
		const t = await getIdToken({ forceRefresh: true });
		if (!t) return {};
		return { Authorization: `Bearer ${t}` };
	};

	const isTokenProblem = (msg: string): boolean => {
		const m = String(msg || '').toLowerCase();
		return (
			m.includes('token_verification_failed') ||
			m.includes('token verification failed') ||
			m.includes('token_expired') ||
			m.includes('token_audience_mismatch') ||
			m.includes('token_issuer_mismatch') ||
			m.includes('token_signature_invalid') ||
			m.includes('token_not_yet_valid') ||
			m.includes('token_iat_invalid') ||
			m.includes('missing_bearer_token') ||
			m.includes('missing bearer token') ||
			m.includes('unauthorized')
		);
	};

	const fetchJsonWithAuthRetry = async (url: string, init?: RequestInit): Promise<any> => {
		// 1) 기존 토큰으로 1회 시도
		const res1 = await fetch(url, { ...(init || {}), headers: { ...(init?.headers || {}), ...(await authHeaders()) } });
		if (res1.ok) {
			return await res1.json().catch(() => ({}));
		}
		const msg1 = await readErrorBody(res1);
		// 401/토큰 문제면: 강제 갱신 후 1회 재시도
		if (res1.status === 401 && isTokenProblem(msg1)) {
			const res2 = await fetch(url, { ...(init || {}), headers: { ...(init?.headers || {}), ...(await authHeadersFresh()) } });
			if (res2.ok) return await res2.json().catch(() => ({}));
			const msg2 = await readErrorBody(res2);
			// 갱신 후에도 실패하면:
			// - "만료"처럼 사용자 세션이 실제로 끝난 경우에만 signOut 한다.
			// - 그 외(서버 검증/설정 문제)는 signOut 하지 않고, 화면에 에러를 그대로 보여준다.
			const m2 = String(msg2 || msg1 || '').toLowerCase();
			const shouldSignOut = m2.includes('token_expired') || m2.includes('missing_bearer_token') || m2.includes('missing bearer token');
			if (shouldSignOut) {
				try {
					await signOut();
				} catch {
					// ignore
				}
			}
			throw new Error(msg2 || msg1);
		}
		throw new Error(msg1);
	};

	const refreshAdminStatus = async () => {
		setAdminStatusError(null);
		try {
			const data = await fetchJsonWithAuthRetry(`${apiBaseUrl}/admin/firebase-admin/status`);
			setAdminStatus(data || null);
		} catch (e: any) {
			setAdminStatus(null);
			setAdminStatusError(String(e?.message ?? e ?? '상태 조회 실패'));
		}
	};

	const refreshMeRoles = async () => {
		try {
			const t = await getIdToken({ forceRefresh: false });
			if (!t) return;
			const payload = decodeJwtPayload(t);
			const rs = normalizeAnalyticsRolesFromClaims({ role: payload?.role, roles: payload?.roles });
			setMeRoles(rs);
		} catch {
			// ignore
		}
	};

	const refreshUsers = async () => {
		setError(null);
		setLoading(true);
		try {
			await refreshMeRoles();
			await refreshAdminStatus();
			const data = (await fetchJsonWithAuthRetry(`${apiBaseUrl}/admin/users`)) as any[];
			setUsers((data || []) as UserSummary[]);
		} catch (e: any) {
			setError(String(e?.message ?? e ?? '사용자 목록 로드 실패'));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		// AuthProvider 밖(테스트/특수 렌더)에서는 크래시하지 말고 안내 UI만 렌더한다.
		if (!auth) return;
		refreshUsers();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiBaseUrl, auth]);

	if (auth && !canManageUsers) {
		return (
			<div className="card">
				<div className="card-title">사용자관리</div>
				<div className="card-caption">관리자(운영/슈퍼)에게만 허용된 페이지입니다.</div>
				<div className="um-toolbar">
					<div className="um-toolbar-left">
						<span className="chip warn">권한이 없습니다.</span>
					</div>
					<div className="um-toolbar-right">
						<button
							type="button"
							className="btn-ghost"
							onClick={async () => {
								try {
									await signOut();
								} catch {
									// ignore
								}
							}}
						>
							로그아웃
						</button>
					</div>
				</div>
			</div>
		);
	}

	const createUser = async () => {
		if (!canSubmitNew) return;
		setError(null);
		setCreating(true);
		try {
			const emailToSend = String(newEmail || '').trim();
			const emailLower = emailToSend.toLowerCase();
			// Firebase 서버와 동기화 관점: 이미 존재하는 이메일이면 생성 대신 목록 동기화로 유도한다.
			const exists = (users || []).some((u) => String(u?.email || '').trim().toLowerCase() === emailLower);
			if (exists) {
				setError('이미 Firebase에 존재하는 이메일입니다. 사용자 목록을 동기화합니다.');
				await refreshUsers();
				return;
			}
			// superadmin만 superadmin 부여 가능. ops_admin은 업무 roles만 부여 가능.
			const rolesToSend: RoleId[] = isSuperadmin ? newRoles : newRoles.filter((r) => r !== 'superadmin');
			if (!rolesToSend.length) throw new Error('권한(roles)을 1개 이상 선택하세요.');
			await fetchJsonWithAuthRetry(`${apiBaseUrl}/admin/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: emailToSend,
					password: String(newPassword || ''),
					displayName: String(newDisplayName || '').trim() || undefined,
					roles: rolesToSend,
				}),
			});
			setNewEmail('');
			setNewPassword('');
			setNewDisplayName('');
			setNewRoles(['marketing']);
			await refreshUsers();
		} catch (e: any) {
			const msg = String(e?.message ?? e ?? '사용자 생성 실패');
			// firebase-admin에서 email 중복은 흔함 → 실패해도 즉시 Firebase 목록을 동기화한다.
			if (msg.toLowerCase().includes('email_already_exists') || msg.toLowerCase().includes('email already exists')) {
				setError('이미 Firebase에 존재하는 이메일입니다. 사용자 목록을 동기화합니다.');
				await refreshUsers();
			} else {
				setError(msg);
			}
		} finally {
			setCreating(false);
		}
	};

	const changeRoles = async (uid: string, nextRoles: RoleId[]) => {
		setError(null);
		try {
			if (!canManageUsers) throw new Error('권한이 없습니다.');
			if (!isSuperadmin && nextRoles.includes('superadmin')) throw new Error('슈퍼관리자만 슈퍼관리자를 부여할 수 있습니다.');
			await fetchJsonWithAuthRetry(`${apiBaseUrl}/admin/users/${encodeURIComponent(uid)}/role`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roles: nextRoles }),
			});
			await refreshUsers();
		} catch (e: any) {
			setError(String(e?.message ?? e ?? '권한 변경 실패'));
		}
	};

	const setDisabled = async (uid: string, disabled: boolean) => {
		setError(null);
		try {
			await fetchJsonWithAuthRetry(`${apiBaseUrl}/admin/users/${encodeURIComponent(uid)}/disable`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ disabled }),
			});
			await refreshUsers();
		} catch (e: any) {
			setError(String(e?.message ?? e ?? '활성/비활성 변경 실패'));
		}
	};

	const resetPassword = async (uid: string) => {
		setError(null);
		try {
			const pw = prompt('새 비밀번호(8자 이상)를 입력하세요');
			if (!pw) return;
			if (!isStrongPassword(pw)) {
				setError('비밀번호는 8자 이상이어야 합니다.');
				return;
			}
			await fetchJsonWithAuthRetry(`${apiBaseUrl}/admin/users/${encodeURIComponent(uid)}/password`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: pw }),
			});
			alert('비밀번호가 변경되었습니다.');
		} catch (e: any) {
			setError(String(e?.message ?? e ?? '비밀번호 변경 실패'));
		}
	};

	const deleteUser = async (uid: string) => {
		setError(null);
		try {
			if (!canDelete) throw new Error('권한이 없습니다.');
			if (!confirm('해당 사용자를 삭제하시겠습니까?')) return;
			await fetchJsonWithAuthRetry(`${apiBaseUrl}/admin/users/${encodeURIComponent(uid)}`, {
				method: 'DELETE',
			});
			await refreshUsers();
		} catch (e: any) {
			setError(String(e?.message ?? e ?? '사용자 삭제 실패'));
		}
	};

	const adminConfigured = Boolean((adminStatus as any)?.firebaseAdminConfigured);
	const adminTestMode = Boolean((adminStatus as any)?.adminTestMode);
	const missingEnv = Array.isArray((adminStatus as any)?.missingEnv) ? ((adminStatus as any)?.missingEnv as string[]) : [];
	const showAdminSetupHint =
		(!adminConfigured && !adminTestMode) ||
		String(error || '').includes('firebase_admin_env_missing') ||
		String(error || '').includes('firebase_admin_not_configured') ||
		String(error || '').includes('firebase_admin_missing');

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">사용자관리</div>
				<div className="card-caption">
					ERP의 “사용자 관리”와 동일한 형태로 Analytics 내부에서 사용자/권한을 관리합니다.
					{!auth ? (
						<>
							<br />
							<span style={{ color: '#fbbf24', fontWeight: 900 }}>로그인이 필요합니다.</span>
						</>
					) : null}
					{showAdminSetupHint ? (
						<>
							<br />
							<span style={{ color: '#fda4af', fontWeight: 900 }}>
								Firebase Admin SDK 설정이 없어 사용자관리 기능이 제한될 수 있습니다. (NAS 운영: 서비스계정 env 주입 필요 / 로컬 테스트:
								`ADMIN_TEST_MODE=1`)
								{missingEnv.length ? <> · 누락: {missingEnv.join(', ')}</> : null}
								{adminStatusError ? <> · 상태조회 실패: {adminStatusError}</> : null}
							</span>
						</>
					) : null}
				</div>
				<div className="um-toolbar">
					<div className="um-toolbar-left">
						<div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 900 }}>
							내 권한:{' '}
							<span style={{ color: '#e5e7eb' }}>
								{meRoles.length ? meRoles.map((r) => labelAnalyticsRole(r, r)).join(', ') : '-'}
							</span>
						</div>
						{loading ? <span className="chip warn">불러오는 중…</span> : null}
						{error ? <span className="chip warn">{error}</span> : null}
					</div>
					<div className="um-toolbar-right">
						<button type="button" className="btn-ghost" onClick={refreshUsers} disabled={loading}>
							새로고침
						</button>
						{auth?.user ? (
							<button
								type="button"
								className="btn-ghost"
								onClick={async () => {
									try {
										await signOut();
									} catch {
										// ignore
									}
								}}
							>
								로그아웃
							</button>
						) : null}
					</div>
				</div>
			</div>

			<div className="card">
				<div className="card-title" style={{ marginBottom: 6 }}>
					새 사용자 생성
				</div>

				<div className="um-form-row">
					<input className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="이메일" />
					<input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="비밀번호(8자 이상)" />
					<input className="input" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="표시 이름(선택)" />
					<div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
						<span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 900 }}>권한(roles)</span>
						<button type="button" className={toggleBtnClass(newRoles.includes('ops_admin'))} onClick={() => setNewRoles((p) => (p.includes('ops_admin') ? p.filter((x) => x !== 'ops_admin') : [...p, 'ops_admin']))}>
							운영관리자
						</button>
						<button type="button" className={toggleBtnClass(newRoles.includes('accounting'))} onClick={() => setNewRoles((p) => (p.includes('accounting') ? p.filter((x) => x !== 'accounting') : [...p, 'accounting']))}>
							회계
						</button>
						<button type="button" className={toggleBtnClass(newRoles.includes('sales'))} onClick={() => setNewRoles((p) => (p.includes('sales') ? p.filter((x) => x !== 'sales') : [...p, 'sales']))}>
							영업
						</button>
						<button type="button" className={toggleBtnClass(newRoles.includes('marketing'))} onClick={() => setNewRoles((p) => (p.includes('marketing') ? p.filter((x) => x !== 'marketing') : [...p, 'marketing']))}>
							마케팅
						</button>
						<button
							type="button"
							className={toggleBtnClass(newRoles.includes('superadmin'))}
							disabled={!isSuperadmin}
							title={!isSuperadmin ? '슈퍼관리자만 슈퍼관리자를 부여할 수 있습니다.' : undefined}
							onClick={() => setNewRoles((p) => (p.includes('superadmin') ? p.filter((x) => x !== 'superadmin') : [...p, 'superadmin']))}
						>
							슈퍼관리자
						</button>
					</div>
				</div>

				<div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
					<button type="button" className="btn-primary" onClick={createUser} disabled={!canSubmitNew}>
						{creating ? '생성 중…' : '생성'}
					</button>
					<div style={{ fontSize: 11, color: '#64748b' }}>
						- 관리자 권한은 <b>슈퍼관리자만</b> 부여/생성할 수 있습니다. <br />
						- 비밀번호는 <b>8자 이상</b>이어야 합니다.
					</div>
				</div>
			</div>

			<div className="card">
				<div className="card-title" style={{ marginBottom: 6 }}>
					사용자 목록
				</div>
				<div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 800, marginBottom: 10 }}>
					총 {users.length}명
				</div>

				<div style={{ overflowX: 'auto' }}>
					<table className="um-table">
						<thead>
							<tr>
								<th>사용자 ID</th>
								<th>이메일</th>
								<th>이름</th>
								<th>권한</th>
								<th>상태</th>
								<th style={{ width: 420 }}>관리</th>
							</tr>
						</thead>
						<tbody>
							{users.map((u) => (
								<tr key={u.uid}>
									<td style={{ color: '#cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 11 }}>
										{u.uid}
									</td>
									<td style={{ color: '#e5e7eb', fontWeight: 900 }}>{u.email || '-'}</td>
									<td style={{ color: '#cbd5e1' }}>{u.displayName || '-'}</td>
									<td>
										<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
											{Array.isArray(u.roles) && u.roles.length ? (
												u.roles.map((r) => (
													<span key={r} className={userManagementRoleChipClass(r)}>
														{labelAnalyticsRole(r, r)}
													</span>
												))
											) : (
												<span className={userManagementRoleChipClass('user')}>user</span>
											)}
										</div>
									</td>
									<td>
										<span className={u.disabled ? 'chip warn' : 'chip ok'}>{u.disabled ? '비활성화' : '활성'}</span>
									</td>
									<td>
										<div className="um-actions">
											{(() => {
												const current = Array.isArray(u.roles) ? (u.roles as RoleId[]) : [];
												const has = (r: RoleId) => current.includes(r);
												const toggle = (r: RoleId) => (has(r) ? current.filter((x) => x !== r) : [...current, r]);
												return (
													<>
														<button type="button" className={toggleBtnClass(has('ops_admin'))} onClick={() => changeRoles(u.uid, toggle('ops_admin'))}>
															운영 {has('ops_admin') ? '해제' : '부여'}
														</button>
														<button type="button" className={toggleBtnClass(has('accounting'))} onClick={() => changeRoles(u.uid, toggle('accounting'))}>
															회계 {has('accounting') ? '해제' : '부여'}
														</button>
														<button type="button" className={toggleBtnClass(has('sales'))} onClick={() => changeRoles(u.uid, toggle('sales'))}>
															영업 {has('sales') ? '해제' : '부여'}
														</button>
														<button type="button" className={toggleBtnClass(has('marketing'))} onClick={() => changeRoles(u.uid, toggle('marketing'))}>
															마케팅 {has('marketing') ? '해제' : '부여'}
														</button>
														<button
															type="button"
															className={toggleBtnClass(has('superadmin'))}
															disabled={!isSuperadmin}
															onClick={() => changeRoles(u.uid, toggle('superadmin'))}
														>
															슈퍼 {has('superadmin') ? '해제' : '부여'}
														</button>
													</>
												);
											})()}
											<button
												type="button"
												className="btn"
												onClick={() => setDisabled(u.uid, !u.disabled)}
											>
												{u.disabled ? '활성' : '비활성'}
											</button>
											<button
												type="button"
												className="btn"
												onClick={() => resetPassword(u.uid)}
											>
												비밀번호 변경
											</button>
											{canDelete ? (
												<button
													type="button"
													className="btn btn-danger"
													onClick={() => deleteUser(u.uid)}
												>
													삭제
												</button>
											) : null}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

