import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useMaybeAuth } from '../auth/AuthProvider';
import { getHostSetupDownloads } from '../layout/hostSetupDownloads';
import { buildErp2ClientIpHeaders, discoverNasHostCdpIp } from '../layout/hostCdpClient';
import { REQUIRED_HOST_AGENT_MANAGE_NO, REQUIRED_HOST_AGENT_VERSION } from '../hostAgentRelease';

const HOST_AGENT_LOCAL_ORIGIN = 'http://127.0.0.1:9230';
const HOST_AGENT_START_PROTOCOL_URL = 'erp2-analytics-host-agent://start';
const HOST_AGENT_BRIDGE_MESSAGE_TYPE = 'erp2-analytics-host-agent-bridge';
const COLLECTOR_BRIDGE_TIMEOUT_MS = 15000;
const HOST_AGENT_FETCH_TIMEOUT_MS = 12_000;
const HOST_AGENT_AUTO_UPDATE_COOLDOWN_MS = 30 * 60 * 1000;
const HOST_AGENT_AUTO_UPDATE_KEY_PREFIX = 'analytics:host-agent:auto-update-attempt';
const COLLECTOR_TASK_PROGRESS_KEY = 'analytics:collector:task-progress:v1';
const COLLECTOR_DEVICE_ID_KEY = 'analytics:collector:device-id:v1';
const COLLECTION_DATA_CHANGED_EVENT = 'erp2-analytics:collection-data-changed';
const COLLECTION_DATA_CHANGED_STORAGE_KEY = 'erp2-analytics.collectionDataChangedAt';

type CollectionJob = {
	job_id: string;
	task_id: string;
	run_mode: string;
	source_type: string;
	status: string;
	target_date?: string | null;
	date_from?: string | null;
	date_to?: string | null;
	rows_written?: number | null;
	detail?: any;
	error?: string | null;
	started_at?: string | null;
	finished_at?: string | null;
};

type CollectionTask = {
	task_id: string;
	label: string;
	domain: string;
	source_type: string;
	provider?: string | null;
	preferred_runtime?: string | null;
	fallback_runtime?: string | null;
	requires_installed_collector?: boolean;
	target_tables: string[];
	enabled: boolean;
	schedule_enabled: boolean;
	schedule_time?: string | null;
	description?: string | null;
	runnable: boolean;
	supports_retry_incomplete?: boolean;
	latest_job?: CollectionJob | null;
	latest_success_job?: CollectionJob | null;
	pending_collection?: {
		date_from?: string | null;
		date_to?: string | null;
		missing_date_count?: number | null;
		missing_segments?: Array<[string, string]> | string[][] | null;
		lookback_days?: number | null;
		missing_unit_summary?: Record<string, { missing_date_count?: number | null; missing_segments?: Array<[string, string]> | string[][] | null }> | null;
		non_operating_unit_summary?: {
			service_name?: string | null;
			reference_from?: string | null;
			units?: Record<
				string,
				{
					raw_date_from?: string | null;
					raw_date_to?: string | null;
					raw_day_count?: number | null;
					non_operating_date_count?: number | null;
					non_operating_segments?: Array<[string, string]> | string[][] | null;
					reason?: string | null;
				}
			> | null;
		} | null;
		has_pending?: boolean | null;
		expected_search_keyword_count?: number | null;
		collected_search_keyword_count?: number | null;
		expected_keyword_count?: number | null;
		collected_keyword_count?: number | null;
		missing_keyword_count?: number | null;
		exposed_keyword_count?: number | null;
	} | null;
};

type CollectionTasksResponse = {
	ok: boolean;
	tasks: CollectionTask[];
	coverage?: Record<string, Array<{ table: string; rows: number; min_date?: string | null; max_date?: string | null; error?: string }>>;
	serverTime?: string;
};

type CollectionJobsResponse = {
	ok: boolean;
	jobs: CollectionJob[];
};

type CollectionJobEvent = {
	event_id?: string | null;
	job_id?: string | null;
	status?: string | null;
	detail?: {
		collector_event?: CollectorEvent | null;
	} | null;
	created_at?: string | null;
};

type CollectorStatus = {
	running?: boolean;
	state?: string;
	agentReachable?: boolean;
	apiBaseUrl?: string;
	deviceId?: string;
	jobId?: string;
	url?: string;
	reason?: string;
	attempt?: number;
	progress?: number;
	total?: number;
	keyword?: string;
	condition?: string;
	error?: string;
	updated_at?: string;
	healthTime?: string;
	checkedAt?: string;
	agentVersion?: string;
	agentManageNo?: string;
	collectorVersion?: string;
	collectorManageNo?: string;
	chromeUserDataDir?: string;
	chromeProfileDir?: string;
	chromeProfileLabel?: string;
};

type CollectorEvent = {
	job_id?: string | null;
	device_id?: string | null;
	url?: string | null;
	status?: string | null;
	note?: string | null;
	time?: string | null;
};

function collectorEventTimeMs(event?: CollectorEvent | null): number {
	const raw = String(event?.time || '').trim();
	const ms = raw ? new Date(raw).getTime() : 0;
	return Number.isFinite(ms) ? ms : 0;
}

function collectorEventFromJobEvent(event?: CollectionJobEvent | null): CollectorEvent | null {
	const collectorEvent = event?.detail?.collector_event || null;
	if (!collectorEvent || typeof collectorEvent !== 'object') return null;
	return collectorEvent;
}

type CollectorJobPublic = {
	job_id?: string | null;
	status?: string | null;
	mode?: string | null;
	target_date?: string | null;
	date_from?: string | null;
	date_to?: string | null;
	params?: {
		plan?: {
			retry?: boolean | null;
			retry_scope?: string | null;
			retry_unit_count?: number | null;
			retry_cell_count?: number | null;
		} | null;
		resume_skipped_keywords?: number | null;
		pending_plan_keywords?: number | null;
		total_plan_keywords?: number | null;
		total_targets?: number | null;
		completed_offset?: number | null;
		selected_targets?: number | null;
	} | null;
	created_by_device_id?: string | null;
	claimed_by?: string | null;
	results_count?: number | null;
	error?: string | null;
	last_event?: CollectorEvent | null;
	retry_count?: number | null;
};

type AdRankRetryPreview = {
	target_date?: string | null;
	retry_cell_count?: number | null;
	retry_unit_count?: number | null;
};

type TaskProgress = {
	collectorJobId?: string | null;
	collectorJob?: CollectorJobPublic | null;
	message?: string | null;
	createdAt?: number;
};

function readStoredTaskProgress(): Record<string, TaskProgress> {
	try {
		const raw = window.localStorage.getItem(COLLECTOR_TASK_PROGRESS_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed as Record<string, TaskProgress>;
	} catch {
		return {};
	}
}

function writeStoredTaskProgress(progress: Record<string, TaskProgress>): void {
	try {
		window.localStorage.setItem(COLLECTOR_TASK_PROGRESS_KEY, JSON.stringify(progress || {}));
	} catch {
		// ignore storage failures
	}
}

function getOrCreateCollectorDeviceId(): string {
	try {
		const existing = String(window.localStorage.getItem(COLLECTOR_DEVICE_ID_KEY) || '').trim();
		if (existing) return existing;
		const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		const host = String(window.location.hostname || 'unknown').replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 48);
		const next = `settings-data-collection:${host}:${rand}`.slice(0, 120);
		window.localStorage.setItem(COLLECTOR_DEVICE_ID_KEY, next);
		return next;
	} catch {
		return `settings-data-collection:ephemeral:${Date.now().toString(36)}`;
	}
}

function getCollectorWorkerDeviceId(): string {
	try {
		const host = String(window.location.hostname || 'unknown').replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 48);
		return `settings-data-collection:${host}`.slice(0, 80);
	} catch {
		return 'settings-data-collection';
	}
}

const sourceLabel: Record<string, string> = {
	server_api: 'NAS API',
	server_batch: 'NAS 배치',
	host_cdp: 'Collector PC/CDP',
	manual_import: '수동 업로드',
};

const runtimeLabel: Record<string, string> = {
	nas: 'NAS 단독',
	collector_pc: '24시간 PC Collector',
	web_manual: '웹 수동',
};

const activeCollectionStatuses = new Set(['STARTED', 'RUNNING', 'POLLING', 'QUEUED', 'CLAIMED']);

function normalizeManageNo(value: unknown): string {
	return String(value ?? '').replace(/[^0-9A-Za-z_.:-]+/g, '').trim();
}

const manualImportItems = [
	{ name: '순위 엑셀 업로드', current: '내 상품 추적 상세', plan: 'OpenAPI/CDP 순위 수집 안정화 후 복구용으로 축소' },
	{ name: '광고 검색어 보고서 업로드', current: '광고 검색어 분석', plan: 'SearchAd API 수집 우선, 누락 보정용 업로드로 유지' },
	{ name: '광고 소재 보고서 업로드', current: '소재 분석', plan: 'SearchAd API 또는 리포트 API로 자동화 검토' },
	{ name: 'GFA 성과보고서 업로드', current: '설정 > 데이터 수집', plan: 'Collector 작업 실패/누락 시 복구용 업로드로 유지' },
	{ name: '구매 키워드 엑셀 업로드', current: '구매 키워드 분석', plan: 'Commerce/Bizdata API 수집 우선, 파일은 예외 복구용' },
	{ name: '스마트스토어 리뷰 파일 업로드', current: '리뷰 분석', plan: 'Collector PC/CDP 리뷰 수집으로 단계적 대체' },
	{ name: '카테고리 사전 업로드', current: '설정 > 카테고리 사전', plan: '운영 기준 데이터라 유지, 자동 수집 대상 아님' },
];

function errToMsg(e: any): string {
	const detail = e?.response?.data?.detail;
	if (detail && typeof detail === 'object') {
		const msg = String(detail.message || detail.error || e?.response?.data?.message || '요청 실패');
		const remaining = Number(detail.remaining_seconds || 0);
		const wait =
			remaining > 0
				? `\n남은 대기 시간: ${Math.ceil(remaining / 3600)}시간 이내 (${Math.ceil(remaining / 60)}분)`
				: '';
		const cache = detail.cache_guidance ? `\n조치: ${String(detail.cache_guidance)}` : '';
		return `${msg}${wait}${cache}`;
	}
	return String(detail ?? e?.response?.data?.message ?? e?.message ?? e ?? '요청 실패');
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = HOST_AGENT_FETCH_TIMEOUT_MS): Promise<Response> {
	const controller = new AbortController();
	const timer = window.setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
	} finally {
		window.clearTimeout(timer);
	}
}

async function waitForHostAgentVersion(expectedVersion: string, expectedManageNo: string, timeoutMs = 25_000): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const res = await fetchWithTimeout(`${HOST_AGENT_LOCAL_ORIGIN}/health`, { cache: 'no-store' }, 2500);
			const data = await res.json().catch(() => ({} as any));
			const version = String(data?.agentVersion || data?.version || '').trim();
			const manageNo = String(data?.agentManageNo || data?.manageNo || '').trim();
			if (res.ok && version === expectedVersion && manageNo === expectedManageNo) return true;
		} catch {
			// Agent may be restarting during self-update.
		}
		await new Promise((resolve) => window.setTimeout(resolve, 1500));
	}
	return false;
}

async function canReachHostAgentLocally(timeoutMs = 2500): Promise<boolean> {
	try {
		const res = await fetchWithTimeout(`${HOST_AGENT_LOCAL_ORIGIN}/health`, { cache: 'no-store' }, timeoutMs);
		return res.ok;
	} catch {
		return false;
	}
}

function autoUpdateStorageKey(accessMode: string): string {
	return `${HOST_AGENT_AUTO_UPDATE_KEY_PREFIX}:${accessMode}:${REQUIRED_HOST_AGENT_MANAGE_NO}`;
}

function canAttemptHostAgentAutoUpdate(accessMode: string): boolean {
	try {
		const raw = window.localStorage.getItem(autoUpdateStorageKey(accessMode));
		const last = Number(raw || 0);
		if (Number.isFinite(last) && last > 0 && Date.now() - last < HOST_AGENT_AUTO_UPDATE_COOLDOWN_MS) return false;
	} catch {
		// ignore storage failures
	}
	return true;
}

function markHostAgentAutoUpdateAttempt(accessMode: string): void {
	try {
		window.localStorage.setItem(autoUpdateStorageKey(accessMode), String(Date.now()));
	} catch {
		// ignore storage failures
	}
}

function clearHostAgentAutoUpdateAttempt(accessMode: string): void {
	try {
		window.localStorage.removeItem(autoUpdateStorageKey(accessMode));
	} catch {
		// ignore storage failures
	}
}

function absoluteApiBaseUrl(apiBaseUrl: string): string {
	try {
		return new URL(String(apiBaseUrl || '').trim() || '/', window.location.origin).toString().replace(/\/$/, '');
	} catch {
		return String(apiBaseUrl || '').trim().replace(/\/$/, '');
	}
}

function isLocalHostName(hostname: string): boolean {
	const h = String(hostname || '').trim().toLowerCase();
	return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function detectAccessMode(apiBaseUrl: string): 'local' | 'nas' | 'unknown' {
	try {
		const pageHost = window.location.hostname;
		const apiHost = new URL(absoluteApiBaseUrl(apiBaseUrl), window.location.origin).hostname;
		if (isLocalHostName(pageHost) || isLocalHostName(apiHost)) return 'local';
		return 'nas';
	} catch {
		return 'unknown';
	}
}

function getNasApiHost(apiBaseUrl: string): string | null {
	try {
		const host = new URL(absoluteApiBaseUrl(apiBaseUrl), window.location.origin).hostname;
		if (!host || isLocalHostName(host)) return null;
		return host;
	} catch {
		return null;
	}
}

type BadgeTone = 'ok' | 'warn' | 'danger' | 'muted';

function badgeStyle(tone: BadgeTone): React.CSSProperties {
	const colors = {
		ok: ['#dcfce7', '#166534'],
		warn: ['#fef3c7', '#92400e'],
		danger: ['#fee2e2', '#991b1b'],
		muted: ['#e5e7eb', '#374151'],
	} as const;
	return {
		display: 'inline-flex',
		alignItems: 'center',
		borderRadius: 999,
		padding: '3px 8px',
		fontSize: 12,
		fontWeight: 800,
		background: colors[tone][0],
		color: colors[tone][1],
		whiteSpace: 'nowrap',
	};
}

function statusTone(status?: string | null): BadgeTone {
	const s = String(status || '').toUpperCase();
	if (['SUCCESS', 'DONE'].includes(s)) return 'ok';
	if (['STARTED', 'QUEUED', 'CLAIMED', 'UPLOADING', 'WAITING_USER'].includes(s)) return 'warn';
	if (['FAILED', 'PARTIAL'].includes(s)) return 'danger';
	if (s === 'CANCELLED') return 'muted';
	return 'muted';
}

function isTerminalCollectorStatus(status?: string | null): boolean {
	// SKIPPED: scheduler marked stuck collector jobs so later schedules can continue.
	// Treat as terminal or the UI keeps "백그라운드 진행 중" + 중단 버튼 forever.
	return ['DONE', 'SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED', 'SKIPPED'].includes(String(status || '').toUpperCase());
}

function formatCollectorNote(note?: string | null, maxLength = 220): string {
	const normalized = String(note || '').replace(/\s+/g, ' ').trim();
	if (!normalized) return '-';
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function collectorProgressMessage(job?: CollectorJobPublic | null, event?: CollectorEvent | null, local?: CollectorStatus | null): string {
	const status = String(job?.status || event?.status || '').toUpperCase();
	const note = formatCollectorNote(event?.note || job?.error || '', 220);
	if (status === 'QUEUED') return '대기열에 등록됨. Collector PC가 작업을 가져가길 기다리는 중입니다.';
	if (status === 'CLAIMED') return 'Collector가 작업을 가져갔습니다. Chrome/CDP에서 수집을 실행 중입니다.';
	if (status === 'WAITING_USER') {
		if (/login_required/i.test(note)) return '로그인 화면을 감지했습니다. Collector가 자동 로그인 클릭을 시도하거나 사용자 조치를 기다리는 중입니다.';
		if (/login_auto_click/i.test(note)) return `로그인 자동 처리 중: ${note}`;
		return note !== '-' ? `사용자 조치 필요: ${note}` : '사용자 조치가 필요합니다.';
	}
	if (status === 'FAILED') return note !== '-' ? `실패: ${note}` : '실패했습니다. 최근 이벤트를 확인하세요.';
	if (status === 'PARTIAL') return note !== '-' ? `부분 완료: ${note}` : '일부만 완료되었습니다.';
	if (status === 'CANCELLED') return '사용자 요청으로 중단했습니다.';
	if (status === 'DONE' || status === 'SUCCESS') return '완료되었습니다.';
	if (local?.running && local?.state) return `Collector 상태: ${local.state}${local.reason ? ` · ${local.reason}` : ''}`;
	return '상태 확인 중입니다.';
}

type CollectionProgressCount = { current: number; total: number; remaining: number; label: string; remainingLabel: string };

function formatProgressCount(current: number, total: number): CollectionProgressCount | null {
	if (!Number.isFinite(current) || !Number.isFinite(total) || current < 0 || total <= 0 || current > total) return null;
	const width = Math.max(4, String(Math.trunc(total)).length);
	const fmt = (value: number) => String(Math.max(0, Math.trunc(value))).padStart(width, '0');
	const remaining = Math.max(0, total - current);
	return { current, total, remaining, label: `${fmt(current)}/${fmt(total)}`, remainingLabel: fmt(remaining) };
}

function formatProgressDisplay(progress: CollectionProgressCount, prefix = '진행'): string {
	return progress.remaining > 0 ? `${prefix} ${progress.label} · 남은 ${progress.remainingLabel}` : `${prefix} ${progress.label}`;
}

function isRetryIncompleteCollectorJob(job?: CollectorJobPublic | null, event?: CollectorEvent | null, local?: CollectorStatus | null): boolean {
	const plan = job?.params?.plan || null;
	if (plan?.retry === true || String(plan?.retry_scope || '').toLowerCase() === 'incomplete') return true;
	const raw = [event?.note, job?.last_event?.note, local?.reason, local?.condition]
		.map((value) => String(value || '').toLowerCase())
		.filter(Boolean)
		.join(' ');
	return raw.includes('(retry)') || raw.includes('retry_incomplete') || raw.includes('retry_incomplete_cells');
}

function collectorProgressCount(job?: CollectorJobPublic | null, event?: CollectorEvent | null, local?: CollectorStatus | null): CollectionProgressCount | null {
	const localCurrent = Number(local?.progress || 0);
	const localTotal = Number(local?.total || 0);
	if (Number.isFinite(localCurrent) && Number.isFinite(localTotal) && localCurrent >= 0 && localTotal > 0) {
		return formatProgressCount(localCurrent, localTotal);
	}
	const raw = [
		event?.note,
		job?.last_event?.note,
		job?.error,
	]
		.map((value) => String(value || '').trim())
		.filter(Boolean)
		.join(' ');
	const match = raw.match(/(?:^|[\s:])(\d{1,7})\s*\/\s*(\d{1,7})(?=$|[\s:),])/);
	if (!match) {
		const jobTotalTargets = Number(job?.params?.total_targets || job?.params?.selected_targets || 0);
		if (Number.isFinite(jobTotalTargets) && jobTotalTargets > 0) {
			const completedOffset = Number(job?.params?.completed_offset || 0);
			return formatProgressCount(Math.min(Math.max(0, completedOffset), jobTotalTargets), jobTotalTargets);
		}
		return null;
	}
	const current = Number(match[1] || 0);
	const total = Number(match[2] || 0);
	if (!Number.isFinite(current) || !Number.isFinite(total) || current < 0 || total <= 0 || current > total) return null;
	return formatProgressCount(current, total);
}

function collectionProgressFromJob(job?: CollectionJob | null): CollectionProgressCount | null {
	const detail = job?.detail || {};
	const persisted = detail?.db_persistence || {};
	const reason = String(detail?.reason || job?.error || '').trim();
	const status = String(job?.status || '').toUpperCase();
	const completionVerified = persisted?.completion_verified === true;
	const isComplete = (status === 'SUCCESS' || status === 'DONE') && completionVerified;

	const replyBackfillTotal = Number(
		detail?.collector_job?.params?.total_targets ??
		detail?.total_targets ??
		detail?.pending_targets ??
		detail?.collector_job?.params?.selected_targets ??
		0,
	);
	if (Number.isFinite(replyBackfillTotal) && replyBackfillTotal > 0) {
		const replyBackfillOffset = Number(detail?.completed_offset ?? detail?.collector_job?.params?.completed_offset ?? 0);
		const replyBackfillCurrent = replyBackfillOffset + Number(detail?.partial_saved ?? detail?.saved ?? 0);
		return formatProgressCount(Math.min(Math.max(0, replyBackfillCurrent), replyBackfillTotal), replyBackfillTotal);
	}

	const adTotal = Number(persisted.ad_rank_expected_cells || 0);
	if (Number.isFinite(adTotal) && adTotal > 0) {
		const searchUnitTotal = Number(persisted.ad_rank_expected_search_units || 0);
		if (Number.isFinite(searchUnitTotal) && searchUnitTotal > 0) {
			const okSearchUnits = Number(persisted.ad_rank_ok_search_units || 0);
			return formatProgressCount(isComplete ? searchUnitTotal : Math.max(0, okSearchUnits), searchUnitTotal);
		}
		const products = Array.isArray(detail?.collector_job?.params?.plan?.products) ? detail.collector_job.params.plan.products.length : 0;
		const okCells = Number(persisted.ad_rank_ok_cells ?? 0);
		const savedCells = Number(persisted.ad_rank_saved_cells ?? 0);
		const failedCells = Number(persisted.ad_rank_failed_cells ?? 0);
		if (Number.isFinite(products) && products > 0) {
			const totalUnits = Math.ceil(adTotal / products);
			const okUnits = Math.floor(Math.max(0, Number.isFinite(okCells) && okCells > 0 ? okCells : savedCells - failedCells) / products);
			return formatProgressCount(isComplete ? totalUnits : okUnits, totalUnits);
		}
		const current = isComplete ? adTotal : Number.isFinite(okCells) && okCells > 0 ? okCells : Math.max(0, savedCells - failedCells);
		return formatProgressCount(current, adTotal);
	}

	const rankTotal = Number(persisted.expected_keyword_count || 0);
	if (Number.isFinite(rankTotal) && rankTotal > 0) {
		const missing = Number(persisted.missing_keyword_count || 0);
		return formatProgressCount(isComplete ? rankTotal : Math.max(0, rankTotal - missing), rankTotal);
	}

	const requiredDates = Number(persisted.required_date_count || 0);
	if (Number.isFinite(requiredDates) && requiredDates > 0) {
		const missingDates = Number(persisted.missing_date_count || 0);
		return formatProgressCount(isComplete ? requiredDates : Math.max(0, requiredDates - missingDates), requiredDates);
	}

	const reasonMatch = reason.match(/(?:^|[=\s:])(\d{1,7})\s*\/\s*(\d{1,7})(?=$|[\s:),])/);
	if (reasonMatch) {
		return formatProgressCount(Number(reasonMatch[1] || 0), Number(reasonMatch[2] || 0));
	}

	const collectorJob = (detail?.collector_job || null) as CollectorJobPublic | null;
	return collectorProgressCount(collectorJob, collectorJob?.last_event || null, null);
}

function formatCollectionProgressText(job?: CollectionJob | null): string {
	if (job?.task_id === 'review_reply_backfill') {
		const detail = job.detail || {};
		const total = Number(detail?.collector_job?.params?.total_targets ?? detail?.total_targets ?? detail?.pending_targets ?? 0);
		if (Number.isFinite(total) && total > 0) {
			const offset = Number(detail?.completed_offset ?? detail?.collector_job?.params?.completed_offset ?? 0) || 0;
			const saved = Math.min(Math.max(0, offset + Number(detail?.partial_saved ?? detail?.saved ?? 0)), total);
			const processed = Math.min(Math.max(saved, offset + Number(detail?.partial_processed_targets ?? 0)), total);
			const progress = formatProgressCount(processed, total);
			const savedFmt = String(Math.trunc(saved)).padStart(Math.max(4, String(Math.trunc(total)).length), '0');
			const remainingFmt = String(Math.max(0, Math.trunc(total - saved))).padStart(Math.max(4, String(Math.trunc(total)).length), '0');
			return progress
				? `수집 진행개수 ${progress.label}, 저장개수 ${savedFmt}, 남은 ${remainingFmt}`
				: `수집현황 확인중/전체미확인`;
		}
	}
	const progress = collectionProgressFromJob(job);
	if (!progress) return '수집현황 확인중/전체미확인';
	return formatProgressDisplay(progress, '수집현황');
}

function collectionProgressFromTaskSavedRows(task?: CollectionTask | null): CollectionProgressCount | null {
	if (task?.task_id !== 'rank_openapi') return null;
	const pending = task.pending_collection || null;
	if (!pending) return null;
	const total = Number(pending.expected_search_keyword_count || pending.expected_keyword_count || 0);
	const saved = Number(pending.collected_search_keyword_count || pending.collected_keyword_count || 0);
	return formatProgressCount(saved, total);
}

function collectorStatusForJob(local: CollectorStatus | null | undefined, jobId?: string | null): CollectorStatus | null {
	const localJobId = String(local?.jobId || '').trim();
	const targetJobId = String(jobId || '').trim();
	if (!local || !localJobId || !targetJobId || localJobId !== targetJobId) return null;
	return local;
}

function formatCollectorDateRange(job?: CollectorJobPublic | null): string | null {
	const from = String(job?.date_from || job?.target_date || '').trim();
	const to = String(job?.date_to || job?.target_date || '').trim();
	if (!from && !to) return null;
	if (from && to && from !== to) return `${from} ~ ${to}`;
	return from || to;
}

function formatSavedByDate(job?: CollectionJob | null): string | null {
	const saved = job?.detail?.saved_by_date;
	if (!saved || typeof saved !== 'object') return null;
	const entries = Object.entries(saved as Record<string, unknown>)
		.filter(([d]) => d)
		.sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return null;
	if (entries.length <= 5) {
		return entries.map(([d, n]) => `${d}(${Number(n || 0).toLocaleString()}건)`).join(', ');
	}
	const first = entries[0]?.[0] || '';
	const last = entries[entries.length - 1]?.[0] || '';
	const total = entries.reduce((acc, [, n]) => acc + Number(n || 0), 0);
	return `${first} ~ ${last} · ${entries.length}일 · ${total.toLocaleString()}건`;
}

function formatPendingCollection(task?: CollectionTask | null): string | null {
	const pending = task?.pending_collection;
	if (task?.task_id === 'rank_openapi' && pending?.has_pending) {
		const total = Number(pending.expected_search_keyword_count || pending.expected_keyword_count || 0);
		const collected = Number(pending.collected_search_keyword_count || pending.collected_keyword_count || 0);
		const missing = Number.isFinite(total) && Number.isFinite(collected) ? Math.max(0, total - collected) : 0;
		if (missing > 0 && total > 0) {
			const progress = formatProgressCount(collected, total);
			return progress ? `남은 키워드 ${missing.toLocaleString()}개 · ${formatProgressDisplay(progress, '수집현황')}` : `남은 키워드 ${missing.toLocaleString()}개`;
		}
	}
	const count = Number(pending?.missing_date_count || 0);
	if (!pending?.has_pending || count <= 0) return null;
	const unitSummary = pending.missing_unit_summary && typeof pending.missing_unit_summary === 'object' ? pending.missing_unit_summary : null;
	if (task?.task_id === 'gfa_performance_daily' && unitSummary) {
		const unitLabels: Record<string, string> = {
			CAMPAIGN: '캠페인',
			ASSET_GROUP: '그룹',
			CREATIVE: '소재',
		};
		const parts = ['CAMPAIGN', 'ASSET_GROUP', 'CREATIVE']
			.map((unit) => {
				const n = Number(unitSummary[unit]?.missing_date_count || 0);
				return n > 0 ? `${unitLabels[unit] || unit} ${n.toLocaleString()}일` : null;
			})
			.filter(Boolean);
		const lookback = Number(pending.lookback_days || 0);
		if (parts.length > 0) {
			return `${lookback > 0 ? `최근 ${lookback.toLocaleString()}일 기준 · ` : ''}${parts.join(' · ')}`;
		}
	}
	const segments = Array.isArray(pending.missing_segments) ? pending.missing_segments : [];
	if (segments.length === 0) {
		const from = String(pending.date_from || '').trim();
		const to = String(pending.date_to || '').trim();
		const range = from && to ? `${from} ~ ${to}` : from || to;
		return range ? `${range} · ${count.toLocaleString()}일` : `${count.toLocaleString()}일`;
	}
	if (segments.length <= 3) {
		return segments
			.map((seg) => {
				const from = String(seg?.[0] || '').trim();
				const to = String(seg?.[1] || '').trim();
				return from && to && from !== to ? `${from}~${to}` : from || to;
			})
			.filter(Boolean)
			.join(', ') + ` · ${count.toLocaleString()}일`;
	}
	const first = segments[0];
	const last = segments[segments.length - 1];
	const firstText = String(first?.[0] || '').trim();
	const lastText = String(last?.[1] || last?.[0] || '').trim();
	return `${firstText}~${lastText} · ${count.toLocaleString()}일 · ${segments.length.toLocaleString()}구간`;
}

function formatNonOperatingCollectionNote(task?: CollectionTask | null): string | null {
	const pending = task?.pending_collection;
	if (task?.task_id !== 'gfa_performance_daily') return null;
	const summary = pending?.non_operating_unit_summary;
	const units = summary?.units && typeof summary.units === 'object' ? summary.units : null;
	if (!units) return null;
	const unitLabels: Record<string, string> = {
		CAMPAIGN: '캠페인',
		ASSET_GROUP: '그룹',
		CREATIVE: '소재',
	};
	const parts = ['CAMPAIGN', 'ASSET_GROUP', 'CREATIVE']
		.map((unit) => {
			const item = units[unit];
			const count = Number(item?.non_operating_date_count || 0);
			if (count <= 0) return null;
			const segs = Array.isArray(item?.non_operating_segments) ? item?.non_operating_segments : [];
			const first = segs[0];
			const last = segs[segs.length - 1];
			const from = String(first?.[0] || summary?.reference_from || '').trim();
			const to = String(last?.[1] || last?.[0] || '').trim();
			const range = from && to ? ` (${from}~${to})` : '';
			return `${unitLabels[unit] || unit} ${count.toLocaleString()}일${range}`;
		})
		.filter(Boolean);
	return parts.length > 0 ? parts.join(' · ') : null;
}

function formatJobDateRange(job?: CollectionJob | null): string | null {
	const from = String(job?.date_from || job?.target_date || '').trim();
	const to = String(job?.date_to || job?.target_date || '').trim();
	if (!from && !to) return null;
	if (from && to && from !== to) return `${from} ~ ${to}`;
	return from || to;
}

function localYmd(date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function isBeforeTodayYmd(value?: string | null): boolean {
	const raw = String(value || '').trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw < localYmd();
}

function sumPersistedRows(detail: any): number {
	const rows = detail?.db_persistence?.rows_by_table;
	if (!rows || typeof rows !== 'object') return Number(detail?.db_persistence?.rows_total || 0);
	return Object.values(rows as Record<string, unknown>).reduce<number>((acc, value) => acc + Number(value || 0), 0);
}

function persistenceMissingSummary(detail: any): string {
	const persisted = detail?.db_persistence || {};
	const pendingReplyTargets = Number(persisted.pending_targets_remaining || 0);
	const missingRankKeywords = Number(persisted.missing_keyword_count || 0);
	const incompleteRankProducts = Number(persisted.incomplete_product_count || 0);
	const missingTables = Array.isArray(persisted.missing_tables)
		? persisted.missing_tables
		: Array.isArray(persisted.empty_tables)
			? persisted.empty_tables
			: [];
	const missingDatesByTable =
		persisted.missing_dates_by_table && typeof persisted.missing_dates_by_table === 'object'
			? persisted.missing_dates_by_table
			: persisted.empty_dates_by_table && typeof persisted.empty_dates_by_table === 'object'
				? persisted.empty_dates_by_table
				: {};
	const missingDateCount = Number(persisted.missing_date_count || 0) ||
		Object.values(missingDatesByTable as Record<string, unknown>).reduce<number>((acc, value) => acc + (Array.isArray(value) ? value.length : 0), 0);
	const parts: string[] = [];
	if (pendingReplyTargets > 0) {
		parts.push(`답글 보강 필요 ${pendingReplyTargets.toLocaleString()}건`);
		return parts.join(' · ');
	}
	if (missingRankKeywords > 0 || incompleteRankProducts > 0) {
		if (incompleteRankProducts > 0) parts.push(`미완료 상품 ${incompleteRankProducts.toLocaleString()}개`);
		if (missingRankKeywords > 0) parts.push(`미수집 키워드 ${missingRankKeywords.toLocaleString()}개`);
		return parts.join(' · ');
	}
	if (missingDateCount > 0) parts.push(`누락 일자 ${missingDateCount.toLocaleString()}건`);
	if (missingTables.length > 0) parts.push(`누락 테이블 ${missingTables.join(', ')}`);
	return parts.join(' · ');
}

function pendingReplyTargetCount(detail: any): number {
	return Number(detail?.db_persistence?.pending_targets_remaining || 0);
}

function humanizePartialCollectionReason(job: CollectionJob, reason: string): string {
	const taskId = String(job.task_id || '').trim();
	const detail = job.detail || {};
	const persisted = detail?.db_persistence || {};
	if (taskId === 'ad_rank_diagnosis_cdp' && /ad_rank_(cells|search_units)_incomplete/i.test(reason)) {
		const products = Array.isArray(detail?.collector_job?.params?.plan?.products) ? detail.collector_job.params.plan.products.length : 0;
		const failedRows = Number(persisted.ad_rank_failed_cells || 0);
		const missingRows = Number(persisted.ad_rank_missing_cells || 0);
		const failedUnits0 = Number(persisted.ad_rank_failed_search_units || 0);
		const missingUnits0 = Number(persisted.ad_rank_missing_search_units || 0);
		const failedUnits = failedUnits0 > 0 ? failedUnits0 : products > 0 ? Math.ceil(failedRows / products) : 0;
		const missingUnits = missingUnits0 > 0 ? missingUnits0 : products > 0 ? Math.ceil(missingRows / products) : 0;
		const parts: string[] = [];
		if (failedUnits > 0) parts.push(`실패 검색 ${failedUnits.toLocaleString()}회`);
		if (missingUnits > 0) parts.push(`미수집 검색 ${missingUnits.toLocaleString()}회`);
		const suffix = failedRows > 0 ? ` 실패 row ${failedRows.toLocaleString()}건 제외.` : '';
		return `광고 순위 검색 미완료${parts.length ? `: ${parts.join(' · ')}` : ''}.${suffix}`;
	}
	return `필요한 일자까지 완료되지 않았습니다: ${reason}`;
}

function formatInlineCollectionError(job?: CollectionJob | null): string | null {
	const raw = String(job?.error || '').trim();
	if (!raw) return null;
	if (String(job?.task_id || '') === 'ad_rank_diagnosis_cdp' && /ad_rank_(cells|search_units)_incomplete/i.test(raw)) {
		return null;
	}
	return raw;
}

function isAlreadyStoredSkip(reason: string, detail: any): boolean {
	const status = String(detail?.status || '').toUpperCase();
	const normalizedReason = String(reason || detail?.reason || '').trim();
	if (status !== 'SKIPPED' && detail?.skipped !== true) return false;
	if (normalizedReason.startsWith('no_missing_')) return true;
	if (normalizedReason === 'no_missing_ads_dates') return true;
	return false;
}

function jobTimeMs(job?: CollectionJob | null): number {
	const raw = job?.finished_at || job?.started_at || '';
	const n = raw ? new Date(raw).getTime() : 0;
	return Number.isFinite(n) ? n : 0;
}

function sameJobRange(a?: CollectionJob | null, b?: CollectionJob | null): boolean {
	if (!a || !b) return false;
	const aFrom = String(a.date_from || a.target_date || '').trim();
	const aTo = String(a.date_to || a.target_date || '').trim();
	const bFrom = String(b.date_from || b.target_date || '').trim();
	const bTo = String(b.date_to || b.target_date || '').trim();
	return a.task_id === b.task_id && aFrom === bFrom && aTo === bTo;
}

function ymdTime(value?: string | null): number | null {
	const raw = String(value || '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
	const n = new Date(`${raw}T00:00:00Z`).getTime();
	return Number.isFinite(n) ? n : null;
}

function jobRangeBounds(job?: CollectionJob | null): { from: number; to: number } | null {
	if (!job) return null;
	const from = ymdTime(job.date_from || job.target_date);
	const to = ymdTime(job.date_to || job.target_date);
	if (from == null || to == null) return null;
	return { from: Math.min(from, to), to: Math.max(from, to) };
}

function successCoversJobRange(job?: CollectionJob | null, success?: CollectionJob | null): boolean {
	if (!job || !success || job.task_id !== success.task_id) return false;
	const failedRange = jobRangeBounds(job);
	const successRange = jobRangeBounds(success);
	if (!failedRange || !successRange) return false;
	return successRange.from <= failedRange.from && successRange.to >= failedRange.to;
}

function persistenceRangeMismatch(job?: CollectionJob | null): boolean {
	const detail = job?.detail || {};
	const dbPersistence = detail?.db_persistence || {};
	const collectorJob = detail?.collector_job || {};
	const expectedFrom = String(collectorJob.date_from || job?.date_from || job?.target_date || '').trim();
	const expectedTo = String(collectorJob.date_to || job?.date_to || job?.target_date || '').trim();
	const actualFrom = String(dbPersistence.date_from || '').trim();
	const actualTo = String(dbPersistence.date_to || '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedTo)) return false;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(actualFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(actualTo)) return false;
	return actualFrom > expectedFrom || actualTo < expectedTo;
}

function isRecoveredBySuccess(job?: CollectionJob | null, success?: CollectionJob | null): boolean {
	if (!job || !success) return false;
	const status = String(job.status || '').toUpperCase();
	if (!['FAILED', 'PARTIAL'].includes(status)) return false;
	if (!sameJobRange(job, success) && !successCoversJobRange(job, success)) return false;
	return jobTimeMs(success) > jobTimeMs(job);
}

function humanizeCollectionFailure(job?: CollectionJob | null, reasonText?: string | null): string {
	const reason = String(reasonText || job?.error || '').trim();
	const taskId = String(job?.task_id || '').trim();
	const detail = job?.detail || {};
	const collectorJob = detail?.collector_job || {};
	const collectorError = String(collectorJob?.error || '').trim();
	const lastEvent = collectorJob?.last_event || {};
	const note = String(lastEvent?.note || '').trim();
	const raw = [reason, collectorError, note].filter(Boolean).join(' · ');
	if (reason === 'no_db_rows_saved') {
		if (String(detail?.error || '').trim() === 'api_restart') {
			return 'API 재시작/재빌드 중 실행 중이던 Collector 작업이 중단되어 저장 검증 행이 0건으로 남았습니다. 현재 Collector가 POLLING이면 같은 작업을 다시 실행하면 됩니다.';
		}
		if (taskId === 'purchase_keywords') {
			return 'Collector가 구매 키워드 화면 작업을 실행했지만 DB 저장 행이 0건입니다. 보통 스마트스토어 화면에서 엑셀 다운로드/업로드가 실패했거나, 다운로드 파일이 비어 있을 때 발생합니다.';
		}
		if (taskId === 'reviews_collect') {
			return 'Collector가 리뷰 엑셀 수집을 실행했지만 DB 저장 행이 0건입니다. 리뷰 파일 다운로드/업로드 실패 또는 해당 기간 파일이 비어 있는지 확인이 필요합니다.';
		}
		return '수집은 실행됐지만 저장된 DB 행이 0건입니다. Collector 결과 파일 생성/업로드 여부를 확인해 주세요.';
	}
	if (/failed=1/i.test(raw)) {
		if (taskId === 'purchase_keywords') {
			return 'Collector 작업 1건이 실패했습니다. 스마트스토어 구매 키워드 화면 로그인 상태, 다운로드 권한, 파일 다운로드 완료 여부를 확인해 주세요.';
		}
		if (taskId === 'reviews_collect' || taskId === 'review_reply_backfill') {
			return 'Collector 작업 1건이 실패했습니다. 스마트스토어 리뷰 관리 화면 로그인/접근 상태와 다운로드 또는 답글 본문 조회 결과를 확인해 주세요.';
		}
		return 'Collector 작업 1건이 실패했습니다. 최근 Collector 이벤트의 note를 확인해 주세요.';
	}
	return reason || raw || '오류 상세를 확인해 주세요.';
}

type CollectorBridgeCommand = {
	command: 'status' | 'start' | 'stop' | 'selfUpdate';
	apiBaseUrl?: string;
	bearerToken?: string;
	collectorToken?: string;
	deviceId?: string;
	chromeUserDataDir?: string;
	chromeProfileDir?: string;
	chromeProfileLabel?: string;
	installerUrl?: string;
	expectedVersion?: string;
	expectedManageNo?: string;
};

function formatCollectionResult(job?: CollectionJob | null, latestSuccess?: CollectionJob | null): { tone: BadgeTone; title: string; detail: string } {
	if (!job) {
		return { tone: 'muted', title: '아직 실행 이력이 없습니다', detail: '지금 실행을 누르면 수집 상태가 여기에 표시됩니다.' };
	}
	if (isRecoveredBySuccess(job, latestSuccess)) {
		const range = formatJobDateRange(latestSuccess || job);
		const saved = Number(latestSuccess?.rows_written ?? latestSuccess?.detail?.rows_written ?? latestSuccess?.detail?.saved ?? 0) || sumPersistedRows(latestSuccess?.detail);
		return {
			tone: 'ok',
			title: '이후 재수집 성공',
			detail: `${range ? `${range} · ` : ''}이전 ${String(job.status || '').toUpperCase()} 이력은 이후 성공 작업으로 복구됐습니다${saved > 0 ? ` (${saved.toLocaleString()}건 저장/검증)` : ''}.`,
		};
	}
	const status = String(job.status || '').toUpperCase();
	const taskId = String(job.task_id || '').trim();
	const detail = job.detail || {};
	const reason = String(detail.reason || job.error || '').trim();
	const range = formatJobDateRange(job);
	const persisted = sumPersistedRows(detail);
	const rowsWritten = Number(job.rows_written ?? detail.rows_written ?? detail.saved ?? detail.total_rows ?? 0);
	const savedCount = rowsWritten > 0 ? rowsWritten : persisted;
	const hasPersistence = Boolean(detail.db_persistence);
	const completionVerified = detail.db_persistence?.completion_verified === true;
	const missingSummary = persistenceMissingSummary(detail);
	const pendingReplies = pendingReplyTargetCount(detail);
	const progressText = formatCollectionProgressText(job);
	const isStaleAdRankResult = taskId === 'ad_rank_diagnosis_cdp' && isBeforeTodayYmd(job.target_date || job.date_to || job.date_from);
	const isSearchwordPersistenceMismatch = taskId === 'ads_searchword_daily' && persistenceRangeMismatch(job);

	if (
		status === 'SKIPPED' ||
		detail.skipped === true ||
		String(detail.status || '').toUpperCase() === 'SKIPPED' ||
		reason === 'no_missing_ads_dates'
	) {
		if (/collector_job_stuck/i.test(reason) || detail.scheduler_skip === true) {
			return {
				tone: 'warn',
				title: '수집 중단(시간초과)',
				detail: `${range ? `${range} · ` : ''}${progressText}. 15분 이상 응답이 없어 스케줄러가 작업을 건너뛰었습니다. 이어받기로 남은 조건만 다시 수집하세요.`,
			};
		}
		if (isStaleAdRankResult) {
			return {
				tone: 'warn',
				title: '오늘 수집 필요',
				detail: `${range ? `${range} 기준 ` : ''}이전 날짜 결과입니다. 광고 상품 순위는 오늘(${localYmd()}) 기준으로 다시 수집해야 합니다.`,
			};
		}
		if (reason === 'no_source_review_metrics') {
			return {
				tone: 'warn',
				title: '원천 값 없음',
				detail: `${range ? `${range} 기준 ` : ''}상품 상세 메트릭에 평점·리뷰 수가 없어 리뷰 일간 데이터를 채우지 못했습니다. 상품 상세 메트릭(CDP) 수집 결과를 확인해 주세요.`,
			};
		}
		if (isAlreadyStoredSkip(reason, detail)) {
			return {
				tone: 'muted',
				title: '수집·저장 완료',
				detail: `${range ? `${range} 기준 ` : ''}이미 저장된 데이터가 확인되어 추가 수집은 건너뛰었습니다${persisted > 0 ? ` (${persisted.toLocaleString()}건)` : ''}.`,
			};
		}
		return {
			tone: 'muted',
			title: '수집 완료',
			detail: `${range ? `${range} 기준 ` : ''}이번 실행에서 새로 수집할 대상이 없습니다.`,
		};
	}
	if (status === 'SUCCESS' || status === 'DONE') {
		if (isSearchwordPersistenceMismatch) {
			const dbRange = formatJobDateRange({
				...job,
				date_from: detail.db_persistence?.date_from || null,
				date_to: detail.db_persistence?.date_to || null,
				target_date: detail.db_persistence?.date_from || null,
			});
			return {
				tone: 'warn',
				title: '날짜 불일치',
				detail: `${range ? `${range} 요청 ` : ''}검색어 보고서를 수집했지만 저장 검증 날짜가 ${dbRange || '요청 기간 밖'}입니다. 추가 수집 필요 날짜를 다시 수집해야 합니다.`,
			};
		}
		if (isStaleAdRankResult) {
			return {
				tone: 'warn',
				title: '오늘 수집 필요',
				detail: `${range ? `${range} 기준 ` : ''}이전 날짜 저장 결과입니다. 광고 상품 순위는 오늘(${localYmd()}) 기준 데이터가 있어야 분석 화면에 표시됩니다.`,
			};
		}
		if (!completionVerified) {
			return {
				tone: 'warn',
				title: savedCount > 0 ? '추가 수집 필요' : '저장 검증 대기',
				detail: missingSummary
					? `${range ? `${range} · ` : ''}${progressText}. ${missingSummary}. 필요한 기간 전체 저장 검증이 끝나야 완료로 표시됩니다.`
					: `${range ? `${range} · ` : ''}${progressText}. ${hasPersistence ? '저장 결과 검증이 아직 완료되지 않았습니다.' : '수집은 끝났지만 저장 검증 결과가 없습니다.'}`,
			};
		}
		return {
			tone: 'muted',
			title: '수집·저장 완료',
			detail: `${range ? `${range} · ` : ''}${savedCount > 0 ? `${savedCount.toLocaleString()}건 저장/검증 완료` : '필요 기간 저장 검증 완료'}`,
		};
	}
	if (status === 'PARTIAL') {
		if (taskId === 'rank_openapi' && reason.startsWith('rank_exposure_anomaly')) {
			return {
				tone: 'warn',
				title: '순위 매칭 이상',
				detail:
					`${range ? `${range} · ` : ''}${progressText}. 네이버 차단으로 판단하지 않습니다. ` +
					'검색 결과 카드는 수집됐지만 추적 상품 노출 순위가 0건으로 검증되어, 상품 ID/카드 필터/매칭 기준 확인 또는 재수집이 필요합니다.',
			};
		}
		return {
			tone: 'warn',
			title: pendingReplies > 0 ? '추가 수집 필요' : '일부 데이터 수집',
			detail: missingSummary
				? `${range ? `${range} · ` : ''}${progressText}. ${missingSummary}. 추가 수집이 필요합니다.`
				: reason
					? `${range ? `${range} · ` : ''}${progressText}. ${humanizePartialCollectionReason(job, reason)}`
					: `${range ? `${range} · ` : ''}${progressText}. 수집은 진행됐지만 필요한 기간 전체 저장 검증을 통과하지 못했습니다.`,
		};
	}
	if (status === 'FAILED') {
		return {
			tone: 'danger',
			title: '수집 실패',
			detail: `${progressText}. ${humanizeCollectionFailure(job, reason)}`,
		};
	}
	if (status === 'CANCELLED') {
		return {
			tone: 'muted',
			title: '사용자 중단',
			detail: 'Collector 작업을 사용자 요청으로 중단했습니다.',
		};
	}
	if (['STARTED', 'QUEUED', 'CLAIMED', 'UPLOADING', 'WAITING_USER'].includes(status)) {
		return {
			tone: 'warn',
			title: job.source_type === 'host_cdp' ? '백그라운드 진행 중' : '수집 진행 중',
			detail: range ? `${range} 데이터를 수집 중입니다. 완료 후 저장 검증을 진행합니다.` : '수집 상태를 확인하는 중입니다.',
		};
	}
	return { tone: 'muted', title: '상태 확인 중', detail: status || '최근 작업 상태를 불러오는 중입니다.' };
}

export function DataCollectionView(props: { apiBaseUrl: string }): JSX.Element {
	const apiBaseUrl = props.apiBaseUrl;
	const auth = useMaybeAuth();
	const getIdToken = async (opts?: { forceRefresh?: boolean }): Promise<string | null> => {
		return (await auth?.getIdToken(opts)) || null;
	};
	const [tasks, setTasks] = useState<CollectionTask[]>([]);
	const [jobs, setJobs] = useState<CollectionJob[]>([]);
	const [coverage, setCoverage] = useState<CollectionTasksResponse['coverage']>({});
	const [loading, setLoading] = useState(false);
	const [runningTasks, setRunningTasks] = useState<Record<string, boolean>>({});
	const [cancellingTasks, setCancellingTasks] = useState<Record<string, boolean>>({});
	const [cancelledCollectorJobs, setCancelledCollectorJobs] = useState<Record<string, number>>({});
	const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [collectorStatus, setCollectorStatus] = useState<CollectorStatus | null>(null);
	const [collectorEvents, setCollectorEvents] = useState<CollectorEvent[]>([]);
	const [collectionJobEventsByJobId, setCollectionJobEventsByJobId] = useState<Record<string, CollectionJobEvent[]>>({});
	const [adRankRetryPreview, setAdRankRetryPreview] = useState<AdRankRetryPreview | null>(null);
	const [collectorBusy, setCollectorBusy] = useState(false);
	const [collectorAutoUpdating, setCollectorAutoUpdating] = useState(false);
	const collectorAutoUpdateAttemptedRef = useRef(false);
	const [taskProgress, setTaskProgress] = useState<Record<string, TaskProgress>>(() => readStoredTaskProgress());
	const [hoveredDescriptionTaskId, setHoveredDescriptionTaskId] = useState<string | null>(null);
	const [gfaReportFile, setGfaReportFile] = useState<File | null>(null);
	const [gfaBusy, setGfaBusy] = useState(false);
	const [gfaMessage, setGfaMessage] = useState<string | null>(null);
	const collectorDeviceId = useMemo(() => getOrCreateCollectorDeviceId(), []);
	const collectorWorkerDeviceId = useMemo(() => getCollectorWorkerDeviceId(), []);
	const accessMode = useMemo(() => detectAccessMode(apiBaseUrl), [apiBaseUrl]);
	const accessModeLabel = accessMode === 'local' ? '로컬 접속' : accessMode === 'nas' ? 'NAS 접속' : '접속 환경 확인 불가';
	const collectorAgentVersion = String(collectorStatus?.agentVersion || '').trim();
	const collectorAgentManageNo = normalizeManageNo(collectorStatus?.agentManageNo || '');
	const collectorWorkerVersion = String(collectorStatus?.collectorVersion || collectorStatus?.agentVersion || '').trim();
	const collectorWorkerManageNo = normalizeManageNo(collectorStatus?.collectorManageNo || collectorStatus?.agentManageNo || '');
	const expectedCollectorApiBaseUrl = absoluteApiBaseUrl(apiBaseUrl);
	const collectorApiBaseUrl = String(collectorStatus?.apiBaseUrl || '').trim();
	const collectorStatusDeviceId = String(collectorStatus?.deviceId || '').trim();
	const isCollectorWorkerDeviceMatched =
		!collectorStatus?.running ||
		!collectorStatusDeviceId ||
		collectorStatusDeviceId === collectorWorkerDeviceId;
	const isCollectorWorkerTargetMatched =
		!collectorStatus?.running ||
		(
			(!collectorApiBaseUrl || collectorApiBaseUrl.replace(/\/$/, '') === expectedCollectorApiBaseUrl.replace(/\/$/, '')) &&
			isCollectorWorkerDeviceMatched
		);
	const requiredHostAgentManageNo = normalizeManageNo(REQUIRED_HOST_AGENT_MANAGE_NO);
	const isCollectorAgentLatest =
		collectorAgentVersion === REQUIRED_HOST_AGENT_VERSION && collectorAgentManageNo === requiredHostAgentManageNo;
	const isCollectorWorkerLatest =
		!collectorStatus?.running ||
		(collectorWorkerVersion === REQUIRED_HOST_AGENT_VERSION && collectorWorkerManageNo === requiredHostAgentManageNo);
	const isCollectorWorkerReady = isCollectorWorkerLatest && isCollectorWorkerTargetMatched;
	const isHostAgentReachable = collectorStatus?.agentReachable === true;
	const hostAgentHealthTone = !collectorStatus ? 'muted' : isHostAgentReachable && isCollectorAgentLatest ? 'ok' : isHostAgentReachable ? 'warn' : 'danger';
	const hostAgentHealthLabel = !collectorStatus
		? 'Host Agent 상태 확인 전'
		: isHostAgentReachable && isCollectorAgentLatest
			? 'Host Agent 정상 작동'
			: isHostAgentReachable
				? 'Host Agent 연결됨 · 업데이트 필요'
				: 'Host Agent 미실행';
	const workerState = String(collectorStatus?.state || '').toUpperCase();
	const isWorkerError = workerState === 'ERROR' || workerState === 'AUTH_EXPIRED';
	const workerErrorMessage = String(collectorStatus?.error || '').trim();
	const isWorkerTransientAuthRetry = workerState === 'POLLING_RETRY';
	const isWorkerAuthError =
		workerState === 'AUTH_EXPIRED' ||
		(workerState === 'ERROR' && /401|Unauthorized|unauthorized/i.test(workerErrorMessage));
	const workerHealthTone = isWorkerError || !isCollectorWorkerTargetMatched ? 'danger' : collectorStatus?.running ? 'ok' : 'muted';
	const workerHealthLabel = isWorkerError
		? isWorkerAuthError
			? 'Worker 인증 오류 · 로그인 후 재시작 필요'
			: collectorStatus?.running
			? 'Worker 오류 · 중지 후 재시작 필요'
			: 'Worker 오류 · 재시작 필요'
		: !isCollectorWorkerTargetMatched
			? 'Worker 연결 대상 불일치 · 재시작 필요'
		: collectorStatus?.running
			? isWorkerTransientAuthRetry
				? 'Worker 작동 중 · 인증 재시도'
				: `Worker 작동 중 · ${collectorStatus?.state || 'POLLING'}`
			: 'Worker 중지';
	const hostAgentLauncherDisabled = collectorBusy || isHostAgentReachable;
	const hostAgentLauncherLabel = hostAgentLauncherDisabled ? '실행 중' : collectorStatus ? '다시 시작 실행기 다운로드' : '실행기 다운로드';
	const hostAgentLauncherTitle = hostAgentLauncherDisabled
		? 'Host Agent가 이미 실행 중입니다.'
		: 'Host Agent가 꺼져 있으면 브라우저 보안상 실행기를 다운로드한 뒤 열어야 합니다.';
	const hostAgentStopEnabled = !collectorBusy && isHostAgentReachable;
	const hostAgentStatusButtonLabel = isHostAgentReachable ? '상태확인' : '상태확인/재시작';
	const backgroundStartDisabled = collectorBusy || !isHostAgentReachable || (collectorStatus?.running === true && isCollectorWorkerTargetMatched);
	const stopCollectorEnabled = !collectorBusy && collectorStatus?.running === true;
	const disabledActionStyle: React.CSSProperties = {
		opacity: 0.45,
		pointerEvents: 'none',
		cursor: 'not-allowed',
	};

	const authHeaders = async (): Promise<Record<string, string>> => {
		const t = await getIdToken({ forceRefresh: false });
		return t ? { Authorization: `Bearer ${t}` } : {};
	};

	const assertNasCollectorToken = async (token: string): Promise<void> => {
		const res = await fetch(`${apiBaseUrl}/collection/tasks`, {
			method: 'GET',
			cache: 'no-store',
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => '');
			throw new Error(`NAS Collector 인증 확인 실패: HTTP ${res.status}${detail ? ` · ${detail.slice(0, 160)}` : ''}`);
		}
	};

	const fetchCollectorWorkerToken = async (headers: Record<string, string>): Promise<string> => {
		try {
			const res = await fetch(`${apiBaseUrl}/collection/collector-token`, {
				method: 'GET',
				cache: 'no-store',
				headers,
			});
			const data = await res.json().catch(() => ({} as any));
			if (!res.ok || data?.ok === false) throw new Error(String(data?.message || data?.error || `HTTP ${res.status}`));
			return String(data?.collectorToken || '').trim();
		} catch (e) {
			if (accessMode === 'nas') throw new Error(`Collector worker token 확인 실패: ${errToMsg(e)}`);
			return '';
		}
	};

	const hostCdpHeaders = async (): Promise<Record<string, string>> => {
		if (accessMode !== 'nas') return {};
		const nasHost = getNasApiHost(apiBaseUrl);
		if (!nasHost) return {};
		const ip = await discoverNasHostCdpIp({
			nasHost,
			requestLocalAgent: async () => {
				try {
					const res = await axios.get(`${HOST_AGENT_LOCAL_ORIGIN}/network-info`, { timeout: 1500 });
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
		return buildErp2ClientIpHeaders(ip) || {};
	};

	const invokeCollectorBridge = async (command: CollectorBridgeCommand): Promise<any> => {
		if (!(await canReachHostAgentLocally(1500))) {
			throw new Error('로컬 Host Agent 브리지(127.0.0.1:9230)에 연결할 수 없습니다. 먼저 "상태확인/재시작"으로 Host Agent를 실행한 뒤 다시 시도해 주세요.');
		}
		const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const bridgeUrl = new URL(`${HOST_AGENT_LOCAL_ORIGIN}/bridge/collector-background`);
		bridgeUrl.searchParams.set('opener_origin', window.location.origin);
		const popup = window.open(bridgeUrl.toString(), 'erp2-analytics-collector-bridge', 'width=520,height=520');
		if (!popup) {
			throw new Error('브라우저가 Collector 브리지 팝업을 차단했습니다. 팝업 허용 후 다시 시도해 주세요.');
		}
		return await new Promise((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				window.clearTimeout(timer);
				window.removeEventListener('message', onMessage);
			};
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				cleanup();
				fn();
			};
			const timer = window.setTimeout(() => {
				finish(() => {
					try {
						popup.close();
					} catch {
						// ignore
					}
					reject(new Error('Collector 브리지 응답 시간이 초과되었습니다.'));
				});
			}, COLLECTOR_BRIDGE_TIMEOUT_MS);
			const sendCommand = () => {
				try {
					popup.postMessage(
						{
							type: HOST_AGENT_BRIDGE_MESSAGE_TYPE,
							action: 'collector-background-command',
							requestId,
							...command,
						},
						HOST_AGENT_LOCAL_ORIGIN,
					);
				} catch (e) {
					finish(() => reject(e));
				}
			};
			const onMessage = (event: MessageEvent) => {
				if (event.origin !== HOST_AGENT_LOCAL_ORIGIN) return;
				const data = event.data || {};
				if (data.type !== HOST_AGENT_BRIDGE_MESSAGE_TYPE || data.action !== 'collector-background') return;
				if (data.ready === true) {
					sendCommand();
					return;
				}
				if (data.requestId !== requestId) return;
				finish(() => {
					if (data.ok === true) {
						resolve(data);
					} else {
						reject(new Error(String(data.error || 'collector_bridge_failed')));
					}
				});
			};
			window.addEventListener('message', onMessage);
		});
	};

	const runHostAgentSelfUpdate = async () => {
		const installerPath = '/nas/Install-Analytics-HostAgent.ps1';
		const payload = {
			command: 'selfUpdate' as const,
			installerUrl: new URL(installerPath, window.location.origin).toString(),
			expectedVersion: REQUIRED_HOST_AGENT_VERSION,
			expectedManageNo: REQUIRED_HOST_AGENT_MANAGE_NO,
		};
		try {
			const res = await fetchWithTimeout(`${HOST_AGENT_LOCAL_ORIGIN}/self-update`, {
				method: 'POST',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const data = await res.json().catch(() => ({} as any));
			if (!res.ok || data?.ok === false) throw new Error(String(data?.error || `HTTP ${res.status}`));
			return;
		} catch (directError) {
			if (await waitForHostAgentVersion(REQUIRED_HOST_AGENT_VERSION, REQUIRED_HOST_AGENT_MANAGE_NO)) return;
			try {
				await invokeCollectorBridge(payload);
				if (await waitForHostAgentVersion(REQUIRED_HOST_AGENT_VERSION, REQUIRED_HOST_AGENT_MANAGE_NO)) return;
			} catch (bridgeError) {
				if (accessMode === 'nas') throw bridgeError;
			}
			throw directError;
		}
	};

	const upgradeHostAgent = async () => {
		setCollectorBusy(true);
		setCollectorAutoUpdating(true);
		setError(null);
		const shouldRestartWorker = collectorStatus?.running === true;
		try {
			await runHostAgentSelfUpdate();
			const updated = await waitForHostAgentVersion(REQUIRED_HOST_AGENT_VERSION, REQUIRED_HOST_AGENT_MANAGE_NO, 35_000);
			if (!updated) {
				throw new Error('self_update_timeout');
			}
			if (shouldRestartWorker) {
				await startCollectorWithFreshTokens();
			}
			clearHostAgentAutoUpdateAttempt(accessMode);
			setError(null);
			await refreshCollectorStatus();
		} catch (e) {
			setError(`Host Agent 업그레이드 실패: ${errToMsg(e)}`);
		} finally {
			setCollectorBusy(false);
			setCollectorAutoUpdating(false);
		}
	};

	const load = async (opts: { lightweight?: boolean; background?: boolean } = {}) => {
		if (!opts.background) setLoading(true);
		setError(null);
		try {
			const headers = await authHeaders();
			const taskParams = opts.lightweight ? { include_pending: false, include_coverage: false } : undefined;
			const [taskRes, jobRes, eventRes, adRankRetryPreviewRes] = await Promise.all([
				axios.get<CollectionTasksResponse>(`${apiBaseUrl}/collection/tasks`, { headers, params: taskParams }),
				axios.get<CollectionJobsResponse>(`${apiBaseUrl}/collection/jobs`, { headers, params: { limit: 30 } }),
				axios.get<{ ok: boolean; events: CollectorEvent[] }>(`${apiBaseUrl}/search-rank/page-metrics/local-collector/events`, { headers, params: { limit: 20 } }),
				axios.get<AdRankRetryPreview>(`${apiBaseUrl}/collection/tasks/ad_rank_diagnosis_cdp/retry-preview`, { headers }).catch(() => null),
			]);
			const loadedTasks = taskRes.data.tasks || [];
			setTasks(loadedTasks);
			if (!opts.lightweight) setCoverage(taskRes.data.coverage || {});
			setJobs(jobRes.data.jobs || []);
			setCollectorEvents(Array.isArray(eventRes.data?.events) ? eventRes.data.events : []);
			setAdRankRetryPreview(adRankRetryPreviewRes?.data || null);
			const persistedEventJobIds = loadedTasks
				.filter((task) => (task.task_id === 'ad_rank_diagnosis_cdp' || task.task_id === 'review_reply_backfill') && task.latest_job?.job_id)
				.map((task) => String(task.latest_job?.job_id || '').trim())
				.filter(Boolean);
			if (persistedEventJobIds.length > 0) {
				const eventEntries = await Promise.all(
					persistedEventJobIds.map(async (jobId) => {
						try {
							const res = await axios.get<{ ok: boolean; events: CollectionJobEvent[] }>(`${apiBaseUrl}/collection/jobs/${encodeURIComponent(jobId)}/events`, {
								headers,
							});
							return [jobId, Array.isArray(res.data?.events) ? res.data.events : []] as const;
						} catch {
							return [jobId, []] as const;
						}
					})
				);
				setCollectionJobEventsByJobId(Object.fromEntries(eventEntries));
			} else {
				setCollectionJobEventsByJobId({});
			}
			setTaskProgress((prev) => {
				const next = { ...prev };
				for (const task of loadedTasks) {
					if (task.source_type !== 'host_cdp') continue;
					const latest = task.latest_job;
					const collectorJob = (latest?.detail?.collector_job || null) as CollectorJobPublic | null;
					const latestStatus = String(latest?.status || '').toUpperCase();
					if (isTerminalCollectorStatus(latestStatus)) {
						delete next[task.task_id];
						continue;
					}
					const jobId = String(collectorJob?.job_id || '').trim();
					if (!jobId) continue;
					const createdByDeviceId = String(collectorJob?.created_by_device_id || '').trim();
					if (createdByDeviceId && createdByDeviceId !== collectorDeviceId) {
						delete next[task.task_id];
						continue;
					}
					const status = String(collectorJob?.status || latest?.status || '').toUpperCase();
					const existing = next[task.task_id];
					if (
						jobId &&
						cancelledCollectorJobs[jobId] &&
						!isTerminalCollectorStatus(status) &&
						Date.now() - cancelledCollectorJobs[jobId] < 10 * 60 * 1000
					) {
						next[task.task_id] = {
							...existing,
							collectorJobId: jobId,
							collectorJob: { ...(collectorJob || {}), job_id: jobId, status: 'CANCELLED', error: 'user_cancelled' },
							message: 'Collector 작업을 사용자 요청으로 중단했습니다.',
							createdAt: Date.now(),
						};
						continue;
					}
					if (existing?.collectorJobId === jobId && existing?.message) {
						next[task.task_id] = { ...existing, collectorJob };
						continue;
					}
					next[task.task_id] = {
						...existing,
						collectorJobId: jobId,
						collectorJob,
						message: isTerminalCollectorStatus(status)
							? collectorProgressMessage(collectorJob, collectorJob?.last_event || null, collectorStatus)
							: `Collector 작업 복원됨: ${jobId}`,
						createdAt: latest?.started_at ? new Date(latest.started_at).getTime() : existing?.createdAt || Date.now(),
					};
				}
				return next;
			});
		} catch (e) {
			setError(errToMsg(e));
		} finally {
			if (!opts.background) setLoading(false);
		}
	};

	const refreshCollectorStatus = async () => {
		try {
			let health: any = null;
			let background: any = null;
			try {
				const [healthRes, backgroundRes] = await Promise.all([
					fetchWithTimeout(`${HOST_AGENT_LOCAL_ORIGIN}/health`, { cache: 'no-store' }),
					fetchWithTimeout(`${HOST_AGENT_LOCAL_ORIGIN}/collector/background/status`, { cache: 'no-store' }),
				]);
				const directHealth = await healthRes.json().catch(() => null);
				const directBackground = await backgroundRes.json().catch(() => null);
				if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
				health = directHealth;
				background = directBackground;
			} catch (directError) {
				if (accessMode !== 'nas') throw directError;
				// NAS 화면에서 localhost가 아직 안 떠 있는 상태면, 상태 조회만으로 브리지 팝업을 띄우지 않는다.
				// 이 경우 사용자가 "상태확인/재시작"을 눌러 agent를 먼저 띄우도록 유도한다.
				if (!(await canReachHostAgentLocally(1000))) throw directError;
				const bridged = await invokeCollectorBridge({ command: 'status' });
				health = bridged?.health || null;
				background = bridged?.status || null;
			}
			const merged = {
				...(background ? background : { running: false, state: 'UNKNOWN' }),
				agentReachable: true,
				agentVersion: String(health?.agentVersion || background?.agentVersion || ''),
				agentManageNo: String(health?.agentManageNo || background?.agentManageNo || ''),
				collectorVersion: String(health?.collectorVersion || background?.collectorVersion || health?.agentVersion || ''),
				collectorManageNo: String(health?.collectorManageNo || background?.collectorManageNo || health?.agentManageNo || ''),
				chromeUserDataDir: String(background?.chromeUserDataDir || health?.chromeUserDataDir || ''),
				chromeProfileDir: String(background?.chromeProfileDir || health?.chromeProfileDir || ''),
				chromeProfileLabel: String(background?.chromeProfileLabel || health?.chromeProfileLabel || ''),
				healthTime: String(health?.time || health?.updated_at || ''),
				checkedAt: new Date().toLocaleString(),
			};
			setCollectorStatus(merged);
		} catch (e: any) {
			setCollectorStatus({ running: false, state: 'UNREACHABLE', agentReachable: false, error: String(e?.message || e || '') });
		}
	};

	const startCollectorWithFreshTokens = async (): Promise<void> => {
		const token = await getIdToken({ forceRefresh: accessMode === 'nas' });
		if (accessMode === 'nas' && !token) {
			throw new Error('NAS Collector 시작에는 로그인 토큰이 필요합니다. 화면을 새로고침하거나 다시 로그인한 뒤 시작해 주세요.');
		}
		const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
		const collectorToken = await fetchCollectorWorkerToken(headers);
		if (accessMode === 'nas') {
			await assertNasCollectorToken(token || '');
			await invokeCollectorBridge({
				command: 'start',
				apiBaseUrl: absoluteApiBaseUrl(apiBaseUrl),
				bearerToken: token || '',
				collectorToken,
				deviceId: collectorWorkerDeviceId,
			});
		} else {
			const res = await fetch(`${HOST_AGENT_LOCAL_ORIGIN}/collector/background/start`, {
				method: 'POST',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					apiBaseUrl: absoluteApiBaseUrl(apiBaseUrl),
					bearerToken: token || '',
					collectorToken,
					deviceId: collectorWorkerDeviceId,
				}),
			});
			const data = await res.json().catch(() => ({} as any));
			if (!res.ok || data?.ok !== true) throw new Error(String(data?.error || `HTTP ${res.status}`));
		}
		await refreshCollectorStatus();
	};

	const checkOrRestartHostAgent = async () => {
		if (isHostAgentReachable) {
			await refreshCollectorStatus();
			return;
		}
		setCollectorBusy(true);
		setError('Host Agent 재시작을 요청했습니다. 브라우저의 외부 앱 열기 확인창이 뜨면 허용해 주세요.');
		try {
			window.location.href = HOST_AGENT_START_PROTOCOL_URL;
			if (await waitForHostAgentVersion(REQUIRED_HOST_AGENT_VERSION, REQUIRED_HOST_AGENT_MANAGE_NO, 20_000)) {
				setError(null);
				await refreshCollectorStatus();
				return;
			}
			setError('Host Agent 자동 재시작 확인이 되지 않았습니다. 설치/보조 실행 파일의 Host Agent 실행기를 열어 주세요.');
			await refreshCollectorStatus();
		} finally {
			setCollectorBusy(false);
		}
	};

	useEffect(() => {
		if (!collectorStatus?.agentReachable) return;
		if (isCollectorAgentLatest && isCollectorWorkerLatest) return;
		if (collectorAutoUpdating || collectorAutoUpdateAttemptedRef.current) return;
		if (!canAttemptHostAgentAutoUpdate(accessMode)) return;
		collectorAutoUpdateAttemptedRef.current = true;
		markHostAgentAutoUpdateAttempt(accessMode);
		let cancelled = false;
		const shouldRestartWorker = collectorStatus?.running === true;
		const run = async () => {
			setCollectorAutoUpdating(true);
			try {
				await runHostAgentSelfUpdate();
				const updated = await waitForHostAgentVersion(REQUIRED_HOST_AGENT_VERSION, REQUIRED_HOST_AGENT_MANAGE_NO, 35_000);
				if (shouldRestartWorker && updated && !cancelled) {
					await startCollectorWithFreshTokens();
					clearHostAgentAutoUpdateAttempt(accessMode);
					return;
				}
				clearHostAgentAutoUpdateAttempt(accessMode);
				window.setTimeout(() => {
					if (!cancelled) void refreshCollectorStatus();
				}, 7000);
			} catch (e) {
				setError(`Host Agent 자동 업데이트 실패: ${errToMsg(e)}`);
			} finally {
				if (!cancelled) setCollectorAutoUpdating(false);
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [collectorStatus?.agentReachable, collectorStatus?.running, isCollectorAgentLatest, isCollectorWorkerLatest, collectorAutoUpdating, accessMode]);

	const startCollector = async () => {
		setCollectorBusy(true);
		setError(null);
		try {
			await startCollectorWithFreshTokens();
		} catch (e) {
			setError(`Collector 시작 실패: ${errToMsg(e)}`);
		} finally {
			setCollectorBusy(false);
		}
	};

	const stopCollector = async () => {
		setCollectorBusy(true);
		setError(null);
		try {
			if (accessMode === 'nas') {
				await invokeCollectorBridge({ command: 'stop' });
			} else {
				const res = await fetch(`${HOST_AGENT_LOCAL_ORIGIN}/collector/background/stop`, { method: 'POST', cache: 'no-store' });
				const data = await res.json().catch(() => ({} as any));
				if (!res.ok || data?.ok !== true) throw new Error(String(data?.error || `HTTP ${res.status}`));
			}
			await refreshCollectorStatus();
		} catch (e) {
			setError(`Collector 중지 실패: ${errToMsg(e)}`);
		} finally {
			setCollectorBusy(false);
		}
	};

	const stopCollectorBackgroundSilently = async () => {
		try {
			if (accessMode === 'nas') {
				await invokeCollectorBridge({ command: 'stop' });
			} else {
				await fetch(`${HOST_AGENT_LOCAL_ORIGIN}/collector/background/stop`, { method: 'POST', cache: 'no-store' });
			}
		} catch {
			// 작업 중단은 서버 상태 정리를 우선하며, Agent가 이미 멈춘 경우는 무시한다.
		}
	};

	const stopHostAgent = async () => {
		setCollectorBusy(true);
		setError(null);
		try {
			try {
				await fetch(`${HOST_AGENT_LOCAL_ORIGIN}/shutdown`, { method: 'POST', cache: 'no-store' });
			} catch {
				// Agent shutdown can close the connection before the response is fully read.
			}
			setCollectorStatus({ running: false, state: 'UNREACHABLE', agentReachable: false });
		} catch (e) {
			setError(`Host Agent 중지 실패: ${errToMsg(e)}`);
		} finally {
			setCollectorBusy(false);
		}
	};

	const uploadGfaReport = async () => {
		if (!gfaReportFile) {
			setGfaMessage('result.csv 또는 ReportDownload_*.zip 파일을 선택하세요.');
			return;
		}
		setGfaBusy(true);
		setGfaMessage(null);
		try {
			const form = new FormData();
			form.append('file', gfaReportFile);
			const headers = await authHeaders();
			const res = await axios.post(`${apiBaseUrl}/gfa/reports/upload`, form, {
				headers: { ...headers, 'Content-Type': 'multipart/form-data' },
			});
			const inserted = Number(res.data?.inserted_total || 0);
			const dates = Array.isArray(res.data?.processed_dates) ? res.data.processed_dates.join(', ') : '';
			setGfaMessage(`GFA 보고서 업로드 완료: ${inserted.toLocaleString()}행 적재${dates ? ` (${dates})` : ''}`);
			await load();
		} catch (e) {
			setGfaMessage(`GFA 보고서 업로드 실패: ${errToMsg(e)}`);
		} finally {
			setGfaBusy(false);
		}
	};

	useEffect(() => {
		void load({ lightweight: true });
		const detailTimer = window.setTimeout(() => void load({ background: true }), 250);
		void refreshCollectorStatus();
		return () => window.clearTimeout(detailTimer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiBaseUrl]);

	useEffect(() => {
		const refreshFromExternalChange = () => {
			void load();
		};
		const onStorage = (event: StorageEvent) => {
			if (event.key === COLLECTION_DATA_CHANGED_STORAGE_KEY) refreshFromExternalChange();
		};
		window.addEventListener(COLLECTION_DATA_CHANGED_EVENT, refreshFromExternalChange);
		window.addEventListener('storage', onStorage);
		window.addEventListener('focus', refreshFromExternalChange);
		return () => {
			window.removeEventListener(COLLECTION_DATA_CHANGED_EVENT, refreshFromExternalChange);
			window.removeEventListener('storage', onStorage);
			window.removeEventListener('focus', refreshFromExternalChange);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiBaseUrl]);

	useEffect(() => {
		writeStoredTaskProgress(taskProgress);
	}, [taskProgress]);

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			if (cancelled) return;
			await refreshCollectorStatus();
		};
		const timer = window.setInterval(() => void tick(), 5000);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [accessMode]);

	const summary = useMemo(() => {
		const nas = tasks.filter((t) => t.preferred_runtime === 'nas').length;
		const collector = tasks.filter((t) => t.preferred_runtime === 'collector_pc').length;
		const manual = tasks.filter((t) => t.source_type === 'manual_import').length;
		return { total: tasks.length, nas, collector, manual };
	}, [tasks]);
	const latestSuccessByTask = useMemo(() => {
		const map = new Map<string, CollectionJob>();
		for (const task of tasks) {
			if (task.latest_success_job) map.set(task.task_id, task.latest_success_job);
		}
		for (const job of jobs) {
			if (String(job.status || '').toUpperCase() !== 'SUCCESS') continue;
			const current = map.get(job.task_id);
			if (!current || jobTimeMs(job) > jobTimeMs(current)) map.set(job.task_id, job);
		}
		return map;
	}, [jobs, tasks]);
	const hostSetupDownloads = useMemo(() => getHostSetupDownloads(accessMode === 'local' ? 'local' : 'nas'), [accessMode]);
	const hostAgentStartDownload = hostSetupDownloads.find((item) => item.path.includes('Run-Start-Analytics-HostAgent'));
	const otherHostSetupDownloads = hostSetupDownloads.filter((item) => item !== hostAgentStartDownload);

	const runTask = async (task: CollectionTask, opts?: { retryIncomplete?: boolean; force?: boolean }) => {
		const retryIncomplete = Boolean(opts?.retryIncomplete);
		const forceRecollect = (task.task_id === 'rank_openapi' && !retryIncomplete) || Boolean(opts?.force);
		const existingProgress = taskProgress[task.task_id];
		const existingStatus = String(existingProgress?.collectorJob?.status || '').toUpperCase();
		if (task.source_type === 'host_cdp' && existingProgress?.collectorJobId && !isTerminalCollectorStatus(existingStatus)) {
			setTaskProgress((prev) => ({
				...prev,
				[task.task_id]: {
					...(prev[task.task_id] || {}),
					message: `이미 진행 중인 Collector 작업이 있습니다: ${existingProgress.collectorJobId}`,
					createdAt: Date.now(),
				},
			}));
			await refreshCollectorStatus();
			return;
		}
		setRunningTasks((prev) => ({ ...prev, [task.task_id]: true }));
		setError(null);
		setTaskProgress((prev) => ({
			...prev,
			[task.task_id]: {
				...(prev[task.task_id] || {}),
				message:
					task.source_type === 'host_cdp'
						? forceRecollect && task.task_id === 'review_reply_backfill'
							? '기존 답글 본문 보강 상태를 초기화하고 처음부터 새로 수집합니다.'
							: retryIncomplete
							? task.task_id === 'rank_openapi'
								? '저장된 당일 오가닉 순위 데이터를 보존하고 누락 조합만 이어서 수집합니다.'
								: '누락/실패 셀만 재시도하는 Collector 작업을 생성하는 중입니다.'
							: task.task_id === 'review_reply_backfill'
								? '이미 저장된 답글 본문을 보존하고 남은 대상만 이어서 수집합니다.'
							: task.task_id === 'rank_openapi'
								? '당일 오가닉 순위 데이터를 삭제하고 처음부터 수집하는 Collector 작업을 생성하는 중입니다.'
								: 'Collector 작업을 생성하는 중입니다.'
						: accessMode === 'local'
							? '로컬 DB에 저장하는 중입니다.'
							: 'NAS DB에 저장하는 중입니다.',
				createdAt: Date.now(),
			},
		}));
		try {
			const headers = { ...(await authHeaders()), ...(task.source_type === 'host_cdp' ? await hostCdpHeaders() : {}) };
			const res = await axios.post(
				`${apiBaseUrl}/collection/tasks/${encodeURIComponent(task.task_id)}/run`,
				{
					mode: retryIncomplete ? 'retry_incomplete' : 'manual',
					force: forceRecollect,
					retry_incomplete: retryIncomplete,
					collector_device_id: collectorDeviceId,
				},
				{ headers: { ...headers, 'X-ERP2-Collector-Device-Id': collectorDeviceId } },
			);
			const result = res.data?.result || {};
			if (String(result?.status || '').toUpperCase() === 'SKIPPED' && result?.reason === 'ad_rank_no_incomplete_cells') {
				setTaskProgress((prev) => ({
					...prev,
					[task.task_id]: {
						...(prev[task.task_id] || {}),
						message: '누락/실패 셀이 없어 재시도할 항목이 없습니다.',
						createdAt: Date.now(),
					},
				}));
				await load();
				return;
			}
			const collectorJob = (result?.collector_job || res.data?.job?.detail?.collector_job || null) as CollectorJobPublic | null;
			const retryCells = Number(result?.retry_cell_count || 0);
			const retryUnits = Number(result?.retry_unit_count || 0);
			const retryHint =
				retryIncomplete && collectorJob?.job_id
					? ` · 재시도 ${retryCells.toLocaleString()}셀 / ${retryUnits.toLocaleString()}단위`
					: '';
			setTaskProgress((prev) => ({
				...prev,
				[task.task_id]: {
					collectorJobId: collectorJob?.job_id || null,
					collectorJob,
					message: collectorJob?.job_id
						? `Collector 작업 생성됨: ${collectorJob.job_id}${retryHint}`
						: '작업 생성 요청이 완료되었습니다.',
					createdAt: Date.now(),
				},
			}));
			await load();
		} catch (e) {
			setError(errToMsg(e));
			setTaskProgress((prev) => ({
				...prev,
				[task.task_id]: {
					...(prev[task.task_id] || {}),
					message: `작업 생성 실패: ${errToMsg(e)}`,
					createdAt: Date.now(),
				},
			}));
		} finally {
			setRunningTasks((prev) => {
				const next = { ...prev };
				delete next[task.task_id];
				return next;
			});
		}
	};

	const cancelCollectorTask = async (task: CollectionTask, progress?: TaskProgress | null) => {
		const collectorJobId = String(progress?.collectorJobId || '').trim();
		if (!collectorJobId) return;
		setCancellingTasks((prev) => ({ ...prev, [task.task_id]: true }));
		setError(null);
		try {
			const headers = await authHeaders();
			const res = await axios.post<CollectorJobPublic>(
				`${apiBaseUrl}/search-rank/page-metrics/local-collector/jobs/${encodeURIComponent(collectorJobId)}/cancel`,
				{},
				{ headers },
			);
			const collectorJob = res.data || { job_id: collectorJobId, status: 'CANCELLED' };
			setCancelledCollectorJobs((prev) => ({ ...prev, [collectorJobId]: Date.now() }));
			setTaskProgress((prev) => ({
				...prev,
				[task.task_id]: {
					...(prev[task.task_id] || {}),
					collectorJobId,
					collectorJob,
					message: 'Collector 작업을 사용자 요청으로 중단했습니다.',
					createdAt: Date.now(),
				},
			}));
			await load();
			await refreshCollectorStatus();
		} catch (e) {
			const msg = errToMsg(e);
			if (/collector_job_not_found|404/i.test(msg)) {
				setTaskProgress((prev) => {
					const next = { ...prev };
					delete next[task.task_id];
					return next;
				});
				await load();
				await refreshCollectorStatus();
			} else {
				setError(`Collector 중단 실패: ${msg}`);
			}
		} finally {
			setCancellingTasks((prev) => {
				const next = { ...prev };
				delete next[task.task_id];
				return next;
			});
		}
	};

	const cancelRankOpenapiTask = async (task: CollectionTask) => {
		const categoryJobId =
			String(task.latest_job?.detail?.analytics_job_id || '').trim() ||
			String(task.latest_job?.detail?.detail?.job_id || '').trim();
		setCancellingTasks((prev) => ({ ...prev, [task.task_id]: true }));
		setError(null);
		try {
			const headers = await authHeaders();
			if (categoryJobId) {
				await axios.post(
					`${apiBaseUrl}/search-rank/crawl/category/cancel`,
					{ job_id: categoryJobId },
					{ headers },
				);
			} else {
				await axios.post(`${apiBaseUrl}/search-rank/crawl/category/cancel-active`, {}, { headers });
			}
			setTaskProgress((prev) => ({
				...prev,
				[task.task_id]: {
					...(prev[task.task_id] || {}),
					message: '검색/쇼핑 순위 수집을 사용자 요청으로 중단했습니다.',
					createdAt: Date.now(),
				},
			}));
			await load();
		} catch (e) {
			setError(`검색/쇼핑 순위 수집 중단 실패: ${errToMsg(e)}`);
		} finally {
			setCancellingTasks((prev) => {
				const next = { ...prev };
				delete next[task.task_id];
				return next;
			});
		}
	};

	useEffect(() => {
		const activeEntries = Object.entries(taskProgress).filter(([, p]) => {
			const s = String(p.collectorJob?.status || '').toUpperCase();
			return p.collectorJobId && !isTerminalCollectorStatus(s);
		});
		if (activeEntries.length === 0) return undefined;
		const timer = window.setInterval(() => {
			void (async () => {
				try {
					const headers = await authHeaders();
					const [eventRes, ...jobResponses] = await Promise.all([
						axios.get<{ ok: boolean; events: CollectorEvent[] }>(`${apiBaseUrl}/search-rank/page-metrics/local-collector/events`, { headers, params: { limit: 30 } }),
						...activeEntries.map(([taskId, p]) =>
							axios
								.get<CollectorJobPublic>(`${apiBaseUrl}/search-rank/page-metrics/local-collector/jobs/${encodeURIComponent(String(p.collectorJobId || ''))}`, { headers })
								.then((res) => ({ taskId, job: res.data }))
								.catch((e) => ({ taskId, error: errToMsg(e) })),
						),
					]);
					const events = Array.isArray(eventRes.data?.events) ? eventRes.data.events : [];
					setCollectorEvents(events);
					setTaskProgress((prev) => {
						const next = { ...prev };
						for (const item of jobResponses) {
							const current = next[item.taskId] || {};
							if ('job' in item) {
								const jobId = String(item.job.job_id || '').trim();
								const jobStatus = String(item.job.status || '').toUpperCase();
								if (
									jobId &&
									cancelledCollectorJobs[jobId] &&
									!isTerminalCollectorStatus(jobStatus) &&
									Date.now() - cancelledCollectorJobs[jobId] < 10 * 60 * 1000
								) {
									next[item.taskId] = {
										...current,
										collectorJobId: jobId,
										collectorJob: { ...item.job, status: 'CANCELLED', error: 'user_cancelled' },
										message: 'Collector 작업을 사용자 요청으로 중단했습니다.',
									};
									continue;
								}
								const last = events
									.filter((event) => event.job_id && event.job_id === item.job.job_id)
									.slice(-1)[0];
								next[item.taskId] = {
									...current,
									collectorJob: item.job,
									message: collectorProgressMessage(item.job, last, collectorStatus),
								};
							} else {
								const errorText = String(item.error || '');
								if (/collector_job_not_found|404/i.test(errorText)) {
									delete next[item.taskId];
								} else {
									next[item.taskId] = { ...current, message: `Collector 상태 조회 실패: ${item.error}` };
								}
							}
						}
						return next;
					});
					const anyFinished = jobResponses.some((item) => {
						if (!('job' in item)) return false;
						const jobId = String(item.job.job_id || '').trim();
						const jobStatus = String(item.job.status || '').toUpperCase();
						const locallyCancelled =
							jobId &&
							cancelledCollectorJobs[jobId] &&
							Date.now() - cancelledCollectorJobs[jobId] < 10 * 60 * 1000;
						return locallyCancelled || isTerminalCollectorStatus(jobStatus);
					});
					const stillActive = jobResponses.some((item) => {
						if (!('job' in item)) return false;
						const jobId = String(item.job.job_id || '').trim();
						const jobStatus = String(item.job.status || '').toUpperCase();
						const locallyCancelled =
							jobId &&
							cancelledCollectorJobs[jobId] &&
							Date.now() - cancelledCollectorJobs[jobId] < 10 * 60 * 1000;
						return !locallyCancelled && !isTerminalCollectorStatus(jobStatus);
					});
					if (anyFinished || !stillActive) void load();
				} catch (e) {
					setError(`진행 상태 갱신 실패: ${errToMsg(e)}`);
				}
			})();
		}, 2500);
		return () => window.clearInterval(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apiBaseUrl, cancelledCollectorJobs, taskProgress]);

	const saveSchedule = async (task: CollectionTask, patch: Partial<Pick<CollectionTask, 'enabled' | 'schedule_enabled' | 'schedule_time'>>) => {
		setSavingTaskId(task.task_id);
		setError(null);
		try {
			const headers = await authHeaders();
			await axios.put(`${apiBaseUrl}/collection/tasks/${encodeURIComponent(task.task_id)}/schedule`, patch, { headers });
			await load();
		} catch (e) {
			setError(errToMsg(e));
		} finally {
			setSavingTaskId(null);
		}
	};

	return (
		<div style={{ display: 'grid', gap: 16 }}>
			<div className="card">
				<div className="card-title">데이터 수집</div>
				<p style={{ margin: '8px 0 0', color: '#64748b', lineHeight: 1.6 }}>
					API, NAS 배치, CDP, 파일 업로드로 흩어진 수집을 중앙에서 관리합니다. NAS에서 가능한 작업은 NAS가 직접 실행하고,
					로그인/브라우저가 필요한 작업은 24시간 켜진 일반 PC의 설치형 Collector가 백그라운드에서 가져가 실행합니다.
				</p>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
					<span style={badgeStyle('muted')}>전체 {summary.total}</span>
					<span style={badgeStyle('ok')}>NAS 단독 {summary.nas}</span>
					<span style={badgeStyle('warn')}>Collector PC {summary.collector}</span>
					<span style={badgeStyle('danger')}>수동 업로드 잔존 {summary.manual}</span>
					<span style={badgeStyle(accessMode === 'local' ? 'warn' : accessMode === 'nas' ? 'ok' : 'muted')}>{accessModeLabel}</span>
				</div>
				<div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
					{accessMode === 'local'
						? '개발 PC 로컬 접속에서는 수집 결과가 로컬 DB에 저장됩니다. NAS DB와 맞출 때는 메뉴동기화의 양방향 DB 맞춤을 사용하세요.'
						: accessMode === 'nas'
							? 'NAS 접속 또는 24시간 운영 PC에서는 수집 결과와 자동 스케줄 설정이 NAS DB에 저장됩니다.'
							: '접속 환경을 판별하지 못해 NAS 전용 작업 실행이 제한될 수 있습니다.'}
				</div>
			</div>

			{error ? <div className="card" style={{ color: '#b91c1c', fontWeight: 800 }}>{error}</div> : null}

			<div className="card" style={{ display: 'grid', gap: 12 }}>
				<div className="card-title">24시간 PC Collector</div>
				<div style={{ color: '#64748b', lineHeight: 1.6 }}>
					NAS에서 모든 수집이 가능하면 필요 없지만, 로그인/CDP/브라우저 세션이 필요한 작업은 개발 PC가 아닌 일반 PC에 Collector를
					설치해 운영할 수 있습니다. 이 PC는 켜져 있기만 하면 중앙 작업을 백그라운드에서 가져갑니다.
				</div>
				<div style={{ display: 'grid', gap: 10 }}>
					<div style={{ display: 'grid', gap: 6 }}>
						<div style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>상태</div>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
							<span style={badgeStyle(hostAgentHealthTone)}>
								{hostAgentHealthLabel}
							</span>
							<span style={badgeStyle(workerHealthTone)}>
								{workerHealthLabel}
							</span>
							<span style={badgeStyle('muted')}>
								Web 요구 Agent No. {REQUIRED_HOST_AGENT_MANAGE_NO}
							</span>
							<span style={badgeStyle(isCollectorAgentLatest ? 'ok' : !isHostAgentReachable ? 'danger' : 'warn')}>
								실행 Agent No. {collectorAgentManageNo || '미확인'}
								{isCollectorAgentLatest ? ' · 적용됨' : ' · 미적용'}
							</span>
							{collectorStatus?.running ? (
								<span style={badgeStyle(isCollectorWorkerReady ? 'ok' : 'warn')}>
									실행 Worker No. {collectorWorkerManageNo || '미확인'}
									{isCollectorWorkerReady ? ' · 적용됨' : !isCollectorWorkerTargetMatched ? ' · 연결 대상 재시작 필요' : ' · 미적용'}
								</span>
							) : null}
						</div>
					</div>
					<div style={{ display: 'grid', gap: 8, border: '1px solid rgba(148, 163, 184, 0.22)', borderRadius: 12, padding: 12, background: 'rgba(15, 23, 42, 0.38)' }}>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
							<div style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>CDP 브라우저 환경</div>
							<span style={badgeStyle('muted')}>기본 CDP 프로필 사용</span>
						</div>
						<div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
							계정별 Chrome 프로필 선택은 사용하지 않습니다. Collector는 Host Agent의 기본 CDP 브라우저 환경으로 실행되며,
							필요한 로그인 세션은 해당 기본 CDP 창에 유지됩니다.
						</div>
						{collectorStatus?.chromeUserDataDir ? (
							<div style={{ fontSize: 12, color: '#64748b' }}>
								실행 CDP 경로: {collectorStatus.chromeUserDataDir} · {collectorStatus?.chromeProfileDir || 'Default'}
							</div>
						) : null}
					</div>
					<div style={{ display: 'grid', gap: 6 }}>
						<div style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>동작</div>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
							<div
								style={{
									display: 'flex',
									gap: 8,
									flexWrap: 'wrap',
									alignItems: 'center',
									border: '1px solid rgba(148, 163, 184, 0.28)',
									borderRadius: 10,
									padding: '8px 10px',
									background: 'rgba(15, 23, 42, 0.55)',
								}}
							>
								<span style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>Host Agent</span>
								<button type="button" className={isHostAgentReachable ? 'btn-ghost' : 'btn-primary'} onClick={() => void checkOrRestartHostAgent()} disabled={collectorBusy}>
									{hostAgentStatusButtonLabel}
								</button>
								{isHostAgentReachable && (!isCollectorAgentLatest || !isCollectorWorkerLatest) ? (
									<button type="button" className="btn-primary" onClick={() => void upgradeHostAgent()} disabled={collectorBusy}>
										{collectorAutoUpdating ? '업그레이드 중' : '업그레이드'}
									</button>
								) : null}
								{hostAgentStartDownload ? (
									<a
										className={hostAgentLauncherDisabled ? 'btn-ghost' : 'btn-primary'}
										href={hostAgentLauncherDisabled ? undefined : hostAgentStartDownload.path}
										download={hostAgentLauncherDisabled ? undefined : hostAgentStartDownload.downloadName}
										aria-disabled={hostAgentLauncherDisabled}
										style={hostAgentLauncherDisabled ? { ...disabledActionStyle, background: '#334155', color: '#94a3b8' } : undefined}
										title={hostAgentLauncherTitle}
									>
										{hostAgentLauncherLabel}
									</a>
								) : null}
								<button type="button" className={hostAgentStopEnabled ? 'btn-primary' : 'btn-ghost'} onClick={() => void stopHostAgent()} disabled={!hostAgentStopEnabled}>
									중지
								</button>
							</div>
							<div
								style={{
									display: 'flex',
									gap: 8,
									flexWrap: 'wrap',
									alignItems: 'center',
									border: '1px solid rgba(148, 163, 184, 0.28)',
									borderRadius: 10,
									padding: '8px 10px',
									background: 'rgba(15, 23, 42, 0.55)',
								}}
							>
								<span style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>백그라운드</span>
								<button type="button" className="btn-primary" onClick={() => void startCollector()} disabled={backgroundStartDisabled}>
									시작
								</button>
								<button type="button" className={stopCollectorEnabled ? 'btn-primary' : 'btn-ghost'} onClick={() => void stopCollector()} disabled={!stopCollectorEnabled}>
									중지
								</button>
							</div>
						</div>
					</div>
				</div>
				<div style={{ fontSize: 12, color: isCollectorAgentLatest && isCollectorWorkerReady ? '#64748b' : '#92400e', lineHeight: 1.6, display: 'grid', gap: 2 }}>
					<div>
						Web 이미지 요구값: Agent No. {REQUIRED_HOST_AGENT_MANAGE_NO} · 버전 {REQUIRED_HOST_AGENT_VERSION}
					</div>
					<div>
						실제 실행 Agent: No. {collectorAgentManageNo || '미확인'} · 버전 {collectorAgentVersion || '미확인'}
					</div>
					{collectorStatus?.running ? (
						<div>
							실제 실행 Worker: No. {collectorWorkerManageNo || '미확인'} · 버전 {collectorWorkerVersion || '미확인'}
						</div>
					) : null}
					{collectorStatus?.running && !isCollectorWorkerTargetMatched ? (
						<div>
							Worker API: 현재 {collectorApiBaseUrl || '미확인'} · 필요 {expectedCollectorApiBaseUrl}
							{!isCollectorWorkerDeviceMatched ? ` · Worker Device: 현재 ${collectorStatusDeviceId || '미확인'} · 필요 ${collectorWorkerDeviceId}` : ''}
						</div>
					) : null}
					<div>
						{collectorStatus?.healthTime ? `Agent health 시각: ${collectorStatus.healthTime}` : ''}
						{collectorStatus?.checkedAt ? ` · UI 확인 시각: ${collectorStatus.checkedAt}` : ''}
						{collectorStatus?.updated_at ? ` · Worker 갱신 시각: ${collectorStatus.updated_at}` : ''}
					</div>
					<br />
					{!isCollectorWorkerTargetMatched
						? 'Worker가 현재 접속 환경과 다른 API 또는 브라우저 device id에 연결되어 있습니다. 백그라운드 시작을 누르면 현재 브라우저 기준으로 재시작합니다.'
						: isWorkerAuthError
							? 'Worker가 NAS API 인증에 실패했습니다. 중지 후 화면을 새로고침하거나 다시 로그인한 뒤 백그라운드 시작을 눌러 주세요.'
						: isWorkerTransientAuthRetry
							? 'Worker가 일시적인 인증 응답을 받아 자동 재시도 중입니다. 연속 실패가 누적될 때만 인증 오류로 전환됩니다.'
						: 'Host Agent가 꺼져 있으면 브라우저 보안상 실행기 다운로드로 동작합니다. 실행기를 열면 상태가 자동 갱신됩니다.'}
				</div>
				{collectorStatus?.apiBaseUrl ? <div style={{ fontSize: 12, color: '#64748b' }}>연결 API: {collectorStatus.apiBaseUrl}</div> : null}
				<div style={{ display: 'grid', gap: 6 }}>
					<div style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>설치/보조 실행 파일</div>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
					{otherHostSetupDownloads.map((d) => (
						<a key={d.path} className="btn-ghost" href={d.path} download={d.downloadName}>
							{d.label}
						</a>
					))}
					</div>
				</div>
				<div style={{ display: 'grid', gap: 6 }}>
					<div style={{ fontWeight: 900, fontSize: 13 }}>최근 Collector 이벤트</div>
					{collectorEvents.length === 0 ? <div style={{ fontSize: 12, color: '#64748b' }}>아직 중앙 이벤트가 없습니다.</div> : null}
					{collectorEvents.slice(-5).reverse().map((event, idx) => (
						<div key={`${event.time || ''}-${event.device_id || ''}-${idx}`} style={{ fontSize: 12, color: '#64748b' }}>
							<span style={badgeStyle(statusTone(event.status))}>{event.status || 'INFO'}</span>{' '}
							{event.device_id || 'unknown'} · {formatCollectorNote(event.note, 240)} · {event.time ? new Date(event.time).toLocaleString() : '-'}
						</div>
					))}
				</div>
			</div>

			<div className="card" style={{ display: 'grid', gap: 12 }}>
				<div className="card-title">GFA 성과보고서 복구용 업로드</div>
				<div style={{ color: '#64748b', lineHeight: 1.6 }}>
					GFA 표준 수집은 아래 “수집 작업”의 GFA 성과보고서 작업에서 실행/스케줄/진행 상태를 관리합니다.
					이 업로드는 Collector 실패나 누락 데이터 복구가 필요할 때만 `result.csv` 또는 `ReportDownload_*.zip`을 직접 넣는 예외 경로입니다.
				</div>
				<div
					style={{
						display: 'grid',
						gap: 10,
						border: '1px solid rgba(148, 163, 184, 0.28)',
						borderRadius: 12,
						padding: 12,
						background: 'rgba(15, 23, 42, 0.55)',
					}}
				>
					<div style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>복구용 파일 업로드</div>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
						<input type="file" accept=".csv,.zip" onChange={(e) => setGfaReportFile(e.target.files?.[0] ?? null)} />
						<button type="button" className="btn-primary" onClick={() => void uploadGfaReport()} disabled={gfaBusy}>
							GFA 보고서 업로드
						</button>
					</div>
				</div>
				{gfaMessage ? (
					<div style={{ fontSize: 12, color: /완료|생성됨|생성했습니다/.test(gfaMessage) ? '#bbf7d0' : '#fecaca', lineHeight: 1.5 }}>
						{gfaMessage}
					</div>
				) : null}
			</div>

			<div className="card" style={{ display: 'grid', gap: 12 }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
					<div className="card-title">수집 작업</div>
					<button type="button" className="btn-ghost" onClick={() => void load()} disabled={loading}>
						{loading ? '새로고침 중' : '새로고침'}
					</button>
				</div>
				<div style={{ display: 'grid', gap: 10 }}>
					{tasks.map((task) => {
						const latest = task.latest_job;
						const latestStatus = String(latest?.status || '').toUpperCase();
						const rawLatestCollector = (latest?.detail?.collector_job || null) as CollectorJobPublic | null;
						const latestCollector =
							isTerminalCollectorStatus(latestStatus) ||
							(String(rawLatestCollector?.created_by_device_id || '').trim() &&
								String(rawLatestCollector?.created_by_device_id || '').trim() !== collectorDeviceId)
								? null
								: rawLatestCollector;
						const transientProgress = taskProgress[task.task_id] || null;
						const latestStartedAt = latest?.started_at ? new Date(latest.started_at).getTime() : 0;
						const transientStartedAt = transientProgress?.createdAt || 0;
						let progress =
							transientProgress && (!latestStartedAt || transientStartedAt >= latestStartedAt)
								? transientProgress
								: latestCollector
									? { collectorJob: latestCollector, collectorJobId: latestCollector.job_id }
									: transientProgress;
						if (
							latestCollector?.job_id &&
							progress?.collectorJobId &&
							latestCollector.job_id !== progress.collectorJobId
						) {
							progress = { collectorJob: latestCollector, collectorJobId: latestCollector.job_id };
						}
						const persistedCollectorEvents = (collectionJobEventsByJobId[latest?.job_id || ''] || [])
							.map(collectorEventFromJobEvent)
							.filter(Boolean) as CollectorEvent[];
						const collectorEventsForJob = [
							...collectorEvents.filter((event) => event.job_id && event.job_id === progress?.collectorJobId),
							...persistedCollectorEvents,
						].sort((a, b) => collectorEventTimeMs(a) - collectorEventTimeMs(b));
						const newestCollectorEvent = progress?.collectorJob?.last_event || collectorEventsForJob.slice(-1)[0] || null;
						const eventWithProgress = [progress?.collectorJob?.last_event || null, ...collectorEventsForJob]
							.filter(Boolean)
							.reverse()
							.find((event) => collectorProgressCount(null, event as CollectorEvent, null)) as CollectorEvent | undefined;
						const lastProgressEvent = newestCollectorEvent;
						const scopedCollectorStatus = collectorStatusForJob(collectorStatus, progress?.collectorJobId || null);
						const resultSummary = formatCollectionResult(latest, task.latest_success_job || latestSuccessByTask.get(task.task_id) || null);
						const savedRankProgressCount = collectionProgressFromTaskSavedRows(task);
						const isTerminalHostCollectorJob = task.source_type === 'host_cdp' && isTerminalCollectorStatus(latestStatus);
						const terminalProgressCount = isTerminalHostCollectorJob ? collectionProgressFromJob(latest) : null;
						const terminalProgressMessage = isTerminalHostCollectorJob ? resultSummary.detail : null;
						const progressStatus = isTerminalHostCollectorJob
							? latestStatus
							: progress?.collectorJob?.status || lastProgressEvent?.status || (task.source_type === 'host_cdp' ? latestStatus : null);
						const progressMessage = isTerminalHostCollectorJob
							? terminalProgressMessage
							: progress?.message || (progress ? collectorProgressMessage(progress.collectorJob, lastProgressEvent, scopedCollectorStatus) : null) || terminalProgressMessage;
						const liveProgressCount =
							collectorProgressCount(progress?.collectorJob || null, lastProgressEvent, scopedCollectorStatus) ||
							(eventWithProgress ? collectorProgressCount(null, eventWithProgress, null) : null);
						const organicRankResumeBase = Number(
							progress?.collectorJob?.params?.resume_skipped_keywords ??
							latest?.detail?.collector_job?.params?.resume_skipped_keywords ??
							savedRankProgressCount?.current ??
							0,
						);
						const combinedOrganicRankProgressCount =
							savedRankProgressCount && liveProgressCount && task.task_id === 'rank_openapi'
								? formatProgressCount(organicRankResumeBase + liveProgressCount.current, savedRankProgressCount.total)
								: savedRankProgressCount;
						const progressCount =
							combinedOrganicRankProgressCount ||
							terminalProgressCount ||
							liveProgressCount;
						const isRetryProgress = isRetryIncompleteCollectorJob(progress?.collectorJob || null, lastProgressEvent || eventWithProgress || null, scopedCollectorStatus);
						const progressDisplayPrefix = combinedOrganicRankProgressCount && liveProgressCount ? '수집진행' : savedRankProgressCount ? '수집완료' : isRetryProgress ? '이어받기 대상' : '수집현황';
						const collectorDateRange = formatCollectorDateRange(progress?.collectorJob || latestCollector);
						const savedDateSummary = formatSavedByDate(latest);
						const pendingCollectionSummary = formatPendingCollection(task);
						const nonOperatingCollectionNote = formatNonOperatingCollectionNote(task);
						const isSaving = savingTaskId === task.task_id;
						const isRunning = Boolean(runningTasks[task.task_id]);
						const isCancelling = Boolean(cancellingTasks[task.task_id]);
						const isNasRuntimeTask = String(task.preferred_runtime || '') === 'nas';
						const canRunInCurrentAccess = task.runnable && (!isNasRuntimeTask || accessMode === 'local' || accessMode === 'nas');
						const canEditScheduleInCurrentAccess = accessMode === 'local' || accessMode === 'nas';
						const runDisabledReason = !task.runnable
							? '아직 직접 실행이 연결되지 않은 작업입니다.'
							: !canRunInCurrentAccess
								? '접속 환경을 확인할 수 없어 NAS 작업 실행을 막았습니다.'
								: accessMode === 'local' && isNasRuntimeTask
									? '로컬 접속 기준으로 로컬 DB에 저장됩니다. 운영 NAS 설정은 NAS URL에서 별도로 관리됩니다.'
									: undefined;
						const isCollectorTask = task.source_type === 'host_cdp';
						const isCollectorActive = isCollectorTask && Boolean(progress?.collectorJobId) && !isTerminalCollectorStatus(progressStatus);
						const isRankOpenapiServerActive =
							task.task_id === 'rank_openapi' &&
							activeCollectionStatuses.has(latestStatus);
						const canCancelActiveTask = isCollectorActive || isRankOpenapiServerActive;
						const supportsRetryIncomplete = Boolean(task.supports_retry_incomplete) || task.task_id === 'ad_rank_diagnosis_cdp';
						const hasAdRankResumeTargets = task.task_id === 'ad_rank_diagnosis_cdp' && Number(adRankRetryPreview?.retry_unit_count || 0) > 0;
						const prefersResumeRun = task.task_id === 'ad_rank_diagnosis_cdp' && supportsRetryIncomplete && hasAdRankResumeTargets;
						const isReviewReplyBackfillTask = task.task_id === 'review_reply_backfill';
						const isOrganicRankTask = task.task_id === 'rank_openapi';
						const showRetryIncompleteButton = supportsRetryIncomplete && !canCancelActiveTask && (task.task_id !== 'ad_rank_diagnosis_cdp' || hasAdRankResumeTargets);
						const inlineError = formatInlineCollectionError(latest);
						const displayResultSummary = canCancelActiveTask
							? {
								tone: 'warn' as const,
								title: '백그라운드 진행 중',
								detail: isRankOpenapiServerActive
									? '검색/쇼핑 순위 수집이 서버에서 진행 중입니다. 중단 버튼으로 현재 작업을 취소할 수 있습니다.'
									: collectorDateRange
										? `${collectorDateRange} 데이터를 백그라운드에서 수집 중입니다. 완료 후 저장 검증을 진행합니다.`
										: 'Collector PC가 백그라운드에서 수집 중입니다. 완료 후 저장 검증을 진행합니다.',
							}
							: resultSummary;
						return (
							<div
								key={task.task_id}
								style={{
									border: '1px solid rgba(148, 163, 184, 0.28)',
									borderRadius: 12,
									padding: 14,
									display: 'grid',
									gap: 10,
									background: 'rgba(15, 23, 42, 0.72)',
									color: '#e5e7eb',
								}}
							>
								<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
									<div>
										<div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative' }}>
											<span style={{ fontWeight: 900, color: '#f8fafc' }}>{task.label}</span>
											{task.description ? (
												<span
													role="button"
													tabIndex={0}
													aria-label={`${task.label} 설명`}
													onMouseEnter={() => setHoveredDescriptionTaskId(task.task_id)}
													onMouseLeave={() => setHoveredDescriptionTaskId((current) => (current === task.task_id ? null : current))}
													onFocus={() => setHoveredDescriptionTaskId(task.task_id)}
													onBlur={() => setHoveredDescriptionTaskId((current) => (current === task.task_id ? null : current))}
													style={{
														width: 16,
														height: 16,
														borderRadius: 999,
														display: 'inline-flex',
														alignItems: 'center',
														justifyContent: 'center',
														border: '1px solid rgba(203, 213, 225, 0.75)',
														color: '#cbd5e1',
														fontSize: 11,
														fontWeight: 900,
														cursor: 'help',
														lineHeight: 1,
													}}
												>
													!
													{hoveredDescriptionTaskId === task.task_id ? (
														<span
															style={{
																position: 'absolute',
																left: '100%',
																top: '50%',
																transform: 'translate(8px, -50%)',
																zIndex: 20,
																width: 360,
																maxWidth: 'min(360px, 70vw)',
																padding: '9px 10px',
																borderRadius: 10,
																background: '#0f172a',
																border: '1px solid rgba(148, 163, 184, 0.45)',
																boxShadow: '0 12px 28px rgba(0, 0, 0, 0.35)',
																color: '#e5e7eb',
																fontSize: 12,
																fontWeight: 700,
																lineHeight: 1.5,
																whiteSpace: 'normal',
															}}
														>
															{task.description}
														</span>
													) : null}
												</span>
											) : null}
										</div>
									</div>
									<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
										<span style={badgeStyle(task.enabled ? 'ok' : 'muted')}>{task.enabled ? '활성' : '비활성'}</span>
										<span style={badgeStyle(task.requires_installed_collector ? 'warn' : 'ok')}>
											{runtimeLabel[String(task.preferred_runtime || '')] || task.preferred_runtime || '미정'}
										</span>
										<span style={badgeStyle('muted')}>{sourceLabel[task.source_type] || task.source_type}</span>
									</div>
								</div>

								<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
									<label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#e5e7eb', fontWeight: 800 }}>
										<input
											type="checkbox"
											checked={task.enabled}
											disabled={isSaving}
											onChange={(e) => void saveSchedule(task, { enabled: e.target.checked })}
										/>
										작업 활성화
									</label>
									<label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#e5e7eb', fontWeight: 800 }}>
										<input
											type="checkbox"
											checked={task.schedule_enabled}
											disabled={isSaving || !task.runnable || !canEditScheduleInCurrentAccess}
											onChange={(e) => void saveSchedule(task, { schedule_enabled: e.target.checked })}
										/>
										매일 자동 실행
									</label>
									<input
										className="input"
										type="time"
										value={task.schedule_time || ''}
										disabled={isSaving || !task.runnable || !canEditScheduleInCurrentAccess}
										style={{ width: 150, minWidth: 150, flex: '0 0 150px' }}
										onChange={(e) => void saveSchedule(task, { schedule_time: e.target.value })}
									/>
									<button
										type="button"
										className={canCancelActiveTask ? 'btn-ghost' : 'btn-primary'}
										disabled={canCancelActiveTask ? isCancelling : !canRunInCurrentAccess || isRunning}
										onClick={() => {
											if (isCollectorActive) {
												void cancelCollectorTask(task, progress);
											} else if (isRankOpenapiServerActive) {
												void cancelRankOpenapiTask(task);
											} else {
												void runTask(task, { retryIncomplete: prefersResumeRun });
											}
										}}
										style={{
											flex: '0 0 auto',
											whiteSpace: 'nowrap',
											...(canCancelActiveTask ? { borderColor: 'rgba(248, 113, 113, 0.55)', color: '#fecaca' } : {}),
										}}
										title={canCancelActiveTask ? '현재 수집 작업을 중단합니다.' : runDisabledReason}
									>
										{canCancelActiveTask
											? isCancelling
												? '중단 중'
												: '작업 중단'
											: isRunning
												? '실행 중'
												: prefersResumeRun
													? '이어서 수집'
													: isReviewReplyBackfillTask
														? '이어서 수집'
													: isOrganicRankTask
														? '새로 시작'
													: task.source_type === 'host_cdp'
														? 'Collector 작업 생성'
														: '지금 실행'}
									</button>
									{showRetryIncompleteButton ? (
										<button
											type="button"
											className="btn-ghost"
											disabled={!canRunInCurrentAccess || isRunning}
											onClick={() => void runTask(task, isReviewReplyBackfillTask ? { force: true } : { retryIncomplete: !prefersResumeRun })}
											style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
											title={
												isReviewReplyBackfillTask
													? '기존 답글 본문 보강 상태를 초기화하고 답글 있음 대상 전체를 처음부터 다시 수집합니다.'
													:
												isOrganicRankTask
													? '저장된 당일 오가닉 순위 데이터를 유지하고, 아직 저장되지 않은 keyword×상품 조합만 이어서 수집합니다.'
													: prefersResumeRun
													? '기존 정상 저장 데이터도 다시 지나가며 전체 조건을 처음부터 재수집합니다.'
													: '누락(missing) 또는 조회실패(failed) 셀만 다시 수집합니다. 전체 재수집이 아닙니다.'
											}
										>
											{isReviewReplyBackfillTask ? '새로 수집' : isOrganicRankTask ? '이어서 시작' : prefersResumeRun ? '처음부터 재수집' : '누락/실패만 재시도'}
										</button>
									) : null}
								</div>
								{runDisabledReason ? <div style={{ fontSize: 12, color: accessMode === 'local' && isNasRuntimeTask ? '#fbbf24' : '#94a3b8' }}>{runDisabledReason}</div> : null}

								<div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', gap: 8, flexWrap: 'wrap', lineHeight: 1.5, alignItems: 'center' }}>
									<span style={badgeStyle(displayResultSummary.tone)}>{displayResultSummary.title}</span>
									<span style={{ flex: '1 1 520px', minWidth: 0, overflowWrap: 'anywhere' }}>{displayResultSummary.detail}</span>
									{latest ? (
										<>
											<span>{latest.started_at ? new Date(latest.started_at).toLocaleString() : ''}</span>
											{inlineError ? <span style={{ color: '#b91c1c' }}>{inlineError}</span> : null}
										</>
									) : (
										<span>최근 실행 없음</span>
									)}
								</div>
								{task.source_type === 'host_cdp' ? (
									<div
										style={{
											border: '1px solid rgba(251, 191, 36, 0.35)',
											background: 'rgba(15, 23, 42, 0.65)',
											borderRadius: 10,
											padding: 10,
											display: 'grid',
											gap: 6,
											color: '#e5e7eb',
										}}
									>
										<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
											<span style={{ fontWeight: 900 }}>Collector 진행 상황</span>
											<span style={badgeStyle(statusTone(progressStatus))}>{progressStatus || '대기/없음'}</span>
											{progressCount ? <span style={badgeStyle('ok')}>{formatProgressDisplay(progressCount, progressDisplayPrefix)}</span> : null}
											{progress?.collectorJobId ? <span style={{ color: '#94a3b8' }}>job: {progress.collectorJobId}</span> : null}
											{progress?.collectorJob?.claimed_by ? <span style={{ color: '#94a3b8' }}>PC: {progress.collectorJob.claimed_by}</span> : null}
											{progress?.collectorJob?.created_by_device_id ? <span style={{ color: '#94a3b8' }}>생성 PC: {progress.collectorJob.created_by_device_id}</span> : null}
										</div>
										{isRetryProgress ? (
											<div style={{ fontSize: 12, color: '#fbbf24', lineHeight: 1.5 }}>
												이어받기는 이미 정상 저장된 조건을 제외하고 누락/실패 조건만 새 작업으로 다시 수집합니다.
											</div>
										) : null}
										<div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
											{progressMessage || '아직 생성된 Collector 작업이 없습니다. 버튼을 누르면 진행 상태가 여기에 표시됩니다.'}
										</div>
										{collectorDateRange ? (
											<div style={{ fontSize: 12, color: '#93c5fd', lineHeight: 1.5 }}>
												수집 대상 날짜: {collectorDateRange}
											</div>
										) : null}
										{savedDateSummary ? (
											<div style={{ fontSize: 12, color: '#bbf7d0', lineHeight: 1.5 }}>
												저장 완료 날짜: {savedDateSummary}
											</div>
										) : null}
										{pendingCollectionSummary ? (
											<div style={{ fontSize: 12, color: '#fbbf24', lineHeight: 1.5 }}>
												추가 수집 필요 날짜: {pendingCollectionSummary}
											</div>
										) : null}
										{nonOperatingCollectionNote ? (
											<div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
												ADVoost 미운영 기간: {nonOperatingCollectionNote}
											</div>
										) : null}
										{scopedCollectorStatus?.running ? (
											<div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
												로컬 Collector: {scopedCollectorStatus.state || 'UNKNOWN'}
												{scopedCollectorStatus.jobId ? ` · 현재 job ${scopedCollectorStatus.jobId}` : ''}
												{scopedCollectorStatus.reason ? ` · ${scopedCollectorStatus.reason}` : ''}
												{scopedCollectorStatus.attempt ? ` · ${scopedCollectorStatus.attempt}회차` : ''}
											</div>
										) : collectorStatus?.running && collectorStatus.jobId ? (
											<div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
												로컬 Collector: 다른 Collector 작업 진행 중
												{collectorStatus.jobId ? ` · 현재 job ${collectorStatus.jobId}` : ''}
											</div>
										) : collectorStatus?.running ? (
											<div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
												로컬 Collector: {collectorStatus.state || 'POLLING'}
											</div>
										) : (
											<div style={{ fontSize: 12, color: '#fca5a5' }}>로컬 Collector가 실행 중이 아닙니다. 위의 “백그라운드 시작”을 먼저 눌러주세요.</div>
										)}
										{lastProgressEvent ? (
											<div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
												마지막 이벤트: {lastProgressEvent.status || '-'} · {formatCollectorNote(lastProgressEvent.note, 240)} ·{' '}
												{lastProgressEvent.time ? new Date(lastProgressEvent.time).toLocaleString() : '-'}
											</div>
										) : null}
										{progress?.collectorJob?.error && isTerminalCollectorStatus(progress.collectorJob.status) ? (
											<div style={{ fontSize: 12, color: '#fca5a5' }}>오류: {progress.collectorJob.error}</div>
										) : null}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</div>

			<div className="card" style={{ display: 'grid', gap: 10 }}>
				<div className="card-title">DB 수집 범위</div>
				{Object.entries(coverage || {}).map(([domain, rows]) => (
					<div key={domain} style={{ display: 'grid', gap: 4 }}>
						<div style={{ fontWeight: 900 }}>{domain}</div>
						<div style={{ display: 'grid', gap: 4 }}>
							{(rows || []).map((r) => (
								<div key={`${domain}-${r.table}`} style={{ fontSize: 12, color: '#64748b' }}>
									{r.table}: {r.rows.toLocaleString()}건 · {r.min_date || '-'} ~ {r.max_date || '-'}
									{r.error ? ` · ${r.error}` : ''}
								</div>
							))}
						</div>
					</div>
				))}
			</div>

			<div className="card" style={{ display: 'grid', gap: 10 }}>
				<div className="card-title">기존 수동 수집 정리</div>
				<div style={{ color: '#64748b', lineHeight: 1.6 }}>
					기존 메뉴의 업로드/수동 수집 버튼은 당장 삭제하지 않고 복구용으로 유지합니다. 운영 기준은 이 화면의 작업 활성화,
					자동 실행, Collector 대기열로 이전하며 안정화가 끝난 항목부터 원래 메뉴에서는 상태 표시와 이동 링크만 남기는 방식으로 줄입니다.
				</div>
				<div style={{ display: 'grid', gap: 8 }}>
					{manualImportItems.map((item) => (
						<div
							key={item.name}
							style={{
								border: '1px solid rgba(148, 163, 184, 0.28)',
								borderRadius: 10,
								padding: 10,
								background: 'rgba(15, 23, 42, 0.55)',
								display: 'grid',
								gap: 4,
							}}
						>
							<div style={{ color: '#f8fafc', fontWeight: 900 }}>{item.name}</div>
							<div style={{ color: '#cbd5e1', fontSize: 12 }}>현재 위치: {item.current}</div>
							<div style={{ color: '#94a3b8', fontSize: 12 }}>정리 방향: {item.plan}</div>
						</div>
					))}
				</div>
			</div>

			<div className="card" style={{ display: 'grid', gap: 10 }}>
				<div className="card-title">최근 실행 로그</div>
				{jobs.length === 0 ? <div style={{ color: '#64748b' }}>아직 실행 이력이 없습니다.</div> : null}
				{jobs.map((job) => {
					const summary0 = formatCollectionResult(job, latestSuccessByTask.get(job.task_id) || null);
					const recovered = summary0.title === '이후 재수집 성공';
					const showDetail = recovered || ['FAILED', 'PARTIAL'].includes(String(job.status || '').toUpperCase());
					return (
						<div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
							<div style={{ minWidth: 0 }}>
								<div style={{ fontWeight: 800 }}>{job.task_id}</div>
								<div style={{ fontSize: 12, color: '#64748b' }}>{job.started_at ? new Date(job.started_at).toLocaleString() : ''}</div>
								{showDetail ? (
									<div style={{ fontSize: 12, color: summary0.tone === 'danger' ? '#fca5a5' : '#94a3b8', marginTop: 3, lineHeight: 1.45 }}>
										{summary0.detail}
									</div>
								) : null}
							</div>
							<span style={badgeStyle(recovered ? 'ok' : statusTone(job.status))}>{recovered ? 'RECOVERED' : job.status}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
