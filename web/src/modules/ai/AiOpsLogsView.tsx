import React from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

import { aiOpsLogMatchesActionBucket, getAiOpsLogPrimaryActionBucket } from '../../shared/domain/analyticsDomain';
import { selectedActionBucketFromSearch } from '../../shared/navigation/analyticsNavigation';
import type { AiOpsViewProps } from './AiOpsCommonTypes';
import { mapLogItemToDecisionCard } from './AiOpsDecisionCardMappers';
import { trimmedText } from './AiOpsDecisionCardMapperUtils';
import { AiOpsVerificationSupportSection } from './AiOpsDecisionSupportPresentation';
import type { AiOpsLogsResponse } from './AiOpsLogTypes';
import { formatCount, formatPercent01 } from './AiOpsCenterUtils';
import { ActionBucketFilterBar, AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { ActionDiffDetails, ActionVerificationDetails, LogAuditSummary } from './AiOpsCenterDetails';
import { AiOpsLogActionChips, AiOpsLogHighlights, AiOpsLogsReportSummary } from './AiOpsLogsPresentation';

export function AiOpsLogsView(props: AiOpsViewProps): JSX.Element {
	const location = useLocation();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsLogsResponse | null>(null);
	const [selectedPolicyPackId, setSelectedPolicyPackId] = React.useState<string>('ALL');

	const loadLogsData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/ops/logs`, {
				params: selectedPolicyPackId !== 'ALL' ? { policy_pack_id: selectedPolicyPackId } : {},
			});
			setData((res?.data as AiOpsLogsResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '검증 로그를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl, selectedPolicyPackId]);

	React.useEffect(() => {
		void loadLogsData();
	}, [loadLogsData]);

	const summary = data?.summary ?? {};
	const items = Array.isArray(data?.items) ? data.items : [];
	const policyPackIds = Array.isArray(summary.policy_pack_ids) ? summary.policy_pack_ids : [];
	const selectedActionBucket = React.useMemo(() => selectedActionBucketFromSearch(location.search), [location.search]);
	const filteredItems = selectedActionBucket ? items.filter((item) => aiOpsLogMatchesActionBucket(item, selectedActionBucket)) : items;
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
	const reportSummary = React.useMemo(() => {
		const totalCount = filteredItems.length;
		const approvedCount = filteredItems.filter((item) => String(item.latest_action_status || '').trim().toUpperCase() === 'APPROVED').length;
		const rejectedCount = filteredItems.filter((item) => String(item.latest_action_status || '').trim().toUpperCase() === 'REJECTED').length;
		const doneCount = filteredItems.filter((item) => String(item.latest_action_status || '').trim().toUpperCase() === 'DONE').length;
		const verificationItems = filteredItems.filter((item) => String(item.latest_action_verification?.outcome || '').trim() !== '');
		const improvedCount = verificationItems.filter(
			(item) => String(item.latest_action_verification?.outcome || '').trim().toUpperCase() === 'IMPROVED',
		).length;
		const bucketCounts = filteredItems.reduce<Record<string, number>>((acc, item) => {
			const bucket = getAiOpsLogPrimaryActionBucket(item);
			if (!bucket) return acc;
			acc[bucket] = Number(acc[bucket] || 0) + 1;
			return acc;
		}, {});
		const topBucketEntry = Object.entries(bucketCounts).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] ?? null;
		return {
			totalCount,
			approvedCount,
			rejectedCount,
			doneCount,
			approvalRate: totalCount > 0 ? approvedCount / totalCount : 0,
			verifiedCount: verificationItems.length,
			improvedCount,
			improvementRate: verificationItems.length > 0 ? improvedCount / verificationItems.length : 0,
			topBucket: topBucketEntry?.[0] || '',
			topBucketCount: Number(topBucketEntry?.[1] || 0),
		};
	}, [filteredItems]);

	return (
		<AiOpsPageShell
			title="검증/설명 로그"
			description="모든 판단의 입력, 룰 트리거, 설명, 승인 결과를 추적합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="로그 대상 SKU" value={formatCount(filteredItems.length, '개')} caption="현재 화면 기준" tone="neutral" />
				<MiniKpiCard label="스냅샷 기준일" value={summary.snapshot_date || '-'} caption="설명 로그 묶음" tone="good" />
				<MiniKpiCard
					label="승인된 액션"
					value={formatCount(filteredItems.filter((item) => String(item.latest_action_status || '') === 'APPROVED').length)}
					caption="운영 승인 완료"
					tone="warn"
				/>
			</div>
			<AiOpsLogsReportSummary
				approvalRate={reportSummary.approvalRate}
				approvedCount={reportSummary.approvedCount}
				rejectedCount={reportSummary.rejectedCount}
				doneCount={reportSummary.doneCount}
				improvementRate={reportSummary.improvementRate}
				verifiedCount={reportSummary.verifiedCount}
				improvedCount={reportSummary.improvedCount}
				topBucket={reportSummary.topBucket}
				topBucketCount={reportSummary.topBucketCount}
			/>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">판단 근거 로그</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					SKU별 판단 근거, 작동한 규칙, 최신 실행 상태를 한 화면에서 확인합니다.
				</div>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
					<label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 12 }}>
						<span>정책팩 필터</span>
						<select
							aria-label="logs-policy-pack-filter"
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
				<ActionBucketFilterBar selectedActionBucket={selectedActionBucket} currentPath="/analytics/ai/logs" />
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>검증 로그를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && filteredItems.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>표시할 검증 로그가 없습니다.</div>
				) : null}
				{!loading && !error && filteredItems.length > 0 ? (
					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{filteredItems.map((item) => {
							const salesEvidence = (item.evidence?.sales as Record<string, any> | undefined) ?? {};
							const overinvestment = (salesEvidence.ad_overinvestment as Record<string, any> | undefined) ?? {};
							const overinvestmentKeyword = trimmedText(overinvestment.keyword);
							const card = mapLogItemToDecisionCard(item, evidenceDateRange);
							return (
								<AiOpsDecisionCardPanel
									key={`${item.sku_id || 'unknown'}:${item.date || ''}`}
									card={card}
									note={`정책팩 ${item.policy_pack_id || 'AI_OPS'}`}
									extraContent={
										<AiOpsVerificationSupportSection
											sourceLink={card.links.source}
											sourceAriaLabel={`log-item-source-${item.sku_id || 'unknown'}`}
											queueLink={card.links.queue}
											logsLink={card.links.logs}
											currentStep="logs"
										>
											<LogAuditSummary item={item} />
											<AiOpsLogHighlights
												latestActionNote={item.latest_action_note}
												overinvestmentKeyword={overinvestmentKeyword}
												adCostLabel={Number(overinvestment.ad_cost ?? 0).toLocaleString()}
												adSpendRatioLabel={formatPercent01(overinvestment.ad_spend_ratio as number | null | undefined)}
											/>
											<ActionDiffDetails
												actionType={item.latest_action_type}
												payload={item.latest_action_payload}
												label="정책 비교 액션"
											/>
											<ActionVerificationDetails verification={item.latest_action_verification} />
										</AiOpsVerificationSupportSection>
									}
									actions={
										<AiOpsLogActionChips
											rulesTriggered={item.rules_triggered || []}
											recommendedActions={item.recommended_actions || []}
										/>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<FocusCard
				title="설명 가능한 판단"
				description="현재 A-1 Trace 철학을 전체 AI 운영 센터로 확대하는 출발점입니다."
				bullets={[
					'어떤 입력과 기간으로 판단했는지 기록합니다.',
					'어떤 정책과 룰이 먼저 작동했는지 남깁니다.',
					'운영자가 승인/수정/반려한 이력과 사후 성과를 연결합니다.',
				]}
				links={[
					{ label: 'A-1 Trace 열기', path: '/analytics/ai/organic-rank/trace' },
					{ label: 'AI 세팅 열기', path: '/analytics/settings/ai' },
				]}
			/>
		</AiOpsPageShell>
	);
}
