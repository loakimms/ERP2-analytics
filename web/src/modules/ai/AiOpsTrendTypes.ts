export type AiOpsTrendInsightsResponse = {
	keyword?: string;
	date_from?: string;
	date_to?: string;
	keywordSummary?: {
		totalSearch?: number | null;
		productCount?: number | null;
		avgCtr?: number | null;
	} | null;
	trend?: {
		estimatedDailySearches?: {
			points?: Array<{ date?: string; searches?: number | null }>;
		} | null;
	} | null;
	relatedKeywords?: Array<{
		relKeyword?: string | null;
		totalSearchQcCnt?: number | null;
		avgCtr?: number | null;
	}>;
	shopping?: {
		categoryPath?: string | null;
	} | null;
};

export type TrendScenario = {
	label: string;
	bucket: string;
	headline: string;
	bullets: string[];
};
