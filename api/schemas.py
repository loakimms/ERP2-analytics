from datetime import date, datetime
from typing import List, Optional, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class ModelNameCompatibleBaseModel(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class KeywordDaily(BaseModel):
    date: date
    campaign_name: str
    adgroup_name: str
    keyword: str
    device: str
    campaign_kind: str | None = None

    impressions: int
    clicks: int
    cost: int
    conversions: int
    revenue: int
    conversion_semantics: str = "total_plus_purchase"
    purchase_conversions: int = 0
    purchase_revenue: int = 0

    ctr: float
    cpc: float
    cvr: float
    roas: float

    source: str

    class Config:
        # SQLAlchemy ORM 객체에서 바로 변환할 수 있도록 허용
        from_attributes = True


class SearchwordDaily(BaseModel):
    date: date
    campaign_name: str
    adgroup_name: str
    searchword: str
    matched_keyword: str | None = None
    device: str
    campaign_kind: str | None = None

    impressions: int
    clicks: int
    cost: int
    conversions: int
    revenue: int
    conversion_semantics: str = "total_plus_purchase"
    purchase_conversions: int = 0
    purchase_revenue: int = 0

    ctr: float
    cpc: float
    cvr: float
    roas: float

    source: str

    class Config:
        from_attributes = True


class CampaignDailyAgg(BaseModel):
    date: date
    campaign_name: str
    campaign_status: str | None = None
    ended_on: str | None = None
    campaign_status_basis: str | None = None
    status_collected_at: datetime | None = None
    is_active: bool | None = None
    impressions: int
    clicks: int
    cost: int
    conversions: int
    revenue: int
    conversion_semantics: str = "total_plus_purchase"
    purchase_conversions: int = 0
    purchase_revenue: int = 0
    ctr: float
    cpc: float
    cvr: float
    roas: float


class CampaignInventoryItem(BaseModel):
    campaign_id: str | None = None
    campaign_name: str
    campaign_type: str | None = None
    menu_label: str | None = None
    onoff: str | None = None
    daily_budget: str | None = None
    campaign_status: str | None = None
    ended_on: str | None = None
    campaign_status_basis: str | None = None
    status_collected_at: datetime | None = None
    is_active: bool | None = None


class AdgroupInventoryItem(BaseModel):
    campaign_id: str | None = None
    campaign_name: str
    adgroup_id: str | None = None
    adgroup_name: str
    campaign_type: str | None = None
    menu_label: str | None = None
    onoff: str | None = None
    daily_budget: str | None = None
    campaign_status: str | None = None
    adgroup_status: str | None = None
    ended_on: str | None = None
    adgroup_status_basis: str | None = None
    status_collected_at: datetime | None = None
    is_active: bool | None = None


class CreativeInventoryItem(BaseModel):
    campaign_id: str | None = None
    campaign_name: str
    adgroup_id: str | None = None
    adgroup_name: str
    creative_id: str
    creative_name: str
    creative_status: str | None = None
    ended_on: str | None = None
    creative_status_basis: str | None = None
    status_collected_at: datetime | None = None
    is_active: bool | None = None
    image_url: str | None = None
    detail_collected_at: datetime | None = None
    detail_last_error: str | None = None
    creative_type: str | None = None
    profile_name: str | None = None
    profile_image_url: str | None = None
    primary_text: str | None = None
    headline: str | None = None
    description: str | None = None
    cta: str | None = None
    landing_url: str | None = None
    ad_type: str | None = None


class AdgroupDailyAgg(BaseModel):
    date: date
    campaign_name: str
    adgroup_name: str
    campaign_status: str | None = None
    adgroup_status: str | None = None
    ended_on: str | None = None
    adgroup_status_basis: str | None = None
    status_collected_at: datetime | None = None
    is_active: bool | None = None
    impressions: int
    clicks: int
    cost: int
    conversions: int
    revenue: int
    conversion_semantics: str = "total_plus_purchase"
    purchase_conversions: int = 0
    purchase_revenue: int = 0
    ctr: float
    cpc: float
    cvr: float
    roas: float


class CreativeDaily(BaseModel):
    date: date
    campaign_name: str
    adgroup_name: str
    creative_id: str
    device: str
    creative_status: str | None = None
    ended_on: str | None = None
    creative_status_basis: str | None = None
    status_collected_at: datetime | None = None
    is_active: bool | None = None

    creative_name: str
    # 파워링크 소재 화면 표시용: 광고센터의 "키워드" 컬럼에 맞춰 조회 시점에 보강한다.
    display_keyword: str | None = None
    product_title: str | None = None
    image_url: str | None = None
    detail_collected_at: datetime | None = None
    detail_last_error: str | None = None
    creative_type: str | None = None
    profile_name: str | None = None
    profile_image_url: str | None = None
    primary_text: str | None = None
    headline: str | None = None
    description: str | None = None
    cta: str | None = None
    landing_url: str | None = None
    current_bid: int | None = None
    quality_index: float | None = None
    avg_rank: float | None = None

    impressions: int
    clicks: int
    cost: int
    conversions: int
    revenue: int
    conversion_semantics: str = "total_plus_purchase"
    purchase_conversions: int = 0
    purchase_revenue: int = 0

    ctr: float
    cpc: float
    cvr: float
    roas: float

    source: str
    # 광고 유형(예: POWERLINK_AD, SHOPPING_PRODUCT_AD 등). 일부 환경에서는 추정치로 채워질 수 있다.
    ad_type: str | None = None

    # --- 4-2(내 상품 추적) 매칭 정보 (쇼핑소재 best-effort) ---
    # 매칭 상태:
    # - matched: 1개로 확정 매칭
    # - ambiguous: 후보가 여러 개라 확정 불가
    # - unmatched: 후보 없음
    # - no_image: 소재/상품 이미지가 없어 매칭 불가
    match_status: str | None = None
    # 매칭 규칙(현재는 image+title 또는 image_only)
    match_rule: str | None = None
    # 매칭된 4-2 상품 URL(확정 매칭일 때만)
    matched_product_url: str | None = None
    # 매칭된 4-2 상품명(TrackedProductMeta.title)
    matched_product_title: str | None = None

    # --- 오가닉(비광고) 순위: 4-2 등록 키워드 기반 ---
    organic_keyword: str | None = None
    organic_rank: int | None = None
    organic_rank_source: str | None = None  # tracked_excel | openapi | none
    # 오가닉 순위가 실제로 조회/적용된 날짜(데이터 지연/전일 반영 여부를 투명하게 표시하기 위함)
    organic_rank_date: date | None = None

    class Config:
        from_attributes = True

class ProductRankDaily(BaseModel):
    date: date
    keyword: str
    rank: int
    product_title: str
    mall_name: str
    price: int
    purchase_cnt: int
    is_our_brand: bool
    # 선택 필드: DB 컬럼에 존재할 경우 자동 매핑
    product_id: int | None = None
    image_url: str | None = None

    class Config:
        from_attributes = True


class ProductSummary(BaseModel):
    """
    메뉴4-2 내 상품 추적 상세 화면 상단에 표시할 상품 요약 정보.

    - keyword: 기준 키워드
    - product_title: 상품명
    - mall_name: 판매자/쇼핑몰명
    - price: 가격
    - purchase_cnt: 누적 구매/리뷰 수(소스 데이터 기준)
    - product_id: 네이버 상품 ID (선택)
    - image_url: 상품 이미지 URL (선택)
    """

    keyword: str
    product_title: str
    mall_name: str
    price: int
    purchase_cnt: int
    product_id: int | None = None
    image_url: str | None = None
    category_path: str | None = None
    brand: str | None = None
    maker: str | None = None


class ProductMetadata(BaseModel):
    """
    상품 상세 URL(예: 스마트스토어 상품 URL)을 직접 호출해서 추출한 메타 정보.

    - title: 페이지/상품 제목
    - image_url: 대표 이미지 URL
    - site_name: 사이트/몰 이름
    - price: 최저가(lprice) 기준 판매가
    - product_id: 네이버 쇼핑 productId (catalog ID)
    """

    title: str | None = None
    image_url: str | None = None
    site_name: str | None = None
    price: int | None = None
    product_id: int | None = None


class TrackedProductMetaRead(BaseModel):
    """
    URL 기준으로 저장된 상품 메타데이터 조회용 스키마.
    """

    product_url: str
    keyword: str | None = None
    title: str | None = None
    mall_name: str | None = None
    image_url: str | None = None
    price: int | None = None
    product_id_catalog: int | None = None
    tracking_mode: str | None = None

    class Config:
        from_attributes = True


class ProductTrackingModeRead(BaseModel):
    product_url: str
    tracking_mode: str


class ProductTrackingModeWrite(BaseModel):
    product_url: str
    tracking_mode: str


class RatingBucket(BaseModel):
    score: int
    count: int


class ProductAnalytics(BaseModel):
    """
    내 상품 분석(전일 기준)에서 사용하는 요약 지표.

    - expectedSales7d: 최근 7일간 예상 판매량(구매 건수 합계 등)
    - rating / totalReviews / reviewDelta / ratingBuckets 는
      리뷰/평점 수집 파이프라인이 구축된 이후 채워질 수 있다.
    """

    expectedSales7d: int | None = None
    rating: float | None = None
    totalReviews: int | None = None
    reviewDelta: int | None = None
    ratingBuckets: list[RatingBucket] = []


class ProductPageMetrics(BaseModel):
    """
    상품 상세 페이지에서 수집한 일자 스냅샷(비공식 HTML 기반).

    - tracked_product_page_daily 테이블의 조회/표시 용도
    """

    product_url: str
    date: date
    title: str | None = None
    price: int | None = None
    review_count: int | None = None
    rating: float | None = None
    delivery: str | None = None
    buy_count: int | None = None
    wish_count: int | None = None
    registered_date: date | None = None
    recent_purchase_count: int | None = None
    recent_purchase_window: str | None = None
    # 판매정보(최근 구매 배지) 수집 상태
    # - collected: 최근 구매 배지 수치 수집됨
    # - repurchase_only: 재구매만 노출/수집됨(구매는 미노출)
    # - not_visible: 구매/재구매 배지 미노출(랜덤/일시 노출로 못 잡은 경우 포함)
    # - no_badge: 해당 상품은 배지가 "원래 없음"으로 판단되어 자동 수집을 스킵(수동 입력으로 보강)
    # - not_supported: Playwright/CDP 미사용 환경이라 판매 배지 수집 불가
    recent_purchase_status: str | None = None
    recent_purchase_7d_count: int | None = None
    recent_repurchase_count: int | None = None
    recent_repurchase_window: str | None = None
    recent_repurchase_3m_count: int | None = None
    recent_badge_text: str | None = None
    http_status: int | None = None
    error: str | None = None

    class Config:
        from_attributes = True


class ProductPageMetricsCompare(BaseModel):
    """
    한 상품 URL에 대한 '최신 1건'과 '그 이전 1건' 페이지 메트릭 스냅샷.
    - /search-rank/page-metrics/compare 응답용
    """

    product_url: str
    latest: ProductPageMetrics | None = None
    prev: ProductPageMetrics | None = None


class ProductPageMetricsBatchRequest(BaseModel):
    urls: List[str]


class ProductSalesManualUpsert(BaseModel):
    product_url: str
    expected_sales_7d: int | None = None
    expected_revenue_7d_manwon: int | None = None
    recent_purchase_1w_count: int | None = None
    recent_repurchase_3m_count: int | None = None


class ProductSalesManual(BaseModel):
    product_url: str
    expected_sales_7d: int | None = None
    expected_revenue_7d_manwon: int | None = None
    recent_purchase_1w_count: int | None = None
    recent_repurchase_3m_count: int | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class ProductIndexManualUpsert(BaseModel):
    product_url: str
    weekly_views_7d: int | None = None
    wishes: int | None = None
    sales_7d_override: int | None = None
    sales_30d: int | None = None
    days_since_reg: int | None = None


class ProductIndexManual(BaseModel):
    product_url: str
    weekly_views_7d: int | None = None
    wishes: int | None = None
    sales_7d_override: int | None = None
    sales_30d: int | None = None
    days_since_reg: int | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class ProductIndexScores(BaseModel):
    click: int
    sales: int
    review: int
    recency: int
    penalty: int
    final: int


class ProductIndexDeltas(BaseModel):
    click: int | None = None
    sales: int | None = None
    review: int | None = None
    recency: int | None = None
    penalty: int | None = None
    final: int | None = None


class ProductIndexAnalyzeRequest(BaseModel):
    product_url: str
    # 미입력 시 오늘(KST)
    target_date: date | None = Field(default=None, alias="date")

    class Config:
        populate_by_name = True


class ProductIndexAnalyzeResponse(BaseModel):
    product_url: str
    date: date
    title: str | None = None
    image_url: str | None = None
    scores: ProductIndexScores
    deltas: ProductIndexDeltas
    inputs: dict
    explain: dict | None = None


class ProductIndexSuggestedInputs(BaseModel):
    """
    '소재분석(크리에이티브)'에 저장된 데이터를 기반으로,
    상품지수분석 입력값을 자동으로 제안한다.
    """

    product_url: str
    date_to: date
    date_from_7d: date
    date_from_30d: date

    weekly_views_7d: int | None = None
    wishes: int | None = None
    days_since_reg: int | None = None
    sales_7d: int | None = None
    sales_30d: int | None = None

    # 진단용: 매칭된 row 수(0이면 아직 매칭/저장이 안 된 것)
    matched_rows_30d: int = 0
    source: str = "creatives"  # creatives | none
    # 필드별 출처(정확성/검증용)
    sources: dict = {}


class ProductIndexHistoryItem(BaseModel):
    date: date
    scores: ProductIndexScores


class ProductIndexHistoryResponse(BaseModel):
    product_url: str
    items: list[ProductIndexHistoryItem] = []


class ProductIndexHistoryDetailedItem(BaseModel):
    date: date
    scores: ProductIndexScores
    # analyze 시점의 입력 스냅샷(디버그/재현용). 저장 당시 JSON을 그대로 복원한다.
    inputs: dict = {}


class ProductIndexHistoryDetailedResponse(BaseModel):
    product_url: str
    items: list[ProductIndexHistoryDetailedItem] = []


class ProductIndexBatchRunResponse(BaseModel):
    date: date
    status: str  # STARTED | SUCCESS | SKIPPED | FAILED
    total_targets: int = 0
    analyzed: int = 0
    failed: int = 0
    detail: str | None = None


class ProductIndexBackfillRequest(BaseModel):
    days: int = 14
    # 미입력 시 오늘(KST)
    date_to: date | None = Field(default=None, alias="date")
    # 미입력 시 내 상품 추적 목록 전체
    product_url: str | None = None

    class Config:
        populate_by_name = True


class ProductIndexBackfillResponse(BaseModel):
    date_from: date
    date_to: date
    days: int
    total_targets: int = 0
    analyzed: int = 0
    failed: int = 0
    detail: str | None = None


class ReviewDailyBackfillRequest(BaseModel):
    days: int = 14
    # 미입력 시 오늘(KST)
    date_to: date | None = Field(default=None, alias="date")
    # 미입력 시 내 상품 추적 목록 전체
    product_url: str | None = None

    class Config:
        populate_by_name = True


class ReviewDailyBackfillResponse(BaseModel):
    date_from: date
    date_to: date
    days: int
    total_targets: int = 0
    source_rows: int = 0
    saved: int = 0
    skipped: int = 0
    detail: str | None = None


class ReviewCollectRequest(BaseModel):
    product_url: str
    max_pages: int = 3
    max_items: int = 100


class ReviewCollectResponse(BaseModel):
    product_url: str
    product_title: str | None = None
    status: str = "pending"
    status_label: str = "대기"
    fetched: int = 0
    saved_reviews: int = 0
    saved_replies: int = 0
    skipped: int = 0
    detail: str | None = None


class ReviewCollectTrackedRequest(BaseModel):
    max_pages: int = 3
    max_items: int = 100
    max_targets: int = 100
    product_url: str | None = None
    date_from: date | None = None
    date_to: date | None = None


class ReviewCollectTrackedResponse(BaseModel):
    total_targets: int = 0
    processed_targets: int = 0
    date_from: date | None = None
    date_to: date | None = None
    fetched: int = 0
    saved_reviews: int = 0
    saved_replies: int = 0
    skipped: int = 0
    items: list[ReviewCollectResponse] = []
    detail: str | None = None


class ReviewRawItem(BaseModel):
    review_key: str
    product_url: str
    product_title: str | None = None
    product_id_catalog: int | None = None
    keyword: str | None = None
    review_id_original: str | None = None
    review_written_at: date | None = None
    rating: float | None = None
    option_text: str | None = None
    review_text: str
    reviewer_masked_id: str | None = None
    reply_text: str | None = None
    reply_written_at: date | None = None
    import_source: str | None = None
    reply_exists_flag: bool = False
    reply_collect_status: str | None = None
    collected_at: datetime | None = None


class ReviewReplyDraftGenerateRequest(BaseModel):
    review_key: str
    model: str | None = None
    force_regenerate: bool = False
    style_level: int = Field(default=3, ge=1, le=6)
    style_controls: dict[str, int] | None = None


class ReviewImportSmartstoreResponse(BaseModel):
    ok: bool = True
    filename: str
    processed_rows: int = 0
    saved_reviews: int = 0
    saved_replies: int = 0
    reply_exists_rows: int = 0
    reply_backfill_targets: int = 0
    matched_products: int = 0
    unmatched_products: int = 0
    imported_date_from: date | None = None
    imported_date_to: date | None = None
    detail: str | None = None


class ReviewReplyBackfillRequest(BaseModel):
    limit: int = 0
    max_pages: int = 30
    client_ip: str | None = None


class ReviewReplyBackfillItem(BaseModel):
    review_key: str
    review_id_original: str | None = None
    product_title: str | None = None
    status: str
    detail: str | None = None
    reply_written_at: date | None = None


class ReviewReplyBackfillResponse(BaseModel):
    ok: bool = True
    requested: int = 0
    processed: int = 0
    collected: int = 0
    failed: int = 0
    skipped: int = 0
    items: list[ReviewReplyBackfillItem] = []
    detail: str | None = None


class ReviewReplyBackfillJobResponse(BaseModel):
    ok: bool = True
    scheduled: bool = False
    job_id: str | None = None
    status: str = "IDLE"
    pending_targets: int = 0
    processed: int = 0
    collected: int = 0
    failed: int = 0
    skipped: int = 0
    detail: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ReviewReplyDraftResponse(ModelNameCompatibleBaseModel):
    ok: bool = True
    review_key: str
    draft_id: str
    status: str
    draft_text: str
    model_name: str | None = None
    prompt_version: str | None = None
    generated_now: bool = False
    review_text: str | None = None
    reply_text: str | None = None
    error_message: str | None = None
    generated_at: datetime | None = None
    review_type: str | None = None
    style_profile_source: str | None = None
    style_examples_count: int = 0
    style_similarity_score: int | None = None
    style_level: int = 3
    style_preset_id: str | None = None
    style_preset_name: str | None = None
    style_controls: dict[str, int] = Field(default_factory=dict)
    rejection_comment: str | None = None
    rejection_problem_summary: str | None = None
    rejection_analysis: dict = Field(default_factory=dict)


class ReviewReplyDraftBatchGenerateRequest(BaseModel):
    max_items: int = 10
    model: str | None = None
    product_url: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    rating_filters: list[str] = Field(default_factory=list)
    force_regenerate: bool = False
    include_existing: bool = False
    style_level: int = Field(default=3, ge=1, le=6)
    style_controls: dict[str, int] | None = None


class ReviewReplyDraftBatchGenerateResponse(BaseModel):
    ok: bool = True
    requested: int = 0
    processed: int = 0
    generated: int = 0
    reused: int = 0
    skipped_replied: int = 0
    skipped_existing: int = 0
    exhausted: bool = True
    items: list[ReviewReplyDraftResponse] = []


class ReviewReplyDraftListItem(ModelNameCompatibleBaseModel):
    draft_id: str
    review_key: str
    status: str
    draft_text: str
    model_name: str | None = None
    prompt_version: str | None = None
    error_message: str | None = None
    generated_at: datetime | None = None
    product_url: str
    review_written_at: date | None = None
    review_text: str
    option_text: str | None = None
    rating: float | None = None
    reviewer_masked_id: str | None = None
    reply_text: str | None = None
    review_type: str | None = None
    style_profile_source: str | None = None
    style_examples_count: int = 0
    style_similarity_score: int | None = None
    style_level: int = 3
    style_preset_id: str | None = None
    style_preset_name: str | None = None
    style_controls: dict[str, int] = Field(default_factory=dict)
    rejection_comment: str | None = None
    rejection_problem_summary: str | None = None
    rejection_analysis: dict = Field(default_factory=dict)


class ReviewReplyDraftRejectionCommentUpdateRequest(BaseModel):
    draft_id: str
    rejection_comment: str
    analyze_rejection: bool = True


class ReviewReplyDraftRejectionCommentDeleteRequest(BaseModel):
    draft_id: str


class ReviewReplyStylePresetFieldRecommendation(BaseModel):
    id: str
    label: str
    description: str
    why: str


class ReviewReplyStylePresetItem(BaseModel):
    level: int
    id: str
    name: str
    summary: str
    controls: dict[str, int] = Field(default_factory=dict)


class ReviewReplyStylePresetRecommendationResponse(BaseModel):
    ok: bool = True
    product_url: str | None = None
    corpus_examples: int = 0
    recommended_fields: list[ReviewReplyStylePresetFieldRecommendation] = Field(default_factory=list)
    presets: list[ReviewReplyStylePresetItem] = Field(default_factory=list)


class ReviewWorkbenchDashboard(BaseModel):
    total_reviews: int = 0
    new_reviews: int = 0
    completed_count: int = 0
    enrichment_target_count: int = 0
    unreplied_count: int = 0
    draft_pending_count: int = 0
    approved_count: int = 0
    rejected_count: int = 0
    rejection_history_count: int = 0


class ReviewWorkbenchItem(BaseModel):
    review_key: str
    product_url: str
    product_title: str | None = None
    review_written_at: date | None = None
    collected_at: datetime | None = None
    rating: float | None = None
    option_text: str | None = None
    review_text: str
    reviewer_masked_id: str | None = None
    reply_text: str | None = None
    reply_written_at: date | None = None
    reply_exists_flag: bool = False
    reply_collect_status: str | None = None
    reply_status: str
    reply_status_label: str
    draft_id: str | None = None
    draft_status: str | None = None
    draft_text: str | None = None
    can_copy: bool = False
    style_level: int | None = None
    style_preset_id: str | None = None
    style_preset_name: str | None = None
    style_controls: dict[str, int] = Field(default_factory=dict)
    rejection_comment: str | None = None
    rejection_problem_summary: str | None = None
    rejection_analysis: dict = Field(default_factory=dict)
    can_rewrite_from_rejection: bool = False
    has_rejection_history: bool = False
    rejection_history_count: int = 0


class ReviewWorkbenchResponse(BaseModel):
    ok: bool = True
    date_from: date | None = None
    date_to: date | None = None
    product_url: str | None = None
    dashboard: ReviewWorkbenchDashboard
    items: list[ReviewWorkbenchItem] = Field(default_factory=list)


class ReviewAnalysisSummary(BaseModel):
    total_reviews: int = 0
    average_rating: float = 0.0
    positive_reviews: int = 0
    neutral_reviews: int = 0
    negative_reviews: int = 0
    positive_ratio: float = 0.0
    negative_ratio: float = 0.0
    latest_review_count: int = 0
    previous_review_count: int = 0
    review_growth_rate: float = 0.0
    latest_average_rating: float = 0.0
    previous_average_rating: float = 0.0
    rating_delta: float = 0.0
    high_risk_category: str | None = None
    top_positive_category: str | None = None
    insight_summary: str | None = None


class ReviewAnalysisRatingDistribution(BaseModel):
    total_reviews: int = 0
    average_rating: float = 0.0
    counts: dict[str, int] = Field(default_factory=dict)
    ratios: dict[str, float] = Field(default_factory=dict)


class ReviewAnalysisTrendPoint(BaseModel):
    date: date
    review_count: int = 0
    average_rating: float = 0.0
    low_rating_count: int = 0
    low_rating_ratio: float = 0.0


class ReviewAnalysisKeywordInsightItem(BaseModel):
    keyword: str
    count: int = 0
    positive_count: int = 0
    negative_count: int = 0
    positive_ratio: float = 0.0
    negative_ratio: float = 0.0


class ReviewAnalysisKeywordInsights(BaseModel):
    top_keywords: list[ReviewAnalysisKeywordInsightItem] = Field(default_factory=list)
    rising_keywords: list[ReviewAnalysisKeywordInsightItem] = Field(default_factory=list)
    risk_keywords: list[ReviewAnalysisKeywordInsightItem] = Field(default_factory=list)


class ReviewAnalysisEvidenceItem(BaseModel):
    review_key: str
    review_text: str
    product_url: str | None = None
    product_title: str | None = None
    review_written_at: date | None = None
    rating: float | None = None


class ReviewAnalysisCategoryItem(BaseModel):
    category: str
    mention_count: int = 0
    positive_count: int = 0
    neutral_count: int = 0
    negative_count: int = 0
    positive_ratio: float = 0.0
    negative_ratio: float = 0.0
    average_rating: float = 0.0
    top_keywords: list[str] = Field(default_factory=list)
    positive_examples: list[ReviewAnalysisEvidenceItem] = Field(default_factory=list)
    negative_examples: list[ReviewAnalysisEvidenceItem] = Field(default_factory=list)
    headline: str | None = None
    value_summary: str | None = None
    concern_summary: str | None = None
    target_summary: str | None = None


class ReviewAnalysisActionItem(BaseModel):
    title: str
    detail: str
    priority: str = "medium"


class ReviewAnalysisSourceInfo(BaseModel):
    raw_review_count: int = 0
    daily_snapshot_count: int = 0
    product_count: int = 0
    last_review_date: date | None = None


class ReviewAnalysisProductOverviewItem(BaseModel):
    product_url: str
    product_title: str | None = None
    review_count: int = 0
    average_rating: float = 0.0
    positive_ratio: float = 0.0
    negative_ratio: float = 0.0


class ReviewAnalysisDashboardResponse(BaseModel):
    ok: bool = True
    date_from: date | None = None
    date_to: date | None = None
    product_url: str | None = None
    summary: ReviewAnalysisSummary
    rating_distribution: ReviewAnalysisRatingDistribution
    trend: list[ReviewAnalysisTrendPoint] = Field(default_factory=list)
    category_overview: list[ReviewAnalysisCategoryItem] = Field(default_factory=list)
    keyword_insights: ReviewAnalysisKeywordInsights
    action_items: list[ReviewAnalysisActionItem] = Field(default_factory=list)
    source_info: ReviewAnalysisSourceInfo
    product_overview: list[ReviewAnalysisProductOverviewItem] = Field(default_factory=list)


class ReviewReplyDraftStatusUpdateRequest(BaseModel):
    draft_id: str
    status: Literal["generated", "approved", "rejected", "superseded", "failed"]
    rejection_comment: str | None = None
    analyze_rejection: bool = True


class ReviewReplyDraftStatusUpdateResponse(BaseModel):
    ok: bool = True
    draft_id: str
    review_key: str
    status: str
    rejection_comment: str | None = None
    rejection_problem_summary: str | None = None
    rejection_analysis: dict = Field(default_factory=dict)


class ReviewReplyDraftUpdateRequest(BaseModel):
    draft_id: str
    draft_text: str


class ReviewReplyDraftUpdateResponse(BaseModel):
    ok: bool = True
    draft_id: str
    review_key: str
    status: str
    draft_text: str


class ReviewReplyDraftDeleteRequest(BaseModel):
    draft_id: str


class ReviewReplyDraftDeleteResponse(BaseModel):
    ok: bool = True
    draft_id: str
    review_key: str


class ReviewReplySubmitChannelStatus(BaseModel):
    ready: bool = False
    reason: str | None = None


class ReviewReplySubmitReadinessResponse(BaseModel):
    ok: bool = True
    draft_id: str
    review_key: str
    draft_status: str
    can_submit: bool = False
    blockers: list[str] = []
    channels: dict[str, ReviewReplySubmitChannelStatus] = {}


class ReviewReplyDraftSubmitRequest(BaseModel):
    draft_id: str


class ReviewReplyDraftManualCompleteRequest(BaseModel):
    draft_id: str


class ReviewReplyDraftSubmitResponse(BaseModel):
    ok: bool = True
    draft_id: str
    review_key: str
    status: str
    result_type: str | None = None
    detail: str | None = None
    reply_written_at: date | None = None


class ReviewReplyDraftRewriteFromRejectionRequest(BaseModel):
    draft_id: str
    model: str | None = None


class ReviewReplyDraftBulkSubmitRequest(BaseModel):
    limit: int = 0


class ReviewReplyDraftBulkSubmitStopRequest(BaseModel):
    job_id: str | None = None


class ReviewReplyDraftBulkSubmitJobResponse(BaseModel):
    ok: bool = True
    scheduled: bool = False
    job_id: str | None = None
    status: str = "IDLE"
    pending_targets: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    existing_reply_completed: int = 0
    existing_reply_enrichment: int = 0
    cancel_requested: bool = False
    detail: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class QnaSyncRequest(BaseModel):
    days: int = Field(default=14, ge=1, le=90)
    start_date: date | None = None
    end_date: date | None = None
    customer_page_size: int = Field(default=50, ge=1, le=200)
    product_page_size: int = Field(default=50, ge=1, le=200)
    customer_pages: int = Field(default=2, ge=1, le=20)
    product_pages: int = Field(default=2, ge=1, le=20)
    include_answered: bool = True


class QnaSyncResponse(BaseModel):
    ok: bool = True
    customer_fetched: int = 0
    product_fetched: int = 0
    saved: int = 0
    updated: int = 0
    detail: str | None = None


class QnaDraftGenerateRequest(BaseModel):
    qna_key: str
    model: str | None = None
    force_regenerate: bool = False


class QnaDraftValidationResult(BaseModel):
    status: str = "not_checked"
    initial_issues: list[str] = Field(default_factory=list)
    final_issues: list[str] = Field(default_factory=list)
    rewrite_attempted: bool = False
    rewrite_succeeded: bool = False


class QnaDraftResponse(ModelNameCompatibleBaseModel):
    ok: bool = True
    qna_key: str
    draft_id: str
    status: str
    draft_text: str
    model_name: str | None = None
    prompt_version: str | None = None
    generated_now: bool = False
    inquiry_text: str | None = None
    answer_text: str | None = None
    qna_kind: str
    qna_kind_label: str
    title: str | None = None
    category: str | None = None
    error_message: str | None = None
    generated_at: datetime | None = None
    rejection_comment: str | None = None
    rejection_analysis: dict = Field(default_factory=dict)
    validation_result: QnaDraftValidationResult = Field(default_factory=QnaDraftValidationResult)


class QnaDraftBatchGenerateRequest(BaseModel):
    max_items: int = Field(default=10, ge=1, le=100)
    qna_kind: Literal["customer", "product", "all"] = "all"
    from_date: date | None = None
    to_date: date | None = None
    model: str | None = None
    force_regenerate: bool = False


class QnaDraftBatchGenerateResponse(BaseModel):
    ok: bool = True
    requested: int = 0
    processed: int = 0
    generated: int = 0
    reused: int = 0
    skipped_answered: int = 0
    items: list[QnaDraftResponse] = Field(default_factory=list)


class QnaDraftStatusUpdateRequest(BaseModel):
    draft_id: str
    status: Literal["generated", "approved", "rejected", "failed", "superseded"]
    rejection_comment: str | None = None


class QnaDraftStatusUpdateResponse(BaseModel):
    ok: bool = True
    draft_id: str
    qna_key: str
    status: str
    rejection_comment: str | None = None
    rejection_analysis: dict = Field(default_factory=dict)


class QnaDraftUpdateRequest(BaseModel):
    draft_id: str
    draft_text: str


class QnaDraftUpdateResponse(BaseModel):
    ok: bool = True
    draft_id: str
    qna_key: str
    status: str
    draft_text: str
    validation_result: QnaDraftValidationResult = Field(default_factory=QnaDraftValidationResult)


class QnaDraftValidateRequest(BaseModel):
    draft_id: str


class QnaDraftValidateResponse(BaseModel):
    ok: bool = True
    draft_id: str
    qna_key: str
    status: str
    validation_result: QnaDraftValidationResult = Field(default_factory=QnaDraftValidationResult)


class QnaDraftSubmitRequest(BaseModel):
    draft_id: str


class QnaDraftSubmitResponse(BaseModel):
    ok: bool = True
    draft_id: str
    qna_key: str
    status: str
    detail: str | None = None
    remote_answer_content_id: str | None = None


class QnaWorkbenchDashboard(BaseModel):
    total_items: int = 0
    unanswered_count: int = 0
    generated_count: int = 0
    approved_count: int = 0
    submitted_count: int = 0
    failed_submit_count: int = 0
    customer_count: int = 0
    product_count: int = 0
    last_collected_at: datetime | None = None
    issue_tag_counts: dict[str, int] = Field(default_factory=dict)


class QnaWorkbenchItem(ModelNameCompatibleBaseModel):
    qna_key: str
    qna_kind: str
    qna_kind_label: str
    external_inquiry_id: str
    title: str | None = None
    category: str | None = None
    inquiry_text: str
    inquiry_registered_at: datetime | None = None
    answered: bool = False
    answer_content_id: str | None = None
    answer_text: str | None = None
    answer_registered_at: datetime | None = None
    order_id: str | None = None
    product_no: str | None = None
    product_order_id_list: str | None = None
    product_name: str | None = None
    product_order_option: str | None = None
    customer_id: str | None = None
    customer_name: str | None = None
    masked_writer_id: str | None = None
    draft_id: str | None = None
    draft_status: str | None = None
    draft_text: str | None = None
    model_name: str | None = None
    rejection_comment: str | None = None
    rejection_analysis: dict = Field(default_factory=dict)
    validation_result: QnaDraftValidationResult = Field(default_factory=QnaDraftValidationResult)
    issue_tags: list[str] = Field(default_factory=list)
    last_submit_success: bool | None = None
    last_submit_status_code: int | None = None
    last_submit_error: str | None = None
    last_submit_at: datetime | None = None
    can_generate: bool = True
    can_approve: bool = False
    can_reject: bool = False
    can_submit: bool = False


class QnaWorkbenchResponse(BaseModel):
    ok: bool = True
    qna_kind: str = "all"
    response_state: str = "all"
    search: str | None = None
    dashboard: QnaWorkbenchDashboard
    items: list[QnaWorkbenchItem] = Field(default_factory=list)


class QnaAnalysisResponse(BaseModel):
    ok: bool = True
    total_items: int = 0
    answered_count: int = 0
    unanswered_count: int = 0
    customer_count: int = 0
    product_count: int = 0
    approved_draft_count: int = 0
    submitted_draft_count: int = 0
    failed_submit_count: int = 0
    category_counts: dict[str, int] = Field(default_factory=dict)
    status_counts: dict[str, int] = Field(default_factory=dict)


class QnaAnalysisRunRequest(BaseModel):
    from_date: date | None = None
    to_date: date | None = None
    qna_kind: Literal["customer", "product", "all"] = "all"
    limit: int | None = Field(default=None, ge=1, le=5000)
    force_reanalyze: bool = False


class QnaAnalysisRunResponse(BaseModel):
    ok: bool = True
    requested_count: int = 0
    analyzed_count: int = 0
    skipped_count: int = 0
    llm_used_count: int = 0


class QnaAnalysisSummaryMetrics(BaseModel):
    total_items: int = 0
    purchase_ready_count: int = 0
    negative_count: int = 0
    high_conversion_count: int = 0
    faq_candidate_count: int = 0
    customer_count: int = 0
    product_count: int = 0
    answered_count: int = 0
    unanswered_count: int = 0
    analysis_coverage_rate: float = 0.0


class QnaAnalysisProductSummaryItem(BaseModel):
    product_name: str
    total_items: int = 0
    high_conversion_count: int = 0
    negative_count: int = 0
    faq_candidate_count: int = 0


class QnaAnalysisActionGuideItem(BaseModel):
    title: str
    why: str
    what_to_do: str
    target_area: str
    priority: str = "medium"


class QnaAnalysisSummaryResponse(BaseModel):
    ok: bool = True
    summary: QnaAnalysisSummaryMetrics = Field(default_factory=QnaAnalysisSummaryMetrics)
    inquiry_type_counts: dict[str, int] = Field(default_factory=dict)
    purchase_stage_counts: dict[str, int] = Field(default_factory=dict)
    sentiment_counts: dict[str, int] = Field(default_factory=dict)
    category_counts: dict[str, int] = Field(default_factory=dict)
    top_products: list[QnaAnalysisProductSummaryItem] = Field(default_factory=list)
    action_guides: list[QnaAnalysisActionGuideItem] = Field(default_factory=list)


class QnaAnalysisTrendPoint(BaseModel):
    date: str
    total_items: int = 0
    negative_count: int = 0
    faq_candidate_count: int = 0
    high_conversion_count: int = 0


class QnaAnalysisTrendsResponse(BaseModel):
    ok: bool = True
    points: list[QnaAnalysisTrendPoint] = Field(default_factory=list)


class QnaConversionBarrierItem(BaseModel):
    qna_key: str
    product_name: str | None = None
    inquiry_text: str
    inquiry_type: str | None = None
    purchase_stage: str | None = None
    conversion_impact_score: float = 0.0
    faq_candidate: bool = False
    recommended_action: str | None = None


class QnaConversionBarriersResponse(BaseModel):
    ok: bool = True
    items: list[QnaConversionBarrierItem] = Field(default_factory=list)


class QnaQualityIssueItem(BaseModel):
    qna_key: str
    product_name: str | None = None
    inquiry_text: str
    issue_tags: list[str] = Field(default_factory=list)
    sentiment: str | None = None
    severity: str | None = None
    recommended_action: str | None = None


class QnaQualityIssuesResponse(BaseModel):
    ok: bool = True
    items: list[QnaQualityIssueItem] = Field(default_factory=list)


class QnaFaqCandidateItem(BaseModel):
    qna_key: str
    product_name: str | None = None
    inquiry_text: str
    faq_candidate: bool = False
    conversion_impact_score: float = 0.0
    recommended_answer: str | None = None
    recommended_section: str | None = None


class QnaFaqCandidatesResponse(BaseModel):
    ok: bool = True
    items: list[QnaFaqCandidateItem] = Field(default_factory=list)


class QnaMarketingKeywordItem(BaseModel):
    keyword: str
    count: int = 0
    sentiment: str | None = None
    recommended_usage: str | None = None


class QnaMarketingCopyCandidateItem(BaseModel):
    phrase: str
    source_count: int = 0
    recommended_channel: str | None = None


class QnaMarketingInsightsResponse(BaseModel):
    ok: bool = True
    top_keywords: list[QnaMarketingKeywordItem] = Field(default_factory=list)
    copy_candidates: list[QnaMarketingCopyCandidateItem] = Field(default_factory=list)


class QnaAnalysisItemDetail(BaseModel):
    inquiry_type: str | None = None
    purchase_stage: str | None = None
    sentiment: str | None = None
    conversion_impact_score: float = 0.0
    keywords: list[str] = Field(default_factory=list)
    issue_tags: list[str] = Field(default_factory=list)
    summary_text: str | None = None


class QnaAnalysisItemRecord(BaseModel):
    qna_key: str
    qna_kind: str
    product_name: str | None = None
    inquiry_text: str
    inquiry_registered_at: datetime | None = None
    analysis: QnaAnalysisItemDetail = Field(default_factory=QnaAnalysisItemDetail)
    recommended_action: str | None = None


class QnaAnalysisItemsResponse(BaseModel):
    ok: bool = True
    total_items: int = 0
    items: list[QnaAnalysisItemRecord] = Field(default_factory=list)


MenuSyncStatus = Literal["active", "planned"]


class MenuSyncMenuItem(BaseModel):
    id: str
    label: str
    description: str | None = None
    status: MenuSyncStatus = "active"


class MenuSyncMenusResponse(BaseModel):
    ok: bool = True
    menus: list[MenuSyncMenuItem] = Field(default_factory=list)


class MenuSyncExportRequest(BaseModel):
    menu_ids: list[str] = Field(default_factory=list, min_length=1)
    date_from: date | None = None
    date_to: date | None = None
    target_dates: list[date] = Field(default_factory=list)


class MenuSyncTableSummary(BaseModel):
    table_name: str
    file_name: str
    row_count: int = 0
    source_row_count: int | None = None


class MenuSyncMenuSummary(BaseModel):
    menu_id: str
    label: str
    tables: list[MenuSyncTableSummary] = Field(default_factory=list)


class MenuSyncManifest(BaseModel):
    schema_version: str = "menu_sync_bundle_v1"
    generated_at: datetime
    menus: list[str] = Field(default_factory=list)
    menu_summaries: list[MenuSyncMenuSummary] = Field(default_factory=list)
    checksums: dict[str, str] = Field(default_factory=dict)
    date_from: date | None = None
    date_to: date | None = None
    target_dates: list[date] = Field(default_factory=list)
    source_image_tag: str | None = None
    source_api_version: str | None = None


class MenuSyncPreviewResponse(BaseModel):
    ok: bool = True
    manifest: MenuSyncManifest


class MenuSyncImportRequest(BaseModel):
    reanalyze_after_import: bool = False


class MenuSyncImportResponse(BaseModel):
    ok: bool = True
    menus: list[str] = Field(default_factory=list)
    imported_tables: list[MenuSyncTableSummary] = Field(default_factory=list)
    detail: str | None = None


class MenuSyncInventoryRequest(BaseModel):
    menu_id: str
    date_from: date | None = None
    date_to: date | None = None


class MenuSyncInventoryDayItem(BaseModel):
    date: date
    row_count: int = 0
    keys: list[str] = Field(default_factory=list)


class MenuSyncInventoryTableItem(BaseModel):
    table_name: str
    days: list[MenuSyncInventoryDayItem] = Field(default_factory=list)


class MenuSyncInventoryResponse(BaseModel):
    ok: bool = True
    menu_id: str
    date_from: date | None = None
    date_to: date | None = None
    tables: list[MenuSyncInventoryTableItem] = Field(default_factory=list)


ReviewWorkbenchStatusFilter = Literal["all", "new", "pending", "approved", "enrichment_target", "completed", "rejected"]
ReviewRatingFilter = Literal["1", "2", "3", "4", "5", "none"]
ReviewReplyBulkStageId = Literal["generate", "approve", "reject", "submit", "backfill"]


class ReviewReplyBulkStagePreviewResponse(BaseModel):
    ok: bool = True
    filtered_total: int = 0
    filter_summary: str | None = None
    generate_count: int = 0
    approve_count: int = 0
    reject_count: int = 0
    submit_count: int = 0
    backfill_count: int = 0


class ReviewReplyBulkStageStartRequest(BaseModel):
    stage: ReviewReplyBulkStageId
    product_url: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    status_filter: ReviewWorkbenchStatusFilter = "all"
    has_rejection_history_only: bool = False
    rating_filters: list[ReviewRatingFilter] = Field(default_factory=list)
    model: str | None = None
    style_level: int = 3
    style_controls: dict[str, int] = Field(default_factory=dict)
    max_pages: int = 30


class ReviewReplyBulkStageJobResponse(BaseModel):
    ok: bool = True
    scheduled: bool = False
    job_id: str | None = None
    stage: ReviewReplyBulkStageId | None = None
    stage_label: str | None = None
    status: str = "IDLE"
    filtered_total: int = 0
    pending_targets: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    existing_reply_completed: int = 0
    existing_reply_enrichment: int = 0
    cancel_requested: bool = False
    detail: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ReviewReplyBulkStageStopRequest(BaseModel):
    job_id: str | None = None


class ProductIndexCoverageResponse(BaseModel):
    product_url: str
    date_from: date
    date_to: date
    score_days_count: int = 0
    page_days_count: int = 0
    missing_score_days: list[date] = []
    missing_page_days: list[date] = []


class ProductIndexLatestBatchRequest(BaseModel):
    urls: list[str] = []


class ProductIndexLatestBatchItem(BaseModel):
    requested_url: str
    product_url: str
    as_of: date | None = Field(default=None, alias="date")
    scores: ProductIndexScores | None = None
    deltas: ProductIndexDeltas | None = None
    # 전일 대비 1일 Δ 규칙(GOLDEN/DEAD/TRAP/UNKNOWN)
    signal: str | None = None

    class Config:
        populate_by_name = True


class ProductIndexRankPredictionItem(BaseModel):
    date: date
    # 상품지수(인기종합) 및 변화량
    score_final: int | None = None
    delta_score_final: int | None = None

    # 오가닉 순위(상품 기준: 해당 날짜에 키워드들 중 "최고 순위(min rank)") 및 변화량
    best_rank: int | None = None
    delta_best_rank: int | None = None
    benchmark_best_rank: int | None = None
    gap_best_rank: int | None = None  # 내 best_rank - benchmark_best_rank (양수=내가 더 뒤)

    # 오가닉 순위(대표 키워드 가중 평균: 월검색량 기반) 및 변화량
    weighted_rank: float | None = None
    delta_weighted_rank: float | None = None
    benchmark_weighted_rank: float | None = None
    gap_weighted_rank: float | None = None  # 내 weighted_rank - benchmark_weighted_rank (양수=내가 더 뒤)

    # 예측 신호(상대평가/가속도 관점)
    signal: str = "UNKNOWN"  # GOLDEN | DEAD | TRAP | UNKNOWN
    accel: int | None = None  # Δ(오늘) - Δ(어제)


class ProductIndexRankPredictionResponse(BaseModel):
    product_url: str
    days: int
    benchmark_product_url: str | None = None
    items: list[ProductIndexRankPredictionItem] = []

class TrackedProductKeywordRead(BaseModel):
    """
    메뉴4 '내 상품 추적' 영역에서 사용하는 추적 키워드 엔티티 응답 스키마.
    """

    id: int
    product_url: str | None
    keyword: str
    monthly_search_volume: int | None = None
    is_active: bool
    created_at: datetime
    # 리스트 화면 빠른 로딩용: "오늘(KST)" 기준 저장된 순위/변동
    # - 값이 없으면(오늘 미수집) null
    today_rank: int | None = None
    today_delta: int | None = None

    class Config:
        from_attributes = True


class AutoTrackedKeywordItem(BaseModel):
    keyword: str
    group_type: str


class AutoTrackedKeywordReplaceRequest(BaseModel):
    product_url: str
    items: List[AutoTrackedKeywordItem]
    allow_empty_core: bool = False


class AutoTrackedKeywordRead(BaseModel):
    product_url: str
    keyword: str
    group_type: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# -----------------------------
# 키워드 리서치/인사이트 (menu5-research)
# -----------------------------


class KeywordTrendPoint(BaseModel):
    date: str
    ratio: float


class KeywordDistributionItem(BaseModel):
    label: str
    ratio: float


class KeywordToolRow(BaseModel):
    relKeyword: str
    monthlyPcQcCnt: int | None = None
    monthlyMobileQcCnt: int | None = None
    monthlyAvePcClkCnt: float | None = None
    monthlyAveMobileClkCnt: float | None = None
    monthlyAvePcCtr: float | None = None
    monthlyAveMobileCtr: float | None = None
    plAvgDepth: float | None = None
    compIdx: str | None = None


class KeywordInsightsResponse(BaseModel):
    keyword: str
    date_from: str
    date_to: str
    cached: bool = False

    trend: dict
    distributions: dict
    relatedKeywords: list[KeywordToolRow] = []

    shopping: dict
    keywordToolError: str | None = None


class TrackedProductKeywordCreate(BaseModel):
    """
    추적 대상 상품 URL + 키워드 리스트 등록 요청 스키마.
    """

    product_url: str | None = None
    keywords: List[str]


class AdTrackedKeywordRead(BaseModel):
    id: int
    product_url: str
    keyword: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AdTrackedKeywordInput(BaseModel):
    keyword: str
    is_active: bool = True


class AdTrackedProductRead(BaseModel):
    product_url: str
    name: str
    campaign_label: str | None = None
    organic_title: str | None = None
    image_url: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    keywords: List[AdTrackedKeywordRead] = []

    class Config:
        from_attributes = True


class AdTrackedProductCreate(BaseModel):
    product_url: str
    name: str | None = None
    campaign_label: str | None = None
    keywords: List[Union[str, AdTrackedKeywordInput]] = []


class AdTrackedProductUpdate(BaseModel):
    name: str | None = None
    campaign_label: str | None = None
    keywords: List[Union[str, AdTrackedKeywordInput]] | None = None


class AdRankDiagnosisPresetRead(BaseModel):
    condition_id: str
    gender: str
    age_band: str
    placement: str
    target_rank: int = 20
    scope: str
    is_active: bool

    class Config:
        from_attributes = True


class AdRankDiagnosisPresetUpdate(BaseModel):
    target_rank: int = Field(20, ge=1, le=20)
    scope: str | None = None
    is_active: bool | None = None


class AdRankKeywordTargetRead(BaseModel):
    keyword: str
    gender: str
    age_band: str
    placement: str
    condition_id: str
    target_rank: int = 20
    source: str = "preset"


class AdRankKeywordTargetUpdate(BaseModel):
    keyword: str
    gender: str
    age_band: str
    placement: str
    target_rank: int = Field(20, ge=1, le=20)


class AdRankDiagnosisDailyRead(BaseModel):
    date: date
    time_slot: str
    product_url: str
    keyword: str
    gender: str
    age_band: str
    placement: str
    visible: bool
    rank: int | None = None
    competitor_count_above: int | None = None
    ad_type: str | None = None
    status: str
    page_url: str | None = None
    raw_text_sample: str | None = None
    screenshot_path: str | None = None
    error: str | None = None
    collected_at: datetime | None = None

    class Config:
        from_attributes = True


class ProductRankPoint(BaseModel):
    date: date
    rank: int
    status: str | None = None


class ProductRankSeries(BaseModel):
    """
    하나의 키워드에 대한 날짜별 순위 시계열.
    """

    keyword: str
    series: List[ProductRankPoint]


class ProductRankHistory(BaseModel):
    """
    메뉴4 하단 '순위 변화 테이블/그래프' 에서 사용하는 집계 응답 구조.

    - dates: 공통 날짜 축 (오름차순)
    - series: 키워드별 순위 시계열
    """

    dates: List[date]
    series: List[ProductRankSeries]
    failed_dates: List[date] = Field(default_factory=list)


# -----------------------------
# 내 상품 추적: 배치 조회(리스트 진입 성능 개선)
# -----------------------------


class ProductRankHistoryBatchItem(BaseModel):
    id: str
    product_url: str | None = None


class ProductRankHistoryBatchRequest(BaseModel):
    items: List[ProductRankHistoryBatchItem]


class ProductSummaryBatchItem(BaseModel):
    id: str
    keyword: str
    product_url: str | None = None


class ProductSummaryBatchRequest(BaseModel):
    items: List[ProductSummaryBatchItem]


class ProductMetadataBatchItem(BaseModel):
    id: str
    keyword: str
    product_url: str | None = None


class ProductMetadataBatchRequest(BaseModel):
    items: List[ProductMetadataBatchItem]


class TrackedRankUploadItem(BaseModel):
    """
    엑셀에서 추출한 '키워드 × 일자' 단위 순위 1셀.
    """

    keyword: str
    date: date
    rank: int


class TrackedRankUploadRequest(BaseModel):
    """
    공식 엑셀 업로드 → 서버 저장 요청.
    """

    product_url: str
    items: List[TrackedRankUploadItem]
    # 키워드별 월간 평균 검색량(선택): 엑셀에서 추출한 키워드 옆 숫자
    # 예: [{ "keyword": "새치염색약", "monthly_search_volume": 10630 }]
    keyword_meta: list[dict] = []
    allow_add_missing_keywords: bool = False


class TrackedRankUploadResponse(BaseModel):
    saved: int
    added_keywords: List[str] = []


class TrackedRankTextImportRequest(BaseModel):
    """
    상세 화면에서 수기로 붙여넣는 '키워드 / n위' 텍스트를
    특정 상품/일자 스냅샷으로 저장하기 위한 요청.

    - 키워드가 '추적 키워드'가 아니어도 저장은 허용한다(크롤링 대상에 자동 포함하지 않기 위함).
    """

    product_url: str
    # 입력하지 않으면 서버에서 오늘(KST)로 처리
    # NOTE:
    # - 필드명이 date일 때 "date | None" 타입 주석이 클래스 스코프에서 name 충돌로 깨지는 경우가 있어
    #   내부 필드명은 target_date로 두고, 외부 입력은 alias="date"로 받는다.
    target_date: date | None = Field(default=None, alias="date")
    text: str

    class Config:
        populate_by_name = True


class TrackedRankTextImportResponse(BaseModel):
    saved: int
    date: str
    # 추적 키워드(특별 관리 키워드) 커버리지
    tracked_keywords_total: int
    tracked_keywords_covered: int
    is_tracked_complete: bool
    missing_tracked_keywords: List[str] = []


class KeywordVolumesRequest(BaseModel):
    keywords: List[str]


class KeywordVolumeItem(BaseModel):
    keyword: str
    # SearchAd keywordstool은 저검색량 키워드에 대해 "< 10" 같이 "정확한 수치 대신 범위"를 반환할 수 있다.
    # - monthly_search_volume: 숫자로 확정되는 경우에만 값이 들어간다.
    # - monthly_search_volume_label: "<20" 같은 범위 표기 (숫자가 확정되지 않을 때 UI 표시용)
    monthly_search_volume: Optional[int] = None
    monthly_search_volume_label: Optional[str] = None


class ManualKeywordsDeleteRequest(BaseModel):
    """
    상세 화면의 '수기 입력 키워드'에서 선택 삭제 요청.

    정책:
    - tracked_product_rank_daily 중 source='text' 행만 삭제한다.
    - keywords는 '키워드 단위'이며, 해당 키워드의 전체 일자 기록을 함께 제거한다.
    """

    product_url: str
    keywords: List[str]


class ManualKeywordsDeleteResponse(BaseModel):
    deleted: int


class ManualKeywordItem(BaseModel):
    keyword: str
    monthly_search_volume: Optional[int] = None
    monthly_search_volume_label: Optional[str] = None


class ManualKeywordsImportRequest(BaseModel):
    """
    상세 화면에서 수기 키워드(후보) + 월검색량을 저장한다.

    - mode=replace: 기존 수기 키워드 리스트를 비활성화 후, 입력된 items를 활성으로 upsert
    - mode=append: 기존 유지 + 입력된 items만 upsert/활성화
    """

    product_url: str
    mode: str = "replace"  # replace | append
    items: List[ManualKeywordItem]


class ManualKeywordsImportResponse(BaseModel):
    saved: int
    total_active: int


class ManualKeywordsListResponseItem(BaseModel):
    keyword: str
    monthly_search_volume: Optional[int] = None
    monthly_search_volume_label: Optional[str] = None

    class Config:
        from_attributes = True


class ManualKeywordsMetaDeleteRequest(BaseModel):
    product_url: str
    keywords: List[str]


class ManualKeywordsMetaDeleteResponse(BaseModel):
    deleted: int
    # 아래 필드는 하위 호환(옵션). UI/디버깅에서 "왜 삭제가 안 됐는지"를 분해하기 위한 정보다.
    requested_keywords: List[str] | None = None
    deleted_keywords: List[str] | None = None
    not_found_keywords: List[str] | None = None


class SeoCategoryDictionaryItem(BaseModel):
    id: str
    path: str
    source_filename: str | None = None
    saved_at: datetime | None = None
    updated_at: datetime | None = None


class SeoCategoryDictionaryLatestUpload(BaseModel):
    filename: str | None = None
    parsed_rows: int = 0
    saved_at: datetime | None = None


class SeoCategoryDictionaryListResponse(BaseModel):
    items: List[SeoCategoryDictionaryItem] = []
    total: int = 0
    latest_upload: SeoCategoryDictionaryLatestUpload | None = None
    active_batch_id: str | None = None
    files: List["SeoCategoryDictionaryBatchItem"] = []


class SeoCategoryDictionaryImportItem(BaseModel):
    id: str
    path: str


class SeoCategoryDictionaryImportRequest(BaseModel):
    filename: str | None = None
    items: List[SeoCategoryDictionaryImportItem] = Field(default_factory=list, min_length=1)


class SeoCategoryDictionaryImportResponse(BaseModel):
    parsed: int
    inserted: int
    skipped: int
    total_active: int
    saved_at: datetime | None = None
    filename: str | None = None
    batch_id: str | None = None


class SeoCategoryDictionaryBatchItem(BaseModel):
    batch_id: str
    filename: str
    parsed_rows: int
    uploaded_at: datetime | None = None
    applied_at: datetime | None = None
    is_active: bool = False


class SeoCategoryDictionaryBatchApplyRequest(BaseModel):
    batch_id: str


class SeoCategoryDictionaryBatchApplyResponse(BaseModel):
    batch_id: str
    filename: str
    total_active: int
    applied_at: datetime | None = None


class SeoCategoryDictionaryDeleteRequest(BaseModel):
    batch_id: str


class SeoCategoryDictionaryDeleteResponse(BaseModel):
    deleted: int
    deleted_entries: int = 0
    total_active: int
    active_batch_id: str | None = None


SeoCategoryDictionaryListResponse.model_rebuild()


class CategoryCrawlTodayDeleteRequest(BaseModel):
    """
    오늘자(또는 지정 일자) 카테고리 크롤링 결과(source='crawl_category')를 초기화한다.
    - product_urls에 포함된 상품들에 대해서만 삭제한다.
    """

    product_urls: List[str]
    target_date: date | None = Field(default=None, alias="date")

    class Config:
        populate_by_name = True


class CategoryCrawlTodayDeleteResponse(BaseModel):
    deleted: int


class CategoryCrawlCancelRequest(BaseModel):
    job_id: str


class CategoryCrawlCancelResponse(BaseModel):
    job_id: str
    status: str


class CategoryCrawlRequest(BaseModel):
    product_url: str = Field(..., description="기준 상품 URL(이 상품의 카테고리를 기준으로 동일 카테고리 상품을 함께 크롤링)")
    scope: Literal["product", "category"] = Field("category", description="product: 단일 상품, category: 동일 카테고리 상품(최대 max_products) 함께")
    target_date: date | None = Field(None, alias="date", description="저장 일자(미입력 시 오늘)")
    # 쇼핑 OpenAPI 종료 이후 기본 수집은 CDP 1페이지(광고 제외 40개) 기준으로 제한한다.
    # 상한은 수동 검증/레거시 호환을 위해 열어두되, 중앙 자동 수집은 40을 사용한다.
    limit: int = Field(
        40,
        ge=10,
        le=1000,
        description="TOP N까지 검색(기본 40). CDP 수집은 1페이지 광고 제외 상품 기준을 권장",
    )
    max_products: int = Field(10, ge=1, le=10, description="category 스코프일 때 함께 크롤링할 최대 상품 수(기본 10)")
    category_id: str | None = Field(None, description="선택: 네이버 쇼핑 카테고리 ID(숫자). 없으면 Playwright 기반 추론을 시도")
    keywords: List[str] | None = Field(None, description="선택: 사용할 키워드 리스트. 없으면 기준 상품의 '수기 키워드(월검색량)' 목록을 사용")
    method: Literal["openapi", "playwright"] | None = Field(
        None,
        description="수집 방식. openapi=네이버 쇼핑 검색 OpenAPI(shop.json) 기반(418/캡차 거의 없음), playwright=쇼핑 내부 API/페이지 기반",
    )

    class Config:
        populate_by_name = True


class CategoryCrawlResponse(BaseModel):
    job_id: str
    status: str
    product_urls: List[str]
    keywords: List[str]
    target_date: str
    limit: int


class CategoryCrawlBatchByKeywordRequest(BaseModel):
    """동일 키워드는 1회만 CDP 수집 후 해당 키워드를 가진 모든 상품에 동시 적용."""
    product_urls: List[str] = Field(..., min_length=1, max_length=20, description="수집 대상 상품 URL 목록")
    target_date: date | None = Field(None, alias="date", description="저장 일자(미입력 시 오늘)")
    limit: int = Field(40, ge=10, le=1000, description="TOP N까지 검색(기본 40, 쇼핑 1페이지 기준)")

    class Config:
        populate_by_name = True


class CategoryCrawlStatusResponse(BaseModel):
    job_id: str
    status: str
    detail: str | None = None


class ManualKeywordsCrawlTodayItem(BaseModel):
    keyword: str
    rank: int | None = None
    source: str | None = None


class ManualKeywordsCrawlTodayResponse(BaseModel):
    product_url: str
    target_date: str
    total_keywords: int
    crawled_keywords: int
    found_keywords: int
    missing_keywords: int
    items: List[ManualKeywordsCrawlTodayItem] = []


class ManualKeywordsApplyRequest(BaseModel):
    """
    특정 상품의 '수기 키워드(월검색량)' 목록을 다른 상품들에 그대로 적용한다.
    - replace 모드로 동작(대상 상품의 기존 수기 키워드 리스트는 비활성화 후, source 목록을 활성 upsert)
    """

    source_product_url: str
    target_product_urls: List[str]


class ManualKeywordsApplyResponse(BaseModel):
    applied_products: int
    keywords: int


class CrawlTodayStatusRequest(BaseModel):
    product_urls: List[str]
    target_date: date | None = Field(default=None, alias="date")

    class Config:
        populate_by_name = True


class CrawlTodayStatusItem(BaseModel):
    product_url: str
    total_keywords: int
    covered_keywords: int
    # rank>0 인 키워드 개수(=실제 노출/유효 순위가 존재)
    exposed_keywords: int = 0
    # row는 있으나 rank<=0(미노출/없음) 인 키워드 개수
    no_exposure_keywords: int = 0
    missing_keywords: List[str] = []
    sample_keyword: str | None = None
    is_complete: bool


class RankCompareResponse(BaseModel):
    keyword: str
    product_url: str
    target_date: str
    limit: int

    # DB에 저장된 값(수집 결과)
    stored_rank: int | None = None  # rank>0
    stored_source: str | None = None  # openapi/crawl_category/excel/text 등

    # "실노출"(쇼핑 내부 API 기준) 비교값
    live_rank: int | None = None  # rank>0
    live_source: str = "shopping_api"  # 고정

    # 매칭 식별자(디버그)
    smartstore_product_id: str | None = None  # /products/<id>
    catalog_product_id: str | None = None  # TrackedProductMeta.product_id_catalog

    # 실패/차단 등
    error: str | None = None

class CompetitorProductRead(BaseModel):
    id: int
    tracked_keyword_id: int
    name: str
    match_text: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CompetitorProductCreate(BaseModel):
    name: str
    match_text: str


class ComparisonSeries(BaseModel):
    """
    내 상품 및 경쟁 상품별 날짜별 순위 시계열.

    - label: 그래프/테이블에 표시할 상품 라벨 (예: '내 상품', '브랜드A')
    - kind: 'our' | 'competitor'
    """

    label: str
    kind: str
    series: List[ProductRankPoint]


class ComparisonHistory(BaseModel):
    """
    내 상품 vs 경쟁 상품 순위 비교용 응답 구조.

    - dates: 공통 날짜 축 (오름차순)
    - products: 상품별 순위 시계열
    """

    dates: List[date]
    products: List[ComparisonSeries]

