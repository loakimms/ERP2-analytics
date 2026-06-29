export type HashtagAuditTag = {
	tag: string;
	ok: boolean;
};

export type HashtagAuditProduct = {
	rank: number;
	title: string;
	link: string | null;
	mallName: string | null;
	hashtags: HashtagAuditTag[];
	manuTags: string[];
	fetchDebug?: Record<string, unknown>;
};

export type HashtagAuditSummaryRow = { tag: string; count: number };

export type HashtagAuditResponse = {
	keyword: string;
	productCount: number;
	products: HashtagAuditProduct[];
	summary: {
		okTags: HashtagAuditSummaryRow[];
		filteredTags: HashtagAuditSummaryRow[];
	};
	source?: { provider?: string; error?: string | null };
	debug?: Record<string, unknown>;
};

export type ShoppingTagsProduct = {
	rank: number;
	title: string;
	link: string | null;
	mallName?: string | null;
	tags: string[];
};

export type ShoppingTagsResponse = {
	keyword: string;
	productCount: number;
	products: ShoppingTagsProduct[];
	debug?: Record<string, unknown>;
};


