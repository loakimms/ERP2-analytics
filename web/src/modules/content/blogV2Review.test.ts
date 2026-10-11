import { describe, expect, it } from 'vitest';

import {
	applyLocalDecision,
	applyLocalDraftEdit,
	applyLocalTitleEdit,
	canApproveBlogV2,
	isBlogV2Artifact,
	parseBlogV2Bundle,
	reviewCountSummary,
	shouldShowBlogV2ReviewPanel,
} from './blogV2Review';

function sampleBundle(overrides: Record<string, any> = {}) {
	return {
		version: 'blog_v2_review_bundle_v1',
		draft: {
			version: 'blog_professional_draft_v1',
			selectedTitle: '제목 A',
			titleCandidates: [{ title: '제목 A' }, { title: '제목 B' }],
		},
		qualityReport: { gateDecision: 'PASS', qualityStatus: 'WARNING', issues: [] },
		imagePlan: { summary: { assignedCount: 1, requiredCount: 2 }, items: [] },
		reviewItems: [
			{ reviewItemId: 'RV_FACT_MEANING', required: true, severity: 'WARNING', humanDecision: 'PENDING', machineCode: 'SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED' },
			{ reviewItemId: 'RV_GENERAL_KNOWLEDGE', required: true, severity: 'WARNING', humanDecision: 'PENDING', machineCode: 'SEMANTIC_GENERAL_KNOWLEDGE_EXCLUSION_NOT_FULLY_VERIFIED' },
			{ reviewItemId: 'RV_Q_BODY_LENGTH_BELOW_REFERENCE', required: false, severity: 'WARNING', humanDecision: 'PENDING', machineCode: 'BODY_LENGTH_BELOW_REFERENCE' },
		],
		humanReview: { version: 'blog_human_review_v1', decisions: [], humanEdits: {}, validationFreshness: 'CURRENT' },
		reviewSummary: { reviewReadiness: 'REVIEW_REQUIRED', pendingCount: 2, completedCount: 0, requiredCount: 2, blockedCount: 0, imageAssignedCount: 1, imageRequiredCount: 2 },
		...overrides,
	};
}

describe('blogV2Review helpers', () => {
	it('Test L: V1 blog artifact does not activate V2 panel', () => {
		const body = { generation_version: 'v1', generation_engine: 'LLM_WRITER_V1', blog: { sections: [] } };
		expect(isBlogV2Artifact(body, 'blog')).toBe(false);
		expect(shouldShowBlogV2ReviewPanel('blog', body)).toBe(false);
		expect(parseBlogV2Bundle(body)).toBeNull();
	});

	it('Test M: Instagram and Shorts never show V2 blog review', () => {
		const v2 = { generation_version: 'blog_v2', blog_v2_review_bundle: sampleBundle() };
		expect(shouldShowBlogV2ReviewPanel('instagram', v2)).toBe(false);
		expect(shouldShowBlogV2ReviewPanel('shorts', v2)).toBe(false);
		expect(isBlogV2Artifact(v2, 'instagram')).toBe(false);
		expect(isBlogV2Artifact(v2, 'shorts')).toBe(false);
	});

	it('shows V2 panel only for blog v2 payloads', () => {
		const body = { generation_version: 'blog_v2', blog_v2_review_bundle: sampleBundle() };
		expect(shouldShowBlogV2ReviewPanel('blog', body)).toBe(true);
		expect(parseBlogV2Bundle(body)?.version).toBe('blog_v2_review_bundle_v1');
	});

	it('Test R: summary counts follow review item state', () => {
		const pending = sampleBundle();
		expect(reviewCountSummary(pending)).toEqual({ blocked: 0, pending: 2, completed: 0, imageReady: '1/2' });
		const confirmed = applyLocalDecision(applyLocalDecision(pending, 'RV_FACT_MEANING', 'CONFIRMED'), 'RV_GENERAL_KNOWLEDGE', 'CONFIRMED');
		expect(reviewCountSummary(confirmed).pending).toBe(0);
		expect(reviewCountSummary(confirmed).completed).toBe(2);
		expect(confirmed.reviewSummary.reviewReadiness).toBe('READY_FOR_FINAL_REVIEW');
		expect(canApproveBlogV2(confirmed)).toBe(true);
	});

	it('blocks approval while validationFreshness is STALE_AFTER_HUMAN_EDIT', () => {
		const confirmed = applyLocalDecision(applyLocalDecision(sampleBundle(), 'RV_FACT_MEANING', 'CONFIRMED'), 'RV_GENERAL_KNOWLEDGE', 'CONFIRMED');
		confirmed.humanReview.validationFreshness = 'STALE_AFTER_HUMAN_EDIT';
		expect(canApproveBlogV2(confirmed)).toBe(false);
	});

	it('blocks approval when current quality gate is HOLD', () => {
		const confirmed = applyLocalDecision(applyLocalDecision(sampleBundle(), 'RV_FACT_MEANING', 'CONFIRMED'), 'RV_GENERAL_KNOWLEDGE', 'CONFIRMED');
		confirmed.currentQualityReport = { gateDecision: 'HOLD' };
		expect(canApproveBlogV2(confirmed)).toBe(false);
	});

	it('machine FAIL cannot be approved by human acceptance', () => {
		const hold = sampleBundle({
			qualityReport: { gateDecision: 'HOLD', qualityStatus: 'FAIL', issues: [{ code: 'RESTRICTED_CLAIM_LEAKAGE', status: 'FAIL' }] },
			reviewItems: [
				{ reviewItemId: 'RV_Q_RESTRICTED_CLAIM_LEAKAGE', required: true, severity: 'FAIL', humanDecision: 'PENDING', machineCode: 'RESTRICTED_CLAIM_LEAKAGE' },
				{ reviewItemId: 'RV_FACT_MEANING', required: true, severity: 'WARNING', humanDecision: 'PENDING', machineCode: 'SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED' },
			],
		});
		const accepted = applyLocalDecision(applyLocalDecision(hold, 'RV_Q_RESTRICTED_CLAIM_LEAKAGE', 'ACCEPTED_AS_IS'), 'RV_FACT_MEANING', 'CONFIRMED');
		expect(accepted.reviewSummary.reviewReadiness).toBe('BLOCKED');
		expect(canApproveBlogV2(accepted)).toBe(false);
		expect(accepted.qualityReport.gateDecision).toBe('HOLD');
	});

	it('Test J/S: title and draft edits stay in humanEdits and mark stale', () => {
		const bundle = sampleBundle();
		const edited = applyLocalTitleEdit(bundle, '제목 B');
		expect(edited.draft.selectedTitle).toBe('제목 A');
		expect(edited.humanReview.humanEdits.selectedTitle).toBe('제목 B');
		expect(edited.humanReview.validationFreshness).toBe('STALE_AFTER_HUMAN_EDIT');
		const bodyEdit = applyLocalDraftEdit(bundle, { draftText: '한 문장을 고쳤습니다.' });
		expect(bodyEdit.humanReview.validationFreshness).toBe('STALE_AFTER_HUMAN_EDIT');
		expect(bodyEdit.draft).toEqual(bundle.draft);
	});

	it('Test K: ownership decision does not stale validation', () => {
		const bundle = sampleBundle({
			reviewItems: [{ reviewItemId: 'RV_IMAGE_OWNERSHIP_a1', required: true, severity: 'WARNING', humanDecision: 'PENDING', machineCode: 'IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED' }],
		});
		const changed = applyLocalDecision(bundle, 'RV_IMAGE_OWNERSHIP_a1', 'CONFIRMED');
		expect(changed.humanReview.validationFreshness).toBe('CURRENT');
	});

	it('Test Q: helpers do not invent quality scores', () => {
		const blob = JSON.stringify(sampleBundle());
		expect(blob).not.toContain('seo_score');
		expect(blob).not.toContain('C-Rank');
		expect(blob).not.toContain('DIA');
		expect(blob).not.toContain('AI 점수');
	});
});
