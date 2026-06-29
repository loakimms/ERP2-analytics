import {
	buildAiOpsPathWithActionBucket,
	buildAiOpsSourceEvidencePath,
	normalizeActionBucket,
} from '../../shared/navigation/analyticsNavigation';
import { labelAiOpsActionBucket } from '../../shared/presentation/analyticsLabels';
import type {
	AiOpsAdsBudgetItem,
	AiOpsAdsCannibalizationItem,
	AiOpsAdsItem,
	AiOpsSalesItem,
	AiOpsSalesOverinvestmentItem,
} from './AiOpsAdsSalesTypes';
import type { AiOpsActionItem } from './AiOpsActionTypes';
import type {
	AiOpsAdsBudgetDecisionCard,
	AiOpsAdsCannibalizationDecisionCard,
	AiOpsAdsDecisionCard,
	AiOpsDecisionCard,
	AiOpsQnaDecisionCard,
	AiOpsReviewDecisionCard,
	AiOpsSalesDecisionCard,
	AiOpsSalesOverinvestmentDecisionCard,
} from './AiOpsDecisionCardTypes';
import {
	buildActionBucketMeta,
	buildAdsEntityId,
	buildApprovalLine,
	buildDecisionLinks,
	buildEvidenceDecisionLinks,
	fallbackText,
	formatCountLabel,
	formatInteger,
	formatPercentRounded,
	metric,
	trimmedText,
} from './AiOpsDecisionCardMapperUtils';
import type { AiOpsHomeItem } from './AiOpsHomeTypes';
import type { AiOpsLogItem } from './AiOpsLogTypes';
import type { AiOpsProductItem } from './AiOpsProductTypes';
import type { AiOpsQnaProductItem, AiOpsReviewProductItem } from './AiOpsQualitativeTypes';

type EvidenceDateRange = {
	fromYmd: string;
	toYmd: string;
};

export function mapHomeItemToDecisionCard(item: AiOpsHomeItem, evidenceDateRange: EvidenceDateRange): AiOpsDecisionCard {
	const entityId = fallbackText(item.sku_id, 'unknown');
	const title = fallbackText(item.product_name, entityId || '이름 없는 SKU');
	const actionBucket = normalizeActionBucket(item.action_bucket);
	const source = buildAiOpsSourceEvidencePath({
		productName: item.product_name,
		actionBucket: item.action_bucket,
		policyType: item.policy_type,
		topIssue: item.top_issue,
		recommendedAction: item.recommended_action_primary,
		fromYmd: evidenceDateRange.fromYmd,
		toYmd: evidenceDateRange.toYmd,
	});

	return {
		id: `${entityId}:${title}`,
		domain: 'home',
		entityType: 'sku',
		entityId,
		title,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: actionBucket || trimmedText(item.policy_type) || '정책 미분류',
		policyLabel: trimmedText(item.policy_type),
		summary: fallbackText(item.top_issue, '주요 이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action_primary, '추가 판단 필요'),
		effectivePriorityScore: Number(item.effective_priority_score ?? item.priority_score ?? 0),
		priorityReason: item.priority_reason || null,
		metrics: [
			metric('유효 우선순위', formatInteger(item.effective_priority_score ?? item.priority_score ?? 0), 'warn'),
			metric('기준 우선순위', formatInteger(item.priority_score ?? 0), 'neutral'),
		],
		links: buildDecisionLinks({
			source: {
				...source,
				ariaLabel: `home-item-source-${entityId}`,
			},
			actionBucket,
		}),
		raw: item,
	};
}

export function mapProductItemToDecisionCard(item: AiOpsProductItem, evidenceDateRange: EvidenceDateRange): AiOpsDecisionCard {
	const entityId = fallbackText(item.sku_id, 'unknown');
	const title = fallbackText(item.product_name, entityId || '이름 없는 SKU');
	const actionBucket = normalizeActionBucket(item.policy_type);
	const source = buildAiOpsSourceEvidencePath({
		productName: item.product_name,
		productUrl: item.product_url,
		policyType: item.policy_type,
		topIssue: item.top_issue,
		recommendedAction: item.recommended_action_primary,
		fromYmd: evidenceDateRange.fromYmd,
		toYmd: evidenceDateRange.toYmd,
	});

	return {
		id: `products:${entityId}`,
		domain: 'products',
		entityType: 'sku',
		entityId,
		title,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: trimmedText(item.policy_type) || '정책 미분류',
		contextLine: `정책팩 ${fallbackText(item.policy_pack_id, 'AI_OPS')}`,
		summary: fallbackText(item.top_issue, '주요 이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action_primary, '추가 판단 필요'),
		effectivePriorityScore: Number(item.priority_score ?? 0),
		metrics: [
			metric('우선순위', formatPercentRounded(Number(item.priority_score ?? 0) / 100), 'warn'),
			metric('신뢰도', formatPercentRounded(item.confidence_score), 'good'),
			metric('데이터 품질', formatPercentRounded(item.data_quality_score), 'good'),
		],
		links: buildDecisionLinks({
			source: {
				label: source.label,
				path: source.path,
				ariaLabel: `product-item-source-${entityId}`,
			},
			queuePath: '/analytics/ai/actions',
			logsPath: '/analytics/ai/logs',
		}),
		raw: item,
	};
}

export function mapSalesItemToDecisionCard(item: AiOpsSalesItem): AiOpsSalesDecisionCard {
	const entityId = fallbackText(item.product_id, 'unknown');
	const title = fallbackText(item.product_name, `상품 ${entityId}`);
	const actionBucket = normalizeActionBucket(item.action_bucket);
	const priority = fallbackText(item.priority, 'P3');
	const category = trimmedText(item.category_large);

	return {
		id: `sales:${entityId}:${actionBucket || priority}`,
		domain: 'sales',
		entityType: 'product',
		entityId,
		title,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: `${actionBucket || 'UNKNOWN'} · ${priority}`,
		contextLine: `상품 ID ${entityId || '-'}${category ? ` / 카테고리 ${category}` : ''}`,
		summary: fallbackText(item.top_issue, '이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action, '액션 없음'),
		effectivePriorityScore: null,
		approvalLine: buildApprovalLine(item.approval_recommendation, item.approval_recommendation_reason),
		learningSummary: item.learning_summary ?? null,
		metrics: [
			metric('총매출', formatInteger(item.amount ?? 0), 'neutral'),
			metric('환불', formatInteger(item.refund_amount ?? 0), 'warn'),
			metric('순매출', formatInteger(item.net_amount ?? 0), 'good'),
			metric('환불률', formatPercentRounded(item.refund_ratio), 'warn'),
		],
		links: buildDecisionLinks({
			source: { label: '판매 대시보드 열기', path: '/analytics/sales/dashboard' },
			actionBucket,
		}),
		raw: item,
	};
}

export function mapSalesOverinvestmentItemToDecisionCard(item: AiOpsSalesOverinvestmentItem): AiOpsSalesOverinvestmentDecisionCard {
	const entityId = fallbackText(item.product_id, 'unknown');
	const title = fallbackText(item.product_name, `상품 ${entityId}`);
	const actionBucket = normalizeActionBucket(item.action_bucket);
	const priority = fallbackText(item.priority, 'P3');
	const keyword = trimmedText(item.keyword);

	return {
		id: `sales-overinvestment:${entityId}:${keyword || actionBucket || priority}`,
		domain: 'sales',
		entityType: 'product',
		entityId,
		title,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: `${actionBucket || 'UNKNOWN'} · ${priority}`,
		contextLine: `상품 ID ${entityId || '-'} / 대표 키워드 ${keyword || '-'}`,
		summary: fallbackText(item.top_issue, '이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action, '액션 없음'),
		effectivePriorityScore: null,
		approvalLine: buildApprovalLine(item.approval_recommendation, item.approval_recommendation_reason),
		learningSummary: item.learning_summary ?? null,
		metrics: [
			metric('순매출', formatInteger(item.net_amount ?? 0), 'good'),
			metric('광고비', formatInteger(item.ad_cost ?? 0), 'warn'),
			metric('광고 ROAS', formatInteger(item.ad_roas ?? 0), 'neutral'),
			metric('광고비 비중', formatPercentRounded(item.ad_spend_ratio), 'warn'),
		],
		links: buildDecisionLinks({
			source: { label: '광고 운영 판단 열기', path: buildAiOpsPathWithActionBucket('/analytics/ai/ads', actionBucket) },
			actionBucket,
		}),
		raw: item,
	};
}

export function mapAdsItemToDecisionCard(item: AiOpsAdsItem): AiOpsAdsDecisionCard {
	const campaignName = trimmedText(item.campaign_name);
	const adgroupName = trimmedText(item.adgroup_name);
	const keyword = fallbackText(item.keyword, '이름 없는 키워드');
	const actionBucket = normalizeActionBucket(item.action_bucket);
	const priority = fallbackText(item.priority, 'P3');
	const entityId = buildAdsEntityId(campaignName, adgroupName, keyword);

	return {
		id: `ads:${entityId || keyword}`,
		domain: 'ads',
		entityType: 'keyword',
		entityId,
		title: keyword,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: `${actionBucket || 'UNKNOWN'} · ${priority}`,
		contextLine: `캠페인 ${campaignName || '-'} / 그룹 ${adgroupName || '-'}`,
		summary: fallbackText(item.top_issue, '이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action, '액션 없음'),
		effectivePriorityScore: null,
		approvalLine: buildApprovalLine(item.approval_recommendation, item.approval_recommendation_reason),
		metrics: [
			metric('비용', formatInteger(item.cost ?? 0), 'warn'),
			metric('클릭', formatInteger(item.clicks ?? 0), 'neutral'),
			metric('구매전환', formatInteger(item.purchase_conversions ?? 0), 'warn'),
			metric('ROAS', formatInteger(item.roas ?? 0), 'neutral'),
		],
		links: buildDecisionLinks({
			source: { label: '광고 검색어 분석 열기', path: '/analytics/performance/ads-keywords' },
			actionBucket,
		}),
		raw: item,
	};
}

export function mapAdsCannibalizationItemToDecisionCard(item: AiOpsAdsCannibalizationItem): AiOpsAdsCannibalizationDecisionCard {
	const campaignName = trimmedText(item.campaign_name);
	const adgroupName = trimmedText(item.adgroup_name);
	const keyword = fallbackText(item.keyword, '이름 없는 키워드');
	const actionBucket = normalizeActionBucket(item.action_kind);
	const priority = fallbackText(item.priority, 'P3');
	const organicRank = Math.round(Number(item.organic_rank ?? 0) || 0);
	const entityId = buildAdsEntityId(campaignName, adgroupName, keyword);

	return {
		id: `ads-cannibalization:${entityId || keyword}`,
		domain: 'ads',
		entityType: 'keyword',
		entityId,
		title: keyword,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: `오가닉 ${organicRank.toLocaleString()}위 · ${priority}`,
		summary: fallbackText(item.top_issue, '이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action, '액션 없음'),
		effectivePriorityScore: null,
		approvalLine: buildApprovalLine(item.approval_recommendation, item.approval_recommendation_reason),
		learningSummary: item.learning_summary ?? null,
		metrics: [
			metric('비용', formatInteger(item.cost ?? 0), 'warn'),
			metric('ROAS', formatInteger(item.roas ?? 0), 'neutral'),
		],
		links: buildDecisionLinks({
			source: { label: '광고 검색어 분석 열기', path: '/analytics/performance/ads-keywords' },
			actionBucket,
		}),
		raw: item,
	};
}

export function mapAdsBudgetItemToDecisionCard(item: AiOpsAdsBudgetItem): AiOpsAdsBudgetDecisionCard {
	const campaignName = trimmedText(item.campaign_name);
	const adgroupName = trimmedText(item.adgroup_name);
	const keyword = fallbackText(item.keyword, '이름 없는 키워드');
	const actionBucket = normalizeActionBucket(item.action_kind);
	const priority = fallbackText(item.priority, 'P3');
	const budgetDirection = fallbackText(item.budget_direction, 'HOLD');
	const entityId = buildAdsEntityId(campaignName, adgroupName, keyword);

	return {
		id: `ads-budget:${entityId || keyword}:${actionBucket || budgetDirection}`,
		domain: 'ads',
		entityType: 'keyword',
		entityId,
		title: keyword,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: `${budgetDirection} · ${priority}`,
		summary: fallbackText(item.top_issue, '이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action, '액션 없음'),
		effectivePriorityScore: null,
		approvalLine: buildApprovalLine(item.approval_recommendation, item.approval_recommendation_reason),
		learningSummary: item.learning_summary ?? null,
		metrics: [
			metric('비용', formatInteger(item.cost ?? 0), 'warn'),
			metric('ROAS', formatInteger(item.roas ?? 0), 'neutral'),
		],
		links: buildDecisionLinks({
			source: { label: '광고 검색어 분석 열기', path: '/analytics/performance/ads-keywords' },
			actionBucket,
		}),
		raw: item,
	};
}

export function mapReviewItemToDecisionCard(item: AiOpsReviewProductItem): AiOpsReviewDecisionCard {
	const entityId = fallbackText(item.sku_id, 'unknown');
	const title = fallbackText(item.product_name, entityId || '이름 없는 SKU');
	const actionBucket = normalizeActionBucket(item.action_bucket);

	return {
		id: `reviews:${entityId}:${actionBucket || 'default'}`,
		domain: 'reviews',
		entityType: 'sku',
		entityId,
		title,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: labelAiOpsActionBucket(actionBucket),
		summary: fallbackText(item.top_issue, '주요 VOC 이슈 없음'),
		recommendedAction: fallbackText(item.recommended_action_primary, 'VOC 개선'),
		effectivePriorityScore: null,
		metrics: [
			metric('부정 리뷰', formatCountLabel(item.negative_review_count, '개'), 'warn'),
			metric('부정 비율', formatPercentRounded(item.negative_review_ratio), 'warn'),
		],
		links: buildDecisionLinks({
			source: { label: '리뷰 분석 열기', path: '/analytics/reviews/review-analysis' },
			actionBucket,
			queueLabel: '관련 실행 큐 보기',
			logsLabel: '관련 검증 로그 보기',
		}),
		raw: item,
	};
}

export function mapActionItemToDecisionCard(item: AiOpsActionItem, evidenceDateRange: EvidenceDateRange): AiOpsDecisionCard {
	const queueId = fallbackText(item.queue_id, 'unknown-action');
	const title = fallbackText(item.payload?.title || item.action_type, '이름 없는 액션');
	const actionBucket = normalizeActionBucket((item.payload?.action_bucket as string | null | undefined) || (item.payload?.action_kind as string | null | undefined));

	return {
		id: `actions:${queueId}`,
		domain: 'actions',
		entityType: 'action',
		entityId: queueId,
		title,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: fallbackText(item.status, 'UNKNOWN'),
		contextLine: `대상 ${fallbackText(item.entity_id, '-')} · 우선순위 ${fallbackText(item.priority, '-')}`,
		summary: fallbackText(item.action_type, '액션 상세 없음'),
		recommendedAction: title,
		effectivePriorityScore: null,
		approvalLine: buildApprovalLine(
			item.approval_recommendation ? `워크플로우 가이드: ${item.approval_recommendation}` : null,
			item.approval_recommendation_reason,
		),
		metrics: [],
		links: buildEvidenceDecisionLinks({
			productName: trimmedText(item.payload?.product_name) || trimmedText(item.entity_id),
			keyword: trimmedText(item.payload?.keyword),
			actionBucket,
			policyType: trimmedText(item.payload?.policy_type),
			topIssue: trimmedText(item.payload?.top_issue),
			recommendedAction: trimmedText(item.payload?.title),
			fromYmd: evidenceDateRange.fromYmd,
			toYmd: evidenceDateRange.toYmd,
			sourceAriaLabel: `action-item-source-${queueId}`,
		}),
		raw: item,
	};
}

export function mapLogItemToDecisionCard(item: AiOpsLogItem, evidenceDateRange: EvidenceDateRange): AiOpsDecisionCard {
	const entityId = fallbackText(item.sku_id, 'unknown');
	const actionBucket = normalizeActionBucket(
		(item.latest_action_payload?.action_bucket as string | null | undefined) ||
			(item.latest_action_payload?.action_kind as string | null | undefined),
	);
	const salesEvidence = (item.evidence?.sales as Record<string, any> | undefined) ?? {};
	const overinvestment = (salesEvidence.ad_overinvestment as Record<string, any> | undefined) ?? {};
	const overinvestmentKeyword = trimmedText(overinvestment.keyword);

	return {
		id: `logs:${entityId}:${String(item.date || '').trim()}`,
		domain: 'logs',
		entityType: 'sku',
		entityId,
		title: fallbackText(item.product_name, entityId || '이름 없는 SKU'),
		...buildActionBucketMeta(actionBucket),
		badgeLabel: fallbackText(item.latest_action_status, 'NO_ACTION'),
		contextLine: `SKU ${entityId || '-'}`,
		summary: fallbackText(item.analysis_text || item.top_issue, '설명 로그 없음'),
		recommendedAction: (Array.isArray(item.recommended_actions) && item.recommended_actions[0]) || fallbackText(item.latest_action_payload?.title, '후속 판단 필요'),
		effectivePriorityScore: null,
		approvalLine:
			item.policy_type || item.confidence_score != null
				? `정책 ${fallbackText(item.policy_type, '-')} · 신뢰도 ${formatPercentRounded(item.confidence_score)}`
				: null,
		metrics: [metric('신뢰도', formatPercentRounded(item.confidence_score), 'good')],
		links: buildEvidenceDecisionLinks({
			productName: item.product_name,
			keyword: trimmedText(item.latest_action_payload?.keyword) || overinvestmentKeyword,
			actionBucket,
			policyType: item.policy_type,
			topIssue: item.top_issue || item.analysis_text,
			recommendedAction: (Array.isArray(item.recommended_actions) && item.recommended_actions[0]) || trimmedText(item.latest_action_payload?.title),
			fromYmd: evidenceDateRange.fromYmd,
			toYmd: evidenceDateRange.toYmd,
			sourceAriaLabel: `log-item-source-${entityId}`,
		}),
		raw: item,
	};
}

export function mapQnaItemToDecisionCard(item: AiOpsQnaProductItem): AiOpsQnaDecisionCard {
	const entityId = fallbackText(item.sku_id, 'unknown');
	const title = fallbackText(item.product_name, entityId || '이름 없는 SKU');
	const actionBucket = normalizeActionBucket(item.action_bucket);

	return {
		id: `qna:${entityId}:${actionBucket || 'default'}`,
		domain: 'qna',
		entityType: 'sku',
		entityId,
		title,
		...buildActionBucketMeta(actionBucket),
		badgeLabel: labelAiOpsActionBucket(actionBucket),
		summary: fallbackText(item.top_issue, '주요 전환 장벽 없음'),
		recommendedAction: fallbackText(item.recommended_action_primary, 'FAQ 등록'),
		effectivePriorityScore: null,
		metrics: [
			metric('FAQ 공백', formatCountLabel(item.faq_gap_count, '건'), 'warn'),
			metric('구매 직전 문의 비중', formatPercentRounded(item.prepurchase_question_ratio), 'warn'),
		],
		links: buildDecisionLinks({
			source: { label: 'Q&A 분석 열기', path: '/analytics/reviews/qna-analysis' },
			actionBucket,
			queueLabel: '관련 실행 큐 보기',
			logsLabel: '관련 검증 로그 보기',
		}),
		raw: item,
	};
}
