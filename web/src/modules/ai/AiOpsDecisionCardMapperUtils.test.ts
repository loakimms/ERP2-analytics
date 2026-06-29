import { describe, expect, it } from 'vitest';

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

describe('AiOpsDecisionCardMapperUtils', () => {
	it('숫자/비율/건수 포맷을 제공한다', () => {
		expect(formatInteger(1234.6)).toBe('1,235');
		expect(formatPercentRounded(0.876)).toBe('88%');
		expect(formatCountLabel(12, '건')).toBe('12건');
	});

	it('승인 추천 문구를 조립한다', () => {
		expect(buildApprovalLine('APPROVE', '추천 점수 88점')).toBe('승인 추천 APPROVE · 추천 점수 88점');
		expect(buildApprovalLine(null, '추천 점수 88점')).toBe('추천 점수 88점');
		expect(buildApprovalLine('APPROVE', null)).toBe('승인 추천 APPROVE');
	});

	it('텍스트 정규화와 fallback을 제공한다', () => {
		expect(trimmedText('  hello  ')).toBe('hello');
		expect(fallbackText('', '기본값')).toBe('기본값');
		expect(fallbackText('실제값', '기본값')).toBe('실제값');
	});

	it('액션 버킷 메타와 기본 링크를 만든다', () => {
		expect(buildActionBucketMeta('BUDGET_INCREASE')).toEqual({
			actionBucket: 'BUDGET_INCREASE',
			actionBucketLabel: '예산 증액',
		});

		expect(
			buildDecisionLinks({
				source: { label: '원천 보기', path: '/source' },
				actionBucket: 'VOC_IMPROVEMENT',
			}),
		).toEqual({
			source: { label: '원천 보기', path: '/source' },
			queue: { label: '실행 큐 보기', path: '/analytics/ai/actions?action_bucket=VOC_IMPROVEMENT' },
			logs: { label: '검증 로그 보기', path: '/analytics/ai/logs?action_bucket=VOC_IMPROVEMENT' },
		});
	});

	it('근거 기반 source/queue/logs 링크를 한 번에 만든다', () => {
		expect(
			buildEvidenceDecisionLinks({
				productName: '테스트 상품',
				keyword: '테스트 키워드',
				actionBucket: 'VOC_IMPROVEMENT',
				policyType: 'VOC',
				topIssue: '부정 리뷰 증가',
				recommendedAction: 'VOC 개선',
				fromYmd: '2026-04-01',
				toYmd: '2026-04-30',
				sourceAriaLabel: 'evidence-link',
			}),
		).toEqual({
			source: {
				label: '근거 보기',
				path: '/analytics/ai/organic-rank/trace?product=테스트%20상품&keyword=테스트%20키워드&bucket=VOC_IMPROVEMENT&policy_type=VOC&top_issue=%EB%B6%80%EC%A0%95%20%EB%A6%AC%EB%B7%B0%20%EC%A6%9D%EA%B0%80&recommended_action=VOC%20%EA%B0%9C%EC%84%A0&from=2026-04-01&to=2026-04-30',
				ariaLabel: 'evidence-link',
			},
			queue: { label: '실행 큐 보기', path: '/analytics/ai/actions?action_bucket=VOC_IMPROVEMENT' },
			logs: { label: '검증 로그 보기', path: '/analytics/ai/logs?action_bucket=VOC_IMPROVEMENT' },
		});
	});

	it('metric과 광고 엔터티 id를 만든다', () => {
		expect(metric('신뢰도', '91%', 'good')).toEqual({ label: '신뢰도', value: '91%', tone: 'good' });
		expect(buildAdsEntityId('캠페인', '그룹', '키워드')).toBe('캠페인::그룹::키워드');
	});
});
