import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { createPortal } from 'react-dom';
import { fetchKeywordDaily, fetchSearchwordDailyAll, type KeywordDailyRow, type SearchwordDailyRow } from '../ads/adsApi';
import { fetchPurchaseKeywordsDaily, type PurchaseKeywordRow } from '../purchase/purchaseApi';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildRankChartData, buildRankMatrixData, formatKstDateKey, type RankHistory } from './rankUtils';
import { parseRankExcelFile, buildKeywordMeta, buildRankUploadItems } from './rankExcel';
import { parseKeywordVolumeExcelFile } from './keywordVolumeExcel';

type KeywordVolumeItem = { keyword: string; monthly_search_volume: number | null; monthly_search_volume_label?: string | null };

type ManualKeywordMetaItem = { keyword: string; monthly_search_volume: number | null; monthly_search_volume_label?: string | null };

type AutoTrackedKeywordRow = {
	product_url: string;
	keyword: string;
	group_type: 'core' | 'watch' | string;
	is_active: boolean;
};

type ProductSalesManualResponse = {
	product_url: string;
	expected_sales_7d?: number | null;
	expected_revenue_7d_manwon?: number | null;
	recent_purchase_1w_count?: number | null;
	recent_repurchase_3m_count?: number | null;
	updated_at?: string | null;
};

export type RankTrackingDetailPeriod = '7d' | '30d' | '3m' | '6m' | '1y';

const KEYWORD_CLASSIFY_DAYS = 30;

type AdGrade = '매우우수' | '우수' | '보통' | '낮음' | '판단 보류';

type AdsTermDailyRow = {
	date: string;
	term: string;
	campaignName?: string | null;
	adgroupName?: string | null;
	conversions: number;
	clicks: number;
	cvr: number;
};
type AdKeywordMetrics = {
	conversions: number;
	clicks: number;
	conversionRate: number | null;
	conversionDays: number;
	contributionRate: number | null;
};
type TrackingMode = 'initial' | 'focus';
type KeywordPurchaseClassify = {
	keyword: string;
	purchaseScore: number | null;
	grade: 'MAIN' | 'SUB';
};

const normalizeName = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

const isSameProductName = (a: string, b: string): boolean => {
	const aa = normalizeName(a);
	const bb = normalizeName(b);
	if (!aa || !bb) return false;
	return aa === bb;
};

const scoreLabel = (score: number | null): string => {
	if (score == null || !Number.isFinite(score)) return '-';
	return `${score.toFixed(1)}%`;
};

type AdGradeRule = {
	grade: AdGrade;
	icon: string;
	color: string;
	bg: string;
	border: string;
	condition: string;
	note?: string;
};

const AD_GRADE_RULES: AdGradeRule[] = [
	{
		grade: '매우우수',
		icon: '🔥',
		color: '#ffffff',
		bg: '#7f1d1d',
		border: '#f97316',
		condition: '전환수 5건 이상 또는 전환수 2건 이상이면서 전체 광고 전환의 10% 이상',
		note: '즉시 예산/소재/랜딩 검토 우선순위로 볼 수 있는 핵심 후보입니다.',
	},
	{
		grade: '우수',
		icon: '👍',
		color: '#ffffff',
		bg: '#16a34a',
		border: '#22c55e',
		condition: '전환수 2건 이상 또는 전환수 1건이면서 전체 광고 전환의 3% 이상',
		note: '성과 유지 여부를 보면서 MAIN 확장 후보로 검토할 수 있습니다.',
	},
	{
		grade: '보통',
		icon: '●',
		color: '#111827',
		bg: '#facc15',
		border: '#fbbf24',
		condition: '전환수 1건이면서 전체 광고 전환의 1% 이상',
		note: '성과 신호는 있으나, 추가 데이터 확인이 더 필요한 단계입니다.',
	},
	{
		grade: '낮음',
		icon: '○',
		color: '#e5e7eb',
		bg: '#0f172a',
		border: '#475569',
		condition: '전환수 1건이지만 전체 광고 전환 비중이 1% 미만',
		note: '일회성 전환일 수 있어 과대평가하지 않도록 주의가 필요합니다.',
	},
	{
		grade: '판단 보류',
		icon: '⏸',
		color: '#6b7280',
		bg: '#1f2937',
		border: '#374151',
		condition: '최근 30일 기준 전환수 0건이거나 전체 광고 전환 집계가 없음',
		note: '전환 데이터가 쌓이기 전까지는 등급 산정 대상에서 제외됩니다.',
	},
];

const AD_GRADE_RULE_MAP = new Map<AdGrade, AdGradeRule>(AD_GRADE_RULES.map((rule) => [rule.grade, rule]));

const getAdGrade = (conversions: number, contribution: number): AdGrade => {
	if (conversions <= 0) return '판단 보류';
	if (conversions >= 5 || (conversions >= 2 && contribution >= 10)) return '매우우수';
	if (conversions >= 2 || (conversions === 1 && contribution >= 3)) return '우수';
	if (conversions === 1 && contribution >= 1) return '보통';
	if (conversions === 1 && contribution < 1) return '낮음';
	return '판단 보류';
};

const getAdGradeRule = (grade: AdGrade): AdGradeRule => AD_GRADE_RULE_MAP.get(grade) ?? AD_GRADE_RULES[AD_GRADE_RULES.length - 1]!;

const formatPercentLabel = (value: number | null | undefined): string => {
	if (value == null || !Number.isFinite(value)) return '-';
	return `${value.toFixed(2)}%`;
};

const formatCountLabel = (value: number | null | undefined, suffix: string): string => {
	if (value == null || !Number.isFinite(value) || value <= 0) return '-';
	return `${value.toLocaleString()}${suffix}`;
};

type PopoverLayoutInput = {
	anchorRect: Pick<DOMRect, 'top' | 'left' | 'bottom' | 'width'>;
	viewportWidth: number;
	viewportHeight: number;
	popoverWidth: number;
	popoverHeight: number;
};

export const calcAdGradePopoverLayout = ({
	anchorRect,
	viewportWidth,
	viewportHeight,
	popoverWidth,
	popoverHeight,
}: PopoverLayoutInput): React.CSSProperties & { maxHeight: number; dataPlacement: 'top' | 'bottom' } => {
	const gap = 8;
	const safe = 12;
	const preferredWidth = viewportWidth >= 1200 ? 380 : viewportWidth >= 900 ? 360 : viewportWidth >= 700 ? 320 : viewportWidth - safe * 2;
	const width = Math.min(
		Math.max(Math.min(popoverWidth, preferredWidth), Math.min(260, Math.max(220, viewportWidth - safe * 2))),
		Math.max(220, viewportWidth - safe * 2),
	);
	const left = Math.min(
		Math.max(anchorRect.left + anchorRect.width / 2 - width / 2, safe),
		Math.max(safe, viewportWidth - width - safe),
	);
	const availableBelow = Math.max(120, viewportHeight - anchorRect.bottom - gap - safe);
	const availableAbove = Math.max(120, anchorRect.top - gap - safe);
	const preferTop = availableBelow < popoverHeight && availableAbove > availableBelow;
	const dataPlacement: 'top' | 'bottom' = preferTop ? 'top' : 'bottom';
	const sideSpace = dataPlacement === 'top' ? availableAbove : availableBelow;
	const heightCap = viewportWidth >= 900 ? 440 : viewportWidth >= 700 ? 400 : 340;
	const maxHeight = Math.max(120, Math.min(popoverHeight, sideSpace, heightCap));
	const top = dataPlacement === 'top'
		? Math.max(safe, anchorRect.top - Math.min(popoverHeight, maxHeight) - gap)
		: Math.min(anchorRect.bottom + gap, Math.max(safe, viewportHeight - Math.min(popoverHeight, maxHeight) - safe));

	return {
		position: 'fixed',
		top,
		left,
		width,
		maxHeight,
		overflowY: 'auto',
		dataPlacement,
	};
};

const AdGradeBadge: React.FC<{ grade: AdGrade; metrics?: AdKeywordMetrics | undefined }> = ({ grade, metrics }) => {
	const [open, setOpen] = useState(false);
	const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
	const anchorRef = useRef<HTMLSpanElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const closeTimerRef = useRef<number | null>(null);
	const meta = getAdGradeRule(grade);

	const clearCloseTimer = () => {
		if (closeTimerRef.current != null && typeof window !== 'undefined') {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	};

	const openPopover = () => {
		clearCloseTimer();
		setOpen(true);
	};

	const closePopoverSoon = () => {
		if (typeof window === 'undefined') {
			setOpen(false);
			return;
		}
		clearCloseTimer();
		closeTimerRef.current = window.setTimeout(() => {
			setOpen(false);
			closeTimerRef.current = null;
		}, 120);
	};

	const closePopoverNow = () => {
		clearCloseTimer();
		setOpen(false);
	};

	useLayoutEffect(() => {
		if (!open || typeof window === 'undefined') return;

		const updatePosition = () => {
			const anchor = anchorRef.current;
			const popover = popoverRef.current;
			if (!anchor || !popover) return;
			const rect = anchor.getBoundingClientRect();
			const layout = calcAdGradePopoverLayout({
				anchorRect: rect,
				viewportWidth: window.innerWidth || 1280,
				viewportHeight: window.innerHeight || 720,
				popoverWidth: popover.offsetWidth || 320,
				popoverHeight: popover.scrollHeight || popover.offsetHeight || 360,
			});
			const { dataPlacement, ...style } = layout;
			popover.dataset.placement = dataPlacement;
			setPopoverStyle(style);
		};

		updatePosition();
		window.addEventListener('resize', updatePosition);
		window.addEventListener('scroll', updatePosition, true);
		return () => {
			window.removeEventListener('resize', updatePosition);
			window.removeEventListener('scroll', updatePosition, true);
		};
	}, [open]);

	useEffect(() => () => clearCloseTimer(), []);

	return (
		<span
			ref={anchorRef}
			className="rank-detail-ad-grade-anchor"
			tabIndex={0}
			onMouseEnter={openPopover}
			onMouseLeave={closePopoverSoon}
			onFocus={openPopover}
			onBlur={closePopoverNow}
		>
			<span
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					minWidth: 70,
					padding: '2px 8px',
					borderRadius: 999,
					fontSize: 10,
					fontWeight: 900,
					color: meta.color,
					background: meta.bg,
					border: `1px solid ${meta.border}`,
				}}
			>
				<span style={{ marginRight: 4 }}>{meta.icon}</span>
				{grade}
			</span>

			{open && typeof document !== 'undefined'
				? createPortal(
					<div
						ref={popoverRef}
						role="tooltip"
						aria-label={`광고전환등급 기준 안내 ${grade}`}
						className="rank-detail-ad-grade-popover"
						style={popoverStyle}
						onMouseEnter={openPopover}
						onMouseLeave={closePopoverSoon}
					>
						<div className="rank-detail-ad-grade-popover-title">최근 30일 광고 전환 기준</div>
						<div className="rank-detail-ad-grade-popover-subtitle">현재 등급: {grade}</div>

						<div className="rank-detail-ad-grade-current">
							<div className="rank-detail-ad-grade-current-title">현재 키워드 기준</div>
							<div className="rank-detail-ad-grade-current-metric">광고 전환수 {metrics?.conversions?.toLocaleString() ?? 0}건</div>
							<div className="rank-detail-ad-grade-current-metric">광고 전환 비중 {formatPercentLabel(metrics?.contributionRate ?? null)}</div>
							<div className="rank-detail-ad-grade-current-metric">전환율 {formatPercentLabel(metrics?.conversionRate ?? null)}</div>
							<div className="rank-detail-ad-grade-current-metric">전환일수 {formatCountLabel(metrics?.conversionDays ?? null, '일')}</div>
						</div>

						<div className="rank-detail-ad-grade-rules">
							{AD_GRADE_RULES.map((rule) => {
								const selected = rule.grade === grade;
								return (
									<div key={rule.grade} className={`rank-detail-ad-grade-rule${selected ? ' is-active' : ''}`}>
										<div className="rank-detail-ad-grade-rule-head">
											<span
												className="rank-detail-ad-grade-rule-chip"
												style={{
													color: rule.color,
													background: rule.bg,
													borderColor: rule.border,
												}}
											>
												<span style={{ marginRight: 4 }}>{rule.icon}</span>
												{rule.grade}
											</span>
										</div>
										<div className="rank-detail-ad-grade-rule-condition">{rule.condition}</div>
										{rule.note ? <div className="rank-detail-ad-grade-rule-note">{rule.note}</div> : null}
									</div>
								);
							})}
						</div>
					</div>,
					document.body,
				)
				: null}
		</span>
	);
};

export type RankTrackingDetailProduct = {
	id: string;
	imageUrl?: string | null;
	name: string;
	sellerName?: string | null;
	categoryPath?: string | null;
	hashtags?: string[];
	price?: number | null;
	reviewCount?: number | null;
	rating?: number | null;
	// 오늘 페이지 메트릭(비공식 HTML 기반) 스냅샷 표시용
	pageMetrics?: {
		date: string | null;
		title: string | null;
		price: number | null;
		review_count: number | null;
		rating: number | null;
		wish_count?: number | null;
		registered_date?: string | null;
		recent_purchase_count?: number | null;
		recent_purchase_window?: string | null;
		recent_purchase_status?: string | null;
		recent_purchase_7d_count?: number | null;
		recent_repurchase_count?: number | null;
		recent_repurchase_window?: string | null;
		recent_repurchase_3m_count?: number | null;
		recent_badge_text?: string | null;
		http_status: number | null;
		error: string | null;
	} | null;
	pageMetricsPrev?: {
		date: string | null;
		price: number | null;
		review_count: number | null;
		rating: number | null;
		wish_count?: number | null;
		registered_date?: string | null;
	} | null;
};

export type RankTrackingAnalyticsSnapshot = {
	expectedSales7d: number | null;
	rating: number | null;
	totalReviews: number | null;
	reviewDelta: number | null;
	ratingBuckets: {
		score: 1 | 2 | 3 | 4 | 5;
		count: number;
	}[];
};

export type RankTrackingDetailViewProps = {
	apiBaseUrl: string;
	product: RankTrackingDetailProduct;
	history: RankHistory | null;
	manualHistory?: RankHistory | null;
	/**
	 * "등록된 추적 키워드" 전체 목록.
	 * - history.series는 "수집된 데이터가 존재하는 키워드"만 포함될 수 있어
	 *   등록은 되었지만 아직 데이터가 없는 키워드는 화면에서 누락될 수 있다.
	 * - 따라서 상세 화면의 키워드 칩 리스트는 trackedKeywords를 우선 사용한다.
	 */
	trackedKeywords?: Array<{ keyword: string; monthly_search_volume?: number | null }>;
	period: RankTrackingDetailPeriod;
	onPeriodChange: (period: RankTrackingDetailPeriod) => void;
	onBackToList: () => void;
	/** 수기 입력 키워드(데일리 표) 표시 기간(일). 기본 90일 */
	manualTableDays?: number;
	onManualTableDaysChange?: (days: number) => void;
	analytics?: RankTrackingAnalyticsSnapshot | null;
	onEditKeywords?: () => void;
	onRankDataChanged?: () => void;
	/** 오늘 수집 모달(상품 메트릭/키워드) 열기 */
	onOpenCollectModal?: () => void;
};

const DETAIL_PERIOD_OPTIONS: { value: RankTrackingDetailPeriod; label: string }[] = [
	{ value: '7d', label: '7일' },
	{ value: '30d', label: '30일' },
	{ value: '3m', label: '3개월' },
	{ value: '6m', label: '6개월' },
	{ value: '1y', label: '1년' },
];

export const RankTrackingDetailView: React.FC<RankTrackingDetailViewProps> = ({
	apiBaseUrl,
	product,
	history,
	manualHistory = null,
	trackedKeywords,
	period,
	onPeriodChange,
	onBackToList,
	manualTableDays,
	onManualTableDaysChange,
	analytics,
	onEditKeywords,
	onRankDataChanged,
	onOpenCollectModal,
}) => {
	const pm = product.pageMetrics ?? null;
	const pmPrev = product.pageMetricsPrev ?? null;
	// 가격은 API/메타데이터 소스가 기준(크롤링 값으로 덮어쓰지 않음)
	const displayPrice = product.price ?? pm?.price ?? null;
	const displayReviewCount = pm?.review_count ?? product.reviewCount ?? null;
	const displayRating = pm?.rating ?? product.rating ?? null;
	const displayWishCount = pm?.wish_count ?? null;
	const displayRegisteredDate = pm?.registered_date ? String(pm.registered_date).replace(/-/g, '.').trim() : null;
	// 가격 증감은 "페이지메트릭 가격"을 보여줄 때만 표시한다.
	// (메타 가격을 보여주는데 페이지메트릭이 오염/변동되면 +96,000 같은 혼동이 발생)
	const priceDelta =
		product.price == null && pm?.price != null && pmPrev?.price != null ? pm.price - pmPrev.price : null;
	const reviewDelta = pm?.review_count != null && pmPrev?.review_count != null ? pm.review_count - pmPrev.review_count : null;
	const ratingDelta = pm?.rating != null && pmPrev?.rating != null ? pm.rating - pmPrev.rating : null;

	const productUrl = useMemo(() => {
		// IMPORTANT:
		// - backend tracked_product_rank_daily는 product_url "문자열"을 PK로 사용한다.
		// - URL()로 재직렬화하면 인코딩/표기 차이로 문자열이 바뀌어
		//   저장 후 다시 조회가 안 되는 문제가 생길 수 있다.
		// - 따라서 원본(product.id=product_url)을 그대로 사용하되, hash만 제거한다.
		const raw = String(product.id ?? '').trim();
		return raw.replace(/#.*$/, '');
	}, [product.id]);

	// ---- 판매정보 수기 입력(상품별) ----
	const [manualSales, setManualSales] = useState<ProductSalesManualResponse | null>(null);
	const [manualSalesLoading, setManualSalesLoading] = useState(false);
	const [manualSalesError, setManualSalesError] = useState<string | null>(null);
	const [isManualSalesModalOpen, setIsManualSalesModalOpen] = useState(false);
	const [manualSalesForm, setManualSalesForm] = useState({
		expected_sales_7d: '',
		expected_revenue_7d_manwon: '',
		recent_purchase_1w_count: '',
		recent_repurchase_3m_count: '',
	});

	useEffect(() => {
		if (!productUrl) return;
		let cancelled = false;
		const load = async () => {
			setManualSalesLoading(true);
			setManualSalesError(null);
			try {
				const res = await axios.get<ProductSalesManualResponse>(`${apiBaseUrl}/search-rank/product-sales-manual`, {
					params: { product_url: productUrl },
				});
				if (cancelled) return;
				const data = res.data ?? null;
				setManualSales(data);
				setManualSalesForm({
					expected_sales_7d: data?.expected_sales_7d != null ? String(data.expected_sales_7d) : '',
					expected_revenue_7d_manwon:
						data?.expected_revenue_7d_manwon != null ? String(data.expected_revenue_7d_manwon) : '',
					recent_purchase_1w_count:
						data?.recent_purchase_1w_count != null ? String(data.recent_purchase_1w_count) : '',
					recent_repurchase_3m_count:
						data?.recent_repurchase_3m_count != null ? String(data.recent_repurchase_3m_count) : '',
				});
			} catch (e: any) {
				if (!cancelled) {
					console.error(e);
					setManualSales(null);
					setManualSalesError('수기 입력 값을 불러오지 못했습니다.');
				}
			} finally {
				if (!cancelled) setManualSalesLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, productUrl]);

	const parseWindowDays = (w: string | null | undefined): number | null => {
		const s = String(w || '').trim().toLowerCase();
		if (!s) return null;
		const m = s.match(/^(\d+)\s*d$/);
		if (m) return Number(m[1]);
		const m2 = s.match(/^(\d+)\s*m$/);
		if (m2) return Number(m2[1]) * 30;
		const m3 = s.match(/^(\d+)\s*y$/);
		if (m3) return Number(m3[1]) * 365;
		return null;
	};

	// ---- 4개 출력 항목 계산/선택 ----
	const estimateSales7d = useMemo((): number | null => {
		const direct = (pm as any)?.recent_purchase_7d_count;
		if (typeof direct === 'number' && direct >= 0) return direct;

		const c = (pm as any)?.recent_purchase_count;
		const w = (pm as any)?.recent_purchase_window;
		if (typeof c === 'number' && c >= 0) {
			const days = parseWindowDays(w);
			if (days && days > 0) return Math.max(0, Math.round((c * 7) / days));
		}

		const manual = manualSales?.expected_sales_7d;
		if (typeof manual === 'number' && manual >= 0) return manual;
		return null;
	}, [pm, manualSales, parseWindowDays]);

	const estimateRevenue7dManwon = useMemo((): number | null => {
		if (estimateSales7d != null && displayPrice != null) {
			const won = estimateSales7d * displayPrice;
			return Math.max(0, Math.round(won / 10000));
		}
		const manual = manualSales?.expected_revenue_7d_manwon;
		if (typeof manual === 'number' && manual >= 0) return manual;
		return null;
	}, [estimateSales7d, displayPrice, manualSales]);

	const recentPurchase1wCount = useMemo((): number | null => {
		const v = (pm as any)?.recent_purchase_7d_count;
		if (typeof v === 'number' && v >= 0) return v;
		const manual = manualSales?.recent_purchase_1w_count;
		if (typeof manual === 'number' && manual >= 0) return manual;
		return null;
	}, [pm, manualSales]);

	const recentRepurchase3mCount = useMemo((): number | null => {
		const v = (pm as any)?.recent_repurchase_3m_count;
		if (typeof v === 'number' && v >= 0) return v;
		const manual = manualSales?.recent_repurchase_3m_count;
		if (typeof manual === 'number' && manual >= 0) return manual;
		return null;
	}, [pm, manualSales]);

	const renderSigned = (v: number | null, opts?: { decimals?: number }) => {
		if (v == null || v === 0) return null;
		const sign = v > 0 ? '+' : '';
		const text = opts?.decimals != null ? `${sign}${v.toFixed(opts.decimals)}` : `${sign}${v.toLocaleString()}`;
		const color = v > 0 ? '#4ade80' : '#f97373';
		return (
			<span style={{ marginLeft: 6, fontSize: 11, color, fontWeight: 700 }}>
				({text})
			</span>
		);
	};

	// notify는 디버그/보조 기능 제거로 더 이상 사용하지 않음

	// ---- 공식 순위 엑셀 업로드(상세 페이지) ----
	const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
	const [excelUploadError, setExcelUploadError] = useState<string | null>(null);
	const [excelUploading, setExcelUploading] = useState(false);
	const [lastUploadInfo, setLastUploadInfo] = useState<{ filename: string; saved: number; added: number } | null>(null);

	const [manualSalesSaving, setManualSalesSaving] = useState(false);

	const parseIntOrNull = (input: string): number | null => {
		const s = String(input ?? '').trim();
		if (!s) return null;
		const n = Number(s);
		if (!Number.isFinite(n)) return null;
		return Math.max(0, Math.trunc(n));
	};

	const handleSaveManualSales = async (): Promise<void> => {
		if (!productUrl) return;
		setManualSalesSaving(true);
		setManualSalesError(null);
		try {
			const payload = {
				product_url: productUrl,
				expected_sales_7d: parseIntOrNull(manualSalesForm.expected_sales_7d),
				expected_revenue_7d_manwon: parseIntOrNull(manualSalesForm.expected_revenue_7d_manwon),
				recent_purchase_1w_count: parseIntOrNull(manualSalesForm.recent_purchase_1w_count),
				recent_repurchase_3m_count: parseIntOrNull(manualSalesForm.recent_repurchase_3m_count),
			};
			const res = await axios.put<ProductSalesManualResponse>(`${apiBaseUrl}/search-rank/product-sales-manual`, payload);
			setManualSales(res.data ?? null);
			setIsManualSalesModalOpen(false);
		} catch (e) {
			console.error(e);
			setManualSalesError('수기 입력 값을 저장하지 못했습니다.');
		} finally {
			setManualSalesSaving(false);
		}
	};

	const importToServer = async (file: File): Promise<void> => {
		const table = await parseRankExcelFile(file);
		const items = buildRankUploadItems(table, new Date());
		const keyword_meta = buildKeywordMeta(table);
		if (items.length === 0) throw new Error('엑셀에서 순위 데이터를 추출하지 못했습니다.');

		const res = await axios.post(`${apiBaseUrl}/search-rank/ranks/import`, {
			product_url: productUrl,
			items,
			keyword_meta,
		});
		return res.data as any;
	};

	const handleExcelFile = async (file: File | null): Promise<void> => {
		if (!file) return;
		setExcelUploading(true);
		setExcelUploadError(null);
		try {
			const res: any = await importToServer(file);
			setLastUploadInfo({
				filename: file.name || 'rank.xlsx',
				saved: Number(res?.saved ?? 0),
				added: Array.isArray(res?.added_keywords) ? res.added_keywords.length : 0,
			});
			setIsExcelModalOpen(false);
			onRankDataChanged?.();
		} catch (e: any) {
			const detail = e?.response?.data?.detail;
			const msg = typeof detail === 'string' ? detail : detail?.message;
			setExcelUploadError(String(msg || e?.message || '엑셀을 저장하는 중 오류가 발생했습니다.'));
		} finally {
			setExcelUploading(false);
		}
	};

	const initialKeywords = useMemo(() => {
		const fromTracked = (trackedKeywords || []).map((k) => String(k?.keyword || '').trim()).filter(Boolean);
		if (fromTracked.length > 0) return fromTracked;
		return history ? history.series.map((s) => s.keyword) : [];
	}, [history, trackedKeywords]);

	const keywordVolumeMap = useMemo(() => {
		const map = new Map<string, number>();
		for (const k of trackedKeywords || []) {
			const kw = String(k?.keyword || '').trim();
			const v = k?.monthly_search_volume;
			if (!kw) continue;
			if (v == null) continue;
			if (!Number.isFinite(Number(v))) continue;
			map.set(kw, Number(v));
		}
		return map;
	}, [trackedKeywords]);

	// ---- 수기 키워드(월검색량) + 데일리 표 선택 상태 ----
	const [manualSelectedKeywords, setManualSelectedKeywords] = useState<Set<string>>(() => new Set());
	const [manualKeywordQuery, setManualKeywordQuery] = useState<string>('');
	const [manualSort, setManualSort] = useState<{
		key: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today';
		dir: 'asc' | 'desc';
	}>(
		() => ({ key: 'keyword', dir: 'asc' }),
	);
	const [group1Sort, setGroup1Sort] = useState<{
		key: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today';
		dir: 'asc' | 'desc';
	}>(() => ({ key: 'keyword', dir: 'asc' }));
	const [group2Sort, setGroup2Sort] = useState<{
		key: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today';
		dir: 'asc' | 'desc';
	}>(() => ({ key: 'keyword', dir: 'asc' }));
	const [volumeLoading, setVolumeLoading] = useState(false);
	const [volumeMap, setVolumeMap] = useState<Map<string, number>>(new Map());
	const [volumeLabelMap, setVolumeLabelMap] = useState<Map<string, string>>(new Map());
	// 키워드 순위 수집은 OpenAPI 기반으로 리스트 화면(모달)에서만 수행한다.

	// ---- 수기 월검색량 입력/업로드(키워드 + 월검색량) ----
	const [manualVolumeText, setManualVolumeText] = useState<string>('');
	const [manualVolumeSaving, setManualVolumeSaving] = useState(false);
	const [manualVolumeError, setManualVolumeError] = useState<string | null>(null);
	const [manualVolumeSavedInfo, setManualVolumeSavedInfo] = useState<{ saved: number; total_active: number } | null>(null);
	const [manualKeywordMetaRows, setManualKeywordMetaRows] = useState<ManualKeywordMetaItem[]>([]);
	// 기본은 "append"(기존 키워드 유지 + 입력된 키워드만 업데이트)로 두고,
	// 사용자가 원할 때만 "replace"(전체 덮어쓰기)를 선택하게 한다.
	const [manualVolumeMode, setManualVolumeMode] = useState<'append' | 'replace'>('append');
	const trackingModeStorageKey = useMemo(() => {
		const pid = encodeURIComponent(String(product?.id || '').trim());
		return `analytics:rank:tracking_mode_v2::${pid}`;
	}, [product?.id]);
	const [trackingMode, setTrackingMode] = useState<TrackingMode>(() => {
		// 기본값은 기존 정책과 동일하게 focus
		try {
			const v = String(window.localStorage.getItem(trackingModeStorageKey) || '').trim().toLowerCase();
			if (v === 'initial' || v === 'focus') return v as TrackingMode;
		} catch {}
		return 'focus';
	});
	const [trackingModeSaveReady, setTrackingModeSaveReady] = useState(false);

	// 상품별 tracking mode 로드: 서버(DB) -> localStorage fallback
	useEffect(() => {
		let cancelled = false;
		setTrackingModeSaveReady(false);
		const load = async () => {
			const u = String(product?.id || '').trim();
			if (!u) return;
			try {
				const res = await axios.get(`${apiBaseUrl}/search-rank/tracking-mode`, { params: { product_url: u } });
				const mode = String(res?.data?.tracking_mode || '').trim().toLowerCase();
				if (cancelled) return;
				if (mode === 'initial' || mode === 'focus') {
					setTrackingMode(mode as TrackingMode);
					try { window.localStorage.setItem(trackingModeStorageKey, mode); } catch {}
				}
				setTrackingModeSaveReady(true);
			} catch {
				// 서버 값을 확인하지 못한 경우에는 화면 진입만으로 기본값을 저장하지 않는다.
			}
		};
		load();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, product?.id, trackingModeStorageKey]);

	// 상품별 저장: localStorage + 서버(DB) best-effort
	useEffect(() => {
		if (!trackingModeSaveReady) return;
		try { window.localStorage.setItem(trackingModeStorageKey, trackingMode); } catch {}
		const u = String(product?.id || '').trim();
		if (!u) return;
		try {
			const p: any = (axios as any).put?.(`${apiBaseUrl}/search-rank/tracking-mode`, { product_url: u, tracking_mode: trackingMode });
			if (p && typeof p.catch === 'function') p.catch(() => {});
		} catch {
			// ignore
		}
	}, [apiBaseUrl, product?.id, trackingMode, trackingModeStorageKey, trackingModeSaveReady]);

	// ---- 광고/구매 전환 기반 키워드 분류(최근 30일) ----
	const [adsTermDailyRows, setAdsTermDailyRows] = useState<AdsTermDailyRow[]>([]);
	const [purchaseDailyRows, setPurchaseDailyRows] = useState<PurchaseKeywordRow[]>([]);
	const [keywordClassifyLoading, setKeywordClassifyLoading] = useState(false);
	const [keywordClassifyError, setKeywordClassifyError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			const today = new Date();
			const DAY_MS = 24 * 60 * 60 * 1000;
			const from = formatKstDateKey(new Date(today.getTime() - (KEYWORD_CLASSIFY_DAYS - 1) * DAY_MS));
			const to = formatKstDateKey(today);
			setKeywordClassifyLoading(true);
			setKeywordClassifyError(null);
			try {
				const fetchAds = async (): Promise<AdsTermDailyRow[]> => {
					let searchwordRows: SearchwordDailyRow[] = [];
					let keywordRows: KeywordDailyRow[] = [];
					try {
						searchwordRows = await fetchSearchwordDailyAll({ baseUrl: apiBaseUrl, dateFrom: from, dateTo: to });
					} catch {
						searchwordRows = [];
					}
					try {
						keywordRows = await fetchKeywordDaily({ baseUrl: apiBaseUrl, dateFrom: from, dateTo: to, limit: 10000 });
					} catch {
						keywordRows = [];
					}
					const fromSearchwords = (searchwordRows || []).map((r) => ({
						date: String(r.date || '').trim(),
						term: String(r.searchword || '').trim(),
						campaignName: String((r as any)?.campaign_name ?? '').trim() || null,
						adgroupName: String((r as any)?.adgroup_name ?? '').trim() || null,
						conversions: Number(r.conversions) || 0,
						clicks: Number(r.clicks) || 0,
						cvr: Number(r.cvr) || 0,
					}));
					const fromKeywords = (keywordRows || []).map((r) => ({
						date: String(r.date || '').trim(),
						term: String(r.keyword || '').trim(),
						campaignName: String((r as any)?.campaign_name ?? '').trim() || null,
						adgroupName: String((r as any)?.adgroup_name ?? '').trim() || null,
						conversions: Number(r.conversions) || 0,
						clicks: Number(r.clicks) || 0,
						cvr: Number(r.cvr) || 0,
					}));
					return [...fromSearchwords, ...fromKeywords];
				};

				const [adsRows, purchaseRows] = await Promise.all([
					fetchAds(),
					fetchPurchaseKeywordsDaily({
						apiBaseUrl,
						from,
						to,
						limit: 5000,
						offset: 0,
					}),
				]);

				if (cancelled) return;
				setAdsTermDailyRows(adsRows || []);
				setPurchaseDailyRows(purchaseRows || []);
			} catch (e: any) {
				if (cancelled) return;
				const msg = String(e?.response?.data?.detail ?? e?.message ?? '키워드 분류 데이터를 불러오지 못했습니다.');
				setKeywordClassifyError(msg);
			} finally {
				if (!cancelled) setKeywordClassifyLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, product.name]);

	const parsedVolumeItems = useMemo<Array<{ keyword: string; monthly_search_volume: number | null }>>(() => {
		const s = String(manualVolumeText || '').trim();
		if (!s) return [];
		const parts = s.split(/[\t\r\n]+/g).map((x) => x.trim()).filter(Boolean);
		const out = new Map<string, number | null>();
		const re0 = /^(.+?)\s*[\/,]\s*([\d,]+)\s*$/; // "키워드 / 10,630"
		const re1 = /^(.+?)\s+([\d,]+)\s*$/; // "키워드 10630"
		for (const p of parts) {
			const m0 = re0.exec(p) || re1.exec(p);
			if (!m0) continue;
			const kw = String(m0[1] || '').trim();
			const v = Number(String(m0[2] || '').replace(/[^\d]/g, ''));
			if (!kw) continue;
			if (!Number.isFinite(v) || v < 0) continue;
			out.set(kw, v);
		}
		return Array.from(out.entries()).map(([keyword, monthly_search_volume]) => ({ keyword, monthly_search_volume }));
	}, [manualVolumeText]);

	const fetchVolumes = async (keywords: string[], options?: { persist?: boolean }): Promise<Map<string, number>> => {
		const ks = (keywords || []).map((k) => String(k || '').trim()).filter(Boolean);
		if (ks.length === 0) return new Map();
		setVolumeLoading(true);
		try {
			const res = await axios.post<KeywordVolumeItem[]>(`${apiBaseUrl}/search-rank/keyword-volumes`, { keywords: ks });
			const arr = Array.isArray(res.data) ? res.data : [];
			const m = new Map<string, number>();
			const lm = new Map<string, string>();
			const persistItems: Array<{ keyword: string; monthly_search_volume: number | null; monthly_search_volume_label: string | null }> = [];
			for (const it of arr) {
				const kw = String((it as any)?.keyword || '').trim();
				const rawLabel = (it as any)?.monthly_search_volume_label;
				const label = rawLabel != null ? String(rawLabel).trim() : '';
				const vAny = (it as any)?.monthly_search_volume;
				const vol = vAny == null ? null : Number(vAny);
				if (!kw) continue;
				if (label) lm.set(kw, label);
				const hasNumericVolume = vol != null && Number.isFinite(vol) && vol >= 0;
				const persistLabel = !hasNumericVolume && /^<\d+$/.test(label) ? label : null;
				if (hasNumericVolume) m.set(kw, vol);
				if (hasNumericVolume || persistLabel) {
					persistItems.push({
						keyword: kw,
						monthly_search_volume: hasNumericVolume ? vol : null,
						monthly_search_volume_label: persistLabel,
					});
				}
			}
			// 기존 조회 결과를 유지하면서 누적(추적/수기 모두 커버)
			setVolumeMap((prev) => {
				const next = new Map(prev);
				for (const [k, v] of m.entries()) next.set(k, v);
				return next;
			});
			setVolumeLabelMap((prev) => {
				const next = new Map(prev);
				for (const [k, v] of lm.entries()) next.set(k, v);
				return next;
			});
			if (options?.persist && productUrl && persistItems.length > 0) {
				const saveRes = await axios.post<{ saved: number; total_active: number }>(`${apiBaseUrl}/search-rank/manual-keywords/import`, {
					product_url: productUrl,
					mode: 'append',
					items: persistItems,
				});
				const saved = Number(saveRes?.data?.saved ?? 0);
				const totalActive = Number(saveRes?.data?.total_active ?? 0);
				setManualVolumeSavedInfo({ saved, total_active: totalActive });
				setManualKeywordMetaRows((prev) => {
					const next = new Map<string, ManualKeywordMetaItem>();
					for (const row of prev || []) {
						const kw = String((row as any)?.keyword || '').trim();
						if (!kw) continue;
						next.set(kw, {
							keyword: kw,
							monthly_search_volume: (row as any)?.monthly_search_volume ?? null,
							monthly_search_volume_label: (row as any)?.monthly_search_volume_label ?? null,
						});
					}
					for (const item of persistItems) {
						next.set(item.keyword, {
							keyword: item.keyword,
							monthly_search_volume: item.monthly_search_volume,
							monthly_search_volume_label: item.monthly_search_volume_label,
						});
					}
					return Array.from(next.values()).sort((a, b) => String(a.keyword).localeCompare(String(b.keyword)));
				});
			}
			return m;
		} catch (e: any) {
			// 실패해도 입력/저장은 가능해야 한다.
			try { console.error(e); } catch {}
			return new Map();
		} finally {
			setVolumeLoading(false);
		}
	};

	// 수기 데일리 표는 메뉴 이동/복귀 시에도 월검색량이 보여야 하므로,
	// manualHistory가 로드되면(=DB에 수기 키워드가 있음) 자동으로 월검색량을 재조회한다.
	useEffect(() => {
		const ks = (manualHistory?.series || []).map((s) => String(s.keyword || '').trim()).filter(Boolean);
		if (ks.length === 0) return;
		// 이미 volumeMap에 값이 들어있는 키워드는 재조회하지 않는다.
		const missing = ks.filter((k) => !volumeMap.has(k));
		if (missing.length === 0) return;
		// 너무 자주/많이 호출하지 않도록 상한
		void fetchVolumes(missing.slice(0, 200));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [manualHistory]);

	useEffect(() => {
		// 수기 키워드(월검색량) 메타를 서버에서 로드해 volumeMap에 반영(메뉴 이동/새로고침 후에도 유지)
		let cancelled = false;
		(async () => {
			try {
				const res = await axios.get<ManualKeywordMetaItem[]>(`${apiBaseUrl}/search-rank/manual-keywords`, {
					params: { product_url: productUrl },
				});
				if (cancelled) return;
				const arr = Array.isArray(res.data) ? res.data : [];
				setManualKeywordMetaRows(arr as any);
				const m = new Map<string, number>();
				const lm = new Map<string, string>();
				for (const it of arr) {
					const kw = String((it as any)?.keyword || '').trim();
					if (!kw) continue;
					const vAny = (it as any)?.monthly_search_volume;
					const vol = vAny == null ? null : Number(vAny);
					const rawLabel = (it as any)?.monthly_search_volume_label;
					const label = rawLabel != null ? String(rawLabel).trim() : '';
					if (label) lm.set(kw, label);
					if (vol != null && Number.isFinite(vol) && vol >= 0) m.set(kw, vol);
				}
				setVolumeMap((prev) => {
					const next = new Map(prev);
					for (const [k, v] of m.entries()) next.set(k, v);
					return next;
				});
				setVolumeLabelMap((prev) => {
					const next = new Map(prev);
					for (const [k, v] of lm.entries()) next.set(k, v);
					return next;
				});
			} catch (e) {
				// ignore
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, productUrl]);

	// 수기 키워드(월검색량) 목록이 갱신되면(업로드/삭제 등) 선택 상태는 초기화한다.
	useEffect(() => {
		setManualSelectedKeywords(new Set());
	}, [manualKeywordMetaRows, manualHistory]);

	// (삭제) Playwright 기반 카테고리 수집 UI/세션 오픈 UX는 더 이상 사용하지 않는다.

	const deleteSelectedManualKeywords = async (): Promise<void> => {
		const keywords = Array.from(manualSelectedKeywords.values()).map((k) => String(k || '').trim()).filter(Boolean);
		if (keywords.length === 0) return;
		let ok = true;
		try {
			ok = window.confirm(`선택한 키워드 ${keywords.length.toLocaleString()}개를 삭제할까요?\n(월검색량 목록에서 제거됩니다)`);
		} catch {
			ok = true;
		}
		if (!ok) return;
		try {
			const res = await axios.post<any>(`${apiBaseUrl}/search-rank/manual-keywords/delete-meta`, { product_url: productUrl, keywords });
			const deleted = Number(res?.data?.deleted ?? 0);
			// 서버에서 실제로 지워진 키워드를 기준으로 UI를 갱신한다.
			const deletedKeywords: string[] = Array.isArray(res?.data?.deleted_keywords) ? res.data.deleted_keywords : [];
			const notFound: string[] = Array.isArray(res?.data?.not_found_keywords) ? res.data.not_found_keywords : [];

			setManualSelectedKeywords(new Set());

			// (중요) 삭제 성공/실패를 "서버 재조회"로 확정한다.
			// - 자동 시드/URL 정규화/중복 데이터 등으로 인해, 로컬 필터만으로는 '삭제가 안 된다'로 보일 수 있다.
			try {
				const lst = await axios.get<ManualKeywordMetaItem[]>(`${apiBaseUrl}/search-rank/manual-keywords`, {
					params: { product_url: productUrl },
				});
				const arr = Array.isArray(lst.data) ? lst.data : [];
				setManualKeywordMetaRows(arr as any);
			} catch {
				// fallback: 로컬에서라도 제거
				setManualKeywordMetaRows((prev) => prev.filter((r) => !keywords.includes(String(r.keyword || '').trim())));
			}

			setVolumeMap((prev) => {
				const next = new Map(prev);
				for (const k of deletedKeywords.length > 0 ? deletedKeywords : keywords) next.delete(k);
				return next;
			});
			setVolumeLabelMap((prev) => {
				const next = new Map(prev);
				for (const k of deletedKeywords.length > 0 ? deletedKeywords : keywords) next.delete(k);
				return next;
			});

			if (deleted <= 0) {
				// UI 상으로는 "삭제 눌렀는데 그대로"가 가장 혼란스러우므로 즉시 알려준다.
				try {
					window.alert(`삭제된 키워드가 없습니다.\n- 요청: ${keywords.join(', ')}\n- 원인: 키워드 표기 차이(공백/대소문자) 또는 이미 비활성화된 항목일 수 있습니다.`);
				} catch {}
			} else if (notFound.length > 0) {
				try {
					window.alert(`일부 키워드를 찾지 못해 삭제되지 않았습니다.\n- 삭제됨: ${deletedKeywords.join(', ') || '(확인 불가)'}\n- 미삭제: ${notFound.join(', ')}`);
				} catch {}
			}

			onRankDataChanged?.();
		} catch (e) {
			try { console.error(e); } catch {}
		}
	};

	const saveManualKeywordVolumes = async (items: Array<{ keyword: string; monthly_search_volume: number | null }>): Promise<void> => {
		setManualVolumeError(null);
		setManualVolumeSavedInfo(null);
		if (manualVolumeSaving) return;
		if (!items || items.length === 0) {
			setManualVolumeError('키워드/월검색량을 입력하거나 엑셀을 업로드해 주세요.');
			return;
		}
		setManualVolumeSaving(true);
		try {
			const res = await axios.post<{ saved: number; total_active: number }>(`${apiBaseUrl}/search-rank/manual-keywords/import`, {
				product_url: productUrl,
				mode: manualVolumeMode,
				items: items.map((it) => ({ keyword: it.keyword, monthly_search_volume: it.monthly_search_volume })),
			});
			const data: any = res.data;
			setManualVolumeSavedInfo({ saved: Number(data?.saved ?? 0), total_active: Number(data?.total_active ?? 0) });
			setManualKeywordMetaRows((prev) => {
				// replace: 입력한 목록이 전체가 된다.
				if (manualVolumeMode === 'replace') {
					return items.map((it) => ({ keyword: it.keyword, monthly_search_volume: it.monthly_search_volume, monthly_search_volume_label: null }));
				}
				// append: 기존 유지 + 입력된 키워드만 덮어쓰기(upsert)
				const next = new Map<string, ManualKeywordMetaItem>();
				for (const r of prev || []) {
					const kw = String((r as any)?.keyword || '').trim();
					if (!kw) continue;
					next.set(kw, { keyword: kw, monthly_search_volume: (r as any)?.monthly_search_volume ?? null, monthly_search_volume_label: (r as any)?.monthly_search_volume_label ?? null });
				}
				for (const it of items) {
					const kw = String(it.keyword || '').trim();
					if (!kw) continue;
					next.set(kw, { keyword: kw, monthly_search_volume: it.monthly_search_volume, monthly_search_volume_label: null });
				}
				return Array.from(next.values()).sort((a, b) => String(a.keyword).localeCompare(String(b.keyword)));
			});
			// UI 즉시 반영(서버 저장값을 기다리지 않고 volumeMap 갱신)
			setVolumeMap((prev) => {
				const next = new Map(prev);
				for (const it of items) {
					if (it.monthly_search_volume == null) continue;
					next.set(it.keyword, it.monthly_search_volume);
				}
				return next;
			});
		} catch (e: any) {
			setManualVolumeError(String(e?.response?.data?.detail || e?.message || '저장 실패'));
		} finally {
			setManualVolumeSaving(false);
		}
	};

	const handleManualVolumeExcel = async (file: File | null): Promise<void> => {
		if (!file) return;
		setManualVolumeError(null);
		try {
			const items = await parseKeywordVolumeExcelFile(file);
			await saveManualKeywordVolumes(items);
		} catch (e: any) {
			setManualVolumeError(String(e?.message || '엑셀 파싱 실패'));
		}
	};

	// 수기 데일리 표는 "저장된 이력"이 길게 존재하는 경우가 많아,
	// 그래프 기간(7일 기본)과 별도로 표시 기간을 둔다.
	const MANUAL_DAYS_KEY = 'analytics:rank:manual_table_days_v1';
	const MANUAL_ROW_LIMIT_KEY = 'analytics:rank:manual_table_row_limit_v1';
	const [manualDaysLocal, setManualDaysLocal] = useState<number>(() => {
		if (typeof manualTableDays === 'number' && Number.isFinite(manualTableDays) && manualTableDays > 0) return manualTableDays;
		try {
			const v = Number(window.localStorage.getItem(MANUAL_DAYS_KEY) || '');
			if (Number.isFinite(v) && v > 0) return v;
		} catch {}
		return 90;
	});
	const manualDays = typeof manualTableDays === 'number' && Number.isFinite(manualTableDays) && manualTableDays > 0 ? manualTableDays : manualDaysLocal;
	useEffect(() => {
		// uncontrolled 모드일 때만 localStorage에 저장
		if (typeof manualTableDays === 'number') return;
		try { window.localStorage.setItem(MANUAL_DAYS_KEY, String(manualDaysLocal)); } catch {}
	}, [manualDaysLocal, manualTableDays]);

	// 수기 데일리 표의 행이 많으면(키워드 수 * 날짜 수) DOM 렌더링이 메인 스레드를 오래 점유한다.
	// 따라서 기본은 상위 N행만 렌더링하고, 사용자가 "전체"를 선택할 수 있게 한다.
	const [manualRowLimit, setManualRowLimit] = useState<number>(() => {
		try {
			const v = Number(window.localStorage.getItem(MANUAL_ROW_LIMIT_KEY) || '');
			if (Number.isFinite(v) && v >= 0) return v;
		} catch {}
		return 500;
	});
	useEffect(() => {
		try {
			window.localStorage.setItem(MANUAL_ROW_LIMIT_KEY, String(manualRowLimit));
		} catch {}
	}, [manualRowLimit]);

	const periodDays = useMemo(() => {
		switch (period) {
			case '7d':
				return 7;
			case '30d':
				return 30;
			case '3m':
				return 90;
			case '6m':
				return 180;
			case '1y':
				return 365;
			default:
				return 7;
		}
	}, [period]);

	const buildDatesDesc = (days: number): string[] => {
		const now = new Date();
		const out: string[] = [];
		const DAY_MS = 24 * 60 * 60 * 1000;
		for (let i = 0; i < days; i++) {
			out.push(formatKstDateKey(new Date(now.getTime() - i * DAY_MS)));
		}
		return out;
	};

	const manualKeywordsForDailyTable = useMemo(() => {
		const set = new Set<string>();
		for (const r of manualKeywordMetaRows || []) {
			const kw = String((r as any)?.keyword || '').trim();
			if (kw) set.add(kw);
		}
		for (const s of manualHistory?.series || []) {
			const kw = String((s as any)?.keyword || '').trim();
			if (kw) set.add(kw);
		}
		return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
	}, [manualKeywordMetaRows, manualHistory]);

	const manualDailyHistoryForTable = useMemo<RankHistory>(() => {
		const seriesMap = new Map<string, Array<{ date: string; rank: number }>>();
		for (const s of manualHistory?.series || []) {
			const kw = String((s as any)?.keyword || '').trim();
			if (!kw) continue;
			const pts = Array.isArray((s as any)?.series) ? (s as any).series : [];
			seriesMap.set(kw, pts);
		}
		return {
			dates: [],
			series: manualKeywordsForDailyTable.map((kw) => ({ keyword: kw, series: seriesMap.get(kw) ?? [] })),
		};
	}, [manualHistory, manualKeywordsForDailyTable]);

	const manualDailyMatrixRows = useMemo(
		() => buildRankMatrixData(manualDailyHistoryForTable, manualDays),
		[manualDailyHistoryForTable, manualDays],
	);

	const purchaseClassifyMap = useMemo(() => {
		const kwList = manualKeywordsForDailyTable.map((k) => String(k || '').trim()).filter(Boolean);
		const purchaseAgg = new Map<string, number>();
		let purchaseTotalConv = 0;
		const productName = String(product.name || '').trim();
		for (const row of purchaseDailyRows || []) {
			const pname = String(row.product_name || '').trim();
			if (productName && pname && !isSameProductName(pname, productName)) continue;
			const kw = String(row.keyword || '').trim();
			if (!kw) continue;
			const conv = Number(row.payments) || 0;
			purchaseTotalConv += conv;
			purchaseAgg.set(kw, (purchaseAgg.get(kw) ?? 0) + conv);
		}
		const scores = kwList
			.map((kw) => {
				const v = purchaseAgg.get(kw) ?? 0;
				const score = purchaseTotalConv > 0 ? (v / purchaseTotalConv) * 100 : 0;
				return { keyword: kw, score };
			})
			.filter((x) => x.score > 0)
			.sort((a, b) => b.score - a.score);
		const mainSet = (() => {
			if (scores.length === 0) return new Set<string>();
			const cnt = Math.max(1, Math.ceil(scores.length * 0.2));
			return new Set(scores.slice(0, cnt).map((x) => x.keyword));
		})();
		const out = new Map<string, KeywordPurchaseClassify>();
		for (const kw of kwList) {
			const v = purchaseAgg.get(kw) ?? 0;
			const score = purchaseTotalConv > 0 ? (v / purchaseTotalConv) * 100 : null;
			out.set(kw, { keyword: kw, purchaseScore: score, grade: mainSet.has(kw) ? 'MAIN' : 'SUB' });
		}
		return out;
	}, [manualKeywordsForDailyTable, purchaseDailyRows, product.name]);

	const adGradeMap = useMemo(() => {
		const kwList = manualKeywordsForDailyTable.map((k) => String(k || '').trim()).filter(Boolean);
		const adAgg = new Map<string, { conv: number }>();
		let totalConv = 0;
		for (const row of adsTermDailyRows || []) {
			const kw = String(row.term || '').trim();
			if (!kw) continue;
			const conv = Number(row.conversions) || 0;
			const cur = adAgg.get(kw) ?? { conv: 0 };
			cur.conv += conv;
			adAgg.set(kw, cur);
			totalConv += conv;
		}
		const out = new Map<string, AdGrade>();
		for (const kw of kwList) {
			const conv = adAgg.get(kw)?.conv ?? 0;
			if (conv <= 0 || totalConv <= 0) {
				out.set(kw, '판단 보류');
				continue;
			}
			const contribution = totalConv > 0 ? (conv / totalConv) * 100 : 0;
			out.set(kw, getAdGrade(conv, contribution));
		}
		return out;
	}, [manualKeywordsForDailyTable, adsTermDailyRows]);

	const adMetricsMap = useMemo(() => {
		const kwList = manualKeywordsForDailyTable.map((k) => String(k || '').trim()).filter(Boolean);
		const agg = new Map<string, { conv: number; clicks: number }>();
		for (const row of adsTermDailyRows || []) {
			const kw = String(row.term || '').trim();
			if (!kw) continue;
			const conv = Number(row.conversions) || 0;
			const clicks = Number(row.clicks) || 0;
			const cur = agg.get(kw) ?? { conv: 0, clicks: 0 };
			cur.conv += conv;
			cur.clicks += clicks;
			agg.set(kw, cur);
		}
		let totalConv = 0;
		for (const value of agg.values()) totalConv += value.conv;

		const purchaseDays = new Map<string, Set<string>>();
		const productName = String(product.name || '').trim();
		for (const row of purchaseDailyRows || []) {
			const pname = String(row.product_name || '').trim();
			if (productName && pname && !isSameProductName(pname, productName)) continue;
			const kw = String(row.keyword || '').trim();
			if (!kw) continue;
			const payments = Number(row.payments) || 0;
			if (!(payments > 0)) continue;
			const dateKey = String(row.date || '').trim();
			if (!dateKey) continue;
			const set = purchaseDays.get(kw) ?? new Set<string>();
			set.add(dateKey);
			purchaseDays.set(kw, set);
		}

		const out = new Map<string, AdKeywordMetrics>();
		for (const kw of kwList) {
			const cur = agg.get(kw);
			const conversions = cur?.conv ?? 0;
			const clicks = cur?.clicks ?? 0;
			const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : null;
			const conversionDays = purchaseDays.get(kw)?.size ?? 0;
			const contributionRate = totalConv > 0 && conversions > 0 ? (conversions / totalConv) * 100 : null;
			out.set(kw, { conversions, clicks, conversionRate, conversionDays, contributionRate });
		}
		return out;
	}, [manualKeywordsForDailyTable, adsTermDailyRows, purchaseDailyRows, product.name]);

	const purchaseKeywordSignals = useMemo(() => {
		const convMap = new Map<string, number>();
		const daysMap = new Map<string, Set<string>>();
		const productName = String(product.name || '').trim();
		for (const row of purchaseDailyRows || []) {
			const pname = String(row.product_name || '').trim();
			if (productName && pname && !isSameProductName(pname, productName)) continue;
			const kw = String(row.keyword || '').trim();
			if (!kw) continue;
			const payments = Number(row.payments) || 0;
			if (payments > 0) {
				convMap.set(kw, (convMap.get(kw) ?? 0) + payments);
				const dateKey = String(row.date || '').trim();
				if (dateKey) {
					const set = daysMap.get(kw) ?? new Set<string>();
					set.add(dateKey);
					daysMap.set(kw, set);
				}
			}
		}
		return { convMap, daysMap };
	}, [purchaseDailyRows, product.name]);

	const focusGroupKeywords = useMemo(() => {
		const base = manualKeywordsForDailyTable.map((k) => String(k || '').trim()).filter(Boolean);
		const scoreOf = (kw: string) => purchaseClassifyMap.get(kw)?.purchaseScore ?? -1;
		const sortByScore = (a: string, b: string) => {
			const av = scoreOf(a);
			const bv = scoreOf(b);
			if (av !== bv) return bv - av;
			return a.localeCompare(b, 'ko');
		};
		const group1 = base.filter((kw) => {
			const hasPurchase = (purchaseKeywordSignals.convMap.get(kw) ?? 0) > 0;
			return hasPurchase && purchaseClassifyMap.get(kw)?.grade === 'MAIN';
		});
		const group2 = base.filter((kw) => {
			const hasPurchase = (purchaseKeywordSignals.convMap.get(kw) ?? 0) > 0;
			if (!hasPurchase) return false;
			return purchaseClassifyMap.get(kw)?.grade === 'SUB';
		});
		return {
			group1: group1.sort(sortByScore),
			group2: group2.sort(sortByScore),
		};
	}, [manualKeywordsForDailyTable, purchaseClassifyMap, purchaseKeywordSignals]);

	const groupKeywords = useMemo(() => {
		if (trackingMode === 'initial') {
			const base = initialKeywords.map((k) => String(k || '').trim()).filter(Boolean);
			return { group1: base, group2: [] as string[] };
		}
		return focusGroupKeywords;
	}, [trackingMode, initialKeywords, focusGroupKeywords]);

	const allKeywords = useMemo(() => {
		if (trackingMode === 'initial') return initialKeywords;
		return Array.from(new Set([...(groupKeywords.group1 || []), ...(groupKeywords.group2 || [])]));
	}, [trackingMode, initialKeywords, groupKeywords]);

	// 중요: 화면 진입/데이터 로딩만으로 auto-tracked 그룹을 저장하지 않는다.
	// 저장된 core/watch는 조회해서 표시하고, 재분류/동기화는 명시적인 액션에서만 수행해야 한다.

	const [selectedKeywords, setSelectedKeywords] = useState<string[]>(() => []);

	// 그룹 1 키워드는 항상 그래프에 포함
	React.useEffect(() => {
		if (!allKeywords || allKeywords.length === 0) {
			setSelectedKeywords([]);
			return;
		}
		const base = groupKeywords.group1.length > 0 ? groupKeywords.group1 : allKeywords.slice(0, 5);
		setSelectedKeywords((prev) => {
			const prevExtras = prev.filter((k) => !groupKeywords.group1.includes(k));
			const merged = Array.from(new Set([...base, ...prevExtras])).filter((k) => allKeywords.includes(k));
			return merged;
		});
	}, [allKeywords, groupKeywords.group1]);

	// 차트 X축 날짜는 "기간 내 날짜"를 기준으로 고정한다(데이터가 없는 날짜도 표시).
	// - 표(매트릭스)에서 생성한 날짜를 그대로 재사용한다.
	const chartDatesDesc = useMemo(() => {
		return buildDatesDesc(periodDays);
	}, [periodDays]);

	const chartData = useMemo(
		() => buildRankChartData(history, selectedKeywords, chartDatesDesc),
		[history, selectedKeywords, chartDatesDesc],
	);

	// 그래프 Y축 최대 순위(가장 낮은 순위)를 계산하여 도메인에 반영
	const maxRank = useMemo(() => {
		if (chartData.length === 0) return 1;
		let max = 1;
		for (const row of chartData) {
			for (const [key, value] of Object.entries(row)) {
				if (key === 'date') continue;
				if (typeof value === 'number' && value > max) {
					max = value;
				}
			}
		}
		return max;
	}, [chartData]);

	const matrixRows = useMemo(
		() => buildRankMatrixData(history, periodDays),
		[history, periodDays],
	);
	const MATRIX_ROW_LIMIT_KEY = 'analytics:rank:matrix_row_limit_v1';
	const [matrixRowLimit, setMatrixRowLimit] = useState<number>(() => {
		try {
			const v = Number(window.localStorage.getItem(MATRIX_ROW_LIMIT_KEY) || '');
			if (Number.isFinite(v) && v >= 0) return v;
		} catch {}
		return 200;
	});
	useEffect(() => {
		try {
			window.localStorage.setItem(MATRIX_ROW_LIMIT_KEY, String(matrixRowLimit));
		} catch {}
	}, [matrixRowLimit]);

	const matrixRowsVisible = useMemo(() => {
		if (!matrixRowLimit || matrixRowLimit <= 0) return matrixRows;
		return matrixRows.slice(0, matrixRowLimit);
	}, [matrixRows, matrixRowLimit]);

	const displayDates = chartDatesDesc; // 표/그래프 날짜축과 동일(오늘 → 과거)
	const manualDisplayDates = useMemo(() => buildDatesDesc(manualDays), [manualDays]);
	const columnCount = displayDates.length;
	// 7일처럼 컬럼이 적을 때는 폭을 100%로 늘려 날짜가 한쪽으로 몰리지 않게 하고,
	// 30일 이상처럼 컬럼이 많을 때는 고정폭 + 가로 스크롤을 유지한다.
	const matrixCompact = columnCount > 10;

	const sortIndicator = (
		state: { key: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today'; dir: 'asc' | 'desc' },
		k: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today',
	) => {
		if (state.key !== k) return '↕';
		return state.dir === 'asc' ? '▲' : '▼';
	};

	const toggleSort = (
		setter: React.Dispatch<React.SetStateAction<{ key: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today'; dir: 'asc' | 'desc' }>>,
		k: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today',
	) => {
		setter((cur) => {
			if (cur.key === k) return { key: k, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
			return { key: k, dir: 'asc' };
		});
	};

	// 표 스크롤 동기화를 위한 ref (위쪽 스크롤바 + 실제 테이블 컨테이너)
	const headerScrollRef = React.useRef<HTMLDivElement | null>(null);
	const tableScrollRef = React.useRef<HTMLDivElement | null>(null);

	const syncScroll = (source: 'header' | 'table') => {
		const header = headerScrollRef.current;
		const table = tableScrollRef.current;
		if (!header || !table) return;
		if (source === 'header') {
			if (table.scrollLeft !== header.scrollLeft) {
				table.scrollLeft = header.scrollLeft;
			}
		} else {
			if (header.scrollLeft !== table.scrollLeft) {
				header.scrollLeft = table.scrollLeft;
			}
		}
	};

	// 키워드별 최신 순위/변동 요약 (상단 칩에서 사용)
	const keywordSummaries = useMemo(() => {
		const map = new Map<string, { rank: number | null; delta: number | null }>();
		if (!history) return map;

		for (const s of history.series) {
			const sorted = [...s.series].sort((a, b) => a.date.localeCompare(b.date));
			if (sorted.length === 0) {
				map.set(s.keyword, { rank: null, delta: null });
				continue;
			}
			const latest = sorted[sorted.length - 1]!;
			const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
			const delta = prev ? prev.rank - latest.rank : null;
			map.set(s.keyword, { rank: latest.rank, delta });
		}
		return map;
	}, [history]);

	const handleToggleKeyword = (keyword: string) => {
		if (trackingMode === 'focus' && groupKeywords.group1.includes(keyword)) return;
		setSelectedKeywords((prev) => {
			const exists = prev.includes(keyword);
			if (exists) return prev.filter((k) => k !== keyword);
			return [...prev, keyword];
		});
	};

	const renderDelta = (delta: number | null) => {
		if (delta === null || delta === 0) return <span className="text-xs text-slate-400">-</span>;
		if (delta > 0) {
			return (
				<span style={{ fontSize: 11, color: '#4ade80', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
					<span>▲</span>
					<span>{delta}</span>
				</span>
			);
		}
		return (
			<span style={{ fontSize: 11, color: '#f97373', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
				<span>▼</span>
				<span>{Math.abs(delta)}</span>
			</span>
		);
	};

	const renderRankCellValue = (rank: number | null, status?: string | null) => {
		if (typeof rank !== 'number' || !Number.isFinite(rank)) return <span>-</span>;
		if (rank > 0) return <span>{rank}</span>;
		if (status === 'collection_failed') {
			return (
				<span title="수집 실패 또는 제한 감지로 순위를 신뢰할 수 없습니다." style={{ color: '#fb923c', fontSize: 10, whiteSpace: 'nowrap', fontWeight: 800 }}>
					수집 실패
				</span>
			);
		}
		return (
			<span title="수집 완료, 표시 순위 밖/미노출" style={{ color: '#94a3b8', fontSize: 10, whiteSpace: 'nowrap' }}>
				미노출
			</span>
		);
	};

	const getMonthlyVolume = (keyword: string): number | null => {
		const kw = String(keyword || '').trim();
		if (!kw) return null;
		const v0 = volumeMap.get(kw);
		if (v0 != null) return v0;
		const v1 = keywordVolumeMap.get(kw);
		if (v1 != null) return v1;
		return null;
	};

	const getMonthlyVolumeLabel = (keyword: string): string | null => {
		const kw = String(keyword || '').trim();
		if (!kw) return null;
		const fromApi = volumeLabelMap.get(kw);
		return fromApi != null ? fromApi : null;
	};

	const parseLtLabelUpper = (label: string | null): number | null => {
		const s = String(label || '').trim();
		const m = /^<\s*(\d+)\s*$/.exec(s);
		if (!m) return null;
		const n = Number(m[1]);
		return Number.isFinite(n) ? n : null;
	};

	const isVolumeGood = (vol: number | null, label: string | null): boolean => {
		if (vol != null && Number.isFinite(vol) && vol >= 20) return true;
		const upper = parseLtLabelUpper(label);
		// "<80" 같은 케이스는 20 이상으로 판단(상한이 20 초과)
		if (upper != null && upper > 20) return true;
		return false;
	};

	const sortRowsWithState = (
		rows: Array<{ keyword: string; cells: Array<{ date: string; rank: number | null; delta: number | null; status?: string | null }> }>,
		sortState: { key: 'keyword' | 'volume' | 'purchaseScore' | 'adGrade' | 'today'; dir: 'asc' | 'desc' },
	) => {
		const todayKey = String(manualDisplayDates?.[0] ?? '').trim();

		const parseVol = (kw: string): { has: boolean; v: number } => {
			const vol = getMonthlyVolume(kw);
			if (vol != null && Number.isFinite(Number(vol))) return { has: true, v: Number(vol) };
			const lbl = String(getMonthlyVolumeLabel(kw) || '').trim();
			if (!lbl) return { has: false, v: 0 };
			const digits = Number(lbl.replace(/[^\d]/g, ''));
			if (!Number.isFinite(digits) || digits <= 0) return { has: false, v: 0 };
			// "<20" 같은 표현은 대략적인 정렬을 위해 약간 작은 값으로 취급
			return { has: true, v: lbl.startsWith('<') ? digits - 0.5 : digits };
		};

		const parseTodayRank = (
			row: { cells: Array<{ date: string; rank: number | null; delta: number | null; status?: string | null }> },
		): { has: boolean; v: number } => {
			const cells = row?.cells || [];
			const c = todayKey ? cells.find((x) => String(x.date) === todayKey) : null;
			const r = (c ?? cells[0] ?? null)?.rank ?? null;
			if (r == null || !Number.isFinite(Number(r))) return { has: false, v: 0 };
			return { has: true, v: Number(r) };
		};

		const dir = sortState.dir === 'asc' ? 1 : -1;
		return [...rows].sort((a, b) => {
			switch (sortState.key) {
				case 'keyword':
					return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko') * dir;
				case 'purchaseScore': {
					const av = purchaseClassifyMap.get(a.keyword)?.purchaseScore ?? -1;
					const bv = purchaseClassifyMap.get(b.keyword)?.purchaseScore ?? -1;
					if (av !== bv) return (av - bv) * dir;
					return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko');
				}
				case 'adGrade': {
					const order: Record<AdGrade, number> = { 매우우수: 0, 우수: 1, 보통: 2, 낮음: 3, '판단 보류': 4 };
					const ag = adGradeMap.get(a.keyword) ?? '판단 보류';
					const bg = adGradeMap.get(b.keyword) ?? '판단 보류';
					if (order[ag] !== order[bg]) return (order[ag] - order[bg]) * dir;
					return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko');
				}
				case 'volume': {
					const av = parseVol(a.keyword);
					const bv = parseVol(b.keyword);
					// 미집계는 항상 마지막(정렬 방향 무관)
					if (av.has !== bv.has) return av.has ? -1 : 1;
					if (!av.has && !bv.has) return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko');
					if (av.v !== bv.v) return (av.v - bv.v) * dir;
					return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko');
				}
				case 'today': {
					const ar = parseTodayRank(a);
					const br = parseTodayRank(b);
					// 순위 없는 키워드는 항상 마지막
					if (ar.has !== br.has) return ar.has ? -1 : 1;
					if (!ar.has && !br.has) return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko');
					if (ar.v !== br.v) return (ar.v - br.v) * dir;
					return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko');
				}
				default:
					return 0;
			}
		});
	};

	const manualDailyRowsFilteredSorted = useMemo(() => {
		const q = String(manualKeywordQuery || '').trim().toLowerCase();

		const filtered = (manualDailyMatrixRows || []).filter((row) => {
			if (!q) return true;
			return String(row.keyword || '').toLowerCase().includes(q);
		});
		return sortRowsWithState(filtered, manualSort);
	}, [manualDailyMatrixRows, manualKeywordQuery, manualSort, sortRowsWithState]);

	const manualDailyRowsVisible = useMemo(() => {
		if (!manualRowLimit || manualRowLimit <= 0) return manualDailyRowsFilteredSorted;
		return manualDailyRowsFilteredSorted.slice(0, manualRowLimit);
	}, [manualDailyRowsFilteredSorted, manualRowLimit]);

	const group1RowsSorted = useMemo(() => {
		const rows = (manualDailyMatrixRows || []).filter((row) => groupKeywords.group1.includes(row.keyword));
		return sortRowsWithState(rows, group1Sort);
	}, [manualDailyMatrixRows, groupKeywords.group1, group1Sort, sortRowsWithState]);

	const group2RowsSorted = useMemo(() => {
		const rows = (manualDailyMatrixRows || []).filter((row) => groupKeywords.group2.includes(row.keyword));
		return sortRowsWithState(rows, group2Sort);
	}, [manualDailyMatrixRows, groupKeywords.group2, group2Sort, sortRowsWithState]);

	return (
		<div className="rank-detail-root">
			{/* 상단: 뒤로가기 + 상품 헤더 */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
					<button type="button" className="btn-ghost" onClick={onBackToList}>
						목록으로
					</button>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<div style={{ fontSize: 11, color: '#9ca3af' }}>일간 랭킹추적 &gt; 내 상품</div>
						{onOpenCollectModal && (
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 11 }}
								onClick={() => onOpenCollectModal()}
							>
								오늘 수집
							</button>
						)}
						<button
							type="button"
							className="btn-ghost"
							style={{ fontSize: 11 }}
							onClick={() => {
								setExcelUploadError(null);
								setIsExcelModalOpen(true);
							}}
						>
							엑셀 업로드
						</button>
						<button
							type="button"
							className="btn-ghost"
							style={{ fontSize: 11 }}
							onClick={() => setIsManualSalesModalOpen(true)}
						>
							상품 정보 수기입력
						</button>
						{productUrl && (
							<a
								href={productUrl}
								target="_blank"
								rel="noreferrer"
								className="btn-ghost"
								style={{ fontSize: 11, textDecoration: 'none' }}
							>
								상품 페이지 열기
							</a>
						)}
					</div>
				</div>
				<div className="rank-detail-header">
					<div className="rank-detail-thumb">
						{product.imageUrl ? (
							<img src={product.imageUrl} alt={product.name} className="rank-detail-thumb-img" />
						) : (
							<span className="rank-detail-thumb-placeholder">이미지</span>
						)}
					</div>
					<div className="rank-detail-main">
						<div className="rank-detail-title">{product.name}</div>
						<div className="rank-detail-meta">
							{product.sellerName && <span>{product.sellerName}</span>}
							{product.categoryPath && <span>{product.categoryPath}</span>}
						</div>
						<div className="rank-detail-meta">
							{displayPrice != null && <span>{displayPrice.toLocaleString()}원</span>}
							{displayPrice != null && renderSigned(priceDelta)}
							<span>
								리뷰 {displayReviewCount != null ? displayReviewCount.toLocaleString() : '-'}
								{renderSigned(reviewDelta)}
							</span>
							<span>
								평점 {displayRating != null ? displayRating.toFixed(2) : '-'}
								{renderSigned(ratingDelta, { decimals: 2 })}
							</span>
							<span>
								찜 {displayWishCount != null ? displayWishCount.toLocaleString() : '-'}
							</span>
							<span>
								등록일 {displayRegisteredDate || '-'}
							</span>
							<span style={{ color: '#cbd5e1' }}>
								예상판매량(7일) {estimateSales7d != null ? estimateSales7d.toLocaleString() : '-'}건
							</span>
							<span style={{ color: '#cbd5e1' }}>
								예상매출액(7일) {estimateRevenue7dManwon != null ? estimateRevenue7dManwon.toLocaleString() : '-'}만원
							</span>
							{recentPurchase1wCount != null ? (
								<span style={{ color: '#cbd5e1' }}>
									최근 1주간 {recentPurchase1wCount.toLocaleString()}명 구매
								</span>
							) : null}
							{recentRepurchase3mCount != null ? (
								<span style={{ color: '#cbd5e1' }}>
									최근 3개월간 {recentRepurchase3mCount.toLocaleString()}명 재구매(참고)
								</span>
							) : null}
							{pm?.date && (
								<span style={{ color: '#9ca3af' }}>
									(수집 {String(pm.date).replace(/-/g, '.')})
								</span>
							)}
						</div>
						{product.hashtags && product.hashtags.length > 0 && (
							<div className="rank-detail-tags">
								{product.hashtags.map((tag) => (
									<span key={tag} className="rank-detail-tag">
										#{tag}
									</span>
								))}
							</div>
						)}
					</div>
				</div>
			</div>

			{/* 공식 제공 엑셀 업로드 결과(서버 저장) */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="section-title-row">
					<div className="section-title">공식 순위 엑셀</div>
					<div className="section-caption">xlsx에서 (키워드·일자·순위)을 추출해 기존 랭킹 데이터에 저장합니다.</div>
					<button
						type="button"
						className="btn-ghost"
						style={{ marginLeft: 'auto', fontSize: 11 }}
						onClick={() => {
							setExcelUploadError(null);
							setIsExcelModalOpen(true);
						}}
					>
						업로드
					</button>
				</div>
				{lastUploadInfo ? (
					<div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
						최근 업로드: <b style={{ color: '#e5e7eb' }}>{lastUploadInfo.filename}</b> · 저장 {lastUploadInfo.saved}건
						{lastUploadInfo.added ? ` · 신규 키워드 ${lastUploadInfo.added}개 추가` : ''}
					</div>
				) : (
					<div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
						업로드 후 아래 “내 상품 추적” 그래프/표에 반영됩니다.
					</div>
				)}
			</div>

			{/* 추적 키워드 영역 (모드별 운영) */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="section-title-row">
					<div className="section-title">추적 키워드</div>
					<div className="section-caption">
						{trackingMode === 'initial'
							? '초기단계: 수기 입력 키워드로 추적합니다.'
							: '집중단계: 광고/구매 전환 조건으로 자동 그룹핑됩니다.'}
					</div>
					<div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
						<button
							type="button"
							className="btn-ghost"
							style={{
								fontSize: 11,
								fontWeight: trackingMode === 'initial' ? 900 : 600,
								border: trackingMode === 'initial' ? '1px solid #38bdf8' : '1px solid transparent',
							}}
							onClick={() => setTrackingMode('initial')}
						>
							초기단계
						</button>
						<button
							type="button"
							className="btn-ghost"
							style={{
								fontSize: 11,
								fontWeight: trackingMode === 'focus' ? 900 : 600,
								border: trackingMode === 'focus' ? '1px solid #f59e0b' : '1px solid transparent',
							}}
							onClick={() => setTrackingMode('focus')}
						>
							집중단계
						</button>
						{trackingMode === 'initial' && (
							<button
								type="button"
								className="btn-ghost"
								style={{ marginLeft: 8, fontSize: 11 }}
								onClick={() => onEditKeywords?.()}
							>
								추가/편집
							</button>
						)}
					</div>
				</div>
				<div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, color: '#f59e0b' }}>
					{trackingMode === 'initial'
						? `초기단계 키워드 · ${groupKeywords.group1.length}개`
						: `🔥 그룹 1. 핵심 관리 (Always Track) · ${groupKeywords.group1.length}개`}
				</div>
				<div className="tracking-keyword-chips" style={{ marginTop: 4 }}>
					{groupKeywords.group1.map((kw) => {
						const summary = keywordSummaries.get(kw);
						const vol = keywordVolumeMap.get(kw);
						if (trackingMode === 'initial') {
							const checked = selectedKeywords.includes(kw);
							return (
								<button
									key={kw}
									type="button"
									onClick={() => handleToggleKeyword(kw)}
									className={`keyword-chip tracked${checked ? ' selected' : ''}`}
								>
									<span>{kw}</span>
									{vol != null && (
										<span style={{ marginLeft: 6, fontSize: 10, opacity: 0.65 }}>
											({vol.toLocaleString()})
										</span>
									)}
									{typeof summary?.rank === 'number' && summary.rank > 0 && (
										<span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>
											{summary.rank}위
										</span>
									)}
									{renderDelta(summary?.delta ?? null)}
								</button>
							);
						}
						return (
							<span key={kw} className="keyword-chip tracked selected" style={{ cursor: 'default' }}>
								<span>{kw}</span>
								{vol != null && (
									<span style={{ marginLeft: 6, fontSize: 10, opacity: 0.65 }}>
										({vol.toLocaleString()})
									</span>
								)}
								{typeof summary?.rank === 'number' && summary.rank > 0 && (
									<span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>
										{summary.rank}위
									</span>
								)}
								{renderDelta(summary?.delta ?? null)}
							</span>
						);
					})}
					{groupKeywords.group1.length === 0 && (
						<span style={{ fontSize: 11, color: '#9ca3af' }}>조건을 만족하는 키워드가 없습니다.</span>
					)}
				</div>
				{trackingMode === 'focus' && (
					<>
						<div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: '#facc15' }}>
							🟡 그룹 2. 잠재 관리 (Watchlist) · {groupKeywords.group2.length}개
						</div>
						<div className="tracking-keyword-chips" style={{ marginTop: 4 }}>
							{groupKeywords.group2.map((kw) => {
								const checked = selectedKeywords.includes(kw);
								const summary = keywordSummaries.get(kw);
								const vol = keywordVolumeMap.get(kw);
								return (
									<button
										key={kw}
										type="button"
										onClick={() => handleToggleKeyword(kw)}
										className={`keyword-chip tracked${checked ? ' selected' : ''}`}
									>
										<span>{kw}</span>
										{vol != null && (
											<span style={{ marginLeft: 6, fontSize: 10, opacity: 0.65 }}>
												({vol.toLocaleString()})
											</span>
										)}
										{typeof summary?.rank === 'number' && summary.rank > 0 && (
											<span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>
												{summary.rank}위
											</span>
										)}
										{renderDelta(summary?.delta ?? null)}
									</button>
								);
							})}
							{groupKeywords.group2.length === 0 && (
								<span style={{ fontSize: 11, color: '#9ca3af' }}>조건을 만족하는 키워드가 없습니다.</span>
							)}
						</div>
						<div className="section-caption" style={{ marginTop: 6 }}>
							그룹 1 키워드는 그래프에 항상 포함됩니다. 그룹 2는 클릭으로 추가/제거할 수 있습니다.
						</div>
					</>
				)}
			</div>

			{/* 내 상품 추적 그래프 */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="section-title-row">
					<div className="section-title">내 상품 추적</div>
					<div className="section-caption">선택한 키워드의 기간별 순위 변화를 선그래프로 보여줍니다.</div>
					<div style={{ marginLeft: 'auto' }}>
						<button
							type="button"
							className="btn-ghost"
							style={{ fontSize: 11, marginRight: 8 }}
							disabled={volumeLoading || allKeywords.length === 0}
							onClick={() => void fetchVolumes(allKeywords, { persist: true })}
						>
							월검색량 조회
						</button>
						<select
							value={period}
							onChange={(e) => onPeriodChange(e.target.value as RankTrackingDetailPeriod)}
							className="input"
							style={{ width: 80, fontSize: 11, padding: '2px 6px' }}
						>
							{DETAIL_PERIOD_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
						<select
							value={String(matrixRowLimit)}
							onChange={(e) => {
								const v = Number(e.target.value || 200);
								const next = v === 100 ? 100 : v === 200 ? 200 : v === 500 ? 500 : v === 1000 ? 1000 : 0;
								setMatrixRowLimit(next);
							}}
							className="input"
							style={{ width: 120, fontSize: 11, padding: '2px 6px', marginLeft: 10 }}
							aria-label="내 상품 추적 표 표시 행수"
						>
							<option value="100">상위 100행</option>
							<option value="200">상위 200행</option>
							<option value="500">상위 500행</option>
							<option value="1000">상위 1,000행</option>
							<option value="0">전체(주의)</option>
						</select>
					</div>
				</div>

				<div style={{ height: 260, marginBottom: 12 }}>
					{chartData.length === 0 ? (
						<div className="rank-detail-empty">그래프를 표시할 데이터가 없습니다.</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							<LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
								<XAxis
									dataKey="date"
									tick={{ fontSize: 10 }}
									tickFormatter={(d) => String(d).slice(5).replace('-', '.')}
									// 30일 이상에서는 tick을 너무 촘촘하게 찍지 않도록 간격을 둔다.
									// (가로 스크롤/화면 이탈 방지)
									interval={periodDays <= 7 ? 0 : periodDays <= 30 ? 2 : 'preserveStartEnd'}
									angle={periodDays <= 30 ? -35 : 0}
									textAnchor={periodDays <= 30 ? 'end' : 'middle'}
									height={periodDays <= 30 ? 40 : 20}
								/>
								<YAxis
									reversed
									allowDecimals={false}
									tick={{ fontSize: 10 }}
									// 1위를 최상단, 추적 키워드 중 가장 낮은 순위를 하단 기준으로 사용
									domain={[1, maxRank + 1]}
								/>
								<Tooltip
									contentStyle={{
										backgroundColor: '#020617',
										border: '1px solid #1e293b',
										fontSize: 10,
									}}
								/>
								<Legend wrapperStyle={{ fontSize: 10 }} />
								{selectedKeywords.map((kw, idx) => (
									<Line
										key={kw}
										type="monotone"
										dataKey={kw}
										name={kw}
										stroke={LINE_COLORS[idx % LINE_COLORS.length]}
										strokeWidth={1.5}
										dot={false}
										isAnimationActive={false}
									/>
								))}
							</LineChart>
						</ResponsiveContainer>
					)}
				</div>
			</div>

			{/* 핵심/잠재 관리 키워드 표 */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="section-title-row">
					<div className="section-title">핵심·잠재 관리 키워드 표</div>
					<div className="section-caption">그룹 1/2 키워드를 수기 입력 키워드 표 형식으로 표시합니다.</div>
					<div style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
						전환 분석: 최근 30일
					</div>
				</div>

				<div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: '#f59e0b' }}>
					{trackingMode === 'initial' ? '초기단계 키워드' : '🔥 그룹 1. 핵심 관리 (Always Track)'}
				</div>
				{groupKeywords.group1.length === 0 ? (
					<div className="rank-detail-empty" style={{ marginTop: 10 }}>
						조건을 만족하는 키워드가 없습니다.
					</div>
				) : (
					<div style={{ marginTop: 10, overflowX: 'auto' }}>
						<table
							className="table"
							style={{
								tableLayout: 'fixed',
								minWidth: 44 + 200 + 100 + 100 + 90 + 130 + 90 + 90 + manualDisplayDates.length * 56,
							}}
						>
							<thead>
								<tr>
									<th style={{ width: 44, padding: '6px 8px' }} className="num" />
									<th style={{ width: 200, padding: '6px 8px', whiteSpace: 'nowrap', wordBreak: 'keep-all' as any }}>
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setGroup1Sort, 'keyword')}
											aria-label="핵심 표 정렬 키워드"
										>
											키워드 <span style={{ opacity: group1Sort.key === 'keyword' ? 1 : 0.5 }}>{sortIndicator(group1Sort, 'keyword')}</span>
										</button>
									</th>
									<th style={{ width: 100, padding: '6px 8px' }} className="num">
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setGroup1Sort, 'volume')}
											aria-label="핵심 표 정렬 월검색량"
										>
											월검색량 <span style={{ opacity: group1Sort.key === 'volume' ? 1 : 0.5 }}>{sortIndicator(group1Sort, 'volume')}</span>
										</button>
									</th>
									<th style={{ width: 100, padding: '6px 8px' }} className="num">
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setGroup1Sort, 'purchaseScore')}
											aria-label="핵심 표 정렬 구매기여도"
										>
											구매기여도 <span style={{ opacity: group1Sort.key === 'purchaseScore' ? 1 : 0.5 }}>{sortIndicator(group1Sort, 'purchaseScore')}</span>
										</button>
									</th>
									<th style={{ width: 90, padding: '6px 8px' }}>
										키워드분류
									</th>
									<th style={{ width: 130, padding: '6px 8px' }} className="num">
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setGroup1Sort, 'adGrade')}
											aria-label="핵심 표 정렬 광고전환등급"
										>
											광고전환등급 <span style={{ opacity: group1Sort.key === 'adGrade' ? 1 : 0.5 }}>{sortIndicator(group1Sort, 'adGrade')}</span>
										</button>
									</th>
									<th style={{ width: 90, padding: '6px 8px' }} className="num">
										전환율
									</th>
									<th style={{ width: 90, padding: '6px 8px' }} className="num">
										전환일수
									</th>
									{manualDisplayDates.map((date) => {
										const label = date?.slice(5).replace('-', '.');
										const isToday = date === manualDisplayDates[0];
										return (
											<th key={date} className="num" style={{ padding: '6px 8px' }}>
												{isToday ? (
													<button
														type="button"
														className="btn-ghost"
														style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
														onClick={() => toggleSort(setGroup1Sort, 'today')}
														aria-label={`핵심 표 정렬 오늘 ${label}`}
													>
														{label} <span style={{ opacity: group1Sort.key === 'today' ? 1 : 0.5 }}>{sortIndicator(group1Sort, 'today')}</span>
													</button>
												) : (
													label
												)}
											</th>
										);
									})}
								</tr>
							</thead>
							<tbody>
								{group1RowsSorted.map((row) => {
										const purchaseInfo = purchaseClassifyMap.get(row.keyword);
										const adGrade = adGradeMap.get(row.keyword) ?? '판단 보류';
										const adMetrics = adMetricsMap.get(row.keyword);
										const isMain = purchaseInfo?.grade === 'MAIN';
										const mainColor = isMain ? '#f59e0b' : '#94a3b8';
										const vol = getMonthlyVolume(row.keyword);
										const volLabel = getMonthlyVolumeLabel(row.keyword);
										const goodVol = isVolumeGood(vol, volLabel);
										const conversionRateLabel =
											adMetrics?.conversionRate != null && Number.isFinite(adMetrics.conversionRate)
												? `${adMetrics.conversionRate.toFixed(2)}%`
												: '-';
										const conversionDaysLabel =
											adMetrics?.conversionDays != null && adMetrics.conversionDays > 0
												? `${adMetrics.conversionDays}일`
												: '-';
										return (
											<tr key={row.keyword}>
												<td className="num" />
												<td style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all' as any }}>{row.keyword}</td>
												<td
													className="num"
													style={{
														color: goodVol ? '#86efac' : '#9ca3af',
														fontSize: 11,
														whiteSpace: 'nowrap',
														fontWeight: goodVol ? 800 : 500,
													}}
												>
													{volLabel ? volLabel : vol != null ? vol.toLocaleString() : '미집계'}
												</td>
												<td className="num" style={{ whiteSpace: 'nowrap' }}>
													<span style={{ color: mainColor, fontWeight: isMain ? 900 : 600 }}>
														{scoreLabel(purchaseInfo?.purchaseScore ?? null)}
													</span>
												</td>
												<td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
													<span style={{ color: mainColor, fontWeight: isMain ? 900 : 600 }}>
														{purchaseInfo?.grade ?? 'SUB'}
													</span>
												</td>
												<td className="num" style={{ whiteSpace: 'nowrap' }}>
													<AdGradeBadge grade={adGrade} metrics={adMetrics} />
												</td>
												<td className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#e2e8f0' }}>
													{conversionRateLabel}
												</td>
												<td className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#e2e8f0' }}>
													{conversionDaysLabel}
												</td>
												{row.cells.map((cell) => (
													<td key={cell.date} className="num">
														<div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
															{renderRankCellValue(cell.rank, cell.status)}
															{typeof cell.rank === 'number' && cell.rank > 0 ? renderDelta(cell.delta) : null}
														</div>
													</td>
												))}
											</tr>
										);
									})}
							</tbody>
						</table>
					</div>
				)}

				{trackingMode === 'focus' && (
					<>
						<div style={{ marginTop: 16, fontSize: 12, fontWeight: 900, color: '#facc15' }}>
							🟡 그룹 2. 잠재 관리 (Watchlist)
						</div>
						{groupKeywords.group2.length === 0 ? (
							<div className="rank-detail-empty" style={{ marginTop: 10 }}>
								조건을 만족하는 키워드가 없습니다.
							</div>
						) : (
							<div style={{ marginTop: 10, overflowX: 'auto' }}>
								<table
									className="table"
									style={{
										tableLayout: 'fixed',
										minWidth: 44 + 200 + 100 + 100 + 90 + 130 + 90 + 90 + manualDisplayDates.length * 56,
									}}
								>
									<thead>
										<tr>
											<th style={{ width: 44, padding: '6px 8px' }} className="num">
												선택
											</th>
											<th style={{ width: 200, padding: '6px 8px', whiteSpace: 'nowrap', wordBreak: 'keep-all' as any }}>
												<button
													type="button"
													className="btn-ghost"
													style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
												onClick={() => toggleSort(setGroup2Sort, 'keyword')}
													aria-label="잠재 표 정렬 키워드"
												>
												키워드 <span style={{ opacity: group2Sort.key === 'keyword' ? 1 : 0.5 }}>{sortIndicator(group2Sort, 'keyword')}</span>
												</button>
											</th>
											<th style={{ width: 100, padding: '6px 8px' }} className="num">
												<button
													type="button"
													className="btn-ghost"
													style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
												onClick={() => toggleSort(setGroup2Sort, 'volume')}
													aria-label="잠재 표 정렬 월검색량"
												>
												월검색량 <span style={{ opacity: group2Sort.key === 'volume' ? 1 : 0.5 }}>{sortIndicator(group2Sort, 'volume')}</span>
												</button>
											</th>
											<th style={{ width: 100, padding: '6px 8px' }} className="num">
												<button
													type="button"
													className="btn-ghost"
													style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
												onClick={() => toggleSort(setGroup2Sort, 'purchaseScore')}
													aria-label="잠재 표 정렬 구매기여도"
												>
												구매기여도 <span style={{ opacity: group2Sort.key === 'purchaseScore' ? 1 : 0.5 }}>{sortIndicator(group2Sort, 'purchaseScore')}</span>
												</button>
											</th>
											<th style={{ width: 90, padding: '6px 8px' }}>
												키워드분류
											</th>
											<th style={{ width: 130, padding: '6px 8px' }} className="num">
												<button
													type="button"
													className="btn-ghost"
													style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
												onClick={() => toggleSort(setGroup2Sort, 'adGrade')}
													aria-label="잠재 표 정렬 광고전환등급"
												>
												광고전환등급 <span style={{ opacity: group2Sort.key === 'adGrade' ? 1 : 0.5 }}>{sortIndicator(group2Sort, 'adGrade')}</span>
												</button>
											</th>
											<th style={{ width: 90, padding: '6px 8px' }} className="num">
												전환율
											</th>
											<th style={{ width: 90, padding: '6px 8px' }} className="num">
												전환일수
											</th>
											{manualDisplayDates.map((date) => {
												const label = date?.slice(5).replace('-', '.');
												const isToday = date === manualDisplayDates[0];
												return (
													<th key={date} className="num" style={{ padding: '6px 8px' }}>
														{isToday ? (
															<button
																type="button"
																className="btn-ghost"
																style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
																onClick={() => toggleSort(setGroup2Sort, 'today')}
																aria-label={`수기 표 정렬 오늘 ${label}`}
															>
																{label} <span style={{ opacity: group2Sort.key === 'today' ? 1 : 0.5 }}>{sortIndicator(group2Sort, 'today')}</span>
															</button>
														) : (
															label
														)}
													</th>
												);
											})}
										</tr>
									</thead>
									<tbody>
										{group2RowsSorted.map((row) => {
												const purchaseInfo = purchaseClassifyMap.get(row.keyword);
												const adGrade = adGradeMap.get(row.keyword) ?? '판단 보류';
												const adMetrics = adMetricsMap.get(row.keyword);
												const isMain = purchaseInfo?.grade === 'MAIN';
												const mainColor = isMain ? '#f59e0b' : '#94a3b8';
												const vol = getMonthlyVolume(row.keyword);
												const volLabel = getMonthlyVolumeLabel(row.keyword);
												const goodVol = isVolumeGood(vol, volLabel);
												const conversionRateLabel =
													adMetrics?.conversionRate != null && Number.isFinite(adMetrics.conversionRate)
														? `${adMetrics.conversionRate.toFixed(2)}%`
														: '-';
												const conversionDaysLabel =
													adMetrics?.conversionDays != null && adMetrics.conversionDays > 0
														? `${adMetrics.conversionDays}일`
														: '-';
												const checked = selectedKeywords.includes(row.keyword);
												return (
													<tr key={row.keyword}>
														<td className="num">
															<input
																type="checkbox"
																aria-label={`잠재 키워드 선택 ${row.keyword}`}
																checked={checked}
																onChange={(e) => {
																	const next = Boolean(e.target.checked);
																	setSelectedKeywords((prev) => {
																		if (next) return Array.from(new Set([...prev, row.keyword]));
																		return prev.filter((k) => k !== row.keyword);
																	});
																}}
															/>
														</td>
														<td style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all' as any }}>{row.keyword}</td>
														<td
															className="num"
															style={{
																color: goodVol ? '#86efac' : '#9ca3af',
																fontSize: 11,
																whiteSpace: 'nowrap',
																fontWeight: goodVol ? 800 : 500,
															}}
														>
															{volLabel ? volLabel : vol != null ? vol.toLocaleString() : '미집계'}
														</td>
														<td className="num" style={{ whiteSpace: 'nowrap' }}>
															<span style={{ color: mainColor, fontWeight: isMain ? 900 : 600 }}>
																{scoreLabel(purchaseInfo?.purchaseScore ?? null)}
															</span>
														</td>
														<td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
															<span style={{ color: mainColor, fontWeight: isMain ? 900 : 600 }}>
																{purchaseInfo?.grade ?? 'SUB'}
															</span>
														</td>
														<td className="num" style={{ whiteSpace: 'nowrap' }}>
															<AdGradeBadge grade={adGrade} metrics={adMetrics} />
														</td>
														<td className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#e2e8f0' }}>
															{conversionRateLabel}
														</td>
														<td className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#e2e8f0' }}>
															{conversionDaysLabel}
														</td>
														{row.cells.map((cell) => (
															<td key={cell.date} className="num">
																<div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
																	{renderRankCellValue(cell.rank, cell.status)}
																	{typeof cell.rank === 'number' && cell.rank > 0 ? renderDelta(cell.delta) : null}
																</div>
															</td>
														))}
													</tr>
												);
											})}
									</tbody>
								</table>
							</div>
						)}
					</>
				)}
			</div>

			{/* 수기 입력 키워드 (데일리 표) */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="section-title-row">
					<div className="section-title">수기 입력 키워드</div>
					<div className="section-caption">저장된 키워드(월검색량) 목록을 기준으로 날짜별 순위/변동을 동일한 표 형태로 보여줍니다.</div>
					<select
						value={String(manualDays)}
						onChange={(e) => {
							const v = Number(e.target.value || 90);
							const next = v === 7 ? 7 : v === 30 ? 30 : v === 180 ? 180 : 90;
							if (onManualTableDaysChange) onManualTableDaysChange(next);
							else setManualDaysLocal(next);
						}}
						className="input"
						style={{ width: 92, fontSize: 11, padding: '2px 6px', marginLeft: 10 }}
						aria-label="수기 데일리 표 기간"
					>
						<option value="7">7일</option>
						<option value="30">30일</option>
						<option value="90">90일</option>
						<option value="180">180일</option>
					</select>
					<select
						value={String(manualRowLimit)}
						onChange={(e) => {
							const v = Number(e.target.value || 500);
							const next = v === 200 ? 200 : v === 500 ? 500 : v === 1000 ? 1000 : 0;
							setManualRowLimit(next);
							setManualSelectedKeywords((prev) => new Set(prev)); // 선택 상태는 유지(렌더 안정화)
						}}
						className="input"
						style={{ width: 120, fontSize: 11, padding: '2px 6px', marginLeft: 10 }}
						aria-label="수기 데일리 표 표시 행수"
					>
						<option value="200">상위 200행</option>
						<option value="500">상위 500행</option>
						<option value="1000">상위 1,000행</option>
						<option value="0">전체(주의)</option>
					</select>
					<button
						type="button"
						className="btn-ghost"
						style={{ marginLeft: 10, fontSize: 11 }}
						disabled={manualSelectedKeywords.size === 0}
						onClick={() => void deleteSelectedManualKeywords()}
					>
						선택 삭제
					</button>
					<input
						className="input"
						style={{ marginLeft: 10, width: 220, fontSize: 11, padding: '2px 6px' }}
						value={manualKeywordQuery}
						onChange={(e) => setManualKeywordQuery(String(e.target.value))}
						placeholder="등록 키워드 검색"
						aria-label="수기 키워드 검색"
					/>
					<div style={{ marginLeft: 10, fontSize: 11, color: '#9ca3af' }}>
						표시 {manualDailyRowsVisible.length.toLocaleString()} / 전체 {manualDailyRowsFilteredSorted.length.toLocaleString()}
					</div>
					{keywordClassifyLoading ? (
						<div style={{ marginLeft: 10, fontSize: 11, color: '#93c5fd' }}>전환 분류 계산 중…</div>
					) : keywordClassifyError ? (
						<div style={{ marginLeft: 10, fontSize: 11, color: '#fca5a5' }}>{keywordClassifyError}</div>
					) : (
						<div style={{ marginLeft: 10, fontSize: 11, color: '#9ca3af' }}>전환 분석: 최근 30일</div>
					)}
					<div style={{ marginLeft: 10, fontSize: 11, color: '#94a3b8' }}>
						광고 전환 등급은 전환수/기여도 기준이며, 전환 0은 판단 보류입니다.
					</div>
					<button
						type="button"
						className="btn-ghost"
						style={{ marginLeft: 'auto', fontSize: 11 }}
						disabled={volumeLoading || manualKeywordsForDailyTable.length === 0}
						onClick={() => void fetchVolumes(manualKeywordsForDailyTable, { persist: true })}
					>
						월검색량 조회
					</button>
				</div>
				<div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
					MAIN/SUB은 구매 키워드 기준이며, 광고 전환 등급은 전체 공통 지표입니다.
				</div>

				{manualKeywordsForDailyTable.length === 0 ? (
					<div className="rank-detail-empty" style={{ marginTop: 10 }}>
						표시할 수기 입력 키워드 데이터가 없습니다. (엑셀 업로드 또는 텍스트 입력 후 저장)
					</div>
				) : (
					<div style={{ marginTop: 10, overflowX: 'auto' }}>
						<table
							className="table"
							style={{
								tableLayout: 'fixed',
								minWidth: 44 + 200 + 100 + 100 + 90 + 130 + 90 + 90 + manualDisplayDates.length * 56,
							}}
						>
							<thead>
								<tr>
									<th style={{ width: 44, padding: '6px 8px' }} className="num">
										<input
											type="checkbox"
											aria-label="수기 키워드 전체 선택"
											checked={(() => {
												const rows = manualDailyRowsVisible;
												if (rows.length === 0) return false;
												return rows.every((r) => manualSelectedKeywords.has(r.keyword));
											})()}
											onChange={(e) => {
												const checked = Boolean(e.target.checked);
												const rows = manualDailyRowsVisible;
												setManualSelectedKeywords(() => {
													if (!checked) return new Set();
													return new Set(rows.map((r) => r.keyword));
												});
											}}
										/>
									</th>
									<th style={{ width: 200, padding: '6px 8px', whiteSpace: 'nowrap', wordBreak: 'keep-all' as any }}>
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setManualSort, 'keyword')}
											aria-label="수기 표 정렬 키워드"
										>
											키워드 <span style={{ opacity: manualSort.key === 'keyword' ? 1 : 0.5 }}>{sortIndicator(manualSort, 'keyword')}</span>
										</button>
									</th>
									<th style={{ width: 100, padding: '6px 8px' }} className="num">
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setManualSort, 'volume')}
											aria-label="수기 표 정렬 월검색량"
										>
											월검색량 <span style={{ opacity: manualSort.key === 'volume' ? 1 : 0.5 }}>{sortIndicator(manualSort, 'volume')}</span>
										</button>
									</th>
									<th style={{ width: 100, padding: '6px 8px' }} className="num">
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setManualSort, 'purchaseScore')}
											aria-label="수기 표 정렬 구매기여도"
										>
											구매기여도 <span style={{ opacity: manualSort.key === 'purchaseScore' ? 1 : 0.5 }}>{sortIndicator(manualSort, 'purchaseScore')}</span>
										</button>
									</th>
									<th style={{ width: 90, padding: '6px 8px' }}>
										키워드분류
									</th>
									<th style={{ width: 130, padding: '6px 8px' }} className="num">
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
											onClick={() => toggleSort(setManualSort, 'adGrade')}
											aria-label="수기 표 정렬 광고전환등급"
										>
											광고전환등급 <span style={{ opacity: manualSort.key === 'adGrade' ? 1 : 0.5 }}>{sortIndicator(manualSort, 'adGrade')}</span>
										</button>
									</th>
									<th style={{ width: 90, padding: '6px 8px' }} className="num">
										전환율
									</th>
									<th style={{ width: 90, padding: '6px 8px' }} className="num">
										전환일수
									</th>
									{manualDisplayDates.map((date) => {
										const label = date?.slice(5).replace('-', '.');
										const isToday = date === manualDisplayDates[0];
										return (
											<th key={date} className="num" style={{ padding: '6px 8px' }}>
												{isToday ? (
													<button
														type="button"
														className="btn-ghost"
														style={{ fontSize: 11, fontWeight: 900, padding: '2px 6px' }}
														onClick={() => toggleSort(setManualSort, 'today')}
														aria-label={`수기 표 정렬 오늘 ${label}`}
													>
														{label} <span style={{ opacity: manualSort.key === 'today' ? 1 : 0.5 }}>{sortIndicator(manualSort, 'today')}</span>
													</button>
												) : (
													label
												)}
											</th>
										);
									})}
								</tr>
							</thead>
							<tbody>
								{manualDailyRowsVisible.map((row) => {
									const purchaseInfo = purchaseClassifyMap.get(row.keyword);
									const adGrade = adGradeMap.get(row.keyword) ?? '판단 보류';
									const adMetrics = adMetricsMap.get(row.keyword);
									const isMain = purchaseInfo?.grade === 'MAIN';
									const mainColor = isMain ? '#f59e0b' : '#94a3b8';
									const conversionRateLabel =
										adMetrics?.conversionRate != null && Number.isFinite(adMetrics.conversionRate)
											? `${adMetrics.conversionRate.toFixed(2)}%`
											: '-';
									const conversionDaysLabel =
										adMetrics?.conversionDays != null && adMetrics.conversionDays > 0
											? `${adMetrics.conversionDays}일`
											: '-';
									const vol = getMonthlyVolume(row.keyword);
									const volLabel = getMonthlyVolumeLabel(row.keyword);
									const goodVol = isVolumeGood(vol, volLabel);
									return (
									<tr key={row.keyword}>
										<td className="num">
											<input
												type="checkbox"
												aria-label={`수기 키워드 선택 ${row.keyword}`}
												checked={manualSelectedKeywords.has(row.keyword)}
												onChange={(e) => {
													const checked = Boolean(e.target.checked);
													setManualSelectedKeywords((prev) => {
														const next = new Set(prev);
														if (checked) next.add(row.keyword);
														else next.delete(row.keyword);
														return next;
													});
												}}
											/>
										</td>
										<td style={{ whiteSpace: 'nowrap', wordBreak: 'keep-all' as any }}>
											{row.keyword}
										</td>
										<td
											className="num"
											style={{
												color: goodVol ? '#86efac' : '#9ca3af',
												fontSize: 11,
												whiteSpace: 'nowrap',
												fontWeight: goodVol ? 800 : 500,
											}}
										>
											{volLabel ? volLabel : vol != null ? vol.toLocaleString() : '미집계'}
										</td>
										<td className="num" style={{ whiteSpace: 'nowrap' }}>
											<span style={{ color: mainColor, fontWeight: isMain ? 900 : 600 }}>
												{scoreLabel(purchaseInfo?.purchaseScore ?? null)}
											</span>
										</td>
										<td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
											<span style={{ color: mainColor, fontWeight: isMain ? 900 : 600 }}>
												{purchaseInfo?.grade ?? 'SUB'}
											</span>
										</td>
										<td className="num" style={{ whiteSpace: 'nowrap' }}>
											<AdGradeBadge grade={adGrade} metrics={adMetrics} />
										</td>
										<td className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#e2e8f0' }}>
											{conversionRateLabel}
										</td>
										<td className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#e2e8f0' }}>
											{conversionDaysLabel}
										</td>
										{row.cells.map((cell) => (
											<td key={cell.date} className="num">
												<div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
													{renderRankCellValue(cell.rank, cell.status)}
													{typeof cell.rank === 'number' && cell.rank > 0 ? renderDelta(cell.delta) : null}
												</div>
											</td>
										))}
									</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* 키워드 순위 수집은 OpenAPI 기반으로 리스트 화면(모달)에서만 실행 */}

			{/* 키워드 + 월검색량 입력/업로드 */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="section-title-row">
					<div className="section-title">키워드 + 월검색량 입력/업로드</div>
					<div className="section-caption">키워드와 월검색량을 직접 입력하거나 엑셀(xlsx) 업로드로 저장합니다. (기본: 기존 유지 + 입력된 키워드만 업데이트)</div>
					<div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
						<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af' }}>
							<input
								type="checkbox"
								checked={manualVolumeMode === 'replace'}
								onChange={(e) => setManualVolumeMode(e.target.checked ? 'replace' : 'append')}
							/>
							덮어쓰기(기존 키워드 비활성화)
						</label>
						<button
							type="button"
							className="btn-ghost"
							disabled={manualVolumeSaving}
							onClick={() => void saveManualKeywordVolumes(parsedVolumeItems)}
						>
							월검색량 저장
						</button>
						<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
							<span className="field-label">엑셀 업로드(xlsx)</span>
							<input type="file" accept=".xlsx" onChange={(e) => void handleManualVolumeExcel(e.target.files?.[0] ?? null)} />
						</label>
						<span style={{ fontSize: 11, color: '#9ca3af' }}>파싱 {parsedVolumeItems.length.toLocaleString()}개</span>
						<span style={{ fontSize: 11, color: '#9ca3af' }}>저장됨 {manualKeywordMetaRows.length.toLocaleString()}개</span>
						{manualVolumeSavedInfo ? (
							<span style={{ fontSize: 11, color: '#86efac', fontWeight: 800 }}>
								저장 {manualVolumeSavedInfo.saved.toLocaleString()}건 · 총 {manualVolumeSavedInfo.total_active.toLocaleString()}건
							</span>
						) : null}
					</div>
				</div>

				<div style={{ marginTop: 10 }}>
					<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
						<span className="field-label">입력 텍스트 (예: 염색약 51000)</span>
						<textarea
							className="input"
							style={{ minHeight: 90, resize: 'vertical' as any }}
							value={manualVolumeText}
							onChange={(e) => setManualVolumeText(String(e.target.value))}
							placeholder={'예)\n염색약 51000\n헤나 7440\n새치염색약 / 20410'}
							aria-label="월검색량 입력 텍스트"
						/>
					</label>
					{manualVolumeError ? <div style={{ marginTop: 8, fontSize: 11, color: '#fecaca' }}>{manualVolumeError}</div> : null}
				</div>
			</div>

			{/* (요청) 맨 밑 '내 상품 분석(전일 기준)' 섹션 제거 */}

			{/* 상품 정보 수기입력 모달 */}
			{isManualSalesModalOpen && (
				<div
					className="modal-backdrop"
					role="dialog"
					aria-label="상품 정보 수기입력"
					onClick={() => setIsManualSalesModalOpen(false)}
				>
					<div className="modal-card" onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<div className="modal-title">상품 정보 수기입력</div>
							<button
								type="button"
								className="btn-ghost"
								onClick={() => setIsManualSalesModalOpen(false)}
								style={{ fontSize: 11 }}
							>
								닫기
							</button>
						</div>
						<div className="modal-body">
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
								<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
									<span className="field-label">예상판매량(7일) (건)</span>
									<input
										className="input"
										inputMode="numeric"
										value={manualSalesForm.expected_sales_7d}
										onChange={(e) =>
											setManualSalesForm((s) => ({ ...s, expected_sales_7d: String(e.target.value) }))
										}
										placeholder="예: 120"
									/>
								</label>
								<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
									<span className="field-label">예상매출액(7일) (만원)</span>
									<input
										className="input"
										inputMode="numeric"
										value={manualSalesForm.expected_revenue_7d_manwon}
										onChange={(e) =>
											setManualSalesForm((s) => ({
												...s,
												expected_revenue_7d_manwon: String(e.target.value),
											}))
										}
										placeholder="예: 350"
									/>
								</label>
								<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
									<span className="field-label">최근 1주간 구매 (명)</span>
									<input
										className="input"
										inputMode="numeric"
										value={manualSalesForm.recent_purchase_1w_count}
										onChange={(e) =>
											setManualSalesForm((s) => ({ ...s, recent_purchase_1w_count: String(e.target.value) }))
										}
										placeholder="예: 85"
									/>
								</label>
								<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
									<span className="field-label">최근 3개월간 재구매 (명, 참고)</span>
									<input
										className="input"
										inputMode="numeric"
										value={manualSalesForm.recent_repurchase_3m_count}
										onChange={(e) =>
											setManualSalesForm((s) => ({
												...s,
												recent_repurchase_3m_count: String(e.target.value),
											}))
										}
										placeholder="예: 560"
									/>
								</label>
							</div>
							{manualSalesLoading ? (
								<div style={{ marginTop: 10, fontSize: 11, color: '#9ca3af' }}>불러오는 중…</div>
							) : null}
							{manualSalesError ? (
								<div style={{ marginTop: 10, fontSize: 11, color: '#fecaca' }}>{manualSalesError}</div>
							) : null}
						</div>
						<div className="modal-footer">
							<button
								type="button"
								className="btn-primary"
								disabled={manualSalesSaving}
								onClick={() => void handleSaveManualSales()}
							>
								저장
							</button>
							<button type="button" className="btn-ghost" onClick={() => setIsManualSalesModalOpen(false)}>
								닫기
							</button>
						</div>
					</div>
				</div>
			)}

			{/* 엑셀 업로드 모달 */}
			{isExcelModalOpen && (
				<div
					className="modal-backdrop"
					role="dialog"
					aria-label="순위 엑셀 업로드"
					onClick={() => setIsExcelModalOpen(false)}
				>
					<div
						className="modal-card"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="modal-header">
							<div className="modal-title">순위 엑셀 업로드</div>
							<button
								type="button"
								className="btn-ghost"
								onClick={() => setIsExcelModalOpen(false)}
								style={{ fontSize: 11 }}
							>
								닫기
							</button>
						</div>
						<div className="modal-body">
							<div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 10 }}>
								형식: <b>첫 줄=날짜 헤더</b>, <b>첫 열=키워드</b>, 셀은 “순위/전일 대비” 표시값입니다.
							</div>
							<input
								id="rank-excel-file-input"
								type="file"
								accept=".xlsx"
								onChange={(e) => void handleExcelFile(e.target.files?.[0] ?? null)}
							/>
							{excelUploadError && (
								<div style={{ marginTop: 10, fontSize: 11, color: '#fecaca' }}>
									{excelUploadError}
								</div>
							)}
							{excelUploading && (
								<div style={{ marginTop: 10, fontSize: 11, color: '#9ca3af' }}>
									업로드 처리 중…
								</div>
							)}
						</div>
						<div className="modal-footer">
							<button type="button" className="btn-ghost" onClick={() => setIsExcelModalOpen(false)}>
								닫기
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

const LINE_COLORS = ['#22c55e', '#38bdf8', '#f97316', '#eab308', '#a855f7'];


