import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { SalesDateRangeControls } from '../sales/SalesDateRangeControls';
import { useMaybeAuth } from '../auth/AuthProvider';
import {
	buildReviewAnalysisPath,
	readInitialReviewManagementNavigationQuery,
} from '../../shared/navigation/analyticsNavigation';
import {
	isTransientPollingError,
	normalizeReviewRatingFilterValue,
	replyCollectStatusClassName,
	replyStatusClassName,
	replyStatusDescription,
} from '../../shared/domain/analyticsDomain';
import {
	labelReviewStyleControl,
	normalizeReviewReplyActionError,
} from '../../shared/presentation/reviewReplyPresentation';
import {
	decodeJwtPayload,
	normalizeAnalyticsRolesFromClaims,
} from '../../shared/auth/authClaims';
import { authRetryGet, authRetryPost } from '../../shared/auth/authRetry';
import { formatDateYmdLabel, truncateDisplayText } from '../../shared/utils/dateText';
import {
	loadStoredReviewAnalysisDateRange,
	storeReviewAnalysisDateRange,
} from '../../shared/utils/reviewDateRange';
import { ContextBar } from '../../shared/ui/ContextBar';
import { serializeQueryParams } from '../../shared/url/query';
import { buildErp2ClientIpHeaders, discoverNasHostCdpIp } from '../layout/hostCdpClient';
import { ReviewKnowledgeValidationPanel } from './ReviewKnowledgeValidationPanel';

type TrackedKeywordRow = {
	id: number;
	product_url: string | null;
	keyword: string;
};

type TrackedProductOption = {
	productUrl: string;
	productTitle?: string | null;
	keywords: string[];
};

type ReviewReplyStylePresetItem = {
	level: number;
	id: string;
	name: string;
	summary: string;
	controls: Record<string, number>;
};

type ReviewReplyStyleFieldRecommendation = {
	id: string;
	label: string;
	description: string;
	why: string;
};

type ReviewReplyStylePresetRecommendationResponse = {
	ok: boolean;
	product_url: string | null;
	corpus_examples: number;
	recommended_fields: ReviewReplyStyleFieldRecommendation[];
	presets: ReviewReplyStylePresetItem[];
};

type ReviewReplyStyleCorpusSummaryResponse = {
	ok: boolean;
	product_url?: string | null;
	total_examples: number;
	source_counts: Record<string, number>;
	review_type_counts: Record<string, number>;
	duplicate_examples: number;
	product_count: number;
};

type ReviewWorkbenchItem = {
	review_key: string;
	product_url: string;
	product_title?: string | null;
	review_written_at?: string | null;
	collected_at?: string | null;
	rating?: number | null;
	option_text?: string | null;
	review_text: string;
	reviewer_masked_id?: string | null;
	reply_text?: string | null;
	reply_written_at?: string | null;
	reply_exists_flag?: boolean;
	reply_collect_status?: string | null;
	reply_status: string;
	reply_status_label: string;
	draft_id?: string | null;
	draft_status?: string | null;
	draft_text?: string | null;
	can_copy: boolean;
	style_level?: number | null;
	style_preset_id?: string | null;
	style_preset_name?: string | null;
	style_controls: Record<string, number>;
	rejection_comment?: string | null;
	rejection_problem_summary?: string | null;
	rejection_analysis?: Record<string, any>;
	can_rewrite_from_rejection?: boolean;
	has_rejection_history?: boolean;
	rejection_history_count?: number;
};

type ReviewWorkbenchResponse = {
	ok: boolean;
	date_from?: string | null;
	date_to?: string | null;
	product_url?: string | null;
	dashboard: {
		total_reviews: number;
		new_reviews: number;
		completed_count: number;
		enrichment_target_count: number;
		unreplied_count: number;
		draft_pending_count: number;
		approved_count: number;
		rejected_count: number;
		rejection_history_count: number;
	};
	items: ReviewWorkbenchItem[];
};

type ReviewReplyDraftBatchGenerateResponse = {
	ok: boolean;
	requested: number;
	processed: number;
	generated: number;
	reused: number;
	skipped_replied: number;
	skipped_existing: number;
	exhausted?: boolean;
	items: Array<{ draft_id: string; review_key: string }>;
};

type ReviewReplyDraftListItem = {
	draft_id: string;
	review_key: string;
	status: string;
	draft_text: string;
	model_name?: string | null;
	prompt_version?: string | null;
	error_message?: string | null;
	generated_at?: string | null;
	product_url: string;
	review_written_at?: string | null;
	review_text: string;
	option_text?: string | null;
	rating?: number | null;
	reviewer_masked_id?: string | null;
	reply_text?: string | null;
	review_type?: string | null;
	style_profile_source?: string | null;
	style_examples_count?: number;
	style_similarity_score?: number | null;
	style_level?: number | null;
	style_preset_id?: string | null;
	style_preset_name?: string | null;
	style_controls: Record<string, number>;
	rejection_comment?: string | null;
	rejection_problem_summary?: string | null;
	rejection_analysis?: Record<string, any>;
};

type ReviewCollectTrackedResponse = {
	total_targets: number;
	processed_targets: number;
	date_from?: string | null;
	date_to?: string | null;
	fetched: number;
	saved_reviews: number;
	saved_replies: number;
	skipped: number;
	items: Array<{
		product_url: string;
		product_title?: string | null;
		status: string;
		status_label: string;
		fetched: number;
		saved_reviews: number;
		saved_replies: number;
		skipped: number;
		detail?: string | null;
	}>;
};

type ReviewImportSmartstoreResponse = {
	ok: boolean;
	filename: string;
	processed_rows: number;
	saved_reviews: number;
	saved_replies: number;
	reply_exists_rows: number;
	reply_backfill_targets: number;
	matched_products?: number;
	unmatched_products?: number;
	imported_date_from?: string | null;
	imported_date_to?: string | null;
	detail?: string | null;
};

type ReviewReplyBackfillResponse = {
	ok: boolean;
	requested: number;
	processed: number;
	collected: number;
	failed: number;
	skipped: number;
	items: Array<{
		review_key: string;
		review_id_original?: string | null;
		product_title?: string | null;
		status: string;
		detail?: string | null;
		reply_written_at?: string | null;
	}>;
	detail?: string | null;
};

type ReviewReplyBackfillJobResponse = {
	ok: boolean;
	scheduled: boolean;
	job_id?: string | null;
	status: string;
	pending_targets: number;
	processed: number;
	collected: number;
	failed: number;
	skipped: number;
	detail?: string | null;
	started_at?: string | null;
	finished_at?: string | null;
};

type ReviewReplyDraftSubmitResponse = {
	ok: boolean;
	draft_id: string;
	review_key: string;
	status: string;
	result_type?: string | null;
	detail?: string | null;
	reply_written_at?: string | null;
};

type ReviewReplyDraftResponse = {
	ok: boolean;
	review_key: string;
	draft_id: string;
	status: string;
	draft_text: string;
	model_name?: string | null;
	prompt_version?: string | null;
	generated_now: boolean;
	review_text?: string | null;
	reply_text?: string | null;
	error_message?: string | null;
	generated_at?: string | null;
	style_level?: number | null;
	style_preset_id?: string | null;
	style_preset_name?: string | null;
	style_controls: Record<string, number>;
	rejection_comment?: string | null;
	rejection_problem_summary?: string | null;
	rejection_analysis?: Record<string, any>;
};

type ReviewReplyDraftStatusUpdateResponse = {
	ok: boolean;
	draft_id: string;
	review_key: string;
	status: string;
	rejection_comment?: string | null;
	rejection_problem_summary?: string | null;
	rejection_analysis?: Record<string, any>;
};

type ReviewReplyDraftBulkSubmitJobResponse = {
	ok: boolean;
	scheduled: boolean;
	job_id?: string | null;
	status: string;
	pending_targets: number;
	processed: number;
	succeeded: number;
	failed: number;
	skipped: number;
	existing_reply_completed?: number;
	existing_reply_enrichment?: number;
	cancel_requested: boolean;
	detail?: string | null;
	started_at?: string | null;
	finished_at?: string | null;
};

const REPLY_MODEL_OPTIONS = [
	{ value: 'gpt-4o-mini', label: 'gpt-4o-mini', note: '권장 기본값, 비용이 낮고 빠른 생성용' },
	{ value: 'gpt-4o', label: 'gpt-4o', note: '품질과 속도의 균형이 필요한 답글 생성용' },
	{ value: 'gpt-5.4-mini', label: 'gpt-5.4-mini', note: 'GPT-5 계열의 경량 모델' },
	{ value: 'gpt-5.4', label: 'gpt-5.4', note: '더 정교한 문맥 반영이 필요할 때 사용' },
	{ value: 'gpt-5.5', label: 'gpt-5.5', note: '현재 계정에서 조회된 고성능 GPT 모델' },
];

const STYLE_CONTROL_IDS = [
	'greeting_density',
	'gratitude_intensity',
	'empathy_intensity',
	'detail_depth',
	'closing_strength',
] as const;

type Props = {
	apiBaseUrl: string;
	onNavigate?: (path: string) => void;
};

type ReviewStatusFilter = 'all' | 'new' | 'pending' | 'approved' | 'enrichment_target' | 'completed' | 'rejected';
type ReviewRatingFilter = '1' | '2' | '3' | '4' | '5';
type ReviewReplyBulkStage = 'generate' | 'approve' | 'reject' | 'submit' | 'backfill';

type ReviewCollectStatusItem = ReviewCollectTrackedResponse['items'][number];

type ReviewReplyBulkStagePreviewResponse = {
	ok: boolean;
	filtered_total: number;
	filter_summary?: string | null;
	generate_count: number;
	approve_count: number;
	reject_count: number;
	submit_count: number;
	backfill_count: number;
};

type ReviewReplyBulkStageJobResponse = {
	ok: boolean;
	scheduled: boolean;
	job_id?: string | null;
	stage?: ReviewReplyBulkStage | null;
	stage_label?: string | null;
	status: string;
	filtered_total: number;
	pending_targets: number;
	processed: number;
	succeeded: number;
	failed: number;
	skipped: number;
	existing_reply_completed?: number;
	existing_reply_enrichment?: number;
	cancel_requested?: boolean;
	detail?: string | null;
	started_at?: string | null;
	finished_at?: string | null;
};

const REVIEW_ANALYSIS_RATINGS: ReviewRatingFilter[] = ['5', '4', '3', '2', '1'];
const REVIEW_REPLY_BULK_STAGE_LABELS: Record<ReviewReplyBulkStage, string> = {
	generate: '미작성 초안 생성',
	approve: '검토대기 일괄 승인',
	reject: '검토대기 일괄 반려',
	submit: '승인 답글 자동 게시',
	backfill: '답글 본문 보강',
};

function navigateToReviewAnalysisPath(path: string): void {
	window.location.assign(path);
}

function preserveWindowScroll(action: () => void): void {
	const left = window.scrollX;
	const top = window.scrollY;
	action();
	window.requestAnimationFrame(() => {
		window.scrollTo({ left, top, behavior: 'auto' });
	});
}

const BULK_JOB_POLL_INTERVAL_MS = 1500;
const BULK_JOB_POLL_TIMEOUT_MS = 30 * 60 * 1000;

function getNasApiHost(apiBaseUrl: string): string | null {
	try {
		const host = new URL(apiBaseUrl, window.location.origin).hostname;
		if (!host || host === 'localhost' || host === '127.0.0.1') return null;
		return host;
	} catch {
		return null;
	}
}

async function buildReplyBackfillRequestConfig(apiBaseUrl: string): Promise<{ headers?: Record<string, string> }> {
	const nasHost = getNasApiHost(apiBaseUrl);
	if (!nasHost) return {};
	const ip = await discoverNasHostCdpIp({
		nasHost,
		requestLocalAgent: async () => {
			try {
				const res = await axios.get('http://127.0.0.1:9230/network-info', { timeout: 1500 });
				return String(res?.data?.primaryIp || '').trim() || null;
			} catch {
				return null;
			}
		},
		request: async (cidr?: string) => {
			const res = await axios.get(`${apiBaseUrl}/search-rank/page-metrics/discover-host-cdp`, {
				params: cidr ? { cidr } : undefined,
				timeout: 12_000,
			});
			return res.data as any;
		},
	});
	return { headers: buildErp2ClientIpHeaders(ip) };
}

function formatExistingReplySyncSummary(existingReplyCompleted?: number, existingReplyEnrichment?: number): string {
	const parts: string[] = [];
	if (Number(existingReplyCompleted || 0) > 0) parts.push(`기존 답글 자동 완료 ${Number(existingReplyCompleted || 0)}건`);
	if (Number(existingReplyEnrichment || 0) > 0) parts.push(`기존 답글 보강 전이 ${Number(existingReplyEnrichment || 0)}건`);
	return parts.join(', ');
}

function formatBulkSubmitActionMessage(data: ReviewReplyDraftBulkSubmitJobResponse): string {
	const base = `승인 답글 자동 게시 완료: 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
	const extra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
	return extra ? `${base} (${extra})` : base;
}

function formatBulkStageActionMessage(data: ReviewReplyBulkStageJobResponse): string {
	const label = String(data.stage_label || (data.stage ? REVIEW_REPLY_BULK_STAGE_LABELS[data.stage] : '일괄 단계 작업'));
	const base = `${label} 완료: 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
	const extra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
	return extra ? `${base} (${extra})` : base;
}

export function ReviewAnalysisView({ apiBaseUrl, onNavigate = navigateToReviewAnalysisPath }: Props): JSX.Element {
	const auth = useMaybeAuth();
	const [pageTab, setPageTab] = useState<'workbench' | 'knowledge'>('workbench');
	const initialDateRange = useMemo(() => loadStoredReviewAnalysisDateRange(typeof window === 'undefined' ? undefined : window.localStorage), []);
	const initialQuery = useMemo(() => readInitialReviewManagementNavigationQuery(window.location.search, initialDateRange), [initialDateRange]);
	const [trackedProducts, setTrackedProducts] = useState<TrackedProductOption[]>([]);
	const [trackedLoading, setTrackedLoading] = useState<boolean>(true);
	const [trackedError, setTrackedError] = useState<string | null>(null);
	const [selectedProductUrl, setSelectedProductUrl] = useState<string>(initialQuery.productUrl);
	const [selectedModel, setSelectedModel] = useState<string>('gpt-4o-mini');
	const [styleLevel, setStyleLevel] = useState<number>(3);
	const [customControls, setCustomControls] = useState<Record<string, number>>({
		greeting_density: 3,
		gratitude_intensity: 3,
		empathy_intensity: 3,
		detail_depth: 3,
		closing_strength: 3,
	});
	const [batchSize, setBatchSize] = useState<number>(10);
	const [presetRecommendation, setPresetRecommendation] = useState<ReviewReplyStylePresetRecommendationResponse | null>(null);
	const [presetLoading, setPresetLoading] = useState<boolean>(false);
	const [presetError, setPresetError] = useState<string | null>(null);
	const [corpusSummary, setCorpusSummary] = useState<ReviewReplyStyleCorpusSummaryResponse | null>(null);
	const [corpusLoading, setCorpusLoading] = useState<boolean>(false);
	const [corpusError, setCorpusError] = useState<string | null>(null);
	const [workbench, setWorkbench] = useState<ReviewWorkbenchResponse | null>(null);
	const [workbenchLoading, setWorkbenchLoading] = useState<boolean>(false);
	const [workbenchError, setWorkbenchError] = useState<string | null>(null);
	const [rejectionHistoryItems, setRejectionHistoryItems] = useState<ReviewReplyDraftListItem[]>([]);
	const [rejectionHistoryLoading, setRejectionHistoryLoading] = useState<boolean>(false);
	const [rejectionHistoryError, setRejectionHistoryError] = useState<string | null>(null);
	const [rejectionHistoryCommentEdits, setRejectionHistoryCommentEdits] = useState<Record<string, string>>({});
	const [rejectionHistorySavingId, setRejectionHistorySavingId] = useState<string | null>(null);
	const [rejectionHistoryDeletingId, setRejectionHistoryDeletingId] = useState<string | null>(null);
	const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
	const [generateLoading, setGenerateLoading] = useState<boolean>(false);
	const [regenerateLoading, setRegenerateLoading] = useState<boolean>(false);
	const [collectTrackedLoading, setCollectTrackedLoading] = useState<boolean>(false);
	const [importLoading, setImportLoading] = useState<boolean>(false);
	const [replyBackfillLoading, setReplyBackfillLoading] = useState<boolean>(false);
	const [replyBackfillJobId, setReplyBackfillJobId] = useState<string | null>(null);
	const [submitLoadingId, setSubmitLoadingId] = useState<string | null>(null);
	const [bulkSubmitLoading, setBulkSubmitLoading] = useState<boolean>(false);
	const [bulkSubmitStopping, setBulkSubmitStopping] = useState<boolean>(false);
	const [bulkSubmitJobId, setBulkSubmitJobId] = useState<string | null>(null);
	const [bulkStagePreview, setBulkStagePreview] = useState<ReviewReplyBulkStagePreviewResponse | null>(null);
	const [bulkStagePreviewLoading, setBulkStagePreviewLoading] = useState<boolean>(false);
	const [bulkStageRunning, setBulkStageRunning] = useState<boolean>(false);
	const [bulkStageStopping, setBulkStageStopping] = useState<boolean>(false);
	const [bulkStageJobId, setBulkStageJobId] = useState<string | null>(null);
	const [bulkStageRunningStage, setBulkStageRunningStage] = useState<ReviewReplyBulkStage | null>(null);
	const [roleLevel, setRoleLevel] = useState<string>('');
	const [reviewUploadFile, setReviewUploadFile] = useState<File | null>(null);
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
	const [draftSavingId, setDraftSavingId] = useState<string | null>(null);
	const [rejectingItem, setRejectingItem] = useState<ReviewWorkbenchItem | null>(null);
	const [feedbackHistoryItem, setFeedbackHistoryItem] = useState<ReviewWorkbenchItem | null>(null);
	const [rejectionCommentInput, setRejectionCommentInput] = useState<string>('');
	const rejectionCommentInputRef = useRef<HTMLTextAreaElement | null>(null);
	const [dateFrom, setDateFrom] = useState<string>(initialQuery.dateFrom);
	const [dateTo, setDateTo] = useState<string>(initialQuery.dateTo);
	const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('all');
	const [rejectionHistoryOnly, setRejectionHistoryOnly] = useState<boolean>(false);
	const [ratingFilters, setRatingFilters] = useState<ReviewRatingFilter[]>([...REVIEW_ANALYSIS_RATINGS]);
	const [collectStatusItems, setCollectStatusItems] = useState<ReviewCollectStatusItem[]>([]);
	const [collectStatusCollapsed, setCollectStatusCollapsed] = useState<boolean>(true);
	const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(false);
	const activeProductUrl = selectedProductUrl;
	const isAdminRole = roleLevel === 'superadmin' || roleLevel === 'ops_admin';
	const isSuperAdminRole = roleLevel === 'superadmin';
	const isOpsAdminRole = roleLevel === 'ops_admin';
	const roleProtectedGet = useCallback(
		async <T,>(url: string, config?: Record<string, any>) =>
			await authRetryGet<T>(
				axios,
				auth?.getIdToken ? (options) => auth.getIdToken(options) : undefined,
				url,
				config,
			),
		[auth],
	);

	const roleProtectedPost = useCallback(
		async <T,>(url: string, body?: any, config?: Record<string, any>) =>
			await authRetryPost<T>(
				axios,
				auth?.getIdToken ? (options) => auth.getIdToken(options) : undefined,
				url,
				body,
				config,
			),
		[auth],
	);

	useEffect(() => {
		let alive = true;
		(async () => {
			if (!auth?.user) {
				if (alive) setRoleLevel('');
				return;
			}
			try {
				const token = await auth.getIdToken({ forceRefresh: false });
				const payload = token ? decodeJwtPayload(token) : null;
				const roles = normalizeAnalyticsRolesFromClaims({ role: payload?.role, roles: payload?.roles });
				if (!alive) return;
				setRoleLevel(roles.includes('superadmin') ? 'superadmin' : roles.includes('ops_admin') ? 'ops_admin' : '');
			} catch {
				if (!alive) return;
				setRoleLevel('');
			}
		})();
		return () => {
			alive = false;
		};
	}, [auth, auth?.user?.uid]);

	const loadTrackedProducts = useCallback(async () => {
		setTrackedLoading(true);
		setTrackedError(null);
		try {
			const res = await axios.get(`${apiBaseUrl}/search-rank/tracked`);
			const rows = Array.isArray(res.data) ? (res.data as TrackedKeywordRow[]) : [];
			const byUrl = new Map<string, Set<string>>();
			rows.forEach((row) => {
				const productUrl = String(row?.product_url || '').trim();
				const keyword = String(row?.keyword || '').trim();
				if (!productUrl) return;
				if (!byUrl.has(productUrl)) byUrl.set(productUrl, new Set<string>());
				if (keyword) byUrl.get(productUrl)?.add(keyword);
			});
			const urlEntries = Array.from(byUrl.entries());
			const metadataItems = urlEntries.map(([productUrl, keywords], index) => ({
				id: `tracked-${index}`,
				keyword: Array.from(keywords.values())[0] || '',
				product_url: productUrl,
			}));
			const metadataMap = new Map<string, string>();
			if (metadataItems.length > 0) {
				try {
					const metaRes = await axios.post(`${apiBaseUrl}/search-rank/product-metadata/batch`, { items: metadataItems });
					const rawMeta = metaRes?.data && typeof metaRes.data === 'object' ? metaRes.data as Record<string, { title?: string | null }> : {};
					metadataItems.forEach((item) => {
						const title = String(rawMeta?.[item.id]?.title || '').trim();
						if (title) metadataMap.set(item.product_url, title);
					});
				} catch {
					// 메타 조회 실패 시에도 추적 상품 목록은 URL 기반으로 계속 사용한다.
				}
			}
			const items = urlEntries.map(([productUrl, keywords]) => ({
				productUrl,
				productTitle: metadataMap.get(productUrl) || null,
				keywords: Array.from(keywords.values()),
			}));
			setTrackedProducts(items);
			setSelectedProductUrl((prev) => {
				if (prev && items.some((item) => item.productUrl === prev)) return prev;
				return '';
			});
		} catch (error: any) {
			setTrackedError(String(error?.message || '추적 상품 목록을 불러오지 못했습니다.'));
		} finally {
			setTrackedLoading(false);
		}
	}, [apiBaseUrl]);

	useEffect(() => {
		void loadTrackedProducts();
	}, [loadTrackedProducts]);

	const loadPresetRecommendation = useCallback(
		async (productUrl: string) => {
			setPresetLoading(true);
			setPresetError(null);
			try {
				const res = await axios.get(`${apiBaseUrl}/reviews/reply-style/preset-recommendations`, {
					params: productUrl ? { product_url: productUrl } : undefined,
				});
				setPresetRecommendation(res.data as ReviewReplyStylePresetRecommendationResponse);
			} catch (error: any) {
				setPresetError(String(error?.message || '스타일 프리셋 정보를 불러오지 못했습니다.'));
			} finally {
				setPresetLoading(false);
			}
		},
		[apiBaseUrl],
	);

	const loadCorpusSummary = useCallback(
		async (productUrl: string) => {
			setCorpusLoading(true);
			setCorpusError(null);
			try {
				const res = await axios.get(`${apiBaseUrl}/reviews/reply-style/corpus-summary`, {
					params: productUrl ? { product_url: productUrl, limit: 200 } : { limit: 200 },
				});
				setCorpusSummary(res.data as ReviewReplyStyleCorpusSummaryResponse);
			} catch (error: any) {
				setCorpusError(String(error?.message || '답글 코퍼스 요약을 불러오지 못했습니다.'));
			} finally {
				setCorpusLoading(false);
			}
		},
		[apiBaseUrl],
	);

	const loadWorkbench = useCallback(
		async (
			productUrl: string,
			nextDateFrom: string,
			nextDateTo: string,
			options?: { overwriteDraftIds?: Set<string> | 'all' },
		) => {
			setWorkbenchLoading(true);
			setWorkbenchError(null);
			try {
				const res = await axios.get(`${apiBaseUrl}/reviews/workbench`, {
					params: {
						product_url: productUrl || undefined,
						date_from: nextDateFrom || undefined,
						date_to: nextDateTo || undefined,
						status_filter: statusFilter,
						has_rejection_history_only: rejectionHistoryOnly || undefined,
						rating_filters: [...ratingFilters],
						limit: 2000,
					},
					paramsSerializer: { serialize: serializeQueryParams },
				});
				const data = res.data as ReviewWorkbenchResponse;
				const items = Array.isArray(data?.items) ? data.items : [];
				setWorkbench({ ...data, items });
				setDraftEdits((prev) => {
					const next = { ...prev };
					const overwriteDraftIds = options?.overwriteDraftIds;
					items.forEach((item) => {
						if (!item.draft_id) return;
						const shouldOverwrite =
							overwriteDraftIds === 'all' ||
							(overwriteDraftIds instanceof Set && overwriteDraftIds.has(item.draft_id));
						if (shouldOverwrite || typeof next[item.draft_id] !== 'string') {
							next[item.draft_id] = item.draft_text || '';
						}
					});
					return next;
				});
			} catch (error: any) {
				setWorkbenchError(String(error?.message || '리뷰 작업 목록을 불러오지 못했습니다.'));
			} finally {
				setWorkbenchLoading(false);
			}
		},
		[apiBaseUrl, ratingFilters, rejectionHistoryOnly, statusFilter],
	);

	const loadRejectionHistory = useCallback(
		async (productUrl: string, nextDateFrom: string, nextDateTo: string) => {
			setRejectionHistoryLoading(true);
			setRejectionHistoryError(null);
			try {
				const res = await roleProtectedGet<ReviewReplyDraftListItem[]>(`${apiBaseUrl}/reviews/reply-drafts/rejection-history`, {
					params: {
						product_url: productUrl || undefined,
						date_from: nextDateFrom || undefined,
						date_to: nextDateTo || undefined,
						rating_filters: [...ratingFilters],
						limit: 200,
					},
					paramsSerializer: { serialize: serializeQueryParams },
				});
				const items = Array.isArray(res.data) ? res.data : [];
				setRejectionHistoryItems(items);
				setRejectionHistoryCommentEdits((prev) => {
					const next = { ...prev };
					items.forEach((item) => {
						const draftId = String(item.draft_id || '').trim();
						if (!draftId) return;
						if (typeof next[draftId] !== 'string') {
							next[draftId] = String(item.rejection_comment || '');
						}
					});
					return next;
				});
			} catch (error: any) {
				setRejectionHistoryError(String(error?.response?.data?.detail ?? error?.message ?? '반려 이력 목록을 불러오지 못했습니다.'));
			} finally {
				setRejectionHistoryLoading(false);
			}
		},
		[apiBaseUrl, ratingFilters, roleProtectedGet],
	);

	useEffect(() => {
		void loadPresetRecommendation(activeProductUrl);
		void loadCorpusSummary(activeProductUrl);
	}, [activeProductUrl, loadCorpusSummary, loadPresetRecommendation]);

	useEffect(() => {
		void loadWorkbench(activeProductUrl, dateFrom, dateTo);
	}, [activeProductUrl, dateFrom, dateTo, loadWorkbench, ratingFilters, rejectionHistoryOnly, statusFilter]);

	useEffect(() => {
		void loadRejectionHistory(activeProductUrl, dateFrom, dateTo);
	}, [activeProductUrl, dateFrom, dateTo, loadRejectionHistory, ratingFilters]);

	useEffect(() => {
		storeReviewAnalysisDateRange(typeof window === 'undefined' ? undefined : window.localStorage, {
			from: dateFrom,
			to: dateTo,
		});
	}, [dateFrom, dateTo]);

	const rawWorkbenchItems = workbench?.items || [];

	const runCollectForAll = useCallback(async () => {
		if (trackedProducts.length === 0) return;
		setCollectTrackedLoading(true);
		setCollectStatusCollapsed(false);
		setActionMessage(null);
		setActionError(null);
		setCollectStatusItems(
			trackedProducts.map((item) => ({
				product_url: item.productUrl,
				product_title: item.productTitle || null,
				status: 'pending',
				status_label: '대기',
				fetched: 0,
				saved_reviews: 0,
				saved_replies: 0,
				skipped: 0,
				detail: '수집 대기',
			})),
		);
		try {
			const res = await axios.post(`${apiBaseUrl}/reviews/collect-tracked`, {
				date_from: dateFrom || undefined,
				date_to: dateTo || undefined,
				max_targets: 0,
				max_pages: 3,
				max_items: 100,
			});
			const data = res.data as ReviewCollectTrackedResponse;
			setCollectStatusItems(Array.isArray(data.items) ? data.items : []);
			setActionMessage(`전체 추적 상품 리뷰 수집 완료: 대상 ${data.processed_targets}개, 리뷰 ${data.saved_reviews}건, 답글 ${data.saved_replies}건 저장`);
			await loadCorpusSummary(activeProductUrl);
			await loadWorkbench(activeProductUrl, dateFrom, dateTo);
		} catch (error: any) {
			setCollectStatusItems((prev) =>
				prev.map((item) => ({
					...item,
					status: 'failed',
					status_label: '실패',
					detail: '수집 실패',
				})),
			);
			setActionError(String(error?.response?.data?.detail ?? error?.message ?? '전체 추적 상품 리뷰 수집에 실패했습니다.'));
		} finally {
			setCollectTrackedLoading(false);
		}
	}, [activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadCorpusSummary, loadWorkbench, trackedProducts]);

	const runImportSmartstoreFile = useCallback(async () => {
		if (!reviewUploadFile) {
			setActionError('업로드할 스마트스토어 리뷰 파일을 선택해 주세요.');
			return;
		}
		setImportLoading(true);
		setActionMessage(null);
		setActionError(null);
		try {
			const form = new FormData();
			form.append('file', reviewUploadFile);
			const res = await axios.post(`${apiBaseUrl}/reviews/import-smartstore-file`, form, {
				headers: { 'Content-Type': 'multipart/form-data' },
				timeout: 120000,
			});
			const data = res.data as ReviewImportSmartstoreResponse;
			const importedDateFrom = String(data.imported_date_from || '').trim();
			const importedDateTo = String(data.imported_date_to || '').trim();
			const nextDateFrom = importedDateFrom || dateFrom;
			const nextDateTo = importedDateTo || dateTo;
			const productMatchText =
				typeof data.matched_products === 'number' || typeof data.unmatched_products === 'number'
					? `, 상품 매칭 ${Number(data.matched_products || 0)}개, 미매칭 ${Number(data.unmatched_products || 0)}개`
					: '';
			setActionMessage(
				`리뷰 업로드 완료: 리뷰 ${data.saved_reviews}건 저장, 답글 있음 ${data.reply_exists_rows}건, 본문 보강 대상 ${data.reply_backfill_targets}건${productMatchText}`,
			);
			setReviewUploadFile(null);
			if (importedDateFrom) setDateFrom(importedDateFrom);
			if (importedDateTo) setDateTo(importedDateTo);
			await loadCorpusSummary(activeProductUrl);
			await loadWorkbench(activeProductUrl, nextDateFrom, nextDateTo);
		} catch (error: any) {
			setActionError(String(error?.response?.data?.detail ?? error?.message ?? '리뷰 업로드에 실패했습니다.'));
		} finally {
			setImportLoading(false);
		}
	}, [activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadCorpusSummary, loadWorkbench, reviewUploadFile]);

	const pollReplyBackfillJob = useCallback(
		async (jobId?: string | null) => {
			const targetJobId = String(jobId || '').trim();
			let lastMessage = '';
			for (let attempt = 0; attempt < 120; attempt += 1) {
				const res = await axios.get(`${apiBaseUrl}/reviews/reply-backfill/status`, {
					params: targetJobId ? { job_id: targetJobId } : undefined,
					timeout: 30000,
				});
				const data = res.data as ReviewReplyBackfillJobResponse;
				const detail = String(data.detail || '').trim();
				if (String(data.status || '').toUpperCase() === 'STARTED') {
					const progressMessage =
						`답글 본문 보강 진행 중: 처리 ${data.processed}건, 수집 ${data.collected}건, 미매칭 ${data.skipped}건, 실패 ${data.failed}건`;
					if (progressMessage !== lastMessage) {
						setActionMessage(progressMessage);
						lastMessage = progressMessage;
					}
					await new Promise((resolve) => window.setTimeout(resolve, 1500));
					continue;
				}
				setReplyBackfillJobId(null);
				setReplyBackfillLoading(false);
				if (String(data.status || '').toUpperCase() === 'FAILED') {
					setActionError(detail || '판매자센터 답글 본문 보강에 실패했습니다.');
				} else if (data.processed > 0 || data.collected > 0 || data.failed > 0 || data.skipped > 0) {
					setActionMessage(`답글 본문 보강 완료: 수집 ${data.collected}건, 미매칭 ${data.skipped}건, 실패 ${data.failed}건`);
				} else {
					setActionMessage(detail || '보강할 답글 대상이 없습니다.');
				}
				await loadCorpusSummary(activeProductUrl);
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
				return;
			}
			setReplyBackfillJobId(null);
			setReplyBackfillLoading(false);
			setActionError('답글 본문 보강 상태 확인이 지연되고 있습니다. 잠시 후 새로고침해 주세요.');
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadCorpusSummary, loadWorkbench],
	);

	useEffect(() => {
		if (replyBackfillLoading) return;
		let cancelled = false;
		const resumeBackfillIfNeeded = async () => {
			try {
				const res = await axios.get(`${apiBaseUrl}/reviews/reply-backfill/status`, { timeout: 30000 });
				const data = res.data as ReviewReplyBackfillJobResponse;
				if (cancelled) return;
				if (String(data.status || '').toUpperCase() !== 'STARTED') return;
				const jobId = String(data.job_id || '').trim();
				setReplyBackfillLoading(true);
				setReplyBackfillJobId(jobId || null);
				void pollReplyBackfillJob(jobId || null);
			} catch {
				// 상태 자동 복구 조회 실패는 무시하고 수동 실행을 허용한다.
			}
		};
		void resumeBackfillIfNeeded();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, pollReplyBackfillJob, replyBackfillLoading]);

	const runReplyBackfill = useCallback(async () => {
		setReplyBackfillLoading(true);
		setReplyBackfillJobId(null);
		setActionMessage(null);
		setActionError(null);
		try {
			const requestConfig = await buildReplyBackfillRequestConfig(apiBaseUrl);
			const res = await axios.post(`${apiBaseUrl}/reviews/reply-backfill/start`, {
				limit: 0,
				max_pages: 30,
			}, requestConfig);
			const data = res.data as ReviewReplyBackfillJobResponse;
			const jobId = String(data.job_id || '').trim();
			if (String(data.status || '').toUpperCase() === 'STARTED' && jobId) {
				setReplyBackfillJobId(jobId);
				setActionMessage(data.detail || '답글 본문 보강 작업을 시작했습니다.');
				await pollReplyBackfillJob(jobId);
				return;
			}
			setReplyBackfillLoading(false);
			setActionMessage(String(data.detail || '보강할 답글 대상이 없습니다.'));
			await loadWorkbench(activeProductUrl, dateFrom, dateTo);
		} catch (error: any) {
			setActionError(String(error?.response?.data?.detail ?? error?.message ?? '판매자센터 답글 본문 보강에 실패했습니다.'));
			setReplyBackfillLoading(false);
			setReplyBackfillJobId(null);
		}
	}, [activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadWorkbench, pollReplyBackfillJob]);

	const runGenerateBatch = useCallback(async () => {
		if (!activeProductUrl && trackedProducts.length === 0) return;
		setGenerateLoading(true);
		setActionMessage(null);
		setActionError(null);
		try {
			const chunkSize = Math.max(1, Math.min(batchSize, 30));
			let totalGenerated = 0;
			let totalReused = 0;
			let totalSkipped = 0;
			let loopCount = 0;
			while (loopCount < 100) {
				loopCount += 1;
				const res = await axios.post(`${apiBaseUrl}/reviews/reply-drafts/generate-batch`, {
					product_url: activeProductUrl || undefined,
					date_from: dateFrom || undefined,
					date_to: dateTo || undefined,
					rating_filters: [...ratingFilters],
					max_items: chunkSize,
					model: selectedModel,
					style_level: styleLevel,
					style_controls: styleLevel === 6 ? customControls : undefined,
				});
				const data = res.data as ReviewReplyDraftBatchGenerateResponse;
				totalGenerated += Number(data.generated || 0);
				totalReused += Number(data.reused || 0);
				totalSkipped += Number(data.skipped_existing || 0) + Number(data.skipped_replied || 0);
				setActionMessage(
					`초안 생성 진행 중: 신규 ${totalGenerated}건, 재사용 ${totalReused}건, 기존/답글존재 스킵 ${totalSkipped}건`,
				);
				const exhausted = typeof data.exhausted === 'boolean' ? data.exhausted : Number(data.processed || 0) < chunkSize;
				if (exhausted) break;
			}
			setActionMessage(`초안 생성 완료: 신규 ${totalGenerated}건, 재사용 ${totalReused}건, 기존/답글존재 스킵 ${totalSkipped}건`);
			await loadWorkbench(activeProductUrl, dateFrom, dateTo);
		} catch (error: any) {
			setActionError(normalizeReviewReplyActionError(error, '초안 배치 생성에 실패했습니다.'));
		} finally {
			setGenerateLoading(false);
		}
	}, [activeProductUrl, apiBaseUrl, batchSize, customControls, dateFrom, dateTo, loadWorkbench, ratingFilters, selectedModel, styleLevel, trackedProducts.length]);

	const runRegeneratePendingDrafts = useCallback(async () => {
		const pendingItems = rawWorkbenchItems.filter((item) => item.reply_status === 'pending' && item.draft_id);
		if (pendingItems.length === 0) {
			setActionError('재생성할 검토대기 초안이 없습니다.');
			return;
		}
		setRegenerateLoading(true);
		setActionMessage(null);
		setActionError(null);
		let succeeded = 0;
		let failed = 0;
		try {
			for (const item of pendingItems) {
				try {
					await axios.post(`${apiBaseUrl}/reviews/reply-drafts/generate`, {
						review_key: item.review_key,
						model: selectedModel,
						force_regenerate: true,
						style_level: styleLevel,
						style_controls: styleLevel === 6 ? customControls : undefined,
					});
					succeeded += 1;
				} catch {
					failed += 1;
				}
			}
			setActionMessage(`검토대기 초안 재생성 완료: ${succeeded}건`);
			if (failed > 0) {
				setActionError(`일부 초안 재생성 실패: ${failed}건`);
			}
			await loadWorkbench(activeProductUrl, dateFrom, dateTo, { overwriteDraftIds: 'all' });
		} finally {
			setRegenerateLoading(false);
		}
	}, [activeProductUrl, apiBaseUrl, customControls, dateFrom, dateTo, loadWorkbench, rawWorkbenchItems, selectedModel, styleLevel]);

	const approveDraft = useCallback(
		async (item: ReviewWorkbenchItem) => {
			const draftId = String(item.draft_id || '').trim();
			if (!draftId) {
				setActionError('승인할 초안이 없습니다.');
				return;
			}
			const draftText = String(draftEdits[draftId] ?? item.draft_text ?? '').trim();
			if (!draftText) {
				setActionError('빈 초안은 승인할 수 없습니다.');
				return;
			}
			setStatusUpdatingId(draftId);
			setActionMessage(null);
			setActionError(null);
			try {
				await roleProtectedPost(`${apiBaseUrl}/reviews/reply-drafts/update`, { draft_id: draftId, draft_text: draftText });
				await roleProtectedPost(`${apiBaseUrl}/reviews/reply-drafts/status`, { draft_id: draftId, status: 'approved' });
				setActionMessage('초안을 저장 후 승인했습니다.');
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
			} catch (error: any) {
				setActionError(String(error?.response?.data?.detail ?? error?.message ?? '초안 승인에 실패했습니다.'));
			} finally {
				setStatusUpdatingId(null);
			}
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, draftEdits, loadWorkbench, roleProtectedPost],
	);

	const openRejectDraftModal = useCallback((item: ReviewWorkbenchItem) => {
		setRejectingItem(item);
		setRejectionCommentInput(String(item.rejection_comment || '').trim());
		setActionMessage(null);
		setActionError(null);
	}, []);

	const closeRejectDraftModal = useCallback(() => {
		setRejectingItem(null);
		setRejectionCommentInput('');
	}, []);

	const openFeedbackHistory = useCallback((item: ReviewWorkbenchItem) => {
		setFeedbackHistoryItem(item);
	}, []);

	const closeFeedbackHistory = useCallback(() => {
		setFeedbackHistoryItem(null);
	}, []);

	useEffect(() => {
		if (!rejectingItem) return;
		const timer = window.setTimeout(() => {
			rejectionCommentInputRef.current?.focus();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [rejectingItem]);

	useEffect(() => {
		if (!rejectingItem) return;
		const draftId = String(rejectingItem.draft_id || '').trim();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			if (statusUpdatingId && statusUpdatingId === draftId) return;
			closeRejectDraftModal();
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [closeRejectDraftModal, rejectingItem, statusUpdatingId]);

	const rejectDraft = useCallback(
		async (item: ReviewWorkbenchItem | null | undefined) => {
			const draftId0 = String(item?.draft_id || '').trim();
			const rejectionComment = String(rejectionCommentInput || '').trim();
			if (!draftId0) {
				setActionError('반려할 초안이 없습니다.');
				return;
			}
			if (!rejectionComment) {
				setActionError('반려 사유를 입력해 주세요.');
				return;
			}
			setStatusUpdatingId(draftId0);
			setActionMessage(null);
			setActionError(null);
			try {
				await roleProtectedPost<ReviewReplyDraftStatusUpdateResponse>(`${apiBaseUrl}/reviews/reply-drafts/status`, {
					draft_id: draftId0,
					status: 'rejected',
					rejection_comment: rejectionComment,
					analyze_rejection: true,
				});
				await roleProtectedPost<ReviewReplyDraftResponse>(`${apiBaseUrl}/reviews/reply-drafts/rewrite-from-rejection`, {
					draft_id: draftId0,
					model: selectedModel,
				});
				closeRejectDraftModal();
				setActionMessage('반려 사유를 저장하고 GPT가 새 초안을 작성했습니다.');
				await loadWorkbench(activeProductUrl, dateFrom, dateTo, { overwriteDraftIds: 'all' });
			} catch (error: any) {
				setActionError(String(error?.response?.data?.detail ?? error?.message ?? '초안 반려에 실패했습니다.'));
			} finally {
				setStatusUpdatingId(null);
			}
		},
		[activeProductUrl, apiBaseUrl, closeRejectDraftModal, dateFrom, dateTo, loadWorkbench, rejectionCommentInput, roleProtectedPost, selectedModel],
	);

	const rewriteRejectedDraft = useCallback(
		async (item: ReviewWorkbenchItem) => {
			const draftId0 = String(item?.draft_id || '').trim();
			if (!draftId0) {
				setActionError('재작성할 반려 초안이 없습니다.');
				return;
			}
			setStatusUpdatingId(draftId0);
			setActionMessage(null);
			setActionError(null);
			try {
				await roleProtectedPost<ReviewReplyDraftResponse>(`${apiBaseUrl}/reviews/reply-drafts/rewrite-from-rejection`, {
					draft_id: draftId0,
					model: selectedModel,
				});
				setActionMessage('반려 사유를 반영해 초안을 새로 작성했습니다.');
				await loadWorkbench(activeProductUrl, dateFrom, dateTo, { overwriteDraftIds: 'all' });
			} catch (error: any) {
				setActionError(String(error?.response?.data?.detail ?? error?.message ?? '반려 반영 재작성에 실패했습니다.'));
			} finally {
				setStatusUpdatingId(null);
			}
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadWorkbench, roleProtectedPost, selectedModel],
	);

	const saveRejectionHistoryComment = useCallback(
		async (item: ReviewReplyDraftListItem) => {
			const draftId = String(item.draft_id || '').trim();
			const rejectionComment = String(rejectionHistoryCommentEdits[draftId] ?? item.rejection_comment ?? '').trim();
			if (!draftId) {
				setActionError('수정할 반려 이력이 없습니다.');
				return;
			}
			if (!rejectionComment) {
				setActionError('반려 커멘트를 입력해 주세요.');
				return;
			}
			setRejectionHistorySavingId(draftId);
			setActionMessage(null);
			setActionError(null);
			try {
				await roleProtectedPost<ReviewReplyDraftListItem>(`${apiBaseUrl}/reviews/reply-drafts/rejection-comment/update`, {
					draft_id: draftId,
					rejection_comment: rejectionComment,
					analyze_rejection: true,
				});
				setActionMessage('반려 커멘트를 수정했습니다.');
				await Promise.all([
					loadWorkbench(activeProductUrl, dateFrom, dateTo, { overwriteDraftIds: 'all' }),
					loadRejectionHistory(activeProductUrl, dateFrom, dateTo),
				]);
			} catch (error: any) {
				setActionError(String(error?.response?.data?.detail ?? error?.message ?? '반려 커멘트 수정에 실패했습니다.'));
			} finally {
				setRejectionHistorySavingId(null);
			}
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadRejectionHistory, loadWorkbench, rejectionHistoryCommentEdits, roleProtectedPost],
	);

	const deleteRejectionHistoryComment = useCallback(
		async (item: ReviewReplyDraftListItem) => {
			const draftId = String(item.draft_id || '').trim();
			if (!draftId) {
				setActionError('삭제할 반려 이력이 없습니다.');
				return;
			}
			if (!window.confirm('이 반려 커멘트를 삭제할까요? 관련 AI 분석도 함께 제거됩니다.')) return;
			setRejectionHistoryDeletingId(draftId);
			setActionMessage(null);
			setActionError(null);
			try {
				await roleProtectedPost(`${apiBaseUrl}/reviews/reply-drafts/rejection-comment/delete`, { draft_id: draftId });
				setActionMessage('반려 커멘트를 삭제했습니다.');
				setRejectionHistoryCommentEdits((prev) => {
					const next = { ...prev };
					delete next[draftId];
					return next;
				});
				await Promise.all([
					loadWorkbench(activeProductUrl, dateFrom, dateTo, { overwriteDraftIds: 'all' }),
					loadRejectionHistory(activeProductUrl, dateFrom, dateTo),
				]);
			} catch (error: any) {
				setActionError(String(error?.response?.data?.detail ?? error?.message ?? '반려 커멘트 삭제에 실패했습니다.'));
			} finally {
				setRejectionHistoryDeletingId(null);
			}
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadRejectionHistory, loadWorkbench, roleProtectedPost],
	);

	const feedbackMustAvoid = useMemo(() => {
		const values = feedbackHistoryItem?.rejection_analysis?.must_avoid;
		return Array.isArray(values) ? values.map((item) => String(item || '').trim()).filter(Boolean) : [];
	}, [feedbackHistoryItem]);

	const feedbackRewriteGuidance = useMemo(() => {
		const values = feedbackHistoryItem?.rejection_analysis?.rewrite_guidance;
		return Array.isArray(values) ? values.map((item) => String(item || '').trim()).filter(Boolean) : [];
	}, [feedbackHistoryItem]);

	const copyDraft = useCallback(
		async (item: ReviewWorkbenchItem) => {
			const draftId = String(item.draft_id || '').trim();
			const text = String((draftId ? draftEdits[draftId] : '') || item.draft_text || '').trim();
			if (!item.can_copy || !text) return;
			try {
				await navigator.clipboard.writeText(text);
				setActionMessage('초안을 클립보드에 복사했습니다.');
				setActionError(null);
			} catch (error: any) {
				setActionError(String(error?.message || '클립보드 복사에 실패했습니다.'));
			}
		},
		[draftEdits],
	);

	const submitDraft = useCallback(
		async (item: ReviewWorkbenchItem) => {
			const draftId = String(item.draft_id || '').trim();
			if (!draftId) {
				setActionError('자동 게시할 승인 초안이 없습니다.');
				return;
			}
			if (!window.confirm('이 승인 초안을 스마트스토어 판매자센터에 자동 게시할까요?')) return;
			setSubmitLoadingId(draftId);
			setActionMessage(null);
			setActionError(null);
			try {
				const res = await roleProtectedPost<ReviewReplyDraftSubmitResponse>(`${apiBaseUrl}/reviews/reply-drafts/submit`, { draft_id: draftId });
				const data = res.data as ReviewReplyDraftSubmitResponse;
				setActionError(null);
				setActionMessage(`자동 게시 완료: ${String(data.detail || '판매자센터에 답글을 등록했습니다.')}`);
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
			} catch (error: any) {
				const message = normalizeReviewReplyActionError(error, '자동 게시에 실패했습니다.');
				setActionError(message);
				if (message === '상품 리뷰 수집을 먼저 진행 후 실행해주세요.') {
					try {
						window.alert(message);
					} catch {
						// ignore
					}
				}
			} finally {
				setSubmitLoadingId(null);
			}
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadWorkbench, roleProtectedPost],
	);

	const manuallyCompleteExistingReply = useCallback(
		async (item: ReviewWorkbenchItem) => {
			const draftId = String(item.draft_id || '').trim();
			if (!draftId) {
				setActionError('완료 처리할 초안이 없습니다.');
				return;
			}
			if (!window.confirm('기존 답글 존재를 기준으로 이 항목을 완료 처리할까요?')) return;
			setActionMessage(null);
			setActionError(null);
			try {
				const res = await roleProtectedPost<ReviewReplyDraftSubmitResponse>(`${apiBaseUrl}/reviews/reply-drafts/manual-complete`, { draft_id: draftId });
				const data = res.data as ReviewReplyDraftSubmitResponse;
				setActionMessage(String(data.detail || '관리자가 기존 답글 존재를 확인해 완료 처리했습니다.'));
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
			} catch (error: any) {
				setActionError(normalizeReviewReplyActionError(error, '수동 완료 처리에 실패했습니다.'));
			}
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadWorkbench, roleProtectedPost],
	);

	const pollBulkSubmitJob = useCallback(
		async (jobId?: string | null) => {
			const targetJobId = String(jobId || '').trim();
			let lastMessage = '';
			let transientErrorCount = 0;
			const deadline = Date.now() + BULK_JOB_POLL_TIMEOUT_MS;
			while (Date.now() < deadline) {
				let data: ReviewReplyDraftBulkSubmitJobResponse;
				try {
					const res = await roleProtectedGet<ReviewReplyDraftBulkSubmitJobResponse>(`${apiBaseUrl}/reviews/reply-drafts/bulk-submit/status`, {
						params: targetJobId ? { job_id: targetJobId } : undefined,
					});
					data = res.data as ReviewReplyDraftBulkSubmitJobResponse;
					transientErrorCount = 0;
				} catch (error: any) {
					if (isTransientPollingError(error) && transientErrorCount < 5) {
						transientErrorCount += 1;
						const retryMessage = `승인 답글 자동 게시 상태 확인이 잠시 지연되었습니다. 자동으로 다시 확인합니다. (${transientErrorCount}/5)`;
						if (retryMessage !== lastMessage) {
							setActionMessage(retryMessage);
							lastMessage = retryMessage;
						}
						await new Promise((resolve) => window.setTimeout(resolve, BULK_JOB_POLL_INTERVAL_MS));
						continue;
					}
					throw error;
				}
				const detail = String(data.detail || '').trim();
				if (String(data.status || '').toUpperCase() === 'STARTED') {
					const progressBase = data.cancel_requested
						? '승인 답글 자동 게시 중지 요청을 보냈습니다. 현재 처리 중인 건까지 마무리한 뒤 멈춥니다.'
						: `승인 답글 자동 게시 진행 중: 처리 ${data.processed}건, 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
					const progressExtra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
					const progressMessage = !data.cancel_requested && progressExtra ? `${progressBase} (${progressExtra})` : progressBase;
					if (progressMessage !== lastMessage) {
						setActionMessage(progressMessage);
						lastMessage = progressMessage;
					}
					await new Promise((resolve) => window.setTimeout(resolve, BULK_JOB_POLL_INTERVAL_MS));
					continue;
				}
				setBulkSubmitJobId(null);
				setBulkSubmitLoading(false);
				setBulkSubmitStopping(false);
				if (String(data.status || '').toUpperCase() === 'FAILED') {
					setActionError(detail || '승인 답글 자동 게시에 실패했습니다.');
				} else if (String(data.status || '').toUpperCase() === 'CANCELLED') {
					const cancelBase = `승인 답글 자동 게시 중단됨: 처리 ${data.processed}건, 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
					const cancelExtra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
					setActionMessage(cancelExtra ? `${cancelBase} (${cancelExtra})` : cancelBase);
				} else if (data.processed > 0 || data.succeeded > 0 || data.failed > 0 || data.skipped > 0) {
					setActionMessage(formatBulkSubmitActionMessage(data));
				} else {
					setActionMessage(detail || '자동 게시할 승인 답글이 없습니다.');
				}
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
				return;
			}
			setBulkSubmitJobId(null);
			setBulkSubmitLoading(false);
			setBulkSubmitStopping(false);
			setActionError('승인 답글 자동 게시 상태 확인이 지연되고 있습니다. 잠시 후 새로고침해 주세요.');
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadWorkbench, roleProtectedGet],
	);

	const requestBulkSubmitStop = useCallback(async () => {
		if (!bulkSubmitLoading || bulkSubmitStopping) return;
		setBulkSubmitStopping(true);
		setActionError(null);
		try {
			const res = await roleProtectedPost<ReviewReplyDraftBulkSubmitJobResponse>(
				`${apiBaseUrl}/reviews/reply-drafts/bulk-submit/stop`,
				{ job_id: bulkSubmitJobId || undefined },
				undefined,
			);
			const data = res.data as ReviewReplyDraftBulkSubmitJobResponse;
			const jobId = String(data.job_id || bulkSubmitJobId || '').trim();
			if (jobId) setBulkSubmitJobId(jobId);
			if (data.cancel_requested && String(data.status || '').toUpperCase() === 'STARTED') {
				setActionMessage('승인 답글 자동 게시 중지 요청을 보냈습니다. 현재 처리 중인 건까지 마무리한 뒤 멈춥니다.');
				return;
			}
			setBulkSubmitStopping(false);
			if (String(data.status || '').toUpperCase() !== 'STARTED') {
				setBulkSubmitLoading(false);
				setBulkSubmitJobId(null);
			}
			if (String(data.detail || '').trim()) {
				setActionMessage(String(data.detail));
			}
		} catch (error: any) {
			setBulkSubmitStopping(false);
			setActionError(normalizeReviewReplyActionError(error, '승인 답글 자동 게시 중지 요청에 실패했습니다.'));
		}
	}, [apiBaseUrl, bulkSubmitJobId, bulkSubmitLoading, bulkSubmitStopping, roleProtectedPost]);

	useEffect(() => {
		if (bulkSubmitLoading || !isAdminRole) return;
		let cancelled = false;
		const resumeBulkSubmitIfNeeded = async () => {
			try {
				const res = await roleProtectedGet<ReviewReplyDraftBulkSubmitJobResponse>(`${apiBaseUrl}/reviews/reply-drafts/bulk-submit/status`);
				const data = res.data as ReviewReplyDraftBulkSubmitJobResponse;
				if (cancelled) return;
				if (String(data.status || '').toUpperCase() !== 'STARTED') return;
				const jobId = String(data.job_id || '').trim();
				setBulkSubmitLoading(true);
				setBulkSubmitJobId(jobId || null);
				void pollBulkSubmitJob(jobId || null);
			} catch {
				// 자동 복구 실패는 무시하고 수동 실행을 허용한다.
			}
		};
		void resumeBulkSubmitIfNeeded();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, bulkSubmitLoading, isAdminRole, pollBulkSubmitJob, roleProtectedGet]);

	const runBulkSubmit = useCallback(async () => {
		if (!isAdminRole) {
			setActionError('운영관리자 이상만 승인건 일괄 자동 게시를 실행할 수 있습니다.');
			return;
		}
		if (bulkSubmitLoading) {
			await requestBulkSubmitStop();
			return;
		}
		if (!window.confirm('현재 승인되어 있고 아직 게시되지 않은 답글을 일괄 자동 게시할까요?')) return;
		setBulkSubmitLoading(true);
		setBulkSubmitStopping(false);
		setBulkSubmitJobId(null);
		setActionMessage(null);
		setActionError(null);
		try {
			const res = await roleProtectedPost<ReviewReplyDraftBulkSubmitJobResponse>(
				`${apiBaseUrl}/reviews/reply-drafts/bulk-submit/start`,
				{ limit: 0 },
				undefined,
			);
			const data = res.data as ReviewReplyDraftBulkSubmitJobResponse;
			const jobId = String(data.job_id || '').trim();
			if (String(data.status || '').toUpperCase() === 'STARTED' && jobId) {
				setBulkSubmitJobId(jobId);
				const startBase = `승인 답글 자동 게시 진행 중: 처리 ${data.processed}건, 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
				const startExtra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
				setActionMessage(startExtra ? `${startBase} (${startExtra})` : startBase);
				await pollBulkSubmitJob(jobId);
				return;
			}
			setBulkSubmitLoading(false);
			setBulkSubmitStopping(false);
			setBulkSubmitJobId(null);
			if (String(data.status || '').toUpperCase() === 'BLOCKED') {
				setActionError(String(data.detail || '자동 게시 가능 대상이 없습니다.'));
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
				return;
			}
			setActionMessage(String(data.detail || '자동 게시할 승인 답글이 없습니다.'));
			await loadWorkbench(activeProductUrl, dateFrom, dateTo);
		} catch (error: any) {
			setActionError(normalizeReviewReplyActionError(error, '승인 답글 자동 게시에 실패했습니다.'));
			setBulkSubmitLoading(false);
			setBulkSubmitStopping(false);
			setBulkSubmitJobId(null);
		}
	}, [activeProductUrl, apiBaseUrl, bulkSubmitLoading, dateFrom, dateTo, isAdminRole, loadWorkbench, pollBulkSubmitJob, requestBulkSubmitStop, roleProtectedPost]);

	const buildBulkStageRequestPayload = useCallback(
		(stage: ReviewReplyBulkStage) => ({
			stage,
			product_url: activeProductUrl || undefined,
			date_from: dateFrom || undefined,
			date_to: dateTo || undefined,
			status_filter: statusFilter,
			has_rejection_history_only: rejectionHistoryOnly || undefined,
			rating_filters: [...ratingFilters],
			model: selectedModel,
			style_level: styleLevel,
			style_controls: styleLevel === 6 ? customControls : undefined,
			max_pages: 30,
		}),
		[activeProductUrl, customControls, dateFrom, dateTo, ratingFilters, rejectionHistoryOnly, selectedModel, statusFilter, styleLevel],
	);

	const loadBulkStagePreview = useCallback(async () => {
		if (!isSuperAdminRole) {
			setBulkStagePreview(null);
			return;
		}
		setBulkStagePreviewLoading(true);
		try {
			const requestConfig = {
				params: {
					product_url: activeProductUrl || undefined,
					date_from: dateFrom || undefined,
					date_to: dateTo || undefined,
					status_filter: statusFilter,
					has_rejection_history_only: rejectionHistoryOnly || undefined,
					rating_filters: [...ratingFilters],
				},
				paramsSerializer: { serialize: serializeQueryParams },
				timeout: 60000,
			};
			const res = await roleProtectedGet<ReviewReplyBulkStagePreviewResponse>(`${apiBaseUrl}/reviews/reply-bulk-stage/preview`, requestConfig);
			setBulkStagePreview(res.data as ReviewReplyBulkStagePreviewResponse);
		} catch (error: any) {
			setActionError(String(error?.response?.data?.detail ?? error?.message ?? '일괄 단계 미리보기를 불러오지 못했습니다.'));
		} finally {
			setBulkStagePreviewLoading(false);
		}
	}, [activeProductUrl, apiBaseUrl, dateFrom, dateTo, isSuperAdminRole, ratingFilters, rejectionHistoryOnly, roleProtectedGet, statusFilter]);

	const pollBulkStageJob = useCallback(
		async (jobId?: string | null) => {
			const targetJobId = String(jobId || '').trim();
			let lastMessage = '';
			let transientErrorCount = 0;
			const deadline = Date.now() + BULK_JOB_POLL_TIMEOUT_MS;
			while (Date.now() < deadline) {
				let data: ReviewReplyBulkStageJobResponse;
				try {
					const res = await roleProtectedGet<ReviewReplyBulkStageJobResponse>(`${apiBaseUrl}/reviews/reply-bulk-stage/status`, {
						params: targetJobId ? { job_id: targetJobId } : undefined,
					});
					data = res.data as ReviewReplyBulkStageJobResponse;
					transientErrorCount = 0;
				} catch (error: any) {
					if (isTransientPollingError(error) && transientErrorCount < 5) {
						transientErrorCount += 1;
						const retryMessage = `슈퍼관리자 일괄 단계 상태 확인이 잠시 지연되었습니다. 자동으로 다시 확인합니다. (${transientErrorCount}/5)`;
						if (retryMessage !== lastMessage) {
							setActionMessage(retryMessage);
							lastMessage = retryMessage;
						}
						await new Promise((resolve) => window.setTimeout(resolve, BULK_JOB_POLL_INTERVAL_MS));
						continue;
					}
					throw error;
				}
				const label = String(data.stage_label || (data.stage ? REVIEW_REPLY_BULK_STAGE_LABELS[data.stage] : '일괄 단계 작업'));
				const detail = String(data.detail || '').trim();
				if (String(data.status || '').toUpperCase() === 'STARTED') {
					const progressBase = data.cancel_requested
						? `${label} 중지 요청 중: 처리 ${data.processed}건, 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`
						: `${label} 진행 중: 처리 ${data.processed}건, 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
					const progressExtra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
					const progressMessage = !data.cancel_requested && progressExtra ? `${progressBase} (${progressExtra})` : progressBase;
					if (progressMessage !== lastMessage) {
						setActionMessage(progressMessage);
						lastMessage = progressMessage;
					}
					await new Promise((resolve) => window.setTimeout(resolve, BULK_JOB_POLL_INTERVAL_MS));
					continue;
				}
				setBulkStageRunning(false);
				setBulkStageStopping(false);
				setBulkStageJobId(null);
				setBulkStageRunningStage(null);
				if (String(data.status || '').toUpperCase() === 'FAILED') {
					setActionError(detail || `${label}에 실패했습니다.`);
				} else if (String(data.status || '').toUpperCase() === 'CANCELLED') {
					const cancelBase = `${label} 중단됨: 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
					const cancelExtra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
					setActionMessage(cancelExtra ? `${cancelBase} (${cancelExtra})` : cancelBase);
				} else if (data.processed > 0 || data.succeeded > 0 || data.failed > 0 || data.skipped > 0) {
					setActionMessage(formatBulkStageActionMessage(data));
				} else {
					setActionMessage(detail || `${label} 대상이 없습니다.`);
				}
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
				await loadBulkStagePreview();
				return;
			}
			setBulkStageRunning(false);
			setBulkStageStopping(false);
			setBulkStageJobId(null);
			setBulkStageRunningStage(null);
			setActionError('슈퍼관리자 일괄 단계 작업 상태 확인이 지연되고 있습니다. 잠시 후 새로고침해 주세요.');
		},
		[activeProductUrl, apiBaseUrl, dateFrom, dateTo, loadBulkStagePreview, loadWorkbench, roleProtectedGet],
	);

	useEffect(() => {
		if (!isSuperAdminRole || bulkStageRunning) return;
		let cancelled = false;
		const resumeBulkStageIfNeeded = async () => {
			try {
				const res = await roleProtectedGet<ReviewReplyBulkStageJobResponse>(`${apiBaseUrl}/reviews/reply-bulk-stage/status`);
				const data = res.data as ReviewReplyBulkStageJobResponse;
				if (cancelled) return;
				if (String(data.status || '').toUpperCase() !== 'STARTED') return;
				const jobId = String(data.job_id || '').trim();
				setBulkStageRunning(true);
				setBulkStageStopping(Boolean(data.cancel_requested));
				setBulkStageJobId(jobId || null);
				setBulkStageRunningStage((data.stage as ReviewReplyBulkStage | null) || null);
				void pollBulkStageJob(jobId || null);
			} catch {
				// 자동 복구 실패는 무시한다.
			}
		};
		void resumeBulkStageIfNeeded();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, bulkStageRunning, isSuperAdminRole, pollBulkStageJob, roleProtectedGet]);

	useEffect(() => {
		if (!isSuperAdminRole) return;
		void loadBulkStagePreview();
	}, [isSuperAdminRole, loadBulkStagePreview]);

	const runBulkStage = useCallback(
		async (stage: ReviewReplyBulkStage) => {
			if (!isSuperAdminRole) {
				setActionError('슈퍼관리자만 단계별 일괄 적용을 실행할 수 있습니다.');
				return;
			}
			if (bulkStageRunning) {
				if (bulkStageRunningStage !== stage) return;
				if (bulkStageStopping) return;
				setBulkStageStopping(true);
				setActionError(null);
				try {
					const res = await roleProtectedPost<ReviewReplyBulkStageJobResponse>(
						`${apiBaseUrl}/reviews/reply-bulk-stage/stop`,
						{ job_id: bulkStageJobId || undefined },
						undefined,
					);
					const data = res.data as ReviewReplyBulkStageJobResponse;
					const jobId = String(data.job_id || bulkStageJobId || '').trim();
					if (jobId) setBulkStageJobId(jobId);
					if (data.cancel_requested && String(data.status || '').toUpperCase() === 'STARTED') {
						setActionMessage('슈퍼관리자 일괄 단계 중지 요청을 보냈습니다. 현재 처리 중인 건까지 마무리한 뒤 멈춥니다.');
						return;
					}
					setBulkStageStopping(false);
					if (String(data.status || '').toUpperCase() !== 'STARTED') {
						setBulkStageRunning(false);
						setBulkStageJobId(null);
						setBulkStageRunningStage(null);
					}
					if (String(data.detail || '').trim()) {
						setActionMessage(String(data.detail));
					}
					return;
				} catch (error: any) {
					setBulkStageStopping(false);
					setActionError(normalizeReviewReplyActionError(error, '슈퍼관리자 일괄 단계 중지 요청에 실패했습니다.'));
					return;
				}
			}
			const countMap = {
				generate: Number(bulkStagePreview?.generate_count || 0),
				approve: Number(bulkStagePreview?.approve_count || 0),
				reject: Number(bulkStagePreview?.reject_count || 0),
				submit: Number(bulkStagePreview?.submit_count || 0),
				backfill: Number(bulkStagePreview?.backfill_count || 0),
			};
			const targetCount = countMap[stage];
			const label = REVIEW_REPLY_BULK_STAGE_LABELS[stage];
			if (targetCount <= 0) {
				setActionError(`${label} 대상이 없습니다.`);
				return;
			}
			const summary = String(bulkStagePreview?.filter_summary || '').trim();
			if (!window.confirm(`${label}을(를) 현재 필터 기준으로 일괄 적용할까요?\n대상 ${targetCount}건\n${summary}`.trim())) return;
			setBulkStageRunning(true);
			setBulkStageStopping(false);
			setBulkStageJobId(null);
			setBulkStageRunningStage(stage);
			setActionMessage(null);
			setActionError(null);
			try {
				const requestConfig = stage === 'backfill' ? await buildReplyBackfillRequestConfig(apiBaseUrl) : undefined;
				const res = await roleProtectedPost<ReviewReplyBulkStageJobResponse>(
					`${apiBaseUrl}/reviews/reply-bulk-stage/start`,
					buildBulkStageRequestPayload(stage),
					requestConfig,
				);
				const data = res.data as ReviewReplyBulkStageJobResponse;
				const jobId = String(data.job_id || '').trim();
				if (String(data.status || '').toUpperCase() === 'STARTED' && jobId) {
					setBulkStageJobId(jobId);
					const startBase = `${label} 진행 중: 처리 ${data.processed}건, 성공 ${data.succeeded}건, 실패 ${data.failed}건, 스킵 ${data.skipped}건`;
					const startExtra = formatExistingReplySyncSummary(data.existing_reply_completed, data.existing_reply_enrichment);
					setActionMessage(startExtra ? `${startBase} (${startExtra})` : startBase);
					await pollBulkStageJob(jobId);
					return;
				}
				setBulkStageRunning(false);
				setBulkStageStopping(false);
				setBulkStageJobId(null);
				setBulkStageRunningStage(null);
				setActionMessage(String(data.detail || `${label} 대상이 없습니다.`));
				await loadWorkbench(activeProductUrl, dateFrom, dateTo);
				await loadBulkStagePreview();
			} catch (error: any) {
				setActionError(normalizeReviewReplyActionError(error, `${label} 실행에 실패했습니다.`));
				setBulkStageRunning(false);
				setBulkStageStopping(false);
				setBulkStageJobId(null);
				setBulkStageRunningStage(null);
			}
		},
		[activeProductUrl, apiBaseUrl, buildBulkStageRequestPayload, bulkStageJobId, bulkStagePreview, bulkStageRunning, bulkStageRunningStage, bulkStageStopping, dateFrom, dateTo, isSuperAdminRole, loadBulkStagePreview, loadWorkbench, pollBulkStageJob, roleProtectedPost],
	);

	const selectedTrackedProduct = useMemo(
		() => trackedProducts.find((item) => item.productUrl === activeProductUrl) ?? null,
		[activeProductUrl, trackedProducts],
	);
	const moveToAnalysis = useCallback(() => {
		onNavigate(
			buildReviewAnalysisPath(window.location.pathname, {
				productUrl: activeProductUrl || undefined,
				fromYmd: dateFrom,
				toYmd: dateTo,
			}),
		);
	}, [activeProductUrl, dateFrom, dateTo, onNavigate]);

	const selectedPreset = useMemo(() => {
		const presets = presetRecommendation?.presets || [];
		return presets.find((item) => item.level === styleLevel) ?? null;
	}, [presetRecommendation, styleLevel]);

	const activeControls = useMemo(
		() => (styleLevel === 6 ? customControls : selectedPreset?.controls || customControls),
		[customControls, selectedPreset, styleLevel],
	);

	const dashboard = workbench?.dashboard || {
		total_reviews: 0,
		new_reviews: 0,
		completed_count: 0,
		enrichment_target_count: 0,
		unreplied_count: 0,
		draft_pending_count: 0,
		approved_count: 0,
		rejected_count: 0,
		rejection_history_count: 0,
	};

	const statusFilters: Array<{ id: ReviewStatusFilter; label: string }> = [
		{ id: 'all', label: '전체' },
		{ id: 'new', label: '미작성' },
		{ id: 'pending', label: '검토대기' },
		{ id: 'approved', label: '승인' },
		{ id: 'enrichment_target', label: '답글 보강' },
		{ id: 'completed', label: '완료' },
		{ id: 'rejected', label: '반려' },
	];
	const statusFilterCounts = useMemo(
		() => ({
			all: Number(dashboard.total_reviews || 0),
			new: Number(dashboard.new_reviews || 0),
			pending: Number(dashboard.draft_pending_count || 0),
			approved: Number(dashboard.approved_count || 0),
			enrichment_target: Number(dashboard.enrichment_target_count || 0),
			completed: Number(dashboard.completed_count || 0),
			rejected: Number(dashboard.rejected_count || 0),
		}),
		[dashboard],
	);
	const allRatingsSelected = ratingFilters.length === REVIEW_ANALYSIS_RATINGS.length;
	const toggleAllRatingFilters = useCallback(() => {
		preserveWindowScroll(() => {
			setRatingFilters([...REVIEW_ANALYSIS_RATINGS]);
		});
	}, []);
	const toggleRatingFilter = useCallback((rating: ReviewRatingFilter) => {
		preserveWindowScroll(() => {
			setRatingFilters((prev) => {
				const next = prev.includes(rating) ? prev.filter((item) => item !== rating) : [...prev, rating];
				return REVIEW_ANALYSIS_RATINGS.filter((item) => next.includes(item));
			});
		});
	}, []);
	const toggleRejectionHistoryOnly = useCallback(() => {
		preserveWindowScroll(() => {
			setRejectionHistoryOnly((prev) => !prev);
		});
	}, []);
	const workbenchItems = useMemo(() => {
		return rawWorkbenchItems.filter((item) => {
			const matchesStatus = statusFilter === 'all' || item.reply_status === statusFilter;
			if (!matchesStatus) return false;
			if (rejectionHistoryOnly && !item.has_rejection_history) return false;
			const normalizedRating = normalizeReviewRatingFilterValue(item.rating);
			if (!normalizedRating) return false;
			return ratingFilters.includes(normalizedRating);
		});
	}, [rawWorkbenchItems, ratingFilters, rejectionHistoryOnly, statusFilter]);

	return (
		<div className="review-analysis-page">
			<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
				<button
					type="button"
					className={`submenu-tab${pageTab === 'workbench' ? ' submenu-tab-active' : ''}`}
					onClick={() => setPageTab('workbench')}
				>
					리뷰 작업
				</button>
				<button
					type="button"
					className={`submenu-tab${pageTab === 'knowledge' ? ' submenu-tab-active' : ''}`}
					onClick={() => setPageTab('knowledge')}
				>
					Knowledge 검증
				</button>
			</div>
			{pageTab === 'knowledge' ? (
				<ReviewKnowledgeValidationPanel
					apiBaseUrl={apiBaseUrl}
					roleProtectedGet={roleProtectedGet}
					roleProtectedPost={roleProtectedPost}
				/>
			) : null}
			<div style={{ display: pageTab === 'workbench' ? 'contents' : 'none' }}>
			<section className="card">
				<div className="review-dashboard-header">
					<div>
						<div className="card-title">리뷰 작업 대시보드</div>
						<div className="card-caption">조회 기간 기준으로 전체 리뷰를 최신순으로 검토하고 답글 초안을 관리합니다.</div>
					</div>
				</div>
				<ContextBar
					contextLines={[
						`조회/수집 기간 ${dateFrom} ~ ${dateTo}`,
						...(activeProductUrl
							? [`선택 상품 필터: ${selectedTrackedProduct?.productTitle || selectedTrackedProduct?.productUrl || activeProductUrl}`]
							: []),
					]}
					actions={[
						...(activeProductUrl
							? [
									{
										label: '상품 필터 해제',
										onClick: () => setSelectedProductUrl(''),
									},
							  ]
							: []),
						{ label: '리뷰 분석에서 보기', onClick: moveToAnalysis },
					]}
				/>
			</section>

			<section className="review-dashboard-grid">
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">새로운 리뷰</div>
					<div className="review-analysis-stat-value">{dashboard.new_reviews}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">답글 미작성</div>
					<div className="review-analysis-stat-value">{dashboard.unreplied_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">검토대기 초안</div>
					<div className="review-analysis-stat-value">{dashboard.draft_pending_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">보강 대상</div>
					<div className="review-analysis-stat-value">{dashboard.enrichment_target_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">답글 완료</div>
					<div className="review-analysis-stat-value">{dashboard.completed_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">현재 반려</div>
					<div className="review-analysis-stat-value">{dashboard.rejected_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">반려 이력 있음</div>
					<div className="review-analysis-stat-value">{dashboard.rejection_history_count}건</div>
				</div>
			</section>

			<section className="card">
				<div className="review-collapsible-header">
					<div>
						<div className="card-title">세부 생성 옵션</div>
						<div className="card-caption">모델, 스타일, 코퍼스 정보를 접어서 관리할 수 있습니다.</div>
					</div>
					<button type="button" className="btn-ghost" aria-label="세부 생성 옵션 토글" onClick={() => setSettingsCollapsed((prev) => !prev)}>
						{settingsCollapsed ? '펼치기' : '접기'}
					</button>
				</div>
				{settingsCollapsed ? null : (
					<div className="review-analysis-grid">
						<article className="review-analysis-card">
							<div className="card-title">답글 생성 설정</div>
							<div className="card-caption">현재 상품 필터를 기준으로 신규 리뷰 초안을 생성합니다. 상품을 선택하지 않으면 현재 조회 범위 전체를 대상으로 생성합니다.</div>
							{trackedError ? <div className="review-analysis-inline-error">{trackedError}</div> : null}
							<div className="review-form-grid">
								<label className="review-form-field review-form-field-small">
									<span>생성 건수</span>
									<input
										aria-label="생성 건수"
										className="review-input"
										type="number"
										min={1}
										max={30}
										value={batchSize}
										onChange={(e) => setBatchSize(Number(e.target.value || 10))}
									/>
								</label>
							</div>
							<label className="review-form-field">
								<span>답글 생성 모델</span>
								<select aria-label="답글 생성 모델" className="review-input" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
									{REPLY_MODEL_OPTIONS.map((item) => (
										<option key={item.value} value={item.value}>{item.label}</option>
									))}
								</select>
							</label>
							<div className="card-caption">{`권장 모델: ${selectedModel} · ${REPLY_MODEL_OPTIONS.find((item) => item.value === selectedModel)?.note || '선택한 모델 규격에 맞춰 토큰 파라미터를 자동 조정합니다.'}`}</div>
							{selectedTrackedProduct ? (
								<div className="review-analysis-bullets" style={{ marginTop: 10 }}>
									<div>
										<strong>연결 키워드:</strong> {selectedTrackedProduct.keywords.join(', ') || '-'}
									</div>
								</div>
							) : null}
							<div className="card-caption" style={{ marginTop: 12 }}>스타일 단계</div>
							<div className="review-style-levels" role="group" aria-label="답글 스타일 단계">
								{(presetRecommendation?.presets || []).map((preset) => (
									<button
										key={preset.id}
										type="button"
										className={preset.level === styleLevel ? 'btn-primary review-style-level-btn' : 'btn-ghost review-style-level-btn'}
										onClick={() => {
											setStyleLevel(preset.level);
											if (preset.id !== 'custom') setCustomControls({ ...(preset.controls || {}) });
										}}
									>
										<span>{preset.id === 'custom' ? '사용자정의' : `${preset.level}단계`}</span>
										<strong>{preset.name}</strong>
									</button>
								))}
							</div>
							<div className="review-preset-panel">
								<div className="review-preset-summary">{presetLoading ? '프리셋 정보를 불러오는 중...' : selectedPreset?.summary || '프리셋 정보가 없습니다.'}</div>
								<div className="review-preset-controls">
									{STYLE_CONTROL_IDS.map((controlId) => (
										<div key={controlId} className="review-preset-control-row">
											<span>{labelReviewStyleControl(controlId)}</span>
											{styleLevel === 6 ? (
												<select
													aria-label={`스타일 ${labelReviewStyleControl(controlId)}`}
													className="review-control-select"
													value={activeControls[controlId] ?? 3}
													onChange={(e) => setCustomControls((prev) => ({ ...prev, [controlId]: Number(e.target.value || 3) }))}
												>
													{[1, 2, 3, 4, 5].map((score) => (
														<option key={score} value={score}>{score}</option>
													))}
												</select>
											) : (
												<strong>{`${activeControls[controlId] ?? 3}/5`}</strong>
											)}
										</div>
									))}
								</div>
							</div>
						</article>

						<article className="review-analysis-card">
							<div className="card-title">스타일 코퍼스</div>
							<div className="card-caption">실제 답글과 승인 초안을 바탕으로 현재 톤을 요약합니다.</div>
							{presetError ? <div className="review-analysis-inline-error">{presetError}</div> : null}
							{corpusError ? <div className="review-analysis-inline-error">{corpusError}</div> : null}
							<div className="review-analysis-stat-grid">
								<div className="review-analysis-stat"><div className="review-analysis-stat-label">학습 코퍼스</div><div className="review-analysis-stat-value">{corpusLoading ? '불러오는 중...' : `${corpusSummary?.total_examples ?? 0}건`}</div></div>
								<div className="review-analysis-stat"><div className="review-analysis-stat-label">실제 답글 / 승인 초안</div><div className="review-analysis-stat-value">{`${corpusSummary?.source_counts?.actual_reply ?? 0} / ${corpusSummary?.source_counts?.approved_draft ?? 0}`}</div></div>
								<div className="review-analysis-stat"><div className="review-analysis-stat-label">중복 템플릿</div><div className="review-analysis-stat-value">{`${corpusSummary?.duplicate_examples ?? 0}건`}</div></div>
								<div className="review-analysis-stat"><div className="review-analysis-stat-label">현재 프리셋</div><div className="review-analysis-stat-value">{selectedPreset?.name || '-'}</div></div>
							</div>
							<div className="review-analysis-bullets">
								{(presetRecommendation?.recommended_fields || []).map((field) => (
									<div key={field.id}>
										<strong>{field.label}</strong>
										<div>{field.description}</div>
										<div className="review-analysis-field-why">{field.why}</div>
									</div>
								))}
							</div>
						</article>
					</div>
				)}
			</section>

			<section className="card">
				<div className="card-title">전체 리뷰 표</div>
				<div className="card-caption">기본 정렬은 최신순이며, 스마트스토어에서 찾기 쉽게 모든 리뷰를 한 표로 보여줍니다.</div>
				<div className="review-top-toolbar">
					<label className="review-form-field">
						<span>대상 추적 상품</span>
						<select
							aria-label="대상 추적 상품"
							className="review-input"
							value={selectedProductUrl}
							onChange={(e) => setSelectedProductUrl(e.target.value)}
							disabled={trackedLoading || trackedProducts.length === 0}
						>
							{trackedProducts.length === 0 ? <option value="">추적 상품 없음</option> : <option value="">상품별 보기 선택</option>}
							{trackedProducts.map((item) => (
								<option key={item.productUrl} value={item.productUrl}>
									{item.productTitle || item.productUrl}
								</option>
							))}
						</select>
					</label>
					<div className="review-top-toolbar-date">
						<SalesDateRangeControls
							fromYmd={dateFrom}
							toYmd={dateTo}
							onChange={({ fromYmd, toYmd }) => {
								setDateFrom(fromYmd);
								setDateTo(toYmd);
							}}
							compact
						/>
					</div>
				</div>
				<div className="review-analysis-actions">
					<button type="button" className="btn-ghost" onClick={() => void runCollectForAll()} disabled={trackedProducts.length === 0 || collectTrackedLoading}>{collectTrackedLoading ? '전체 상품 수집 중...' : '전체 상품 리뷰 수집'}</button>
					<button type="button" className="btn-ghost" onClick={() => void runImportSmartstoreFile()} disabled={!reviewUploadFile || importLoading}>{importLoading ? '업로드 중...' : '스마트스토어 리뷰 업로드'}</button>
					<button type="button" className="btn-ghost" onClick={() => void runReplyBackfill()} disabled={replyBackfillLoading}>{replyBackfillLoading ? '본문 보강 중...' : '답글 본문 보강'}</button>
					{isOpsAdminRole ? (
						<button type="button" className="btn-ghost" onClick={() => void runBulkSubmit()} disabled={bulkSubmitStopping}>{bulkSubmitLoading ? (bulkSubmitStopping ? '승인건 자동 게시 중지 요청 중...' : '승인건 자동 게시 중지') : '승인건 일괄 자동 게시'}</button>
					) : null}
					<button type="button" className="btn-primary" onClick={() => void runGenerateBatch()} disabled={generateLoading}>{generateLoading ? '초안 생성 중...' : '신규 리뷰 초안 생성'}</button>
					<button type="button" className="btn-ghost" onClick={() => void runRegeneratePendingDrafts()} disabled={regenerateLoading || rawWorkbenchItems.filter((item) => item.reply_status === 'pending' && item.draft_id).length === 0}>{regenerateLoading ? '재생성 중...' : '검토대기 초안 재생성'}</button>
					<button type="button" className="btn-ghost" onClick={() => void loadWorkbench(activeProductUrl, dateFrom, dateTo)} disabled={workbenchLoading}>리뷰 목록 새로고침</button>
				</div>
				<div className="review-upload-toolbar">
					<label className="review-form-field">
						<span>초기 리뷰 파일</span>
						<input
							aria-label="스마트스토어 리뷰 파일"
							className="review-input"
							type="file"
							accept=".csv,.xlsx,.xls"
							onChange={(e) => setReviewUploadFile(e.target.files?.[0] ?? null)}
						/>
					</label>
				</div>
				<div className="card-caption">리뷰 수집은 선택 상품과 무관하게 전체 활성 추적 상품을 현재 조회 기간 기준으로 순차 수집합니다. 과거 대량 보강은 스마트스토어센터 리뷰관리에서 기간을 선택해 내려받은 CSV/XLSX를 업로드하세요. 상품번호가 추적 상품과 일치하면 실제 상품 URL로 저장하고, `답글여부=Y`인 리뷰만 판매자센터 본문 보강 대상으로 잡습니다.</div>
				{actionMessage ? <div className="review-analysis-inline-success">{actionMessage}</div> : null}
				{actionError ? <div className="review-analysis-inline-error">{actionError}</div> : null}
				<div className="review-collect-status-panel">
					<div className="review-collect-status-header">
					<div>
						<div className="card-title">수집 상태</div>
						<div className="card-caption">{collectTrackedLoading ? '전체 상품을 순차 수집 중입니다.' : '상품별 수집 결과를 확인할 수 있습니다.'}</div>
					</div>
					<button
						type="button"
						className="btn-ghost"
						aria-label="수집 상태 토글"
						onClick={() => setCollectStatusCollapsed((prev) => !prev)}
					>
						{collectStatusCollapsed ? '펼치기' : '접기'}
					</button>
					</div>
				{collectStatusCollapsed ? null : collectStatusItems.length === 0 ? (
						<div className="card-caption">아직 실행된 수집 이력이 없습니다.</div>
					) : (
						<div className="review-analysis-list" aria-label="review-collect-status-list">
							{collectStatusItems.map((item) => (
								<div key={item.product_url} className="review-analysis-list-row">
									<div className="review-collect-status-main">
										<div>{item.product_title || item.product_url}</div>
										<span>{item.detail || '-'}</span>
									</div>
									<span className={`review-status-pill ${replyCollectStatusClassName(item.status)}`}>{item.status_label}</span>
								</div>
							))}
						</div>
					)}
				</div>
				<div className="review-filter-row" role="group" aria-label="리뷰 상태 필터">
					{statusFilters.map((item) => (
						<button
							key={item.id}
							type="button"
							aria-label={`리뷰 상태 필터 ${item.label}`}
							title={replyStatusDescription(item.id)}
							className={statusFilter === item.id ? 'btn-primary review-filter-btn' : 'btn-ghost review-filter-btn'}
							onClick={() => setStatusFilter(item.id)}
						>
							{`${item.label} ${statusFilterCounts[item.id]}건`}
						</button>
					))}
					<button
						type="button"
						aria-label="반려 이력 필터"
						title="현재 단계와 별개로 과거 반려 기록이 있는 리뷰만 봅니다."
						className={rejectionHistoryOnly ? 'btn-primary review-filter-btn' : 'btn-ghost review-filter-btn'}
						onClick={toggleRejectionHistoryOnly}
					>
						{`반려 이력 있음 ${Number(dashboard.rejection_history_count || 0)}건`}
					</button>
					<div className="review-form-field review-form-field-small" style={{ marginLeft: 'auto' }}>
						<span>평점</span>
						<div className="review-filter-row" role="group" aria-label="평점 필터">
							<button
								type="button"
								aria-label="평점 전체 선택"
								className={allRatingsSelected ? 'btn-primary review-filter-btn' : 'btn-ghost review-filter-btn'}
								onMouseDown={(e) => e.preventDefault()}
								onClick={toggleAllRatingFilters}
							>
								전체
							</button>
							{REVIEW_ANALYSIS_RATINGS.map((rating) => {
								const selected = ratingFilters.includes(rating);
								return (
									<button
										key={rating}
										type="button"
										aria-label={`평점 ${rating}점 선택`}
										className={selected ? 'btn-primary review-filter-btn' : 'btn-ghost review-filter-btn'}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => toggleRatingFilter(rating)}
									>
										{`${rating}점`}
									</button>
								);
							})}
						</div>
					</div>
				</div>
				{isSuperAdminRole ? (
					<div className="review-collect-status-panel" aria-label="superadmin-bulk-stage-panel">
						<div className="review-collect-status-header">
							<div>
								<div className="card-title">슈퍼관리자 일괄 단계 적용</div>
								<div className="card-caption">
									{bulkStagePreviewLoading ? '현재 필터 기준 대상을 계산 중입니다.' : bulkStagePreview?.filter_summary || '현재 필터 기준 대상을 계산합니다.'}
								</div>
							</div>
							<div className="card-caption">
								{`필터 대상 ${Number(bulkStagePreview?.filtered_total || 0)}건`}
							</div>
						</div>
						<div className="review-filter-row" role="group" aria-label="슈퍼관리자 일괄 단계 버튼">
							{(['generate', 'approve', 'reject', 'submit', 'backfill'] as ReviewReplyBulkStage[]).map((stage) => {
								const countMap = {
									generate: Number(bulkStagePreview?.generate_count || 0),
									approve: Number(bulkStagePreview?.approve_count || 0),
									reject: Number(bulkStagePreview?.reject_count || 0),
									submit: Number(bulkStagePreview?.submit_count || 0),
									backfill: Number(bulkStagePreview?.backfill_count || 0),
								};
								const running = bulkStageRunning && bulkStageRunningStage === stage;
								return (
									<button
										key={stage}
										type="button"
										className={running ? 'btn-primary review-filter-btn' : 'btn-ghost review-filter-btn'}
										aria-label={`슈퍼관리자 일괄 단계 ${REVIEW_REPLY_BULK_STAGE_LABELS[stage]}`}
										onClick={() => void runBulkStage(stage)}
										disabled={bulkStagePreviewLoading || (bulkStageRunning ? (!running || bulkStageStopping) : countMap[stage] <= 0)}
									>
										{running
											? bulkStageStopping
												? `${REVIEW_REPLY_BULK_STAGE_LABELS[stage]} 중지 요청 중...`
												: `${REVIEW_REPLY_BULK_STAGE_LABELS[stage]} 중지`
											: `${REVIEW_REPLY_BULK_STAGE_LABELS[stage]} ${countMap[stage]}건`}
									</button>
								);
							})}
						</div>
						{bulkStageJobId ? <div className="card-caption">{`현재 작업 ID: ${bulkStageJobId}`}</div> : null}
					</div>
				) : null}
				{workbenchError ? <div className="review-analysis-inline-error">{workbenchError}</div> : null}
				{workbenchLoading ? (
					<div className="card-caption">리뷰 목록을 불러오는 중...</div>
				) : workbenchItems.length === 0 ? (
					<div className="card-caption">현재 조건에 맞는 리뷰가 없습니다.</div>
				) : (
					<div className="review-analysis-table-wrap">
						<table className="review-analysis-table" aria-label="review-workbench-table">
							<colgroup>
								<col className="review-col-date" />
								<col className="review-col-status" />
								<col className="review-col-rating" />
								<col className="review-col-review" />
								<col className="review-col-draft" />
								<col className="review-col-actions" />
							</colgroup>
							<thead>
								<tr>
									<th>작성일</th>
									<th>상태</th>
									<th>평점</th>
									<th>리뷰</th>
									<th>답글 초안 / 완료 답글</th>
									<th>작업</th>
								</tr>
							</thead>
							<tbody>
								{workbenchItems.map((item) => (
									<tr key={item.review_key}>
										<td>{formatDateYmdLabel(item.review_written_at)}</td>
										<td>
											<div className="review-status-stack">
												<span
													className={`review-status-pill ${replyStatusClassName(item.reply_status)}`}
													title={replyStatusDescription(item.reply_status)}
												>
													{item.reply_status_label}
												</span>
												{item.has_rejection_history ? (
													<span className="review-history-pill" title="현재 단계와 별개로 이전 반려 기록이 있습니다.">
														반려 이력 있음
													</span>
												) : null}
											</div>
										</td>
										<td>{item.rating ?? '-'}</td>
										<td className="review-cell-review">
											<div className="review-draft-review-cell">
												<div title={item.review_text}>{truncateDisplayText(item.review_text, 120, '…')}</div>
												<div className="review-draft-review-meta">{`옵션 ${item.option_text || '-'} / 작성자 ${item.reviewer_masked_id || '-'} / 상품 ${truncateDisplayText(item.product_title || item.product_url, 34, '…')}`}</div>
											</div>
										</td>
										<td className="review-cell-draft">
											<div className="review-draft-editor">
												{item.reply_status === 'completed' || item.reply_status === 'enrichment_target' ? (
													<div className="review-completed-reply" title={item.reply_text || (item.reply_exists_flag ? '실제 답글은 있으나 본문 보강 전입니다.' : '')}>
														{item.reply_text || (item.reply_exists_flag ? '실제 답글 있음, 본문 보강 대기' : '-')}
													</div>
												) : item.draft_id ? (
													<>
														<textarea aria-label={`draft-editor-${item.review_key}`} className="review-draft-textarea" value={draftEdits[item.draft_id] ?? item.draft_text ?? ''} onChange={(e) => setDraftEdits((prev) => ({ ...prev, [item.draft_id!]: e.target.value }))} />
														<div className="review-draft-meta">
															<span>{`${item.style_level || '-'}단계 ${item.style_preset_name || ''}`.trim()}</span>
															<span>{Object.entries(item.style_controls || {}).map(([controlId, score]) => `${labelReviewStyleControl(controlId)} ${score}`).join(' · ') || '스타일 정보 없음'}</span>
														</div>
														{item.rejection_comment || item.rejection_problem_summary ? (
															<div className="review-draft-meta" aria-label={`draft-feedback-${item.review_key}`}>
																{item.rejection_problem_summary ? <span>{item.rejection_problem_summary}</span> : null}
																{item.rejection_comment ? <span>{item.rejection_comment}</span> : null}
															</div>
														) : null}
													</>
												) : (
													<div className="card-caption">아직 생성된 초안이 없습니다.</div>
												)}
											</div>
										</td>
										<td>
											<div className="review-draft-actions">
												{(() => {
													const draftId = String(item.draft_id || '').trim();
													const isSubmittingDraft = !!draftId && submitLoadingId === draftId;
													return (
														<>
												<button
													type="button"
													aria-label={`draft-approve-${item.review_key}`}
													className={item.reply_status === 'approved' ? 'btn-ghost' : 'btn-primary'}
													onClick={() => void approveDraft(item)}
													disabled={!item.draft_id || item.reply_status === 'completed' || item.reply_status === 'enrichment_target' || statusUpdatingId === item.draft_id || draftSavingId === item.draft_id}
												>
													승인
												</button>
												<button
													type="button"
													aria-label={`draft-submit-${item.review_key}`}
													className={item.reply_status === 'approved' ? 'btn-primary' : 'btn-ghost'}
													onClick={() => void submitDraft(item)}
													disabled={!item.draft_id || item.reply_status !== 'approved' || isSubmittingDraft}
												>
													{isSubmittingDraft ? '자동 게시 중...' : '자동 게시'}
												</button>
												{isAdminRole && item.reply_status === 'enrichment_target' && item.reply_exists_flag ? (
													<button
														type="button"
														aria-label={`draft-manual-complete-${item.review_key}`}
														className="btn-ghost"
														onClick={() => void manuallyCompleteExistingReply(item)}
														disabled={!item.draft_id}
													>
														완료 처리
													</button>
												) : null}
												<button type="button" aria-label={`draft-copy-${item.review_key}`} className="btn-ghost" onClick={() => void copyDraft(item)} disabled={!item.can_copy}>복사</button>
												<button type="button" aria-label={`draft-reject-${item.review_key}`} className="btn-ghost" onClick={() => openRejectDraftModal(item)} disabled={!item.draft_id || item.reply_status === 'completed' || item.reply_status === 'enrichment_target' || statusUpdatingId === item.draft_id}>반려</button>
												{item.rejection_comment || item.rejection_problem_summary ? (
													<button
														type="button"
														aria-label={`draft-feedback-history-${item.review_key}`}
														className="btn-ghost"
														onClick={() => openFeedbackHistory(item)}
													>
														반려 이력 보기
													</button>
												) : null}
												{item.can_rewrite_from_rejection ? (
													<button
														type="button"
														aria-label={`draft-rewrite-from-rejection-${item.review_key}`}
														className="btn-ghost"
														onClick={() => void rewriteRejectedDraft(item)}
														disabled={!item.draft_id || statusUpdatingId === item.draft_id}
													>
														반려 반영 재작성
													</button>
												) : null}
														</>
													);
												})()}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{rejectingItem ? (
					<div className="review-modal-backdrop" onClick={closeRejectDraftModal}>
						<div role="dialog" aria-label="반려 사유 입력" className="review-modal-panel" onClick={(e) => e.stopPropagation()}>
							<div className="review-collect-status-header">
								<div>
									<div className="card-title">반려 사유 입력</div>
									<div className="card-caption">{truncateDisplayText(rejectingItem.review_text || '', 160, '…')}</div>
								</div>
								<button type="button" className="btn-ghost" onClick={closeRejectDraftModal} disabled={statusUpdatingId === String(rejectingItem.draft_id || '').trim()}>닫기</button>
							</div>
							<label className="review-form-field" style={{ marginTop: 12 }}>
								<span>반려 사유</span>
								<textarea
									aria-label="반려 사유 입력값"
									ref={rejectionCommentInputRef}
									className="review-draft-textarea"
									value={rejectionCommentInput}
									onChange={(e) => setRejectionCommentInput(e.target.value)}
								/>
							</label>
							<div className="review-draft-actions">
								<button
									type="button"
									className="btn-primary"
									onClick={() => void rejectDraft(rejectingItem)}
									disabled={statusUpdatingId === String(rejectingItem.draft_id || '').trim()}
								>
									저장+새로작성
								</button>
								<button type="button" className="btn-ghost" onClick={closeRejectDraftModal} disabled={statusUpdatingId === String(rejectingItem.draft_id || '').trim()}>
									취소
								</button>
							</div>
						</div>
					</div>
				) : null}
				{feedbackHistoryItem ? (
					<div className="review-modal-backdrop" onClick={closeFeedbackHistory}>
						<div role="dialog" aria-label="반려 피드백 이력" className="review-modal-panel" onClick={(e) => e.stopPropagation()}>
							<div className="review-collect-status-header">
								<div>
									<div className="card-title">반려 피드백 이력</div>
									<div className="card-caption">{truncateDisplayText(feedbackHistoryItem.review_text || '', 160, '…')}</div>
								</div>
								<button type="button" className="btn-ghost" onClick={closeFeedbackHistory}>닫기</button>
							</div>
							<div className="review-draft-meta" style={{ marginTop: 12 }}>
								<span>{feedbackHistoryItem.rejection_problem_summary || '핵심 문제 요약 없음'}</span>
							</div>
							<div className="review-draft-meta" style={{ marginTop: 8 }}>
								<span>{feedbackHistoryItem.rejection_comment || '사용자 반려 코멘트 없음'}</span>
							</div>
							<div className="review-draft-meta" style={{ marginTop: 12 }}>
								<span>피해야 할 표현</span>
							</div>
							<div className="card-caption">
								{feedbackMustAvoid.length > 0 ? (
									feedbackMustAvoid.map((item, index) => (
										<div key={`avoid-${index}`}>{item}</div>
									))
								) : '저장된 금지 패턴이 없습니다.'}
							</div>
							<div className="review-draft-meta" style={{ marginTop: 12 }}>
								<span>재작성 지침</span>
							</div>
							<div className="card-caption">
								{feedbackRewriteGuidance.length > 0 ? (
									feedbackRewriteGuidance.map((item, index) => (
										<div key={`guide-${index}`}>{item}</div>
									))
								) : '저장된 재작성 지침이 없습니다.'}
							</div>
						</div>
					</div>
				) : null}
			</section>

			<section className="card">
				<div className="review-collapsible-header">
					<div>
						<div className="card-title">반려 이력 리스트</div>
						<div className="card-caption">현재 조회 기간/상품/평점 조건에서 실제 반려된 이력만 따로 보고, 커멘트를 수정하거나 삭제할 수 있습니다.</div>
					</div>
					<div className="card-caption">{`${rejectionHistoryItems.length}건 표시`}</div>
				</div>
				{rejectionHistoryError ? <div className="review-analysis-inline-error">{rejectionHistoryError}</div> : null}
				{rejectionHistoryLoading ? (
					<div className="card-caption">반려 이력 목록을 불러오는 중...</div>
				) : rejectionHistoryItems.length === 0 ? (
					<div className="card-caption">현재 조건에 맞는 반려 이력이 없습니다.</div>
				) : (
					<div className="review-analysis-table-wrap">
						<table className="review-analysis-table" aria-label="rejection-history-table">
							<thead>
								<tr>
									<th>반려일</th>
									<th>평점</th>
									<th>리뷰</th>
									<th>핵심 문제</th>
									<th>반려 커멘트</th>
									<th>작업</th>
								</tr>
							</thead>
							<tbody>
								{rejectionHistoryItems.map((item) => {
									const draftId = String(item.draft_id || '').trim();
									const isSaving = rejectionHistorySavingId === draftId;
									const isDeleting = rejectionHistoryDeletingId === draftId;
									return (
										<tr key={draftId || item.review_key}>
											<td>{formatDateYmdLabel(item.generated_at)}</td>
											<td>{item.rating ?? '-'}</td>
											<td>
												<div className="review-draft-review-cell">
													<div title={item.review_text}>{truncateDisplayText(item.review_text, 120, '…')}</div>
													<div className="review-draft-review-meta">{`옵션 ${item.option_text || '-'} / 작성자 ${item.reviewer_masked_id || '-'} / 상품 ${truncateDisplayText(item.product_url, 34, '…')}`}</div>
												</div>
											</td>
											<td>
												<div className="review-draft-meta">
													<span>{item.rejection_problem_summary || '핵심 문제 요약 없음'}</span>
												</div>
											</td>
											<td>
												<textarea
													aria-label={`rejection-history-comment-${draftId}`}
													className="review-draft-textarea"
													style={{ minHeight: 96 }}
													value={rejectionHistoryCommentEdits[draftId] ?? item.rejection_comment ?? ''}
													onChange={(e) => setRejectionHistoryCommentEdits((prev) => ({ ...prev, [draftId]: e.target.value }))}
													disabled={isSaving || isDeleting}
												/>
											</td>
											<td>
												<div className="review-draft-actions">
													<button
														type="button"
														aria-label={`rejection-history-save-${draftId}`}
														className="btn-primary"
														onClick={() => void saveRejectionHistoryComment(item)}
														disabled={isSaving || isDeleting}
													>
														{isSaving ? '수정 중...' : '커멘트 수정'}
													</button>
													<button
														type="button"
														aria-label={`rejection-history-delete-${draftId}`}
														className="btn-ghost"
														onClick={() => void deleteRejectionHistoryComment(item)}
														disabled={isSaving || isDeleting}
													>
														{isDeleting ? '삭제 중...' : '커멘트 삭제'}
													</button>
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>
			</div>
		</div>
	);
}