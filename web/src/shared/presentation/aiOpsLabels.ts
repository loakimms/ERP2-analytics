export function labelAiOpsActionBucket(bucket?: string | null): string {
	const key = String(bucket || '').trim().toUpperCase();
	if (key === 'FOCUS' || key === 'SALES_FOCUS') return '판매 집중';
	if (key === 'RISK_HOLD') return '확대 보류';
	if (key === 'LOW_CONTRIBUTION') return '과투입 점검';
	if (key === 'AD_OVERINVESTMENT') return '광고 과투입 점검';
	if (key === 'BUDGET_INCREASE') return '예산 증액';
	if (key === 'BUDGET_DECREASE') return '예산 감액';
	if (key === 'VOC_IMPROVEMENT') return '리뷰 개선';
	if (key === 'FAQ_CONTENT_IMPROVEMENT') return 'FAQ 보강';
	return key || '미분류';
}
