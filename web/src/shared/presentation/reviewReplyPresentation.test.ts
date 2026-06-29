import { describe, expect, it } from 'vitest';
import {
	labelReviewStyleControl,
	normalizeReviewReplyActionError,
} from './reviewReplyPresentation';

describe('reviewReplyPresentation', () => {
	it('리뷰 스타일 control id를 한국어 라벨로 변환한다', () => {
		expect(labelReviewStyleControl('greeting_density')).toBe('인사');
		expect(labelReviewStyleControl('gratitude_intensity')).toBe('감사');
		expect(labelReviewStyleControl('empathy_intensity')).toBe('공감');
		expect(labelReviewStyleControl('detail_depth')).toBe('설명');
		expect(labelReviewStyleControl('closing_strength')).toBe('마무리');
		expect(labelReviewStyleControl('custom_control')).toBe('custom_control');
	});

	it('리뷰 답글 액션 에러를 사용자 메시지로 정규화한다', () => {
		expect(normalizeReviewReplyActionError({ message: 'unsupported_parameter: max_tokens' }, '기본 오류')).toContain(
			'권장 모델',
		);
		expect(
			normalizeReviewReplyActionError(
				{ response: { data: { detail: 'reply_submit_validation_failed: 삭제 또는 블라인드 처리된 리뷰입니다.' } } },
				'기본 오류',
			),
		).toBe('판매자센터 입력 조건을 먼저 확인해주세요. 삭제 또는 블라인드 처리된 리뷰입니다.');
		expect(
			normalizeReviewReplyActionError(
				{ response: { data: { detail: 'review_collection_required,draft_status_not_approved' } } },
				'기본 오류',
			),
		).toBe('상품 리뷰 수집을 먼저 진행 후 실행해주세요. 아직 승인되지 않은 초안이라 자동 게시할 수 없습니다.');
		expect(
			normalizeReviewReplyActionError(
				{ response: { data: { detail: 'reply_submit_confirmation_not_detected' } } },
				'기본 오류',
			),
		).toContain('등록 결과 확인 팝업');
		expect(normalizeReviewReplyActionError({ response: { data: { detail: '' } } }, '기본 오류')).toBe('기본 오류');
	});
});
