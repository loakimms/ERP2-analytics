import React from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';

import {
	buildAiOpsPathWithActionBucket,
	normalizeActionBucket,
	selectedActionBucketFromSearch,
} from '../../shared/navigation/analyticsNavigation';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import type { AiOpsViewProps } from './AiOpsCommonTypes';
import { mapHomeItemToDecisionCard } from './AiOpsDecisionCardMappers';
import { AiOpsActionBucketHubGrid, AiOpsOperationLearningSummary } from './AiOpsHomePresentation';
import { AiOpsVerificationSupportSection } from './AiOpsPresentationShared';
import type { AiOpsHomeResponse } from './AiOpsHomeTypes';
import { formatCount, formatFreshnessSummary, formatPercent01, useAiOpsSnapshotRebuild } from './AiOpsCenterUtils';
import { ActionBucketFilterBar, AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';

export function AiOpsHomeView(props: AiOpsViewProps): JSX.Element {
	const location = useLocation();
	const navigate = useNavigate();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsHomeResponse | null>(null);

	const loadHomeData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/ops/home`);
			setData((res?.data as AiOpsHomeResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '오늘의 실행 데이터를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl]);
	const { rebuilding, rebuildMessage, triggerRebuild } = useAiOpsSnapshotRebuild(props.apiBaseUrl, loadHomeData);

	React.useEffect(() => {
		void loadHomeData();
	}, [loadHomeData]);

	const summary = data?.summary ?? {};
	const freshnessSummary = React.useMemo(() => formatFreshnessSummary(data?.freshness ?? null), [data?.freshness]);
	const selectedActionBucket = React.useMemo(() => selectedActionBucketFromSearch(location.search), [location.search]);
	const items = Array.isArray(data?.items) ? data.items : [];
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
	const decisionCards = React.useMemo(
		() => items.map((item) => mapHomeItemToDecisionCard(item, evidenceDateRange)),
		[items, evidenceDateRange],
	);
	const actionBucketEntries = Object.entries((summary.action_bucket_counts || {}) as Record<string, number>)
		.sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
		.slice(0, 4);
	const actionBucketCards = React.useMemo(
		() =>
			actionBucketEntries.map(([bucket, count]) => {
				const normalizedBucket = normalizeActionBucket(bucket);
				const bucketItems = decisionCards.filter((item) => item.actionBucket === normalizedBucket);
				const leadItem =
					bucketItems
						.slice()
						.sort((a, b) => Number(b.effectivePriorityScore ?? 0) - Number(a.effectivePriorityScore ?? 0))[0] ?? null;
				return {
					bucket,
					count: Number(count || 0),
					leadItem,
				};
			}),
		[actionBucketEntries, decisionCards],
	);
	const filteredCards = selectedActionBucket ? decisionCards.filter((item) => item.actionBucket === selectedActionBucket) : decisionCards;

	return (
		<AiOpsPageShell
			title="오늘의 실행"
			description="오늘 바로 검토해야 할 위험과 기회를 한 화면에서 정리합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="즉시 검토 SKU" value={formatCount(summary.urgent_count)} caption="오늘 우선 판단 대상" tone="bad" />
				<MiniKpiCard label="대기중 액션" value={formatCount(summary.pending_action_count)} caption="승인 대기 큐" tone="good" />
				<MiniKpiCard label="VOC 위험 SKU" value={formatCount(summary.high_priority_voc_count)} caption="리뷰 개선 우선" tone="warn" />
				<MiniKpiCard label="데이터 신뢰도" value={formatPercent01(summary.avg_data_quality_score)} caption="오늘 판단 가능한 범위" tone="neutral" />
			</div>
			<AiOpsOperationLearningSummary
				verifiedCount={summary.operation_verified_count}
				improvementRate={summary.operation_improvement_rate}
				learningNote={summary.operation_learning_note}
			/>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">오늘 실행 버킷</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					오늘 우선 SKU가 어떤 실행 유형으로 분포하는지 바로 확인합니다.
				</div>
				<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
					<button
						type="button"
						className="btn-ghost"
						onClick={() => navigate('/analytics/ai/home')}
						style={{
							borderColor: !selectedActionBucket ? 'rgba(250,204,21,0.45)' : undefined,
							color: !selectedActionBucket ? '#fcd34d' : undefined,
						}}
					>
						전체 보기
					</button>
					{actionBucketEntries.length > 0 ? (
						actionBucketEntries.map(([bucket, count]) => (
							<button
								key={bucket}
								type="button"
								className="btn-ghost"
								onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/home', bucket))}
								style={{
									padding: '8px 10px',
									borderRadius: 999,
									border: String(bucket || '').trim().toUpperCase() === selectedActionBucket
										? '1px solid rgba(250,204,21,0.45)'
										: '1px solid rgba(148,163,184,0.18)',
									background: String(bucket || '').trim().toUpperCase() === selectedActionBucket
										? 'rgba(120,53,15,0.2)'
										: 'rgba(15,23,42,0.35)',
									fontSize: 12,
									color: String(bucket || '').trim().toUpperCase() === selectedActionBucket ? '#fcd34d' : '#cbd5e1',
								}}
							>
								{labelAiOpsActionBucket(bucket)} {formatCount(Number(count || 0), '건')}
							</button>
						))
					) : (
						<div style={{ fontSize: 12, color: '#94a3b8' }}>표시할 실행 버킷이 없습니다.</div>
					)}
				</div>
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">버킷별 운영 허브</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					같은 실행 버킷 기준으로 홈 필터, 실행 큐, 검증 로그, 정책 센터까지 바로 이동합니다.
				</div>
				<AiOpsActionBucketHubGrid actionBucketCards={actionBucketCards} selectedActionBucket={selectedActionBucket} />
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">오늘 우선 SKU</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					{summary.snapshot_date ? `스냅샷 기준일 ${summary.snapshot_date}` : '최신 스냅샷이 아직 없습니다.'}
				</div>
				<div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>{freshnessSummary}</div>
				<ActionBucketFilterBar selectedActionBucket={selectedActionBucket} currentPath="/analytics/ai/home" showHomeLink={false} />
				{selectedActionBucket ? (
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/sales', selectedActionBucket))}
						>
							판매·전환 판단으로 보기
						</button>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/ads', selectedActionBucket))}
						>
							광고 운영 판단으로 보기
						</button>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/actions', selectedActionBucket))}
						>
							실행 큐로 보기
						</button>
						<button
							type="button"
							className="btn-ghost"
							onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/logs', selectedActionBucket))}
						>
							검증 로그로 보기
						</button>
					</div>
				) : null}
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
					<button type="button" className="btn-ghost" onClick={() => void triggerRebuild()} disabled={rebuilding}>
						{rebuilding ? '재생성 중...' : '스냅샷 재생성'}
					</button>
					<button type="button" className="btn-ghost" onClick={() => void loadHomeData()} disabled={loading || rebuilding}>
						{loading ? '새로고침 중...' : '새로고침'}
					</button>
				</div>
				{rebuildMessage ? <div style={{ marginTop: 12, color: '#86efac' }}>{rebuildMessage}</div> : null}
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>데이터를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && filteredCards.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>오늘 표시할 상품 판단 데이터가 없습니다.</div>
				) : null}
				{!loading && !error && filteredCards.length > 0 ? (
					<div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
						{filteredCards.slice(0, 5).map((card) => {
							return (
								<AiOpsDecisionCardPanel
									key={card.id}
									card={{
										...card,
										badgeLabel: card.actionBucket || card.policyLabel || '정책 미분류',
										contextLine: `실행 버킷 ${card.actionBucketLabel || '-'} · 정책 ${card.policyLabel || '미분류'}`,
									}}
									summaryColor="#cbd5e1"
									note={card.priorityReason}
									extraContent={
										<AiOpsVerificationSupportSection
											sourceLink={{ label: card.links.source.label, path: card.links.source.path }}
											sourceAriaLabel={card.links.source.ariaLabel}
											queueLink={{ label: card.links.queue.label, path: card.links.queue.path }}
											logsLink={{ label: card.links.logs.label, path: card.links.logs.path }}
										/>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
				<FocusCard
					title="오늘 바로 줄여야 할 광고"
					description="광고 효율은 낮고 오가닉/판매/구매 신호가 약한 항목을 우선 정리합니다."
					bullets={[
						'광고비 낭비 후보를 먼저 줄여 현금흐름을 확보합니다.',
						'잠식 의심 키워드는 감액 테스트 대상으로 분리합니다.',
						'표본이 부족한 항목은 UNCERTAIN으로 분리해 오판을 줄입니다.',
					]}
					links={[
						{ label: '광고 운영 판단 열기', path: '/analytics/ai/ads' },
						{ label: '실행 큐 열기', path: '/analytics/ai/actions' },
					]}
				/>
				<FocusCard
					title="오늘 광고보다 먼저 고쳐야 할 것"
					description="리뷰, Q&A, 판매 리스크가 큰 SKU는 광고 확대보다 상품/운영 보강이 우선입니다."
					bullets={[
						'부정 리뷰 비율 급등 SKU를 즉시 식별합니다.',
						'구매 직전 문의와 FAQ 부재가 전환을 막는 SKU를 분리합니다.',
						'환불/품질 리스크가 큰 SKU는 확대보다 개선 액션을 우선합니다.',
					]}
					links={[
						{ label: '리뷰·VOC 판단 열기', path: '/analytics/ai/reviews' },
						{ label: 'Q&A 판단 열기', path: '/analytics/ai/qna' },
					]}
				/>
			</div>
		</AiOpsPageShell>
	);
}
