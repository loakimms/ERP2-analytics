import { describe, it, expect } from 'vitest';
import { computeAdsCampaignAgg, type AdgroupDailyAggRow, type CampaignDailyAggRow } from './adsAgg';

describe('adsAgg.computeAdsCampaignAgg', () => {
	it('campaign 모드에서 캠페인별로 집계하고 cost 내림차순으로 정렬한다', () => {
		const curr: CampaignDailyAggRow[] = [
			{
				campaign_name: 'CAMP_A',
				impressions: 10,
				clicks: 1,
				cost: 300,
				conversions: 0,
				revenue: 0,
				purchase_conversions: 0,
				purchase_revenue: 0,
				is_active: true,
				campaign_status: 'ACTIVE',
			},
			{
				campaign_name: 'CAMP_B',
				impressions: 20,
				clicks: 2,
				cost: 100,
				conversions: 1,
				revenue: 5000,
				purchase_conversions: 1,
				purchase_revenue: 5000,
				is_active: false,
				campaign_status: 'PAUSED',
			},
		];
		const prev: CampaignDailyAggRow[] = [
			{
				campaign_name: 'CAMP_A',
				impressions: 5,
				clicks: 1,
				cost: 200,
				conversions: 0,
				revenue: 0,
				purchase_conversions: 0,
				purchase_revenue: 0,
				is_active: true,
				campaign_status: 'ACTIVE',
			},
		];

		const res = computeAdsCampaignAgg({ viewKind: 'campaign', curr, prev });
		expect(res.totalRow).toBeTruthy();
		expect(res.rows.length).toBe(2);

		// cost 300(CAMP_A) > cost 100(CAMP_B)
		expect(res.rows[0]!.primary).toBe('CAMP_A');
		expect(res.rows[0]!.metrics.cost).toBe(300);
		expect(res.rows[0]!.status?.label).toBe('ACTIVE');
		expect(res.rows[0]!.status?.isActive).toBe(true);
		expect(res.rows[1]!.purchaseMetrics?.conversions).toBe(1);
		expect(res.rows[1]!.purchaseMetrics?.revenue).toBe(5000);
	});

	it('adgroup 모드에서 campaign+adgroup 키로 집계하고 secondary=campaign, primary=adgroup로 라벨링한다', () => {
		const curr: AdgroupDailyAggRow[] = [
			{
				campaign_name: 'CAMP_A',
				adgroup_name: 'GROUP_1',
				impressions: 10,
				clicks: 1,
				cost: 50,
				conversions: 0,
				revenue: 0,
				purchase_conversions: 0,
				purchase_revenue: 0,
				is_active: true,
				adgroup_status: 'RUNNING',
			},
			{
				campaign_name: 'CAMP_A',
				adgroup_name: 'GROUP_1',
				impressions: 10,
				clicks: 1,
				cost: 70,
				conversions: 0,
				revenue: 0,
				purchase_conversions: 0,
				purchase_revenue: 0,
				is_active: true,
				adgroup_status: 'RUNNING',
			},
		];
		const prev: AdgroupDailyAggRow[] = [];

		const res = computeAdsCampaignAgg({ viewKind: 'adgroup', curr, prev });
		expect(res.rows.length).toBe(1);
		expect(res.rows[0]!.primary).toBe('GROUP_1');
		expect(res.rows[0]!.secondary).toBe('CAMP_A');
		expect(res.rows[0]!.metrics.cost).toBe(120);
		expect(res.rows[0]!.status?.label).toBe('RUNNING');
	});
});

