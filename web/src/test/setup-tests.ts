import React from 'react';
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Recharts는 내부에서 다양한 React Hook을 사용하고,
// jsdom + Vitest 환경에서 React 버전이 섞일 경우 Invalid hook call이 발생할 수 있다.
// UI 테스트에서는 Recharts 내부 구현이 중요하지 않으므로,
// 간단한 목 컴포넌트로 대체해 렌더링 오류를 방지한다.

vi.mock('recharts', async () => {
	const actual = await vi.importActual<Record<string, unknown>>('recharts');

	const MockContainer: React.FC<React.PropsWithChildren<unknown>> = ({ children }) =>
		React.createElement('div', { 'data-testid': 'mock-recharts-container' }, children);

	const MockChart: React.FC<React.PropsWithChildren<unknown>> = ({ children }) =>
		React.createElement('div', { 'data-testid': 'mock-recharts-chart' }, children);

	const MockElement: React.FC = () => null;

	return {
		...actual,
		ResponsiveContainer: MockContainer,
		LineChart: MockChart,
		CartesianGrid: MockElement,
		Legend: MockElement,
		Line: MockElement,
		Tooltip: MockElement,
		XAxis: MockElement,
		YAxis: MockElement,
	};
});


