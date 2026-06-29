import { normalizeActionBucket } from '../navigation/analyticsNavigation';

export function actionTextMatchesAiOpsBucket(text: string | null | undefined, bucket: string): boolean {
	const normalizedText = String(text || '').trim();
	if (!normalizedText) return false;
	if (bucket === 'VOC_IMPROVEMENT') return normalizedText.includes('리뷰 개선');
	if (bucket === 'FAQ_CONTENT_IMPROVEMENT') return normalizedText.includes('FAQ 보강');
	if (bucket === 'FOCUS' || bucket === 'SALES_FOCUS') return normalizedText.includes('집중') || normalizedText.includes('판매 집중');
	if (bucket === 'RISK_HOLD') return normalizedText.includes('확대 보류');
	if (bucket === 'LOW_CONTRIBUTION') return normalizedText.includes('과투입 점검');
	if (bucket === 'AD_OVERINVESTMENT') return normalizedText.includes('광고 과투입');
	if (bucket === 'BUDGET_INCREASE') return normalizedText.includes('예산 증액') || normalizedText.includes('증액 테스트');
	if (bucket === 'BUDGET_DECREASE') return normalizedText.includes('예산 감액');
	if (bucket === 'CANNIBALIZATION_DECREASE') return normalizedText.includes('잠식 감액');
	return normalizedText.toUpperCase().includes(bucket);
}

export function inferAiOpsActionBucketFromTexts(texts: Array<string | null | undefined>): string {
	const knownBuckets = [
		'AD_OVERINVESTMENT',
		'BUDGET_INCREASE',
		'BUDGET_DECREASE',
		'CANNIBALIZATION_DECREASE',
		'VOC_IMPROVEMENT',
		'FAQ_CONTENT_IMPROVEMENT',
		'FOCUS',
		'RISK_HOLD',
		'LOW_CONTRIBUTION',
	];
	for (const bucket of knownBuckets) {
		if (texts.some((text) => actionTextMatchesAiOpsBucket(text, bucket))) {
			return bucket;
		}
	}
	return '';
}

type AiOpsLogLike = {
	latest_action_payload?: {
		action_bucket?: string | null | undefined;
		action_kind?: string | null | undefined;
		title?: string | null | undefined;
	} | null;
	recommended_actions?: Array<string | null | undefined> | null;
	evidence?: {
		sales?: {
			ad_overinvestment?: {
				keyword?: string | null | undefined;
			} | null;
		} | null;
	} | null;
};

export function getAiOpsLogPrimaryActionBucket(item: AiOpsLogLike): string {
	const payloadBucket = normalizeActionBucket(item.latest_action_payload?.action_bucket);
	if (payloadBucket) return payloadBucket;
	const payloadActionKind = normalizeActionBucket(item.latest_action_payload?.action_kind);
	if (payloadActionKind) return payloadActionKind;
	const titleBucket = inferAiOpsActionBucketFromTexts([item.latest_action_payload?.title]);
	if (titleBucket) return titleBucket;
	const recommendedBucket = inferAiOpsActionBucketFromTexts(
		(item.recommended_actions || []) as Array<string | null | undefined>,
	);
	if (recommendedBucket) return recommendedBucket;
	const overinvestmentKeyword = String(item.evidence?.sales?.ad_overinvestment?.keyword || '').trim();
	if (overinvestmentKeyword) return 'AD_OVERINVESTMENT';
	return '';
}

export function aiOpsLogMatchesActionBucket(item: AiOpsLogLike, actionBucket: string): boolean {
	const bucket = normalizeActionBucket(actionBucket);
	if (!bucket) return true;
	return getAiOpsLogPrimaryActionBucket(item) === bucket;
}
