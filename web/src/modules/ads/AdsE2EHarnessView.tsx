import React, { useMemo, useState } from 'react';
import { AdsTable, type AdsLeftColumnKey, type AdsMetricColumnKey, type AdsRow } from './AdsTables';
import { AdsCreativesTable, type CreativeAggRow, type CreativeColumnKey } from './AdsCreativesTable';
import { AdsColumnSettingsModal, type AdsColumnSettingOption } from './AdsColumnSettingsModal';

function selectedKeysFromHidden<K extends string>(availableKeys: K[], hiddenKeys: K[]): K[] {
	const hiddenSet = new Set(hiddenKeys);
	return availableKeys.filter((key) => !hiddenSet.has(key));
}

function hiddenKeysFromSelected<K extends string>(availableKeys: K[], selectedKeys: K[]): K[] {
	const selectedSet = new Set(selectedKeys);
	return availableKeys.filter((key) => !selectedSet.has(key));
}

const campaignRows: AdsRow[] = [
	{
		key: 'camp-1',
		status: { label: '운영중', isActive: true },
		primary: '캠페인 A',
		metrics: { impressions: 100, clicks: 10, ctr: 10, cpc: 1000, cost: 10000, conversions: 4, cvr: 40, revenue: 50000, roas: 500 },
		prevMetrics: { impressions: 90, clicks: 9, ctr: 10, cpc: 1000, cost: 9000, conversions: 3, cvr: 33.3333, revenue: 45000, roas: 500 },
		deltas: {
			impressions: { diff: 10, pct: (10 / 90) * 100 },
			clicks: { diff: 1, pct: (1 / 9) * 100 },
			ctr: { diff: 0, pct: 0 },
			cpc: { diff: 0, pct: 0 },
			cost: { diff: 1000, pct: (1000 / 9000) * 100 },
			conversions: { diff: 1, pct: (1 / 3) * 100 },
			cvr: { diff: 6.6667, pct: 20 },
			revenue: { diff: 5000, pct: (5000 / 45000) * 100 },
			roas: { diff: 0, pct: 0 },
		},
		purchaseMetrics: { conversions: 3, revenue: 30000 },
		prevPurchaseMetrics: { conversions: 2, revenue: 27000 },
	},
];

const adgroupRows: AdsRow[] = [
	{
		key: 'adg-1',
		status: { label: '운영중', isActive: true },
		primary: '광고그룹 A',
		secondary: '캠페인 A',
		metrics: { impressions: 100, clicks: 10, ctr: 10, cpc: 1000, cost: 10000, conversions: 4, cvr: 40, revenue: 50000, roas: 500 },
		prevMetrics: { impressions: 90, clicks: 9, ctr: 10, cpc: 1000, cost: 9000, conversions: 3, cvr: 33.3333, revenue: 45000, roas: 500 },
		deltas: {
			impressions: { diff: 10, pct: (10 / 90) * 100 },
			clicks: { diff: 1, pct: (1 / 9) * 100 },
			ctr: { diff: 0, pct: 0 },
			cpc: { diff: 0, pct: 0 },
			cost: { diff: 1000, pct: (1000 / 9000) * 100 },
			conversions: { diff: 1, pct: (1 / 3) * 100 },
			cvr: { diff: 6.6667, pct: 20 },
			revenue: { diff: 5000, pct: (5000 / 45000) * 100 },
			roas: { diff: 0, pct: 0 },
		},
		purchaseMetrics: { conversions: 3, revenue: 30000 },
		prevPurchaseMetrics: { conversions: 2, revenue: 27000 },
	},
];

const creativeRows: CreativeAggRow[] = [
	{
		key: 'creative-1',
		campaignName: '캠페인 A',
		adgroupName: '광고그룹 A',
		creativeId: 'nad-e2e-1',
		adType: 'SHOPPING_PRODUCT_AD',
		creativeName: '소재 A',
		productTitle: '상품 A',
		imageUrl: null,
		currentBid: 1000,
		prevCurrentBid: 900,
		qualityIndex: 7,
		prevQualityIndex: 6,
		avgRank: 2.5,
		prevAvgRank: 3.0,
		organicKeyword: '상품 A',
		organicRank: 5,
		prevOrganicRank: 7,
		organicRankSource: 'tracked_excel',
		metrics: { impressions: 100, clicks: 10, ctr: 10, cpc: 1000, cost: 10000, conversions: 4, cvr: 40, revenue: 50000, roas: 500 },
		prevMetrics: { impressions: 90, clicks: 9, ctr: 10, cpc: 1000, cost: 9000, conversions: 3, cvr: 33.3333, revenue: 45000, roas: 500 },
		deltas: {
			impressions: { diff: 10, pct: (10 / 90) * 100 },
			clicks: { diff: 1, pct: (1 / 9) * 100 },
			ctr: { diff: 0, pct: 0 },
			cpc: { diff: 0, pct: 0 },
			cost: { diff: 1000, pct: (1000 / 9000) * 100 },
			conversions: { diff: 1, pct: (1 / 3) * 100 },
			cvr: { diff: 6.6667, pct: 20 },
			revenue: { diff: 5000, pct: (5000 / 45000) * 100 },
			roas: { diff: 0, pct: 0 },
		},
		purchaseMetrics: { conversions: 3, revenue: 30000 },
		prevPurchaseMetrics: { conversions: 2, revenue: 27000 },
		cpa: 2500,
		prevCpa: 3000,
		cpaDiff: -500,
		cpaPct: (-500 / 3000) * 100,
	},
];

export function AdsE2EHarnessView(): JSX.Element {
	const [campaignSettingsOpen, setCampaignSettingsOpen] = useState(false);
	const [adgroupSettingsOpen, setAdgroupSettingsOpen] = useState(false);
	const [creativeSettingsOpen, setCreativeSettingsOpen] = useState(false);
	const [campaignHiddenKeys, setCampaignHiddenKeys] = useState<Array<AdsLeftColumnKey | AdsMetricColumnKey>>([]);
	const [adgroupHiddenKeys, setAdgroupHiddenKeys] = useState<Array<AdsLeftColumnKey | AdsMetricColumnKey>>([]);
	const [creativeHiddenKeys, setCreativeHiddenKeys] = useState<CreativeColumnKey[]>([]);

	const campaignLeftColumns = [{ key: 'status' as const, label: '운영' }, { key: 'primary' as const, label: '캠페인' }];
	const adgroupLeftColumns = [{ key: 'status' as const, label: '운영' }, { key: 'secondary' as const, label: '캠페인' }, { key: 'primary' as const, label: '광고그룹' }];
	const metricOptions: AdsColumnSettingOption[] = [
		{ key: 'impressions', label: '노출수', group: '성과 지표' },
		{ key: 'clicks', label: '클릭수', group: '성과 지표' },
		{ key: 'ctr', label: '클릭률(%)', group: '성과 지표' },
		{ key: 'cpc', label: '평균클릭비용', group: '성과 지표' },
		{ key: 'cost', label: '총비용', group: '성과 지표' },
		{ key: 'conversions', label: '총전환수', group: '성과 지표' },
		{ key: 'purchase_conversions', label: '구매전환수', group: '성과 지표' },
		{ key: 'cvr', label: '전환율(%)', group: '성과 지표' },
		{ key: 'revenue', label: '총전환매출액', group: '성과 지표' },
		{ key: 'purchase_revenue', label: '구매전환매출액', group: '성과 지표' },
		{ key: 'purchase_roas', label: '구매전환수익율(%)', group: '성과 지표' },
		{ key: 'roas', label: '광고수익률(%)', group: '성과 지표' },
	];

	const campaignOptions = [
		...campaignLeftColumns.map((column) => ({ key: column.key, label: column.label, group: '기본 정보' })),
		...metricOptions,
	];
	const adgroupOptions = [
		...adgroupLeftColumns.map((column) => ({ key: column.key, label: column.label, group: '기본 정보' })),
		...metricOptions,
	];
	const creativeOptions: AdsColumnSettingOption[] = [
		{ key: 'creative', label: '소재명', group: '기본 정보' },
		{ key: 'bid', label: '현재입찰가', group: '기본 정보' },
		{ key: 'quality', label: '품질/연관지수', group: '기본 정보' },
		{ key: 'avgRank', label: '평균노출순위/클릭기대지수', group: '기본 정보' },
		{ key: 'organicRank', label: '오가닉순위', group: '기본 정보' },
		{ key: 'impressions', label: '노출수', group: '성과 지표' },
		{ key: 'clicks', label: '클릭수', group: '성과 지표' },
		{ key: 'ctr', label: '클릭율(%)', group: '성과 지표' },
		{ key: 'cpc', label: '평균클릭비용', group: '성과 지표' },
		{ key: 'cost', label: '총비용', group: '성과 지표' },
		{ key: 'conversions', label: '총전환수', group: '성과 지표' },
		{ key: 'purchase_conversions', label: '구매전환수', group: '성과 지표' },
		{ key: 'cvr', label: '전환율(%)', group: '성과 지표' },
		{ key: 'revenue', label: '총전환매출액', group: '성과 지표' },
		{ key: 'purchase_revenue', label: '구매전환매출액', group: '성과 지표' },
		{ key: 'purchase_roas', label: '구매전환수익율(%)', group: '성과 지표' },
		{ key: 'roas', label: '광고수익율(%)', group: '성과 지표' },
		{ key: 'cpa', label: '전환당비용', group: '성과 지표' },
	];

	const campaignVisibleKeys = useMemo(
		() => selectedKeysFromHidden(
			campaignOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey),
			campaignHiddenKeys,
		),
		[campaignHiddenKeys],
	);
	const adgroupVisibleKeys = useMemo(
		() => selectedKeysFromHidden(
			adgroupOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey),
			adgroupHiddenKeys,
		),
		[adgroupHiddenKeys],
	);
	const creativeVisibleKeys = useMemo(
		() => selectedKeysFromHidden(
			creativeOptions.map((option) => option.key as CreativeColumnKey),
			creativeHiddenKeys,
		),
		[creativeHiddenKeys],
	);

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="card-title">Ads E2E Harness</div>
				<div style={{ fontSize: 12, color: '#9ca3af' }}>
					광고 분석 헤더 설정과 구매전환 컬럼 UI를 안정적으로 검증하기 위한 테스트 전용 화면입니다.
				</div>
			</div>

			<div data-testid="e2e-campaign-section" className="space-y-2">
				<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div style={{ fontSize: 14, fontWeight: 900 }}>캠페인 분석</div>
					<button type="button" className="btn-ghost" onClick={() => setCampaignSettingsOpen(true)}>사용자 설정</button>
				</div>
				<AdsTable
					title="캠페인 분석"
					columns={campaignLeftColumns.filter((column) => campaignVisibleKeys.includes(column.key))}
					visibleMetricKeys={metricOptions.map((option) => option.key as AdsMetricColumnKey).filter((key) => campaignVisibleKeys.includes(key))}
					rows={campaignRows}
					totalRow={campaignRows[0]}
				/>
			</div>

			<div data-testid="e2e-adgroup-section" className="space-y-2">
				<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div style={{ fontSize: 14, fontWeight: 900 }}>광고 그룹 분석</div>
					<button type="button" className="btn-ghost" onClick={() => setAdgroupSettingsOpen(true)}>사용자 설정</button>
				</div>
				<AdsTable
					title="광고 그룹 분석"
					columns={adgroupLeftColumns.filter((column) => adgroupVisibleKeys.includes(column.key))}
					visibleMetricKeys={metricOptions.map((option) => option.key as AdsMetricColumnKey).filter((key) => adgroupVisibleKeys.includes(key))}
					rows={adgroupRows}
					totalRow={adgroupRows[0]}
				/>
			</div>

			<div data-testid="e2e-creative-section" className="space-y-2">
				<div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<div style={{ fontSize: 14, fontWeight: 900 }}>소재 분석</div>
					<button type="button" className="btn-ghost" onClick={() => setCreativeSettingsOpen(true)}>사용자 설정</button>
				</div>
				<AdsCreativesTable
					title="소재 분석"
					rows={creativeRows}
					mode="shopping"
					visibleColumnKeys={creativeVisibleKeys}
					validationStatus="ok"
				/>
			</div>

			<AdsColumnSettingsModal
				open={campaignSettingsOpen}
				title="캠페인 분석"
				options={campaignOptions}
				selectedKeys={campaignVisibleKeys}
				onChange={(nextSelectedKeys) => {
					setCampaignHiddenKeys(
						hiddenKeysFromSelected(
							campaignOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey),
							nextSelectedKeys as Array<AdsLeftColumnKey | AdsMetricColumnKey>,
						),
					);
				}}
				onClose={() => setCampaignSettingsOpen(false)}
				onReset={() => setCampaignHiddenKeys([])}
			/>
			<AdsColumnSettingsModal
				open={adgroupSettingsOpen}
				title="광고 그룹 분석"
				options={adgroupOptions}
				selectedKeys={adgroupVisibleKeys}
				onChange={(nextSelectedKeys) => {
					setAdgroupHiddenKeys(
						hiddenKeysFromSelected(
							adgroupOptions.map((option) => option.key as AdsLeftColumnKey | AdsMetricColumnKey),
							nextSelectedKeys as Array<AdsLeftColumnKey | AdsMetricColumnKey>,
						),
					);
				}}
				onClose={() => setAdgroupSettingsOpen(false)}
				onReset={() => setAdgroupHiddenKeys([])}
			/>
			<AdsColumnSettingsModal
				open={creativeSettingsOpen}
				title="소재 분석"
				options={creativeOptions}
				selectedKeys={creativeVisibleKeys}
				onChange={(nextSelectedKeys) => {
					setCreativeHiddenKeys(
						hiddenKeysFromSelected(
							creativeOptions.map((option) => option.key as CreativeColumnKey),
							nextSelectedKeys as CreativeColumnKey[],
						),
					);
				}}
				onClose={() => setCreativeSettingsOpen(false)}
				onReset={() => setCreativeHiddenKeys([])}
			/>
		</div>
	);
}
