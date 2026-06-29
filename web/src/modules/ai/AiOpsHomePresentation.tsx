import React from 'react';
import { useNavigate } from 'react-router-dom';

import { buildAiOpsPathWithActionBucket, normalizeActionBucket } from '../../shared/navigation/analyticsNavigation';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import type { AiOpsDecisionCard } from './AiOpsDecisionCardTypes';
import { formatCount, formatPercent01 } from './AiOpsCenterUtils';
import { AiOpsSurfacePanel } from './AiOpsPresentationShared';

export function AiOpsOperationLearningSummary(props: {
	verifiedCount?: number;
	improvementRate?: number | null;
	learningNote?: string | null;
}): JSX.Element {
	return (
		<div className="card" style={{ padding: 14 }}>
			<div className="card-title">최근 운영 학습</div>
			<div className="card-caption" style={{ marginTop: 6 }}>
				검증된 광고/운영 액션 성과를 메인 우선순위와 추천 판단에 다시 반영합니다.
			</div>
			<div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
				<div style={{ fontSize: 13, color: '#fcd34d' }}>운영 검증 {formatCount(props.verifiedCount, '건')}</div>
				<div style={{ fontSize: 13, color: '#86efac' }}>개선율 {formatPercent01(props.improvementRate)}</div>
				<div style={{ fontSize: 13, color: '#cbd5e1' }}>{String(props.learningNote || '운영 학습 없음')}</div>
			</div>
		</div>
	);
}

export function AiOpsActionBucketHubGrid(props: {
	actionBucketCards: Array<{
		bucket: string;
		count: number;
		leadItem: AiOpsDecisionCard | null;
	}>;
	selectedActionBucket: string;
}): JSX.Element {
	const navigate = useNavigate();

	if (props.actionBucketCards.length === 0) {
		return <div style={{ marginTop: 12, color: '#94a3b8' }}>표시할 실행 버킷 허브가 없습니다.</div>;
	}

	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
			{props.actionBucketCards.map((card) => {
				const normalizedBucket = normalizeActionBucket(card.bucket);
				const isSelected = normalizedBucket === props.selectedActionBucket;
				return (
					<AiOpsSurfacePanel
						key={normalizedBucket}
						borderColor={isSelected ? 'rgba(250,204,21,0.45)' : 'rgba(148,163,184,0.18)'}
						background={isSelected ? 'rgba(120,53,15,0.2)' : 'rgba(15,23,42,0.35)'}
					>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
							<div style={{ fontWeight: 800, color: isSelected ? '#fcd34d' : '#e2e8f0' }}>{labelAiOpsActionBucket(card.bucket)}</div>
							<div style={{ fontSize: 12, color: '#93c5fd' }}>{formatCount(card.count, '건')}</div>
						</div>
						<div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>대표 SKU {card.leadItem?.title || '없음'}</div>
						<div style={{ marginTop: 4, fontSize: 12, color: '#86efac' }}>
							권장 액션 {card.leadItem?.recommendedAction || '후속 판단 필요'}
						</div>
						<div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>대표 이슈 {card.leadItem?.summary || '요약 없음'}</div>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
							<button
								type="button"
								className="btn-ghost"
								aria-label={`home-bucket-home-${normalizedBucket}`}
								onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/home', normalizedBucket))}
							>
								홈에서 보기
							</button>
							<button
								type="button"
								className="btn-ghost"
								aria-label={`home-bucket-actions-${normalizedBucket}`}
								onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/actions', normalizedBucket))}
							>
								실행 큐 보기
							</button>
							<button
								type="button"
								className="btn-ghost"
								aria-label={`home-bucket-logs-${normalizedBucket}`}
								onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/logs', normalizedBucket))}
							>
								검증 로그 보기
							</button>
							<button
								type="button"
								className="btn-ghost"
								aria-label={`home-bucket-policies-${normalizedBucket}`}
								onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/policies', normalizedBucket))}
							>
								정책 센터 보기
							</button>
						</div>
					</AiOpsSurfacePanel>
				);
			})}
		</div>
	);
}
