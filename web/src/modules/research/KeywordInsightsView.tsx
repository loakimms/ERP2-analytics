import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useLocation, useNavigate } from 'react-router-dom';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	LabelList,
	Line,
	LineChart,
	ResponsiveContainer,
	ReferenceArea,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { readInitialKeywordInsightsNavigationQuery } from '../../shared/navigation/analyticsNavigation';

type KeywordTrendPoint = { date: string; ratio: number };
type KeywordEstimatedPoint = { date: string; searches: number };
type KeywordDistributionItem = { label: string; ratio: number };

type KeywordToolRow = {
	relKeyword: string;
	monthlyPcQcCnt?: number | null;
	monthlyMobileQcCnt?: number | null;
	monthlyAvePcClkCnt?: number | null;
	monthlyAveMobileClkCnt?: number | null;
	monthlyAvePcCtr?: number | null;
	monthlyAveMobileCtr?: number | null;
	plAvgDepth?: number | null;
	compIdx?: string | null;
	totalSearchQcCnt?: number | null;
	totalAdClkCnt?: number | null;
	avgCtr?: number | null;
	searchedAt?: string | null;
};

type KeywordInsightsResponse = {
	keyword: string;
	date_from: string;
	date_to: string;
	cached: boolean;
	searchedAt?: string | null;
	keywordSummary?: {
		pcSearch: number;
		mobileSearch: number;
		totalSearch: number;
		productCount: number;
		posts: number;
		pcCtr: number | null;
		mobileCtr: number | null;
		avgCtr: number | null;
		searchedAt: string;
		note?: string;
	} | null;
	trend: {
		points: KeywordTrendPoint[];
		estimatedDailySearches?: {
			baselineDays: number;
			baselineFrom: string;
			baselineTo: string;
			monthlyTotal: number;
			points: KeywordEstimatedPoint[];
		} | null;
	};
	distributions: {
		gender: KeywordDistributionItem[];
		age: KeywordDistributionItem[];
		device: KeywordDistributionItem[];
		dayOfWeek: KeywordDistributionItem[];
	};
	relatedKeywords: KeywordToolRow[];
	shopping: {
		category: string | null;
		productCount: number;
		categoryPath?: string | null;
		categoryConfidencePct?: number | null;
		categoryTop3?: Array<{ path: string; count: number; confidencePct: number }> | null;
		categoryIdSource?: string | null;
	};
	blogCount?: number | null;
	keywordToolError?: string | null;
};

type ShoppingSearchOpenResponse = {
	running: boolean;
	mode: string;
	requestedUrl: string;
	pageUrl: string;
	pageType?: 'search' | 'seed' | 'smartstore' | 'other' | 'none';
	devtools?: { url?: string | null; jsonListUrl?: string | null; running?: boolean } | null;
	blockDetected?: boolean;
	blockReason?: 'access_limited' | 'captcha' | 'blocked' | null;
	openedSeed?: boolean;
	seedUrl?: string | null;
};

type ShoppingSearchStatusResponse = {
	running: boolean;
	mode: string;
	pageUrl: string | null;
	pageType?: 'search' | 'seed' | 'smartstore' | 'other' | 'none';
	nextDataFound: boolean;
	blockDetected: boolean;
	blockReason?: 'access_limited' | 'captcha' | 'blocked' | null;
	seedReady?: boolean;
};

const TOP_CATEGORY_MAP: Array<{ label: string; id: string }> = [
	{ label: '패션의류', id: '50000000' },
	{ label: '패션잡화', id: '50000001' },
	{ label: '화장품/미용', id: '50000002' },
	{ label: '디지털/가전', id: '50000003' },
	{ label: '가구/인테리어', id: '50000004' },
	{ label: '출산/육아', id: '50000005' },
	{ label: '식품', id: '50000006' },
	{ label: '스포츠/레저', id: '50000007' },
	{ label: '생활/건강', id: '50000008' },
	{ label: '여가/생활편의', id: '50000009' },
	{ label: '면세점', id: '50000010' },
];

const CATEGORY_PATH_MAP_LS_KEY = 'erp2:nvShoppingCategoryIdByPath:v1';
// Legacy single mapping (keyword -> single categoryId)
const KEYWORD_CATEGORY_MAP_LS_KEY = 'erp2:nvShoppingCategoryIdByKeyword:v1';
// New: keyword -> list of candidate categoryIds (+ selected/default)
const KEYWORD_CATEGORY_CHOICES_LS_KEY = 'erp2:nvShoppingCategoryChoicesByKeyword:v1';

// KeywordInsights 전용: 키워드별로 사용자가 "최종 적용"한 카테고리(사전 선택)를 저장
const KEYWORD_INSIGHTS_CATEGORY_SELECTION_LS_KEY = 'erp2:keywordInsightsSelectedCategoryByKeyword:v1';

function normalizeCategoryPath(p: string): string {
	return String(p || '')
		.replace(/\s+/g, ' ')
		.split('>')
		.map((s) => s.trim())
		.filter(Boolean)
		.join(' > ');
}

function mainCategoryOfPath(p: string | null | undefined): string {
	const normalized = normalizeCategoryPath(String(p || ''));
	return normalized.split(' > ')[0]?.trim() || '';
}

function categoryLabelForId(id: string): string | null {
	const s = String(id || '').trim();
	if (!s) return null;
	const top = TOP_CATEGORY_MAP.find((x) => x.id === s);
	if (top?.label) return top.label;
	// path-map에서 역으로 하나 찾아 라벨로 사용(있으면 더 구체적)
	try {
		const map = loadCategoryPathMap();
		const entries = Object.entries(map).filter(([, v]) => String(v || '').trim() === s);
		if (!entries.length) return null;
		// 가장 짧은(=대개 핵심) 경로를 하나 반환
		entries.sort((a, b) => a[0].length - b[0].length);
		return entries[0]?.[0] || null;
	} catch {
		return null;
	}
}

function fmtCategoryOption(id: string, useCount?: number): string {
	const s = String(id || '').trim();
	if (!s) return '';
	const label = categoryLabelForId(s);
	const base = label ? `${label} (${s})` : s;
	if (typeof useCount === 'number') return `${base} · 사용 ${useCount}`;
	return base;
}

function loadCategoryPathMap(): Record<string, string> {
	try {
		const raw = localStorage.getItem(CATEGORY_PATH_MAP_LS_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			const kk = normalizeCategoryPath(String(k || ''));
			const vv = String(v || '').trim();
			if (kk && /^\d{6,}$/.test(vv)) out[kk] = vv;
		}
		return out;
	} catch {
		return {};
	}
}

function saveCategoryPathMap(map: Record<string, string>) {
	try {
		localStorage.setItem(CATEGORY_PATH_MAP_LS_KEY, JSON.stringify(map));
	} catch {
		// ignore
	}
}

function normalizeKeyword(k: string): string {
	return String(k || '').trim().replace(/\s+/g, ' ');
}

function normalizeForSearch(s: string): string {
	return String(s || '')
		.toLowerCase()
		.replace(/[\s>/]/g, '');
}

type KeywordInsightsCategorySelection = { id: string; path: string; selectedAt: string };
type KeywordInsightsCategorySelectionStore = Record<string, KeywordInsightsCategorySelection>;

function loadKeywordInsightsCategorySelectionStore(): KeywordInsightsCategorySelectionStore {
	const parsed = _readJsonLs(KEYWORD_INSIGHTS_CATEGORY_SELECTION_LS_KEY);
	if (!parsed || typeof parsed !== 'object') return {};
	const out: KeywordInsightsCategorySelectionStore = {};
	for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
		const kk = normalizeKeyword(String(k || ''));
		if (!kk) continue;
		const id = String(v?.id || '').trim();
		const path = String(v?.path || '').trim();
		const selectedAt = String(v?.selectedAt || '').trim();
		if (!/^\d{6,}$/.test(id) || !path) continue;
		out[kk] = { id, path, selectedAt: selectedAt || new Date().toISOString() };
	}
	return out;
}

function saveKeywordInsightsCategorySelectionStore(store: KeywordInsightsCategorySelectionStore) {
	_writeJsonLs(KEYWORD_INSIGHTS_CATEGORY_SELECTION_LS_KEY, store);
}

async function loadSeoCategoryDictionaryEntries(apiBaseUrl: string): Promise<Array<{ id: string; path: string }>> {
	const normalize = (rows: any): Array<{ id: string; path: string }> => {
		const list = Array.isArray(rows) ? rows : [];
		const out: Array<{ id: string; path: string }> = [];
		for (const r of list) {
			const id = String(r?.id || '').trim();
			const path = String(r?.path || '').trim();
			if (!/^\d+$/.test(id) || !path) continue;
			out.push({ id, path });
		}
		return out;
	};
	const res = await axios.get(`${apiBaseUrl}/seo/category-dictionary`);
	return normalize((res.data as any)?.items);
}

function CategoryDictionarySearchModal(props: {
	apiBaseUrl: string;
	open: boolean;
	initialQuery?: string;
	onClose: () => void;
	onSelect: (v: { id: string; path: string }) => void;
	onOpenDictionarySettings: () => void;
}): JSX.Element | null {
	const open = Boolean(props.open);
	const [query, setQuery] = useState(() => String(props.initialQuery || ''));
	const [loading, setLoading] = useState(false);
	const [entries, setEntries] = useState<Array<{ id: string; path: string }>>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setQuery(String(props.initialQuery || ''));
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const list = await loadSeoCategoryDictionaryEntries(props.apiBaseUrl);
				setEntries(list);
			} catch (e: any) {
				setError(String(e?.message || '카테고리 사전을 불러오지 못했습니다.'));
				setEntries([]);
			} finally {
				setLoading(false);
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const filtered = useMemo(() => {
		const q = (query || '').trim();
		if (!q) return [];
		const nq = normalizeForSearch(q);
		if (!nq) return [];
		const out = entries.filter((e) => normalizeForSearch(e.path).includes(nq) || String(e.id).includes(q));
		return out.slice(0, 200);
	}, [entries, query]);

	if (!open) return null;

	return (
		<div className="modal-backdrop" role="dialog" aria-label="카테고리 검색">
			<div className="modal-card" style={{ maxWidth: 980, width: '80vw' }}>
				<div className="modal-header">
					<div className="modal-title">카테고리 검색</div>
					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className="btn-ghost" onClick={props.onClose}>
							닫기
						</button>
					</div>
				</div>
				<div className="modal-body" style={{ display: 'grid', gap: 10 }}>
					<div>
						<label className="field-label" htmlFor="kw-cat-search">
							카테고리 검색어
						</label>
						<input
							id="kw-cat-search"
							className="input"
							placeholder="예: 염색약, DIY, 화장품"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							autoFocus
						/>
						<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
							카테고리 사전에서 키워드가 포함된 항목을 찾습니다. (최대 200건 표시)
						</div>
						<div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
							<span className="badge" style={{ opacity: 0.85 }}>
								사전 관리는 “설정 &gt; 카테고리 사전”에서 합니다.
							</span>
							<button type="button" className="btn-ghost" onClick={props.onOpenDictionarySettings}>
								카테고리 사전 열기
							</button>
						</div>
					</div>

					{error ? <div style={{ fontSize: 12, color: '#fecaca', fontWeight: 900 }}>{error}</div> : null}
					{loading ? <div style={{ fontSize: 12, color: '#94a3b8' }}>불러오는 중…</div> : null}

					{!query.trim() ? (
						<div style={{ fontSize: 12, color: '#94a3b8' }}>검색어를 입력하면 결과가 표시됩니다.</div>
					) : filtered.length === 0 ? (
						<div style={{ fontSize: 12, color: '#94a3b8' }}>검색 결과가 없습니다.</div>
					) : (
						<div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid rgba(148,163,184,0.14)', borderRadius: 10 }}>
							{filtered.map((e, idx) => (
								<button
									type="button"
									key={`${e.id}|${e.path}|${idx}`}
									className="seo-cat-item"
									style={{
										width: '100%',
										justifyContent: 'flex-start',
										borderTop: idx === 0 ? 'none' : '1px solid rgba(148,163,184,0.10)',
										borderRadius: 0,
									}}
									onClick={() => props.onSelect(e)}
								>
									<span style={{ fontWeight: 900, color: '#bbf7d0', marginRight: 8 }}>{e.id}</span>
									<span style={{ fontWeight: 900 }}>{e.path}</span>
								</button>
							))}
						</div>
					)}
				</div>
				<div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end' }}>
					<button type="button" className="btn-ghost" onClick={props.onClose}>
						닫기
					</button>
				</div>
			</div>
		</div>
	);
}

type KeywordCategoryChoice = { id: string; useCount?: number; lastUsedAt?: string };
type KeywordCategoryChoiceSet = { selectedId?: string; items: KeywordCategoryChoice[] };
type KeywordCategoryChoicesStore = Record<string, KeywordCategoryChoiceSet>;

function _readJsonLs(key: string): unknown {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function _writeJsonLs(key: string, v: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(v));
	} catch {
		// ignore
	}
}

function loadKeywordCategoryChoicesStore(): KeywordCategoryChoicesStore {
	// 1) New store
	const parsed = _readJsonLs(KEYWORD_CATEGORY_CHOICES_LS_KEY);
	if (parsed && typeof parsed === 'object') {
		const out: KeywordCategoryChoicesStore = {};
		for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
			const kk = normalizeKeyword(String(k || ''));
			if (!kk) continue;
			const set = v || {};
			const selectedId = String(set.selectedId || '').trim();
			const itemsRaw = Array.isArray(set.items) ? set.items : [];
			const items: KeywordCategoryChoice[] = [];
			for (const it of itemsRaw) {
				const id = String(it?.id || '').trim();
				if (!/^\d{6,}$/.test(id)) continue;
				const useCount = Number(it?.useCount);
				const lastUsedAt = String(it?.lastUsedAt || '').trim();
				items.push({
					id,
					useCount: Number.isFinite(useCount) ? Math.max(0, Math.floor(useCount)) : undefined,
					lastUsedAt: lastUsedAt || undefined,
				});
			}
			out[kk] = { selectedId: selectedId || undefined, items };
		}
		return out;
	}

	// 2) Legacy migration: keyword -> single id
	const legacy = _readJsonLs(KEYWORD_CATEGORY_MAP_LS_KEY);
	const out: KeywordCategoryChoicesStore = {};
	if (legacy && typeof legacy === 'object') {
		for (const [k, v] of Object.entries(legacy as Record<string, unknown>)) {
			const kk = normalizeKeyword(String(k || ''));
			const id = String(v || '').trim();
			if (!kk || !/^\d{6,}$/.test(id)) continue;
			out[kk] = { selectedId: id, items: [{ id, useCount: 1 }] };
		}
		// persist migration once
		_writeJsonLs(KEYWORD_CATEGORY_CHOICES_LS_KEY, out);
	}
	return out;
}

function saveKeywordCategoryChoicesStore(store: KeywordCategoryChoicesStore) {
	_writeJsonLs(KEYWORD_CATEGORY_CHOICES_LS_KEY, store);
}

function toYmd(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function addDays(base: Date, days: number): Date {
	const d = new Date(base);
	d.setDate(d.getDate() + days);
	return d;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
	if (!rows.length) return;
	const headers = Object.keys(rows[0]!);
	const lines = [headers.join(',')].concat(
		rows.map((r) =>
			headers
				.map((h) => {
					const v = r[h];
					const s = v === null || v === undefined ? '' : String(v);
					// CSV escaping
					const escaped = s.replace(/"/g, '""');
					return `"${escaped}"`;
				})
				.join(','),
		),
	);
	// Windows Excel(특히 한글 로케일)은 UTF-8 CSV를 BOM 없이 열면 글자가 깨지는 경우가 많다.
	// - UTF-8 BOM(\\uFEFF)을 선두에 붙여 인코딩을 강제한다.
	// - 줄바꿈은 CRLF(\\r\\n)를 사용해 엑셀 호환을 높인다.
	const csv = `\uFEFF${lines.join('\r\n')}`;
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function fmtInt(v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return '-';
	return Math.round(v).toLocaleString();
}

function fmtFloat(v: number | null | undefined, digits: number): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return '-';
	return v.toFixed(digits);
}

function fmtPct(v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return '-';
	return `${v.toFixed(2)}%`;
}

function shoppingInfoLabel(plAvgDepth: number | null | undefined): string {
	const d = typeof plAvgDepth === 'number' && Number.isFinite(plAvgDepth) ? plAvgDepth : null;
	if (d === null) return '-';
	// SearchAd keywordstool의 plAvgDepth는 흔히 "쇼핑성" 지표로 해석된다(값이 높을수록 쇼핑성↑).
	// 정보성은 별도 필드가 없으므로, UI에서는 구간 라벨(정보성/혼합/쇼핑성) + 수치로 표시한다.
	let label = '혼합';
	if (d >= 11) label = '쇼핑성';
	else if (d <= 5) label = '정보성';
	return `${label}(${d.toFixed(1)})`;
}

const tooltipProps = {
	contentStyle: {
		backgroundColor: '#0b1220',
		border: '1px solid #22314f',
		borderRadius: 10,
		color: '#e5e7eb',
	},
	labelStyle: { color: '#cbd5e1' },
	itemStyle: { color: '#e5e7eb' },
};

function pctLabel(v: unknown): string {
	const n = Number(v);
	if (!Number.isFinite(n)) return '';
	return `${n.toFixed(1)}%`;
}

function renderRightPercent(props: any) {
	const { x, y, width, height, value, fill } = props;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	const resolvedFill = !fill || fill === 'transparent' ? '#e5e7eb' : fill;
	return (
		<text x={x + width + 10} y={y + height / 2 + 4} fill={resolvedFill} fontSize={15} fontWeight={900}>
			{pctLabel(n)}
		</text>
	);
}

function PremiumHBarChart(props: {
	data: KeywordDistributionItem[];
	colorFn: (label: string) => { fill: string; stroke?: string; strokeWidth?: number; fillOpacity?: number };
}) {
	const { data, colorFn } = props;
	return (
		<ResponsiveContainer>
			<BarChart data={data} layout="vertical" margin={{ top: 6, right: 40, left: 10, bottom: 6 }}>
				<CartesianGrid stroke="rgba(148,163,184,0.12)" horizontal={false} />
				<XAxis type="number" domain={[0, 100]} hide />
				<YAxis
					type="category"
					dataKey="label"
					width={56}
					axisLine={false}
					tickLine={false}
					stroke="#cbd5e1"
					tick={{ fontSize: 12, fontWeight: 700, fill: '#cbd5e1' }}
				/>
				<Tooltip {...tooltipProps} />
				<Bar
					dataKey="ratio"
					barSize={22}
					minPointSize={6}
					radius={[10, 10, 10, 10]}
					background={{ fill: 'rgba(148,163,184,0.10)', stroke: 'rgba(148,163,184,0.20)', strokeWidth: 1, radius: 10 }}
					isAnimationActive={false}
				>
					{data.map((d) => {
						const c = colorFn(d.label);
						return (
							<Cell
								key={d.label}
								fill={c.fill}
								fillOpacity={c.fillOpacity ?? 1}
								stroke={c.stroke}
								strokeWidth={c.strokeWidth ?? 3}
							/>
						);
					})}
					<LabelList dataKey="ratio" position="right" content={renderRightPercent} />
				</Bar>
			</BarChart>
		</ResponsiveContainer>
	);
}

function parseYmd(s: string): Date | null {
	try {
		const d = new Date(`${s}T00:00:00`);
		return Number.isFinite(d.getTime()) ? d : null;
	} catch {
		return null;
	}
}

const DatePickerInput = React.forwardRef<HTMLInputElement, any>(function DatePickerInput(props, ref) {
	const { className, ...rest } = props || {};
	return <input ref={ref} className={`input ${className || ''}`} readOnly {...rest} />;
});

function pad2(n: number) {
	return String(n).padStart(2, '0');
}

function lastDayOfMonth(year: number, month1to12: number): number {
	// month is 1..12
	return new Date(year, month1to12, 0).getDate();
}

type SeasonBlock = { x1: string; x2: string; label: string };

function computeSeasonBlocks(points: KeywordEstimatedPoint[]): SeasonBlock[] {
	// 1) 월(1~12) 별 평균 검색량(연도 통합)
	const byMonth: Record<number, { sum: number; cnt: number }> = {};
	const years = new Set<number>();
	for (const p of points) {
		const d = parseYmd(p.date);
		if (!d) continue;
		const m = d.getMonth() + 1;
		const y = d.getFullYear();
		years.add(y);
		byMonth[m] = byMonth[m] || { sum: 0, cnt: 0 };
		byMonth[m]!.sum += p.searches;
		byMonth[m]!.cnt += 1;
	}
	const monthAvg = Array.from({ length: 12 }, (_, i) => {
		const m = i + 1;
		const v = byMonth[m] && byMonth[m]!.cnt ? byMonth[m]!.sum / byMonth[m]!.cnt : 0;
		return { m, v };
	});
	const vals = monthAvg.map((x) => x.v).filter((v) => v > 0).sort((a, b) => a - b);
	if (!vals.length) return [];
	const median = vals[Math.floor(vals.length / 2)]!;
	// 2) median 대비 높은 달을 '시즌'으로 간주(휴리스틱)
	const threshold = median * 1.35;
	const hotMonths = monthAvg.filter((x) => x.v >= threshold).map((x) => x.m);
	if (!hotMonths.length) return [];
	hotMonths.sort((a, b) => a - b);

	// 3) 연속 월 구간으로 묶기
	const ranges: Array<{ start: number; end: number }> = [];
	let start = hotMonths[0]!;
	let prev = hotMonths[0]!;
	for (let i = 1; i < hotMonths.length; i++) {
		const cur = hotMonths[i]!;
		if (cur === prev + 1) {
			prev = cur;
			continue;
		}
		ranges.push({ start, end: prev });
		start = cur;
		prev = cur;
	}
	ranges.push({ start, end: prev });

	const blocks: SeasonBlock[] = [];
	const ys = Array.from(years).sort((a, b) => a - b);
	for (const y of ys) {
		for (const r of ranges) {
			const x1 = `${y}-${pad2(r.start)}-01`;
			const x2 = `${y}-${pad2(r.end)}-${pad2(lastDayOfMonth(y, r.end))}`;
			blocks.push({ x1, x2, label: `${r.start}~${r.end}월` });
		}
	}
	return blocks;
}

export function KeywordInsightsView(props: {
	apiBaseUrl: string;
	initialKeyword?: string;
	initialDateFrom?: string;
	initialDateTo?: string;
	/** 마운트 직후 1회 자동 조회 */
	autoRun?: boolean;
	/** 모달 등에서 트렌드만 보여주기 */
	viewMode?: 'full' | 'trendsOnly';
}): JSX.Element {
	const { apiBaseUrl } = props;
	const location = useLocation();
	const navigate = useNavigate();
	const today = useMemo(() => new Date(), []);
	const defaultKeyword = String(props.initialKeyword ?? '헤나');
	const defaultDateFrom = String(props.initialDateFrom ?? toYmd(addDays(today, -30)));
	const defaultDateTo = String(props.initialDateTo ?? toYmd(today));
	const initialNavigation = useMemo(
		() =>
			readInitialKeywordInsightsNavigationQuery(location.search, {
				keyword: defaultKeyword,
				fromYmd: defaultDateFrom,
				toYmd: defaultDateTo,
				autoRun: props.autoRun,
			}),
		[defaultDateFrom, defaultDateTo, defaultKeyword, location.search, props.autoRun],
	);
	const [keywords, setKeywords] = useState<string[]>(() => [initialNavigation.keyword]);
	const [dateFrom, setDateFrom] = useState(() => initialNavigation.fromYmd);
	const [dateTo, setDateTo] = useState(() => initialNavigation.toYmd);
	const normalizedKeywords = useMemo(() => {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const raw of keywords) {
			const q = normalizeKeyword(raw);
			if (!q) continue;
			const key = q.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(q);
			if (out.length >= 5) break;
		}
		return out;
	}, [keywords]);
	const [categoryEditKeyword, setCategoryEditKeyword] = useState<string>('');
	const [categorySelectionMap, setCategorySelectionMap] = useState<Record<string, KeywordInsightsCategorySelection | null>>({});
	const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
	const [categoryModalSeed, setCategoryModalSeed] = useState('');
	const [categoryModalTargetKeyword, setCategoryModalTargetKeyword] = useState<string>('');
	const [forceRefresh, setForceRefresh] = useState(true);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [data, setData] = useState<KeywordInsightsResponse | null>(null); // 집계(포함된 키워드들의 합계)
	const [perKeywordResults, setPerKeywordResults] = useState<
		Array<{
			keyword: string;
			ok: boolean;
			categoryId: string | null;
			categoryPath: string | null;
			mismatch: boolean;
			manualExcluded: boolean;
			excluded: boolean;
			excludedReason: string | null;
			error: string | null;
		}>
	>([]);
	const [inputsLocked, setInputsLocked] = useState(false);
	const [manualExcludeMap, setManualExcludeMap] = useState<Record<string, boolean>>({});
	const [runContext, setRunContext] = useState<{
		req: string[];
		okItems: Array<{ keyword: string; data: KeywordInsightsResponse; forcedCategoryId: string | null }>;
		errs: Array<{ keyword: string; error: string }>;
	} | null>(null);

	const [kwFilter, setKwFilter] = useState('');
	const [compFilter, setCompFilter] = useState(''); // 포함 검색(예: 높음/중간/낮음)
	const [minTotalSearch, setMinTotalSearch] = useState('');
	const [minTotalAdClicks, setMinTotalAdClicks] = useState('');
	const [minPcSearch, setMinPcSearch] = useState('');
	const [minMoSearch, setMinMoSearch] = useState('');
	const [minPcAdClicks, setMinPcAdClicks] = useState('');
	const [minMoAdClicks, setMinMoAdClicks] = useState('');
	const [minPcCtr, setMinPcCtr] = useState('');
	const [minMoCtr, setMinMoCtr] = useState('');
	const [minAvgCtr, setMinAvgCtr] = useState('');
	const [minPlAvgDepth, setMinPlAvgDepth] = useState(''); // 쇼핑성/정보성(plAvgDepth) >=

	type SortKey =
		| 'relKeyword'
		| 'monthlyPcQcCnt'
		| 'monthlyMobileQcCnt'
		| 'totalSearchQcCnt'
		| 'monthlyAvePcClkCnt'
		| 'monthlyAveMobileClkCnt'
		| 'totalAdClkCnt'
		| 'monthlyAvePcCtr'
		| 'monthlyAveMobileCtr'
		| 'avgCtr'
		| 'compIdx'
		| 'searchedAt';
	const [sortKey, setSortKey] = useState<SortKey>('totalSearchQcCnt');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

	const normalizedKeywordsKey = useMemo(() => normalizedKeywords.join('\n'), [normalizedKeywords]);
	const editKeyword = useMemo(() => {
		const cur = normalizeKeyword(categoryEditKeyword);
		if (cur && normalizedKeywords.some((k) => k.toLowerCase() === cur.toLowerCase())) return cur;
		return normalizedKeywords[0] ?? '';
	}, [categoryEditKeyword, normalizedKeywords, normalizedKeywordsKey]);
	const categorySelection = categorySelectionMap[editKeyword] ?? null;

	// 입력 키워드 목록이 바뀌면: 키워드별 "최종 적용 카테고리(사전 선택)"를 로드한다.
	useEffect(() => {
		const store = loadKeywordInsightsCategorySelectionStore();
		const next: Record<string, KeywordInsightsCategorySelection | null> = {};
		for (const q of normalizedKeywords) next[q] = store[q] || null;
		setCategorySelectionMap(next);

		// 편집 대상 키워드가 비었거나 목록에서 사라지면 첫 키워드로 맞춘다.
		if (!normalizeKeyword(categoryEditKeyword) || !editKeyword) {
			setCategoryEditKeyword(normalizedKeywords[0] ?? '');
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [normalizedKeywordsKey]);

	// 수동 포함/제외 토글 시: 저장된 조회 결과(runContext)를 기반으로 즉시 재집계한다.
	useEffect(() => {
		if (!runContext) return;
		if (loading) return;
		const { results, agg, fatalError } = computeAggregate({
			req: runContext.req,
			okItems: runContext.okItems,
			errs: runContext.errs,
			manualExcludeMap,
		});
		setPerKeywordResults(results);
		setData(agg);
		setError(fatalError);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [manualExcludeMap, runContext]);

	const estTrend = data?.trend?.estimatedDailySearches?.points ?? null;
	const trendData = estTrend ?? [];
	const [showSeasonBlocks, setShowSeasonBlocks] = useState(true);
	const seasonBlocks = useMemo(
		() => (showSeasonBlocks && estTrend ? computeSeasonBlocks(estTrend) : []),
		[estTrend, showSeasonBlocks],
	);
	const genderData = data?.distributions?.gender ?? [];
	const ageData = data?.distributions?.age ?? [];
	const deviceData = data?.distributions?.device ?? [];
	const dowData = data?.distributions?.dayOfWeek ?? [];

	const genderPanelData = useMemo(() => {
		const rows = (genderData || []).slice();
		const order: Record<string, number> = { 여성: 0, 남성: 1 };
		rows.sort((a, b) => (order[a.label] ?? 99) - (order[b.label] ?? 99));
		return rows;
	}, [genderData]);

	const devicePanelData = useMemo(() => {
		const rows = (deviceData || []).slice();
		const order: Record<string, number> = { 모바일: 0, PC: 1 };
		rows.sort((a, b) => (order[a.label] ?? 99) - (order[b.label] ?? 99));
		return rows;
	}, [deviceData]);

	function computeAggregate(params: {
		req: string[];
		okItems: Array<{ keyword: string; data: KeywordInsightsResponse; forcedCategoryId: string | null }>;
		errs: Array<{ keyword: string; error: string }>;
		manualExcludeMap: Record<string, boolean>;
	}): {
		results: Array<{
			keyword: string;
			ok: boolean;
			categoryId: string | null;
			categoryPath: string | null;
			mismatch: boolean;
			manualExcluded: boolean;
			excluded: boolean;
			excludedReason: string | null;
			error: string | null;
		}>;
		agg: KeywordInsightsResponse | null;
		fatalError: string | null;
	} {
		const { req, okItems, errs, manualExcludeMap } = params;

		const forcedCategoryIdByKeyword: Record<string, string | null> = {};
		for (const it of okItems) forcedCategoryIdByKeyword[it.keyword] = it.forcedCategoryId ?? null;

		const isManualExcluded = (kw: string) => Boolean(manualExcludeMap[String(kw || '').trim()] === true);

		// 기준 카테고리: "포함 대상(수동 제외 아님)" 중 첫 성공 응답의 categoryId. 없으면 forcedCategoryId로 폴백.
		let baseCategoryId: string | null = null;
		let baseCategoryPath: string | null = null;
		for (const it of okItems) {
			if (isManualExcluded(it.keyword)) continue;
			const cid = String(it.data?.shopping?.category || '').trim() || String(it.forcedCategoryId || '').trim();
			if (cid) {
				baseCategoryId = cid;
				baseCategoryPath = (it.data?.shopping?.categoryPath ?? null) as any;
				break;
			}
		}

		const included: KeywordInsightsResponse[] = [];
		const results: Array<{
			keyword: string;
			ok: boolean;
			categoryId: string | null;
			categoryPath: string | null;
			mismatch: boolean;
			manualExcluded: boolean;
			excluded: boolean;
			excludedReason: string | null;
			error: string | null;
		}> = [];

		for (const it of okItems) {
			const cid = String(it.data?.shopping?.category || '').trim() || String(it.forcedCategoryId || '').trim() || null;
			const cpath = (it.data?.shopping?.categoryPath ?? null) as any;
			const manualExcluded = isManualExcluded(it.keyword);
			const baseMainCategory = mainCategoryOfPath(baseCategoryPath);
			const currentMainCategory = mainCategoryOfPath(cpath);
			const sameMainCategory = Boolean(baseMainCategory && currentMainCategory && baseMainCategory === currentMainCategory);
			const mismatch = Boolean(baseCategoryId && cid && cid !== baseCategoryId && !sameMainCategory);
			const excluded = manualExcluded || mismatch;
			if (!excluded) included.push(it.data);
			results.push({
				keyword: it.keyword,
				ok: true,
				categoryId: cid,
				categoryPath: cpath,
				mismatch,
				manualExcluded,
				excluded,
				excludedReason: manualExcluded
					? '사용자가 제외함'
					: mismatch
						? `카테고리 불일치(기준: ${baseCategoryId}, 현재: ${cid})`
						: null,
				error: null,
			});
		}
		for (const e of errs) {
			results.push({
				keyword: e.keyword,
				ok: false,
				categoryId: null,
				categoryPath: null,
				mismatch: false,
				manualExcluded: false,
				excluded: true,
				excludedReason: '요청 실패(서버/네트워크)',
				error: e.error,
			});
		}
		results.sort((a, b) => req.indexOf(a.keyword) - req.indexOf(b.keyword));

		// 집계(포함된 키워드만 합산)
		if (!included.length) {
			return {
				results,
				agg: null,
				fatalError: '포함할 수 있는 키워드가 없습니다. (카테고리 불일치/요청 실패/수동 제외)',
			};
		}

		const sumNum = (xs: Array<number | null | undefined>): number =>
			xs.reduce<number>((acc, v) => acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
		const weightedAvg = (pairs: Array<{ v: number | null | undefined; w: number | null | undefined }>): number | null => {
			let sw = 0;
			let sv = 0;
			for (const p of pairs) {
				const v = typeof p.v === 'number' && Number.isFinite(p.v) ? p.v : null;
				const w = typeof p.w === 'number' && Number.isFinite(p.w) ? p.w : null;
				if (v === null || w === null || w <= 0) continue;
				sw += w;
				sv += v * w;
			}
			return sw > 0 ? sv / sw : null;
		};

		const includedKeywords = results.filter((r) => r.ok && !r.excluded).map((r) => r.keyword);
		const includedLabel = includedKeywords.length === 1 ? includedKeywords[0]! : `${includedKeywords.join(' + ')} (합계 ${includedKeywords.length}개)`;
		const searchedAt = included.map((x) => String(x.searchedAt || x.keywordSummary?.searchedAt || '')).filter(Boolean).sort().at(-1) ?? null;
		const anyCached = included.some((x) => Boolean(x.cached));

		const sumPc = sumNum(included.map((x) => x.keywordSummary?.pcSearch));
		const sumMo = sumNum(included.map((x) => x.keywordSummary?.mobileSearch));
		const sumTotal = sumNum(included.map((x) => x.keywordSummary?.totalSearch));
		const sumProd = sumNum(included.map((x) => x.keywordSummary?.productCount));
		const sumPosts = sumNum(included.map((x) => x.keywordSummary?.posts));
		const pcCtr = weightedAvg(included.map((x) => ({ v: x.keywordSummary?.pcCtr, w: x.keywordSummary?.pcSearch })));
		const moCtr = weightedAvg(included.map((x) => ({ v: x.keywordSummary?.mobileCtr, w: x.keywordSummary?.mobileSearch })));
		const avgCtr = weightedAvg(included.map((x) => ({ v: x.keywordSummary?.avgCtr, w: x.keywordSummary?.totalSearch })));

		// 트렌드: estimatedDailySearches가 있으면 date별 searches 합산. 없으면 ratio는 평균.
		const hasEst = included.some((x) => Array.isArray(x.trend?.estimatedDailySearches?.points) && (x.trend.estimatedDailySearches?.points?.length ?? 0) > 0);
		let trendPoints: KeywordTrendPoint[] = [];
		let estimatedDailySearches: KeywordInsightsResponse['trend']['estimatedDailySearches'] = null;
		if (!hasEst) {
			const map = new Map<string, { sum: number; cnt: number }>();
			for (const x of included) {
				for (const p of x.trend?.points || []) {
					const k = String(p.date || '');
					if (!k) continue;
					const v = typeof p.ratio === 'number' && Number.isFinite(p.ratio) ? p.ratio : null;
					if (v === null) continue;
					const cur = map.get(k) || { sum: 0, cnt: 0 };
					cur.sum += v;
					cur.cnt += 1;
					map.set(k, cur);
				}
			}
			trendPoints = Array.from(map.entries())
				.map(([date, v]) => ({ date, ratio: v.cnt > 0 ? v.sum / v.cnt : 0 }))
				.sort((a, b) => String(a.date).localeCompare(String(b.date)));
			estimatedDailySearches = null;
		} else {
			const map = new Map<string, number>();
			for (const x of included) {
				for (const p of x.trend?.estimatedDailySearches?.points || []) {
					const k = String(p.date || '');
					if (!k) continue;
					const v = typeof p.searches === 'number' && Number.isFinite(p.searches) ? p.searches : 0;
					map.set(k, (map.get(k) || 0) + v);
				}
			}
			const pts = Array.from(map.entries())
				.map(([date, searches]) => ({ date, searches }))
				.sort((a, b) => String(a.date).localeCompare(String(b.date)));
			const base = included.find((x) => x.trend?.estimatedDailySearches)?.trend?.estimatedDailySearches ?? null;
			estimatedDailySearches = base
				? {
						baselineDays: base.baselineDays,
						baselineFrom: base.baselineFrom,
						baselineTo: base.baselineTo,
						monthlyTotal: sumNum(included.map((x) => x.trend?.estimatedDailySearches?.monthlyTotal)),
						points: pts,
					}
				: {
						baselineDays: 0,
						baselineFrom: dateFrom,
						baselineTo: dateTo,
						monthlyTotal: sumNum(included.map((x) => x.trend?.estimatedDailySearches?.monthlyTotal)),
						points: pts,
					};
			trendPoints = [];
		}

		const avgDist = (items: KeywordDistributionItem[][]): KeywordDistributionItem[] => {
			const map = new Map<string, { sum: number; cnt: number }>();
			for (const arr of items) {
				for (const it2 of arr || []) {
					const k = String(it2.label || '').trim();
					if (!k) continue;
					const v = typeof it2.ratio === 'number' && Number.isFinite(it2.ratio) ? it2.ratio : null;
					if (v === null) continue;
					const cur = map.get(k) || { sum: 0, cnt: 0 };
					cur.sum += v;
					cur.cnt += 1;
					map.set(k, cur);
				}
			}
			return Array.from(map.entries())
				.map(([label, v]) => ({ label, ratio: v.cnt > 0 ? v.sum / v.cnt : 0 }))
				.sort((a, b) => a.label.localeCompare(b.label));
		};

		const pickBestRelated = (rows: KeywordToolRow[]): KeywordToolRow[] => {
			const best = new Map<string, KeywordToolRow>();
			const score = (r: KeywordToolRow): number => {
				const ts = typeof r.totalSearchQcCnt === 'number' && Number.isFinite(r.totalSearchQcCnt) ? r.totalSearchQcCnt : 0;
				const pc = typeof r.monthlyPcQcCnt === 'number' && Number.isFinite(r.monthlyPcQcCnt) ? r.monthlyPcQcCnt : 0;
				const mo = typeof r.monthlyMobileQcCnt === 'number' && Number.isFinite(r.monthlyMobileQcCnt) ? r.monthlyMobileQcCnt : 0;
				return ts * 1000 + pc + mo;
			};
			for (const r of rows) {
				const k = String(r?.relKeyword || '').trim().toLowerCase();
				if (!k) continue;
				const cur = best.get(k);
				if (!cur || score(r) > score(cur)) best.set(k, r);
			}
			return Array.from(best.values());
		};

		const combinedRelated = pickBestRelated(included.flatMap((x) => x.relatedKeywords || []));
		const keywordToolError = included.map((x) => String(x.keywordToolError || '').trim()).filter(Boolean).join(' / ') || null;

		const agg: KeywordInsightsResponse = {
			keyword: includedLabel,
			date_from: dateFrom,
			date_to: dateTo,
			cached: anyCached,
			searchedAt: searchedAt,
			keywordSummary: {
				pcSearch: sumPc,
				mobileSearch: sumMo,
				totalSearch: sumTotal,
				productCount: sumProd,
				posts: sumPosts,
				pcCtr,
				mobileCtr: moCtr,
				avgCtr,
				searchedAt: searchedAt || new Date().toISOString(),
				note:
					results.some((r) => r.excluded)
						? `포함 ${includedKeywords.length}개 / 제외 ${results.filter((r) => r.excluded).length}개`
						: `포함 ${includedKeywords.length}개 (합계)`,
			},
			trend: {
				points: trendPoints,
				estimatedDailySearches,
			},
			distributions: {
				gender: avgDist(included.map((x) => x.distributions?.gender || [])),
				age: avgDist(included.map((x) => x.distributions?.age || [])),
				device: avgDist(included.map((x) => x.distributions?.device || [])),
				dayOfWeek: avgDist(included.map((x) => x.distributions?.dayOfWeek || [])),
			},
			relatedKeywords: combinedRelated,
			shopping: {
				category: baseCategoryId,
				productCount: sumNum(included.map((x) => x.shopping?.productCount)),
				categoryPath: baseCategoryPath,
				categoryConfidencePct: null,
				categoryTop3: null,
				categoryIdSource: included.find((x) => x.shopping?.categoryIdSource)?.shopping?.categoryIdSource ?? null,
			},
			blogCount: sumNum(included.map((x) => x.blogCount)),
			keywordToolError,
		};

		return { results, agg, fatalError: null };
	}

	const filteredRows = useMemo(() => {
		const rows = (data?.relatedKeywords || []).slice();

		const toNum = (s: string): number | null => {
			const raw = String(s ?? '').trim();
			if (!raw) return null;
			const v = Number(raw.replaceAll(',', ''));
			return Number.isFinite(v) ? v : null;
		};
		const min = (raw: string) => (String(raw ?? '').trim() ? toNum(raw) : null);

		const minTS = min(minTotalSearch);
		const minTA = min(minTotalAdClicks);
		const minPCQ = min(minPcSearch);
		const minMOQ = min(minMoSearch);
		const minPCA = min(minPcAdClicks);
		const minMOA = min(minMoAdClicks);
		const minPCCTR = min(minPcCtr);
		const minMOCTR = min(minMoCtr);
		const minAVGCTR = min(minAvgCtr);
		const minDEPTH = min(minPlAvgDepth);
		const kw = kwFilter.trim();
		const comp = compFilter.trim();

		const filtered = rows.filter((r) => {
			if (kw && !String(r.relKeyword || '').includes(kw)) return false;
			if (comp && !String(r.compIdx || '').includes(comp)) return false;
			if (minTS !== null && (r.totalSearchQcCnt ?? 0) < minTS) return false;
			if (minTA !== null && (r.totalAdClkCnt ?? 0) < minTA) return false;
			if (minPCQ !== null && (r.monthlyPcQcCnt ?? 0) < minPCQ) return false;
			if (minMOQ !== null && (r.monthlyMobileQcCnt ?? 0) < minMOQ) return false;
			if (minPCA !== null && (r.monthlyAvePcClkCnt ?? 0) < minPCA) return false;
			if (minMOA !== null && (r.monthlyAveMobileClkCnt ?? 0) < minMOA) return false;
			if (minPCCTR !== null && (r.monthlyAvePcCtr ?? 0) < minPCCTR) return false;
			if (minMOCTR !== null && (r.monthlyAveMobileCtr ?? 0) < minMOCTR) return false;
			if (minAVGCTR !== null && (r.avgCtr ?? 0) < minAVGCTR) return false;
			if (minDEPTH !== null) {
				const d = r.plAvgDepth;
				if (typeof d !== 'number' || !Number.isFinite(d)) return false;
				if (d < minDEPTH) return false;
			}
			return true;
		});

		const dirMul = sortDir === 'asc' ? 1 : -1;
		filtered.sort((a, b) => {
			const av: any = (a as any)[sortKey];
			const bv: any = (b as any)[sortKey];
			if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul;
			return String(av ?? '').localeCompare(String(bv ?? '')) * dirMul;
		});

		return filtered;
	}, [
		data?.relatedKeywords,
		compFilter,
		kwFilter,
		minAvgCtr,
		minMoAdClicks,
		minMoCtr,
		minMoSearch,
		minPcAdClicks,
		minPcCtr,
		minPcSearch,
		minPlAvgDepth,
		minTotalAdClicks,
		minTotalSearch,
		sortDir,
		sortKey,
	]);

	async function runSearch() {
		if (!normalizedKeywords.length) {
			setError('키워드를 입력하세요. (최대 5개)');
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const req = normalizedKeywords.slice(0, 5);
			const baseUrl = `${apiBaseUrl.replace(/\/$/, '')}/research/keyword-insights`;

			const okItems: Array<{ keyword: string; data: KeywordInsightsResponse; forcedCategoryId: string | null }> = [];
			const errs: Array<{ keyword: string; error: string }> = [];

			// NOTE: 다중 키워드를 동시에 호출하면 DataLab/OpenAPI timeout이 쉽게 발생한다.
			// 안정성을 위해 순차 호출(동시성=1)로 수행한다.
			for (const kw of req) {
				try {
					const sel = categorySelectionMap[kw] ?? null;
					const cat = String(sel?.id || '').trim();
					const resp = await axios.get<KeywordInsightsResponse>(baseUrl, {
						params: {
							keyword: kw,
							date_from: dateFrom,
							date_to: dateTo,
							shopping_category: cat ? cat : undefined,
							// 캐시로 인해 값이 "그대로" 남는 혼동을 피하기 위해 기본 true
							force: forceRefresh,
						},
					});
					okItems.push({ keyword: kw, data: resp.data, forcedCategoryId: cat ? cat : null });
				} catch (e: any) {
					const status = e?.response?.status;
					const detail = e?.response?.data?.detail;
					const msg = detail ?? e?.message ?? '요청 실패';
					errs.push({ keyword: kw, error: `${status ? `HTTP ${status}: ` : ''}${String(msg)}` });
				}
			}

			// 조회 결과를 저장(키워드 클릭으로 포함/제외 토글 시 재집계에 사용)
			setRunContext({ req, okItems, errs });
			setManualExcludeMap({});

			// (초기 상태) 수동 제외 없음 상태로 집계 계산
			const { results, agg, fatalError } = computeAggregate({ req, okItems, errs, manualExcludeMap: {} });
			setPerKeywordResults(results);
			setData(agg);
			setError(fatalError);
			return;
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '요청 실패';
			setError(String(msg));
		} finally {
			setLoading(false);
			setInputsLocked(true);
		}
	}

	// 모달/외부 진입에서 "키워드+기간이 이미 정해진 상태로" 바로 조회를 시작할 수 있게 한다.
	const autoRanRef = React.useRef(false);
	useEffect(() => {
		if (!(props.autoRun || initialNavigation.autoRun)) return;
		if (autoRanRef.current) return;
		autoRanRef.current = true;
		// 필수 입력이 없으면 실행하지 않는다.
		if (!normalizedKeywords.length) return;
		void runSearch();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// 트렌드 전용 모드: "검색 트렌드 + 분포(성별/기기/연령/요일)"만 렌더링
	// - 소재 분석 모달에서는 SEO 추천/연관 키워드 표가 필요 없고 화면이 너무 커진다.
	if (props.viewMode === 'trendsOnly') {
		return (
			<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
				{loading ? (
					<div className="card" style={{ fontSize: 12, color: '#9ca3af' }}>
						불러오는 중…
					</div>
				) : null}
				{error ? (
					<div className="card" style={{ borderColor: 'rgba(248,113,113,0.55)' }}>
						<div style={{ fontSize: 12, color: '#fecaca' }}>{error}</div>
					</div>
				) : null}

				<div className="card">
					<div className="card-title">검색 트렌드</div>
					{estTrend ? null : <p className="card-caption">DataLab 상대 지수(비교용)</p>}
					{estTrend ? (
						<label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#cbd5e1', fontWeight: 700 }}>
							<input type="checkbox" checked={showSeasonBlocks} onChange={(e) => setShowSeasonBlocks(e.target.checked)} />
							반복 구간 표시
						</label>
					) : null}
					<div style={{ width: '100%', height: 340, marginTop: 6 }}>
						<ResponsiveContainer>
							<LineChart data={trendData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
								<CartesianGrid stroke="rgba(148,163,184,0.10)" />
								<XAxis dataKey="date" stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} tickMargin={8} />
								<YAxis stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} />
								<Tooltip {...tooltipProps} />
								{seasonBlocks.map((b) => (
									<ReferenceArea
										key={`${b.x1}-${b.x2}`}
										x1={b.x1}
										x2={b.x2}
										stroke="#94a3b8"
										strokeOpacity={0.5}
										strokeDasharray="4 4"
										fill="#94a3b8"
										fillOpacity={0.06}
									/>
								))}
								<Line type="monotone" dataKey={estTrend ? 'searches' : 'ratio'} stroke="#2dd4bf" dot={false} strokeWidth={3} />
							</LineChart>
						</ResponsiveContainer>
					</div>
				</div>

				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
					<div className="card">
						<div className="card-title">성별 트렌드</div>
						<div style={{ width: '100%', height: 140 }}>
							<PremiumHBarChart
								data={genderPanelData}
								colorFn={(label) =>
									label === '여성'
										? { fill: '#fb7185', fillOpacity: 0.85, stroke: 'rgba(251,113,133,0.35)' }
										: { fill: 'transparent', stroke: 'rgba(226,232,240,0.75)', strokeWidth: 3 }
								}
							/>
						</div>
					</div>

					<div className="card">
						<div className="card-title">기기별 트렌드</div>
						<div style={{ width: '100%', height: 140 }}>
							<PremiumHBarChart
								data={devicePanelData}
								colorFn={(label) =>
									label === '모바일'
										? { fill: '#34d399', fillOpacity: 0.85, stroke: 'rgba(52,211,153,0.30)' }
										: { fill: 'transparent', stroke: 'rgba(226,232,240,0.75)', strokeWidth: 3 }
								}
							/>
						</div>
					</div>

					<div className="card">
						<div className="card-title">연령대별 트렌드</div>
						<div style={{ width: '100%', height: 280 }}>
							<ResponsiveContainer>
								<BarChart data={ageData} margin={{ top: 22, right: 12, left: 0, bottom: 24 }}>
									<CartesianGrid stroke="rgba(148,163,184,0.10)" />
									<XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1', fontWeight: 700 }} tickMargin={10} />
									<YAxis stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} />
									<Tooltip {...tooltipProps} />
									<Bar dataKey="ratio" fill="#a78bfa" isAnimationActive={false} radius={[10, 10, 0, 0]}>
										<LabelList dataKey="ratio" position="top" formatter={pctLabel} fill="#e5e7eb" fontSize={12} fontWeight={800} />
									</Bar>
								</BarChart>
							</ResponsiveContainer>
						</div>
					</div>

					<div className="card">
						<div className="card-title">요일별 트렌드</div>
						<div style={{ width: '100%', height: 240 }}>
							<ResponsiveContainer>
								<BarChart data={dowData} margin={{ top: 8, right: 12, left: 0, bottom: 10 }}>
									<CartesianGrid stroke="rgba(148,163,184,0.10)" />
									<XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1', fontWeight: 700 }} tickMargin={10} />
									<YAxis stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} />
									<Tooltip {...tooltipProps} />
									<Bar dataKey="ratio" fill="#60a5fa" isAnimationActive={false} radius={[10, 10, 0, 0]}>
										<LabelList dataKey="ratio" position="top" formatter={pctLabel} fill="#e5e7eb" fontSize={12} fontWeight={800} />
									</Bar>
								</BarChart>
							</ResponsiveContainer>
						</div>
					</div>
				</div>
			</div>
		);
	}

	function copyText(text: string) {
		const s = String(text ?? '').trim();
		if (!s) return;
		try {
			void navigator.clipboard.writeText(s);
		} catch {
			try {
				window.prompt('복사할 텍스트', s);
			} catch {
				// ignore
			}
		}
	}

	function openCategorySearch(): void {
		const seed = String(editKeyword || '').trim();
		setCategoryModalSeed(seed);
		setCategoryModalTargetKeyword(seed);
		setIsCategoryModalOpen(true);
	}

	function clearCategorySelection(): void {
		const q = normalizeKeyword(editKeyword);
		if (!q) return;
		if (q) {
			const store = loadKeywordInsightsCategorySelectionStore();
			delete store[q];
			saveKeywordInsightsCategorySelectionStore(store);
		}
		setCategorySelectionMap((prev) => ({ ...prev, [q]: null }));
		setForceRefresh(true);
	}

	function applyCategorySelection(v: { id: string; path: string }): void {
		const q = normalizeKeyword(categoryModalTargetKeyword || editKeyword);
		if (!q) return;
		const now = new Date().toISOString();
		const sel: KeywordInsightsCategorySelection = { id: v.id, path: v.path, selectedAt: now };
		const store = loadKeywordInsightsCategorySelectionStore();
		store[q] = sel;
		saveKeywordInsightsCategorySelectionStore(store);
		setCategorySelectionMap((prev) => ({ ...prev, [q]: sel }));
		setIsCategoryModalOpen(false);
		setForceRefresh(true);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<div className="card kw-insights-card">
				{/* 헤더: 제목·설명 */}
				<div className="kw-insights-header">
					<div className="card-title kw-insights-title">키워드 인사이트</div>
					<p className="card-caption kw-insights-caption">
						키워드 입력 → 카테고리 검색/선택 → 조회. 카테고리는 <b>설정 &gt; 카테고리 사전</b>에서 검색해 적용합니다.
					</p>
				</div>

				{/* 입력 영역: 4컬럼 그리드 */}
				<div className="kw-header-grid">
					<div className="kw-field kw-field-keywords">
						<label className="field-label kw-field-label" htmlFor="kw-input">
							키워드
						</label>
						<span className="kw-field-hint">최대 5개</span>
						<div className="kw-keywords-body">
							{keywords.map((v, idx) => (
								<div key={`kw-${idx}`} className="kw-keyword-row">
									<input
										id={idx === 0 ? 'kw-input' : undefined}
										aria-label={`키워드 ${idx + 1}`}
										className="input"
										value={v}
										disabled={inputsLocked}
										onChange={(e) => {
											const next = e.target.value;
											setKeywords((prev) => prev.map((x, i) => (i === idx ? next : x)));
										}}
									/>
									<button
										type="button"
										className="btn-ghost btn-sm"
										onClick={() => setKeywords((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))}
										disabled={inputsLocked || keywords.length <= 1}
									>
										삭제
									</button>
								</div>
							))}
							<div className="kw-keyword-actions">
								<button
									type="button"
									className="btn-ghost btn-sm"
									onClick={() => setKeywords((prev) => (prev.length >= 5 ? prev : [...prev, '']))}
									disabled={inputsLocked || keywords.length >= 5}
								>
									키워드 추가
								</button>
								{inputsLocked ? (
									<button
										type="button"
										className="btn-ghost btn-sm"
										onClick={() => {
											setInputsLocked(false);
											setRunContext(null);
											setManualExcludeMap({});
											setPerKeywordResults([]);
											setData(null);
											setError(null);
										}}
									>
										키워드 편집
									</button>
								) : null}
							</div>
						</div>
						<p className="kw-hint">조회 완료 후 키워드 입력란은 잠기며, 아래 키워드 뱃지로 포함/제외를 바꿀 수 있습니다.</p>
					</div>
					<div className="kw-field kw-field-period">
						<label className="field-label kw-field-label">기간</label>
						<div className="kw-period-row">
							<DatePicker
								selected={parseYmd(dateFrom)}
								onChange={(d) => {
									const dt = d as Date | null;
									if (dt) setDateFrom(toYmd(dt));
								}}
								dateFormat="yyyy-MM-dd"
								maxDate={parseYmd(dateTo) ?? undefined}
								customInput={<DatePickerInput id="date-from-input" aria-label="시작일" />}
								popperPlacement="bottom-start"
							/>
							<span className="kw-period-sep">~</span>
							<DatePicker
								selected={parseYmd(dateTo)}
								onChange={(d) => {
									const dt = d as Date | null;
									if (dt) setDateTo(toYmd(dt));
								}}
								dateFormat="yyyy-MM-dd"
								minDate={parseYmd(dateFrom) ?? undefined}
								maxDate={today}
								customInput={<DatePickerInput id="date-to-input" aria-label="종료일" />}
								popperPlacement="bottom-start"
							/>
						</div>
						<div className="kw-quick-row">
							<button type="button" className="btn-ghost btn-sm kw-quick-btn" onClick={() => setDateFrom(toYmd(addDays(today, -30)))}>
								최근 1개월
							</button>
							<button type="button" className="btn-ghost btn-sm kw-quick-btn" onClick={() => setDateFrom(toYmd(addDays(today, -365)))}>
								최근 1년
							</button>
							<button type="button" className="btn-ghost btn-sm kw-quick-btn" onClick={() => setDateFrom(toYmd(addDays(today, -365 * 3)))}>
								최근 3년
							</button>
							{data?.cached ? <span className="badge kw-cache-badge">cache</span> : null}
						</div>
					</div>
					<div className="kw-field kw-field-category">
						<label className="field-label kw-field-label">적용 카테고리</label>
						<div className="kw-category-body">
							<select
								className="input"
								aria-label="카테고리 편집 대상 키워드"
								value={editKeyword}
								disabled={!normalizedKeywords.length}
								onChange={(e) => setCategoryEditKeyword(String(e.target.value || ''))}
							>
								{normalizedKeywords.length ? null : <option value="">(키워드 없음)</option>}
								{normalizedKeywords.map((k) => (
									<option key={`editkw-${k}`} value={k}>
										{k}
									</option>
								))}
							</select>
							<div className="kw-category-row">
								<input
									className="input"
									readOnly
									value={categorySelection ? `${categorySelection.path} (${categorySelection.id})` : ''}
									placeholder="미선택(자동 추정)"
								/>
								<button type="button" className="btn-ghost btn-sm" onClick={openCategorySearch} disabled={!normalizeKeyword(editKeyword)}>
									카테고리 검색
								</button>
								<button type="button" className="btn-ghost btn-sm" onClick={clearCategorySelection} disabled={!categorySelection}>
									해제
								</button>
							</div>
						</div>
						<p className="kw-hint">카테고리 ID는 선택 후 자동 적용됩니다.</p>
					</div>
					<div className="kw-actions">
						<label className="kw-cache-label">
							<input type="checkbox" checked={forceRefresh} onChange={(e) => setForceRefresh(e.target.checked)} />
							캐시 무시
						</label>
						<button type="button" className="btn-primary" onClick={runSearch} disabled={loading}>
							{loading ? '조회중…' : '조회'}
						</button>
					</div>
				</div>

				{isCategoryModalOpen ? (
					<CategoryDictionarySearchModal
						apiBaseUrl={apiBaseUrl}
						open={isCategoryModalOpen}
						initialQuery={categoryModalSeed}
						onClose={() => setIsCategoryModalOpen(false)}
						onSelect={applyCategorySelection}
						onOpenDictionarySettings={() => {
							setIsCategoryModalOpen(false);
							navigate('/analytics/settings/category-dict');
						}}
					/>
				) : null}

				{perKeywordResults.length ? (
					<div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
							<span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 900 }}>입력 키워드</span>
							{perKeywordResults.map((r) => (
								<button
									key={`kwres-${r.keyword}`}
									type="button"
									className="badge"
									style={{
										background: r.excluded ? 'rgba(148,163,184,0.14)' : 'rgba(34,197,94,0.12)',
										borderColor: r.excluded ? 'rgba(148,163,184,0.35)' : 'rgba(34,197,94,0.35)',
										color: r.excluded ? '#cbd5e1' : '#86efac',
										fontWeight: 900,
										cursor: r.ok && !r.mismatch ? 'pointer' : 'not-allowed',
									}}
									title={[r.excludedReason || '', r.error || ''].filter(Boolean).join('\n')}
									onClick={() => {
										if (!r.ok) return;
										if (r.mismatch) {
											try {
												window.alert('카테고리가 다른 키워드는 포함할 수 없어 자동 제외됩니다.');
											} catch {
												// ignore
											}
											return;
										}
										setManualExcludeMap((prev) => {
											const cur = Boolean(prev[r.keyword] === true);
											if (cur) {
												// include
												const { [r.keyword]: _, ...rest } = prev;
												return rest;
											}
											return { ...prev, [r.keyword]: true };
										});
									}}
								>
									{r.keyword}
									{r.ok ? (r.excluded ? ' (제외)' : '') : ' (오류)'}
									{r.mismatch ? <span style={{ marginLeft: 6, color: '#f87171', fontWeight: 900 }}>(카테고리 다름)</span> : null}
								</button>
							))}
						</div>
						{perKeywordResults.some((r) => r.excluded) ? (
							<div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
								키워드를 클릭하면 <b style={{ color: '#cbd5e1' }}>제외(회색)</b>/<b style={{ color: '#86efac' }}>포함(녹색)</b>이 전환됩니다.
								<span style={{ marginLeft: 8, color: '#fca5a5', fontWeight: 900 }}>카테고리 불일치 키워드는 자동 제외</span>됩니다.
							</div>
						) : null}
					</div>
				) : null}

				{data?.shopping?.categoryPath ? (
					<div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
						<div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 800 }}>
							카테고리: {data.shopping.categoryPath}
							{typeof data.shopping.categoryConfidencePct === 'number'
								? ` (${data.shopping.categoryConfidencePct.toFixed(1)}%)`
								: ''}
						</div>
						<span className="badge" style={{ opacity: 0.9 }}>
							{data.shopping.category ? '쇼핑 카테고리 기반 분포' : '통합검색 기반(근사)'}
							{data.shopping.categoryIdSource ? ` · ${data.shopping.categoryIdSource}` : ''}
						</span>
						{data.shopping.categoryPath && !data.shopping.category ? (
							<span className="badge" style={{ background: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.35)', color: '#fde68a' }}>
								카테고리ID 추론 실패 → 위 입력에 ID를 넣으면 “키워드 클릭비율”로 전환됩니다.
							</span>
						) : null}
					</div>
				) : null}

				{/* quick range 버튼은 기간 입력 영역으로 이동 */}

				{/* KPI 요약(이미지의 아이콘 영역) */}
				{data?.keywordSummary ? (
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
							gap: 8,
							marginTop: 10,
						}}
					>
						<div className="card">
							<div className="kpi-label">PC 검색량</div>
							<div className="kpi-value">{fmtInt(data.keywordSummary.pcSearch)}</div>
						</div>
						<div className="card">
							<div className="kpi-label">모바일 검색량</div>
							<div className="kpi-value">{fmtInt(data.keywordSummary.mobileSearch)}</div>
						</div>
						<div className="card">
							<div className="kpi-label">총 검색량(월)</div>
							<div className="kpi-value">{fmtInt(data.keywordSummary.totalSearch)}</div>
						</div>
						<div className="card">
							<div className="kpi-label">제품수</div>
							<div className="kpi-value">{fmtInt(data.keywordSummary.productCount)}</div>
						</div>
						<div className="card">
							<div className="kpi-label">게시글(블로그)</div>
							<div className="kpi-value">{fmtInt(data.keywordSummary.posts)}</div>
						</div>
						<div className="card">
							<div className="kpi-label">PC 클릭율</div>
							<div className="kpi-value">{fmtPct(data.keywordSummary.pcCtr)}</div>
						</div>
						<div className="card">
							<div className="kpi-label">모바일 클릭율</div>
							<div className="kpi-value">{fmtPct(data.keywordSummary.mobileCtr)}</div>
						</div>
					</div>
				) : null}

				{error ? (
					<div style={{ marginTop: 8, color: '#fca5a5', fontSize: 12 }}>{error}</div>
				) : null}
				{data?.keywordToolError ? (
					<div style={{ marginTop: 6, color: '#fbbf24', fontSize: 11 }}>
						연관키워드: {data.keywordToolError}
					</div>
				) : null}
			</div>
			<div className="card">
				<div className="card-title">검색 트렌드</div>
				{estTrend ? null : <p className="card-caption">DataLab 상대 지수(비교용)</p>}
				{estTrend ? (
					<label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#cbd5e1', fontWeight: 700 }}>
						<input type="checkbox" checked={showSeasonBlocks} onChange={(e) => setShowSeasonBlocks(e.target.checked)} />
						반복 구간 표시
					</label>
				) : null}
				<div style={{ width: '100%', height: 340, marginTop: 6 }}>
					<ResponsiveContainer>
						<LineChart data={trendData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
							<CartesianGrid stroke="rgba(148,163,184,0.10)" />
							<XAxis dataKey="date" stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} tickMargin={8} />
							<YAxis stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} />
							<Tooltip {...tooltipProps} />
							{seasonBlocks.map((b) => (
								<ReferenceArea
									key={`${b.x1}-${b.x2}`}
									x1={b.x1}
									x2={b.x2}
									stroke="#94a3b8"
									strokeOpacity={0.5}
									strokeDasharray="4 4"
									fill="#94a3b8"
									fillOpacity={0.06}
								/>
							))}
							<Line type="monotone" dataKey={estTrend ? 'searches' : 'ratio'} stroke="#2dd4bf" dot={false} strokeWidth={3} />
						</LineChart>
					</ResponsiveContainer>
				</div>
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
				<div className="card">
					<div className="card-title">성별 트렌드</div>
					<div style={{ width: '100%', height: 140 }}>
						<PremiumHBarChart
							data={genderPanelData}
							colorFn={(label) =>
								label === '여성'
									? { fill: '#fb7185', fillOpacity: 0.85, stroke: 'rgba(251,113,133,0.35)' }
									: { fill: 'transparent', stroke: 'rgba(226,232,240,0.75)', strokeWidth: 3 }
							}
						/>
					</div>
				</div>

				<div className="card">
					<div className="card-title">기기별 트렌드</div>
					<div style={{ width: '100%', height: 140 }}>
						<PremiumHBarChart
							data={devicePanelData}
							colorFn={(label) =>
								label === '모바일'
									? { fill: '#34d399', fillOpacity: 0.85, stroke: 'rgba(52,211,153,0.30)' }
									: { fill: 'transparent', stroke: 'rgba(226,232,240,0.75)', strokeWidth: 3 }
							}
						/>
					</div>
				</div>

				<div className="card">
					<div className="card-title">연령대별 트렌드</div>
					{/* 상단 라벨이 잘리지 않도록 높이/상단 마진을 넉넉히 준다 */}
					<div style={{ width: '100%', height: 280 }}>
						<ResponsiveContainer>
							<BarChart data={ageData} margin={{ top: 22, right: 12, left: 0, bottom: 24 }}>
								<CartesianGrid stroke="rgba(148,163,184,0.10)" />
								<XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1', fontWeight: 700 }} tickMargin={10} />
								<YAxis stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} />
								<Tooltip {...tooltipProps} />
								<Bar dataKey="ratio" fill="#a78bfa" isAnimationActive={false} radius={[10, 10, 0, 0]}>
									<LabelList dataKey="ratio" position="top" formatter={pctLabel} fill="#e5e7eb" fontSize={12} fontWeight={800} />
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>

				<div className="card">
					<div className="card-title">요일별 트렌드</div>
					<div style={{ width: '100%', height: 240 }}>
						<ResponsiveContainer>
							<BarChart data={dowData} margin={{ top: 8, right: 12, left: 0, bottom: 10 }}>
								<CartesianGrid stroke="rgba(148,163,184,0.10)" />
								<XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1', fontWeight: 700 }} tickMargin={10} />
								<YAxis stroke="#cbd5e1" tick={{ fontSize: 11, fill: '#cbd5e1' }} />
								<Tooltip {...tooltipProps} />
								<Bar dataKey="ratio" fill="#60a5fa" isAnimationActive={false} radius={[10, 10, 0, 0]}>
									<LabelList dataKey="ratio" position="top" formatter={pctLabel} fill="#e5e7eb" fontSize={12} fontWeight={800} />
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>
			</div>

			<div className="card">
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div>
						<div className="card-title">연관 키워드</div>
						<p className="card-caption">검색시간: {data?.searchedAt ?? '-'}</p>
					</div>
					<button
						type="button"
						className="btn-ghost"
						onClick={() =>
							downloadCsv(
								`related_keywords_${(data?.keyword || 'keyword').replace(/\s+/g, '_')}.csv`,
								(filteredRows || []).map((r) => ({
									키워드: r.relKeyword,
									'쇼핑성/정보성': shoppingInfoLabel(r.plAvgDepth ?? null),
									pc검색량: r.monthlyPcQcCnt ?? '',
									모바일검색량: r.monthlyMobileQcCnt ?? '',
									총검색량: r.totalSearchQcCnt ?? '',
									pc광고클릭수: r.monthlyAvePcClkCnt ?? '',
									모바일광고클릭수: r.monthlyAveMobileClkCnt ?? '',
									총광고클릭수: r.totalAdClkCnt ?? '',
									pc클릭율: r.monthlyAvePcCtr ?? '',
									모바일클릭율: r.monthlyAveMobileCtr ?? '',
									평균클릭율: r.avgCtr ?? '',
									경쟁강도: r.compIdx ?? '',
									검색시간: r.searchedAt ?? data?.searchedAt ?? '',
								})),
							)
						}
						disabled={!data?.relatedKeywords?.length}
					>
						엑셀 다운로드(CSV)
					</button>
				</div>

				{(() => {
					const sortBtn = (key: SortKey, label: string) => (
						<button
							type="button"
							className="btn-ghost"
							style={{ padding: 0, border: 0, fontSize: 11 }}
							onClick={() => {
								if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
								else {
									setSortKey(key);
									setSortDir('desc');
								}
							}}
						>
							{label}
							{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
						</button>
					);

					return (
						<>
							<div
								style={{
									display: 'grid',
									gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr',
									gap: 8,
									marginBottom: 8,
								}}
							>
								<div>
									<label className="field-label">키워드 필터</label>
									<input className="input" value={kwFilter} onChange={(e) => setKwFilter(e.target.value)} placeholder="포함 검색" />
								</div>
								<div>
									<label className="field-label">쇼핑성/정보성 ≥</label>
									<input className="input" value={minPlAvgDepth} onChange={(e) => setMinPlAvgDepth(e.target.value)} placeholder="예: 8" />
								</div>
								<div>
									<label className="field-label">총검색량 ≥</label>
									<input className="input" value={minTotalSearch} onChange={(e) => setMinTotalSearch(e.target.value)} placeholder="예: 10000" />
								</div>
								<div>
									<label className="field-label">총광고클릭수 ≥</label>
									<input className="input" value={minTotalAdClicks} onChange={(e) => setMinTotalAdClicks(e.target.value)} placeholder="예: 1000" />
								</div>
								<div>
									<label className="field-label">PC CTR(%) ≥</label>
									<input className="input" value={minPcCtr} onChange={(e) => setMinPcCtr(e.target.value)} placeholder="예: 1" />
								</div>
								<div>
									<label className="field-label">MO CTR(%) ≥</label>
									<input className="input" value={minMoCtr} onChange={(e) => setMinMoCtr(e.target.value)} placeholder="예: 1" />
								</div>
								<div>
									<label className="field-label">평균 CTR(%) ≥</label>
									<input className="input" value={minAvgCtr} onChange={(e) => setMinAvgCtr(e.target.value)} placeholder="예: 1" />
								</div>
							</div>

							<div
								style={{
									display: 'grid',
									gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr',
									gap: 8,
									marginBottom: 8,
								}}
							>
								<div>
									<label className="field-label">pc검색량 ≥</label>
									<input className="input" value={minPcSearch} onChange={(e) => setMinPcSearch(e.target.value)} placeholder="예: 1000" />
								</div>
								<div>
									<label className="field-label">모바일검색량 ≥</label>
									<input className="input" value={minMoSearch} onChange={(e) => setMinMoSearch(e.target.value)} placeholder="예: 1000" />
								</div>
								<div>
									<label className="field-label">pc광고클릭수 ≥</label>
									<input className="input" value={minPcAdClicks} onChange={(e) => setMinPcAdClicks(e.target.value)} placeholder="예: 10" />
								</div>
								<div>
									<label className="field-label">모바일광고 클릭수 ≥</label>
									<input className="input" value={minMoAdClicks} onChange={(e) => setMinMoAdClicks(e.target.value)} placeholder="예: 10" />
								</div>
								<div>
									<label className="field-label">경쟁강도 필터</label>
									<input className="input" value={compFilter} onChange={(e) => setCompFilter(e.target.value)} placeholder="예: 높음" />
								</div>
								<div>
									<label className="field-label">초기화</label>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => {
											setKwFilter('');
											setCompFilter('');
											setMinPlAvgDepth('');
											setMinTotalSearch('');
											setMinTotalAdClicks('');
											setMinPcSearch('');
											setMinMoSearch('');
											setMinPcAdClicks('');
											setMinMoAdClicks('');
											setMinPcCtr('');
											setMinMoCtr('');
											setMinAvgCtr('');
											setSortKey('totalSearchQcCnt');
											setSortDir('desc');
										}}
									>
										필터 초기화
									</button>
								</div>
							</div>

							<table className="table">
								<thead>
									<tr>
										<th>{sortBtn('relKeyword', '키워드')}</th>
										<th className="num">쇼핑성/정보성</th>
										<th className="num">{sortBtn('monthlyPcQcCnt', 'pc검색량')}</th>
										<th className="num">{sortBtn('monthlyMobileQcCnt', '모바일검색량')}</th>
										<th className="num">{sortBtn('totalSearchQcCnt', '총검색량')}</th>
										<th className="num">{sortBtn('monthlyAvePcClkCnt', 'pc광고클릭수')}</th>
										<th className="num">{sortBtn('monthlyAveMobileClkCnt', '모바일광고 클릭수')}</th>
										<th className="num">{sortBtn('totalAdClkCnt', '총광고클릭수')}</th>
										<th className="num">{sortBtn('monthlyAvePcCtr', 'pc클릭율')}</th>
										<th className="num">{sortBtn('monthlyAveMobileCtr', '모바일클릭율')}</th>
										<th className="num">{sortBtn('avgCtr', '평균클릭율')}</th>
										<th className="num">{sortBtn('compIdx', '경쟁강도')}</th>
										<th className="num">{sortBtn('searchedAt', '검색시간')}</th>
									</tr>
								</thead>
								<tbody>
									{filteredRows.slice(0, 500).map((r, idx) => (
										<tr key={`${r.relKeyword}-${idx}`}>
											<td>{r.relKeyword}</td>
											<td className="num">{shoppingInfoLabel(r.plAvgDepth ?? null)}</td>
											<td className="num">{fmtInt(r.monthlyPcQcCnt ?? null)}</td>
											<td className="num">{fmtInt(r.monthlyMobileQcCnt ?? null)}</td>
											<td className="num">{fmtInt(r.totalSearchQcCnt ?? null)}</td>
											<td className="num">{fmtFloat(r.monthlyAvePcClkCnt ?? null, 1)}</td>
											<td className="num">{fmtFloat(r.monthlyAveMobileClkCnt ?? null, 1)}</td>
											<td className="num">{fmtFloat(r.totalAdClkCnt ?? null, 1)}</td>
											<td className="num">{fmtPct(r.monthlyAvePcCtr ?? null)}</td>
											<td className="num">{fmtPct(r.monthlyAveMobileCtr ?? null)}</td>
											<td className="num">{fmtPct(r.avgCtr ?? null)}</td>
											<td className="num">{r.compIdx ?? '-'}</td>
											<td className="num">{r.searchedAt ?? data?.searchedAt ?? '-'}</td>
										</tr>
									))}
									{filteredRows.length === 0 ? (
										<tr>
											<td colSpan={13} style={{ color: '#9ca3af', fontSize: 11 }}>
												조건에 맞는 데이터가 없습니다.
											</td>
										</tr>
									) : null}
								</tbody>
							</table>
						</>
					);
				})()}
			</div>
		</div>
	);
}


