import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { createPortal } from 'react-dom';
import { useMaybeAuth } from '../auth/AuthProvider';
import { SalesDateRangeControls } from '../sales/SalesDateRangeControls';
import {
	buildReviewManagementPath,
	readInitialReviewAnalysisNavigationQuery,
} from '../../shared/navigation/analyticsNavigation';
import {
	buildReviewProductOverview,
	canonicalizeReviewProductUrl,
	type ReviewProductOverviewItem,
} from '../../shared/domain/analyticsDomain';
import {
	describeReviewCategory,
	formatSignedReviewNumber,
	formatSignedReviewPercent,
	labelReviewAnalysisPriority,
} from '../../shared/presentation/reviewPresentation';
import { authRetryGet } from '../../shared/auth/authRetry';
import { formatDateTextOrDash, formatLocalYmd } from '../../shared/utils/dateText';
import { ContextBar } from '../../shared/ui/ContextBar';

type KeywordInsightItem = {
	keyword: string;
	count: number;
	positive_count: number;
	negative_count: number;
	positive_ratio: number;
	negative_ratio: number;
};

type ReviewAnalysisCategoryItem = {
	category: string;
	mention_count: number;
	positive_count: number;
	neutral_count: number;
	negative_count: number;
	positive_ratio: number;
	negative_ratio: number;
	average_rating: number;
	top_keywords: string[];
	positive_examples: ReviewAnalysisEvidenceItem[];
	negative_examples: ReviewAnalysisEvidenceItem[];
	headline: string | null;
	value_summary: string | null;
	concern_summary: string | null;
	target_summary: string | null;
};

type ReviewAnalysisEvidenceItem = {
	review_key: string;
	review_text: string;
	product_url: string | null;
	product_title: string | null;
	review_written_at: string | null;
	rating: number | null;
};

type ReviewAnalysisDashboardResponse = {
	ok: boolean;
	date_from: string | null;
	date_to: string | null;
	product_url: string | null;
	summary: {
		total_reviews: number;
		average_rating: number;
		positive_reviews: number;
		neutral_reviews: number;
		negative_reviews: number;
		positive_ratio: number;
		negative_ratio: number;
		latest_review_count: number;
		previous_review_count: number;
		review_growth_rate: number;
		latest_average_rating: number;
		previous_average_rating: number;
		rating_delta: number;
		high_risk_category: string | null;
		top_positive_category: string | null;
		insight_summary: string | null;
	};
	rating_distribution: {
		total_reviews: number;
		average_rating: number;
		counts: Record<string, number>;
		ratios: Record<string, number>;
	};
	trend: Array<{
		date: string;
		review_count: number;
		average_rating: number;
		low_rating_count: number;
		low_rating_ratio: number;
	}>;
	category_overview: ReviewAnalysisCategoryItem[];
	keyword_insights: {
		top_keywords: KeywordInsightItem[];
		rising_keywords: KeywordInsightItem[];
		risk_keywords: KeywordInsightItem[];
	};
	action_items: Array<{
		title: string;
		detail: string;
		priority: string;
	}>;
	source_info: {
		raw_review_count: number;
		daily_snapshot_count: number;
		product_count: number;
		last_review_date: string | null;
	};
	product_overview: ReviewProductOverviewItem[];
};

function addDays(input: Date, days: number): Date {
	const next = new Date(input);
	next.setDate(next.getDate() + days);
	return next;
}

function formatNumber(value: number, fractionDigits = 0): string {
	return new Intl.NumberFormat('ko-KR', {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(Number.isFinite(value) ? value : 0);
}

function trimEvidenceText(value: string, limit = 88): string {
	const normalized = String(value || '').replace(/\s+/g, ' ').trim();
	if (normalized.length <= limit) return normalized;
	return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function triggerCsvDownload(filename: string, rows: string[][]): void {
	const csv = rows
		.map((row) =>
			row
				.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
				.join(','),
		)
		.join('\n');
	const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

function navigateToReviewManagementPath(path: string): void {
	window.location.assign(path);
}

function PriorityBadge({ priority }: { priority: string }): JSX.Element {
	const normalized = String(priority || 'medium').toLowerCase();
	const label = labelReviewAnalysisPriority(priority);
	return <span className={`review-analysis-priority review-analysis-priority-${normalized}`}>{label}</span>;
}

function getTrendBarWidth(value: number): string {
	if (value <= 0) return '0%';
	return `${Math.max(14, Math.min(100, value))}%`;
}

function ReviewCategoryTooltip({
	category,
	labelPrefix,
	tone = 'default',
	className = '',
}: {
	category: string | null | undefined;
	labelPrefix: string;
	tone?: 'default' | 'negative' | 'positive';
	className?: string;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const [bubbleStyle, setBubbleStyle] = useState<{ left: number; top: number } | null>(null);
	const normalizedCategory = String(category || '').trim() || '미집계';
	const description = describeReviewCategory(category);

	useLayoutEffect(() => {
		if (!open || !triggerRef.current || typeof window === 'undefined') return;
		const rect = triggerRef.current.getBoundingClientRect();
		const bubbleWidth = Math.min(320, Math.max(220, Math.floor(window.innerWidth * 0.28)));
		const horizontalMargin = 12;
		const preferredLeft = rect.left;
		const clampedLeft = Math.max(horizontalMargin, Math.min(preferredLeft, window.innerWidth - bubbleWidth - horizontalMargin));
		const belowTop = rect.bottom + 10;
		const aboveTop = rect.top - 88;
		const top = belowTop + 88 <= window.innerHeight ? belowTop : Math.max(12, aboveTop);
		setBubbleStyle({ left: clampedLeft, top });
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const refreshPosition = () => {
			if (!triggerRef.current || typeof window === 'undefined') return;
			const rect = triggerRef.current.getBoundingClientRect();
			const bubbleWidth = Math.min(320, Math.max(220, Math.floor(window.innerWidth * 0.28)));
			const horizontalMargin = 12;
			const preferredLeft = rect.left;
			const clampedLeft = Math.max(horizontalMargin, Math.min(preferredLeft, window.innerWidth - bubbleWidth - horizontalMargin));
			const belowTop = rect.bottom + 10;
			const aboveTop = rect.top - 88;
			const top = belowTop + 88 <= window.innerHeight ? belowTop : Math.max(12, aboveTop);
			setBubbleStyle({ left: clampedLeft, top });
		};
		window.addEventListener('scroll', refreshPosition, true);
		window.addEventListener('resize', refreshPosition);
		return () => {
			window.removeEventListener('scroll', refreshPosition, true);
			window.removeEventListener('resize', refreshPosition);
		};
	}, [open]);

	return (
		<span
			className={`review-analysis-category-tooltip-wrap${className ? ` ${className}` : ''}`}
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
		>
			<button
				ref={triggerRef}
				type="button"
				className={`review-analysis-category-tooltip-trigger review-analysis-category-tooltip-trigger-${tone}`}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				aria-label={`${labelPrefix}: ${normalizedCategory}`}
			>
				{normalizedCategory}
			</button>
			{open && bubbleStyle && typeof document !== 'undefined'
				? createPortal(
						<span className="review-analysis-category-tooltip-bubble" role="tooltip" style={bubbleStyle}>
							<strong>{normalizedCategory}</strong>
							<span>{description}</span>
						</span>,
						document.body,
				  )
				: null}
		</span>
	);
}

function TrendChart({
	title,
	tagLabel,
	xAxisLabel,
	yAxisLabel,
	points,
	valueKey,
	stroke,
	labelFormatter,
	yAxisFormatter,
}: {
	title: string;
	tagLabel: string;
	xAxisLabel: string;
	yAxisLabel: string;
	points: ReviewAnalysisDashboardResponse['trend'];
	valueKey: 'review_count' | 'average_rating' | 'low_rating_ratio';
	stroke: string;
	labelFormatter: (point: ReviewAnalysisDashboardResponse['trend'][number]) => string;
	yAxisFormatter: (value: number) => string;
}): JSX.Element {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
	const width = 720;
	const height = 220;
	const leftPadding = 58;
	const rightPadding = 18;
	const topPadding = 20;
	const bottomPadding = 34;
	const values = points.map((point) => Number(point[valueKey] || 0));
	const maxValue = Math.max(...values, 1);
	const minValue = Math.min(...values, 0);
	const range = Math.max(1, maxValue - minValue);
	const xSpan = width - leftPadding - rightPadding;
	const ySpan = height - topPadding - bottomPadding;
	const plottedPoints = points.map((point, index) => {
		const x = leftPadding + (index * xSpan) / Math.max(1, points.length - 1);
		const y = height - bottomPadding - ((Number(point[valueKey] || 0) - minValue) / range) * ySpan;
		return { point, index, x, y };
	});
	const firstPlottedPoint = plottedPoints[0] ?? null;
	const lastPlottedPoint = plottedPoints.length > 0 ? plottedPoints[plottedPoints.length - 1] ?? null : null;
	const path = plottedPoints.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
	const fillPath =
		firstPlottedPoint && lastPlottedPoint
			? `${path} L ${lastPlottedPoint.x} ${height - bottomPadding} L ${firstPlottedPoint.x} ${height - bottomPadding} Z`
			: '';
	const yTicks = Array.from({ length: 4 }, (_, index) => {
		const ratio = index / 3;
		const value = maxValue - range * ratio;
		const y = topPadding + ySpan * ratio;
		return { value, y };
	});
	const hoveredPoint = hoveredIndex == null ? null : plottedPoints[hoveredIndex] || null;
	const tooltipLeft = hoveredPoint ? `${(hoveredPoint.x / width) * 100}%` : '50%';

	return (
		<div className="review-analysis-trend-card">
			<div className="review-analysis-trend-card-header">
				<div className="review-analysis-section-title">{title}</div>
				<div className="review-analysis-chip-group">
					<span className="review-analysis-chip">{tagLabel}</span>
					<span className="review-analysis-chip">{xAxisLabel}</span>
					<span className="review-analysis-chip">{yAxisLabel}</span>
				</div>
			</div>
			<div className="review-analysis-trend-chart">
				{hoveredPoint ? (
					<div className="review-analysis-trend-tooltip" style={{ left: tooltipLeft }}>
						<strong>{`${hoveredPoint.point.date} · ${labelFormatter(hoveredPoint.point)}`}</strong>
					</div>
				) : null}
				<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} 차트`}>
					{yTicks.map((tick) => (
						<g key={`${title}-${tick.y}`}>
							<path d={`M ${leftPadding} ${tick.y} L ${width - rightPadding} ${tick.y}`} className="review-analysis-axis review-analysis-axis-grid" />
							<text x={leftPadding - 8} y={tick.y + 4} className="review-analysis-axis-text" textAnchor="end">
								{yAxisFormatter(tick.value)}
							</text>
						</g>
					))}
					<path d={`M ${leftPadding} ${height - bottomPadding} L ${width - rightPadding} ${height - bottomPadding}`} className="review-analysis-axis" />
					<path d={`M ${leftPadding} ${topPadding} L ${leftPadding} ${height - bottomPadding}`} className="review-analysis-axis" />
					{fillPath ? <path d={fillPath} className="review-analysis-trend-area" style={{ fill: stroke }} /> : null}
					<path d={path || ''} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
					<text x={width / 2} y={height - 6} className="review-analysis-axis-text" textAnchor="middle">
						{xAxisLabel}
					</text>
					<text
						x={18}
						y={height / 2}
						className="review-analysis-axis-text"
						textAnchor="middle"
						transform={`rotate(-90 18 ${height / 2})`}
					>
						{yAxisLabel}
					</text>
					{plottedPoints.map(({ point, index, x, y }) => (
						<g
							key={`${point.date}-${valueKey}`}
							role="button"
							tabIndex={0}
							aria-label={`${title} 포인트 ${point.date} ${labelFormatter(point)}`}
							onMouseEnter={() => setHoveredIndex(index)}
							onFocus={() => setHoveredIndex(index)}
							onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
							onBlur={() => setHoveredIndex((current) => (current === index ? null : current))}
						>
							<circle cx={x} cy={y} r="12" fill="transparent" />
							<circle cx={x} cy={y} r="4.5" fill={stroke} />
						</g>
					))}
				</svg>
			</div>
			<div className="review-analysis-trend-labels">
				{points.map((point) => (
					<div key={`${point.date}-label`} className="review-analysis-trend-label">
						<div>{point.date.slice(5)}</div>
						<strong>{labelFormatter(point)}</strong>
					</div>
				))}
			</div>
		</div>
	);
}

function KeywordList({
	title,
	description,
	items,
	emptyText,
}: {
	title: string;
	description: string;
	items: KeywordInsightItem[];
	emptyText: string;
}): JSX.Element {
	return (
		<div className="review-analysis-keyword-panel">
			<div className="review-analysis-section-title">{title}</div>
			<div className="review-analysis-keyword-panel-caption">{description}</div>
			<div className="review-analysis-keyword-list">
				{items.length ? (
					items.map((item) => (
						<div key={`${title}-${item.keyword}`} className="review-analysis-keyword-row">
							<div className="review-analysis-keyword-main">
								<strong>{item.keyword}</strong>
								<div className="review-analysis-keyword-meta">
									언급 {formatNumber(item.count)}건 · 긍정 {formatNumber(item.positive_ratio, 1)}% · 부정 {formatNumber(item.negative_ratio, 1)}%
								</div>
							</div>
							<div className="review-analysis-keyword-bars">
								<div className="review-analysis-keyword-bar-row">
									<span className="review-analysis-keyword-bar-label review-analysis-keyword-bar-label-positive">긍정</span>
									<div className="review-analysis-keyword-bar-track">
										<div
											className="review-analysis-keyword-bar-fill review-analysis-keyword-bar-fill-positive"
											style={{ width: getTrendBarWidth(item.positive_ratio) }}
											aria-label={`${item.keyword} 긍정 바 ${item.positive_count}건`}
										>
											<span>{formatNumber(item.positive_count)}건</span>
										</div>
									</div>
								</div>
								<div className="review-analysis-keyword-bar-row">
									<span className="review-analysis-keyword-bar-label review-analysis-keyword-bar-label-negative">부정</span>
									<div className="review-analysis-keyword-bar-track">
										<div
											className="review-analysis-keyword-bar-fill review-analysis-keyword-bar-fill-negative"
											style={{ width: getTrendBarWidth(item.negative_ratio) }}
											aria-label={`${item.keyword} 부정 바 ${item.negative_count}건`}
										>
											<span>{formatNumber(item.negative_count)}건</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					))
				) : (
					<div className="review-analysis-empty">{emptyText}</div>
				)}
			</div>
		</div>
	);
}

export function ReviewAnalysisOverviewView({
	apiBaseUrl,
	onNavigate = navigateToReviewManagementPath,
}: {
	apiBaseUrl: string;
	onNavigate?: (path: string) => void;
}): JSX.Element {
	const auth = useMaybeAuth();
	const authRef = useRef(auth);
	const [data, setData] = useState<ReviewAnalysisDashboardResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const today = useMemo(() => new Date(), []);
	const defaultRange = useMemo(
		() => ({
			fromYmd: formatLocalYmd(addDays(today, -29)),
			toYmd: formatLocalYmd(today),
		}),
		[today],
	);
	const initialQuery = useMemo(() => readInitialReviewAnalysisNavigationQuery(window.location.search, defaultRange), [defaultRange]);
	const [selectedProductUrl, setSelectedProductUrl] = useState(initialQuery.productUrl);
	const [showAllCategories, setShowAllCategories] = useState(false);
	const [evidenceModal, setEvidenceModal] = useState<{
		category: string;
		sentiment: 'positive' | 'negative';
		evidence: ReviewAnalysisEvidenceItem;
	} | null>(null);
	const [range, setRange] = useState(() => ({
		fromYmd: initialQuery.fromYmd,
		toYmd: initialQuery.toYmd,
	}));

	useEffect(() => {
		authRef.current = auth;
	}, [auth]);

	const roleProtectedGet = useCallback(
		async <T,>(url: string, params: Record<string, unknown>) =>
			await authRetryGet<T>(
				axios,
				authRef.current?.getIdToken ? (options) => authRef.current?.getIdToken?.(options) : undefined,
				url,
				{ params },
			),
		[],
	);

	const fetchDashboard = useCallback(async () => {
		setLoading(true);
		try {
			const res = await roleProtectedGet<ReviewAnalysisDashboardResponse>(`${apiBaseUrl}/reviews/analysis-dashboard`, {
				from_date: range.fromYmd,
				to_date: range.toYmd,
				product_url: selectedProductUrl || undefined,
			});
			setData(res.data);
			setError(null);
		} catch (requestError: any) {
			setError(String(requestError?.response?.data?.detail || requestError?.message || '리뷰 분석 정보를 불러오지 못했습니다.'));
		} finally {
			setLoading(false);
		}
	}, [apiBaseUrl, range.fromYmd, range.toYmd, roleProtectedGet, selectedProductUrl]);

	useEffect(() => {
		void fetchDashboard();
	}, [fetchDashboard]);

	const kpis = useMemo(
		() => [
			{ label: '총 리뷰', value: `${formatNumber(data?.summary.total_reviews ?? 0)}건`, tone: 'neutral' },
			{ label: '평균 평점', value: `${formatNumber(data?.summary.average_rating ?? 0, 2)}점`, tone: 'positive' },
			{ label: '긍정 비율', value: `${formatNumber(data?.summary.positive_ratio ?? 0, 1)}%`, tone: 'positive' },
			{ label: '부정 비율', value: `${formatNumber(data?.summary.negative_ratio ?? 0, 1)}%`, tone: 'negative' },
			{ label: '리뷰 증감', value: formatSignedReviewPercent(data?.summary.review_growth_rate ?? 0), tone: 'neutral' },
			{ label: '위험 카테고리', value: data?.summary.high_risk_category || '없음', tone: 'negative', isCategory: true },
		],
		[data],
	);

	const categorySummaryRows = useMemo(
		() =>
			(data?.category_overview || []).map((item) => ({
				category: item.category,
				headline: item.headline || '-',
				value: item.value_summary || '-',
				concern: item.concern_summary || '-',
				target: item.target_summary || '-',
			})),
		[data],
	);

	const visibleCategories = useMemo(() => {
		const items = data?.category_overview || [];
		return showAllCategories ? items : items.slice(0, 4);
	}, [data, showAllCategories]);

	const productOverviewItems = useMemo(() => buildReviewProductOverview(data?.product_overview || []), [data]);

	const selectedProduct = useMemo(
		() => productOverviewItems.find((item) => canonicalizeReviewProductUrl(item.product_url) === canonicalizeReviewProductUrl(selectedProductUrl)) || null,
		[productOverviewItems, selectedProductUrl],
	);
	const moveToManagement = useCallback(() => {
		onNavigate(
			buildReviewManagementPath(window.location.pathname, {
				fromYmd: range.fromYmd,
				toYmd: range.toYmd,
				productUrl: selectedProductUrl || undefined,
			}),
		);
	}, [onNavigate, range.fromYmd, range.toYmd, selectedProductUrl]);

	const openEvidenceProductDetail = useCallback(() => {
		const productUrl = evidenceModal?.evidence.product_url;
		if (!productUrl) return;
		window.open(productUrl, '_blank', 'noopener,noreferrer');
	}, [evidenceModal]);

	const focusEvidenceProductAnalysis = useCallback(() => {
		const productUrl = evidenceModal?.evidence.product_url || '';
		if (!productUrl) return;
		setSelectedProductUrl(productUrl);
		setShowAllCategories(false);
		setEvidenceModal(null);
	}, [evidenceModal]);

	const handleDownloadAll = useCallback(() => {
		if (!data) return;
		triggerCsvDownload(
			`review-analysis-${range.fromYmd}-${range.toYmd}.csv`,
			[
				['분류', '헤드라인', '가치', '우려', '대상', '평점', '언급', '긍정%', '부정%'],
				...categorySummaryRows.map((row, index) => {
					const category = data.category_overview[index];
					if (!category) {
						return [row.category, row.headline, row.value, row.concern, row.target, '-', '0', '-', '-'];
					}
					return [
						row.category,
						row.headline,
						row.value,
						row.concern,
						row.target,
						formatNumber(category.average_rating, 2),
						String(category.mention_count),
						formatNumber(category.positive_ratio, 1),
						formatNumber(category.negative_ratio, 1),
					];
				}),
			],
		);
	}, [categorySummaryRows, data, range.fromYmd, range.toYmd]);

	const totalReviewCount = data?.summary.total_reviews ?? 0;

	const handleDownloadExamples = useCallback(
		(kind: 'positive' | 'negative') => {
			if (!data) return;
			const rows: string[][] = [['카테고리', '유형', '상품', '작성일', '평점', '근거 문장']];
			for (const category of data.category_overview) {
				const examples = kind === 'positive' ? category.positive_examples : category.negative_examples;
				for (const example of examples) {
					rows.push([
						category.category,
						kind === 'positive' ? '긍정' : '부정',
						example.product_title || example.product_url || '-',
						example.review_written_at || '-',
						example.rating == null ? '-' : formatNumber(example.rating, 1),
						example.review_text,
					]);
				}
			}
			triggerCsvDownload(`review-analysis-${kind}-examples-${range.fromYmd}-${range.toYmd}.csv`, rows);
		},
		[data, range.fromYmd, range.toYmd],
	);

	return (
		<div className="review-analysis-page">
			<section className="card">
				<div className="review-dashboard-header">
					<div>
						<div className="card-title">리뷰 분석</div>
						<div className="card-caption">
							리뷰 원문과 일간 스냅샷을 함께 분석해 경영 요약, 추이, 카테고리, 키워드, 실행 포인트를 한 화면에서 확인합니다.
						</div>
					</div>
					<div className="review-dashboard-header-actions">
						<button type="button" className="btn-ghost" onClick={() => void fetchDashboard()} disabled={loading}>
							{loading ? '불러오는 중...' : '새로고침'}
						</button>
					</div>
				</div>
				<div className="review-dashboard-date-control">
					<SalesDateRangeControls
						fromYmd={range.fromYmd}
						toYmd={range.toYmd}
						onChange={setRange}
						title="조회 기간"
						ariaLabel="review-analysis-date-range"
						compact
						disabled={loading}
					/>
				</div>
				<div className="review-analysis-filter-row">
					<label className="review-analysis-filter-field">
						<span>상품 선택</span>
						<select
							className="review-control-select"
							aria-label="review-analysis-product-filter"
							value={selectedProductUrl}
							onChange={(event) => {
								setSelectedProductUrl(event.target.value);
								setShowAllCategories(false);
							}}
							disabled={loading}
						>
							<option value="">전체 상품</option>
							{productOverviewItems.map((item) => (
								<option key={item.product_url} value={item.product_url}>
									{item.product_title || item.product_url}
								</option>
							))}
						</select>
					</label>
				</div>
				<ContextBar
					contextLines={[
						`조회 기간 ${range.fromYmd} ~ ${range.toYmd}`,
						...(selectedProduct ? [`선택 상품: ${selectedProduct.product_title || selectedProduct.product_url}`] : []),
						...(selectedProduct
							? [`현재 보고서 범위: 리뷰 ${formatNumber(selectedProduct.review_count)}건 · 평점 ${formatNumber(selectedProduct.average_rating, 2)} · 부정 ${formatNumber(selectedProduct.negative_ratio, 1)}%`]
							: []),
					]}
					actions={[
						...(selectedProduct
							? [
									{
										label: '전체 상품 보기',
										onClick: () => {
											setSelectedProductUrl('');
											setShowAllCategories(false);
										},
									},
							  ]
							: []),
						{ label: '리뷰 관리로 이동', onClick: moveToManagement },
					]}
				/>
				{error ? <div className="review-analysis-inline-error" style={{ marginTop: 10 }}>{error}</div> : null}
			</section>

			<section className="review-analysis-kpi-grid">
				{kpis.map((item) => (
					<article key={item.label} className={`card review-analysis-kpi-card review-analysis-kpi-${item.tone}`}>
						<div className="review-analysis-kpi-label">{item.label}</div>
						<div className="review-analysis-kpi-value">
							{item.isCategory && item.value !== '없음' ? (
								<ReviewCategoryTooltip category={item.value} labelPrefix={`${item.label} 설명 보기`} tone="negative" className="review-analysis-kpi-tooltip" />
							) : (
								item.value
							)}
						</div>
					</article>
				))}
			</section>

			<section className="review-analysis-grid review-analysis-grid-wide">
				<article className="card review-analysis-card">
					<div className="review-analysis-section-header">
						<div>
							<div className="card-title">AI 리뷰 분석</div>
							<div className="card-caption">
								{data?.summary.insight_summary || '리뷰가 수집되면 위험 카테고리와 강점 카테고리를 자동 요약합니다.'}
							</div>
						</div>
						<div className="review-analysis-chip-group">
							<span className="review-analysis-chip">
								강점{' '}
								<ReviewCategoryTooltip category={data?.summary.top_positive_category} labelPrefix="강점 카테고리 설명 보기" tone="positive" />
							</span>
							<span className="review-analysis-chip review-analysis-chip-negative">
								위험{' '}
								<ReviewCategoryTooltip category={data?.summary.high_risk_category} labelPrefix="위험 카테고리 설명 보기" tone="negative" />
							</span>
						</div>
					</div>
					<div className="review-analysis-stat-grid review-analysis-stat-grid-3">
						<div className="review-analysis-stat">
							<div className="review-analysis-stat-label">최신 누적 리뷰 수</div>
							<div className="review-analysis-stat-value">{formatNumber(data?.summary.latest_review_count ?? 0)}건</div>
						</div>
						<div className="review-analysis-stat">
							<div className="review-analysis-stat-label">직전 누적 리뷰 수</div>
							<div className="review-analysis-stat-value">{formatNumber(data?.summary.previous_review_count ?? 0)}건</div>
						</div>
						<div className="review-analysis-stat">
							<div className="review-analysis-stat-label">평점 변화</div>
							<div className="review-analysis-stat-value">{formatSignedReviewNumber(data?.summary.rating_delta ?? 0)}점</div>
						</div>
					</div>
					<div className="review-analysis-source-meta">
						원문 {formatNumber(data?.source_info.raw_review_count ?? 0)}건 · 스냅샷 {formatNumber(data?.source_info.daily_snapshot_count ?? 0)}건 · 상품 {formatNumber(data?.source_info.product_count ?? 0)}개 · 최근 리뷰 {data?.source_info.last_review_date || '-'}
					</div>
				</article>

				<article className="card review-analysis-card">
					<div className="card-title">평점 분포</div>
					<div className="review-analysis-rating-grid">
						{['5', '4', '3', '2', '1'].map((score) => (
							<div key={score} className="review-analysis-rating-row">
								<div className="review-analysis-rating-score">{score}점</div>
								<div className="review-analysis-rating-bar">
									<div
										className="review-analysis-rating-fill"
										style={{ width: `${Math.min(100, Number(data?.rating_distribution.ratios?.[score] || 0))}%` }}
									/>
								</div>
								<div className="review-analysis-rating-meta">
									{formatNumber(data?.rating_distribution.counts?.[score] || 0)}건 / {formatNumber(data?.rating_distribution.ratios?.[score] || 0, 1)}%
								</div>
							</div>
						))}
					</div>
					<div className="review-analysis-download-actions">
						<button type="button" className="btn-ghost" onClick={handleDownloadAll} disabled={!data}>
							전체 분석 다운로드
						</button>
						<button type="button" className="btn-ghost" onClick={() => handleDownloadExamples('positive')} disabled={!data}>
							긍정 근거 다운로드
						</button>
						<button type="button" className="btn-ghost" onClick={() => handleDownloadExamples('negative')} disabled={!data}>
							부정 근거 다운로드
						</button>
					</div>
				</article>
			</section>

			<section className="card review-analysis-card">
				<div className="review-analysis-section-header">
					<div>
						<div className="card-title">상품별 비교</div>
						<div className="card-caption">어떤 상품이 평점/긍정률/리스크 측면에서 차이를 보이는지 비교하고, 클릭 시 해당 상품으로 바로 드릴다운합니다.</div>
					</div>
				</div>
				<div className="review-analysis-summary-table-wrap review-analysis-mini-table-wrap">
					<table className="review-analysis-summary-table review-analysis-mini-table">
						<thead>
							<tr>
								<th>상품</th>
								<th>리뷰 수</th>
								<th>평균 평점</th>
								<th>긍정</th>
								<th>부정</th>
							</tr>
						</thead>
						<tbody>
							{productOverviewItems.length ? (
								productOverviewItems.map((item) => (
									<tr
										key={`product-${item.product_url}`}
										className={canonicalizeReviewProductUrl(selectedProductUrl) === canonicalizeReviewProductUrl(item.product_url) ? 'review-analysis-table-row-active' : undefined}
									>
										<td>
											<button
												type="button"
												className="review-analysis-link-button"
												onClick={() => {
													setSelectedProductUrl(item.product_url);
													setShowAllCategories(false);
												}}
											>
												{item.product_title || item.product_url}
											</button>
										</td>
										<td>{formatNumber(item.review_count)}</td>
										<td>{formatNumber(item.average_rating, 2)}</td>
										<td>{formatNumber(item.positive_ratio, 1)}%</td>
										<td>{formatNumber(item.negative_ratio, 1)}%</td>
									</tr>
								))
							) : (
								<tr>
									<td colSpan={5}>비교할 상품 데이터가 없습니다.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>

			<section className="card review-analysis-card">
				<div className="card-title">종합 분석</div>
				<div className="review-analysis-overview-callout">
					{data?.summary.insight_summary || '아직 종합 분석 요약이 없습니다.'}
				</div>
				<div className="review-analysis-summary-table-wrap review-analysis-overview-summary-table-wrap">
					<table className="review-analysis-summary-table review-analysis-overview-summary-table">
						<thead>
							<tr>
								<th>분류</th>
								<th>핵심 요약</th>
								<th>긍정 포인트</th>
								<th>위험 신호</th>
								<th>활용 대상</th>
							</tr>
						</thead>
						<tbody>
							{categorySummaryRows.length ? (
								categorySummaryRows.map((row) => (
									<tr key={`summary-${row.category}`}>
										<td className="review-analysis-overview-summary-category-cell">
											<ReviewCategoryTooltip category={row.category} labelPrefix="종합 분석 카테고리 설명 보기" />
										</td>
										<td>{row.headline}</td>
										<td>{row.value}</td>
										<td>{row.concern}</td>
										<td>{row.target}</td>
									</tr>
								))
							) : (
								<tr>
									<td colSpan={5}>집계된 종합 분석 데이터가 없습니다.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>

			<section className="card review-analysis-card">
				<div className="review-analysis-section-header">
					<div>
						<div className="card-title">리뷰 추이</div>
						<div className="card-caption">기간별 리뷰 볼륨과 저평점 위험도를 한 줄에서 비교해 흐름 변화를 빠르게 읽을 수 있습니다.</div>
					</div>
				</div>
					<div className="review-analysis-trend-grid">
						{data?.trend?.length ? (
							<>
								<TrendChart
									title="리뷰 수 추이"
									tagLabel="일별 볼륨"
									xAxisLabel="X축 날짜"
									yAxisLabel="Y축 리뷰 건수"
									points={data.trend}
									valueKey="review_count"
									stroke="#60a5fa"
									labelFormatter={(point) => `${formatNumber(point.review_count)}건`}
									yAxisFormatter={(value) => `${formatNumber(value)}건`}
								/>
								<TrendChart
									title="저평점 위험 추이"
									tagLabel="위험 감지"
									xAxisLabel="X축 날짜"
									yAxisLabel="Y축 저평점 비율"
									points={data.trend}
									valueKey="low_rating_ratio"
									stroke="#f87171"
									labelFormatter={(point) => `${formatNumber(point.low_rating_ratio, 1)}%`}
									yAxisFormatter={(value) => `${formatNumber(value, 1)}%`}
								/>
							</>
						) : (
							<div className="review-analysis-empty">선택 기간에 집계할 리뷰 추이가 없습니다.</div>
						)}
					</div>
			</section>

			<section className="card review-analysis-card">
				<div className="review-analysis-section-header">
					<div>
						<div className="card-title">키워드 인사이트</div>
						<div className="card-caption">상위, 증가, 위험 키워드를 분리해 긍정/부정 반응 강도를 막대로 비교합니다.</div>
					</div>
				</div>
				<div className="review-analysis-keyword-grid">
					<KeywordList
						title="상위 키워드"
						description="가장 많이 언급된 키워드입니다."
						items={data?.keyword_insights.top_keywords || []}
						emptyText="상위 키워드가 없습니다."
					/>
					<KeywordList
						title="증가 키워드"
						description="후반부에 언급량이 증가한 키워드입니다."
						items={data?.keyword_insights.rising_keywords || []}
						emptyText="증가 키워드가 없습니다."
					/>
					<KeywordList
						title="위험 키워드"
						description="부정 리뷰에 반복적으로 연결된 키워드입니다."
						items={data?.keyword_insights.risk_keywords || []}
						emptyText="위험 키워드가 없습니다."
					/>
				</div>
			</section>

			<section className="card review-analysis-card">
				<div className="review-analysis-section-header">
					<div>
						<div className="card-title">카테고리 심층 분석</div>
						<div className="card-caption">사용성, 효과, 향, 배송, 가격/가성비, 포장 등 다양한 측면에서 리뷰를 분해해 봅니다.</div>
					</div>
				</div>
				<div className="review-analysis-summary-table-wrap review-analysis-mini-table-wrap">
					<table className="review-analysis-summary-table review-analysis-mini-table">
						<thead>
							<tr>
								<th>카테고리</th>
								<th>평점</th>
								<th>언급</th>
								<th>긍정</th>
								<th>부정</th>
							</tr>
						</thead>
						<tbody>
							{(data?.category_overview || []).map((item) => (
								<tr key={`mini-${item.category}`}>
									<td>
										<ReviewCategoryTooltip category={item.category} labelPrefix="심층 분석 카테고리 설명 보기" />
									</td>
									<td>{formatNumber(item.average_rating, 2)}</td>
									<td>{formatNumber(item.mention_count)}</td>
									<td>{formatNumber(item.positive_ratio, 1)}%</td>
									<td>{formatNumber(item.negative_ratio, 1)}%</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="review-analysis-category-grid">
					{visibleCategories.length ? (
						visibleCategories.map((item) => (
							<article key={item.category} className="review-analysis-category-card">
								<div className="review-analysis-category-title">
									<ReviewCategoryTooltip category={item.category} labelPrefix="카테고리 설명 보기" />
								</div>
								<div className="review-analysis-category-headline">{item.headline}</div>
								<div className="review-analysis-sentiment-panels">
									<div className="review-analysis-sentiment-panel review-analysis-sentiment-positive">
										<div className="review-analysis-sentiment-title">긍정적 평가</div>
										<div className="review-analysis-example-list">
											{item.positive_examples.length ? item.positive_examples.map((example) => (
												<button
													key={`${item.category}-pos-${example.review_key || example.review_text}`}
													type="button"
													className="review-analysis-example-button"
													onClick={() => setEvidenceModal({ category: item.category, sentiment: 'positive', evidence: example })}
												>
													{trimEvidenceText(example.review_text)}
												</button>
											)) : <div className="review-analysis-empty">긍정 근거가 없습니다.</div>}
										</div>
									</div>
									<div className="review-analysis-sentiment-panel review-analysis-sentiment-negative">
										<div className="review-analysis-sentiment-title">부정적 평가</div>
										<div className="review-analysis-example-list">
											{item.negative_examples.length ? item.negative_examples.map((example) => (
												<button
													key={`${item.category}-neg-${example.review_key || example.review_text}`}
													type="button"
													className="review-analysis-example-button"
													onClick={() => setEvidenceModal({ category: item.category, sentiment: 'negative', evidence: example })}
												>
													{trimEvidenceText(example.review_text)}
												</button>
											)) : <div className="review-analysis-empty">부정 근거가 없습니다.</div>}
										</div>
									</div>
								</div>
								<div className="review-analysis-bullets">
									<div>{item.value_summary}</div>
									<div>{item.concern_summary}</div>
									<div>{item.target_summary}</div>
								</div>
								<div className="review-analysis-chip-group">
									{item.top_keywords.map((keyword) => (
										<span key={`${item.category}-${keyword}`} className="review-analysis-chip">{keyword}</span>
									))}
								</div>
								<div className="review-analysis-category-metrics">
									<div className="review-analysis-category-metric">
										<span>평점</span>
										<strong>{formatNumber(item.average_rating, 2)}</strong>
									</div>
									<div className="review-analysis-category-metric">
										<span>언급</span>
										<strong>{formatNumber(item.mention_count)}({formatNumber((item.mention_count / Math.max(1, totalReviewCount)) * 100, 1)}%)</strong>
									</div>
									<div className="review-analysis-category-metric">
										<span>긍정</span>
										<strong>{formatNumber(item.positive_ratio, 1)}%</strong>
									</div>
									<div className="review-analysis-category-metric">
										<span>부정</span>
										<strong>{formatNumber(item.negative_ratio, 1)}%</strong>
									</div>
								</div>
							</article>
						))
					) : (
						<div className="review-analysis-empty">분석할 카테고리 데이터가 없습니다. 리뷰 원문을 수집하면 자동으로 채워집니다.</div>
					)}
				</div>
				{(data?.category_overview || []).length > 4 ? (
					<div className="review-analysis-more-actions">
						<button type="button" className="btn-ghost" onClick={() => setShowAllCategories((prev) => !prev)}>
							{showAllCategories ? '카테고리 접기' : '카테고리 더 보기'}
						</button>
					</div>
				) : null}
			</section>

			<section className="review-analysis-grid review-analysis-grid-wide">
				<article className="card review-analysis-card">
					<div className="card-title">실행 제안</div>
					<div className="review-analysis-action-list">
						{data?.action_items?.length ? (
							data.action_items.map((item) => (
								<div key={item.title} className="review-analysis-action-row">
									<div>
										<div className="review-analysis-action-title">{item.title}</div>
										<div className="review-analysis-action-detail">{item.detail}</div>
									</div>
									<PriorityBadge priority={item.priority} />
								</div>
							))
						) : (
							<div className="review-analysis-empty">실행 제안이 없습니다.</div>
						)}
					</div>
				</article>

				<article className="card review-analysis-card">
					<div className="card-title">운영 연결 포인트</div>
					<div className="review-analysis-bullets">
						<div>위험 카테고리를 `리뷰 관리` 초안 작성 우선순위와 연결해 답글 품질을 높입니다.</div>
						<div>상위 긍정 카테고리를 광고 소재, 상세페이지, FAQ 후보 문구로 재활용합니다.</div>
						<div>위험 키워드는 반복 클레임 관점으로 묶어 구조적 개선 항목으로 전환합니다.</div>
					</div>
				</article>
			</section>
			{evidenceModal ? (
				<div className="review-modal-backdrop" onClick={() => setEvidenceModal(null)}>
					<div className="review-modal-card review-analysis-evidence-modal" onClick={(event) => event.stopPropagation()}>
						<div className="review-analysis-section-header">
							<div>
								<div className="card-title">근거 리뷰 상세</div>
								<div className="card-caption">
									{evidenceModal.category} · {evidenceModal.sentiment === 'positive' ? '긍정적 평가' : '부정적 평가'}
								</div>
							</div>
							<button type="button" className="btn-ghost" onClick={() => setEvidenceModal(null)}>
								닫기
							</button>
						</div>
						<div className="review-analysis-chip-group">
							<span className="review-analysis-chip">{evidenceModal.evidence.product_title || '상품 정보 없음'}</span>
							<span className="review-analysis-chip">작성일 {formatDateTextOrDash(evidenceModal.evidence.review_written_at)}</span>
							<span className="review-analysis-chip">평점 {evidenceModal.evidence.rating == null ? '-' : formatNumber(evidenceModal.evidence.rating, 1)}</span>
							{evidenceModal.evidence.product_url ? (
								<button type="button" className="btn-ghost" onClick={focusEvidenceProductAnalysis}>
									이 상품으로 분석
								</button>
							) : null}
							{evidenceModal.evidence.product_url ? (
								<button type="button" className="btn-ghost" onClick={openEvidenceProductDetail}>
									상품 상세 열기
								</button>
							) : null}
						</div>
						<div className="review-analysis-evidence-text">{evidenceModal.evidence.review_text}</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
