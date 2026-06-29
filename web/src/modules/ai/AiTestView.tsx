import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

type ValidateResult = { ok: boolean; service: string; status_code?: number | null; message: string };
type ModelListResponse = { ok: boolean; models?: Array<{ id: string }> };

function nowHm(): string {
	const d = new Date();
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AiTestView(props: { apiBaseUrl: string }): JSX.Element {
	const [model, setModel] = useState('gpt-4o-mini');
	const [models, setModels] = useState<Array<{ id: string }>>([]);
	const [systemPrompt, setSystemPrompt] = useState('당신은 도움이 되는 어시스턴트입니다.');
	const [prompt, setPrompt] = useState('');
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [validate, setValidate] = useState<ValidateResult | null>(null);
	const [messages, setMessages] = useState<Array<ChatMsg & { ts: string }>>([]);
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		const run = async () => {
			try {
				const res = await axios.get(`${props.apiBaseUrl}/settings/api/validate/openai`, { timeout: 10000 });
				if (!cancelled) setValidate(res.data as any);
			} catch (e: any) {
				if (!cancelled) setValidate({ ok: false, service: 'openai', message: String(e?.message ?? e ?? 'validate failed') });
			}

			// 모델 목록은 키가 유효할 때만 굳이 가져온다(실패해도 UI는 동작).
			try {
				const res2 = await axios.get(`${props.apiBaseUrl}/ai/models`, { timeout: 20000 });
				const data = res2.data as ModelListResponse;
				const list = Array.isArray(data?.models) ? data.models.filter((m) => m && typeof m.id === 'string' && m.id.trim()) : [];
				if (!cancelled) setModels(list.map((m) => ({ id: String(m.id).trim() })));
			} catch {
				if (!cancelled) setModels([]);
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [props.apiBaseUrl]);

	useEffect(() => {
		try {
			listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
		} catch {
			// ignore
		}
	}, [messages.length]);

	const canSend = useMemo(() => {
		return !sending && String(prompt).trim().length > 0;
	}, [sending, prompt]);

	const send = async () => {
		const p = String(prompt).trim();
		if (!p || sending) return;
		setSending(true);
		setError(null);
		setPrompt('');

		const ts = nowHm();
		setMessages((prev) => [...prev, { role: 'user', content: p, ts }]);

		try {
			const reqMessages: ChatMsg[] = [];
			const sys = String(systemPrompt).trim();
			if (sys) reqMessages.push({ role: 'system', content: sys });
			for (const m of messages) reqMessages.push({ role: m.role, content: m.content });
			reqMessages.push({ role: 'user', content: p });

			const res = await axios.post(
				`${props.apiBaseUrl}/ai/chat`,
				{ model: String(model || '').trim() || undefined, messages: reqMessages },
				{ timeout: 60000 },
			);
			const msg = (res?.data as any)?.message;
			const outRole = String(msg?.role ?? 'assistant') as any;
			const outContent = String(msg?.content ?? '');
			setMessages((prev) => [...prev, { role: outRole === 'assistant' ? 'assistant' : 'assistant', content: outContent, ts: nowHm() }]);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '요청에 실패했습니다.';
			setError(String(msg));
			setMessages((prev) => [...prev, { role: 'assistant', content: `(에러) ${String(msg)}`, ts: nowHm() }]);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="space-y-3">
			<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
				<div>
					<div className="card-title">AI test (ChatGPT 프롬프트/응답)</div>
					<div className="card-caption">
						설정에 저장된 <b>OPENAI_API_KEY</b>를 서버에서 사용합니다. (브라우저에는 키가 노출되지 않습니다)
					</div>
				</div>
				<div style={{ textAlign: 'right', fontSize: 12 }}>
					<div style={{ fontWeight: 900, color: validate?.ok ? '#86efac' : '#fca5a5' }}>
						OpenAI Key: {validate?.ok ? 'OK' : '확인 필요'}
					</div>
					{validate && !validate.ok ? (
						<div style={{ color: '#9ca3af', maxWidth: 520, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
							{validate.message}
						</div>
					) : null}
				</div>
			</div>

			<div className="card" style={{ display: 'grid', gap: 10 }}>
				<div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
					<div style={{ fontSize: 12, fontWeight: 900 }}>모델</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 10, alignItems: 'center' }}>
						<select
							aria-label="model-select"
							value={model}
							onChange={(e) => setModel(e.target.value)}
							disabled={models.length === 0}
							style={{
								width: '100%',
								borderRadius: 10,
								padding: '8px 10px',
								background: 'rgba(15, 23, 42, 0.6)',
								border: '1px solid rgba(148,163,184,0.2)',
								color: '#e5e7eb',
							}}
						>
							{models.length === 0 ? <option value={model}>모델 목록 로딩 실패(직접 입력)</option> : null}
							{models.map((m) => (
								<option key={m.id} value={m.id}>
									{m.id}
								</option>
							))}
						</select>
						<input
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder="직접 입력(예: gpt-4o-mini)"
							style={{
								width: '100%',
								borderRadius: 10,
								padding: '8px 10px',
								background: 'rgba(15, 23, 42, 0.6)',
								border: '1px solid rgba(148,163,184,0.2)',
								color: '#e5e7eb',
							}}
						/>
					</div>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
					<div style={{ fontSize: 12, fontWeight: 900, paddingTop: 8 }}>시스템 프롬프트</div>
					<textarea
						value={systemPrompt}
						onChange={(e) => setSystemPrompt(e.target.value)}
						rows={3}
						style={{
							width: '100%',
							borderRadius: 10,
							padding: '8px 10px',
							background: 'rgba(15, 23, 42, 0.6)',
							border: '1px solid rgba(148,163,184,0.2)',
							color: '#e5e7eb',
							resize: 'vertical',
						}}
					/>
				</div>
			</div>

			<div className="card" style={{ display: 'grid', gap: 10 }}>
				<div
					ref={listRef}
					style={{
						maxHeight: 360,
						overflow: 'auto',
						display: 'grid',
						gap: 8,
						padding: 10,
						borderRadius: 10,
						background: 'rgba(15, 23, 42, 0.45)',
						border: '1px solid rgba(148,163,184,0.12)',
					}}
				>
					{messages.length === 0 ? (
						<div style={{ fontSize: 12, color: '#9ca3af' }}>아래 입력창에 프롬프트를 입력하고 “전송”을 누르세요.</div>
					) : null}
					{messages.map((m, idx) => {
						const isUser = m.role === 'user';
						return (
							<div
								key={`${idx}-${m.ts}`}
								style={{
									display: 'grid',
									gap: 4,
									padding: '8px 10px',
									borderRadius: 12,
									border: `1px solid ${isUser ? 'rgba(59,130,246,0.35)' : 'rgba(148,163,184,0.18)'}`,
									background: isUser ? 'rgba(59,130,246,0.12)' : 'rgba(148,163,184,0.08)',
								}}
							>
								<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, color: '#9ca3af' }}>
									<div style={{ fontWeight: 900, color: isUser ? '#93c5fd' : '#e5e7eb' }}>
										{isUser ? 'USER' : 'ASSISTANT'}
									</div>
									<div>{m.ts}</div>
								</div>
								<div style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#e5e7eb' }}>{m.content}</div>
							</div>
						);
					})}
				</div>

				<div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, alignItems: 'start' }}>
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="프롬프트를 입력하세요…"
						rows={3}
						style={{
							width: '100%',
							borderRadius: 10,
							padding: '10px 12px',
							background: 'rgba(15, 23, 42, 0.6)',
							border: '1px solid rgba(148,163,184,0.2)',
							color: '#e5e7eb',
							resize: 'vertical',
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								void send();
							}
						}}
					/>
					<div style={{ display: 'grid', gap: 8 }}>
						<button type="button" className="btn-primary" disabled={!canSend} onClick={() => void send()}>
							{sending ? '전송 중…' : '전송'}
						</button>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => {
								setMessages([]);
								setError(null);
							}}
							disabled={sending}
						>
							대화 초기화
						</button>
						<div style={{ fontSize: 11, color: '#9ca3af' }}>팁: Ctrl/⌘ + Enter로 전송</div>
					</div>
				</div>

				{error ? <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div> : null}
			</div>
		</div>
	);
}

