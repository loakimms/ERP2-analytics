from __future__ import annotations

import copy
import inspect
import json
import unittest

from content_blog_context import build_blog_generation_context
from content_blog_image_plan import plan_blog_images, serialize_blog_image_plan
from content_blog_planner import STATUS_PASS, plan_blog_content
from content_blog_validator import validate_blog_quality
from content_blog_writer import write_blog_professional_draft
from test_content_blog_context import BlogGenerationContextTest


class BlogImagePlanTest(unittest.TestCase):
    def setUp(self) -> None:
        self.harness = BlogGenerationContextTest("setUp")
        self.harness.setUp()
        self.db = self.harness.db

    def tearDown(self) -> None:
        self.harness.tearDown()

    def _full_bundle(self):
        self.harness._scope()
        appeal = self.harness._full_appeal()
        context = build_blog_generation_context(self.db, appeal=appeal, sku_title="수자타 헤나 염색약")
        planner = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(planner["status"], STATUS_PASS, planner["issues"])
        writer = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(writer["status"], "PASS", writer["issues"])
        quality = validate_blog_quality(
            self.db,
            blog_context=context,
            planner_result=planner,
            draft=writer["draft"],
            writer_result=writer,
        )
        return context, appeal, planner, writer, quality

    def _plan(self, context, planner, writer, quality, **kwargs):
        return plan_blog_images(
            blog_context=context,
            planner_result=planner,
            draft=writer["draft"],
            quality_report=quality,
            **kwargs,
        )

    def _item(self, result, section_id: str):
        for item in result["imagePlan"]["items"]:
            if item.get("sectionId") == section_id:
                return item
        self.fail(f"missing image plan item for {section_id}")

    def test_a_existing_asset_is_assigned(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        result = self._plan(context, planner, writer, quality)
        item = self._item(result, "S1")
        self.assertEqual(item["status"], "ASSIGNED")
        self.assertEqual(item["assetRef"], "CA-uploaded-product")
        self.assertEqual(item["sectionId"], "S1")
        self.assertIn(item["assetRef"], {image["assetId"] for image in context["availableImages"]})
        self.assertEqual(item["altGrounding"], "CONTEXT_GROUNDED_METADATA")

    def test_b_missing_process_asset_is_pending(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        result = self._plan(context, planner, writer, quality)
        item = self._item(result, "S2")
        self.assertIsNone(item["assetRef"])
        self.assertEqual(item["status"], "PENDING_ASSET")
        self.assertNotEqual(result["imagePlan"]["planStatus"], "HOLD")

    def test_c_infographic_is_generation_candidate_only(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        custom = copy.deepcopy(planner)
        custom["contentPlan"]["imageNeeds"] = [
            {"sectionId": "S2", "visualPurpose": "사용 순서 설명용 도식", "preferredSource": "INFOGRAPHIC_CANDIDATE", "status": "NEEDED"}
        ]
        result = plan_blog_images(blog_context=context, planner_result=custom, draft=writer["draft"], quality_report=quality)
        item = self._item(result, "S2")
        self.assertEqual(item["sourcePreference"], "INFOGRAPHIC_CANDIDATE")
        self.assertEqual(item["status"], "PENDING_GENERATION_REVIEW")
        self.assertTrue(item["generationCandidate"]["allowed"])
        blob = json.dumps(result["imagePlan"], ensure_ascii=False)
        self.assertNotIn("data:image/", blob)

    def test_d_evidence_image_requires_real_source(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        custom = copy.deepcopy(planner)
        custom["contentPlan"]["imageNeeds"] = [
            {"sectionId": "S1", "visualPurpose": "고객 사용 후기 사진", "preferredSource": "REAL_USAGE_IMAGE", "status": "NEEDED"}
        ]
        result = plan_blog_images(blog_context=context, planner_result=custom, draft=writer["draft"], quality_report=quality)
        item = self._item(result, "S1")
        self.assertEqual(item["status"], "PENDING_ASSET")
        self.assertFalse(item["generationCandidate"]["allowed"])
        self.assertIn("EVIDENCE_IMAGE_REQUIRES_REAL_SOURCE", item["riskNotes"])

    def test_e_invalid_asset_ref_is_hold(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        valid = self._plan(context, planner, writer, quality)
        raw = copy.deepcopy(valid["imagePlan"])
        raw["items"][0]["assetRef"] = "IMG_FAKE_999"
        raw["items"][0]["status"] = "ASSIGNED"
        result = self._plan(context, planner, writer, quality, raw_plan=raw)
        self.assertEqual(result["imagePlan"]["planStatus"], "HOLD")
        self.assertEqual(result["code"], "INVALID_IMAGE_ASSET_REFERENCE")

    def test_f_invalid_section_is_hold(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        valid = self._plan(context, planner, writer, quality)
        raw = copy.deepcopy(valid["imagePlan"])
        raw["items"][0]["sectionId"] = "S99"
        result = self._plan(context, planner, writer, quality, raw_plan=raw)
        self.assertEqual(result["imagePlan"]["planStatus"], "HOLD")
        self.assertEqual(result["code"], "INVALID_IMAGE_PLACEMENT_REFERENCE")

    def test_g_invalid_paragraph_index_is_hold(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        valid = self._plan(context, planner, writer, quality)
        raw = copy.deepcopy(valid["imagePlan"])
        raw["items"][0]["sectionId"] = "S2"
        raw["items"][0]["placement"] = {"position": "AFTER_PARAGRAPH", "paragraphIndex": 7}
        result = self._plan(context, planner, writer, quality, raw_plan=raw)
        self.assertEqual(result["imagePlan"]["planStatus"], "HOLD")
        self.assertEqual(result["code"], "INVALID_IMAGE_PLACEMENT_REFERENCE")
        self.assertEqual(len(writer["draft"]["sections"][1]["paragraphs"]), 3)

    def test_h_alt_keyword_stuffing_is_detected(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        valid = self._plan(context, planner, writer, quality)
        raw = copy.deepcopy(valid["imagePlan"])
        raw["items"][0]["altText"] = "헤나 염색 헤나염색 추천 헤나 새치염색 헤나 최고"
        result = self._plan(context, planner, writer, quality, raw_plan=raw)
        codes = {item["code"] for item in result["issues"]}
        self.assertIn("ALT_KEYWORD_STUFFING", codes)

    def test_i_unsupported_metadata_fact_is_hold(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        valid = self._plan(context, planner, writer, quality)
        raw = copy.deepcopy(valid["imagePlan"])
        raw["items"][0]["caption"] = "30분 숙성하면 발색이 더 좋아진다"
        result = self._plan(context, planner, writer, quality, raw_plan=raw)
        self.assertEqual(result["imagePlan"]["planStatus"], "HOLD")
        self.assertEqual(result["code"], "UNSUPPORTED_IMAGE_METADATA_FACT")

    def test_j_filename_suggestions_are_safe_and_unique(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        result = self._plan(context, planner, writer, quality)
        names = [item["filenameSuggestion"] for item in result["imagePlan"]["items"]]
        self.assertEqual(len(names), len(set(names)))
        for name in names:
            self.assertNotIn("/", name)
            self.assertNotIn("\\", name)
            self.assertNotRegex(name, r'[:*?"<>|]')

    def test_k_duplicate_assignment_is_warning(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        valid = self._plan(context, planner, writer, quality)
        raw = copy.deepcopy(valid["imagePlan"])
        raw["items"].append(copy.deepcopy(raw["items"][0]))
        raw["items"][-1]["imagePlanId"] = "IMG_PLAN_DUP"
        raw["items"][-1]["sectionId"] = "S3"
        raw["items"][-1]["assetRef"] = raw["items"][0]["assetRef"] or "CA-uploaded-product"
        raw["items"][-1]["status"] = "ASSIGNED"
        raw["items"][0]["assetRef"] = raw["items"][-1]["assetRef"]
        raw["items"][0]["status"] = "ASSIGNED"
        result = self._plan(context, planner, writer, quality, raw_plan=raw)
        self.assertIn("DUPLICATE_IMAGE_ASSIGNMENT", result["imagePlan"]["warnings"])
        self.assertNotEqual(result["code"], "DUPLICATE_IMAGE_ASSIGNMENT")

    def test_l_unused_asset_is_preserved(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        result = self._plan(context, planner, writer, quality)
        unused = {item["assetRef"] for item in result["imagePlan"]["unassignedAssets"]}
        self.assertIn("CA-detail-analyzed", unused)

    def test_m_empty_available_images_does_not_raise(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        empty = copy.deepcopy(context)
        empty["availableImages"] = []
        result = plan_blog_images(blog_context=empty, planner_result=planner, draft=writer["draft"], quality_report=quality)
        self.assertIn(result["imagePlan"]["planStatus"], {"PENDING_ASSETS", "PARTIAL"})
        self.assertNotEqual(result["imagePlan"]["planStatus"], "HOLD")

    def test_n_planner_is_read_only(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        before = {
            "context": copy.deepcopy(context),
            "intent": copy.deepcopy(planner["intentAnalysis"]),
            "plan": copy.deepcopy(planner["contentPlan"]),
            "draft": copy.deepcopy(writer["draft"]),
            "quality": copy.deepcopy(quality),
        }
        self._plan(context, planner, writer, quality)
        self.assertEqual(context, before["context"])
        self.assertEqual(planner["intentAnalysis"], before["intent"])
        self.assertEqual(planner["contentPlan"], before["plan"])
        self.assertEqual(writer["draft"], before["draft"])
        self.assertEqual(quality, before["quality"])

    def test_o_production_routing_and_channels_unchanged(self) -> None:
        from content_center_generate import generate_artifact
        from content_writer_service import build_generation_context, write_channel_content

        context, appeal, planner, writer, quality = self._full_bundle()
        self._plan(context, planner, writer, quality)
        import content_center_generate
        import content_writer_service

        self.assertNotIn("content_blog_image_plan", inspect.getsource(content_center_generate))
        self.assertNotIn("content_blog_image_plan", inspect.getsource(content_writer_service))
        ig_ctx = build_generation_context(self.db, appeal=appeal, channel="instagram", sku_title="수자타 헤나 염색약")
        shorts_ctx = build_generation_context(self.db, appeal=appeal, channel="shorts", sku_title="수자타 헤나 염색약")
        self.assertEqual(write_channel_content(self.db, context=ig_ctx)["format"], "instagram_carousel_v1")
        self.assertEqual(write_channel_content(self.db, context=shorts_ctx)["format"], "shorts_scene_timeline_v1")
        blog = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="blog", sku_title="수자타 헤나 염색약")
        body = json.loads(blog.body_json or "{}")
        self.assertEqual(body.get("generation_version"), "v1")
        self.assertEqual(body["generation_engine"], "LLM_WRITER_V1")

    def test_p_no_actual_image_payload(self) -> None:
        context, _appeal, planner, writer, quality = self._full_bundle()
        result = self._plan(context, planner, writer, quality)
        blob = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("base64", blob)
        self.assertNotIn("data:image/", blob)
        self.assertNotIn("generated_image_url", blob)
        self.assertNotIn("fake_asset_url", blob)

    def test_q_no_new_llm_call(self) -> None:
        import content_blog_image_plan

        source = inspect.getsource(content_blog_image_plan)
        self.assertNotIn("openai", source.lower())
        self.assertNotIn("requests", source)
        self.assertIn("DETERMINISTIC_RULE_BASED", source)
        context, _appeal, planner, writer, quality = self._full_bundle()
        result = self._plan(context, planner, writer, quality)
        self.assertEqual(result["imagePlan"]["imagePlanProvenance"]["planningMode"], "DETERMINISTIC_RULE_BASED")
        encoded = serialize_blog_image_plan(result["imagePlan"])
        decoded = json.loads(encoded)
        self.assertEqual(decoded["version"], "blog_image_plan_v1")
        limitation_ids = {item["id"] for item in decoded["limitations"]}
        self.assertIn("IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED", limitation_ids)
        self.assertIn("IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED", limitation_ids)
        self.assertIn("LIVE_BLOG_V2_PLANNER_WRITER_END_TO_END_NOT_YET_VERIFIED", limitation_ids)
