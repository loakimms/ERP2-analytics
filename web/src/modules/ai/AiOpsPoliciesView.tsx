import React from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

import { inferAiOpsActionBucketFromTexts } from '../../shared/domain/analyticsDomain';
import { selectedActionBucketFromSearch } from '../../shared/navigation/analyticsNavigation';
import type { AiOpsViewProps } from './AiOpsCommonTypes';
import type { AiOpsPoliciesResponse, AiOpsPolicyCompareItem, AiOpsPolicyCompareResponse } from './AiOpsPolicyTypes';
import { formatCount, formatPercent01, formatPercent100 } from './AiOpsCenterUtils';
import { ActionBucketFilterBar, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { AiOpsPolicyComparePanel, AiOpsPolicyDistributionList, AiOpsPolicyLearningGrid } from './AiOpsPoliciesPresentation';

export function AiOpsPoliciesView(props: AiOpsViewProps): JSX.Element {
	const location = useLocation();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsPoliciesResponse | null>(null);
	const [compareLoading, setCompareLoading] = React.useState(true);
	const [compareError, setCompareError] = React.useState<string | null>(null);
	const [compareData, setCompareData] = React.useState<AiOpsPolicyCompareResponse | null>(null);
	const [selectedCompareSkuId, setSelectedCompareSkuId] = React.useState<string>('');
	const [compareQueueMessage, setCompareQueueMessage] = React.useState<string | null>(null);
	const [compareSubmittingPackId, setCompareSubmittingPackId] = React.useState<string | null>(null);

	const loadPoliciesData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/ops/policies`);
			setData((res?.data as AiOpsPoliciesResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '정책 센터 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl]);

	const loadCompareData = React.useCallback(
		async (skuId?: string): Promise<void> => {
			setCompareLoading(true);
			setCompareError(null);
			try {
				const res = await axios.get(`${props.apiBaseUrl}/ai/ops/policies/compare`, {
					params: skuId ? { sku_id: skuId } : {},
				});
				const next = (res?.data as AiOpsPolicyCompareResponse) ?? null;
				setCompareData(next);
				const nextSkuId = String(next?.summary?.selected_sku_id || '').trim();
				if (nextSkuId) {
					setSelectedCompareSkuId(nextSkuId);
				}
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '정책팩 비교 데이터를 불러오지 못했습니다.';
				setCompareError(String(msg));
			} finally {
				setCompareLoading(false);
			}
		},
		[props.apiBaseUrl],
	);

	React.useEffect(() => {
		void loadPoliciesData();
		void loadCompareData();
	}, [loadCompareData, loadPoliciesData]);

	const summary = data?.summary ?? {};
	const selectedActionBucket = React.useMemo(() => selectedActionBucketFromSearch(location.search), [location.search]);
	const items = Array.isArray(data?.items) ? data.items : [];
	const learningItems = Array.isArray(data?.learning_items) ? data.learning_items : [];
	const compareSummary = compareData?.summary ?? {};
	const compareCandidates = Array.isArray(compareData?.candidates) ? compareData.candidates : [];
	const compareItems = Array.isArray(compareData?.items) ? compareData.items : [];
	const filteredItems = selectedActionBucket
		? items.filter((item) => inferAiOpsActionBucketFromTexts([item.top_recommended_action, item.policy_type]) === selectedActionBucket)
		: items;
	const filteredCompareItems = selectedActionBucket
		? compareItems.filter(
				(item) =>
					inferAiOpsActionBucketFromTexts([
						item.recommended_action_primary,
						item.policy_type,
						item.top_issue,
						item.recommendation_reason,
					]) === selectedActionBucket,
		  )
		: compareItems;

	const queueCompareAction = React.useCallback(
		async (item: AiOpsPolicyCompareItem): Promise<void> => {
			const skuId = String(compareSummary.selected_sku_id || '').trim();
			const targetPolicyPackId = String(item.policy_pack_id || '').trim();
			if (!skuId || !targetPolicyPackId || item.matches_current_pack) return;
			setCompareSubmittingPackId(targetPolicyPackId);
			setCompareQueueMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/policies/compare/actions`, {
					sku_id: skuId,
					target_policy_pack_id: targetPolicyPackId,
				});
				setCompareQueueMessage(`${compareSummary.selected_product_name || skuId} 비교 액션을 실행 큐에 적재했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '비교 액션 실행 큐 적재에 실패했습니다.';
				setCompareQueueMessage(String(msg));
			} finally {
				setCompareSubmittingPackId(null);
			}
		},
		[compareSummary.selected_product_name, compareSummary.selected_sku_id, props.apiBaseUrl],
	);

	return (
		<AiOpsPageShell title="SKU 정책 센터" description="상품을 정책 타입으로 분류하고 장기 운영 방향을 고정합니다.">
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="정책 대상 SKU" value={formatCount(summary.total_skus, '개')} caption="최신 스냅샷 기준" tone="neutral" />
				<MiniKpiCard label="정책 타입 수" value={formatCount(summary.policy_count, '개')} caption="현재 분류된 타입" tone="good" />
				<MiniKpiCard label="정책팩 수" value={formatCount(summary.rule_pack_count, '개')} caption="AI 세팅 rule pack" tone="warn" />
				<MiniKpiCard label="설정 포맷" value={String(summary.format_version || '-')} caption="정책 규칙 스냅샷" tone="neutral" />
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">정책 분포</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					정책 타입별 SKU 분포와 대표 액션을 확인하고, 현재 정책팩 구성과 함께 운영 기준을 점검합니다.
				</div>
				<ActionBucketFilterBar selectedActionBucket={selectedActionBucket} currentPath="/analytics/ai/policies" />
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>정책 센터 데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && filteredItems.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>표시할 정책 분포 데이터가 없습니다.</div>
				) : null}
				{!loading && !error && filteredItems.length > 0 ? <AiOpsPolicyDistributionList items={filteredItems} /> : null}
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">정책팩 학습 결과</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					승인된 정책 비교 액션의 실제 검증 결과를 누적해, 어떤 정책팩이 실제 개선을 더 자주 만드는지 보여줍니다.
				</div>
				{!loading && !error && learningItems.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>아직 누적된 정책팩 학습 결과가 없습니다.</div>
				) : null}
				{!loading && !error && learningItems.length > 0 ? <AiOpsPolicyLearningGrid items={learningItems} /> : null}
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">정책팩 비교 시뮬레이션</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					같은 SKU를 여러 정책팩 기준으로 다시 판정해 정책 차이가 실제 운영 액션에 어떤 영향을 주는지 바로 비교합니다.
				</div>
				{compareLoading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>정책팩 비교 데이터를 불러오는 중...</div> : null}
				{compareError ? <div style={{ marginTop: 12, color: '#fda4af' }}>{compareError}</div> : null}
				{!compareLoading && !compareError && filteredCompareItems.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>비교할 정책팩 시뮬레이션 데이터가 없습니다.</div>
				) : null}
				{!compareLoading && !compareError && filteredCompareItems.length > 0 ? (
					<AiOpsPolicyComparePanel
						candidates={compareCandidates}
						selectedCompareSkuId={selectedCompareSkuId}
						onSelectSku={(nextSkuId) => {
							setSelectedCompareSkuId(nextSkuId);
							void loadCompareData(nextSkuId || undefined);
						}}
						currentPolicyPackId={compareSummary.current_policy_pack_id}
						recommendedPolicyPackId={compareSummary.recommended_policy_pack_id}
						selectedProductName={compareSummary.selected_product_name}
						queueMessage={compareQueueMessage}
						items={filteredCompareItems}
						onQueueCompareAction={(item) => void queueCompareAction(item)}
						compareSubmittingPackId={compareSubmittingPackId}
					/>
				) : null}
			</div>
			<FocusCard
				title="정책 타입"
				description={`현재 AI 세팅 포맷 ${String(summary.format_version || '-')} / 공통 규칙 길이 ${Number(summary.common_rules_len || 0).toLocaleString()}자`}
				bullets={['오가닉 주력형', '광고 성장형', '광고 방어형', 'VOC 개선 우선형', 'FAQ/상세 보완형', '축소/정리형']}
				links={[
					{ label: 'AI 세팅 열기', path: '/analytics/settings/ai' },
					{ label: '상품별 운영 판단 열기', path: '/analytics/ai/products' },
				]}
			/>
		</AiOpsPageShell>
	);
}
