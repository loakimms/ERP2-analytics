import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewKnowledgePolicySection } from './ReviewKnowledgePolicySection';

type SequenceStep = { order: number; text: string; product: string | string[]; numeric: string[] | string; connector?: string };

type NumericRange = { text: string; min: number | null; max: number | null; unit: string; isRange: boolean };

type KnowhowItem = {
	sentence: string;
	topics: string[];
	facts: string[];
	requires_current_fact_verification: boolean;
	current_validity: string;
	originalText?: string;
	sourceTextSpan?: [number, number];
	knowledgeType?: string;
	isKnowledgeCandidate?: boolean;
	product?: string[] | string;
	condition?: string;
	conditionReference?: string;
	contextBefore?: string;
	sequence?: SequenceStep[];
	numericRange?: NumericRange[];
	limitation?: string[];
	extractionVersion?: string;
	validationStatus?: string;
	factValidation?: UnitFactValidation | null;
	generatorFactEligible?: boolean;
	factUseBlockedReasons?: string[];
	analysisLabel?: string;
};

type FactEvidence = {
	source_id: string;
	source_version?: string;
	entry_key: string;
	excerpt?: string;
	products?: string[];
	covers?: string[];
};

type UnitFactValidation = {
	unitKey: string;
	status: string;
	recordedStatus: string | null;
	resolution: string;
	applicableAspects: string[];
	historyCount: number;
	staleHistoryCount: number;
	latest: {
		fact_status: string;
		verified_scope: string | null;
		hold_reason: string | null;
		evidence: FactEvidence[];
		note: string | null;
		reviewer_email: string | null;
		created_at: string | null;
	} | null;
};

type UnitFactRecord = {
	unit_fact_validation_id: string;
	unit_key: string;
	unit_text: string;
	fact_status: string;
	hold_reason: string | null;
	verified_scope: string | null;
	evidence: FactEvidence[];
	note: string | null;
	reviewer_email: string | null;
	reviewer_role: string | null;
	extraction_version: string;
	created_at: string | null;
};

type OfficialEntry = {
	entry_key: string;
	kind: string;
	statement: string;
	products: string[];
	aspects: string[];
	can_verify?: boolean;
	condition?: string | null;
	condition_required?: boolean;
	application_modes?: string[] | null;
	source_fidelity_status?: string | null;
	current_applicability?: { status: string; products: string[]; review_id: string | null } | null;
};

type OfficialSource = {
	source_id: string;
	version: string;
	authority_class: string;
	status: string;
	can_verify: boolean;
	entries: OfficialEntry[];
};

type OfficialSourcesResponse = { registry_version: string; sources: OfficialSource[]; verifying_entry_count: number };

type ExtractionChange = { changes: string[]; meaningChanged: boolean; oldVersion: string; newVersion: string; comparedWith?: string };

type ValidationRecord = {
	validation_id: string;
	content_validation: string;
	reply_appropriate: string | null;
	guidance_accurate: string | null;
	currently_valid: string | null;
	reference_worthy: string | null;
	note: string | null;
	reviewer: string | null;
	reviewer_email?: string | null;
	reviewer_role?: string | null;
	authorship_class_at_validation: string | null;
	created_at: string | null;
};

type ValidatorPermission = {
	authenticated: boolean;
	can_validate: boolean;
	role: string | null;
	required_role: string;
};

export type KnowledgeQueueItem = {
	knowledge_id: string;
	review_key: string;
	product_title: string | null;
	product_group: string;
	rating: number | null;
	review_written_at: string | null;
	remote_reply_date: string | null;
	review_text: string;
	reply_text: string;
	authorship: string;
	authorship_evidence: string;
	tier: string;
	has_knowhow: boolean;
	knowhow_items: KnowhowItem[];
	analysis_labels?: string[];
	review_topics: string[];
	reply_topics: string[];
	template_like: boolean;
	policy_violations: string[];
	content_validation: string;
	queue_priority: number | null;
	validation_history?: ValidationRecord[];
	extraction_version?: string;
	extraction_change?: ExtractionChange | null;
	previous_extraction?: Array<{ sentence?: string; originalText?: string }> | null;
	revalidation_required?: boolean;
	current_use_authority?: string;
	reply_reference_eligible?: boolean;
	generator_fact_eligible?: boolean;
	approved_retrieval_boost?: boolean;
	fact_ineligible_reasons?: string[];
	unit_fact_counts?: { candidates: number; status: Record<string, number>; generator_fact_eligible: number } | null;
	unit_fact_history?: UnitFactRecord[];
};

type KnowledgeSummary = {
	total: number;
	invalid: number;
	valid: number;
	authorship: Record<string, number>;
	tiers: Record<string, number>;
	content_validation_of_human_reference_tiers: Record<string, number>;
	unknown_with_knowhow: number;
	revalidation_required?: number;
	extraction_version?: string;
	use_authority_scope_total?: number;
	use_authority_counts?: Record<string, number>;
	reply_reference_eligible?: number;
	generator_fact_eligible?: number;
	unit_fact_scope_units?: number;
	unit_fact_status_counts?: Record<string, number>;
	unit_generator_fact_eligible?: number;
	retrieval_status: string;
	validation_write_enabled: boolean;
};

type QueueResponse = { total: number; items: KnowledgeQueueItem[]; validation_write_enabled: boolean };

type RetrievalResult = {
	knowledge_id: string;
	score: number;
	retrieval_reasons: string[];
	past_review_text: string;
	past_reply_text: string;
	authorship: string;
	tier: string;
	product_group: string;
	topics: string[];
	guidance_current_validity: string[];
	content_validation: string;
	current_use_authority?: string;
	reply_reference_eligible?: boolean;
	generator_fact_eligible?: boolean;
	use_warning?: string | null;
};

type RetrievalResponse = { retrieval_status: string; use_contract?: string; results: RetrievalResult[] };

const USE_AUTHORITY_LABELS: Record<string, string> = {
	EXCLUDED_INVALID_REPLY: '무효 답글',
	AI_ORIGIN_REFERENCE: 'AI 출처 답글',
	HISTORICAL_REPLY_ORIGINAL: '과거 응대 원문',
	EXTRACTED_KNOWLEDGE: '추출만 됨 (미검증)',
	VALIDATION_STALE_REPLY_CHANGED: '원문 변경으로 기존 검증 미적용',
	APPROVED_HISTORICAL_REFERENCE: '승인된 과거 응대 (응대 참고용)',
	APPROVED_NOT_CURRENTLY_VALID: '승인됐으나 현재 유효성 미확인',
	REVALIDATION_REQUIRED: '재검증 필요 (참고 가산점·사실 사용 차단)',
	VALIDATION_HOLD: '보류',
	VALIDATION_EXCLUDED: '제외',
	VALIDATION_OUTDATED: '현재 무효',
	VALIDATED_KNOWLEDGE: '개별 전문 사실 검증 완료',
};

const FACT_REASON_LABELS: Record<string, string> = {
	REPLY_NOT_APPROVED: '답글 미승인',
	REPLY_HASH_MISMATCH: '원문 해시 불일치',
	REVALIDATION_REQUIRED: '재검증 필요',
	EXTRACTION_MEANING_CHANGED: '추출 의미 변경',
	NOT_CURRENTLY_VALID: '현재 유효성 미확인',
	NO_UNIT_FACT_VALIDATION_RECORD: '개별 전문 사실 검증 기록 없음',
	UNIT_FACT_PARTIALLY_VERIFIED: '일부 항목만 사실 확인됨',
	AI_ORIGIN_REFERENCE: 'AI 출처',
	EXCLUDED_INVALID_REPLY: '무효 답글',
	UNIT_FACT_NOT_VERIFIED: '항목 사실 미확인',
	GENERATOR_REFERENCE_NOT_ALLOWED: '새 답글 참고 불허',
	NOT_A_FACT_CANDIDATE: '사실 항목 아님',
	STALE_REPLY_CHANGED: '답글 원문 변경으로 기존 검증 미적용',
	STALE_UNIT_OR_EXTRACTION_CHANGED: '추출 변경으로 기존 검증 미적용',
	OFFICIAL_SOURCE_CHANGED: '공식 자료 변경으로 재확인 필요',
	PARENT_REVALIDATION_REQUIRED: '상위 답글 재검증 필요',
	PARENT_VALIDATION_HOLD: '상위 답글 보류',
	PARENT_VALIDATION_EXCLUDED: '상위 답글 제외',
	PARENT_VALIDATION_OUTDATED: '상위 답글 현재 무효',
	PARENT_VALIDATION_STALE_REPLY_CHANGED: '상위 답글 원문 해시 불일치',
	PARENT_APPROVED_NOT_CURRENTLY_VALID: '상위 답글 현재 유효성 미확인',
	PARENT_AI_ORIGIN_REFERENCE: '상위 답글 AI 출처',
	PARENT_EXCLUDED_INVALID_REPLY: '상위 답글 무효',
};

const FACT_STATUS_LABELS: Record<string, string> = {
	PENDING: '사실 검증 대기',
	VERIFIED: '공식 근거로 확인',
	HOLD: '보류',
	REJECTED: '공식 근거와 불일치',
	OUTDATED: '현재 무효',
};

const HOLD_REASON_LABELS: Record<string, string> = {
	FACT_VALIDATION_SOURCE_MISSING: '등록된 공식 근거 없음',
	PARTIAL_OFFICIAL_EVIDENCE: '공식 근거가 일부만 있음',
	PRODUCT_SCOPE_UNKNOWN: '적용 제품 불명확',
	NEEDS_PRODUCT_OWNER_CONFIRMATION: '제품 담당 확인 필요',
	OTHER: '기타',
};

const ASPECT_QUESTIONS: { field: string; aspect: string; label: string }[] = [
	{ field: 'statement_accurate', aspect: 'statement', label: '이 전문 안내가 정확한가요?' },
	{ field: 'product_applicable', aspect: 'product', label: '현재 제품에 적용 가능한가요?' },
	{ field: 'condition_accurate', aspect: 'condition', label: '적용 조건이 정확한가요?' },
	{ field: 'sequence_accurate', aspect: 'sequence', label: '사용 순서가 정확한가요?' },
	{ field: 'numeric_accurate', aspect: 'numeric', label: '시간·비율 수치 범위가 정확한가요?' },
];

type Props = {
	apiBaseUrl: string;
	roleProtectedGet: <T>(url: string, config?: Record<string, any>) => Promise<{ data: T }>;
	roleProtectedPost: <T>(url: string, body?: any, config?: Record<string, any>) => Promise<{ data: T }>;
};

const QUEUE_FILTER_LABELS: Record<string, string> = {
	unknown_knowhow: 'UNKNOWN 중 전문 안내 포함',
	provisional_knowhow: 'LIKELY_HUMAN 중 전문 안내 포함',
	all_candidates: '전문 안내 포함 전체',
	provisional_all: 'LIKELY_HUMAN 전체',
	revalidation_required: '재검증 필요 (의미가 달라진 승인 항목)',
};

const KNOWLEDGE_TYPE_LABELS: Record<string, string> = {
	ORDERED_PROCEDURE: '순서가 있는 절차',
	CONDITIONAL_GUIDANCE: '조건부 안내',
	NUMERIC_GUIDANCE: '시간·비율 안내',
	CAUTION: '주의·제한',
	QUESTION_OR_CONFIRMATION: '질문·확인 요청 (지식 아님)',
	PRODUCT_USAGE: '제품 사용 안내',
	EXPLANATION: '설명',
};

const CHANGE_LABELS: Record<string, string> = {
	NO_CHANGE: '변경 없음',
	BOUNDARY_OR_DISPLAY_ONLY: '표시·경계만 변경',
	CONDITION_RESTORED: '조건 추가·복원',
	SEQUENCE_RESTORED: '순서 복원',
	NUMERIC_RANGE_RESTORED: '숫자 범위 복원',
	PRODUCT_TARGET_CHANGED: '제품·대상 변경',
	QUESTION_RECLASSIFIED: '질문으로 재분류',
	GUIDANCE_ADDED: '안내 추가',
	GUIDANCE_REMOVED: '안내 제외',
};

const UNIT_STATUS_LABELS: Record<string, string> = {
	UNVERIFIED: '미검증',
	REPLY_APPROVED_UNIT_NOT_INDIVIDUALLY_VERIFIED: '답글 승인됨 · 항목별 사실 미검증',
	REVALIDATION_REQUIRED: '재검증 필요',
};

const label = (map: Record<string, string>, key: string | undefined | null) => (key ? map[key] || key : '-');

const listText = (value: string[] | string | undefined | null) =>
	Array.isArray(value) ? value.join(', ') || '-' : value && value !== 'UNKNOWN' ? value : 'UNKNOWN';

export type UnitFactSubmit = (unit: KnowhowItem, payload: Record<string, unknown>) => Promise<boolean>;

const unitProducts = (unit: KnowhowItem) =>
	(Array.isArray(unit.product) ? unit.product : unit.product ? [unit.product] : []).filter((p) => p && p !== 'UNKNOWN');

function UnitFactForm({
	unit,
	sources,
	canValidate,
	onSubmit,
}: {
	unit: KnowhowItem;
	sources: OfficialSource[];
	canValidate: boolean;
	onSubmit: UnitFactSubmit;
}) {
	const aspects = unit.factValidation?.applicableAspects || ['statement', 'product'];
	const products = unitProducts(unit);
	const related = sources
		.filter((s) => s.can_verify)
		.flatMap((s) => s.entries.filter((e) => e.kind !== 'restriction' && e.products.some((p) => products.includes(p))).map((e) => ({ source: s, entry: e })));
	const candidates = related.filter(({ entry }) => entry.can_verify !== false);
	const unverifiedRelated = related.filter(({ entry }) => entry.can_verify === false);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [generatorAllowed, setGeneratorAllowed] = useState<string>('');
	const [picked, setPicked] = useState<string[]>([]);
	const [scope, setScope] = useState('');
	const [note, setNote] = useState('');
	const [holdReason, setHoldReason] = useState('FACT_VALIDATION_SOURCE_MISSING');
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const noteReady = note.trim().length >= NOTE_MIN_CHARS;
	const applicable = ASPECT_QUESTIONS.filter((q) => aspects.includes(q.aspect));
	const allYes = applicable.every((q) => answers[q.field] === 'yes');
	const canVerify =
		canValidate && allYes && Boolean(generatorAllowed) && picked.length > 0 && scope.trim().length >= NOTE_MIN_CHARS && noteReady;
	const evidence = picked.map((id) => {
		const hit = candidates.find((c) => `${c.source.source_id}::${c.entry.entry_key}` === id)!;
		return { source_id: hit.source.source_id, entry_key: hit.entry.entry_key, covers: hit.entry.aspects.filter((a) => aspects.includes(a)) };
	});
	const submit = async (status: string) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const payload: Record<string, unknown> = { fact_status: status, note, evidence };
			if (status === 'VERIFIED') {
				applicable.forEach((q) => (payload[q.field] = answers[q.field]));
				payload.generator_reference_allowed = generatorAllowed;
				payload.verified_scope = scope;
			} else {
				applicable.forEach((q) => answers[q.field] && (payload[q.field] = answers[q.field]));
				if (status === 'HOLD') payload.hold_reason = holdReason;
			}
			await onSubmit(unit, payload);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	return (
		<div aria-label="unit-fact-form" style={{ border: '1px dashed rgba(148,163,184,0.5)', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
			{ASPECT_QUESTIONS.map((q) =>
				aspects.includes(q.aspect) ? (
					<div key={q.field} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						<span style={{ minWidth: 220 }}>{q.label}</span>
						{TRI_STATE.map((opt) => (
							<label key={opt.value}>
								<input
									type="radio"
									aria-label={`${q.field}-${opt.value}`}
									checked={answers[q.field] === opt.value}
									onChange={() => setAnswers((prev) => ({ ...prev, [q.field]: opt.value }))}
									disabled={!canValidate}
								/>{' '}
								{opt.label}
							</label>
						))}
					</div>
				) : (
					<div key={q.field} style={{ fontSize: 12, opacity: 0.7 }}>
						{q.label} 해당 없음 (이 항목에 없는 내용)
					</div>
				),
			)}
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<span style={{ minWidth: 220 }}>새 AI 답글에서 참고할 수 있나요?</span>
				{TRI_STATE.map((opt) => (
					<label key={opt.value}>
						<input
							type="radio"
							aria-label={`generator_reference_allowed-${opt.value}`}
							checked={generatorAllowed === opt.value}
							onChange={() => setGeneratorAllowed(opt.value)}
							disabled={!canValidate}
						/>{' '}
						{opt.label}
					</label>
				))}
			</div>
			<div aria-label="unit-fact-evidence-options">
				<div style={{ fontWeight: 700 }}>어떤 공식 자료로 확인했나요? (등록된 공식 자료만 선택 가능)</div>
				{candidates.length ? (
					candidates.map(({ source, entry }) => {
						const id = `${source.source_id}::${entry.entry_key}`;
						return (
							<label key={id} style={{ display: 'block', fontSize: 12 }}>
								<input
									type="checkbox"
									aria-label={`evidence-${entry.entry_key}`}
									checked={picked.includes(id)}
									onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))}
									disabled={!canValidate}
								/>{' '}
								[{source.source_id} {source.version}] {entry.statement} · 근거 범위 {entry.aspects.filter((a) => aspects.includes(a)).join(', ') || '없음'}
								{entry.condition ? ` · 적용 조건: ${entry.condition}${entry.condition_required ? ' (필수)' : ''}` : ''}
								{entry.application_modes?.length ? ` · 사용 방식: ${entry.application_modes.map((m) => MODE_LABELS[m] || m).join('/')}` : ''}
								{entry.current_applicability ? ` · 현재 적용 확인: ${entry.current_applicability.products.join(', ')}` : ''}
							</label>
						);
					})
				) : (
					<div role="status" aria-label="unit-fact-source-missing" style={{ fontSize: 12 }}>
						이 항목의 제품에 해당하는 등록된 공식 자료가 없습니다. 사실 확인은 할 수 없고 "등록된 공식 근거 없음"으로 보류할 수 있습니다.
					</div>
				)}
				{unverifiedRelated.length > 0 && (
					<details aria-label="unit-fact-unverified-sources" style={{ fontSize: 12 }}>
						<summary>현재 적용성 미확인 공식 자료 {unverifiedRelated.length}건 (근거로 선택 불가)</summary>
						{unverifiedRelated.map(({ source, entry }) => (
							<div key={`${source.source_id}::${entry.entry_key}`} style={{ opacity: 0.7 }}>
								[{source.source_id}] {entry.statement} · 원문 충실성 {entry.source_fidelity_status || '-'} · {entry.current_applicability?.status || '적용성 기록 없음'}
							</div>
						))}
					</details>
				)}
				<div style={{ fontSize: 12, opacity: 0.8 }}>
					조건·순서·수치가 있는 안내는 각각에 대한 공식 근거가 모두 있어야 사실 확인됩니다. URL·인용문 직접 입력은 근거로 인정하지 않습니다.
				</div>
			</div>
			<textarea
				aria-label="unit-fact-verified-scope"
				placeholder="확인한 사실 범위 (예: 염색약 사용 시간 2시간만 확인, 3시간은 불허)"
				value={scope}
				onChange={(e) => setScope(e.target.value)}
				disabled={!canValidate}
				rows={2}
			/>
			<textarea
				aria-label="unit-fact-note"
				placeholder={`판단 근거 메모 (필수, ${NOTE_MIN_CHARS}자 이상)`}
				value={note}
				onChange={(e) => setNote(e.target.value)}
				disabled={!canValidate}
				rows={2}
			/>
			<label style={{ fontSize: 12 }}>
				보류 사유{' '}
				<select aria-label="unit-fact-hold-reason" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} disabled={!canValidate}>
					{Object.entries(HOLD_REASON_LABELS).map(([value, text]) => (
						<option key={value} value={value}>
							{text}
						</option>
					))}
				</select>
			</label>
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<button type="button" className="btn-primary" disabled={!canVerify || busy} onClick={() => void submit('VERIFIED')}>
					공식 근거로 확인
				</button>
				<button type="button" className="btn-ghost" disabled={!canValidate || !noteReady || busy} onClick={() => void submit('HOLD')}>
					보류
				</button>
				<button type="button" className="btn-ghost" disabled={!canValidate || !noteReady || busy} onClick={() => void submit('REJECTED')}>
					공식 근거와 불일치
				</button>
				<button type="button" className="btn-ghost" disabled={!canValidate || !noteReady || busy} onClick={() => void submit('OUTDATED')}>
					현재 무효
				</button>
			</div>
		</div>
	);
}

function UnitFactStatusView({ unit }: { unit: KnowhowItem }) {
	const fv = unit.factValidation;
	if (!fv) return null;
	const reasons = (unit.factUseBlockedReasons || []).map((r) => label(FACT_REASON_LABELS, r));
	return (
		<div aria-label="unit-fact-status" style={{ fontSize: 12 }}>
			개별 사실 검증: <strong>{label(FACT_STATUS_LABELS, fv.status)}</strong>
			{fv.resolution !== 'NO_RECORD' && fv.resolution !== 'APPLICABLE' ? ` (${label(FACT_REASON_LABELS, fv.resolution)})` : ''}
			{fv.latest?.hold_reason ? ` · 사유 ${label(HOLD_REASON_LABELS, fv.latest.hold_reason)}` : ''} · 생성기 사실 사용{' '}
			{unit.generatorFactEligible ? '가능' : '불가'}
			{reasons.length && !unit.generatorFactEligible ? ` (${reasons.join(', ')})` : ''}
			{fv.latest?.verified_scope ? <div>확인 범위: {fv.latest.verified_scope}</div> : null}
			{fv.latest?.evidence?.length ? (
				<div>근거: {fv.latest.evidence.map((e) => `[${e.source_id} ${e.source_version || ''}] ${e.excerpt || e.entry_key}`).join(' / ')}</div>
			) : null}
		</div>
	);
}

function AnalysisLabelBadge({ label: text }: { label: string }) {
	return (
		<span
			aria-label="analysis-label"
			title="검토 자료의 분석 번호 (검증 결과 아님)"
			style={{ background: '#dc2626', color: '#fff', fontWeight: 700, padding: '0 6px', borderRadius: 4, marginRight: 6, fontSize: 12 }}
		>
			{text}
		</span>
	);
}

function KnowhowUnitView({
	unit,
	sources = [],
	canValidate = false,
	onSubmitFact,
}: {
	unit: KnowhowItem;
	sources?: OfficialSource[];
	canValidate?: boolean;
	onSubmitFact?: UnitFactSubmit;
}) {
	const [formOpen, setFormOpen] = useState(false);
	const isQuestion = unit.knowledgeType === 'QUESTION_OR_CONFIRMATION';
	return (
		<li style={{ marginBottom: 8 }} aria-label="knowhow-unit">
			<div style={{ fontWeight: 700 }}>
				{unit.analysisLabel ? <AnalysisLabelBadge label={unit.analysisLabel} /> : null}
				[{label(KNOWLEDGE_TYPE_LABELS, unit.knowledgeType)}] · {label(UNIT_STATUS_LABELS, unit.validationStatus)}
			</div>
			<div style={{ whiteSpace: 'pre-wrap', opacity: isQuestion ? 0.7 : 1 }}>{unit.originalText ?? unit.sentence}</div>
			{isQuestion ? (
				<div style={{ fontSize: 12 }}>질문·확인 요청 문장이므로 제품 지식으로 사용하지 않습니다.</div>
			) : (
				<div style={{ fontSize: 12, display: 'grid', gap: 2, marginTop: 4 }}>
					<div>제품: {listText(unit.product)}</div>
					<div aria-label="knowhow-unit-condition">조건·예외: {listText(unit.condition)}</div>
					{unit.contextBefore && unit.contextBefore !== 'UNKNOWN' ? (
						<div aria-label="knowhow-unit-context">
							조건이 가리키는 앞 문맥(참조 미확정): {unit.contextBefore}
						</div>
					) : null}
					{unit.sequence && unit.sequence.length ? (
						<div aria-label="knowhow-unit-sequence">
							순서: {unit.sequence.map((st) => `${st.order}) ${st.text}`).join(' → ')}
						</div>
					) : null}
					<div aria-label="knowhow-unit-range">
						시간·비율: {unit.numericRange && unit.numericRange.length ? unit.numericRange.map((r) => r.text).join(', ') : 'UNKNOWN'}
					</div>
					{unit.limitation && unit.limitation.length ? <div>제한·주의 표현: {unit.limitation.join(', ')}</div> : null}
					<div style={{ opacity: 0.8 }}>
						주제 {unit.topics.join(', ') || '-'} · 현재 유효성 {unit.current_validity}
						{unit.sourceTextSpan ? ` · 원문 위치 ${unit.sourceTextSpan[0]}–${unit.sourceTextSpan[1]}` : ''}
					</div>
					<UnitFactStatusView unit={unit} />
					{unit.factValidation && onSubmitFact ? (
						<div>
							<button type="button" className="btn-ghost" aria-label="unit-fact-form-toggle" onClick={() => setFormOpen((v) => !v)}>
								{formOpen ? '사실 검증 닫기' : '이 항목 사실 검증'}
							</button>
							{formOpen ? (
								<UnitFactForm
									unit={unit}
									sources={sources}
									canValidate={canValidate}
									onSubmit={async (u, payload) => {
										const ok = await onSubmitFact(u, payload);
										if (ok) setFormOpen(false);
										return ok;
									}}
								/>
							) : null}
						</div>
					) : null}
				</div>
			)}
		</li>
	);
}

type ClaimFactValidation = {
	claimKey: string;
	status: string;
	recordedStatus: string | null;
	resolution: string;
	historyCount: number;
	latestRecordId: string | null;
	changedEvidenceEntries: string[];
	latest: {
		fact_status: string;
		verified_scope: string | null;
		hold_reason: string | null;
		evidence: FactEvidence[];
		official_color_label: string | null;
		reviewer_role: string | null;
		created_at: string | null;
	} | null;
};

export type ClaimView = {
	claim_key: string;
	analysis_label: string;
	parent_unit_key: string;
	quote: string;
	canonical_key: string;
	analysis_class: string;
	downgrade_reasons: string[];
	products: string[];
	method: string | null;
	target_color: string | null;
	condition: string | null;
	analysis_note: string | null;
	suggested_evidence: { source_id: string | null; entry_key: string }[];
	applicable_aspects: string[];
	inherited_context: { mode: string; order: string[] } | null;
	official_color_labels: string[];
	target_color_match: string | null;
	integrity: string;
	verifiable: boolean;
	factValidation: ClaimFactValidation;
};

type ClaimParent = {
	parent_unit_key: string;
	parent_current: boolean;
	claim_count: number;
	verified_claim_count: number;
	unit_verified_blocked: boolean;
	claims: ClaimView[];
};

type ClaimRecord = {
	claim_validation_id: string;
	claim_key: string;
	claim_text: string;
	fact_status: string;
	official_color_label: string | null;
	hold_reason: string | null;
	verified_scope: string | null;
	reviewer_role: string | null;
	created_at: string | null;
};

type ClaimsResponse = {
	available: boolean;
	error?: string;
	version: string | null;
	parents: ClaimParent[];
	claim_history?: ClaimRecord[];
};

const ANALYSIS_CLASS_LABELS: Record<string, string> = {
	VERIFY_CANDIDATE: '공식 근거 대조 후보',
	PARTIAL: '일부만 공식 근거와 대응',
	PENDING: '공식 근거 부족',
	CONFLICT: '공식 근거와 충돌 가능',
};

const CLAIM_INTEGRITY_LABELS: Record<string, string> = {
	OK: '원문과 일치',
	PARENT_UNIT_NOT_CURRENT: '상위 항목이 바뀜 (검증 불가)',
	REPLY_CHANGED: '답글 원문이 바뀜 (검증 불가)',
	CLAIM_TEXT_MISMATCH: '주장 문장·위치 불일치 (검증 불가)',
};

const COLOR_MATCH_LABELS: Record<string, string> = {
	OFFICIAL_LITERAL: '공식 색상 표기와 같은 글자',
	NEEDS_HUMAN_EQUIVALENCE: '공식 색상 표기와 글자가 다름 — 같은 색인지 사람이 판단',
};

const OFFICIAL_COLOR_LABELS = ['오렌지 레드', '붉은 갈색', '연한 갈색', '진한 흑갈색'];

export type ClaimSubmit = (claim: ClaimView, payload: Record<string, unknown>) => Promise<boolean>;

const newClaimRequestId = () => `clr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function ClaimForm({
	claim,
	sources,
	canValidate,
	onSubmit,
}: {
	claim: ClaimView;
	sources: OfficialSource[];
	canValidate: boolean;
	onSubmit: ClaimSubmit;
}) {
	const aspects = claim.applicable_aspects;
	const suggested = new Set(claim.suggested_evidence.map((e) => `${e.source_id}::${e.entry_key}`));
	const candidates = sources
		.filter((s) => s.can_verify)
		.flatMap((s) =>
			s.entries
				.filter(
					(e) =>
						e.kind !== 'restriction' &&
						e.can_verify !== false &&
						(suggested.has(`${s.source_id}::${e.entry_key}`) || e.products.some((p) => claim.products.includes(p))),
				)
				.map((e) => ({ source: s, entry: e, id: `${s.source_id}::${e.entry_key}` })),
		)
		.sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)));
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [picked, setPicked] = useState<string[]>([]);
	const [colorLabel, setColorLabel] = useState('');
	const [scope, setScope] = useState('');
	const [note, setNote] = useState('');
	const [holdReason, setHoldReason] = useState('FACT_VALIDATION_SOURCE_MISSING');
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const requestIdRef = useRef(newClaimRequestId());
	const hasColor = aspects.includes('target_color');
	const questions = [
		...ASPECT_QUESTIONS.filter((q) => aspects.includes(q.aspect)),
		...(hasColor ? [{ field: 'target_color_accurate', aspect: 'target_color', label: '목표 색상이 선택한 공식 색상 표기와 같은 색인가요?' }] : []),
	];
	const pickedEntries = candidates.filter((c) => picked.includes(c.id));
	const colorOptions = OFFICIAL_COLOR_LABELS.filter((l) => pickedEntries.some((c) => c.entry.statement.includes(l)));
	const noteReady = note.trim().length >= NOTE_MIN_CHARS;
	const current = claim.integrity === 'OK';
	const canDecide = canValidate && current && noteReady && !busy;
	const canVerify =
		canDecide &&
		claim.verifiable &&
		questions.every((q) => answers[q.field] === 'yes') &&
		picked.length > 0 &&
		scope.trim().length >= NOTE_MIN_CHARS &&
		(!hasColor || colorOptions.includes(colorLabel));
	const submit = async (status: string) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const payload: Record<string, unknown> = {
				request_id: requestIdRef.current,
				supersedes_record_id: claim.factValidation.latestRecordId || 'ROOT',
				fact_status: status,
				note,
				generator_reference_allowed: 'no',
				evidence: pickedEntries.map((c) => ({
					source_id: c.source.source_id,
					entry_key: c.entry.entry_key,
					covers: c.entry.aspects.filter((a) => aspects.includes(a)),
				})),
			};
			questions.forEach((q) => (status === 'VERIFIED' || answers[q.field]) && (payload[q.field] = answers[q.field]));
			if (status === 'VERIFIED') {
				payload.verified_scope = scope;
				if (hasColor) payload.official_color_label = colorLabel;
			}
			if (status === 'HOLD') payload.hold_reason = holdReason;
			if (await onSubmit(claim, payload)) requestIdRef.current = newClaimRequestId();
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	return (
		<div aria-label="claim-form" style={{ border: '1px dashed rgba(148,163,184,0.5)', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
			{!current ? (
				<div role="status" aria-label="claim-not-current" style={{ fontSize: 12 }}>
					{label(CLAIM_INTEGRITY_LABELS, claim.integrity)} — 이 주장은 기록할 수 없습니다.
				</div>
			) : !claim.verifiable ? (
				<div role="status" aria-label="claim-not-verifiable" style={{ fontSize: 12 }}>
					자동 분석 결과가 "{label(ANALYSIS_CLASS_LABELS, claim.analysis_class)}"인 주장은 "공식 근거로 확인"할 수 없습니다. 보류·불일치·현재 무효만 기록할 수
					있습니다.
					{claim.analysis_class === 'PARTIAL'
						? ' 확인 문항 답변이나 메모로는 풀리지 않습니다. 추가 공식 근거 확보 또는 주장 범위 정정 후 분리 자료 재검증(새 버전)을 거쳐야 검토 후보가 됩니다.'
						: ''}
				</div>
			) : null}
			{questions.map((q) => (
				<div key={q.field} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
					<span style={{ minWidth: 220 }}>{q.label}</span>
					{TRI_STATE.map((opt) => (
						<label key={opt.value}>
							<input
								type="radio"
								aria-label={`claim-${q.field}-${opt.value}`}
								checked={answers[q.field] === opt.value}
								onChange={() => setAnswers((prev) => ({ ...prev, [q.field]: opt.value }))}
								disabled={!canValidate || !current}
							/>{' '}
							{opt.label}
						</label>
					))}
				</div>
			))}
			<div aria-label="claim-evidence-options">
				<div style={{ fontWeight: 700 }}>어떤 공식 자료로 확인했나요? (등록된 공식 자료만 선택 가능)</div>
				{candidates.length ? (
					candidates.map(({ source, entry, id }) => (
						<label key={id} style={{ display: 'block', fontSize: 12 }}>
							<input
								type="checkbox"
								aria-label={`claim-evidence-${entry.entry_key}`}
								checked={picked.includes(id)}
								onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))}
								disabled={!canValidate || !current}
							/>{' '}
							{suggested.has(id) ? '[분석 제안] ' : ''}[{source.source_id} {source.version}] {entry.statement}
							{entry.condition ? ` · 적용 조건: ${entry.condition}` : ''}
							{entry.application_modes?.length ? ` · 사용 방식: ${entry.application_modes.map((m) => MODE_LABELS[m] || m).join('/')}` : ''}
						</label>
					))
				) : (
					<div role="status" style={{ fontSize: 12 }}>
						이 주장의 제품에 해당하는 등록된 공식 자료가 없습니다. "등록된 공식 근거 없음"으로 보류할 수 있습니다.
					</div>
				)}
			</div>
			{hasColor ? (
				<label style={{ fontSize: 12 }}>
					일치하는 공식 색상 표기{' '}
					<select aria-label="claim-official-color-label" value={colorLabel} onChange={(e) => setColorLabel(e.target.value)} disabled={!canValidate || !current}>
						<option value="">선택 안 함</option>
						{colorOptions.map((l) => (
							<option key={l} value={l}>
								{l}
							</option>
						))}
					</select>{' '}
					(선택한 공식 근거 문장에 있는 표기만 고를 수 있습니다. 글자가 비슷하다고 자동으로 같은 색으로 보지 않습니다.)
				</label>
			) : null}
			<div style={{ fontSize: 12 }} aria-label="claim-generator-locked">
				새 AI 답글 참고: 이번 단계에서는 사용 불가 (고정)
			</div>
			<textarea
				aria-label="claim-verified-scope"
				placeholder="확인한 사실 범위 (예: 레드 2시간 후 브라운 2시간 순차 사용 시 진한 흑갈색만 확인)"
				value={scope}
				onChange={(e) => setScope(e.target.value)}
				disabled={!canValidate || !current}
				rows={2}
			/>
			<textarea
				aria-label="claim-note"
				placeholder={`판단 근거 메모 (필수, ${NOTE_MIN_CHARS}자 이상)`}
				value={note}
				onChange={(e) => setNote(e.target.value)}
				disabled={!canValidate || !current}
				rows={2}
			/>
			<label style={{ fontSize: 12 }}>
				보류 사유{' '}
				<select aria-label="claim-hold-reason" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} disabled={!canValidate || !current}>
					{Object.entries(HOLD_REASON_LABELS).map(([value, text]) => (
						<option key={value} value={value}>
							{text}
						</option>
					))}
				</select>
			</label>
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<button type="button" className="btn-primary" aria-label="claim-verify" disabled={!canVerify} onClick={() => void submit('VERIFIED')}>
					이 주장만 공식 근거로 확인
				</button>
				<button type="button" className="btn-ghost" disabled={!canDecide} onClick={() => void submit('HOLD')}>
					보류
				</button>
				<button type="button" className="btn-ghost" disabled={!canDecide} onClick={() => void submit('REJECTED')}>
					공식 근거와 불일치
				</button>
				<button type="button" className="btn-ghost" disabled={!canDecide} onClick={() => void submit('OUTDATED')}>
					현재 무효
				</button>
			</div>
		</div>
	);
}

function ClaimItemView({
	claim,
	sources,
	canValidate,
	onSubmit,
}: {
	claim: ClaimView;
	sources: OfficialSource[];
	canValidate: boolean;
	onSubmit: ClaimSubmit;
}) {
	const [open, setOpen] = useState(false);
	const fv = claim.factValidation;
	const statementOf = (sid: string | null, key: string) =>
		sources.find((s) => s.source_id === sid)?.entries.find((e) => e.entry_key === key)?.statement || key;
	return (
		<li aria-label="claim-item" style={{ marginBottom: 8 }}>
			<div style={{ whiteSpace: 'pre-wrap' }}>
				<strong>{claim.analysis_label}</strong> {claim.quote}
			</div>
			<div style={{ fontSize: 12, display: 'grid', gap: 2 }}>
				<div>
					제품 {claim.products.join(', ') || '미확정'}
					{claim.method ? ` · 사용 방식 ${MODE_LABELS[claim.method] || claim.method}` : ''}
					{claim.condition && claim.condition !== 'UNKNOWN' ? ` · 조건 ${claim.condition}` : ''}
				</div>
				{claim.inherited_context ? (
					<div aria-label="claim-inherited-context">상위 항목의 순서 문맥 유지: {claim.inherited_context.order.join(' → ')}</div>
				) : null}
				{claim.target_color ? (
					<div aria-label="claim-target-color">
						목표 색상 "{claim.target_color}" · 공식 색상 표기 {claim.official_color_labels.join(', ') || '없음'} ·{' '}
						{label(COLOR_MATCH_LABELS, claim.target_color_match)}
					</div>
				) : null}
				<div aria-label="claim-analysis">
					자동 분석(사람 판단 아님): {label(ANALYSIS_CLASS_LABELS, claim.analysis_class)}
					{claim.analysis_note ? ` — ${claim.analysis_note}` : ''}
				</div>
				{claim.suggested_evidence.length ? (
					<div>분석이 제안한 공식 근거: {claim.suggested_evidence.map((e) => statementOf(e.source_id, e.entry_key)).join(' / ')}</div>
				) : (
					<div>분석이 찾은 공식 근거 없음 (미확인)</div>
				)}
				<div>원문 대조: {label(CLAIM_INTEGRITY_LABELS, claim.integrity)}</div>
				<div aria-label="claim-human-status">
					사람 검증: <strong>{label(FACT_STATUS_LABELS, fv.status)}</strong>
					{fv.resolution !== 'NO_RECORD' && fv.resolution !== 'APPLICABLE' ? ` (${label(FACT_REASON_LABELS, fv.resolution)})` : ''}
					{fv.latest?.official_color_label ? ` · 색상 표기 ${fv.latest.official_color_label}` : ''}
					{fv.latest?.hold_reason ? ` · 사유 ${label(HOLD_REASON_LABELS, fv.latest.hold_reason)}` : ''}
					{fv.latest ? ` · ${fv.latest.reviewer_role || '-'} ${formatKst(fv.latest.created_at)}` : ''}
					{fv.historyCount ? ` · 기록 ${fv.historyCount}건` : ''}
				</div>
				{fv.latest?.verified_scope ? <div>확인 범위: {fv.latest.verified_scope}</div> : null}
				<div>
					<button type="button" className="btn-ghost" aria-label="claim-form-toggle" onClick={() => setOpen((v) => !v)}>
						{open ? '주장 검증 닫기' : '이 주장 검증'}
					</button>
				</div>
				{open ? (
					<ClaimForm
						claim={claim}
						sources={sources}
						canValidate={canValidate}
						onSubmit={async (c, payload) => {
							const ok = await onSubmit(c, payload);
							if (ok) setOpen(false);
							return ok;
						}}
					/>
				) : null}
			</div>
		</li>
	);
}

export function ClaimValidationSection({
	knowledgeId,
	apiBaseUrl,
	roleProtectedGet,
	roleProtectedPost,
	sources,
	canValidate,
	onSaved,
}: {
	knowledgeId: string;
	apiBaseUrl: string;
	roleProtectedGet: Props['roleProtectedGet'];
	roleProtectedPost: Props['roleProtectedPost'];
	sources: OfficialSource[];
	canValidate: boolean;
	onSaved?: () => Promise<void> | void;
}) {
	const [data, setData] = useState<ClaimsResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const load = useCallback(async () => {
		try {
			const res = await roleProtectedGet<ClaimsResponse>(`${apiBaseUrl}/reviews/reply-knowledge/items/${encodeURIComponent(knowledgeId)}/claims`);
			setData(res.data);
			setError(null);
		} catch (err) {
			setError(errorText(err));
		}
	}, [apiBaseUrl, knowledgeId, roleProtectedGet]);
	useEffect(() => {
		setData(null);
		setMessage(null);
		void load();
	}, [load]);
	const submit = useCallback<ClaimSubmit>(
		async (claim, payload) => {
			setMessage(null);
			try {
				const res = await roleProtectedPost<{ duplicate?: boolean }>(`${apiBaseUrl}/reviews/reply-knowledge/claim-fact-validations`, {
					knowledge_id: knowledgeId,
					claim_key: claim.claim_key,
					...payload,
				});
				await load();
				await onSaved?.();
				setMessage(
					res.data?.duplicate
						? '이미 저장된 같은 요청입니다. 중복 기록은 만들지 않았습니다.'
						: `주장 검증 저장: ${claim.analysis_label} ${label(FACT_STATUS_LABELS, String(payload.fact_status))} (상위 항목·다른 주장·답글 승인은 변경되지 않음)`,
				);
				return true;
			} catch (err) {
				setMessage(errorText(err));
				if (err && (err as any).response?.status === 409) await load();
				return false;
			}
		},
		[apiBaseUrl, knowledgeId, load, onSaved, roleProtectedPost],
	);
	if (error) return <div className="review-analysis-inline-error">{error}</div>;
	if (!data) return null;
	if (data.available === false) {
		return (
			<div className="review-analysis-inline-error" role="status" aria-label="claim-decomposition-unavailable">
				{ERROR_LABELS.CLAIM_DECOMPOSITION_UNAVAILABLE} 이 상태에서는 항목 전체의 "공식 근거로 확인"도 서버에서 차단됩니다.
			</div>
		);
	}
	if (!Array.isArray(data.parents) || !data.parents.length) return null;
	const history = data.claim_history || [];
	return (
		<div aria-label="claim-validation-section" style={{ border: '1px solid rgba(148,163,184,0.35)', borderRadius: 6, padding: 8, display: 'grid', gap: 8 }}>
			<div className="card-title">개별 주장 검증 (복합 항목 분리 {data.version})</div>
			<div style={{ fontSize: 12, opacity: 0.85 }}>
				주장은 한 건씩만 판단합니다(일괄 확인 없음). 모든 주장이 확인되기 전에는 상위 항목 전체를 "공식 근거로 확인"할 수 없고, 모든 주장이 확인되어도 상위 항목은
				자동으로 확인되지 않습니다. 주장 검증 결과는 이번 단계에서 새 AI 답글에 사용하지 않습니다.
			</div>
			{data.parents.map((p) => (
				<div key={p.parent_unit_key} aria-label="claim-parent">
					<div style={{ fontWeight: 700 }} aria-label="claim-parent-progress">
						주장 {pad4(p.verified_claim_count)}/{pad4(p.claim_count)} 확인 · 상위 항목 전체 확인 {p.unit_verified_blocked ? '차단' : '사람 판단 가능'}
						{p.parent_current ? '' : ' · 상위 항목이 현재 추출과 다름'}
					</div>
					<ul>
						{p.claims.map((c) => (
							<ClaimItemView key={c.claim_key} claim={c} sources={sources} canValidate={canValidate} onSubmit={submit} />
						))}
					</ul>
				</div>
			))}
			{message ? (
				<div role="status" aria-label="claim-message">
					{message}
				</div>
			) : null}
			{history.length ? (
				<details aria-label="claim-history">
					<summary style={{ cursor: 'pointer', fontSize: 12 }}>주장 검증 이력 {history.length}건 (추가 기록만, 수정·삭제 없음)</summary>
					<ol style={{ fontSize: 12 }}>
						{history.map((r) => (
							<li key={r.claim_validation_id}>
								{formatKst(r.created_at)} · {label(FACT_STATUS_LABELS, r.fact_status)}
								{r.official_color_label ? ` · 색상 표기 ${r.official_color_label}` : ''}
								{r.hold_reason ? ` · 사유 ${label(HOLD_REASON_LABELS, r.hold_reason)}` : ''} · {r.reviewer_role || '-'} · {r.claim_text}
							</li>
						))}
					</ol>
				</details>
			) : null}
		</div>
	);
}

function ExtractionComparisonView({ item }: { item: KnowledgeQueueItem }) {
	const change = item.extraction_change;
	if (!change) return null;
	const previous = item.previous_extraction || [];
	const basis = change.comparedWith === 'VALIDATION_SNAPSHOT' ? '승인·보류 당시 저장된 추출 사본' : '기존 문장 분리 추출';
	return (
		<div aria-label="knowledge-extraction-comparison" style={{ border: '1px solid rgba(148,163,184,0.35)', borderRadius: 6, padding: 8 }}>
			<div className="card-title">추출 변경 비교 ({basis} → 개선 추출)</div>
			<div style={{ fontSize: 12 }}>
				변경 분류: {change.changes.map((c) => label(CHANGE_LABELS, c)).join(', ')} · 의미 변경 {change.meaningChanged ? '있음' : '없음'} ·{' '}
				{change.oldVersion} → {change.newVersion}
			</div>
			{item.revalidation_required ? (
				<div className="review-analysis-inline-error" role="status" aria-label="knowledge-revalidation-required">
					재검증 필요: 승인 당시 추출과 의미가 달라졌습니다. 기존 승인 기록은 그대로 유지되며 취소되지 않습니다.
				</div>
			) : null}
			{change.changes.length && change.changes[0] !== 'NO_CHANGE' ? (
				<details>
					<summary style={{ cursor: 'pointer', fontSize: 12 }}>이전 추출 보기 ({previous.length}개)</summary>
					<ol style={{ fontSize: 12 }}>
						{previous.map((one, idx) => (
							<li key={idx}>{one.originalText ?? one.sentence}</li>
						))}
					</ol>
				</details>
			) : null}
		</div>
	);
}

const CONTENT_LABELS: Record<string, string> = {
	PENDING: '검증 대기',
	APPROVED: '내용 승인',
	HOLD: '보류',
	EXCLUDED: '제외',
	OUTDATED: '현재 무효(구버전)',
};

const AUTHORSHIP_LABELS: Record<string, string> = {
	HUMAN_CONFIRMED: '사람 작성 확정',
	LIKELY_HUMAN: '사람 작성 추정',
	AI_CONFIRMED: 'AI 작성 확정',
	AI_HUMAN_EDITED: 'AI 초안 사람 수정',
	LIKELY_AI: 'AI 작성 추정',
	UNKNOWN: '작성 주체 미상',
	INVALID: '무효(오염)',
};

const QUESTIONS: { key: 'reply_appropriate' | 'guidance_accurate' | 'currently_valid' | 'reference_worthy'; label: string }[] = [
	{ key: 'reply_appropriate', label: '이 리뷰에 적절하게 답했나요?' },
	{ key: 'guidance_accurate', label: '전문 안내 내용이 정확한가요?' },
	{ key: 'currently_valid', label: '현재 제품에도 유효한 정보인가요?' },
	{ key: 'reference_worthy', label: '새 답글 작성 시 참고할 가치가 있나요?' },
];

const TRI_STATE = [
	{ value: 'yes', label: '예' },
	{ value: 'no', label: '아니오' },
	{ value: 'unsure', label: '모름' },
];

const NOTE_MIN_CHARS = 5;
const QUEUE_PAGE_SIZE = 50;
const MODE_LABELS: Record<string, string> = { single: '단독', sequential: '순차', mixed: '혼합' };

const pad4 = (n: number) => String(Math.max(0, n)).padStart(4, '0');

/** Display-only conversion of a stored timestamp to Asia/Seoul; stored values stay unchanged. */
export function formatKst(value?: string | null): string {
	if (!value) return '-';
	if (!value.includes('T')) return value;
	const d = new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
	if (Number.isNaN(d.getTime())) return value;
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Asia/Seoul',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		})
			.formatToParts(d)
			.map((p) => [p.type, p.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
}

const ERROR_LABELS: Record<string, string> = {
	knowledge_validation_write_not_enabled: '운영 DB 검증 기록 반영이 아직 활성화되지 않았습니다(별도 승인 대상).',
	forbidden: 'Knowledge 검증 권한이 없습니다(ops_admin 이상).',
	unauthorized: '로그인이 필요합니다.',
	validation_note_required: `판단 근거 메모를 ${NOTE_MIN_CHARS}자 이상 입력해야 합니다.`,
	approval_requires_all_answers: '승인하려면 4개 검증 문항에 모두 답해야 합니다.',
	approval_requires_all_yes: '4개 검증 문항이 모두 "예"일 때만 승인할 수 있습니다.',
	knowledge_item_not_eligible_for_human_reference_validation: '이 답글은 사람 지식 검증 대상이 아닙니다.',
	FACT_VALIDATION_SOURCE_MISSING: '등록된 공식 근거가 없거나 부족합니다(조건·순서·수치 포함). 보류로 기록하세요.',
	PRODUCT_SCOPE_UNKNOWN: '적용 제품이 불명확해 사실 확인할 수 없습니다.',
	numeric_exceeds_official_scope: '안내의 수치가 공식 자료 범위를 넘습니다. 사실 확인할 수 없습니다.',
	evidence_product_mismatch: '선택한 공식 자료가 이 항목의 제품과 맞지 않습니다.',
	evidence_source_cannot_verify: '이 자료는 사실 확인 근거로 쓸 수 없습니다(카테고리 리서치 등).',
	restriction_entry_cannot_verify: '일반화 금지 안내는 사실 확인 근거가 될 수 없습니다.',
	free_text_evidence_not_accepted: 'URL·인용문 직접 입력은 근거로 인정하지 않습니다.',
	unit_key_not_current: '항목이 변경되었습니다. 새로고침 후 다시 검증하세요.',
	verified_requires_all_applicable_yes: '해당 문항이 모두 "예"일 때만 사실 확인할 수 있습니다.',
	verified_scope_required: `확인한 사실 범위를 ${NOTE_MIN_CHARS}자 이상 입력해야 합니다.`,
	CURRENT_APPLICABILITY_UNVERIFIED: '이 공식 자료는 해당 제품에 대한 현재 적용성이 승인되지 않았습니다. 사실 확인 근거로 쓸 수 없습니다.',
	SOURCE_FIDELITY_NOT_PASSED: '원문 충실성 검증을 통과하지 못한 자료입니다.',
	OFFICIAL_CONDITION_NOT_PRESENT_IN_UNIT: '공식 자료의 적용 조건(예: 염색이 잘되지 않는 경우)이 안내 문장에 없습니다. 조건 없는 조정 시간은 확인할 수 없습니다.',
	APPLICATION_MODE_MISMATCH: '사용 방식(단독·순차·혼합)이 공식 자료와 다릅니다.',
	APPLICATION_MODE_UNSPECIFIED: '레드·브라운의 사용 방식(단독·순차·혼합)이 불명확해 사실 확인할 수 없습니다.',
	SEQUENCE_ORDER_MISMATCH: '사용 순서가 공식 자료와 다릅니다.',
	MULTI_METHOD_UNIT_REQUIRES_SPLIT: '비율과 순차 사용(또는 서로 다른 비율)이 한 문장에 섞여 있습니다. 문장 전체를 사실 확인할 수 없습니다.',
	UNOFFICIAL_SEQUENCE_INTERVAL: '"당일·다음날" 같은 사용 간격은 공식 자료에 없습니다. 사실 확인할 수 없습니다.',
	UNOFFICIAL_COLOR_OUTCOME: '"브라운 단독=미색" 같은 색상 결과 표현은 공식 자료에 없습니다. 사실 확인할 수 없습니다.',
	PRODUCT_VARIANT_MISMATCH: '안내가 말하는 제품 종류(예: 딥클린 헤어팩)와 선택한 공식 자료의 제품이 다릅니다. 사실 확인할 수 없습니다.',
	PRODUCT_VARIANT_UNRESOLVED: '안내가 어느 제품 종류를 말하는지 확정되지 않았습니다. 사람이 제품을 확인한 뒤 판단해야 합니다.',
	EVIDENCE_FACT_TYPE_CANNOT_SUPPORT_CLAIM: '선택한 공식 자료는 이런 종류의 주장(예: 딥클린 범위·효능)을 뒷받침하지 않습니다.',
	UNSUPPORTED_EFFICACY_CLAIM: '효능·효과 주장은 공식 자료에 근거가 없어 사실 확인할 수 없습니다.',
	UNIT_HAS_UNVERIFIED_CLAIMS: '이 항목은 여러 주장으로 나뉩니다. 모든 주장이 공식 근거로 확인되기 전에는 항목 전체를 확인할 수 없습니다(보류·불일치 기록은 가능).',
	CLAIM_DECOMPOSITION_UNAVAILABLE: '주장 분리 자료를 불러오지 못했습니다. 안전을 위해 사실 확인이 차단됩니다. 관리자에게 알려 주세요.',
	CLAIM_STALE_VIEW: '다른 관리자가 이 주장을 먼저 기록했습니다. 새로고침한 뒤 다시 판단하세요.',
	CLAIM_REQUEST_ID_REUSED: '이미 다른 내용으로 처리된 요청입니다. 새로고침 후 다시 시도하세요.',
	CLAIM_NOT_CURRENT: '답글 원문 또는 주장 문장·위치가 바뀌어 이 주장은 검증할 수 없습니다.',
	CLAIM_ANALYSIS_NOT_VERIFIABLE:
		'공식 근거가 주장 전체를 뒷받침하는 검토 후보만 "공식 근거로 확인"할 수 있습니다. 일부만 대응·근거 부족·충돌 주장은 보류·불일치만 기록할 수 있습니다.',
	CLAIM_GENERATOR_USE_NOT_ENABLED: '이번 단계에서는 주장 검증 결과를 새 AI 답글에 사용할 수 없습니다.',
	TARGET_COLOR_LABEL_REQUIRED: '목표 색상이 있는 주장은 일치하는 공식 색상 표기를 직접 선택해야 합니다.',
	TARGET_COLOR_NOT_IN_SELECTED_EVIDENCE: '선택한 색상 표기가 선택한 공식 근거 문장에 없습니다.',
	TARGET_COLOR_LABEL_CONFLICT: '주장에 적힌 공식 색상과 다른 색상 표기를 선택했습니다. 다른 색으로 확장할 수 없습니다.',
	claim_not_found: '주장을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.',
	reviewer_fields_not_accepted: '검증자 정보는 로그인 정보로만 기록됩니다(직접 입력 불가).',
	request_id_required: '요청 식별값이 없습니다. 새로고침 후 다시 시도하세요.',
	GATE_B_STALE_VIEW: '다른 관리자가 먼저 기록했습니다. 목록을 새로고침한 뒤 다시 판단하세요.',
	GATE_B_REQUEST_ID_REUSED: '이미 처리된 요청입니다. 새로고침 후 다시 시도하세요.',
	GATE_B_SCOPE_EXPANSION: '공식 항목의 제품·조건·수치·사용 방식 범위를 넘는 승인은 할 수 없습니다.',
	GATE_B_SKU_NOT_IN_SCOPE: '선택한 SKU가 선택한 제품에 속하지 않습니다.',
	GATE_B_NOTHING_TO_REVOKE: '현재 승인 상태가 아닌 제품은 철회할 수 없습니다.',
	GATE_B_PRODUCT_SCOPE_REQUIRED: '적용 제품이 지정되지 않은 항목은 승인할 수 없습니다(보류·제외만 가능).',
	gate_b_approval_requires_admin_confirmation: '승인하려면 "예, 현재도 선택한 제품에 적용합니다"를 직접 선택해야 합니다.',
	gate_b_confirmation_decision_mismatch: '현재 적용 여부 확인과 결정(승인·보류·제외·철회)이 맞지 않습니다.',
	invalid_current_applicability_confirmation: '현재 적용 여부 확인 값이 올바르지 않습니다. 새로고침 후 다시 시도하세요.',
	GATE_B_SERVER_AUTHORED_FIELD: '근거·적용 범위·제한 기록은 서버가 자동 작성합니다(직접 입력 불가).',
	admin_exceptions_only_for_approval: '관리자 추가 확인 예외는 승인할 때만 기록합니다. 보류·제외 사유는 판단 메모에 적어 주세요.',
	admin_exceptions_too_long: '관리자 추가 확인 예외는 1000자 이내로 입력해 주세요.',
	restriction_entry_not_gate_b_reviewable: '일반화 금지 안내는 Gate B 대상이 아닙니다.',
	GATE_B_DUPLICATE_APPROVAL: '이미 승인된 제품을 같은 범위로 다시 승인하려면 재검증 사유(10자 이상)가 필요합니다.',
	reverification_reason_without_approved_product: '선택한 제품 중 이미 승인된 제품이 없어 재검증 사유를 기록할 수 없습니다. 새로고침 후 다시 판단하세요.',
	reverification_reason_only_for_approval: '재검증 사유는 승인 결정에서만 기록합니다. 보류·제외·철회 사유는 판단 메모에 적어 주세요.',
};

function errorText(err: any): string {
	const raw = err?.response?.data?.detail;
	const detail = raw && typeof raw === 'object' && typeof raw.code === 'string' ? raw.code : raw;
	const status = err?.response?.status;
	const key = typeof detail === 'string' && ERROR_LABELS[detail] ? detail : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : null;
	const text = (key && ERROR_LABELS[key]) || String(detail || err?.message || '요청에 실패했습니다.');
	if (key === 'UNIT_HAS_UNVERIFIED_CLAIMS' && typeof raw?.detail?.claim_count === 'number') {
		return `${text} (주장 ${raw.detail.verified_claim_count}/${raw.detail.claim_count}개 확인)`;
	}
	const approved = key === 'GATE_B_DUPLICATE_APPROVAL' && Array.isArray(raw?.detail?.products) ? raw.detail.products : [];
	return approved.length
		? `${text} (이미 승인: ${approved.map((x: { product: string; approved_at?: string | null }) => `${x.product} ${formatKst(x.approved_at)}`).join(', ')})`
		: text;
}

type GateBProductState = {
	state: string;
	origin: string | null;
	record_id?: string;
	decision?: string;
	reviewer_email?: string | null;
	reviewer_role?: string | null;
	created_at?: string | null;
	review_id?: string;
	pinned_hash_changed?: boolean;
};

type GateBRecord = {
	applicability_id: string;
	decision: string;
	products: string[];
	skus: string[];
	approved_fact_scope?: string | null;
	limitations_exceptions?: string | null;
	basis_type?: string | null;
	basis_reference?: string | null;
	basis_summary?: string | null;
	note: string;
	reviewer_email?: string | null;
	reviewer_role?: string | null;
	created_at?: string | null;
	source_version?: string | null;
	entry_content_sha256?: string;
};

export type GateBItem = {
	source_id: string;
	source_version: string;
	entry_key: string;
	kind: string;
	original_text: string;
	source_location?: { quotes?: { text: string; offset?: number; recordLine?: number }[] } | null;
	products: string[];
	product_skus: Record<string, string[]>;
	application_modes?: string[] | null;
	condition?: string | null;
	numeric_tokens?: string[] | null;
	limitation?: string[];
	gate_a_status?: string | null;
	current_applicability: { status: string; products: string[]; review_id: string | null; origin: string | null };
	entry_state: string;
	by_product: Record<string, GateBProductState>;
	latest_record_id: string | null;
	legacy: { origin: string; review_id: string; products: string[]; confirmed_by?: string | null; confirmed_at?: string | null; basis_record?: string | null } | null;
	priority: string | null;
	topic: string | null;
	history: GateBRecord[];
	audit_template?: GateBAuditTemplate | null;
};

export type GateBAuditTemplate = {
	basis_type: string;
	basis_type_label: string;
	gate_a_reference: string;
	scope_text: string;
	source_limitation_text: string;
	current_guidance_note: string | null;
};

type GateBResponse = {
	summary: { total: number; queue_total: number; by_priority: Record<string, number>; by_entry_state: Record<string, number>; usable_entries: number };
	items: GateBItem[];
	questions: Record<string, string>;
	basis_types: Record<string, string>;
	confirmations?: Record<string, string>;
	decision_confirmations?: Record<string, string[]>;
};

const GATE_B_STATE_LABELS: Record<string, string> = {
	PENDING: '미확인 (근거 사용 불가)',
	APPROVED: '승인 (로그인 관리자)',
	APPROVED_LEGACY: '과거 운영자 확인 (LEGACY)',
	PARTIALLY_APPROVED: '일부 제품만 승인',
	HOLD: '보류',
	EXCLUDED: '제외 (비적용 근거 있음)',
	REVOKED: '승인 철회',
	RECHECK_REQUIRED: '재확인 필요 (원문 변경)',
};
const GATE_B_PRODUCT_STATE_LABELS: Record<string, string> = {
	APPROVED: '승인됨',
	PENDING: '미확인',
	HOLD: '보류',
	EXCLUDED: '제외',
	REVOKED: '승인 철회',
	RECHECK_REQUIRED: '재확인 필요',
	APPROVED_LEGACY: '과거 운영자 확인',
};
const GATE_B_REVERIFICATION_MIN = 10;

type GateTone = { color: string; background: string; border: string };
const GATE_B_APPROVED_TONES: Record<string, GateTone> = {
	APPROVED: { color: '#166534', background: '#dcfce7', border: '#16a34a' },
	APPROVED_LEGACY: { color: '#115e59', background: '#ccfbf1', border: '#0d9488' },
	PARTIALLY_APPROVED: { color: '#3f6212', background: '#ecfccb', border: '#65a30d' },
};
const GATE_A_PASS_TONE: GateTone = { color: '#1e40af', background: '#dbeafe', border: '#2563eb' };

function GateBadge({ text, tone, ariaLabel }: { text: string; tone?: GateTone | null; ariaLabel?: string }) {
	if (!tone) return <span aria-label={ariaLabel}>{text}</span>;
	return (
		<span
			aria-label={ariaLabel}
			data-approved="true"
			style={{
				color: tone.color,
				background: tone.background,
				border: `1px solid ${tone.border}`,
				borderRadius: 999,
				padding: '0 7px',
				fontWeight: 700,
				whiteSpace: 'nowrap',
			}}
		>
			{text}
		</span>
	);
}

const GATE_B_QN_SOURCE = 'sujata_usage_guide_html';
const GATE_B_QN: Record<string, string> = {
	'html:duration:pack': 'Q1',
	'html:packmix:single': 'Q2',
	'html:packmix:two': 'Q3',
	'html:packmix:three_plus': 'Q4',
	'html:ratio:red_brown': 'Q5',
	'html:ratio:natural_brown': 'Q6',
	'html:ratio:orange': 'Q7',
	'html:sequence:dark_brown': 'Q8',
	'html:faq:gray_or_dark_brown_sequence': 'Q9',
	'html:caution:gray-high': 'Q10',
	'html:caution:gray-test-time': 'Q11',
	'html:step:04': 'Q12',
	'html:step:05': 'Q13',
	'html:faq:first-use': 'Q14',
};
export const gateBQn = (x: { source_id: string; entry_key: string }) => (x.source_id === GATE_B_QN_SOURCE ? GATE_B_QN[x.entry_key] || '' : '');
const qnPrefix = (x: { source_id: string; entry_key: string }) => {
	const qn = gateBQn(x);
	return qn ? `${qn} ` : '';
};

const gateATone = (status?: string | null) => (status === 'PASS' ? GATE_A_PASS_TONE : null);
const gateAText = (status?: string | null) => (status === 'PASS' ? 'Gate A 통과' : `Gate A ${status || '-'}`);
const GATE_B_DECISION_LABELS: Record<string, string> = { APPROVED: '승인', HOLD: '보류', EXCLUDED: '제외', REVOKED: '승인 철회' };
const GATE_B_USABLE = ['APPROVED', 'APPROVED_LEGACY'];
const GATE_B_ENTRY_LEVEL = '_entry';
const GATE_B_QUESTION_FALLBACK: Record<string, string> = {
	product_applicable: '현재 해당 제품에 적용 가능한가',
	usage_accurate: '현재 사용법·조건·수치·순서가 정확한가',
	exceptions_checked: '제품별 제한·예외를 확인했는가',
	scope_clear: '적용 범위(제품·사용 방식·조건)가 명확한가',
	company_standard_confirmed: '회사가 현재 인정하는 사용 기준이라는 근거가 있는가',
};
const GATE_B_FILTERS: { value: string; label: string }[] = [
	{ value: 'ALL', label: '전체 (P1 우선)' },
	{ value: 'P1', label: 'P1' },
	{ value: 'P2', label: 'P2' },
	{ value: 'P3', label: 'P3' },
	{ value: 'OTHER', label: '우선순위 외 (기존 확인 항목)' },
];

const GATE_B_CONFIRMATION_FALLBACK: Record<string, string> = {
	CONFIRMED_CURRENT_STANDARD: '예, 현재도 선택한 제품에 적용합니다',
	NEEDS_CHECK: '추가 확인이 필요합니다',
	NOT_APPLICABLE: '현재는 선택한 제품에 적용하지 않습니다',
};
const GATE_B_DECISION_CONFIRMATION_FALLBACK: Record<string, string[]> = {
	APPROVED: ['CONFIRMED_CURRENT_STANDARD'],
	HOLD: ['NEEDS_CHECK', 'NOT_APPLICABLE'],
	EXCLUDED: ['NOT_APPLICABLE'],
	REVOKED: ['NEEDS_CHECK', 'NOT_APPLICABLE'],
};

const newRequestId = () => `gbr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export type GateBAuditPreview = {
	basis_type: string;
	basis_reference: string;
	basis_summary: string;
	approved_fact_scope: string | null;
	limitations_exceptions: string | null;
};

/** Mirror of gate_b_audit_record (api/review_reply_knowledge_unit_facts.py); the server writes the stored record. */
export function composeGateBAuditPreview(
	template: GateBAuditTemplate,
	{
		decision,
		products,
		confirmation,
		adminExceptions,
		confirmationLabels = GATE_B_CONFIRMATION_FALLBACK,
	}: { decision: string; products: string[]; confirmation: string | null; adminExceptions: string; confirmationLabels?: Record<string, string> },
): GateBAuditPreview {
	const productLabel = products.map((p) => (p === GATE_B_ENTRY_LEVEL ? '항목 단위' : p)).join(', ');
	let summary =
		`Gate B 관리자 직접 확인 · 결정: ${GATE_B_DECISION_LABELS[decision]} · 선택 제품: ${productLabel}` +
		` · 확인: ${(confirmation && confirmationLabels[confirmation]) || '해당 없음(승인 철회)'}`;
	if (template.current_guidance_note) summary += ` · 참고(항목 승인 근거 아님): ${template.current_guidance_note}`;
	const approved = decision === 'APPROVED';
	const extra = adminExceptions.trim();
	return {
		basis_type: template.basis_type,
		basis_reference: template.gate_a_reference,
		basis_summary: summary,
		approved_fact_scope: approved ? `제품: ${productLabel} · ${template.scope_text}` : null,
		limitations_exceptions: approved ? `공식 원문 기재 제한: ${template.source_limitation_text} / 관리자 추가 확인 예외: ${extra || '입력 없음'}` : null,
	};
}

function GateBForm({
	item,
	questions,
	confirmations,
	decisionConfirmations,
	canValidate,
	onSubmit,
}: {
	item: GateBItem;
	questions: Record<string, string>;
	confirmations: Record<string, string>;
	decisionConfirmations: Record<string, string[]>;
	canValidate: boolean;
	onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
	const entryLevel = item.products.length === 0;
	const [products, setProducts] = useState<string[]>([]);
	const [skus, setSkus] = useState<string[]>([]);
	const [confirmation, setConfirmation] = useState<string | null>(null);
	const [decision, setDecision] = useState<string | null>(null);
	const [adminExceptions, setAdminExceptions] = useState('');
	const [note, setNote] = useState('');
	const [reason, setReason] = useState('');
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const productsReady = entryLevel || products.length > 0;
	const allUsable = !entryLevel && products.length > 0 && products.every((p) => GATE_B_USABLE.includes(item.by_product[p]?.state ?? ''));
	const decisionAllowed = (d: string) => {
		if (!canValidate || !productsReady) return false;
		if ((d === 'APPROVED' || d === 'REVOKED') && entryLevel) return false;
		if (d === 'REVOKED' && !allUsable) return false;
		const allowed = decisionConfirmations[d] || [];
		return confirmation ? allowed.includes(confirmation) : d === 'REVOKED';
	};
	const activeDecision = decision && decisionAllowed(decision) ? decision : null;
	const noteRequired = activeDecision !== null && activeDecision !== 'APPROVED';
	const noteReady = !noteRequired || note.trim().length >= NOTE_MIN_CHARS;
	const skuOptions = products.flatMap((p) => item.product_skus?.[p] || []).filter((v, i, a) => a.indexOf(v) === i);
	const selectedProducts = entryLevel ? [GATE_B_ENTRY_LEVEL] : item.products.filter((p) => products.includes(p)).sort();
	const preview =
		activeDecision && item.audit_template
			? composeGateBAuditPreview(item.audit_template, {
					decision: activeDecision,
					products: selectedProducts,
					confirmation,
					adminExceptions: activeDecision === 'APPROVED' ? adminExceptions : '',
					confirmationLabels: confirmations,
				})
			: null;
	const reverifyProducts = activeDecision === 'APPROVED' ? selectedProducts.filter((p) => item.by_product[p]?.state === 'APPROVED') : [];
	const firstProducts = activeDecision === 'APPROVED' ? selectedProducts.filter((p) => !reverifyProducts.includes(p)) : [];
	const reasonReady = reverifyProducts.length === 0 || reason.trim().length >= GATE_B_REVERIFICATION_MIN;
	const storedNote = reverifyProducts.length
		? `[재검증: ${reverifyProducts.join(', ')}] 사유: ${reason.trim()}` + (note.trim() ? ` / 판단 메모: ${note.trim()}` : '')
		: note.trim();
	const canSave = Boolean(preview) && noteReady && reasonReady && !busy;

	const submit = async () => {
		if (busyRef.current || !activeDecision || !preview) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const payload: Record<string, unknown> = {
				request_id: newRequestId(),
				source_id: item.source_id,
				entry_key: item.entry_key,
				decision: activeDecision,
				products: entryLevel ? [] : selectedProducts,
				skus: skus.filter((s) => skuOptions.includes(s)),
				expected_latest_record_id: item.latest_record_id,
				note: note.trim(),
			};
			if (confirmation) payload.current_applicability_confirmation = confirmation;
			if (activeDecision === 'APPROVED' && adminExceptions.trim()) payload.admin_confirmed_exceptions = adminExceptions.trim();
			if (reverifyProducts.length) payload.reverification_reason = reason.trim();
			await onSubmit(payload);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};

	return (
		<div aria-label="gate-b-form" style={{ border: '1px dashed rgba(148,163,184,0.5)', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
			<div className="card-title">새 판단 기록 — 변경할 제품 선택</div>
			<div
				aria-label="gate-b-current-item"
				style={{ border: '2px solid rgba(59,130,246,0.7)', background: 'rgba(59,130,246,0.08)', borderRadius: 6, padding: 8, fontSize: 13 }}
			>
				<div style={{ fontWeight: 700 }}>
					지금 판단하는 항목: {qnPrefix(item)}[{item.priority || '-'}] {item.entry_key}
				</div>
				<div>
					원문: {item.original_text.length > 90 ? `${item.original_text.slice(0, 90)}…` : item.original_text}
				</div>
			</div>
			<div style={{ fontSize: 12, opacity: 0.85 }}>
				아래 체크박스는 이번에 새로 기록할 제품을 고르는 칸입니다. 이미 저장된 상태는 위 &quot;현재 제품별 승인 상태&quot; 표에 표시되며, 체크가 비어 있어도 저장된 승인은
				유지됩니다.
			</div>
			<div style={{ fontWeight: 700 }}>판단 단위: 이 공식 항목 × 선택한 제품 × 항목에 적힌 조건 (다른 제품·조건·수치로 확장되지 않음)</div>
			<div style={{ fontSize: 12, opacity: 0.85 }}>① 공식 원문과 적용 조건은 위에 자동 표시됩니다. 근거 위치·요약·적용 범위는 서버가 자동 기록합니다.</div>
			<div style={{ fontWeight: 600, fontSize: 13 }}>② 이번 판단에 포함할 제품 선택 (승인된 제품도 철회·보류·재검증을 위해 선택 가능)</div>
			{entryLevel ? (
				<div role="status" style={{ fontSize: 12 }}>
					이 항목은 현재 제품 범위가 지정되지 않았습니다. 승인할 수 없고 보류·제외만 기록할 수 있습니다. (제품정보 DB에 없다는 이유만으로 단종·사용 불가로 판단하지 않습니다.)
				</div>
			) : (
				<div aria-label="gate-b-products" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
					{item.products.map((p) => (
						<label
							key={p}
							style={{
								padding: '2px 6px',
								borderRadius: 4,
								border: products.includes(p) ? '2px solid rgba(59,130,246,0.8)' : '1px solid rgba(148,163,184,0.4)',
								background: products.includes(p) ? 'rgba(59,130,246,0.12)' : undefined,
							}}
						>
							<input
								type="checkbox"
								aria-label={`gate-b-product-${p}`}
								checked={products.includes(p)}
								onChange={(e) => setProducts((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)))}
								disabled={!canValidate}
							/>{' '}
							{p}{' '}
							<span style={{ fontSize: 11 }}>
								(현재:{' '}
								<GateBadge
									text={label(GATE_B_PRODUCT_STATE_LABELS, item.by_product[p]?.state)}
									tone={GATE_B_APPROVED_TONES[item.by_product[p]?.state ?? '']}
								/>
								)
							</span>
						</label>
					))}
				</div>
			)}
			{skuOptions.length > 0 && (
				<div aria-label="gate-b-skus" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
					<span>SKU (선택)</span>
					{skuOptions.map((s) => (
						<label key={s}>
							<input
								type="checkbox"
								aria-label={`gate-b-sku-${s}`}
								checked={skus.includes(s)}
								onChange={(e) => setSkus((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))}
								disabled={!canValidate}
							/>{' '}
							{s}
						</label>
					))}
				</div>
			)}
			<div style={{ fontWeight: 600, fontSize: 13 }}>③ 현재 회사 사용 기준과 일치합니까?</div>
			<div aria-label="gate-b-confirmation-scope" style={{ fontSize: 12, opacity: 0.85 }}>
				선택한 제품에 대해 아래 내용을 한 번에 확인하는 관리자 판단입니다.
				<ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
					{Object.entries(questions).map(([k, text]) => (
						<li key={k}>{text}</li>
					))}
				</ul>
			</div>
			<div aria-label="gate-b-confirmation" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
				{Object.entries(confirmations).map(([value, text]) => (
					<label key={value}>
						<input
							type="radio"
							name={`gate-b-confirmation-${item.source_id}-${item.entry_key}`}
							aria-label={`gate-b-confirmation-${value}`}
							checked={confirmation === value}
							onChange={() => setConfirmation(value)}
							disabled={!canValidate}
						/>{' '}
						{text}
					</label>
				))}
			</div>
			<div style={{ fontWeight: 600, fontSize: 13 }}>④ 결정</div>
			<div aria-label="gate-b-decision" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				{['APPROVED', 'HOLD', 'EXCLUDED', 'REVOKED'].map((d) => (
					<button
						key={d}
						type="button"
						aria-label={`gate-b-decision-${d}`}
						aria-pressed={activeDecision === d}
						className={activeDecision === d ? 'btn-primary' : 'btn-ghost'}
						disabled={!decisionAllowed(d) || busy}
						onClick={() => setDecision(d)}
					>
						{GATE_B_DECISION_LABELS[d]}
					</button>
				))}
			</div>
			{reverifyProducts.length ? (
				<div
					role="alert"
					aria-label="gate-b-duplicate-warning"
					style={{ fontSize: 12, border: '1px solid rgba(234,179,8,0.8)', background: 'rgba(234,179,8,0.1)', borderRadius: 6, padding: 8, display: 'grid', gap: 4 }}
				>
					<div style={{ fontWeight: 700 }}>이미 승인된 제품이 포함되어 있습니다. 같은 범위의 재승인은 재검증 사유가 있어야 저장됩니다.</div>
					{reverifyProducts.map((p) => (
						<div key={p}>
							{p}: 이미 승인됨 ({formatKst(item.by_product[p]?.created_at)})
						</div>
					))}
					<div aria-label="gate-b-reverification-scope">
						재검증 사유 적용 제품: {reverifyProducts.join(', ')}
						{firstProducts.length ? ` · 처음 승인되는 제품(사유 불필요): ${firstProducts.join(', ')}` : ''}
					</div>
					<textarea
						aria-label="gate-b-reverification-reason"
						placeholder={`재검증 사유 (필수, ${GATE_B_REVERIFICATION_MIN}자 이상). 판단 메모·감사 이력에만 기록되며 공식 원문과 자동 근거 요약은 바뀌지 않습니다.`}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						disabled={!canValidate}
						rows={2}
					/>
				</div>
			) : null}
			{activeDecision === 'APPROVED' ? (
				<textarea
					aria-label="gate-b-admin-exceptions"
					placeholder="관리자가 추가로 확인한 제한·예외 (선택). 공식 원문 제한과 구분되어 기록됩니다."
					value={adminExceptions}
					onChange={(e) => setAdminExceptions(e.target.value)}
					disabled={!canValidate}
					rows={2}
				/>
			) : null}
			<textarea
				aria-label="gate-b-note"
				placeholder={noteRequired ? `판단 사유 (필수, ${NOTE_MIN_CHARS}자 이상)` : '판단 메모 (승인 시 선택)'}
				value={note}
				onChange={(e) => setNote(e.target.value)}
				disabled={!canValidate}
				rows={2}
			/>
			{activeDecision && !item.audit_template ? (
				<div role="status" style={{ fontSize: 12 }}>
					자동 기록 미리보기를 불러오지 못해 저장할 수 없습니다. 새로고침 후 다시 시도하세요.
				</div>
			) : null}
			{preview ? (
				<div aria-label="gate-b-preview" style={{ fontSize: 12, background: 'rgba(148,163,184,0.12)', borderRadius: 6, padding: 8, display: 'grid', gap: 4 }}>
					<div style={{ fontWeight: 600, fontSize: 13 }}>⑤ 저장될 기록 미리보기 (서버 자동 작성)</div>
					<div aria-label="gate-b-preview-gate-a">
						<strong>Gate A 공식 근거</strong>: {preview.basis_reference}
					</div>
					<div aria-label="gate-b-preview-gate-b">
						<strong>Gate B 현재 적용성 근거</strong> ({item.audit_template?.basis_type_label}): {preview.basis_summary}
					</div>
					{preview.approved_fact_scope ? (
						<div aria-label="gate-b-preview-scope">
							<strong>적용 범위</strong>: {preview.approved_fact_scope}
						</div>
					) : null}
					{preview.limitations_exceptions ? (
						<div aria-label="gate-b-preview-limitations">
							<strong>제한·예외</strong>: {preview.limitations_exceptions}
						</div>
					) : null}
					{storedNote ? (
						<div aria-label="gate-b-preview-note">
							<strong>판단 메모</strong>: {storedNote}
						</div>
					) : null}
					<div>
						<strong>검증 이력</strong>: 저장 시 로그인한 관리자 계정과 서버 시각이 자동 기록됩니다.
					</div>
				</div>
			) : null}
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<button type="button" className="btn-primary" aria-label="gate-b-save" disabled={!canSave} onClick={() => void submit()}>
					⑥ {activeDecision ? `${GATE_B_DECISION_LABELS[activeDecision]} 기록 저장` : '결정을 선택하세요'}
				</button>
			</div>
			<div style={{ fontSize: 12, opacity: 0.8 }}>
				승인: 제품 선택 + "예, 현재도 적용" 직접 선택(메모 선택). 보류: "추가 확인 필요" 또는 "현재 적용 안 함" + 사유. 제외: "현재 적용 안 함" + 사유. 철회: 현재 승인 상태인
				제품만 + 사유. 공식 원문 확인(Gate A)만으로는 승인되지 않습니다. 기록은 추가만 되며 수정·삭제되지 않습니다.
			</div>
		</div>
	);
}

function GateBReviewSection({
	apiBaseUrl,
	roleProtectedGet,
	roleProtectedPost,
	canValidate,
}: Props & { canValidate: boolean }) {
	const [data, setData] = useState<GateBResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState('ALL');
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await roleProtectedGet<GateBResponse>(`${apiBaseUrl}/reviews/reply-knowledge/source-applicability`);
			setData(Array.isArray(res.data?.items) ? res.data : null);
			setError(null);
		} catch (err) {
			setError(errorText(err));
		}
	}, [apiBaseUrl, roleProtectedGet]);

	useEffect(() => {
		void load();
	}, [load]);

	const items = (data?.items || []).filter((x) => (filter === 'ALL' ? true : filter === 'OTHER' ? !x.priority : x.priority === filter));
	const itemId = (x: GateBItem) => `${x.source_id}::${x.entry_key}`;
	const selected = (data?.items || []).find((x) => itemId(x) === selectedKey) || null;
	const questions = data?.questions && Object.keys(data.questions).length ? data.questions : GATE_B_QUESTION_FALLBACK;

	const submit = useCallback(
		async (payload: Record<string, unknown>) => {
			setMessage(null);
			try {
				await roleProtectedPost(`${apiBaseUrl}/reviews/reply-knowledge/source-applicability`, payload);
				await load();
				setMessage(`Gate B 기록 저장: ${label(GATE_B_DECISION_LABELS, String(payload.decision))} (선택한 제품에만 적용, 이전 기록은 보존)`);
				return true;
			} catch (err) {
				setMessage(errorText(err));
				return false;
			}
		},
		[apiBaseUrl, roleProtectedPost, load],
	);

	return (
		<section className="card" aria-label="gate-b-section">
			<div className="card-title">공식 사용가이드 현재 적용성 확인 (Gate B)</div>
			<div className="card-caption">
				답글 내용 검증·개별 사실 검증과 별개입니다. 공식 원문 충실성(Gate A) 통과 항목이 현재 제품에 적용되는지 관리자가 제품별로 확인합니다. 사용 가능한 근거는 Gate A 통과 + Gate B
				승인(또는 과거 운영자 확인 범위)뿐이며, 미확인 항목은 원문에 있어도 근거로 쓰지 않습니다.
			</div>
			{data ? (
				<div aria-label="gate-b-summary" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
					<strong>
						확인 대기 우선순위 P1 {pad4(data.summary.by_priority.P1 || 0)} · P2 {pad4(data.summary.by_priority.P2 || 0)} · P3{' '}
						{pad4(data.summary.by_priority.P3 || 0)} (전체 {pad4(data.summary.queue_total)})
					</strong>
					<span>
						근거 사용 가능 항목 {pad4(data.summary.usable_entries)}/{pad4(data.summary.total)}
					</span>
					{Object.entries(data.summary.by_entry_state).map(([k, v]) => (
						<GateBadge key={k} text={`${label(GATE_B_STATE_LABELS, k)} ${v}`} tone={GATE_B_APPROVED_TONES[k]} />
					))}
				</div>
			) : null}
			{error ? <div className="review-analysis-inline-error">{error}</div> : null}
			{message ? (
				<div role="status" aria-label="gate-b-message" style={{ fontSize: 12 }}>
					{message}
				</div>
			) : null}
			{data && !canValidate ? (
				<div role="status" aria-label="gate-b-readonly" style={{ fontSize: 12 }}>
					조회 전용: Gate B 기록은 ops_admin 이상 로그인 관리자만 저장할 수 있습니다.
				</div>
			) : null}
			{data ? (
				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: 12, marginTop: 8 }}>
					<div>
						<label>
							우선순위{' '}
							<select aria-label="gate-b-priority-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
								{GATE_B_FILTERS.map((f) => (
									<option key={f.value} value={f.value}>
										{f.label}
									</option>
								))}
							</select>
						</label>
						<div aria-label="gate-b-list" style={{ maxHeight: 520, overflowY: 'auto', marginTop: 6 }}>
							{items.map((x) => {
								const tone = GATE_B_APPROVED_TONES[x.entry_state];
								return (
									<button
										key={itemId(x)}
										type="button"
										className="btn-ghost"
										data-approved={tone ? 'true' : undefined}
										style={{
											display: 'block',
											width: '100%',
											textAlign: 'left',
											marginBottom: 4,
											fontWeight: itemId(x) === selectedKey ? 700 : 400,
											...(tone ? { color: tone.color, background: tone.background, borderLeft: `5px solid ${tone.border}` } : {}),
										}}
										onClick={() => {
											setSelectedKey(itemId(x));
											setMessage(null);
										}}
									>
										{gateBQn(x) ? (
											<>
												<b aria-label="gate-b-list-qn">{gateBQn(x)}</b>{' '}
											</>
										) : null}
										[{x.priority || '-'}] {x.entry_key} · <GateBadge text={gateAText(x.gate_a_status)} tone={gateATone(x.gate_a_status)} /> ·{' '}
										<GateBadge ariaLabel="gate-b-list-state" text={label(GATE_B_STATE_LABELS, x.entry_state)} tone={tone} />
									</button>
								);
							})}
							{items.length === 0 ? <div style={{ fontSize: 12 }}>해당 항목이 없습니다.</div> : null}
						</div>
					</div>
					<div>
						{selected ? (
							<div aria-label="gate-b-detail" style={{ display: 'grid', gap: 8 }}>
								<div>
									<div className="card-title">공식 원문</div>
									<div>{selected.original_text}</div>
									<div style={{ fontSize: 12, opacity: 0.8 }}>
										{qnPrefix(selected)}[{selected.source_id} {selected.source_version}] {selected.entry_key} · 종류 {selected.kind} · 주제 {selected.topic || '-'}
									</div>
								</div>
								<div style={{ fontSize: 12 }} aria-label="gate-b-scope">
									<div>적용 조건: {selected.condition || '없음'}</div>
									<div>사용 방식: {selected.application_modes?.length ? selected.application_modes.map((m) => MODE_LABELS[m] || m).join('/') : '-'}</div>
									<div>수치: {selected.numeric_tokens?.length ? selected.numeric_tokens.join(', ') : '-'}</div>
									<div>제한: {selected.limitation?.length ? selected.limitation.join(' / ') : '-'}</div>
									<div>
										Gate A (원문 충실성):{' '}
										<GateBadge ariaLabel="gate-b-detail-gate-a" text={selected.gate_a_status || '-'} tone={gateATone(selected.gate_a_status)} />
									</div>
									<div>
										Gate B:{' '}
										<GateBadge
											ariaLabel="gate-b-detail-state"
											text={label(GATE_B_STATE_LABELS, selected.entry_state)}
											tone={GATE_B_APPROVED_TONES[selected.entry_state]}
										/>{' '}
										· 근거 사용 가능 제품{' '}
										{selected.current_applicability.products.length ? selected.current_applicability.products.join(', ') : '없음'}
									</div>
								</div>
								<div aria-label="gate-b-by-product" style={{ fontSize: 12 }}>
									<div className="card-title">현재 제품별 승인 상태 (저장된 기록 기준, 서버 계산)</div>
									<table aria-label="gate-b-current-state" style={{ borderCollapse: 'collapse', width: '100%' }}>
										<thead>
											<tr style={{ textAlign: 'left' }}>
												<th>제품</th>
												<th>현재 상태</th>
												<th>마지막 판단 (KST)</th>
												<th>기록 출처</th>
											</tr>
										</thead>
										<tbody>
											{Object.entries(selected.by_product).map(([p, v]) => (
												<tr
													key={p}
													aria-label={`gate-b-state-row-${p}`}
													data-approved={GATE_B_APPROVED_TONES[v.state] ? 'true' : undefined}
													style={GATE_B_APPROVED_TONES[v.state] ? { background: GATE_B_APPROVED_TONES[v.state]!.background } : undefined}
												>
													<td>{p === GATE_B_ENTRY_LEVEL ? '(제품 미지정)' : p}</td>
													<td>
														<GateBadge text={label(GATE_B_PRODUCT_STATE_LABELS, v.state)} tone={GATE_B_APPROVED_TONES[v.state]} />
													</td>
													<td>{v.created_at ? formatKst(v.created_at) : '-'}</td>
													<td>
														{v.origin === 'LEGACY_OPERATOR_ATTESTATION'
															? `과거 운영자 확인${v.review_id ? ` (${v.review_id})` : ''}`
															: v.record_id
																? `로그인 관리자 ${label(GATE_B_DECISION_LABELS, v.decision || '')}${v.reviewer_email ? ` · ${v.reviewer_email} (${v.reviewer_role || '-'})` : ''}`
																: '기록 없음'}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
								{selected.legacy ? (
									<div aria-label="gate-b-legacy" style={{ fontSize: 12 }}>
										과거 운영자 확인 기록 ({selected.legacy.origin}, {selected.legacy.review_id}) · 범위 {selected.legacy.products.join(', ')} · 확인{' '}
										{selected.legacy.confirmed_by || '-'} {selected.legacy.confirmed_at || ''}. 로그인 검증 기록이 아니며, 이 범위 밖으로 확장되지 않습니다.
									</div>
								) : null}
								<div aria-label="gate-b-history" style={{ fontSize: 12 }}>
									<div className="card-title">Gate B 기록 이력 (추가 기록만, 삭제·수정 없음)</div>
									{selected.history.length ? (
										selected.history
											.slice()
											.reverse()
											.map((h) => (
												<div key={h.applicability_id} style={{ marginBottom: 4 }}>
													{formatKst(h.created_at)} · {label(GATE_B_DECISION_LABELS, h.decision)} · {h.products.join(', ')} · {h.reviewer_email || '-'} ({h.reviewer_role || '-'})
													{h.basis_type ? ` · 근거 ${label(data.basis_types || {}, h.basis_type)}: ${h.basis_reference || '-'}` : ''} · {h.note}
												</div>
											))
									) : (
										<div>로그인 관리자 기록 없음</div>
									)}
								</div>
								<GateBForm
									key={`${itemId(selected)}::${selected.latest_record_id || 'ROOT'}`}
									item={selected}
									questions={questions}
									confirmations={data.confirmations && Object.keys(data.confirmations).length ? data.confirmations : GATE_B_CONFIRMATION_FALLBACK}
									decisionConfirmations={data.decision_confirmations || GATE_B_DECISION_CONFIRMATION_FALLBACK}
									canValidate={canValidate}
									onSubmit={submit}
								/>
							</div>
						) : (
							<div style={{ fontSize: 12 }}>왼쪽 목록에서 공식 항목을 선택하세요.</div>
						)}
					</div>
				</div>
			) : null}
		</section>
	);
}

export function ReviewKnowledgeValidationPanel({ apiBaseUrl, roleProtectedGet, roleProtectedPost }: Props): JSX.Element {
	const [summary, setSummary] = useState<KnowledgeSummary | null>(null);
	const [queueFilter, setQueueFilter] = useState<string>('all_candidates');
	const [contentFilter, setContentFilter] = useState<string>('PENDING');
	const [productGroup, setProductGroup] = useState<string>('');
	const [offset, setOffset] = useState<number>(0);
	const [queue, setQueue] = useState<QueueResponse | null>(null);
	const [progress, setProgress] = useState<{ total: number; pending: number } | null>(null);
	const [loading, setLoading] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<KnowledgeQueueItem | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [note, setNote] = useState<string>('');
	const [saving, setSaving] = useState<boolean>(false);
	const submittingRef = useRef(false);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [queryText, setQueryText] = useState<string>('');
	const [queryProduct, setQueryProduct] = useState<string>('');
	const [retrieval, setRetrieval] = useState<RetrievalResponse | null>(null);
	const [retrievalError, setRetrievalError] = useState<string | null>(null);

	const [permission, setPermission] = useState<ValidatorPermission | null>(null);
	const [officialSources, setOfficialSources] = useState<OfficialSource[]>([]);
	const [unitFactMessage, setUnitFactMessage] = useState<string | null>(null);

	const writeEnabled = Boolean(summary?.validation_write_enabled);
	const canValidate = writeEnabled && Boolean(permission?.can_validate);
	const noteReady = note.trim().length >= NOTE_MIN_CHARS;
	const allYes = QUESTIONS.every((q) => answers[q.key] === 'yes');
	const canApprove = canValidate && noteReady && allYes;
	const canDecideOther = canValidate && noteReady;

	useEffect(() => {
		let cancelled = false;
		roleProtectedGet<ValidatorPermission>(`${apiBaseUrl}/reviews/reply-knowledge/permission`)
			.then((res) => {
				if (!cancelled) setPermission(res.data);
			})
			.catch(() => {
				if (!cancelled) setPermission({ authenticated: false, can_validate: false, role: null, required_role: 'ops_admin' });
			});
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, roleProtectedGet]);

	useEffect(() => {
		let cancelled = false;
		roleProtectedGet<OfficialSourcesResponse>(`${apiBaseUrl}/reviews/reply-knowledge/official-sources`)
			.then((res) => {
				if (!cancelled) setOfficialSources(res.data?.sources || []);
			})
			.catch(() => {
				if (!cancelled) setOfficialSources([]);
			});
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, roleProtectedGet]);

	const loadSummary = useCallback(async () => {
		try {
			const queueUrl = `${apiBaseUrl}/reviews/reply-knowledge/queue`;
			const [res, all, pending] = await Promise.all([
				roleProtectedGet<KnowledgeSummary>(`${apiBaseUrl}/reviews/reply-knowledge/summary`),
				roleProtectedGet<QueueResponse>(queueUrl, { params: { queue_filter: 'all_candidates', limit: 1 } }),
				roleProtectedGet<QueueResponse>(queueUrl, { params: { queue_filter: 'all_candidates', content_validation: 'PENDING', limit: 1 } }),
			]);
			setSummary(res.data);
			setProgress({ total: Number(all.data?.total ?? 0), pending: Number(pending.data?.total ?? 0) });
		} catch (err) {
			setError(errorText(err));
		}
	}, [apiBaseUrl, roleProtectedGet]);

	useEffect(() => {
		setOffset(0);
	}, [queueFilter, contentFilter, productGroup]);

	const loadQueue = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await roleProtectedGet<QueueResponse>(`${apiBaseUrl}/reviews/reply-knowledge/queue`, {
				params: {
					queue_filter: queueFilter,
					content_validation: contentFilter || undefined,
					product_group: productGroup || undefined,
					limit: QUEUE_PAGE_SIZE,
					offset,
				},
			});
			const total = Number(res.data?.total ?? 0);
			if (offset > 0 && offset >= total) {
				setOffset(Math.max(0, Math.floor((total - 1) / QUEUE_PAGE_SIZE) * QUEUE_PAGE_SIZE));
				return;
			}
			setQueue(res.data);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setLoading(false);
		}
	}, [apiBaseUrl, roleProtectedGet, queueFilter, contentFilter, productGroup, offset]);

	useEffect(() => {
		void loadSummary();
	}, [loadSummary]);

	useEffect(() => {
		void loadQueue();
	}, [loadQueue]);

	const fetchItem = useCallback(
		async (knowledgeId: string) => {
			try {
				const res = await roleProtectedGet<KnowledgeQueueItem>(
					`${apiBaseUrl}/reviews/reply-knowledge/items/${encodeURIComponent(knowledgeId)}`,
				);
				setSelected(res.data);
			} catch (err) {
				setError(errorText(err));
			}
		},
		[apiBaseUrl, roleProtectedGet],
	);

	const openItem = useCallback(
		async (knowledgeId: string) => {
			setSaveMessage(null);
			setUnitFactMessage(null);
			setAnswers({});
			setNote('');
			await fetchItem(knowledgeId);
		},
		[fetchItem],
	);

	const submitValidation = useCallback(
		async (contentValidation: string) => {
			if (!selected || submittingRef.current) return;
			submittingRef.current = true;
			setSaving(true);
			setSaveMessage(null);
			try {
				await roleProtectedPost(`${apiBaseUrl}/reviews/reply-knowledge/validations`, {
					knowledge_id: selected.knowledge_id,
					content_validation: contentValidation,
					...answers,
					note: note || undefined,
				});
				await fetchItem(selected.knowledge_id);
				await loadQueue();
				await loadSummary();
				setSaveMessage(`검증 기록 저장: ${CONTENT_LABELS[contentValidation] || contentValidation} (작성 주체 분류는 변경되지 않음)`);
			} catch (err) {
				setSaveMessage(errorText(err));
			} finally {
				submittingRef.current = false;
				setSaving(false);
			}
		},
		[apiBaseUrl, answers, note, selected, roleProtectedPost, fetchItem, loadQueue, loadSummary],
	);

	const submitUnitFact = useCallback<UnitFactSubmit>(
		async (unit, payload) => {
			if (!selected || !unit.factValidation) return false;
			setUnitFactMessage(null);
			try {
				await roleProtectedPost(`${apiBaseUrl}/reviews/reply-knowledge/unit-fact-validations`, {
					knowledge_id: selected.knowledge_id,
					unit_key: unit.factValidation.unitKey,
					...payload,
				});
				await fetchItem(selected.knowledge_id);
				await loadSummary();
				setUnitFactMessage(
					`개별 사실 검증 저장: ${label(FACT_STATUS_LABELS, String(payload.fact_status))} (같은 답글의 다른 항목·답글 승인·작성 주체는 변경되지 않음)`,
				);
				return true;
			} catch (err) {
				setUnitFactMessage(errorText(err));
				return false;
			}
		},
		[apiBaseUrl, selected, roleProtectedPost, fetchItem, loadSummary],
	);

	const runRetrieval = useCallback(async () => {
		setRetrievalError(null);
		try {
			const res = await roleProtectedPost<RetrievalResponse>(`${apiBaseUrl}/reviews/reply-knowledge/retrieve`, {
				review_text: queryText,
				product_title: queryProduct,
				top_k: 5,
			});
			setRetrieval(res.data);
		} catch (err) {
			setRetrievalError(errorText(err));
		}
	}, [apiBaseUrl, queryText, queryProduct, roleProtectedPost]);

	return (
		<div className="review-knowledge-panel" style={{ display: 'grid', gap: 12 }}>
			<section className="card">
				<div className="card-title">과거 답글 Knowledge 검증</div>
				<div className="card-caption">
					과거 리뷰와 답글을 읽고 내용의 정확성과 현재 유효성을 판단합니다. 내용 승인은 작성 주체(사람/AI) 분류를 바꾸지 않으며, 원본 답글은 수정되지 않습니다.
				</div>
				{summary ? (
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }} aria-label="knowledge-summary">
						<span>유효 답글 {summary.valid}건 / 무효 {summary.invalid}건</span>
						<span>LIKELY_HUMAN {summary.authorship.LIKELY_HUMAN || 0}건</span>
						<span>UNKNOWN 전문 안내 {summary.unknown_with_knowhow}건</span>
						<span>AI 출처 {summary.tiers.AI_ORIGIN_REFERENCE || 0}건(사람 지식 승격 불가)</span>
						<span>
							내용 승인 {summary.content_validation_of_human_reference_tiers.APPROVED || 0}건 · 보류{' '}
							{summary.content_validation_of_human_reference_tiers.HOLD || 0}건 · 제외{' '}
							{summary.content_validation_of_human_reference_tiers.EXCLUDED || 0}건
						</span>
						<span aria-label="knowledge-revalidation-count">재검증 필요 {summary.revalidation_required ?? 0}건</span>
						<span>추출 버전 {summary.extraction_version || '-'}</span>
						<span>검색 상태 {summary.retrieval_status}</span>
					</div>
				) : null}
				{summary && !writeEnabled ? (
					<div className="review-analysis-inline-error" role="status">
						운영 DB 검증 기록 반영은 별도 승인 후 활성화됩니다. 현재는 조회만 가능합니다.
					</div>
				) : null}
				{summary && writeEnabled && permission && !permission.can_validate ? (
					<div className="review-analysis-inline-error" role="status" aria-label="knowledge-permission-readonly">
						조회 전용: Knowledge 승인·보류·제외는 ops_admin 이상만 할 수 있습니다.
					</div>
				) : null}
				{error ? <div className="review-analysis-inline-error">{error}</div> : null}
			</section>

			<ReviewKnowledgePolicySection
				apiBaseUrl={apiBaseUrl}
				roleProtectedGet={roleProtectedGet}
				roleProtectedPost={roleProtectedPost}
				canValidate={canValidate}
			/>

			<section className="card">
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
					<label>
						대상{' '}
						<select aria-label="knowledge-queue-filter" value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)}>
							{Object.entries(QUEUE_FILTER_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<label>
						검증 상태{' '}
						<select aria-label="knowledge-content-filter" value={contentFilter} onChange={(e) => setContentFilter(e.target.value)}>
							<option value="">전체</option>
							{Object.entries(CONTENT_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<label>
						상품군{' '}
						<select aria-label="knowledge-product-filter" value={productGroup} onChange={(e) => setProductGroup(e.target.value)}>
							<option value="">전체</option>
							{['HENNA', 'HAIR_PACK', 'JOJOBA', 'SHAMPOO', 'UNMAPPED'].map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
					<span>{loading ? '불러오는 중...' : `검증 대기열 ${queue?.total ?? 0}건 (우선순위순)`}</span>
					{progress ? (
						<strong aria-label="knowledge-validation-progress">
							검증현황 {pad4(progress.total - progress.pending)}/{pad4(progress.total)} (남은 {progress.pending}건)
						</strong>
					) : null}
					{summary?.use_authority_counts ? (
						<span aria-label="knowledge-use-authority-counts" style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
							<span>과거 응대 참고 가능 {summary.reply_reference_eligible ?? 0}건</span>
							<span>개별 전문 사실 검증 완료 {summary.generator_fact_eligible ?? 0}건</span>
							<span>재검증 필요 {summary.use_authority_counts.REVALIDATION_REQUIRED ?? 0}건</span>
						</span>
					) : null}
					{summary?.unit_fact_status_counts ? (
						<span aria-label="unit-fact-counts" style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
							<span>개별 전문 안내 {summary.unit_fact_scope_units ?? 0}개</span>
							<span>공식 근거로 확인 {summary.unit_fact_status_counts.VERIFIED ?? 0}개</span>
							<span>보류 {summary.unit_fact_status_counts.HOLD ?? 0}개</span>
							<span>불일치 {summary.unit_fact_status_counts.REJECTED ?? 0}개</span>
							<span>사실 검증 대기 {summary.unit_fact_status_counts.PENDING ?? 0}개</span>
							<span>생성기 사실 사용 가능 {summary.unit_generator_fact_eligible ?? 0}개</span>
						</span>
					) : null}
				</div>
				{summary?.use_authority_counts ? (
					<div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }} aria-label="knowledge-use-authority-help">
						과거 응대 참고 가능 = 최신 검증이 승인이고 원문이 같으며 재검증이 필요 없는 답글입니다. 응대 방식·맥락만 참고하며, 답글 안의 사용
						시간·배합 비율·제품 설명은 개별 전문 사실 검증을 마친 경우에만 제품 사실로 사용합니다. 작성 주체 분류와는 별개입니다.
					</div>
				) : null}
				{queue && queue.total > QUEUE_PAGE_SIZE ? (
					<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }} aria-label="knowledge-queue-pager">
						<button type="button" className="btn-ghost" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - QUEUE_PAGE_SIZE))}>
							이전 50건
						</button>
						<span>
							{offset + 1}–{Math.min(offset + QUEUE_PAGE_SIZE, queue.total)} / {queue.total}건
						</span>
						<button
							type="button"
							className="btn-ghost"
							disabled={loading || offset + QUEUE_PAGE_SIZE >= queue.total}
							onClick={() => setOffset(offset + QUEUE_PAGE_SIZE)}
						>
							다음 50건
						</button>
					</div>
				) : null}
				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 2fr)', gap: 12, marginTop: 10 }}>
					<div style={{ maxHeight: 640, overflowY: 'auto' }} aria-label="knowledge-queue-list">
						{(queue?.items || []).map((item) => (
							<button
								key={item.knowledge_id}
								type="button"
								className={`btn-ghost${selected?.knowledge_id === item.knowledge_id ? ' submenu-tab-active' : ''}`}
								style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(148,163,184,0.2)' }}
								onClick={() => void openItem(item.knowledge_id)}
							>
								<div style={{ fontWeight: 700 }}>
									{(item.analysis_labels || []).map((one) => (
										<AnalysisLabelBadge key={one} label={one} />
									))}
									[{item.product_group}] 우선순위 {item.queue_priority ?? '-'} · {CONTENT_LABELS[item.content_validation] || item.content_validation}
									{item.revalidation_required ? ' · 재검증 필요' : ''}
								</div>
								<div style={{ fontSize: 12, opacity: 0.8 }}>
									{AUTHORSHIP_LABELS[item.authorship] || item.authorship} · 별점 {item.rating ?? '-'} · 답글일 {item.remote_reply_date || '-'}
								</div>
								<div style={{ fontSize: 12 }}>{item.review_text.slice(0, 80)}</div>
							</button>
						))}
					</div>
					<div aria-label="knowledge-detail">
						{selected ? (
							<div style={{ display: 'grid', gap: 10 }}>
								<div>
									<div className="card-title">과거 고객 리뷰</div>
									<div style={{ fontSize: 12, opacity: 0.8 }}>
										{selected.product_title || '-'} · 별점 {selected.rating ?? '-'} · 작성일 {selected.review_written_at || '-'}
									</div>
									<div style={{ whiteSpace: 'pre-wrap' }}>{selected.review_text}</div>
								</div>
								<div>
									<div className="card-title">과거 답글 (원문, 수정 불가)</div>
									<div style={{ fontSize: 12, opacity: 0.8 }}>답글일 {selected.remote_reply_date || '-'}</div>
									<div style={{ whiteSpace: 'pre-wrap' }}>{selected.reply_text}</div>
								</div>
								<div>
									<div className="card-title">제품별 전문 안내 항목 (개선 추출 {selected.extraction_version || '-'})</div>
									<div style={{ fontSize: 12, opacity: 0.8 }}>
										답글 단위 승인은 항목별 사실 확인이 아닙니다. 과거 답글의 숫자·사용법은 현재 공식 사용법으로 확정하지 않습니다. 항목별 사실
										검증은 등록된 공식 자료로만 하며, 한 항목의 결과는 같은 답글의 다른 항목에 적용되지 않습니다.
									</div>
									{selected.knowhow_items.length ? (
										<ul>
											{selected.knowhow_items.map((one) => (
												<KnowhowUnitView
													key={`${selected.knowledge_id}:${one.factValidation?.unitKey || one.sourceTextSpan?.join('-') || one.sentence}`}
													unit={one}
													sources={officialSources}
													canValidate={canValidate}
													onSubmitFact={submitUnitFact}
												/>
											))}
										</ul>
									) : (
										<div>추출된 전문 안내가 없습니다.</div>
									)}
									{unitFactMessage ? (
										<div role="status" aria-label="unit-fact-message">
											{unitFactMessage}
										</div>
									) : null}
									<ClaimValidationSection
										knowledgeId={selected.knowledge_id}
										apiBaseUrl={apiBaseUrl}
										roleProtectedGet={roleProtectedGet}
										roleProtectedPost={roleProtectedPost}
										sources={officialSources}
										canValidate={canValidate}
										onSaved={loadSummary}
									/>
								</div>
								<ExtractionComparisonView item={selected} />
								{selected.current_use_authority ? (
									<div aria-label="knowledge-use-authority" style={{ fontSize: 12 }}>
										<div className="card-title">AI 사용 권한 (검증 이력에서 계산)</div>
										<div>
											{label(USE_AUTHORITY_LABELS, selected.current_use_authority)} · 응대 참고 {selected.reply_reference_eligible ? '가능' : '불가'} · 제품
											사실 사용 {selected.generator_fact_eligible ? '가능' : '불가'}
										</div>
										{selected.fact_ineligible_reasons && selected.fact_ineligible_reasons.length ? (
											<div>사실 사용 불가 사유: {selected.fact_ineligible_reasons.map((r) => label(FACT_REASON_LABELS, r)).join(', ')}</div>
										) : null}
									</div>
								) : null}
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
									<div aria-label="knowledge-authorship">
										<div className="card-title">작성 주체 (AUTHORSHIP)</div>
										<div>{AUTHORSHIP_LABELS[selected.authorship] || selected.authorship}</div>
										<div style={{ fontSize: 12, opacity: 0.8 }}>근거 {selected.authorship_evidence}</div>
										<div style={{ fontSize: 12, opacity: 0.8 }}>내용 검증 결과로 변경되지 않습니다.</div>
									</div>
									<div aria-label="knowledge-content-validation">
										<div className="card-title">내용 검증 (CONTENT_VALIDATION)</div>
										<div>{CONTENT_LABELS[selected.content_validation] || selected.content_validation}</div>
										{selected.policy_violations.length ? (
											<div style={{ fontSize: 12 }}>정책 경고: {selected.policy_violations.join(', ')}</div>
										) : null}
									</div>
								</div>
								<div style={{ display: 'grid', gap: 6 }}>
									{QUESTIONS.map((q) => (
										<div key={q.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
											<span style={{ minWidth: 260 }}>{q.label}</span>
											{TRI_STATE.map((opt) => (
												<label key={opt.value}>
													<input
														type="radio"
														name={q.key}
														value={opt.value}
														checked={answers[q.key] === opt.value}
														onChange={() => setAnswers((prev) => ({ ...prev, [q.key]: opt.value }))}
														disabled={!canValidate}
													/>{' '}
													{opt.label}
												</label>
											))}
										</div>
									))}
									<textarea
										aria-label="knowledge-validation-note"
										placeholder="판단 근거 메모 (필수: 현재 제품 정보·공식 사용 안내와 대조한 근거, 보류·제외 사유)"
										value={note}
										onChange={(e) => setNote(e.target.value)}
										disabled={!canValidate}
										rows={2}
									/>
									{canValidate ? (
										<div style={{ fontSize: 12, opacity: 0.8 }} aria-label="knowledge-validation-rule">
											승인: 4개 문항 모두 "예" + 판단 근거 메모 {NOTE_MIN_CHARS}자 이상 · 보류/제외/현재 무효: 사유 메모 {NOTE_MIN_CHARS}자 이상
										</div>
									) : null}
									<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
										<button type="button" className="btn-primary" disabled={!canApprove || saving} onClick={() => void submitValidation('APPROVED')}>
											승인
										</button>
										<button type="button" className="btn-ghost" disabled={!canDecideOther || saving} onClick={() => void submitValidation('HOLD')}>
											보류
										</button>
										<button type="button" className="btn-ghost" disabled={!canDecideOther || saving} onClick={() => void submitValidation('EXCLUDED')}>
											제외
										</button>
										<button type="button" className="btn-ghost" disabled={!canDecideOther || saving} onClick={() => void submitValidation('OUTDATED')}>
											현재 무효
										</button>
									</div>
									{saveMessage ? <div role="status">{saveMessage}</div> : null}
								</div>
								{selected.validation_history && selected.validation_history.length ? (
									<div>
										<div className="card-title">검증 이력</div>
										<ul>
											{selected.validation_history.map((h) => (
												<li key={h.validation_id}>
													{h.created_at || '-'} · {CONTENT_LABELS[h.content_validation] || h.content_validation} · 검증자{' '}
													{h.reviewer_email || h.reviewer || '미기록'}
													{h.reviewer_role ? `(${h.reviewer_role})` : ''} · 작성 주체(당시) {h.authorship_class_at_validation || '-'}{' '}
													{h.note ? `· 근거: ${h.note}` : ''}
												</li>
											))}
										</ul>
									</div>
								) : null}
								{selected.unit_fact_history && selected.unit_fact_history.length ? (
									<div aria-label="unit-fact-history">
										<div className="card-title">개별 사실 검증 이력 (추가 기록만, 삭제·수정 없음)</div>
										<ul>
											{selected.unit_fact_history.map((h) => (
												<li key={h.unit_fact_validation_id}>
													{h.created_at || '-'} · {label(FACT_STATUS_LABELS, h.fact_status)}
													{h.hold_reason ? ` (${label(HOLD_REASON_LABELS, h.hold_reason)})` : ''} · 검증자 {h.reviewer_email || '미기록'}
													{h.reviewer_role ? `(${h.reviewer_role})` : ''} · 항목 “{h.unit_text.slice(0, 40)}” · 추출 {h.extraction_version}
													{h.note ? ` · 근거: ${h.note}` : ''}
												</li>
											))}
										</ul>
									</div>
								) : null}
							</div>
						) : (
							<div>왼쪽 목록에서 검증할 답글을 선택하세요.</div>
						)}
					</div>
				</div>
			</section>

			<GateBReviewSection apiBaseUrl={apiBaseUrl} roleProtectedGet={roleProtectedGet} roleProtectedPost={roleProtectedPost} canValidate={canValidate} />

			<section className="card">
				<div className="card-title">유사 과거 응대 검색 시험</div>
				<div className="card-caption">
					LEXICAL_RETRIEVAL_BASELINE: 상품·주제·경험 신호·키워드 기반입니다. 의미 기반(임베딩) 검색이 아닙니다. AI 작성 답글은 참고 결과에서 제외됩니다.
				</div>
				<div style={{ display: 'grid', gap: 6 }}>
					<input aria-label="retrieval-product" placeholder="상품명" value={queryProduct} onChange={(e) => setQueryProduct(e.target.value)} />
					<textarea aria-label="retrieval-review-text" placeholder="새 리뷰 본문" value={queryText} onChange={(e) => setQueryText(e.target.value)} rows={3} />
					<div>
						<button type="button" className="btn-ghost" disabled={!queryText.trim()} onClick={() => void runRetrieval()}>
							검색
						</button>
					</div>
					{retrievalError ? <div className="review-analysis-inline-error">{retrievalError}</div> : null}
					{retrieval ? (
						<ol aria-label="retrieval-results">
							{retrieval.results.map((r) => (
								<li key={r.knowledge_id} style={{ marginBottom: 8 }}>
									<div style={{ fontSize: 12, opacity: 0.8 }}>
										점수 {r.score} · {r.product_group} · {AUTHORSHIP_LABELS[r.authorship] || r.authorship} · 검증 {CONTENT_LABELS[r.content_validation] || r.content_validation} · 안내 유효성{' '}
										{r.guidance_current_validity.join(', ')}
									</div>
									<div style={{ fontSize: 12 }}>검색 이유: {r.retrieval_reasons.join(', ')}</div>
									<div style={{ fontSize: 12 }} aria-label="retrieval-use-authority">
										사용 권한: {label(USE_AUTHORITY_LABELS, r.current_use_authority)} · 응대 참고 {r.reply_reference_eligible ? '가능' : '불가'} · 제품 사실 사용{' '}
										{r.generator_fact_eligible ? '가능' : '불가'}
										{r.use_warning ? ` · ${r.use_warning}` : ''}
									</div>
									<div>리뷰: {r.past_review_text}</div>
									<div>답글: {r.past_reply_text}</div>
								</li>
							))}
							{retrieval.results.length === 0 ? <li>조건을 충족하는 과거 응대가 없습니다.</li> : null}
						</ol>
					) : null}
				</div>
			</section>
		</div>
	);
}
