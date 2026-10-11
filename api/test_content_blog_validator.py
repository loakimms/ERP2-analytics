from __future__ import annotations

import copy
import inspect
import json
import unittest

from content_blog_context import build_blog_generation_context
from content_blog_planner import STATUS_PASS, plan_blog_content
from content_blog_profiles import FORBIDDEN_SCORE_KEYS
from content_blog_validator import serialize_blog_quality_report, validate_blog_quality
from content_blog_writer import write_blog_professional_draft
from test_content_blog_context import BlogGenerationContextTest


class BlogQualityValidatorTest(unittest.TestCase):
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
        return context, appeal, planner, writer

    def _sparse_bundle(self):
        appeal = {
            "sku_id": "",
            "appeal_id": "",
            "label": "",
            "appeal_text": "",
            "evidence": [],
            "insight": {},
        }
        context = build_blog_generation_context(self.db, appeal=appeal, sku_title="")
        planner = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(planner["status"], STATUS_PASS, planner["issues"])
        writer = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(writer["status"], "PASS", writer["issues"])
        return context, planner, writer

    def _validate(self, context, planner, writer, *, draft=None, writer_result=None):
        return validate_blog_quality(
            self.db,
            blog_context=context,
            planner_result=planner,
            draft=draft if draft is not None else writer["draft"],
            writer_result=writer_result,
        )

    def _codes(self, report: dict) -> set[str]:
        return {str(item.get("code") or "") for item in report.get("issues") or []}

    def test_a_full_source_draft_passes_gate_with_warnings(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        report = self._validate(context, planner, writer, writer_result=writer)
        self.assertEqual(report["gateDecision"], "PASS", report["issues"])
        self.assertEqual(report["qualityStatus"], "WARNING")
        self.assertEqual(report["version"], "blog_quality_report_v1")
        self.assertEqual(report["writerContractStatus"], "PASS")
        self.assertIn("BODY_LENGTH_BELOW_REFERENCE", self._codes(report))
        self.assertEqual(report["guidelineProfile"]["authority"], "REFERENCE_GUIDELINE")
        self.assertEqual(report["validatorProvenance"]["validationMode"], "DETERMINISTIC_RULE_BASED")

    def test_b_short_draft_is_warning_not_hard_fail(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        for section in draft["sections"]:
            section["paragraphs"] = ["짧은 문단입니다."]
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "PASS", report["issues"])
        self.assertIn("BODY_LENGTH_BELOW_REFERENCE", self._codes(report))
        self.assertNotEqual(report["qualityStatus"], "FAIL")

    def test_c_long_paragraph_is_warning(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        draft["sections"][0]["paragraphs"] = [
            "확인된 제품 정보를 자료 범위에서만 풀어 설명하는 긴 문단이며 "
            + " ".join(f"항목{index}" for index in range(80))
        ]
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "PASS", report["issues"])
        self.assertIn("LONG_PARAGRAPH", self._codes(report))
        self.assertEqual(report["checks"]["readability"]["status"], "WARNING")

    def test_d_ai_cliche_is_warning(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        draft["sections"][0]["paragraphs"].append("이제 사용 방법을 알아보도록 하겠습니다.")
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "PASS", report["issues"])
        self.assertIn("AI_CLICHE_DETECTED", self._codes(report))
        self.assertEqual(report["checks"]["clicheDetection"]["status"], "WARNING")

    def test_e_repeated_ending_is_warning(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        draft["sections"][-1]["paragraphs"] = [
            "확인된 정보만 안내합니다. 공식 자료만 따릅니다. 임의 효과는 넣지 않습니다.",
        ]
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "PASS", report["issues"])
        self.assertIn("REPEATED_SENTENCE_ENDING", self._codes(report))
        self.assertEqual(report["checks"]["languageNaturalness"]["status"], "WARNING")

    def test_f_keyword_reference_excess_is_warning(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        keyword = planner["intentAnalysis"]["keywordPlan"]["primaryKeyword"]
        extras = [f"{keyword} 관련 확인 항목 {index}를 자료 범위에서 봅니다." for index in range(8)]
        draft["sections"][0]["paragraphs"].extend(extras)
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "PASS", report["issues"])
        self.assertIn("KEYWORD_USAGE_ABOVE_REFERENCE", self._codes(report))
        self.assertNotIn("MECHANICAL_KEYWORD_STUFFING", self._codes(report))

    def test_g_mechanical_keyword_stuffing_is_fail(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        draft["sections"][0]["paragraphs"].append("헤나 염색 헤나 염색 헤나 염색 헤나 염색")
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "HOLD")
        self.assertEqual(report["qualityStatus"], "FAIL")
        self.assertIn("MECHANICAL_KEYWORD_STUFFING", self._codes(report))

    def test_h_restricted_claim_is_hold(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        draft["sections"][0]["paragraphs"].append("두피 문제를 없애주고 머리가 덜 빠지게 합니다.")
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "HOLD")
        self.assertEqual(report["checks"]["claimSafety"]["status"], "FAIL")
        self.assertIn("RESTRICTED_CLAIM_LEAKAGE", self._codes(report))

    def test_i_fake_experience_is_fail(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = copy.deepcopy(writer["draft"])
        draft["sections"][0]["paragraphs"].append("직접 사용해보니 바로 달라졌습니다.")
        report = self._validate(context, planner, writer, draft=draft)
        self.assertEqual(report["gateDecision"], "HOLD")
        self.assertEqual(report["checks"]["experienceIntegrity"]["status"], "FAIL")
        self.assertIn("FAKE_EXPERIENCE_GENERATION", self._codes(report))

    def test_j_source_limited_draft_stays_pass(self) -> None:
        context, planner, writer = self._sparse_bundle()
        report = self._validate(context, planner, writer, writer_result=writer)
        self.assertEqual(report["gateDecision"], "PASS", report["issues"])
        codes = self._codes(report)
        self.assertIn("BODY_LENGTH_BELOW_REFERENCE", codes)
        self.assertIn("SOURCE_LIMITED_DRAFT", codes)
        self.assertNotIn("UNSUPPORTED_FACT_GENERATED", codes)
        self.assertFalse((writer["draft"].get("sourceUsage") or {}).get("unsupportedFactGenerated"))

    def test_k_commercial_disclosure(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        unknown = self._validate(context, planner, writer, writer_result=writer)
        self.assertIn("COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN", self._codes(unknown))
        self.assertEqual(unknown["gateDecision"], "PASS")
        required_context = copy.deepcopy(context)
        required_context["commercialDisclosure"] = {"required": True, "source": None, "status": "REQUIRED"}
        held = validate_blog_quality(
            self.db,
            blog_context=required_context,
            planner_result=planner,
            draft=writer["draft"],
            writer_result=writer,
        )
        self.assertEqual(held["gateDecision"], "HOLD")
        self.assertIn("REQUIRED_DISCLOSURE_MISSING", self._codes(held))

    def test_l_production_routing_and_channels_unchanged(self) -> None:
        from content_center_generate import generate_artifact
        from content_writer_service import build_generation_context, write_channel_content

        context, appeal, planner, writer = self._full_bundle()
        self._validate(context, planner, writer, writer_result=writer)
        import content_center_generate
        import content_writer_service

        self.assertNotIn("content_blog_validator", inspect.getsource(content_center_generate))
        self.assertNotIn("content_blog_profiles", inspect.getsource(content_center_generate))
        self.assertNotIn("content_blog_validator", inspect.getsource(content_writer_service))

        ig_ctx = build_generation_context(self.db, appeal=appeal, channel="instagram", sku_title="수자타 헤나 염색약")
        shorts_ctx = build_generation_context(self.db, appeal=appeal, channel="shorts", sku_title="수자타 헤나 염색약")
        self.assertEqual(write_channel_content(self.db, context=ig_ctx)["format"], "instagram_carousel_v1")
        self.assertEqual(write_channel_content(self.db, context=shorts_ctx)["format"], "shorts_scene_timeline_v1")
        blog = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="blog", sku_title="수자타 헤나 염색약")
        body = json.loads(blog.body_json or "{}")
        self.assertEqual(body.get("generation_version"), "v1")
        self.assertEqual(body["generation_engine"], "LLM_WRITER_V1")

    def test_m_validator_is_read_only(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        draft = writer["draft"]
        before = copy.deepcopy(draft)
        self._validate(context, planner, writer, draft=draft, writer_result=writer)
        self.assertEqual(draft, before)

    def test_n_no_quality_score_keys(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        report = self._validate(context, planner, writer, writer_result=writer)
        blob = json.dumps(report, ensure_ascii=False)
        for key in FORBIDDEN_SCORE_KEYS:
            self.assertNotIn(f'"{key}"', blob)
        self.assertNotIn("NAVER_OFFICIAL_RULE", blob)
        self.assertNotIn("C_RANK_THRESHOLD", blob)

    def test_o_quality_report_serializes(self) -> None:
        context, _appeal, planner, writer = self._full_bundle()
        report = self._validate(context, planner, writer, writer_result=writer)
        encoded = serialize_blog_quality_report(report)
        decoded = json.loads(encoded)
        self.assertEqual(decoded["version"], "blog_quality_report_v1")
        self.assertEqual(decoded["validatorProvenance"]["validatorVersion"], "blog_quality_validator_v1")
        limitation_ids = {item["id"] for item in decoded["limitations"]}
        self.assertIn("SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED", limitation_ids)
        self.assertIn("SEMANTIC_GENERAL_KNOWLEDGE_EXCLUSION_NOT_FULLY_VERIFIED", limitation_ids)
        self.assertIn("LIVE_BLOG_V2_PLANNER_WRITER_END_TO_END_NOT_YET_VERIFIED", limitation_ids)
