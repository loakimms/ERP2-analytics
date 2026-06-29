import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AiOpsDecisionCard } from './AiOpsDecisionCardTypes';
import { AiOpsDecisionCardPanel } from './AiOpsCenterLayout';

const baseCard: AiOpsDecisionCard = {
	id: 'card-1',
	domain: 'home',
	entityType: 'sku',
	entityId: 'SKU-1',
	title: '테스트 상품',
	actionBucket: 'BUDGET_INCREASE',
	actionBucketLabel: '예산 증액',
	badgeLabel: 'BUDGET_INCREASE',
	policyLabel: 'AD_GROWTH',
	summary: '광고 확장 기회가 보입니다.',
	recommendedAction: '예산 증액 테스트',
	effectivePriorityScore: 90,
	priorityReason: '운영 학습 가중치 반영',
	metrics: [
		{ label: '유효 우선순위', value: '90', tone: 'warn' },
		{ label: '기준 우선순위', value: '71', tone: 'neutral' },
	],
	links: {
		source: { label: '원천 보기', path: '/source' },
		queue: { label: '큐 보기', path: '/queue' },
		logs: { label: '로그 보기', path: '/logs' },
	},
	raw: {
		sku_id: 'SKU-1',
		product_name: '테스트 상품',
	},
};

describe('AiOpsDecisionCardPanel', () => {
	it('공통 카드 본문과 커스텀 슬롯을 함께 렌더링한다', () => {
		render(
			<AiOpsDecisionCardPanel
				card={baseCard}
				badgeColor="#93c5fd"
				note="운영 학습 가중치 반영"
				extraContent={<div>추가 세부 정보</div>}
				actions={<button type="button">실행 버튼</button>}
			/>,
		);

		expect(screen.getByText('테스트 상품')).toBeTruthy();
		expect(screen.getByText('BUDGET_INCREASE')).toBeTruthy();
		expect(screen.getByText('광고 확장 기회가 보입니다.')).toBeTruthy();
		expect(screen.getByText('권장 액션: 예산 증액 테스트')).toBeTruthy();
		expect(screen.getByText(/유효 우선순위 90/)).toBeTruthy();
		expect(screen.getByText('운영 학습 가중치 반영')).toBeTruthy();
		expect(screen.getByText('추가 세부 정보')).toBeTruthy();
		expect(screen.getByRole('button', { name: '실행 버튼' })).toBeTruthy();
	});
});
