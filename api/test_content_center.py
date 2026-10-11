from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import date, datetime

from sqlalchemy.orm import Session

from db import (
    CommerceQnaRaw,
    CollectionJobRun,
    ContentAppealEvidence,
    ContentAppealPoint,
    ContentArtifact,
    ContentGfaCreativeBinding,
    ContentClaimPolicy,
    ContentInsight,
    ContentPerformanceDaily,
    ContentPlanItem,
    ContentPublishLink,
    ContentReviewEvent,
    ContentSkuAsset,
    ContentSkuScope,
    ContentTopic,
    NaverReviewRaw,
    NaverAdSearchwordDaily,
    NaverCommerceProductOrderRaw,
    NaverGfaDaily,
    NaverSmartstorePurchaseKeywordDaily,
    SessionLocal,
    TrackedProductMeta,
    init_db,
)
from content_center_time import kst_tz


class ContentCenterTest(unittest.TestCase):
    def setUp(self) -> None:
        self._old_writer_fixture = os.environ.get("CONTENT_WRITER_TEST_FIXTURE")
        self._old_content_asset_dir = os.environ.get("CONTENT_ASSET_DIR")
        self._old_openai_key = os.environ.get("OPENAI_API_KEY")
        os.environ["CONTENT_WRITER_TEST_FIXTURE"] = "1"
        self._tmp_asset_dir = tempfile.TemporaryDirectory()
        os.environ["CONTENT_ASSET_DIR"] = self._tmp_asset_dir.name
        os.environ.pop("OPENAI_API_KEY", None)
        init_db()
        self.db: Session = SessionLocal()
        self.henna_url = "https://smartstore.naver.com/thesujata/products/4743750201"
        self.pack_url = "https://smartstore.naver.com/thesujata/products/12874366496"
        self.oil_url = "https://smartstore.naver.com/thesujata/products/5787615984"
        for model in (
            CollectionJobRun,
            ContentPerformanceDaily,
            ContentGfaCreativeBinding,
            ContentPublishLink,
            ContentReviewEvent,
            ContentArtifact,
            ContentSkuAsset,
            ContentPlanItem,
            ContentTopic,
            ContentAppealEvidence,
            ContentAppealPoint,
            ContentInsight,
            ContentSkuScope,
            ContentClaimPolicy,
            CommerceQnaRaw,
            NaverAdSearchwordDaily,
            NaverCommerceProductOrderRaw,
            NaverGfaDaily,
            NaverReviewRaw,
            NaverSmartstorePurchaseKeywordDaily,
            TrackedProductMeta,
        ):
            self.db.query(model).delete()
        self.db.commit()
        self.db.add(TrackedProductMeta(product_url=self.henna_url, title="수자타 헤나 염색약", keyword="헤나", product_id_catalog=4743750201))
        self.db.add(TrackedProductMeta(product_url=self.pack_url, title="수자타 천연 허브 헤어팩", keyword="허브팩", product_id_catalog=12874366496))
        self.db.add(TrackedProductMeta(product_url=self.oil_url, title="수자타 호호바오일", keyword="호호바", product_id_catalog=5787615984))
        for idx in range(1, 5):
            self.db.add(
                TrackedProductMeta(
                    product_url=f"https://smartstore.naver.com/thesujata/products/880000000{idx}",
                    title=f"수자타 허브팩 {idx}종",
                    keyword="허브팩",
                    product_id_catalog=8800000000 + idx,
                )
            )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        if self._old_writer_fixture is None:
            os.environ.pop("CONTENT_WRITER_TEST_FIXTURE", None)
        else:
            os.environ["CONTENT_WRITER_TEST_FIXTURE"] = self._old_writer_fixture
        if self._old_content_asset_dir is None:
            os.environ.pop("CONTENT_ASSET_DIR", None)
        else:
            os.environ["CONTENT_ASSET_DIR"] = self._old_content_asset_dir
        if self._old_openai_key is None:
            os.environ.pop("OPENAI_API_KEY", None)
        else:
            os.environ["OPENAI_API_KEY"] = self._old_openai_key
        self._tmp_asset_dir.cleanup()

    def test_sku_scope_pins_universe_and_phase1(self) -> None:
        from content_center_scope import classify_product_group, sync_content_sku_scope

        self.assertEqual(classify_product_group("수자타 헤나 염색약"), "henna")
        self.assertEqual(classify_product_group("수자타 천연 허브 헤어팩"), "herb_pack")
        result = sync_content_sku_scope(self.db)
        self.assertEqual(result["universe_count"], 7)
        self.assertEqual(result["henna_enabled"], 1)
        self.assertEqual(result["herb_pack_enabled"], 4)
        self.assertEqual(result["phase1_count"], 5)
        oil = next(item for item in result["items"] if "오일" in str(item.get("title") or ""))
        self.assertFalse(oil["phase1_enabled"])
        henna = next(item for item in result["items"] if item["product_group"] == "henna")
        self.assertTrue(henna["phase1_enabled"])
        self.assertEqual(henna["sku_id"], "4743750201")

    def test_data_ready_reports_exact_source_metrics_without_breaking_tasks(self) -> None:
        from content_center_planner import data_ready_gate

        as_of = date(2026, 8, 25)
        self.db.add(
            CollectionJobRun(
                job_id="job-reviews",
                task_id="reviews_collect",
                run_mode="schedule",
                source_type="host_cdp",
                status="SUCCESS",
                target_date=as_of,
                date_from=date(2026, 8, 24),
                date_to=as_of,
                rows_written=35,
                finished_at=datetime(2026, 8, 25, 5, 56, tzinfo=kst_tz()),
            )
        )
        self.db.add(
            CollectionJobRun(
                job_id="job-ads",
                task_id="ads_daily",
                run_mode="schedule",
                source_type="server_api",
                status="SUCCESS",
                target_date=date(2026, 8, 24),
                date_from=date(2026, 8, 24),
                date_to=date(2026, 8, 24),
                rows_written=7,
                finished_at=datetime(2026, 8, 25, 4, 1, tzinfo=kst_tz()),
            )
        )
        self.db.add(
            NaverReviewRaw(
                review_key="rv-ready",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="오늘 리뷰",
                review_written_at=as_of,
            )
        )
        for idx in range(3):
            self.db.add(
                NaverAdSearchwordDaily(
                    date=date(2026, 8, 24),
                    campaign_name="캠페인",
                    adgroup_name="그룹",
                    searchword=f"검색어-{idx}",
                    device="ALL",
                    source="searchad_api",
                    clicks=idx + 1,
                )
            )
        self.db.commit()

        result = data_ready_gate(self.db, as_of=as_of)
        self.assertIn("tasks", result)
        self.assertIn("sources", result)
        sources = {item["source"]: item for item in result["sources"]}

        review = sources["review"]
        self.assertEqual(review["latest_data_date"], "2026-08-25")
        self.assertEqual(review["latest_data_row_count"], 1)
        self.assertEqual(review["today_row_count"], 1)
        self.assertEqual(review["last_job_rows_written"], 35)
        self.assertEqual(review["readiness_status"], "READY")

        ad = sources["ad_searchword"]
        self.assertEqual(ad["latest_data_date"], "2026-08-24")
        self.assertEqual(ad["latest_data_row_count"], 3)
        self.assertEqual(ad["today_row_count"], 0)
        self.assertEqual(ad["last_job_rows_written"], 7)
        self.assertEqual(ad["readiness_status"], "READY_PREVIOUS_DAY")

    def test_insight_engine_links_evidence_to_appeal(self) -> None:
        from content_center_engine import get_appeal, run_insight_engine
        from content_center_scope import sync_content_sku_scope

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-1",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치 때문에 한 달에 두 번씩 염색하는데 두피가 따가워요.",
                review_written_at=date(2026, 8, 20),
                rating=5.0,
            )
        )
        self.db.add(
            CommerceQnaRaw(
                qna_key="q-1",
                qna_kind="product",
                external_inquiry_id="ext-1",
                title="자주 염색",
                inquiry_text="새치가 금방 올라와서 반복 염색이 부담입니다.",
                product_no="4743750201",
                product_name="수자타 헤나 염색약",
                inquiry_registered_at=datetime(2026, 8, 21, tzinfo=kst_tz()),
            )
        )
        self.db.add(
            NaverSmartstorePurchaseKeywordDaily(
                date=date(2026, 8, 21),
                product_id=4743750201,
                channel_group="쇼핑",
                channel_name="네이버",
                keyword="반복 새치염색",
                payments=8,
                amount=120000,
            )
        )
        self.db.commit()
        run = run_insight_engine(self.db, as_of=date(2026, 8, 24), phase1_only=True)
        self.assertGreaterEqual(run["appeals_upserted"] + run["insights_upserted"], 1)
        from db import ContentAppealPoint

        appeal = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()
        self.assertIsNotNone(appeal)
        detail = get_appeal(self.db, appeal.appeal_id)
        self.assertEqual(detail["sku_id"], "4743750201")
        sources = {x["source_type"] for x in detail["evidence"]}
        self.assertIn("review", sources)
        self.assertIn("qna", sources)
        self.assertIn("purchase_keyword", sources)
        self.assertTrue(all(x["sku_id"] == "4743750201" for x in detail["evidence"]))
        self.assertGreater(detail["scores"]["overall"], 0)
        review_evidence = [x for x in detail["evidence"] if x["source_type"] == "review"]
        self.assertTrue(review_evidence)
        self.assertEqual(review_evidence[0]["rating"], 5)

    def test_operating_insight_uses_rolling_six_month_window_without_source_caps(self) -> None:
        from content_center_engine import get_appeal, run_insight_engine
        from content_center_scope import sync_content_sku_scope

        sync_content_sku_scope(self.db)
        as_of = date(2026, 8, 26)
        for key, written_at, text in (
            ("rv-old", date(2026, 2, 25), "새치 오래된 리뷰는 제외되어야 합니다."),
            ("rv-start", date(2026, 2, 26), "새치 시작일 리뷰는 포함되어야 합니다."),
            ("rv-today", date(2026, 8, 26), "새치 오늘 리뷰도 포함되어야 합니다."),
            ("rv-future", date(2026, 8, 27), "새치 미래 리뷰는 제외되어야 합니다."),
        ):
            self.db.add(
                NaverReviewRaw(
                    review_key=key,
                    product_url=self.henna_url,
                    product_id_catalog=4743750201,
                    review_text=text,
                    review_written_at=written_at,
                )
            )
        for key, registered_at, text in (
            ("q-start", datetime(2026, 2, 26, 0, 0, tzinfo=kst_tz()), "새치 시작일 문의 포함"),
            ("q-future", datetime(2026, 8, 27, 0, 0, tzinfo=kst_tz()), "새치 미래 문의 제외"),
        ):
            self.db.add(
                CommerceQnaRaw(
                    qna_key=key,
                    qna_kind="product",
                    external_inquiry_id=key,
                    title="새치 문의",
                    inquiry_text=text,
                    product_no="4743750201",
                    product_name="수자타 헤나 염색약",
                    inquiry_registered_at=registered_at,
                )
            )
        for d, keyword, payments in (
            (date(2026, 2, 25), "새치 오래된 구매", 100),
            (date(2026, 2, 26), "새치 윈도우 구매", 2),
            (date(2026, 8, 26), "새치 오늘 구매", 3),
            (date(2026, 8, 27), "새치 미래 구매", 200),
        ):
            self.db.add(
                NaverSmartstorePurchaseKeywordDaily(
                    date=d,
                    product_id=4743750201,
                    channel_group="쇼핑",
                    channel_name="네이버",
                    keyword=keyword,
                    payments=payments,
                    amount=payments * 1000,
                )
            )
        for d, word in (
            (date(2026, 2, 25), "새치 오래된 검색"),
            (date(2026, 2, 26), "새치 시작일 검색"),
            (date(2026, 8, 26), "새치 오늘 검색"),
            (date(2026, 8, 27), "새치 미래 검색"),
        ):
            self.db.add(
                NaverAdSearchwordDaily(
                    date=d,
                    campaign_name=f"캠페인-{d.isoformat()}",
                    adgroup_name="그룹",
                    searchword=word,
                    matched_keyword="새치",
                    device="ALL",
                    source="searchad_api",
                    clicks=1,
                    purchase_conversions=1,
                )
            )
        self.db.commit()

        run = run_insight_engine(self.db, as_of=as_of, phase1_only=True)
        self.assertEqual(run["analysis_mode"], "OPERATING")
        self.assertEqual(run["window_type"], "ROLLING_6_MONTHS_INCLUDING_TODAY")
        self.assertTrue(str(run["window_start"]).startswith("2026-02-26T00:00:00"))
        self.assertTrue(str(run["window_end_exclusive"]).startswith("2026-08-27T00:00:00"))
        source_windows = {item["source"]: item for item in run["source_windows"]}
        self.assertEqual(source_windows["review"]["rows_in_window"], 2)
        self.assertEqual(source_windows["review"]["min_data_date"], "2026-02-26")
        self.assertEqual(source_windows["review"]["max_data_date"], "2026-08-26")
        self.assertEqual(source_windows["qna"]["rows_in_window"], 1)
        self.assertEqual(source_windows["purchase_keyword"]["rows_in_window"], 2)
        self.assertEqual(source_windows["ad_searchword"]["rows_in_window"], 2)

        appeal = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()
        self.assertIsNotNone(appeal)
        detail = get_appeal(self.db, appeal.appeal_id)
        serialized = json.dumps(detail["evidence"], ensure_ascii=False)
        self.assertIn("시작일", serialized)
        self.assertIn("오늘", serialized)
        self.assertNotIn("오래된", serialized)
        self.assertNotIn("미래", serialized)
        purchase_evidence = [item for item in detail["evidence"] if item["source_type"] == "purchase_keyword"]
        payments = sum(float(json.loads(item["metric_json"]).get("payments") or 0) for item in purchase_evidence)
        self.assertEqual(payments, 5.0)
        self.assertIn(detail["emerging"]["status"], {"NEW", "RISING", "STABLE", "DECLINING"})
        self.assertIn("recommendation", detail)
        self.assertEqual(detail["safety_gate"], "CLEAR")
        self.assertIn("AI 추천", detail["recommendation"]["badges"])

    def test_partial_analysis_requires_explicit_window(self) -> None:
        from content_center_engine import run_insight_engine

        with self.assertRaisesRegex(ValueError, "partial_analysis_requires_explicit_start_end"):
            run_insight_engine(self.db, mode="DEBUG_PARTIAL", as_of=date(2026, 8, 26), phase1_only=True)
        with self.assertRaisesRegex(ValueError, "partial_analysis_requires_explicit_start_end"):
            run_insight_engine(self.db, mode="VALIDATION_PARTIAL", as_of=date(2026, 8, 26), start_date=date(2026, 8, 1), phase1_only=True)

    def test_product_issue_evidence_holds_automatic_recommendation(self) -> None:
        from content_center_engine import get_appeal, run_insight_engine
        from content_center_scope import sync_content_sku_scope

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-product-issue",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치 염색 후 두피 피부 발진이 생겼다는 내용은 운영 검토가 필요합니다.",
                review_written_at=date(2026, 8, 20),
            )
        )
        self.db.commit()

        run_insight_engine(self.db, as_of=date(2026, 8, 26), phase1_only=True)
        appeal = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()
        self.assertIsNotNone(appeal)
        detail = get_appeal(self.db, appeal.appeal_id)
        self.assertEqual(detail["safety_gate"], "HOLD")
        self.assertFalse(detail["recommendation"]["ai_recommended"])
        self.assertEqual(detail["recommendation"]["channel_fit"], {})
        self.assertGreater(detail["evidence_classification"]["POTENTIAL_PRODUCT_ISSUE"], 0)

    def test_claim_gate_blocks_prohibited_language(self) -> None:
        from content_center_engine import claim_gate_text, sanitize_marketing_text
        from content_center_scope import ensure_claim_policies

        ensure_claim_policies(self.db)
        gate = claim_gate_text(self.db, "탈모가 줄었다")
        self.assertFalse(gate["allowed"])
        self.assertEqual(gate["legal_risk"], "HIGH")
        cleaned = sanitize_marketing_text(self.db, "탈모 걱정 없이")
        self.assertNotIn("탈모", cleaned)

    def test_today_plan_and_channel_generation(self) -> None:
        from content_center_engine import run_insight_engine
        from content_center_generate import generate_artifact
        from content_center_planner import build_today_plan
        from content_center_scope import sync_content_sku_scope
        from db import ContentAppealPoint

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-pack",
                product_url=self.pack_url,
                product_id_catalog=12874366496,
                review_text="염색 후 허브팩 쓰니 푸석함이 덜해요.",
                review_written_at=date(2026, 8, 22),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        plan = build_today_plan(self.db, as_of=date(2026, 8, 25))
        self.assertGreaterEqual(len(plan["items"]), 1)
        item = plan["items"][0]
        artifact = generate_artifact(
            self.db,
            plan=self.db.query(ContentPlanItem).filter_by(plan_id=item["plan_id"]).one(),
            sku_id=item["sku_id"],
            appeal_id=item["appeal_id"],
            channel=item["channel"],
            sku_title="허브팩",
        )
        self.assertTrue(artifact.export_text)
        self.assertEqual(artifact.appeal_id, item["appeal_id"])
        self.assertIn(artifact.channel, {"blog", "instagram", "shorts"})
        appeal_row = self.db.query(ContentAppealPoint).filter_by(appeal_id=item["appeal_id"]).one()
        self.assertEqual(appeal_row.sku_id, item["sku_id"])
        self.assertEqual(self.db.query(ContentPlanItem).filter_by(channel="gfa").count(), 0)
        with self.assertRaisesRegex(ValueError, "unsupported_content_channel"):
            generate_artifact(
                self.db,
                plan=None,
                sku_id=item["sku_id"],
                appeal_id=item["appeal_id"],
                channel="gfa",
                sku_title="허브팩",
            )

    def test_channel_generation_payloads_are_media_ready(self) -> None:
        from content_center_engine import run_insight_engine
        from content_center_generate import generate_artifact
        from content_center_scope import sync_content_sku_scope
        from db import ContentAppealPoint

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-media-ready",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치 관리가 편하고 색감이 자연스러워서 부모님께 추천하고 싶어요",
                review_written_at=date(2026, 8, 25),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        appeal = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()

        blog = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal.appeal_id, channel="blog", sku_title="수자타 헤나 염색약")
        instagram = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal.appeal_id, channel="instagram", sku_title="수자타 헤나 염색약")
        shorts = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal.appeal_id, channel="shorts", sku_title="수자타 헤나 염색약")

        blog_body = json.loads(blog.body_json or "{}")
        self.assertEqual(blog_body["generation_engine"], "LLM_WRITER_V1")
        self.assertEqual(blog_body["generation_context_summary"]["writer_model"], "gpt-5.5")
        self.assertIn("channel_strategy", blog_body["generation_context_summary"])
        self.assertIn("production_standard", blog_body["generation_context_summary"])
        self.assertIn("blog", blog_body)
        self.assertGreaterEqual(len(blog_body["blog"]["sections"]), 3)
        self.assertLessEqual(len(blog_body["blog"]["sections"]), 5)
        self.assertGreaterEqual(len(blog.export_text or ""), 800)
        self.assertGreaterEqual(len(blog_body["blog"]["lead"]), 90)
        self.assertTrue(all(len(section["body"]) > 80 for section in blog_body["blog"]["sections"]))
        self.assertTrue(all(len(section["body"]) >= 160 for section in blog_body["blog"]["sections"]))
        self.assertTrue(all(section.get("image") is None for section in blog_body["blog"]["sections"]))
        self.assertTrue(all(section.get("image_status") == "PENDING" for section in blog_body["blog"]["sections"]))
        self.assertTrue(all(section.get("image_prompt") for section in blog_body["blog"]["sections"]))
        self.assertTrue(all("proof_point" in section for section in blog_body["blog"]["sections"]))
        self.assertEqual(len([section for section in blog_body["blog"]["sections"] if section.get("image_prompt")]), len(blog_body["blog"]["sections"]))
        self.assertTrue(all("리뷰/문의" not in str(section.get("image_prompt") or "") for section in blog_body["blog"]["sections"]))
        self.assertTrue(all("카드형" not in str(section.get("image_prompt") or "") for section in blog_body["blog"]["sections"]))
        self.assertTrue(all("data:image/svg+xml" not in json.dumps(section, ensure_ascii=False) for section in blog_body["blog"]["sections"]))
        self.assertNotIn("data:image/svg+xml", blog.export_text or "")
        self.assertNotIn("고객이 반복해서 표현한 핵심 고민", blog.export_text or "")
        self.assertNotIn("Evidence와 고객 표현을 바탕으로", blog.export_text or "")
        self.assertIn("사용 전 상태를 먼저 확인하세요", blog.export_text or "")
        self.assertTrue(blog_body["blog"]["faq"])
        self.assertTrue(blog_body["blog"]["seo_keywords"])

        instagram_body = json.loads(instagram.body_json or "{}")
        self.assertEqual(instagram_body["generation_engine"], "LLM_WRITER_V1")
        self.assertEqual(instagram_body["format"], "instagram_carousel_v1")
        self.assertEqual(instagram_body["aspect_ratio"], "4:5")
        self.assertGreaterEqual(len(instagram_body["slides"]), 7)
        self.assertLessEqual(len(instagram_body["slides"]), 10)
        self.assertGreaterEqual(len(instagram_body["caption"]), 100)
        self.assertGreaterEqual(len(instagram_body["hashtags"]), 4)
        self.assertTrue(all(slide["layers"] for slide in instagram_body["slides"]))
        self.assertTrue(all(slide.get("image") is None for slide in instagram_body["slides"]))
        self.assertTrue(all(slide.get("image_status") == "PENDING" for slide in instagram_body["slides"]))
        self.assertTrue(all(slide.get("image_prompt") for slide in instagram_body["slides"]))
        self.assertEqual(len(instagram_body["image_slots"]), len(instagram_body["slides"]))
        instagram_text = instagram.export_text or ""
        self.assertNotIn("고객이 반복해서 말한 고민", instagram_text)
        self.assertNotIn("data:image/svg+xml", json.dumps(instagram_body, ensure_ascii=False))
        self.assertNotEqual(instagram.title, appeal.label)
        self.assertTrue(instagram_body["caption"])

        shorts_body = json.loads(shorts.body_json or "{}")
        self.assertEqual(shorts_body["generation_engine"], "LLM_WRITER_V1")
        self.assertEqual(shorts_body["format"], "shorts_scene_timeline_v1")
        self.assertGreaterEqual(len(shorts_body["shorts"]["scenes"]), 3)
        self.assertGreaterEqual(len(shorts_body["shorts"]["scenes"]), 4)
        self.assertLessEqual(len(shorts_body["shorts"]["scenes"]), 6)
        self.assertGreaterEqual(sum(int(scene["duration_sec"]) for scene in shorts_body["shorts"]["scenes"]), 20)
        self.assertLessEqual(sum(int(scene["duration_sec"]) for scene in shorts_body["shorts"]["scenes"]), 35)
        self.assertTrue(all(scene["voice_over"] and scene["visual_prompt"] for scene in shorts_body["shorts"]["scenes"]))
        self.assertTrue(all(scene.get("visual_asset") is None for scene in shorts_body["shorts"]["scenes"]))
        self.assertTrue(all(scene.get("image_prompt") for scene in shorts_body["shorts"]["scenes"]))

    def test_generation_auto_attaches_real_images_when_available(self) -> None:
        import content_center_generate
        from content_center_engine import run_insight_engine
        from content_center_generate import generate_artifact
        from content_center_scope import sync_content_sku_scope
        from db import ContentAppealPoint

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-auto-image",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치 관리가 반복되지만 집에서 차분하게 관리할 수 있으면 좋겠어요.",
                review_written_at=date(2026, 8, 25),
            )
        )
        self.db.commit()
        meta = self.db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == self.henna_url).one_or_none()
        if meta is not None:
            meta.image_url = "https://example.test/sujata-henna-product.jpg"
            self.db.commit()
        from content_product_image_reference import sku_product_image_reference
        self.assertEqual(sku_product_image_reference(self.db, self.henna_url), {})
        from content_center_assets import content_asset_path
        upload_path = content_asset_path("auto-reference-product.png")
        with open(upload_path, "wb") as f:
            f.write(b"auto-reference-product")
        self.db.add(
            ContentSkuAsset(
                asset_id="CA-auto-reference-product",
                sku_id="4743750201",
                product_url=self.henna_url,
                asset_type="product_image",
                filename="auto-reference-product.png",
                original_filename="auto-reference-product.png",
                mime_type="image/png",
                file_path=upload_path,
                file_url="/content/assets/files/auto-reference-product.png",
                is_primary=True,
                analysis_status="READY",
            )
        )
        self.db.commit()
        self.assertEqual(sku_product_image_reference(self.db, self.henna_url)["product_image_url"], "/content/assets/files/auto-reference-product.png")
        run_insight_engine(self.db, phase1_only=True)
        appeal = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()

        old_generate = content_center_generate.generate_content_image

        def fake_generate(db, *, prompt, prefix="content", model=None, size=None, reference_image_url=None, reference_image_path=None):
            return {
                "filename": f"{prefix}.png",
                "image_url": f"/content/images/{prefix}.png",
                "mime_type": "image/png",
                "prompt": prompt,
                "model": "openai:test-image",
                "reference_image_url": reference_image_url or "",
                "reference_image_path": reference_image_path or "",
            }

        content_center_generate.generate_content_image = fake_generate
        try:
            blog_artifact = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal.appeal_id, channel="blog", sku_title="수자타 헤나 염색약")
            instagram_artifact = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal.appeal_id, channel="instagram", sku_title="수자타 헤나 염색약")
            shorts_artifact = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal.appeal_id, channel="shorts", sku_title="수자타 헤나 염색약")
        finally:
            content_center_generate.generate_content_image = old_generate

        blog_body = json.loads(blog_artifact.body_json or "{}")
        sections = blog_body["blog"]["sections"]
        self.assertGreaterEqual(len(sections), 4)
        self.assertTrue(all(str(section.get("image") or "").startswith("/content/images/content_blog_auto_") for section in sections))
        self.assertTrue(all(section.get("image_status") == "GENERATED" for section in sections))
        self.assertEqual(blog_body["image_generation_summary"]["generated"], len(sections))
        self.assertGreater(blog_body["image_generation_summary"]["product_reference_used"], 0)
        self.assertTrue(any(section.get("product_image_reference_url") == "/content/assets/files/auto-reference-product.png" for section in sections))
        reference_prompts = [str(section.get("image_generation_prompt") or "") for section in sections if section.get("product_image_reference_url")]
        self.assertTrue(reference_prompts)
        self.assertTrue(all("no typography" not in prompt.lower() for prompt in reference_prompts))
        self.assertTrue(all("no packaging text emphasis" not in prompt.lower() for prompt in reference_prompts))
        self.assertTrue(all("blank pouch" in prompt.lower() for prompt in reference_prompts))
        self.assertTrue(all("printed package text" in prompt.lower() for prompt in reference_prompts))

        instagram_body = json.loads(instagram_artifact.body_json or "{}")
        slides = instagram_body["slides"]
        self.assertGreaterEqual(len(slides), 7)
        self.assertTrue(all(str(slide.get("image") or "").startswith("/content/images/content_instagram_auto_") for slide in slides))
        self.assertTrue(all(slide.get("image_status") == "GENERATED" for slide in slides))
        self.assertTrue(all(slot.get("image_status") == "GENERATED" for slot in instagram_body["image_slots"]))
        self.assertEqual(instagram_body["image_generation_summary"]["generated"], len(slides))
        self.assertGreater(instagram_body["image_generation_summary"]["product_reference_used"], 0)

        shorts_body = json.loads(shorts_artifact.body_json or "{}")
        scenes = shorts_body["shorts"]["scenes"]
        self.assertGreaterEqual(len(scenes), 4)
        self.assertTrue(all(str((scene.get("visual_asset") or {}).get("url") or "").startswith("/content/images/content_shorts_auto_") for scene in scenes))
        self.assertTrue(all((scene.get("visual_asset") or {}).get("source") == "AI_GENERATED" for scene in scenes))
        self.assertTrue(all(scene.get("visual_status") == "GENERATED" for scene in scenes))
        self.assertEqual(shorts_body["image_generation_summary"]["generated"], len(scenes))
        self.assertGreater(shorts_body["image_generation_summary"]["product_reference_used"], 0)

    def test_editor_revision_chain_preserves_original_and_published_revision(self) -> None:
        from content_center_engine import run_insight_engine
        from content_center_generate import generate_artifact
        from content_center_learn import add_publish_link
        from content_center_revision import regenerate_artifact_revision, save_artifact_draft
        from content_center_scope import sync_content_sku_scope
        from db import ContentAppealPoint

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-revision",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치가 자주 올라오지만 순한 느낌의 염색 관리가 필요해요.",
                review_written_at=date(2026, 8, 22),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        appeal = self.db.query(ContentAppealPoint).first()
        original = generate_artifact(
            self.db,
            plan=None,
            sku_id="4743750201",
            appeal_id=appeal.appeal_id,
            channel="blog",
            sku_title="헤나",
        )

        draft = save_artifact_draft(
            self.db,
            artifact_id=original.artifact_id,
            title="담당자 수정 제목",
            export_text="담당자가 임시 저장한 본문",
            actor="tester",
        )
        regenerated = regenerate_artifact_revision(self.db, artifact_id=draft.artifact_id, prompt_context="제목을 더 부드럽게", actor="tester")
        link = add_publish_link(self.db, artifact_id=regenerated.artifact_id, published_url="https://example.com/post")
        self.db.refresh(original)
        self.db.refresh(draft)
        self.db.refresh(regenerated)

        self.assertEqual(original.original_artifact_id, original.artifact_id)
        self.assertEqual(original.revision_no, 1)
        self.assertEqual(original.source, "ai_original")
        self.assertEqual(draft.parent_artifact_id, original.artifact_id)
        self.assertEqual(draft.original_artifact_id, original.artifact_id)
        self.assertEqual(draft.revision_no, 2)
        self.assertEqual(draft.revision_reason, "human_edit")
        self.assertEqual(draft.source, "human")
        self.assertEqual(draft.reviewer_status, "draft")
        self.assertEqual(regenerated.parent_artifact_id, draft.artifact_id)
        self.assertEqual(regenerated.original_artifact_id, original.artifact_id)
        self.assertEqual(regenerated.revision_no, 3)
        self.assertEqual(regenerated.revision_reason, "user_regenerate")
        self.assertEqual(regenerated.source, "ai")
        regenerated_body = json.loads(regenerated.body_json or "{}")
        self.assertEqual(regenerated_body["generation_engine"], "LLM_WRITER_V1")
        self.assertEqual(regenerated_body["generation_context_summary"]["regenerate_instruction"], "제목을 더 부드럽게")
        self.assertNotIn("data:image/svg+xml", json.dumps(regenerated_body, ensure_ascii=False))
        self.assertTrue(regenerated.is_published_version)
        self.assertFalse(original.is_published_version)
        self.assertFalse(draft.is_published_version)
        self.assertEqual(regenerated.reviewer_status, "published")
        self.assertEqual(link.artifact_id, regenerated.artifact_id)

    def test_publish_management_list_excludes_drafts_and_freezes_legacy_gfa(self) -> None:
        from content_center_learn import add_publish_link, list_publish_management_items

        original_id = "CT-pub-original"
        draft = ContentArtifact(
            artifact_id="CT-draft",
            original_artifact_id=original_id,
            revision_no=1,
            source="ai_original",
            sku_id="sku-1",
            appeal_id="AP-1",
            channel="gfa",
            title="초안",
            reviewer_status="draft",
        )
        approved = ContentArtifact(
            artifact_id="CT-approved",
            original_artifact_id="CT-approved",
            revision_no=1,
            source="ai_original",
            sku_id="sku-2",
            appeal_id="AP-2",
            channel="blog",
            title="승인된 블로그",
            reviewer_status="accepted",
        )
        published = ContentArtifact(
            artifact_id="CT-published",
            original_artifact_id=original_id,
            revision_no=4,
            source="human",
            sku_id="sku-1",
            appeal_id="AP-1",
            channel="gfa",
            title="게시된 GFA",
            reviewer_status="accepted",
        )
        self.db.add_all([draft, approved, published])
        self.db.commit()
        add_publish_link(self.db, artifact_id="CT-published", published_url="https://example.com/pub")

        result = list_publish_management_items(self.db)
        items = {item["artifact_id"]: item for item in result["items"]}

        self.assertNotIn("CT-draft", items)
        self.assertEqual(items["CT-approved"]["management_status"], "READY_TO_PUBLISH")
        self.assertNotIn("CT-published", items)
        self.assertEqual(result["counts"]["READY_TO_PUBLISH"], 1)
        self.assertEqual(result["counts"]["PUBLISHED"], 0)
        self.assertEqual(result["counts"]["LEGACY_GFA"], 2)

        legacy = list_publish_management_items(self.db, channel="gfa")
        legacy_items = {item["artifact_id"]: item for item in legacy["items"]}
        self.assertEqual(legacy_items["CT-published"]["revision_no"], 4)
        self.assertTrue(legacy_items["CT-published"]["is_published_version"])
        self.assertEqual(legacy_items["CT-published"]["publish_url"], "https://example.com/pub")
        self.assertIsNone(legacy_items["CT-published"]["gfa_creative_id"])
        self.assertEqual(legacy_items["CT-published"]["management_status"], "GFA_WAITING_CREATIVE_ID")
        self.assertTrue(legacy_items["CT-published"]["legacy_gfa"])

    def test_publish_management_get_api_is_additive_and_filterable(self) -> None:
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
        except ModuleNotFoundError as exc:
            self.skipTest(f"FastAPI test client is unavailable: {exc}")

        from content_center_api import register_content_center_routes
        from content_center_learn import add_publish_link

        app = FastAPI()

        def get_test_db():
            yield self.db

        register_content_center_routes(app, get_db_dep=get_test_db)
        self.db.add(
            ContentArtifact(
                artifact_id="CT-api-published",
                original_artifact_id="CT-api-original",
                revision_no=4,
                source="human",
                sku_id="sku-api",
                appeal_id="AP-api",
                channel="gfa",
                title="API 게시본",
                reviewer_status="accepted",
            )
        )
        self.db.commit()
        add_publish_link(self.db, artifact_id="CT-api-published", published_url="https://example.com/api-pub")

        client = TestClient(app)
        default_response = client.get("/content/publish-links", params={"management_status": "GFA_WAITING_CREATIVE_ID"})

        self.assertEqual(default_response.status_code, 200)
        default_body = default_response.json()
        self.assertTrue(default_body["ok"])
        self.assertEqual(default_body["items"], [])
        self.assertEqual(default_body["counts"]["LEGACY_GFA"], 1)

        response = client.get("/content/publish-links", params={"channel": "gfa", "management_status": "GFA_WAITING_CREATIVE_ID"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["artifact_id"], "CT-api-published")
        self.assertEqual(body["items"][0]["management_status"], "GFA_WAITING_CREATIVE_ID")
        self.assertEqual(body["items"][0]["publish_url"], "https://example.com/api-pub")

    def test_content_image_generation_updates_channel_specific_slots(self) -> None:
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
        except ModuleNotFoundError as exc:
            self.skipTest(f"FastAPI test client is unavailable: {exc}")

        import content_center_api
        from content_center_api import register_content_center_routes

        app = FastAPI()

        def get_test_db():
            yield self.db

        register_content_center_routes(app, get_db_dep=get_test_db)
        client = TestClient(app)

        from content_center_assets import content_asset_path
        product_path = content_asset_path("endpoint-product-reference.png")
        with open(product_path, "wb") as f:
            f.write(b"endpoint-product-reference")
        self.db.add(
            ContentSkuAsset(
                asset_id="CA-endpoint-product-reference",
                sku_id="sku-img",
                product_url="https://example.test/sku-img",
                asset_type="product_image",
                filename="endpoint-product-reference.png",
                original_filename="endpoint-product-reference.png",
                mime_type="image/png",
                file_path=product_path,
                file_url="/content/assets/files/endpoint-product-reference.png",
                is_primary=True,
                analysis_status="READY",
            )
        )
        self.db.commit()

        blog_body = {"blog": {"sections": [{"heading": "헤나 관리", "body": "본문", "image_prompt": "자연광 욕실 헤나 제품"}]}}
        instagram_body = {
            "format": "instagram_carousel_v1",
            "slides": [{"order": 1, "image": None, "image_status": "PENDING", "image_prompt": "제품 플랫레이", "layers": []}],
            "image_slots": [{"slide_no": 1, "image_status": "PENDING"}],
        }
        shorts_body = {
            "shorts": {"scenes": [{"order": 1, "duration_sec": 4, "caption": "새치 루틴", "voice_over": "짧은 설명", "visual_asset": "욕실 장면", "image_prompt": "세로형 욕실 장면"}]},
            "scenes": [{"order": 1, "duration_sec": 4, "caption": "새치 루틴", "voice_over": "짧은 설명", "visual_asset": "욕실 장면", "image_prompt": "세로형 욕실 장면"}],
        }
        for artifact_id, channel, body in (
            ("CT-img-blog", "blog", blog_body),
            ("CT-img-instagram", "instagram", instagram_body),
            ("CT-img-shorts", "shorts", shorts_body),
        ):
            self.db.add(
                ContentArtifact(
                    artifact_id=artifact_id,
                    original_artifact_id=artifact_id,
                    revision_no=1,
                    source="ai_original",
                    sku_id="sku-img",
                    appeal_id="AP-img",
                    channel=channel,
                    title=f"{channel} 이미지 테스트",
                    body_json=json.dumps(body, ensure_ascii=False),
                    export_text="이미지 테스트",
                    reviewer_status="pending",
                )
            )
        self.db.commit()

        old_generate = content_center_api.generate_content_image

        def fake_generate(db, *, prompt, prefix="content", model=None, size=None, reference_image_url=None, reference_image_path=None):
            return {
                "filename": f"{prefix}.png",
                "image_url": f"/content/images/{prefix}.png",
                "mime_type": "image/png",
                "prompt": prompt,
                "model": "openai:test-image",
                "size": size or "",
                "reference_image_url": reference_image_url or "",
                "reference_image_path": reference_image_path or "",
            }

        content_center_api.generate_content_image = fake_generate
        try:
            cases = (
                ("CT-img-blog", "blog_section", "blog", ["blog", "sections", 0, "image"]),
                ("CT-img-instagram", "instagram_slide", "instagram", ["slides", 0, "image"]),
                ("CT-img-shorts", "shorts_scene", "shorts", ["shorts", "scenes", 0, "visual_asset", "url"]),
            )
            for artifact_id, target, channel, path in cases:
                response = client.post(
                    "/content/images/generate",
                    json={"artifact_id": artifact_id, "target": target, "section_index": 0},
                )
                self.assertEqual(response.status_code, 200, response.text)
                updated = response.json()["item"]["body"]
                current = updated
                for part in path:
                    current = current[part]
                self.assertTrue(str(current).startswith("/content/images/content_"))
                prompt = response.json()["image"]["prompt"].lower()
                self.assertTrue(prompt)
                if channel == "shorts":
                    self.assertIn("vertical", prompt)
                else:
                    self.assertIn(channel, prompt)
        finally:
            content_center_api.generate_content_image = old_generate

    def test_content_asset_upload_list_primary_and_detail_analysis_pending_without_key(self) -> None:
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
        except ModuleNotFoundError as exc:
            self.skipTest(f"FastAPI test client is unavailable: {exc}")

        from content_center_api import register_content_center_routes

        app = FastAPI()

        def get_test_db():
            yield self.db

        register_content_center_routes(app, get_db_dep=get_test_db)
        client = TestClient(app)

        upload = client.post(
            "/content/assets/upload",
            data={"sku_id": "4743750201", "asset_type": "product_image", "product_url": self.henna_url},
            files={"file": ("product.png", b"\x89PNG\r\n\x1a\nproduct", "image/png")},
        )
        self.assertEqual(upload.status_code, 200, upload.text)
        item = upload.json()["item"]
        self.assertEqual(item["asset_type"], "product_image")
        self.assertTrue(item["is_primary"])
        self.assertTrue(item["file_url"].startswith("/content/assets/files/"))

        detail = client.post(
            "/content/assets/upload",
            data={"sku_id": "4743750201", "asset_type": "detail_page", "product_url": self.henna_url},
            files={"file": ("detail.png", b"\x89PNG\r\n\x1a\ndetail", "image/png")},
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        detail_id = detail.json()["item"]["asset_id"]
        analyzed = client.post(f"/content/assets/{detail_id}/analyze")
        self.assertEqual(analyzed.status_code, 200, analyzed.text)
        self.assertFalse(analyzed.json()["ok"])
        self.assertEqual(analyzed.json()["item"]["analysis_status"], "PENDING")

        listed = client.get("/content/assets", params={"sku_id": "4743750201", "asset_type": "product_image"})
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()["items"]), 1)

    def test_uploaded_product_image_overrides_tracked_meta_and_detail_page_feeds_writer_context(self) -> None:
        from content_center_assets import content_asset_path
        from content_product_image_reference import sku_product_image_reference
        from content_writer_service import build_generation_context

        meta = self.db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == self.henna_url).one_or_none()
        if meta is not None:
            meta.image_url = "https://example.test/tracked-meta.jpg"
        self.db.add(
            ContentSkuScope(
                sku_id="4743750201",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                title="수자타 헤나 염색약",
                product_group="henna",
                phase1_enabled=True,
            )
        )
        upload_path = content_asset_path("uploaded-product.png")
        with open(upload_path, "wb") as f:
            f.write(b"uploaded-product")
        self.db.add(
            ContentSkuAsset(
                asset_id="CA-uploaded-product",
                sku_id="4743750201",
                product_url=self.henna_url,
                asset_type="product_image",
                filename="uploaded-product.png",
                original_filename="uploaded-product.png",
                mime_type="image/png",
                file_path=upload_path,
                file_url="/content/assets/files/uploaded-product.png",
                is_primary=True,
                analysis_status="READY",
            )
        )
        self.db.add(
            ContentSkuAsset(
                asset_id="CA-detail-analyzed",
                sku_id="4743750201",
                product_url=self.henna_url,
                asset_type="detail_page",
                filename="detail-page.png",
                original_filename="detail-page.png",
                mime_type="image/png",
                file_path=content_asset_path("detail-page.png"),
                file_url="/content/assets/files/detail-page.png",
                is_primary=False,
                analysis_status="ANALYZED",
                analysis_json=json.dumps({"usp": ["은은한 색감"], "usage_steps": ["분말과 물을 섞어 사용"], "copy_constraints": ["치료 표현 금지"]}, ensure_ascii=False),
            )
        )
        self.db.commit()

        reference = sku_product_image_reference(self.db, "4743750201")
        self.assertEqual(reference["source"], "content_sku_asset")
        self.assertEqual(reference["product_image_url"], "/content/assets/files/uploaded-product.png")
        self.assertEqual(reference["product_image_path"], upload_path)

        context = build_generation_context(
            self.db,
            appeal={"sku_id": "4743750201", "appeal_id": "AP-asset", "label": "새치 루틴", "appeal_text": "집에서 차분하게 관리"},
            channel="blog",
            sku_title="수자타 헤나 염색약",
        )
        self.assertEqual(context["detail_page_reference"][0]["asset_id"], "CA-detail-analyzed")
        self.assertIn("은은한 색감", json.dumps(context["detail_page_reference"], ensure_ascii=False))

    def test_admin_review_clear_overrides_evidence_hold_gate(self) -> None:
        from content_center_engine import appeal_to_dict

        appeal = ContentAppealPoint(
            appeal_id="AP-admin-clear",
            sku_id="4743750201",
            theme_key="admin-clear",
            label="두피 자극 걱정",
            appeal_text="두피 자극을 줄이고 싶은 사용자를 위한 소구",
            status="ACTIVE",
            overall_score=75,
        )
        evidence = ContentAppealEvidence(
            evidence_id="EV-admin-clear",
            appeal_id=appeal.appeal_id,
            sku_id=appeal.sku_id,
            source_type="review",
            source_pk="rv-admin-clear",
            snippet="두피가 따갑다는 후기가 있어 검토가 필요합니다.",
            metric_json=json.dumps({"evidence_class": "POTENTIAL_PRODUCT_ISSUE"}, ensure_ascii=False),
        )
        before = appeal_to_dict(appeal, evidence=[evidence])
        self.assertEqual(before["safety_gate"], "HOLD")

        appeal.admin_review_status = "CLEAR"
        appeal.admin_review_note = "관리자 확인 완료"
        after = appeal_to_dict(appeal, evidence=[evidence])
        self.assertEqual(after["safety_gate"], "CLEAR")
        self.assertEqual(after["admin_review_status"], "CLEAR")
        self.assertIn("관리자 활성화", after["recommendation"]["badges"])

    def test_appeal_evidence_reads_review_star_from_raw_when_metric_missing(self) -> None:
        from content_center_engine import appeal_to_dict

        self.db.add(
            NaverReviewRaw(
                review_key="rv-star-lookup",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="별점만 있는 기존 리뷰",
                review_written_at=date(2026, 8, 20),
                rating=4.0,
            )
        )
        appeal = ContentAppealPoint(
            appeal_id="AP-star-lookup",
            sku_id="4743750201",
            theme_key="star-lookup",
            label="별점 조회",
            appeal_text="기존 Evidence에 별점이 없어도 원문 평점을 붙인다",
            status="ACTIVE",
            overall_score=70,
        )
        evidence = ContentAppealEvidence(
            evidence_id="EV-star-lookup",
            appeal_id=appeal.appeal_id,
            sku_id=appeal.sku_id,
            source_type="review",
            source_pk="rv-star-lookup",
            snippet="별점만 있는 기존 리뷰",
            metric_json=json.dumps({"evidence_class": "POSITIVE_REVIEW"}, ensure_ascii=False),
        )
        self.db.add(appeal)
        self.db.add(evidence)
        self.db.commit()
        without_db = appeal_to_dict(appeal, evidence=[evidence])
        self.assertIsNone(without_db["evidence"][0]["rating"])
        with_db = appeal_to_dict(appeal, evidence=[evidence], db=self.db)
        self.assertEqual(with_db["evidence"][0]["rating"], 4)

    def test_list_appeals_keeps_latest_duplicate_for_same_sku_theme(self) -> None:
        from content_center_engine import list_appeals

        older = ContentAppealPoint(
            appeal_id="AP-dup-old",
            sku_id="4743750201",
            theme_key="repeat_gray_burden",
            label="반복되는 새치 관리 부담",
            appeal_text="어제 소구",
            status="ACTIVE",
            overall_score=50,
            as_of_date=date(2026, 8, 20),
        )
        newer = ContentAppealPoint(
            appeal_id="AP-dup-new",
            sku_id="4743750201",
            theme_key="repeat_gray_burden",
            label="반복되는 새치 관리 부담",
            appeal_text="오늘 업데이트된 소구",
            status="ACTIVE",
            overall_score=80,
            as_of_date=date(2026, 8, 21),
        )
        other_sku = ContentAppealPoint(
            appeal_id="AP-dup-other-sku",
            sku_id="12874366496",
            theme_key="repeat_gray_burden",
            label="반복되는 새치 관리 부담",
            appeal_text="다른 SKU 소구",
            status="ACTIVE",
            overall_score=70,
            as_of_date=date(2026, 8, 21),
        )
        self.db.add(older)
        self.db.add(newer)
        self.db.add(other_sku)
        self.db.commit()
        henna = list_appeals(self.db, sku_id="4743750201", phase1_only=False)
        self.assertEqual([item["appeal_id"] for item in henna], ["AP-dup-new"])
        self.assertEqual(henna[0]["appeal_text"], "오늘 업데이트된 소구")
        self.assertEqual(henna[0]["as_of_date"], "2026-08-21")

    def test_list_appeals_collapses_duplicate_content_across_skus_to_latest(self) -> None:
        from content_center_engine import list_appeals

        older = ContentAppealPoint(
            appeal_id="AP-cross-old",
            sku_id="4743750201",
            theme_key="repeat_gray_burden",
            label="반복되는 새치 관리 부담",
            appeal_text="반복되는 새치 관리의 부담을 줄이는 식물성 관리",
            status="ACTIVE",
            overall_score=50,
            as_of_date=date(2026, 8, 20),
            updated_at=datetime(2026, 8, 20, 9, 0, 0),
        )
        newer = ContentAppealPoint(
            appeal_id="AP-cross-new",
            sku_id="12874366496",
            theme_key="repeat_gray_burden",
            label="반복되는 새치 관리 부담",
            appeal_text="반복되는 새치 관리의 부담을 줄이는 식물성 관리",
            status="ACTIVE",
            overall_score=70,
            as_of_date=date(2026, 8, 21),
            updated_at=datetime(2026, 8, 21, 9, 0, 0),
        )
        distinct = ContentAppealPoint(
            appeal_id="AP-cross-distinct",
            sku_id="5787615984",
            theme_key="home_easy",
            label="집에서 간편한 관리",
            appeal_text="집에서 혼자 하기 쉬운 관리",
            status="ACTIVE",
            overall_score=60,
            as_of_date=date(2026, 8, 21),
            updated_at=datetime(2026, 8, 21, 8, 0, 0),
        )
        self.db.add(older)
        self.db.add(newer)
        self.db.add(distinct)
        self.db.commit()

        listed = list_appeals(self.db, phase1_only=False)

        self.assertEqual(
            [item["appeal_id"] for item in listed if item["label"] == "반복되는 새치 관리 부담"],
            ["AP-cross-new"],
        )
        self.assertIn("AP-cross-distinct", [item["appeal_id"] for item in listed])

    def test_insight_engine_archives_stale_duplicate_appeals(self) -> None:
        from content_center_engine import list_appeals, run_insight_engine
        from content_center_scope import sync_content_sku_scope

        sync_content_sku_scope(self.db)
        self.db.add(
            ContentAppealPoint(
                appeal_id="AP-stale",
                sku_id="4743750201",
                theme_key="repeat_gray_burden",
                label="반복되는 새치 관리 부담",
                appeal_text="어제 소구",
                status="ACTIVE",
                overall_score=40,
                as_of_date=date(2026, 8, 19),
            )
        )
        self.db.add(
            ContentAppealPoint(
                appeal_id="AP-keep",
                sku_id="4743750201",
                theme_key="repeat_gray_burden",
                label="반복되는 새치 관리 부담",
                appeal_text="오늘 직전 소구",
                status="ACTIVE",
                overall_score=55,
                as_of_date=date(2026, 8, 20),
            )
        )
        self.db.add(
            NaverReviewRaw(
                review_key="rv-dup-1",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치 때문에 한 달에 두 번씩 염색하는데 두피가 따가워요.",
                review_written_at=date(2026, 8, 21),
                rating=5.0,
            )
        )
        self.db.commit()
        run_insight_engine(self.db, as_of=date(2026, 8, 24), phase1_only=True)
        rows = (
            self.db.query(ContentAppealPoint)
            .filter(
                ContentAppealPoint.sku_id == "4743750201",
                ContentAppealPoint.theme_key == "repeat_gray_burden",
            )
            .all()
        )
        active = [row for row in rows if str(row.status or "").upper() == "ACTIVE"]
        archived = [row for row in rows if str(row.status or "").upper() == "ARCHIVED"]
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].appeal_id, "AP-keep")
        self.assertEqual(active[0].as_of_date, date(2026, 8, 24))
        self.assertTrue(any(row.appeal_id == "AP-stale" for row in archived))
        listed = list_appeals(self.db, sku_id="4743750201", phase1_only=False)
        gray = [item for item in listed if item["theme_key"] == "repeat_gray_burden"]
        self.assertEqual([item["appeal_id"] for item in gray], ["AP-keep"])

    def test_excluded_review_evidence_is_removed_from_hold_gate(self) -> None:
        from content_center_engine import appeal_to_dict

        appeal = ContentAppealPoint(
            appeal_id="AP-exclude-review",
            sku_id="4743750201",
            theme_key="exclude-review",
            label="두피 자극 걱정",
            appeal_text="두피 자극 관련 검토 소구",
            status="ACTIVE",
            overall_score=75,
        )
        evidence = ContentAppealEvidence(
            evidence_id="EV-exclude-review",
            appeal_id=appeal.appeal_id,
            sku_id=appeal.sku_id,
            source_type="review",
            source_pk="rv-exclude-review",
            snippet="부담이 있었다는 리뷰",
            metric_json=json.dumps({"evidence_class": "POTENTIAL_PRODUCT_ISSUE"}, ensure_ascii=False),
        )
        self.assertEqual(appeal_to_dict(appeal, evidence=[evidence])["safety_gate"], "HOLD")
        evidence.is_excluded = True
        after = appeal_to_dict(appeal, evidence=[evidence])
        self.assertEqual(after["safety_gate"], "CLEAR")
        self.assertEqual(after["evidence_count"], 0)
        self.assertEqual(after["excluded_evidence_count"], 1)

    def test_daily_plan_materialization_is_review_pending_and_idempotent(self) -> None:
        from content_center_engine import run_insight_engine
        from content_center_generate import materialize_plan_artifacts
        from content_center_planner import build_today_plan
        from content_center_scope import sync_content_sku_scope
        from db import ContentArtifact, ContentReviewEvent

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-auto",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치가 자주 올라와서 집에서 반복 관리하기가 부담이에요.",
                review_written_at=date(2026, 8, 22),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        plan = build_today_plan(self.db, as_of=date(2026, 8, 25))
        self.assertGreaterEqual(len(plan["items"]), 1)

        first = materialize_plan_artifacts(self.db, as_of=date(2026, 8, 25))
        self.assertEqual(first["failed"], 0)
        self.assertGreaterEqual(first["created"], 1)
        artifacts = self.db.query(ContentArtifact).all()
        self.assertEqual(len(artifacts), first["created"])
        artifact = artifacts[0]
        self.assertEqual(artifact.reviewer_status, "pending")
        self.assertTrue(artifact.plan_id)
        body = json.loads(artifact.body_json or "{}")
        self.assertEqual(body["generation_version"], "v1")
        self.assertEqual(body["lineage"]["plan_id"], artifact.plan_id)
        self.assertEqual(body["lineage"]["appeal_id"], artifact.appeal_id)
        self.assertEqual(body["lineage"]["channel"], artifact.channel)
        event = self.db.query(ContentReviewEvent).filter_by(artifact_id=artifact.artifact_id).one()
        self.assertEqual(event.event_type, "generated")

        second = materialize_plan_artifacts(self.db, as_of=date(2026, 8, 25))
        self.assertEqual(second["created"], 0)
        self.assertEqual(second["reused"], first["created"])
        self.assertEqual(self.db.query(ContentArtifact).count(), first["created"])

    def test_daily_materialization_keeps_partial_failures_isolated(self) -> None:
        from content_center_engine import run_insight_engine
        from content_center_generate import materialize_plan_artifacts
        from content_center_planner import build_today_plan
        from content_center_scope import sync_content_sku_scope
        from db import ContentArtifact

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-partial",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치가 자주 올라와서 반복 염색이 부담이에요.",
                review_written_at=date(2026, 8, 22),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        plan = build_today_plan(self.db, as_of=date(2026, 8, 25))
        valid_plan = self.db.query(ContentPlanItem).filter_by(plan_id=plan["items"][0]["plan_id"]).one()
        self.db.add(
            ContentPlanItem(
                plan_id="PL-bad-appeal",
                plan_date=date(2026, 8, 25),
                sku_id=valid_plan.sku_id,
                appeal_id="AP-missing",
                topic_id=None,
                channel="shorts",
                status="queued",
                reason="partial failure fixture",
            )
        )
        self.db.commit()

        out = materialize_plan_artifacts(self.db, as_of=date(2026, 8, 25))
        self.assertGreaterEqual(out["created"], 1)
        self.assertEqual(out["failed"], 1)
        self.assertGreaterEqual(self.db.query(ContentArtifact).count(), 1)
        bad = self.db.query(ContentPlanItem).filter_by(plan_id="PL-bad-appeal").one()
        self.assertEqual(bad.status, "generation_failed")

    def test_learning_promote_and_revise(self) -> None:
        from content_center_engine import run_insight_engine
        from content_center_generate import generate_artifact
        from content_center_learn import diagnose_performance, record_performance
        from content_center_scope import sync_content_sku_scope
        from db import ContentAppealPoint, ContentPerformanceDaily

        direct_good = {
            "attribution_level": "DIRECT",
            "primary_metric": "ctr",
            "primary_value": 2.4,
            "baseline_value": 2.0,
            "sample": 1200,
            "confidence": "HIGH",
            "observation_complete": True,
        }
        direct_bad = {**direct_good, "primary_value": 1.6}
        direct_flat = {**direct_good, "primary_value": 2.04}
        self.assertEqual(diagnose_performance(channel="gfa", extra_json=direct_good), "PROMOTE")
        self.assertEqual(diagnose_performance(channel="gfa", extra_json=direct_bad), "REVISE")
        self.assertEqual(diagnose_performance(channel="gfa", extra_json=direct_flat), "MAINTAIN")
        self.assertEqual(diagnose_performance(channel="gfa", extra_json={**direct_good, "sample": 20}), "OBSERVE")
        self.assertEqual(diagnose_performance(channel="gfa", extra_json={**direct_good, "attribution_level": "CORRELATION"}), "OBSERVE")
        self.assertEqual(diagnose_performance(channel="gfa", extra_json={**direct_good, "attribution_level": "UNKNOWN"}), "OBSERVE")
        self.assertEqual(diagnose_performance(channel="gfa", extra_json={**direct_good, "observation_complete": False}), "OBSERVE")

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-learn",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치가 자주 올라와서 반복 염색이 부담이에요.",
                review_written_at=date(2026, 8, 20),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        appeal = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()
        artifact = generate_artifact(
            self.db,
            plan=None,
            sku_id="4743750201",
            appeal_id=appeal.appeal_id,
            channel="blog",
            sku_title="헤나",
        )
        out = record_performance(
            self.db,
            artifact_id=artifact.artifact_id,
            metric_date=date(2026, 8, 26),
            impressions=1000,
            clicks=40,
            ctr=4.0,
            cvr=3.0,
            extra_json={
                "attribution_level": "DIRECT",
                "primary_metric": "clicks",
                "primary_value": 40,
                "baseline_value": 20,
                "sample": 40,
                "confidence": "HIGH",
                "observation_complete": True,
                "source": "manual",
            },
        )
        self.assertEqual(out["verdict"], "PROMOTE")
        self.assertEqual(out["attribution_level"], "DIRECT")
        perf = self.db.query(ContentPerformanceDaily).filter_by(perf_id=out["perf_id"]).one()
        stored = json.loads(perf.extra_json or "{}")
        self.assertEqual(stored["attribution_level"], "DIRECT")
        self.assertEqual(stored["primary_metric"], "clicks")
        self.db.refresh(appeal)
        self.assertEqual(appeal.learning_verdict, "PROMOTE")

    def test_manual_performance_contract_preserves_unknown_and_blocks_derived_extra(self) -> None:
        from content_center_learn import build_manual_performance_extra

        extra = build_manual_performance_extra(
            metric_values={
                "impressions": 0,
                "clicks": 12,
                "purchases": None,
            },
            fields_set={"impressions", "clicks", "purchases"},
            extra_json={
                "source_type": "manual",
                "source_reference": "instagram-insight-screen",
                "platform": "instagram",
                "confidence": "HIGH",
                "observation_complete": True,
                "primary_value": 12,
                "baseline_value": 5,
                "sample": 12,
            },
        )
        self.assertEqual(extra["source_type"], "MANUAL")
        self.assertEqual(extra["source_reference"], "instagram-insight-screen")
        self.assertEqual(extra["raw_metrics"]["impressions"], 0)
        self.assertEqual(extra["raw_metrics"]["clicks"], 12)
        self.assertEqual(extra["metric_presence"]["impressions"], "OBSERVED")
        self.assertEqual(extra["metric_presence"]["purchases"], "UNKNOWN")
        self.assertNotIn("confidence", extra)
        self.assertNotIn("observation_complete", extra)
        self.assertNotIn("primary_value", extra)
        self.assertNotIn("baseline_value", extra)
        self.assertNotIn("sample", extra)

    def test_gfa_performance_attribution_bridge_matches_creative_id(self) -> None:
        from content_center_engine import run_insight_engine
        from content_center_learn import add_publish_link
        from content_gfa_bridge import attribute_gfa_performance, bind_gfa_creative
        from content_center_scope import sync_content_sku_scope
        from db import ContentAppealPoint, ContentPerformanceDaily

        def seed_gfa_rows(creative_id: str, *, obs_clicks: int, obs_impressions: int, baseline_clicks: int = 10, baseline_impressions: int = 1000, obs_days: int = 3) -> None:
            for day in range(15, 22):
                self.db.add(
                    NaverGfaDaily(
                        date=date(2026, 8, day),
                        campaign_id="cmp-1",
                        adgroup_id="adg-1",
                        creative_id=creative_id,
                        placement="feed",
                        audience="all",
                        creative_name=f"{creative_id} baseline",
                        impressions=baseline_impressions,
                        clicks=baseline_clicks,
                        conversions=2,
                        purchase_conversions=1,
                        ctr=baseline_clicks / baseline_impressions * 100,
                        cvr=20.0,
                    )
                )
            for offset in range(obs_days):
                day = 22 + offset
                self.db.add(
                    NaverGfaDaily(
                        date=date(2026, 8, day),
                        campaign_id="cmp-1",
                        adgroup_id="adg-1",
                        creative_id=creative_id,
                        placement="feed",
                        audience="all",
                        creative_name=f"{creative_id} observation",
                        impressions=obs_impressions,
                        clicks=obs_clicks,
                        conversions=4,
                        purchase_conversions=2,
                        ctr=obs_clicks / obs_impressions * 100,
                        cvr=16.0,
                    )
                )
            self.db.commit()

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-gfa-bridge",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치 때문에 자주 염색해야 해서 부담입니다.",
                review_written_at=date(2026, 8, 20),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        appeal = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()

        def legacy_gfa_artifact(artifact_id: str) -> ContentArtifact:
            artifact = ContentArtifact(
                artifact_id=artifact_id,
                original_artifact_id=artifact_id,
                revision_no=1,
                source="legacy_freeze_fixture",
                sku_id="4743750201",
                appeal_id=appeal.appeal_id,
                channel="gfa",
                title="Legacy GFA artifact",
                body_json="{}",
                export_text="legacy gfa",
                reviewer_status="accepted",
            )
            self.db.add(artifact)
            self.db.commit()
            self.db.refresh(artifact)
            return artifact

        artifact = legacy_gfa_artifact("CT-legacy-gfa-direct")
        add_publish_link(self.db, artifact_id=artifact.artifact_id, published_url="https://gfa.example.com/cr-direct")
        bind_gfa_creative(self.db, artifact_id=artifact.artifact_id, creative_id="cr-direct", campaign_id="cmp-1", adgroup_id="adg-1")
        seed_gfa_rows("cr-direct", obs_clicks=25, obs_impressions=1000)
        out = attribute_gfa_performance(self.db, artifact_id=artifact.artifact_id, as_of=date(2026, 8, 24))
        self.assertEqual(out["verdict"], "PROMOTE")
        self.assertEqual(out["attribution_level"], "DIRECT")
        self.assertGreater(out["delta_pct"], 0)
        perf_count = self.db.query(ContentPerformanceDaily).filter_by(artifact_id=artifact.artifact_id).count()
        reused = attribute_gfa_performance(self.db, artifact_id=artifact.artifact_id, as_of=date(2026, 8, 24))
        self.assertTrue(reused["reused"])
        self.assertEqual(self.db.query(ContentPerformanceDaily).filter_by(artifact_id=artifact.artifact_id).count(), perf_count)

        unknown_artifact = legacy_gfa_artifact("CT-legacy-gfa-unknown")
        add_publish_link(self.db, artifact_id=unknown_artifact.artifact_id, published_url="https://gfa.example.com/cr-unknown")
        unknown = attribute_gfa_performance(self.db, artifact_id=unknown_artifact.artifact_id, as_of=date(2026, 8, 24))
        self.assertEqual(unknown["verdict"], "OBSERVE")
        self.assertEqual(unknown["attribution_level"], "UNKNOWN")

        incomplete_artifact = legacy_gfa_artifact("CT-legacy-gfa-incomplete")
        add_publish_link(self.db, artifact_id=incomplete_artifact.artifact_id, published_url="https://gfa.example.com/cr-incomplete")
        bind_gfa_creative(self.db, artifact_id=incomplete_artifact.artifact_id, creative_id="cr-incomplete")
        seed_gfa_rows("cr-incomplete", obs_clicks=25, obs_impressions=1000, obs_days=1)
        incomplete = attribute_gfa_performance(self.db, artifact_id=incomplete_artifact.artifact_id, as_of=date(2026, 8, 24))
        self.assertEqual(incomplete["verdict"], "OBSERVE")

        low_sample_artifact = legacy_gfa_artifact("CT-legacy-gfa-low")
        add_publish_link(self.db, artifact_id=low_sample_artifact.artifact_id, published_url="https://gfa.example.com/cr-low")
        bind_gfa_creative(self.db, artifact_id=low_sample_artifact.artifact_id, creative_id="cr-low")
        seed_gfa_rows("cr-low", obs_clicks=5, obs_impressions=100)
        low_sample = attribute_gfa_performance(self.db, artifact_id=low_sample_artifact.artifact_id, as_of=date(2026, 8, 24))
        self.assertEqual(low_sample["verdict"], "OBSERVE")

    def test_gfa_brief_receives_appeal_lineage(self) -> None:
        from content_center_engine import apply_appeal_to_gfa_brief, get_appeal, run_insight_engine
        from content_center_scope import sync_content_sku_scope
        from db import ContentAppealPoint

        sync_content_sku_scope(self.db)
        self.db.add(
            NaverReviewRaw(
                review_key="rv-gfa",
                product_url=self.henna_url,
                product_id_catalog=4743750201,
                review_text="새치 때문에 자주 염색해야 해서 부담입니다.",
                review_written_at=date(2026, 8, 20),
            )
        )
        self.db.commit()
        run_insight_engine(self.db, phase1_only=True)
        appeal_row = self.db.query(ContentAppealPoint).filter(ContentAppealPoint.sku_id == "4743750201").first()
        appeal = get_appeal(self.db, appeal_row.appeal_id)
        brief = apply_appeal_to_gfa_brief({"goal": "click"}, appeal)
        self.assertEqual(brief["generation_source"], "appeal")
        self.assertEqual(brief["appeal_point_id"], appeal["appeal_id"])
        self.assertIn("소구", brief["copy_elements"])


if __name__ == "__main__":
    unittest.main()
