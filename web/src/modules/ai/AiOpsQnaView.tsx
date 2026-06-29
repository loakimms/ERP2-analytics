import React from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

import type { AiOpsViewProps } from './AiOpsCommonTypes';
import { buildAiOpsQnaQueueRequest } from './AiOpsQualitativeActions';
import { mapQnaItemToDecisionCard } from './AiOpsDecisionCardMappers';
import type { AiOpsQnaDecisionCard } from './AiOpsDecisionCardTypes';
import { formatCount, formatPercent01 } from './AiOpsCenterUtils';
import { AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { ActionProposalList, SeverityBadge, TagList } from './AiOpsQualitativePresentation';
import type {
	AiOpsQnaActionsResponse,
	AiOpsQnaProductItem,
	AiOpsQnaProductsResponse,
	AiOpsQnaSummaryResponse,
} from './AiOpsQualitativeTypes';

export function AiOpsQnaView(props: AiOpsViewProps): JSX.Element {
	const navigate = useNavigate();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [summaryData, setSummaryData] = React.useState<AiOpsQnaSummaryResponse | null>(null);
	const [productsData, setProductsData] = React.useState<AiOpsQnaProductsResponse | null>(null);
	const [actionsData, setActionsData] = React.useState<AiOpsQnaActionsResponse | null>(null);
	const [submitMessage, setSubmitMessage] = React.useState<string | null>(null);
	const [submittingSkuId, setSubmittingSkuId] = React.useState<string | null>(null);

	const loadQnaData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const [summaryRes, productsRes, actionsRes] = await Promise.all([
				axios.get(`${props.apiBaseUrl}/ai/ops/qna/summary`),
				axios.get(`${props.apiBaseUrl}/ai/ops/qna/products`),
				axios.get(`${props.apiBaseUrl}/ai/ops/qna/actions`),
			]);
			setSummaryData((summaryRes?.data as AiOpsQnaSummaryResponse) ?? null);
			setProductsData((productsRes?.data as AiOpsQnaProductsResponse) ?? null);
			setActionsData((actionsRes?.data as AiOpsQnaActionsResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? 'Q&A 전환장벽 판단 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl]);

	React.useEffect(() => {
		void loadQnaData();
	}, [loadQnaData]);

	const summary = summaryData?.summary ?? {};
	const items = Array.isArray(productsData?.items) ? productsData.items : [];
	const actions = Array.isArray(actionsData?.actions) ? actionsData.actions : [];
	const decisionCards = React.useMemo<AiOpsQnaDecisionCard[]>(() => items.map((item) => mapQnaItemToDecisionCard(item)), [items]);

	const queueQnaAction = React.useCallback(
		async (item: AiOpsQnaProductItem): Promise<void> => {
			const request = buildAiOpsQnaQueueRequest(item);
			if (!request) return;
			const skuId = request.entity_id;
			setSubmittingSkuId(skuId);
			setSubmitMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/actions`, request);
				setSubmitMessage(`${item.product_name || skuId} 액션을 실행 큐에 적재했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? 'Q&A 액션 실행 큐 적재에 실패했습니다.';
				setSubmitMessage(String(msg));
			} finally {
				setSubmittingSkuId(null);
			}
		},
		[props.apiBaseUrl],
	);

	return (
		<AiOpsPageShell
			title="Q&A 전환장벽 판단"
			description="구매 직전 문의를 분석해 FAQ, 상세페이지, 답변 정책 보강 우선순위를 제시합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="Q&A 대상 SKU" value={formatCount(summary.total_products, '개')} caption="질문 누적 기준" tone="neutral" />
				<MiniKpiCard label="전환 장벽 후보" value={formatCount(summary.barrier_count, '개')} caption="즉시 설명 보강 필요" tone="bad" />
				<MiniKpiCard label="FAQ 공백 SKU" value={formatCount(summary.faq_gap_count, '개')} caption="FAQ 등록 우선" tone="warn" />
				<MiniKpiCard label="구매 직전 문의 비중" value={formatPercent01(summary.prepurchase_ratio)} caption="전환 직전 마찰도" tone="good" />
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">전환 장벽 상품</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					구매 직전 문의가 반복되는 상품을 먼저 골라 FAQ/상세페이지/답변 정책 개선으로 연결합니다.
				</div>
				{submitMessage ? <div style={{ marginTop: 12, color: '#86efac' }}>{submitMessage}</div> : null}
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>Q&A 판단 데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && decisionCards.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 Q&A 기반 전환 장벽 상품이 없습니다.</div>
				) : null}
				{!loading && !error && decisionCards.length > 0 ? (
					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{decisionCards.map((card, index) => {
							const item = card.raw;
							const skuId = String(item.sku_id || '').trim() || `qna-${index}`;
							return (
								<AiOpsDecisionCardPanel
									key={skuId}
									card={card}
									extraContent={
										<>
											<SeverityBadge severity={item.severity} />
											<TagList label="이슈 태그" values={item.issue_tags} />
										</>
									}
									actions={
										<>
											<button
												type="button"
												className="btn-ghost"
												aria-label="Q&A 실행 큐로 보내기"
												onClick={() => void queueQnaAction(item)}
												disabled={submittingSkuId === skuId}
											>
												{submittingSkuId === skuId ? '적재 중...' : 'Q&A 실행 큐로 보내기'}
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
				description="FAQ 등록, 상세페이지 보강, 답변 정책 보완처럼 운영팀이 묶어서 처리할 수 있는 Q&A 액션을 정리합니다."
				actions={actions}
			/>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
				<FocusCard
					title="광고보다 먼저 줄여야 할 구매 직전 마찰"
					description="Q&A는 클릭 이후 구매 직전의 설명 부족을 가장 직접적으로 드러내는 데이터입니다."
					bullets={[
						'성분, 사용법, 호환성 문의가 반복되면 FAQ와 상세페이지를 먼저 고쳐야 합니다.',
						'구매 직전 문의 비중이 높으면 광고 확대보다 정보 보강이 우선입니다.',
						'답변 정책이 흔들리면 같은 문의가 반복되므로 템플릿 정비가 필요합니다.',
					]}
					links={[
						{ label: 'Q&A 분석 열기', path: '/analytics/reviews/qna-analysis' },
						{ label: 'Q&A 관리 열기', path: '/analytics/reviews/qna' },
					]}
				/>
				<FocusCard
					title="후속 연결 흐름"
					description="Q&A 장벽을 줄인 뒤에는 리뷰/판매/광고 판단으로 다시 돌려 실제 확장 가능성을 확인합니다."
					bullets={[
						'FAQ 보강이 끝나면 판매·전환 판단으로 순매출 기여를 다시 봅니다.',
						'실행 큐에서 FAQ 등록, 상세페이지 보완, 답변 정책을 같은 버킷으로 관리합니다.',
						'검증 로그에서는 장벽 감소 이후 광고 확대가 가능한지 추적합니다.',
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
