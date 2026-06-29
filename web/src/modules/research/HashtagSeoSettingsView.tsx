import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import type { ShoppingTagsProduct, ShoppingTagsResponse } from './hashtagSeoTypes';
import {
	aggregateMatchedTags,
	matchTopProductsToManuTags,
	parseManuTagText,
	type ManuTagProduct,
	type MatchedTopProduct,
	type TagStat,
} from './hashtagSeoManuTag';

type SavedSelection = {
	id: string;
	keyword: string;
	title: string;
	tags: string[];
	createdAt: string;
};

const LS_KEY = 'hashtagSeo.settings.v1';

function safeJsonParse<T>(s: string | null, fallback: T): T {
	try {
		if (!s) return fallback;
		return JSON.parse(s) as T;
	} catch {
		return fallback;
	}
}

function uniq<T>(arr: T[]): T[] {
	return Array.from(new Set(arr));
}

function fmtHash(tag: string): string {
	const t = String(tag || '').trim().replace(/^#+/, '');
	return t ? `#${t}` : '';
}

type KeywordMetric = {
	pcSearch: number | null;
	mobileSearch: number | null;
	totalSearch: number | null;
	pcCtr: number | null;
	mobileCtr: number | null;
	avgCtr: number | null; // percent(0~100)
};

type MetricCacheEntry = { metric: KeywordMetric; fetchedAt: string };
const LS_METRICS_KEY = 'seoHashtagMetrics.v1';
const METRICS_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function fmtNum(v: number | null | undefined): string {
	if (v === null || v === undefined) return '-';
	if (!Number.isFinite(v)) return '-';
	return Number(v).toLocaleString();
}

function fmtPct(v: number | null | undefined): string {
	if (v === null || v === undefined) return '-';
	if (!Number.isFinite(v)) return '-';
	return `${Number(v).toFixed(1)}%`;
}

export function HashtagSeoSettingsView(props: { apiBaseUrl: string }): JSX.Element {
	const api = props.apiBaseUrl;

	// Step 1
	const [keyword, setKeyword] = useState('');

	// Step 2: Top40 목록
	const [topProducts, setTopProducts] = useState<ShoppingTagsProduct[]>([]);
	const [topLoading, setTopLoading] = useState(false);
	const [topError, setTopError] = useState<string | null>(null);

	// Step 3: manuTag 파일
	const [manuFileName, setManuFileName] = useState<string | null>(null);
	const [manuParsed, setManuParsed] = useState<ManuTagProduct[]>([]);
	const [manuError, setManuError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// Step 4: 매칭 결과
	const matchedRows: MatchedTopProduct[] = useMemo(() => {
		const top = (topProducts || []).map((p) => ({ rank: p.rank, title: p.title, link: p.link }));
		if (top.length === 0 || (manuParsed || []).length === 0) return [];
		return matchTopProductsToManuTags({ topProducts: top, manuProducts: manuParsed, minScore: 0.6 });
	}, [topProducts, manuParsed]);

	// Step 5: 태그 집계
	const tagStats: TagStat[] = useMemo(() => aggregateMatchedTags(matchedRows), [matchedRows]);

	// Step 5.5: 태그 키워드툴 지표(월검색량/CTR)
	const [metricsLoading, setMetricsLoading] = useState(false);
	const [metricsError, setMetricsError] = useState<string | null>(null);
	const [metricsMap, setMetricsMap] = useState<Record<string, KeywordMetric>>({});
	const metricsAbortRef = useRef<AbortController | null>(null);
	const [metricsLimit, setMetricsLimit] = useState(50);

	const loadMetricsCache = (): Record<string, MetricCacheEntry> => safeJsonParse<Record<string, MetricCacheEntry>>(localStorage.getItem(LS_METRICS_KEY), {});
	const saveMetricsCache = (next: Record<string, MetricCacheEntry>) => {
		try {
			localStorage.setItem(LS_METRICS_KEY, JSON.stringify(next));
		} catch {
			// ignore
		}
	};

	// Step 6: 제외/선택
	const [excluded, setExcluded] = useState<Set<string>>(new Set());
	const [tagSearch, setTagSearch] = useState('');

	const visibleTagStats = useMemo(() => {
		const q = String(tagSearch || '').trim().toLowerCase();
		if (!q) return tagStats;
		return tagStats.filter((t) => t.tag.toLowerCase().includes(q));
	}, [tagStats, tagSearch]);

	const includedTags = useMemo(() => {
		const ex = excluded;
		return tagStats.map((x) => x.tag).filter((t) => !ex.has(t));
	}, [tagStats, excluded]);

	const excludedTags = useMemo(() => {
		const ex = excluded;
		return tagStats.map((x) => x.tag).filter((t) => ex.has(t));
	}, [tagStats, excluded]);

	const loadKeywordMetrics = async (keywords: string[], opts?: { maxKeywords?: number }): Promise<void> => {
		const cleaned = uniq(
			(keywords || [])
				.map((x) => String(x || '').trim().replace(/^#+/, ''))
				.filter(Boolean),
		).slice(0, 200);
		if (cleaned.length === 0) return;

		// localStorage 캐시(12h)로 불필요한 재호출 최소화
		const cache = loadMetricsCache();
		const now = Date.now();
		const cachedMap: Record<string, KeywordMetric> = {};
		const toFetch: string[] = [];
		for (const k of cleaned) {
			const ent = cache[k];
			const ts = ent?.fetchedAt ? Date.parse(ent.fetchedAt) : NaN;
			const fresh = Number.isFinite(ts) && now - ts <= METRICS_TTL_MS;
			if (ent?.metric && fresh) cachedMap[k] = ent.metric;
			else toFetch.push(k);
		}

		// 이미 캐시가 있으면 먼저 화면에 뿌린다(UX)
		if (Object.keys(cachedMap).length > 0) {
			setMetricsMap((prev) => ({ ...prev, ...cachedMap }));
		}

		const maxKeywords = Math.max(1, Math.min(Number(opts?.maxKeywords ?? metricsLimit), 200));
		const fetchList = toFetch.slice(0, maxKeywords);
		if (fetchList.length === 0) return;

		try {
			metricsAbortRef.current?.abort();
		} catch {
			// ignore
		}
		const ac = new AbortController();
		metricsAbortRef.current = ac;

		setMetricsLoading(true);
		setMetricsError(null);
		try {
			const resp = await axios.post(
				`${api}/research/seo/keyword-metrics`,
				{ keywords: fetchList, max_keywords: maxKeywords },
				{ signal: ac.signal },
			);
			if (ac.signal.aborted) return;
			const m = (resp.data?.metrics ?? {}) as Record<string, KeywordMetric>;
			setMetricsMap(m);
			// 캐시 저장(병합)
			const nextCache = loadMetricsCache();
			for (const [k, metric] of Object.entries(m)) {
				if (!k) continue;
				nextCache[k] = { metric, fetchedAt: new Date().toISOString() };
			}
			saveMetricsCache(nextCache);

			// 결과 병합(기존 캐시 + 신규)
			setMetricsMap((prev) => ({ ...prev, ...m }));

			const err = String(resp.data?.error || '').trim();
			const truncated = Boolean(resp.data?.truncated);
			const retryAfterSec = resp.data?.retryAfterSec ? Number(resp.data.retryAfterSec) : null;
			if (err) {
				if (retryAfterSec && String(err).includes('429')) {
					setMetricsError(`SearchAd 제한(429)으로 일부만 조회되었습니다. ${retryAfterSec}초 후 다시 시도하세요.`);
				} else if (truncated) {
					setMetricsError(`지표는 한 번에 최대 ${String(resp.data?.maxKeywords ?? maxKeywords)}개까지만 조회합니다. “다음 ${metricsLimit}개”로 이어서 불러오세요.`);
				} else {
					setMetricsError(err);
				}
			} else if (truncated) {
				setMetricsError(`지표는 한 번에 최대 ${String(resp.data?.maxKeywords ?? maxKeywords)}개까지만 조회합니다. “다음 ${metricsLimit}개”로 이어서 불러오세요.`);
			}
		} catch (e: any) {
			if (ac.signal.aborted) return;
			setMetricsMap({});
			setMetricsError(e?.response?.data?.detail ?? e?.message ?? '지표 불러오기 실패');
		} finally {
			if (!ac.signal.aborted) setMetricsLoading(false);
		}
	};

	// tagStats가 만들어지면(=매칭 완료) 기본은 Top50만 자동 로드(429 방지)
	useEffect(() => {
		if (tagStats.length === 0) {
			setMetricsMap({});
			setMetricsError(null);
			setMetricsLoading(false);
			return;
		}
		void loadKeywordMetrics(tagStats.slice(0, metricsLimit).map((x) => x.tag), { maxKeywords: metricsLimit });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tagStats, metricsLimit]);

	const [savedTitle, setSavedTitle] = useState('');
	const [saved, setSaved] = useState<SavedSelection[]>(() => safeJsonParse<SavedSelection[]>(localStorage.getItem(LS_KEY), []));

	const persistSaved = (next: SavedSelection[]) => {
		setSaved(next);
		try {
			localStorage.setItem(LS_KEY, JSON.stringify(next));
		} catch {
			// ignore
		}
	};

	const fetchTop40 = async (): Promise<void> => {
		const q = keyword.trim();
		if (!q) return;
		setTopLoading(true);
		setTopError(null);
		try {
			// Top40 목록만 필요하므로 scrape_products=0
			const resp = await axios.get<ShoppingTagsResponse>(`${api}/research/seo/shopping-tags`, {
				params: { keyword: q, limit: 40, scrape_products: 0 },
			});
			const rows = Array.isArray(resp.data?.products) ? resp.data.products : [];
			setTopProducts(rows);
		} catch (e: any) {
			setTopProducts([]);
			setTopError(e?.response?.data?.detail ?? e?.message ?? 'Top40 조회 실패');
		} finally {
			setTopLoading(false);
		}
	};

	const onPickFile = async (f: File | null): Promise<void> => {
		if (!f) return;
		setManuFileName(f.name);
		setManuError(null);
		try {
			const text = await f.text();
			const r = parseManuTagText(text);
			if (r.errors.length > 0) {
				setManuParsed([]);
				setManuError(r.errors[0] ?? 'parse_failed');
				return;
			}
			setManuParsed(r.products);
			// 새로운 파일을 올리면 제외 상태는 초기화(사용자 혼선 방지)
			setExcluded(new Set());
		} catch (e: any) {
			setManuParsed([]);
			setManuError(String(e?.message ?? e ?? 'file_read_failed'));
		}
	};

	const toggleExclude = (tag: string) => {
		const t = String(tag || '').trim().replace(/^#+/, '');
		if (!t) return;
		setExcluded((prev) => {
			const next = new Set(prev);
			if (next.has(t)) next.delete(t);
			else next.add(t);
			return next;
		});
	};

	const excludeAllVisible = () => {
		setExcluded((prev) => {
			const next = new Set(prev);
			for (const t of visibleTagStats) next.add(t.tag);
			return next;
		});
	};

	const includeAllVisible = () => {
		setExcluded((prev) => {
			const next = new Set(prev);
			for (const t of visibleTagStats) next.delete(t.tag);
			return next;
		});
	};

	const saveFinal = async () => {
		const tags = includedTags.map((t) => String(t).replace(/^#+/, '')).filter(Boolean);
		if (!keyword.trim() || tags.length === 0) return;
		const now = new Date().toISOString();
		const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		const title = (savedTitle || '').trim() || `해시태그(선택): ${keyword.trim()}`;
		const next: SavedSelection = { id, keyword: keyword.trim(), title, tags, createdAt: now };
		persistSaved([next, ...(saved || [])].slice(0, 200));
		try {
			await navigator.clipboard.writeText(tags.map((t) => `#${t}`).join(' '));
		} catch {
			// ignore
		}
	};

	const summaryText = useMemo(() => {
		const tp = topProducts.length;
		const mp = manuParsed.length;
		const matched = matchedRows.filter((r) => r.matched).length;
		const totalTags = tagStats.length;
		return `Top상품 ${tp} · manuTag상품 ${mp} · 매칭 ${matched}/${tp} · 태그 ${totalTags}`;
	}, [topProducts.length, manuParsed.length, matchedRows, tagStats.length]);

	return (
		<div style={{ display: 'grid', gap: 14 }}>
			<div className="card">
				<div className="card-title">해시태그 SEO 세팅(5-2)</div>
				<div className="card-caption">
					키워드 Top40 상품명과 업로드한 manuTag 파일을 매칭해, 필요한 해시태그만 선택/확정합니다.
				</div>
			</div>

			<div className="card">
				<div className="card-title">1) 키워드 입력</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, alignItems: 'end', marginTop: 10 }}>
					<div>
						<label className="field-label" htmlFor="hs-keyword-input">키워드</label>
						<input
							id="hs-keyword-input"
							className="input"
							value={keyword}
							onChange={(e) => setKeyword(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									void fetchTop40();
								}
							}}
							placeholder="예: 헤나"
						/>
					</div>
					<button type="button" className="btn-primary" onClick={() => void fetchTop40()} disabled={topLoading || !keyword.trim()}>
						조회
					</button>
				</div>
				{topError ? <div style={{ marginTop: 10, color: '#fecaca', fontSize: 12, fontWeight: 900 }}>{String(topError)}</div> : null}
				<div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>{topLoading ? '불러오는 중…' : summaryText}</div>
			</div>

			<div className="card">
				<div className="card-title">2) Top40 상품 리스트</div>
				<div className="card-caption">조회 결과를 그대로 표시합니다. (순위/상품명)</div>
				<div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
					{topProducts.length === 0 ? (
						<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>키워드를 입력하고 “조회”를 눌러주세요.</div>
					) : (
						topProducts.map((p) => (
							<div key={`${p.rank}-${p.title}`} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 70px', gap: 10, alignItems: 'center' }}>
								<div style={{ fontWeight: 900, color: '#93c5fd' }}>{p.rank}</div>
								<div style={{ fontWeight: 900, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
									{p.title}
								</div>
								{p.link ? (
									<button type="button" className="btn-ghost" onClick={() => window.open(String(p.link), '_blank', 'noopener,noreferrer')}>
										열기
									</button>
								) : (
									<div />
								)}
							</div>
						))
					)}
				</div>
			</div>

			<div className="card">
				<div className="card-title">3) manuTag(txt) 업로드</div>
				<div className="card-caption">Network에서 저장한 JSON(txt) 파일(예: manuTag.txt)을 업로드하세요.</div>
				<div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
					<input
						ref={fileInputRef}
						type="file"
						accept=".txt,.json"
						onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
					/>
					{manuFileName ? <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 900 }}>{manuFileName}</span> : null}
					{manuParsed.length > 0 ? <span style={{ fontSize: 12, color: '#a7f3d0', fontWeight: 900 }}>파싱 {manuParsed.length}건</span> : null}
				</div>
				{manuError ? <div style={{ marginTop: 10, color: '#fecaca', fontSize: 12, fontWeight: 900 }}>{String(manuError)}</div> : null}
			</div>

			<div className="card">
				<div className="card-title">4) 상품명 × manuTag 매칭 결과</div>
				<div className="card-caption">Top40 상품명과 업로드 파일의 productName을 매칭해 태그를 붙입니다.</div>
				<div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
					{matchedRows.length === 0 ? (
						<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>
							Top40 조회 + manuTag 업로드가 모두 완료되면 여기에 매칭 결과가 표시됩니다.
						</div>
					) : (
						matchedRows.map((r) => (
							<div key={`${r.rank}-${r.title}`} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: 12, padding: 10 }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
									<div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
										<div style={{ width: 36, height: 28, borderRadius: 10, background: 'rgba(59,130,246,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
											{r.rank}
										</div>
										<div style={{ fontWeight: 900, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
											{r.title}
										</div>
									</div>
									<div style={{ fontSize: 12, fontWeight: 900, color: r.matched ? '#a7f3d0' : '#fca5a5' }}>
										{r.matched ? `매칭(${Math.round(r.matchScore * 100)}%)` : '미매칭'}
									</div>
								</div>
								{r.matched ? (
									<div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
										{(r.tags || []).length === 0 ? (
											<span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>manuTag 없음</span>
										) : (
											(r.tags || []).slice(0, 30).map((t) => (
												<span key={`${r.rank}-${t}`} style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid rgba(59,130,246,0.25)', background: 'rgba(59,130,246,0.12)', color: '#bfdbfe', fontSize: 12, fontWeight: 900 }}>
													{fmtHash(t)}
												</span>
											))
										)}
									</div>
								) : null}
							</div>
						))
					)}
				</div>
			</div>

			<div className="card">
				<div className="card-title">5) 필터링된 해시태그 리스트</div>
				<div className="card-caption">업로드 파일에서 “Top40에 매칭된 상품”의 manuTag만 모아서 리스트업합니다.</div>

				<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 240px', gap: 12, alignItems: 'end' }}>
					<div>
						<label className="field-label" htmlFor="hs-tag-search">해시태그 검색</label>
						<input id="hs-tag-search" className="input" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="예: 오늘출발" />
					</div>
					<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => void loadKeywordMetrics(tagStats.slice(0, metricsLimit).map((x) => x.tag), { maxKeywords: metricsLimit })}
							disabled={tagStats.length === 0 || metricsLoading}
							title={`SearchAd 키워드툴로 월검색량/CTR을 불러옵니다(기본 ${metricsLimit}개, 캐시 적용).`}
						>
							{metricsLoading ? '지표 불러오는 중…' : '검색량/CTR 불러오기'}
						</button>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => void loadKeywordMetrics(tagStats.slice(metricsLimit, metricsLimit + 50).map((x) => x.tag), { maxKeywords: 50 })}
							disabled={tagStats.length <= metricsLimit || metricsLoading}
							title="다음 50개 태그의 지표를 이어서 불러옵니다."
						>
							다음 50개
						</button>
						<button type="button" className="btn-ghost" onClick={includeAllVisible} disabled={visibleTagStats.length === 0}>
							검색결과 전체 포함
						</button>
						<button type="button" className="btn-ghost" onClick={excludeAllVisible} disabled={visibleTagStats.length === 0}>
							검색결과 전체 제외
						</button>
					</div>
				</div>

				{metricsError ? (
					<div style={{ marginTop: 10, color: '#fde68a', fontSize: 12, fontWeight: 900 }}>
						지표 경고: {String(metricsError)}
					</div>
				) : null}

				<div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
					{visibleTagStats.length === 0 ? (
						<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>표시할 해시태그가 없습니다.</div>
					) : (
						<>
							<div
								style={{
									display: 'grid',
									gridTemplateColumns: '28px 1fr 90px 90px 60px 140px',
									gap: 10,
									alignItems: 'center',
									fontSize: 12,
									color: '#9ca3af',
									fontWeight: 900,
									paddingBottom: 6,
									borderBottom: '1px solid rgba(148,163,184,0.12)',
								}}
							>
								<div />
								<div>해시태그</div>
								<div style={{ textAlign: 'right' }}>월검색량</div>
								<div style={{ textAlign: 'right' }}>클릭율</div>
								<div style={{ textAlign: 'right' }}>count</div>
								<div style={{ textAlign: 'right' }}>노출 rank</div>
							</div>
							{visibleTagStats.slice(0, 200).map((t) => {
							const isExcluded = excluded.has(t.tag);
							const m = metricsMap?.[t.tag] ?? null;
							return (
								<div
									key={t.tag}
									style={{
										display: 'grid',
										gridTemplateColumns: '28px 1fr 90px 90px 60px 140px',
										gap: 10,
										alignItems: 'center',
									}}
								>
									<input
										type="checkbox"
										checked={!isExcluded}
										onChange={() => toggleExclude(t.tag)}
										aria-label={`include-${t.tag}`}
									/>
									<div style={{ fontWeight: 900, color: isExcluded ? '#94a3b8' : '#e2e8f0' }}>{fmtHash(t.tag)}</div>
									<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900, textAlign: 'right' }}>
										{m ? fmtNum(m.totalSearch) : metricsLoading ? '…' : '-'}
									</div>
									<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900, textAlign: 'right' }}>
										{m ? fmtPct(m.avgCtr) : metricsLoading ? '…' : '-'}
									</div>
									<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900, textAlign: 'right' }}>{t.count}</div>
									<div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 900, textAlign: 'right' }}>
										{t.ranks.length > 0 ? `rank ${t.ranks.slice(0, 6).join(',')}${t.ranks.length > 6 ? '…' : ''}` : '-'}
									</div>
								</div>
							);
						})}
						</>
					)}
				</div>
			</div>

			<div className="card">
				<div className="card-title">6) 최종 결정(저장/복사)</div>
				<div className="card-caption">제외하지 않은 해시태그만 최종 확정합니다.</div>
				<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, alignItems: 'end' }}>
					<div>
						<label className="field-label" htmlFor="hs-save-title">세트 이름(선택)</label>
						<input id="hs-save-title" className="input" value={savedTitle} onChange={(e) => setSavedTitle(e.target.value)} placeholder={`예: ${keyword || '키워드'} 최종 태그`} />
					</div>
					<button type="button" className="btn-primary" onClick={() => void saveFinal()} disabled={!keyword.trim() || includedTags.length === 0}>
						최종 결정
					</button>
				</div>
				<div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
					{includedTags.length === 0 ? (
						<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>포함된 태그가 없습니다.</div>
					) : (
						includedTags.slice(0, 80).map((t) => (
							<span key={t} style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.14)', color: '#a7f3d0', fontSize: 12, fontWeight: 900 }}>
								{fmtHash(t)}
							</span>
						))
					)}
				</div>
				{excludedTags.length > 0 ? (
					<div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>
						제외 {excludedTags.length}개 / 포함 {includedTags.length}개
					</div>
				) : (
					<div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>
						포함 {includedTags.length}개
					</div>
				)}
			</div>

			<div className="card">
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
					<div className="card-title">저장된 세트</div>
					<button type="button" className="btn-ghost" onClick={() => persistSaved([])} disabled={(saved || []).length === 0}>
						전체 삭제
					</button>
				</div>
				<div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
					{(saved || []).length === 0 ? (
						<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900 }}>저장된 세트가 없습니다.</div>
					) : (
						(saved || []).slice(0, 30).map((s) => (
							<div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px', gap: 10, alignItems: 'center' }}>
								<div style={{ minWidth: 0 }}>
									<div style={{ fontWeight: 900, color: '#e2e8f0' }}>{s.title}</div>
									<div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
										{s.tags.map((t) => `#${t}`).join(' ')}
									</div>
								</div>
								<button
									type="button"
									className="btn-ghost"
									onClick={() => {
										try {
											void navigator.clipboard.writeText(s.tags.map((t) => `#${t}`).join(' '));
										} catch {}
									}}
								>
									복사
								</button>
								<button type="button" className="btn-ghost" style={{ color: '#fca5a5' }} onClick={() => persistSaved((saved || []).filter((x) => x.id !== s.id))}>
									삭제
								</button>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}

