import type { CreativeAggRow } from './AdsCreativesTable';

export function createCreativeRow(overrides: Partial<CreativeAggRow> = {}): CreativeAggRow {
	return {
		key: 'base',
		campaignName: 'C1',
		adgroupName: 'G1',
		creativeId: 'nad-a001-02-000000000000001',
		adType: 'POWERLINK_AD',
		creativeName: '소재A',
		productTitle: null,
		imageUrl: null,
		currentBid: 1000,
		prevCurrentBid: 1000,
		qualityIndex: 7,
		prevQualityIndex: 7,
		avgRank: 2.5,
		prevAvgRank: 2.5,
		metrics: { impressions: 10, clicks: 1, cost: 1000, conversions: 0, revenue: 0, ctr: 10, cpc: 1000, cvr: 0, roas: 0 },
		prevMetrics: { impressions: 10, clicks: 1, cost: 1000, conversions: 0, revenue: 0, ctr: 10, cpc: 1000, cvr: 0, roas: 0 },
		deltas: {
			impressions: { diff: 0, pct: null },
			clicks: { diff: 0, pct: null },
			cost: { diff: 0, pct: null },
			conversions: { diff: 0, pct: null },
			revenue: { diff: 0, pct: null },
			ctr: { diff: 0, pct: null },
			cpc: { diff: 0, pct: null },
			cvr: { diff: 0, pct: null },
			roas: { diff: 0, pct: null },
		},
		cpa: 0,
		prevCpa: 0,
		cpaDiff: 0,
		cpaPct: null,
		...overrides,
	};
}
