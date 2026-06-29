import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import type { AiOpsDecisionCard } from './AiOpsDecisionCardTypes';
import { AiOpsActionBucketHubGrid, AiOpsOperationLearningSummary } from './AiOpsHomePresentation';

function LocationProbe(props: { children: React.ReactNode }): JSX.Element {
	const location = useLocation();
	return (
		<>
			<div data-testid="current-location">{`${location.pathname}${location.search}`}</div>
			{props.children}
		</>
	);
}

const leadCard: AiOpsDecisionCard = {
	id: 'home-card-1',
	domain: 'home',
	entityType: 'sku',
	entityId: 'SKU-B',
	title: '상품B',
	actionBucket: 'BUDGET_INCREASE',
	actionBucketLabel: '예산 증액',
	badgeLabel: 'BUDGET_INCREASE',
	policyLabel: 'AD_GROWTH',
	summary: '광고 확장 기회',
	recommendedAction: '광고 확대',
	effectivePriorityScore: 95,
	priorityReason: '운영 학습 가중치 +19점',
	metrics: [],
	links: {
		source: { label: '원천 보기', path: '/source' },
		queue: { label: '실행 큐 보기', path: '/analytics/ai/actions?action_bucket=BUDGET_INCREASE' },
		logs: { label: '검증 로그 보기', path: '/analytics/ai/logs?action_bucket=BUDGET_INCREASE' },
	},
	raw: { sku_id: 'SKU-B', product_name: '상품B' },
};

describe('AiOpsHomePresentation', () => {
	it('운영 학습 요약은 검증 건수와 개선율을 표시한다', () => {
		render(
			<AiOpsOperationLearningSummary
				verifiedCount={1}
				improvementRate={1}
				learningNote="예산 증액 학습 1건 검증 / 개선율 100%"
			/>,
		);

		expect(screen.getByText(/운영 검증 1건/)).toBeTruthy();
		expect(screen.getAllByText(/개선율 100%/).length).toBeGreaterThan(0);
		expect(screen.getByText(/예산 증액 학습 1건 검증/)).toBeTruthy();
	});

	it('버킷 허브는 동일 버킷 컨텍스트로 이동한다', async () => {
		render(
			<MemoryRouter initialEntries={['/analytics/ai/home']}>
				<LocationProbe>
					<AiOpsActionBucketHubGrid
						actionBucketCards={[
							{
								bucket: 'BUDGET_INCREASE',
								count: 1,
								leadItem: leadCard,
							},
						]}
						selectedActionBucket=""
					/>
				</LocationProbe>
			</MemoryRouter>,
		);

		expect(screen.getByText('예산 증액')).toBeTruthy();
		expect(screen.getByText(/대표 SKU 상품B/)).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'home-bucket-actions-BUDGET_INCREASE' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toBe('/analytics/ai/actions?action_bucket=BUDGET_INCREASE');
		});
	});
});
