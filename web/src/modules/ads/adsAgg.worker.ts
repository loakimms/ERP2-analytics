import {
	computeAdsCampaignAgg,
	computeAdsKeywordsUnifiedAgg,
	type AdsCampaignAggResult,
	type AdsKeywordsUnifiedAggResult,
	type AdgroupDailyAggRow,
	type AggTermRow,
	type CampaignDailyAggRow,
	type CampaignKindKey,
} from './adsAgg';

type Msg =
	| {
			kind: 'ads_keywords_unified';
			reqId: number;
			payload: {
				currByKind: Record<CampaignKindKey, AggTermRow[]>;
				prevByKind: Record<CampaignKindKey, AggTermRow[]>;
				mergeMode: boolean;
			};
	  };

type Reply =
	| { ok: true; kind: 'ads_keywords_unified'; reqId: number; result: AdsKeywordsUnifiedAggResult }
	| { ok: false; kind: 'ads_keywords_unified'; reqId: number; error: string };

type Msg2 =
	| {
			kind: 'ads_campaign_agg';
			reqId: number;
			payload: {
				viewKind: 'campaign' | 'adgroup';
				curr: Array<CampaignDailyAggRow | AdgroupDailyAggRow>;
				prev: Array<CampaignDailyAggRow | AdgroupDailyAggRow>;
			};
	  };

type Reply2 =
	| { ok: true; kind: 'ads_campaign_agg'; reqId: number; result: AdsCampaignAggResult }
	| { ok: false; kind: 'ads_campaign_agg'; reqId: number; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx: any = self;

ctx.onmessage = (ev: MessageEvent<Msg | Msg2>) => {
	const msg = ev.data;
	if (!msg) return;
	if (msg.kind === 'ads_keywords_unified') {
		try {
			const result = computeAdsKeywordsUnifiedAgg(msg.payload);
			const reply: Reply = { ok: true, kind: msg.kind, reqId: msg.reqId, result };
			ctx.postMessage(reply);
		} catch (e: any) {
			const reply: Reply = { ok: false, kind: msg.kind, reqId: msg.reqId, error: String(e?.message ?? e ?? 'worker error') };
			ctx.postMessage(reply);
		}
		return;
	}
	if (msg.kind === 'ads_campaign_agg') {
		try {
			const result = computeAdsCampaignAgg(msg.payload);
			const reply: Reply2 = { ok: true, kind: msg.kind, reqId: msg.reqId, result };
			ctx.postMessage(reply);
		} catch (e: any) {
			const reply: Reply2 = { ok: false, kind: msg.kind, reqId: msg.reqId, error: String(e?.message ?? e ?? 'worker error') };
			ctx.postMessage(reply);
		}
	}
};

