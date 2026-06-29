import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchSalesProductSeries, type SalesProductSeriesResponse } from './salesProductApi';

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

export const SalesProductDetailView: React.FC<{ apiBaseUrl: string }> = (props) => {
	const nav = useNavigate();
	const [sp] = useSearchParams();

	const productId = useMemo(() => {
		const raw = String(sp.get('product_id') || '').trim();
		const v = Number(raw);
		if (!Number.isFinite(v) || v <= 0) return 0;
		return Math.floor(v);
	}, [sp]);

	const from = String(sp.get('from') || '').trim();
	const to = String(sp.get('to') || '').trim();
	const source = (String(sp.get('source') || '').trim() as any) || 'commerce_orders';

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [data, setData] = useState<SalesProductSeriesResponse | null>(null);

	const refresh = useCallback(async () => {
		if (!productId || !from || !to) return;
		setLoading(true);
		setError('');
		try {
			const r = await fetchSalesProductSeries({
				apiBaseUrl: props.apiBaseUrl,
				productId,
				from,
				to,
				source,
			});
			setData(r);
		} catch (e: any) {
			const msg = String(e?.response?.data?.detail ?? e?.message ?? e ?? '조회 실패');
			setData(null);
			setError(msg);
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl, productId, from, to, source]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const points = useMemo(() => {
		return (data?.points || []).map((p) => ({
			date: String(p.date || '').slice(5),
			amount: Number(p.amount) || 0,
			order_count: Number(p.order_count) || 0,
			quantity: Number(p.quantity) || 0,
		}));
	}, [data]);

	if (!productId) {
		return (
			<div className="card" style={{ padding: 12 }}>
				<div className="card-title">상품 판매 상세</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					product_id가 없습니다. 대시보드에서 상품을 클릭해 진입하세요.
				</div>
			</div>
		);
	}

	return (
		<div>
			<div className="card" style={{ marginBottom: 12, padding: 12 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
					<div>
						<div className="card-title">상품 판매 상세</div>
						<div className="card-caption" style={{ marginTop: 6 }}>
							<span style={{ color: '#94a3b8' }}>
								productId: {productId} · {from} ~ {to}
							</span>
						</div>
						{data?.product_name ? (
							<div style={{ marginTop: 6, fontWeight: 900, color: '#e2e8f0' }}>{data.product_name}</div>
						) : null}
					</div>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						<button type="button" className="btn-ghost" onClick={() => nav('/analytics/sales/dashboard')}>
							← 목록
						</button>
						<button type="button" className="btn-ghost" onClick={() => void refresh()} disabled={loading}>
							새로고침
						</button>
					</div>
				</div>

				{error ? (
					<div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: '1px solid rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.06)' }}>
						<div style={{ fontSize: 12, fontWeight: 900, color: '#fecaca' }}>오류</div>
						<div style={{ fontSize: 12, color: '#e2e8f0', marginTop: 6, whiteSpace: 'pre-wrap' }}>{error}</div>
					</div>
				) : null}
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">총 결제금액</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtWon(Number((data?.totals as any)?.amount ?? 0) || 0)}</div>
				</div>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">주문수</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtInt(Number((data?.totals as any)?.order_count ?? 0) || 0)}</div>
				</div>
				<div className="card" style={{ padding: 12 }}>
					<div className="card-caption">수량</div>
					<div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>{fmtInt(Number((data?.totals as any)?.quantity ?? 0) || 0)}</div>
				</div>
			</div>

			<div className="card" style={{ padding: 12, marginBottom: 12 }}>
				<div className="card-title" style={{ fontSize: 13 }}>
					일별 결제금액
				</div>
				<div style={{ height: 260, marginTop: 8 }}>
					<ResponsiveContainer width="100%" height="100%">
						<BarChart data={points}>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
							<XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
							<YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} />
							<Tooltip
								contentStyle={{ background: '#0b1220', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10 }}
								formatter={(v: any) => fmtWon(Number(v) || 0)}
							/>
							<Bar dataKey="amount" fill="rgba(96,165,250,0.7)" />
						</BarChart>
					</ResponsiveContainer>
				</div>
			</div>

			<div className="card" style={{ padding: 12 }}>
				<div className="card-title" style={{ fontSize: 13 }}>
					일별 상세
				</div>
				<div style={{ marginTop: 10, overflowX: 'auto' }}>
					<table className="table" aria-label="sales-product-series-table">
						<thead>
							<tr>
								<th>일자</th>
								<th style={{ textAlign: 'right' }}>결제금액</th>
								<th style={{ textAlign: 'right' }}>주문수</th>
								<th style={{ textAlign: 'right' }}>수량</th>
							</tr>
						</thead>
						<tbody>
							{(data?.points || []).map((p) => (
								<tr key={String(p.date)}>
									<td>{String(p.date)}</td>
									<td style={{ textAlign: 'right', fontWeight: 900 }}>{fmtWon(Number(p.amount) || 0)}</td>
									<td style={{ textAlign: 'right' }}>{fmtInt(Number(p.order_count) || 0)}</td>
									<td style={{ textAlign: 'right' }}>{fmtInt(Number(p.quantity) || 0)}</td>
								</tr>
							))}
							{(data?.points || []).length === 0 ? (
								<tr>
									<td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8', padding: 18 }}>
										{loading ? '로딩 중…' : '표시할 데이터가 없습니다.'}
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

