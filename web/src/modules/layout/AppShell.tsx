import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
	buildCaptchaSessionSummary,
	derivePageMetricsBlockHint,
	getScrapeOnceBodySample,
	type CaptchaSessionStatus,
	type PageMetricsScrapeOnceResponse,
} from './pageMetricsDebug';
import { deriveTrackedProductLabel } from './productLabel';
import { getLatestRankSummary } from './rankUtils';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildRankChartData, buildRankMatrixData } from './rankUtils';
import { Navigate, Route, Routes, matchPath, useLocation, useNavigate } from 'react-router-dom';
import {
	RankTrackingListView,
	type TrackedProductListItem,
} from './RankTrackingListView';
import {
	RankTrackingDetailView,
	type RankTrackingDetailPeriod,
	type RankTrackingDetailProduct,
	type RankTrackingAnalyticsSnapshot,
} from './RankTrackingDetailView';
import { useMaybeAuth } from '../auth/AuthProvider';
import {
	decodeJwtPayload,
	normalizeAnalyticsRolesFromClaims,
	primaryAnalyticsRole,
} from '../../shared/auth/authClaims';
import {
	appShellAnalyticsRoleChipClass,
	labelAnalyticsRole,
} from '../../shared/presentation/authPresentation';
import { getNasHostSetupCommands } from './hostSetupCommands';
import { getHostSetupDownloads } from './hostSetupDownloads';
import {
	buildErp2ClientIpHeaders,
	discoverNasHostCdpIp,
	isPrivateOrLoopbackIpv4,
	isRoutableNasHostCdpIpv4,
	rewriteCdpHttpUrlForNas,
} from './hostCdpClient';
import { REQUIRED_HOST_AGENT_MANAGE_NO, REQUIRED_HOST_AGENT_VERSION } from '../hostAgentRelease';
import { summarizeCaptchaSessionDebug } from './cdpDebugSummary';
import { formatSessionPrepErrorMessage } from './sessionPrepError';

const KeywordInsightsView = lazy(async () => await import('../research/KeywordInsightsView').then((m) => ({ default: m.KeywordInsightsView })));
const SeoOptimizerView = lazy(async () => await import('../research/SeoOptimizerView').then((m) => ({ default: m.SeoOptimizerView })));
const HashtagSeoView = lazy(async () => await import('../research/HashtagSeoView').then((m) => ({ default: m.HashtagSeoView })));
const ProductIndexAnalysisView = lazy(
	async () => await import('../research/ProductIndexAnalysisView').then((m) => ({ default: m.ProductIndexAnalysisView })),
);
const SeoCategoryDictionarySettingsView = lazy(
	async () =>
		await import('../settings/SeoCategoryDictionarySettingsView').then((m) => ({
			default: m.SeoCategoryDictionarySettingsView,
		})),
);
const SeoRulesSettingsView = lazy(async () => await import('../settings/SeoRulesSettingsView').then((m) => ({ default: m.SeoRulesSettingsView })));
const ApiSettingsView = lazy(async () => await import('../settings/ApiSettingsView').then((m) => ({ default: m.ApiSettingsView })));
const AiSettingsView = lazy(async () => await import('../settings/AiSettingsView').then((m) => ({ default: m.AiSettingsView })));
const DataCollectionView = lazy(async () => await import('../settings/DataCollectionView').then((m) => ({ default: m.DataCollectionView })));
const MenuSyncView = lazy(async () => await import('../settings/MenuSyncView').then((m) => ({ default: m.MenuSyncView })));
const VersionManagementView = lazy(
	async () => await import('../settings/VersionManagementView').then((m) => ({ default: m.VersionManagementView })),
);
const UserManagementView = lazy(async () => await import('../settings/UserManagementView').then((m) => ({ default: m.UserManagementView })));
const AiOrganicRankA1View = lazy(async () => await import('../ai/AiOrganicRankA1View').then((m) => ({ default: m.AiOrganicRankA1View })));
const AiOrganicRankA1TraceExplorerView = lazy(
	async () => await import('../ai/AiOrganicRankA1TraceExplorerView').then((m) => ({ default: m.AiOrganicRankA1TraceExplorerView })),
);
const AiOpsHomeView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsHomeView })));
const AiOpsProductsView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsProductsView })));
const AiOpsAdsView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsAdsView })));
const AiOpsSalesView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsSalesView })));
const AiOpsReviewsView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsReviewsView })));
const AiOpsQnaView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsQnaView })));
const AiOpsTrendsView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsTrendsView })));
const AiOpsPoliciesView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsPoliciesView })));
const AiOpsActionsView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsActionsView })));
const AiOpsLogsView = lazy(async () => await import('../ai').then((m) => ({ default: m.AiOpsLogsView })));
const CampaignDailyView = lazy(async () => await import('../ads/AdsViews').then((m) => ({ default: m.CampaignDailyView })));
const AdgroupDailyView = lazy(async () => await import('../ads/AdsViews').then((m) => ({ default: m.AdgroupDailyView })));
const CreativesDailyView = lazy(async () => await import('../ads/AdsViews').then((m) => ({ default: m.CreativesDailyView })));
const GfaOperatingCheckView = lazy(async () => await import('../ads/AdsViews').then((m) => ({ default: m.GfaOperatingCheckView })));
const GfaCreativeAnalysisView = lazy(async () => await import('../ads/AdsViews').then((m) => ({ default: m.GfaCreativeAnalysisView })));
const GfaStrategyView = lazy(async () => await import('../ads/AdsViews').then((m) => ({ default: m.GfaStrategyView })));
const GfaRawAnalysisView = lazy(async () => await import('../ads/AdsViews').then((m) => ({ default: m.GfaRawAnalysisView })));
const AdsKeywordsPerformanceView = lazy(
	async () => await import('../ads/AdsViews').then((m) => ({ default: m.AdsKeywordsPerformanceView })),
);
const AdsE2EHarnessView = lazy(async () => await import('../ads/AdsE2EHarnessView').then((m) => ({ default: m.AdsE2EHarnessView })));
const PurchaseKeywordsView = lazy(async () => await import('../purchase/PurchaseKeywordsView').then((m) => ({ default: m.PurchaseKeywordsView })));
const SalesAnalysisView = lazy(async () => await import('../sales/SalesAnalysisView').then((m) => ({ default: m.SalesAnalysisView })));
const SalesProductDetailView = lazy(
	async () => await import('../sales/SalesProductDetailView').then((m) => ({ default: m.SalesProductDetailView })),
);
const ReviewAnalysisView = lazy(async () => await import('../reviews/ReviewAnalysisView').then((m) => ({ default: m.ReviewAnalysisView })));
const ReviewAnalysisOverviewView = lazy(
	async () => await import('../reviews/ReviewAnalysisOverviewView').then((m) => ({ default: m.ReviewAnalysisOverviewView })),
);
const QnaManagementView = lazy(async () => await import('../reviews/QnaManagementView').then((m) => ({ default: m.QnaManagementView })));
const QnaAnalysisView = lazy(async () => await import('../reviews/QnaAnalysisView').then((m) => ({ default: m.QnaAnalysisView })));

// ---------- Firebase Auth 헤더(런타임 안정성) ----------
// NAS/로컬 공통으로 "Bearer 토큰이 필요한" 호출이 있으며,
// 과거 번들 최적화에서 특정 함수가 "정의 없이 참조"되어 런타임 `is not defined`가 반복된 적이 있다.
// 이를 재발 불가로 만들기 위해, 토큰 획득 로직은 모듈 스코프에 두고(번들에서 정의가 보장되도록),
// 컴포넌트에서는 최신 auth를 provider로 주입한다.
type FirebaseIdTokenProvider = ((opts?: { forceRefresh?: boolean }) => Promise<string | null | undefined>) | null;
let _firebaseIdTokenProvider: FirebaseIdTokenProvider = null;

function setFirebaseIdTokenProvider(p: FirebaseIdTokenProvider): void {
	_firebaseIdTokenProvider = p;
}

async function buildFirebaseBearerHeaders(forceRefresh = false): Promise<Record<string, string>> {
	try {
		const t = await _firebaseIdTokenProvider?.({ forceRefresh });
		if (!t) return {};
		return { Authorization: `Bearer ${t}` };
	} catch {
		return {};
	}
}

async function ensureNasAuthHeaders(forceRefresh = false): Promise<Record<string, string> | null> {
	const headers = await buildFirebaseBearerHeaders(forceRefresh);
	if (headers.Authorization) return headers;
	return null;
}

// (호환) 과거/혼합 번들에서 사용하던 이름이 남아도 런타임 에러 없이 동작하게 한다.
async function ensureNasAuthProducts(): Promise<Record<string, string> | null> {
	return await ensureNasAuthHeaders();
}

const HOST_AGENT_LOCAL_ORIGIN = 'http://127.0.0.1:9230';
const HOST_AGENT_BRIDGE_MESSAGE_TYPE = 'erp2-analytics-host-agent-bridge';

// ---------- 공통 타입 ----------

type TrackedProductKeyword = {
	id: number;
	product_url: string | null;
	keyword: string;
	monthly_search_volume?: number | null;
	/**
	 * 리스트 화면(빠른 로딩)용: "오늘" 기준 저장된 순위/변동.
	 * - 화면 진입 시 크롤링/동기화를 돌리지 않고, DB에 저장된 값만 즉시 표시하기 위함.
	 * - 값이 없으면(오늘 미수집) null로 내려오며 UI는 '-'로 표시한다.
	 */
	today_rank?: number | null;
	today_delta?: number | null;
	is_active: boolean;
	created_at: string;
};

type CompetitorProduct = {
	id: number;
	tracked_keyword_id: number;
	name: string;
	match_text: string;
	is_active: boolean;
	created_at: string;
};

type ProductRankPoint = {
	date: string;
	rank: number;
};

type ProductRankSeries = {
	keyword: string;
	series: ProductRankPoint[];
};

type ProductRankHistoryResponse = {
	dates: string[];
	series: ProductRankSeries[];
};

type ComparisonSeries = {
	label: string;
	kind: string;
	series: ProductRankPoint[];
};

type ComparisonHistoryResponse = {
	dates: string[];
	products: ComparisonSeries[];
};

type ProductGroup = {
	id: string;
	/** API/DB 기준 URL(정규화된 base URL) */
	productUrl: string;
	/** 사용자 입력 원본(표시/참고용) */
	displayUrl: string;
	keywords: TrackedProductKeyword[];
};

type ActiveMenu =
	| 'menu1-dashboard'
	| 'menu2-performance'
	| 'menu3-campaign'
	| 'menu4-rank'
	| 'menu5-research'
	| 'menu6-settings'
	| 'menu7-sales'
	| 'menu8-review-qa'
	| 'menu9-gfa';

type SubMenuId =
	| 'ai-home'
	| 'ai-products'
	| 'ai-ads'
	| 'ai-sales'
	| 'ai-reviews'
	| 'ai-qna'
	| 'ai-trends'
	| 'ai-policies'
	| 'ai-actions'
	| 'ai-logs'
	| 'ai-organic-rank'
	| 'ai-organic-rank-trace'
	| 'ai-ads-ops'
	| 'ai-purchase-conv'
	| 'ai-demand-trend'
	| 'ai-sku-policy'
	| 'ads-keywords'
	| 'purchase-keywords'
	| 'sales-dashboard'
	| 'sales-product-detail'
	| 'review-management'
	| 'review-analysis'
	| 'qna-management'
	| 'qna-analysis'
	| 'campaigns-daily'
	| 'adgroups-daily'
	| 'creatives-daily'
	| 'gfa-operating-check'
	| 'gfa-creative-analysis'
	| 'gfa-strategy'
	| 'gfa-raw-analysis'
	| 'search-overview'
	| 'search-tracking'
	| 'research-product'
	| 'research-hashtag'
	| 'research-product-index'
	| 'settings-category-dict'
	| 'settings-seo-rules'
	| 'settings-api'
	| 'settings-ai'
	| 'settings-data-collection'
	| 'settings-menu-sync'
	| 'settings-version'
	| 'settings-erp-users';

type MenuConfig = {
	id: ActiveMenu;
	label: string;
};

type SubMenuConfig = {
	id: SubMenuId;
	label: string;
};

type SubMenuGroupConfig = {
	id: string;
	label: string;
	items: SubMenuId[];
};

const API_BASE =
	(import.meta.env.VITE_ANALYTICS_API_BASE_URL as string | undefined) ?? 'http://localhost:5189';

const ANALYTICS_BASE = '/analytics';

const MENU_LIST: MenuConfig[] = [
	{ id: 'menu1-dashboard', label: 'AI 운영 센터' },
	{ id: 'menu2-performance', label: '키워드(광고/오가닉) 분석' },
	{ id: 'menu3-campaign', label: 'SA 광고분석' },
	{ id: 'menu9-gfa', label: 'GFA 광고분석' },
	{ id: 'menu4-rank', label: '검색·쇼핑 순위 분석' },
	{ id: 'menu7-sales', label: '판매 분석' },
	{ id: 'menu8-review-qa', label: '리뷰 Q&A' },
	{ id: 'menu5-research', label: 'SEO 분석' },
	{ id: 'menu6-settings', label: '설정' },
];

const SUB_MENUS: Record<ActiveMenu, SubMenuConfig[]> = {
	'menu1-dashboard': [
		{ id: 'ai-home', label: '오늘의 실행' },
		{ id: 'ai-products', label: '상품별 운영 판단' },
		{ id: 'ai-ads', label: '광고 운영 판단' },
		{ id: 'ai-sales', label: '판매·전환 판단' },
		{ id: 'ai-reviews', label: '리뷰·VOC 판단' },
		{ id: 'ai-qna', label: 'Q&A 전환장벽 판단' },
		{ id: 'ai-trends', label: '수요·트렌드 판단' },
		{ id: 'ai-policies', label: 'SKU 정책 센터' },
		{ id: 'ai-actions', label: '실행 큐' },
		{ id: 'ai-logs', label: '검증/설명 로그' },
	],
	'menu2-performance': [
		{ id: 'ads-keywords', label: '광고 검색어 분석' },
		{ id: 'purchase-keywords', label: '구매 키워드 분석' },
	],
	'menu7-sales': [{ id: 'sales-dashboard', label: '상품별 판매 현황' }],
	'menu8-review-qa': [
		{ id: 'review-management', label: '리뷰 관리' },
		{ id: 'review-analysis', label: '리뷰 분석' },
		{ id: 'qna-management', label: 'Q&A 관리' },
		{ id: 'qna-analysis', label: 'Q&A 분석' },
	],
	'menu3-campaign': [
		{ id: 'campaigns-daily', label: '캠페인 분석' },
		{ id: 'adgroups-daily', label: '광고 그룹 분석' },
		{ id: 'creatives-daily', label: '소재 분석' },
	],
	'menu9-gfa': [
		{ id: 'gfa-operating-check', label: '운영 체크' },
		{ id: 'gfa-raw-analysis', label: '원본 분석' },
		{ id: 'gfa-creative-analysis', label: '소재 분석' },
		{ id: 'gfa-strategy', label: '전략 도출' },
	],
	'menu4-rank': [
		{ id: 'search-overview', label: '키워드 인사이트' },
		{ id: 'search-tracking', label: '내 상품 추적' },
	],
	'menu5-research': [
		{ id: 'research-product', label: '상품명 SEO' },
		{ id: 'research-hashtag', label: '해시태그 SEO' },
		{ id: 'research-product-index', label: '상품지수분석' },
	],
	'menu6-settings': [
		{ id: 'settings-category-dict', label: '카테고리 사전' },
		{ id: 'settings-seo-rules', label: 'SEO규칙등록' },
		{ id: 'settings-api', label: 'API 세팅' },
		{ id: 'settings-ai', label: 'AI 세팅' },
		{ id: 'settings-data-collection', label: '데이터 수집' },
		{ id: 'settings-menu-sync', label: '메뉴동기화' },
		// ERP UI와 동일하게 “복합명사 띄어쓰기”를 최소화한다.
		{ id: 'settings-version', label: '버전관리' },
		{ id: 'settings-erp-users', label: '사용자관리' },
	],
};

const AI_OPS_SUBMENU_GROUPS: SubMenuGroupConfig[] = [
	{ id: 'situation', label: '상황판', items: ['ai-home'] },
	{
		id: 'analysis',
		label: '판단 생성',
		items: ['ai-products', 'ai-ads', 'ai-sales', 'ai-reviews', 'ai-qna', 'ai-trends'],
	},
	{ id: 'execution', label: '실행', items: ['ai-actions'] },
	{ id: 'verification', label: '검증', items: ['ai-logs'] },
	{ id: 'policy', label: '정책 학습', items: ['ai-policies'] },
];

function getGroupedSubMenus(menuId: ActiveMenu): Array<{ id: string; label: string; items: SubMenuConfig[] }> {
	const subs = SUB_MENUS[menuId] || [];
	if (menuId !== 'menu1-dashboard') {
		return subs.length ? [{ id: `${menuId}-default`, label: '', items: subs }] : [];
	}
	const subMap = new Map(subs.map((sub) => [sub.id, sub] as const));
	return AI_OPS_SUBMENU_GROUPS.map((group) => ({
		id: group.id,
		label: group.label,
		items: group.items.map((subId) => subMap.get(subId)).filter(Boolean) as SubMenuConfig[],
	})).filter((group) => group.items.length > 0);
}

type SubRoute = {
	menu: ActiveMenu;
	sub: SubMenuId;
	label: string;
	path: string;
};

function subPath(sub: SubMenuId): string {
	switch (sub) {
		case 'ai-home':
			return `${ANALYTICS_BASE}/ai/home`;
		case 'ai-products':
			return `${ANALYTICS_BASE}/ai/products`;
		case 'ai-ads':
			return `${ANALYTICS_BASE}/ai/ads`;
		case 'ai-sales':
			return `${ANALYTICS_BASE}/ai/sales`;
		case 'ai-reviews':
			return `${ANALYTICS_BASE}/ai/reviews`;
		case 'ai-qna':
			return `${ANALYTICS_BASE}/ai/qna`;
		case 'ai-trends':
			return `${ANALYTICS_BASE}/ai/trends`;
		case 'ai-policies':
			return `${ANALYTICS_BASE}/ai/policies`;
		case 'ai-actions':
			return `${ANALYTICS_BASE}/ai/actions`;
		case 'ai-logs':
			return `${ANALYTICS_BASE}/ai/logs`;
		case 'ai-organic-rank':
			return `${ANALYTICS_BASE}/ai/organic-rank`;
		case 'ai-organic-rank-trace':
			return `${ANALYTICS_BASE}/ai/organic-rank/trace`;
		case 'ai-ads-ops':
			return `${ANALYTICS_BASE}/ai/ads-ops`;
		case 'ai-purchase-conv':
			return `${ANALYTICS_BASE}/ai/purchase-conv`;
		case 'ai-demand-trend':
			return `${ANALYTICS_BASE}/ai/demand-trend`;
		case 'ai-sku-policy':
			return `${ANALYTICS_BASE}/ai/sku-policy`;
		case 'ads-keywords':
			return `${ANALYTICS_BASE}/performance/ads-keywords`;
		case 'purchase-keywords':
			return `${ANALYTICS_BASE}/performance/purchase-keywords`;
		case 'sales-dashboard':
			return `${ANALYTICS_BASE}/sales/dashboard`;
		case 'sales-product-detail':
			// product_id는 query param으로 전달한다.
			return `${ANALYTICS_BASE}/sales/product`;
		case 'review-management':
			return `${ANALYTICS_BASE}/reviews/review-management`;
		case 'review-analysis':
			return `${ANALYTICS_BASE}/reviews/review-analysis`;
		case 'qna-management':
			return `${ANALYTICS_BASE}/reviews/qna`;
		case 'qna-analysis':
			return `${ANALYTICS_BASE}/reviews/qna-analysis`;
		case 'campaigns-daily':
			return `${ANALYTICS_BASE}/campaign/campaigns`;
		case 'adgroups-daily':
			return `${ANALYTICS_BASE}/campaign/adgroups`;
		case 'creatives-daily':
			return `${ANALYTICS_BASE}/campaign/creatives`;
		case 'gfa-operating-check':
			return `${ANALYTICS_BASE}/gfa/operating-check`;
		case 'gfa-creative-analysis':
			return `${ANALYTICS_BASE}/gfa/creative-analysis`;
		case 'gfa-strategy':
			return `${ANALYTICS_BASE}/gfa/strategy`;
		case 'gfa-raw-analysis':
			return `${ANALYTICS_BASE}/gfa/raw-analysis`;
		case 'search-overview':
			return `${ANALYTICS_BASE}/rank/insights`;
		case 'search-tracking':
			return `${ANALYTICS_BASE}/rank/tracking`;
		case 'research-product':
			return `${ANALYTICS_BASE}/seo/product`;
		case 'research-hashtag':
			return `${ANALYTICS_BASE}/seo/hashtag`;
		case 'research-product-index':
			return `${ANALYTICS_BASE}/seo/product-index`;
		case 'settings-category-dict':
			return `${ANALYTICS_BASE}/settings/category-dict`;
		case 'settings-seo-rules':
			return `${ANALYTICS_BASE}/settings/seo-rules`;
		case 'settings-api':
			return `${ANALYTICS_BASE}/settings/api`;
		case 'settings-ai':
			return `${ANALYTICS_BASE}/settings/ai`;
		case 'settings-data-collection':
			return `${ANALYTICS_BASE}/settings/data-collection`;
		case 'settings-menu-sync':
			return `${ANALYTICS_BASE}/settings/menu-sync`;
		case 'settings-version':
			return `${ANALYTICS_BASE}/settings/version`;
		case 'settings-erp-users':
			// legacy: 예전 화면(ERP iframe)에서 “사용자관리”로 전환
			return `${ANALYTICS_BASE}/settings/users`;
		default:
			return `${ANALYTICS_BASE}`;
	}
}

const SUB_ROUTE_DEFS: SubRoute[] = [
	{ menu: 'menu1-dashboard', sub: 'ai-home', label: '오늘의 실행', path: subPath('ai-home') },
	{ menu: 'menu1-dashboard', sub: 'ai-products', label: '상품별 운영 판단', path: subPath('ai-products') },
	{ menu: 'menu1-dashboard', sub: 'ai-ads', label: '광고 운영 판단', path: subPath('ai-ads') },
	{ menu: 'menu1-dashboard', sub: 'ai-sales', label: '판매·전환 판단', path: subPath('ai-sales') },
	{ menu: 'menu1-dashboard', sub: 'ai-reviews', label: '리뷰·VOC 판단', path: subPath('ai-reviews') },
	{ menu: 'menu1-dashboard', sub: 'ai-qna', label: 'Q&A 전환장벽 판단', path: subPath('ai-qna') },
	{ menu: 'menu1-dashboard', sub: 'ai-trends', label: '수요·트렌드 판단', path: subPath('ai-trends') },
	{ menu: 'menu1-dashboard', sub: 'ai-policies', label: 'SKU 정책 센터', path: subPath('ai-policies') },
	{ menu: 'menu1-dashboard', sub: 'ai-actions', label: '실행 큐', path: subPath('ai-actions') },
	{ menu: 'menu1-dashboard', sub: 'ai-logs', label: '검증/설명 로그', path: subPath('ai-logs') },
	{ menu: 'menu2-performance', sub: 'ads-keywords', label: '광고 검색어 분석', path: subPath('ads-keywords') },
	{ menu: 'menu2-performance', sub: 'purchase-keywords', label: '구매 키워드 분석', path: subPath('purchase-keywords') },
	{ menu: 'menu7-sales', sub: 'sales-dashboard', label: '상품별 판매 현황', path: subPath('sales-dashboard') },
	{ menu: 'menu7-sales', sub: 'sales-product-detail', label: '상품 판매 상세', path: subPath('sales-product-detail') },
	{ menu: 'menu8-review-qa', sub: 'review-management', label: '리뷰 관리', path: subPath('review-management') },
	{ menu: 'menu8-review-qa', sub: 'review-analysis', label: '리뷰 분석', path: subPath('review-analysis') },
	{ menu: 'menu8-review-qa', sub: 'qna-management', label: 'Q&A 관리', path: subPath('qna-management') },
	{ menu: 'menu8-review-qa', sub: 'qna-analysis', label: 'Q&A 분석', path: subPath('qna-analysis') },
	{ menu: 'menu3-campaign', sub: 'campaigns-daily', label: '캠페인 분석', path: subPath('campaigns-daily') },
	{ menu: 'menu3-campaign', sub: 'adgroups-daily', label: '광고 그룹 분석', path: subPath('adgroups-daily') },
	{ menu: 'menu3-campaign', sub: 'creatives-daily', label: '소재 분석', path: subPath('creatives-daily') },
	{ menu: 'menu9-gfa', sub: 'gfa-operating-check', label: '운영 체크', path: subPath('gfa-operating-check') },
	{ menu: 'menu9-gfa', sub: 'gfa-raw-analysis', label: '원본 분석', path: subPath('gfa-raw-analysis') },
	{ menu: 'menu9-gfa', sub: 'gfa-creative-analysis', label: '소재 분석', path: subPath('gfa-creative-analysis') },
	{ menu: 'menu9-gfa', sub: 'gfa-strategy', label: '전략 도출', path: subPath('gfa-strategy') },
	{ menu: 'menu4-rank', sub: 'search-overview', label: '키워드 인사이트', path: subPath('search-overview') },
	{ menu: 'menu4-rank', sub: 'search-tracking', label: '내 상품 추적', path: subPath('search-tracking') },
	{ menu: 'menu5-research', sub: 'research-product', label: '상품명 SEO', path: subPath('research-product') },
	{ menu: 'menu5-research', sub: 'research-hashtag', label: '해시태그 SEO', path: subPath('research-hashtag') },
	{ menu: 'menu5-research', sub: 'research-product-index', label: '상품지수분석', path: subPath('research-product-index') },
	{ menu: 'menu6-settings', sub: 'settings-category-dict', label: '카테고리 사전', path: subPath('settings-category-dict') },
	{ menu: 'menu6-settings', sub: 'settings-seo-rules', label: 'SEO규칙등록', path: subPath('settings-seo-rules') },
	{ menu: 'menu6-settings', sub: 'settings-api', label: 'API 세팅', path: subPath('settings-api') },
	{ menu: 'menu6-settings', sub: 'settings-ai', label: 'AI 세팅', path: subPath('settings-ai') },
	{ menu: 'menu6-settings', sub: 'settings-data-collection', label: '데이터 수집', path: subPath('settings-data-collection') },
	{ menu: 'menu6-settings', sub: 'settings-menu-sync', label: '메뉴동기화', path: subPath('settings-menu-sync') },
	{ menu: 'menu6-settings', sub: 'settings-version', label: '버전관리', path: subPath('settings-version') },
	{ menu: 'menu6-settings', sub: 'settings-erp-users', label: '사용자관리', path: subPath('settings-erp-users') },
];

function resolveActive(pathname: string): { activeMenu: ActiveMenu; activeSub: SubMenuId } {
	if (pathname === subPath('ai-organic-rank')) return { activeMenu: 'menu1-dashboard', activeSub: 'ai-products' };
	if (pathname === subPath('ai-organic-rank-trace')) return { activeMenu: 'menu1-dashboard', activeSub: 'ai-logs' };
	if (
		matchPath({ path: `${ANALYTICS_BASE}/gfa/campaigns`, end: true }, pathname) ||
		matchPath({ path: `${ANALYTICS_BASE}/gfa/adgroups`, end: true }, pathname) ||
		matchPath({ path: `${ANALYTICS_BASE}/gfa/creatives`, end: true }, pathname)
	) {
		return { activeMenu: 'menu9-gfa', activeSub: 'gfa-operating-check' };
	}
	for (const r of SUB_ROUTE_DEFS) {
		if (matchPath({ path: r.path, end: true }, pathname)) return { activeMenu: r.menu, activeSub: r.sub };
	}
	// legacy(구 URL) 대응: /search-tracking, /search-overview 등
	const legacy = pathname.replace(/^\//, '');
	if (legacy === 'search-tracking') return { activeMenu: 'menu4-rank', activeSub: 'search-tracking' };
	if (legacy === 'search-overview') return { activeMenu: 'menu4-rank', activeSub: 'search-overview' };
	if (legacy === 'research-keyword') return { activeMenu: 'menu5-research', activeSub: 'research-product' };
	if (legacy === 'analytics/settings' || legacy === 'analytics/settings/') return { activeMenu: 'menu6-settings', activeSub: 'settings-category-dict' };
	// sales detail(query 기반)도 판매 분석 메뉴로 유지
	if (legacy.startsWith('analytics/sales/product')) return { activeMenu: 'menu7-sales', activeSub: 'sales-dashboard' };
	return { activeMenu: 'menu4-rank', activeSub: 'search-tracking' };
}

function IconSvg(props: { children: React.ReactNode }): JSX.Element {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{props.children}
		</svg>
	);
}

function SubIconSvg(props: { children: React.ReactNode }): JSX.Element {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{props.children}
		</svg>
	);
}

function getMenuIcon(menuId: ActiveMenu): React.ReactNode {
	switch (menuId) {
		case 'menu1-dashboard':
			return (
				<IconSvg>
					<path d="M4 20V10" />
					<path d="M10 20V4" />
					<path d="M16 20v-8" />
					<path d="M22 20V8" />
				</IconSvg>
			);
		case 'menu2-performance':
			return (
				<IconSvg>
					<circle cx="11" cy="11" r="7" />
					<path d="M21 21l-4.3-4.3" />
					<path d="M8 12l2-2 2 2 2-4" />
				</IconSvg>
			);
		case 'menu3-campaign':
		case 'menu9-gfa':
			return (
				<IconSvg>
					<path d="M3 11v2" />
					<path d="M7 9v6" />
					<path d="M11 6v12" />
					<path d="M11 8l10-3v14l-10-3" />
				</IconSvg>
			);
		case 'menu4-rank':
			return (
				<IconSvg>
					<path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" />
					<path d="M6 4v3a4 4 0 0 1-4 4V8a4 4 0 0 0 4-4Z" />
					<path d="M18 4a4 4 0 0 0 4 4v3a4 4 0 0 1-4-4V4Z" />
					<path d="M12 11v4" />
					<path d="M9 19h6" />
					<path d="M10 15h4" />
				</IconSvg>
			);
		case 'menu5-research':
			return (
				<IconSvg>
					<path d="M12 2a7 7 0 0 0-4 12c.5.5 1 1.4 1 2v1h6v-1c0-.6.5-1.5 1-2A7 7 0 0 0 12 2Z" />
					<path d="M9 21h6" />
					<path d="M10 18h4" />
				</IconSvg>
			);
		case 'menu6-settings':
			return (
				<IconSvg>
					<path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
					<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.1-.1a1.7 1.7 0 0 0-2 .3 8 8 0 0 1-1.9 1.1 1.7 1.7 0 0 0-1.1 1.6V23h-3v-.2a1.7 1.7 0 0 0-1.1-1.6 8 8 0 0 1-1.9-1.1 1.7 1.7 0 0 0-2-.3l-.1.1L4.3 17l.1-.1A1.7 1.7 0 0 0 4.7 15a8 8 0 0 1 0-2 1.7 1.7 0 0 0-.3-1.9l-.1-.1L5.9 8.2l.1.1a1.7 1.7 0 0 0 2-.3 8 8 0 0 1 1.9-1.1A1.7 1.7 0 0 0 11 5.3V5h3v.3a1.7 1.7 0 0 0 1.1 1.6 8 8 0 0 1 1.9 1.1 1.7 1.7 0 0 0 2 .3l.1-.1 1.6 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 8 8 0 0 1 .1 2Z" />
				</IconSvg>
			);
		case 'menu7-sales':
			return (
				<IconSvg>
					<path d="M4 19V5" />
					<path d="M4 19h16" />
					<path d="M7 15h2" />
					<path d="M11 12h2" />
					<path d="M15 9h2" />
				</IconSvg>
			);
		case 'menu8-review-qa':
			return (
				<IconSvg>
					<path d="M6 8h12" />
					<path d="M6 12h7" />
					<path d="M6 16h5" />
					<path d="M18 17l2 2 3-3" />
					<path d="M4 4h16v16H4z" />
				</IconSvg>
			);
		default:
			return (
				<IconSvg>
					<circle cx="12" cy="12" r="1" />
				</IconSvg>
			);
	}
}

function getSubMenuIcon(sub: SubMenuId): React.ReactNode {
	switch (sub) {
		case 'ai-organic-rank':
			return (
				<SubIconSvg>
					<path d="M4 19V5" />
					<path d="M4 19h16" />
					<path d="M7 14l3-3 3 2 4-6" />
				</SubIconSvg>
			);
		case 'ai-organic-rank-trace':
			return (
				<SubIconSvg>
					<path d="M8 3h8" />
					<path d="M12 3v4" />
					<path d="M6 7h12" />
					<path d="M8 7v4" />
					<path d="M16 7v4" />
					<path d="M6 11h12" />
				</SubIconSvg>
			);
		case 'purchase-keywords':
			return (
				<SubIconSvg>
					<path d="M7 7h10" />
					<path d="M7 12h10" />
					<path d="M7 17h10" />
					<path d="M4 5v14" />
					<path d="M20 5v14" />
				</SubIconSvg>
			);
		case 'sales-dashboard':
			return (
				<SubIconSvg>
					<path d="M4 19V5" />
					<path d="M4 19h16" />
					<path d="M8 16v-4" />
					<path d="M12 16v-7" />
					<path d="M16 16v-10" />
				</SubIconSvg>
			);
		case 'campaigns-daily':
		case 'gfa-operating-check':
			return (
				<SubIconSvg>
					<path d="M4 4h16v12H4z" />
					<path d="M8 20h8" />
					<path d="M12 16v4" />
				</SubIconSvg>
			);
		case 'adgroups-daily':
		case 'gfa-strategy':
		case 'gfa-raw-analysis':
			return (
				<SubIconSvg>
					<path d="M7 7h10" />
					<path d="M7 12h10" />
					<path d="M7 17h10" />
					<path d="M4 5v14" />
					<path d="M20 5v14" />
				</SubIconSvg>
			);
		case 'creatives-daily':
		case 'gfa-creative-analysis':
			return (
				<SubIconSvg>
					<rect x="4" y="4" width="16" height="16" rx="2" />
					<path d="M8 14l2-2 2 2 4-4" />
					<path d="M8 10h.01" />
				</SubIconSvg>
			);
		case 'search-overview':
			return (
				<SubIconSvg>
					<path d="M3 17l6-6 4 4 8-8" />
					<path d="M21 7v6h-6" />
				</SubIconSvg>
			);
		case 'search-tracking':
			return (
				<SubIconSvg>
					<path d="M6 3h12" />
					<path d="M6 8h12" />
					<path d="M6 13h12" />
					<path d="M6 18h12" />
				</SubIconSvg>
			);
		case 'research-product':
			return (
				<SubIconSvg>
					<path d="M12 2a7 7 0 0 0-4 12c.5.5 1 1.4 1 2v1h6v-1c0-.6.5-1.5 1-2A7 7 0 0 0 12 2Z" />
					<path d="M9 21h6" />
				</SubIconSvg>
			);
		case 'research-hashtag':
			return (
				<SubIconSvg>
					<path d="M4 10h16" />
					<path d="M4 14h16" />
					<path d="M10 4l-2 16" />
					<path d="M16 4l-2 16" />
				</SubIconSvg>
			);
		case 'research-product-index':
			return (
				<SubIconSvg>
					<path d="M4 19V5" />
					<path d="M20 19V5" />
					<path d="M7 16v-3" />
					<path d="M12 16v-6" />
					<path d="M17 16v-9" />
				</SubIconSvg>
			);
		case 'settings-category-dict':
		case 'settings-seo-rules':
		case 'settings-api':
		case 'settings-ai':
		case 'settings-data-collection':
		case 'settings-menu-sync':
			return (
				<SubIconSvg>
					<path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7.5Z" />
					<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.1-.1a1.7 1.7 0 0 0-2 .3 8 8 0 0 1-1.9 1.1 1.7 1.7 0 0 0-1.1 1.6V23h-3v-.2a1.7 1.7 0 0 0-1.1-1.6 8 8 0 0 1-1.9-1.1 1.7 1.7 0 0 0-2-.3l-.1.1L4.3 17l.1-.1A1.7 1.7 0 0 0 4.7 15a8 8 0 0 1 0-2 1.7 1.7 0 0 0-.3-1.9l-.1-.1L5.9 8.2l.1.1a1.7 1.7 0 0 0 2-.3 8 8 0 0 1 1.9-1.1A1.7 1.7 0 0 0 11 5.3V5h3v.3a1.7 1.7 0 0 0 1.1 1.6 8 8 0 0 1 1.9 1.1 1.7 1.7 0 0 0 2 .3l.1-.1 1.6 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 8 8 0 0 1 .1 2Z" />
				</SubIconSvg>
			);
		default:
			return (
				<SubIconSvg>
					<circle cx="12" cy="12" r="1" />
				</SubIconSvg>
			);
	}
}

// ---------- 유틸 ----------

function buildProductGroups(rows: TrackedProductKeyword[]): ProductGroup[] {
	// 동일 상품 URL이 스킴/쿼리/해시 등으로 변형되어 저장되는 경우가 있어,
	// 그룹핑은 "정규화된 URL" 기준으로 수행한다.
	const canonicalize = (input: string): string => {
		const s0 = String(input || '').trim();
		if (!s0) return '';
		// smartstore 스킴 누락 보정
		const s = s0.toLowerCase().startsWith('smartstore.naver.com/') ? `https://${s0}` : s0;
		try {
			const u = new URL(s);
			u.hash = '';
			// smartstore는 query/hash가 달라도 동일 상품으로 취급
			if (String(u.host || '').toLowerCase().includes('smartstore.naver.com')) {
				return `${u.protocol}//${u.host}${u.pathname}`.trim();
			}
			return u.toString();
		} catch {
			return s.replace(/#.*$/, '');
		}
	};

	const byUrl: Record<string, TrackedProductKeyword[]> = {};
	const labelByUrl: Record<string, string> = {};
	for (const row of rows) {
		const raw = (row.product_url || 'N/A').trim();
		const key = canonicalize(raw) || raw;
		if (!byUrl[key]) {
			byUrl[key] = [];
			labelByUrl[key] = raw;
		}
		byUrl[key].push(row);
	}
	return Object.entries(byUrl).map(([key, keywords]) => ({
		id: key,
		productUrl: key,
		displayUrl: labelByUrl[key] || key,
		keywords: keywords.sort((a, b) => a.keyword.localeCompare(b.keyword)),
	}));
}

// ---------- 메인 AppShell ----------

export const AppShell: React.FC = () => {
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const navigate = useNavigate();
	const location = useLocation();
	const { activeMenu, activeSub } = useMemo(() => resolveActive(location.pathname), [location.pathname]);
	const [expandedMenu, setExpandedMenu] = useState<ActiveMenu | null>(activeMenu);
	const auth = useMaybeAuth();
	const authedEmail = auth?.user?.email ?? null;
	const [roleLevel, setRoleLevel] = useState<string>('');

	// 최신 auth 인스턴스를 모듈 스코프 provider로 주입한다.
	// - 클릭 이벤트가 effect보다 빨리 발생하더라도, provider가 null이면 ensureNasAuthHeaders가 null을 반환하므로
	//   런타임 에러 없이 "로그인 필요" UX로 안전하게 수렴한다.
	useEffect(() => {
		setFirebaseIdTokenProvider(async (opts?: { forceRefresh?: boolean }) => {
			try {
				return await auth?.getIdToken({ forceRefresh: Boolean(opts?.forceRefresh) });
			} catch {
				return null;
			}
		});
		return () => setFirebaseIdTokenProvider(null);
	}, [auth]);

	const activeMenuLabel = useMemo(() => {
		return MENU_LIST.find((m) => m.id === activeMenu)?.label ?? '';
	}, [activeMenu]);

	const activeSubLabel = useMemo(() => {
		const subs = SUB_MENUS[activeMenu] || [];
		return subs.find((s) => s.id === activeSub)?.label ?? '';
	}, [activeMenu, activeSub]);

	useEffect(() => {
		setExpandedMenu(activeMenu);
	}, [activeMenu]);

	// 브라우저 탭 제목: 현재 위치(메인/서브) 반영
	useEffect(() => {
		const base = '검색·광고 분석';
		const parts = [base];
		if (activeMenuLabel) parts.push(activeMenuLabel);
		if (activeSubLabel) parts.push(activeSubLabel);
		try {
			document.title = parts.join(' · ');
		} catch {
			// ignore
		}
	}, [activeMenuLabel, activeSubLabel]);

	// 로그인 사용자/권한 표시(헤더 우측)
	useEffect(() => {
		let alive = true;
		(async () => {
			if (!auth?.user) {
				if (alive) setRoleLevel('');
				return;
			}
			try {
				const t = await auth.getIdToken({ forceRefresh: false });
				const payload = t ? decodeJwtPayload(t) : null;
				const rs = normalizeAnalyticsRolesFromClaims({ role: payload?.role, roles: payload?.roles });
				const r = primaryAnalyticsRole(rs);
				if (!alive) return;
				setRoleLevel(r);
			} catch {
				if (!alive) return;
				setRoleLevel('');
			}
		})();
		return () => {
			alive = false;
		};
	}, [auth, auth?.user?.uid]);

	// ERP 스타일: 사이드바가 접힌 상태에서 1차 메뉴 호버 시 2차 메뉴 팝업
	const [hoveredMenu, setHoveredMenu] = useState<ActiveMenu | null>(null);
	const [hoverPos, setHoverPos] = useState<{ left: number; top: number } | null>(null);
	const hoverMenuRef = useRef<HTMLDivElement | null>(null);
	const closeTimerRef = useRef<number | null>(null);

	const closeHoverMenu = () => {
		if (closeTimerRef.current) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
		setHoveredMenu(null);
		setHoverPos(null);
	};

	const scheduleCloseHoverMenu = (delayMs = 220) => {
		if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
		closeTimerRef.current = window.setTimeout(() => {
			closeHoverMenu();
		}, delayMs);
	};

	const openHoverMenu = (menuId: ActiveMenu, anchorEl: HTMLElement) => {
		if (!sidebarCollapsed) return;
		if (closeTimerRef.current) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
		const rect = anchorEl.getBoundingClientRect();
		const spacing = 10;
		const left = rect.right + spacing;
		// 화면 아래로 삐져나가지 않게 최소 보정
		const top = Math.max(8, Math.min(rect.top, window.innerHeight - 240));
		setHoveredMenu(menuId);
		setHoverPos({ left, top });
	};

	const handleMenuClick = (menuId: ActiveMenu, anchorEl?: HTMLElement) => {
		if (sidebarCollapsed) {
			if (anchorEl) openHoverMenu(menuId, anchorEl);
			return;
		}
		setExpandedMenu((prev) => (prev === menuId ? null : menuId));
	};

	const elementForSub = (sub: SubMenuId): React.ReactNode => {
		switch (sub) {
			case 'ai-home':
				return <AiOpsHomeView apiBaseUrl={API_BASE} />;
			case 'ai-products':
				return <AiOpsProductsView apiBaseUrl={API_BASE} />;
			case 'ai-ads':
				return <AiOpsAdsView apiBaseUrl={API_BASE} />;
			case 'ai-sales':
				return <AiOpsSalesView apiBaseUrl={API_BASE} />;
			case 'ai-reviews':
				return <AiOpsReviewsView apiBaseUrl={API_BASE} />;
			case 'ai-qna':
				return <AiOpsQnaView apiBaseUrl={API_BASE} />;
			case 'ai-trends':
				return <AiOpsTrendsView apiBaseUrl={API_BASE} />;
			case 'ai-policies':
				return <AiOpsPoliciesView apiBaseUrl={API_BASE} />;
			case 'ai-actions':
				return <AiOpsActionsView apiBaseUrl={API_BASE} />;
			case 'ai-logs':
				return <AiOpsLogsView apiBaseUrl={API_BASE} />;
			case 'ai-organic-rank':
				return <AiOrganicRankSection />;
			case 'ai-organic-rank-trace':
				return <AiOrganicRankTraceSection />;
			case 'ai-ads-ops':
				return <AiAdsOpsSection />;
			case 'ai-purchase-conv':
				return <AiPurchaseConvSection />;
			case 'ai-demand-trend':
				return <AiDemandTrendSection />;
			case 'ai-sku-policy':
				return <AiSkuPolicySection />;
			case 'ads-keywords':
				return <AdsKeywordsPerformanceSection />;
			case 'purchase-keywords':
				return <PurchaseKeywordsSection />;
			case 'sales-dashboard':
				return <SalesAnalysisView apiBaseUrl={API_BASE} />;
			case 'sales-product-detail':
				// 상세 화면은 메뉴에서 직접 진입하지 않지만(상품 클릭), 라우팅은 유지한다.
				return <SalesProductDetailView apiBaseUrl={API_BASE} />;
			case 'review-management':
				return <ReviewAnalysisView apiBaseUrl={API_BASE} />;
			case 'review-analysis':
				return <ReviewAnalysisOverviewView apiBaseUrl={API_BASE} />;
			case 'qna-management':
				return <QnaManagementView apiBaseUrl={API_BASE} />;
			case 'qna-analysis':
				return <QnaAnalysisView apiBaseUrl={API_BASE} />;
			case 'campaigns-daily':
				return <CampaignDailySection />;
			case 'adgroups-daily':
				return <AdgroupDailySection />;
		case 'creatives-daily':
			return <CreativesDailySection />;
			case 'gfa-operating-check':
				return <GfaOperatingCheckSection />;
			case 'gfa-creative-analysis':
				return <GfaCreativeAnalysisSection />;
			case 'gfa-strategy':
				return <GfaStrategySection />;
			case 'gfa-raw-analysis':
				return <GfaRawAnalysisSection />;
			case 'search-overview':
				// (원복) 메뉴 4-1: 키워드 인사이트 화면
				return <KeywordInsightsView apiBaseUrl={API_BASE} />;
			case 'search-tracking':
				return <SearchRankTrackingSection apiBaseUrl={API_BASE} />;
			case 'research-product':
				return <SeoOptimizerView apiBaseUrl={API_BASE} />;
			case 'research-hashtag':
				return <HashtagSeoView apiBaseUrl={API_BASE} />;
			case 'research-product-index':
				return <ProductIndexAnalysisView apiBaseUrl={API_BASE} />;
			case 'settings-category-dict':
				return <SeoCategoryDictionarySettingsView apiBaseUrl={API_BASE} />;
			case 'settings-seo-rules':
				return <SeoRulesSettingsView />;
			case 'settings-api':
				return <ApiSettingsView apiBaseUrl={API_BASE} />;
			case 'settings-ai':
				return <AiSettingsView apiBaseUrl={API_BASE} />;
			case 'settings-data-collection':
				return <DataCollectionView apiBaseUrl={API_BASE} />;
			case 'settings-menu-sync':
				return <MenuSyncView apiBaseUrl={API_BASE} />;
			case 'settings-version':
				return <VersionManagementView apiBaseUrl={API_BASE} />;
			case 'settings-erp-users':
				return <UserManagementView apiBaseUrl={API_BASE} />;
			default:
				return null;
		}
	};

	return (
		<div className="app-shell-root">
			{/* 사이드바 */}
			<aside
				className={`app-sidebar${sidebarCollapsed ? ' app-sidebar-collapsed' : ''}`}
			>
				{/* 1차 메뉴(아이콘 레일) */}
				<div className="sidebar-rail">
					<div className="sidebar-rail-top">
						<div className="sidebar-logo-badge" title="Analytics">
							AD
						</div>
						<button
							type="button"
							onClick={() => setSidebarCollapsed((v) => !v)}
							className="btn-ghost"
							aria-label="toggle-sidebar"
							title={sidebarCollapsed ? '메뉴 펼치기' : '메뉴 숨기기'}
							style={{ width: 40, height: 32, padding: 0 }}
						>
							<span style={{ fontSize: 11 }}>{sidebarCollapsed ? '≫' : '≪'}</span>
						</button>
					</div>

					<div className="sidebar-rail-menu" role="navigation" aria-label="메인 메뉴">
						{MENU_LIST.map((menu) => {
							const isActiveMain = menu.id === activeMenu;
							return (
								<button
									key={menu.id}
									type="button"
									aria-label={menu.label}
									className={`rail-item${isActiveMain ? ' active' : ''}`}
									data-menu-id={menu.id}
									onClick={(e) => handleMenuClick(menu.id, e.currentTarget)}
									onMouseEnter={(e) => {
										if (!sidebarCollapsed) return;
										openHoverMenu(menu.id, e.currentTarget);
									}}
									onMouseLeave={(e) => {
										if (!sidebarCollapsed) return;
										const rtAny = e.relatedTarget as unknown;
										const rt = rtAny instanceof Node ? rtAny : null;
										if (rt && hoverMenuRef.current && hoverMenuRef.current.contains(rt)) return;
										scheduleCloseHoverMenu();
									}}
								>
									{getMenuIcon(menu.id)}
								</button>
							);
						})}
					</div>
				</div>

				{/* 2차 메뉴(패널): 펼친 상태에서만 */}
				{!sidebarCollapsed && (
					<div className="sidebar-panel">
						<div className="sidebar-panel-header">
							<div className="sidebar-panel-title">
								<div className="kicker">Analytics</div>
								<div className="title">검색·광고 분석</div>
							</div>
						</div>

						<div className="sidebar-panel-menu" role="navigation" aria-label="서브 메뉴">
							{MENU_LIST.map((menu) => {
								const subs = SUB_MENUS[menu.id] || [];
								const groupedSubs = getGroupedSubMenus(menu.id);
								if (subs.length === 0) return null;
								const isExpanded = expandedMenu === menu.id;
								const groupId = `sidebar-group-${menu.id}`;
								return (
									<div key={menu.id} className="panel-group">
										<button
											type="button"
											className={`panel-group-title panel-group-toggle${isExpanded ? ' active' : ''}`}
											onClick={() => setExpandedMenu((prev) => (prev === menu.id ? null : menu.id))}
											aria-expanded={isExpanded}
											aria-controls={groupId}
											data-testid={`sidebar-group-toggle-${menu.id}`}
										>
											<span>{menu.label}</span>
											<span className={`panel-group-caret${isExpanded ? ' expanded' : ''}`} aria-hidden="true">▾</span>
										</button>
										<div
											id={groupId}
											className={`panel-group-items${isExpanded ? '' : ' panel-group-items-collapsed'}`}
											hidden={!isExpanded}
										>
											{groupedSubs.map((subGroup) => (
												<div key={`${menu.id}:${subGroup.id}`} style={{ display: 'grid', gap: 6 }}>
													{subGroup.label ? (
														<div
															data-testid={`sidebar-subgroup-${menu.id}-${subGroup.id}`}
															style={{
																padding: '10px 12px 2px',
																fontSize: 11,
																fontWeight: 900,
																letterSpacing: '0.04em',
																color: '#94a3b8',
																textTransform: 'uppercase',
															}}
														>
															{subGroup.label}
														</div>
													) : null}
													{subGroup.items.map((sub) => {
														const isActive = menu.id === activeMenu && sub.id === activeSub;
														return (
															<button
																key={sub.id}
																type="button"
																className={`panel-subitem${isActive ? ' active' : ''}`}
																onClick={() => navigate(subPath(sub.id))}
															>
																<span className="panel-subitem-icon">{getSubMenuIcon(sub.id)}</span>
																{sub.label}
															</button>
														);
													})}
												</div>
											))}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</aside>

			{/* 접힘 상태 호버 메뉴 팝업 */}
			{sidebarCollapsed && hoveredMenu && hoverPos && (
				<div
					ref={hoverMenuRef}
					className="app-hover-menu"
					style={{ left: hoverPos.left, top: hoverPos.top }}
					onMouseEnter={() => {
						if (closeTimerRef.current) {
							window.clearTimeout(closeTimerRef.current);
							closeTimerRef.current = null;
						}
					}}
					onMouseLeave={() => {
						scheduleCloseHoverMenu(180);
					}}
				>
					<div className="app-hover-menu-header">
						<span style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
							{getMenuIcon(hoveredMenu)}
						</span>
						<span>{MENU_LIST.find((m) => m.id === hoveredMenu)?.label ?? ''}</span>
					</div>
					<div className="app-hover-menu-body">
						{getGroupedSubMenus(hoveredMenu).map((subGroup) => (
							<div key={`${hoveredMenu}:${subGroup.id}`} style={{ display: 'grid', gap: 4 }}>
								{subGroup.label ? (
									<div
										style={{
											padding: '8px 10px 2px',
											fontSize: 11,
											fontWeight: 900,
											letterSpacing: '0.04em',
											color: '#94a3b8',
											textTransform: 'uppercase',
										}}
									>
										{subGroup.label}
									</div>
								) : null}
								{subGroup.items.map((sub) => {
									const isActive = hoveredMenu === activeMenu && sub.id === activeSub;
									return (
										<button
											key={sub.id}
											type="button"
											className={`app-hover-menu-item${isActive ? ' active' : ''}`}
											onClick={() => {
												navigate(subPath(sub.id));
												closeHoverMenu();
											}}
										>
											<span className="app-hover-menu-item-icon">{getSubMenuIcon(sub.id)}</span>
											{sub.label}
										</button>
									);
								})}
							</div>
						))}
					</div>
				</div>
			)}

			{/* 본문 영역 */}
			<main className="app-main">
				{/* 상단 헤더 */}
				<header className="app-header">
					<div className="app-header-left" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
						<h1 className="app-header-title">
							{activeMenuLabel || '검색·광고 분석'}
						</h1>
						{activeSubLabel ? (
							<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 800, whiteSpace: 'nowrap' }}>
								<span style={{ color: '#64748b', fontWeight: 900 }}>{'/'}</span> {activeSubLabel}
							</div>
						) : null}
					</div>
					<div className="app-header-right">
						<div style={{ fontSize: 11, color: '#94a3b8' }}>Analytics API: {API_BASE}</div>
						<div style={{ width: 1, height: 14, background: 'rgba(148,163,184,0.18)' }} />
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 900 }}>로그인</span>
							<span style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 900 }}>
								{authedEmail || '-'}
							</span>
							<span
								className={['role-chip', appShellAnalyticsRoleChipClass(roleLevel)].join(' ')}
							>
								{labelAnalyticsRole(roleLevel)}
							</span>
							{auth?.user ? (
								<button
									type="button"
									className="btn-ghost"
									onClick={async () => {
										try {
											await auth.signOut();
										} catch {
											// ignore
										}
									}}
								>
									로그아웃
								</button>
							) : (
								<button type="button" className="btn-ghost" onClick={() => navigate('/login')}>
									로그인
								</button>
							)}
						</div>
					</div>
				</header>

				{/* 컨텐츠 */}
				<section className="app-content">
					<Suspense fallback={<RouteLoadingFallback />}>
						<Routes>
						{/* 기본 진입 */}
						<Route path="/" element={<Navigate to={subPath('search-tracking')} replace />} />
						<Route path={ANALYTICS_BASE} element={<Navigate to={subPath('search-tracking')} replace />} />

						{/* legacy URL -> 신규 URL */}
						<Route path="/search-tracking" element={<Navigate to={subPath('search-tracking')} replace />} />
						<Route path="/search-overview" element={<Navigate to={subPath('search-overview')} replace />} />
						<Route path="/research-keyword" element={<Navigate to={subPath('research-product')} replace />} />
						<Route path="/analytics/research/keyword-insights" element={<Navigate to={subPath('research-product')} replace />} />
						<Route path="/analytics/settings" element={<Navigate to={subPath('settings-category-dict')} replace />} />
						{/* legacy: ERP iframe 기반 사용자관리 */}
						<Route path="/analytics/settings/erp-users" element={<Navigate to={subPath('settings-erp-users')} replace />} />
						{/* legacy: AI 분석(구 대시보드/테스트) -> AI 운영 센터 */}
						<Route path="/analytics/dashboard/summary" element={<Navigate to={subPath('ai-home')} replace />} />
						<Route path="/analytics/dashboard/index" element={<Navigate to={subPath('ai-home')} replace />} />
						<Route path="/analytics/ai/test" element={<Navigate to={subPath('ai-home')} replace />} />
						<Route path="/analytics/ai/organic-rank" element={elementForSub('ai-organic-rank')} />
						<Route path="/analytics/ai/organic-rank/trace" element={elementForSub('ai-organic-rank-trace')} />
						<Route path="/analytics/ai/ads-ops" element={<Navigate to={subPath('ai-ads')} replace />} />
						<Route path="/analytics/ai/purchase-conv" element={<Navigate to={subPath('ai-sales')} replace />} />
						<Route path="/analytics/ai/demand-trend" element={<Navigate to={subPath('ai-trends')} replace />} />
						<Route path="/analytics/ai/sku-policy" element={<Navigate to={subPath('ai-policies')} replace />} />
						<Route path="/analytics/reviews/analysis" element={<Navigate to={subPath('review-management')} replace />} />

						{/* legacy: 파워링크/쇼핑검색 효율 분석 -> 통합 화면 */}
						<Route path="/analytics/performance/keywords" element={<Navigate to={subPath('ads-keywords')} replace />} />
						<Route path="/analytics/performance/searchword" element={<Navigate to={subPath('ads-keywords')} replace />} />

						{/* hidden test harness */}
						<Route path="/analytics/test/ads-columns" element={<AdsE2EHarnessView />} />

						{/* analytics routes */}
						{SUB_ROUTE_DEFS.map((r) => (
							<Route key={r.path} path={r.path} element={elementForSub(r.sub)} />
						))}
						<Route path="/analytics/gfa/campaigns" element={elementForSub('gfa-operating-check')} />
						<Route path="/analytics/gfa/adgroups" element={elementForSub('gfa-operating-check')} />
						<Route path="/analytics/gfa/creatives" element={elementForSub('gfa-operating-check')} />

						<Route path="*" element={<Navigate to={subPath('search-tracking')} replace />} />
						</Routes>
					</Suspense>
				</section>
			</main>
		</div>
	);
};

// ---------- 섹션 컴포넌트들 ----------

const DashboardSummarySection: React.FC = () => {
	return (
		<div>
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="card-title">A. 오가닉(검색/쇼핑) 순위 분석</div>
				<p className="card-caption">
					오가닉(검색/쇼핑) 순위를 기반으로 변동성/원인/액션을 도출하는 AI 분석 화면(초기 구성 단계)입니다.
				</p>
				<div style={{ fontSize: 11, color: '#9ca3af' }}>
					규칙 문서는 <b>설정 → AI 세팅</b>에서 관리합니다.
				</div>
			</div>
		</div>
	);
};

const DashboardIndexSection: React.FC = () => {
	return (
		<div>
			<div className="card" style={{ marginBottom: 12 }}>
				<div className="card-title">B. 광고 운영 판단 분석</div>
				<p className="card-caption">
					광고 운영 판단(KEEP/STOP/TEST/NEGATIVE 등) 규칙을 기반으로 의사결정을 지원하는 AI 분석 화면(초기 구성 단계)입니다.
				</p>
				<div style={{ fontSize: 11, color: '#9ca3af' }}>
					규칙 문서는 <b>설정 → AI 세팅</b>에서 관리합니다.
				</div>
			</div>
		</div>
	);
};

const RouteLoadingFallback: React.FC = () => {
	return (
		<div className="card">
			<div className="card-title">화면 준비 중</div>
			<p className="card-caption">필요한 분석 모듈을 불러오는 중입니다.</p>
		</div>
	);
};

// ---------- AI 분석 (메뉴1) ----------
const AiOrganicRankSection: React.FC = () => {
	return <AiOrganicRankA1View apiBaseUrl={API_BASE} />;
};

const AiOrganicRankTraceSection: React.FC = () => {
	return <AiOrganicRankA1TraceExplorerView apiBaseUrl={API_BASE} />;
};

const AiAdsOpsSection: React.FC = () => {
	return <DashboardIndexSection />;
};

const AiPurchaseConvSection: React.FC = () => {
	return (
		<div className="card">
			<div className="card-title">C. 구매·전환 기반 분석</div>
			<p className="card-caption">
				구매/전환/매출 데이터를 기반으로 KPI를 평가하고, 운영 액션을 도출하는 AI 분석 화면(초기 구성 단계)입니다.
			</p>
			<div style={{ fontSize: 11, color: '#9ca3af' }}>
				규칙 문서는 <b>설정 → AI 세팅</b>에서 관리합니다.
			</div>
		</div>
	);
};

const AiDemandTrendSection: React.FC = () => {
	return (
		<div className="card">
			<div className="card-title">D. 수요·트렌드 분석</div>
			<p className="card-caption">
				검색량/트렌드 지표(변화율 등)를 기반으로 수요 변화를 감지하고 대응하는 AI 분석 화면(초기 구성 단계)입니다.
			</p>
			<div style={{ fontSize: 11, color: '#9ca3af' }}>
				규칙 문서는 <b>설정 → AI 세팅</b>에서 관리합니다.
			</div>
		</div>
	);
};

const AiSkuPolicySection: React.FC = () => {
	return (
		<div className="card">
			<div className="card-title">E. SKU 통합 운영 정책</div>
			<p className="card-caption">
				SKU 단위 정책/운영 규칙을 통합해 관리하고, 일관된 액션을 수행하기 위한 AI 분석 화면(초기 구성 단계)입니다.
			</p>
			<div style={{ fontSize: 11, color: '#9ca3af' }}>
				규칙 문서는 <b>설정 → AI 세팅</b>에서 관리합니다.
			</div>
		</div>
	);
};

const AdsKeywordsPerformanceSection: React.FC = () => {
	return <AdsKeywordsPerformanceView apiBaseUrl={API_BASE} />;
};

const PurchaseKeywordsSection: React.FC = () => {
	return <PurchaseKeywordsView apiBaseUrl={API_BASE} />;
};

const CampaignDailySection: React.FC = () => {
	return <CampaignDailyView apiBaseUrl={API_BASE} />;
};

const AdgroupDailySection: React.FC = () => {
	return <AdgroupDailyView apiBaseUrl={API_BASE} />;
};

const CreativesDailySection: React.FC = () => {
	return <CreativesDailyView apiBaseUrl={API_BASE} />;
};

const GfaOperatingCheckSection: React.FC = () => {
	return <GfaOperatingCheckView apiBaseUrl={API_BASE} />;
};

const GfaCreativeAnalysisSection: React.FC = () => {
	return <GfaCreativeAnalysisView apiBaseUrl={API_BASE} />;
};

const GfaStrategySection: React.FC = () => {
	return <GfaStrategyView apiBaseUrl={API_BASE} />;
};

const GfaRawAnalysisSection: React.FC = () => {
	return <GfaRawAnalysisView apiBaseUrl={API_BASE} />;
};

// NOTE: KeywordInsightsView는 menu4-rank의 '키워드 인사이트' 서브 메뉴에서 렌더링한다.

const SettingsApiSection: React.FC = () => {
	return (
		<div className="card">
			<div className="card-title">API 설정</div>
			<p className="card-caption">
				현재 UI에서는 별도 설정 입력 없이 고정된 Analytics API 주소로 통신합니다.
			</p>
			<div style={{ fontSize: 11, color: '#9ca3af' }}>
				환경에 따라 `VITE_ANALYTICS_API_BASE_URL` 환경 변수를 변경해 사용할 수 있습니다.
			</div>
		</div>
	);
};

const SettingsHelpSection: React.FC = () => {
	return (
		<div className="card">
			<div className="card-title">도움말</div>
			<ul style={{ fontSize: 11, color: '#9ca3af', paddingLeft: 16 }}>
				<li>좌측 메뉴 1~5번과 상단 서브 탭을 통해 각 분석 화면으로 이동할 수 있습니다.</li>
				<li>4-1 메뉴(내 상품 추적)에서 등록 상품·키워드·경쟁 상품을 관리하고 랭킹을 조회합니다.</li>
				<li>Analytics API 서버(`main.py`)가 실행 중이어야 그래프와 리스트가 정상 동작합니다.</li>
			</ul>
		</div>
	);
};

// ---------- 검색 순위 - 4-1 내 상품 추적 ----------

type SearchRankTrackingSectionProps = {
	apiBaseUrl: string;
};

const MAX_GRAPH_KEYWORDS = 5;

type TrackingViewMode = 'list' | 'detail';

type ProductSummaryResponse = {
	keyword: string;
	product_title: string;
	mall_name: string;
	price: number;
	purchase_cnt: number;
	product_id: number | null;
	image_url: string | null;
	category_path: string | null;
	brand: string | null;
	maker: string | null;
};

type ProductMetadataResponse = {
	title: string | null;
	image_url: string | null;
	site_name: string | null;
	price: number | null;
	product_id: number | null;
};

type ProductPageMetricsResponse = {
	product_url: string;
	date: string;
	review_count: number | null;
	rating: number | null;
	price: number | null;
	title: string | null;
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
	http_status?: number | null;
	error?: string | null;
};

type PageMetricsStatusResponse = {
	status: string;
	detail?: string | null;
	started_at?: string | null;
	finished_at?: string | null;
	next_retry_at?: string | null;
};

type CollectorBackgroundStatus = {
	running?: boolean;
	state?: string;
	jobId?: string;
	url?: string;
	reason?: string;
	error?: string;
	updated_at?: string;
	pid?: string | number;
	agentVersion?: string;
	agentManageNo?: string;
	apiBaseUrl?: string;
};

type CollectorEventItem = {
	job_id?: string | null;
	device_id?: string | null;
	url?: string | null;
	status?: string | null;
	note?: string | null;
	time?: string | null;
};

type CrawlTodayStatusItem = {
	product_url: string;
	total_keywords: number;
	covered_keywords: number;
	exposed_keywords?: number;
	no_exposure_keywords?: number;
	missing_keywords: string[];
	sample_keyword?: string | null;
	is_complete: boolean;
};

const SearchRankTrackingSection: React.FC<SearchRankTrackingSectionProps> = ({ apiBaseUrl }) => {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [trackedKeywords, setTrackedKeywords] = useState<TrackedProductKeyword[]>([]);
	const [history, setHistory] = useState<ProductRankHistoryResponse | null>(null);
	// 상세 화면: 수기 입력(source='text') 히스토리(추적/공식 히스토리와 분리)
	const [manualHistory, setManualHistory] = useState<ProductRankHistoryResponse | null>(null);
	// 상품(URL)별 개별 랭킹 히스토리 (상품+키워드 조합 기준 순위 변화용)
	const [perProductHistory, setPerProductHistory] = useState<
		Record<string, ProductRankHistoryResponse | null>
	>({});
	// 리스트 화면용 상품 메타 정보 (상품 URL 기준, 상품명/이미지/가격/몰명)
	const [listMetas, setListMetas] = useState<Record<string, ProductMetadataResponse | null>>({});

	const [viewMode, setViewMode] = useState<TrackingViewMode>('list');
	const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
	// 엑셀 업로드 등으로 랭킹 데이터가 갱신되면, 관련 데이터를 재조회하기 위한 버전 키
	const [rankDataVersion, setRankDataVersion] = useState(0);
	// 기본 표시: 7일
	const [period, setPeriod] = useState<RankTrackingDetailPeriod>('7d');
	// 수기 입력 키워드(데일리 표) 기간(일): 기본 90일, 로컬 저장
	const MANUAL_DAYS_KEY = 'analytics:rank:manual_table_days_v1';
	const [manualTableDays, setManualTableDays] = useState<number>(() => {
		try {
			const v = Number(window.localStorage.getItem(MANUAL_DAYS_KEY) || '');
			if (Number.isFinite(v) && v > 0) return v;
		} catch {
			// ignore
		}
		return 90;
	});
	useEffect(() => {
		try {
			window.localStorage.setItem(MANUAL_DAYS_KEY, String(manualTableDays));
		} catch {
			// ignore
		}
	}, [manualTableDays]);
	const [productSummary, setProductSummary] = useState<ProductSummaryResponse | null>(null);
	const [productMetadata, setProductMetadata] = useState<ProductMetadataResponse | null>(null);
	// (요청) 상세 하단 '내 상품 분석(전일 기준)' 섹션 제거 → analytics fetch 제거
	// 리스트 화면에서 각 상품(row)에 표시할 요약 정보 (대표 키워드 1개 기준)
	const [listSummaries, setListSummaries] = useState<Record<string, ProductSummaryResponse | null>>({});
	// HTML 기반(비공식) 페이지 메트릭: 리뷰수/평점 등
	const [pageMetrics, setPageMetrics] = useState<Record<string, ProductPageMetricsResponse | null>>({});
	const [pageMetricsPrev, setPageMetricsPrev] = useState<Record<string, ProductPageMetricsResponse | null>>({});
	const [pageMetricsStatusText, setPageMetricsStatusText] = useState<string | null>(null);
	const [pageMetricsStatus, setPageMetricsStatus] = useState<PageMetricsStatusResponse | null>(null);
	const [isCollectPopupOpen, setIsCollectPopupOpen] = useState(false);
	const [collectPopupOpenSeq, setCollectPopupOpenSeq] = useState(0);
	// 수집 모달을 열었을 때 "호스트 크롬(CDP) 세션"을 사용자가 실제로 한 번이라도 열었는지(=수동 진행 게이트)
	// - 모달 오픈 직후 컨테이너 수집을 먼저 때리면 403이 100% 나는 환경이 있으므로, CDP 세션 준비를 강제한다.
	const [hostSessionOpenedOnce, setHostSessionOpenedOnce] = useState(false);
	// 개발 단계에서는 로컬/ NAS 둘 다 수집이 필요하므로 버튼을 분리한다.
	type CollectTarget = 'local' | 'nas';
	const LOCAL_API_ORIGIN = 'http://localhost:5189';
	const uiTarget = useMemo<CollectTarget>(() => {
		try {
			const hn = String(window.location?.hostname || '').trim().toLowerCase();
			if (hn === 'localhost' || hn === '127.0.0.1' || hn === '::1') return 'local';
			return 'nas';
		} catch {
			return 'local';
		}
	}, []);
	const hostSetupDownloads = useMemo(() => getHostSetupDownloads(uiTarget), [uiTarget]);
	const HOST_AGENT_AUTO_UPDATE_COOLDOWN_MS = 30 * 60 * 1000;
	const HOST_AGENT_AUTO_UPDATE_KEY = `analytics:host-agent:auto-update-attempt:${uiTarget}:${REQUIRED_HOST_AGENT_MANAGE_NO}`;
	type HostAgentStatus = 'checking' | 'connected' | 'outdated' | 'missing' | 'error';
	const [hostAgentStatus, setHostAgentStatus] = useState<HostAgentStatus>('checking');
	const [hostAgentDetail, setHostAgentDetail] = useState<string>('Host Agent 상태 확인 전입니다.');
	const [hostAgentVersion, setHostAgentVersion] = useState<string>('');
	const [hostAgentManageNo, setHostAgentManageNo] = useState<string>('');
	const [hostAgentHealthTime, setHostAgentHealthTime] = useState<string>('');
	const [hostAgentCheckedAt, setHostAgentCheckedAt] = useState<string>('');
	const [hostCdpAutoStatus, setHostCdpAutoStatus] = useState<string>('');
	const [hostAgentAutoUpdating, setHostAgentAutoUpdating] = useState(false);
	const [collectorBackgroundStatus, setCollectorBackgroundStatus] = useState<CollectorBackgroundStatus | null>(null);
	const [collectorEvents, setCollectorEvents] = useState<CollectorEventItem[]>([]);
	const [collectorBackgroundBusy, setCollectorBackgroundBusy] = useState(false);
	const collectorLastNotifiedEventRef = React.useRef<string>('');
	const hostAgentAutoUpdateAttemptedRef = React.useRef(false);
	const hostAgentOutdatedAlertedRef = React.useRef<string>('');
	const hostCdpAutoStartRef = React.useRef(false);
	const canAttemptHostAgentAutoUpdate = useCallback(() => {
		try {
			const last = Number(window.localStorage.getItem(HOST_AGENT_AUTO_UPDATE_KEY) || 0);
			if (Number.isFinite(last) && last > 0 && Date.now() - last < HOST_AGENT_AUTO_UPDATE_COOLDOWN_MS) return false;
		} catch {
			// ignore storage failures
		}
		return true;
	}, [HOST_AGENT_AUTO_UPDATE_KEY]);
	const markHostAgentAutoUpdateAttempt = useCallback(() => {
		try {
			window.localStorage.setItem(HOST_AGENT_AUTO_UPDATE_KEY, String(Date.now()));
		} catch {
			// ignore storage failures
		}
	}, [HOST_AGENT_AUTO_UPDATE_KEY]);
	const clearHostAgentAutoUpdateAttempt = useCallback(() => {
		try {
			window.localStorage.removeItem(HOST_AGENT_AUTO_UPDATE_KEY);
		} catch {
			// ignore storage failures
		}
	}, [HOST_AGENT_AUTO_UPDATE_KEY]);
	const NAS_HOST_KEY = 'analytics:nas_host_v1';
	const HOST_CDP_IP_KEY = 'analytics:host_cdp_ip_v1';
	const [nasHost, setNasHost] = useState<string>(() => {
		try {
			const saved = String(window.localStorage.getItem(NAS_HOST_KEY) ?? '').trim();
			if (saved) return saved;
		} catch {
			// ignore
		}
		const hn = String(window.location?.hostname || '').trim();
		if (hn && hn !== 'localhost' && hn !== '127.0.0.1') return hn;
		return '192.168.0.50';
	});
	useEffect(() => {
		// UI가 NAS 호스트(예: 192.168.0.50)로 열렸다면, NAS host는 URL을 단일 진실로 둔다.
		// (사용자 로컬스토리지 값/입력으로 인한 혼선 방지)
		if (uiTarget !== 'nas') return;
		const hn = String(window.location?.hostname || '').trim();
		if (!hn) return;
		if (hn !== nasHost) setNasHost(hn);
	}, [uiTarget]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => {
		try {
			window.localStorage.setItem(NAS_HOST_KEY, String(nasHost || '').trim());
		} catch {
			// ignore
		}
	}, [nasHost]);

	// NAS 모드에서 "사용자 PC(호스트 크롬)"의 IP를 서버가 자동으로 알 수 없는 경우가 있어,
	// UI가 한 번 찾아서(x-erp2-client-ip 헤더/ client_ip 파라미터) 전달한다.
	const [hostCdpIp, setHostCdpIp] = useState<string>(() => {
		try {
			return String(window.localStorage.getItem(HOST_CDP_IP_KEY) ?? '').trim();
		} catch {
			return '';
		}
	});
	useEffect(() => {
		try {
			const v = String(hostCdpIp || '').trim();
			if (v) window.localStorage.setItem(HOST_CDP_IP_KEY, v);
			else window.localStorage.removeItem(HOST_CDP_IP_KEY);
		} catch {
			// ignore
		}
	}, [hostCdpIp]);
	const [hostCdpIpDetecting, setHostCdpIpDetecting] = useState(false);
	const [hostCdpIpStatusText, setHostCdpIpStatusText] = useState<string>('');
	const apiUrlFor = (t: CollectTarget, path: string): string => {
		const p = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
		// NAS는 "NAS web(nginx) → /api 프록시"를 경유해야 접속 PC의 IP를 안정적으로 전달할 수 있다.
		// (API 포트(6189) 직접 호출은 Docker NAT 영향으로 172.*로 보일 수 있음)
		if (t === 'nas') return `http://${nasHost}:6188/api${p}`;
		return `${LOCAL_API_ORIGIN}${p}`;
	};

	const getNasHostCdpIp = async (opts?: { forceRefresh?: boolean }): Promise<string | null> => {
		const ip = await discoverNasHostCdpIp({
			currentIp: hostCdpIp,
			nasHost,
			allowCached: opts?.forceRefresh ? false : true,
			requestLocalAgent: async () => {
				try {
					const res = await axios.get('http://127.0.0.1:9230/network-info', { timeout: 1500 });
					return String(res?.data?.primaryIp || '').trim() || null;
				} catch {
					return null;
				}
			},
			request: async (cidr?: string) => {
				const res = await axios.get(apiUrlFor('nas', '/search-rank/page-metrics/discover-host-cdp'), {
					params: cidr ? { cidr } : undefined,
					timeout: 12_000,
				});
				return res.data as any;
			},
		});
		if (ip) setHostCdpIp(ip);
		return ip;
	};
	// "지금 다시 시도" 등으로 모달을 열었을 때, 이미 오늘 수집이 완료된 경우엔 상태표시 전용(읽기 전용) 모드로 연다.
	const [collectPopupReadOnly, setCollectPopupReadOnly] = useState(false);
	// 수동으로 연 모달은 자동으로 닫히지 않게 한다(“잠시 있다가 사라짐” 방지).
	const [collectPopupAutoClose, setCollectPopupAutoClose] = useState(true);

	// 상품 상세 메트릭(HTML 기반) "백그라운드 자동 동기화" 옵션.
	// - 일부 환경에서는 컨테이너 세션 기반 자동 접근이 403을 100% 유발할 수 있으므로 기본 OFF로 둔다.
	// - 사용자가 필요할 때만 켜서, 하루 1회 동기화를 자동으로 트리거한다.
	const PAGE_METRICS_AUTO_SYNC_KEY = 'analytics:page_metrics:auto_sync_v1';
	const [pageMetricsAutoSync, setPageMetricsAutoSync] = useState<boolean>(() => {
		try {
			const v = String(window.localStorage.getItem(PAGE_METRICS_AUTO_SYNC_KEY) ?? '').trim().toLowerCase();
			if (!v) return false; // default OFF
			return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on';
		} catch {
			return false;
		}
	});
	// 수집 모달 자동 팝업 ON/OFF (사용자 요청: 수기로 제어)
	const COLLECT_MODAL_AUTO_KEY = 'analytics:collect_modal:auto_open_v2';
	const [collectModalAutoOpen, setCollectModalAutoOpen] = useState<boolean>(() => {
		try {
			const v = String(window.localStorage.getItem(COLLECT_MODAL_AUTO_KEY) ?? '').trim().toLowerCase();
			if (!v) return false; // default OFF: collection is user-initiated.
			return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on';
		} catch {
			return false;
		}
	});
	// 팝업에서 "처음 감지된 대상 URL"은 고정으로 보여주고, 별도로 "남은 URL"만 줄어들게 한다(UX 혼란 방지).
	const [collectTargetUrls, setCollectTargetUrls] = useState<string[]>([]);
	const [missingTodayUrls, setMissingTodayUrls] = useState<string[]>([]);
	const [missingRankUrls, setMissingRankUrls] = useState<string[]>([]);
	const [rankStatusMap, setRankStatusMap] = useState<Record<string, CrawlTodayStatusItem | null>>({});
	const [rankCollectingNow, setRankCollectingNow] = useState(false);
	const [rankCrawlJobId, setRankCrawlJobId] = useState<string | null>(null);
	const [rankCrawlStatus, setRankCrawlStatus] = useState<string | null>(null);
	const [rankCrawlDetail, setRankCrawlDetail] = useState<string | null>(null);
	const [rankNotFoundCount, setRankNotFoundCount] = useState(0);
	const collectPopupNasIpAutoDetectedRef = React.useRef(false);
	// 키워드 순위 수집을 "상품 전체"로 돌리기 위한 큐(순차 실행).
	const rankProductQueueRef = React.useRef<{ urls: string[]; idx: number } | null>(null);

	// 키워드 순위 수집 기본값
	// OpenAPI(shop.json) 페이징은 start<=1000 범위에서 최대 TOP1000까지 추적 가능.
	// 운영 기본값은 TOP500으로 둔다.
	const RANK_CRAWL_TOP_LIMIT = 500;
	// OpenAPI 기반 순위 수집은 418/캡차 리스크가 매우 낮아 배치 분할을 하지 않는다.
	const [rankCrawlDepth, setRankCrawlDepth] = useState<40 | 80 | 120 | 500 | 1000>(500);
	const [rankCrawlMissingOnly, setRankCrawlMissingOnly] = useState(true);

	useEffect(() => {
		if (!isCollectPopupOpen) {
			collectPopupNasIpAutoDetectedRef.current = false;
			setHostCdpIpDetecting(false);
			setHostCdpIpStatusText('');
			return;
		}
		if (uiTarget !== 'nas') return;
		if (collectPopupNasIpAutoDetectedRef.current) return;
		collectPopupNasIpAutoDetectedRef.current = true;

		let cancelled = false;
		setHostCdpIpDetecting(true);
		setHostCdpIpStatusText('호스트 PC IP 자동 감지 중...');

		void (async () => {
			const prevIp = String(hostCdpIp || '').trim();
			const ip = await getNasHostCdpIp({ forceRefresh: true });
			if (cancelled) return;
			if (ip) {
				setHostCdpIpStatusText(`자동 감지 완료: ${ip}`);
			} else if (prevIp && isRoutableNasHostCdpIpv4(prevIp, nasHost)) {
				setHostCdpIpStatusText(`자동 감지는 실패했지만 기존 IP를 유지합니다: ${prevIp}`);
			} else {
				if (prevIp) setHostCdpIp('');
				setHostCdpIpStatusText('자동 감지에 실패했습니다. 아래 IP를 확인해 주세요.');
			}
			setHostCdpIpDetecting(false);
		})();

		return () => {
			cancelled = true;
		};
	}, [isCollectPopupOpen, uiTarget, nasHost]);

	// product_url 정규화(수집/그룹핑/매칭 일관성)
	const canonicalizeProductUrl = (input: string): string => {
		const s0 = String(input || '').trim();
		if (!s0) return '';
		const s = s0.toLowerCase().startsWith('smartstore.naver.com/') ? `https://${s0}` : s0;
		try {
			const u = new URL(s);
			u.hash = '';
			if (String(u.host || '').toLowerCase().includes('smartstore.naver.com')) {
				return `${u.protocol}//${u.host}${u.pathname}`.trim();
			}
			return u.toString();
		} catch {
			return s.replace(/#.*$/, '');
		}
	};

	// 로컬 기준 YYYY-MM-DD (자동 수집 dedupe 키, 상태 비교 등에 사용)
	const todayLocalStr = useMemo(() => {
		const d = new Date();
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}, []);
	// 키워드 순위 수집 상태(today-status)는 "특정 일자" 기준으로 조회할 수 있다.
	// - 모달에서 날짜 범위를 돌리는 경우, 기본(today)로만 조회하면 "수집은 됐는데 반영이 안 됨"처럼 보일 수 있다.
	const rankStatusDateRef = useRef<string>(todayLocalStr);

	// 키워드(OpenAPI) 수집 저장일 범위(사용자 입력)
	const [rankCollectDateFrom, setRankCollectDateFrom] = useState<string>(() => todayLocalStr);
	const [rankCollectDateTo, setRankCollectDateTo] = useState<string>(() => todayLocalStr);
	// 날짜+상품 순차 수집 플랜
	const rankCollectPlanRef = React.useRef<{ dates: string[]; dateIdx: number; urls: string[]; urlIdx: number } | null>(null);
	// 동일 키워드 1회 수집(batch-by-keyword) 모드일 때 true → 완료 시 dateIdx만 증가
	const rankCollectBatchModeRef = React.useRef(false);

	const collectPopupShownOnceRef = React.useRef(false);
	const collectPopupClosingRef = React.useRef(false);
	const [collectingNow, setCollectingNow] = useState(false);
	const [forceStopCollectBusy, setForceStopCollectBusy] = useState(false);
	// 수집(4번) 완료 후 "중지/삭제(정리)" 버튼을 활성화하기 위한 플래그
	const [cleanupReady, setCleanupReady] = useState(false);
	const [collectNowDetail, setCollectNowDetail] = useState<string | null>(null);
	const [scrapeOnce, setScrapeOnce] = useState<PageMetricsScrapeOnceResponse | null>(null);
	const [scrapeOnceLoading, setScrapeOnceLoading] = useState(false);
	const [scrapeOnceError, setScrapeOnceError] = useState<string | null>(null);
	const [cdpDebug, setCdpDebug] = useState<ReturnType<typeof summarizeCaptchaSessionDebug> | null>(null);
	const [cdpDebugLoading, setCdpDebugLoading] = useState(false);
	const [cdpDebugError, setCdpDebugError] = useState<string | null>(null);
	// host CDP 디버그 힌트는 모달을 단순화하기 위해 비활성화(개발 단계에서는 필요 시 서버 로그/스크립트로 대체).

	// 전역 notify가 없는 환경에서도 버튼 클릭이 에러로 터지지 않도록,
	// 로컬 토스트(짧은 안내 메시지)를 제공한다.
	const [inlineNotice, setInlineNotice] = useState<string | null>(null);
	const noticeTimerRef = useRef<number | null>(null);
	const notify = (msg: string): void => {
		const text = String(msg || '').trim();
		if (!text) return;
		setInlineNotice(text);
		try {
			if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
			noticeTimerRef.current = window.setTimeout(() => setInlineNotice(null), 2600);
		} catch {
			// ignore
		}
	};

	const openExternal = (url: string): void => {
		const u = String(url || '').trim();
		if (!u) return;
		try {
			window.open(u, '_blank', 'noopener,noreferrer');
		} catch {
			// ignore
		}
	};

	const downloadExternal = (url: string, fileName: string): void => {
		const u = String(url || '').trim();
		const n = String(fileName || '').trim();
		if (!u) return;
		try {
			const a = document.createElement('a');
			a.href = u;
			if (n) a.download = n;
			a.rel = 'noopener noreferrer';
			a.target = '_blank';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		} catch {
			openExternal(u);
		}
	};

	const parseYmd = (s: string): Date | null => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
		if (!m) return null;
		const y = Number(m[1]);
		const mo = Number(m[2]);
		const d = Number(m[3]);
		if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
		// UTC 기준으로 날짜 연산(YYYY-MM-DD 문자열은 날짜 키로만 사용)
		return new Date(Date.UTC(y, mo - 1, d));
	};

	const fmtYmd = (d: Date): string => {
		const y = d.getUTCFullYear();
		const m = String(d.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(d.getUTCDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	};

	const buildDateRange = (from: string, to: string, maxDays: number): string[] => {
		const a = parseYmd(from);
		const b = parseYmd(to);
		if (!a || !b) return [];
		const start = a.getTime() <= b.getTime() ? a : b;
		const end = a.getTime() <= b.getTime() ? b : a;
		const DAY = 24 * 60 * 60 * 1000;
		const out: string[] = [];
		for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
			out.push(fmtYmd(new Date(t)));
			if (out.length >= maxDays) break;
		}
		return out;
	};

	const refreshRankStatusForUrls = async (urlsRaw: string[], ymd: string): Promise<void> => {
		const urls = Array.from(new Set((urlsRaw || []).map((u) => String(u || '').trim()).filter(Boolean)));
		if (urls.length === 0) return;
		const date = String(ymd || '').trim() || todayLocalStr;
		rankStatusDateRef.current = date;
		try {
			const res2 = await axios.post<CrawlTodayStatusItem[]>(
				`${apiBaseUrl}/search-rank/crawl/today-status`,
				{ product_urls: urls, date },
			);
			const arr = Array.isArray(res2.data) ? res2.data : [];
			const m: Record<string, CrawlTodayStatusItem | null> = {};
			for (const it of arr) {
				const u = String((it as any)?.product_url || '').trim();
				if (!u) continue;
				m[u] = it as any;
			}
			// 이 함수는 "현재 모달에 보여주는 대상 urls"만 갱신하기 위해 부분 merge로 동작한다.
			setRankStatusMap((prev) => ({ ...(prev || {}), ...(m || {}) }));
			const missRank: string[] = [];
			for (const u of urls) {
				const st = m[u] ?? null;
				if (!st) continue;
				if (!(st as any)?.is_complete) missRank.push(u);
			}
			setMissingRankUrls(missRank);
			setRankDataVersion((v) => v + 1);
		} catch {
			// ignore
		}
	};

	// 자동 팝업 설정을 로컬에 저장(새로고침/재진입 유지)
	useEffect(() => {
		try {
			window.localStorage.setItem(COLLECT_MODAL_AUTO_KEY, collectModalAutoOpen ? '1' : '0');
		} catch {
			// ignore
		}
	}, [collectModalAutoOpen]);

	// 페이지 메트릭 자동 동기화 설정을 로컬에 저장
	useEffect(() => {
		try {
			window.localStorage.setItem(PAGE_METRICS_AUTO_SYNC_KEY, pageMetricsAutoSync ? '1' : '0');
		} catch {
			// ignore
		}
	}, [pageMetricsAutoSync]);

	const runScrapeOnce = async (productUrl: string): Promise<void> => {
		const u = (productUrl || '').trim();
		if (!u) return;
		setScrapeOnceLoading(true);
		setScrapeOnceError(null);
		try {
			const res = await axios.get(`${apiBaseUrl}/search-rank/page-metrics/scrape-once`, {
				params: { product_url: u },
			});
			setScrapeOnce(res.data as any);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '진단 실행에 실패했습니다.';
			setScrapeOnceError(String(msg));
			setScrapeOnce(null);
		} finally {
			setScrapeOnceLoading(false);
		}
	};

	const runCdpDebug = async (target: CollectTarget): Promise<void> => {
		if (cdpDebugLoading) return;
		setCdpDebugLoading(true);
		setCdpDebugError(null);
		try {
			if (target === 'nas') {
				const ah = await ensureNasAuthHeaders();
				if (!ah) {
					setCdpDebugError('NAS 수집은 로그인(토큰)이 필요합니다.');
					setCdpDebug(null);
					return;
				}
			}
			let pickedIp: string | null = null;
			if (target === 'nas') {
				pickedIp = await getNasHostCdpIp();
				if (!pickedIp) {
					const msg = 'NAS에서 호스트 PC IP를 자동으로 찾지 못했습니다. 위 "호스트 PC IP"를 입력한 뒤 다시 시도해 주세요.';
					notify(msg);
					setCdpDebugError(msg);
					setCdpDebug(null);
					return;
				}
			}
			// 정책: NAS만 "클라이언트 PC IP"를 전달한다.
			// 로컬은 host.docker.internal 기반이 기본이며, IP override를 사용하지 않는다.
			const authHeaders = target === 'nas' ? ((await ensureNasAuthHeaders()) ?? {}) : await buildFirebaseBearerHeaders();
			setCdpDebug(await fetchCdpDebugSummary(target, authHeaders, pickedIp));
		} catch (e: any) {
			const msg =
				e?.response?.data?.detail ??
				e?.response?.data?.message ??
				e?.response?.data?.error ??
				e?.message ??
				'CDP 진단 호출에 실패했습니다.';
			setCdpDebugError(String(msg));
			setCdpDebug(null);
		} finally {
			setCdpDebugLoading(false);
		}
	};

	const fetchCdpDebugSummary = async (
		target: CollectTarget,
		authHeaders: Record<string, string>,
		pickedIp: string | null,
	): Promise<ReturnType<typeof summarizeCaptchaSessionDebug>> => {
		const ipForHeaders = target === 'nas' ? (pickedIp || hostCdpIp || null) : null;
		const res = await axios.get(apiUrlFor(target, '/search-rank/page-metrics/captcha-session/debug'), {
			params: target === 'nas' && pickedIp ? { client_ip: pickedIp } : undefined,
			headers: { ...buildErp2ClientIpHeaders(ipForHeaders), ...authHeaders },
			timeout: 12_000,
		});
		return summarizeCaptchaSessionDebug(res.data as any);
	};

	const refreshHostAgentStatus = useCallback(async (timeoutMs = 1200): Promise<boolean> => {
		setHostAgentStatus('checking');
		setHostAgentDetail('Host Agent 상태 확인 중...');
		const ctrl = new AbortController();
		const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const res = await fetch('http://127.0.0.1:9230/health', {
				method: 'GET',
				signal: ctrl.signal,
				cache: 'no-store',
			});
			const data = await res.json().catch(() => ({} as any));
			if (res?.ok) {
				const version = String((data as any)?.agentVersion || (data as any)?.version || '').trim();
				const manageNo = String((data as any)?.agentManageNo || (data as any)?.manageNo || '').trim();
				const healthTime = String((data as any)?.time || (data as any)?.updated_at || '').trim();
				setHostAgentVersion(version);
				setHostAgentManageNo(manageNo);
				setHostAgentHealthTime(healthTime);
				setHostAgentCheckedAt(new Date().toLocaleString());
				if (version !== REQUIRED_HOST_AGENT_VERSION || manageNo !== REQUIRED_HOST_AGENT_MANAGE_NO) {
					const currentVersion = version || 'unknown';
					const currentManageNo = manageNo || '미지원/unknown';
					const detail =
						`Host Agent 업데이트 필요: 현재 버전 ${currentVersion}, 필요 ${REQUIRED_HOST_AGENT_VERSION}\n` +
						`관리 No. 현재 ${currentManageNo}, 필요 ${REQUIRED_HOST_AGENT_MANAGE_NO}`;
					setHostAgentStatus('outdated');
					setHostAgentDetail(detail);
					if (hostAgentOutdatedAlertedRef.current !== detail) {
						hostAgentOutdatedAlertedRef.current = detail;
					}
					return false;
				}
				setHostAgentStatus('connected');
				setHostAgentDetail(`Host Agent 연결됨 (${version} / 관리 No. ${manageNo})`);
				return true;
			}
			setHostAgentVersion('');
			setHostAgentManageNo('');
			setHostAgentHealthTime('');
			setHostAgentCheckedAt(new Date().toLocaleString());
			setHostAgentStatus('error');
			setHostAgentDetail(`Host Agent 응답 오류: HTTP ${res?.status || 'unknown'}`);
			return false;
		} catch {
			setHostAgentVersion('');
			setHostAgentManageNo('');
			setHostAgentHealthTime('');
			setHostAgentCheckedAt(new Date().toLocaleString());
			setHostAgentStatus('missing');
			setHostAgentDetail('Host Agent가 실행 중이 아닙니다. 최초 1회 설치/실행이 필요합니다.');
			return false;
		} finally {
			window.clearTimeout(t);
		}
	}, []);

	useEffect(() => {
		if (hostAgentStatus !== 'outdated') return;
		if (hostAgentAutoUpdateAttemptedRef.current) return;
		if (!canAttemptHostAgentAutoUpdate()) return;
		hostAgentAutoUpdateAttemptedRef.current = true;
		markHostAgentAutoUpdateAttempt();

				const installerPath = '/nas/Install-Analytics-HostAgent.ps1';
		const installerUrl = new URL(installerPath, window.location.origin).toString();
		let cancelled = false;

		const run = async () => {
			setHostAgentAutoUpdating(true);
			setHostAgentDetail(
				`Host Agent 자동 업데이트 시도 중: 현재 ${hostAgentVersion || 'unknown'}, 필요 ${REQUIRED_HOST_AGENT_VERSION}`,
			);
			const waitForUpdatedHostAgent = async (maxWaitMs = 35_000): Promise<boolean> => {
				const started = Date.now();
				while (!cancelled && Date.now() - started < maxWaitMs) {
					try {
						const ctrl = new AbortController();
						const timer = window.setTimeout(() => ctrl.abort(), 2500);
						const healthRes = await fetch('http://127.0.0.1:9230/health', {
							method: 'GET',
							signal: ctrl.signal,
							cache: 'no-store',
						});
						window.clearTimeout(timer);
						const health = await healthRes.json().catch(() => ({} as any));
						const version = String((health as any)?.agentVersion || (health as any)?.version || '').trim();
						const manageNo = String((health as any)?.agentManageNo || (health as any)?.manageNo || '').trim();
						if (healthRes.ok && version === REQUIRED_HOST_AGENT_VERSION && manageNo === REQUIRED_HOST_AGENT_MANAGE_NO) {
							return true;
						}
					} catch {
						// Agent may be restarting during self-update.
					}
					await new Promise((resolve) => window.setTimeout(resolve, 1500));
				}
				return false;
			};
			try {
				const ctrl = new AbortController();
				const timer = window.setTimeout(() => ctrl.abort(), 12_000);
				const res = await fetch('http://127.0.0.1:9230/self-update', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						installerUrl,
						expectedVersion: REQUIRED_HOST_AGENT_VERSION,
						expectedManageNo: REQUIRED_HOST_AGENT_MANAGE_NO,
					}),
					cache: 'no-store',
					signal: ctrl.signal,
				});
				window.clearTimeout(timer);
				const data = await res.json().catch(() => ({} as any));
				if (!res.ok || data?.ok === false) {
					throw new Error(String(data?.error || `HTTP ${res.status}`));
				}
				setHostAgentDetail('Host Agent 자동 업데이트를 시작했습니다. 설치/재시작 완료를 확인 중입니다.');
				const updatedAfterRestart = await waitForUpdatedHostAgent(35_000);
				if (updatedAfterRestart) {
					clearHostAgentAutoUpdateAttempt();
					setHostAgentDetail('Host Agent 업데이트가 완료되었습니다. 상태를 다시 확인합니다.');
					void refreshHostAgentStatus(3000);
					return;
				}
				setHostAgentDetail('Host Agent 업데이트 요청은 성공했지만, 새 버전 확인이 지연되고 있습니다. 상태 새로고침을 눌러 확인해 주세요.');
				void refreshHostAgentStatus(3000);
			} catch (e: any) {
				const updatedAfterRestart = await waitForUpdatedHostAgent(35_000);
				if (updatedAfterRestart) {
					clearHostAgentAutoUpdateAttempt();
					setHostAgentDetail('Host Agent 업데이트가 완료되었습니다. 상태를 다시 확인합니다.');
					void refreshHostAgentStatus(3000);
					return;
				}
				const msg = String(e?.message || e || 'unknown');
				setHostAgentDetail(
					`Host Agent 자동 업데이트를 실행하지 못했습니다. 구버전 Agent에는 자동 업데이트 API가 없을 수 있습니다. 패키지 설치본으로 1회 업데이트해 주세요. (${msg})`,
				);
			} finally {
				if (!cancelled) setHostAgentAutoUpdating(false);
			}
		};

		void run();
		return () => {
			cancelled = true;
		};
	}, [canAttemptHostAgentAutoUpdate, clearHostAgentAutoUpdateAttempt, hostAgentStatus, hostAgentVersion, markHostAgentAutoUpdateAttempt, refreshHostAgentStatus, uiTarget]);

	const probeLocalHostAgent = useCallback(async (timeoutMs = 900): Promise<boolean> => {
		const ctrl = new AbortController();
		const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const res = await fetch('http://127.0.0.1:9230/health', {
				method: 'GET',
				signal: ctrl.signal,
				cache: 'no-store',
			});
			return Boolean(res?.ok);
		} catch {
			return false;
		} finally {
			window.clearTimeout(t);
		}
	}, []);

	const refreshCollectorBackgroundStatus = useCallback(async (): Promise<void> => {
		try {
			const res = await fetch('http://127.0.0.1:9230/collector/background/status', { cache: 'no-store' });
			const data = await res.json().catch(() => null);
			if (res.ok && data) setCollectorBackgroundStatus(data as CollectorBackgroundStatus);
		} catch {
			setCollectorBackgroundStatus((prev) => (prev ? { ...prev, running: false, state: 'UNREACHABLE' } : null));
		}
		try {
			const res = await axios.get<{ ok?: boolean; events?: CollectorEventItem[] }>(
				apiUrlFor(uiTarget, '/search-rank/page-metrics/local-collector/events'),
				{ params: { limit: 20 }, timeout: 2500 },
			);
			const events = Array.isArray(res.data?.events) ? res.data.events : [];
			setCollectorEvents(events);
			const latestAction = [...events].reverse().find((e) =>
				['LOGIN_REQUIRED', 'HUMAN_ACTION_REQUIRED', 'WAITING_USER'].includes(String(e?.status || '').toUpperCase()),
			);
			if (latestAction) {
				const key = `${latestAction.time || ''}|${latestAction.job_id || ''}|${latestAction.url || ''}|${latestAction.status || ''}`;
				if (key && collectorLastNotifiedEventRef.current !== key) {
					collectorLastNotifiedEventRef.current = key;
					notify('백그라운드 수집에 로그인이 필요합니다. 열린 Host Chrome 창에서 로그인/보안확인을 완료해 주세요.');
				}
			}
		} catch {
			// collector events are best-effort UI hints.
		}
	}, [apiBaseUrl, uiTarget, nasHost]);

	const startCollectorBackground = async (): Promise<void> => {
		if (collectorBackgroundBusy) return;
		setCollectorBackgroundBusy(true);
		try {
			const authHeaders = uiTarget === 'nas' ? await ensureNasAuthHeaders(true) : await buildFirebaseBearerHeaders();
			if (uiTarget === 'nas' && !authHeaders) {
				throw new Error('NAS Collector 시작에는 로그인 토큰이 필요합니다. 화면을 새로고침하거나 다시 로그인한 뒤 시작해 주세요.');
			}
			const bearerToken = String((authHeaders as any)?.Authorization || (authHeaders as any)?.authorization || '').replace(/^Bearer\s+/i, '');
			const apiBase = uiTarget === 'nas' ? `http://${nasHost}:6188/api` : LOCAL_API_ORIGIN;
			const tokenRes = await fetch(`${apiBase}/collection/collector-token`, {
				method: 'GET',
				cache: 'no-store',
				headers: authHeaders || {},
			});
			const tokenData = await tokenRes.json().catch(() => ({} as any));
			if (!tokenRes.ok || tokenData?.ok === false) {
				throw new Error(String(tokenData?.message || tokenData?.error || `Collector token HTTP ${tokenRes.status}`));
			}
			const collectorToken = String(tokenData?.collectorToken || '').trim();
			if (uiTarget === 'nas' && !collectorToken) {
				throw new Error('NAS Collector worker token이 비어 있습니다. API 환경 구성을 확인해 주세요.');
			}
			const res = await fetch('http://127.0.0.1:9230/collector/background/start', {
				method: 'POST',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ apiBaseUrl: apiBase, bearerToken, collectorToken, deviceId: `web-${uiTarget}` }),
			});
			const data = await res.json().catch(() => ({} as any));
			if (!res.ok || data?.ok !== true) throw new Error(String(data?.error || `HTTP ${res.status}`));
			notify(data?.reused ? '백그라운드 수집기가 이미 실행 중입니다.' : '백그라운드 수집기를 시작했습니다.');
			await refreshCollectorBackgroundStatus();
		} catch (e: any) {
			notify(`백그라운드 수집기 시작 실패: ${String(e?.message || e || '')}`);
		} finally {
			setCollectorBackgroundBusy(false);
		}
	};

	const stopCollectorBackground = async (): Promise<void> => {
		if (collectorBackgroundBusy) return;
		setCollectorBackgroundBusy(true);
		try {
			const res = await fetch('http://127.0.0.1:9230/collector/background/stop', { method: 'POST', cache: 'no-store' });
			const data = await res.json().catch(() => ({} as any));
			if (!res.ok || data?.ok !== true) throw new Error(String(data?.error || `HTTP ${res.status}`));
			notify('백그라운드 수집기를 중지했습니다.');
			await refreshCollectorBackgroundStatus();
		} catch (e: any) {
			notify(`백그라운드 수집기 중지 실패: ${String(e?.message || e || '')}`);
		} finally {
			setCollectorBackgroundBusy(false);
		}
	};

	useEffect(() => {
		if (hostAgentStatus !== 'connected') return;
		let cancelled = false;
		const tick = async () => {
			if (cancelled) return;
			await refreshCollectorBackgroundStatus();
		};
		void tick();
		const id = window.setInterval(() => void tick(), 5000);
		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
	}, [hostAgentStatus, refreshCollectorBackgroundStatus]);

	/** API 쪽 Playwright/CDP 세션만 정리한다. Host Agent/Chrome은 다음 수집에서 재사용하도록 유지한다. */
	const stopCollectApiSession = useCallback(async (): Promise<void> => {
		setScrapeOnceError(null);
		try {
			await axios.post(`${apiBaseUrl}/search-rank/page-metrics/captcha-session/stop`);
		} catch {
			// best-effort
		}
	}, [apiBaseUrl]);

	/** Host Chrome(9223) + Host Agent(9230) 정리. 일반 닫기에서는 호출하지 않고 force-stop에서만 사용한다. */
	const teardownCollectModalHostProcesses = useCallback(
		async (tryHostAgent: boolean, disableAutoStart = false): Promise<void> => {
			await stopCollectApiSession();
			if (!tryHostAgent) return;
			await fetch(`http://127.0.0.1:9230/stop-host-chrome?port=9223`, {
				method: 'POST',
				cache: 'no-store',
			}).catch(() => undefined);
			const shutdownUrl = disableAutoStart
				? 'http://127.0.0.1:9230/shutdown?cleanup=1'
				: 'http://127.0.0.1:9230/shutdown';
			await fetch(shutdownUrl, {
				method: 'POST',
				cache: 'no-store',
			}).catch(() => undefined);
		},
		[stopCollectApiSession],
	);

	const closeCollectPopup = useCallback(async (): Promise<void> => {
		if (collectPopupClosingRef.current) return;
		collectPopupClosingRef.current = true;
		try {
			await stopCollectApiSession();
		} finally {
			setCleanupReady(false);
			setHostSessionOpenedOnce(false);
			setScrapeOnce(null);
			setScrapeOnceError(null);
			setCdpDebug(null);
			setCdpDebugError(null);
			setCollectNowDetail(null);
			setIsCollectPopupOpen(false);
		}
	}, [stopCollectApiSession]);

	const openCollectPopup = useCallback((): void => {
		collectPopupClosingRef.current = false;
		hostCdpAutoStartRef.current = false;
		setHostSessionOpenedOnce(false);
		setHostCdpAutoStatus('');
		setIsCollectPopupOpen(true);
		setCollectPopupOpenSeq((v) => v + 1);
	}, []);

	useEffect(() => {
		if (isCollectPopupOpen) {
			collectPopupClosingRef.current = false;
			hostCdpAutoStartRef.current = false;
			setHostCdpAutoStatus('');
			void refreshHostAgentStatus();
		}
	}, [isCollectPopupOpen, collectPopupOpenSeq, refreshHostAgentStatus]);

	useEffect(() => {
		if (viewMode !== 'list') return;
		void refreshHostAgentStatus();
	}, [viewMode, refreshHostAgentStatus]);

	const ensureLocalHostChromeReady = async (target: CollectTarget): Promise<void> => {
		const withTimeout = async (url: string, ms: number, method: 'GET' | 'POST' = 'GET'): Promise<Response> => {
			const ctrl = new AbortController();
			const t = window.setTimeout(() => ctrl.abort(), ms);
			try {
				return await fetch(url, { method, signal: ctrl.signal, cache: 'no-store' });
			} finally {
				window.clearTimeout(t);
			}
		};

		let healthOk = false;
		try {
			const health = await withTimeout('http://127.0.0.1:9230/health', 1200, 'GET');
			healthOk = Boolean(health && health.ok);
			if (!healthOk) throw new Error(`host_agent_unhealthy:${health.status}`);
		} catch (e: any) {
			const em = String(e?.message || e || '').trim();
			if (target === 'nas') {
				throw new Error(
					'NAS 세션 준비를 계속할 수 없습니다.\n' +
						'원인: Host Agent(127.0.0.1:9230)가 실행 중이 아니거나, 브라우저에서 localhost 호출이 차단되었습니다.\n' +
						`상세: ${em || 'host-agent health not reachable'}\n` +
						'해결:\n' +
						' - 먼저 수집 모달의 "NAS 호스트 패키지(zip)"를 다시 받아 실행(또는 통합 Setup)하고\n' +
						' - 확인: http://127.0.0.1:9230/health 와 /network-info 가 열리는지 확인하세요.',
				);
			}
			throw new Error(
				'Host Chrome 자동 실행이 실패했습니다.\n' +
					'원인: Host Agent(127.0.0.1:9230)가 실행 중이 아니거나, 브라우저에서 localhost 호출이 차단되었습니다.\n' +
					`상세: ${em || 'host-agent health not reachable'}\n` +
					'해결:\n' +
					' - 먼저 "Host Agent 자동시작 설치(최초 1회)"를 실행하거나\n' +
					' - PowerShell에서 .\\tools\\start-host-agent.ps1 를 실행한 뒤\n' +
					' - 확인: http://127.0.0.1:9230/health 가 열리는지 확인하세요.',
			);
		}

		const startResp = await withTimeout(
			'http://127.0.0.1:9230/start-host-chrome?port=9223&profile_dir=Default&start_url=https%3A%2F%2Fsearch.shopping.naver.com%2F',
			7000,
			'POST',
		);
		const startPayload = await startResp
			.json()
			.catch(() => null as { ok?: boolean; ready?: boolean; hint?: string; error?: string } | null);
		if (!startResp.ok) {
			const detail = String(startPayload?.error || startPayload?.hint || '').trim();
			throw new Error(detail ? `host_chrome_start_failed:${detail}` : `host_chrome_start_failed:${startResp.status}`);
		}
		const cdpReady = startPayload?.ready === true;
		if (!cdpReady) {
			const hint = String(startPayload?.hint || '').trim();
			throw new Error(
				'host_chrome_cdp_not_ready: Host Agent가 Host Chrome 준비 완료를 확인하지 못했습니다. ' +
					(hint || '기존 Host Chrome 종료 후 재시도하거나, "Host Chrome 실행기(cmd)"를 다시 실행해 주세요.'),
			);
		}
	};

	const ensureNasHostChromeReadyViaBridge = useCallback(async (popup: Window | null): Promise<void> => {
		if (!popup || popup.closed) {
			throw new Error('NAS 세션 준비 팝업을 열지 못했습니다. 브라우저 팝업 차단을 해제한 뒤 다시 시도해 주세요.');
		}

		const bridgeUrl = new URL(`${HOST_AGENT_LOCAL_ORIGIN}/bridge/start-host-chrome`);
		bridgeUrl.searchParams.set('port', '9223');
		bridgeUrl.searchParams.set('profile_dir', 'Default');
		bridgeUrl.searchParams.set('start_url', 'https://search.shopping.naver.com/');
		bridgeUrl.searchParams.set('opener_origin', window.location.origin);

		type BridgePayload = {
			type?: string;
			action?: string;
			ok?: boolean;
			ready?: boolean;
			error?: string;
			hint?: string;
		};

		const payload = await new Promise<BridgePayload>((resolve, reject) => {
			let settled = false;
			let timer = 0;
			let closedPoll = 0;

			const cleanup = () => {
				settled = true;
				window.removeEventListener('message', onMessage);
				window.clearTimeout(timer);
				window.clearInterval(closedPoll);
			};

			const fail = (message: string) => {
				if (settled) return;
				cleanup();
				reject(new Error(message));
			};

			const onMessage = (event: MessageEvent) => {
				if (settled) return;
				if (event.origin !== HOST_AGENT_LOCAL_ORIGIN) return;
				const data = (event.data ?? {}) as BridgePayload;
				if (data.type !== HOST_AGENT_BRIDGE_MESSAGE_TYPE) return;
				if (data.action !== 'start-host-chrome') return;
				cleanup();
				resolve(data);
			};

			window.addEventListener('message', onMessage);
			timer = window.setTimeout(() => {
				fail('NAS 세션 준비 로컬 브리지 응답이 없습니다. Host Agent 창이 열렸는지 확인한 뒤 다시 시도해 주세요.');
			}, 12_000);
			closedPoll = window.setInterval(() => {
				if (popup.closed) {
					fail('NAS 세션 준비 창이 닫혀 세션 준비를 계속할 수 없습니다. 다시 시도해 주세요.');
				}
			}, 300);

			try {
				popup.location.href = bridgeUrl.toString();
			} catch {
				fail('NAS 세션 준비 브리지 창을 localhost로 이동하지 못했습니다. 브라우저 보안 정책을 확인해 주세요.');
			}
		});

		if (!payload?.ok || payload?.ready !== true) {
			const detail = String(payload?.error || payload?.hint || '').trim();
			throw new Error(
				detail
					? `host_chrome_start_failed:${detail}`
					: 'host_chrome_start_failed: Host Agent 브리지에서 Host Chrome 준비 완료를 확인하지 못했습니다.',
			);
		}
	}, []);

	useEffect(() => {
		if (!isCollectPopupOpen) return;
		if (hostAgentStatus !== 'connected') return;
		if (hostCdpAutoStartRef.current) return;
		hostCdpAutoStartRef.current = true;
		setHostCdpAutoStatus('로컬 세션 자동 준비 중...');
		void (async () => {
			try {
				await ensureLocalHostChromeReady(uiTarget);
				setHostSessionOpenedOnce(true);
				setHostCdpAutoStatus('로컬 세션 준비 완료. 기존 CDP Chrome 창이 있으면 재사용합니다.');
			} catch (e: any) {
				hostCdpAutoStartRef.current = false;
				const msg = String(e?.message || e || '').trim();
				setHostSessionOpenedOnce(false);
				setHostCdpAutoStatus(msg ? `로컬 세션 자동 준비 실패: ${msg}` : '로컬 세션 자동 준비 실패');
			}
		})();
	}, [isCollectPopupOpen, hostAgentStatus, uiTarget]);

	const openHostChromeProductSession = async (target: CollectTarget, productUrl: string): Promise<void> => {
		const u = String(productUrl || '').trim();
		if (!u) return;
		setScrapeOnceError(null);
		let pickedIp: string | null = null;
		let authHeaders: Record<string, string> = {};
		// (중요) 브라우저 팝업 차단 회피:
		// - 네트워크 요청(await) 이후 window.open()을 호출하면 팝업으로 차단되는 경우가 많다.
		// - 따라서 "세션 준비" 클릭(사용자 제스처) 순간에 먼저 빈 창을 열어두고,
		//   응답을 받은 뒤 해당 창을 devtools/json_list로 이동시킨다.
		let popup: Window | null = null;
		try {
			popup = window.open('about:blank', '_blank');
			// 보안: opener 연결 최소화(best-effort)
			try {
				if (popup && target !== 'nas') (popup as any).opener = null;
			} catch {
				// ignore
			}
			try {
				if (popup && popup.document) {
					popup.document.title = target === 'nas' ? 'NAS 세션 준비 중' : '로컬 세션 준비 중';
					popup.document.body.innerHTML =
						'<div style="font-family:sans-serif;padding:24px;line-height:1.6">' +
						'<h3 style="margin:0 0 12px 0">세션 준비 중...</h3>' +
						'<div>Host Chrome/CDP 연결을 확인한 뒤 필요한 화면으로 자동 이동합니다.</div>' +
						'</div>';
				}
			} catch {
				// ignore
			}
		} catch {
			popup = null;
		}
		try {
			let nasAuthHeaders: Record<string, string> | null = null;
			if (target === 'nas') {
				nasAuthHeaders = await ensureNasAuthHeaders();
				if (!nasAuthHeaders) {
					const msg = 'NAS 세션 준비는 로그인(토큰)이 필요합니다.';
					setScrapeOnceError(msg);
					if (popup && !popup.closed) {
						try {
							popup.close();
						} catch {
							// ignore
						}
					}
					return;
				}
			}
			authHeaders = target === 'nas' ? (nasAuthHeaders ?? {}) : await buildFirebaseBearerHeaders();
			// 로컬/NAS 공통: 버튼 클릭 시 Host Chrome(CDP 9223)까지 자동으로 띄우려 시도한다.
			// - 브라우저는 ps1을 직접 실행할 수 없으므로, localhost agent(127.0.0.1)에게 요청한다.
			if (target === 'local' || target === 'nas') {
				try {
					if (target === 'nas') {
						await ensureNasHostChromeReadyViaBridge(popup);
					} else {
						await ensureLocalHostChromeReady(target);
					}

					// 4) (중요) 호스트(127.0.0.1)에서 9223이 열려도,
					// 컨테이너(analytics-api)에서 host.docker.internal(=Docker gateway IP)로 9223 접근이 막히면
					// 실제 host_cdp 연결은 실패하고 container_chromium으로 폴백된다.
					// 이를 사전에 감지해 "접속 불가/착시"를 줄인다.
					try {
						const probe = await axios.get(`${LOCAL_API_ORIGIN}/search-rank/page-metrics/host-cdp/probe`, { timeout: 2500 });
						const enabled = Boolean((probe.data as any)?.enabled);
						const ok = (probe.data as any)?.container_http_reachable;
						const url = String((probe.data as any)?.container_http || '').trim();
						if (enabled && ok === false) {
							const hint =
								'컨테이너에서 호스트 CDP(9223)로 연결이 차단되어 host_cdp로 연결할 수 없습니다.\n' +
								`- 컨테이너 CDP 주소: ${url || '(unknown)'}\n` +
								'- 회사 환경의 방화벽/보안SW에서 Docker Desktop 네트워크 → 로컬 9223 인바운드가 막힐 수 있습니다.\n' +
								'해결: Windows 방화벽에서 chrome.exe 또는 9223 포트를 사설 네트워크에서 허용(또는 보안팀 예외) 후 다시 시도하세요.';
							notify(hint);
							setScrapeOnceError(hint);
							if (popup && !popup.closed) {
								try {
									popup.close();
								} catch {
									// ignore
								}
							}
							return;
						}
					} catch {
						// probe 실패는 진행을 막지 않는다(best-effort)
					}
				} catch (e: any) {
					const msg =
						String(e?.message || '').trim() ||
						(target === 'nas'
							? 'NAS 세션 준비를 계속할 수 없습니다. Host Agent/Host Chrome 실행 상태를 먼저 확인해 주세요.'
							: 'Host Chrome 자동 실행이 실패했습니다. Host Agent를 먼저 실행해 주세요.');
					notify(msg);
					setScrapeOnceError(msg);
					if (popup && !popup.closed) {
						try {
							popup.close();
						} catch {
							// ignore
						}
					}
					return;
				}
			}

			if (target === 'nas') {
				pickedIp = await getNasHostCdpIp();
				if (!pickedIp) {
					notify('NAS에서 호스트 PC IP를 자동으로 찾지 못했습니다. 아래 "호스트 PC IP"를 입력한 뒤 다시 시도해 주세요.');
				}
			}
			// NAS: host CDP(사용자 PC 9223)가 열려있지 않으면 서버 호출은 503(host_cdp_required)로 떨어진다.
			// 사용자 체감 개선: 브라우저에서 9223을 직접 fetch하면 CORS에 막힐 수 있으므로,
			// 서버(/host-cdp/probe)가 수행한 override probe 결과로 "즉시" 안내한다.
			if (target === 'nas' && pickedIp) {
				const ip = String(pickedIp || '').trim();
				if (ip) {
					try {
						const probe = await axios.get(apiUrlFor('nas', '/search-rank/page-metrics/host-cdp/probe'), {
							params: { client_ip: ip },
							headers: { ...buildErp2ClientIpHeaders(ip || hostCdpIp), ...authHeaders },
							timeout: 2500,
						});
						const ok = (probe.data as any)?.override_http_reachable;
						const overrideHttp = String((probe.data as any)?.override_http || '').trim();
						if (ok === false) {
							const msg =
								`호스트 Chrome(CDP) 포트가 준비되지 않았습니다: ${(overrideHttp || `http://${ip}:9223`)}/json/version\n` +
								'- 해결(권장): 수집 모달의 "NAS 호스트 패키지(zip)"를 다시 받아 통합 Setup을 실행한 뒤 다시 시도하세요.\n' +
								'  (회사 PC에서 CDP가 127.0.0.1로만 열리는 경우 portproxy+방화벽 설정이 필요합니다.)';
							notify(msg);
							setScrapeOnceError(msg);
							// (중요) overrideHttp/json/list 를 브라우저에서 바로 열면
							// 방화벽/정책 미설정 상태에서는 "사이트에 연결할 수 없음"으로 혼선을 만든다.
							return;
						}
					} catch {
						// probe 실패는 진행을 막지 않는다(best-effort)
					}
				}
			}
			// 핵심만: 해당 URL로 "호스트 크롬 세션"을 준비하도록 서버에 요청한다.
			const resp = await axios.post(
				apiUrlFor(target, '/search-rank/page-metrics/captcha-session/start'),
				null,
				{
					params: { product_url: u, force_new: false, client_ip: pickedIp || undefined },
					headers:
						target === 'nas'
							? { ...buildErp2ClientIpHeaders(pickedIp || hostCdpIp), ...authHeaders }
							: authHeaders,
					timeout: 30_000,
				},
			);

			// 서버가 돌려주는 devtools/json_list를 가능한 한 자동으로 열어준다.
			// - host_cdp 모드: json_list_url(호스트 Chrome) 또는 devtools_url이 내려올 수 있다.
			const data = (resp?.data ?? {}) as any;
			let devtoolsUrl = String(data?.devtools_url || '').trim();
			let jsonListUrl = String(data?.json_list_url || '').trim();
			// NAS 모드 구조적 개선:
			// - 일부 환경에서는 9223이 127.0.0.1이 아닌 "PC 사설 IP"에만 바인딩/포워딩되는 경우가 있어
			//   127.0.0.1 기반 devtools/json_list를 열면 브라우저에 "접속 불가"가 뜬다.
			// - NAS에서는 pickedIp(=사용자 PC IP)를 알고 있으므로, 사용자 브라우저에서 여는 URL은 PC IP로 치환한다.
			if (target === 'nas' && pickedIp) {
				const ip = String(pickedIp || '').trim();
				if (ip) {
					devtoolsUrl = rewriteCdpHttpUrlForNas(devtoolsUrl, ip);
					jsonListUrl = rewriteCdpHttpUrlForNas(jsonListUrl, ip);
					// devtoolsUrl이 ws=127.0.0.1(또는 localhost)로 박혀 있으면, 그 상태로는 소켓 연결이 실패할 수 있다.
					// 이 경우 json/list를 기준으로 다시 inspector URL을 만들도록 openUrl을 비운다.
					const dt = devtoolsUrl.toLowerCase();
					if (dt.includes('ws=127.0.0.1') || dt.includes('ws=localhost')) devtoolsUrl = '';
				}
			}
			let openUrl = devtoolsUrl || '';

			// host_cdp는 보통 devtools_url이 비어 있고 json_list_url만 내려온다.
			// 이때 json_list를 브라우저에서 직접 읽어(devtoolsFrontendUrl) 바로 Inspector로 이동시킨다.
			if (!openUrl && jsonListUrl) {
				try {
					const origin = (() => {
						try {
							const uu = new URL(jsonListUrl);
							return `${uu.protocol}//${uu.host}`;
						} catch {
							return '';
						}
					})();
					const withTimeout = async (ms: number): Promise<Response> => {
						const ctrl = new AbortController();
						const t = window.setTimeout(() => ctrl.abort(), ms);
						try {
							return await fetch(jsonListUrl, { signal: ctrl.signal, cache: 'no-store' });
						} finally {
							window.clearTimeout(t);
						}
					};
					const r = await withTimeout(3000);
					const arr = (await r.json()) as any[];
					const items = Array.isArray(arr) ? arr : [];
					const wantUrl = (u || '').toLowerCase();
					const pick =
						items.find((it) => String(it?.url || '').toLowerCase().includes('smartstore.naver.com')) ||
						items.find((it) => wantUrl && String(it?.url || '').toLowerCase().includes(wantUrl)) ||
						items.find((it) => String(it?.url || '').toLowerCase().includes('shopping.naver.com')) ||
						items.find((it) => String(it?.url || '').toLowerCase().includes('search.shopping.naver.com')) ||
						items[items.length - 1];

					const dt = String(pick?.devtoolsFrontendUrl || '').trim();
					// devtoolsFrontendUrl은 환경에 따라:
					// - "/devtools/inspector.html?ws=..." (상대 경로)
					// - "https://chrome-devtools-frontend.appspot.com/serve_rev/.../inspector.html?ws=..." (절대 URL)
					// 둘 다 있을 수 있다. 절대 URL이 있으면 그대로 여는 것이 가장 안정적이다.
					if (dt) {
						if (dt.startsWith('https://') || dt.startsWith('http://')) {
							openUrl = dt;
						} else if (origin && dt.startsWith('/')) {
							openUrl = `${origin}${dt}`;
						}
					}
					if (!openUrl) {
						// fallback: websocket URL 기반으로 inspector 구성
						const ws = String(pick?.webSocketDebuggerUrl || '').trim();
						if (origin && ws.startsWith('ws://')) {
							const wsParam = ws.replace(/^ws:\/\//, '');
							openUrl = `${origin}/devtools/inspector.html?ws=${encodeURIComponent(wsParam)}`;
						}
					}
				} catch {
					// json list 조회 실패 시, 최소한 json_list_url이라도 열어 사용자가 선택할 수 있게 둔다.
					openUrl = jsonListUrl;
				}
			}

			// 그래도 URL이 비면(환경/모드에 따라) json_list로라도 유도한다.
			if (!openUrl && jsonListUrl) openUrl = jsonListUrl;

			if (openUrl) {
				try {
					if (popup && !popup.closed) {
						popup.location.href = openUrl;
					} else {
						window.open(openUrl, '_blank');
					}
				} catch {
					// ignore (사용자 브라우저 정책에 따라 실패 가능)
				}
			} else {
				// URL이 안 내려오면(환경/모드에 따라) 기존 UX 유지: 탭은 이미 열렸을 수 있다.
				if (popup && !popup.closed) {
					try {
						popup.close();
					} catch {
						// ignore
					}
				}
			}
			// 세션 준비 단계에서 서버가 감지한 힌트/차단 정보를 사용자에게 즉시 노출한다.
			// (특히 "현재 서비스 접속이 불가능합니다" 화면은 사용자가 DevTools로 무엇을 해야 하는지 혼동하기 쉽다.)
			try {
				const hintText = String((data as any)?.hint ?? '').trim();
				const block = String((data as any)?.page_block ?? '').trim();
				if (hintText) {
					notify(hintText);
					if (block) setScrapeOnceError(hintText);
				}
			} catch {
				// ignore
			}
			setHostSessionOpenedOnce(true);
			notify(target === 'nas' ? 'NAS 세션 준비 요청 완료' : '로컬 세션 준비 요청 완료');
		} catch (e: any) {
			const rawMsg =
				e?.response?.data?.detail ??
				e?.response?.data?.message ??
				e?.response?.data?.error ??
				e?.message ??
				'호스트 크롬 세션 탭 열기에 실패했습니다.';
			let msg = String(rawMsg);
			if (target === 'nas' && (msg === 'Request failed with status code 503' || msg.includes('host_cdp_required'))) {
				try {
					const debugSummary = await fetchCdpDebugSummary(target, authHeaders, pickedIp);
					setCdpDebug(debugSummary);
					msg = formatSessionPrepErrorMessage(msg, debugSummary);
				} catch {
					// ignore
				}
			}
			setScrapeOnceError(String(msg));
			if (String(rawMsg).includes('host_cdp_required') || String(msg).includes('host_cdp_required')) {
				const ip = String(hostCdpIp || '').trim();
				const jsonListUrl = ip ? `http://${ip}:9223/json/list` : '';
				notify(
					'호스트 크롬(CDP) 전용 창이 필요합니다.\n' +
						'- 수집 모달의 "Host Chrome 실행기(cmd)"로 CDP 크롬을 먼저 실행한 뒤 다시 시도하세요.\n' +
						'- 회사 PC에서 NAS→PC(9223) 접근이 막히면 "NAS 호스트 패키지(zip)" 통합 Setup을 다시 실행해야 합니다.\n' +
						(jsonListUrl ? `- (참고) 로컬 확인: ${jsonListUrl}` : ''),
				);
				// (중요) NAS→PC 접근이 막힌 상태에서 json/list를 자동으로 열면 "사이트에 연결할 수 없음"으로 혼선을 만든다.
			}
			// 실패 시 빈 팝업 정리
			if (popup && !popup.closed) {
				try {
					popup.close();
				} catch {
					// ignore
				}
			}
		}
	};

	// 키워드 순위 수집은 OpenAPI 기반이므로, "쇼핑 검색 탭 열기/캡차" UX는 더 이상 필요하지 않다.

	const collectNowAfterSessionReady = async (target: CollectTarget): Promise<void> => {
		// 1~3번(세션 준비) 이후 사용자가 "바로 수집"할 때 쓰는 흐름:
		// - 4번: 메트릭 수집
		if (collectingNow || collectPopupReadOnly) return;
		// (중요) 상품 메트릭이 미수집인 상태에서는, 사용자에게 CDP(호스트 크롬) 수동 세션 준비를 먼저 요구한다.
		// - 모달을 열자마자(혹은 "지금 수집"만 누른 상태) 컨테이너 수집을 시도하면 403 차단이 재현된다.
		// - 따라서 "호스트 크롬에서 상품 페이지 열기(세션)"을 최소 1회 수행하기 전에는 수집을 막는다.
		if (missingTodayUrls.length > 0 && !hostSessionOpenedOnce) {
			const msg =
				'먼저 3번(세션 준비) 버튼으로 호스트 크롬에서 상품 페이지를 열고 로그인/보안확인을 완료한 뒤 수집을 눌러주세요.';
			notify(msg);
			// 사용자 체감(중요): 토스트만으로는 "무반응"으로 느껴질 수 있어 모달에 고정 메시지로도 남긴다.
			setCollectNowDetail(msg);
			setScrapeOnceError(msg);
			return;
		}
		setCleanupReady(false);
		setCollectingNow(true);
		setCollectNowDetail(null);
		setScrapeOnceError(null);
		try {
			if (target === 'nas') {
				const ah = await ensureNasAuthHeaders();
				if (!ah) {
					const msg = 'NAS 수집은 로그인(토큰)이 필요합니다.';
					setCollectNowDetail(msg);
					setScrapeOnceError(msg);
					notify(msg);
					return;
				}
			}
			let pickedIp: string | null = null;
			if (target === 'nas') {
				pickedIp = await getNasHostCdpIp();
				if (!pickedIp && hostCdpIp && isPrivateOrLoopbackIpv4(hostCdpIp)) pickedIp = hostCdpIp;
			}
			const authHeaders = target === 'nas' ? ((await ensureNasAuthHeaders()) ?? {}) : await buildFirebaseBearerHeaders();
			const urlsRaw =
				missingTodayUrls.length > 0
					? missingTodayUrls
					: collectTargetUrls.length > 0
						? collectTargetUrls
						: productGroups.map((g) => g.productUrl).filter(Boolean);
			const urls = Array.from(new Set((urlsRaw || []).map((u) => String(u || '').trim()).filter(Boolean)));
			let res: { data: ProductPageMetricsResponse[] };
			let collectorUsed = false;
			if (hostAgentStatus === 'connected' && urls.length > 0) {
				try {
					setCollectNowDetail(`Local Collector 수집 중: ${urls.length}개 URL`);
					const apiBase = target === 'nas' ? `http://${nasHost}:6188/api` : LOCAL_API_ORIGIN;
					const bearerToken = String((authHeaders as any)?.Authorization || (authHeaders as any)?.authorization || '').replace(/^Bearer\s+/i, '');
					for (const u of urls) {
						const job = await axios.post(
							apiUrlFor(target, '/search-rank/page-metrics/local-collector/jobs'),
							{ urls: [u], mode: 'page_metrics' },
							{
								headers:
									target === 'nas'
										? { ...buildErp2ClientIpHeaders(pickedIp || hostCdpIp), ...authHeaders }
										: authHeaders,
								timeout: 10_000,
							},
						);
						const jobId = String((job.data as any)?.job_id || '').trim();
						if (!jobId) throw new Error('collector_job_id_missing');
						const collectorResp = await fetch('http://127.0.0.1:9230/collector/run-once', {
							method: 'POST',
							cache: 'no-store',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ url: u, jobId, nasApiBaseUrl: apiBase, bearerToken }),
						});
						const collectorPayload = await collectorResp.json().catch(() => ({} as any));
						if (!collectorResp.ok || collectorPayload?.ok !== true) {
							throw new Error(String(collectorPayload?.error || `collector_http_${collectorResp.status}`));
						}
					}
					res = await axios.post<ProductPageMetricsResponse[]>(
						apiUrlFor(target, '/search-rank/page-metrics/batch'),
						{ urls },
						{ headers: target === 'nas' ? { ...buildErp2ClientIpHeaders(pickedIp || hostCdpIp), ...authHeaders } : authHeaders },
					);
					collectorUsed = true;
				} catch (e: any) {
					const msg = String(e?.message || e || '').trim();
					setCollectNowDetail(`Local Collector 실패, 기존 API 수집으로 전환합니다.${msg ? `\n- ${msg}` : ''}`);
					res = await axios.post<ProductPageMetricsResponse[]>(
						apiUrlFor(target, '/search-rank/page-metrics/collect-now'),
						{ urls },
						{
							params: target === 'nas' && pickedIp ? { client_ip: pickedIp } : undefined,
							headers:
								target === 'nas'
									? { ...buildErp2ClientIpHeaders(pickedIp || hostCdpIp), ...authHeaders }
									: authHeaders,
							timeout: 120_000,
						},
					);
				}
			} else {
				res = await axios.post<ProductPageMetricsResponse[]>(
					apiUrlFor(target, '/search-rank/page-metrics/collect-now'),
					{ urls },
					{
						params: target === 'nas' && pickedIp ? { client_ip: pickedIp } : undefined,
						headers:
							target === 'nas'
								? { ...buildErp2ClientIpHeaders(pickedIp || hostCdpIp), ...authHeaders }
								: authHeaders,
						timeout: 120_000,
					},
				);
			}
			const gotRows = Array.isArray(res.data) ? res.data : [];
			const map: Record<string, ProductPageMetricsResponse | null> = {};
			for (const row of gotRows) map[row.product_url] = row;
			setPageMetrics(map);

			// 1) 요청 URL이 명확한 경우: 기존 UX(남은 상품만 줄어드는 방식) 유지
			if (urls.length > 0) {
				const rem: string[] = [];
				let ok = 0;
				let fail = 0;
				let rateLimited = 0;
				for (const u of urls) {
					const r = map[u] ?? null;
					if (isValidTodayPageMetrics(r)) {
						ok += 1;
						continue;
					}
					rem.push(u);
					fail += 1;
					const hs = Number((r as any)?.http_status ?? 0) || 0;
					const err = String((r as any)?.error ?? '').toLowerCase();
					if (hs === 429 || err.includes('rate_limited') || err.includes('captcha')) rateLimited += 1;
				}
				setMissingTodayUrls(rem);

				const summary = `수집 결과(${target === 'nas' ? 'NAS' : '로컬'}${collectorUsed ? '/Collector' : ''}): 요청 ${urls.length} · 성공 ${ok} · 실패 ${fail}${
					rateLimited > 0 ? ` (제한/캡차 추정 ${rateLimited})` : ''
				}`;
				setCollectNowDetail(summary);
				notify(summary);
				if (fail > 0) {
					setScrapeOnceError(
						`${summary}\n- 실패가 계속되면: 3번(세션 준비)으로 호스트 크롬 창에서 로그인/보안확인을 완료하고 다시 시도하세요.`,
					);
				}
				return;
			}

			// 2) 요청 URL이 비어있던 경우(자동 seed 수집 등): 응답으로 온 URL 목록 기준으로 결과를 보여준다.
			const gotUrls = Array.from(new Set(gotRows.map((r) => String(r?.product_url || '').trim()).filter(Boolean)));
			if (gotUrls.length === 0) {
				const msg = '수집할 상품이 없습니다. (추적 상품이 없거나, 대상 URL이 비어 있습니다.)';
				setCollectNowDetail(msg);
				notify(msg);
				return;
			}
			let ok = 0;
			let fail = 0;
			let rateLimited = 0;
			for (const u of gotUrls) {
				const r = map[u] ?? null;
				if (isValidTodayPageMetrics(r)) {
					ok += 1;
					continue;
				}
				fail += 1;
				const hs = Number((r as any)?.http_status ?? 0) || 0;
				const err = String((r as any)?.error ?? '').toLowerCase();
				if (hs === 429 || err.includes('rate_limited') || err.includes('captcha')) rateLimited += 1;
			}
			const summary = `수집 결과(${target === 'nas' ? 'NAS' : '로컬'}${collectorUsed ? '/Collector' : ''}): 처리 ${gotUrls.length} · 성공 ${ok} · 실패 ${fail}${
				rateLimited > 0 ? ` (제한/캡차 추정 ${rateLimited})` : ''
			}`;
			setCollectNowDetail(summary);
			notify(summary);
			if (fail > 0) {
				setScrapeOnceError(
					`${summary}\n- 실패가 계속되면: 3번(세션 준비)으로 호스트 크롬 창에서 로그인/보안확인을 완료하고 다시 시도하세요.`,
				);
			}
		} catch (e: any) {
			console.error(e);
			const msg =
				e?.response?.data?.detail ??
				e?.response?.data?.message ??
				e?.response?.data?.error ??
				e?.message ??
				'수집 요청에 실패했습니다. (네트워크/서버 상태를 확인해 주세요)';
			setCollectNowDetail(`수집 실패(${target === 'nas' ? 'NAS' : '로컬'}): ${String(msg)}`);
			setScrapeOnceError(String(msg));
			if (String(msg).includes('host_cdp_required')) {
				notify(
					`호스트 크롬(CDP) 연결이 필수인데 연결에 실패했습니다. 1번(전용 크롬 실행)을 확인하고, ${
						target === 'nas' ? `NAS(${nasHost})` : '로컬'
					}에서 PC의 9223 포트로 접속이 가능하도록 방화벽을 허용한 뒤 다시 시도하세요.`,
				);
			}
		} finally {
			setCollectingNow(false);
			setCleanupReady(true);
		}
	};

	const runNextRankCollectInPlan = (): void => {
		const plan = rankCollectPlanRef.current;
		if (!plan) return;

		// URL 소진 → 다음 날짜로
		while (plan.dateIdx < plan.dates.length) {
			if (plan.urlIdx < plan.urls.length) break;
			plan.dateIdx += 1;
			plan.urlIdx = 0;
		}
		if (plan.dateIdx >= plan.dates.length) {
			rankCollectPlanRef.current = null;
			rankCollectBatchModeRef.current = false;
			notify('키워드 순위 수집(범위) 완료');
			return;
		}
		const targetDate = String(plan.dates[plan.dateIdx] || '').trim();
		// 여러 상품이면 동일 키워드 1회 수집(batch-by-keyword)으로 한 번에 처리
		if (plan.urls.length > 1) {
			const urlsThis = plan.urls.filter((u) => String(u || '').trim());
			if (urlsThis.length === 0 || !targetDate) {
				plan.dateIdx += 1;
				plan.urlIdx = 0;
				rankCollectPlanRef.current = plan;
				window.setTimeout(() => runNextRankCollectInPlan(), 50);
				return;
			}
			rankCollectBatchModeRef.current = true;
			rankCollectPlanRef.current = plan;
			void startRankCollectBatchByKeyword(urlsThis, targetDate);
			return;
		}
		const targetUrl = String(plan.urls[plan.urlIdx] || '').trim();
		if (!targetDate || !targetUrl) {
			plan.urlIdx += 1;
			rankCollectPlanRef.current = plan;
			window.setTimeout(() => runNextRankCollectInPlan(), 50);
			return;
		}
		rankCollectPlanRef.current = plan;
		void startRankCollectNowForProduct(targetUrl, targetDate);
	};

	const startRankCollectBatchByKeyword = async (urls: string[], targetDate: string): Promise<void> => {
		if (rankCollectingNow || rankCrawlJobId) return;
		const urls0 = urls.map((u) => String(u || '').trim()).filter(Boolean);
		if (urls0.length === 0) return;
		const date0 = String(targetDate || '').trim() || todayLocalStr;
		rankStatusDateRef.current = date0;
		setRankCollectingNow(true);
		setRankCrawlStatus(null);
		setRankCrawlDetail(null);
		const TOP_LIMIT = rankCrawlDepth || RANK_CRAWL_TOP_LIMIT;
		try {
			setRankCrawlDetail(
				`수집 시작(동일 키워드 1회): 상품 ${urls0.length}개 · 일자 ${date0}\n깊이: TOP${TOP_LIMIT}`,
			);
			const res = await axios.post(`${apiBaseUrl}/search-rank/crawl/category/batch-by-keyword`, {
				product_urls: urls0,
				date: date0,
				limit: TOP_LIMIT,
			});
			const job = String((res.data as any)?.job_id || '').trim();
			setRankCrawlJobId(job || null);
			setRankCrawlStatus(String((res.data as any)?.status || 'STARTED'));
			if (!job) setRankCrawlDetail('job_id를 받지 못했습니다.');
			// 시작 직후에도 한 번 갱신해서 "수집은 되는데 모달 반영이 늦다" 체감을 줄인다.
			void refreshRankStatusForUrls(urls0, date0);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '키워드 순위 수집(배치) 시작에 실패했습니다.';
			setRankCrawlStatus('FAILED');
			setRankCrawlDetail(String(msg));
			setRankCrawlJobId(null);
			rankCollectBatchModeRef.current = false;
		} finally {
			setRankCollectingNow(false);
		}
	};

	const startRankCollectNowForProduct = async (
		seed: string,
		targetDateStr?: string,
	): Promise<'OK' | 'SKIP_NO_KEYWORDS' | 'SKIP_NOTHING_TO_DO' | 'FAILED'> => {
		if (rankCollectingNow) return 'FAILED';
		const seed0 = String(seed || '').trim();
		if (!seed0) return 'FAILED';
		setRankCollectingNow(true);
		setRankCrawlStatus(null);
		setRankCrawlDetail(null);
		try {
			type ManualKwRow = { keyword: string };
			let allKeywords: string[] = [];
			try {
				const metaRes = await axios.get<ManualKwRow[]>(`${apiBaseUrl}/search-rank/manual-keywords`, { params: { product_url: seed0 } });
				const rows = Array.isArray(metaRes.data) ? metaRes.data : [];
				allKeywords = rows
					.map((r: any) => String(r?.keyword || '').trim())
					.filter(Boolean);
				// uniq keep order
				allKeywords = Array.from(new Set(allKeywords));
			} catch {
				allKeywords = [];
			}

			// (중요) 수집/상태(total_keywords)는 "등록된 키워드" 기준이다.
			// - 수기 키워드(월검색량) + tracked 키워드(핵심/그룹) 둘 다 포함될 수 있다.
			// - 한쪽만 수집하면 total 대비 processed가 영원히 100%가 되지 않아(예: 98%, 92%) 수집이 '멈춘 것처럼' 보인다.
			try {
				const seedKey = canonicalizeProductUrl(seed0) || seed0;
				const trackedForProduct = (trackedKeywords || [])
					.filter((k: any) => canonicalizeProductUrl(String(k?.product_url || '').trim()) === seedKey)
					.map((k: any) => String(k?.keyword || '').trim())
					.filter(Boolean);
				if (trackedForProduct.length > 0) {
					allKeywords = Array.from(new Set([...allKeywords, ...trackedForProduct]));
				}
			} catch {
				// ignore
			}
			if (allKeywords.length === 0) {
				setRankCrawlStatus('FAILED');
				setRankCrawlDetail('수기 키워드(월검색량) 목록이 0개입니다. (상세에서 월검색량 저장/업로드 또는 다른 상품에서 적용)');
				setRankCrawlJobId(null);
				return 'SKIP_NO_KEYWORDS';
			}

			const TOP_LIMIT = rankCrawlDepth || RANK_CRAWL_TOP_LIMIT;
			const targetDate = String(targetDateStr || todayLocalStr).trim() || todayLocalStr;
			rankStatusDateRef.current = targetDate;

			// 옵션: 미노출(0/없음) 키워드만 재수집
			if (rankCrawlMissingOnly) {
				try {
					const stRes = await axios.get<any>(`${apiBaseUrl}/search-rank/manual-keywords/crawl-today`, {
						params: { product_url: seed0, date: targetDate },
					});
					const items = Array.isArray(stRes?.data?.items) ? stRes.data.items : [];
					const missingSet = new Set<string>();
					for (const it of items) {
						const kw = String(it?.keyword || '').trim();
						if (!kw) continue;
						const rk = it?.rank;
						const n = typeof rk === 'number' ? rk : null;
						if (!n || n <= 0) missingSet.add(kw);
					}
					allKeywords = allKeywords.filter((k) => missingSet.has(k));
				} catch {
					// ignore
				}
			}

			// 정책 변경(요청): 수집 모달에서 "등록된 모든 키워드"를 수집한다(개수 제한 없음).
			if (allKeywords.length === 0) {
				setRankCrawlStatus('SUCCESS');
				setRankCrawlDetail(`스킵: 미노출 키워드가 없습니다.\n대상: ${seed0}\n일자: ${targetDate}`);
				setRankCrawlJobId(null);
				return 'SKIP_NOTHING_TO_DO';
			}

			setRankCrawlDetail(
				`수집 시작: 키워드 ${allKeywords.length.toLocaleString()}개\n깊이: TOP${TOP_LIMIT}${rankCrawlMissingOnly ? ' · 미노출만' : ''}\n대상: ${seed0}\n일자: ${targetDate}`,
			);
			const res = await axios.post(`${apiBaseUrl}/search-rank/crawl/category`, {
				product_url: seed0,
				scope: 'product',
				limit: TOP_LIMIT,
				keywords: allKeywords,
				date: targetDate,
			});
			const job = String((res.data as any)?.job_id || '').trim();
			setRankCrawlJobId(job || null);
			setRankCrawlStatus(String((res.data as any)?.status || 'STARTED'));
			if (!job) setRankCrawlDetail('job_id를 받지 못했습니다.');
			void refreshRankStatusForUrls([seed0], targetDate);
			return 'OK';
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '키워드 순위 수집 시작에 실패했습니다.';
			setRankCrawlStatus('FAILED');
			setRankCrawlDetail(String(msg));
			setRankCrawlJobId(null);
			return 'FAILED';
		} finally {
			setRankCollectingNow(false);
		}
	};

	const startRankCollectAllMissingProducts = async (): Promise<void> => {
		if (rankCollectingNow || rankCrawlJobId) return;
		const urls =
			missingRankUrls.length > 0
				? missingRankUrls
				: collectTargetUrls.length > 0
					? collectTargetUrls
					: productGroups.map((g) => g.productUrl).filter(Boolean);
		const uniq = Array.from(new Set((urls || []).map((u) => String(u || '').trim()).filter(Boolean)));
		if (uniq.length === 0) return;
		// 날짜 범위는 최대 30일까지로 제한한다(과도한 재수집 방지).
		const dates = buildDateRange(rankCollectDateFrom, rankCollectDateTo, 30);
		if (dates.length === 0) {
			notify('수집 일자 범위를 확인해 주세요. (YYYY-MM-DD)');
			return;
		}
		rankCollectPlanRef.current = { dates, dateIdx: 0, urls: uniq, urlIdx: 0 };
		runNextRankCollectInPlan();
	};

	// 키워드 순위 수집은 사용자가 모달의 버튼을 눌렀을 때만 시작한다.
	// 엑셀 업로드/상세 진입 중 자동 OpenAPI 수집이 끼어들면 업로드 반영 여부를 판단하기 어렵다.

	const deleteTodayCrawlAndRecollect = async (): Promise<void> => {
		if (rankCollectingNow) return;
		const urls =
			collectTargetUrls.length > 0 ? collectTargetUrls : productGroups.map((g) => g.productUrl).filter(Boolean);
		if (urls.length === 0) {
			notify('삭제 대상 상품 URL을 찾지 못했습니다.');
			return;
		}
		setRankCollectingNow(true);
		setRankCrawlStatus(null);
		setRankCrawlDetail(null);
		// 삭제 직후 잠깐의 상태 공백으로 모달이 자동 닫히는 걸 방지하기 위해,
		// 일단 "전부 미수집"으로 표시해두되, "등록된 키워드 수(total_keywords)"는 유지한다.
		// (요청) 등록 키워드 숫자는 항상 등록된 숫자가 나오도록 한다.
		setMissingRankUrls(urls);
		setRankStatusMap((prev) => {
			const next: Record<string, CrawlTodayStatusItem | null> = { ...(prev || {}) };
			for (const u of urls) {
				const url = String(u || '').trim();
				if (!url) continue;
				const old = (prev as any)?.[url] as CrawlTodayStatusItem | null | undefined;
				const total = Number(old?.total_keywords ?? 0);
				// total을 모르는 경우엔 0이 잠시 보일 수 있지만,
				// 아래 today-status 재조회가 즉시 total을 채운다.
				next[url] = {
					product_url: url,
					total_keywords: Number.isFinite(total) && total > 0 ? total : 0,
					covered_keywords: 0,
					exposed_keywords: 0,
					no_exposure_keywords: 0,
					missing_keywords: Array.isArray(old?.missing_keywords) ? old!.missing_keywords : [],
					sample_keyword: (old as any)?.sample_keyword ?? null,
					is_complete: false,
				} as any;
			}
			return next;
		});
		try {
			const res = await axios.post<{ deleted: number }>(`${apiBaseUrl}/search-rank/crawl/category/delete-today`, {
				product_urls: urls,
			});
			const deleted = Number((res.data as any)?.deleted || 0);
			notify(`오늘(크롤링) 데이터 삭제: ${deleted.toLocaleString()}건`);
			// 삭제 후 상태 재조회(남은 랭킹 URL 갱신)
			try {
				// NOTE: API는 배열을 직접 반환한다. (과거 {items:[]} 형태가 아니므로, 잘못 파싱하면 total=0처럼 보일 수 있다)
				const st = await axios.post<CrawlTodayStatusItem[]>(`${apiBaseUrl}/search-rank/crawl/today-status`, {
					product_urls: urls,
				});
				const items = Array.isArray(st.data) ? (st.data as any[]) : [];
				const map: Record<string, CrawlTodayStatusItem | null> = {};
				const miss: string[] = [];
				for (const it of items) {
					const u = String(it?.product_url || '').trim();
					if (!u) continue;
					map[u] = it as any;
					if (!(it as any)?.is_complete) miss.push(u);
				}
				setRankStatusMap(map);
				setMissingRankUrls(miss);
			} catch {
				// ignore
			}
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '오늘 데이터 삭제에 실패했습니다.';
			setRankCrawlStatus('FAILED');
			setRankCrawlDetail(String(msg));
			return;
		} finally {
			setRankCollectingNow(false);
		}
		// 바로 재수집 시작
		try {
			await startRankCollectAllMissingProducts();
		} catch {
			// ignore
		}
	};

	const cancelRankCrawlJob = useCallback(async (): Promise<void> => {
		const jid = String(rankCrawlJobId || '').trim();
		if (!jid) return;
		try {
			await axios.post(`${apiBaseUrl}/search-rank/crawl/category/cancel`, { job_id: jid });
			setRankCrawlStatus('CANCELLED');
			setRankCrawlDetail('사용자에 의해 수집이 취소되었습니다.');
			setRankCrawlJobId(null);
			notify('키워드 순위 수집을 취소했습니다.');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '수집 취소에 실패했습니다.';
			notify(String(msg));
		}
	}, [apiBaseUrl, rankCrawlJobId, notify]);

	/** 모달을 닫지 않고: 키워드 순위 job 취소 + UI 잠금 해제 + Host Chrome/Agent/captcha 정리 */
	const forceStopCollectScripts = useCallback(async (): Promise<void> => {
		if (forceStopCollectBusy) return;
		setForceStopCollectBusy(true);
		try {
			const uiSuggestsHostSession =
				hostSessionOpenedOnce || collectingNow || cleanupReady || Boolean(scrapeOnce) || Boolean(cdpDebug);
			const hostAgentReachable = uiSuggestsHostSession ? true : await probeLocalHostAgent();
			const hadAnyRunningWork = uiSuggestsHostSession || hostAgentReachable || rankCollectingNow || Boolean(rankCrawlJobId);
			if (!hadAnyRunningWork) {
				notify('현재 강제 종료할 수집 스크립트가 없거나 이미 종료되었습니다.');
				return;
			}
			await cancelRankCrawlJob();
			setCollectingNow(false);
			setRankCollectingNow(false);
			await teardownCollectModalHostProcesses(uiSuggestsHostSession || hostAgentReachable, true);
			setCleanupReady(false);
			setHostSessionOpenedOnce(false);
			setScrapeOnce(null);
			setScrapeOnceError(null);
			setCdpDebug(null);
			setCdpDebugError(null);
			setCollectNowDetail(null);
			notify('수집·호스트 스크립트를 강제 종료하고 자동 실행도 해제했습니다. 다시 필요하면 Host Agent 실행 파일로 직접 시작해 주세요.');
		} finally {
			setForceStopCollectBusy(false);
		}
	}, [
		forceStopCollectBusy,
		hostSessionOpenedOnce,
		collectingNow,
		cleanupReady,
		scrapeOnce,
		cdpDebug,
		rankCollectingNow,
		rankCrawlJobId,
		probeLocalHostAgent,
		cancelRankCrawlJob,
		teardownCollectModalHostProcesses,
		notify,
	]);

	// 키워드 순위 수집(job) 상태 폴링 → 완료 시 today-status 재조회로 missing 갱신
	// 진행 중(STARTED)에도 매 틱(2초)마다 today-status 호출 → 수집 % 실시간 갱신
	const rankPollTickRef = React.useRef(0);
	const rankPollUrlsRef = React.useRef<string[]>([]);
	useEffect(() => {
		if (!rankCrawlJobId) return;
		let cancelled = false;
		rankPollTickRef.current = 0;
		const tick = async () => {
			try {
				const st = await axios.get(`${apiBaseUrl}/search-rank/crawl/category/status`, { params: { job_id: rankCrawlJobId } });
				if (cancelled) return;
				const status = String((st.data as any)?.status || '').trim() || 'UNKNOWN';
				setRankCrawlStatus(status);
				setRankCrawlDetail((st.data as any)?.detail ? String((st.data as any).detail) : null);
				const dateForStatus = String(rankStatusDateRef.current || '').trim() || todayLocalStr;
				// 진행 중일 때 매 틱마다 today-status 재조회 → UI % 갱신 (ref에 최신 URL 목록 사용)
				if (status === 'STARTED') {
					try {
						const urlsForStatus = rankPollUrlsRef.current?.length ? rankPollUrlsRef.current : collectTargetUrls;
						if (urlsForStatus.length > 0) {
							const res2 = await axios.post<CrawlTodayStatusItem[]>(
								`${apiBaseUrl}/search-rank/crawl/today-status`,
								{ product_urls: urlsForStatus, date: dateForStatus },
							);
							if (cancelled) return;
							const arr = Array.isArray(res2.data) ? res2.data : [];
							const m: Record<string, CrawlTodayStatusItem | null> = {};
							for (const it of arr) {
								const u = String((it as any)?.product_url || '').trim();
								if (!u) continue;
								m[u] = it as any;
							}
							setRankStatusMap((prev) => ({ ...prev, ...m }));
							setRankDataVersion((v) => v + 1);

							// (구조적 UX 개선) 서버 job status가 STARTED로 늦게 갱신되더라도,
							// today-status 기준으로 "전부 완료(100%)"면 UI 폴링을 즉시 종료한다.
							// - 사용자가 보기엔 이미 완료인데 Network 호출만 계속되는 문제 방지.
							let allComplete = true;
							for (const u of urlsForStatus) {
								const st0 = m[String(u || '').trim()] ?? null;
								if (!st0 || !(st0 as any).is_complete) {
									allComplete = false;
									break;
								}
							}
							if (allComplete) {
								setMissingRankUrls([]);
								setRankCrawlStatus('SUCCESS');
								setRankCrawlDetail('완료(모달 기준): 모든 상품이 100% 처리되었습니다.');
								setRankCrawlJobId(null);
								setRankNotFoundCount(0);
								// 플랜이 있으면 다음(상품/날짜)으로 이어서 진행한다.
								const p = rankCollectPlanRef.current;
								if (p) {
									if (rankCollectBatchModeRef.current) {
										rankCollectBatchModeRef.current = false;
										p.dateIdx += 1;
										p.urlIdx = 0;
										rankCollectPlanRef.current = p;
										window.setTimeout(() => runNextRankCollectInPlan(), 120);
									} else {
										p.urlIdx += 1;
										rankCollectPlanRef.current = p;
										window.setTimeout(() => runNextRankCollectInPlan(), 120);
									}
								}
								return;
							}
						}
					} catch {
						// today-status 실패는 무시(다음 틱에 재시도)
					}
				}
				if (status === 'SUCCESS' || status === 'PARTIAL') {
					if (status === 'PARTIAL') {
						notify('키워드 순위 수집이 일부만 완료되었습니다. (OpenAPI 오류/제한 가능) 상세 내용을 확인해 주세요.');
					}
					// 완료: 최신 상태 재조회(미수집 URL/커버리지 갱신)
					setRankCrawlJobId(null);
					setRankNotFoundCount(0);
					try {
						const urlsForStatus = rankPollUrlsRef.current?.length ? rankPollUrlsRef.current : collectTargetUrls;
						const res2 = await axios.post<CrawlTodayStatusItem[]>(
							`${apiBaseUrl}/search-rank/crawl/today-status`,
							{ product_urls: urlsForStatus, date: dateForStatus },
						);
						const arr = Array.isArray(res2.data) ? res2.data : [];
						const m: Record<string, CrawlTodayStatusItem | null> = {};
						for (const it of arr) {
							const u = String((it as any)?.product_url || '').trim();
							if (!u) continue;
							m[u] = it as any;
						}
						setRankStatusMap(m);
						const missingRanks: string[] = [];
						for (const u of urlsForStatus) {
							const it = m[u] ?? null;
							if (!it) continue;
							if (!(it as any)?.is_complete) missingRanks.push(u);
						}
						setMissingRankUrls(missingRanks);
						setRankDataVersion((v) => v + 1);
					} catch {}
					// 플랜이 있으면 다음(상품/날짜)으로 이어서 진행한다.
					const p = rankCollectPlanRef.current;
					if (p) {
						if (rankCollectBatchModeRef.current) {
							rankCollectBatchModeRef.current = false;
							p.dateIdx += 1;
							p.urlIdx = 0;
							rankCollectPlanRef.current = p;
							window.setTimeout(() => runNextRankCollectInPlan(), 120);
						} else {
							p.urlIdx += 1;
							rankCollectPlanRef.current = p;
							window.setTimeout(() => runNextRankCollectInPlan(), 120);
						}
					}
				}
				if (status === 'CANCELLED') {
					// 취소는 완료 상태로 간주하되, 플랜 자동 진행은 하지 않는다.
					setRankCrawlJobId(null);
					setRankNotFoundCount(0);
				}
				if (status === 'FAILED') {
					setRankCrawlJobId(null);
					setRankNotFoundCount(0);
					const p = rankCollectPlanRef.current;
					if (p) {
						if (rankCollectBatchModeRef.current) {
							rankCollectBatchModeRef.current = false;
							p.dateIdx += 1;
							p.urlIdx = 0;
						} else {
							p.urlIdx += 1;
						}
						rankCollectPlanRef.current = p;
						window.setTimeout(() => runNextRankCollectInPlan(), 180);
					}
				}
				// NOT_FOUND는 시작 직후 레이스일 수 있어 몇 번은 기다린다.
				if (status === 'NOT_FOUND') {
					setRankNotFoundCount((prev) => {
						const next = prev + 1;
						if (next >= 5) {
							setRankCrawlJobId(null);
							return 0;
						}
						return next;
					});
				} else {
					setRankNotFoundCount(0);
				}
			} catch (e) {
				if (cancelled) return;
				setRankCrawlStatus('FAILED');
				setRankCrawlDetail('상태 조회에 실패했습니다.');
				setRankCrawlJobId(null);
				setRankNotFoundCount(0);
			}
		};
		void tick();
		const id = window.setInterval(() => void tick(), 2000);
		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
	}, [apiBaseUrl, rankCrawlJobId, collectTargetUrls]);

	// (중요) 수집 모달 오픈 시 자동 진단(scrape-once) 금지
	// - 모달이 열리는 순간 컨테이너 세션으로 즉시 접근하면(특히 네이버 쇼핑/스마트스토어)
	//   "blocked_after_search_title / http=403" 등으로 100% 차단되는 환경이 존재한다.
	// - 자동 진단은 사용자가 CDP(호스트 크롬)에서 로그인/보안확인을 마치기 전에 트리거되어
	//   오히려 세션을 오염시키거나(차단 플래그) UX를 악화시킨다.
	// - 따라서 진단은 "진단 새로고침(고급)" 버튼을 눌렀을 때만 수행한다.

	// 모든 상품이 완료되면 모달을 자동으로 닫는다.
	useEffect(() => {
		if (!isCollectPopupOpen) return;
		if (collectPopupReadOnly) return;
		// 수동으로 연 모달은 auto-close를 하지 않는다.
		if (!collectPopupAutoClose) return;
		if (collectTargetUrls.length === 0) return;
		// 사용자가 "삭제/수집/배치 수집"을 눌러 진행 중인 동안에는 자동 닫힘을 절대 하지 않는다.
		if (collectingNow) return;
		// 수집이 끝나 정리 버튼이 열린 상태에서는 사용자가 결과를 확인하고
		// 직접 닫는 순간에만 호스트 정리를 수행한다.
		if (cleanupReady) return;
		if (rankCollectingNow) return;
		if (rankCrawlJobId) return;
		// 메트릭/키워드 중 하나라도 미수집이 있으면 닫지 않는다.
		if (missingTodayUrls.length !== 0) return;
		if (missingRankUrls.length !== 0) return;
		const t = window.setTimeout(() => {
			void closeCollectPopup();
		}, 650);
		return () => window.clearTimeout(t);
	}, [
		isCollectPopupOpen,
		collectPopupReadOnly,
		collectPopupAutoClose,
		collectTargetUrls.length,
		missingTodayUrls.length,
		missingRankUrls.length,
		collectingNow,
		cleanupReady,
		rankCollectingNow,
		rankCrawlJobId,
		closeCollectPopup,
	]);

	const hasUsefulPageMetrics = (m: ProductPageMetricsResponse | null): boolean => {
		return (
			Boolean(m?.title) ||
			m?.price != null ||
			m?.review_count != null ||
			m?.rating != null ||
			m?.wish_count != null ||
			Boolean(m?.registered_date)
		);
	};

	const isTodayBaseMetricsOk = (m: ProductPageMetricsResponse | null): boolean => {
		if (!m) return false;
		if (m.date !== todayLocalStr) return false;
		if (m.error) return false;
		if (typeof m.http_status === 'number' && m.http_status !== 200) return false;
		return hasUsefulPageMetrics(m);
	};

	const isPurchaseCollectedToday = (m: ProductPageMetricsResponse | null): boolean => {
		if (!isTodayBaseMetricsOk(m)) return false;
		// "판매정보"는 재구매가 아닌 '구매'만을 의미한다.
		// - 재구매는 참고용이므로 완료 판정/연산에 포함하지 않는다.
		const status = String((m as any)?.recent_purchase_status ?? '').trim();
		if (status !== 'collected') return false;
		// 최신 정책: 고정 윈도우(7d) 값이 있으면 그걸로 완료 판정
		const cnt7d = (m as any)?.recent_purchase_7d_count;
		if (typeof cnt7d === 'number' && cnt7d >= 0) return true;
		// 호환: (count + window) 조합도 허용
		const cnt = (m as any)?.recent_purchase_count;
		const win = String((m as any)?.recent_purchase_window ?? '').trim();
		return typeof cnt === 'number' && cnt >= 0 && win.length > 0;
	};

	const isBadgeNoBadgeToday = (m: ProductPageMetricsResponse | null): boolean => {
		if (!isTodayBaseMetricsOk(m)) return false;
		const status = String((m as any)?.recent_purchase_status ?? '').trim();
		return status === 'no_badge';
	};

	const isWishCollectedToday = (m: ProductPageMetricsResponse | null): boolean => {
		if (!isTodayBaseMetricsOk(m)) return false;
		const w = m?.wish_count;
		return typeof w === 'number' && w >= 0;
	};

	const isRegisteredDateCollected = (m: ProductPageMetricsResponse | null): boolean => {
		if (!isTodayBaseMetricsOk(m)) return false;
		const d = String(m?.registered_date ?? '').trim();
		// yyyy-mm-dd or yyyy.mm.dd
		return /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(d);
	};

	// "수집 완료" 기준(완화):
	// - 오늘 날짜
	// - error 없음
	// - http_status=200
	// - title/price/review/rating 중 하나라도 존재
	// - (정책 변경) 판매정보(최근 1주 구매 배지)는 상품별로 원래 없거나 노출이 불안정하므로
	//   수집/완료 판정에서 제외한다. (있으면 저장/표시만 한다)
	const isValidTodayPageMetrics = (m: ProductPageMetricsResponse | null): boolean => {
		// 내 상품 추적 → 상품지수분석(점수)로 이어지는 파이프라인 기준:
		// - 찜 + 등록일이 모두 있어야 "완료"로 간주한다.
		return isWishCollectedToday(m) && isRegisteredDateCollected(m);
	};

	// 수집 모달 전용 "완료" 판정:
	// - 정상 완료(구매 7d 수집됨) 또는
	// - 배지 없음(no_badge)으로 판정된 경우(=자동 수집 대상에서 제외, 수기 입력으로 보강)
	const isDoneForCollectModal = (m: ProductPageMetricsResponse | null): boolean => {
		if (isValidTodayPageMetrics(m)) return true;
		if (isBadgeNoBadgeToday(m)) return isWishCollectedToday(m) && isRegisteredDateCollected(m);
		return false;
	};

	const isFullTodayPageMetrics = (m: ProductPageMetricsResponse | null): boolean => {
		if (!m || !isValidTodayPageMetrics(m)) return false;
		const hasReviewCount = m.review_count != null;
		const hasRating = m.rating != null;
		return hasReviewCount && hasRating && hasUsefulPageMetrics(m);
	};

	const buildPageMetricsStatusText = (s: PageMetricsStatusResponse | null): string | null => {
		if (!s?.status || s.status === 'IDLE') return null;
		const st = String(s.status).toUpperCase();
		// 서버 job status(SUCCESS)만으로 "완료"로 판단하지 말고, 실제 batch 데이터 기준으로 유효 건수를 함께 표시한다.
		const urlsForStatus = productGroups.map((g) => g.productUrl).filter(Boolean);
		const total = urlsForStatus.length;
		const valid = urlsForStatus.filter((u) => isValidTodayPageMetrics(pageMetrics[u] ?? null)).length;
		if (st === 'SUCCESS') {
			if (total > 0 && valid < total) return `상품 상세 메트릭: 유효 ${valid}/${total} (미수집 존재)`;
			if (total > 0) return `상품 상세 메트릭: 오늘 동기화 완료(유효 ${valid}/${total})`;
			return '상품 상세 메트릭: 오늘 동기화 완료';
		}
		if (st === 'STARTED') return '상품 상세 메트릭: 동기화 진행 중…';
		if (st === 'FAILED') {
			const next = s.next_retry_at ? ` (다음 재시도: ${String(s.next_retry_at).slice(11, 19)})` : '';
			return `상품 상세 메트릭: 실패(${s.detail || 'unknown'})${next}`;
		}
		return `상품 상세 메트릭: ${String(s.status)}`;
	};
	// 키워드 추가/편집 모달
	const [isKeywordModalOpen, setIsKeywordModalOpen] = useState(false);
	const [keywordDraft, setKeywordDraft] = useState('');
	const [keywordListDraft, setKeywordListDraft] = useState<string[]>([]);

	// 기간 → days 매핑 (백엔드 search-rank/history 쿼리 파라미터)
	const daysForPeriod = (p: RankTrackingDetailPeriod): number => {
		switch (p) {
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
	};

	// 추적 키워드 + 랭킹 히스토리 로딩
	useEffect(() => {
		let cancelled = false;
		const fetchData = async () => {
			setLoading(true);
			setError(null);
			try {
				// (핵심) 리스트 화면 진입 성능:
				// - 페이지 진입에서 크롤링/동기화(fetch-today, refresh-product-metadata 등)를 자동으로 돌리지 않는다.
				// - DB에 저장된 값(오늘 rank/delta 포함)을 즉시 받아 1~2초 내 리스트를 렌더링한다.
				//
				// 상세(차트/기간)용 history는 '선택된 상품' 기준의 별도 effect에서 로딩한다.
				const trackedRes = await axios.get<TrackedProductKeyword[]>(`${apiBaseUrl}/search-rank/tracked`, {
					params: { include_today_rank: 1 },
				});
				if (cancelled) return;
				setTrackedKeywords(trackedRes.data);
				// 리스트 모드에서는 전체 history를 미리 로딩하지 않는다(느린 초기 로딩 방지).
				setHistory((prev) => prev ?? { dates: [], series: [] });
			} catch (e) {
				if (!cancelled) {
					console.error(e);
					setError('데이터를 불러오는 중 오류가 발생했습니다.');
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		void fetchData();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, period, rankDataVersion]);

	// URL 기준 상품 그룹 구성
	const productGroups = useMemo(
		() => buildProductGroups(trackedKeywords),
		[trackedKeywords],
	);

	// 수집 폴링 시 today-status에 넘길 URL 목록(매 렌더마다 ref 갱신 → 폴링 시 항상 최신 목록 사용)
	rankPollUrlsRef.current =
		collectTargetUrls.length > 0 ? collectTargetUrls : (productGroups || []).map((g) => g?.productUrl).filter(Boolean);

	// todayLocalStr는 상단에서 선언(자동 수집 effect에서 사용)

	// pageMetrics(batch)가 갱신되면 상단 상태 문구도 함께 갱신되도록 한다.
	// (status를 먼저 받아온 뒤 batch 결과가 늦게 도착하면 "유효 0/3"처럼 stale 상태가 남을 수 있음)
	useEffect(() => {
		setPageMetricsStatusText(buildPageMetricsStatusText(pageMetricsStatus));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pageMetricsStatus, pageMetrics, productGroups, todayLocalStr]);

	// 4-2(리스트) 화면 진입 시: 컨테이너 내부에서 '일 1회' 페이지 메트릭 동기화 트리거
	// - 화면 진입이 느려지지 않도록 백엔드에서 BackgroundTasks로 수행
	useEffect(() => {
		let cancelled = false;
		let timer: any = null;
		if (viewMode !== 'list') return;
		if (productGroups.length === 0) return;

		const urls = productGroups.map((g) => g.productUrl).filter(Boolean);

		const trigger = async () => {
			try {
				const st = await axios.get<PageMetricsStatusResponse>(`${apiBaseUrl}/search-rank/page-metrics/status`);
				if (!cancelled) {
					setPageMetricsStatus(st.data);
					setPageMetricsStatusText(buildPageMetricsStatusText(st.data));
				}
			} catch {}

			// (중요) 자동 동기화 옵션이 켜진 경우에만 sync-today를 호출한다.
			// - 일부 환경에서는 컨테이너 기반 자동 접근이 403을 100% 유발할 수 있으므로 기본 OFF
			if (pageMetricsAutoSync) {
				// 상태에 따라 자동 트리거(하루 10회 미만 진입을 고려해, 쿨다운이면 스킵)
				try {
					const res = await axios.post(`${apiBaseUrl}/search-rank/page-metrics/sync-today`);
					if (!cancelled) {
						// scheduled=false/cooldown 등도 내려올 수 있음
						void res;
					}
				} catch (e) {
					console.error('page-metrics sync-today failed', e);
				}

				// 트리거 후 상태 갱신
				try {
					const st2 = await axios.get<PageMetricsStatusResponse>(`${apiBaseUrl}/search-rank/page-metrics/status`);
					if (!cancelled) {
						setPageMetricsStatus(st2.data);
						setPageMetricsStatusText(buildPageMetricsStatusText(st2.data));
					}
				} catch {}
			}

			try {
				const res = await axios.post<ProductPageMetricsResponse[]>(
					`${apiBaseUrl}/search-rank/page-metrics/batch`,
					{ urls },
				);
				if (cancelled) return;
				const map: Record<string, ProductPageMetricsResponse | null> = {};
				for (const row of res.data || []) {
					map[row.product_url] = row;
				}
				setPageMetrics(map);

				// 1) 상품 상세 메트릭(리뷰/평점) 미수집 판정
				// - 정책: recent_purchase_status=no_badge 인 상품은 "배지 없음"으로 표시하고 수집 대상에서 제외한다.
				const missingMetrics: string[] = [];
				for (const u of urls) {
					const r = map[u] ?? null;
					if (!isDoneForCollectModal(r)) missingMetrics.push(u);
				}
				setMissingTodayUrls(missingMetrics);

				// 2) 키워드 순위(수기 키워드 기준) 미수집 판정
				let missingRanksLocal: string[] = [];
				try {
					const res2 = await axios.post<CrawlTodayStatusItem[]>(
						`${apiBaseUrl}/search-rank/crawl/today-status`,
						{ product_urls: urls },
					);
					const arr = Array.isArray(res2.data) ? res2.data : [];
					const m: Record<string, CrawlTodayStatusItem | null> = {};
					for (const it of arr) {
						const u = String((it as any)?.product_url || '').trim();
						if (!u) continue;
						m[u] = it as any;
					}
					setRankStatusMap(m);
					const missingRanks: string[] = [];
					for (const u of urls) {
						const st = m[u] ?? null;
						if (!st) continue;
						// 완료 판정은 backend의 is_complete를 신뢰한다.
						// - total_keywords=0(키워드 없음)도 is_complete=false로 내려오며, 이 경우에도 팝업 대상에 포함되어야 한다.
						if (!(st as any)?.is_complete) missingRanks.push(u);
					}
					missingRanksLocal = missingRanks;
					setMissingRankUrls(missingRanksLocal);
				} catch (e) {
					// 순위 상태 조회 실패는 치명적이지 않다(기존 화면 유지)
					console.error('crawl today-status failed', e);
				}

				// 3) "오늘 수집" 팝업 자동 오픈(한 번만, 단 사용자가 auto-open을 켠 경우에만)
				// 키워드 순위(OpenAPI)는 엑셀 업로드 원본과 섞이면 안 되므로 자동팝업/자동수집 대상에서 제외한다.
				if (collectModalAutoOpen && !collectPopupShownOnceRef.current && missingMetrics.length > 0) {
					collectPopupShownOnceRef.current = true;
					setCollectTargetUrls(urls);
					setCollectPopupAutoClose(true);
					setHostSessionOpenedOnce(false);
					openCollectPopup();
				}
			} catch (e) {
				console.error('page-metrics batch failed', e);
			}

			// 백그라운드 동기화가 끝난 후 값을 반영할 수 있도록 1회 재조회(짧게)
			timer = setTimeout(async () => {
				if (cancelled) return;
				try {
					const res = await axios.post<ProductPageMetricsResponse[]>(
						`${apiBaseUrl}/search-rank/page-metrics/batch`,
						{ urls },
					);
					if (cancelled) return;
					const map: Record<string, ProductPageMetricsResponse | null> = {};
					for (const row of res.data || []) map[row.product_url] = row;
					setPageMetrics(map);
				} catch {}
				try {
					const st = await axios.get<PageMetricsStatusResponse>(`${apiBaseUrl}/search-rank/page-metrics/status`);
					if (!cancelled) {
						setPageMetricsStatus(st.data);
						setPageMetricsStatusText(buildPageMetricsStatusText(st.data));
					}
				} catch {}
			}, 3500);
		};

		void trigger();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [apiBaseUrl, viewMode, productGroups, todayLocalStr, collectModalAutoOpen, pageMetricsAutoSync]);

	// 뷰 모드가 바뀌면(예: 상세 진입 후 다시 리스트로) 팝업 1회 오픈 플래그를 초기화
	useEffect(() => {
		if (viewMode !== 'list') return;
		collectPopupShownOnceRef.current = false;
		setCollectTargetUrls([]);
		setMissingTodayUrls([]);
		setMissingRankUrls([]);
	}, [viewMode, selectedProductId]);

	// 리스트용 상품 메타 정보 로딩:
	// - 각 상품 그룹의 대표 키워드 + 상품 URL 기준으로 product-metadata 조회
	// - URL(productId) 기준으로 정확한 상품명/이미지/가격/몰명을 가져온다.
	useEffect(() => {
		let cancelled = false;
		if (productGroups.length === 0) {
			setListMetas({});
			return;
		}

		const loadListMetas = async () => {
			// 성능(중요):
			// - 기존: 상품 수만큼 /product-metadata 를 N번 호출 (smartstore는 HTML/Shop API까지 타서 매우 느려질 수 있음)
			// - 개선: 배치(FAST/CACHED) 엔드포인트로 1회 호출 + 서버 DB 캐시만 사용
			try {
				const items = productGroups.map((group) => ({
					id: group.id,
					keyword: group.keywords[0]?.keyword ?? '',
					product_url: group.productUrl ?? null,
				}));
				const res = await axios.post<Record<string, ProductMetadataResponse | null>>(
					`${apiBaseUrl}/search-rank/product-metadata/batch`,
					{ items },
					{ timeout: 20000 },
				);
				if (!cancelled) setListMetas(res.data || {});
				return;
			} catch (e) {
				// 구버전 API(배치 미배포) 대비 fallback
				const entries: Record<string, ProductMetadataResponse | null> = {};
				await Promise.all(
					productGroups.map(async (group) => {
						const repKeyword = group.keywords[0]?.keyword;
						const url = group.productUrl;
						if (!repKeyword || !url || url === 'N/A') {
							entries[group.id] = null;
							return;
						}
						try {
							const res = await axios.get<ProductMetadataResponse>(
								`${apiBaseUrl}/search-rank/product-metadata`,
								{
									params: {
										keyword: repKeyword,
										product_url: url,
									},
									timeout: 20000,
								},
							);
							if (cancelled) return;
							entries[group.id] = res.data;
						} catch (e2) {
							if (!cancelled) {
								console.error(e2);
								entries[group.id] = null;
							}
						}
					}),
				);
				if (!cancelled) setListMetas(entries);
			}
		};

		void loadListMetas();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, productGroups, rankDataVersion]);

	// URL 기준 상품별 랭킹 히스토리 로딩:
	// - 각 상품 URL 별로 /search-rank/history?product_url=... 호출
	// - 결과는 상품+키워드 조합 기준 순위/순위변동 계산에 사용
	useEffect(() => {
		let cancelled = false;
		if (productGroups.length === 0) {
			setPerProductHistory({});
			return;
		}

		const loadPerProductHistory = async () => {
			// 성능(중요): 배치로 1회 호출(HTTP/병렬 DB 부하 감소)
			try {
				const items = productGroups.map((g) => ({
					id: g.id,
					product_url: g.productUrl ?? null,
				}));
				const res = await axios.post<Record<string, ProductRankHistoryResponse | null>>(
					`${apiBaseUrl}/search-rank/history/batch`,
					{ items },
					{
						params: { days: daysForPeriod(period) },
						timeout: 20000,
					},
				);
				if (!cancelled) setPerProductHistory(res.data || {});
				return;
			} catch (e) {
				// 구버전 API(배치 미배포) 대비 fallback
				const entries: Record<string, ProductRankHistoryResponse | null> = {};
				await Promise.all(
					productGroups.map(async (group) => {
						const url = group.productUrl;
						if (!url || url === 'N/A') {
							entries[group.id] = null;
							return;
						}
						try {
							const res = await axios.get<ProductRankHistoryResponse>(
								`${apiBaseUrl}/search-rank/history`,
								{
									params: {
										days: daysForPeriod(period),
										product_url: url,
									},
									timeout: 20000,
								},
							);
							if (cancelled) return;
							entries[group.id] = res.data;
						} catch (e2) {
							if (!cancelled) {
								console.error(e2);
								entries[group.id] = null;
							}
						}
					}),
				);
				if (!cancelled) setPerProductHistory(entries);
			}
		};

		void loadPerProductHistory();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, productGroups, period, rankDataVersion]);

	// 리스트용 상품 요약 정보 로딩:
	// - 각 상품 그룹의 대표 키워드 + 상품 URL 기준으로 product-summary 조회
	// - 백엔드는 productId 매칭을 우선 시도하므로, 서로 다른 URL 은 서로 다른 상품명/이미지로 노출된다.
	useEffect(() => {
		let cancelled = false;
		if (productGroups.length === 0) {
			setListSummaries({});
			return;
		}

		const loadListSummaries = async () => {
			// 성능(중요): 배치로 1회 호출(HTTP/병렬 DB 부하 감소)
			try {
				const items = productGroups.map((group) => ({
					id: group.id,
					keyword: group.keywords[0]?.keyword ?? '',
					product_url: group.productUrl ?? null,
				}));
				const res = await axios.post<Record<string, ProductSummaryResponse | null>>(
					`${apiBaseUrl}/search-rank/product-summary/batch`,
					{ items },
					{ timeout: 20000 },
				);
				if (!cancelled) setListSummaries(res.data || {});
				return;
			} catch (e) {
				// 구버전 API(배치 미배포) 대비 fallback
				const entries: Record<string, ProductSummaryResponse | null> = {};
				await Promise.all(
					productGroups.map(async (group) => {
						const repKeyword = group.keywords[0]?.keyword;
						if (!repKeyword) {
							entries[group.id] = null;
							return;
						}
						const url = group.productUrl;
						try {
							const res = await axios.get<ProductSummaryResponse>(
								`${apiBaseUrl}/search-rank/product-summary`,
								{ params: { keyword: repKeyword, product_url: url }, timeout: 20000 },
							);
							if (cancelled) return;
							entries[group.id] = res.data;
						} catch (e2) {
							if (!cancelled) {
								console.error(e2);
								entries[group.id] = null;
							}
						}
					}),
				);
				if (!cancelled) setListSummaries(entries);
			}
		};

		void loadListSummaries();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, productGroups, rankDataVersion]);

	// 리스트 뷰용 상품 요약 데이터
	const listItems: TrackedProductListItem[] = useMemo(() => {
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

		const estimateToDays = (count: number | null | undefined, window: string | null | undefined, targetDays: number): number | null => {
			if (typeof count !== 'number' || count < 0) return null;
			const days = parseWindowDays(window);
			if (!days || days <= 0) return null;
			return Math.max(0, Math.round((count * targetDays) / days));
		};

		const estimatePurchase7d = (m: ProductPageMetricsResponse | null): number | null => {
			if (!m) return null;
			const v7 = (m as any)?.recent_purchase_7d_count;
			if (typeof v7 === 'number' && v7 >= 0) return v7;
			return estimateToDays((m as any)?.recent_purchase_count, (m as any)?.recent_purchase_window, 7);
		};

		const estimateRepurchase3m = (m: ProductPageMetricsResponse | null): number | null => {
			if (!m) return null;
			const v3m = (m as any)?.recent_repurchase_3m_count;
			if (typeof v3m === 'number' && v3m >= 0) return v3m;
			return estimateToDays((m as any)?.recent_repurchase_count, (m as any)?.recent_repurchase_window, 90);
		};

		return productGroups.map((group, index) => {
			const summary = listSummaries[group.id] ?? null;
			const meta = listMetas[group.id] ?? null;
			const metrics = pageMetrics[group.id] ?? null;
			const groupHistory = perProductHistory[group.id] ?? null;
			const keywords = group.keywords.map((k) => {
				// 리스트 로딩 최적화:
				// - history 전체 조회 없이, 백엔드가 내려준 "오늘 rank/delta(저장값)"를 우선 사용한다.
				// - 값이 없으면(오늘 미수집) UI는 '-'로 표시한다.
				const r = typeof (k as any)?.today_rank === 'number' ? Number((k as any).today_rank) : null;
				const d = typeof (k as any)?.today_delta === 'number' ? Number((k as any).today_delta) : null;
				if (r == null && d == null) {
					// IMPORTANT: 리스트는 "이 상품 URL"에 대한 히스토리만 표시한다.
					// 상품별 히스토리가 없을 때 전체(history)로 fallback하면 다른 상품 순위가 섞여 '가짜 1위'가 된다.
					const s = getLatestRankSummary(groupHistory as any, k.keyword);
					return { keyword: k.keyword, rank: s.rank, delta: s.delta };
				}
				return { keyword: k.keyword, rank: r, delta: d };
			});
			const dateLabel = todayLocalStr.replace(/-/g, '/');
			const baseOk = isTodayBaseMetricsOk(metrics);
			const salesOk = isValidTodayPageMetrics(metrics);
			const noBadge = (() => {
				const st = String((metrics as any)?.recent_purchase_status ?? '').trim();
				return st === 'no_badge';
			})();
			const full = isFullTodayPageMetrics(metrics);
			const http = typeof metrics?.http_status === 'number' ? `HTTP ${metrics.http_status}` : 'HTTP ?';
			const err = metrics?.error ? ` / ${metrics.error}` : '';
			const statusTitle = `${http}${err}`;
			// 정상수집: 구매(판매정보)까지 포함해 충분히 수집됨
			// 부분수집: 리뷰/평점/가격 등은 있지만 구매(판매정보)가 비어있음(재수집 필요)
			const statusLabel = full ? '정상수집' : noBadge ? '배지없음' : salesOk || baseOk ? '부분수집' : '미수집';
			const estSales7d = estimatePurchase7d(metrics);
			const estRepurchase3m = estimateRepurchase3m(metrics);
			const displayName = deriveTrackedProductLabel({
				url: group.productUrl || group.displayUrl || '',
				index1: index + 1,
				metaTitle: meta?.title ?? null,
				summaryTitle: summary?.product_title ?? null,
				metricsTitle: metrics?.title ?? null,
			});
			return {
				id: group.id,
				// 리스트 상품명도 공통 안전 라벨 유틸을 사용해
				// "키워드가 상품명으로 보이는 오염"을 방지한다.
				name: displayName,
				imageUrl: meta?.image_url ?? summary?.image_url ?? null,
				sellerName: meta?.site_name ?? summary?.mall_name ?? null,
				// summary.price가 "기본값 0"으로 내려오는 케이스(매칭 실패)는 가격으로 쓰지 않는다.
				price: meta?.price ?? (summary?.price && summary.price > 0 ? summary.price : null) ?? null,
				// 리뷰는 purchase_cnt로 대체하면 다른 의미의 수치가 섞여 보이므로(오표기) fallback하지 않는다.
				reviewCount: metrics?.review_count ?? null,
				rating: metrics?.rating ?? null,
				keywords,
				pageMetricsStatusText: `${dateLabel} ${statusLabel}`,
				pageMetricsStatusOk: baseOk,
				pageMetricsStatusTitle: statusTitle,
				pageMetricsDate: metrics?.date ? String(metrics.date) : null,
				pageMetricsTitle: metrics?.title ?? null,
				pageMetricsPrice: metrics?.price ?? null,
				pageMetricsReviewCount: metrics?.review_count ?? null,
				pageMetricsRating: metrics?.rating ?? null,
				pageMetricsWishCount: metrics?.wish_count ?? null,
				pageMetricsRegisteredDate: metrics?.registered_date ?? null,
				// 출력 정책: 최근 1주 구매 / 최근 3개월 재구매(참고)
				pageMetricsRecentPurchaseCount: estSales7d,
				pageMetricsRecentPurchaseWindow: estSales7d != null ? '7d' : null,
				pageMetricsRecentRepurchaseCount: estRepurchase3m,
				pageMetricsRecentRepurchaseWindow: estRepurchase3m != null ? '3m' : null,
				pageMetricsRecentBadgeText: metrics?.recent_badge_text ?? null,
				pageMetricsHttpStatus: typeof metrics?.http_status === 'number' ? metrics.http_status : null,
				pageMetricsError: metrics?.error ?? null,
			};
		});
	}, [productGroups, history, listSummaries, perProductHistory, listMetas, pageMetrics, todayLocalStr]);

	const selectedGroup: ProductGroup | null = useMemo(
		() =>
			productGroups.find((g) => g.id === selectedProductId) ??
			(productGroups.length > 0 && viewMode === 'detail'
				? productGroups[0]!
				: null),
		[productGroups, selectedProductId, viewMode],
	);

	// 상세 화면: 수기 키워드(월검색량) 목록 기준 히스토리 로딩 (text + openapi)
	useEffect(() => {
		let cancelled = false;
		if (viewMode !== 'detail' || !selectedGroup?.productUrl || selectedGroup.productUrl === 'N/A') {
			setManualHistory(null);
			return;
		}
		const load = async () => {
			try {
				// 수기 키워드 데일리 표는 "표 기간"을 우선한다(기본 90일).
				const baseDays = Math.max(30, manualTableDays, daysForPeriod(period));
				const res = await axios.get<ProductRankHistoryResponse>(`${apiBaseUrl}/search-rank/history/manual-keywords`, {
					params: {
						days: baseDays,
						product_url: selectedGroup.productUrl,
					},
				});
				if (cancelled) return;
				const data = res.data as any;
				// 요청: 당일 외 데이터가 비어있다면(=기간 내 데이터가 거의 없으면) 6개월(180일)까지 다시 조회해 붙인다.
				// - OpenAPI는 "과거 데이터"를 새로 가져올 수 없고, DB에 저장된 이력만 조회 가능.
				// - 따라서 이 로직은 "DB에 저장된 과거 데이터가 있을 때"만 화면에 보이게 한다.
				if (baseDays < 180 && Array.isArray(data?.dates) && data.dates.length <= 1) {
					try {
						const res2 = await axios.get<ProductRankHistoryResponse>(`${apiBaseUrl}/search-rank/history/manual-keywords`, {
							params: { days: 180, product_url: selectedGroup.productUrl },
						});
						if (!cancelled) setManualHistory(res2.data);
						return;
					} catch (e2) {
						// fallback to base
					}
				}
				if (!cancelled) setManualHistory(res.data);
			} catch (e) {
				if (!cancelled) {
					console.error(e);
					setManualHistory(null);
				}
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, viewMode, selectedGroup?.productUrl, period, manualTableDays, rankDataVersion]);

	// DB 요약 정보가 "실제 데이터"를 가지고 있는지 여부 (기본값/placeholder 제외)
	const hasDbProductMeta = useMemo(() => {
		if (!productSummary) return false;
		const { mall_name, price, purchase_cnt, image_url } = productSummary;
		// 랭킹 스냅샷이 없을 때 기본값: mall_name="", price=0, purchase_cnt=0, image_url=None
		if (!mall_name && !image_url && price === 0 && purchase_cnt === 0) {
			return false;
		}
		return true;
	}, [productSummary]);

	// 상세 뷰용 상품/히스토리 데이터
	const detailProduct: RankTrackingDetailProduct | null = useMemo(() => {
		if (!selectedGroup) return null;
		const listMetaForGroup = listMetas[selectedGroup.id] ?? null;

		let result: RankTrackingDetailProduct = {
			id: selectedGroup.id,
			name: selectedGroup.productUrl,
			imageUrl: null,
			price: null,
			reviewCount: null,
			rating: null,
			sellerName: null,
			categoryPath: null,
			hashtags: [],
		};

		// 1) 리스트에서 미리 로딩해 둔 URL 기반 메타데이터를 최우선으로 사용
		if (listMetaForGroup) {
			result = {
				...result,
				name: listMetaForGroup.title || result.name,
				imageUrl: listMetaForGroup.image_url || result.imageUrl,
				sellerName: listMetaForGroup.site_name || result.sellerName,
				price: listMetaForGroup.price ?? result.price,
			};
		}

		// 2) 리스트 메타가 없을 때를 위한 보조 수단: OpenAPI 메타데이터
		if (!listMetaForGroup && productMetadata) {
			result = {
				...result,
				name: productMetadata.title || result.name,
				imageUrl: productMetadata.image_url || result.imageUrl,
				sellerName: productMetadata.site_name || result.sellerName,
				price: productMetadata.price ?? result.price,
			};
		}

		// 3) DB 요약 정보는 리뷰 수 / 카테고리 등 보조 정보만 보완용으로 사용
		if (productSummary && hasDbProductMeta) {
			// product_url로 조회한 product-summary는 "다른 상품으로의 fallback"을 막는 정책을 갖고 있어
			// 이미지/가격 등 값이 실제로 존재하는 경우에 한해 안전한 fallback로 사용할 수 있다.
			const hasRealSummaryData =
				Boolean(productSummary.image_url) ||
				Number(productSummary.price || 0) > 0 ||
				Number(productSummary.purchase_cnt || 0) > 0;

			result = {
				...result,
				categoryPath: productSummary.category_path ?? result.categoryPath,
				// 리스트에서는 summary.image_url을 사용해 이미지가 표시되는 경우가 있어,
				// 상세에서도 listMeta/product-metadata가 없을 때는 summary 값을 fallback로 사용한다.
				imageUrl: result.imageUrl || productSummary.image_url || null,
				// seller/price도 동일하게 "이미 비어 있을 때만" 보완
				sellerName: result.sellerName || productSummary.mall_name || null,
				price: result.price ?? (productSummary.price && productSummary.price > 0 ? productSummary.price : result.price),
				// product_title은 기본값(키워드)일 수 있어, "실제 데이터가 존재할 때만" URL 대신 표기한다.
				name:
					result.name === selectedGroup.productUrl && hasRealSummaryData && productSummary.product_title
						? productSummary.product_title
						: result.name,
			};
		}

		// 4) HTML 기반 페이지 메트릭(비공식)로 리뷰수/평점 보완
		const m = pageMetrics[selectedGroup.id] ?? null;
		const prevM = pageMetricsPrev[selectedGroup.id] ?? null;
		if (m) {
			result = {
				...result,
				reviewCount: m.review_count ?? result.reviewCount,
				rating: m.rating ?? result.rating,
			};
		}

		// 상세 화면에서 오늘 수집된 메트릭 원본도 함께 노출
		result = {
			...result,
			pageMetrics: m
				? {
						date: m.date ? String(m.date) : null,
						title: m.title ?? null,
						price: m.price ?? null,
						review_count: m.review_count ?? null,
						rating: m.rating ?? null,
						wish_count: m.wish_count ?? null,
						registered_date: m.registered_date ?? null,
						recent_purchase_count: (m as any).recent_purchase_count ?? null,
						recent_purchase_window: (m as any).recent_purchase_window ?? null,
						recent_repurchase_count: (m as any).recent_repurchase_count ?? null,
						recent_repurchase_window: (m as any).recent_repurchase_window ?? null,
						recent_badge_text: (m as any).recent_badge_text ?? null,
						http_status: typeof m.http_status === 'number' ? m.http_status : null,
						error: m.error ?? null,
					}
				: null,
			pageMetricsPrev: prevM
				? {
						date: prevM.date ? String(prevM.date) : null,
						price: prevM.price ?? null,
						review_count: prevM.review_count ?? null,
						rating: prevM.rating ?? null,
						wish_count: prevM.wish_count ?? null,
						registered_date: prevM.registered_date ?? null,
					}
				: null,
		};

		return result;
	}, [selectedGroup, productSummary, productMetadata, hasDbProductMeta, listMetas, pageMetrics, pageMetricsPrev]);

	const detailHistory = useMemo(() => {
		if (!selectedGroup) return null;

		// IMPORTANT: 상세 화면도 "이 상품 URL 전용 히스토리"만 사용한다.
		// 전체 history로 fallback하면 다른 상품 순위가 섞여 잘못된 그래프/표가 나올 수 있다.
		const base = perProductHistory[selectedGroup.id] ?? null;
		if (!base) return null;

		const keywords = selectedGroup.keywords.map((k) => k.keyword);
		return {
			dates: base.dates,
			series: base.series.filter((s) => keywords.includes(s.keyword)),
		};
	}, [perProductHistory, selectedGroup]);

	// 상세 화면용 상품 요약 정보 로딩 (대표 키워드 기준)
	const primaryKeyword = useMemo(() => {
		if (!selectedGroup) return null;
		// 히스토리가 있는 키워드를 우선 사용
		const withHistory =
			history?.series
				.filter((s) => selectedGroup.keywords.some((k) => k.keyword === s.keyword))
				.map((s) => s.keyword) ?? [];
		if (withHistory.length > 0) return withHistory[0]!;
		return selectedGroup.keywords[0]?.keyword ?? null;
	}, [selectedGroup, history]);

	useEffect(() => {
		if (!primaryKeyword) {
			setProductSummary(null);
			return;
		}
		let cancelled = false;
		const loadSummary = async () => {
			try {
				const res = await axios.get<ProductSummaryResponse>(
					`${apiBaseUrl}/search-rank/product-summary`,
					{
						params: {
							keyword: primaryKeyword,
							product_url: selectedGroup?.productUrl,
						},
					},
				);
				if (cancelled) return;
				setProductSummary(res.data);
			} catch (e) {
				if (!cancelled) {
					console.error(e);
					setProductSummary(null);
				}
			}
		};
		void loadSummary();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, primaryKeyword]);

	// 상세 화면에서 전일 대비 계산을 위해 "최신/이전" 메트릭을 함께 조회
	useEffect(() => {
		if (!selectedGroup || viewMode !== 'detail') return;
		const url = (selectedGroup.productUrl || '').trim();
		if (!url) return;
		let cancelled = false;
		const loadCompare = async () => {
			try {
				const res = await axios.get(`${apiBaseUrl}/search-rank/page-metrics/compare`, {
					params: { product_url: url },
				});
				if (cancelled) return;
				const latest = (res.data?.latest ?? null) as ProductPageMetricsResponse | null;
				const prev = (res.data?.prev ?? null) as ProductPageMetricsResponse | null;
				if (latest) {
					setPageMetrics((m) => ({ ...m, [url]: latest }));
				}
				setPageMetricsPrev((m) => ({ ...m, [url]: prev }));
			} catch (e) {
				if (!cancelled) console.error(e);
				setPageMetricsPrev((m) => ({ ...m, [url]: null }));
			}
		};
		void loadCompare();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, selectedGroup, viewMode]);

	// 상품 URL 기준 메타데이터 로딩 (네이버 쇼핑 OpenAPI, DB/리스트 메타가 없을 때 보조 수단)
	useEffect(() => {
		if (!selectedGroup || viewMode !== 'detail') {
			setProductMetadata(null);
			return;
		}
		const url = selectedGroup.productUrl;
		if (!url || !url.startsWith('http')) {
			setProductMetadata(null);
			return;
		}
		if (!primaryKeyword) {
			setProductMetadata(null);
			return;
		}

		let cancelled = false;
		const loadMetadata = async () => {
			try {
				const res = await axios.get<ProductMetadataResponse>(
					`${apiBaseUrl}/search-rank/product-metadata`,
					{
						params: {
							keyword: primaryKeyword,
							product_url: url,
						},
					},
				);
				if (cancelled) return;
				setProductMetadata(res.data);
			} catch (e) {
				if (!cancelled) {
					console.error(e);
					setProductMetadata(null);
				}
			}
		};
		void loadMetadata();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, selectedGroup, viewMode, primaryKeyword]);

	const handleAddProduct = async (url: string) => {
		// 새 상품 등록 시에도 최소 1개의 키워드를 요구한다.
		if (!url.trim()) return;
		const raw =
			window.prompt('추가할 키워드를 입력하세요. 여러 개는 콤마(,)로 구분합니다.') ?? '';
		const keywords = raw
			.split(',')
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
		if (keywords.length === 0) return;

		try {
			const res = await axios.post<TrackedProductKeyword[]>(
				`${apiBaseUrl}/search-rank/tracked`,
				{
					product_url: url.trim(),
					keywords,
				},
			);
			setTrackedKeywords((prev) => [...res.data, ...prev]);
			setViewMode('list');
		} catch (e: any) {
			console.error(e);
			const msg = e?.response?.data?.detail ?? '상품/키워드 등록 중 오류가 발생했습니다.';
			setError(String(msg));
		}
	};

	const handleSelectProduct = (id: string) => {
		setSelectedProductId(id);
		setViewMode('detail');
	};

	const handleBackToList = () => {
		setViewMode('list');
	};

	const handleChangePeriod = (p: RankTrackingDetailPeriod) => {
		setPeriod(p);
	};

	const openKeywordModal = () => {
		if (!selectedGroup) return;
		setKeywordListDraft(selectedGroup.keywords.map((k) => k.keyword));
		setKeywordDraft('');
		setIsKeywordModalOpen(true);
	};

	const handleEditKeywords = () => {
		openKeywordModal();
	};

	const handleKeywordModalClose = () => {
		setIsKeywordModalOpen(false);
		setKeywordDraft('');
	};

	const handleKeywordAddToDraft = () => {
		const raw = keywordDraft;
		const parts = raw
			.split(',')
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
		if (parts.length === 0) return;

		let next = [...keywordListDraft];
		for (const kw of parts) {
			if (next.includes(kw)) {
				continue;
			}
			if (next.length >= 30) {
				window.alert('키워드는 최대 30개까지 등록할 수 있습니다.');
				break;
			}
			next.push(kw);
		}
		setKeywordListDraft(next);
		setKeywordDraft('');
	};

	const handleKeywordRemoveFromDraft = (kw: string) => {
		setKeywordListDraft((prev) => prev.filter((k) => k !== kw));
	};

	const handleKeywordModalSave = async () => {
		if (!selectedGroup || !selectedGroup.productUrl) {
			handleKeywordModalClose();
			return;
		}

		const originalKeywords = selectedGroup.keywords.map((k) => k.keyword);
		const toAdd = keywordListDraft.filter((kw) => !originalKeywords.includes(kw));
		const toRemove = selectedGroup.keywords.filter(
			(k) => !keywordListDraft.includes(k.keyword),
		);

		try {
			if (toAdd.length > 0) {
				await axios.post<TrackedProductKeyword[]>(`${apiBaseUrl}/search-rank/tracked`, {
					product_url: selectedGroup.productUrl,
					keywords: toAdd,
				});
			}

			if (toRemove.length > 0) {
				await Promise.all(
					toRemove.map((k) =>
						axios.delete(`${apiBaseUrl}/search-rank/tracked/${k.id}`),
					),
				);
			}

			const refreshed = await axios.get<TrackedProductKeyword[]>(
				`${apiBaseUrl}/search-rank/tracked`,
			);
			setTrackedKeywords(refreshed.data);
			handleKeywordModalClose();
		} catch (e: any) {
			console.error(e);
			const msg =
				e?.response?.data?.detail ?? '키워드를 저장하는 중 오류가 발생했습니다.';
			setError(String(msg));
		}
	};

	return (
		<div className="space-y-3">
			{error && (
				<div
					style={{
						fontSize: 11,
						color: '#fecaca',
						border: '1px solid rgba(248,113,113,0.6)',
						borderRadius: 4,
						padding: '4px 8px',
						backgroundColor: 'rgba(127,29,29,0.4)',
					}}
				>
					{error}
				</div>
			)}

			{/* 키워드 추가/편집 모달 */}
			{isKeywordModalOpen && selectedGroup && (
				<div className="modal-backdrop">
					<div className="modal-card">
						<div className="modal-header">
							<div className="modal-title">키워드 추가/편집</div>
							<button
								type="button"
								className="btn-ghost"
								onClick={handleKeywordModalClose}
								style={{ fontSize: 11 }}
							>
								닫기
							</button>
						</div>
						<div className="modal-body">
							<div className="field-label">키워드 입력</div>
							<div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
								<input
									type="text"
									className="input"
									placeholder="키워드를 입력한 뒤 추가 버튼을 눌러주세요"
									value={keywordDraft}
									onChange={(e) => setKeywordDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											handleKeywordAddToDraft();
										}
									}}
								/>
								<button
									type="button"
									className="btn-primary"
									style={{ fontSize: 12, padding: '4px 12px' }}
									onClick={handleKeywordAddToDraft}
								>
									추가
								</button>
							</div>
							<div className="field-label" style={{ marginTop: 8 }}>
								키워드 목록
							</div>
							<div className="keyword-list-chips">
								{keywordListDraft.length === 0 && (
									<span style={{ fontSize: 11, color: '#9ca3af' }}>
										등록된 키워드가 없습니다. 키워드를 추가해 주세요.
									</span>
								)}
								{keywordListDraft.map((kw) => (
									<button
										key={kw}
										type="button"
										className="keyword-chip active"
										onClick={() => handleKeywordRemoveFromDraft(kw)}
										title="클릭하여 삭제"
									>
										<span>{kw}</span>
										<span style={{ marginLeft: 4 }}>×</span>
									</button>
								))}
							</div>
						</div>
						<div className="modal-footer">
							<button
								type="button"
								className="btn-ghost"
								onClick={handleKeywordModalClose}
							>
								취소
							</button>
							<button
								type="button"
								className="btn-primary"
								onClick={handleKeywordModalSave}
							>
								저장
							</button>
						</div>
					</div>
				</div>
			)}

			{viewMode === 'list' && (
				<div>
					{inlineNotice && (
						<div
							className="card"
							style={{
								marginBottom: 12,
								fontSize: 12,
								color: '#a7f3d0',
								borderColor: 'rgba(16,185,129,0.35)',
								background: 'rgba(16,185,129,0.10)',
								fontWeight: 900,
							}}
						>
							{inlineNotice}
						</div>
					)}
					{pageMetricsStatusText && (
						<div className="card" style={{ marginBottom: 12, fontSize: 11, color: '#9ca3af', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
							<div style={{ minWidth: 0 }}>
								{pageMetricsStatusText}
								{pageMetricsStatus?.status?.toUpperCase?.() === 'FAILED' && pageMetricsStatus?.detail === 'rate_limited' && (
									<div style={{ marginTop: 6 }}>
										<span>접속 제한(418)/레이트리밋이 걸렸을 수 있어요. </span>
										<button
											type="button"
											className="btn-ghost"
											style={{ fontSize: 11, padding: '2px 6px' }}
											onClick={() => {
												const firstUrl = productGroups[0]?.productUrl;
												if (!firstUrl) return;
												window.open(firstUrl, '_blank', 'noreferrer');
											}}
										>
											상품 페이지 열기(접속 제한 확인)
										</button>
									</div>
								)}
							</div>
							<div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
								<button
									type="button"
									className="btn-ghost"
									style={{ fontSize: 11 }}
									onClick={async () => {
										// UX 정책:
										// - 오늘 "리뷰/평점" 크롤링 데이터가 미수집이면, 즉시 강제 수집을 때리지 말고 팝업을 먼저 열어
										//   사용자가 컨테이너 브라우저에서 캡차를 풀고 같은 세션으로 수집을 이어가도록 유도한다.
										// - 미수집이 없으면 불필요한 재호출을 막고 안내만 한다.
										if (productGroups.length === 0) return;
										const urls = productGroups.map((g) => g.productUrl).filter(Boolean);
										if (urls.length === 0) return;

										// 최신 상태를 먼저 조회(batch)
										let map: Record<string, ProductPageMetricsResponse | null> = {};
										try {
											const res = await axios.post<ProductPageMetricsResponse[]>(
												`${apiBaseUrl}/search-rank/page-metrics/batch`,
												{ urls },
											);
											for (const row of res.data || []) map[row.product_url] = row;
											setPageMetrics(map);
										} catch (e) {
											console.error(e);
										}

										const missing: string[] = [];
										for (const u of urls) {
											const r = map[u] ?? pageMetrics[u] ?? null;
											if (!isValidTodayPageMetrics(r)) missing.push(u);
										}

											// 키워드(OpenAPI) 상태도 함께 최신으로 갱신한다(5번 영역이 항상 최신 상태를 보여야 함).
											try {
												const res2 = await axios.post<CrawlTodayStatusItem[]>(
													`${apiBaseUrl}/search-rank/crawl/today-status`,
													{ product_urls: urls },
												);
												const arr = Array.isArray(res2.data) ? res2.data : [];
												const m: Record<string, CrawlTodayStatusItem | null> = {};
												for (const it of arr) {
													const u = String((it as any)?.product_url || '').trim();
													if (!u) continue;
													m[u] = it as any;
												}
												setRankStatusMap(m);
												const missRank: string[] = [];
												for (const u of urls) {
													const st = m[u] ?? null;
													if (!st) continue;
													if (!(st as any)?.is_complete) missRank.push(u);
												}
												setMissingRankUrls(missRank);
											} catch {
												// ignore
											}

										// 항상 모달을 열되:
										// - 미수집이 있으면 "수집 진행" 모드
										// - 모두 완료면 "상태 표시 전용" 모드(버튼 비활성)
										setCollectTargetUrls(urls);
										setMissingTodayUrls(missing);
											// 사용자 요청: 수집 모달은 수동으로 ON/OFF 하므로, 다시시도에서 read-only로 잠그지 않는다.
											setCollectPopupReadOnly(false);
										// 수동으로 연 모달은 자동으로 닫히지 않게 한다.
										setCollectPopupAutoClose(false);
										setHostSessionOpenedOnce(false);
										openCollectPopup();
									}}
								>
									지금 다시 시도
								</button>
									<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af' }}>
										<input
											type="checkbox"
											checked={collectModalAutoOpen}
											onChange={(e) => setCollectModalAutoOpen(Boolean(e.target.checked))}
										/>
										수집 모달 자동팝업
									</label>
									<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af' }}>
										<input
											type="checkbox"
											checked={pageMetricsAutoSync}
											onChange={(e) => setPageMetricsAutoSync(Boolean(e.target.checked))}
										/>
										상품 메트릭 자동 동기화(위험)
									</label>
							</div>
						</div>
					)}
					{productGroups.length > 0 && (
						<div
							className="card"
							style={{
								marginBottom: 12,
								fontSize: 11,
								color: '#cbd5e1',
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
								gap: 12,
								flexWrap: 'wrap',
								borderColor: 'rgba(59,130,246,0.35)',
								background: 'rgba(30,64,175,0.10)',
							}}
						>
							<div style={{ minWidth: 0 }}>
								<div style={{ fontWeight: 900, color: '#e5e7eb' }}>CDP/Collector 수동 테스트</div>
								<div style={{ marginTop: 4, color: '#9ca3af' }}>
									오늘 수집이 이미 완료되어 자동 팝업이 뜨지 않을 때도, 전체 상품을 대상으로 수집 모달을 열어 Host Agent와 Local Collector 경로를 테스트합니다.
								</div>
							</div>
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 11 }}
								onClick={() => {
									const urls = productGroups.map((g) => g.productUrl).filter(Boolean);
									if (urls.length === 0) return;
									setCollectTargetUrls(urls);
									// 완료 여부와 무관하게 Collector 경로를 테스트할 수 있도록 전체 URL을 수집 대상으로 올린다.
									setMissingTodayUrls(urls);
									setCollectPopupReadOnly(false);
									setCollectPopupAutoClose(false);
									setHostSessionOpenedOnce(false);
									setCollectNowDetail('테스트 모드: 오늘 완료 여부와 무관하게 전체 상품을 다시 수집할 수 있습니다.');
									setScrapeOnceError(null);
									openCollectPopup();
								}}
							>
								CDP/Collector 테스트 열기
							</button>
						</div>
					)}
					<RankTrackingListView
						channel="naver"
						products={listItems}
						onAddProduct={handleAddProduct}
						onOpenCollectModal={async () => {
							if (productGroups.length === 0) return;
							const urls = productGroups.map((g) => g.productUrl).filter(Boolean);
							if (urls.length === 0) return;

							// 최신 상태를 먼저 조회(batch)해서, 모달에서 "남은 상품만 수집"을 안정적으로 진행할 수 있게 한다.
							let map: Record<string, ProductPageMetricsResponse | null> = {};
							try {
								const res = await axios.post<ProductPageMetricsResponse[]>(
									`${apiBaseUrl}/search-rank/page-metrics/batch`,
									{ urls },
								);
								for (const row of res.data || []) map[row.product_url] = row;
								setPageMetrics(map);
							} catch (e) {
								console.error(e);
							}

							const missing: string[] = [];
							for (const u of urls) {
								const r = map[u] ?? pageMetrics[u] ?? null;
								if (!isValidTodayPageMetrics(r)) missing.push(u);
							}

							// 키워드(OpenAPI) 상태도 함께 최신으로 갱신(모달 5번 영역이 항상 최신 상태)
							try {
								const res2 = await axios.post<CrawlTodayStatusItem[]>(
									`${apiBaseUrl}/search-rank/crawl/today-status`,
									{ product_urls: urls, date: todayLocalStr },
								);
								const arr = Array.isArray(res2.data) ? res2.data : [];
								const m: Record<string, CrawlTodayStatusItem | null> = {};
								for (const it of arr) {
									const u = String((it as any)?.product_url || '').trim();
									if (!u) continue;
									m[u] = it as any;
								}
								setRankStatusMap(m);
								const missRank: string[] = [];
								for (const u of urls) {
									const st = m[u] ?? null;
									if (!st) continue;
									if (!(st as any)?.is_complete) missRank.push(u);
								}
								setMissingRankUrls(missRank);
								// 모달 오픈 시점의 기준일은 "오늘"로 둔다.
								rankStatusDateRef.current = todayLocalStr;
							} catch {
								// ignore
							}

							setCollectTargetUrls(urls);
							setMissingTodayUrls(missing);
							setCollectPopupReadOnly(false);
							setCollectPopupAutoClose(false);
							setHostSessionOpenedOnce(false);
							openCollectPopup();
						}}
						onSelectProduct={handleSelectProduct}
						onDeleteProduct={async (id) => {
							// id 는 product_url 과 동일하다.
							try {
								await axios.delete(`${apiBaseUrl}/search-rank/tracked/by-product`, {
									params: { product_url: id },
								});
								// 로컬 상태는 "정규화 기반"으로 제거하고, 항상 서버에서 재조회해 남은 변형 URL까지 정리한다.
								const canonicalize = (input: string): string => {
									const s = String(input || '').trim();
									if (!s) return '';
									try {
										const u = new URL(s);
										u.hash = '';
										// smartstore는 query/hash가 달라도 동일 상품으로 취급(삭제/그룹핑 안정화)
										if (String(u.host || '').toLowerCase().includes('smartstore.naver.com')) {
											return `${u.protocol}//${u.host}${u.pathname}`.trim();
										}
										return u.toString();
									} catch {
										return s.replace(/#.*$/, '');
									}
								};
								const baseId = canonicalize(id);
								setTrackedKeywords((prev) =>
									prev.filter((row) => canonicalize(String(row.product_url || '')) !== baseId),
								);
								setListSummaries((prev) => {
									const next = { ...prev };
									delete next[id];
									return next;
								});
								setPerProductHistory((prev) => {
									const next = { ...prev };
									delete next[id];
									return next;
								});
								setPageMetrics((prev) => {
									const next = { ...prev };
									delete next[id];
									return next;
								});
								if (selectedProductId === id) {
									setSelectedProductId(null);
									setViewMode('list');
								}
								// 서버 상태를 다시 반영(변형 URL/중복 키워드 정리)
								setRankDataVersion((v) => v + 1);
							} catch (e) {
								console.error(e);
								alert('상품 삭제 중 오류가 발생했습니다.');
							}
						}}
					/>

					{/* 오늘 수집 팝업: 전날 데이터로 대체하지 않고, 오늘 값이 없으면 사용자에게 안내 */}
					{isCollectPopupOpen && (
						<div className="modal-backdrop" role="dialog" aria-label="오늘 수집 안내">
							<div className="modal-card modal-card-wide">
								<div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
									<div className="modal-title" style={{ flex: '1 1 auto', minWidth: 0 }}>
										오늘 상품 상세 메트릭 수집
									</div>
									<button
										type="button"
										className="btn-ghost"
										aria-label="force-stop-collect-scripts"
										disabled={forceStopCollectBusy}
										style={{ color: forceStopCollectBusy ? undefined : '#fca5a5', fontWeight: 800 }}
										title="정말 필요할 때만 사용합니다. 키워드 순위 job 취소, 수집 UI 잠금 해제, Host Chrome·Host Agent 종료, Host Agent 자동 실행 해제"
										onClick={() => {
											void forceStopCollectScripts();
										}}
									>
										{forceStopCollectBusy ? '강제 종료 중…' : '수집·Agent 강제 종료'}
									</button>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => {
											void closeCollectPopup();
										}}
									>
										닫기
									</button>
								</div>
								<div className="modal-body" style={{ fontSize: 12, color: '#cbd5e1' }}>
									{(() => {
										const total = collectTargetUrls.length;
										const remaining = missingTodayUrls.length;
										const done = Math.max(0, total - remaining);

										// NOTE:
										// - 과거 경로(C:\dev\ERP2\analytics)는 레거시 폴더로 정리되어 없을 수 있다.
										// - 현재 운영/작업 기준 경로는 C:\dev\ERP2-analytics 이다.
										// Host Chrome/Agent 안내는 "운영PC(레포 있음)"과 "일반 사용자 PC(NAS 수집용)"을 분리한다.
										const hostStartCmdOps = `pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\\dev\\ERP2-analytics\\tools\\collect-via-modal.ps1"`;
										const hostStartCmdUser =
											`irm -Method Post "` +
											`http://127.0.0.1:9230/start-host-chrome?port=9223&profile_dir=Default&start_url=https%3A%2F%2Fsearch.shopping.naver.com%2F` +
											`"`;
										const nasHostSetupCommands = getNasHostSetupCommands();
										const hostAgentConnected = hostAgentStatus === 'connected';
										const showInstallDownloads = !hostAgentConnected;
										const hostAgentManageNoCurrent = hostAgentManageNo || '미확인';
										const hostAgentManageNoLatest = hostAgentManageNo === REQUIRED_HOST_AGENT_MANAGE_NO;
										const hostAgentBadgeText =
											hostAgentAutoUpdating
												? 'Host Agent 자동 업데이트 중'
												: hostAgentStatus === 'connected'
												? 'Host Agent 연결됨'
												: hostAgentStatus === 'checking'
													? 'Host Agent 확인 중'
													: hostAgentStatus === 'outdated'
														? 'Host Agent 업데이트 필요'
														: hostAgentStatus === 'missing'
															? 'Host Agent 미실행'
															: 'Host Agent 오류';
										const hostAgentBadgeColor =
											hostAgentStatus === 'connected'
												? '#86efac'
												: hostAgentStatus === 'checking'
													? '#fbbf24'
													: hostAgentStatus === 'outdated'
														? '#fbbf24'
														: '#fca5a5';
										const backgroundRunning = Boolean(collectorBackgroundStatus?.running);
										const backgroundState = String(collectorBackgroundStatus?.state || (backgroundRunning ? 'RUNNING' : 'STOPPED'));
										const backgroundManageNo = String(collectorBackgroundStatus?.agentManageNo || '').trim();
										const backgroundVersion = String(collectorBackgroundStatus?.agentVersion || '').trim();
										const backgroundUpdatedAt = String(collectorBackgroundStatus?.updated_at || '').trim();
										const backgroundApiBaseUrl = String(collectorBackgroundStatus?.apiBaseUrl || '').trim();
										const expectedBackgroundApiBaseUrl = uiTarget === 'nas' ? `http://${nasHost}:6188/api` : LOCAL_API_ORIGIN;
										const backgroundTargetMatched =
											!backgroundRunning ||
											!backgroundApiBaseUrl ||
											backgroundApiBaseUrl.replace(/\/$/, '') === expectedBackgroundApiBaseUrl.replace(/\/$/, '');
										const backgroundLatest =
											!backgroundRunning ||
											(backgroundVersion === REQUIRED_HOST_AGENT_VERSION && backgroundManageNo === REQUIRED_HOST_AGENT_MANAGE_NO);
										const backgroundReady = backgroundLatest && backgroundTargetMatched;
										const latestCollectorEvent = collectorEvents.length > 0 ? collectorEvents[collectorEvents.length - 1] : null;
										const latestCollectorEventText = latestCollectorEvent
											? `${latestCollectorEvent.status || 'EVENT'}${latestCollectorEvent.note ? ` · ${latestCollectorEvent.note}` : ''}`
											: '';

										const copy = async (text: string) => {
											const t = String(text || '');
											try {
												await navigator.clipboard.writeText(t);
												notify('복사되었습니다.');
											} catch {
												notify('복사에 실패했습니다. 내용을 직접 선택해 복사해 주세요.');
											}
										};

										const stepBox: React.CSSProperties = {
											border: '1px solid rgba(148, 163, 184, 0.25)',
											borderRadius: 10,
											padding: 10,
											background: 'rgba(2, 6, 23, 0.55)',
										};

										const badge = (ok: boolean, text: string) => (
											<span
												style={{
													display: 'inline-flex',
													alignItems: 'center',
													gap: 6,
													padding: '2px 8px',
													borderRadius: 999,
													fontSize: 11,
													fontWeight: 900,
													color: ok ? '#86efac' : '#fca5a5',
													border: `1px solid ${ok ? 'rgba(34,197,94,0.35)' : 'rgba(248,113,113,0.35)'}`,
													background: ok ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)',
												}}
											>
												{text}
											</span>
										);

										const isDoneAll = total > 0 && remaining === 0;

										return (
											<div style={{ marginBottom: 12 }}>
												<div style={{ marginBottom: 8 }}>
													{collectPopupReadOnly || isDoneAll ? (
														<span style={{ color: '#86efac', fontWeight: 900 }}>
															오늘({todayLocalStr}) 상품 상세 메트릭 수집이 완료되었습니다.
														</span>
													) : (
														<span>
																	오늘({todayLocalStr}) 기준 “리뷰/평점” 스냅샷이 없어서 비어 있습니다(상품명/가격/등록일/배송은 커머스 API로 보강될 수 있음). 전날 데이터로 대체하지 않습니다.
														</span>
													)}
												</div>

												<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
													<span style={{ fontSize: 11, color: '#9ca3af' }}>
														대상 {total}개 · 완료 {done}개 · 남음 {remaining}개
													</span>
													{total > 0 ? badge(isDoneAll, isDoneAll ? '전체 완료' : '진행 중') : null}
												</div>

												{/* 등록 상품 리스트(간단 표시): URL은 숨기고, 수집 완료 여부만 색으로 강조 */}
												{collectTargetUrls.length > 0 && (
													<div style={{ marginBottom: 10 }}>
														<div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>등록 상품</div>
														<div
															style={{
																maxHeight: 180,
																overflow: 'auto',
																display: 'grid',
																gap: 6,
																paddingRight: 4,
															}}
														>
															{collectTargetUrls.map((u, idx) => {
																const url = String(u || '').trim();
																const metaTitle = String((listMetas as any)?.[url]?.title ?? '').trim();
																const summaryTitle = String((listSummaries as any)?.[url]?.product_title ?? '').trim();
																const metricsTitle = String((pageMetrics as any)?.[url]?.title ?? '').trim();
																const label = deriveTrackedProductLabel({
																	url,
																	index1: idx + 1,
																	metaTitle,
																	summaryTitle,
																	metricsTitle,
																});
																const m = url ? ((pageMetrics as any)?.[url] ?? null) : null;
																const st = String((m as any)?.recent_purchase_status ?? '').trim();
																const isNoBadge = st === 'no_badge';
																const isDone = url ? !missingTodayUrls.includes(url) : false;
																const statusText = isNoBadge ? '배지없음' : isDone ? '완료' : '미수집';
																return (
																	<div
																		key={`${url || idx}`}
																		style={{
																			display: 'flex',
																			justifyContent: 'space-between',
																			alignItems: 'center',
																			gap: 10,
																			padding: '8px 10px',
																			borderRadius: 10,
																			border: `1px solid ${
																				isDone ? 'rgba(34,197,94,0.35)' : 'rgba(248,113,113,0.35)'
																			}`,
																			background: isDone ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
																		}}
																	>
																		<div style={{ minWidth: 0 }}>
																			<div
																				style={{
																					fontSize: 12,
																					color: '#e5e7eb',
																					fontWeight: 700,
																					whiteSpace: 'nowrap',
																					overflow: 'hidden',
																					textOverflow: 'ellipsis',
																				}}
																				title={label}
																			>
																				{label}
																			</div>
																		</div>
																		<span
																			style={{
																				flexShrink: 0,
																				fontSize: 11,
																				fontWeight: 900,
																				color: isNoBadge ? '#fbbf24' : isDone ? '#86efac' : '#fca5a5',
																			}}
																		>
																			{statusText}
																		</span>
																	</div>
																);
															})}
														</div>
													</div>
												)}

												{collectPopupReadOnly ? null : (
													<div style={{ display: 'grid', gap: 10 }}>
													<>
													<div style={stepBox}>
														<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
															<div style={{ fontWeight: 900, color: '#e5e7eb' }}>Host Agent 상태</div>
															<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
																<span style={{ fontSize: 11, fontWeight: 900, color: hostAgentBadgeColor }}>{hostAgentBadgeText}</span>
																<span
																	style={{
																		fontSize: 11,
																		fontWeight: 900,
																		color: hostAgentManageNoLatest ? '#86efac' : '#fbbf24',
																		border: `1px solid ${hostAgentManageNoLatest ? 'rgba(34,197,94,0.35)' : 'rgba(251,191,36,0.40)'}`,
																		background: hostAgentManageNoLatest ? 'rgba(34,197,94,0.10)' : 'rgba(251,191,36,0.10)',
																		borderRadius: 999,
																		padding: '2px 8px',
																	}}
																	title={`필요 관리 No. ${REQUIRED_HOST_AGENT_MANAGE_NO}`}
																>
																	Agent No. {hostAgentManageNoCurrent}
																	{hostAgentManageNoLatest ? ' · 최신' : ' · 확인 필요'}
																</span>
																<button
																	type="button"
																	className="btn-ghost"
																	style={{ fontSize: 11 }}
																	onClick={() => void refreshHostAgentStatus()}
																>
																	상태 새로고침
																</button>
															</div>
														</div>
														<div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af', whiteSpace: 'pre-wrap' }}>
															{hostAgentDetail}
															{`\n현재 Agent 버전: ${hostAgentVersion || '미확인'} / Agent No. ${hostAgentManageNo || '미확인'}`}
															{`\n필요 Agent 버전: ${REQUIRED_HOST_AGENT_VERSION} / Agent No. ${REQUIRED_HOST_AGENT_MANAGE_NO}`}
															{hostAgentHealthTime ? `\nAgent health 시각: ${hostAgentHealthTime}` : '\nAgent health 시각: 미확인'}
															{hostAgentCheckedAt ? `\nUI 확인 시각: ${hostAgentCheckedAt}` : ''}
															{hostCdpAutoStatus ? `\n${hostCdpAutoStatus}` : ''}
															{hostAgentConnected
																? '\n설치/실행이 확인되어 재설치 없이 기존 Agent와 CDP Chrome을 재사용합니다.'
																: hostAgentStatus === 'outdated'
																	? hostAgentAutoUpdating
																		? '\n자동 업데이트를 진행 중입니다. 완료 후 상태가 자동으로 갱신됩니다.'
																		: '\n자동 업데이트가 실패하거나 지원되지 않는 구버전이면, 아래 설치 실행기 또는 NAS 호스트 패키지로 1회 업데이트해 주세요.'
																	: '\n처음 사용하는 PC라면 아래 설치 실행기 또는 NAS 호스트 패키지를 한 번만 실행하세요.'}
														</div>
														{hostAgentConnected ? (
															<div
																style={{
																	marginTop: 10,
																	paddingTop: 10,
																	borderTop: '1px solid rgba(148, 163, 184, 0.18)',
																	display: 'grid',
																	gap: 8,
																}}
															>
																<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
																	<div style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 900 }}>
																		백그라운드 수집기: {backgroundRunning ? '실행 중' : '중지됨'} · {backgroundState}
																	</div>
																	{backgroundRunning ? (
																		<span
																			style={{
																				fontSize: 11,
																				fontWeight: 900,
																				color: backgroundReady ? '#86efac' : '#fbbf24',
																			}}
																			title={`Worker 버전 ${backgroundVersion || 'unknown'} / 필요 ${REQUIRED_HOST_AGENT_VERSION}${backgroundTargetMatched ? '' : ` / 현재 API ${backgroundApiBaseUrl} / 필요 API ${expectedBackgroundApiBaseUrl}`}`}
																		>
																			Worker No. {backgroundManageNo || '미확인'}
																			{backgroundReady ? ' · 정상' : !backgroundTargetMatched ? ' · 연결 대상 재시작 필요' : ' · 재시작 필요'}
																		</span>
																	) : null}
																	<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
																		<button
																			type="button"
																			className="btn-ghost"
																			style={{ fontSize: 11 }}
																			disabled={collectorBackgroundBusy}
																			onClick={() => void startCollectorBackground()}
																		>
																			{collectorBackgroundBusy ? '처리 중...' : '백그라운드 시작'}
																		</button>
																		<button
																			type="button"
																			className="btn-ghost"
																			style={{ fontSize: 11 }}
																			disabled={collectorBackgroundBusy || !backgroundRunning}
																			onClick={() => void stopCollectorBackground()}
																		>
																			중지
																		</button>
																	</div>
																</div>
																<div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>
																	{`worker 버전: ${backgroundVersion || '미확인'} / Worker No. ${backgroundManageNo || '미확인'}\n`}
																	{backgroundUpdatedAt ? `worker 갱신 시각: ${backgroundUpdatedAt}\n` : 'worker 갱신 시각: 미확인\n'}
																	{backgroundApiBaseUrl ? `worker API: ${backgroundApiBaseUrl}\n` : ''}
																	{collectorBackgroundStatus?.jobId ? `job: ${collectorBackgroundStatus.jobId}\n` : ''}
																	{collectorBackgroundStatus?.url ? `url: ${collectorBackgroundStatus.url}\n` : ''}
																	{collectorBackgroundStatus?.reason ? `사용자 조치 필요: ${collectorBackgroundStatus.reason}\n` : ''}
																	{!backgroundTargetMatched ? `연결 API 불일치: 현재 ${backgroundApiBaseUrl} / 필요 ${expectedBackgroundApiBaseUrl}\n` : ''}
																	{latestCollectorEventText ? `최근 이벤트: ${latestCollectorEventText}` : '대기 중인 job이 있으면 웹을 닫아도 Host Agent가 처리합니다.'}
																</div>
															</div>
														) : null}
													</div>
													<div style={stepBox}>
														<div style={{ fontWeight: 900, color: '#e5e7eb', marginBottom: 8 }}>전용 크롬 실행</div>
														<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
															<a
																href={
																	uiTarget === 'nas'
																		? '/nas/Run-Start-Analytics-HostChrome.cmd'
																		: '/local/Run-Start-Analytics-HostChrome.cmd'
																}
																download={uiTarget === 'nas' ? 'Run-Start-Analytics-HostChrome-NAS.cmd' : 'Run-Start-Analytics-HostChrome-LOCAL.cmd'}
																className="btn-ghost"
																style={{ fontSize: 11, textDecoration: 'none' }}
															>
																실행기 받기(cmd·{uiTarget === 'nas' ? 'NAS' : '로컬'})
															</a>
															<details style={{ fontSize: 11, color: '#94a3b8' }}>
																<summary style={{ cursor: 'pointer' }}>명령({uiTarget === 'nas' ? '일반 PC(Host Agent 호출)' : '운영 PC(레포)'})</summary>
																<div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
																	{uiTarget === 'nas' ? (
																		<button
																			type="button"
																			className="btn-ghost"
																			style={{ fontSize: 11 }}
																			onClick={() => void copy(hostStartCmdUser)}
																		>
																			명령 복사
																		</button>
																	) : (
																		<button
																			type="button"
																			className="btn-ghost"
																			style={{ fontSize: 11 }}
																			onClick={() => void copy(hostStartCmdOps)}
																		>
																			명령 복사
																		</button>
																	)}
																</div>
																<pre
																	style={{
																		marginTop: 8,
																		whiteSpace: 'pre-wrap',
																		background: 'rgba(15, 23, 42, 0.6)',
																		padding: 10,
																		borderRadius: 8,
																		color: '#cbd5e1',
																		fontSize: 11,
																		overflow: 'auto',
																	}}
																>
																	{uiTarget === 'nas' ? hostStartCmdUser : hostStartCmdOps}
																</pre>
															</details>
														</div>
														{uiTarget === 'nas' ? (
															<div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(148, 163, 184, 0.18)' }}>
																<div style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 900, marginBottom: 6 }}>NAS 주소</div>
																<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
																	<input
																		value={nasHost}
																		readOnly
																		placeholder="192.168.0.50"
																		style={{
																			width: 180,
																			padding: '6px 10px',
																			borderRadius: 8,
																			background: 'rgba(15, 23, 42, 0.6)',
																			border: '1px solid rgba(148, 163, 184, 0.3)',
																			color: '#e5e7eb',
																			fontSize: 12,
																		}}
																	/>
																</div>
																<div style={{ marginTop: 10, fontSize: 11, color: '#e5e7eb', fontWeight: 900, marginBottom: 6 }}>
																	호스트 PC IP (NAS 수집용)
																</div>
																<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
																	<input
																		value={hostCdpIp}
																		onChange={(e) => {
																			setHostCdpIp(String(e.target.value || '').trim());
																			setHostCdpIpStatusText('수동 입력값을 사용합니다.');
																		}}
																		placeholder="예: 192.168.0.23 (자동/수동)"
																		style={{
																			width: 180,
																			padding: '6px 10px',
																			borderRadius: 8,
																			background: 'rgba(15, 23, 42, 0.6)',
																			border: '1px solid rgba(148, 163, 184, 0.3)',
																			color: '#e5e7eb',
																			fontSize: 12,
																		}}
																	/>
																	<button
																		type="button"
																		className="btn-ghost"
																		style={{ fontSize: 11 }}
																		disabled={hostCdpIpDetecting}
																		onClick={() => {
																			void (async () => {
																				setHostCdpIpDetecting(true);
																				setHostCdpIpStatusText('호스트 PC IP 자동 감지 중...');
																				const ip = await getNasHostCdpIp({ forceRefresh: true });
																				if (ip) {
																					setHostCdpIpStatusText(`자동 감지 완료: ${ip}`);
																					notify(`호스트 PC IP 자동 감지: ${ip}`);
																				} else {
																					setHostCdpIpStatusText('자동 감지에 실패했습니다. 직접 입력해 주세요.');
																					notify('호스트 PC IP 자동 감지에 실패했습니다. 직접 입력해 주세요.');
																				}
																				setHostCdpIpDetecting(false);
																			})();
																		}}
																	>
																		{hostCdpIpDetecting ? '자동 찾는 중...' : '자동 찾기'}
																	</button>
																</div>
																<div style={{ marginTop: 6, fontSize: 11, color: hostCdpIpStatusText.includes('실패') ? '#fca5a5' : '#9ca3af' }}>
																	{hostCdpIpStatusText || '모달이 열리면 NAS 수집용 호스트 PC IP를 자동으로 감지해 고정합니다.'}
																</div>
															</div>
														) : null}
														<div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
															{uiTarget === 'nas'
																? '먼저 “NAS 호스트 패키지(zip)”를 한 폴더에 풀고 Setup 실행기(cmd)를 실행한 뒤, 전용 크롬 창에서 네이버 로그인 후 “NAS 세션 준비”를 눌러주세요.'
																: '다운로드한 cmd 실행기로 창을 열고, 전용 크롬 창에서 네이버 로그인 후 “세션 준비”를 눌러주세요.'}
														</div>
														<div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
															브라우저에서 받은 <code style={{ color: '#e5e7eb' }}>.ps1</code> 는 회사 PC 정책으로 바로 막힐 수 있어, 수집 모달에서는{' '}
															<b style={{ color: '#e5e7eb' }}>.cmd 실행기</b> 기준으로 안내합니다.
														</div>
														{uiTarget === 'nas' ? (
															<div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(148, 163, 184, 0.18)' }}>
																<div style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 900, marginBottom: 6 }}>
																	PowerShell 7 실행 코드
																</div>
																<div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
																	일반 PC: 위 zip을 받아{' '}
																	<code style={{ color: '#e5e7eb' }}>%USERPROFILE%\Downloads\Analytics-NAS-Host</code> 같은{' '}
																	<b style={{ color: '#e5e7eb' }}>한 폴더에 압축을 모두 푼 뒤</b> 아래 한 줄을 실행하세요. (직접 받은 .ps1 대신 cmd 실행기 또는 아래 명령을 권장합니다.)
																</div>
																<div style={{ display: 'grid', gap: 8 }}>
																	<div
																		style={{
																			background: 'rgba(15, 23, 42, 0.45)',
																			border: '1px solid rgba(148, 163, 184, 0.18)',
																			borderRadius: 8,
																			padding: 8,
																		}}
																	>
																		<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
																			<div style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 800 }}>권장(zip 풀고 한 줄)</div>
																			<button
																				type="button"
																				className="btn-ghost"
																				style={{ fontSize: 11 }}
																				onClick={() => void copy(nasHostSetupCommands.downloadedRunExtractedBundle)}
																			>
																				명령 복사
																			</button>
																		</div>
																		<pre
																			style={{
																				marginTop: 8,
																				whiteSpace: 'pre-wrap',
																				background: 'rgba(15, 23, 42, 0.6)',
																				padding: 10,
																				borderRadius: 8,
																				color: '#cbd5e1',
																				fontSize: 11,
																				overflow: 'auto',
																			}}
																		>
																			{nasHostSetupCommands.downloadedRunExtractedBundle}
																		</pre>
																	</div>
																	{nasHostSetupCommands.repoDirectRun ? (
																		<div
																			style={{
																				background: 'rgba(15, 23, 42, 0.45)',
																				border: '1px solid rgba(148, 163, 184, 0.18)',
																				borderRadius: 8,
																				padding: 8,
																			}}
																		>
																			<div
																				style={{
																					display: 'flex',
																					justifyContent: 'space-between',
																					gap: 8,
																					alignItems: 'center',
																					flexWrap: 'wrap',
																				}}
																			>
																				<div style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 800 }}>
																					레포 클론 PC(.env의 VITE_ANALYTICS_REPO_ROOT)
																				</div>
																				<button
																					type="button"
																					className="btn-ghost"
																					style={{ fontSize: 11 }}
																					onClick={() => void copy(nasHostSetupCommands.repoDirectRun!)}
																				>
																					명령 복사
																				</button>
																			</div>
																			<pre
																				style={{
																					marginTop: 8,
																					whiteSpace: 'pre-wrap',
																					background: 'rgba(15, 23, 42, 0.6)',
																					padding: 10,
																					borderRadius: 8,
																					color: '#cbd5e1',
																					fontSize: 11,
																					overflow: 'auto',
																				}}
																			>
																				{nasHostSetupCommands.repoDirectRun}
																			</pre>
																		</div>
																	) : null}
																	<details style={{ fontSize: 11, color: '#94a3b8' }}>
																		<summary style={{ cursor: 'pointer' }}>
																			통합 .ps1만 Downloads에 받은 경우(회사 정책/MOTW로 바로 막히거나, 형제 파일이 없어 설치가 실패할 수 있음)
																		</summary>
																		<div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
																			<button
																				type="button"
																				className="btn-ghost"
																				style={{ fontSize: 11 }}
																				onClick={() => void copy(nasHostSetupCommands.downloadedRunSingleFileInDownloads)}
																			>
																				명령 복사
																			</button>
																		</div>
																		<pre
																			style={{
																				marginTop: 8,
																				whiteSpace: 'pre-wrap',
																				background: 'rgba(15, 23, 42, 0.6)',
																				padding: 10,
																				borderRadius: 8,
																				color: '#cbd5e1',
																				fontSize: 11,
																				overflow: 'auto',
																			}}
																		>
																			{nasHostSetupCommands.downloadedRunSingleFileInDownloads}
																		</pre>
																	</details>
																</div>
															</div>
														) : null}
													</div>

													<div style={stepBox}>
														<div style={{ fontWeight: 900, color: '#e5e7eb', marginBottom: 6 }}>세션 준비</div>
														<div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
															{uiTarget === 'local' ? (
																<button
																	type="button"
																	className="btn-ghost"
																	disabled={collectingNow}
																	onClick={() => {
																		// 상태 업데이트 타이밍(자동 팝업 직후 등)으로 배열이 잠깐 비어도,
																		// 실제 대상 URL은 ref에 항상 최신으로 유지되므로 fallback으로 사용한다.
																		const u =
																			missingTodayUrls[0] ||
																			collectTargetUrls[0] ||
																			productGroups[0]?.productUrl ||
																			(rankPollUrlsRef.current?.[0] as any);
																		if (!u) return;
																		// IMPORTANT: 팝업 차단 재발 방지
																		// - setTimeout 이후 openHostChromeProductSession을 호출하면, 내부 window.open(about:blank)조차 팝업으로 막힌다.
																		// - 또한 세션 준비는 서버가 호스트 크롬(CDP)에 탭을 열어주므로, 여기서 상품 URL을 별도 window.open으로 열 필요가 없다.
																		// - 클릭 제스처 컨텍스트 안에서 즉시 호출한다.
																		void openHostChromeProductSession('local', u);
																	}}
																>
																	로컬 세션 준비
																</button>
															) : null}
															{showInstallDownloads ? (
																hostSetupDownloads.map((item) => (
																	<button
																		key={`${uiTarget}:${item.path}`}
																		type="button"
																		className="btn-ghost"
																		style={{ fontSize: 11 }}
																		disabled={collectingNow}
																		onClick={() => downloadExternal(item.path, item.downloadName)}
																	>
																		{item.label}
																	</button>
																))
															) : (
																<details style={{ fontSize: 11, color: '#94a3b8' }}>
																	<summary style={{ cursor: 'pointer' }}>설치/복구 파일 보기</summary>
																	<div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
																		{hostSetupDownloads.map((item) => (
																			<button
																				key={`${uiTarget}:${item.path}`}
																				type="button"
																				className="btn-ghost"
																				style={{ fontSize: 11 }}
																				disabled={collectingNow}
																				onClick={() => downloadExternal(item.path, item.downloadName)}
																			>
																				{item.label}
																			</button>
																		))}
																	</div>
																</details>
															)}
															{uiTarget === 'nas' ? (
																<button
																	type="button"
																	className="btn-ghost"
																	disabled={collectingNow}
																	onClick={() => {
																		const u =
																			missingTodayUrls[0] ||
																			collectTargetUrls[0] ||
																			productGroups[0]?.productUrl ||
																			(rankPollUrlsRef.current?.[0] as any);
																		if (!u) return;
																		// 클릭 컨텍스트에서 즉시 호출(팝업 차단 회피).
																		void openHostChromeProductSession('nas', u);
																	}}
																>
																	NAS 세션 준비
																</button>
															) : null}
														</div>
														<div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
															{uiTarget === 'local' ? (
																<button
																	type="button"
																	className="btn-ghost"
																	disabled={cdpDebugLoading}
																	style={{ fontSize: 11 }}
																	onClick={() => void runCdpDebug('local')}
																>
																	{cdpDebugLoading ? '진단 중…' : 'CDP 연결 진단(로컬)'}
																</button>
															) : (
																<button
																	type="button"
																	className="btn-ghost"
																	disabled={cdpDebugLoading}
																	style={{ fontSize: 11 }}
																	onClick={() => void runCdpDebug('nas')}
																>
																	{cdpDebugLoading ? '진단 중…' : 'CDP 연결 진단(NAS)'}
																</button>
															)}
															{cdpDebug?.links?.length ? (
																<>
																	{cdpDebug.links.map((l) => (
																		<button
																			key={l.url}
																			type="button"
																			className="btn-ghost"
																			style={{ fontSize: 11 }}
																			onClick={() => openExternal(l.url)}
																		>
																			{l.label}
																		</button>
																	))}
																</>
															) : null}
														</div>
														{cdpDebugError ? (
															<div style={{ marginTop: 8, fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap' }}>{cdpDebugError}</div>
														) : null}
														{cdpDebug ? (
															<div
																style={{
																	marginTop: 8,
																	background: 'rgba(15, 23, 42, 0.55)',
																	border: `1px solid ${cdpDebug.level === 'warn' ? 'rgba(248, 113, 113, 0.35)' : 'rgba(148, 163, 184, 0.25)'}`,
																	borderRadius: 10,
																	padding: 10,
																}}
															>
																<div
																	style={{
																		fontSize: 11,
																		fontWeight: 900,
																		color: cdpDebug.level === 'warn' ? '#fca5a5' : '#e5e7eb',
																		marginBottom: 6,
																	}}
																>
																	{cdpDebug.title}
																</div>
																<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11, color: '#cbd5e1' }}>
																	{cdpDebug.lines.join('\n')}
																</pre>
															</div>
														) : null}
													</div>

													<div style={stepBox}>
														<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
															<div style={{ fontWeight: 900, color: '#e5e7eb' }}>4. 수집 실행</div>
															<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
																{uiTarget === 'local' ? (
																	<button
																		type="button"
																		className="btn-primary"
																		disabled={collectingNow || collectPopupReadOnly}
																		onClick={() => void collectNowAfterSessionReady('local')}
																	>
																		{collectingNow ? '수집 중…' : '지금 수집'}
																	</button>
																) : (
																	<button
																		type="button"
																		className="btn-primary"
																		disabled={collectingNow || collectPopupReadOnly}
																		onClick={() => void collectNowAfterSessionReady('nas')}
																	>
																		{collectingNow ? '수집 중…' : 'NAS 수집'}
																	</button>
																)}
																<button
																	type="button"
																	className="btn-ghost"
																	style={{ fontSize: 11 }}
																	aria-label="cleanup-host-setup"
																	disabled={collectingNow}
																	title="방화벽/portproxy 등 호스트 측 NAS 수집용 설정을 되돌리는 PowerShell 스크립트를 받습니다. 4번 수집과 무관하게 받을 수 있습니다."
																	onClick={() =>
																		openExternal(
																			uiTarget === 'nas'
																				? '/nas/Cleanup-Analytics-HostSetup.ps1'
																				: '/local/Cleanup-Analytics-HostSetup.ps1',
																		)
																	}
																>
																	정리(중지/삭제)
																</button>
															</div>
														</div>
														{missingTodayUrls.length > 0 && !hostSessionOpenedOnce ? (
															<div style={{ marginTop: 6, fontSize: 11, color: '#fca5a5' }}>
																먼저 3번 버튼으로 호스트 크롬(CDP)에서 상품 페이지를 열고 로그인/보안확인을 완료한 뒤 수집을 눌러주세요.
															</div>
														) : (
															<div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
																{missingTodayUrls.length > 0 ? (
																	<>
																		대상은 <b style={{ color: '#e5e7eb' }}>남은 상품만</b> 수집합니다.
																	</>
																) : (
																	<>
																		오늘이 “완료”여도 판매정보(최근 구매 배지)는 랜덤/일시 노출이라 재수집이 필요할 수 있어요. 필요하면 <b style={{ color: '#e5e7eb' }}>전체 재수집</b>을 실행하세요.
																	</>
																)}
															</div>
														)}
														{collectNowDetail ? (
															<div style={{ marginTop: 8, fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
																{collectNowDetail}
															</div>
														) : null}
													</div>
													</>

											{/* 키워드 순위 수집(OpenAPI, 수기 키워드 기준) */}
											{/* 사용자 요청: 수동으로 모달을 열었을 때도 현황/버튼이 항상 보여야 한다. */}
											{collectTargetUrls.length > 0 && (
												<div style={stepBox}>
													<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
														<div style={{ fontWeight: 900, color: '#e5e7eb' }}>5. 키워드 순위 수집(OpenAPI)</div>
														<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
															{rankCrawlJobId ? (
																<button
																	type="button"
																	className="btn-ghost"
																	disabled={collectPopupReadOnly}
																	onClick={() => void cancelRankCrawlJob()}
																>
																	수집 취소
																</button>
															) : null}
															<button
																type="button"
																className="btn-ghost"
																disabled={rankCollectingNow || collectPopupReadOnly}
																onClick={() => void deleteTodayCrawlAndRecollect()}
															>
																{rankCollectingNow ? '처리 중…' : '오늘(OpenAPI) 데이터 삭제 후 재수집'}
															</button>
															<button
																type="button"
																className="btn-primary"
																disabled={rankCollectingNow || collectPopupReadOnly}
																onClick={() => void startRankCollectAllMissingProducts()}
															>
																{rankCollectingNow ? '수집 시작 중…' : '키워드 순위 지금 수집'}
															</button>
														</div>
													</div>
													<div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
														<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
															<span style={{ fontSize: 11, color: '#9ca3af' }}>수집일(From)</span>
															<input
																className="input"
																type="date"
																value={rankCollectDateFrom}
																onChange={(e) => setRankCollectDateFrom(String(e.target.value || todayLocalStr))}
																aria-label="키워드 순위 수집 시작일"
															/>
														</label>
														<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
															<span style={{ fontSize: 11, color: '#9ca3af' }}>수집일(To)</span>
															<input
																className="input"
																type="date"
																value={rankCollectDateTo}
																onChange={(e) => setRankCollectDateTo(String(e.target.value || todayLocalStr))}
																aria-label="키워드 순위 수집 종료일"
															/>
														</label>
														<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
															<span style={{ fontSize: 11, color: '#9ca3af' }}>깊이</span>
															<select
																className="input"
																value={String(rankCrawlDepth)}
																onChange={(e) => {
																	const v = Number(e.target.value || 40);
																	setRankCrawlDepth(v === 80 ? 80 : v === 120 ? 120 : v === 500 ? 500 : v === 1000 ? 1000 : 40);
																}}
																aria-label="키워드 순위 수집 깊이"
															>
																<option value="40">TOP40</option>
																<option value="80">TOP80</option>
																<option value="120">TOP120</option>
																<option value="500">TOP500</option>
																<option value="1000">TOP1000</option>
															</select>
														</label>
														<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#cbd5e1' }}>
															<input
																type="checkbox"
																checked={rankCrawlMissingOnly}
																onChange={(e) => setRankCrawlMissingOnly(Boolean(e.target.checked))}
															/>
															미노출(0/없음) 키워드만 재수집
														</label>
													</div>
													<div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
														기준: 상품별 수기 키워드(월검색량) · 범위: {collectTargetUrls.length > 1 ? '다수 상품(동일 키워드 1회 수집)' : '단일 상품(상품별 순차 수집)'} · TOP{rankCrawlDepth} (OpenAPI 페이징)
														<br />
														수집일: {rankCollectDateFrom} ~ {rankCollectDateTo} (최대 30일)
													</div>
													{/* 상품별 키워드 수집 현황 */}
													{(() => {
														const urlsForTable =
															collectTargetUrls.length > 0 ? collectTargetUrls : productGroups.map((g) => g.productUrl).filter(Boolean);
														const rows = (urlsForTable || []).map((u, idx) => {
															const url = String(u || '').trim();
															const st = url ? (rankStatusMap as any)[url] : null;
															const total = Number(st?.total_keywords ?? 0);
															const processed = Number(st?.covered_keywords ?? 0);
															const exposed = Number(st?.exposed_keywords ?? 0);
															const noExposure = Number(st?.no_exposure_keywords ?? Math.max(0, processed - exposed));
															// 사용자 체감(중요):
															// - "수집 진행 %"는 기존 UX처럼 processed(=row 존재) 기준으로 표시한다.
															// - 노출(rank>0)/미노출(rank=0)은 별도 컬럼으로 확인한다.
															const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
															const complete = Boolean(st?.is_complete);
															// 상품명은 메타/메트릭에서 우선 가져오고, 최후에만 URL에서 추정한다.
															const metaTitle = String((listMetas as any)?.[url]?.title ?? '').trim();
															const summaryTitle = String((listSummaries as any)?.[url]?.product_title ?? '').trim();
															const metricsTitle = String((pageMetrics as any)?.[url]?.title ?? '').trim();
															const title = deriveTrackedProductLabel({
																url,
																index1: idx + 1,
																metaTitle,
																summaryTitle,
																metricsTitle,
															});
															return { url, title, total, processed, exposed, noExposure, pct, complete };
														});
														if (rows.length === 0) return null;
														return (
															<div style={{ marginTop: 10, border: '1px solid rgba(148,163,184,0.18)', borderRadius: 10, overflow: 'hidden' }}>
																<div style={{ padding: '8px 10px', fontSize: 11, color: '#cbd5e1', background: 'rgba(15, 23, 42, 0.35)' }}>
																	상품별 키워드 수집 현황
																</div>
																<div style={{ maxHeight: 180, overflow: 'auto' }}>
																	<table style={{ width: '100%', borderCollapse: 'collapse' }}>
																		<thead>
																			<tr style={{ fontSize: 11, color: '#9ca3af', background: 'rgba(2, 6, 23, 0.55)' }}>
																				<th style={{ textAlign: 'left', padding: '6px 10px' }}>상품</th>
																				<th style={{ textAlign: 'right', padding: '6px 10px', width: 90 }}>키워드</th>
																				<th style={{ textAlign: 'right', padding: '6px 10px', width: 90 }}>처리</th>
																				<th style={{ textAlign: 'right', padding: '6px 10px', width: 90 }}>노출</th>
																				<th style={{ textAlign: 'right', padding: '6px 10px', width: 80 }}>%</th>
																				<th style={{ textAlign: 'left', padding: '6px 10px', width: 86 }}>상태</th>
																			</tr>
																		</thead>
																		<tbody>
																			{rows.map((r) => (
																				<tr key={r.url} style={{ borderTop: '1px solid rgba(148,163,184,0.12)', fontSize: 12, color: '#e5e7eb' }}>
																					<td style={{ padding: '6px 10px', color: '#cbd5e1' }}>{r.title}</td>
																					<td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.total.toLocaleString()}</td>
																					<td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.processed.toLocaleString()}</td>
																					<td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.exposed.toLocaleString()}</td>
																					<td style={{ padding: '6px 10px', textAlign: 'right', color: r.total === 0 ? '#fca5a5' : r.complete ? '#86efac' : '#fbbf24' }}>
																						{r.total === 0 ? '-' : `${r.pct}%`}
																					</td>
																					<td style={{ padding: '6px 10px' }}>
																						{r.total === 0 ? (
																							<span style={{ color: '#fca5a5', fontWeight: 900 }}>키워드 없음</span>
																						) : r.complete ? (
																							<span style={{ color: '#86efac', fontWeight: 900 }}>처리완료</span>
																						) : (
																							<span style={{ color: '#fbbf24', fontWeight: 900 }}>미완료</span>
																						)}
																					</td>
																				</tr>
																			))}
																		</tbody>
																	</table>
																</div>
															</div>
														);
													})()}
													{rankCrawlStatus ? (
														<div style={{ marginTop: 6, fontSize: 11, color: rankCrawlStatus === 'SUCCESS' ? '#86efac' : '#9ca3af', fontWeight: 900 }}>
															상태: {rankCrawlStatus}
														</div>
													) : null}
													{rankCrawlDetail ? (
														<div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af', whiteSpace: 'pre-wrap' }}>
															{rankCrawlDetail}
														</div>
													) : null}
												</div>
											)}
												</div>
												)}
											</div>
										);
									})()}

									{(() => {
										const hint = derivePageMetricsBlockHint(scrapeOnce);
										if (!hint) return null;
										return (
											<div style={{ marginBottom: 10, color: hint.level === 'warn' ? '#fca5a5' : '#93c5fd' }}>
												<div style={{ fontWeight: 900, marginBottom: 6 }}>{hint.title}</div>
												<div style={{ fontSize: 11, color: '#9ca3af' }}>{hint.detail}</div>
												{getScrapeOnceBodySample(scrapeOnce) && (
													<pre
														style={{
															marginTop: 8,
															whiteSpace: 'pre-wrap',
															background: 'rgba(15, 23, 42, 0.6)',
															padding: 10,
															borderRadius: 8,
															color: '#cbd5e1',
															fontSize: 11,
															maxHeight: 120,
															overflow: 'auto',
														}}
													>
														{getScrapeOnceBodySample(scrapeOnce)}
													</pre>
												)}
											</div>
										);
									})()}
									{scrapeOnceError && (
										<div style={{ marginBottom: 10, color: '#fca5a5', fontSize: 11, whiteSpace: 'pre-wrap' }}>{scrapeOnceError}</div>
									)}
									{pageMetricsStatus?.detail === 'rate_limited' && (
										<div style={{ marginBottom: 10, color: '#fca5a5' }}>
											현재 레이트리밋/접속 제한(418) 가능성이 있습니다. 먼저 상품 페이지/쇼핑 탭을 열어 제한 화면이 뜨면 직접 해결해 주세요.
										</div>
									)}
									{collectingNow && (
										<div style={{ marginBottom: 10, color: '#9ca3af' }}>
											수집을 요청했습니다. 잠시만 기다려 주세요…
										</div>
									)}
								</div>
								<div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => {
											void closeCollectPopup();
										}}
									>
										닫기
									</button>
								</div>
							</div>
						</div>
					)}
				</div>
			)}
			{viewMode === 'detail' && detailProduct && (
				<RankTrackingDetailView
					apiBaseUrl={apiBaseUrl}
					product={detailProduct}
					history={detailHistory}
					manualHistory={manualHistory as any}
					manualTableDays={manualTableDays}
					onManualTableDaysChange={(d) => setManualTableDays(d)}
					trackedKeywords={
						selectedGroup?.keywords?.map((k) => ({ keyword: k.keyword, monthly_search_volume: k.monthly_search_volume ?? null })) ??
						[]
					}
					period={period}
					onPeriodChange={handleChangePeriod}
					onBackToList={handleBackToList}
					onEditKeywords={handleEditKeywords}
					onRankDataChanged={() => setRankDataVersion((v) => v + 1)}
					onOpenCollectModal={() => {
						const u = selectedGroup?.productUrl;
						if (!u) return;
						setCollectTargetUrls([u]);
						// 상세에서 수동 오픈은 "오늘 수집 완료" 여부와 무관하게 허용
						setMissingTodayUrls([]);
						setCollectPopupReadOnly(false);
						setCollectPopupAutoClose(false);
						setHostSessionOpenedOnce(false);
						openCollectPopup();
					}}
				/>
			)}
			{viewMode === 'detail' && !detailProduct && (
				<div className="card" style={{ fontSize: 11, color: '#9ca3af' }}>
					상세 정보를 표시할 상품이 없습니다. 먼저 상품을 선택해 주세요.
				</div>
			)}
		</div>
	);
};

// ---------- 검색 순위 - 4-2 개요 ----------

type SearchRankOverviewSectionProps = {
	apiBaseUrl: string;
};

const SearchRankOverviewSection: React.FC<SearchRankOverviewSectionProps> = ({ apiBaseUrl }) => {
	const [history, setHistory] = useState<ProductRankHistoryResponse | null>(null);

	useEffect(() => {
		let cancelled = false;
		const fetchHistory = async () => {
			try {
				const res = await axios.get<ProductRankHistoryResponse>(
					`${apiBaseUrl}/search-rank/history`,
					{
						params: { days: 14 },
					},
				);
				if (cancelled) return;
				setHistory(res.data);
			} catch (e) {
				console.error(e);
			}
		};
		void fetchHistory();
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl]);

	const overviewRows = useMemo(() => {
		if (!history) return [];
		return history.series.map((s) => {
			if (s.series.length === 0) {
				return {
					keyword: s.keyword,
					best: null as number | null,
					worst: null as number | null,
					avg: null as number | null,
				};
			}
			const ranks = s.series.map((p) => p.rank);
			const best = Math.min(...ranks);
			const worst = Math.max(...ranks);
			const avg = Math.round(
				(ranks.reduce((acc, v) => acc + v, 0) / ranks.length) * 10,
			) / 10;
			return {
				keyword: s.keyword,
				best,
				worst,
				avg,
			};
		});
	}, [history]);

	return (
		<div className="space-y-3">
			<div className="bg-slate-900/70 rounded-lg border border-slate-800 p-3">
				<div className="text-sm font-semibold mb-1">키워드별 순위 분포 요약</div>
				<div className="text-[11px] text-slate-400">
					최근 14일 기준 각 키워드의 최고/최저/평균 순위를 집계한 표입니다.
				</div>
			</div>
			<div className="bg-slate-900/70 rounded-lg border border-slate-800 p-3">
				<div className="overflow-x-auto">
					<table className="min-w-full text-[11px]">
						<thead>
							<tr className="text-slate-400 border-b border-slate-800">
								<th className="text-left py-1 px-1">키워드</th>
								<th className="text-right py-1 px-1">최고 순위(최소)</th>
								<th className="text-right py-1 px-1">최저 순위(최대)</th>
								<th className="text-right py-1 px-1">평균 순위</th>
							</tr>
						</thead>
						<tbody>
							{overviewRows.map((row) => (
								<tr key={row.keyword} className="border-b border-slate-900">
									<td className="py-1 px-1 whitespace-nowrap">{row.keyword}</td>
									<td className="py-1 px-1 text-right">
										{row.best ?? '-'}
									</td>
									<td className="py-1 px-1 text-right">
										{row.worst ?? '-'}
									</td>
									<td className="py-1 px-1 text-right">
										{row.avg ?? '-'}
									</td>
								</tr>
							))}
							{overviewRows.length === 0 && (
								<tr>
									<td
										colSpan={4}
										className="py-2 px-1 text-center text-slate-500"
									>
										표시할 데이터가 없습니다.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
};

// ---------- 공통 상수 ----------

const LINE_COLORS = [
	'#22c55e', // emerald-500
	'#38bdf8', // sky-400
	'#f97316', // orange-500
	'#eab308', // yellow-500
	'#a855f7', // purple-500
];


