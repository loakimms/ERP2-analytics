import React from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

import type { AiOpsViewProps } from './AiOpsCommonTypes';
import { buildAiOpsReviewQueueRequest } from './AiOpsQualitativeActions';
import { mapReviewItemToDecisionCard } from './AiOpsDecisionCardMappers';
import type { AiOpsReviewDecisionCard } from './AiOpsDecisionCardTypes';
import { formatCount, formatPercent01 } from './AiOpsCenterUtils';
import { AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { ActionProposalList, SeverityBadge, TagList } from './AiOpsQualitativePresentation';
import type {
	AiOpsReviewProductItem,
	AiOpsReviewsActionsResponse,
	AiOpsReviewsProductsResponse,
	AiOpsReviewsSummaryResponse,
} from './AiOpsQualitativeTypes';

export function AiOpsReviewsView(props: AiOpsViewProps): JSX.Element {
	const navigate = useNavigate();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [summaryData, setSummaryData] = React.useState<AiOpsReviewsSummaryResponse | null>(null);
	const [productsData, setProductsData] = React.useState<AiOpsReviewsProductsResponse | null>(null);
	const [actionsData, setActionsData] = React.useState<AiOpsReviewsActionsResponse | null>(null);
	const [submitMessage, setSubmitMessage] = React.useState<string | null>(null);
	const [submittingSkuId, setSubmittingSkuId] = React.useState<string | null>(null);

	const loadReviewsData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const [summaryRes, productsRes, actionsRes] = await Promise.all([
				axios.get(`${props.apiBaseUrl}/ai/ops/reviews/summary`),
				axios.get(`${props.apiBaseUrl}/ai/ops/reviews/products`),
				axios.get(`${props.apiBaseUrl}/ai/ops/reviews/actions`),
			]);
			setSummaryData((summaryRes?.data as AiOpsReviewsSummaryResponse) ?? null);
			setProductsData((productsRes?.data as AiOpsReviewsProductsResponse) ?? null);
			setActionsData((actionsRes?.data as AiOpsReviewsActionsResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '리뷰·VOC 판단 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl]);

	React.useEffect(() => {
		void loadReviewsData();
	}, [loadReviewsData]);

	const summary = summaryData?.summary ?? {};
	const items = Array.isArray(productsData?.items) ? productsData.items : [];
	const actions = Array.isArray(actionsData?.actions) ? actionsData.actions : [];
	const decisionCards = React.useMemo<AiOpsReviewDecisionCard[]>(() => items.map((item) => mapReviewItemToDecisionCard(item)), [items]);

	const queueReviewAction = React.useCallback(
		async (item: AiOpsReviewProductItem): Promise<void> => {
			const request = buildAiOpsReviewQueueRequest(item);
			if (!request) return;
			const skuId = request.entity_id;
			setSubmittingSkuId(skuId);
			setSubmitMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/actions`, request);
				setSubmitMessage(`${item.product_name || skuId} 액션을 실행 큐에 적재했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '리뷰 액션 실행 큐 적재에 실패했습니다.';
				setSubmitMessage(String(msg));
			} finally {
				setSubmittingSkuId(null);
			}
		},
		[props.apiBaseUrl],
	);

	return (
		<AiOpsPageShell
			title="리뷰·VOC 판단"
			description="부정 리뷰 리스크와 강점 카테고리를 광고/판매 정책과 연결합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="리뷰 대상 SKU" value={formatCount(summary.total_products, '개')} caption="최근 리뷰 판단 기준" tone="neutral" />
				<MiniKpiCard label="즉시 개선 후보" value={formatCount(summary.urgent_count, '개')} caption="부정 VOC 우선" tone="bad" />
				<MiniKpiCard label="재광고 준비 후보" value={formatCount(summary.reply_improvement_count, '개')} caption="개선 후 확대 가능" tone="good" />
				<MiniKpiCard label="평균 부정 비율" value={formatPercent01(summary.avg_negative_ratio)} caption="리뷰 리스크 온도" tone="warn" />
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">VOC 우선 상품</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					반복되는 부정 리뷰 원인을 바로 액션으로 연결할 수 있도록 상품 단위로 보여줍니다.
				</div>
				{submitMessage ? <div style={{ marginTop: 12, color: '#86efac' }}>{submitMessage}</div> : null}
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>리뷰·VOC 판단 데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && decisionCards.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 리뷰 기반 우선 상품이 없습니다.</div>
				) : null}
				{!loading && !error && decisionCards.length > 0 ? (
					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{decisionCards.map((card, index) => {
							const item = card.raw;
							const skuId = String(item.sku_id || '').trim() || `review-${index}`;
							return (
								<AiOpsDecisionCardPanel
									key={skuId}
									card={card}
									extraContent={
										<>
											<SeverityBadge severity={item.severity} />
											<TagList label="위험 주제" values={item.risk_topics} />
											<TagList label="강점 주제" values={item.strength_topics} />
										</>
									}
									actions={
										<>
											<button
												type="button"
												className="btn-ghost"
												aria-label="VOC 실행 큐로 보내기"
												onClick={() => void queueReviewAction(item)}
												disabled={submittingSkuId === skuId}
											>
												{submittingSkuId === skuId ? '적재 중...' : 'VOC 실행 큐로 보내기'}
											</button>
											<button type="button" className="btn-ghost" onClick={() => navigate(card.links.source.path)}>
												{card.links.source.label}
											</button>
											<button type="button" className="btn-ghost" onClick={() => navigate(card.links.queue.path)}>
												{card.links.queue.label}
											</button>
											<button type="button" className="btn-ghost" onClick={() => navigate(card.links.logs.path)}>
												{card.links.logs.label}
											</button>
										</>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<ActionProposalList
				title="실행 제안 묶음"
				description="상품별 판단을 넘어서 운영팀이 바로 묶어서 실행할 수 있는 VOC 개선 액션을 정리합니다."
				actions={actions}
			/>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
				<FocusCard
					title="확대보다 먼저 막아야 할 평판 리스크"
					description="리뷰는 광고보다 늦게 들어오지만, 확대 여부를 결정하는 가장 강한 제동 신호입니다."
					bullets={[
						'배송/포장/품질 불만이 반복되면 광고 확대보다 개선 액션이 먼저입니다.',
						'답글 정책과 VOC 분류를 정리해 재발 유형을 줄여야 합니다.',
						'강점 주제가 안정적으로 누적된 뒤에야 재광고 후보로 올립니다.',
					]}
					links={[
						{ label: '리뷰 분석 열기', path: '/analytics/reviews/review-analysis' },
						{ label: '리뷰 관리 열기', path: '/analytics/reviews/review-management' },
					]}
				/>
				<FocusCard
					title="판매·광고와 연결되는 후속 경로"
					description="VOC 개선이 끝난 SKU만 다음 단계로 승격해 예산을 쓰도록 연결합니다."
					bullets={[
						'리뷰 리스크가 낮아진 SKU는 판매·광고 판단으로 다시 넘깁니다.',
						'실행 큐에서는 VOC 개선 완료 여부를 승인 메모와 함께 추적합니다.',
						'검증 로그에서는 개선 후 재광고 성과를 함께 확인합니다.',
					]}
					links={[
						{ label: '판매·전환 판단 열기', path: '/analytics/ai/sales' },
						{ label: '실행 큐 열기', path: '/analytics/ai/actions' },
						{ label: '검증 로그 열기', path: '/analytics/ai/logs' },
					]}
				/>
			</div>
		</AiOpsPageShell>
	);
}
