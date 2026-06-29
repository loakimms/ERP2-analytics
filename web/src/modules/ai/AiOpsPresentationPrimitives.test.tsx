import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AiOpsMetricTile, AiOpsSurfacePanel } from './AiOpsPresentationPrimitives';

describe('AiOpsPresentationPrimitives', () => {
	it('표면 패널은 기본 스타일과 내용을 렌더링한다', () => {
		render(
			<AiOpsSurfacePanel>
				<div>패널 내용</div>
			</AiOpsSurfacePanel>,
		);

		expect(screen.getByText('패널 내용')).toBeTruthy();
	});

	it('메트릭 타일은 라벨과 값을 표시한다', () => {
		render(<AiOpsMetricTile label="우선순위" value="83%" />);

		expect(screen.getByText('우선순위')).toBeTruthy();
		expect(screen.getByText('83%')).toBeTruthy();
	});
});
