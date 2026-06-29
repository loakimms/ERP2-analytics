import { describe, expect, it } from 'vitest';
import {
	actionTextMatchesAiOpsBucket,
	aiOpsLogMatchesActionBucket,
	getAiOpsLogPrimaryActionBucket,
	inferAiOpsActionBucketFromTexts,
} from './aiOpsDomain';

describe('aiOpsDomain', () => {
	it('AI 운영 버킷 텍스트 매칭과 추론을 처리한다', () => {
		expect(actionTextMatchesAiOpsBucket('예산 증액 테스트', 'BUDGET_INCREASE')).toBe(true);
		expect(actionTextMatchesAiOpsBucket('광고 과투입 점검 및 예산 축소 테스트', 'AD_OVERINVESTMENT')).toBe(true);
		expect(inferAiOpsActionBucketFromTexts(['FAQ 보강', '광고 확대 테스트'])).toBe('FAQ_CONTENT_IMPROVEMENT');
		expect(inferAiOpsActionBucketFromTexts(['리뷰 개선 우선'])).toBe('VOC_IMPROVEMENT');
	});

	it('AI 운영 로그에서 우선 버킷을 추론하고 매칭한다', () => {
		const item = {
			latest_action_payload: { title: 'FAQ 보강' },
			recommended_actions: ['광고 과투입 점검 및 예산 축소 테스트'],
			evidence: {},
		};
		expect(getAiOpsLogPrimaryActionBucket(item)).toBe('FAQ_CONTENT_IMPROVEMENT');
		expect(aiOpsLogMatchesActionBucket(item, 'FAQ_CONTENT_IMPROVEMENT')).toBe(true);
		expect(aiOpsLogMatchesActionBucket(item, 'AD_OVERINVESTMENT')).toBe(false);
	});

	it('광고 과투입 evidence만 있어도 버킷을 보존한다', () => {
		const item = {
			latest_action_payload: {},
			recommended_actions: [],
			evidence: {
				sales: {
					ad_overinvestment: {
						keyword: '과투입키워드',
					},
				},
			},
		};
		expect(getAiOpsLogPrimaryActionBucket(item)).toBe('AD_OVERINVESTMENT');
	});
});
