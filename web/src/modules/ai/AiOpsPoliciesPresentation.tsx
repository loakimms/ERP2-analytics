import React from 'react';

import { formatCount, formatPercent01, formatPercent100 } from './AiOpsCenterUtils';
import type { AiOpsPoliciesResponse, AiOpsPolicyCompareCandidate, AiOpsPolicyCompareItem, AiOpsPolicyItem } from './AiOpsPolicyTypes';
import { AiOpsSurfacePanel } from './AiOpsPresentationShared';
import {
	formatAiOpsAverageSalesGrowthLine,
	formatAiOpsLearningRateLine,
	formatAiOpsPolicyDistributionSummaryLine,
} from './AiOpsPresentationText';

export function AiOpsPolicyDistributionList(props: { items: AiOpsPolicyItem[] }): JSX.Element {
	return (
		<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
			{props.items.map((item) => (
				<AiOpsSurfacePanel key={`${item.policy_type || 'UNCLASSIFIED'}`}>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
						<div style={{ fontWeight: 800 }}>{item.policy_type || 'UNCLASSIFIED'}</div>
						<div style={{ fontSize: 12, color: '#93c5fd' }}>{formatCount(item.sku_count, '개')}</div>
					</div>
					<div style={{ marginTop: 8, fontSize: 13, color: '#cbd5e1' }}>{formatAiOpsPolicyDistributionSummaryLine(item.avg_priority_score, item.top_product_name)}</div>
					<div style={{ marginTop: 6, fontSize: 12, color: '#fcd34d' }}>대표 정책팩: {item.top_policy_pack_id || 'AI_OPS'}</div>
					<div style={{ marginTop: 6, fontSize: 12, color: '#86efac' }}>대표 액션: {item.top_recommended_action || '대표 액션 없음'}</div>
				</AiOpsSurfacePanel>
			))}
		</div>
	);
}

export function AiOpsPolicyLearningGrid(props: {
	items: NonNullable<AiOpsPoliciesResponse['learning_items']>;
}): JSX.Element {
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
			{props.items.map((item, index) => (
				<AiOpsSurfacePanel key={`${String(item.policy_pack_id || 'AI_OPS')}:${index}`}>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
						<div style={{ fontWeight: 800 }}>{item.policy_pack_title || item.policy_pack_id || 'AI_OPS'}</div>
						<div style={{ fontSize: 12, color: '#86efac' }}>개선율 {formatPercent01(item.improvement_rate)}</div>
					</div>
					<div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>검증 {formatCount(item.verified_count, '건')} / 액션 {formatCount(item.action_count, '건')}</div>
					<div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>
						개선 {formatCount(item.improved_count, '건')} · 혼합 {formatCount(item.mixed_count, '건')} · 악화 {formatCount(item.declined_count, '건')}
					</div>
					<div style={{ marginTop: 6, fontSize: 12, color: '#93c5fd' }}>{formatAiOpsAverageSalesGrowthLine(item.avg_sales_growth_delta)}</div>
				</AiOpsSurfacePanel>
			))}
		</div>
	);
}

export function AiOpsPolicyComparePanel(props: {
	candidates: AiOpsPolicyCompareCandidate[];
	selectedCompareSkuId: string;
	onSelectSku: (skuId: string) => void;
	currentPolicyPackId?: string | null;
	recommendedPolicyPackId?: string | null;
	selectedProductName?: string | null;
	queueMessage?: string | null;
	items: AiOpsPolicyCompareItem[];
	onQueueCompareAction: (item: AiOpsPolicyCompareItem) => void;
	compareSubmittingPackId?: string | null;
}): JSX.Element {
	return (
		<>
			<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
				<label style={{ display: 'grid', gap: 6 }}>
					<span style={{ fontSize: 12, color: '#94a3b8' }}>비교 SKU</span>
					<select
						aria-label="policy-compare-sku-select"
						value={props.selectedCompareSkuId}
						onChange={(event) => props.onSelectSku(String(event.target.value || '').trim())}
						style={{ minWidth: 280 }}
					>
						{props.candidates.map((candidate) => {
							const skuId = String(candidate.sku_id || '').trim();
							return (
								<option key={skuId} value={skuId}>
									{candidate.product_name || skuId || '이름 없는 SKU'}
									{skuId ? ` (${skuId})` : ''}
								</option>
							);
						})}
					</select>
				</label>
				<div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 18 }}>현재 적용 정책팩: {props.currentPolicyPackId || 'AI_OPS'}</div>
				<div style={{ fontSize: 12, color: '#86efac', marginTop: 18 }}>추천 정책팩: {props.recommendedPolicyPackId || '-'}</div>
			</div>
			{props.selectedProductName ? (
				<div style={{ marginTop: 10, fontSize: 13, color: '#cbd5e1' }}>선택 SKU: {props.selectedProductName}</div>
			) : null}
			{props.queueMessage ? <div style={{ marginTop: 12, color: '#86efac' }}>{props.queueMessage}</div> : null}
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
				{props.items.map((item, index) => (
					<AiOpsSurfacePanel
						key={`${String(item.policy_pack_id || 'AI_OPS')}:${index}`}
						borderColor={
							item.recommended
								? 'rgba(250,204,21,0.55)'
								: item.matches_current_pack
									? 'rgba(134,239,172,0.55)'
									: 'rgba(148,163,184,0.18)'
						}
						background={
							item.recommended
								? 'rgba(120,53,15,0.2)'
								: item.matches_current_pack
									? 'rgba(20,83,45,0.22)'
									: 'rgba(15,23,42,0.35)'
						}
					>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
							<div style={{ fontWeight: 800 }}>{item.policy_pack_title || item.policy_pack_id || 'AI_OPS'}</div>
							<div
								style={{
									fontSize: 12,
									color: item.recommended ? '#fcd34d' : item.matches_current_pack ? '#86efac' : '#93c5fd',
								}}
							>
								{item.recommended ? '추천' : item.matches_current_pack ? '현재 적용' : item.policy_pack_id || 'AI_OPS'}
							</div>
						</div>
						<div style={{ marginTop: 8, fontSize: 13, color: '#cbd5e1' }}>정책 결과: {item.policy_type || 'UNCLASSIFIED'}</div>
						<div style={{ marginTop: 6, fontSize: 12, color: '#fcd34d' }}>추천 점수: {Number(item.recommendation_score ?? 0).toLocaleString()}</div>
						<div style={{ marginTop: 6, fontSize: 12, color: '#fcd34d' }}>이슈: {item.top_issue || '이슈 없음'}</div>
						<div style={{ marginTop: 6, fontSize: 12, color: '#86efac' }}>권장 액션: {item.recommended_action_primary || '권장 액션 없음'}</div>
						<div style={{ marginTop: 6, fontSize: 12, color: '#cbd5e1' }}>추천 근거: {item.recommendation_reason || '추천 근거 없음'}</div>
						{item.learning_summary && Number(item.learning_summary.verified_count ?? 0) > 0 ? (
							<div style={{ marginTop: 6, fontSize: 12, color: '#93c5fd' }}>{formatAiOpsLearningRateLine('학습 검증', item.learning_summary.verified_count, item.learning_summary.improvement_rate)}</div>
						) : null}
						{item.operation_learning_summary && Number(item.operation_learning_summary.verified_count ?? 0) > 0 ? (
							<div style={{ marginTop: 6, fontSize: 12, color: '#fca5a5' }}>
								{formatAiOpsLearningRateLine(
									'운영 학습 검증',
									item.operation_learning_summary.verified_count,
									item.operation_learning_summary.improvement_rate,
								)}
							</div>
						) : null}
						<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
							적용 mall_name: {(item.scope?.mall_names || []).join(', ') || '전체'}
						</div>
						<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
							임계값 Q&A {Number(item.thresholds?.qna_barrier_high ?? 0).toLocaleString()} / 리뷰 {Number(item.thresholds?.review_risk_high ?? 0).toLocaleString()}
						</div>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
							<button
								type="button"
								className="btn-ghost"
								aria-label={`queue-compare-action-${String(item.policy_pack_id || 'AI_OPS')}`}
								disabled={Boolean(item.matches_current_pack) || props.compareSubmittingPackId === String(item.policy_pack_id || '')}
								onClick={() => props.onQueueCompareAction(item)}
							>
								{item.matches_current_pack
									? '현재 적용 정책팩'
									: props.compareSubmittingPackId === String(item.policy_pack_id || '')
										? '적재 중...'
										: '이 액션을 실행 큐로 보내기'}
							</button>
						</div>
					</AiOpsSurfacePanel>
				))}
			</div>
		</>
	);
}
