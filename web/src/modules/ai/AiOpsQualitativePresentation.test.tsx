import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { ActionProposalList, SeverityBadge, TagList } from './AiOpsQualitativePresentation';

function LocationProbe(props: { children: React.ReactNode }): JSX.Element {
	const location = useLocation();
	return (
		<>
			<div data-testid="current-location">{`${location.pathname}${location.search}`}</div>
			{props.children}
		</>
	);
}

describe('AiOpsQualitativePresentation', () => {
	it('SeverityBadge는 severity가 있을 때만 표시한다', () => {
		const { rerender } = render(
			<MemoryRouter>
				<SeverityBadge severity="HIGH" />
			</MemoryRouter>,
		);

		expect(screen.getByText('심각도 HIGH')).toBeTruthy();

		rerender(
			<MemoryRouter>
				<SeverityBadge severity={null} />
			</MemoryRouter>,
		);

		expect(screen.queryByText(/심각도/)).toBeNull();
	});

	it('TagList는 값이 있을 때만 라벨과 목록을 표시한다', () => {
		const { rerender } = render(
			<MemoryRouter>
				<TagList label="위험 주제" values={['배송', '포장']} />
			</MemoryRouter>,
		);

		expect(screen.getByText('위험 주제: 배송, 포장')).toBeTruthy();

		rerender(
			<MemoryRouter>
				<TagList label="위험 주제" values={[]} />
			</MemoryRouter>,
		);

		expect(screen.queryByText(/위험 주제:/)).toBeNull();
	});

	it('ActionProposalList는 관련 화면으로 이동한다', async () => {
		render(
			<MemoryRouter initialEntries={['/analytics/ai/reviews']}>
				<LocationProbe>
					<ActionProposalList
						title="실행 제안 묶음"
						description="운영팀이 바로 실행할 액션"
						actions={[
							{
								title: 'FAQ 등록',
								action_bucket: 'FAQ_CONTENT_IMPROVEMENT',
								expected_effect: '구매 직전 문의 감소',
								owner: '콘텐츠 운영',
							},
						]}
					/>
				</LocationProbe>
			</MemoryRouter>,
		);

		expect(screen.getByText('FAQ 등록')).toBeTruthy();
		expect(screen.getByText(/기대 효과: 구매 직전 문의 감소/)).toBeTruthy();
		expect(screen.getByText(/담당 축: 콘텐츠 운영/)).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: '실행 큐 보기' }));
		await waitFor(() => {
			expect(screen.getByTestId('current-location').textContent).toBe('/analytics/ai/actions?action_bucket=FAQ_CONTENT_IMPROVEMENT');
		});
	});
});
