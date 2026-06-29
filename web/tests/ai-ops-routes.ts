export type AiOpsRouteDefinition = {
	path: string;
	title: string;
	live: {
		stableBlockTitle: string;
		loadingText: string;
		errorText: string;
	};
};

export const AI_OPS_ROUTE_DEFINITIONS: AiOpsRouteDefinition[] = [
	{
		path: '/analytics/ai/home',
		title: '오늘의 실행',
		live: {
			stableBlockTitle: '오늘 우선 SKU',
			loadingText: '데이터를 불러오는 중...',
			errorText: '오늘의 실행 데이터를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/products',
		title: '상품별 운영 판단',
		live: {
			stableBlockTitle: '실제 상품 판단 목록',
			loadingText: '상품 판단 데이터를 불러오는 중...',
			errorText: '상품 판단 데이터를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/ads',
		title: '광고 운영 판단',
		live: {
			stableBlockTitle: '광고 액션 후보',
			loadingText: '광고 운영 판단 데이터를 불러오는 중...',
			errorText: '광고 운영 판단 데이터를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/sales',
		title: '판매·전환 판단',
		live: {
			stableBlockTitle: '판매 액션 후보',
			loadingText: '판매·전환 판단 데이터를 불러오는 중...',
			errorText: '판매·전환 판단 데이터를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/reviews',
		title: '리뷰·VOC 판단',
		live: {
			stableBlockTitle: 'VOC 우선 상품',
			loadingText: '리뷰·VOC 판단 데이터를 불러오는 중...',
			errorText: '리뷰·VOC 판단 데이터를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/qna',
		title: 'Q&A 전환장벽 판단',
		live: {
			stableBlockTitle: '전환 장벽 상품',
			loadingText: 'Q&A 판단 데이터를 불러오는 중...',
			errorText: 'Q&A 전환장벽 판단 데이터를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/trends',
		title: '수요·트렌드 판단',
		live: {
			stableBlockTitle: '트렌드 스냅샷',
			loadingText: '트렌드 데이터를 불러오는 중...',
			errorText: '수요·트렌드 데이터를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/actions',
		title: '실행 큐',
		live: {
			stableBlockTitle: '대기중',
			loadingText: '실행 큐를 불러오는 중...',
			errorText: '실행 큐를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/logs',
		title: '검증/설명 로그',
		live: {
			stableBlockTitle: '판단 근거 로그',
			loadingText: '검증 로그를 불러오는 중...',
			errorText: '검증 로그를 불러오지 못했습니다.',
		},
	},
	{
		path: '/analytics/ai/policies',
		title: 'SKU 정책 센터',
		live: {
			stableBlockTitle: '정책팩 비교 시뮬레이션',
			loadingText: '정책 센터 데이터를 불러오는 중...',
			errorText: '정책 센터 데이터를 불러오지 못했습니다.',
		},
	},
];
