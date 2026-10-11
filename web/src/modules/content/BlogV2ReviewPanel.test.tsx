import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BlogV2ReviewPanel } from './BlogV2ReviewPanel';

const bundle = {
	version: 'blog_v2_review_bundle_v1',
	context: { sourceFacts: [{ factId: 'sf_1', statement: '헤나 분말', classification: 'PRODUCT_SOURCE' }] },
	intentAnalysis: { primaryIntent: 'HOW_TO', audienceHypothesis: { primary: '처음 사용하는 사람', classification: 'PLANNING_INFERENCE' } },
	contentPlan: { sections: [{ sectionId: 'S1', userQuestion: '사용 전 무엇을 준비해야 하나?' }] },
	draft: {
		selectedTitle: '제목 A',
		titleCandidates: [{ title: '제목 A' }, { title: '제목 B' }],
		sections: [{ sectionId: 'S1', heading: '사용 전 무엇을 준비해야 하나?', paragraphs: ['확인된 정보부터 보겠습니다.'], sourceRefs: ['sf_1'] }],
		faq: [{ question: '물은 어떻게 섞나요?' }],
		cta: { text: '공식 제품 정보에서 사용 순서를 한 번 더 확인해 보세요.' },
	},
	qualityReport: {
		gateDecision: 'PASS',
		qualityStatus: 'WARNING',
		metrics: { visibleCharacterCount: 635, titleCharacterCount: 12 },
		guidelineProfile: { body: { preferredMin: 2200, preferredMax: 2600 } },
		issues: [{ code: 'BODY_LENGTH_BELOW_REFERENCE', status: 'WARNING' }],
	},
	imagePlan: {
		summary: { assignedCount: 1, requiredCount: 2 },
		items: [
			{ imagePlanId: 'IMG_PLAN_001', sectionId: 'S1', purpose: 'PRODUCT', status: 'ASSIGNED', assetRef: 'img_1', altText: '제품 사진', caption: '제품', filenameSuggestion: 'henna.jpg', ownership: 'UNKNOWN' },
			{ imagePlanId: 'IMG_PLAN_002', sectionId: 'S2', purpose: 'USAGE', status: 'PENDING_ASSET' },
		],
	},
	reviewItems: [
		{ reviewItemId: 'RV_FACT_MEANING', required: true, severity: 'WARNING', humanDecision: 'PENDING', title: '본문 표현이 원본 자료 의미와 일치합니까?', description: '사람이 최종 확인해야 합니다.', machineCode: 'SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED', block: 'FACTS' },
		{ reviewItemId: 'RV_GENERAL_KNOWLEDGE', required: true, severity: 'WARNING', humanDecision: 'PENDING', title: '자료에 없는 전문 정보가 추가되지 않았는지 확인', description: '확인된 자료 밖 전문 지식을 넣지 않았는지 검토하세요.', machineCode: 'SEMANTIC_GENERAL_KNOWLEDGE_EXCLUSION_NOT_FULLY_VERIFIED', block: 'FACTS' },
		{ reviewItemId: 'RV_DISCLOSURE', required: true, severity: 'WARNING', humanDecision: 'PENDING', title: '광고·협찬 표시 여부를 확인해 주세요.', description: '사람 판단으로만 저장됩니다.', machineCode: 'COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN', block: 'SAFETY' },
	],
	humanReview: { validationFreshness: 'CURRENT', humanEdits: {}, decisions: [] },
	reviewSummary: { reviewReadiness: 'REVIEW_REQUIRED', pendingCount: 3, completedCount: 0, requiredCount: 3, blockedCount: 0, imageAssignedCount: 1, imageRequiredCount: 2 },
};

describe('BlogV2ReviewPanel', () => {
	it('renders six review blocks and human-readable summary counts', () => {
		render(<BlogV2ReviewPanel bundle={bundle} onBundleChange={vi.fn()} />);
		expect(screen.getByTestId('blog-v2-review-panel')).toBeInTheDocument();
		expect(screen.getByText('발행 전 점검')).toBeInTheDocument();
		expect(screen.getByText('발행 차단')).toBeInTheDocument();
		expect(screen.getByText('확인 필요')).toBeInTheDocument();
		expect(screen.getByTestId('blog-v2-block-content')).toBeInTheDocument();
		expect(screen.getByTestId('blog-v2-block-facts')).toBeInTheDocument();
		expect(screen.getByTestId('blog-v2-block-safety')).toBeInTheDocument();
		expect(screen.getByTestId('blog-v2-block-readability')).toBeInTheDocument();
		expect(screen.getByTestId('blog-v2-block-images')).toBeInTheDocument();
		expect(screen.getByTestId('blog-v2-block-final')).toBeInTheDocument();
		expect(screen.queryByText(/SEO 점수/)).toBeNull();
		expect(screen.queryByText(/C-Rank/)).toBeNull();
		expect(screen.queryByText(/semantic entailment/i)).toBeNull();
	});

	it('shows 다시 점검 when validation is stale', () => {
		const stale = {
			...bundle,
			humanReview: { validationFreshness: 'STALE_AFTER_HUMAN_EDIT', humanEdits: { selectedTitle: '제목 B' }, decisions: [] },
		};
		render(<BlogV2ReviewPanel bundle={stale} onBundleChange={vi.fn()} onRevalidate={vi.fn()} />);
		expect(screen.getByTestId('blog-v2-revalidate')).toHaveTextContent('다시 점검');
		expect(screen.getByText(/다시 점검이 필요합니다/)).toBeInTheDocument();
	});

	it('disables 다시 점검 until unsaved edits are saved', () => {
		const stale = {
			...bundle,
			humanReview: { validationFreshness: 'STALE_AFTER_HUMAN_EDIT', humanEdits: {}, decisions: [] },
		};
		render(<BlogV2ReviewPanel bundle={stale} onBundleChange={vi.fn()} onRevalidate={vi.fn()} unsavedChanges />);
		expect(screen.getByTestId('blog-v2-revalidate')).toBeDisabled();
		expect(screen.getByText(/변경 내용을 먼저 저장한 뒤 다시 점검해 주세요/)).toBeInTheDocument();
	});
});
