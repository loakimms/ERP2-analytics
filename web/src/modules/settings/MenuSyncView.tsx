import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useMaybeAuth } from '../auth/AuthProvider';
import { REQUIRED_HOST_AGENT_MANAGE_NO, REQUIRED_HOST_AGENT_VERSION } from '../hostAgentRelease';

const HOST_AGENT_ORIGIN = 'http://127.0.0.1:9230';
const HOST_AGENT_START_PROTOCOL_URL = 'erp2-analytics-host-agent://start';
const HOST_AGENT_REPO_START_PROTOCOL_URL = 'erp2-analytics-host-agent://start?mode=repo';
const COLLECTION_DATA_CHANGED_EVENT = 'erp2-analytics:collection-data-changed';
const COLLECTION_DATA_CHANGED_STORAGE_KEY = 'erp2-analytics.collectionDataChangedAt';

type MenuSyncMenuItem = {
	id: string;
	label: string;
	description?: string | null;
	status: 'active' | 'planned';
};

type MenuSyncTableSummary = {
	table_name: string;
	file_name: string;
	row_count: number;
	source_row_count?: number | null;
};

type MenuSyncManifest = {
	schema_version: string;
	generated_at: string;
	menus: string[];
	checksums: Record<string, string>;
	date_from?: string | null;
	date_to?: string | null;
	target_dates?: string[];
	menu_summaries: Array<{
		menu_id: string;
		label: string;
		tables: MenuSyncTableSummary[];
	}>;
	source_image_tag?: string | null;
	source_api_version?: string | null;
};

type MenuSyncImportResponse = {
	ok: boolean;
	menus: string[];
	imported_tables: MenuSyncTableSummary[];
	detail?: string | null;
};

type HostGapItem = {
	date: string;
	table_name: string;
	local_row_count: number;
	nas_row_count: number;
	missing_key_count: number;
	missing_keys: string[];
};

type HostMenuSyncResponse = {
	ok?: boolean;
	action?: string;
	bundlePath?: string | null;
	bundleFileName?: string | null;
	local_to_nas_bundlePath?: string | null;
	nas_to_local_bundlePath?: string | null;
	message?: string | null;
	error?: string | null;
	detail?: string | null;
	output?: string | null;
	menus?: string[];
	imported_tables?: MenuSyncTableSummary[];
	date_from?: string | null;
	date_to?: string | null;
	target_dates?: string[];
	missing_dates?: string[];
	missing_date_count?: number;
	gap_items?: HostGapItem[];
	import_response?: {
		imported_tables?: MenuSyncTableSummary[];
	};
	local_export_response?: {
		imported_tables?: MenuSyncTableSummary[];
	};
	nas_import_response?: {
		imported_tables?: MenuSyncTableSummary[];
	};
	nas_export_response?: {
		imported_tables?: MenuSyncTableSummary[];
	};
	local_import_response?: {
		imported_tables?: MenuSyncTableSummary[];
	};
};

type HostAgentVersionInfo = {
	ok?: boolean;
	agentVersion?: string | null;
	agentManageNo?: string | null;
	collectorVersion?: string | null;
	collectorManageNo?: string | null;
	installMode?: string | null;
	menuSyncSupported?: boolean | null;
	capabilities?: {
		menuSync?: boolean | null;
		collector?: boolean | null;
		hostChrome?: boolean | null;
	} | null;
};

function stringifyUnknown(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function normalizeTableSummary(value: unknown): MenuSyncTableSummary | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	return {
		table_name: String(row.table_name || '').trim(),
		file_name: String(row.file_name || '').trim(),
		row_count: Number(row.row_count || 0),
		source_row_count: row.source_row_count == null ? undefined : Number(row.source_row_count || 0),
	};
}

function normalizeTableSummaryList(value: unknown): MenuSyncTableSummary[] {
	if (!Array.isArray(value)) return [];
	return value.map(normalizeTableSummary).filter((item): item is MenuSyncTableSummary => Boolean(item?.table_name));
}

function normalizeHostMenuSyncResponse(value: unknown): HostMenuSyncResponse {
	const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const nestedResponse = (key: string) => {
		const value0 = row[key];
		return value0 && typeof value0 === 'object'
			? {
					imported_tables: normalizeTableSummaryList((value0 as Record<string, unknown>).imported_tables),
				}
			: undefined;
	};
	return {
		ok: typeof row.ok === 'boolean' ? row.ok : undefined,
		action: stringifyUnknown(row.action) ?? undefined,
		bundlePath: stringifyUnknown(row.bundlePath),
		bundleFileName: stringifyUnknown(row.bundleFileName),
		local_to_nas_bundlePath: stringifyUnknown(row.local_to_nas_bundlePath),
		nas_to_local_bundlePath: stringifyUnknown(row.nas_to_local_bundlePath),
		message: stringifyUnknown(row.message),
		error: stringifyUnknown(row.error),
		detail: stringifyUnknown(row.detail),
		output: stringifyUnknown(row.output),
		menus: Array.isArray(row.menus) ? row.menus.map((item) => String(item)) : undefined,
		date_from: stringifyUnknown(row.date_from),
		date_to: stringifyUnknown(row.date_to),
		target_dates: Array.isArray(row.target_dates) ? row.target_dates.map((item) => String(item)) : undefined,
		missing_dates: Array.isArray(row.missing_dates) ? row.missing_dates.map((item) => String(item)) : undefined,
		missing_date_count: Number(row.missing_date_count || 0),
		gap_items: Array.isArray(row.gap_items)
			? row.gap_items.map((item) => {
					const gap = item as Record<string, unknown>;
					return {
						date: String(gap.date || '').trim(),
						table_name: String(gap.table_name || '').trim(),
						local_row_count: Number(gap.local_row_count || 0),
						nas_row_count: Number(gap.nas_row_count || 0),
						missing_key_count: Number(gap.missing_key_count || 0),
						missing_keys: Array.isArray(gap.missing_keys) ? gap.missing_keys.map((key) => String(key)) : [],
					};
			  }).filter((item) => item.date && item.table_name)
			: undefined,
		imported_tables: normalizeTableSummaryList(row.imported_tables),
		import_response: nestedResponse('import_response'),
		local_export_response: nestedResponse('local_export_response'),
		nas_import_response: nestedResponse('nas_import_response'),
		nas_export_response: nestedResponse('nas_export_response'),
		local_import_response: nestedResponse('local_import_response'),
	};
}

function formatDateTime(value?: string | null): string {
	const text = String(value || '').trim();
	if (!text) return '-';
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) return text;
	return parsed.toLocaleString('ko-KR');
}

function parseFileNameFromDisposition(contentDisposition: string | null): string {
	const raw = String(contentDisposition || '');
	const match = /filename="?([^";]+)"?/i.exec(raw);
	return match?.[1] ? String(match[1]) : `menu_sync_${Date.now()}.zip`;
}

function resolveAbsoluteApiBaseUrl(apiBaseUrl: string): string {
	const raw = String(apiBaseUrl || '').trim();
	if (!raw) return window.location.origin;
	try {
		return new URL(raw, window.location.origin).toString().replace(/\/$/, '');
	} catch {
		return raw.replace(/\/$/, '');
	}
}

function isLocalHostName(hostname: string): boolean {
	const h = String(hostname || '').trim().toLowerCase();
	return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function normalizeManageNo(value: unknown): string {
	return String(value ?? '').trim().replace(/[^0-9]/g, '');
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRequiredHostAgentVersion(info: HostAgentVersionInfo | null): boolean {
	if (!info) return false;
	const version = String(info.agentVersion || '').trim();
	const manageNo = normalizeManageNo(info.agentManageNo);
	return version === REQUIRED_HOST_AGENT_VERSION && manageNo === normalizeManageNo(REQUIRED_HOST_AGENT_MANAGE_NO);
}

function supportsMenuSync(info: HostAgentVersionInfo | null): boolean {
	if (!info) return false;
	if (info.menuSyncSupported === true) return true;
	if (info.capabilities?.menuSync === true) return true;
	return String(info.installMode || '').trim() === 'repo';
}

function detectAccessMode(apiBaseUrl: string): 'local' | 'nas' | 'unknown' {
	try {
		const pageHost = window.location.hostname;
		const apiHost = new URL(resolveAbsoluteApiBaseUrl(apiBaseUrl), window.location.origin).hostname;
		if (isLocalHostName(pageHost) || isLocalHostName(apiHost)) return 'local';
		return 'nas';
	} catch {
		return 'unknown';
	}
}

function isPathLike(value?: string | null): boolean {
	const text = String(value || '').trim();
	if (!text) return false;
	return /^[a-zA-Z]:[\\/]/.test(text) || text.includes('\\') || text.includes('/');
}

function importedTablesFromHostResult(result: HostMenuSyncResponse | null): MenuSyncTableSummary[] {
	if (!result) return [];
	if (Array.isArray(result.imported_tables)) return result.imported_tables;
	if (Array.isArray(result.import_response?.imported_tables)) return result.import_response?.imported_tables || [];
	return [];
}

function sumImportedRows(tables: MenuSyncTableSummary[]): number {
	return tables.reduce((sum, table) => sum + Number(table.row_count || 0), 0);
}

function normalizeImportErrorMessage(status?: number, detail?: string | null): string {
	const text = String(detail || '').trim();
	if (status === 413 || /413 Request Entity Too Large/i.test(text)) {
		return '업로드한 번들이 서버 업로드 제한을 초과했습니다. 큰 번들은 서버 업로드 한도를 늘리거나 호스트 import 경로를 사용해 주세요.';
	}
	return text || `HTTP ${status || 500}`;
}

async function readHostAgentVersion(): Promise<HostAgentVersionInfo> {
	const res = await fetch(`${HOST_AGENT_ORIGIN}/version`, { cache: 'no-store' });
	const data = (await res.json().catch(() => ({}))) as HostAgentVersionInfo;
	if (!res.ok || data?.ok === false) throw new Error(String((data as any)?.error || `HTTP ${res.status}`));
	return data;
}

async function waitForHostAgent(
	predicate: (info: HostAgentVersionInfo) => boolean,
	timeoutMs = 25_000,
	intervalMs = 1000,
): Promise<HostAgentVersionInfo | null> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const data = await readHostAgentVersion();
			if (predicate(data)) return data;
		} catch {
			// Host Agent may still be down or restarting.
		}
		await sleep(intervalMs);
	}
	return null;
}

async function restartHostAgentViaProtocol(): Promise<HostAgentVersionInfo | null> {
	try {
		await fetch(`${HOST_AGENT_ORIGIN}/shutdown`, { method: 'POST', cache: 'no-store' });
	} catch {
		// shutdown often closes the connection before the browser receives the full response.
	}
	await sleep(1200);
	window.location.href = HOST_AGENT_REPO_START_PROTOCOL_URL;
	return waitForHostAgent((info) => supportsMenuSync(info), 25_000);
}

function formatImportTableSummary(table: MenuSyncTableSummary): string {
	const inserted = Number(table.row_count || 0);
	const source = table.source_row_count;
	if (typeof source === 'number') {
		return `${table.table_name} 추가 ${inserted}건 / 번들 ${source}건`;
	}
	return `${table.table_name} ${inserted}건`;
}

function todayDateInputValue(): string {
	return new Date().toISOString().slice(0, 10);
}

function startOfYearDateInputValue(): string {
	const now = new Date();
	return `${now.getFullYear()}-01-01`;
}

const DATE_SCOPED_MENU_IDS = new Set([
	'product_tracking',
	'ads_performance',
	'sales_purchase',
	'search_rank',
	'product_metrics',
	'gfa_performance',
]);

function notifyCollectionDataChanged(reason: string): void {
	const payload = JSON.stringify({ reason, at: new Date().toISOString() });
	try {
		window.localStorage.setItem(COLLECTION_DATA_CHANGED_STORAGE_KEY, payload);
	} catch {
		// Cross-tab refresh is best-effort; same-tab event below still refreshes mounted views.
	}
	window.dispatchEvent(new CustomEvent(COLLECTION_DATA_CHANGED_EVENT, { detail: { reason } }));
}

export function MenuSyncView({ apiBaseUrl }: { apiBaseUrl: string }): JSX.Element {
	const auth = useMaybeAuth();
	const getIdToken = auth?.getIdToken ?? (async () => null);
	const [menus, setMenus] = useState<MenuSyncMenuItem[]>([]);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [preview, setPreview] = useState<MenuSyncManifest | null>(null);
	const [bundleFileName, setBundleFileName] = useState<string>('');
	const [bundleCreatedAt, setBundleCreatedAt] = useState<string>('');
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importResult, setImportResult] = useState<MenuSyncImportResponse | null>(null);
	const [nasApiBaseUrl, setNasApiBaseUrl] = useState<string>('http://192.168.0.50:6188/api');
	const [hostImportBundleName, setHostImportBundleName] = useState<string>('');
	const [dateFrom, setDateFrom] = useState<string>(startOfYearDateInputValue());
	const [dateTo, setDateTo] = useState<string>(todayDateInputValue());
	const [loadingMenus, setLoadingMenus] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [exportLoading, setExportLoading] = useState(false);
	const [importLoading, setImportLoading] = useState(false);
	const [hostPushLoading, setHostPushLoading] = useState(false);
	const [hostReconcileLoading, setHostReconcileLoading] = useState(false);
	const [hostImportLoading, setHostImportLoading] = useState(false);
	const [hostGapAnalyzeLoading, setHostGapAnalyzeLoading] = useState(false);
	const [hostGapPushLoading, setHostGapPushLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [hostResult, setHostResult] = useState<HostMenuSyncResponse | null>(null);
	const [hostRunSteps, setHostRunSteps] = useState<string[]>([]);

	const authHeaders = async (): Promise<Record<string, string>> => {
		const token = await getIdToken({ forceRefresh: false });
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const getFreshIdToken = async (): Promise<string> => {
		return (await getIdToken({ forceRefresh: true })) || '';
	};

	const activeMenus = useMemo(() => menus.filter((item) => item.status === 'active'), [menus]);
	const hostCallableApiBaseUrl = useMemo(() => resolveAbsoluteApiBaseUrl(apiBaseUrl), [apiBaseUrl]);
	const accessMode = useMemo(() => detectAccessMode(apiBaseUrl), [apiBaseUrl]);
	const accessModeLabel = accessMode === 'local' ? '로컬 접속' : accessMode === 'nas' ? 'NAS 접속' : '접속 환경 확인 불가';
	const requiresDateScope = useMemo(() => selectedIds.some((id) => DATE_SCOPED_MENU_IDS.has(id)), [selectedIds]);
	const trackingOnlySelected = useMemo(
		() => selectedIds.length === 1 && selectedIds[0] === 'product_tracking',
		[selectedIds],
	);

	useEffect(() => {
		let alive = true;
		(async () => {
			setLoadingMenus(true);
			setError(null);
			try {
				const res = await axios.get(`${apiBaseUrl}/menu-sync/menus`, {
					headers: await authHeaders(),
				});
				const nextMenus = Array.isArray(res.data?.menus) ? res.data.menus : [];
				if (!alive) return;
				setMenus(nextMenus);
				setSelectedIds((prev) => {
					if (prev.length > 0) return prev;
					return nextMenus.filter((item: MenuSyncMenuItem) => item.status === 'active').map((item: MenuSyncMenuItem) => item.id);
				});
			} catch (requestError: any) {
				if (!alive) return;
				setError(String(requestError?.response?.data?.detail || requestError?.message || '메뉴 목록을 불러오지 못했습니다.'));
			} finally {
				if (alive) setLoadingMenus(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [apiBaseUrl]);

	const toggleMenu = (menuId: string) => {
		setSelectedIds((prev) => (prev.includes(menuId) ? prev.filter((item) => item !== menuId) : [...prev, menuId]));
	};

	const menuPayload = useMemo(() => {
		const payload: Record<string, unknown> = { menu_ids: selectedIds };
		if (requiresDateScope) {
			if (dateFrom) payload.date_from = dateFrom;
			if (dateTo) payload.date_to = dateTo;
		}
		return payload;
	}, [dateFrom, dateTo, requiresDateScope, selectedIds]);

	const validateSelection = (): boolean => {
		if (selectedIds.length === 0) {
			setError('동기화할 메뉴를 1개 이상 선택해 주세요.');
			return false;
		}
		if (requiresDateScope && (!dateFrom || !dateTo)) {
			setError('수집 데이터 동기화는 시작일과 종료일이 필요합니다.');
			return false;
		}
		return true;
	};

	const loadPreview = async (): Promise<void> => {
		if (!validateSelection()) return;
		setPreviewLoading(true);
		setError(null);
		setMessage(null);
		try {
			const res = await fetch(`${apiBaseUrl}/menu-sync/preview`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(await authHeaders()),
				},
				body: JSON.stringify(menuPayload),
			});
			if (!res.ok) {
				const detail = await res.text();
				throw new Error(detail || `HTTP ${res.status}`);
			}
			const data = await res.json();
			setPreview(data?.manifest || null);
			setMessage('선택 메뉴 구성을 미리 계산했습니다.');
		} catch (requestError: any) {
			setError(String(requestError?.message || '미리보기에 실패했습니다.'));
		} finally {
			setPreviewLoading(false);
		}
	};

	const exportBundle = async (): Promise<void> => {
		if (!validateSelection()) return;
		setExportLoading(true);
		setError(null);
		setMessage(null);
		try {
			const token = await getFreshIdToken();
			const res = await fetch(`${apiBaseUrl}/menu-sync/export`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify(menuPayload),
			});
			if (!res.ok) {
				const detail = await res.text();
				throw new Error(detail || `HTTP ${res.status}`);
			}
			const blob = await res.blob();
			const fileName = parseFileNameFromDisposition(res.headers.get('content-disposition'));
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = fileName;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
			setBundleFileName(fileName);
			setBundleCreatedAt(new Date().toISOString());
			try {
				const hostExport = await postHostAgent('/menu-sync/export', {
					localApiBaseUrl: hostCallableApiBaseUrl,
					menuIds: selectedIds,
					bundleFileName: fileName,
					bearerToken: token,
					dateFrom: requiresDateScope ? dateFrom : '',
					dateTo: requiresDateScope ? dateTo : '',
				});
				setHostResult(hostExport);
				setHostImportBundleName(String(hostExport.bundlePath || '').trim());
				setMessage(`동기화 번들을 생성했습니다. 브라우저 다운로드와 프로젝트 저장을 완료했습니다: ${fileName}`);
			} catch (hostError: any) {
				setHostResult({
					ok: false,
					action: 'menu-sync-export',
					error: String(hostError?.message || 'host_project_save_failed'),
				});
				setHostImportBundleName('');
				setMessage(`브라우저 다운로드 번들을 생성했습니다: ${fileName}`);
				setError(
					`브라우저 다운로드는 완료했지만 프로젝트 폴더 저장은 실패했습니다. Host Agent 상태를 확인해 주세요. 상세: ${String(
						hostError?.message || 'host_project_save_failed',
					)}`,
				);
			}
		} catch (requestError: any) {
			setError(String(requestError?.message || '번들 생성에 실패했습니다.'));
		} finally {
			setExportLoading(false);
		}
	};

	const runImport = async (): Promise<void> => {
		if (!importFile) {
			setError('업로드할 번들 파일을 선택해 주세요.');
			return;
		}
		setImportLoading(true);
		setError(null);
		setMessage(null);
		try {
			const form = new FormData();
			form.append('file', importFile);
			const res = await fetch(`${apiBaseUrl}/menu-sync/import`, {
				method: 'POST',
				headers: {
					...(await authHeaders()),
				},
				body: form,
			});
			if (!res.ok) {
				const detail = await res.text();
				throw new Error(normalizeImportErrorMessage(res.status, detail));
			}
			const data = (await res.json()) as MenuSyncImportResponse;
			setImportResult(data);
			notifyCollectionDataChanged('menu_sync_import');
			setMessage('로컬 Import를 완료했습니다.');
		} catch (requestError: any) {
			setError(String(requestError?.message || 'Import에 실패했습니다.'));
		} finally {
			setImportLoading(false);
		}
	};

	const selectedLabels = useMemo(
		() => activeMenus.filter((item) => selectedIds.includes(item.id)).map((item) => item.label),
		[activeMenus, selectedIds],
	);

	const nasPushCommand = useMemo(() => {
		if (!bundleFileName) return '';
		const menuArgs = selectedIds.map((item) => `'${item}'`).join(',');
		const dateArgs = requiresDateScope ? ` -DateFrom '${dateFrom}' -DateTo '${dateTo}'` : '';
		return `pwsh -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\menu-sync-nas-push.ps1 -LocalApiBaseUrl '${hostCallableApiBaseUrl}' -NasApiBaseUrl '${nasApiBaseUrl}' -MenuIds @(${menuArgs}) -BundleFileName '${bundleFileName}'${dateArgs} -LocalBearerToken '<ops_admin token>' -NasBearerToken '<ops_admin token>'`;
	}, [bundleFileName, dateFrom, dateTo, hostCallableApiBaseUrl, nasApiBaseUrl, requiresDateScope, selectedIds]);

	const nasImportCommand = useMemo(() => {
		const targetFile = String(hostImportBundleName || bundleFileName).trim();
		if (!targetFile) return '';
		const bundlePathArg = isPathLike(targetFile) ? targetFile : `.\\artifacts\\menu-sync\\${targetFile}`;
		return `pwsh -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\menu-sync-nas-import.ps1 -BundlePath '${bundlePathArg}' -NasApiBaseUrl '${nasApiBaseUrl}' -BearerToken '<ops_admin token>'`;
	}, [bundleFileName, hostImportBundleName, nasApiBaseUrl]);

	const trackingGapPushCommand = useMemo(() => {
		if (!trackingOnlySelected) return '';
		return `pwsh -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\menu-sync-tracking-gap-push.ps1 -LocalApiBaseUrl '${hostCallableApiBaseUrl}' -NasApiBaseUrl '${nasApiBaseUrl}' -DateFrom '${dateFrom}' -DateTo '${dateTo}' -LocalBearerToken '<ops_admin token>' -NasBearerToken '<ops_admin token>'`;
	}, [dateFrom, dateTo, hostCallableApiBaseUrl, nasApiBaseUrl, trackingOnlySelected]);

	const copyCommand = async (value: string) => {
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			setMessage('명령을 클립보드에 복사했습니다.');
		} catch {
			setError('클립보드 복사에 실패했습니다.');
		}
	};

	const runHostAgentSelfUpdate = async (): Promise<HostAgentVersionInfo> => {
		const installerUrl = new URL('/nas/Install-Analytics-HostAgent.ps1', window.location.origin).toString();
		const res = await fetch(`${HOST_AGENT_ORIGIN}/self-update`, {
			method: 'POST',
			cache: 'no-store',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				installerUrl,
				expectedVersion: REQUIRED_HOST_AGENT_VERSION,
				expectedManageNo: REQUIRED_HOST_AGENT_MANAGE_NO,
			}),
		});
		const data = await res.json().catch(() => ({} as any));
		if (!res.ok || data?.ok === false) throw new Error(String(data?.error || `HTTP ${res.status}`));
		const updated = await waitForHostAgent((info) => isRequiredHostAgentVersion(info), 35_000, 1500);
		if (!updated) throw new Error('host_agent_update_timeout');
		return updated;
	};

	const ensureMenuSyncHostAgent = async (): Promise<void> => {
		let info: HostAgentVersionInfo | null = null;
		try {
			info = await readHostAgentVersion();
		} catch {
			setMessage('Host Agent가 실행되어 있지 않아 시작을 요청합니다. 외부 앱 열기 확인창이 뜨면 허용해 주세요.');
			window.location.href = HOST_AGENT_START_PROTOCOL_URL;
			info = await waitForHostAgent(() => true, 20_000);
		}

		if (!info) {
			throw new Error('Host Agent를 시작할 수 없습니다. 먼저 설정 > 데이터 수집에서 Host Agent 상태확인/재시작을 실행한 뒤 다시 시도해 주세요.');
		}

		if (!isRequiredHostAgentVersion(info)) {
			setMessage(`Host Agent 업데이트가 필요합니다. ${REQUIRED_HOST_AGENT_MANAGE_NO} 적용 후 메뉴 동기화를 재시도합니다.`);
			try {
				info = await runHostAgentSelfUpdate();
			} catch (updateError: any) {
				throw new Error(`Host Agent 업데이트 실패: ${String(updateError?.message || updateError || 'self_update_failed')}`);
			}
		}

		if (supportsMenuSync(info)) return;

		setMessage('수집용 Host Agent는 정상이나 메뉴 동기화 기능은 repo 기반 Agent가 필요합니다. repo Agent로 전환합니다. 외부 앱 열기 확인창이 뜨면 허용해 주세요.');
		info = await restartHostAgentViaProtocol();
		if (info && isRequiredHostAgentVersion(info) && supportsMenuSync(info)) return;

		throw new Error(
			'수집용 Host Agent는 정상이나 메뉴 동기화용 repo Agent 전환에 실패했습니다. 외부 앱 열기 확인창을 허용한 뒤 다시 시도하거나, 아래 PowerShell 대체 명령으로 실행해 주세요.',
		);
	};

	const postHostAgent = async (path: string, payload: Record<string, unknown>): Promise<HostMenuSyncResponse> => {
		const send = async (): Promise<{ res: Response; data: HostMenuSyncResponse }> => {
			const res = await fetch(`${HOST_AGENT_ORIGIN}${path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
			});
			const data = normalizeHostMenuSyncResponse(await res.json().catch(() => ({})));
			return { res, data };
		};

		if (path.startsWith('/menu-sync/')) {
			await ensureMenuSyncHostAgent();
		}

		let { res, data } = await send();
		const hostAgentErrorText = `${String(data?.error || '')} ${String(data?.detail || '')} ${String(data?.message || '')}`;
		const needsRepoRestart =
			res.status === 404 ||
			hostAgentErrorText.includes('not_found') ||
			hostAgentErrorText.includes('not_supported_in_standalone_host_agent');
		if (needsRepoRestart && path.startsWith('/menu-sync/')) {
			setMessage('메뉴동기화 기능이 없는 Host Agent가 감지되어 repo 기반 Agent로 재시작합니다. 외부 앱 열기 확인창이 뜨면 허용해 주세요.');
			const restarted = await restartHostAgentViaProtocol();
			if (restarted && supportsMenuSync(restarted)) {
				({ res, data } = await send());
			}
		}
		if (!res.ok || data?.ok === false) {
			const detail = String(data?.error || data?.message || `HTTP ${res.status}`).trim();
			throw new Error(detail || 'host_agent_request_failed');
		}
		return data;
	};

	const runHostNasPush = async (): Promise<void> => {
		if (!validateSelection()) return;
		setHostPushLoading(true);
		setError(null);
		setMessage(null);
		try {
			const token = await getFreshIdToken();
			const data = await postHostAgent('/menu-sync/push', {
				localApiBaseUrl: hostCallableApiBaseUrl,
				nasApiBaseUrl,
				menuIds: selectedIds,
				bundleFileName,
				localBearerToken: token,
				nasBearerToken: token,
				dateFrom: requiresDateScope ? dateFrom : '',
				dateTo: requiresDateScope ? dateTo : '',
			});
			setHostResult(data);
			setHostImportBundleName(String(data.bundlePath || bundleFileName).trim());
			notifyCollectionDataChanged('menu_sync_push');
			setMessage(`호스트에서 NAS push를 완료했습니다.${data.bundlePath ? ` 저장 번들: ${data.bundlePath}` : ''}`);
		} catch (requestError: any) {
			setHostResult({
				ok: false,
				action: 'menu-sync-push',
				bundlePath: String(hostImportBundleName || '').trim() || null,
				error: String(requestError?.message || '호스트 NAS push 실행에 실패했습니다.'),
			});
			setError(String(requestError?.message || '호스트 NAS push 실행에 실패했습니다.'));
		} finally {
			setHostPushLoading(false);
		}
	};

	const runHostDbReconcile = async (): Promise<void> => {
		if (!validateSelection()) return;
		setHostReconcileLoading(true);
		setError(null);
		setMessage(null);
		setHostRunSteps([
			'1) 선택 메뉴와 기간을 기준으로 로컬/NAS DB 차이를 계산합니다.',
			'2) 로컬 -> NAS 보강 번들을 생성하고 NAS에 import합니다.',
			'3) NAS -> 로컬 보강 번들을 생성하고 로컬에 import합니다.',
			'4) 반영 테이블과 반영 건수를 집계합니다.',
		]);
		try {
			const token = await getFreshIdToken();
			const data = await postHostAgent('/menu-sync/reconcile', {
				localApiBaseUrl: hostCallableApiBaseUrl,
				nasApiBaseUrl,
				menuIds: selectedIds,
				localBearerToken: token,
				nasBearerToken: token,
				dateFrom: requiresDateScope ? dateFrom : '',
				dateTo: requiresDateScope ? dateTo : '',
			});
			setHostResult(data);
			const localToNas = String((data as any).local_to_nas_bundlePath || '').trim();
			const nasToLocal = String((data as any).nas_to_local_bundlePath || '').trim();
			setHostImportBundleName(localToNas || nasToLocal || String(data.bundlePath || '').trim());
			notifyCollectionDataChanged('menu_sync_reconcile');
			const totalRows = sumImportedRows(importedTablesFromHostResult(data));
			setMessage(
				totalRows > 0
					? `로컬 DB와 NAS DB 양방향 맞춤을 완료했습니다. 반영 ${totalRows.toLocaleString()}건`
					: '로컬 DB와 NAS DB 양방향 맞춤을 완료했습니다. 동기화할 누락 항목은 없었습니다.',
			);
		} catch (requestError: any) {
			setHostResult({
				ok: false,
				action: 'menu-sync-db-reconcile',
				error: String(requestError?.message || '양방향 DB 맞춤 실행에 실패했습니다.'),
			});
			setError(String(requestError?.message || '양방향 DB 맞춤 실행에 실패했습니다.'));
		} finally {
			setHostReconcileLoading(false);
		}
	};

	const runHostTrackingGapAnalyze = async (): Promise<void> => {
		if (!trackingOnlySelected) {
			setError('내 상품 추적 메뉴를 단독 선택한 뒤 결측 분석을 실행해 주세요.');
			return;
		}
		if (!dateFrom || !dateTo) {
			setError('내 상품 추적 결측 분석은 시작일과 종료일이 필요합니다.');
			return;
		}
		setHostGapAnalyzeLoading(true);
		setError(null);
		setMessage(null);
		try {
			const token = await getFreshIdToken();
			const data = await postHostAgent('/menu-sync/tracking-gap-analyze', {
				localApiBaseUrl: hostCallableApiBaseUrl,
				nasApiBaseUrl,
				dateFrom,
				dateTo,
				localBearerToken: token,
				nasBearerToken: token,
			});
			setHostResult(data);
			setMessage(`내 상품 추적 결측 분석을 완료했습니다. 누락 날짜 ${Number(data.missing_date_count || 0)}건`);
		} catch (requestError: any) {
			setHostResult({
				ok: false,
				action: 'menu-sync-tracking-gap-analyze',
				error: String(requestError?.message || '결측 분석 실행에 실패했습니다.'),
			});
			setError(String(requestError?.message || '결측 분석 실행에 실패했습니다.'));
		} finally {
			setHostGapAnalyzeLoading(false);
		}
	};

	const runHostTrackingGapPush = async (): Promise<void> => {
		if (!trackingOnlySelected) {
			setError('내 상품 추적 메뉴를 단독 선택한 뒤 결측 NAS 보완을 실행해 주세요.');
			return;
		}
		if (!dateFrom || !dateTo) {
			setError('내 상품 추적 결측 보완은 시작일과 종료일이 필요합니다.');
			return;
		}
		setHostGapPushLoading(true);
		setError(null);
		setMessage(null);
		try {
			const token = await getFreshIdToken();
			const data = await postHostAgent('/menu-sync/tracking-gap-push', {
				localApiBaseUrl: hostCallableApiBaseUrl,
				nasApiBaseUrl,
				dateFrom,
				dateTo,
				localBearerToken: token,
				nasBearerToken: token,
			});
			setHostResult(data);
			setHostImportBundleName(String(data.bundlePath || '').trim());
			notifyCollectionDataChanged('menu_sync_tracking_gap_push');
			setMessage(
				data.missing_date_count && Number(data.missing_date_count) > 0
					? `내 상품 추적 결측 NAS 보완을 완료했습니다. 누락 날짜 ${data.missing_date_count}건`
					: '내 상품 추적 결측이 없어 추가 반영 없이 종료했습니다.',
			);
		} catch (requestError: any) {
			setHostResult({
				ok: false,
				action: 'menu-sync-tracking-gap-push',
				error: String(requestError?.message || '결측 NAS 보완 실행에 실패했습니다.'),
			});
			setError(String(requestError?.message || '결측 NAS 보완 실행에 실패했습니다.'));
		} finally {
			setHostGapPushLoading(false);
		}
	};

	const runHostNasImport = async (): Promise<void> => {
		const targetValue = String(hostImportBundleName || '').trim();
		if (!targetValue) {
			setError('호스트에서 import할 번들 경로 또는 파일명을 입력해 주세요.');
			return;
		}
		setHostImportLoading(true);
		setError(null);
		setMessage(null);
		try {
			const token = await getFreshIdToken();
			const payload = isPathLike(targetValue)
				? {
						bundlePath: targetValue,
						nasApiBaseUrl,
						bearerToken: token,
					}
				: {
						bundleFileName: targetValue,
						nasApiBaseUrl,
						bearerToken: token,
					};
			const data = await postHostAgent('/menu-sync/import', {
				...payload,
			});
			setHostResult(data);
			setHostImportBundleName(String(data.bundlePath || targetValue).trim());
			notifyCollectionDataChanged('menu_sync_host_import');
			setMessage(`호스트에서 NAS import를 완료했습니다.${data.bundlePath ? ` 사용 번들: ${data.bundlePath}` : ''}`);
		} catch (requestError: any) {
			setHostResult({
				ok: false,
				action: 'menu-sync-import',
				bundlePath: String(targetValue || '').trim() || null,
				error: String(requestError?.message || '호스트 NAS import 실행에 실패했습니다.'),
			});
			setError(String(requestError?.message || '호스트 NAS import 실행에 실패했습니다.'));
		} finally {
			setHostImportLoading(false);
		}
	};

	const hostImportedTables = importedTablesFromHostResult(hostResult);
	const isReconcileResult = hostResult?.action === 'menu-sync-db-reconcile';
	const reconcileLocalToNasTables = hostResult?.nas_import_response?.imported_tables || [];
	const reconcileNasToLocalTables = hostResult?.local_import_response?.imported_tables || [];
	const reconcileTotalRows = sumImportedRows(hostImportedTables);

	return (
		<div style={{ maxWidth: 980, margin: '0 auto' }}>
			<div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
				<div>
					<div className="card-title" style={{ marginBottom: 4, fontSize: 18 }}>메뉴동기화</div>
					<p className="card-caption" style={{ marginBottom: 0 }}>
						개발 PC의 로컬 DB 데이터를 번들(zip)로 생성하고, 검증 후 NAS DB에 반영합니다.
					</p>
					<div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
						<span style={{ borderRadius: 999, padding: '3px 8px', fontSize: 12, fontWeight: 800, background: accessMode === 'local' ? '#fef3c7' : accessMode === 'nas' ? '#dcfce7' : '#e5e7eb', color: accessMode === 'local' ? '#92400e' : accessMode === 'nas' ? '#166534' : '#374151' }}>
							{accessModeLabel}
						</span>
						<span className="card-caption">
							{accessMode === 'local'
								? '현재 화면은 로컬 DB 기준입니다. NAS 반영은 아래 NAS push/import를 사용하세요.'
								: accessMode === 'nas'
									? '현재 화면은 NAS DB 기준입니다. 로컬 개발 데이터 반영 시 로컬에서 export한 번들을 import하세요.'
									: 'API 접속 환경을 확인할 수 없습니다.'}
						</span>
					</div>
				</div>
			</div>

			{message ? (
				<div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.4)', backgroundColor: 'rgba(34,197,94,0.1)', color: '#bbf7d0' }}>
					{message}
				</div>
			) : null}
			{error ? (
				<div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', backgroundColor: 'rgba(248,113,113,0.1)', color: '#fecaca' }}>
					{error}
				</div>
			) : null}

			<div className="card" style={{ marginBottom: 16 }}>
				<div style={{ padding: '16px 20px' }}>
					<div className="card-title" style={{ marginBottom: 6 }}>동기화 대상 선택</div>
					<p className="card-caption" style={{ marginBottom: 16 }}>
						리뷰/Q&A, 내 상품 추적뿐 아니라 광고 성과, 판매/구매, 검색/쇼핑 순위, 상품 상세 메트릭까지 선택해 NAS로 반영할 수 있습니다.
					</p>
					{loadingMenus ? <div className="card-caption">메뉴 목록을 불러오는 중...</div> : null}
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
						{menus.map((item) => {
							const checked = selectedIds.includes(item.id);
							const disabled = item.status !== 'active';
							return (
								<label key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 8, border: '1px solid rgba(148,163,184,0.18)', backgroundColor: 'rgba(15,23,42,0.45)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
									<input
										type="checkbox"
										aria-label={item.label}
										checked={checked}
										disabled={disabled}
										onChange={() => toggleMenu(item.id)}
									/>
									<span>
										<strong style={{ display: 'block', marginBottom: 4 }}>{item.label}</strong>
										<span style={{ display: 'block', color: '#cbd5e1', fontSize: 13 }}>{item.description || '-'}</span>
										<span style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginTop: 6 }}>
											상태: {item.status === 'active' ? '사용 가능' : '준비 중'}
										</span>
									</span>
								</label>
							);
						})}
					</div>
					{requiresDateScope ? (
						<div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
							<label style={{ display: 'block' }}>
								<span style={{ display: 'block', marginBottom: 6, color: '#cbd5e1' }}>시작일</span>
								<input aria-label="동기화 시작일" className="input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
							</label>
							<label style={{ display: 'block' }}>
								<span style={{ display: 'block', marginBottom: 6, color: '#cbd5e1' }}>종료일</span>
								<input aria-label="동기화 종료일" className="input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
							</label>
						</div>
					) : null}
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
						<button type="button" className="btn-ghost" onClick={() => void loadPreview()} disabled={previewLoading || selectedIds.length === 0}>
							{previewLoading ? '구성 계산 중...' : '구성 미리보기'}
						</button>
						<button type="button" className="btn-primary" onClick={() => void exportBundle()} disabled={exportLoading || selectedIds.length === 0}>
							{exportLoading ? '생성 중...' : '동기화 번들 생성'}
						</button>
					</div>
				</div>
			</div>

			<div className="card" style={{ marginBottom: 16 }}>
				<div style={{ padding: '16px 20px' }}>
					<div className="card-title" style={{ marginBottom: 6 }}>번들 정보</div>
					<div className="card-caption" style={{ marginBottom: 12 }}>
						선택 메뉴: {selectedLabels.length > 0 ? selectedLabels.join(', ') : '-'}
					</div>
					{requiresDateScope ? (
						<div className="card-caption" style={{ marginBottom: 12 }}>
							대상 기간: {dateFrom || '-'} ~ {dateTo || '-'}
						</div>
					) : null}
					{bundleFileName ? (
						<div style={{ display: 'grid', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
							<div><strong>최근 브라우저 다운로드 번들:</strong> {bundleFileName}</div>
							<div><strong>생성 시각:</strong> {formatDateTime(bundleCreatedAt)}</div>
							<div><strong>최근 프로젝트 저장 경로:</strong> {hostResult?.action === 'menu-sync-export' || hostResult?.action === 'menu-sync-push' ? hostResult?.bundlePath || '-' : '-'}</div>
						</div>
					) : (
						<div className="card-caption">아직 생성된 번들이 없습니다.</div>
					)}
					{preview ? (
						<div style={{ marginTop: 14 }}>
							<div className="card-caption" style={{ marginBottom: 8 }}>
								manifest 기준 정보: {preview.schema_version} / {formatDateTime(preview.generated_at)}
							</div>
							{preview.menu_summaries.map((menu) => (
								<div key={menu.menu_id} style={{ marginBottom: 14, padding: 12, borderRadius: 8, backgroundColor: 'rgba(2,6,23,0.45)' }}>
									<div style={{ fontWeight: 700, marginBottom: 8 }}>{menu.label}</div>
									<div style={{ display: 'grid', gap: 6 }}>
										{menu.tables.map((table) => (
											<div key={table.table_name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
												<span>{table.table_name}</span>
												<span>{table.row_count}건</span>
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					) : null}
				</div>
			</div>

			<div className="card" style={{ marginBottom: 16 }}>
				<div style={{ padding: '16px 20px' }}>
					<div className="card-title" style={{ marginBottom: 6 }}>로컬 Import 검증</div>
					<p className="card-caption" style={{ marginBottom: 12 }}>
						생성된 번들을 다시 로컬에 import해 idempotent 동작과 검증 로직을 확인할 수 있습니다.
					</p>
					<label style={{ display: 'block', marginBottom: 12 }}>
						<span style={{ display: 'block', marginBottom: 6, color: '#cbd5e1' }}>동기화 번들 업로드</span>
						<input
							aria-label="동기화 번들 업로드"
							type="file"
							accept=".zip,application/zip"
							onChange={(event) => setImportFile(event.target.files?.[0] || null)}
						/>
					</label>
					<button type="button" className="btn-primary" onClick={() => void runImport()} disabled={importLoading || !importFile}>
						{importLoading ? 'Import 중...' : '로컬 Import 실행'}
					</button>
					{importResult ? (
						<div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
							{(importResult.imported_tables || []).map((table) => (
								<div key={table.table_name} style={{ fontSize: 13, color: '#cbd5e1' }}>
									{formatImportTableSummary(table)}
								</div>
							))}
						</div>
					) : null}
				</div>
			</div>

			<div className="card">
				<div style={{ padding: '16px 20px' }}>
					<div className="card-title" style={{ marginBottom: 6 }}>NAS 반영 명령</div>
					<p className="card-caption" style={{ marginBottom: 12 }}>
						기본은 로컬 DB와 NAS DB를 분석한 뒤 양방향으로 누락분을 보강해 같은 상태로 맞추는 방식입니다. 권장 NAS 값은 `http://192.168.0.50:6188/api` 입니다.
					</p>
					<label style={{ display: 'block', marginBottom: 12 }}>
						<span style={{ display: 'block', marginBottom: 6, color: '#cbd5e1' }}>NAS Base URL</span>
						<input
							className="input"
							value={nasApiBaseUrl}
							onChange={(event) => setNasApiBaseUrl(event.target.value)}
						/>
					</label>
					<div style={{ display: 'grid', gap: 12 }}>
						<div style={{ padding: 12, borderRadius: 8, border: '1px solid rgba(34,197,94,0.35)', backgroundColor: 'rgba(34,197,94,0.08)' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
								<strong>양방향 DB 맞춤 (권장)</strong>
								<button type="button" className="btn-primary" onClick={() => void runHostDbReconcile()} disabled={hostReconcileLoading || selectedIds.length === 0}>
									{hostReconcileLoading ? '양방향 맞춤 중...' : '로컬/NAS DB 맞춤 실행'}
								</button>
							</div>
							<div className="card-caption">
								로컬에서 NAS로, NAS에서 로컬로 각각 번들을 생성해 import합니다. 서버 import 정책에 따라 기존 데이터는 보존하고 누락분을 보강합니다.
							</div>
							{hostReconcileLoading && hostRunSteps.length > 0 ? (
								<div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 13, color: '#bbf7d0' }}>
									<strong>현재 진행 중</strong>
									{hostRunSteps.map((step) => (
										<div key={step}>{step}</div>
									))}
								</div>
							) : null}
						</div>
						<div>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
								<strong>NAS 단방향 push 명령 (수동/예외용)</strong>
								<div style={{ display: 'flex', gap: 8 }}>
									<button type="button" className="btn-ghost" onClick={() => void runHostNasPush()} disabled={!nasPushCommand || hostPushLoading}>
										{hostPushLoading ? '호스트 실행 중...' : '호스트에서 NAS push 실행'}
									</button>
									<button type="button" className="btn-ghost" onClick={() => void copyCommand(nasPushCommand)} disabled={!nasPushCommand}>명령 복사</button>
								</div>
							</div>
							<pre style={{ margin: 0, padding: 12, borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.6)', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
								{nasPushCommand || '번들을 생성하면 NAS push 명령이 표시됩니다.'}
							</pre>
						</div>
						<div>
							<label style={{ display: 'block', marginBottom: 8 }}>
								<span style={{ display: 'block', marginBottom: 6, color: '#cbd5e1' }}>호스트 import 번들 경로 또는 파일명</span>
								<input
									aria-label="호스트 import 번들 경로 또는 파일명"
									className="input"
									value={hostImportBundleName}
									onChange={(event) => setHostImportBundleName(event.target.value)}
									placeholder="예: D:\dev\ERP2-analytics\artifacts\menu-sync\menu_sync_review_qna.zip"
								/>
							</label>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
								<strong>NAS import 명령</strong>
								<div style={{ display: 'flex', gap: 8 }}>
									<button type="button" className="btn-ghost" onClick={() => void runHostNasImport()} disabled={hostImportLoading || !hostImportBundleName}>
										{hostImportLoading ? '호스트 실행 중...' : '호스트에서 NAS import 실행'}
									</button>
									<button type="button" className="btn-ghost" onClick={() => void copyCommand(nasImportCommand)} disabled={!nasImportCommand}>명령 복사</button>
								</div>
							</div>
							<pre style={{ margin: 0, padding: 12, borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.6)', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
								{nasImportCommand || '번들을 생성하면 NAS import 명령이 표시됩니다.'}
							</pre>
						</div>
						{trackingOnlySelected ? (
							<div>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
									<strong>내 상품 추적 결측 보완</strong>
									<div style={{ display: 'flex', gap: 8 }}>
										<button type="button" className="btn-ghost" onClick={() => void runHostTrackingGapAnalyze()} disabled={hostGapAnalyzeLoading}>
											{hostGapAnalyzeLoading ? '분석 중...' : '호스트에서 결측 분석 실행'}
										</button>
										<button type="button" className="btn-ghost" onClick={() => void runHostTrackingGapPush()} disabled={hostGapPushLoading}>
											{hostGapPushLoading ? '보완 중...' : '호스트에서 결측 NAS 보완 실행'}
										</button>
										<button type="button" className="btn-ghost" onClick={() => void copyCommand(trackingGapPushCommand)} disabled={!trackingGapPushCommand}>
											명령 복사
										</button>
									</div>
								</div>
								<pre style={{ margin: 0, padding: 12, borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.6)', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
									{trackingGapPushCommand || '내 상품 추적을 단독 선택하면 결측 보완 명령이 표시됩니다.'}
								</pre>
							</div>
						) : null}
					</div>
					{hostResult ? (
						<div style={{ marginTop: 14, padding: 12, borderRadius: 8, backgroundColor: 'rgba(2,6,23,0.45)', color: '#cbd5e1', fontSize: 13 }}>
							<div><strong>최근 호스트 실행 상태:</strong> {hostResult.ok === false ? '실패' : '성공'}</div>
							<div><strong>최근 호스트 실행:</strong> {hostResult.action || '-'}</div>
							<div><strong>프로젝트 번들 경로:</strong> {hostResult.bundlePath || '-'}</div>
							{isReconcileResult ? (
								<div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid rgba(34,197,94,0.25)', backgroundColor: 'rgba(34,197,94,0.06)' }}>
									<div style={{ fontWeight: 800, marginBottom: 8 }}>양방향 DB 맞춤 결과</div>
									<div>선택 메뉴: {selectedLabels.length > 0 ? selectedLabels.join(', ') : (hostResult.menus || []).join(', ') || '-'}</div>
									{requiresDateScope ? <div>대상 기간: {hostResult.date_from || dateFrom || '-'} ~ {hostResult.date_to || dateTo || '-'}</div> : null}
									<div>{'로컬 -> NAS 번들'}: {hostResult.local_to_nas_bundlePath || '-'}</div>
									<div>{'NAS -> 로컬 번들'}: {hostResult.nas_to_local_bundlePath || '-'}</div>
									<div style={{ marginTop: 6 }}>
										<strong>총 반영:</strong> {reconcileTotalRows.toLocaleString()}건
										{reconcileTotalRows === 0 ? ' (동기화할 누락 항목 없음)' : ''}
									</div>
								</div>
							) : null}
							{hostRunSteps.length > 0 && (hostReconcileLoading || isReconcileResult) ? (
								<div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
									<strong>진행 과정</strong>
									{hostRunSteps.map((step) => (
										<div key={step}>{step}</div>
									))}
								</div>
							) : null}
							{hostResult.error ? <div><strong>오류:</strong> {hostResult.error}</div> : null}
							{hostResult.detail ? <div><strong>상세:</strong> {hostResult.detail}</div> : null}
							{typeof hostResult.missing_date_count === 'number' && hostResult.action?.includes('tracking-gap') ? (
								<div><strong>누락 날짜 수:</strong> {hostResult.missing_date_count}건</div>
							) : null}
							{Array.isArray(hostResult.missing_dates) && hostResult.missing_dates.length > 0 ? (
								<div style={{ marginTop: 10 }}>
									<strong>누락 날짜</strong>
									<div style={{ marginTop: 6 }}>{hostResult.missing_dates.join(', ')}</div>
								</div>
							) : null}
							{Array.isArray(hostResult.gap_items) && hostResult.gap_items.length > 0 ? (
								<div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
									<strong>결측 상세</strong>
									{hostResult.gap_items.slice(0, 12).map((item) => (
										<div key={`${item.date}-${item.table_name}`}>
											{item.date} / {item.table_name} / 누락 {item.missing_key_count}건
										</div>
									))}
									{hostResult.gap_items.length > 12 ? <div>... 외 {hostResult.gap_items.length - 12}건</div> : null}
								</div>
							) : null}
							{isReconcileResult ? (
								<div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
									<div style={{ display: 'grid', gap: 6 }}>
										<strong>{'로컬 -> NAS 반영 항목'}</strong>
										{reconcileLocalToNasTables.length > 0 ? (
											reconcileLocalToNasTables.map((table) => (
												<div key={`l2n-${table.table_name}`}>
													{formatImportTableSummary(table)}
												</div>
											))
										) : (
											<div>반영할 항목 없음</div>
										)}
									</div>
									<div style={{ display: 'grid', gap: 6 }}>
										<strong>{'NAS -> 로컬 반영 항목'}</strong>
										{reconcileNasToLocalTables.length > 0 ? (
											reconcileNasToLocalTables.map((table) => (
												<div key={`n2l-${table.table_name}`}>
													{formatImportTableSummary(table)}
												</div>
											))
										) : (
											<div>반영할 항목 없음</div>
										)}
									</div>
								</div>
							) : hostImportedTables.length > 0 ? (
								<div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
									<strong>최근 NAS 반영 건수</strong>
									{hostImportedTables.map((table) => (
										<div key={table.table_name}>
											{formatImportTableSummary(table)}
										</div>
									))}
								</div>
							) : null}
							{hostResult.output ? (
								<pre style={{ marginTop: 10, padding: 12, borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.6)', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
									{hostResult.output}
								</pre>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
