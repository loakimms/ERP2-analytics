import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useMaybeAuth } from '../auth/AuthProvider';
import { useNavigate } from 'react-router-dom';

type WebVersionJson = {
	appVersion?: string;
	imageTag?: string;
	gitSha?: string;
	buildTime?: string;
	apiBaseUrl?: string;
};

const Card = ({
	children,
	className = '',
	style,
}: {
	children: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
}) => (
	<div className={`card ${className}`} style={{ maxWidth: 'none', ...(style || {}) }}>
		{children}
	</div>
);

const IconDownload = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<polyline points="7 10 12 15 17 10" />
		<line x1="12" x2="12" y1="15" y2="3" />
	</svg>
);
const IconDatabase = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<ellipse cx="12" cy="5" rx="9" ry="3" />
		<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
		<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
	</svg>
);
const IconPackage = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v4" />
		<path d="M21 14v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<path d="M3 10h18" />
		<path d="M12 22V10" />
	</svg>
);
const IconUpload = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<polyline points="17 8 12 3 7 8" />
		<line x1="12" x2="12" y1="3" y2="15" />
	</svg>
);
const IconRefresh = ({ spinning }: { spinning?: boolean }) => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}>
		<polyline points="23 4 23 10 17 10" />
		<polyline points="1 20 1 14 7 14" />
		<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
	</svg>
);
const IconAlert = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="10" />
		<line x1="12" y1="8" x2="12" y2="12" />
		<line x1="12" y1="16" x2="12.01" y2="16" />
	</svg>
);
const IconFileText = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<polyline points="14 2 14 8 20 8" />
		<line x1="16" y1="13" x2="8" y2="13" />
		<line x1="16" y1="17" x2="8" y2="17" />
		<polyline points="10 9 9 9 8 9" />
	</svg>
);
const IconChevronUp = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="m18 15-6-6-6 6" />
	</svg>
);
const IconChevronDown = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="m6 9 6 6 6-6" />
	</svg>
);

export function VersionManagementView(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;
	const auth = useMaybeAuth();
	const getIdToken = auth?.getIdToken ?? (async () => null);
	const navigate = useNavigate();

	const [webVersion, setWebVersion] = useState<WebVersionJson | null>(null);
	const [apiVersion, setApiVersion] = useState<any>(null);
	const [apiHealth, setApiHealth] = useState<any>(null);
	const [currentLabel, setCurrentLabel] = useState<string>('');
	const [newLabel, setNewLabel] = useState<string>('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errors, setErrors] = useState<Record<string, string | null>>({
		web: null,
		apiVersion: null,
		apiHealth: null,
		adminLabel: null,
	});
	const [expandTech, setExpandTech] = useState(false);

	const authHeaders = async (): Promise<Record<string, string>> => {
		const t = await getIdToken();
		if (!t) return {};
		return { Authorization: `Bearer ${t}` };
	};

	const errToMsg = (e: any): string => {
		const msg = e?.response?.data?.detail ?? e?.response?.data?.message ?? e?.message ?? e ?? '';
		return String(msg || '요청 실패');
	};

	const load = async () => {
		setLoading(true);
		setError(null);
		setErrors({ web: null, apiVersion: null, apiHealth: null, adminLabel: null });
		try {
			const noCache = { 'Cache-Control': 'no-cache' };
			const authH = await authHeaders();

			const tasks = {
				web: axios.get<WebVersionJson>('/version.json', { headers: noCache }),
				apiVersion: axios.get(`${apiBaseUrl}/version`, { headers: noCache }),
				apiHealth: axios.get(`${apiBaseUrl}/health`, { headers: noCache }),
				adminLabel: axios.get(`${apiBaseUrl}/admin/version`, { headers: { ...authH, ...noCache } }),
			} as const;

			const [rWeb, rApiV, rHealth, rLabel] = await Promise.allSettled([
				tasks.web,
				tasks.apiVersion,
				tasks.apiHealth,
				tasks.adminLabel,
			]);

			if (rWeb.status === 'fulfilled') setWebVersion(rWeb.value.data || {});
			else setErrors((p) => ({ ...p, web: errToMsg(rWeb.reason) }));

			if (rApiV.status === 'fulfilled') setApiVersion(rApiV.value.data);
			else setErrors((p) => ({ ...p, apiVersion: errToMsg(rApiV.reason) }));

			if (rHealth.status === 'fulfilled') setApiHealth(rHealth.value.data);
			else setErrors((p) => ({ ...p, apiHealth: errToMsg(rHealth.reason) }));

			if (rLabel.status === 'fulfilled') setCurrentLabel(String((rLabel.value.data as any)?.version || ''));
			else {
				const m = errToMsg(rLabel.reason);
				const hint = m.includes('firebase_project_id_missing') ? ' (API 환경변수 FIREBASE_PROJECT_ID 누락)' : '';
				setErrors((p) => ({ ...p, adminLabel: m + hint }));
			}
		} catch (e: any) {
			setError(String(errToMsg(e) || '버전 정보를 불러오지 못했습니다.'));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiBaseUrl]);

	const v = webVersion || {};
	const imageTag = v.imageTag || apiVersion?.imageTag || v.appVersion;

	const saveLabel = async (): Promise<void> => {
		const trimmed = String(newLabel || '').trim();
		if (!trimmed) {
			setError('버전을 입력해주세요.');
			return;
		}
		setLoading(true);
		setError(null);
		try {
			await axios.post(
				`${apiBaseUrl}/admin/version`,
				{ version: trimmed },
				{ headers: { ...(await authHeaders()), 'Content-Type': 'application/json' } }
			);
			setCurrentLabel(trimmed);
			setNewLabel('');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '버전 저장 실패';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	};

	const downloadBackup = async (type: 'ops_code' | 'db' | 'full'): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(`${apiBaseUrl}/admin/backup?type=${encodeURIComponent(type)}`, {
				method: 'POST',
				headers: await authHeaders(),
			});
			if (!res.ok) {
				let msg = `HTTP ${res.status}`;
				try {
					const j: any = await res.json();
					msg = String(j?.detail ?? j?.message ?? j?.error ?? msg);
				} catch {
					try {
						msg = String((await res.text()) || msg);
					} catch {}
				}
				throw new Error(msg);
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			const cd = String(res.headers.get('content-disposition') || '');
			const m = /filename=\"?([^\";]+)\"?/i.exec(cd);
			const name = (m && m[1]) ? m[1] : `analytics_backup_${Date.now()}.zip`;
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (e: any) {
			setError(String(e?.message ?? e ?? '백업 실패'));
		} finally {
			setLoading(false);
		}
	};

	const handleSaveAndBackup = async () => {
		const trimmed = String(newLabel || '').trim();
		if (!trimmed) {
			setError('버전을 입력해주세요.');
			return;
		}
		await saveLabel();
		await downloadBackup('ops_code');
	};

	const allErrors = error || Object.values(errors).filter(Boolean).join(' · ');

	return (
		<div style={{ maxWidth: 720, margin: '0 auto' }}>
			{/* 헤더 */}
			<div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
				<div>
					<div className="card-title" style={{ marginBottom: 4, fontSize: 18 }}>
						버전관리
					</div>
					<p className="card-caption" style={{ marginBottom: 0 }}>
						표시용 버전을 저장하고, 필요 시 백업(zip)을 내려받습니다.
					</p>
				</div>
				<button type="button" className="btn-ghost" onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<IconRefresh spinning={loading} />
					{loading ? '새로고침 중…' : '새로고침'}
				</button>
			</div>

			{allErrors && (
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', marginBottom: 16, borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', backgroundColor: 'rgba(248,113,113,0.1)', color: '#fda4af', fontSize: 13 }}>
					<IconAlert />
					{allErrors}
				</div>
			)}

			{/* 백업 액션 카드 */}
			<Card>
				<div style={{ padding: '16px 20px' }}>
					<div className="card-title" style={{ marginBottom: 4 }}>백업</div>
					<p className="card-caption" style={{ marginBottom: 16 }}>백업 유형을 선택하여 zip 파일을 다운로드합니다.</p>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
						<button type="button" className="btn-ghost" onClick={() => downloadBackup('ops_code')} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<IconDownload /> 운영코드 백업
						</button>
						<button type="button" className="btn-ghost" onClick={() => downloadBackup('db')} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<IconDatabase /> DB 백업
						</button>
						<button type="button" className="btn-ghost" onClick={() => downloadBackup('full')} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<IconPackage /> FULL 백업
						</button>
						<button type="button" className="btn-primary" onClick={handleSaveAndBackup} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<IconUpload /> 저장 + 운영코드백업
						</button>
					</div>
				</div>
			</Card>

			{/* 백업 유형 안내 */}
			<Card style={{ borderLeft: '4px solid rgba(34,197,94,0.4)', marginTop: 16 }}>
				<div style={{ padding: '14px 20px' }}>
					<div className="card-title" style={{ marginBottom: 8 }}>백업 유형별 설명</div>
					<ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#cbd5e1', lineHeight: 1.8 }}>
						<li><span style={{ fontWeight: 700, color: '#e5e7eb' }}>운영코드 백업</span> — lock 증거 + 첨부파일</li>
						<li><span style={{ fontWeight: 700, color: '#e5e7eb' }}>DB 백업</span> — PostgreSQL 덤프</li>
						<li><span style={{ fontWeight: 700, color: '#e5e7eb' }}>FULL 백업</span> — Docker 이미지 + DB + 첨부 (전체 복구용)</li>
					</ul>
				</div>
			</Card>

			{/* 버전 정보 카드 */}
			<Card style={{ marginTop: 16 }}>
				<div style={{ padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
					<div>
						<label className="field-label" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>
							현재 버전
						</label>
						<div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
							<span style={{ fontSize: 18, fontWeight: 800, color: '#22c55e' }}>Ver. {currentLabel || '-'}</span>
							{imageTag && (
								<span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
									배포 태그: {imageTag}
								</span>
							)}
						</div>
					</div>

					<div style={{ borderTop: '1px solid rgba(148,163,184,0.14)', paddingTop: 20 }}>
						<label className="field-label" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>변경 버전</label>
						<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
							<span style={{ fontSize: 14, fontWeight: 900, color: '#cbd5e1' }}>Ver.</span>
							<input
								className="input"
								value={newLabel}
								onChange={(e) => setNewLabel(e.target.value)}
								placeholder="예: 1.3"
								style={{ flex: 1, minWidth: 160, maxWidth: 240 }}
							/>
							<button type="button" className="btn-primary" onClick={saveLabel} disabled={loading || !String(newLabel || '').trim()}>
								확인
							</button>
							<button type="button" className="btn-ghost" onClick={() => navigate(-1)} disabled={loading}>
								닫기
							</button>
						</div>
					</div>
				</div>
			</Card>

			{/* 기술 정보 (접기/펼치기) */}
			<div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
				<button
					type="button"
					onClick={() => setExpandTech(!expandTech)}
					style={{
						width: '100%',
						padding: '12px 20px',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						background: 'rgba(15,23,42,0.5)',
						border: 'none',
						color: '#cbd5e1',
						fontSize: 13,
						fontWeight: 700,
						cursor: 'pointer',
						textAlign: 'left',
					}}
				>
					<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<IconFileText />
						기술 정보 (Web / API / 헬스)
					</span>
					{expandTech ? <IconChevronUp /> : <IconChevronDown />}
				</button>
				{expandTech && (
					<div style={{ padding: '16px 20px', borderTop: '1px solid rgba(148,163,184,0.14)', display: 'flex', flexDirection: 'column', gap: 16 }}>
						<div>
							<div className="field-label" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>Web (/version.json)</div>
							<pre style={{ margin: 0, padding: 12, fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1', backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 8, overflowX: 'auto' }}>
								{JSON.stringify(webVersion || {}, null, 2)}
							</pre>
						</div>
						<div>
							<div className="field-label" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>API (/version)</div>
							<pre style={{ margin: 0, padding: 12, fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1', backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 8, overflowX: 'auto' }}>
								{apiVersion ? JSON.stringify(apiVersion, null, 2) : '(미수신)'}
							</pre>
						</div>
						<div>
							<div className="field-label" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>헬스체크 (/health)</div>
							<pre style={{ margin: 0, padding: 12, fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1', backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 8, overflowX: 'auto' }}>
								{apiHealth ? JSON.stringify(apiHealth, null, 2) : '(미수신)'}
							</pre>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
