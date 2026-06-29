import { describe, expect, it } from 'vitest';
import { qnaStatusClassName, resolveQnaGuideSection } from './qnaDomain';

describe('qnaDomain', () => {
	it('Q&A 상태에 따라 CSS class를 결정한다', () => {
		expect(qnaStatusClassName('submitted')).toBe('is-completed');
		expect(qnaStatusClassName('approved')).toBe('is-approved');
		expect(qnaStatusClassName('generated')).toBe('is-pending');
		expect(qnaStatusClassName('rejected')).toBe('is-rejected');
		expect(qnaStatusClassName('unanswered')).toBe('is-new');
	});

	it('Q&A 가이드 문구에서 관련 섹션을 추론한다', () => {
		expect(resolveQnaGuideSection({ title: 'FAQ 먼저 보강', target_area: '상세페이지 FAQ' })).toBe('faq');
		expect(resolveQnaGuideSection({ title: '품질 이슈 점검', target_area: '상품 개선' })).toBe('quality');
		expect(resolveQnaGuideSection({ title: '광고 문구 개선', target_area: '마케팅' })).toBe('marketing');
		expect(resolveQnaGuideSection({ title: '랜딩 전환 최적화', target_area: '전환' })).toBe('conversion');
		expect(resolveQnaGuideSection({ title: '기타', target_area: '운영' })).toBe('summary');
	});
});
