import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useMaybeAuth } from '../auth/AuthProvider';
import { SalesDateRangeControls } from '../sales/SalesDateRangeControls';
import {
	buildQnaAnalysisPath,
	readInitialQnaManagementNavigationQuery,
} from '../../shared/navigation/analyticsNavigation';
import { qnaStatusClassName } from '../../shared/domain/analyticsDomain';
import { labelQnaResponseState } from '../../shared/presentation/analyticsLabels';
import { authRetryGet, authRetryPost } from '../../shared/auth/authRetry';
import { createRecentYmdRange, formatDateTimeKo, truncateDisplayText } from '../../shared/utils/dateText';
import { ContextBar } from '../../shared/ui/ContextBar';

type QnaDashboard = {
	total_items: number;
	unanswered_count: number;
	generated_count: number;
	approved_count: number;
	submitted_count: number;
	failed_submit_count: number;
	customer_count: number;
	product_count: number;
	last_collected_at?: string | null;
	issue_tag_counts?: Record<string, number>;
};

type QnaValidationResult = {
	status?: string;
	initial_issues?: string[];
	final_issues?: string[];
	rewrite_attempted?: boolean;
	rewrite_succeeded?: boolean;
};

type QnaWorkbenchItem = {
	qna_key: string;
	qna_kind: string;
	qna_kind_label: string;
	external_inquiry_id: string;
	title?: string | null;
	category?: string | null;
	inquiry_text: string;
	inquiry_registered_at?: string | null;
	answered: boolean;
	answer_content_id?: string | null;
	answer_text?: string | null;
	answer_registered_at?: string | null;
	order_id?: string | null;
	product_no?: string | null;
	product_order_id_list?: string | null;
	product_name?: string | null;
	product_order_option?: string | null;
	customer_id?: string | null;
	customer_name?: string | null;
	masked_writer_id?: string | null;
	draft_id?: string | null;
	draft_status?: string | null;
	draft_text?: string | null;
	model_name?: string | null;
	rejection_comment?: string | null;
	rejection_analysis?: Record<string, any>;
	validation_result?: QnaValidationResult | null;
	issue_tags?: string[];
	last_submit_success?: boolean | null;
	last_submit_status_code?: number | null;
	last_submit_error?: string | null;
	last_submit_at?: string | null;
	can_generate: boolean;
	can_approve: boolean;
	can_reject: boolean;
	can_submit: boolean;
};

type QnaWorkbenchResponse = {
	ok: boolean;
	qna_kind: string;
	response_state: string;
	search?: string | null;
	dashboard: QnaDashboard;
	items: QnaWorkbenchItem[];
};

type QnaSyncResponse = {
	ok: boolean;
	customer_fetched: number;
	product_fetched: number;
	saved: number;
	updated: number;
	detail?: string | null;
};

type QnaGenerateBatchResponse = {
	ok: boolean;
	requested: number;
	processed: number;
	generated: number;
	reused: number;
	skipped_answered: number;
};

type QnaStatusFilter = 'all' | 'unanswered' | 'generated' | 'approved' | 'submitted' | 'failed' | 'rejected' | 'answered';

const QNA_MODEL_OPTIONS = [
	{ value: 'gpt-4o-mini', label: 'gpt-4o-mini', note: '권장 기본값, 응답 속도와 비용을 우선할 때 사용합니다.' },
	{ value: 'gpt-4o', label: 'gpt-4o', note: '품질과 속도의 균형이 필요한 운영 답변용입니다.' },
	{ value: 'gpt-5.4-mini', label: 'gpt-5.4-mini', note: 'GPT-5 계열의 경량 모델입니다.' },
	{ value: 'gpt-5.4', label: 'gpt-5.4', note: '더 정교한 문맥 반영이 필요할 때 사용합니다.' },
	{ value: 'gpt-5.5', label: 'gpt-5.5', note: '현재 계정에서 조회된 고성능 GPT 모델입니다.' },
];

function formatIssueTags(values?: string[] | null): string {
	const seen = new Set<string>();
	return (values || [])
		.map((value) => String(value || '').trim())
		.filter((value) => {
			if (!value || seen.has(value)) return false;
			seen.add(value);
			return true;
		})
		.join(', ') || '-';
}

function deriveQnaState(item: QnaWorkbenchItem): QnaStatusFilter {
	if (item.last_submit_success === false) return 'failed';
	const draftStatus = String(item.draft_status || '').trim() as QnaStatusFilter;
	if (draftStatus) return draftStatus;
	if (item.answered) return 'answered';
	return 'unanswered';
}

function statusLabel(status: QnaStatusFilter | string | null | undefined): string {
	return labelQnaResponseState(status, '-');
}

function validationStatusLabel(result?: QnaValidationResult | null): string | null {
	const status = String(result?.status || '').trim();
	if (!status || status === 'not_checked') return null;
	if (status === 'needs_recheck') return '재검증 필요';
	if (status === 'passed') return '자동 검증 통과';
	if (status === 'rewritten_passed') return '자동 교정 후 통과';
	if (status === 'failed') return '자동 검증 실패';
	if (status === 'passed_with_warnings') return '자동 검증 경고';
	return status;
}

function isApprovalBlockedByValidation(result?: QnaValidationResult | null): boolean {
	const status = String(result?.status || '').trim();
	return status === 'failed' || status === 'needs_recheck' || status === 'not_checked';
}

function approvalBlockedReasonLabel(result?: QnaValidationResult | null): string | null {
	const status = String(result?.status || '').trim();
	const finalIssues = Array.isArray(result?.final_issues) ? result?.final_issues || [] : [];
	if (status === 'needs_recheck') return '승인 불가: 재검증 필요';
	if (status === 'failed' && finalIssues.length > 0) return `승인 불가: 남은 이슈 ${finalIssues.length}건`;
	if (status === 'not_checked') return '승인 불가: 자동 검증 확인 필요';
	return null;
}

function navigateToReviewAnalysisPath(path: string): void {
	window.location.assign(path);
}

export function QnaManagementView({
	apiBaseUrl,
	onNavigate = navigateToReviewAnalysisPath,
}: {
	apiBaseUrl: string;
	onNavigate?: (path: string) => void;
}): JSX.Element {
	const auth = useMaybeAuth();
	const authRef = useRef(auth);
	const defaultViewRange = useMemo(() => createRecentYmdRange(30), []);
	const initialQuery = useMemo(() => readInitialQnaManagementNavigationQuery(window.location.search, defaultViewRange), [defaultViewRange]);
	const [dashboard, setDashboard] = useState<QnaDashboard | null>(null);
	const [items, setItems] = useState<QnaWorkbenchItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [actionLoading, setActionLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [qnaKind, setQnaKind] = useState<'all' | 'customer' | 'product'>(initialQuery.qnaKind);
	const [search, setSearch] = useState(initialQuery.search);
	const [viewFromYmd, setViewFromYmd] = useState<string>(initialQuery.fromYmd);
	const [viewToYmd, setViewToYmd] = useState<string>(initialQuery.toYmd);
	const [issueTag, setIssueTag] = useState<string>(initialQuery.issueTag);
	const [selectedModel, setSelectedModel] = useState<string>('gpt-4o-mini');
	const [batchSize, setBatchSize] = useState<number>(10);
	const [statusFilter, setStatusFilter] = useState<QnaStatusFilter>(initialQuery.responseState);
	const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(false);
	const [syncStatusCollapsed, setSyncStatusCollapsed] = useState<boolean>(false);
	const [lastSyncResult, setLastSyncResult] = useState<QnaSyncResponse | null>(null);
	const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
	const [rejectingItem, setRejectingItem] = useState<QnaWorkbenchItem | null>(null);
	const [rejectionCommentInput, setRejectionCommentInput] = useState<string>('');
	const [draftSavingId, setDraftSavingId] = useState<string | null>(null);
	const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
	const [submitLoadingId, setSubmitLoadingId] = useState<string | null>(null);
	const [regenerateLoading, setRegenerateLoading] = useState<boolean>(false);
	const [validateLoadingId, setValidateLoadingId] = useState<string | null>(null);

	useEffect(() => {
		authRef.current = auth;
	}, [auth]);

	const roleProtectedGet = useCallback(
		async <T,>(url: string, config?: Record<string, any>) =>
			await authRetryGet<T>(
				axios,
				authRef.current?.getIdToken ? (options) => authRef.current?.getIdToken?.(options) : undefined,
				url,
				config,
			),
		[],
	);

	const roleProtectedPost = useCallback(
		async <T,>(url: string, body?: any, config?: Record<string, any>) =>
			await authRetryPost<T>(
				axios,
				authRef.current?.getIdToken ? (options) => authRef.current?.getIdToken?.(options) : undefined,
				url,
				body,
				config,
			),
		[],
	);

	const loadWorkbench = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await roleProtectedGet<QnaWorkbenchResponse>(`${apiBaseUrl}/qna/workbench`, {
				params: {
					qna_kind: qnaKind,
					response_state: 'all',
					search: search.trim() || undefined,
					issue_tag: issueTag.trim() || undefined,
					from_date: viewFromYmd,
					to_date: viewToYmd,
				},
			});
			const nextItems = Array.isArray(res.data?.items) ? res.data.items : [];
			setDashboard(res.data?.dashboard || null);
			setItems(nextItems);
			setDraftEdits((prev) => {
				const next = { ...prev };
				nextItems.forEach((item) => {
					if (typeof next[item.qna_key] !== 'string') {
						next[item.qna_key] = item.draft_text || '';
					}
				});
				return next;
			});
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || 'Q&A 목록을 불러오지 못했습니다.'));
		} finally {
			setLoading(false);
		}
	}, [apiBaseUrl, issueTag, qnaKind, roleProtectedGet, search, viewFromYmd, viewToYmd]);

	useEffect(() => {
		void loadWorkbench();
	}, [loadWorkbench]);

	const runAction = useCallback(
		async (action: () => Promise<void>) => {
			setActionLoading(true);
			setActionMessage(null);
			setError(null);
			try {
				await action();
				await loadWorkbench();
			} catch (requestError: any) {
				setError(String(requestError?.response?.data?.detail || requestError?.message || '작업을 처리하지 못했습니다.'));
			} finally {
				setActionLoading(false);
			}
		},
		[loadWorkbench],
	);

	const dashboardData = dashboard || {
		total_items: 0,
		unanswered_count: 0,
		generated_count: 0,
		approved_count: 0,
		submitted_count: 0,
		failed_submit_count: 0,
		customer_count: 0,
		product_count: 0,
		last_collected_at: null,
		issue_tag_counts: {},
	};
	const issueTagCountEntries = Object.entries(dashboardData.issue_tag_counts || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));

	const statusFilters: Array<{ id: QnaStatusFilter; label: string }> = [
		{ id: 'all', label: '전체' },
		{ id: 'unanswered', label: '미답변' },
		{ id: 'generated', label: '검토대기' },
		{ id: 'approved', label: '승인' },
		{ id: 'submitted', label: '완료' },
		{ id: 'failed', label: '등록 실패' },
		{ id: 'rejected', label: '반려' },
		{ id: 'answered', label: '기존 답변' },
	];

	const statusFilterCounts = useMemo(() => {
		const counts: Record<QnaStatusFilter, number> = {
			all: items.length,
			unanswered: 0,
			generated: 0,
			approved: 0,
			submitted: 0,
			failed: 0,
			rejected: 0,
			answered: 0,
		};
		items.forEach((item) => {
			const state = deriveQnaState(item);
			counts[state] += 1;
		});
		return counts;
	}, [items]);

	const workbenchItems = useMemo(
		() => items.filter((item) => statusFilter === 'all' || deriveQnaState(item) === statusFilter),
		[items, statusFilter],
	);

	const bulkRegenerateItems = useMemo(
		() =>
			workbenchItems.filter((item) => {
				const qnaState = deriveQnaState(item);
				return Boolean(item.draft_id) && (qnaState === 'generated' || qnaState === 'rejected');
			}),
		[workbenchItems],
	);

	const moveToAnalysis = useCallback(() => {
		onNavigate(
			buildQnaAnalysisPath({
				qnaKind,
				search,
				fromYmd: viewFromYmd,
				toYmd: viewToYmd,
				issueTag,
				responseState: statusFilter,
			}),
		);
	}, [issueTag, onNavigate, qnaKind, search, statusFilter, viewFromYmd, viewToYmd]);

	const handleSync = useCallback(async () => {
		await runAction(async () => {
			const res = await roleProtectedPost<QnaSyncResponse>(`${apiBaseUrl}/qna/sync`, {
				start_date: viewFromYmd,
				end_date: viewToYmd,
			});
			setLastSyncResult(res.data || null);
			setActionMessage(
				`문의 수집 완료: 고객 ${res.data?.customer_fetched ?? 0}건, 상품 ${res.data?.product_fetched ?? 0}건, 신규 ${res.data?.saved ?? 0}건 저장`,
			);
			setSyncStatusCollapsed(false);
		});
	}, [apiBaseUrl, roleProtectedPost, runAction, viewFromYmd, viewToYmd]);

	const handleGenerateBatch = useCallback(async () => {
		await runAction(async () => {
			const res = await roleProtectedPost<QnaGenerateBatchResponse>(`${apiBaseUrl}/qna/drafts/generate-batch`, {
				max_items: batchSize,
				qna_kind: qnaKind,
				from_date: viewFromYmd,
				to_date: viewToYmd,
				model: selectedModel,
			});
			setActionMessage(`초안 처리 완료: 생성 ${res.data?.generated ?? 0}건, 재사용 ${res.data?.reused ?? 0}건`);
		});
	}, [apiBaseUrl, batchSize, qnaKind, roleProtectedPost, runAction, selectedModel, viewFromYmd, viewToYmd]);

	const generateDraft = useCallback(async (item: QnaWorkbenchItem) => {
		await runAction(async () => {
			const res = await roleProtectedPost<{ draft_text?: string }>(`${apiBaseUrl}/qna/drafts/generate`, {
				qna_key: item.qna_key,
				model: selectedModel,
			});
			setDraftEdits((prev) => ({ ...prev, [item.qna_key]: String(res.data?.draft_text || prev[item.qna_key] || '') }));
			setActionMessage('초안을 생성했습니다.');
		});
	}, [apiBaseUrl, roleProtectedPost, runAction, selectedModel]);

	const regenerateDraft = useCallback(async (item: QnaWorkbenchItem) => {
		if (!item.draft_id) return;
		await runAction(async () => {
			const res = await roleProtectedPost<{ draft_text?: string }>(`${apiBaseUrl}/qna/drafts/generate`, {
				qna_key: item.qna_key,
				model: selectedModel,
				force_regenerate: true,
			});
			setDraftEdits((prev) => ({ ...prev, [item.qna_key]: String(res.data?.draft_text || prev[item.qna_key] || '') }));
			setActionMessage('초안을 새로 생성했습니다.');
		});
	}, [apiBaseUrl, roleProtectedPost, runAction, selectedModel]);

	const regenerateVisibleDrafts = useCallback(async () => {
		if (bulkRegenerateItems.length === 0) {
			setError('재생성할 검토대기/반려 초안이 없습니다.');
			return;
		}
		setRegenerateLoading(true);
		setActionMessage(null);
		setError(null);
		let succeeded = 0;
		let failed = 0;
		try {
			for (const item of bulkRegenerateItems) {
				try {
					const res = await roleProtectedPost<{ draft_text?: string }>(`${apiBaseUrl}/qna/drafts/generate`, {
						qna_key: item.qna_key,
						model: selectedModel,
						force_regenerate: true,
					});
					setDraftEdits((prev) => ({ ...prev, [item.qna_key]: String(res.data?.draft_text || prev[item.qna_key] || '') }));
					succeeded += 1;
				} catch {
					failed += 1;
				}
			}
			setActionMessage(`검토대기/반려 초안 재생성 완료: ${succeeded}건`);
			if (failed > 0) {
				setError(`일부 초안 재생성 실패: ${failed}건`);
			}
			await loadWorkbench();
		} finally {
			setRegenerateLoading(false);
		}
	}, [apiBaseUrl, bulkRegenerateItems, loadWorkbench, roleProtectedPost, selectedModel]);

	const saveDraft = useCallback(async (item: QnaWorkbenchItem) => {
		if (!item.draft_id) return;
		setDraftSavingId(item.draft_id);
		try {
			await roleProtectedPost(`${apiBaseUrl}/qna/drafts/update`, {
				draft_id: item.draft_id,
				draft_text: draftEdits[item.qna_key] ?? item.draft_text ?? '',
			});
			setActionMessage('초안을 저장했습니다.');
			await loadWorkbench();
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || '초안 저장에 실패했습니다.'));
		} finally {
			setDraftSavingId(null);
		}
	}, [apiBaseUrl, draftEdits, loadWorkbench, roleProtectedPost]);

	const validateDraft = useCallback(async (item: QnaWorkbenchItem) => {
		if (!item.draft_id) return;
		setValidateLoadingId(item.draft_id);
		try {
			if ((draftEdits[item.qna_key] ?? item.draft_text ?? '') !== (item.draft_text ?? '')) {
				await roleProtectedPost(`${apiBaseUrl}/qna/drafts/update`, {
					draft_id: item.draft_id,
					draft_text: draftEdits[item.qna_key] ?? '',
				});
			}
			await roleProtectedPost(`${apiBaseUrl}/qna/drafts/validate`, {
				draft_id: item.draft_id,
			});
			setActionMessage('초안을 재검증했습니다.');
			await loadWorkbench();
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || '초안 재검증에 실패했습니다.'));
		} finally {
			setValidateLoadingId(null);
		}
	}, [apiBaseUrl, draftEdits, loadWorkbench, roleProtectedPost]);

	const approveDraft = useCallback(async (item: QnaWorkbenchItem) => {
		if (!item.draft_id) return;
		setStatusUpdatingId(item.draft_id);
		try {
			if ((draftEdits[item.qna_key] ?? item.draft_text ?? '') !== (item.draft_text ?? '')) {
				await roleProtectedPost(`${apiBaseUrl}/qna/drafts/update`, {
					draft_id: item.draft_id,
					draft_text: draftEdits[item.qna_key] ?? '',
				});
			}
			await roleProtectedPost(`${apiBaseUrl}/qna/drafts/status`, {
				draft_id: item.draft_id,
				status: 'approved',
			});
			setActionMessage('초안을 승인했습니다.');
			await loadWorkbench();
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || '초안 승인에 실패했습니다.'));
		} finally {
			setStatusUpdatingId(null);
		}
	}, [apiBaseUrl, draftEdits, loadWorkbench, roleProtectedPost]);

	const openRejectDraftModal = useCallback((item: QnaWorkbenchItem) => {
		setRejectingItem(item);
		setRejectionCommentInput(String(item.rejection_comment || ''));
	}, []);

	const closeRejectDraftModal = useCallback(() => {
		setRejectingItem(null);
		setRejectionCommentInput('');
	}, []);

	const rejectDraft = useCallback(async () => {
		if (!rejectingItem?.draft_id) return;
		if (!rejectionCommentInput.trim()) {
			setError('반려 사유를 입력해 주세요.');
			return;
		}
		setStatusUpdatingId(rejectingItem.draft_id);
		try {
			await roleProtectedPost(`${apiBaseUrl}/qna/drafts/status`, {
				draft_id: rejectingItem.draft_id,
				status: 'rejected',
				rejection_comment: rejectionCommentInput.trim(),
			});
			setActionMessage('초안을 반려했습니다.');
			closeRejectDraftModal();
			await loadWorkbench();
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || '초안 반려에 실패했습니다.'));
		} finally {
			setStatusUpdatingId(null);
		}
	}, [apiBaseUrl, closeRejectDraftModal, loadWorkbench, rejectionCommentInput, rejectingItem, roleProtectedPost]);

	const submitDraft = useCallback(async (item: QnaWorkbenchItem) => {
		if (!item.draft_id) return;
		setSubmitLoadingId(item.draft_id);
		try {
			await roleProtectedPost(`${apiBaseUrl}/qna/drafts/submit`, {
				draft_id: item.draft_id,
			});
			setActionMessage('승인된 초안을 커머스 API로 등록했습니다.');
			await loadWorkbench();
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || '커머스 API 등록에 실패했습니다.'));
		} finally {
			setSubmitLoadingId(null);
		}
	}, [apiBaseUrl, loadWorkbench, roleProtectedPost]);

	return (
		<div className="review-analysis-page">
			<section className="card">
				<div className="review-dashboard-header">
					<div>
						<div className="card-title">Q&amp;A 관리</div>
						<div className="card-caption">고객 문의와 상품 문의를 최신순으로 검토하고 답변 초안을 생성, 검수, 승인, 등록합니다.</div>
					</div>
				</div>
			</section>

			<section className="review-dashboard-grid">
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">미답변 문의</div>
					<div className="review-analysis-stat-value">{dashboardData.unanswered_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">검토대기 초안</div>
					<div className="review-analysis-stat-value">{dashboardData.generated_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">승인 완료</div>
					<div className="review-analysis-stat-value">{dashboardData.approved_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">등록 완료</div>
					<div className="review-analysis-stat-value">{dashboardData.submitted_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">등록 실패</div>
					<div className="review-analysis-stat-value">{dashboardData.failed_submit_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">고객 문의</div>
					<div className="review-analysis-stat-value">{dashboardData.customer_count}건</div>
				</div>
				<div className="review-analysis-stat">
					<div className="review-analysis-stat-label">상품 문의</div>
					<div className="review-analysis-stat-value">{dashboardData.product_count}건</div>
				</div>
			</section>

			<section className="card">
				<div className="review-collapsible-header">
					<div>
						<div className="card-title">세부 생성 옵션</div>
						<div className="card-caption">리뷰 관리와 동일한 흐름으로 모델, 생성 건수, 조회 범위를 접어서 관리합니다.</div>
					</div>
					<button type="button" className="btn-ghost" aria-label="세부 생성 옵션 토글" onClick={() => setSettingsCollapsed((prev) => !prev)}>
						{settingsCollapsed ? '펼치기' : '접기'}
					</button>
				</div>
				{settingsCollapsed ? null : (
					<div className="review-analysis-grid">
						<article className="review-analysis-card">
							<div className="card-title">답변 초안 생성 설정</div>
							<div className="card-caption">현재 문의 종류와 조회 기간을 기준으로 신규 문의 초안을 생성합니다.</div>
							<div className="review-form-grid">
								<label className="review-form-field review-form-field-small">
									<span>생성 건수</span>
									<input
										aria-label="생성 건수"
										className="review-input"
										type="number"
										min={1}
										max={50}
										value={batchSize}
										onChange={(e) => setBatchSize(Math.max(1, Math.min(50, Number(e.target.value || 10))))}
									/>
								</label>
							</div>
							<label className="review-form-field">
								<span>답변 생성 모델</span>
								<select aria-label="답변 생성 모델" className="review-input" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
									{QNA_MODEL_OPTIONS.map((item) => (
										<option key={item.value} value={item.value}>{item.label}</option>
									))}
								</select>
							</label>
							<div className="card-caption">
								{`권장 모델: ${selectedModel} · ${QNA_MODEL_OPTIONS.find((item) => item.value === selectedModel)?.note || ''}`}
							</div>
							<div className="review-analysis-bullets" style={{ marginTop: 10 }}>
								<div><strong>문의 종류:</strong> {qnaKind === 'all' ? '전체 문의' : qnaKind === 'customer' ? '고객 문의' : '상품 문의'}</div>
								<div><strong>조회 기간:</strong> {`${viewFromYmd} ~ ${viewToYmd}`}</div>
								<div><strong>최근 수집 시각:</strong> {formatDateTimeKo(dashboardData.last_collected_at)}</div>
							</div>
						</article>

						<article className="review-analysis-card">
							<div className="card-title">운영 코퍼스 요약</div>
							<div className="card-caption">저장된 문의/답변 이력 기준으로 현재 운영 볼륨과 초안 상태를 확인합니다.</div>
							<div className="review-analysis-stat-grid">
								<div className="review-analysis-stat">
									<div className="review-analysis-stat-label">전체 문의</div>
									<div className="review-analysis-stat-value">{dashboardData.total_items}건</div>
								</div>
								<div className="review-analysis-stat">
									<div className="review-analysis-stat-label">신규 저장</div>
									<div className="review-analysis-stat-value">{lastSyncResult ? `${lastSyncResult.saved}건` : '-'}</div>
								</div>
								<div className="review-analysis-stat">
									<div className="review-analysis-stat-label">최근 동기화</div>
									<div className="review-analysis-stat-value">{lastSyncResult ? `${lastSyncResult.customer_fetched + lastSyncResult.product_fetched}건` : '-'}</div>
								</div>
								<div className="review-analysis-stat">
									<div className="review-analysis-stat-label">현재 필터 대상</div>
									<div className="review-analysis-stat-value">{workbenchItems.length}건</div>
								</div>
							</div>
						</article>
					</div>
				)}
			</section>

			<section className="card">
				<div className="card-title">전체 문의 표</div>
				<div className="card-caption">리뷰 관리와 같은 흐름으로 상단 필터에서 범위를 좁히고, 표에서 바로 초안을 검수/승인/등록합니다.</div>
				<div className="review-top-toolbar">
					<label className="review-form-field">
						<span>문의 종류</span>
						<select
							aria-label="문의 종류"
							className="review-input"
							value={qnaKind}
							onChange={(e) => setQnaKind(e.target.value as 'all' | 'customer' | 'product')}
						>
							<option value="all">전체 문의</option>
							<option value="customer">고객 문의</option>
							<option value="product">상품 문의</option>
						</select>
					</label>
					<div className="review-top-toolbar-date">
						<SalesDateRangeControls
							fromYmd={viewFromYmd}
							toYmd={viewToYmd}
							onChange={({ fromYmd, toYmd }) => {
								setViewFromYmd(fromYmd);
								setViewToYmd(toYmd);
							}}
							title="조회 기간"
							ariaLabel="qna-view-date-range"
							compact
						/>
					</div>
					<div className="review-top-toolbar-date">
						<label className="review-form-field">
							<span>검색</span>
							<input
								aria-label="문의 검색"
								className="review-input"
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="문의 내용 / 상품명 / 고객명 / 문의번호 검색"
							/>
						</label>
					</div>
				</div>
				<ContextBar
					contextLines={[
						`조회/수집 기간 ${viewFromYmd} ~ ${viewToYmd}`,
						...(issueTag ? [`선택된 이슈 태그: ${issueTag}`] : []),
					]}
					actions={[
						...(issueTag
							? [
									{
										label: '이슈 태그 필터 해제',
										ariaLabel: '이슈 태그 필터 해제',
										onClick: () => setIssueTag(''),
										disabled: loading || actionLoading,
									},
							  ]
							: []),
						{ label: 'Q&A 분석에서 보기', onClick: moveToAnalysis },
					]}
				/>
				{issueTagCountEntries.length ? (
					<div className="review-filter-row" role="group" aria-label="Q&A 이슈 태그 필터">
						<button
							type="button"
							aria-label={`Q&A 이슈 태그 전체 ${dashboardData.total_items}건`}
							className={issueTag ? 'btn-ghost review-filter-btn' : 'btn-primary review-filter-btn'}
							onClick={() => setIssueTag('')}
						>
							전체 {dashboardData.total_items}건
						</button>
						{issueTagCountEntries.map(([tag, count]) => (
							<button
								key={tag}
								type="button"
								aria-label={`Q&A 이슈 태그 ${tag} ${count}건`}
								className={issueTag === tag ? 'btn-primary review-filter-btn' : 'btn-ghost review-filter-btn'}
								onClick={() => setIssueTag(tag)}
							>
								{`${tag} ${count}건`}
							</button>
						))}
					</div>
				) : null}
				<div className="review-analysis-actions">
					<button type="button" className="btn-ghost" onClick={() => void handleSync()} disabled={actionLoading}>
						{actionLoading ? '문의 수집 중...' : '문의 수집'}
					</button>
					<button type="button" className="btn-primary" onClick={() => void handleGenerateBatch()} disabled={actionLoading}>
						{actionLoading ? '초안 생성 중...' : '신규 문의 초안 생성'}
					</button>
					<button
						type="button"
						className="btn-ghost"
						onClick={() => void regenerateVisibleDrafts()}
						disabled={regenerateLoading || bulkRegenerateItems.length === 0}
					>
						{regenerateLoading ? '초안 재생성 중...' : '검토대기/반려 초안 재생성'}
					</button>
					<button type="button" className="btn-ghost" onClick={() => void loadWorkbench()} disabled={loading}>
						목록 새로고침
					</button>
				</div>
				{actionMessage ? <div className="review-analysis-inline-success">{actionMessage}</div> : null}
				{error ? <div className="review-analysis-inline-error">{error}</div> : null}

				<div className="review-collect-status-panel">
					<div className="review-collect-status-header">
						<div>
							<div className="card-title">수집 상태</div>
							<div className="card-caption">{lastSyncResult ? '가장 최근 문의 동기화 결과입니다.' : '아직 실행된 문의 수집 이력이 없습니다.'}</div>
						</div>
						<button
							type="button"
							className="btn-ghost"
							aria-label="수집 상태 토글"
							onClick={() => setSyncStatusCollapsed((prev) => !prev)}
						>
							{syncStatusCollapsed ? '펼치기' : '접기'}
						</button>
					</div>
					{syncStatusCollapsed ? null : !lastSyncResult ? (
						<div className="card-caption">문의 수집을 실행하면 고객 문의/상품 문의 동기화 결과가 표시됩니다.</div>
					) : (
						<div className="review-analysis-list" aria-label="qna-sync-status-list">
							<div className="review-analysis-list-row">
								<div className="review-collect-status-main">
									<div>고객 문의</div>
									<span>{`동기화 ${lastSyncResult.customer_fetched}건 / 신규 저장 ${lastSyncResult.saved}건(전체 합산 기준)`}</span>
								</div>
								<span className="review-status-pill is-completed">완료</span>
							</div>
							<div className="review-analysis-list-row">
								<div className="review-collect-status-main">
									<div>상품 문의</div>
									<span>{`동기화 ${lastSyncResult.product_fetched}건 / 기존 갱신 ${lastSyncResult.updated}건`}</span>
								</div>
								<span className="review-status-pill is-completed">완료</span>
							</div>
						</div>
					)}
				</div>

				<div className="review-filter-row" role="group" aria-label="Q&A 상태 필터">
					{statusFilters.map((item) => (
						<button
							key={item.id}
							type="button"
							aria-label={`Q&A 상태 필터 ${item.label}`}
							className={statusFilter === item.id ? 'btn-primary review-filter-btn' : 'btn-ghost review-filter-btn'}
							onClick={() => setStatusFilter(item.id)}
						>
							{`${item.label} ${statusFilterCounts[item.id]}건`}
						</button>
					))}
				</div>

				{loading ? (
					<div className="card-caption">Q&A 목록을 불러오는 중...</div>
				) : workbenchItems.length === 0 ? (
					<div className="card-caption">현재 조건에 맞는 문의가 없습니다.</div>
				) : (
					<div className="review-analysis-table-wrap">
						<table className="review-analysis-table" aria-label="qna-workbench-table">
							<colgroup>
								<col className="review-col-date" />
								<col className="review-col-status" />
								<col className="review-col-review" />
								<col className="review-col-draft" />
								<col className="review-col-actions" />
							</colgroup>
							<thead>
								<tr>
									<th>등록일</th>
									<th>상태</th>
									<th>문의</th>
									<th>답변 초안 / 기존 답변</th>
									<th>작업</th>
								</tr>
							</thead>
							<tbody>
								{workbenchItems.map((item) => {
									const qnaState = deriveQnaState(item);
									const draftId = String(item.draft_id || '').trim();
									const isSaving = draftSavingId === draftId;
									const isUpdating = statusUpdatingId === draftId;
									const isSubmitting = submitLoadingId === draftId;
									const isValidating = validateLoadingId === draftId;
									const canRegenerateDraft = Boolean(draftId) && qnaState !== 'submitted' && qnaState !== 'answered';
									const approvalBlockedByValidation = isApprovalBlockedByValidation(item.validation_result);
									const approvalBlockedReason = approvalBlockedReasonLabel(item.validation_result);
									const validationLabel = validationStatusLabel(item.validation_result);
									const initialIssues = Array.isArray(item.validation_result?.initial_issues) ? item.validation_result?.initial_issues || [] : [];
									const finalIssues = Array.isArray(item.validation_result?.final_issues) ? item.validation_result?.final_issues || [] : [];
									return (
										<tr key={item.qna_key}>
											<td>{formatDateTimeKo(item.inquiry_registered_at)}</td>
											<td>
												<div className="review-status-stack">
													<span className={`review-status-pill ${qnaStatusClassName(qnaState)}`}>{statusLabel(qnaState)}</span>
													<span className="review-draft-review-meta">{item.qna_kind_label}</span>
												</div>
											</td>
											<td className="review-cell-review">
												<div className="review-draft-review-cell">
													{item.title ? <div style={{ fontWeight: 700 }}>{item.title}</div> : null}
													<div title={item.inquiry_text}>{truncateDisplayText(item.inquiry_text, 120)}</div>
													<div className="review-draft-review-meta">
														<span>{`분류 ${item.category || '-'}`}</span>
														<span>{`문의번호 ${item.external_inquiry_id}`}</span>
														<span>{truncateDisplayText(item.product_name || '-', 34)}</span>
													</div>
													<div className="review-draft-review-meta">
														<span>{item.customer_name || item.masked_writer_id || '-'}</span>
														<span>{`주문 ${item.order_id || '-'}`}</span>
														<span>{`옵션 ${truncateDisplayText(item.product_order_option || '-', 40)}`}</span>
													</div>
													{(item.issue_tags || []).length ? (
														<div className="review-draft-review-meta">
															<span>{`이슈 태그 ${formatIssueTags(item.issue_tags)}`}</span>
														</div>
													) : null}
												</div>
											</td>
											<td className="review-cell-draft">
												<div className="review-draft-editor">
													{qnaState === 'submitted' || qnaState === 'answered' ? (
														<div className="review-completed-reply" title={item.answer_text || ''}>
															{item.answer_text || '등록된 답변을 불러오지 못했습니다.'}
														</div>
													) : draftId ? (
														<>
															<textarea
																aria-label={`draft-editor-${item.qna_key}`}
																className="review-draft-textarea"
																value={draftEdits[item.qna_key] ?? item.draft_text ?? ''}
																onChange={(e) => setDraftEdits((prev) => ({ ...prev, [item.qna_key]: e.target.value }))}
															/>
															<div className="review-draft-meta">
																<span>{`모델 ${item.model_name || '-'}`}</span>
																<span>{`최근 등록 ${formatDateTimeKo(item.last_submit_at)}`}</span>
																<span>{`결과 ${item.last_submit_success == null ? '-' : item.last_submit_success ? '성공' : '실패'}`}</span>
															</div>
															{validationLabel ? (
																<div className="review-draft-meta">
																	<span>{validationLabel}</span>
																	{item.validation_result?.rewrite_attempted ? (
																		<span>{item.validation_result?.rewrite_succeeded ? '자동 교정 적용' : '자동 교정 필요'}</span>
																	) : null}
																</div>
															) : null}
															{initialIssues.length > 0 ? (
																<div className="review-draft-meta">
																	<span>{`초기 이슈 ${initialIssues.join(' / ')}`}</span>
																</div>
															) : null}
															{finalIssues.length > 0 ? (
																<div className="review-draft-meta">
																	<span>{`남은 이슈 ${finalIssues.join(' / ')}`}</span>
																</div>
															) : null}
															{item.rejection_comment ? (
																<div className="review-draft-meta">
																	<span>{`반려 사유 ${item.rejection_comment}`}</span>
																</div>
															) : null}
															{item.last_submit_error ? (
																<div className="review-draft-meta">
																	<span>{`등록 실패 ${item.last_submit_error}`}</span>
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
													<button
														type="button"
														aria-label={`draft-generate-${item.qna_key}`}
														className={item.can_generate ? 'btn-primary' : 'btn-ghost'}
														onClick={() => void generateDraft(item)}
														disabled={!item.can_generate || actionLoading}
													>
														초안 생성
													</button>
													{draftId ? (
														<button
															type="button"
															aria-label={`draft-regenerate-${item.qna_key}`}
															className="btn-ghost"
															onClick={() => void regenerateDraft(item)}
															disabled={!canRegenerateDraft || actionLoading}
														>
															초안 새로 생성
														</button>
													) : null}
													<button
														type="button"
														aria-label={`draft-save-${item.qna_key}`}
														className="btn-ghost"
														onClick={() => void saveDraft(item)}
														disabled={!draftId || isSaving || qnaState === 'submitted' || qnaState === 'answered'}
													>
														{isSaving ? '저장 중...' : '초안 저장'}
													</button>
													<button
														type="button"
														aria-label={`draft-validate-${item.qna_key}`}
														className="btn-ghost"
														onClick={() => void validateDraft(item)}
														disabled={!draftId || isValidating || qnaState === 'submitted' || qnaState === 'answered'}
													>
														{isValidating ? '재검증 중...' : '재검증'}
													</button>
													<button
														type="button"
														aria-label={`draft-approve-${item.qna_key}`}
														className={qnaState === 'approved' ? 'btn-ghost' : 'btn-primary'}
														onClick={() => void approveDraft(item)}
														disabled={!item.can_approve || approvalBlockedByValidation || isUpdating}
													>
														승인
													</button>
													{approvalBlockedByValidation && approvalBlockedReason ? (
														<div className="review-draft-meta">
															<span>{approvalBlockedReason}</span>
														</div>
													) : null}
													<button
														type="button"
														aria-label={`draft-submit-${item.qna_key}`}
														className={qnaState === 'approved' ? 'btn-primary' : 'btn-ghost'}
														onClick={() => void submitDraft(item)}
														disabled={!item.can_submit || isSubmitting}
													>
														{isSubmitting ? '등록 중...' : '커머스 API 등록'}
													</button>
													<button
														type="button"
														aria-label={`draft-reject-${item.qna_key}`}
														className="btn-ghost"
														onClick={() => openRejectDraftModal(item)}
														disabled={!item.can_reject || isUpdating}
													>
														반려
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
				{rejectingItem ? (
					<div className="review-modal-backdrop" onClick={closeRejectDraftModal}>
						<div role="dialog" aria-label="반려 사유 입력" className="review-modal-panel" onClick={(e) => e.stopPropagation()}>
							<div className="review-collect-status-header">
								<div>
									<div className="card-title">반려 사유 입력</div>
									<div className="card-caption">{truncateDisplayText(rejectingItem.inquiry_text || '', 160)}</div>
								</div>
								<button type="button" className="btn-ghost" onClick={closeRejectDraftModal} disabled={statusUpdatingId === String(rejectingItem.draft_id || '').trim()}>
									닫기
								</button>
							</div>
							<label className="review-form-field" style={{ marginTop: 12 }}>
								<span>반려 사유</span>
								<textarea
									aria-label="반려 사유 입력값"
									className="review-draft-textarea"
									value={rejectionCommentInput}
									onChange={(e) => setRejectionCommentInput(e.target.value)}
								/>
							</label>
							<div className="review-draft-actions">
								<button
									type="button"
									className="btn-primary"
									onClick={() => void rejectDraft()}
									disabled={statusUpdatingId === String(rejectingItem.draft_id || '').trim()}
								>
									저장+반려
								</button>
								<button
									type="button"
									className="btn-ghost"
									onClick={closeRejectDraftModal}
									disabled={statusUpdatingId === String(rejectingItem.draft_id || '').trim()}
								>
									취소
								</button>
							</div>
						</div>
					</div>
				) : null}
			</section>
		</div>
	);
}
