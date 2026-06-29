import { describe, expect, it } from 'vitest';
import { labelAiOpsActionBucket } from './aiOpsLabels';

describe('aiOpsLabels', () => {
	it('AI 운영 버킷을 한국어 라벨로 변환한다', () => {
		expect(labelAiOpsActionBucket('FOCUS')).toBe('판매 집중');
		expect(labelAiOpsActionBucket('sales_focus')).toBe('판매 집중');
		expect(labelAiOpsActionBucket('AD_OVERINVESTMENT')).toBe('광고 과투입 점검');
		expect(labelAiOpsActionBucket('VOC_IMPROVEMENT')).toBe('리뷰 개선');
		expect(labelAiOpsActionBucket('')).toBe('미분류');
		expect(labelAiOpsActionBucket('UNKNOWN_BUCKET')).toBe('UNKNOWN_BUCKET');
	});
});
