import { describe, expect, it } from 'vitest';
import { labelQnaResponseState } from './qnaLabels';

describe('qnaLabels', () => {
	it('Q&A 상태를 한국어 라벨로 변환한다', () => {
		expect(labelQnaResponseState('generated')).toBe('검토대기');
		expect(labelQnaResponseState('rejected')).toBe('반려');
		expect(labelQnaResponseState('all')).toBe('전체');
		expect(labelQnaResponseState('unknown', 'unknown')).toBe('unknown');
		expect(labelQnaResponseState('', '-')).toBe('-');
	});
});
