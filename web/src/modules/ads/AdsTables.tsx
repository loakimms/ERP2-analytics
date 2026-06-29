import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatInt, formatPct, formatPctInt, formatWon } from './format';
import type { MetricComputed, MetricDeltas } from './adsMetrics';

export type AdsRow = {
	key: string;
	status?: { label: string; isActive: boolean | null };
	ended_on?: string | null;
	primary: string;
	secondary?: string | null;
	tertiary?: string | null;
	metrics: MetricComputed;
	prevMetrics: MetricComputed;
	deltas: MetricDeltas;
	purchaseMetrics?: { conversions: number; revenue: number };
	prevPurchaseMetrics?: { conversions: number; revenue: number };
};

export type AdsLeftColumnKey = 'status' | 'ended_on' | 'primary' | 'secondary' | 'tertiary';
export type AdsMetricColumnKey =
	| 'impressions'
	| 'clicks'
	| 'ctr'
	| 'cpc'
	| 'cost'
	| 'conversions'
	| 'purchase_conversions'
	| 'purchase_cvr'
	| 'cvr'
	| 'revenue'
	| 'purchase_revenue'
	| 'purchase_roas'
	| 'roas';

function DeltaBadge(props: {
	diff: number;
	pct: number | null;
	kind: 'int' | 'won' | 'pct' | 'float2';
}): JSX.Element | null {
	const diff = props.diff;
	if (!Number.isFinite(diff) || diff === 0) return null;

	const up = diff > 0;
	const cls = up ? 'delta-badge up' : 'delta-badge down';
	const arrow = up ? '▲' : '▼';
	const absDiff = Math.abs(diff);
	const absPct = props.pct == null ? null : Math.abs(props.pct);

	const diffText =
		props.kind === 'won' ? `${arrow} ${formatInt(absDiff)}원` :
		props.kind === 'pct' ? `${arrow} ${formatPctInt(absDiff)}` :
		`${arrow} ${formatInt(absDiff)}`;

	const pctText = absPct == null ? null : `(${formatPctInt(absPct)})`;

	return (
		<span className={cls} title="비교기간 대비 증감">
			<span className="delta-diff">{diffText}</span>
			{pctText ? <span className="delta-pct">{pctText}</span> : null}
		</span>
	);
}

function MetricCell(props: {
	value: number;
	diff: number;
	pct: number | null;
	kind: 'int' | 'won' | 'pct';
}): JSX.Element {
	const text =
		props.kind === 'won' ? formatWon(props.value) :
		props.kind === 'pct' ? formatPct(props.value) :
		formatInt(props.value);

	return (
		<div className="metric-cell">
			<div className="metric-value">{text}</div>
			<DeltaBadge diff={props.diff} pct={props.pct} kind={props.kind} />
		</div>
	);
}

export function AdsTable(props: {
	title: string;
	columns: Array<{ key: AdsLeftColumnKey; label: string }>;
	rows: AdsRow[];
	totalRow?: AdsRow | null;
	renderCell?: (p: { row: AdsRow; colKey: AdsLeftColumnKey }) => React.ReactNode;
	renderTotalCell?: (p: { row: AdsRow; colKey: AdsLeftColumnKey }) => React.ReactNode;
	leftColPx?: Partial<Record<AdsLeftColumnKey, number>>;
	visibleMetricKeys?: AdsMetricColumnKey[];
	onRowClick?: (row: AdsRow) => void;
	selectedRowKey?: string | null;
}): JSX.Element {
	const hasStatus = props.columns.some((c) => c.key === 'status');
	const topScrollRef = useRef<HTMLDivElement | null>(null);
	const bottomScrollRef = useRef<HTMLDivElement | null>(null);
	const tableRef = useRef<HTMLTableElement | null>(null);
	const syncingRef = useRef<'top' | 'bottom' | null>(null);
	const [scrollWidthPx, setScrollWidthPx] = useState(0);

	// 성능 최적화:
	// - 부모가 매 렌더마다 columns/rows 배열을 새로 만들면 deps에 그대로 넣을 때 측정 effect가 과도하게 실행될 수 있다.
	// - 실제 스크롤폭 측정은 "구조/표시 대상"이 바뀔 때만 재실행하면 충분하다.
	const columnsSig = useMemo(() => {
		const colKeys = props.columns.map((c) => c.key).join('|');
		const left = props.leftColPx ?? {};
		const leftSig = ['status', 'ended_on', 'primary', 'secondary', 'tertiary']
			.map((k) => `${k}=${(left as any)[k] ?? ''}`)
			.join(',');
		return `${colKeys}|${leftSig}`;
	}, [props.columns, props.leftColPx]);

	const rowsSig = useMemo(() => {
		const n = props.rows.length;
		const first = n > 0 ? String(props.rows[0]?.key ?? '') : '';
		const last = n > 0 ? String(props.rows[n - 1]?.key ?? '') : '';
		return `${n}|${first}|${last}`;
	}, [props.rows]);

	useSyncTableScrollWidth({
		tableRef,
		deps: [columnsSig, rowsSig],
		onWidth: setScrollWidthPx,
	});

	type SortKey = AdsLeftColumnKey | AdsMetricColumnKey;

	const hasPurchaseMetrics = useMemo(
		() =>
			Boolean(
				props.totalRow?.purchaseMetrics
				|| props.rows.some((row) => row.purchaseMetrics || row.prevPurchaseMetrics),
			),
		[props.rows, props.totalRow],
	);

	const orderedMetricKeys = useMemo<AdsMetricColumnKey[]>(
		() => [
			'impressions',
			'clicks',
			'ctr',
			'cpc',
			'cost',
			'conversions',
			...(hasPurchaseMetrics ? (['purchase_conversions'] as AdsMetricColumnKey[]) : []),
			...(hasPurchaseMetrics ? (['purchase_cvr'] as AdsMetricColumnKey[]) : []),
			'cvr',
			'revenue',
			...(hasPurchaseMetrics ? (['purchase_revenue'] as AdsMetricColumnKey[]) : []),
			...(hasPurchaseMetrics ? (['purchase_roas'] as AdsMetricColumnKey[]) : []),
			'roas',
		],
		[hasPurchaseMetrics],
	);

	const visibleMetricKeys = useMemo<AdsMetricColumnKey[]>(() => {
		if (!props.visibleMetricKeys || props.visibleMetricKeys.length === 0) return orderedMetricKeys;
		const allowed = new Set<AdsMetricColumnKey>(orderedMetricKeys);
		const filtered = props.visibleMetricKeys.filter((key) => allowed.has(key));
		return filtered.length > 0 ? filtered : orderedMetricKeys;
	}, [orderedMetricKeys, props.visibleMetricKeys]);

	const [sortKey, setSortKey] = useState<SortKey>('cost');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

	useEffect(() => {
		const visibleKeys = new Set<string>([
			...props.columns.map((c) => c.key),
			...visibleMetricKeys,
		]);
		if (visibleKeys.has(sortKey)) return;
		const fallback = (visibleMetricKeys[0] ?? props.columns[0]?.key ?? 'cost') as SortKey;
		setSortKey(fallback);
		setSortDir('desc');
	}, [props.columns, sortKey, visibleMetricKeys]);

	const sortedRows = useMemo(() => {
		const rows = props.rows || [];
		if (rows.length <= 1) return rows;

		const valueOf = (row: AdsRow): string | number => {
			switch (sortKey) {
				case 'status': {
					const a = row.status?.isActive;
					const score = a === true ? 2 : a === false ? 0 : 1;
					return score;
				}
				case 'ended_on':
					return row.ended_on ?? '';
				case 'primary':
					return row.primary ?? '';
				case 'secondary':
					return row.secondary ?? '';
				case 'tertiary':
					return row.tertiary ?? '';
				case 'impressions':
					return row.metrics.impressions;
				case 'clicks':
					return row.metrics.clicks;
				case 'ctr':
					return row.metrics.ctr;
				case 'cpc':
					return row.metrics.cpc;
				case 'cost':
					return row.metrics.cost;
				case 'conversions':
					return row.metrics.conversions;
				case 'purchase_conversions':
					return row.purchaseMetrics?.conversions ?? 0;
				case 'purchase_cvr': {
					const purchaseConversions = row.purchaseMetrics?.conversions ?? 0;
					const clicks = row.metrics.clicks ?? 0;
					return clicks > 0 ? (purchaseConversions / clicks) * 100 : 0;
				}
				case 'cvr':
					return row.metrics.cvr;
				case 'revenue':
					return row.metrics.revenue;
				case 'purchase_revenue':
					return row.purchaseMetrics?.revenue ?? 0;
				case 'purchase_roas': {
					const purchaseRevenue = row.purchaseMetrics?.revenue ?? 0;
					const cost = row.metrics.cost ?? 0;
					return cost > 0 ? (purchaseRevenue / cost) * 100 : 0;
				}
				case 'roas':
					return row.metrics.roas;
				default:
					return row.metrics.cost;
			}
		};

		// 정렬 성능 최적화:
		// - 기존: comparator 호출마다 valueOf(row)를 다시 계산 → 비교 횟수(O(n log n))만큼 반복
		// - 개선: 각 row에 대해 sort value를 1회만 계산(=Schwartzian transform) 후 정렬
		const collator = new Intl.Collator('ko');
		const dir = sortDir === 'asc' ? 1 : -1;
		const keyed = rows.map((row, idx) => ({ row, idx, v: valueOf(row) }));
		keyed.sort((a, b) => {
			const va = a.v;
			const vb = b.v;
			let cmp =
				typeof va === 'number' && typeof vb === 'number'
					? va - vb
					: collator.compare(String(va), String(vb));
			cmp *= dir;
			// 값이 같은 경우에는 입력 순서를 최대한 유지(안정 정렬 흉내)
			if (cmp === 0) return a.idx - b.idx;
			return cmp;
		});
		return keyed.map((x) => x.row);
	}, [props.rows, sortKey, sortDir]);

	const toggleSort = (nextKey: SortKey) => {
		setSortKey((cur) => {
			if (cur === nextKey) {
				setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
				return cur;
			}
			setSortDir('desc');
			return nextKey;
		});
	};

	const sortIndicator = (k: SortKey) => {
		if (sortKey !== k) return null;
		return sortDir === 'asc' ? '▲' : '▼';
	};

	const SortTh = (p: { sortKey: SortKey; className: string; label: string }) => (
		<th className={p.className}>
			<button
				type="button"
				onClick={() => toggleSort(p.sortKey)}
				style={{
					all: 'unset',
					cursor: 'pointer',
					display: 'inline-flex',
					alignItems: 'center',
					gap: 6,
					fontWeight: 900,
				}}
			>
				<span>{p.label}</span>
				<span style={{ opacity: sortKey === p.sortKey ? 1 : 0.35 }}>{sortIndicator(p.sortKey) ?? '↕'}</span>
			</button>
		</th>
	);

	const renderLeftCell = (row: AdsRow, colKey: AdsLeftColumnKey): JSX.Element => {
		switch (colKey) {
			case 'status': {
				const labelRaw = String(row.status?.label ?? '').trim();
				const label = labelRaw === 'UNKNOWN' ? '미확인' : labelRaw;
				return (
					<td className="td-left" style={{ width: props.leftColPx?.status ?? 70 }}>
						{row.status ? (
							<span
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									gap: 6,
									fontSize: 11,
									fontWeight: 900,
									color: row.status.isActive === true ? '#a7f3d0' : row.status.isActive === false ? '#fecaca' : '#e5e7eb',
								}}
							>
								<span
									style={{
										width: 8,
										height: 8,
										borderRadius: 999,
										background:
											row.status.isActive === true ? 'rgba(16,185,129,0.95)' :
											row.status.isActive === false ? 'rgba(239,68,68,0.95)' :
											'rgba(148,163,184,0.75)',
										boxShadow: '0 0 0 2px rgba(2,6,23,0.65)',
									}}
								/>
								{label}
							</span>
						) : null}
					</td>
				);
			}
			case 'ended_on':
				return <td className="td-left">{props.renderCell?.({ row, colKey }) ?? (row.ended_on ?? '-')}</td>;
			case 'primary':
				return <td className="td-left">{props.renderCell?.({ row, colKey }) ?? row.primary}</td>;
			case 'secondary':
				return <td className="td-left">{props.renderCell?.({ row, colKey }) ?? (row.secondary ?? '')}</td>;
			case 'tertiary':
				return <td className="td-left">{props.renderCell?.({ row, colKey }) ?? (row.tertiary ?? '')}</td>;
			default:
				return <td className="td-left" />;
		}
	};

	const renderLeftCellForTotal = (row: AdsRow, colKey: AdsLeftColumnKey): JSX.Element => {
		if (colKey === 'status') return <td className="td-left" style={{ width: props.leftColPx?.status ?? 70 }} />;
		if (colKey === 'ended_on') return <td className="td-left" />;
		const custom = props.renderTotalCell?.({ row, colKey });
		if (custom != null) return <td className="td-left" style={colKey === 'primary' ? { fontWeight: 900 } : undefined}>{custom}</td>;
		if (colKey === 'primary') return <td className="td-left" style={{ fontWeight: 900 }}>{row.primary}</td>;
		if (colKey === 'secondary') return <td className="td-left">{row.secondary ?? ''}</td>;
		if (colKey === 'tertiary') return <td className="td-left">{row.tertiary ?? ''}</td>;
		return <td className="td-left" />;
	};

	const metricColWidthPx: Record<AdsMetricColumnKey, number> = {
		impressions: 92,
		clicks: 82,
		ctr: 88,
		cpc: 108,
		cost: 110,
		conversions: 84,
		purchase_conversions: 96,
		purchase_cvr: 104,
		cvr: 88,
		revenue: 126,
		purchase_revenue: 126,
		purchase_roas: 132,
		roas: 110,
	};

	const metricHeaderLabel = (key: AdsMetricColumnKey): string => {
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
			default: return '';
		}
	};

	const purchaseRoasValue = (row: AdsRow): number => {
		const purchaseRevenue = row.purchaseMetrics?.revenue ?? 0;
		const cost = row.metrics.cost ?? 0;
		return cost > 0 ? (purchaseRevenue / cost) * 100 : 0;
	};

	const purchaseRoasPrevValue = (row: AdsRow): number => {
		const purchaseRevenue = row.prevPurchaseMetrics?.revenue ?? 0;
		const cost = row.prevMetrics.cost ?? 0;
		return cost > 0 ? (purchaseRevenue / cost) * 100 : 0;
	};

	const purchaseCvrValue = (row: AdsRow): number => {
		const purchaseConversions = row.purchaseMetrics?.conversions ?? 0;
		const clicks = row.metrics.clicks ?? 0;
		return clicks > 0 ? (purchaseConversions / clicks) * 100 : 0;
	};

	const purchaseCvrPrevValue = (row: AdsRow): number => {
		const purchaseConversions = row.prevPurchaseMetrics?.conversions ?? 0;
		const clicks = row.prevMetrics.clicks ?? 0;
		return clicks > 0 ? (purchaseConversions / clicks) * 100 : 0;
	};

	const renderMetricCell = (row: AdsRow, key: AdsMetricColumnKey): JSX.Element => {
		switch (key) {
			case 'impressions':
				return <td className="td-right"><MetricCell value={row.metrics.impressions} diff={row.deltas.impressions.diff} pct={row.deltas.impressions.pct} kind="int" /></td>;
			case 'clicks':
				return <td className="td-right"><MetricCell value={row.metrics.clicks} diff={row.deltas.clicks.diff} pct={row.deltas.clicks.pct} kind="int" /></td>;
			case 'ctr':
				return <td className="td-right"><MetricCell value={row.metrics.ctr} diff={row.deltas.ctr.diff} pct={row.deltas.ctr.pct} kind="pct" /></td>;
			case 'cpc':
				return <td className="td-right"><MetricCell value={row.metrics.cpc} diff={row.deltas.cpc.diff} pct={row.deltas.cpc.pct} kind="won" /></td>;
			case 'cost':
				return <td className="td-right"><MetricCell value={row.metrics.cost} diff={row.deltas.cost.diff} pct={row.deltas.cost.pct} kind="won" /></td>;
			case 'conversions':
				return <td className="td-right"><MetricCell value={row.metrics.conversions} diff={row.deltas.conversions.diff} pct={row.deltas.conversions.pct} kind="int" /></td>;
			case 'purchase_conversions':
				return (
					<td className="td-right">
						<MetricCell
							value={row.purchaseMetrics?.conversions ?? 0}
							diff={(row.purchaseMetrics?.conversions ?? 0) - (row.prevPurchaseMetrics?.conversions ?? 0)}
							pct={
								(row.prevPurchaseMetrics?.conversions ?? 0) > 0
									? (((row.purchaseMetrics?.conversions ?? 0) - (row.prevPurchaseMetrics?.conversions ?? 0)) / (row.prevPurchaseMetrics?.conversions ?? 0)) * 100
									: null
							}
							kind="int"
						/>
					</td>
				);
			case 'purchase_cvr': {
				const currPurchaseCvr = purchaseCvrValue(row);
				const prevPurchaseCvr = purchaseCvrPrevValue(row);
				return (
					<td className="td-right">
						<MetricCell
							value={currPurchaseCvr}
							diff={currPurchaseCvr - prevPurchaseCvr}
							pct={prevPurchaseCvr > 0 ? ((currPurchaseCvr - prevPurchaseCvr) / prevPurchaseCvr) * 100 : null}
							kind="pct"
						/>
					</td>
				);
			}
			case 'cvr':
				return <td className="td-right"><MetricCell value={row.metrics.cvr} diff={row.deltas.cvr.diff} pct={row.deltas.cvr.pct} kind="pct" /></td>;
			case 'revenue':
				return <td className="td-right"><MetricCell value={row.metrics.revenue} diff={row.deltas.revenue.diff} pct={row.deltas.revenue.pct} kind="won" /></td>;
			case 'purchase_revenue':
				return (
					<td className="td-right">
						<MetricCell
							value={row.purchaseMetrics?.revenue ?? 0}
							diff={(row.purchaseMetrics?.revenue ?? 0) - (row.prevPurchaseMetrics?.revenue ?? 0)}
							pct={
								(row.prevPurchaseMetrics?.revenue ?? 0) > 0
									? (((row.purchaseMetrics?.revenue ?? 0) - (row.prevPurchaseMetrics?.revenue ?? 0)) / (row.prevPurchaseMetrics?.revenue ?? 0)) * 100
									: null
							}
							kind="won"
						/>
					</td>
				);
			case 'purchase_roas': {
				const currPurchaseRoas = purchaseRoasValue(row);
				const prevPurchaseRoas = purchaseRoasPrevValue(row);
				return (
					<td className="td-right">
						<MetricCell
							value={currPurchaseRoas}
							diff={currPurchaseRoas - prevPurchaseRoas}
							pct={prevPurchaseRoas > 0 ? ((currPurchaseRoas - prevPurchaseRoas) / prevPurchaseRoas) * 100 : null}
							kind="pct"
						/>
					</td>
				);
			}
			case 'roas':
				return <td className="td-right"><MetricCell value={row.metrics.roas} diff={row.deltas.roas.diff} pct={row.deltas.roas.pct} kind="pct" /></td>;
			default:
				return <td className="td-right" />;
		}
	};

	return (
		<div className="card">
			<div className="card-title">{props.title}</div>
			<div
				className="ads-table-scrollbar-top"
				ref={topScrollRef}
				onScroll={() => {
					if (syncingRef.current === 'bottom') return;
					const top = topScrollRef.current;
					const bottom = bottomScrollRef.current;
					if (!top || !bottom) return;
					syncingRef.current = 'top';
					bottom.scrollLeft = top.scrollLeft;
					// 다음 tick에서 해제(무한 루프 방지)
					window.requestAnimationFrame(() => {
						if (syncingRef.current === 'top') syncingRef.current = null;
					});
				}}
				aria-label="ads-table-scrollbar-top"
			>
				<div className="ads-table-scrollbar-top-spacer" style={{ width: Math.max(scrollWidthPx, 1), height: 1 }} />
			</div>
			<div className="ads-table-wrap">
				<div
					ref={bottomScrollRef}
					onScroll={() => {
						if (syncingRef.current === 'top') return;
						const top = topScrollRef.current;
						const bottom = bottomScrollRef.current;
						if (!top || !bottom) return;
						syncingRef.current = 'bottom';
						top.scrollLeft = bottom.scrollLeft;
						window.requestAnimationFrame(() => {
							if (syncingRef.current === 'bottom') syncingRef.current = null;
						});
					}}
					className="ads-table-scroll"
					aria-label="ads-table-scrollbar-bottom"
				>
				<table className="ads-table" ref={tableRef}>
					<colgroup>
						{props.columns.map((c) => {
							const px =
								c.key === 'status'
									? props.leftColPx?.status ?? 70
									: c.key === 'ended_on'
										? props.leftColPx?.ended_on ?? 120
									: c.key === 'primary'
										? props.leftColPx?.primary ?? 170
										: c.key === 'secondary'
											? props.leftColPx?.secondary ?? 150
											: c.key === 'tertiary'
												? props.leftColPx?.tertiary ?? 150
												: undefined;
							return <col key={c.key} style={px ? { width: px } : undefined} />;
						})}
						{/* metrics cols: 좁고 균일하게 고정해 우측 overflow를 예측 가능하게 만든다 */}
						{visibleMetricKeys.map((key) => (
							<col key={key} style={{ width: metricColWidthPx[key] }} />
						))}
					</colgroup>
					<thead>
						<tr>
							{props.columns.map((c) => {
								const k = c.key as SortKey;
								return <SortTh key={c.key} sortKey={k} className="th-left" label={c.label} />;
							})}
							{visibleMetricKeys.map((key) => (
								<SortTh key={key} sortKey={key} className="th-right" label={metricHeaderLabel(key)} />
							))}
						</tr>
					</thead>
					<tbody>
						{props.totalRow && (
							<tr className="ads-row total">
								{props.columns.map((c) => (
									<React.Fragment key={c.key}>{renderLeftCellForTotal(props.totalRow as AdsRow, c.key)}</React.Fragment>
								))}
								{visibleMetricKeys.map((key) => (
									<React.Fragment key={key}>{renderMetricCell(props.totalRow as AdsRow, key)}</React.Fragment>
								))}
							</tr>
						)}

						{sortedRows.map((row) => (
							<tr
								key={row.key}
								className="ads-row"
								data-selected={props.selectedRowKey === row.key ? 'true' : 'false'}
								style={props.selectedRowKey === row.key ? { background: 'rgba(59,130,246,0.10)' } : undefined}
								onClick={(event) => {
									if (!props.onRowClick) return;
									const target = event.target as HTMLElement | null;
									if (target?.closest('button, a, input, select, textarea, label')) return;
									props.onRowClick(row);
								}}
							>
								{props.columns.map((c) => (
									<React.Fragment key={c.key}>{renderLeftCell(row, c.key)}</React.Fragment>
								))}

								{visibleMetricKeys.map((key) => (
									<React.Fragment key={key}>{renderMetricCell(row, key)}</React.Fragment>
								))}
							</tr>
						))}

						{props.rows.length === 0 && (
							<tr>
								<td className="td-empty" colSpan={props.columns.length + visibleMetricKeys.length}>
									표시할 데이터가 없습니다.
								</td>
							</tr>
						)}
					</tbody>
				</table>
				</div>
			</div>
		</div>
	);
}

// 테이블 스크롤폭(=스크롤바 spacer 너비)을 주기적으로 동기화
// - rows/columns 변경 시 scrollWidth가 달라질 수 있다.
// - ResizeObserver가 없는 환경도 있으므로 requestAnimationFrame + window resize로 충분히 커버한다.
function useSyncTableScrollWidth(params: {
	tableRef: React.RefObject<HTMLTableElement | null>;
	deps: any[];
	onWidth: (w: number) => void;
}): void {
	useEffect(() => {
		let raf = 0;
		let ro: ResizeObserver | null = null;
		let mo: MutationObserver | null = null;
		const measure = () => {
			const el = params.tableRef.current;
			const w = el ? el.scrollWidth : 0;
			params.onWidth(w);
		};
		const schedule = () => {
			if (raf) window.cancelAnimationFrame(raf);
			raf = window.requestAnimationFrame(() => measure());
		};

		// 1) deps 변경(데이터/구조 변경) 시 최소 1회 측정
		schedule();

		// 2) 창 크기 변경 시 측정
		const onResize = () => schedule();
		window.addEventListener('resize', onResize);

		// 3) 가능하면 DOM 변화도 관찰(콘텐츠 변경으로 scrollWidth가 바뀌는 케이스)
		const el = params.tableRef.current;
		try {
			if (el && typeof ResizeObserver !== 'undefined') {
				ro = new ResizeObserver(() => schedule());
				ro.observe(el);
			}
		} catch {}
		try {
			if (el && typeof MutationObserver !== 'undefined') {
				mo = new MutationObserver(() => schedule());
				mo.observe(el, { subtree: true, childList: true, characterData: true });
			}
		} catch {}

		return () => {
			window.removeEventListener('resize', onResize);
			try {
				ro?.disconnect();
			} catch {}
			try {
				mo?.disconnect();
			} catch {}
			if (raf) window.cancelAnimationFrame(raf);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, params.deps);
}



