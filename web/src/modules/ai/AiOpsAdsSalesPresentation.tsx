import React from 'react';

import type { OverinvestmentLearningSummary } from './AiOpsCommonTypes';
import { LearningSummaryDetails } from './AiOpsCenterDetails';

export function SalesDecisionExtraContent(props: {
	orderCount?: number | null;
	refundOrderCount?: number | null;
	refundRateLabel: string;
	learningSummary?: OverinvestmentLearningSummary | null;
}): JSX.Element {
	return (
		<>
			<div style={{ fontSize: 12, color: '#cbd5e1' }}>
				주문 {Number(props.orderCount ?? 0).toLocaleString()} / 환불주문 {Number(props.refundOrderCount ?? 0).toLocaleString()} / 환불률 {props.refundRateLabel}
			</div>
			<LearningSummaryDetails summary={props.learningSummary} />
		</>
	);
}

export function SalesOverinvestmentExtraContent(props: {
	adPurchaseConversions?: number | null;
	adSpendRatioLabel: string;
	learningSummary?: OverinvestmentLearningSummary | null;
}): JSX.Element {
	return (
		<>
			<div style={{ fontSize: 12, color: '#cbd5e1' }}>
				광고 구매전환 {Number(props.adPurchaseConversions ?? 0).toLocaleString()} / 광고비 비중 {props.adSpendRatioLabel}
			</div>
			<LearningSummaryDetails summary={props.learningSummary} />
		</>
	);
}
