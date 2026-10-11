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
    apply_blog_human_review_decision,
    build_blog_v2_review_bundle,
)
from content_blog_revalidate import (
    CODE_FACT_REVIEW_AFTER_EDIT,
    CODE_GK_REVIEW_AFTER_EDIT,
    CODE_IMAGE_META_AFTER_EDIT,
    CODE_STRUCTURE_UNSAFE,
    TRIGGER_AFTER_EDIT,
    TRIGGER_INITIAL,
    BlogRevalidateAcceptError,
    assert_blog_v2_accept_allowed,
    build_effective_blog_draft,
    revalidate_blog_v2_artifact,
    revalidate_blog_v2_human_revision,
    serialize_blog_revalidation_result,
)
from content_blog_validator import validate_blog_quality
from content_blog_writer import to_legacy_blog_preview, write_blog_professional_draft
from content_center_generate import generate_artifact
from content_center_revision import save_artifact_draft
from db import ContentArtifact
from test_content_blog_context import BlogGenerationContextTest


class BlogHumanEditRevalidateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.harness = BlogGenerationContextTest("setUp")
        self.harness.setUp()
        self.db = self.harness.db

    def tearDown(self) -> None:
        self.harness.tearDown()

    def _pipeline(self):
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
        image = plan_blog_images(blog_context=context, planner_result=planner, draft=writer["draft"], quality_report=quality)
        bundle = build_blog_v2_review_bundle(
            blog_context=context,
            planner_result=planner,
            draft=writer["draft"],
            quality_report=quality,
            image_plan=image,
        )
        return context, appeal, planner, writer, quality, image, bundle

    def _body(self, bundle, *, preview=None, title=None, human_edits=None):
        draft = bundle["draft"]
        preview = copy.deepcopy(preview if preview is not None else to_legacy_blog_preview(draft))
        body = {
            "generation_version": "blog_v2",
            "title": title or preview.get("title") or draft.get("selectedTitle"),
            "format": "blog",
            "blog": preview,
            "sections": preview.get("sections"),
            "blog_v2_review_bundle": copy.deepcopy(bundle),
            "humanReview": copy.deepcopy(bundle.get("humanReview") or {}),
        }
        if human_edits:
            body["blog_v2_review_bundle"]["humanReview"]["humanEdits"] = human_edits
            body["humanReview"]["humanEdits"] = human_edits
        return body

    def _edit_section(self, preview, index: int, *, heading=None, extra_text=""):
        out = copy.deepcopy(preview)
        section = out["sections"][index]
        if heading is not None:
            section["heading"] = heading
        if extra_text:
            section["body"] = f"{section.get('body') or ''} {extra_text}".strip()
        out["sections"][index] = section
        return out

    def test_a_effective_draft_applies_edit_and_keeps_original(self) -> None:
        *_rest, bundle = self._pipeline()
        original = copy.deepcopy(bundle["draft"])
        preview = self._edit_section(to_legacy_blog_preview(original), 0, extra_text="확인된 범위에서 표현만 다듬었습니다.")
        body = self._body(bundle, preview=preview)
        effective = build_effective_blog_draft(original, body, bundle.get("humanReview"))
        self.assertIn("확인된 범위에서 표현만 다듬었습니다.", " ".join(effective["draft"]["sections"][0]["paragraphs"]))
        self.assertEqual(original, bundle["draft"])
        self.assertEqual(effective["originalDraft"], original)

    def test_b_no_human_edit(self) -> None:
        *_rest, bundle = self._pipeline()
        body = self._body(bundle)
        result = revalidate_blog_v2_human_revision(bundle, body, db=self.db)
        self.assertEqual(result["changedFields"], [])
        self.assertEqual(result["changedSectionIds"], [])
        self.assertEqual(result["requiredReviewResets"], [])

    def test_c_section_text_edit_marks_s2_and_requires_source_review(self) -> None:
        *_rest, bundle = self._pipeline()
        original = bundle["draft"]
        self.assertGreaterEqual(len(original["sections"]), 2)
        section_id = original["sections"][1]["sectionId"]
        preview = self._edit_section(to_legacy_blog_preview(original), 1, extra_text="기존 후기 범위에서 문장만 고쳤습니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        self.assertEqual(result["changedSectionIds"], [section_id])
        codes = {item["machineCode"] for item in result["reviewItems"]}
        self.assertIn(CODE_FACT_REVIEW_AFTER_EDIT, codes)
        self.assertIn(CODE_GK_REVIEW_AFTER_EDIT, codes)

    def test_d_restricted_claim_added_by_human(self) -> None:
        *_rest, bundle = self._pipeline()
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 0, extra_text="치료 효과를 안내합니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        codes = {item.get("code") for item in result["qualityReport"]["issues"]}
        self.assertIn("RESTRICTED_CLAIM_LEAKAGE", codes)
        self.assertEqual(result["qualityReport"]["gateDecision"], "HOLD")
        self.assertEqual(result["validationFreshness"], FRESH_CURRENT)
        self.assertEqual(result["reviewSummary"]["reviewReadiness"], "BLOCKED")

    def test_e_fake_experience_added(self) -> None:
        *_rest, bundle = self._pipeline()
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 0, extra_text="직접 사용해보니 바로 달라졌습니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        codes = {item.get("code") for item in result["qualityReport"]["issues"]}
        self.assertIn("FAKE_EXPERIENCE_GENERATION", codes)
        self.assertEqual(result["status"], "HOLD")

    def test_f_keyword_stuffing(self) -> None:
        *_rest, bundle = self._pipeline()
        stuffing = "헤나 염색약 헤나 염색약 헤나 염색약 헤나 염색약 헤나 염색약"
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 0, extra_text=stuffing)
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        codes = {item.get("code") for item in result["qualityReport"]["issues"]}
        self.assertIn("MECHANICAL_KEYWORD_STUFFING", codes)
        self.assertEqual(result["qualityReport"]["gateDecision"], "HOLD")

    def test_g_section_add_is_structure_hold(self) -> None:
        *_rest, writer, quality, image, bundle = self._pipeline()
        preview = to_legacy_blog_preview(bundle["draft"])
        preview["sections"] = list(preview["sections"]) + [{"heading": "새 섹션", "body": "추가된 본문"}]
        original_draft = copy.deepcopy(bundle["draft"])
        original_image = copy.deepcopy(bundle["imagePlan"])
        original_quality = copy.deepcopy(quality)
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        self.assertEqual(result["humanRevisedContract"]["code"], CODE_STRUCTURE_UNSAFE)
        self.assertEqual(result["qualityReport"]["gateDecision"], "HOLD")
        self.assertEqual(result["bundle"]["draft"], original_draft)
        self.assertEqual(result["bundle"]["imagePlan"], original_image)
        self.assertEqual(result["bundle"]["qualityReport"], original_quality)

    def test_h_old_quality_immutable_and_history_appended(self) -> None:
        *_rest, writer, quality, _image, bundle = self._pipeline()
        initial = copy.deepcopy(quality)
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 0, extra_text="표현만 고쳤습니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        self.assertEqual(result["bundle"]["qualityReport"], initial)
        triggers = [item.get("trigger") for item in result["bundle"]["validationHistory"]]
        self.assertIn(TRIGGER_INITIAL, triggers)
        self.assertIn(TRIGGER_AFTER_EDIT, triggers)
        self.assertNotEqual(result["qualityReport"], initial)

    def test_i_original_draft_immutable(self) -> None:
        *_rest, bundle = self._pipeline()
        before = copy.deepcopy(bundle["draft"])
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 0, extra_text="문장 수정")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        self.assertEqual(bundle["draft"], before)
        self.assertEqual(result["bundle"]["draft"], before)

    def test_j_scoped_review_reset(self) -> None:
        *_rest, bundle = self._pipeline()
        s1 = bundle["draft"]["sections"][0]["sectionId"]
        s2 = bundle["draft"]["sections"][1]["sectionId"]
        bundle["reviewItems"].extend(
            [
                {
                    "reviewItemId": f"RV_FACT_MEANING_{s1}",
                    "required": True,
                    "humanDecision": "CONFIRMED",
                    "machineCode": CODE_FACT_REVIEW_AFTER_EDIT,
                    "scope": f"SECTION:{s1}",
                },
                {
                    "reviewItemId": f"RV_FACT_MEANING_{s2}",
                    "required": True,
                    "humanDecision": "CONFIRMED",
                    "machineCode": CODE_FACT_REVIEW_AFTER_EDIT,
                    "scope": f"SECTION:{s2}",
                },
            ]
        )
        ownership = next(item for item in bundle["reviewItems"] if item["machineCode"] == "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED")
        bundle = apply_blog_human_review_decision(bundle, review_item_id=ownership["reviewItemId"], decision="CONFIRMED")
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 1, extra_text="S2만 고쳤습니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        by_id = {item["reviewItemId"]: item for item in result["reviewItems"]}
        self.assertEqual(by_id[f"RV_FACT_MEANING_{s2}"]["humanDecision"], "PENDING")
        self.assertEqual(by_id[f"RV_GENERAL_KNOWLEDGE_{s2}"]["humanDecision"], "PENDING")
        self.assertEqual(by_id[f"RV_FACT_MEANING_{s1}"]["humanDecision"], "CONFIRMED")
        self.assertEqual(by_id[ownership["reviewItemId"]]["humanDecision"], "CONFIRMED")

    def test_k_image_match_reset_keeps_ownership(self) -> None:
        *_rest, writer, quality, image, bundle = self._pipeline()
        assigned = next(item for item in image["imagePlan"]["items"] if item.get("status") == "ASSIGNED")
        section_id = assigned["sectionId"]
        index = next(i for i, section in enumerate(bundle["draft"]["sections"]) if section["sectionId"] == section_id)
        ownership_id = f"RV_IMAGE_OWNERSHIP_{assigned['assetRef']}"
        alt_id = f"RV_ALT_MATCH_{section_id}"
        bundle = apply_blog_human_review_decision(bundle, review_item_id=ownership_id, decision="CONFIRMED")
        bundle = apply_blog_human_review_decision(bundle, review_item_id=alt_id, decision="CONFIRMED")
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), index, extra_text="이미지 연결된 섹션 문장을 고쳤습니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        self.assertEqual(result["imageConsistency"]["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["imageConsistency"]["code"], CODE_IMAGE_META_AFTER_EDIT)
        by_id = {item["reviewItemId"]: item for item in result["reviewItems"]}
        self.assertEqual(by_id[alt_id]["humanDecision"], "PENDING")
        self.assertEqual(by_id[ownership_id]["humanDecision"], "CONFIRMED")

    def test_l_title_only_edit(self) -> None:
        *_rest, bundle = self._pipeline()
        ownership = next(item for item in bundle["reviewItems"] if item["machineCode"] == "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED")
        bundle = apply_blog_human_review_decision(bundle, review_item_id=ownership["reviewItemId"], decision="CONFIRMED")
        bundle = apply_blog_human_review_decision(bundle, review_item_id="RV_FACT_MEANING", decision="CONFIRMED")
        body = self._body(bundle, human_edits={"selectedTitle": "확인된 제품 정보만 보는 헤나 가이드"})
        result = revalidate_blog_v2_human_revision(bundle, body, db=self.db)
        self.assertIn("selectedTitle", result["changedFields"])
        self.assertEqual(result["changedSectionIds"], [])
        by_id = {item["reviewItemId"]: item for item in result["reviewItems"]}
        self.assertEqual(by_id["RV_FACT_MEANING"]["humanDecision"], "CONFIRMED")
        self.assertEqual(by_id[ownership["reviewItemId"]]["humanDecision"], "CONFIRMED")
        self.assertEqual(result["imageConsistency"]["status"], "UNCHANGED")
        self.assertEqual(result["effectiveDraft"]["selectedTitle"], "확인된 제품 정보만 보는 헤나 가이드")
        self.assertEqual(result["bundle"]["draft"]["selectedTitle"], bundle["draft"]["selectedTitle"])

    def test_m_stale_approval_block(self) -> None:
        *_rest, bundle = self._pipeline()
        bundle["humanReview"]["validationFreshness"] = FRESH_STALE
        body = {"generation_version": "blog_v2", "blog_v2_review_bundle": bundle}
        with self.assertRaises(BlogRevalidateAcceptError):
            assert_blog_v2_accept_allowed(body)

    def test_n_hold_approval_block(self) -> None:
        *_rest, bundle = self._pipeline()
        bundle["humanReview"]["validationFreshness"] = FRESH_CURRENT
        bundle["currentQualityReport"] = {"gateDecision": "HOLD"}
        bundle["reviewSummary"]["reviewReadiness"] = "READY_FOR_FINAL_REVIEW"
        body = {"generation_version": "blog_v2", "blog_v2_review_bundle": bundle}
        with self.assertRaises(BlogRevalidateAcceptError):
            assert_blog_v2_accept_allowed(body)

    def test_o_required_review_pending_block(self) -> None:
        *_rest, bundle = self._pipeline()
        bundle["humanReview"]["validationFreshness"] = FRESH_CURRENT
        bundle["qualityReport"]["gateDecision"] = "PASS"
        bundle["reviewSummary"]["reviewReadiness"] = "REVIEW_REQUIRED"
        body = {"generation_version": "blog_v2", "blog_v2_review_bundle": bundle}
        with self.assertRaises(BlogRevalidateAcceptError):
            assert_blog_v2_accept_allowed(body)

    def test_p_valid_revalidation_ready(self) -> None:
        *_rest, bundle = self._pipeline()
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 0, extra_text="확인된 범위에서 표현만 다듬었습니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        out = result["bundle"]
        for item in out["reviewItems"]:
            if item.get("required"):
                out = apply_blog_human_review_decision(out, review_item_id=item["reviewItemId"], decision="CONFIRMED")
        out["humanReview"]["validationFreshness"] = FRESH_CURRENT
        out["currentQualityReport"] = result["qualityReport"]
        if result["qualityReport"]["gateDecision"] == "PASS":
            out["reviewSummary"]["reviewReadiness"] = "READY_FOR_FINAL_REVIEW"
            assert_blog_v2_accept_allowed({"generation_version": "blog_v2", "blog_v2_review_bundle": out})
            self.assertEqual(out["reviewSummary"]["reviewReadiness"], "READY_FOR_FINAL_REVIEW")

    def test_q_no_openai(self) -> None:
        import content_blog_revalidate

        source = inspect.getsource(content_blog_revalidate)
        self.assertNotIn("openai", source.lower())
        self.assertNotIn("requests.post", source)
        self.assertNotIn("chat/completions", source)

    def test_r_serialization(self) -> None:
        *_rest, bundle = self._pipeline()
        preview = self._edit_section(to_legacy_blog_preview(bundle["draft"]), 0, extra_text="표현만 고쳤습니다.")
        result = revalidate_blog_v2_human_revision(bundle, self._body(bundle, preview=preview), db=self.db)
        encoded = serialize_blog_revalidation_result(result)
        decoded = json.loads(encoded)
        self.assertEqual(decoded["version"], "blog_revalidation_result_v1")
        self.assertIn("validationHistory", result["bundle"])
        json.dumps(result["effectiveDraft"], ensure_ascii=False)
        json.dumps(result["bundle"]["validationHistory"], ensure_ascii=False)
        json.dumps(result["bundle"]["reviewItems"], ensure_ascii=False)

    def test_s_v1_regression(self) -> None:
        self.harness._scope()
        appeal = self.harness._full_appeal()
        row = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="blog", sku_title="수자타 헤나 염색약")
        body = json.loads(row.body_json or "{}")
        self.assertEqual(body.get("generation_version"), "v1")
        saved = save_artifact_draft(self.db, artifact_id=row.artifact_id, title="V1 수정", body_json=body, export_text=row.export_text or "")
        self.assertEqual(saved.revision_reason, "human_edit")
        assert_blog_v2_accept_allowed(json.loads(saved.body_json or "{}"))

    def test_t_instagram_shorts_unchanged(self) -> None:
        self.harness._scope()
        appeal = self.harness._full_appeal()
        ig = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="instagram", sku_title="수자타 헤나 염색약")
        shorts = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="shorts", sku_title="수자타 헤나 염색약")
        self.assertEqual(json.loads(ig.body_json or "{}").get("generation_version"), "v1")
        self.assertEqual(json.loads(shorts.body_json or "{}").get("generation_version"), "v1")
        assert_blog_v2_accept_allowed(json.loads(ig.body_json or "{}"))
        assert_blog_v2_accept_allowed(json.loads(shorts.body_json or "{}"))

    def test_u_saved_revision_current_stale_current(self) -> None:
        *_rest, appeal, _planner, writer, quality, image, bundle = self._pipeline()
        preview = to_legacy_blog_preview(bundle["draft"])
        body = self._body(bundle, preview=preview)
        original = ContentArtifact(
            artifact_id="CT-reval-original",
            original_artifact_id="CT-reval-original",
            revision_no=1,
            revision_reason="phase8_acceptance",
            source="ai_original",
            sku_id="4743750201",
            appeal_id=appeal["appeal_id"],
            channel="blog",
            title=bundle["draft"]["selectedTitle"],
            body_json=json.dumps(body, ensure_ascii=False),
            export_text="original",
            reviewer_status="pending",
        )
        self.db.add(original)
        self.db.commit()
        edited_preview = self._edit_section(preview, 0, extra_text="저장 경로에서 표현만 고쳤습니다.")
        edited_body = self._body(bundle, preview=edited_preview)
        edited_body["blog_v2_review_bundle"]["humanReview"]["validationFreshness"] = FRESH_STALE
        saved = save_artifact_draft(
            self.db,
            artifact_id=original.artifact_id,
            title=edited_body["title"],
            body_json=edited_body,
            export_text="edited",
        )
        saved_body = json.loads(saved.body_json or "{}")
        self.assertEqual(saved_body["blog_v2_review_bundle"]["humanReview"]["validationFreshness"], FRESH_STALE)
        result = revalidate_blog_v2_artifact(self.db, saved.artifact_id)
        self.assertEqual(result["validationFreshness"], FRESH_CURRENT)
        refreshed = json.loads(self.db.query(ContentArtifact).filter(ContentArtifact.artifact_id == saved.artifact_id).one().body_json or "{}")
        self.assertEqual(refreshed["blog_v2_review_bundle"]["humanReview"]["validationFreshness"], FRESH_CURRENT)
        self.assertEqual(refreshed["blog_v2_review_bundle"]["draft"], bundle["draft"])

    def test_api_stale_accept_rejected(self) -> None:
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
        except ModuleNotFoundError as exc:
            self.skipTest(f"FastAPI test client is unavailable: {exc}")
        from content_center_api import register_content_center_routes

        *_rest, appeal, _planner, writer, quality, image, bundle = self._pipeline()
        bundle["humanReview"]["validationFreshness"] = FRESH_STALE
        body = self._body(bundle)
        row = ContentArtifact(
            artifact_id="CT-reval-stale",
            original_artifact_id="CT-reval-stale",
            revision_no=1,
            source="human",
            sku_id="4743750201",
            appeal_id=appeal["appeal_id"],
            channel="blog",
            title="stale",
            body_json=json.dumps(body, ensure_ascii=False),
            export_text="stale",
            reviewer_status="pending",
        )
        self.db.add(row)
        self.db.commit()
        app = FastAPI()

        def get_test_db():
            yield self.db

        register_content_center_routes(app, get_db_dep=get_test_db)
        client = TestClient(app)
        denied = client.patch("/content/artifacts/CT-reval-stale/review", json={"status": "accepted", "actor": "qa"})
        self.assertEqual(denied.status_code, 409)
        self.assertIn("stale", str(denied.json().get("detail") or "").lower())
        ok = client.post("/content/artifacts/CT-reval-stale/blog-v2/revalidate")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json().get("validationFreshness"), FRESH_CURRENT)
