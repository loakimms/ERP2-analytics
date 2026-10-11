import copy
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import review_reply_knowledge_api
import review_reply_knowledge_unit_facts as unit_facts_module
from db import (
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyKnowledgeSourceApplicability,
    ReviewReplyKnowledgeUnitFactValidation,
    ReviewReplyKnowledgeValidation,
    SessionLocal,
    init_db,
)
from review_reply_knowledge import (
    AUTH_APPROVED_HISTORICAL_REFERENCE,
    AUTH_EXTRACTED_KNOWLEDGE,
    AUTH_REVALIDATION_REQUIRED,
    AUTH_VALIDATED_KNOWLEDGE,
    AUTH_VALIDATION_EXCLUDED,
    AUTH_VALIDATION_HOLD,
    AUTH_VALIDATION_OUTDATED,
    AUTH_VALIDATION_STALE_REPLY_CHANGED,
    build_corpus,
    reply_sha256,
    retrieve,
)
from review_reply_knowledge_extraction import extract_units
from review_reply_knowledge_unit_facts import (
    BUCKET_BLOCKED,
    BUCKET_FACTS,
    BUCKET_STYLE,
    BUCKET_UNVERIFIED,
    FACT_PENDING,
    FACT_STATES,
    FACT_VERIFIED,
    GB_APPROVED,
    GB_APPROVED_LEGACY,
    GB_HOLD,
    GB_PARTIAL,
    GB_PENDING,
    GB_RECHECK,
    GB_REVOKED,
    HOLD_SOURCE_MISSING,
    RES_APPLICABLE,
    RES_SOURCE_CHANGED,
    RES_STALE_REPLY_CHANGED,
    RES_STALE_UNIT_CHANGED,
    UnitFactValidationError,
    build_generation_knowledge_input,
    check_generated_reply,
    gate_b_queue_view,
    load_official_source_registry,
    numeric_tokens,
    product_skus_from_rows,
    registry_view,
    unit_key,
    validate_gate_b_submission,
    validate_generation_input,
    validate_unit_fact_submission,
)

REPLY = (
    "고객님~ 헤어팩은 1시간 정도 두셨다가 헹궈 주세요. 레드 헤나는 2시간 방치해 주시면 됩니다. "
    "진한 갈색을 원하신다면 레드 2시간 후에 브라운 2시간 염색하시면 됩니다. 레드와 브라운 각각 2시간~3시간 방치해 주세요."
)
KEY = "k-unit"
KID = f"rrk:{KEY}"
GUIDE = "test_fixture_guide"
PACK_EV = {"source_id": GUIDE, "entry_key": "duration:pack", "covers": ["statement", "product", "numeric"]}
DYE_EV = {"source_id": GUIDE, "entry_key": "duration:dye", "covers": ["statement", "product", "numeric"]}
YES2 = {"statement_accurate": "yes", "product_applicable": "yes", "numeric_accurate": "yes", "generator_reference_allowed": "yes"}
HTML = "sujata_usage_guide_html"
OPC = "operator_confirmed_usage_guidance"
V1_GUIDE = "usage_guide_source_v1"
DYES = ["레드 헤나", "브라운 헤나"]


def _fixture_unit(key, kind, text, products, tokens=None):
    return {"unitKey": key, "kind": kind, "originalText": text, "products": products, "numericTokens": tokens,
            "sourceFidelityStatus": "PASS"}


# Test-only data written to a temp dir and read through the real loaders; never part of the production registry.
FIXTURE_GUIDE_VERSION = "test_fixture_usage_guide"
FIXTURE_GUIDE = {
    "schema": "official_knowledge_units_v2",
    "sources": [{
        "sourceId": GUIDE, "sourceType": "OFFICIAL_HTML_SOURCE", "authorityClass": "OFFICIAL_PRODUCT_GUIDE",
        "sourceVersion": FIXTURE_GUIDE_VERSION, "fileName": "TEST_FIXTURE_NOT_OFFICIAL", "sourceHash": "fixture",
        "units": [
            _fixture_unit("variant:수자타 레드", "variant", "수자타 레드: 테스트용 제품 설명", ["레드 헤나"]),
            _fixture_unit("duration:dye", "duration", "염색약 사용 시간: 2시간", DYES, ["2|시간"]),
            _fixture_unit("duration:pack", "duration", "헤어팩 사용 시간: 1시간", ["헤어팩"], ["1|시간"]),
            _fixture_unit("caution:patch", "caution", "테스트용 패치 테스트 주의", DYES),
            _fixture_unit("mix:quiz-dependent", "restriction", "테스트용 배합 일반화 금지 규칙", []),
        ],
    }],
    "applicabilityReviews": [{
        "reviewId": "fixture-review", "approvalStatus": "APPROVED",
        "scope": [{"sourceId": GUIDE, "unitKey": k, "products": p} for k, p in (
            ("variant:수자타 레드", ["레드 헤나"]), ("duration:dye", DYES), ("duration:pack", ["헤어팩"]), ("caution:patch", DYES))],
    }],
}
REAL_SOURCES_DIR = unit_facts_module._SOURCES_DIR
PRODUCTION_PRODUCT_INFO_ROWS = [
    {"sku_id": sku, "product_url": f"https://smartstore.naver.com/t/products/{sku}", "product_items_json": json.dumps(
        [{"product_key": f"p{i}", "product_name": name, "full_ingredients": "테스트 성분"} for i, name in enumerate(names)], ensure_ascii=False)}
    for sku, names in (
        ("s1", ["수자타헤나레드", "수자타헤나브라운"]), ("s2", ["수자타헤나레드", "수자타헤나브라운"]),
        ("s3", ["수자타호호바오일"]), ("s4", ["수자타헤나레드", "수자타헤나브라운"]), ("s5", ["수자타헤나레드", "수자타헤나브라운"]),
        ("s6", ["수자타두피케어헤어팩", "수자타딥클린헤어팩", "수자타볼륨업헤어팩", "수자타손상케어헤어팩"]),
    )
]
_TMP: tempfile.TemporaryDirectory | None = None
FIXTURE_DIR: Path
FIXTURE_SOURCES_DIR: Path
EMPTY_DIR: Path


def setUpModule() -> None:
    global _TMP, FIXTURE_DIR, FIXTURE_SOURCES_DIR, EMPTY_DIR
    _TMP = tempfile.TemporaryDirectory()
    FIXTURE_DIR = Path(_TMP.name) / "fixture"
    FIXTURE_SOURCES_DIR = Path(_TMP.name) / "fixture_sources"
    EMPTY_DIR = Path(_TMP.name) / "production_without_guide"
    (FIXTURE_DIR / "research").mkdir(parents=True)
    FIXTURE_SOURCES_DIR.mkdir()
    EMPTY_DIR.mkdir()
    (FIXTURE_DIR / "research" / "HENNA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1.json").write_text("{}", encoding="utf-8")
    (FIXTURE_SOURCES_DIR / unit_facts_module.OFFICIAL_GUIDE_V2_FILE).write_text(json.dumps(FIXTURE_GUIDE, ensure_ascii=False), encoding="utf-8")


def tearDownModule() -> None:
    if _TMP is not None:
        _TMP.cleanup()


class _ArtifactDirMixin:
    """artifact dir: blog artifacts (category packs); sources dir: official V2 registry file (REAL = tracked production file)."""

    artifact_dir_name = "FIXTURE_DIR"
    sources_dir_name = "FIXTURE_SOURCES_DIR"

    def setUp(self) -> None:
        for attr, name in (("_ARTIFACT_DIR", self.artifact_dir_name), ("_SOURCES_DIR", self.sources_dir_name)):
            patcher = patch.object(unit_facts_module, attr, globals()[name])
            patcher.start()
            self.addCleanup(patcher.stop)
        super().setUp()


def _review(key: str, text: str) -> dict:
    return {
        "review_key": key, "product_url": "https://smartstore.naver.com/t/products/1", "product_title": "헤나 염색약",
        "review_written_at": date(2025, 11, 1), "rating": 5, "review_text": text, "import_source": "smartstore_review_upload",
        "reply_exists_flag": True, "reply_collect_status": "collected",
        "raw_payload_json": json.dumps({"답글등록일시": "2025.12.01"}, ensure_ascii=False),
    }


def _corpus(*, reply: str = REPLY, validation: dict | None = None, records: list | None = None, registry: dict | None = None):
    return build_corpus(
        reviews=[_review(KEY, "헤나 방치 시간이 궁금해요 색이 잘 나올까요")],
        replies={KEY: {"reply_text": reply, "raw_payload_json": None}},
        drafts_by_review={},
        latest_validations={KID: validation} if validation else None,
        unit_fact_records={KID: records} if records else None,
        fact_registry=registry,
    )


def _approval(content: str = "APPROVED", reply: str = REPLY, sha: str | None = None, snapshot: list | None = None) -> dict:
    return {
        "content_validation": content,
        "currently_valid": "yes",
        "reply_sha256_at_validation": sha or reply_sha256(reply),
        "knowhow_snapshot": snapshot if snapshot is not None else extract_units(reply),
    }


def _record(unit: dict, normalized: dict, *, reply: str = REPLY, key: str | None = None, at: str = "2026-10-09T10:00:00") -> dict:
    return {
        "unit_fact_validation_id": f"r-{at}",
        "unit_key": key or unit["factValidation"]["unitKey"],
        "knowledge_id": KID,
        "reply_sha256_at_validation": reply_sha256(reply),
        "extraction_version": unit["extractionVersion"],
        "source_span": unit["sourceTextSpan"],
        "fact_status": normalized["fact_status"],
        "generator_reference_allowed": normalized["answers"]["generator_reference_allowed"],
        "evidence": normalized["evidence"],
        "verified_scope": normalized["verified_scope"],
        "hold_reason": normalized["hold_reason"],
        "note": normalized["note"],
        "reviewer_email": "ops_admin@example.com",
        "created_at": at,
    }


def _verify(unit: dict, registry: dict, evidence: list, **extra) -> dict:
    payload = {"fact_status": "VERIFIED", **YES2, "evidence": evidence, "verified_scope": "공식 가이드 기준 사용 시간만", "note": "공식 가이드 대조"}
    payload.update(extra)
    return validate_unit_fact_submission(unit, payload, registry)


class UnitIdentityTest(_ArtifactDirMixin, unittest.TestCase):
    def test_units_have_unique_stable_keys_and_exact_spans(self) -> None:
        a, b = _corpus()["items"][0], _corpus()["items"][0]
        units = a["knowhow_items"]
        self.assertEqual(len(units), 4)
        keys = [u["factValidation"]["unitKey"] for u in units]
        self.assertEqual(len(set(keys)), 4)
        self.assertEqual(keys, [u["factValidation"]["unitKey"] for u in b["knowhow_items"]])
        for u in units:
            s, e = u["sourceTextSpan"]
            self.assertEqual(REPLY[s:e], u["originalText"])
            self.assertEqual(u["factValidation"]["status"], FACT_PENDING)
        changed = dict(units[0], extractionVersion="knowhow_semantic_v3")
        self.assertNotEqual(unit_key(KID, reply_sha256(REPLY), changed), keys[0])
        self.assertNotEqual(unit_key(KID, reply_sha256(REPLY + "!"), units[0]), keys[0])
        summary = _corpus()["summary"]
        self.assertEqual(summary["unit_fact_scope_units"], 4)
        self.assertEqual(summary["unit_fact_unique_keys"], 4)
        self.assertEqual(summary["unit_fact_status_counts"], {s: (4 if s == FACT_PENDING else 0) for s in FACT_STATES})
        self.assertEqual(summary["unit_product_tag_total"], 6)
        self.assertEqual(summary["unit_product_tag_counts"]["레드 헤나"], 3)


class UnitFactSubmissionRulesTest(_ArtifactDirMixin, unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.registry = load_official_source_registry()
        self.units = _corpus(registry=self.registry)["items"][0]["knowhow_items"]

    def _code(self, unit, evidence, **extra) -> str:
        with self.assertRaises(UnitFactValidationError) as ctx:
            _verify(unit, self.registry, evidence, **extra)
        return ctx.exception.code

    def test_registry_only_verifying_sources(self) -> None:
        view = registry_view(self.registry)
        by_id = {s["source_id"]: s for s in view["sources"]}
        self.assertTrue(by_id[GUIDE]["can_verify"])
        self.assertEqual(by_id[GUIDE]["entry_count"], 5)
        self.assertEqual(by_id[GUIDE]["version"], FIXTURE_GUIDE_VERSION)
        self.assertFalse(by_id["henna_category_pack_v1"]["can_verify"])
        self.assertEqual(view["verifying_entry_count"], 4)
        self.assertEqual(view["restriction_entry_count"], 1)
        self.assertEqual({p["source_id"] for p in view["pending_registrations"]}, {"official_product_detail_pages"})

    def test_verified_requires_registered_official_evidence(self) -> None:
        pack = self.units[0]
        self.assertEqual(self._code(pack, []), HOLD_SOURCE_MISSING)
        self.assertEqual(self._code(pack, [{"source_id": "henna_category_pack_v1", "entry_key": "x", "covers": ["statement"]}]),
                         "evidence_entry_not_found")
        self.assertEqual(self._code(pack, [{"source_id": "blog", "entry_key": "x", "covers": ["statement"]}]),
                         "evidence_source_not_registered")
        self.assertEqual(self._code(pack, [{**PACK_EV, "url": "https://example.com", "excerpt": "1시간"}]),
                         "free_text_evidence_not_accepted")
        self.assertEqual(self._code(pack, [{"source_id": GUIDE, "entry_key": "mix:quiz-dependent", "covers": ["statement"]}]),
                         "restriction_entry_cannot_verify")
        self.assertEqual(self._code(pack, [DYE_EV]), "evidence_product_mismatch")
        self.assertEqual(self._code(pack, [{**PACK_EV, "covers": ["statement", "product"]}]), "aspect_not_covered_by_evidence")
        ok = _verify(pack, self.registry, [PACK_EV])
        self.assertEqual(ok["fact_status"], FACT_VERIFIED)
        self.assertEqual(ok["evidence"][0]["excerpt"], "헤어팩 사용 시간: 1시간")
        self.assertTrue(ok["evidence"][0]["entry_sha256"])
        self.assertEqual(ok["evidence"][0]["source_version"], FIXTURE_GUIDE_VERSION)

    def test_category_research_cannot_verify(self) -> None:
        registry = load_official_source_registry()
        registry["sources"]["henna_category_pack_v1"]["entries"] = [
            {"entry_key": "c1", "kind": "duration", "statement": "헤나 2시간", "products": ["레드 헤나"],
             "aspects": ["statement", "product", "numeric"], "entry_sha256": "x"}
        ]
        with self.assertRaises(UnitFactValidationError) as ctx:
            _verify(self.units[1], registry, [{"source_id": "henna_category_pack_v1", "entry_key": "c1", "covers": ["statement", "product", "numeric"]}])
        self.assertEqual(ctx.exception.code, "evidence_source_cannot_verify")

    def test_numeric_range_beyond_official_scope_is_rejected(self) -> None:
        exceeding = self.units[3]
        self.assertEqual(exceeding["numericRange"][0]["text"], "2시간~3시간")
        with self.assertRaises(UnitFactValidationError) as ctx:
            _verify(exceeding, self.registry, [DYE_EV])
        self.assertEqual((ctx.exception.code, ctx.exception.detail), ("numeric_exceeds_official_scope", ["3시간"]))
        self.assertEqual(_verify(self.units[1], self.registry, [DYE_EV])["fact_status"], FACT_VERIFIED)

    def test_sequence_and_condition_need_their_own_official_evidence(self) -> None:
        procedure = self.units[2]
        answers = {"condition_accurate": "yes", "sequence_accurate": "yes"}
        with self.assertRaises(UnitFactValidationError) as ctx:
            _verify(procedure, self.registry, [DYE_EV], **answers)
        self.assertEqual(ctx.exception.code, HOLD_SOURCE_MISSING)
        self.assertEqual(set(ctx.exception.detail["missing_aspects"]), {"condition", "sequence"})
        with self.assertRaises(UnitFactValidationError) as ctx:
            _verify(procedure, self.registry, [{**DYE_EV, "covers": ["statement", "product", "numeric", "sequence"]}], **answers)
        self.assertEqual(ctx.exception.code, "evidence_kind_cannot_cover_aspect")

    def test_answer_rules_and_hold_default(self) -> None:
        pack = self.units[0]
        self.assertEqual(self._code(pack, [PACK_EV], numeric_accurate="na"), "na_not_allowed_for_applicable_aspect")
        self.assertEqual(self._code(pack, [PACK_EV], sequence_accurate="yes"), "answer_for_non_applicable_aspect")
        self.assertEqual(self._code(pack, [PACK_EV], statement_accurate="unsure"), "verified_requires_all_applicable_yes")
        self.assertEqual(self._code(pack, [PACK_EV], verified_scope=""), "verified_scope_required")
        self.assertEqual(self._code(pack, [PACK_EV], note=""), "validation_note_required")
        hold = validate_unit_fact_submission(self.units[2], {"fact_status": "HOLD", "note": "순서 공식 근거 없음"}, self.registry)
        self.assertEqual((hold["fact_status"], hold["hold_reason"]), ("HOLD", HOLD_SOURCE_MISSING))
        rejected = validate_unit_fact_submission(self.units[3], {"fact_status": "REJECTED", "evidence": [DYE_EV], "note": "공식 2시간, 3시간 불허"}, self.registry)
        self.assertEqual(rejected["evidence"][0]["entry_key"], "duration:dye")


class ProductionSourceConfigurationTest(_ArtifactDirMixin, unittest.TestCase):
    """Deployed composition: tracked V2 registry + current product ingredient info, no blog artifacts."""

    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"
    RATIO_REPLY = "고객님~ 레드와 브라운을 5:5 비율로 섞어서 2시간 방치해 주세요."

    def setUp(self) -> None:
        super().setUp()
        self.registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS)
        self.units = _corpus(registry=self.registry)["items"][0]["knowhow_items"]
        self.red_ingredient = next(e for e in self.registry["sources"]["content_product_info"]["entries"] if "레드 헤나" in e["products"])

    def _code(self, unit, evidence, **extra) -> str:
        try:
            _verify(unit, self.registry, evidence, **extra)
        except UnitFactValidationError as exc:
            return exc.code
        return "ACCEPTED"

    def test_registry_composition_and_gates(self) -> None:
        view = registry_view(self.registry)
        by_id = {s["source_id"]: s for s in view["sources"]}
        self.assertEqual(list(by_id), [HTML, OPC, "review_knowledge_project_policy", "content_product_info"])
        self.assertEqual(by_id["content_product_info"]["entry_count"], 13)
        self.assertEqual({e["kind"] for e in by_id["content_product_info"]["entries"]}, {"ingredient"})
        self.assertEqual(by_id["content_product_info"]["verifiable_entry_count"], 13)
        html = by_id[HTML]
        self.assertEqual((html["entry_count"], html["fidelity_pass_count"], html["applicability_verified_count"]), (62, 62, 1))
        self.assertEqual([e["entry_key"] for e in html["entries"] if e["can_verify"]], ["html:duration:dye"])
        self.assertEqual(by_id[OPC]["applicability_verified_count"], 5)
        self.assertEqual(by_id[OPC]["confirmation"]["approvalStatus"], "APPROVED")
        self.assertFalse(by_id["review_knowledge_project_policy"]["can_verify"])
        self.assertEqual(view["restriction_entry_count"], 3)
        self.assertEqual(view["registry_version"], "official_fact_source_registry_v2")
        self.assertEqual({p["source_id"] for p in view["pending_registrations"]}, {"official_product_detail_pages"})

    def test_natural_is_not_in_dye_scope(self) -> None:
        entries = [e for s in self.registry["sources"].values() for e in s.get("entries") or []]
        self.assertFalse([e["entry_key"] for e in entries if any("내추럴" in p for p in e["products"])])
        natural = next(e for e in entries if e["entry_key"] == "html:product:수자타 내추럴")
        self.assertEqual(natural["products"], [])
        for e in entries:
            if "내추럴" in str(e.get("product_scope")):
                self.assertEqual(e["kind"], "variant", msg=e["entry_key"])
        dye = next(e for e in entries if e["entry_key"] == "html:duration:dye")
        self.assertEqual((dye["products"], dye["product_scope"]), (DYES, ["수자타 레드", "수자타 브라운"]))

    def test_unregistered_usage_guide_is_rejected(self) -> None:
        self.assertEqual(self._code(self.units[0], [PACK_EV]), "evidence_source_not_registered")
        self.assertEqual(self._code(self.units[1], [DYE_EV]), "evidence_source_not_registered")
        for sid in (V1_GUIDE, GUIDE):
            natural = {"source_id": sid, "entry_key": "variant:수자타 내추럴", "covers": ["statement", "product"]}
            self.assertEqual(self._code(self.units[1], [natural]), "evidence_source_not_registered")

    def test_duration_without_official_duration_evidence_is_blocked(self) -> None:
        self.assertEqual(self._code(self.units[1], []), HOLD_SOURCE_MISSING)
        ingredient = {"source_id": "content_product_info", "entry_key": self.red_ingredient["entry_key"], "covers": ["statement", "product", "numeric"]}
        self.assertEqual(self._code(self.units[1], [ingredient]), "evidence_kind_cannot_cover_aspect")
        partial = {**ingredient, "covers": ["statement", "product"]}
        self.assertNotEqual(self._code(self.units[1], [partial]), "ACCEPTED")

    def test_sequence_without_official_sequence_evidence_is_blocked(self) -> None:
        ingredient = {"source_id": "content_product_info", "entry_key": self.red_ingredient["entry_key"], "covers": ["statement", "product"]}
        code = self._code(self.units[2], [ingredient], condition_accurate="yes", sequence_accurate="yes")
        self.assertEqual(code, HOLD_SOURCE_MISSING)

    def test_ratio_without_official_ratio_evidence_is_blocked(self) -> None:
        units = _corpus(reply=self.RATIO_REPLY, registry=self.registry)["items"][0]["knowhow_items"]
        ratio_units = [u for u in units if u.get("factValidation") and "numeric" in u["factValidation"]["applicableAspects"]]
        self.assertTrue(ratio_units)
        unit = ratio_units[0]
        fields = {"statement": "statement_accurate", "product": "product_applicable", "condition": "condition_accurate",
                  "sequence": "sequence_accurate", "numeric": "numeric_accurate"}
        answers = {fields[a]: "yes" for a in unit["factValidation"]["applicableAspects"]}
        self.assertEqual(self._code(unit, [], **answers), HOLD_SOURCE_MISSING)
        ingredient = {"source_id": "content_product_info", "entry_key": self.red_ingredient["entry_key"], "covers": ["statement", "product", "numeric"]}
        self.assertNotEqual(self._code(unit, [ingredient], **answers), "ACCEPTED")

    def test_category_research_alone_cannot_approve(self) -> None:
        category = {
            "source_id": "henna_category_pack_v1", "version": "v1", "authority_class": "CATEGORY_RESEARCH", "status": "CANDIDATE_ONLY",
            "entries": [{"entry_key": "c1", "kind": "duration", "statement": "헤나 2시간", "products": ["레드 헤나"],
                         "aspects": ["statement", "product", "numeric"], "entry_sha256": "x"}],
        }
        registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS, extra_sources=[category])
        with self.assertRaises(UnitFactValidationError) as ctx:
            _verify(self.units[1], registry, [{"source_id": "henna_category_pack_v1", "entry_key": "c1", "covers": ["statement", "product", "numeric"]}])
        self.assertEqual(ctx.exception.code, "evidence_source_cannot_verify")

    def test_hold_without_evidence_records_source_missing(self) -> None:
        hold = validate_unit_fact_submission(self.units[1], {"fact_status": "HOLD", "note": "공식 근거 미등록"}, self.registry)
        self.assertEqual(hold["hold_reason"], HOLD_SOURCE_MISSING)


ASPECT_FIELDS = {"statement": "statement_accurate", "product": "product_applicable", "condition": "condition_accurate",
                 "sequence": "sequence_accurate", "numeric": "numeric_accurate"}


class UsageGuideV2DurationTest(_ArtifactDirMixin, unittest.TestCase):
    """Standard duration vs conditional adjustment vs sequential vs mixed, on the tracked V2 registry."""

    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"

    def setUp(self) -> None:
        super().setUp()
        self.registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS)

    def _unit(self, text: str, registry: dict | None = None) -> dict:
        units = [u for u in _corpus(reply=text, registry=registry or self.registry)["items"][0]["knowhow_items"] if u.get("factValidation")]
        self.assertEqual(len(units), 1, msg=[u["originalText"] for u in units])
        return units[0]

    def _try(self, text: str, refs: list[tuple[str, str]], registry: dict | None = None) -> str:
        registry = registry or self.registry
        unit = self._unit(text, registry)
        aspects = unit["factValidation"]["applicableAspects"]
        evidence = []
        for sid, key in refs:
            entry = next(e for e in registry["sources"][sid]["entries"] if e["entry_key"] == key)
            evidence.append({"source_id": sid, "entry_key": key, "covers": [a for a in entry["aspects"] if a in aspects]})
        payload = {"fact_status": "VERIFIED", "generator_reference_allowed": "yes", "evidence": evidence,
                   "verified_scope": "운영 기준 사용 시간 범위", "note": "V2 공식 근거 대조", **{ASPECT_FIELDS[a]: "yes" for a in aspects}}
        try:
            validate_unit_fact_submission(unit, payload, registry)
        except UnitFactValidationError as exc:
            return exc.code
        return "VERIFIED"

    def test_01_red_standard_two_hours(self) -> None:
        self.assertEqual(self._try("레드 헤나는 2시간 방치해 주세요.", [(OPC, "opc:standard:red-single")]), "VERIFIED")
        self.assertEqual(self._try("레드 헤나는 2시간 방치해 주세요.", [(HTML, "html:duration:dye")]), "VERIFIED")

    def test_02_brown_standard_two_hours(self) -> None:
        self.assertEqual(self._try("브라운 헤나는 2시간 방치해 주세요.", [(OPC, "opc:standard:brown-single")]), "VERIFIED")
        self.assertEqual(self._try("브라운 헤나는 2시간 방치해 주세요.", [(OPC, "opc:standard:red-single")]), "evidence_product_mismatch")

    def test_03_sequential_each_step_two_hours(self) -> None:
        text = "레드 2시간 후에 브라운 2시간 염색하시면 됩니다."
        unit = self._unit(text)
        self.assertEqual([s["product"] for s in unit["sequence"]], DYES)
        self.assertEqual(self._try(text, [(OPC, "opc:standard:sequential")]), "VERIFIED")
        self.assertEqual(self._try("브라운 2시간 후에 레드 2시간 염색하시면 됩니다.", [(OPC, "opc:standard:sequential")]), "SEQUENCE_ORDER_MISMATCH")
        self.assertEqual(self._try(text, [(HTML, "html:sequence:dark_brown"), (HTML, "html:duration:dye")]), "CURRENT_APPLICABILITY_UNVERIFIED")
        self.assertEqual(self._try("레드 3시간 후에 브라운 3시간 염색하시면 됩니다.", [(OPC, "opc:standard:sequential")]), "numeric_exceeds_official_scope")

    def test_04_mixed_two_hours(self) -> None:
        self.assertEqual(self._try("레드와 브라운을 섞어서 2시간 방치해 주세요.", [(OPC, "opc:standard:mixed")]), "VERIFIED")
        ratio = "레드와 브라운을 5:5 비율로 섞어서 2시간 방치해 주세요."
        self.assertEqual(self._try(ratio, [(OPC, "opc:standard:mixed")]), "numeric_exceeds_official_scope")
        self.assertEqual(self._try(ratio, [(OPC, "opc:standard:mixed"), (HTML, "html:ratio:red_brown")]), "CURRENT_APPLICABILITY_UNVERIFIED")

    def test_05_conditional_adjustment_two_to_three_hours(self) -> None:
        for text in ("레드 헤나 염색이 잘 안 되셨다면 2~3시간까지 방치해 주세요.",
                     "브라운 헤나 색이 잘 안 들었다면 3시간까지 두셔도 됩니다.",
                     "레드와 브라운을 섞어 쓰셨는데 염색이 잘 안 되면 2~3시간 방치해 주세요."):
            refs = [(OPC, "opc:adjust:insufficient")]
            if "섞" in text:
                refs.append((OPC, "opc:standard:mixed"))
            self.assertEqual(self._try(text, refs), "VERIFIED", msg=text)

    def test_06_unconditional_three_hours_is_blocked(self) -> None:
        adjust = [(OPC, "opc:adjust:insufficient")]
        self.assertEqual(self._try("레드 헤나는 3시간 방치해 주세요.", adjust), "OFFICIAL_CONDITION_NOT_PRESENT_IN_UNIT")
        self.assertEqual(self._try("레드 헤나는 3시간 방치해 주세요.", [(OPC, "opc:standard:red-single")]), "numeric_exceeds_official_scope")
        self.assertEqual(self._try("레드 헤나는 2~3시간 방치해 주세요.", [(OPC, "opc:standard:red-single")] + adjust), "OFFICIAL_CONDITION_NOT_PRESENT_IN_UNIT")
        self.assertEqual(self._try("더 진하게 원하시면 레드 헤나를 3시간 방치해 주세요.", adjust), "OFFICIAL_CONDITION_NOT_PRESENT_IN_UNIT")
        self.assertNotEqual(self._try("레드와 브라운 각각 3시간 방치해 주세요.", adjust), "VERIFIED")
        self.assertEqual(self._try("레드와 브라운 각각 2시간 방치해 주세요.", [(HTML, "html:duration:dye")]), "APPLICATION_MODE_UNSPECIFIED")

    def test_07_sequential_and_mixed_are_not_interchangeable(self) -> None:
        self.assertEqual(self._try("레드 2시간 후에 브라운 2시간 염색하시면 됩니다.", [(OPC, "opc:standard:mixed"), (OPC, "opc:standard:sequential")]),
                         "APPLICATION_MODE_MISMATCH")
        self.assertEqual(self._try("레드와 브라운을 섞어서 2시간 방치해 주세요.", [(OPC, "opc:standard:sequential")]), "APPLICATION_MODE_MISMATCH")
        self.assertEqual(self._try("레드 2시간 후에 브라운 2시간 염색하시면 됩니다.", [(OPC, "opc:standard:sequential"), (HTML, "html:duration:dye")]),
                         "APPLICATION_MODE_MISMATCH")
        self.assertEqual(self._try("염색이 잘 안 되면 레드 3시간 후에 브라운 3시간 염색하시면 됩니다.",
                                   [(OPC, "opc:standard:sequential"), (OPC, "opc:adjust:insufficient")]), "APPLICATION_MODE_MISMATCH")
        self.assertEqual(self._try("염색이 잘 안 되면 레드 3시간 후에 브라운 3시간 염색하시면 됩니다.",
                                   [(OPC, "opc:standard:sequential"), (OPC, "opc:adjust:sequential-step")]), "CURRENT_APPLICABILITY_UNVERIFIED")

    def test_08_operator_guidance_is_not_forged_as_html_quote(self) -> None:
        html = self.registry["sources"][HTML]
        opc = self.registry["sources"][OPC]
        for e in html["entries"]:
            quotes = e["source_location"]["quotes"]
            self.assertTrue(quotes and all(isinstance(x["offset"], int) for x in quotes), msg=e["entry_key"])
            self.assertEqual(e["statement"], " / ".join(x["text"] for x in quotes))
            tokens = unit_facts_module._entry_numeric_tokens({"numeric_tokens": e.get("numeric_tokens"), "excerpt": e["statement"]})
            self.assertNotIn(("3", "시간"), tokens, msg=e["entry_key"])
            for step in e.get("procedure") or []:
                self.assertIn(step.get("duration"), (None, "UNKNOWN"), msg=e["entry_key"])
        self.assertEqual(html["sha256"], "6ebf556af916d3db476dda3316c8ec318475bdfb78ff366a74779c7253fe6a61")
        record = opc["confirmation"]["statementVerbatim"]
        for e in opc["entries"]:
            for x in e["source_location"]["quotes"]:
                self.assertIn(x["text"], record)
                self.assertNotIn("offset", x)
        html_text = " ".join(e["statement"] for e in html["entries"])
        for operator_only in ("2시간에서 3시간까지", "2~3시간", "각 단계의 기본 시간은 2시간", "레드 2시간, 브라운 2시간"):
            self.assertNotIn(operator_only, html_text)

    def test_09_gate_b_unapproved_cannot_verify(self) -> None:
        self.assertEqual(self._try("헤어팩은 1시간 정도 두셨다가 헹궈 주세요.", [(HTML, "html:duration:pack")]), "CURRENT_APPLICABILITY_UNVERIFIED")
        data = json.loads((REAL_SOURCES_DIR / unit_facts_module.OFFICIAL_GUIDE_V2_FILE).read_text(encoding="utf-8"))
        pending = copy.deepcopy(data)
        pending["sources"][1]["confirmation"]["approvalStatus"] = "PENDING"
        revoked = copy.deepcopy(data)
        revoked["applicabilityReviews"][0]["approvalStatus"] = "REVOKED"
        red = "레드 헤나는 2시간 방치해 주세요."
        for variant, refs, code in ((pending, [(OPC, "opc:standard:red-single")], "evidence_source_cannot_verify"),
                                    (revoked, [(HTML, "html:duration:dye")], "CURRENT_APPLICABILITY_UNVERIFIED")):
            with tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / unit_facts_module.OFFICIAL_GUIDE_V2_FILE).write_text(json.dumps(variant, ensure_ascii=False), encoding="utf-8")
                with patch.object(unit_facts_module, "_SOURCES_DIR", Path(tmp)):
                    registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS)
            self.assertEqual(self._try(red, refs, registry), code)
        unit = self._unit(red)
        rec = _record(unit, _verify(unit, self.registry, [{"source_id": HTML, "entry_key": "html:duration:dye", "covers": ["statement", "product", "numeric"]}]), reply=red)
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / unit_facts_module.OFFICIAL_GUIDE_V2_FILE).write_text(json.dumps(revoked, ensure_ascii=False), encoding="utf-8")
            with patch.object(unit_facts_module, "_SOURCES_DIR", Path(tmp)):
                registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS)
        fv = _corpus(reply=red, records=[rec], registry=registry)["items"][0]["knowhow_items"][0]["factValidation"]
        self.assertEqual((fv["status"], fv["resolution"]), (FACT_PENDING, RES_SOURCE_CHANGED))

    def test_10_out_of_scope_products_never_get_dye_duration(self) -> None:
        self.assertEqual(self._try("헤어팩은 2시간 두세요.", [(OPC, "opc:standard:red-single")]), "evidence_product_mismatch")
        self.assertEqual(self._try("암라는 2시간 두세요.", [(HTML, "html:duration:dye")]), "evidence_product_mismatch")
        self.assertEqual(self._try("호호바 오일은 2시간 두세요.", [(OPC, "opc:adjust:insufficient")]), "evidence_product_mismatch")
        self.assertEqual(numeric_tokens("긴 머리는 약 2~3봉 사용"), set())
        for e in self.registry["sources"][HTML]["entries"]:
            if e["kind"] == "amount":
                self.assertEqual(e["numeric_tokens"], [], msg=e["entry_key"])

    def test_ratio_tokens_are_normalised(self) -> None:
        self.assertEqual(numeric_tokens("레드 5:5"), {("1:1", "RATIO")})
        self.assertEqual(numeric_tokens("레드 2:8"), {("1:4", "RATIO")})


class UsageGuideV2GenerationTest(_ArtifactDirMixin, unittest.TestCase):
    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"
    REPLY = "레드 헤나는 2시간 방치해 주세요. 레드 헤나 염색이 잘 안 되셨다면 2~3시간까지 방치해 주세요. 레드 2시간 후에 브라운 2시간 염색하시면 됩니다."
    REFS = ([(OPC, "opc:standard:red-single")], [(OPC, "opc:adjust:insufficient")], [(OPC, "opc:standard:sequential")])

    def setUp(self) -> None:
        super().setUp()
        registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS)
        units = [u for u in _corpus(reply=self.REPLY, registry=registry)["items"][0]["knowhow_items"] if u.get("factValidation")]
        self.assertEqual(len(units), 3)
        records = []
        for i, (unit, refs) in enumerate(zip(units, self.REFS)):
            aspects = unit["factValidation"]["applicableAspects"]
            evidence = [{"source_id": s, "entry_key": k, "covers": [a for a in next(e for e in registry["sources"][s]["entries"] if e["entry_key"] == k)["aspects"] if a in aspects]} for s, k in refs]
            payload = {"fact_status": "VERIFIED", "generator_reference_allowed": "yes", "evidence": evidence, "verified_scope": "운영 기준 사용 시간",
                       "note": "V2 근거 대조", **{ASPECT_FIELDS[a]: "yes" for a in aspects}}
            records.append(_record(unit, validate_unit_fact_submission(unit, payload, registry), reply=self.REPLY, at=f"2026-10-09T10:0{i}:00"))
        corpus = _corpus(reply=self.REPLY, validation=_approval(reply=self.REPLY), records=records, registry=registry)
        self.gen = build_generation_knowledge_input(corpus["items"])

    def _verdict(self, text: str) -> tuple[str, list[str]]:
        result = check_generated_reply(text, self.gen)
        return result["verdict"], [i["code"] for i in result["issues"]]

    def test_facts_carry_condition_and_mode(self) -> None:
        self.assertEqual(len(self.gen[BUCKET_FACTS]), 3)
        adjust = next(f for f in self.gen[BUCKET_FACTS] if "3|시간" in f["numeric_tokens"])
        ev = adjust["official_evidence"][0]
        self.assertTrue(ev["condition_required"])
        self.assertEqual(ev["condition"], "염색이 잘되지 않는 경우")
        self.assertTrue(ev["qualifiers"])
        self.assertEqual(sorted(f["application_mode"] for f in self.gen[BUCKET_FACTS]), ["sequential", "single", "single"])

    def test_generated_reply_rules(self) -> None:
        self.assertEqual(self._verdict("레드 헤나는 2시간 방치해 주세요.")[0], "NO_DETECTABLE_VIOLATION")
        self.assertEqual(self._verdict("레드 헤나 염색이 잘 안 되셨다면 3시간까지 방치해 주세요.")[0], "NO_DETECTABLE_VIOLATION")
        verdict, codes = self._verdict("레드 헤나는 3시간 방치해 주세요.")
        self.assertEqual(verdict, "BLOCK")
        self.assertIn("OFFICIAL_CONDITION_OMITTED", codes)
        verdict, codes = self._verdict("레드 헤나는 2~3시간 방치해 주세요.")
        self.assertEqual(verdict, "BLOCK")
        self.assertIn("NUMERIC_EXCEEDS_VERIFIED_SCOPE", codes)
        self.assertEqual(self._verdict("레드 2시간 후에 브라운 2시간 염색해 주세요.")[0], "NO_DETECTABLE_VIOLATION")
        verdict, codes = self._verdict("레드와 브라운을 섞어서 2시간 방치해 주세요.")
        self.assertEqual(verdict, "BLOCK")
        self.assertIn("APPLICATION_MODE_MISMATCH", codes)
        self.assertEqual(self._verdict("레드 3시간 후에 브라운 3시간 염색해 주세요.")[0], "BLOCK")


class UnitFactResolutionTest(_ArtifactDirMixin, unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.registry = load_official_source_registry()
        self.units = _corpus(registry=self.registry)["items"][0]["knowhow_items"]
        self.pack_record = _record(self.units[0], _verify(self.units[0], self.registry, [PACK_EV]))

    def test_one_verified_unit_does_not_approve_siblings(self) -> None:
        corpus = _corpus(records=[self.pack_record], registry=self.registry)
        item = corpus["items"][0]
        statuses = [u["factValidation"]["status"] for u in item["knowhow_items"]]
        self.assertEqual(statuses, [FACT_VERIFIED, FACT_PENDING, FACT_PENDING, FACT_PENDING])
        self.assertEqual([u["generatorFactEligible"] for u in item["knowhow_items"]], [True, False, False, False])
        self.assertEqual(item["current_use_authority"], AUTH_EXTRACTED_KNOWLEDGE)
        self.assertFalse(item["generator_fact_eligible"])
        self.assertIn("UNIT_FACT_PARTIALLY_VERIFIED", item["fact_ineligible_reasons"])
        self.assertEqual(corpus["summary"]["unit_fact_status_counts"][FACT_VERIFIED], 1)
        self.assertEqual(corpus["summary"]["unit_generator_fact_eligible"], 1)
        self.assertEqual(corpus["summary"]["generator_fact_eligible"], 0)

    def test_parent_reply_state_gates_unit_fact_use_and_recovers(self) -> None:
        blocked = {
            AUTH_VALIDATION_HOLD: _approval("HOLD"),
            AUTH_VALIDATION_EXCLUDED: _approval("EXCLUDED"),
            AUTH_VALIDATION_OUTDATED: _approval("OUTDATED"),
            AUTH_REVALIDATION_REQUIRED: _approval(snapshot=[{"originalText": "레드 헤나는 2시간 방치해 주시면 됩니다.", "sentence": "레드 헤나는 2시간 방치해 주시면 됩니다."}]),
        }
        for state, validation in blocked.items():
            item = _corpus(validation=validation, records=[self.pack_record], registry=self.registry)["items"][0]
            self.assertEqual(item["current_use_authority"], state)
            unit = item["knowhow_items"][0]
            self.assertEqual(unit["factValidation"]["status"], FACT_VERIFIED)
            self.assertFalse(unit["generatorFactEligible"], msg=state)
            self.assertIn(f"PARENT_{state}", unit["factUseBlockedReasons"])
        stale = _corpus(validation=_approval(sha="old-sha"), records=[self.pack_record], registry=self.registry)["items"][0]
        self.assertEqual(stale["current_use_authority"], AUTH_VALIDATION_STALE_REPLY_CHANGED)
        self.assertFalse(stale["knowhow_items"][0]["generatorFactEligible"])
        recovered = _corpus(validation=_approval(), records=[self.pack_record], registry=self.registry)["items"][0]
        self.assertEqual(recovered["current_use_authority"], AUTH_APPROVED_HISTORICAL_REFERENCE)
        self.assertTrue(recovered["knowhow_items"][0]["generatorFactEligible"])

    def test_reply_extraction_and_source_changes_invalidate_without_deleting(self) -> None:
        changed_reply = REPLY.replace("고객님~", "고객님!!")
        item = _corpus(reply=changed_reply, records=[self.pack_record], registry=self.registry)["items"][0]
        fv = item["knowhow_items"][0]["factValidation"]
        self.assertEqual((fv["status"], fv["resolution"]), (FACT_PENDING, RES_STALE_REPLY_CHANGED))
        self.assertEqual(fv["staleHistoryCount"], 1)
        self.assertFalse(item["knowhow_items"][0]["generatorFactEligible"])
        old_extraction = dict(self.units[0], extractionVersion="knowhow_semantic_v1_old")
        old_key = unit_key(KID, reply_sha256(REPLY), old_extraction)
        rec = dict(self.pack_record, unit_key=old_key)
        fv = _corpus(records=[rec], registry=self.registry)["items"][0]["knowhow_items"][0]["factValidation"]
        self.assertEqual((fv["status"], fv["resolution"]), (FACT_PENDING, RES_STALE_UNIT_CHANGED))
        registry = copy.deepcopy(self.registry)
        entry = next(e for e in registry["sources"][GUIDE]["entries"] if e["entry_key"] == "duration:pack")
        entry["entry_sha256"] = "changed"
        fv = _corpus(records=[self.pack_record], registry=registry)["items"][0]["knowhow_items"][0]["factValidation"]
        self.assertEqual((fv["status"], fv["recordedStatus"], fv["resolution"]), (FACT_PENDING, FACT_VERIFIED, RES_SOURCE_CHANGED))
        self.assertEqual(fv["historyCount"], 1)

    def test_latest_record_wins_and_history_is_kept(self) -> None:
        hold = _record(self.units[0], validate_unit_fact_submission(self.units[0], {"fact_status": "HOLD", "note": "제품 담당 확인 필요", "hold_reason": "NEEDS_PRODUCT_OWNER_CONFIRMATION"}, self.registry), at="2026-10-09T11:00:00")
        item = _corpus(records=[self.pack_record, hold], registry=self.registry)["items"][0]
        fv = item["knowhow_items"][0]["factValidation"]
        self.assertEqual((fv["status"], fv["historyCount"]), ("HOLD", 2))
        self.assertFalse(item["knowhow_items"][0]["generatorFactEligible"])

    def test_every_unit_verified_and_reply_approved_reaches_validated_knowledge(self) -> None:
        reply = "고객님~ 헤어팩은 1시간 정도 두셨다가 헹궈 주세요."
        corpus = _corpus(reply=reply, registry=self.registry)
        unit = corpus["items"][0]["knowhow_items"][0]
        rec = _record(unit, _verify(unit, self.registry, [PACK_EV]), reply=reply)
        approved = _corpus(reply=reply, validation=_approval(reply=reply), records=[rec], registry=self.registry)
        self.assertEqual(approved["items"][0]["current_use_authority"], AUTH_VALIDATED_KNOWLEDGE)
        self.assertTrue(approved["items"][0]["generator_fact_eligible"])
        self.assertEqual(approved["summary"]["use_authority_counts"][AUTH_VALIDATED_KNOWLEDGE], 1)
        result = retrieve(approved["items"], review_text="헤어팩 몇 시간 두면 되나요", product_title="헤어팩")
        self.assertTrue(result["results"][0]["generator_fact_eligible"])


class GenerationContractTest(_ArtifactDirMixin, unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.registry = load_official_source_registry()
        units = _corpus(registry=self.registry)["items"][0]["knowhow_items"]
        self.records = [
            _record(units[0], _verify(units[0], self.registry, [PACK_EV]), at="2026-10-09T10:00:00"),
            _record(units[1], _verify(units[1], self.registry, [DYE_EV]), at="2026-10-09T10:01:00"),
        ]
        self.corpus = _corpus(validation=_approval(), records=self.records, registry=self.registry)
        self.gen = build_generation_knowledge_input(self.corpus["items"])

    def test_input_separates_style_facts_unverified_and_blocked(self) -> None:
        self.assertEqual(len(self.gen[BUCKET_STYLE]), 1)
        self.assertEqual(self.gen[BUCKET_STYLE][0]["use"], "TONE_AND_CONTEXT_ONLY")
        self.assertEqual(len(self.gen[BUCKET_FACTS]), 2)
        self.assertEqual(len(self.gen[BUCKET_UNVERIFIED]), 2)
        self.assertEqual(self.gen[BUCKET_BLOCKED], [])
        self.assertTrue(all(f["official_evidence"] and f["verified_scope"] for f in self.gen[BUCKET_FACTS]))
        reval = _corpus(validation=_approval(snapshot=[{"originalText": "x", "sentence": "x"}]), records=self.records, registry=self.registry)
        gen = build_generation_knowledge_input(reval["items"])
        self.assertEqual((gen[BUCKET_STYLE], gen[BUCKET_FACTS], gen[BUCKET_UNVERIFIED]), ([], [], []))
        self.assertEqual(len(gen[BUCKET_BLOCKED]), 4)

    def test_output_check_flags_unsupported_and_out_of_scope_claims(self) -> None:
        def codes(text):
            return [i["code"] for i in check_generated_reply(text, self.gen)["issues"]]

        clean = check_generated_reply("헤어팩은 1시간 두셨다가 헹궈 주세요.", self.gen)
        self.assertEqual(clean["verdict"], "NO_DETECTABLE_VIOLATION")
        self.assertTrue(clean["limitations"])
        self.assertIn("UNSUPPORTED_NUMERIC_CLAIM", codes("암라는 30분 정도 두시면 됩니다."))
        self.assertIn("UNSUPPORTED_NUMERIC_CLAIM", codes("레드 8:2 비율로 섞어 주세요."))
        self.assertIn("NUMERIC_EXCEEDS_VERIFIED_SCOPE", codes("레드 헤나는 2시간~3시간 방치해 주세요."))
        self.assertIn("PRODUCT_MISMATCH", codes("헤어팩은 2시간 두세요."))
        self.assertIn("OVERGENERALIZED_SCOPE", codes("모든 제품은 2시간이면 충분합니다."))
        self.assertIn("UNSUPPORTED_EFFICACY_CLAIM", codes("호호바 오일은 탈모 개선 효과가 있어요."))
        self.assertEqual(check_generated_reply("호호바 오일은 탈모 개선 효과가 있어요.", self.gen)["verdict"], "HUMAN_REVIEW_REQUIRED")
        self.assertEqual(check_generated_reply("레드 헤나는 2시간~3시간 방치해 주세요.", self.gen)["verdict"], "BLOCK")

    def test_condition_and_sequence_omission_detected(self) -> None:
        fact = {
            "unit_key": "u-seq", "knowledge_id": KID, "products": ["레드 헤나", "브라운 헤나"], "condition": "진한 갈색을 원하신다면",
            "sequence": [{"order": 1, "product": "레드 헤나"}, {"order": 2, "product": "브라운 헤나"}],
            "numeric_tokens": ["2|시간"], "verified_scope": "x", "official_evidence": [],
        }
        gen = {BUCKET_FACTS: [fact], BUCKET_UNVERIFIED: []}
        issues = [i["code"] for i in check_generated_reply("브라운 2시간 후 레드 헤나 2시간 염색해 주세요.", gen)["issues"]]
        self.assertIn("CONDITION_OMITTED", issues)
        self.assertIn("SEQUENCE_OMITTED_OR_REORDERED", issues)
        ok = check_generated_reply("진한 갈색을 원하신다면 레드 헤나 2시간 후 브라운 헤나 2시간 염색해 주세요.", gen)
        self.assertEqual(ok["verdict"], "NO_DETECTABLE_VIOLATION")

    def test_stale_validation_in_prepared_input_is_rejected(self) -> None:
        self.assertTrue(validate_generation_input(self.gen, self.corpus["items"])["valid"])
        changed = _corpus(reply=REPLY.replace("고객님~", "고객님!!"), validation=_approval(reply=REPLY.replace("고객님~", "고객님!!")),
                          records=self.records, registry=self.registry)
        result = validate_generation_input(self.gen, changed["items"])
        self.assertFalse(result["valid"])
        self.assertEqual({i["code"] for i in result["issues"]}, {"STALE_VALIDATION_IN_INPUT"})
        held = _corpus(validation=_approval("HOLD"), records=self.records, registry=self.registry)
        self.assertEqual({i["code"] for i in validate_generation_input(self.gen, held["items"])["issues"]}, {"FACT_NO_LONGER_ELIGIBLE"})


class UnitFactApiTest(_ArtifactDirMixin, unittest.TestCase):
    _WRITE_ENV = {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": "1", "AUTH_TEST_MODE": "1"}
    KID = "rrk:naver_review:900"

    def setUp(self) -> None:
        super().setUp()
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            for model in (ReviewReplyKnowledgeSourceApplicability, ReviewReplyKnowledgeUnitFactValidation, ReviewReplyKnowledgeValidation,
                          NaverReviewReplyRaw, NaverReviewRaw):
                db.query(model).delete(synchronize_session=False)
            db.add(NaverReviewRaw(
                review_key="naver_review:900", product_url="https://smartstore.naver.com/t/products/900", product_title="헤나 염색약",
                review_id_original="900", review_written_at=date(2026, 9, 1), rating=5.0, review_text="방치 시간이 궁금해요",
                text_hash="900", import_source="smartstore_review_upload", reply_exists_flag=True, reply_collect_status="collected",
                raw_payload_json="{}",
            ))
            db.add(NaverReviewReplyRaw(review_key="naver_review:900", reply_text=REPLY))
            db.commit()
        review_reply_knowledge_api._CACHE.update({"key": None, "corpus": None})

    def _units(self) -> list[dict]:
        return self.client.get(f"/reviews/reply-knowledge/items/{self.KID}").json()["knowhow_items"]

    def _post(self, body: dict, token: str | None = "test-ops_admin"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post("/reviews/reply-knowledge/unit-fact-validations", json=body, headers=headers)

    def test_unit_fact_api_gates_and_append_only_history(self) -> None:
        units = self._units()
        pack_key, dye_key = units[0]["factValidation"]["unitKey"], units[1]["factValidation"]["unitKey"]
        verified = {"knowledge_id": self.KID, "unit_key": pack_key, "fact_status": "VERIFIED", **YES2, "evidence": [PACK_EV],
                    "verified_scope": "헤어팩 사용 시간 1시간", "note": "공식 가이드 duration:pack 대조"}
        with patch.dict(os.environ, {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": ""}):
            self.assertEqual(self._post(verified).status_code, 409)
        with patch.dict(os.environ, self._WRITE_ENV):
            self.assertEqual(self._post(verified, token=None).status_code, 401)
            self.assertEqual(self._post(verified, token="test-marketing").status_code, 403)
            self.assertEqual(self._post({**verified, "unit_key": "ruf:unknown"}).json()["detail"], "unit_key_not_current")
            resp = self._post({**verified, "evidence": []})
            self.assertEqual((resp.status_code, resp.json()["detail"]), (409, HOLD_SOURCE_MISSING))
            resp = self._post({**verified, "evidence": [{**PACK_EV, "url": "https://x", "excerpt": "1시간"}]})
            self.assertEqual(resp.json()["detail"], "free_text_evidence_not_accepted")
            resp = self._post(verified)
            self.assertEqual(resp.status_code, 200, msg=resp.text)
            body = resp.json()
            self.assertEqual(body["unit_fact_validation"]["reviewer_email"], "ops_admin@example.com")
            self.assertEqual(body["unit_fact_validation"]["evidence"][0]["excerpt"], "헤어팩 사용 시간: 1시간")
            self.assertEqual(body["reply_validation_unchanged"], "PENDING")
            resp = self._post({"knowledge_id": self.KID, "unit_key": dye_key, "fact_status": "HOLD", "note": "근거 재확인 필요", "reviewer": "spoof@x"},
                              token="test-superadmin")
            self.assertEqual(resp.status_code, 200, msg=resp.text)
            self.assertEqual(resp.json()["unit_fact_validation"]["hold_reason"], HOLD_SOURCE_MISSING)
            detail = self.client.get(f"/reviews/reply-knowledge/items/{self.KID}", headers={"Authorization": "Bearer test-ops_admin"}).json()
            statuses = [u["factValidation"]["status"] for u in detail["knowhow_items"]]
            self.assertEqual(statuses, [FACT_VERIFIED, "HOLD", FACT_PENDING, FACT_PENDING])
            self.assertEqual(detail["knowhow_items"][0]["factValidation"]["resolution"], RES_APPLICABLE)
            self.assertTrue(detail["knowhow_items"][0]["generatorFactEligible"])
            self.assertEqual([h["reviewer_email"] for h in detail["unit_fact_history"]], ["superadmin@example.com", "ops_admin@example.com"])
            self.assertNotIn("spoof@x", json.dumps(detail["unit_fact_history"]))
            self.assertEqual(detail["content_validation"], "PENDING")
            self.assertEqual(detail["unit_fact_counts"]["status"][FACT_VERIFIED], 1)
            summary = self.client.get("/reviews/reply-knowledge/summary").json()
            self.assertEqual(summary["unit_fact_status_counts"][FACT_VERIFIED], 1)
            self.assertEqual(summary["generator_fact_eligible"], 0)
            sources = self.client.get("/reviews/reply-knowledge/official-sources").json()
            self.assertIn(GUIDE, [s["source_id"] for s in sources["sources"] if s["can_verify"]])
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeUnitFactValidation).count(), 2)
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 0)
            self.assertEqual(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:900").one().reply_text, REPLY)
            row = db.query(ReviewReplyKnowledgeUnitFactValidation).filter_by(unit_key=pack_key).one()
            self.assertEqual(json.loads(row.unit_snapshot_json)["originalText"], "헤어팩은 1시간 정도 두셨다가 헹궈 주세요.")
            self.assertEqual((row.source_span_start, row.source_span_end), (5, 29))


class UnitFactApiProductionConfigurationTest(UnitFactApiTest):
    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"

    def test_unit_fact_api_gates_and_append_only_history(self) -> None:
        units = self._units()
        pack_key, red_key, seq_key, each_key = (u["factValidation"]["unitKey"] for u in units)
        verified = {"knowledge_id": self.KID, "unit_key": pack_key, "fact_status": "VERIFIED", **YES2, "evidence": [PACK_EV],
                    "verified_scope": "헤어팩 사용 시간 1시간", "note": "미등록 가이드 근거 시도"}
        with patch.dict(os.environ, self._WRITE_ENV):
            resp = self._post(verified)
            self.assertEqual((resp.status_code, resp.json()["detail"]), (409, "evidence_source_not_registered"))
            resp = self._post({**verified, "evidence": []})
            self.assertEqual((resp.status_code, resp.json()["detail"]), (409, HOLD_SOURCE_MISSING))
            resp = self._post({**verified, "evidence": [{"source_id": HTML, "entry_key": "html:duration:pack", "covers": ["statement", "product", "numeric"]}]})
            self.assertEqual((resp.status_code, resp.json()["detail"]["code"]), (409, "CURRENT_APPLICABILITY_UNVERIFIED"))
            each = {**verified, "unit_key": each_key, "evidence": [{"source_id": OPC, "entry_key": "opc:adjust:insufficient", "covers": ["statement", "product", "numeric"]}]}
            self.assertEqual(self._post(each).json()["detail"]["code"], "OFFICIAL_CONDITION_NOT_PRESENT_IN_UNIT")
            red = {**verified, "unit_key": red_key, "verified_scope": "레드 단독 기본 2시간", "note": "운영자 확인 기준 대조",
                   "evidence": [{"source_id": OPC, "entry_key": "opc:standard:red-single", "covers": ["statement", "product", "numeric"]}]}
            resp = self._post(red)
            self.assertEqual(resp.status_code, 200, msg=resp.text)
            ev = resp.json()["unit_fact_validation"]["evidence"][0]
            self.assertEqual((ev["authority_class"], ev["current_applicability"]["review_id"]), ("OPERATOR_CONFIRMED_CURRENT_GUIDANCE", "GBR-20261009-2122"))
            sources = self.client.get("/reviews/reply-knowledge/official-sources").json()
            self.assertNotIn(GUIDE, [s["source_id"] for s in sources["sources"]])
            self.assertEqual(sources["restriction_entry_count"], 3)
            self.assertEqual(sources["verifiable_entry_count"], 1 + 5)
            resp = self._post({"knowledge_id": self.KID, "unit_key": pack_key, "fact_status": "HOLD", "note": "공식 근거 미등록"})
            self.assertEqual((resp.status_code, resp.json()["unit_fact_validation"]["hold_reason"]), (200, HOLD_SOURCE_MISSING))
            detail = self.client.get(f"/reviews/reply-knowledge/items/{self.KID}").json()
            self.assertEqual([u["factValidation"]["status"] for u in detail["knowhow_items"]], ["HOLD", FACT_VERIFIED, FACT_PENDING, FACT_PENDING])
            self.assertEqual([u["generatorFactEligible"] for u in detail["knowhow_items"]], [False, True, False, False])
            self.assertFalse(detail["generator_fact_eligible"])
            self.assertEqual(detail["content_validation"], "PENDING")
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeUnitFactValidation).count(), 2)
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 0)


# ---------------------------------------------------------------- Gate B (current applicability) review records

GB_SKUS = product_skus_from_rows(PRODUCTION_PRODUCT_INFO_ROWS)
GB_CONFIRM = {"APPROVED": "CONFIRMED_CURRENT_STANDARD", "HOLD": "NEEDS_CHECK", "EXCLUDED": "NOT_APPLICABLE"}
GB_ADMIN_BASIS = unit_facts_module.GATE_B_BASIS_ADMIN_CONFIRMATION
# Shared with ReviewKnowledgeValidationPanel.test.tsx: the UI preview must compose these exact strings.
GB_PREVIEW_TEMPLATE = {
    "basis_type": GB_ADMIN_BASIS, "basis_type_label": "관리자 직접 확인 (선택 제품의 현재 적용성)",
    "gate_a_reference": "Gate A PASS · guide · 버전 v2 · sha256 abcd · html:x · STEP offset 1",
    "scope_text": "사용 방식: 순차 · 조건: 원문에 별도 기재 없음 · 수치: 2|HOUR · 순서: 원문에 별도 기재 없음 · 원문: 원문 문장",
    "source_limitation_text": "원문에 별도 기재 없음", "current_guidance_note": "G0 참고",
}
GB_PREVIEW_EXPECTED = {
    "basis_summary": "Gate B 관리자 직접 확인 · 결정: 승인 · 선택 제품: 레드 헤나, 브라운 헤나 · 확인: 예, 현재도 선택한 제품에 적용합니다"
                     " · 참고(항목 승인 근거 아님): G0 참고",
    "approved_fact_scope": "제품: 레드 헤나, 브라운 헤나 · 사용 방식: 순차 · 조건: 원문에 별도 기재 없음 · 수치: 2|HOUR"
                           " · 순서: 원문에 별도 기재 없음 · 원문: 원문 문장",
    "limitations_exceptions": "공식 원문 기재 제한: 원문에 별도 기재 없음 / 관리자 추가 확인 예외: 두피 질환 시 사용 중단",
}
GB_P1 = ["html:caution:gray-high", "html:caution:gray-test-time", "html:duration:pack", "html:faq:first-use",
         "html:faq:gray_or_dark_brown_sequence", "html:packmix:single", "html:packmix:three_plus", "html:packmix:two",
         "html:ratio:natural_brown", "html:ratio:orange", "html:ratio:red_brown", "html:sequence:dark_brown",
         "html:step:04", "html:step:05"]
LEGACY_KEYS = {(HTML, "html:duration:dye"), (OPC, "opc:standard:red-single"), (OPC, "opc:standard:brown-single"),
               (OPC, "opc:standard:mixed"), (OPC, "opc:standard:sequential"), (OPC, "opc:adjust:insufficient")}


def _gb_body(entry_key: str, products: list, decision: str = "APPROVED", *, source: str = HTML, expected: str | None = None, **extra) -> dict:
    body = {"request_id": f"gbt-{os.urandom(8).hex()}", "source_id": source, "entry_key": entry_key, "decision": decision,
            "products": products, "expected_latest_record_id": expected, "note": "Gate B 검증 메모"}
    if decision in GB_CONFIRM:
        body["current_applicability_confirmation"] = GB_CONFIRM[decision]
    body.update(extra)
    return body


def _gb_record(normalized: dict, i: int, email: str = "ops_admin@example.com") -> dict:
    out = {k: v for k, v in normalized.items() if k != "answers"} | normalized["answers"]
    return out | {"applicability_id": f"gb-{i:03d}", "reviewer_email": email, "reviewer_role": "ops_admin",
                  "created_at": f"2026-10-09T23:{i:02d}:00"}


class GateBRegistryTest(_ArtifactDirMixin, unittest.TestCase):
    """Gate B state machine on the tracked V2 registry with in-memory append-only records (no DB)."""

    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"

    def _reg(self, records: list | None = None, rows=PRODUCTION_PRODUCT_INFO_ROWS) -> dict:
        return load_official_source_registry(product_info_rows=rows, applicability_records=records or [])

    def _entry(self, registry: dict, key: str, source: str = HTML) -> dict:
        return next(e for e in registry["sources"][source]["entries"] if e["entry_key"] == key)

    def _append(self, records: list, body_args: tuple, **kw) -> list:
        registry = self._reg(records)
        key = body_args[0]
        source = kw.get("source", HTML)
        latest = self._entry(registry, key, source)["gate_b"]["latest_record_id"]
        n = validate_gate_b_submission(registry, _gb_body(*body_args, expected=latest, **kw), product_skus=GB_SKUS)
        return records + [_gb_record(n, len(records) + 1)]

    def _code(self, body: dict, records: list | None = None) -> str:
        try:
            validate_gate_b_submission(self._reg(records), body, product_skus=GB_SKUS)
        except UnitFactValidationError as exc:
            return exc.code
        return "ACCEPTED"

    def test_queue_61_pending_p1_first_and_legacy_scope_preserved(self) -> None:
        view = gate_b_queue_view(self._reg(), [], GB_SKUS)
        queue = [x for x in view["items"] if x["priority"]]
        self.assertEqual((len(queue), view["summary"]["by_priority"]), (61, {"P1": 14, "P2": 16, "P3": 31}))
        self.assertEqual(sorted(x["entry_key"] for x in queue[:14]), GB_P1)
        self.assertEqual({x["priority"] for x in queue[14:30]}, {"P2"})
        self.assertTrue(all(x["entry_state"] == GB_PENDING and not x["current_applicability"]["products"] for x in queue))
        legacy = {(x["source_id"], x["entry_key"]) for x in view["items"] if x["entry_state"] == GB_APPROVED_LEGACY}
        self.assertEqual(legacy, LEGACY_KEYS)
        for x in view["items"]:
            if (x["source_id"], x["entry_key"]) in LEGACY_KEYS:
                self.assertEqual(x["legacy"]["origin"], "LEGACY_OPERATOR_ATTESTATION")
                self.assertEqual(x["current_applicability"]["review_id"], "GBR-20261009-2122")
                self.assertEqual(x["history"], [])
        self.assertNotIn("restriction", {x["kind"] for x in view["items"]})

    def test_product_info_presence_never_approves(self) -> None:
        with_rows = gate_b_queue_view(self._reg(), [], GB_SKUS)
        without = gate_b_queue_view(self._reg(rows=None), [], {})
        pick = lambda v: {(x["entry_key"], x["entry_state"], tuple(x["current_applicability"]["products"])) for x in v["items"]}
        self.assertEqual(pick(with_rows), pick(without))
        self.assertIn("레드 헤나", GB_SKUS)
        self.assertNotIn("PRODUCT_INFO", " ".join(unit_facts_module.GATE_B_BASIS_TYPES))
        self.assertEqual(self._code(_gb_body("html:duration:pack", ["헤어팩"], basis_type="PRODUCT_INFO_DB_EXISTS")), "GATE_B_SERVER_AUTHORED_FIELD")

    def test_approval_is_per_product_and_never_expands_scope(self) -> None:
        records = self._append([], ("html:ratio:red_brown", ["레드 헤나"]))
        registry = self._reg(records)
        entry = self._entry(registry, "html:ratio:red_brown")
        self.assertEqual(entry["products"], DYES)
        self.assertEqual(entry["gate_b"]["by_product"]["레드 헤나"]["state"], GB_APPROVED)
        self.assertEqual(entry["gate_b"]["by_product"]["브라운 헤나"]["state"], GB_PENDING)
        self.assertEqual((entry["gate_b"]["entry_state"], entry["current_applicability"]["products"]), (GB_PARTIAL, ["레드 헤나"]))
        self.assertEqual(entry["current_applicability"]["origin"], "GATE_B_REVIEW")
        others = [e for e in registry["sources"][HTML]["entries"] if e["entry_key"] not in ("html:ratio:red_brown", "html:duration:dye")]
        self.assertFalse([e["entry_key"] for e in others if e["current_applicability"]["products"]])
        latest = entry["gate_b"]["latest_record_id"]
        cases = (
            (_gb_body("html:ratio:red_brown", ["헤어팩"], expected=latest), "GATE_B_SCOPE_EXPANSION"),
            (_gb_body("html:ratio:red_brown", DYES, expected=latest, condition="모든 경우"), "GATE_B_SCOPE_EXPANSION"),
            (_gb_body("html:ratio:red_brown", DYES, expected=latest, numeric_tokens=["3:7|RATIO"]), "GATE_B_SCOPE_EXPANSION"),
            (_gb_body("html:ratio:red_brown", DYES, expected=latest, application_modes=["single", "sequential", "mixed"]), "GATE_B_SCOPE_EXPANSION"),
            (_gb_body("html:ratio:red_brown", ["레드 헤나"], expected=latest, skus=["s3"]), "GATE_B_SKU_NOT_IN_SCOPE"),
            (_gb_body("html:ratio:red_brown", ["브라운 헤나"], expected=None), "GATE_B_STALE_VIEW"),
        )
        for body, code in cases:
            self.assertEqual(self._code(body, records), code, msg=body)
        ok = validate_gate_b_submission(registry, _gb_body("html:ratio:red_brown", ["브라운 헤나"], expected=latest, skus=["s1"]), product_skus=GB_SKUS)
        self.assertEqual((ok["skus"], ok["condition"], ok["numeric_tokens"]), (["s1"], entry.get("condition"), sorted(entry.get("numeric_tokens") or [])))
        self.assertEqual((ok["entry_content_sha256"], ok["source_sha256"]), (entry["entry_sha256"], registry["sources"][HTML]["sha256"]))

    def test_decision_requirements(self) -> None:
        key, prod = "html:duration:pack", ["헤어팩"]
        cases = (
            (_gb_body(key, prod, reviewer_email="spoof@x"), "reviewer_fields_not_accepted"),
            (_gb_body(key, prod, confirmedBy="spoof"), "reviewer_fields_not_accepted"),
            (_gb_body(key, prod, request_id="x"), "request_id_required"),
            (_gb_body(key, prod, current_applicability_confirmation=None), "gate_b_approval_requires_admin_confirmation"),
            (_gb_body(key, prod, current_applicability_confirmation="NEEDS_CHECK"), "gate_b_approval_requires_admin_confirmation"),
            (_gb_body(key, prod, current_applicability_confirmation="YES_ALL"), "invalid_current_applicability_confirmation"),
            (_gb_body(key, prod, company_standard_confirmed="yes"), "GATE_B_SERVER_AUTHORED_FIELD"),
            (_gb_body(key, prod, "HOLD", note=""), "validation_note_required"),
            (_gb_body(key, prod, "HOLD", note="짧음"), "validation_note_required"),
            (_gb_body(key, prod, "EXCLUDED", note=""), "validation_note_required"),
            (_gb_body(key, prod, "HOLD", current_applicability_confirmation="CONFIRMED_CURRENT_STANDARD"), "gate_b_confirmation_decision_mismatch"),
            (_gb_body(key, prod, "EXCLUDED", current_applicability_confirmation="NEEDS_CHECK"), "gate_b_confirmation_decision_mismatch"),
            (_gb_body(key, prod, "REVOKED", current_applicability_confirmation="CONFIRMED_CURRENT_STANDARD"), "gate_b_confirmation_decision_mismatch"),
            (_gb_body(key, prod, "REVOKED"), "GATE_B_NOTHING_TO_REVOKE"),
            (_gb_body(key, prod, "HOLD", admin_confirmed_exceptions="보류 중 예외 기록 시도"), "admin_exceptions_only_for_approval"),
            (_gb_body(key, prod, admin_confirmed_exceptions="가" * 1001), "admin_exceptions_too_long"),
            (_gb_body(key, prod, "PUBLISH"), "invalid_gate_b_decision"),
            (_gb_body("html:product:수자타 내추럴", ["레드 헤나"]), "GATE_B_PRODUCT_SCOPE_REQUIRED"),
            (_gb_body("sku:s1:p0:ingredients", ["레드 헤나"], source="content_product_info"), "gate_b_not_applicable_to_source"),
        )
        for body, code in cases:
            self.assertEqual(self._code(body), code, msg=body)
        restriction = next(e for s in self._reg()["sources"].values() for e in s.get("entries") or [] if e["kind"] == "restriction" and "gate_b" in e)
        self.assertEqual(self._code(_gb_body(restriction["entry_key"], [], "HOLD", source=next(
            s["source_id"] for s in self._reg()["sources"].values() if restriction in s.get("entries", [])))), "restriction_entry_not_gate_b_reviewable")
        self.assertEqual(self._code(_gb_body(key, prod, "HOLD")), "ACCEPTED")
        self.assertEqual(self._code(_gb_body(key, prod, "HOLD", current_applicability_confirmation="NOT_APPLICABLE")), "ACCEPTED")
        self.assertEqual(self._code(_gb_body(key, prod, "EXCLUDED")), "ACCEPTED")
        self.assertEqual(self._code(_gb_body(key, prod, note="")), "ACCEPTED")
        natural = validate_gate_b_submission(self._reg(), _gb_body("html:product:수자타 내추럴", [], "HOLD"), product_skus=GB_SKUS)
        self.assertEqual(natural["products"], ["_entry"])

    def test_server_authors_gate_a_and_gate_b_basis_without_manual_input(self) -> None:
        registry = self._reg()
        source, entry = registry["sources"][HTML], self._entry(registry, "html:sequence:dark_brown")
        n = validate_gate_b_submission(registry, _gb_body("html:sequence:dark_brown", ["레드 헤나"], note=""), product_skus=GB_SKUS)
        offsets = ",".join(str(q["offset"]) for q in entry["source_location"]["quotes"])
        self.assertEqual(n["basis_type"], GB_ADMIN_BASIS)
        self.assertEqual(n["basis_reference"], f"Gate A PASS · {HTML} · 버전 {source['version']} · sha256 {source['sha256'][:16]}"
                                               f" · html:sequence:dark_brown · {entry['source_location']['section']} offset {offsets}")
        self.assertEqual(n["approved_fact_scope"], "제품: 레드 헤나 · 사용 방식: 순차 · 조건: 원하는 색상: 진한 흑갈색 · 수치: 원문에 별도 기재 없음"
                                                   " · 순서: 1. 레드 헤나 1차 레드 도포 후 헹굼 → 2. 브라운 헤나 2차 브라운을 다시 도포"
                                                   f" · 원문: {entry['original_text']}")
        self.assertEqual(n["limitations_exceptions"], "공식 원문 기재 제한: 원문에 별도 기재 없음 / 관리자 추가 확인 예외: 입력 없음")
        self.assertNotIn("제한 없음", n["limitations_exceptions"].replace("기재 없음", ""))
        self.assertIn("선택 제품: 레드 헤나", n["basis_summary"])
        self.assertIn("확인: 예, 현재도 선택한 제품에 적용합니다", n["basis_summary"])
        self.assertIn("참고(항목 승인 근거 아님): G0", n["basis_summary"])
        self.assertEqual(n["answers"], {f: "yes" for f in unit_facts_module.GATE_B_QUESTIONS})
        self.assertEqual((n["note"], n["original_text"], n["source_sha256"]), ("", entry["original_text"], source["sha256"]))
        extra = validate_gate_b_submission(registry, _gb_body("html:sequence:dark_brown", DYES, admin_confirmed_exceptions="임산부는 사용 전 상담"),
                                           product_skus=GB_SKUS)
        self.assertTrue(extra["limitations_exceptions"].endswith("/ 관리자 추가 확인 예외: 임산부는 사용 전 상담"))
        self.assertTrue(extra["approved_fact_scope"].startswith("제품: 레드 헤나, 브라운 헤나 · "))
        hold = validate_gate_b_submission(registry, _gb_body("html:packmix:three_plus", ["헤어팩"], "HOLD", note="현재 안내 기준 변경 확인"),
                                          product_skus=GB_SKUS)
        self.assertEqual((hold["approved_fact_scope"], hold["limitations_exceptions"], hold["basis_type"]), (None, None, GB_ADMIN_BASIS))
        self.assertEqual(hold["answers"], {f: "unsure" for f in unit_facts_module.GATE_B_QUESTIONS})
        self.assertIn("결정: 보류", hold["basis_summary"])
        opc = validate_gate_b_submission(registry, _gb_body("opc:standard:mixed", ["레드 헤나"], source=OPC), product_skus=GB_SKUS)
        self.assertNotIn("G0", opc["basis_summary"])
        self.assertTrue(opc["basis_reference"].startswith(f"Gate A PASS · {OPC} · "))

    def test_forged_server_authored_fields_are_rejected(self) -> None:
        for field in unit_facts_module.GATE_B_SERVER_AUTHORED_FIELDS:
            for decision in ("APPROVED", "HOLD"):
                body = _gb_body("html:step:04", ["레드 헤나"], decision, **{field: "yes" if field in unit_facts_module.GATE_B_QUESTIONS else "위조 근거 입력"})
                self.assertEqual(self._code(body), "GATE_B_SERVER_AUTHORED_FIELD", msg=(field, decision))

    def test_audit_preview_contract_matches_ui(self) -> None:
        out = unit_facts_module.gate_b_audit_record(GB_PREVIEW_TEMPLATE, decision="APPROVED", products=DYES,
                                                    confirmation="CONFIRMED_CURRENT_STANDARD", admin_exceptions="두피 질환 시 사용 중단")
        self.assertEqual({k: out[k] for k in GB_PREVIEW_EXPECTED}, GB_PREVIEW_EXPECTED)
        self.assertEqual((out["basis_type"], out["basis_reference"]), (GB_ADMIN_BASIS, GB_PREVIEW_TEMPLATE["gate_a_reference"]))
        registry = self._reg()
        item = next(x for x in gate_b_queue_view(registry, [], GB_SKUS)["items"] if x["entry_key"] == "html:step:04")
        n = validate_gate_b_submission(registry, _gb_body("html:step:04", ["브라운 헤나"]), product_skus=GB_SKUS)
        preview = unit_facts_module.gate_b_audit_record(item["audit_template"], decision="APPROVED", products=["브라운 헤나"],
                                                        confirmation="CONFIRMED_CURRENT_STANDARD", admin_exceptions=None)
        self.assertEqual(preview, {k: n[k] for k in preview})

    def test_gate_a_pass_and_g0_never_approve_without_admin_record(self) -> None:
        view = gate_b_queue_view(self._reg(), [], GB_SKUS)
        p1 = [x for x in view["items"] if x["priority"] == "P1"]
        self.assertEqual(len(p1), 14)
        self.assertTrue(all(x["gate_a_status"] == "PASS" and x["audit_template"]["current_guidance_note"] for x in p1))
        self.assertTrue(all(x["entry_state"] == GB_PENDING and not x["current_applicability"]["products"] for x in p1))
        self.assertEqual(view["decision_confirmations"]["APPROVED"], ["CONFIRMED_CURRENT_STANDARD"])
        self.assertNotIn("제한 없음", json.dumps([x["audit_template"]["source_limitation_text"] for x in view["items"]], ensure_ascii=False)
                         .replace("기재 없음", ""))

    def test_duplicate_approval_needs_reverification_reason_and_keeps_official_basis(self) -> None:
        key = "html:ratio:red_brown"
        records = self._append([], (key, ["레드 헤나"]))
        first = records[0]
        registry = self._reg(records)
        latest = self._entry(registry, key)["gate_b"]["latest_record_id"]
        for reason in (None, "짧은 사유"):
            body = _gb_body(key, ["레드 헤나"], expected=latest, **({"reverification_reason": reason} if reason else {}))
            with self.assertRaises(UnitFactValidationError) as ctx:
                validate_gate_b_submission(registry, body, product_skus=GB_SKUS)
            self.assertEqual((ctx.exception.code, ctx.exception.status), ("GATE_B_DUPLICATE_APPROVAL", 409))
            self.assertEqual(ctx.exception.detail["products"],
                             [{"product": "레드 헤나", "approved_at": first["created_at"], "record_id": first["applicability_id"]}])
        reason = "회사 기준 문서 재확인 결과 동일함"
        n = validate_gate_b_submission(registry, _gb_body(key, ["레드 헤나"], expected=latest, note="", reverification_reason=reason), product_skus=GB_SKUS)
        for field in ("basis_type", "basis_reference", "basis_summary", "approved_fact_scope", "limitations_exceptions",
                      "original_text", "source_sha256", "entry_content_sha256"):
            self.assertEqual(n[field], first[field], msg=field)
        self.assertEqual((n["note"], n["reverified_products"]), (f"[재검증: 레드 헤나] 사유: {reason}", ["레드 헤나"]))
        records = records + [_gb_record(n, 2)]
        self.assertEqual(self._entry(self._reg(records), key)["gate_b"]["by_product"]["레드 헤나"]["state"], GB_APPROVED)

        latest = self._entry(self._reg(records), key)["gate_b"]["latest_record_id"]
        with self.assertRaises(UnitFactValidationError) as ctx:
            validate_gate_b_submission(self._reg(records), _gb_body(key, DYES, expected=latest), product_skus=GB_SKUS)
        self.assertEqual([x["product"] for x in ctx.exception.detail["products"]], ["레드 헤나"])
        mixed = validate_gate_b_submission(self._reg(records), _gb_body(key, DYES, expected=latest, note="브라운 첫 확인",
                                                                         reverification_reason=reason), product_skus=GB_SKUS)
        self.assertEqual((mixed["products"], mixed["reverified_products"]), (DYES, ["레드 헤나"]))
        self.assertEqual(mixed["note"], f"[재검증: 레드 헤나] 사유: {reason} / 판단 메모: 브라운 첫 확인")
        cases = (
            (_gb_body(key, ["브라운 헤나"], expected=latest, reverification_reason=reason), "reverification_reason_without_approved_product"),
            (_gb_body(key, ["레드 헤나"], "HOLD", expected=latest, reverification_reason=reason), "reverification_reason_only_for_approval"),
            (_gb_body(key, ["레드 헤나"], "HOLD", expected=latest), "ACCEPTED"),
            (_gb_body(key, ["레드 헤나"], "REVOKED", expected=latest), "ACCEPTED"),
            (_gb_body(key, ["레드 헤나"], "EXCLUDED", expected=latest), "ACCEPTED"),
        )
        for body, code in cases:
            self.assertEqual(self._code(body, records), code, msg=body)

    def test_reapproval_after_legacy_revoke_or_recheck_is_not_duplicate(self) -> None:
        self.assertEqual(self._code(_gb_body("html:duration:dye", ["레드 헤나"])), "ACCEPTED")
        self.assertEqual(self._code(_gb_body("opc:standard:red-single", ["레드 헤나"], source=OPC)), "ACCEPTED")
        key = "html:faq:first-use"
        records = self._append([], (key, ["레드 헤나", "브라운 헤나", "헤어팩"]))
        records = self._append(records, (key, ["헤어팩"], "REVOKED"))
        entry = self._entry(self._reg(records), key)
        self.assertEqual({p: v["state"] for p, v in entry["gate_b"]["by_product"].items()},
                         {"레드 헤나": GB_APPROVED, "브라운 헤나": GB_APPROVED, "헤어팩": GB_REVOKED})
        latest = entry["gate_b"]["latest_record_id"]
        self.assertEqual(self._code(_gb_body(key, ["헤어팩"], expected=latest), records), "ACCEPTED")
        self.assertEqual(self._code(_gb_body(key, ["레드 헤나"], expected=latest), records), "GATE_B_DUPLICATE_APPROVAL")
        stale = [dict(r, entry_content_sha256="old-entry-hash") for r in records]
        stale_latest = self._entry(self._reg(stale), key)["gate_b"]["latest_record_id"]
        self.assertEqual(self._entry(self._reg(stale), key)["gate_b"]["by_product"]["레드 헤나"]["state"], GB_RECHECK)
        self.assertEqual(self._code(_gb_body(key, ["레드 헤나"], expected=stale_latest), stale), "ACCEPTED")

    def test_hold_revoke_and_recheck_override_legacy_without_reinstating(self) -> None:
        key = "opc:standard:red-single"
        records = self._append([], (key, ["레드 헤나"], "HOLD"), source=OPC)
        entry = self._entry(self._reg(records), key, OPC)
        self.assertEqual((entry["gate_b"]["entry_state"], entry["current_applicability"]["products"]), (GB_HOLD, []))
        self.assertEqual(entry["gate_b"]["legacy"]["review_id"], "GBR-20261009-2122")
        brown = self._entry(self._reg(records), "opc:standard:brown-single", OPC)
        self.assertEqual(brown["gate_b"]["entry_state"], GB_APPROVED_LEGACY)
        records = self._append(records, (key, ["레드 헤나"]), source=OPC)
        self.assertEqual(self._entry(self._reg(records), key, OPC)["gate_b"]["entry_state"], GB_APPROVED)
        records = self._append(records, (key, ["레드 헤나"], "REVOKED"), source=OPC)
        entry = self._entry(self._reg(records), key, OPC)
        self.assertEqual((entry["gate_b"]["entry_state"], entry["gate_b"]["record_count"]), (GB_REVOKED, 3))
        legacy_revoke = self._append([], ("html:duration:dye", ["레드 헤나"], "REVOKED"))
        dye = self._entry(self._reg(legacy_revoke), "html:duration:dye")
        self.assertEqual((dye["gate_b"]["by_product"]["레드 헤나"]["state"], dye["gate_b"]["by_product"]["브라운 헤나"]["state"]), (GB_REVOKED, GB_APPROVED_LEGACY))
        self.assertEqual(dye["current_applicability"]["products"], ["브라운 헤나"])
        stale = [dict(r, entry_content_sha256="old-entry-hash") for r in self._append([], (key, ["레드 헤나"]), source=OPC)]
        entry = self._entry(self._reg(stale), key, OPC)
        self.assertEqual((entry["gate_b"]["entry_state"], entry["current_applicability"]["products"]), (GB_RECHECK, []))
        moved = [dict(r, source_sha256="old-source-hash") for r in self._append([], ("html:duration:pack", ["헤어팩"]))]
        self.assertEqual(self._entry(self._reg(moved), "html:duration:pack")["gate_b"]["entry_state"], GB_RECHECK)
        recheck_latest = self._entry(self._reg(stale), key, OPC)["gate_b"]["latest_record_id"]
        again = validate_gate_b_submission(self._reg(stale), _gb_body(key, ["레드 헤나"], source=OPC, expected=recheck_latest), product_skus=GB_SKUS)
        self.assertEqual(self._entry(self._reg(stale + [_gb_record(again, 9)]), key, OPC)["gate_b"]["entry_state"], GB_APPROVED)

    def test_withdrawn_applicability_invalidates_dependent_unit_fact_and_reapproval_restores(self) -> None:
        red = "레드 헤나는 2시간 방치해 주세요."
        registry = self._reg()
        unit = [u for u in _corpus(reply=red, registry=registry)["items"][0]["knowhow_items"] if u.get("factValidation")][0]
        ev = [{"source_id": OPC, "entry_key": "opc:standard:red-single", "covers": ["statement", "product", "numeric"]}]
        rec = _record(unit, _verify(unit, registry, ev), reply=red)
        fv = lambda reg: _corpus(reply=red, records=[rec], registry=reg)["items"][0]["knowhow_items"][0]["factValidation"]
        self.assertEqual(fv(registry)["resolution"], RES_APPLICABLE)
        records = self._append([], ("opc:standard:red-single", ["레드 헤나"], "HOLD"), source=OPC)
        self.assertEqual((fv(self._reg(records))["status"], fv(self._reg(records))["resolution"]), (FACT_PENDING, RES_SOURCE_CHANGED))
        records = self._append(records, ("opc:standard:red-single", ["레드 헤나"]), source=OPC)
        self.assertEqual(fv(self._reg(records))["resolution"], RES_APPLICABLE)
        unrelated = self._append([], ("opc:standard:brown-single", ["브라운 헤나"], "HOLD"), source=OPC)
        self.assertEqual(fv(self._reg(unrelated))["resolution"], RES_APPLICABLE)

    def test_template_claims_are_not_verified_by_partial_evidence(self) -> None:
        records = self._append([], ("html:ratio:red_brown", DYES))
        records = self._append(records, ("html:product:수자타 브라운", ["브라운 헤나"]))
        registry = self._reg(records)
        guide = UsageGuideV2DurationTest()
        guide.registry = registry

        def attempt(text, refs):
            unit = guide._unit(text, registry)
            aspects = unit["factValidation"]["applicableAspects"]
            evidence = [{"source_id": s, "entry_key": k, "covers": [a for a in self._entry(registry, k, s)["aspects"] if a in aspects]} for s, k in refs]
            payload = {"fact_status": "VERIFIED", "generator_reference_allowed": "yes", "evidence": evidence, "verified_scope": "부분 근거 시도",
                       "note": "템플릿 문장 검증 시도", **{ASPECT_FIELDS[a]: "yes" for a in aspects}}
            try:
                validate_unit_fact_submission(unit, payload, registry)
            except UnitFactValidationError as exc:
                return exc.code
            return "VERIFIED"

        mixed = [(OPC, "opc:standard:mixed"), (HTML, "html:ratio:red_brown")]
        self.assertEqual(attempt("레드와 브라운을 3:7 비율로 섞어서 2시간 방치해 주세요.", mixed), "numeric_exceeds_official_scope")
        self.assertEqual(attempt("레드 2시간 후에 브라운을 5:5로 섞어 2시간 방치해 주세요.", [(OPC, "opc:standard:sequential")] + mixed),
                         "MULTI_METHOD_UNIT_REQUIRES_SPLIT")
        self.assertEqual(attempt("레드 2시간 후 다음날 브라운 2시간 염색하시면 됩니다.", [(OPC, "opc:standard:sequential")]), "UNOFFICIAL_SEQUENCE_INTERVAL")
        self.assertEqual(attempt("레드 2시간 후에 브라운 2시간 염색하시면 됩니다.", [(OPC, "opc:standard:sequential")]), "VERIFIED")
        self.assertEqual(attempt("브라운 단독은 미색으로 나오니 2시간 방치해 주세요.", [(OPC, "opc:standard:brown-single")]), "UNOFFICIAL_COLOR_OUTCOME")


class GateBApiTest(_ArtifactDirMixin, unittest.TestCase):
    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"
    _WRITE_ENV = {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": "1", "AUTH_TEST_MODE": "1"}
    URL = "/reviews/reply-knowledge/source-applicability"

    def setUp(self) -> None:
        super().setUp()
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            for model in (ReviewReplyKnowledgeSourceApplicability, ReviewReplyKnowledgeUnitFactValidation, ReviewReplyKnowledgeValidation,
                          NaverReviewReplyRaw, NaverReviewRaw):
                db.query(model).delete(synchronize_session=False)
            db.add(NaverReviewRaw(
                review_key="naver_review:901", product_url="https://smartstore.naver.com/t/products/901", product_title="헤나 염색약",
                review_id_original="901", review_written_at=date(2026, 9, 1), rating=5.0, review_text="방치 시간이 궁금해요",
                text_hash="901", import_source="smartstore_review_upload", reply_exists_flag=True, reply_collect_status="collected",
                raw_payload_json="{}",
            ))
            db.add(NaverReviewReplyRaw(review_key="naver_review:901", reply_text=REPLY))
            db.commit()
        rows = patch.object(review_reply_knowledge_api, "_product_info_rows", lambda db: PRODUCTION_PRODUCT_INFO_ROWS)
        rows.start()
        self.addCleanup(rows.stop)
        review_reply_knowledge_api._CACHE.update({"key": None, "corpus": None})
        self.guide_sha = unit_facts_module._sha((REAL_SOURCES_DIR / unit_facts_module.OFFICIAL_GUIDE_V2_FILE).read_text(encoding="utf-8"))

    def _post(self, body: dict, token: str | None = "test-ops_admin"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post(self.URL, json=body, headers=headers)

    def _item(self, key: str, source: str = HTML) -> dict:
        items = self.client.get(self.URL, headers={"Authorization": "Bearer test-ops_admin"}).json()["items"]
        return next(x for x in items if x["entry_key"] == key and x["source_id"] == source)

    def test_gate_b_api_permissions_audit_dedupe_and_append_only(self) -> None:
        view = self.client.get(self.URL).json()
        self.assertEqual(view["summary"]["by_priority"], {"P1": 14, "P2": 16, "P3": 31})
        self.assertEqual(view["items"][0]["priority"], "P1")
        key = "html:ratio:red_brown"
        body = _gb_body(key, ["레드 헤나"], skus=["s1"])
        with patch.dict(os.environ, {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": ""}):
            self.assertEqual(self._post(body).status_code, 409)
        with patch.dict(os.environ, self._WRITE_ENV):
            self.assertEqual(self._post(body, token=None).status_code, 401)
            self.assertEqual(self._post(body, token="test-marketing").status_code, 403)
            resp = self._post({**body, "reviewer_email": "spoof@x", "reviewer_role": "superadmin"})
            self.assertEqual((resp.status_code, resp.json()["detail"]), (400, "reviewer_fields_not_accepted"))
            first = self._post(body)
            self.assertEqual(first.status_code, 200, msg=first.text)
            rec = first.json()["record"]
            self.assertEqual((rec["reviewer_email"], rec["reviewer_role"], rec["decision"]), ("ops_admin@example.com", "ops_admin", "APPROVED"))
            self.assertEqual((rec["basis_type"], rec["basis_reference"], rec["products"], rec["skus"]),
                             (GB_ADMIN_BASIS, self._item(key)["audit_template"]["gate_a_reference"], ["레드 헤나"], ["s1"]))
            self.assertTrue(rec["approved_fact_scope"].startswith("제품: 레드 헤나 · ") and rec["limitations_exceptions"])
            self.assertEqual({rec[f] for f in unit_facts_module.GATE_B_QUESTIONS}, {"yes"})
            forged = self._post(_gb_body(key, ["브라운 헤나"], expected=rec["applicability_id"], basis_summary="위조 근거"))
            self.assertEqual((forged.status_code, forged.json()["detail"]["code"]), (400, "GATE_B_SERVER_AUTHORED_FIELD"))
            self.assertTrue(rec["created_at"] and rec["entry_content_sha256"] and rec["source_sha256"] and rec["original_text"])
            self.assertEqual(rec["supersedes_record_id"], "ROOT")
            self.assertEqual(first.json()["entry"]["by_product"]["브라운 헤나"]["state"], GB_PENDING)
            dup = self._post(body)
            self.assertEqual((dup.status_code, dup.json()["duplicate"], dup.json()["record"]["applicability_id"]), (200, True, rec["applicability_id"]))
            self.assertEqual(self._post({**body, "note": "다른 내용 재사용"}).json()["detail"], "GATE_B_REQUEST_ID_REUSED")
            self.assertEqual(self._post(body, token="test-superadmin").json()["detail"], "GATE_B_REQUEST_ID_REUSED")
            stale = self._post(_gb_body(key, ["브라운 헤나"]))
            self.assertEqual((stale.status_code, stale.json()["detail"]["code"]), (409, "GATE_B_STALE_VIEW"))
            hold = self._post(_gb_body(key, ["레드 헤나"], "HOLD", expected=rec["applicability_id"], note="제품 담당 재확인 필요"), token="test-superadmin")
            self.assertEqual(hold.status_code, 200, msg=hold.text)
            hold_id = hold.json()["record"]["applicability_id"]
            self.assertEqual(self._item(key)["by_product"]["레드 헤나"]["state"], GB_HOLD)
            self.assertEqual(self._post(_gb_body(key, ["레드 헤나"], "REVOKED", expected=hold_id)).json()["detail"]["code"], "GATE_B_NOTHING_TO_REVOKE")
            again = self._post(_gb_body(key, ["레드 헤나"], expected=hold_id))
            self.assertEqual(again.status_code, 200, msg=again.text)
            revoke = self._post(_gb_body(key, ["레드 헤나"], "REVOKED", expected=again.json()["record"]["applicability_id"], note="현행 기준 아님 확인"))
            self.assertEqual(revoke.status_code, 200, msg=revoke.text)
            item = self._item(key)
            self.assertEqual((item["entry_state"], len(item["history"])), (GB_REVOKED, 4))
            self.assertEqual([h["decision"] for h in item["history"]], ["APPROVED", "HOLD", "APPROVED", "REVOKED"])
            self.assertEqual([h["reviewer_email"] for h in item["history"]][:2], ["ops_admin@example.com", "superadmin@example.com"])
            self.assertNotIn("spoof@x", json.dumps(item["history"]))
            legacy = self._post(_gb_body("opc:standard:red-single", ["레드 헤나"], "REVOKED", source=OPC, note="운영 기준 변경 확인"))
            self.assertEqual(legacy.status_code, 200, msg=legacy.text)
            self.assertEqual(self._item("opc:standard:red-single", OPC)["entry_state"], GB_REVOKED)
            self.assertEqual(self._item("opc:standard:brown-single", OPC)["entry_state"], GB_APPROVED_LEGACY)
            unit = next(u for u in self.client.get("/reviews/reply-knowledge/items/rrk:naver_review:901").json()["knowhow_items"]
                        if u["originalText"].startswith("레드 헤나는"))
            resp = self.client.post("/reviews/reply-knowledge/unit-fact-validations", headers={"Authorization": "Bearer test-ops_admin"}, json={
                "knowledge_id": "rrk:naver_review:901", "unit_key": unit["factValidation"]["unitKey"], "fact_status": "VERIFIED", **YES2,
                "evidence": [{"source_id": OPC, "entry_key": "opc:standard:red-single", "covers": ["statement", "product", "numeric"]}],
                "verified_scope": "레드 단독 기본 2시간", "note": "철회 후 사용 시도"})
            self.assertEqual((resp.status_code, resp.json()["detail"]["code"]), (409, "CURRENT_APPLICABILITY_UNVERIFIED"))
            summary = self.client.get("/reviews/reply-knowledge/summary").json()
            self.assertEqual(summary["unit_fact_status_counts"].get(FACT_VERIFIED, 0), 0)
        with SessionLocal() as db:
            rows = db.query(ReviewReplyKnowledgeSourceApplicability).order_by(ReviewReplyKnowledgeSourceApplicability.created_at).all()
            self.assertEqual([r.decision for r in rows], ["APPROVED", "HOLD", "APPROVED", "REVOKED", "REVOKED"])
            self.assertEqual(rows[0].applicability_id, rec["applicability_id"])
            self.assertEqual(rows[1].supersedes_record_id, rec["applicability_id"])
            self.assertEqual(db.query(ReviewReplyKnowledgeUnitFactValidation).count(), 0)
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 0)
            self.assertEqual(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:901").one().reply_text, REPLY)
        self.assertEqual(unit_facts_module._sha((REAL_SOURCES_DIR / unit_facts_module.OFFICIAL_GUIDE_V2_FILE).read_text(encoding="utf-8")), self.guide_sha)

    def test_duplicate_approval_is_rejected_over_http_and_reverification_appends(self) -> None:
        key = "html:duration:pack"
        with patch.dict(os.environ, self._WRITE_ENV):
            first = self._post(_gb_body(key, ["헤어팩"]))
            self.assertEqual(first.status_code, 200, msg=first.text)
            rec = first.json()["record"]
            dup = self._post(_gb_body(key, ["헤어팩"], expected=rec["applicability_id"]))
            self.assertEqual(dup.status_code, 409, msg=dup.text)
            self.assertEqual(dup.json()["detail"]["code"], "GATE_B_DUPLICATE_APPROVAL")
            self.assertEqual(dup.json()["detail"]["detail"]["products"][0]["product"], "헤어팩")
            self.assertNotIn("example.com", dup.text)
            again = self._post(_gb_body(key, ["헤어팩"], expected=rec["applicability_id"], note="",
                                        reverification_reason="제품 담당자와 사용 시간 재확인"))
            self.assertEqual(again.status_code, 200, msg=again.text)
            new = again.json()["record"]
            self.assertEqual(new["note"], "[재검증: 헤어팩] 사유: 제품 담당자와 사용 시간 재확인")
            self.assertEqual((new["basis_summary"], new["approved_fact_scope"], new["original_text"]),
                             (rec["basis_summary"], rec["approved_fact_scope"], rec["original_text"]))
            self.assertEqual(self._item(key)["by_product"]["헤어팩"]["state"], GB_APPROVED)
        with SessionLocal() as db:
            rows = db.query(ReviewReplyKnowledgeSourceApplicability).order_by(ReviewReplyKnowledgeSourceApplicability.created_at).all()
            self.assertEqual([(r.decision, r.supersedes_record_id) for r in rows], [("APPROVED", "ROOT"), ("APPROVED", rec["applicability_id"])])
            self.assertEqual(rows[0].note, "Gate B 검증 메모")

    def test_chain_constraint_blocks_concurrent_decisions_on_same_view(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            base = self._post(_gb_body("html:duration:pack", ["헤어팩"], "HOLD"))
            self.assertEqual(base.status_code, 200, msg=base.text)
        with SessionLocal() as db:
            row = db.query(ReviewReplyKnowledgeSourceApplicability).one()
            twin = ReviewReplyKnowledgeSourceApplicability(**{
                c.name: getattr(row, c.name) for c in ReviewReplyKnowledgeSourceApplicability.__table__.columns
            } | {"applicability_id": "twin", "request_id": "gbt-twin-request"})
            db.add(twin)
            with self.assertRaises(Exception):
                db.commit()
            db.rollback()
            self.assertEqual(db.query(ReviewReplyKnowledgeSourceApplicability).count(), 1)


# ---------------------------------------------------------------- read privacy guard (reviewer identity / internal notes)

D1_EMAIL, D1_UID, D1_NOTE = "d1-reviewer@example.test", "d1-uid-sentinel", "D1 내부 판단 메모 sentinel"
UF_NOTE, GB_HOLD_NOTE = "UF 내부 메모 sentinel", "제품 담당 재확인 필요 sentinel"
PRIVACY_SENTINELS = (D1_EMAIL, D1_UID, D1_NOTE, UF_NOTE, GB_HOLD_NOTE, "ops_admin@example.com", "superadmin@example.com",
                     "test-ops_admin", "test-superadmin", "Gate B 검증 메모")
LOW_TOKENS = (None, "test-marketing", "test-sales", "test-accounting", "test-user", "test", "bogus-token")
ADMIN_TOKENS = ("test-ops_admin", "test-superadmin")


class ReadPrivacyGuardTest(_ArtifactDirMixin, unittest.TestCase):
    """Isolated in-memory DB: protected fields reach only verified ops_admin+ readers on every Knowledge read path."""

    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"
    KID = "rrk:naver_review:901"
    GB = "/reviews/reply-knowledge/source-applicability"
    _ENV = {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": "1", "AUTH_TEST_MODE": "1", "REQUIRE_FIREBASE_AUTH": "0"}

    def setUp(self) -> None:
        super().setUp()
        env = patch.dict(os.environ, self._ENV)
        env.start()
        self.addCleanup(env.stop)
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            for model in (ReviewReplyKnowledgeSourceApplicability, ReviewReplyKnowledgeUnitFactValidation, ReviewReplyKnowledgeValidation,
                          NaverReviewReplyRaw, NaverReviewRaw):
                db.query(model).delete(synchronize_session=False)
            db.add(NaverReviewRaw(
                review_key="naver_review:901", product_url="https://smartstore.naver.com/t/products/901", product_title="헤나 염색약",
                review_id_original="901", review_written_at=date(2026, 9, 1), rating=5.0, review_text="방치 시간이 궁금해요",
                text_hash="901", import_source="smartstore_review_upload", reply_exists_flag=True, reply_collect_status="collected",
                raw_payload_json="{}",
            ))
            db.add(NaverReviewReplyRaw(review_key="naver_review:901", reply_text=REPLY))
            db.add(ReviewReplyKnowledgeValidation(
                validation_id="d1-sentinel", knowledge_id=self.KID, review_key="naver_review:901", content_validation="APPROVED",
                reply_appropriate="yes", guidance_accurate="yes", currently_valid="yes", reference_worthy="yes", note=D1_NOTE,
                reviewer=D1_EMAIL, reviewer_uid=D1_UID, reviewer_email=D1_EMAIL, reviewer_role="ops_admin",
                reply_sha256_at_validation=reply_sha256(REPLY),
            ))
            db.commit()
        rows = patch.object(review_reply_knowledge_api, "_product_info_rows", lambda db: PRODUCTION_PRODUCT_INFO_ROWS)
        rows.start()
        self.addCleanup(rows.stop)
        review_reply_knowledge_api._CACHE.update({"key": None, "corpus": None})
        admin = {"Authorization": "Bearer test-ops_admin"}
        unit = next(u for u in self.client.get(f"/reviews/reply-knowledge/items/{self.KID}").json()["knowhow_items"]
                    if u["originalText"].startswith("레드 헤나는"))
        resp = self.client.post("/reviews/reply-knowledge/unit-fact-validations", headers=admin, json={
            "knowledge_id": self.KID, "unit_key": unit["factValidation"]["unitKey"], "fact_status": "HOLD", "note": UF_NOTE})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        first = self.client.post(self.GB, headers=admin, json=_gb_body("html:ratio:red_brown", ["레드 헤나"], skus=["s1"]))
        self.assertEqual(first.status_code, 200, msg=first.text)
        hold = self.client.post(self.GB, headers={"Authorization": "Bearer test-superadmin"}, json=_gb_body(
            "html:ratio:red_brown", ["레드 헤나"], "HOLD", expected=first.json()["record"]["applicability_id"], note=GB_HOLD_NOTE))
        self.assertEqual(hold.status_code, 200, msg=hold.text)
        with SessionLocal() as db:
            self.counts = {m.__tablename__: db.query(m).count() for m in (
                ReviewReplyKnowledgeValidation, ReviewReplyKnowledgeUnitFactValidation, ReviewReplyKnowledgeSourceApplicability)}

    def _calls(self, token: str | None, extra_headers: dict | None = None, params: dict | None = None) -> dict:
        h = {"Authorization": f"Bearer {token}"} if token else {}
        h.update(extra_headers or {})
        out = {
            "queue": self.client.get("/reviews/reply-knowledge/queue", params={"content_validation": "APPROVED", **(params or {})}, headers=h),
            "item": self.client.get(f"/reviews/reply-knowledge/items/{self.KID}", params=params, headers=h),
            "gate_b": self.client.get(self.GB, params=params, headers=h),
            "official": self.client.get("/reviews/reply-knowledge/official-sources", params=params, headers=h),
            "retrieve": self.client.post("/reviews/reply-knowledge/retrieve", params=params, headers=h,
                                         json={"review_text": "레드 헤나 방치 시간이 궁금해요", "top_k": 5}),
        }
        for name, resp in out.items():
            self.assertEqual(resp.status_code, 200, msg=f"{name} {token} -> {resp.status_code}")
            self.assertEqual(resp.headers.get("cache-control"), "private, no-store", msg=name)
            self.assertIn("Authorization", resp.headers.get("vary", ""), msg=name)
        return {k: v.json() for k, v in out.items()}

    def _leaks(self, body: dict) -> list[str]:
        text = json.dumps(body, ensure_ascii=False)
        return [i for i, s in enumerate(PRIVACY_SENTINELS) if s in text]

    def _protected_values(self, obj, path="") -> list[str]:
        """Paths of protected keys that still carry a value (registry source descriptors may keep their static note)."""
        found = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in review_reply_knowledge_api.IDENTITY_PROTECTED_FIELDS and v is not None and not (
                        k == "note" and review_reply_knowledge_api._is_registry_source(obj)):
                    found.append(f"{path}.{k}")
                found += self._protected_values(v, f"{path}.{k}")
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                found += self._protected_values(v, f"{path}[{i}]")
        return found

    def _assert_redacted(self, bodies: dict, label: str) -> None:
        for name, body in bodies.items():
            self.assertIs(body["identity_redacted"], True, msg=f"{label} {name}")
            self.assertEqual(self._leaks(body), [], msg=f"{label} {name}: sentinel index leaked")
            self.assertEqual(self._protected_values(body), [], msg=f"{label} {name}")

    def test_admin_sees_identity_on_every_path_including_nested_history(self) -> None:
        for token in ADMIN_TOKENS:
            b = self._calls(token)
            self.assertTrue(all(x["identity_redacted"] is False for x in b.values()))
            item = b["item"]
            self.assertEqual((item["latest_validation"]["reviewer_email"], item["latest_validation"]["reviewer_uid"]), (D1_EMAIL, D1_UID))
            self.assertEqual(item["validation_history"][0]["note"], D1_NOTE)
            self.assertEqual(item["unit_fact_history"][0]["note"], UF_NOTE)
            self.assertIn(UF_NOTE, json.dumps([u["factValidation"].get("latest") for u in item["knowhow_items"]], ensure_ascii=False))
            self.assertIn(D1_EMAIL, json.dumps(b["queue"], ensure_ascii=False))
            gb = next(x for x in b["gate_b"]["items"] if x["entry_key"] == "html:ratio:red_brown")
            self.assertEqual([h["reviewer_email"] for h in gb["history"]], ["ops_admin@example.com", "superadmin@example.com"])
            self.assertEqual((gb["history"][0]["basis_reference"], gb["history"][1]["note"]), (gb["audit_template"]["gate_a_reference"], GB_HOLD_NOTE))
            self.assertEqual(gb["by_product"]["레드 헤나"]["reviewer_email"], "superadmin@example.com")
            self.assertIn("superadmin@example.com", json.dumps(b["official"], ensure_ascii=False))
            self.assertIn(UF_NOTE, json.dumps(b["retrieve"], ensure_ascii=False))

    def test_low_roles_unauthenticated_and_spoofed_requests_get_redacted_copies(self) -> None:
        admin = self._calls("test-ops_admin")
        for token in LOW_TOKENS:
            self._assert_redacted(self._calls(token), f"token={token}")
        spoof = {"X-Role": "superadmin", "X-User-Role": "superadmin", "X-Reviewer-Email": "x@y", "X-Forwarded-User": "superadmin"}
        self._assert_redacted(self._calls(None, spoof, {"role": "superadmin", "identity": "1"}), "spoofed headers/query")
        with patch.dict(os.environ, {"AUTH_TEST_MODE": "", "FIREBASE_PROJECT_ID": "test-project"}):
            for token in ADMIN_TOKENS + ("eyJhbGciOiJub25lIn0.eyJyb2xlcyI6WyJzdXBlcmFkbWluIl19.",):
                self._assert_redacted(self._calls(token), "REQUIRE_FIREBASE_AUTH=0 without verifiable token")
        anon = self._calls(None)
        for name in anon:
            expected = review_reply_knowledge_api.redact_identity(admin[name]) | {"identity_redacted": True}
            self.assertEqual(anon[name], expected, msg=f"{name}: redacted view must equal admin view minus protected fields")
        gb = next(x for x in anon["gate_b"]["items"] if x["entry_key"] == "html:ratio:red_brown")
        self.assertEqual([h["decision"] for h in gb["history"]], ["APPROVED", "HOLD"])
        self.assertEqual([h["reviewer_role"] for h in gb["history"]], ["ops_admin", "superadmin"])
        self.assertEqual((gb["by_product"]["레드 헤나"]["state"], gb["entry_state"]), (GB_HOLD, GB_HOLD))
        self.assertTrue(gb["history"][0]["created_at"] and gb["history"][0]["original_text"])
        self.assertEqual(anon["gate_b"]["summary"]["by_priority"], {"P1": 14, "P2": 16, "P3": 31})
        self.assertEqual(anon["official"]["verifiable_entry_count"], admin["official"]["verifiable_entry_count"])
        self.assertEqual(anon["item"]["content_validation"], "APPROVED")

    def test_shared_cache_is_never_mutated_by_any_request_order(self) -> None:
        sequence = [None, "test-ops_admin", "test-marketing", "test-superadmin", None, None, "test-ops_admin", "test-sales"]
        for token in sequence * 2:
            b = self._calls(token)
            if token in ADMIN_TOKENS:
                self.assertIn(D1_EMAIL, json.dumps(b["item"], ensure_ascii=False))
                self.assertIn(GB_HOLD_NOTE, json.dumps(b["gate_b"], ensure_ascii=False))
            else:
                self._assert_redacted(b, f"sequence token={token}")
        cached = json.dumps(review_reply_knowledge_api._CACHE["corpus"]["items"], ensure_ascii=False, default=str)
        self.assertIn(D1_EMAIL, cached)
        self.assertIn(UF_NOTE, cached)
        with SessionLocal() as db:
            self.assertEqual({m.__tablename__: db.query(m).count() for m in (
                ReviewReplyKnowledgeValidation, ReviewReplyKnowledgeUnitFactValidation, ReviewReplyKnowledgeSourceApplicability)}, self.counts)
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).one().reviewer_email, D1_EMAIL)
            self.assertEqual(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:901").one().reply_text, REPLY)

    def test_nas_mode_requires_login_and_still_redacts_below_ops_admin(self) -> None:
        with patch.dict(os.environ, {"REQUIRE_FIREBASE_AUTH": "1", "FIREBASE_PROJECT_ID": "test-project"}):
            for path in ("/reviews/reply-knowledge/queue", f"/reviews/reply-knowledge/items/{self.KID}", self.GB,
                         "/reviews/reply-knowledge/official-sources"):
                self.assertEqual(self.client.get(path).status_code, 401, msg=path)
            for token in ("test-marketing", "test-sales", "test-accounting", "test-user"):
                self._assert_redacted(self._calls(token), f"NAS token={token}")
            self.assertIn(D1_EMAIL, json.dumps(self._calls("test-ops_admin")["item"], ensure_ascii=False))

    def test_write_permissions_unchanged(self) -> None:
        body = _gb_body("html:duration:pack", ["헤어팩"], "HOLD")
        self.assertEqual(self.client.post(self.GB, json=body).status_code, 401)
        self.assertEqual(self.client.post(self.GB, json=body, headers={"Authorization": "Bearer test-marketing"}).status_code, 403)
        ok = self.client.post(self.GB, json=body, headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(ok.status_code, 200, msg=ok.text)
        self.assertEqual(ok.json()["record"]["reviewer_email"], "ops_admin@example.com")
        for path, payload in (("/reviews/reply-knowledge/validations", {"knowledge_id": self.KID, "content_validation": "HOLD", "note": "권한 확인"}),
                              ("/reviews/reply-knowledge/unit-fact-validations", {"knowledge_id": self.KID, "unit_key": "x", "fact_status": "HOLD", "note": "권한 확인"})):
            self.assertEqual(self.client.post(path, json=payload).status_code, 401, msg=path)
            self.assertEqual(self.client.post(path, json=payload, headers={"Authorization": "Bearer test-marketing"}).status_code, 403, msg=path)


def _unit_dict(text: str, products: list, *, kind: str = "PRODUCT_USAGE", numeric: list | None = None, sequence: list | None = None,
               context: str = "UNKNOWN") -> dict:
    return {"originalText": text, "product": products, "knowledgeType": kind, "numericRange": [{"text": t} for t in numeric or []],
            "sequence": sequence or [], "condition": "UNKNOWN", "contextBefore": context, "conditionReference": "UNKNOWN",
            "isKnowledgeCandidate": True}


class SemanticGuardTest(_ArtifactDirMixin, unittest.TestCase):
    """Claim target / claim kind / efficacy / ratio direction against the tracked V2 registry with test Gate B records."""

    artifact_dir_name = "EMPTY_DIR"
    sources_dir_name = "REAL_SOURCES_DIR"
    APPROVE = ((HTML, "html:product:수자타 레드"), (HTML, "html:product:딥클린 헤어팩"), (HTML, "html:product:손상케어 헤어팩"),
               (HTML, "html:care:04"), (HTML, "html:duration:pack"), (HTML, "html:ratio:natural_brown"), (HTML, "html:ratio:red_brown"),
               (HTML, "html:sequence:dark_brown"), (HTML, "html:procedure:order"), (HTML, "html:step:02"))

    def _records(self, keys, decision: str = "APPROVED", start: int = 0) -> list:
        base = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS)
        out = []
        for i, (sid, key) in enumerate(keys, start):
            entry = next(e for e in base["sources"][sid]["entries"] if e["entry_key"] == key)
            out.append({"applicability_id": f"sg-{i}", "source_id": sid, "entry_key": key, "decision": decision, "products": entry["products"],
                        "entry_content_sha256": entry["entry_sha256"], "source_sha256": base["sources"][sid]["sha256"],
                        "created_at": f"2026-10-10T00:00:{i:02d}"})
        return out

    def setUp(self) -> None:
        super().setUp()
        self.records = self._records(self.APPROVE)
        self.registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS, applicability_records=self.records)

    def _try(self, unit: dict, keys: list, registry: dict | None = None) -> str:
        registry = registry or self.registry
        aspects = unit_facts_module.applicable_aspects(unit)
        evidence = []
        for key in keys:
            sid = OPC if key.startswith("opc:") else HTML
            entry = next(e for e in registry["sources"][sid]["entries"] if e["entry_key"] == key)
            evidence.append({"source_id": sid, "entry_key": key, "covers": [a for a in entry["aspects"] if a in aspects]})
        payload = {"fact_status": "VERIFIED", "generator_reference_allowed": "no", "evidence": evidence, "verified_scope": "공식 근거 범위",
                   "note": "의미 보호 회귀", **{ASPECT_FIELDS[a]: "yes" for a in aspects}}
        try:
            validate_unit_fact_submission(unit, payload, registry)
        except UnitFactValidationError as exc:
            return exc.code
        return "VERIFIED"

    def test_audit_risk_cases_no_longer_pass_on_format_alone(self) -> None:
        red = ["html:product:수자타 레드"]
        self.assertEqual(self._try(_unit_dict("레드 제품에는 딥클린의 효과도 있습니다.", ["레드 헤나"]), red), "UNSUPPORTED_EFFICACY_CLAIM")
        self.assertEqual(self._try(_unit_dict("염색 지속력을 위해서는 레드 비율을 더 높여보시기를 권장드립니다.", ["레드 헤나"]), red),
                         "UNSUPPORTED_EFFICACY_CLAIM")
        self.assertEqual(self._try(_unit_dict("레드 특유의 자연스럽고 화사한 발색을 좋아해 주셔서 기쁩니다.", ["레드 헤나"]), red),
                         "EVIDENCE_FACT_TYPE_CANNOT_SUPPORT_CLAIM")
        lineup = _unit_dict("신제품 헤어팩(딥클린, 손상케어, 두피케어, 볼륨업)도 사용해주시면 많은 도움되십니다.", ["헤어팩"])
        self.assertEqual(self._try(lineup, ["html:product:딥클린 헤어팩"]), "PRODUCT_VARIANT_MISMATCH")
        rinse = _unit_dict("기존 린스, 트리트먼트 사용 여부에 따라 처음엔 발색이 조금 약하게 나타날 수 있어요.", ["헤어팩"])
        self.assertEqual(self._try(rinse, ["html:product:딥클린 헤어팩"]), "PRODUCT_VARIANT_UNRESOLVED")
        self.assertEqual(self._try(rinse, ["html:step:02"]), "EVIDENCE_FACT_TYPE_CANNOT_SUPPORT_CLAIM")

    def test_deep_clean_facts_stay_on_deep_clean(self) -> None:
        oily = "기름진 두피와 모발에는 {} 헤어팩이 잘 맞습니다."
        self.assertEqual(self._try(_unit_dict(oily.format("딥클린"), ["헤어팩"]), ["html:care:04"]), "VERIFIED")
        self.assertEqual(self._try(_unit_dict(oily.format("볼륨업"), ["헤어팩"]), ["html:care:04"]), "PRODUCT_VARIANT_MISMATCH")
        unresolved = _unit_dict("기름진 두피와 모발에 잘 맞습니다.", ["헤어팩"])
        self.assertEqual(self._try(unresolved, ["html:care:04"]), "PRODUCT_VARIANT_UNRESOLVED")
        in_context = _unit_dict("기름진 두피와 모발에 잘 맞습니다.", ["헤어팩"], context="딥클린 헤어팩 구매해 주셔서 감사합니다.")
        self.assertEqual(self._try(in_context, ["html:care:04"]), "VERIFIED")
        four = _unit_dict("신제품 헤어팩(딥클린, 두피케어, 손상케어, 볼륨업)은 1시간이면 충분하오니 참고부탁드립니다.", ["헤어팩"],
                          kind="NUMERIC_GUIDANCE", numeric=["1시간"])
        self.assertEqual(self._try(four, ["html:duration:pack"]), "VERIFIED")
        self.assertEqual(self._try(four, ["html:duration:pack", "html:product:딥클린 헤어팩"]), "PRODUCT_VARIANT_MISMATCH")

    def test_efficacy_needs_an_entry_stating_it_for_that_product(self) -> None:
        damage = _unit_dict("손상케어 헤어팩은 건조하고 푸석한 모발 관리에 좋아요.", ["헤어팩"])
        self.assertEqual(self._try(damage, ["html:product:손상케어 헤어팩"]), "VERIFIED")
        self.assertEqual(self._try(damage, ["html:product:딥클린 헤어팩"]), "PRODUCT_VARIANT_MISMATCH")
        synergy = _unit_dict("헤어팩은 1시간이면 충분하고 함께 쓰시면 시너지 효과가 있습니다.", ["헤어팩"], kind="NUMERIC_GUIDANCE", numeric=["1시간"])
        self.assertEqual(self._try(synergy, ["html:duration:pack"]), "UNSUPPORTED_EFFICACY_CLAIM")

    def test_product_description_does_not_approve_usage(self) -> None:
        usage = _unit_dict("레드는 샴푸 후 젖은 머리에 발라 주세요.", ["레드 헤나"])
        self.assertEqual(self._try(usage, ["html:product:수자타 레드"]), "EVIDENCE_FACT_TYPE_CANNOT_SUPPORT_CLAIM")
        tone = _unit_dict("수자타 레드는 따뜻한 오렌지 계열의 헤나입니다.", ["레드 헤나"])
        self.assertEqual(self._try(tone, ["html:product:수자타 레드"]), "VERIFIED")

    def test_dye_sequence_needs_sequential_evidence(self) -> None:
        seq = _unit_dict("짙은 갈색을 원하시면 레드 후 브라운이 좋습니다.", DYES)
        self.assertEqual(self._try(seq, ["html:sequence:dark_brown"]), "VERIFIED")
        self.assertEqual(self._try(seq, ["html:procedure:order"]), "EVIDENCE_FACT_TYPE_CANNOT_SUPPORT_CLAIM")

    def test_ratio_direction_follows_product_names(self) -> None:
        tokens = lambda text: unit_facts_module.claim_ratio_tokens(text)  # noqa: E731
        for text in ("레드 2 : 브라운 8", "브라운 8 : 레드 2", "브라운과 레드 8:2로 배합", "레드 20% + 브라운 80%"):
            self.assertEqual(tokens(text), {("1:4", "RATIO")}, msg=text)
        for text in ("레드 8 : 브라운 2", "브라운 2 : 레드 8", "레드와 브라운 8:2"):
            self.assertEqual(tokens(text), {("4:1", "RATIO")}, msg=text)
        self.assertEqual(tokens("2:8로 섞어 주세요"), {("1:4", "RATIO")})
        natural = ["html:ratio:natural_brown"]
        cases = (("😊 브라운과 레드 8:2로 배합해서 사용해보셨군요 자연스럽게 표현되셨다니 다행입니다.", "레드 8:2", "VERIFIED"),
                 ("😊 브라운 8 : 레드 2 비율로 고객님께 맞는 자연스러운 색상을 찾으셨다니 정말 기쁩니다.", "브라운 8 : 레드 2", "VERIFIED"),
                 ("레드 8 : 브라운 2 비율로 섞어 주세요.", "레드 8 : 브라운 2", "numeric_exceeds_official_scope"),
                 ("브라운 2 : 레드 8 비율로 섞어 주세요.", "브라운 2 : 레드 8", "numeric_exceeds_official_scope"))
        for text, numeric, expected in cases:
            self.assertEqual(self._try(_unit_dict(text, DYES, kind="NUMERIC_GUIDANCE", numeric=[numeric]), natural), expected, msg=text)
        self.assertEqual(self._try(_unit_dict("레드 3 : 브라운 7 비율로 섞어 주세요.", DYES, kind="NUMERIC_GUIDANCE", numeric=["레드 3 : 브라운 7"]),
                                   natural), "numeric_exceeds_official_scope")

    def test_gate_b_revocation_still_blocks(self) -> None:
        unit = _unit_dict("레드 2 : 브라운 8 비율로 섞어 주세요.", DYES, kind="NUMERIC_GUIDANCE", numeric=["레드 2 : 브라운 8"])
        self.assertEqual(self._try(unit, ["html:ratio:natural_brown"]), "VERIFIED")
        revoked = self.records + self._records([(HTML, "html:ratio:natural_brown")], "REVOKED", start=len(self.records))
        registry = load_official_source_registry(product_info_rows=PRODUCTION_PRODUCT_INFO_ROWS, applicability_records=revoked)
        self.assertEqual(self._try(unit, ["html:ratio:natural_brown"], registry), "CURRENT_APPLICABILITY_UNVERIFIED")


if __name__ == "__main__":
    unittest.main()
