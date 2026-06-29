import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
	fetchSalesCoverage,
	fetchSalesDashboard,
	syncSalesCommerceOrdersRange,
	syncSalesYesterday,
	type SalesCoverageResponse,
	type SalesDashboardResponse,
} from './salesApi';
import { useNavigate } from 'react-router-dom';
import { SalesDateRangeControls } from './SalesDateRangeControls';

function toYmd(d: Date): string {
	return format(d, 'yyyy-MM-dd');
}

function parseYmd(s: string): Date | null {
	try {
		const dt = parseISO(String(s || '').trim());
		if (!Number.isFinite(dt.getTime())) return null;
		return dt;
	} catch {
		return null;
	}
}

function fmtWon(n: number): string {
	const v = Number(n) || 0;
	try {
		return `${Math.round(v).toLocaleString('ko-KR')}원`;
	} catch {
		return `${Math.round(v)}원`;
	}
}

function fmtInt(n: number): string {
	const v = Number(n) || 0;
	try {
		return `${Math.round(v).toLocaleString('ko-KR')}`;
	} catch {
		return String(Math.round(v));
	}
}

function truncateChartLabel(text: string, maxLen: number): string {
	const s = String(text || '').trim();
	if (s.length <= maxLen) return s;
	return `${s.slice(0, Math.max(1, maxLen - 3))}...`;
}

function estimateAxisWidth(labels: string[], base = 120, max = 220): number {
	const longest = labels.reduce((acc, cur) => Math.max(acc, String(cur || '').length), 0);
	return Math.max(base, Math.min(max, 16 + longest * 4));
}

type CoverageHighlight = {
	date: string;
	label: string;
	tone?: 'danger' | 'default';
	detail?: string;
	rawReason?: string;
};

function formatCoverageFailureReason(reasonText: string): { label: string; detail?: string; rawReason?: string } {
	const rawReason = String(reasonText || '').trim();
	if (!rawReason) return { label: '수집 실패' };
	const upper = rawReason.toUpperCase();
	if (upper.includes('GW.IP_NOT_ALLOWED') || upper.includes('IP_NOT_ALLOWED') || rawReason.includes('commerce_ip_not_allowed')) {
		return {
			label: '허용 IP 미등록',
			detail: '커머스 API 센터의 허용 IP에 현재 공인 IP를 추가해야 합니다.',
			rawReason,
		};
	}
	if (upper.includes('REPORT_NOT_READY')) {
		return {
			label: '리포트 생성 대기',
			detail: '커머스 API에서 아직 리포트 생성이 끝나지 않아 잠시 후 다시 수집해야 합니다.',
			rawReason,
		};
	}
	if (upper.includes('TIMEOUT')) {
		return {
			label: '응답 시간 초과',
			detail: '외부 API 응답이 지연되어 수집이 중단되었습니다. 재시도 또는 구간 축소가 필요할 수 있습니다.',
			rawReason,
		};
	}
	return {
		label: '수집 실패',
		detail: rawReason,
		rawReason,
	};
}

const SALES_CHART_MAX_ITEMS = 7;

export const SalesAnalysisView: React.FC<{ apiBaseUrl: string }> = (props) => {
	const nav = useNavigate();
	const today = useMemo(() => new Date(), []);
	const [fromYmd, setFromYmd] = useState<string>(() => toYmd(subDays(today, 13)));
	const [toYmd2, setToYmd2] = useState<string>(() => toYmd(today));
	const source: 'commerce_orders' = 'commerce_orders';
	const categoryBreakdown: 'small' = 'small';
	const [showNet, setShowNet] = useState<boolean>(true); // 순매출(결제-환불)
	const [downloadOpen, setDownloadOpen] = useState<boolean>(false);

	const [loading, setLoading] = useState(false);
	const [syncModalOpen, setSyncModalOpen] = useState(false);
	const [syncMessage, setSyncMessage] = useState<string>('');
	const [error, setError] = useState<string>('');
	const [dash, setDash] = useState<SalesDashboardResponse | null>(null);
	const [coverage, setCoverage] = useState<SalesCoverageResponse | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const r = await fetchSalesDashboard({
				apiBaseUrl: props.apiBaseUrl,
				from: fromYmd,
				to: toYmd2,
				source,
				limitProducts: 10,
				breakdown: categoryBreakdown,
			});
			let cov: SalesCoverageResponse | null = null;
			if (source === 'commerce_orders') {
				try {
					cov = await fetchSalesCoverage({
						apiBaseUrl: props.apiBaseUrl,
						from: fromYmd,
						to: toYmd2,
						source,
					});
				} catch {
					cov = null;
				}
			}
			setDash(r);
			setCoverage(cov);
		} catch (e: any) {
			const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '조회 실패');
			setDash(null);
			setCoverage(null);
			setError(msg);
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl, fromYmd, toYmd2]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const dailyChartData = useMemo(() => {
		const rows = (dash?.daily || []).map((r: any) => {
			const gross = Number(r.amount) || 0;
			const refund = Number(r.refund_amount) || 0;
			const amountShown = showNet ? Math.max(0, gross - refund) : gross;
			return {
			date: String(r.date || '').slice(5), // MM-DD
			amount: amountShown,
			amount_gross: gross,
			refund_amount: refund,
			order_count: Number(r.order_count) || 0,
			quantity: Number(r.quantity) || 0,
		};
		});
		return rows;
	}, [dash, showNet]);

	const topProducts = useMemo(() => {
		const rows = (dash?.products || []).map((p) => ({
			name: String(p.product_name || `상품 ${p.product_id}`),
			amount: Number(p.amount) || 0,
			order_count: Number(p.order_count) || 0,
			quantity: Number(p.quantity) || 0,
			product_id: Number(p.product_id) || 0,
		}));
		return rows;
	}, [dash]);

	const openProductDetail = useCallback(
		(pid: number) => {
			if (!pid) return;
			const qs = new URLSearchParams();
			qs.set('product_id', String(pid));
			qs.set('from', fromYmd);
			qs.set('to', toYmd2);
			qs.set('source', source);
			nav(`/analytics/sales/product?${qs.toString()}`);
		},
		[nav, fromYmd, toYmd2, source],
	);

	const topCategories = useMemo(() => {
		const rows = (dash?.categories || []).map((c) => ({
			category: String((c as any)?.category ?? ''),
			amount: Number((c as any)?.amount ?? 0) || 0,
		}));
		return rows.filter((x) => x.category).slice(0, 10);
	}, [dash]);

	const topProductChartRows = useMemo(
		() =>
			topProducts.slice(0, SALES_CHART_MAX_ITEMS).map((p) => ({
				...p,
				fullName: p.name,
				shortName: truncateChartLabel(p.name, 18),
			})),
		[topProducts],
	);

	const topCategoryChartRows = useMemo(
		() =>
			topCategories.slice(0, SALES_CHART_MAX_ITEMS).map((c) => ({
				...c,
				fullCategory: c.category,
				shortCategory: truncateChartLabel(c.category, 11),
			})),
		[topCategories],
	);

	const productAxisWidth = useMemo(() => estimateAxisWidth(topProductChartRows.map((x) => x.fullName), 176, 240), [topProductChartRows]);
	const categoryAxisWidth = useMemo(() => estimateAxisWidth(topCategoryChartRows.map((x) => x.fullCategory), 96, 132), [topCategoryChartRows]);
	const productChartHeight = useMemo(() => Math.max(280, topProductChartRows.length * 34), [topProductChartRows.length]);
	const categoryChartHeight = useMemo(() => {
		if (topCategoryChartRows.length <= 1) return 220;
		if (topCategoryChartRows.length <= 3) return 240;
		return Math.max(260, topCategoryChartRows.length * 36);
	}, [topCategoryChartRows.length]);

	const coverageHighlights = useMemo<CoverageHighlight[]>(() => {
		if (!coverage) return [];
		const itemsByDate = new Map((coverage.items || []).map((item) => [String(item.date), item]));
		return [
			...(coverage.failed_days || []).map((d) => {
				const item = itemsByDate.get(String(d));
				const failure = formatCoverageFailureReason(String(item?.failure_reason || ''));
				return {
					date: d,
					label: failure.label,
					tone: 'danger' as const,
					detail: failure.detail,
					rawReason: failure.rawReason,
				};
			}),
			...(coverage.raw_only_days || []).map((d) => ({ date: d, label: 'raw만 있음', tone: 'default' as const })),
			...(coverage.pending_empty_days || []).map((d) => {
				const item = itemsByDate.get(String(d));
				const label = item?.direct_order_checked ? '지연 확인 중·주문원천 재확인' : '지연 확인 중';
				return { date: d, label, tone: 'default' as const };
			}),
			...(coverage.confirmed_empty_days || []).map((d) => ({ date: d, label: '현재 소스 기준 빈 날짜', tone: 'default' as const })),
			...(coverage.missing_days || []).map((d) => ({ date: d, label: '미확인', tone: 'default' as const })),
		].slice(0, 14);
	}, [coverage]);
	const failedCoverageHighlights = useMemo(() => coverageHighlights.filter((item) => item.tone === 'danger'), [coverageHighlights]);
	const neutralCoverageHighlights = useMemo(() => coverageHighlights.filter((item) => item.tone !== 'danger'), [coverageHighlights]);

	const directOrderCheckedPendingCount = useMemo(() => {
		if (!coverage) return 0;
		return (coverage.items || []).filter((item) => item.coverage_status === 'pending_empty' && item.direct_order_checked).length;
	}, [coverage]);

	const runSyncYesterday = useCallback(async () => {
		setSyncMessage('자동수집(어제) 실행 중…');
		setSyncModalOpen(true);
		setError('');
		try {
			const res = await syncSalesYesterday({ apiBaseUrl: props.apiBaseUrl });
			const ok = Boolean((res as any)?.ok ?? true);
			const st = String((res as any)?.status ?? '');
			if (!ok || st === 'FAILED') {
				const msg = String((res as any)?.detail ?? (res as any)?.result?.errors ?? '자동수집 실패');
				setError(msg);
				setSyncMessage(`자동수집 실패: ${msg}`);
			} else {
				setSyncMessage(st === 'SKIPPED' ? '자동수집 스킵됨(오늘 이미 실행됨)' : '자동수집 완료');
			}
			await refresh();
		} catch (e: any) {
			const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '자동수집 실패');
			setError(msg);
			setSyncMessage(`자동수집 실패: ${msg}`);
		} finally {
			setSyncModalOpen(false);
		}
	}, [props.apiBaseUrl, refresh]);

	const runSyncRange = useCallback(async () => {
		const label = '수동수집(주문 기반)';
		setSyncMessage(`${label} 실행 중… (${fromYmd}~${toYmd2})`);
		setSyncModalOpen(true);
		setError('');
		try {
			const res = await syncSalesCommerceOrdersRange({ apiBaseUrl: props.apiBaseUrl, from: fromYmd, to: toYmd2, lagDays: 7 });
			const ok = Boolean((res as any)?.ok ?? true);
			if (!ok) {
				const errs = (res as any)?.errors ?? null;
				const firstKey = errs && typeof errs === 'object' ? Object.keys(errs)[0] : '';
				const firstMsg = firstKey ? String(errs[firstKey] ?? '') : '';
				const msg = `수동수집 실패${firstMsg ? `: ${firstMsg}` : ''}`;
				setError(msg);
				setSyncMessage(msg);
			} else {
				setSyncMessage('수동수집 완료');
			}
			await refresh();
		} catch (e: any) {
			const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '수동수집 실패');
			setError(msg);
			setSyncMessage(`수동수집 실패: ${msg}`);
		} finally {
			setSyncModalOpen(false);
		}
	}, [props.apiBaseUrl, fromYmd, toYmd2, refresh]);

	const title = '판매 분석';
	const subtitle = `${fromYmd} ~ ${toYmd2}`;

	const totalsAny: any = dash?.totals ?? { amount: 0, order_count: 0, quantity: 0 };
	const grossTotal = Number(totalsAny.amount) || 0;
	const refundTotal = Number(totalsAny.refund_amount) || 0;
	const netTotal = Math.max(0, grossTotal - refundTotal);
	const totals = {
		amount: grossTotal,
		refund_amount: refundTotal,
		net_amount: netTotal,
		order_count: Number(totalsAny.order_count) || 0,
		quantity: Number(totalsAny.quantity) || 0,
	};

	const downloadCsv = useCallback(
		(kind: 'products' | 'categories' | 'daily') => {
			const esc = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`;
			let header: string[] = [];
			let lines: string[] = [];
			let filename = '';

			if (kind === 'products') {
				const rows = topProducts || [];
				header = ['product_id', 'product_name', 'amount', 'order_count', 'quantity'];
				lines = rows.map((r: any) =>
					[
						String(r.product_id ?? ''),
						esc(r.name ?? ''),
						String(Math.round(Number(r.amount) || 0)),
						String(Math.round(Number(r.order_count) || 0)),
						String(Math.round(Number(r.quantity) || 0)),
					].join(','),
				);
				filename = `sales_products_${fromYmd}_${toYmd2}.csv`;
			} else if (kind === 'categories') {
				const rows = topCategories || [];
				header = ['category', 'amount'];
				lines = rows.map((r: any) => [esc(r.category ?? ''), String(Math.round(Number(r.amount) || 0))].join(','));
				filename = `sales_categories_${categoryBreakdown}_${fromYmd}_${toYmd2}.csv`;
			} else {
				const rows = dailyChartData || [];
				header = ['date', 'amount_shown', 'amount_gross', 'refund_amount', 'order_count', 'quantity'];
				lines = rows.map((r: any) =>
					[
						esc(r.date ?? ''),
						String(Math.round(Number(r.amount) || 0)),
						String(Math.round(Number(r.amount_gross) || 0)),
						String(Math.round(Number(r.refund_amount) || 0)),
						String(Math.round(Number(r.order_count) || 0)),
						String(Math.round(Number(r.quantity) || 0)),
					].join(','),
				);
				filename = `sales_daily_${showNet ? 'net' : 'gross'}_${fromYmd}_${toYmd2}.csv`;
			}

			const csv = '\ufeff' + [header.join(','), ...lines].join('\n');
			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		},
		[topProducts, topCategories, dailyChartData, fromYmd, toYmd2, categoryBreakdown, showNet],
	);

	return (
		<div>
			{syncModalOpen ? (
				<div
					role="dialog"
					aria-label="sales-sync-running"
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.55)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 9999,
						padding: 16,
					}}
				>
					<div className="card" style={{ maxWidth: 520, width: '100%', padding: 14 }}>
						<div className="card-title">커머스 API 수집 실행 중</div>
						<div className="card-caption" style={{ marginTop: 6 }}>
							{syncMessage || '실행 중…'} <span style={{ color: '#94a3b8' }}>(완료되면 자동으로 닫힙니다)</span>
						</div>
						<div style={{ marginTop: 12, height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden' }}>
							<div style={{ width: '65%', height: '100%', background: 'rgba(34,197,94,0.6)' }} />
						</div>
					</div>
				</div>
			) : null}

			<div className="card" style={{ marginBottom: 12 }}>
				<div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
					<div style={{ flex: '1 1 560px', minWidth: 0 }}>
						<div className="card-title">{title}</div>
						<div className="card-caption" style={{ marginTop: 4 }}>
							상품별 일별 판매금액(결제금액)을 대시보드로 확인합니다. <span style={{ color: '#94a3b8' }}>{subtitle}</span>
						</div>
						<div className="sales-header-left-tools" style={{ marginTop: 12 }}>
							<div className="sales-sync-grid sales-sync-grid-row" data-testid="sales-sync-actions">
								<button
									type="button"
									className="btn-ghost"
									onClick={() => void runSyncYesterday()}
									disabled={syncModalOpen}
									style={{ width: '100%', justifyContent: 'center' }}
								>
									자동수집(어제)
								</button>
								<button
									type="button"
									className="btn-primary"
									onClick={() => void runSyncRange()}
									disabled={syncModalOpen}
									style={{ width: '100%', justifyContent: 'center' }}
								>
									수동수집(주문 기반)
								</button>
							</div>
							<div className="sales-top-actions-grid" data-testid="sales-left-actions">
								<button
									type="button"
									className="btn-ghost"
									onClick={() => setShowNet((v) => !v)}
									disabled={syncModalOpen}
									aria-label="toggle-net"
									title="일별 차트에 순매출(결제-환불)을 적용합니다"
									style={{ width: '100%', justifyContent: 'center' }}
								>
									{showNet ? '순매출 표시' : '결제금액 표시'}
								</button>
								<div style={{ position: 'relative' }}>
									<button
										type="button"
										className="btn-ghost"
										onClick={() => setDownloadOpen((v) => !v)}
										disabled={syncModalOpen}
										aria-label="sales-download"
										style={{ width: '100%', justifyContent: 'center' }}
									>
										다운로드 ▾
									</button>
									{downloadOpen ? (
										<div
											role="menu"
											aria-label="sales-download-menu"
											style={{
												position: 'absolute',
												left: 0,
												top: 'calc(100% + 6px)',
												minWidth: 220,
												border: '1px solid rgba(148,163,184,0.16)',
												borderRadius: 12,
												background: 'rgba(2,6,23,0.98)',
												boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
												padding: 8,
												zIndex: 250,
											}}
										>
											<button
												type="button"
												className="btn-ghost"
												style={{ width: '100%', justifyContent: 'space-between', display: 'flex' }}
												onClick={() => {
													downloadCsv('daily');
													setDownloadOpen(false);
												}}
											>
												<span>일별(차트) CSV</span>
												<span style={{ color: '#94a3b8' }}>{showNet ? 'net' : 'gross'}</span>
											</button>
											<button
												type="button"
												className="btn-ghost"
												style={{ width: '100%', justifyContent: 'space-between', display: 'flex' }}
												onClick={() => {
													downloadCsv('categories');
													setDownloadOpen(false);
												}}
											>
												<span>카테고리 CSV</span>
												<span style={{ color: '#94a3b8' }}>small</span>
											</button>
											<button
												type="button"
												className="btn-ghost"
												style={{ width: '100%', justifyContent: 'space-between', display: 'flex' }}
												onClick={() => {
													downloadCsv('products');
													setDownloadOpen(false);
												}}
											>
												<span>상품 Top10 CSV</span>
												<span style={{ color: '#94a3b8' }}>top10</span>
											</button>
										</div>
									) : null}
								</div>
							</div>
						</div>
					</div>
					<div
						className="sales-top-panel sales-top-panel-wide"
						data-testid="sales-top-right-panel"
						style={{
							flex: '0 1 460px',
							width: '100%',
							maxWidth: 460,
							marginLeft: 'auto',
							display: 'grid',
							gap: 10,
							padding: 10,
							borderRadius: 12,
							border: '1px solid rgba(148,163,184,0.14)',
							background: 'rgba(15,23,42,0.45)',
						}}
					>
						<div style={{ fontSize: 11, fontWeight: 900, color: '#cbd5e1' }}>조회 기간</div>
						<SalesDateRangeControls
							fromYmd={fromYmd}
							toYmd={toYmd2}
							disabled={loading}
							onChange={({ fromYmd: nextFromYmd, toYmd: nextToYmd }) => {
								setFromYmd(nextFromYmd);
								setToYmd2(nextToYmd);
							}}
						/>
					</div>
				</div>

				{error ? (
					<div className="card" style={{ marginTop: 12, padding: 10, border: '1px solid rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.06)' }}>
						<div style={{ fontSize: 12, fontWeight: 900, color: '#fecaca' }}>오류</div>
						<div style={{ fontSize: 12, color: '#e2e8f0', marginTop: 6, whiteSpace: 'pre-wrap' }}>{error}</div>
						<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
							403/GW.IP_NOT_ALLOWED이면 커머스 API 센터의 허용 IP 설정을 확인하세요. (상품성과 API는 구독/권한이 필요할 수 있습니다)
						</div>
					</div>
				) : null}

				{source === 'commerce_orders' && coverage ? (
					<div className="card" style={{ marginTop: 12, padding: 12, border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(59,130,246,0.05)' }}>
						<div className="card-title" style={{ fontSize: 13 }}>
							데이터 커버리지 진단
						</div>
						<div className="card-caption" style={{ marginTop: 6 }}>
						현재 조회 구간에서 raw와 집계 저장 상태를 비교했습니다. 최근 날짜는 커머스 API 지연으로 뒤늦게 들어올 수 있어 "지연 확인 중"으로 별도 표시하며, 필요한 경우 주문원천 재확인 결과를 함께 노출합니다. 전체 결과 역시 판매자센터 상품성과의 실매출 0일과 같은 의미는 아닐 수 있습니다.
						</div>
						<div className="sales-coverage-grid sales-coverage-grid-row" data-testid="sales-coverage-metrics" style={{ marginTop: 10 }}>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>집계 저장 일수</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{coverage.aggregate_days_count}일</div>
							</div>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>raw 저장 일수</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{coverage.raw_days_count}일</div>
							</div>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>실패일</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{coverage.failed_days.length}일</div>
							</div>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>미확인일</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{coverage.missing_days.length}일</div>
							</div>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>raw만 있는 날짜</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{coverage.raw_only_days.length}일</div>
							</div>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>지연 확인 중 날짜</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{coverage.pending_empty_days.length}일</div>
							</div>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>주문원천 재확인 날짜</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{directOrderCheckedPendingCount}일</div>
							</div>
							<div style={{ padding: 10, borderRadius: 10, background: 'rgba(15,23,42,0.45)' }}>
								<div style={{ fontSize: 11, color: '#94a3b8' }}>현재 소스 기준 빈 날짜</div>
								<div style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{coverage.confirmed_empty_days.length}일</div>
							</div>
						</div>
						{coverageHighlights.length ? (
							<div style={{ marginTop: 12 }}>
								{failedCoverageHighlights.length ? (
									<div className="sales-coverage-highlight-list" data-testid="sales-coverage-failure-list">
										{failedCoverageHighlights.map((item) => (
											<div
												key={`${item.date}-${item.label}`}
												className="sales-coverage-highlight-item is-danger"
												data-testid={`sales-coverage-highlight-row-${item.date}`}
											>
												<div className="sales-coverage-highlight-date">{item.date}</div>
												<div className="sales-coverage-highlight-body">
													<div className="sales-coverage-highlight-topline">
														<span className="sales-coverage-highlight-status is-danger">수집 실패</span>
														<span className="sales-coverage-highlight-title">{item.label}</span>
													</div>
													{item.detail ? <div className="sales-coverage-highlight-detail">{item.detail}</div> : null}
													{item.rawReason && item.rawReason !== item.detail ? (
														<div className="sales-coverage-highlight-meta">원인 코드: {item.rawReason}</div>
													) : null}
												</div>
											</div>
										))}
									</div>
								) : null}
								{neutralCoverageHighlights.length ? (
									<div className="sales-coverage-highlight-chip-list" data-testid="sales-coverage-neutral-list">
										{neutralCoverageHighlights.map((item) => (
											<div
												key={`${item.date}-${item.label}`}
												className="sales-coverage-highlight-chip"
												data-testid={`sales-coverage-highlight-chip-${item.date}`}
											>
												<span className="sales-coverage-highlight-chip-date">{item.date}</span>
												<span className="sales-coverage-highlight-chip-label">{item.label}</span>
											</div>
										))}
									</div>
								) : null}
							</div>
						) : (
							<div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>현재 구간에는 구조적 누락 징후가 없습니다.</div>
						)}
					</div>
				) : null}
			</div>

			{/* KPI 카드 */}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">총 결제금액</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtWon(totals.amount)}</div>
				</div>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">환불금액</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtWon(totals.refund_amount)}</div>
				</div>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">순매출(결제-환불)</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtWon(totals.net_amount)}</div>
				</div>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">주문(상품주문) 수</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtInt(totals.order_count)}</div>
				</div>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">수량</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtInt(totals.quantity)}</div>
				</div>
			</div>

			{/* 차트 2개 */}
			<div className="sales-charts-layout" data-testid="sales-charts-layout" style={{ marginBottom: 12 }}>
				<div className="card sales-chart-card-primary sales-chart-card-readable" data-testid="sales-chart-product-card" style={{ padding: 12, minWidth: 0 }}>
					<div className="card-title" style={{ fontSize: 13 }}>
						상품별 결제금액 Top {Math.min(SALES_CHART_MAX_ITEMS, topProductChartRows.length || SALES_CHART_MAX_ITEMS)}
					</div>
					<div className="card-caption" style={{ marginTop: 4 }}>
						sku 상품명은 줄바꿈 없이 한 줄로 유지하고, 필요한 경우 말줄임표로 표시합니다. 차트는 Top 7만 보여줍니다.
					</div>
					<div style={{ height: productChartHeight, marginTop: 8 }}>
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={topProductChartRows} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
								<XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} />
								<YAxis type="category" dataKey="shortName" width={productAxisWidth} tick={{ fill: '#cbd5e1', fontSize: 10 }} interval={0} />
								<Tooltip
									contentStyle={{ background: '#0b1220', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10 }}
									labelFormatter={(_label: any, payload: any) => String(payload?.[0]?.payload?.fullName || '')}
									formatter={(v: any) => fmtWon(Number(v) || 0)}
								/>
								<Bar dataKey="amount" fill="rgba(96,165,250,0.75)" />
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>
				<div className="card sales-chart-card-secondary" data-testid="sales-chart-category-card" style={{ padding: 12, minWidth: 0 }}>
					<div className="card-title" style={{ fontSize: 13 }}>
						카테고리별 결제금액 Top {Math.min(SALES_CHART_MAX_ITEMS, topCategoryChartRows.length || SALES_CHART_MAX_ITEMS)}
					</div>
					<div className="card-caption" style={{ marginTop: 4 }}>
						카테고리 합계는 넓게 보여 상위 구간의 크기 차이를 한눈에 비교할 수 있게 했습니다.
					</div>
					<div style={{ height: categoryChartHeight, marginTop: 8 }}>
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={topCategoryChartRows} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
								<XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} />
								<YAxis type="category" dataKey="shortCategory" width={categoryAxisWidth} tick={{ fill: '#cbd5e1', fontSize: 10 }} interval={0} />
								<Tooltip
									contentStyle={{ background: '#0b1220', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10 }}
									labelFormatter={(_label: any, payload: any) => String(payload?.[0]?.payload?.fullCategory || '')}
									formatter={(v: any) => fmtWon(Number(v) || 0)}
								/>
								<Bar dataKey="amount" fill="rgba(34,197,94,0.75)" />
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>
			</div>

			{/* 일별 판매금액 (보조) */}
			<div className="card" style={{ padding: 12, marginBottom: 12 }}>
				<div className="card-title" style={{ fontSize: 13 }}>
					일별 {showNet ? '순매출(결제-환불)' : '결제금액'}
				</div>
				<div style={{ height: 240, marginTop: 8 }}>
					<ResponsiveContainer width="100%" height="100%">
						<BarChart data={dailyChartData}>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
							<XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
							<YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} />
							<Tooltip
								contentStyle={{ background: '#0b1220', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10 }}
								labelStyle={{ color: '#e2e8f0' }}
								formatter={(v: any, name: any, p: any) => {
									const val = Number(v) || 0;
									const gross = Number(p?.payload?.amount_gross ?? 0) || 0;
									const refund = Number(p?.payload?.refund_amount ?? 0) || 0;
									if (!showNet) return fmtWon(val);
									return `${fmtWon(val)} (결제 ${fmtWon(gross)} / 환불 ${fmtWon(refund)})`;
								}}
							/>
							<Bar dataKey="amount" fill="rgba(34,197,94,0.55)" />
						</BarChart>
					</ResponsiveContainer>
				</div>
			</div>

			{/* 표 */}
			<div className="card" style={{ padding: 12 }}>
				<div className="card-title" style={{ fontSize: 13 }}>
					상품별 요약
				</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					조회 기간 내 집계 결과입니다. (상위 10개)
				</div>
				<div style={{ marginTop: 10, overflowX: 'auto' }}>
					<table className="table" aria-label="sales-products-table">
						<thead>
							<tr>
								<th>상품</th>
								<th style={{ textAlign: 'right' }}>판매금액</th>
								<th style={{ textAlign: 'right' }}>주문수</th>
								<th style={{ textAlign: 'right' }}>수량</th>
							</tr>
						</thead>
						<tbody>
							{topProducts.map((p) => (
								<tr
									key={String(p.product_id)}
									onClick={() => openProductDetail(Number(p.product_id) || 0)}
									className="sales-click-row"
									aria-label={`sales-product-row-${String(p.product_id)}`}
									title="클릭하여 상세 보기"
								>
									<td style={{ maxWidth: 420 }}>
										<div style={{ fontWeight: 800, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
											{p.name}
										</div>
										<div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>productId: {p.product_id}</div>
									</td>
									<td style={{ textAlign: 'right', fontWeight: 900 }}>{fmtWon(p.amount)}</td>
									<td style={{ textAlign: 'right' }}>{fmtInt(p.order_count)}</td>
									<td style={{ textAlign: 'right' }}>{fmtInt(p.quantity)}</td>
								</tr>
							))}
							{topProducts.length === 0 ? (
								<tr>
									<td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: 18 }}>
										{loading ? '로딩 중…' : '표시할 데이터가 없습니다. (수동수집을 먼저 실행해보세요)'}
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
};

