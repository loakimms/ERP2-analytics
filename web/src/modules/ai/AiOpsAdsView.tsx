import React from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

import { selectedActionBucketFromSearch } from '../../shared/navigation/analyticsNavigation';
import type { AiOpsViewProps } from './AiOpsCommonTypes';
import type { AiOpsAdsBudgetItem, AiOpsAdsCannibalizationItem, AiOpsAdsItem, AiOpsAdsResponse } from './AiOpsAdsSalesTypes';
import type { AiOpsAdsBudgetDecisionCard, AiOpsAdsCannibalizationDecisionCard, AiOpsAdsDecisionCard } from './AiOpsDecisionCardTypes';
import { mapAdsBudgetItemToDecisionCard, mapAdsCannibalizationItemToDecisionCard, mapAdsItemToDecisionCard } from './AiOpsDecisionCardMappers';
import { formatCount } from './AiOpsCenterUtils';
import { ActionBucketFilterBar, AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { LearningSummaryDetails } from './AiOpsCenterDetails';

export function AiOpsAdsView(props: AiOpsViewProps): JSX.Element {
	const location = useLocation();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsAdsResponse | null>(null);
	const [message, setMessage] = React.useState<string | null>(null);
	const [submittingKey, setSubmittingKey] = React.useState<string | null>(null);

	const loadAdsData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/ops/ads`);
			setData((res?.data as AiOpsAdsResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '광고 운영 판단 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl]);

	React.useEffect(() => {
		void loadAdsData();
	}, [loadAdsData]);

	const summary = data?.summary ?? {};
	const selectedActionBucket = React.useMemo(() => selectedActionBucketFromSearch(location.search), [location.search]);
	const items = Array.isArray(data?.items) ? data.items : [];
	const cannibalizationItems = Array.isArray(data?.cannibalization_items) ? data.cannibalization_items : [];
	const budgetItems = Array.isArray(data?.budget_items) ? data.budget_items : [];
	const decisionCards = React.useMemo<AiOpsAdsDecisionCard[]>(() => items.map((item) => mapAdsItemToDecisionCard(item)), [items]);
	const cannibalizationDecisionCards = React.useMemo<AiOpsAdsCannibalizationDecisionCard[]>(
		() => cannibalizationItems.map((item) => mapAdsCannibalizationItemToDecisionCard(item)),
		[cannibalizationItems],
	);
	const budgetDecisionCards = React.useMemo<AiOpsAdsBudgetDecisionCard[]>(() => budgetItems.map((item) => mapAdsBudgetItemToDecisionCard(item)), [budgetItems]);
	const filteredDecisionCards = selectedActionBucket ? decisionCards.filter((item) => item.actionBucket === selectedActionBucket) : decisionCards;
	const filteredCannibalizationDecisionCards = selectedActionBucket
		? cannibalizationDecisionCards.filter((item) => item.actionBucket === selectedActionBucket)
		: cannibalizationDecisionCards;
	const filteredBudgetDecisionCards = selectedActionBucket
		? budgetDecisionCards.filter((item) => item.actionBucket === selectedActionBucket)
		: budgetDecisionCards;

	const queueAdAction = React.useCallback(
		async (item: AiOpsAdsItem): Promise<void> => {
			const campaignName = String(item.campaign_name || '').trim();
			const adgroupName = String(item.adgroup_name || '').trim();
			const keyword = String(item.keyword || '').trim();
			const key = `${campaignName}::${adgroupName}::${keyword}`;
			if (!campaignName || !adgroupName || !keyword) return;
			setSubmittingKey(key);
			setMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/ads/actions`, {
					campaign_name: campaignName,
					adgroup_name: adgroupName,
					keyword,
				});
				setMessage(`${keyword} 광고 액션을 실행 큐에 적재했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '광고 액션 실행 큐 적재에 실패했습니다.';
				setMessage(String(msg));
			} finally {
				setSubmittingKey(null);
			}
		},
		[props.apiBaseUrl],
	);

	const queueBudgetAction = React.useCallback(
		async (item: AiOpsAdsCannibalizationItem | AiOpsAdsBudgetItem): Promise<void> => {
			const campaignName = String(item.campaign_name || '').trim();
			const adgroupName = String(item.adgroup_name || '').trim();
			const keyword = String(item.keyword || '').trim();
			const actionKind = String(item.action_kind || '').trim();
			const key = `${campaignName}::${adgroupName}::${keyword}::${actionKind}`;
			if (!campaignName || !adgroupName || !keyword || !actionKind) return;
			setSubmittingKey(key);
			setMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/ads/budget-actions`, {
					campaign_name: campaignName,
					adgroup_name: adgroupName,
					keyword,
					action_kind: actionKind,
				});
				setMessage(`${keyword} 광고 예산 액션을 실행 큐에 적재했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '광고 예산 액션 실행 큐 적재에 실패했습니다.';
				setMessage(String(msg));
			} finally {
				setSubmittingKey(null);
			}
		},
		[props.apiBaseUrl],
	);

	return (
		<AiOpsPageShell
			title="광고 운영 판단"
			description="키워드 유지/중단/테스트, 검색어 품질, 잠식 분석, 예산 재배분을 액션 중심으로 정리합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="광고 키워드" value={formatCount(summary.total_keywords, '개')} caption="최신 광고 스냅샷 기준" tone="neutral" />
				<MiniKpiCard label="액션 후보" value={formatCount(summary.listed_count, '개')} caption="중단/증액/테스트 후보" tone="warn" />
				<MiniKpiCard
					label="액션 버킷"
					value={formatCount((summary.action_buckets || []).length, '개')}
					caption={(summary.action_buckets || []).join(', ') || '없음'}
					tone="good"
				/>
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">광고 액션 후보</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					실구매 전환과 비용 반응을 함께 보고, 중단/증액/테스트 대상을 승인형 큐로 연결합니다.
				</div>
				<ActionBucketFilterBar selectedActionBucket={selectedActionBucket} currentPath="/analytics/ai/ads" />
				{message ? <div style={{ marginTop: 12, color: '#86efac' }}>{message}</div> : null}
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>광고 운영 판단 데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && filteredDecisionCards.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 광고 액션 후보가 없습니다.</div>
				) : null}
				{!loading && !error && filteredDecisionCards.length > 0 ? (
					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{filteredDecisionCards.map((card, index) => {
							const item = card.raw;
							const campaignName = String(item.campaign_name || '').trim();
							const adgroupName = String(item.adgroup_name || '').trim();
							const keyword = String(item.keyword || '').trim();
							const key = `${campaignName}::${adgroupName}::${keyword || index}`;
							return (
								<AiOpsDecisionCardPanel
									key={key}
									card={card}
									note={card.approvalLine}
									actions={
										<button
											type="button"
											className="btn-ghost"
											aria-label="광고 액션 실행 큐로 보내기"
											disabled={submittingKey === key}
											onClick={() => void queueAdAction(item)}
										>
											{submittingKey === key ? '적재 중...' : '광고 액션 실행 큐로 보내기'}
										</button>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
				<div className="card" style={{ padding: 14 }}>
					<div className="card-title">잠식 의심 키워드</div>
					<div className="card-caption" style={{ marginTop: 6 }}>
						오가닉 상위 노출인데 광고 비용이 계속 지출되는 키워드를 감액 테스트 후보로 분리합니다.
					</div>
					{!loading && !error && filteredCannibalizationDecisionCards.length === 0 ? (
						<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 잠식 의심 키워드가 없습니다.</div>
					) : null}
					{!loading && !error && filteredCannibalizationDecisionCards.length > 0 ? (
						<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
							{filteredCannibalizationDecisionCards.map((card, index) => {
								const item = card.raw;
								const key = `${String(item.campaign_name || '')}::${String(item.adgroup_name || '')}::${String(item.keyword || '')}::${index}`;
								const submitKey = `${String(item.campaign_name || '').trim()}::${String(item.adgroup_name || '').trim()}::${String(item.keyword || '').trim()}::${String(item.action_kind || '').trim()}`;
								return (
									<AiOpsDecisionCardPanel
										key={key}
										card={card}
										note={card.approvalLine}
										extraContent={<LearningSummaryDetails summary={card.learningSummary} />}
										actions={
											<button
												type="button"
												className="btn-ghost"
												aria-label="잠식 감액 액션 큐로 보내기"
												disabled={submittingKey === submitKey}
												onClick={() => void queueBudgetAction(item)}
											>
												{submittingKey === submitKey ? '적재 중...' : '잠식 감액 액션 큐로 보내기'}
											</button>
										}
									/>
								);
							})}
						</div>
					) : null}
				</div>
				<div className="card" style={{ padding: 14 }}>
					<div className="card-title">예산 재배분 후보</div>
					<div className="card-caption" style={{ marginTop: 6 }}>
						증액/감액이 필요한 키워드를 분리해 예산 이동 테스트안으로 큐에 적재합니다.
					</div>
					{!loading && !error && filteredBudgetDecisionCards.length === 0 ? (
						<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 예산 재배분 후보가 없습니다.</div>
					) : null}
					{!loading && !error && filteredBudgetDecisionCards.length > 0 ? (
						<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
							{filteredBudgetDecisionCards.map((card, index) => {
								const item = card.raw;
								const key = `${String(item.campaign_name || '')}::${String(item.adgroup_name || '')}::${String(item.keyword || '')}::${index}`;
								const submitKey = `${String(item.campaign_name || '').trim()}::${String(item.adgroup_name || '').trim()}::${String(item.keyword || '').trim()}::${String(item.action_kind || '').trim()}`;
								return (
									<AiOpsDecisionCardPanel
										key={key}
										card={card}
										note={card.approvalLine}
										extraContent={<LearningSummaryDetails summary={card.learningSummary} />}
										actions={
											<button
												type="button"
												className="btn-ghost"
												aria-label="예산 이동 액션 큐로 보내기"
												disabled={submittingKey === submitKey}
												onClick={() => void queueBudgetAction(item)}
											>
												{submittingKey === submitKey ? '적재 중...' : '예산 이동 액션 큐로 보내기'}
											</button>
										}
									/>
								);
							})}
						</div>
					) : null}
				</div>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
				<FocusCard
					title="키워드 액션 원칙"
					description="광고 키워드는 실구매 전환이 없는데 비용만 누적되는지, 반대로 확장 가능한 승자인지를 먼저 분리합니다."
					bullets={[
						'고비용 무구매 키워드는 즉시 중단 테스트 후보로 올립니다.',
						'구매 전환과 ROAS가 높은 키워드는 증액 테스트 후보로 올립니다.',
						'유입 반응은 있으나 구매가 없는 경우는 랜딩/소재 테스트로 분리합니다.',
					]}
					links={[
						{ label: '광고 검색어 분석 열기', path: '/analytics/performance/ads-keywords' },
						{ label: '캠페인 분석 열기', path: '/analytics/campaign/campaigns' },
					]}
				/>
				<FocusCard
					title="다음 확장 포인트"
					description="이번 단계는 얇은 액션 facade까지 연결했고, 다음에는 잠식/예산 재배분 시뮬레이션으로 확장할 수 있습니다."
					bullets={[
						'오가닉 상위 노출 SKU와 광고 효율 저하 키워드를 결합해 잠식 후보를 만듭니다.',
						'캠페인/광고그룹 단위로 예산 재배분 테스트안을 만듭니다.',
						'검색어 제외 후보와 소재 테스트까지 큐에 함께 연결합니다.',
					]}
					links={[
						{ label: '실행 큐 열기', path: '/analytics/ai/actions' },
						{ label: '검증 로그 열기', path: '/analytics/ai/logs' },
					]}
				/>
			</div>
		</AiOpsPageShell>
	);
}
