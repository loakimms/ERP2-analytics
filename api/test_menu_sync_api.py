import io
import json
import os
import unittest
import zipfile
import hashlib
from datetime import datetime

from fastapi.testclient import TestClient

import main
from db import (
    CommerceQnaAnalysis,
    CommerceQnaAnalysisIssueTag,
    CommerceQnaAnalysisKeyword,
    CommerceQnaDraft,
    CommerceQnaDraftValidation,
    CommerceQnaFeedbackKnowledge,
    CommerceQnaRaw,
    CommerceQnaSubmitLog,
    CollectionJobEvent,
    CollectionJobRun,
    NaverReviewRaw,
    NaverReviewReplyRaw,
    NaverProductRankDaily,
    ReviewReplyDraft,
    ReviewReplyFeedbackKnowledge,
    SessionLocal,
    TrackedProductAutoKeyword,
    TrackedProductIndexManual,
    TrackedProductIndexScoreDaily,
    TrackedProductKeyword,
    TrackedProductManualKeyword,
    TrackedProductMeta,
    TrackedProductPageDaily,
    TrackedProductRankDaily,
    TrackedProductSalesManual,
    init_db,
)
from menu_sync_collection import collection_sync_required_files


class TestMenuSyncApi(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["REQUIRE_FIREBASE_AUTH"] = "1"
        os.environ["AUTH_TEST_MODE"] = "1"
        os.environ["FIREBASE_PROJECT_ID"] = "test-project"
        init_db()
        self.client = TestClient(main.app)
        self._clear_qna_tables()
        self._seed_qna_tables()
        self._clear_review_tables()
        self._seed_review_tables()
        self._clear_tracking_tables()
        self._seed_tracking_tables()
        self._clear_collection_jobs()

    def tearDown(self) -> None:
        for key in ("REQUIRE_FIREBASE_AUTH", "AUTH_TEST_MODE", "FIREBASE_PROJECT_ID"):
            try:
                os.environ.pop(key, None)
            except Exception:
                pass

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": "Bearer test-ops_admin"}

    def _clear_collection_jobs(self) -> None:
        with SessionLocal() as db:
            db.query(CollectionJobEvent).delete(synchronize_session=False)
            db.query(CollectionJobRun).delete(synchronize_session=False)
            db.commit()

    def _clear_qna_tables(self) -> None:
        with SessionLocal() as db:
            db.query(CommerceQnaAnalysisIssueTag).delete(synchronize_session=False)
            db.query(CommerceQnaAnalysisKeyword).delete(synchronize_session=False)
            db.query(CommerceQnaAnalysis).delete(synchronize_session=False)
            db.query(CommerceQnaSubmitLog).delete(synchronize_session=False)
            db.query(CommerceQnaDraftValidation).delete(synchronize_session=False)
            db.query(CommerceQnaFeedbackKnowledge).delete(synchronize_session=False)
            db.query(CommerceQnaDraft).delete(synchronize_session=False)
            db.query(CommerceQnaRaw).delete(synchronize_session=False)
            db.commit()

    def _seed_qna_tables(self) -> None:
        now = datetime(2026, 4, 7, 12, 34, 56)
        with SessionLocal() as db:
            db.add(
                CommerceQnaRaw(
                    qna_key="customer:1001",
                    qna_kind="customer",
                    external_inquiry_id="1001",
                    title="배송 문의",
                    category="배송",
                    inquiry_text="언제 출고되나요?",
                    inquiry_registered_at=now,
                    answered=True,
                    answer_text="오늘 출고 예정입니다.",
                    answer_content_id="answer-1001",
                    product_name="테스트 샴푸",
                    customer_name="홍길동",
                    raw_payload_json=json.dumps({"source": "seed", "id": "1001"}, ensure_ascii=False),
                )
            )
            db.add(
                CommerceQnaDraft(
                    draft_id="draft-1001",
                    qna_key="customer:1001",
                    status="submitted",
                    draft_text="오늘 출고 예정입니다.",
                    model_name="gpt-test",
                    prompt_version="commerce_qna_v1",
                )
            )
            db.add(
                CommerceQnaDraftValidation(
                    draft_id="draft-1001",
                    qna_key="customer:1001",
                    check_status="passed",
                    initial_issues_json=json.dumps([], ensure_ascii=False),
                    final_issues_json=json.dumps([], ensure_ascii=False),
                )
            )
            db.add(
                CommerceQnaSubmitLog(
                    submit_id="submit-1001",
                    qna_key="customer:1001",
                    draft_id="draft-1001",
                    qna_kind="customer",
                    request_method="POST",
                    request_path="/v1/pay-merchant/inquiries/1001/answer",
                    request_body_json=json.dumps({"answerComment": "오늘 출고 예정입니다."}, ensure_ascii=False),
                    response_status_code=200,
                    response_body_json=json.dumps({"ok": True}, ensure_ascii=False),
                    remote_answer_content_id="answer-1001",
                    success=True,
                )
            )
            db.add(
                CommerceQnaFeedbackKnowledge(
                    knowledge_id="knowledge-1001",
                    source_draft_id="draft-1001",
                    status="active",
                    qna_kind="customer",
                    category="배송",
                    problem_summary="배송 일정 표현은 확정적으로 쓰지 않는다.",
                    bad_pattern="무조건 내일 도착",
                    prevention_rule="확정 표현 대신 예정/안내 기준으로 표현",
                    example_fix="현재 확인된 출고 예정일 기준으로 안내드립니다.",
                )
            )
            db.add(
                CommerceQnaAnalysis(
                    analysis_id="analysis-1001",
                    qna_key="customer:1001",
                    qna_kind="customer",
                    inquiry_type="배송문의",
                    purchase_stage="구매직전",
                    sentiment="NEUTRAL",
                    conversion_impact_level="HIGH",
                    conversion_impact_score=88.0,
                    summary_text="배송 일정 확인 문의",
                    recommended_action="출고 기준을 명확히 안내",
                    model_name="rules",
                    pipeline_version="qna_expert_analysis_v1",
                    llm_used=False,
                )
            )
            db.add(
                CommerceQnaAnalysisKeyword(
                    qna_key="customer:1001",
                    keyword="출고",
                    keyword_type="intent",
                    weight=1.0,
                )
            )
            db.add(
                CommerceQnaAnalysisIssueTag(
                    qna_key="customer:1001",
                    issue_tag="DELIVERY",
                    severity="MEDIUM",
                )
            )
            db.commit()

    def _clear_review_tables(self) -> None:
        with SessionLocal() as db:
            db.query(ReviewReplyFeedbackKnowledge).delete(synchronize_session=False)
            db.query(ReviewReplyDraft).delete(synchronize_session=False)
            db.query(NaverReviewReplyRaw).delete(synchronize_session=False)
            db.query(NaverReviewRaw).delete(synchronize_session=False)
            db.commit()

    def _seed_review_tables(self) -> None:
        now = datetime(2026, 4, 3, 9, 9, 48)
        with SessionLocal() as db:
            db.add(
                NaverReviewRaw(
                    review_key="review:1001",
                    product_url="https://smartstore.naver.com/example/products/1001",
                    product_title="테스트 샴푸",
                    product_id_catalog=1001,
                    review_id_original="rv-1001",
                    review_written_at=now.date(),
                    rating=5.0,
                    option_text="500ml",
                    review_text="향이 좋고 만족합니다.",
                    reviewer_masked_id="ab***",
                    text_hash="hash-1001",
                    import_source="seed",
                    reply_exists_flag=True,
                    reply_collect_status="done",
                    raw_payload_json=json.dumps({"source": "seed", "id": "rv-1001"}, ensure_ascii=False),
                    collected_at=now,
                    updated_at=now,
                )
            )
            db.add(
                NaverReviewReplyRaw(
                    review_key="review:1001",
                    reply_text="구매해 주셔서 감사합니다.",
                    reply_written_at=now.date(),
                    raw_payload_json=json.dumps({"replyId": "reply-1001"}, ensure_ascii=False),
                    collected_at=now,
                    updated_at=now,
                )
            )
            db.add(
                ReviewReplyDraft(
                    draft_id="review-draft-1001",
                    review_key="review:1001",
                    status="approved",
                    draft_text="구매해 주셔서 감사합니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                    style_level=3,
                    style_preset_id="balanced",
                    style_controls_json=json.dumps({"gratitude_intensity": 3}, ensure_ascii=False),
                    generated_at=now,
                    updated_at=now,
                )
            )
            db.add(
                ReviewReplyFeedbackKnowledge(
                    knowledge_id="review-knowledge-1001",
                    source_draft_id="review-draft-1001",
                    status="active",
                    problem_type="tone",
                    problem_summary="감사 표현은 유지",
                    bad_pattern="감사 표현 누락",
                    prevention_rule="답글 첫 문장에 감사 표현 포함",
                    example_fix="구매해 주셔서 감사합니다.",
                    created_at=now,
                    updated_at=now,
                )
            )
            db.commit()

    def _clear_tracking_tables(self) -> None:
        with SessionLocal() as db:
            db.query(TrackedProductIndexScoreDaily).delete(synchronize_session=False)
            db.query(TrackedProductRankDaily).delete(synchronize_session=False)
            db.query(TrackedProductPageDaily).delete(synchronize_session=False)
            db.query(NaverProductRankDaily).delete(synchronize_session=False)
            db.query(TrackedProductIndexManual).delete(synchronize_session=False)
            db.query(TrackedProductSalesManual).delete(synchronize_session=False)
            db.query(TrackedProductAutoKeyword).delete(synchronize_session=False)
            db.query(TrackedProductManualKeyword).delete(synchronize_session=False)
            db.query(TrackedProductKeyword).delete(synchronize_session=False)
            db.query(TrackedProductMeta).delete(synchronize_session=False)
            db.commit()

    def _seed_tracking_tables(self) -> None:
        day1 = datetime(2026, 1, 2, 8, 0, 0)
        day2 = datetime(2026, 1, 3, 8, 0, 0)
        product_url = "https://smartstore.naver.com/example/products/1001"
        with SessionLocal() as db:
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    keyword="탈모샴푸",
                    title="테스트 샴푸",
                    mall_name="테스트몰",
                    image_url="https://example.com/item.png",
                    price=19900,
                    product_id_catalog=1001,
                    category1="뷰티",
                    category2="헤어",
                    tracking_mode="focus",
                    created_at=day1,
                    updated_at=day2,
                )
            )
            db.add(
                TrackedProductKeyword(
                    product_url=product_url,
                    keyword="탈모샴푸",
                    monthly_search_volume=12000,
                    is_active=True,
                    created_at=day1,
                )
            )
            db.add(
                TrackedProductManualKeyword(
                    product_url=product_url,
                    keyword="탈모 샴푸 추천",
                    monthly_search_volume=3400,
                    monthly_search_volume_label="3400",
                    is_active=True,
                    created_at=day1,
                    updated_at=day2,
                )
            )
            db.add(
                TrackedProductAutoKeyword(
                    product_url=product_url,
                    keyword="탈모샴푸",
                    group_type="core",
                    is_active=True,
                    created_at=day1,
                    updated_at=day2,
                )
            )
            db.add(
                TrackedProductSalesManual(
                    product_url=product_url,
                    expected_sales_7d=12,
                    expected_revenue_7d_manwon=23,
                    recent_purchase_1w_count=11,
                    recent_repurchase_3m_count=4,
                    updated_at=day2,
                )
            )
            db.add(
                TrackedProductIndexManual(
                    product_url=product_url,
                    weekly_views_7d=250,
                    wishes=32,
                    sales_7d_override=12,
                    sales_30d=48,
                    days_since_reg=45,
                    delay_count=0,
                    sold_out_days=1,
                    updated_at=day2,
                )
            )
            db.add(
                TrackedProductPageDaily(
                    date=day1.date(),
                    product_url=product_url,
                    title="테스트 샴푸",
                    price=19900,
                    review_count=120,
                    rating=4.8,
                    wish_count=31,
                    recent_purchase_7d_count=9,
                    recent_repurchase_3m_count=3,
                    recent_purchase_status="collected",
                    http_status=200,
                )
            )
            db.add(
                TrackedProductPageDaily(
                    date=day2.date(),
                    product_url=product_url,
                    title="테스트 샴푸",
                    price=19900,
                    review_count=121,
                    rating=4.8,
                    wish_count=32,
                    recent_purchase_7d_count=10,
                    recent_repurchase_3m_count=4,
                    recent_purchase_status="collected",
                    http_status=200,
                )
            )
            db.add(
                TrackedProductRankDaily(
                    date=day1.date(),
                    product_url=product_url,
                    keyword="탈모샴푸",
                    rank=3,
                    source="openapi",
                    created_at=day1,
                    updated_at=day1,
                )
            )
            db.add(
                TrackedProductRankDaily(
                    date=day2.date(),
                    product_url=product_url,
                    keyword="탈모샴푸",
                    rank=2,
                    source="openapi",
                    created_at=day2,
                    updated_at=day2,
                )
            )
            db.add(
                NaverProductRankDaily(
                    date=day1.date(),
                    keyword="탈모샴푸",
                    rank=3,
                    product_title="테스트 샴푸",
                    mall_name="테스트몰",
                    price=19900,
                    purchase_cnt=120,
                    product_id=1001,
                    image_url="https://example.com/item.png",
                    brand="브랜드A",
                    maker="제조사A",
                    is_our_brand=True,
                    created_at=day1,
                )
            )
            db.add(
                NaverProductRankDaily(
                    date=day2.date(),
                    keyword="탈모샴푸",
                    rank=2,
                    product_title="테스트 샴푸",
                    mall_name="테스트몰",
                    price=19900,
                    purchase_cnt=121,
                    product_id=1001,
                    image_url="https://example.com/item.png",
                    brand="브랜드A",
                    maker="제조사A",
                    is_our_brand=True,
                    created_at=day2,
                )
            )
            db.add(
                TrackedProductIndexScoreDaily(
                    date=day2.date(),
                    product_url=product_url,
                    click_score=70,
                    sales_score=65,
                    review_score=80,
                    recency_score=55,
                    penalty_score=5,
                    final_score=73,
                    inputs_json=json.dumps({"wish": 32}, ensure_ascii=False),
                    created_at=day2,
                )
            )
            db.commit()

    def _export_bundle_response(self):
        return self.client.post(
            "/menu-sync/export",
            headers=self._auth_headers(),
            json={"menu_ids": ["review_qna"]},
        )

    def _export_bundle_bytes(self) -> bytes:
        res = self._export_bundle_response()
        self.assertEqual(res.status_code, 200, msg=res.text)
        self.assertTrue(str(res.headers.get("content-type") or "").startswith("application/zip"))
        return bytes(res.content)

    def _import_bundle(self, bundle_bytes: bytes):
        return self.client.post(
            "/menu-sync/import",
            headers=self._auth_headers(),
            files={
                "file": ("menu_sync_bundle.zip", bundle_bytes, "application/zip"),
            },
        )

    def _read_bundle_entries(self, bundle_bytes: bytes) -> dict[str, bytes]:
        with zipfile.ZipFile(io.BytesIO(bundle_bytes), "r") as zf:
            return {name: zf.read(name) for name in zf.namelist()}

    def _write_bundle_entries(self, entries: dict[str, bytes]) -> bytes:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, data in entries.items():
                zf.writestr(name, data)
        return out.getvalue()

    def _table_counts(self) -> dict[str, int]:
        with SessionLocal() as db:
            return {
                "commerce_qna_raw": db.query(CommerceQnaRaw).count(),
                "commerce_qna_draft": db.query(CommerceQnaDraft).count(),
                "commerce_qna_draft_validation": db.query(CommerceQnaDraftValidation).count(),
                "commerce_qna_submit_log": db.query(CommerceQnaSubmitLog).count(),
                "commerce_qna_feedback_knowledge": db.query(CommerceQnaFeedbackKnowledge).count(),
                "commerce_qna_analysis": db.query(CommerceQnaAnalysis).count(),
                "commerce_qna_analysis_keyword": db.query(CommerceQnaAnalysisKeyword).count(),
                "commerce_qna_analysis_issue_tag": db.query(CommerceQnaAnalysisIssueTag).count(),
                "naver_review_raw": db.query(NaverReviewRaw).count(),
                "naver_review_reply_raw": db.query(NaverReviewReplyRaw).count(),
                "review_reply_draft": db.query(ReviewReplyDraft).count(),
                "review_reply_feedback_knowledge": db.query(ReviewReplyFeedbackKnowledge).count(),
                "tracked_product_meta": db.query(TrackedProductMeta).count(),
                "tracked_product_keyword": db.query(TrackedProductKeyword).count(),
                "tracked_product_manual_keyword": db.query(TrackedProductManualKeyword).count(),
                "tracked_product_auto_keyword": db.query(TrackedProductAutoKeyword).count(),
                "tracked_product_sales_manual": db.query(TrackedProductSalesManual).count(),
                "tracked_product_index_manual": db.query(TrackedProductIndexManual).count(),
                "tracked_product_page_daily": db.query(TrackedProductPageDaily).count(),
                "tracked_product_rank_daily": db.query(TrackedProductRankDaily).count(),
                "naver_product_rank_daily": db.query(NaverProductRankDaily).count(),
                "tracked_product_index_score_daily": db.query(TrackedProductIndexScoreDaily).count(),
            }

    def test_menu_sync_menus_lists_review_qna(self) -> None:
        res = self.client.get("/menu-sync/menus", headers=self._auth_headers())
        self.assertEqual(res.status_code, 200, msg=res.text)
        body = res.json()
        items = body.get("menus") or []
        target = next((item for item in items if item.get("id") == "review_qna"), None)
        self.assertIsNotNone(target)
        self.assertEqual(target.get("label"), "리뷰 Q&A")
        self.assertEqual(target.get("status"), "active")
        review_target = next((item for item in items if item.get("id") == "review_reply"), None)
        self.assertIsNotNone(review_target)
        self.assertEqual(review_target.get("label"), "리뷰 관리")
        self.assertEqual(review_target.get("status"), "active")
        tracking_target = next((item for item in items if item.get("id") == "product_tracking"), None)
        self.assertIsNotNone(tracking_target)
        self.assertEqual(tracking_target.get("label"), "내 상품 추적")
        self.assertEqual(tracking_target.get("status"), "active")

    def test_collection_sync_required_files_cover_current_cdp_tables(self) -> None:
        self.assertIn(
            "menus/search_rank/ad_rank_diagnosis_daily.json",
            collection_sync_required_files("search_rank"),
        )
        self.assertIn(
            "menus/gfa_inventory/naver_gfa_creative_detail.json",
            collection_sync_required_files("gfa_inventory"),
        )

    def test_menu_sync_inventory_reports_tracking_dates(self) -> None:
        res = self.client.post(
            "/menu-sync/inventory",
            headers=self._auth_headers(),
            json={"menu_id": "product_tracking", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        body = res.json()
        self.assertEqual(body["menu_id"], "product_tracking")
        table = next(item for item in body["tables"] if item["table_name"] == "tracked_product_rank_daily")
        days = {item["date"]: item for item in table["days"]}
        self.assertEqual(days["2026-01-02"]["row_count"], 1)
        self.assertIn("https://smartstore.naver.com/example/products/1001|탈모샴푸", days["2026-01-02"]["keys"])

    def test_menu_sync_export_includes_product_tracking_files_for_selected_dates(self) -> None:
        res = self.client.post(
            "/menu-sync/export",
            headers=self._auth_headers(),
            json={"menu_ids": ["product_tracking"], "target_dates": ["2026-01-02"]},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        entries = self._read_bundle_entries(bytes(res.content))

        self.assertIn("menus/product_tracking/tracked_product_page_daily.json", entries)
        self.assertIn("menus/product_tracking/tracked_product_rank_daily.json", entries)
        self.assertIn("menus/product_tracking/naver_product_rank_daily.json", entries)
        self.assertIn("menus/product_tracking/tracked_product_meta.json", entries)

        manifest = json.loads(entries["manifest.json"].decode("utf-8"))
        self.assertEqual(manifest["menus"], ["product_tracking"])
        self.assertEqual(manifest["target_dates"], ["2026-01-02"])

        page_rows = json.loads(entries["menus/product_tracking/tracked_product_page_daily.json"].decode("utf-8"))
        self.assertEqual(len(page_rows), 1)
        self.assertEqual(page_rows[0]["date"], "2026-01-02")

        meta_rows = json.loads(entries["menus/product_tracking/tracked_product_meta.json"].decode("utf-8"))
        self.assertEqual(len(meta_rows), 1)

    def test_menu_sync_import_product_tracking_bundle_inserts_only_missing_rows(self) -> None:
        res = self.client.post(
            "/menu-sync/export",
            headers=self._auth_headers(),
            json={"menu_ids": ["product_tracking"], "target_dates": ["2026-01-02", "2026-01-03"]},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        bundle_bytes = bytes(res.content)

        self._clear_tracking_tables()
        with SessionLocal() as db:
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/example/products/1001",
                    keyword="탈모샴푸",
                    title="NAS 기존 메타",
                    product_id_catalog=1001,
                )
            )
            db.add(
                TrackedProductPageDaily(
                    date=datetime(2026, 1, 2).date(),
                    product_url="https://smartstore.naver.com/example/products/1001",
                    title="NAS 기존 값",
                    review_count=999,
                    rating=4.1,
                    wish_count=99,
                    recent_purchase_status="collected",
                    http_status=200,
                )
            )
            db.add(
                TrackedProductRankDaily(
                    date=datetime(2026, 1, 2).date(),
                    product_url="https://smartstore.naver.com/example/products/1001",
                    keyword="탈모샴푸",
                    rank=99,
                    source="nas-existing",
                )
            )
            db.commit()

        res_import = self._import_bundle(bundle_bytes)
        self.assertEqual(res_import.status_code, 200, msg=res_import.text)
        imported_tables = {
            item["table_name"]: item
            for item in res_import.json()["imported_tables"]
        }
        self.assertEqual(imported_tables["tracked_product_meta"]["row_count"], 0)
        self.assertEqual(imported_tables["tracked_product_meta"]["source_row_count"], 1)
        self.assertEqual(imported_tables["tracked_product_page_daily"]["row_count"], 1)
        self.assertEqual(imported_tables["tracked_product_page_daily"]["source_row_count"], 2)
        self.assertEqual(imported_tables["tracked_product_rank_daily"]["row_count"], 1)
        self.assertEqual(imported_tables["tracked_product_rank_daily"]["source_row_count"], 2)

        with SessionLocal() as db:
            existing_page = (
                db.query(TrackedProductPageDaily)
                .filter(
                    TrackedProductPageDaily.date == datetime(2026, 1, 2).date(),
                    TrackedProductPageDaily.product_url == "https://smartstore.naver.com/example/products/1001",
                )
                .one()
            )
            self.assertEqual(existing_page.title, "NAS 기존 값")
            self.assertEqual(existing_page.review_count, 999)

            inserted_page = (
                db.query(TrackedProductPageDaily)
                .filter(TrackedProductPageDaily.date == datetime(2026, 1, 3).date())
                .one()
            )
            self.assertEqual(inserted_page.review_count, 121)

            existing_rank = (
                db.query(TrackedProductRankDaily)
                .filter(TrackedProductRankDaily.date == datetime(2026, 1, 2).date())
                .one()
            )
            self.assertEqual(existing_rank.rank, 99)

            inserted_rank = (
                db.query(TrackedProductRankDaily)
                .filter(TrackedProductRankDaily.date == datetime(2026, 1, 3).date())
                .one()
            )
            self.assertEqual(inserted_rank.rank, 2)

            meta = db.query(TrackedProductMeta).one()
            self.assertEqual(meta.title, "NAS 기존 메타")

    def test_menu_sync_import_reflects_product_tracking_in_collection_status(self) -> None:
        res = self.client.post(
            "/menu-sync/export",
            headers=self._auth_headers(),
            json={"menu_ids": ["product_tracking"], "target_dates": ["2026-01-02", "2026-01-03"]},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        self._clear_tracking_tables()
        res_import = self._import_bundle(bytes(res.content))
        self.assertEqual(res_import.status_code, 200, msg=res_import.text)
        detail = json.loads(res_import.json()["detail"])
        reconciled_task_ids = {item["task_id"] for item in detail["collection_reconciled"]}
        self.assertIn("rank_openapi", reconciled_task_ids)
        self.assertIn("page_metrics_cdp", reconciled_task_ids)

        res_tasks = self.client.get("/collection/tasks", headers=self._auth_headers())
        self.assertEqual(res_tasks.status_code, 200, msg=res_tasks.text)
        tasks = {item["task_id"]: item for item in res_tasks.json()["tasks"]}
        rank_job = tasks["rank_openapi"]["latest_job"]
        page_job = tasks["page_metrics_cdp"]["latest_job"]
        self.assertEqual(rank_job["status"], "SUCCESS")
        self.assertEqual(rank_job["run_mode"], "menu_sync")
        self.assertEqual(rank_job["date_from"], "2026-01-02")
        self.assertEqual(rank_job["date_to"], "2026-01-03")
        self.assertTrue(rank_job["detail"]["db_persistence"]["completion_verified"])
        self.assertEqual(rank_job["detail"]["db_persistence"]["verification_reason"], "menu_sync_import")
        self.assertEqual(page_job["status"], "SUCCESS")
        self.assertEqual(page_job["run_mode"], "menu_sync")
        self.assertTrue(page_job["detail"]["db_persistence"]["completion_verified"])

    def test_menu_sync_export_includes_manifest_and_qna_files(self) -> None:
        bundle_bytes = self._export_bundle_bytes()
        entries = self._read_bundle_entries(bundle_bytes)

        self.assertIn("manifest.json", entries)
        self.assertIn("menus/review_qna/commerce_qna_raw.json", entries)
        self.assertIn("menus/review_qna/commerce_qna_analysis_issue_tag.json", entries)

        manifest = json.loads(entries["manifest.json"].decode("utf-8"))
        self.assertEqual(manifest["menus"], ["review_qna"])
        self.assertEqual(manifest["schema_version"], "menu_sync_bundle_v1")
        self.assertIn("checksums", manifest)
        self.assertIn("menus/review_qna/commerce_qna_raw.json", manifest["checksums"])

        raw_rows = json.loads(entries["menus/review_qna/commerce_qna_raw.json"].decode("utf-8"))
        self.assertEqual(len(raw_rows), 1)
        self.assertEqual(raw_rows[0]["qna_key"], "customer:1001")

    def test_menu_sync_export_includes_review_reply_files(self) -> None:
        res = self.client.post(
            "/menu-sync/export",
            headers=self._auth_headers(),
            json={"menu_ids": ["review_reply"]},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        entries = self._read_bundle_entries(bytes(res.content))

        self.assertIn("menus/review_reply/naver_review_raw.json", entries)
        self.assertIn("menus/review_reply/naver_review_reply_raw.json", entries)
        self.assertIn("menus/review_reply/review_reply_draft.json", entries)
        self.assertIn("menus/review_reply/review_reply_feedback_knowledge.json", entries)

        manifest = json.loads(entries["manifest.json"].decode("utf-8"))
        self.assertEqual(manifest["menus"], ["review_reply"])

        raw_rows = json.loads(entries["menus/review_reply/naver_review_raw.json"].decode("utf-8"))
        self.assertEqual(len(raw_rows), 1)
        self.assertEqual(raw_rows[0]["review_key"], "review:1001")

    def test_menu_sync_import_restores_review_tables_and_is_idempotent(self) -> None:
        res = self.client.post(
            "/menu-sync/export",
            headers=self._auth_headers(),
            json={"menu_ids": ["review_reply"]},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        bundle_bytes = bytes(res.content)
        expected_counts = self._table_counts()

        self._clear_review_tables()
        counts = self._table_counts()
        self.assertEqual(counts["naver_review_raw"], 0)
        self.assertEqual(counts["review_reply_draft"], 0)

        res1 = self._import_bundle(bundle_bytes)
        self.assertEqual(res1.status_code, 200, msg=res1.text)
        counts1 = self._table_counts()
        self.assertEqual(counts1["naver_review_raw"], expected_counts["naver_review_raw"])
        self.assertEqual(counts1["naver_review_reply_raw"], expected_counts["naver_review_reply_raw"])
        self.assertEqual(counts1["review_reply_draft"], expected_counts["review_reply_draft"])
        self.assertEqual(counts1["review_reply_feedback_knowledge"], expected_counts["review_reply_feedback_knowledge"])

        res2 = self._import_bundle(bundle_bytes)
        self.assertEqual(res2.status_code, 200, msg=res2.text)
        counts2 = self._table_counts()
        self.assertEqual(counts2["naver_review_raw"], expected_counts["naver_review_raw"])
        self.assertEqual(counts2["naver_review_reply_raw"], expected_counts["naver_review_reply_raw"])
        self.assertEqual(counts2["review_reply_draft"], expected_counts["review_reply_draft"])
        self.assertEqual(counts2["review_reply_feedback_knowledge"], expected_counts["review_reply_feedback_knowledge"])

    def test_menu_sync_import_review_bundle_replaces_scoped_reply_and_draft_state(self) -> None:
        res = self.client.post(
            "/menu-sync/export",
            headers=self._auth_headers(),
            json={"menu_ids": ["review_reply"]},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        entries = self._read_bundle_entries(bytes(res.content))

        raw_name = "menus/review_reply/naver_review_raw.json"
        reply_name = "menus/review_reply/naver_review_reply_raw.json"
        draft_name = "menus/review_reply/review_reply_draft.json"
        knowledge_name = "menus/review_reply/review_reply_feedback_knowledge.json"

        raw_rows = json.loads(entries[raw_name].decode("utf-8"))
        raw_rows[0]["reply_exists_flag"] = False
        raw_rows[0]["reply_collect_status"] = "pending"
        entries[raw_name] = json.dumps(raw_rows, ensure_ascii=False, indent=2).encode("utf-8")
        entries[reply_name] = json.dumps([], ensure_ascii=False, indent=2).encode("utf-8")
        entries[draft_name] = json.dumps([], ensure_ascii=False, indent=2).encode("utf-8")
        entries[knowledge_name] = json.dumps([], ensure_ascii=False, indent=2).encode("utf-8")

        manifest = json.loads(entries["manifest.json"].decode("utf-8"))
        for name in (raw_name, reply_name, draft_name, knowledge_name):
            manifest["checksums"][name] = hashlib.sha256(entries[name]).hexdigest()
        entries["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
        rewritten_bundle = self._write_bundle_entries(entries)

        res2 = self._import_bundle(rewritten_bundle)
        self.assertEqual(res2.status_code, 200, msg=res2.text)

        with SessionLocal() as db:
            raw_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == "review:1001").one()
            self.assertFalse(raw_row.reply_exists_flag)
            self.assertEqual(raw_row.reply_collect_status, "pending")
            self.assertEqual(db.query(NaverReviewReplyRaw).count(), 0)
            self.assertEqual(db.query(ReviewReplyDraft).count(), 0)
            self.assertEqual(db.query(ReviewReplyFeedbackKnowledge).count(), 0)

    def test_menu_sync_import_restores_qna_tables_and_is_idempotent(self) -> None:
        bundle_bytes = self._export_bundle_bytes()
        expected_counts = self._table_counts()

        self._clear_qna_tables()
        cleared_counts = self._table_counts()
        self.assertEqual(cleared_counts["commerce_qna_raw"], 0)
        self.assertEqual(cleared_counts["commerce_qna_draft"], 0)
        self.assertEqual(cleared_counts["commerce_qna_draft_validation"], 0)
        self.assertEqual(cleared_counts["commerce_qna_submit_log"], 0)
        self.assertEqual(cleared_counts["commerce_qna_feedback_knowledge"], 0)
        self.assertEqual(cleared_counts["commerce_qna_analysis"], 0)
        self.assertEqual(cleared_counts["commerce_qna_analysis_keyword"], 0)
        self.assertEqual(cleared_counts["commerce_qna_analysis_issue_tag"], 0)

        res1 = self._import_bundle(bundle_bytes)
        self.assertEqual(res1.status_code, 200, msg=res1.text)
        self.assertEqual(self._table_counts(), expected_counts)

        res2 = self._import_bundle(bundle_bytes)
        self.assertEqual(res2.status_code, 200, msg=res2.text)
        self.assertEqual(self._table_counts(), expected_counts)

    def test_menu_sync_import_rejects_checksum_mismatch(self) -> None:
        bundle_bytes = self._export_bundle_bytes()
        entries = self._read_bundle_entries(bundle_bytes)
        raw_name = "menus/review_qna/commerce_qna_raw.json"
        raw_rows = json.loads(entries[raw_name].decode("utf-8"))
        raw_rows[0]["inquiry_text"] = "조작된 본문"
        entries[raw_name] = json.dumps(raw_rows, ensure_ascii=False, indent=2).encode("utf-8")
        tampered_bundle = self._write_bundle_entries(entries)

        res = self._import_bundle(tampered_bundle)
        self.assertEqual(res.status_code, 400, msg=res.text)
        self.assertIn("checksum_mismatch", res.text)

    def test_menu_sync_import_rejects_missing_required_file(self) -> None:
        bundle_bytes = self._export_bundle_bytes()
        entries = self._read_bundle_entries(bundle_bytes)
        entries.pop("menus/review_qna/commerce_qna_draft.json", None)
        invalid_bundle = self._write_bundle_entries(entries)

        res = self._import_bundle(invalid_bundle)
        self.assertEqual(res.status_code, 400, msg=res.text)
        self.assertIn("missing_required_file", res.text)


if __name__ == "__main__":
    unittest.main()
