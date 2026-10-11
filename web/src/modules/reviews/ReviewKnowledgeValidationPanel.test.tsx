import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
	ClaimValidationSection,
	composeGateBAuditPreview,
	formatKst,
	gateBQn,
	ReviewKnowledgeValidationPanel,
	type ClaimView,
	type KnowledgeQueueItem,
} from './ReviewKnowledgeValidationPanel';

const ITEM: KnowledgeQueueItem = {
	knowledge_id: 'rrk:naver_review:1',
	review_key: 'naver_review:1',
	product_title: '헤나 염색약',
	product_group: 'HENNA',
	rating: 5,
	review_written_at: '2026-02-01',
	remote_reply_date: '2026-02-02',
	review_text: '새치가 잘 가려지는데 방치 시간이 궁금해요',
	reply_text: '고객님~~ 헤나는 2시간 정도 방치해 주시면 발색이 좋아요.',
	authorship: 'UNKNOWN',
	authorship_evidence: 'NO_DRAFT_NO_DIRECT_EVIDENCE_llm0_hm0',
	tier: 'MANUAL_VERIFICATION_CANDIDATE',
	has_knowhow: true,
	knowhow_items: [
		{
			sentence: '헤나는 2시간 정도 방치해 주시면 발색이 좋아요.',
			topics: ['HENNA_COLOR', 'TIME'],
			facts: ['DURATION:2시간'],
			requires_current_fact_verification: true,
			current_validity: 'UNVERIFIED_REQUIRES_CURRENT_FACT_CHECK',
		},
	],
	review_topics: ['GRAY_COVERAGE', 'TIME'],
	reply_topics: ['HENNA_COLOR', 'TIME'],
	template_like: false,
	policy_violations: [],
	content_validation: 'PENDING',
	queue_priority: 7.5,
	validation_history: [],
};

function makeApi(writeEnabled: boolean, canValidate = true) {
	const get = vi.fn(async (url: string) => {
		if (url.endsWith('/reviews/reply-knowledge/permission')) {
			return {
				data: {
					authenticated: true,
					can_validate: canValidate,
					role: canValidate ? 'ops_admin' : 'marketing',
					required_role: 'ops_admin',
					validation_write_enabled: writeEnabled,
				},
			};
		}
		if (url.endsWith('/reviews/reply-knowledge/summary')) {
			return {
				data: {
					total: 10,
					invalid: 2,
					valid: 8,
					authorship: { LIKELY_HUMAN: 3, UNKNOWN: 2 },
					tiers: { AI_ORIGIN_REFERENCE: 3, MANUAL_VERIFICATION_CANDIDATE: 1 },
					content_validation_of_human_reference_tiers: { PENDING: 4 },
					unknown_with_knowhow: 1,
					retrieval_status: 'LEXICAL_RETRIEVAL_BASELINE',
					validation_write_enabled: writeEnabled,
				},
			};
		}
		if (url.endsWith('/reviews/reply-knowledge/queue')) {
			return { data: { total: 1, items: [ITEM], validation_write_enabled: writeEnabled } };
		}
		return { data: ITEM };
	});
	const post = vi.fn(async () => ({ data: { ok: true } }));
	return { get, post };
}

describe('ReviewKnowledgeValidationPanel', () => {
	it('작성 주체와 내용 검증을 분리해 표시하고 쓰기 비활성 시 버튼을 잠근다', async () => {
		const api = makeApi(false);
		render(<ReviewKnowledgeValidationPanel apiBaseUrl="http://api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} />);
		await waitFor(() => expect(screen.getByText(/검증 대기열 1건/)).toBeTruthy());
		expect(api.get).toHaveBeenCalledWith(
			'http://api/reviews/reply-knowledge/queue',
			expect.objectContaining({
				params: expect.objectContaining({ queue_filter: 'all_candidates', content_validation: 'PENDING', limit: 50, offset: 0 }),
			}),
		);
		fireEvent.click(within(screen.getByLabelText('knowledge-queue-list')).getByRole('button'));
		await waitFor(() => expect(screen.getByLabelText('knowledge-authorship')).toBeTruthy());
		expect(within(screen.getByLabelText('knowledge-authorship')).getByText('작성 주체 미상')).toBeTruthy();
		expect(within(screen.getByLabelText('knowledge-content-validation')).getByText('검증 대기')).toBeTruthy();
		expect(screen.getByText(/UNVERIFIED_REQUIRES_CURRENT_FACT_CHECK/)).toBeTruthy();
		expect((screen.getByRole('button', { name: '승인' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/별도 승인 후 활성화/)).toBeTruthy();
		expect(api.post).not.toHaveBeenCalled();
	});

	it('분석 번호(U###)를 목록과 항목에 표시하고 번호가 없으면 표시하지 않는다', async () => {
		const labelled: KnowledgeQueueItem = {
			...ITEM,
			analysis_labels: ['U017'],
			knowhow_items: [{ ...ITEM.knowhow_items[0]!, analysisLabel: 'U017' }],
		};
		const plain: KnowledgeQueueItem = { ...ITEM, knowledge_id: 'rrk:naver_review:2', review_key: 'naver_review:2' };
		const api = makeApi(false);
		(api.get as any).mockImplementation(async (url: string) => {
			if (url.endsWith('/reviews/reply-knowledge/permission')) {
				return { data: { authenticated: true, can_validate: false, role: 'marketing', required_role: 'ops_admin' } };
			}
			if (url.endsWith('/reviews/reply-knowledge/summary')) {
				return { data: { total: 2, invalid: 0, valid: 2, authorship: {}, tiers: {}, content_validation_of_human_reference_tiers: {}, unknown_with_knowhow: 0 } };
			}
			if (url.endsWith('/reviews/reply-knowledge/queue')) return { data: { total: 2, items: [labelled, plain], validation_write_enabled: false } };
			return { data: labelled };
		});
		render(<ReviewKnowledgeValidationPanel apiBaseUrl="http://api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} />);
		await waitFor(() => expect(screen.getByText(/검증 대기열 2건/)).toBeTruthy());
		const buttons = within(screen.getByLabelText('knowledge-queue-list')).getAllByRole('button');
		const first = buttons[0]!;
		const second = buttons[1]!;
		expect(within(first).getByLabelText('analysis-label').textContent).toBe('U017');
		expect(within(second).queryByLabelText('analysis-label')).toBeNull();
		fireEvent.click(first);
		await waitFor(() => expect(within(screen.getByLabelText('knowledge-detail')).getByLabelText('knowhow-unit')).toBeTruthy());
		expect(within(screen.getByLabelText('knowhow-unit')).getByLabelText('analysis-label').textContent).toBe('U017');
		expect(api.post).not.toHaveBeenCalled();
	});

	it('검증 대기 기본 필터로 50건씩 넘겨 보고 검증현황을 현재/전체로 표시한다', async () => {
		const api = makeApi(true);
		(api.get as any).mockImplementation(async (url: string, config?: any) => {
			if (url.endsWith('/reviews/reply-knowledge/permission')) {
				return { data: { authenticated: true, can_validate: true, role: 'ops_admin', required_role: 'ops_admin' } };
			}
			if (url.endsWith('/reviews/reply-knowledge/summary')) {
				return {
					data: {
						total: 10, invalid: 2, valid: 8, authorship: {}, tiers: {}, content_validation_of_human_reference_tiers: {},
						unknown_with_knowhow: 1, retrieval_status: 'LEXICAL_RETRIEVAL_BASELINE', validation_write_enabled: true,
					},
				};
			}
			if (url.endsWith('/reviews/reply-knowledge/queue')) {
				const params = config?.params || {};
				const total = params.content_validation === 'PENDING' ? 229 : 279;
				const offset = Number(params.offset || 0);
				const items = Array.from({ length: params.limit === 1 ? 1 : Math.min(50, total - offset) }, (_, i) => ({
					...ITEM,
					knowledge_id: `rrk:${offset + i}`,
				}));
				return { data: { total, items, validation_write_enabled: true } };
			}
			return { data: ITEM };
		});
		render(<ReviewKnowledgeValidationPanel apiBaseUrl="http://api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} />);
		await waitFor(() => expect(screen.getByLabelText('knowledge-validation-progress').textContent).toContain('검증현황 0050/0279'));
		await waitFor(() => expect(screen.getByText('1–50 / 229건')).toBeTruthy());
		expect((screen.getByRole('button', { name: '이전 50건' }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: '다음 50건' }));
		await waitFor(() => expect(screen.getByText('51–100 / 229건')).toBeTruthy());
		expect(api.get).toHaveBeenCalledWith(
			'http://api/reviews/reply-knowledge/queue',
			expect.objectContaining({ params: expect.objectContaining({ content_validation: 'PENDING', offset: 50 }) }),
		);
		expect(within(screen.getByLabelText('knowledge-queue-list')).getAllByRole('button')).toHaveLength(50);
	});

	const pick = (name: string, value: string) =>
		fireEvent.click(
			screen.getAllByRole('radio').find((el) => (el as HTMLInputElement).name === name && (el as HTMLInputElement).value === value)!,
		);
	const isDisabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

	async function openFirst(api: ReturnType<typeof makeApi>) {
		render(<ReviewKnowledgeValidationPanel apiBaseUrl="http://api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} />);
		await waitFor(() => expect(screen.getByText(/검증 대기열 1건/)).toBeTruthy());
		fireEvent.click(within(screen.getByLabelText('knowledge-queue-list')).getByRole('button'));
		await waitFor(() => expect(screen.getByLabelText('knowledge-authorship')).toBeTruthy());
	}

	it('ops_admin 미만이면 쓰기 활성 상태여도 조회 전용으로 잠근다', async () => {
		const api = makeApi(true, false);
		await openFirst(api);
		await waitFor(() => expect(screen.getByLabelText('knowledge-permission-readonly')).toBeTruthy());
		for (const name of ['승인', '보류', '제외', '현재 무효']) expect(isDisabled(name)).toBe(true);
		expect((screen.getByLabelText('knowledge-validation-note') as HTMLTextAreaElement).disabled).toBe(true);
		expect(api.post).not.toHaveBeenCalled();
	});

	it('승인은 4문항 모두 예 + 근거 메모가 있어야 하고, 작성 주체는 보내지 않는다', async () => {
		const api = makeApi(true);
		await openFirst(api);
		await waitFor(() => expect((screen.getByLabelText('knowledge-validation-note') as HTMLTextAreaElement).disabled).toBe(false));
		expect(isDisabled('승인')).toBe(true);
		expect(isDisabled('보류')).toBe(true);
		fireEvent.change(screen.getByLabelText('knowledge-validation-note'), { target: { value: '상세페이지 2시간 안내와 대조 확인' } });
		expect(isDisabled('보류')).toBe(false);
		pick('reply_appropriate', 'yes');
		pick('guidance_accurate', 'yes');
		pick('currently_valid', 'yes');
		pick('reference_worthy', 'unsure');
		expect(isDisabled('승인')).toBe(true);
		pick('reference_worthy', 'yes');
		expect(isDisabled('승인')).toBe(false);
		fireEvent.click(screen.getByRole('button', { name: '승인' }));
		await waitFor(() => expect(api.post).toHaveBeenCalled());
		const [url, body] = api.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
		expect(url).toBe('http://api/reviews/reply-knowledge/validations');
		expect(body).toMatchObject({
			knowledge_id: ITEM.knowledge_id,
			content_validation: 'APPROVED',
			reply_appropriate: 'yes',
			guidance_accurate: 'yes',
			currently_valid: 'yes',
			reference_worthy: 'yes',
			note: '상세페이지 2시간 안내와 대조 확인',
		});
		expect(body).not.toHaveProperty('authorship');
		expect(body).not.toHaveProperty('reviewer');
		await waitFor(() => expect(screen.getByText(/작성 주체 분류는 변경되지 않음/)).toBeTruthy());
	});

	it('개선 추출의 조건·순서·범위와 승인 사본 대비 재검증 필요를 표시하고 승인 상태는 유지한다', async () => {
		const procedure = '혹은 이경우가 아니시라면 진한 갈색 염색법으로 변경하셔는 것도 좋으실 거 같습니다. 레드 2시간~길게는 3시간까지 그 후에 브라운 2시간~길게는 3시간까지 해주세요.';
		const approvedItem: KnowledgeQueueItem = {
			...ITEM,
			content_validation: 'APPROVED',
			reply_text: `만약에 이 경우시라면 위 제품을 중단해 주세요. ${procedure}`,
			revalidation_required: true,
			current_use_authority: 'REVALIDATION_REQUIRED',
			reply_reference_eligible: false,
			generator_fact_eligible: false,
			approved_retrieval_boost: false,
			fact_ineligible_reasons: ['REVALIDATION_REQUIRED', 'NO_UNIT_FACT_VALIDATION_RECORD'],
			extraction_version: 'knowhow_semantic_v2',
			extraction_change: {
				changes: ['CONDITION_RESTORED', 'SEQUENCE_RESTORED', 'NUMERIC_RANGE_RESTORED'],
				meaningChanged: true,
				oldVersion: 'knowhow_sentence_v1',
				newVersion: 'knowhow_semantic_v2',
				comparedWith: 'VALIDATION_SNAPSHOT',
			},
			previous_extraction: [{ sentence: '레드 2시간~' }, { sentence: '길게는 3시간까지 그 후에 브라운 2시간~' }],
			knowhow_items: [
				{
					sentence: procedure,
					originalText: procedure,
					sourceTextSpan: [27, 27 + procedure.length],
					knowledgeType: 'ORDERED_PROCEDURE',
					isKnowledgeCandidate: true,
					product: ['레드 헤나', '브라운 헤나'],
					condition: '혹은 이경우가 아니시라면 진한 갈색 염색법으로 변경하셔는 것도 좋으실 거 같습니다.',
					conditionReference: 'UNRESOLVED_REFERENCE',
					contextBefore: '만약에 이 경우시라면 위 제품을 중단해 주세요.',
					sequence: [
						{ order: 1, text: '레드 2시간~길게는 3시간', product: '레드 헤나', numeric: ['2시간~길게는 3시간'] },
						{ order: 2, text: '브라운 2시간~길게는 3시간', product: '브라운 헤나', numeric: ['2시간~길게는 3시간'] },
					],
					numericRange: [{ text: '2시간~길게는 3시간', min: 2, max: 3, unit: '시간', isRange: true }],
					limitation: [],
					topics: ['TIME'],
					facts: ['DURATION:2시간~길게는 3시간'],
					requires_current_fact_verification: true,
					current_validity: 'CONTENT_APPROVED_CURRENT',
					validationStatus: 'REVALIDATION_REQUIRED',
				},
				{
					sentence: '패치테스트 하셨을 때는 어떠셨나 모르겠습니다.',
					knowledgeType: 'QUESTION_OR_CONFIRMATION',
					isKnowledgeCandidate: false,
					topics: [],
					facts: [],
					requires_current_fact_verification: false,
					current_validity: 'NO_FACT_CLAIM',
					validationStatus: 'REVALIDATION_REQUIRED',
				},
			],
		};
		const api = makeApi(true);
		(api.get as any).mockImplementation(async (url: string) => {
			if (url.endsWith('/reviews/reply-knowledge/permission')) {
				return { data: { authenticated: true, can_validate: true, role: 'ops_admin', required_role: 'ops_admin' } };
			}
			if (url.endsWith('/reviews/reply-knowledge/summary')) {
				return {
					data: {
						total: 10, invalid: 2, valid: 8, authorship: {}, tiers: {}, content_validation_of_human_reference_tiers: { APPROVED: 1 },
						unknown_with_knowhow: 1, revalidation_required: 1, extraction_version: 'knowhow_semantic_v2',
						use_authority_scope_total: 279, reply_reference_eligible: 44, generator_fact_eligible: 0,
						use_authority_counts: { APPROVED_HISTORICAL_REFERENCE: 44, REVALIDATION_REQUIRED: 4, VALIDATION_HOLD: 2, EXTRACTED_KNOWLEDGE: 229, VALIDATED_KNOWLEDGE: 0 },
						retrieval_status: 'LEXICAL_RETRIEVAL_BASELINE', validation_write_enabled: true,
					},
				};
			}
			if (url.endsWith('/reviews/reply-knowledge/queue')) return { data: { total: 1, items: [approvedItem], validation_write_enabled: true } };
			return { data: approvedItem };
		});
		await openFirst(api);
		expect(screen.getByLabelText('knowledge-revalidation-count').textContent).toContain('재검증 필요 1건');
		expect(screen.getByLabelText('knowhow-unit-sequence').textContent).toBe('순서: 1) 레드 2시간~길게는 3시간 → 2) 브라운 2시간~길게는 3시간');
		expect(screen.getByLabelText('knowhow-unit-range').textContent).toContain('2시간~길게는 3시간');
		expect(screen.getByLabelText('knowhow-unit-condition').textContent).toContain('이경우가 아니시라면');
		expect(screen.getByLabelText('knowhow-unit-context').textContent).toContain('만약에 이 경우시라면');
		expect(screen.getByText('질문·확인 요청 문장이므로 제품 지식으로 사용하지 않습니다.')).toBeTruthy();
		const comparison = screen.getByLabelText('knowledge-extraction-comparison');
		expect(comparison.textContent).toContain('승인·보류 당시 저장된 추출 사본');
		expect(comparison.textContent).toContain('조건 추가·복원, 순서 복원, 숫자 범위 복원');
		expect(within(comparison).getByLabelText('knowledge-revalidation-required').textContent).toContain('취소되지 않습니다');
		expect(within(screen.getByLabelText('knowledge-content-validation')).getByText('내용 승인')).toBeTruthy();
		const counts = screen.getByLabelText('knowledge-use-authority-counts').textContent || '';
		expect(counts).toContain('과거 응대 참고 가능 44건');
		expect(counts).toContain('개별 전문 사실 검증 완료 0건');
		expect(counts).toContain('재검증 필요 4건');
		const authority = screen.getByLabelText('knowledge-use-authority').textContent || '';
		expect(authority).toContain('재검증 필요 (참고 가산점·사실 사용 차단)');
		expect(authority).toContain('응대 참고 불가');
		expect(authority).toContain('제품 사실 사용 불가');
		expect(authority).toContain('개별 전문 사실 검증 기록 없음');
		expect(api.post).not.toHaveBeenCalled();
	});

	it('저장 요청 중 승인 버튼을 연속 클릭해도 한 번만 전송한다', async () => {
		const api = makeApi(true);
		let release: (v: unknown) => void = () => undefined;
		api.post.mockImplementation(() => new Promise((resolve) => (release = resolve)) as any);
		await openFirst(api);
		await waitFor(() => expect((screen.getByLabelText('knowledge-validation-note') as HTMLTextAreaElement).disabled).toBe(false));
		fireEvent.change(screen.getByLabelText('knowledge-validation-note'), { target: { value: '상세페이지 2시간 안내와 대조 확인' } });
		for (const q of ['reply_appropriate', 'guidance_accurate', 'currently_valid', 'reference_worthy']) pick(q, 'yes');
		const approve = screen.getByRole('button', { name: '승인' });
		fireEvent.click(approve);
		fireEvent.click(approve);
		fireEvent.click(approve);
		expect(api.post).toHaveBeenCalledTimes(1);
		release({ data: { ok: true } });
		await waitFor(() => expect(screen.getByText(/작성 주체 분류는 변경되지 않음/)).toBeTruthy());
		expect(api.post).toHaveBeenCalledTimes(1);
	});

	it('개별 전문 안내를 등록된 공식 자료로만 독립 검증하고 연속 클릭은 한 번만 전송한다', async () => {
		const pendingFact = (key: string, aspects: string[]) => ({
			unitKey: key, status: 'PENDING', recordedStatus: null, resolution: 'NO_RECORD', applicableAspects: aspects,
			historyCount: 0, staleHistoryCount: 0, latest: null,
		});
		const unitItem: KnowledgeQueueItem = {
			...ITEM,
			reply_text: '헤어팩은 1시간 정도 두셨다가 헹궈 주세요. 진한 갈색을 원하신다면 레드 2시간 후에 브라운 2시간 염색하시면 됩니다.',
			knowhow_items: [
				{
					sentence: '헤어팩은 1시간 정도 두셨다가 헹궈 주세요.', originalText: '헤어팩은 1시간 정도 두셨다가 헹궈 주세요.', sourceTextSpan: [0, 24],
					knowledgeType: 'NUMERIC_GUIDANCE', isKnowledgeCandidate: true, product: ['헤어팩'], condition: 'UNKNOWN', sequence: [],
					numericRange: [{ text: '1시간', min: 1, max: 1, unit: '시간', isRange: false }], topics: ['TIME'], facts: ['DURATION:1시간'],
					requires_current_fact_verification: true, current_validity: 'UNVERIFIED_REQUIRES_CURRENT_FACT_CHECK',
					factValidation: pendingFact('ruf:pack', ['statement', 'product', 'numeric']), generatorFactEligible: false,
					factUseBlockedReasons: ['UNIT_FACT_NOT_VERIFIED'],
				},
				{
					sentence: '진한 갈색을 원하신다면 레드 2시간 후에 브라운 2시간 염색하시면 됩니다.',
					originalText: '진한 갈색을 원하신다면 레드 2시간 후에 브라운 2시간 염색하시면 됩니다.', sourceTextSpan: [25, 66],
					knowledgeType: 'ORDERED_PROCEDURE', isKnowledgeCandidate: true, product: ['레드 헤나', '브라운 헤나'], condition: '진한 갈색을 원하신다면',
					sequence: [{ order: 1, text: '레드 2시간', product: '레드 헤나', numeric: ['2시간'] }, { order: 2, text: '브라운 2시간', product: '브라운 헤나', numeric: ['2시간'] }],
					numericRange: [{ text: '2시간', min: 2, max: 2, unit: '시간', isRange: false }], topics: ['TIME'], facts: ['DURATION:2시간'],
					requires_current_fact_verification: true, current_validity: 'UNVERIFIED_REQUIRES_CURRENT_FACT_CHECK',
					factValidation: pendingFact('ruf:seq', ['statement', 'product', 'condition', 'sequence', 'numeric']), generatorFactEligible: false,
					factUseBlockedReasons: ['UNIT_FACT_NOT_VERIFIED'],
				},
			],
			unit_fact_history: [
				{
					unit_fact_validation_id: 'h1', unit_key: 'ruf:seq', unit_text: '진한 갈색을 원하신다면 레드 2시간 후에', fact_status: 'HOLD',
					hold_reason: 'FACT_VALIDATION_SOURCE_MISSING', verified_scope: null, evidence: [], note: '순서 공식 근거 없음',
					reviewer_email: 'ops_admin@example.com', reviewer_role: 'ops_admin', extraction_version: 'knowhow_semantic_v2', created_at: '2026-10-09T10:00:00',
				},
			],
		};
		const sources = {
			registry_version: 'official_fact_source_registry_v1',
			verifying_entry_count: 12,
			sources: [
				{
					source_id: 'usage_guide_source_v1', version: 'usage_guide_source_v1', authority_class: 'OFFICIAL_PRODUCT_GUIDE', status: 'ACTIVE', can_verify: true,
					entries: [
						{ entry_key: 'duration:pack', kind: 'duration', statement: '헤어팩 사용 시간: 1시간', products: ['헤어팩'], aspects: ['statement', 'product', 'numeric'] },
						{ entry_key: 'duration:dye', kind: 'duration', statement: '염색약 사용 시간: 2시간', products: ['레드 헤나', '브라운 헤나'], aspects: ['statement', 'product', 'numeric'] },
						{ entry_key: 'mix:quiz-dependent', kind: 'restriction', statement: '배합 비율 일반화 금지', products: ['레드 헤나'], aspects: [] },
						{
							entry_key: 'html:sequence:dark_brown', kind: 'sequence', statement: '1차 레드 도포 후 헹구고, 2차 브라운을 다시 도포하세요.',
							products: ['레드 헤나', '브라운 헤나'], aspects: ['statement', 'product', 'sequence'], can_verify: false, source_fidelity_status: 'PASS',
							current_applicability: { status: 'CURRENT_APPLICABILITY_UNVERIFIED', products: [], review_id: null },
						},
						{
							entry_key: 'opc:standard:sequential', kind: 'sequence_duration', statement: '레드 후 브라운 순차 사용: 레드 2시간, 브라운 2시간',
							products: ['레드 헤나', '브라운 헤나'], aspects: ['statement', 'product', 'sequence', 'numeric'], can_verify: true,
							application_modes: ['sequential'], source_fidelity_status: 'PASS',
							current_applicability: { status: 'CURRENT_APPLICABILITY_VERIFIED', products: ['레드 헤나', '브라운 헤나'], review_id: 'GBR-1' },
						},
						{
							entry_key: 'opc:adjust:insufficient', kind: 'conditional_duration', statement: '염색이 잘되지 않는 경우에는 2시간에서 3시간까지',
							products: ['레드 헤나', '브라운 헤나'], aspects: ['statement', 'product', 'numeric', 'condition'], can_verify: true,
							condition: '염색이 잘되지 않는 경우', condition_required: true, application_modes: ['single', 'mixed'], source_fidelity_status: 'PASS',
							current_applicability: { status: 'CURRENT_APPLICABILITY_VERIFIED', products: ['레드 헤나', '브라운 헤나'], review_id: 'GBR-1' },
						},
					],
				},
				{ source_id: 'henna_category_pack_v1', version: 'v1', authority_class: 'CATEGORY_RESEARCH', status: 'CANDIDATE_ONLY', can_verify: false,
					entries: [{ entry_key: 'c1', kind: 'duration', statement: '카테고리 헤나 시간', products: ['헤어팩'], aspects: ['statement'] }] },
			],
		};
		const api = makeApi(true);
		(api.get as any).mockImplementation(async (url: string) => {
			if (url.endsWith('/reviews/reply-knowledge/permission')) return { data: { authenticated: true, can_validate: true, role: 'ops_admin', required_role: 'ops_admin' } };
			if (url.endsWith('/reviews/reply-knowledge/official-sources')) return { data: sources };
			if (url.endsWith('/reviews/reply-knowledge/summary')) {
				return {
					data: {
						total: 10, invalid: 2, valid: 8, authorship: {}, tiers: {}, content_validation_of_human_reference_tiers: {}, unknown_with_knowhow: 1,
						retrieval_status: 'LEXICAL_RETRIEVAL_BASELINE', validation_write_enabled: true, unit_fact_scope_units: 299,
						unit_fact_status_counts: { PENDING: 299, VERIFIED: 0, HOLD: 0, REJECTED: 0, OUTDATED: 0 }, unit_generator_fact_eligible: 0,
					},
				};
			}
			if (url.endsWith('/reviews/reply-knowledge/queue')) return { data: { total: 1, items: [unitItem], validation_write_enabled: true } };
			return { data: unitItem };
		});
		let release: (v: unknown) => void = () => undefined;
		api.post.mockImplementation(() => new Promise((resolve) => (release = resolve)) as any);
		await openFirst(api);
		const counts = screen.getByLabelText('unit-fact-counts').textContent || '';
		expect(counts).toContain('개별 전문 안내 299개');
		expect(counts).toContain('공식 근거로 확인 0개');
		expect(counts).toContain('생성기 사실 사용 가능 0개');
		const statuses = screen.getAllByLabelText('unit-fact-status').map((el) => el.textContent || '');
		expect(statuses).toHaveLength(2);
		statuses.forEach((t) => {
			expect(t).toContain('사실 검증 대기');
			expect(t).toContain('생성기 사실 사용 불가');
		});
		expect(screen.getByLabelText('unit-fact-history').textContent).toContain('등록된 공식 근거 없음');

		const toggles = screen.getAllByLabelText('unit-fact-form-toggle') as [HTMLElement, HTMLElement];
		fireEvent.click(toggles[1]);
		const seqForm = screen.getByLabelText('unit-fact-form');
		expect(within(seqForm).getByLabelText('evidence-duration:dye')).toBeTruthy();
		expect(within(seqForm).queryByLabelText('evidence-mix:quiz-dependent')).toBeNull();
		expect(within(seqForm).queryByLabelText('evidence-c1')).toBeNull();
		expect(within(seqForm).getByText(/근거 범위 statement, product, numeric$/)).toBeTruthy();
		expect(within(seqForm).queryByLabelText('evidence-html:sequence:dark_brown')).toBeNull();
		expect(within(seqForm).getByLabelText('unit-fact-unverified-sources').textContent).toContain('CURRENT_APPLICABILITY_UNVERIFIED');
		expect(within(seqForm).getByLabelText('evidence-opc:standard:sequential').parentElement?.textContent).toContain('사용 방식: 순차');
		expect(within(seqForm).getByLabelText('evidence-opc:adjust:insufficient').parentElement?.textContent).toContain('적용 조건: 염색이 잘되지 않는 경우 (필수)');
		fireEvent.click(toggles[1]);

		fireEvent.click(toggles[0]);
		const form = screen.getByLabelText('unit-fact-form');
		expect(within(form).getByText(/적용 조건이 정확한가요\? 해당 없음/)).toBeTruthy();
		const verify = within(form).getByRole('button', { name: '공식 근거로 확인' }) as HTMLButtonElement;
		expect(verify.disabled).toBe(true);
		for (const f of ['statement_accurate', 'product_applicable', 'numeric_accurate', 'generator_reference_allowed']) {
			fireEvent.click(within(form).getByLabelText(`${f}-yes`));
		}
		fireEvent.change(within(form).getByLabelText('unit-fact-verified-scope'), { target: { value: '헤어팩 사용 시간 1시간만 확인' } });
		fireEvent.change(within(form).getByLabelText('unit-fact-note'), { target: { value: '공식 가이드 duration:pack 대조' } });
		expect(verify.disabled).toBe(true);
		fireEvent.click(within(form).getByLabelText('evidence-duration:pack'));
		expect(verify.disabled).toBe(false);
		fireEvent.click(verify);
		fireEvent.click(verify);
		expect(api.post).toHaveBeenCalledTimes(1);
		const [url, body] = api.post.mock.calls[0] as unknown as [string, Record<string, any>];
		expect(url).toBe('http://api/reviews/reply-knowledge/unit-fact-validations');
		expect(body).toMatchObject({
			knowledge_id: ITEM.knowledge_id,
			unit_key: 'ruf:pack',
			fact_status: 'VERIFIED',
			statement_accurate: 'yes',
			product_applicable: 'yes',
			numeric_accurate: 'yes',
			generator_reference_allowed: 'yes',
			verified_scope: '헤어팩 사용 시간 1시간만 확인',
			evidence: [{ source_id: 'usage_guide_source_v1', entry_key: 'duration:pack', covers: ['statement', 'product', 'numeric'] }],
		});
		expect(body).not.toHaveProperty('sequence_accurate');
		expect(JSON.stringify(body.evidence)).not.toMatch(/url|excerpt/);
		release({ data: { ok: true } });
		await waitFor(() => expect(screen.getByLabelText('unit-fact-message').textContent).toContain('다른 항목·답글 승인·작성 주체는 변경되지 않음'));
		expect(api.post).toHaveBeenCalledTimes(1);
	});
});

const DYES = ['레드 헤나', '브라운 헤나'];
const gbItem = (over: Record<string, unknown>) => ({
	source_id: 'sujata_usage_guide_html', source_version: 'v2', kind: 'ratio', original_text: '원문', source_location: null,
	products: DYES, product_skus: { '레드 헤나': ['s1', 's2'], '브라운 헤나': ['s1'] }, application_modes: ['mixed'], condition: null,
	numeric_tokens: ['1:1|RATIO'], limitation: [], gate_a_status: 'PASS',
	current_applicability: { status: 'CURRENT_APPLICABILITY_UNVERIFIED', products: [], review_id: null, origin: null },
	entry_state: 'PENDING', by_product: { '레드 헤나': { state: 'PENDING', origin: null }, '브라운 헤나': { state: 'PENDING', origin: null } },
	latest_record_id: null, legacy: null, priority: 'P1', topic: 'RED_BROWN_RATIO', history: [],
	audit_template: {
		basis_type: 'ADMIN_DIRECT_CURRENT_APPLICABILITY_CONFIRMATION', basis_type_label: '관리자 직접 확인 (선택 제품의 현재 적용성)',
		gate_a_reference: `Gate A PASS · sujata_usage_guide_html · 버전 v2 · sha256 0123456789abcdef · ${String(over.entry_key)} · 진단 추천 배합 offset 10`,
		scope_text: '사용 방식: 혼합 · 조건: 원문에 별도 기재 없음 · 수치: 1:1|RATIO · 순서: 원문에 별도 기재 없음 · 원문: 레드:브라운 = 5:5',
		source_limitation_text: '원문에 별도 기재 없음', current_guidance_note: 'G0(2026-10-10 운영자 확인): 공식 사용가이드 현재 고객 안내 자료',
	},
	...over,
});
// Shared with api/test_review_reply_knowledge_unit_facts.py (GB_PREVIEW_TEMPLATE / GB_PREVIEW_EXPECTED).
const GB_PREVIEW_TEMPLATE = {
	basis_type: 'ADMIN_DIRECT_CURRENT_APPLICABILITY_CONFIRMATION', basis_type_label: '관리자 직접 확인 (선택 제품의 현재 적용성)',
	gate_a_reference: 'Gate A PASS · guide · 버전 v2 · sha256 abcd · html:x · STEP offset 1',
	scope_text: '사용 방식: 순차 · 조건: 원문에 별도 기재 없음 · 수치: 2|HOUR · 순서: 원문에 별도 기재 없음 · 원문: 원문 문장',
	source_limitation_text: '원문에 별도 기재 없음', current_guidance_note: 'G0 참고',
};
const GB_PREVIEW_EXPECTED = {
	basis_summary: 'Gate B 관리자 직접 확인 · 결정: 승인 · 선택 제품: 레드 헤나, 브라운 헤나 · 확인: 예, 현재도 선택한 제품에 적용합니다 · 참고(항목 승인 근거 아님): G0 참고',
	approved_fact_scope: '제품: 레드 헤나, 브라운 헤나 · 사용 방식: 순차 · 조건: 원문에 별도 기재 없음 · 수치: 2|HOUR · 순서: 원문에 별도 기재 없음 · 원문: 원문 문장',
	limitations_exceptions: '공식 원문 기재 제한: 원문에 별도 기재 없음 / 관리자 추가 확인 예외: 두피 질환 시 사용 중단',
};
const GB_DATA = {
	summary: { total: 4, queue_total: 61, by_priority: { P1: 14, P2: 16, P3: 31 }, by_entry_state: { PENDING: 3, APPROVED_LEGACY: 1 }, usable_entries: 1 },
	questions: {
		product_applicable: '현재 해당 제품에 적용 가능한가', usage_accurate: '현재 사용법·조건·수치·순서가 정확한가', exceptions_checked: '제품별 제한·예외를 확인했는가',
		scope_clear: '적용 범위가 명확한가', company_standard_confirmed: '회사가 현재 인정하는 사용 기준이라는 근거가 있는가',
	},
	basis_types: { ADMIN_DIRECT_CURRENT_APPLICABILITY_CONFIRMATION: '관리자 직접 확인 (선택 제품의 현재 적용성)', OFFICIAL_GUIDE_CURRENT: '현재 공식 가이드' },
	confirmations: { CONFIRMED_CURRENT_STANDARD: '예, 현재도 선택한 제품에 적용합니다', NEEDS_CHECK: '추가 확인이 필요합니다', NOT_APPLICABLE: '현재는 선택한 제품에 적용하지 않습니다' },
	decision_confirmations: { APPROVED: ['CONFIRMED_CURRENT_STANDARD'], HOLD: ['NEEDS_CHECK', 'NOT_APPLICABLE'], EXCLUDED: ['NOT_APPLICABLE'], REVOKED: ['NEEDS_CHECK', 'NOT_APPLICABLE'] },
	items: [
		gbItem({ entry_key: 'html:ratio:red_brown', original_text: '레드:브라운 = 5:5' }),
		gbItem({ entry_key: 'html:step:01', priority: 'P2', kind: 'procedure_step', original_text: '단계 1' }),
		gbItem({ entry_key: 'html:product:수자타 내추럴', priority: 'P3', kind: 'variant', products: [], product_skus: {}, by_product: { _entry: { state: 'PENDING', origin: null } } }),
		gbItem({
			source_id: 'operator_confirmed_usage_guidance', entry_key: 'opc:standard:red-single', priority: null, kind: 'duration', products: ['레드 헤나'],
			entry_state: 'APPROVED_LEGACY', by_product: { '레드 헤나': { state: 'APPROVED_LEGACY', origin: 'LEGACY_OPERATOR_ATTESTATION', review_id: 'GBR-20261009-2122' } },
			current_applicability: { status: 'CURRENT_APPLICABILITY_VERIFIED', products: ['레드 헤나'], review_id: 'GBR-20261009-2122', origin: 'LEGACY_OPERATOR_ATTESTATION' },
			legacy: { origin: 'LEGACY_OPERATOR_ATTESTATION', review_id: 'GBR-20261009-2122', products: ['레드 헤나'], confirmed_by: 'operator', confirmed_at: '2026-10-09' },
		}),
	],
};

function gateBApi(canValidate: boolean, data: unknown = GB_DATA) {
	const api = makeApi(true, canValidate);
	const base = api.get.getMockImplementation()!;
	api.get.mockImplementation(async (url: string) => {
		if (url.endsWith('/reviews/reply-knowledge/source-applicability')) return { data } as any;
		return base(url);
	});
	return api;
}

const PACK_PRODUCTS = ['레드 헤나', '브라운 헤나', '헤어팩'];
const GB_APPROVED_AT = '2026-10-10T09:01:40.326064+00:00';
const GB_REVOKED_AT = '2026-10-10T09:41:54.893600+00:00';
const gbApproved = () => ({ state: 'APPROVED', origin: 'GATE_B_REVIEW', record_id: 'gbr-a', decision: 'APPROVED', created_at: GB_APPROVED_AT });
const GB_PARTIAL_DATA = {
	...GB_DATA,
	items: [
		gbItem({
			entry_key: 'html:faq:first-use', kind: 'faq', original_text: '처음 사용하시는 경우 피부 패치 테스트와 모발 테스트를 권장합니다.', products: PACK_PRODUCTS,
			product_skus: {}, entry_state: 'PARTIALLY_APPROVED', latest_record_id: 'gbr-r',
			by_product: {
				'레드 헤나': gbApproved(),
				'브라운 헤나': gbApproved(),
				헤어팩: { state: 'REVOKED', origin: 'GATE_B_REVIEW', record_id: 'gbr-r', decision: 'REVOKED', created_at: GB_REVOKED_AT },
			},
			current_applicability: { status: 'CURRENT_APPLICABILITY_VERIFIED', products: DYES, review_id: null, origin: 'GATE_B_REVIEW' },
			history: [
				{ applicability_id: 'gbr-a', decision: 'APPROVED', products: PACK_PRODUCTS, skus: [], note: '', created_at: GB_APPROVED_AT },
				{ applicability_id: 'gbr-r', decision: 'REVOKED', products: ['헤어팩'], skus: [], note: '헤어팩 승인 범위 정정', created_at: GB_REVOKED_AT },
			],
		}),
		GB_DATA.items[3],
	],
};
const sourceApplicabilityGets = (api: ReturnType<typeof gateBApi>) =>
	api.get.mock.calls.filter((c) => String(c[0]).endsWith('/reviews/reply-knowledge/source-applicability')).length;

const renderGateB = async (api: ReturnType<typeof gateBApi>) => {
	render(<ReviewKnowledgeValidationPanel apiBaseUrl="http://api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} />);
	await waitFor(() => expect(screen.getByLabelText('gate-b-summary')).toBeTruthy());
	return screen.getByLabelText('gate-b-section');
};

describe('Gate B 공식 가이드 현재 적용성 확인', () => {
	it('답글 검증과 분리된 영역에 P1부터 표시하고 조회 전용 사용자는 저장할 수 없다', async () => {
		const api = gateBApi(false);
		const section = await renderGateB(api);
		expect(within(section).getByLabelText('gate-b-summary').textContent).toContain('P1 0014 · P2 0016 · P3 0031');
		expect(within(section).getByLabelText('gate-b-readonly')).toBeTruthy();
		const rows = within(within(section).getByLabelText('gate-b-list')).getAllByRole('button').map((b) => b.textContent || '');
		expect(rows[0]!.startsWith('Q5 [P1] html:ratio:red_brown')).toBe(true);
		expect(rows).toHaveLength(4);
		expect(within(within(section).getByLabelText('gate-b-list')).getAllByLabelText('gate-b-list-qn').map((q) => q.textContent)).toEqual(['Q5']);
		fireEvent.change(within(section).getByLabelText('gate-b-priority-filter'), { target: { value: 'P2' } });
		expect(within(within(section).getByLabelText('gate-b-list')).getAllByRole('button').map((b) => b.textContent)).toEqual(['[P2] html:step:01 · Gate A 통과 · 미확인 (근거 사용 불가)']);
		fireEvent.change(within(section).getByLabelText('gate-b-priority-filter'), { target: { value: 'OTHER' } });
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getByRole('button'));
		expect(within(section).getByLabelText('gate-b-legacy').textContent).toContain('로그인 검증 기록이 아니며');
		const form = within(section).getByLabelText('gate-b-form');
		for (const d of ['APPROVED', 'HOLD', 'EXCLUDED', 'REVOKED']) {
			expect((within(form).getByLabelText(`gate-b-decision-${d}`) as HTMLButtonElement).disabled).toBe(true);
		}
		expect((within(form).getByLabelText('gate-b-save') as HTMLButtonElement).disabled).toBe(true);
		expect(api.post).not.toHaveBeenCalled();
	});

	it('수동 근거 입력 없이 명시적 확인 후 미리보기를 보고 승인하며, 서버 작성 필드와 검증자 정보는 보내지 않는다', async () => {
		const api = gateBApi(true);
		let release: (v: unknown) => void = () => undefined;
		api.post.mockImplementation(() => new Promise((resolve) => (release = resolve)) as any);
		const section = await renderGateB(api);
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getAllByRole('button')[0]!);
		const form = within(section).getByLabelText('gate-b-form');
		for (const removed of ['gate-b-basis-type', 'gate-b-basis-reference', 'gate-b-basis-summary', 'gate-b-approved-scope', 'gate-b-limitations']) {
			expect(within(form).queryByLabelText(removed)).toBeNull();
		}
		for (const text of Object.values(GB_DATA.questions)) expect(within(form).getByLabelText('gate-b-confirmation-scope').textContent).toContain(text);
		const approve = within(form).getByLabelText('gate-b-decision-APPROVED') as HTMLButtonElement;
		const save = within(form).getByLabelText('gate-b-save') as HTMLButtonElement;
		fireEvent.click(within(form).getByLabelText('gate-b-product-레드 헤나'));
		expect(approve.disabled).toBe(true);
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-NEEDS_CHECK'));
		expect(approve.disabled).toBe(true);
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-CONFIRMED_CURRENT_STANDARD'));
		expect(approve.disabled).toBe(false);
		expect((within(form).getByLabelText('gate-b-decision-HOLD') as HTMLButtonElement).disabled).toBe(true);
		expect((within(form).getByLabelText('gate-b-decision-REVOKED') as HTMLButtonElement).disabled).toBe(true);
		expect(save.disabled).toBe(true);
		fireEvent.click(approve);
		const preview = within(form).getByLabelText('gate-b-preview');
		expect(within(preview).getByLabelText('gate-b-preview-gate-a').textContent).toContain('Gate A PASS · sujata_usage_guide_html · 버전 v2 · sha256 0123456789abcdef · html:ratio:red_brown');
		expect(within(preview).getByLabelText('gate-b-preview-gate-b').textContent).toContain('결정: 승인 · 선택 제품: 레드 헤나 · 확인: 예, 현재도 선택한 제품에 적용합니다');
		expect(within(preview).getByLabelText('gate-b-preview-gate-b').textContent).toContain('참고(항목 승인 근거 아님): G0');
		expect(within(preview).getByLabelText('gate-b-preview-scope').textContent).toContain('제품: 레드 헤나 · 사용 방식: 혼합 · 조건: 원문에 별도 기재 없음 · 수치: 1:1|RATIO');
		expect(within(preview).getByLabelText('gate-b-preview-limitations').textContent).toContain('공식 원문 기재 제한: 원문에 별도 기재 없음 / 관리자 추가 확인 예외: 입력 없음');
		expect(preview.textContent).not.toContain('제한 없음');
		fireEvent.change(within(form).getByLabelText('gate-b-admin-exceptions'), { target: { value: '두피 질환 시 사용 중단' } });
		expect(within(preview).getByLabelText('gate-b-preview-limitations').textContent).toContain('관리자 추가 확인 예외: 두피 질환 시 사용 중단');
		expect(save.disabled).toBe(false);
		fireEvent.click(within(form).getByLabelText('gate-b-sku-s2'));
		fireEvent.click(save);
		fireEvent.click(save);
		expect(api.post).toHaveBeenCalledTimes(1);
		const [url, body] = api.post.mock.calls[0] as unknown as [string, Record<string, any>];
		expect(url).toBe('http://api/reviews/reply-knowledge/source-applicability');
		expect(body).toMatchObject({
			source_id: 'sujata_usage_guide_html', entry_key: 'html:ratio:red_brown', decision: 'APPROVED', products: ['레드 헤나'], skus: ['s2'],
			expected_latest_record_id: null, current_applicability_confirmation: 'CONFIRMED_CURRENT_STANDARD', admin_confirmed_exceptions: '두피 질환 시 사용 중단', note: '',
		});
		expect(body.request_id).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
		for (const forbidden of [
			'reviewer', 'reviewer_email', 'reviewer_uid', 'reviewer_role', 'condition', 'numeric_tokens', 'application_modes',
			'basis_type', 'basis_reference', 'basis_summary', 'approved_fact_scope', 'limitations_exceptions', ...Object.keys(GB_DATA.questions),
		]) {
			expect(body).not.toHaveProperty(forbidden);
		}
		expect(body).not.toHaveProperty('reverification_reason');
		expect(within(form).queryByLabelText('gate-b-duplicate-warning')).toBeNull();
		release({ data: { ok: true } });
		await waitFor(() => expect(within(section).getByLabelText('gate-b-message').textContent).toContain('선택한 제품에만 적용'));
		expect(api.post).toHaveBeenCalledTimes(1);
	});

	it('보류·제외는 판단 사유가 필수이고 확인 값과 맞는 결정만 고를 수 있다', async () => {
		const api = gateBApi(true);
		const section = await renderGateB(api);
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getAllByRole('button')[0]!);
		const form = within(section).getByLabelText('gate-b-form');
		const save = within(form).getByLabelText('gate-b-save') as HTMLButtonElement;
		fireEvent.click(within(form).getByLabelText('gate-b-product-브라운 헤나'));
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-NEEDS_CHECK'));
		expect((within(form).getByLabelText('gate-b-decision-APPROVED') as HTMLButtonElement).disabled).toBe(true);
		expect((within(form).getByLabelText('gate-b-decision-EXCLUDED') as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(within(form).getByLabelText('gate-b-decision-HOLD'));
		expect(within(form).queryByLabelText('gate-b-admin-exceptions')).toBeNull();
		expect(within(form).queryByLabelText('gate-b-preview-scope')).toBeNull();
		expect(save.disabled).toBe(true);
		fireEvent.change(within(form).getByLabelText('gate-b-note'), { target: { value: '짧음' } });
		expect(save.disabled).toBe(true);
		fireEvent.change(within(form).getByLabelText('gate-b-note'), { target: { value: '현재 안내 기준 변경 확인' } });
		expect(save.disabled).toBe(false);
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-NOT_APPLICABLE'));
		fireEvent.click(within(form).getByLabelText('gate-b-decision-EXCLUDED'));
		expect(within(form).getByLabelText('gate-b-preview-gate-b').textContent).toContain('결정: 제외');
		fireEvent.click(save);
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
		const body = (api.post.mock.calls[0] as unknown as [string, Record<string, any>])[1];
		expect(body).toMatchObject({ decision: 'EXCLUDED', products: ['브라운 헤나'], current_applicability_confirmation: 'NOT_APPLICABLE', note: '현재 안내 기준 변경 확인' });
		expect(body).not.toHaveProperty('admin_confirmed_exceptions');
	});

	it('제품 범위가 없는 항목은 승인할 수 없고 보류만 기록한다', async () => {
		const api = gateBApi(true);
		const section = await renderGateB(api);
		fireEvent.change(within(section).getByLabelText('gate-b-priority-filter'), { target: { value: 'P3' } });
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getByRole('button'));
		const form = within(section).getByLabelText('gate-b-form');
		expect(within(form).getByText(/제품정보 DB에 없다는 이유만으로 단종/)).toBeTruthy();
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-CONFIRMED_CURRENT_STANDARD'));
		expect((within(form).getByLabelText('gate-b-decision-APPROVED') as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-NEEDS_CHECK'));
		fireEvent.click(within(form).getByLabelText('gate-b-decision-HOLD'));
		expect(within(form).getByLabelText('gate-b-preview-gate-b').textContent).toContain('선택 제품: 항목 단위');
		fireEvent.change(within(form).getByLabelText('gate-b-note'), { target: { value: '현행 제품 확인 필요' } });
		fireEvent.click(within(form).getByLabelText('gate-b-save'));
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
		expect((api.post.mock.calls[0] as unknown as [string, Record<string, any>])[1]).toMatchObject({ decision: 'HOLD', products: [], current_applicability_confirmation: 'NEEDS_CHECK' });
	});

	it('과거 운영자 확인 항목의 승인 철회는 사유가 필수이고 적용 확인 없이도 기록할 수 있다', async () => {
		const api = gateBApi(true);
		const section = await renderGateB(api);
		fireEvent.change(within(section).getByLabelText('gate-b-priority-filter'), { target: { value: 'OTHER' } });
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getByRole('button'));
		const form = within(section).getByLabelText('gate-b-form');
		fireEvent.click(within(form).getByLabelText('gate-b-product-레드 헤나'));
		const revoke = within(form).getByLabelText('gate-b-decision-REVOKED') as HTMLButtonElement;
		expect(revoke.disabled).toBe(false);
		fireEvent.click(revoke);
		expect(within(form).getByLabelText('gate-b-preview-gate-b').textContent).toContain('확인: 해당 없음(승인 철회)');
		expect((within(form).getByLabelText('gate-b-save') as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(within(form).getByLabelText('gate-b-note'), { target: { value: '운영 기준 변경 확인' } });
		fireEvent.click(within(form).getByLabelText('gate-b-save'));
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
		const body = (api.post.mock.calls[0] as unknown as [string, Record<string, any>])[1];
		expect(body).toMatchObject({ decision: 'REVOKED', products: ['레드 헤나'], source_id: 'operator_confirmed_usage_guidance' });
		expect(body).not.toHaveProperty('current_applicability_confirmation');
	});

	it('저장된 제품별 상태를 표와 한국 시간으로 보여 주고, 체크박스는 새 판단 대상으로만 쓴다', async () => {
		const api = gateBApi(true, GB_PARTIAL_DATA);
		const section = await renderGateB(api);
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getAllByRole('button')[0]!);
		const table = within(section).getByLabelText('gate-b-current-state');
		const row = (p: string) => within(table).getByLabelText(`gate-b-state-row-${p}`).textContent || '';
		expect(row('레드 헤나')).toContain('승인됨');
		expect(row('레드 헤나')).toContain('2026-10-10 18:01:40 KST');
		expect(row('브라운 헤나')).toContain('승인됨');
		expect(row('헤어팩')).toContain('승인 철회');
		expect(row('헤어팩')).toContain('2026-10-10 18:41:54 KST');
		expect(row('헤어팩')).toContain('로그인 관리자 승인 철회');
		expect(within(section).getByLabelText('gate-b-history').textContent).toContain('2026-10-10 18:41:54 KST · 승인 철회 · 헤어팩');
		const form = within(section).getByLabelText('gate-b-form');
		expect(within(form).getByText('새 판단 기록 — 변경할 제품 선택')).toBeTruthy();
		const current = within(form).getByLabelText('gate-b-current-item').textContent || '';
		expect(current).toContain('[P1] html:faq:first-use');
		expect(current).toContain('처음 사용하시는 경우 피부 패치 테스트');
		for (const p of PACK_PRODUCTS) expect((within(form).getByLabelText(`gate-b-product-${p}`) as HTMLInputElement).checked).toBe(false);
		expect(within(form).getByLabelText('gate-b-products').textContent).toContain('레드 헤나 (현재: 승인됨)');
		expect(row('레드 헤나')).toContain('승인됨');

		fireEvent.change(within(section).getByLabelText('gate-b-priority-filter'), { target: { value: 'OTHER' } });
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getByRole('button'));
		expect(within(section).getByLabelText('gate-b-state-row-레드 헤나').textContent).toContain('과거 운영자 확인 (GBR-20261009-2122)');
		expect(api.post).not.toHaveBeenCalled();
	});

	it('이미 승인된 제품의 재승인은 재검증 사유가 있어야 저장되고, 사유는 판단 메모에만 기록된다', async () => {
		const api = gateBApi(true, GB_PARTIAL_DATA);
		const section = await renderGateB(api);
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getAllByRole('button')[0]!);
		const form = within(section).getByLabelText('gate-b-form');
		const save = within(form).getByLabelText('gate-b-save') as HTMLButtonElement;
		fireEvent.click(within(form).getByLabelText('gate-b-product-레드 헤나'));
		fireEvent.click(within(form).getByLabelText('gate-b-product-헤어팩'));
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-CONFIRMED_CURRENT_STANDARD'));
		fireEvent.click(within(form).getByLabelText('gate-b-decision-APPROVED'));
		const warning = within(form).getByLabelText('gate-b-duplicate-warning');
		expect(warning.textContent).toContain('레드 헤나: 이미 승인됨 (2026-10-10 18:01:40 KST)');
		expect(warning.textContent).not.toContain('브라운 헤나');
		expect(within(warning).getByLabelText('gate-b-reverification-scope').textContent).toBe(
			'재검증 사유 적용 제품: 레드 헤나 · 처음 승인되는 제품(사유 불필요): 헤어팩',
		);
		expect(save.disabled).toBe(true);
		fireEvent.change(within(form).getByLabelText('gate-b-reverification-reason'), { target: { value: '짧은 사유' } });
		expect(save.disabled).toBe(true);
		const reason = '회사 기준 문서 재확인 결과 동일함';
		fireEvent.change(within(form).getByLabelText('gate-b-reverification-reason'), { target: { value: reason } });
		expect(save.disabled).toBe(false);
		const preview = within(form).getByLabelText('gate-b-preview');
		expect(within(preview).getByLabelText('gate-b-preview-note').textContent).toBe(`판단 메모: [재검증: 레드 헤나] 사유: ${reason}`);
		expect(within(preview).getByLabelText('gate-b-preview-gate-b').textContent).not.toContain('재검증');
		expect(within(preview).getByLabelText('gate-b-preview-scope').textContent).not.toContain('재검증');
		const before = sourceApplicabilityGets(api);
		fireEvent.click(save);
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
		const body = (api.post.mock.calls[0] as unknown as [string, Record<string, any>])[1];
		expect(body).toMatchObject({ decision: 'APPROVED', products: ['레드 헤나', '헤어팩'], reverification_reason: reason, note: '' });
		await waitFor(() => expect(sourceApplicabilityGets(api)).toBe(before + 1));
	});

	it('승인된 제품도 선택해 철회할 수 있고 철회에는 재검증 사유를 요구하지 않는다', async () => {
		const api = gateBApi(true, GB_PARTIAL_DATA);
		const section = await renderGateB(api);
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getAllByRole('button')[0]!);
		const form = within(section).getByLabelText('gate-b-form');
		fireEvent.click(within(form).getByLabelText('gate-b-product-브라운 헤나'));
		fireEvent.click(within(form).getByLabelText('gate-b-decision-REVOKED'));
		expect(within(form).queryByLabelText('gate-b-duplicate-warning')).toBeNull();
		fireEvent.change(within(form).getByLabelText('gate-b-note'), { target: { value: '브라운 적용 재확인 필요' } });
		fireEvent.click(within(form).getByLabelText('gate-b-save'));
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
		const body = (api.post.mock.calls[0] as unknown as [string, Record<string, any>])[1];
		expect(body).toMatchObject({ decision: 'REVOKED', products: ['브라운 헤나'], expected_latest_record_id: 'gbr-r' });
		expect(body).not.toHaveProperty('reverification_reason');
	});

	it('서버가 중복 승인을 거부하면 이미 승인된 제품과 승인 시각을 한국 시간으로 안내한다', async () => {
		const api = gateBApi(true);
		api.post.mockRejectedValue({
			response: {
				status: 409,
				data: { detail: { code: 'GATE_B_DUPLICATE_APPROVAL', detail: { products: [{ product: '레드 헤나', approved_at: GB_APPROVED_AT, record_id: 'gbr-a' }] } } },
			},
		});
		const section = await renderGateB(api);
		fireEvent.click(within(within(section).getByLabelText('gate-b-list')).getAllByRole('button')[0]!);
		const form = within(section).getByLabelText('gate-b-form');
		fireEvent.click(within(form).getByLabelText('gate-b-product-레드 헤나'));
		fireEvent.click(within(form).getByLabelText('gate-b-confirmation-CONFIRMED_CURRENT_STANDARD'));
		fireEvent.click(within(form).getByLabelText('gate-b-decision-APPROVED'));
		fireEvent.click(within(form).getByLabelText('gate-b-save'));
		await waitFor(() =>
			expect(within(section).getByLabelText('gate-b-message').textContent).toBe(
				'이미 승인된 제품을 같은 범위로 다시 승인하려면 재검증 사유(10자 이상)가 필요합니다. (이미 승인: 레드 헤나 2026-10-10 18:01:40 KST)',
			),
		);
	});

	it('Gate A 통과·Gate B 승인 항목은 색상과 배경으로 구분하고 미승인·철회는 강조하지 않는다', async () => {
		const api = gateBApi(true, { ...GB_PARTIAL_DATA, items: [...GB_PARTIAL_DATA.items, GB_DATA.items[1]] });
		const section = await renderGateB(api);
		const buttons = within(within(section).getByLabelText('gate-b-list')).getAllByRole('button');
		const approved = buttons.map((b) => b.getAttribute('data-approved'));
		expect(approved).toEqual(['true', 'true', null]);
		expect(buttons[0]!.style.borderLeft).toContain('5px solid');
		expect(buttons[2]!.style.borderLeft).toBe('');
		expect(buttons[0]!.style.color).not.toBe('');
		expect(buttons[1]!.style.color).not.toBe('');
		expect(buttons[2]!.style.color).toBe('');
		const states = within(within(section).getByLabelText('gate-b-list')).getAllByLabelText('gate-b-list-state');
		expect(states.map((s) => [s.textContent, s.getAttribute('data-approved')])).toEqual([
			['일부 제품만 승인', 'true'],
			['과거 운영자 확인 (LEGACY)', 'true'],
			['미확인 (근거 사용 불가)', null],
		]);
		expect(within(buttons[2]!).getByText('Gate A 통과').getAttribute('data-approved')).toBe('true');
		fireEvent.click(buttons[0]!);
		expect(within(section).getByLabelText('gate-b-detail-gate-a').getAttribute('data-approved')).toBe('true');
		expect(within(section).getByLabelText('gate-b-detail-state').getAttribute('data-approved')).toBe('true');
		const table = within(section).getByLabelText('gate-b-current-state');
		expect(within(table).getByLabelText('gate-b-state-row-레드 헤나').getAttribute('data-approved')).toBe('true');
		expect(within(table).getByLabelText('gate-b-state-row-헤어팩').getAttribute('data-approved')).toBeNull();
	});

	it('Q번호는 관리자 입력 시트의 P1 14개 공식 가이드 항목에만 붙는다', () => {
		expect(gateBQn({ source_id: 'sujata_usage_guide_html', entry_key: 'html:packmix:three_plus' })).toBe('Q4');
		expect(gateBQn({ source_id: 'sujata_usage_guide_html', entry_key: 'html:faq:gray_or_dark_brown_sequence' })).toBe('Q9');
		expect(gateBQn({ source_id: 'sujata_usage_guide_html', entry_key: 'html:faq:first-use' })).toBe('Q14');
		expect(gateBQn({ source_id: 'sujata_usage_guide_html', entry_key: 'html:step:01' })).toBe('');
		expect(gateBQn({ source_id: 'operator_confirmed_usage_guidance', entry_key: 'html:step:05' })).toBe('');
	});

	it('저장 시각은 표시할 때만 한국 시간으로 바꾼다', () => {
		expect(formatKst('2026-10-09T15:30:00+00:00')).toBe('2026-10-10 00:30:00 KST');
		expect(formatKst('2026-10-09T15:30:00')).toBe('2026-10-10 00:30:00 KST');
		expect(formatKst(null)).toBe('-');
		expect(formatKst('2026-10-09')).toBe('2026-10-09');
	});

	it('저장 전 미리보기는 서버 자동 기록 규칙과 같은 문장을 만든다', () => {
		const out = composeGateBAuditPreview(GB_PREVIEW_TEMPLATE, {
			decision: 'APPROVED', products: DYES, confirmation: 'CONFIRMED_CURRENT_STANDARD', adminExceptions: '두피 질환 시 사용 중단',
		});
		expect({ basis_summary: out.basis_summary, approved_fact_scope: out.approved_fact_scope, limitations_exceptions: out.limitations_exceptions }).toEqual(GB_PREVIEW_EXPECTED);
		expect([out.basis_type, out.basis_reference]).toEqual([GB_PREVIEW_TEMPLATE.basis_type, GB_PREVIEW_TEMPLATE.gate_a_reference]);
		const hold = composeGateBAuditPreview(GB_PREVIEW_TEMPLATE, { decision: 'HOLD', products: ['_entry'], confirmation: 'NEEDS_CHECK', adminExceptions: '무시됨' });
		expect([hold.approved_fact_scope, hold.limitations_exceptions]).toEqual([null, null]);
		expect(hold.basis_summary).toContain('결정: 보류 · 선택 제품: 항목 단위 · 확인: 추가 확인이 필요합니다');
	});
});

const CLAIM_SOURCES = [
	{
		source_id: 'sujata_usage_guide_html', version: 'v2', authority_class: 'OFFICIAL_PRODUCT_GUIDE', status: 'ACTIVE', can_verify: true,
		entries: [
			{ entry_key: 'html:sequence:dark_brown', kind: 'sequence', statement: '진한 흑갈색: 1차 레드 도포 후 헹구고, 2차 브라운을 다시 도포', products: DYES, aspects: ['statement', 'product', 'sequence'] },
			{ entry_key: 'html:ratio:natural_brown', kind: 'ratio', statement: '연한 갈색: 레드:브라운 = 2:8', products: DYES, aspects: ['statement', 'product', 'numeric'] },
			{ entry_key: 'html:duration:pack', kind: 'duration', statement: '헤어팩 1시간', products: ['헤어팩'], aspects: ['statement', 'product', 'numeric'] },
		],
	},
	{
		source_id: 'operator_confirmed_usage_guidance', version: 'v1', authority_class: 'OPERATOR', status: 'ACTIVE', can_verify: true,
		entries: [{ entry_key: 'opc:standard:sequential', kind: 'sequence_duration', statement: '레드 후 브라운 순차 사용: 레드 2시간, 브라운 2시간', products: DYES, aspects: ['statement', 'product', 'sequence', 'numeric'], application_modes: ['sequential'] }],
	},
];
const claimFv = (over: Record<string, unknown> = {}) => ({
	claimKey: 'k', status: 'PENDING', recordedStatus: null, resolution: 'NO_RECORD', historyCount: 0, latestRecordId: null, changedEvidenceEntries: [], latest: null, ...over,
});
const claimView = (over: Partial<ClaimView>): ClaimView => ({
	claim_key: 'rcl:dark', analysis_label: 'U003-C04', parent_unit_key: 'ruf:p', quote: '레드 2시간 후에 당일 또는 다음날 브라운 2시간', canonical_key: 'SEQ_RED2H_BROWN2H_DARK',
	analysis_class: 'VERIFY_CANDIDATE', downgrade_reasons: [], products: DYES, method: 'sequential', target_color: '진한갈색', condition: null,
	analysis_note: '목표 색상은 사람이 공식 표기와 대조', suggested_evidence: [{ source_id: 'operator_confirmed_usage_guidance', entry_key: 'opc:standard:sequential' }, { source_id: 'sujata_usage_guide_html', entry_key: 'html:sequence:dark_brown' }],
	applicable_aspects: ['statement', 'product', 'sequence', 'numeric', 'target_color'], inherited_context: null, official_color_labels: ['진한 흑갈색'],
	target_color_match: 'NEEDS_HUMAN_EQUIVALENCE', integrity: 'OK', verifiable: true, factValidation: claimFv({ claimKey: over.claim_key || 'rcl:dark' }) as ClaimView['factValidation'], ...over,
});

function claimApi(data: Record<string, unknown>) {
	const get = vi.fn(async () => ({ data }));
	const post = vi.fn(async () => ({ data: { ok: true, duplicate: false } }));
	return { get, post };
}

const renderClaims = (api: ReturnType<typeof claimApi>, canValidate = true) =>
	render(
		<ClaimValidationSection
			knowledgeId="rrk:naver_review:4875000316"
			apiBaseUrl="http://api"
			roleProtectedGet={api.get as any}
			roleProtectedPost={api.post as any}
			sources={CLAIM_SOURCES as any}
			canValidate={canValidate}
		/>,
	);

describe('개별 주장 검증 (Phase B)', () => {
	const parent = (claims: ClaimView[], verified = 0) => ({
		parent_unit_key: 'ruf:p', parent_current: true, claim_count: claims.length, verified_claim_count: verified, unit_verified_blocked: verified < claims.length, claims,
	});

	it('자동 분석과 사람 검증을 구분해 표시하고 상위 항목 전체 확인 차단과 순서 문맥을 보여 준다', async () => {
		const step = claimView({ claim_key: 'rcl:step', analysis_label: 'U036-C02', quote: '레드 반죽 8시간 숙성 후 모발 도포 후 2시간 방치', target_color: null, official_color_labels: [], target_color_match: null,
			applicable_aspects: ['statement', 'product', 'sequence', 'numeric'], inherited_context: { mode: 'sequential', order: DYES } });
		const pending = claimView({ claim_key: 'rcl:3-7', analysis_label: 'U003-C08', quote: '레드 3 : 브라운 7', analysis_class: 'PENDING', verifiable: false, target_color: null,
			official_color_labels: [], target_color_match: null, suggested_evidence: [], applicable_aspects: ['statement', 'product', 'numeric'] });
		const api = claimApi({ available: true, version: 'claim_decomposition_v1', parents: [parent([claimView({}), step, pending])], claim_history: [] });
		renderClaims(api);
		await screen.findByLabelText('claim-validation-section');
		expect(api.get).toHaveBeenCalledWith('http://api/reviews/reply-knowledge/items/rrk%3Anaver_review%3A4875000316/claims');
		expect(screen.getByLabelText('claim-parent-progress').textContent).toContain('주장 0000/0003 확인 · 상위 항목 전체 확인 차단');
		const items = screen.getAllByLabelText('claim-item');
		expect(within(items[0]!).getByLabelText('claim-analysis').textContent).toContain('자동 분석(사람 판단 아님): 공식 근거 대조 후보');
		expect(within(items[0]!).getByLabelText('claim-human-status').textContent).toContain('사람 검증: 사실 검증 대기');
		expect(within(items[0]!).getByLabelText('claim-target-color').textContent).toContain('같은 색인지 사람이 판단');
		expect(within(items[1]!).getByLabelText('claim-inherited-context').textContent).toContain('레드 헤나 → 브라운 헤나');
		expect(within(items[2]!).getByText(/분석이 찾은 공식 근거 없음/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: /일괄|전체 확인/ })).toBeNull();
		fireEvent.click(within(items[2]!).getByLabelText('claim-form-toggle'));
		const form = within(items[2]!).getByLabelText('claim-form');
		expect(within(form).getByLabelText('claim-not-verifiable').textContent).toContain('공식 근거 부족');
		fireEvent.change(within(form).getByLabelText('claim-note'), { target: { value: '3:7 공식 근거 없음' } });
		expect((within(form).getByLabelText('claim-verify') as HTMLButtonElement).disabled).toBe(true);
		expect((within(form).getByRole('button', { name: '보류' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('목표 색상은 선택한 공식 근거에 있는 표기를 직접 골라야 확인되고, 같은 요청은 한 번만 보내며 재시도 시 같은 요청 식별값을 쓴다', async () => {
		const api = claimApi({ available: true, version: 'claim_decomposition_v1', parents: [parent([claimView({})])], claim_history: [] });
		let fail = true;
		api.post.mockImplementation((async () => {
			if (fail) {
				fail = false;
				throw new Error('network');
			}
			return { data: { ok: true, duplicate: false } };
		}) as any);
		renderClaims(api);
		fireEvent.click(await screen.findByLabelText('claim-form-toggle'));
		const form = screen.getByLabelText('claim-form');
		const verify = within(form).getByLabelText('claim-verify') as HTMLButtonElement;
		for (const f of ['statement_accurate', 'product_applicable', 'sequence_accurate', 'numeric_accurate', 'target_color_accurate']) {
			fireEvent.click(within(form).getByLabelText(`claim-${f}-yes`));
		}
		fireEvent.change(within(form).getByLabelText('claim-verified-scope'), { target: { value: '레드 2시간 후 브라운 2시간 순차 시 진한 흑갈색' } });
		fireEvent.change(within(form).getByLabelText('claim-note'), { target: { value: '공식 순서·색상 표기 대조' } });
		fireEvent.click(within(form).getByLabelText('claim-evidence-opc:standard:sequential'));
		const select = within(form).getByLabelText('claim-official-color-label') as HTMLSelectElement;
		expect(Array.from(select.options).map((o) => o.value)).toEqual(['']);
		expect(verify.disabled).toBe(true);
		fireEvent.click(within(form).getByLabelText('claim-evidence-html:sequence:dark_brown'));
		expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '진한 흑갈색']);
		expect(verify.disabled).toBe(true);
		fireEvent.change(select, { target: { value: '진한 흑갈색' } });
		expect(verify.disabled).toBe(false);
		expect(within(form).getByLabelText('claim-generator-locked').textContent).toContain('사용 불가');
		fireEvent.click(verify);
		fireEvent.click(verify);
		await waitFor(() => expect(screen.getByLabelText('claim-message').textContent).toContain('network'));
		expect(api.post).toHaveBeenCalledTimes(1);
		fireEvent.click(verify);
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
		const bodies = api.post.mock.calls.map((c) => (c as unknown as [string, Record<string, any>])[1]);
		expect((api.post.mock.calls[0] as unknown as [string])[0]).toBe('http://api/reviews/reply-knowledge/claim-fact-validations');
		expect(bodies[0]).toMatchObject({
			knowledge_id: 'rrk:naver_review:4875000316', claim_key: 'rcl:dark', fact_status: 'VERIFIED', supersedes_record_id: 'ROOT', generator_reference_allowed: 'no',
			official_color_label: '진한 흑갈색', target_color_accurate: 'yes', sequence_accurate: 'yes',
		});
		expect(bodies[0]).not.toHaveProperty('condition_accurate');
		expect(bodies[0]).not.toHaveProperty('reviewer_email');
		expect(bodies[1]!.request_id).toBe(bodies[0]!.request_id);
		expect(bodies[0]!.request_id).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
		await waitFor(() => expect(screen.getByLabelText('claim-message').textContent).toContain('상위 항목·다른 주장·답글 승인은 변경되지 않음'));
	});

	it('다른 관리자가 먼저 기록하면 한국어로 안내하고 다시 불러오며, Phase A 차단 코드도 한국어로 설명한다', async () => {
		const api = claimApi({ available: true, version: 'v1', parents: [parent([claimView({ claim_key: 'rcl:nb', target_color: null, official_color_labels: [], target_color_match: null,
			applicable_aspects: ['statement', 'product', 'numeric'] })])], claim_history: [] });
		const reject = (code: string) => Promise.reject({ response: { status: 409, data: { detail: { code } } } });
		api.post.mockImplementationOnce((() => reject('CLAIM_STALE_VIEW')) as any).mockImplementationOnce((() => reject('PRODUCT_VARIANT_MISMATCH')) as any);
		renderClaims(api);
		fireEvent.click(await screen.findByLabelText('claim-form-toggle'));
		const form = screen.getByLabelText('claim-form');
		fireEvent.change(within(form).getByLabelText('claim-note'), { target: { value: '근거 확인 필요' } });
		fireEvent.click(within(form).getByRole('button', { name: '보류' }));
		await waitFor(() => expect(screen.getByLabelText('claim-message').textContent).toContain('다른 관리자가 이 주장을 먼저 기록했습니다'));
		expect(api.get).toHaveBeenCalledTimes(2);
		fireEvent.click(within(screen.getByLabelText('claim-form')).getByRole('button', { name: '보류' }));
		await waitFor(() => expect(screen.getByLabelText('claim-message').textContent).toContain('제품 종류'));
		expect((api.post.mock.calls[0] as unknown as [string, Record<string, any>])[1]).toMatchObject({ fact_status: 'HOLD', hold_reason: 'FACT_VALIDATION_SOURCE_MISSING' });
	});

	it('원문이 바뀐 주장은 기록할 수 없고, 분리 자료 로딩 실패는 경고하며, 분리 대상이 아닌 답글은 영역을 표시하지 않는다', async () => {
		const changed = claimApi({ available: true, version: 'v1', parents: [parent([claimView({ integrity: 'REPLY_CHANGED', verifiable: false })])] });
		const { unmount } = renderClaims(changed);
		fireEvent.click(await screen.findByLabelText('claim-form-toggle'));
		const form = screen.getByLabelText('claim-form');
		expect(within(form).getByLabelText('claim-not-current').textContent).toContain('답글 원문이 바뀜');
		fireEvent.change(within(form).getByLabelText('claim-note'), { target: { value: '원문 변경 확인' } });
		expect((within(form).getByRole('button', { name: '보류' }) as HTMLButtonElement).disabled).toBe(true);
		unmount();

		const broken = renderClaims(claimApi({ available: false, error: 'CLAIM_DECOMPOSITION_UNAVAILABLE', parents: [] }));
		expect((await screen.findByLabelText('claim-decomposition-unavailable')).textContent).toContain('항목 전체의 "공식 근거로 확인"도 서버에서 차단');
		broken.unmount();

		const none = claimApi({ available: true, version: 'v1', parents: [] });
		renderClaims(none);
		await waitFor(() => expect(none.get).toHaveBeenCalled());
		expect(screen.queryByLabelText('claim-validation-section')).toBeNull();
	});

	it('일부만 대응하는 주장은 모든 문항을 예로 답하고 근거·색상 표기를 골라도 확인할 수 없고 보류만 기록한다', async () => {
		const partial = claimView({ claim_key: 'rcl:label', analysis_label: 'U003-C07', quote: '붉은기 거의 없는 자연스러운 갈색', analysis_class: 'PARTIAL', verifiable: false,
			target_color: '자연스러운 갈색', official_color_labels: ['연한 갈색'], suggested_evidence: [{ source_id: 'sujata_usage_guide_html', entry_key: 'html:ratio:natural_brown' }],
			applicable_aspects: ['statement', 'product', 'target_color'] });
		const api = claimApi({ available: true, version: 'v1', parents: [parent([partial])] });
		renderClaims(api);
		fireEvent.click(await screen.findByLabelText('claim-form-toggle'));
		const form = screen.getByLabelText('claim-form');
		expect(within(form).getByLabelText('claim-not-verifiable').textContent).toContain('분리 자료 재검증(새 버전)');
		for (const f of ['statement_accurate', 'product_applicable', 'target_color_accurate']) fireEvent.click(within(form).getByLabelText(`claim-${f}-yes`));
		fireEvent.click(within(form).getByLabelText('claim-evidence-html:ratio:natural_brown'));
		fireEvent.change(within(form).getByLabelText('claim-official-color-label'), { target: { value: '연한 갈색' } });
		fireEvent.change(within(form).getByLabelText('claim-verified-scope'), { target: { value: '2:8 비율의 연한 갈색' } });
		fireEvent.change(within(form).getByLabelText('claim-note'), { target: { value: '표현 일부만 공식 표기와 대응' } });
		expect((within(form).getByLabelText('claim-verify') as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(within(form).getByRole('button', { name: '보류' }));
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
		expect((api.post.mock.calls[0] as unknown as [string, Record<string, any>])[1]).toMatchObject({ fact_status: 'HOLD' });
	});

	it('조회 전용 사용자는 주장 검증을 기록할 수 없다', async () => {
		renderClaims(claimApi({ available: true, version: 'v1', parents: [parent([claimView({})])] }), false);
		fireEvent.click(await screen.findByLabelText('claim-form-toggle'));
		const form = screen.getByLabelText('claim-form');
		expect((within(form).getByLabelText('claim-note') as HTMLTextAreaElement).disabled).toBe(true);
		expect(within(form).getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
	});
});
