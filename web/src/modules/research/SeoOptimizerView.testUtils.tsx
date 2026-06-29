import React from 'react';
import { beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import axios from 'axios';

vi.mock('axios', () => {
	return {
		default: {
			post: vi.fn(),
		},
	};
});

vi.mock('react-datepicker', () => {
	return {
		default: (props: any) => (
			<input
				aria-label="date-picker"
				className={props.className}
				value={props.selected ? String(props.selected) : ''}
				onChange={() => props.onChange?.(new Date())}
			/>
		),
	};
});

vi.mock('./CategoryPickerManual', () => {
	return {
		CategoryPickerManual: (props: any) => (
			<button
				type="button"
				onClick={() => props.onChange?.({ id: '50000000', path: 'A>B>C' })}
			>
				카테고리 선택(테스트)
			</button>
		),
	};
});

export const mockedAxios = axios as any;

export async function renderSeoOptimizerView(view: React.ReactElement): Promise<RenderResult> {
	let rendered!: RenderResult;
	await act(async () => {
		rendered = render(view);
		await Promise.resolve();
		await Promise.resolve();
	});
	return rendered;
}

export async function clickWithAct(target: Element): Promise<void> {
	await act(async () => {
		fireEvent.click(target);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export async function changeWithAct(target: Element, value: Record<string, unknown>): Promise<void> {
	await act(async () => {
		fireEvent.change(target, value);
		await Promise.resolve();
		await Promise.resolve();
	});
}

export async function runSeoAnalysis(form?: { productName?: string; mainKeyword?: string; productType?: string; withCategory?: boolean }): Promise<void> {
	if (form?.productName ?? true) {
		await changeWithAct(screen.getByLabelText('상품명(prefix)'), {
			target: { value: form?.productName ?? '수자타 헤나' },
		});
	}
	if (form?.productType) {
		await changeWithAct(screen.getByLabelText('제품타입유형'), {
			target: { value: form.productType },
		});
	}
	if (form?.mainKeyword ?? true) {
		await changeWithAct(screen.getByLabelText('메인 키워드'), {
			target: { value: form?.mainKeyword ?? '헤나' },
		});
	}
	if (form?.withCategory !== false) {
		await clickWithAct(screen.getByRole('button', { name: '카테고리 선택(테스트)' }));
	}
	await clickWithAct(screen.getByRole('button', { name: '분석 실행' }));
}

export function registerSeoOptimizerTestLifecycle(): void {
	beforeEach(() => {
		localStorage.clear();
		mockedAxios.post.mockReset();
	});
}
