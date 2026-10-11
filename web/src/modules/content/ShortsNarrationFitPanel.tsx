import React from 'react';
import axios from 'axios';

type FitClaim = { claimId: string; claimType?: string; field: string; claimText: string; canonicalStatement?: string; evidenceRefs?: string[] };
type FitScene = {
	sceneId: string;
	order: number;
	stage?: string;
	marketingRole?: string | null;
	originalNarration: string;
	proposedNarration: string;
	originalChars: number;
	proposedChars: number;
	originalSpeechChars: number;
	proposedSpeechChars: number;
	originalEstimatedMs?: number | null;
	estimatedDurationMs?: number | null;
	currentSceneDurationSec: number;
	proposedSceneDurationSec: number;
	originalEstimatedStatus?: string;
	proposedEstimatedStatus?: string;
	claimIdsUsed: string[];
	claimIdsRemoved: string[];
	claimIdsNew: string[];
	removedClaims: FitClaim[];
	editorialPurpose?: string;
	originalSubtitle?: string;
	proposedSubtitle?: string | null;
	originalOnScreenText?: string;
	proposedOnScreenText?: string | null;
	claims: FitClaim[];
	issues: string[];
};
type FitProposal = {
	proposalId: string;
	proposalSha256: string;
	status: string;
	holdReasons: string[];
	warnings: string[];
	scenes: FitScene[];
	currentSceneAllocation: number[];
	proposedSceneAllocation: number[];
	totals: { videoTargetMs: number; originalEstimatedMs: number; proposedEstimatedMs: number; originalChars: number; proposedChars: number; originalSpeechChars: number; proposedSpeechChars: number };
	claimComparison: { preserved: number; removed: number; new: number };
	semanticValidation: { readiness?: string; claims: Array<{ order: number; claimId: string; field: string; groundingStatus: string; sourceAuthority?: string[] }> };
	marketingRoles: { original: string[]; proposal: string[]; lost: string[] };
	naturalLanguageQa?: { status: string; issueCount: number; previousIssueCount?: number; issues: Array<{ order: number; code: string; detail?: unknown }> };
	estimatedSceneOverflowCount?: number;
	revision?: { round: number; previousProposalId: string } | null;
	writer?: { model?: string; calls?: number };
	createdAt: string;
};
type RevisionInstructions = { general: string[]; forbidden: string[]; scenes: Array<{ order: number; verdict: string; issues: string[]; preserve: string[]; direction: string; exampleDirection: string }> };
type HumanDecision = { status: string; decidedAt?: string | null; actor?: string | null; note?: string; revisionInstructions?: RevisionInstructions | null };
type ProposalDigest = {
	proposalId: string;
	status: string;
	revision?: { round: number } | null;
	totals: FitProposal['totals'];
	proposedSceneAllocation: number[];
	claimComparison: { preserved: number; removed: number; new: number };
	naturalLanguageQa?: { issueCount: number; issues: Array<{ order: number; code: string }> };
	scenes: Array<{ order: number; proposedNarration: string; proposedChars: number; estimatedDurationMs?: number | null; proposedSceneDurationSec: number }>;
	humanDecision?: HumanDecision | null;
};
type FitState = {
	source: { readiness: string; blockers: string[]; estimatedTotalMs: number; allocation: number[] };
	fit: null | {
		videoTargetDurationSec: number;
		proposal: FitProposal;
		humanDecision: HumanDecision;
		applied?: { revisionArtifactId: string; appliedAt: string } | null;
		history?: ProposalDigest[];
	};
	lineage?: { parentArtifactId: string; fitProposalId: string } | null;
	canPropose: boolean;
	canDecide: boolean;
	applyBlockers: string[];
};

const REASON_LABEL: Record<string, string> = {
	NEW_CLAIM_INTRODUCED: '새 주장 추가',
	INVALID_REF: '잘못된 근거 참조',
	UNSUPPORTED: '근거 없는 문장',
	ATTRIBUTION_MISSING: '출처 표시 누락',
	REVIEW_GENERALIZATION_OVERREACH: '리뷰 다수 표현',
	EFFICACY_SENSITIVE_REVIEW_REQUIRED: '민감 효능 리뷰',
	MARKETING_ROLE_LOST: '마케팅 역할 누락',
	PRESERVED_CLAIM_ANCHOR_MISSING: '유지한 근거의 핵심어 누락',
	RESTRICTED_PATTERN_ADDED: '효능·보장 표현 추가',
	NARRATION_TEXT_NOT_COVERED_BY_CLAIMS: '근거 없는 문장 추가',
	NARRATION_EMPTY: '빈 대사',
	ESTIMATED_TIMING_NOT_IMPROVED: '예상 길이 개선 없음',
	ESTIMATED_TOTAL_OVERFLOW: '예상 합계가 영상 길이 초과',
	COMPLIANCE_GATE_FAILED: '표현 규정 위반',
	UNRESOLVED_CLAIM_PRESENT: '확인 필요 문장',
	FIELD_WITHOUT_CLAIMS: '근거 미연결 필드',
	SCENE_CLAIM_LEDGER_INCOMPLETE: '근거 장부 불완전',
	GENERATION_EVIDENCE_SNAPSHOT_MISSING: '생성 시점 근거 없음',
	WRITER_OUTPUT_SCENE_MISSING: '장면 누락',
	WRITER_OUTPUT_UNKNOWN_SCENE: '알 수 없는 장면',
	ESTIMATED_SCENE_OVERFLOW_AFTER_REALLOCATION: '일부 장면은 재배분 후에도 예상 초과',
	NARRATION_SENTENCE_INCOMPLETE: '문장이 끝나지 않음 (명사로 종료)',
	NARRATION_OPENER_REPEATED: '앞 장면과 같은 시작 표현',
	HUMAN_REVISION_PRESERVE_TERM_MISSING: '검수자가 유지 요청한 표현 누락',
	HUMAN_REVISION_INSTRUCTION_NOT_SATISFIED: '검수자 유지 지시 미준수',
};
const VERDICT_LABEL: Record<string, string> = { KEEP: '유지', MINOR_EDIT: '약간 수정', REWRITE_REQUIRED: '다시 쓰기' };
const ROLE_LABEL: Record<string, string> = { HOOK_INTENT: '후킹', CONSUMER_PROBLEM: '고객 고민', INFORMATIVE_VALUE: '전문 정보', PRODUCT_VALUE: '제품 가치', CUSTOMER_EXPERIENCE: '고객 경험', CTA: 'CTA' };
const DECISION_LABEL: Record<string, string> = { PENDING: '사람 검토 대기', APPROVED: '승인됨', REJECTED: '거절됨', REVISION_REQUIRED: '수정 필요' };
const BUTTON: React.CSSProperties = { border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: 10, padding: '6px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const PRIMARY: React.CSSProperties = { ...BUTTON, border: '1px solid #2563eb', background: '#2563eb', color: '#fff' };
const DISABLED: React.CSSProperties = { ...BUTTON, background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' };

function sec(ms?: number | null): string {
	return typeof ms === 'number' ? `${(ms / 1000).toFixed(2)}초` : '-';
}

function reasonLabel(reason: string): string {
	const [code, arg] = reason.split(':');
	if (code === 'SUPPORTING_TEXT_CHANGED') return `Scene ${arg} 자막/화면 문구 변경 제안`;
	return REASON_LABEL[code || reason] || reason;
}

function errorText(error: unknown): string {
	const detail = (error as any)?.response?.data?.detail;
	if (typeof detail === 'string') return detail;
	return String((error as any)?.message || '요청에 실패했습니다.');
}

export function ShortsNarrationFitPanel({ baseUrl, artifactId, unsaved }: { baseUrl: string; artifactId: string; unsaved?: boolean }): JSX.Element | null {
	const [state, setState] = React.useState<FitState | null>(null);
	const [busy, setBusy] = React.useState('');
	const [note, setNote] = React.useState('');
	const load = React.useCallback(() => {
		axios.get<FitState>(`${baseUrl}/content/shorts/artifacts/${artifactId}/narration-fit`)
			.then((response) => setState(response.data))
			.catch((err) => setNote(errorText(err)));
	}, [artifactId, baseUrl]);
	React.useEffect(() => load(), [load]);
	if (!state) return note ? <div style={{ fontSize: 11, color: '#b91c1c' }}>{note}</div> : null;

	const fit = state.fit;
	const proposal = fit?.proposal;
	const decision = fit?.humanDecision.status;
	const ready = proposal?.status === 'PROPOSAL_READY';
	const sourceReady = state.source.readiness === 'NARRATION_FIT_READY';
	const call = async (label: string, path: string, payload: Record<string, unknown>, confirmText: string) => {
		if (unsaved) {
			setNote('저장되지 않은 변경이 있습니다. 먼저 저장한 뒤 진행하세요.');
			return;
		}
		if (!window.confirm(confirmText)) return;
		setBusy(label);
		setNote('');
		try {
			const response = await axios.post<FitState & { revision?: { artifact_id: string } }>(`${baseUrl}/content/shorts/artifacts/${artifactId}/narration-fit/${path}`, payload);
			setState(response.data);
			if (response.data.revision) setNote(`새 revision ${response.data.revision.artifact_id} 을(를) 만들었습니다. 그 숏츠에서 음성을 만들어 실제 길이를 확인하세요.`);
		} catch (err) {
			setNote(errorText(err));
		} finally {
			setBusy('');
		}
	};
	const decide = (value: string, label: string) => {
		if (!proposal) return;
		let note = '';
		if (value === 'REVISION_REQUIRED') {
			const input = window.prompt('어떻게 고쳐야 하는지 적어 주세요. 다음 축약안을 만들 때 AI에 그대로 전달됩니다.', '');
			if (input === null) return;
			note = input.trim();
		}
		void call(value, 'decision', { decision: value, proposal_id: proposal.proposalId, proposal_sha256: proposal.proposalSha256, actor: 'shorts_ui', note, ...(note ? { revision_instructions: { general: [note] } } : {}) }, `축약안을 '${label}' 처리합니다. 진행할까요?`);
	};
	const round = proposal?.revision?.round || 1;
	const history = fit?.history || [];
	const qa = proposal?.naturalLanguageQa;
	const sceneChange = proposal ? proposal.scenes.filter((s) => s.proposedSceneDurationSec !== s.currentSceneDurationSec).length : 0;

	return (
		<div style={{ display: 'grid', gap: 8, background: '#fff', border: '1px solid #c7d2fe', borderRadius: 10, padding: 10 }} data-testid="shorts-narration-fit">
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
				<div style={{ fontSize: 12, fontWeight: 900 }}>
					대사 길이 맞춤 (축약안 → 사람 승인 → 새 revision)
					{proposal ? <span style={{ marginLeft: 8, color: '#4338ca' }} data-testid="shorts-narration-fit-round">축약안 v{round}{proposal.revision ? ` (이전안 ${proposal.revision.previousProposalId} 수정)` : ''}</span> : null}
					{proposal ? <span style={{ marginLeft: 8, color: ready ? '#047857' : '#b45309' }}>{ready ? '축약안 검증 통과' : '축약안 보류'}</span> : null}
					{decision ? <span style={{ marginLeft: 8, color: decision === 'APPROVED' ? '#047857' : '#7c3aed' }} data-testid="shorts-narration-fit-decision">{DECISION_LABEL[decision] || decision}</span> : null}
				</div>
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
					{state.canPropose ? (
						<button type="button" style={!sourceReady || busy ? DISABLED : BUTTON} disabled={!sourceReady || Boolean(busy)} onClick={() => void call('propose', 'proposal', { actor: 'shorts_ui' }, '대사 축약안을 만듭니다.\nAI 글쓰기 1회 호출 · 음성/이미지 호출 0회\n원본 대사와 장면 시간은 바뀌지 않습니다.\n진행할까요?')}>
							{busy === 'propose' ? '축약안 만드는 중...' : proposal ? '축약안 다시 만들기 (AI 1회)' : '축약안 만들기 (AI 1회)'}
						</button>
					) : null}
					{state.canDecide ? (
						<>
							<button type="button" style={ready && !busy ? PRIMARY : DISABLED} disabled={!ready || Boolean(busy)} title={ready ? undefined : '검증을 통과하지 못한 축약안은 승인할 수 없습니다.'} onClick={() => decide('APPROVED', '승인')}>축약안 승인</button>
							<button type="button" style={busy ? DISABLED : BUTTON} disabled={Boolean(busy)} onClick={() => decide('REVISION_REQUIRED', '수정 필요')}>수정 필요</button>
							<button type="button" style={busy ? DISABLED : BUTTON} disabled={Boolean(busy)} onClick={() => decide('REJECTED', '거절')}>거절</button>
						</>
					) : null}
					{decision === 'APPROVED' && !fit?.applied ? (
						<button type="button" style={state.applyBlockers.length || busy ? DISABLED : PRIMARY} disabled={Boolean(state.applyBlockers.length || busy)} onClick={() => void call('apply', 'apply', { actor: 'shorts_ui' }, '승인한 축약안으로 새 revision을 만듭니다.\n원본은 그대로 두고, 이미지는 재사용하며, 음성은 새 revision에서 따로 만듭니다.\n진행할까요?')}>
							승인안 적용 (새 revision)
						</button>
					) : null}
				</div>
			</div>
			{!sourceReady && !proposal ? <div style={{ fontSize: 11, color: '#b45309' }}>근거 확인이 끝나지 않아 축약안을 만들 수 없습니다 ({state.source.blockers.map(reasonLabel).join(', ') || state.source.readiness}).</div> : null}
			{fit?.applied ? <div style={{ fontSize: 11, color: '#047857', fontWeight: 800 }}>적용 완료 → {fit.applied.revisionArtifactId}</div> : null}
			{state.lineage ? <div style={{ fontSize: 11, color: '#475569' }}>이 숏츠는 {state.lineage.parentArtifactId} 의 승인된 축약안({state.lineage.fitProposalId})으로 만든 revision입니다.</div> : null}
			{proposal ? (
				<>
					<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px' }} data-testid="shorts-narration-fit-summary">
						<span>영상 목표 {sec(proposal.totals.videoTargetMs)}</span>
						<span>현재 예상 {sec(proposal.totals.originalEstimatedMs)}</span>
						<span style={{ fontWeight: 900, color: proposal.totals.proposedEstimatedMs <= proposal.totals.videoTargetMs ? '#047857' : '#b91c1c' }}>축약안 예상 {sec(proposal.totals.proposedEstimatedMs)}</span>
						{typeof proposal.estimatedSceneOverflowCount === 'number' ? <span style={{ fontWeight: 800, color: proposal.estimatedSceneOverflowCount ? '#b91c1c' : '#047857' }} data-testid="shorts-narration-fit-scene-overflow">장면별 예상 초과 {proposal.estimatedSceneOverflowCount}개</span> : null}
						<span>글자 {proposal.totals.originalChars} → {proposal.totals.proposedChars}자 (말 글자 {proposal.totals.originalSpeechChars} → {proposal.totals.proposedSpeechChars})</span>
						<span>유지 근거 {proposal.claimComparison.preserved} · 삭제 {proposal.claimComparison.removed} · 새 근거 {proposal.claimComparison.new}</span>
						<span>장면 시간 {proposal.currentSceneAllocation.join(' / ')} → {proposal.proposedSceneAllocation.join(' / ')}초{sceneChange ? ` (${sceneChange}개 장면 변경)` : ' (변경 없음)'}</span>
						<span>역할 유지: {proposal.marketingRoles.original.map((r) => `${ROLE_LABEL[r] || r}${proposal.marketingRoles.lost.includes(r) ? '✗' : '✓'}`).join(' · ')}</span>
					</div>
					{proposal.holdReasons.length ? <div style={{ fontSize: 11, fontWeight: 800, color: '#b91c1c' }} data-testid="shorts-narration-fit-hold">보류 사유: {proposal.holdReasons.map(reasonLabel).join(' / ')}</div> : null}
					{proposal.warnings.length ? <div style={{ fontSize: 11, color: '#b45309' }}>참고: {proposal.warnings.map(reasonLabel).join(' / ')}</div> : null}
					{qa ? (
						<div style={{ fontSize: 11, color: qa.status === 'PASS' ? '#047857' : '#b91c1c' }} data-testid="shorts-narration-fit-qa">
							문장 자동 점검(완결·반복·유지 요청): {qa.status === 'PASS' ? '문제 없음' : qa.issues.map((i) => `Scene ${i.order} ${reasonLabel(i.code)}`).join(' / ')}
							{typeof qa.previousIssueCount === 'number' ? ` · 이전안 ${qa.previousIssueCount}건 → 이번 ${qa.issueCount}건` : ''}
							<span style={{ color: '#64748b' }}> · 자동 점검은 보조 수단이며 최종 판단은 사람이 듣고 합니다.</span>
						</div>
					) : null}
					<div style={{ fontSize: 10, color: '#64748b' }}>예상 길이는 임시 추정치입니다. 최종 판정은 승인 후 새 revision에서 음성을 만든 뒤의 실제 길이로 합니다. 승인 전에는 원본 대사·장면 시간·음성·이미지·음악이 바뀌지 않습니다.</div>
					<div style={{ display: 'grid', gap: 4 }}>
						{proposal.scenes.map((scene) => (
							<div key={scene.sceneId} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) minmax(0,1fr) 190px', gap: 8, fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', background: scene.issues.length ? '#fef2f2' : '#fff' }} data-testid="shorts-narration-fit-scene">
								<div style={{ fontWeight: 900 }}>
									Scene {scene.order}
									<div style={{ fontWeight: 700, color: '#64748b' }}>{scene.stage}{scene.marketingRole ? ` · ${ROLE_LABEL[scene.marketingRole] || scene.marketingRole}` : ''}</div>
								</div>
								<div><div style={{ color: '#64748b' }}>원문</div>{scene.originalNarration}</div>
								<div>
									<div style={{ color: '#4338ca' }}>축약안</div>
									<strong>{scene.proposedNarration}</strong>
									{scene.proposedSubtitle ? <div style={{ color: '#b45309' }}>자막 변경: {scene.originalSubtitle} → {scene.proposedSubtitle}</div> : null}
									{scene.proposedOnScreenText ? <div style={{ color: '#b45309' }}>화면 문구 변경: {scene.originalOnScreenText} → {scene.proposedOnScreenText}</div> : null}
									{scene.issues.length ? <div style={{ color: '#b91c1c', fontWeight: 800 }}>{scene.issues.map(reasonLabel).join(', ')}</div> : null}
								</div>
								<div style={{ color: '#475569', display: 'grid', gap: 1 }}>
									<span>글자 {scene.originalChars} → {scene.proposedChars}자</span>
									<span>예상 {sec(scene.originalEstimatedMs)} → {sec(scene.estimatedDurationMs)}</span>
									<span style={{ color: scene.proposedEstimatedStatus === 'OVERFLOW' ? '#b91c1c' : '#047857', fontWeight: 800 }}>장면 {scene.currentSceneDurationSec}초 → {scene.proposedSceneDurationSec}초</span>
									<span>유지 {scene.claimIdsUsed.length} · 삭제 {scene.claimIdsRemoved.length}{scene.claimIdsNew.length ? ` · 새 ${scene.claimIdsNew.length}` : ''}</span>
								</div>
								{scene.removedClaims.length ? <div style={{ gridColumn: '2 / 5', color: '#7c3aed' }}>삭제된 내용: {scene.removedClaims.map((c) => `“${c.claimText}”`).join(' · ')}</div> : null}
							</div>
						))}
					</div>
					<details style={{ fontSize: 11 }} data-testid="shorts-narration-fit-claims">
						<summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 700 }}>근거 상세 (claim · 근거 권한) · {proposal.proposalId}{proposal.writer?.model ? ` · ${proposal.writer.model}` : ''}</summary>
						<div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
							{proposal.scenes.flatMap((scene) => scene.claims.filter((c) => c.field === 'voice_over').map((c) => {
								const check = proposal.semanticValidation.claims.find((x) => x.order === scene.order && x.claimId === c.claimId && x.field === c.field);
								return (
									<div key={`${scene.order}-${c.claimId}`} style={{ display: 'grid', gridTemplateColumns: '90px 170px minmax(0,1fr)', gap: 6 }}>
										<span style={{ fontWeight: 800 }}>{c.claimId}</span>
										<span>{c.claimType} · {check?.groundingStatus || '-'}</span>
										<span>
											{c.claimText}
											{c.canonicalStatement ? <span style={{ color: '#64748b' }}> · 기준 문장: {c.canonicalStatement}</span> : null}
											{c.evidenceRefs?.length ? <span style={{ color: '#64748b' }}> · {c.evidenceRefs.join(', ')}</span> : null}
											{check?.sourceAuthority?.length ? <span style={{ color: '#64748b' }}> · {check.sourceAuthority.join(', ')}</span> : null}
										</span>
									</div>
								);
							}))}
						</div>
					</details>
					{history.length ? (
						<details style={{ fontSize: 11 }} data-testid="shorts-narration-fit-history">
							<summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 700 }}>이전 축약안 History · {history.length}건</summary>
							<div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
								{[...history].reverse().map((h) => (
									<div key={h.proposalId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', background: '#f8fafc', display: 'grid', gap: 3 }}>
										<div style={{ fontWeight: 800 }}>
											v{h.revision?.round || 1} · {h.proposalId} · {DECISION_LABEL[h.humanDecision?.status || ''] || h.humanDecision?.status || '-'} · 예상 {sec(h.totals?.proposedEstimatedMs)} · {h.totals?.proposedChars}자 · 장면 시간 {(h.proposedSceneAllocation || []).join(' / ')}초 · 자동 점검 {h.naturalLanguageQa?.issueCount ?? '-'}건
										</div>
										{h.scenes.map((s) => {
											const note = h.humanDecision?.revisionInstructions?.scenes.find((x) => String(x.order) === String(s.order));
											return (
												<div key={s.order} style={{ display: 'grid', gridTemplateColumns: '60px minmax(0,1fr)', gap: 6 }}>
													<span>Scene {s.order}</span>
													<span>
														{s.proposedNarration} <span style={{ color: '#64748b' }}>({sec(s.estimatedDurationMs)} / {s.proposedSceneDurationSec}초)</span>
														{note ? <span style={{ color: '#7c3aed' }}> · 검수: {VERDICT_LABEL[note.verdict] || note.verdict}{note.issues.length ? ` — ${note.issues.join(', ')}` : ''}</span> : null}
													</span>
												</div>
											);
										})}
										{h.humanDecision?.revisionInstructions?.general.length ? <div style={{ color: '#7c3aed' }}>전체 검수 의견: {h.humanDecision.revisionInstructions.general.join(' / ')}</div> : null}
										{!h.humanDecision?.revisionInstructions && h.humanDecision?.note ? <div style={{ color: '#7c3aed' }}>검수 메모: {h.humanDecision.note}</div> : null}
									</div>
								))}
							</div>
						</details>
					) : null}
				</>
			) : null}
			{note ? <div style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>{note}</div> : null}
		</div>
	);
}
