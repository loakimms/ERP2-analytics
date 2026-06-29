import { buildAiOpsPathWithActionBucket, buildAiOpsSourceEvidencePath } from '../../shared/navigation/analyticsNavigation';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import type { AiOpsDecisionCard, AiOpsDecisionCardLink, AiOpsDecisionCardMetric } from './AiOpsDecisionCardTypes';

export function formatInteger(value: number | null | undefined): string {
	return Math.round(Number(value ?? 0) || 0).toLocaleString();
}

export function formatPercentRounded(value: number | null | undefined): string {
	const n = Number(value ?? NaN);
	if (!Number.isFinite(n)) return '0%';
	return `${Math.round(n * 100).toLocaleString()}%`;
}

export function formatCountLabel(value: number | null | undefined, suffix: string): string {
	return `${formatInteger(value)}${suffix}`;
}

export function buildApprovalLine(recommendation?: string | null, reason?: string | null): string | null {
	const value = String(recommendation || '').trim();
	const detail = String(reason || '').trim();
	if (!value && !detail) return null;
	if (!value) return detail;
	if (!detail) return `승인 추천 ${value}`;
	return `승인 추천 ${value} · ${detail}`;
}

export function trimmedText(value: unknown): string {
	return String(value ?? '').trim();
}

export function fallbackText(value: unknown, fallback: string): string {
	return trimmedText(value) || fallback;
}

export function buildActionBucketMeta(actionBucket: string): Pick<AiOpsDecisionCard, 'actionBucket' | 'actionBucketLabel'> {
	return {
		actionBucket,
		actionBucketLabel: labelAiOpsActionBucket(actionBucket),
	};
}

export function buildDecisionLinks(args: {
	source: AiOpsDecisionCardLink;
	actionBucket?: string | null;
	queueLabel?: string;
	logsLabel?: string;
	queuePath?: string;
	logsPath?: string;
}): AiOpsDecisionCard['links'] {
	const actionBucket = trimmedText(args.actionBucket);
	return {
		source: args.source,
		queue: {
			label: args.queueLabel || '실행 큐 보기',
			path: args.queuePath || buildAiOpsPathWithActionBucket('/analytics/ai/actions', actionBucket),
		},
		logs: {
			label: args.logsLabel || '검증 로그 보기',
			path: args.logsPath || buildAiOpsPathWithActionBucket('/analytics/ai/logs', actionBucket),
		},
	};
}

export function buildEvidenceDecisionLinks(args: {
	productName?: string | null;
	keyword?: string | null;
	actionBucket?: string | null;
	policyType?: string | null;
	topIssue?: string | null;
	recommendedAction?: string | null;
	fromYmd: string;
	toYmd: string;
	sourceAriaLabel?: string;
	queueLabel?: string;
	logsLabel?: string;
	queuePath?: string;
	logsPath?: string;
}): AiOpsDecisionCard['links'] {
	const source = buildAiOpsSourceEvidencePath({
		productName: args.productName,
		keyword: args.keyword,
		actionBucket: args.actionBucket,
		policyType: args.policyType,
		topIssue: args.topIssue,
		recommendedAction: args.recommendedAction,
		fromYmd: args.fromYmd,
		toYmd: args.toYmd,
	});

	return buildDecisionLinks({
		source: {
			label: source.label,
			path: source.path,
			ariaLabel: args.sourceAriaLabel,
		},
		actionBucket: args.actionBucket,
		queueLabel: args.queueLabel,
		logsLabel: args.logsLabel,
		queuePath: args.queuePath,
		logsPath: args.logsPath,
	});
}

export function metric(label: string, value: string, tone: AiOpsDecisionCardMetric['tone']): AiOpsDecisionCardMetric {
	return { label, value, tone };
}

export function buildAdsEntityId(campaignName?: string | null, adgroupName?: string | null, keyword?: string | null): string {
	return [campaignName, adgroupName, keyword].map((value) => trimmedText(value)).join('::');
}
