import React from 'react';
import { beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import axios from 'axios';
import { __idbStore } from './idbKv';

vi.mock('./idbKv', () => {
	const store = new Map<string, any>();
	return {
		idbGet: async (key: string) => store.get(key) ?? null,
		idbSet: async (key: string, value: any) => {
			store.set(key, value);
			return true;
		},
		__idbStore: store,
	};
});

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
			post: vi.fn(),
		},
	};
});

export { __idbStore } from './idbKv';
export const mockedAxios = axios as any;

export function renderCategoryPickerManual(view: React.ReactElement) {
	return render(view);
}

export function registerCategoryPickerManualTestLifecycle(): void {
	beforeEach(() => {
		localStorage.clear();
		__idbStore.clear();
		mockedAxios.get.mockReset();
		mockedAxios.post.mockReset();
	});
}
