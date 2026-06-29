export function labelReviewStyleControl(controlId: string): string {
	switch (controlId) {
		case 'greeting_density':
			return '인사';
		case 'gratitude_intensity':
			return '감사';
		case 'empathy_intensity':
			return '공감';
		case 'detail_depth':
			return '설명';
		case 'closing_strength':
			return '마무리';
		default:
			return controlId;
	}
}

export function normalizeReviewReplyActionError(error: any, fallback: string): string {
	const detail = String(error?.response?.data?.detail ?? error?.message ?? fallback).trim();
	const detailLow = detail.toLowerCase();
	if (detailLow.includes('max_tokens') || detailLow.includes('unsupported_parameter')) {
		return '선택한 OpenAI 모델과 토큰 파라미터 규격이 맞지 않습니다. 권장 모델(gpt-5.2 또는 gpt-4o-mini)로 다시 시도해 주세요.';
	}
	if (detailLow.includes('reply_submit_validation_failed')) {
		const tail = detail.split(':').slice(1).join(':').trim();
		return tail ? `판매자센터 입력 조건을 먼저 확인해주세요. ${tail}` : '판매자센터 입력 조건을 먼저 확인해주세요.';
	}
	if (detailLow.includes('reply_submit_confirmation_not_detected')) {
		return '판매자센터 등록 결과 확인 팝업을 확인하지 못했습니다. 실제 등록 여부를 먼저 확인해주세요.';
	}
	const blockerMessages: Record<string, string> = {
		review_collection_required: '상품 리뷰 수집을 먼저 진행 후 실행해주세요.',
		draft_status_not_approved: '아직 승인되지 않은 초안이라 자동 게시할 수 없습니다.',
		review_already_replied: '이미 실제 답글이 등록된 리뷰입니다.',
		seller_review_deleted: '판매자센터에서 삭제되었거나 더 이상 노출되지 않는 리뷰로 확인되어 완료 처리했습니다.',
		seller_review_blocked: '판매자센터에서 블라인드 또는 등록 불가 상태로 확인되어 완료 처리했습니다.',
		browser_host_cdp_not_enabled: 'Host Chrome CDP가 준비되지 않아 자동 게시를 진행할 수 없습니다.',
		browser_page_not_prepared: '판매자센터 브라우저 페이지가 준비되지 않았습니다.',
		seller_review_page_not_open: '스마트스토어 판매자센터 리뷰 관리 화면이 열려 있지 않습니다.',
		seller_review_not_found: '판매자센터에서 해당 리뷰글번호를 찾지 못했습니다.',
		reply_dialog_not_found: '답글 입력 창을 찾지 못했습니다.',
		reply_editor_not_found: '답글 입력 영역을 찾지 못했습니다.',
		reply_text_not_applied: '판매자센터 답글 입력란에 문구가 정상 반영되지 않았습니다.',
		reply_submit_button_not_found: '답글 등록 버튼을 찾지 못했습니다.',
		commerce_api_unavailable: '커머스 API 준비 상태를 확인하지 못했습니다.',
		naver_commerce_not_configured: '네이버 커머스 API 설정이 비어 있습니다.',
		commerce_ip_not_allowed: '네이버 커머스 API 허용 IP가 설정되지 않았습니다.',
	};
	const blockers = detail
		.split(',')
		.map((item) => String(item || '').trim())
		.filter(Boolean);
	if (blockers.length > 0 && blockers.every((item) => blockerMessages[item])) {
		return blockers.map((item) => blockerMessages[item]).join(' ');
	}
	return detail || fallback;
}
