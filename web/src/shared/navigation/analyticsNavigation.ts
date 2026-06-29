import { buildPathWithQuery, readQueryParam } from '../url/query';

export type AnalyticsQnaKind = 'all' | 'customer' | 'product';
export type AnalyticsQnaSection = 'summary' | 'conversion' | 'quality' | 'faq' | 'marketing' | 'items';
export type AnalyticsQnaResponseState = '' | 'all' | 'unanswered' | 'generated' | 'approved' | 'submitted' | 'failed' | 'rejected' | 'answered';
export type AnalyticsQnaManagementResponseState = 'all' | 'unanswered' | 'generated' | 'approved' | 'submitted' | 'failed' | 'rejected' | 'answered';

function resolveSiblingPath(currentPathname: string, fromSegment: string, toSegment: string, fallback: string): string {
	const pathname = String(currentPathname || '').trim();
	if (pathname.includes(fromSegment)) {
		return pathname.replace(fromSegment, toSegment);
	}
	return fallback;
}

function normalizeQnaKind(value?: string | null): AnalyticsQnaKind {
	const raw = String(value || '').trim();
	return raw === 'customer' || raw === 'product' ? raw : 'all';
}

function normalizeQnaSection(value?: string | null): AnalyticsQnaSection {
	const raw = String(value || '').trim();
	if (raw === 'summary' || raw === 'conversion' || raw === 'quality' || raw === 'faq' || raw === 'marketing' || raw === 'items') {
		return raw;
	}
	return 'summary';
}

export function normalizeQnaResponseState(value?: string | null): AnalyticsQnaResponseState {
	const raw = String(value || '').trim();
	if (raw === 'all' || raw === 'unanswered' || raw === 'generated' || raw === 'approved' || raw === 'submitted' || raw === 'failed' || raw === 'rejected' || raw === 'answered') {
		return raw;
	}
	return '';
}

export function normalizeQnaManagementResponseState(value?: string | null): AnalyticsQnaManagementResponseState {
	const raw = String(value || '').trim();
	if (raw === 'unanswered' || raw === 'generated' || raw === 'approved' || raw === 'submitted' || raw === 'failed' || raw === 'rejected' || raw === 'answered') {
		return raw;
	}
	return 'all';
}

function isYmdDateText(value: string | null | undefined): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

export function buildQnaManagementPath(params: {
	qnaKind: AnalyticsQnaKind;
	search: string;
	fromYmd: string;
	toYmd: string;
	productName: string;
	category: string;
	issueTag?: string | null;
	responseState?: string | null;
}): string {
	const mergedSearch = [params.search, params.productName, params.category].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
	const normalizedResponseState = String(params.responseState || '').trim();
	return buildPathWithQuery('/analytics/reviews/qna', {
		qna_kind: params.qnaKind,
		from_date: params.fromYmd,
		to_date: params.toYmd,
		search: mergedSearch,
		issue_tag: String(params.issueTag || '').trim() || undefined,
		response_state: normalizedResponseState && normalizedResponseState !== 'all' ? normalizedResponseState : undefined,
	});
}

export function readInitialQnaAnalysisNavigationQuery(
	search: string,
	defaultRange: { fromYmd: string; toYmd: string },
): {
	qnaKind: AnalyticsQnaKind;
	search: string;
	fromYmd: string;
	toYmd: string;
	issueTag: string;
	section: AnalyticsQnaSection;
	responseState: AnalyticsQnaResponseState;
	hasResponseStateContext: boolean;
} {
	const rawResponseState = readQueryParam(search, 'response_state');
	return {
		qnaKind: normalizeQnaKind(readQueryParam(search, 'qna_kind')),
		search: readQueryParam(search, 'search'),
		fromYmd: readQueryParam(search, 'from_date') || defaultRange.fromYmd,
		toYmd: readQueryParam(search, 'to_date') || defaultRange.toYmd,
		issueTag: readQueryParam(search, 'issue_tag'),
		section: normalizeQnaSection(readQueryParam(search, 'section')),
		responseState: normalizeQnaResponseState(rawResponseState),
		hasResponseStateContext: rawResponseState.length > 0,
	};
}

export function readInitialQnaManagementNavigationQuery(
	search: string,
	defaultRange: { fromYmd: string; toYmd: string },
): {
	qnaKind: AnalyticsQnaKind;
	search: string;
	fromYmd: string;
	toYmd: string;
	issueTag: string;
	responseState: AnalyticsQnaManagementResponseState;
} {
	return {
		qnaKind: normalizeQnaKind(readQueryParam(search, 'qna_kind')),
		search: readQueryParam(search, 'search'),
		fromYmd: readQueryParam(search, 'from_date') || defaultRange.fromYmd,
		toYmd: readQueryParam(search, 'to_date') || defaultRange.toYmd,
		issueTag: readQueryParam(search, 'issue_tag'),
		responseState: normalizeQnaManagementResponseState(readQueryParam(search, 'response_state')),
	};
}

export function buildQnaAnalysisPath(params: {
	qnaKind: AnalyticsQnaKind;
	search: string;
	fromYmd: string;
	toYmd: string;
	issueTag: string;
	responseState: AnalyticsQnaManagementResponseState;
}): string {
	return buildPathWithQuery('/analytics/reviews/qna-analysis', {
		qna_kind: params.qnaKind,
		from_date: params.fromYmd,
		to_date: params.toYmd,
		response_state: params.responseState,
		search: String(params.search || '').trim() || undefined,
		issue_tag: String(params.issueTag || '').trim() || undefined,
		section: String(params.issueTag || '').trim() ? 'quality' : 'items',
	});
}

export function buildReviewManagementPath(
	currentPathname: string,
	params: { fromYmd: string; toYmd: string; productUrl?: string },
): string {
	return buildPathWithQuery(
		resolveSiblingPath(currentPathname, '/reviews/review-analysis', '/reviews/review-management', '/analytics/reviews/review-management'),
		{
			from_date: params.fromYmd,
			to_date: params.toYmd,
			product_url: params.productUrl,
		},
	);
}

export function readInitialReviewAnalysisNavigationQuery(
	search: string,
	defaultRange: { fromYmd: string; toYmd: string },
): {
	fromYmd: string;
	toYmd: string;
	productUrl: string;
} {
	const fromDate = readQueryParam(search, 'from_date');
	const toDate = readQueryParam(search, 'to_date');
	return {
		fromYmd: isYmdDateText(fromDate) ? fromDate : defaultRange.fromYmd,
		toYmd: isYmdDateText(toDate) ? toDate : defaultRange.toYmd,
		productUrl: readQueryParam(search, 'product_url'),
	};
}

export function buildReviewAnalysisPath(
	currentPathname: string,
	params: { productUrl?: string; fromYmd: string; toYmd: string },
): string {
	return buildPathWithQuery(
		resolveSiblingPath(currentPathname, '/reviews/review-management', '/reviews/review-analysis', '/analytics/reviews/review-analysis'),
		{
			product_url: params.productUrl,
			from_date: params.fromYmd,
			to_date: params.toYmd,
		},
	);
}

export function readInitialReviewManagementNavigationQuery(
	search: string,
	defaultRange: { from: string; to: string },
): {
	productUrl: string;
	dateFrom: string;
	dateTo: string;
} {
	const fromDate = readQueryParam(search, 'from_date');
	const toDate = readQueryParam(search, 'to_date');
	return {
		productUrl: readQueryParam(search, 'product_url'),
		dateFrom: isYmdDateText(fromDate) ? fromDate : defaultRange.from,
		dateTo: isYmdDateText(toDate) ? toDate : defaultRange.to,
	};
}

export function buildKeywordInsightsPath(params: {
	keyword: string;
	fromYmd?: string;
	toYmd?: string;
	autoRun?: boolean;
}): string {
	return buildPathWithQuery('/analytics/rank/insights', {
		keyword: String(params.keyword || '').trim() || undefined,
		from_date: String(params.fromYmd || '').trim() || undefined,
		to_date: String(params.toYmd || '').trim() || undefined,
		auto_run: params.autoRun ? '1' : undefined,
	});
}

export function readInitialKeywordInsightsNavigationQuery(
	search: string,
	defaults: { keyword: string; fromYmd: string; toYmd: string; autoRun?: boolean },
): {
	keyword: string;
	fromYmd: string;
	toYmd: string;
	autoRun: boolean;
} {
	const fromDate = readQueryParam(search, 'from_date');
	const toDate = readQueryParam(search, 'to_date');
	const autoRun = readQueryParam(search, 'auto_run');
	return {
		keyword: readQueryParam(search, 'keyword') || defaults.keyword,
		fromYmd: isYmdDateText(fromDate) ? fromDate : defaults.fromYmd,
		toYmd: isYmdDateText(toDate) ? toDate : defaults.toYmd,
		autoRun: autoRun === '1' || autoRun.toLowerCase() === 'true' || Boolean(defaults.autoRun),
	};
}

export function buildPurchaseKeywordsPath(params: {
	productName?: string | null;
	keyword?: string | null;
}): string {
	return buildPathWithQuery('/analytics/performance/purchase-keywords', {
		product: String(params.productName || '').trim() || undefined,
		keyword: String(params.keyword || '').trim() || undefined,
	});
}

export function readInitialPurchaseKeywordsNavigationQuery(search: string): {
	productName: string;
	keyword: string;
} {
	return {
		productName: readQueryParam(search, 'product'),
		keyword: readQueryParam(search, 'keyword'),
	};
}

type AiOpsSourceEvidenceParams = {
	productName?: string | null;
	productUrl?: string | null;
	keyword?: string | null;
	actionBucket?: string | null;
	policyType?: string | null;
	topIssue?: string | null;
	recommendedAction?: string | null;
	fromYmd: string;
	toYmd: string;
};

export type AiOpsSourceEvidenceLink = {
	label: string;
	path: string;
};

function includesAny(texts: string[], keywords: string[]): boolean {
	return texts.some((text) => keywords.some((keyword) => text.includes(keyword)));
}

function resolveAiOpsSourceBucket(params: AiOpsSourceEvidenceParams): string {
	const bucket = normalizeActionBucket(params.actionBucket);
	if (bucket) return bucket;

	const texts = [params.policyType, params.topIssue, params.recommendedAction]
		.map((value) => String(value || '').trim().toUpperCase())
		.filter(Boolean);

	if (includesAny(texts, ['FAQ', 'Q&A', '문의', '상세페이지'])) return 'FAQ_CONTENT_IMPROVEMENT';
	if (includesAny(texts, ['REVIEW', 'VOC', '리뷰', '부정'])) return 'VOC_IMPROVEMENT';
	if (includesAny(texts, ['예산 증액', '광고 확대', '증액'])) return 'BUDGET_INCREASE';
	if (includesAny(texts, ['예산 감액', '감액', '잠식'])) return 'BUDGET_DECREASE';
	return '';
}

export function buildAiOpsSourceEvidencePath(params: AiOpsSourceEvidenceParams): AiOpsSourceEvidenceLink {
	const productName = String(params.productName || '').trim();
	const productUrl = String(params.productUrl || '').trim();
	const keyword = String(params.keyword || '').trim();
	const sourceBucket = resolveAiOpsSourceBucket(params);

	if (sourceBucket === 'VOC_IMPROVEMENT') {
		return {
			label: '리뷰 분석 열기',
			path: buildReviewAnalysisPath('/analytics/reviews/review-management', {
				productUrl: productUrl || undefined,
				fromYmd: params.fromYmd,
				toYmd: params.toYmd,
			}),
		};
	}

	if (sourceBucket === 'FAQ_CONTENT_IMPROVEMENT') {
		return {
			label: 'Q&A 분석 열기',
			path: buildQnaAnalysisPath({
				qnaKind: 'product',
				search: productName,
				fromYmd: params.fromYmd,
				toYmd: params.toYmd,
				issueTag: '',
				responseState: 'all',
			}),
		};
	}

	return {
		label: '구매 키워드 분석 열기',
		path: buildPurchaseKeywordsPath({
			productName,
			keyword,
		}),
	};
}

export function normalizeActionBucket(bucket: string | null | undefined): string {
	return String(bucket || '').trim().toUpperCase();
}

export function buildAiOpsPathWithActionBucket(path: string, actionBucket: string | null | undefined): string {
	const bucket = normalizeActionBucket(actionBucket);
	return buildPathWithQuery(path, { action_bucket: bucket || undefined });
}

export function selectedActionBucketFromSearch(search: string): string {
	return normalizeActionBucket(readQueryParam(search, 'action_bucket'));
}
