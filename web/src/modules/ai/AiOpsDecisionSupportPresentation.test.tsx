import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AiOpsVerificationSupportSection } from './AiOpsDecisionSupportPresentation';

describe('AiOpsDecisionSupportPresentation', () => {
	it('검증 경로 래퍼는 자식 콘텐츠와 검증 경로를 함께 표시한다', () => {
		render(
			<MemoryRouter>
				<AiOpsVerificationSupportSection
					sourceLink={{ label: '원천 보기', path: '/source' }}
					sourceAriaLabel="source-link"
					queueLink={{ label: '실행 큐 보기', path: '/queue' }}
					logsLink={{ label: '검증 로그 보기', path: '/logs' }}
				>
					<div>보조 요약</div>
				</AiOpsVerificationSupportSection>
			</MemoryRouter>,
		);

		expect(screen.getByText('보조 요약')).toBeTruthy();
		expect(screen.getByText('검증 경로')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'source-link' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '실행 큐 보기' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '검증 로그 보기' })).toBeTruthy();
	});
});
