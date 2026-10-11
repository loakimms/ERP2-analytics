export type ReviewReadiness = 'BLOCKED' | 'REVIEW_REQUIRED' | 'READY_FOR_FINAL_REVIEW' | 'HUMAN_APPROVED';

const DONE = new Set(['CONFIRMED', 'RESOLVED', 'ACCEPTED_AS_IS', 'NOT_APPLICABLE']);

export function isBlogV2Artifact(body: unknown, channel?: string): boolean {
	if (channel && channel !== 'blog') return false;
	if (!body || typeof body !== 'object') return false;
	const payload = body as Record<string, unknown>;
	if (payload.generation_version === 'blog_v2') return true;
	if (payload.blog_generation && typeof payload.blog_generation === 'object') return true;
	if (payload.blog_v2_review_bundle && typeof payload.blog_v2_review_bundle === 'object') return true;
	const draft = payload.draft && typeof payload.draft === 'object' ? payload.draft as Record<string, unknown> : null;
	return draft?.version === 'blog_professional_draft_v1';
}

export function shouldShowBlogV2ReviewPanel(channel: string | undefined, body: unknown): boolean {
	return channel === 'blog' && parseBlogV2Bundle(body) != null;
}

export function parseBlogV2Bundle(body: unknown): Record<string, any> | null {
	if (!body || typeof body !== 'object') return null;
	const payload = body as Record<string, any>;
	if (payload.blog_v2_review_bundle && payload.blog_v2_review_bundle.version === 'blog_v2_review_bundle_v1') {
		return payload.blog_v2_review_bundle;
	}
	if (payload.blog_generation?.blog_v2_review_bundle?.version === 'blog_v2_review_bundle_v1') {
		return payload.blog_generation.blog_v2_review_bundle;
	}
	if (payload.version === 'blog_v2_review_bundle_v1' && Array.isArray(payload.reviewItems)) return payload;
	if (payload.generation_version === 'blog_v2' && (payload.reviewItems || payload.draft)) return payload;
	return null;
}

export function persistReviewBundle(body: Record<string, any>, bundle: Record<string, any>): Record<string, any> {
	return {
		...body,
		blog_v2_review_bundle: bundle,
		humanReview: bundle.humanReview,
	};
}

export function reviewCountSummary(bundle: Record<string, any> | null): { blocked: number; pending: number; completed: number; imageReady: string } {
	const summary = bundle?.reviewSummary || {};
	const assigned = Number(summary.imageAssignedCount || 0);
	const required = Number(summary.imageRequiredCount || 0);
	return {
		blocked: Number(summary.blockedCount || 0),
		pending: Number(summary.pendingCount || 0),
		completed: Number(summary.completedCount || 0),
		imageReady: `${assigned}/${required}`,
	};
}

export function applyLocalDecision(bundle: Record<string, any>, reviewItemId: string, decision: string, note?: string): Record<string, any> {
	const next = clone(bundle);
	const items = Array.isArray(next.reviewItems) ? next.reviewItems : [];
	for (const item of items) {
		if (item.reviewItemId === reviewItemId) {
			item.humanDecision = decision;
			item.reviewerNote = note || null;
		}
	}
	const decisions = Array.isArray(next.humanReview?.decisions) ? next.humanReview.decisions.filter((item: any) => item.reviewItemId !== reviewItemId) : [];
	decisions.push({ reviewItemId, decision, note: note || null, reviewedBy: null });
	next.humanReview = { ...(next.humanReview || {}), decisions, validationFreshness: next.humanReview?.validationFreshness || 'CURRENT' };
	next.reviewSummary = recount(next);
	if (next.humanReview) next.humanReview.reviewStatus = next.reviewSummary.reviewReadiness;
	return next;
}

export function applyLocalTitleEdit(bundle: Record<string, any>, selectedTitle: string): Record<string, any> {
	return applyLocalDraftEdit(bundle, { selectedTitle });
}

export function applyLocalDraftEdit(bundle: Record<string, any>, edits: { selectedTitle?: string; draftText?: string }): Record<string, any> {
	const next = clone(bundle);
	next.humanReview = {
		...(next.humanReview || {}),
		humanEdits: { ...(next.humanReview?.humanEdits || {}), ...edits },
		validationFreshness: 'STALE_AFTER_HUMAN_EDIT',
	};
	next.reviewSummary = recount(next);
	return next;
}

export function canApproveBlogV2(bundle: Record<string, any> | null): boolean {
	if (!bundle) return false;
	const freshness = String(bundle.humanReview?.validationFreshness || '');
	if (freshness !== 'CURRENT') return false;
	const quality = bundle.currentQualityReport || bundle.qualityReport || {};
	if (String(quality.gateDecision || '') === 'HOLD') return false;
	const readiness = String(bundle.reviewSummary?.reviewReadiness || '');
	return readiness === 'READY_FOR_FINAL_REVIEW' || readiness === 'HUMAN_APPROVED';
}

export function authorityLabel(classification?: string): string {
	const value = String(classification || '').toUpperCase();
	if (value === 'PRODUCT_SOURCE' || value === 'FACT_SOURCE' || value === 'BRAND_SOURCE') return '확정 자료';
	if (value === 'INFERENCE') return 'AI 추출 자료';
	if (value.includes('EVIDENCE') || value === 'REVIEW_SOURCE') return 'Evidence';
	if (value === 'PLANNING_INFERENCE' || value === 'MODEL_DERIVED') return 'AI 추정';
	return '확인 불가';
}

export function readinessLabel(readiness?: string): string {
	if (readiness === 'BLOCKED') return '발행 차단';
	if (readiness === 'READY_FOR_FINAL_REVIEW') return '최종 승인 가능';
	if (readiness === 'HUMAN_APPROVED') return '사람 승인 완료';
	return '검수 필요';
}

export function intentLabel(intent?: string): string {
	const value = String(intent || '').toUpperCase();
	if (value === 'HOW_TO') return '사용 방법';
	if (value === 'WHAT_IS') return '제품/개념 이해';
	if (value === 'COMPARISON') return '비교';
	if (value === 'TROUBLESHOOTING') return '문제 해결';
	if (value === 'INGREDIENT') return '성분 확인';
	return value ? '검색 의도 확인' : '확인 중';
}

function recount(bundle: Record<string, any>): Record<string, any> {
	const items = Array.isArray(bundle.reviewItems) ? bundle.reviewItems : [];
	const required = items.filter((item: any) => item.required);
	const pending = required.filter((item: any) => !DONE.has(String(item.humanDecision || 'PENDING')));
	const completed = required.filter((item: any) => DONE.has(String(item.humanDecision || 'PENDING')));
	const rejected = items.some((item: any) => item.humanDecision === 'REJECTED');
	const gateHold = String((bundle.currentQualityReport || bundle.qualityReport)?.gateDecision || '') === 'HOLD';
	let reviewReadiness: ReviewReadiness = 'READY_FOR_FINAL_REVIEW';
	if (gateHold || rejected) reviewReadiness = 'BLOCKED';
	else if (pending.length) reviewReadiness = 'REVIEW_REQUIRED';
	return {
		...(bundle.reviewSummary || {}),
		reviewReadiness,
		pendingCount: pending.length,
		completedCount: completed.length,
		requiredCount: required.length,
		blockedCount: items.filter((item: any) => item.severity === 'FAIL' || item.humanDecision === 'REJECTED').length,
		validationFreshness: bundle.humanReview?.validationFreshness || 'CURRENT',
	};
}

function clone<T>(value: T): T {
	return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
