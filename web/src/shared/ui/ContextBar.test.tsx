import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextBar } from './ContextBar';

describe('ContextBar', () => {
	it('컨텍스트 문구와 액션 버튼을 함께 렌더링한다', () => {
		const onPrimary = vi.fn();
		const onSecondary = vi.fn();

		render(
			<ContextBar
				contextLines={['조회/수집 기간 2026-04-01 ~ 2026-04-07', '선택된 이슈 태그: 냄새']}
				actions={[
					{ label: '컨텍스트 복귀', onClick: onPrimary },
					{ label: '필터 해제', onClick: onSecondary, ariaLabel: '컨텍스트 필터 해제' },
				]}
			/>,
		);

		expect(screen.getByText('조회/수집 기간 2026-04-01 ~ 2026-04-07')).toBeTruthy();
		expect(screen.getByText('선택된 이슈 태그: 냄새')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: '컨텍스트 복귀' }));
		fireEvent.click(screen.getByRole('button', { name: '컨텍스트 필터 해제' }));

		expect(onPrimary).toHaveBeenCalledTimes(1);
		expect(onSecondary).toHaveBeenCalledTimes(1);
	});
});
