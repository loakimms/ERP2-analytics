export function deriveTrackedProductLabel(params: {
	url: string;
	index1: number; // 1-based
	metaTitle?: string | null;
	summaryTitle?: string | null;
	metricsTitle?: string | null;
}): string {
	const url = String(params.url || '').trim();
	const metaTitle = String(params.metaTitle ?? '').trim();
	const summaryTitle = String(params.summaryTitle ?? '').trim();
	const metricsTitle = String(params.metricsTitle ?? '').trim();

	// 1) 가장 신뢰 가능한 메타(title)
	if (metaTitle) return metaTitle;
	// 2) product-summary (DB/매칭 로직 기반)
	if (summaryTitle) return summaryTitle;
	// 3) 오늘 page-metrics에서 추출된 title
	if (metricsTitle) return metricsTitle;

	// 4) URL에서 최소한의 식별 정보(상품ID)라도 뽑아서 표기
	// - 스마트스토어: /products/<id>
	try {
		const u = new URL(url);
		const host = String(u.host || '').toLowerCase();
		const path = String(u.pathname || '');
		if (host.includes('smartstore.naver.com')) {
			const m = /\/products\/(\d+)/.exec(path);
			if (m?.[1]) return `스마트스토어 상품 ${m[1]}`;
		}
		// 네이버 쇼핑 item 계열 등: 마지막 path segment
		const seg = path.split('/').filter(Boolean).slice(-1)[0];
		if (seg) return `${host} / ${seg}`;
	} catch {
		// ignore
	}

	// 5) 최후 fallback
	return `상품 ${Math.max(1, Number(params.index1) || 1)}`;
}

