import React from 'react';
import axios from 'axios';

import type { AiOpsViewProps } from './AiOpsCommonTypes';
import type { AiOpsProductItem, AiOpsProductsResponse } from './AiOpsProductTypes';
import { mapProductItemToDecisionCard } from './AiOpsDecisionCardMappers';
import { formatCount, formatPercent01, formatPercent100, useAiOpsSnapshotRebuild } from './AiOpsCenterUtils';
import { AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { AiOpsProductDecisionExtraContent } from './AiOpsProductsPresentation';

export function AiOpsProductsView(props: AiOpsViewProps): JSX.Element {
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsProductsResponse | null>(null);
	const [submitMessage, setSubmitMessage] = React.useState<string | null>(null);
	const [submittingSkuId, setSubmittingSkuId] = React.useState<string | null>(null);
	const [selectedPolicyPackId, setSelectedPolicyPackId] = React.useState<string>('ALL');

	const loadProductsData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/ops/products`, {
				params: selectedPolicyPackId !== 'ALL' ? { policy_pack_id: selectedPolicyPackId } : {},
			});
			setData((res?.data as AiOpsProductsResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '상품 판단 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl, selectedPolicyPackId]);
	const { rebuilding, rebuildMessage, triggerRebuild } = useAiOpsSnapshotRebuild(props.apiBaseUrl, loadProductsData);

	React.useEffect(() => {
		void loadProductsData();
	}, [loadProductsData]);

	const items = Array.isArray(data?.items) ? data.items : [];
	const summary = data?.summary ?? {};
	const policyPackIds = Array.isArray(summary.policy_pack_ids) ? summary.policy_pack_ids : [];
	const evidenceDateRange = React.useMemo(() => {
		const today = new Date();
		const toYmd = today.toISOString().slice(0, 10);
		const from = new Date(today);
		from.setDate(today.getDate() - 29);
		return {
			fromYmd: from.toISOString().slice(0, 10),
			toYmd,
		};
	}, []);

	const queuePrimaryAction = React.useCallback(
		async (item: AiOpsProductItem): Promise<void> => {
			const skuId = String(item.sku_id || '').trim();
			if (!skuId) return;
			setSubmittingSkuId(skuId);
			setSubmitMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/actions`, {
					source_scope: 'ai-ops-products',
					entity_type: 'sku',
					entity_id: skuId,
					action_type: 'QUEUE_PRIMARY_ACTION',
					priority: 'P1',
					payload: {
						title: item.recommended_action_primary || '기본 액션 검토',
						product_name: item.product_name || null,
						policy_type: item.policy_type || null,
						top_issue: item.top_issue || null,
					},
				});
				setSubmitMessage(`${item.product_name || skuId} 액션을 실행 큐에 적재했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '실행 큐 적재에 실패했습니다.';
				setSubmitMessage(String(msg));
			} finally {
				setSubmittingSkuId(null);
			}
		},
		[props.apiBaseUrl],
	);

	return (
		<AiOpsPageShell
			title="상품별 운영 판단"
			description="오가닉, 광고, 판매, 리뷰, Q&A 신호를 SKU 기준으로 묶어 이번 주 운영 정책을 제시합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="판단 대상 SKU" value={formatCount(summary.total_items, '개')} caption="최신 스냅샷 기준" tone="neutral" />
				<MiniKpiCard label="스냅샷 기준일" value={summary.snapshot_date || '-'} caption="판단 생성 일자" tone="good" />
				<MiniKpiCard label="즉시 실행 후보" value={formatCount(items.filter((item) => Number(item.priority_score ?? 0) >= 80).length, '개')} caption="우선순위 80점 이상" tone="warn" />
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">실제 상품 판단 목록</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					상품별 정책과 주요 이슈를 확인하고 바로 실행 큐로 보낼 수 있습니다.
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
					<button type="button" className="btn-ghost" onClick={() => void triggerRebuild()} disabled={rebuilding}>
						{rebuilding ? '재생성 중...' : '스냅샷 재생성'}
					</button>
					<button type="button" className="btn-ghost" onClick={() => void loadProductsData()} disabled={loading || rebuilding}>
						{loading ? '새로고침 중...' : '새로고침'}
					</button>
					<label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 12 }}>
						<span>정책팩 필터</span>
						<select
							aria-label="products-policy-pack-filter"
							value={selectedPolicyPackId}
							onChange={(event) => setSelectedPolicyPackId(event.target.value)}
							style={{
								borderRadius: 8,
								border: '1px solid rgba(148,163,184,0.22)',
								background: 'rgba(2,6,23,0.5)',
								color: '#e2e8f0',
								padding: '8px 10px',
							}}
						>
							<option value="ALL">전체 정책팩</option>
							{policyPackIds.map((packId) => (
								<option key={packId} value={packId}>
									{packId}
								</option>
							))}
						</select>
					</label>
				</div>
				{rebuildMessage ? <div style={{ marginTop: 12, color: '#86efac' }}>{rebuildMessage}</div> : null}
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>상품 판단 데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{submitMessage ? <div style={{ marginTop: 12, color: '#86efac' }}>{submitMessage}</div> : null}
				{!loading && !error && items.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>표시할 상품 판단 스냅샷이 없습니다.</div>
				) : null}
				{!loading && !error && items.length > 0 ? (
					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{items.slice(0, 20).map((item) => {
							const skuId = String(item.sku_id || '').trim() || 'unknown-sku';
							const card = mapProductItemToDecisionCard(item, evidenceDateRange);
							return (
								<AiOpsDecisionCardPanel
									key={skuId}
									card={card}
									extraContent={
										<AiOpsProductDecisionExtraContent
											priorityLabel={formatPercent100(item.priority_score)}
											confidenceLabel={formatPercent01(item.confidence_score)}
											dataQualityLabel={formatPercent01(item.data_quality_score)}
											sourceLink={card.links.source}
											sourceAriaLabel={`product-item-source-${skuId}`}
											queueLink={card.links.queue}
											logsLink={card.links.logs}
										/>
									}
									actions={
										<button
											type="button"
											className="btn-ghost"
											onClick={() => void queuePrimaryAction(item)}
											disabled={submittingSkuId === skuId}
										>
											{submittingSkuId === skuId ? '적재 중...' : '실행 큐로 보내기'}
										</button>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
				<FocusCard
					title="상품 건강도 허브"
					description="각 상품은 단일 지표가 아니라 다축 점수 조합으로 평가해야 합니다."
					bullets={[
						'오가닉 건강도, 광고 효율도, 판매 성장도, 리뷰 위험도, Q&A 장벽도를 한 카드에 통합합니다.',
						'정책 분류는 오가닉 주력형, 광고 성장형, 광고 방어형, VOC 개선 우선형, FAQ 보완형, 축소형으로 관리합니다.',
						'최종 문장은 “지금 무엇을 해야 하는가” 기준으로 3줄 이내로 고정합니다.',
					]}
					links={[
						{ label: '오가닉 A-1 보기', path: '/analytics/ai/organic-rank' },
						{ label: '검증 로그 보기', path: '/analytics/ai/logs?scope=a1-trace' },
					]}
				/>
				<FocusCard
					title="연결되는 근거 화면"
					description="상품 판단은 기존 상세 화면을 버리지 않고 source-of-truth로 재사용합니다."
					bullets={[
						'판매 기여와 환불 영향은 판매 분석 화면에서 drill-down 합니다.',
						'리뷰 리스크와 강점 카테고리는 리뷰 분석 화면에서 확인합니다.',
						'구매 직전 문의와 FAQ 후보는 Q&A 분석 화면에서 보강합니다.',
					]}
					links={[
						{ label: '판매 분석 열기', path: '/analytics/ai/sales' },
						{ label: '리뷰 분석 열기', path: '/analytics/ai/reviews' },
						{ label: 'Q&A 분석 열기', path: '/analytics/ai/qna' },
					]}
				/>
			</div>
		</AiOpsPageShell>
	);
}
