import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useMaybeAuth } from '../auth/AuthProvider';
import { SalesDateRangeControls } from '../sales/SalesDateRangeControls';
import {
	buildQnaManagementPath,
	normalizeQnaResponseState,
	readInitialQnaAnalysisNavigationQuery,
} from '../../shared/navigation/analyticsNavigation';
import { resolveQnaGuideSection } from '../../shared/domain/analyticsDomain';
import { labelQnaResponseState } from '../../shared/presentation/analyticsLabels';
import { authRetryRequest } from '../../shared/auth/authRetry';
import { createRecentYmdRange, formatDateMonthDayLabel, formatDateTimeKo } from '../../shared/utils/dateText';
import { ContextBar } from '../../shared/ui/ContextBar';

type QnaSummaryResponse = {
	ok: boolean;
	summary: {
		total_items: number;
		purchase_ready_count: number;
		negative_count: number;
		high_conversion_count: number;
		faq_candidate_count: number;
		customer_count: number;
		product_count: number;
		answered_count: number;
		unanswered_count: number;
		analysis_coverage_rate: number;
	};
	inquiry_type_counts: Record<string, number>;
	purchase_stage_counts: Record<string, number>;
	sentiment_counts: Record<string, number>;
	category_counts: Record<string, number>;
	top_products: Array<{
		product_name: string;
		total_items: number;
		high_conversion_count: number;
		negative_count: number;
		faq_candidate_count: number;
	}>;
	action_guides: Array<{
		title: string;
		why: string;
		what_to_do: string;
		target_area: string;
		priority: string;
	}>;
};

type QnaTrendResponse = {
	ok: boolean;
	points: Array<{
		date: string;
		total_items: number;
		negative_count: number;
		faq_candidate_count: number;
		high_conversion_count: number;
	}>;
};

type ConversionBarrierItem = {
	qna_key: string;
	product_name?: string | null;
	inquiry_text: string;
	inquiry_type?: string | null;
	purchase_stage?: string | null;
	conversion_impact_score: number;
	faq_candidate: boolean;
	recommended_action?: string | null;
};

type QualityIssueItem = {
	qna_key: string;
	product_name?: string | null;
	inquiry_text: string;
	issue_tags: string[];
	sentiment?: string | null;
	severity?: string | null;
	recommended_action?: string | null;
};

type FaqCandidateItem = {
	qna_key: string;
	product_name?: string | null;
	inquiry_text: string;
	faq_candidate: boolean;
	conversion_impact_score: number;
	recommended_answer?: string | null;
	recommended_section?: string | null;
};

type MarketingKeywordItem = {
	keyword: string;
	count: number;
	sentiment?: string | null;
	recommended_usage?: string | null;
};

type MarketingCopyCandidate = {
	phrase: string;
	source_count: number;
	recommended_channel?: string | null;
};

type MarketingInsightsResponse = {
	ok: boolean;
	top_keywords: MarketingKeywordItem[];
	copy_candidates: MarketingCopyCandidate[];
};

type AnalysisItem = {
	qna_key: string;
	qna_kind: string;
	product_name?: string | null;
	inquiry_text: string;
	inquiry_registered_at?: string | null;
	analysis: {
		inquiry_type?: string | null;
		purchase_stage?: string | null;
		sentiment?: string | null;
		conversion_impact_score: number;
		keywords: string[];
		issue_tags: string[];
		summary_text?: string | null;
	};
	recommended_action?: string | null;
};

type AnalysisItemsResponse = {
	ok: boolean;
	total_items: number;
	items: AnalysisItem[];
};

type SectionId =
	| 'summary'
	| 'conversion'
	| 'quality'
	| 'faq'
	| 'marketing'
	| 'items';

function formatNumber(value: number): string {
	return new Intl.NumberFormat('ko-KR').format(Number.isFinite(value) ? value : 0);
}

const DISPLAY_LABELS: Record<string, string> = {
	POSITIVE: '긍정',
	NEUTRAL: '중립',
	NEGATIVE: '부정',
	HIGH: '높음',
	MEDIUM: '보통',
	LOW: '낮음',
	ODOR: '냄새',
	IRRITATION: '자극',
	DELIVERY: '배송',
	PACKAGING: '포장',
	DAMAGE: '파손',
	SIZE: '용량',
};

const ISSUE_TAG_ALIASES: Record<string, string> = {
	ODOR: '냄새',
	냄새: '냄새',
	IRRITATION: '자극',
	자극: '자극',
	COLOR_DIFF: '색상',
	색상: '색상',
	SAFETY_CHECK: '안전성',
	안전성: '안전성',
	SHIPPING_DELAY: '배송',
	배송: '배송',
	DURATION: '지속력',
	지속력: '지속력',
};

function formatDisplayLabel(value?: string | null): string {
	const raw = String(value || '').trim();
	if (!raw) return '-';
	return DISPLAY_LABELS[raw.toUpperCase()] || raw;
}

function normalizeIssueTag(value?: string | null): string {
	const raw = String(value || '').trim();
	if (!raw) return '';
	return ISSUE_TAG_ALIASES[raw.toUpperCase()] || ISSUE_TAG_ALIASES[raw] || formatDisplayLabel(raw);
}

function normalizeIssueTags(values?: string[] | null): string[] {
	const seen = new Set<string>();
	return (values || [])
		.map((value) => normalizeIssueTag(value))
		.filter((value) => {
			if (!value || seen.has(value)) return false;
			seen.add(value);
			return true;
		});
}

function formatIssueTags(values?: string[] | null): string {
	return normalizeIssueTags(values).join(', ') || '-';
}

function issueTagCountsFromGroups(groups: string[][]): Array<{ tag: string; count: number }> {
	const counter = new Map<string, number>();
	for (const tags of groups) {
		for (const tag of normalizeIssueTags(tags)) {
			counter.set(tag, Number(counter.get(tag) || 0) + 1);
		}
	}
	return Array.from(counter.entries())
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.tag.localeCompare(b.tag, 'ko-KR')));
}

function matchesSelectedIssueTag(values: string[] | null | undefined, selectedIssueTag: string | null): boolean {
	if (!selectedIssueTag) return true;
	return normalizeIssueTags(values).includes(selectedIssueTag);
}

function IssueTagFilterBar({
	title = '이슈 태그 필터',
	counts,
	totalCount,
	selectedIssueTag,
	onSelect,
}: {
	title?: string;
	counts: Array<{ tag: string; count: number }>;
	totalCount: number;
	selectedIssueTag: string | null;
	onSelect: (value: string | null) => void;
}): JSX.Element | null {
	if (!counts.length && !selectedIssueTag) return null;
	return (
		<div className="qna-analysis-issue-filter">
			<div className="qna-analysis-issue-filter-title">{title}</div>
			<div className="qna-analysis-section-tabs">
				<button
					type="button"
					className={`review-analysis-chip${selectedIssueTag == null ? ' is-active' : ''}`}
					onClick={() => onSelect(null)}
					aria-label={`이슈 태그 전체 보기 ${formatNumber(totalCount)}건`}
				>
					전체 {formatNumber(totalCount)}건
				</button>
				{counts.map((item) => (
					<button
						key={item.tag}
						type="button"
						className={`review-analysis-chip${selectedIssueTag === item.tag ? ' is-active' : ''}`}
						onClick={() => onSelect(item.tag)}
						aria-label={`이슈 태그 ${item.tag} ${formatNumber(item.count)}건`}
					>
						{item.tag} {formatNumber(item.count)}건
					</button>
				))}
			</div>
			{selectedIssueTag ? <div className="card-caption">선택된 이슈 태그: {selectedIssueTag}</div> : null}
		</div>
	);
}

function formatPriorityLabel(value?: string | null): string {
	const normalized = String(value || 'medium').trim().toUpperCase();
	return normalized === 'HIGH' ? '높음' : normalized === 'LOW' ? '낮음' : '보통';
}

function renderCountMap(map: Record<string, number>, emptyText: string): JSX.Element {
	const entries = Object.entries(map || {});
	if (!entries.length) return <div className="review-analysis-empty">{emptyText}</div>;
	const maxValue = Math.max(...entries.map(([, value]) => Number(value || 0)), 1);
	return (
		<div className="qna-analysis-metric-list">
			{entries.map(([key, value]) => (
				<div key={key} className="qna-analysis-metric-row">
					<div className="qna-analysis-metric-head">
						<strong>{formatDisplayLabel(key)}</strong>
						<span>{formatNumber(value)}건</span>
					</div>
					<div className="qna-analysis-metric-track" aria-hidden="true">
						<div className="qna-analysis-metric-fill" style={{ width: `${Math.max(8, (Number(value || 0) / maxValue) * 100)}%` }} />
					</div>
				</div>
			))}
		</div>
	);
}

function buildSvgLinePath(values: number[], width: number, height: number, paddingX: number, paddingY: number, maxValue: number): string {
	return values
		.map((value, index) => {
			const x = paddingX + (index * (width - paddingX * 2)) / Math.max(1, values.length - 1);
			const y = height - paddingY - (value / Math.max(1, maxValue)) * (height - paddingY * 2);
			return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
		})
		.join(' ');
}

function buildSvgAreaPath(values: number[], width: number, height: number, paddingX: number, paddingY: number, maxValue: number): string {
	if (!values.length) return '';
	const linePath = buildSvgLinePath(values, width, height, paddingX, paddingY, maxValue);
	const lastX = paddingX + ((values.length - 1) * (width - paddingX * 2)) / Math.max(1, values.length - 1);
	const baseline = height - paddingY;
	return `${linePath} L ${lastX} ${baseline} L ${paddingX} ${baseline} Z`;
}

function QnaDailyTrendChart({ points }: { points: QnaTrendResponse['points'] }): JSX.Element {
	if (!points.length) return <div className="review-analysis-empty">기간 추이 데이터가 없습니다.</div>;
	const width = 720;
	const height = 240;
	const paddingX = 24;
	const paddingY = 24;
	const [hoverState, setHoverState] = useState<{ index: number; left: number; top: number } | null>(null);
	const totalValues = points.map((point) => Number(point.total_items || 0));
	const negativeValues = points.map((point) => Number(point.negative_count || 0));
	const faqValues = points.map((point) => Number(point.faq_candidate_count || 0));
	const maxValue = Math.max(...totalValues, ...negativeValues, ...faqValues, 1);
	const tickValues = [maxValue, Math.max(0, Math.round(maxValue / 2)), 0];
	const step = Math.max(1, Math.ceil(points.length / 6));
	const visibleLabels = points.filter((_, index) => index % step === 0 || index === points.length - 1);
	const series = [
		{ key: 'total', label: '전체 문의', color: '#60a5fa', fill: 'rgba(96, 165, 250, 0.16)', values: totalValues },
		{ key: 'negative', label: '부정 문의', color: '#f87171', fill: 'rgba(248, 113, 113, 0.12)', values: negativeValues },
		{ key: 'faq', label: 'FAQ 후보', color: '#34d399', fill: 'rgba(52, 211, 153, 0.12)', values: faqValues },
	];
	const safeHoveredIndex = hoverState == null ? null : Math.min(Math.max(hoverState.index, 0), Math.max(0, points.length - 1));
	const hoveredPoint = safeHoveredIndex == null ? null : points[safeHoveredIndex];
	const hoveredX = safeHoveredIndex == null ? null : paddingX + (safeHoveredIndex * (width - paddingX * 2)) / Math.max(1, points.length - 1);

	return (
		<div className="qna-analysis-trend-card">
			<div className="qna-analysis-trend-legend">
				{series.map((item) => (
					<div key={item.key} className="qna-analysis-trend-legend-item">
						<span className="qna-analysis-trend-legend-dot" style={{ backgroundColor: item.color }} />
						<span>{item.label}</span>
					</div>
				))}
			</div>
			<div className="qna-analysis-trend-chart-wrap">
				<div className="qna-analysis-trend-y-axis">
					{tickValues.map((value) => (
						<div key={value} className="qna-analysis-trend-y-tick">
							{formatNumber(value)}
						</div>
					))}
				</div>
				<div className="qna-analysis-trend-svg-wrap">
					{hoveredPoint ? (
						<div
							className="qna-analysis-trend-tooltip"
							aria-live="polite"
							style={{
								left: `${hoverState?.left ?? 0}px`,
								top: `${hoverState?.top ?? 0}px`,
							}}
						>
							<div className="qna-analysis-trend-tooltip-date">{hoveredPoint.date}</div>
							<div>전체 문의 {formatNumber(hoveredPoint.total_items || 0)}건</div>
							<div>부정 문의 {formatNumber(hoveredPoint.negative_count || 0)}건</div>
							<div>FAQ 후보 {formatNumber(hoveredPoint.faq_candidate_count || 0)}건</div>
						</div>
					) : null}
					<svg
						viewBox={`0 0 ${width} ${height}`}
						role="img"
						aria-label="Q&A 일별 추이 그래프"
						className="qna-analysis-trend-svg"
						onMouseMove={(event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							const relativeX = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
							const relativeY = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
							const paddingXPx = (paddingX / width) * rect.width;
							const innerWidthPx = Math.max(1, rect.width - paddingXPx * 2);
							const ratio = Math.min(1, Math.max(0, (relativeX - paddingXPx) / innerWidthPx));
							const index = Math.round(ratio * Math.max(0, points.length - 1));
							const tooltipWidth = 176;
							const tooltipHeight = 92;
							const nextLeft = Math.min(
								Math.max(8, relativeX + 16),
								Math.max(8, rect.width - tooltipWidth - 8),
							);
							const nextTop = Math.min(
								Math.max(8, relativeY - 18),
								Math.max(8, rect.height - tooltipHeight - 8),
							);
							setHoverState({ index, left: nextLeft, top: nextTop });
						}}
						onMouseLeave={() => setHoverState(null)}
					>
						{tickValues.map((value) => {
							const y = height - paddingY - (value / Math.max(1, maxValue)) * (height - paddingY * 2);
							return <line key={value} x1={paddingX} y1={y} x2={width - paddingX} y2={y} className="qna-analysis-trend-grid-line" />;
						})}
						{hoveredX != null ? <line x1={hoveredX} y1={paddingY} x2={hoveredX} y2={height - paddingY} className="qna-analysis-trend-cursor-line" /> : null}
						{series.map((item) => (
							<g key={item.key}>
								<path d={buildSvgAreaPath(item.values, width, height, paddingX, paddingY, maxValue)} fill={item.fill} />
								<path d={buildSvgLinePath(item.values, width, height, paddingX, paddingY, maxValue)} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" />
								{hoveredX != null && safeHoveredIndex != null ? (
									<circle
										cx={hoveredX}
										cy={height - paddingY - ((Number(item.values[safeHoveredIndex] || 0) || 0) / Math.max(1, maxValue)) * (height - paddingY * 2)}
										r="4"
										fill={item.color}
									/>
								) : null}
							</g>
						))}
					</svg>
					<div className="qna-analysis-trend-x-axis">
						{visibleLabels.map((point) => (
							<div key={point.date} className="qna-analysis-trend-x-tick">
								{formatDateMonthDayLabel(point.date)}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export function navigateToQnaPath(path: string): void {
	window.location.assign(path);
}

function normalizeResponseStateContext(value?: string | null): string {
	return normalizeQnaResponseState(value);
}

function responseStateContextLabel(value?: string | null): string {
	return labelQnaResponseState(normalizeResponseStateContext(value), '');
}

export function QnaAnalysisView({
	apiBaseUrl,
	onNavigate = navigateToQnaPath,
}: {
	apiBaseUrl: string;
	onNavigate?: (path: string) => void;
}): JSX.Element {
	const auth = useMaybeAuth();
	const authRef = useRef(auth);
	const defaultRange = useMemo(() => createRecentYmdRange(30), []);
	const initialQuery = useMemo(() => readInitialQnaAnalysisNavigationQuery(window.location.search, defaultRange), [defaultRange]);
	const [fromYmd, setFromYmd] = useState(initialQuery.fromYmd);
	const [toYmd, setToYmd] = useState(initialQuery.toYmd);
	const [qnaKind, setQnaKind] = useState<'all' | 'customer' | 'product'>(initialQuery.qnaKind);
	const [productName, setProductName] = useState('');
	const [category, setCategory] = useState('');
	const [inquiryType, setInquiryType] = useState('all');
	const [purchaseStage, setPurchaseStage] = useState<string>('all');
	const [sentiment, setSentiment] = useState<string>('all');
	const [conversionLevel, setConversionLevel] = useState<string>('all');
	const [search, setSearch] = useState(initialQuery.search);
	const [selectedIssueTag, setSelectedIssueTag] = useState<string | null>(initialQuery.issueTag || null);
	const [activeSection, setActiveSection] = useState<SectionId>(initialQuery.section);
	const [loading, setLoading] = useState(false);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [summary, setSummary] = useState<QnaSummaryResponse | null>(null);
	const [trend, setTrend] = useState<QnaTrendResponse | null>(null);
	const [conversionItems, setConversionItems] = useState<ConversionBarrierItem[]>([]);
	const [qualityItems, setQualityItems] = useState<QualityIssueItem[]>([]);
	const [faqItems, setFaqItems] = useState<FaqCandidateItem[]>([]);
	const [marketing, setMarketing] = useState<MarketingInsightsResponse | null>(null);
	const [itemResponse, setItemResponse] = useState<AnalysisItemsResponse | null>(null);
	const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

	useEffect(() => {
		authRef.current = auth;
	}, [auth]);

	const roleProtectedRequest = useCallback(
		async <T,>(method: 'get' | 'post', url: string, payload?: any, params?: Record<string, string | undefined>) =>
			await authRetryRequest<T>(
				axios,
				authRef.current?.getIdToken ? (options) => authRef.current?.getIdToken?.(options) : undefined,
				method,
				url,
				{ body: payload, params },
			),
		[],
	);

	const queryParams = useMemo(
		() => ({
			from_date: fromYmd,
			to_date: toYmd,
			qna_kind: qnaKind,
			product_name: productName.trim() || undefined,
			category: category.trim() || undefined,
			inquiry_type: inquiryType !== 'all' ? inquiryType : undefined,
			purchase_stage: purchaseStage !== 'all' ? purchaseStage : undefined,
			sentiment: sentiment !== 'all' ? sentiment : undefined,
			conversion_level: conversionLevel !== 'all' ? conversionLevel : undefined,
			search: search.trim() || undefined,
		}),
		[fromYmd, toYmd, qnaKind, productName, category, inquiryType, purchaseStage, sentiment, conversionLevel, search],
	);

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const [summaryRes, trendRes, conversionRes, qualityRes, faqRes, marketingRes, itemRes] = await Promise.all([
				roleProtectedRequest<QnaSummaryResponse>('get', `${apiBaseUrl}/qna/analysis/summary`, undefined, queryParams),
				roleProtectedRequest<QnaTrendResponse>('get', `${apiBaseUrl}/qna/analysis/trends`, undefined, queryParams),
				roleProtectedRequest<{ ok: boolean; items: ConversionBarrierItem[] }>('get', `${apiBaseUrl}/qna/analysis/conversion-barriers`, undefined, queryParams),
				roleProtectedRequest<{ ok: boolean; items: QualityIssueItem[] }>('get', `${apiBaseUrl}/qna/analysis/quality-issues`, undefined, queryParams),
				roleProtectedRequest<{ ok: boolean; items: FaqCandidateItem[] }>('get', `${apiBaseUrl}/qna/analysis/faq-candidates`, undefined, queryParams),
				roleProtectedRequest<MarketingInsightsResponse>('get', `${apiBaseUrl}/qna/analysis/marketing-insights`, undefined, queryParams),
				roleProtectedRequest<AnalysisItemsResponse>('get', `${apiBaseUrl}/qna/analysis/items`, undefined, queryParams),
			]);
			setSummary(summaryRes.data);
			setTrend(trendRes.data);
			setConversionItems(conversionRes.data.items || []);
			setQualityItems(qualityRes.data.items || []);
			setFaqItems(faqRes.data.items || []);
			setMarketing(marketingRes.data);
			setItemResponse(itemRes.data);
			setSelectedItemKey((prev) => {
				const candidates = itemRes.data.items || [];
				if (!candidates.length) return null;
				const firstCandidate = candidates[0];
				if (!firstCandidate) return null;
				return candidates.some((item) => item.qna_key === prev) ? prev : firstCandidate.qna_key;
			});
			setError(null);
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || 'Q&A 전문가 분석 정보를 불러오지 못했습니다.'));
		} finally {
			setLoading(false);
		}
	}, [apiBaseUrl, queryParams, roleProtectedRequest]);

	useEffect(() => {
		void loadAll();
	}, [loadAll]);

	const qualityIssueTagCounts = useMemo(
		() => issueTagCountsFromGroups(qualityItems.map((item) => item.issue_tags || [])),
		[qualityItems],
	);

	const filteredQualityItems = useMemo(
		() => qualityItems.filter((item) => matchesSelectedIssueTag(item.issue_tags, selectedIssueTag)),
		[qualityItems, selectedIssueTag],
	);

	const itemIssueTagCounts = useMemo(
		() => issueTagCountsFromGroups((itemResponse?.items || []).map((item) => item.analysis.issue_tags || [])),
		[itemResponse],
	);

	const filteredAnalysisItems = useMemo(
		() => (itemResponse?.items || []).filter((item) => matchesSelectedIssueTag(item.analysis.issue_tags, selectedIssueTag)),
		[itemResponse, selectedIssueTag],
	);

	const selectedItem = useMemo(
		() => filteredAnalysisItems.find((item) => item.qna_key === selectedItemKey) || filteredAnalysisItems[0] || null,
		[filteredAnalysisItems, selectedItemKey],
	);
	const responseStateLabel = responseStateContextLabel(initialQuery.responseState);

	const handleRunAnalysis = useCallback(async () => {
		setRunning(true);
		try {
			const res = await roleProtectedRequest<{ ok: boolean; requested_count: number; analyzed_count: number; skipped_count: number }>(
				'post',
				`${apiBaseUrl}/qna/analysis/run`,
				{
					from_date: fromYmd,
					to_date: toYmd,
					qna_kind: qnaKind,
					force_reanalyze: false,
				},
			);
			setActionMessage(`분석 실행 완료: ${formatNumber(res.data.analyzed_count || 0)}건 분석, ${formatNumber(res.data.skipped_count || 0)}건 재사용`);
			await loadAll();
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || '분석 실행에 실패했습니다.'));
		} finally {
			setRunning(false);
		}
	}, [apiBaseUrl, fromYmd, loadAll, qnaKind, roleProtectedRequest, toYmd]);

	const moveToManagement = useCallback(() => {
		const nextPath = buildQnaManagementPath({
			qnaKind,
			search,
			fromYmd,
			toYmd,
			productName,
			category,
			issueTag: selectedIssueTag,
			responseState: initialQuery.responseState,
		});
		onNavigate(nextPath);
	}, [category, fromYmd, initialQuery.responseState, onNavigate, productName, qnaKind, search, selectedIssueTag, toYmd]);

	return (
		<div className="review-analysis-page">
			<section className="card">
				<div className="card-title">Q&amp;A 전문가 분석</div>
				<div className="card-caption">
					`Q&amp;A 관리`에 수집된 문의 DB를 기반으로 전환, 상품 개선, FAQ, 마케팅 인사이트까지 한 화면에서 판단할 수 있도록 구성했습니다.
				</div>
				<div className="qna-analysis-toolbar">
					<SalesDateRangeControls
						fromYmd={fromYmd}
						toYmd={toYmd}
						onChange={({ fromYmd: nextFromYmd, toYmd: nextToYmd }) => {
							setFromYmd(nextFromYmd);
							setToYmd(nextToYmd);
						}}
						compact
						ariaLabel="qna-analysis-date-range"
					/>
					<div className="review-analysis-filter-row">
						<label className="review-analysis-filter-field">
							<span>문의 종류</span>
							<select value={qnaKind} onChange={(event) => setQnaKind(event.target.value as 'all' | 'customer' | 'product')}>
								<option value="all">전체</option>
								<option value="customer">고객 문의</option>
								<option value="product">상품 문의</option>
							</select>
						</label>
						<label className="review-analysis-filter-field">
							<span>상품명</span>
							<input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="상품명 필터" />
						</label>
						<label className="review-analysis-filter-field">
							<span>카테고리</span>
							<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="카테고리 필터" />
						</label>
						<label className="review-analysis-filter-field">
							<span>문의 유형</span>
							<select value={inquiryType} onChange={(event) => setInquiryType(event.target.value)}>
								<option value="all">전체</option>
								<option value="제품정보문의">제품정보문의</option>
								<option value="사용법문의">사용법문의</option>
								<option value="효과문의">효과문의</option>
								<option value="안전성문의">안전성문의</option>
								<option value="가격문의">가격문의</option>
								<option value="배송문의">배송문의</option>
								<option value="비교문의">비교문의</option>
								<option value="불만문의">불만문의</option>
							</select>
						</label>
						<label className="review-analysis-filter-field">
							<span>구매 단계</span>
							<select value={purchaseStage} onChange={(event) => setPurchaseStage(event.target.value)}>
								<option value="all">전체</option>
								<option value="탐색">탐색</option>
								<option value="비교검토">비교검토</option>
								<option value="구매직전">구매직전</option>
								<option value="구매후사용">구매후사용</option>
								<option value="클레임">클레임</option>
							</select>
						</label>
						<label className="review-analysis-filter-field">
							<span>감정</span>
							<select value={sentiment} onChange={(event) => setSentiment(event.target.value)}>
								<option value="all">전체</option>
								<option value="POSITIVE">긍정</option>
								<option value="NEUTRAL">중립</option>
								<option value="NEGATIVE">부정</option>
							</select>
						</label>
						<label className="review-analysis-filter-field">
							<span>전환영향도</span>
							<select value={conversionLevel} onChange={(event) => setConversionLevel(event.target.value)}>
								<option value="all">전체</option>
								<option value="HIGH">높음</option>
								<option value="MEDIUM">보통</option>
								<option value="LOW">낮음</option>
							</select>
						</label>
						<label className="review-analysis-filter-field qna-analysis-search-field">
							<span>검색</span>
							<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명 또는 문의 키워드" />
						</label>
						<div className="qna-analysis-toolbar-actions">
							<button
								type="button"
								className="btn-ghost"
								onClick={() => moveToManagement()}
							>
								Q&amp;A 관리 열기
							</button>
							<button type="button" className="btn-ghost" onClick={() => void loadAll()} disabled={loading}>
								필터 적용
							</button>
							<button type="button" className="btn-primary" onClick={() => void handleRunAnalysis()} disabled={running}>
								{running ? '분석 실행 중...' : '분석 실행'}
							</button>
						</div>
					</div>
				</div>
				<ContextBar
					contextLines={initialQuery.hasResponseStateContext && responseStateLabel ? [`관리 상태 컨텍스트: ${responseStateLabel}`] : []}
					actions={
						initialQuery.hasResponseStateContext && responseStateLabel
							? [{ label: 'Q&A 관리 컨텍스트로 복귀', onClick: () => moveToManagement() }]
							: []
					}
				/>
				{actionMessage ? <div className="review-analysis-inline-success">{actionMessage}</div> : null}
				{error ? <div className="review-analysis-inline-error">{error}</div> : null}
			</section>

			<section className="review-analysis-kpi-grid">
				<div className="review-analysis-kpi-card">
					<div className="review-analysis-kpi-label">총 문의</div>
					<div className="review-analysis-kpi-value">{formatNumber(summary?.summary.total_items ?? 0)}건</div>
				</div>
				<div className="review-analysis-kpi-card">
					<div className="review-analysis-kpi-label">구매 직전 문의</div>
					<div className="review-analysis-kpi-value">{formatNumber(summary?.summary.purchase_ready_count ?? 0)}건</div>
				</div>
				<div className="review-analysis-kpi-card review-analysis-kpi-negative">
					<div className="review-analysis-kpi-label">부정 문의</div>
					<div className="review-analysis-kpi-value">{formatNumber(summary?.summary.negative_count ?? 0)}건</div>
				</div>
				<div className="review-analysis-kpi-card review-analysis-kpi-positive">
					<div className="review-analysis-kpi-label">고전환 영향</div>
					<div className="review-analysis-kpi-value">{formatNumber(summary?.summary.high_conversion_count ?? 0)}건</div>
				</div>
				<div className="review-analysis-kpi-card">
					<div className="review-analysis-kpi-label">FAQ 후보</div>
					<div className="review-analysis-kpi-value">{formatNumber(summary?.summary.faq_candidate_count ?? 0)}건</div>
				</div>
			</section>

			<section className="card">
				<div className="card-title">활용 가이드</div>
				<div className="card-caption">분석 결과를 바탕으로 지금 무엇을 먼저 해야 하는지 우선순위와 함께 안내합니다.</div>
				<div className="review-analysis-action-list">
					{(summary?.action_guides || []).map((guide) => (
						<div key={`${guide.title}-${guide.target_area}`} className="review-analysis-action-row">
							<div className="qna-analysis-guide-main">
								<div className="review-analysis-action-title">
									{guide.title}{' '}
									<span className={`review-analysis-priority review-analysis-priority-${String(guide.priority || 'medium').toLowerCase()}`}>
										{formatPriorityLabel(guide.priority)}
									</span>
								</div>
								<div className="review-analysis-action-detail">왜: {guide.why}</div>
								<div className="review-analysis-action-detail">무엇을: {guide.what_to_do}</div>
							</div>
							<div className="qna-analysis-guide-side">
								<div className="review-analysis-action-detail">활용 영역: {guide.target_area}</div>
								<div className="qna-analysis-guide-actions">
									<button type="button" className="btn-ghost" onClick={() => setActiveSection(resolveQnaGuideSection(guide) as SectionId)}>
										관련 섹션 보기
									</button>
									<button type="button" className="btn-ghost" onClick={() => moveToManagement()}>
										Q&amp;A 관리에서 보기
									</button>
								</div>
							</div>
						</div>
					))}
					{!(summary?.action_guides || []).length ? <div className="review-analysis-empty">활용 가이드가 아직 없습니다.</div> : null}
				</div>
			</section>

			<section className="card">
				<div className="review-analysis-section-header">
					<div className="review-analysis-section-title">분석 섹션</div>
				</div>
				<div className="qna-analysis-section-tabs">
					<button type="button" className={`review-analysis-chip${activeSection === 'summary' ? ' is-active' : ''}`} onClick={() => setActiveSection('summary')}>문의 현황 요약</button>
					<button type="button" className={`review-analysis-chip${activeSection === 'conversion' ? ' is-active' : ''}`} onClick={() => setActiveSection('conversion')}>전환 장애 분석</button>
					<button type="button" className={`review-analysis-chip${activeSection === 'quality' ? ' is-active' : ''}`} onClick={() => setActiveSection('quality')}>품질/불만 분석</button>
					<button type="button" className={`review-analysis-chip${activeSection === 'faq' ? ' is-active' : ''}`} onClick={() => setActiveSection('faq')}>FAQ/상세페이지 개선</button>
					<button type="button" className={`review-analysis-chip${activeSection === 'marketing' ? ' is-active' : ''}`} onClick={() => setActiveSection('marketing')}>마케팅/광고 인사이트</button>
					<button type="button" className={`review-analysis-chip${activeSection === 'items' ? ' is-active' : ''}`} onClick={() => setActiveSection('items')}>원문 검색/개별 문의 분석</button>
				</div>
			</section>

			{activeSection === 'summary' ? (
				<section className="review-analysis-grid">
					<article className="card review-analysis-card">
						<div className="card-title">문의 유형 분포</div>
						{renderCountMap(summary?.inquiry_type_counts || {}, '집계된 문의 유형이 없습니다.')}
					</article>
					<article className="card review-analysis-card">
						<div className="card-title">구매 단계 분포</div>
						{renderCountMap(summary?.purchase_stage_counts || {}, '집계된 구매 단계가 없습니다.')}
					</article>
					<article className="card review-analysis-card">
						<div className="card-title">감정 분포</div>
						{renderCountMap(summary?.sentiment_counts || {}, '집계된 감정 데이터가 없습니다.')}
					</article>
					<article className="card review-analysis-card">
						<div className="card-title">기간 추이</div>
						<QnaDailyTrendChart points={trend?.points || []} />
					</article>
					<article className="card review-analysis-card">
						<div className="card-title">상품별 우선순위</div>
						<div className="review-analysis-summary-table-wrap">
							<table className="review-analysis-summary-table qna-analysis-priority-table" aria-label="상품별 우선순위 표">
								<colgroup>
									<col className="qna-analysis-col-product-wide" />
									<col className="qna-analysis-col-metric-tight" />
									<col className="qna-analysis-col-metric-tight" />
									<col className="qna-analysis-col-metric-tight" />
									<col className="qna-analysis-col-metric-tight" />
								</colgroup>
								<thead>
									<tr>
										<th>상품</th>
										<th>문의</th>
										<th>고전환</th>
										<th>부정</th>
										<th>FAQ 후보</th>
									</tr>
								</thead>
								<tbody>
									{(summary?.top_products || []).map((product) => (
										<tr key={product.product_name}>
											<td><div className="qna-analysis-table-text qna-analysis-table-text-singleline" title={product.product_name}>{product.product_name}</div></td>
											<td><span className="qna-analysis-table-metric">{formatNumber(product.total_items)}건</span></td>
											<td><span className="qna-analysis-table-metric">{formatNumber(product.high_conversion_count)}건</span></td>
											<td><span className="qna-analysis-table-metric qna-analysis-table-metric-negative">{formatNumber(product.negative_count)}건</span></td>
											<td><span className="qna-analysis-table-metric qna-analysis-table-metric-positive">{formatNumber(product.faq_candidate_count)}건</span></td>
										</tr>
									))}
									{!(summary?.top_products || []).length ? (
										<tr>
											<td colSpan={5}>상품 우선순위 데이터가 없습니다.</td>
										</tr>
									) : null}
								</tbody>
							</table>
						</div>
					</article>
				</section>
			) : null}

			{activeSection === 'conversion' ? (
				<section className="card">
					<div className="card-title">전환 장애 TOP</div>
					<div className="review-analysis-summary-table-wrap">
						<table className="review-analysis-summary-table">
							<colgroup>
								<col className="qna-analysis-col-product" />
								<col className="qna-analysis-col-text" />
								<col className="qna-analysis-col-label" />
								<col className="qna-analysis-col-label" />
								<col className="qna-analysis-col-metric" />
								<col className="qna-analysis-col-action" />
							</colgroup>
							<thead>
								<tr>
									<th>상품</th>
									<th>문의</th>
									<th>유형</th>
									<th>단계</th>
									<th>전환점수</th>
									<th>추천 액션</th>
								</tr>
							</thead>
							<tbody>
								{conversionItems.map((item) => (
									<tr key={item.qna_key}>
										<td><div className="qna-analysis-table-text">{item.product_name || '-'}</div></td>
										<td><div className="qna-analysis-table-text qna-analysis-table-text-strong">{item.inquiry_text}</div></td>
										<td><span className="qna-analysis-table-badge">{item.inquiry_type || '-'}</span></td>
										<td><span className="qna-analysis-table-badge">{item.purchase_stage || '-'}</span></td>
										<td><span className="qna-analysis-table-metric">{formatNumber(item.conversion_impact_score)}점</span></td>
										<td><div className="qna-analysis-table-text">{item.recommended_action || '-'}</div></td>
									</tr>
								))}
								{!conversionItems.length ? (
									<tr>
										<td colSpan={6}>전환 장애 데이터가 없습니다.</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{activeSection === 'quality' ? (
				<section className="card">
					<div className="card-title">품질/불만 이슈</div>
					<IssueTagFilterBar
						title="품질 이슈 태그별 보기"
						counts={qualityIssueTagCounts}
						totalCount={qualityItems.length}
						selectedIssueTag={selectedIssueTag}
						onSelect={setSelectedIssueTag}
					/>
					<div className="review-analysis-summary-table-wrap">
						<table className="review-analysis-summary-table">
							<colgroup>
								<col className="qna-analysis-col-product" />
								<col className="qna-analysis-col-text" />
								<col className="qna-analysis-col-label" />
								<col className="qna-analysis-col-label" />
								<col className="qna-analysis-col-action" />
							</colgroup>
							<thead>
								<tr>
									<th>상품</th>
									<th>원문</th>
									<th>이슈 태그</th>
									<th>심각도</th>
									<th>추천 액션</th>
								</tr>
							</thead>
							<tbody>
								{filteredQualityItems.map((item) => (
									<tr key={item.qna_key}>
										<td><div className="qna-analysis-table-text">{item.product_name || '-'}</div></td>
										<td><div className="qna-analysis-table-text qna-analysis-table-text-strong">{item.inquiry_text}</div></td>
										<td><span className="qna-analysis-table-badge">{formatIssueTags(item.issue_tags)}</span></td>
										<td><span className="qna-analysis-table-badge qna-analysis-table-badge-negative">{formatDisplayLabel(item.severity)}</span></td>
										<td><div className="qna-analysis-table-text">{item.recommended_action || '-'}</div></td>
									</tr>
								))}
								{!filteredQualityItems.length ? (
									<tr>
										<td colSpan={5}>선택한 이슈 태그에 맞는 품질/불만 데이터가 없습니다.</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{activeSection === 'faq' ? (
				<section className="card">
					<div className="card-title">FAQ 및 상세페이지 개선 후보</div>
					<div className="review-analysis-summary-table-wrap">
						<table className="review-analysis-summary-table">
							<colgroup>
								<col className="qna-analysis-col-product" />
								<col className="qna-analysis-col-text" />
								<col className="qna-analysis-col-metric" />
								<col className="qna-analysis-col-action" />
								<col className="qna-analysis-col-label" />
							</colgroup>
							<thead>
								<tr>
									<th>상품</th>
									<th>질문</th>
									<th>전환점수</th>
									<th>추천 답변</th>
									<th>권장 섹션</th>
								</tr>
							</thead>
							<tbody>
								{faqItems.map((item) => (
									<tr key={item.qna_key}>
										<td><div className="qna-analysis-table-text">{item.product_name || '-'}</div></td>
										<td><div className="qna-analysis-table-text qna-analysis-table-text-strong">{item.inquiry_text}</div></td>
										<td><span className="qna-analysis-table-metric">{formatNumber(item.conversion_impact_score)}점</span></td>
										<td><div className="qna-analysis-table-text">{item.recommended_answer || '-'}</div></td>
										<td><span className="qna-analysis-table-badge">{item.recommended_section || '-'}</span></td>
									</tr>
								))}
								{!faqItems.length ? (
									<tr>
										<td colSpan={5}>FAQ 후보 데이터가 없습니다.</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{activeSection === 'marketing' ? (
				<section className="review-analysis-grid">
					<article className="card review-analysis-card">
						<div className="card-title">고객 표현 키워드 TOP</div>
						<div className="review-analysis-bullets">
							{(marketing?.top_keywords || []).map((item) => (
								<div key={item.keyword}>
									<strong>{item.keyword}</strong>: {formatNumber(item.count)}건 · {formatDisplayLabel(item.sentiment)} · {item.recommended_usage || '-'}
								</div>
							))}
							{!(marketing?.top_keywords || []).length ? <div>키워드 인사이트가 없습니다.</div> : null}
						</div>
					</article>
					<article className="card review-analysis-card">
						<div className="card-title">광고/상세페이지 카피 후보</div>
						<div className="review-analysis-bullets">
							{(marketing?.copy_candidates || []).map((item) => (
								<div key={item.phrase}>
									<strong>{item.phrase}</strong>: {item.recommended_channel || '-'}
								</div>
							))}
							{!(marketing?.copy_candidates || []).length ? <div>카피 후보가 없습니다.</div> : null}
						</div>
					</article>
				</section>
			) : null}

			{activeSection === 'items' ? (
				<section className="review-analysis-grid-wide">
					<article className="card">
						<div className="card-title">원문 목록</div>
						<IssueTagFilterBar
							title="원문 이슈 태그별 보기"
							counts={itemIssueTagCounts}
							totalCount={(itemResponse?.items || []).length}
							selectedIssueTag={selectedIssueTag}
							onSelect={setSelectedIssueTag}
						/>
						<div className="review-analysis-summary-table-wrap">
							<table className="review-analysis-summary-table">
								<colgroup>
									<col className="qna-analysis-col-date" />
									<col className="qna-analysis-col-product" />
									<col className="qna-analysis-col-text" />
									<col className="qna-analysis-col-label" />
									<col className="qna-analysis-col-label" />
								</colgroup>
								<thead>
									<tr>
										<th>일시</th>
										<th>상품</th>
										<th>문의</th>
										<th>단계</th>
										<th>감정</th>
									</tr>
								</thead>
								<tbody>
									{filteredAnalysisItems.map((item) => (
										<tr
											key={item.qna_key}
											className={item.qna_key === selectedItem?.qna_key ? 'review-analysis-table-row-active' : ''}
											onClick={() => setSelectedItemKey(item.qna_key)}
										>
											<td><span className="qna-analysis-table-date">{formatDateTimeKo(item.inquiry_registered_at)}</span></td>
											<td><div className="qna-analysis-table-text">{item.product_name || '-'}</div></td>
											<td><div className="qna-analysis-table-text qna-analysis-table-text-strong">{item.inquiry_text}</div></td>
											<td><span className="qna-analysis-table-badge">{item.analysis.purchase_stage || '-'}</span></td>
											<td><span className="qna-analysis-table-badge">{formatDisplayLabel(item.analysis.sentiment)}</span></td>
										</tr>
									))}
									{!filteredAnalysisItems.length ? (
										<tr>
											<td colSpan={5}>선택한 이슈 태그에 맞는 문의가 없습니다.</td>
										</tr>
									) : null}
								</tbody>
							</table>
						</div>
					</article>
					<article className="card">
						<div className="card-title">개별 문의 분석</div>
						{selectedItem ? (
							<div className="review-analysis-selected-context">
								<div className="qna-analysis-detail-row"><strong>문의 원문</strong> <span>{selectedItem.inquiry_text}</span></div>
								<div className="qna-analysis-detail-row"><strong>요약</strong> <span>{selectedItem.analysis.summary_text || '-'}</span></div>
								<div className="qna-analysis-detail-row"><strong>구매 단계</strong> <span>{selectedItem.analysis.purchase_stage || '-'}</span></div>
								<div className="qna-analysis-detail-row"><strong>감정</strong> <span>{formatDisplayLabel(selectedItem.analysis.sentiment)}</span></div>
								<div className="qna-analysis-detail-row"><strong>전환 점수</strong> <span>{formatNumber(selectedItem.analysis.conversion_impact_score)}점</span></div>
								<div className="qna-analysis-detail-row"><strong>키워드</strong> <span>{selectedItem.analysis.keywords.join(', ') || '-'}</span></div>
								<div className="qna-analysis-detail-row"><strong>이슈 태그</strong> <span>{formatIssueTags(selectedItem.analysis.issue_tags)}</span></div>
								<div className="qna-analysis-detail-row"><strong>추천 조치</strong> <span>{selectedItem.recommended_action || '-'}</span></div>
							</div>
						) : (
							<div className="review-analysis-empty">선택된 문의가 없습니다.</div>
						)}
					</article>
				</section>
			) : null}

			{loading ? <div className="review-analysis-inline-success">Q&amp;A 전문가 분석 데이터를 불러오는 중...</div> : null}
		</div>
	);
}
