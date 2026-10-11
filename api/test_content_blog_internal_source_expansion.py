from __future__ import annotations

import inspect
import json
import unittest

from db import NaverReviewRaw
from content_blog_context import build_blog_generation_context
from content_blog_experience_patterns import PATTERN_LIBRARY_VERSION, build_review_corpus_profile
from content_blog_knowledge_library import SCOPE_UNRESOLVED, SUBTYPE_METADATA, SUBTYPE_USAGE
from content_blog_marketing_knowledge import CLASS_APPROVED_PRODUCT
from content_blog_planner import (
    CODE_EXPERIENCE_PATTERN_INVALID,
    CODE_INVALID_REFERENCE,
    STATUS_HOLD,
    STATUS_PASS,
    _catalogs,
    _planner_messages,
    plan_blog_content,
)
from content_blog_usage_guide import ingest_usage_guide
from content_blog_writer import write_blog_professional_draft
from test_content_blog_marketing_knowledge import BlogMarketingKnowledgeAndPlannerTest


class BlogInternalSourceExpansionTest(BlogMarketingKnowledgeAndPlannerTest):
    REVIEW_PREFIX = "test-blog-v2-expansion-"

    def tearDown(self) -> None:
        self.db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key.like(f"{self.REVIEW_PREFIX}%")).delete(synchronize_session=False)
        self.db.commit()
        super().tearDown()

    def _add_review(self, *, key: str, url: str, text: str, original: str | None = None, text_hash: str = "") -> None:
        self.db.add(
            NaverReviewRaw(
                review_key=f"{self.REVIEW_PREFIX}{key}",
                platform="naver_smartstore",
                product_url=url,
                review_id_original=original,
                review_text=text,
                text_hash=text_hash or key,
            )
        )
        self.db.commit()

    def test_a_insight_is_customer_insight_not_product(self) -> None:
        context, _appeal, _base = self._full()
        knowledge = context["marketingKnowledge"]
        product_ids = {item["knowledgeId"] for item in knowledge["productKnowledge"]}
        self.assertNotIn("PK-sf_insight_problem", product_ids)
        self.assertFalse(any(item.get("factRefs") == ["sf_insight_problem"] for item in knowledge["productKnowledge"]))
        insight_ids = {item["knowledgeId"] for item in knowledge["customerInsight"]}
        self.assertIn("CI-sf_insight_problem", insight_ids)
        self.assertTrue(all(item["sourceDomain"] == "CUSTOMER_INSIGHT" for item in knowledge["customerInsight"]))
        self.assertTrue(any(item.get("knowledgeSubtype") == "desire" for item in knowledge["customerInsight"]))
        self.assertTrue(any(item.get("knowledgeSubtype") == "barrier" for item in knowledge["customerInsight"]))

    def test_b_title_group_url_are_metadata(self) -> None:
        context, _appeal, _base = self._full()
        by_id = {item["knowledgeId"]: item for item in context["marketingKnowledge"]["productKnowledge"]}
        for fact_id in ("sf_product_title", "sf_product_product_group", "sf_product_product_url"):
            item = by_id[f"PK-{fact_id}"]
            self.assertEqual(item["knowledgeSubtype"], SUBTYPE_METADATA)
            self.assertEqual(item["knowledgeClass"], CLASS_APPROVED_PRODUCT)

    def test_c_valid_usage_guide_is_product_usage_fact(self) -> None:
        result = ingest_usage_guide(product={"product_group": "henna", "title": "수자타 헤나 염색약", "product_url": "https://smartstore.naver.com/thesujata/products/4743750201"})
        self.assertTrue(result["statements"])
        self.assertTrue(any("2시간" in item["statement"] for item in result["statements"]))
        self.assertTrue(all(item["knowledgeSubtype"] == SUBTYPE_USAGE for item in result["statements"]))
        self.assertEqual(result["authorityClass"], "OFFICIAL_PRODUCT_GUIDE")
        self.assertFalse(any(item["usableForProductClaim"] for item in result["statements"]))
        context, _appeal, _base = self._full()
        usage = [item for item in context["marketingKnowledge"]["productKnowledge"] if item.get("knowledgeSubtype") == SUBTYPE_USAGE]
        self.assertTrue(usage)
        self.assertFalse(any("2시간" in item["statement"] and item.get("knowledgeSubtype") != SUBTYPE_USAGE for item in context["marketingKnowledge"]["categoryKnowledge"]))

    def test_d_ambiguous_guide_is_unresolved(self) -> None:
        henna = ingest_usage_guide(product={"product_group": "henna", "title": "수자타 헤나 염색약", "product_url": ""})
        self.assertTrue(any(item["scope"]["status"] == SCOPE_UNRESOLVED for item in henna["unresolved"]))
        self.assertFalse(any("1시간" in item["statement"] for item in henna["statements"]))
        self.assertFalse(any("수자타 내추럴" in item["statement"] for item in henna["statements"]))
        jojoba = ingest_usage_guide(product={"product_group": "other", "title": "호호바 오일", "product_url": "https://smartstore.naver.com/thesujata/products/5787615984"})
        self.assertFalse(any("2시간" in item["statement"] for item in jojoba["statements"]))
        self.assertTrue(any("호호바 오일" in item["statement"] for item in jojoba["statements"]))
        pack = ingest_usage_guide(
            product={
                "product_group": "herb_pack",
                "title": "수자타 천연 허브 헤어팩 가루 100% 헤나염색 후 두피 모발 관리",
                "product_url": "https://smartstore.naver.com/thesujata/products/12874366496",
            }
        )
        self.assertFalse(any("2시간" in item["statement"] for item in pack["statements"]))
        self.assertFalse(any("수자타 레드" in item["statement"] for item in pack["statements"]))
        self.assertTrue(any("1시간" in item["statement"] for item in pack["statements"]))

    def test_e_brand_not_fabricated(self) -> None:
        context, _appeal, _base = self._full()
        self.assertEqual(context["marketingKnowledge"]["brandKnowledge"], [])
        blob = json.dumps(context["marketingKnowledge"], ensure_ascii=False)
        self.assertNotIn("유기농 인증", blob)
        self.assertNotIn("비건 인증", blob)

    def test_f_category_not_fabricated(self) -> None:
        context, _appeal, _base = self._full()
        category = context["marketingKnowledge"]["categoryKnowledge"]
        self.assertTrue(category)
        self.assertTrue(all(str(item.get("knowledgeId") or "").startswith("CK-HENNA-") for item in category))
        self.assertTrue(all(item.get("claimBoundary", {}).get("canApplyDirectlyToProduct") is False for item in category))
        self.assertTrue(all(item.get("usableForProductClaim") is False for item in category))
        blob = json.dumps(context["marketingKnowledge"]["brandKnowledge"], ensure_ascii=False)
        self.assertNotIn("유기농 인증", blob)

    def test_g_corpus_full_accounting(self) -> None:
        url = "https://smartstore.naver.com/thesujata/products/9990000001"
        self._add_review(key="a", url=url, text="새치 관리가 편해요", original="orig-a")
        self._add_review(key="b", url=url, text="색감이 자연스러워요", original="orig-b")
        self._add_review(key="a-dup", url=url, text="중복 원문", original="orig-a")
        self._add_review(key="empty", url=url, text="   ", original="orig-empty")
        built = build_review_corpus_profile(self.db, product={"product_url": url, "sku_id": "9990000001"}, evidence=[])
        profile = built["reviewCorpusProfile"]
        self.assertEqual(profile["sourceCorpusCount"], 4)
        self.assertEqual(profile["rawRows"], 4)
        self.assertEqual(profile["processedCount"] + profile["excludedCount"], profile["sourceCorpusCount"])
        self.assertEqual(profile["duplicateRows"], 1)
        self.assertTrue(profile["accountingOk"])

    def test_h_duplicate_policy_keeps_raw_rows(self) -> None:
        url = "https://smartstore.naver.com/thesujata/products/9990000002"
        self._add_review(key="keep", url=url, text="집에서도 간편해요", original="same")
        self._add_review(key="dup", url=url, text="다른 텍스트", original="same")
        before = self.db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key.like(f"{self.REVIEW_PREFIX}%")).count()
        built = build_review_corpus_profile(self.db, product={"product_url": url}, evidence=[])
        after = self.db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key.like(f"{self.REVIEW_PREFIX}%")).count()
        self.assertEqual(before, after)
        self.assertGreaterEqual(built["reviewCorpusProfile"]["rawRows"], 2)
        self.assertEqual(built["reviewCorpusProfile"]["duplicateRows"], 1)

    def test_i_matched_count_not_representative_count(self) -> None:
        url = "https://smartstore.naver.com/thesujata/products/9990000003"
        for idx in range(8):
            self._add_review(key=f"theme-{idx}", url=url, text=f"새치 관리가 반복되어 부담이에요 {idx}", original=f"t-{idx}")
        evidence = [{"evidenceId": "EV-full", "sourcePk": f"{self.REVIEW_PREFIX}theme-0", "statement": "새치 관리가 반복되어 부담이에요 0"}]
        built = build_review_corpus_profile(self.db, product={"product_url": url}, evidence=evidence)
        self.assertTrue(built["experiencePatterns"])
        for item in built["experiencePatterns"]:
            support = item["support"]
            self.assertEqual(support["corpusReviewCount"], 8)
            self.assertNotEqual(support["matchedReviewCount"], len(support["representativeEvidenceRefs"]))
            self.assertLessEqual(len(support["representativeEvidenceRefs"]), 3)

    def test_j_population_overclaim_hold(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["experiencePatterns"] = [
            {
                "patternId": "XP-1",
                "label": "과장",
                "interpretation": "대부분 고객에게 효과가 있었다",
                "evidenceRefs": ["EV-full"],
                "supportCount": 1,
                "patternType": "MODEL_DERIVED_FROM_EVIDENCE",
            }
        ]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_EXPERIENCE_PATTERN_INVALID)

    def test_k_stable_xp_id(self) -> None:
        url = "https://smartstore.naver.com/thesujata/products/9990000004"
        self._add_review(key="stable", url=url, text="두피 자극이 적어 순해요", original="stable")
        first = build_review_corpus_profile(self.db, product={"product_url": url}, evidence=[])
        second = build_review_corpus_profile(self.db, product={"product_url": url}, evidence=[])
        self.assertEqual([item["patternId"] for item in first["experiencePatterns"]], [item["patternId"] for item in second["experiencePatterns"]])
        self.assertEqual(
            [item["support"]["matchedReviewCount"] for item in first["experiencePatterns"]],
            [item["support"]["matchedReviewCount"] for item in second["experiencePatterns"]],
        )

    def test_l_invalid_xp_hold(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][0]["experiencePatternRefs"] = ["XP-DOES-NOT-EXIST"]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_INVALID_REFERENCE)

    def test_m_raw_corpus_not_in_planner_prompt(self) -> None:
        context, _appeal, _base = self._full()
        catalogs = _catalogs(context)
        blob = json.dumps(_planner_messages(context, catalogs), ensure_ascii=False)
        self.assertNotIn("processedReviews", blob)
        self.assertIn("allowedExperiencePatternIds", blob)
        self.assertIn("reviewCorpusProfile", blob)
        unique = (context["marketingKnowledge"].get("reviewCorpusProfile") or {}).get("processedCount") or 0
        if unique > 12:
            self.assertLess(blob.count("review_key"), unique)

    def test_n_patterns_independent_of_evidence_slice(self) -> None:
        url = "https://smartstore.naver.com/thesujata/products/9990000005"
        for idx in range(20):
            self._add_review(key=f"cap-{idx}", url=url, text=f"집에서 혼자 간편하게 관리해요 {idx}", original=f"cap-{idx}")
        evidence = [{"evidenceId": "EV-full", "sourcePk": "rv-full", "statement": "한 줄"}]
        built = build_review_corpus_profile(self.db, product={"product_url": url}, evidence=evidence)
        self.assertEqual(built["reviewCorpusProfile"]["processedCount"], 20)
        self.assertGreaterEqual(sum(item["support"]["matchedReviewCount"] for item in built["experiencePatterns"]), 20)
        self.assertEqual(len(evidence), 1)

    def test_o_usage_guide_is_not_category_knowledge(self) -> None:
        context, _appeal, _base = self._full()
        category = context["marketingKnowledge"]["categoryKnowledge"]
        statements = " ".join(str(item.get("statement") or "") for item in category)
        self.assertNotIn("2시간", statements)
        self.assertNotIn("사용 시간", statements)
        self.assertTrue(context["marketingKnowledge"]["complianceBoundary"]["usageGuideIsNotCategoryKnowledge"])

    def test_p_research_request_generated_not_executed(self) -> None:
        context, _appeal, _base = self._full()
        requests = context["marketingKnowledge"]["researchRequestCandidates"]
        self.assertTrue(requests)
        self.assertTrue(all(item.get("executed") is False for item in requests))
        self.assertTrue(all(int(item.get("externalNetwork") or 0) == 0 for item in requests))
        self.assertTrue(any(item.get("status") in {"APPROVED_KNOWLEDGE_AVAILABLE", "PARTIALLY_SUPPORTED"} for item in requests if item.get("domain") == "CATEGORY"))
        self.assertTrue(any("CK-HENNA-" in str(item.get("knowledgeRefs") or item.get("knowledgeIds") or "") for item in requests))
        self.assertTrue(any(item.get("status") == "NOT_RESEARCHED" and item.get("domain") == "BRAND" for item in requests))

    def test_q_external_network_zero_in_knowledge_modules(self) -> None:
        import content_blog_experience_patterns as patterns
        import content_blog_knowledge_library as library
        import content_blog_marketing_knowledge as knowledge
        import content_blog_research_requests as requests_mod
        import content_blog_usage_guide as usage

        import content_blog_verified_category_ingest as ingest_mod

        for module in (knowledge, patterns, library, usage, requests_mod, ingest_mod):
            source = inspect.getsource(module)
            self.assertNotIn("requests.post", source)
            self.assertNotIn("chat/completions", source)
            self.assertNotIn("openai", source.lower())

    def test_r_knowledge_llm_zero(self) -> None:
        context, _appeal, _base = self._full()
        self.assertEqual(context["marketingKnowledge"]["provenance"]["llmCalls"], 0)
        self.assertEqual(context["marketingKnowledge"]["internalKnowledgeLibrary"]["llmCalls"], 0)
        self.assertEqual((context["marketingKnowledge"].get("reviewCorpusProfile") or {}).get("llmCalls"), 0)

    def test_s_writer_compatibility(self) -> None:
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

    def test_t_full_regression_previous_sprint(self) -> None:
        context, _appeal, _base = self._full()
        result = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        category_ids = {item["knowledgeId"] for item in context["marketingKnowledge"]["categoryKnowledge"]}
        self.assertTrue(any(item.startswith("CK-HENNA-") for item in category_ids))
        self.assertFalse(any(item.startswith("CK-JOJOBA-") for item in category_ids))
        self.assertTrue(any(item["knowledgeId"].startswith("PK-sf_product_title") for item in context["marketingKnowledge"]["productKnowledge"]))
        self.assertNotIn("PK-sf_insight_problem", {item["knowledgeId"] for item in context["marketingKnowledge"]["productKnowledge"]})


if __name__ == "__main__":
    unittest.main()
