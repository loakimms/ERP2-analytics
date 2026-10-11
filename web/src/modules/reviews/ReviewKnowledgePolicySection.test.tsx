import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewKnowledgePolicySection, type PolicyCard } from './ReviewKnowledgePolicySection';

const CARD: PolicyCard = {
	question_id: 'D01',
	title: '레드·브라운 필수 병행 / 브라운 단독 비권장',
	question: "조건 없이 '반드시 함께'라고 안내해도 되는가?",
	conflict_summary: '운영자 확인 기준은 브라운 단독 2시간을 인정합니다.',
	issue_ids: ['I02'],
	guide_conflict: true,
	products: ['HENNA'],
	conditions: [{ key: 'unconditional', label: '조건 없는 표현' }],
	guide_refs: [{ source_id: 'operator_confirmed_usage_guidance', entry_key: 'opc:standard:brown-single' }],
	notes: ['조건부 안내는 제외'],
	question_sha256: 'q-sha',
	linked_reply_count: 1,
	authorship_at_audit: { UNKNOWN: 1 },
	state: 'PENDING',
	state_reasons: [],
	latest: null,
	latest_record_id: 'ROOT',
	history_count: 0,
};
const DETAIL = {
	...CARD,
	guide_refs: [{ ...CARD.guide_refs[0], available: true, statement: '브라운 단독 사용: 2시간' }],
	history: [],
	members: [
		{
			knowledge_id: 'rrk:naver_review:4877886386',
			issue_ids: ['I02'],
			quotes: ['레드와 브라운 반드시 함께 사용해주셔야 합니다.'],
			product_group: 'HENNA',
			authorship: 'UNKNOWN',
			condition_key: 'unconditional',
			review_text: '브라운만 써봤는데 색이 연해요',
			reply_text: '레드와 브라운 반드시 함께 사용해주셔야 합니다.',
			reply_available: true,
			application: { I02: 'NO_DECISION' },
		},
	],
};

function makeApi() {
	const get = vi.fn(async (url: string) => {
		if (url.endsWith('/policy-questions')) {
			return {
				data: { available: true, artifact_version: 'v1', pending_count: 1, counts: { PENDING: 1 }, cards: [CARD], auto_rules: [] },
			};
		}
		return { data: DETAIL };
	});
	const post = vi.fn(async () => ({ data: { ok: true } }));
	return { get, post };
}

describe('ReviewKnowledgePolicySection', () => {
	it('shows pending count, guide text, linked replies and blocks human-over-guide on conflict questions', async () => {
		const api = makeApi();
		render(<ReviewKnowledgePolicySection apiBaseUrl="/api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} canValidate />);
		expect(await screen.findByText('정책 결정 대기 0001/0001')).toBeTruthy();
		fireEvent.click(screen.getByLabelText('policy-card-D01'));
		expect(await screen.findByText(/브라운 단독 사용: 2시간/)).toBeTruthy();
		expect(screen.getByText(/I02 결정 전/)).toBeTruthy();
		expect((screen.getByLabelText('policy-decision-HUMAN_SUPPLEMENT') as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByLabelText('policy-save') as HTMLButtonElement).disabled).toBe(true);
	});

	it('saves a scoped decision with the stale-view guard fields', async () => {
		const api = makeApi();
		render(<ReviewKnowledgePolicySection apiBaseUrl="/api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} canValidate />);
		fireEvent.click(await screen.findByLabelText('policy-card-D01'));
		await screen.findByLabelText('policy-decision-form');
		fireEvent.click(screen.getByLabelText('policy-decision-GUIDE_STANDARD'));
		fireEvent.click(screen.getByLabelText('policy-evidence-opc:standard:brown-single'));
		fireEvent.change(screen.getByLabelText('policy-decision-text'), { target: { value: '운영자 확인 기준을 적용합니다' } });
		fireEvent.change(screen.getByLabelText('policy-note'), { target: { value: '공식 기준 우선 원칙' } });
		fireEvent.click(screen.getByLabelText('policy-save'));
		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
		const [url, body] = api.post.mock.calls[0] as unknown as [string, Record<string, any>];
		expect(url).toBe('/api/reviews/reply-knowledge/policy-decisions');
		expect(body).toMatchObject({
			question_id: 'D01',
			question_sha256: 'q-sha',
			supersedes_record_id: 'ROOT',
			decision: 'GUIDE_STANDARD',
			products: ['HENNA'],
			issue_ids: ['I02'],
			condition_key: 'unconditional',
			evidence: [{ source_id: 'operator_confirmed_usage_guidance', entry_key: 'opc:standard:brown-single' }],
			exception_knowledge_ids: [],
		});
		expect(body.request_id).toMatch(/^pol-/);
		expect(await screen.findByLabelText('policy-message')).toBeTruthy();
	});

	it('is read-only without validation permission', async () => {
		const api = makeApi();
		render(<ReviewKnowledgePolicySection apiBaseUrl="/api" roleProtectedGet={api.get as any} roleProtectedPost={api.post as any} canValidate={false} />);
		expect(await screen.findByLabelText('policy-readonly')).toBeTruthy();
	});
});
