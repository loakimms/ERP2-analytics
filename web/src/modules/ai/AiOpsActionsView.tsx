import React from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

import { normalizeActionBucket, selectedActionBucketFromSearch } from '../../shared/navigation/analyticsNavigation';
import type { AiOpsViewProps } from './AiOpsCommonTypes';
import type { AiOpsActionItem, AiOpsActionsResponse } from './AiOpsActionTypes';
import { mapActionItemToDecisionCard } from './AiOpsDecisionCardMappers';
import { AiOpsActionReviewSection, AiOpsActionStatusActions } from './AiOpsActionsPresentation';
import { formatCount, approvalButtonLabel, approvalDefaultNote } from './AiOpsCenterUtils';
import { ActionBucketFilterBar, AiOpsDecisionCardPanel, AiOpsPageShell, FocusCard, MiniKpiCard } from './AiOpsCenterLayout';
import { ActionQueueDiffDetails, ActionVerificationDetails } from './AiOpsCenterDetails';

export function AiOpsActionsView(props: AiOpsViewProps): JSX.Element {
	const location = useLocation();
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [data, setData] = React.useState<AiOpsActionsResponse | null>(null);
	const [actionMessage, setActionMessage] = React.useState<string | null>(null);
	const [noteByQueueId, setNoteByQueueId] = React.useState<Record<string, string>>({});
	const [updatingQueueId, setUpdatingQueueId] = React.useState<string | null>(null);

	const loadActionsData = React.useCallback(async (): Promise<void> => {
		setLoading(true);
		setError(null);
		try {
			const res = await axios.get(`${props.apiBaseUrl}/ai/ops/actions`);
			setData((res?.data as AiOpsActionsResponse) ?? null);
		} catch (e: any) {
			const msg = e?.response?.data?.detail ?? e?.message ?? '실행 큐를 불러오지 못했습니다.';
			setError(String(msg));
		} finally {
			setLoading(false);
		}
	}, [props.apiBaseUrl]);

	React.useEffect(() => {
		void loadActionsData();
	}, [loadActionsData]);

	const summary = data?.summary ?? {};
	const selectedActionBucket = React.useMemo(() => selectedActionBucketFromSearch(location.search), [location.search]);
	const items = Array.isArray(data?.items) ? data.items : [];
	const filteredItems = selectedActionBucket
		? items.filter((item) => {
				const payloadActionBucket = normalizeActionBucket(item.payload?.action_bucket as string | null | undefined);
				const payloadActionKind = normalizeActionBucket(item.payload?.action_kind as string | null | undefined);
				return payloadActionBucket === selectedActionBucket || payloadActionKind === selectedActionBucket;
			})
		: items;
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

	const updateQueueStatus = React.useCallback(
		async (item: AiOpsActionItem, status: 'APPROVED' | 'REJECTED' | 'DONE'): Promise<void> => {
			const queueId0 = String(item.queue_id || '').trim();
			if (!queueId0) return;
			const currentNote = String(noteByQueueId[queueId0] || '').trim();
			const nextReviewNote = currentNote || approvalDefaultNote(item, status) || null;
			setUpdatingQueueId(queueId0);
			setActionMessage(null);
			try {
				await axios.post(`${props.apiBaseUrl}/ai/ops/actions/${queueId0}/status`, {
					status,
					reviewer: 'ai-ops-ui',
					review_note: nextReviewNote,
				});
				if (!currentNote && nextReviewNote) {
					setNoteByQueueId((prev) => ({
						...prev,
						[queueId0]: nextReviewNote,
					}));
				}
				await loadActionsData();
				setActionMessage(`실행 큐 상태를 ${status}로 변경했습니다.`);
			} catch (e: any) {
				const msg = e?.response?.data?.detail ?? e?.message ?? '실행 큐 상태 변경에 실패했습니다.';
				setActionMessage(String(msg));
			} finally {
				setUpdatingQueueId(null);
			}
		},
		[loadActionsData, noteByQueueId, props.apiBaseUrl],
	);

	return (
		<AiOpsPageShell
			title="실행 큐"
			description="AI 판단 결과를 바로 실행하지 않고 검토 가능한 대기열로 관리합니다."
		>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
				<MiniKpiCard label="대기중 액션" value={formatCount(summary.pending_count)} caption="사람 승인 전 상태" tone="warn" />
				<MiniKpiCard label="현재 목록" value={formatCount(filteredItems.length)} caption="화면에 표시된 항목" tone="neutral" />
			</div>
			<div className="card" style={{ padding: 14 }}>
				<div className="card-title">대기중 {formatCount(summary.pending_count)}</div>
				<div className="card-caption" style={{ marginTop: 6 }}>
					광고, 리뷰, FAQ, 상품 운영 액션을 한 큐에서 추적합니다.
				</div>
				<ActionBucketFilterBar selectedActionBucket={selectedActionBucket} currentPath="/analytics/ai/actions" />
				{actionMessage ? <div style={{ marginTop: 12, color: '#86efac' }}>{actionMessage}</div> : null}
				{loading ? <div style={{ marginTop: 12, color: '#94a3b8' }}>실행 큐를 불러오는 중...</div> : null}
				{error ? <div style={{ marginTop: 12, color: '#fda4af' }}>{error}</div> : null}
				{!loading && !error && filteredItems.length === 0 ? (
					<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 대기중인 액션이 없습니다.</div>
				) : null}
				{!loading && !error && filteredItems.length > 0 ? (
					<div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
						{filteredItems.map((item) => {
							const queueKey = String(item.queue_id || `${item.entity_id}:${item.action_type}`);
							const card = mapActionItemToDecisionCard(item, evidenceDateRange);
							return (
								<AiOpsDecisionCardPanel
									key={queueKey}
									card={card}
									note={card.approvalLine}
									extraContent={
										<AiOpsActionReviewSection
											noteValue={noteByQueueId[String(item.queue_id || '')] ?? String(item.review_note || '')}
											onNoteChange={(nextValue) =>
												setNoteByQueueId((prev) => ({
													...prev,
													[String(item.queue_id || '')]: nextValue,
												}))
											}
											existingNote={item.review_note}
											sourceLink={card.links.source}
											sourceAriaLabel={`action-item-source-${queueKey}`}
											queueLink={card.links.queue}
											logsLink={card.links.logs}
										>
											<ActionQueueDiffDetails item={item} />
											<ActionVerificationDetails verification={item.verification} />
										</AiOpsActionReviewSection>
									}
									actions={
										<AiOpsActionStatusActions
											approveLabel={approvalButtonLabel(item)}
											onApprove={() => void updateQueueStatus(item, 'APPROVED')}
											onReject={() => void updateQueueStatus(item, 'REJECTED')}
											onDone={() => void updateQueueStatus(item, 'DONE')}
											disabled={updatingQueueId === item.queue_id}
										/>
									}
								/>
							);
						})}
					</div>
				) : null}
			</div>
			<FocusCard
				title="승인형 액션 큐"
				description="광고, SEO, 리뷰, FAQ 관련 액션을 모두 한 곳에서 승인/반려/실행 추적합니다."
				bullets={[
					'중단, 증액, 테스트, 제외 후보, FAQ 보강, 리뷰 개선 액션을 동일한 큐로 관리합니다.',
					'1차에서는 실제 외부 API 실행 없이 큐 적재와 승인/반려 중심으로 운영합니다.',
					'판단 로그와 연결해 7일 후 성과 검증까지 이어지게 합니다.',
				]}
				links={[
					{ label: '오늘의 실행 열기', path: '/analytics/ai/home' },
					{ label: '검증 로그 열기', path: '/analytics/ai/logs' },
				]}
			/>
		</AiOpsPageShell>
	);
}
