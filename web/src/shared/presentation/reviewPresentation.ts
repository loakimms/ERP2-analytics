function formatReviewNumber(value: number, fractionDigits = 0): string {
	return new Intl.NumberFormat('ko-KR', {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(Number.isFinite(value) ? value : 0);
}

const REVIEW_CATEGORY_DESCRIPTIONS: Record<string, string> = {
	사용성: '사용감, 발림성, 흡수감, 세정력, 거품, 자극 여부처럼 실제 사용 과정에서 느끼는 편의성과 불편 요소를 뜻합니다.',
	효과: '보습, 진정, 윤기, 탄력, 개선 체감처럼 상품을 사용한 뒤 기대한 효능이 느껴졌는지를 뜻합니다.',
	향: '향기, 냄새, 무향 여부처럼 향에 대한 선호와 거부감을 묶은 분류입니다.',
	배송: '배송 속도, 도착 상태, 출고 지연, 택배 경험처럼 상품이 고객에게 전달되는 과정의 평가입니다.',
	'가격/가성비': '가격 부담, 할인 체감, 가성비 만족도처럼 지불한 금액 대비 만족감을 뜻합니다.',
	포장: '박스 상태, 완충, 파손, 누수처럼 포장 품질과 배송 중 손상 방지 수준을 뜻합니다.',
	'품질/내구성': '제품 완성도, 불량 여부, 튼튼함, 고장 가능성처럼 상품 자체의 품질과 내구성을 뜻합니다.',
	'사이즈/용량': '크기, 용량, 대용량/소용량 만족도처럼 양이나 규격에 대한 평가입니다.',
	'디자인/외관': '색상, 외형, 마감, 첫인상처럼 보이는 디자인과 외관 만족도를 뜻합니다.',
	기타: '정의된 핵심 카테고리로 묶이지 않은 리뷰 표현을 임시로 모아 둔 분류입니다.',
};

export function describeReviewCategory(category: string | null | undefined): string {
	const normalized = String(category || '').trim();
	if (!normalized) return '분류 정보가 아직 집계되지 않았습니다.';
	return REVIEW_CATEGORY_DESCRIPTIONS[normalized] || `${normalized} 관련 리뷰를 하나의 주제로 묶어 보여주는 분석 카테고리입니다.`;
}

export function labelReviewAnalysisPriority(priority: string | null | undefined): string {
	const normalized = String(priority || 'medium').trim().toLowerCase();
	if (normalized === 'high') return '우선';
	if (normalized === 'low') return '관찰';
	return '중요';
}

export function formatSignedReviewPercent(value: number): string {
	const prefix = value > 0 ? '+' : '';
	return `${prefix}${formatReviewNumber(value, 1)}%`;
}

export function formatSignedReviewNumber(value: number): string {
	const prefix = value > 0 ? '+' : '';
	return `${prefix}${formatReviewNumber(value, 2)}`;
}
