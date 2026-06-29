import React, { useMemo, useState } from 'react';

export function IntroLoginView(props: {
	onSubmit: (email: string, password: string) => Promise<void>;
	loading?: boolean;
	error?: string | null;
}): JSX.Element {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const canSubmit = useMemo(() => {
		return String(email || '').trim().length > 0 && String(password || '').length > 0 && !submitting && !props.loading;
	}, [email, password, submitting, props.loading]);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit) return;
		setSubmitting(true);
		try {
			await props.onSubmit(email, password);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			style={{
				minHeight: '100vh',
				display: 'grid',
				placeItems: 'center',
				padding: 20,
				background: 'radial-gradient(1200px 700px at 20% 10%, rgba(56,189,248,0.12), transparent 55%), radial-gradient(900px 500px at 80% 20%, rgba(167,139,250,0.12), transparent 55%), #0b1020',
			}}
		>
			<div
				style={{
					width: 'min(520px, 100%)',
					borderRadius: 14,
					border: '1px solid rgba(148,163,184,0.16)',
					background: 'rgba(15, 23, 42, 0.86)',
					boxShadow: '0 20px 80px rgba(0,0,0,0.45)',
					padding: 18,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
					<div
						style={{
							width: 40,
							height: 40,
							borderRadius: 12,
							display: 'grid',
							placeItems: 'center',
							background: 'linear-gradient(135deg, rgba(56,189,248,0.9), rgba(167,139,250,0.9))',
							color: '#0b1020',
							fontWeight: 1000,
						}}
					>
						AD
					</div>
					<div>
						<div style={{ fontSize: 14, fontWeight: 1000, color: '#e2e8f0' }}>ERP Analytics</div>
						<div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
							ERP에서 사용하는 Firebase 계정으로 로그인합니다.
						</div>
					</div>
				</div>

				<form onSubmit={submit} style={{ marginTop: 16, display: 'grid', gap: 10 }}>
					<div style={{ display: 'grid', gap: 6 }}>
						<label style={{ fontSize: 12, fontWeight: 900, color: '#cbd5e1' }}>이메일</label>
						<input
							className="input"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="example@company.com"
							autoComplete="username"
							spellCheck={false}
						/>
					</div>
					<div style={{ display: 'grid', gap: 6 }}>
						<label style={{ fontSize: 12, fontWeight: 900, color: '#cbd5e1' }}>비밀번호</label>
						<input
							className="input"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="••••••••"
							autoComplete="current-password"
						/>
					</div>

					{props.error ? (
						<div style={{ fontSize: 12, fontWeight: 900, color: '#fda4af' }}>{props.error}</div>
					) : null}

					<button type="submit" className="btn-primary" disabled={!canSubmit}>
						{submitting || props.loading ? '로그인 중…' : '로그인'}
					</button>

					<div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
						- NAS에서 ERP와 Analytics를 <b>서로 다른 포트</b>로 운영하면, 브라우저 저장소(세션)가 공유되지 않아
						처음 1회는 Analytics에서도 로그인해야 합니다.<br />
						- 단, <b>계정/권한 체계는 ERP와 동일한 Firebase 프로젝트</b>를 재사용합니다.
					</div>
				</form>
			</div>
		</div>
	);
}

