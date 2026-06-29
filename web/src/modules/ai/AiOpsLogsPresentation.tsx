import React from 'react';

import {
	formatAiOpsLogsApprovalSummaryLine,
	formatAiOpsLogsVerificationSummaryLine,
	formatAiOpsOverinvestmentHighlightLine,
	formatAiOpsTopBucketSummaryLine,
} from './AiOpsPresentationText';

export function AiOpsLogsReportSummary(props: {
	approvalRate: number;
	approvedCount: number;
	rejectedCount: number;
	doneCount: number;
	improvementRate: number;
	verifiedCount: number;
	improvedCount: number;
	topBucket: string;
	topBucketCount: number;
}): JSX.Element {
	return (
		<div className="card" style={{ padding: 14 }}>
			<div className="card-title">운영 리포트 요약</div>
			<div className="card-caption" style={{ marginTop: 6 }}>
				최근 운영 결과를 승인율, 검증 개선율, 주요 실행 버킷 관점으로 압축해 보여줍니다.
			</div>
			<div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
				<div style={{ fontSize: 13, color: '#cbd5e1' }}>{formatAiOpsLogsApprovalSummaryLine(props.approvalRate, props.approvedCount, props.rejectedCount, props.doneCount)}</div>
				<div style={{ fontSize: 13, color: '#93c5fd' }}>{formatAiOpsLogsVerificationSummaryLine(props.improvementRate, props.verifiedCount, props.improvedCount)}</div>
				<div style={{ fontSize: 13, color: '#86efac' }}>{formatAiOpsTopBucketSummaryLine(props.topBucket, props.topBucketCount)}</div>
			</div>
		</div>
	);
}

export function AiOpsLogHighlights(props: {
	latestActionNote?: string | null;
	overinvestmentKeyword?: string | null;
	adCostLabel?: string;
	adSpendRatioLabel?: string;
}): JSX.Element {
	return (
		<>
			{props.latestActionNote ? (
				<div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>{props.latestActionNote}</div>
			) : null}
			{props.overinvestmentKeyword ? (
				<div style={{ marginTop: 8, fontSize: 12, color: '#fca5a5' }}>
					{formatAiOpsOverinvestmentHighlightLine(props.overinvestmentKeyword, props.adCostLabel, props.adSpendRatioLabel)}
				</div>
			) : null}
		</>
	);
}

export function AiOpsLogActionChips(props: {
	rulesTriggered?: string[];
	recommendedActions?: string[];
}): JSX.Element {
	return (
		<>
			{(props.rulesTriggered || []).map((rule) => (
				<span
					key={`rule:${rule}`}
					style={{
						fontSize: 12,
						padding: '4px 8px',
						borderRadius: 999,
						background: 'rgba(59,130,246,0.18)',
						color: '#bfdbfe',
					}}
				>
					{rule}
				</span>
			))}
			{(props.recommendedActions || []).map((action) => (
				<span
					key={`action:${action}`}
					style={{
						fontSize: 12,
						padding: '4px 8px',
						borderRadius: 999,
						background: 'rgba(34,197,94,0.18)',
						color: '#bbf7d0',
					}}
				>
					{action}
				</span>
			))}
		</>
	);
}
