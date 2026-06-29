import type { AiOpsTrendInsightsResponse, TrendScenario } from './AiOpsTrendTypes';

export function formatNumber(value: number | null | undefined): string {
	const n = Number(value ?? NaN);
	if (!Number.isFinite(n)) return '-';
	return Math.round(n).toLocaleString();
}

export function formatPercentRounded(value: number | null | undefined): string {
	const n = Number(value ?? NaN);
	if (!Number.isFinite(n)) return '-';
	return `${Math.round(n * 100).toLocaleString()}%`;
}

export function formatCtrPercent(value: number | null | undefined): string {
	const n = Number(value ?? NaN);
	if (!Number.isFinite(n)) return '-';
	return `${n.toFixed(1)}%`;
}

export function deriveTrendScenario(data: AiOpsTrendInsightsResponse | null): TrendScenario {
	const points = Array.isArray(data?.trend?.estimatedDailySearches?.points) ? data.trend!.estimatedDailySearches!.points! : [];
	const first = Number(points[0]?.searches ?? 0);
	const last = Number(points[points.length - 1]?.searches ?? 0);
	const growthRate = first > 0 ? (last - first) / first : 0;
	const totalSearch = Number(data?.keywordSummary?.totalSearch ?? 0);
	const avgCtr = Number(data?.keywordSummary?.avgCtr ?? 0);

	if (growthRate >= 0.15 || (totalSearch >= 50000 && avgCtr >= 2)) {
		return {
			label: '확장 시나리오',
			bucket: 'BUDGET_INCREASE',
			headline: '수요와 클릭 반응이 함께 올라가고 있어 광고와 SEO를 동시에 확장할 시점입니다.',
			bullets: [
				'예산 증액 테스트를 먼저 열고, 승자 키워드를 빠르게 식별합니다.',
				'오가닉 상세 보강과 광고 확대를 같은 주차 안에서 실행합니다.',
				'검증 로그에서 증액 이후 실제 전환이 따라오는지 즉시 확인합니다.',
			],
		};
	}

	if (growthRate <= -0.1) {
		return {
			label: '축소 시나리오',
			bucket: 'BUDGET_DECREASE',
			headline: '수요가 빠르게 줄고 있어 유지보다 축소/정리 기준을 먼저 세워야 합니다.',
			bullets: [
				'예산 감액과 재고/상품 우선순위 재조정이 필요합니다.',
				'효율이 약한 키워드는 방어보다 철수 후보로 분리합니다.',
				'검증 로그에서 감액 이후 손실 없이 비용이 줄었는지 추적합니다.',
			],
		};
	}

	return {
		label: '방어 시나리오',
		bucket: 'RISK_HOLD',
		headline: '수요는 유지 중이지만 공격적 확대보다 핵심 전환 키워드 방어가 우선입니다.',
		bullets: [
			'브랜드/핵심 전환 키워드를 먼저 지키고, 확대는 보류합니다.',
			'리뷰/Q&A/판매 리스크를 같이 봐야 불필요한 증액을 막을 수 있습니다.',
			'검증 로그에서 방어 후 전환 안정성이 유지되는지 확인합니다.',
		],
	};
}
