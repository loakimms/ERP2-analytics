import React, { useState } from 'react';

export type ListKeywordSummary = {
	keyword: string;
	rank: number | null;
	delta: number | null;
};

type RectLike = {
	top: number;
	left: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
};

export function computeKeywordPopoverStyle(params: {
	anchorRect: RectLike;
	viewportWidth: number;
	viewportHeight: number;
	preferredWidth?: number;
	padding?: number;
	gap?: number;
	maxHeight?: number;
	/**
	 * 화면 하단 영역에서는 아래로 띄우지 않고 위로 띄우도록 강제.
	 * (리스트 하단에서 팝오버가 화면 밖/스크롤 영역 아래로 흘러내리는 UX 방지)
	 */
	preferTopIfAnchorBelowRatio?: number;
}): { style: React.CSSProperties; placement: 'top' | 'bottom' } {
	const padding = Number(params.padding ?? 8);
	// 기본 간격은 촘촘하게(사용자가 “간격이 너무 넓다” 이슈 제기)
	const gap = Number(params.gap ?? 2);
	const vw = Math.max(0, Number(params.viewportWidth) || 0);
	const vh = Math.max(0, Number(params.viewportHeight) || 0);
	const preferredWidth = Math.max(220, Math.min(520, Number(params.preferredWidth ?? 340)));
	const maxHeight = Math.max(160, Math.min(Number(params.maxHeight ?? 360), Math.max(160, vh - padding * 2)));
	const preferTopRatio = Math.max(0.2, Math.min(0.9, Number(params.preferTopIfAnchorBelowRatio ?? 0.55)));

	const rect = params.anchorRect;
	// left는 anchor 기준으로 잡되, 화면 밖으로 나가지 않게 clamp
	let left = rect.left;
	left = Math.max(padding, Math.min(left, Math.max(padding, vw - padding - preferredWidth)));

	// 아래로 펼쳤을 때 화면 밖으로 나가면 위로 뒤집는다.
	const bottomTop = rect.bottom + gap;
	const bottomWouldOverflow = bottomTop + maxHeight > vh - padding;
	const isAnchorInLowerViewport = rect.top >= vh * preferTopRatio;
	let placement: 'top' | 'bottom' = isAnchorInLowerViewport || bottomWouldOverflow ? 'top' : 'bottom';

	// “위로 띄우기”에서 height를 가정하면(=maxHeight) 실제 높이보다 과하게 위로 밀리는 문제가 생김.
	// 따라서 위 배치에서는 bottom 기준으로 “붙여서” 계산해 간격이 과도하게 벌어지지 않게 한다.
	const bottomForTop = Math.max(padding, Math.min(vh - rect.top + gap, vh - padding));

	// top 배치인데 화면 상단 여유가 너무 없으면(너무 위쪽에 붙어 가독성↓) 아래로 전환
	// (하단 강제 영역은 isAnchorInLowerViewport에서 이미 대부분 top이므로, 여기서는 극단 케이스만 방어)
	const minTopRoom = padding + 120;
	if (placement === 'top' && rect.top < minTopRoom && !isAnchorInLowerViewport) {
		placement = 'bottom';
	}

	let top: number | undefined;
	let bottom: number | undefined;
	if (placement === 'bottom') {
		top = Math.max(padding, Math.min(bottomTop, Math.max(padding, vh - padding - maxHeight)));
	} else {
		bottom = bottomForTop;
	}

	return {
		placement,
		style: {
			position: 'fixed',
			// 기존 CSS(.rank-kw-popover)의 top:110% 같은 속성이 남아있어도
			// inline style로 명시적으로 auto 처리해서 간격/위치가 틀어지지 않게 한다.
			top: placement === 'bottom' ? top : 'auto',
			bottom: placement === 'top' ? bottom : 'auto',
			left,
			width: preferredWidth,
			maxHeight,
			overflowY: 'auto',
			// 팝오버가 카드 위에 안정적으로 떠야 함
			zIndex: 50,
		},
	};
}

export type TrackedProductListItem = {
	id: string;
	// id 는 내부적으로 product_url 과 동일하게 사용된다.
	imageUrl?: string | null;
	name: string;
	sellerName?: string | null;
	price?: number | null;
	reviewCount?: number | null;
	rating?: number | null;
	keywords: ListKeywordSummary[];
	/**
	 * 페이지 메트릭(리뷰/평점/가격 등) 오늘 스냅샷 수집 상태 표시용.
	 * - AppShell에서 계산해 내려줌(리스트 카드 우측에 표시)
	 */
	pageMetricsStatusText?: string | null;
	pageMetricsStatusOk?: boolean | null;
	pageMetricsStatusTitle?: string | null;
	pageMetricsDate?: string | null;
	pageMetricsTitle?: string | null;
	pageMetricsPrice?: number | null;
	pageMetricsReviewCount?: number | null;
	pageMetricsRating?: number | null;
	pageMetricsWishCount?: number | null;
	pageMetricsRegisteredDate?: string | null;
	pageMetricsRecentPurchaseCount?: number | null;
	pageMetricsRecentPurchaseWindow?: string | null;
	pageMetricsRecentRepurchaseCount?: number | null;
	pageMetricsRecentRepurchaseWindow?: string | null;
	pageMetricsRecentBadgeText?: string | null;
	pageMetricsHttpStatus?: number | null;
	pageMetricsError?: string | null;
};

export type KeywordRankLookupState = {
	keyword: string;
	dates: string[];
	byProduct: Record<string, Array<number | null>>;
	loading?: boolean;
	error?: string | null;
};

export type RankTrackingListViewProps = {
	channel: 'naver' | 'coupang';
	products: TrackedProductListItem[];
	onAddProduct: (url: string) => void;
	onSelectProduct: (id: string) => void;
	onDeleteProduct: (id: string) => void;
	onLookupKeywordRanks?: (keyword: string) => void;
	keywordRankLookup?: KeywordRankLookupState | null;
	/** 리스트 화면에서 "오늘 수집/재수집" 모달을 수동으로 열기 */
	onOpenCollectModal?: () => void;
};

function normalizeUrl(input: string): string | null {
	const s = String(input ?? '').trim();
	if (!s) return null;
	if (!/^https?:\/\//i.test(s)) return null;
	try {
		const u = new URL(s);
		u.hash = '';
		return u.toString();
	} catch {
		return null;
	}
}

export function trackedProductsToJson(products: TrackedProductListItem[]): string {
	const urls: string[] = [];
	const seen = new Set<string>();
	for (const p of products) {
		const u = normalizeUrl(p.id);
		if (!u) continue;
		if (seen.has(u)) continue;
		seen.add(u);
		urls.push(u);
	}
	return JSON.stringify({ urls }, null, 2) + '\n';
}

/**
 * 4-2 랭킹 추적: 상품 추가 + 리스트 화면
 *
 * 네이버 랭킹추적 UI를 참고하여 상단 채널/URL 입력 영역과
 * 하단 상품 카드 리스트를 구성한다.
 */
export const RankTrackingListView: React.FC<RankTrackingListViewProps> = ({
	channel,
	products,
	onAddProduct,
	onSelectProduct,
	onDeleteProduct,
	onLookupKeywordRanks,
	keywordRankLookup,
	onOpenCollectModal,
}) => {
	const [inputUrl, setInputUrl] = useState('');
	const [lookupKeyword, setLookupKeyword] = useState('');

	const MAX_PRODUCTS = 10;

	const totalKeywords = products.reduce((sum, p) => sum + p.keywords.length, 0);
	const nearLimit = products.length >= MAX_PRODUCTS;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const url = inputUrl.trim();
		if (!url) return;
		onAddProduct(url);
		setInputUrl('');
	};

	const handleLookupSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const keyword = lookupKeyword.trim();
		if (!keyword || !onLookupKeywordRanks) return;
		onLookupKeywordRanks(keyword);
	};

	const isNaver = channel === 'naver';

	const formatWindowShortKo = (w: string | null | undefined): string | null => {
		const s = String(w || '').trim();
		if (!s) return null;
		const m = s.match(/^(\d+)\s*d$/i);
		if (m) {
			const d = Number(m[1]);
			if (d === 7) return '1주';
			if (d % 7 === 0) return `${Math.floor(d / 7)}주`;
			return `${d}일`;
		}
		const m2 = s.match(/^(\d+)\s*m$/i);
		if (m2) return `${Number(m2[1])}개월`;
		return s;
	};

	return (
		<div className="rank-list-root">
			{/* 상단: 채널 선택 + URL 입력 */}
			<div className="card" style={{ marginBottom: 12 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
						<div style={{ fontSize: 13, fontWeight: 600 }}>일간 랭킹추적</div>
						<div className="rank-channel-toggle" aria-label="판매 채널 선택">
							<button
								type="button"
								className={`rank-channel-btn${isNaver ? ' active' : ''}`}
							>
								네이버쇼핑
							</button>
							<button
								type="button"
								className="rank-channel-btn disabled"
								disabled
							>
								쿠팡
							</button>
						</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<div style={{ fontSize: 11, color: '#9ca3af' }}>스마트스토어 상품 URL 기준</div>
						{onOpenCollectModal && products.length > 0 && (
							<button
								type="button"
								className="btn-ghost"
								style={{ fontSize: 11 }}
								onClick={() => onOpenCollectModal()}
							>
								오늘 수집/재수집
							</button>
						)}
					</div>
				</div>

				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						marginBottom: 8,
						fontSize: 11,
						color: '#9ca3af',
					}}
				>
					<div>
						추천 상품수 {products.length}/{MAX_PRODUCTS} · 추천 키워드수 {totalKeywords}
					</div>
					{nearLimit && (
						<div style={{ color: '#f97373' }}>
							상품 등록 한도까지 얼마 남지 않았어요. 불필요한 상품을 정리해 주세요.
						</div>
					)}
				</div>

				<form
					onSubmit={handleSubmit}
					className="rank-url-form"
					aria-label="상품 추가 폼"
				>
					<input
						className="input rank-url-input"
						placeholder="스마트스토어 상품 URL을 입력하세요"
						value={inputUrl}
						onChange={(e) => setInputUrl(e.target.value)}
					/>
					<button type="submit" className="btn-primary rank-url-submit">
						상품 추가
					</button>
				</form>
				<form
					onSubmit={handleLookupSubmit}
					className="rank-url-form"
					aria-label="추적 키워드 순위 조회 폼"
					style={{ marginTop: 8 }}
				>
					<input
						className="input rank-url-input"
						placeholder="추적 키워드를 입력하세요"
						value={lookupKeyword}
						onChange={(e) => setLookupKeyword(e.target.value)}
					/>
					<button type="submit" className="btn-primary rank-url-submit" disabled={!lookupKeyword.trim() || keywordRankLookup?.loading}>
						{keywordRankLookup?.loading ? '조회 중...' : '조회'}
					</button>
				</form>
				{keywordRankLookup?.error ? (
					<div style={{ marginTop: 6, color: '#fca5a5', fontSize: 11 }}>
						{keywordRankLookup.error}
					</div>
				) : null}
			</div>

			{/* 하단: 상품 리스트 */}
			<div className="card">
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						marginBottom: 8,
					}}
				>
					<div style={{ fontSize: 13, fontWeight: 600 }}>상품 목록</div>
					<div style={{ fontSize: 11, color: '#9ca3af' }}>
						등록 상품 수 {products.length}개
					</div>
				</div>

				<div className="rank-product-list">
					{products.length === 0 && (
						<div className="rank-product-empty">
							등록된 상품이 없습니다. 상단에서 스마트스토어 URL을 추가해 주세요.
						</div>
					)}

					{products.map((product) => {
						// 리스트 화면 성능 최적화:
						// - 초기 로딩에서는 "핵심 키워드"만 내려오도록 구성한다(AppShell에서 필터링).
						// - 여기서는 전달받은 키워드만 표시한다.
						const keywordsToShow = product.keywords.slice(0, 5);
						const statusText = (product.pageMetricsStatusText ?? '').trim();
						const statusOk = Boolean(product.pageMetricsStatusOk);
						const statusClass =
							statusText
								? `rank-product-status ${statusOk ? 'ok' : 'miss'}`
								: 'rank-product-status';
						// 가격은 API/메타데이터 소스가 기준(크롤링 값으로 덮어쓰지 않음)
						const displayPrice = product.price ?? product.pageMetricsPrice ?? null;
						const displayReviewCount = product.pageMetricsReviewCount ?? product.reviewCount ?? null;
						const displayRating = product.pageMetricsRating ?? product.rating ?? null;
						const displayWishCount =
							typeof product.pageMetricsWishCount === 'number' ? product.pageMetricsWishCount : null;
						const recentPurchaseCount =
							typeof product.pageMetricsRecentPurchaseCount === 'number' ? product.pageMetricsRecentPurchaseCount : null;
						const recentRepurchaseCount =
							typeof product.pageMetricsRecentRepurchaseCount === 'number' ? product.pageMetricsRecentRepurchaseCount : null;
						// 4개 출력 항목(상단 2개는 계산 결과를 항상 표기)
						const expectedSales7d = recentPurchaseCount != null ? Math.max(0, Math.round(recentPurchaseCount)) : null;
						const expectedRevenue7dManwon =
							expectedSales7d != null && displayPrice != null ? Math.max(0, Math.round((expectedSales7d * displayPrice) / 10000)) : null;
						const lookupRanks = keywordRankLookup?.keyword
							? (keywordRankLookup.byProduct[product.id] ?? [])
							: [];

						return (
							<div
								key={product.id}
								className="rank-product-card"
								onClick={() => onSelectProduct(product.id)}
								role="button"
								tabIndex={0}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSelectProduct(product.id);
									}
								}}
							>
								{/* 우측 상단 삭제 버튼 */}
								<button
									type="button"
									className="btn-ghost"
									style={{
										position: 'absolute',
										top: 8,
										right: 8,
										fontSize: 11,
										color: '#9ca3af',
									}}
									onClick={(e) => {
										e.stopPropagation();
										onDeleteProduct(product.id);
									}}
								>
									삭제
								</button>

								{/* 좌측 이미지 */}
								<div className="rank-product-thumb">
									{product.imageUrl ? (
										<img
											src={product.imageUrl}
											alt={product.name}
											className="rank-product-thumb-img"
										/>
									) : (
										<span className="rank-product-thumb-placeholder">이미지</span>
									)}
								</div>

								{/* 중앙 정보 */}
								<div className="rank-product-main">
									<div className="rank-product-title">{product.name}</div>
									<div className="rank-product-meta">
										{product.sellerName && <span>{product.sellerName}</span>}
										{displayPrice != null && (
											<span>{displayPrice.toLocaleString()}원</span>
										)}
										<span>
											리뷰 {displayReviewCount != null ? displayReviewCount.toLocaleString() : '-'}
										</span>
										<span>
											평점 {displayRating != null ? displayRating.toFixed(2) : '-'}
										</span>
										<span>
											찜 {displayWishCount != null ? displayWishCount.toLocaleString() : '-'}
										</span>
										<span style={{ color: '#cbd5e1' }}>
											예상판매량(7일) {expectedSales7d != null ? expectedSales7d.toLocaleString() : '-'}건
										</span>
										<span style={{ color: '#cbd5e1' }}>
											예상매출액(7일) {expectedRevenue7dManwon != null ? expectedRevenue7dManwon.toLocaleString() : '-'}만원
										</span>
										{recentPurchaseCount != null ? (
											<span style={{ color: '#cbd5e1' }}>
												최근 1주간 {recentPurchaseCount.toLocaleString()}명 구매
											</span>
										) : null}
										{recentRepurchaseCount != null ? (
											<span style={{ color: '#94a3b8' }}>
												최근 3개월간 {recentRepurchaseCount.toLocaleString()}명 재구매(참고)
											</span>
										) : null}
									</div>
									<div className="rank-product-keywords">
										{keywordsToShow.map((k) => (
											<span key={k.keyword} className="rank-kw-chip">
												<span className="rank-kw-text">{k.keyword}</span>
												<span className="rank-kw-rank">{typeof k.rank === 'number' && k.rank > 0 ? `${k.rank}위` : '-'}</span>
												<span
													className={
														typeof k.delta === 'number' && typeof k.rank === 'number' && k.rank > 0
															? k.delta > 0
																? 'rank-kw-delta up'
																: k.delta < 0
																	? 'rank-kw-delta down'
																	: 'rank-kw-delta'
															: 'rank-kw-delta'
													}
												>
													{typeof k.delta === 'number' && typeof k.rank === 'number' && k.rank > 0
														? k.delta > 0
															? `▲${k.delta}`
															: k.delta < 0
																? `▼${Math.abs(k.delta)}`
																: '-'
														: '-'}
												</span>
											</span>
										))}
									</div>
								</div>

								{/* 우측: 오늘 수집 상태(YYYY/MM/DD 정상수집 / 부분수집 / 미수집) */}
								{keywordRankLookup?.keyword && (
									<div
										className="rank-product-lookup"
										onClick={(e) => e.stopPropagation()}
										role="note"
										aria-label={`${keywordRankLookup.keyword} 최근 7일 순위`}
									>
										<div style={{ color: '#93c5fd', fontWeight: 900, textAlign: 'center', fontSize: 13 }}>
											{keywordRankLookup.keyword} · 최근 7일
										</div>
										<div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, keywordRankLookup.dates.length)}, minmax(44px, 1fr))`, gap: 6 }}>
											{keywordRankLookup.dates.map((date, idx) => {
												const rank = lookupRanks[idx] ?? null;
												return (
													<div key={`${product.id}-${date}`} style={{ textAlign: 'center', display: 'grid', gap: 3 }}>
														<div style={{ color: '#94a3b8', fontSize: 12 }}>{date.slice(5).replace('-', '.')}</div>
														<div style={{ color: rank != null ? '#86efac' : '#cbd5e1', fontWeight: 900, fontSize: 13 }}>
															{rank != null ? `${rank}위` : '순위밖'}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								)}
								{statusText && (
									<div
										className={statusClass}
										title={product.pageMetricsStatusTitle || undefined}
										onClick={(e) => {
											// 카드 전체 클릭(상세 이동)과 분리: 상태 영역 클릭은 기본 동작 막음
											e.stopPropagation();
										}}
										role="note"
									>
										{statusText}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};


