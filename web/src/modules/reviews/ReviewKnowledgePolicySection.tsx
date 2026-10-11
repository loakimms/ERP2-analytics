import React, { useCallback, useEffect, useRef, useState } from 'react';

type Get = <T>(url: string, config?: Record<string, any>) => Promise<{ data: T }>;
type Post = <T>(url: string, body?: any, config?: Record<string, any>) => Promise<{ data: T }>;

type GuideRef = { source_id: string; entry_key: string; available?: boolean; statement?: string | null; authority_class?: string | null };

type PolicyRecord = {
	decision_id: string;
	question_id: string;
	decision: string;
	decision_text: string;
	products: string[];
	issue_ids: string[];
	condition_key: string;
	exception_knowledge_ids: string[];
	evidence: { source_id: string; entry_key: string; excerpt?: string }[];
	note?: string | null;
	reviewer_email?: string | null;
	reviewer_role?: string | null;
	created_at?: string | null;
};

export type PolicyCard = {
	question_id: string;
	title: string;
	question: string;
	conflict_summary: string;
	issue_ids: string[];
	guide_conflict: boolean;
	products: string[];
	conditions: { key: string; label: string }[];
	guide_refs: GuideRef[];
	notes: string[];
	question_sha256: string;
	linked_reply_count: number;
	authorship_at_audit: Record<string, number>;
	state: string;
	state_reasons: string[];
	latest: PolicyRecord | null;
	latest_record_id: string;
	history_count: number;
};

type PolicyMember = {
	knowledge_id: string;
	issue_ids: string[];
	quotes: string[];
	product_group: string;
	authorship: string;
	condition_key: string;
	review_text?: string | null;
	reply_text?: string | null;
	reply_available: boolean;
	application: Record<string, string>;
};

type CardsResponse = {
	available: boolean;
	artifact_version: string;
	pending_count: number;
	counts: Record<string, number>;
	cards: PolicyCard[];
	auto_rules: { rule_id: string; title: string; rule: string; reply_count: number }[];
};

type DetailResponse = PolicyCard & { members: PolicyMember[]; history: PolicyRecord[] };

const DECISION_LABELS: Record<string, string> = {
	GUIDE_STANDARD: '공식 가이드 기준 적용',
	HUMAN_SUPPLEMENT: '사람 답글의 보충 설명 인정',
	NEEDS_EVIDENCE: '추가 근거 확인 필요',
	EXCLUDE_EXPRESSION: '현재 표현 사용 제외',
};
const STATE_LABELS: Record<string, string> = {
	PENDING: '결정 대기',
	CURRENT: '결정 유효',
	REEVALUATION_REQUIRED: '재판정 필요',
	POLICY_SOURCE_MISSING: '공식 근거 누락(보류)',
};
const APPLICATION_LABELS: Record<string, string> = {
	APPLIES: '결정 적용',
	EXCEPTION: '예외',
	NO_DECISION: '결정 전',
	REEVALUATION_REQUIRED: '재판정 필요',
	OUT_OF_SCOPE_PRODUCT: '다른 제품(미적용)',
	OUT_OF_SCOPE_CLAIM: '다른 주장(미적용)',
	OUT_OF_SCOPE_CONDITION: '다른 조건(미적용)',
};
const PRODUCT_LABELS: Record<string, string> = { HENNA: '헤나', HAIR_PACK: '헤어팩', SHAMPOO: '샴푸', JOJOBA: '호호바 오일' };
const ERROR_LABELS: Record<string, string> = {
	knowledge_validation_write_not_enabled: '운영 DB 기록 반영이 아직 활성화되지 않았습니다(별도 승인 대상).',
	POLICY_STALE_VIEW: '다른 관리자가 먼저 결정했습니다. 새로고침한 뒤 다시 판단하세요.',
	POLICY_REQUEST_ID_REUSED: '이미 다른 내용으로 처리된 요청입니다. 새로고침 후 다시 시도하세요.',
	POLICY_QUESTION_CHANGED: '정책 질문 내용이 바뀌었습니다. 새로고침 후 다시 판단하세요.',
	POLICY_SOURCE_MISSING: '연결된 공식 근거가 레지스트리에 없어 결정을 저장할 수 없습니다(보류).',
	POLICY_HUMAN_OVER_GUIDE_NOT_ALLOWED: '공식 가이드와 충돌하는 질문에서는 사람 답글을 가이드보다 우선할 수 없습니다.',
	POLICY_PRODUCT_OUT_OF_SCOPE: '이 질문의 제품 범위를 벗어난 제품은 선택할 수 없습니다.',
	POLICY_CLAIM_OUT_OF_SCOPE: '이 질문의 주장 범위를 벗어난 항목은 선택할 수 없습니다.',
	POLICY_CONDITION_OUT_OF_SCOPE: '이 질문에 정의되지 않은 조건입니다.',
	POLICY_EVIDENCE_NOT_LINKED: '이 질문에 연결된 공식 근거만 선택할 수 있습니다.',
	POLICY_EVIDENCE_REQUIRED: '공식 가이드 기준 적용은 공식 근거를 1개 이상 선택해야 합니다.',
	POLICY_EXCEPTION_NOT_LINKED: '연결 답글이 아닌 답글은 예외로 지정할 수 없습니다.',
	policy_decision_text_required: '결정 내용을 5자 이상 입력해야 합니다.',
	policy_reason_required: '판단 사유를 5자 이상 입력해야 합니다.',
	reviewer_fields_not_accepted: '결정자 정보는 로그인 정보로만 기록됩니다.',
};

const newRequestId = () => `pol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const label = (map: Record<string, string>, key?: string | null) => (key ? map[key] || key : '-');
const pad4 = (n: number) => String(Math.max(0, n)).padStart(4, '0');

function errorText(err: any): string {
	const raw = err?.response?.data?.detail;
	const code = raw && typeof raw === 'object' && typeof raw.code === 'string' ? raw.code : raw;
	const status = err?.response?.status;
	if (typeof code === 'string' && ERROR_LABELS[code]) return ERROR_LABELS[code];
	if (status === 401) return '로그인이 필요합니다.';
	if (status === 403) return '정책 결정 권한이 없습니다(ops_admin 이상).';
	return String(code || err?.message || '요청에 실패했습니다.');
}

function toggle(list: string[], value: string): string[] {
	return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function DecisionForm({
	detail,
	canValidate,
	onSubmit,
}: {
	detail: DetailResponse;
	canValidate: boolean;
	onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
	const [decision, setDecision] = useState('');
	const [decisionText, setDecisionText] = useState('');
	const [note, setNote] = useState('');
	const [products, setProducts] = useState<string[]>(detail.products);
	const [issues, setIssues] = useState<string[]>(detail.issue_ids);
	const [condition, setCondition] = useState(detail.conditions[0]?.key || '');
	const [evidence, setEvidence] = useState<string[]>([]);
	const [exceptions, setExceptions] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const requestId = useRef(newRequestId());
	const ready =
		canValidate && !saving && decision && decisionText.trim().length >= 5 && note.trim().length >= 5 && products.length && issues.length &&
		(decision !== 'GUIDE_STANDARD' || evidence.length > 0) && detail.state !== 'POLICY_SOURCE_MISSING';

	const submit = async () => {
		if (!ready) return;
		setSaving(true);
		const ok = await onSubmit({
			request_id: requestId.current,
			question_id: detail.question_id,
			question_sha256: detail.question_sha256,
			supersedes_record_id: detail.latest_record_id,
			decision,
			decision_text: decisionText.trim(),
			note: note.trim(),
			products,
			issue_ids: issues,
			condition_key: condition,
			evidence: detail.guide_refs.filter((r) => evidence.includes(r.entry_key)).map((r) => ({ source_id: r.source_id, entry_key: r.entry_key })),
			exception_knowledge_ids: exceptions,
		});
		if (ok) requestId.current = newRequestId();
		setSaving(false);
	};

	return (
		<div aria-label="policy-decision-form" style={{ display: 'grid', gap: 8, borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
			<div style={{ fontWeight: 600 }}>7. 관리자 결정</div>
			<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
				{Object.entries(DECISION_LABELS).map(([value, text]) => {
					const blocked = value === 'HUMAN_SUPPLEMENT' && detail.guide_conflict;
					return (
						<label key={value} style={{ opacity: blocked ? 0.5 : 1 }}>
							<input
								type="radio"
								name="policy-decision"
								aria-label={`policy-decision-${value}`}
								value={value}
								checked={decision === value}
								disabled={blocked}
								onChange={() => setDecision(value)}
							/>{' '}
							{text}
						</label>
					);
				})}
			</div>
			<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
				<span>적용 제품:</span>
				{detail.products.map((p) => (
					<label key={p}>
						<input type="checkbox" aria-label={`policy-product-${p}`} checked={products.includes(p)} onChange={() => setProducts(toggle(products, p))} />{' '}
						{label(PRODUCT_LABELS, p)}
					</label>
				))}
				<span>주장 범위:</span>
				{detail.issue_ids.map((i) => (
					<label key={i}>
						<input type="checkbox" aria-label={`policy-issue-${i}`} checked={issues.includes(i)} onChange={() => setIssues(toggle(issues, i))} /> {i}
					</label>
				))}
				<label>
					조건{' '}
					<select aria-label="policy-condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
						{detail.conditions.map((c) => (
							<option key={c.key} value={c.key}>
								{c.label}
							</option>
						))}
					</select>
				</label>
			</div>
			<div style={{ display: 'grid', gap: 2, fontSize: 12 }}>
				<span>결정 근거(공식 자료):</span>
				{detail.guide_refs.map((r) => (
					<label key={r.entry_key}>
						<input
							type="checkbox"
							aria-label={`policy-evidence-${r.entry_key}`}
							checked={evidence.includes(r.entry_key)}
							disabled={!r.available}
							onChange={() => setEvidence(toggle(evidence, r.entry_key))}
						/>{' '}
						{r.entry_key}
					</label>
				))}
			</div>
			{exceptions.length ? <div style={{ fontSize: 12 }}>예외로 지정한 답글: {exceptions.length}건</div> : null}
			<ExceptionPicker members={detail.members} value={exceptions} onChange={setExceptions} />
			<input aria-label="policy-decision-text" placeholder="결정 내용 (예: 불편감 발생 시 즉시 사용 중단)" value={decisionText} onChange={(e) => setDecisionText(e.target.value)} />
			<textarea aria-label="policy-note" placeholder="판단 사유 (5자 이상)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
			<div>
				<button type="button" className="btn" aria-label="policy-save" disabled={!ready} onClick={() => void submit()}>
					{saving ? '저장 중…' : '결정 저장'}
				</button>
				<span style={{ fontSize: 12, marginLeft: 8 }}>
					저장하면 새 이력으로 추가됩니다. 같은 제품·주장·조건의 답글에만 재사용되며 답글을 자동 승인하지 않습니다.
				</span>
			</div>
		</div>
	);
}

function ExceptionPicker({ members, value, onChange }: { members: PolicyMember[]; value: string[]; onChange: (v: string[]) => void }) {
	return (
		<details style={{ fontSize: 12 }}>
			<summary>예외 답글 지정(선택)</summary>
			<div style={{ maxHeight: 160, overflow: 'auto', display: 'grid', gap: 2 }}>
				{members.map((m) => (
					<label key={m.knowledge_id}>
						<input type="checkbox" checked={value.includes(m.knowledge_id)} onChange={() => onChange(toggle(value, m.knowledge_id))} />{' '}
						{m.knowledge_id.split(':').pop()} · {m.quotes[0]?.slice(0, 60)}
					</label>
				))}
			</div>
		</details>
	);
}

const MEMBER_PAGE = 20;

function PolicyDetail({ detail, canValidate, onSubmit }: { detail: DetailResponse; canValidate: boolean; onSubmit: (p: Record<string, unknown>) => Promise<boolean> }) {
	const [shown, setShown] = useState(MEMBER_PAGE);
	return (
		<div aria-label="policy-detail" style={{ display: 'grid', gap: 10 }}>
			<div>
				<div style={{ fontWeight: 600 }}>
					{detail.question_id} · {detail.title} <span style={{ fontSize: 12 }}>({label(STATE_LABELS, detail.state)})</span>
				</div>
				<div>1. {detail.question}</div>
			</div>
			<div>
				<div style={{ fontWeight: 600 }}>2. 공식 가이드 관련 내용</div>
				<ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
					{detail.guide_refs.map((r) => (
						<li key={r.entry_key}>
							<code>{r.entry_key}</code> {r.available ? r.statement : '— 레지스트리에 없음(보류)'}
						</li>
					))}
				</ul>
			</div>
			<div style={{ fontSize: 12 }}>
				<div style={{ fontWeight: 600, fontSize: 14 }}>4. 충돌·불명확한 부분</div>
				<div>{detail.conflict_summary}</div>
				{detail.notes.map((n) => (
					<div key={n}>· {n}</div>
				))}
				{detail.state_reasons.length ? <div>재판정 사유: {detail.state_reasons.join(', ')}</div> : null}
			</div>
			<div style={{ fontSize: 12 }}>
				<span style={{ fontWeight: 600, fontSize: 14 }}>5. 적용 제품·조건</span> {detail.products.map((p) => label(PRODUCT_LABELS, p)).join(', ')} ·{' '}
				{detail.conditions.map((c) => c.label).join(' / ')}
			</div>
			<div>
				<div style={{ fontWeight: 600 }}>
					3·6. 관련 과거 답글 {pad4(detail.members.length)}건 (작성 주체:{' '}
					{Object.entries(detail.authorship_at_audit)
						.map(([a, n]) => `${a} ${n}`)
						.join(', ')}
					)
				</div>
				<div style={{ display: 'grid', gap: 6 }} aria-label="policy-members">
					{detail.members.slice(0, shown).map((m) => (
						<details key={m.knowledge_id} style={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 4, padding: 4 }}>
							<summary>
								{m.knowledge_id.split(':').pop()} · {label(PRODUCT_LABELS, m.product_group)} · {m.authorship} ·{' '}
								{Object.entries(m.application)
									.map(([i, a]) => `${i} ${label(APPLICATION_LABELS, a)}`)
									.join(', ')}
								<div style={{ color: '#b45309' }}>“{m.quotes.join(' / ')}”</div>
							</summary>
							{m.reply_available ? (
								<div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
									<div>
										<b>리뷰</b> {m.review_text}
									</div>
									<div>
										<b>답글</b> {m.reply_text}
									</div>
								</div>
							) : (
								<div>원본 답글을 현재 DB에서 찾지 못했습니다.</div>
							)}
						</details>
					))}
				</div>
				{shown < detail.members.length ? (
					<button type="button" className="btn" onClick={() => setShown(shown + MEMBER_PAGE)}>
						더 보기 ({pad4(shown)}/{pad4(detail.members.length)})
					</button>
				) : null}
			</div>
			<DecisionForm key={`${detail.question_id}:${detail.latest_record_id}`} detail={detail} canValidate={canValidate} onSubmit={onSubmit} />
			{detail.history.length ? (
				<div style={{ fontSize: 12 }} aria-label="policy-history">
					<div style={{ fontWeight: 600, fontSize: 14 }}>결정 이력(최신순, 수정·삭제 없음)</div>
					{detail.history.map((h) => (
						<div key={h.decision_id}>
							{h.created_at || '-'} · {label(DECISION_LABELS, h.decision)} · {h.decision_text} · 제품 {h.products.map((p) => label(PRODUCT_LABELS, p)).join(', ')} · 주장{' '}
							{h.issue_ids.join(', ')}
							{h.exception_knowledge_ids.length ? ` · 예외 ${h.exception_knowledge_ids.length}건` : ''}
							{h.reviewer_email ? ` · ${h.reviewer_email}` : ''}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

export function ReviewKnowledgePolicySection({
	apiBaseUrl,
	roleProtectedGet,
	roleProtectedPost,
	canValidate,
}: {
	apiBaseUrl: string;
	roleProtectedGet: Get;
	roleProtectedPost: Post;
	canValidate: boolean;
}): JSX.Element {
	const [cards, setCards] = useState<CardsResponse | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<DetailResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const base = `${apiBaseUrl}/reviews/reply-knowledge`;

	const loadCards = useCallback(async () => {
		try {
			const res = await roleProtectedGet<CardsResponse>(`${base}/policy-questions`);
			setCards(Array.isArray(res.data?.cards) ? res.data : null);
		} catch (err) {
			setError(errorText(err));
		}
	}, [base, roleProtectedGet]);

	const loadDetail = useCallback(
		async (qid: string) => {
			try {
				const res = await roleProtectedGet<DetailResponse>(`${base}/policy-questions/${encodeURIComponent(qid)}`);
				setDetail(Array.isArray(res.data?.members) ? res.data : null);
			} catch (err) {
				setError(errorText(err));
			}
		},
		[base, roleProtectedGet],
	);

	useEffect(() => {
		void loadCards();
	}, [loadCards]);

	useEffect(() => {
		if (selectedId) void loadDetail(selectedId);
	}, [selectedId, loadDetail]);

	const submit = useCallback(
		async (payload: Record<string, unknown>) => {
			setMessage(null);
			try {
				await roleProtectedPost(`${base}/policy-decisions`, payload);
				setMessage(`정책 결정 저장: ${label(DECISION_LABELS, String(payload.decision))} (답글 자동 승인·작성 주체 변경 없음)`);
				await loadDetail(String(payload.question_id));
				await loadCards();
				return true;
			} catch (err) {
				setMessage(errorText(err));
				return false;
			}
		},
		[base, roleProtectedPost, loadCards, loadDetail],
	);

	return (
		<section className="card" aria-label="policy-section">
			<div className="card-title">가이드 우선 정책 결정</div>
			<div className="card-caption">
				공식 가이드와 과거 답글이 충돌하거나 불확실한 대표 질문만 판단합니다. 결정은 같은 제품·주장·조건의 답글에만 재사용되며, 답글을 자동 승인(VERIFIED)하거나 작성
				주체를 바꾸지 않습니다. 개별 Unit·Claim 검증은 필수 절차가 아닙니다.
			</div>
			{cards ? (
				<div aria-label="policy-summary" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
					<b>
						정책 결정 대기 {pad4(cards.pending_count)}/{pad4(cards.cards.length)}
					</b>
					{Object.entries(cards.counts).map(([s, n]) => (
						<span key={s}>
							{label(STATE_LABELS, s)} {n}
						</span>
					))}
				</div>
			) : null}
			{cards?.auto_rules?.length ? (
				<details style={{ fontSize: 12, marginTop: 4 }}>
					<summary>자동 적용 규칙 {cards.auto_rules.length}개(관리자 결정 불필요, 공식 기준 우선)</summary>
					{cards.auto_rules.map((r) => (
						<div key={r.rule_id}>
							{r.rule_id} {r.title} — {r.rule} (관련 답글 {r.reply_count}건)
						</div>
					))}
				</details>
			) : null}
			{error ? <div className="review-analysis-inline-error">{error}</div> : null}
			{message ? (
				<div role="status" aria-label="policy-message" style={{ fontSize: 12 }}>
					{message}
				</div>
			) : null}
			{cards ? (
				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 3fr', gap: 12, marginTop: 8 }}>
					<div style={{ display: 'grid', gap: 4, alignContent: 'start' }} aria-label="policy-cards">
						{cards.cards.map((c) => (
							<button
								key={c.question_id}
								type="button"
								aria-label={`policy-card-${c.question_id}`}
								onClick={() => setSelectedId(c.question_id)}
								style={{
									textAlign: 'left',
									padding: 6,
									border: selectedId === c.question_id ? '2px solid #2563eb' : '1px solid #e5e7eb',
									borderRadius: 4,
									background: c.state === 'CURRENT' ? '#f0fdf4' : '#fff',
								}}
							>
								<div style={{ fontWeight: 600 }}>
									{c.question_id} {c.title}
								</div>
								<div style={{ fontSize: 12 }}>
									{label(STATE_LABELS, c.state)} · 답글 {c.linked_reply_count}건
									{c.latest ? ` · ${label(DECISION_LABELS, c.latest.decision)}` : ''}
								</div>
							</button>
						))}
					</div>
					<div>
						{detail && detail.question_id === selectedId ? (
							<PolicyDetail detail={detail} canValidate={canValidate} onSubmit={submit} />
						) : (
							<div style={{ fontSize: 12 }}>왼쪽에서 정책 질문을 선택하세요.</div>
						)}
						{!canValidate ? (
							<div style={{ fontSize: 12, marginTop: 6 }} aria-label="policy-readonly">
								조회 전용: 정책 결정 저장은 ops_admin 이상이며 운영 DB 기록 반영 승인 후에만 가능합니다.
							</div>
						) : null}
					</div>
				</div>
			) : null}
		</section>
	);
}
