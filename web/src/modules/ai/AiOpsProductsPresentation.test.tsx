import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AiOpsProductDecisionExtraContent } from './AiOpsProductsPresentation';

describe('AiOpsProductsPresentation', () => {
	it('상품 판단 보조 정보는 우선순위/신뢰도/데이터 품질과 검증 경로를 표시한다', () => {
		render(
			<MemoryRouter>
				<AiOpsProductDecisionExtraContent
					priorityLabel="83%"
					confidenceLabel="87%"
					dataQualityLabel="93%"
					sourceLink={{ label: '원천 보기', path: '/source' }}
					sourceAriaLabel="product-item-source-SKU-1"
					queueLink={{ label: '실행 큐 보기', path: '/queue' }}
					logsLink={{ label: '검증 로그 보기', path: '/logs' }}
				/>
			</MemoryRouter>,
		);

		expect(screen.getByText('우선순위')).toBeTruthy();
		expect(screen.getByText('83%')).toBeTruthy();
		expect(screen.getByText('신뢰도')).toBeTruthy();
		expect(screen.getByText('87%')).toBeTruthy();
		expect(screen.getByText('데이터 품질')).toBeTruthy();
		expect(screen.getByText('93%')).toBeTruthy();
		expect(screen.getByText('검증 경로')).toBeTruthy();
	});
});
