import { describe, expect, it } from 'vitest';
import { mergeGfaAdgroupInventoryRows, mergeGfaCampaignInventoryRows } from './AdsViews';
import { computeAdsCampaignAgg } from './adsAgg';
import type { AdgroupDailyAggRow, AdgroupInventoryRow, CampaignDailyAggRow, CampaignInventoryRow } from './adsApi';

const campaignRow = (partial: Partial<CampaignDailyAggRow> & Pick<CampaignDailyAggRow, 'date' | 'campaign_name' | 'cost'>): CampaignDailyAggRow => ({
	date: partial.date,
	campaign_name: partial.campaign_name,
	impressions: partial.impressions ?? 0,
	clicks: partial.clicks ?? 0,
	cost: partial.cost,
	conversions: partial.conversions ?? 0,
	revenue: partial.revenue ?? 0,
	purchase_conversions: partial.purchase_conversions ?? 0,
	purchase_revenue: partial.purchase_revenue ?? 0,
	ctr: partial.ctr ?? 0,
	cpc: partial.cpc ?? 0,
	cvr: partial.cvr ?? 0,
	roas: partial.roas ?? 0,
	is_active: partial.is_active,
	campaign_status: partial.campaign_status,
});

const adgroupRow = (partial: Partial<AdgroupDailyAggRow> & Pick<AdgroupDailyAggRow, 'date' | 'campaign_name' | 'adgroup_name' | 'cost'>): AdgroupDailyAggRow => ({
	date: partial.date,
	campaign_name: partial.campaign_name,
	adgroup_name: partial.adgroup_name,
	impressions: partial.impressions ?? 0,
	clicks: partial.clicks ?? 0,
	cost: partial.cost,
	conversions: partial.conversions ?? 0,
	revenue: partial.revenue ?? 0,
	purchase_conversions: partial.purchase_conversions ?? 0,
	purchase_revenue: partial.purchase_revenue ?? 0,
	ctr: partial.ctr ?? 0,
	cpc: partial.cpc ?? 0,
	cvr: partial.cvr ?? 0,
	roas: partial.roas ?? 0,
	is_active: partial.is_active,
	adgroup_status: partial.adgroup_status,
});

describe('GFA inventory merge helpers', () => {
	it('캠페인 inventory 보강 시 여러 날짜 성과 행을 대표 1개로 줄이지 않는다', () => {
		const rows = [
			campaignRow({ date: '2026-08-16', campaign_name: 'CAMP_A', cost: 100, revenue: 1000 }),
			campaignRow({ date: '2026-08-17', campaign_name: 'CAMP_A', cost: 200, revenue: 2000 }),
		];
		const inventory: CampaignInventoryRow[] = [{ campaign_name: 'CAMP_A', is_active: true, campaign_status: '운영중' }];

		const merged = mergeGfaCampaignInventoryRows(rows, inventory, '2026-08-17');
		const agg = computeAdsCampaignAgg({ viewKind: 'campaign', curr: merged as any, prev: [] });

		expect(merged).toHaveLength(2);
		expect(merged.every((row) => row.is_active === true)).toBe(true);
		expect(agg.totalRow?.metrics.cost).toBe(300);
		expect(agg.totalRow?.metrics.revenue).toBe(3000);
	});

	it('광고그룹 inventory 보강 시 여러 날짜 성과 행을 대표 1개로 줄이지 않는다', () => {
		const rows = [
			adgroupRow({ date: '2026-08-16', campaign_name: 'CAMP_A', adgroup_name: 'GROUP_A', cost: 100, revenue: 1000 }),
			adgroupRow({ date: '2026-08-17', campaign_name: 'CAMP_A', adgroup_name: 'GROUP_A', cost: 200, revenue: 2000 }),
		];
		const inventory: AdgroupInventoryRow[] = [{ campaign_name: 'CAMP_A', adgroup_name: 'GROUP_A', is_active: true, adgroup_status: '운영중' }];

		const merged = mergeGfaAdgroupInventoryRows(rows, inventory, '2026-08-17');
		const agg = computeAdsCampaignAgg({ viewKind: 'adgroup', curr: merged as any, prev: [] });

		expect(merged).toHaveLength(2);
		expect(merged.every((row) => row.is_active === true)).toBe(true);
		expect(agg.totalRow?.metrics.cost).toBe(300);
		expect(agg.totalRow?.metrics.revenue).toBe(3000);
	});
});
