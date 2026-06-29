export type ReviewProductOverviewItem = {
	product_url: string;
	product_title: string | null;
	review_count: number;
	average_rating: number;
	positive_ratio: number;
	negative_ratio: number;
};

export type ReviewRatingFilterValue = '1' | '2' | '3' | '4' | '5';

export function replyStatusClassName(status: string | null | undefined): string {
	switch (String(status || '').trim()) {
		case 'enrichment_target':
			return 'is-pending';
		case 'completed':
			return 'is-completed';
		case 'approved':
			return 'is-approved';
		case 'pending':
			return 'is-pending';
		case 'rejected':
			return 'is-rejected';
		default:
			return 'is-new';
	}
}

export function replyStatusDescription(status: string | null | undefined): string {
	switch (String(status || '').trim()) {
		case 'new':
			return '미작성: 아직 실제 답글도 없고 생성된 초안도 없는 상태입니다.';
		case 'pending':
			return '검토대기: 초안은 생성되었지만 아직 관리자가 승인하지 않은 상태입니다.';
		case 'approved':
			return '승인: 관리자가 초안을 검토해 승인했고 복사 가능한 상태입니다.';
		case 'enrichment_target':
			return '보강 대상: 스마트스토어에 답글은 존재하지만 학습용 답글 본문은 아직 수집되지 않은 상태입니다.';
		case 'completed':
			return '완료: 스마트스토어 실제 답글 본문까지 수집되어 학습/분석에 바로 사용할 수 있는 상태입니다.';
		case 'rejected':
			return '반려: 초안은 있었지만 관리자 검토 후 채택하지 않은 상태입니다.';
		default:
			return '현재 답글 작업 상태입니다.';
	}
}

export function replyCollectStatusClassName(status: string | null | undefined): string {
	switch (String(status || '').trim()) {
		case 'done':
			return 'is-approved';
		case 'skipped':
			return 'is-completed';
		case 'failed':
			return 'is-rejected';
		default:
			return 'is-pending';
	}
}

export function normalizeReviewRatingFilterValue(rating: unknown): ReviewRatingFilterValue | null {
	const numeric = Number(rating);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	const rounded = Math.round(numeric);
	if (rounded < 1 || rounded > 5) return null;
	return String(rounded) as ReviewRatingFilterValue;
}

export function canonicalizeReviewProductUrl(value: string | null | undefined): string {
	const raw = String(value || '').trim();
	if (!raw) return '';
	try {
		const normalized = raw.toLowerCase().startsWith('smartstore.naver.com/') ? `https://${raw}` : raw;
		const parsed = new URL(normalized);
		if (parsed.hostname.includes('smartstore.naver.com')) {
			return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
		}
		return normalized.replace(/[?#].*$/, '').replace(/\/+$/, '');
	} catch {
		return raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
	}
}

export function extractReviewProductIdentity(value: string | null | undefined): string {
	const raw = String(value || '').trim();
	if (!raw) return '';
	const uploadMatch = raw.match(/product\/([0-9]{1,})/i);
	if (uploadMatch?.[1]) return uploadMatch[1];
	const smartstoreMatch = raw.match(/\/products\/([0-9]{1,})/i);
	if (smartstoreMatch?.[1]) return smartstoreMatch[1];
	return '';
}

export function buildReviewProductOverview(items: ReviewProductOverviewItem[]): ReviewProductOverviewItem[] {
	const merged = new Map<
		string,
		ReviewProductOverviewItem & { weightedRatingSum: number; positiveCount: number; negativeCount: number }
	>();
	for (const item of items || []) {
		const normalizedUrl = canonicalizeReviewProductUrl(item.product_url);
		const normalizedProductId = extractReviewProductIdentity(item.product_url);
		const normalizedTitle = String(item.product_title || '').trim();
		const mergeKey = normalizedProductId ? `pid:${normalizedProductId}` : normalizedTitle ? `title:${normalizedTitle.toLowerCase()}` : normalizedUrl;
		if (!mergeKey) continue;
		const reviewCount = Number(item.review_count || 0);
		const bucket = merged.get(mergeKey) || {
			product_url: normalizedUrl || item.product_url,
			product_title: normalizedTitle || item.product_title || null,
			review_count: 0,
			average_rating: 0,
			positive_ratio: 0,
			negative_ratio: 0,
			weightedRatingSum: 0,
			positiveCount: 0,
			negativeCount: 0,
		};
		const currentUrl = String(bucket.product_url || '');
		const incomingUrl = String(normalizedUrl || item.product_url || '');
		const shouldPromoteIncomingUrl =
			!currentUrl ||
			(currentUrl.startsWith('smartstore-review-upload://') && incomingUrl.startsWith('https://smartstore.naver.com/'));
		if (shouldPromoteIncomingUrl) {
			bucket.product_url = incomingUrl;
		}
		bucket.product_title = bucket.product_title || normalizedTitle || item.product_title || null;
		bucket.review_count += reviewCount;
		bucket.weightedRatingSum += (Number(item.average_rating || 0) || 0) * reviewCount;
		bucket.positiveCount += (Number(item.positive_ratio || 0) || 0) * reviewCount;
		bucket.negativeCount += (Number(item.negative_ratio || 0) || 0) * reviewCount;
		merged.set(mergeKey, bucket);
	}
	return Array.from(merged.values())
		.map((item) => ({
			product_url: item.product_url,
			product_title: item.product_title,
			review_count: item.review_count,
			average_rating: item.review_count > 0 ? item.weightedRatingSum / item.review_count : 0,
			positive_ratio: item.review_count > 0 ? item.positiveCount / item.review_count : 0,
			negative_ratio: item.review_count > 0 ? item.negativeCount / item.review_count : 0,
		}))
		.sort((a, b) => {
			if (b.review_count !== a.review_count) return b.review_count - a.review_count;
			return String(a.product_title || a.product_url || '').localeCompare(String(b.product_title || b.product_url || ''), 'ko');
		});
}
