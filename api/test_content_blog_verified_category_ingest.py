from __future__ import annotations

import copy
import inspect
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from content_blog_knowledge_library import load_verified_category_library
from content_blog_marketing_knowledge import (
    CLASS_VERIFIED_CATEGORY,
    STATUS_AVAILABLE,
    STATUS_MISSING,
    STATUS_PARTIAL,
    build_blog_marketing_knowledge,
)
from content_blog_planner import (
    CODE_CATEGORY_KNOWLEDGE_USED_AS_PRODUCT_STRENGTH,
    CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP,
    CODE_INVALID_REFERENCE,
    CODE_PARTIAL_EVIDENCE_QUALIFIER_LOST,
    CODE_UNSUPPORTED_SUPERIORITY,
    STATUS_HOLD,
    STATUS_PASS,
    _catalogs,
    _planner_messages,
    plan_blog_content,
)
from content_blog_verified_category_ingest import (
    CategoryIngestError,
    DEFAULT_SOURCE_DIR,
    POLICY_DIRECT,
    POLICY_QUALIFIED,
    compute_source_hashes,
    ingest_approved_category_knowledge,
    load_category_knowledge_for_product,
    load_runtime_manifest,
    resolve_category_scope,
)
from content_blog_writer import write_blog_professional_draft
from test_content_blog_marketing_knowledge import BlogMarketingKnowledgeAndPlannerTest


CALIBRATION = DEFAULT_SOURCE_DIR


def _copy_source(dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    for path in CALIBRATION.glob("*.json"):
        shutil.copyfile(path, dest / path.name)
    return dest


class BlogVerifiedCategoryIngestTest(BlogMarketingKnowledgeAndPlannerTest):
    @classmethod
    def setUpClass(cls) -> None:
        ingest_approved_category_knowledge(allow_repromote=True)

    def test_a_approval_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _copy_source(Path(tmp) / "source")
            decision = json.loads((source / "DECISION.json").read_text(encoding="utf-8"))
            decision["decision"] = "NOT_APPROVED"
            (source / "DECISION.json").write_text(json.dumps(decision), encoding="utf-8")
            with self.assertRaises(CategoryIngestError) as raised:
                ingest_approved_category_knowledge(source_dir=source, runtime_dir=Path(tmp) / "runtime", allow_repromote=True)
            self.assertEqual(raised.exception.code, "HOLD_RESEARCH_PACK_NOT_APPROVED")

    def test_b_research_qa_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _copy_source(Path(tmp) / "source")
            qa = json.loads((source / "RESEARCH_PACK_QA.json").read_text(encoding="utf-8"))
            qa["pass"] = False
            (source / "RESEARCH_PACK_QA.json").write_text(json.dumps(qa), encoding="utf-8")
            with self.assertRaises(CategoryIngestError) as raised:
                ingest_approved_category_knowledge(source_dir=source, runtime_dir=Path(tmp) / "runtime", allow_repromote=True)
            self.assertEqual(raised.exception.code, "HOLD_RESEARCH_PACK_NOT_APPROVED")

    def test_c_hash_integrity(self) -> None:
        hashes = compute_source_hashes(CALIBRATION)
        with tempfile.TemporaryDirectory() as tmp:
            source = _copy_source(Path(tmp) / "source")
            henna_path = source / "HENNA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1.json"
            payload = json.loads(henna_path.read_text(encoding="utf-8"))
            payload["tampered"] = True
            henna_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(CategoryIngestError) as raised:
                ingest_approved_category_knowledge(
                    source_dir=source,
                    runtime_dir=Path(tmp) / "runtime",
                    expected_hashes=hashes,
                    allow_repromote=True,
                )
            self.assertEqual(raised.exception.code, "SOURCE_PACK_HASH_MISMATCH")

    def test_d_source_registry_integrity(self) -> None:
        loaded = load_category_knowledge_for_product({"product_group": "henna", "title": "수자타 헤나 염색약"})
        manifest = load_runtime_manifest()
        registry_ids = set(manifest.get("ingestedSourceIds") or [])
        self.assertTrue(loaded["statements"])
        for item in loaded["statements"]:
            self.assertTrue(item["sourceRefs"])
            self.assertTrue(all(ref in registry_ids for ref in item["sourceRefs"]))

    def test_e_stable_ck_ids(self) -> None:
        pack = json.loads((CALIBRATION / "HENNA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1.json").read_text(encoding="utf-8"))
        pack_ids = [item["knowledgeId"] for item in pack["knowledgeStatements"]]
        runtime_ids = [item["knowledgeId"] for item in load_category_knowledge_for_product({"product_group": "henna"})["statements"]]
        self.assertEqual(pack_ids, runtime_ids)

    def test_f_claim_boundary_preserved(self) -> None:
        for product in (
            {"product_group": "henna", "title": "수자타 헤나 염색약"},
            {"product_group": "oil", "title": "수자타 호호바 오일"},
        ):
            for item in load_category_knowledge_for_product(product)["statements"]:
                self.assertFalse(item["claimBoundary"]["canApplyDirectlyToProduct"])
                self.assertFalse(item["claimBoundary"]["canClaimProductSuperiority"])
                self.assertFalse(item["usableForProductClaim"])

    def test_g_henna_scope(self) -> None:
        context, _appeal, _base = self._full()
        ids = [item["knowledgeId"] for item in context["marketingKnowledge"]["categoryKnowledge"]]
        self.assertTrue(ids)
        self.assertTrue(all(item.startswith("CK-HENNA-") for item in ids))
        self.assertFalse(any(item.startswith("CK-JOJOBA-") for item in ids))
        self.assertEqual(len(ids), 10)

    def test_h_jojoba_scope(self) -> None:
        knowledge = build_blog_marketing_knowledge(
            blog_context={"topic": "호호바오일", "productFacts": [], "brandFacts": [], "sourceFacts": [], "evidence": [], "selectedAppealPoints": []},
            base_context={"product": {"product_group": "oil", "title": "수자타 호호바 오일", "product_url": "https://smartstore.naver.com/thesujata/products/5787615984"}},
        )
        ids = [item["knowledgeId"] for item in knowledge["categoryKnowledge"]]
        self.assertTrue(ids)
        self.assertTrue(all(item.startswith("CK-JOJOBA-") for item in ids))
        self.assertFalse(any(item.startswith("CK-HENNA-") for item in ids))
        self.assertEqual(len(ids), 7)

    def test_i_hair_pack_scope(self) -> None:
        knowledge = build_blog_marketing_knowledge(
            blog_context={"topic": "헤어팩", "productFacts": [], "brandFacts": [], "sourceFacts": [], "evidence": [], "selectedAppealPoints": []},
            base_context={
                "product": {
                    "product_group": "herb_pack",
                    "title": "수자타 천연 허브 헤어팩 가루 100% 헤나염색 후 두피 모발 관리",
                    "product_url": "https://smartstore.naver.com/thesujata/products/12874366496",
                }
            },
        )
        self.assertEqual(knowledge["categoryKnowledge"], [])
        self.assertEqual(knowledge["provenance"]["categoryScope"]["scope"], "HAIR_PACK")
        self.assertTrue(any("PRODUCT_INGREDIENT_SOURCE_MISSING" in str(item.get("topic") or "") for item in knowledge["researchRequestCandidates"]))

    def test_j_invalid_ck(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["sections"][1]["categoryKnowledgeRefs"] = ["CK-HENNA-UNKNOWN"]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_INVALID_REFERENCE)

    def test_k_product_claim_leap_strength(self) -> None:
        context, _appeal, _base = self._full()
        ck_id = context["marketingKnowledge"]["categoryKnowledge"][0]["knowledgeId"]
        raw = self._valid_raw(context)
        raw["contentPlan"]["marketingStrategy"]["selectedProductStrengths"] = [
            {"message": "lawsone의 착색 메커니즘", "knowledgeRefs": [ck_id], "factRefs": [], "evidenceRefs": []}
        ]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_CATEGORY_KNOWLEDGE_USED_AS_PRODUCT_STRENGTH)

    def test_l_unsupported_superiority(self) -> None:
        context, _appeal, _base = self._full()
        raw = self._valid_raw(context)
        raw["contentPlan"]["marketingStrategy"]["coreMarketingMessage"] = "시중 최고 헤나로 소개한다"
        raw["intentAnalysis"]["marketingIntent"]["coreMarketingMessage"] = "시중 최고 헤나로 소개한다"
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_UNSUPPORTED_SUPERIORITY)

    def test_m_qualified_knowledge(self) -> None:
        context, _appeal, _base = self._full()
        qualified = next(item for item in context["marketingKnowledge"]["categoryKnowledge"] if item.get("knowledgeUsePolicy") == POLICY_QUALIFIED)
        raw = self._valid_raw(context)
        raw["contentPlan"]["marketingStrategy"]["selectedProductStrengths"] = [
            {"message": "헤나는 keratin과 반드시 특정 방식으로 결합한다", "knowledgeRefs": [qualified["knowledgeId"]], "factRefs": [], "evidenceRefs": []}
        ]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertIn(result["code"], {CODE_PARTIAL_EVIDENCE_QUALIFIER_LOST, CODE_CATEGORY_KNOWLEDGE_USED_AS_PRODUCT_STRENGTH})

    def test_n_knowledge_gap_resolution(self) -> None:
        context, _appeal, _base = self._full()
        by_id = {item["requirementId"]: item for item in context["marketingKnowledge"]["knowledgeRequirements"]}
        self.assertEqual(by_id["KR-category"]["status"], STATUS_PARTIAL)
        self.assertEqual(by_id["KR-category-henna-mechanism"]["status"], STATUS_AVAILABLE)
        self.assertEqual(by_id["KR-category-henna-keratin"]["status"], STATUS_PARTIAL)
        jojoba = build_blog_marketing_knowledge(
            blog_context={"topic": "호호바", "productFacts": [], "brandFacts": [], "sourceFacts": [], "evidence": [], "selectedAppealPoints": []},
            base_context={"product": {"title": "수자타 호호바 오일"}},
        )
        j_by_id = {item["requirementId"]: item for item in jojoba["knowledgeRequirements"]}
        self.assertEqual(j_by_id["KR-category-jojoba-composition"]["status"], STATUS_AVAILABLE)
        self.assertEqual(j_by_id["KR-category-jojoba-hair"]["status"], STATUS_PARTIAL)
        hair = build_blog_marketing_knowledge(
            blog_context={"topic": "헤어팩", "productFacts": [], "brandFacts": [], "sourceFacts": [], "evidence": [], "selectedAppealPoints": []},
            base_context={"product": {"product_group": "herb_pack", "title": "수자타 천연 허브 헤어팩"}},
        )
        h_by_id = {item["requirementId"]: item for item in hair["knowledgeRequirements"]}
        self.assertEqual(h_by_id["KR-category"]["status"], STATUS_MISSING)
        self.assertEqual(h_by_id["KR-category-hair-pack"]["status"], STATUS_MISSING)

    def test_o_research_request_mapping(self) -> None:
        context, _appeal, _base = self._full()
        mapped = [item for item in context["marketingKnowledge"]["researchRequestCandidates"] if item.get("domain") == "CATEGORY"]
        self.assertTrue(mapped)
        self.assertTrue(any(item.get("status") == "APPROVED_KNOWLEDGE_AVAILABLE" and item.get("knowledgeRefs") for item in mapped))
        self.assertTrue(any(item.get("status") == "PARTIALLY_SUPPORTED" for item in mapped))
        self.assertTrue(all(item.get("executed") is False for item in mapped))

    def test_p_no_external_runtime_call(self) -> None:
        import content_blog_verified_category_ingest as ingest_mod
        import content_blog_marketing_knowledge as knowledge

        for module in (ingest_mod, knowledge):
            source = inspect.getsource(module)
            self.assertNotIn("requests.post", source)
            self.assertNotIn("chat/completions", source)
        context, _appeal, _base = self._full()
        self.assertEqual(context["marketingKnowledge"]["provenance"]["llmCalls"], 0)
        self.assertEqual(context["marketingKnowledge"]["provenance"]["externalNetwork"], 0)
        self.assertEqual(context["marketingKnowledge"]["provenance"]["categoryIngestLlmCalls"], 0)

    def test_q_context_llm_zero(self) -> None:
        context, _appeal, _base = self._full()
        self.assertEqual(context["marketingKnowledge"]["provenance"]["llmCalls"], 0)
        self.assertEqual(resolve_category_scope({"product_group": "henna"})["scope"], "HENNA")
        self.assertEqual(resolve_category_scope({"title": "수자타 헤나 염색약"})["fallback"], "title:염색약")
        self.assertNotEqual(resolve_category_scope({"title": "헤나가 들어간 모발 관리"})["scope"], "HENNA")
        self.assertEqual(resolve_category_scope({"product_group": "herb_pack", "title": "헤나염색 후 헤어팩"})["scope"], "HAIR_PACK")

    def test_r_planner_fixture_uses_henna_ck(self) -> None:
        context, _appeal, _base = self._full()
        result = plan_blog_content(self.db, blog_context=context)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])
        catalog = result["plannerReferenceCatalog"]["allowedCategoryKnowledgeIds"]
        self.assertTrue(catalog)
        self.assertTrue(all(item.startswith("CK-HENNA-") for item in catalog))
        used = []
        for section in result["contentPlan"]["sections"]:
            used.extend(section.get("categoryKnowledgeRefs") or [])
        self.assertTrue(used)
        self.assertTrue(all(item.startswith("CK-HENNA-") for item in used))

    def test_s_writer_backward_compatibility(self) -> None:
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
        self.assertIn("qualificationRequired", planned["contentPlan"]["sections"][1])

    def test_t_policies_and_library(self) -> None:
        manifest = load_runtime_manifest()
        self.assertEqual(manifest.get("hennaCount"), 10)
        self.assertEqual(manifest.get("jojobaCount"), 7)
        self.assertEqual(manifest.get("sourceCount"), 15)
        self.assertTrue(manifest.get("directEducationIds"))
        self.assertTrue(manifest.get("qualifiedEducationIds"))
        library = load_verified_category_library()
        self.assertEqual(len(library["statements"]), 17)
        self.assertEqual(library["llmCalls"], 0)
        context, _appeal, _base = self._full()
        policies = {item["knowledgeId"]: item["knowledgeUsePolicy"] for item in context["marketingKnowledge"]["categoryKnowledge"]}
        self.assertIn(POLICY_QUALIFIED, policies.values())
        self.assertIn(POLICY_DIRECT, policies.values())
        keratin = next(item for item in context["marketingKnowledge"]["categoryKnowledge"] if item["topic"] == "hair keratin interaction")
        self.assertEqual(keratin["knowledgeUsePolicy"], POLICY_QUALIFIED)
        self.assertTrue(any("wool" in str(item).lower() or "felt" in str(item).lower() or "adduct" in str(item).lower() for item in keratin["limitations"]))
        blob = json.dumps(_planner_messages(context, _catalogs(context)), ensure_ascii=False)
        self.assertNotIn("calibration/review/blog-v2-external-category-research-and-source-approval-v1", blob)
        leap = copy.deepcopy(self._valid_raw(context))
        leap["contentPlan"]["marketingStrategy"]["selectedProductStrengths"] = [
            {
                "message": "수자타 제품은 lawsone 함량이 높아서 염색력이 우수하다",
                "knowledgeRefs": [context["marketingKnowledge"]["categoryKnowledge"][0]["knowledgeId"]],
                "factRefs": [],
                "evidenceRefs": [],
            }
        ]
        result = plan_blog_content(self.db, blog_context=context, raw_plan=leap)
        self.assertEqual(result["status"], STATUS_HOLD)
        self.assertEqual(result["code"], CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP)

    def test_u_category_education_is_not_general_knowledge(self) -> None:
        knowledge = build_blog_marketing_knowledge(
            blog_context={"topic": "호호바오일", "productFacts": [], "brandFacts": [], "sourceFacts": [], "evidence": [], "selectedAppealPoints": []},
            base_context={"product": {"title": "수자타 호호바 오일"}},
        )
        context, _appeal, _base = self._full()
        jojoba_context = copy.deepcopy(context)
        jojoba_context["marketingKnowledge"] = knowledge
        raw = self._valid_raw(jojoba_context)
        raw["contentPlan"]["sections"][1]["inferencesAllowed"] = ["호호바는 왁스 에스터 중심으로 연구되는 오일 카테고리라고 설명할 수 있다."]
        raw["contentPlan"]["sections"][1]["categoryKnowledgeRefs"] = [item["knowledgeId"] for item in knowledge["categoryKnowledge"][:2]]
        result = plan_blog_content(self.db, blog_context=jojoba_context, raw_plan=raw)
        self.assertEqual(result["status"], STATUS_PASS, result["issues"])


if __name__ == "__main__":
    unittest.main()
