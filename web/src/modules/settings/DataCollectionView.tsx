import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useMaybeAuth } from '../auth/AuthProvider';
import { getHostSetupDownloads } from '../layout/hostSetupDownloads';
import { buildErp2ClientIpHeaders, discoverNasHostCdpIp } from '../layout/hostCdpClient';

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

type CollectorStatus = {
	running?: boolean;
	state?: string;
	agentReachable?: boolean;
	apiBaseUrl?: string;
	jobId?: string;
	url?: string;
	reason?: string;
	attempt?: number;
	error?: string;
	updated_at?: string;
	healthTime?: string;
	checkedAt?: string;
	agentVersion?: string;
	agentManageNo?: string;
	collectorVersion?: string;
	collectorManageNo?: string;
};

type CollectorEvent = {
	job_id?: string | null;
	device_id?: string | null;
	url?: string | null;
	status?: string | null;
	note?: string | null;
	time?: string | null;
};

type CollectorJobPublic = {
	job_id?: string | null;
	status?: string | null;
	mode?: string | null;
	target_date?: string | null;
	date_from?: string | null;
	date_to?: string | null;
	created_by_device_id?: string | null;
	claimed_by?: string | null;
	results_count?: number | null;
	error?: string | null;
	last_event?: CollectorEvent | null;
	retry_count?: number | null;
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

const REQUIRED_HOST_AGENT_VERSION = '2026.06.26-gfa-startup-cleanup-only';
const REQUIRED_HOST_AGENT_MANAGE_NO = '20260626-1858';

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
	return String(e?.response?.data?.detail ?? e?.response?.data?.message ?? e?.message ?? e ?? '요청 실패');
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
	return ['DONE', 'SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED'].includes(String(status || '').toUpperCase());
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

function isRecoveredBySuccess(job?: CollectionJob | null, success?: CollectionJob | null): boolean {
	if (!job || !success) return false;
	const status = String(job.status || '').toUpperCase();
	if (!['FAILED', 'PARTIAL'].includes(status)) return false;
	if (!sameJobRange(job, success)) return false;
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

	if (detail.skipped || String(detail.status || '').toUpperCase() === 'SKIPPED' || reason === 'no_missing_ads_dates') {
		if (isAlreadyStoredSkip(reason, detail)) {
			return {
				tone: 'muted',
				title: '수집·저장 완료',
				detail: `${range ? `${range} 기준 ` : ''}이미 저장된 데이터가 확인되어 추가 수집은 건너뛰었습니다${persisted > 0 ? ` (${persisted.toLocaleString()}건)` : ''}.`,
			};
		}
		return {
			tone: 'muted',
			title: '수집 대상 없음',
			detail: `${range ? `${range} 기준 ` : ''}이번 실행에서 새로 수집할 대상이 없습니다.`,
		};
	}
	if (status === 'SUCCESS' || status === 'DONE') {
		if (!completionVerified) {
			return {
				tone: 'warn',
				title: savedCount > 0 ? '추가 수집 필요' : '저장 검증 대기',
				detail: missingSummary
					? `${range ? `${range} · ` : ''}${missingSummary}. 필요한 기간 전체 저장 검증이 끝나야 완료로 표시됩니다.`
					: `${range ? `${range} · ` : ''}${hasPersistence ? '저장 결과 검증이 아직 완료되지 않았습니다.' : '수집은 끝났지만 저장 검증 결과가 없습니다.'}`,
			};
		}
		return {
			tone: 'muted',
			title: '수집·저장 완료',
			detail: `${range ? `${range} · ` : ''}${savedCount > 0 ? `${savedCount.toLocaleString()}건 저장/검증 완료` : '필요 기간 저장 검증 완료'}`,
		};
	}
	if (status === 'PARTIAL') {
		return {
			tone: 'warn',
			title: pendingReplies > 0 ? '추가 수집 필요' : '일부 데이터 수집',
			detail: missingSummary
				? `${range ? `${range} · ` : ''}${missingSummary}. 추가 수집이 필요합니다.`
				: reason
					? `필요한 일자까지 완료되지 않았습니다: ${reason}`
					: '수집은 진행됐지만 필요한 기간 전체 저장 검증을 통과하지 못했습니다.',
		};
	}
	if (status === 'FAILED') {
		return {
			tone: 'danger',
			title: '수집 실패',
			detail: humanizeCollectionFailure(job, reason),
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
	const [collectorBusy, setCollectorBusy] = useState(false);
	const [collectorAutoUpdating, setCollectorAutoUpdating] = useState(false);
	const collectorAutoUpdateAttemptedRef = useRef(false);
	const [taskProgress, setTaskProgress] = useState<Record<string, TaskProgress>>(() => readStoredTaskProgress());
	const [hoveredDescriptionTaskId, setHoveredDescriptionTaskId] = useState<string | null>(null);
	const [gfaReportFile, setGfaReportFile] = useState<File | null>(null);
	const [gfaBusy, setGfaBusy] = useState(false);
	const [gfaMessage, setGfaMessage] = useState<string | null>(null);
	const collectorDeviceId = useMemo(() => getOrCreateCollectorDeviceId(), []);
	const accessMode = useMemo(() => detectAccessMode(apiBaseUrl), [apiBaseUrl]);
	const accessModeLabel = accessMode === 'local' ? '로컬 접속' : accessMode === 'nas' ? 'NAS 접속' : '접속 환경 확인 불가';
	const collectorAgentVersion = String(collectorStatus?.agentVersion || '').trim();
	const collectorAgentManageNo = normalizeManageNo(collectorStatus?.agentManageNo || '');
	const collectorWorkerVersion = String(collectorStatus?.collectorVersion || collectorStatus?.agentVersion || '').trim();
	const collectorWorkerManageNo = normalizeManageNo(collectorStatus?.collectorManageNo || collectorStatus?.agentManageNo || '');
	const expectedCollectorApiBaseUrl = absoluteApiBaseUrl(apiBaseUrl);
	const collectorApiBaseUrl = String(collectorStatus?.apiBaseUrl || '').trim();
	const isCollectorWorkerTargetMatched =
		!collectorStatus?.running ||
		!collectorApiBaseUrl ||
		collectorApiBaseUrl.replace(/\/$/, '') === expectedCollectorApiBaseUrl.replace(/\/$/, '');
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
		try {
			await runHostAgentSelfUpdate();
			const updated = await waitForHostAgentVersion(REQUIRED_HOST_AGENT_VERSION, REQUIRED_HOST_AGENT_MANAGE_NO, 35_000);
			if (!updated) {
				throw new Error('self_update_timeout');
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

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const headers = await authHeaders();
			const [taskRes, jobRes, eventRes] = await Promise.all([
				axios.get<CollectionTasksResponse>(`${apiBaseUrl}/collection/tasks`, { headers }),
				axios.get<CollectionJobsResponse>(`${apiBaseUrl}/collection/jobs`, { headers, params: { limit: 30 } }),
				axios.get<{ ok: boolean; events: CollectorEvent[] }>(`${apiBaseUrl}/search-rank/page-metrics/local-collector/events`, { headers, params: { limit: 20 } }),
			]);
			const loadedTasks = taskRes.data.tasks || [];
			setTasks(loadedTasks);
			setCoverage(taskRes.data.coverage || {});
			setJobs(jobRes.data.jobs || []);
			setCollectorEvents(Array.isArray(eventRes.data?.events) ? eventRes.data.events : []);
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
			setLoading(false);
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
				healthTime: String(health?.time || health?.updated_at || ''),
				checkedAt: new Date().toLocaleString(),
			};
			setCollectorStatus(merged);
		} catch (e: any) {
			setCollectorStatus({ running: false, state: 'UNREACHABLE', agentReachable: false, error: String(e?.message || e || '') });
		}
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
		const run = async () => {
			setCollectorAutoUpdating(true);
			try {
				await runHostAgentSelfUpdate();
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
	}, [collectorStatus?.agentReachable, isCollectorAgentLatest, isCollectorWorkerLatest, collectorAutoUpdating, accessMode]);

	const startCollector = async () => {
		setCollectorBusy(true);
		setError(null);
		try {
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
					deviceId: collectorDeviceId,
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
						deviceId: collectorDeviceId,
					}),
				});
				const data = await res.json().catch(() => ({} as any));
				if (!res.ok || data?.ok !== true) throw new Error(String(data?.error || `HTTP ${res.status}`));
			}
			await refreshCollectorStatus();
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
		void load();
		void refreshCollectorStatus();
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

	const runTask = async (task: CollectionTask) => {
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
						? 'Collector 작업을 생성하는 중입니다.'
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
				{ mode: 'manual', collector_device_id: collectorDeviceId },
				{ headers: { ...headers, 'X-ERP2-Collector-Device-Id': collectorDeviceId } },
			);
			const collectorJob = (res.data?.result?.collector_job || res.data?.job?.detail?.collector_job || null) as CollectorJobPublic | null;
			setTaskProgress((prev) => ({
				...prev,
				[task.task_id]: {
					collectorJobId: collectorJob?.job_id || null,
					collectorJob,
					message: collectorJob?.job_id ? `Collector 작업 생성됨: ${collectorJob.job_id}` : '작업 생성 요청이 완료되었습니다.',
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
						<div>Worker API: 현재 {collectorApiBaseUrl} · 필요 {expectedCollectorApiBaseUrl}</div>
					) : null}
					<div>
						{collectorStatus?.healthTime ? `Agent health 시각: ${collectorStatus.healthTime}` : ''}
						{collectorStatus?.checkedAt ? ` · UI 확인 시각: ${collectorStatus.checkedAt}` : ''}
						{collectorStatus?.updated_at ? ` · Worker 갱신 시각: ${collectorStatus.updated_at}` : ''}
					</div>
					<br />
					{!isCollectorWorkerTargetMatched
						? 'Worker가 현재 접속 환경과 다른 API에 연결되어 있습니다. 백그라운드 시작을 누르면 올바른 API로 재시작합니다.'
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
						const progress =
							transientProgress && (!latestStartedAt || transientStartedAt >= latestStartedAt)
								? transientProgress
								: latestCollector
									? { collectorJob: latestCollector, collectorJobId: latestCollector.job_id }
									: transientProgress;
						const lastProgressEvent = progress?.collectorJob?.last_event || collectorEvents.filter((event) => event.job_id && event.job_id === progress?.collectorJobId).slice(-1)[0] || null;
						const progressStatus = progress?.collectorJob?.status || lastProgressEvent?.status || null;
						const progressMessage = progress?.message || (progress ? collectorProgressMessage(progress.collectorJob, lastProgressEvent, collectorStatus) : null);
						const collectorDateRange = formatCollectorDateRange(progress?.collectorJob || latestCollector);
						const savedDateSummary = formatSavedByDate(latest);
						const pendingCollectionSummary = formatPendingCollection(task);
						const nonOperatingCollectionNote = formatNonOperatingCollectionNote(task);
						const isSaving = savingTaskId === task.task_id;
						const isRunning = Boolean(runningTasks[task.task_id]);
						const isCancelling = Boolean(cancellingTasks[task.task_id]);
						const resultSummary = formatCollectionResult(latest, task.latest_success_job || latestSuccessByTask.get(task.task_id) || null);
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
						const displayResultSummary = isCollectorActive
							? {
								tone: 'warn' as const,
								title: '백그라운드 진행 중',
								detail: collectorDateRange
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
										className={isCollectorActive ? 'btn-ghost' : 'btn-primary'}
										disabled={isCollectorActive ? isCancelling : !canRunInCurrentAccess || isRunning}
										onClick={() => {
											if (isCollectorActive) {
												void cancelCollectorTask(task, progress);
											} else {
												void runTask(task);
											}
										}}
										style={{
											flex: '0 0 auto',
											whiteSpace: 'nowrap',
											...(isCollectorActive ? { borderColor: 'rgba(248, 113, 113, 0.55)', color: '#fecaca' } : {}),
										}}
										title={isCollectorActive ? '현재 Collector 작업을 중단합니다.' : runDisabledReason}
									>
										{isCollectorActive ? (isCancelling ? '중단 중' : '작업 중단') : isRunning ? '실행 중' : task.source_type === 'host_cdp' ? 'Collector 작업 생성' : '지금 실행'}
									</button>
								</div>
								{runDisabledReason ? <div style={{ fontSize: 12, color: accessMode === 'local' && isNasRuntimeTask ? '#fbbf24' : '#94a3b8' }}>{runDisabledReason}</div> : null}

								<div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', gap: 8, flexWrap: 'wrap', lineHeight: 1.5, alignItems: 'center' }}>
									<span style={badgeStyle(displayResultSummary.tone)}>{displayResultSummary.title}</span>
									<span>{displayResultSummary.detail}</span>
									{latest ? (
										<>
											<span>{latest.started_at ? new Date(latest.started_at).toLocaleString() : ''}</span>
											{latest.error ? <span style={{ color: '#b91c1c' }}>{latest.error}</span> : null}
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
											{progress?.collectorJobId ? <span style={{ color: '#94a3b8' }}>job: {progress.collectorJobId}</span> : null}
											{progress?.collectorJob?.claimed_by ? <span style={{ color: '#94a3b8' }}>PC: {progress.collectorJob.claimed_by}</span> : null}
											{progress?.collectorJob?.created_by_device_id ? <span style={{ color: '#94a3b8' }}>생성 PC: {progress.collectorJob.created_by_device_id}</span> : null}
										</div>
										<div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
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
										{collectorStatus?.running ? (
											<div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
												로컬 Collector: {collectorStatus.state || 'UNKNOWN'}
												{collectorStatus.jobId ? ` · 현재 job ${collectorStatus.jobId}` : ''}
												{collectorStatus.reason ? ` · ${collectorStatus.reason}` : ''}
												{collectorStatus.attempt ? ` · ${collectorStatus.attempt}회차` : ''}
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
