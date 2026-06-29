import { createRecentYmdRange } from './dateText';

export const REVIEW_ANALYSIS_DATE_RANGE_STORAGE_KEY = 'erp2-analytics.review-analysis.date-range.v1';

type ReviewDateRange = {
	from: string;
	to: string;
};

type DateRangeReader = Pick<Storage, 'getItem'> | null | undefined;
type DateRangeWriter = Pick<Storage, 'setItem'> | null | undefined;

function isYmdDateText(value: string | null | undefined): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

export function defaultReviewAnalysisDateRange(): ReviewDateRange {
	const { fromYmd, toYmd } = createRecentYmdRange(7);
	return { from: fromYmd, to: toYmd };
}

export function loadStoredReviewAnalysisDateRange(storage?: DateRangeReader): ReviewDateRange {
	const fallback = defaultReviewAnalysisDateRange();
	if (!storage) return fallback;
	try {
		const raw = storage.getItem(REVIEW_ANALYSIS_DATE_RANGE_STORAGE_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as { from?: string; to?: string } | null;
		const from = String(parsed?.from || '').trim();
		const to = String(parsed?.to || '').trim();
		if (!isYmdDateText(from) || !isYmdDateText(to)) return fallback;
		if (from > to) return fallback;
		return { from, to };
	} catch {
		return fallback;
	}
}

export function storeReviewAnalysisDateRange(storage: DateRangeWriter, range: ReviewDateRange): void {
	if (!storage) return;
	try {
		storage.setItem(REVIEW_ANALYSIS_DATE_RANGE_STORAGE_KEY, JSON.stringify({ from: range.from, to: range.to }));
	} catch {
		// ignore storage failures
	}
}
