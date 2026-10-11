from __future__ import annotations

import copy
import inspect
import json
import unittest

from content_blog_context import build_blog_generation_context
from content_blog_planner import (
    CLASSIFICATION_PLANNING_INFERENCE,
    CODE_INVALID_REFERENCE,
    STATUS_HOLD,
    STATUS_PASS,
    plan_blog_content,
    serialize_blog_content_plan,
    serialize_blog_intent_analysis,
)
from test_content_blog_context import BlogGenerationContextTest


class BlogPlannerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.harness = BlogGenerationContextTest("setUp")
        self.harness.setUp()
        self.db = self.harness.db

    def tearDown(self) -> None:
        self.harness.tearDown()

    def _full_context(self, *, snippet: str | None = None):
        self.harness._scope()
        appeal = self.harness._full_appeal(**({} if snippet is None else {"snippet": snippet}))
        context = build_blog_generation_context(self.db, appeal=appeal, sku_title="수자타 헤나 염색약")
        return context, appeal

    def _sparse_context(self):
        appeal = {
            "sku_id": "",
            "appeal_id": "",
            "label": "",
            "appeal_text": "",
            "evidence": [],
            "insight": {},
        }
        return build_blog_generation_context(self.db, appeal=appeal, sku_title="")

    def test_a_full_source_builds_intent_and_plan(self) -> None:
        context, _appeal = self._full_context()
        original = copy.deepcopy(context)
        result = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        intent = result["intentAnalysis"]
        plan = result["contentPlan"]
        self.assertEqual(intent["version"], "blog_intent_analysis_v1")
        self.assertEqual(plan["version"], "blog_content_plan_v1")
        self.assertIn(intent["primaryIntent"], {"HOW_TO", "INFORMATION", "PROBLEM_SOLUTION", "EXPERT_GUIDE"})
        self.assertTrue(intent["secondaryIntents"])
        self.assertTrue(intent["readerQuestions"])
        self.assertTrue(plan["sections"])
        fact_ids = {item["factId"] for item in context["sourceFacts"]}
        evidence_ids = {item["evidenceId"] for item in context["evidence"]}
        used_facts = {item["factId"] for section in plan["sections"] for item in section["factsToUse"]}
        used_evidence = {item["evidenceRef"] for section in plan["sections"] for item in section["evidenceToUse"]}
        self.assertTrue(used_facts)
        self.assertTrue(used_facts.issubset(fact_ids))
        self.assertTrue(used_evidence.issubset(evidence_ids))
        self.assertFalse(any(item["classification"] in {"FACT_SOURCE", "PRODUCT_SOURCE"} for item in [intent["audienceHypothesis"], intent["categoryHypothesis"]]))
        self.assertNotIn("로소니아", json.dumps(plan, ensure_ascii=False))
        self.assertNotIn("왁스 에스터", json.dumps(plan, ensure_ascii=False))
        self.assertEqual(context, original)

    def test_b_sparse_source_does_not_fill_with_general_knowledge(self) -> None:
        context = self._sparse_context()
        result = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        plan = result["contentPlan"]
        self.assertTrue(plan["unsupportedTopics"])
        self.assertIsNone(plan["coreAnswer"])
        self.assertTrue(all(not section["factsToUse"] for section in plan["sections"]))
        coverage_statuses = {item["status"] for item in plan["coverage"]["readerQuestions"]}
        self.assertIn("SOURCE_INSUFFICIENT", coverage_statuses)
        blob = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("로소니아", blob)
        self.assertNotIn("임상", blob)
        self.assertNotIn("시험 성적", blob)

    def test_c_unknown_audience_stays_planning_inference(self) -> None:
        context, _appeal = self._full_context()
        self.assertEqual(context["targetAudience"]["status"], "UNKNOWN")
        result = plan_blog_content(self.db, blog_context=context)
        audience = result["intentAnalysis"]["audienceHypothesis"]
        self.assertEqual(audience["classification"], CLASSIFICATION_PLANNING_INFERENCE)
        self.assertTrue(audience["primary"])
        self.assertIsNone(context["targetAudience"]["primary"])
        self.assertEqual(context["targetAudience"]["status"], "UNKNOWN")
        self.assertNotIn("30~40대", audience["primary"] or "")
        self.assertNotIn("민감성 두피", audience["primary"] or "")

    def test_d_keyword_plan_is_model_derived_and_unverified(self) -> None:
        context, _appeal = self._full_context()
        result = plan_blog_content(self.db, blog_context=context)
        keyword = result["intentAnalysis"]["keywordPlan"]
        self.assertTrue(keyword["primaryKeyword"])
        self.assertEqual(keyword["origin"], "MODEL_DERIVED")
        self.assertFalse(keyword["verifiedSearchData"])
        blob = json.dumps(keyword, ensure_ascii=False)
        self.assertNotIn("네이버 인기", blob)
        self.assertNotIn("검색량", blob)
        self.assertNotIn("스마트블록", blob)

    def test_e_restricted_claim_is_not_promoted(self) -> None:
        context, _appeal = self._full_context(snippet="탈모가 줄었다는 말은 없지만 색감은 자연스러워요")
        result = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        plan = result["contentPlan"]
        core = str(plan.get("coreAnswer") or "")
        self.assertNotIn("탈모", core)
        self.assertNotIn("치료", core)
        used_statements = " ".join(item["statement"] for section in plan["sections"] for item in section["factsToUse"])
        self.assertNotIn("탈모", used_statements)
        avoid = {term for section in plan["sections"] for term in section["claimsToAvoid"]}
        unsupported = json.dumps(plan["unsupportedTopics"], ensure_ascii=False)
        self.assertTrue("탈모" in avoid or "탈모" in unsupported)
        self.assertTrue("치료" in avoid or "치료" in unsupported)

    def test_f_invalid_hallucinated_fact_id_is_hold(self) -> None:
        context, _appeal = self._full_context()
        valid = plan_blog_content(self.db, blog_context=context)
        raw = {
            "intentAnalysis": valid["intentAnalysis"],
            "contentPlan": copy.deepcopy(valid["contentPlan"]),
        }
        raw["contentPlan"]["sections"][0]["factsToUse"] = [{"factId": "sf_nonexistent_999"}]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_INVALID_REFERENCE)
        self.assertTrue(any(item["code"] == CODE_INVALID_REFERENCE for item in result["issues"]))
        self.assertFalse(any(item.get("factId") == "sf_nonexistent_999" for section in (result["contentPlan"] or {}).get("sections", []) for item in section.get("factsToUse", [])))

    def test_g_general_knowledge_disabled_blocks_source_external_science(self) -> None:
        context, _appeal = self._full_context()
        self.assertFalse(context["generationPolicy"]["allowGeneralKnowledge"])
        valid = plan_blog_content(self.db, blog_context=context)
        raw = {
            "intentAnalysis": valid["intentAnalysis"],
            "contentPlan": copy.deepcopy(valid["contentPlan"]),
        }
        raw["contentPlan"]["sections"][0]["inferencesAllowed"] = ["로소니아 성분의 임상 시험 성적에서 탈모 개선이 확인됨"]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertIn(result["code"], {"GENERAL_KNOWLEDGE_LEAKAGE", "RESTRICTED_CLAIM_LEAKAGE"})

    def test_h_intent_and_plan_json_serialize(self) -> None:
        context, _appeal = self._full_context()
        result = plan_blog_content(self.db, blog_context=context)
        intent_json = serialize_blog_intent_analysis(result["intentAnalysis"])
        plan_json = serialize_blog_content_plan(result["contentPlan"])
        self.assertEqual(json.loads(intent_json)["version"], "blog_intent_analysis_v1")
        self.assertEqual(json.loads(plan_json)["version"], "blog_content_plan_v1")
        json.dumps(result, ensure_ascii=False)

    def test_i_production_routing_and_channels_unchanged(self) -> None:
        from content_center_generate import generate_artifact
        from content_writer_service import build_generation_context, write_channel_content

        context, appeal = self._full_context()
        plan_blog_content(self.db, blog_context=context)
        import content_blog_context
        import content_center_generate
        import content_writer_service

        self.assertNotIn("content_blog_planner", inspect.getsource(content_center_generate))
        self.assertNotIn("content_blog_planner", inspect.getsource(content_writer_service))
        self.assertNotIn("content_blog_planner", inspect.getsource(content_blog_context))

        ig_ctx = build_generation_context(self.db, appeal=appeal, channel="instagram", sku_title="수자타 헤나 염색약")
        shorts_ctx = build_generation_context(self.db, appeal=appeal, channel="shorts", sku_title="수자타 헤나 염색약")
        ig_payload = write_channel_content(self.db, context=ig_ctx)
        shorts_payload = write_channel_content(self.db, context=shorts_ctx)
        self.assertEqual(ig_payload["format"], "instagram_carousel_v1")
        self.assertEqual(shorts_payload["format"], "shorts_scene_timeline_v1")
        self.assertNotIn("contentPlan", ig_payload)
        self.assertNotIn("intentAnalysis", shorts_payload)

        blog = generate_artifact(self.db, plan=None, sku_id="4743750201", appeal_id=appeal["appeal_id"], channel="blog", sku_title="수자타 헤나 염색약")
        body = json.loads(blog.body_json or "{}")
        self.assertEqual(body.get("generation_version"), "v1")
        self.assertEqual(body["generation_engine"], "LLM_WRITER_V1")
        self.assertNotIn("blog_generation", body)
        self.assertNotIn("contentPlan", body)

    def _valid_raw(self, context):
        valid = plan_blog_content(self.db, blog_context=context)
        return {
            "intentAnalysis": copy.deepcopy(valid["intentAnalysis"]),
            "contentPlan": copy.deepcopy(valid["contentPlan"]),
        }

    def test_phase8_ref_a_canonical_evidence_id(self) -> None:
        from content_blog_planner import CODE_INVALID_REFERENCE as invalid

        context, _appeal = self._full_context()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][0]["evidenceToUse"] = [{"evidenceRef": "EV-full", "purpose": "후기 근거"}]
        raw["contentPlan"]["sections"][0]["sourceRefs"] = ["EV-full"]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        used = {item["evidenceRef"] for section in result["contentPlan"]["sections"] for item in section["evidenceToUse"]}
        self.assertIn("EV-full", used)
        self.assertFalse(any(item["code"] == invalid for item in result["issues"]))

    def test_phase8_ref_b_prefixed_evidence_id_stays_hold(self) -> None:
        context, _appeal = self._full_context()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][0]["sourceRefs"] = ["review:EV-full"]
        raw["contentPlan"]["sections"][0]["evidenceToUse"] = [{"evidenceRef": "review:EV-full", "purpose": "후기"}]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_INVALID_REFERENCE)
        refs = [item.get("ref") or item.get("evidenceRef") for item in result["issues"] if item["code"] == CODE_INVALID_REFERENCE]
        self.assertTrue(any(ref == "review:EV-full" for ref in refs))
        blob = json.dumps(result["issues"], ensure_ascii=False)
        self.assertIn("review:EV-full", blob)
        normalized = [item["evidenceRef"] for section in (result["contentPlan"] or {}).get("sections", []) for item in section.get("evidenceToUse", [])]
        self.assertNotIn("EV-full", normalized)

    def test_phase8_ref_c_evidence_object_shape(self) -> None:
        context, _appeal = self._full_context()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][0]["evidenceToUse"] = [{"statement": "후기 문장", "sourceType": "REVIEW_SOURCE"}]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_INVALID_REFERENCE)

    def test_phase8_ref_d_invented_id(self) -> None:
        context, _appeal = self._full_context()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][0]["evidenceToUse"] = [{"evidenceRef": "EV-999", "purpose": "없음"}]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_INVALID_REFERENCE)

    def test_phase8_ref_e_restricted_claim_in_content_field(self) -> None:
        from content_blog_planner import CODE_RESTRICTED_CLAIM_LEAKAGE

        context, _appeal = self._full_context()
        raw = self._valid_raw(context)
        raw["contentPlan"]["coreAnswer"] = "호호바오일로 두피 치료를 안내한다."
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_RESTRICTED_CLAIM_LEAKAGE)

    def test_phase8_ref_f_restricted_claim_in_control_field(self) -> None:
        context, _appeal = self._full_context()
        raw = self._valid_raw(context)
        for section in raw["contentPlan"]["sections"]:
            section["claimsToAvoid"] = ["탈모 치료"]
            section["inferencesAllowed"] = ["제품명과 후기 범위만 사용한다"]
        raw["contentPlan"]["coreAnswer"] = "제공된 제품명과 후기 범위만 안내한다."
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        avoid = {term for section in result["contentPlan"]["sections"] for term in section["claimsToAvoid"]}
        self.assertTrue(any("치료" in term for term in avoid))

    def test_phase8_ref_g_unsupported_topic_control_field(self) -> None:
        context, _appeal = self._full_context()
        raw = self._valid_raw(context)
        raw["contentPlan"]["unsupportedTopics"] = [
            {"topic": "탈모", "reason": "RESTRICTED_CLAIM_AND_NO_SUPPORTED_SOURCE", "action": "DO_NOT_GENERATE_AS_FACT"}
        ]
        raw["contentPlan"]["coreAnswer"] = "제공된 제품 정보 범위만 확인한다."
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        topics = result["contentPlan"]["unsupportedTopics"]
        self.assertTrue(any(item.get("topic") == "탈모" for item in topics))
        titles = " ".join(item.get("title") or "" for item in result["contentPlan"]["workingTitleCandidates"])
        self.assertNotIn("탈모", titles)
        self.assertNotIn("탈모", str(result["contentPlan"].get("coreAnswer") or ""))
