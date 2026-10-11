from __future__ import annotations

import copy
import inspect
import json
import unittest

from content_blog_context import build_blog_generation_context
from content_blog_planner import STATUS_PASS, plan_blog_content
from content_blog_writer import (
    CODE_FAQ_BOUNDARY,
    CODE_INVALID_SOURCE_REFERENCE,
    CODE_PLANNER_STRUCTURE_VIOLATION,
    STATUS_HOLD,
    clean_blog_v2_paragraph,
    preserve_blog_v2_paragraphs,
    serialize_blog_professional_draft,
    to_legacy_blog_preview,
    write_blog_professional_draft,
)
from content_blog_writer_contract import (
    CODE_BRAND_FACT_FABRICATION,
    CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP,
    CODE_DEFENSIVE_META_LANGUAGE_LEAKAGE,
    CODE_INVALID_REFERENCE,
    CODE_PRODUCT_VALUE_NOT_COMMUNICATED,
    CODE_QUALIFIED_KNOWLEDGE_USED_WITHOUT_QUALIFIER,
    CODE_REVIEW_PATTERN_OVERCLAIM,
    CODE_UNSUPPORTED_SUPERIORITY,
)
from test_content_blog_context import BlogGenerationContextTest


class BlogProfessionalWriterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.harness = BlogGenerationContextTest("setUp")
        self.harness.setUp()
        self.db = self.harness.db

    def tearDown(self) -> None:
        self.harness.tearDown()

    def _full_bundle(self, *, snippet: str | None = None):
        self.harness._scope()
        appeal = self.harness._full_appeal(**({} if snippet is None else {"snippet": snippet}))
        context = build_blog_generation_context(self.db, appeal=appeal, sku_title="수자타 헤나 염색약")
        planner = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(planner["status"], STATUS_PASS, planner["issues"])
        return context, appeal, planner

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
        return context, planner

    def test_a_full_source_writer_keeps_plan_and_facts(self) -> None:
        context, _appeal, planner = self._full_bundle()
        original_context = copy.deepcopy(context)
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(result["status"], "PASS", result["issues"])
        draft = result["draft"]
        self.assertEqual(draft["version"], "blog_professional_draft_v1")
        planned_ids = [item["sectionId"] for item in planner["contentPlan"]["sections"]]
        written_ids = [item["sectionId"] for item in draft["sections"]]
        self.assertEqual(written_ids, planned_ids)
        planned_facts = {item["factId"] for section in planner["contentPlan"]["sections"] for item in section["factsToUse"]}
        used_facts = {ref for section in draft["sections"] for ref in section["sourceRefs"]}
        self.assertTrue(used_facts)
        self.assertTrue(used_facts.issubset(planned_facts))
        self.assertTrue(all(section["paragraphs"] for section in draft["sections"]))
        self.assertTrue(all(section["imageStatus"] == "PENDING" for section in draft["sections"]))
        blob = json.dumps(draft["sections"], ensure_ascii=False) + json.dumps(draft["lead"], ensure_ascii=False)
        self.assertNotIn("임상 시험", blob)
        self.assertNotIn("sf_insight_problem", " ".join(section["heading"] for section in draft["sections"]))
        self.assertEqual(draft["writerMode"], "EVIDENCE_BASED_MARKETING_V1")
        self.assertIn("knowledgeUsage", draft["sections"][0])
        self.assertEqual(context, original_context)
        preview = to_legacy_blog_preview(draft)
        self.assertEqual(preview["title"], draft["selectedTitle"])
        self.assertEqual(len(preview["title_candidates"]), len(draft["titleCandidates"]))

    def test_b_sparse_source_stays_short_and_warns(self) -> None:
        context, planner = self._sparse_bundle()
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(result["status"], "PASS", result["issues"])
        draft = result["draft"]
        self.assertIn("SPARSE_SOURCE", draft["draftWarnings"])
        public = " ".join(paragraph for section in draft["sections"] for paragraph in section["paragraphs"])
        self.assertNotIn("로소니아", public)
        self.assertNotIn("임상", public)
        self.assertTrue(all(len(section["sourceRefs"]) == 0 for section in draft["sections"]))
        total_chars = len(public)
        self.assertLess(total_chars, 1200)

    def test_c_no_fake_experience(self) -> None:
        context, _appeal, planner = self._full_bundle()
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        public = json.dumps(result["draft"], ensure_ascii=False)
        for phrase in ("직접 사용해보니", "써봤더니", "제가 사용했을 때", "직접 써보니"):
            self.assertNotIn(phrase, public)
        raw = copy.deepcopy(result["draft"])
        raw["sections"][0]["paragraphs"].append("직접 사용해보니 바로 달라졌습니다.")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], "FAKE_EXPERIENCE_GENERATION")

    def test_d_restricted_claim_is_rejected(self) -> None:
        context, _appeal, planner = self._full_bundle(snippet="탈모가 줄었다는 말은 없지만 색감은 자연스러워요")
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(result["status"], "PASS", result["issues"])
        public = json.dumps(result["draft"]["lead"], ensure_ascii=False) + json.dumps(result["draft"]["sections"], ensure_ascii=False)
        self.assertNotIn("탈모", public)
        self.assertNotIn("치료", public)
        self.assertNotIn("두피염", public)
        self.assertNotIn("머리가 덜 빠지", public)
        raw = copy.deepcopy(result["draft"])
        raw["sections"][0]["paragraphs"].append("두피 문제를 없애주고 머리가 덜 빠지게 합니다.")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], "RESTRICTED_CLAIM_LEAKAGE")

    def test_e_paragraph_preservation(self) -> None:
        from content_writer_service import _clean_text

        paragraphs = ["첫 문단입니다.", "둘째 문단입니다.", "셋째 문단입니다."]
        preserved = preserve_blog_v2_paragraphs(paragraphs)
        self.assertEqual(preserved, paragraphs)
        collapsed = _clean_text("\n\n".join(paragraphs))
        self.assertNotIn("\n", collapsed)
        context, _appeal, planner = self._full_bundle()
        valid = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        raw = copy.deepcopy(valid["draft"])
        raw["sections"][0]["paragraphs"] = paragraphs
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(result["draft"]["sections"][0]["paragraphs"], paragraphs)
        encoded = serialize_blog_professional_draft(result["draft"])
        decoded = json.loads(encoded)
        self.assertEqual(decoded["sections"][0]["paragraphs"], paragraphs)
        self.assertEqual(len(clean_blog_v2_paragraph("  한   문단  \n 유지  ").split("\n")), 1)

    def test_f_title_candidates_are_preserved(self) -> None:
        context, _appeal, planner = self._full_bundle()
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        draft = result["draft"]
        self.assertGreaterEqual(len(draft["titleCandidates"]), 1)
        self.assertTrue(draft["selectedTitle"])
        self.assertTrue(any(item["title"] == draft["selectedTitle"] for item in draft["titleCandidates"]))
        encoded = json.loads(serialize_blog_professional_draft(draft))
        self.assertEqual(encoded["titleCandidates"], draft["titleCandidates"])
        self.assertEqual(encoded["selectedTitle"], draft["selectedTitle"])

    def test_g_invalid_source_reference_is_hold(self) -> None:
        context, _appeal, planner = self._full_bundle()
        valid = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        raw = copy.deepcopy(valid["draft"])
        raw["sections"][0]["sourceRefs"].append("sf_fake_999")
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_INVALID_SOURCE_REFERENCE)
        self.assertTrue(any(item["code"] == CODE_INVALID_SOURCE_REFERENCE for item in result["issues"]))

    def test_h_planner_section_integrity(self) -> None:
        context, _appeal, planner = self._full_bundle()
        valid = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        raw = copy.deepcopy(valid["draft"])
        raw["sections"].append(
            {
                "sectionId": "S4",
                "heading": "전문가 의견",
                "paragraphs": ["확인되지 않은 연구 결과를 추가합니다."],
                "sourceRefs": [],
                "evidenceRefs": [],
                "imageStatus": "PENDING",
            }
        )
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_PLANNER_STRUCTURE_VIOLATION)
        written_ids = [item["sectionId"] for item in (result["draft"] or {}).get("sections", [])]
        self.assertNotIn("S4", written_ids)

    def test_i_faq_boundary(self) -> None:
        context, _appeal, planner = self._full_bundle()
        valid = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        raw = copy.deepcopy(valid["draft"])
        raw["faq"] = list(raw.get("faq") or []) + [{"question": "헤나가 탈모를 예방하나요?", "answer": "효과가 있습니다.", "sourceRefs": []}]
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertIn(result["code"], {CODE_FAQ_BOUNDARY, "RESTRICTED_CLAIM_LEAKAGE"})

    def test_j_general_knowledge_disabled(self) -> None:
        context, _appeal, planner = self._full_bundle()
        self.assertFalse(context["generationPolicy"]["allowGeneralKnowledge"])
        valid = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        raw = copy.deepcopy(valid["draft"])
        raw["sections"][0]["paragraphs"].append("헤나의 색소 성분은 임상 시험 성적으로 입증되었습니다.")
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], "GENERAL_KNOWLEDGE_LEAKAGE")

    def test_k_draft_json_serializes(self) -> None:
        context, _appeal, planner = self._full_bundle()
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        encoded = serialize_blog_professional_draft(result["draft"])
        decoded = json.loads(encoded)
        self.assertEqual(decoded["version"], "blog_professional_draft_v1")
        self.assertEqual(decoded["seoKeywordOrigin"], "MODEL_DERIVED_CONTENT_KEYWORDS")
        self.assertEqual(decoded["writerProvenance"]["writerVersion"], "blog_professional_writer_v1")
        self.assertEqual(decoded["writerProvenance"]["generationVersion"], "blog_v2")

    def test_l_production_routing_and_channels_unchanged(self) -> None:
        from content_center_generate import generate_artifact
        from content_writer_service import build_generation_context, write_channel_content

        context, appeal, planner = self._full_bundle()
        write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        import content_blog_context
        import content_blog_planner
        import content_center_generate
        import content_writer_service

        self.assertNotIn("content_blog_writer", inspect.getsource(content_center_generate))
        self.assertNotIn("content_blog_writer", inspect.getsource(content_writer_service))
        self.assertNotIn("write_blog_professional_draft", inspect.getsource(content_blog_context))
        self.assertNotIn("write_blog_professional_draft", inspect.getsource(content_blog_planner))

        ig_ctx = build_generation_context(self.db, appeal=appeal, channel="instagram", sku_title="수자타 헤나 염색약")
        shorts_ctx = build_generation_context(self.db, appeal=appeal, channel="shorts", sku_title="수자타 헤나 염색약")
        ig_payload = write_channel_content(self.db, context=ig_ctx)
        shorts_payload = write_channel_content(self.db, context=shorts_ctx)
        self.assertEqual(ig_payload["format"], "instagram_carousel_v1")
        self.assertEqual(shorts_payload["format"], "shorts_scene_timeline_v1")

        blog = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="blog", sku_title="수자타 헤나 염색약")
        body = json.loads(blog.body_json or "{}")
        self.assertEqual(body.get("generation_version"), "v1")
        self.assertEqual(body["generation_engine"], "LLM_WRITER_V1")
        self.assertNotIn("blog_professional_draft_v1", json.dumps(body))
        self.assertNotIn("titleCandidates", body.get("blog", {}))

    def _valid_draft(self):
        context, _appeal, planner = self._full_bundle()
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(result["status"], "PASS", result["issues"])
        return context, planner, copy.deepcopy(result["draft"])

    def _qualified_ck_id(self, context: dict) -> str:
        knowledge = context.get("marketingKnowledge") if isinstance(context.get("marketingKnowledge"), dict) else {}
        for item in knowledge.get("categoryKnowledge") or []:
            if isinstance(item, dict) and item.get("knowledgeUsePolicy") == "QUALIFIED_EDUCATION_ONLY" and item.get("knowledgeId"):
                return str(item["knowledgeId"])
        raise AssertionError("qualified category knowledge is required for writer realignment tests")

    def test_61_product_marketing_without_brand_fabrication(self) -> None:
        context, planner, raw = self._valid_draft()
        knowledge = context.get("marketingKnowledge") or {}
        self.assertEqual(knowledge.get("brandKnowledge") or [], [])
        public = json.dumps(raw, ensure_ascii=False)
        self.assertTrue(raw["sourceUsage"]["productKnowledgeUsed"] or any("수자타" in json.dumps(section, ensure_ascii=False) for section in raw["sections"]))
        self.assertNotIn("자연주의 철학", public)
        self.assertNotIn("유기농 원료만", public)
        raw["sections"][0]["paragraphs"].append("수자타는 자연주의 철학을 고수해온 브랜드입니다.")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], CODE_BRAND_FACT_FABRICATION)

    def test_62_category_education_without_product_superiority(self) -> None:
        context, planner, draft = self._valid_draft()
        used_ck = draft["sourceUsage"]["categoryKnowledgeUsed"]
        self.assertTrue(used_ck)
        public = json.dumps(draft, ensure_ascii=False)
        self.assertNotIn("수자타 제품이 더 잘 염색", public)
        self.assertNotIn("헤나가 더 안전", public)
        raw = copy.deepcopy(draft)
        raw["sections"][0]["paragraphs"].append("헤나가 더 안전하고 수자타 헤나는 염색력이 우수합니다.")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertIn(rejected["code"], {CODE_UNSUPPORTED_SUPERIORITY, CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP})

    def test_63_qualified_ck_requires_body_qualifier(self) -> None:
        context, planner, raw = self._valid_draft()
        qid = self._qualified_ck_id(context)
        raw["sections"][0]["knowledgeUsage"]["categoryKnowledgeRefs"] = [qid]
        raw["sections"][0]["qualifiedKnowledgeUsage"] = [
            {
                "knowledgeRef": qid,
                "qualificationRequired": True,
                "qualificationApplied": True,
                "qualificationText": "일부 실험 조건에서는",
            }
        ]
        raw["sections"][0]["paragraphs"].append("일부 실험 조건에서는 헤나와 케라틴 상호작용 가능성이 제시되지만 일반 효능으로 단정하지 않습니다.")
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(result["status"], "PASS", result["issues"])
        record = result["draft"]["sections"][0]["qualifiedKnowledgeUsage"][0]
        self.assertTrue(record["qualificationApplied"])
        self.assertIn(record["qualificationText"], " ".join(result["draft"]["sections"][0]["paragraphs"]))

    def test_64_missing_qualifier_is_hold(self) -> None:
        context, planner, raw = self._valid_draft()
        qid = self._qualified_ck_id(context)
        raw["sections"][0]["knowledgeUsage"]["categoryKnowledgeRefs"] = [qid]
        raw["sections"][0]["qualifiedKnowledgeUsage"] = [
            {
                "knowledgeRef": qid,
                "qualificationRequired": True,
                "qualificationApplied": True,
                "qualificationText": "일부 실험 조건에서는",
            }
        ]
        raw["sections"][0]["paragraphs"] = ["헤나와 케라틴은 항상 같은 방식으로 결합합니다."]
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], CODE_QUALIFIED_KNOWLEDGE_USED_WITHOUT_QUALIFIER)

    def test_65_category_product_leap_is_hold(self) -> None:
        context, planner, raw = self._valid_draft()
        ck = (raw["sourceUsage"].get("categoryKnowledgeUsed") or ["CK-HENNA-8099abb9"])[0]
        raw["sections"][0]["knowledgeUsage"] = {
            "productKnowledgeRefs": [],
            "brandKnowledgeRefs": [],
            "categoryKnowledgeRefs": [ck],
            "experiencePatternRefs": [],
        }
        raw["sections"][0]["paragraphs"].append("수자타 제품이 더 잘 염색된다.")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP)

    def test_66_review_pattern_without_fake_experience(self) -> None:
        context, planner, draft = self._valid_draft()
        self.assertTrue(draft["sourceUsage"]["experiencePatternsUsed"])
        public = json.dumps(draft, ensure_ascii=False)
        for phrase in ("직접 사용해보니", "써봤더니", "제가 사용했을 때"):
            self.assertNotIn(phrase, public)
        self.assertIn("리뷰", public)

    def test_67_review_pattern_overclaim_is_hold(self) -> None:
        context, planner, raw = self._valid_draft()
        raw["sections"][0]["paragraphs"].append("대부분 고객이 만족했습니다.")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], CODE_REVIEW_PATTERN_OVERCLAIM)

    def test_68_defensive_meta_language_is_hold(self) -> None:
        context, planner, raw = self._valid_draft()
        raw["sections"][0]["paragraphs"].append("현재 제공된 정보로 말할 수 있는 범위는 상품명과 URL뿐입니다.")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], CODE_DEFENSIVE_META_LANGUAGE_LEAKAGE)

    def test_69_no_science_when_category_knowledge_missing(self) -> None:
        context, planner = self._sparse_bundle()
        result = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner)
        self.assertEqual(result["status"], "PASS", result["issues"])
        public = json.dumps(result["draft"], ensure_ascii=False)
        self.assertEqual(result["draft"]["sourceUsage"]["categoryKnowledgeUsed"], [])
        self.assertNotIn("lawsone", public)
        self.assertNotIn("단백질 공급", public)
        self.assertNotIn("로소니아", public)

    def test_70_marketing_cta_without_hard_sell(self) -> None:
        _context, _planner, draft = self._valid_draft()
        cta = (draft.get("cta") or {}).get("text") or ""
        self.assertTrue(cta)
        self.assertNotIn("제품 정보는 URL에서 확인할 수 있습니다", cta)
        self.assertNotIn("지금 바로 구매하세요", cta)
        self.assertNotIn("최고의 선택입니다", cta)

    def test_71_invented_knowledge_ids_are_invalid(self) -> None:
        context, planner, raw = self._valid_draft()
        raw["sections"][0]["knowledgeUsage"]["categoryKnowledgeRefs"].append("CK-FAKE-999")
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertEqual(rejected["code"], CODE_INVALID_REFERENCE)

    def test_72_writer_does_not_add_llm_planner_or_validator_stage(self) -> None:
        import content_blog_writer

        source = inspect.getsource(content_blog_writer)
        self.assertNotIn("plan_blog_content(", source)
        self.assertNotIn("validate_blog_quality(", source)
        self.assertIn('allowGeneralKnowledge": False', source)

    def test_product_value_avoidance_is_hold_when_product_knowledge_exists(self) -> None:
        context, planner, raw = self._valid_draft()
        for section in raw["sections"]:
            section["knowledgeUsage"]["productKnowledgeRefs"] = []
            section["paragraphs"] = ["상세정보를 확인하세요.", "상품URL에서 직접 확인하는 것이 적절합니다."]
        raw["cta"] = {"type": "CHECK_PRODUCT_INFO", "text": "제품 정보는 URL에서 확인할 수 있습니다."}
        rejected = write_blog_professional_draft(self.db, blog_context=context, planner_result=planner, raw_draft=raw)
        self.assertEqual(rejected["status"], STATUS_HOLD)
        self.assertIn(rejected["code"], {CODE_PRODUCT_VALUE_NOT_COMMUNICATED, CODE_DEFENSIVE_META_LANGUAGE_LEAKAGE})

