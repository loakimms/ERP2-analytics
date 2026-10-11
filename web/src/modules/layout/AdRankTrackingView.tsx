import axios from 'axios';
import React, { useEffect, useMemo, useState } from 'react';

type AdTrackedProduct = {
	id: string;
	url: string;
	name: string;
	campaignLabel?: string;
	organicTitle?: string;
	imageUrl?: string;
	keywords: AdKeywordCandidate[];
	createdAt: string;
};

type ApiAdTrackedKeyword = {
	id: number;
	keyword: string;
	is_active?: boolean;
};

type ApiAdTrackedProduct = {
	product_url: string;
	name: string;
	campaign_label?: string | null;
	organic_title?: string | null;
	image_url?: string | null;
	created_at: string;
	keywords?: ApiAdTrackedKeyword[];
};

type ApiAdRankDiagnosisPreset = {
	condition_id: string;
	gender: string;
	age_band: string;
	placement: DiagnosisPlacement;
	target_rank: number;
	scope: string;
};

type ApiAdRankKeywordTarget = {
	keyword: string;
	gender: string;
	age_band: string;
	placement: DiagnosisPlacement;
	condition_id: string;
	target_rank: number;
	source: 'keyword' | 'preset' | string;
};

type ApiAdRankDiagnosisDaily = {
	date: string;
	time_slot: string;
	keyword: string;
	gender: string;
	age_band: string;
	placement: DiagnosisPlacement;
	visible: boolean;
	rank?: number | null;
	ad_type?: string | null;
	status: string;
	error?: string | null;
};

type DiagnosisPlacement = 'mobile-search' | 'pc-search' | 'mobile-shopping' | 'pc-shopping';

type ApiAdKeywordRankLookupResponse = {
	keyword: string;
	keywords?: string[];
	genders?: string[];
	age_bands?: string[];
	placements?: string[];
	dates: string[];
	items: Array<{
		product_url: string;
		ranks: Array<{ date: string; rank: number | null; ad_type?: string | null }>;
	}>;
};

type AdKeywordCandidate = {
	id: number;
	keyword: string;
	isActive: boolean;
};

type AdKeywordRankLookupState = {
	keyword: string;
	keywords: string[];
	genders: string[];
	ageBands: string[];
	placements: string[];
	dates: string[];
	byProduct: Record<string, Array<{ rank: number | null; adType?: string | null }>>;
	loading?: boolean;
	error?: string | null;
};

const AGE_BANDS = ['30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60+', 'unknown'];
const AD_RANK_LIMIT = 92;
const GENDERS = [
	{ id: 'female', label: '여성' },
	{ id: 'male', label: '남성' },
];
const PLACEMENTS: Array<{ id: DiagnosisPlacement; label: string }> = [
	{ id: 'mobile-search', label: '통합검색 모바일' },
	{ id: 'pc-search', label: '통합검색 PC' },
	{ id: 'mobile-shopping', label: '쇼핑검색 모바일' },
	{ id: 'pc-shopping', label: '쇼핑검색 PC' },
];

function adAgeBandLabelOf(ageBand: string): string {
	if (ageBand === '60+') return '60세 이상';
	if (ageBand === 'unknown') return '알수없음';
	return ageBand;
}

function adGenderLabelOf(gender: string): string {
	return GENDERS.find((item) => item.id === gender)?.label || gender;
}

function adPlacementLabelOf(placement: string): string {
	return PLACEMENTS.find((item) => item.id === placement)?.label || placement;
}

function isAdvostAdType(adType?: string | null): boolean {
	const normalized = String(adType || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
	return normalized === 'advost' || normalized === 'advoost' || normalized === 'adboost';
}

function selectedLookupLabel<T extends string>(
	selected: T[],
	options: Array<{ value: T; label: string }>,
	allLabel = '전체',
): string {
	if (selected.length === 0) return allLabel;
	if (selected.length === 1) {
		const value = selected[0] as T;
		return options.find((item) => item.value === value)?.label || value;
	}
	return `${selected.length}개 선택`;
}

function normalizeUrl(input: string): string | null {
	const s = String(input || '').trim();
	if (!s) return null;
	if (!/^https?:\/\//i.test(s)) return null;
	try {
		const u = new URL(s);
		u.hash = '';
		return u.toString();
	} catch {
		return null;
	}
}

function makeProductName(url: string, index: number): string {
	try {
		const u = new URL(url);
		const parts = u.pathname.split('/').filter(Boolean);
		const last = parts[parts.length - 1] || u.hostname;
		return `광고 상품 ${index + 1} · ${last}`;
	} catch {
		return `광고 상품 ${index + 1}`;
	}
}

function mapApiProduct(item: ApiAdTrackedProduct): AdTrackedProduct {
	const url = String(item.product_url || '').trim();
	return {
		id: url,
		url,
		name: String(item.name || '').trim() || makeProductName(url, 0),
		campaignLabel: String(item.campaign_label || '').trim() || '검색광고 노출 진단',
		organicTitle: String(item.organic_title || '').trim() || undefined,
		imageUrl: String(item.image_url || '').trim() || undefined,
		keywords: Array.isArray(item.keywords)
			? item.keywords
				.map((kw) => ({
					id: Number(kw.id || 0),
					keyword: String(kw.keyword || '').trim(),
					isActive: kw.is_active !== false,
				}))
				.filter((kw) => Boolean(kw.keyword))
			: [],
		createdAt: String(item.created_at || new Date().toISOString()),
	};
}

function activeKeywordNames(product: Pick<AdTrackedProduct, 'keywords'>): string[] {
	return product.keywords.filter((kw) => kw.isActive).map((kw) => kw.keyword);
}

function serializeKeywords(keywords: AdKeywordCandidate[]): Array<{ keyword: string; is_active: boolean }> {
	return keywords.map((kw) => ({ keyword: kw.keyword, is_active: kw.isActive }));
}

function recentDates(days = 7): string[] {
	const out: string[] = [];
	const d = new Date();
	for (let i = 0; i < days; i += 1) {
		const x = new Date(d);
		x.setDate(d.getDate() - i);
		const mm = String(x.getMonth() + 1).padStart(2, '0');
		const dd = String(x.getDate()).padStart(2, '0');
		out.push(`${mm}.${dd}`);
	}
	return out;
}

function todayYmd(): string {
	const d = new Date();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${mm}-${dd}`;
}

function chipStyle(kind: 'ok' | 'warn' | 'muted' | 'danger' = 'muted'): React.CSSProperties {
	const colors = {
		ok: ['rgba(34,197,94,0.16)', '#86efac', 'rgba(34,197,94,0.35)'],
		warn: ['rgba(245,158,11,0.16)', '#fcd34d', 'rgba(245,158,11,0.35)'],
		danger: ['rgba(248,113,113,0.14)', '#fca5a5', 'rgba(248,113,113,0.35)'],
		muted: ['rgba(148,163,184,0.12)', '#cbd5e1', 'rgba(148,163,184,0.28)'],
	} as const;
	const [backgroundColor, color, borderColor] = colors[kind];
	return {
		display: 'inline-flex',
		alignItems: 'center',
		borderRadius: 999,
		border: `1px solid ${borderColor}`,
		backgroundColor,
		color,
		padding: '2px 7px',
		fontSize: 10,
		fontWeight: 700,
		whiteSpace: 'nowrap',
	};
}

function adTypeLabel(adType?: string | null): string | null {
	const normalized = String(adType || '').trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === 'search_ad' || normalized === 'searchad') return '검색광고';
	if (normalized === 'advoost' || normalized === 'ad_boost') return 'ADVoost';
	return adType || null;
}

function parseKeywords(input: string): string[] {
	return input
		.split(/[\n,]/)
		.map((v) => v.trim())
		.filter(Boolean)
		.filter((v, idx, arr) => arr.indexOf(v) === idx);
}

type DetailProps = {
	product: AdTrackedProduct;
	apiBaseUrl: string;
	onBack: () => void;
	onUpdate: (product: AdTrackedProduct) => Promise<void> | void;
};

const AdRankTrackingDetail: React.FC<DetailProps> = ({ product, apiBaseUrl, onBack, onUpdate }) => {
	const [keywordInput, setKeywordInput] = useState('');
	const [presets, setPresets] = useState<ApiAdRankDiagnosisPreset[]>([]);
	const [keywordTargets, setKeywordTargets] = useState<ApiAdRankKeywordTarget[]>([]);
	const [diagnosisRows, setDiagnosisRows] = useState<ApiAdRankDiagnosisDaily[]>([]);
	const [savingKeywords, setSavingKeywords] = useState(false);
	const [savingTargetKey, setSavingTargetKey] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [presetsExpanded, setPresetsExpanded] = useState(true);
	const [selectedTargetKeys, setSelectedTargetKeys] = useState<string[]>([]);
	const [batchTargetRank, setBatchTargetRank] = useState(20);
	const [savingBatch, setSavingBatch] = useState(false);
	const [targetKeywordFilter, setTargetKeywordFilter] = useState('');
	const [targetSortKey, setTargetSortKey] = useState<'keyword' | 'gender' | 'age' | 'placement' | 'rank' | 'status'>('keyword');
	const [targetSortDir, setTargetSortDir] = useState<'asc' | 'desc'>('asc');
	const [matrixKeywordFilters, setMatrixKeywordFilters] = useState<string[]>([]);
	const [matrixGenderFilters, setMatrixGenderFilters] = useState<string[]>([]);
	const [matrixAgeFilters, setMatrixAgeFilters] = useState<string[]>([]);
	const [matrixPlacementFilters, setMatrixPlacementFilters] = useState<string[]>([]);
	const [openMatrixFilter, setOpenMatrixFilter] = useState<'keyword' | 'gender' | 'age' | 'placement' | null>(null);
	const activeKeywordSignature = useMemo(() => activeKeywordNames(product).join('\n'), [product.keywords]);
	const dates = useMemo(() => recentDates(7), []);
	const corePresets = useMemo(() => presets.filter((item) => item.scope === 'core'), [presets]);
	const coreConditionCount = corePresets.length || 3 * GENDERS.length * 2;
	const sampleConditions = useMemo<ApiAdRankDiagnosisPreset[]>(
		() => (corePresets.length ? corePresets.slice(0, 3) : [
			{ condition_id: 'female:40-44:mobile-shopping', gender: 'female', age_band: '40-44', placement: 'mobile-shopping', target_rank: 20, scope: 'core' },
			{ condition_id: 'female:45-49:mobile-search', gender: 'female', age_band: '45-49', placement: 'mobile-search', target_rank: 20, scope: 'core' },
		]),
		[corePresets],
	);
	const conditionKey = (condition: Pick<ApiAdRankDiagnosisPreset, 'gender' | 'age_band' | 'placement'>) => (
		`${condition.gender}|${condition.age_band}|${condition.placement}`
	);
	const matrixConditions = useMemo<ApiAdRankDiagnosisPreset[]>(() => {
		const map = new Map<string, ApiAdRankDiagnosisPreset>();
		const sourceConditions = corePresets.length ? corePresets : sampleConditions;
		for (const condition of sourceConditions) {
			const key = conditionKey(condition);
			if (!map.has(key)) {
				map.set(key, condition);
			}
		}
		for (const row of diagnosisRows) {
			const key = conditionKey(row);
			if (!map.has(key)) {
				map.set(key, {
					condition_id: `${row.gender}:${row.age_band}:${row.placement}`,
					gender: row.gender,
					age_band: row.age_band,
					placement: row.placement,
					target_rank: 20,
					scope: 'collected',
				});
			}
		}
		return Array.from(map.values());
	}, [corePresets, diagnosisRows, sampleConditions]);
	const diagnosisMap = useMemo(() => {
		const map = new Map<string, ApiAdRankDiagnosisDaily>();
		for (const row of diagnosisRows) {
			const d = String(row.date || '').slice(5).replace('-', '.');
			map.set(`${row.keyword}|${row.gender}|${row.age_band}|${row.placement}|${d}`, row);
		}
		return map;
	}, [diagnosisRows]);
	const targetMap = useMemo(() => {
		const map = new Map<string, ApiAdRankKeywordTarget>();
		for (const row of keywordTargets) {
			map.set(`${row.keyword}|${row.gender}|${row.age_band}|${row.placement}`, row);
		}
		return map;
	}, [keywordTargets]);

	useEffect(() => {
		setSelectedTargetKeys([]);
		setTargetKeywordFilter('');
		setMatrixKeywordFilters([]);
		setMatrixGenderFilters([]);
		setMatrixAgeFilters([]);
		setMatrixPlacementFilters([]);
		setOpenMatrixFilter(null);
	}, [product.url]);

	useEffect(() => {
		let cancelled = false;
		setLoadError(null);
		Promise.all([
			axios.get<ApiAdRankDiagnosisPreset[]>(`${apiBaseUrl}/ad-rank/diagnosis/presets`, { params: { scope: 'core' } }),
			axios.get<ApiAdRankKeywordTarget[]>(`${apiBaseUrl}/ad-rank/diagnosis/keyword-targets`, { params: { product_url: product.url, scope: 'core' } }),
			axios.get<ApiAdRankDiagnosisDaily[]>(`${apiBaseUrl}/ad-rank/diagnosis/daily`, { params: { product_url: product.url, days: 7 } }),
		])
			.then(([presetRes, targetRes, diagnosisRes]) => {
				if (cancelled) return;
				setPresets(Array.isArray(presetRes.data) ? presetRes.data : []);
				setKeywordTargets(Array.isArray(targetRes.data) ? targetRes.data : []);
				setDiagnosisRows(Array.isArray(diagnosisRes.data) ? diagnosisRes.data : []);
			})
			.catch((err) => {
				if (cancelled) return;
				setLoadError(err?.response?.data?.detail || err?.message || '광고 진단 데이터를 불러오지 못했습니다.');
			});
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl, product.url, activeKeywordSignature]);

	const addKeywords = async () => {
		const existing = new Map(product.keywords.map((kw) => [kw.keyword, kw] as const));
		for (const keyword of parseKeywords(keywordInput)) {
			if (!existing.has(keyword)) {
				existing.set(keyword, { id: 0, keyword, isActive: true });
			}
		}
		const nextKeywords = Array.from(existing.values());
		setSavingKeywords(true);
		try {
			await onUpdate({ ...product, keywords: nextKeywords });
		} finally {
			setSavingKeywords(false);
		}
		setKeywordInput('');
	};

	const removeKeyword = async (keyword: string) => {
		setSavingKeywords(true);
		try {
			await onUpdate({ ...product, keywords: product.keywords.filter((k) => k.keyword !== keyword) });
		} finally {
			setSavingKeywords(false);
		}
	};

	const toggleCollectionTarget = async (keyword: string) => {
		setSavingKeywords(true);
		try {
			const nextKeywords = product.keywords.map((item) => (
				item.keyword === keyword ? { ...item, isActive: !item.isActive } : item
			));
			await onUpdate({ ...product, keywords: nextKeywords });
		} finally {
			setSavingKeywords(false);
		}
	};

	const ageBandLabelOf = (ageBand: string) => {
		if (ageBand === '60+') return '60세 이상';
		if (ageBand === 'unknown') return '알수없음';
		return ageBand;
	};
	const conditionLabel = (condition: Pick<ApiAdRankDiagnosisPreset, 'gender' | 'age_band' | 'placement'>) => {
		const genderLabel = GENDERS.find((item) => item.id === condition.gender)?.label || condition.gender;
		const placementLabel = PLACEMENTS.find((item) => item.id === condition.placement)?.label || condition.placement;
		return `${genderLabel} ${ageBandLabelOf(condition.age_band)} · ${placementLabel}`;
	};

	const rankCell = (row: { keyword: string; condition: ApiAdRankDiagnosisPreset }, date: string) => {
		const found = diagnosisMap.get(`${row.keyword}|${row.condition.gender}|${row.condition.age_band}|${row.condition.placement}|${date}`);
		if (!found) return <span style={{ color: '#64748b' }}>-</span>;
		if (found.status === 'failed') return <span style={chipStyle('danger')}>실패</span>;
		if (!found.visible) return <span style={chipStyle('warn')}>미노출</span>;
		const label = adTypeLabel(found.ad_type);
		return (
			<span style={{ ...chipStyle('ok'), gap: 5 }}>
				<span>{found.rank ? `${found.rank}위` : '노출'}</span>
				{label ? <span style={{ opacity: 0.82, fontSize: 10 }}>{label}</span> : null}
			</span>
		);
	};
	const rowCollectionStatus = (row: { keyword: string; condition: ApiAdRankDiagnosisPreset }) => {
		const todayKey = dates[0] || '';
		const found = diagnosisMap.get(`${row.keyword}|${row.condition.gender}|${row.condition.age_band}|${row.condition.placement}|${todayKey}`);
		if (!found) return <span style={chipStyle('warn')}>미수집</span>;
		if (found.status === 'failed') return <span style={chipStyle('danger')}>실패</span>;
		return <span style={chipStyle('ok')}>수집완료</span>;
	};
	const keywordCollectionStatus = (keyword: string) => {
		const todayKey = dates[0] || '';
		const conditions = matrixConditions || [];
		if (!todayKey || conditions.length === 0) return { label: '확인중', kind: 'muted' as const };
		let observed = 0;
		let failed = 0;
		for (const condition of conditions) {
			const found = diagnosisMap.get(`${keyword}|${condition.gender}|${condition.age_band}|${condition.placement}|${todayKey}`);
			if (!found) continue;
			observed += 1;
			if (found.status === 'failed') failed += 1;
		}
		if (observed === 0) return { label: '미수집', kind: 'warn' as const };
		if (failed > 0) return { label: `부분실패 ${failed}`, kind: 'danger' as const };
		if (observed >= conditions.length) return { label: '수집완료', kind: 'ok' as const };
		return { label: `부분수집 ${observed}/${conditions.length}`, kind: 'warn' as const };
	};

	const targetKey = (target: Pick<ApiAdRankKeywordTarget, 'keyword' | 'gender' | 'age_band' | 'placement'>) => (
		`${target.keyword}|${target.gender}|${target.age_band}|${target.placement}`
	);

	const targetFor = (keyword: string, condition: ApiAdRankDiagnosisPreset): ApiAdRankKeywordTarget => {
		const found = targetMap.get(`${keyword}|${condition.gender}|${condition.age_band}|${condition.placement}`);
		if (found) return found;
		return {
			keyword,
			gender: condition.gender,
			age_band: condition.age_band,
			placement: condition.placement,
			condition_id: condition.condition_id,
			target_rank: condition.target_rank || 20,
			source: 'preset',
		};
	};

	const updateKeywordTargetRank = async (target: ApiAdRankKeywordTarget, value: number) => {
		const nextRank = Math.max(1, Math.min(AD_RANK_LIMIT, Math.round(Number(value) || 20)));
		const key = targetKey(target);
		setKeywordTargets((prev) => {
			const next = prev.map((item) => (targetKey(item) === key ? { ...item, target_rank: nextRank, source: 'keyword' } : item));
			return next.some((item) => targetKey(item) === key) ? next : [...next, { ...target, target_rank: nextRank, source: 'keyword' }];
		});
		setSavingTargetKey(key);
		try {
			const res = await axios.put<ApiAdRankKeywordTarget>(
				`${apiBaseUrl}/ad-rank/diagnosis/keyword-targets`,
				{
					keyword: target.keyword,
					gender: target.gender,
					age_band: target.age_band,
					placement: target.placement,
					target_rank: nextRank,
				},
			);
			setKeywordTargets((prev) => prev.map((item) => (targetKey(item) === key ? res.data : item)));
		} catch (err: any) {
			setLoadError(err?.response?.data?.detail || err?.message || '기준 순위를 저장하지 못했습니다.');
		} finally {
			setSavingTargetKey(null);
		}
	};

	const toggleTargetSelected = (key: string) => {
		setSelectedTargetKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
	};

	const genderLabelOf = (gender: string) => GENDERS.find((item) => item.id === gender)?.label || gender;
	const placementLabelOf = (placement: string) => PLACEMENTS.find((item) => item.id === placement)?.label || placement;

	const visibleKeywordTargets = useMemo(() => {
		const q = targetKeywordFilter.trim().toLowerCase();
		const filtered = q
			? keywordTargets.filter((target) => String(target.keyword || '').toLowerCase().includes(q))
			: keywordTargets.slice();
		const dir = targetSortDir === 'asc' ? 1 : -1;
		const cmpText = (a: string, b: string) => a.localeCompare(b, 'ko', { sensitivity: 'base', numeric: true }) * dir;
		filtered.sort((a, b) => {
			if (targetSortKey === 'keyword') return cmpText(String(a.keyword || ''), String(b.keyword || ''));
			if (targetSortKey === 'gender') return cmpText(genderLabelOf(a.gender), genderLabelOf(b.gender));
			if (targetSortKey === 'age') return cmpText(ageBandLabelOf(String(a.age_band || '')), ageBandLabelOf(String(b.age_band || '')));
			if (targetSortKey === 'placement') return cmpText(placementLabelOf(a.placement), placementLabelOf(b.placement));
			if (targetSortKey === 'rank') {
				const ra = Number(a.target_rank || 20);
				const rb = Number(b.target_rank || 20);
				if (ra !== rb) return (ra - rb) * dir;
				return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko', { sensitivity: 'base', numeric: true });
			}
			// status: custom(keyword) vs preset, then rank
			const sa = a.source === 'keyword' ? 0 : 1;
			const sb = b.source === 'keyword' ? 0 : 1;
			if (sa !== sb) return (sa - sb) * dir;
			const ra = Number(a.target_rank || 20);
			const rb = Number(b.target_rank || 20);
			if (ra !== rb) return (ra - rb) * dir;
			return String(a.keyword || '').localeCompare(String(b.keyword || ''), 'ko', { sensitivity: 'base', numeric: true });
		});
		return filtered;
	}, [keywordTargets, targetKeywordFilter, targetSortDir, targetSortKey]);

	const visibleTargetKeys = useMemo(() => visibleKeywordTargets.map((target) => targetKey(target)), [visibleKeywordTargets]);
	const targetKeySet = useMemo(() => new Set(keywordTargets.map((target) => targetKey(target))), [keywordTargets]);
	const selectedVisibleTargetCount = visibleTargetKeys.filter((key) => selectedTargetKeys.includes(key)).length;
	const hiddenSelectedTargetCount = Math.max(0, selectedTargetKeys.length - selectedVisibleTargetCount);
	const allVisibleTargetsSelected = visibleTargetKeys.length > 0 && selectedVisibleTargetCount === visibleTargetKeys.length;
	const someVisibleTargetsSelected = selectedVisibleTargetCount > 0 && !allVisibleTargetsSelected;

	useEffect(() => {
		setSelectedTargetKeys((prev) => {
			if (prev.length === 0) return prev;
			const next = prev.filter((key) => targetKeySet.has(key));
			return next.length === prev.length ? prev : next;
		});
	}, [targetKeySet]);

	const toggleSelectAllTargets = () => {
		setSelectedTargetKeys((prev) => {
			if (visibleTargetKeys.length === 0) return prev;
			const allSelected = visibleTargetKeys.every((key) => prev.includes(key));
			if (allSelected) return prev.filter((key) => !visibleTargetKeys.includes(key));
			const next = new Set(prev);
			for (const key of visibleTargetKeys) next.add(key);
			return Array.from(next);
		});
	};

	const toggleTargetSort = (key: typeof targetSortKey) => {
		if (targetSortKey === key) {
			setTargetSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setTargetSortKey(key);
		setTargetSortDir('asc');
	};

	const sortIndicator = (key: typeof targetSortKey) => {
		if (targetSortKey !== key) return ' ↕';
		return targetSortDir === 'asc' ? ' ▲' : ' ▼';
	};

	const applyBatchTargetRank = async () => {
		const nextRank = Math.max(1, Math.min(AD_RANK_LIMIT, Math.round(Number(batchTargetRank) || 20)));
		const selected = keywordTargets.filter((target) => selectedTargetKeys.includes(targetKey(target)));
		if (!selected.length) return;
		setBatchTargetRank(nextRank);
		setSavingBatch(true);
		setLoadError(null);
		setKeywordTargets((prev) => prev.map((item) => (
			selectedTargetKeys.includes(targetKey(item)) ? { ...item, target_rank: nextRank, source: 'keyword' } : item
		)));
		try {
			const results = await Promise.all(
				selected.map(async (target) => {
					const res = await axios.put<ApiAdRankKeywordTarget>(
						`${apiBaseUrl}/ad-rank/diagnosis/keyword-targets`,
						{
							keyword: target.keyword,
							gender: target.gender,
							age_band: target.age_band,
							placement: target.placement,
							target_rank: nextRank,
						},
					);
					return res.data;
				}),
			);
			const byKey = new Map(results.map((item) => [targetKey(item), item] as const));
			setKeywordTargets((prev) => prev.map((item) => byKey.get(targetKey(item)) || item));
		} catch (err: any) {
			setLoadError(err?.response?.data?.detail || err?.message || '일괄 기준 순위를 저장하지 못했습니다.');
		} finally {
			setSavingBatch(false);
		}
	};

	const sampleRows = useMemo(() => {
		const seen = new Set<string>();
		const rows: string[] = [];
		for (const keyword of [...activeKeywordNames(product), ...diagnosisRows.map((row) => row.keyword)]) {
			const value = String(keyword || '').trim();
			if (!value || seen.has(value)) continue;
			seen.add(value);
			rows.push(value);
		}
		return rows.slice(0, 12);
	}, [diagnosisRows, product.keywords]);

	const matrixRows = useMemo(() => sampleRows.flatMap((keyword) => matrixConditions.map((condition) => {
		const target = targetFor(keyword, condition);
		return {
			keyword,
			condition,
			gender: condition.gender,
			age_band: condition.age_band,
			placement: condition.placement,
			baseline: `${target.target_rank || 20}위 이내`,
		};
	})), [matrixConditions, sampleRows, targetMap]);

	const matrixFilterOptions = useMemo(() => {
		const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
		const ageOrder = new Map(AGE_BANDS.map((value, index) => [value, index]));
		const genderOrder = new Map(GENDERS.map((item, index) => [item.id, index]));
		const placementOrder = new Map<string, number>(PLACEMENTS.map((item, index) => [item.id, index]));
		return {
			keywords: unique(matrixRows.map((row) => row.keyword)).map((value) => ({ value, label: value })),
			genders: unique(matrixRows.map((row) => row.gender))
				.sort((a, b) => (genderOrder.get(a) ?? 99) - (genderOrder.get(b) ?? 99))
				.map((value) => ({ value, label: genderLabelOf(value) })),
			ages: unique(matrixRows.map((row) => row.age_band))
				.sort((a, b) => (ageOrder.get(a) ?? 99) - (ageOrder.get(b) ?? 99))
				.map((value) => ({ value, label: ageBandLabelOf(value) })),
			placements: unique(matrixRows.map((row) => row.placement))
				.sort((a, b) => (placementOrder.get(a) ?? 99) - (placementOrder.get(b) ?? 99))
				.map((value) => ({ value, label: placementLabelOf(value) })),
		};
	}, [matrixRows]);

	const matchesMatrixFilter = (value: string, selected: string[]) => selected.length === 0 || selected.includes(value);
	const visibleMatrixRows = useMemo(() => matrixRows.filter((row) => (
		matchesMatrixFilter(row.keyword, matrixKeywordFilters)
		&& matchesMatrixFilter(row.gender, matrixGenderFilters)
		&& matchesMatrixFilter(row.age_band, matrixAgeFilters)
		&& matchesMatrixFilter(row.placement, matrixPlacementFilters)
	)), [matrixAgeFilters, matrixGenderFilters, matrixKeywordFilters, matrixPlacementFilters, matrixRows]);

	const toggleMatrixFilter = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
		setter((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
	};

	const matrixFilterHeader = (
		label: string,
		filterKey: 'keyword' | 'gender' | 'age' | 'placement',
		selected: string[],
		options: Array<{ value: string; label: string }>,
		setter: React.Dispatch<React.SetStateAction<string[]>>,
	) => (
		<div style={{ display: 'grid', gap: 4 }}>
			<span>{label}</span>
			<button
				type="button"
				className="btn-ghost"
				style={{ justifyContent: 'flex-start', padding: 0, color: selected.length ? '#fcd34d' : '#94a3b8', fontSize: 10 }}
				onClick={() => setOpenMatrixFilter((prev) => (prev === filterKey ? null : filterKey))}
			>
				<span style={{ marginRight: 4 }}>{openMatrixFilter === filterKey ? '▴' : '▾'}</span>
				<span>
					{selected.length ? `${selected.length}개 선택` : '전체'}
				</span>
			</button>
			{openMatrixFilter === filterKey ? (
				<div style={{
					position: 'absolute',
					zIndex: 20,
					display: 'grid',
					gap: 5,
					minWidth: 150,
					maxHeight: 260,
					overflowY: 'auto',
					marginTop: 4,
					padding: 8,
					border: '1px solid rgba(148,163,184,0.28)',
					borderRadius: 10,
					background: '#0f172a',
					boxShadow: '0 16px 36px rgba(0,0,0,0.38)',
				}}>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
						<button type="button" className="btn-ghost" style={{ justifyContent: 'flex-start', fontSize: 11 }} onClick={() => setter([])}>
							전체 보기
						</button>
						<button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setOpenMatrixFilter(null)}>
							닫기
						</button>
					</div>
					{options.map((option) => (
						<label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cbd5e1', fontSize: 11, whiteSpace: 'nowrap' }}>
							<input
								type="checkbox"
								checked={selected.includes(option.value)}
								onChange={() => toggleMatrixFilter(option.value, setter)}
							/>
							<span>{option.label}</span>
						</label>
					))}
				</div>
			) : null}
		</div>
	);

	return (
		<div className="rank-detail-root">
			<div className="card" style={{ marginBottom: 12 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
					<button type="button" className="btn-ghost" onClick={onBack}>
						← 목록으로
					</button>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						<span style={chipStyle('warn')}>CDP 진단 설계</span>
						<span style={chipStyle('ok')}>DB 저장/API 연결</span>
					</div>
				</div>
				{loadError ? (
					<div style={{ marginBottom: 10, color: '#fca5a5', fontSize: 11 }}>
						{loadError}
					</div>
				) : null}
				<div className="rank-detail-header">
					<div className="rank-detail-thumb">
						{product.imageUrl ? (
							<img src={product.imageUrl} alt={product.name} className="rank-product-thumb-img" />
						) : (
							<span className="rank-detail-thumb-placeholder">AD</span>
						)}
					</div>
					<div className="rank-detail-main">
						<div className="rank-detail-title">{product.name}</div>
						<div className="rank-detail-meta">
							<span>검색광고 노출 진단 추적</span>
							{product.organicTitle && product.organicTitle !== product.name ? <span>{product.organicTitle}</span> : null}
							<span>{product.url}</span>
							{product.campaignLabel ? <span>{product.campaignLabel}</span> : null}
						</div>
						<div className="rank-detail-tags" style={{ marginTop: 8 }}>
							<span className="rank-detail-tag">화면 선택 키워드만 추적</span>
							<span className="rank-detail-tag">검색 1회 → 전체 상품 판정</span>
							<span className="rank-detail-tag">광고 92위까지 수집</span>
						</div>
					</div>
				</div>
			</div>

			<div className="card" style={{ marginBottom: 12 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
					<div>
						<div className="card-title">광고 진단 키워드</div>
						<div className="card-caption">등록한 키워드는 바로 수집 대상이 됩니다. 필요 없는 키워드는 체크를 해제해 광고 순위 수집에서 제외할 수 있습니다. 내 상품 추적 키워드는 더 이상 자동으로 가져오지 않습니다.</div>
					</div>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
						<span style={chipStyle('ok')}>후보 {product.keywords.length}개</span>
						<span style={chipStyle('warn')}>수집 대상 {activeKeywordNames(product).length}개</span>
					</div>
				</div>
				<div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
					<textarea
						className="input"
						style={{ minHeight: 70, flex: 1, resize: 'vertical' }}
						placeholder="진단 키워드를 줄바꿈 또는 쉼표로 입력하세요. 등록 즉시 수집 대상에 포함됩니다."
						value={keywordInput}
						onChange={(e) => setKeywordInput(e.target.value)}
					/>
					<button type="button" className="btn-primary" onClick={addKeywords} disabled={!keywordInput.trim() || savingKeywords}>
						{savingKeywords ? '저장 중...' : '키워드 등록'}
					</button>
				</div>
				<div className="rank-product-keywords">
					{product.keywords.length === 0 ? <span style={{ color: '#9ca3af', fontSize: 11 }}>등록된 키워드가 없습니다.</span> : null}
					{product.keywords.map((item) => {
						const status = item.isActive ? keywordCollectionStatus(item.keyword) : { label: '후보', kind: 'muted' as const };
						return (
							<span key={item.keyword} className="rank-kw-chip">
								<label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
									<input
										type="checkbox"
										checked={item.isActive}
										onChange={() => void toggleCollectionTarget(item.keyword)}
										disabled={savingKeywords}
										aria-label={`${item.keyword} 수집 대상 선택`}
									/>
									<span className="rank-kw-text">{item.keyword}</span>
								</label>
								<span className="rank-kw-rank" style={{ color: status.kind === 'ok' ? '#86efac' : status.kind === 'danger' ? '#fca5a5' : status.kind === 'muted' ? '#cbd5e1' : '#fcd34d' }}>
									{status.label}
								</span>
								<button
									type="button"
									className="rank-kw-more"
									style={{ color: '#fca5a5' }}
									onClick={() => removeKeyword(item.keyword)}
									aria-label={`${item.keyword} 삭제`}
								>
									×
								</button>
							</span>
						);
					})}
				</div>
			</div>

			<div className="card" style={{ marginBottom: 12 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: presetsExpanded ? 12 : 0 }}>
					<div>
						<div className="card-title">진단 조건 프리셋 · 기준 순위</div>
						{presetsExpanded ? (
							<div className="card-caption">조건별로 키워드를 검색하고, 검색 결과의 광고 영역 92위 안에서 등록 상품 전체의 노출 순위를 판정합니다. 기준 순위는 조건별 목표선입니다.</div>
						) : (
							<div className="card-caption">접힌 상태 · 선택 {selectedTargetKeys.length.toLocaleString()}건 · 핵심 {coreConditionCount.toLocaleString()}검색/키워드</div>
						)}
					</div>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
						<span style={chipStyle('warn')}>핵심 {coreConditionCount.toLocaleString()}검색/키워드</span>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => setPresetsExpanded((prev) => !prev)}
							aria-expanded={presetsExpanded}
							aria-label={presetsExpanded ? '진단 조건 프리셋 접기' : '진단 조건 프리셋 펼치기'}
							title={presetsExpanded ? '접기' : '펼치기'}
						>
							{presetsExpanded ? '접기 ▴' : '펼치기 ▾'}
						</button>
					</div>
				</div>
				{presetsExpanded ? (
					<>
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
							<span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700 }}>
								선택 {selectedTargetKeys.length.toLocaleString()} / 표시 {visibleKeywordTargets.length.toLocaleString()}
								{targetKeywordFilter.trim() ? ` (전체 ${keywordTargets.length.toLocaleString()})` : ''}
								{hiddenSelectedTargetCount > 0 ? ` · 숨김 선택 ${hiddenSelectedTargetCount.toLocaleString()}` : ''}
							</span>
							<input
								className="input"
								type="search"
								value={targetKeywordFilter}
								onChange={(e) => setTargetKeywordFilter(e.target.value)}
								placeholder="키워드 검색 필터"
								aria-label="기준 순위 표 키워드 검색 필터"
								style={{ width: 180, minWidth: 140 }}
							/>
							{targetKeywordFilter.trim() ? (
								<button type="button" className="btn-ghost" onClick={() => setTargetKeywordFilter('')}>
									필터 초기화
								</button>
							) : null}
							<input
								className="input"
								type="number"
								min={1}
								max={AD_RANK_LIMIT}
								value={batchTargetRank}
								onChange={(e) => setBatchTargetRank(Number(e.target.value))}
								style={{ width: 88, textAlign: 'center' }}
								aria-label="일괄 적용 기준 순위"
								disabled={savingBatch || selectedTargetKeys.length === 0}
							/>
							<button
								type="button"
								className="btn-primary"
								onClick={() => void applyBatchTargetRank()}
								disabled={savingBatch || selectedTargetKeys.length === 0}
							>
								{savingBatch ? '일괄 적용 중…' : '선택 항목 일괄 순위 적용'}
							</button>
							{selectedTargetKeys.length > 0 ? (
								<button type="button" className="btn-ghost" onClick={() => setSelectedTargetKeys([])} disabled={savingBatch}>
									전체 선택 해제
								</button>
							) : null}
						</div>
						<div style={{ overflowX: 'auto' }}>
							<table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 11 }}>
								<thead>
									<tr style={{ color: '#9ca3af', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>
										<th style={{ textAlign: 'center', padding: '8px 6px', width: 42 }}>
											<input
												type="checkbox"
												checked={allVisibleTargetsSelected}
												ref={(el) => {
													if (el) el.indeterminate = someVisibleTargetsSelected;
												}}
												onChange={toggleSelectAllTargets}
												disabled={visibleKeywordTargets.length === 0 || savingBatch}
												aria-label="표시 중인 기준 순위 전체 선택"
											/>
										</th>
										<th style={{ textAlign: 'left', padding: '8px 6px' }}>
											<button type="button" className="btn-ghost" style={{ padding: '0 2px', fontSize: 11, fontWeight: 800 }} onClick={() => toggleTargetSort('keyword')}>
												키워드{sortIndicator('keyword')}
											</button>
										</th>
										<th style={{ textAlign: 'left', padding: '8px 6px' }}>
											<button type="button" className="btn-ghost" style={{ padding: '0 2px', fontSize: 11, fontWeight: 800 }} onClick={() => toggleTargetSort('gender')}>
												성별{sortIndicator('gender')}
											</button>
										</th>
										<th style={{ textAlign: 'left', padding: '8px 6px' }}>
											<button type="button" className="btn-ghost" style={{ padding: '0 2px', fontSize: 11, fontWeight: 800 }} onClick={() => toggleTargetSort('age')}>
												연령{sortIndicator('age')}
											</button>
										</th>
										<th style={{ textAlign: 'left', padding: '8px 6px' }}>
											<button type="button" className="btn-ghost" style={{ padding: '0 2px', fontSize: 11, fontWeight: 800 }} onClick={() => toggleTargetSort('placement')}>
												노출 지면{sortIndicator('placement')}
											</button>
										</th>
										<th style={{ textAlign: 'center', padding: '8px 6px' }}>
											<button type="button" className="btn-ghost" style={{ padding: '0 2px', fontSize: 11, fontWeight: 800 }} onClick={() => toggleTargetSort('rank')}>
												기준 순위{sortIndicator('rank')}
											</button>
										</th>
										<th style={{ textAlign: 'center', padding: '8px 6px' }}>
											<button type="button" className="btn-ghost" style={{ padding: '0 2px', fontSize: 11, fontWeight: 800 }} onClick={() => toggleTargetSort('status')}>
												상태{sortIndicator('status')}
											</button>
										</th>
									</tr>
								</thead>
								<tbody>
									{activeKeywordNames(product).length === 0 ? (
										<tr>
											<td colSpan={7} style={{ padding: 14, color: '#9ca3af', textAlign: 'center' }}>
												수집 대상으로 선택한 키워드가 있어야 키워드별 기준 순위를 설정할 수 있습니다.
											</td>
										</tr>
									) : keywordTargets.length === 0 ? (
										<tr>
											<td colSpan={7} style={{ padding: 14, color: '#9ca3af', textAlign: 'center' }}>
												키워드별 기준 순위를 불러오는 중입니다.
											</td>
										</tr>
									) : visibleKeywordTargets.length === 0 ? (
										<tr>
											<td colSpan={7} style={{ padding: 14, color: '#9ca3af', textAlign: 'center' }}>
												키워드 검색 조건에 맞는 행이 없습니다.
											</td>
										</tr>
									) : visibleKeywordTargets.map((target) => {
										const key = targetKey(target);
										const selected = selectedTargetKeys.includes(key);
										return (
										<tr key={key} style={{ borderBottom: '1px solid rgba(148,163,184,0.10)', background: selected ? 'rgba(45,212,191,0.06)' : undefined }}>
											<td style={{ padding: '8px 6px', textAlign: 'center' }}>
												<input
													type="checkbox"
													checked={selected}
													onChange={() => toggleTargetSelected(key)}
													disabled={savingBatch}
													aria-label={`${target.keyword} ${conditionLabel(target)} 선택`}
												/>
											</td>
											<td style={{ padding: '8px 6px', color: '#e5e7eb', fontWeight: 800 }}>{target.keyword}</td>
											<td style={{ padding: '8px 6px', color: '#e5e7eb' }}>{genderLabelOf(target.gender)}</td>
											<td style={{ padding: '8px 6px', color: '#cbd5e1' }}>{ageBandLabelOf(target.age_band)}</td>
											<td style={{ padding: '8px 6px', color: '#cbd5e1' }}>{placementLabelOf(target.placement)}</td>
											<td style={{ padding: '8px 6px', textAlign: 'center' }}>
												<input
													className="input"
													type="number"
													min={1}
													max={AD_RANK_LIMIT}
													value={target.target_rank || 20}
													onChange={(e) => void updateKeywordTargetRank(target, Number(e.target.value))}
													style={{ width: 80, textAlign: 'center' }}
													aria-label={`${target.keyword} ${conditionLabel(target)} 기준 순위`}
													disabled={savingBatch}
												/>
											</td>
											<td style={{ padding: '8px 6px', textAlign: 'center' }}>
												<span style={chipStyle(savingTargetKey === key || (savingBatch && selected) ? 'warn' : target.source === 'keyword' ? 'ok' : 'muted')}>
													{savingTargetKey === key || (savingBatch && selected) ? '저장 중' : `${target.target_rank || 20}위 이내`}
												</span>
											</td>
										</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</>
				) : null}
			</div>

			<div className="card">
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
					<div>
						<div className="card-title">조건별 노출 순위 매트릭스</div>
						<div className="card-caption">광고 순위는 네이버 노출현황 결과 한계인 92위까지 저장합니다. 키워드별 1회 검색 결과를 상품별로 나누어 누적합니다.</div>
					</div>
					<span style={chipStyle('muted')}>최근 7일 DB 결과</span>
				</div>
				<div style={{ overflowX: 'auto' }}>
					<table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120, fontSize: 11 }}>
						<thead>
							<tr style={{ color: '#9ca3af', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>
								<th style={{ textAlign: 'left', padding: '8px 6px', position: 'relative' }}>
									{matrixFilterHeader('키워드', 'keyword', matrixKeywordFilters, matrixFilterOptions.keywords, setMatrixKeywordFilters)}
								</th>
								<th style={{ textAlign: 'left', padding: '8px 6px', position: 'relative' }}>
									{matrixFilterHeader('성별', 'gender', matrixGenderFilters, matrixFilterOptions.genders, setMatrixGenderFilters)}
								</th>
								<th style={{ textAlign: 'left', padding: '8px 6px', position: 'relative' }}>
									{matrixFilterHeader('연령', 'age', matrixAgeFilters, matrixFilterOptions.ages, setMatrixAgeFilters)}
								</th>
								<th style={{ textAlign: 'left', padding: '8px 6px', position: 'relative' }}>
									{matrixFilterHeader('지면', 'placement', matrixPlacementFilters, matrixFilterOptions.placements, setMatrixPlacementFilters)}
								</th>
								<th style={{ textAlign: 'center', padding: '8px 6px' }}>기준</th>
								<th style={{ textAlign: 'center', padding: '8px 6px' }}>상태</th>
								{dates.map((date) => (
									<th key={date} style={{ textAlign: 'center', padding: '8px 6px' }}>{date}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{sampleRows.length === 0 ? (
								<tr>
									<td colSpan={dates.length + 6} style={{ padding: 18, color: '#9ca3af', textAlign: 'center' }}>
										키워드를 등록하면 조건별 순위 매트릭스가 표시됩니다.
									</td>
								</tr>
							) : visibleMatrixRows.length === 0 ? (
								<tr>
									<td colSpan={dates.length + 6} style={{ padding: 18, color: '#9ca3af', textAlign: 'center' }}>
										선택한 필터 조건에 맞는 매트릭스 행이 없습니다.
									</td>
								</tr>
							) : visibleMatrixRows.map((row) => (
								<tr key={`${row.keyword}-${row.condition.condition_id}`} style={{ borderBottom: '1px solid rgba(148,163,184,0.10)' }}>
									<td style={{ padding: '8px 6px', color: '#e5e7eb', fontWeight: 700 }}>{row.keyword}</td>
									<td style={{ padding: '8px 6px', color: '#e5e7eb' }}>{genderLabelOf(row.gender)}</td>
									<td style={{ padding: '8px 6px', color: '#cbd5e1' }}>{ageBandLabelOf(row.age_band)}</td>
									<td style={{ padding: '8px 6px', color: '#cbd5e1' }}>{placementLabelOf(row.placement)}</td>
									<td style={{ padding: '8px 6px', textAlign: 'center', color: '#fcd34d' }}>{row.baseline}</td>
									<td style={{ padding: '8px 6px', textAlign: 'center' }}>{rowCollectionStatus(row)}</td>
									{dates.map((date) => (
										<td key={date} style={{ padding: '8px 6px', textAlign: 'center', color: '#64748b' }}>{rankCell(row, date)}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
};

type AdRankTrackingViewProps = {
	apiBaseUrl: string;
};

const AdRankTrackingView: React.FC<AdRankTrackingViewProps> = ({ apiBaseUrl }) => {
	const [products, setProducts] = useState<AdTrackedProduct[]>([]);
	const [listDiagnosisRowsByProduct, setListDiagnosisRowsByProduct] = useState<Record<string, ApiAdRankDiagnosisDaily[]>>({});
	const [inputUrl, setInputUrl] = useState('');
	const [lookupKeywords, setLookupKeywords] = useState<string[]>([]);
	const [lookupGenders, setLookupGenders] = useState<string[]>([]);
	const [lookupAgeBands, setLookupAgeBands] = useState<string[]>([]);
	const [lookupPlacements, setLookupPlacements] = useState<string[]>([]);
	const [openLookupFilter, setOpenLookupFilter] = useState<'keyword' | 'gender' | 'age' | 'placement' | null>(null);
	const [keywordRankLookup, setKeywordRankLookup] = useState<AdKeywordRankLookupState | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		axios.get<ApiAdTrackedProduct[]>(`${apiBaseUrl}/ad-rank/tracked`)
			.then(async (res) => {
				if (cancelled) return;
				const nextProducts = (Array.isArray(res.data) ? res.data : []).map(mapApiProduct);
				setProducts(nextProducts);
				const entries = await Promise.all(
					nextProducts.map(async (product) => {
						try {
							const rows = await axios.get<ApiAdRankDiagnosisDaily[]>(`${apiBaseUrl}/ad-rank/diagnosis/daily`, {
								params: { product_url: product.url, days: 1 },
							});
							return [product.id, Array.isArray(rows.data) ? rows.data : []] as const;
						} catch {
							return [product.id, []] as const;
						}
					}),
				);
				if (!cancelled) setListDiagnosisRowsByProduct(Object.fromEntries(entries));
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err?.response?.data?.detail || err?.message || '광고 상품 추적 목록을 불러오지 못했습니다.');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [apiBaseUrl]);

	const selectedProduct = useMemo(() => products.find((item) => item.id === selectedId) || null, [products, selectedId]);
	const totalCandidateKeywords = products.reduce((sum, item) => sum + item.keywords.length, 0);
	const totalCollectionKeywords = products.reduce((sum, item) => sum + activeKeywordNames(item).length, 0);
	const lookupKeywordOptions = useMemo(() => {
		const keywords = new Set<string>();
		for (const product of products) {
			for (const item of product.keywords) {
				if (item.keyword.trim()) keywords.add(item.keyword.trim());
			}
		}
		return Array.from(keywords)
			.sort((a, b) => a.localeCompare(b, 'ko', { sensitivity: 'base', numeric: true }))
			.map((value) => ({ value, label: value }));
	}, [products]);
	const lookupGenderOptions = GENDERS.map((item) => ({ value: item.id, label: item.label }));
	const lookupAgeOptions = AGE_BANDS.map((value) => ({ value, label: adAgeBandLabelOf(value) }));
	const lookupPlacementOptions = PLACEMENTS.map((item) => ({ value: item.id, label: item.label }));

	const addProduct = async (e: React.FormEvent) => {
		e.preventDefault();
		const url = normalizeUrl(inputUrl);
		if (!url) return;
		setSaving(true);
		setError(null);
		try {
			const res = await axios.post<ApiAdTrackedProduct>(`${apiBaseUrl}/ad-rank/tracked`, {
				product_url: url,
				name: makeProductName(url, products.length),
				campaign_label: '검색광고 노출 진단',
				keywords: [],
			});
			const next = mapApiProduct(res.data);
			setProducts((prev) => [next, ...prev.filter((item) => item.id !== next.id)].slice(0, 20));
			setSelectedId(next.id);
			setInputUrl('');
		} catch (err: any) {
			setError(err?.response?.data?.detail || err?.message || '광고 상품을 저장하지 못했습니다.');
		} finally {
			setSaving(false);
		}
	};

	const updateProduct = async (next: AdTrackedProduct) => {
		setError(null);
		const res = await axios.put<ApiAdTrackedProduct>(`${apiBaseUrl}/ad-rank/tracked`, {
			product_url: next.url,
			name: next.name,
			campaign_label: next.campaignLabel || '검색광고 노출 진단',
			keywords: serializeKeywords(next.keywords),
		});
		const saved = mapApiProduct(res.data);
		setProducts((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
	};

	const deleteProduct = async (id: string) => {
		setError(null);
		try {
			await axios.delete(`${apiBaseUrl}/ad-rank/tracked/by-product`, { params: { product_url: id } });
			setProducts((prev) => prev.filter((item) => item.id !== id));
			if (selectedId === id) setSelectedId(null);
		} catch (err: any) {
			setError(err?.response?.data?.detail || err?.message || '광고 상품을 삭제하지 못했습니다.');
		}
	};

	const selectSingleLookupValue = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
		setter([value]);
		setOpenLookupFilter(null);
	};

	const lookupFilterControl = (
		label: string,
		filterKey: 'keyword' | 'gender' | 'age' | 'placement',
		selected: string[],
		options: Array<{ value: string; label: string }>,
		setter: React.Dispatch<React.SetStateAction<string[]>>,
		emptyLabel = '전체',
	) => (
		<div className="rank-lookup-filter">
			<div className="rank-lookup-filter-label">{label}</div>
			<button
				type="button"
				className="rank-lookup-filter-button"
				onClick={() => setOpenLookupFilter((prev) => (prev === filterKey ? null : filterKey))}
			>
				<span>{openLookupFilter === filterKey ? '▴' : '▾'}</span>
				<span>{selectedLookupLabel(selected, options, emptyLabel)}</span>
			</button>
			{openLookupFilter === filterKey ? (
				<div className="rank-lookup-filter-menu" onClick={(e) => e.stopPropagation()}>
					<div className="rank-lookup-filter-actions">
						<button type="button" className="btn-ghost" onClick={() => setter([])}>
							선택 해제
						</button>
						<button type="button" className="btn-ghost" onClick={() => setOpenLookupFilter(null)}>
							닫기
						</button>
					</div>
					{options.length === 0 ? (
						<div className="rank-lookup-filter-empty">등록된 후보가 없습니다.</div>
					) : options.map((option) => (
						<label key={option.value} className="rank-lookup-filter-option">
							<input
								type="radio"
								name={`ad-rank-lookup-${filterKey}`}
								checked={selected.includes(option.value)}
								onChange={() => selectSingleLookupValue(option.value, setter)}
							/>
							<span>{option.label}</span>
						</label>
					))}
				</div>
			) : null}
		</div>
	);

	const lookupAdKeywordRanks = async (e: React.FormEvent) => {
		e.preventDefault();
		const keywords = lookupKeywords.map((item) => item.trim()).filter(Boolean);
		if (keywords.length !== 1 || lookupGenders.length !== 1 || lookupAgeBands.length !== 1 || lookupPlacements.length !== 1) {
			setKeywordRankLookup({
				keyword: keywords[0] || '선택 필요',
				keywords,
				genders: lookupGenders,
				ageBands: lookupAgeBands,
				placements: lookupPlacements,
				dates: [],
				byProduct: {},
				loading: false,
				error: '광고센터와 동일 비교를 위해 키워드, 성별, 연령, 지면을 각각 1개씩 선택해 주세요.',
			});
			return;
		}
		const keywordLabel = selectedLookupLabel(keywords, keywords.map((value) => ({ value, label: value })), '키워드');
		setOpenLookupFilter(null);
		setKeywordRankLookup({
			keyword: keywordLabel,
			keywords,
			genders: lookupGenders,
			ageBands: lookupAgeBands,
			placements: lookupPlacements,
			dates: [],
			byProduct: {},
			loading: true,
			error: null,
		});
		try {
			const params = new URLSearchParams();
			keywords.forEach((value) => params.append('keywords', value));
			lookupGenders.forEach((value) => params.append('genders', value));
			lookupAgeBands.forEach((value) => params.append('age_bands', value));
			lookupPlacements.forEach((value) => params.append('placements', value));
			params.set('days', '7');
			const res = await axios.get<ApiAdKeywordRankLookupResponse>(`${apiBaseUrl}/ad-rank/tracked/keyword-ranks`, {
				params,
			});
			const data = res.data;
			const byProduct: Record<string, Array<{ rank: number | null; adType?: string | null }>> = {};
			for (const item of Array.isArray(data.items) ? data.items : []) {
				const url = String(item.product_url || '').trim();
				if (!url) continue;
				byProduct[url] = (Array.isArray(item.ranks) ? item.ranks : []).map((rankRow) => ({
					rank: typeof rankRow.rank === 'number' && rankRow.rank > 0 ? rankRow.rank : null,
					adType: typeof rankRow.ad_type === 'string' ? rankRow.ad_type : null,
				}));
			}
			const responseKeywords = Array.isArray(data.keywords) && data.keywords.length > 0 ? data.keywords : keywords;
			const responseGenders = Array.isArray(data.genders) ? data.genders : lookupGenders;
			const responseAgeBands = Array.isArray(data.age_bands) ? data.age_bands : lookupAgeBands;
			const responsePlacements = Array.isArray(data.placements) ? data.placements : lookupPlacements;
			setKeywordRankLookup({
				keyword: selectedLookupLabel(responseKeywords, responseKeywords.map((value) => ({ value, label: value })), '키워드'),
				keywords: responseKeywords,
				genders: responseGenders,
				ageBands: responseAgeBands,
				placements: responsePlacements,
				dates: Array.isArray(data.dates) ? data.dates : [],
				byProduct,
				loading: false,
				error: null,
			});
		} catch (err: any) {
			setKeywordRankLookup({
				keyword: keywordLabel,
				keywords,
				genders: lookupGenders,
				ageBands: lookupAgeBands,
				placements: lookupPlacements,
				dates: [],
				byProduct: {},
				loading: false,
				error: String(err?.response?.data?.detail ?? err?.message ?? '광고 순위 조회 실패'),
			});
		}
	};

	const listConditionCount = AGE_BANDS.length * GENDERS.length * PLACEMENTS.length;
	const listToday = todayYmd();
	const productTodayRows = (product: AdTrackedProduct) => (listDiagnosisRowsByProduct[product.id] || []).filter((row) => row.date === listToday);
	const productCollectionStatus = (product: AdTrackedProduct) => {
		const todayRows = productTodayRows(product);
		const activeCount = activeKeywordNames(product).length;
		const expected = activeCount * listConditionCount;
		const keys = new Set(todayRows.map((row) => `${row.keyword}|${row.gender}|${row.age_band}|${row.placement}`));
		const failed = todayRows.filter((row) => row.status === 'failed').length;
		if (expected <= 0) return { label: '수집 대상 없음', className: 'miss' };
		if (keys.size === 0) return { label: '92위 수집 대기', className: 'miss' };
		if (failed > 0) return { label: `부분실패 ${failed}건`, className: 'miss' };
		if (keys.size >= expected) return { label: `92위 수집 완료 ${keys.size}/${expected}`, className: 'ok' };
		return { label: `부분수집 ${keys.size}/${expected}`, className: 'miss' };
	};
	const productKeywordStatus = (product: AdTrackedProduct, keyword: string) => {
		const productRows = productTodayRows(product);
		const todayRows = productRows.filter((row) => row.keyword === keyword);
		const keys = new Set(todayRows.map((row) => `${row.gender}|${row.age_band}|${row.placement}`));
		const failed = todayRows.filter((row) => row.status === 'failed').length;
		if (keys.size === 0) return { label: productRows.length > 0 ? '수집대상' : '수집대기', kind: productRows.length > 0 ? 'muted' as const : 'warn' as const };
		if (failed > 0) return { label: `부분실패 ${failed}`, kind: 'danger' as const };
		if (keys.size >= listConditionCount) return { label: '수집완료', kind: 'ok' as const };
		return { label: `부분수집 ${keys.size}/${listConditionCount}`, kind: 'warn' as const };
	};

	if (selectedProduct) {
		return <AdRankTrackingDetail product={selectedProduct} apiBaseUrl={apiBaseUrl} onBack={() => setSelectedId(null)} onUpdate={updateProduct} />;
	}

	return (
		<div className="rank-list-root">
			<div className="card" style={{ marginBottom: 12 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
						<div style={{ fontSize: 13, fontWeight: 600 }}>내 광고 상품 추적</div>
						<div className="rank-channel-toggle" aria-label="광고 채널 선택">
							<button type="button" className="rank-channel-btn active">네이버 검색광고</button>
							<button type="button" className="rank-channel-btn disabled" disabled>GFA</button>
						</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<span style={chipStyle('ok')}>상품 {products.length}개</span>
						<span style={chipStyle('muted')}>후보 {totalCandidateKeywords}개</span>
						<span style={chipStyle('warn')}>수집 대상 {totalCollectionKeywords}개</span>
						<span style={chipStyle('muted')}>광고 92위 수집</span>
					</div>
				</div>
				<div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
					이 화면에서 등록한 후보 중 수집 대상으로 선택한 키워드만 사용합니다. 내 상품 추적 키워드는 자동으로 가져오지 않습니다.
				</div>
				{error ? (
					<div style={{ marginBottom: 10, color: '#fca5a5', fontSize: 11 }}>
						{error}
					</div>
				) : null}
				<form onSubmit={addProduct} className="rank-url-form" aria-label="광고 상품 추가 폼">
					<input
						className="input rank-url-input"
						placeholder="광고 추적 대상 상품 URL을 입력하세요"
						value={inputUrl}
						onChange={(e) => setInputUrl(e.target.value)}
					/>
					<button type="submit" className="btn-primary rank-url-submit" disabled={saving}>
						{saving ? '저장 중...' : '상품 추가'}
					</button>
				</form>
				<form onSubmit={lookupAdKeywordRanks} className="rank-lookup-form" aria-label="광고 키워드 순위 조회 폼">
					{lookupFilterControl('키워드', 'keyword', lookupKeywords, lookupKeywordOptions, setLookupKeywords, '선택 필요')}
					{lookupFilterControl('성별', 'gender', lookupGenders, lookupGenderOptions, setLookupGenders, '선택 필요')}
					{lookupFilterControl('연령', 'age', lookupAgeBands, lookupAgeOptions, setLookupAgeBands, '선택 필요')}
					{lookupFilterControl('지면', 'placement', lookupPlacements, lookupPlacementOptions, setLookupPlacements, '선택 필요')}
					<button
						type="submit"
						className="btn-primary rank-lookup-submit"
						disabled={lookupKeywords.length !== 1 || lookupGenders.length !== 1 || lookupAgeBands.length !== 1 || lookupPlacements.length !== 1 || keywordRankLookup?.loading}
						title="키워드, 성별, 연령, 지면을 각각 1개씩 선택해야 조회됩니다."
					>
						{keywordRankLookup?.loading ? '조회 중...' : '조회'}
					</button>
				</form>
				{keywordRankLookup?.error ? (
					<div style={{ marginTop: 6, color: '#fca5a5', fontSize: 11 }}>
						{keywordRankLookup.error}
					</div>
				) : null}
			</div>

			<div className="card">
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
					<div style={{ fontSize: 13, fontWeight: 600 }}>광고 상품 목록</div>
					<div style={{ fontSize: 11, color: '#9ca3af' }}>내 광고 상품 추적 화면에서 직접 관리</div>
				</div>
				<div className="rank-product-list">
					{loading ? (
						<div className="rank-product-empty">
							광고 상품 목록을 불러오는 중입니다.
						</div>
					) : null}
					{!loading && products.length === 0 ? (
						<div className="rank-product-empty">
							등록된 광고 상품이 없습니다. 상단에서 추적 대상 상품 URL을 추가해 주세요.
						</div>
					) : null}
					{products.map((product) => {
						const productStatus = productCollectionStatus(product);
						const lookupRanks = keywordRankLookup?.keyword ? (keywordRankLookup.byProduct[product.id] ?? []) : [];
						return (
						<div
							key={product.id}
							className="rank-product-card"
							role="button"
							tabIndex={0}
							onClick={() => setSelectedId(product.id)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									setSelectedId(product.id);
								}
							}}
						>
							<button
								type="button"
								className="btn-ghost"
								style={{ position: 'absolute', top: 8, right: 8, fontSize: 11, color: '#9ca3af' }}
								onClick={(e) => {
									e.stopPropagation();
									deleteProduct(product.id);
								}}
							>
								삭제
							</button>
							<div className="rank-product-thumb">
								{product.imageUrl ? (
									<img src={product.imageUrl} alt={product.name} className="rank-product-thumb-img" />
								) : (
									<span className="rank-product-thumb-placeholder">AD</span>
								)}
							</div>
							<div className="rank-product-main">
								<div className="rank-product-title">{product.name}</div>
								<div className="rank-product-meta">
									<span>{product.campaignLabel || '검색광고 노출 진단'}</span>
									{product.organicTitle && product.organicTitle !== product.name ? <span>{product.organicTitle}</span> : null}
									<span>{product.url}</span>
									<span>후보 {product.keywords.length}개</span>
									<span>수집 대상 {activeKeywordNames(product).length}개</span>
								</div>
								<div className="rank-product-keywords">
									{product.keywords.length === 0 ? (
										<span className="rank-kw-chip">
											<span className="rank-kw-text">키워드 후보 없음</span>
											<span className="rank-kw-rank">-</span>
											<span className="rank-kw-delta">-</span>
										</span>
									) : product.keywords.slice(0, 5).map((item) => {
										const keywordStatus = item.isActive ? productKeywordStatus(product, item.keyword) : { label: '후보', kind: 'muted' as const };
										return (
											<span key={item.keyword} className="rank-kw-chip">
												<span className="rank-kw-text">{item.keyword}</span>
												<span className="rank-kw-rank" style={{ color: keywordStatus.kind === 'ok' ? '#86efac' : keywordStatus.kind === 'danger' ? '#fca5a5' : keywordStatus.kind === 'muted' ? '#cbd5e1' : '#fcd34d' }}>
													{keywordStatus.label}
												</span>
												<span className="rank-kw-delta">-</span>
											</span>
										);
									})}
								</div>
							</div>
							{keywordRankLookup?.keyword ? (
								<div
									className="rank-product-lookup"
									onClick={(e) => e.stopPropagation()}
									role="note"
									aria-label={`${keywordRankLookup.keyword} 최근 7일 광고 순위`}
								>
									<div style={{ color: '#93c5fd', fontWeight: 900, textAlign: 'center', fontSize: 13 }}>
										{keywordRankLookup.keyword} · 광고 최근 7일
									</div>
									<div style={{ color: '#cbd5e1', textAlign: 'center', fontSize: 12, fontWeight: 700 }}>
										{[
											selectedLookupLabel(keywordRankLookup.genders, lookupGenderOptions),
											selectedLookupLabel(keywordRankLookup.ageBands, lookupAgeOptions),
											selectedLookupLabel(keywordRankLookup.placements, lookupPlacementOptions),
										].join(' · ')}
									</div>
									<div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, keywordRankLookup.dates.length)}, minmax(54px, 1fr))`, gap: 6 }}>
										{keywordRankLookup.dates.map((date, idx) => {
											const rankRow = lookupRanks[idx] ?? null;
											const rank = rankRow?.rank ?? null;
											const avLabel = isAdvostAdType(rankRow?.adType) ? ' AV' : '';
											return (
												<div key={`${product.id}-${date}`} style={{ textAlign: 'center', display: 'grid', gap: 3 }}>
													<div style={{ color: '#94a3b8', fontSize: 12 }}>{date.slice(5).replace('-', '.')}</div>
													<div style={{ color: rank != null ? '#86efac' : '#cbd5e1', fontWeight: 900, fontSize: 13 }}>
														{rank != null ? `${rank}위${avLabel}` : '순위밖'}
													</div>
												</div>
											);
										})}
									</div>
								</div>
							) : null}
							<div className={`rank-product-status ${productStatus.className}`} role="note">
								{productStatus.label}
							</div>
						</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};

export default AdRankTrackingView;
