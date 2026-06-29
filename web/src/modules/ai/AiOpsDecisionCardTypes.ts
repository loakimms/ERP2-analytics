import type {
	AiOpsAdsBudgetItem,
	AiOpsAdsCannibalizationItem,
	AiOpsAdsItem,
	AiOpsSalesItem,
	AiOpsSalesOverinvestmentItem,
} from './AiOpsAdsSalesTypes';
import type { AiOpsActionItem } from './AiOpsActionTypes';
import type { OverinvestmentLearningSummary } from './AiOpsCommonTypes';
import type { AiOpsHomeItem } from './AiOpsHomeTypes';
import type { AiOpsLogItem } from './AiOpsLogTypes';
import type { AiOpsProductItem } from './AiOpsProductTypes';
import type { AiOpsQnaProductItem, AiOpsReviewProductItem } from './AiOpsQualitativeTypes';

export type AiOpsDecisionCardMetricTone = 'neutral' | 'good' | 'warn' | 'bad';

export type AiOpsDecisionCardMetric = {
	label: string;
	value: string;
	tone: AiOpsDecisionCardMetricTone;
};

export type AiOpsDecisionCardLink = {
	label: string;
	path: string;
	ariaLabel?: string;
};

export type AiOpsDecisionCardRaw =
	| AiOpsHomeItem
	| AiOpsAdsItem
	| AiOpsAdsCannibalizationItem
	| AiOpsAdsBudgetItem
	| AiOpsSalesItem
	| AiOpsSalesOverinvestmentItem
	| AiOpsProductItem
	| AiOpsActionItem
	| AiOpsLogItem
	| AiOpsReviewProductItem
	| AiOpsQnaProductItem;

export type AiOpsDecisionCard<TRaw = AiOpsDecisionCardRaw> = {
	id: string;
	domain: 'home' | 'products' | 'sales' | 'reviews' | 'qna' | 'ads' | 'actions' | 'logs';
	entityType: 'sku' | 'product' | 'keyword' | 'action';
	entityId: string;
	title: string;
	actionBucket: string;
	actionBucketLabel: string;
	badgeLabel: string;
	policyLabel?: string;
	contextLine?: string;
	summary: string;
	recommendedAction: string;
	effectivePriorityScore?: number | null;
	priorityReason?: string | null;
	approvalLine?: string | null;
	learningSummary?: OverinvestmentLearningSummary | null;
	metrics: AiOpsDecisionCardMetric[];
	links: {
		source: AiOpsDecisionCardLink;
		queue: AiOpsDecisionCardLink;
		logs: AiOpsDecisionCardLink;
	};
	raw: TRaw;
};

export type AiOpsReviewDecisionCard = AiOpsDecisionCard<AiOpsReviewProductItem>;
export type AiOpsQnaDecisionCard = AiOpsDecisionCard<AiOpsQnaProductItem>;
export type AiOpsAdsDecisionCard = AiOpsDecisionCard<AiOpsAdsItem>;
export type AiOpsAdsCannibalizationDecisionCard = AiOpsDecisionCard<AiOpsAdsCannibalizationItem>;
export type AiOpsAdsBudgetDecisionCard = AiOpsDecisionCard<AiOpsAdsBudgetItem>;
export type AiOpsSalesDecisionCard = AiOpsDecisionCard<AiOpsSalesItem>;
export type AiOpsSalesOverinvestmentDecisionCard = AiOpsDecisionCard<AiOpsSalesOverinvestmentItem>;
