from __future__ import annotations

import copy
import inspect
import json
import unittest

from content_blog_context import build_blog_generation_context
from content_blog_marketing_knowledge import (
    CLASS_APPROVED_PRODUCT,
    CLASS_SOURCE_DERIVED_INFERENCE,
    CLASS_VERIFIED_CATEGORY,
    STATUS_INFERENCE,
    STATUS_MISSING,
    STATUS_SOURCE_GROUNDED,
    STATUS_UNKNOWN,
    build_blog_marketing_knowledge,
)
from content_blog_planner import (
    CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP,
    CODE_DEFENSIVE_META_SECTION,
    CODE_EXPERIENCE_PATTERN_INVALID,
    CODE_GENERAL_KNOWLEDGE_LEAKAGE,
    CODE_INVALID_REFERENCE,
    CODE_MARKETING_OBJECTIVE_INVALID,
    CODE_PRODUCT_STRENGTH_WITHOUT_SOURCE,
    CODE_RESTRICTED_CLAIM_LEAKAGE,
    CODE_UNSUPPORTED_SUPERIORITY,
    STATUS_HOLD,
    STATUS_PASS,
    plan_blog_content,
)
from content_blog_writer import write_blog_professional_draft
from content_writer_service import build_generation_context
from test_content_blog_context import BlogGenerationContextTest


class BlogMarketingKnowledgeAndPlannerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.harness = BlogGenerationContextTest("setUp")
        self.harness.setUp()
        self.db = self.harness.db

    def tearDown(self) -> None:
        self.harness.tearDown()

    def _full(self):
        self.harness._scope()
        appeal = self.harness._full_appeal()
        base = build_generation_context(self.db, appeal=appeal, channel="blog", sku_title="수자타 헤나 염색약")
        context = build_blog_generation_context(self.db, base_context=base, appeal=appeal)
        return context, appeal, base

    def _sparse(self):
        appeal = {"sku_id": "", "appeal_id": "", "label": "", "appeal_text": "", "evidence": [], "insight": {}}
        return build_blog_generation_context(self.db, appeal=appeal, sku_title="")

    def _valid_raw(self, context):
        valid = plan_blog_content(self.db, blog_context=context)
        return {
            "intentAnalysis": copy.deepcopy(valid["intentAnalysis"]),
            "contentPlan": copy.deepcopy(valid["contentPlan"]),
        }

    def test_a_commercial_brief_propagation(self) -> None:
        context, _appeal, base = self._full()
        brief = context["marketingKnowledge"]["marketingObjective"]["commercialBrief"]
        self.assertEqual(brief["status"], STATUS_SOURCE_GROUNDED)
        self.assertEqual(brief["source"], "generation_context.commercial_brief")
        self.assertEqual(brief["rawValue"], base["commercial_brief"])
        self.assertIn("commercial_brief", context["marketingKnowledge"]["marketingObjective"]["sourceRefs"])

    def test_b_missing_commercial_brief_is_unknown(self) -> None:
        context = self._sparse()
        brief = context["marketingKnowledge"]["marketingObjective"]["commercialBrief"]
        self.assertEqual(brief["status"], STATUS_UNKNOWN)
        self.assertIsNone(brief["rawValue"])
        self.assertFalse(any("자연스러운 색감으로 반복 관리" in json.dumps(context["marketingKnowledge"], ensure_ascii=False) for _ in [0]))

    def test_c_approved_product_knowledge_keeps_fact_ref(self) -> None:
        context, _appeal, _base = self._full()
        approved = [item for item in context["marketingKnowledge"]["productKnowledge"] if item["knowledgeClass"] == CLASS_APPROVED_PRODUCT]
        self.assertTrue(approved)
        title = next(item for item in approved if "수자타 헤나 염색약" in item["statement"])
        self.assertTrue(title["factRefs"])
        self.assertTrue(title["knowledgeId"].startswith("PK-"))
        self.assertEqual(title["knowledgeId"], f"PK-{title['factRefs'][0]}")

    def test_d_detail_page_stays_inference(self) -> None:
        context, _appeal, _base = self._full()
        inferred = [item for item in context["marketingKnowledge"]["productKnowledge"] if item["verificationStatus"] == STATUS_INFERENCE]
        self.assertTrue(inferred)
        self.assertTrue(all(item["knowledgeClass"] == CLASS_SOURCE_DERIVED_INFERENCE for item in inferred))
        self.assertFalse(any(item["knowledgeClass"] == CLASS_APPROVED_PRODUCT and item["verificationStatus"] == STATUS_INFERENCE for item in context["marketingKnowledge"]["productKnowledge"]))

    def test_e_verified_category_knowledge_fixture(self) -> None:
        context, appeal, base = self._full()
        base = copy.deepcopy(base)
        base["verifiedCategoryKnowledge"] = [
            {
                "topic": "henna coloring",
                "statement": "헤나 착색은 식물성 색소 성분과 모발 단백질의 상호작용으로 설명된다.",
                "sourceRefs": ["PAPER-HENNA-1"],
                "sourceAuthority": "PEER_REVIEWED",
                "knowledgeId": "CK-henna-mechanism",
            }
        ]
        rebuilt = build_blog_generation_context(self.db, base_context=base, appeal=appeal)
        category = rebuilt["marketingKnowledge"]["categoryKnowledge"]
        ids = {item["knowledgeId"] for item in category}
        self.assertIn("CK-henna-mechanism", ids)
        self.assertTrue(any(item["knowledgeClass"] == CLASS_VERIFIED_CATEGORY for item in category))
        self.assertGreaterEqual(len(category), 1)
        raw = self._valid_raw(rebuilt)
        raw["contentPlan"]["sections"][1]["categoryKnowledgeRefs"] = ["CK-henna-mechanism"]
        raw["contentPlan"]["knowledgeUsePlan"] = [{"knowledgeRef": "CK-henna-mechanism", "use": "EDUCATION"}]
        result = plan_blog_content(self.db, blog_context=rebuilt, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])

    def test_f_category_knowledge_missing(self) -> None:
        context = self._sparse()
        self.assertEqual(context["marketingKnowledge"]["categoryKnowledge"], [])
        gaps = {item["gapId"]: item for item in context["marketingKnowledge"]["knowledgeGaps"]}
        self.assertEqual(gaps["KG-category"]["status"], STATUS_MISSING)
        self.assertFalse(gaps["KG-category"]["readerFacing"])

    def test_g_unverified_general_knowledge_hold(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["knowledgeUsePlan"] = [{"knowledgeRef": "GK-made-up", "use": "EDUCATION"}]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertIn(result["code"], {CODE_INVALID_REFERENCE, CODE_GENERAL_KNOWLEDGE_LEAKAGE})

    def test_h_experience_pattern_support_count(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["experiencePatterns"] = [
            {
                "patternId": "XP-3",
                "label": "반복 사용 맥락",
                "interpretation": "후기 3건에서 반복 관리 맥락이 보인다.",
                "evidenceRefs": ["EV-full", "EV-full", "EV-full"],
                "supportCount": 3,
                "patternType": "MODEL_DERIVED_FROM_EVIDENCE",
                "marketingUse": "SOCIAL_PROOF",
            }
        ]
        for section in raw["contentPlan"]["sections"]:
            section["experiencePatternRefs"] = ["XP-3"]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        pattern = result["contentPlan"]["experiencePatterns"][0]
        self.assertEqual(pattern["supportCount"], 3)
        self.assertEqual(pattern["evidenceRefs"], ["EV-full", "EV-full", "EV-full"])

    def test_i_invented_review_hold(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["experiencePatterns"] = [
            {
                "patternId": "XP-fake",
                "label": "없는 후기",
                "interpretation": "존재하지 않는 후기",
                "evidenceRefs": ["EV-does-not-exist"],
                "supportCount": 1,
                "patternType": "MODEL_DERIVED_FROM_EVIDENCE",
                "marketingUse": "SOCIAL_PROOF",
            }
        ]
        for section in raw["contentPlan"]["sections"]:
            section["experiencePatternRefs"] = []
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_EXPERIENCE_PATTERN_INVALID)

    def test_j_defensive_meta_section_hold(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][0]["headingIntent"] = "이 글에서 말할 수 있는 것과 확인이 필요한 것"
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_DEFENSIVE_META_SECTION)

    def test_k_knowledge_gap_internal_not_section(self) -> None:
        context, _appeal, _base = self._full()
        result = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        self.assertTrue(any(item.get("domain") == "CATEGORY" for item in result["contentPlan"]["knowledgeGaps"]))
        blob = " ".join(
            f"{section.get('headingIntent')} {section.get('purpose')}"
            for section in result["contentPlan"]["sections"]
        )
        self.assertNotIn("말할 수 있는 것", blob)
        self.assertNotIn("제품 정보의 범위", blob)

    def test_l_marketing_objective_required_fields(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["intentAnalysis"]["marketingIntent"]["customerProblem"] = ""
        raw["intentAnalysis"]["marketingIntent"]["coreMarketingMessage"] = ""
        raw["intentAnalysis"]["marketingIntent"]["desiredAction"] = ""
        raw["contentPlan"]["marketingStrategy"]["coreCustomerProblem"] = ""
        raw["contentPlan"]["marketingStrategy"]["coreMarketingMessage"] = ""
        raw["contentPlan"]["marketingStrategy"]["ctaIntent"] = ""
        raw["contentPlan"]["ctaPlan"]["intent"] = ""
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_MARKETING_OBJECTIVE_INVALID)

    def test_m_product_strength_requires_source(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["marketingStrategy"]["selectedProductStrengths"] = [
            {"message": "머릿결이 좋아진다", "knowledgeRefs": [], "factRefs": [], "evidenceRefs": []}
        ]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_PRODUCT_STRENGTH_WITHOUT_SOURCE)

    def test_n_unsupported_superiority_hold(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["marketingStrategy"]["coreMarketingMessage"] = "시중 최고 헤나로 소개한다"
        raw["intentAnalysis"]["marketingIntent"]["coreMarketingMessage"] = "시중 최고 헤나로 소개한다"
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_UNSUPPORTED_SUPERIORITY)

    def test_o_category_to_product_leap_hold(self) -> None:
        context, appeal, base = self._full()
        base = copy.deepcopy(base)
        base["verifiedCategoryKnowledge"] = [
            {
                "topic": "lawsone",
                "statement": "lawsone이 헤나 착색과 관련됨",
                "sourceRefs": ["PAPER-1"],
                "knowledgeId": "CK-lawsone",
            }
        ]
        rebuilt = build_blog_generation_context(self.db, base_context=base, appeal=appeal)
        raw = self._valid_raw(rebuilt)
        raw["contentPlan"]["marketingStrategy"]["selectedProductStrengths"] = [
            {
                "message": "수자타 제품은 lawsone 함량이 높아서 염색력이 우수하다",
                "knowledgeRefs": ["CK-lawsone"],
                "factRefs": [],
                "evidenceRefs": [],
            }
        ]
        result = plan_blog_content(self.db, blog_context=rebuilt, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP)

    def test_p_restricted_claim_still_hold(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["marketingStrategy"]["coreMarketingMessage"] = "호호바오일로 두피 치료를 안내한다"
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_RESTRICTED_CLAIM_LEAKAGE)

    def test_q_control_field_restricted_term_pass(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][0]["claimsToAvoid"] = ["탈모 치료"]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])

    def test_r_writer_backward_compatibility(self) -> None:
        context, _appeal, _base = self._full()
        planned = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(planned["status"], STATUS_PASS, planned["issues"])
        written = write_blog_professional_draft(
            self.db,
            blog_context=context,
            intent_analysis=planned["intentAnalysis"],
            content_plan=planned["contentPlan"],
        )
        self.assertEqual(written["status"], "PASS", written["issues"])
        self.assertTrue(written["draft"]["sections"])

    def test_s_no_additional_llm_in_knowledge_layer(self) -> None:
        import content_blog_marketing_knowledge as module

        source = inspect.getsource(module)
        self.assertNotIn("requests.post", source)
        self.assertNotIn("openai", source.lower())
        self.assertNotIn("chat/completions", source)

    def test_t_upstream_evidence_not_mutated(self) -> None:
        context, _appeal, _base = self._full()
        original_facts = copy.deepcopy(context["sourceFacts"])
        original_evidence = copy.deepcopy(context["evidence"])
        plan_blog_content(self.db, blog_context=context)
        self.assertEqual(context["sourceFacts"], original_facts)
        self.assertEqual(context["evidence"], original_evidence)

    def test_customer_context_uses_existing_desire_barrier(self) -> None:
        context, _appeal, base = self._full()
        customer = context["marketingKnowledge"]["customerContext"]
        self.assertEqual(customer["problem"]["rawValue"], base["insight"]["problem"])
        self.assertEqual(customer["desires"][0]["rawValue"], base["insight"]["desire"])
        self.assertEqual(customer["barriers"][0]["rawValue"], base["insight"]["barrier"])
        rebuilt = build_blog_marketing_knowledge(blog_context=context, base_context=base)
        self.assertEqual(rebuilt["customerContext"]["desires"][0]["rawValue"], "자연스러운 색감으로 반복 관리하고 싶다")


if __name__ == "__main__":
    unittest.main()
