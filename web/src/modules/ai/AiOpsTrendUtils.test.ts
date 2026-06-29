import { describe, expect, it } from 'vitest';

import { deriveTrendScenario, formatCtrPercent, formatNumber, formatPercentRounded } from './AiOpsTrendUtils';

describe('AiOpsTrendUtils', () => {
	it('성장률이 높으면 확장 시나리오를 반환한다', () => {
		const scenario = deriveTrendScenario({
			keywordSummary: {
				totalSearch: 54000,
				avgCtr: 2.1,
			},
			trend: {
				estimatedDailySearches: {
					points: [
						{ date: '2026-03-01', searches: 1200 },
						{ date: '2026-03-30', searches: 2200 },
					],
				},
			},
		});

		expect(scenario.label).toBe('확장 시나리오');
		expect(scenario.bucket).toBe('BUDGET_INCREASE');
	});

	it('성장률이 크게 낮으면 축소 시나리오를 반환한다', () => {
		const scenario = deriveTrendScenario({
			keywordSummary: {
				totalSearch: 12000,
				avgCtr: 1.2,
			},
			trend: {
				estimatedDailySearches: {
					points: [
						{ date: '2026-03-01', searches: 2000 },
						{ date: '2026-03-30', searches: 1400 },
					],
				},
			},
		});

		expect(scenario.label).toBe('축소 시나리오');
		expect(scenario.bucket).toBe('BUDGET_DECREASE');
	});

	it('뚜렷한 증가나 감소가 없으면 방어 시나리오를 반환한다', () => {
		const scenario = deriveTrendScenario({
			keywordSummary: {
				totalSearch: 18000,
				avgCtr: 1.4,
			},
			trend: {
				estimatedDailySearches: {
					points: [
						{ date: '2026-03-01', searches: 1000 },
						{ date: '2026-03-30', searches: 1050 },
					],
				},
			},
		});

		expect(scenario.label).toBe('방어 시나리오');
		expect(scenario.bucket).toBe('RISK_HOLD');
	});

	it('숫자 포맷 헬퍼는 표시 규칙을 유지한다', () => {
		expect(formatNumber(54000)).toBe('54,000');
		expect(formatNumber(null)).toBe('-');
		expect(formatPercentRounded(0.8333)).toBe('83%');
		expect(formatPercentRounded(null)).toBe('-');
		expect(formatCtrPercent(2.14)).toBe('2.1%');
		expect(formatCtrPercent(null)).toBe('-');
	});
});
