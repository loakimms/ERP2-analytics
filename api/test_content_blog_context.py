from __future__ import annotations

import inspect
import json
import os
import tempfile
import unittest
from sqlalchemy.orm import Session

from db import (
    ContentAppealEvidence,
    ContentAppealPoint,
    ContentArtifact,
    ContentClaimPolicy,
    ContentInsight,
    ContentReviewEvent,
    ContentSkuAsset,
    ContentSkuScope,
    SessionLocal,
    init_db,
)


class BlogGenerationContextTest(unittest.TestCase):
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
        for model in (
            ContentReviewEvent,
            ContentArtifact,
            ContentSkuAsset,
            ContentAppealEvidence,
            ContentAppealPoint,
            ContentInsight,
            ContentSkuScope,
            ContentClaimPolicy,
        ):
            self.db.query(model).delete()
        self.db.commit()
        self.henna_url = "https://smartstore.naver.com/thesujata/products/4743750201"

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

    def _scope(self) -> None:
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
        self.db.commit()

    def _full_appeal(self, *, snippet: str = "집에서 새치 관리가 편하고 색감이 자연스러워요") -> dict:
        from content_center_assets import content_asset_path

        insight = ContentInsight(
            insight_id="IN-full",
            sku_id="4743750201",
            theme_key="gray-hair-routine",
            problem="집에서 새치 관리를 부담 없이 이어가고 싶다",
            desire="자연스러운 색감으로 반복 관리하고 싶다",
            barrier="사용 전후 과정이 복잡할까 걱정된다",
            motivation="준비와 사용법을 미리 알고 싶다",
            usage_situation="집에서 혼자 관리",
            customer_language_json=json.dumps(["새치 관리가 편해요", "색감이 자연스러워요"], ensure_ascii=False),
            trend="new",
        )
        appeal = ContentAppealPoint(
            appeal_id="AP-full",
            sku_id="4743750201",
            insight_id=insight.insight_id,
            theme_key="gray-hair-routine",
            label="집에서 이어가는 새치 관리",
            appeal_text="사용 전후 루틴을 알면 첫 사용 부담이 줄어듭니다",
            status="ACTIVE",
            overall_score=80,
        )
        evidence = ContentAppealEvidence(
            evidence_id="EV-full",
            appeal_id=appeal.appeal_id,
            sku_id=appeal.sku_id,
            source_type="review",
            source_pk="rv-full",
            snippet=snippet,
            metric_json=json.dumps({"evidence_class": "CUSTOMER_LANGUAGE"}, ensure_ascii=False),
        )
        upload_path = content_asset_path("uploaded-product.png")
        with open(upload_path, "wb") as handle:
            handle.write(b"uploaded-product")
        product_asset = ContentSkuAsset(
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
        detail_asset = ContentSkuAsset(
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
            analysis_json=json.dumps(
                {
                    "usp": ["은은한 색감"],
                    "ingredients_or_components": ["헤나 분말"],
                    "usage_steps": ["분말과 물을 섞어 사용"],
                    "proof_points": ["상세페이지 사용 순서 안내"],
                    "copy_constraints": ["치료 표현 금지"],
                    "compliance_risks": ["의학적 효능 단정 금지"],
                },
                ensure_ascii=False,
            ),
        )
        self.db.add_all([insight, appeal, evidence, product_asset, detail_asset])
        self.db.commit()
        from content_center_engine import get_appeal

        loaded = get_appeal(self.db, appeal.appeal_id)
        assert loaded is not None
        return loaded

    def test_full_source_preserves_facts_and_provenance(self) -> None:
        from content_blog_context import (
            FACT_CLASS_GENERAL_KNOWLEDGE,
            FACT_CLASS_INFERENCE,
            FACT_CLASS_PRODUCT_SOURCE,
            SOURCE_DETAIL_PAGE,
            SOURCE_PRODUCT,
            SOURCE_REVIEW,
            STATUS_PENDING_ANALYSIS,
            build_blog_generation_context,
        )
        from content_writer_service import build_generation_context

        self._scope()
        appeal = self._full_appeal()
        base = build_generation_context(self.db, appeal=appeal, channel="blog", sku_title="수자타 헤나 염색약")
        blog = build_blog_generation_context(self.db, base_context=base, appeal=appeal)

        self.assertEqual(blog["version"], "blog_generation_context_v1")
        self.assertEqual(blog["topic"], "집에서 이어가는 새치 관리")
        self.assertEqual(blog["category"], "UNKNOWN")
        self.assertEqual(blog["audienceProblem"], "집에서 새치 관리를 부담 없이 이어가고 싶다")
        self.assertIsNone(blog["searchContext"]["knownUserIntent"])
        self.assertEqual(blog["searchContext"]["intentStatus"], STATUS_PENDING_ANALYSIS)
        self.assertFalse(blog["generationPolicy"]["allowGeneralKnowledge"])
        self.assertTrue(blog["generationPolicy"]["seoCannotOverrideFact"])

        product_source_facts = [item for item in blog["sourceFacts"] if item["sourceType"] == SOURCE_PRODUCT]
        detail_facts = [item for item in blog["sourceFacts"] if item["sourceType"] == SOURCE_DETAIL_PAGE]
        self.assertGreaterEqual(len(product_source_facts), 1)
        self.assertGreaterEqual(len(detail_facts), 1)
        self.assertTrue(any("수자타 헤나 염색약" in item["statement"] for item in blog["productFacts"]))
        self.assertTrue(any(item["statement"] == "헤나 분말" for item in blog["sourceFacts"]))
        self.assertTrue(all(item["classification"] == FACT_CLASS_INFERENCE for item in detail_facts))
        self.assertTrue(all(item["provenance"]["derived"] is True for item in detail_facts))
        self.assertFalse(any(item["classification"] == FACT_CLASS_GENERAL_KNOWLEDGE for item in blog["sourceFacts"]))
        self.assertFalse(any(item["classification"] == FACT_CLASS_INFERENCE and item["sourceType"] == SOURCE_PRODUCT for item in blog["sourceFacts"]))
        self.assertTrue(any(item["classification"] == FACT_CLASS_PRODUCT_SOURCE for item in blog["productFacts"]))

        self.assertEqual(blog["evidence"][0]["sourceType"], SOURCE_REVIEW)
        self.assertEqual(blog["evidence"][0]["evidenceId"], "EV-full")
        self.assertEqual(blog["evidence"][0]["provenance"]["sourceId"], "EV-full")
        title_fact = next(item for item in blog["productFacts"] if item["provenance"]["sourceField"] == "title")
        self.assertEqual(title_fact["provenance"]["sourceId"], "4743750201")
        self.assertFalse(title_fact["provenance"]["derived"])

        self.assertTrue(blog["allowedClaims"])
        self.assertTrue(any("수자타 헤나 염색약" in item["claim"] for item in blog["allowedClaims"]))
        unknown_fields = {item["field"] for item in blog["unknowns"]}
        self.assertIn("searchContext.knownUserIntent", unknown_fields)
        self.assertNotIn("audienceProblem", unknown_fields)
        self.assertTrue(any(item["assetId"] == "CA-detail-analyzed" for item in blog["availableImages"]))
        self.assertTrue(any(item["assetId"] == "CA-uploaded-product" for item in blog["availableImages"]))
        self.assertEqual(blog["internalLinkCandidates"], [])

    def test_sparse_source_records_unknowns_without_guessing(self) -> None:
        from content_blog_context import (
            FACT_CLASS_GENERAL_KNOWLEDGE,
            STATUS_PENDING_ANALYSIS,
            STATUS_UNKNOWN,
            build_blog_generation_context,
        )

        appeal = {
            "sku_id": "",
            "appeal_id": "",
            "label": "",
            "appeal_text": "",
            "evidence": [],
            "insight": {},
        }
        blog = build_blog_generation_context(self.db, appeal=appeal, sku_title="")
        unknown_fields = {item["field"]: item["reason"] for item in blog["unknowns"]}
        self.assertEqual(blog["targetAudience"]["status"], STATUS_UNKNOWN)
        self.assertIsNone(blog["targetAudience"]["primary"])
        self.assertIsNone(blog["searchContext"]["primaryKeyword"])
        self.assertEqual(blog["searchContext"]["relatedKeywords"], [])
        self.assertEqual(blog["searchContext"]["intentStatus"], STATUS_PENDING_ANALYSIS)
        self.assertEqual(blog["category"], STATUS_UNKNOWN)
        self.assertEqual(blog["brandFacts"], [])
        self.assertEqual(blog["evidence"], [])
        self.assertEqual(blog["availableImages"], [])
        self.assertEqual(blog["commercialDisclosure"]["status"], STATUS_UNKNOWN)
        self.assertIsNone(blog["commercialDisclosure"]["required"])
        self.assertFalse(any(item["classification"] == FACT_CLASS_GENERAL_KNOWLEDGE for item in blog["sourceFacts"]))
        self.assertIn("targetAudience.primary", unknown_fields)
        self.assertIn("searchContext.knownUserIntent", unknown_fields)
        self.assertIn("brandFacts", unknown_fields)
        self.assertNotIn("30~40대", json.dumps(blog, ensure_ascii=False))
        self.assertNotIn("민감성 두피", json.dumps(blog, ensure_ascii=False))

    def test_restricted_claims_are_separated_from_supported_facts(self) -> None:
        from content_blog_context import CLAIM_STATUS_FORBIDDEN, CLAIM_STATUS_SUPPORTED, build_blog_generation_context
        from content_writer_service import build_generation_context

        self._scope()
        appeal = self._full_appeal(snippet="탈모가 줄었다는 말은 없지만 색감은 자연스러워요")
        base = build_generation_context(self.db, appeal=appeal, channel="blog", sku_title="수자타 헤나 염색약")
        blog = build_blog_generation_context(self.db, base_context=base, appeal=appeal)

        restricted_terms = {item["term"]: item for item in blog["restrictedClaims"]}
        self.assertIn("탈모", restricted_terms)
        self.assertIn("치료", restricted_terms)
        self.assertEqual(restricted_terms["탈모"]["policySource"], "existing_claim_gate")
        self.assertEqual(restricted_terms["탈모"]["status"], CLAIM_STATUS_FORBIDDEN)
        self.assertTrue(restricted_terms["탈모"]["matchedInSource"])
        self.assertTrue(any(item.get("policySource") == "detail_page_analysis" for item in blog["restrictedClaims"]))

        allowed_text = " ".join(item["claim"] for item in blog["allowedClaims"])
        self.assertIn("수자타 헤나 염색약", allowed_text)
        self.assertNotIn("탈모", allowed_text)
        self.assertTrue(all(item["status"] == CLAIM_STATUS_SUPPORTED for item in blog["allowedClaims"]))
        evidence_text = " ".join(item["statement"] for item in blog["evidence"])
        self.assertIn("탈모", evidence_text)

    def test_instagram_and_shorts_writer_path_unchanged(self) -> None:
        from content_center_generate import generate_artifact
        from content_writer_service import build_generation_context, write_channel_content

        self._scope()
        appeal = self._full_appeal()
        instagram_ctx = build_generation_context(self.db, appeal=appeal, channel="instagram", sku_title="수자타 헤나 염색약")
        shorts_ctx = build_generation_context(self.db, appeal=appeal, channel="shorts", sku_title="수자타 헤나 염색약")
        self.assertNotIn("sourceFacts", instagram_ctx)
        self.assertNotIn("generationPolicy", instagram_ctx)
        self.assertNotIn("sourceFacts", shorts_ctx)
        self.assertEqual(instagram_ctx["channel"], "instagram")
        self.assertEqual(shorts_ctx["channel"], "shorts")

        instagram_payload = write_channel_content(self.db, context=instagram_ctx)
        shorts_payload = write_channel_content(self.db, context=shorts_ctx)
        self.assertEqual(instagram_payload["format"], "instagram_carousel_v1")
        self.assertEqual(shorts_payload["format"], "shorts_scene_timeline_v1")
        self.assertNotIn("blog_generation", instagram_payload)
        self.assertNotIn("blog_generation", shorts_payload)
        self.assertGreaterEqual(len(instagram_payload["slides"]), 7)
        self.assertGreaterEqual(len(shorts_payload["shorts"]["scenes"]), 4)

        instagram = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="instagram", sku_title="수자타 헤나 염색약")
        shorts = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="shorts", sku_title="수자타 헤나 염색약")
        instagram_body = json.loads(instagram.body_json or "{}")
        shorts_body = json.loads(shorts.body_json or "{}")
        self.assertEqual(instagram_body.get("generation_version"), "v1")
        self.assertEqual(shorts_body.get("generation_version"), "v1")
        self.assertNotIn("blog_generation", instagram_body)
        self.assertNotIn("blog_generation", shorts_body)

        import content_center_generate
        import content_writer_service

        self.assertNotIn("content_blog_context", inspect.getsource(content_writer_service))
        self.assertNotIn("content_blog_context", inspect.getsource(content_center_generate))

    def test_blog_v1_writer_path_unchanged(self) -> None:
        from content_center_generate import generate_artifact

        self._scope()
        appeal = self._full_appeal()
        blog = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="blog", sku_title="수자타 헤나 염색약")
        body = json.loads(blog.body_json or "{}")
        self.assertEqual(body["generation_engine"], "LLM_WRITER_V1")
        self.assertEqual(body.get("generation_version"), "v1")
        self.assertNotIn("blog_generation", body)
        self.assertIn("blog", body)
        self.assertGreaterEqual(len(body["blog"]["sections"]), 3)

    def test_blog_generation_context_json_serializes(self) -> None:
        from content_blog_context import build_blog_generation_context, serialize_blog_generation_context

        self._scope()
        appeal = self._full_appeal()
        blog = build_blog_generation_context(self.db, appeal=appeal, sku_title="수자타 헤나 염색약")
        encoded = serialize_blog_generation_context(blog)
        decoded = json.loads(encoded)
        self.assertEqual(decoded["version"], "blog_generation_context_v1")
        self.assertIn("sourceFacts", decoded)
        self.assertIn("provenance", decoded)
        json.dumps(blog, ensure_ascii=False)

    def test_known_blocker_ledger_is_recorded(self) -> None:
        from content_blog_context import blog_v2_known_blockers

        ids = {item["id"] for item in blog_v2_known_blockers()}
        self.assertIn("MOBILE_PARAGRAPH_BREAK_COLLAPSE_BY_CLEAN_TEXT", ids)
        self.assertIn("TITLE_CANDIDATES_DROPPED_DURING_NORMALIZATION", ids)
        self.assertIn("BLOG_V1_HARD_LENGTH_VALIDATION_INCOMPATIBLE_WITH_V2", ids)
        phases = {item["id"]: item["targetPhase"] for item in blog_v2_known_blockers()}
        self.assertEqual(phases["MOBILE_PARAGRAPH_BREAK_COLLAPSE_BY_CLEAN_TEXT"], "PHASE_4")
        self.assertEqual(phases["TITLE_CANDIDATES_DROPPED_DURING_NORMALIZATION"], "PHASE_4")
        self.assertEqual(phases["BLOG_V1_HARD_LENGTH_VALIDATION_INCOMPATIBLE_WITH_V2"], "PHASE_5")
        self.assertIn("LIVE_BLOG_V2_PLANNER_WRITER_END_TO_END_NOT_YET_VERIFIED", ids)
        self.assertIn("BLOG_V2_HITL_END_TO_END_REAL_SAMPLE_NOT_YET_VERIFIED", ids)
        self.assertIn("HUMAN_EDIT_REVALIDATION_PATH_MISSING", ids)
        statuses = {item["id"]: item["status"] for item in blog_v2_known_blockers()}
        self.assertEqual(statuses["BLOG_V1_HARD_LENGTH_VALIDATION_INCOMPATIBLE_WITH_V2"], "RESOLVED_IN_BLOG_V2_VALIDATOR")
        self.assertEqual(statuses["HUMAN_EDIT_REVALIDATION_PATH_MISSING"], "RESOLVED_IN_BLOG_V2_HUMAN_EDIT_REVALIDATION_ADAPTER_V1")
        self.assertEqual(statuses["LIVE_BLOG_V2_PLANNER_WRITER_END_TO_END_NOT_YET_VERIFIED"], "PRODUCTION_ACTIVATION_BLOCKER")
        from content_blog_context import blog_v2_known_limitations

        limitation_ids = {item["id"] for item in blog_v2_known_limitations()}
        self.assertIn("SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED", limitation_ids)
        self.assertIn("SEMANTIC_GENERAL_KNOWLEDGE_EXCLUSION_NOT_FULLY_VERIFIED", limitation_ids)
        self.assertIn("LIVE_BLOG_V2_PLANNER_WRITER_END_TO_END_NOT_YET_VERIFIED", limitation_ids)
        self.assertIn("IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED", limitation_ids)
        self.assertIn("IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED", limitation_ids)
        limitations = {item["id"]: item for item in blog_v2_known_limitations()}
        for code in (
            "SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED",
            "SEMANTIC_GENERAL_KNOWLEDGE_EXCLUSION_NOT_FULLY_VERIFIED",
            "IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED",
            "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED",
        ):
            self.assertEqual(limitations[code]["status"], "KNOWN_LIMITATION")
            self.assertEqual(limitations[code]["hitlPath"], "HITL_PATH_IMPLEMENTED")
            self.assertEqual(limitations[code]["finalVerificationTarget"], "PHASE_8")
        self.assertEqual(limitations["BLOG_V2_HITL_END_TO_END_REAL_SAMPLE_NOT_YET_VERIFIED"]["status"], "PRODUCTION_ACTIVATION_BLOCKER")
        self.assertEqual(statuses["BLOG_V2_HITL_END_TO_END_REAL_SAMPLE_NOT_YET_VERIFIED"], "PRODUCTION_ACTIVATION_BLOCKER")
