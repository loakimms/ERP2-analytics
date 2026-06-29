import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ActionDiffDetails, ActionQueueDiffDetails, ActionVerificationDetails, LogAuditSummary } from './AiOpsCenterDetails';

describe('AiOpsCenterDetails', () => {
	it('실행 큐 정책 비교 상세는 추천 점수와 승인 추천을 함께 표시한다', () => {
		render(
			<ActionQueueDiffDetails
				item={{
					action_type: 'QUEUE_POLICY_COMPARE_ACTION',
					approval_recommendation: 'APPROVE',
					approval_recommendation_reason: '추천 점수 88점으로 즉시 테스트 승인을 권장합니다.',
					payload: {
						current_policy_pack_id: 'AI_OPS',
						current_policy_type: 'FAQ_CONTENT_IMPROVEMENT',
						current_recommended_action: 'FAQ 보강',
						target_policy_pack_title: '브랜드A 정책팩',
						target_policy_type: 'AD_GROWTH',
						target_recommended_action: '광고 확대 테스트',
						target_recommendation_score: 88,
						target_recommendation_reason: '검증 개선율 100% / 평균 매출성장 +24',
						changed_fields: ['policy_type', 'recommended_action_primary'],
					},
				}}
			/>,
		);

		expect(screen.getByText(/현재 정책팩 AI_OPS · FAQ_CONTENT_IMPROVEMENT/)).toBeTruthy();
		expect(screen.getByText(/대상 정책팩 브랜드A 정책팩 · AD_GROWTH/)).toBeTruthy();
		expect(screen.getByText(/현재 액션: FAQ 보강/)).toBeTruthy();
		expect(screen.getByText(/대상 액션: 광고 확대 테스트/)).toBeTruthy();
		expect(screen.getByText((content) => content.trim() === '추천 점수 88')).toBeTruthy();
		expect(screen.getByText(/추천 근거: 검증 개선율 100% \/ 평균 매출성장 \+24/)).toBeTruthy();
		expect(screen.getByText(/승인 추천 APPROVE/)).toBeTruthy();
		expect(screen.getByText(/즉시 테스트 승인을 권장합니다/)).toBeTruthy();
		expect(screen.getByText(/변경 필드: policy_type, recommended_action_primary/)).toBeTruthy();
	});

	it('로그 정책 비교 상세는 공통 비교 정보만 표시한다', () => {
		render(
			<ActionDiffDetails
				actionType="QUEUE_POLICY_COMPARE_ACTION"
				label="정책 비교 액션"
				payload={{
					current_policy_pack_id: 'AI_OPS',
					current_policy_type: 'FAQ_CONTENT_IMPROVEMENT',
					current_recommended_action: 'FAQ 보강',
					target_policy_pack_title: '브랜드A 정책팩',
					target_policy_type: 'AD_GROWTH',
					target_recommended_action: '광고 확대 테스트',
					changed_fields: ['policy_type', 'recommended_action_primary'],
				}}
			/>,
		);

		expect(screen.getByText('정책 비교 액션')).toBeTruthy();
		expect(screen.getByText(/현재 정책팩 AI_OPS · FAQ_CONTENT_IMPROVEMENT/)).toBeTruthy();
		expect(screen.getByText(/대상 정책팩 브랜드A 정책팩 · AD_GROWTH/)).toBeTruthy();
		expect(screen.getByText(/현재 액션: FAQ 보강/)).toBeTruthy();
		expect(screen.getByText(/대상 액션: 광고 확대 테스트/)).toBeTruthy();
		expect(screen.getByText(/변경 필드: policy_type, recommended_action_primary/)).toBeTruthy();
	});

	it('감사 요약은 버킷과 검증 상태, 룰 수를 함께 표시한다', () => {
		render(
			<LogAuditSummary
				item={{
					policy_pack_id: 'AI_OPS_BRAND_A',
					latest_action_payload: {
						action_kind: 'BUDGET_INCREASE',
					},
					latest_action_verification: {
						status: 'READY_7D',
						label: '7일 검증 가능',
					},
					rules_triggered: ['RULE_A', 'RULE_B'],
					recommended_actions: ['예산 증액', '소재 교체'],
				}}
			/>,
		);

		expect(screen.getByText('감사 요약')).toBeTruthy();
		expect(screen.getByText((content) => content.includes('버킷 예산 증액') && content.includes('검증 상태 7일 검증 가능'))).toBeTruthy();
		expect(screen.getByText(/정책팩 AI_OPS_BRAND_A/)).toBeTruthy();
		expect(screen.getByText(/룰 2개/)).toBeTruthy();
		expect(screen.getByText(/추천 액션 2개/)).toBeTruthy();
	});

	it('검증 상세는 의사결정 지표를 표시한다', () => {
		render(
			<ActionVerificationDetails
				verification={{
					status: 'READY_7D',
					label: '7일 검증 가능',
					outcome: 'IMPROVED',
					baseline_date: '2026-04-11',
					latest_date: '2026-04-18',
					metrics: {
						sales_growth_delta: 24,
						organic_strength_delta: 18,
						review_risk_delta: -28,
						qna_barrier_delta: -40,
					},
				}}
			/>,
		);

		expect(screen.getByText(/7일 검증 가능 · 판정 IMPROVED/)).toBeTruthy();
		expect(screen.getByText(/기준 2026-04-11 \/ 최신 2026-04-18/)).toBeTruthy();
		expect(screen.getByText(/매출성장 24 · 오가닉 18/)).toBeTruthy();
		expect(screen.getByText(/리뷰리스크 -28 · Q&A장벽 -40/)).toBeTruthy();
	});

	it('검증 상세는 광고 매출 지표를 표시한다', () => {
		render(
			<ActionVerificationDetails
				verification={{
					status: 'READY_7D',
					label: '7일 검증 가능',
					outcome: 'IMPROVED',
					metrics: {
						net_amount_delta: 70000,
						ad_spend_ratio_delta: -0.3611,
						ad_cost_delta: -30000,
						ad_roas_delta: 476.4,
					},
				}}
			/>,
		);

		expect(screen.getByText(/순매출 \+70,000 · 광고비 비중 -36%/)).toBeTruthy();
		expect(screen.getByText(/광고비 -30,000 · 광고ROAS \+476.4/)).toBeTruthy();
	});

	it('검증 상세는 광고 매출 지표가 있을 때 키워드 전용 줄을 중복 표시하지 않는다', () => {
		render(
			<ActionVerificationDetails
				verification={{
					status: 'READY_7D',
					label: '7일 검증 가능',
					outcome: 'IMPROVED',
					metrics: {
						net_amount_delta: 70000,
						ad_spend_ratio_delta: -0.3611,
						ad_cost_delta: -30000,
						ad_roas_delta: 476.4,
						purchase_conversions_delta: 1,
						purchase_revenue_delta: 32000,
					},
				}}
			/>,
		);

		expect(screen.getByText(/순매출 \+70,000 · 광고비 비중 -36%/)).toBeTruthy();
		expect(screen.getByText(/광고비 -30,000 · 광고ROAS \+476.4/)).toBeTruthy();
		expect(screen.queryByText(/광고비 -30,000 · 구매전환 \+1/)).toBeNull();
		expect(screen.queryByText(/광고매출 \+32,000 · 광고ROAS \+476.4/)).toBeNull();
	});

	it('검증 상세는 키워드 광고 지표를 표시한다', () => {
		render(
			<ActionVerificationDetails
				verification={{
					status: 'READY_7D',
					label: '7일 검증 가능',
					outcome: 'IMPROVED',
					metrics: {
						ad_cost_delta: -17000,
						purchase_conversions_delta: 1,
						purchase_revenue_delta: 32000,
						ad_roas_delta: 55.8,
					},
				}}
			/>,
		);

		expect(screen.getByText(/광고비 -17,000 · 구매전환 \+1/)).toBeTruthy();
		expect(screen.getByText(/광고매출 \+32,000 · 광고ROAS \+55.8/)).toBeTruthy();
	});
});
