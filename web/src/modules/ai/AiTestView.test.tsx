import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { AiTestView } from './AiTestView';

vi.mock('axios');

describe('AiTestView', () => {
	it('renders model selector and loads models', async () => {
		const axiosAny = axios as any;
		axiosAny.get.mockImplementation((url: string) => {
			if (String(url).includes('/settings/api/validate/openai')) {
				return Promise.resolve({ data: { ok: true, service: 'openai', status_code: 200, message: 'OK' } });
			}
			if (String(url).includes('/ai/models')) {
				return Promise.resolve({ data: { ok: true, models: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] } });
			}
			return Promise.resolve({ data: {} });
		});

		render(<AiTestView apiBaseUrl="http://localhost:5189" />);

		expect(screen.getByText('AI test (ChatGPT 프롬프트/응답)')).toBeTruthy();
		expect(screen.getByLabelText('model-select')).toBeTruthy();

		await waitFor(() => {
			expect(screen.getByRole('option', { name: 'gpt-4o-mini' })).toBeTruthy();
			expect(screen.getByRole('option', { name: 'gpt-4.1' })).toBeTruthy();
		});
	});
});

