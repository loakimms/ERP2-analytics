import React from 'react';

import {
	applyLocalDecision,
	applyLocalTitleEdit,
	authorityLabel,
	intentLabel,
	readinessLabel,
	reviewCountSummary,
	type ReviewReadiness,
} from './blogV2Review';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16 };
const button: React.CSSProperties = { border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: 10, padding: '6px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer' };
const muted: React.CSSProperties = { color: '#64748b', fontSize: 12, lineHeight: 1.55 };

type Props = {
	bundle: Record<string, any>;
	reviewerStatus?: string | null;
	onBundleChange: (bundle: Record<string, any>) => void;
	onTitleEdit?: (title: string) => void;
	onRevalidate?: () => void;
	unsavedChanges?: boolean;
	revalidateBusy?: boolean;
	revalidateMessage?: string;
};

export function BlogV2ReviewPanel({ bundle, reviewerStatus, onBundleChange, onTitleEdit, onRevalidate, unsavedChanges = false, revalidateBusy = false, revalidateMessage = '' }: Props): JSX.Element {
	const summary = reviewCountSummary(bundle);
	const readiness = String(bundle.reviewSummary?.reviewReadiness || 'REVIEW_REQUIRED') as ReviewReadiness;
	const stale = bundle.humanReview?.validationFreshness === 'STALE_AFTER_HUMAN_EDIT';
	const quality = bundle.currentQualityReport || bundle.qualityReport || {};
	const items = Array.isArray(bundle.reviewItems) ? bundle.reviewItems : [];
	const decide = (id: string, decision: string, note?: string) => onBundleChange(applyLocalDecision(bundle, id, decision, note));
	return (
		<section style={{ display: 'grid', gap: 12 }} data-testid="blog-v2-review-panel">
			<div style={card}>
				<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
					<h3 style={{ margin: 0, fontSize: 15 }}>발행 전 점검</h3>
					<span style={{ color: readiness === 'BLOCKED' ? '#dc2626' : readiness === 'READY_FOR_FINAL_REVIEW' || readiness === 'HUMAN_APPROVED' ? '#059669' : '#d97706', fontSize: 12, fontWeight: 900 }}>
						현재 상태: {readinessLabel(readiness)}
					</span>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
					<CountCard label="발행 차단" value={summary.blocked} tone={summary.blocked ? '#dc2626' : '#059669'} />
					<CountCard label="확인 필요" value={summary.pending} tone={summary.pending ? '#d97706' : '#059669'} />
					<CountCard label="확인 완료" value={summary.completed} tone="#059669" />
					<CountCard label="이미지 준비" value={summary.imageReady} tone="#2563eb" />
				</div>
				{stale ? (
					<div style={{ marginTop: 10, color: '#d97706', fontSize: 12, fontWeight: 800 }}>
						본문이나 제목이 수정되어 이전 품질 점검은 현재 유효하지 않습니다. 수정 후 다시 점검이 필요합니다.
					</div>
				) : null}
				{unsavedChanges ? (
					<div style={{ marginTop: 8, color: '#d97706', fontSize: 12, fontWeight: 800 }}>
						변경 내용을 먼저 저장한 뒤 다시 점검해 주세요.
					</div>
				) : null}
				{stale || unsavedChanges ? (
					<button
						type="button"
						data-testid="blog-v2-revalidate"
						style={{ ...button, marginTop: 10 }}
						disabled={unsavedChanges || revalidateBusy || !onRevalidate}
						onClick={() => onRevalidate?.()}
					>
						{revalidateBusy ? '다시 점검 중...' : '다시 점검'}
					</button>
				) : null}
				{revalidateMessage ? <div style={{ ...muted, marginTop: 8 }}>{revalidateMessage}</div> : null}
				{String(quality.gateDecision || '') === 'HOLD' ? (
					<div style={{ marginTop: 8, color: '#dc2626', fontSize: 12, fontWeight: 800 }}>현재 편집본 품질 점검이 HOLD입니다. 검수 승인할 수 없습니다.</div>
				) : null}
				{reviewerStatus === 'accepted' ? <div style={{ ...muted, marginTop: 8 }}>기존 검수 승인 완료</div> : null}
			</div>
			<Collapsible title="1. 생성 내용" testId="blog-v2-block-content">
				<ContentBlock bundle={bundle} onSelectTitle={(title) => {
					onBundleChange(applyLocalTitleEdit(bundle, title));
					onTitleEdit?.(title);
				}} />
			</Collapsible>
			<Collapsible title="2. 사실과 근거" testId="blog-v2-block-facts">
				<FactsBlock bundle={bundle} items={items} onDecide={decide} />
			</Collapsible>
			<Collapsible title="3. 표현·광고 안전" testId="blog-v2-block-safety">
				<SafetyBlock items={items} onDecide={decide} />
			</Collapsible>
			<Collapsible title="4. 읽기 품질" testId="blog-v2-block-readability">
				<ReadabilityBlock bundle={bundle} items={items} onDecide={decide} />
			</Collapsible>
			<Collapsible title="5. 이미지 준비" testId="blog-v2-block-images">
				<ImagesBlock bundle={bundle} items={items} onDecide={decide} />
			</Collapsible>
			<Collapsible title="6. 최종 확인" defaultOpen testId="blog-v2-block-final">
				<FinalBlock bundle={bundle} items={items} readiness={readiness} />
			</Collapsible>
		</section>
	);
}

function CountCard({ label, value, tone }: { label: string; value: string | number; tone: string }): JSX.Element {
	return (
		<div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 8 }}>
			<div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>{label}</div>
			<div style={{ color: tone, fontSize: 18, fontWeight: 950 }}>{value}</div>
		</div>
	);
}

function Collapsible({ title, children, defaultOpen = false, testId }: { title: string; children: React.ReactNode; defaultOpen?: boolean; testId?: string }): JSX.Element {
	const [open, setOpen] = React.useState(defaultOpen);
	return (
		<section style={card} data-testid={testId}>
			<button type="button" onClick={() => setOpen((value) => !value)} style={{ ...button, width: '100%', textAlign: 'left', fontSize: 13 }}>
				{open ? '▾' : '▸'} {title}
			</button>
			{open ? <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>{children}</div> : null}
		</section>
	);
}

function ContentBlock({ bundle, onSelectTitle }: { bundle: Record<string, any>; onSelectTitle: (title: string) => void }): JSX.Element {
	const draft = bundle.draft || {};
	const intent = bundle.intentAnalysis || {};
	const plan = bundle.contentPlan || {};
	const selected = bundle.humanReview?.humanEdits?.selectedTitle || draft.selectedTitle;
	const audience = intent.audienceHypothesis || {};
	const inferred = String(audience.classification || intent.classification || '').includes('INFERENCE') || String(audience.classification || '') === 'MODEL_DERIVED';
	const cta = draft.cta?.text || draft.cta || '';
	return (
		<div style={{ display: 'grid', gap: 8 }}>
			<div style={{ fontSize: 13, fontWeight: 900 }}>선택 제목</div>
			<div style={{ fontSize: 13 }}>{selected || '-'}</div>
			<div style={{ fontSize: 12, fontWeight: 800, color: '#475569' }}>다른 제목 후보</div>
			{(draft.titleCandidates || []).map((item: any, index: number) => {
				const title = typeof item === 'string' ? item : item.title;
				const active = title === selected;
				return (
					<button key={`${title}-${index}`} type="button" style={{ ...button, borderColor: active ? '#2563eb' : '#cbd5e1' }} onClick={() => onSelectTitle(title)}>
						{active ? '사용 중 · ' : ''}{title}
					</button>
				);
			})}
			<div style={muted}>예상 검색 의도: {intentLabel(intent.primaryIntent)}{inferred ? ' · AI가 문맥을 바탕으로 추정' : ''}</div>
			<div style={muted}>대상 독자: {audience.primary || '확인된 독자 정보가 없습니다.'}{inferred ? ' · AI가 문맥을 바탕으로 추정' : ''}</div>
			<div style={{ fontSize: 12, fontWeight: 800 }}>본문 구조</div>
			<ul style={{ margin: 0, paddingLeft: 18, ...muted }}>
				{(draft.sections || plan.sections || []).map((section: any, index: number) => (
					<li key={section.sectionId || index}>{section.heading || section.userQuestion || section.headingIntent || `섹션 ${index + 1}`}</li>
				))}
			</ul>
			<div style={{ fontSize: 12, fontWeight: 800 }}>FAQ</div>
			<ul style={{ margin: 0, paddingLeft: 18, ...muted }}>
				{(draft.faq || []).map((item: any, index: number) => <li key={index}>{item.question}</li>)}
			</ul>
			<div style={muted}>CTA: {typeof cta === 'string' ? cta : '-'}</div>
		</div>
	);
}

function FactsBlock({ bundle, items, onDecide }: { bundle: Record<string, any>; items: any[]; onDecide: (id: string, decision: string, note?: string) => void }): JSX.Element {
	const facts = Array.isArray(bundle.context?.sourceFacts) ? bundle.context.sourceFacts : [];
	const factMap = Object.fromEntries(facts.map((item: any) => [item.factId, item]));
	return (
		<div style={{ display: 'grid', gap: 12 }}>
			{(bundle.draft?.sections || []).map((section: any) => (
				<div key={section.sectionId} style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: 10 }}>
					<div style={{ fontWeight: 900, fontSize: 13 }}>{section.heading}</div>
					<div style={{ ...muted, marginTop: 6 }}>{(section.paragraphs || []).join(' ')}</div>
					<div style={{ marginTop: 8, fontSize: 12, fontWeight: 800 }}>근거 자료</div>
					{(section.sourceRefs || []).map((ref: string) => {
						const fact = factMap[ref] || {};
						return (
							<div key={ref} style={muted}>
								✓ {authorityLabel(fact.classification)}: {fact.statement || ref}
							</div>
						);
					})}
					{(section.sourceRefs || []).some((ref: string) => String(factMap[ref]?.classification || '').toUpperCase() === 'INFERENCE') ? (
						<div style={{ color: '#d97706', fontSize: 12, marginTop: 6 }}>△ 상세페이지 분석값은 AI 추출 자료입니다.</div>
					) : null}
					{!(section.sourceRefs || []).length ? <div style={muted}>확인되지 않은 범위: 이 섹션에 연결된 확정 자료가 없습니다.</div> : null}
				</div>
			))}
			<ReviewItemCard item={items.find((item) => item.reviewItemId === 'RV_FACT_MEANING')} onDecide={onDecide} />
			<ReviewItemCard item={items.find((item) => item.reviewItemId === 'RV_GENERAL_KNOWLEDGE')} onDecide={onDecide} />
		</div>
	);
}

function SafetyBlock({ items, onDecide }: { items: any[]; onDecide: (id: string, decision: string, note?: string) => void }): JSX.Element {
	const safety = items.filter((item) => item.block === 'SAFETY' || item.category === 'CLAIM_SAFETY');
	if (!safety.length) return <div style={muted}>지금은 발행을 막는 표현 문제는 없습니다. 광고·협찬 여부만 확인해 주세요.</div>;
	return (
		<div style={{ display: 'grid', gap: 10 }}>
			{safety.map((item) => <ReviewItemCard key={item.reviewItemId} item={item} onDecide={onDecide} />)}
		</div>
	);
}

function ReadabilityBlock({ bundle, items, onDecide }: { bundle: Record<string, any>; items: any[]; onDecide: (id: string, decision: string, note?: string) => void }): JSX.Element {
	const metrics = (bundle.currentQualityReport || bundle.qualityReport)?.metrics || {};
	const profile = (bundle.currentQualityReport || bundle.qualityReport)?.guidelineProfile?.body || {};
	const count = Number(metrics.visibleCharacterCount || 0);
	const min = Number(profile.preferredMin || 2200);
	const max = Number(profile.preferredMax || 2600);
	const short = count < min;
	const readability = items.filter((item) => item.block === 'READABILITY' || item.category === 'READABILITY');
	return (
		<div style={{ display: 'grid', gap: 8 }}>
			<div style={{ fontSize: 13 }}>본문 {count.toLocaleString()}자</div>
			<div style={muted}>참고 범위 {min.toLocaleString()}~{max.toLocaleString()}자</div>
			<div style={{ color: short ? '#d97706' : '#059669', fontSize: 12, fontWeight: 800 }}>상태: {short ? '짧음' : '참고 범위 안'}</div>
			<div style={muted}>자료가 부족한 경우 억지로 분량을 늘리지 않는 것이 우선입니다.</div>
			{readability.map((item) => <ReviewItemCard key={item.reviewItemId} item={item} onDecide={onDecide} optional />)}
		</div>
	);
}

function ImagesBlock({ bundle, items, onDecide }: { bundle: Record<string, any>; items: any[]; onDecide: (id: string, decision: string, note?: string) => void }): JSX.Element {
	const images = Array.isArray(bundle.imagePlan?.items) ? bundle.imagePlan.items : [];
	return (
		<div style={{ display: 'grid', gap: 10 }}>
			{images.map((image: any) => {
				const pending = image.status === 'PENDING_ASSET';
				const assigned = image.status === 'ASSIGNED';
				const notNeeded = image.status === 'NOT_REQUIRED' || image.needStatus === 'NOT_NEEDED';
				const evidence = Array.isArray(image.riskNotes) && image.riskNotes.includes('EVIDENCE_IMAGE_REQUIRES_REAL_SOURCE');
				const generation = image.status === 'PENDING_GENERATION_REVIEW' || image.generationCandidate;
				return (
					<div key={image.imagePlanId || image.sectionId} style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: 10 }}>
						<div style={{ fontWeight: 900, fontSize: 13 }}>{image.sectionId} {purposeLabel(image.purpose)}</div>
						<div style={muted}>배치 위치: {image.placement?.anchor || image.placement || '-'}</div>
						<div style={{ color: evidence ? '#dc2626' : pending ? '#d97706' : assigned ? '#059669' : '#64748b', fontSize: 12, fontWeight: 800, marginTop: 4 }}>
							{evidence ? '! 실제 증빙 이미지가 필요합니다. AI 생성 이미지로 대체할 수 없습니다.' : pending ? '△ 이미지 필요' : assigned ? '✓ 실제 제품 사진 연결' : notNeeded ? '– 이미지 필요 없음' : image.status}
						</div>
						{assigned ? (
							<div style={muted}>
								현재 이미지: {image.assetRef || '-'}<br />
								ALT: {image.altText || '-'}<br />
								Caption: {image.caption || '-'}<br />
								파일명 제안: {image.filenameSuggestion || '-'}<br />
								권리 확인 상태: 자료상 {image.ownership || 'UNKNOWN'}
							</div>
						) : null}
						{pending ? <div style={muted}>실제 과정 사진 없음</div> : null}
						{generation && !assigned ? <div style={muted}>AI 이미지 생성 가능 후보 · 생성 예정</div> : null}
					</div>
				);
			})}
			{items.filter((item) => item.block === 'IMAGES' || item.category === 'IMAGE').map((item) => (
				<ReviewItemCard key={item.reviewItemId} item={item} onDecide={onDecide} optional={!item.required} />
			))}
		</div>
	);
}

function FinalBlock({ bundle, items, readiness }: { bundle: Record<string, any>; items: any[]; readiness: string }): JSX.Element {
	const required = items.filter((item) => item.required);
	const done = new Set(['CONFIRMED', 'RESOLVED', 'ACCEPTED_AS_IS', 'NOT_APPLICABLE']);
	const factOk = required.filter((item) => item.block === 'FACTS').every((item) => done.has(item.humanDecision));
	const safetyOk = required.filter((item) => item.block === 'SAFETY').every((item) => done.has(item.humanDecision));
	const imagePending = items.some((item) => item.machineCode === 'PENDING_ASSET' && item.humanDecision === 'PENDING');
	const title = bundle.humanReview?.humanEdits?.selectedTitle || bundle.draft?.selectedTitle;
	return (
		<div style={{ display: 'grid', gap: 6 }}>
			<div style={{ fontWeight: 900, fontSize: 13 }}>발행 전 확인</div>
			<StatusLine ok={factOk} text="사실 및 근거 확인 완료" pending="사실 및 근거 확인 필요" />
			<StatusLine ok={safetyOk} text="광고 표현 확인 완료" pending="광고 표현 확인 필요" />
			<div style={{ color: imagePending ? '#d97706' : '#059669', fontSize: 12 }}>{imagePending ? '△ 이미지 1건 이상 준비 필요' : '✓ 이미지 준비 상태 확인'}</div>
			<div style={{ color: title ? '#059669' : '#d97706', fontSize: 12 }}>{title ? '✓ 제목 확인 완료' : '△ 제목 확인 필요'}</div>
			<div style={{ marginTop: 8, fontWeight: 950, color: readiness === 'BLOCKED' ? '#dc2626' : readiness === 'READY_FOR_FINAL_REVIEW' || readiness === 'HUMAN_APPROVED' ? '#059669' : '#d97706' }}>
				현재 상태: {readinessLabel(readiness)}
			</div>
			<div style={muted}>최종 승인은 기존 검수 승인 버튼으로 남깁니다. 이 화면에서 기계 판정을 바꾸지는 않습니다.</div>
		</div>
	);
}

function StatusLine({ ok, text, pending }: { ok: boolean; text: string; pending: string }): JSX.Element {
	return <div style={{ color: ok ? '#059669' : '#d97706', fontSize: 12 }}>{ok ? `✓ ${text}` : `△ ${pending}`}</div>;
}

function ReviewItemCard({ item, onDecide, optional = false }: { item?: any; onDecide: (id: string, decision: string, note?: string) => void; optional?: boolean }): JSX.Element | null {
	if (!item) return null;
	const fail = item.severity === 'FAIL';
	const mark = fail ? '!' : item.humanDecision && item.humanDecision !== 'PENDING' ? '✓' : '△';
	const color = fail ? '#dc2626' : mark === '✓' ? '#059669' : '#d97706';
	const disclosure = item.machineCode === 'COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN';
	const ownership = item.machineCode === 'IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED';
	const altMatch = item.machineCode === 'IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED';
	return (
		<div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }} data-review-item={item.reviewItemId}>
			<div style={{ color, fontWeight: 900, fontSize: 13 }}>{mark} {item.title}</div>
			<div style={{ ...muted, marginTop: 4 }}>{item.description}</div>
			{optional ? <div style={muted}>참고 항목입니다. 반드시 클릭하지 않아도 최종 확인을 진행할 수 있습니다.</div> : null}
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
				{disclosure ? (
					<>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'NOT_APPLICABLE', '자사 자체 콘텐츠')}>자사 자체 콘텐츠</button>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'CONFIRMED', '협찬/대가성 콘텐츠')}>협찬/대가성 콘텐츠</button>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'PENDING')}>확인 필요</button>
					</>
				) : ownership ? (
					<>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'CONFIRMED')}>확인됨</button>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'PENDING')}>확인 필요</button>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'NOT_APPLICABLE', '사용하지 않음')}>사용하지 않음</button>
					</>
				) : altMatch ? (
					<>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'CONFIRMED')}>일치함</button>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'REJECTED')}>일치하지 않음</button>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'NOT_APPLICABLE')}>해당 없음</button>
					</>
				) : (
					<>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'CONFIRMED')}>확인</button>
						{fail ? null : <button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'ACCEPTED_AS_IS')}>그대로 사용</button>}
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, fail ? 'REJECTED' : 'REJECTED')}>수정 필요</button>
						<button type="button" style={button} onClick={() => onDecide(item.reviewItemId, 'NOT_APPLICABLE')}>해당 없음</button>
					</>
				)}
			</div>
			<details style={{ marginTop: 8, ...muted }}>
				<summary>상세보기</summary>
				<div>내부 코드: {item.machineCode}</div>
				<div>범위: {item.scope}</div>
				<div>사람 판단: {item.humanDecision}</div>
			</details>
		</div>
	);
}

function purposeLabel(purpose?: string): string {
	const value = String(purpose || '').toUpperCase();
	if (value.includes('PRODUCT')) return '제품 확인';
	if (value.includes('PROCESS') || value.includes('USAGE')) return '사용 순서';
	if (value.includes('CAUTION') || value.includes('WARNING')) return '주의점';
	if (value.includes('EVIDENCE')) return '근거 자료';
	return purpose || '이미지';
}
