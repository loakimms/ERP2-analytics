import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { toYmd } from './dateRangeUtils';

type KeywordTrendPoint = { date: string; ratio: number };
type KeywordEstimatedPoint = { date: string; searches: number };
type KeywordDistributionItem = { label: string; ratio: number };

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
	} | null;
	trend?: {
		points?: KeywordTrendPoint[] | null;
		estimatedDailySearches?: { points: KeywordEstimatedPoint[] } | null;
	} | null;
	distributions?: {
		gender?: KeywordDistributionItem[] | null;
		device?: KeywordDistributionItem[] | null;
		age?: KeywordDistributionItem[] | null;
		dayOfWeek?: KeywordDistributionItem[] | null;
	} | null;
	shopping?: {
		category: string | null;
		categoryPath?: string | null;
		categoryConfidencePct?: number | null;
		categoryIdSource?: string | null;
	} | null;
};

function fmtInt(v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return '-';
	return Math.round(v).toLocaleString();
}

function fmtPct(v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return '-';
	return `${(v * 100).toFixed(2)}%`;
}

function pctLabel(v: number): string {
	if (!Number.isFinite(v)) return '0%';
	return `${Math.round(v * 100)}%`;
}

function normalizeDist(items: KeywordDistributionItem[] | null | undefined): { name: string; ratio: number }[] {
	const list = Array.isArray(items) ? items : [];
	return list
		.map((x) => ({ name: String(x?.label ?? ''), ratio: Number(x?.ratio ?? 0) || 0 }))
		.filter((x) => x.name);
}

function normalizeTrendPoints(points: KeywordTrendPoint[] | null | undefined): { date: string; value: number }[] {
	const list = Array.isArray(points) ? points : [];
	return list
		.map((p) => ({ date: String(p?.date ?? ''), value: Number(p?.ratio ?? 0) || 0 }))
		.filter((x) => x.date);
}

function normalizeEstimatedPoints(points: KeywordEstimatedPoint[] | null | undefined): { date: string; value: number }[] {
	const list = Array.isArray(points) ? points : [];
	return list
		.map((p) => ({ date: String(p?.date ?? ''), value: Number(p?.searches ?? 0) || 0 }))
		.filter((x) => x.date);
}

export function KeywordInsightsTrendsModal(props: {
	open: boolean;
	apiBaseUrl: string;
	keyword: string;
	onClose: () => void;
	days?: number;
}): JSX.Element | null {
	const open = Boolean(props.open);
	const keyword = String(props.keyword || '').trim();
	// 기본 기간: 최근 1개월(요청)
	const days = Number(props.days ?? 30) || 30;

	const { dateFrom, dateTo } = useMemo(() => {
		const to = new Date();
		const from = new Date(to);
		from.setDate(from.getDate() - days);
		return { dateFrom: toYmd(from), dateTo: toYmd(to) };
	}, [days]);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [data, setData] = useState<KeywordInsightsResponse | null>(null);

	const run = async (): Promise<void> => {
		if (!open) return;
		if (!keyword) {
			setError('키워드가 비어있습니다.');
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const resp = await axios.get<KeywordInsightsResponse>(
				`${String(props.apiBaseUrl || '').replace(/\/$/, '')}/research/keyword-insights`,
				{
					params: {
						keyword,
						date_from: dateFrom,
						date_to: dateTo,
						// “소재 분석” 모달은 기존 키워드 인사이트(카테고리/추천/연관키워드 등)와 완전 분리된 뷰다.
						// - 캐시로 인해 값이 "그대로" 남는 혼동을 줄이기 위해 기본 true
						force: true,
					},
				},
			);
			setData(resp.data);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '조회에 실패했습니다.';
			setError(String(msg));
			setData(null);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void run();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, keyword, dateFrom, dateTo]);

	const gender = useMemo(() => normalizeDist(data?.distributions?.gender ?? null), [data]);
	const device = useMemo(() => normalizeDist(data?.distributions?.device ?? null), [data]);
	const age = useMemo(() => normalizeDist(data?.distributions?.age ?? null), [data]);
	const dayOfWeek = useMemo(() => normalizeDist(data?.distributions?.dayOfWeek ?? null), [data]);

	const estimatedPoints = useMemo(
		() => normalizeEstimatedPoints(data?.trend?.estimatedDailySearches?.points ?? null),
		[data],
	);
	const ratioPoints = useMemo(() => normalizeTrendPoints(data?.trend?.points ?? null), [data]);
	const isEstimated = estimatedPoints.length > 0;
	const trend = isEstimated ? estimatedPoints : ratioPoints;
	const trendLabel = isEstimated ? '추정 일 검색량' : '검색 트렌드(상대값)';

	if (!open) return null;

	return (
		<div className="modal-backdrop" role="dialog" aria-label="키워드 인사이트">
			{/* 화면의 70~80% 수준으로 넓게(스크롤/차트 가독성 개선) */}
			<div
				className="modal-card"
				style={{
					width: '80vw',
					height: '80vh',
					maxWidth: '80vw',
					maxHeight: '80vh',
				}}
			>
				<div className="modal-header">
					<div className="modal-title">
						키워드 인사이트 · {keyword || '-'}
						<span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>
							({dateFrom} ~ {dateTo})
						</span>
					</div>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						<button type="button" className="btn-ghost" onClick={() => void run()} disabled={loading || !keyword}>
							다시 조회
						</button>
						<button type="button" className="btn-ghost" onClick={props.onClose}>
							닫기
						</button>
					</div>
				</div>

				{/* 상단 info(요청: 카테고리 라인만) */}
				{data?.shopping?.categoryPath ? (
					<div style={{ padding: '10px 12px 0 12px' }}>
						<div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
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
						</div>
					</div>
				) : null}

				{/* 상단 KPI 요약(요청: PC/모바일/월간 검색량/CTR 등) */}
				{data?.keywordSummary ? (
					<div
						style={{
							padding: '10px 12px 0 12px',
							display: 'grid',
							gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
							gap: 8,
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

				<div className="modal-body" style={{ flex: 1, overflow: 'auto' }}>
					{error ? (
						<div className="card" style={{ borderColor: 'rgba(248,113,113,0.55)' }}>
							<div style={{ fontSize: 12, color: '#fecaca' }}>{error}</div>
						</div>
					) : null}

					<div className="space-y-3">
						<div className="card">
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
								<div style={{ fontSize: 12, fontWeight: 900 }}>{trendLabel}</div>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>
									{loading ? '조회 중…' : (data?.cached ? '캐시' : '실시간')}
								</div>
							</div>
							<div style={{ width: '100%', height: 260, marginTop: 10 }}>
								<ResponsiveContainer width="100%" height="100%">
									<LineChart data={trend}>
										<CartesianGrid stroke="rgba(148,163,184,0.16)" />
										<XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
										<YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
										<Tooltip
											formatter={(v: any) => [
												Number(v ?? 0),
												isEstimated ? 'searches' : 'value',
											]}
											labelFormatter={(l: any) => String(l ?? '')}
											contentStyle={{
												background: 'rgba(2,6,23,0.92)',
												border: '1px solid rgba(148,163,184,0.22)',
												borderRadius: 10,
												color: '#e5e7eb',
												fontSize: 12,
												fontWeight: 800,
											}}
											labelStyle={{ color: '#e5e7eb', fontWeight: 900 }}
											itemStyle={{ color: '#e5e7eb' }}
										/>
										<Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
									</LineChart>
								</ResponsiveContainer>
							</div>
						</div>

						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
							<div className="card">
								<div style={{ fontSize: 12, fontWeight: 900 }}>성별</div>
								<div style={{ width: '100%', height: 220, marginTop: 8 }}>
									<ResponsiveContainer width="100%" height="100%">
										<BarChart data={gender} layout="vertical" margin={{ left: 12, right: 18 }}>
											<CartesianGrid stroke="rgba(148,163,184,0.12)" />
											<XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
											<YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={56} />
											<Tooltip
												formatter={(v: any) => pctLabel(Number(v || 0))}
												contentStyle={{
													background: 'rgba(2,6,23,0.92)',
													border: '1px solid rgba(148,163,184,0.22)',
													borderRadius: 10,
													color: '#e5e7eb',
													fontSize: 12,
													fontWeight: 800,
												}}
												labelStyle={{ color: '#e5e7eb', fontWeight: 900 }}
												itemStyle={{ color: '#e5e7eb' }}
											/>
											<Bar dataKey="ratio" fill="#a78bfa" radius={[8, 8, 8, 8]} />
										</BarChart>
									</ResponsiveContainer>
								</div>
							</div>

							<div className="card">
								<div style={{ fontSize: 12, fontWeight: 900 }}>기기</div>
								<div style={{ width: '100%', height: 220, marginTop: 8 }}>
									<ResponsiveContainer width="100%" height="100%">
										<BarChart data={device} layout="vertical" margin={{ left: 12, right: 18 }}>
											<CartesianGrid stroke="rgba(148,163,184,0.12)" />
											<XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
											<YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={56} />
											<Tooltip
												formatter={(v: any) => pctLabel(Number(v || 0))}
												contentStyle={{
													background: 'rgba(2,6,23,0.92)',
													border: '1px solid rgba(148,163,184,0.22)',
													borderRadius: 10,
													color: '#e5e7eb',
													fontSize: 12,
													fontWeight: 800,
												}}
												labelStyle={{ color: '#e5e7eb', fontWeight: 900 }}
												itemStyle={{ color: '#e5e7eb' }}
											/>
											<Bar dataKey="ratio" fill="#34d399" radius={[8, 8, 8, 8]} />
										</BarChart>
									</ResponsiveContainer>
								</div>
							</div>
						</div>

						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
							<div className="card">
								<div style={{ fontSize: 12, fontWeight: 900 }}>연령</div>
								<div style={{ width: '100%', height: 240, marginTop: 8 }}>
									<ResponsiveContainer width="100%" height="100%">
										<BarChart data={age} margin={{ left: 8, right: 18 }}>
											<CartesianGrid stroke="rgba(148,163,184,0.12)" />
											<XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
											<YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
											<Tooltip
												formatter={(v: any) => pctLabel(Number(v || 0))}
												contentStyle={{
													background: 'rgba(2,6,23,0.92)',
													border: '1px solid rgba(148,163,184,0.22)',
													borderRadius: 10,
													color: '#e5e7eb',
													fontSize: 12,
													fontWeight: 800,
												}}
												labelStyle={{ color: '#e5e7eb', fontWeight: 900 }}
												itemStyle={{ color: '#e5e7eb' }}
											/>
											<Bar dataKey="ratio" fill="#fbbf24" radius={[8, 8, 0, 0]} />
										</BarChart>
									</ResponsiveContainer>
								</div>
							</div>

							<div className="card">
								<div style={{ fontSize: 12, fontWeight: 900 }}>요일</div>
								<div style={{ width: '100%', height: 240, marginTop: 8 }}>
									<ResponsiveContainer width="100%" height="100%">
										<BarChart data={dayOfWeek} margin={{ left: 8, right: 18 }}>
											<CartesianGrid stroke="rgba(148,163,184,0.12)" />
											<XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
											<YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
											<Tooltip
												formatter={(v: any) => pctLabel(Number(v || 0))}
												contentStyle={{
													background: 'rgba(2,6,23,0.92)',
													border: '1px solid rgba(148,163,184,0.22)',
													borderRadius: 10,
													color: '#e5e7eb',
													fontSize: 12,
													fontWeight: 800,
												}}
												labelStyle={{ color: '#e5e7eb', fontWeight: 900 }}
												itemStyle={{ color: '#e5e7eb' }}
											/>
											<Bar dataKey="ratio" fill="#fb7185" radius={[8, 8, 0, 0]} />
										</BarChart>
									</ResponsiveContainer>
								</div>
							</div>
						</div>
					</div>
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

