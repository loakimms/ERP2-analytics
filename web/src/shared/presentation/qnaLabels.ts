export function labelQnaResponseState(value?: string | null, fallback = ''): string {
	const key = String(value || '').trim();
	const labels: Record<string, string> = {
		all: '전체',
		unanswered: '미답변',
		generated: '검토대기',
		approved: '승인',
		submitted: '완료',
		failed: '등록 실패',
		rejected: '반려',
		answered: '기존 답변',
	};
	return labels[key] || (key || fallback);
}
