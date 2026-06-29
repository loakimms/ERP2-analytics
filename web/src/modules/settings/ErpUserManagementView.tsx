import React, { useEffect, useMemo, useState } from 'react';

const LS_KEY = 'analytics:erp_web_base_url_v1';

function defaultErpBaseUrl(): string {
	try {
		const host = String(window.location.hostname || '').toLowerCase();
		if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:5299';
	} catch {
		// ignore
	}
	return '';
}

function normalizeBaseUrl(input: string): string {
	let s = String(input || '').trim();
	if (!s) return '';
	s = s.replace(/\/+$/, '');
	return s;
}

export function ErpUserManagementView(): JSX.Element {
	const [baseUrl, setBaseUrl] = useState('');

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(LS_KEY);
			const v = normalizeBaseUrl(raw || '') || defaultErpBaseUrl();
			setBaseUrl(v);
		} catch {
			setBaseUrl(defaultErpBaseUrl());
		}
	}, []);

	const erpUsersUrl = useMemo(() => {
		const b = normalizeBaseUrl(baseUrl);
		if (!b) return '';
		return `${b}/user-admin`;
	}, [baseUrl]);

	const save = () => {
		const v = normalizeBaseUrl(baseUrl);
		setBaseUrl(v);
		try {
			window.localStorage.setItem(LS_KEY, v);
		} catch {
			// ignore
		}
	};

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">ERP 사용자관리</div>
				<div className="card-caption">
					ERP의 “사용자 관리” 화면을 Analytics 설정에서 바로 열 수 있게 제공합니다. 환경에 따라 iframe이 차단될 수 있으니, 새 탭 열기도 함께 제공합니다.
				</div>

				<div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 8, alignItems: 'center', marginTop: 10 }}>
					<div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 900 }}>ERP Web Base URL</div>
					<input
						className="input"
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder="예: http://localhost:5299"
						spellCheck={false}
					/>
					<button type="button" className="btn-ghost" onClick={save}>
						저장
					</button>
				</div>

				<div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
					<button
						type="button"
						className="btn-primary"
						disabled={!erpUsersUrl}
						onClick={() => {
							if (!erpUsersUrl) return;
							window.open(erpUsersUrl, '_blank', 'noopener,noreferrer');
						}}
					>
						새 탭으로 열기
					</button>
					<div style={{ fontSize: 11, color: '#64748b' }}>{erpUsersUrl || 'ERP URL을 먼저 설정해 주세요.'}</div>
				</div>
			</div>

			<div className="card" style={{ padding: 0, overflow: 'hidden' }}>
				<div style={{ padding: 14, borderBottom: '1px solid rgba(148,163,184,0.14)' }}>
					<div className="card-title" style={{ marginBottom: 4 }}>
						임베드 보기(iframe)
					</div>
					<div className="card-caption">
						브라우저/서버 보안 설정(X-Frame-Options, CSP)에 따라 표시가 막힐 수 있습니다. 그 경우 위의 “새 탭으로 열기”를 사용해 주세요.
					</div>
				</div>
				{erpUsersUrl ? (
					<iframe
						title="ERP User Admin"
						src={erpUsersUrl}
						style={{ width: '100%', height: '70vh', border: 'none', background: '#0b1020' }}
					/>
				) : (
					<div style={{ padding: 14, fontSize: 12, color: '#94a3b8' }}>ERP URL을 설정하면 여기에서 사용자 관리 화면을 볼 수 있습니다.</div>
				)}
			</div>
		</div>
	);
}

