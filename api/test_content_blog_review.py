from __future__ import annotations

import copy
import inspect
import json
import unittest

from content_blog_context import build_blog_generation_context
from content_blog_image_plan import plan_blog_images
from content_blog_planner import STATUS_PASS, plan_blog_content
from content_blog_review import (
    FRESH_CURRENT,
    FRESH_STALE,
    READINESS_BLOCKED,
    READINESS_READY,
    READINESS_REVIEW_REQUIRED,
    apply_blog_human_edit,
    apply_blog_human_review_decision,
    build_blog_v2_review_bundle,
    serialize_blog_human_review,
    serialize_blog_v2_review_bundle,
)
from content_blog_validator import validate_blog_quality
from content_blog_writer import write_blog_professional_draft
from test_content_blog_context import BlogGenerationContextTest


class BlogHitlReviewTest(unittest.TestCase):
    def setUp(self) -> None:
        self.harness = BlogGenerationContextTest("setUp")
        self.harness.setUp()
        self.db = self.harness.db

    def tearDown(self) -> None:
        self.harness.tearDown()

    def _full_pipeline(self, *, hold: bool = False):
        self.harness._scope()
        appeal = self.harness._full_appeal()
        context = build_blog_generation_context(self.db, appeal=appeal, sku_title="수자타 헤나 염색약")
        planner = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(planner["status"], STATUS_PASS, planner["issues"])
        writer = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(writer["status"], "PASS", writer["issues"])
        draft = copy.deepcopy(writer["draft"])
        if hold:
            draft["sections"][0]["paragraphs"].append("두피 문제를 없애주고 머리가 덜 빠지게 합니다.")
        quality = validate_blog_quality(self.db, blog_context=context, planner_result=planner, draft=draft, writer_result=None if hold else writer)
        image = plan_blog_images(blog_context=context, planner_result=planner, draft=writer["draft"], quality_report=quality)
        bundle = build_blog_v2_review_bundle(
            blog_context=context,
            planner_result=planner,
            draft=writer["draft"],
            quality_report=quality,
            image_plan=image,
        )
        return context, appeal, planner, writer, quality, image, bundle

    def _required(self, bundle):
        return [item for item in bundle["reviewItems"] if item.get("required")]

    def _complete_required(self, bundle, *, reject_id: str | None = None):
        out = bundle
        for item in self._required(out):
            decision = "REJECTED" if item["reviewItemId"] == reject_id else "CONFIRMED"
            out = apply_blog_human_review_decision(out, review_item_id=item["reviewItemId"], decision=decision)
        return out

    def test_a_pass_with_warnings_requires_review(self) -> None:
        _context, _appeal, _planner, _writer, quality, _image, bundle = self._full_pipeline()
        self.assertEqual(quality["gateDecision"], "PASS")
        self.assertEqual(quality["qualityStatus"], "WARNING")
        self.assertEqual(bundle["reviewSummary"]["reviewReadiness"], READINESS_REVIEW_REQUIRED)
        self.assertGreaterEqual(bundle["reviewSummary"]["pendingCount"], 3)

    def test_b_machine_hold_stays_blocked(self) -> None:
        _context, _appeal, _planner, _writer, quality, _image, bundle = self._full_pipeline(hold=True)
        self.assertEqual(quality["gateDecision"], "HOLD")
        completed = self._complete_required(bundle)
        self.assertEqual(completed["reviewSummary"]["reviewReadiness"], READINESS_BLOCKED)

    def test_c_required_reviews_complete(self) -> None:
        *_rest, bundle = self._full_pipeline()
        completed = self._complete_required(bundle)
        self.assertEqual(completed["reviewSummary"]["reviewReadiness"], READINESS_READY)
        self.assertEqual(completed["reviewSummary"]["pendingCount"], 0)

    def test_d_required_rejected_blocks(self) -> None:
        *_rest, bundle = self._full_pipeline()
        reject_id = "RV_FACT_MEANING"
        completed = self._complete_required(bundle, reject_id=reject_id)
        self.assertEqual(completed["reviewSummary"]["reviewReadiness"], READINESS_BLOCKED)

    def test_e_optional_warning_may_stay_pending(self) -> None:
        *_rest, bundle = self._full_pipeline()
        optional = [item["reviewItemId"] for item in bundle["reviewItems"] if not item.get("required")]
        self.assertTrue(optional)
        completed = self._complete_required(bundle)
        self.assertEqual(completed["reviewSummary"]["reviewReadiness"], READINESS_READY)
        still_pending_optional = [item for item in completed["reviewItems"] if not item.get("required") and item.get("humanDecision") == "PENDING"]
        self.assertTrue(still_pending_optional)

    def test_f_commercial_disclosure_is_required(self) -> None:
        *_rest, bundle = self._full_pipeline()
        codes = {item["machineCode"] for item in bundle["reviewItems"] if item.get("required")}
        self.assertIn("COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN", codes)
        self.assertEqual(bundle["reviewSummary"]["reviewReadiness"], READINESS_REVIEW_REQUIRED)

    def test_g_image_ownership_only_for_assigned(self) -> None:
        *_rest, bundle = self._full_pipeline()
        ownership = [item for item in bundle["reviewItems"] if item["machineCode"] == "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED"]
        self.assertTrue(ownership)
        self.assertTrue(all(item.get("required") for item in ownership))
        unused = {item["assetRef"] for item in bundle["imagePlan"].get("unassignedAssets") or []}
        for item in ownership:
            self.assertTrue(item["sourceRefs"])
            self.assertNotIn(item["sourceRefs"][0], unused)

    def test_h_alt_match_only_when_assigned(self) -> None:
        *_rest, bundle = self._full_pipeline()
        alt_items = [item for item in bundle["reviewItems"] if item["machineCode"] == "IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED"]
        pending = [item for item in bundle["imagePlan"]["items"] if item.get("status") == "PENDING_ASSET"]
        assigned = [item for item in bundle["imagePlan"]["items"] if item.get("status") == "ASSIGNED"]
        self.assertTrue(assigned)
        self.assertEqual(len(alt_items), len(assigned))
        pending_ids = {f"RV_ALT_MATCH_{item['sectionId']}" for item in pending}
        self.assertTrue(pending_ids.isdisjoint({item["reviewItemId"] for item in alt_items}))

    def test_i_machine_reports_are_immutable(self) -> None:
        context, _appeal, planner, writer, quality, image, bundle = self._full_pipeline()
        before = {
            "quality": copy.deepcopy(quality),
            "image": copy.deepcopy(image["imagePlan"]),
            "context": copy.deepcopy(context),
            "intent": copy.deepcopy(planner["intentAnalysis"]),
            "plan": copy.deepcopy(planner["contentPlan"]),
            "draft": copy.deepcopy(writer["draft"]),
        }
        changed = apply_blog_human_review_decision(bundle, review_item_id="RV_FACT_MEANING", decision="CONFIRMED", note="확인")
        self.assertEqual(quality, before["quality"])
        self.assertEqual(image["imagePlan"], before["image"])
        self.assertEqual(context, before["context"])
        self.assertEqual(planner["intentAnalysis"], before["intent"])
        self.assertEqual(planner["contentPlan"], before["plan"])
        self.assertEqual(writer["draft"], before["draft"])
        self.assertEqual(changed["qualityReport"]["issues"], bundle["qualityReport"]["issues"])
        self.assertEqual(changed["draft"]["selectedTitle"], bundle["draft"]["selectedTitle"])

    def test_j_title_human_edit_is_separate_and_stale(self) -> None:
        *_rest, bundle = self._full_pipeline()
        original = bundle["draft"]["selectedTitle"]
        candidate = bundle["draft"]["titleCandidates"][1]["title"]
        edited = apply_blog_human_edit(bundle, selected_title=candidate)
        self.assertEqual(bundle["draft"]["selectedTitle"], original)
        self.assertEqual(edited["draft"]["selectedTitle"], original)
        self.assertEqual(edited["humanReview"]["humanEdits"]["selectedTitle"], candidate)
        self.assertEqual(edited["humanReview"]["validationFreshness"], FRESH_STALE)

    def test_k_ownership_decision_keeps_validation_current(self) -> None:
        *_rest, bundle = self._full_pipeline()
        ownership_id = next(item["reviewItemId"] for item in bundle["reviewItems"] if item["machineCode"] == "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED")
        changed = apply_blog_human_review_decision(bundle, review_item_id=ownership_id, decision="CONFIRMED")
        self.assertEqual(changed["humanReview"]["validationFreshness"], FRESH_CURRENT)

    def test_n_review_serializes(self) -> None:
        *_rest, bundle = self._full_pipeline()
        encoded = serialize_blog_v2_review_bundle(bundle)
        decoded = json.loads(encoded)
        self.assertEqual(decoded["version"], "blog_v2_review_bundle_v1")
        human = serialize_blog_human_review(bundle["humanReview"])
        self.assertEqual(json.loads(human)["version"], "blog_human_review_v1")

    def test_o_production_routing_unchanged(self) -> None:
        from content_center_generate import generate_artifact

        context, appeal, _planner, _writer, _quality, _image, _bundle = self._full_pipeline()
        import content_center_generate

        self.assertNotIn("content_blog_review", inspect.getsource(content_center_generate))
        blog = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="blog", sku_title="수자타 헤나 염색약")
        body = json.loads(blog.body_json or "{}")
        self.assertEqual(body.get("generation_version"), "v1")
        self.assertEqual(body["generation_engine"], "LLM_WRITER_V1")
        self.assertNotIn("blog_v2_review_bundle", json.dumps(body))

    def test_p_no_new_llm_call(self) -> None:
        import content_blog_review

        source = inspect.getsource(content_blog_review)
        self.assertNotIn("openai", source.lower())
        self.assertNotIn("requests", source)
        self.assertIn("DETERMINISTIC_RULE_BASED", source)

    def test_q_no_fake_quality_score(self) -> None:
        *_rest, bundle = self._full_pipeline()
        blob = json.dumps(bundle, ensure_ascii=False)
        for token in ("overall_score", "seo_score", "naver_score", "c_rank_score", "dia_score", "smartblock_score", "AI 점수"):
            self.assertNotIn(token, blob)

    def test_r_review_counts_match_items(self) -> None:
        *_rest, bundle = self._full_pipeline()
        required = self._required(bundle)
        pending = [item for item in required if item["humanDecision"] == "PENDING"]
        self.assertEqual(bundle["reviewSummary"]["pendingCount"], len(pending))
        self.assertEqual(bundle["reviewSummary"]["requiredCount"], len(required))
        completed = self._complete_required(bundle)
        self.assertEqual(completed["reviewSummary"]["pendingCount"], 0)
        self.assertEqual(completed["reviewSummary"]["completedCount"], len(required))

    def test_s_human_edit_marks_quality_stale(self) -> None:
        *_rest, bundle = self._full_pipeline()
        edited = apply_blog_human_edit(bundle, draft_text="한 문장을 사람이 고쳤습니다.")
        self.assertEqual(edited["humanReview"]["validationFreshness"], FRESH_STALE)
        self.assertEqual(edited["reviewSummary"]["validationFreshness"], FRESH_STALE)
        self.assertEqual(edited["qualityReport"]["qualityStatus"], bundle["qualityReport"]["qualityStatus"])
