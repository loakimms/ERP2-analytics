import unittest
from datetime import date

from fastapi.testclient import TestClient

import main
from db import (
    AppSetting,
    NaverProductReviewDaily,
    NaverReviewRaw,
    SessionLocal,
    TrackedProductKeyword,
    TrackedProductMeta,
    TrackedProductPageDaily,
    init_db,
)
from settings_store import save_api_settings


class ReviewsSummaryTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            db.query(AppSetting).filter(AppSetting.key.like("api:%")).delete(synchronize_session=False)
            db.query(NaverProductReviewDaily).delete(synchronize_session=False)
            db.query(NaverReviewRaw).delete(synchronize_session=False)
            db.query(TrackedProductKeyword).delete(synchronize_session=False)
            db.query(TrackedProductMeta).delete(synchronize_session=False)
            db.query(TrackedProductPageDaily).delete(synchronize_session=False)
            db.commit()

    def test_reviews_summary_reports_config_and_table_snapshot(self) -> None:
        with SessionLocal() as db:
            save_api_settings(
                db,
                {
                    "NAVER_KEY": "naver-openapi-key",
                    "NAVER_SECRET": "naver-openapi-secret",
                    "NAVER_COMMERCE_CLIENT_ID": "commerce-id",
                    "NAVER_COMMERCE_CLIENT_SECRET": "$2a$10$abcdefghijklmnopqrstuv",
                },
            )
            db.add(
                NaverProductReviewDaily(
                    date=date(2026, 3, 30),
                    keyword="샴푸",
                    product_id=101,
                    product_title="테스트 샴푸",
                    mall_name="테스트몰",
                    rating_avg=4.7,
                    rating_count=128,
                    rating_1_cnt=1,
                    rating_2_cnt=2,
                    rating_3_cnt=5,
                    rating_4_cnt=30,
                    rating_5_cnt=90,
                )
            )
            db.commit()

        res = self.client.get("/reviews/summary")
        self.assertEqual(res.status_code, 200)
        body = res.json()

        self.assertTrue(body["ok"])
        self.assertTrue(body["settings"]["commerce_api_configured"])
        self.assertTrue(body["settings"]["shopping_openapi_configured"])
        self.assertEqual(body["review_daily"]["total_rows"], 1)
        self.assertEqual(body["review_daily"]["min_date"], "2026-03-30")
        self.assertEqual(body["review_daily"]["max_date"], "2026-03-30")
        self.assertEqual(len(body["review_daily"]["latest_items"]), 1)
        self.assertEqual(body["review_daily"]["latest_items"][0]["keyword"], "샴푸")
        self.assertEqual(body["current_runtime"]["ui_review_source"], "page_metrics_html")
        self.assertFalse(body["current_runtime"]["official_review_api_verified"])
        self.assertTrue(body["current_runtime"]["review_daily_pipeline_connected"])

    def test_page_metrics_review_snapshot_is_mirrored_into_review_daily(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/999"
        with SessionLocal() as db:
            db.add(TrackedProductKeyword(product_url=product_url, keyword="샴푸", is_active=True))
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="샴푸",
                    title="DB 샴푸",
                    mall_name="테스트몰",
                    product_id_catalog=999,
                )
            )
            db.commit()

            saved = main._mirror_page_metrics_into_review_daily(
                db,
                target_date="2026-03-31",
                product_url=product_url,
                title="페이지 샴푸",
                rating=4.8,
                review_count=321,
            )

        self.assertEqual(saved, 1)
        with SessionLocal() as db:
            row = db.query(NaverProductReviewDaily).one()
            self.assertEqual(row.date.isoformat(), "2026-03-31")
            self.assertEqual(row.keyword, "샴푸")
            self.assertEqual(row.product_id, 999)
            self.assertEqual(row.product_title, "페이지 샴푸")
            self.assertEqual(row.mall_name, "테스트몰")
            self.assertEqual(row.rating_avg, 4.8)
            self.assertEqual(row.rating_count, 321)

    def test_page_metrics_review_snapshot_skips_when_catalog_mapping_missing(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/1000"
        with SessionLocal() as db:
            db.add(TrackedProductKeyword(product_url=product_url, keyword="린스", is_active=True))
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="린스",
                    title="DB 린스",
                    mall_name="테스트몰",
                    product_id_catalog=None,
                )
            )
            db.commit()

            saved = main._mirror_page_metrics_into_review_daily(
                db,
                target_date="2026-03-31",
                product_url=product_url,
                title="페이지 린스",
                rating=4.2,
                review_count=12,
            )

        self.assertEqual(saved, 0)
        with SessionLocal() as db:
            self.assertEqual(db.query(NaverProductReviewDaily).count(), 0)

    def test_reviews_backfill_from_page_metrics_fills_historical_review_daily(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/2000"
        with SessionLocal() as db:
            db.add(TrackedProductKeyword(product_url=product_url, keyword="에센스", is_active=True))
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="에센스",
                    title="DB 에센스",
                    mall_name="테스트몰",
                    product_id_catalog=2000,
                )
            )
            db.add(
                TrackedProductPageDaily(
                    date=date(2026, 3, 29),
                    product_url=product_url,
                    title="페이지 에센스",
                    review_count=101,
                    rating=4.3,
                    http_status=200,
                    error=None,
                )
            )
            db.add(
                TrackedProductPageDaily(
                    date=date(2026, 3, 30),
                    product_url=product_url,
                    title="페이지 에센스",
                    review_count=108,
                    rating=4.4,
                    http_status=200,
                    error=None,
                )
            )
            db.commit()

        res = self.client.post(
            "/reviews/backfill-from-page-metrics",
            json={"days": 7, "product_url": product_url, "date": "2026-03-31"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["total_targets"], 1)
        self.assertEqual(body["source_rows"], 2)
        self.assertEqual(body["saved"], 2)
        self.assertEqual(body["skipped"], 0)

        with SessionLocal() as db:
            rows = db.query(NaverProductReviewDaily).order_by(NaverProductReviewDaily.date.asc()).all()
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0].date.isoformat(), "2026-03-29")
            self.assertEqual(rows[0].rating_count, 101)
            self.assertEqual(rows[1].date.isoformat(), "2026-03-30")
            self.assertEqual(rows[1].rating_count, 108)

    def test_reviews_backfill_handles_large_catalog_product_id(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/88588340117"
        large_product_id = 88588340117
        with SessionLocal() as db:
            db.add(TrackedProductKeyword(product_url=product_url, keyword="헤나", is_active=True))
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="헤나",
                    title="대형 상품 ID 헤나",
                    mall_name="테스트몰",
                    product_id_catalog=large_product_id,
                )
            )
            db.add(
                TrackedProductPageDaily(
                    date=date(2026, 3, 31),
                    product_url=product_url,
                    title="대형 상품 ID 헤나",
                    review_count=3198,
                    rating=4.71,
                    http_status=200,
                    error=None,
                )
            )
            db.commit()

        res = self.client.post(
            "/reviews/backfill-from-page-metrics",
            json={"days": 14, "product_url": product_url, "date": "2026-03-31"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["saved"], 1)

        with SessionLocal() as db:
            row = db.query(NaverProductReviewDaily).one()
            self.assertEqual(row.product_id, large_product_id)
            self.assertEqual(row.rating_count, 3198)

    def test_reviews_analysis_dashboard_aggregates_kpis_categories_and_keywords(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/3001"
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverProductReviewDaily(
                        date=date(2026, 4, 1),
                        keyword="샴푸",
                        product_id=3001,
                        product_title="테스트 샴푸",
                        mall_name="테스트몰",
                        rating_avg=4.5,
                        rating_count=100,
                        rating_1_cnt=2,
                        rating_2_cnt=3,
                        rating_3_cnt=5,
                        rating_4_cnt=20,
                        rating_5_cnt=70,
                    ),
                    NaverProductReviewDaily(
                        date=date(2026, 4, 2),
                        keyword="샴푸",
                        product_id=3001,
                        product_title="테스트 샴푸",
                        mall_name="테스트몰",
                        rating_avg=4.2,
                        rating_count=120,
                        rating_1_cnt=4,
                        rating_2_cnt=6,
                        rating_3_cnt=12,
                        rating_4_cnt=30,
                        rating_5_cnt=68,
                    ),
                    NaverReviewRaw(
                        review_key="rv-1",
                        product_url=product_url,
                        product_title="테스트 샴푸",
                        product_id_catalog=3001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 1),
                        rating=5,
                        review_text="배송이 빠르고 포장이 꼼꼼해서 만족합니다. 향도 좋아요.",
                        option_text="500ml",
                    ),
                    NaverReviewRaw(
                        review_key="rv-2",
                        product_url=product_url,
                        product_title="테스트 샴푸",
                        product_id_catalog=3001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 1),
                        rating=5,
                        review_text="효과가 좋아서 재구매합니다. 사용감이 편해요.",
                        option_text="500ml",
                    ),
                    NaverReviewRaw(
                        review_key="rv-3",
                        product_url=product_url,
                        product_title="테스트 샴푸",
                        product_id_catalog=3001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 2),
                        rating=2,
                        review_text="배송이 늦고 포장이 터져서 왔어요. 너무 아쉬워요.",
                        option_text="500ml",
                    ),
                    NaverReviewRaw(
                        review_key="rv-4",
                        product_url=product_url,
                        product_title="테스트 샴푸",
                        product_id_catalog=3001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 2),
                        rating=3,
                        review_text="가격이 조금 비싸고 용량이 작게 느껴집니다.",
                        option_text="300ml",
                    ),
                ]
            )
            db.commit()

        res = self.client.get("/reviews/analysis-dashboard?from_date=2026-04-01&to_date=2026-04-02")
        self.assertEqual(res.status_code, 200)
        body = res.json()

        self.assertTrue(body["ok"])
        self.assertEqual(body["summary"]["total_reviews"], 4)
        self.assertAlmostEqual(body["summary"]["average_rating"], 3.75, places=2)
        self.assertEqual(body["summary"]["positive_reviews"], 2)
        self.assertEqual(body["summary"]["negative_reviews"], 1)
        self.assertEqual(len(body["trend"]), 2)
        self.assertEqual(body["trend"][0]["date"], "2026-04-01")
        self.assertEqual(body["trend"][1]["review_count"], 2)
        self.assertEqual(body["rating_distribution"]["total_reviews"], 220)
        self.assertGreaterEqual(len(body["category_overview"]), 3)
        category_names = [item["category"] for item in body["category_overview"]]
        self.assertIn("배송", category_names)
        self.assertIn("가격/가성비", category_names)
        shipping_category = next(item for item in body["category_overview"] if item["category"] == "배송")
        self.assertEqual(shipping_category["mention_count"], 2)
        self.assertEqual(shipping_category["negative_count"], 1)
        self.assertEqual(shipping_category["headline"], "배송 불만 비중 높아 우선 관리 필요")
        self.assertEqual(shipping_category["value_summary"], "배송 긍정 1건, 반응 포인트 긍정적")
        self.assertEqual(shipping_category["concern_summary"], "부정 리뷰 1건 반복, 위험 신호")
        self.assertEqual(shipping_category["target_summary"], "상세페이지/FAQ/답글 보강 필요")
        self.assertTrue(shipping_category["positive_examples"])
        self.assertEqual(shipping_category["positive_examples"][0]["product_title"], "테스트 샴푸")
        self.assertEqual(shipping_category["positive_examples"][0]["review_written_at"], "2026-04-01")
        self.assertEqual(shipping_category["negative_examples"][0]["rating"], 2.0)
        self.assertTrue(any(item["keyword"] == "배송" for item in body["keyword_insights"]["top_keywords"]))
        self.assertTrue(body["action_items"])

    def test_reviews_analysis_dashboard_respects_date_filters_for_raw_reviews(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/4001"
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverReviewRaw(
                        review_key="rv-date-1",
                        product_url=product_url,
                        product_title="필터 샴푸",
                        product_id_catalog=4001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 1),
                        rating=5,
                        review_text="향이 좋아요.",
                    ),
                    NaverReviewRaw(
                        review_key="rv-date-2",
                        product_url=product_url,
                        product_title="필터 샴푸",
                        product_id_catalog=4001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 5),
                        rating=1,
                        review_text="포장이 파손되어 왔어요.",
                    ),
                ]
            )
            db.commit()

        res = self.client.get("/reviews/analysis-dashboard?from_date=2026-04-01&to_date=2026-04-02")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["summary"]["total_reviews"], 1)
        self.assertEqual(body["summary"]["positive_reviews"], 1)
        self.assertEqual(body["summary"]["negative_reviews"], 0)
        self.assertEqual(len(body["trend"]), 0)

    def test_reviews_analysis_dashboard_exposes_product_overview_and_product_filter(self) -> None:
        product_url_a = "https://smartstore.naver.com/testmall/products/5001"
        product_url_b = "https://smartstore.naver.com/testmall/products/5002"
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverReviewRaw(
                        review_key="rv-prod-a1",
                        product_url=product_url_a,
                        product_title="상품 A",
                        product_id_catalog=5001,
                        keyword="헤어",
                        review_written_at=date(2026, 4, 1),
                        rating=5,
                        review_text="배송이 빠르고 만족합니다.",
                    ),
                    NaverReviewRaw(
                        review_key="rv-prod-a2",
                        product_url=product_url_a,
                        product_title="상품 A",
                        product_id_catalog=5001,
                        keyword="헤어",
                        review_written_at=date(2026, 4, 2),
                        rating=4,
                        review_text="향이 좋아요.",
                    ),
                    NaverReviewRaw(
                        review_key="rv-prod-b1",
                        product_url=product_url_b,
                        product_title="상품 B",
                        product_id_catalog=5002,
                        keyword="헤어",
                        review_written_at=date(2026, 4, 2),
                        rating=2,
                        review_text="가격이 비싸고 불편합니다.",
                    ),
                ]
            )
            db.commit()

        all_res = self.client.get("/reviews/analysis-dashboard?from_date=2026-04-01&to_date=2026-04-02")
        self.assertEqual(all_res.status_code, 200)
        all_body = all_res.json()
        self.assertEqual(len(all_body["product_overview"]), 2)
        self.assertEqual(all_body["product_overview"][0]["product_title"], "상품 A")
        self.assertEqual(all_body["product_overview"][0]["review_count"], 2)
        self.assertEqual(all_body["product_overview"][1]["product_title"], "상품 B")

        filtered_res = self.client.get(
            f"/reviews/analysis-dashboard?from_date=2026-04-01&to_date=2026-04-02&product_url={product_url_b}"
        )
        self.assertEqual(filtered_res.status_code, 200)
        filtered_body = filtered_res.json()
        self.assertEqual(filtered_body["summary"]["total_reviews"], 1)
        self.assertEqual(len(filtered_body["product_overview"]), 1)
        self.assertEqual(filtered_body["product_overview"][0]["product_title"], "상품 B")

    def test_reviews_analysis_dashboard_dedupes_keyword_mirrored_daily_snapshots(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/7001"
        with SessionLocal() as db:
            db.add_all(
                [
                    NaverReviewRaw(
                        review_key="rv-dedupe-1",
                        product_url=product_url,
                        product_title="중복 집계 방지 상품",
                        product_id_catalog=7001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 1),
                        rating=5,
                        review_text="사용감이 좋습니다.",
                    ),
                    NaverReviewRaw(
                        review_key="rv-dedupe-2",
                        product_url=product_url,
                        product_title="중복 집계 방지 상품",
                        product_id_catalog=7001,
                        keyword="샴푸",
                        review_written_at=date(2026, 4, 2),
                        rating=4,
                        review_text="향이 무난합니다.",
                    ),
                    NaverProductReviewDaily(
                        date=date(2026, 4, 1),
                        keyword="샴푸",
                        product_id=7001,
                        product_title="중복 집계 방지 상품",
                        mall_name="테스트몰",
                        rating_avg=4.8,
                        rating_count=100,
                        rating_1_cnt=1,
                        rating_2_cnt=1,
                        rating_3_cnt=3,
                        rating_4_cnt=15,
                        rating_5_cnt=80,
                    ),
                    NaverProductReviewDaily(
                        date=date(2026, 4, 1),
                        keyword="헤어에센스",
                        product_id=7001,
                        product_title="중복 집계 방지 상품",
                        mall_name="테스트몰",
                        rating_avg=4.8,
                        rating_count=100,
                        rating_1_cnt=1,
                        rating_2_cnt=1,
                        rating_3_cnt=3,
                        rating_4_cnt=15,
                        rating_5_cnt=80,
                    ),
                    NaverProductReviewDaily(
                        date=date(2026, 4, 2),
                        keyword="샴푸",
                        product_id=7001,
                        product_title="중복 집계 방지 상품",
                        mall_name="테스트몰",
                        rating_avg=4.9,
                        rating_count=120,
                        rating_1_cnt=1,
                        rating_2_cnt=1,
                        rating_3_cnt=2,
                        rating_4_cnt=16,
                        rating_5_cnt=100,
                    ),
                    NaverProductReviewDaily(
                        date=date(2026, 4, 2),
                        keyword="헤어에센스",
                        product_id=7001,
                        product_title="중복 집계 방지 상품",
                        mall_name="테스트몰",
                        rating_avg=4.9,
                        rating_count=120,
                        rating_1_cnt=1,
                        rating_2_cnt=1,
                        rating_3_cnt=2,
                        rating_4_cnt=16,
                        rating_5_cnt=100,
                    ),
                ]
            )
            db.commit()

        res = self.client.get("/reviews/analysis-dashboard?from_date=2026-04-01&to_date=2026-04-02")
        self.assertEqual(res.status_code, 200)
        body = res.json()

        self.assertEqual(body["summary"]["latest_review_count"], 120)
        self.assertEqual(body["summary"]["previous_review_count"], 100)
        self.assertAlmostEqual(body["summary"]["review_growth_rate"], 20.0, places=1)
        self.assertEqual(body["rating_distribution"]["total_reviews"], 220)
        self.assertEqual(body["source_info"]["daily_snapshot_count"], 2)


if __name__ == "__main__":
    unittest.main()
