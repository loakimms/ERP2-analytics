import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SalesDateRangeControls } from './SalesDateRangeControls';

describe('SalesDateRangeControls', () => {
	it('팝오버를 열면 이미지와 같은 빠른 선택 프리셋이 보인다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-30T12:00:00'));
		const onChange = vi.fn();

		render(<SalesDateRangeControls fromYmd="2026-03-29" toYmd="2026-03-29" onChange={onChange} />);

		fireEvent.click(screen.getByRole('button', { name: 'sales-date-range' }));

		expect(screen.getByRole('dialog', { name: '조회 기간 선택' })).toBeTruthy();
		expect(screen.getByText('오늘')).toBeTruthy();
		expect(screen.getByText('어제')).toBeTruthy();
		expect(screen.getByText('이번 주')).toBeTruthy();
		expect(screen.getByText('지난 주')).toBeTruthy();
		expect(screen.getByText('최근 7일(오늘 포함)')).toBeTruthy();
		expect(screen.getByText('최근 30일(오늘 제외)')).toBeTruthy();

		vi.useRealTimers();
	});

	it('프리셋 선택 후 적용하면 부모에 날짜 범위를 전달한다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-30T12:00:00'));
		const onChange = vi.fn();

		render(<SalesDateRangeControls fromYmd="2026-03-29" toYmd="2026-03-29" onChange={onChange} />);

		fireEvent.click(screen.getByRole('button', { name: 'sales-date-range' }));
		fireEvent.click(screen.getByText('최근 7일(오늘 제외)'));
		fireEvent.click(screen.getByRole('button', { name: '적용' }));

		expect(onChange).toHaveBeenCalledWith({
			fromYmd: '2026-03-23',
			toYmd: '2026-03-29',
		});

		vi.useRealTimers();
	});

	it('판매 분석용 compact 모드에서는 더 작은 팝오버 클래스를 사용한다', () => {
		const onChange = vi.fn();

		render(<SalesDateRangeControls fromYmd="2026-03-29" toYmd="2026-03-29" onChange={onChange} compact />);

		fireEvent.click(screen.getByRole('button', { name: 'sales-date-range' }));

		expect(screen.getByTestId('sales-date-range-root')).toHaveClass('sales-date-controls');
		expect(screen.getByRole('dialog', { name: '조회 기간 선택' })).toHaveClass('sales-range-popover');
		expect(screen.getByTestId('sales-date-range-popover-body')).toHaveClass('sales-range-popover-body');
	});
});
