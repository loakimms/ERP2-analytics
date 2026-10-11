import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type ApiSettings = {
	NAVER_KEY: string;
	NAVER_SECRET: string;
	AD_CUST_ID: string;
	AD_KEY: string;
	AD_SEC: string;
	NAVER_CLIENT_ID: string;
	NAVER_CLIENT_SECRET: string;
	NAVER_COMMERCE_CLIENT_ID: string;
	NAVER_COMMERCE_CLIENT_SECRET: string;
	OPENAI_API_KEY: string;
	GEMINI_API_KEY: string;
};

type ApiValidateResult = {
	ok: boolean;
	service: string;
	status_code?: number | null;
	message: string;
};

const EMPTY: ApiSettings = {
	NAVER_KEY: '',
	NAVER_SECRET: '',
	AD_CUST_ID: '',
	AD_KEY: '',
	AD_SEC: '',
	NAVER_CLIENT_ID: '',
	NAVER_CLIENT_SECRET: '',
	NAVER_COMMERCE_CLIENT_ID: '',
	NAVER_COMMERCE_CLIENT_SECRET: '',
	OPENAI_API_KEY: '',
	GEMINI_API_KEY: '',
};

const MASKED_API_SETTING_VALUE = '********';
const SENSITIVE_API_KEYS = new Set<ApiKeyName>([
	'NAVER_KEY',
	'NAVER_SECRET',
	'AD_KEY',
	'AD_SEC',
	'NAVER_CLIENT_ID',
	'NAVER_CLIENT_SECRET',
	'NAVER_COMMERCE_CLIENT_ID',
	'NAVER_COMMERCE_CLIENT_SECRET',
	'OPENAI_API_KEY',
	'GEMINI_API_KEY',
]);

function normalize(v: unknown): string {
	return String(v ?? '').trim();
}

function isMaskedApiSettingValue(v: unknown): boolean {
	return normalize(v) === MASKED_API_SETTING_VALUE;
}

function buildApiSettingsPayload(form: ApiSettings, keys?: ApiKeyName[]): Partial<ApiSettings> {
	const targetKeys = (keys?.length ? keys : (Object.keys(EMPTY) as ApiKeyName[])) || [];
	const out: Partial<ApiSettings> = {};
	for (const key of targetKeys) {
		const value = normalize(form[key]);
		if (SENSITIVE_API_KEYS.has(key) && isMaskedApiSettingValue(value)) continue;
		out[key] = value;
	}
	return out;
}

function looksLikeIpNotAllowedMessage(msg: string): boolean {
	const s = String(msg || '');
	return s.includes('GW.IP_NOT_ALLOWED') || s.includes('IP_NOT_ALLOWED') || s.includes('허용') && s.includes('IP');
}

function mergeSettings(raw: any): ApiSettings {
	const o = raw || {};
	return {
		NAVER_KEY: normalize(o.NAVER_KEY),
		NAVER_SECRET: normalize(o.NAVER_SECRET),
		AD_CUST_ID: normalize(o.AD_CUST_ID),
		AD_KEY: normalize(o.AD_KEY),
		AD_SEC: normalize(o.AD_SEC),
		NAVER_CLIENT_ID: normalize(o.NAVER_CLIENT_ID),
		NAVER_CLIENT_SECRET: normalize(o.NAVER_CLIENT_SECRET),
		NAVER_COMMERCE_CLIENT_ID: normalize(o.NAVER_COMMERCE_CLIENT_ID),
		NAVER_COMMERCE_CLIENT_SECRET: normalize(o.NAVER_COMMERCE_CLIENT_SECRET),
		OPENAI_API_KEY: normalize(o.OPENAI_API_KEY),
		GEMINI_API_KEY: normalize(o.GEMINI_API_KEY),
	};
}

type ApiKeyName = keyof ApiSettings;

function MaskedInput(props: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	locked: boolean;
	editing: boolean;
	onToggleEdit: () => void;
}): JSX.Element {
	const [show, setShow] = useState(false);
	const disabled = props.locked && !props.editing;
	return (
		<div style={{ display: 'grid', gap: 6 }}>
			<label className="field-label" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
				<span>{props.label}</span>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
					<button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setShow((v) => !v)}>
						{show ? '숨김' : '보기'}
					</button>
					{props.locked ? (
						<button
							type="button"
							className="btn-ghost"
							style={{ fontSize: 11 }}
							onClick={props.onToggleEdit}
						>
							{props.editing ? '잠금' : '수정'}
						</button>
					) : null}
				</span>
			</label>
			<input
				className="input"
				type={show ? 'text' : 'password'}
				value={props.value}
				placeholder={props.placeholder}
				onChange={(e) => props.onChange(e.target.value)}
				disabled={disabled}
				autoComplete="off"
				spellCheck={false}
			/>
		</div>
	);
}

function ValidateBadge(props: { r: ApiValidateResult | null }): JSX.Element | null {
	const r = props.r;
	if (!r) return null;
	const ok = Boolean(r.ok);
	return (
		<span
			style={{
				fontSize: 12,
				fontWeight: 900,
				color: ok ? '#bbf7d0' : '#fda4af',
				whiteSpace: 'nowrap',
			}}
		>
			{ok ? '정상' : '실패'} {r.status_code ? `(${r.status_code})` : ''} · {r.message}
		</span>
	);
}

export function ApiSettingsView(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;
	const [form, setForm] = useState<ApiSettings>(EMPTY);
	// 서버에 “저장 완료된 값” 스냅샷(잠금 기준)
	const [savedSnapshot, setSavedSnapshot] = useState<ApiSettings>(EMPTY);
	// 잠금된 필드를 수정하려면 사용자가 “수정”을 눌러야 함
	const [editMode, setEditMode] = useState<Partial<Record<ApiKeyName, boolean>>>({});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [validating, setValidating] = useState<Record<string, boolean>>({});
	const [validateResult, setValidateResult] = useState<Record<string, ApiValidateResult | null>>({});
	const [toast, setToast] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!toast) return;
		const t = window.setTimeout(() => setToast(null), 1600);
		return () => window.clearTimeout(t);
	}, [toast]);

	const hasAnyValue = useMemo(() => Object.values(form).some((v) => String(v || '').trim().length > 0), [form]);

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${apiBaseUrl}/settings/api`);
			const next = mergeSettings(res.data);
			setForm(next);
			setSavedSnapshot(next);
			setEditMode({});
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '불러오기에 실패했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const payload = buildApiSettingsPayload(form);
			await axios.put(`${apiBaseUrl}/settings/api`, payload);
			// 저장 성공 시: 저장된 값 기준으로 다시 잠금
			setSavedSnapshot(form);
			setEditMode({});
			setToast('저장 완료');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '저장에 실패했습니다.';
			setError(String(msg));
		} finally {
			setSaving(false);
		}
	};

	const validate = async (
		service: 'naver-openapi' | 'naver-commerce' | 'searchad' | 'naver-client' | 'openai' | 'gemini',
	) => {
		setError(null);
		setValidating((p) => ({ ...p, [service]: true }));
		try {
			// (구조) 유효성 검사는 서버에 저장된 값을 기준으로 수행된다.
			// 사용자가 저장 버튼을 누르지 않아도 “현재 입력값”으로 검사되도록,
			// 해당 섹션의 키만 부분 업데이트로 먼저 반영한다(다른 키는 보존).
			let patch: Partial<ApiSettings> = {};
			if (service === 'naver-openapi') {
				patch = buildApiSettingsPayload(form, ['NAVER_KEY', 'NAVER_SECRET']);
			} else if (service === 'searchad') {
				patch = buildApiSettingsPayload(form, ['AD_CUST_ID', 'AD_KEY', 'AD_SEC']);
			} else if (service === 'naver-client') {
				patch = buildApiSettingsPayload(form, ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET']);
			} else if (service === 'naver-commerce') {
				patch = buildApiSettingsPayload(form, ['NAVER_COMMERCE_CLIENT_ID', 'NAVER_COMMERCE_CLIENT_SECRET']);
			} else if (service === 'openai') {
				patch = buildApiSettingsPayload(form, ['OPENAI_API_KEY']);
			} else if (service === 'gemini') {
				patch = buildApiSettingsPayload(form, ['GEMINI_API_KEY']);
			}
			try {
				if (Object.keys(patch).length > 0) {
					await axios.put(`${apiBaseUrl}/settings/api`, patch);
				}
				// 부분 저장 성공 시: 해당 키들은 “저장된 값”으로 취급하고 잠금
				setSavedSnapshot((prev) => ({ ...prev, ...(patch as any) }));
				setEditMode((prev) => {
					const next = { ...prev };
					for (const k of Object.keys(patch) as ApiKeyName[]) {
						delete next[k];
					}
					return next;
				});
			} catch {
				// 저장 실패여도 검사 자체는 시도해서 에러 메시지를 보여준다.
			}

			const res = await axios.get(`${apiBaseUrl}/settings/api/validate/${service}`);
			setValidateResult((p) => ({ ...p, [service]: res.data as ApiValidateResult }));
			setToast('검사 완료');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '검사에 실패했습니다.';
			setValidateResult((p) => ({
				...p,
				[service]: { ok: false, service, status_code: e?.response?.status ?? null, message: String(msg) },
			}));
		} finally {
			setValidating((p) => ({ ...p, [service]: false }));
		}
	};

	const clearAll = () => {
		setForm(EMPTY);
		// 초기화는 즉시 잠금 해제 상태로 둔다(사용자가 입력/저장 가능)
		setSavedSnapshot(EMPTY);
		setEditMode({});
		setToast('초기화됨(저장 버튼을 눌러 반영)');
	};

	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiBaseUrl]);

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">API 세팅</div>
				<div className="card-caption">
					수집/분석에 필요한 API 키를 저장합니다. 저장된 값은 서버(DB)에 기록되며, 필요 시 환경변수 대신 사용될 수 있습니다.
				</div>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					{toast ? <span style={{ fontSize: 12, fontWeight: 900, color: '#bbf7d0' }}>{toast}</span> : null}
					{error ? <span style={{ fontSize: 12, fontWeight: 900, color: '#fda4af' }}>{error}</span> : null}
					<div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
						<button type="button" className="btn-ghost" onClick={load} disabled={loading || saving}>
							{loading ? '불러오는 중…' : '불러오기'}
						</button>
						<button type="button" className="btn-ghost" onClick={clearAll} disabled={saving || loading || !hasAnyValue}>
							초기화
						</button>
						<button type="button" className="btn-primary" onClick={save} disabled={saving || loading}>
							{saving ? '저장 중…' : '저장'}
						</button>
					</div>
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
					<div className="card-title" style={{ marginBottom: 0 }}>
						1. 네이버 쇼핑 OpenAPI
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<ValidateBadge r={validateResult['naver-openapi'] ?? null} />
						<button
							type="button"
							className="btn-ghost"
							onClick={() => validate('naver-openapi')}
							disabled={Boolean(validating['naver-openapi']) || saving || loading}
						>
							{validating['naver-openapi'] ? '검사 중…' : '유효성 검사'}
						</button>
					</div>
				</div>
				<div style={{ display: 'grid', gap: 12 }}>
					<MaskedInput
						label="NAVER_KEY"
						value={form.NAVER_KEY}
						onChange={(v) => setForm((p) => ({ ...p, NAVER_KEY: v }))}
						placeholder="예) client id"
						locked={Boolean(savedSnapshot.NAVER_KEY)}
						editing={Boolean(editMode.NAVER_KEY) || !Boolean(savedSnapshot.NAVER_KEY)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, NAVER_KEY: !p.NAVER_KEY }))}
					/>
					<MaskedInput
						label="NAVER_SECRET"
						value={form.NAVER_SECRET}
						onChange={(v) => setForm((p) => ({ ...p, NAVER_SECRET: v }))}
						placeholder="예) client secret"
						locked={Boolean(savedSnapshot.NAVER_SECRET)}
						editing={Boolean(editMode.NAVER_SECRET) || !Boolean(savedSnapshot.NAVER_SECRET)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, NAVER_SECRET: !p.NAVER_SECRET }))}
					/>
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
					<div className="card-title" style={{ marginBottom: 0 }}>
						2. 네이버 SearchAD
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<ValidateBadge r={validateResult['searchad'] ?? null} />
						<button
							type="button"
							className="btn-ghost"
							onClick={() => validate('searchad')}
							disabled={Boolean(validating['searchad']) || saving || loading}
						>
							{validating['searchad'] ? '검사 중…' : '유효성 검사'}
						</button>
					</div>
				</div>
				<div style={{ display: 'grid', gap: 12 }}>
					<MaskedInput
						label="AD_CUST_ID"
						value={form.AD_CUST_ID}
						onChange={(v) => setForm((p) => ({ ...p, AD_CUST_ID: v }))}
						placeholder="예) customer id"
						locked={Boolean(savedSnapshot.AD_CUST_ID)}
						editing={Boolean(editMode.AD_CUST_ID) || !Boolean(savedSnapshot.AD_CUST_ID)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, AD_CUST_ID: !p.AD_CUST_ID }))}
					/>
					<MaskedInput
						label="AD_KEY"
						value={form.AD_KEY}
						onChange={(v) => setForm((p) => ({ ...p, AD_KEY: v }))}
						placeholder="예) api key"
						locked={Boolean(savedSnapshot.AD_KEY)}
						editing={Boolean(editMode.AD_KEY) || !Boolean(savedSnapshot.AD_KEY)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, AD_KEY: !p.AD_KEY }))}
					/>
					<MaskedInput
						label="AD_SEC"
						value={form.AD_SEC}
						onChange={(v) => setForm((p) => ({ ...p, AD_SEC: v }))}
						placeholder="예) api secret"
						locked={Boolean(savedSnapshot.AD_SEC)}
						editing={Boolean(editMode.AD_SEC) || !Boolean(savedSnapshot.AD_SEC)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, AD_SEC: !p.AD_SEC }))}
					/>
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
					<div className="card-title" style={{ marginBottom: 0 }}>
						3. 네이버 CLIENT
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<ValidateBadge r={validateResult['naver-client'] ?? null} />
						<button
							type="button"
							className="btn-ghost"
							onClick={() => validate('naver-client')}
							disabled={Boolean(validating['naver-client']) || saving || loading}
						>
							{validating['naver-client'] ? '검사 중…' : '유효성 검사'}
						</button>
					</div>
				</div>
				<div className="card-caption">현재는 저장만 하며, 필요 시 기능에 연결해 확장합니다.</div>
				<div style={{ display: 'grid', gap: 12 }}>
					<MaskedInput
						label="NAVER_CLIENT_ID"
						value={form.NAVER_CLIENT_ID}
						onChange={(v) => setForm((p) => ({ ...p, NAVER_CLIENT_ID: v }))}
						locked={Boolean(savedSnapshot.NAVER_CLIENT_ID)}
						editing={Boolean(editMode.NAVER_CLIENT_ID) || !Boolean(savedSnapshot.NAVER_CLIENT_ID)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, NAVER_CLIENT_ID: !p.NAVER_CLIENT_ID }))}
					/>
					<MaskedInput
						label="NAVER_CLIENT_SECRET"
						value={form.NAVER_CLIENT_SECRET}
						onChange={(v) => setForm((p) => ({ ...p, NAVER_CLIENT_SECRET: v }))}
						locked={Boolean(savedSnapshot.NAVER_CLIENT_SECRET)}
						editing={Boolean(editMode.NAVER_CLIENT_SECRET) || !Boolean(savedSnapshot.NAVER_CLIENT_SECRET)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, NAVER_CLIENT_SECRET: !p.NAVER_CLIENT_SECRET }))}
					/>
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
					<div className="card-title" style={{ marginBottom: 0 }}>
						4. 네이버 커머스 API
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<ValidateBadge r={validateResult['naver-commerce'] ?? null} />
						<button
							type="button"
							className="btn-ghost"
							onClick={() => validate('naver-commerce')}
							disabled={Boolean(validating['naver-commerce']) || saving || loading}
						>
							{validating['naver-commerce'] ? '검사 중…' : '유효성 검사'}
						</button>
					</div>
				</div>
				<div className="card-caption">
					커머스 API(OAuth2 Client Credentials) 자격증명을 저장합니다. 유효성 검사는 토큰 발급을 1회 시도합니다.
					<br />
					참고: 커머스 client secret은 일반 문자열이 아니라 <b>bcrypt salt</b> 형태(예: <code>$2a$10$...</code>)여야 합니다.
					<br />
					{looksLikeIpNotAllowedMessage(String(validateResult['naver-commerce']?.message ?? '')) ? (
						<div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(251, 191, 36, 0.10)', border: '1px solid rgba(251, 191, 36, 0.25)' }}>
							<div style={{ fontSize: 12, fontWeight: 900, color: '#fde68a' }}>허용 IP 미등록(GW.IP_NOT_ALLOWED)</div>
							<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.45 }}>
								커머스 API 센터에서 <b>허용 IP</b>에 현재 실행 환경의 <b>공인 IP</b>를 추가해야 합니다.
								<br />
								공인 IP 확인: <a href="https://api.ipify.org" target="_blank" rel="noreferrer">api.ipify.org</a>
							</div>
						</div>
					) : null}
				</div>
				<div style={{ display: 'grid', gap: 12 }}>
					<MaskedInput
						label="NAVER_COMMERCE_CLIENT_ID"
						value={form.NAVER_COMMERCE_CLIENT_ID}
						onChange={(v) => setForm((p) => ({ ...p, NAVER_COMMERCE_CLIENT_ID: v }))}
						placeholder="예) client id"
						locked={Boolean(savedSnapshot.NAVER_COMMERCE_CLIENT_ID)}
						editing={
							Boolean(editMode.NAVER_COMMERCE_CLIENT_ID) || !Boolean(savedSnapshot.NAVER_COMMERCE_CLIENT_ID)
						}
						onToggleEdit={() =>
							setEditMode((p) => ({ ...p, NAVER_COMMERCE_CLIENT_ID: !p.NAVER_COMMERCE_CLIENT_ID }))
						}
					/>
					<MaskedInput
						label="NAVER_COMMERCE_CLIENT_SECRET"
						value={form.NAVER_COMMERCE_CLIENT_SECRET}
						onChange={(v) => setForm((p) => ({ ...p, NAVER_COMMERCE_CLIENT_SECRET: v }))}
						placeholder="예) $2a$10$abcdefghijklmnopqrstuv"
						locked={Boolean(savedSnapshot.NAVER_COMMERCE_CLIENT_SECRET)}
						editing={
							Boolean(editMode.NAVER_COMMERCE_CLIENT_SECRET) ||
							!Boolean(savedSnapshot.NAVER_COMMERCE_CLIENT_SECRET)
						}
						onToggleEdit={() =>
							setEditMode((p) => ({
								...p,
								NAVER_COMMERCE_CLIENT_SECRET: !p.NAVER_COMMERCE_CLIENT_SECRET,
							}))
						}
					/>
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
					<div className="card-title" style={{ marginBottom: 0 }}>
						5. chatGPT
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<ValidateBadge r={validateResult['openai'] ?? null} />
						<button
							type="button"
							className="btn-ghost"
							onClick={() => validate('openai')}
							disabled={Boolean(validating['openai']) || saving || loading}
						>
							{validating['openai'] ? '검사 중…' : '유효성 검사'}
						</button>
					</div>
				</div>
				<div style={{ display: 'grid', gap: 12 }}>
					<MaskedInput
						label="OPENAI_API_KEY"
						value={form.OPENAI_API_KEY}
						onChange={(v) => setForm((p) => ({ ...p, OPENAI_API_KEY: v }))}
						placeholder="예) sk-..."
						locked={Boolean(savedSnapshot.OPENAI_API_KEY)}
						editing={Boolean(editMode.OPENAI_API_KEY) || !Boolean(savedSnapshot.OPENAI_API_KEY)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, OPENAI_API_KEY: !p.OPENAI_API_KEY }))}
					/>
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
					<div className="card-title" style={{ marginBottom: 0 }}>
						6. Gemini
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<ValidateBadge r={validateResult['gemini'] ?? null} />
						<button
							type="button"
							className="btn-ghost"
							onClick={() => validate('gemini')}
							disabled={Boolean(validating['gemini']) || saving || loading}
						>
							{validating['gemini'] ? '검사 중…' : '유효성 검사'}
						</button>
					</div>
				</div>
				<div className="card-caption">Gemini Vision/텍스트 분석 확장용 API 키를 저장합니다.</div>
				<div style={{ display: 'grid', gap: 12 }}>
					<MaskedInput
						label="GEMINI_API_KEY"
						value={form.GEMINI_API_KEY}
						onChange={(v) => setForm((p) => ({ ...p, GEMINI_API_KEY: v }))}
						placeholder="예) AIza..."
						locked={Boolean(savedSnapshot.GEMINI_API_KEY)}
						editing={Boolean(editMode.GEMINI_API_KEY) || !Boolean(savedSnapshot.GEMINI_API_KEY)}
						onToggleEdit={() => setEditMode((p) => ({ ...p, GEMINI_API_KEY: !p.GEMINI_API_KEY }))}
					/>
				</div>
			</div>
		</div>
	);
}

