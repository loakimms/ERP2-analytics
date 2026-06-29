import React from 'react';
import { useNavigate } from 'react-router-dom';

import { buildAiOpsPathWithActionBucket } from '../../shared/navigation/analyticsNavigation';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import type { AiOpsRecommendedActionItem } from './AiOpsQualitativeTypes';
import { AiOpsSurfacePanel } from './AiOpsPresentationShared';

export function SeverityBadge(props: { severity?: string | null }): JSX.Element | null {
	const severity = String(props.severity || '').trim().toUpperCase();
	if (!severity) return null;
	const color = severity === 'HIGH' ? '#fda4af' : severity === 'MEDIUM' ? '#fde68a' : '#93c5fd';
	return <div style={{ fontSize: 12, color }}>심각도 {severity}</div>;
}

export function TagList(props: { label: string; values?: string[] }): JSX.Element | null {
	const values = Array.isArray(props.values) ? props.values.filter(Boolean) : [];
	if (!values.length) return null;
	return (
		<div style={{ marginTop: 6, fontSize: 12, color: '#cbd5e1' }}>
			{props.label}: {values.join(', ')}
		</div>
	);
}

export function ActionProposalList(props: {
	title: string;
	description: string;
	actions: AiOpsRecommendedActionItem[];
}): JSX.Element {
	const navigate = useNavigate();

	return (
		<div className="card" style={{ padding: 14 }}>
			<div className="card-title">{props.title}</div>
			<div className="card-caption" style={{ marginTop: 6 }}>
				{props.description}
			</div>
			{props.actions.length === 0 ? (
				<div style={{ marginTop: 12, color: '#94a3b8' }}>현재 제안된 실행 묶음이 없습니다.</div>
			) : (
				<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
					{props.actions.map((action, index) => (
						<AiOpsSurfacePanel key={`${String(action.title || 'action')}:${index}`}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
								<div style={{ fontWeight: 800 }}>{action.title || '이름 없는 실행 제안'}</div>
								<div style={{ fontSize: 12, color: '#93c5fd' }}>
									{labelAiOpsActionBucket(action.action_bucket || '') || action.action_bucket || '기타 실행'}
								</div>
							</div>
							{action.expected_effect ? (
								<div style={{ marginTop: 6, fontSize: 12, color: '#86efac' }}>기대 효과: {action.expected_effect}</div>
							) : null}
							{action.owner ? (
								<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>담당 축: {action.owner}</div>
							) : null}
							<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
								<button
									type="button"
									className="btn-ghost"
									onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/actions', action.action_bucket))}
								>
									실행 큐 보기
								</button>
								<button
									type="button"
									className="btn-ghost"
									onClick={() => navigate(buildAiOpsPathWithActionBucket('/analytics/ai/logs', action.action_bucket))}
								>
									검증 로그 보기
								</button>
								<button type="button" className="btn-ghost" onClick={() => navigate('/analytics/ai/policies')}>
									정책 센터 보기
								</button>
							</div>
						</AiOpsSurfacePanel>
					))}
				</div>
			)}
		</div>
	);
}
