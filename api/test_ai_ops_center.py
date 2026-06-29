import json
import unittest
from datetime import date, datetime

from fastapi.testclient import TestClient

import main
from db import (
    ActionQueueItem,
    A1SkuMap,
    A1SkuStateDaily,
    AiDecisionLog,
    CommerceQnaAnalysis,
    CommerceQnaRaw,
    DecisionProductHealthDaily,
    NaverAdKeywordDaily,
    NaverCommerceProductSalesDaily,
    NaverProductRankDaily,
    NaverProductReviewDaily,
    SessionLocal,
    TrackedProductKeyword,
    TrackedProductMeta,
    init_db,
)


class AiOpsCenterApiTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            db.query(ActionQueueItem).delete(synchronize_session=False)
            db.query(AiDecisionLog).delete(synchronize_session=False)
            db.query(CommerceQnaAnalysis).delete(synchronize_session=False)
            db.query(CommerceQnaRaw).delete(synchronize_session=False)
            db.query(NaverAdKeywordDaily).delete(synchronize_session=False)
            db.query(NaverProductRankDaily).delete(synchronize_session=False)
            db.query(NaverProductReviewDaily).delete(synchronize_session=False)
            db.query(NaverCommerceProductSalesDaily).delete(synchronize_session=False)
            db.query(A1SkuStateDaily).delete(synchronize_session=False)
            db.query(TrackedProductMeta).delete(synchronize_session=False)
            db.query(A1SkuMap).delete(synchronize_session=False)
            db.query(DecisionProductHealthDaily).delete(synchronize_session=False)
            db.commit()

    def test_ai_ops_home_returns_summary_from_product_health_and_action_queue(self) -> None:
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 11),
                        sku_id="SKU-A",
                        product_url="https://smartstore.naver.com/test/products/1",
                        product_name="상품A",
                        policy_type="VOC_IMPROVEMENT_PRIORITY",
                        top_issue="리뷰 부정 비율 상승",
                        priority_score=88.0,
                        confidence_score=0.91,
                        data_quality_score=0.95,
                        recommended_action_primary="리뷰 개선 우선",
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 11),
                        sku_id="SKU-B",
                        product_url="https://smartstore.naver.com/test/products/2",
                        product_name="상품B",
                        policy_type="AD_GROWTH",
                        top_issue="광고 확장 기회",
                        priority_score=76.0,
                        confidence_score=0.84,
                        data_quality_score=0.90,
                        recommended_action_primary="광고 확대",
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 11),
                        sku_id="SKU-C",
                        product_url="https://smartstore.naver.com/test/products/3",
                        product_name="상품C",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="구매 전 문의 누적",
                        priority_score=71.0,
                        confidence_score=0.79,
                        data_quality_score=0.88,
                        recommended_action_primary="FAQ 보강",
                    ),
                ]
            )
            db.add_all(
                [
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=900,
                        clicks=18,
                        cost=12000,
                        conversions=4,
                        revenue=60000,
                        purchase_conversions=2,
                        purchase_revenue=60000,
                        ctr=2.0,
                        cpc=666.0,
                        cvr=22.2,
                        roas=500.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 11),
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=1100,
                        clicks=24,
                        cost=18000,
                        conversions=6,
                        revenue=90000,
                        purchase_conversions=4,
                        purchase_revenue=90000,
                        ctr=2.2,
                        cpc=750.0,
                        cvr=25.0,
                        roas=500.0,
                        source="searchad_api",
                    ),
                    ActionQueueItem(
                        queue_id="queue-home-learning-1",
                        source_scope="ai-ops-ads-budget",
                        entity_type="ad_keyword",
                        entity_id="성장 캠페인::확장 그룹::확장 키워드",
                        action_type="QUEUE_AD_BUDGET_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[광고 예산] 확장 키워드",
                                "campaign_name": "성장 캠페인",
                                "adgroup_name": "확장 그룹",
                                "keyword": "확장 키워드",
                                "action_kind": "BUDGET_INCREASE",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 10, 0, 0),
                        updated_at=datetime(2026, 4, 4, 10, 0, 0),
                    ),
                ]
            )
            db.add(
                ActionQueueItem(
                    queue_id="queue-1",
                    source_scope="ai-ops-home",
                    entity_type="sku",
                    entity_id="SKU-A",
                    action_type="REVIEW_FIX",
                    payload_json='{"title":"리뷰 개선 우선"}',
                    priority="P1",
                    status="PENDING",
                )
            )
            db.commit()

        resp = self.client.get("/ai/ops/home")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()

        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("urgent_count"), 3)
        self.assertEqual(body.get("summary", {}).get("pending_action_count"), 1)
        self.assertEqual(body.get("summary", {}).get("high_priority_voc_count"), 1)
        self.assertEqual(body.get("summary", {}).get("growth_opportunity_count"), 1)
        self.assertEqual(body.get("summary", {}).get("faq_gap_count"), 1)
        self.assertEqual(body.get("summary", {}).get("operation_verified_count"), 1)
        self.assertIn("예산 증액", str(body.get("summary", {}).get("operation_learning_note") or ""))
        action_bucket_counts = body.get("summary", {}).get("action_bucket_counts") or {}
        self.assertEqual(action_bucket_counts.get("BUDGET_INCREASE"), 1)
        self.assertEqual(action_bucket_counts.get("VOC_IMPROVEMENT"), 1)
        self.assertEqual(action_bucket_counts.get("FAQ_CONTENT_IMPROVEMENT"), 1)
        self.assertGreaterEqual(len(body.get("items") or []), 3)
        items = body.get("items") or []
        self.assertEqual((items[0] or {}).get("sku_id"), "SKU-B")
        self.assertEqual((items[0] or {}).get("action_bucket"), "BUDGET_INCREASE")
        self.assertIn("운영 학습", str((items[0] or {}).get("priority_reason") or ""))
        self.assertGreater(float((items[0] or {}).get("effective_priority_score") or 0.0), float((items[1] or {}).get("effective_priority_score") or 0.0))

    def test_ai_ops_products_lists_latest_product_health_rows(self) -> None:
        with SessionLocal() as db:
            db.add(
                DecisionProductHealthDaily(
                    date=date(2026, 4, 11),
                    sku_id="SKU-1",
                    product_url="https://smartstore.naver.com/test/products/10",
                    product_name="테스트 상품",
                    policy_type="AD_DEFENSE",
                    top_issue="핵심 키워드 방어 필요",
                    priority_score=82.5,
                    confidence_score=0.87,
                    data_quality_score=0.93,
                    organic_strength_score=64.0,
                    ad_efficiency_score=52.0,
                    sales_growth_score=41.0,
                    review_risk_score=25.0,
                    qna_barrier_score=18.0,
                    trend_momentum_score=57.0,
                    recommended_action_primary="방어 광고 3일 테스트",
                )
            )
            db.commit()

        resp = self.client.get("/ai/ops/products")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("total_items"), 1)
        row = (body.get("items") or [None])[0]
        self.assertIsNotNone(row)
        self.assertEqual(row.get("sku_id"), "SKU-1")
        self.assertEqual(row.get("policy_type"), "AD_DEFENSE")
        self.assertEqual(row.get("recommended_action_primary"), "방어 광고 3일 테스트")

    def test_ai_ops_products_resolves_display_name_when_snapshot_name_is_url(self) -> None:
        product_url = "https://smartstore.naver.com/test/products/7010"
        with SessionLocal() as db:
            db.add(
                DecisionProductHealthDaily(
                    date=date(2026, 4, 11),
                    sku_id="SKU-URL-1",
                    product_url=product_url,
                    product_id_catalog=7010,
                    product_name=product_url,
                    policy_type="AD_DEFENSE",
                    top_issue="핵심 키워드 방어 필요",
                    priority_score=70.0,
                    confidence_score=0.8,
                    data_quality_score=0.9,
                    recommended_action_primary="방어 광고 3일 테스트",
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="url상품",
                    title="URL 보정 상품명",
                    mall_name="테스트몰",
                    product_id_catalog=7010,
                )
            )
            db.commit()

        resp = self.client.get("/ai/ops/products")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        row = (body.get("items") or [None])[0]
        self.assertIsNotNone(row)
        self.assertEqual(row.get("sku_id"), "SKU-URL-1")
        self.assertEqual(row.get("product_name"), "URL 보정 상품명")

    def test_ai_ops_ads_returns_keyword_action_candidates(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="브랜드 키워드",
                        device="ALL",
                        impressions=1000,
                        clicks=12,
                        cost=15000,
                        conversions=0,
                        revenue=0,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.2,
                        cpc=1250.0,
                        cvr=0.0,
                        roas=0.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=900,
                        clicks=18,
                        cost=12000,
                        conversions=4,
                        revenue=60000,
                        purchase_conversions=3,
                        purchase_revenue=60000,
                        ctr=2.0,
                        cpc=666.0,
                        cvr=22.2,
                        roas=500.0,
                        source="searchad_api",
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/ads")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("total_keywords"), 2)
        items = body.get("items") or []
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].get("action_bucket"), "STOP")
        self.assertEqual(items[0].get("priority"), "P1")
        self.assertEqual(items[1].get("action_bucket"), "SCALE")

    def test_ai_ops_ads_returns_cannibalization_and_budget_candidates(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="브랜드 키워드",
                        device="ALL",
                        impressions=1000,
                        clicks=14,
                        cost=18000,
                        conversions=1,
                        revenue=12000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.4,
                        cpc=1285.0,
                        cvr=7.1,
                        roas=66.7,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=900,
                        clicks=18,
                        cost=12000,
                        conversions=4,
                        revenue=60000,
                        purchase_conversions=3,
                        purchase_revenue=60000,
                        ctr=2.0,
                        cpc=666.0,
                        cvr=22.2,
                        roas=500.0,
                        source="searchad_api",
                    ),
                    NaverProductRankDaily(
                        date=target_date,
                        keyword="브랜드 키워드",
                        rank=1,
                        product_title="브랜드 상품",
                        mall_name="브랜드몰",
                        price=12000,
                        purchase_cnt=120,
                        product_id=1,
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/ads")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("cannibalization_count"), 1)
        self.assertEqual(body.get("summary", {}).get("budget_count"), 2)
        cannibalization_items = body.get("cannibalization_items") or []
        budget_items = body.get("budget_items") or []
        self.assertEqual(len(cannibalization_items), 1)
        self.assertEqual(cannibalization_items[0].get("keyword"), "브랜드 키워드")
        self.assertEqual(cannibalization_items[0].get("organic_rank"), 1)
        self.assertEqual(cannibalization_items[0].get("action_kind"), "CANNIBALIZATION_DECREASE")
        self.assertEqual(len(budget_items), 2)
        increase_item = next((item for item in budget_items if item.get("keyword") == "확장 키워드"), None)
        self.assertIsNotNone(increase_item)
        self.assertEqual(increase_item.get("budget_direction"), "INCREASE")

    def test_ai_ops_ads_budget_action_creates_queue_item(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="브랜드 키워드",
                        device="ALL",
                        impressions=1000,
                        clicks=14,
                        cost=18000,
                        conversions=1,
                        revenue=12000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.4,
                        cpc=1285.0,
                        cvr=7.1,
                        roas=66.7,
                        source="searchad_api",
                    ),
                    NaverProductRankDaily(
                        date=target_date,
                        keyword="브랜드 키워드",
                        rank=1,
                        product_title="브랜드 상품",
                        mall_name="브랜드몰",
                        price=12000,
                        purchase_cnt=120,
                        product_id=1,
                    ),
                ]
            )
            db.commit()

        resp = self.client.post(
            "/ai/ops/ads/budget-actions",
            json={
                "campaign_name": "브랜드 캠페인",
                "adgroup_name": "방어 그룹",
                "keyword": "브랜드 키워드",
                "action_kind": "CANNIBALIZATION_DECREASE",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = body.get("item") or {}
        self.assertEqual(item.get("action_type"), "QUEUE_AD_BUDGET_ACTION")
        self.assertEqual(item.get("priority"), "P1")
        payload = item.get("payload") or {}
        self.assertEqual(payload.get("action_kind"), "CANNIBALIZATION_DECREASE")
        self.assertEqual(payload.get("organic_rank"), 1)
        self.assertEqual(payload.get("recommended_action"), "잠식 감액 테스트")

    def test_ai_ops_sales_returns_focus_risk_and_low_contribution_candidates(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverCommerceProductSalesDaily(
                        date=target_date,
                        product_id=9001,
                        source="commerce_orders",
                        product_name="집중 상품",
                        order_count=8,
                        quantity=10,
                        amount=420000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=10000,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=target_date,
                        product_id=9002,
                        source="commerce_orders",
                        product_name="환불 위험 상품",
                        order_count=6,
                        quantity=6,
                        amount=220000,
                        refund_order_count=2,
                        refund_quantity=2,
                        refund_amount=80000,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=target_date,
                        product_id=9003,
                        source="commerce_orders",
                        product_name="과투입 점검 상품",
                        order_count=1,
                        quantity=1,
                        amount=50000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/sales")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("focus_count"), 1)
        self.assertEqual(body.get("summary", {}).get("risk_hold_count"), 1)
        self.assertEqual(body.get("summary", {}).get("low_contribution_count"), 1)
        self.assertEqual(body.get("summary", {}).get("overinvestment_count"), 0)
        items = body.get("items") or []
        self.assertEqual(len(items), 3)
        focus_item = next((item for item in items if item.get("product_id") == 9001), None)
        risk_item = next((item for item in items if item.get("product_id") == 9002), None)
        low_item = next((item for item in items if item.get("product_id") == 9003), None)
        self.assertIsNotNone(focus_item)
        self.assertEqual(focus_item.get("action_bucket"), "FOCUS")
        self.assertEqual(focus_item.get("recommended_action"), "상위 매출 SKU 집중 운영")
        self.assertIsNotNone(risk_item)
        self.assertEqual(risk_item.get("action_bucket"), "RISK_HOLD")
        self.assertAlmostEqual(float(risk_item.get("refund_ratio") or 0.0), 0.3636, places=4)
        self.assertIsNotNone(low_item)
        self.assertEqual(low_item.get("action_bucket"), "LOW_CONTRIBUTION")
        self.assertEqual(low_item.get("priority"), "P2")
        self.assertEqual(body.get("overinvestment_items") or [], [])

    def test_ai_ops_sales_returns_ad_overinvestment_candidates(self) -> None:
        target_date = date(2026, 4, 12)
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverCommerceProductSalesDaily(
                        date=target_date,
                        product_id=9201,
                        source="commerce_orders",
                        product_name="광고 착시 상품",
                        order_count=2,
                        quantity=2,
                        amount=110000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                    TrackedProductMeta(
                        product_url="https://smartstore.naver.com/test/products/9201",
                        keyword="착시키워드",
                        title="광고 착시 상품",
                        mall_name="테스트몰",
                        product_id_catalog=9201,
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="착시키워드",
                        device="ALL",
                        impressions=1800,
                        clicks=32,
                        cost=55000,
                        conversions=4,
                        revenue=200000,
                        purchase_conversions=3,
                        purchase_revenue=200000,
                        ctr=1.8,
                        cpc=1718.0,
                        cvr=12.5,
                        roas=363.6,
                        source="searchad_api",
                    ),
                    ActionQueueItem(
                        queue_id="queue-sales-learning-1",
                        source_scope="ai-ops-sales",
                        entity_type="product",
                        entity_id="9201",
                        action_type="QUEUE_SALES_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[판매 AD_OVERINVESTMENT] 광고 착시 상품",
                                "product_id": 9201,
                                "action_bucket": "AD_OVERINVESTMENT",
                                "keyword": "착시키워드",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 10, 0, 0),
                        updated_at=datetime(2026, 4, 4, 10, 0, 0),
                    ),
                    NaverCommerceProductSalesDaily(
                        date=date(2026, 4, 4),
                        product_id=9201,
                        source="commerce_orders",
                        product_name="광고 착시 상품",
                        order_count=2,
                        quantity=2,
                        amount=90000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=date(2026, 4, 11),
                        product_id=9201,
                        source="commerce_orders",
                        product_name="광고 착시 상품",
                        order_count=4,
                        quantity=4,
                        amount=160000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="착시키워드",
                        device="ALL",
                        impressions=1800,
                        clicks=30,
                        cost=50000,
                        conversions=4,
                        revenue=180000,
                        purchase_conversions=3,
                        purchase_revenue=180000,
                        ctr=1.7,
                        cpc=1666.0,
                        cvr=13.3,
                        roas=360.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 11),
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="착시키워드",
                        device="ALL",
                        impressions=1500,
                        clicks=22,
                        cost=22000,
                        conversions=4,
                        revenue=185000,
                        purchase_conversions=3,
                        purchase_revenue=185000,
                        ctr=1.4,
                        cpc=1000.0,
                        cvr=18.1,
                        roas=840.9,
                        source="searchad_api",
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/sales")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("overinvestment_count"), 1)
        overinvestment_items = body.get("overinvestment_items") or []
        self.assertEqual(len(overinvestment_items), 1)
        item = overinvestment_items[0]
        self.assertEqual(item.get("product_id"), 9201)
        self.assertEqual(item.get("action_bucket"), "AD_OVERINVESTMENT")
        self.assertEqual(item.get("keyword"), "착시키워드")
        self.assertEqual(item.get("ad_cost"), 55000)
        self.assertEqual(item.get("ad_purchase_conversions"), 3)
        self.assertAlmostEqual(float(item.get("ad_spend_ratio") or 0.0), 0.5, places=4)
        self.assertEqual(item.get("approval_recommendation"), "APPROVE")
        learning_summary = item.get("learning_summary") or {}
        self.assertEqual(learning_summary.get("verified_count"), 1)
        self.assertEqual(learning_summary.get("improved_count"), 1)
        self.assertLess(float(learning_summary.get("avg_ad_spend_ratio_delta") or 0.0), 0.0)

    def test_ai_ops_ads_budget_candidates_reflect_overinvestment_learning_priority(self) -> None:
        target_date = date(2026, 4, 12)
        with SessionLocal() as db:
            db.add_all(
                [
                    TrackedProductMeta(
                        product_url="https://smartstore.naver.com/test/products/9501",
                        keyword="예산학습키워드",
                        title="예산 학습 상품",
                        mall_name="테스트몰",
                        product_id_catalog=9501,
                    ),
                    ActionQueueItem(
                        queue_id="queue-budget-learning-1",
                        source_scope="ai-ops-sales",
                        entity_type="product",
                        entity_id="9501",
                        action_type="QUEUE_SALES_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[판매 AD_OVERINVESTMENT] 예산 학습 상품",
                                "product_id": 9501,
                                "action_bucket": "AD_OVERINVESTMENT",
                                "keyword": "예산학습키워드",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 10, 0, 0),
                        updated_at=datetime(2026, 4, 4, 10, 0, 0),
                    ),
                    NaverCommerceProductSalesDaily(
                        date=date(2026, 4, 4),
                        product_id=9501,
                        source="commerce_orders",
                        product_name="예산 학습 상품",
                        order_count=2,
                        quantity=2,
                        amount=90000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=date(2026, 4, 11),
                        product_id=9501,
                        source="commerce_orders",
                        product_name="예산 학습 상품",
                        order_count=4,
                        quantity=4,
                        amount=150000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="예산학습키워드",
                        device="ALL",
                        impressions=1700,
                        clicks=28,
                        cost=48000,
                        conversions=4,
                        revenue=180000,
                        purchase_conversions=3,
                        purchase_revenue=180000,
                        ctr=1.6,
                        cpc=1714.0,
                        cvr=14.2,
                        roas=375.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 11),
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="예산학습키워드",
                        device="ALL",
                        impressions=1500,
                        clicks=22,
                        cost=21000,
                        conversions=4,
                        revenue=175000,
                        purchase_conversions=3,
                        purchase_revenue=175000,
                        ctr=1.4,
                        cpc=954.0,
                        cvr=18.1,
                        roas=833.3,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="예산학습키워드",
                        device="ALL",
                        impressions=1000,
                        clicks=14,
                        cost=18000,
                        conversions=1,
                        revenue=12000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.4,
                        cpc=1285.0,
                        cvr=7.1,
                        roas=66.7,
                        source="searchad_api",
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/ads")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        budget_items = body.get("budget_items") or []
        item = next((row for row in budget_items if row.get("keyword") == "예산학습키워드"), None)
        self.assertIsNotNone(item)
        self.assertEqual(item.get("budget_direction"), "DECREASE")
        self.assertEqual(item.get("approval_recommendation"), "APPROVE")
        self.assertIn("학습", str(item.get("approval_recommendation_reason") or ""))
        learning_summary = item.get("learning_summary") or {}
        self.assertEqual(learning_summary.get("verified_count"), 1)
        self.assertEqual(learning_summary.get("improved_count"), 1)

    def test_ai_ops_ads_candidates_reflect_ad_action_learning_priority(self) -> None:
        target_date = date(2026, 4, 12)
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverProductRankDaily(
                        date=target_date,
                        keyword="브랜드 키워드",
                        rank=1,
                        product_title="브랜드 상품",
                        mall_name="브랜드몰",
                        price=12000,
                        purchase_cnt=140,
                        product_id=1,
                    ),
                    ActionQueueItem(
                        queue_id="queue-cannibal-learning-1",
                        source_scope="ai-ops-ads-budget",
                        entity_type="ad_keyword",
                        entity_id="브랜드 캠페인::방어 그룹::브랜드 키워드",
                        action_type="QUEUE_AD_BUDGET_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[광고 예산] 브랜드 키워드",
                                "campaign_name": "브랜드 캠페인",
                                "adgroup_name": "방어 그룹",
                                "keyword": "브랜드 키워드",
                                "action_kind": "CANNIBALIZATION_DECREASE",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 10, 0, 0),
                        updated_at=datetime(2026, 4, 4, 10, 0, 0),
                    ),
                    ActionQueueItem(
                        queue_id="queue-budget-increase-learning-1",
                        source_scope="ai-ops-ads-budget",
                        entity_type="ad_keyword",
                        entity_id="성장 캠페인::확장 그룹::확장 키워드",
                        action_type="QUEUE_AD_BUDGET_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[광고 예산] 확장 키워드",
                                "campaign_name": "성장 캠페인",
                                "adgroup_name": "확장 그룹",
                                "keyword": "확장 키워드",
                                "action_kind": "BUDGET_INCREASE",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 10, 0, 0),
                        updated_at=datetime(2026, 4, 4, 10, 0, 0),
                    ),
                    ActionQueueItem(
                        queue_id="queue-budget-decrease-learning-1",
                        source_scope="ai-ops-ads-budget",
                        entity_type="ad_keyword",
                        entity_id="효율 캠페인::정리 그룹::비효율 키워드",
                        action_type="QUEUE_AD_BUDGET_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[광고 예산] 비효율 키워드",
                                "campaign_name": "효율 캠페인",
                                "adgroup_name": "정리 그룹",
                                "keyword": "비효율 키워드",
                                "action_kind": "BUDGET_DECREASE",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 10, 0, 0),
                        updated_at=datetime(2026, 4, 4, 10, 0, 0),
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="브랜드 키워드",
                        device="ALL",
                        impressions=1200,
                        clicks=18,
                        cost=30000,
                        conversions=1,
                        revenue=12000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.5,
                        cpc=1666.0,
                        cvr=5.5,
                        roas=40.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="브랜드 키워드",
                        device="ALL",
                        impressions=1100,
                        clicks=14,
                        cost=18000,
                        conversions=1,
                        revenue=12000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.3,
                        cpc=1285.0,
                        cvr=7.1,
                        roas=66.7,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=900,
                        clicks=18,
                        cost=12000,
                        conversions=4,
                        revenue=60000,
                        purchase_conversions=2,
                        purchase_revenue=60000,
                        ctr=2.0,
                        cpc=666.0,
                        cvr=22.2,
                        roas=500.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=1100,
                        clicks=24,
                        cost=18000,
                        conversions=6,
                        revenue=90000,
                        purchase_conversions=4,
                        purchase_revenue=90000,
                        ctr=2.2,
                        cpc=750.0,
                        cvr=25.0,
                        roas=500.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="효율 캠페인",
                        adgroup_name="정리 그룹",
                        keyword="비효율 키워드",
                        device="ALL",
                        impressions=1400,
                        clicks=20,
                        cost=26000,
                        conversions=1,
                        revenue=10000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.4,
                        cpc=1300.0,
                        cvr=5.0,
                        roas=38.5,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="효율 캠페인",
                        adgroup_name="정리 그룹",
                        keyword="비효율 키워드",
                        device="ALL",
                        impressions=1100,
                        clicks=13,
                        cost=17000,
                        conversions=1,
                        revenue=15000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.2,
                        cpc=1307.0,
                        cvr=7.7,
                        roas=88.2,
                        source="searchad_api",
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/ads")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        cannibalization_item = next((row for row in (body.get("cannibalization_items") or []) if row.get("keyword") == "브랜드 키워드"), None)
        increase_item = next((row for row in (body.get("budget_items") or []) if row.get("keyword") == "확장 키워드"), None)
        decrease_item = next((row for row in (body.get("budget_items") or []) if row.get("keyword") == "비효율 키워드"), None)
        self.assertIsNotNone(cannibalization_item)
        self.assertIsNotNone(increase_item)
        self.assertIsNotNone(decrease_item)
        self.assertEqual(cannibalization_item.get("approval_recommendation"), "APPROVE")
        self.assertIn("학습", str(cannibalization_item.get("approval_recommendation_reason") or ""))
        self.assertEqual(increase_item.get("approval_recommendation"), "APPROVE")
        self.assertIn("학습", str(increase_item.get("approval_recommendation_reason") or ""))
        self.assertEqual(decrease_item.get("approval_recommendation"), "APPROVE")
        self.assertIn("학습", str(decrease_item.get("approval_recommendation_reason") or ""))
        self.assertEqual((cannibalization_item.get("learning_summary") or {}).get("verified_count"), 1)
        self.assertEqual((increase_item.get("learning_summary") or {}).get("improved_count"), 1)
        self.assertLess(float((decrease_item.get("learning_summary") or {}).get("avg_cost_delta") or 0.0), 0.0)

    def test_ai_ops_actions_list_includes_verification_summary_for_ad_budget_action(self) -> None:
        target_date = date(2026, 4, 11)
        latest_date = date(2026, 4, 18)
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverProductRankDaily(
                        date=target_date,
                        keyword="브랜드 키워드",
                        rank=1,
                        product_title="브랜드 상품",
                        mall_name="브랜드몰",
                        price=12000,
                        purchase_cnt=120,
                        product_id=1,
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="브랜드 키워드",
                        device="ALL",
                        impressions=1200,
                        clicks=18,
                        cost=32000,
                        conversions=1,
                        revenue=12000,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=1.5,
                        cpc=1777.0,
                        cvr=5.5,
                        roas=37.5,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=latest_date,
                        campaign_name="브랜드 캠페인",
                        adgroup_name="방어 그룹",
                        keyword="브랜드 키워드",
                        device="ALL",
                        impressions=1000,
                        clicks=12,
                        cost=15000,
                        conversions=1,
                        revenue=14000,
                        purchase_conversions=1,
                        purchase_revenue=14000,
                        ctr=1.2,
                        cpc=1250.0,
                        cvr=8.3,
                        roas=93.3,
                        source="searchad_api",
                    ),
                    ActionQueueItem(
                        queue_id="queue-ad-budget-verify-1",
                        source_scope="ai-ops-ads-budget",
                        entity_type="ad_keyword",
                        entity_id="브랜드 캠페인::방어 그룹::브랜드 키워드",
                        action_type="QUEUE_AD_BUDGET_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[광고 예산] 브랜드 키워드",
                                "campaign_name": "브랜드 캠페인",
                                "adgroup_name": "방어 그룹",
                                "keyword": "브랜드 키워드",
                                "action_kind": "CANNIBALIZATION_DECREASE",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        reviewer="ops_manager",
                        review_note="잠식 감액 승인",
                        created_at=datetime(2026, 4, 11, 9, 0, 0),
                        updated_at=datetime(2026, 4, 11, 9, 0, 0),
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/actions")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = next((row for row in (body.get("items") or []) if row.get("queue_id") == "queue-ad-budget-verify-1"), None)
        self.assertIsNotNone(item)
        verification = item.get("verification") or {}
        self.assertEqual(verification.get("status"), "READY_7D")
        self.assertEqual(verification.get("outcome"), "IMPROVED")
        self.assertEqual(verification.get("baseline_date"), "2026-04-11")
        self.assertEqual(verification.get("latest_date"), "2026-04-18")
        metrics = verification.get("metrics") or {}
        self.assertLess(float(metrics.get("ad_cost_delta") or 0.0), 0.0)
        self.assertGreaterEqual(float(metrics.get("purchase_conversions_delta") or 0.0), 1.0)
        self.assertGreater(float(metrics.get("ad_roas_delta") or 0.0), 0.0)

    def test_ai_ops_sales_action_creates_queue_item(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=9101,
                    source="commerce_orders",
                    product_name="환불 보류 상품",
                    order_count=5,
                    quantity=6,
                    amount=180000,
                    refund_order_count=2,
                    refund_quantity=2,
                    refund_amount=70000,
                )
            )
            db.commit()

        resp = self.client.post(
            "/ai/ops/sales/actions",
            json={
                "product_id": 9101,
                "action_bucket": "RISK_HOLD",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = body.get("item") or {}
        self.assertEqual(item.get("action_type"), "QUEUE_SALES_ACTION")
        self.assertEqual(item.get("priority"), "P1")
        self.assertEqual(item.get("approval_recommendation"), "APPROVE")
        payload = item.get("payload") or {}
        self.assertEqual(payload.get("product_id"), 9101)
        self.assertEqual(payload.get("action_bucket"), "RISK_HOLD")
        self.assertEqual(payload.get("recommended_action"), "확대 보류 및 환불 원인 점검")

    def test_ai_ops_sales_action_creates_queue_item_for_ad_overinvestment(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=9301,
                    source="commerce_orders",
                    product_name="광고 과투입 상품",
                    order_count=2,
                    quantity=2,
                    amount=100000,
                    refund_order_count=0,
                    refund_quantity=0,
                    refund_amount=0,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/test/products/9301",
                    keyword="과투입키워드",
                    title="광고 과투입 상품",
                    mall_name="테스트몰",
                    product_id_catalog=9301,
                )
            )
            db.add(
                NaverAdKeywordDaily(
                    date=target_date,
                    campaign_name="성장 캠페인",
                    adgroup_name="확장 그룹",
                    keyword="과투입키워드",
                    device="ALL",
                    impressions=1700,
                    clicks=28,
                    cost=52000,
                    conversions=4,
                    revenue=190000,
                    purchase_conversions=3,
                    purchase_revenue=190000,
                    ctr=1.6,
                    cpc=1857.0,
                    cvr=14.2,
                    roas=365.4,
                    source="searchad_api",
                )
            )
            db.commit()

        resp = self.client.post(
            "/ai/ops/sales/actions",
            json={
                "product_id": 9301,
                "action_bucket": "AD_OVERINVESTMENT",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = body.get("item") or {}
        self.assertEqual(item.get("action_type"), "QUEUE_SALES_ACTION")
        self.assertEqual(item.get("priority"), "P1")
        self.assertEqual(item.get("approval_recommendation"), "REVIEW")
        payload = item.get("payload") or {}
        self.assertEqual(payload.get("product_id"), 9301)
        self.assertEqual(payload.get("action_bucket"), "AD_OVERINVESTMENT")
        self.assertEqual(payload.get("keyword"), "과투입키워드")
        self.assertEqual(payload.get("recommended_action"), "광고 과투입 점검 및 예산 축소 테스트")

    def test_ai_ops_ads_action_creates_queue_item(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                NaverAdKeywordDaily(
                    date=target_date,
                    campaign_name="브랜드 캠페인",
                    adgroup_name="방어 그룹",
                    keyword="브랜드 키워드",
                    device="ALL",
                    impressions=1000,
                    clicks=12,
                    cost=15000,
                    conversions=0,
                    revenue=0,
                    purchase_conversions=0,
                    purchase_revenue=0,
                    ctr=1.2,
                    cpc=1250.0,
                    cvr=0.0,
                    roas=0.0,
                    source="searchad_api",
                )
            )
            db.commit()

        resp = self.client.post(
            "/ai/ops/ads/actions",
            json={
                "campaign_name": "브랜드 캠페인",
                "adgroup_name": "방어 그룹",
                "keyword": "브랜드 키워드",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = body.get("item") or {}
        self.assertEqual(item.get("action_type"), "QUEUE_AD_KEYWORD_ACTION")
        self.assertEqual(item.get("priority"), "P1")
        self.assertEqual(item.get("approval_recommendation"), "APPROVE")
        payload = item.get("payload") or {}
        self.assertEqual(payload.get("action_bucket"), "STOP")
        self.assertEqual(payload.get("recommended_action"), "비효율 키워드 중단")

    def test_ai_ops_actions_create_and_list_queue_items(self) -> None:
        create_resp = self.client.post(
            "/ai/ops/actions",
            json={
                "source_scope": "ai-ops-products",
                "entity_type": "sku",
                "entity_id": "SKU-99",
                "action_type": "TEST",
                "payload": {"title": "광고 테스트", "days": 3},
                "priority": "P1",
            },
        )
        self.assertEqual(create_resp.status_code, 200, msg=create_resp.text)
        created = create_resp.json()
        self.assertTrue(created.get("ok"))
        self.assertEqual(created.get("item", {}).get("entity_id"), "SKU-99")
        self.assertEqual(created.get("item", {}).get("status"), "PENDING")

        list_resp = self.client.get("/ai/ops/actions")
        self.assertEqual(list_resp.status_code, 200, msg=list_resp.text)
        listed = list_resp.json()
        self.assertTrue(listed.get("ok"))
        self.assertEqual(listed.get("summary", {}).get("pending_count"), 1)
        self.assertEqual((listed.get("items") or [])[0].get("action_type"), "TEST")

    def test_ai_ops_actions_update_status_and_review_note(self) -> None:
        with SessionLocal() as db:
            db.add(
                ActionQueueItem(
                    queue_id="queue-update-1",
                    source_scope="ai-ops-products",
                    entity_type="sku",
                    entity_id="SKU-777",
                    action_type="QUEUE_PRIMARY_ACTION",
                    payload_json='{"title":"방어 광고 3일 테스트"}',
                    priority="P1",
                    status="PENDING",
                )
            )
            db.commit()

        update_resp = self.client.post(
            "/ai/ops/actions/queue-update-1/status",
            json={
                "status": "APPROVED",
                "reviewer": "ops_manager",
                "review_note": "3일간 테스트 후 효율 재검증",
            },
        )
        self.assertEqual(update_resp.status_code, 200, msg=update_resp.text)
        updated = update_resp.json()
        self.assertTrue(updated.get("ok"))
        self.assertEqual(updated.get("item", {}).get("status"), "APPROVED")
        self.assertEqual(updated.get("item", {}).get("reviewer"), "ops_manager")
        self.assertEqual(updated.get("item", {}).get("review_note"), "3일간 테스트 후 효율 재검증")

        list_resp = self.client.get("/ai/ops/actions")
        self.assertEqual(list_resp.status_code, 200, msg=list_resp.text)
        listed = list_resp.json()
        item = (listed.get("items") or [None])[0]
        self.assertIsNotNone(item)
        self.assertEqual(item.get("status"), "APPROVED")
        self.assertEqual(item.get("review_note"), "3일간 테스트 후 효율 재검증")

    def test_ai_ops_actions_list_includes_verification_summary_for_compare_action(self) -> None:
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 11),
                        sku_id="SKU-VERIFY-1",
                        product_name="검증 상품",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="FAQ 보강 필요",
                        priority_score=84.0,
                        confidence_score=0.92,
                        data_quality_score=0.96,
                        organic_strength_score=60.0,
                        sales_growth_score=40.0,
                        review_risk_score=70.0,
                        qna_barrier_score=75.0,
                        recommended_action_primary="FAQ 보강",
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 18),
                        sku_id="SKU-VERIFY-1",
                        product_name="검증 상품",
                        policy_type="AD_GROWTH",
                        top_issue="확장 가능",
                        priority_score=62.0,
                        confidence_score=0.93,
                        data_quality_score=0.97,
                        organic_strength_score=78.0,
                        sales_growth_score=64.0,
                        review_risk_score=42.0,
                        qna_barrier_score=35.0,
                        recommended_action_primary="광고 확대 테스트",
                    ),
                    ActionQueueItem(
                        queue_id="queue-verify-1",
                        source_scope="ai-ops-policy-compare",
                        entity_type="sku",
                        entity_id="SKU-VERIFY-1",
                        action_type="QUEUE_POLICY_COMPARE_ACTION",
                        payload_json='{"title":"[브랜드A 정책팩] 광고 확대 테스트","target_policy_type":"AD_GROWTH","approval_recommendation":"APPROVE","approval_recommendation_reason":"추천 점수 82점으로 즉시 테스트 승인을 권장합니다."}',
                        priority="P1",
                        status="APPROVED",
                        reviewer="ops_manager",
                        review_note="7일 후 성과 확인",
                        created_at=datetime(2026, 4, 11, 9, 0, 0),
                        updated_at=datetime(2026, 4, 11, 9, 30, 0),
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/actions")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = (body.get("items") or [None])[0]
        self.assertIsNotNone(item)
        self.assertEqual(item.get("approval_recommendation"), "APPROVE")
        self.assertIn("즉시 테스트 승인", str(item.get("approval_recommendation_reason") or ""))
        verification = item.get("verification") or {}
        self.assertEqual(verification.get("status"), "READY_7D")
        self.assertEqual(verification.get("outcome"), "IMPROVED")
        self.assertEqual(verification.get("baseline_date"), "2026-04-11")
        self.assertEqual(verification.get("latest_date"), "2026-04-18")
        self.assertGreater(float((verification.get("metrics") or {}).get("sales_growth_delta") or 0.0), 0.0)

    def test_ai_ops_actions_list_includes_verification_summary_for_sales_overinvestment_action(self) -> None:
        target_date = date(2026, 4, 11)
        latest_date = date(2026, 4, 18)
        with SessionLocal() as db:
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/test/products/9401",
                    keyword="검증과투입키워드",
                    title="과투입 검증 상품",
                    mall_name="테스트몰",
                    product_id_catalog=9401,
                )
            )
            db.add_all(
                [
                    NaverCommerceProductSalesDaily(
                        date=target_date,
                        product_id=9401,
                        source="commerce_orders",
                        product_name="과투입 검증 상품",
                        order_count=2,
                        quantity=2,
                        amount=110000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=latest_date,
                        product_id=9401,
                        source="commerce_orders",
                        product_name="과투입 검증 상품",
                        order_count=4,
                        quantity=4,
                        amount=180000,
                        refund_order_count=0,
                        refund_quantity=0,
                        refund_amount=0,
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="검증과투입키워드",
                        device="ALL",
                        impressions=1800,
                        clicks=32,
                        cost=55000,
                        conversions=4,
                        revenue=200000,
                        purchase_conversions=3,
                        purchase_revenue=200000,
                        ctr=1.8,
                        cpc=1718.0,
                        cvr=12.5,
                        roas=363.6,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=latest_date,
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="검증과투입키워드",
                        device="ALL",
                        impressions=1600,
                        clicks=24,
                        cost=25000,
                        conversions=4,
                        revenue=210000,
                        purchase_conversions=3,
                        purchase_revenue=210000,
                        ctr=1.5,
                        cpc=1041.0,
                        cvr=16.6,
                        roas=840.0,
                        source="searchad_api",
                    ),
                    ActionQueueItem(
                        queue_id="queue-sales-verify-1",
                        source_scope="ai-ops-sales",
                        entity_type="product",
                        entity_id="9401",
                        action_type="QUEUE_SALES_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[판매 AD_OVERINVESTMENT] 과투입 검증 상품",
                                "product_id": 9401,
                                "action_bucket": "AD_OVERINVESTMENT",
                                "keyword": "검증과투입키워드",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        reviewer="ops_manager",
                        review_note="광고비 비중 축소 테스트 승인",
                        created_at=datetime(2026, 4, 11, 10, 0, 0),
                        updated_at=datetime(2026, 4, 11, 10, 0, 0),
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/actions")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = next((row for row in (body.get("items") or []) if row.get("queue_id") == "queue-sales-verify-1"), None)
        self.assertIsNotNone(item)
        verification = item.get("verification") or {}
        self.assertEqual(verification.get("status"), "READY_7D")
        self.assertEqual(verification.get("outcome"), "IMPROVED")
        self.assertEqual(verification.get("baseline_date"), "2026-04-11")
        self.assertEqual(verification.get("latest_date"), "2026-04-18")
        metrics = verification.get("metrics") or {}
        self.assertLess(float(metrics.get("ad_spend_ratio_delta") or 0.0), 0.0)
        self.assertGreater(float(metrics.get("net_amount_delta") or 0.0), 0.0)
        self.assertLess(float(metrics.get("ad_cost_delta") or 0.0), 0.0)

    def test_ai_ops_product_health_rebuild_aggregates_sales_reviews_qna_into_snapshot(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                A1SkuMap(
                    sku_id="SKU-OPS-1",
                    product_url="https://smartstore.naver.com/test/products/1001",
                    product_id_catalog=1001,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/test/products/1001",
                    keyword="테스트",
                    title="테스트 상품",
                    mall_name="테스트몰",
                    product_id_catalog=1001,
                )
            )
            db.add(
                A1SkuStateDaily(
                    date=target_date,
                    surface="organic_rank",
                    sku_id="SKU-OPS-1",
                    state="VERY_STABLE",
                    reasons_json='["top rank stable"]',
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=1001,
                    source="commerce_orders",
                    product_name="테스트 상품",
                    order_count=12,
                    quantity=15,
                    amount=240000,
                    refund_order_count=1,
                    refund_quantity=1,
                    refund_amount=12000,
                )
            )
            db.add(
                NaverProductReviewDaily(
                    date=target_date,
                    keyword="테스트",
                    product_id=1001,
                    product_title="테스트 상품",
                    mall_name="테스트몰",
                    rating_avg=3.8,
                    rating_count=100,
                    rating_1_cnt=10,
                    rating_2_cnt=8,
                    rating_3_cnt=12,
                    rating_4_cnt=25,
                    rating_5_cnt=45,
                )
            )
            db.add(
                CommerceQnaRaw(
                    qna_key="QNA-1",
                    qna_kind="product",
                    external_inquiry_id="EXT-1",
                    inquiry_text="이 상품은 사용법이 어렵나요?",
                    inquiry_registered_at=datetime(2026, 4, 10, 9, 0, 0),
                    product_no="1001",
                    product_name="테스트 상품",
                )
            )
            db.add(
                CommerceQnaAnalysis(
                    analysis_id="AN-1",
                    qna_key="QNA-1",
                    qna_kind="product",
                    inquiry_type="usage",
                    purchase_stage="pre_purchase",
                    sentiment="neutral",
                    urgency_level="medium",
                    conversion_impact_level="high",
                    conversion_impact_score=0.84,
                    quality_issue_flag=True,
                    faq_candidate_flag=True,
                    recommended_action="FAQ 보강",
                    confidence_score=0.92,
                )
            )
            db.commit()

        resp = self.client.post("/ai/ops/product-health/rebuild", json={"date": "2026-04-11"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("saved"), 1)

        with SessionLocal() as db:
            row = db.query(DecisionProductHealthDaily).filter(DecisionProductHealthDaily.date == target_date).one()

        self.assertEqual(row.sku_id, "SKU-OPS-1")
        self.assertEqual(row.product_id_catalog, 1001)
        self.assertEqual(row.product_name, "테스트 상품")
        self.assertEqual(row.policy_type, "FAQ_CONTENT_IMPROVEMENT")
        self.assertGreater(float(row.sales_growth_score or 0.0), 0.0)
        self.assertGreater(float(row.review_risk_score or 0.0), 0.0)
        self.assertGreater(float(row.qna_barrier_score or 0.0), 0.0)
        self.assertGreater(float(row.data_quality_score or 0.0), 0.9)
        self.assertIn("FAQ", str(row.recommended_action_primary or ""))

    def test_ai_ops_product_health_rebuild_falls_back_to_tracked_products_when_a1_sku_map_is_empty(self) -> None:
        target_date = date(2026, 4, 11)
        product_url = "https://smartstore.naver.com/test/products/5001"
        with SessionLocal() as db:
            db.add(
                TrackedProductKeyword(
                    product_url=product_url,
                    keyword="폴백테스트",
                    is_active=True,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="폴백테스트",
                    title="폴백 테스트 상품",
                    mall_name="테스트몰",
                    product_id_catalog=5001,
                )
            )
            db.add(
                A1SkuStateDaily(
                    date=target_date,
                    surface="organic_rank",
                    sku_id=product_url,
                    state="VERY_STABLE",
                    reasons_json='["tracked fallback"]',
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=5001,
                    source="commerce_orders",
                    product_name="폴백 테스트 상품",
                    order_count=5,
                    quantity=6,
                    amount=125000,
                    refund_order_count=0,
                    refund_quantity=0,
                    refund_amount=0,
                )
            )
            db.add(
                NaverProductReviewDaily(
                    date=target_date,
                    keyword="폴백테스트",
                    product_id=5001,
                    product_title="폴백 테스트 상품",
                    mall_name="테스트몰",
                    rating_avg=4.1,
                    rating_count=40,
                    rating_1_cnt=2,
                    rating_2_cnt=2,
                    rating_3_cnt=4,
                    rating_4_cnt=10,
                    rating_5_cnt=22,
                )
            )
            db.add(
                CommerceQnaRaw(
                    qna_key="QNA-FALLBACK-1",
                    qna_kind="product",
                    external_inquiry_id="EXT-FALLBACK-1",
                    inquiry_text="상세 설명이 더 필요한가요?",
                    inquiry_registered_at=datetime(2026, 4, 10, 9, 0, 0),
                    product_no="5001",
                    product_name="폴백 테스트 상품",
                )
            )
            db.add(
                CommerceQnaAnalysis(
                    analysis_id="AN-FALLBACK-1",
                    qna_key="QNA-FALLBACK-1",
                    qna_kind="product",
                    inquiry_type="usage",
                    purchase_stage="pre_purchase",
                    sentiment="neutral",
                    urgency_level="medium",
                    conversion_impact_level="high",
                    conversion_impact_score=0.72,
                    quality_issue_flag=False,
                    faq_candidate_flag=True,
                    recommended_action="FAQ 보강",
                    confidence_score=0.89,
                )
            )
            db.commit()

        resp = self.client.post("/ai/ops/product-health/rebuild", json={"date": "2026-04-11"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("saved"), 1)

        with SessionLocal() as db:
            row = db.query(DecisionProductHealthDaily).filter(DecisionProductHealthDaily.date == target_date).one()

        self.assertEqual(row.sku_id, product_url)
        self.assertEqual(row.product_id_catalog, 5001)
        self.assertEqual(row.product_name, "폴백 테스트 상품")
        self.assertGreater(float(row.sales_growth_score or 0.0), 0.0)
        self.assertGreater(float(row.review_risk_score or 0.0), 0.0)
        self.assertGreater(float(row.qna_barrier_score or 0.0), 0.0)

    def test_ai_ops_product_health_rebuild_prefers_real_product_title_when_sales_name_is_url(self) -> None:
        target_date = date(2026, 4, 11)
        product_url = "https://smartstore.naver.com/test/products/7001"
        with SessionLocal() as db:
            db.add(
                A1SkuMap(
                    sku_id="SKU-OPS-URL-1",
                    product_url=product_url,
                    product_id_catalog=7001,
                )
            )
            db.add(
                A1SkuStateDaily(
                    date=target_date,
                    surface="organic_rank",
                    sku_id="SKU-OPS-URL-1",
                    state="VERY_STABLE",
                    reasons_json='["url name fallback"]',
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=7001,
                    source="commerce_orders",
                    product_name=product_url,
                    order_count=4,
                    quantity=5,
                    amount=99000,
                    refund_order_count=0,
                    refund_quantity=0,
                    refund_amount=0,
                )
            )
            db.add(
                NaverProductReviewDaily(
                    date=target_date,
                    keyword="url폴백테스트",
                    product_id=7001,
                    product_title="URL 폴백 상품명",
                    mall_name="테스트몰",
                    rating_avg=4.2,
                    rating_count=25,
                    rating_1_cnt=1,
                    rating_2_cnt=1,
                    rating_3_cnt=2,
                    rating_4_cnt=8,
                    rating_5_cnt=13,
                )
            )
            db.commit()

        resp = self.client.post("/ai/ops/product-health/rebuild", json={"date": "2026-04-11"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("saved"), 1)

        with SessionLocal() as db:
            row = (
                db.query(DecisionProductHealthDaily)
                .filter(DecisionProductHealthDaily.date == target_date, DecisionProductHealthDaily.sku_id == "SKU-OPS-URL-1")
                .one()
            )

        self.assertEqual(row.product_name, "URL 폴백 상품명")
        self.assertNotEqual(row.product_name, product_url)

    def test_ai_ops_product_health_rebuild_records_ad_overinvestment_evidence_in_snapshot_and_log(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                A1SkuMap(
                    sku_id="SKU-OPS-OVER-1",
                    product_url="https://smartstore.naver.com/test/products/9201",
                    product_id_catalog=9201,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/test/products/9201",
                    keyword="착시키워드",
                    title="광고 착시 상품",
                    mall_name="테스트몰",
                    product_id_catalog=9201,
                )
            )
            db.add(
                A1SkuStateDaily(
                    date=target_date,
                    surface="organic_rank",
                    sku_id="SKU-OPS-OVER-1",
                    state="GROWTH_NEEDED",
                    reasons_json='["growth"]',
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=9201,
                    source="commerce_orders",
                    product_name="광고 착시 상품",
                    order_count=2,
                    quantity=2,
                    amount=110000,
                    refund_order_count=0,
                    refund_quantity=0,
                    refund_amount=0,
                )
            )
            db.add(
                NaverAdKeywordDaily(
                    date=target_date,
                    campaign_name="성장 캠페인",
                    adgroup_name="확장 그룹",
                    keyword="착시키워드",
                    device="ALL",
                    impressions=1800,
                    clicks=32,
                    cost=55000,
                    conversions=4,
                    revenue=200000,
                    purchase_conversions=3,
                    purchase_revenue=200000,
                    ctr=1.8,
                    cpc=1718.0,
                    cvr=12.5,
                    roas=363.6,
                    source="searchad_api",
                )
            )
            db.commit()

        resp = self.client.post("/ai/ops/product-health/rebuild", json={"date": "2026-04-11"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)

        with SessionLocal() as db:
            row = (
                db.query(DecisionProductHealthDaily)
                .filter(DecisionProductHealthDaily.date == target_date, DecisionProductHealthDaily.sku_id == "SKU-OPS-OVER-1")
                .one()
            )
            log = (
                db.query(AiDecisionLog)
                .filter(AiDecisionLog.analysis_type == "AI_OPS_PRODUCT_HEALTH", AiDecisionLog.entity_id == "SKU-OPS-OVER-1")
                .order_by(AiDecisionLog.created_at.desc())
                .first()
            )

        evidence = main._json_loads_dict(row.evidence_json)
        sales_evidence = evidence.get("sales") or {}
        overinvestment = sales_evidence.get("ad_overinvestment") or {}
        self.assertEqual(overinvestment.get("keyword"), "착시키워드")
        self.assertEqual(overinvestment.get("ad_cost"), 55000)
        self.assertAlmostEqual(float(overinvestment.get("ad_spend_ratio") or 0.0), 0.5, places=4)
        self.assertIsNotNone(log)
        rules_triggered = json.loads(str(getattr(log, "rules_triggered", "") or "[]"))
        self.assertIn("ad_overinvestment_detected", rules_triggered)
        self.assertIn("광고 과투입", str(getattr(log, "analysis_text", "") or ""))

    def test_ai_ops_product_health_rebuild_replaces_same_date_snapshot(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                DecisionProductHealthDaily(
                    date=target_date,
                    sku_id="OLD-SKU",
                    product_name="오래된 데이터",
                    policy_type="AD_DEFENSE",
                    top_issue="old",
                    priority_score=10.0,
                    confidence_score=0.1,
                    data_quality_score=0.1,
                )
            )
            db.add(
                A1SkuMap(
                    sku_id="SKU-OPS-2",
                    product_url="https://smartstore.naver.com/test/products/2002",
                    product_id_catalog=2002,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/test/products/2002",
                    keyword="상품",
                    title="신규 상품",
                    mall_name="테스트몰",
                    product_id_catalog=2002,
                )
            )
            db.add(
                A1SkuStateDaily(
                    date=target_date,
                    surface="organic_rank",
                    sku_id="SKU-OPS-2",
                    state="GROWTH_NEEDED",
                    reasons_json='["growth"]',
                )
            )
            db.commit()

        resp = self.client.post("/ai/ops/product-health/rebuild", json={"date": "2026-04-11"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)

        with SessionLocal() as db:
            rows = db.query(DecisionProductHealthDaily).filter(DecisionProductHealthDaily.date == target_date).all()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].sku_id, "SKU-OPS-2")

    def test_ai_ops_product_health_rebuild_uses_ai_settings_thresholds_for_policy_choice(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                A1SkuMap(
                    sku_id="SKU-OPS-CFG-1",
                    product_url="https://smartstore.naver.com/test/products/3001",
                    product_id_catalog=3001,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/test/products/3001",
                    keyword="설정테스트",
                    title="설정 테스트 상품",
                    mall_name="테스트몰",
                    product_id_catalog=3001,
                )
            )
            db.add(
                A1SkuStateDaily(
                    date=target_date,
                    surface="organic_rank",
                    sku_id="SKU-OPS-CFG-1",
                    state="VERY_STABLE",
                    reasons_json='["top rank stable"]',
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=3001,
                    source="commerce_orders",
                    product_name="설정 테스트 상품",
                    order_count=8,
                    quantity=10,
                    amount=180000,
                    refund_order_count=0,
                    refund_quantity=0,
                    refund_amount=0,
                )
            )
            db.add(
                NaverProductReviewDaily(
                    date=target_date,
                    keyword="설정테스트",
                    product_id=3001,
                    product_title="설정 테스트 상품",
                    mall_name="테스트몰",
                    rating_avg=4.6,
                    rating_count=40,
                    rating_1_cnt=1,
                    rating_2_cnt=1,
                    rating_3_cnt=2,
                    rating_4_cnt=10,
                    rating_5_cnt=26,
                )
            )
            db.add(
                CommerceQnaRaw(
                    qna_key="QNA-CFG-1",
                    qna_kind="product",
                    external_inquiry_id="EXT-CFG-1",
                    inquiry_text="이 상품은 설명서가 있나요?",
                    inquiry_registered_at=datetime(2026, 4, 10, 9, 0, 0),
                    product_no="3001",
                    product_name="설정 테스트 상품",
                )
            )
            db.add(
                CommerceQnaAnalysis(
                    analysis_id="AN-CFG-1",
                    qna_key="QNA-CFG-1",
                    qna_kind="product",
                    inquiry_type="usage",
                    purchase_stage="pre_purchase",
                    sentiment="neutral",
                    urgency_level="medium",
                    conversion_impact_level="high",
                    conversion_impact_score=0.82,
                    quality_issue_flag=False,
                    faq_candidate_flag=True,
                    recommended_action="FAQ 보강",
                    confidence_score=0.91,
                )
            )
            main._save_ai_settings(
                db,
                {
                    "format_version": "v2",
                    "common_rules": "AI Ops 임계값 테스트",
                    "rule_packs": [
                        {
                            "id": "A-1",
                            "enabled": True,
                            "title": "A-1 기본",
                            "a1": {"thresholds": {}},
                        },
                        {
                            "id": "AI_OPS",
                            "enabled": True,
                            "title": "AI Ops 정책팩",
                            "ai_ops": {
                                "thresholds": {
                                    "qna_barrier_high": 95,
                                    "review_risk_high": 80,
                                    "growth": {
                                        "organic_strength_min": 70,
                                        "sales_growth_min": 0,
                                        "review_risk_max": 100,
                                        "qna_barrier_max": 100,
                                    },
                                    "defense": {"organic_strength_max": 40},
                                }
                            },
                        },
                    ],
                },
            )
            db.commit()

        resp = self.client.post("/ai/ops/product-health/rebuild", json={"date": "2026-04-11"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)

        with SessionLocal() as db:
            row = db.query(DecisionProductHealthDaily).filter(DecisionProductHealthDaily.date == target_date).one()
            log = db.query(AiDecisionLog).filter(AiDecisionLog.entity_id == "SKU-OPS-CFG-1").order_by(AiDecisionLog.created_at.desc()).first()

        self.assertEqual(row.policy_type, "AD_GROWTH")
        self.assertIn("광고", str(row.recommended_action_primary or ""))
        self.assertIsNotNone(log)
        self.assertEqual(getattr(log, "decision", None), "AD_GROWTH")

    def test_ai_ops_product_health_rebuild_prefers_mall_scoped_policy_pack(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                A1SkuMap(
                    sku_id="SKU-OPS-SCOPE-1",
                    product_url="https://smartstore.naver.com/testscope/products/4001",
                    product_id_catalog=4001,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/testscope/products/4001",
                    keyword="브랜드정책",
                    title="브랜드 정책 상품",
                    mall_name="브랜드A몰",
                    product_id_catalog=4001,
                )
            )
            db.add(
                A1SkuStateDaily(
                    date=target_date,
                    surface="organic_rank",
                    sku_id="SKU-OPS-SCOPE-1",
                    state="VERY_STABLE",
                    reasons_json='["top rank stable"]',
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=4001,
                    source="commerce_orders",
                    product_name="브랜드 정책 상품",
                    order_count=6,
                    quantity=6,
                    amount=120000,
                    refund_order_count=0,
                    refund_quantity=0,
                    refund_amount=0,
                )
            )
            db.add(
                CommerceQnaRaw(
                    qna_key="QNA-SCOPE-1",
                    qna_kind="product",
                    external_inquiry_id="EXT-SCOPE-1",
                    inquiry_text="브랜드A몰 상품 상세 설명이 충분한가요?",
                    inquiry_registered_at=datetime(2026, 4, 10, 9, 0, 0),
                    product_no="4001",
                    product_name="브랜드 정책 상품",
                )
            )
            db.add(
                CommerceQnaAnalysis(
                    analysis_id="AN-SCOPE-1",
                    qna_key="QNA-SCOPE-1",
                    qna_kind="product",
                    inquiry_type="usage",
                    purchase_stage="pre_purchase",
                    sentiment="neutral",
                    urgency_level="medium",
                    conversion_impact_level="high",
                    conversion_impact_score=0.81,
                    quality_issue_flag=False,
                    faq_candidate_flag=True,
                    recommended_action="FAQ 보강",
                    confidence_score=0.88,
                )
            )
            main._save_ai_settings(
                db,
                {
                    "format_version": "v2",
                    "common_rules": "브랜드 스코프 테스트",
                    "rule_packs": [
                        {
                            "id": "A-1",
                            "enabled": True,
                            "title": "A-1 기본",
                            "a1": {"thresholds": {}},
                        },
                        {
                            "id": "AI_OPS",
                            "enabled": True,
                            "title": "공통 AI Ops",
                            "ai_ops": {
                                "scope": {"mall_names": []},
                                "thresholds": {
                                    "qna_barrier_high": 70,
                                    "review_risk_high": 65,
                                },
                            },
                        },
                        {
                            "id": "AI_OPS_BRAND_A",
                            "enabled": True,
                            "title": "브랜드A 전용 정책팩",
                            "ai_ops": {
                                "scope": {"mall_names": ["브랜드A몰"]},
                                "thresholds": {
                                    "qna_barrier_high": 95,
                                    "review_risk_high": 90,
                                    "growth": {
                                        "organic_strength_min": 70,
                                        "sales_growth_min": 0,
                                        "review_risk_max": 100,
                                        "qna_barrier_max": 100,
                                    },
                                    "defense": {"organic_strength_max": 40},
                                },
                            },
                        },
                    ],
                },
            )
            db.commit()

        resp = self.client.post("/ai/ops/product-health/rebuild", json={"date": "2026-04-11"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)

        with SessionLocal() as db:
            row = db.query(DecisionProductHealthDaily).filter(DecisionProductHealthDaily.date == target_date).one()
            log = db.query(AiDecisionLog).filter(AiDecisionLog.entity_id == "SKU-OPS-SCOPE-1").order_by(AiDecisionLog.created_at.desc()).first()

        self.assertEqual(row.policy_type, "AD_GROWTH")
        self.assertIsNotNone(log)
        self.assertIn("AI_OPS_BRAND_A", str(getattr(log, "inputs_json", "") or ""))

    def test_ai_ops_logs_returns_decision_log_with_action_status(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                DecisionProductHealthDaily(
                    date=target_date,
                    sku_id="SKU-LOG-1",
                    product_url="https://smartstore.naver.com/test/products/5001",
                    product_id_catalog=5001,
                    product_name="로그 상품",
                    policy_type="FAQ_CONTENT_IMPROVEMENT",
                    top_issue="FAQ 보강 필요",
                    priority_score=88.0,
                    confidence_score=0.93,
                    data_quality_score=0.97,
                    recommended_action_primary="FAQ 보강",
                    evidence_json='{"sales":{"net_amount":120000},"qna":{"faq_candidate_count":2}}',
                )
            )
            db.add(
                AiDecisionLog(
                    log_id="log-1",
                    analysis_type="AI_OPS_PRODUCT_HEALTH",
                    entity_type="SKU",
                    entity_id="SKU-LOG-1",
                    inputs_hash="hash-1",
                    inputs_json='{"sku_id":"SKU-LOG-1","snapshot_date":"2026-04-11"}',
                    decision="FAQ_CONTENT_IMPROVEMENT",
                    rules_triggered='["qna_barrier_high","faq_candidate_detected"]',
                    confidence=0.93,
                    recommended_actions='["FAQ 보강"]',
                    analysis_text="Q&A에서 FAQ 후보가 반복되어 상세 보강이 우선입니다.",
                )
            )
            db.add(
                ActionQueueItem(
                    queue_id="queue-log-1",
                    source_scope="ai-ops-products",
                    entity_type="sku",
                    entity_id="SKU-LOG-1",
                    action_type="QUEUE_PRIMARY_ACTION",
                    payload_json='{"title":"FAQ 보강"}',
                    priority="P1",
                    status="APPROVED",
                    reviewer="ops_manager",
                    review_note="이번 주 상세페이지 FAQ 먼저 반영",
                )
            )
            db.commit()

        resp = self.client.get("/ai/ops/logs")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("total_items"), 1)
        item = (body.get("items") or [None])[0]
        self.assertIsNotNone(item)
        self.assertEqual(item.get("sku_id"), "SKU-LOG-1")
        self.assertEqual(item.get("policy_type"), "FAQ_CONTENT_IMPROVEMENT")
        self.assertEqual(item.get("latest_action_status"), "APPROVED")
        self.assertEqual(item.get("latest_action_note"), "이번 주 상세페이지 FAQ 먼저 반영")
        self.assertIn("qna_barrier_high", item.get("rules_triggered") or [])
        self.assertIn("FAQ 보강", item.get("recommended_actions") or [])

    def test_ai_ops_logs_returns_policy_compare_action_payload_for_traceability(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                DecisionProductHealthDaily(
                    date=target_date,
                    sku_id="SKU-LOG-COMPARE-1",
                    product_name="로그 비교 상품",
                    policy_type="FAQ_CONTENT_IMPROVEMENT",
                    top_issue="FAQ 보강 필요",
                    priority_score=88.0,
                    confidence_score=0.93,
                    data_quality_score=0.97,
                    recommended_action_primary="FAQ 보강",
                    evidence_json='{"policy_pack_id":"AI_OPS"}',
                )
            )
            db.add(
                AiDecisionLog(
                    log_id="log-compare-1",
                    analysis_type="AI_OPS_PRODUCT_HEALTH",
                    entity_type="SKU",
                    entity_id="SKU-LOG-COMPARE-1",
                    inputs_hash="hash-compare-1",
                    inputs_json='{"sku_id":"SKU-LOG-COMPARE-1","snapshot_date":"2026-04-11"}',
                    decision="FAQ_CONTENT_IMPROVEMENT",
                    rules_triggered='["qna_barrier_high"]',
                    confidence=0.93,
                    recommended_actions='["FAQ 보강"]',
                    analysis_text="현재는 FAQ 보강 우선이나 정책 비교가 필요합니다.",
                )
            )
            db.add(
                ActionQueueItem(
                    queue_id="queue-log-compare-1",
                    source_scope="ai-ops-policy-compare",
                    entity_type="sku",
                    entity_id="SKU-LOG-COMPARE-1",
                    action_type="QUEUE_POLICY_COMPARE_ACTION",
                    payload_json='{"title":"[브랜드A 정책팩] 광고 확대 테스트","current_policy_pack_id":"AI_OPS","current_policy_type":"FAQ_CONTENT_IMPROVEMENT","current_recommended_action":"FAQ 보강","target_policy_pack_id":"AI_OPS_BRAND_A","target_policy_pack_title":"브랜드A 정책팩","target_policy_type":"AD_GROWTH","target_recommended_action":"광고 확대 테스트","changed_fields":["policy_type","recommended_action_primary"]}',
                    priority="P1",
                    status="APPROVED",
                    reviewer="ops_manager",
                    review_note="브랜드 정책팩 기준으로 확대 승인",
                )
            )
            db.commit()

        resp = self.client.get("/ai/ops/logs")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = (body.get("items") or [None])[0]
        self.assertIsNotNone(item)
        self.assertEqual(item.get("latest_action_status"), "APPROVED")
        self.assertEqual(item.get("latest_action_type"), "QUEUE_POLICY_COMPARE_ACTION")
        payload = item.get("latest_action_payload") or {}
        self.assertEqual(payload.get("current_policy_pack_id"), "AI_OPS")
        self.assertEqual(payload.get("target_policy_pack_title"), "브랜드A 정책팩")
        self.assertIn("policy_type", payload.get("changed_fields") or [])

    def test_ai_ops_policies_returns_policy_summary_with_ai_settings_metadata(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-POL-1",
                        product_name="정책 상품 A",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="FAQ 보강 필요",
                        priority_score=88.0,
                        confidence_score=0.93,
                        data_quality_score=0.97,
                        recommended_action_primary="FAQ 보강",
                        evidence_json='{"policy_pack_id":"AI_OPS_BRAND_A"}',
                    ),
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-POL-2",
                        product_name="정책 상품 B",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="구매 전 문의 누적",
                        priority_score=72.0,
                        confidence_score=0.84,
                        data_quality_score=0.91,
                        recommended_action_primary="상세페이지 보강",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-POL-3",
                        product_name="정책 상품 C",
                        policy_type="AD_GROWTH",
                        top_issue="확장 가능",
                        priority_score=66.0,
                        confidence_score=0.81,
                        data_quality_score=0.88,
                        recommended_action_primary="광고 확대 테스트",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                ]
            )
            main._save_ai_settings(
                db,
                {
                    "format_version": "v2",
                    "common_rules": "공통 운영 규칙",
                    "rule_packs": [
                        {"id": "A-1", "title": "A-1 기본 정책"},
                        {"id": "AI_OPS", "title": "운영 정책팩"},
                    ],
                },
            )
            db.commit()

        resp = self.client.get("/ai/ops/policies")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("total_skus"), 3)
        self.assertEqual(body.get("summary", {}).get("policy_count"), 2)
        self.assertEqual(body.get("summary", {}).get("rule_pack_count"), 2)
        self.assertEqual(body.get("summary", {}).get("format_version"), "v2")
        first_item = (body.get("items") or [None])[0]
        self.assertIsNotNone(first_item)
        self.assertEqual(first_item.get("policy_type"), "FAQ_CONTENT_IMPROVEMENT")
        self.assertEqual(first_item.get("sku_count"), 2)
        self.assertEqual(first_item.get("top_product_name"), "정책 상품 A")
        self.assertEqual(first_item.get("top_policy_pack_id"), "AI_OPS_BRAND_A")

    def test_ai_ops_policies_returns_learning_summary_by_policy_pack(self) -> None:
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 11),
                        sku_id="SKU-LEARN-1",
                        product_name="학습 상품 1",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="FAQ 보강 필요",
                        priority_score=80.0,
                        confidence_score=0.92,
                        data_quality_score=0.96,
                        organic_strength_score=60.0,
                        sales_growth_score=40.0,
                        review_risk_score=72.0,
                        qna_barrier_score=78.0,
                        recommended_action_primary="FAQ 보강",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 18),
                        sku_id="SKU-LEARN-1",
                        product_name="학습 상품 1",
                        policy_type="AD_GROWTH",
                        top_issue="확장 가능",
                        priority_score=62.0,
                        confidence_score=0.93,
                        data_quality_score=0.97,
                        organic_strength_score=80.0,
                        sales_growth_score=68.0,
                        review_risk_score=40.0,
                        qna_barrier_score=30.0,
                        recommended_action_primary="광고 확대 테스트",
                        evidence_json='{"policy_pack_id":"AI_OPS_BRAND_A"}',
                    ),
                    ActionQueueItem(
                        queue_id="queue-learn-1",
                        source_scope="ai-ops-policy-compare",
                        entity_type="sku",
                        entity_id="SKU-LEARN-1",
                        action_type="QUEUE_POLICY_COMPARE_ACTION",
                        payload_json='{"title":"[브랜드A 정책팩] 광고 확대 테스트","target_policy_pack_id":"AI_OPS_BRAND_A","target_policy_pack_title":"브랜드A 정책팩"}',
                        priority="P1",
                        status="APPROVED",
                        reviewer="ops_manager",
                        review_note="브랜드A 정책 실험",
                        created_at=datetime(2026, 4, 11, 9, 0, 0),
                        updated_at=datetime(2026, 4, 11, 9, 30, 0),
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/policies")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        learning_items = body.get("learning_items") or []
        self.assertEqual(len(learning_items), 1)
        first_learning = learning_items[0]
        self.assertEqual(first_learning.get("policy_pack_id"), "AI_OPS_BRAND_A")
        self.assertEqual(first_learning.get("policy_pack_title"), "브랜드A 정책팩")
        self.assertEqual(first_learning.get("verified_count"), 1)
        self.assertEqual(first_learning.get("improved_count"), 1)
        self.assertEqual(first_learning.get("improvement_rate"), 1.0)
        self.assertGreater(float(first_learning.get("avg_sales_growth_delta") or 0.0), 0.0)

    def test_ai_ops_products_filters_by_policy_pack_id(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-FILTER-1",
                        product_name="브랜드 팩 상품",
                        policy_type="AD_GROWTH",
                        top_issue="확장 가능",
                        priority_score=81.0,
                        confidence_score=0.88,
                        data_quality_score=0.95,
                        recommended_action_primary="광고 확대",
                        evidence_json='{"policy_pack_id":"AI_OPS_BRAND_A"}',
                    ),
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-FILTER-2",
                        product_name="공통 팩 상품",
                        policy_type="AD_DEFENSE",
                        top_issue="방어 필요",
                        priority_score=62.0,
                        confidence_score=0.8,
                        data_quality_score=0.9,
                        recommended_action_primary="방어 광고",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/products", params={"policy_pack_id": "AI_OPS_BRAND_A"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("total_items"), 1)
        self.assertIn("AI_OPS_BRAND_A", body.get("summary", {}).get("policy_pack_ids") or [])
        item = (body.get("items") or [None])[0]
        self.assertIsNotNone(item)
        self.assertEqual(item.get("sku_id"), "SKU-FILTER-1")
        self.assertEqual(item.get("policy_pack_id"), "AI_OPS_BRAND_A")

    def test_ai_ops_logs_filters_by_policy_pack_id(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-LOG-FILTER-1",
                        product_name="브랜드 로그 상품",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="FAQ 보강 필요",
                        priority_score=88.0,
                        confidence_score=0.93,
                        data_quality_score=0.97,
                        recommended_action_primary="FAQ 보강",
                        evidence_json='{"policy_pack_id":"AI_OPS_BRAND_A"}',
                    ),
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-LOG-FILTER-2",
                        product_name="공통 로그 상품",
                        policy_type="AD_DEFENSE",
                        top_issue="방어 필요",
                        priority_score=71.0,
                        confidence_score=0.82,
                        data_quality_score=0.9,
                        recommended_action_primary="방어 광고",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                ]
            )
            db.add_all(
                [
                    AiDecisionLog(
                        log_id="log-filter-1",
                        analysis_type="AI_OPS_PRODUCT_HEALTH",
                        entity_type="SKU",
                        entity_id="SKU-LOG-FILTER-1",
                        inputs_hash="hash-filter-1",
                        inputs_json='{"ai_ops_rule_pack":{"rule_id":"AI_OPS_BRAND_A"}}',
                        decision="FAQ_CONTENT_IMPROVEMENT",
                        rules_triggered='["qna_barrier_high"]',
                        confidence=0.93,
                        recommended_actions='["FAQ 보강"]',
                        analysis_text="브랜드 정책팩 판단",
                    ),
                    AiDecisionLog(
                        log_id="log-filter-2",
                        analysis_type="AI_OPS_PRODUCT_HEALTH",
                        entity_type="SKU",
                        entity_id="SKU-LOG-FILTER-2",
                        inputs_hash="hash-filter-2",
                        inputs_json='{"ai_ops_rule_pack":{"rule_id":"AI_OPS"}}',
                        decision="AD_DEFENSE",
                        rules_triggered='["organic_strength_low"]',
                        confidence=0.82,
                        recommended_actions='["방어 광고"]',
                        analysis_text="공통 정책팩 판단",
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/logs", params={"policy_pack_id": "AI_OPS_BRAND_A"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("total_items"), 1)
        self.assertIn("AI_OPS_BRAND_A", body.get("summary", {}).get("policy_pack_ids") or [])
        item = (body.get("items") or [None])[0]
        self.assertIsNotNone(item)
        self.assertEqual(item.get("sku_id"), "SKU-LOG-FILTER-1")
        self.assertEqual(item.get("policy_pack_id"), "AI_OPS_BRAND_A")

    def test_ai_ops_policy_compare_returns_cross_pack_simulation_for_selected_sku(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-COMPARE-1",
                        product_name="비교 대상 상품",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="FAQ 보강 필요",
                        priority_score=84.0,
                        confidence_score=0.92,
                        data_quality_score=0.96,
                        organic_strength_score=92.0,
                        sales_growth_score=65.0,
                        review_risk_score=20.0,
                        qna_barrier_score=82.0,
                        recommended_action_primary="FAQ 보강",
                        evidence_json='{"policy_pack_id":"AI_OPS","mall_name":"브랜드A몰","qna_action_hint":"FAQ 보강"}',
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 4),
                        sku_id="SKU-LEARNING-1",
                        product_name="학습 검증 상품",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="FAQ 보강 필요",
                        priority_score=58.0,
                        confidence_score=0.9,
                        data_quality_score=0.95,
                        organic_strength_score=78.0,
                        sales_growth_score=44.0,
                        review_risk_score=24.0,
                        qna_barrier_score=82.0,
                        recommended_action_primary="FAQ 보강",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-LEARNING-1",
                        product_name="학습 검증 상품",
                        policy_type="AD_GROWTH",
                        top_issue="확장 가능",
                        priority_score=60.0,
                        confidence_score=0.93,
                        data_quality_score=0.97,
                        organic_strength_score=82.0,
                        sales_growth_score=72.0,
                        review_risk_score=38.0,
                        qna_barrier_score=30.0,
                        recommended_action_primary="광고 확대 테스트",
                        evidence_json='{"policy_pack_id":"AI_OPS_BRAND_A"}',
                    ),
                    ActionQueueItem(
                        queue_id="queue-compare-rank-1",
                        source_scope="ai-ops-policy-compare",
                        entity_type="sku",
                        entity_id="SKU-LEARNING-1",
                        action_type="QUEUE_POLICY_COMPARE_ACTION",
                        payload_json='{"title":"[브랜드A 확장 정책팩] 광고 확대 테스트","target_policy_pack_id":"AI_OPS_BRAND_A","target_policy_pack_title":"브랜드A 확장 정책팩"}',
                        priority="P1",
                        status="APPROVED",
                        reviewer="ops_manager",
                        review_note="브랜드 정책 적용",
                        created_at=datetime(2026, 4, 4, 9, 0, 0),
                        updated_at=datetime(2026, 4, 4, 9, 30, 0),
                    ),
                    ActionQueueItem(
                        queue_id="queue-compare-ops-learning-1",
                        source_scope="ai-ops-ads-budget",
                        entity_type="ad_keyword",
                        entity_id="성장 캠페인::확장 그룹::확장 키워드",
                        action_type="QUEUE_AD_BUDGET_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[광고 예산] 확장 키워드",
                                "campaign_name": "성장 캠페인",
                                "adgroup_name": "확장 그룹",
                                "keyword": "확장 키워드",
                                "action_kind": "BUDGET_INCREASE",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        reviewer="ops_manager",
                        review_note="광고 증액 학습",
                        created_at=datetime(2026, 4, 4, 9, 0, 0),
                        updated_at=datetime(2026, 4, 4, 9, 0, 0),
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=900,
                        clicks=18,
                        cost=12000,
                        conversions=4,
                        revenue=60000,
                        purchase_conversions=2,
                        purchase_revenue=60000,
                        ctr=2.0,
                        cpc=666.0,
                        cvr=22.2,
                        roas=500.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target_date,
                        campaign_name="성장 캠페인",
                        adgroup_name="확장 그룹",
                        keyword="확장 키워드",
                        device="ALL",
                        impressions=1100,
                        clicks=24,
                        cost=18000,
                        conversions=6,
                        revenue=90000,
                        purchase_conversions=4,
                        purchase_revenue=90000,
                        ctr=2.2,
                        cpc=750.0,
                        cvr=25.0,
                        roas=500.0,
                        source="searchad_api",
                    ),
                ]
            )
            main._save_ai_settings(
                db,
                {
                    "format_version": "v2",
                    "common_rules": "정책팩 비교 테스트",
                    "rule_packs": [
                        {
                            "id": "AI_OPS",
                            "enabled": True,
                            "title": "공통 정책팩",
                            "ai_ops": {
                                "scope": {"mall_names": []},
                                "thresholds": {
                                    "qna_barrier_high": 70,
                                    "review_risk_high": 65,
                                },
                            },
                        },
                        {
                            "id": "AI_OPS_BRAND_A",
                            "enabled": True,
                            "title": "브랜드A 확장 정책팩",
                            "ai_ops": {
                                "scope": {"mall_names": ["브랜드A몰"]},
                                "thresholds": {
                                    "qna_barrier_high": 95,
                                    "review_risk_high": 90,
                                    "growth": {
                                        "organic_strength_min": 70,
                                        "sales_growth_min": 60,
                                        "review_risk_max": 50,
                                        "qna_barrier_max": 90,
                                    },
                                    "defense": {"organic_strength_max": 40},
                                },
                            },
                        },
                    ],
                },
            )
            db.commit()

        resp = self.client.get("/ai/ops/policies/compare", params={"sku_id": "SKU-COMPARE-1"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("summary", {}).get("selected_sku_id"), "SKU-COMPARE-1")
        self.assertEqual(body.get("summary", {}).get("current_policy_pack_id"), "AI_OPS")
        self.assertEqual(body.get("summary", {}).get("recommended_policy_pack_id"), "AI_OPS_BRAND_A")
        self.assertGreaterEqual(len(body.get("candidates") or []), 1)
        items = body.get("items") or []
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].get("policy_pack_id"), "AI_OPS_BRAND_A")
        common_item = next((item for item in items if item.get("policy_pack_id") == "AI_OPS"), None)
        brand_item = next((item for item in items if item.get("policy_pack_id") == "AI_OPS_BRAND_A"), None)
        self.assertIsNotNone(common_item)
        self.assertIsNotNone(brand_item)
        self.assertEqual(common_item.get("policy_type"), "FAQ_CONTENT_IMPROVEMENT")
        self.assertEqual(brand_item.get("policy_type"), "AD_GROWTH")
        self.assertTrue(bool(brand_item.get("recommended")))
        self.assertGreater(float(brand_item.get("recommendation_score") or 0.0), float(common_item.get("recommendation_score") or 0.0))
        self.assertIn("개선율", str(brand_item.get("recommendation_reason") or ""))
        self.assertIn("운영 학습", str(brand_item.get("recommendation_reason") or ""))
        self.assertEqual((brand_item.get("operation_learning_summary") or {}).get("verified_count"), 1)

    def test_ai_ops_policy_compare_action_creates_queue_item_with_diff_payload(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                DecisionProductHealthDaily(
                    date=target_date,
                    sku_id="SKU-COMPARE-QUEUE-1",
                    product_name="비교 큐 상품",
                    policy_type="FAQ_CONTENT_IMPROVEMENT",
                    top_issue="FAQ 보강 필요",
                    priority_score=84.0,
                    confidence_score=0.92,
                    data_quality_score=0.96,
                    organic_strength_score=92.0,
                    sales_growth_score=65.0,
                    review_risk_score=20.0,
                    qna_barrier_score=82.0,
                    recommended_action_primary="FAQ 보강",
                    evidence_json='{"policy_pack_id":"AI_OPS","mall_name":"브랜드A몰","qna_action_hint":"FAQ 보강"}',
                )
            )
            main._save_ai_settings(
                db,
                {
                    "format_version": "v2",
                    "common_rules": "정책팩 비교 큐 테스트",
                    "rule_packs": [
                        {
                            "id": "AI_OPS",
                            "enabled": True,
                            "title": "공통 정책팩",
                            "ai_ops": {
                                "scope": {"mall_names": []},
                                "thresholds": {
                                    "qna_barrier_high": 70,
                                    "review_risk_high": 65,
                                },
                            },
                        },
                        {
                            "id": "AI_OPS_BRAND_A",
                            "enabled": True,
                            "title": "브랜드A 확장 정책팩",
                            "ai_ops": {
                                "scope": {"mall_names": ["브랜드A몰"]},
                                "thresholds": {
                                    "qna_barrier_high": 95,
                                    "review_risk_high": 90,
                                    "growth": {
                                        "organic_strength_min": 70,
                                        "sales_growth_min": 60,
                                        "review_risk_max": 50,
                                        "qna_barrier_max": 90,
                                    },
                                    "defense": {"organic_strength_max": 40},
                                },
                            },
                        },
                    ],
                },
            )
            db.commit()

        resp = self.client.post(
            "/ai/ops/policies/compare/actions",
            json={
                "sku_id": "SKU-COMPARE-QUEUE-1",
                "target_policy_pack_id": "AI_OPS_BRAND_A",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body.get("ok"))
        item = body.get("item") or {}
        self.assertEqual(item.get("entity_id"), "SKU-COMPARE-QUEUE-1")
        self.assertEqual(item.get("action_type"), "QUEUE_POLICY_COMPARE_ACTION")
        self.assertEqual(item.get("priority"), "P1")
        self.assertEqual(item.get("approval_recommendation"), "APPROVE")
        payload = item.get("payload") or {}
        self.assertEqual(payload.get("target_policy_pack_id"), "AI_OPS_BRAND_A")
        self.assertEqual(payload.get("current_policy_pack_id"), "AI_OPS")
        self.assertEqual(payload.get("target_policy_type"), "AD_GROWTH")
        self.assertEqual(payload.get("current_policy_type"), "FAQ_CONTENT_IMPROVEMENT")
        self.assertEqual(payload.get("target_recommended_action"), "광고 확대 테스트")
        self.assertGreater(float(payload.get("target_recommendation_score") or 0.0), 0.0)
        self.assertIn("approval_recommendation", payload)
        self.assertEqual(payload.get("approval_recommendation"), "APPROVE")
        self.assertIn("approval_recommendation_reason", payload)

    def test_ai_ops_reviews_and_qna_endpoints_reuse_health_and_domain_assets(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-REV-1",
                        product_url="https://smartstore.naver.com/test/products/501",
                        product_id_catalog=501,
                        product_name="리뷰 위험 상품",
                        policy_type="VOC_IMPROVEMENT_PRIORITY",
                        top_issue="배송 지연 불만이 반복됩니다.",
                        priority_score=88.0,
                        confidence_score=0.91,
                        data_quality_score=0.95,
                        review_risk_score=81.0,
                        qna_barrier_score=18.0,
                        recommended_action_primary="답글 정책 재정비",
                        evidence_json=json.dumps(
                            {
                                "policy_pack_id": "AI_OPS",
                                "review": {
                                    "rating_avg": 3.2,
                                    "rating_count": 20,
                                    "low_rating_count": 7,
                                    "low_rating_ratio": 0.35,
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ),
                    DecisionProductHealthDaily(
                        date=target_date,
                        sku_id="SKU-QNA-1",
                        product_url="https://smartstore.naver.com/test/products/601",
                        product_id_catalog=601,
                        product_name="문의 장벽 상품",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        top_issue="구매 전 성분 문의가 반복됩니다.",
                        priority_score=84.0,
                        confidence_score=0.89,
                        data_quality_score=0.93,
                        review_risk_score=24.0,
                        qna_barrier_score=79.0,
                        recommended_action_primary="FAQ 등록",
                        evidence_json=json.dumps(
                            {
                                "policy_pack_id": "AI_OPS",
                                "qna": {
                                    "count": 3,
                                    "avg_conversion_impact_score": 0.76,
                                    "faq_candidate_count": 2,
                                    "quality_issue_count": 1,
                                    "complaint_count": 0,
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ),
                    AiDecisionLog(
                        log_id="log-review-qual-1",
                        analysis_type="AI_OPS_PRODUCT_HEALTH",
                        entity_type="SKU",
                        entity_id="SKU-REV-1",
                        inputs_hash="hash-review-qual-1",
                        inputs_json="{}",
                        decision="VOC_IMPROVEMENT_PRIORITY",
                        rules_triggered=json.dumps(["배송", "포장"], ensure_ascii=False),
                        confidence=0.91,
                        recommended_actions=json.dumps(["답글 정책 재정비", "패키징 개선"], ensure_ascii=False),
                        analysis_text="배송 지연과 포장 이슈가 반복됩니다.",
                    ),
                    AiDecisionLog(
                        log_id="log-qna-qual-1",
                        analysis_type="AI_OPS_PRODUCT_HEALTH",
                        entity_type="SKU",
                        entity_id="SKU-QNA-1",
                        inputs_hash="hash-qna-qual-1",
                        inputs_json="{}",
                        decision="FAQ_CONTENT_IMPROVEMENT",
                        rules_triggered=json.dumps(["faq_gap", "ingredient_question"], ensure_ascii=False),
                        confidence=0.89,
                        recommended_actions=json.dumps(["FAQ 등록", "상세페이지 성분 보강"], ensure_ascii=False),
                        analysis_text="성분/사용법 문의가 구매 직전에 반복됩니다.",
                    ),
                    CommerceQnaRaw(
                        qna_key="qna-1",
                        qna_kind="product",
                        external_inquiry_id="external-qna-1",
                        inquiry_text="전성분이 어떻게 되나요?",
                        inquiry_registered_at=datetime(2026, 4, 10, 9, 0, 0),
                        answered=False,
                        product_no="601",
                        product_name="문의 장벽 상품",
                    ),
                    CommerceQnaRaw(
                        qna_key="qna-2",
                        qna_kind="product",
                        external_inquiry_id="external-qna-2",
                        inquiry_text="민감성 피부도 사용할 수 있나요?",
                        inquiry_registered_at=datetime(2026, 4, 10, 10, 0, 0),
                        answered=False,
                        product_no="601",
                        product_name="문의 장벽 상품",
                    ),
                    CommerceQnaRaw(
                        qna_key="qna-3",
                        qna_kind="product",
                        external_inquiry_id="external-qna-3",
                        inquiry_text="배송은 얼마나 걸리나요?",
                        inquiry_registered_at=datetime(2026, 4, 10, 11, 0, 0),
                        answered=True,
                        product_no="601",
                        product_name="문의 장벽 상품",
                    ),
                    CommerceQnaAnalysis(
                        qna_key="qna-1",
                        qna_kind="product",
                        inquiry_type="성분",
                        inquiry_subtype="전성분",
                        purchase_stage="PRE_PURCHASE",
                        conversion_impact_score=0.82,
                        faq_candidate_flag=True,
                        quality_issue_flag=False,
                        complaint_flag=False,
                        primary_need="성분 확인",
                        summary_text="구매 전 성분 문의",
                        recommended_action="FAQ 등록",
                        confidence_score=0.9,
                    ),
                    CommerceQnaAnalysis(
                        qna_key="qna-2",
                        qna_kind="product",
                        inquiry_type="사용법",
                        inquiry_subtype="민감성 피부",
                        purchase_stage="PRE_PURCHASE",
                        conversion_impact_score=0.74,
                        faq_candidate_flag=True,
                        quality_issue_flag=True,
                        complaint_flag=False,
                        primary_need="사용 가능 여부",
                        summary_text="구매 전 사용법 문의",
                        recommended_action="상세페이지 성분 보강",
                        confidence_score=0.86,
                    ),
                    CommerceQnaAnalysis(
                        qna_key="qna-3",
                        qna_kind="product",
                        inquiry_type="배송",
                        inquiry_subtype="도착일",
                        purchase_stage="POST_PURCHASE",
                        conversion_impact_score=0.21,
                        faq_candidate_flag=False,
                        quality_issue_flag=False,
                        complaint_flag=False,
                        primary_need="배송 확인",
                        summary_text="배송 문의",
                        recommended_action="배송 템플릿 정비",
                        confidence_score=0.75,
                    ),
                ]
            )
            db.commit()

        review_summary = self.client.get("/ai/ops/reviews/summary")
        self.assertEqual(review_summary.status_code, 200, msg=review_summary.text)
        review_summary_body = review_summary.json()
        self.assertTrue(review_summary_body.get("ok"))
        self.assertEqual(review_summary_body.get("summary", {}).get("total_products"), 1)
        self.assertEqual(review_summary_body.get("summary", {}).get("urgent_count"), 1)
        self.assertEqual(review_summary_body.get("summary", {}).get("avg_negative_ratio"), 0.35)

        review_products = self.client.get("/ai/ops/reviews/products")
        self.assertEqual(review_products.status_code, 200, msg=review_products.text)
        review_product_body = review_products.json()
        review_item = (review_product_body.get("items") or [None])[0]
        self.assertIsNotNone(review_item)
        self.assertEqual(review_item.get("sku_id"), "SKU-REV-1")
        self.assertEqual(review_item.get("action_bucket"), "VOC_IMPROVEMENT")
        self.assertEqual(review_item.get("negative_review_count"), 7)
        self.assertIn("배송", review_item.get("risk_topics") or [])

        review_actions = self.client.get("/ai/ops/reviews/actions")
        self.assertEqual(review_actions.status_code, 200, msg=review_actions.text)
        review_action_titles = [str(item.get("title") or "") for item in (review_actions.json().get("actions") or [])]
        self.assertIn("답글 정책 재정비", review_action_titles)

        qna_summary = self.client.get("/ai/ops/qna/summary")
        self.assertEqual(qna_summary.status_code, 200, msg=qna_summary.text)
        qna_summary_body = qna_summary.json()
        self.assertTrue(qna_summary_body.get("ok"))
        self.assertEqual(qna_summary_body.get("summary", {}).get("total_products"), 1)
        self.assertEqual(qna_summary_body.get("summary", {}).get("barrier_count"), 1)
        self.assertEqual(qna_summary_body.get("summary", {}).get("faq_gap_count"), 1)
        self.assertAlmostEqual(float(qna_summary_body.get("summary", {}).get("prepurchase_ratio") or 0.0), 2 / 3, places=4)

        qna_products = self.client.get("/ai/ops/qna/products")
        self.assertEqual(qna_products.status_code, 200, msg=qna_products.text)
        qna_product_body = qna_products.json()
        qna_item = (qna_product_body.get("items") or [None])[0]
        self.assertIsNotNone(qna_item)
        self.assertEqual(qna_item.get("sku_id"), "SKU-QNA-1")
        self.assertEqual(qna_item.get("action_bucket"), "FAQ_CONTENT_IMPROVEMENT")
        self.assertEqual(qna_item.get("faq_gap_count"), 2)
        self.assertIn("성분", qna_item.get("issue_tags") or [])

        qna_actions = self.client.get("/ai/ops/qna/actions")
        self.assertEqual(qna_actions.status_code, 200, msg=qna_actions.text)
        qna_action_titles = [str(item.get("title") or "") for item in (qna_actions.json().get("actions") or [])]
        self.assertIn("FAQ 등록", qna_action_titles)

    def test_ai_ops_action_schema_audit_and_freshness_are_normalized(self) -> None:
        target_date = date(2026, 4, 11)
        with SessionLocal() as db:
            db.add(
                DecisionProductHealthDaily(
                    date=target_date,
                    sku_id="SKU-AUDIT-1",
                    product_url="https://smartstore.naver.com/test/products/701",
                    product_id_catalog=701,
                    product_name="감사 상품",
                    policy_type="VOC_IMPROVEMENT_PRIORITY",
                    top_issue="리뷰 위험",
                    priority_score=75.0,
                    confidence_score=0.84,
                    data_quality_score=0.9,
                    review_risk_score=70.0,
                    recommended_action_primary="VOC 개선",
                    evidence_json='{"policy_pack_id":"AI_OPS"}',
                )
            )
            db.add(
                NaverAdKeywordDaily(
                    date=target_date,
                    campaign_name="감사 캠페인",
                    adgroup_name="감사 그룹",
                    keyword="감사 키워드",
                    device="ALL",
                    impressions=1000,
                    clicks=20,
                    cost=10000,
                    conversions=2,
                    revenue=50000,
                    purchase_conversions=2,
                    purchase_revenue=50000,
                    ctr=2.0,
                    cpc=500.0,
                    cvr=10.0,
                    roas=500.0,
                    source="searchad_api",
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=target_date,
                    product_id=701,
                    product_name="감사 상품",
                    amount=120000,
                    refund_amount=5000,
                    order_count=5,
                    source="commerce_orders",
                )
            )
            db.commit()

        create_resp = self.client.post(
            "/ai/ops/actions",
            headers={
                "X-AI-Ops-Reviewer": "ops.lead",
                "X-AI-Ops-Reviewer-Role": "manager",
            },
            json={
                "source_scope": "ai-ops-reviews",
                "entity_type": "sku",
                "entity_id": "SKU-AUDIT-1",
                "action_type": "QUEUE_PRIMARY_ACTION",
                "priority": "P1",
                "payload": {
                    "title": "VOC 개선",
                    "product_name": "감사 상품",
                    "action_bucket": "VOC_IMPROVEMENT",
                    "top_issue": "리뷰 위험",
                },
            },
        )
        self.assertEqual(create_resp.status_code, 200, msg=create_resp.text)
        create_body = create_resp.json()
        item = create_body.get("item") or {}
        self.assertEqual(item.get("action_type"), "QUEUE_PRIMARY_ACTION")
        payload = item.get("payload") or {}
        self.assertEqual(payload.get("schema_version"), "ai_ops_action_v1")
        self.assertEqual(payload.get("source_scope"), "ai-ops-reviews")
        self.assertEqual(payload.get("source_screen"), "reviews")
        self.assertEqual((payload.get("target_identifier") or {}).get("sku_id"), "SKU-AUDIT-1")
        self.assertEqual((payload.get("evidence_ref") or {}).get("entity_id"), "SKU-AUDIT-1")
        self.assertEqual((payload.get("audit_trail") or [])[0].get("actor_role"), "manager")

        queue_id = str(item.get("queue_id") or "")
        status_resp = self.client.post(
            f"/ai/ops/actions/{queue_id}/status",
            headers={
                "X-AI-Ops-Reviewer": "ops.reviewer",
                "X-AI-Ops-Reviewer-Role": "director",
            },
            json={
                "status": "APPROVED",
                "review_note": "구조 검토 완료",
            },
        )
        self.assertEqual(status_resp.status_code, 200, msg=status_resp.text)
        status_item = status_resp.json().get("item") or {}
        audit_trail = (status_item.get("payload") or {}).get("audit_trail") or []
        self.assertEqual(status_item.get("status"), "APPROVED")
        self.assertEqual(status_item.get("reviewer"), "ops.reviewer")
        self.assertEqual(audit_trail[-1].get("event"), "STATUS_CHANGED")
        self.assertEqual(audit_trail[-1].get("actor_role"), "director")

        home_resp = self.client.get("/ai/ops/home")
        self.assertEqual(home_resp.status_code, 200, msg=home_resp.text)
        freshness = home_resp.json().get("freshness") or {}
        self.assertEqual(freshness.get("health_as_of"), "2026-04-11")
        self.assertEqual(freshness.get("ads_as_of"), "2026-04-11")
        self.assertEqual(freshness.get("sales_as_of"), "2026-04-11")

    def test_ai_ops_verification_expands_to_primary_qna_and_ad_keyword_actions(self) -> None:
        with SessionLocal() as db:
            db.add_all(
                [
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 4),
                        sku_id="SKU-VOC-1",
                        product_name="VOC 상품",
                        policy_type="VOC_IMPROVEMENT_PRIORITY",
                        priority_score=71.0,
                        confidence_score=0.84,
                        data_quality_score=0.9,
                        sales_growth_score=30.0,
                        organic_strength_score=55.0,
                        review_risk_score=78.0,
                        qna_barrier_score=22.0,
                        recommended_action_primary="VOC 개선",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 11),
                        sku_id="SKU-VOC-1",
                        product_name="VOC 상품",
                        policy_type="AD_GROWTH",
                        priority_score=65.0,
                        confidence_score=0.9,
                        data_quality_score=0.92,
                        sales_growth_score=42.0,
                        organic_strength_score=62.0,
                        review_risk_score=40.0,
                        qna_barrier_score=18.0,
                        recommended_action_primary="광고 확대",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 4),
                        sku_id="SKU-QNA-V-1",
                        product_name="QNA 상품",
                        policy_type="FAQ_CONTENT_IMPROVEMENT",
                        priority_score=82.0,
                        confidence_score=0.88,
                        data_quality_score=0.91,
                        sales_growth_score=24.0,
                        organic_strength_score=49.0,
                        review_risk_score=28.0,
                        qna_barrier_score=76.0,
                        recommended_action_primary="FAQ 등록",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                    DecisionProductHealthDaily(
                        date=date(2026, 4, 11),
                        sku_id="SKU-QNA-V-1",
                        product_name="QNA 상품",
                        policy_type="SALES_FOCUS",
                        priority_score=58.0,
                        confidence_score=0.89,
                        data_quality_score=0.93,
                        sales_growth_score=38.0,
                        organic_strength_score=56.0,
                        review_risk_score=24.0,
                        qna_barrier_score=33.0,
                        recommended_action_primary="판매 확대",
                        evidence_json='{"policy_pack_id":"AI_OPS"}',
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 4),
                        campaign_name="검증 캠페인",
                        adgroup_name="검증 그룹",
                        keyword="검증 키워드",
                        device="ALL",
                        impressions=1000,
                        clicks=40,
                        cost=20000,
                        conversions=2,
                        revenue=60000,
                        purchase_conversions=2,
                        purchase_revenue=60000,
                        ctr=4.0,
                        cpc=500.0,
                        cvr=5.0,
                        roas=300.0,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=date(2026, 4, 11),
                        campaign_name="검증 캠페인",
                        adgroup_name="검증 그룹",
                        keyword="검증 키워드",
                        device="ALL",
                        impressions=1100,
                        clicks=48,
                        cost=18000,
                        conversions=4,
                        revenue=90000,
                        purchase_conversions=4,
                        purchase_revenue=90000,
                        ctr=4.36,
                        cpc=375.0,
                        cvr=8.3,
                        roas=500.0,
                        source="searchad_api",
                    ),
                    ActionQueueItem(
                        queue_id="queue-voc-verification",
                        source_scope="ai-ops-reviews",
                        entity_type="sku",
                        entity_id="SKU-VOC-1",
                        action_type="QUEUE_PRIMARY_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "VOC 개선",
                                "action_bucket": "VOC_IMPROVEMENT",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 9, 0, 0),
                        updated_at=datetime(2026, 4, 4, 9, 0, 0),
                    ),
                    ActionQueueItem(
                        queue_id="queue-qna-verification",
                        source_scope="ai-ops-qna",
                        entity_type="sku",
                        entity_id="SKU-QNA-V-1",
                        action_type="QUEUE_PRIMARY_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "FAQ 등록",
                                "action_bucket": "FAQ_CONTENT_IMPROVEMENT",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 9, 0, 0),
                        updated_at=datetime(2026, 4, 4, 9, 0, 0),
                    ),
                    ActionQueueItem(
                        queue_id="queue-ad-keyword-verification",
                        source_scope="ai-ops-ads",
                        entity_type="ad_keyword",
                        entity_id="검증 캠페인::검증 그룹::검증 키워드",
                        action_type="QUEUE_AD_KEYWORD_ACTION",
                        payload_json=json.dumps(
                            {
                                "title": "[광고] 검증 키워드",
                                "campaign_name": "검증 캠페인",
                                "adgroup_name": "검증 그룹",
                                "keyword": "검증 키워드",
                                "action_kind": "CANNIBALIZATION_DECREASE",
                                "action_bucket": "BUDGET_DECREASE",
                            },
                            ensure_ascii=False,
                        ),
                        priority="P1",
                        status="APPROVED",
                        created_at=datetime(2026, 4, 4, 9, 0, 0),
                        updated_at=datetime(2026, 4, 4, 9, 0, 0),
                    ),
                ]
            )
            db.commit()

        resp = self.client.get("/ai/ops/actions", params={"limit": 10})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        items = {
            str(item.get("queue_id") or ""): item
            for item in (resp.json().get("items") or [])
        }
        self.assertEqual((items.get("queue-voc-verification") or {}).get("verification", {}).get("outcome"), "IMPROVED")
        self.assertLess(
            float((((items.get("queue-voc-verification") or {}).get("verification") or {}).get("metrics") or {}).get("review_risk_delta") or 0.0),
            0.0,
        )
        self.assertEqual((items.get("queue-qna-verification") or {}).get("verification", {}).get("outcome"), "IMPROVED")
        self.assertLess(
            float((((items.get("queue-qna-verification") or {}).get("verification") or {}).get("metrics") or {}).get("qna_barrier_delta") or 0.0),
            0.0,
        )
        self.assertEqual((items.get("queue-ad-keyword-verification") or {}).get("verification", {}).get("outcome"), "IMPROVED")
        self.assertGreater(
            float((((items.get("queue-ad-keyword-verification") or {}).get("verification") or {}).get("metrics") or {}).get("ad_roas_delta") or 0.0),
            0.0,
        )

    def test_ai_ops_execution_worker_processes_approved_queue_items_idempotently(self) -> None:
        create_resp = self.client.post(
            "/ai/ops/actions",
            json={
                "source_scope": "ai-ops-products",
                "entity_type": "sku",
                "entity_id": "SKU-EXEC-1",
                "action_type": "QUEUE_PRIMARY_ACTION",
                "priority": "P1",
                "payload": {
                    "title": "운영 실행",
                    "product_name": "실행 상품",
                    "action_bucket": "VOC_IMPROVEMENT",
                },
            },
        )
        self.assertEqual(create_resp.status_code, 200, msg=create_resp.text)
        queue_id = str((create_resp.json().get("item") or {}).get("queue_id") or "")
        approve_resp = self.client.post(
            f"/ai/ops/actions/{queue_id}/status",
            json={"status": "APPROVED", "reviewer": "ops.manager", "review_note": "실행 승인"},
        )
        self.assertEqual(approve_resp.status_code, 200, msg=approve_resp.text)

        run_resp = self.client.post(
            "/ai/ops/execution/run",
            json={"queue_ids": [queue_id], "dry_run": False, "actor": "ops.worker", "actor_role": "executor"},
        )
        self.assertEqual(run_resp.status_code, 200, msg=run_resp.text)
        run_body = run_resp.json()
        self.assertTrue(run_body.get("ok"))
        self.assertEqual(run_body.get("summary", {}).get("processed_count"), 1)
        executed_item = ((run_body.get("items") or [None])[0] or {}).get("item") or {}
        self.assertEqual(executed_item.get("status"), "DONE")
        execution = (executed_item.get("payload") or {}).get("execution") or {}
        self.assertEqual((execution.get("last_result") or {}).get("status"), "DONE")
        self.assertEqual((execution.get("last_result") or {}).get("actor"), "ops.worker")

        rerun_resp = self.client.post(
            "/ai/ops/execution/run",
            json={"queue_ids": [queue_id], "dry_run": False, "actor": "ops.worker", "actor_role": "executor"},
        )
        self.assertEqual(rerun_resp.status_code, 200, msg=rerun_resp.text)
        rerun_body = rerun_resp.json()
        self.assertEqual(rerun_body.get("summary", {}).get("processed_count"), 0)
        self.assertEqual(rerun_body.get("summary", {}).get("skipped_count"), 1)


if __name__ == "__main__":
    unittest.main()
