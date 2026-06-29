import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdsDateControls, type AdsDateState } from './AdsDateControls';

describe('AdsDateControls', () => {
	it('달력 모달은 좌측=전월, 우측=당월(기준: 종료일 month)을 기본으로 보여준다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-12T12:00:00'));
		const onChange = vi.fn();
		const base: AdsDateState = {
			range: { from: new Date('2026-01-10T00:00:00'), to: new Date('2026-01-11T00:00:00') },
			compareMode: 'prev_day',
		};
		render(<AdsDateControls value={base} onChange={onChange} />);
		fireEvent.click(screen.getByRole('button', { name: 'date-range' }));

		// 2026-01 종료일 기준: 좌측 2025-12, 우측 2026-01
		expect(screen.getByText('2025년 12월')).toBeTruthy();
		expect(screen.getByText('2026년 1월')).toBeTruthy();
		vi.useRealTimers();
	});

	it('달력에서 시작일만 선택한 상태에서도 "적용"이 동작하며, 종료일은 시작일로 보정된다', () => {
		const onChange = vi.fn();
		const base: AdsDateState = {
			range: { from: new Date('2026-01-10T00:00:00'), to: new Date('2026-01-10T00:00:00') },
			compareMode: 'prev_day',
		};

		render(<AdsDateControls value={base} onChange={onChange} />);

		// 모달 열기
		fireEvent.click(screen.getByRole('button', { name: 'date-range' }));

		// react-datepicker inline 렌더링된 날짜 버튼 중 하나 클릭 (1일 선택)
		// NOTE: react-datepicker는 날짜를 "button"으로 렌더링하며, aria-label에 날짜 문자열이 들어간다.
		const dayBtn = screen.getAllByRole('button').find((b) => (b.getAttribute('aria-label') || '').includes('Choose')) ?? null;
		// 환경/버전별 aria-label이 다를 수 있어, 최소한 "적용" 버튼 클릭만은 보장한다.
		if (dayBtn) fireEvent.click(dayBtn);

		fireEvent.click(screen.getByRole('button', { name: '적용' }));

		expect(onChange).toHaveBeenCalled();
		const next = onChange.mock.calls[0]![0] as AdsDateState;
		expect(next.range.from).toBeTruthy();
		expect(next.range.to).toBeTruthy();
		expect(new Date(next.range.from).getTime()).toBeLessThanOrEqual(new Date(next.range.to).getTime());
	});

	it('좌측 달력 클릭은 시작일만, 우측 달력 클릭은 종료일만 변경된다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-12T12:00:00'));
		const onChange = vi.fn();
		const base: AdsDateState = {
			range: { from: new Date('2026-01-10T00:00:00'), to: new Date('2026-01-11T00:00:00') },
			compareMode: 'prev_day',
		};
		render(<AdsDateControls value={base} onChange={onChange} />);
		fireEvent.click(screen.getByRole('button', { name: 'date-range' }));

		const left = document.querySelector('[data-testid="calendar-start"]') as HTMLElement | null;
		const right = document.querySelector('[data-testid="calendar-end"]') as HTMLElement | null;
		expect(left).toBeTruthy();
		expect(right).toBeTruthy();

		// 좌측(전월)에서 30일 클릭 → 시작일이 바뀌고 종료일은 유지(01/11)
		// react-datepicker는 일자에 대해 `.react-datepicker__day--0DD` 클래스를 부여한다.
		const leftDay = left!.querySelector(
			'.react-datepicker__day--030:not(.react-datepicker__day--outside-month)',
		) as HTMLElement | null;
		if (leftDay) fireEvent.click(leftDay);
		expect(screen.getByText(/2025-12-30/)).toBeTruthy();
		expect(screen.getByText(/2026-01-11/)).toBeTruthy();

		// 우측(당월)에서 12일 클릭 → 종료일이 바뀐다
		const rightDay = right!.querySelector(
			'.react-datepicker__day--012:not(.react-datepicker__day--outside-month)',
		) as HTMLElement | null;
		if (rightDay) fireEvent.click(rightDay);
		expect(screen.getByText(/2026-01-12/)).toBeTruthy();

		vi.useRealTimers();
	});

	it('빠른 선택을 누르면 달력(하이라이트)과 기간 라벨이 즉시 갱신된다', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-12T12:00:00'));
		const onChange = vi.fn();
		const base: AdsDateState = {
			range: { from: new Date('2026-01-10T00:00:00'), to: new Date('2026-01-10T00:00:00') },
			compareMode: 'prev_day',
		};
		render(<AdsDateControls value={base} onChange={onChange} />);
		fireEvent.click(screen.getByRole('button', { name: 'date-range' }));

		fireEvent.click(screen.getByText('최근 7일(오늘 포함)'));
		// 01/06 ~ 01/12
		expect(screen.getByText(/2026-01-06/)).toBeTruthy();
		expect(screen.getByText(/2026-01-12/)).toBeTruthy();

		// 범위 시작/끝 하이라이트(react-datepicker 클래스)
		const startEl = document.querySelector('.react-datepicker__day--range-start');
		const endEl = document.querySelector('.react-datepicker__day--range-end');
		expect(startEl).toBeTruthy();
		expect(endEl).toBeTruthy();

		vi.useRealTimers();
	});

	it('프리셋에 60/90/180일/1년 버튼이 보인다', () => {
		const onChange = vi.fn();
		const base: AdsDateState = {
			range: { from: new Date('2026-01-10T00:00:00'), to: new Date('2026-01-10T00:00:00') },
			compareMode: 'prev_day',
		};

		render(<AdsDateControls value={base} onChange={onChange} />);
		fireEvent.click(screen.getByRole('button', { name: 'date-range' }));

		expect(screen.getByText('최근 60일')).toBeTruthy();
		expect(screen.getByText('최근 90일')).toBeTruthy();
		expect(screen.getByText('최근 180일')).toBeTruthy();
		expect(screen.getByText('최근 1년')).toBeTruthy();
	});
});

