import React from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { SocialCanvasEditor, clamp, overlayFromValue, type OverlayItem, type OverlayKey, type OverlayLayout } from './SocialCanvasEditor';
import { BlogV2ReviewPanel } from './BlogV2ReviewPanel';
import { ShortsGeneratorView, ShortsRenderPlanPanel } from './ShortsGeneratorView';
import { applyLocalDraftEdit, canApproveBlogV2, parseBlogV2Bundle, persistReviewBundle, shouldShowBlogV2ReviewPanel } from './blogV2Review';

type Props = {
	apiBaseUrl?: string;
	initialTab?: string;
};

type ViewKey = 'dashboard' | 'insights' | 'productInfo' | 'productImages' | 'detailPages' | 'referenceMedia' | 'appeals' | 'planning' | 'generation' | 'editor' | 'publish' | 'learning' | 'settings';
const CONTENT_GENERATION_CHANNELS = ['blog', 'instagram', 'shorts'] as const;
type WorkflowStep = {
	key: string;
	no: number | string;
	label: string;
	view: ViewKey;
	count: (data: ContentData) => number | string;
	status: (data: ContentData) => 'done' | 'active' | 'todo' | 'blocked';
	help: string;
};

type Appeal = {
	appeal_id: string;
	sku_id: string;
	label: string;
	appeal_text?: string;
	status?: string;
	learning_verdict?: string;
	evidence_count?: number;
	evidence?: Array<{ evidence_id?: string; source_type?: string; source_pk?: string; snippet?: string; sku_id?: string; evidence_class?: string; is_excluded?: boolean; rating?: number | null }>;
	scores?: { overall?: number };
	insight?: { problem?: string; desire?: string; trend?: string };
	evidence_classification?: Record<string, number>;
	emerging?: { status?: string; recent_count?: number; baseline_count?: number; recent_days?: number };
	usage_types?: string[];
	recommendation?: { safety_gate?: string; ai_recommended?: boolean; badges?: string[]; channel_fit?: Record<string, number>; reasons?: string[] };
	safety_gate?: string;
	admin_review_status?: string | null;
	admin_review_note?: string | null;
	admin_reviewed_at?: string | null;
	as_of_date?: string | null;
};

type TodayItem = {
	plan_id: string;
	sku_id: string;
	channel: string;
	status?: string;
	reason?: string;
	appeal_id: string;
	appeal?: Appeal;
	sku?: { title?: string } | null;
	artifact_id?: string | null;
	reviewer_status?: string | null;
};

type SkuScope = {
	sku_id: string;
	title?: string;
	product_url?: string;
	product_group?: string;
	phase1_enabled?: boolean;
	is_active?: boolean;
};

type ContentAsset = {
	asset_id: string;
	sku_id: string;
	product_url?: string | null;
	asset_type: 'product_image' | 'detail_page' | 'reference_media' | 'ingredient_document';
	asset_group_id?: string | null;
	group_name?: string | null;
	category?: string | null;
	keywords?: string | null;
	sku_ids?: string | null;
	filename: string;
	original_filename?: string | null;
	mime_type?: string | null;
	file_url: string;
	sort_order?: number;
	is_primary?: boolean;
	analysis_status?: string;
	analysis?: Record<string, any> | null;
	error_message?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};

type ProductInfo = {
	sku_id: string;
	product_url?: string | null;
	full_ingredients?: string | null;
	product_items?: Array<{ product_key?: string; product_name?: string; full_ingredients?: string; note?: string; ingredient_note?: string; source_note?: string }>;
	ingredient_note?: string | null;
	source_note?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};

type Insight = {
	insight_id: string;
	sku_id: string;
	theme_key?: string;
	problem?: string;
	desire?: string;
	barrier?: string;
	trend?: string;
	evidence_count?: number;
	as_of_date?: string | null;
};

type Artifact = {
	artifact_id: string;
	parent_artifact_id?: string | null;
	original_artifact_id?: string | null;
	revision_no?: number;
	revision_reason?: string | null;
	source?: string | null;
	is_published_version?: boolean;
	plan_id?: string | null;
	sku_id: string;
	appeal_id: string;
	channel: string;
	title: string;
	body?: Record<string, any>;
	export_text?: string;
	reviewer_status?: string;
	created_at?: string | null;
};

type LearningItem = {
	appeal_id: string;
	sku_id: string;
	label: string;
	learning_verdict?: string;
	overall_score?: number;
	status?: string;
};

type PublishManagementItem = {
	artifact_id: string;
	original_artifact_id?: string | null;
	revision_no?: number | null;
	channel: string;
	sku_id?: string | null;
	title?: string | null;
	reviewer_status?: string | null;
	artifact_status?: string | null;
	is_published_version?: boolean;
	publish_status?: string | null;
	publish_link_id?: string | null;
	publish_url?: string | null;
	external_id?: string | null;
	published_at?: string | null;
	gfa_creative_id?: string | null;
	attribution_level?: string | null;
	performance_status?: string | null;
	latest_performance_date?: string | null;
	management_status?: string | null;
	status?: string | null;
};

type ExportPreview = {
	artifact_id: string;
	channel: string;
	title?: string;
	body?: Record<string, any>;
	export_text: string;
};

type GenerationContext = {
	appealId: string;
	skuId: string;
	channels: string[];
};

function viewFromInitialTab(initialTab?: string): ViewKey {
	if (initialTab === 'insights') return 'insights';
	if (initialTab === 'product-info') return 'productInfo';
	if (initialTab === 'product-images') return 'productImages';
	if (initialTab === 'detail-pages') return 'detailPages';
	if (initialTab === 'reference-media') return 'referenceMedia';
	if (initialTab === 'appeals') return 'appeals';
	if (initialTab === 'planning') return 'planning';
	if (initialTab === 'generation') return 'generation';
	if (initialTab === 'review') return 'editor';
	if (initialTab === 'publish') return 'publish';
	if (initialTab === 'learning') return 'learning';
	if (initialTab === 'settings') return 'settings';
	return 'dashboard';
}

function pathForView(view: ViewKey): string {
	const suffix: Record<ViewKey, string> = {
		dashboard: 'today',
		insights: 'insights',
		productInfo: 'product-info',
		productImages: 'product-images',
		detailPages: 'detail-pages',
		referenceMedia: 'reference-media',
		appeals: 'appeals',
		planning: 'planning',
		generation: 'generation',
		editor: 'review',
		publish: 'publish',
		learning: 'learning',
		settings: 'settings',
	};
	return `/analytics/content/${suffix[view]}`;
}

type ShortsToolSource = { sourceType: 'APPEAL' | 'ARTIFACT' | 'TOPIC'; skuId?: string; appealId?: string; artifactId?: string };

function shortsToolPath(source?: ShortsToolSource): string {
	const params = new URLSearchParams({ tool: 'shorts' });
	if (source) {
		params.set('shorts_source', source.sourceType);
		if (source.skuId) params.set('shorts_sku_id', source.skuId);
		if (source.appealId) params.set('shorts_appeal_id', source.appealId);
		if (source.artifactId) params.set('shorts_artifact_id', source.artifactId);
	}
	return `${pathForView('generation')}?${params.toString()}`;
}

function shortsToolSourceFromSearch(search: string): ShortsToolSource | undefined {
	const params = new URLSearchParams(search);
	const sourceType = params.get('shorts_source');
	if (sourceType !== 'APPEAL' && sourceType !== 'ARTIFACT' && sourceType !== 'TOPIC') return undefined;
	return {
		sourceType,
		skuId: params.get('shorts_sku_id') || undefined,
		appealId: params.get('shorts_appeal_id') || undefined,
		artifactId: params.get('shorts_artifact_id') || undefined,
	};
}

function shortsToolSourceForArtifact(artifact: Pick<Artifact, 'artifact_id' | 'sku_id' | 'appeal_id'>): ShortsToolSource {
	const appealId = String(artifact.appeal_id || '');
	if (appealId && !appealId.startsWith('manual:')) return { sourceType: 'APPEAL', skuId: artifact.sku_id, appealId };
	return { sourceType: 'ARTIFACT', skuId: artifact.sku_id, artifactId: artifact.artifact_id };
}

type CollectionJob = {
	job_id?: string;
	status?: string;
	run_mode?: string;
	target_date?: string | null;
	date_from?: string | null;
	date_to?: string | null;
	started_at?: string | null;
	finished_at?: string | null;
	rows_written?: number | null;
	detail?: {
		insight?: { insights_upserted?: number; appeals_upserted?: number; evidence_written?: number };
		plan?: { created?: number; item_count?: number };
		artifacts?: { attempted?: number; created?: number; reused?: number; failed?: number };
		db_persistence?: { verification_status?: string; verification_reason?: string; empty_tables?: string[] };
	};
};

type CollectionTask = {
	task_id: string;
	label?: string;
	enabled?: boolean;
	schedule_enabled?: boolean;
	schedule_time?: string | null;
	freshness_days?: number | null;
	source_type?: string;
	provider?: string | null;
	runnable?: boolean;
	latest_job?: CollectionJob | null;
	latest_success_job?: CollectionJob | null;
};

type SourceMetric = {
	source: string;
	label?: string;
	task_id: string;
	latest_data_date?: string | null;
	latest_data_row_count?: number | null;
	today_row_count?: number | null;
	last_collection_at?: string | null;
	last_collection_status?: string | null;
	last_job_rows_written?: number | null;
	expected_lag?: string | null;
	readiness_status?: string | null;
	readiness_reason?: string | null;
};

type ContentData = {
	loading: boolean;
	error: string;
	today: TodayItem[];
	insights: Insight[];
	skuScopes: SkuScope[];
	artifacts: Artifact[];
	appeals: Appeal[];
	learningCounts: Record<string, number>;
	learningItems: LearningItem[];
	publishItems: PublishManagementItem[];
	publishCounts: Record<string, number>;
	dataReady: any;
	contentDailyTask: CollectionTask | null;
	sourceTasks: CollectionTask[];
	sourceMetrics: SourceMetric[];
	reload: () => Promise<void>;
};

const EMPTY_COUNTS: Record<string, number> = { PROMOTE: 0, MAINTAIN: 0, REVISE: 0, OBSERVE: 0 };
const CONTENT_CHANNELS = new Set(['blog', 'instagram', 'shorts']);

function isContentChannel(channel?: string | null): boolean {
	return CONTENT_CHANNELS.has(String(channel || '').toLowerCase());
}

function isLegacyGfaChannel(channel?: string | null): boolean {
	return String(channel || '').toLowerCase() === 'gfa';
}

function normalizeChannel(channel?: string): string {
	const c = String(channel || '').toLowerCase();
	if (c === 'blog') return '블로그';
	if (c === 'instagram') return '인스타그램';
	if (c === 'shorts') return '유튜브 숏츠';
	if (c === 'gfa') return 'GFA 광고';
	return channel || '-';
}

function contentGenerationChannelsForAppeal(appeal: Appeal): string[] {
	const fit = appeal.recommendation?.channel_fit || {};
	const recommended = CONTENT_GENERATION_CHANNELS.filter((channel) => Number(fit[channel] || 0) > 0);
	return recommended.length ? [...recommended] : [...CONTENT_GENERATION_CHANNELS];
}

function generationContextFromSearch(search: string): GenerationContext | null {
	const params = new URLSearchParams(search);
	const appealId = params.get('appeal_id') || '';
	const skuId = params.get('sku_id') || '';
	const channelParam = params.get('channel') || params.get('channels') || '';
	const selectedChannels = channelParam
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter((value) => isContentChannel(value));
	if (!appealId || !skuId) return null;
	return {
		appealId,
		skuId,
		channels: selectedChannels.length ? selectedChannels : [...CONTENT_GENERATION_CHANNELS],
	};
}

function statusLabel(status?: string | null): string {
	if (status === 'draft') return '임시 저장';
	if (status === 'review_pending') return '검수 대기';
	if (status === 'accepted') return '검수 완료';
	if (status === 'published') return '게시본';
	if (status === 'hold') return '보류';
	if (status === 'rejected') return '폐기';
	if (status === 'revised') return '수정됨';
	if (status === 'generation_failed') return '생성 실패';
	return '검수 대기';
}

function sourceLabel(source?: string | null): string {
	if (source === 'ai_original') return 'AI 원본';
	if (source === 'human') return '사용자 수정';
	if (source === 'ai') return 'AI 다시 생성';
	return source || 'AI 원본';
}

function normalizeText(value?: string | null): string {
	return String(value || '');
}

function exportFileName(item: Artifact): string {
	const channel = String(item.channel || 'content').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
	const artifactId = String(item.artifact_id || 'artifact').replace(/[^A-Za-z0-9_-]+/g, '-');
	return `${channel}_${artifactId}_v${item.revision_no || 1}.txt`;
}

function useContentCenterData(apiBaseUrl?: string): ContentData {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState('');
	const [today, setToday] = React.useState<TodayItem[]>([]);
	const [insights, setInsights] = React.useState<Insight[]>([]);
	const [skuScopes, setSkuScopes] = React.useState<SkuScope[]>([]);
	const [artifacts, setArtifacts] = React.useState<Artifact[]>([]);
	const [appeals, setAppeals] = React.useState<Appeal[]>([]);
	const [learningCounts, setLearningCounts] = React.useState<Record<string, number>>(EMPTY_COUNTS);
	const [learningItems, setLearningItems] = React.useState<LearningItem[]>([]);
	const [publishItems, setPublishItems] = React.useState<PublishManagementItem[]>([]);
	const [publishCounts, setPublishCounts] = React.useState<Record<string, number>>({});
	const [dataReady, setDataReady] = React.useState<any>(null);
	const [contentDailyTask, setContentDailyTask] = React.useState<CollectionTask | null>(null);
	const [sourceTasks, setSourceTasks] = React.useState<CollectionTask[]>([]);
	const [sourceMetrics, setSourceMetrics] = React.useState<SourceMetric[]>([]);

	const reload = React.useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [todayRes, insightRes, scopeRes, artifactRes, appealRes, learningRes, readyRes, publishRes, collectionTaskRes] = await Promise.all([
				axios.get(`${baseUrl}/content/today`),
				axios.get(`${baseUrl}/content/insights`),
				axios.get(`${baseUrl}/content/sku-scope`),
				axios.get(`${baseUrl}/content/artifacts`),
				axios.get(`${baseUrl}/content/appeals`),
				axios.get(`${baseUrl}/content/learning`),
				axios.get(`${baseUrl}/content/data-ready`),
				axios.get(`${baseUrl}/content/publish-links`).catch(() => null),
				axios.get(`${baseUrl}/collection/tasks?include_pending=true&include_coverage=false`).catch(() => null),
			]);
			setToday(todayRes.data?.items || []);
			setInsights(insightRes.data?.items || []);
			setSkuScopes(scopeRes.data?.items || []);
			setArtifacts(artifactRes.data?.items || []);
			setAppeals(appealRes.data?.items || []);
			setLearningCounts({ ...EMPTY_COUNTS, ...(learningRes.data?.counts || {}) });
			setLearningItems(learningRes.data?.items || []);
			setPublishItems(publishRes?.data?.items || []);
			setPublishCounts(publishRes?.data?.counts || {});
			const readyData = todayRes.data?.data_ready || readyRes.data || null;
			setDataReady(readyData);
			setSourceMetrics(readyData?.sources || []);
			const tasks = collectionTaskRes?.data?.tasks || [];
			setContentDailyTask(tasks.find((task: CollectionTask) => task.task_id === 'content_insight_daily') || null);
			const sourceIds = new Set(['reviews_collect', 'qna_collect', 'purchase_keywords', 'ads_daily', 'gfa_performance_daily', 'sales_orders']);
			setSourceTasks(tasks.filter((task: CollectionTask) => sourceIds.has(task.task_id)));
		} catch (e: any) {
			setError(String(e?.response?.data?.detail || e?.message || 'AI 콘텐츠 센터 데이터를 불러오지 못했습니다.'));
		} finally {
			setLoading(false);
		}
	}, [baseUrl]);

	React.useEffect(() => {
		void reload();
	}, [reload]);

	return { loading, error, today, insights, skuScopes, artifacts, appeals, learningCounts, learningItems, publishItems, publishCounts, dataReady, contentDailyTask, sourceTasks, sourceMetrics, reload };
}

const channels = [
	{ key: 'blog', label: '블로그', color: '#059669' },
	{ key: 'instagram', label: '인스타그램', color: '#e11d48' },
	{ key: 'shorts', label: '유튜브 숏츠', color: '#dc2626' },
];
const defaultChannel = { key: 'unknown', label: '-', color: '#64748b' };

const css: Record<string, React.CSSProperties> = {
	root: {
		display: 'grid',
		gap: 18,
		background: '#f8fafc',
		color: '#0f172a',
		minHeight: 'calc(100vh - 96px)',
		padding: 24,
		borderRadius: 18,
	},
	header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
	title: { fontSize: 24, fontWeight: 950, margin: 0 },
	subtitle: { fontSize: 12, color: '#64748b', marginTop: 4 },
	card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.05)' },
	cardPad: { padding: 16 },
	row: { display: 'flex', alignItems: 'center', gap: 10 },
	between: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
	button: { border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', minWidth: 0, whiteSpace: 'normal' },
	primaryButton: { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 900, cursor: 'pointer', minWidth: 0, whiteSpace: 'normal' },
	disabledButton: { border: '1px solid #e2e8f0', background: '#f8fafc', color: '#94a3b8', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'not-allowed', minWidth: 0, whiteSpace: 'normal' },
};

function Pill({ children, tone = '#2563eb' }: { children: React.ReactNode; tone?: string }): JSX.Element {
	return <span style={{ color: tone, background: `${tone}12`, border: `1px solid ${tone}33`, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 900 }}>{children}</span>;
}

function scopeLabel(scope: '현재' | '이번 분석' | '오늘' | '최근 6개월' | '누적'): string {
	return `[${scope}]`;
}

function ScopedMetric({ scope, label, value, tone = '#2563eb' }: { scope: '현재' | '이번 분석' | '오늘' | '최근 6개월' | '누적'; label: string; value: string | number; tone?: string }): JSX.Element {
	return (
		<div style={{ ...css.card, ...css.cardPad }}>
			<div style={{ color: tone, fontSize: 11, fontWeight: 950 }}>{scopeLabel(scope)}</div>
			<div style={{ color: '#64748b', fontSize: 12, fontWeight: 850, marginTop: 4 }}>{label}</div>
			<div style={{ color: '#0f172a', fontSize: 24, fontWeight: 950, marginTop: 6 }}>{typeof value === 'number' ? numberLabel(value) : value}</div>
		</div>
	);
}

function freshnessForDate(value?: string | null): 'NEW' | 'UPDATED' | 'UNCHANGED' {
	if (!value) return 'UNCHANGED';
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
	return String(value).startsWith(today) ? 'NEW' : 'UPDATED';
}

function FreshnessPill({ value }: { value?: string | null }): JSX.Element {
	const freshness = freshnessForDate(value);
	const tone = freshness === 'NEW' ? '#dc2626' : freshness === 'UPDATED' ? '#f59e0b' : '#64748b';
	return <Pill tone={tone}>{freshness}</Pill>;
}

function insightTrendLabel(trend?: string): 'NEW' | 'UPDATED' | 'UNCHANGED' {
	if (trend === 'new') return 'NEW';
	return trend ? 'UPDATED' : 'UNCHANGED';
}

function insightTrendTone(label: 'NEW' | 'UPDATED' | 'UNCHANGED'): string {
	if (label === 'NEW') return '#dc2626';
	if (label === 'UPDATED') return '#f59e0b';
	return '#64748b';
}

function CardMetaFooter({ updatedAt, scope, source, next }: { updatedAt?: string | null; scope: '현재' | '이번 분석' | '오늘' | '최근 6개월' | '누적'; source?: string; next?: string }): JSX.Element {
	return (
		<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 10, borderTop: '1px solid #f1f5f9', paddingTop: 8, lineHeight: 1.5 }}>
			Updated {updatedAt ? toKstLabel(updatedAt) : '-'} · {scopeLabel(scope)}{source ? ` · Source: ${source}` : ''}{next ? ` · Next: ${next}` : ''}
		</div>
	);
}

function ViewTabs({ view, setView }: { view: ViewKey; setView: (v: ViewKey) => void }): JSX.Element {
	const items: Array<{ key: ViewKey; label: string }> = [
		{ key: 'dashboard', label: '오늘' },
		{ key: 'insights', label: '인사이트' },
		{ key: 'productInfo', label: '제품정보' },
		{ key: 'productImages', label: '제품 이미지' },
		{ key: 'detailPages', label: '상세페이지' },
		{ key: 'referenceMedia', label: '참고 소재' },
		{ key: 'appeals', label: '소구' },
		{ key: 'planning', label: '기획' },
		{ key: 'generation', label: '콘텐츠 생성' },
		{ key: 'editor', label: '검수·에디터' },
		{ key: 'publish', label: '게시·성과' },
		{ key: 'learning', label: '학습' },
		{ key: 'settings', label: '설정' },
	];
	return (
		<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, background: '#f1f5f9', borderRadius: 12, padding: 4 }}>
			{items.map((item) => (
				<button key={item.key} type="button" style={view === item.key ? css.primaryButton : css.button} onClick={() => setView(item.key)}>
					{item.label}
				</button>
			))}
		</div>
	);
}

const workflowSteps: WorkflowStep[] = [
	{ key: 'collect', no: 1, label: '데이터 수집', view: 'settings', count: (data) => `정상 ${sourceStatusSummary(data).ready}/${sourceStatusSummary(data).total}`, status: (data) => sourceStatusSummary(data).status === 'READY' ? 'done' : 'blocked', help: '오늘 수집 상태 확인' },
	{ key: 'analysis', no: 2, label: '분석 결과', view: 'insights', count: (data) => `전체 Insight ${numberLabel(data.insights.length)}`, status: (data) => data.insights.length ? 'done' : 'todo', help: '새 Insight 확인' },
	{ key: 'productInfo', no: '2-1', label: '제품정보', view: 'productInfo', count: (data) => `SKU ${numberLabel(data.skuScopes.length)}개`, status: (data) => data.skuScopes.length ? 'active' : 'todo', help: '전성분/원료 자료 입력' },
	{ key: 'appeal', no: 3, label: '소구 선택', view: 'appeals', count: (data) => `전체 ${numberLabel(data.appeals.length)} · CLEAR ${numberLabel(data.appeals.filter((appeal) => appeal.safety_gate !== 'HOLD').length)} · HOLD ${numberLabel(data.appeals.filter((appeal) => appeal.safety_gate === 'HOLD').length)}`, status: (data) => data.appeals.length ? 'active' : 'todo', help: '소구 후보와 안전 보류 판단' },
	{ key: 'generate', no: 4, label: '콘텐츠 생성', view: 'generation', count: (data) => `오늘 생성대기 ${numberLabel(data.today.filter((item) => isContentChannel(item.channel) && !item.artifact_id).length)} · 생성완료 ${numberLabel(data.today.filter((item) => isContentChannel(item.channel) && item.artifact_id).length)}`, status: (data) => data.today.some((item) => isContentChannel(item.channel)) ? 'active' : 'todo', help: 'Content/SNS 생성 대기' },
	{ key: 'edit', no: 5, label: '수정·편집', view: 'editor', count: (data) => `편집대기 ${numberLabel(data.artifacts.filter((item) => isContentChannel(item.channel) && item.reviewer_status !== 'accepted').length)} · 전체 Revision ${numberLabel(data.artifacts.filter((item) => isContentChannel(item.channel)).length)}`, status: (data) => reviewWaitingArtifacts(data) ? 'active' : 'todo', help: '초안 수정' },
	{ key: 'review', no: 6, label: '최종 검수', view: 'editor', count: (data) => `검수대기 ${numberLabel(reviewWaitingArtifacts(data))} · 승인완료 ${numberLabel(approvedArtifacts(data))}`, status: (data) => reviewWaitingArtifacts(data) ? 'active' : 'todo', help: '게시 가능 여부 확정' },
	{ key: 'publish', no: 7, label: '게시', view: 'publish', count: (data) => `게시대기 ${numberLabel(data.publishCounts.READY_TO_PUBLISH || 0)} · 게시완료 ${numberLabel(data.publishCounts.PUBLISHED || 0)}`, status: (data) => (data.publishCounts.READY_TO_PUBLISH || 0) ? 'active' : 'todo', help: '승인본 URL 연결' },
	{ key: 'performance', no: 8, label: '성과 분석', view: 'publish', count: (data) => `성과대기 ${numberLabel(data.publishCounts.WAITING_PERFORMANCE || 0)} · 추적중 ${numberLabel(data.publishCounts.TRACKING || 0)}`, status: (data) => (data.publishCounts.TRACKING || 0) ? 'active' : 'todo', help: '성과 좋음/저조 판단' },
	{ key: 'reuse', no: 9, label: '재활용·확장', view: 'learning', count: (data) => `학습판정 ${numberLabel(data.learningItems.length)} · 확대 ${numberLabel(data.learningCounts.PROMOTE || 0)}`, status: (data) => data.learningItems.length ? 'active' : 'todo', help: '타 채널 활용 검토' },
];

function WorkflowStepper({ data, view, setView }: { data: ContentData; view: ViewKey; setView: (v: ViewKey) => void }): JSX.Element {
	return (
		<div style={{ display: 'grid', gap: 8 }}>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', gap: 6, background: '#f1f5f9', borderRadius: 14, padding: 6 }}>
				{workflowSteps.map((step) => {
					const active = view === step.view && (step.key !== 'review' || view === 'editor') && (step.key !== 'performance' || view === 'publish');
					const status = active ? 'active' : step.status(data);
					const tone = status === 'done' ? '#10b981' : status === 'active' ? '#2563eb' : status === 'blocked' ? '#dc2626' : '#64748b';
					const count = step.count(data);
					return (
						<button key={step.key} type="button" onClick={() => setView(step.view)} style={{ textAlign: 'left', border: active ? '2px solid #2563eb' : '1px solid #e2e8f0', background: active ? '#eff6ff' : '#fff', borderRadius: 12, padding: 10, cursor: 'pointer', minHeight: 88 }}>
							<div style={{ display: 'grid', gap: 6 }}>
								<strong style={{ color: tone, fontSize: 12 }}>{step.no}. {step.label}</strong>
								<span style={{ color: tone, fontSize: 11, fontWeight: 950, lineHeight: 1.3 }}>{String(count)}</span>
							</div>
							<div style={{ color: '#64748b', fontSize: 11, marginTop: 8, lineHeight: 1.35 }}>{step.help}</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function StageHeader({
	title,
	task,
	changed,
	reason,
	decision,
	next,
	stats = [],
}: {
	title: string;
	task: string;
	changed: string;
	reason: string;
	decision: string;
	next: string;
	stats?: Array<{ label: string; value: string | number; tone?: string }>;
}): JSX.Element {
	return (
		<section style={{ ...css.card, ...css.cardPad, border: '1px solid #bfdbfe', background: '#eff6ff' }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>{title}</h2>
					<p style={{ margin: '6px 0 0', color: '#1e3a8a', fontSize: 14, fontWeight: 900 }}>{task}</p>
				</div>
				<Pill tone="#2563eb">Workflow Workbench</Pill>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
				<div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, padding: 12 }}><strong>새로 바뀐 것</strong><br /><span style={{ color: '#475569', fontSize: 12 }}>{changed}</span></div>
				<div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, padding: 12 }}><strong>왜 봐야 하나</strong><br /><span style={{ color: '#475569', fontSize: 12 }}>{reason}</span></div>
				<div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, padding: 12 }}><strong>결정할 것</strong><br /><span style={{ color: '#475569', fontSize: 12 }}>{decision}</span></div>
				<div style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 12, padding: 12 }}><strong>다음 단계</strong><br /><span style={{ color: '#475569', fontSize: 12 }}>{next}</span></div>
			</div>
			{stats.length ? (
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
					{stats.map((item) => <Pill key={item.label} tone={item.tone || '#2563eb'}>{item.label} {item.value}</Pill>)}
				</div>
			) : null}
		</section>
	);
}

function SituationSummaryCards({ data }: { data: ContentData }): JSX.Element {
	const source = sourceStatusSummary(data);
	const cards = [
		{ label: '데이터 수집', value: `${source.ready}/${source.total}`, note: `${readinessLabel(source.status)} 소스`, tone: source.tone },
		{ label: '분석', value: numberLabel(data.insights.length), note: `근거 신호 ${numberLabel(insightEvidenceSignals(data))}`, tone: '#2563eb' },
		{ label: '소구', value: numberLabel(data.appeals.length), note: `근거 레코드 ${numberLabel(appealEvidenceRecords(data))}`, tone: '#7c3aed' },
		{ label: '기획', value: numberLabel(data.today.length), note: '오늘 기획', tone: '#0f766e' },
		{ label: '콘텐츠', value: numberLabel(todayPlanLinkedArtifacts(data)), note: `오늘 연결 / 전체 ${numberLabel(data.artifacts.length)}`, tone: '#0891b2' },
		{ label: '검수', value: numberLabel(reviewWaitingArtifacts(data)), note: '대기', tone: '#f59e0b' },
		{ label: '승인', value: numberLabel(approvedArtifacts(data)), note: '완료', tone: '#10b981' },
		{ label: '게시 완료', value: numberLabel(data.publishCounts.PUBLISHED || publishedArtifacts(data)), note: `게시대기 ${numberLabel(data.publishCounts.READY_TO_PUBLISH || 0)}`, tone: '#16a34a' },
		{ label: '성과', value: numberLabel((data.publishCounts.WAITING_PERFORMANCE || 0) + (data.publishCounts.TRACKING || 0)), note: '성과대기/추적', tone: '#64748b' },
		{ label: '학습', value: numberLabel(data.learningItems.length), note: `관찰 ${numberLabel(data.learningCounts.OBSERVE || 0)}`, tone: '#4f46e5' },
	];
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
			{cards.map((item) => (
				<div key={item.label} style={{ ...css.card, ...css.cardPad, position: 'relative' }}>
					<div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>{item.label}</div>
					<div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
						<span style={{ color: '#0f172a', fontSize: item.value === '대기' ? 20 : 28, fontWeight: 950 }}>{item.value}</span>
					</div>
					<div style={{ color: item.tone, fontSize: 11, fontWeight: 800, marginTop: 8 }}>{item.note}</div>
				</div>
			))}
		</div>
	);
}

function EmptyState({ message }: { message: string }): JSX.Element {
	return <div style={{ color: '#94a3b8', fontSize: 13, padding: 16, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>{message}</div>;
}

function toKstLabel(value?: string | null): string {
	if (!value) return '-';
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return String(value);
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).formatToParts(d);
	const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
	return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} KST`;
}

function numberLabel(value: number): string {
	return Number(value || 0).toLocaleString('ko-KR');
}

function readinessLabel(status: string): string {
	if (status === 'READY_PREVIOUS_DAY') return '전일 기준 준비 완료';
	if (status === 'READY_NO_NEW_ROWS') return '신규 없음';
	if (status === 'READY') return '준비 완료';
	if (status === 'PARTIAL') return '일부 확인 필요';
	if (status === 'FAILED') return '실패';
	if (status === 'MISSING') return '이력 없음';
	return '확인 필요';
}

function pipelineStatusLabel(status: string): string {
	if (status === 'SUCCESS') return '성공';
	if (status === 'READY') return '준비 완료';
	if (status === 'WAITING') return '대기';
	if (status === 'COMPLETE') return '완료';
	if (status === 'PUBLISHED') return '게시됨';
	if (status === 'OBSERVE') return '관찰';
	if (status === 'CLEAR') return '대기 없음';
	if (status === 'CHECK') return '확인 필요';
	return readinessLabel(status);
}

function verdictLabel(value?: string | null): string {
	if (value === 'PROMOTE') return '성과 우수 · 확장 추천';
	if (value === 'MAINTAIN') return '안정적 · 유지';
	if (value === 'REVISE') return '개선 필요';
	if (value === 'OBSERVE') return '데이터 부족 · 추가 관찰';
	return value || '데이터 부족 · 추가 관찰';
}

function verdictActionLabel(value?: string | null): string {
	if (value === 'PROMOTE') return '타 채널 활용 검토';
	if (value === 'MAINTAIN') return '현재 운영 유지';
	if (value === 'REVISE') return '수정·재기획';
	if (value === 'OBSERVE') return '성과 계속 관찰';
	return '성과 계속 관찰';
}

function runModeLabel(value?: string | null): string {
	if (value === 'manual') return '수동';
	if (value === 'schedule') return '자동';
	if (value === 'run_all') return '전체 실행';
	if (value === 'host_agent') return '호스트 에이전트';
	return value || '-';
}

type GenerationProgress = {
	percent: number;
	stage: string;
};

const generationProgressSteps: GenerationProgress[] = [
	{ percent: 8, stage: '생성 요청 준비' },
	{ percent: 20, stage: '소구/근거 반영 중' },
	{ percent: 38, stage: '글 작성 중' },
	{ percent: 58, stage: '이미지 생성 중' },
	{ percent: 78, stage: '상품 이미지 반영 중' },
	{ percent: 90, stage: '저장/화면 반영 중' },
	{ percent: 96, stage: '서버 완료 확인 중' },
];
const generationProgressStart: GenerationProgress = { percent: 8, stage: '생성 요청 준비' };

function generationProgressText(progress: GenerationProgress | undefined, fallback: string): string {
	return progress ? `${progress.percent}% · ${progress.stage}` : fallback;
}

function useGenerationProgress() {
	const [progressByKey, setProgressByKey] = React.useState<Record<string, GenerationProgress>>({});
	const timersRef = React.useRef<Record<string, number[]>>({});
	const clearTimers = React.useCallback((key: string) => {
		(timersRef.current[key] || []).forEach((timer) => window.clearTimeout(timer));
		delete timersRef.current[key];
	}, []);
	const start = React.useCallback((key: string) => {
		clearTimers(key);
		setProgressByKey((prev) => ({ ...prev, [key]: generationProgressStart }));
		timersRef.current[key] = generationProgressSteps.slice(1).map((step, index) =>
			window.setTimeout(() => setProgressByKey((prev) => ({ ...prev, [key]: step })), [1400, 5200, 10500, 17000, 24000][index] || 30000),
		);
	}, [clearTimers]);
	const finish = React.useCallback((key: string) => {
		clearTimers(key);
		setProgressByKey((prev) => ({ ...prev, [key]: { percent: 100, stage: '완료' } }));
		window.setTimeout(() => setProgressByKey((prev) => {
			const next = { ...prev };
			delete next[key];
			return next;
		}), 900);
	}, [clearTimers]);
	const fail = React.useCallback((key: string) => {
		clearTimers(key);
		setProgressByKey((prev) => ({ ...prev, [key]: { percent: 100, stage: '실패' } }));
		window.setTimeout(() => setProgressByKey((prev) => {
			const next = { ...prev };
			delete next[key];
			return next;
		}), 1600);
	}, [clearTimers]);
	React.useEffect(() => () => {
		Object.keys(timersRef.current).forEach(clearTimers);
	}, [clearTimers]);
	return { progressByKey, start, finish, fail };
}

function publishManagementStatusLabel(value?: string | null): string {
	if (value === 'READY_TO_PUBLISH') return '게시 준비';
	if (value === 'PUBLISHED') return '게시 완료';
	if (value === 'WAITING_PERFORMANCE') return '성과 대기';
	if (value === 'TRACKING') return '성과 추적 중';
	if (value === 'LEGACY_GFA') return 'Legacy GFA 보존';
	return value || '-';
}

function performanceStatusLabel(value?: string | null): string {
	if (value === 'TRACKING') return '성과 추적 중';
	if (value === 'WAITING') return '성과 대기';
	if (value === 'NOT_STARTED') return '시작 전';
	return value || '-';
}

function evidenceSourceLabel(value?: string | null): string {
	if (value === 'review') return '리뷰';
	if (value === 'qna') return '문의';
	if (value === 'ad_searchword') return '광고 검색어';
	if (value === 'purchase_keyword') return '구매 키워드';
	if (value === 'gfa_performance') return 'GFA 성과';
	return value || '기타';
}

function emergingLabel(value?: string | null): string {
	if (value === 'NEW') return '새롭게 등장';
	if (value === 'RISING') return '상승 중';
	if (value === 'DECLINING') return '감소 중';
	if (value === 'STABLE') return '지속 소구';
	return value || '판정 대기';
}

function usageTypeLabel(value?: string | null): string {
	if (value === 'PRODUCT_BENEFIT') return '제품 장점';
	if (value === 'USE_CASE') return '사용 상황';
	if (value === 'SOCIAL_PROOF') return '고객 반복 경험';
	if (value === 'ROUTINE') return '사용 루틴';
	if (value === 'EMOTIONAL_VALUE') return '감성 가치';
	if (value === 'DISCOVERY') return '신규 발견';
	return value || '기타';
}

function insightEvidenceSignals(data: ContentData): number {
	return data.insights.reduce((sum, item) => sum + Number(item.evidence_count || 0), 0);
}

function appealEvidenceRecords(data: ContentData): number {
	return data.appeals.reduce((sum, appeal) => sum + (appeal.evidence || []).length, 0);
}

function distinctEvidenceSources(data: ContentData): number {
	const keys = new Set<string>();
	data.appeals.forEach((appeal) => {
		(appeal.evidence || []).forEach((ev) => {
			keys.add(`${ev.source_type || 'unknown'}:${ev.source_pk || ev.snippet || ''}`);
		});
	});
	return keys.size;
}

function todayPlanLinkedArtifacts(data: ContentData): number {
	return data.today.filter((item) => isContentChannel(item.channel) && item.artifact_id).length;
}

function reviewWaitingArtifacts(data: ContentData): number {
	return data.artifacts.filter((item) => isContentChannel(item.channel) && ['pending', 'draft', 'review_pending'].includes(item.reviewer_status || 'pending')).length;
}

function approvedArtifacts(data: ContentData): number {
	const approved = new Set<string>();
	data.artifacts.forEach((item) => {
		if (isContentChannel(item.channel) && (item.reviewer_status === 'accepted' || item.reviewer_status === 'published' || item.is_published_version)) {
			approved.add(item.artifact_id);
		}
	});
	return approved.size;
}

function publishedArtifacts(data: ContentData): number {
	return data.artifacts.filter((item) => isContentChannel(item.channel) && (item.is_published_version || item.reviewer_status === 'published')).length;
}

const sourceTaskMeta: Record<string, { label: string; expectedLag: 'same_day' | 'previous_day' | 'range_may_have_no_new_rows' }> = {
	reviews_collect: { label: '리뷰', expectedLag: 'same_day' },
	qna_collect: { label: '문의', expectedLag: 'range_may_have_no_new_rows' },
	purchase_keywords: { label: '구매 키워드', expectedLag: 'previous_day' },
	ads_daily: { label: '광고 검색어', expectedLag: 'previous_day' },
	gfa_performance_daily: { label: 'GFA 성과', expectedLag: 'previous_day' },
	sales_orders: { label: '주문/매출', expectedLag: 'previous_day' },
};

function sourceReadiness(task: CollectionTask): { label: string; status: string; tone: string; dataDate: string; lastRun: string; rows: string } {
	const meta = sourceTaskMeta[task.task_id] || { label: task.label || task.task_id, expectedLag: 'same_day' as const };
	const job = task.latest_success_job || task.latest_job || null;
	const rawStatus = job?.status || 'MISSING';
	let status = 'MISSING';
	let tone = '#94a3b8';
	if (rawStatus && rawStatus !== 'SUCCESS' && rawStatus !== 'PARTIAL') {
		status = 'FAILED';
		tone = '#dc2626';
	} else if (meta.expectedLag === 'previous_day') {
		status = 'READY_PREVIOUS_DAY';
		tone = '#2563eb';
	} else if (meta.expectedLag === 'range_may_have_no_new_rows') {
		status = Number(job?.rows_written || 0) > 0 ? 'READY' : 'READY_NO_NEW_ROWS';
		tone = '#10b981';
	} else {
		status = 'READY';
		tone = '#10b981';
	}
	return {
		label: meta.label,
		status,
		tone,
		dataDate: job?.date_to || job?.target_date || '-',
		lastRun: toKstLabel(job?.finished_at),
		rows: job?.rows_written === null || job?.rows_written === undefined ? '-' : numberLabel(Number(job.rows_written)),
	};
}

function sourceMetricReadiness(source: SourceMetric): { label: string; status: string; tone: string; dataDate: string; latestRows: string; todayRows: string; jobRows: string; lastRun: string; reason: string } {
	const status = source.readiness_status || 'MISSING';
	const tone = status === 'FAILED' || status === 'MISSING' || status === 'STALE' ? '#dc2626' : status === 'READY_PREVIOUS_DAY' ? '#2563eb' : '#10b981';
	return {
		label: source.label || evidenceSourceLabel(source.source),
		status,
		tone,
		dataDate: source.latest_data_date || '-',
		latestRows: source.latest_data_row_count === null || source.latest_data_row_count === undefined ? '-' : numberLabel(Number(source.latest_data_row_count)),
		todayRows: source.today_row_count === null || source.today_row_count === undefined ? '-' : numberLabel(Number(source.today_row_count)),
		jobRows: source.last_job_rows_written === null || source.last_job_rows_written === undefined ? '-' : numberLabel(Number(source.last_job_rows_written)),
		lastRun: toKstLabel(source.last_collection_at),
		reason: source.readiness_reason || '',
	};
}

function sourceStatusSummary(data: ContentData): { ready: number; total: number; status: string; tone: string } {
	const rows = data.sourceMetrics.length ? data.sourceMetrics.map(sourceMetricReadiness) : data.sourceTasks.map(sourceReadiness);
	const ready = rows.filter((row) => row.status.startsWith('READY')).length;
	const total = rows.length || 6;
	if (ready === total && total > 0) return { ready, total, status: 'READY', tone: '#10b981' };
	if (ready > 0) return { ready, total, status: 'PARTIAL', tone: '#f59e0b' };
	return { ready, total, status: 'CHECK', tone: '#dc2626' };
}

function TodayContentQueue({ data, setView }: { data: ContentData; setView: (v: ViewKey) => void }): JSX.Element {
	const byChannel = channels.map((channel) => {
		const items = data.today.filter((item) => item.channel === channel.key);
		return { ...channel, items };
	});
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>오늘의 콘텐츠 큐</h2>
				<button type="button" style={css.button}>전체 보기</button>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
				{byChannel.map((channel) => (
					<div key={channel.key} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#f8fafc' }}>
						<div style={css.between}>
							<strong style={{ color: channel.color, fontSize: 12 }}>{channel.label}</strong>
							<strong>{channel.items.length}개</strong>
						</div>
						<Pill tone={channel.items.some((x) => x.artifact_id) ? '#2563eb' : '#f59e0b'}>
							{channel.items.some((x) => x.artifact_id) ? '검수 대기' : '생성 대기'}
						</Pill>
						<div style={{ height: 86, background: '#e2e8f0', borderRadius: 12, marginTop: 10, display: 'grid', placeItems: 'center', color: '#64748b', fontSize: 12, fontWeight: 800 }}>
							{channel.items[0]?.appeal?.label || channel.items[0]?.sku?.title || '데이터 없음'}
						</div>
						<button type="button" style={{ ...css.button, width: '100%', marginTop: 10 }} onClick={() => setView('editor')}>검수하기</button>
					</div>
				))}
			</div>
			{!data.loading && data.today.length === 0 ? <div style={{ marginTop: 12 }}><EmptyState message="오늘 생성된 콘텐츠 큐가 없습니다." /></div> : null}
		</section>
	);
}

function AppealPointPanel({ data }: { data: ContentData }): JSX.Element {
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>핵심 소구 포인트</h2>
				<button type="button" style={css.button}>전체 보기</button>
			</div>
			<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
				{data.appeals.slice(0, 5).map((appeal) => (
					<div key={appeal.appeal_id} style={{ ...css.between, border: '1px solid #f1f5f9', background: '#f8fafc', borderRadius: 12, padding: 12 }}>
						<div>
							<div style={{ fontWeight: 950 }}>{appeal.label}</div>
							<div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>근거 레코드 {appeal.evidence_count || 0} · {verdictLabel(appeal.learning_verdict)}</div>
						</div>
						<div style={{ width: 48, height: 48, borderRadius: 999, border: '3px solid #10b981', display: 'grid', placeItems: 'center', color: '#059669', fontWeight: 950 }}>{Math.round(appeal.scores?.overall || 0)}</div>
					</div>
				))}
				{!data.loading && data.appeals.length === 0 ? <EmptyState message="소구 포인트가 없습니다." /> : null}
			</div>
		</section>
	);
}

function EvidenceSnapshot({ data }: { data: ContentData }): JSX.Element {
	const counts = new Map<string, number>();
	data.appeals.forEach((appeal) => {
		(appeal.evidence || []).forEach((ev) => {
			const key = ev.source_type || 'unknown';
			counts.set(key, (counts.get(key) || 0) + 1);
		});
	});
	const sources = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>소구 근거 레코드</h2>
				<Pill tone="#64748b">고유 출처 {numberLabel(distinctEvidenceSources(data))}</Pill>
			</div>
			<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
				{sources.map(([source, count], index) => (
					<div key={source}>
						<div style={css.between}>
							<span style={{ color: '#475569', fontSize: 12, fontWeight: 850 }}>{evidenceSourceLabel(source)}</span>
							<span style={{ color: '#0f172a', fontSize: 12, fontWeight: 950 }}>{count.toLocaleString()}</span>
						</div>
						<div style={{ height: 7, background: '#e2e8f0', borderRadius: 99, marginTop: 5 }}>
							<div style={{ width: `${86 - index * 10}%`, height: '100%', background: '#2563eb', borderRadius: 99 }} />
						</div>
					</div>
				))}
				{!data.loading && sources.length === 0 ? <EmptyState message="소구 근거 레코드 데이터가 없습니다." /> : null}
			</div>
		</section>
	);
}

function SourceReadinessPanel({ data }: { data: ContentData }): JSX.Element {
	const rows = data.sourceMetrics.length
		? data.sourceMetrics.slice().sort((a, b) => (a.label || a.source).localeCompare(b.label || b.source)).map(sourceMetricReadiness)
		: data.sourceTasks
			.slice()
			.sort((a, b) => (sourceTaskMeta[a.task_id]?.label || a.task_id).localeCompare(sourceTaskMeta[b.task_id]?.label || b.task_id))
			.map((row) => {
				const fallback = sourceReadiness(row);
				return { ...fallback, latestRows: fallback.rows, todayRows: '-', jobRows: fallback.rows, reason: '기존 수집 작업 응답 기준입니다.' };
			});
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>원천 데이터 준비 상태</h2>
				<Pill tone={sourceStatusSummary(data).tone}>{sourceStatusSummary(data).ready}/{sourceStatusSummary(data).total} 준비 완료</Pill>
			</div>
			<div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.75fr 0.65fr 0.75fr 1fr 1fr', gap: 8, color: '#64748b', fontSize: 11, fontWeight: 900 }}>
					<div>원천</div>
					<div>데이터 기준일</div>
					<div>최신 데이터</div>
					<div>오늘</div>
					<div>수집 처리량</div>
					<div>최근 수집 (KST)</div>
					<div>상태</div>
				</div>
				{rows.map((row) => (
					<div key={row.label} title={row.reason} style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.75fr 0.65fr 0.75fr 1fr 1fr', gap: 8, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, background: '#f8fafc' }}>
						<strong style={{ fontSize: 12 }}>{row.label}</strong>
						<span style={{ color: '#475569', fontSize: 12 }}>{row.dataDate}</span>
						<span style={{ color: '#475569', fontSize: 12 }}>{row.latestRows}</span>
						<span style={{ color: '#475569', fontSize: 12 }}>{row.todayRows}</span>
						<span style={{ color: '#475569', fontSize: 12 }}>{row.jobRows}</span>
						<span style={{ color: '#475569', fontSize: 12 }}>{row.lastRun}</span>
						<Pill tone={row.tone}>{readinessLabel(row.status)}</Pill>
					</div>
				))}
				{!data.loading && rows.length === 0 ? <EmptyState message="수집 작업 상태 API 응답이 없습니다." /> : null}
			</div>
			<p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 0 }}>
				최신 데이터는 원천 테이블의 latest_data_date 기준 실제 row 수이고, 수집 처리량은 최근 job rows_written입니다.
			</p>
		</section>
	);
}

function PipelineSituationBoard({ data, setView }: { data: ContentData; setView: (v: ViewKey) => void }): JSX.Element {
	const source = sourceStatusSummary(data);
	const contentJob = data.contentDailyTask?.latest_success_job || data.contentDailyTask?.latest_job || null;
	const sourceRuns = data.sourceTasks.map((task) => task.latest_success_job?.finished_at || task.latest_job?.finished_at || '').filter(Boolean).sort();
	const latestSourceRun = sourceRuns.length ? sourceRuns[sourceRuns.length - 1] : null;
	const contentPlans = data.today.filter((item) => isContentChannel(item.channel));
	const contentArtifacts = data.artifacts.filter((item) => isContentChannel(item.channel));
	const gfaSource = data.sourceMetrics.find((item) => item.source === 'gfa_performance');
	const gfaRows = Number(gfaSource?.latest_data_row_count || 0);
	const steps: Array<{ key: string; label: string; status: string; count: string; lastRun: string; target: ViewKey; tone: string }> = [
		{ key: 'source', label: '데이터 수집', status: source.status, count: `${source.ready}/${source.total}`, lastRun: toKstLabel(latestSourceRun), target: 'settings', tone: source.tone },
		{ key: 'analysis', label: '분석', status: data.insights.length ? 'SUCCESS' : 'CHECK', count: `${numberLabel(data.insights.length)} 인사이트 · ${numberLabel(insightEvidenceSignals(data))} 근거 신호`, lastRun: toKstLabel(contentJob?.finished_at), target: 'insights', tone: '#2563eb' },
		{ key: 'appeal', label: '소구', status: data.appeals.length ? 'SUCCESS' : 'CHECK', count: `${numberLabel(data.appeals.length)} 소구 · ${numberLabel(appealEvidenceRecords(data))} 레코드`, lastRun: toKstLabel(contentJob?.finished_at), target: 'appeals', tone: '#7c3aed' },
		{ key: 'gfa-branch', label: 'GFA Branch', status: gfaRows ? 'OBSERVE' : 'WAITING', count: `성과 row ${numberLabel(gfaRows)} · GFA Generator 기준`, lastRun: toKstLabel(gfaSource?.last_collection_at), target: 'appeals', tone: '#4f46e5' },
		{ key: 'content-plan', label: 'Content/SNS 기획', status: contentPlans.length ? 'SUCCESS' : 'CHECK', count: `오늘 ${numberLabel(contentPlans.length)}`, lastRun: toKstLabel(contentJob?.finished_at), target: 'planning', tone: '#0f766e' },
		{ key: 'artifact', label: 'Content/SNS 생성', status: todayPlanLinkedArtifacts(data) ? 'READY' : 'WAITING', count: `오늘 ${numberLabel(todayPlanLinkedArtifacts(data))} · 전체 ${numberLabel(contentArtifacts.length)}`, lastRun: toKstLabel(contentJob?.finished_at), target: 'generation', tone: '#0891b2' },
		{ key: 'review', label: '검수', status: reviewWaitingArtifacts(data) ? 'WAITING' : 'CLEAR', count: `${numberLabel(reviewWaitingArtifacts(data))}건 대기`, lastRun: '-', target: 'editor', tone: '#f59e0b' },
		{ key: 'approval', label: '승인', status: approvedArtifacts(data) ? 'COMPLETE' : 'WAITING', count: `${numberLabel(approvedArtifacts(data))}건 완료`, lastRun: '-', target: 'editor', tone: '#10b981' },
		{ key: 'publish', label: '게시', status: (data.publishCounts.READY_TO_PUBLISH || data.publishCounts.PUBLISHED) ? 'PUBLISHED' : 'WAITING', count: `게시대기 ${numberLabel(data.publishCounts.READY_TO_PUBLISH || 0)} · 게시완료 ${numberLabel(data.publishCounts.PUBLISHED || 0)}`, lastRun: '-', target: 'publish', tone: '#16a34a' },
		{ key: 'performance', label: '성과', status: (data.publishCounts.TRACKING || 0) ? 'OBSERVE' : 'WAITING', count: `성과대기 ${numberLabel(data.publishCounts.WAITING_PERFORMANCE || 0)} · 추적중 ${numberLabel(data.publishCounts.TRACKING || 0)}`, lastRun: '-', target: 'publish', tone: '#64748b' },
		{ key: 'learning', label: '학습', status: data.learningItems.length ? 'OBSERVE' : 'WAITING', count: `${numberLabel(data.learningItems.length)}개 판정`, lastRun: toKstLabel(contentJob?.finished_at), target: 'learning', tone: '#4f46e5' },
	];
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>운영 파이프라인 상황판</h2>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
				{steps.map((step) => (
					<button key={step.key} type="button" onClick={() => setView(step.target)} style={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#fff', cursor: 'pointer' }}>
						<div style={css.between}>
							<strong style={{ color: step.tone, fontSize: 12 }}>{step.label}</strong>
							<Pill tone={step.tone}>{pipelineStatusLabel(step.status)}</Pill>
						</div>
						<div style={{ color: '#0f172a', fontSize: 13, fontWeight: 950, marginTop: 8 }}>{step.count}</div>
						<div style={{ color: '#94a3b8', fontSize: 10, marginTop: 6 }}>최근 실행: {step.lastRun}</div>
					</button>
				))}
			</div>
		</section>
	);
}

function LearningStatus({ data }: { data: ContentData }): JSX.Element {
	const items = [
		{ key: 'PROMOTE', label: '성과 우수 · 확대 활용 추천', tone: '#10b981' },
		{ key: 'MAINTAIN', label: '성과 안정 · 현재 전략 유지', tone: '#2563eb' },
		{ key: 'REVISE', label: '성과 저조 · 수정 검토', tone: '#dc2626' },
		{ key: 'OBSERVE', label: '데이터 부족 · 추가 관찰', tone: '#64748b' },
	];
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>학습 현황</h2>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
				{items.map((item) => (
					<div key={item.key} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
						<Pill tone={item.tone}>{item.key}</Pill>
						<div style={{ fontWeight: 950, marginTop: 8 }}>{item.label}</div>
						<div style={{ color: item.tone, fontSize: 22, fontWeight: 950, marginTop: 6 }}>{numberLabel(data.learningCounts[item.key] || 0)}</div>
					</div>
				))}
			</div>
		</section>
	);
}

function appealWhyNow(appeal: Appeal): string {
	const reasons = appeal.recommendation?.reasons || [];
	if (appeal.safety_gate === 'HOLD') return reasons[0] || '잠재 제품 이슈 Evidence가 있어 운영 검토가 필요합니다.';
	if (reasons[0]) return reasons[0];
	const recent = appeal.emerging?.recent_count || 0;
	const baseline = appeal.emerging?.baseline_count || 0;
	return `최근 ${appeal.emerging?.recent_days || 28}일 ${numberLabel(recent)}건 · baseline ${numberLabel(baseline)}건`;
}

function evidenceClassLine(appeal: Appeal): string {
	const counts = appeal.evidence_classification || {};
	const parts = [
		`리뷰+ ${counts.POSITIVE_REVIEW || 0}`,
		`Q&A+ ${counts.POSITIVE_QNA || 0}`,
		`불만 ${counts.NEGATIVE_COMPLAINT || 0}`,
		`오해 ${counts.MISUNDERSTANDING || 0}`,
		`이슈 ${counts.POTENTIAL_PRODUCT_ISSUE || 0}`,
	];
	return parts.join(' · ');
}

function selectedChannelBadges(appeal: Appeal): string[] {
	return (appeal.recommendation?.badges || []).filter((badge) => /GFA|Blog|Instagram|Shorts|FAQ/.test(badge));
}

function DailyRunControl({ apiBaseUrl, data }: { apiBaseUrl?: string; data: ContentData }): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [running, setRunning] = React.useState(false);
	const [runError, setRunError] = React.useState('');
	const task = data.contentDailyTask;
	const latest = task?.latest_success_job || task?.latest_job || null;
	const runNow = React.useCallback(async () => {
		const ok = window.confirm(
			[
				'AI 콘텐츠 Daily Job을 지금 실행합니다.',
				'',
				'기존 공식 수동 실행 경로로 SKU 범위 → 인사이트 → 소구 → 기획 → 콘텐츠를 갱신합니다.',
				'수정본/게시본은 기존 계약에 따라 보존됩니다.',
			].join('\n'),
		);
		if (!ok) return;
		setRunning(true);
		setRunError('');
		try {
			await axios.post(`${baseUrl}/collection/tasks/content_insight_daily/run`, { mode: 'manual' });
			await data.reload();
		} catch (e: any) {
			setRunError(String(e?.response?.data?.detail || e?.message || 'Daily Job 실행에 실패했습니다.'));
		} finally {
			setRunning(false);
		}
	}, [baseUrl, data]);
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>자동/수동 운영 제어</h2>
					<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>콘텐츠 일일 작업 공식 실행 경로 기준</div>
				</div>
				<Pill tone={task?.schedule_enabled ? '#10b981' : '#94a3b8'}>자동 실행 {task?.schedule_enabled ? '켜짐' : '꺼짐'}</Pill>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
				<div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
					<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>실행 시간</div>
					<strong>매일 {task?.schedule_time || '07:20'} KST</strong>
				</div>
				<div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
					<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>최근 실행</div>
					<strong>{pipelineStatusLabel(latest?.status || '')}</strong>
				</div>
				<div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
					<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>실행 방식</div>
					<strong>{runModeLabel(latest?.run_mode)}</strong>
				</div>
				<div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
					<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>최근 완료</div>
					<strong>{toKstLabel(latest?.finished_at)}</strong>
				</div>
			</div>
			<div style={{ ...css.between, marginTop: 12 }}>
				<div style={{ color: '#94a3b8', fontSize: 11 }}>수동 실행 후 운영 상황판이 즉시 다시 불러와집니다.</div>
				<button type="button" style={running ? css.disabledButton : css.primaryButton} disabled={running} onClick={runNow}>
					{running ? '실행 중...' : '지금 실행'}
				</button>
			</div>
			{runError ? <div style={{ color: '#dc2626', fontSize: 12, fontWeight: 800, marginTop: 10 }}>{runError}</div> : null}
		</section>
	);
}

function GfaAttributionStatus(): JSX.Element {
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>GFA 성과 연결 (직접 귀속)</h2>
				<Pill tone="#4f46e5">creative_id 기준</Pill>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
				{['콘텐츠', '소재 ID', '성과'].map((item) => (
					<div key={item} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, textAlign: 'center', fontWeight: 950 }}>{item}</div>
				))}
			</div>
			<p style={{ color: '#64748b', fontSize: 12, marginBottom: 0 }}>정확한 creative_id 매칭 시에만 직접 성과 연결이 적용됩니다.</p>
		</section>
	);
}

function TodayDashboard({ apiBaseUrl, data, setView }: { apiBaseUrl?: string; data: ContentData; setView: (v: ViewKey) => void }): JSX.Element {
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-today-dashboard">
			{data.error ? <EmptyState message={data.error} /> : null}
			<SituationSummaryCards data={data} />
			<div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 14 }}>
				<SourceReadinessPanel data={data} />
				<DailyRunControl apiBaseUrl={apiBaseUrl} data={data} />
			</div>
			<PipelineSituationBoard data={data} setView={setView} />
			<div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 0.8fr', gap: 14 }}>
				<TodayContentQueue data={data} setView={setView} />
				<AppealPointPanel data={data} />
				<EvidenceSnapshot data={data} />
			</div>
		</div>
	);
}

function InsightsView({ data, setView }: { data: ContentData; setView: (v: ViewKey) => void }): JSX.Element {
	const latest = data.contentDailyTask?.latest_success_job || data.contentDailyTask?.latest_job || null;
	const newInsights = data.insights.filter((item) => item.trend === 'new').length;
	const changedInsights = data.insights.filter((item) => item.trend && item.trend !== 'new').length;
	const unchangedInsights = Math.max(0, data.insights.length - newInsights - changedInsights);
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-insights-view">
			<StageHeader
				title="2. 분석 결과"
				task="이번 6개월 운영 분석에서 새로 발견되거나 변화한 고객 신호를 확인하세요."
				changed={`마지막 분석 ${toKstLabel(latest?.finished_at)} · 분석 결과 ${numberLabel(data.insights.length)}개`}
				reason="raw data가 아니라 소구로 이어질 고객 문제·욕구·장벽을 판단하는 단계입니다."
				decision="어떤 Insight를 소구 후보로 확인할지 결정합니다."
				next="관련 소구 포인트 보기로 이동해 채널 활용 여부를 판단합니다."
				stats={[
					{ label: 'Insight', value: data.insights.length, tone: '#2563eb' },
					{ label: '근거 신호', value: numberLabel(insightEvidenceSignals(data)), tone: '#7c3aed' },
					{ label: '활성 SKU', value: data.skuScopes.filter((item) => item.phase1_enabled).length, tone: '#0f766e' },
				]}
			/>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
				<ScopedMetric scope="이번 분석" label="전체 Insight" value={data.insights.length} tone="#2563eb" />
				<ScopedMetric scope="이번 분석" label="신규 / 변경 / 유지" value={`${newInsights} / ${changedInsights} / ${unchangedInsights}`} tone="#7c3aed" />
				<ScopedMetric scope="최근 6개월" label="Evidence 신호" value={numberLabel(insightEvidenceSignals(data))} tone="#0f766e" />
			</div>
			<section style={{ ...css.card, ...css.cardPad, border: '1px solid #bfdbfe', background: '#eff6ff' }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>콘텐츠 제작 참고자료</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>제품 이미지와 상세페이지를 SKU별로 업로드하면 이후 콘텐츠 생성에 자동 반영됩니다.</div>
					</div>
					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" style={css.primaryButton} onClick={() => setView('productImages')}>제품 이미지 업로드</button>
						<button type="button" style={css.button} onClick={() => setView('detailPages')}>상세페이지 업로드</button>
						<button type="button" style={css.button} onClick={() => setView('referenceMedia')}>참고 소재 업로드</button>
					</div>
				</div>
			</section>
			<section style={{ ...css.card, ...css.cardPad }}>
				<h2 style={{ marginTop: 0 }}>고객·시장 인사이트</h2>
				<div style={{ display: 'grid', gap: 10 }}>
					{data.insights.map((item) => {
						const trendLabel = insightTrendLabel(item.trend);
						return (
						<div key={item.insight_id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, background: '#f8fafc' }}>
							<div style={css.between}>
								<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
									<FreshnessPill value={item.as_of_date} />
									<Pill tone={insightTrendTone(trendLabel)}>{trendLabel}</Pill>
									<strong>{item.problem || item.theme_key || item.insight_id}</strong>
								</div>
								<Pill tone="#2563eb">{scopeLabel('최근 6개월')} Evidence {item.evidence_count || 0}</Pill>
							</div>
							<div style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 13, marginTop: 10 }}>
								<div><strong>무엇이 변했나</strong> {trendLabel === 'NEW' ? '이번 분석에서 새로 생성된 Insight입니다.' : trendLabel === 'UPDATED' ? '기존 Insight가 이번 분석에서 다시 갱신됐습니다.' : '변경 판정 근거가 없어 유지 항목으로 표시합니다.'}</div>
								<div><strong>왜 봐야 하나</strong> 소구 후보로 전환할 고객 문제·욕구·장벽입니다.</div>
								<div><strong>근거</strong> Evidence {item.evidence_count || 0} · SKU {item.sku_id}</div>
								<div><strong>내용</strong> 욕구: {item.desire || '-'} / 장벽: {item.barrier || '-'}</div>
							</div>
							<div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
								<button type="button" style={css.primaryButton} onClick={() => setView('appeals')}>관련 소구 보기</button>
							</div>
							<CardMetaFooter updatedAt={item.as_of_date} scope="이번 분석" source="Review/Q&A/Searchword/Purchase/GFA" next="소구 선택" />
						</div>
					);})}
					{!data.loading && data.insights.length === 0 ? <EmptyState message="저장된 인사이트가 없습니다." /> : null}
				</div>
			</section>
		</div>
	);
}

type AppealEvidenceItem = NonNullable<Appeal['evidence']>[number];
type EvidenceStarFilter = 'all' | 'none' | 1 | 2 | 3 | 4 | 5;

function isReviewEvidence(item: { source_type?: string }): boolean {
	return String(item.source_type || '').toLowerCase() === 'review';
}

function normalizeEvidenceStar(value: unknown): number | null {
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	const star = Math.round(n);
	return star >= 1 && star <= 5 ? star : null;
}

function evidenceMatchesStarFilter(item: AppealEvidenceItem, filter: EvidenceStarFilter): boolean {
	if (filter === 'all') return true;
	if (!isReviewEvidence(item)) return false;
	const star = normalizeEvidenceStar(item.rating);
	if (filter === 'none') return star == null;
	return star === filter;
}

function evidenceStarLabel(rating: number | null): string {
	if (rating == null) return '별점 없음';
	return `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} ${rating}점`;
}

function AppealEvidenceModal({ appeal, apiBaseUrl, onChanged, onClose }: { appeal: Appeal; apiBaseUrl?: string; onChanged: () => Promise<void>; onClose: () => void }): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const evidence = appeal.evidence || [];
	const [starFilter, setStarFilter] = React.useState<EvidenceStarFilter>('all');
	const visibleEvidence = evidence.filter((item) => evidenceMatchesStarFilter(item, starFilter));
	const reviewEvidenceIds = visibleEvidence
		.filter((item) => isReviewEvidence(item) && item.evidence_id)
		.map((item) => String(item.evidence_id));
	const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
	const [running, setRunning] = React.useState(false);
	const selectedSet = new Set(selectedIds);
	const starCounts = React.useMemo(() => {
		const counts: Record<EvidenceStarFilter | 'review', number> = { all: 0, review: 0, none: 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
		for (const item of evidence) {
			if (!isReviewEvidence(item)) continue;
			counts.review += 1;
			counts.all += 1;
			const star = normalizeEvidenceStar(item.rating);
			if (star == null) counts.none += 1;
			else counts[String(star) as EvidenceStarFilter] += 1;
		}
		return counts;
	}, [evidence]);
	const selectAllReviews = () => setSelectedIds(reviewEvidenceIds);
	const clearSelected = () => setSelectedIds([]);
	const toggle = (id: string, checked: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return Array.from(next);
		});
	};
	const excludeSelected = async () => {
		const ids = selectedIds.filter((id) => reviewEvidenceIds.includes(id));
		if (!ids.length) {
			window.alert('제외할 review evidence를 선택하세요.');
			return;
		}
		const ok = window.confirm(`선택한 review evidence ${ids.length}건을 이 소구 계산에서 제외할까요?`);
		if (!ok) return;
		setRunning(true);
		try {
			await axios.post(`${baseUrl}/content/appeals/${appeal.appeal_id}/evidence/exclude`, {
				evidence_ids: ids,
				reason: '관리자가 Evidence 모달에서 review 제외 처리',
			});
			await onChanged();
			onClose();
		} finally {
			setRunning(false);
		}
	};
	const starFilterButtons: Array<{ key: EvidenceStarFilter; label: string; count?: number }> = [
		{ key: 'all', label: '전체', count: evidence.length },
		{ key: 5, label: '5점', count: starCounts['5'] },
		{ key: 4, label: '4점', count: starCounts['4'] },
		{ key: 3, label: '3점', count: starCounts['3'] },
		{ key: 2, label: '2점', count: starCounts['2'] },
		{ key: 1, label: '1점', count: starCounts['1'] },
		{ key: 'none', label: '없음', count: starCounts.none },
	];
	return (
		<div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 24 }}>
			<div style={{ ...css.card, width: 'min(860px, 96vw)', maxHeight: '88vh', overflow: 'auto', padding: 22 }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0 }}>Evidence 보기</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{appeal.label} · 근거 레코드 {appeal.evidence_count || evidence.length} · 표시 {visibleEvidence.length}건</div>
					</div>
					<button type="button" style={css.button} onClick={onClose}>닫기</button>
				</div>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, background: '#f8fafc' }}>
					<Pill tone={selectedIds.length ? '#2563eb' : '#64748b'}>선택 {selectedIds.length}건</Pill>
					<button type="button" style={css.button} onClick={selectAllReviews}>REVIEW 전체 선택</button>
					<button type="button" style={css.button} onClick={clearSelected}>전체 해제</button>
					<button type="button" style={running || selectedIds.length === 0 ? css.disabledButton : css.primaryButton} disabled={running || selectedIds.length === 0} onClick={() => void excludeSelected()}>
						{running ? '제외 처리 중...' : '선택 REVIEW 제외'}
					</button>
				</div>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }} role="group" aria-label="별점 필터">
					<span style={{ color: '#475569', fontSize: 12, fontWeight: 800 }}>별점</span>
					{starFilterButtons.map((button) => (
						<button
							key={String(button.key)}
							type="button"
							aria-label={`별점 ${button.label} 필터`}
							aria-pressed={starFilter === button.key}
							style={starFilter === button.key ? css.primaryButton : css.button}
							onClick={() => setStarFilter(button.key)}
						>
							{button.label} {button.count ?? 0}
						</button>
					))}
				</div>
				<div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
					{visibleEvidence.map((item, index) => {
						const review = isReviewEvidence(item);
						const star = review ? normalizeEvidenceStar(item.rating) : null;
						return (
							<div key={`${item.source_type || 'source'}-${item.source_pk || index}`} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#f8fafc' }}>
								{review && item.evidence_id ? (
									<label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, color: '#334155', fontSize: 12, fontWeight: 900 }}>
										<input type="checkbox" checked={selectedSet.has(String(item.evidence_id))} onChange={(event) => toggle(String(item.evidence_id), event.target.checked)} />
										제외 선택
									</label>
								) : null}
								<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
									<Pill tone="#2563eb">{item.source_type || 'source'}</Pill>
									{item.evidence_class ? <Pill tone="#7c3aed">{item.evidence_class}</Pill> : null}
									<Pill tone="#64748b">{item.source_pk || '-'}</Pill>
									{review ? <Pill tone={star == null ? '#64748b' : '#d97706'}>{evidenceStarLabel(star)}</Pill> : null}
								</div>
								<div style={{ color: '#334155', fontSize: 13, lineHeight: 1.55, marginTop: 8 }}>{item.snippet || '-'}</div>
							</div>
						);
					})}
					{evidence.length === 0 ? <EmptyState message="이 소구에 표시할 Evidence 상세가 없습니다." /> : null}
					{evidence.length > 0 && visibleEvidence.length === 0 ? <EmptyState message="선택한 별점의 리뷰 Evidence가 없습니다." /> : null}
				</div>
			</div>
		</div>
	);
}

function AppealsView({ apiBaseUrl, data, setView, setSelectedId }: { apiBaseUrl?: string; data: ContentData; setView: (v: ViewKey) => void; setSelectedId: (id: string) => void }): JSX.Element {
	const navigate = useNavigate();
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [evidenceAppeal, setEvidenceAppeal] = React.useState<Appeal | null>(null);
	const [activatingAppealId, setActivatingAppealId] = React.useState('');
	const artifactByAppealSkuChannel = React.useMemo(() => {
		const map = new Map<string, Artifact>();
		data.artifacts
			.filter((artifact) => isContentChannel(artifact.channel))
			.forEach((artifact) => {
				const key = `${artifact.appeal_id}|${artifact.sku_id}|${String(artifact.channel || '').toLowerCase()}`;
				if (!map.has(key)) map.set(key, artifact);
			});
		return map;
	}, [data.artifacts]);
	const contentArtifactForAppeal = (appeal: Appeal, channel: string): Artifact | undefined =>
		artifactByAppealSkuChannel.get(`${appeal.appeal_id}|${appeal.sku_id}|${channel}`);
	const holdCount = data.appeals.filter((appeal) => appeal.safety_gate === 'HOLD').length;
	const clearCount = data.appeals.length - holdCount;
	const aiCount = data.appeals.filter((appeal) => appeal.recommendation?.ai_recommended).length;
	const risingCount = data.appeals.filter((appeal) => appeal.emerging?.status === 'RISING' || appeal.emerging?.status === 'NEW').length;
	const plannedAppealIds = new Set(data.today.filter((item) => isContentChannel(item.channel)).map((item) => item.appeal_id));
	const clearUnplanned = data.appeals.filter((appeal) => appeal.safety_gate !== 'HOLD' && !plannedAppealIds.has(appeal.appeal_id)).length;
	const clearPlanned = data.appeals.filter((appeal) => appeal.safety_gate !== 'HOLD' && plannedAppealIds.has(appeal.appeal_id)).length;
	const goGeneration = (appeal: Appeal, channel?: string) => {
		if (channel === 'shorts') {
			navigate(shortsToolPath({ sourceType: 'APPEAL', skuId: appeal.sku_id, appealId: appeal.appeal_id }));
			return;
		}
		const params = new URLSearchParams({
			appeal_id: appeal.appeal_id,
			sku_id: appeal.sku_id,
		});
		if (channel) {
			params.set('channel', channel);
		} else {
			params.set('channels', contentGenerationChannelsForAppeal(appeal).join(','));
		}
		navigate(`${pathForView('generation')}?${params.toString()}`);
	};
	const activateAppeal = async (appeal: Appeal) => {
		const ok = window.confirm('Evidence 내용을 확인했고 이 소구포인트를 콘텐츠 생성 가능 상태로 활성화할까요?');
		if (!ok) return;
		setActivatingAppealId(appeal.appeal_id);
		try {
			await axios.patch(`${baseUrl}/content/appeals/${appeal.appeal_id}/admin-review`, {
				status: 'CLEAR',
				note: '관리자가 Evidence 확인 후 콘텐츠 생성 가능으로 활성화',
			});
			await data.reload();
		} finally {
			setActivatingAppealId('');
		}
	};
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-appeals-view">
			<StageHeader
				title="3. 소구점 분석·선택"
				task="AI가 발견한 소구를 검토하고 사용할 채널을 판단하세요."
				changed={`신규/상승 후보 ${numberLabel(risingCount)}개 · 운영 검토 HOLD ${numberLabel(holdCount)}개`}
				reason="소구는 GFA와 Content/SNS가 갈라지는 마지막 공통 의사결정 지점입니다."
				decision="CLEAR 소구는 추천 채널을 확인하고, HOLD 소구는 Evidence를 먼저 검토합니다."
				next="Content/SNS 추천 소구는 콘텐츠 생성 단계로, GFA 추천은 기존 GFA Branch로 넘깁니다."
				stats={[
					{ label: 'CLEAR', value: clearCount, tone: '#10b981' },
					{ label: 'AI 추천', value: aiCount, tone: '#7c3aed' },
					{ label: 'HOLD', value: holdCount, tone: '#dc2626' },
					{ label: '근거 레코드', value: numberLabel(appealEvidenceRecords(data)), tone: '#64748b' },
				]}
			/>
			<section style={{ ...css.card, ...css.cardPad }}>
				<div style={css.between}>
					<h2 style={{ margin: 0 }}>소구 포인트</h2>
					<Pill tone="#10b981">소구 근거 레코드 {numberLabel(appealEvidenceRecords(data))}</Pill>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
					<ScopedMetric scope="현재" label="전체 소구 / CLEAR / HOLD" value={`${data.appeals.length} / ${clearCount} / ${holdCount}`} tone="#7c3aed" />
					<ScopedMetric scope="이번 분석" label="NEW 또는 RISING" value={risingCount} tone="#f59e0b" />
					<ScopedMetric scope="현재" label="채널 미선택 CLEAR" value={clearUnplanned} tone="#dc2626" />
					<ScopedMetric scope="현재" label="생성 큐 반영 CLEAR" value={clearPlanned} tone="#10b981" />
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
					<Pill tone="#2563eb">우선 처리: NEW/RISING + AI 추천</Pill>
					<Pill tone="#10b981">CLEAR {clearCount}</Pill>
					<Pill tone="#dc2626">HOLD {holdCount}</Pill>
					<Pill tone="#4f46e5">GFA Branch 분리</Pill>
					<Pill tone="#0f766e">Content/SNS 생성 단계 연결</Pill>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
					{data.appeals.map((appeal) => (
						<div key={appeal.appeal_id} style={{ border: appeal.safety_gate === 'HOLD' ? '2px solid #fecaca' : '1px solid #e2e8f0', borderRadius: 16, padding: 14, background: appeal.safety_gate === 'HOLD' ? '#fff7ed' : '#fff' }}>
							<div style={css.between}>
								<strong>{appeal.label}</strong>
								<div style={{ width: 44, height: 44, borderRadius: 999, border: '3px solid #10b981', display: 'grid', placeItems: 'center', color: '#059669', fontWeight: 950 }}>{Math.round(appeal.scores?.overall || 0)}</div>
							</div>
							<p style={{ color: '#475569', fontSize: 13, minHeight: 52 }}>{appeal.appeal_text || appeal.insight?.problem || '-'}</p>
							<div style={{ display: 'grid', gap: 7, border: '1px solid #f1f5f9', borderRadius: 12, padding: 10, background: '#f8fafc', color: '#334155', fontSize: 12, marginBottom: 10 }}>
								<div><strong>왜 지금 봐야 하나?</strong> {appealWhyNow(appeal)}</div>
								<div><strong>Evidence</strong> {evidenceClassLine(appeal)} · 총 {appeal.evidence_count || 0}</div>
								<div><strong>갱신 기준</strong> 분석 기준일 {appeal.as_of_date || '-'} · {emergingLabel(appeal.emerging?.status)}</div>
								<div><strong>결정</strong> {appeal.safety_gate === 'HOLD' ? '운영자가 Evidence를 검토하기 전 자동 채널 선택 불가' : '추천 채널을 확인하고 Content/SNS 생성 또는 GFA Branch로 넘깁니다.'}</div>
							</div>
							<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
								<Pill tone={appeal.emerging?.status === 'NEW' ? '#dc2626' : appeal.emerging?.status === 'RISING' ? '#f59e0b' : appeal.emerging?.status === 'DECLINING' ? '#64748b' : '#0f766e'}>
									{emergingLabel(appeal.emerging?.status)}
								</Pill>
								{appeal.safety_gate === 'HOLD' ? <Pill tone="#dc2626">운영 검토 HOLD</Pill> : null}
								{(appeal.recommendation?.badges || []).slice(0, 4).map((badge) => (
									<Pill key={badge} tone={badge.includes('GFA') ? '#4f46e5' : badge.includes('Blog') || badge.includes('FAQ') ? '#2563eb' : badge.includes('Instagram') || badge.includes('Shorts') ? '#db2777' : '#7c3aed'}>
										{badge}
									</Pill>
								))}
								{(appeal.usage_types || []).slice(0, 3).map((usage) => (
									<Pill key={usage} tone="#64748b">{usageTypeLabel(usage)}</Pill>
								))}
								<Pill>SKU {appeal.sku_id}</Pill>
								<Pill tone="#7c3aed">{verdictLabel(appeal.learning_verdict)}</Pill>
								<Pill tone="#64748b">근거 레코드 {appeal.evidence_count || 0}</Pill>
							</div>
							<div style={{ color: '#64748b', fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
								최근 {appeal.emerging?.recent_days || 28}일 {numberLabel(appeal.emerging?.recent_count || 0)}건 · baseline {numberLabel(appeal.emerging?.baseline_count || 0)}건
							</div>
							{(appeal.recommendation?.reasons || []).length ? (
								<div style={{ marginTop: 10, border: '1px solid #f1f5f9', borderRadius: 12, background: '#f8fafc', padding: 10, color: '#334155', fontSize: 12, lineHeight: 1.5 }}>
									<strong>AI 추천 이유</strong>
									<div>{appeal.recommendation?.reasons?.[0]}</div>
								</div>
							) : null}
							<div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
								<div style={{ color: '#475569', fontSize: 12, fontWeight: 900, marginBottom: 8 }}>이 소구를 어디에 사용할까요?</div>
								<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
									{['GFA', 'Blog', 'Instagram', 'Shorts', 'FAQ'].map((channel) => {
										const recommended = selectedChannelBadges(appeal).some((badge) => badge.toLowerCase().includes(channel.toLowerCase()));
										const contentChannel = channel.toLowerCase();
										const existingArtifact = isContentChannel(contentChannel) ? contentArtifactForAppeal(appeal, contentChannel) : undefined;
										const disabled = appeal.safety_gate === 'HOLD' || (!isContentChannel(contentChannel) && channel !== 'GFA');
										return (
											<button
												key={channel}
												type="button"
												disabled={disabled}
												style={disabled ? css.disabledButton : recommended ? css.primaryButton : css.button}
												onClick={() => {
													if (channel === 'GFA') {
														navigate(`/analytics/gfa/creative-generator?generation_source=appeal&appeal_point_id=${encodeURIComponent(appeal.appeal_id)}`);
														return;
													}
													if (isContentChannel(contentChannel)) goGeneration(appeal, contentChannel);
												}}
											>
												{channel}{contentChannel === 'shorts' ? ' 제작 툴' : existingArtifact ? ' 재생성' : recommended ? ' 추천' : ''}
											</button>
										);
									})}
								</div>
								{appeal.safety_gate === 'HOLD' ? (
									<div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
										<button type="button" style={css.button} onClick={() => setEvidenceAppeal(appeal)}>Evidence 보기</button>
										<button
											type="button"
											style={activatingAppealId === appeal.appeal_id ? css.disabledButton : css.primaryButton}
											disabled={activatingAppealId === appeal.appeal_id}
											onClick={() => void activateAppeal(appeal)}
										>
											{activatingAppealId === appeal.appeal_id ? '활성화 중...' : '관리자 확인 후 활성화'}
										</button>
									</div>
								) : (
									<div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
										<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
											{contentGenerationChannelsForAppeal(appeal).map((channel) => {
												const existingArtifact = contentArtifactForAppeal(appeal, channel);
												return (
													<React.Fragment key={channel}>
														<button type="button" style={css.primaryButton} onClick={() => goGeneration(appeal, channel)}>
															{normalizeChannel(channel)} {existingArtifact ? '재생성' : '생성'}
														</button>
														{existingArtifact ? (
															<button
																type="button"
																style={css.button}
																onClick={() => {
																	setSelectedId(existingArtifact.artifact_id);
																	setView('editor');
																}}
															>
																{normalizeChannel(channel)} 편집
															</button>
														) : null}
													</React.Fragment>
												);
											})}
										</div>
										<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
											<button type="button" style={css.button} onClick={() => setEvidenceAppeal(appeal)}>Evidence 보기</button>
											<button type="button" style={css.button} onClick={() => goGeneration(appeal)}>콘텐츠 생성 화면에서 선택</button>
										</div>
									</div>
								)}
							</div>
						</div>
					))}
				</div>
				{!data.loading && data.appeals.length === 0 ? <EmptyState message="소구 포인트가 없습니다." /> : null}
			</section>
			{evidenceAppeal ? <AppealEvidenceModal appeal={evidenceAppeal} apiBaseUrl={apiBaseUrl} onChanged={data.reload} onClose={() => setEvidenceAppeal(null)} /> : null}
		</div>
	);
}

function PlanningCompactSummary({ data, setView }: { data: ContentData; setView: (v: ViewKey) => void }): JSX.Element {
	const contentToday = data.today.filter((item) => isContentChannel(item.channel));
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>오늘 상태 요약</h2>
					<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>전체 상황은 오늘 화면에서 보고, 여기서는 생성할 기획만 처리합니다.</div>
				</div>
				<button type="button" style={css.button} onClick={() => setView('dashboard')}>오늘 상황판 보기</button>
			</div>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
				<Pill tone={data.dataReady?.ready ? '#10b981' : '#f59e0b'}>수집 {data.dataReady?.ready ? '준비 완료' : '확인 필요'}</Pill>
				<Pill tone="#2563eb">Insight {numberLabel(data.insights.length)}</Pill>
				<Pill tone="#7c3aed">소구 {numberLabel(data.appeals.length)}</Pill>
				<Pill tone="#0f766e">오늘 기획 {numberLabel(contentToday.length)}</Pill>
			</div>
		</section>
	);
}

function PlanningView({ data, setView, setSelectedId }: { data: ContentData; setView: (v: ViewKey) => void; setSelectedId: (id: string) => void }): JSX.Element {
	const contentToday = data.today.filter((item) => isContentChannel(item.channel));
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-planning-view">
			<StageHeader
				title="4. 콘텐츠 생성 준비"
				task="선택된 Content/SNS 소구가 오늘 어떤 채널의 생성 대기열에 들어갔는지 확인하세요."
				changed={`오늘 Content/SNS 기획 ${numberLabel(contentToday.length)}건 · 생성 완료 ${numberLabel(contentToday.filter((item) => item.artifact_id).length)}건`}
				reason="GFA Branch와 섞지 않고 Blog/Instagram/Shorts 생성 대상을 확인하는 단계입니다."
				decision="생성 대기 항목을 콘텐츠 생성 화면에서 처리할지 판단합니다."
				next="콘텐츠 생성 Queue로 이동해 초안을 만들거나 생성된 초안을 편집합니다."
				stats={[
					{ label: '생성 대기', value: contentToday.filter((item) => !item.artifact_id).length, tone: '#f59e0b' },
					{ label: '생성됨', value: contentToday.filter((item) => item.artifact_id).length, tone: '#2563eb' },
				]}
			/>
			<PlanningCompactSummary data={data} setView={setView} />
			<section style={{ ...css.card, ...css.cardPad }}>
				<div style={css.between}>
					<h2 style={{ margin: 0 }}>오늘의 콘텐츠 기획</h2>
					<Pill tone={data.dataReady?.ready ? '#10b981' : '#f59e0b'}>{data.dataReady?.ready ? 'Data Ready' : 'Data 확인 필요'}</Pill>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
					<ScopedMetric scope="현재" label="기획 대기" value={contentToday.filter((item) => !item.artifact_id).length} tone="#f59e0b" />
					<ScopedMetric scope="오늘" label="기획 확정" value={contentToday.length} tone="#2563eb" />
					<ScopedMetric scope="현재" label="생성 전달" value={contentToday.filter((item) => item.artifact_id).length} tone="#10b981" />
					<ScopedMetric scope="현재" label="보류" value={contentToday.filter((item) => item.status === 'hold').length} tone="#dc2626" />
				</div>
				<div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
					{contentToday.map((item) => (
						<div key={item.plan_id} style={{ ...css.between, border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
							<div>
								<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
									<Pill tone={item.artifact_id ? '#10b981' : '#f59e0b'}>{item.artifact_id ? '생성 전달 완료' : '기획 확정 대기'}</Pill>
									<strong>{normalizeChannel(item.channel)} · {item.appeal?.label || item.appeal_id}</strong>
								</div>
								<div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>WHAT: {item.sku?.title || item.sku_id}의 {normalizeChannel(item.channel)} 콘텐츠 방향</div>
								<div style={{ color: '#64748b', fontSize: 12 }}>WHY: {item.appeal ? appealWhyNow(item.appeal) : item.reason || 'AI 기획 큐에 포함된 항목입니다.'}</div>
								<div style={{ color: '#64748b', fontSize: 12 }}>CHANNEL: {normalizeChannel(item.channel)} · APPEAL: {item.appeal?.label || item.appeal_id}</div>
								<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>Plan {item.plan_id} · Next: {item.artifact_id ? '수정·편집' : '콘텐츠 생성'}</div>
							</div>
							<div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
								<Pill tone={item.artifact_id ? '#2563eb' : '#f59e0b'}>{item.artifact_id ? '콘텐츠 생성됨' : statusLabel(item.status)}</Pill>
								{item.artifact_id ? (
									<button type="button" style={css.button} onClick={() => { setSelectedId(item.artifact_id || ''); setView('editor'); }}>생성 결과 편집</button>
								) : (
									<button type="button" style={css.primaryButton} onClick={() => setView('generation')}>콘텐츠 생성하기</button>
								)}
							</div>
						</div>
					))}
					{!data.loading && contentToday.length === 0 ? <EmptyState message="오늘 생성 계획이 없습니다." /> : null}
				</div>
				<button type="button" style={{ ...css.primaryButton, marginTop: 14 }} onClick={() => setView('generation')}>콘텐츠 생성 Queue 보기</button>
			</section>
		</div>
	);
}

function GenerationSummary({ data }: { data: ContentData }): JSX.Element {
	const contentToday = data.today.filter((item) => isContentChannel(item.channel));
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
			<ScopedMetric scope="현재" label="제작 대상" value={contentToday.length} tone="#2563eb" />
			<ScopedMetric scope="현재" label="생성 대기 / 생성 중" value={`${contentToday.filter((item) => !item.artifact_id && item.status !== 'generation_failed').length} / 0`} tone="#f59e0b" />
			<ScopedMetric scope="오늘" label="생성 완료 / 실패" value={`${contentToday.filter((item) => item.artifact_id).length} / ${contentToday.filter((item) => item.status === 'generation_failed').length}`} tone="#10b981" />
			<ScopedMetric scope="현재" label="채널 믹스" value={channels.map((c) => `${c.label} ${contentToday.filter((item) => item.channel === c.key).length}`).join(' · ') || '-'} tone="#64748b" />
		</div>
	);
}

function GenerationFilters({ data }: { data: ContentData }): JSX.Element {
	const first = data.today[0];
	return (
		<section style={{ ...css.card, ...css.cardPad, ...css.between }}>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
				<Pill>SKU: {first?.sku?.title || first?.sku_id || '전체'}</Pill>
				<Pill tone="#059669">소구: {first?.appeal?.label || '전체'}</Pill>
				<Pill tone="#4f46e5">채널: 블로그 / 인스타그램 / 숏츠</Pill>
				<Pill tone="#64748b">기간: 오늘</Pill>
			</div>
			<button type="button" style={css.button}>필터 초기화</button>
		</section>
	);
}

function GenerationTargetCards({
	apiBaseUrl,
	data,
	setView,
	setSelectedId,
	generationContext,
}: {
	apiBaseUrl?: string;
	data: ContentData;
	setView: (v: ViewKey) => void;
	setSelectedId: (id: string) => void;
	generationContext: GenerationContext | null;
}): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const navigate = useNavigate();
	const contentToday = data.today.filter((item) => isContentChannel(item.channel));
	const [generatingPlanId, setGeneratingPlanId] = React.useState('');
	const [generatingDirectChannel, setGeneratingDirectChannel] = React.useState('');
	const [regeneratingArtifactId, setRegeneratingArtifactId] = React.useState('');
	const [preview, setPreview] = React.useState<{ artifact: Artifact; export: ExportPreview } | null>(null);
	const [generationError, setGenerationError] = React.useState('');
	const generationProgress = useGenerationProgress();
	const artifactById = new Map(data.artifacts.map((artifact) => [artifact.artifact_id, artifact]));
	const selectedAppeal = generationContext ? data.appeals.find((appeal) => appeal.appeal_id === generationContext.appealId) || null : null;
	const directChannels = generationContext?.channels.filter((channel) => isContentChannel(channel)) || [];
	const directArtifactsByChannel = new Map<string, Artifact>();
	if (generationContext) {
		[...data.artifacts]
			.filter((artifact) => artifact.appeal_id === generationContext.appealId && artifact.sku_id === generationContext.skuId && directChannels.includes(String(artifact.channel || '').toLowerCase()))
			.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
			.forEach((artifact) => {
				const channel = String(artifact.channel || '').toLowerCase();
				if (!directArtifactsByChannel.has(channel)) directArtifactsByChannel.set(channel, artifact);
			});
	}
	const loadPreview = async (artifact: Artifact) => {
		const response = await axios.get<ExportPreview>(`${baseUrl}/content/artifacts/${encodeURIComponent(artifact.artifact_id)}/export`);
		setPreview({ artifact, export: response.data });
	};
	const generateDirect = async (channel: string) => {
		if (!generationContext) return;
		if (channel === 'shorts') {
			navigate(shortsToolPath({ sourceType: 'APPEAL', skuId: generationContext.skuId, appealId: generationContext.appealId }));
			return;
		}
		const progressKey = `direct:${channel}`;
		generationProgress.start(progressKey);
		setGenerationError('');
		setGeneratingDirectChannel(channel);
		try {
			const response = await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/generate`, {
				sku_id: generationContext.skuId,
				appeal_id: generationContext.appealId,
				channel,
			});
			await data.reload();
			const artifact = response.data?.item;
			if (artifact?.artifact_id) {
				setSelectedId(artifact.artifact_id);
				await loadPreview(artifact);
			}
			generationProgress.finish(progressKey);
		} catch (error) {
			generationProgress.fail(progressKey);
			setGenerationError(productImageGenerationErrorMessage(error));
		} finally {
			setGeneratingDirectChannel('');
		}
	};
	const generate = async (item: TodayItem) => {
		if (!item.plan_id) return;
		if (item.channel === 'shorts') {
			navigate(shortsToolPath({ sourceType: 'APPEAL', skuId: item.sku_id, appealId: item.appeal_id }));
			return;
		}
		const progressKey = `plan:${item.plan_id}`;
		generationProgress.start(progressKey);
		setGenerationError('');
		setGeneratingPlanId(item.plan_id);
		try {
			const response = await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/generate`, { plan_id: item.plan_id });
			await data.reload();
			const artifact = response.data?.item;
			if (artifact?.artifact_id) {
				setSelectedId(artifact.artifact_id);
				await loadPreview(artifact);
			}
			generationProgress.finish(progressKey);
		} catch (error) {
			generationProgress.fail(progressKey);
			setGenerationError(productImageGenerationErrorMessage(error));
		} finally {
			setGeneratingPlanId('');
		}
	};
	const generateNewFromArtifact = async (artifact: Artifact) => {
		if (!artifact.sku_id || !artifact.appeal_id || !artifact.channel) return;
		if (artifact.channel === 'shorts') {
			navigate(shortsToolPath(shortsToolSourceForArtifact(artifact)));
			return;
		}
		const progressKey = `artifact:${artifact.artifact_id}`;
		generationProgress.start(progressKey);
		setGenerationError('');
		setRegeneratingArtifactId(artifact.artifact_id);
		try {
			const response = String(artifact.appeal_id || '').startsWith('manual:')
				? await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/${encodeURIComponent(artifact.artifact_id)}/regenerate`, {
					prompt_context: '수동 생성 입력을 기준으로 새 버전을 생성',
					actor: 'manual_content_generation',
				})
				: await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/generate`, {
					sku_id: artifact.sku_id,
					appeal_id: artifact.appeal_id,
					channel: artifact.channel,
				});
			await data.reload();
			const nextArtifact = response.data?.item;
			if (nextArtifact?.artifact_id) {
				setSelectedId(nextArtifact.artifact_id);
				await loadPreview(nextArtifact);
			}
			generationProgress.finish(progressKey);
		} catch (error) {
			generationProgress.fail(progressKey);
			setGenerationError(productImageGenerationErrorMessage(error));
		} finally {
			setRegeneratingArtifactId('');
		}
	};
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<h2 style={{ marginTop: 0 }}>오늘 생성 대상</h2>
			{generationError ? (
				<div style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, padding: 12, fontSize: 12, fontWeight: 800, marginBottom: 12 }}>
					{generationError}
				</div>
			) : null}
			{generationContext && selectedAppeal ? (
				<div style={{ border: '2px solid #2563eb', borderRadius: 16, padding: 14, background: '#eff6ff', marginBottom: 14 }}>
					<div style={css.between}>
						<div>
							<Pill tone="#2563eb">소구 선택에서 넘어온 생성 대상</Pill>
							<h3 style={{ margin: '8px 0 4px' }}>{selectedAppeal.label}</h3>
							<div style={{ color: '#475569', fontSize: 12 }}>{selectedAppeal.appeal_text || selectedAppeal.insight?.problem || selectedAppeal.appeal_id}</div>
						</div>
						<Pill tone="#0f766e">SKU {generationContext.skuId}</Pill>
					</div>
					<div style={{ display: 'grid', gap: 6, color: '#64748b', fontSize: 12, marginTop: 10 }}>
						<div><strong>왜 생성하나?</strong> {appealWhyNow(selectedAppeal)}</div>
						<div><strong>선택한 채널</strong> {directChannels.map((channel) => normalizeChannel(channel)).join(' · ') || 'Content/SNS'}</div>
						<div><strong>다음 단계</strong> 생성 후 미리보기를 확인하고 수정·편집으로 이동합니다.</div>
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 12 }}>
						{directChannels.map((channel) => {
							const directArtifact = directArtifactsByChannel.get(channel);
							const directProgress = generationProgress.progressByKey[`direct:${channel}`];
							const directNewProgress = directArtifact ? generationProgress.progressByKey[`artifact:${directArtifact.artifact_id}`] : undefined;
							return (
								<div key={channel} style={{ border: '1px solid #bfdbfe', borderRadius: 12, background: '#fff', padding: 10, display: 'grid', gap: 8 }}>
									<div style={css.between}>
										<strong style={{ color: '#1d4ed8' }}>{normalizeChannel(channel)}</strong>
										<Pill tone={directArtifact ? '#10b981' : '#f59e0b'}>{directArtifact ? '생성됨' : '생성 대기'}</Pill>
									</div>
									{directArtifact ? (
										<>
											<div style={{ color: '#64748b', fontSize: 11 }}>Artifact {directArtifact.artifact_id} · v{directArtifact.revision_no || 1}</div>
											<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
												<button type="button" style={css.button} onClick={() => void loadPreview(directArtifact)}>생성 결과 미리보기</button>
												<button type="button" style={regeneratingArtifactId === directArtifact.artifact_id ? css.disabledButton : css.primaryButton} disabled={regeneratingArtifactId === directArtifact.artifact_id} onClick={() => { setSelectedId(directArtifact.artifact_id); setView('editor'); }}>수정·편집으로 이동</button>
												<button type="button" style={css.button} disabled={regeneratingArtifactId === directArtifact.artifact_id} onClick={() => void generateNewFromArtifact(directArtifact)}>
													{generationProgressText(directNewProgress, channel === 'shorts' ? '숏츠 제작 툴에서 새로 만들기' : '새로 생성')}
												</button>
											</div>
										</>
									) : (
										<button type="button" style={css.primaryButton} disabled={generatingDirectChannel === channel} onClick={() => void generateDirect(channel)}>
											{generationProgressText(directProgress, channel === 'shorts' ? '숏츠 제작 툴에서 만들기' : `${normalizeChannel(channel)} 콘텐츠 생성`)}
										</button>
									)}
								</div>
							);
						})}
					</div>
				</div>
			) : generationContext ? (
				<div style={{ border: '1px solid #f59e0b', borderRadius: 12, padding: 12, background: '#fffbeb', marginBottom: 14, color: '#92400e', fontSize: 12 }}>
					선택한 소구 정보를 불러오지 못했습니다. 분석/소구 데이터 새로고침 후 다시 시도하세요.
				</div>
			) : null}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
				{contentToday.slice(0, 8).map((item) => {
					const channel = channels.find((c) => c.key === item.channel) || defaultChannel;
					const artifact = item.artifact_id ? artifactById.get(item.artifact_id) : null;
					const planProgress = generationProgress.progressByKey[`plan:${item.plan_id}`];
					const artifactProgress = artifact ? generationProgress.progressByKey[`artifact:${artifact.artifact_id}`] : undefined;
					return (
					<div key={item.plan_id} style={{ border: '1px solid #e2e8f0', borderRadius: 16, padding: 14, minWidth: 0 }}>
						<div style={css.between}>
							<strong style={{ color: channel.color }}>{normalizeChannel(item.channel)}</strong>
							<Pill tone={channel.color}>{item.artifact_id ? '콘텐츠 준비' : statusLabel(item.status)}</Pill>
						</div>
						<div style={{ minHeight: 96, background: '#f1f5f9', borderRadius: 14, marginTop: 12, display: 'grid', placeItems: 'center', color: '#334155', textAlign: 'center', padding: 12, fontWeight: 900, overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>{item.appeal?.label || item.sku?.title || item.sku_id}</div>
						<div style={{ display: 'grid', gap: 6, color: '#64748b', fontSize: 12, marginTop: 10, minWidth: 0, overflowWrap: 'anywhere' }}>
							<div><strong>무슨 내용인가?</strong> SKU {item.sku?.title || item.sku_id} · 소구 {item.appeal?.label || item.appeal_id}</div>
							<div><strong>왜 봐야 하나?</strong> {item.appeal ? appealWhyNow(item.appeal) : item.reason || '-'}</div>
							<div><strong>갱신 상태</strong> {item.artifact_id ? `생성됨 · Artifact ${item.artifact_id}` : '생성 대기'} · 근거 {item.appeal?.evidence_count || 0}</div>
							<div><strong>선택된 소구</strong> {item.appeal?.appeal_text || item.appeal?.label || item.appeal_id}</div>
						</div>
						{artifact ? (
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
								<button type="button" style={css.button} onClick={() => void loadPreview(artifact)}>생성 결과 미리보기</button>
								<button type="button" style={regeneratingArtifactId === artifact.artifact_id ? css.disabledButton : css.primaryButton} disabled={regeneratingArtifactId === artifact.artifact_id} onClick={() => { setSelectedId(artifact.artifact_id); setView('editor'); }}>수정·편집으로 이동</button>
								<button type="button" style={css.button} disabled={regeneratingArtifactId === artifact.artifact_id} onClick={() => void generateNewFromArtifact(artifact)}>
									{generationProgressText(artifactProgress, artifact.channel === 'shorts' ? '숏츠 제작 툴에서 새로 만들기' : '새로 생성')}
								</button>
							</div>
						) : (
							<button type="button" style={{ ...css.primaryButton, width: '100%', marginTop: 12 }} disabled={generatingPlanId === item.plan_id} onClick={() => void generate(item)}>
								{generationProgressText(planProgress, item.channel === 'shorts' ? '숏츠 제작 툴에서 만들기' : `${normalizeChannel(item.channel)} 콘텐츠 생성`)}
							</button>
						)}
					</div>
				);})}
			</div>
			{!data.loading && contentToday.length === 0 ? <EmptyState message="오늘 생성 대상이 없습니다." /> : null}
			{preview ? (
				<ExportPreviewModal artifact={preview.artifact} preview={preview.export} apiBaseUrl={apiBaseUrl} unsavedChanges={false} hasPublishedSibling={false} onClose={() => setPreview(null)} />
			) : null}
		</section>
	);
}

function ArtifactQueue({ apiBaseUrl, data, setView, setSelectedId }: { apiBaseUrl?: string; data: ContentData; setView: (v: ViewKey) => void; setSelectedId: (id: string) => void }): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const navigate = useNavigate();
	const contentArtifacts = data.artifacts.filter((item) => isContentChannel(item.channel));
	const [regeneratingArtifactId, setRegeneratingArtifactId] = React.useState('');
	const generationProgress = useGenerationProgress();
	const generateNewFromArtifact = async (artifact: Artifact) => {
		if (!artifact.sku_id || !artifact.appeal_id || !artifact.channel) return;
		if (artifact.channel === 'shorts') {
			navigate(shortsToolPath(shortsToolSourceForArtifact(artifact)));
			return;
		}
		const progressKey = `queue-artifact:${artifact.artifact_id}`;
		generationProgress.start(progressKey);
		setRegeneratingArtifactId(artifact.artifact_id);
		try {
			const response = String(artifact.appeal_id || '').startsWith('manual:')
				? await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/${encodeURIComponent(artifact.artifact_id)}/regenerate`, {
					prompt_context: '수동 생성 입력을 기준으로 새 버전을 생성',
					actor: 'manual_content_generation',
				})
				: await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/generate`, {
					sku_id: artifact.sku_id,
					appeal_id: artifact.appeal_id,
					channel: artifact.channel,
				});
			await data.reload();
			const nextArtifact = response.data?.item;
			if (nextArtifact?.artifact_id) {
				setSelectedId(nextArtifact.artifact_id);
				setView('editor');
			}
			generationProgress.finish(progressKey);
		} catch (error) {
			generationProgress.fail(progressKey);
			throw error;
		} finally {
			setRegeneratingArtifactId('');
		}
	};
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<h2 style={{ marginTop: 0 }}>생성 결과 Queue</h2>
			<div style={{ display: 'grid', gap: 10 }}>
				{contentArtifacts.slice(0, 8).map((item) => (
					<div key={item.artifact_id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#f8fafc' }}>
						<div>
							<strong>{item.title}</strong>
							<div style={{ color: '#64748b', fontSize: 12 }}>{normalizeChannel(item.channel)} · v{item.revision_no || 1} · {statusLabel(item.reviewer_status)}</div>
							<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>생성/갱신 {item.created_at ? toKstLabel(item.created_at) : '-'} · Artifact {item.artifact_id}</div>
						</div>
						<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
							<button type="button" style={css.button} disabled={regeneratingArtifactId === item.artifact_id || !item.sku_id || !item.appeal_id} onClick={() => void generateNewFromArtifact(item)}>
								{generationProgressText(generationProgress.progressByKey[`queue-artifact:${item.artifact_id}`], item.channel === 'shorts' ? '숏츠 제작 툴에서 새로 만들기' : '새로 생성')}
							</button>
							<button type="button" style={regeneratingArtifactId === item.artifact_id ? css.disabledButton : css.button} disabled={regeneratingArtifactId === item.artifact_id} onClick={() => { setSelectedId(item.artifact_id); setView('editor'); }}>수정·검수하기</button>
						</div>
					</div>
				))}
				{!data.loading && contentArtifacts.length === 0 ? <EmptyState message="생성된 콘텐츠가 없습니다." /> : null}
			</div>
		</section>
	);
}

function ManualContentGenerationPanel({ apiBaseUrl, data, setView, setSelectedId }: { apiBaseUrl?: string; data: ContentData; setView: (v: ViewKey) => void; setSelectedId: (id: string) => void }): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const activeSkus = data.skuScopes.filter((item) => item.is_active !== false);
	const [channel, setChannel] = React.useState<string>('blog');
	const [skuId, setSkuId] = React.useState<string>('');
	const [appealTitle, setAppealTitle] = React.useState<string>('');
	const [additionalContext, setAdditionalContext] = React.useState<string>('');
	const [files, setFiles] = React.useState<FileList | null>(null);
	const [uploadedAssets, setUploadedAssets] = React.useState<ContentAsset[]>([]);
	const [uploading, setUploading] = React.useState(false);
	const [generating, setGenerating] = React.useState(false);
	const [message, setMessage] = React.useState('');
	const generationProgress = useGenerationProgress();
	const progressKey = 'manual-content-generation';
	React.useEffect(() => {
		if (!skuId && activeSkus[0]?.sku_id) setSkuId(activeSkus[0].sku_id);
	}, [activeSkus, skuId]);
	const navigate = useNavigate();
	const manualChannels = channels.filter((item) => item.key !== 'shorts');
	const channelHint =
		channel === 'blog'
			? '블로그는 본문 흐름, 제품정보, 전성분, 효능효과, 결론/CTA까지 반영합니다.'
			: '인스타그램은 슬라이드/캡션/해시태그에 맞게 핵심 메시지를 압축합니다.';
	const selectedSku = activeSkus.find((item) => item.sku_id === skuId) || null;
	const changeSku = (nextSkuId: string) => {
		setSkuId(nextSkuId);
		setUploadedAssets([]);
		setFiles(null);
	};
	const uploadFiles = async () => {
		if (!skuId) {
			setMessage('파일 업로드 전에 연관 SKU 제품을 선택하세요.');
			return;
		}
		const selectedFiles = Array.from(files || []);
		if (!selectedFiles.length) {
			setMessage('업로드할 첨부 파일을 선택하세요.');
			return;
		}
		setUploading(true);
		setMessage('');
		try {
			const uploaded: ContentAsset[] = [];
			for (const file of selectedFiles) {
				const form = new FormData();
				form.append('sku_id', skuId);
				form.append('asset_type', 'ingredient_document');
				form.append('product_url', selectedSku?.product_url || '');
				form.append('category', 'manual_content_reference');
				form.append('keywords', appealTitle || 'manual content generation');
				form.append('file', file);
				const response = await axios.post<{ item?: ContentAsset }>(`${baseUrl}/content/assets/upload`, form);
				if (response.data?.item) uploaded.push(response.data.item);
			}
			setUploadedAssets((prev) => [...prev, ...uploaded]);
			setFiles(null);
			await data.reload();
			setMessage(`첨부 파일 ${uploaded.length}개를 업로드했습니다.`);
		} catch (error) {
			setMessage(productImageGenerationErrorMessage(error));
		} finally {
			setUploading(false);
		}
	};
	const submit = async () => {
		const title = appealTitle.trim();
		if (!skuId) {
			setMessage('연관 SKU 제품을 선택하세요.');
			return;
		}
		if (!title) {
			setMessage('소구포인트(제목)를 입력하세요.');
			return;
		}
		setGenerating(true);
		setMessage('');
		generationProgress.start(progressKey);
		try {
			const response = await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/generate-manual`, {
				sku_id: skuId,
				channel,
				appeal_title: title,
				additional_context: additionalContext,
				attachment_asset_ids: uploadedAssets.map((asset) => asset.asset_id),
				actor: 'manual_content_generation',
			});
			await data.reload();
			const artifact = response.data?.item;
			if (artifact?.artifact_id) {
				setSelectedId(artifact.artifact_id);
				setView('editor');
			}
			generationProgress.finish(progressKey);
			setMessage('수동 입력 기준으로 콘텐츠를 생성했습니다.');
		} catch (error) {
			generationProgress.fail(progressKey);
			setMessage(productImageGenerationErrorMessage(error));
		} finally {
			setGenerating(false);
		}
	};
	return (
		<section style={{ ...css.card, ...css.cardPad, display: 'grid', gap: 14 }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0 }}>수동 콘텐츠 생성</h2>
					<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>오늘 생성 대상에 없더라도 매체와 SKU, 소구포인트를 직접 입력해 기존 AI 생성 흐름으로 제작합니다.</div>
				</div>
				<Pill tone="#2563eb">Manual AI Generate</Pill>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
				<label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 900, color: '#475569' }}>
					생성 매체
					<select value={channel} onChange={(event) => setChannel(event.target.value)} disabled={generating} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontWeight: 800 }}>
						{manualChannels.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
					</select>
					<button type="button" style={{ ...css.button, justifySelf: 'start' }} onClick={() => navigate(shortsToolPath(skuId ? { sourceType: 'TOPIC', skuId } : undefined))}>유튜브 숏츠는 숏츠 제작 툴에서 만들기 →</button>
				</label>
				<label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 900, color: '#475569' }}>
					연관 SKU 제품
					<select value={skuId} onChange={(event) => changeSku(event.target.value)} disabled={generating || uploading} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontWeight: 800 }}>
						<option value="">SKU 선택</option>
						{activeSkus.map((item) => <option key={item.sku_id} value={item.sku_id}>{item.title || item.sku_id}</option>)}
					</select>
				</label>
				<label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 900, color: '#475569' }}>
					소구포인트(제목)
					<input value={appealTitle} onChange={(event) => setAppealTitle(event.target.value)} disabled={generating} placeholder="예: 염색 후 푸석함을 줄이는 홈케어 루틴" style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontWeight: 800 }} />
				</label>
			</div>
			<label style={{ display: 'grid', gap: 6, fontSize: 12, fontWeight: 900, color: '#475569' }}>
				추가 정보 / 참고 자료
				<textarea value={additionalContext} onChange={(event) => setAdditionalContext(event.target.value)} disabled={generating} rows={4} placeholder={`${channelHint}\n제품 특징, 전성분 참고 포인트, 반드시 포함할 문구, 제외할 표현 등을 입력하세요.`} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, lineHeight: 1.55, resize: 'vertical' }} />
			</label>
			<div style={{ border: '1px dashed #cbd5e1', borderRadius: 14, padding: 12, display: 'grid', gap: 10, background: '#f8fafc' }}>
				<div style={css.between}>
					<div>
						<strong>첨부 파일 업로드</strong>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>모든 파일 형식을 업로드할 수 있습니다. 텍스트/HTML/CSV/JSON/MD 파일은 일부 내용을 생성 문맥에 반영합니다.</div>
					</div>
					<Pill tone={uploadedAssets.length ? '#10b981' : '#64748b'}>첨부 {uploadedAssets.length}개</Pill>
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
					<input key={`${skuId}-${uploadedAssets.length}`} type="file" multiple onChange={(event) => setFiles(event.target.files)} disabled={generating || uploading || !skuId} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '7px 10px', background: '#fff', fontSize: 12 }} />
					<button type="button" style={uploading ? css.disabledButton : css.button} disabled={uploading || generating || !skuId} onClick={() => void uploadFiles()}>
						{uploading ? '업로드 중...' : '첨부 업로드'}
					</button>
				</div>
				{uploadedAssets.length ? (
					<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
						{uploadedAssets.map((asset) => (
							<Pill key={asset.asset_id} tone="#2563eb">{asset.original_filename || asset.filename}</Pill>
						))}
					</div>
				) : null}
			</div>
			<div style={{ ...css.between, alignItems: 'center' }}>
				<div style={{ color: message.includes('생성했습니다') ? '#047857' : '#b45309', fontSize: 12, fontWeight: 800 }}>{message || channelHint}</div>
				<button type="button" style={generating || uploading ? css.disabledButton : css.primaryButton} disabled={generating || uploading} onClick={() => void submit()}>
					{generationProgressText(generationProgress.progressByKey[progressKey], 'AI 콘텐츠 생성')}
				</button>
			</div>
		</section>
	);
}

function ContentGenerationView({ apiBaseUrl, data, setView, setSelectedId }: { apiBaseUrl?: string; data: ContentData; setView: (v: ViewKey) => void; setSelectedId: (id: string) => void }): JSX.Element {
	const location = useLocation();
	const generationContext = React.useMemo(() => generationContextFromSearch(location.search), [location.search]);
	const contentToday = data.today.filter((item) => isContentChannel(item.channel));
	const [tool, setTool] = React.useState<'content' | 'shorts'>(() => (new URLSearchParams(location.search).get('tool') === 'shorts' ? 'shorts' : 'content'));
	React.useEffect(() => {
		if (new URLSearchParams(location.search).get('tool') === 'shorts') setTool('shorts');
	}, [location.search]);
	const shortsInitialSource = React.useMemo(() => shortsToolSourceFromSearch(location.search), [location.search]);
	const toolTabs = (
		<div style={{ display: 'flex', gap: 6, background: '#f1f5f9', padding: 4, borderRadius: 12, width: 'fit-content' }}>
			<button type="button" style={tool === 'content' ? css.primaryButton : css.button} onClick={() => setTool('content')}>콘텐츠 생성</button>
			<button type="button" style={tool === 'shorts' ? css.primaryButton : css.button} onClick={() => setTool('shorts')}>숏츠 제작</button>
		</div>
	);
	if (tool === 'shorts') {
		return (
			<div style={{ display: 'grid', gap: 16 }} data-testid="content-generation-view">
				{toolTabs}
				<ShortsGeneratorView
					key={location.search}
					initialSource={shortsInitialSource}
					apiBaseUrl={apiBaseUrl}
					skus={data.skuScopes}
					appeals={data.appeals}
					artifacts={data.artifacts}
					reload={data.reload}
					onCreated={(artifactId) => {
						setSelectedId(artifactId);
						setView('editor');
					}}
				/>
			</div>
		);
	}
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-generation-view">
			{toolTabs}
			<StageHeader
				title="4. 콘텐츠 생성"
				task="선택된 소구 중 아직 콘텐츠로 만들지 않은 Content/SNS 항목을 처리하세요."
				changed={`생성 대기 ${numberLabel(contentToday.filter((item) => !item.artifact_id).length)}건 · 생성 결과 ${numberLabel(todayPlanLinkedArtifacts(data))}건`}
				reason="이 단계는 Content/SNS 전용입니다. GFA 추천은 기존 GFA Generator 흐름으로 분리합니다."
				decision="어떤 채널 초안을 생성하거나, 이미 생성된 초안을 편집할지 결정합니다."
				next="초안이 생성되면 수정·편집 단계로 이동합니다."
				stats={[
					{ label: 'Blog', value: contentToday.filter((item) => item.channel === 'blog').length, tone: '#059669' },
					{ label: 'Instagram', value: contentToday.filter((item) => item.channel === 'instagram').length, tone: '#db2777' },
					{ label: 'Shorts', value: contentToday.filter((item) => item.channel === 'shorts').length, tone: '#dc2626' },
				]}
			/>
			<GenerationSummary data={data} />
			<GenerationFilters data={data} />
			<ManualContentGenerationPanel apiBaseUrl={apiBaseUrl} data={data} setView={setView} setSelectedId={setSelectedId} />
			<div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: 14 }}>
				<GenerationTargetCards apiBaseUrl={apiBaseUrl} data={data} setView={setView} setSelectedId={setSelectedId} generationContext={generationContext} />
				<ArtifactQueue apiBaseUrl={apiBaseUrl} data={data} setView={setView} setSelectedId={setSelectedId} />
			</div>
		</div>
	);
}

function ArtifactList({ data, selectedId, setSelectedId }: { data: ContentData; selectedId: string; setSelectedId: (id: string) => void }): JSX.Element {
	const contentArtifacts = data.artifacts.filter((item) => isContentChannel(item.channel));
	return (
		<aside style={{ ...css.card, padding: 10, display: 'grid', gap: 8, alignContent: 'start' }}>
			<div style={{ fontSize: 13, fontWeight: 950, padding: 8 }}>생성된 콘텐츠 ({contentArtifacts.length})</div>
			{contentArtifacts.map((item) => (
				<div
					key={item.artifact_id}
					role="button"
					tabIndex={0}
					onClick={() => setSelectedId(item.artifact_id)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') setSelectedId(item.artifact_id);
					}}
					style={{ border: item.artifact_id === selectedId ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: 14, padding: 10, background: item.artifact_id === selectedId ? '#eff6ff' : '#fff', cursor: 'pointer' }}
				>
					<div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>{normalizeChannel(item.channel)} · v{item.revision_no || 1} · {statusLabel(item.reviewer_status)}</div>
					<div style={{ fontWeight: 950, marginTop: 4 }}>{item.title || item.artifact_id}</div>
					<div style={{ color: '#94a3b8', fontSize: 11 }}>갱신 {item.created_at ? toKstLabel(item.created_at) : '-'}</div>
					<div style={{ color: '#94a3b8', fontSize: 11 }}>다음 액션: {item.reviewer_status === 'accepted' ? '게시 관리' : '편집/검수'}</div>
				</div>
			))}
			{!data.loading && contentArtifacts.length === 0 ? <EmptyState message="생성된 콘텐츠가 없습니다." /> : null}
		</aside>
	);
}

function EditorActionBar({
	apiBaseUrl,
	data,
	selected,
	title,
	bodyJson,
	exportText,
	unsavedChanges,
	hasPublishedSibling,
	setSelectedId,
	setView,
	approveBlocked = false,
	approveBlockedReason = '',
}: {
	apiBaseUrl?: string;
	data: ContentData;
	selected: Artifact | null;
	title: string;
	bodyJson: Record<string, any>;
	exportText: string;
	unsavedChanges: boolean;
	hasPublishedSibling: boolean;
	setSelectedId: (id: string) => void;
	setView: (v: ViewKey) => void;
	approveBlocked?: boolean;
	approveBlockedReason?: string;
}): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [preview, setPreview] = React.useState<ExportPreview | null>(null);
	const [message, setMessage] = React.useState('');
	const [approvedId, setApprovedId] = React.useState('');
	const [regenerating, setRegenerating] = React.useState(false);
	const generationProgress = useGenerationProgress();
	const regenerateProgressKey = selected ? `editor-regenerate:${selected.artifact_id}` : '';
	const regenerateProgress = regenerateProgressKey ? generationProgress.progressByKey[regenerateProgressKey] : undefined;
	const loadStoredExport = async (): Promise<ExportPreview | null> => {
		if (!selected) return null;
		const response = await axios.get<ExportPreview>(`${baseUrl}/content/artifacts/${encodeURIComponent(selected.artifact_id)}/export`);
		return response.data;
	};
	const openPreview = async () => {
		const stored = await loadStoredExport();
		if (stored) {
			setPreview(stored);
			setMessage(unsavedChanges ? '미저장 변경은 Preview에 포함하지 않고 저장된 Revision 출력물을 표시합니다.' : '');
		}
	};
	const copyStoredExport = async () => {
		if (!selected) return;
		if (unsavedChanges && !window.confirm(`현재 편집 내용은 저장되지 않았습니다. 저장된 v${selected.revision_no || 1} 출력물을 복사합니다.`)) return;
		const stored = await loadStoredExport();
		if (!stored) return;
		try {
			await navigator.clipboard.writeText(stored.export_text || '');
			setMessage('저장된 Revision 출력물을 클립보드에 복사했습니다.');
		} catch {
			window.prompt('복사할 저장본 출력물', stored.export_text || '');
			setMessage('브라우저 권한 때문에 직접 복사 창을 열었습니다.');
		}
	};
	const downloadStoredExport = async () => {
		if (!selected) return;
		const stored = await loadStoredExport();
		if (!stored) return;
		const blob = new Blob([`\ufeff${stored.export_text || ''}`], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = exportFileName(selected);
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
		setMessage(`${exportFileName(selected)} 다운로드를 시작했습니다.`);
	};
	const approve = async () => {
		if (!selected) return;
		if (unsavedChanges && !window.confirm('저장되지 않은 변경사항이 있습니다. 현재 저장된 Revision을 승인하시겠습니까?')) return;
		await axios.patch(`${baseUrl}/content/artifacts/${encodeURIComponent(selected.artifact_id)}/review`, { status: 'accepted', actor: 'marketing' });
		await data.reload();
		setApprovedId(selected.artifact_id);
		setMessage('검수 승인 완료. 다음 단계는 게시 화면에서 게시 URL을 연결하는 것입니다.');
	};
	const saveDraft = async () => {
		if (!selected) return;
		const response = await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/${encodeURIComponent(selected.artifact_id)}/drafts`, {
			title,
			body_json: bodyJson,
			export_text: exportText,
			actor: 'marketing',
		});
		await data.reload();
		const newId = response.data?.item?.artifact_id;
		if (newId) setSelectedId(newId);
	};
	const regenerate = async () => {
		if (!selected || regenerating) return;
		const promptContext = window.prompt('다시 생성에 반영할 요청을 입력하세요.', exportText || selected.export_text || '');
		if (promptContext === null) return;
		const progressKey = `editor-regenerate:${selected.artifact_id}`;
		const baseOriginalId = selected.original_artifact_id || selected.artifact_id;
		const baseRevisionNo = selected.revision_no || 1;
		const findRecoveredRevision = async (): Promise<Artifact | null> => {
			const response = await axios.get<{ items?: Artifact[] }>(`${baseUrl}/content/artifacts`, { params: { channel: selected.channel || undefined } });
			const items = response.data?.items || [];
			return items
				.filter((item) => (item.original_artifact_id || item.artifact_id) === baseOriginalId && (item.revision_no || 1) > baseRevisionNo)
				.sort((a, b) => (b.revision_no || 1) - (a.revision_no || 1))[0] || null;
		};
		setRegenerating(true);
		generationProgress.start(progressKey);
		setMessage('AI 다시 생성 중입니다. 본문과 섹션 이미지를 함께 생성하고 있습니다.');
		let recoveryTimer = 0;
		try {
			const request = axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/${encodeURIComponent(selected.artifact_id)}/regenerate`, {
					prompt_context: promptContext,
					actor: 'marketing',
				})
				.then((response) => response.data?.item || null);
			const recovery = new Promise<Artifact | null>((resolve) => {
				const startedAt = Date.now();
				recoveryTimer = window.setInterval(() => {
					if (Date.now() - startedAt < 25000) return;
					void findRecoveredRevision().then((artifact) => {
						if (!artifact) return;
						window.clearInterval(recoveryTimer);
						resolve(artifact);
					}).catch(() => undefined);
				}, 8000);
			});
			const nextArtifact = await Promise.race([request, recovery]);
			if (recoveryTimer) window.clearInterval(recoveryTimer);
			await data.reload();
			if (nextArtifact?.artifact_id) setSelectedId(nextArtifact.artifact_id);
			generationProgress.finish(progressKey);
			setMessage(nextArtifact?.artifact_id ? 'AI 다시 생성이 완료되어 최신 Revision을 반영했습니다.' : 'AI 다시 생성 요청이 완료되었습니다.');
		} catch (error) {
			const recovered = await findRecoveredRevision().catch(() => null);
			if (recovered?.artifact_id) {
				await data.reload();
				setSelectedId(recovered.artifact_id);
				generationProgress.finish(progressKey);
				setMessage('요청 연결은 끊겼지만 생성된 최신 Revision을 찾아 반영했습니다.');
			} else {
				generationProgress.fail(progressKey);
				setMessage(productImageGenerationErrorMessage(error));
			}
		} finally {
			if (recoveryTimer) window.clearInterval(recoveryTimer);
			setRegenerating(false);
		}
	};
	return (
		<>
			<div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
				<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
					<button type="button" style={css.button} onClick={saveDraft} disabled={!selected}>임시 저장</button>
					<button type="button" style={regenerating ? css.disabledButton : css.button} onClick={regenerate} disabled={!selected || regenerating}>
						{generationProgressText(regenerateProgress, '다시 생성')}
					</button>
					<button type="button" style={css.button} onClick={openPreview} disabled={!selected}>미리보기</button>
					<button type="button" style={css.button} onClick={copyStoredExport} disabled={!selected}>복사</button>
					<button type="button" style={css.button} onClick={downloadStoredExport} disabled={!selected}>다운로드</button>
					<button type="button" style={approveBlocked ? css.disabledButton : css.primaryButton} onClick={approve} disabled={!selected || approveBlocked}>검수 승인</button>
					{selected?.reviewer_status === 'accepted' || selected?.reviewer_status === 'published' || approvedId ? (
						<button type="button" style={css.button} onClick={() => setView('publish')} disabled={!selected}>게시 관리로 이동</button>
					) : null}
				</div>
				{unsavedChanges ? <Pill tone="#f59e0b">미저장 변경 있음</Pill> : null}
				{approveBlocked && approveBlockedReason ? <div style={{ color: '#d97706', fontSize: 12, fontWeight: 800 }}>{approveBlockedReason}</div> : null}
				{regenerateProgress ? <div style={{ color: '#2563eb', fontSize: 12, fontWeight: 900 }}>{generationProgressText(regenerateProgress, '다시 생성 진행 중')}</div> : null}
				{message ? <div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>{message}</div> : null}
			</div>
			{preview && selected ? (
				<ExportPreviewModal
					artifact={selected}
					preview={preview}
					apiBaseUrl={apiBaseUrl}
					unsavedChanges={unsavedChanges}
					hasPublishedSibling={hasPublishedSibling}
					onClose={() => setPreview(null)}
				/>
			) : null}
		</>
	);
}

function ExportPreviewModal({
	artifact,
	preview,
	apiBaseUrl,
	unsavedChanges,
	hasPublishedSibling,
	onClose,
}: {
	artifact: Artifact;
	preview: ExportPreview;
	apiBaseUrl?: string;
	unsavedChanges: boolean;
	hasPublishedSibling: boolean;
	onClose: () => void;
}): JSX.Element {
	const body = preview.body && typeof preview.body === 'object' ? preview.body : artifact.body || {};
	return (
		<div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 24 }}>
			<div style={{ ...css.card, width: 'min(1040px, 96vw)', maxHeight: '90vh', overflow: 'auto', padding: 22 }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0 }}>최종 포스팅 미리보기</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>저장된 Revision 기준으로 글자 크기, 강조, 이미지 위치를 포함해 렌더링합니다.</div>
					</div>
					<button type="button" style={css.button} onClick={onClose}>닫기</button>
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
					<Pill tone="#2563eb">{normalizeChannel(artifact.channel)}</Pill>
					<Pill tone="#64748b">{artifact.artifact_id}</Pill>
					<Pill tone="#4f46e5">v{artifact.revision_no || 1}</Pill>
					<Pill tone="#64748b">{sourceLabel(artifact.source)}</Pill>
					<Pill tone="#0f766e">{statusLabel(artifact.reviewer_status)}</Pill>
					<Pill tone={artifact.is_published_version ? '#10b981' : '#f59e0b'}>{artifact.is_published_version ? '게시본' : '게시본 아님'}</Pill>
					{hasPublishedSibling && !artifact.is_published_version ? <Pill tone="#ef4444">과거 Revision 미리보기</Pill> : null}
					{unsavedChanges ? <Pill tone="#f59e0b">미저장 변경은 제외됨</Pill> : null}
				</div>
				<RichPostPreview artifact={artifact} body={body} exportText={preview.export_text} apiBaseUrl={apiBaseUrl} />
			</div>
		</div>
	);
}

function RichPostPreview({ artifact, body, exportText, apiBaseUrl }: { artifact: Artifact; body: Record<string, any>; exportText: string; apiBaseUrl?: string }): JSX.Element {
	const channel = String(artifact.channel || '').toLowerCase();
	if (channel === 'instagram') return <InstagramPostPreview body={body} artifact={artifact} apiBaseUrl={apiBaseUrl} />;
	if (channel === 'shorts') return <ShortsPostPreview body={body} artifact={artifact} apiBaseUrl={apiBaseUrl} />;
	return <BlogPostPreview body={body} artifact={artifact} exportText={exportText} apiBaseUrl={apiBaseUrl} />;
}

function BlogPostPreview({ body, artifact, exportText, apiBaseUrl }: { body: Record<string, any>; artifact: Artifact; exportText: string; apiBaseUrl?: string }): JSX.Element {
	const blog = body.blog && typeof body.blog === 'object' ? body.blog as Record<string, any> : body;
	const sections = Array.isArray(blog.sections) ? blog.sections : Array.isArray(body.sections) ? body.sections : [];
	const title = String(blog.title || body.title || artifact.title || '').trim();
	const intro = String(blog.intro || blog.lead || body.intro || '').trim();
	const conclusion = String(blog.conclusion || body.conclusion || '').trim();
	return (
		<article style={{ marginTop: 18, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: '28px min(5vw, 44px)', color: '#111827', lineHeight: 1.78 }}>
			<h1 style={{ fontSize: 30, lineHeight: 1.25, margin: '0 0 18px', fontWeight: 950, letterSpacing: '-0.03em' }}>{title || artifact.title}</h1>
			{intro ? <p style={{ fontSize: 17, lineHeight: 1.8, color: '#334155', fontWeight: 600, margin: '0 0 28px' }}>{intro}</p> : null}
			{sections.length ? sections.map((section: any, index: number) => {
				const image = resolveContentImage(String(section?.image || section?.image_url || ''), apiBaseUrl);
				return (
					<section key={`${index}-${section?.heading || ''}`} style={{ marginTop: index === 0 ? 18 : 34 }}>
						<h2 style={{ fontSize: 23, lineHeight: 1.35, margin: '0 0 12px', fontWeight: 950, color: '#0f172a', letterSpacing: '-0.02em' }}>{String(section?.heading || `섹션 ${index + 1}`)}</h2>
						{image ? <img src={image} alt={String(section?.heading || 'blog image')} style={{ width: '100%', aspectRatio: '3 / 2', objectFit: 'cover', borderRadius: 16, border: '1px solid #e2e8f0', margin: '10px 0 16px', background: '#f8fafc' }} /> : null}
						{String(section?.body || '').split(/\n+/).filter(Boolean).map((paragraph, pIndex) => (
							<p key={pIndex} style={{ fontSize: 16, lineHeight: 1.86, margin: '0 0 14px', color: '#1f2937' }}>{paragraph}</p>
						))}
					</section>
				);
			}) : <pre style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>{exportText || '저장된 export_text가 없습니다.'}</pre>}
			{Array.isArray(blog.faq) && blog.faq.length ? (
				<section style={{ marginTop: 34, padding: 18, borderRadius: 16, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
					<h2 style={{ fontSize: 22, margin: '0 0 14px', fontWeight: 950 }}>FAQ</h2>
					{blog.faq.map((item: any, index: number) => (
						<div key={index} style={{ marginTop: index ? 14 : 0 }}>
							<div style={{ fontWeight: 900, color: '#0f172a' }}>Q. {String(item?.question || '')}</div>
							<div style={{ marginTop: 4, color: '#334155' }}>A. {String(item?.answer || '')}</div>
						</div>
					))}
				</section>
			) : null}
			{conclusion ? (
				<section style={{ marginTop: 34 }}>
					<h2 style={{ fontSize: 22, lineHeight: 1.35, margin: '0 0 12px', fontWeight: 950, color: '#0f172a' }}>마무리</h2>
					<p style={{ fontSize: 16, lineHeight: 1.86, margin: 0, color: '#1f2937' }}>{conclusion}</p>
				</section>
			) : null}
			{String(blog.cta || body.cta || '').trim() ? <div style={{ marginTop: 28, padding: 16, borderRadius: 14, background: '#eff6ff', color: '#1d4ed8', fontWeight: 900 }}>{String(blog.cta || body.cta)}</div> : null}
		</article>
	);
}

function InstagramPostPreview({ body, artifact, apiBaseUrl }: { body: Record<string, any>; artifact: Artifact; apiBaseUrl?: string }): JSX.Element {
	const normalized = normalizeInstagramBody({ ...artifact, body });
	return (
		<div style={{ marginTop: 18, display: 'grid', gap: 16 }}>
			<h1 style={{ margin: 0, fontSize: 26, fontWeight: 950 }}>{normalized.caption.split('\n')[0] || artifact.title}</h1>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
				{normalized.slides.map((slide, index) => {
					const image = resolveInstagramImage(slide.image, apiBaseUrl);
					const texts = instagramSlideTexts(slide);
					return (
						<div key={index} style={{ border: '1px solid #e2e8f0', borderRadius: 18, overflow: 'hidden', background: '#fff' }}>
							<div style={{ aspectRatio: '4 / 5', background: image ? '#fff' : 'linear-gradient(135deg,#fff7ed,#fce7f3 50%,#e0f2fe)', position: 'relative', display: 'grid', alignItems: 'end', padding: 18 }}>
								{image ? <img src={image} alt={`slide ${index + 1}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
								<div style={{ position: 'relative', background: 'rgba(255,255,255,0.86)', borderRadius: 14, padding: 12 }}>
									<div style={{ fontSize: 20, fontWeight: 950, lineHeight: 1.25 }}>{texts.headline}</div>
									<div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.45, color: '#334155', fontWeight: 700 }}>{texts.subcopy}</div>
								</div>
							</div>
							<div style={{ padding: 12, color: '#475569', fontSize: 13, lineHeight: 1.55 }}>{texts.proof}</div>
						</div>
					);
				})}
			</div>
			<div style={{ whiteSpace: 'pre-wrap', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, background: '#f8fafc', lineHeight: 1.65 }}>{normalized.caption}</div>
		</div>
	);
}

function ShortsPostPreview({ body, artifact, apiBaseUrl }: { body: Record<string, any>; artifact: Artifact; apiBaseUrl?: string }): JSX.Element {
	const normalized = normalizeShortsBody({ ...artifact, body });
	return (
		<div style={{ marginTop: 18 }}>
			<h1 style={{ margin: '0 0 14px', fontSize: 26, fontWeight: 950 }}>{normalized.title || artifact.title}</h1>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
				{normalized.scenes.map((scene, index) => {
					const image = resolveContentImage(shortsSceneImageUrl(scene), apiBaseUrl);
					return (
						<div key={index} style={{ border: '1px solid #e2e8f0', borderRadius: 18, overflow: 'hidden', background: '#fff' }}>
							<div style={{ aspectRatio: '9 / 16', background: image ? '#111827' : 'linear-gradient(180deg,#111827,#334155)', position: 'relative', display: 'grid', alignItems: 'end', padding: 14 }}>
								{image ? <img src={image} alt={`scene ${index + 1}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
								<div style={{ position: 'relative', color: '#fff', fontSize: 19, fontWeight: 950, lineHeight: 1.3, textShadow: '0 2px 8px rgba(0,0,0,0.55)' }}>{scene.caption}</div>
							</div>
							<div style={{ padding: 12, fontSize: 13, color: '#334155', lineHeight: 1.55 }}>
								<strong>Voice-over</strong>
								<div>{scene.voice_over}</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

type InstagramLayer = Partial<OverlayItem> & {
	type?: OverlayKey | string;
	key?: OverlayKey | string;
	text?: string;
};

type InstagramSlide = {
	order: number;
	image?: string | { url?: string; path?: string; asset_id?: string } | null;
	image_prompt?: string;
	visual_brief?: string;
	product_image_reference_url?: string;
	layers: InstagramLayer[];
};

type InstagramBody = Record<string, any> & {
	channel?: string;
	format: string;
	aspect_ratio: string;
	slides: InstagramSlide[];
	caption: string;
	hashtags: string[];
	cta: string;
};

const instagramLayerLabels: Record<OverlayKey, string> = {
	headline: '메인 문구',
	subcopy: '보조 문구',
	proof: '근거/혜택',
	cta: 'CTA',
};

function stableJson(value: unknown): string {
	try {
		return JSON.stringify(value ?? {});
	} catch {
		return '';
	}
}

function normalizeInstagramHashtags(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
	return String(value || '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeInstagramLayer(layer: InstagramLayer | undefined, key: OverlayKey, text = ''): InstagramLayer {
	const normalizedLayer = { ...(layer || {}) } as Record<string, any>;
	(['x', 'y', 'w'] as const).forEach((coord) => {
		const value = Number(normalizedLayer[coord]);
		if (Number.isFinite(value) && value > 1) normalizedLayer[coord] = value / 100;
	});
	const overlay = overlayFromValue({ [key]: normalizedLayer })[key];
	return {
		type: key,
		text: String(layer?.text ?? text ?? ''),
		...overlay,
	};
}

function layerKey(layer: InstagramLayer, index: number): OverlayKey {
	const raw = String(layer.type || layer.key || '');
	if (raw === 'headline' || raw === 'subcopy' || raw === 'proof' || raw === 'cta') return raw;
	return (['headline', 'subcopy', 'proof', 'cta'] as OverlayKey[])[index] || 'headline';
}

function normalizeInstagramBody(artifact: Artifact | null): InstagramBody {
	const body = artifact?.body && typeof artifact.body === 'object' ? artifact.body : {};
	const rawSlides = Array.isArray(body.slides) ? body.slides : Array.isArray(body.cards) ? body.cards : [];
	const fallbackTexts = normalizeText(artifact?.export_text).split('\n').map((line) => line.trim()).filter(Boolean);
	const slides = (rawSlides.length ? rawSlides : [{ order: 1 }]).slice(0, 10).map((slide: any, index: number) => {
		const rawLayers = Array.isArray(slide?.layers)
			? slide.layers
			: slide?.layers && typeof slide.layers === 'object'
				? Object.entries(slide.layers).map(([key, value]) => ({ ...(value as Record<string, unknown>), type: key }))
				: [];
		const textFallbacks = [
			slide?.headline || slide?.title || fallbackTexts[index * 2] || artifact?.title || '',
			slide?.body || slide?.copy || fallbackTexts[index * 2 + 1] || '',
			slide?.proof || '',
			slide?.cta || body.cta || '',
		];
		const normalizedLayers = (['headline', 'subcopy', 'proof', 'cta'] as OverlayKey[]).map((key, layerIndex) => {
			const found = rawLayers.find((item: InstagramLayer, foundIndex: number) => layerKey(item, foundIndex) === key);
			return normalizeInstagramLayer(found, key, String(textFallbacks[layerIndex] || ''));
		});
		return {
			order: Number(slide?.order ?? index + 1),
			image: slide?.image || slide?.image_url || slide?.asset || null,
			image_prompt: String(slide?.image_prompt || slide?.visual_brief || '').trim(),
			visual_brief: String(slide?.visual_brief || slide?.image_prompt || '').trim(),
			product_image_reference_url: String(slide?.product_image_reference_url || slide?.reference_image_url || '').trim(),
			layers: normalizedLayers,
		};
	});
	return {
		...body,
		channel: 'instagram',
		format: String(body.format || 'instagram_carousel_v1'),
		aspect_ratio: String(body.aspect_ratio || '4:5'),
		slides,
		caption: String(body.caption || body.description || artifact?.title || ''),
		hashtags: normalizeInstagramHashtags(body.hashtags || body.tags || '#헤나 #허브팩'),
		cta: String(body.cta || ''),
	};
}

function instagramSlideOverlay(slide: InstagramSlide): OverlayLayout {
	const raw = slide.layers.reduce((acc, layer, index) => {
		acc[layerKey(layer, index)] = layer;
		return acc;
	}, {} as Record<string, InstagramLayer>);
	return overlayFromValue(raw);
}

function instagramSlideTexts(slide: InstagramSlide): Record<OverlayKey, string> {
	return slide.layers.reduce((acc, layer, index) => {
		acc[layerKey(layer, index)] = String(layer.text || '');
		return acc;
	}, { headline: '', subcopy: '', proof: '', cta: '' } as Record<OverlayKey, string>);
}

function renderInstagramExport(body: InstagramBody): string {
	const lines: string[] = [];
	body.slides.forEach((slide) => {
		lines.push(`[Slide ${slide.order}]`);
		slide.layers.forEach((layer, index) => {
			const text = String(layer.text || '').trim();
			if (text) lines.push(`${instagramLayerLabels[layerKey(layer, index)]}: ${text}`);
		});
		lines.push('');
	});
	if (body.caption.trim()) lines.push(body.caption.trim());
	if (body.cta.trim()) lines.push(body.cta.trim());
	const hashtags = body.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ').trim();
	if (hashtags) lines.push(hashtags);
	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function resolveInstagramImage(value: InstagramSlide['image'], apiBaseUrl?: string): string {
	if (!value) return '';
	const raw = typeof value === 'string' ? value : value.url || value.path || '';
	if (!raw) return '';
	if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
	if (!raw.startsWith('/') && !/^[\w./-]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(raw)) return '';
	return `${apiBaseUrl || 'http://localhost:5189'}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function resolveContentImage(value?: string, apiBaseUrl?: string): string {
	const raw = String(value || '').trim();
	if (!raw) return '';
	if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
	if (!raw.startsWith('/') && !/^[\w./-]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(raw)) return '';
	return `${apiBaseUrl || 'http://localhost:5189'}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function contentAssetReferenceUrl(value?: string | InstagramSlide['image'] | null): string | undefined {
	const raw = typeof value === 'string' ? value : value?.url || value?.path || '';
	const trimmed = String(raw || '').trim();
	return trimmed.startsWith('/content/assets/files/') ? trimmed : undefined;
}

function productImageGenerationErrorMessage(error: unknown): string {
	const detail = axios.isAxiosError(error) ? error.response?.data?.detail : undefined;
	const text = String(detail || (error as any)?.message || '이미지 생성에 실패했습니다.');
	if (text.includes('product_image_reference_required')) {
		return '제품 이미지가 지정되지 않아 재생성을 중단했습니다. AI 콘텐츠 센터의 제품사진 메뉴에서 해당 SKU의 업로드 제품 사진을 primary로 지정하거나, 섹션의 제품 이미지 참조 URL에 /content/assets/files/... 경로를 입력해 주세요.';
	}
	if (text.includes('writer_output_claim_gate_failed')) {
		return '생성 문안이 클레임/안전성 검수 게이트를 통과하지 못해 저장하지 않았습니다. 더 보수적인 표현으로 다시 생성하거나 소구/Evidence를 확인해 주세요.';
	}
	return text;
}

function InstagramEditor({
	apiBaseUrl,
	selected,
	title,
	setTitle,
	bodyJson,
	setBodyJson,
	setExportText,
	unsavedChanges,
	onReload,
}: {
	apiBaseUrl?: string;
	selected: Artifact | null;
	title: string;
	setTitle: (value: string) => void;
	bodyJson: Record<string, any>;
	setBodyJson: (value: Record<string, any>) => void;
	setExportText: (value: string) => void;
	unsavedChanges: boolean;
	onReload: () => Promise<void>;
}): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const body = React.useMemo(() => normalizeInstagramBody(selected ? { ...selected, body: bodyJson } : selected), [bodyJson, selected]);
	const [activeSlideIndex, setActiveSlideIndex] = React.useState(0);
	const [activeKey, setActiveKey] = React.useState<OverlayKey>('headline');
	const [generatingImage, setGeneratingImage] = React.useState(false);
	React.useEffect(() => {
		setActiveSlideIndex(0);
		setActiveKey('headline');
	}, [selected?.artifact_id]);
	const fallbackSlide: InstagramSlide = {
		order: 1,
		image: null,
		layers: (['headline', 'subcopy', 'proof', 'cta'] as OverlayKey[]).map((key) => normalizeInstagramLayer(undefined, key)),
	};
	const activeSlide = body.slides[Math.min(activeSlideIndex, body.slides.length - 1)] || fallbackSlide;
	const activeSlideImageSrc = resolveInstagramImage(activeSlide?.image, apiBaseUrl);
	const commit = (nextBody: InstagramBody) => {
		setBodyJson(nextBody);
		setExportText(renderInstagramExport(nextBody));
	};
	const updateSlide = (slideIndex: number, updater: (slide: InstagramSlide) => InstagramSlide) => {
		commit({ ...body, slides: body.slides.map((slide, index) => (index === slideIndex ? updater(slide) : slide)) });
	};
	const updateLayer = (key: OverlayKey, patch: Partial<InstagramLayer>) => {
		updateSlide(activeSlideIndex, (slide) => ({
			...slide,
			layers: slide.layers.map((layer, index) => (layerKey(layer, index) === key ? { ...layer, type: key, ...patch } : layer)),
		}));
	};
	const addSlide = () => {
		const nextSlide: InstagramSlide = {
			order: body.slides.length + 1,
			image: null,
			layers: (['headline', 'subcopy', 'proof', 'cta'] as OverlayKey[]).map((key) => normalizeInstagramLayer(undefined, key, key === 'headline' ? '새 슬라이드 문구' : '')),
		};
		const next = { ...body, slides: [...body.slides, nextSlide] };
		commit(next);
		setActiveSlideIndex(next.slides.length - 1);
	};
	const setCaption = (caption: string) => commit({ ...body, caption });
	const setHashtags = (value: string) => commit({ ...body, hashtags: normalizeInstagramHashtags(value) });
	const setCta = (cta: string) => commit({ ...body, cta });
	const generateSlideImage = async () => {
		if (!selected) return;
		const prompt = String(activeSlide.image_prompt || activeSlide.visual_brief || instagramSlideTexts(activeSlide).headline || selected.title || '').trim();
		setGeneratingImage(true);
		try {
			const response = await axios.post<{ item?: Artifact; image?: { image_url?: string; prompt?: string } }>(`${baseUrl}/content/images/generate`, {
				artifact_id: selected.artifact_id,
				target: 'instagram_slide',
				section_index: activeSlideIndex,
				prompt,
				reference_image_url: contentAssetReferenceUrl(activeSlide.product_image_reference_url) || contentAssetReferenceUrl(activeSlide.image),
			});
			const updated = response.data?.item;
			if (updated?.body) {
				setBodyJson(updated.body);
				setExportText(updated.export_text || renderInstagramExport(normalizeInstagramBody({ ...updated, body: updated.body })));
			} else if (response.data?.image?.image_url) {
				updateSlide(activeSlideIndex, (slide) => ({ ...slide, image: response.data.image?.image_url || slide.image }));
			}
			await onReload();
		} catch (error) {
			window.alert(productImageGenerationErrorMessage(error));
		} finally {
			setGeneratingImage(false);
		}
	};
	return (
		<section style={{ ...css.card, ...css.cardPad, display: 'grid', gap: 14 }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0, fontSize: 24, fontWeight: 950 }}>{title || selected?.title || 'Instagram 콘텐츠'}</h2>
					<p style={{ color: '#64748b', margin: '4px 0 0' }}>{selected?.artifact_id || '선택된 콘텐츠가 없습니다.'}{selected ? ` · v${selected.revision_no || 1} · Instagram Editor v1` : ''}</p>
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
					<Pill tone="#e11d48">Instagram</Pill>
					<Pill tone="#4f46e5">body_json + export_text</Pill>
					{unsavedChanges ? <Pill tone="#f59e0b">미저장 변경 있음</Pill> : null}
				</div>
			</div>
			<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
				제목
				<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontSize: 15, fontWeight: 800 }} />
			</label>
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				{body.slides.map((slide, index) => (
					<button key={`${slide.order}-${index}`} type="button" style={index === activeSlideIndex ? css.primaryButton : css.button} onClick={() => setActiveSlideIndex(index)}>
						Slide {slide.order}
					</button>
				))}
				<button type="button" style={css.button} onClick={addSlide} disabled={!selected}>슬라이드 추가</button>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) 320px', gap: 16, alignItems: 'start' }}>
				<div style={{ display: 'grid', gap: 12 }}>
					<SocialCanvasEditor
						finalImageSrc={activeSlideImageSrc}
						overlay={instagramSlideOverlay(activeSlide)}
						texts={instagramSlideTexts(activeSlide)}
						activeKey={activeKey}
						onActiveKeyChange={setActiveKey}
						onOverlayChange={(key, patch) => updateLayer(key, patch)}
						canEdit={Boolean(selected)}
						maxWidth={520}
						large
						aspectRatio={body.aspect_ratio === '4:5' ? '4 / 5' : '1 / 1'}
						background="linear-gradient(135deg,#fff7ed,#fce7f3 50%,#e0f2fe)"
						showPropertyPanel
						propertyPanelDark={false}
						layerLabels={instagramLayerLabels}
					/>
				</div>
				<div style={{ display: 'grid', gap: 10 }}>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						이미지 참조 URL/path
						<input
							value={typeof activeSlide?.image === 'string' ? activeSlide.image : activeSlide?.image?.url || activeSlide?.image?.path || ''}
							onChange={(event) => updateSlide(activeSlideIndex, (slide) => ({ ...slide, image: event.target.value }))}
							disabled={!selected}
							style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '9px 10px' }}
						/>
					</label>
					<button
						type="button"
						style={css.primaryButton}
						disabled={!selected || generatingImage}
						onClick={() => void generateSlideImage()}
					>
						{generatingImage ? '슬라이드 이미지 생성 중...' : activeSlideImageSrc ? '슬라이드 이미지 재생성' : '슬라이드 이미지 생성'}
					</button>
					{(['headline', 'subcopy', 'proof', 'cta'] as OverlayKey[]).map((key) => (
						<label key={key} style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
							{instagramLayerLabels[key]}
							<textarea
								value={instagramSlideTexts(activeSlide)[key]}
								onFocus={() => setActiveKey(key)}
								onChange={(event) => updateLayer(key, { text: event.target.value })}
								disabled={!selected}
								rows={key === 'headline' ? 2 : 1}
								style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 10, resize: 'vertical' }}
							/>
						</label>
					))}
				</div>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
					Caption
					<textarea value={body.caption} onChange={(event) => setCaption(event.target.value)} disabled={!selected} rows={5} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, lineHeight: 1.55, resize: 'vertical' }} />
				</label>
				<div style={{ display: 'grid', gap: 10 }}>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Hashtags
						<textarea value={body.hashtags.join(' ')} onChange={(event) => setHashtags(event.target.value)} disabled={!selected} rows={3} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, lineHeight: 1.55, resize: 'vertical' }} />
					</label>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						CTA
						<input value={body.cta} onChange={(event) => setCta(event.target.value)} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px' }} />
					</label>
				</div>
			</div>
			<div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>
				Preview/Copy/Download는 저장된 `export_text` 기준입니다. 현재 화면의 시각 편집 결과는 임시 저장 후 새 Revision의 `body_json`에 저장됩니다.
			</div>
		</section>
	);
}

type BlogSection = {
	heading: string;
	body: string;
	image?: string;
	image_prompt?: string;
	product_image_reference_url?: string;
};

type BlogFaq = {
	question: string;
	answer: string;
};

type BlogBody = {
	title: string;
	intro: string;
	sections: BlogSection[];
	conclusion: string;
	faq: BlogFaq[];
	cta: string;
	seo_keywords: string[];
	tags: string[];
};

function normalizeStringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
	return String(value || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeTagList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
	return String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeBlogFaq(value: unknown): BlogFaq[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => {
		if (item && typeof item === 'object') {
			const raw = item as Record<string, unknown>;
			return { question: String(raw.question || raw.q || '').trim(), answer: String(raw.answer || raw.a || '').trim() };
		}
		return { question: String(item || '').trim(), answer: '' };
	}).filter((item) => item.question || item.answer);
}

function normalizeBlogBody(artifact: Artifact | null): BlogBody {
	const body = artifact?.body && typeof artifact.body === 'object' ? artifact.body : {};
	const blog = body.blog && typeof body.blog === 'object' ? body.blog as Record<string, any> : {};
	const rawSections = Array.isArray(blog.sections) ? blog.sections : Array.isArray(body.sections) ? body.sections : [];
	const sections = (rawSections.length ? rawSections : [{ heading: '본문 섹션', body: artifact?.export_text || '' }]).map((section: any) => ({
		heading: String(section?.heading || section?.title || '').trim(),
		body: String(section?.body || section?.content || section?.text || '').trim(),
		image: String(section?.image || section?.image_url || section?.asset || '').trim(),
		image_prompt: String(section?.image_prompt || section?.imagePrompt || '').trim(),
		product_image_reference_url: String(section?.product_image_reference_url || section?.reference_image_url || '').trim(),
	}));
	return {
		title: String(blog.title || body.title || artifact?.title || '').trim(),
		intro: String(blog.intro || body.intro || '').trim(),
		sections,
		conclusion: String(blog.conclusion || body.conclusion || '').trim(),
		faq: normalizeBlogFaq(blog.faq || body.faq),
		cta: String(blog.cta || body.cta || '').trim(),
		seo_keywords: normalizeStringList(blog.seo_keywords || blog.seoKeywords || body.seo_keywords || body.keywords),
		tags: normalizeTagList(blog.tags || body.tags),
	};
}

function renderBlogExport(blog: BlogBody): string {
	const lines: string[] = [];
	if (blog.title.trim()) lines.push(blog.title.trim(), '');
	if (blog.intro.trim()) lines.push(blog.intro.trim(), '');
	blog.sections.forEach((section) => {
		if (section.heading.trim()) lines.push(`## ${section.heading.trim()}`);
		if (section.body.trim()) lines.push(section.body.trim());
		const imageLabel = section.image_prompt?.trim() || (section.image?.startsWith('data:') ? '섹션 이미지 생성됨' : section.image?.trim());
		if (imageLabel) lines.push(`[Image: ${imageLabel}]`);
		lines.push('');
	});
	if (blog.conclusion.trim()) lines.push('## 마무리', blog.conclusion.trim(), '');
	const faq = blog.faq.filter((item) => item.question.trim() || item.answer.trim());
	if (faq.length) {
		lines.push('## FAQ');
		faq.forEach((item) => {
			if (item.question.trim()) lines.push(`Q. ${item.question.trim()}`);
			if (item.answer.trim()) lines.push(`A. ${item.answer.trim()}`);
		});
		lines.push('');
	}
	if (blog.cta.trim()) lines.push('## CTA', blog.cta.trim(), '');
	if (blog.seo_keywords.length) lines.push(`SEO Keywords: ${blog.seo_keywords.join(', ')}`);
	if (blog.tags.length) lines.push(`Tags: ${blog.tags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`);
	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function BlogSectionEditor({
	apiBaseUrl,
	selected,
	title,
	setTitle,
	bodyJson,
	setBodyJson,
	setExportText,
	unsavedChanges,
	onReload,
}: {
	apiBaseUrl?: string;
	selected: Artifact | null;
	title: string;
	setTitle: (value: string) => void;
	bodyJson: Record<string, any>;
	setBodyJson: (value: Record<string, any>) => void;
	setExportText: (value: string) => void;
	unsavedChanges: boolean;
	onReload: () => Promise<void>;
}): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const blog = React.useMemo(() => normalizeBlogBody(selected ? { ...selected, body: bodyJson } : selected), [bodyJson, selected]);
	const [activeSectionIndex, setActiveSectionIndex] = React.useState(0);
	const [generatingImage, setGeneratingImage] = React.useState(false);
	React.useEffect(() => {
		setActiveSectionIndex(0);
	}, [selected?.artifact_id]);
	const commit = (nextBlog: BlogBody) => {
		const exportText = renderBlogExport(nextBlog);
		setBodyJson({
			...bodyJson,
			title: nextBlog.title,
			format: 'blog',
			blog: nextBlog,
			sections: nextBlog.sections,
			export_text: exportText,
		});
		setExportText(exportText);
	};
	const updateBlog = (patch: Partial<BlogBody>) => commit({ ...blog, ...patch });
	const updateSection = (index: number, patch: Partial<BlogSection>) => {
		updateBlog({ sections: blog.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section) });
	};
	const addSection = () => {
		const sections = [...blog.sections, { heading: '새 섹션', body: '', image: '' }];
		updateBlog({ sections });
		setActiveSectionIndex(sections.length - 1);
	};
	const removeSection = (index: number) => {
		if (blog.sections.length <= 1) return;
		const sections = blog.sections.filter((_, sectionIndex) => sectionIndex !== index);
		updateBlog({ sections });
		setActiveSectionIndex(Math.max(0, Math.min(index, sections.length - 1)));
	};
	const updateFaqText = (value: string) => {
		const faq = value.split('\n').map((line) => {
			const [question, ...answer] = line.split('|');
			return { question: String(question || '').trim(), answer: answer.join('|').trim() };
		}).filter((item) => item.question || item.answer);
		updateBlog({ faq });
	};
	const activeSection = blog.sections[Math.min(activeSectionIndex, blog.sections.length - 1)] || blog.sections[0] || { heading: '', body: '', image: '' };
	const activeSectionImageSrc = resolveContentImage(activeSection.image, apiBaseUrl);
	const generateSectionImage = async () => {
		if (!selected) return;
		setGeneratingImage(true);
		try {
			const response = await axios.post<{ item?: Artifact; image?: { image_url?: string; prompt?: string } }>(`${baseUrl}/content/images/generate`, {
				artifact_id: selected.artifact_id,
				target: 'blog_section',
				section_index: activeSectionIndex,
				prompt: activeSection.image_prompt || activeSection.heading,
				reference_image_url: contentAssetReferenceUrl(activeSection.product_image_reference_url) || contentAssetReferenceUrl(activeSection.image),
			});
			const updated = response.data?.item;
			if (updated?.body) {
				setBodyJson(updated.body);
				setExportText(updated.export_text || renderBlogExport(normalizeBlogBody({ ...updated, body: updated.body })));
			} else if (response.data?.image?.image_url) {
				updateSection(activeSectionIndex, { image: response.data.image.image_url, image_prompt: response.data.image.prompt || activeSection.image_prompt });
			}
			await onReload();
		} catch (error) {
			window.alert(productImageGenerationErrorMessage(error));
		} finally {
			setGeneratingImage(false);
		}
	};
	const handleTitleChange = (value: string) => {
		setTitle(value);
		updateBlog({ title: value });
	};
	return (
		<section style={{ ...css.card, ...css.cardPad, display: 'grid', gap: 14 }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0, fontSize: 24, fontWeight: 950 }}>{title || selected?.title || 'Blog 콘텐츠'}</h2>
					<p style={{ color: '#64748b', margin: '4px 0 0' }}>{selected?.artifact_id || '선택된 콘텐츠가 없습니다.'}{selected ? ` · v${selected.revision_no || 1} · Blog Section Editor v1` : ''}</p>
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
					<Pill tone="#0f766e">Blog</Pill>
					<Pill tone="#4f46e5">body_json.blog.sections + export_text</Pill>
					{unsavedChanges ? <Pill tone="#f59e0b">미저장 변경 있음</Pill> : null}
				</div>
			</div>
			<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
				문서 제목
				<input value={title} onChange={(event) => handleTitleChange(event.target.value)} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontSize: 15, fontWeight: 800 }} />
			</label>
			<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
				Intro
				<textarea value={blog.intro} onChange={(event) => updateBlog({ intro: event.target.value })} disabled={!selected} rows={3} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, lineHeight: 1.55, resize: 'vertical' }} />
			</label>
			<div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, alignItems: 'start' }}>
				<div style={{ display: 'grid', gap: 8 }}>
					<div style={{ fontSize: 13, fontWeight: 950, color: '#0f172a' }}>Sections</div>
					{blog.sections.map((section, index) => (
						<button key={`${index}-${section.heading}`} type="button" style={index === activeSectionIndex ? css.primaryButton : css.button} onClick={() => setActiveSectionIndex(index)}>
							{index + 1}. {section.heading || '제목 없음'}
						</button>
					))}
					<button type="button" style={css.button} onClick={addSection} disabled={!selected}>섹션 추가</button>
					<button type="button" style={css.button} onClick={() => removeSection(activeSectionIndex)} disabled={!selected || blog.sections.length <= 1}>선택 섹션 삭제</button>
				</div>
				<div style={{ display: 'grid', gap: 10 }}>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Section Heading
						<input value={activeSection.heading} onChange={(event) => updateSection(activeSectionIndex, { heading: event.target.value })} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontWeight: 800 }} />
					</label>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Section Body
						<textarea value={activeSection.body} onChange={(event) => updateSection(activeSectionIndex, { body: event.target.value })} disabled={!selected} rows={8} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, lineHeight: 1.55, resize: 'vertical' }} />
					</label>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Image / Asset reference
						<input value={activeSection.image || ''} onChange={(event) => updateSection(activeSectionIndex, { image: event.target.value })} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px' }} />
					</label>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Product image reference (/content/assets/files/...)
						<input
							value={activeSection.product_image_reference_url || ''}
							onChange={(event) => updateSection(activeSectionIndex, { product_image_reference_url: event.target.value })}
							disabled={!selected}
							placeholder="/content/assets/files/uploaded-product.png"
							style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px' }}
						/>
					</label>
					{activeSectionImageSrc ? (
						<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 10, background: '#f8fafc' }}>
							<div style={{ color: '#64748b', fontSize: 12, fontWeight: 900, marginBottom: 8 }}>Section image preview</div>
							<img src={activeSectionImageSrc} alt={activeSection.heading || 'blog section image'} style={{ width: '100%', maxHeight: 360, height: 'auto', objectFit: 'contain', borderRadius: 12, display: 'block', background: '#fff' }} />
						</div>
					) : activeSection.image_prompt ? (
						<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#f8fafc', color: '#64748b', fontSize: 12 }}>
							이미지 지시: {activeSection.image_prompt}
						</div>
					) : null}
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Image prompt
						<input value={activeSection.image_prompt || ''} onChange={(event) => updateSection(activeSectionIndex, { image_prompt: event.target.value })} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px' }} />
					</label>
					<button
						type="button"
						style={css.primaryButton}
						disabled={!selected || generatingImage || !(activeSection.image_prompt || activeSection.heading)}
						onClick={() => void generateSectionImage()}
					>
						{generatingImage ? '섹션 이미지 생성 중...' : activeSectionImageSrc ? '섹션 이미지 재생성' : '섹션 이미지 생성'}
					</button>
				</div>
			</div>
			<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
				Conclusion / 마무리
				<textarea value={blog.conclusion} onChange={(event) => updateBlog({ conclusion: event.target.value })} disabled={!selected} rows={4} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, lineHeight: 1.55, resize: 'vertical' }} />
			</label>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
					FAQ (한 줄에 `질문|답변`)
					<textarea value={blog.faq.map((item) => `${item.question}|${item.answer}`).join('\n')} onChange={(event) => updateFaqText(event.target.value)} disabled={!selected} rows={5} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, lineHeight: 1.55, resize: 'vertical' }} />
				</label>
				<div style={{ display: 'grid', gap: 10 }}>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						CTA
						<textarea value={blog.cta} onChange={(event) => updateBlog({ cta: event.target.value })} disabled={!selected} rows={2} style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 12, resize: 'vertical' }} />
					</label>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						SEO Keywords
						<input value={blog.seo_keywords.join(', ')} onChange={(event) => updateBlog({ seo_keywords: normalizeStringList(event.target.value) })} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px' }} />
					</label>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Tags
						<input value={blog.tags.join(' ')} onChange={(event) => updateBlog({ tags: normalizeTagList(event.target.value) })} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px' }} />
					</label>
				</div>
			</div>
			<div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>
				Blog은 Canvas를 사용하지 않습니다. 문서 구조는 `body_json.blog.sections`, 게시/복사/다운로드 텍스트는 저장된 `export_text`를 authority로 사용합니다.
			</div>
		</section>
	);
}

type ShortsVisualAsset = {
	assetId: string;
	url: string;
	source: string;
	generatedFromPromptHash?: string;
	model?: string;
	contract?: string;
	legacy?: boolean;
};

type ShortsScene = {
	order: number;
	duration_sec: number;
	caption: string;
	voice_over: string;
	visual_prompt: string;
	visual_asset: ShortsVisualAsset | null;
	image_prompt?: string;
	product_image_reference_url?: string;
	cta: string;
	overlay?: OverlayLayout;
	stage?: string;
	subtitle?: string;
	highlight_keywords?: string[];
};

type ShortsBody = {
	title: string;
	format: string;
	aspect_ratio: string;
	scenes: ShortsScene[];
};

function durationFromRange(value: unknown, fallback = 4): number {
	const text = String(value || '');
	const match = text.match(/(\d+)\s*-\s*(\d+)/);
	if (!match) return fallback;
	const start = Number(match[1]);
	const end = Number(match[2]);
	return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : fallback;
}

const SHORTS_ASSET_URL_PREFIXES = ['/content/images/', '/content/assets/files/'];

function isShortsAssetReference(value: unknown): value is string {
	const text = typeof value === 'string' ? value.trim() : '';
	return !text.includes(' ') && SHORTS_ASSET_URL_PREFIXES.some((prefix) => text.startsWith(prefix) && text.length > prefix.length);
}

function legacyShortsVisualAsset(url: string): ShortsVisualAsset {
	const name = url.trim().split('/').pop() || '';
	return { assetId: `legacy:${name}`, url: url.trim(), source: 'EXISTING', legacy: true };
}

function shortsSceneVisualPrompt(scene: any): string {
	const explicit = String(scene?.visual_prompt || '').trim();
	if (explicit) return explicit;
	const legacy = [scene?.visual_asset, scene?.visual].find((value) => typeof value === 'string' && value.trim() && !isShortsAssetReference(value));
	const direction = String(scene?.visual_direction || '').trim();
	const legacyText = typeof legacy === 'string' ? legacy.trim() : '';
	if (legacyText && legacyText !== direction) return legacyText;
	return String(scene?.image_prompt || '').trim() || direction || legacyText;
}

function shortsSceneVisualAsset(scene: any): ShortsVisualAsset | null {
	const raw = scene?.visual_asset;
	if (raw && typeof raw === 'object') return raw as ShortsVisualAsset;
	const legacyUrl = [raw, scene?.generated_image, scene?.image, scene?.asset].find(isShortsAssetReference);
	return legacyUrl ? legacyShortsVisualAsset(legacyUrl) : null;
}

function shortsSceneImageUrl(scene: ShortsScene): string {
	return scene.visual_asset && typeof scene.visual_asset.url === 'string' ? scene.visual_asset.url : '';
}

function normalizeShortsScene(scene: any, index: number): ShortsScene {
	const caption = String(scene?.caption || scene?.line || scene?.text || '').trim();
	const duration = Number(scene?.duration_sec ?? scene?.duration ?? durationFromRange(scene?.t, 4));
	return {
		...(scene && typeof scene === 'object' ? scene : {}),
		order: Number(scene?.order || scene?.page || index + 1),
		duration_sec: clamp(duration, 1, 30),
		caption,
		voice_over: String(scene?.voice_over || scene?.voiceOver || scene?.narration || caption).trim(),
		visual_prompt: shortsSceneVisualPrompt(scene),
		visual_asset: shortsSceneVisualAsset(scene),
		image_prompt: String(scene?.image_prompt || scene?.visual_direction || scene?.visual || '').trim(),
		product_image_reference_url: String(scene?.product_image_reference_url || scene?.reference_image_url || '').trim(),
		cta: String(scene?.cta || '').trim(),
		overlay: overlayFromValue(scene?.overlay || scene?.overlay_layout),
	};
}

function normalizeShortsBody(artifact: Artifact | null): ShortsBody {
	const body = artifact?.body && typeof artifact.body === 'object' ? artifact.body : {};
	const shorts = body.shorts && typeof body.shorts === 'object' ? body.shorts as Record<string, any> : {};
	const rawScenes = Array.isArray(shorts.scenes) ? shorts.scenes : Array.isArray(body.scenes) ? body.scenes : [];
	const scenes = (rawScenes.length ? rawScenes : [{ order: 1, duration_sec: 4, caption: artifact?.export_text || artifact?.title || '' }])
		.map((scene: any, index: number) => normalizeShortsScene(scene, index));
	return {
		title: String(shorts.title || body.title || artifact?.title || '').trim(),
		format: String(shorts.format || body.format || 'shorts_scene_timeline_v1'),
		aspect_ratio: String(shorts.aspect_ratio || body.aspect_ratio || '9:16'),
		scenes,
	};
}

function renderShortsExport(body: ShortsBody): string {
	const lines: string[] = [];
	if (body.title.trim()) lines.push(body.title.trim(), '');
	body.scenes.forEach((scene) => {
		lines.push(`[Scene ${scene.order} | ${scene.duration_sec}s]`);
		if (scene.caption.trim()) lines.push(`On-screen: ${scene.caption.trim()}`);
		if (scene.voice_over.trim()) lines.push(`Voice-over: ${scene.voice_over.trim()}`);
		if (scene.visual_prompt.trim()) lines.push(`Visual: ${scene.visual_prompt.trim()}`);
		if (scene.cta.trim()) lines.push(`CTA: ${scene.cta.trim()}`);
		lines.push('');
	});
	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function shortsSceneOverlay(scene: ShortsScene): OverlayLayout {
	return overlayFromValue(scene.overlay);
}

function shortsSceneTexts(scene: ShortsScene): Record<OverlayKey, string> {
	return {
		headline: scene.caption,
		subcopy: scene.voice_over,
		proof: scene.visual_prompt,
		cta: scene.cta,
	};
}

function ShortsEditor({
	apiBaseUrl,
	selected,
	title,
	setTitle,
	bodyJson,
	setBodyJson,
	setExportText,
	unsavedChanges,
	onReload,
}: {
	apiBaseUrl?: string;
	selected: Artifact | null;
	title: string;
	setTitle: (value: string) => void;
	bodyJson: Record<string, any>;
	setBodyJson: (value: Record<string, any>) => void;
	setExportText: (value: string) => void;
	unsavedChanges: boolean;
	onReload: () => Promise<void>;
}): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const navigate = useNavigate();
	const body = React.useMemo(() => normalizeShortsBody(selected ? { ...selected, body: bodyJson } : selected), [bodyJson, selected]);
	const [activeSceneIndex, setActiveSceneIndex] = React.useState(0);
	const [activeKey, setActiveKey] = React.useState<OverlayKey>('headline');
	const [generatingImage, setGeneratingImage] = React.useState(false);
	React.useEffect(() => {
		setActiveSceneIndex(0);
		setActiveKey('headline');
	}, [selected?.artifact_id]);
	const activeScene = body.scenes[Math.min(activeSceneIndex, body.scenes.length - 1)] || body.scenes[0] || normalizeShortsScene({}, 0);
	const activeSceneImageSrc = resolveContentImage(shortsSceneImageUrl(activeScene), apiBaseUrl);
	const commit = (nextBody: ShortsBody) => {
		const exportText = renderShortsExport(nextBody);
		setBodyJson({
			...bodyJson,
			title: nextBody.title,
			format: nextBody.format,
			aspect_ratio: nextBody.aspect_ratio,
			shorts: nextBody,
			scenes: nextBody.scenes,
			export_text: exportText,
		});
		setExportText(exportText);
	};
	const updateBody = (patch: Partial<ShortsBody>) => commit({ ...body, ...patch });
	const updateScene = (sceneIndex: number, patch: Partial<ShortsScene>) => {
		updateBody({ scenes: body.scenes.map((scene, index) => index === sceneIndex ? { ...scene, ...patch } : scene) });
	};
	const updateOverlay = (key: OverlayKey, patch: Partial<OverlayItem>) => {
		const overlay = { ...shortsSceneOverlay(activeScene), [key]: { ...shortsSceneOverlay(activeScene)[key], ...patch } };
		updateScene(activeSceneIndex, { overlay });
	};
	const updateSceneText = (key: OverlayKey, value: string) => {
		if (key === 'headline') updateScene(activeSceneIndex, { caption: value });
		if (key === 'subcopy') updateScene(activeSceneIndex, { voice_over: value });
		if (key === 'proof') updateScene(activeSceneIndex, { visual_prompt: value });
		if (key === 'cta') updateScene(activeSceneIndex, { cta: value });
	};
	const addScene = () => {
		const scenes = [...body.scenes, normalizeShortsScene({ caption: '새 장면 문구', duration_sec: 4 }, body.scenes.length)];
		updateBody({ scenes });
		setActiveSceneIndex(scenes.length - 1);
	};
	const removeScene = (index: number) => {
		if (body.scenes.length <= 1) return;
		const scenes = body.scenes.filter((_, sceneIndex) => sceneIndex !== index).map((scene, sceneIndex) => ({ ...scene, order: sceneIndex + 1 }));
		updateBody({ scenes });
		setActiveSceneIndex(Math.max(0, Math.min(index, scenes.length - 1)));
	};
	const totalDuration = body.scenes.reduce((sum, scene) => sum + Number(scene.duration_sec || 0), 0);
	const handleTitleChange = (value: string) => {
		setTitle(value);
		updateBody({ title: value });
	};
	const generateSceneImage = async () => {
		if (!selected) return;
		const prompt = String(activeScene.visual_prompt || activeScene.caption || selected.title || '').trim();
		setGeneratingImage(true);
		try {
			const response = await axios.post<{ item?: Artifact; image?: { image_url?: string; prompt?: string } }>(`${baseUrl}/content/images/generate`, {
				artifact_id: selected.artifact_id,
				target: 'shorts_scene',
				section_index: activeSceneIndex,
				prompt,
				reference_image_url: contentAssetReferenceUrl(activeScene.product_image_reference_url) || contentAssetReferenceUrl(shortsSceneImageUrl(activeScene)),
			});
			const updated = response.data?.item;
			if (updated?.body) {
				setBodyJson(updated.body);
				setExportText(updated.export_text || renderShortsExport(normalizeShortsBody({ ...updated, body: updated.body })));
			} else if (response.data?.image?.image_url) {
				updateScene(activeSceneIndex, { visual_prompt: prompt, visual_asset: { assetId: `content_image:${response.data.image.image_url.split('/').pop() || ''}`, url: response.data.image.image_url, source: 'AI_GENERATED' } });
			}
			await onReload();
		} catch (error) {
			window.alert(productImageGenerationErrorMessage(error));
		} finally {
			setGeneratingImage(false);
		}
	};
	return (
		<section style={{ ...css.card, ...css.cardPad, display: 'grid', gap: 14 }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0, fontSize: 24, fontWeight: 950 }}>{title || selected?.title || 'Shorts 콘텐츠'}</h2>
					<p style={{ color: '#64748b', margin: '4px 0 0' }}>{selected?.artifact_id || '선택된 콘텐츠가 없습니다.'}{selected ? ` · v${selected.revision_no || 1} · Shorts Scene Editor v1` : ''}</p>
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
					<Pill tone="#dc2626">YouTube Shorts</Pill>
					<Pill tone="#4f46e5">body_json.shorts.scenes + export_text</Pill>
					{unsavedChanges ? <Pill tone="#f59e0b">미저장 변경 있음</Pill> : null}
				</div>
			</div>
			<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
				제목
				<input value={title} onChange={(event) => handleTitleChange(event.target.value)} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontSize: 15, fontWeight: 800 }} />
			</label>
			<ShortsRenderPlanPanel
				apiBaseUrl={apiBaseUrl}
				artifactId={selected?.artifact_id}
				skuId={selected?.sku_id}
				config={bodyJson.shorts_generation_config}
				scenes={body.scenes}
				unsaved={unsavedChanges}
				onArtifactUpdated={(item: Artifact) => {
					if (!item?.body) return;
					setBodyJson(item.body);
					setExportText(item.export_text || renderShortsExport(normalizeShortsBody({ ...item, body: item.body })));
					void onReload();
				}}
				onOpenGenerator={selected ? () => navigate(shortsToolPath(shortsToolSourceForArtifact(selected))) : undefined}
			/>
			<div style={{ display: 'grid', gridTemplateColumns: '180px minmax(280px, 1fr) 280px', gap: 14, alignItems: 'start' }}>
				<div style={{ display: 'grid', gap: 8 }}>
					<div style={{ fontSize: 13, fontWeight: 950, color: '#0f172a' }}>Scene List</div>
					{body.scenes.map((scene, index) => (
						<button key={`${scene.order}-${index}`} type="button" style={index === activeSceneIndex ? css.primaryButton : css.button} onClick={() => setActiveSceneIndex(index)}>
							Scene {scene.order} · {scene.duration_sec}s
						</button>
					))}
					<button type="button" style={css.button} onClick={addScene} disabled={!selected}>장면 추가</button>
					<button type="button" style={css.button} onClick={() => removeScene(activeSceneIndex)} disabled={!selected || body.scenes.length <= 1}>선택 장면 삭제</button>
				</div>
				<SocialCanvasEditor
					finalImageSrc={activeSceneImageSrc}
					overlay={shortsSceneOverlay(activeScene)}
					texts={shortsSceneTexts(activeScene)}
					activeKey={activeKey}
					onActiveKeyChange={setActiveKey}
					onOverlayChange={updateOverlay}
					canEdit={Boolean(selected)}
					maxWidth={280}
					large={false}
					aspectRatio="9 / 16"
					background="linear-gradient(180deg,#111827,#312e81 48%,#7f1d1d)"
					showPropertyPanel
					propertyPanelDark={false}
					layerLabels={{ headline: '화면 자막', subcopy: '보이스오버', proof: '비주얼', cta: 'CTA' }}
				/>
				<div style={{ display: 'grid', gap: 10 }}>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						Duration seconds
						<input type="number" min={1} max={30} value={activeScene.duration_sec} onChange={(event) => updateScene(activeSceneIndex, { duration_sec: clamp(Number(event.target.value), 1, 30) })} disabled={!selected} style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px' }} />
					</label>
					{(['headline', 'subcopy', 'proof', 'cta'] as OverlayKey[]).map((key) => (
						<label key={key} style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
							{{ headline: 'On-screen Caption', subcopy: 'Voice-over', proof: '장면 연출 지시', cta: 'CTA' }[key]}
							<textarea
								value={shortsSceneTexts(activeScene)[key]}
								onFocus={() => setActiveKey(key)}
								onChange={(event) => updateSceneText(key, event.target.value)}
								disabled={!selected}
								rows={key === 'subcopy' ? 4 : 2}
								style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 10, resize: 'vertical', lineHeight: 1.45 }}
							/>
						</label>
					))}
					<button
						type="button"
						style={css.primaryButton}
						disabled={!selected || generatingImage}
						onClick={() => void generateSceneImage()}
					>
						{generatingImage ? '장면 이미지 생성 중...' : activeSceneImageSrc ? '장면 이미지 재생성' : '장면 이미지 생성'}
					</button>
				</div>
			</div>
			<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#f8fafc' }}>
				<div style={css.between}>
					<strong style={{ color: '#0f172a', fontSize: 13 }}>Simple Timeline</strong>
					<Pill tone="#64748b">Total {totalDuration}s</Pill>
				</div>
				<div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
					{body.scenes.map((scene, index) => (
						<button
							key={`${scene.order}-timeline`}
							type="button"
							onClick={() => setActiveSceneIndex(index)}
							style={{
								flex: Math.max(1, scene.duration_sec),
								border: index === activeSceneIndex ? '2px solid #dc2626' : '1px solid #cbd5e1',
								borderRadius: 10,
								background: index === activeSceneIndex ? '#fee2e2' : '#fff',
								padding: '8px 6px',
								fontSize: 11,
								fontWeight: 900,
								color: '#334155',
							}}
						>
							S{scene.order}<br />{scene.duration_sec}s
						</button>
					))}
				</div>
			</div>
		</section>
	);
}

function EditorCanvas({
	selected,
	title,
	setTitle,
	exportText,
	setExportText,
	unsavedChanges,
}: {
	selected: Artifact | null;
	title: string;
	setTitle: (value: string) => void;
	exportText: string;
	setExportText: (value: string) => void;
	unsavedChanges: boolean;
}): JSX.Element {
	return (
		<section style={{ ...css.card, ...css.cardPad, display: 'grid', gap: 14 }}>
			<div style={css.between}>
				<div>
					<h2 style={{ margin: 0, fontSize: 24, fontWeight: 950 }}>{title || selected?.title || '콘텐츠를 선택하세요'}</h2>
					<p style={{ color: '#64748b', margin: '4px 0 0' }}>
						{selected?.artifact_id || '선택된 콘텐츠가 없습니다.'}
						{selected ? ` · v${selected.revision_no || 1} · ${sourceLabel(selected.source)}` : ''}
					</p>
				</div>
				<Pill tone="#f59e0b">{statusLabel(selected?.reviewer_status)}</Pill>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
				<div style={{ display: 'grid', gap: 10 }}>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						제목
						<input
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							disabled={!selected}
							style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: '10px 12px', fontSize: 15, fontWeight: 800 }}
						/>
					</label>
					<label style={{ display: 'grid', gap: 6, color: '#475569', fontSize: 12, fontWeight: 900 }}>
						본문 / Export Text
						<textarea
							value={exportText}
							onChange={(event) => setExportText(event.target.value)}
							disabled={!selected}
							rows={12}
							style={{ border: '1px solid #cbd5e1', borderRadius: 14, padding: 14, fontSize: 13, lineHeight: 1.55, resize: 'vertical', whiteSpace: 'pre-wrap' }}
						/>
					</label>
				</div>
				<div style={{ display: 'grid', gap: 10 }}>
					<Pill tone="#4f46e5">Original: {selected?.original_artifact_id || selected?.artifact_id || '-'}</Pill>
					<Pill tone="#64748b">Parent: {selected?.parent_artifact_id || '-'}</Pill>
					<Pill tone="#10b981">{selected?.is_published_version ? '게시본 수정본' : '초안 / 검수 수정본'}</Pill>
					{unsavedChanges ? <Pill tone="#f59e0b">미저장 변경 있음</Pill> : null}
					<div style={{ color: '#64748b', fontSize: 12, fontWeight: 900 }}>저장된 Revision 출력물</div>
					<div style={{ minHeight: 180, background: '#f1f5f9', borderRadius: 18, color: '#64748b', fontWeight: 800, whiteSpace: 'pre-wrap', padding: 16 }}>
						{selected?.export_text || '저장된 export_text가 없습니다.'}
					</div>
				</div>
			</div>
		</section>
	);
}

function EvidenceInspector({ selected, data }: { selected: Artifact | null; data: ContentData }): JSX.Element {
	const appeal = data.appeals.find((item) => item.appeal_id === selected?.appeal_id);
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<h3 style={{ marginTop: 0 }}>소구 근거 확인</h3>
			<ul style={{ color: '#475569', fontSize: 12, paddingLeft: 18, marginBottom: 0 }}>
				<li>소구: {appeal?.label || selected?.appeal_id || '-'}</li>
				<li>근거 레코드: {appeal?.evidence_count || 0}</li>
				<li>학습 판정: {verdictLabel(appeal?.learning_verdict)}</li>
			</ul>
		</section>
	);
}

function RevisionChainPanel({ selected, data, setSelectedId }: { selected: Artifact | null; data: ContentData; setSelectedId: (id: string) => void }): JSX.Element {
	const originalId = selected?.original_artifact_id || selected?.artifact_id || '';
	const revisions = originalId
		? data.artifacts
			.filter((item) => (item.original_artifact_id || item.artifact_id) === originalId)
			.sort((a, b) => (a.revision_no || 1) - (b.revision_no || 1))
		: [];
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<h3 style={{ marginTop: 0 }}>수정본 이력</h3>
			{revisions.map((item) => (
				<button
					key={item.artifact_id}
					type="button"
					onClick={() => setSelectedId(item.artifact_id)}
					style={{
						display: 'block',
						width: '100%',
						textAlign: 'left',
						border: item.artifact_id === selected?.artifact_id ? '2px solid #2563eb' : '1px solid #e2e8f0',
						borderRadius: 12,
						background: item.artifact_id === selected?.artifact_id ? '#eff6ff' : '#fff',
						padding: 10,
						marginTop: 8,
						cursor: 'pointer',
					}}
				>
					<div style={{ fontSize: 12, fontWeight: 950 }}>
						v{item.revision_no || 1} · {sourceLabel(item.source)}
						{item.is_published_version ? ' · 게시본' : ''}
					</div>
					<div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{statusLabel(item.reviewer_status)} · {item.revision_reason || 'system_generate'}</div>
				</button>
			))}
			{!selected ? <EmptyState message="수정본을 선택하세요." /> : null}
			{selected && revisions.length <= 1 ? <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 0 }}>아직 추가 수정본이 없습니다.</p> : null}
		</section>
	);
}

function ReviewChecklist(): JSX.Element {
	return (
		<section style={{ ...css.card, ...css.cardPad }} data-testid="content-review-checklist">
			<h3 style={{ marginTop: 0 }}>검수 가이드</h3>
			<div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5 }}>아래 항목은 자동 검증 결과가 아니라 게시 전 사람이 확인할 안내입니다.</div>
			{['금지 표현 없음', '근거와 문안 일치', '행동 유도 확인', '게시 전 최종 미리보기'].map((item) => (
				<label key={item} style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#475569', fontSize: 12, marginTop: 8 }}>
					<input type="checkbox" readOnly /> {item}
				</label>
			))}
		</section>
	);
}

function ChannelProductionBrief({ selected }: { selected: Artifact | null }): JSX.Element {
	const channel = String(selected?.channel || '');
	const requirements =
		channel === 'blog'
			? ['4~6개 H2 섹션, 섹션당 240~950자, 전체 1,800~5,200자', 'Lead 140~420자, FAQ 3개 이상, SEO Keyword 5개 이상, Tag 4개 이상', '각 섹션마다 실제 이미지 생성용 prompt 1개 필수']
			: channel === 'instagram'
				? ['7~10장 4:5 캐러셀, 한 장당 한 가지 구매 질문/아이디어', 'Headline 6~34자, Body 18~90자, Caption 120~700자, Hashtag 4~14개', '각 슬라이드마다 이미지 prompt 1개와 proof/benefit 레이어 확인']
				: channel === 'shorts'
					? ['총 15~35초, 4~6개 장면, 첫 1~3초 hook과 초반 제품 노출', '장면별 voice-over 18~120자, subtitle 4~40자, stage hook/problem/demo/routine/CTA 확인', '각 장면마다 9:16 이미지 prompt 또는 생성 이미지 연결']
					: ['생성된 export_text와 body_json 구조를 확인', '필요하면 다시 생성 또는 임시 저장으로 새 Revision 생성'];
	const generatedAssets =
		channel === 'blog'
			? '글 초안, 섹션 구조, 이미지 지시, FAQ, CTA, SEO/Tags'
			: channel === 'instagram'
				? '캐러셀 슬라이드, 텍스트 레이어, 캡션, 해시태그, CTA'
				: channel === 'shorts'
					? 'Scene timeline, 화면 자막, 보이스오버, 비주얼 지시, CTA'
					: '본문 초안과 게시 텍스트';
	return (
		<section style={{ ...css.card, ...css.cardPad }}>
			<div style={css.between}>
				<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>매체별 제작 Brief</h2>
				<Pill tone="#4f46e5">{selected ? normalizeChannel(selected.channel) : '콘텐츠 선택 필요'}</Pill>
			</div>
			<div style={{ color: '#475569', fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
				<strong>자동 생성된 것</strong><br />{generatedAssets}
			</div>
			<div style={{ color: '#475569', fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
				<strong>검수/보강할 것</strong>
				<ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
					{requirements.map((item) => <li key={item}>{item}</li>)}
				</ul>
			</div>
			<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 10 }}>이미지는 각 블로그 섹션, 인스타 슬라이드, 숏츠 장면 단위로 실제 생성 후 URL/path에 연결할 수 있습니다. 영상 파일 생성은 아직 제작 지시/장면 이미지 단계입니다.</div>
		</section>
	);
}

function ContentEditorView({ apiBaseUrl, data, selectedId, setSelectedId, setView }: { apiBaseUrl?: string; data: ContentData; selectedId: string; setSelectedId: (id: string) => void; setView: (v: ViewKey) => void }): JSX.Element {
	const contentArtifacts = React.useMemo(() => data.artifacts.filter((item) => isContentChannel(item.channel)), [data.artifacts]);
	const selected = contentArtifacts.find((item) => item.artifact_id === selectedId) || contentArtifacts[0] || null;
	const [title, setTitle] = React.useState('');
	const [bodyJson, setBodyJson] = React.useState<Record<string, any>>({});
	const [exportText, setExportText] = React.useState('');
	const [revalidateBusy, setRevalidateBusy] = React.useState(false);
	const [revalidateMessage, setRevalidateMessage] = React.useState('');
	React.useEffect(() => {
		setTitle(selected?.title || '');
		setBodyJson(selected?.body || {});
		setExportText(selected?.export_text || '');
		setRevalidateMessage('');
	}, [selected?.artifact_id, selected?.title, selected?.body, selected?.export_text]);
	const originalId = selected?.original_artifact_id || selected?.artifact_id || '';
	const hasPublishedSibling = Boolean(originalId && data.artifacts.some((item) => (item.original_artifact_id || item.artifact_id) === originalId && item.is_published_version));
	const unsavedChanges = Boolean(
		selected &&
		(normalizeText(title) !== normalizeText(selected.title) || normalizeText(exportText) !== normalizeText(selected.export_text) || stableJson(bodyJson) !== stableJson(selected.body || {})),
	);
	const v2Bundle = parseBlogV2Bundle(bodyJson);
	const showBlogV2Review = shouldShowBlogV2ReviewPanel(selected?.channel, bodyJson);
	const setBodyJsonWithFreshness = (next: Record<string, any>) => {
		if (!showBlogV2Review) {
			setBodyJson(next);
			return;
		}
		const currentBundle = parseBlogV2Bundle(bodyJson) || parseBlogV2Bundle(next);
		if (!currentBundle) {
			setBodyJson(next);
			return;
		}
		const preserved = next.blog_v2_review_bundle
			? { ...next, blog_v2_review_bundle: { ...next.blog_v2_review_bundle, draft: currentBundle.draft, qualityReport: currentBundle.qualityReport, imagePlan: currentBundle.imagePlan, context: currentBundle.context, intentAnalysis: currentBundle.intentAnalysis, contentPlan: currentBundle.contentPlan, validationHistory: currentBundle.validationHistory, currentValidationRunId: currentBundle.currentValidationRunId, currentQualityReport: currentBundle.currentQualityReport } }
			: next;
		const editorChanged = stableJson({ title: next.title, blog: next.blog, sections: next.sections, export_text: next.export_text }) !== stableJson({ title: bodyJson.title, blog: bodyJson.blog, sections: bodyJson.sections, export_text: bodyJson.export_text });
		if (!editorChanged) {
			setBodyJson(preserved);
			return;
		}
		setBodyJson(persistReviewBundle(preserved, applyLocalDraftEdit(parseBlogV2Bundle(preserved) || currentBundle, {
			selectedTitle: next.title,
			draftText: 'human-revised',
		})));
	};
	const revalidateBlogV2 = async () => {
		if (!selected) return;
		if (unsavedChanges) {
			setRevalidateMessage('변경 내용을 먼저 저장한 뒤 다시 점검해 주세요.');
			return;
		}
		const baseUrl = apiBaseUrl || 'http://localhost:5189';
		setRevalidateBusy(true);
		setRevalidateMessage('');
		try {
			const response = await axios.post<{ item?: Artifact }>(`${baseUrl}/content/artifacts/${encodeURIComponent(selected.artifact_id)}/blog-v2/revalidate`);
			const item = response.data?.item;
			if (item?.body) {
				setBodyJson(item.body);
				if (item.title) setTitle(item.title);
				if (item.export_text) setExportText(item.export_text);
			}
			await data.reload();
			setRevalidateMessage('현재 편집본 점검을 완료했습니다.');
		} catch {
			setRevalidateMessage('다시 점검에 실패했습니다. STALE 상태를 유지합니다.');
		} finally {
			setRevalidateBusy(false);
		}
	};
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-editor-view">
			<StageHeader
				title="5~6. 수정·편집 / 최종 검수"
				task="생성된 초안을 수정하고, 저장된 Revision이 게시 가능한지 최종 확정하세요."
				changed={`편집 대상 ${numberLabel(contentArtifacts.length)}건 · 검수 대기 ${numberLabel(reviewWaitingArtifacts(data))}건`}
				reason="생성된 결과물이 그대로 게시되어도 되는지, claim과 evidence가 맞는지 확인해야 합니다."
				decision="수정 저장, 다시 생성, Preview 확인, 최종 승인 중 무엇을 할지 결정합니다."
				next="최종 승인 후 게시 관리 단계에서 URL을 연결합니다."
				stats={[
					{ label: '선택', value: selected ? `${normalizeChannel(selected.channel)} v${selected.revision_no || 1}` : '없음', tone: '#2563eb' },
					{ label: '상태', value: statusLabel(selected?.reviewer_status), tone: selected?.reviewer_status === 'accepted' ? '#10b981' : '#f59e0b' },
					{ label: '미저장', value: unsavedChanges ? '있음' : '없음', tone: unsavedChanges ? '#f59e0b' : '#10b981' },
				]}
			/>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
				<ScopedMetric scope="현재" label="편집 대기" value={contentArtifacts.filter((item) => item.reviewer_status !== 'accepted').length} tone="#f59e0b" />
				<ScopedMetric scope="현재" label="편집 중(미저장)" value={unsavedChanges ? 1 : 0} tone={unsavedChanges ? '#dc2626' : '#10b981'} />
				<ScopedMetric scope="현재" label="검수 대기" value={reviewWaitingArtifacts(data)} tone="#f59e0b" />
				<ScopedMetric scope="현재" label="승인 완료" value={approvedArtifacts(data)} tone="#10b981" />
				<ScopedMetric scope="누적" label="전체 Revision" value={contentArtifacts.length} tone="#64748b" />
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: showBlogV2Review ? '240px 1fr 380px' : '280px 1fr 320px', gap: 14, minHeight: 720 }}>
				<ArtifactList data={data} selectedId={selected?.artifact_id || selectedId} setSelectedId={setSelectedId} />
				<div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
					<EditorActionBar
						apiBaseUrl={apiBaseUrl}
						data={data}
						selected={selected}
						title={title}
						bodyJson={bodyJson}
						exportText={exportText}
						unsavedChanges={unsavedChanges}
						hasPublishedSibling={hasPublishedSibling}
						setSelectedId={setSelectedId}
						setView={setView}
						approveBlocked={showBlogV2Review && !canApproveBlogV2(v2Bundle)}
						approveBlockedReason={showBlogV2Review && !canApproveBlogV2(v2Bundle) ? '필수 검수가 끝나기 전에는 기존 검수 승인을 할 수 없습니다.' : ''}
				/>
					{selected?.channel === 'shorts' ? (
						<ShortsEditor
							apiBaseUrl={apiBaseUrl}
							selected={selected}
							title={title}
							setTitle={setTitle}
							bodyJson={bodyJson}
							setBodyJson={setBodyJson}
							setExportText={setExportText}
							unsavedChanges={unsavedChanges}
							onReload={data.reload}
						/>
					) : selected?.channel === 'blog' ? (
						<BlogSectionEditor
							apiBaseUrl={apiBaseUrl}
							selected={selected}
							title={title}
							setTitle={setTitle}
							bodyJson={bodyJson}
							setBodyJson={showBlogV2Review ? setBodyJsonWithFreshness : setBodyJson}
							setExportText={setExportText}
							unsavedChanges={unsavedChanges}
							onReload={data.reload}
						/>
					) : selected?.channel === 'instagram' ? (
						<InstagramEditor
							apiBaseUrl={apiBaseUrl}
							selected={selected}
							title={title}
							setTitle={setTitle}
							bodyJson={bodyJson}
							setBodyJson={setBodyJson}
							setExportText={setExportText}
							unsavedChanges={unsavedChanges}
							onReload={data.reload}
						/>
					) : (
						<EditorCanvas selected={selected} title={title} setTitle={setTitle} exportText={exportText} setExportText={setExportText} unsavedChanges={unsavedChanges} />
					)}
				</div>
				<div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
					<RevisionChainPanel selected={selected} data={data} setSelectedId={setSelectedId} />
					<ChannelProductionBrief selected={selected} />
					<EvidenceInspector selected={selected} data={data} />
					{showBlogV2Review && v2Bundle ? (
						<BlogV2ReviewPanel
							bundle={v2Bundle}
							reviewerStatus={selected?.reviewer_status}
							onBundleChange={(nextBundle) => setBodyJson((prev) => persistReviewBundle(prev, nextBundle))}
							onTitleEdit={setTitle}
							onRevalidate={() => void revalidateBlogV2()}
							unsavedChanges={unsavedChanges}
							revalidateBusy={revalidateBusy}
							revalidateMessage={revalidateMessage}
						/>
					) : (
						<ReviewChecklist />
					)}
				</div>
			</div>
		</div>
	);
}

function PerformanceInputCard({
	item,
	draft,
	onChange,
	onSave,
}: {
	item: PublishManagementItem;
	draft: Record<string, string>;
	onChange: (patch: Record<string, string>) => void;
	onSave: () => void;
}): JSX.Element {
	const metricFields: Array<{ key: string; label: string; placeholder: string }> = [
		{ key: 'impressions', label: '조회/노출', placeholder: '예: 1200' },
		{ key: 'clicks', label: '클릭', placeholder: '비어 있으면 UNKNOWN' },
		{ key: 'saves', label: '저장', placeholder: '비어 있으면 UNKNOWN' },
		{ key: 'shares', label: '공유', placeholder: '비어 있으면 UNKNOWN' },
		{ key: 'completion_rate', label: '완주율', placeholder: '플랫폼 제공값만 입력' },
		{ key: 'purchases', label: '구매', placeholder: '측정 불가면 비움' },
	];
	const hasAnyMetric = metricFields.some((field) => String(draft[field.key] || '').trim() !== '');
	return (
		<div style={{ border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 12, padding: 12, marginTop: 10 }}>
			<div style={css.between}>
				<div>
					<strong>성과 입력</strong>
					<div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>
						{normalizeChannel(item.channel)} · {item.publish_url || item.external_id || item.artifact_id}
					</div>
				</div>
				<Pill tone="#2563eb">source_type MANUAL</Pill>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
				<label style={{ display: 'grid', gap: 4, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
					측정일
					<input type="date" value={draft.metric_date || ''} onChange={(event) => onChange({ metric_date: event.target.value })} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
				</label>
				<label style={{ display: 'grid', gap: 4, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
					측정 시점
					<input type="datetime-local" value={draft.measured_at || ''} onChange={(event) => onChange({ measured_at: event.target.value })} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
				</label>
				<label style={{ display: 'grid', gap: 4, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
					Source reference
					<input value={draft.source_reference || ''} onChange={(event) => onChange({ source_reference: event.target.value })} placeholder="플랫폼 화면/URL/메모" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
				</label>
				{metricFields.map((field) => (
					<label key={field.key} style={{ display: 'grid', gap: 4, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
						{field.label}
						<input
							inputMode="decimal"
							value={draft[field.key] || ''}
							onChange={(event) => onChange({ [field.key]: event.target.value })}
							placeholder={field.placeholder}
							style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}
						/>
					</label>
				))}
			</div>
			<label style={{ display: 'grid', gap: 4, color: '#64748b', fontSize: 11, fontWeight: 800, marginTop: 8 }}>
				입력 메모
				<input value={draft.notes || ''} onChange={(event) => onChange({ notes: event.target.value })} placeholder="실제 플랫폼에서 확인한 기준을 적어주세요." style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
			</label>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginTop: 10 }}>
				<div style={{ color: '#64748b', fontSize: 11 }}>비워 둔 metric은 0이 아니라 UNKNOWN으로 lineage에 보존됩니다.</div>
				<button type="button" style={hasAnyMetric ? css.primaryButton : css.disabledButton} disabled={!hasAnyMetric} onClick={onSave}>성과 저장</button>
			</div>
		</div>
	);
}

function PublishPerformanceView({
	apiBaseUrl,
	data,
	setView,
	setSelectedId,
}: {
	apiBaseUrl?: string;
	data: ContentData;
	setView: (v: ViewKey) => void;
	setSelectedId: (id: string) => void;
}): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [message, setMessage] = React.useState('');
	const [publishDrafts, setPublishDrafts] = React.useState<Record<string, { url: string; externalId: string }>>({});
	const [performanceDrafts, setPerformanceDrafts] = React.useState<Record<string, Record<string, string>>>({});
	const cards = [
		{ key: 'READY_TO_PUBLISH', label: '게시 대기 (승인됨/URL 미연결)', tone: '#f59e0b' },
		{ key: 'PUBLISHED', label: '게시 완료', tone: '#16a34a' },
		{ key: 'WAITING_PERFORMANCE', label: '성과 대기', tone: '#64748b' },
		{ key: 'TRACKING', label: '성과 추적 중', tone: '#4f46e5' },
		{ key: 'LEGACY_GFA', label: 'Legacy GFA 보존', tone: '#94a3b8' },
	];
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
	const todayPublished = data.publishItems.filter((item) => item.published_at && String(item.published_at).startsWith(today)).length;
	const draftFor = (item: PublishManagementItem) => publishDrafts[item.artifact_id] || { url: item.publish_url || '', externalId: item.external_id || '' };
	const performanceDraftFor = (item: PublishManagementItem) => ({
		metric_date: today,
		impressions: '',
		clicks: '',
		saves: '',
		shares: '',
		completion_rate: '',
		purchases: '',
		source_reference: item.publish_url || '',
		measured_at: new Date().toISOString().slice(0, 16),
		notes: '',
		...(performanceDrafts[item.artifact_id] || {}),
	});
	const updatePublishDraft = (artifactId: string, patch: Partial<{ url: string; externalId: string }>) => {
		setPublishDrafts((prev) => ({
			...prev,
			[artifactId]: {
				url: patch.url ?? prev[artifactId]?.url ?? '',
				externalId: patch.externalId ?? prev[artifactId]?.externalId ?? '',
			},
		}));
	};
	const linkPublishUrl = async (item: PublishManagementItem) => {
		const draft = draftFor(item);
		const url = String(draft.url || '').trim();
		if (!url) {
			setMessage('게시 URL을 입력한 뒤 저장하세요.');
			return;
		}
		await axios.post(`${baseUrl}/content/publish-links`, {
			artifact_id: item.artifact_id,
			published_url: url,
			published_external_id: String(draft.externalId || '').trim() || undefined,
		});
		await data.reload();
		setMessage(`${item.artifact_id} 게시 URL을 저장했습니다.`);
	};
	const updatePerformanceDraft = (artifactId: string, patch: Record<string, string>) => {
		setPerformanceDrafts((prev) => ({
			...prev,
			[artifactId]: {
				...(prev[artifactId] || {}),
				...patch,
			},
		}));
	};
	const optionalNumber = (value: string): number | undefined => {
		const raw = String(value || '').trim();
		if (!raw) return undefined;
		const num = Number(raw);
		return Number.isFinite(num) ? num : undefined;
	};
	const savePerformance = async (item: PublishManagementItem) => {
		const draft = performanceDraftFor(item);
		const payload: Record<string, any> = {
			artifact_id: item.artifact_id,
			metric_date: draft.metric_date || today,
			extra_json: {
				source_type: 'MANUAL',
				source_reference: draft.source_reference || item.publish_url || item.external_id || item.artifact_id,
				source_url: item.publish_url || undefined,
				source_external_id: item.external_id || undefined,
				measured_at: draft.measured_at ? new Date(draft.measured_at).toISOString() : new Date().toISOString(),
				platform: item.channel,
				notes: draft.notes || undefined,
			},
		};
		(['impressions', 'clicks', 'saves', 'shares', 'completion_rate', 'purchases'] as const).forEach((key) => {
			const value = optionalNumber(draft[key] || '');
			if (value !== undefined) payload[key] = value;
		});
		await axios.post(`${baseUrl}/content/performance`, payload);
		await data.reload();
		setMessage(`${item.artifact_id} 성과를 저장했습니다. Learning 판정이 갱신됩니다.`);
	};
	const editArtifact = (item: PublishManagementItem) => {
		setSelectedId(item.artifact_id);
		setView('editor');
	};
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-publish-view">
			<StageHeader
				title="7~8. 게시 / 성과 분석"
				task="승인된 콘텐츠 중 아직 게시하지 않은 항목을 게시하고, 게시 후 성과 추적 상태를 확인하세요."
				changed={`게시 준비 ${numberLabel(data.publishCounts.READY_TO_PUBLISH || 0)}건 · 성과 추적 ${numberLabel(data.publishCounts.TRACKING || 0)}건`}
				reason="콘텐츠는 승인에서 끝나지 않고 게시 URL과 성과 추적까지 연결되어야 운영 자산이 됩니다."
				decision="게시 URL을 연결할지, 성과 대기/추적 항목을 확인할지 결정합니다."
				next="성과가 쌓이면 재활용·확장 단계에서 다른 채널 활용을 검토합니다."
			/>
			{message ? <div style={{ ...css.card, ...css.cardPad, color: '#0f766e', fontSize: 12, fontWeight: 900 }}>{message}</div> : null}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
				<ScopedMetric scope="현재" label="게시 대기" value={data.publishCounts.READY_TO_PUBLISH || 0} tone="#f59e0b" />
				<ScopedMetric scope="오늘" label="게시 완료" value={todayPublished} tone="#16a34a" />
				<ScopedMetric scope="누적" label="게시 완료" value={data.publishCounts.PUBLISHED || 0} tone="#10b981" />
				<ScopedMetric scope="현재" label="성과 연결 대기" value={data.publishCounts.WAITING_PERFORMANCE || 0} tone="#64748b" />
				<ScopedMetric scope="현재" label="성과 추적 중" value={data.publishCounts.TRACKING || 0} tone="#4f46e5" />
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
				{cards.map((card) => (
					<div key={card.key} style={{ ...css.card, ...css.cardPad }}>
						<div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>{card.label}</div>
						<div style={{ color: card.tone, fontSize: 24, fontWeight: 950, marginTop: 6 }}>{numberLabel(data.publishCounts[card.key] || 0)}</div>
					</div>
				))}
			</div>
			<section style={{ ...css.card, ...css.cardPad }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0 }}>게시·성과 운영표</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Content/SNS 게시 준비·게시본만 표시하며 GFA legacy는 KPI에서 분리합니다.</div>
					</div>
					<Pill tone="#7c3aed">PublishLink 기준</Pill>
				</div>
				<div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
					{data.publishItems.map((item) => (
						<div key={item.artifact_id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: item.publish_status === 'PUBLISHED' ? '#f0fdf4' : '#fff' }}>
							<div style={css.between}>
								<div>
									<strong>{item.title || item.artifact_id}</strong>
									<div style={{ color: '#64748b', fontSize: 12 }}>
										{normalizeChannel(item.channel)} · {item.artifact_id} · v{item.revision_no || 1} · SKU {item.sku_id || '-'}
									</div>
									<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
										왜 봐야 하나? {item.publish_status === 'PUBLISHED' ? '게시된 콘텐츠의 성과 추적 상태를 확인합니다.' : '승인된 콘텐츠에 게시 URL을 연결해야 성과 추적이 시작됩니다.'}
									</div>
								</div>
								<Pill tone={item.management_status === 'TRACKING' ? '#4f46e5' : item.publish_status === 'PUBLISHED' ? '#10b981' : '#f59e0b'}>
									{publishManagementStatusLabel(item.management_status)}
								</Pill>
							</div>
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10, marginTop: 12, color: '#334155', fontSize: 12 }}>
								<div><span style={{ color: '#64748b' }}>게시 링크</span><br />{item.publish_url ? <a href={item.publish_url} target="_blank" rel="noreferrer">열기</a> : '-'}</div>
								<div><span style={{ color: '#64748b' }}>외부 ID</span><br />{item.external_id || '-'}</div>
								<div><span style={{ color: '#64748b' }}>성과 상태</span><br />{performanceStatusLabel(item.performance_status)}</div>
								<div><span style={{ color: '#64748b' }}>성과 일자</span><br />{item.latest_performance_date || '-'}</div>
								<div><span style={{ color: '#64748b' }}>게시일</span><br />{item.published_at ? toKstLabel(item.published_at) : '-'}</div>
							</div>
							{item.management_status === 'READY_TO_PUBLISH' ? (
								<div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 2fr) minmax(180px, 1fr)', gap: 8, marginTop: 10 }}>
									<label style={{ display: 'grid', gap: 4, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
										게시 URL
										<input
											value={draftFor(item).url}
											onChange={(event) => updatePublishDraft(item.artifact_id, { url: event.target.value })}
											placeholder="https://..."
											style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}
										/>
									</label>
									<label style={{ display: 'grid', gap: 4, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
										외부 ID
										<input
											value={draftFor(item).externalId}
											onChange={(event) => updatePublishDraft(item.artifact_id, { externalId: event.target.value })}
											placeholder="선택 입력"
											style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}
										/>
									</label>
								</div>
							) : null}
							{item.management_status === 'WAITING_PERFORMANCE' ? (
								<PerformanceInputCard
									item={item}
									draft={performanceDraftFor(item)}
									onChange={(patch) => updatePerformanceDraft(item.artifact_id, patch)}
									onSave={() => void savePerformance(item)}
								/>
							) : null}
							<div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
								{item.management_status === 'READY_TO_PUBLISH' ? (
									<>
										<button type="button" style={css.primaryButton} onClick={() => void linkPublishUrl(item)}>게시 URL 연결</button>
										<button type="button" style={{ ...css.button, marginLeft: 8 }} onClick={() => editArtifact(item)}>수정·편집</button>
									</>
								) : item.management_status === 'TRACKING' ? (
									<button type="button" style={css.primaryButton} onClick={() => setView('learning')}>성과 기반 재활용 검토</button>
								) : item.management_status === 'WAITING_PERFORMANCE' ? (
									<button type="button" style={css.button} onClick={() => setView('learning')}>성과 계속 관찰</button>
								) : (
									<button type="button" style={css.button} onClick={() => editArtifact(item)}>수정·편집</button>
								)}
							</div>
						</div>
					))}
					{!data.loading && data.publishItems.length === 0 ? <EmptyState message="게시 관리 대상 콘텐츠가 없습니다." /> : null}
				</div>
			</section>
		</div>
	);
}

function LearningView({ data, setView }: { data: ContentData; setView: (v: ViewKey) => void }): JSX.Element {
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-learning-view">
			<StageHeader
				title="9. 재활용·확장"
				task="성과와 학습 판정을 바탕으로 추가 게시, 수정, 타 채널 활용 후보를 검토하세요."
				changed={`학습 판정 ${numberLabel(data.learningItems.length)}건 · 확대 후보 ${numberLabel(data.learningCounts.PROMOTE || 0)}건`}
				reason="잘된 콘텐츠를 한 번 쓰고 끝내지 않고 Blog/Shorts/GFA 등 다른 활용으로 연결하기 위한 단계입니다."
				decision="확대, 유지, 수정, 관찰 중 어떤 운영 판단을 할지 결정합니다."
				next="확대 후보는 다음 소구 선택 또는 콘텐츠 생성 단계로 다시 연결합니다."
			/>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
				<ScopedMetric scope="현재" label="성과 검토 대기" value={data.learningItems.filter((item) => item.learning_verdict === 'OBSERVE').length} tone="#64748b" />
				<ScopedMetric scope="현재" label="확대 추천" value={data.learningCounts.PROMOTE || 0} tone="#10b981" />
				<ScopedMetric scope="현재" label="수정 추천" value={data.learningCounts.REVISE || 0} tone="#dc2626" />
				<ScopedMetric scope="현재" label="관찰 중" value={data.learningCounts.OBSERVE || 0} tone="#64748b" />
			</div>
			<LearningStatus data={data} />
			<section style={{ ...css.card, ...css.cardPad }}>
				<h2 style={{ marginTop: 0 }}>학습·개선 Queue</h2>
				<div style={{ display: 'grid', gap: 10 }}>
					{data.learningItems.map((item) => (
						<div key={item.appeal_id} style={{ ...css.between, border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
							<div>
								<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
									<Pill tone={item.learning_verdict === 'PROMOTE' ? '#10b981' : item.learning_verdict === 'REVISE' ? '#f43f5e' : '#64748b'}>{verdictLabel(item.learning_verdict)}</Pill>
									<Pill tone="#64748b">{item.learning_verdict || 'OBSERVE'}</Pill>
									<strong>{item.label}</strong>
								</div>
								<div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>WHAT: SKU {item.sku_id} · 소구 성과 학습 판정</div>
								<div style={{ color: '#64748b', fontSize: 12 }}>WHY: {item.learning_verdict === 'PROMOTE' ? '성과 우수 후보로 타 채널 활용을 검토합니다.' : item.learning_verdict === 'REVISE' ? '성과 저조 또는 개선 필요 후보입니다.' : '판단 가능한 성과 데이터가 아직 부족합니다.'}</div>
								<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>Score {Math.round(item.overall_score || 0)} · Next: {verdictActionLabel(item.learning_verdict)}</div>
							</div>
							<div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
								<Pill tone={item.learning_verdict === 'PROMOTE' ? '#10b981' : item.learning_verdict === 'REVISE' ? '#f43f5e' : '#64748b'}>{verdictActionLabel(item.learning_verdict)}</Pill>
								{item.learning_verdict === 'PROMOTE' ? (
									<button type="button" style={css.primaryButton} onClick={() => setView('generation')}>확장 채널 선택</button>
								) : item.learning_verdict === 'REVISE' ? (
									<button type="button" style={css.button} onClick={() => setView('planning')}>수정·재기획</button>
								) : (
									<button type="button" style={css.button} onClick={() => setView('publish')}>성과 계속 관찰</button>
								)}
							</div>
						</div>
					))}
					{!data.loading && data.learningItems.length === 0 ? <EmptyState message="학습 판정 데이터가 없습니다." /> : null}
				</div>
			</section>
		</div>
	);
}

function ManualRunResult({ result }: { result: any }): JSX.Element | null {
	if (!result) return null;
	const job = result.job || {};
	const artifacts = result.result?.artifacts || job.detail?.artifacts || {};
	const plan = result.result?.plan || job.detail?.plan || {};
	const persistence = result.db_persistence || job.detail?.db_persistence || {};
	return (
		<div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
			<div style={css.between}>
				<strong>실행 결과</strong>
				<Pill tone={job.status === 'SUCCESS' ? '#10b981' : job.status === 'PARTIAL' ? '#f59e0b' : '#64748b'}>{pipelineStatusLabel(job.status || (result.ok ? 'SUCCESS' : 'CHECK'))}</Pill>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, fontSize: 12 }}>
				<div>기획 <strong>{plan.item_count ?? '-'}</strong></div>
				<div>시도 <strong>{artifacts.attempted ?? '-'}</strong></div>
				<div>생성 <strong>{artifacts.created ?? '-'}</strong></div>
				<div>재사용 <strong>{artifacts.reused ?? '-'}</strong></div>
				<div>실패 <strong>{artifacts.failed ?? '-'}</strong></div>
			</div>
			<div style={{ color: '#64748b', fontSize: 12 }}>
				검증: {pipelineStatusLabel(persistence.verification_status || '')} · {persistence.verification_reason || '사유 없음'} · 작업 {job.job_id || '-'}
			</div>
		</div>
	);
}

function absoluteAssetUrl(baseUrl: string, url?: string | null): string {
	const raw = String(url || '').trim();
	if (!raw) return '';
	if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
	return `${baseUrl}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function analysisSummary(asset: ContentAsset): string {
	const analysis = asset.analysis || {};
	const parts = [
		analysis.product_identity,
		analysis.package_visuals,
		analysis.usp,
		analysis.ingredients_or_components,
		analysis.usage_steps,
		analysis.proof_points,
		analysis.scene_types,
		analysis.product_angles,
		analysis.human_or_hand_actions,
		analysis.texture_or_material_cues,
		analysis.background_props,
		analysis.tone_keywords,
		analysis.mood_keywords,
		analysis.usable_banner_roles,
		analysis.banner_generation_uses,
		analysis.recognition_risks,
		analysis.compliance_risks,
		analysis.summary,
	]
		.map((value) => Array.isArray(value) ? value.join(', ') : String(value || '').trim())
		.filter(Boolean);
	return parts.join(' / ').slice(0, 280) || asset.error_message || '분석 결과 없음';
}

function parseLinkedSkuIds(value?: string | null): string[] {
	return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeProductInfoItems(info?: ProductInfo | null): Array<{ product_key: string; product_name: string; full_ingredients: string; note: string; ingredient_note: string; source_note: string }> {
	const items = Array.isArray(info?.product_items) ? info.product_items : [];
	const normalized = items.map((item, index) => ({
			product_key: String(item?.product_key || `product-${index + 1}`).trim(),
			product_name: String(item?.product_name || '').trim(),
			full_ingredients: String(item?.full_ingredients || '').trim(),
			note: String(item?.note || '').trim(),
			ingredient_note: String(item?.ingredient_note ?? (index === 0 ? info?.ingredient_note : '') ?? '').trim(),
			source_note: String(item?.source_note ?? (index === 0 ? info?.source_note : '') ?? '').trim(),
		}));
	if (normalized.length) return normalized;
	const legacy = String(info?.full_ingredients || '').trim();
	const legacyItem = {
		product_key: 'product-1',
		product_name: '',
		full_ingredients: legacy,
		note: '',
		ingredient_note: String(info?.ingredient_note || '').trim(),
		source_note: String(info?.source_note || '').trim(),
	};
	return legacy ? [legacyItem] : [{ product_key: 'product-1', product_name: '', full_ingredients: '', note: '', ingredient_note: '', source_note: '' }];
}

function productInfoItemsComplete(items: Array<{ product_name?: string; full_ingredients?: string; note?: string }>): boolean {
	return items.some((item) => String(item.product_name || '').trim() || String(item.full_ingredients || '').trim());
}

function normalizeProductNameKey(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function productInfoDocumentGroupId(skuId: string, item: { product_key?: string; product_name?: string; full_ingredients?: string; note?: string }, index: number): string {
	const source = String(item.product_key || item.product_name || item.note || `product-${index + 1}`).trim().toLowerCase();
	const normalized = source.replace(/\s+/g, '-').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
	return `ingredient_document:${skuId}:${normalized || `product-${index + 1}`}`;
}

function ProductInfoView({ apiBaseUrl, data }: { apiBaseUrl?: string; data: ContentData }): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [infos, setInfos] = React.useState<ProductInfo[]>([]);
	const [assets, setAssets] = React.useState<ContentAsset[]>([]);
	const [drafts, setDrafts] = React.useState<Record<string, ProductInfo>>({});
	const [activeProductIndexBySku, setActiveProductIndexBySku] = React.useState<Record<string, number>>({});
	const [filesBySku, setFilesBySku] = React.useState<Record<string, FileList | null>>({});
	const [search, setSearch] = React.useState('');
	const [loading, setLoading] = React.useState(false);
	const [busySku, setBusySku] = React.useState('');
	const [message, setMessage] = React.useState('');

	const load = React.useCallback(async () => {
		setLoading(true);
		try {
			const [infoRes, assetRes] = await Promise.all([
				axios.get(`${baseUrl}/content/product-info`),
				axios.get(`${baseUrl}/content/assets`, { params: { asset_type: 'ingredient_document' } }),
			]);
			const nextInfos: ProductInfo[] = infoRes.data?.items || [];
			setInfos(nextInfos);
			setAssets(assetRes.data?.items || []);
			setDrafts((prev) => {
				const next = { ...prev };
				nextInfos.forEach((item) => {
					if (!next[item.sku_id]) next[item.sku_id] = item;
				});
				return next;
			});
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '제품정보를 불러오지 못했습니다.'));
		} finally {
			setLoading(false);
		}
	}, [baseUrl]);

	React.useEffect(() => {
		void load();
	}, [load]);

	const infoBySku = React.useMemo(() => new Map(infos.map((info) => [info.sku_id, info])), [infos]);
	const assetsBySku = React.useMemo(() => {
		const map = new Map<string, ContentAsset[]>();
		assets.forEach((asset) => {
			map.set(asset.sku_id, [...(map.get(asset.sku_id) || []), asset]);
		});
		return map;
	}, [assets]);
	const normalizedSearch = search.trim().toLowerCase();
	const skuCards = data.skuScopes
		.filter((sku) => {
			if (!normalizedSearch) return true;
			return `${sku.sku_id} ${sku.title || ''} ${sku.product_url || ''} ${sku.product_group || ''}`.toLowerCase().includes(normalizedSearch);
		})
		.slice(0, 120);
	const completedCount = data.skuScopes.filter((sku) => {
		const saved = infoBySku.get(sku.sku_id);
		return Boolean(productInfoItemsComplete(normalizeProductInfoItems(saved)) || (assetsBySku.get(sku.sku_id) || []).length);
	}).length;
	const existingProductOptions = React.useMemo(() => {
		const map = new Map<string, { product_key: string; product_name: string; full_ingredients: string; note: string; ingredient_note: string; source_note: string; sku_id: string }>();
		infos.forEach((info) => {
			normalizeProductInfoItems(info).forEach((item) => {
				const key = normalizeProductNameKey(item.product_name);
				if (!key || map.has(key)) return;
				map.set(key, { ...item, sku_id: info.sku_id });
			});
		});
		return Array.from(map.values());
	}, [infos]);
	const existingProductByName = React.useMemo(() => {
		return new Map(existingProductOptions.map((item) => [normalizeProductNameKey(item.product_name), item]));
	}, [existingProductOptions]);

	const draftFor = (sku: SkuScope): ProductInfo => drafts[sku.sku_id] || infoBySku.get(sku.sku_id) || {
		sku_id: sku.sku_id,
		product_url: sku.product_url || '',
		full_ingredients: '',
		product_items: [{ product_key: 'product-1', product_name: '', full_ingredients: '', note: '', ingredient_note: '', source_note: '' }],
		ingredient_note: '',
		source_note: '',
	};
	const updateDraft = (sku: SkuScope, patch: Partial<ProductInfo>) => {
		setDrafts((prev) => ({ ...prev, [sku.sku_id]: { ...draftFor(sku), ...patch } }));
	};
	const updateProductItem = (sku: SkuScope, index: number, patch: Partial<{ product_key: string; product_name: string; full_ingredients: string; note: string; ingredient_note: string; source_note: string }>) => {
		const current = normalizeProductInfoItems(draftFor(sku));
		const next = current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
		updateDraft(sku, { product_items: next });
	};
	const changeProductName = (sku: SkuScope, index: number, value: string) => {
		const selected = existingProductByName.get(normalizeProductNameKey(value));
		if (!selected) {
			updateProductItem(sku, index, { product_name: value });
			return;
		}
		updateProductItem(sku, index, {
			product_name: selected.product_name,
			full_ingredients: selected.full_ingredients,
			note: selected.note,
			ingredient_note: selected.ingredient_note,
			source_note: selected.source_note,
		});
	};
	const addProductItem = (sku: SkuScope) => {
		const next = [...normalizeProductInfoItems(draftFor(sku)), { product_key: `product-${Date.now().toString(36)}`, product_name: '', full_ingredients: '', note: '', ingredient_note: '', source_note: '' }];
		updateDraft(sku, { product_items: next });
		setFilesBySku((prev) => ({ ...prev, [sku.sku_id]: null }));
		setActiveProductIndexBySku((prev) => ({ ...prev, [sku.sku_id]: next.length - 1 }));
	};
	const selectProductItem = (sku: SkuScope, index: number) => {
		setActiveProductIndexBySku((prev) => ({ ...prev, [sku.sku_id]: index }));
	};
	const removeProductItem = (sku: SkuScope, index: number) => {
		const next = normalizeProductInfoItems(draftFor(sku)).filter((_, itemIndex) => itemIndex !== index);
		updateDraft(sku, { product_items: next.length ? next : [{ product_key: 'product-1', product_name: '', full_ingredients: '', note: '', ingredient_note: '', source_note: '' }] });
		setActiveProductIndexBySku((prev) => ({ ...prev, [sku.sku_id]: Math.max(0, Math.min(index, (next.length || 1) - 1)) }));
	};
	const saveInfo = async (sku: SkuScope) => {
		const draft = draftFor(sku);
		const productItems = normalizeProductInfoItems(draft).filter((item) => item.product_name || item.full_ingredients || item.note);
		const firstItem = productItems[0];
		setBusySku(sku.sku_id);
		setMessage('');
		try {
			await axios.put(`${baseUrl}/content/product-info/${encodeURIComponent(sku.sku_id)}`, {
				product_url: sku.product_url || draft.product_url || '',
				product_items: productItems,
				full_ingredients: productItems.map((item) => `${item.product_name || '제품'}: ${item.full_ingredients || ''}`.trim()).filter(Boolean).join('\n\n'),
				ingredient_note: firstItem?.ingredient_note || '',
				source_note: firstItem?.source_note || '',
			});
			await load();
			setMessage(`${sku.title || sku.sku_id} 제품정보를 저장했습니다.`);
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '제품정보 저장에 실패했습니다.'));
		} finally {
			setBusySku('');
		}
	};
	const deleteSelectedProductItem = async (sku: SkuScope, index: number) => {
		const savedItems = normalizeProductInfoItems(infoBySku.get(sku.sku_id)).filter((item) => item.product_name || item.full_ingredients || item.note);
		const selected = normalizeProductInfoItems(draftFor(sku))[index];
		const selectedIsSaved = Boolean(selected && savedItems.some((item) => item.product_key === selected.product_key));
		if (!selected || !selectedIsSaved) return;
		const ok = window.confirm(`${selected.product_name || `제품 ${index + 1}`} 제품정보를 이 SKU에서 삭제할까요?`);
		if (!ok) return;
		const nextItems = normalizeProductInfoItems(draftFor(sku)).filter((_, itemIndex) => itemIndex !== index).filter((item) => item.product_name || item.full_ingredients || item.note);
		const firstItem = nextItems[0];
		setBusySku(sku.sku_id);
		setMessage('');
		try {
			const res = await axios.put(`${baseUrl}/content/product-info/${encodeURIComponent(sku.sku_id)}`, {
				product_url: sku.product_url || draftFor(sku).product_url || '',
				product_items: nextItems,
				full_ingredients: nextItems.map((item) => `${item.product_name || '제품'}: ${item.full_ingredients || ''}`.trim()).filter(Boolean).join('\n\n'),
				ingredient_note: firstItem?.ingredient_note || '',
				source_note: firstItem?.source_note || '',
			});
			setDrafts((prev) => ({ ...prev, [sku.sku_id]: res.data?.item || { ...draftFor(sku), product_items: nextItems } }));
			setActiveProductIndexBySku((prev) => ({ ...prev, [sku.sku_id]: Math.max(0, Math.min(index, (nextItems.length || 1) - 1)) }));
			setFilesBySku((prev) => ({ ...prev, [sku.sku_id]: null }));
			await load();
			setMessage(`${selected.product_name || sku.sku_id} 제품정보를 삭제했습니다.`);
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '제품정보 삭제에 실패했습니다.'));
		} finally {
			setBusySku('');
		}
	};
	const uploadDocuments = async (sku: SkuScope) => {
		const selected = Array.from(filesBySku[sku.sku_id] || []);
		if (!selected.length) {
			setMessage('업로드할 원료 자료 파일을 선택하세요.');
			return;
		}
		const productItems = normalizeProductInfoItems(draftFor(sku));
		const activeProductIndex = Math.max(0, Math.min(activeProductIndexBySku[sku.sku_id] ?? 0, productItems.length - 1));
		const activeProduct = productItems[activeProductIndex] || { product_key: `product-${activeProductIndex + 1}`, product_name: '', full_ingredients: '', note: '', ingredient_note: '', source_note: '' };
		const documentGroupId = productInfoDocumentGroupId(sku.sku_id, activeProduct, activeProductIndex);
		setBusySku(sku.sku_id);
		setMessage('');
		const failed: string[] = [];
		try {
			for (const file of selected) {
				const form = new FormData();
				form.append('sku_id', sku.sku_id);
				form.append('asset_type', 'ingredient_document');
				form.append('product_url', sku.product_url || '');
				form.append('asset_group_id', documentGroupId);
				form.append('group_name', activeProduct.product_name || `제품 ${activeProductIndex + 1}`);
				form.append('category', 'ingredient_document');
				form.append('file', file);
				try {
					await axios.post(`${baseUrl}/content/assets/upload`, form);
				} catch (error: any) {
					failed.push(`${file.name}: ${String(error?.response?.data?.detail || error?.message || '업로드 실패')}`);
				}
			}
			setFilesBySku((prev) => ({ ...prev, [sku.sku_id]: null }));
			await load();
			setMessage(failed.length ? `업로드 일부 실패 ${failed.length}개: ${failed.slice(0, 2).join(' / ')}` : `${selected.length}개 원료 자료를 업로드했습니다.`);
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '원료 자료 업로드에 실패했습니다.'));
		} finally {
			setBusySku('');
		}
	};
	const deleteAsset = async (asset: ContentAsset) => {
		const ok = window.confirm(`${asset.original_filename || asset.filename} 자료를 삭제할까요?`);
		if (!ok) return;
		setBusySku(asset.sku_id);
		try {
			await axios.delete(`${baseUrl}/content/assets/${asset.asset_id}`);
			await load();
			setMessage('원료 자료를 삭제했습니다.');
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '삭제에 실패했습니다.'));
		} finally {
			setBusySku('');
		}
	};

	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-product-info-view">
			<StageHeader
				title="분석 > 제품정보"
				task="SKU별 전성분과 원료 관련 근거 자료를 관리합니다."
				changed={`제품정보 입력 ${numberLabel(completedCount)}/${numberLabel(data.skuScopes.length)} SKU`}
				reason="콘텐츠 작성/검수 시 제품 성분과 원료 근거를 SKU별로 분리해 참조하기 위함입니다."
				decision="각 SKU의 전성분 텍스트와 원료 자료 파일이 최신인지 확인합니다."
				next="저장된 제품정보는 이후 콘텐츠 생성 컨텍스트에 연결할 수 있습니다."
				stats={[
					{ label: '전성분/자료 보유', value: `${completedCount}/${data.skuScopes.length}`, tone: '#0f766e' },
					{ label: '원료자료 파일', value: assets.length, tone: '#7c3aed' },
				]}
			/>
			<section style={{ ...css.card, ...css.cardPad }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0 }}>SKU별 제품정보 입력</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>제품 이미지 업로드 화면과 동일하게 SKU 카드별로 전성분과 원료 자료를 관리합니다.</div>
					</div>
					<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명/SKU/URL 검색" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12, width: 260 }} />
				</div>
				{message ? <div style={{ color: message.includes('실패') ? '#dc2626' : '#0f766e', fontSize: 12, fontWeight: 900, marginTop: 10 }}>{message}</div> : null}
				<div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
					{skuCards.map((sku) => {
						const draft = draftFor(sku);
						const productItems = normalizeProductInfoItems(draft);
						const activeProductIndex = Math.max(0, Math.min(activeProductIndexBySku[sku.sku_id] ?? 0, productItems.length - 1));
						const activeProduct = productItems[activeProductIndex] || { product_key: `product-${activeProductIndex + 1}`, product_name: '', full_ingredients: '', note: '', ingredient_note: '', source_note: '' };
						const rows = assetsBySku.get(sku.sku_id) || [];
						const savedProductItems = normalizeProductInfoItems(infoBySku.get(sku.sku_id)).filter((item) => item.product_name || item.full_ingredients || item.note);
						const isSavedProductSelected = savedProductItems.some((item) => item.product_key === activeProduct.product_key);
						const documentGroupId = productInfoDocumentGroupId(sku.sku_id, activeProduct, activeProductIndex);
						const visibleRows = rows.filter((asset) => asset.asset_group_id === documentGroupId || (!asset.asset_group_id && activeProductIndex === 0));
						const busy = busySku === sku.sku_id;
						return (
							<div key={sku.sku_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.9fr) minmax(0, 1.8fr)', gap: 12, border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: '#fff' }}>
								<div>
									<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
										<Pill tone={sku.phase1_enabled ? '#10b981' : '#64748b'}>{sku.phase1_enabled ? '콘텐츠 대상' : '비활성/대기'}</Pill>
										<strong>{sku.title || sku.sku_id}</strong>
									</div>
									<div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>SKU {sku.sku_id}</div>
									<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>{sku.product_url || '상품 URL 없음'}</div>
									<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
										<Pill tone={productInfoItemsComplete(productItems) ? '#0f766e' : '#94a3b8'}>{productInfoItemsComplete(productItems) ? `제품 ${productItems.filter((item) => item.product_name || item.full_ingredients).length}개 입력` : '제품/전성분 미입력'}</Pill>
										<Pill tone={rows.length ? '#7c3aed' : '#94a3b8'}>자료 {rows.length}개</Pill>
									</div>
								</div>
								<div style={{ display: 'grid', gap: 10 }}>
									<div style={{ display: 'grid', gap: 8, border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, background: '#f8fafc' }}>
										<div style={css.between}>
											<div>
												<strong style={{ fontSize: 13 }}>SKU 구성 제품</strong>
												<div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>1팩/2팩/5팩/11팩처럼 패키지만 다른 SKU도 실제 구성 제품 기준으로 입력합니다.</div>
											</div>
											<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
												<button type="button" style={css.button} onClick={() => addProductItem(sku)}>제품 추가</button>
												<button type="button" style={busy || !isSavedProductSelected ? css.disabledButton : css.button} disabled={busy || !isSavedProductSelected} onClick={() => void deleteSelectedProductItem(sku, activeProductIndex)}>제품 삭제</button>
											</div>
										</div>
										<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
											{productItems.map((item, index) => {
												const active = index === activeProductIndex;
												const label = item.product_name || (item.full_ingredients ? `제품 ${index + 1}` : `신규 제품 ${index + 1}`);
												return (
													<button key={index} type="button" style={active ? css.primaryButton : css.button} onClick={() => selectProductItem(sku, index)}>
														{label}
													</button>
												);
											})}
										</div>
										<div style={{ display: 'grid', gap: 8, border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, background: '#fff' }}>
											<div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 0.7fr) minmax(0, 1.4fr) auto', gap: 8, alignItems: 'end' }}>
												<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 900 }}>
													제품명
													<input
														value={activeProduct.product_name}
														list={`product-info-existing-products-${sku.sku_id}-${activeProductIndex}`}
														onChange={(event) => changeProductName(sku, activeProductIndex, event.target.value)}
														placeholder={`예: A제품 / 염색약 ${activeProductIndex + 1}`}
														style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}
													/>
													<datalist id={`product-info-existing-products-${sku.sku_id}-${activeProductIndex}`}>
														{existingProductOptions.map((item) => (
															<option key={`${item.sku_id}-${item.product_key}-${item.product_name}`} value={item.product_name} label={`${item.sku_id}${item.note ? ` · ${item.note}` : ''}`} />
														))}
													</datalist>
													<span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>기존 제품을 선택하면 전성분/메모/출처가 복사되고, 새 제품명은 그대로 직접 입력할 수 있습니다.</span>
												</label>
												<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 900 }}>
													제품별 메모
													<input value={activeProduct.note} onChange={(event) => updateProductItem(sku, activeProductIndex, { note: event.target.value })} placeholder="예: 1제, 2제, 헤어팩, 오일 등" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
												</label>
												<button type="button" style={productItems.length <= 1 ? css.disabledButton : css.button} disabled={productItems.length <= 1} onClick={() => removeProductItem(sku, activeProductIndex)}>삭제</button>
											</div>
											<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 900 }}>
												{activeProduct.product_name ? `${activeProduct.product_name} 전성분` : '전성분'}
												<textarea value={activeProduct.full_ingredients} onChange={(event) => updateProductItem(sku, activeProductIndex, { full_ingredients: event.target.value })} placeholder="예: 정제수, 글리세린, ..." style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: 10, minHeight: 90, resize: 'vertical', fontSize: 12, lineHeight: 1.5 }} />
											</label>
										</div>
									</div>
									<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
										<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 900 }}>
											{activeProduct.product_name ? `${activeProduct.product_name} 원료/성분 메모` : '원료/성분 메모'}
											<input value={activeProduct.ingredient_note || ''} onChange={(event) => updateProductItem(sku, activeProductIndex, { ingredient_note: event.target.value })} placeholder="예: 핵심 원료, 주의 표현, 원산지 등" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
										</label>
										<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 900 }}>
											{activeProduct.product_name ? `${activeProduct.product_name} 자료 출처 메모` : '자료 출처 메모'}
											<input value={activeProduct.source_note || ''} onChange={(event) => updateProductItem(sku, activeProductIndex, { source_note: event.target.value })} placeholder="예: 패키지 라벨, 공급사 원료표" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
										</label>
									</div>
									<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
										<button type="button" style={busy ? css.disabledButton : css.primaryButton} disabled={busy} onClick={() => void saveInfo(sku)}>{busy ? '저장 중...' : '제품정보 저장'}</button>
										<input key={`${sku.sku_id}-${documentGroupId}`} type="file" multiple onChange={(event) => setFilesBySku((prev) => ({ ...prev, [sku.sku_id]: event.target.files }))} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '7px 10px', background: '#fff', fontSize: 12 }} />
										<button type="button" style={busy ? css.disabledButton : css.button} disabled={busy} onClick={() => void uploadDocuments(sku)}>원료 자료 업로드</button>
									</div>
									<div style={{ display: 'grid', gridTemplateColumns: visibleRows.length ? 'repeat(auto-fill, minmax(170px, 1fr))' : '1fr', gap: 10 }}>
										{visibleRows.map((asset) => {
											const url = absoluteAssetUrl(baseUrl, asset.file_url);
											const extLabel = String(asset.original_filename || asset.filename || 'file').split('.').pop()?.slice(0, 8).toUpperCase() || 'FILE';
											return (
												<div key={asset.asset_id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, background: '#f8fafc' }}>
													{String(asset.mime_type || '').startsWith('image/') ? (
														<img src={url} alt={asset.original_filename || asset.filename} style={{ width: '100%', height: 110, objectFit: 'contain', background: '#fff', borderRadius: 10, border: '1px solid #f1f5f9' }} />
													) : (
														<div style={{ height: 110, display: 'grid', placeItems: 'center', background: '#fff', borderRadius: 10, color: '#64748b', fontSize: 12, fontWeight: 900 }}>{extLabel}</div>
													)}
													<div style={{ color: '#0f172a', fontSize: 12, fontWeight: 900, marginTop: 8 }}>{asset.original_filename || asset.filename}</div>
													<div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{toKstLabel(asset.created_at)}</div>
													<div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
														<a href={url} target="_blank" rel="noreferrer" style={{ ...css.button, textDecoration: 'none', display: 'inline-block' }}>원본 보기</a>
														<button type="button" style={css.button} onClick={() => void deleteAsset(asset)}>삭제</button>
													</div>
												</div>
											);
										})}
										{visibleRows.length === 0 ? <EmptyState message={loading ? '원료 자료를 불러오는 중입니다.' : `${activeProduct.product_name || `제품 ${activeProductIndex + 1}`}에 등록된 원료 자료가 없습니다.`} /> : null}
									</div>
								</div>
							</div>
						);
					})}
					{!data.loading && skuCards.length === 0 ? <EmptyState message="표시할 SKU가 없습니다." /> : null}
				</div>
			</section>
		</div>
	);
}

function ContentAssetUploadView({ apiBaseUrl, data, assetType }: { apiBaseUrl?: string; data: ContentData; assetType: 'product_image' | 'detail_page' | 'reference_media' }): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const isProductImage = assetType === 'product_image';
	const isReferenceMedia = assetType === 'reference_media';
	const assetLabel = isProductImage ? '제품 이미지' : isReferenceMedia ? '참고 소재' : '상세페이지';
	const [skuId, setSkuId] = React.useState('');
	const [assetGroupId, setAssetGroupId] = React.useState('');
	const [groupName, setGroupName] = React.useState('');
	const [category, setCategory] = React.useState('');
	const [keywords, setKeywords] = React.useState('');
	const [linkedSkuIds, setLinkedSkuIds] = React.useState<string[]>([]);
	const [search, setSearch] = React.useState('');
	const [files, setFiles] = React.useState<FileList | null>(null);
	const [assets, setAssets] = React.useState<ContentAsset[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [uploading, setUploading] = React.useState(false);
	const [batchRunning, setBatchRunning] = React.useState(false);
	const [selectedAssetIds, setSelectedAssetIds] = React.useState<string[]>([]);
	const [message, setMessage] = React.useState('');
	const selectedSku = data.skuScopes.find((item) => item.sku_id === skuId) || data.skuScopes[0] || null;
	React.useEffect(() => {
		if (!skuId && data.skuScopes[0]?.sku_id) setSkuId(data.skuScopes[0].sku_id);
	}, [data.skuScopes, skuId]);
	const loadAssets = React.useCallback(async () => {
		setLoading(true);
		try {
			const res = await axios.get(`${baseUrl}/content/assets`, { params: { asset_type: assetType } });
			const items = res.data?.items || [];
			setAssets(items);
			if (assetType === 'reference_media') {
				const first = items.find((item: ContentAsset) => item.asset_group_id);
				if (first && !assetGroupId) {
					setAssetGroupId(first.asset_group_id || '');
					setGroupName(first.group_name || '');
					setCategory(first.category || '');
					setKeywords(first.keywords || '');
					setLinkedSkuIds(parseLinkedSkuIds(first.sku_ids));
				}
			}
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '업로드 자산을 불러오지 못했습니다.'));
		} finally {
			setLoading(false);
		}
	}, [assetGroupId, assetType, baseUrl]);
	React.useEffect(() => {
		void loadAssets();
	}, [loadAssets]);
	const uploadFiles = async () => {
		if (!isReferenceMedia && !skuId) {
			setMessage('SKU를 먼저 선택하세요.');
			return;
		}
		if (isReferenceMedia && !category.trim() && !keywords.trim()) {
			setMessage('참고 소재 그룹의 카테고리 또는 키워드를 입력하세요.');
			return;
		}
		if (!files || files.length === 0) {
			setMessage('업로드할 파일을 선택하세요.');
			return;
		}
		setUploading(true);
		setMessage('');
		const selectedFiles = Array.from(files);
		const succeeded: string[] = [];
		const failed: string[] = [];
		try {
			for (const file of selectedFiles) {
				const form = new FormData();
				form.append('sku_id', isReferenceMedia ? '' : skuId);
				form.append('asset_type', assetType);
				form.append('product_url', isReferenceMedia ? '' : selectedSku?.product_url || '');
				if (isReferenceMedia) {
					form.append('asset_group_id', assetGroupId);
					form.append('group_name', groupName);
					form.append('category', category);
					form.append('keywords', keywords);
					form.append('sku_ids', linkedSkuIds.join(','));
				}
				form.append('file', file);
				try {
					const fileIndex = selectedFiles.indexOf(file) + 1;
					await axios.post(`${baseUrl}/content/assets/upload`, form, {
						onUploadProgress: (event) => {
							const pct = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
							setMessage(`업로드 중 ${fileIndex}/${selectedFiles.length}: ${file.name}${pct ? ` ${pct}%` : ''}`);
						},
					});
					succeeded.push(file.name);
				} catch (error: any) {
					const reason = String(error?.response?.data?.detail || error?.message || '업로드 실패');
					failed.push(`${file.name}: ${reason}`);
				}
			}
			await loadAssets();
			if (failed.length) {
				setMessage(`업로드 완료 ${succeeded.length}/${selectedFiles.length}. 실패 ${failed.length}개: ${failed.slice(0, 3).join(' / ')}`);
			} else {
				setMessage(`${succeeded.length}개 파일을 제한 없이 순차 저장했습니다.`);
			}
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '업로드에 실패했습니다.'));
		} finally {
			setUploading(false);
		}
	};
	const makePrimary = async (asset: ContentAsset) => {
		await axios.post(`${baseUrl}/content/assets/${asset.asset_id}/primary`);
		await loadAssets();
		setMessage('대표 이미지를 변경했습니다.');
	};
	const saveReferenceGroup = async () => {
		if (!isReferenceMedia || !assetGroupId) {
			setMessage('수정할 참고 소재 그룹을 먼저 선택하세요.');
			return;
		}
		try {
			await axios.patch(`${baseUrl}/content/assets/reference-media-groups/${encodeURIComponent(assetGroupId)}`, {
				group_name: groupName,
				category,
				keywords,
				sku_ids: linkedSkuIds,
			});
			await loadAssets();
			setMessage(`그룹 SKU 연결을 저장했습니다. 연결 SKU ${linkedSkuIds.length}개`);
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '그룹 정보 저장에 실패했습니다.'));
		}
	};
	const analyze = async (asset: ContentAsset) => {
		setMessage(`${assetLabel} AI 분석 중입니다...`);
		try {
			const res = await axios.post(`${baseUrl}/content/assets/${asset.asset_id}/analyze`);
			await loadAssets();
			setMessage(res.data?.ok ? `${assetLabel} 분석을 저장했습니다.` : `분석 보류/실패: ${res.data?.detail || '-'}`);
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '분석에 실패했습니다.'));
		}
	};
	const deleteAsset = async (asset: ContentAsset) => {
		const ok = window.confirm(`${asset.original_filename || asset.filename} 자산을 삭제할까요?`);
		if (!ok) return;
		await axios.delete(`${baseUrl}/content/assets/${asset.asset_id}`);
		await loadAssets();
		setMessage('자산을 삭제했습니다.');
	};
	const normalizedSearch = search.trim().toLowerCase();
	const skuCards = (isReferenceMedia
		? Array.from(
				new Map(
					assets.map((asset) => {
						const key = asset.asset_group_id || asset.sku_id;
						return [
							key,
							{
								sku_id: key,
								title: asset.group_name || asset.category || key,
								product_url: [asset.category, asset.keywords].filter(Boolean).join(' · '),
								product_group: asset.category || '',
								sku_ids: asset.sku_ids || '',
								phase1_enabled: true,
								is_active: true,
							} as SkuScope,
						];
					}),
				).values(),
			)
		: data.skuScopes)
		.filter((sku) => {
			if (!normalizedSearch) return true;
			return `${sku.sku_id} ${sku.title || ''} ${sku.product_url || ''} ${sku.product_group || ''}`.toLowerCase().includes(normalizedSearch);
		})
		.slice(0, 80);
	const assetsBySku = new Map<string, ContentAsset[]>();
	assets.forEach((asset) => {
		const key = isReferenceMedia ? asset.asset_group_id || asset.sku_id : asset.sku_id;
		assetsBySku.set(key, [...(assetsBySku.get(key) || []), asset]);
	});
	const visibleAssets = skuCards.flatMap((sku) => assetsBySku.get(sku.sku_id) || []);
	const visibleAssetIds = visibleAssets.map((asset) => asset.asset_id);
	const selectedSet = new Set(selectedAssetIds);
	const selectedAssets = assets.filter((asset) => selectedSet.has(asset.asset_id));
	React.useEffect(() => {
		const alive = new Set(assets.map((asset) => asset.asset_id));
		setSelectedAssetIds((prev) => prev.filter((id) => alive.has(id)));
	}, [assets]);
	const toggleAsset = (assetId: string, checked: boolean) => {
		setSelectedAssetIds((prev) => {
			const next = new Set(prev);
			if (checked) next.add(assetId);
			else next.delete(assetId);
			return Array.from(next);
		});
	};
	const selectAllVisible = () => {
		setSelectedAssetIds((prev) => Array.from(new Set([...prev, ...visibleAssetIds])));
	};
	const clearSelected = () => setSelectedAssetIds([]);
	const batchAnalyze = async () => {
		const targets = selectedAssets.filter((asset) => asset.asset_type === 'detail_page' || asset.asset_type === 'reference_media');
		if (!targets.length) {
			setMessage('AI 분석할 상세페이지 또는 참고 소재를 선택하세요.');
			return;
		}
		setBatchRunning(true);
		try {
			for (const asset of targets) {
				await axios.post(`${baseUrl}/content/assets/${asset.asset_id}/analyze`);
			}
			await loadAssets();
			setMessage(`${targets.length}개 ${assetLabel} AI 분석 요청을 완료했습니다.`);
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '일괄 AI 분석에 실패했습니다.'));
		} finally {
			setBatchRunning(false);
		}
	};
	const batchDelete = async () => {
		if (!selectedAssets.length) {
			setMessage('삭제할 이미지를 선택하세요.');
			return;
		}
		const ok = window.confirm(`선택한 ${selectedAssets.length}개 자산을 삭제할까요?`);
		if (!ok) return;
		setBatchRunning(true);
		try {
			for (const asset of selectedAssets) {
				await axios.delete(`${baseUrl}/content/assets/${asset.asset_id}`);
			}
			clearSelected();
			await loadAssets();
			setMessage(`${selectedAssets.length}개 자산을 삭제했습니다.`);
		} catch (error: any) {
			setMessage(String(error?.response?.data?.detail || error?.message || '일괄 삭제에 실패했습니다.'));
		} finally {
			setBatchRunning(false);
		}
	};
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid={isProductImage ? 'content-product-image-assets-view' : isReferenceMedia ? 'content-reference-media-assets-view' : 'content-detail-page-assets-view'}>
			<StageHeader
				title={isProductImage ? '분석 > 제품 이미지 업로드' : isReferenceMedia ? '분석 > 참고 소재 업로드' : '분석 > 상세페이지 업로드'}
				task={isProductImage ? 'SKU별 제품/패키지 이미지를 여러 장 저장하고 콘텐츠 이미지 생성의 1차 reference로 사용합니다.' : isReferenceMedia ? '촬영 이미지/영상에서 장면, 구도, 손동작, 질감, 배경 요소를 분석해 광고 배너의 참고 소재 row로 사용합니다.' : 'SKU별 상세페이지 이미지를 저장하고 AI 분석 요약을 콘텐츠 글 작성 context에 반영합니다.'}
				changed={`${assetLabel} ${numberLabel(assets.length)}개 등록`}
				reason={isProductImage ? '콘텐츠 이미지 생성에서 제품 reference는 이 메뉴에 업로드 등록된 이미지만 사용합니다.' : isReferenceMedia ? '제품 정보가 부족할 때도 다양한 촬영 장면과 실제 소재 요소를 생성 엔진이 참고할 수 있게 하기 위함입니다.' : '상세페이지의 USP, 사용법, 금지 표현, 장면 힌트를 매번 수동 입력하지 않기 위함입니다.'}
				decision="어떤 SKU에 어떤 자료를 기준 자산으로 둘지 선택합니다."
				next={isProductImage ? '업로드 등록 이미지가 없는 SKU는 제품 reference 없이 콘텐츠 이미지를 생성합니다.' : isReferenceMedia ? '분석 완료 참고 소재는 배너 생성 prompt와 이미지 reference 후보에 들어갑니다.' : '분석 완료된 상세페이지 요약이 콘텐츠 생성 prompt에 들어갑니다.'}
			/>
			<section style={{ ...css.card, ...css.cardPad, border: '1px solid #bfdbfe', background: '#eff6ff' }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0, fontSize: 15, fontWeight: 950 }}>{assetLabel} 등록</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>SKU 선택 후 파일 개수 제한 없이 여러 파일을 한 번에 업로드할 수 있습니다.</div>
					</div>
					<Pill tone={isProductImage ? '#2563eb' : isReferenceMedia ? '#f97316' : '#7c3aed'}>{isProductImage ? 'Image Reference 1순위' : isReferenceMedia ? 'Creative Reference Row' : 'Writer Context'}</Pill>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: isReferenceMedia ? '1fr 1fr 1.2fr 1.2fr auto' : '1.1fr 1.3fr auto', gap: 10, marginTop: 12, alignItems: 'end' }}>
					{isReferenceMedia ? (
						<>
							<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
								그룹명
								<input value={groupName} onChange={(event) => { setGroupName(event.target.value); setAssetGroupId(''); }} placeholder="예: 헤나 염색 사용 장면" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
							</label>
							<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
								카테고리
								<input value={category} onChange={(event) => { setCategory(event.target.value); setAssetGroupId(''); }} placeholder="예: 헤나/새치염색" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
							</label>
							<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
								키워드
								<input value={keywords} onChange={(event) => { setKeywords(event.target.value); setAssetGroupId(''); }} placeholder="예: 식물성, 셀프염색, 모발케어" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }} />
							</label>
						</>
					) : (
						<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
							SKU
							<select value={skuId} onChange={(event) => setSkuId(event.target.value)} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}>
								{data.skuScopes.map((sku) => (
									<option key={sku.sku_id} value={sku.sku_id}>{sku.title || sku.sku_id} · {sku.sku_id}</option>
								))}
							</select>
						</label>
					)}
					<label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 11, fontWeight: 800 }}>
						파일 선택
						<input type="file" multiple accept={isProductImage ? 'image/*' : isReferenceMedia ? 'image/*,video/*,.mp4,.m4v,.mov,.webm,.avi,.wmv,.mkv,.mpeg,.mpg,.3gp' : 'image/*,.pdf'} onChange={(event) => setFiles(event.target.files)} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '7px 10px', background: '#fff', fontSize: 12 }} />
					</label>
					<button type="button" style={uploading ? css.disabledButton : css.primaryButton} disabled={uploading} onClick={() => void uploadFiles()}>
						{uploading ? '업로드 중...' : `${assetLabel} 추가`}
					</button>
				</div>
				{isReferenceMedia ? (
					<div style={{ marginTop: 12, border: '1px solid #dbeafe', borderRadius: 12, background: '#fff', padding: 10 }}>
						<div style={{ ...css.between, alignItems: 'center' }}>
							<div style={{ color: '#334155', fontSize: 12, fontWeight: 950 }}>그룹 연결 SKU {linkedSkuIds.length}개</div>
							<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
								<button type="button" style={css.button} onClick={() => setLinkedSkuIds(data.skuScopes.map((sku) => sku.sku_id))}>전체선택</button>
								<button type="button" style={css.button} onClick={() => setLinkedSkuIds([])}>전체해제</button>
								<button type="button" style={!assetGroupId ? css.disabledButton : css.primaryButton} disabled={!assetGroupId} onClick={() => void saveReferenceGroup()}>그룹 정보 저장</button>
							</div>
						</div>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginTop: 10, maxHeight: 180, overflow: 'auto' }}>
							{data.skuScopes.map((sku) => {
								const checked = linkedSkuIds.includes(sku.sku_id);
								return (
									<label key={sku.sku_id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: '1px solid #e2e8f0', borderRadius: 10, padding: 8, fontSize: 11, color: '#334155', background: checked ? '#eff6ff' : '#fff' }}>
										<input
											type="checkbox"
											checked={checked}
											onChange={(event) => setLinkedSkuIds((prev) => event.target.checked ? Array.from(new Set([...prev, sku.sku_id])) : prev.filter((id) => id !== sku.sku_id))}
										/>
										<span><b>{sku.title || sku.sku_id}</b><br /><span style={{ color: '#64748b' }}>{sku.sku_id}</span></span>
									</label>
								);
							})}
						</div>
					</div>
				) : null}
				{message ? <div style={{ color: message.includes('실패') ? '#dc2626' : '#0f766e', fontSize: 12, fontWeight: 900, marginTop: 10 }}>{message}</div> : null}
			</section>
			<section style={{ ...css.card, ...css.cardPad }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0 }}>{isReferenceMedia ? '그룹별 등록 자산' : 'SKU별 등록 자산'}</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{isReferenceMedia ? '카테고리/키워드 그룹 기준으로 참고 소재를 확인합니다.' : '내 상품 추적 화면처럼 SKU 카드 기준으로 자료를 확인합니다.'}</div>
					</div>
					<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isReferenceMedia ? '그룹명/카테고리/키워드 검색' : '상품명/SKU/URL 검색'} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 10px', fontSize: 12, width: 260 }} />
				</div>
				{!isProductImage ? (
					<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, background: '#f8fafc' }}>
						<Pill tone={selectedAssets.length ? '#2563eb' : '#64748b'}>선택 {selectedAssets.length}개</Pill>
						<button type="button" style={css.button} onClick={selectAllVisible}>모두선택</button>
						<button type="button" style={css.button} onClick={clearSelected}>모두해제</button>
						<button type="button" style={batchRunning || selectedAssets.length === 0 ? css.disabledButton : css.primaryButton} disabled={batchRunning || selectedAssets.length === 0} onClick={() => void batchAnalyze()}>
							{batchRunning ? '처리 중...' : '선택 AI 분석'}
						</button>
						<button type="button" style={batchRunning || selectedAssets.length === 0 ? css.disabledButton : css.button} disabled={batchRunning || selectedAssets.length === 0} onClick={() => void batchDelete()}>
							선택 삭제
						</button>
					</div>
				) : null}
				<div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
					{skuCards.map((sku) => {
						const rows = assetsBySku.get(sku.sku_id) || [];
						const firstAsset = rows[0];
						const linkedIds = isReferenceMedia ? parseLinkedSkuIds(firstAsset?.sku_ids) : [];
						const linkedLabels = linkedIds.map((id) => {
							const found = data.skuScopes.find((item) => item.sku_id === id);
							return found ? `${found.title || id} · ${id}` : id;
						});
						return (
							<div key={sku.sku_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.8fr) minmax(0, 1.6fr)', gap: 12, border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, background: rows.length ? '#fff' : '#f8fafc' }}>
								<div>
									<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
										<Pill tone={sku.phase1_enabled ? '#10b981' : '#64748b'}>{sku.phase1_enabled ? '콘텐츠 대상' : '비활성/대기'}</Pill>
										<strong>{sku.title || sku.sku_id}</strong>
									</div>
									<div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>{isReferenceMedia ? `그룹 ${sku.sku_id}` : `SKU ${sku.sku_id}`}</div>
									<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>{sku.product_url || (isReferenceMedia ? '카테고리/키워드 없음' : '상품 URL 없음')}</div>
									{isReferenceMedia ? (
										<div style={{ color: '#64748b', fontSize: 11, marginTop: 6, display: 'grid', gap: 4 }}>
											<div>연결 SKU {linkedIds.length}개</div>
											{linkedLabels.length ? (
												<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
													{linkedLabels.slice(0, 4).map((label) => (
														<span key={label} style={{ border: '1px solid #dbeafe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '3px 7px', fontSize: 10, fontWeight: 800 }}>{label}</span>
													))}
													{linkedLabels.length > 4 ? <span style={{ color: '#94a3b8', fontSize: 10, alignSelf: 'center' }}>+{linkedLabels.length - 4}개</span> : null}
												</div>
											) : <div style={{ color: '#94a3b8' }}>연결된 SKU 없음</div>}
										</div>
									) : null}
									<button
										type="button"
										style={{ ...css.button, marginTop: 10 }}
										onClick={() => {
											if (isReferenceMedia) {
												setAssetGroupId(sku.sku_id);
												setGroupName(sku.title || '');
												setCategory(sku.product_group || '');
												setKeywords(String(sku.product_url || '').split(' · ').slice(1).join(', '));
												setLinkedSkuIds(parseLinkedSkuIds(firstAsset?.sku_ids));
											} else {
												setSkuId(sku.sku_id);
											}
										}}
									>
										{isReferenceMedia ? '이 그룹에 업로드' : '이 SKU에 업로드'}
									</button>
								</div>
								<div style={{ display: 'grid', gridTemplateColumns: rows.length ? 'repeat(auto-fill, minmax(170px, 1fr))' : '1fr', gap: 10 }}>
									{rows.map((asset) => {
										const url = absoluteAssetUrl(baseUrl, asset.file_url);
										return (
											<div key={asset.asset_id} style={{ border: asset.is_primary ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: 12, padding: 10, background: '#fff' }}>
												{!isProductImage ? (
													<label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#334155', fontSize: 11, fontWeight: 900, marginBottom: 8 }}>
														<input type="checkbox" checked={selectedSet.has(asset.asset_id)} onChange={(event) => toggleAsset(asset.asset_id, event.target.checked)} />
														선택
													</label>
												) : null}
												{String(asset.mime_type || '').startsWith('image/') ? (
													<img src={url} alt={asset.original_filename || asset.filename} style={{ width: '100%', height: 120, objectFit: 'contain', background: '#f8fafc', borderRadius: 10, border: '1px solid #f1f5f9' }} />
												) : String(asset.mime_type || '').startsWith('video/') ? (
													<video src={url} controls muted style={{ width: '100%', height: 120, objectFit: 'contain', background: '#0f172a', borderRadius: 10, border: '1px solid #f1f5f9' }} />
												) : (
													<div style={{ height: 120, display: 'grid', placeItems: 'center', background: '#f8fafc', borderRadius: 10, color: '#64748b', fontSize: 12, fontWeight: 900 }}>PDF</div>
												)}
												<div style={{ color: '#0f172a', fontSize: 12, fontWeight: 900, marginTop: 8 }}>{asset.original_filename || asset.filename}</div>
												<div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{asset.is_primary ? '대표 자산' : '등록 자산'} · {asset.analysis_status || '-'}</div>
												<div style={{ color: '#475569', fontSize: 11, lineHeight: 1.45, marginTop: 6 }}>{analysisSummary(asset)}</div>
												{asset.analysis ? (
													<details style={{ marginTop: 6 }}>
														<summary style={{ color: '#2563eb', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>분석 전체 보기</summary>
														<pre style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 8, color: '#334155', fontSize: 10, lineHeight: 1.45 }}>{JSON.stringify(asset.analysis, null, 2)}</pre>
													</details>
												) : null}
												<div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
													{isProductImage ? <button type="button" style={asset.is_primary ? css.disabledButton : css.button} disabled={asset.is_primary} onClick={() => void makePrimary(asset)}>{asset.is_primary ? '대표' : '대표 지정'}</button> : null}
													<button type="button" style={css.button} onClick={() => void analyze(asset)}>AI 분석</button>
													<a href={url} target="_blank" rel="noreferrer" style={{ ...css.button, textDecoration: 'none', display: 'inline-block' }}>원본 보기</a>
													<button type="button" style={css.button} onClick={() => void deleteAsset(asset)}>삭제</button>
												</div>
											</div>
										);
									})}
									{rows.length === 0 ? <EmptyState message={loading ? '업로드 자료를 불러오는 중입니다.' : '이 SKU에 등록된 자료가 없습니다.'} /> : null}
								</div>
							</div>
						);
					})}
					{!data.loading && skuCards.length === 0 ? <EmptyState message={isReferenceMedia ? '등록된 참고 소재 그룹이 없습니다.' : '표시할 SKU가 없습니다.'} /> : null}
				</div>
			</section>
		</div>
	);
}

function SettingsView({ apiBaseUrl, data }: { apiBaseUrl?: string; data: ContentData }): JSX.Element {
	const baseUrl = apiBaseUrl || 'http://localhost:5189';
	const [running, setRunning] = React.useState(false);
	const [runError, setRunError] = React.useState('');
	const [runResult, setRunResult] = React.useState<any>(null);
	const task = data.contentDailyTask;
	const latest = task?.latest_job;
	const runNow = React.useCallback(async () => {
		const ok = window.confirm(
			[
				'AI 콘텐츠 Daily Job을 지금 실행합니다.',
				'',
				'오늘 데이터 기준으로 인사이트 → 소구 → 기획 → 콘텐츠를 갱신합니다.',
				'기존 콘텐츠는 중복 방지 정책에 따라 재사용되며 수정본/게시본은 변경하지 않습니다.',
			].join('\n'),
		);
		if (!ok) return;
		setRunning(true);
		setRunError('');
		setRunResult(null);
		try {
			const res = await axios.post(`${baseUrl}/collection/tasks/content_insight_daily/run`, { mode: 'manual' });
			setRunResult(res.data);
			await data.reload();
		} catch (e: any) {
			setRunError(String(e?.response?.data?.detail || e?.message || 'Daily Job 실행에 실패했습니다.'));
		} finally {
			setRunning(false);
		}
	}, [baseUrl, data]);
	return (
		<div style={{ display: 'grid', gap: 16 }} data-testid="content-settings-view">
			<StageHeader
				title="1. 데이터 수집"
				task="오늘 수집에서 문제가 있는 원천 데이터가 있는지 확인하세요."
				changed={`수집 준비 ${sourceStatusSummary(data).ready}/${sourceStatusSummary(data).total} · 최근 완료 ${toKstLabel(latest?.finished_at)}`}
				reason="수집은 증분 append이고, 운영 분석은 오늘 포함 최근 6개월 전체를 다시 분석합니다."
				decision="수집 상태가 정상인지 확인하고 필요하면 지금 실행합니다."
				next="수집이 준비되면 분석 결과 단계에서 새 Insight를 확인합니다."
				stats={[
					{ label: '자동 실행', value: task?.schedule_enabled ? '켜짐' : '꺼짐', tone: task?.schedule_enabled ? '#10b981' : '#94a3b8' },
					{ label: '최근 실행', value: pipelineStatusLabel(latest?.status || ''), tone: latest?.status === 'SUCCESS' ? '#10b981' : '#f59e0b' },
				]}
			/>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
				<ScopedMetric scope="현재" label="자동 운영 분석" value={task?.schedule_enabled ? 'ON' : 'OFF'} tone={task?.schedule_enabled ? '#10b981' : '#94a3b8'} />
				<ScopedMetric scope="현재" label="다음 실행 시각" value={`매일 ${task?.schedule_time || '07:20'} KST`} tone="#2563eb" />
				<ScopedMetric scope="최근 6개월" label="분석 범위" value="최근 6개월 + 오늘" tone="#7c3aed" />
				<ScopedMetric scope="현재" label="운영 SKU 활성/전체" value={`${data.skuScopes.filter((item) => item.phase1_enabled).length}/${data.skuScopes.length}`} tone="#0f766e" />
			</div>
			<section style={{ ...css.card, ...css.cardPad }}>
				<div style={css.between}>
					<div>
						<h2 style={{ margin: 0 }}>콘텐츠 자동 생성</h2>
						<div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>자동 실행은 매일 07:20 KST, 수동 실행은 동일 공식 실행 경로를 즉시 실행합니다.</div>
					</div>
					<Pill tone={task?.schedule_enabled ? '#10b981' : '#94a3b8'}>자동 실행 {task?.schedule_enabled ? '켜짐' : '꺼짐'}</Pill>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
					<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
						<div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>실행 시간</div>
						<strong>매일 {task?.schedule_time || '07:20'}</strong>
					</div>
					<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
						<div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>Timezone</div>
						<strong>Asia/Seoul</strong>
					</div>
					<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
						<div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>최근 실행</div>
						<strong>{latest?.status ? pipelineStatusLabel(latest.status) : '이력 없음'}</strong>
					</div>
					<div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 12 }}>
						<div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>실행 방식</div>
						<strong>{runModeLabel(latest?.run_mode)}</strong>
					</div>
				</div>
				<div style={{ ...css.between, marginTop: 14 }}>
					<div style={{ color: '#64748b', fontSize: 12 }}>
						최근 완료: {toKstLabel(latest?.finished_at)} · Job {latest?.job_id || '-'}
					</div>
					<button type="button" style={running ? css.disabledButton : css.primaryButton} disabled={running} onClick={runNow}>
						{running ? '실행 중...' : '지금 실행'}
					</button>
				</div>
				{runError ? <div style={{ color: '#dc2626', fontSize: 12, fontWeight: 800, marginTop: 10 }}>{runError}</div> : null}
				<div style={{ marginTop: 12 }}>
					<ManualRunResult result={runResult} />
				</div>
			</section>
			<section style={{ ...css.card, ...css.cardPad }}>
				<div style={css.between}>
					<h2 style={{ margin: 0 }}>운영 SKU Scope</h2>
					<Pill tone="#2563eb">Phase 1 {data.skuScopes.filter((item) => item.phase1_enabled).length}개</Pill>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
					{data.skuScopes.map((item) => (
						<div key={item.sku_id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, background: item.phase1_enabled ? '#eff6ff' : '#fff' }}>
							<div style={css.between}>
								<strong>{item.title || item.sku_id}</strong>
								<Pill tone={item.phase1_enabled ? '#2563eb' : '#94a3b8'}>{item.phase1_enabled ? '1차 활성' : '후속'}</Pill>
							</div>
							<div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>WHAT: 운영 분석 대상 SKU · {item.product_group || '-'}</div>
							<div style={{ color: '#64748b', fontSize: 12 }}>STATUS: {item.phase1_enabled ? '분석 활성' : '비활성/후속'} · SKU {item.sku_id}</div>
							<div style={{ color: '#64748b', fontSize: 12 }}>NEXT: {item.phase1_enabled ? '매일 운영 분석에 포함' : '필요 시 Phase 1 활성 검토'}</div>
							<div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>{item.product_url || '-'}</div>
						</div>
					))}
					{!data.loading && data.skuScopes.length === 0 ? <EmptyState message="SKU Scope 데이터가 없습니다." /> : null}
				</div>
			</section>
			<section style={{ ...css.card, ...css.cardPad }}>
				<h2 style={{ marginTop: 0 }}>현재 미지원 운영 집계</h2>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
					<Pill tone="#64748b">직접 성과 요약 API 대기</Pill>
					<Pill tone="#64748b">게시 링크 목록 API 대기</Pill>
					<Pill tone="#64748b">블로그/SNS 성과 수집기 미진행</Pill>
				</div>
			</section>
		</div>
	);
}

export function ContentCenterReactView({ apiBaseUrl, initialTab }: Props): JSX.Element {
	const navigate = useNavigate();
	const view = React.useMemo<ViewKey>(() => viewFromInitialTab(initialTab), [initialTab]);
	const goView = React.useCallback((nextView: ViewKey) => {
		navigate(pathForView(nextView));
	}, [navigate]);
	const [selectedArtifactId, setSelectedArtifactId] = React.useState('');
	const data = useContentCenterData(apiBaseUrl);
	React.useEffect(() => {
		if (!selectedArtifactId && data.artifacts[0]?.artifact_id) {
			setSelectedArtifactId(data.artifacts[0].artifact_id);
		}
	}, [data.artifacts, selectedArtifactId]);
	return (
		<div style={css.root} data-testid="content-center-react">
			<header style={css.header}>
				<div>
					<h1 style={css.title}>AI 콘텐츠 센터</h1>
					<div style={css.subtitle}>오늘은 상황판, 나머지는 운영자가 처리할 업무 순서대로 이어지는 Workbench입니다.</div>
				</div>
				<button type="button" style={view === 'dashboard' ? css.primaryButton : css.button} onClick={() => goView('dashboard')}>오늘 할 일 / 상황판</button>
			</header>
			{view !== 'dashboard' ? <WorkflowStepper data={data} view={view} setView={goView} /> : null}
			{view === 'dashboard' ? <TodayDashboard apiBaseUrl={apiBaseUrl} data={data} setView={goView} /> : null}
			{view === 'insights' ? <InsightsView data={data} setView={goView} /> : null}
			{view === 'productInfo' ? <ProductInfoView apiBaseUrl={apiBaseUrl} data={data} /> : null}
			{view === 'productImages' ? <ContentAssetUploadView apiBaseUrl={apiBaseUrl} data={data} assetType="product_image" /> : null}
			{view === 'detailPages' ? <ContentAssetUploadView apiBaseUrl={apiBaseUrl} data={data} assetType="detail_page" /> : null}
			{view === 'referenceMedia' ? <ContentAssetUploadView apiBaseUrl={apiBaseUrl} data={data} assetType="reference_media" /> : null}
			{view === 'appeals' ? <AppealsView apiBaseUrl={apiBaseUrl} data={data} setView={goView} setSelectedId={setSelectedArtifactId} /> : null}
			{view === 'planning' ? <PlanningView data={data} setView={goView} setSelectedId={setSelectedArtifactId} /> : null}
			{view === 'generation' ? <ContentGenerationView apiBaseUrl={apiBaseUrl} data={data} setView={goView} setSelectedId={setSelectedArtifactId} /> : null}
			{view === 'editor' ? <ContentEditorView apiBaseUrl={apiBaseUrl} data={data} selectedId={selectedArtifactId} setSelectedId={setSelectedArtifactId} setView={goView} /> : null}
			{view === 'publish' ? <PublishPerformanceView apiBaseUrl={apiBaseUrl} data={data} setView={goView} setSelectedId={setSelectedArtifactId} /> : null}
			{view === 'learning' ? <LearningView data={data} setView={goView} /> : null}
			{view === 'settings' ? <SettingsView apiBaseUrl={apiBaseUrl} data={data} /> : null}
		</div>
	);
}

export default ContentCenterReactView;
