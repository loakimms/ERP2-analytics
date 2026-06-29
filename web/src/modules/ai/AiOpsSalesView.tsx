import React from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

import { selectedActionBucketFromSearch } from '../../shared/navigation/analyticsNavigation';
import type { AiOpsViewProps } from './AiOpsCommonTypes';
import type { AiOpsSalesItem, AiOpsSalesOverinvestmentItem, AiOpsSalesResponse } from './AiOpsAdsSalesTypes';
import type { AiOpsSalesDecisionCard, AiOpsSalesOverinvestmentDecisionCard } from './AiOpsDecisionCardTypes';
import { mapSalesItemToDecisionCard, mapSalesOverinvestmentItemToDecisionCard } from './AiOpsDecisionCardMappers';
import { formatCount, formatPercent01 } from './AiOpsCenterUtils';
import { ActionBucketFilterBar, AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { SalesDecisionExtraContent, SalesOverinvestmentExtraContent } from './AiOpsAdsSalesPresentation';

export function AiOpsSalesView(props: AiOpsViewProps): JSX.Element {
	const location = useLocation();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsSalesResponse | null>(null);
	const [message, setMessage] = React.useState<string | null>(null);
	const [submittingProductId, setSubmittingProductId] = React.useState<string | null>(null);

	const loadSalesData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/ops/sales`);
			setData((res?.data as AiOpsSalesResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '판매·전환 판단 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl]);

	React.useEffect(() => {
		void loadSalesData();
	}, [loadSalesData]);

	const summary = data?.summary ?? {};
	const selectedActionBucket = React.useMemo(() => selectedActionBucketFromSearch(location.search), [location.search]);
	const items = Array.isArray(data?.items) ? data.items : [];
	const overinvestmentItems = Array.isArray(data?.overinvestment_items) ? data.overinvestment_items : [];
	const decisionCards = React.useMemo<AiOpsSalesDecisionCard[]>(() => items.map((item) => mapSalesItemToDecisionCard(item)), [items]);
	const overinvestmentDecisionCards = React.useMemo<AiOpsSalesOverinvestmentDecisionCard[]>(
		() => overinvestmentItems.map((item) => mapSalesOverinvestmentItemToDecisionCard(item)),
		[overinvestmentItems],
	);
	const filteredDecisionCards = selectedActionBucket ? decisionCards.filter((item) => item.actionBucket === selectedActionBucket) : decisionCards;
	const filteredOverinvestmentDecisionCards = selectedActionBucket
		? overinvestmentDecisionCards.filter((item) => item.actionBucket === selectedActionBucket)
		: overinvestmentDecisionCards;

	const queueSalesAction = React.useCallback(
		async (item: AiOpsSalesItem | AiOpsSalesOverinvestmentItem): Promise<void> => {
			const productId = String(item.product_id ?? '').trim();
			const actionBucket = String(item.action_bucket || '').trim();
			const productName = String(item.product_name || item.product_id || '').trim();
			if (!productId || !actionBucket) return;
			setSubmittingProductId(productId);
			setMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/sales/actions`, {
					product_id: Number(productId),
					action_bucket: actionBucket,
				});
				setMessage(`${productName || productId} 판매 액션을 실행 큐에 적재했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '판매 액션 실행 큐 적재에 실패했습니다.';
				setMessage(String(msg));
			} finally {
				setSubmittingProductId(null);
			}
		},
		[props.apiBaseUrl],
	);

	return (
		<AiOpsPageShell
			title="판매·전환 판단"
			description="광고 성과가 아니라 실제 매출, 주문, 환불을 기준으로 확대/축소/보류를 판단합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="판매 SKU" value={formatCount(summary.total_products, '개')} caption="최신 판매 스냅샷 기준" tone="neutral" />
				<MiniKpiCard label="집중 후보" value={formatCount(summary.focus_count, '개')} caption="실매출 상위 집중 운영" tone="good" />
				<MiniKpiCard label="보류 후보" value={formatCount(summary.risk_hold_count, '개')} caption="환불/품질 리스크 우선" tone="warn" />
				<MiniKpiCard label="과투입 점검" value={formatCount(summary.low_contribution_count, '개')} caption="실매출 기여 재검토" tone="neutral" />
			</div>
			<div style={{ marginTop: 10 }}>
				<MiniKpiCard
					label="광고 착시 후보"
					value={formatCount(summary.overinvestment_count, '개')}
					caption="광고 효율 대비 순매출 약세"
					tone="warn"
				/>
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">판매 액션 후보</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					실매출과 환불을 동시에 보고 집중 투자, 확대 보류, 과투입 점검을 승인형 큐로 연결합니다.
				</div>
				<ActionBucketFilterBar selectedActionBucket={selectedActionBucket} currentPath="/analytics/ai/sales" />
				{message ? <div style={{ marginTop: 12, color: '#86efac' }}>{message}</div> : null}
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>판매·전환 판단 데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && filteredDecisionCards.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 판매 액션 후보가 없습니다.</div>
				) : null}
				{!loading && !error && filteredDecisionCards.length > 0 ? (
					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{filteredDecisionCards.map((card, index) => {
							const item = card.raw;
							const productId = String(item.product_id ?? '').trim();
							const key = `${productId || 'unknown'}::${index}`;
							return (
								<AiOpsDecisionCardPanel
									key={key}
									card={card}
									note={card.approvalLine}
									extraContent={
										<SalesDecisionExtraContent
											orderCount={item.order_count}
											refundOrderCount={item.refund_order_count}
											refundRateLabel={card.metrics[3]?.value || formatPercent01(item.refund_ratio)}
											learningSummary={card.learningSummary}
										/>
									}
									actions={
										<button
											type="button"
											className="btn-ghost"
											aria-label="판매 액션 실행 큐로 보내기"
											disabled={submittingProductId === productId}
											onClick={() => void queueSalesAction(item)}
										>
											{submittingProductId === productId ? '적재 중...' : '판매 액션 실행 큐로 보내기'}
										</button>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">광고-판매 과투입 후보</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					광고 ROAS는 좋아 보여도 실제 순매출 기여가 약한 SKU를 별도로 분리해 예산 축소 테스트 후보로 올립니다.
				</div>
				{!loading && !error && filteredOverinvestmentDecisionCards.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 광고-판매 과투입 후보가 없습니다.</div>
				) : null}
				{!loading && !error && filteredOverinvestmentDecisionCards.length > 0 ? (
					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{filteredOverinvestmentDecisionCards.map((card, index) => {
							const item = card.raw;
							const productId = String(item.product_id ?? '').trim();
							const key = `overinvestment::${productId || index}`;
							return (
								<AiOpsDecisionCardPanel
									key={key}
									card={card}
									badgeColor="#fca5a5"
									note={card.approvalLine}
									extraContent={
										<SalesOverinvestmentExtraContent
											adPurchaseConversions={item.ad_purchase_conversions}
											adSpendRatioLabel={card.metrics[3]?.value || formatPercent01(item.ad_spend_ratio)}
											learningSummary={card.learningSummary}
										/>
									}
									actions={
										<button
											type="button"
											className="btn-ghost"
											aria-label="과투입 점검 액션 큐로 보내기"
											disabled={submittingProductId === productId}
											onClick={() => void queueSalesAction(item)}
										>
											{submittingProductId === productId ? '적재 중...' : '과투입 점검 액션 큐로 보내기'}
										</button>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
				<FocusCard
					title="실매출 기준 운영"
					description="판매 메뉴는 AI 운영 센터의 매출 진실 레이어로 사용합니다."
					bullets={[
						'광고 효율이 좋아 보여도 실제 매출 기여가 약한 SKU를 과투입 후보로 분리합니다.',
						'상위 매출 SKU는 집중 전략 대상으로, 환불 리스크 SKU는 확대 보류 대상으로 분리합니다.',
						'카테고리별 성장 기회를 함께 계산해 예산과 SEO 우선순위를 맞춥니다.',
					]}
					links={[
						{ label: '판매 대시보드 열기', path: '/analytics/sales/dashboard' },
						{ label: '실행 큐 열기', path: '/analytics/ai/actions' },
					]}
				/>
				<FocusCard
					title="다음 확장 포인트"
					description="이제 판매 리스크를 큐로 연결했으니, 다음 단계에서는 광고 데이터와 결합해 진짜 과투입 SKU를 더 정밀하게 고를 수 있습니다."
					bullets={[
						'광고 효율이 좋아도 순매출이 약한 SKU를 별도 버킷으로 분리합니다.',
						'반품 사유·리뷰 불만과 연결해 환불 구조 원인을 분해합니다.',
						'카테고리 평균 대비 순매출 점유율을 계산해 집중 우선순위를 보강합니다.',
					]}
					links={[
						{ label: '광고 운영 판단 열기', path: '/analytics/ai/ads' },
						{ label: '검증 로그 열기', path: '/analytics/ai/logs' },
					]}
				/>
			</div>
		</AiOpsPageShell>
	);
}
