import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import { formatCount, formatPercent01, formatPercent100 } from './AiOpsCenterUtils';

export function formatAiOpsPolicyDistributionSummaryLine(avgPriorityScore?: number | null, topProductName?: string | null): string {
	return `평균 우선순위 ${formatPercent100(avgPriorityScore)} · 대표 SKU ${topProductName || '-'}`;
}

export function formatAiOpsLearningRateLine(prefix: string, verifiedCount?: number | null, improvementRate?: number | null): string {
	return `${prefix} ${formatCount(verifiedCount, '건')} / 개선율 ${formatPercent01(improvementRate)}`;
}

export function formatAiOpsAverageSalesGrowthLine(delta?: number | null): string {
	return `평균 매출성장 변화 ${Number(delta ?? 0).toLocaleString()}`;
}

export function formatAiOpsLogsApprovalSummaryLine(
	approvalRate: number,
	approvedCount: number,
	rejectedCount: number,
	doneCount: number,
): string {
	return `승인율 ${formatPercent01(approvalRate)} · 승인 ${formatCount(approvedCount, '건')} · 반려 ${formatCount(rejectedCount, '건')} · 완료 ${formatCount(doneCount, '건')}`;
}

export function formatAiOpsLogsVerificationSummaryLine(improvementRate: number, verifiedCount: number, improvedCount: number): string {
	return `검증 개선율 ${formatPercent01(improvementRate)} · 검증 ${formatCount(verifiedCount, '건')} · 개선 ${formatCount(improvedCount, '건')}`;
}

export function formatAiOpsTopBucketSummaryLine(topBucket: string, topBucketCount: number): string {
	return `주요 버킷 ${topBucket ? `${labelAiOpsActionBucket(topBucket)} ${formatCount(topBucketCount, '건')}` : '없음'}`;
}

export function formatAiOpsOverinvestmentHighlightLine(
	keyword?: string | null,
	adCostLabel?: string,
	adSpendRatioLabel?: string,
): string {
	return `광고 과투입 · 키워드 ${keyword || '-'} · 광고비 ${adCostLabel || '0'} · 광고비 비중 ${adSpendRatioLabel || '0%'}`;
}
