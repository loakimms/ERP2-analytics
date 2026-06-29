import React from 'react';

import { getAiOpsLogPrimaryActionBucket } from '../../shared/domain/analyticsDomain';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import type { OverinvestmentLearningSummary } from './AiOpsCommonTypes';
import type { AiOpsActionItem } from './AiOpsActionTypes';
import type { AiOpsLogItem } from './AiOpsLogTypes';
import { formatCount, formatPercent01 } from './AiOpsCenterUtils';

type PolicyComparePayload = {
	currentPolicyPackId: string;
	currentPolicyType: string;
	currentAction: string;
	targetPolicyPackTitle: string;
	targetPolicyType: string;
	targetAction: string;
	targetRecommendationScore: number;
	targetRecommendationReason: string;
	approvalRecommendation: string;
	approvalRecommendationReason: string;
	changedFields: string[];
};

function extractPolicyComparePayload(
	payload: Record<string, any>,
	options?: {
		approvalRecommendation?: string | null;
		approvalRecommendationReason?: string | null;
	},
): PolicyComparePayload {
	return {
		currentPolicyPackId: String(payload.current_policy_pack_id || '').trim(),
		currentPolicyType: String(payload.current_policy_type || '').trim(),
		currentAction: String(payload.current_recommended_action || '').trim(),
		targetPolicyPackTitle: String(payload.target_policy_pack_title || payload.target_policy_pack_id || '').trim(),
		targetPolicyType: String(payload.target_policy_type || '').trim(),
		targetAction: String(payload.target_recommended_action || '').trim(),
		targetRecommendationScore: Number(payload.target_recommendation_score ?? 0),
		targetRecommendationReason: String(payload.target_recommendation_reason || '').trim(),
		approvalRecommendation: String(options?.approvalRecommendation || payload.approval_recommendation || '').trim(),
		approvalRecommendationReason: String(options?.approvalRecommendationReason || payload.approval_recommendation_reason || '').trim(),
		changedFields: Array.isArray(payload.changed_fields)
			? payload.changed_fields.map((value) => String(value || '').trim()).filter(Boolean)
			: [],
	};
}

function PolicyCompareDetailsCard(props: {
	label?: string;
	payload: PolicyComparePayload;
	showRecommendationDetails?: boolean;
}): JSX.Element {
	return (
		<div
			style={{
				marginTop: 10,
				padding: 10,
				borderRadius: 8,
				background: 'rgba(30,41,59,0.55)',
				border: '1px solid rgba(148,163,184,0.18)',
			}}
		>
			{props.label ? <div style={{ fontSize: 12, color: '#fcd34d' }}>{props.label}</div> : null}
			<div style={{ marginTop: props.label ? 6 : 0, fontSize: 12, color: '#fcd34d' }}>
				현재 정책팩 {props.payload.currentPolicyPackId || '-'} · {props.payload.currentPolicyType || '-'}
			</div>
			<div style={{ marginTop: 4, fontSize: 12, color: '#93c5fd' }}>
				대상 정책팩 {props.payload.targetPolicyPackTitle || '-'} · {props.payload.targetPolicyType || '-'}
			</div>
			<div style={{ marginTop: 6, fontSize: 12, color: '#cbd5e1' }}>현재 액션: {props.payload.currentAction || '-'}</div>
			<div style={{ marginTop: 4, fontSize: 12, color: '#86efac' }}>대상 액션: {props.payload.targetAction || '-'}</div>
			{props.showRecommendationDetails && props.payload.targetRecommendationScore > 0 ? (
				<div style={{ marginTop: 4, fontSize: 12, color: '#fcd34d' }}>
					추천 점수 {props.payload.targetRecommendationScore.toLocaleString()}
				</div>
			) : null}
			{props.showRecommendationDetails && props.payload.targetRecommendationReason ? (
				<div style={{ marginTop: 4, fontSize: 12, color: '#cbd5e1' }}>추천 근거: {props.payload.targetRecommendationReason}</div>
			) : null}
			{props.showRecommendationDetails && props.payload.approvalRecommendation ? (
				<div style={{ marginTop: 4, fontSize: 12, color: '#93c5fd' }}>승인 추천 {props.payload.approvalRecommendation}</div>
			) : null}
			{props.showRecommendationDetails && props.payload.approvalRecommendationReason ? (
				<div style={{ marginTop: 4, fontSize: 12, color: '#94a3b8' }}>{props.payload.approvalRecommendationReason}</div>
			) : null}
			{props.payload.changedFields.length ? (
				<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>변경 필드: {props.payload.changedFields.join(', ')}</div>
			) : null}
		</div>
	);
}

function DetailSummaryCard(props: {
	title: string;
	titleColor?: string;
	background?: string;
	children: React.ReactNode;
}): JSX.Element {
	return (
		<div
			style={{
				marginTop: 10,
				padding: 10,
				borderRadius: 8,
				background: props.background || 'rgba(15,23,42,0.42)',
				border: '1px solid rgba(148,163,184,0.18)',
			}}
		>
			<div style={{ fontSize: 12, color: props.titleColor || '#fcd34d', fontWeight: 700 }}>{props.title}</div>
			<div style={{ marginTop: 6 }}>{props.children}</div>
		</div>
	);
}

function signedNumber(value: number | null | undefined, digits = 0): string {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n)) return '0';
	return n.toLocaleString(undefined, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
		signDisplay: 'exceptZero',
	});
}

function signedPercent01(value: number | null | undefined): string {
	const n = Number(value ?? 0);
	if (!Number.isFinite(n)) return '0%';
	const scaled = Math.round(n * 100);
	return `${scaled > 0 ? '+' : scaled < 0 ? '-' : ''}${Math.abs(scaled).toLocaleString()}%`;
}

type VerificationMetrics = NonNullable<AiOpsActionItem['verification']>['metrics'];

type VerificationMetricLine = {
	id: string;
	text: string;
	marginTop: number;
};

function hasValue(value: number | null | undefined): boolean {
	return value != null;
}

function buildVerificationMetricLines(metrics: VerificationMetrics | undefined): VerificationMetricLine[] {
	if (!metrics) {
		return [];
	}

	const lines: VerificationMetricLine[] = [];
	const hasDecisionMetrics =
		hasValue(metrics.sales_growth_delta) ||
		hasValue(metrics.organic_strength_delta) ||
		hasValue(metrics.review_risk_delta) ||
		hasValue(metrics.qna_barrier_delta);
	const hasAdSalesMetrics = hasValue(metrics.net_amount_delta) || hasValue(metrics.ad_spend_ratio_delta);
	const hasAdKeywordMetrics =
		(hasValue(metrics.purchase_conversions_delta) || hasValue(metrics.purchase_revenue_delta) || hasValue(metrics.ad_cost_delta) || hasValue(metrics.ad_roas_delta)) &&
		!hasAdSalesMetrics;

	if (hasDecisionMetrics) {
		lines.push({
			id: 'decision-primary',
			text: `매출성장 ${Number(metrics.sales_growth_delta ?? 0).toLocaleString()} · 오가닉 ${Number(metrics.organic_strength_delta ?? 0).toLocaleString()}`,
			marginTop: 6,
		});
		lines.push({
			id: 'decision-secondary',
			text: `리뷰리스크 ${Number(metrics.review_risk_delta ?? 0).toLocaleString()} · Q&A장벽 ${Number(metrics.qna_barrier_delta ?? 0).toLocaleString()}`,
			marginTop: 4,
		});
	}

	if (hasAdSalesMetrics) {
		lines.push({
			id: 'ad-sales-primary',
			text: `순매출 ${signedNumber(metrics.net_amount_delta)} · 광고비 비중 ${signedPercent01(metrics.ad_spend_ratio_delta)}`,
			marginTop: 4,
		});
		lines.push({
			id: 'ad-sales-secondary',
			text: `광고비 ${signedNumber(metrics.ad_cost_delta)} · 광고ROAS ${signedNumber(metrics.ad_roas_delta, 1)}`,
			marginTop: 4,
		});
	}

	if (hasAdKeywordMetrics) {
		lines.push({
			id: 'ad-keyword-primary',
			text: `광고비 ${signedNumber(metrics.ad_cost_delta)} · 구매전환 ${signedNumber(metrics.purchase_conversions_delta)}`,
			marginTop: 4,
		});
		lines.push({
			id: 'ad-keyword-secondary',
			text: `광고매출 ${signedNumber(metrics.purchase_revenue_delta)} · 광고ROAS ${signedNumber(metrics.ad_roas_delta, 1)}`,
			marginTop: 4,
		});
	}

	return lines;
}

export function LogAuditSummary(props: { item: AiOpsLogItem }): JSX.Element {
	const actionBucket = getAiOpsLogPrimaryActionBucket(props.item);
	const verificationLabel = String(props.item.latest_action_verification?.label || props.item.latest_action_verification?.status || '미검증').trim();
	const ruleCount = Array.isArray(props.item.rules_triggered) ? props.item.rules_triggered.length : 0;
	const recommendedActionCount = Array.isArray(props.item.recommended_actions) ? props.item.recommended_actions.length : 0;
	return (
		<DetailSummaryCard title="감사 요약" titleColor="#93c5fd" background="rgba(2,6,23,0.28)">
			<div style={{ fontSize: 12, color: '#cbd5e1' }}>
				버킷 {labelAiOpsActionBucket(actionBucket)} · 검증 상태 {verificationLabel} · 정책팩 {props.item.policy_pack_id || 'AI_OPS'} · 룰{' '}
				{formatCount(ruleCount, '개')} · 추천 액션 {formatCount(recommendedActionCount, '개')}
			</div>
		</DetailSummaryCard>
	);
}

export function LearningSummaryDetails(props: {
	summary?: OverinvestmentLearningSummary | null;
}): JSX.Element | null {
	const summary = props.summary;
	if (!summary || Number(summary.verified_count ?? 0) <= 0) {
		return null;
	}
	const hasAdKeywordMetrics =
		summary.avg_purchase_conversions_delta != null ||
		summary.avg_purchase_revenue_delta != null ||
		summary.avg_roas_delta != null ||
		summary.avg_cost_delta != null;
	return (
		<>
			<div style={{ marginTop: 6, fontSize: 12, color: '#fca5a5' }}>
				검증 {formatCount(summary.verified_count, '건')} / 개선율 {formatPercent01(summary.improvement_rate)}
			</div>
			{hasAdKeywordMetrics ? (
				<div style={{ marginTop: 4, fontSize: 12, color: '#fca5a5' }}>
					평균 구매전환 {signedNumber(summary.avg_purchase_conversions_delta)} / 평균 ROAS {signedNumber(summary.avg_roas_delta, 1)}
				</div>
			) : (
				<div style={{ marginTop: 4, fontSize: 12, color: '#fca5a5' }}>
					평균 광고비 비중 {signedNumber(Number(summary.avg_ad_spend_ratio_delta ?? 0) * 100)}% / 평균 순매출 {signedNumber(summary.avg_net_amount_delta)}
				</div>
			)}
		</>
	);
}

export function ActionQueueDiffDetails(props: { item: AiOpsActionItem }): JSX.Element | null {
	const payload = props.item.payload ?? {};
	if (String(props.item.action_type || '').trim() !== 'QUEUE_POLICY_COMPARE_ACTION') {
		return null;
	}
	return (
		<PolicyCompareDetailsCard
			payload={extractPolicyComparePayload(payload, {
				approvalRecommendation: props.item.approval_recommendation,
				approvalRecommendationReason: props.item.approval_recommendation_reason,
			})}
			showRecommendationDetails
		/>
	);
}

export function ActionDiffDetails(props: {
	actionType?: string | null;
	payload?: Record<string, any> | null;
	label?: string;
}): JSX.Element | null {
	const payload = props.payload ?? {};
	if (String(props.actionType || '').trim() !== 'QUEUE_POLICY_COMPARE_ACTION') {
		return null;
	}
	return <PolicyCompareDetailsCard label={props.label || '정책 비교 액션'} payload={extractPolicyComparePayload(payload)} />;
}

export function ActionVerificationDetails(props: {
	verification?: AiOpsActionItem['verification'];
}): JSX.Element | null {
	const verification = props.verification;
	if (!verification || !String(verification.status || '').trim()) {
		return null;
	}
	const metricLines = buildVerificationMetricLines(verification.metrics);
	return (
		<DetailSummaryCard title={`${verification.label || '검증 상태'} · 판정 ${verification.outcome || 'UNKNOWN'}`}>
			<div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
				기준 {verification.baseline_date || '-'} / 최신 {verification.latest_date || '-'}
			</div>
			{metricLines.map((line) => (
				<div key={line.id} style={{ marginTop: line.marginTop, fontSize: 12, color: '#cbd5e1' }}>
					{line.text}
				</div>
			))}
		</DetailSummaryCard>
	);
}
