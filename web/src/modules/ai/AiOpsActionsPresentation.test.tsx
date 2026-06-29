import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AiOpsActionReviewSection, AiOpsActionStatusActions } from './AiOpsActionsPresentation';

describe('AiOpsActionsPresentation', () => {
	it('검토 섹션은 메모 입력과 기존 메모, 검증 경로를 표시한다', () => {
		const handleChange = vi.fn();

		render(
			<MemoryRouter>
				<AiOpsActionReviewSection
					noteValue="승인 메모"
					onNoteChange={handleChange}
					existingNote="이전 메모"
					sourceLink={{ label: '원천 보기', path: '/source' }}
					sourceAriaLabel="action-item-source-1"
					queueLink={{ label: '실행 큐 보기', path: '/queue' }}
					logsLink={{ label: '검증 로그 보기', path: '/logs' }}
				>
					<div>상세 비교 블록</div>
				</AiOpsActionReviewSection>
			</MemoryRouter>,
		);

		expect(screen.getByText('상세 비교 블록')).toBeTruthy();
		expect(screen.getByDisplayValue('승인 메모')).toBeTruthy();
		expect(screen.getByText(/기존 메모: 이전 메모/)).toBeTruthy();
		expect(screen.getByText('검증 경로')).toBeTruthy();

		fireEvent.change(screen.getByPlaceholderText('검토 메모를 입력하세요'), {
			target: { value: '새 메모' },
		});
		expect(handleChange).toHaveBeenCalledWith('새 메모');
	});

	it('상태 액션은 승인/반려/완료 버튼을 노출한다', () => {
		const handleApprove = vi.fn();
		const handleReject = vi.fn();
		const handleDone = vi.fn();

		render(
			<AiOpsActionStatusActions
				approveLabel="추천 승인"
				onApprove={handleApprove}
				onReject={handleReject}
				onDone={handleDone}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: '추천 승인' }));
		fireEvent.click(screen.getByRole('button', { name: '반려' }));
		fireEvent.click(screen.getByRole('button', { name: '완료' }));

		expect(handleApprove).toHaveBeenCalledTimes(1);
		expect(handleReject).toHaveBeenCalledTimes(1);
		expect(handleDone).toHaveBeenCalledTimes(1);
	});
});
