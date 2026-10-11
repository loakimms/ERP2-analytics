import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { ApiSettingsView } from './ApiSettingsView';

vi.mock('axios', () => {
	return {
		default: {
			get: vi.fn(),
			put: vi.fn(),
		},
	};
});

describe('ApiSettingsView', () => {
	it('마스킹된 민감값은 저장 시 다시 전송하지 않는다', async () => {
		const axiosAny = axios as any;
		(axiosAny.get as any).mockResolvedValue({
			data: {
				AD_CUST_ID: '1053378',
				OPENAI_API_KEY: '********',
				GEMINI_API_KEY: '********',
				NAVER_COMMERCE_CLIENT_SECRET: '********',
			},
		});
		(axiosAny.put as any).mockResolvedValue({ data: { ok: true } });

		render(<ApiSettingsView apiBaseUrl="http://localhost:9999" />);

		expect(await screen.findByText('API 세팅')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: '저장' }));

		await waitFor(() => {
			expect((axiosAny.put as any).mock.calls.length).toBeGreaterThan(0);
		});

		const payload = (axiosAny.put as any).mock.calls[0][1] as Record<string, unknown>;
		expect(payload.AD_CUST_ID).toBe('1053378');
		expect('OPENAI_API_KEY' in payload).toBe(false);
		expect('GEMINI_API_KEY' in payload).toBe(false);
		expect('NAVER_COMMERCE_CLIENT_SECRET' in payload).toBe(false);
	});
});
