import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
	fetchAdgroupDaily,
	fetchAdsAvailability,
	fetchCampaignDaily,
	fetchGfaAdgroupInventory,
	fetchGfaCampaignInventory,
	fetchGfaCreativeInventory,
	fetchCreativeDaily,
	fetchKeywordDaily,
	fetchSearchwordDaily,
	fetchSearchwordDailyAll,
	type AdgroupDailyAggRow,
	type AdgroupInventoryRow,
	type CampaignDailyAggRow,
	type CampaignInventoryRow,
	type CreativeDailyRow,
	type CreativeInventoryRow,
	type AdsPlatform,
	type KeywordDailyRow,
	type SearchwordDailyRow,
} from './adsApi';
import { AdsDateControls, loadAdsDateState, saveAdsDateState, type AdsDateState } from './AdsDateControls';
import { aggregateByKey, calcMetricDeltas, computeMetrics, type MetricComputed, type MetricTotals } from './adsMetrics';
import { computeAdsCampaignAgg, computeAdsKeywordsUnifiedAgg, type AdsCampaignAggResult, type AggTermRow, type CampaignKindKey } from './adsAgg';
import { defaultYesterdayRange, normalizeRange, rangeLengthDays, shiftRange, toYmd } from './dateRangeUtils';
import { AdsTable, type AdsLeftColumnKey, type AdsMetricColumnKey, type AdsRow } from './AdsTables';
import { adsJobCache, type JobState } from './adsJobCache';
import { chunkYmdRange, groupContiguousDates } from './adsRangeChunking';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AdsCreativesTable, type CreativeAggRow, type CreativeColumnKey } from './AdsCreativesTable';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { formatInt, formatPct, formatWon } from './format';
import { KeywordInsightsTrendsModal } from './KeywordInsightsTrendsModal';
import { AdsColumnSettingsModal, type AdsColumnSettingOption } from './AdsColumnSettingsModal';

type FetchState = {
	loading: boolean;
	error: string | null;
};

type EnsureState = {
	ensuring: boolean;
	message: string | null;
};

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

function normalizeAdsEntityKeyPart(value: unknown): string {
	return String(value ?? '').trim().replace(/^#+/, '').trim();
}

function applyGfaYesterdayStatusToRows<T extends CampaignDailyAggRow | AdgroupDailyAggRow>(
	kind: 'campaign' | 'adgroup',
	rows: T[],
	yesterdayRows: Array<CampaignDailyAggRow | AdgroupDailyAggRow>,
): T[] {
	const rowKey = (row: CampaignDailyAggRow | AdgroupDailyAggRow): string => {
		if (kind === 'campaign') return normalizeAdsEntityKeyPart((row as CampaignDailyAggRow).campaign_name);
		const rr = row as AdgroupDailyAggRow;
		return `${normalizeAdsEntityKeyPart(rr.campaign_name)}||${normalizeAdsEntityKeyPart(rr.adgroup_name)}`;
	};
	const activeKeys = new Set((yesterdayRows || []).map(rowKey).filter(Boolean));
	return (rows || []).map((row) => {
		const active = activeKeys.has(rowKey(row));
		return {
			...row,
			is_active: active,
			...(kind === 'campaign' ? { campaign_status: active ? '운영중' : '종료' } : { adgroup_status: active ? '운영중' : '종료' }),
		};
	});
}

function applyGfaYesterdayCreativeStatusToRows(
	rows: CreativeDailyRow[],
	yesterdayRows: CreativeDailyRow[],
): CreativeDailyRow[] {
	const rowKey = (row: CreativeDailyRow): string =>
		`${normalizeAdsEntityKeyPart(row.campaign_name)}||${normalizeAdsEntityKeyPart(row.adgroup_name)}||${String(row.creative_id ?? '').trim()}`;
	const activeKeys = new Set((yesterdayRows || []).map(rowKey).filter(Boolean));
	return (rows || []).map((row) => {
		const active = activeKeys.has(rowKey(row));
		return {
			...row,
			is_active: active,
			creative_status: active ? '운영중' : '종료',
		};
	});
}

function mergeGfaCampaignInventoryRows(
	rows: CampaignDailyAggRow[],
	inventoryRows: CampaignInventoryRow[],
	dateFallback: string,
): CampaignDailyAggRow[] {
	const byKey = new Map<string, CampaignDailyAggRow>();
	for (const row of rows || []) {
		const key = normalizeAdsEntityKeyPart(row.campaign_name);
		if (!key) continue;
		const current = byKey.get(key);
		if (!current) {
			byKey.set(key, row);
			continue;
		}
		const currentCost = Number(current.cost || 0);
		const nextCost = Number(row.cost || 0);
		if (nextCost > currentCost) {
			byKey.set(key, row);
		}
	}
	for (const item of inventoryRows || []) {
		const key = normalizeAdsEntityKeyPart(item.campaign_name);
		if (!key) continue;
		const current = byKey.get(key);
		if (current) {
			byKey.set(key, {
				...current,
				campaign_status: current.campaign_status ?? item.campaign_status ?? null,
				ended_on: current.ended_on ?? item.ended_on ?? null,
				campaign_status_basis: current.campaign_status_basis ?? item.campaign_status_basis ?? null,
				status_collected_at: current.status_collected_at ?? item.status_collected_at ?? null,
				is_active: typeof current.is_active === 'boolean' ? current.is_active : (item.is_active ?? null),
			});
			continue;
		}
		byKey.set(key, {
			date: dateFallback,
			campaign_name: item.campaign_name,
			campaign_status: item.campaign_status ?? '종료',
			ended_on: item.ended_on ?? null,
			campaign_status_basis: item.campaign_status_basis ?? null,
			status_collected_at: item.status_collected_at ?? null,
			is_active: item.is_active ?? false,
			impressions: 0,
			clicks: 0,
			cost: 0,
			conversions: 0,
			revenue: 0,
			purchase_conversions: 0,
			purchase_revenue: 0,
			ctr: 0,
			cpc: 0,
			cvr: 0,
			roas: 0,
		});
	}
	return Array.from(byKey.values());
}

function mergeGfaAdgroupInventoryRows(
	rows: AdgroupDailyAggRow[],
	inventoryRows: AdgroupInventoryRow[],
	dateFallback: string,
): AdgroupDailyAggRow[] {
	const rowKey = (campaignName: unknown, adgroupName: unknown): string =>
		`${normalizeAdsEntityKeyPart(campaignName)}||${normalizeAdsEntityKeyPart(adgroupName)}`;
	const byKey = new Map<string, AdgroupDailyAggRow>();
	for (const row of rows || []) {
		const key = rowKey(row.campaign_name, row.adgroup_name);
		if (!key) continue;
		const current = byKey.get(key);
		if (!current) {
			byKey.set(key, row);
			continue;
		}
		const currentCost = Number(current.cost || 0);
		const nextCost = Number(row.cost || 0);
		if (nextCost > currentCost) {
			byKey.set(key, row);
		}
	}
	for (const item of inventoryRows || []) {
		const key = rowKey(item.campaign_name, item.adgroup_name);
		if (!key) continue;
		const current = byKey.get(key);
		if (current) {
			byKey.set(key, {
				...current,
				campaign_status: current.campaign_status ?? item.campaign_status ?? null,
				adgroup_status: current.adgroup_status ?? item.adgroup_status ?? null,
				ended_on: current.ended_on ?? item.ended_on ?? null,
				adgroup_status_basis: current.adgroup_status_basis ?? item.adgroup_status_basis ?? null,
				status_collected_at: current.status_collected_at ?? item.status_collected_at ?? null,
				is_active: typeof current.is_active === 'boolean' ? current.is_active : (item.is_active ?? null),
			});
			continue;
		}
		byKey.set(key, {
			date: dateFallback,
			campaign_name: item.campaign_name,
			adgroup_name: item.adgroup_name,
			campaign_status: item.campaign_status ?? null,
			adgroup_status: item.adgroup_status ?? '종료',
			ended_on: item.ended_on ?? null,
			adgroup_status_basis: item.adgroup_status_basis ?? null,
			status_collected_at: item.status_collected_at ?? null,
			is_active: item.is_active ?? false,
			impressions: 0,
			clicks: 0,
			cost: 0,
			conversions: 0,
			revenue: 0,
			purchase_conversions: 0,
			purchase_revenue: 0,
			ctr: 0,
			cpc: 0,
			cvr: 0,
			roas: 0,
		});
	}
	return Array.from(byKey.values());
}

function mergeGfaCreativeInventoryRows(
	rows: CreativeDailyRow[],
	inventoryRows: CreativeInventoryRow[],
	dateFallback: string,
): CreativeDailyRow[] {
	const rowKey = (campaignName: unknown, adgroupName: unknown, creativeId: unknown): string =>
		`${normalizeAdsEntityKeyPart(campaignName)}||${normalizeAdsEntityKeyPart(adgroupName)}||${String(creativeId ?? '').trim()}`;
	const byKey = new Map<string, CreativeDailyRow>();
	for (const row of rows || []) {
		const key = rowKey(row.campaign_name, row.adgroup_name, row.creative_id);
		if (!key) continue;
		byKey.set(key, row);
	}
	for (const item of inventoryRows || []) {
		const key = rowKey(item.campaign_name, item.adgroup_name, item.creative_id);
		if (!key) continue;
		const current = byKey.get(key);
		if (current) {
			byKey.set(key, {
				...current,
				creative_name: current.creative_name || item.creative_name || current.creative_id,
				creative_status: current.creative_status ?? item.creative_status ?? null,
				ended_on: current.ended_on ?? item.ended_on ?? null,
				creative_status_basis: current.creative_status_basis ?? item.creative_status_basis ?? null,
				status_collected_at: current.status_collected_at ?? item.status_collected_at ?? null,
				is_active: typeof current.is_active === 'boolean' ? current.is_active : (item.is_active ?? null),
				image_url: current.image_url ?? item.image_url ?? null,
				ad_type: current.ad_type ?? item.ad_type ?? 'GFA',
			});
			continue;
		}
		byKey.set(key, {
			date: dateFallback,
			campaign_name: item.campaign_name,
			adgroup_name: item.adgroup_name,
			creative_id: item.creative_id,
			device: 'ALL',
			creative_status: item.creative_status ?? null,
			ended_on: item.ended_on ?? null,
			creative_status_basis: item.creative_status_basis ?? null,
			status_collected_at: item.status_collected_at ?? null,
			is_active: item.is_active ?? null,
			creative_name: item.creative_name || item.creative_id,
			display_keyword: null,
			product_title: null,
			image_url: item.image_url ?? null,
			ad_type: item.ad_type ?? 'GFA',
			current_bid: null,
			quality_index: null,
			avg_rank: null,
			organic_keyword: null,
			organic_rank: null,
			organic_rank_source: null,
			organic_rank_date: null,
			match_status: null,
			match_rule: null,
			matched_product_url: null,
			matched_product_title: null,
			impressions: 0,
			clicks: 0,
			cost: 0,
			conversions: 0,
			revenue: 0,
			purchase_conversions: 0,
			purchase_revenue: 0,
			ctr: 0,
			cpc: 0,
			cvr: 0,
			roas: 0,
			source: 'gfa_inventory',
		});
	}
	return Array.from(byKey.values());
}

function isReportNotReadyError(err: unknown): boolean {
	if (!axios.isAxiosError(err)) return false;
	const status = err.response?.status;
	const detail = String((err.response?.data as any)?.detail ?? '');
	return status === 503 && detail.includes('REPORT_NOT_READY');
}

function errorDetailText(err: unknown): string {
	if (axios.isAxiosError(err)) {
		const detail = (err.response?.data as any)?.detail;
		if (detail != null) return formatAxiosErrorDetail(detail);
	}
	return String((err as any)?.message ?? err ?? '데이터를 불러오지 못했습니다.');
}

type OperationalStatusFilter = 'all' | 'active' | 'inactive' | 'unknown';

function operationalActiveOf(row: any): boolean | null {
	const statusActive = row?.status?.isActive;
	if (typeof statusActive === 'boolean') return statusActive;
	const directActive = row?.is_active;
	if (typeof directActive === 'boolean') return directActive;
	return null;
}

function matchesOperationalStatusFilter(row: any, filter: OperationalStatusFilter): boolean {
	if (filter === 'all') return true;
	const active = operationalActiveOf(row);
	if (filter === 'active') return active === true;
	if (filter === 'inactive') return active === false;
	return active == null;
}

/** FastAPI 422 등 validation error의 detail(배열/객체)을 사람이 읽을 수 있는 문자열로 변환 */
function formatAxiosErrorDetail(detail: unknown): string {
	if (typeof detail === 'string') return detail;
	if (Array.isArray(detail) && detail.length > 0) {
		const first = detail[0] as { msg?: string } | undefined;
		return first?.msg ?? JSON.stringify(detail);
	}
	if (typeof detail === 'object' && detail !== null && 'msg' in detail) {
		return String((detail as { msg?: string }).msg ?? JSON.stringify(detail));
	}
	return String(detail);
}

function sanitizeExcelFilePart(value: unknown): string {
	const s = String(value ?? '').trim();
	return (s || 'export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

async function downloadExcelWorkbook(args: {
	fileName: string;
	sheets: Array<{
		name: string;
		rows?: Array<Record<string, unknown>>;
		aoa?: unknown[][];
		cols?: Array<{ wch: number }>;
		merges?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
	}>;
}): Promise<void> {
	const XLSX = await import('xlsx-js-style') as any;
	const wb = XLSX.utils.book_new();
	for (const sheet of args.sheets) {
		const ws = sheet.aoa
			? XLSX.utils.aoa_to_sheet(sheet.aoa.length > 0 ? sheet.aoa : [['표시할 데이터가 없습니다.']])
			: XLSX.utils.json_to_sheet((sheet.rows && sheet.rows.length > 0) ? sheet.rows : [{ 안내: '표시할 데이터가 없습니다.' }]);
		if (sheet.cols) (ws as any)['!cols'] = sheet.cols;
		if (sheet.merges) (ws as any)['!merges'] = sheet.merges;
		if (sheet.aoa) {
			const range = XLSX.utils.decode_range((ws as any)['!ref'] || 'A1:A1');
			const isSingleCellRow = (r: number): boolean => {
				const row = sheet.aoa?.[r] ?? [];
				return row.length > 0 && String(row[0] ?? '').trim().length > 0 && row.slice(1).every((v) => String(v ?? '').trim() === '');
			};
			for (let r = range.s.r; r <= range.e.r; r += 1) {
				const row = sheet.aoa[r] ?? [];
				const rowIsBlank = row.every((v) => String(v ?? '').trim() === '');
				const rowIsSingle = isSingleCellRow(r);
				const rowAfterSingle = r > 0 && isSingleCellRow(r - 1);
				const rowIsHeader = !rowIsBlank && (r === 3 || rowAfterSingle) && !rowIsSingle;
				const rowIsTitle = r === 0;
				const rowIsSubtitle = r === 1;
				const rowIsGroupTitle = r > 1 && rowIsSingle;
				for (let c = range.s.c; c <= range.e.c; c += 1) {
					const addr = XLSX.utils.encode_cell({ r, c });
					const cell = (ws as any)[addr];
					if (!cell) continue;
					const text = String(cell.v ?? '');
					const isUp = text.includes('\n▲');
					const isDown = text.includes('\n▼');
					cell.s = {
						alignment: { vertical: 'center', horizontal: c === 0 ? 'left' : 'center', wrapText: true },
						font: {
							name: '맑은 고딕',
							sz: rowIsTitle ? 12 : 10,
							bold: rowIsTitle || rowIsHeader || rowIsGroupTitle,
							color: { rgb: isUp ? '2563EB' : isDown ? 'DC2626' : rowIsTitle || rowIsHeader || rowIsGroupTitle ? '111827' : '1F2937' },
						},
						fill: rowIsTitle
							? { patternType: 'solid', fgColor: { rgb: 'DBEAFE' } }
							: rowIsHeader
								? { patternType: 'solid', fgColor: { rgb: 'E5E7EB' } }
								: rowIsGroupTitle
									? { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }
									: rowIsSubtitle
										? { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } }
										: undefined,
						border: {
							top: { style: 'thin', color: { rgb: 'D1D5DB' } },
							bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
							left: { style: 'thin', color: { rgb: 'E5E7EB' } },
							right: { style: 'thin', color: { rgb: 'E5E7EB' } },
						},
					};
				}
			}
			(ws as any)['!rows'] = (sheet.aoa || []).map((row) => {
				const hasMultiline = row.some((v) => String(v ?? '').includes('\n'));
				return { hpt: hasMultiline ? 34 : 22 };
			});
		}
		const safeName = String(sheet.name || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
		XLSX.utils.book_append_sheet(wb, ws, safeName);
	}
	const fileName = String(args.fileName || 'analytics_export.xlsx')
		.replace(/[\\/:*?"<>|]+/g, '_')
		.replace(/\s+/g, '_')
		.replace(/_+\.xlsx$/i, '.xlsx')
		.replace(/\.xlsx$/i, '') + '.xlsx';
	const array = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
	const blob = new Blob([array], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	window.setTimeout(() => {
		try { document.body.removeChild(a); } catch {}
		URL.revokeObjectURL(url);
	}, 0);
}

function formatExportValue(value: unknown, kind: 'int' | 'won' | 'pct' | 'float' | 'text'): string {
	if (kind === 'text') return String(value ?? '');
	if (value == null || String(value).trim() === '') return '';
	const n = Number(value);
	if (!Number.isFinite(n)) return '-';
	if (kind === 'won') return formatWon(n);
	if (kind === 'pct') return formatPct(n);
	if (kind === 'float') return Number.isInteger(n) ? formatInt(n) : n.toFixed(1).replace(/\.0$/, '');
	return formatInt(n);
}

function metricValueKind(key: AdsMetricColumnKey | CreativeColumnKey): 'int' | 'won' | 'pct' | 'float' {
	if (key === 'cost' || key === 'cpc' || key === 'revenue' || key === 'purchase_revenue' || key === 'cpa' || key === 'bid') return 'won';
	if (key === 'ctr' || key === 'cvr' || key === 'roas' || key === 'purchase_roas' || key === 'purchase_cvr') return 'pct';
	if (key === 'quality' || key === 'avgRank' || key === 'organicRank') return 'float';
	return 'int';
}

function formatExportDelta(diff: unknown, pct: unknown, kind: 'int' | 'won' | 'pct' | 'float'): string {
	const d = Number(diff);
	if (!Number.isFinite(d) || d === 0) return '';
	const arrow = d > 0 ? '▲' : '▼';
	const body = formatExportValue(Math.abs(d), kind);
	const p = pct == null ? null : Number(pct);
	const pctText = p != null && Number.isFinite(p) ? ` (${formatPct(Math.abs(p))})` : '';
	return `${arrow} ${body}${pctText}`;
}

function metricUiCell(value: unknown, diff: unknown, pct: unknown, kind: 'int' | 'won' | 'pct' | 'float'): string {
	if (value == null || String(value).trim() === '') return '';
	const delta = formatExportDelta(diff, pct, kind);
	return delta ? `${formatExportValue(value, kind)}\n${delta}` : formatExportValue(value, kind);
}

function adsRowsToUiExcelSheet(args: {
	title: string;
	period: string;
	rows: AdsRow[];
	leftColumns: Array<{ key: AdsLeftColumnKey; label: string }>;
	metricKeys: AdsMetricColumnKey[];
	hasPurchaseMetrics: boolean;
	totalRow?: AdsRow | null;
	groupTitle?: string;
}): { aoa: unknown[][]; cols: Array<{ wch: number }>; merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> } {
	const header = [
		...args.leftColumns.map((col) => col.label),
		...args.metricKeys.map((key) => adsMetricHeaderLabel(key, args.hasPurchaseMetrics)),
	];
	const cols = header.map((_, idx) => ({ wch: idx < args.leftColumns.length ? 24 : 16 }));
	const aoa: unknown[][] = [[args.title], [`기간: ${args.period}`], []];
	const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
	const colLast = Math.max(0, header.length - 1);
	merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colLast } });
	merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: colLast } });

	const appendTable = (title: string | null, rows: AdsRow[], totalRow?: AdsRow | null) => {
		if (title) {
			merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: colLast } });
			aoa.push([title]);
		}
		aoa.push(header);
		const toRow = (row: AdsRow): unknown[] => [
			...args.leftColumns.map((col) => {
				if (col.key === 'status') return row.status?.label ?? '';
				return (row as any)[col.key] ?? '';
			}),
			...args.metricKeys.map((key) => {
				const m = adsRowMetricExport(row, key);
				return metricUiCell(m.value, m.diff, m.pct, metricValueKind(key));
			}),
		];
		if (totalRow) aoa.push(toRow(totalRow));
		for (const row of rows) aoa.push(toRow(row));
		aoa.push([]);
	};
	appendTable(args.groupTitle ?? null, args.rows, args.totalRow);
	return { aoa, cols, merges };
}

function adsGroupedRowsToUiExcelSheet(args: {
	title: string;
	period: string;
	groups: Array<{ title: string; rows: AdsRow[]; totalRow?: AdsRow | null }>;
	leftColumns: Array<{ key: AdsLeftColumnKey; label: string }>;
	metricKeys: AdsMetricColumnKey[];
	hasPurchaseMetrics: boolean;
}): { aoa: unknown[][]; cols: Array<{ wch: number }>; merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> } {
	const header = [
		...args.leftColumns.map((col) => col.label),
		...args.metricKeys.map((key) => adsMetricHeaderLabel(key, args.hasPurchaseMetrics)),
	];
	const cols = header.map((_, idx) => ({ wch: idx < args.leftColumns.length ? 24 : 16 }));
	const aoa: unknown[][] = [[args.title], [`기간: ${args.period}`], []];
	const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
	const colLast = Math.max(0, header.length - 1);
	merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colLast } });
	merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: colLast } });
	const toRow = (row: AdsRow): unknown[] => [
		...args.leftColumns.map((col) => {
			if (col.key === 'status') return row.status?.label ?? '';
			return (row as any)[col.key] ?? '';
		}),
		...args.metricKeys.map((key) => {
			const m = adsRowMetricExport(row, key);
			return metricUiCell(m.value, m.diff, m.pct, metricValueKind(key));
		}),
	];
	for (const group of args.groups) {
		merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: colLast } });
		aoa.push([`${group.title} (${group.rows.length}개)`]);
		aoa.push(header);
		if (group.totalRow) aoa.push(toRow(group.totalRow));
		for (const row of group.rows) aoa.push(toRow(row));
		aoa.push([]);
	}
	return { aoa, cols, merges };
}

function adsMetricHeaderLabel(key: AdsMetricColumnKey, hasPurchaseMetrics: boolean): string {
	switch (key) {
		case 'impressions': return '노출수';
		case 'clicks': return '클릭수';
		case 'ctr': return '클릭률(%)';
		case 'cpc': return '평균클릭비용';
		case 'cost': return '총비용';
		case 'conversions': return hasPurchaseMetrics ? '총전환수' : '전환수';
		case 'purchase_conversions': return '구매전환수';
		case 'purchase_cvr': return '구매전환율(%)';
		case 'cvr': return '전환율(%)';
		case 'revenue': return hasPurchaseMetrics ? '총전환매출액' : '전환매출액';
		case 'purchase_revenue': return '구매전환매출액';
		case 'purchase_roas': return '구매전환수익율(%)';
		case 'roas': return '광고수익률(%)';
		default: return key;
	}
}

function adsRowMetricExport(row: AdsRow, key: AdsMetricColumnKey): { value: number; diff: number; pct: number | null } {
	if (key === 'purchase_conversions') {
		const curr = Number(row.purchaseMetrics?.conversions) || 0;
		const prev = Number(row.prevPurchaseMetrics?.conversions) || 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	if (key === 'purchase_revenue') {
		const curr = Number(row.purchaseMetrics?.revenue) || 0;
		const prev = Number(row.prevPurchaseMetrics?.revenue) || 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	if (key === 'purchase_cvr') {
		const currClicks = Number(row.metrics.clicks) || 0;
		const prevClicks = Number(row.prevMetrics.clicks) || 0;
		const currConversions = Number(row.purchaseMetrics?.conversions) || 0;
		const prevConversions = Number(row.prevPurchaseMetrics?.conversions) || 0;
		const curr = currClicks > 0 ? (currConversions / currClicks) * 100 : 0;
		const prev = prevClicks > 0 ? (prevConversions / prevClicks) * 100 : 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	if (key === 'purchase_roas') {
		const currCost = Number(row.metrics.cost) || 0;
		const prevCost = Number(row.prevMetrics.cost) || 0;
		const curr = currCost > 0 ? ((Number(row.purchaseMetrics?.revenue) || 0) / currCost) * 100 : 0;
		const prev = prevCost > 0 ? ((Number(row.prevPurchaseMetrics?.revenue) || 0) / prevCost) * 100 : 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	const metrics = row.metrics as any;
	const deltas = row.deltas as any;
	return {
		value: Number(metrics?.[key]) || 0,
		diff: Number(deltas?.[key]?.diff) || 0,
		pct: deltas?.[key]?.pct == null ? null : Number(deltas[key].pct),
	};
}

function adsRowsToExcelRows(args: {
	rows: AdsRow[];
	leftColumns: Array<{ key: AdsLeftColumnKey; label: string }>;
	metricKeys: AdsMetricColumnKey[];
	hasPurchaseMetrics: boolean;
	rowKind?: string;
	totalRow?: AdsRow | null;
}): Array<Record<string, unknown>> {
	const toOne = (row: AdsRow, rowKind?: string): Record<string, unknown> => {
		const out: Record<string, unknown> = {};
		if (rowKind) out['구분'] = rowKind;
		for (const col of args.leftColumns) {
			if (col.key === 'status') {
				out[col.label] = row.status?.label ?? '';
			} else {
				out[col.label] = (row as any)[col.key] ?? '';
			}
		}
		for (const key of args.metricKeys) {
			const label = adsMetricHeaderLabel(key, args.hasPurchaseMetrics);
			const m = adsRowMetricExport(row, key);
			out[label] = m.value;
			out[`${label} 증감`] = m.diff;
			out[`${label} 증감률(%)`] = m.pct;
		}
		return out;
	};
	const rows = args.rows.map((row) => toOne(row, args.rowKind));
	if (args.totalRow) rows.push(toOne(args.totalRow, args.rowKind ? `${args.rowKind} 합계` : '합계'));
	return rows;
}

function creativeColumnHeaderLabel(key: CreativeColumnKey, mode: 'powerlink' | 'shopping', hasPurchaseMetrics: boolean): string {
	switch (key) {
		case 'creative': return mode === 'powerlink' ? '키워드' : '소재명';
		case 'bid': return '현재입찰가(CPC)';
		case 'quality': return mode === 'powerlink' ? '광고 연관지수' : '품질지수';
		case 'avgRank': return mode === 'powerlink' ? '클릭 기대지수' : '평균노출순위';
		case 'organicRank': return '오가닉순위';
		case 'impressions': return '노출수';
		case 'clicks': return '클릭수';
		case 'ctr': return '클릭율(%)';
		case 'cpc': return '평균클릭비용';
		case 'cost': return '총비용';
		case 'conversions': return hasPurchaseMetrics ? '총전환수' : '전환수';
		case 'purchase_conversions': return '구매전환수';
		case 'purchase_cvr': return '구매전환율(%)';
		case 'cvr': return '전환율(%)';
		case 'revenue': return hasPurchaseMetrics ? '총전환매출액' : '전환매출액';
		case 'purchase_revenue': return '구매전환매출액';
		case 'purchase_roas': return '구매전환수익율(%)';
		case 'roas': return '광고수익율(%)';
		case 'cpa': return '전환당비용';
		default: return key;
	}
}

function creativeMetaExport(row: CreativeAggRow, key: CreativeColumnKey, mode: 'powerlink' | 'shopping'): { value: unknown; diff?: number; pct?: number | null } {
	const pct = (curr: unknown, prev: unknown): number | null => {
		const c = curr == null ? null : Number(curr);
		const p = prev == null ? null : Number(prev);
		if (c == null || p == null || !Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
		return ((c - p) / p) * 100;
	};
	if (key === 'creative') {
		const isPowerlink = mode === 'powerlink';
		const name = String(row.creativeName || '').trim();
		const id = String(row.creativeId || '').trim();
		const displayKeyword = String(row.displayKeyword || '').trim();
		const productTitle = String(row.productTitle || '').trim();
		const isNameOk = Boolean(name) && name !== id;
		return { value: isPowerlink ? (displayKeyword || (isNameOk ? name : id)) : (isNameOk ? name : (productTitle || id)) };
	}
	if (key === 'bid') {
		const c = row.currentBid == null ? null : Number(row.currentBid);
		const p = row.prevCurrentBid == null ? null : Number(row.prevCurrentBid);
		return { value: c, diff: c != null && p != null ? c - p : undefined, pct: pct(c, p) };
	}
	if (key === 'quality') {
		const c = row.qualityIndex == null ? null : Number(row.qualityIndex);
		const p = row.prevQualityIndex == null ? null : Number(row.prevQualityIndex);
		return { value: c, diff: c != null && p != null ? c - p : undefined, pct: pct(c, p) };
	}
	if (key === 'avgRank') {
		const c = row.avgRank == null ? null : Number(row.avgRank);
		const p = row.prevAvgRank == null ? null : Number(row.prevAvgRank);
		return { value: c, diff: c != null && p != null ? c - p : undefined, pct: pct(c, p) };
	}
	if (key === 'organicRank') {
		const c = row.organicRank == null ? null : Number(row.organicRank);
		const p = row.prevOrganicRank == null ? null : Number(row.prevOrganicRank);
		return { value: c, diff: c != null && p != null ? p - c : undefined, pct: null };
	}
	return { value: '' };
}

function creativeMetricExport(row: CreativeAggRow, key: CreativeColumnKey): { value: number; diff: number; pct: number | null } {
	if (key === 'purchase_conversions') {
		const curr = Number(row.purchaseMetrics?.conversions) || 0;
		const prev = Number(row.prevPurchaseMetrics?.conversions) || 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	if (key === 'purchase_revenue') {
		const curr = Number(row.purchaseMetrics?.revenue) || 0;
		const prev = Number(row.prevPurchaseMetrics?.revenue) || 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	if (key === 'purchase_cvr') {
		const currClicks = Number(row.metrics.clicks) || 0;
		const prevClicks = Number(row.prevMetrics.clicks) || 0;
		const currConversions = Number(row.purchaseMetrics?.conversions) || 0;
		const prevConversions = Number(row.prevPurchaseMetrics?.conversions) || 0;
		const curr = currClicks > 0 ? (currConversions / currClicks) * 100 : 0;
		const prev = prevClicks > 0 ? (prevConversions / prevClicks) * 100 : 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	if (key === 'purchase_roas') {
		const currCost = Number(row.metrics.cost) || 0;
		const prevCost = Number(row.prevMetrics.cost) || 0;
		const curr = currCost > 0 ? ((Number(row.purchaseMetrics?.revenue) || 0) / currCost) * 100 : 0;
		const prev = prevCost > 0 ? ((Number(row.prevPurchaseMetrics?.revenue) || 0) / prevCost) * 100 : 0;
		return { value: curr, diff: curr - prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
	}
	if (key === 'cpa') {
		return { value: Number(row.cpa) || 0, diff: Number(row.cpaDiff) || 0, pct: row.cpaPct == null ? null : Number(row.cpaPct) };
	}
	const metrics = row.metrics as any;
	const deltas = row.deltas as any;
	return {
		value: Number(metrics?.[key]) || 0,
		diff: Number(deltas?.[key]?.diff) || 0,
		pct: deltas?.[key]?.pct == null ? null : Number(deltas[key].pct),
	};
}

function creativeRowsToExcelRows(args: {
	groups: Array<{ title: string; rows: CreativeAggRow[] }>;
	columnKeys: CreativeColumnKey[];
}): Array<Record<string, unknown>> {
	const metricKeys = new Set<CreativeColumnKey>([
		'impressions', 'clicks', 'ctr', 'cpc', 'cost', 'conversions', 'purchase_conversions', 'purchase_cvr', 'cvr',
		'revenue', 'purchase_revenue', 'purchase_roas', 'roas', 'cpa',
	]);
	const rows: Array<Record<string, unknown>> = [];
	for (const group of args.groups) {
		const first = group.rows?.[0];
		const adType = String(first?.adType || '').toUpperCase();
		const campName = String(first?.campaignName || '');
		const mode: 'powerlink' | 'shopping' =
			adType.includes('POWERLINK') || campName.startsWith('SA_') || campName.startsWith('#SA') || campName.includes('파워링크')
				? 'powerlink'
				: 'shopping';
		const hasPurchaseMetrics = group.rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics);
		for (const row of group.rows) {
			const out: Record<string, unknown> = {
				그룹: group.title,
				캠페인: row.campaignName,
				광고그룹: row.adgroupName,
				소재ID: row.creativeId,
				광고유형: row.adType ?? '',
			};
			for (const key of args.columnKeys) {
				const label = creativeColumnHeaderLabel(key, mode, hasPurchaseMetrics);
				if (metricKeys.has(key)) {
					const m = creativeMetricExport(row, key);
					out[label] = m.value;
					out[`${label} 증감`] = m.diff;
					out[`${label} 증감률(%)`] = m.pct;
				} else {
					const m = creativeMetaExport(row, key, mode);
					out[label] = m.value;
					if (m.diff !== undefined) out[`${label} 증감`] = m.diff;
					if (m.pct !== undefined) out[`${label} 증감률(%)`] = m.pct;
				}
			}
			rows.push(out);
		}
	}
	return rows;
}

function creativeSubtotal(rowTitle: string, rows: CreativeAggRow[]): CreativeAggRow {
	const sum = {
		impressions: 0,
		clicks: 0,
		cost: 0,
		conversions: 0,
		revenue: 0,
		purchaseConversions: 0,
		purchaseRevenue: 0,
	};
	const prev = { ...sum };
	for (const row of rows) {
		sum.impressions += Number(row.metrics.impressions) || 0;
		sum.clicks += Number(row.metrics.clicks) || 0;
		sum.cost += Number(row.metrics.cost) || 0;
		sum.conversions += Number(row.metrics.conversions) || 0;
		sum.revenue += Number(row.metrics.revenue) || 0;
		sum.purchaseConversions += Number(row.purchaseMetrics?.conversions) || 0;
		sum.purchaseRevenue += Number(row.purchaseMetrics?.revenue) || 0;
		prev.impressions += Number(row.prevMetrics.impressions) || 0;
		prev.clicks += Number(row.prevMetrics.clicks) || 0;
		prev.cost += Number(row.prevMetrics.cost) || 0;
		prev.conversions += Number(row.prevMetrics.conversions) || 0;
		prev.revenue += Number(row.prevMetrics.revenue) || 0;
		prev.purchaseConversions += Number(row.prevPurchaseMetrics?.conversions) || 0;
		prev.purchaseRevenue += Number(row.prevPurchaseMetrics?.revenue) || 0;
	}
	const currM = computeMetrics(sum);
	const prevM = computeMetrics(prev);
	const cpa = currM.conversions > 0 ? Math.round(currM.cost / currM.conversions) : 0;
	const prevCpa = prevM.conversions > 0 ? Math.round(prevM.cost / prevM.conversions) : 0;
	return {
		key: `__subtotal__${rowTitle}`,
		campaignName: '',
		adgroupName: '',
		creativeId: '',
		creativeName: rowTitle,
		displayKeyword: rowTitle,
		metrics: currM,
		prevMetrics: prevM,
		deltas: calcMetricDeltas(currM, prevM),
		purchaseMetrics: { conversions: sum.purchaseConversions, revenue: sum.purchaseRevenue },
		prevPurchaseMetrics: { conversions: prev.purchaseConversions, revenue: prev.purchaseRevenue },
		cpa,
		prevCpa,
		cpaDiff: cpa - prevCpa,
		cpaPct: prevCpa > 0 ? ((cpa - prevCpa) / prevCpa) * 100 : null,
	};
}

function creativeGroupsToUiExcelSheet(args: {
	title: string;
	period: string;
	groups: Array<{ title: string; rows: CreativeAggRow[] }>;
	columnKeys: CreativeColumnKey[];
}): { aoa: unknown[][]; cols: Array<{ wch: number }>; merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> } {
	const aoa: unknown[][] = [[args.title], [`기간: ${args.period}`], []];
	const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
	let maxColCount = 1;
	const metricKeys = new Set<CreativeColumnKey>([
		'impressions', 'clicks', 'ctr', 'cpc', 'cost', 'conversions', 'purchase_conversions', 'purchase_cvr', 'cvr',
		'revenue', 'purchase_revenue', 'purchase_roas', 'roas', 'cpa',
	]);
	const defaultColumnsForMode = (mode: 'powerlink' | 'shopping', hasPurchaseMetrics: boolean): CreativeColumnKey[] => [
		'creative',
		'bid',
		'quality',
		'avgRank',
		...(mode === 'shopping' ? (['organicRank'] as CreativeColumnKey[]) : []),
		'impressions',
		'clicks',
		'ctr',
		'cpc',
		'cost',
		'conversions',
		...(hasPurchaseMetrics ? (['purchase_conversions'] as CreativeColumnKey[]) : []),
		...(hasPurchaseMetrics ? (['purchase_cvr'] as CreativeColumnKey[]) : []),
		'cvr',
		'revenue',
		...(hasPurchaseMetrics ? (['purchase_revenue'] as CreativeColumnKey[]) : []),
		...(hasPurchaseMetrics ? (['purchase_roas'] as CreativeColumnKey[]) : []),
		'roas',
		'cpa',
	];

	for (const group of args.groups) {
		const first = group.rows?.[0];
		const adType = String(first?.adType || '').toUpperCase();
		const campName = String(first?.campaignName || '');
		const creativeId = String(first?.creativeId || '');
		const mode: 'powerlink' | 'shopping' =
			adType.includes('POWERLINK') || creativeId.includes('-01-') || campName.startsWith('SA_') || campName.startsWith('#SA') || campName.includes('파워링크')
				? 'powerlink'
				: 'shopping';
		const hasPurchaseMetrics = group.rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics);
		const allowed = new Set(defaultColumnsForMode(mode, hasPurchaseMetrics));
		const columnKeys = args.columnKeys.filter((key) => allowed.has(key));
		const safeColumnKeys = columnKeys.length > 0 ? columnKeys : defaultColumnsForMode(mode, hasPurchaseMetrics);
		const header = safeColumnKeys.map((key) => creativeColumnHeaderLabel(key, mode, hasPurchaseMetrics));
		maxColCount = Math.max(maxColCount, header.length);
		merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: Math.max(0, header.length - 1) } });
		aoa.push([`${group.title} (소재 ${group.rows.length}개)`]);
		aoa.push(header);
		const toRow = (row: CreativeAggRow): unknown[] =>
			safeColumnKeys.map((key) => {
				if (metricKeys.has(key)) {
					const m = creativeMetricExport(row, key);
					return metricUiCell(m.value, m.diff, m.pct, metricValueKind(key));
				}
				const m = creativeMetaExport(row, key, mode);
				if (key === 'creative') return String(m.value ?? '');
				return metricUiCell(m.value, m.diff, m.pct, metricValueKind(key));
			});
		aoa.push(toRow(creativeSubtotal('소계(그룹합계)', group.rows)));
		for (const row of group.rows) aoa.push(toRow(row));
		aoa.push([]);
	}
	const cols = Array.from({ length: maxColCount }, (_, idx) => ({ wch: idx === 0 ? 34 : 16 }));
	const titleColLast = Math.max(0, maxColCount - 1);
	merges.unshift({ s: { r: 1, c: 0 }, e: { r: 1, c: titleColLast } });
	merges.unshift({ s: { r: 0, c: 0 }, e: { r: 0, c: titleColLast } });
	return { aoa, cols, merges };
}

function parseProgressFromMessage(message: string | null): { done: number; total: number; pct: number } | null {
	const s = String(message || '');
	const m = s.match(/(\d+)\s*\/\s*(\d+)/);
	if (!m) return null;
	const done = Number(m[1]);
	const total = Number(m[2]);
	if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
	const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
	return { done, total, pct };
}

type ValidationStatus = 'ok' | 'fix' | 'unknown';
type ValidationCacheV1 = {
	v: 1;
	range: { from: string; to: string };
	byCampaign: Record<string, Exclude<ValidationStatus, 'unknown'>>;
	byGroup: Record<string, Exclude<ValidationStatus, 'unknown'>>; // key = `${campaign}||${adgroup}`
	ts: number;
};

const VALIDATION_CACHE_KEY = 'ads.validation.v1';
function loadValidationCache(): ValidationCacheV1 | null {
	try {
		const raw = window.localStorage.getItem(VALIDATION_CACHE_KEY);
		if (!raw) return null;
		const j = JSON.parse(raw);
		if (!j || j.v !== 1) return null;
		if (!j.range || typeof j.range.from !== 'string' || typeof j.range.to !== 'string') return null;
		return j as ValidationCacheV1;
	} catch {
		return null;
	}
}

function saveValidationCache(next: ValidationCacheV1): void {
	try {
		window.localStorage.setItem(VALIDATION_CACHE_KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
}

function loadHiddenColumnKeys<K extends string>(storageKey: string): K[] {
	try {
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.hidden)) return [];
		return parsed.hidden.map((x: unknown) => String(x)) as K[];
	} catch {
		return [];
	}
}

function saveHiddenColumnKeys<K extends string>(storageKey: string, hiddenKeys: K[]): void {
	try {
		window.localStorage.setItem(storageKey, JSON.stringify({ v: 1, hidden: hiddenKeys }));
	} catch {
		// ignore
	}
}

function selectedKeysFromHidden<K extends string>(availableKeys: K[], hiddenKeys: K[]): K[] {
	const hiddenSet = new Set(hiddenKeys);
	return availableKeys.filter((key) => !hiddenSet.has(key));
}

function hiddenKeysFromSelected<K extends string>(availableKeys: K[], selectedKeys: K[]): K[] {
	const selectedSet = new Set(selectedKeys);
	return availableKeys.filter((key) => !selectedSet.has(key));
}

function mergeHiddenKeysForAvailable<K extends string>(currentHiddenKeys: K[], availableKeys: K[], selectedKeys: K[]): K[] {
	const availableSet = new Set(availableKeys);
	const preserved = currentHiddenKeys.filter((key) => !availableSet.has(key));
	const nextHidden = hiddenKeysFromSelected(availableKeys, selectedKeys);
	return Array.from(new Set<K>([...preserved, ...nextHidden]));
}

function ProgressCard(props: { message: string }): JSX.Element {
	const p = parseProgressFromMessage(props.message);
	return (
		<div
			className="card"
			style={{
				fontSize: 12,
				color: '#93c5fd',
				// 테이블 헤더가 position: sticky(top:0)로 올라오며 가릴 수 있어,
				// 진행바는 상단에 고정 + 더 높은 레이어로 노출한다.
				position: 'sticky',
				top: 0,
				zIndex: 80,
				// sticky 레이어가 겹칠 때 경계가 흐릿해지는 것을 방지
				backdropFilter: 'blur(2px)',
			}}
		>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
				<div>{props.message}</div>
				{p ? <div style={{ color: '#9ca3af', fontWeight: 900 }}>{p.pct}% ({p.done}/{p.total})</div> : null}
			</div>
			{p ? (
				<div
					role="progressbar"
					aria-label="수집 진행률"
					aria-valuenow={p.done}
					aria-valuemin={0}
					aria-valuemax={p.total}
					style={{
						marginTop: 8,
						height: 10,
						borderRadius: 999,
						background: 'rgba(148,163,184,0.18)',
						overflow: 'hidden',
					}}
				>
					<div
						style={{
							height: '100%',
							width: `${p.pct}%`,
							background: 'linear-gradient(90deg, rgba(34,197,94,0.95), rgba(59,130,246,0.85))',
						}}
					/>
				</div>
			) : null}
		</div>
	);
}

type AdsPerformanceTrendMetricKey =
	| 'impressions'
	| 'clicks'
	| 'ctr'
	| 'cpc'
	| 'cost'
	| 'conversions'
	| 'purchase_conversions'
	| 'cvr'
	| 'revenue'
	| 'purchase_revenue'
	| 'purchase_roas'
	| 'roas';

type AdsPerformanceTrendPoint = {
	date: string;
	label: string;
	impressions: number;
	clicks: number;
	ctr: number;
	cpc: number;
	cost: number;
	conversions: number;
	purchase_conversions: number;
	cvr: number;
	revenue: number;
	purchase_revenue: number;
	purchase_roas: number;
	roas: number;
};

type AdsCampaignJobData = {
	rows: AdsRow[];
	totalRow: AdsRow | null;
	trendPoints?: AdsPerformanceTrendPoint[];
	trendByRowKey?: Record<string, AdsPerformanceTrendPoint[]>;
};

type AdsCreativeJobData = {
	groups: Array<{ key: string; title: string; rows: CreativeAggRow[] }>;
	allCampaigns?: string[];
	allAdgroupsByCampaign?: Record<string, string[]>;
	trendPoints?: AdsPerformanceTrendPoint[];
	trendByRowKey?: Record<string, AdsPerformanceTrendPoint[]>;
};

function getAdsMetricLabel(key: AdsPerformanceTrendMetricKey, hasPurchaseMetrics: boolean): string {
	switch (key) {
		case 'impressions': return '노출수';
		case 'clicks': return '클릭수';
		case 'ctr': return '클릭률(%)';
		case 'cpc': return '평균클릭비용';
		case 'cost': return '총비용';
		case 'conversions': return hasPurchaseMetrics ? '총전환수' : '전환수';
		case 'purchase_conversions': return '구매전환수';
		case 'cvr': return '전환율(%)';
		case 'revenue': return hasPurchaseMetrics ? '총전환매출액' : '전환매출액';
		case 'purchase_revenue': return '구매전환매출액';
		case 'purchase_roas': return '구매전환수익률(%)';
		case 'roas': return '광고수익률(%)';
		default: return '';
	}
}

function getAdsTrendMetricOptions(hasPurchaseMetrics: boolean): Array<{ key: AdsPerformanceTrendMetricKey; label: string }> {
	const base: AdsPerformanceTrendMetricKey[] = ['cost', 'revenue', 'impressions', 'clicks', 'conversions', 'ctr', 'cpc', 'cvr', 'roas'];
	const purchase: AdsPerformanceTrendMetricKey[] = hasPurchaseMetrics ? ['purchase_conversions', 'purchase_revenue', 'purchase_roas'] : [];
	return [...base.slice(0, 2), ...purchase, ...base.slice(2)].map((key) => ({
		key,
		label: getAdsMetricLabel(key, hasPurchaseMetrics),
	}));
}

function pickAlternateTrendMetric(
	targetKey: AdsPerformanceTrendMetricKey,
	options: Array<{ key: AdsPerformanceTrendMetricKey }>,
): AdsPerformanceTrendMetricKey {
	return options.find((option) => option.key !== targetKey)?.key ?? targetKey;
}

function formatAdsTrendMetricValue(key: AdsPerformanceTrendMetricKey, value: number): string {
	switch (key) {
		case 'cost':
		case 'revenue':
		case 'purchase_revenue':
		case 'cpc':
			return formatWon(value);
		case 'ctr':
		case 'cvr':
		case 'roas':
		case 'purchase_roas':
			return formatPct(value);
		default:
			return formatInt(value);
	}
}

function buildAdsPerformanceTrend(rows: Array<CampaignDailyAggRow | AdgroupDailyAggRow | CreativeDailyRow>): AdsPerformanceTrendPoint[] {
	const byDate = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; revenue: number; purchaseConversions: number; purchaseRevenue: number }>();
	rows.forEach((row) => {
		const date = String((row as any)?.date || '').trim();
		if (!date) return;
		const current = byDate.get(date) ?? {
			impressions: 0,
			clicks: 0,
			cost: 0,
			conversions: 0,
			revenue: 0,
			purchaseConversions: 0,
			purchaseRevenue: 0,
		};
		current.impressions += Number((row as any)?.impressions) || 0;
		current.clicks += Number((row as any)?.clicks) || 0;
		current.cost += Number((row as any)?.cost) || 0;
		current.conversions += Number((row as any)?.conversions) || 0;
		current.revenue += Number((row as any)?.revenue) || 0;
		current.purchaseConversions += Number((row as any)?.purchase_conversions) || 0;
		current.purchaseRevenue += Number((row as any)?.purchase_revenue) || 0;
		byDate.set(date, current);
	});
	return [...byDate.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, totals]) => {
			const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
			const cpc = totals.clicks > 0 ? totals.cost / totals.clicks : 0;
			const cvr = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
			const roas = totals.cost > 0 ? (totals.revenue / totals.cost) * 100 : 0;
			const purchaseRoas = totals.cost > 0 ? (totals.purchaseRevenue / totals.cost) * 100 : 0;
			const label = date.length >= 10 ? `${date.slice(5, 7)}.${date.slice(8, 10)}` : date;
			return {
				date,
				label,
				impressions: totals.impressions,
				clicks: totals.clicks,
				ctr,
				cpc,
				cost: totals.cost,
				conversions: totals.conversions,
				purchase_conversions: totals.purchaseConversions,
				cvr,
				revenue: totals.revenue,
				purchase_revenue: totals.purchaseRevenue,
				purchase_roas: purchaseRoas,
				roas,
			};
		});
}

function adsTrendRowKey(kind: 'campaign' | 'adgroup' | 'creative', row: CampaignDailyAggRow | AdgroupDailyAggRow | CreativeDailyRow): string {
	const campaign = String((row as any)?.campaign_name ?? '').trim().replace(/^#+/, '').trim();
	if (kind === 'campaign') return campaign;
	const adgroup = String((row as any)?.adgroup_name ?? '').trim().replace(/^#+/, '').trim();
	if (kind === 'creative') {
		const creativeId = String((row as any)?.creative_id ?? '').trim();
		return `${campaign}||${adgroup}||${creativeId}`;
	}
	return `${campaign}||${adgroup}`;
}

function buildAdsPerformanceTrendByRowKey(
	kind: 'campaign' | 'adgroup' | 'creative',
	rows: Array<CampaignDailyAggRow | AdgroupDailyAggRow | CreativeDailyRow>,
): Record<string, AdsPerformanceTrendPoint[]> {
	const grouped = new Map<string, Array<CampaignDailyAggRow | AdgroupDailyAggRow | CreativeDailyRow>>();
	rows.forEach((row) => {
		const key = adsTrendRowKey(kind, row);
		const list = grouped.get(key) ?? [];
		list.push(row);
		grouped.set(key, list);
	});
	const out: Record<string, AdsPerformanceTrendPoint[]> = {};
	grouped.forEach((list, key) => {
		out[key] = buildAdsPerformanceTrend(list);
	});
	return out;
}

function mergeAdsPerformanceTrendPoints(seriesList: AdsPerformanceTrendPoint[][]): AdsPerformanceTrendPoint[] {
	const byDate = new Map<string, { label: string; impressions: number; clicks: number; cost: number; conversions: number; revenue: number; purchaseConversions: number; purchaseRevenue: number }>();
	seriesList.forEach((series) => {
		series.forEach((point) => {
			const current = byDate.get(point.date) ?? {
				label: point.label,
				impressions: 0,
				clicks: 0,
				cost: 0,
				conversions: 0,
				revenue: 0,
				purchaseConversions: 0,
				purchaseRevenue: 0,
			};
			current.label = point.label || current.label;
			current.impressions += Number(point.impressions) || 0;
			current.clicks += Number(point.clicks) || 0;
			current.cost += Number(point.cost) || 0;
			current.conversions += Number(point.conversions) || 0;
			current.revenue += Number(point.revenue) || 0;
			current.purchaseConversions += Number(point.purchase_conversions) || 0;
			current.purchaseRevenue += Number(point.purchase_revenue) || 0;
			byDate.set(point.date, current);
		});
	});
	return [...byDate.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, totals]) => {
			const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
			const cpc = totals.clicks > 0 ? totals.cost / totals.clicks : 0;
			const cvr = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
			const roas = totals.cost > 0 ? (totals.revenue / totals.cost) * 100 : 0;
			const purchaseRoas = totals.cost > 0 ? (totals.purchaseRevenue / totals.cost) * 100 : 0;
			return {
				date,
				label: totals.label,
				impressions: totals.impressions,
				clicks: totals.clicks,
				ctr,
				cpc,
				cost: totals.cost,
				conversions: totals.conversions,
				purchase_conversions: totals.purchaseConversions,
				cvr,
				revenue: totals.revenue,
				purchase_revenue: totals.purchaseRevenue,
				purchase_roas: purchaseRoas,
				roas,
			};
		});
}

function AdsPerformanceTrendCard(props: {
	title: string;
	trendPoints: AdsPerformanceTrendPoint[];
	hasPurchaseMetrics: boolean;
	leftMetric: AdsPerformanceTrendMetricKey;
	rightMetric: AdsPerformanceTrendMetricKey;
	selectedLabel?: string | null;
	onClearSelection?: () => void;
	onChangeLeftMetric: (next: AdsPerformanceTrendMetricKey) => void;
	onChangeRightMetric: (next: AdsPerformanceTrendMetricKey) => void;
}): JSX.Element | null {
	if (props.trendPoints.length === 0) return null;
	const options = getAdsTrendMetricOptions(props.hasPurchaseMetrics);
	const leftLabel = getAdsMetricLabel(props.leftMetric, props.hasPurchaseMetrics);
	const rightLabel = getAdsMetricLabel(props.rightMetric, props.hasPurchaseMetrics);
	const xTicks = props.trendPoints.map((point) => point.label);
	const TrendTooltip = (p: any) => {
		if (!p?.active || !Array.isArray(p?.payload) || p.payload.length === 0) return null;
		const point = (p.payload[0]?.payload ?? null) as AdsPerformanceTrendPoint | null;
		if (!point) return null;
		return (
			<div className="ss-tooltip">
				<div className="ss-tooltip-title">{point.date}</div>
				<div className="ss-tooltip-body">
					{props.selectedLabel ? (
						<div className="ss-tooltip-row">
							<span className="ss-tooltip-key">선택 항목</span>
							<span className="ss-tooltip-val">{props.selectedLabel}</span>
						</div>
					) : null}
					<div className="ss-tooltip-row">
						<span className="ss-tooltip-key">{leftLabel}</span>
						<span className="ss-tooltip-val">{formatAdsTrendMetricValue(props.leftMetric, Number((point as any)[props.leftMetric]) || 0)}</span>
					</div>
					<div className="ss-tooltip-row">
						<span className="ss-tooltip-key">{rightLabel}</span>
						<span className="ss-tooltip-val">{formatAdsTrendMetricValue(props.rightMetric, Number((point as any)[props.rightMetric]) || 0)}</span>
					</div>
				</div>
			</div>
		);
	};
	return (
		<div className="ss-panel ads-performance-trend-card">
			<div className="ads-performance-trend-header">
				<div>
					<div className="ss-panel-title" style={{ marginBottom: 4 }}>성과지표 추이</div>
					<div className="ss-panel-sub" data-testid="ads-performance-trend-active-metrics">
						{props.title} 상단 추이 그래프입니다. 선택 지표: {leftLabel}, {rightLabel}
						{props.selectedLabel ? ` / 선택 항목: ${props.selectedLabel}` : ' / 선택 항목: 전체'}
					</div>
				</div>
				<div className="ads-performance-trend-controls">
					<label className="ads-performance-trend-select">
						<span>좌측 지표</span>
						<select
							aria-label="ads-performance-trend-left-metric"
							value={props.leftMetric}
							onChange={(e) => props.onChangeLeftMetric(e.target.value as AdsPerformanceTrendMetricKey)}
						>
							{options.map((option) => (
								<option key={option.key} value={option.key}>{option.label}</option>
							))}
						</select>
					</label>
					<label className="ads-performance-trend-select">
						<span>우측 지표</span>
						<select
							aria-label="ads-performance-trend-right-metric"
							value={props.rightMetric}
							onChange={(e) => props.onChangeRightMetric(e.target.value as AdsPerformanceTrendMetricKey)}
						>
							{options.map((option) => (
								<option key={option.key} value={option.key}>{option.label}</option>
							))}
						</select>
					</label>
				</div>
			</div>
			{props.selectedLabel ? (
				<div className="ads-performance-trend-selection">
					<span className="ads-performance-trend-selection-badge">{props.selectedLabel}</span>
					<button type="button" className="btn-ghost" onClick={props.onClearSelection} aria-label="그래프 선택 해제">
						선택 해제
					</button>
				</div>
			) : null}
			<div className="ads-performance-trend-legend">
				<span className="ads-performance-trend-chip is-left">{leftLabel}</span>
				<span className="ads-performance-trend-chip is-right">{rightLabel}</span>
			</div>
			<div className="ads-performance-trend-chart">
				<ResponsiveContainer width="100%" height="100%">
					<LineChart data={props.trendPoints} margin={{ top: 8, right: 18, left: 6, bottom: 22 }}>
						<CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
						<XAxis
							dataKey="label"
							ticks={xTicks}
							interval={0}
							minTickGap={0}
							angle={-35}
							tickMargin={12}
							tick={{ fill: '#94a3b8', fontSize: 10, textAnchor: 'end' }}
							stroke="rgba(148,163,184,0.18)"
						/>
						<YAxis
							yAxisId="left"
							tick={{ fill: '#fca5a5', fontSize: 11 }}
							stroke="rgba(248,113,113,0.28)"
							tickFormatter={(v) => formatInt(Number(v) || 0)}
						/>
						<YAxis
							yAxisId="right"
							orientation="right"
							tick={{ fill: '#fcd34d', fontSize: 11 }}
							stroke="rgba(250,204,21,0.28)"
							tickFormatter={(v) => formatInt(Number(v) || 0)}
						/>
						<Tooltip content={TrendTooltip as any} cursor={{ stroke: 'rgba(148,163,184,0.28)', strokeWidth: 1 }} />
						<Legend
							wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }}
							payload={[
								{ value: leftLabel, type: 'line', color: '#f87171' },
								{ value: rightLabel, type: 'line', color: '#fbbf24' },
							]}
						/>
						<Line yAxisId="left" type="linear" dataKey={props.leftMetric} stroke="#f87171" strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
						<Line yAxisId="right" type="linear" dataKey={props.rightMetric} stroke="#fbbf24" strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
					</LineChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

function totalsFromRow(row: { impressions: number; clicks: number; cost: number; conversions: number; revenue: number }): MetricTotals {
	return {
		impressions: Number(row.impressions) || 0,
		clicks: Number(row.clicks) || 0,
		cost: Number(row.cost) || 0,
		conversions: Number(row.conversions) || 0,
		revenue: Number(row.revenue) || 0,
	};
}

function normKeyPart(x: unknown): string {
	return String(x ?? '').trim().replace(/^#+/, '').trim();
}

function buildRows(params: {
	curr: Map<string, MetricComputed>;
	prev: Map<string, MetricComputed>;
	labelByKey: Map<string, { primary: string; secondary?: string | null; tertiary?: string | null }>;
	sortBy?: (row: AdsRow) => number;
}): { rows: AdsRow[]; totalRow: AdsRow | null } {
	const keys = new Set<string>([...params.curr.keys(), ...params.prev.keys()]);
	const rows: AdsRow[] = [];

	let totalCurr: MetricTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
	let totalPrev: MetricTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };

	for (const k of keys) {
		const label = params.labelByKey.get(k) ?? { primary: k };
		const curr = params.curr.get(k) ?? computeMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
		const prev = params.prev.get(k) ?? computeMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
		const deltas = calcMetricDeltas(curr, prev);

		totalCurr = {
			impressions: totalCurr.impressions + curr.impressions,
			clicks: totalCurr.clicks + curr.clicks,
			cost: totalCurr.cost + curr.cost,
			conversions: totalCurr.conversions + curr.conversions,
			revenue: totalCurr.revenue + curr.revenue,
		};
		totalPrev = {
			impressions: totalPrev.impressions + prev.impressions,
			clicks: totalPrev.clicks + prev.clicks,
			cost: totalPrev.cost + prev.cost,
			conversions: totalPrev.conversions + prev.conversions,
			revenue: totalPrev.revenue + prev.revenue,
		};

		rows.push({
			key: k,
			primary: label.primary,
			secondary: label.secondary,
			tertiary: label.tertiary,
			metrics: curr,
			prevMetrics: prev,
			deltas,
		});
	}

	const sortBy = params.sortBy ?? ((r: AdsRow) => r.metrics.cost);
	rows.sort((a, b) => sortBy(b) - sortBy(a));

	const totalCurrComputed = computeMetrics(totalCurr);
	const totalPrevComputed = computeMetrics(totalPrev);
	const totalRow: AdsRow = {
		key: '__total__',
		primary: '전체 합계',
		secondary: null,
		tertiary: null,
		metrics: totalCurrComputed,
		prevMetrics: totalPrevComputed,
		deltas: calcMetricDeltas(totalCurrComputed, totalPrevComputed),
	};

	return { rows, totalRow };
}

function useAdsDateState(): [AdsDateState, (next: AdsDateState) => void] {
	const [state, setState] = useState<AdsDateState>(() => loadAdsDateState());
	return [
		state,
		(next) => {
			const normalized = { ...next, range: normalizeRange(next.range) };
			setState(normalized);
			// 메뉴 이동 후 복귀해도 동일 조건으로 jobKey가 유지되도록 저장
			saveAdsDateState(normalized);
		},
	];
}

export function KeywordsPerformanceView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsPerformanceView apiBaseUrl={props.apiBaseUrl} kind="keyword" />;
}

export function SearchwordPerformanceView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsPerformanceView apiBaseUrl={props.apiBaseUrl} kind="searchword" />;
}

export function AdsKeywordsPerformanceView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsKeywordsUnifiedPerformanceView apiBaseUrl={props.apiBaseUrl} />;
}

type SearchwordSourceMode = 'combined' | 'searchad_api' | 'ui_csv_upload' | 'all';

function searchwordDailyToAggTermRow(row: SearchwordDailyRow): AggTermRow {
	return {
		campaign_name: String(row.campaign_name ?? ''),
		adgroup_name: String(row.adgroup_name ?? ''),
		// 광고 검색어 분석은 "실제 검색어(searchword)"만을 기준으로 표시한다.
		term: String((row as any).searchword ?? ''),
		impressions: Number(row.impressions) || 0,
		clicks: Number(row.clicks) || 0,
		cost: Number(row.cost) || 0,
		conversions: Number(row.conversions) || 0,
		revenue: Number(row.revenue) || 0,
		purchase_conversions: Number((row as any).purchase_conversions) || 0,
		purchase_revenue: Number((row as any).purchase_revenue) || 0,
	};
}

function AdsKeywordsUnifiedPerformanceView(props: { apiBaseUrl: string }): JSX.Element {
	const [dateState, setDateState] = useAdsDateState();
	const [fetchState, setFetchState] = useState<FetchState>({ loading: false, error: null });
	const [ensureState, setEnsureState] = useState<EnsureState>({ ensuring: false, message: null });
	const [rows, setRows] = useState<AdsRow[]>([]);
	const [totalRow, setTotalRow] = useState<AdsRow | null>(null);
	const unifiedHiddenColumnsKey = 'ads.keywords.unified.hiddenColumns.v1';
	const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
	const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Array<AdsLeftColumnKey | AdsMetricColumnKey>>(
		() => loadHiddenColumnKeys<AdsLeftColumnKey | AdsMetricColumnKey>(unifiedHiddenColumnsKey),
	);
	const [totalsByKind, setTotalsByKind] = useState<Record<'powerlink' | 'non_powerlink', MetricTotals>>({
		powerlink: { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
		non_powerlink: { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
	});
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const [uploadingSearchwordCsv, setUploadingSearchwordCsv] = useState(false);
	const [uploadSearchwordCsvMsg, setUploadSearchwordCsvMsg] = useState<string | null>(null);
	const [campaignDashRows, setCampaignDashRows] = useState<
		Array<{
			campaign: string;
			revenue: number;
			purchase_revenue: number;
			purchase_revenue_prev: number;
			cost: number;
			conversions: number;
			purchase_conversions: number;
			conversions_prev: number;
			purchase_conversions_prev: number;
			costDiff: number;
			costPct: number | null;
			revenueDiff: number;
			revenuePct: number | null;
			purchaseRevenueDiff: number;
			purchaseRevenuePct: number | null;
			convDiff: number;
			convPct: number | null;
			purchaseConvDiff: number;
			purchaseConvPct: number | null;
		}>
	>([]);
	const [topCampaignKeywordCards, setTopCampaignKeywordCards] = useState<
		Array<{ campaign: string; totalRevenue: number; totalPurchaseRevenue: number; items: Array<{ keyword: string; revenue: number; purchaseRevenue: number }> }>
	>([]);
	const [reloadTick, setReloadTick] = useState(0);
	const [mergeMode, setMergeMode] = useState(false); // true면 캠페인/그룹을 합쳐 검색어 단위로 집계
	const [rowLimit, setRowLimit] = useState<number>(2000); // 렌더링 부하 방지용 기본 제한(전체는 선택 가능)
	const [computing, setComputing] = useState(false);
	const SEARCHWORD_SOURCE_LS_KEY = 'ads.keywords.searchwordSource.v3';
	const [searchwordSource, setSearchwordSource] = useState<SearchwordSourceMode>(() => {
		try {
			const raw = String(window.localStorage.getItem(SEARCHWORD_SOURCE_LS_KEY) ?? '').trim();
			return raw === 'combined' || raw === 'ui_csv_upload' || raw === 'all' || raw === 'searchad_api' ? raw : 'combined';
		} catch {
			return 'combined';
		}
	});

	const KIND_LABEL: Record<CampaignKindKey, string> = {
		powerlink: '파워링크',
		non_powerlink: '쇼핑검색',
	};
	const KIND_LS_KEY = 'ads.performance.campaignKinds.v1';
	const [selectedKinds, setSelectedKinds] = useState<Set<CampaignKindKey>>(() => {
		try {
			const raw = String(window.localStorage.getItem(KIND_LS_KEY) ?? '').trim();
			if (!raw) return new Set<CampaignKindKey>(['powerlink', 'non_powerlink']);
			const j = JSON.parse(raw) as any;
			const arr = Array.isArray(j?.kinds) ? j.kinds : [];
			const out = new Set<CampaignKindKey>();
			for (const x of arr) {
				if (x === 'powerlink' || x === 'non_powerlink') out.add(x);
			}
			return out.size > 0 ? out : new Set<CampaignKindKey>(['powerlink', 'non_powerlink']);
		} catch {
			return new Set<CampaignKindKey>(['powerlink', 'non_powerlink']);
		}
	});
	const [openKinds, setOpenKinds] = useState(false);
	const [downloadingSearchwordExcel, setDownloadingSearchwordExcel] = useState(false);
	const rawRef = useRef<null | {
		currByKind: Record<CampaignKindKey, AggTermRow[]>;
		prevByKind: Record<CampaignKindKey, AggTermRow[]>;
	}>(null);
	const workerRef = useRef<Worker | null>(null);
	const reqIdRef = useRef(0);

	useEffect(() => {
		saveHiddenColumnKeys(unifiedHiddenColumnsKey, hiddenColumnKeys);
	}, [hiddenColumnKeys]);

	useEffect(() => {
		try {
			window.localStorage.setItem(KIND_LS_KEY, JSON.stringify({ v: 1, kinds: Array.from(selectedKinds.values()) }));
		} catch {
			// ignore
		}
	}, [selectedKinds]);

	useEffect(() => {
		try {
			window.localStorage.setItem(SEARCHWORD_SOURCE_LS_KEY, searchwordSource);
		} catch {
			// ignore
		}
	}, [searchwordSource]);

	useEffect(() => {
		// Web Worker가 가능한 환경에서만 사용한다(테스트/구형 환경은 동기 계산으로 폴백).
		if (typeof Worker === 'undefined') return;
		try {
			workerRef.current = new Worker(new URL('./adsAgg.worker.ts', import.meta.url), { type: 'module' });
		} catch {
			workerRef.current = null;
			return;
		}
		const w = workerRef.current;
		if (!w) return;

		w.onmessage = (ev: MessageEvent<any>) => {
			const data = ev?.data;
			if (!data || data.kind !== 'ads_keywords_unified') return;
			if (Number(data.reqId) !== Number(reqIdRef.current)) return;

			if (!data.ok) {
				setComputing(false);
				setFetchState((s) => ({ ...s, error: String(data.error || '집계 처리 중 오류가 발생했습니다.') }));
				return;
			}

			const res = data.result;
			setRows((res?.rows ?? []) as any);
			setTotalRow((res?.totalRow ?? null) as any);
			setTotalsByKind(
				(res?.totalsByKind as any) ?? {
					powerlink: { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
					non_powerlink: { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
				},
			);
			setCampaignDashRows((res?.campaignDashRows ?? []) as any);
			setTopCampaignKeywordCards((res?.topCampaignKeywordCards ?? []) as any);
			setComputing(false);
		};

		w.onerror = () => {
			// worker 내부 예외가 발생하면 이후부터 동기 폴백 경로를 사용한다.
			try {
				w.terminate();
			} catch {
				// ignore
			}
			workerRef.current = null;
		};

		return () => {
			try {
				w.terminate();
			} catch {
				// ignore
			}
			workerRef.current = null;
		};
	}, []);

	const runCompute = async (nextMergeMode: boolean) => {
		const raw = rawRef.current;
		if (!raw) return;
		const reqId = (reqIdRef.current = reqIdRef.current + 1);
		setComputing(true);
		setFetchState((s) => ({ ...s, error: null }));

		const w = workerRef.current;
		if (w) {
			w.postMessage({ kind: 'ads_keywords_unified', reqId, payload: { ...raw, mergeMode: Boolean(nextMergeMode) } });
			return;
		}

		// 폴백: 테스트/worker 불가 환경
		try {
			const res = computeAdsKeywordsUnifiedAgg({ ...raw, mergeMode: Boolean(nextMergeMode) });
			if (reqId !== reqIdRef.current) return;
			setRows((res?.rows ?? []) as any);
			setTotalRow((res?.totalRow ?? null) as any);
			setTotalsByKind(res?.totalsByKind ?? totalsByKind);
			setCampaignDashRows((res?.campaignDashRows ?? []) as any);
			setTopCampaignKeywordCards((res?.topCampaignKeywordCards ?? []) as any);
		} catch (e: any) {
			if (reqId === reqIdRef.current) {
				setFetchState((s) => ({ ...s, error: String(e?.message ?? e ?? '집계 처리 중 오류가 발생했습니다.') }));
			}
		} finally {
			if (reqId === reqIdRef.current) setComputing(false);
		}
	};

	useEffect(() => {
		let cancelled = false;
		const run = async () => {
			setFetchState({ loading: true, error: null });
			setEnsureState({ ensuring: false, message: null });
			try {
				const r = normalizeRange(dateState.range);
				const prevRange = shiftRange(r, dateState.compareMode);
				const dateFrom = toYmd(r.from);
				const dateTo = toYmd(r.to);
				const prevFrom = toYmd(prevRange.from);
				const prevTo = toYmd(prevRange.to);

				const kinds = Array.from(selectedKinds.values());
				if (kinds.length === 0) {
					setRows([]);
					setTotalRow(null);
					return;
				}

				// 메뉴 진입 시에는 자동 수집을 새로 실행하지 않고, 사용자가 선택한 저장 출처만 조회한다.
				// source가 PK에 포함되어 API 수집과 엑셀 업로드가 서로 덮어쓰지 않는다.
				if (!cancelled) {
					setEnsureState({
						ensuring: false,
						message: searchwordSource === 'combined'
							? 'API 수집 + 엑셀 업로드 병합 데이터를 조회 중입니다. 같은 검색어 행은 전환매출이 포함된 엑셀 업로드값을 우선하고, API에만 있는 행은 보완으로 사용합니다.'
							: searchwordSource === 'searchad_api'
								? 'API 수집 데이터 조회 중입니다. 검색어 API는 총전환매출/구매전환매출을 제공하지 않아 해당 값은 0일 수 있습니다.'
								: searchwordSource === 'ui_csv_upload'
									? '엑셀 업로드 데이터 조회 중입니다. 검색어별 총전환매출/구매전환매출은 이 출처의 정확값을 사용합니다.'
									: 'API 수집 + 엑셀 업로드 원본 전체 데이터를 조회 중입니다. 같은 행이 양쪽에 있으면 중복 집계될 수 있습니다.',
					});
				}

				// 2) 조회는 병렬로 수행 (read-only)
				const fetchForKind = async (k: CampaignKindKey, from: string, to: string): Promise<AggTermRow[]> => {
					// 광고 검색어 분석은 searchword daily만 사용한다.
					// searchword가 없으면(0건) "키워드로 추정"하지 않고, 업로드/수집 부족으로 남긴다.
					const sw = await fetchSearchwordDaily({ baseUrl: props.apiBaseUrl, dateFrom: from, dateTo: to, campaignKind: k, source: searchwordSource });
					return (sw || []).map(searchwordDailyToAggTermRow);
				};
				const [currLists, prevLists] = await Promise.all([
					Promise.all(kinds.map((k) => fetchForKind(k, dateFrom, dateTo))),
					Promise.all(kinds.map((k) => fetchForKind(k, prevFrom, prevTo))),
				]);
				if (cancelled) return;

				const nextCurrByKind: Record<CampaignKindKey, AggTermRow[]> = { powerlink: [], non_powerlink: [] };
				const nextPrevByKind: Record<CampaignKindKey, AggTermRow[]> = { powerlink: [], non_powerlink: [] };
				kinds.forEach((k, idx) => {
					nextCurrByKind[k] = currLists[idx] || [];
					nextPrevByKind[k] = prevLists[idx] || [];
				});
				rawRef.current = { currByKind: nextCurrByKind, prevByKind: nextPrevByKind };

				// (핵심) 대용량 집계/정렬은 Worker(가능 시)로 분리해 UI 프리징을 방지한다.
				await runCompute(mergeMode);
			} catch (e: any) {
				if (!cancelled) {
					const msg = e?.response?.data?.detail ?? e?.message ?? '데이터를 불러오지 못했습니다.';
					setFetchState({ loading: false, error: String(msg) });
				}
				return;
			} finally {
				if (!cancelled) setFetchState((s) => ({ ...s, loading: false }));
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [props.apiBaseUrl, dateState.range, dateState.compareMode, reloadTick, selectedKinds, searchwordSource]);

	// merge 토글은 "재조회"가 아니라, 이미 받은 원본으로 재집계만 수행한다(네트워크/DB 부하 + UI 프리징 방지).
	useEffect(() => {
		if (!rawRef.current) return;
		void runCompute(mergeMode);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mergeMode]);

	const kindsLabel = Array.from(selectedKinds.values()).map((k) => KIND_LABEL[k]).join(' + ') || '선택 없음';
	const sourceLabel = searchwordSource === 'combined'
		? '병합(API 보완 + 엑셀 우선)'
		: searchwordSource === 'searchad_api'
			? 'API 수집(전환매출 미제공)'
			: searchwordSource === 'ui_csv_upload'
				? '엑셀 업로드(전환매출 포함)'
				: '원본 전체(중복 가능)';
	const primaryLabel = '검색어';
	const title = `광고 검색어 분석 · ${kindsLabel}`;
	const hasPurchaseMetrics = useMemo(
		() => Boolean(totalRow?.purchaseMetrics || rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics)),
		[rows, totalRow],
	);
	const activeLeftColumns = useMemo<Array<{ key: AdsLeftColumnKey; label: string }>>(
		() => (mergeMode ? [{ key: 'primary', label: primaryLabel }] : [
			{ key: 'primary', label: primaryLabel },
			{ key: 'secondary', label: '캠페인' },
			{ key: 'tertiary', label: '광고그룹' },
		]),
		[mergeMode],
	);
	const metricColumnOptions = useMemo<AdsColumnSettingOption[]>(() => {
		const options: Array<{ key: AdsMetricColumnKey; label: string }> = [
			{ key: 'impressions', label: '노출수' },
			{ key: 'clicks', label: '클릭수' },
			{ key: 'ctr', label: '클릭률(%)' },
			{ key: 'cpc', label: '평균클릭비용' },
			{ key: 'cost', label: '총비용' },
			{ key: 'conversions', label: hasPurchaseMetrics ? '총전환수' : '전환수' },
			...(hasPurchaseMetrics ? [{ key: 'purchase_conversions' as const, label: '구매전환수' }] : []),
			...(hasPurchaseMetrics ? [{ key: 'purchase_cvr' as const, label: '구매전환율(%)' }] : []),
			{ key: 'cvr', label: '전환율(%)' },
			{ key: 'revenue', label: hasPurchaseMetrics ? '총전환매출액' : '전환매출액' },
			...(hasPurchaseMetrics ? [{ key: 'purchase_revenue' as const, label: '구매전환매출액' }] : []),
			...(hasPurchaseMetrics ? [{ key: 'purchase_roas' as const, label: '구매전환수익율(%)' }] : []),
			{ key: 'roas', label: '광고수익률(%)' },
		];
		return options.map((option) => ({ ...option, group: '성과 지표' }));
	}, [hasPurchaseMetrics]);
	const columnOptions = useMemo<AdsColumnSettingOption[]>(
		() => [
			...activeLeftColumns.map((column) => ({ key: column.key, label: column.label, group: '기본 정보' })),
			...metricColumnOptions,
		],
		[activeLeftColumns, metricColumnOptions],
	);
	const visibleColumnKeys = useMemo(
		() => selectedKeysFromHidden(
			columnOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey),
			hiddenColumnKeys,
		),
		[columnOptions, hiddenColumnKeys],
	);
	const visibleLeftColumns = useMemo(
		() => activeLeftColumns.filter((column) => visibleColumnKeys.includes(column.key)),
		[activeLeftColumns, visibleColumnKeys],
	);
	const visibleMetricKeys = useMemo(
		() => metricColumnOptions
			.map((option) => option.key as AdsMetricColumnKey)
			.filter((key) => visibleColumnKeys.includes(key)),
		[metricColumnOptions, visibleColumnKeys],
	);

	const top10CampaignDash = useMemo(() => campaignDashRows.slice(0, 10), [campaignDashRows]);
	const visibleRows = useMemo(() => {
		const n = Number(rowLimit) || 0;
		if (n <= 0) return rows;
		return rows.slice(0, n);
	}, [rows, rowLimit]);
	const truncated = (Number(rowLimit) || 0) > 0 && rows.length > (Number(rowLimit) || 0);

	const handleDownloadSearchwordExcel = async (): Promise<void> => {
		const kinds = Array.from(selectedKinds.values());
		if (kinds.length === 0) {
			try { window.alert('다운로드할 표 데이터가 없습니다.'); } catch {}
			return;
		}
		const r = normalizeRange(dateState.range);
		const prevRange = shiftRange(r, dateState.compareMode);
		const dateFrom = toYmd(r.from);
		const dateTo = toYmd(r.to);
		const prevFrom = toYmd(prevRange.from);
		const prevTo = toYmd(prevRange.to);

		setDownloadingSearchwordExcel(true);
		try {
			const fetchAllForKind = async (k: CampaignKindKey, from: string, to: string): Promise<AggTermRow[]> => {
				const sw = await fetchSearchwordDailyAll({
					baseUrl: props.apiBaseUrl,
					dateFrom: from,
					dateTo: to,
					campaignKind: k,
					source: searchwordSource,
				});
				return (sw || []).map(searchwordDailyToAggTermRow);
			};
			const [currLists, prevLists] = await Promise.all([
				Promise.all(kinds.map((k) => fetchAllForKind(k, dateFrom, dateTo))),
				Promise.all(kinds.map((k) => fetchAllForKind(k, prevFrom, prevTo))),
			]);
			const exportCurrByKind: Record<CampaignKindKey, AggTermRow[]> = { powerlink: [], non_powerlink: [] };
			const exportPrevByKind: Record<CampaignKindKey, AggTermRow[]> = { powerlink: [], non_powerlink: [] };
			kinds.forEach((k, idx) => {
				exportCurrByKind[k] = currLists[idx] || [];
				exportPrevByKind[k] = prevLists[idx] || [];
			});
			const exportAgg = computeAdsKeywordsUnifiedAgg({
				currByKind: exportCurrByKind,
				prevByKind: exportPrevByKind,
				mergeMode,
			});
			const exportRows = (exportAgg.rows ?? []) as AdsRow[];
			const exportTotalRow = (exportAgg.totalRow ?? null) as AdsRow | null;
			const exportHasPurchaseMetrics = Boolean(exportTotalRow?.purchaseMetrics || exportRows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics));
			const currRawCount = currLists.reduce((sum, list) => sum + (list?.length ?? 0), 0);
			const prevRawCount = prevLists.reduce((sum, list) => sum + (list?.length ?? 0), 0);
			if (exportRows.length === 0) {
				try { window.alert('다운로드할 표 데이터가 없습니다.'); } catch {}
				return;
			}
			const uiSheet = adsRowsToUiExcelSheet({
				title,
				period: `${dateFrom} ~ ${dateTo}`,
				rows: exportRows,
				totalRow: exportTotalRow,
				leftColumns: visibleLeftColumns,
				metricKeys: visibleMetricKeys,
				hasPurchaseMetrics: exportHasPurchaseMetrics,
				groupTitle: `${sourceLabel} · ${mergeMode ? '검색어 통합' : '검색어/캠페인/광고그룹'}`,
			});
			const metaRows: Array<Record<string, unknown>> = [
				{ 항목: '화면', 값: title },
				{ 항목: '기간', 값: `${dateFrom} ~ ${dateTo}` },
				{ 항목: '데이터 출처', 값: sourceLabel },
				{ 항목: '캠페인 유형', 값: kindsLabel },
				{ 항목: '표시 방식', 값: mergeMode ? '검색어 통합' : '검색어/캠페인/광고그룹' },
				{ 항목: '다운로드 기준', 값: '현재 검색 조건 전체 DB 재조회' },
				{ 항목: '화면 표시 제한', 값: rowLimit > 0 ? `상위 ${Number(rowLimit).toLocaleString()}행` : '전체' },
				{ 항목: '화면 집계 행수', 값: rows.length },
				{ 항목: '현재기간 원본 DB 행수', 값: currRawCount },
				{ 항목: '비교기간 원본 DB 행수', 값: prevRawCount },
				{ 항목: '다운로드 집계 행수', 값: exportRows.length },
				{ 항목: '생성 시각', 값: new Date().toLocaleString() },
			];
			await downloadExcelWorkbook({
				fileName: `광고_검색어_분석_${dateFrom}_${dateTo}.xlsx`,
				sheets: [
					{ name: '표', aoa: uiSheet.aoa, cols: uiSheet.cols, merges: uiSheet.merges },
					{ name: '조건', rows: metaRows },
				],
			});
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? 'Excel 다운로드 데이터를 불러오지 못했습니다.';
			try { window.alert(String(msg)); } catch {}
		} finally {
			setDownloadingSearchwordExcel(false);
		}
	};

	const CampaignRevenueCostTooltip = (p: any) => {
		if (!p?.active || !p?.payload?.length) return null;
		const label = String(p.label ?? '');
		const row = top10CampaignDash.find((x) => x.campaign === label);
		const rev = Number(row?.revenue ?? 0);
		const purchaseRev = Number(row?.purchase_revenue ?? 0);
		const cost = Number(row?.cost ?? 0);
		return (
			<div className="ss-tooltip">
				<div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>{label}</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, fontSize: 11 }}>
					<div style={{ color: '#cbd5e1' }}>총전환매출액</div>
					<div style={{ fontWeight: 900 }}>{formatWon(rev)}</div>
					<div style={{ color: '#94a3b8' }}>앞 기간 대비</div>
					<div style={{ fontWeight: 900, color: (row?.revenueDiff ?? 0) >= 0 ? '#93c5fd' : '#fca5a5' }}>
						{(row?.revenueDiff ?? 0) >= 0 ? '▲' : '▼'} {formatWon(Math.abs(row?.revenueDiff ?? 0))}
						{row?.revenuePct == null ? '' : ` (${Math.abs(row.revenuePct).toFixed(1)}%)`}
					</div>
					<div style={{ color: '#cbd5e1' }}>구매전환매출액</div>
					<div style={{ fontWeight: 900 }}>{formatWon(purchaseRev)}</div>
					<div style={{ color: '#94a3b8' }}>앞 기간 대비</div>
					<div style={{ fontWeight: 900, color: (row?.purchaseRevenueDiff ?? 0) >= 0 ? '#93c5fd' : '#fca5a5' }}>
						{(row?.purchaseRevenueDiff ?? 0) >= 0 ? '▲' : '▼'} {formatWon(Math.abs(row?.purchaseRevenueDiff ?? 0))}
						{row?.purchaseRevenuePct == null ? '' : ` (${Math.abs(row.purchaseRevenuePct).toFixed(1)}%)`}
					</div>
					<div style={{ color: '#cbd5e1' }}>총비용</div>
					<div style={{ fontWeight: 900 }}>{formatWon(cost)}</div>
					<div style={{ color: '#94a3b8' }}>앞 기간 대비</div>
					<div style={{ fontWeight: 900, color: (row?.costDiff ?? 0) >= 0 ? '#93c5fd' : '#fca5a5' }}>
						{(row?.costDiff ?? 0) >= 0 ? '▲' : '▼'} {formatWon(Math.abs(row?.costDiff ?? 0))}
						{row?.costPct == null ? '' : ` (${Math.abs(row.costPct).toFixed(1)}%)`}
					</div>
				</div>
			</div>
		);
	};

	const CampaignConversionsTooltip = (p: any) => {
		if (!p?.active || !p?.payload?.length) return null;
		const label = String(p.label ?? '');
		const row = top10CampaignDash.find((x) => x.campaign === label);
		const curr = Number(row?.conversions ?? 0);
		const purchaseCurr = Number(row?.purchase_conversions ?? 0);
		const prev = Number(row?.conversions_prev ?? 0);
		const purchasePrev = Number(row?.purchase_conversions_prev ?? 0);
		const diff = Number(row?.convDiff ?? (curr - prev));
		const pct = row?.convPct ?? (prev > 0 ? (diff / prev) * 100 : null);
		const purchaseDiff = Number(row?.purchaseConvDiff ?? (purchaseCurr - purchasePrev));
		const purchasePct = row?.purchaseConvPct ?? (purchasePrev > 0 ? (purchaseDiff / purchasePrev) * 100 : null);
		return (
			<div className="ss-tooltip">
				<div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>{label}</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, fontSize: 11 }}>
					<div style={{ color: '#cbd5e1' }}>총전환수(현재)</div>
					<div style={{ fontWeight: 900 }}>{formatInt(curr)}</div>
					<div style={{ color: '#cbd5e1' }}>총전환수(앞 기간)</div>
					<div style={{ fontWeight: 900 }}>{formatInt(prev)}</div>
					<div style={{ color: '#94a3b8' }}>총전환 증감</div>
					<div style={{ fontWeight: 900, color: diff >= 0 ? '#93c5fd' : '#fca5a5' }}>
						{diff >= 0 ? '▲' : '▼'} {formatInt(Math.abs(diff))}
						{pct == null ? '' : ` (${Math.abs(pct).toFixed(1)}%)`}
					</div>
					<div style={{ color: '#cbd5e1' }}>구매전환수(현재)</div>
					<div style={{ fontWeight: 900 }}>{formatInt(purchaseCurr)}</div>
					<div style={{ color: '#cbd5e1' }}>구매전환수(앞 기간)</div>
					<div style={{ fontWeight: 900 }}>{formatInt(purchasePrev)}</div>
					<div style={{ color: '#94a3b8' }}>구매전환 증감</div>
					<div style={{ fontWeight: 900, color: purchaseDiff >= 0 ? '#93c5fd' : '#fca5a5' }}>
						{purchaseDiff >= 0 ? '▲' : '▼'} {formatInt(Math.abs(purchaseDiff))}
						{purchasePct == null ? '' : ` (${Math.abs(purchasePct).toFixed(1)}%)`}
					</div>
				</div>
			</div>
		);
	};

	return (
		<div className="space-y-3">
			<AdsDateControls value={dateState} onChange={setDateState} />
			<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
				<div style={{ minWidth: 0 }}>
					<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>{title}</div>
				</div>
				<div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
					{selectedKinds.has('non_powerlink') ? (
						<>
							<input
								ref={uploadInputRef}
								type="file"
								accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
								style={{ display: 'none' }}
								onChange={async (e) => {
									const file = e.target.files?.[0];
									// 같은 파일 재선택도 가능하도록 즉시 초기화
									try {
										e.currentTarget.value = '';
									} catch {
										// ignore
									}
									if (!file) return;

									// 쇼핑검색 searchword는 계정에 따라 SearchAd API로 수집이 불가능할 수 있어,
									// 광고센터 UI에서 다운로드한 "검색어 보고서" CSV 업로드로 보정한다.
									// (기간이 1일이 아닐 때는 업로드 endpoint가 date 단일 입력을 요구하므로 현재는 제한한다.)
									const r = normalizeRange(dateState.range);
									const df = toYmd(r.from);
									const dt = toYmd(r.to);
									if (df !== dt) {
										setUploadSearchwordCsvMsg('검색어 보고서 업로드는 현재 1일(단일 날짜) 범위만 지원합니다. 날짜를 1일로 맞춘 뒤 업로드하세요.');
										return;
									}

									setUploadingSearchwordCsv(true);
									setUploadSearchwordCsvMsg(null);
									try {
										const fd = new FormData();
										fd.append('file', file);
										const resp = await axios.post(`${props.apiBaseUrl}/ads/searchwords/upload`, fd, {
											params: { date: df },
											timeout: 120000,
										});
										const inserted = Number((resp as any)?.data?.insertedSearchword) || 0;
										const processedDates = Array.isArray((resp as any)?.data?.processed_dates)
											? ((resp as any).data.processed_dates as string[]).filter((x) => String(x || '').trim().length > 0)
											: [];
										const sameScreenDate = processedDates.length === 0 || processedDates.includes(df);
										if (processedDates.length > 0 && !sameScreenDate) {
											setUploadSearchwordCsvMsg(
												`검색어 보고서 업로드 완료: ${inserted.toLocaleString()}건 반영 (파일 날짜: ${processedDates.join(', ')} / 현재 화면 날짜 ${df}와 다름)`,
											);
										} else {
											setUploadSearchwordCsvMsg(`검색어 보고서 업로드 완료: ${inserted.toLocaleString()}건 반영`);
										}
										// 현재 화면 날짜와 같은 데이터가 반영된 경우만 즉시 재조회한다.
										if (sameScreenDate) {
											setSearchwordSource('combined');
											setReloadTick((t) => t + 1);
										}
									} catch (err: any) {
										const msg = err?.response?.data?.detail ?? err?.message ?? '검색어 보고서 업로드 실패';
										setUploadSearchwordCsvMsg(String(msg));
									} finally {
										setUploadingSearchwordCsv(false);
									}
								}}
							/>
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
								disabled={uploadingSearchwordCsv}
								onClick={() => uploadInputRef.current?.click()}
								title="광고센터에서 다운로드한 '검색어 보고서' CSV를 업로드합니다. (쇼핑검색 보정용)"
							>
								{uploadingSearchwordCsv ? '업로드 중…' : '검색어 보고서 업로드'}
							</button>
						</>
					) : null}
					<select
						aria-label="검색어 데이터 출처"
						value={searchwordSource}
						disabled={fetchState.loading || computing}
						onChange={(e) => setSearchwordSource((e.target as HTMLSelectElement).value as SearchwordSourceMode)}
						title="광고 검색어 분석에 사용할 저장 데이터 출처를 선택합니다."
						style={{
							fontSize: 11,
							padding: '4px 8px',
							borderRadius: 8,
							border: '1px solid rgba(148,163,184,0.18)',
							background: 'rgba(2,6,23,0.35)',
							color: '#e5e7eb',
						}}
					>
						<option value="combined">출처: 병합(API 보완 + 엑셀 우선)</option>
						<option value="ui_csv_upload">출처: 엑셀 업로드만(전환매출 포함)</option>
						<option value="searchad_api">출처: API 수집(전환매출 미제공)</option>
						<option value="all">출처: 원본 전체(중복 확인용)</option>
					</select>
					<div style={{ position: 'relative' }}>
						<button
							type="button"
							className="btn-ghost"
							style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
							onClick={() => setOpenKinds((v) => !v)}
							aria-label="캠페인 유형 선택"
							title="파워링크/쇼핑검색 선택 (복수 선택 가능)"
						>
							유형: {kindsLabel} ▾
						</button>
						{openKinds ? (
							<div
								className="card"
								style={{
									position: 'absolute',
									right: 0,
									top: 'calc(100% + 6px)',
									zIndex: 1000,
									minWidth: 220,
									padding: '10px 10px',
								}}
							>
								{(['powerlink', 'non_powerlink'] as CampaignKindKey[]).map((k) => {
									const checked = selectedKinds.has(k);
									const onlyOne = selectedKinds.size <= 1 && checked;
									return (
										<label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
											<input
												type="checkbox"
												checked={checked}
												disabled={onlyOne}
												onChange={() => {
													setSelectedKinds((prev) => {
														const next = new Set(prev);
														if (next.has(k)) next.delete(k);
														else next.add(k);
														// 최소 1개 유지
														if (next.size === 0) next.add(k);
														return next;
													});
												}}
												aria-label={KIND_LABEL[k]}
											/>
											<span style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>{KIND_LABEL[k]}</span>
											{onlyOne ? <span style={{ fontSize: 11, color: '#9ca3af' }}>(최소 1개 선택)</span> : null}
										</label>
									);
								})}
								<div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
									<button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setOpenKinds(false)}>
										닫기
									</button>
								</div>
							</div>
						) : null}
					</div>
					<button
						type="button"
						className={mergeMode ? 'btn-primary' : 'btn-ghost'}
						style={{ fontSize: 11, padding: '4px 10px' }}
						disabled={fetchState.loading || computing}
						onClick={() => setMergeMode((v) => !v)}
					>
						{primaryLabel} 통합
					</button>
					<button
						type="button"
						className="btn-ghost"
						style={{ fontSize: 11, padding: '4px 10px' }}
						disabled={fetchState.loading || computing}
						onClick={() => setColumnSettingsOpen(true)}
					>
						사용자 설정
					</button>
					<button
						type="button"
						className="btn-ghost"
						style={{ fontSize: 11, padding: '4px 10px' }}
						disabled={downloadingSearchwordExcel || ((fetchState.loading || computing) && rows.length === 0)}
						onClick={() => void handleDownloadSearchwordExcel()}
						title="현재 검색 조건의 전체 DB 결과를 다시 조회해 Excel 파일로 다운로드합니다."
					>
						{downloadingSearchwordExcel ? '다운로드 중...' : '엑셀 다운로드'}
					</button>
					<select
						aria-label="표시 행수"
						value={rowLimit}
						disabled={fetchState.loading || computing}
						onChange={(e) => {
							const v = Number((e.target as HTMLSelectElement).value);
							setRowLimit(Number.isFinite(v) ? v : 2000);
						}}
						style={{
							fontSize: 11,
							padding: '4px 8px',
							borderRadius: 8,
							border: '1px solid rgba(148,163,184,0.18)',
							background: 'rgba(2,6,23,0.35)',
							color: '#e5e7eb',
						}}
					>
						<option value={2000}>상위 2,000행</option>
						<option value={5000}>상위 5,000행</option>
						<option value={0}>전체(주의: 느릴 수 있음)</option>
					</select>
					<button
						type="button"
						className="btn-ghost"
						style={{ fontSize: 11, padding: '4px 10px' }}
						disabled={fetchState.loading || computing}
						onClick={() => setReloadTick((t) => t + 1)}
					>
						새로고침
					</button>
				</div>
			</div>

			{uploadSearchwordCsvMsg ? (
				<div className="card" style={{ fontSize: 12, color: uploadSearchwordCsvMsg.includes('실패') ? '#fecaca' : '#94a3b8' }}>
					{uploadSearchwordCsvMsg}
				</div>
			) : null}

			{/* 광고센터 다운로드 보고서와의 차이를 즉시 확인할 수 있도록, 유형별 합계를 표시한다. */}
			<div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
				<span className="badge" style={{ opacity: 0.9 }}>
					데이터 출처: {sourceLabel}
				</span>
				<span className="badge" style={{ opacity: 0.9 }}>
					파워링크 합계: 노출 {formatInt(totalsByKind.powerlink.impressions)} · 클릭 {formatInt(totalsByKind.powerlink.clicks)} · 비용 {formatWon(totalsByKind.powerlink.cost)} · 전환 {formatInt(totalsByKind.powerlink.conversions)} · 전환매출 {formatWon(totalsByKind.powerlink.revenue)}
				</span>
				<span className="badge" style={{ opacity: 0.85 }}>
					쇼핑검색 합계: 노출 {formatInt(totalsByKind.non_powerlink.impressions)} · 클릭 {formatInt(totalsByKind.non_powerlink.clicks)} · 비용 {formatWon(totalsByKind.non_powerlink.cost)} · 전환 {formatInt(totalsByKind.non_powerlink.conversions)} · 전환매출 {formatWon(totalsByKind.non_powerlink.revenue)}
				</span>
				{selectedKinds.has('non_powerlink') ? (
					<span className="badge" style={{ opacity: 0.8, background: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.35)', color: '#fde68a' }}>
						광고센터 “검색어/키워드 보고서(파워링크)”와 비교하려면 유형에서 “쇼핑검색”을 해제하세요.
					</span>
				) : null}
			</div>

			{top10CampaignDash.length > 0 ? (
				<div className="ss-panel">
					<div className="ss-panel-title">캠페인별 총전환/구매전환 대시보드 (기여도 추정)</div>
					<div className="ss-panel-sub">기간 내 데이터에서 캠페인 기준으로 총전환과 구매전환의 매출액/전환수를 함께 표시합니다. (상위 10개 캠페인)</div>

					<div className="ads-dash-grid">
						<div className="ss-panel" style={{ padding: 12 }}>
							<div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>캠페인별 총전환매출액/구매전환매출액</div>
							<div style={{ height: 260 }}>
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={top10CampaignDash} margin={{ top: 8, right: 10, left: 10, bottom: 8 }}>
										<CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
										<XAxis dataKey="campaign" hide />
										<YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="rgba(148,163,184,0.18)" tickFormatter={(v) => formatInt(Number(v))} />
										<Tooltip content={CampaignRevenueCostTooltip as any} cursor={{ fill: 'rgba(0,0,0,0)' }} />
										<Legend wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
										<Bar dataKey="revenue" name="총전환매출액" fill="rgba(34,197,94,0.85)" radius={[6, 6, 6, 6]} />
										<Bar dataKey="purchase_revenue" name="구매전환매출액" fill="rgba(96,165,250,0.85)" radius={[6, 6, 6, 6]} />
										<Bar dataKey="cost" name="총비용" fill="rgba(249,115,22,0.80)" radius={[6, 6, 6, 6]} />
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>

						<div className="ss-panel" style={{ padding: 12 }}>
							<div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>캠페인별 총전환수/구매전환수</div>
							<div style={{ height: 260 }}>
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={top10CampaignDash} margin={{ top: 8, right: 10, left: 10, bottom: 8 }}>
										<CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
										<XAxis dataKey="campaign" hide />
										<YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="rgba(148,163,184,0.18)" />
										<Tooltip content={CampaignConversionsTooltip as any} cursor={{ fill: 'rgba(0,0,0,0)' }} />
										<Legend wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
										<Bar dataKey="conversions" name="총전환수" fill="rgba(96,165,250,0.85)" radius={[6, 6, 6, 6]} />
										<Bar dataKey="purchase_conversions" name="구매전환수" fill="rgba(192,132,252,0.80)" radius={[6, 6, 6, 6]} />
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>
					</div>
				</div>
			) : null}

			{topCampaignKeywordCards.length > 0 ? (
				<div className="ss-panel">
					<div className="ss-panel-title">Top10 캠페인의 키워드별 총전환매출액/구매전환매출액</div>
					<div className="ss-panel-sub">Top 캠페인(총전환매출액 기준) 별로 키워드 기여 총전환매출액과 구매전환매출액을 함께 보여줍니다.</div>

					<div className="ads-topcards-grid">
						{topCampaignKeywordCards.slice(0, 10).map((c) => {
							const max = Math.max(...c.items.map((x) => x.revenue), 0);
							return (
								<div key={c.campaign} className="ss-panel" style={{ padding: 12 }}>
									<div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.campaign}</div>
									<div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
										총전환 {formatWon(c.totalRevenue)} · 구매전환 {formatWon(c.totalPurchaseRevenue)}
									</div>
									<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
										{c.items.map((it) => (
											<div key={it.keyword} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}>
												<div style={{ minWidth: 0 }}>
													<div style={{ fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.keyword}</div>
													<div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden', marginTop: 6 }}>
														<div
															style={{
																height: '100%',
																width: `${max > 0 ? Math.round((it.revenue / max) * 100) : 0}%`,
																background: 'rgba(34,197,94,0.85)',
															}}
														/>
													</div>
												</div>
												<div style={{ textAlign: 'right', fontSize: 11, fontWeight: 900 }}>총 {formatWon(it.revenue)}</div>
												<div style={{ textAlign: 'right', fontSize: 11, fontWeight: 900, color: '#93c5fd' }}>구매 {formatWon(it.purchaseRevenue)}</div>
											</div>
										))}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			) : null}

			{ensureState.ensuring && (
				<ProgressCard message={ensureState.message ?? '데이터 확인/수집 중…'} />
			)}
			{fetchState.error && (
				<div className="card" style={{ borderColor: 'rgba(248,113,113,0.55)' }}>
					<div style={{ fontSize: 12, color: '#fecaca' }}>{fetchState.error}</div>
				</div>
			)}
			{fetchState.loading && (
				<div className="card" style={{ fontSize: 12, color: '#9ca3af' }}>
					불러오는 중…
				</div>
			)}
			{computing && !fetchState.loading && (
				<div className="card" style={{ fontSize: 12, color: '#93c5fd' }}>
					대용량 집계 중… (UI 멈춤 방지 모드)
				</div>
			)}
			{truncated ? (
				<div className="card" style={{ fontSize: 12, color: '#fde68a', borderColor: 'rgba(251,191,36,0.35)' }}>
					현재 {rows.length.toLocaleString()}행 중 상위 {Number(rowLimit).toLocaleString()}행만 표시 중입니다. (전체는 “표시 행수”에서 선택 가능)
				</div>
			) : null}
			<AdsTable
				title={title}
				columns={visibleLeftColumns}
				leftColPx={{ primary: 140, secondary: 120, tertiary: 120 }}
				rows={visibleRows}
				totalRow={totalRow}
				visibleMetricKeys={visibleMetricKeys}
			/>
			<AdsColumnSettingsModal
				open={columnSettingsOpen}
				title="광고 검색어 분석"
				options={columnOptions}
				selectedKeys={visibleColumnKeys}
				onChange={(nextSelectedKeys) => {
					const availableKeys = columnOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey);
					setHiddenColumnKeys((current) =>
						mergeHiddenKeysForAvailable(current, availableKeys, nextSelectedKeys as Array<AdsLeftColumnKey | AdsMetricColumnKey>),
					);
				}}
				onClose={() => setColumnSettingsOpen(false)}
				onReset={() => setHiddenColumnKeys([])}
			/>
		</div>
	);
}

function chunkRange(from: string, to: string, maxDays: number): Array<{ from: string; to: string }> {
	// YYYY-MM-DD only
	const start = new Date(`${from}T00:00:00`);
	const end = new Date(`${to}T00:00:00`);
	if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [{ from, to }];

	const out: Array<{ from: string; to: string }> = [];
	let cur = new Date(start);
	while (cur.getTime() <= end.getTime()) {
		const segFrom = new Date(cur);
		const segTo = new Date(cur);
		segTo.setDate(segTo.getDate() + (maxDays - 1));
		if (segTo.getTime() > end.getTime()) segTo.setTime(end.getTime());

		const fmt = (d: Date) => {
			const y = d.getFullYear();
			const m = String(d.getMonth() + 1).padStart(2, '0');
			const dd = String(d.getDate()).padStart(2, '0');
			return `${y}-${m}-${dd}`;
		};

		out.push({ from: fmt(segFrom), to: fmt(segTo) });
		cur = new Date(segTo);
		cur.setDate(cur.getDate() + 1);
	}
	return out;
}

async function ensureAdsData(params: {
	apiBaseUrl: string;
	kind: 'keyword' | 'searchword' | 'campaign' | 'adgroup' | 'creative';
	dateFrom: string;
	dateTo: string;
	setEnsure: (s: EnsureState) => void;
	platform?: AdsPlatform;
	// 소재(creative)일 때만 사용: 특정 캠페인/광고그룹 범위로 수집/누락검증을 제한한다.
	scopeCampaigns?: string[];
	scopeAdgroups?: string[];
	signal?: AbortSignal;
}): Promise<void> {
	if (params.platform === 'gfa') {
		params.setEnsure({ ensuring: false, message: 'GFA 데이터 수집은 설정 > 데이터 수집에서 성과보고서 CSV/ZIP 업로드 또는 CDP 다운로드 요청으로 진행하세요.' });
		return;
	}
	const daysBetweenInclusive = (from: string, to: string): number => {
		const a = new Date(`${from}T00:00:00`);
		const b = new Date(`${to}T00:00:00`);
		if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return 1;
		const s = a.getTime() <= b.getTime() ? a : b;
		const e = a.getTime() <= b.getTime() ? b : a;
		const dayMs = 24 * 60 * 60 * 1000;
		return Math.max(1, Math.floor((e.getTime() - s.getTime()) / dayMs) + 1);
	};

	// 1) availability는 서버에서 62일 제한이 있으므로, 요청 범위를 62일 이하로 쪼개서 조회한다.
	//    그리고 "없는 날짜(missingDates)"만 모아서 수집을 수행한다.
	const missingAll: string[] = [];
	for (const seg of chunkYmdRange(params.dateFrom, params.dateTo, 62)) {
		const segAvail = await fetchAdsAvailability({
			baseUrl: params.apiBaseUrl,
			kind: params.kind,
			dateFrom: seg.from,
			dateTo: seg.to,
			platform: params.platform,
		});
		const segMissing = Array.isArray(segAvail?.missingDates) ? segAvail.missingDates : [];
		for (const d of segMissing) missingAll.push(String(d));
	}
	// 중복 제거 + 정렬은 groupContiguousDates 내부에서 수행되므로 그대로 사용
	const missingRanges = groupContiguousDates(missingAll);
	if (missingRanges.length === 0) return;
	// "전체 불러올 일수" = 누락된 날짜 수(일 단위)
	const totalMissingDays = groupContiguousDates(missingAll).reduce((acc, r) => acc + daysBetweenInclusive(r.from, r.to), 0);
	if (totalMissingDays <= 0) return;

	// 2) collect(range)는 서버 제한(31일)과 실제 수행시간을 고려해 31일 단위로 쪼갠다.
	const kinds = [params.kind === 'campaign' || params.kind === 'adgroup' ? 'keyword' : params.kind];
	// 성능: keyword/searchword는 1일 단위 호출이 지나치게 느리다(HTTP/초기화 오버헤드 누적).
	// - 서버가 range(최대 31일)를 지원하므로, 기본은 31일 단위로 묶는다.
	// - creative는 verify_missing/메타 보강 등으로 무거워 1일 단위가 안전하다.
	const COLLECT_MAX_DAYS = (kinds[0] === 'creative') ? 1 : 31;
	let doneDays = 0;
	params.setEnsure({ ensuring: true, message: `데이터가 없어 자동 수집 중… (${params.kind}) 0/${totalMissingDays}` });
	for (const r of missingRanges) {
		for (const seg of chunkYmdRange(r.from, r.to, COLLECT_MAX_DAYS)) {
			// 세그먼트 시작 시점에 "일 단위 진행률"을 업데이트
			const segDays = daysBetweenInclusive(seg.from, seg.to);
			params.setEnsure({
				ensuring: true,
				message: `데이터가 없어 자동 수집 중… (${params.kind}) ${Math.min(doneDays, totalMissingDays)}/${totalMissingDays} (${seg.from} ~ ${seg.to})`,
			});
			try {
				await axios.post(
					`${params.apiBaseUrl}/ads/collect`,
					{
						mode: 'range',
						date_from: seg.from,
						date_to: seg.to,
						kinds,
						campaigns: params.scopeCampaigns?.length ? params.scopeCampaigns : undefined,
						adgroups: params.scopeAdgroups?.length ? params.scopeAdgroups : undefined,
						verify_missing: params.kind === 'creative',
						max_retries: params.kind === 'creative' ? 1 : 0,
					},
					// 7일 단위라도 계정/기간에 따라 느릴 수 있어 보수적으로 20분
					{ timeout: 1200000, signal: params.signal as any },
				);
			} catch (e) {
				// REPORT_NOT_READY는 "에러"가 아니라 "집계 지연"이므로 즉시 중단하고 상위에서 메시지를 보여준다.
				if (isReportNotReadyError(e)) throw e;
				throw e;
			}
			doneDays += segDays;
			params.setEnsure({
				ensuring: true,
				message: `데이터가 없어 자동 수집 중… (${params.kind}) ${Math.min(doneDays, totalMissingDays)}/${totalMissingDays} (${seg.from} ~ ${seg.to})`,
			});
		}
	}
}

async function ensureAdsDataMulti(params: {
	apiBaseUrl: string;
	kind: 'keyword' | 'searchword' | 'campaign' | 'adgroup' | 'creative';
	ranges: Array<{ from: string; to: string }>;
	setEnsure: (s: EnsureState) => void;
	platform?: AdsPlatform;
	// 소재(creative)일 때만 사용: 특정 캠페인/광고그룹 범위로 수집/누락검증을 제한한다.
	scopeCampaigns?: string[];
	scopeAdgroups?: string[];
	// keyword/searchword 성과 화면에서 사용: 캠페인 타입 필터(파워링크 vs 쇼핑검색+브랜드)
	campaignKind?: 'powerlink' | 'shopping' | 'non_powerlink';
	signal?: AbortSignal;
}): Promise<void> {
	if (params.platform === 'gfa') {
		params.setEnsure({ ensuring: false, message: 'GFA 데이터 수집은 설정 > 데이터 수집에서 성과보고서 CSV/ZIP 업로드 또는 CDP 다운로드 요청으로 진행하세요.' });
		return;
	}
	// 여러 기간(현재/비교)을 "전체 진행률" 1개로 합산해서 보여준다.
	const daysBetweenInclusive = (from: string, to: string): number => {
		const a = new Date(`${from}T00:00:00`);
		const b = new Date(`${to}T00:00:00`);
		if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return 1;
		const s = a.getTime() <= b.getTime() ? a : b;
		const e = a.getTime() <= b.getTime() ? b : a;
		const dayMs = 24 * 60 * 60 * 1000;
		return Math.max(1, Math.floor((e.getTime() - s.getTime()) / dayMs) + 1);
	};

	const missingAll: string[] = [];
	for (const r of params.ranges) {
		for (const seg of chunkYmdRange(r.from, r.to, 62)) {
			const segAvail = await fetchAdsAvailability({
				baseUrl: params.apiBaseUrl,
				kind: params.kind,
				dateFrom: seg.from,
				dateTo: seg.to,
				campaignKind: params.campaignKind,
				platform: params.platform,
			});
			const segMissing = Array.isArray(segAvail?.missingDates) ? segAvail.missingDates : [];
			for (const d of segMissing) missingAll.push(String(d));
		}
	}

	const missingRanges = groupContiguousDates(missingAll);
	if (missingRanges.length === 0) return;
	const totalMissingDays = missingRanges.reduce((acc, r) => acc + daysBetweenInclusive(r.from, r.to), 0);
	if (totalMissingDays <= 0) return;

	const kinds = [params.kind === 'campaign' || params.kind === 'adgroup' ? 'keyword' : params.kind];
	// 성능: keyword/searchword는 1일 단위 호출이 지나치게 느리다.
	// creative는 메타/누락 보강 때문에 1일 단위 유지.
	const COLLECT_MAX_DAYS = (kinds[0] === 'creative') ? 1 : 31;

	let doneDays = 0;
	const mb = 1024 * 1024;
	const kindForStorage = kinds[0] as 'keyword' | 'searchword' | 'creative';

	// -----------------------------
	// 안정화: 메뉴 이동 시 "데이터가 없어 자동 수집"이 반복되는 문제 방지(쿨다운)
	// - 특히 쇼핑검색(non_powerlink/shopping) searchword는 계정/권한/리포트 제약으로 0건이거나,
	//   availability가 항상 missing으로 돌아오는 케이스가 있어, 매 진입마다 /ads/collect가 반복 호출될 수 있다.
	type AutoCollectCooldownEntry = { v: 1; at: number; ttlMs: number };
	const AUTO_COLLECT_COOLDOWN_LS_KEY = 'ads.autocollect.cooldown.v1';
	const bounds = (() => {
		const arr = params.ranges || [];
		let min = arr?.[0]?.from || '';
		let max = arr?.[0]?.to || '';
		for (const r of arr) {
			const f = String(r?.from || '');
			const t = String(r?.to || '');
			if (!min || (f && f < min)) min = f;
			if (!max || (t && t > max)) max = t;
		}
		return { from: min, to: max };
	})();
	const cooldownKey = `${kindForStorage}|${String(params.campaignKind || '')}|${bounds.from}|${bounds.to}`;
	const readCooldown = (): Record<string, AutoCollectCooldownEntry> => {
		try {
			const raw = String(window.localStorage.getItem(AUTO_COLLECT_COOLDOWN_LS_KEY) ?? '').trim();
			if (!raw) return {};
			const j = JSON.parse(raw) as any;
			const map = (j && typeof j === 'object' && typeof j.map === 'object') ? j.map : j;
			if (!map || typeof map !== 'object') return {};
			const out: Record<string, AutoCollectCooldownEntry> = {};
			for (const [k, v] of Object.entries(map as Record<string, any>)) {
				const at = Number((v as any)?.at);
				const ttlMs = Number((v as any)?.ttlMs);
				if (!Number.isFinite(at) || at <= 0) continue;
				if (!Number.isFinite(ttlMs) || ttlMs <= 0) continue;
				out[String(k)] = { v: 1, at, ttlMs };
			}
			return out;
		} catch {
			return {};
		}
	};
	const writeCooldown = (m: Record<string, AutoCollectCooldownEntry>) => {
		try {
			window.localStorage.setItem(AUTO_COLLECT_COOLDOWN_LS_KEY, JSON.stringify({ v: 1, map: m }));
		} catch {
			// ignore
		}
	};
	const isCooldownActive = (): boolean => {
		const m = readCooldown();
		const e = m[cooldownKey];
		if (!e) return false;
		return Date.now() - e.at < e.ttlMs;
	};
	const markCooldown = (ttlMs: number) => {
		const m = readCooldown();
		m[cooldownKey] = { v: 1, at: Date.now(), ttlMs };
		// 크기 폭주 방지: 200개까지만 유지(오래된 것 제거)
		const keys = Object.keys(m);
		if (keys.length > 200) {
			keys
				.sort((a, b) => (m[a]?.at ?? 0) - (m[b]?.at ?? 0))
				.slice(0, Math.max(0, keys.length - 200))
				.forEach((k) => delete m[k]);
		}
		writeCooldown(m);
	};

	// 쇼핑검색 계열 searchword는 반복 자동수집의 체감이 가장 크므로 쿨다운 적용
	const shouldUseCooldown =
		kindForStorage === 'searchword' && (params.campaignKind === 'non_powerlink' || params.campaignKind === 'shopping');
	if (shouldUseCooldown) {
		if (isCooldownActive()) return;
		// collect를 시작하는 순간부터는 "너무 자주 재시도"를 막기 위해 쿨다운을 찍어둔다.
		// (실패/0건이어도 메뉴 이동 때마다 무한 반복되는 것을 막는 것이 목적)
		markCooldown(6 * 60 * 60 * 1000); // 6시간
	}

	let storageSupported = false;
	let baselineBytes = 0;
	let estimatedDeltaBytes = 0;
	let lastDoneBytes = 0;

	// "DB 저장 용량 기반" 진행률(%)을 만들기 위한 추정치(수집 전) + 1초 폴링(수집 중)
	try {
		const est = await axios.get(`${params.apiBaseUrl}/ads/storage/estimate`, {
			params: { kind: kindForStorage, missing_days: totalMissingDays },
			timeout: 15000,
			signal: params.signal as any,
		});
		storageSupported = Boolean(est?.data?.supported);
		baselineBytes = Number(est?.data?.baseline_bytes) || 0;
		estimatedDeltaBytes = Number(est?.data?.estimated_delta_bytes) || 0;
	} catch {
		storageSupported = false;
	}

	let pollTimer: number | null = null;
	let extraSuffix = '';
	const setMsg = (extra: string) => {
		extraSuffix = extra;
		if (storageSupported && estimatedDeltaBytes > 0) {
			const doneMb = Math.max(0, Math.floor(lastDoneBytes / mb));
			const totalMb = Math.max(1, Math.floor(estimatedDeltaBytes / mb));
			const pct = Math.max(0, Math.min(100, Math.round((lastDoneBytes / estimatedDeltaBytes) * 100)));
			params.setEnsure({
				ensuring: true,
				message: `데이터가 없어 자동 수집 중… (${params.kind}) DB ${doneMb}/${totalMb}MB (${pct}%) · ${Math.min(
					doneDays,
					totalMissingDays,
				)}/${totalMissingDays}${extra}`,
			});
		} else {
			params.setEnsure({
				ensuring: true,
				message: `데이터가 없어 자동 수집 중… (${params.kind}) ${Math.min(doneDays, totalMissingDays)}/${totalMissingDays}${extra}`,
			});
		}
	};

	try {
		if (storageSupported && estimatedDeltaBytes > 0) {
			pollTimer = window.setInterval(async () => {
				try {
					const r = await axios.get(`${params.apiBaseUrl}/ads/storage/size`, {
						params: { kind: kindForStorage },
						timeout: 15000,
						signal: params.signal as any,
					});
					const curBytes = Number(r?.data?.bytes) || 0;
					lastDoneBytes = Math.max(0, curBytes - baselineBytes);
					// 1초 단위로 진행률을 "실시간" 표시한다.
					setMsg(extraSuffix);
				} catch {
					// ignore poll errors
				}
			}, 1000);
		}

		setMsg('');
		for (const r of missingRanges) {
			for (const seg of chunkYmdRange(r.from, r.to, COLLECT_MAX_DAYS)) {
				setMsg(` (${seg.from})`);
				const segDays = daysBetweenInclusive(seg.from, seg.to);
				try {
					await axios.post(
						`${params.apiBaseUrl}/ads/collect`,
						{
							mode: 'range',
							date_from: seg.from,
							date_to: seg.to,
							kinds,
							campaigns: params.scopeCampaigns?.length ? params.scopeCampaigns : undefined,
							adgroups: params.scopeAdgroups?.length ? params.scopeAdgroups : undefined,
							verify_missing: params.kind === 'creative',
							max_retries: params.kind === 'creative' ? 1 : 0,
						},
						{ timeout: 1200000, signal: params.signal as any },
					);
				} catch (e) {
					// 집계 지연(503)은 더 이상 같은 기간을 연속 호출하지 않도록 즉시 중단한다.
					if (isReportNotReadyError(e)) throw e;
					throw e;
				}
				doneDays += segDays;
				setMsg(` (${seg.from})`);
			}
		}
	} finally {
		if (pollTimer != null) window.clearInterval(pollTimer);
	}
}

function AdsPerformanceView(props: { apiBaseUrl: string; kind: 'keyword' | 'searchword' }): JSX.Element {
	const [dateState, setDateState] = useAdsDateState();
	const [fetchState, setFetchState] = useState<FetchState>({ loading: false, error: null });
	const [ensureState, setEnsureState] = useState<EnsureState>({ ensuring: false, message: null });
	const [rows, setRows] = useState<AdsRow[]>([]);
	const [totalRow, setTotalRow] = useState<AdsRow | null>(null);
	const [reloadTick, setReloadTick] = useState(0);
	const [mergeMode, setMergeMode] = useState(false); // true면 캠페인/그룹을 합쳐 (키워드/검색어)만으로 집계

	useEffect(() => {
		let cancelled = false;
		const run = async () => {
			setFetchState({ loading: true, error: null });
			setEnsureState({ ensuring: false, message: null });
			try {
				const r = normalizeRange(dateState.range);
				const prevRange = shiftRange(r, dateState.compareMode);
				const dateFrom = toYmd(r.from);
				const dateTo = toYmd(r.to);
				const prevFrom = toYmd(prevRange.from);
				const prevTo = toYmd(prevRange.to);
				// 메뉴 기준 고정 분리:
				// - 키워드 메뉴: 파워링크만
				// - 검색어 메뉴: 파워링크 이외의 모든 캠페인(쇼핑검색 + 브랜드 + 기타)
				const fixedCampaignKind: 'powerlink' | 'non_powerlink' = props.kind === 'keyword' ? 'powerlink' : 'non_powerlink';

				type TermDailyRow = {
					date: string; // YYYY-MM-DD
					campaign_name: string;
					adgroup_name: string;
					term: string; // keyword/searchword 원본
					device: string;
					impressions: number;
					clicks: number;
					cost: number;
					conversions: number;
					revenue: number;
					ctr: number;
					cpc: number;
					cvr: number;
					roas: number;
					source: string;
				};
				const toTermRowFromKeyword = (r: KeywordDailyRow): TermDailyRow => ({
					date: r.date,
					campaign_name: r.campaign_name,
					adgroup_name: r.adgroup_name,
					term: String(r.keyword ?? ''),
					device: r.device,
					impressions: r.impressions,
					clicks: r.clicks,
					cost: r.cost,
					conversions: r.conversions,
					revenue: r.revenue,
					ctr: r.ctr,
					cpc: r.cpc,
					cvr: r.cvr,
					roas: r.roas,
					source: r.source,
				});
				const toTermRowFromSearchword = (r: SearchwordDailyRow): TermDailyRow => ({
					date: r.date,
					campaign_name: r.campaign_name,
					adgroup_name: r.adgroup_name,
					// 검색어 효율 분석 화면은 "실제 검색어"를 보여줘야 하므로 searchword만 사용한다.
					term: String((r as any).searchword ?? ''),
					device: r.device,
					impressions: r.impressions,
					clicks: r.clicks,
					cost: r.cost,
					conversions: r.conversions,
					revenue: r.revenue,
					ctr: r.ctr,
					cpc: r.cpc,
					cvr: r.cvr,
					roas: r.roas,
					source: r.source,
				});

				// 1) 현재/비교 기간에 데이터가 없으면 자동 수집
				//    searchword는 비어 있을 수 있으므로, 실패 시 keyword(non_powerlink)로 폴백한다(추측 없이 원본 그대로).
				try {
					if (props.kind === 'keyword') {
						await ensureAdsDataMulti({
							apiBaseUrl: props.apiBaseUrl,
							kind: 'keyword',
							campaignKind: fixedCampaignKind,
							ranges: [
								{ from: dateFrom, to: dateTo },
								{ from: prevFrom, to: prevTo },
							],
							setEnsure: (s) => !cancelled && setEnsureState(s),
						});
					} else {
						try {
							await ensureAdsDataMulti({
								apiBaseUrl: props.apiBaseUrl,
								kind: 'searchword',
								campaignKind: fixedCampaignKind,
								ranges: [
									{ from: dateFrom, to: dateTo },
									{ from: prevFrom, to: prevTo },
								],
								setEnsure: (s) => !cancelled && setEnsureState(s),
							});
						} catch {
							await ensureAdsDataMulti({
								apiBaseUrl: props.apiBaseUrl,
								kind: 'keyword',
								campaignKind: fixedCampaignKind,
								ranges: [
									{ from: dateFrom, to: dateTo },
									{ from: prevFrom, to: prevTo },
								],
								setEnsure: (s) => !cancelled && setEnsureState(s),
							});
						}
					}
				} finally {
					if (!cancelled) setEnsureState({ ensuring: false, message: null });
				}

				const fetchTermDaily = async (from: string, to: string): Promise<TermDailyRow[]> => {
					if (props.kind === 'keyword') {
						const rows = await fetchKeywordDaily({ baseUrl: props.apiBaseUrl, dateFrom: from, dateTo: to, campaignKind: fixedCampaignKind });
						return (rows || []).map(toTermRowFromKeyword);
					}
					const sw = await fetchSearchwordDaily({ baseUrl: props.apiBaseUrl, dateFrom: from, dateTo: to, campaignKind: fixedCampaignKind });
					if (Array.isArray(sw) && sw.length > 0) return sw.map(toTermRowFromSearchword);
					const kw = await fetchKeywordDaily({ baseUrl: props.apiBaseUrl, dateFrom: from, dateTo: to, campaignKind: fixedCampaignKind });
					return (kw || []).map(toTermRowFromKeyword);
				};
				const [curr, prev] = await Promise.all([
					fetchTermDaily(dateFrom, dateTo),
					fetchTermDaily(prevFrom, prevTo),
				]);

				if (cancelled) return;

				const labelByKey = new Map<string, { primary: string; secondary?: string | null; tertiary?: string | null }>();

				const normPrimary = (s: string) => {
					// "(기타)"는 단어로 오인될 수 있어, 원본 리포트 성격에 맞게 "-"로 표시한다.
					const x = String(s ?? '').trim();
					if (!x) return '-';
					if (x === '(기타)') return '-';
					return x;
				};

				const keyFn = (row: TermDailyRow) => {
					const base = normPrimary(row.term);
					// 메뉴2:
					// - 파워링크(SA): "키워드"
					// - 쇼핑검색(SP): "검색어"
					// 기본은 (키워드/검색어) 단위 + (캠페인/광고그룹) 문맥을 함께 보여준다.
					// device는 PC/MOBILE 합산으로 보기 위해 key에 포함하지 않는다.
					if (mergeMode) return base;
					return `${base}||${normKeyPart(row.campaign_name)}||${normKeyPart(row.adgroup_name)}`;
				};

				const setLabel = (row: TermDailyRow) => {
					const base = normPrimary(row.term);
					const k = mergeMode ? base : `${base}||${normKeyPart(row.campaign_name)}||${normKeyPart(row.adgroup_name)}`;
					if (!labelByKey.has(k)) {
						labelByKey.set(k, {
							primary: base,
							secondary: mergeMode ? null : row.campaign_name,
							tertiary: mergeMode ? null : row.adgroup_name,
						});
					}
				};

				for (const row of curr) setLabel(row as any);
				for (const row of prev) setLabel(row as any);

				const currAgg = aggregateByKey(curr as any[], keyFn as any, totalsFromRow as any);
				const prevAgg = aggregateByKey(prev as any[], keyFn as any, totalsFromRow as any);

				const built = buildRows({ curr: currAgg, prev: prevAgg, labelByKey });
				setRows(built.rows);
				setTotalRow(built.totalRow);
			} catch (e: any) {
				if (!cancelled) {
					const msg = e?.response?.data?.detail ?? e?.message ?? '데이터를 불러오지 못했습니다.';
					setFetchState({ loading: false, error: String(msg) });
				}
				return;
			} finally {
				if (!cancelled) setFetchState((s) => ({ ...s, loading: false }));
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
		// NOTE: 성과(키워드/검색어) 화면에는 statusFilter가 존재하지 않는다.
		// (캠페인/광고그룹 화면의 상태 필터가 과거에 섞여 들어온 버그 방지)
	}, [props.apiBaseUrl, props.kind, dateState.range, dateState.compareMode, reloadTick, mergeMode]);

				const fixedCampaignKindLabel = props.kind === 'keyword' ? '파워링크' : '쇼핑검색(파워링크 제외)';
	const titleBase = props.kind === 'keyword' ? '키워드 효율 분석' : '검색어 효율 분석';
	const title = `${titleBase} · ${fixedCampaignKindLabel}`;
	const mergeLabel = props.kind === 'keyword' ? '키워드 통합' : '검색어 통합';

	return (
		<div className="space-y-3">
			<AdsDateControls value={dateState} onChange={setDateState} />
			<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
				<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>{title}</div>
				<div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
					<button
						type="button"
						className={mergeMode ? 'btn-primary' : 'btn-ghost'}
						style={{ fontSize: 11, padding: '4px 10px' }}
						onClick={() => setMergeMode((v) => !v)}
					>
						{mergeLabel}
					</button>
					<button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setReloadTick((t) => t + 1)}>
						새로고침
					</button>
				</div>
			</div>
			{ensureState.ensuring && (
				<ProgressCard message={ensureState.message ?? '데이터 확인/수집 중…'} />
			)}
			{fetchState.error && (
				<div className="card" style={{ borderColor: 'rgba(248,113,113,0.55)' }}>
					<div style={{ fontSize: 12, color: '#fecaca' }}>{fetchState.error}</div>
				</div>
			)}
			{fetchState.loading && (
				<div className="card" style={{ fontSize: 12, color: '#9ca3af' }}>
					불러오는 중…
				</div>
			)}
			<AdsTable
				title={title}
				columns={
					mergeMode
						? [{ key: 'primary', label: props.kind === 'keyword' ? '키워드' : '검색어' }]
						: [
							{ key: 'primary', label: props.kind === 'keyword' ? '키워드' : '검색어' },
							{ key: 'secondary', label: '캠페인' },
							{ key: 'tertiary', label: '광고그룹' },
						]
				}
				rows={rows}
				totalRow={totalRow}
			/>
		</div>
	);
}

export function CampaignDailyView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsCampaignView apiBaseUrl={props.apiBaseUrl} kind="campaign" platform="sa" />;
}

export function AdgroupDailyView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsCampaignView apiBaseUrl={props.apiBaseUrl} kind="adgroup" platform="sa" />;
}

export function CreativesDailyView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsCreativeView apiBaseUrl={props.apiBaseUrl} platform="sa" />;
}

export function GfaCampaignDailyView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsCampaignView apiBaseUrl={props.apiBaseUrl} kind="campaign" platform="gfa" />;
}

export function GfaAdgroupDailyView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsCampaignView apiBaseUrl={props.apiBaseUrl} kind="adgroup" platform="gfa" />;
}

export function GfaCreativesDailyView(props: { apiBaseUrl: string }): JSX.Element {
	return <AdsCreativeView apiBaseUrl={props.apiBaseUrl} platform="gfa" />;
}

export function GfaOperatingCheckView(props: { apiBaseUrl: string }): JSX.Element {
	const location = useLocation();
	const navigate = useNavigate();
	const path = String(location.pathname || '');
	const stage: 'campaign' | 'adgroup' | 'creative' = path.includes('/gfa/creatives')
		? 'creative'
		: path.includes('/gfa/adgroups')
			? 'adgroup'
			: 'campaign';
	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">GFA 운영 체크</div>
				<div style={{ fontSize: 12, color: '#9ca3af' }}>
					캠페인·광고그룹·소재별 비용, 클릭, 구매완료, 구매 ROAS를 일일 점검합니다. 실제 매출 판단은 구매완료 지표를 우선합니다.
					수집은 설정 &gt; 데이터 수집에서 진행합니다.
				</div>
			</div>
			<div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				{([
					['campaign', '캠페인'],
					['adgroup', '광고그룹'],
					['creative', '소재'],
				] as const).map(([key, label]) => (
					<button
						key={key}
						type="button"
						className={stage === key ? 'btn-primary' : 'btn-ghost'}
						onClick={() => navigate(key === 'campaign' ? '/analytics/gfa/campaigns' : key === 'adgroup' ? '/analytics/gfa/adgroups' : '/analytics/gfa/creatives')}
					>
						{label} 체크
					</button>
				))}
			</div>
			<div>
				{stage === 'campaign' ? <AdsCampaignView apiBaseUrl={props.apiBaseUrl} kind="campaign" platform="gfa" /> : stage === 'adgroup' ? <AdsCampaignView apiBaseUrl={props.apiBaseUrl} kind="adgroup" platform="gfa" /> : <AdsCreativeView apiBaseUrl={props.apiBaseUrl} platform="gfa" />}
			</div>
		</div>
	);
}

export function GfaCreativeAnalysisView(props: { apiBaseUrl: string }): JSX.Element {
	const [searchParams] = useSearchParams();
	const [creativeId, setCreativeId] = useState('');
	const [appealPoints, setAppealPoints] = useState('');
	const [imageType, setImageType] = useState('');
	const [messageType, setMessageType] = useState('');
	const [notes, setNotes] = useState('');
	const [imageFile, setImageFile] = useState<File | null>(null);
	const [breakdown, setBreakdown] = useState<any | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [dateState] = useAdsDateState();

	useEffect(() => {
		const cid = String(searchParams.get('creative_id') || '').trim();
		if (cid) setCreativeId(cid);
	}, [searchParams]);

	const loadMeta = async () => {
		const cid = creativeId.trim();
		if (!cid) return;
		try {
			const r = normalizeRange(dateState.range);
			const dateFrom = toYmd(r.from);
			const dateTo = toYmd(r.to);
			const [metaRes, breakdownRes] = await Promise.all([
				axios.get(`${props.apiBaseUrl}/gfa/creatives/${encodeURIComponent(cid)}/meta`),
				axios.get(`${props.apiBaseUrl}/gfa/creatives/${encodeURIComponent(cid)}/breakdown`, {
					params: { date_from: dateFrom, date_to: dateTo },
				}),
			]);
			const meta = metaRes.data as any;
			setAppealPoints(Array.isArray(meta.appeal_points) ? meta.appeal_points.join(', ') : '');
			setImageType(String(meta.image_type || ''));
			setMessageType(String(meta.message_type || ''));
			setNotes(String(meta.notes || ''));
			setBreakdown(breakdownRes.data);
			setMessage('소재 메타와 반응 데이터를 불러왔습니다.');
		} catch (e) {
			setMessage(errorDetailText(e));
		}
	};

	useEffect(() => {
		if (!creativeId.trim()) return;
		void loadMeta();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [creativeId, dateState.range.from, dateState.range.to]);

	const saveMeta = async () => {
		const cid = creativeId.trim();
		if (!cid) {
			setMessage('소재 ID를 입력하세요.');
			return;
		}
		try {
			await axios.put(`${props.apiBaseUrl}/gfa/creatives/${encodeURIComponent(cid)}/meta`, {
				appeal_points: appealPoints.split(',').map((x) => x.trim()).filter(Boolean),
				image_type: imageType,
				message_type: messageType,
				notes,
			});
			if (imageFile) {
				const form = new FormData();
				form.append('file', imageFile);
				await axios.post(`${props.apiBaseUrl}/gfa/creatives/${encodeURIComponent(cid)}/image`, form, {
					headers: { 'Content-Type': 'multipart/form-data' },
				});
			}
			setMessage('소재 메타를 저장했습니다.');
			await loadMeta();
		} catch (e) {
			setMessage(errorDetailText(e));
		}
	};

	const metricRow = (row: any): string => `${row.name}: 비용 ${formatWon(row.cost)} / 클릭 ${formatInt(row.clicks)} / 구매 ${formatInt(row.purchase_conversions || 0)} / 구매매출 ${formatWon(row.purchase_revenue || 0)} / ROAS ${formatPct(row.roas || 0)}`;

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">GFA 소재 분석</div>
				<div style={{ fontSize: 12, color: '#9ca3af' }}>소재 ID를 기준으로 이미지, 소구포인트, 이미지 유형, 메시지 유형을 관리하고 게재위치/연령성별 반응을 확인합니다. 수집은 설정 &gt; 데이터 수집에서 진행합니다.</div>
			</div>
			<AdsCreativeView apiBaseUrl={props.apiBaseUrl} platform="gfa" />
			<div className="card" style={{ display: 'grid', gap: 10 }}>
				<div className="card-title">소재 메타 관리</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
					<input className="input" value={creativeId} onChange={(e) => setCreativeId(e.target.value)} placeholder="소재 ID" />
					<input className="input" value={appealPoints} onChange={(e) => setAppealPoints(e.target.value)} placeholder="소구포인트(쉼표 구분)" />
					<input className="input" value={imageType} onChange={(e) => setImageType(e.target.value)} placeholder="이미지 유형" />
					<input className="input" value={messageType} onChange={(e) => setMessageType(e.target.value)} placeholder="메시지 유형" />
				</div>
				<textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="메모" rows={3} />
				<input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
				<div style={{ display: 'flex', gap: 8 }}>
					<button type="button" className="btn-ghost" onClick={loadMeta}>불러오기</button>
					<button type="button" className="btn-primary" onClick={saveMeta}>저장</button>
				</div>
				{message && <div style={{ fontSize: 12, color: message.includes('실패') ? '#fecaca' : '#bbf7d0' }}>{message}</div>}
				{breakdown && (
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
						<div>
							<div style={{ fontWeight: 900, marginBottom: 6 }}>게재위치 반응</div>
							{(breakdown.placement || []).map((r: any) => <div key={r.name} style={{ fontSize: 12, color: '#d1d5db' }}>{metricRow(r)}</div>)}
						</div>
						<div>
							<div style={{ fontWeight: 900, marginBottom: 6 }}>연령/성별 반응</div>
							{(breakdown.audience || []).map((r: any) => <div key={r.name} style={{ fontSize: 12, color: '#d1d5db' }}>{metricRow(r)}</div>)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export function GfaStrategyView(props: { apiBaseUrl: string }): JSX.Element {
	const [dateState, setDateState] = useAdsDateState();
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<any | null>(null);
	const run = async () => {
		setLoading(true);
		try {
			const r = normalizeRange(dateState.range);
			const res = await axios.post(`${props.apiBaseUrl}/gfa/strategy/analyze`, {
				date_from: toYmd(r.from),
				date_to: toYmd(r.to),
			});
			setResult(res.data);
		} catch (e) {
			setResult({ ok: false, suggestions: [errorDetailText(e)] });
		} finally {
			setLoading(false);
		}
	};
	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">GFA 전략 도출</div>
				<div style={{ fontSize: 12, color: '#9ca3af' }}>성과 데이터와 소재 메타를 결합해 확장할 조합과 축소할 조합을 도출합니다.</div>
			</div>
			<AdsDateControls value={dateState} onChange={setDateState} />
			<button type="button" className="btn-primary" style={{ width: 180 }} onClick={run} disabled={loading}>
				전략 분석 실행
			</button>
			{result && (
				<div className="card" style={{ display: 'grid', gap: 12 }}>
					<div className="card-title">분석 결과</div>
					{(result.suggestions || []).map((s: string, idx: number) => <div key={idx} style={{ fontSize: 13, color: '#e5e7eb' }}>{s}</div>)}
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
						<div>
							<div style={{ fontWeight: 900, marginBottom: 6 }}>우수 조합</div>
							{(result.strong_combinations || []).slice(0, 5).map((r: any, idx: number) => (
								<div key={idx} style={{ fontSize: 12, color: '#d1d5db' }}>{r.appeal_point} / {r.image_type} / {r.placement} / {r.audience} · 구매ROAS {formatPct(Number(r.purchase_revenue || 0) / Math.max(1, Number(r.cost || 0)) * 100)}</div>
							))}
						</div>
						<div>
							<div style={{ fontWeight: 900, marginBottom: 6 }}>축소 후보</div>
							{(result.weak_combinations || []).slice(0, 5).map((r: any, idx: number) => (
								<div key={idx} style={{ fontSize: 12, color: '#d1d5db' }}>{r.creative_name} / {r.placement} / {r.audience} · 비용 {formatWon(r.cost || 0)}</div>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export function GfaRawAnalysisView(props: { apiBaseUrl: string }): JSX.Element {
	type RawMetricColumnKey =
		| 'status'
		| 'target'
		| 'campaign'
		| 'adgroup'
		| 'cost'
		| 'impressions'
		| 'clicks'
		| 'ctr'
		| 'cpc'
		| 'conversions'
		| 'revenue'
		| 'cvr'
		| 'roas'
		| 'purchase_conversions'
		| 'purchase_cvr'
		| 'purchase_revenue'
		| 'cart_conversions'
		| 'cart_revenue'
		| 'total_purchase_value'
		| 'purchase_roas'
		| 'judgment'
		| 'judgment_grade'
		| 'judgment_reason'
		| 'recommended_action'
		| 'priority';
	type SortState = { key: RawMetricColumnKey; dir: 'asc' | 'desc' };
	type RawJudgment = {
		judgment: string;
		grade: '매우주의' | '점검' | '우수' | '보통' | '판단보류';
		reason: string;
		action: string;
		priority: '높음' | '중간' | '낮음';
	};

	const [dateState, setDateState] = useAdsDateState();
	const [dimension, setDimension] = useState<'campaign' | 'adgroup' | 'creative' | 'placement' | 'audience' | 'result_type' | 'status'>('campaign');
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<any | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
	const rawHiddenColumnsKey = 'gfa.rawAnalysis.hiddenColumns.v2';
	const [hiddenColumnKeys, setHiddenColumnKeys] = useState<RawMetricColumnKey[]>(() => loadHiddenColumnKeys<RawMetricColumnKey>(rawHiddenColumnsKey));
	const [sortState, setSortState] = useState<SortState>({ key: 'cost', dir: 'desc' });
	const [rawStatusFilter, setRawStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
	const didAutoResetRef = useRef(false);
	const [rangeNotice, setRangeNotice] = useState<string | null>(null);
	const maxRawRangeDays = 30;

	const handleRawDateChange = (next: AdsDateState) => {
		const r = normalizeRange(next.range);
		if (rangeLengthDays(r) <= maxRawRangeDays) {
			setRangeNotice(null);
			setDateState({ ...next, range: r });
			return;
		}
		const cappedFrom = new Date(r.to);
		cappedFrom.setDate(cappedFrom.getDate() - (maxRawRangeDays - 1));
		const capped = { ...next, range: normalizeRange({ from: cappedFrom, to: r.to }) };
		setRangeNotice(
			`원본 분석은 성능을 위해 최근 ${maxRawRangeDays}일까지만 조회합니다. 선택하신 기간(${toYmd(r.from)} ~ ${toYmd(r.to)}) 중 ${toYmd(capped.range.from)} ~ ${toYmd(capped.range.to)}로 적용했습니다.`,
		);
		setDateState(capped);
		window.setTimeout(() => saveAdsDateState(capped), 0);
	};

	const dimensions = [
		['campaign', '캠페인'],
		['adgroup', '그룹'],
		['creative', '소재'],
		['placement', '게재위치'],
		['audience', '연령/성별'],
		['result_type', '결과유형'],
		['status', '운영상태'],
	] as const;
	const metricColumnOptions: Array<AdsColumnSettingOption & { key: RawMetricColumnKey; valueKind: 'text' | 'int' | 'won' | 'pct' }> = [
		{ key: 'status', label: '운영여부', group: '기준', valueKind: 'text' },
		{ key: 'target', label: '대상', group: '기준', valueKind: 'text' },
		{ key: 'campaign', label: '캠페인', group: '기준', valueKind: 'text' },
		{ key: 'adgroup', label: '그룹', group: '기준', valueKind: 'text' },
		{ key: 'judgment_grade', label: '판정등급', group: '운영판정', valueKind: 'text' },
		{ key: 'judgment', label: '운영판정', group: '운영판정', valueKind: 'text' },
		{ key: 'judgment_reason', label: '판정근거', group: '운영판정', valueKind: 'text' },
		{ key: 'recommended_action', label: '추천액션', group: '운영판정', valueKind: 'text' },
		{ key: 'priority', label: '우선순위', group: '운영판정', valueKind: 'text' },
		{ key: 'cost', label: '비용', group: '성과', valueKind: 'won' },
		{ key: 'impressions', label: '노출', group: '성과', valueKind: 'int' },
		{ key: 'clicks', label: '클릭', group: '성과', valueKind: 'int' },
		{ key: 'ctr', label: 'CTR', group: '성과', valueKind: 'pct' },
		{ key: 'cpc', label: 'CPC', group: '성과', valueKind: 'won' },
		{ key: 'conversions', label: '총전환수', group: '전환', valueKind: 'int' },
		{ key: 'revenue', label: '총전환매출', group: '전환', valueKind: 'won' },
		{ key: 'cvr', label: 'CVR', group: '전환', valueKind: 'pct' },
		{ key: 'roas', label: '총 ROAS', group: '전환', valueKind: 'pct' },
		{ key: 'purchase_conversions', label: '구매수', group: '구매', valueKind: 'int' },
		{ key: 'purchase_cvr', label: '구매전환율', group: '구매', valueKind: 'pct' },
		{ key: 'purchase_revenue', label: '구매매출', group: '구매', valueKind: 'won' },
		{ key: 'cart_conversions', label: '장바구니수', group: '구매', valueKind: 'int' },
		{ key: 'cart_revenue', label: '장바구니매출', group: '구매', valueKind: 'won' },
		{ key: 'total_purchase_value', label: '총구매값', group: '구매', valueKind: 'won' },
		{ key: 'purchase_roas', label: '구매 ROAS', group: '구매', valueKind: 'pct' },
	];
	const metricColumnKeys = metricColumnOptions.map((option) => option.key);
	const visibleMetricColumns = useMemo(
		() => metricColumnOptions.filter((option) => !hiddenColumnKeys.includes(option.key)),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[hiddenColumnKeys],
	);

	useEffect(() => {
		saveHiddenColumnKeys(rawHiddenColumnsKey, hiddenColumnKeys);
	}, [hiddenColumnKeys]);

	const load = async () => {
		setLoading(true);
		setMessage(null);
		try {
			const r = normalizeRange(dateState.range);
			const requestLimit =
				dimension === 'campaign' || dimension === 'adgroup'
					? 5000
					: dimension === 'creative'
						? 2000
						: 500;
			const res = await axios.get(`${props.apiBaseUrl}/gfa/raw-analysis`, {
				params: {
					date_from: toYmd(r.from),
					date_to: toYmd(r.to),
					dimension,
					limit: requestLimit,
					include_inventory: true,
				},
			});
			setResult(res.data);
		} catch (e) {
			setMessage(errorDetailText(e));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		const r = normalizeRange(dateState.range);
		if (!didAutoResetRef.current) {
			didAutoResetRef.current = true;
			const y = normalizeRange(defaultYesterdayRange());
			const isYesterday = toYmd(r.from) === toYmd(y.from) && toYmd(r.to) === toYmd(y.to) && dateState.compareMode === 'prev_day';
			if (!isYesterday) {
				setDateState({ range: y, compareMode: 'prev_day' });
				return;
			}
		}
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dimension, dateState.range, dateState.compareMode]);

	const rows = Array.isArray(result?.dimension_rows) ? result.dimension_rows : [];
	const columns = Array.isArray(result?.raw_columns) ? result.raw_columns : [];
	const insights = result?.insights || {};
	const samples = Array.isArray(result?.samples) ? result.samples : [];
	const total = result?.total || {};
	const collectedMin = result?.collected_at?.min ? new Date(result.collected_at.min).toLocaleString() : '-';
	const collectedMax = result?.collected_at?.max ? new Date(result.collected_at.max).toLocaleString() : '-';
	const canFilterByOperationalState = useMemo(
		() => rows.some((r: any) => typeof r?.is_active === 'boolean'),
		[rows],
	);
	const filteredRows = useMemo(() => {
		if (!canFilterByOperationalState || rawStatusFilter === 'all') return rows;
		return rows.filter((r: any) => {
			const active = typeof r?.is_active === 'boolean' ? r.is_active : null;
			if (rawStatusFilter === 'active') return active === true;
			if (rawStatusFilter === 'inactive') return active === false;
			return true;
		});
	}, [canFilterByOperationalState, rawStatusFilter, rows]);

	const buildRawJudgment = (r: any): RawJudgment => {
		const cost = Number(r.cost || 0);
		const impressions = Number(r.impressions || 0);
		const ctr = Number(r.ctr || 0);
		const purchaseConversions = Number(r.purchase_conversions || 0);
		const purchaseRevenue = Number(r.purchase_revenue || 0);
		const cartConversions = Number(r.cart_conversions || 0);
		const cartRevenue = Number(r.cart_revenue || 0);
		const purchaseRoas = Number(r.purchase_roas || 0);
		if (r.is_active === false) {
			return {
				judgment: '종료 캠페인',
				grade: '판단보류',
				reason: '운영 종료 상태이므로 성과 판정 제외',
				action: '목록 확인만 수행',
				priority: '낮음',
			};
		}
		if (cost <= 0 && impressions <= 0) {
			return {
				judgment: '데이터 부족',
				grade: '판단보류',
				reason: '비용/노출 데이터 없음',
				action: '수집 범위와 운영 상태 확인',
				priority: '낮음',
			};
		}
		if (cost >= 10000 && purchaseConversions <= 0 && purchaseRevenue <= 0) {
			return {
				judgment: '고비용 무구매',
				grade: '매우주의',
				reason: `비용 ${formatWon(cost)} / 구매 0건`,
				action: '중지, 예산 축소 또는 소재 교체 검토',
				priority: '높음',
			};
		}
		if (purchaseRevenue > 0 && purchaseRoas >= 300) {
			return {
				judgment: 'ROAS 우수',
				grade: '우수',
				reason: `구매매출 ${formatWon(purchaseRevenue)} / 구매 ROAS ${formatPct(purchaseRoas)}`,
				action: '예산 확장 또는 유사 소재 확장 후보',
				priority: '낮음',
			};
		}
		if (impressions >= 1000 && ctr < 0.5) {
			return {
				judgment: '저CTR',
				grade: '점검',
				reason: `노출 ${formatInt(impressions)} / CTR ${formatPct(ctr)}`,
				action: '소구문구, 이미지, 타겟 점검',
				priority: '중간',
			};
		}
		if ((cartConversions > 0 || cartRevenue > 0) && purchaseConversions <= 0) {
			return {
				judgment: '장바구니 유입',
				grade: '점검',
				reason: `장바구니 ${formatInt(cartConversions)}건 / ${formatWon(cartRevenue)}`,
				action: '구매 전환 경로와 혜택 점검',
				priority: '중간',
			};
		}
		return {
			judgment: '정상',
			grade: '보통',
			reason: `비용 ${formatWon(cost)} / 구매 ${formatInt(purchaseConversions)}건`,
			action: '현재 추이 모니터링',
			priority: '낮음',
		};
	};
	const judgmentGradeMeta = (grade: RawJudgment['grade']) => {
		if (grade === '매우주의') return { icon: '🔥', bg: '#7f1d1d', color: '#fff', border: '#f97316' };
		if (grade === '점검') return { icon: '⚠', bg: '#78350f', color: '#fef3c7', border: '#f59e0b' };
		if (grade === '우수') return { icon: '👍', bg: '#166534', color: '#fff', border: '#22c55e' };
		if (grade === '판단보류') return { icon: '⏸', bg: '#1f2937', color: '#d1d5db', border: '#4b5563' };
		return { icon: '●', bg: '#334155', color: '#e5e7eb', border: '#64748b' };
	};
	const priorityOrder = (priority: RawJudgment['priority']): number => {
		if (priority === '높음') return 3;
		if (priority === '중간') return 2;
		return 1;
	};
	const gradeOrder = (grade: RawJudgment['grade']): number => {
		if (grade === '판단보류') return 5;
		if (grade === '매우주의') return 4;
		if (grade === '점검') return 3;
		if (grade === '보통') return 2;
		if (grade === '우수') return 1;
		return 0;
	};
	const rawCellValue = (r: any, key: RawMetricColumnKey): unknown => {
		const judgment = buildRawJudgment(r);
		if (key === 'status') return r.status || '미상';
		if (key === 'target') return r.value || r.creative_name || r.creative_id || '-';
		if (key === 'campaign') return r.campaign_name || '-';
		if (key === 'adgroup') return r.adgroup_name || '-';
		if (key === 'judgment') return judgment.judgment;
		if (key === 'judgment_grade') return gradeOrder(judgment.grade);
		if (key === 'judgment_reason') return judgment.reason;
		if (key === 'recommended_action') return judgment.action;
		if (key === 'priority') return priorityOrder(judgment.priority);
		if (key === 'purchase_cvr') {
			const clicks = Number(r.clicks || 0);
			const purchaseConversions = Number(r.purchase_conversions || 0);
			return clicks > 0 ? (purchaseConversions / clicks) * 100 : 0;
		}
		return r[key] ?? 0;
	};
	const displayRawCellValue = (r: any, key: RawMetricColumnKey): unknown => {
		const judgment = buildRawJudgment(r);
		if (key === 'judgment_grade') return judgment.grade;
		if (key === 'priority') return judgment.priority;
		return rawCellValue(r, key);
	};
	const formatRawCell = (value: unknown, kind: 'text' | 'int' | 'won' | 'pct'): string => {
		if (kind === 'text') return String(value ?? '-');
		const n = Number(value || 0);
		if (kind === 'won') return formatWon(n);
		if (kind === 'pct') return formatPct(n);
		return formatInt(n);
	};
	const compareRawRows = (a: any, b: any, key: RawMetricColumnKey): number => {
		if (key === 'judgment_grade') {
			const aj = buildRawJudgment(a);
			const bj = buildRawJudgment(b);
			const gradeCmp = gradeOrder(aj.grade) - gradeOrder(bj.grade);
			if (gradeCmp !== 0) return gradeCmp;
			const priorityCmp = priorityOrder(aj.priority) - priorityOrder(bj.priority);
			if (priorityCmp !== 0) return priorityCmp;
			return Number(a.cost || 0) - Number(b.cost || 0);
		}
		const av = rawCellValue(a, key);
		const bv = rawCellValue(b, key);
		if (key === 'status' || key === 'target' || key === 'campaign' || key === 'adgroup') {
			return String(av ?? '').localeCompare(String(bv ?? ''), 'ko');
		}
		return Number(av || 0) - Number(bv || 0);
	};
	const renderRawCell = (r: any, col: { key: RawMetricColumnKey; valueKind: 'text' | 'int' | 'won' | 'pct' }): React.ReactNode => {
		const judgment = buildRawJudgment(r);
		if (col.key === 'judgment_grade') {
			const meta = judgmentGradeMeta(judgment.grade);
			return (
				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 4,
						borderRadius: 999,
						padding: '2px 8px',
						fontSize: 11,
						fontWeight: 900,
						color: meta.color,
						background: meta.bg,
						border: `1px solid ${meta.border}`,
						whiteSpace: 'nowrap',
					}}
					title={`${judgment.judgment}: ${judgment.reason}`}
				>
					<span>{meta.icon}</span>
					{judgment.grade}
				</span>
			);
		}
		return formatRawCell(displayRawCellValue(r, col.key), col.valueKind);
	};
	const sortedRawRows = (data: any[]): any[] => {
		const dir = sortState.dir === 'asc' ? 1 : -1;
		return [...data].sort((a, b) => compareRawRows(a, b, sortState.key) * dir);
	};
	const toggleSort = (key: RawMetricColumnKey) => {
		setSortState((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
	};

	const renderMetricTable = (title: string, data: any[], emptyText: string): JSX.Element => (
		<div className="card" style={{ display: 'grid', gap: 8 }}>
			<div className="card-title">{title}</div>
			{data.length === 0 ? (
				<div style={{ fontSize: 12, color: '#9ca3af' }}>{emptyText}</div>
			) : (
				<div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
					<table className="table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
						<thead>
							<tr>
								{visibleMetricColumns.map((col) => (
									<th key={col.key} style={{ whiteSpace: 'nowrap' }}>
										<button
											type="button"
											className="btn-ghost"
											style={{ padding: 0, fontSize: 12, fontWeight: 900, color: '#cbd5e1', whiteSpace: 'nowrap' }}
											onClick={() => toggleSort(col.key)}
										>
											{col.label}{sortState.key === col.key ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : ''}
										</button>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{sortedRawRows(data).map((r: any, idx: number) => (
								<tr key={`${title}-${idx}`}>
									{visibleMetricColumns.map((col) => (
										<td key={col.key} style={{ whiteSpace: 'nowrap' }}>{renderRawCell(r, col)}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">GFA 원본 분석</div>
				<div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.55 }}>
					저장된 성과보고서 원본 컬럼을 기준으로 차원별 성과, 운영 상태 분포, 이상 후보, 샘플 원본값을 확인합니다.
					수집된 CSV 원본이 실제 분석에 어떻게 쓰이는지 검증하는 화면입니다.
				</div>
			</div>

			<AdsDateControls value={dateState} onChange={handleRawDateChange} />
			{rangeNotice ? (
				<div className="card" style={{ fontSize: 12, color: '#fde68a', borderColor: 'rgba(251,191,36,0.35)' }}>
					{rangeNotice}
				</div>
			) : null}
			<div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
				{dimensions.map(([key, label]) => (
					<button key={key} type="button" className={dimension === key ? 'btn-primary' : 'btn-ghost'} onClick={() => setDimension(key)}>
						{label}
					</button>
				))}
				{canFilterByOperationalState ? (
					<select
						value={rawStatusFilter}
						onChange={(e) => setRawStatusFilter(String(e.target.value || 'all') as 'all' | 'active' | 'inactive')}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 800,
						}}
						aria-label="gfa-raw-status-filter"
					>
						<option value="all">전체</option>
						<option value="active">운영중</option>
						<option value="inactive">종료</option>
					</select>
				) : null}
				<button type="button" className="btn-ghost" onClick={() => setColumnSettingsOpen(true)}>
					컬럼 설정
				</button>
				<button type="button" className="btn-primary" onClick={load} disabled={loading}>
					{loading ? '분석 중...' : '분석 새로고침'}
				</button>
			</div>
			<AdsColumnSettingsModal
				open={columnSettingsOpen}
				title="GFA 원본 분석"
				options={metricColumnOptions}
				selectedKeys={selectedKeysFromHidden(metricColumnKeys, hiddenColumnKeys)}
				onChange={(nextSelectedKeys) => {
					setHiddenColumnKeys(hiddenKeysFromSelected(metricColumnKeys, nextSelectedKeys as RawMetricColumnKey[]));
				}}
				onClose={() => setColumnSettingsOpen(false)}
				onReset={() => setHiddenColumnKeys([])}
			/>

			{message ? <div className="card" style={{ color: '#fecaca', fontSize: 12 }}>{message}</div> : null}
			{result ? (
				<>
					<div className="card" style={{ display: 'grid', gap: 12 }}>
						<div className="card-title">요약</div>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>원본 행수</div><div style={{ fontWeight: 900 }}>{formatInt(result.row_count || 0)}</div></div>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>총비용</div><div style={{ fontWeight: 900 }}>{formatWon(total.cost || 0)}</div></div>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>총전환매출</div><div style={{ fontWeight: 900 }}>{formatWon(total.revenue || 0)}</div></div>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>구매매출</div><div style={{ fontWeight: 900 }}>{formatWon(total.purchase_revenue || 0)}</div></div>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>장바구니매출</div><div style={{ fontWeight: 900 }}>{formatWon(total.cart_revenue || 0)}</div></div>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>총구매값</div><div style={{ fontWeight: 900 }}>{formatWon(total.total_purchase_value || 0)}</div></div>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>구매 ROAS</div><div style={{ fontWeight: 900 }}>{formatPct(total.purchase_roas || 0)}</div></div>
							<div><div style={{ fontSize: 11, color: '#94a3b8' }}>수집시점</div><div style={{ fontSize: 12 }}>{collectedMin} ~ {collectedMax}</div></div>
						</div>
						<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
							{(result.status_counts || []).map((r: any) => <span key={r.status} style={badgeStyle('muted')}>{r.status} {formatInt(r.count || 0)}</span>)}
							{(result.source_counts || []).map((r: any) => <span key={r.source} style={badgeStyle('muted')}>{r.source} {formatInt(r.count || 0)}</span>)}
						</div>
					</div>

					{renderMetricTable('차원별 성과', filteredRows, '선택한 조건에 맞는 GFA 데이터가 없습니다.')}

					<div className="card" style={{ display: 'grid', gap: 8 }}>
						<div className="card-title">저장된 원본 컬럼</div>
						<div style={{ fontSize: 12, color: '#9ca3af' }}>CSV에서 들어온 전체 컬럼 중 값이 있는 컬럼과 샘플값입니다.</div>
						<div style={{ overflowX: 'auto' }}>
							<table className="table">
								<thead><tr><th>컬럼</th><th>값 있음</th><th>샘플</th></tr></thead>
								<tbody>
									{columns.slice(0, 80).map((c: any) => (
										<tr key={c.name}>
											<td>{c.name}</td>
											<td>{formatInt(c.non_empty_count || 0)} / {formatInt(c.count || 0)}</td>
											<td>{Array.isArray(c.examples) ? c.examples.join(' / ') : ''}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					<div className="card" style={{ display: 'grid', gap: 8 }}>
						<div className="card-title">원본 샘플</div>
						{samples.slice(0, 5).map((s: any, idx: number) => (
							<details key={idx} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 10, padding: 10 }}>
								<summary style={{ cursor: 'pointer', fontWeight: 800 }}>
									{s.date} · {s.campaign_name || '-'} · {s.adgroup_name || '-'} · {s.creative_name || '-'}
								</summary>
								<pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, color: '#cbd5e1' }}>
									{JSON.stringify(s.raw_payload || {}, null, 2)}
								</pre>
							</details>
						))}
					</div>
				</>
			) : null}
		</div>
	);
}

function AdsCreativeView(props: { apiBaseUrl: string; platform?: AdsPlatform }): JSX.Element {
	const platform = props.platform ?? 'sa';
	const routeBase = platform === 'gfa' ? '/analytics/gfa' : '/analytics/campaign';
	const [dateState, setDateState] = useAdsDateState();
	const [reloadTick, setReloadTick] = useState(0);
	const [forceRecollectTick, setForceRecollectTick] = useState(0);
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
	const [openDropdown, setOpenDropdown] = useState<'campaign' | 'adgroup' | null>(null);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
	const [keywordInsightsOpen, setKeywordInsightsOpen] = useState(false);
	const [keywordInsightsSeed, setKeywordInsightsSeed] = useState<string>('');
	const [uploadFile, setUploadFile] = useState<File | null>(null);
	const [uploadFileInputKey, setUploadFileInputKey] = useState(0);
	const [uploading, setUploading] = useState(false);
	const [uploadMsg, setUploadMsg] = useState<string | null>(null);
	const [uploadButtonState, setUploadButtonState] = useState<'idle' | 'saved'>('idle');
	const [uploadSaved, setUploadSaved] = useState(false);
	const [uploadDetails, setUploadDetails] = useState<null | {
		filename: string;
		processedDates: string[];
		skippedDates: string[];
		insertedTotal: number;
		derivedRecomputedDates: string[];
	}>(null);
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();

	const productUrlFilter = useMemo(() => String(searchParams.get('product_url') ?? '').trim(), [searchParams]);
	const productTitleFilter = useMemo(() => String(searchParams.get('product') ?? '').trim(), [searchParams]);
	const baseUrl = (u: unknown): string => (String(u ?? '').trim().split('?')[0] ?? '').trim();

	const selectedCampaigns = useMemo(() => {
		const vs = (searchParams.getAll('campaign') || []).map((x) => String(x ?? '').trim()).filter(Boolean);
		const single = String(searchParams.get('campaign') ?? '').trim();
		if (vs.length === 0 && single) vs.push(single);
		return Array.from(new Set(vs));
	}, [searchParams]);
	const selectedAdgroups = useMemo(() => {
		const vs = (searchParams.getAll('adgroup') || []).map((x) => String(x ?? '').trim()).filter(Boolean);
		const single = String(searchParams.get('adgroup') ?? '').trim();
		if (vs.length === 0 && single) vs.push(single);
		return Array.from(new Set(vs));
	}, [searchParams]);

	const [jobState, setJobState] = useState<JobState<AdsCreativeJobData>>({
		status: 'idle',
		message: null,
		data: null,
		error: null,
	});
	const didAutoResetRef = useRef(false);
	const activeJobKeyRef = useRef<string | null>(null);
	const subscribedJobKeyRef = useRef<string | null>(null);
	const [collectingPinned, setCollectingPinned] = useState(false);
	const [creativeValidationByGroup, setCreativeValidationByGroup] = useState<Record<string, 'ok' | 'fix' | 'unknown'>>({});
	const creativeHiddenColumnsKey = `${platform}.ads.creative.hiddenColumns.v1`;
	const [hiddenColumnKeys, setHiddenColumnKeys] = useState<CreativeColumnKey[]>(() => loadHiddenColumnKeys<CreativeColumnKey>(creativeHiddenColumnsKey));
	const creativeTrendMetricStorageKey = `${platform}.ads.creative.trendMetrics.v1`;
	const [leftTrendMetric, setLeftTrendMetric] = useState<AdsPerformanceTrendMetricKey>(() => {
		try {
			const raw = window.localStorage.getItem(creativeTrendMetricStorageKey);
			const parsed = raw ? JSON.parse(raw) : null;
			return String(parsed?.left || 'cost') as AdsPerformanceTrendMetricKey;
		} catch {
			return 'cost';
		}
	});
	const [rightTrendMetric, setRightTrendMetric] = useState<AdsPerformanceTrendMetricKey>(() => {
		try {
			const raw = window.localStorage.getItem(creativeTrendMetricStorageKey);
			const parsed = raw ? JSON.parse(raw) : null;
			return String(parsed?.right || 'revenue') as AdsPerformanceTrendMetricKey;
		} catch {
			return 'revenue';
		}
	});
	const [selectedTrendRowKey, setSelectedTrendRowKey] = useState<string | null>(null);
	const [rangeNotice, setRangeNotice] = useState<string | null>(null);
	const maxCreativeRangeDays = 30;
	const [gfaOperationalFilter, setGfaOperationalFilter] = useState<'all' | 'purchase' | 'high_cost_no_purchase' | 'good_roas' | 'low_ctr'>('all');

	const handleCreativeDateChange = (next: AdsDateState) => {
		const r = normalizeRange(next.range);
		if (rangeLengthDays(r) <= maxCreativeRangeDays) {
			setDateState({ ...next, range: r });
			return;
		}
		const cappedFrom = new Date(r.to);
		cappedFrom.setDate(cappedFrom.getDate() - (maxCreativeRangeDays - 1));
		const capped = { ...next, range: normalizeRange({ from: cappedFrom, to: r.to }) };
		setRangeNotice(
			`소재 분석은 성능과 정확도를 위해 최근 ${maxCreativeRangeDays}일까지만 조회합니다. 선택하신 기간(${toYmd(r.from)} ~ ${toYmd(r.to)}) 중 ${toYmd(capped.range.from)} ~ ${toYmd(capped.range.to)}로 적용했습니다.`,
		);
		setDateState(capped);
		// AdsDateControls도 자체 저장을 수행하므로, 마지막에 제한된 기간을 다시 저장한다.
		window.setTimeout(() => saveAdsDateState(capped), 0);
	};

	useEffect(() => {
		try {
			window.localStorage.setItem(
				creativeTrendMetricStorageKey,
				JSON.stringify({ v: 1, left: leftTrendMetric, right: rightTrendMetric }),
			);
		} catch {
			// ignore
		}
	}, [creativeTrendMetricStorageKey, leftTrendMetric, rightTrendMetric]);

	useEffect(() => {
		let cancelled = false;
		const r = normalizeRange(dateState.range);

		// 요구사항: 메뉴 이동 후 복귀하면 기간은 항상 "전일(어제)"로 복귀
		// (단, 진행 중 수집은 job cache pinning으로 계속 유지된다.)
		if (!didAutoResetRef.current) {
			didAutoResetRef.current = true;
			const y = normalizeRange(defaultYesterdayRange());
			const isYesterday = toYmd(r.from) === toYmd(y.from) && toYmd(r.to) === toYmd(y.to) && dateState.compareMode === 'prev_day';
			if (!isYesterday) {
				setDateState({ range: y, compareMode: 'prev_day' });
				return;
			}
		}

		const prevRange = shiftRange(r, dateState.compareMode);
		const dateFrom = toYmd(r.from);
		const dateTo = toYmd(r.to);
		const prevFrom = toYmd(prevRange.from);
		const prevTo = toYmd(prevRange.to);

		const jobKey = [
			'ads-creative-view',
			props.apiBaseUrl,
			platform,
			dateFrom,
			dateTo,
			prevFrom,
			prevTo,
			dateState.compareMode,
			`scopeC=${selectedCampaigns.join(',')}`,
			`scopeG=${selectedAdgroups.join(',')}`,
			// NOTE: 메뉴 이동 후 복귀해도 "진행 메시지"를 같은 key로 다시 구독할 수 있도록
			// reload/force 같은 화면 내부 tick은 key에 포함하지 않는다.
		].join('|');

		// (중요) 날짜 변경 시 "이전 날짜(어제) 로딩 job"을 붙잡으면,
		// 오늘 화면에서도 어제 데이터가 유지/표시되는 혼선이 생긴다.
		// 따라서: "현재 선택된 날짜 범위"에 해당하는 jobKey만 pinning 대상으로 삼는다.
		const pinPrefix = `ads-creative-view|${props.apiBaseUrl}|${platform}|${dateFrom}|${dateTo}|`;
		const runningKey = adsJobCache.findLatestLoadingKey(pinPrefix);

		// 요구사항(구조):
		// - 사용자가 "수집 중단"을 누르기 전까지, 날짜 변경/메뉴 이동이 있어도 수집을 중단하지 않는다.
		// - 진행 중인 수집이 있으면 jobKey를 고정(pin)해 진행 표시/구독이 끊기지 않도록 한다.
		const activeKey = activeJobKeyRef.current;
		const activeKeyMatchesRange = Boolean(activeKey) && String(activeKey).startsWith(pinPrefix);
		const activeRunning =
			Boolean(runningKey) ||
			(activeKeyMatchesRange ? adsJobCache.getState<any>(activeKey!)?.status === 'loading' : false);
		const jobKeyToUse = runningKey ?? (activeRunning ? activeKey! : jobKey);
		setCollectingPinned(Boolean(runningKey) && jobKeyToUse !== jobKey);
		subscribedJobKeyRef.current = jobKeyToUse;

		const unsub = adsJobCache.subscribe(jobKeyToUse, setJobState as any);

		// 진행 중이면(핀 상태) 새 job을 시작하지 않는다.
		if (runningKey && jobKeyToUse === runningKey) {
			return () => {
				cancelled = true;
				unsub();
			};
		}
		if (activeRunning && jobKeyToUse !== jobKey) {
			return () => {
				cancelled = true;
				unsub();
			};
		}

		activeJobKeyRef.current = jobKeyToUse;
		void adsJobCache.start(jobKeyToUse, async ({ setMessage, signal }) => {
			// NOTE: 기존 데이터가 이미 존재해도 메타(소재명/이미지/상품명)가 비어 있을 수 있어,
			// 사용자가 "새로고침"을 누른 경우 creative는 강제 재수집으로 메타를 채운다.
			const forceCollectRanges = async (ranges: Array<{ label: string; from: string; to: string }>) => {
				const segs = ranges.flatMap((r0) =>
					chunkYmdRange(r0.from, r0.to, 1).map((seg) => ({ ...seg, label: r0.label })),
				);
				const totalDays = Math.max(1, segs.length);
				let doneDays = 0;
				setMessage(`메타 갱신을 위해 재수집 중… (creative) 0/${totalDays}`);
				for (const seg of segs) {
					setMessage(
						`메타 갱신을 위해 재수집 중… (creative) ${Math.min(doneDays, totalDays)}/${totalDays} (${seg.label} ${seg.from})`,
					);
					try {
						await axios.post(
							`${props.apiBaseUrl}${platform === 'gfa' ? '/gfa' : ''}/ads/collect`,
							{
								mode: 'range',
								date_from: seg.from,
								date_to: seg.to,
								kinds: ['creative'],
								campaigns: selectedCampaigns.length ? selectedCampaigns : undefined,
								adgroups: selectedAdgroups.length ? selectedAdgroups : undefined,
								verify_missing: platform === 'sa' ? true : undefined,
								max_retries: platform === 'sa' ? 1 : undefined,
							},
							{ timeout: 1200000, signal: signal as any },
						);
					} catch (e) {
						if (isReportNotReadyError(e)) throw e;
						throw e;
					}
					doneDays += 1;
					setMessage(
						`메타 갱신을 위해 재수집 중… (creative) ${Math.min(doneDays, totalDays)}/${totalDays} (${seg.label} ${seg.from})`,
					);
				}
			};

			try {
				if (forceRecollectTick > 0) {
					if (platform === 'gfa') {
						setMessage('GFA 재수집은 설정 > 데이터 수집의 GFA 성과보고서 작업에서 실행합니다.');
					} else {
						// 메타갱신은 "상단에 설정된 기간(현재기간)"만 강제로 재수집한다.
						// 비교기간(전일/전주 등)은 사용자가 원치 않는 재수집/혼선을 유발할 수 있어 제외한다.
						await forceCollectRanges([{ label: '선택기간', from: dateFrom, to: dateTo }]);
					}
				} else {
					// 실제 수집이 필요한 경우에만 ensureAdsDataMulti 내부 메시지가 "자동 수집 중…"으로 바뀐다.
					// 여기서는 오해를 줄이기 위해 "확인" 문구만 표시한다.
					setMessage('데이터 확인 중… (creative)');
					await ensureAdsDataMulti({
						apiBaseUrl: props.apiBaseUrl,
						kind: 'creative',
						platform,
						ranges: [
							{ from: dateFrom, to: dateTo },
							{ from: prevFrom, to: prevTo },
						],
						setEnsure: (s) => setMessage(s.message),
						scopeCampaigns: selectedCampaigns,
						scopeAdgroups: selectedAdgroups,
						signal,
					});
				}
			} catch (e) {
				// REPORT_NOT_READY는 사용자에게 안내만 하고, 콘솔 Uncaught로 남기지 않도록 여기서 처리한다.
				if (isReportNotReadyError(e)) {
					throw new Error(errorDetailText(e));
				}
				throw e;
			} finally {
				setMessage(null);
			}

			// 소재 분석: 특정 날짜(특히 "오늘")에는 stat-reports가 비어 0행이 될 수 있다.
			// 이 때 프론트가 prev(전일) 메타를 current처럼 재사용하면
			// "오늘 화면인데도 어제 오가닉/품질/평균노출순위가 보이는" 혼선이 생긴다.
			//
			// 따라서:
			// 1) 우선 빠른 경로(includeMetaOnly=false)로 조회
			// 2) current가 0행이면, meta_only 포함(includeMetaOnly=true)으로 1회 재조회해
			//    "오늘 날짜의 row"를 만들어 오가닉(오늘) + 품질/평균(전일 폴백)을 안정적으로 표시한다.
			// NOTE: creatives/daily의 include_meta_only 보강은 "캠페인/그룹 필터"가 있을 때 효과가 크다.
			// (리포트가 0행인 당일에는 rows가 비어 adgroup 목록 추정이 어려움)
			// 현재 UI는 선택 캠페인/그룹을 searchParams로 들고 있으므로,
			// 필터가 1개로 확정된 경우에만 서버 쿼리에도 전달해 보강 정확도를 높인다.
			const campaignParam = selectedCampaigns.length === 1 ? selectedCampaigns[0] : undefined;
			const adgroupParam = selectedAdgroups.length === 1 ? selectedAdgroups[0] : undefined;

			// 필터 옵션(드롭다운)은 전체 데이터에서 추출. 필터 적용 fetch와 분리해야 다중 선택 가능.
			const creativeFetchLimit = 20000;
			const yesterday = toYmd(defaultYesterdayRange().from);
			const [curr0Base, prevBase, optionsRows, creativeInventory, yesterdayStatusRows] = await Promise.all([
				fetchCreativeDaily({ baseUrl: props.apiBaseUrl, dateFrom, dateTo, includeMetaOnly: false, campaign: campaignParam, adgroup: adgroupParam, limit: creativeFetchLimit, platform }),
				fetchCreativeDaily({ baseUrl: props.apiBaseUrl, dateFrom: prevFrom, dateTo: prevTo, includeMetaOnly: false, campaign: campaignParam, adgroup: adgroupParam, limit: creativeFetchLimit, platform }),
				platform === 'gfa'
					? Promise.resolve([] as CreativeDailyRow[])
					: fetchCreativeDaily({ baseUrl: props.apiBaseUrl, dateFrom, dateTo, includeMetaOnly: false, limit: creativeFetchLimit, platform }),
				platform === 'gfa'
					? fetchGfaCreativeInventory({ baseUrl: props.apiBaseUrl, campaign: campaignParam, adgroup: adgroupParam, limit: creativeFetchLimit })
					: Promise.resolve([] as CreativeInventoryRow[]),
				platform === 'gfa'
					? fetchCreativeDaily({ baseUrl: props.apiBaseUrl, dateFrom: yesterday, dateTo: yesterday, includeMetaOnly: false, campaign: campaignParam, adgroup: adgroupParam, limit: creativeFetchLimit, platform })
					: Promise.resolve([] as CreativeDailyRow[]),
			]);
			let currActual = curr0Base;
			if (platform !== 'gfa' && Array.isArray(curr0Base) && curr0Base.length === 0) {
				try {
					setMessage('소재 목록이 비어 메타 기반으로 보강 중… (creative)');
					currActual = await fetchCreativeDaily({ baseUrl: props.apiBaseUrl, dateFrom, dateTo, includeMetaOnly: true, campaign: campaignParam, adgroup: adgroupParam, limit: creativeFetchLimit, platform });
				} finally {
					setMessage(null);
				}
			}
			const currMerged = platform === 'gfa'
				? mergeGfaCreativeInventoryRows(currActual, creativeInventory, dateTo)
				: currActual;
			const prevMerged = platform === 'gfa'
				? mergeGfaCreativeInventoryRows(prevBase, creativeInventory, prevTo)
				: prevBase;
			const curr = platform === 'gfa'
				? applyGfaYesterdayCreativeStatusToRows(currMerged, yesterdayStatusRows)
				: currMerged;
			const prev = platform === 'gfa'
				? applyGfaYesterdayCreativeStatusToRows(prevMerged, yesterdayStatusRows)
				: prevMerged;
			const optionsSourceRows = platform === 'gfa' ? curr : optionsRows;

			type Totals = {
				impressions: number;
				clicks: number;
				cost: number;
				conversions: number;
				revenue: number;
				purchaseConversions: number;
				purchaseRevenue: number;
			};
			const isPowerlinkCreative = (x: CreativeDailyRow): boolean => {
				const adType = String((x as any).ad_type || '').trim();
				const creativeId = String(x.creative_id || '').trim();
				const campaignName = String(x.campaign_name || '').trim();
				return adType === 'POWERLINK_AD' || creativeId.includes('-01-') || campaignName.startsWith('#SA') || campaignName.includes('파워링크');
			};
			const validDisplayKeyword = (x: CreativeDailyRow): string => {
				const keyword = String((x as any).display_keyword || '').trim();
				const lower = keyword.toLowerCase();
				if (!keyword || lower === 'nan' || lower === 'none' || lower === 'null' || keyword === '-') return '';
				if (keyword.includes(' 외 ')) return '';
				return keyword;
			};
			const keyOf = (x: CreativeDailyRow) => {
				const base = `${normKeyPart(x.campaign_name)}||${normKeyPart(x.adgroup_name)}`;
				if (platform === 'gfa') {
					return `${base}||${String(x.creative_id || '').trim()}`;
				}
				if (isPowerlinkCreative(x)) {
					return `${base}||${normKeyPart(validDisplayKeyword(x))}`;
				}
				return `${base}||${String(x.creative_id || '').trim()}`;
			};
			const sumInto = (m: Map<string, Totals>, r: CreativeDailyRow) => {
				if (platform !== 'gfa' && isPowerlinkCreative(r) && !validDisplayKeyword(r)) return;
				const k = keyOf(r);
				const cur = m.get(k) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0, purchaseConversions: 0, purchaseRevenue: 0 };
				cur.impressions += Number(r.impressions) || 0;
				cur.clicks += Number(r.clicks) || 0;
				cur.cost += Number(r.cost) || 0;
				cur.conversions += Number(r.conversions) || 0;
				cur.revenue += Number(r.revenue) || 0;
				cur.purchaseConversions += Number(r.purchase_conversions) || 0;
				cur.purchaseRevenue += Number(r.purchase_revenue) || 0;
				m.set(k, cur);
			};

			const currAgg = new Map<string, Totals>();
			const prevAgg = new Map<string, Totals>();
			for (const r2 of curr) sumInto(currAgg, r2);
			for (const r2 of prev) sumInto(prevAgg, r2);

			const metaByKey = new Map<string, CreativeDailyRow>();
			const metaCurrByKey = new Map<string, CreativeDailyRow>();
			const metaPrevByKey = new Map<string, CreativeDailyRow>();
			for (const r2 of curr) {
				if (platform !== 'gfa' && isPowerlinkCreative(r2) && !validDisplayKeyword(r2)) continue;
				const k = keyOf(r2);
				if (!metaCurrByKey.has(k)) metaCurrByKey.set(k, r2);
			}
			for (const r2 of prev) {
				if (platform !== 'gfa' && isPowerlinkCreative(r2) && !validDisplayKeyword(r2)) continue;
				const k = keyOf(r2);
				if (!metaPrevByKey.has(k)) metaPrevByKey.set(k, r2);
			}
			for (const r2 of [...curr, ...prev]) {
				if (platform !== 'gfa' && isPowerlinkCreative(r2) && !validDisplayKeyword(r2)) continue;
				const k = keyOf(r2);
				if (!metaByKey.has(k)) metaByKey.set(k, r2);
			}

			const keys = new Set<string>([...currAgg.keys(), ...prevAgg.keys()]);
			type CreativeAggRowWithPrevOrganic = CreativeAggRow & { prevOrganicRank?: number | null };
			const rows: CreativeAggRowWithPrevOrganic[] = [];
			for (const k of keys) {
				const meta = metaCurrByKey.get(k) ?? metaByKey.get(k);
				const metaPrev = metaPrevByKey.get(k) ?? null;
				if (!meta) continue;
				const currT = currAgg.get(k) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0, purchaseConversions: 0, purchaseRevenue: 0 };
				const prevT = prevAgg.get(k) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0, purchaseConversions: 0, purchaseRevenue: 0 };
				const currM = computeMetrics(currT);
				const prevM = computeMetrics(prevT);
				const deltas = calcMetricDeltas(currM, prevM);

				const cpa = currT.conversions > 0 ? Math.round(currT.cost / currT.conversions) : 0;
				const prevCpa = prevT.conversions > 0 ? Math.round(prevT.cost / prevT.conversions) : 0;
				const cpaDiff = cpa - prevCpa;
				const cpaPct = prevCpa > 0 ? (cpaDiff / prevCpa) * 100 : null;

				rows.push({
					key: k,
					campaignName: meta.campaign_name,
					adgroupName: meta.adgroup_name,
					creativeId: meta.creative_id,
					adType: meta.ad_type ?? null,
					creativeName: meta.creative_name,
					displayKeyword: (meta as any).display_keyword ?? null,
					productTitle: meta.product_title ?? null,
					imageUrl: meta.image_url ?? null,
					currentBid: meta.current_bid ?? null,
					prevCurrentBid: metaPrev?.current_bid ?? null,
					qualityIndex: meta.quality_index ?? null,
					prevQualityIndex: metaPrev?.quality_index ?? null,
					avgRank: meta.avg_rank ?? null,
					prevAvgRank: metaPrev?.avg_rank ?? null,
					organicKeyword: meta.organic_keyword ?? null,
					organicRank: meta.organic_rank ?? null,
					prevOrganicRank: metaPrev?.organic_rank ?? null,
					organicRankSource: meta.organic_rank_source ?? null,
					organicRankDate: (meta as any).organic_rank_date ?? null,
					prevOrganicRankDate: (metaPrev as any)?.organic_rank_date ?? null,
					matchStatus: meta.match_status ?? null,
					matchRule: meta.match_rule ?? null,
					matchedProductUrl: meta.matched_product_url ?? null,
					matchedProductTitle: meta.matched_product_title ?? null,
					metrics: currM,
					prevMetrics: prevM,
					deltas,
					purchaseMetrics: { conversions: currT.purchaseConversions, revenue: currT.purchaseRevenue },
					prevPurchaseMetrics: { conversions: prevT.purchaseConversions, revenue: prevT.purchaseRevenue },
					cpa,
					prevCpa,
					cpaDiff,
					cpaPct,
				});
			}

			// 그룹핑: (캠페인, 광고그룹) 단위
			const byGroup = new Map<string, { title: string; rows: CreativeAggRow[]; cost: number }>();
			for (const rr of rows) {
				const gk = `${normKeyPart(rr.campaignName)}||${normKeyPart(rr.adgroupName)}`;
				const g = byGroup.get(gk) ?? { title: `${rr.campaignName} / ${rr.adgroupName}`, rows: [], cost: 0 };
				g.rows.push(rr);
				g.cost += rr.metrics.cost;
				byGroup.set(gk, g);
			}
			const groups = [...byGroup.entries()]
				.map(([gk, g]) => ({
					key: gk,
					title: g.title,
					rows: g.rows.sort((a, b) => b.metrics.cost - a.metrics.cost),
					cost: g.cost,
				}))
				.sort((a, b) => b.cost - a.cost)
				.map(({ cost, ...rest }) => rest);

			// (선택된 필터가 있을 때만) 해당 범위의 정합성(dry-run)을 조회해 그룹별 상태를 만든다.
			try {
				if (platform !== 'gfa' && (selectedCampaigns.length > 0 || selectedAdgroups.length > 0)) {
					const body: any = {
						date_from: dateFrom,
						date_to: dateTo,
						campaigns: selectedCampaigns.length ? selectedCampaigns : undefined,
						adgroups: selectedAdgroups.length ? selectedAdgroups : undefined,
						dry_run: true,
					};
					const res = await axios.post(`${props.apiBaseUrl}/ads/validate-fix`, body, { timeout: 1200000 });
					const m: Record<string, 'ok' | 'fix' | 'unknown'> = {};
					for (const day of (res?.data?.processed || []) as any[]) {
						for (const it of (day?.items || []) as any[]) {
							const camp = String(it?.campaign || '').trim();
							const grp = String(it?.adgroup || '').trim();
							if (!camp || !grp) continue;
							const gk = `${camp}||${grp}`;
							const expected = it?.expected_count;
							const missing = Number(it?.missing_count || 0);
							if (expected == null) {
								if (!m[gk]) m[gk] = 'unknown';
							} else if (missing > 0) {
								m[gk] = 'fix';
							} else if (!m[gk]) {
								m[gk] = 'ok';
							}
						}
					}
					if (!cancelled) setCreativeValidationByGroup(m);
				} else {
					if (!cancelled) setCreativeValidationByGroup({});
				}
			} catch {
				// ignore
			}

			// 드롭다운 옵션: 전체 데이터에서 추출 (필터 선택과 무관)
			const allCampaigns = Array.from(new Set((optionsSourceRows || []).map((r) => String(r.campaign_name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));
			const allAdgroupsByCampaign: Record<string, string[]> = {};
			for (const r of optionsSourceRows || []) {
				const c = String(r.campaign_name || '').trim();
				const a = String(r.adgroup_name || '').trim();
				if (!c || !a) continue;
				if (!allAdgroupsByCampaign[c]) allAdgroupsByCampaign[c] = [];
				if (!allAdgroupsByCampaign[c]!.includes(a)) allAdgroupsByCampaign[c]!.push(a);
			}
			for (const k of Object.keys(allAdgroupsByCampaign)) {
				allAdgroupsByCampaign[k] = allAdgroupsByCampaign[k]!.sort((a, b) => a.localeCompare(b, 'ko'));
			}

			const trendPoints = buildAdsPerformanceTrend(currActual);
			const trendByRowKey = buildAdsPerformanceTrendByRowKey('creative', currActual);
			return { groups, allCampaigns, allAdgroupsByCampaign, trendPoints, trendByRowKey };
		}).catch(() => {});

		return () => {
			cancelled = true;
			unsub();
		};
	}, [props.apiBaseUrl, platform, dateState.range, dateState.compareMode, reloadTick, forceRecollectTick, selectedCampaigns, selectedAdgroups]);

	useEffect(() => {
		const active = activeJobKeyRef.current;
		if (!active) return;
		const st = adsJobCache.getState<any>(active);
		if (st?.status !== 'loading') {
			activeJobKeyRef.current = null;
			setCollectingPinned(false);
		}
	}, [jobState.status, jobState.data, jobState.message, jobState.error]);

	const groups = jobState.data?.groups ?? [];
	const allCampaigns = jobState.data?.allCampaigns ?? [];
	const allAdgroupsByCampaign = (jobState.data?.allAdgroupsByCampaign ?? {}) as Record<string, string[]>;
	const trendPoints = jobState.data?.trendPoints ?? [];
	const trendByRowKey = (jobState.data?.trendByRowKey ?? {}) as Record<string, AdsPerformanceTrendPoint[]>;
	const campaignOptions = useMemo(() => allCampaigns, [allCampaigns]);
	const adgroupOptions = useMemo(() => {
		const campSet = new Set(selectedCampaigns);
		const s = new Set<string>();
		if (campSet.size > 0) {
			for (const c of campSet) {
				const adgs = allAdgroupsByCampaign[c] ?? [];
				for (const a of adgs) s.add(a);
			}
		} else {
			for (const adgs of Object.values(allAdgroupsByCampaign)) for (const a of adgs) s.add(a);
		}
		return Array.from(s).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
	}, [allAdgroupsByCampaign, selectedCampaigns]);

	const filteredGroups = useMemo(() => {
		const campSet = new Set(selectedCampaigns);
		const grpSet = new Set(selectedAdgroups);
		const pUrl = baseUrl(productUrlFilter);
		const pTitle = productTitleFilter;
		const passesGfaOperationalFilter = (r: CreativeAggRow): boolean => {
			if (platform !== 'gfa' || gfaOperationalFilter === 'all') return true;
			const purchaseConversions = Number(r.purchaseMetrics?.conversions ?? 0);
			const purchaseRevenue = Number(r.purchaseMetrics?.revenue ?? 0);
			const cost = Number(r.metrics.cost || 0);
			const impressions = Number(r.metrics.impressions || 0);
			const ctr = Number(r.metrics.ctr || 0);
			const purchaseRoas = cost > 0 ? (purchaseRevenue / cost) * 100 : 0;
			if (gfaOperationalFilter === 'purchase') return purchaseConversions > 0 || purchaseRevenue > 0;
			if (gfaOperationalFilter === 'high_cost_no_purchase') return cost >= 10000 && purchaseConversions <= 0 && purchaseRevenue <= 0;
			if (gfaOperationalFilter === 'good_roas') return purchaseRevenue > 0 && purchaseRoas >= 300;
			if (gfaOperationalFilter === 'low_ctr') return impressions >= 1000 && ctr < 0.5;
			return true;
		};
		return (groups || [])
			.map((g) => {
				const rows = (g.rows || []).filter((r) => {
					const c = String(r.campaignName || '').trim();
					const a = String(r.adgroupName || '').trim();
					if (campSet.size > 0 && !campSet.has(c)) return false;
					if (grpSet.size > 0 && !grpSet.has(a)) return false;

					// A-1 연동: 특정 상품으로 필터링(가능한 경우 matched_product_url 우선)
					if (pUrl) {
						const mu = baseUrl((r as any).matchedProductUrl);
						if (mu && mu !== pUrl) return false;
						// matched URL이 비어 있으면 title 기반으로 fallback
						if (!mu && pTitle) {
							const t = String((r as any).matchedProductTitle ?? (r as any).productTitle ?? '').trim();
							if (t && !t.includes(pTitle)) return false;
						}
					} else if (pTitle) {
						const t = String((r as any).matchedProductTitle ?? (r as any).productTitle ?? '').trim();
						if (t && !t.includes(pTitle)) return false;
						if (!t) return false;
					}
					if (!passesGfaOperationalFilter(r)) return false;
					return true;
				});
				if (rows.length === 0) return null;
				return { ...g, rows };
			})
			.filter(Boolean) as Array<{ key: string; title: string; rows: CreativeAggRow[] }>;
	}, [groups, selectedCampaigns, selectedAdgroups, productTitleFilter, productUrlFilter, platform, gfaOperationalFilter]);

	const gfaOperationalSummary = useMemo(() => {
		if (platform !== 'gfa') return null;
		const sourceGroups = groups || [];
		const allRows = sourceGroups.flatMap((group) => group.rows || []);
		const campaignCount = new Set(allRows.map((row) => String(row.campaignName || '').trim()).filter(Boolean)).size;
		const adgroupCount = sourceGroups.length;
		const creativeCount = allRows.length;
		const totalCost = allRows.reduce((acc, row) => acc + Number(row.metrics.cost || 0), 0);
		const totalPurchaseRevenue = allRows.reduce((acc, row) => acc + Number(row.purchaseMetrics?.revenue || 0), 0);
		const totalPurchaseConversions = allRows.reduce((acc, row) => acc + Number(row.purchaseMetrics?.conversions || 0), 0);
		const highCostNoPurchase = allRows.filter((row) => Number(row.metrics.cost || 0) >= 10000 && Number(row.purchaseMetrics?.revenue || 0) <= 0 && Number(row.purchaseMetrics?.conversions || 0) <= 0);
		const topGroup = sourceGroups
			.map((group) => ({
				title: group.title,
				cost: group.rows.reduce((acc, row) => acc + Number(row.metrics.cost || 0), 0),
				revenue: group.rows.reduce((acc, row) => acc + Number(row.purchaseMetrics?.revenue || 0), 0),
			}))
			.sort((a, b) => b.cost - a.cost)[0] || null;
		const topCreative = [...allRows]
			.sort((a, b) => Number(b.purchaseMetrics?.revenue || 0) - Number(a.purchaseMetrics?.revenue || 0))[0] || null;
		return {
			campaignCount,
			adgroupCount,
			creativeCount,
			totalCost,
			totalPurchaseRevenue,
			totalPurchaseConversions,
			totalPurchaseRoas: totalCost > 0 ? (totalPurchaseRevenue / totalCost) * 100 : 0,
			highCostNoPurchaseCount: highCostNoPurchase.length,
			topGroup,
			topCreative,
		};
	}, [groups, platform]);

	const visibleTrendRowKeys = useMemo(
		() => filteredGroups.flatMap((group) => group.rows.map((row) => row.key)),
		[filteredGroups],
	);
	const hasPurchaseMetrics = useMemo(
		() => filteredGroups.some((group) => group.rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics)),
		[filteredGroups],
	);
	const filteredTrendPoints = useMemo(() => {
		if (visibleTrendRowKeys.length === 0) return [];
		const series = visibleTrendRowKeys
			.map((key) => trendByRowKey[key])
			.filter((points): points is AdsPerformanceTrendPoint[] => Array.isArray(points) && points.length > 0);
		if (series.length === 0) return trendPoints;
		return mergeAdsPerformanceTrendPoints(series);
	}, [trendByRowKey, trendPoints, visibleTrendRowKeys]);
	const trendMetricOptions = useMemo(() => getAdsTrendMetricOptions(hasPurchaseMetrics), [hasPurchaseMetrics]);

	useEffect(() => {
		if (filteredGroups.length === 0 && groups.length === 0) return;
		const optionKeys = new Set(trendMetricOptions.map((option) => option.key));
		if (!optionKeys.has(leftTrendMetric)) {
			const fallback = optionKeys.has('cost')
				? 'cost'
				: trendMetricOptions[0]?.key ?? 'cost';
			setLeftTrendMetric(fallback);
			return;
		}
		if (!optionKeys.has(rightTrendMetric)) {
			const fallback = optionKeys.has('purchase_revenue')
				? 'purchase_revenue'
				: optionKeys.has('revenue')
					? 'revenue'
					: pickAlternateTrendMetric(leftTrendMetric, trendMetricOptions);
			setRightTrendMetric(fallback);
		}
	}, [filteredGroups.length, groups.length, leftTrendMetric, rightTrendMetric, trendMetricOptions]);

	const changeLeftTrendMetric = (next: AdsPerformanceTrendMetricKey) => {
		setLeftTrendMetric(next);
		if (next === rightTrendMetric) {
			setRightTrendMetric(pickAlternateTrendMetric(next, trendMetricOptions));
		}
	};

	const changeRightTrendMetric = (next: AdsPerformanceTrendMetricKey) => {
		setRightTrendMetric(next);
		if (next === leftTrendMetric) {
			setLeftTrendMetric(pickAlternateTrendMetric(next, trendMetricOptions));
		}
	};

	const selectedTrendLabel = useMemo(() => {
		if (!selectedTrendRowKey) return null;
		const selectedRow = filteredGroups.flatMap((group) => group.rows).find((row) => row.key === selectedTrendRowKey);
		if (!selectedRow) return null;
		const creativeName = String(selectedRow.creativeName || '').trim();
		if (creativeName) return creativeName;
		const productTitle = String(selectedRow.productTitle || '').trim();
		if (productTitle) return productTitle;
		const creativeId = String(selectedRow.creativeId || '').trim();
		return creativeId || null;
	}, [filteredGroups, selectedTrendRowKey]);

	const activeTrendPoints = useMemo(() => {
		if (!selectedTrendRowKey) return filteredTrendPoints;
		return trendByRowKey[selectedTrendRowKey] ?? filteredTrendPoints;
	}, [filteredTrendPoints, selectedTrendRowKey, trendByRowKey]);

	useEffect(() => {
		if (!selectedTrendRowKey) return;
		if (visibleTrendRowKeys.includes(selectedTrendRowKey) && trendByRowKey[selectedTrendRowKey]) return;
		setSelectedTrendRowKey(null);
	}, [selectedTrendRowKey, trendByRowKey, visibleTrendRowKeys]);

	useEffect(() => {
		saveHiddenColumnKeys(creativeHiddenColumnsKey, hiddenColumnKeys);
	}, [creativeHiddenColumnsKey, hiddenColumnKeys]);

	const creativeColumnOptions = useMemo<AdsColumnSettingOption[]>(() => {
		const sourceGroups = filteredGroups.length > 0 ? filteredGroups : groups;
		const hasShoppingMode = sourceGroups.some((group) => {
			const first = group.rows?.[0];
			const adType = String(first?.adType || '').toUpperCase();
			const campName = String(first?.campaignName || '');
			return !(adType.includes('POWERLINK') || campName.startsWith('SA_') || campName.includes('파워링크'));
		});
		const hasPurchaseMetrics = sourceGroups.some((group) =>
			group.rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics),
		);
		const keys: CreativeColumnKey[] = [
			'creative',
			...(platform === 'gfa' ? [] : (['bid', 'quality', 'avgRank'] as CreativeColumnKey[])),
			...(platform === 'gfa' ? [] : hasShoppingMode ? (['organicRank'] as CreativeColumnKey[]) : []),
			'impressions',
			'clicks',
			'ctr',
			'cpc',
			'cost',
			'conversions',
			...(hasPurchaseMetrics ? (['purchase_conversions'] as CreativeColumnKey[]) : []),
			...(hasPurchaseMetrics ? (['purchase_cvr'] as CreativeColumnKey[]) : []),
			'cvr',
			'revenue',
			...(hasPurchaseMetrics ? (['purchase_revenue'] as CreativeColumnKey[]) : []),
			...(hasPurchaseMetrics ? (['purchase_roas'] as CreativeColumnKey[]) : []),
			'roas',
			'cpa',
		];
		const labelMap: Record<CreativeColumnKey, string> = {
			creative: platform === 'gfa' ? '소재명' : '소재명/키워드',
			bid: '현재입찰가(CPC)',
			quality: '품질/연관지수',
			avgRank: '평균노출순위/클릭기대지수',
			organicRank: '오가닉순위',
			impressions: '노출수',
			clicks: '클릭수',
			ctr: '클릭율(%)',
			cpc: '평균클릭비용',
			cost: '총비용',
			conversions: hasPurchaseMetrics ? '총전환수' : '전환수',
			purchase_conversions: '구매전환수',
			purchase_cvr: '구매전환율(%)',
			cvr: '전환율(%)',
			revenue: hasPurchaseMetrics ? '총전환매출액' : '전환매출액',
			purchase_revenue: '구매전환매출액',
			purchase_roas: '구매전환수익율(%)',
			roas: '광고수익율(%)',
			cpa: '전환당비용',
		};
		return keys.map((key) => ({
			key,
			label: labelMap[key],
			group: ['creative', 'bid', 'quality', 'avgRank', 'organicRank'].includes(key) ? '기본 정보' : '성과 지표',
		}));
	}, [filteredGroups, groups]);

	const creativeVisibleColumnKeys = useMemo(
		() => selectedKeysFromHidden(
			creativeColumnOptions.map((option) => option.key as CreativeColumnKey),
			hiddenColumnKeys,
		),
		[creativeColumnOptions, hiddenColumnKeys],
	);

	const updateSelected = (key: 'campaign' | 'adgroup', nextVals: string[]) => {
		const next = new URLSearchParams(searchParams);
		next.delete(key);
		for (const v of nextVals) next.append(key, v);
		setSearchParams(next, { replace: true } as any);
	};

	const clearFilters = () => {
		const next = new URLSearchParams(searchParams);
		next.delete('campaign');
		next.delete('adgroup');
		next.delete('product');
		next.delete('product_url');
		if (platform === 'gfa') setGfaOperationalFilter('all');
		setSearchParams(next, { replace: true } as any);
	};

	const scopedCampaign = selectedCampaigns.length === 1 ? selectedCampaigns[0] : null;
	const scopedAdgroup = selectedAdgroups.length === 1 ? selectedAdgroups[0] : null;
	// 요구사항: "필터가 소재(=광고그룹) 1개만 있을 때"만 키워드 인사이트 버튼 활성화
	// - 1) 광고그룹을 1개 직접 선택한 경우
	// - 2) (선택이 없더라도) 캠페인 필터 등으로 광고그룹 옵션이 1개로 축소된 경우
	const keywordInsightsAdgroup = useMemo(() => {
		if (selectedAdgroups.length === 1) return selectedAdgroups[0]!;
		if (selectedAdgroups.length === 0 && adgroupOptions.length === 1) return adgroupOptions[0]!;
		return null;
	}, [selectedAdgroups, adgroupOptions]);

	const extractKeywordFromGroupName = (groupName: string): string | null => {
		// 예: "#PC_염색약_새치염색약_TEST" -> "새치염색약"
		// - 쇼핑검색 표준은 "#PC/#MO_염색약_{키워드}_..." 이므로 "염색약" 바로 다음 토큰을 우선 사용한다.
		// - 과거 그룹명은 마지막 의미 토큰을 fallback으로 사용한다.
		const s = String(groupName || '').trim().replace(/^#+/, '').trim();
		if (!s) return null;
		const parts = s.split('_').map((x) => String(x || '').trim()).filter(Boolean);
		if (parts.length === 0) return null;
		const idx = parts.findIndex((x) => x === '염색약');
		if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]!;
		const suffixWords = new Set(['test', 'TEST', '테스트', '운영', '확장', '모니터링']);
		for (let i = parts.length - 1; i >= 0; i -= 1) {
			const p = parts[i]!;
			if (suffixWords.has(p)) continue;
			if (/^\d+$/.test(p)) continue;
			return p;
		}
		return null;
	};

	const openKeywordInsightsForCurrentGroup = (): void => {
		const grp = String(keywordInsightsAdgroup || '').trim();
		if (!grp) {
			try { window.alert('광고그룹(소재 그룹) 필터가 1개일 때만 사용할 수 있습니다.\n필터에서 광고그룹을 1개로 좁혀주세요.'); } catch {}
			return;
		}
		const kw = extractKeywordFromGroupName(grp);
		if (!kw) {
			try { window.alert(`그룹명에서 키워드를 추출하지 못했습니다.\n그룹명: ${grp}`); } catch {}
			return;
		}
		setKeywordInsightsSeed(kw);
		setKeywordInsightsOpen(true);
	};

	const handleDownloadCreativeExcel = async (): Promise<void> => {
		const r = normalizeRange(dateState.range);
		const dateFrom = toYmd(r.from);
		const dateTo = toYmd(r.to);
		if (filteredGroups.length === 0 || !filteredGroups.some((group) => group.rows.length > 0)) {
			try { window.alert('다운로드할 표 데이터가 없습니다.'); } catch {}
			return;
		}
		const metaRows: Array<Record<string, unknown>> = [
			{ 항목: '화면', 값: '소재 분석' },
			{ 항목: '기간', 값: `${dateFrom} ~ ${dateTo}` },
			{ 항목: '캠페인 필터', 값: selectedCampaigns.length > 0 ? selectedCampaigns.join(', ') : '전체' },
			{ 항목: '광고그룹 필터', 값: selectedAdgroups.length > 0 ? selectedAdgroups.join(', ') : '전체' },
			{ 항목: '상품 필터', 값: productTitleFilter || productUrlFilter || '없음' },
			{ 항목: '생성 시각', 값: new Date().toLocaleString() },
		];
		const uiSheet = creativeGroupsToUiExcelSheet({
			title: '소재 분석',
			period: `${dateFrom} ~ ${dateTo}`,
			groups: filteredGroups,
			columnKeys: creativeVisibleColumnKeys,
		});
		await downloadExcelWorkbook({
			fileName: `소재_분석_${dateFrom}_${dateTo}.xlsx`,
			sheets: [
				{ name: '표', aoa: uiSheet.aoa, cols: uiSheet.cols, merges: uiSheet.merges },
				{ name: '조건', rows: metaRows },
			],
		});
	};

	const handleUpload = async (): Promise<void> => {
		if (!uploadFile) {
			setUploadMsg('파일을 선택해 주세요. (CSV/XLSX)');
			return;
		}
		setUploading(true);
		setUploadMsg(null);
		setUploadDetails(null);
		try {
			const form = new FormData();
			form.append('file', uploadFile);
			const res = await axios.post(`${props.apiBaseUrl}/ads/creatives/upload`, form, {
				headers: { 'Content-Type': 'multipart/form-data' },
				timeout: 1200000,
			});
			const j = res?.data as any;
			const filename = String(j?.filename ?? uploadFile?.name ?? '');
			const dates = Array.isArray(j?.dates) ? j.dates : [];
			const processed = Array.isArray(j?.processed_dates) ? j.processed_dates : dates;
			const skipped = Array.isArray(j?.skipped_dates) ? j.skipped_dates : [];
			const derivedDates = Array.isArray(j?.derived_recomputed_dates) ? j.derived_recomputed_dates : [];
			const total = Number(j?.inserted_total ?? 0) || 0;
			setUploadDetails({
				filename,
				processedDates: processed,
				skippedDates: skipped,
				insertedTotal: total,
				derivedRecomputedDates: derivedDates,
			});
			setUploadMsg(
				`저장 완료(DB 반영): 처리 ${processed.length}일 · 스킵 ${skipped.length}일 · upsert ${total}건 · 오가닉 반영 ${derivedDates.length}일`,
			);
			setUploadButtonState('saved');
			setUploadSaved(true);
			window.setTimeout(() => setUploadButtonState('idle'), 3500);
			// 같은 파일도 다시 선택/업로드할 수 있도록 입력을 리셋한다.
			setUploadFile(null);
			setUploadFileInputKey((x) => x + 1);
			// 업로드 반영 후 화면 갱신
			adsJobCache.invalidate(`ads-creative-view|${props.apiBaseUrl}|${platform}|`);
			setReloadTick((x) => x + 1);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '업로드에 실패했습니다.';
			setUploadMsg(String(msg));
			setUploadSaved(false);
			setUploadDetails(null);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div className="space-y-3">
			<AdsDateControls value={dateState} onChange={handleCreativeDateChange} />
			{rangeNotice ? (
				<div className="modal-backdrop" role="dialog" aria-label="소재 분석 기간 안내">
					<div className="modal-card" style={{ maxWidth: 520 }}>
						<div className="modal-header">
							<div className="modal-title">소재 분석 기간 안내</div>
							<button type="button" className="btn-ghost" onClick={() => setRangeNotice(null)}>
								닫기
							</button>
						</div>
						<div className="modal-body" style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
							{rangeNotice}
						</div>
						<div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end' }}>
							<button type="button" className="btn-primary" onClick={() => setRangeNotice(null)}>
								확인
							</button>
						</div>
					</div>
				</div>
			) : null}
			<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
					<div style={{ fontSize: 12, fontWeight: 900 }}>필터</div>
					{scopedCampaign || scopedAdgroup ? (
						<div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
							{scopedCampaign ? (
								<button
									type="button"
									className="btn-ghost"
									style={{ fontSize: 11, padding: '2px 6px', color: '#93c5fd' }}
									onClick={() => navigate(`${routeBase}/campaigns`)}
									title="캠페인 분석으로 이동"
								>
									{scopedCampaign}
								</button>
							) : null}
							{scopedCampaign && scopedAdgroup ? <span style={{ color: '#64748b' }}>›</span> : null}
							{scopedAdgroup ? (
								<button
									type="button"
									className="btn-ghost"
									style={{ fontSize: 11, padding: '2px 6px', color: '#93c5fd' }}
									onClick={() => {
										const q = new URLSearchParams();
										if (scopedCampaign) q.set('campaign', scopedCampaign);
										navigate(`${routeBase}/adgroups?${q.toString()}`);
									}}
									title="광고 그룹 분석으로 이동"
								>
									{scopedAdgroup}
								</button>
							) : null}
						</div>
					) : null}
					<MultiSelectDropdown
						id="campaign"
						label="캠페인"
						options={campaignOptions}
						selected={selectedCampaigns}
						placeholder="캠페인 전체"
						onChange={(v) => updateSelected('campaign', v)}
						open={openDropdown === 'campaign'}
						setOpen={(v) => setOpenDropdown(v ? 'campaign' : null)}
					/>
					<MultiSelectDropdown
						id="adgroup"
						label="광고그룹"
						options={adgroupOptions}
						selected={selectedAdgroups}
						placeholder="광고그룹 전체"
						onChange={(v) => updateSelected('adgroup', v)}
						open={openDropdown === 'adgroup'}
						setOpen={(v) => setOpenDropdown(v ? 'adgroup' : null)}
					/>
					{platform === 'gfa' ? (
						<div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
							<span style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8' }}>운영 필터</span>
							{([
								['all', '전체'],
								['purchase', '구매 있음'],
								['high_cost_no_purchase', '고비용 무구매'],
								['good_roas', '우수 ROAS'],
								['low_ctr', '저CTR'],
							] as const).map(([key, label]) => (
								<button
									key={key}
									type="button"
									className={gfaOperationalFilter === key ? 'btn-primary' : 'btn-ghost'}
									style={{ fontSize: 11, padding: '2px 6px' }}
									onClick={() => setGfaOperationalFilter(key)}
								>
									{label}
								</button>
							))}
						</div>
					) : null}
					{(productTitleFilter || productUrlFilter) ? (
						<button
							type="button"
							className="btn-ghost"
							style={{ fontSize: 11, padding: '2px 6px', color: '#bbf7d0' }}
							onClick={() => {
								const next = new URLSearchParams(searchParams);
								next.delete('product');
								next.delete('product_url');
								setSearchParams(next, { replace: true } as any);
							}}
							title="상품 필터(연동) 해제"
						>
							상품: {productTitleFilter || baseUrl(productUrlFilter)}
						</button>
					) : null}
					{(selectedCampaigns.length > 0 || selectedAdgroups.length > 0 || productTitleFilter || productUrlFilter || (platform === 'gfa' && gfaOperationalFilter !== 'all')) ? (
						<button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={clearFilters}>
							초기화
						</button>
					) : null}
				</div>
				<div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
					<button
						type="button"
						className="btn-ghost"
						onClick={() => setColumnSettingsOpen(true)}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 900,
							cursor: 'pointer',
							whiteSpace: 'nowrap',
						}}
					>
						사용자 설정
					</button>
					<button
						type="button"
						className="btn-ghost"
						onClick={() => void handleDownloadCreativeExcel()}
						disabled={jobState.status === 'loading' && filteredGroups.length === 0}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 900,
							cursor: jobState.status === 'loading' && filteredGroups.length === 0 ? 'default' : 'pointer',
							whiteSpace: 'nowrap',
						}}
						title="현재 필터와 표시 컬럼 기준으로 소재 분석 표를 Excel 파일로 다운로드합니다."
					>
						엑셀 다운로드
					</button>
					{platform !== 'gfa' ? (
						<button
							type="button"
							className="btn-ghost"
							onClick={openKeywordInsightsForCurrentGroup}
							disabled={!keywordInsightsAdgroup}
							title={keywordInsightsAdgroup ? '현재 필터(광고그룹 1개) 키워드로 키워드 인사이트를 엽니다.' : '광고그룹(소재 그룹) 필터가 1개일 때만 활성화됩니다.'}
							style={{
								background: 'rgba(2,6,23,0.45)',
								border: '1px solid rgba(148,163,184,0.18)',
								color: '#93c5fd',
								borderRadius: 10,
								padding: '6px 10px',
								fontSize: 12,
								fontWeight: 900,
								cursor: keywordInsightsAdgroup ? 'pointer' : 'default',
								whiteSpace: 'nowrap',
							}}
						>
							키워드 인사이트
						</button>
					) : null}
					{jobState.status === 'loading' ? (
						<button
							type="button"
							onClick={() => {
								const k = subscribedJobKeyRef.current;
								if (!k) return;
								adsJobCache.cancel(k);
							}}
							style={{
								background: 'rgba(248,113,113,0.12)',
								border: '1px solid rgba(248,113,113,0.35)',
								color: '#fecaca',
								borderRadius: 10,
								padding: '6px 10px',
								fontSize: 12,
								fontWeight: 900,
								cursor: 'pointer',
								whiteSpace: 'nowrap',
							}}
							title="현재 진행 중인 자동 수집을 중단합니다. (중단 버튼을 누르기 전까지는 기간 변경/메뉴 이동으로 수집이 중단되지 않습니다.)"
						>
							수집 중단
						</button>
					) : null}
					{platform !== 'gfa' ? (
						<button
							type="button"
							disabled={uploading}
							onClick={() => {
								setUploadMsg(null);
								setUploadFile(null);
								setUploadFileInputKey((x) => x + 1);
								setUploadSaved(false);
								setUploadDetails(null);
								setUploadOpen(true);
							}}
							style={{
								background: uploadButtonState === 'saved' ? 'rgba(34,197,94,0.18)' : 'rgba(2,6,23,0.45)',
								border: uploadButtonState === 'saved' ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(148,163,184,0.18)',
								color: uploadButtonState === 'saved' ? '#86efac' : '#e5e7eb',
								borderRadius: 10,
								padding: '6px 10px',
								fontSize: 12,
								fontWeight: 900,
								cursor: uploading ? 'default' : 'pointer',
								whiteSpace: 'nowrap',
							}}
							title="네이버 광고 관리자에서 내려받은 '소재 보고서'를 업로드해 평균노출순위를 보강합니다."
						>
							{uploadButtonState === 'saved' ? '저장완료' : '소재 보고서 업로드'}
						</button>
					) : null}
					<button
						type="button"
						onClick={() => {
							adsJobCache.invalidate(`ads-creative-view|${props.apiBaseUrl}|${platform}|`);
							setForceRecollectTick((x) => x + 1);
							setReloadTick((x) => x + 1);
						}}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 900,
							cursor: 'pointer',
							whiteSpace: 'nowrap',
						}}
					>
						{platform === 'gfa' ? '새로고침' : '새로고침(메타갱신)'}
					</button>
				</div>
			</div>

			{jobState.message ? <ProgressCard message={jobState.message} /> : null}
			{jobState.error ? (
				<div className="card" style={{ borderColor: 'rgba(248,113,113,0.55)' }}>
					<div style={{ fontSize: 12, color: '#fecaca' }}>{jobState.error}</div>
				</div>
			) : null}
			{gfaOperationalSummary ? (
				<div className="card" style={{ display: 'grid', gap: 12, borderColor: 'rgba(34,197,94,0.26)', background: 'rgba(15,23,42,0.72)' }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
						<div>
							<div className="card-title">GFA 운영 비교 요약</div>
							<div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
								현재 기간/필터 기준으로 캠페인 안의 광고그룹과 소재를 비교합니다. “고비용 무구매” 소재는 우선 점검 대상입니다.
							</div>
						</div>
						<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
							<span style={badgeStyle('muted')}>캠페인 {gfaOperationalSummary.campaignCount.toLocaleString()}</span>
							<span style={badgeStyle('muted')}>그룹 {gfaOperationalSummary.adgroupCount.toLocaleString()}</span>
							<span style={badgeStyle('muted')}>소재 {gfaOperationalSummary.creativeCount.toLocaleString()}</span>
							<span style={badgeStyle(gfaOperationalSummary.highCostNoPurchaseCount > 0 ? 'warn' : 'ok')}>
								고비용 무구매 {gfaOperationalSummary.highCostNoPurchaseCount.toLocaleString()}
							</span>
						</div>
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
						<div style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 12, padding: 10 }}>
							<div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 900 }}>총비용</div>
							<div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 900 }}>{formatWon(gfaOperationalSummary.totalCost)}</div>
						</div>
						<div style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 12, padding: 10 }}>
							<div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 900 }}>구매/구매매출</div>
							<div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 900 }}>
								{formatInt(gfaOperationalSummary.totalPurchaseConversions)}건 · {formatWon(gfaOperationalSummary.totalPurchaseRevenue)}
							</div>
						</div>
						<div style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 12, padding: 10 }}>
							<div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 900 }}>구매 ROAS</div>
							<div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 900 }}>{formatPct(gfaOperationalSummary.totalPurchaseRoas)}</div>
						</div>
						<div style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 12, padding: 10 }}>
							<div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 900 }}>비용 최상위 그룹</div>
							<div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 900, lineHeight: 1.45 }}>
								{gfaOperationalSummary.topGroup?.title || '-'}
							</div>
							<div style={{ fontSize: 12, color: '#94a3b8' }}>
								{gfaOperationalSummary.topGroup ? `${formatWon(gfaOperationalSummary.topGroup.cost)} · 매출 ${formatWon(gfaOperationalSummary.topGroup.revenue)}` : ''}
							</div>
						</div>
						<div style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: 12, padding: 10 }}>
							<div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 900 }}>구매매출 최상위 소재</div>
							<div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 900, lineHeight: 1.45 }}>
								{gfaOperationalSummary.topCreative?.creativeName || gfaOperationalSummary.topCreative?.creativeId || '-'}
							</div>
							<div style={{ fontSize: 12, color: '#94a3b8' }}>
								{gfaOperationalSummary.topCreative ? `${formatWon(Number(gfaOperationalSummary.topCreative.purchaseMetrics?.revenue || 0))} · 비용 ${formatWon(gfaOperationalSummary.topCreative.metrics.cost)}` : ''}
							</div>
						</div>
					</div>
				</div>
			) : null}
			<AdsColumnSettingsModal
				open={columnSettingsOpen}
				title="소재 분석"
				options={creativeColumnOptions}
				selectedKeys={creativeVisibleColumnKeys}
				onChange={(nextSelectedKeys) => {
					setHiddenColumnKeys(
						hiddenKeysFromSelected(
							creativeColumnOptions.map((option) => option.key as CreativeColumnKey),
							nextSelectedKeys as CreativeColumnKey[],
						),
					);
				}}
				onClose={() => setColumnSettingsOpen(false)}
				onReset={() => setHiddenColumnKeys([])}
			/>
			<div
				className="card"
				style={{
					borderColor: 'rgba(96,165,250,0.28)',
					background: 'rgba(30,41,59,0.55)',
				}}
			>
				<div style={{ fontSize: 12, fontWeight: 900, color: '#bfdbfe', marginBottom: 6 }}>소재 분석 지표 안내</div>
				<div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.55 }}>
					{platform === 'gfa' ? (
						<>
							GFA 소재 운영은 <b style={{ color: '#e5e7eb' }}>비용</b>, <b style={{ color: '#e5e7eb' }}>구매전환수</b>, <b style={{ color: '#e5e7eb' }}>구매매출</b>, <b style={{ color: '#e5e7eb' }}>구매 ROAS</b>를 중심으로 판단합니다.
							<br />
							한 캠페인 안의 여러 광고그룹/소재는 운영 필터와 그룹별 표에서 비교하고, 소재 행을 클릭하면 이미지/소구포인트 분석 화면으로 이동합니다.
						</>
					) : (
						<>
							현재 표의 <b style={{ color: '#e5e7eb' }}>총전환수</b>, <b style={{ color: '#e5e7eb' }}>총전환매출액</b>은 네이버 SearchAd의 전체 전환 기준입니다.
							<br />
							구매전환 분리 저장은 이미 적용됐지만, 과거에 저장된 소재 데이터는 구매전환 값이 0일 수 있습니다.
							<br />
							실제 구매완료 기준 판단은 <b style={{ color: '#e5e7eb' }}>캠페인 분석 / 광고 그룹 분석</b>의 구매전환 지표를 우선 확인해 주세요.
						</>
					)}
				</div>
			</div>

			<AdsPerformanceTrendCard
				title="소재 분석"
				trendPoints={activeTrendPoints}
				hasPurchaseMetrics={hasPurchaseMetrics}
				leftMetric={leftTrendMetric}
				rightMetric={rightTrendMetric}
				selectedLabel={selectedTrendLabel}
				onClearSelection={() => setSelectedTrendRowKey(null)}
				onChangeLeftMetric={changeLeftTrendMetric}
				onChangeRightMetric={changeRightTrendMetric}
			/>

			{uploadOpen ? (
				<div className="modal-backdrop" role="dialog" aria-label="소재 보고서 업로드">
					<div className="modal-card">
						<div className="modal-header">
							<div className="modal-title">소재 보고서 업로드</div>
							<button type="button" className="btn-ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>
								닫기
							</button>
						</div>
						<div className="modal-body" style={{ fontSize: 12, color: '#cbd5e1' }}>
							<div style={{ marginBottom: 10, color: '#9ca3af', lineHeight: 1.45 }}>
								네이버 광고 관리자에서 다운로드한 <b style={{ color: '#e5e7eb' }}>“소재 보고서”</b> 파일을 업로드하면,
								SearchAd Open API에서 미제공되는 <b style={{ color: '#e5e7eb' }}>평균노출순위</b>를 포함해 지표를 보강합니다.
								<br />
								지원 형식: <b style={{ color: '#e5e7eb' }}>CSV, XLSX</b>
							</div>
							<input
								key={uploadFileInputKey}
								type="file"
								accept=".csv,.xlsx,.xls"
								disabled={uploading}
								onChange={(e) => {
									const f = (e.target.files && e.target.files[0]) ? e.target.files[0] : null;
									setUploadFile(f);
									setUploadMsg(null);
									setUploadSaved(false);
									setUploadDetails(null);
									setUploadButtonState('idle');
								}}
							/>
							{uploadFile ? (
								<div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
									선택됨: {uploadFile.name} ({Math.round(uploadFile.size / 1024).toLocaleString()} KB)
								</div>
							) : null}
							{uploadSaved && uploadDetails ? (
								<div
									style={{
										marginTop: 10,
										fontSize: 11,
										color: '#86efac',
										background: 'rgba(34,197,94,0.14)',
										border: '1px solid rgba(34,197,94,0.35)',
										borderRadius: 10,
										padding: '10px 10px',
										lineHeight: 1.5,
									}}
								>
									<div style={{ fontWeight: 900 }}>저장 완료 (지표 + 오가닉 반영)</div>
									<div style={{ marginTop: 6, color: '#bbf7d0' }}>
										파일: {uploadDetails.filename || '-'}
										<br />
										처리: {uploadDetails.processedDates.length}일 · 스킵: {uploadDetails.skippedDates.length}일 · upsert: {uploadDetails.insertedTotal.toLocaleString()}건
										<br />
										오가닉 반영: {uploadDetails.derivedRecomputedDates.length}일
										{uploadDetails.derivedRecomputedDates.length > 0 ? ` (${uploadDetails.derivedRecomputedDates.join(', ')})` : ''}
									</div>
								</div>
							) : null}
							{uploadMsg ? (
								<div style={{ marginTop: 10, fontSize: 11, color: uploadMsg.startsWith('저장 완료') ? '#86efac' : '#fca5a5' }}>
									{uploadMsg}
								</div>
							) : null}
						</div>
						<div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
							<button type="button" className="btn-ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>
								취소
							</button>
							<button type="button" className="btn-primary" onClick={() => void handleUpload()} disabled={uploading || !uploadFile || uploadSaved}>
								{uploadSaved ? '저장완료' : (uploading ? '업로드 중…' : '업로드')}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{keywordInsightsOpen ? (
				<KeywordInsightsTrendsModal
					open={keywordInsightsOpen}
					apiBaseUrl={props.apiBaseUrl}
					keyword={keywordInsightsSeed}
					onClose={() => setKeywordInsightsOpen(false)}
					days={30}
				/>
			) : null}

			{filteredGroups.map((g) => {
				const isCollapsed = Boolean(collapsedGroups[g.key]);
				const first = g.rows?.[0];
				const adType = String(first?.adType || '').toUpperCase();
				const campName = String(first?.campaignName || '');
				const mode: 'powerlink' | 'shopping' =
					adType.includes('POWERLINK') || campName.startsWith('SA_') || campName.includes('파워링크')
						? 'powerlink'
						: 'shopping';
				return (
					<div key={g.key} className="space-y-2">
						<div
							className="card"
							style={{
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
								gap: 12,
								fontSize: 12,
								fontWeight: 900,
								color: '#e5e7eb',
							}}
						>
							<div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{g.title} (소재 {g.rows.length}개)
							</div>
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap' }}
								onClick={() =>
									setCollapsedGroups((prev) => ({ ...prev, [g.key]: !Boolean(prev[g.key]) }))
								}
							>
								{isCollapsed ? '펼치기' : '접기'}
							</button>
						</div>
						<AdsCreativesTable
							title="소재 리스트"
							rows={g.rows}
							collapsed={isCollapsed}
							mode={mode}
							validationStatus={creativeValidationByGroup[g.key] ?? 'unknown'}
							visibleColumnKeys={creativeVisibleColumnKeys}
							selectedRowKey={selectedTrendRowKey}
							onRowClick={(row) => {
								setSelectedTrendRowKey(row.key);
								if (platform === 'gfa') {
									const q = new URLSearchParams();
									if (row.creativeId) q.set('creative_id', String(row.creativeId));
									if (row.campaignName) q.set('campaign', String(row.campaignName));
									if (row.adgroupName) q.set('adgroup', String(row.adgroupName));
									navigate(`${routeBase}/creative-analysis?${q.toString()}`);
								}
							}}
						/>
					</div>
				);
			})}

			{filteredGroups.length === 0 && jobState.status === 'success' ? (
				<div className="card" style={{ fontSize: 12, color: '#9ca3af' }}>
					표시할 데이터가 없습니다.
				</div>
			) : null}
		</div>
	);
}

function MultiSelectDropdown(props: {
	id: 'campaign' | 'adgroup';
	label: string;
	options: string[];
	selected: string[];
	placeholder: string;
	onChange: (next: string[]) => void;
	open: boolean;
	setOpen: (v: boolean) => void;
}): JSX.Element {
	const [q, setQ] = useState('');

	const selectedSet = useMemo(() => new Set(props.selected), [props.selected]);
	const visibleOptions = useMemo(() => {
		const qq = q.trim().toLowerCase();
		const list = props.options || [];
		if (!qq) return list;
		return list.filter((x) => String(x).toLowerCase().includes(qq));
	}, [props.options, q]);

	const labelText =
		props.selected.length === 0 ? props.placeholder : `${props.label} ${props.selected.length}개 선택`;

	const toggleValue = (v: string) => {
		const next = new Set(selectedSet);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		props.onChange(Array.from(next));
	};

	return (
		<div style={{ position: 'relative' }}>
			<button
				type="button"
				onClick={() => props.setOpen(!props.open)}
				style={{
					background: 'rgba(2,6,23,0.25)',
					border: '1px solid rgba(148,163,184,0.18)',
					color: props.selected.length > 0 ? '#93c5fd' : '#9ca3af',
					borderRadius: 10,
					padding: '6px 10px',
					fontSize: 12,
					fontWeight: 900,
					cursor: 'pointer',
					whiteSpace: 'nowrap',
				}}
			>
				{labelText} ▾
			</button>
			{props.open ? (
				<div
					className="card"
					style={{
						position: 'absolute',
						top: 40,
						left: 0,
						zIndex: 50,
						width: 360,
						padding: 10,
					}}
				>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
						<div style={{ fontSize: 12, fontWeight: 900 }}>{props.label}</div>
						<div style={{ display: 'flex', gap: 8 }}>
							<button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => props.onChange([])}>
								전체
							</button>
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 11, padding: '2px 6px' }}
								onClick={() => props.onChange([...props.options])}
							>
								모두선택
							</button>
							<button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => props.setOpen(false)}>
								닫기
							</button>
						</div>
					</div>
					<input
						value={q}
						onChange={(e) => setQ(String(e.target.value || ''))}
						placeholder="검색…"
						style={{
							width: '100%',
							background: 'rgba(2,6,23,0.35)',
							border: '1px solid rgba(148,163,184,0.18)',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							color: '#e5e7eb',
							outline: 'none',
							marginBottom: 8,
						}}
					/>
					<div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
						{visibleOptions.length === 0 ? (
							<div style={{ fontSize: 12, color: '#9ca3af' }}>선택 가능한 항목이 없습니다.</div>
						) : (
							visibleOptions.map((opt) => (
								<label key={opt} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
									<input
										type="checkbox"
										checked={selectedSet.has(opt)}
										onChange={() => toggleValue(opt)}
										aria-label={opt}
									/>
									<span style={{ fontSize: 12, color: '#e5e7eb' }}>{opt}</span>
								</label>
							))
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

function AdsCampaignView(props: { apiBaseUrl: string; kind: 'campaign' | 'adgroup'; platform?: AdsPlatform }): JSX.Element {
	const platform = props.platform ?? 'sa';
	const routeBase = platform === 'gfa' ? '/analytics/gfa' : '/analytics/campaign';
	const [dateState, setDateState] = useAdsDateState();
	const [rows, setRows] = useState<AdsRow[]>([]);
	const [totalRow, setTotalRow] = useState<AdsRow | null>(null);
	const [trendPoints, setTrendPoints] = useState<AdsPerformanceTrendPoint[]>([]);
	const [trendByRowKey, setTrendByRowKey] = useState<Record<string, AdsPerformanceTrendPoint[]>>({});
	const [reloadTick, setReloadTick] = useState(0);
	const [fixing, setFixing] = useState(false);
	const [fixMsg, setFixMsg] = useState<string | null>(null);
	const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
	const [aiOpen, setAiOpen] = useState(false);
	const [aiLoading, setAiLoading] = useState(false);
	const [aiError, setAiError] = useState<string | null>(null);
	const [aiModels, setAiModels] = useState<Array<{ id: string }>>([]);
	const [aiModel, setAiModel] = useState('gpt-4o-mini');
	const [aiQuestion, setAiQuestion] = useState(
		'선택 기간의 성과를 요약하고, 비용 대비 성과가 좋은/나쁜 항목을 찾아 개선 액션을 제안해줘.',
	);
	const [aiFollowup, setAiFollowup] = useState('');
	const [aiThread, setAiThread] = useState<Array<{ role: 'user' | 'assistant'; content: string; ts: number }>>([]);
	const trendMetricStorageKey = `${platform}.ads.${props.kind}.trendMetrics.v1`;
	const [leftTrendMetric, setLeftTrendMetric] = useState<AdsPerformanceTrendMetricKey>(() => {
		try {
			const raw = window.localStorage.getItem(trendMetricStorageKey);
			const parsed = raw ? JSON.parse(raw) : null;
			return String(parsed?.left || 'cost') as AdsPerformanceTrendMetricKey;
		} catch {
			return 'cost';
		}
	});
	const [rightTrendMetric, setRightTrendMetric] = useState<AdsPerformanceTrendMetricKey>(() => {
		try {
			const raw = window.localStorage.getItem(trendMetricStorageKey);
			const parsed = raw ? JSON.parse(raw) : null;
			return String(parsed?.right || 'revenue') as AdsPerformanceTrendMetricKey;
		} catch {
			return 'revenue';
		}
	});
	const [selectedTrendRowKey, setSelectedTrendRowKey] = useState<string | null>(null);
	const [validation, setValidation] = useState<{
		byCampaign: Record<string, Exclude<ValidationStatus, 'unknown'>>;
		byGroup: Record<string, Exclude<ValidationStatus, 'unknown'>>;
		anyFix: boolean;
		lastRange: { from: string; to: string } | null;
	}>(() => {
		const cached = loadValidationCache();
		if (!cached) return { byCampaign: {}, byGroup: {}, anyFix: false, lastRange: null };
		const anyFix =
			Object.values(cached.byCampaign || {}).some((v) => v === 'fix') ||
			Object.values(cached.byGroup || {}).some((v) => v === 'fix');
		return { byCampaign: cached.byCampaign || {}, byGroup: cached.byGroup || {}, anyFix, lastRange: cached.range || null };
	});
	const defaultStatusFilter: OperationalStatusFilter = platform === 'gfa' ? 'active' : 'all';
	const statusFilterKey = `${platform}.ads.${props.kind}.statusFilter.v2`;
	const [statusFilter, setStatusFilter] = useState<OperationalStatusFilter>(() => {
		try {
			const v = String(window.localStorage.getItem(statusFilterKey) ?? '').trim();
			if (platform === 'gfa' && v === 'unknown') return defaultStatusFilter;
			if (v === 'active' || v === 'inactive' || v === 'unknown' || v === 'all') return v;
			return defaultStatusFilter;
		} catch {
			return defaultStatusFilter;
		}
	});
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const campaignFilter = useMemo(() => {
		const v = String(searchParams.get('campaign') ?? '').trim();
		return v.length > 0 ? v : null;
	}, [searchParams]);
	const [jobState, setJobState] = useState<JobState<AdsCampaignJobData>>({
		status: 'idle',
		message: null,
		data: null,
		error: null,
	});
	const didAutoResetRef = useRef(false);
	const activeJobKeyRef = useRef<string | null>(null);
	const subscribedJobKeyRef = useRef<string | null>(null);
	const [collectingPinned, setCollectingPinned] = useState(false);
	const rowLimitKey = `${platform}.ads.${props.kind}.rowLimit.v1`;
	const hiddenColumnsKey = `${platform}.ads.${props.kind}.hiddenColumns.v1`;
	const [rowLimit, setRowLimit] = useState<number>(() => {
		try {
			const v = Number(window.localStorage.getItem(rowLimitKey) || '');
			if (Number.isFinite(v) && v >= 0) return v;
		} catch {}
		return 500;
	});
	const adgroupGroupLimitKey = `${platform}.ads.adgroup.groupLimit.v1`;
	const [adgroupGroupLimit, setAdgroupGroupLimit] = useState<number>(() => {
		try {
			const v = Number(window.localStorage.getItem(adgroupGroupLimitKey) || '');
			if (Number.isFinite(v) && v >= 0) return v;
		} catch {}
		return 20;
	});
	const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Array<AdsLeftColumnKey | AdsMetricColumnKey>>(
		() => loadHiddenColumnKeys<Array<AdsLeftColumnKey | AdsMetricColumnKey>[number]>(hiddenColumnsKey),
	);
	const workerRef = useRef<Worker | null>(null);
	const reqIdRef = useRef(0);
	const pendingRef = useRef(new Map<number, { resolve: (v: AdsCampaignAggResult) => void; reject: (e: any) => void }>());

	useEffect(() => {
		saveHiddenColumnKeys(hiddenColumnsKey, hiddenColumnKeys);
	}, [hiddenColumnKeys, hiddenColumnsKey]);

	useEffect(() => {
		try {
			window.localStorage.setItem(
				trendMetricStorageKey,
				JSON.stringify({ v: 1, left: leftTrendMetric, right: rightTrendMetric }),
			);
		} catch {
			// ignore
		}
	}, [leftTrendMetric, rightTrendMetric, trendMetricStorageKey]);

	useEffect(() => {
		if (typeof Worker === 'undefined') return;
		try {
			workerRef.current = new Worker(new URL('./adsAgg.worker.ts', import.meta.url), { type: 'module' });
		} catch {
			workerRef.current = null;
			return;
		}
		const w = workerRef.current;
		if (!w) return;

		w.onmessage = (ev: MessageEvent<any>) => {
			const msg = ev.data;
			if (!msg || msg.kind !== 'ads_campaign_agg') return;
			const pending = pendingRef.current.get(Number(msg.reqId));
			if (!pending) return;
			pendingRef.current.delete(Number(msg.reqId));
			if (msg.ok) pending.resolve(msg.result as AdsCampaignAggResult);
			else pending.reject(new Error(String(msg.error || 'worker error')));
		};
		w.onerror = () => {
			// worker 자체 오류는 모든 대기 요청을 실패로 처리하고 fallback이 동작하도록 한다.
			for (const [, p] of pendingRef.current.entries()) {
				try { p.reject(new Error('worker error')); } catch {}
			}
			pendingRef.current.clear();
		};
		return () => {
			try {
				w.terminate();
			} catch {}
			workerRef.current = null;
			pendingRef.current.clear();
		};
	}, []);

	const runAgg = async (curr: any[], prev: any[]): Promise<AdsCampaignAggResult> => {
		const w = workerRef.current;
		if (w) {
			const reqId = (reqIdRef.current = reqIdRef.current + 1);
			return await new Promise<AdsCampaignAggResult>((resolve, reject) => {
				pendingRef.current.set(reqId, { resolve, reject });
				w.postMessage({ kind: 'ads_campaign_agg', reqId, payload: { viewKind: props.kind, curr, prev } });
			});
		}
		// worker 미지원/초기화 실패 환경에서는 동일 로직을 메인 스레드에서 수행(기능 유지)
		return computeAdsCampaignAgg({ viewKind: props.kind, curr, prev });
	};

	useEffect(() => {
		const r = normalizeRange(dateState.range);
		const prevRange = shiftRange(r, dateState.compareMode);
		const dateFrom = toYmd(r.from);
		const dateTo = toYmd(r.to);
		const prevFrom = toYmd(prevRange.from);
		const prevTo = toYmd(prevRange.to);

		// NOTE: 메뉴 이동(언마운트)해도 로딩이 끊기지 않도록 컴포넌트 외부 캐시에서 job을 관리한다.
		const jobKey = [
			'ads-campaign-view',
			props.apiBaseUrl,
			platform,
			props.kind,
			`campaign=${campaignFilter ?? ''}`,
			dateFrom,
			dateTo,
			prevFrom,
			prevTo,
			dateState.compareMode,
			statusFilter,
			// NOTE: 메뉴 이동 후 복귀해도 "진행 메시지"를 같은 key로 다시 구독할 수 있도록
			// reload 같은 화면 내부 tick은 key에 포함하지 않는다.
		].join('|');

		// 메뉴 복귀/기간 변경 시에도 진행 표시가 끊기지 않도록,
		// 캐시에서 "현재 진행 중(loading)"인 jobKey를 우선적으로 붙잡는다.
		const runningKey = adsJobCache.findLatestLoadingKey(`ads-campaign-view|${props.apiBaseUrl}|${platform}|${props.kind}|`);

		// 요구사항(구조):
		// - 사용자가 "수집 중단"을 누르기 전까지, 날짜 변경/메뉴 이동이 있어도 수집을 중단하지 않는다.
		// - 진행 중인 수집이 있으면 jobKey를 고정(pin)해 진행 표시/구독이 끊기지 않도록 한다.
		const activeKey = activeJobKeyRef.current;
		const activeRunning = Boolean(runningKey) || (activeKey ? adsJobCache.getState<any>(activeKey)?.status === 'loading' : false);
		const jobKeyToUse = runningKey ?? (activeRunning ? activeKey! : jobKey);
		setCollectingPinned(Boolean(runningKey) && jobKeyToUse !== jobKey);
		subscribedJobKeyRef.current = jobKeyToUse;

		const unsub = adsJobCache.subscribe(jobKeyToUse, setJobState as any);

		// 진행 중이면(핀 상태) 새 job을 시작하지 않는다.
		if (runningKey && jobKeyToUse === runningKey) {
			return () => {
				unsub();
			};
		}
		if (activeRunning && jobKeyToUse !== jobKey) {
			return () => {
				unsub();
			};
		}

		activeJobKeyRef.current = jobKeyToUse;
		void adsJobCache.start(jobKeyToUse, async ({ setMessage, setData, signal }) => {
			// 정확도/일관성:
			// - “광고 키워드 분석(키워드/검색어)” 화면의 합계와 캠페인/그룹 합계가 다르게 보이는 핵심 원인은
			//   캠페인/그룹 화면이 creative daily를 소스로 집계하면서, 키워드/검색어 화면(키워드/검색어 daily)과
			//   서로 다른 리포트 차원을 섞어 보여주기 때문이었다.
			// - 여기서는 기본 집계 소스를 keyword daily로 통일해, 메뉴 간 합계가 일관되게 맞도록 한다.
			const aggSource: 'keyword' | 'creative' = 'keyword';
			// 1) 먼저 "현재 DB에 있는 데이터"를 즉시 조회해 표에 그린다.
			//    (누락분 자동수집이 오래 걸려도 사용자가 빈 화면을 보지 않도록)
			setMessage('불러오는 중…');
			const fetchOnce = async () => {
				const yesterday = toYmd(defaultYesterdayRange().from);
				const [currRawBase, prevRawBase, campaignInventory, adgroupInventory, yesterdayStatusRows] = await Promise.all([
					props.kind === 'campaign'
						? fetchCampaignDaily({ baseUrl: props.apiBaseUrl, dateFrom, dateTo, source: aggSource, platform })
						: fetchAdgroupDaily({ baseUrl: props.apiBaseUrl, dateFrom, dateTo, campaign: campaignFilter ?? undefined, source: aggSource, platform }),
					props.kind === 'campaign'
						? fetchCampaignDaily({ baseUrl: props.apiBaseUrl, dateFrom: prevFrom, dateTo: prevTo, source: aggSource, platform })
						: fetchAdgroupDaily({ baseUrl: props.apiBaseUrl, dateFrom: prevFrom, dateTo: prevTo, campaign: campaignFilter ?? undefined, source: aggSource, platform }),
					platform === 'gfa' && props.kind === 'campaign'
						? fetchGfaCampaignInventory({ baseUrl: props.apiBaseUrl, campaign: campaignFilter ?? undefined })
						: Promise.resolve([] as CampaignInventoryRow[]),
					platform === 'gfa' && props.kind === 'adgroup'
						? fetchGfaAdgroupInventory({ baseUrl: props.apiBaseUrl, campaign: campaignFilter ?? undefined })
						: Promise.resolve([] as AdgroupInventoryRow[]),
					platform === 'gfa'
						? (props.kind === 'campaign'
							? fetchCampaignDaily({ baseUrl: props.apiBaseUrl, dateFrom: yesterday, dateTo: yesterday, source: aggSource, platform })
							: fetchAdgroupDaily({ baseUrl: props.apiBaseUrl, dateFrom: yesterday, dateTo: yesterday, campaign: campaignFilter ?? undefined, source: aggSource, platform }))
						: Promise.resolve([] as Array<CampaignDailyAggRow | AdgroupDailyAggRow>),
				]);
				const currMerged = platform === 'gfa' && props.kind === 'campaign'
					? mergeGfaCampaignInventoryRows(currRawBase as CampaignDailyAggRow[], campaignInventory, dateTo)
					: platform === 'gfa' && props.kind === 'adgroup'
						? mergeGfaAdgroupInventoryRows(currRawBase as AdgroupDailyAggRow[], adgroupInventory, dateTo)
					: currRawBase;
				const prevMerged = platform === 'gfa' && props.kind === 'campaign'
					? mergeGfaCampaignInventoryRows(prevRawBase as CampaignDailyAggRow[], campaignInventory, prevTo)
					: platform === 'gfa' && props.kind === 'adgroup'
						? mergeGfaAdgroupInventoryRows(prevRawBase as AdgroupDailyAggRow[], adgroupInventory, prevTo)
					: prevRawBase;
				const curr = platform === 'gfa'
					? applyGfaYesterdayStatusToRows(props.kind, currMerged as Array<CampaignDailyAggRow | AdgroupDailyAggRow>, yesterdayStatusRows as Array<CampaignDailyAggRow | AdgroupDailyAggRow>)
					: currMerged;
				const prev = platform === 'gfa'
					? applyGfaYesterdayStatusToRows(props.kind, prevMerged as Array<CampaignDailyAggRow | AdgroupDailyAggRow>, yesterdayStatusRows as Array<CampaignDailyAggRow | AdgroupDailyAggRow>)
					: prevMerged;
				const currTrendRows = platform === 'gfa'
					? applyGfaYesterdayStatusToRows(props.kind, currRawBase as Array<CampaignDailyAggRow | AdgroupDailyAggRow>, yesterdayStatusRows as Array<CampaignDailyAggRow | AdgroupDailyAggRow>)
					: currRawBase;

				const filterByStatus = (row: any): boolean => matchesOperationalStatusFilter(row, statusFilter);

				const currFiltered = (curr as any[]).filter(filterByStatus);
				const prevFiltered = (prev as any[]).filter(filterByStatus);
				const trendPointsNext = buildAdsPerformanceTrend((currTrendRows as any[]).filter(filterByStatus) as Array<CampaignDailyAggRow | AdgroupDailyAggRow>);
				const trendByRowKeyNext = buildAdsPerformanceTrendByRowKey(
					props.kind,
					((currTrendRows as any[]).filter(filterByStatus) as Array<CampaignDailyAggRow | AdgroupDailyAggRow>),
				);
				setMessage('집계 계산 중…');
				// 무거운 집계/정렬은 worker로 보내 메인 스레드 프리징을 방지한다.
				const agg = await runAgg(currFiltered, prevFiltered);
				return { ...agg, trendPoints: trendPointsNext, trendByRowKey: trendByRowKeyNext };
			};

			const first = await fetchOnce();
			// loading 중에도 data를 즉시 반영
			setData(first as any);

			// 2) 누락이 있으면 자동 수집을 수행하고, 완료 후 한 번 더 조회/반영한다.
			//    (집계 지연/느림이 있더라도 "표 자체는 즉시 노출"된다.)
			try {
				await ensureAdsDataMulti({
					apiBaseUrl: props.apiBaseUrl,
					kind: platform === 'gfa' ? props.kind : 'keyword',
					platform,
					ranges: [
						{ from: dateFrom, to: dateTo },
						{ from: prevFrom, to: prevTo },
					],
					setEnsure: (s) => setMessage(s.message),
					signal,
				});
			} catch (e) {
				// 집계 지연(503) 등으로 자동 수집이 막혀도, 이미 표시 중인 데이터를 유지한다.
				if (isReportNotReadyError(e)) {
					setMessage('리포트 집계 지연으로 자동 수집을 잠시 대기합니다. (기존 데이터는 표시 중)');
					return first as any;
				}
				throw e;
			} finally {
				setMessage(null);
			}

			if (platform === 'gfa') {
				return first as any;
			}

			const second = await fetchOnce();
			setData(second as any);
			// 최종 결과는 second가 최신이므로 이를 반환한다.
			return second as any;
		}).catch(() => {});

		return () => {
			unsub();
		};
	}, [props.apiBaseUrl, props.kind, platform, dateState.range, dateState.compareMode, reloadTick, statusFilter, campaignFilter]);

	useEffect(() => {
		// 중요: “기간 변경” 시 새 jobKey(idle)에 붙어버리면 진행/리스트가 사라진다.
		// active pin 해제는 "현재 구독 상태"가 아니라,
		// 실제 active job의 상태가 loading이 아닐 때만 수행한다.
		const active = activeJobKeyRef.current;
		if (!active) return;
		const st = adsJobCache.getState<any>(active);
		if (st?.status !== 'loading') {
			activeJobKeyRef.current = null;
			setCollectingPinned(false);
		}
	}, [jobState.status, jobState.data, jobState.message, jobState.error]);

	useEffect(() => {
		// 중요: 메뉴 이동 후 복귀 시 job이 아직 loading이어도,
		// JobCache는 이전 data를 유지한 채(status=loading, data!=null) 상태를 전달한다.
		// 기존 코드는 success에서만 rows를 갱신해 "리스트가 사라져 보이는" 문제가 발생했다.
		if (!jobState.data) {
			setRows([]);
			setTotalRow(null);
			setTrendPoints([]);
			setTrendByRowKey({});
			return;
		}
		setRows(jobState.data.rows);
		setTotalRow(jobState.data.totalRow);
		setTrendPoints(jobState.data.trendPoints ?? []);
		setTrendByRowKey(jobState.data.trendByRowKey ?? {});
	}, [jobState.data]);

	const title = props.kind === 'campaign' ? '캠페인 분석' : '광고 그룹 분석';

	const columns = props.kind === 'campaign'
		? [{ key: 'primary' as const, label: '캠페인' }]
		: [{ key: 'secondary' as const, label: '캠페인' }, { key: 'primary' as const, label: '광고그룹' }];

	const hasPurchaseMetrics = useMemo(
		() => Boolean(totalRow?.purchaseMetrics || rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics)),
		[rows, totalRow],
	);

	const activeLeftColumns = useMemo<Array<{ key: AdsLeftColumnKey; label: string }>>(() => {
		if (props.kind === 'adgroup' && !campaignFilter) {
			return [
				{ key: 'status', label: '운영여부' },
				{ key: 'ended_on', label: '종료일' },
				{ key: 'primary', label: '광고그룹' },
			];
		}
		return [
			{ key: 'status', label: '운영여부' },
			{ key: 'ended_on', label: '종료일' },
			...(columns as Array<{ key: AdsLeftColumnKey; label: string }>),
		];
	}, [campaignFilter, columns, props.kind]);
	const leftColPx = useMemo(
		() => platform === 'gfa'
			? {
				status: 92,
				ended_on: 92,
				primary: props.kind === 'campaign' ? 320 : 280,
				secondary: 260,
				tertiary: 240,
			}
			: undefined,
		[platform, props.kind],
	);

	const metricColumnOptions = useMemo<AdsColumnSettingOption[]>(() => {
		const options: Array<{ key: AdsMetricColumnKey; label: string }> = [
			{ key: 'impressions', label: '노출수' },
			{ key: 'clicks', label: '클릭수' },
			{ key: 'ctr', label: '클릭률(%)' },
			{ key: 'cpc', label: '평균클릭비용' },
			{ key: 'cost', label: '총비용' },
			{ key: 'conversions', label: hasPurchaseMetrics ? '총전환수' : '전환수' },
			...(hasPurchaseMetrics ? [{ key: 'purchase_conversions' as const, label: '구매전환수' }] : []),
			...(hasPurchaseMetrics ? [{ key: 'purchase_cvr' as const, label: '구매전환율(%)' }] : []),
			{ key: 'cvr', label: '전환율(%)' },
			{ key: 'revenue', label: hasPurchaseMetrics ? '총전환매출액' : '전환매출액' },
			...(hasPurchaseMetrics ? [{ key: 'purchase_revenue' as const, label: '구매전환매출액' }] : []),
			...(hasPurchaseMetrics ? [{ key: 'purchase_roas' as const, label: '구매전환수익율(%)' }] : []),
			{ key: 'roas', label: '광고수익률(%)' },
		];
		return options.map((option) => ({ ...option, group: '성과 지표' }));
	}, [hasPurchaseMetrics]);

	const campaignColumnOptions = useMemo<AdsColumnSettingOption[]>(
		() => [
			...activeLeftColumns.map((column) => ({ key: column.key, label: column.label, group: '기본 정보' })),
			...metricColumnOptions,
		],
		[activeLeftColumns, metricColumnOptions],
	);

	const campaignVisibleKeys = useMemo(
		() => selectedKeysFromHidden(
			campaignColumnOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey),
			hiddenColumnKeys,
		),
		[campaignColumnOptions, hiddenColumnKeys],
	);
	const visibleLeftColumns = useMemo(
		() => activeLeftColumns.filter((column) => campaignVisibleKeys.includes(column.key)),
		[activeLeftColumns, campaignVisibleKeys],
	);
	const visibleMetricKeys = useMemo(
		() => metricColumnOptions
			.map((option) => option.key as AdsMetricColumnKey)
			.filter((key) => campaignVisibleKeys.includes(key)),
		[campaignVisibleKeys, metricColumnOptions],
	);
	const trendMetricOptions = useMemo(() => getAdsTrendMetricOptions(hasPurchaseMetrics), [hasPurchaseMetrics]);

	useEffect(() => {
		if (rows.length === 0 && !totalRow) return;
		const optionKeys = new Set(trendMetricOptions.map((option) => option.key));
		if (!optionKeys.has(leftTrendMetric)) {
			setLeftTrendMetric(optionKeys.has('cost') ? 'cost' : trendMetricOptions[0]?.key ?? 'cost');
		}
		if (!optionKeys.has(rightTrendMetric)) {
			const fallback = optionKeys.has('purchase_revenue')
				? 'purchase_revenue'
				: optionKeys.has('revenue')
					? 'revenue'
					: pickAlternateTrendMetric(leftTrendMetric, trendMetricOptions);
			setRightTrendMetric(fallback);
		}
	}, [leftTrendMetric, rightTrendMetric, totalRow, trendMetricOptions, rows.length]);

	const changeLeftTrendMetric = (next: AdsPerformanceTrendMetricKey) => {
		setLeftTrendMetric(next);
		if (next === rightTrendMetric) {
			setRightTrendMetric(pickAlternateTrendMetric(next, trendMetricOptions));
		}
	};

	const changeRightTrendMetric = (next: AdsPerformanceTrendMetricKey) => {
		setRightTrendMetric(next);
		if (next === leftTrendMetric) {
			setLeftTrendMetric(pickAlternateTrendMetric(next, trendMetricOptions));
		}
	};
	const selectedTrendLabel = useMemo(() => {
		if (!selectedTrendRowKey) return null;
		const selectedRow = rows.find((row) => row.key === selectedTrendRowKey);
		if (!selectedRow) return null;
		if (props.kind === 'campaign') return selectedRow.primary;
		const campaignName = String(selectedRow.secondary ?? '').trim();
		return campaignName ? `${campaignName} / ${selectedRow.primary}` : selectedRow.primary;
	}, [props.kind, rows, selectedTrendRowKey]);
	const activeTrendPoints = useMemo(() => {
		if (!selectedTrendRowKey) return trendPoints;
		return trendByRowKey[selectedTrendRowKey] ?? trendPoints;
	}, [selectedTrendRowKey, trendByRowKey, trendPoints]);

	const filteredRows = useMemo(
		() => rows.filter((row) => matchesOperationalStatusFilter(row, statusFilter)),
		[rows, statusFilter],
	);
	const filteredTotalRow = useMemo<AdsRow | null>(() => {
		if (statusFilter === 'all') return totalRow;
		if (!totalRow || filteredRows.length === 0) return null;
		let currTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
		let prevTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
		let currPurchase = { conversions: 0, revenue: 0 };
		let prevPurchase = { conversions: 0, revenue: 0 };
		for (const row of filteredRows) {
			currTotals = {
				impressions: currTotals.impressions + (Number(row.metrics.impressions) || 0),
				clicks: currTotals.clicks + (Number(row.metrics.clicks) || 0),
				cost: currTotals.cost + (Number(row.metrics.cost) || 0),
				conversions: currTotals.conversions + (Number(row.metrics.conversions) || 0),
				revenue: currTotals.revenue + (Number(row.metrics.revenue) || 0),
			};
			prevTotals = {
				impressions: prevTotals.impressions + (Number(row.prevMetrics.impressions) || 0),
				clicks: prevTotals.clicks + (Number(row.prevMetrics.clicks) || 0),
				cost: prevTotals.cost + (Number(row.prevMetrics.cost) || 0),
				conversions: prevTotals.conversions + (Number(row.prevMetrics.conversions) || 0),
				revenue: prevTotals.revenue + (Number(row.prevMetrics.revenue) || 0),
			};
			currPurchase = {
				conversions: currPurchase.conversions + (Number(row.purchaseMetrics?.conversions) || 0),
				revenue: currPurchase.revenue + (Number(row.purchaseMetrics?.revenue) || 0),
			};
			prevPurchase = {
				conversions: prevPurchase.conversions + (Number(row.prevPurchaseMetrics?.conversions) || 0),
				revenue: prevPurchase.revenue + (Number(row.prevPurchaseMetrics?.revenue) || 0),
			};
		}
		const currMetrics = computeMetrics(currTotals);
		const prevMetrics = computeMetrics(prevTotals);
		return {
			...totalRow,
			metrics: currMetrics,
			prevMetrics,
			deltas: calcMetricDeltas(currMetrics, prevMetrics),
			purchaseMetrics: currPurchase,
			prevPurchaseMetrics: prevPurchase,
		};
	}, [filteredRows, statusFilter, totalRow]);

	useEffect(() => {
		if (!selectedTrendRowKey) return;
		if (filteredRows.some((row) => row.key === selectedTrendRowKey) && trendByRowKey[selectedTrendRowKey]) return;
		setSelectedTrendRowKey(null);
	}, [filteredRows, selectedTrendRowKey, trendByRowKey]);

	// 광고그룹 분석: 캠페인별 그룹핑 + 소계
	const groupedAdgroups = useMemo(() => {
		if (props.kind !== 'adgroup') return null;
		const byCamp = new Map<string, AdsRow[]>();
		for (const r of filteredRows) {
			const camp = String(r.secondary ?? '').trim() || '(캠페인 미지정)';
			const arr = byCamp.get(camp) ?? [];
			arr.push(r);
			byCamp.set(camp, arr);
		}

		const makeSubtotal = (camp: string, rs: AdsRow[]): AdsRow => {
			let currTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
			let prevTotals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
			let currPurchase = { conversions: 0, revenue: 0 };
			let prevPurchase = { conversions: 0, revenue: 0 };
			for (const rr of rs) {
				currTotals = {
					impressions: currTotals.impressions + (Number(rr.metrics.impressions) || 0),
					clicks: currTotals.clicks + (Number(rr.metrics.clicks) || 0),
					cost: currTotals.cost + (Number(rr.metrics.cost) || 0),
					conversions: currTotals.conversions + (Number(rr.metrics.conversions) || 0),
					revenue: currTotals.revenue + (Number(rr.metrics.revenue) || 0),
				};
				prevTotals = {
					impressions: prevTotals.impressions + (Number(rr.prevMetrics.impressions) || 0),
					clicks: prevTotals.clicks + (Number(rr.prevMetrics.clicks) || 0),
					cost: prevTotals.cost + (Number(rr.prevMetrics.cost) || 0),
					conversions: prevTotals.conversions + (Number(rr.prevMetrics.conversions) || 0),
					revenue: prevTotals.revenue + (Number(rr.prevMetrics.revenue) || 0),
				};
				currPurchase = {
					conversions: currPurchase.conversions + (Number(rr.purchaseMetrics?.conversions) || 0),
					revenue: currPurchase.revenue + (Number(rr.purchaseMetrics?.revenue) || 0),
				};
				prevPurchase = {
					conversions: prevPurchase.conversions + (Number(rr.prevPurchaseMetrics?.conversions) || 0),
					revenue: prevPurchase.revenue + (Number(rr.prevPurchaseMetrics?.revenue) || 0),
				};
			}
			const currM = computeMetrics(currTotals);
			const prevM = computeMetrics(prevTotals);
			return {
				key: `__subtotal__${camp}`,
				primary: '소계(캠페인합계)',
				secondary: camp,
				tertiary: null,
				metrics: currM,
				prevMetrics: prevM,
				deltas: calcMetricDeltas(currM, prevM),
				purchaseMetrics: currPurchase,
				prevPurchaseMetrics: prevPurchase,
			};
		};

		const groups = [...byCamp.entries()].map(([camp, rs]) => {
			const subtotal = makeSubtotal(camp, rs);
			const cost = Number(subtotal.metrics.cost) || 0;
			return { camp, rows: rs, subtotal, cost };
		});
		groups.sort((a, b) => b.cost - a.cost);
		return groups;
	}, [filteredRows, props.kind]);

	// 대량 렌더링 방지: 표에 표시할 행수 제한(기본 500, 전체는 0)
	const visibleRows = useMemo(() => {
		if (!rowLimit || rowLimit <= 0) return filteredRows;
		return filteredRows.slice(0, rowLimit);
	}, [filteredRows, rowLimit]);

	// 광고그룹(캠페인별 분할 표시)에서도 동일한 제한을 적용
	const visibleGroupedAdgroups = useMemo(() => {
		if (!groupedAdgroups) return null;
		const groups = !adgroupGroupLimit || adgroupGroupLimit <= 0 ? groupedAdgroups : groupedAdgroups.slice(0, adgroupGroupLimit);
		return groups.map((g) => ({
			...g,
			rows: !rowLimit || rowLimit <= 0 ? g.rows : g.rows.slice(0, rowLimit),
		}));
	}, [groupedAdgroups, adgroupGroupLimit, rowLimit]);

	const totalDot = (status: 'ok' | 'fix' | 'unknown') => (
		<span className={`valid-dot ${status}`} title={status === 'ok' ? '검증완료' : status === 'fix' ? '보정필요' : '미검증'} />
	);

	const currentRange = useMemo(() => {
		const r = normalizeRange(dateState.range);
		return { from: toYmd(r.from), to: toYmd(r.to) };
	}, [dateState.range]);

	const openAiModal = async () => {
		setAiOpen(true);
		setAiError(null);
		// 이전 대화는 유지(사용자가 비교 가능)
		if (aiModels.length > 0) return;
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/models`, { timeout: 20000 });
			const models = Array.isArray((res as any)?.data?.models) ? ((res as any).data.models as any[]) : [];
			const cleaned = models
				.map((m) => ({ id: String(m?.id ?? '').trim() }))
				.filter((m) => Boolean(m.id));
			setAiModels(cleaned);
			if (cleaned.length > 0 && !cleaned.some((m) => m.id === aiModel)) {
				const first = cleaned[0];
				if (first) setAiModel(first.id);
			}
		} catch (e: any) {
			// 모델 목록 실패는 치명적이지 않음(직접 입력 허용)
			setAiModels([]);
		}
	};

	const runAiAnalyze = async (mode: 'fresh' | 'followup') => {
		setAiLoading(true);
		setAiError(null);
		try {
			const now = Date.now();
			const body: any = {
				level: props.kind,
				date_from: currentRange.from,
				date_to: currentRange.to,
				source: 'creative',
				question:
					mode === 'fresh'
						? String(aiQuestion || '').trim() || undefined
						: String(aiFollowup || '').trim() || undefined,
				model: String(aiModel || '').trim() || undefined,
			};
			if (props.kind === 'adgroup' && campaignFilter) body.campaign = campaignFilter;

			if (mode === 'followup') {
				body.thread = aiThread.map((m) => ({ role: m.role, content: m.content }));
			} else {
				// 새 분석은 기존 대화를 초기화(질문을 바꿔 새로 분석하는 경우)
				setAiThread([]);
			}

			const qText = String(body.question || '').trim();
			if (!qText) throw new Error(mode === 'fresh' ? '질문을 입력하세요.' : '추가 질문을 입력하세요.');

			const res = await axios.post(`${props.apiBaseUrl}/ai/analyze/ads`, body, { timeout: 120000 });
			const txt = String((res as any)?.data?.analysis ?? '').trim();
			if (!txt) throw new Error('분석 결과가 비어 있습니다.');
			if (mode === 'fresh') {
				setAiThread([
					{ role: 'user', content: qText, ts: now },
					{ role: 'assistant', content: txt, ts: now + 1 },
				]);
			} else {
				setAiThread((prev) => [...prev, { role: 'user', content: qText, ts: now }, { role: 'assistant', content: txt, ts: now + 1 }]);
			}
			setAiFollowup('');
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? 'AI 분석에 실패했습니다.';
			setAiError(String(msg));
		} finally {
			setAiLoading(false);
		}
	};

	const statusForCampaign = (camp: string): ValidationStatus => {
		if (!validation.lastRange) return 'unknown';
		if (validation.lastRange.from !== currentRange.from || validation.lastRange.to !== currentRange.to) return 'unknown';
		return validation.byCampaign[camp] ?? 'unknown';
	};

	const statusForOverall = (): ValidationStatus => {
		if (!validation.lastRange) return 'unknown';
		if (validation.lastRange.from !== currentRange.from || validation.lastRange.to !== currentRange.to) return 'unknown';
		return validation.anyFix ? 'fix' : 'ok';
	};

	const handleDownloadExcel = async (): Promise<void> => {
		const hasRows = props.kind === 'adgroup' && !campaignFilter && visibleGroupedAdgroups
			? visibleGroupedAdgroups.some((group) => group.rows.length > 0)
			: visibleRows.length > 0;
		if (!hasRows) {
			try { window.alert('다운로드할 표 데이터가 없습니다.'); } catch {}
			return;
		}
		const metaRows: Array<Record<string, unknown>> = [
			{ 항목: '화면', 값: title },
			{ 항목: '기간', 값: `${currentRange.from} ~ ${currentRange.to}` },
			{ 항목: '운영 상태 필터', 값: statusFilter },
			{ 항목: '캠페인 필터', 값: campaignFilter || '전체' },
			{ 항목: '표시 행수', 값: rowLimit > 0 ? `상위 ${rowLimit.toLocaleString()}행` : '전체' },
			{ 항목: '생성 시각', 값: new Date().toLocaleString() },
		];
		const uiSheet =
			props.kind === 'adgroup' && !campaignFilter && visibleGroupedAdgroups
				? adsGroupedRowsToUiExcelSheet({
					title,
					period: `${currentRange.from} ~ ${currentRange.to}`,
					groups: visibleGroupedAdgroups.map((group) => ({
						title: group.camp,
						rows: group.rows,
						totalRow: group.subtotal,
					})),
					leftColumns: visibleLeftColumns,
					metricKeys: visibleMetricKeys,
					hasPurchaseMetrics,
				})
				: adsRowsToUiExcelSheet({
					title,
					period: `${currentRange.from} ~ ${currentRange.to}`,
					rows: visibleRows,
					totalRow,
						leftColumns: visibleLeftColumns,
						metricKeys: visibleMetricKeys,
						hasPurchaseMetrics,
				});
		await downloadExcelWorkbook({
			fileName: `${sanitizeExcelFilePart(title)}_${currentRange.from}_${currentRange.to}.xlsx`,
			sheets: [
				{ name: '표', aoa: uiSheet.aoa, cols: uiSheet.cols, merges: uiSheet.merges },
				{ name: '조건', rows: metaRows },
			],
		});
	};

	return (
		<div className="space-y-3">
			<AdsDateControls value={dateState} onChange={setDateState} />
			<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
				<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
					<div style={{ fontSize: 12, fontWeight: 900 }}>운영 상태</div>
					<select
						value={statusFilter}
						onChange={(e) => {
							const v = e.target.value as any;
							setStatusFilter(v);
							try {
								window.localStorage.setItem(statusFilterKey, String(v));
							} catch {
								// ignore
							}
						}}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 800,
						}}
					>
						<option value="all">전체</option>
						<option value="active">운영중</option>
						<option value="inactive">종료</option>
						{platform !== 'gfa' ? <option value="unknown">미확인</option> : null}
					</select>
					<div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 10 }}>
						<div style={{ fontSize: 11, color: '#9ca3af' }}>표시</div>
						<select
							value={String(rowLimit)}
							onChange={(e) => {
								const v = Number(e.target.value || 500);
								const next = v === 200 ? 200 : v === 500 ? 500 : v === 1000 ? 1000 : v === 2000 ? 2000 : 0;
								setRowLimit(next);
								try {
									window.localStorage.setItem(rowLimitKey, String(next));
								} catch {}
							}}
							style={{
								background: 'rgba(2,6,23,0.45)',
								border: '1px solid rgba(148,163,184,0.18)',
								color: '#e5e7eb',
								borderRadius: 10,
								padding: '6px 10px',
								fontSize: 12,
								fontWeight: 800,
							}}
							aria-label="ads-campaign-row-limit"
						>
							<option value="200">상위 200행</option>
							<option value="500">상위 500행</option>
							<option value="1000">상위 1,000행</option>
							<option value="2000">상위 2,000행</option>
							<option value="0">전체(주의)</option>
						</select>
						<div style={{ fontSize: 11, color: '#9ca3af' }}>
							{visibleRows.length.toLocaleString()} / {filteredRows.length.toLocaleString()}
						</div>
					</div>
					{props.kind === 'adgroup' && campaignFilter && (
						<div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 10 }}>
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 12, fontWeight: 900, padding: '2px 6px', color: '#93c5fd' }}
								onClick={() => navigate(`${routeBase}/campaigns`)}
								title="캠페인 분석으로 이동"
							>
								{campaignFilter}
							</button>
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 11, padding: '2px 6px' }}
								onClick={() => {
									const next = new URLSearchParams(searchParams);
									next.delete('campaign');
									setSearchParams(next, { replace: true } as any);
								}}
							>
								초기화
							</button>
						</div>
					)}
					{props.kind === 'adgroup' && !campaignFilter && groupedAdgroups ? (
						<div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 10 }}>
							<div style={{ fontSize: 11, color: '#9ca3af' }}>캠페인 그룹</div>
							<select
								value={String(adgroupGroupLimit)}
								onChange={(e) => {
									const v = Number(e.target.value || 20);
									const next = v === 10 ? 10 : v === 20 ? 20 : v === 50 ? 50 : 0;
									setAdgroupGroupLimit(next);
									try {
										window.localStorage.setItem(adgroupGroupLimitKey, String(next));
									} catch {}
								}}
								style={{
									background: 'rgba(2,6,23,0.45)',
									border: '1px solid rgba(148,163,184,0.18)',
									color: '#e5e7eb',
									borderRadius: 10,
									padding: '6px 10px',
									fontSize: 12,
									fontWeight: 800,
								}}
								aria-label="ads-adgroup-group-limit"
							>
								<option value="10">상위 10개</option>
								<option value="20">상위 20개</option>
								<option value="50">상위 50개</option>
								<option value="0">전체(주의)</option>
							</select>
							<div style={{ fontSize: 11, color: '#9ca3af' }}>
								{(visibleGroupedAdgroups?.length ?? 0).toLocaleString()} / {(groupedAdgroups?.length ?? 0).toLocaleString()}
							</div>
						</div>
					) : null}
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
					<div style={{ fontSize: 11, color: '#9ca3af' }}>
						{platform === 'gfa'
							? '운영 상태는 어제 데이터 존재 여부를 우선으로 판정하고, 어제 데이터가 없을 때만 종료일 이력을 기준으로 표시합니다.'
							: '상태는 SearchAd 메타 기준(실시간)이며, 표는 선택 기간의 성과 데이터 기준입니다.'}
					</div>
					<button
						type="button"
						onClick={() => setColumnSettingsOpen(true)}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 900,
							cursor: 'pointer',
							whiteSpace: 'nowrap',
						}}
					>
						사용자 설정
					</button>
					<button
						type="button"
						onClick={() => void handleDownloadExcel()}
						disabled={jobState.status === 'loading' && rows.length === 0}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 900,
							cursor: jobState.status === 'loading' && rows.length === 0 ? 'default' : 'pointer',
							whiteSpace: 'nowrap',
						}}
						title="현재 화면에 표시된 표 내용을 Excel 파일로 다운로드합니다."
					>
						엑셀 다운로드
					</button>
					<button
						type="button"
						onClick={() => void openAiModal()}
						style={{
							background: 'rgba(34,197,94,0.10)',
							border: '1px solid rgba(34,197,94,0.28)',
							color: '#86efac',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 900,
							cursor: 'pointer',
							whiteSpace: 'nowrap',
						}}
						title="현재 화면(기간/필터)의 데이터를 기반으로 AI 분석을 수행합니다."
					>
						AI 분석
					</button>
					{jobState.status === 'loading' ? (
						<button
							type="button"
							onClick={() => {
								const k = subscribedJobKeyRef.current;
								if (!k) return;
								adsJobCache.cancel(k);
							}}
							style={{
								background: 'rgba(248,113,113,0.12)',
								border: '1px solid rgba(248,113,113,0.35)',
								color: '#fecaca',
								borderRadius: 10,
								padding: '6px 10px',
								fontSize: 12,
								fontWeight: 900,
								cursor: 'pointer',
								whiteSpace: 'nowrap',
							}}
							title="현재 진행 중인 자동 수집을 중단합니다. (중단 버튼을 누르기 전까지는 날짜 변경/메뉴 이동으로 수집이 중단되지 않습니다.)"
						>
							수집 중단
						</button>
					) : null}
					{props.kind === 'campaign' ? (
						<button
							type="button"
							disabled={fixing}
							onClick={async () => {
								try {
									setFixing(true);
									setFixMsg('정합성 검사/누락 보정 중…');
									const dateFrom = currentRange.from;
									const dateTo = currentRange.to;
									const body: any = {
										date_from: dateFrom,
										date_to: dateTo,
										dry_run: false,
									};
									const res = await axios.post(`${props.apiBaseUrl}/ads/validate-fix`, body, { timeout: 1200000 });
									const t = res?.data?.totals;
									// validation map: 캠페인별로 missing_count>0이면 fix
									try {
										const byCamp: Record<string, Exclude<ValidationStatus, 'unknown'>> = {};
										const byGroup: Record<string, Exclude<ValidationStatus, 'unknown'>> = {};
										const proc = (res?.data?.processed || []) as any[];
										for (const day of proc) {
											for (const it of (day?.items || []) as any[]) {
												const camp = String(it?.campaign || '').trim();
												const missing = Number(it?.missing_count || 0);
												const expected = it?.expected_count;
												const fixed = Boolean(it?.fixed);
												const storedAfter = it?.stored_after == null ? null : Number(it?.stored_after);
												const grp = String(it?.adgroup || '').trim();
												if (!camp) continue;
												let grpSt: Exclude<ValidationStatus, 'unknown'> = 'ok';
												if (expected != null && Number.isFinite(Number(expected))) {
													const expN = Number(expected);
													if (missing > 0 && !(fixed && storedAfter != null && storedAfter >= expN)) grpSt = 'fix';
												} else if (missing > 0) {
													grpSt = 'fix';
												}
												if (camp && grp) byGroup[`${camp}||${grp}`] = grpSt;
												if (grpSt === 'fix') byCamp[camp] = 'fix';
												else if (!byCamp[camp]) byCamp[camp] = 'ok';
											}
										}
										const anyFix =
											Object.values(byCamp).some((v) => v === 'fix') ||
											Object.values(byGroup).some((v) => v === 'fix');
										setValidation({ byCampaign: byCamp, byGroup, anyFix, lastRange: { from: dateFrom, to: dateTo } });
										saveValidationCache({ v: 1, range: { from: dateFrom, to: dateTo }, byCampaign: byCamp, byGroup, ts: Date.now() });
									} catch {
										// ignore
									}
									if (t) {
										setFixMsg(`완료: 검사 ${t.groups_checked}, 누락 ${t.groups_mismatch}, 보정 ${t.groups_fixed}, 대기 ${t.groups_skipped_not_ready}`);
									} else {
										setFixMsg('완료');
									}
									// 최신 데이터 반영
									adsJobCache.invalidate(`ads-campaign-view|${props.apiBaseUrl}|${props.kind}|`);
									setReloadTick((x) => x + 1);
								} catch (e: any) {
									const msg = e?.response?.data?.detail ?? e?.message ?? '정합성 검사/보정에 실패했습니다.';
									setFixMsg(String(msg));
								} finally {
									setFixing(false);
									// 메시지는 잠시 남겨둔다(사용자가 결과를 확인)
									window.setTimeout(() => setFixMsg(null), 6000);
								}
							}}
							style={{
								background: 'rgba(2,6,23,0.45)',
								border: '1px solid rgba(148,163,184,0.18)',
								color: fixing ? '#9ca3af' : '#e5e7eb',
								borderRadius: 10,
								padding: '6px 10px',
								fontSize: 12,
								fontWeight: 900,
								cursor: fixing ? 'default' : 'pointer',
								whiteSpace: 'nowrap',
							}}
							title="광고그룹별 expected(네이버) vs stored(DB) 비교 후 누락 그룹만 재수집합니다."
						>
							정합성 검사/보정
						</button>
					) : null}
					<button
						type="button"
						onClick={() => {
							// 수집/DB 갱신 후에도 화면이 캐시된 값을 유지할 수 있어, 강제 새로고침을 제공한다.
							adsJobCache.invalidate(`ads-campaign-view|${props.apiBaseUrl}|${props.kind}|`);
							setReloadTick((x) => x + 1);
						}}
						style={{
							background: 'rgba(2,6,23,0.45)',
							border: '1px solid rgba(148,163,184,0.18)',
							color: '#e5e7eb',
							borderRadius: 10,
							padding: '6px 10px',
							fontSize: 12,
							fontWeight: 900,
							cursor: 'pointer',
							whiteSpace: 'nowrap',
						}}
					>
						새로고침
					</button>
				</div>
			</div>
			{fixMsg ? <ProgressCard message={fixMsg} /> : null}
			<AdsColumnSettingsModal
				open={columnSettingsOpen}
				title={title}
				options={campaignColumnOptions}
				selectedKeys={campaignVisibleKeys}
				onChange={(nextSelectedKeys) => {
					setHiddenColumnKeys(
						hiddenKeysFromSelected(
							campaignColumnOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey),
							nextSelectedKeys as Array<AdsLeftColumnKey | AdsMetricColumnKey>,
						),
					);
				}}
				onClose={() => setColumnSettingsOpen(false)}
				onReset={() => setHiddenColumnKeys([])}
			/>
			{jobState.message && (
				<ProgressCard message={jobState.message} />
			)}
			{jobState.error && (
				<div className="card" style={{ borderColor: 'rgba(248,113,113,0.55)' }}>
					<div style={{ fontSize: 12, color: '#fecaca' }}>{jobState.error}</div>
				</div>
			)}
			{jobState.status === 'loading' && (
				<div className="card" style={{ fontSize: 12, color: '#9ca3af' }}>
					불러오는 중…
				</div>
			)}
			<AdsPerformanceTrendCard
				title={title}
				trendPoints={activeTrendPoints}
				hasPurchaseMetrics={hasPurchaseMetrics}
				leftMetric={leftTrendMetric}
				rightMetric={rightTrendMetric}
				selectedLabel={selectedTrendLabel}
				onClearSelection={() => setSelectedTrendRowKey(null)}
				onChangeLeftMetric={changeLeftTrendMetric}
				onChangeRightMetric={changeRightTrendMetric}
			/>
			{aiOpen ? (
				<div className="modal-backdrop" role="dialog" aria-label="AI 분석">
					<div className="modal-card" style={{ maxWidth: 980 }}>
						<div className="modal-header">
							<div className="modal-title">AI 분석 · {props.kind === 'campaign' ? '캠페인' : '광고 그룹'}</div>
							<button type="button" className="btn-ghost" onClick={() => setAiOpen(false)} disabled={aiLoading}>
								닫기
							</button>
						</div>
						<div className="modal-body" style={{ fontSize: 12, color: '#cbd5e1' }}>
							<div style={{ marginBottom: 10, color: '#9ca3af', lineHeight: 1.45 }}>
								현재 화면의 <b style={{ color: '#e5e7eb' }}>기간</b>과 <b style={{ color: '#e5e7eb' }}>필터</b>를 기준으로 analytics DB를 조회한 뒤,
								요약 데이터(Top 30 + 비교기간)를 AI에 전달해 분석합니다.
								<div style={{ marginTop: 6 }}>
									- 기간: <b style={{ color: '#e5e7eb' }}>{currentRange.from}</b> ~ <b style={{ color: '#e5e7eb' }}>{currentRange.to}</b>
									{props.kind === 'adgroup' && campaignFilter ? (
										<span>
											{' '}
											/ 캠페인 필터: <b style={{ color: '#e5e7eb' }}>{campaignFilter}</b>
										</span>
									) : null}
									{' '}
									/ 소스: <b style={{ color: '#e5e7eb' }}>creative</b>
								</div>
							</div>

							<div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center', marginBottom: 10 }}>
								<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>모델</div>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 10, alignItems: 'center' }}>
									<select
										aria-label="ads-ai-model-select"
										value={aiModel}
										onChange={(e) => setAiModel(e.target.value)}
										disabled={aiModels.length === 0}
										style={{
											width: '100%',
											borderRadius: 10,
											padding: '8px 10px',
											background: 'rgba(15, 23, 42, 0.6)',
											border: '1px solid rgba(148,163,184,0.2)',
											color: '#e5e7eb',
										}}
									>
										{aiModels.length === 0 ? <option value={aiModel}>모델 목록 로딩 실패(직접 입력)</option> : null}
										{aiModels.map((m) => (
											<option key={m.id} value={m.id}>
												{m.id}
											</option>
										))}
									</select>
									<input
										aria-label="ads-ai-model-input"
										value={aiModel}
										onChange={(e) => setAiModel(e.target.value)}
										placeholder="직접 입력(예: gpt-4o-mini)"
										style={{
											width: '100%',
											borderRadius: 10,
											padding: '8px 10px',
											background: 'rgba(15, 23, 42, 0.6)',
											border: '1px solid rgba(148,163,184,0.2)',
											color: '#e5e7eb',
										}}
									/>
								</div>
							</div>

							<div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, marginBottom: 10 }}>
								<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb', paddingTop: 8 }}>질문</div>
								<textarea
									aria-label="ads-ai-question"
									value={aiQuestion}
									onChange={(e) => setAiQuestion(e.target.value)}
									rows={3}
									style={{
										width: '100%',
										borderRadius: 10,
										padding: '8px 10px',
										background: 'rgba(15, 23, 42, 0.6)',
										border: '1px solid rgba(148,163,184,0.2)',
										color: '#e5e7eb',
										resize: 'vertical',
									}}
								/>
							</div>

							{aiError ? (
								<div style={{ marginBottom: 10, fontSize: 12, color: '#fecaca' }}>
									{aiError}
								</div>
							) : null}

							<div style={{ display: 'grid', gap: 8 }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
									<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>분석 결과</div>
									<div style={{ fontSize: 11, color: '#9ca3af' }}>결과는 요약(Top 30) 기반입니다.</div>
								</div>
								<div
									style={{
										minHeight: 240,
										maxHeight: 420,
										overflow: 'auto',
										borderRadius: 10,
										padding: '10px 12px',
										background: 'rgba(2,6,23,0.45)',
										border: '1px solid rgba(148,163,184,0.18)',
										whiteSpace: 'pre-wrap',
										color: '#e5e7eb',
										fontSize: 12,
										lineHeight: 1.5,
									}}
								>
									{aiThread.length === 0 ? (
										'아직 실행 전입니다.'
									) : (
										aiThread.map((m, idx) => (
											<div
												key={`${m.ts}-${idx}`}
												style={{
													marginBottom: 10,
													padding: '8px 10px',
													borderRadius: 12,
													border: `1px solid ${m.role === 'user' ? 'rgba(59,130,246,0.35)' : 'rgba(148,163,184,0.18)'}`,
													background: m.role === 'user' ? 'rgba(59,130,246,0.10)' : 'rgba(148,163,184,0.08)',
												}}
											>
												<div style={{ fontSize: 11, fontWeight: 900, marginBottom: 6, color: m.role === 'user' ? '#93c5fd' : '#e5e7eb' }}>
													{m.role === 'user' ? 'USER' : 'ASSISTANT'}
												</div>
												<div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
											</div>
										))
									)}
								</div>
							</div>

							{/* 이미지처럼 “추가 질문 이어서” 영역 */}
							<div style={{ marginTop: 12, borderTop: '1px dashed rgba(248,113,113,0.55)', paddingTop: 12 }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
									<div style={{ fontSize: 12, fontWeight: 900, color: '#e5e7eb' }}>추가 질문 이어서</div>
									<button
										type="button"
										className="btn-ghost"
										disabled={aiLoading || aiThread.length === 0}
										onClick={() => {
											setAiThread([]);
											setAiError(null);
											setAiFollowup('');
										}}
										title="현재 대화/결과를 초기화합니다."
									>
										대화 초기화
									</button>
								</div>
								<div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, alignItems: 'start' }}>
									<textarea
										aria-label="ads-ai-followup"
										value={aiFollowup}
										onChange={(e) => setAiFollowup(e.target.value)}
										placeholder={aiThread.length === 0 ? '먼저 “분석 실행”으로 최초 분석을 수행하세요.' : '추가 질문을 입력하세요…'}
										rows={2}
										disabled={aiLoading || aiThread.length === 0}
										style={{
											width: '100%',
											borderRadius: 10,
											padding: '10px 12px',
											background: 'rgba(15, 23, 42, 0.6)',
											border: '1px solid rgba(248,113,113,0.35)',
											color: '#e5e7eb',
											resize: 'vertical',
										}}
									/>
									<button
										type="button"
										style={{
											background: aiLoading || aiThread.length === 0 ? 'rgba(148,163,184,0.10)' : 'rgba(34,197,94,0.18)',
											border: '1px solid rgba(248,113,113,0.55)',
											color: aiLoading || aiThread.length === 0 ? '#9ca3af' : '#e5e7eb',
											borderRadius: 10,
											padding: '10px 12px',
											fontSize: 12,
											fontWeight: 900,
											cursor: aiLoading || aiThread.length === 0 ? 'default' : 'pointer',
											whiteSpace: 'nowrap',
										}}
										disabled={aiLoading || aiThread.length === 0}
										onClick={() => void runAiAnalyze('followup')}
									>
										{aiLoading ? '분석 중…' : '질문 전송'}
									</button>
								</div>
							</div>
						</div>
						<div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
							<button type="button" className="btn-ghost" onClick={() => setAiOpen(false)} disabled={aiLoading}>
								닫기
							</button>
							<button type="button" className="btn-primary" onClick={() => void runAiAnalyze('fresh')} disabled={aiLoading}>
								{aiLoading ? '분석 중…' : '분석 실행'}
							</button>
						</div>
					</div>
				</div>
			) : null}
			{props.kind === 'adgroup' && !campaignFilter && groupedAdgroups ? (
				<div className="space-y-3">
					{(visibleGroupedAdgroups ?? groupedAdgroups).map((g) => (
						<AdsTable
							key={g.camp}
							title={`광고 그룹 분석 · ${g.camp}`}
							columns={visibleLeftColumns}
							leftColPx={leftColPx}
							visibleMetricKeys={visibleMetricKeys}
							selectedRowKey={selectedTrendRowKey}
							onRowClick={(row) => setSelectedTrendRowKey(row.key)}
							rows={g.rows}
							totalRow={g.subtotal}
							renderTotalCell={({ row, colKey }) => {
								if (colKey !== 'primary') return undefined;
								const st = statusForCampaign(g.camp);
								return (
									<span>
										{totalDot(st)}
										{row.primary}
									</span>
								);
							}}
							renderCell={({ row, colKey }) => {
								// 광고그룹 분석: 광고그룹명 클릭 → 소재 분석 이동
								if (colKey === 'primary') {
									const adgroupName = String(row.primary || '').trim();
									const campaignName = String(row.secondary || '').trim();
									if (!adgroupName) return row.primary;
									return (
										<button
											type="button"
											onClick={() => {
												const q = new URLSearchParams();
												if (campaignName) q.append('campaign', campaignName);
												q.append('adgroup', adgroupName);
												navigate(`${routeBase}/creatives?${q.toString()}`);
											}}
											style={{
												all: 'unset',
												cursor: 'pointer',
												color: '#93c5fd',
												fontWeight: 900,
											}}
											aria-label={`${campaignName} / ${adgroupName}`}
											title="클릭하여 해당 광고그룹의 소재 분석 보기"
										>
											{adgroupName}
										</button>
									);
								}
								return undefined;
							}}
						/>
					))}
				</div>
			) : (
				<AdsTable
					title={title}
					columns={visibleLeftColumns}
					leftColPx={leftColPx}
					visibleMetricKeys={visibleMetricKeys}
					selectedRowKey={selectedTrendRowKey}
					onRowClick={(row) => setSelectedTrendRowKey(row.key)}
					renderTotalCell={({ row, colKey }) => {
						if (colKey !== 'primary') return undefined;
						const st = statusForOverall();
						return (
							<span>
								{totalDot(st)}
								{row.primary}
							</span>
						);
					}}
					renderCell={({ row, colKey }) => {
					// 캠페인 분석: 캠페인명 클릭 → 광고그룹 분석으로 이동 + 해당 캠페인만 필터링
					if (props.kind === 'campaign' && colKey === 'primary') {
						const raw = String(row.primary || '').trim();
						if (!raw) return row.primary;
						const displayName = raw;
						// query도 원문을 유지한다(backend가 '# 유무'를 동치 처리)
						const campaignQuery = raw;
						const st = statusForCampaign(displayName);
						return (
							<button
								type="button"
								onClick={() => {
									const q = new URLSearchParams();
									q.set('campaign', campaignQuery);
									navigate(`${routeBase}/adgroups?${q.toString()}`);
								}}
								style={{
									all: 'unset',
									cursor: 'pointer',
									color: '#93c5fd',
									fontWeight: 900,
								}}
								aria-label={displayName}
								title="클릭하여 해당 캠페인의 광고그룹 보기"
							>
								<span>
									{totalDot(st)}
									{displayName}
								</span>
							</button>
						);
					}
					// 광고그룹 분석: 광고그룹명 클릭 → 소재 분석으로 이동 + 해당 (캠페인/광고그룹)만 필터링
					if (props.kind === 'adgroup' && colKey === 'primary') {
						const adgroupName = String(row.primary || '').trim();
						const campaignName = String(row.secondary || '').trim();
						if (!adgroupName) return row.primary;
						return (
							<button
								type="button"
								onClick={() => {
									const q = new URLSearchParams();
									// 원문 유지(불필요한 문자 제거 방지)
									if (campaignName) q.append('campaign', campaignName);
									q.append('adgroup', adgroupName);
									navigate(`${routeBase}/creatives?${q.toString()}`);
								}}
								style={{
									all: 'unset',
									cursor: 'pointer',
									color: '#93c5fd',
									fontWeight: 900,
								}}
								aria-label={`${campaignName} / ${adgroupName}`}
								title="클릭하여 해당 광고그룹의 소재 분석 보기"
							>
								{adgroupName}
							</button>
						);
					}
					return undefined;
					}}
					rows={visibleRows}
				totalRow={filteredTotalRow}
				/>
			)}
		</div>
	);
}


