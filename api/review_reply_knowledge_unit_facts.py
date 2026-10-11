"""Per-unit fact validation of guidance extracted from historical replies.

A unit (one extracted guidance span) is validated on its own against registered official
sources only. Historical replies and category research never verify a product fact. Records
are append-only; applicability is derived at read time from the unit key (reply hash +
extraction version + span + unit text) and the current official source entry hashes.

Also holds the generator input/output contract (pure functions, not wired to any generator).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

from review_reply_knowledge_extraction import (
    EXTRACTION_VERSION,
    TYPE_CAUTION,
    TYPE_QUESTION,
    UNKNOWN,
    _DURATION_RE,
    _INLINE_CONDITION_RE,
    _RATIO_RE,
    _products,
)

UNIT_FACT_CONTRACT_VERSION = "unit_fact_validation_v1"

FACT_PENDING = "PENDING"
FACT_VERIFIED = "VERIFIED"
FACT_HOLD = "HOLD"
FACT_REJECTED = "REJECTED"
FACT_OUTDATED = "OUTDATED"
FACT_STATES = (FACT_PENDING, FACT_VERIFIED, FACT_HOLD, FACT_REJECTED, FACT_OUTDATED)
FACT_STORED_STATES = (FACT_VERIFIED, FACT_HOLD, FACT_REJECTED, FACT_OUTDATED)

HOLD_SOURCE_MISSING = "FACT_VALIDATION_SOURCE_MISSING"
HOLD_PARTIAL_EVIDENCE = "PARTIAL_OFFICIAL_EVIDENCE"
HOLD_PRODUCT_SCOPE_UNKNOWN = "PRODUCT_SCOPE_UNKNOWN"
HOLD_NEEDS_OWNER_CONFIRMATION = "NEEDS_PRODUCT_OWNER_CONFIRMATION"
HOLD_OTHER = "OTHER"
HOLD_REASONS = (HOLD_SOURCE_MISSING, HOLD_PARTIAL_EVIDENCE, HOLD_PRODUCT_SCOPE_UNKNOWN, HOLD_NEEDS_OWNER_CONFIRMATION, HOLD_OTHER)

RES_NO_RECORD = "NO_RECORD"
RES_APPLICABLE = "APPLICABLE"
RES_STALE_REPLY_CHANGED = "STALE_REPLY_CHANGED"
RES_STALE_UNIT_CHANGED = "STALE_UNIT_OR_EXTRACTION_CHANGED"
RES_SOURCE_CHANGED = "OFFICIAL_SOURCE_CHANGED"
RESOLUTIONS = (RES_NO_RECORD, RES_APPLICABLE, RES_STALE_REPLY_CHANGED, RES_STALE_UNIT_CHANGED, RES_SOURCE_CHANGED)

ASPECT_STATEMENT = "statement"
ASPECT_PRODUCT = "product"
ASPECT_CONDITION = "condition"
ASPECT_SEQUENCE = "sequence"
ASPECT_NUMERIC = "numeric"
ASPECTS = (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_CONDITION, ASPECT_SEQUENCE, ASPECT_NUMERIC)

ANSWER_FIELDS = {
    "statement_accurate": ASPECT_STATEMENT,
    "product_applicable": ASPECT_PRODUCT,
    "condition_accurate": ASPECT_CONDITION,
    "sequence_accurate": ASPECT_SEQUENCE,
    "numeric_accurate": ASPECT_NUMERIC,
}
GENERATOR_REFERENCE_FIELD = "generator_reference_allowed"
ANSWER_VALUES = ("yes", "no", "unsure", "na")
NOTE_MIN_CHARS = 5

# Parent reply authorities under which a VERIFIED unit may be used as a generator fact.
UNIT_FACT_PARENT_ALLOWED = ("EXTRACTED_KNOWLEDGE", "APPROVED_HISTORICAL_REFERENCE", "VALIDATED_KNOWLEDGE")

# ---------------------------------------------------------------- official source registry

SOURCE_REGISTRY_VERSION = "official_fact_source_registry_v2"
SOURCE_STATUS_ACTIVE = "ACTIVE"
SOURCE_STATUS_CANDIDATE_ONLY = "CANDIDATE_ONLY"
SOURCE_STATUS_REGISTRATION_PENDING = "REGISTRATION_PENDING"
SOURCE_STATUS_POLICY_ONLY = "POLICY_ONLY"

AUTHORITY_OFFICIAL_PRODUCT_GUIDE = "OFFICIAL_PRODUCT_GUIDE"
AUTHORITY_CURRENT_PRODUCT_INFO = "CURRENT_PRODUCT_INFO"
AUTHORITY_OPERATOR_CONFIRMED = "OPERATOR_CONFIRMED_CURRENT_GUIDANCE"
AUTHORITY_PROJECT_POLICY = "PROJECT_POLICY"
AUTHORITY_CATEGORY_RESEARCH = "CATEGORY_RESEARCH"
AUTHORITY_UNREGISTERED_OFFICIAL_ORIGINAL = "UNREGISTERED_OFFICIAL_ORIGINAL"
VERIFYING_AUTHORITIES = (AUTHORITY_OFFICIAL_PRODUCT_GUIDE, AUTHORITY_CURRENT_PRODUCT_INFO, AUTHORITY_OPERATOR_CONFIRMED)

# Gate A (source fidelity) and Gate B (current product applicability) are independent.
FIDELITY_PASS = "PASS"
APPLICABILITY_VERIFIED = "CURRENT_APPLICABILITY_VERIFIED"
APPLICABILITY_UNVERIFIED = "CURRENT_APPLICABILITY_UNVERIFIED"

# Entry kind -> aspects it can evidence. "restriction" entries forbid generalisation and evidence nothing.
ENTRY_KIND_ASPECTS = {
    "variant": (ASPECT_STATEMENT, ASPECT_PRODUCT),
    "duration": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_NUMERIC),
    "conditional_duration": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_NUMERIC, ASPECT_CONDITION),
    "sequence_duration": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_SEQUENCE, ASPECT_NUMERIC),
    "ratio": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_NUMERIC),
    "caution": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_CONDITION),
    "condition": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_CONDITION),
    "sequence": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_SEQUENCE),
    "procedure": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_SEQUENCE),
    "procedure_step": (ASPECT_STATEMENT, ASPECT_PRODUCT),
    "tip": (ASPECT_STATEMENT, ASPECT_PRODUCT),
    "recommendation": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_CONDITION),
    "amount": (ASPECT_STATEMENT, ASPECT_PRODUCT, ASPECT_NUMERIC),
    "companion": (ASPECT_STATEMENT, ASPECT_PRODUCT),
    "ingredient": (ASPECT_STATEMENT, ASPECT_PRODUCT),
    "limitation": (ASPECT_STATEMENT,),
    "restriction": (),
}

_ARTIFACT_DIR = Path(__file__).resolve().parent / "content_blog_knowledge_artifacts"
_SOURCES_DIR = Path(__file__).resolve().parent / "review_reply_knowledge_sources"
OFFICIAL_GUIDE_V2_FILE = "official_usage_guide_v2.json"
PRODUCT_INFO_SOURCE_ID = "content_product_info"
DYE_PRODUCTS = ("레드 헤나", "브라운 헤나")
MODE_SINGLE = "single"
MODE_SEQUENTIAL = "sequential"
MODE_MIXED = "mixed"
MODE_UNSPECIFIED = "unspecified"
_MODE_SEQ_RE = re.compile(r"1차|2차|먼저|순서|순차|단계|후에?\s*(?:레드|브라운)|(?:레드|브라운)\s*(?:사용|도포|염색)?\s*(?:후|다음)")
_MODE_MIX_RE = re.compile(r"섞|혼합|배합|비율|반반")
CATEGORY_PACKS = (
    ("henna_category_pack_v1", "research/HENNA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1.json"),
    ("jojoba_category_pack_v1", "research/JOJOBA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1.json"),
)
PENDING_REGISTRATIONS = (
    {
        "source_id": "official_product_detail_pages",
        "authority_class": AUTHORITY_UNREGISTERED_OFFICIAL_ORIGINAL,
        "status": SOURCE_STATUS_REGISTRATION_PENDING,
        "location": "current smartstore product detail pages (capture + hash required at registration)",
        "note": "Free-typed URLs/quotes are never accepted as evidence; register first, then select the entry.",
    },
)
REGISTRATION_CONTRACT = {
    "required_fields": ["source_id", "version", "authority_class", "sha256", "entries[entry_key, kind, statement, products]"],
    "entry_kinds": sorted(ENTRY_KIND_ASPECTS),
    "verifying_authorities": list(VERIFYING_AUTHORITIES),
    "rules": [
        "Only ACTIVE sources with a verifying authority can support VERIFIED.",
        "Each entry carries its own sha256; a changed or removed entry makes dependent VERIFIED records OFFICIAL_SOURCE_CHANGED.",
        "Product scope is explicit per entry; a unit product outside the scope cannot be verified by that entry.",
        "Registration is a reviewed change to the registry (version bump); nothing is auto-collected or auto-approved.",
        "Gate A: an entry with a source fidelity status supports VERIFIED only when it is PASS.",
        "Gate B: an entry with an applicability record supports VERIFIED only for products covered by an APPROVED review.",
        "Operator-confirmed guidance is a separate source and is never recorded as an HTML quote.",
        "Conditional entries require the condition in the unit text; mode-specific entries (single/sequential/mixed) require the same mode.",
        "Gate B records are per entry and per product; a product present in content_product_info is never approved by that fact alone.",
    ],
}

# ---------------------------------------------------------------- Gate B (current applicability) review records

GATE_B_CONTRACT_VERSION = "official_source_applicability_v1"
GATE_B_APPROVED = "APPROVED"
GATE_B_HOLD = "HOLD"
GATE_B_EXCLUDED = "EXCLUDED"
GATE_B_REVOKED = "REVOKED"
GATE_B_DECISIONS = (GATE_B_APPROVED, GATE_B_HOLD, GATE_B_EXCLUDED, GATE_B_REVOKED)

# Effective state per (entry, product), computed at read time. Only APPROVED / APPROVED_LEGACY are usable as evidence.
GB_PENDING = "PENDING"
GB_APPROVED = "APPROVED"
GB_APPROVED_LEGACY = "APPROVED_LEGACY"
GB_HOLD = "HOLD"
GB_EXCLUDED = "EXCLUDED"
GB_REVOKED = "REVOKED"
GB_RECHECK = "RECHECK_REQUIRED"
GB_PARTIAL = "PARTIALLY_APPROVED"
GB_USABLE = (GB_APPROVED, GB_APPROVED_LEGACY)
GB_DECISION_STATE = {GATE_B_APPROVED: GB_APPROVED, GATE_B_HOLD: GB_HOLD, GATE_B_EXCLUDED: GB_EXCLUDED, GATE_B_REVOKED: GB_REVOKED}
GB_ENTRY_LEVEL = "_entry"

ORIGIN_LEGACY = "LEGACY_OPERATOR_ATTESTATION"
ORIGIN_GATE_B = "GATE_B_REVIEW"
ORIGIN_MIXED = "MIXED"

GATE_B_QUESTIONS = {
    "product_applicable": "현재 해당 제품에 적용 가능한가",
    "usage_accurate": "현재 사용법·조건·수치·순서가 정확한가",
    "exceptions_checked": "제품별 제한·예외를 확인했는가",
    "scope_clear": "적용 범위(제품·사용 방식·조건)가 명확한가",
    "company_standard_confirmed": "회사가 현재 인정하는 사용 기준이라는 근거가 있는가",
}
GATE_B_ANSWER_VALUES = ("yes", "no", "unsure")
GATE_B_BASIS_ADMIN_CONFIRMATION = "ADMIN_DIRECT_CURRENT_APPLICABILITY_CONFIRMATION"
GATE_B_BASIS_TYPES = {
    GATE_B_BASIS_ADMIN_CONFIRMATION: "관리자 직접 확인 (선택 제품의 현재 적용성)",
    "OFFICIAL_GUIDE_CURRENT": "현재 게시·사용 중인 공식 가이드의 해당 안내",
    "CURRENT_PRODUCT_MANUAL": "현행 제품 사용설명서",
    "COMPANY_OPERATING_STANDARD": "확인된 회사 운영 기준",
    "OTHER_DOCUMENTED_BASIS": "기타 문서화된 근거",
}
# One explicit admin act covers every GATE_B_QUESTIONS aspect for the selected products; the five answer columns
# record that act (yes / unsure / no), they are never defaulted to "yes" without it.
GATE_B_CONFIRMED = "CONFIRMED_CURRENT_STANDARD"
GATE_B_NEEDS_CHECK = "NEEDS_CHECK"
GATE_B_NOT_APPLICABLE = "NOT_APPLICABLE"
GATE_B_CONFIRMATIONS = {
    GATE_B_CONFIRMED: "예, 현재도 선택한 제품에 적용합니다",
    GATE_B_NEEDS_CHECK: "추가 확인이 필요합니다",
    GATE_B_NOT_APPLICABLE: "현재는 선택한 제품에 적용하지 않습니다",
}
GATE_B_CONFIRMATION_ANSWER = {GATE_B_CONFIRMED: "yes", GATE_B_NEEDS_CHECK: "unsure", GATE_B_NOT_APPLICABLE: "no"}
GATE_B_DECISION_CONFIRMATIONS = {
    "APPROVED": (GATE_B_CONFIRMED,),
    "HOLD": (GATE_B_NEEDS_CHECK, GATE_B_NOT_APPLICABLE),
    "EXCLUDED": (GATE_B_NOT_APPLICABLE,),
    "REVOKED": (None, GATE_B_NEEDS_CHECK, GATE_B_NOT_APPLICABLE),
}
GATE_B_DECISION_LABELS = {"APPROVED": "승인", "HOLD": "보류", "EXCLUDED": "제외", "REVOKED": "승인 철회"}
# Written by the server from the registry entry and the admin's act; a client value is a forgery attempt.
GATE_B_SERVER_AUTHORED_FIELDS = (
    "basis_type", "basis_reference", "basis_summary", "approved_fact_scope", "limitations_exceptions", *GATE_B_QUESTIONS,
)
GATE_B_ADMIN_EXCEPTIONS_MAX = 1000
GATE_B_REVERIFICATION_MIN = 10
GATE_B_NOT_IN_SOURCE = "원문에 별도 기재 없음"
GATE_B_MODE_LABELS = {MODE_SINGLE: "단독", MODE_MIXED: "혼합", MODE_SEQUENTIAL: "순차", MODE_UNSPECIFIED: "미지정"}
# Operator confirmations that a source document is still handed to customers. Context only: never approves an entry.
SOURCE_CURRENT_GUIDANCE_NOTES = {
    "sujata_usage_guide_html": "G0(2026-10-10 운영자 확인): 자사몰 배포용 공식 사용가이드는 현재도 고객 안내 자료로 사용 중",
}
GATE_B_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,80}$")
GATE_B_IDENTITY_FIELDS = ("reviewer", "reviewer_uid", "reviewer_email", "reviewer_role", "confirmed_by", "confirmedBy", "created_at")
GATE_B_ROOT = "ROOT"

# Review queue (priority, topic) for the HTML entries from REVIEW_KNOWLEDGE_OFFICIAL_GUIDE_GATE_B_APPLICABILITY_V1.
# Priority orders the review only; it never approves anything.
GATE_B_REVIEW_QUEUE = {
    "html:amount:긴 머리": ("P3", "AMOUNT_BY_LENGTH"),
    "html:amount:단발": ("P3", "AMOUNT_BY_LENGTH"),
    "html:amount:어깨 길이": ("P3", "AMOUNT_BY_LENGTH"),
    "html:amount:짧은 머리": ("P3", "AMOUNT_BY_LENGTH"),
    "html:care:01": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:02": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:03": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:04": ("P2", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:05": ("P2", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:06": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:07": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:08": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:09": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:10": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:11": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:care:12": ("P3", "RECOMMENDATION_BY_HAIR_CONDITION"),
    "html:caution:bleach-check": ("P3", "PATCH_TEST_AND_CAUTION"),
    "html:caution:bleached": ("P3", "PATCH_TEST_AND_CAUTION"),
    "html:caution:current-color": ("P2", "PATCH_TEST_AND_CAUTION"),
    "html:caution:gray-high": ("P1", "TIME_AND_ADJUSTMENT"),
    "html:caution:gray-test-time": ("P1", "TIME_AND_ADJUSTMENT"),
    "html:caution:patch-test": ("P2", "PATCH_TEST_AND_CAUTION"),
    "html:caution:sensitive": ("P2", "PATCH_TEST_AND_CAUTION"),
    "html:companion:jojoba-oil": ("P3", "OTHER_DISCLAIMER_AND_COMPANION"),
    "html:companion:yeast-shampoo": ("P3", "PRODUCT_NOT_IN_CURRENT_PRODUCT_INFO"),
    "html:duration:pack": ("P1", "HAIR_PACK_USAGE_AND_MIX"),
    "html:faq:amount": ("P3", "AMOUNT_BY_LENGTH"),
    "html:faq:bleached-hair": ("P3", "PATCH_TEST_AND_CAUTION"),
    "html:faq:first-use": ("P1", "PATCH_TEST_AND_CAUTION"),
    "html:faq:gray_or_dark_brown_sequence": ("P1", "RED_BROWN_SEQUENCE"),
    "html:faq:rinse-shampoo": ("P3", "COMMON_PROCEDURE_AND_TIPS"),
    "html:faq:sensitive-skin": ("P2", "PATCH_TEST_AND_CAUTION"),
    "html:limitation:diagnosis-notice": ("P3", "OTHER_DISCLAIMER_AND_COMPANION"),
    "html:limitation:footer": ("P3", "OTHER_DISCLAIMER_AND_COMPANION"),
    "html:packmix:single": ("P1", "HAIR_PACK_USAGE_AND_MIX"),
    "html:packmix:three_plus": ("P1", "HAIR_PACK_USAGE_AND_MIX"),
    "html:packmix:two": ("P1", "HAIR_PACK_USAGE_AND_MIX"),
    "html:procedure:order": ("P3", "COMMON_PROCEDURE_AND_TIPS"),
    "html:product:두피 케어 헤어팩": ("P3", "PRODUCT_CHARACTERISTICS"),
    "html:product:딥클린 헤어팩": ("P2", "PRODUCT_CHARACTERISTICS"),
    "html:product:맥주효모 샴푸": ("P3", "PRODUCT_NOT_IN_CURRENT_PRODUCT_INFO"),
    "html:product:볼륨업 헤어팩": ("P3", "PRODUCT_CHARACTERISTICS"),
    "html:product:손상케어 헤어팩": ("P3", "PRODUCT_CHARACTERISTICS"),
    "html:product:수자타 내추럴": ("P3", "PRODUCT_NOT_IN_CURRENT_PRODUCT_INFO"),
    "html:product:수자타 레드": ("P2", "PRODUCT_CHARACTERISTICS"),
    "html:product:수자타 브라운": ("P2", "PRODUCT_CHARACTERISTICS"),
    "html:product:호호바 오일": ("P3", "OTHER_DISCLAIMER_AND_COMPANION"),
    "html:ratio:natural_brown": ("P1", "RED_BROWN_RATIO"),
    "html:ratio:orange": ("P1", "RED_BROWN_RATIO"),
    "html:ratio:red_brown": ("P1", "RED_BROWN_RATIO"),
    "html:sequence:dark_brown": ("P1", "RED_BROWN_SEQUENCE"),
    "html:step:01": ("P2", "COMMON_PROCEDURE_AND_TIPS"),
    "html:step:02": ("P2", "COMMON_PROCEDURE_AND_TIPS"),
    "html:step:03": ("P2", "COMMON_PROCEDURE_AND_TIPS"),
    "html:step:04": ("P1", "TIME_AND_ADJUSTMENT"),
    "html:step:05": ("P1", "TIME_AND_ADJUSTMENT"),
    "html:step:06": ("P3", "COMMON_PROCEDURE_AND_TIPS"),
    "html:step:07": ("P2", "COMMON_PROCEDURE_AND_TIPS"),
    "html:tip:amount": ("P2", "COMMON_PROCEDURE_AND_TIPS"),
    "html:tip:paste": ("P2", "COMMON_PROCEDURE_AND_TIPS"),
    "html:tip:split": ("P2", "COMMON_PROCEDURE_AND_TIPS"),
}

# Claims seen in the repeated historical colour-chart template that no official entry supports.
# A VERIFIED unit containing one needs an evidence entry stating the same claim.
UNOFFICIAL_CLAIM_GUARDS = (
    ("UNOFFICIAL_SEQUENCE_INTERVAL", re.compile(r"당일|다음\s*날|익일|하루\s*(?:뒤|후)")),
    ("UNOFFICIAL_COLOR_OUTCOME", re.compile(r"브라운\s*단독\s*[:은는]?\s*.{0,12}(?:미색|아주\s*연한)")),
)


# Semantic guards. Each one is evidence-relative: a claim is blocked only while no selected approved entry
# states it for the same product, so a later approved source can verify it without a code change.
PACK_PRODUCT = "헤어팩"
PACK_VARIANTS = {
    "딥클린 헤어팩": re.compile(r"딥\s*클린"),
    "두피 케어 헤어팩": re.compile(r"두피\s*케어"),
    "손상케어 헤어팩": re.compile(r"손상\s*케어"),
    "볼륨업 헤어팩": re.compile(r"볼륨\s*업"),
}
KIND_FACT_TYPE = {
    "variant": "PRODUCT_DESCRIPTION", "ingredient": "INGREDIENT", "duration": "STANDARD_DURATION",
    "conditional_duration": "CONDITIONAL_DURATION_ADJUSTMENT", "sequence_duration": "SEQUENTIAL_APPLICATION",
    "ratio": "RATIO", "caution": "CAUTION", "condition": "CONDITION", "sequence": "SEQUENTIAL_APPLICATION",
    "procedure": "PROCEDURE_ORDER", "procedure_step": "PROCEDURE_STEP", "tip": "APPLICATION_TIP",
    "recommendation": "RECOMMENDATION", "amount": "USAGE_AMOUNT", "companion": "COMPANION_USAGE", "limitation": "LIMITATION",
}
# Fact types that state what a product is or contains, or which product suits a concern; they never state a usage method.
NON_USAGE_FACT_TYPES = ("PRODUCT_DESCRIPTION", "INGREDIENT", "RECOMMENDATION", "LIMITATION")
COLOR_RESULT_FACT_TYPES = ("RATIO", "SEQUENTIAL_APPLICATION", "CONDITION", "LIMITATION")
CLAIM_USAGE = "usage_method"
CLAIM_COLOR_RESULT = "color_result"
CLAIM_DYE_SEQUENCE = "dye_sequence"
_USAGE_RE = re.compile(r"바르|발라|도포|섞|혼합|배합|반죽|방치|헹구|헹궈|사용\s*(?:해|하시|하세요|하면|법|방법)")
_COLOR_RESULT_RE = re.compile(r"발색|색감|흑갈색|갈색|오렌지|붉은\s*(?:기|빛|색)|붉게|커버|색상|컬러")
_DYE_SEQUENCE_RE = re.compile(r"(레드|브라운).{0,25}?(?:후|다음|이어서|먼저|1차|2차|단계).{0,25}?(레드|브라운)")
# (concept, claim pattern, supporting pattern in the official excerpt)
EFFICACY_CONCEPTS = (
    ("CLEANSING", re.compile(r"딥\s*클린\s*(?:의\s*)?효과|클린해|세정\s*(?:효과|력)|개운"), re.compile(r"개운|세정")),
    ("EXFOLIATION", re.compile(r"각질|노폐물"), re.compile(r"각질|노폐물")),
    ("OIL_CONTROL", re.compile(r"피지|유분|기름|유수분"), re.compile(r"피지|유분|기름")),
    ("VOLUME", re.compile(r"볼륨(?!\s*업)|풍성"), re.compile(r"볼륨(?!\s*업)|풍성")),
    ("DAMAGE_CARE", re.compile(r"손상(?!\s*케어)|푸석|모발이?\s*건조|건조한\s*모발"), re.compile(r"손상(?!\s*케어)|푸석|건조하")),
    ("SHINE_SOFTNESS", re.compile(r"윤기|(?:모발|머릿결)이?\s*부드러|부드러운\s*(?:모발|머릿결)"), re.compile(r"윤기|부드러움|부드럽게\s*관리")),
    ("HAIR_QUALITY", re.compile(r"머릿결|모발\s*(?:개선|건강|영양)|건강한\s*(?:모발|머릿결)|영양"), re.compile(r"머릿결|영양")),
    ("SCALP_CARE", re.compile(r"두피\s*(?:진정|건강|컨디션)|가려움|비듬|열감"), re.compile(r"두피\s*컨디션|가렵|가려|비듬|열감")),
    ("DURABILITY", re.compile(r"지속력|지속성|유지력|오래\s*(?:유지|가|지속)"), re.compile(r"지속|오래")),
    ("SYNERGY", re.compile(r"시너지"), re.compile(r"시너지")),
    ("GENERAL_EFFICACY", re.compile(r"효과적|효과가?\s*(?:있|좋|뛰어)|효과를?\s*(?:보|느끼)"), re.compile(r"효과")),
)
_DYE_NAME = r"(레드|브라운)(?:\s*헤나)?"
_RATIO_NUM = r"(\d+(?:\.\d+)?)\s*%?"
_DYE_RATIO_PAIR_RE = re.compile(_DYE_NAME + r"\s*" + _RATIO_NUM + r"\s*(?:[:：+,]|대)?\s*" + _DYE_NAME + r"\s*" + _RATIO_NUM)
_DYE_RATIO_LIST_RE = re.compile(
    _DYE_NAME + r"\s*(?:와|과|랑|하고|,|/|\+|&)\s*" + _DYE_NAME + r"\s*(?:를|을|의)?\s*(?:비율\s*(?:을|를|로)?\s*)?"
    + r"(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)"
)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _entry(source: dict, key: str, kind: str, statement: str, products, extra: dict | None = None) -> dict:
    digest = f"{source['source_id']}|{source['version']}|{key}|{kind}|{statement}"
    if extra:
        digest += "|" + json.dumps(extra, ensure_ascii=False, sort_keys=True)
    return {
        "entry_key": key,
        "kind": kind,
        "statement": statement,
        "products": sorted(set(products)),
        "aspects": list(ENTRY_KIND_ASPECTS.get(kind, ())),
        **(extra or {}),
        "entry_sha256": _sha(digest),
    }


def _applicability_approvals(data: dict) -> dict[tuple[str, str], dict]:
    """Legacy JSON applicability reviews (LEGACY_OPERATOR_ATTESTATION). Never re-attributed to a login identity."""
    out: dict[tuple[str, str], dict] = {}
    for review in data.get("applicabilityReviews") or []:
        if review.get("approvalStatus") != "APPROVED":
            continue
        for item in review.get("scope") or []:
            k = (str(item.get("sourceId")), str(item.get("unitKey")))
            cur = out.setdefault(
                k,
                {
                    "origin": ORIGIN_LEGACY,
                    "review_id": str(review.get("reviewId") or ""),
                    "products": set(),
                    "confirmed_by": review.get("confirmedBy"),
                    "confirmed_at": review.get("confirmedAt"),
                    "basis_record": review.get("basisRecord"),
                },
            )
            cur["products"] |= set(item.get("products") or [])
    return out


def gate_b_product_state(products: list[str], content_sha: str, source_sha: str | None, legacy: dict | None, records: list[dict]) -> dict:
    """Effective Gate B state per product. records: this entry's DB records, oldest first.

    The latest DB record that names a product wins for that product. A record whose pinned source/entry hash
    differs from the current one yields RECHECK_REQUIRED (never auto-approval, legacy not reinstated).
    Without any DB record, a legacy attestation applies only to its own product scope.
    """
    out: dict[str, dict] = {}
    for p in products or [GB_ENTRY_LEVEL]:
        own = [r for r in records if p in (r.get("products") or [])]
        if own:
            last = own[-1]
            stale = last.get("entry_content_sha256") != content_sha or last.get("source_sha256") != source_sha
            out[p] = {
                "state": GB_RECHECK if stale else GB_DECISION_STATE[last["decision"]],
                "origin": ORIGIN_GATE_B,
                "record_id": last.get("applicability_id"),
                "decision": last.get("decision"),
                "reviewer_email": last.get("reviewer_email"),
                "reviewer_role": last.get("reviewer_role"),
                "created_at": last.get("created_at"),
                "pinned_hash_changed": stale,
            }
        elif legacy and p in legacy["products"]:
            out[p] = {"state": GB_APPROVED_LEGACY, "origin": ORIGIN_LEGACY, "review_id": legacy["review_id"]}
        else:
            out[p] = {"state": GB_PENDING, "origin": None}
    return out


def gate_b_entry_state(by_product: dict) -> str:
    states = [v["state"] for v in by_product.values()]
    if not states:
        return GB_PENDING
    if GB_RECHECK in states:
        return GB_RECHECK
    usable = [s for s in states if s in GB_USABLE]
    if usable and len(usable) == len(states):
        return GB_APPROVED_LEGACY if all(s == GB_APPROVED_LEGACY for s in states) else GB_APPROVED
    if usable:
        return GB_PARTIAL
    for s in (GB_HOLD, GB_REVOKED):
        if s in states:
            return s
    if all(s == GB_EXCLUDED for s in states):
        return GB_EXCLUDED
    return GB_PENDING


def _official_guide_v2_sources(applicability_records: list[dict] | None = None) -> list[dict]:
    path = _SOURCES_DIR / OFFICIAL_GUIDE_V2_FILE
    if not path.is_file():
        return []
    raw = path.read_bytes()
    data = json.loads(raw.decode("utf-8"))
    approvals = _applicability_approvals(data)
    by_entry: dict[tuple[str, str], list[dict]] = {}
    for r in applicability_records or []:
        by_entry.setdefault((str(r.get("source_id")), str(r.get("entry_key"))), []).append(r)
    out = []
    for src in data.get("sources") or []:
        authority = str(src.get("authorityClass") or "")
        confirmation = src.get("confirmation") or {}
        if authority == AUTHORITY_PROJECT_POLICY:
            status = SOURCE_STATUS_POLICY_ONLY
        elif authority == AUTHORITY_OPERATOR_CONFIRMED and confirmation.get("approvalStatus") != "APPROVED":
            status = SOURCE_STATUS_REGISTRATION_PENDING
        else:
            status = SOURCE_STATUS_ACTIVE
        source = {
            "source_id": str(src["sourceId"]),
            "version": str(src.get("sourceVersion") or ""),
            "authority_class": authority,
            "status": status,
            "origin": str(src.get("fileName") or confirmation.get("recordId") or src.get("sourceType") or ""),
            "location": f"api/review_reply_knowledge_sources/{OFFICIAL_GUIDE_V2_FILE}",
            "sha256": src.get("sourceHash") or confirmation.get("recordSha256"),
            "source_type": src.get("sourceType"),
            "registry_file_sha256": hashlib.sha256(raw).hexdigest(),
            "confirmation": confirmation or None,
        }
        entries = []
        for u in src.get("units") or []:
            key = str(u["unitKey"])
            products = list(u.get("products") or [])
            kind = str(u.get("kind") or "restriction")
            extra = {
                "fact_type": u.get("factType"),
                "original_text": u.get("originalText"),
                "source_location": u.get("sourceLocation"),
                "product_scope": u.get("productScope") or [],
                "application_modes": u.get("applicationModes"),
                "condition": u.get("condition"),
                "condition_required": bool(u.get("conditionRequired")),
                "condition_patterns": u.get("conditionPatterns") or [],
                "procedure": u.get("procedure"),
                "numeric_tokens": u.get("numericTokens"),
                "qualifiers": u.get("qualifiers") or [],
                "limitation": u.get("limitation") or [],
                "extraction_version": u.get("extractionVersion"),
                "source_fidelity_status": u.get("sourceFidelityStatus"),
            }
            # entry_sha256 pins content only; applicability is attached after hashing so (re-)approvals do not
            # change it. Withdrawn applicability is enforced in resolve_unit_fact instead.
            entry = _entry(source, key, kind, str(u.get("originalText") or ""), products, extra)
            legacy = approvals.get((source["source_id"], key))
            records = by_entry.get((source["source_id"], key), [])
            by_product = gate_b_product_state(entry["products"], entry["entry_sha256"], source.get("sha256"), legacy, records)
            usable = sorted(p for p, v in by_product.items() if v["state"] in GB_USABLE and p != GB_ENTRY_LEVEL)
            origins = {by_product[p]["origin"] for p in usable}
            entry["current_applicability"] = {
                "status": APPLICABILITY_VERIFIED if usable else APPLICABILITY_UNVERIFIED,
                "products": usable,
                "review_id": legacy["review_id"] if legacy and ORIGIN_LEGACY in origins else (ORIGIN_GATE_B if usable else None),
                "origin": (ORIGIN_MIXED if len(origins) > 1 else next(iter(origins))) if origins else None,
            }
            queue = GATE_B_REVIEW_QUEUE.get(key)
            entry["gate_b"] = {
                "contract_version": GATE_B_CONTRACT_VERSION,
                "entry_state": gate_b_entry_state(by_product),
                "by_product": by_product,
                "latest_record_id": records[-1].get("applicability_id") if records else None,
                "record_count": len(records),
                "legacy": (
                    {k: (sorted(v) if k == "products" else v) for k, v in legacy.items()} if legacy else None
                ),
                "priority": queue[0] if queue else None,
                "topic": queue[1] if queue else None,
                "reviewable": kind != "restriction",
            }
            entries.append(entry)
        source["entries"] = entries
        out.append(source)
    return out


def _product_info_source(rows: list[dict] | None) -> dict | None:
    if rows is None:
        return None
    source = {
        "source_id": PRODUCT_INFO_SOURCE_ID,
        "version": "db_live",
        "authority_class": AUTHORITY_CURRENT_PRODUCT_INFO,
        "status": SOURCE_STATUS_ACTIVE,
        "origin": "content_product_info (AI 콘텐츠 센터 SKU 성분 정보, read-only)",
        "location": "DB table content_product_info",
        "scope_note": "ingredient statements only",
    }
    entries = []
    for row in sorted(rows, key=lambda r: str(r.get("sku_id"))):
        try:
            items = json.loads(row.get("product_items_json") or "[]")
        except Exception:
            items = []
        for it in items if isinstance(items, list) else []:
            name = str(it.get("product_name") or "").strip()
            ingredients = str(it.get("full_ingredients") or "").strip()
            if not name or not ingredients:
                continue
            key = f"sku:{row.get('sku_id')}:{it.get('product_key') or 'product'}:ingredients"
            entries.append(_entry(source, key, "ingredient", f"{name} 전성분: {ingredients}", _products(name)))
    source["entries"] = entries
    source["sha256"] = _sha("|".join(e["entry_sha256"] for e in entries))
    return source


def _category_sources() -> list[dict]:
    out = []
    for source_id, rel in CATEGORY_PACKS:
        path = _ARTIFACT_DIR / rel
        if not path.is_file():
            continue
        raw = path.read_bytes()
        out.append(
            {
                "source_id": source_id,
                "version": "v1",
                "authority_class": AUTHORITY_CATEGORY_RESEARCH,
                "status": SOURCE_STATUS_CANDIDATE_ONLY,
                "location": f"api/content_blog_knowledge_artifacts/{rel}",
                "sha256": hashlib.sha256(raw).hexdigest(),
                "entries": [],
                "note": "Category research: supplementary candidate only, never verifies a product fact.",
            }
        )
    return out


def load_official_source_registry(
    product_info_rows: list[dict] | None = None,
    extra_sources: list[dict] | None = None,
    applicability_records: list[dict] | None = None,
) -> dict:
    sources = _official_guide_v2_sources(applicability_records)
    sources += [s for s in (_product_info_source(product_info_rows),) if s]
    sources += _category_sources()
    sources += list(extra_sources or [])
    return {
        "registry_version": SOURCE_REGISTRY_VERSION,
        "sources": {s["source_id"]: s for s in sources},
        "pending_registrations": [dict(x) for x in PENDING_REGISTRATIONS],
        "registration_contract": REGISTRATION_CONTRACT,
    }


def entry_can_verify(source: dict, entry: dict) -> bool:
    """Source verifying + not restriction + Gate A PASS (when recorded) + Gate B products (when recorded)."""
    if source["status"] != SOURCE_STATUS_ACTIVE or source["authority_class"] not in VERIFYING_AUTHORITIES:
        return False
    if entry["kind"] == "restriction" or not entry.get("products"):
        return False
    if entry.get("source_fidelity_status") not in (None, FIDELITY_PASS):
        return False
    appl = entry.get("current_applicability")
    return appl is None or bool(appl.get("products"))


def registry_view(registry: dict) -> dict:
    sources = []
    for s in registry["sources"].values():
        can_verify = s["status"] == SOURCE_STATUS_ACTIVE and s["authority_class"] in VERIFYING_AUTHORITIES
        entries = [e | {"can_verify": entry_can_verify(s, e)} for e in s.get("entries") or []]
        sources.append(
            {
                k: s.get(k)
                for k in ("source_id", "version", "authority_class", "status", "origin", "location", "sha256", "scope_note", "note",
                          "source_type", "confirmation")
            }
            | {
                "can_verify": can_verify,
                "entry_count": len(entries),
                "verifiable_entry_count": sum(1 for e in entries if e["can_verify"]),
                "fidelity_pass_count": sum(1 for e in entries if e.get("source_fidelity_status") == FIDELITY_PASS),
                "applicability_verified_count": sum(
                    1 for e in entries if (e.get("current_applicability") or {}).get("status") == APPLICABILITY_VERIFIED
                ),
                "entries": entries,
            }
        )
    return {
        "registry_version": registry["registry_version"],
        "sources": sources,
        "pending_registrations": registry["pending_registrations"],
        "registration_contract": registry["registration_contract"],
        "verifying_entry_count": sum(
            1 for x in sources if x["can_verify"] for e in x["entries"] if e["kind"] != "restriction"
        ),
        "restriction_entry_count": sum(1 for x in sources for e in x["entries"] if e["kind"] == "restriction"),
        "verifiable_entry_count": sum(x["verifiable_entry_count"] for x in sources),
    }


def _find_entry(registry: dict, source_id: str, entry_key: str) -> tuple[dict | None, dict | None]:
    source = registry["sources"].get(source_id)
    if not source:
        return None, None
    return source, next((e for e in source.get("entries") or [] if e["entry_key"] == entry_key), None)


# ---------------------------------------------------------------- unit identity

def unit_text_sha256(unit: dict) -> str:
    return _sha(str(unit.get("originalText") or unit.get("sentence") or ""))


def unit_key(knowledge_id: str, reply_sha: str, unit: dict) -> str:
    span = unit.get("sourceTextSpan") or [None, None]
    raw = "|".join(
        str(x)
        for x in (knowledge_id, reply_sha, unit.get("extractionVersion") or EXTRACTION_VERSION, span[0], span[1], unit_text_sha256(unit))
    )
    return "ruf:" + _sha(raw)[:32]


def is_fact_candidate(unit: dict) -> bool:
    return bool(unit.get("isKnowledgeCandidate", True)) and unit.get("knowledgeType") != TYPE_QUESTION


def unit_products(unit: dict) -> list[str]:
    value = unit.get("product")
    if isinstance(value, list):
        return [p for p in value if p and p != UNKNOWN]
    return [value] if value and value != UNKNOWN else []


def text_application_mode(text: str, products) -> str | None:
    """single / sequential / mixed / unspecified for red-brown dye guidance; None when no dye product is named."""
    dyes = {p for p in products if p in DYE_PRODUCTS}
    if not dyes:
        return None
    if _MODE_SEQ_RE.search(text or ""):
        return MODE_SEQUENTIAL
    if _MODE_MIX_RE.search(text or "") or any(u == "RATIO" for _, u in numeric_tokens(text or "")):
        return MODE_MIXED
    return MODE_SINGLE if len(dyes) == 1 else MODE_UNSPECIFIED


def application_mode(unit: dict) -> str | None:
    products = unit_products(unit)
    if unit.get("sequence") and any(p in DYE_PRODUCTS for p in products):
        return MODE_SEQUENTIAL
    return text_application_mode(str(unit.get("originalText") or unit.get("sentence") or ""), products)


def applicable_aspects(unit: dict) -> list[str]:
    out = [ASPECT_STATEMENT, ASPECT_PRODUCT]
    if unit.get("condition") not in (None, "", UNKNOWN):
        out.append(ASPECT_CONDITION)
    if unit.get("sequence"):
        out.append(ASPECT_SEQUENCE)
    if unit.get("numericRange"):
        out.append(ASPECT_NUMERIC)
    return out


def unit_snapshot(unit: dict) -> dict:
    return {
        k: unit.get(k)
        for k in (
            "originalText", "sourceTextSpan", "knowledgeType", "product", "condition", "conditionReference",
            "contextBefore", "sequence", "numericRange", "limitation", "extractionVersion",
        )
    }


# ---------------------------------------------------------------- numeric helpers

_UNIT_TOKEN_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(시간|분)")
_BARE_NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def _norm_num(value: str) -> str:
    return str(float(value)).rstrip("0").rstrip(".")


def _norm_ratio(a: str, b: str) -> str:
    fa, fb = float(a), float(b)
    if fa.is_integer() and fb.is_integer() and fa > 0 and fb > 0:
        g = math.gcd(int(fa), int(fb))
        return f"{int(fa) // g}:{int(fb) // g}"
    return f"{_norm_num(a)}:{_norm_num(b)}"


def _token_set(values) -> set[tuple[str, str]]:
    return {tuple(str(v).split("|", 1)) for v in values}  # type: ignore[misc]


def numeric_tokens(text: str) -> set[tuple[str, str]]:
    """Durations as (number, unit); a bare number inside a range takes the range's unit; ratios reduced (5:5 -> 1:1, RATIO)."""
    out: set[tuple[str, str]] = set()
    for m in _DURATION_RE.finditer(text or ""):
        raw = m.group(0)
        units = re.findall(r"시간|분", raw)
        last = units[-1] if units else UNKNOWN
        for n in _BARE_NUM_RE.finditer(raw):
            follow = raw[n.end():].lstrip()
            unit = "분" if follow.startswith("분") else ("시간" if follow.startswith("시간") else last)
            out.add((_norm_num(n.group(0)), unit))
    for m in _RATIO_RE.finditer(text or ""):
        nums = _BARE_NUM_RE.findall(m.group(0))
        if len(nums) >= 2:
            out.add((_norm_ratio(nums[0], nums[1]), "RATIO"))
    return out


def _unit_numeric_tokens(unit: dict) -> set[tuple[str, str]]:
    return numeric_tokens(" ".join(r.get("text") or "" for r in unit.get("numericRange") or []))


def dye_ratio_tokens(text: str) -> tuple[set[tuple[str, str]], str]:
    """Red:brown ratios read from product-number pairs, plus the text with those pairs blanked.

    "브라운 8 : 레드 2" and "브라운과 레드 8:2" are both red 2 : brown 8 (1:4); "레드 8 : 브라운 2" is 4:1.
    """
    out: set[tuple[str, str]] = set()

    def take(m: re.Match, layout: str) -> str:
        if layout == "pair":
            p1, n1, p2, n2 = m.groups()
        else:
            p1, p2, n1, n2 = m.groups()
        if p1 == p2:
            return m.group(0)
        red, brown = (n1, n2) if p1 == "레드" else (n2, n1)
        out.add((_norm_ratio(red, brown), "RATIO"))
        return " " * len(m.group(0))

    rest = text or ""
    for rx, layout in ((_DYE_RATIO_PAIR_RE, "pair"), (_DYE_RATIO_LIST_RE, "list")):
        rest = rx.sub(lambda m, layout=layout: take(m, layout), rest)
    return out, rest


def claim_ratio_tokens(text: str) -> set[tuple[str, str]]:
    directed, rest = dye_ratio_tokens(text)
    return directed | {t for t in numeric_tokens(rest) if t[1] == "RATIO"}


def _unit_context_text(unit: dict) -> str:
    parts = (unit.get("originalText") or unit.get("sentence"), unit.get("contextBefore"), unit.get("conditionReference"))
    return " ".join(str(p) for p in parts if p not in (None, "", UNKNOWN))


def claim_pack_variants(unit: dict) -> set[str]:
    """Hair-pack variants the unit (or its recorded source context) names; empty when the target pack is unresolved."""
    text = _unit_context_text(unit)
    return {v for v, rx in PACK_VARIANTS.items() if rx.search(text)}


def claim_kinds(unit: dict) -> dict[str, list[str]]:
    text = str(unit.get("originalText") or unit.get("sentence") or "")
    out: dict[str, list[str]] = {}
    usage = sorted({m.group(0) for m in _USAGE_RE.finditer(text)})
    if usage:
        out[CLAIM_USAGE] = usage
    colors = sorted({m.group(0) for m in _COLOR_RESULT_RE.finditer(text)})
    if colors:
        out[CLAIM_COLOR_RESULT] = colors
    seq_products = {s.get("product") for s in unit.get("sequence") or [] if s.get("product") in DYE_PRODUCTS}
    if len(seq_products) > 1 or any(m.group(1) != m.group(2) for m in _DYE_SEQUENCE_RE.finditer(text)):
        out[CLAIM_DYE_SEQUENCE] = sorted(seq_products) or ["text"]
    return out


def efficacy_concepts(text: str) -> list[str]:
    return [name for name, claim_rx, _ in EFFICACY_CONCEPTS if claim_rx.search(text or "")]


def _supports_claim(e: dict, claim: str, terms: list[str]) -> bool:
    fact_type = e["_fact_type"]
    if claim == CLAIM_USAGE:
        return fact_type not in NON_USAGE_FACT_TYPES
    if claim == CLAIM_COLOR_RESULT:
        return fact_type in COLOR_RESULT_FACT_TYPES or all(t in (e["excerpt"] or "") for t in terms)
    if claim == CLAIM_DYE_SEQUENCE:
        return fact_type == "SEQUENTIAL_APPLICATION" or MODE_SEQUENTIAL in (e.get("application_modes") or [])
    return False


# ---------------------------------------------------------------- submission rules

class UnitFactValidationError(ValueError):
    def __init__(self, code: str, status: int = 400, detail: object = None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = detail


EVIDENCE_META_FIELDS = (
    "fact_type", "application_modes", "condition", "condition_required", "condition_patterns", "procedure",
    "numeric_tokens", "qualifiers", "source_fidelity_status", "current_applicability",
)


def _verified_products(e: dict) -> list[str]:
    appl = e.get("current_applicability")
    return list(e["products"]) if appl is None else list(appl.get("products") or [])


def _entry_numeric_tokens(e: dict) -> set[tuple[str, str]]:
    explicit = e.get("numeric_tokens")
    return _token_set(explicit) if explicit is not None else numeric_tokens(e["excerpt"])


def _check_evidence(unit: dict, evidence_in: list, registry: dict, *, require_cover: list[str]) -> list[dict]:
    if not isinstance(evidence_in, list):
        raise UnitFactValidationError("invalid_evidence")
    products = set(unit_products(unit))
    resolved: list[dict] = []
    for raw in evidence_in:
        if not isinstance(raw, dict):
            raise UnitFactValidationError("invalid_evidence")
        if set(raw) - {"source_id", "entry_key", "covers"}:
            raise UnitFactValidationError("free_text_evidence_not_accepted")
        source, entry = _find_entry(registry, str(raw.get("source_id") or ""), str(raw.get("entry_key") or ""))
        if source is None:
            raise UnitFactValidationError("evidence_source_not_registered", 409)
        if entry is None:
            raise UnitFactValidationError("evidence_entry_not_found", 409)
        covers = [str(c) for c in (raw.get("covers") or [])]
        if not covers or any(c not in ASPECTS for c in covers):
            raise UnitFactValidationError("invalid_evidence_covers")
        resolved.append(
            {
                "source_id": source["source_id"],
                "source_version": source["version"],
                "source_sha256": source.get("sha256"),
                "authority_class": source["authority_class"],
                "source_status": source["status"],
                "entry_key": entry["entry_key"],
                "entry_kind": entry["kind"],
                "entry_sha256": entry["entry_sha256"],
                "excerpt": entry["statement"],
                "products": entry["products"],
                "covers": covers,
                **{k: entry.get(k) for k in EVIDENCE_META_FIELDS if k in entry},
                "_aspects": entry["aspects"],
                "_product_scope": list(entry.get("product_scope") or []),
                "_fact_type": entry.get("fact_type") or KIND_FACT_TYPE.get(entry["kind"]),
            }
        )
    if not require_cover:
        return [{k: v for k, v in e.items() if not k.startswith("_")} for e in resolved]

    # VERIFIED: every applicable aspect evidenced by a verifying, product-matching entry of a compatible kind.
    if not resolved:
        raise UnitFactValidationError(HOLD_SOURCE_MISSING, 409)
    if not products:
        raise UnitFactValidationError(HOLD_PRODUCT_SCOPE_UNKNOWN, 409)
    covered: set[str] = set()
    product_union: set[str] = set()
    for e in resolved:
        if e["source_status"] != SOURCE_STATUS_ACTIVE or e["authority_class"] not in VERIFYING_AUTHORITIES:
            raise UnitFactValidationError("evidence_source_cannot_verify", 409, e["source_id"])
        if e["entry_kind"] == "restriction":
            raise UnitFactValidationError("restriction_entry_cannot_verify", 409, e["entry_key"])
        if not (set(e["products"]) & products):
            raise UnitFactValidationError("evidence_product_mismatch", 409, e["entry_key"])
        bad = [c for c in e["covers"] if c not in e["_aspects"]]
        if bad:
            raise UnitFactValidationError("evidence_kind_cannot_cover_aspect", 409, {"entry": e["entry_key"], "aspects": bad})
        if e.get("source_fidelity_status") not in (None, FIDELITY_PASS):
            raise UnitFactValidationError("SOURCE_FIDELITY_NOT_PASSED", 409, e["entry_key"])
        covered |= set(e["covers"])
        product_union |= set(_verified_products(e))
    missing = [a for a in require_cover if a not in covered]
    if missing:
        code = HOLD_SOURCE_MISSING if ASPECT_SEQUENCE in missing or ASPECT_CONDITION in missing else "aspect_not_covered_by_evidence"
        raise UnitFactValidationError(code, 409, {"missing_aspects": missing})
    for e in resolved:
        unapproved = sorted((set(e["products"]) & products) - set(_verified_products(e)))
        if unapproved:
            raise UnitFactValidationError(APPLICABILITY_UNVERIFIED, 409, {"entry": e["entry_key"], "products": unapproved})
    if not products <= product_union:
        raise UnitFactValidationError("evidence_product_scope_not_covered", 409, sorted(products - product_union))
    if PACK_PRODUCT in products:
        variants: set[str] | None = None
        for e in resolved:
            scope = set(e["_product_scope"]) & set(PACK_VARIANTS)
            if PACK_PRODUCT not in e["products"] or not scope or scope == set(PACK_VARIANTS):
                continue
            variants = claim_pack_variants(unit) if variants is None else variants
            detail = {"entry": e["entry_key"], "entry_scope": sorted(scope), "claim_variants": sorted(variants)}
            if not variants:
                raise UnitFactValidationError("PRODUCT_VARIANT_UNRESOLVED", 409, detail)
            if variants - scope:
                raise UnitFactValidationError("PRODUCT_VARIANT_MISMATCH", 409, detail)
    claim_text = str(unit.get("originalText") or unit.get("sentence") or "")
    directed_ratios, _ = dye_ratio_tokens(claim_text)
    ratios = sorted(n for n, _ in claim_ratio_tokens(claim_text))
    if len(ratios) > 1 or (ratios and application_mode(unit) == MODE_SEQUENTIAL):
        raise UnitFactValidationError("MULTI_METHOD_UNIT_REQUIRES_SPLIT", 409, ratios)
    for code, rx in UNOFFICIAL_CLAIM_GUARDS:
        if rx.search(claim_text) and not any(rx.search(e["excerpt"] or "") for e in resolved):
            raise UnitFactValidationError(code, 409)
    if ASPECT_NUMERIC in require_cover:
        numeric_ev = [e for e in resolved if ASPECT_NUMERIC in e["covers"]]
        official = set().union(*(_entry_numeric_tokens(e) for e in numeric_ev)) if numeric_ev else set()
        unit_tokens = _unit_numeric_tokens(unit)
        if directed_ratios:
            unit_tokens = {t for t in unit_tokens if t[1] != "RATIO"} | claim_ratio_tokens(claim_text)
        exceeding = sorted(f"{n}{u}" for n, u in unit_tokens - official)
        if exceeding:
            raise UnitFactValidationError("numeric_exceeds_official_scope", 409, exceeding)
        numeric_products = set().union(*(set(_verified_products(e)) for e in numeric_ev))
        step_products = {s.get("product") for s in unit.get("sequence") or [] if s.get("numeric") not in (None, UNKNOWN)}
        if not (products | step_products) - {None} <= numeric_products:
            raise UnitFactValidationError("numeric_evidence_product_mismatch", 409)
    unit_text = f"{unit.get('originalText') or unit.get('sentence') or ''} {unit.get('condition') or ''}"
    mode = application_mode(unit)
    for e in resolved:
        if e.get("condition_required") and not any(re.search(p, unit_text) for p in e.get("condition_patterns") or []):
            raise UnitFactValidationError("OFFICIAL_CONDITION_NOT_PRESENT_IN_UNIT", 409, {"entry": e["entry_key"], "condition": e.get("condition")})
        if not ({ASPECT_NUMERIC, ASPECT_SEQUENCE} & set(e["covers"])):
            continue
        modes = e.get("application_modes")
        if mode == MODE_UNSPECIFIED and (modes or ASPECT_NUMERIC in e["covers"]):
            raise UnitFactValidationError("APPLICATION_MODE_UNSPECIFIED", 409, {"entry": e["entry_key"]})
        if (modes and mode not in modes) or (not modes and mode == MODE_SEQUENTIAL and ASPECT_NUMERIC in e["covers"]):
            raise UnitFactValidationError("APPLICATION_MODE_MISMATCH", 409, {"entry": e["entry_key"], "unit_mode": mode, "entry_modes": modes})
        order = [s["product"] for s in e.get("procedure") or [] if s.get("product")]
        unit_order = [s.get("product") for s in unit.get("sequence") or [] if s.get("product")]
        if ASPECT_SEQUENCE in e["covers"] and order and unit_order and unit_order != order:
            raise UnitFactValidationError("SEQUENCE_ORDER_MISMATCH", 409, {"entry": e["entry_key"], "unit_order": unit_order, "entry_order": order})
    if unit.get("knowledgeType") == TYPE_CAUTION and not any(e["entry_kind"] == "caution" for e in resolved):
        raise UnitFactValidationError("caution_requires_caution_entry", 409)
    for claim, terms in claim_kinds(unit).items():
        if not any(_supports_claim(e, claim, terms) for e in resolved):
            raise UnitFactValidationError(
                "EVIDENCE_FACT_TYPE_CANNOT_SUPPORT_CLAIM", 409,
                {"claim": claim, "terms": terms, "evidence_fact_types": sorted({str(e["_fact_type"]) for e in resolved})},
            )
    unsupported = [
        name for name, claim_rx, support_rx in EFFICACY_CONCEPTS
        if claim_rx.search(claim_text) and not any(support_rx.search(e["excerpt"] or "") for e in resolved)
    ]
    if unsupported:
        raise UnitFactValidationError("UNSUPPORTED_EFFICACY_CLAIM", 409, unsupported)
    return [{k: v for k, v in e.items() if not k.startswith("_")} for e in resolved]


def validate_unit_fact_submission(unit: dict, payload: dict, registry: dict) -> dict:
    """Normalise a submission or raise UnitFactValidationError. Never stores anything."""
    if not is_fact_candidate(unit):
        raise UnitFactValidationError("unit_not_fact_candidate", 409)
    status = str(payload.get("fact_status") or "").strip().upper()
    if status not in FACT_STORED_STATES:
        raise UnitFactValidationError("invalid_fact_status")
    note = str(payload.get("note") or "").strip()
    if len(note) < NOTE_MIN_CHARS:
        raise UnitFactValidationError("validation_note_required")
    aspects = applicable_aspects(unit)
    answers: dict[str, str | None] = {}
    for field, aspect in ANSWER_FIELDS.items():
        value = str(payload.get(field) or "").strip().lower() or None
        if value is not None and value not in ANSWER_VALUES:
            raise UnitFactValidationError(f"invalid_{field}")
        if aspect not in aspects and value not in (None, "na"):
            raise UnitFactValidationError("answer_for_non_applicable_aspect", 400, field)
        if aspect in aspects and value == "na":
            raise UnitFactValidationError("na_not_allowed_for_applicable_aspect", 400, field)
        answers[field] = value if aspect in aspects else "na"
    gen = str(payload.get(GENERATOR_REFERENCE_FIELD) or "").strip().lower() or None
    if gen is not None and gen not in ("yes", "no", "unsure"):
        raise UnitFactValidationError(f"invalid_{GENERATOR_REFERENCE_FIELD}")
    answers[GENERATOR_REFERENCE_FIELD] = gen
    verified_scope = str(payload.get("verified_scope") or "").strip() or None
    hold_reason = str(payload.get("hold_reason") or "").strip().upper() or None
    evidence_in = payload.get("evidence") or []

    if status == FACT_VERIFIED:
        if any(answers[f] != "yes" for f, a in ANSWER_FIELDS.items() if a in aspects) or answers[GENERATOR_REFERENCE_FIELD] is None:
            raise UnitFactValidationError("verified_requires_all_applicable_yes")
        if not verified_scope or len(verified_scope) < NOTE_MIN_CHARS:
            raise UnitFactValidationError("verified_scope_required")
        if hold_reason:
            raise UnitFactValidationError("hold_reason_not_allowed_for_verified")
        evidence = _check_evidence(unit, evidence_in, registry, require_cover=aspects)
    else:
        evidence = _check_evidence(unit, evidence_in, registry, require_cover=[])
        if status == FACT_HOLD:
            hold_reason = hold_reason or (HOLD_SOURCE_MISSING if not evidence else None)
            if hold_reason not in HOLD_REASONS:
                raise UnitFactValidationError("invalid_hold_reason")
        elif hold_reason:
            raise UnitFactValidationError("hold_reason_only_for_hold")
    return {
        "fact_status": status,
        "answers": answers,
        "evidence": evidence,
        "verified_scope": verified_scope,
        "hold_reason": hold_reason,
        "note": note,
        "applicable_aspects": aspects,
        "source_registry_version": registry["registry_version"],
    }


# ---------------------------------------------------------------- Gate B submission / queue

def product_skus_from_rows(rows: list[dict] | None) -> dict[str, list[str]]:
    """Canonical product -> SKU ids in content_product_info (read-only). Presence here is never an approval."""
    out: dict[str, set[str]] = {}
    for row in rows or []:
        try:
            items = json.loads(row.get("product_items_json") or "[]")
        except Exception:
            items = []
        for it in items if isinstance(items, list) else []:
            for p in _products(str(it.get("product_name") or "")):
                out.setdefault(p, set()).add(str(row.get("sku_id")))
    return {p: sorted(v) for p, v in sorted(out.items())}


def _gate_b_entry(registry: dict, source_id: str, entry_key: str) -> tuple[dict, dict]:
    source, entry = _find_entry(registry, source_id, entry_key)
    if source is None or entry is None:
        raise UnitFactValidationError("gate_b_entry_not_found", 404)
    if "gate_b" not in entry:
        raise UnitFactValidationError("gate_b_not_applicable_to_source", 409, source_id)
    if entry["kind"] == "restriction":
        raise UnitFactValidationError("restriction_entry_not_gate_b_reviewable", 409, entry_key)
    return source, entry


def _norm_list(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise UnitFactValidationError("invalid_list_field")
    return sorted({str(v).strip() for v in value if str(v).strip()})


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def gate_b_request_sha256(payload: dict) -> str:
    return _sha(_canonical(payload))


def _gate_b_location_text(location) -> str:
    if not isinstance(location, dict):
        return GATE_B_NOT_IN_SOURCE
    offsets = [str(q["offset"]) for q in location.get("quotes") or [] if isinstance(q, dict) and q.get("offset") is not None]
    parts = [str(location.get("section") or "").strip() or "구간 미기재"]
    if offsets:
        parts.append("offset " + ",".join(offsets))
    return " ".join(parts)


def _gate_b_procedure_text(procedure) -> str | None:
    steps = [s for s in procedure or [] if isinstance(s, dict)]
    if not steps:
        return None
    return " → ".join(f"{s.get('order')}. {(str(s.get('product') or '') + ' ' + str(s.get('action') or '')).strip()}" for s in steps)


def gate_b_audit_template(source: dict, entry: dict) -> dict:
    """Product-independent pieces of the server-authored Gate B record, built only from the registry entry.

    The UI preview joins these with the selected products exactly as gate_b_audit_record does.
    Nothing is invented: a missing condition / number / order / limitation reads GATE_B_NOT_IN_SOURCE.
    """
    sha = str(source.get("sha256") or "")
    modes = [GATE_B_MODE_LABELS.get(m, m) for m in entry.get("application_modes") or []]
    tokens = sorted(entry.get("numeric_tokens") or [])
    original = entry.get("original_text") or entry["statement"]
    limitations = [str(x).strip() for x in entry.get("limitation") or [] if str(x).strip()]
    gate_a_reference = " · ".join((
        f"Gate A {entry.get('source_fidelity_status') or '미확인'}",
        str(source["source_id"]),
        f"버전 {source['version']}",
        f"sha256 {sha[:16] or '미기재'}",
        str(entry["entry_key"]),
        _gate_b_location_text(entry.get("source_location")),
    ))
    scope_text = " · ".join((
        f"사용 방식: {', '.join(modes) or GATE_B_NOT_IN_SOURCE}",
        f"조건: {entry.get('condition') or GATE_B_NOT_IN_SOURCE}",
        f"수치: {', '.join(tokens) or GATE_B_NOT_IN_SOURCE}",
        f"순서: {_gate_b_procedure_text(entry.get('procedure')) or GATE_B_NOT_IN_SOURCE}",
        f"원문: {original}",
    ))
    return {
        "basis_type": GATE_B_BASIS_ADMIN_CONFIRMATION,
        "basis_type_label": GATE_B_BASIS_TYPES[GATE_B_BASIS_ADMIN_CONFIRMATION],
        "gate_a_reference": gate_a_reference,
        "scope_text": scope_text,
        "source_limitation_text": " / ".join(limitations) or GATE_B_NOT_IN_SOURCE,
        "current_guidance_note": SOURCE_CURRENT_GUIDANCE_NOTES.get(str(source["source_id"])),
    }


def _gate_b_product_label(products: list[str]) -> str:
    return ", ".join("항목 단위" if p == GB_ENTRY_LEVEL else p for p in products)


def gate_b_audit_record(template: dict, *, decision: str, products: list[str], confirmation: str | None,
                        admin_exceptions: str | None) -> dict:
    """Server-authored basis / scope / limitation text for one decision. Mirrored by the UI preview."""
    summary = (
        f"Gate B 관리자 직접 확인 · 결정: {GATE_B_DECISION_LABELS[decision]} · 선택 제품: {_gate_b_product_label(products)}"
        f" · 확인: {GATE_B_CONFIRMATIONS.get(confirmation or '', '해당 없음(승인 철회)')}"
    )
    if template.get("current_guidance_note"):
        summary += f" · 참고(항목 승인 근거 아님): {template['current_guidance_note']}"
    approved = decision == GATE_B_APPROVED
    return {
        "basis_type": template["basis_type"],
        "basis_reference": template["gate_a_reference"],
        "basis_summary": summary,
        "approved_fact_scope": f"제품: {_gate_b_product_label(products)} · {template['scope_text']}" if approved else None,
        "limitations_exceptions": (
            f"공식 원문 기재 제한: {template['source_limitation_text']} / 관리자 추가 확인 예외: {admin_exceptions or '입력 없음'}"
            if approved else None
        ),
    }


def validate_gate_b_submission(registry: dict, payload: dict, *, product_skus: dict[str, list[str]]) -> dict:
    """Normalise one Gate B decision (entry x products x condition) or raise. Never stores anything.

    Scope (modes / condition / numbers / order / original text) is copied from the registry entry on the
    server; a client value that differs is a scope expansion attempt and is rejected.
    """
    if not isinstance(payload, dict):
        raise UnitFactValidationError("invalid_payload")
    if any(k in payload for k in GATE_B_IDENTITY_FIELDS):
        raise UnitFactValidationError("reviewer_fields_not_accepted")
    request_id = str(payload.get("request_id") or "").strip()
    if not GATE_B_REQUEST_ID_RE.match(request_id):
        raise UnitFactValidationError("request_id_required")
    source, entry = _gate_b_entry(registry, str(payload.get("source_id") or ""), str(payload.get("entry_key") or ""))
    gate_b = entry["gate_b"]
    expected = str(payload.get("expected_latest_record_id") or "").strip() or None
    if expected != gate_b.get("latest_record_id"):
        raise UnitFactValidationError("GATE_B_STALE_VIEW", 409, {"latest_record_id": gate_b.get("latest_record_id")})
    decision = str(payload.get("decision") or "").strip().upper()
    if decision not in GATE_B_DECISIONS:
        raise UnitFactValidationError("invalid_gate_b_decision")
    gate_a = entry.get("source_fidelity_status")
    if decision == GATE_B_APPROVED and gate_a != FIDELITY_PASS:
        raise UnitFactValidationError("SOURCE_FIDELITY_NOT_PASSED", 409, entry["entry_key"])

    products = _norm_list(payload.get("products"))
    if not entry["products"]:
        if decision in (GATE_B_APPROVED, GATE_B_REVOKED):
            raise UnitFactValidationError("GATE_B_PRODUCT_SCOPE_REQUIRED", 409)
        if products:
            raise UnitFactValidationError("GATE_B_SCOPE_EXPANSION", 409, {"products": products})
        products = [GB_ENTRY_LEVEL]
    else:
        if not products:
            raise UnitFactValidationError("gate_b_products_required")
        outside = sorted(set(products) - set(entry["products"]))
        if outside:
            raise UnitFactValidationError("GATE_B_SCOPE_EXPANSION", 409, {"products": outside})
    skus = _norm_list(payload.get("skus"))
    allowed_skus = {s for p in products for s in product_skus.get(p, [])}
    if set(skus) - allowed_skus:
        raise UnitFactValidationError("GATE_B_SKU_NOT_IN_SCOPE", 409, sorted(set(skus) - allowed_skus))

    scope = {
        "application_modes": sorted(entry.get("application_modes") or []),
        "condition": entry.get("condition"),
        "numeric_tokens": sorted(entry.get("numeric_tokens") or []),
        "procedure": entry.get("procedure"),
    }
    for field, server_value in scope.items():
        if field not in payload:
            continue
        client_value = payload[field]
        if field in ("application_modes", "numeric_tokens"):
            client_value = _norm_list(client_value)
        if _canonical(client_value) != _canonical(server_value):
            raise UnitFactValidationError("GATE_B_SCOPE_EXPANSION", 409, {field: server_value})

    forged = sorted(f for f in GATE_B_SERVER_AUTHORED_FIELDS if f in payload)
    if forged:
        raise UnitFactValidationError("GATE_B_SERVER_AUTHORED_FIELD", 400, forged)
    confirmation = str(payload.get("current_applicability_confirmation") or "").strip().upper() or None
    if confirmation is not None and confirmation not in GATE_B_CONFIRMATIONS:
        raise UnitFactValidationError("invalid_current_applicability_confirmation")
    if confirmation not in GATE_B_DECISION_CONFIRMATIONS[decision]:
        code = "gate_b_approval_requires_admin_confirmation" if decision == GATE_B_APPROVED else "gate_b_confirmation_decision_mismatch"
        raise UnitFactValidationError(code, 400, {"decision": decision, "allowed": [c for c in GATE_B_DECISION_CONFIRMATIONS[decision] if c]})
    admin_exceptions = str(payload.get("admin_confirmed_exceptions") or "").strip() or None
    if admin_exceptions and decision != GATE_B_APPROVED:
        raise UnitFactValidationError("admin_exceptions_only_for_approval")
    if admin_exceptions and len(admin_exceptions) > GATE_B_ADMIN_EXCEPTIONS_MAX:
        raise UnitFactValidationError("admin_exceptions_too_long")
    note = str(payload.get("note") or "").strip()
    if decision != GATE_B_APPROVED and len(note) < NOTE_MIN_CHARS:
        raise UnitFactValidationError("validation_note_required")
    reason = str(payload.get("reverification_reason") or "").strip()
    reverified: list[str] = []
    if decision == GATE_B_APPROVED:
        # A product already APPROVED by a logged-in admin on the same entry/source hash would get an identical
        # server-authored record; re-approving it is a re-verification and must say why.
        reverified = [p for p in products if gate_b["by_product"].get(p, {}).get("state") == GB_APPROVED]
        if reverified and len(reason) < GATE_B_REVERIFICATION_MIN:
            raise UnitFactValidationError("GATE_B_DUPLICATE_APPROVAL", 409, {"products": [
                {"product": p, "approved_at": gate_b["by_product"][p].get("created_at"), "record_id": gate_b["by_product"][p].get("record_id")}
                for p in reverified]})
        if reason and not reverified:
            raise UnitFactValidationError("reverification_reason_without_approved_product")
    elif reason:
        raise UnitFactValidationError("reverification_reason_only_for_approval")
    if reverified:
        note = f"[재검증: {_gate_b_product_label(reverified)}] 사유: {reason}" + (f" / 판단 메모: {note}" if note else "")
    answer = GATE_B_CONFIRMATION_ANSWER.get(confirmation or "")
    answers: dict[str, str | None] = {field: answer for field in GATE_B_QUESTIONS}

    if decision == GATE_B_REVOKED:
        not_usable = sorted(p for p in products if gate_b["by_product"].get(p, {}).get("state") not in GB_USABLE)
        if not_usable:
            raise UnitFactValidationError("GATE_B_NOTHING_TO_REVOKE", 409, not_usable)
    audit = gate_b_audit_record(gate_b_audit_template(source, entry), decision=decision, products=products,
                                confirmation=confirmation, admin_exceptions=admin_exceptions)

    return {
        "request_id": request_id,
        "request_payload_sha256": gate_b_request_sha256(payload),
        "supersedes_record_id": gate_b.get("latest_record_id") or GATE_B_ROOT,
        "source_id": source["source_id"],
        "source_version": source["version"],
        "source_sha256": source.get("sha256"),
        "registry_version": registry["registry_version"],
        "registry_file_sha256": source.get("registry_file_sha256"),
        "entry_key": entry["entry_key"],
        "entry_kind": entry["kind"],
        "entry_content_sha256": entry["entry_sha256"],
        "original_text": entry.get("original_text") or entry["statement"],
        "source_location": entry.get("source_location"),
        "gate_a_status": gate_a,
        "decision": decision,
        "products": products,
        "skus": skus,
        "application_modes": scope["application_modes"],
        "condition": scope["condition"],
        "numeric_tokens": scope["numeric_tokens"],
        "procedure": scope["procedure"],
        "approved_fact_scope": audit["approved_fact_scope"],
        "limitations_exceptions": audit["limitations_exceptions"],
        "answers": answers,
        "basis_type": audit["basis_type"],
        "basis_reference": audit["basis_reference"],
        "basis_summary": audit["basis_summary"],
        "note": note,
        "reverified_products": reverified,
    }


def gate_b_queue_view(registry: dict, records: list[dict], product_skus: dict[str, list[str]]) -> dict:
    """Gate B review queue over Gate-B-managed entries (P1 first; P2/P3 and approved entries stay listed)."""
    by_entry: dict[tuple[str, str], list[dict]] = {}
    for r in records:
        by_entry.setdefault((str(r.get("source_id")), str(r.get("entry_key"))), []).append(r)
    rank = {"P1": 0, "P2": 1, "P3": 2}
    items = []
    for s in registry["sources"].values():
        for e in s.get("entries") or []:
            gb = e.get("gate_b")
            if not gb or not gb.get("reviewable"):
                continue
            items.append(
                {
                    "source_id": s["source_id"],
                    "source_version": s["version"],
                    "source_sha256": s.get("sha256"),
                    "authority_class": s["authority_class"],
                    "source_status": s["status"],
                    "entry_key": e["entry_key"],
                    "kind": e["kind"],
                    "original_text": e.get("original_text") or e["statement"],
                    "source_location": e.get("source_location"),
                    "products": e["products"],
                    "product_scope": e.get("product_scope") or [],
                    "product_skus": {p: product_skus.get(p, []) for p in e["products"]},
                    "application_modes": e.get("application_modes"),
                    "condition": e.get("condition"),
                    "numeric_tokens": e.get("numeric_tokens"),
                    "procedure": e.get("procedure"),
                    "limitation": e.get("limitation") or [],
                    "gate_a_status": e.get("source_fidelity_status"),
                    "current_applicability": e.get("current_applicability"),
                    "can_verify": entry_can_verify(s, e),
                    "audit_template": gate_b_audit_template(s, e),
                    **gb,
                    "history": by_entry.get((s["source_id"], e["entry_key"]), []),
                }
            )
    items.sort(key=lambda x: (rank.get(x["priority"] or "", 9), x["source_id"], x["entry_key"]))
    pending_queue = [x for x in items if x["priority"]]
    summary = {
        "total": len(items),
        "queue_total": len(pending_queue),
        "by_priority": {p: sum(1 for x in pending_queue if x["priority"] == p) for p in ("P1", "P2", "P3")},
        "by_entry_state": {},
        "usable_entries": sum(1 for x in items if x["current_applicability"]["products"]),
    }
    for x in items:
        summary["by_entry_state"][x["entry_state"]] = summary["by_entry_state"].get(x["entry_state"], 0) + 1
    return {
        "contract_version": GATE_B_CONTRACT_VERSION,
        "summary": summary,
        "items": items,
        "questions": GATE_B_QUESTIONS,
        "basis_types": GATE_B_BASIS_TYPES,
        "confirmations": GATE_B_CONFIRMATIONS,
        "decision_confirmations": {d: [c for c in v if c] for d, v in GATE_B_DECISION_CONFIRMATIONS.items()},
        "decisions": list(GATE_B_DECISIONS),
    }


# ---------------------------------------------------------------- read-time resolution

def _overlaps(a, b) -> bool:
    return bool(a and b and a[0] is not None and b[0] is not None and a[0] < b[1] and b[0] < a[1])


def _applicability_withdrawn(unit: dict, evidence: dict, entry: dict) -> bool:
    recorded = evidence.get("current_applicability")
    if recorded is None:
        return False
    relied = set(recorded.get("products") or []) & set(unit_products(unit))
    return not relied <= set((entry.get("current_applicability") or {}).get("products") or [])


def resolve_unit_fact(unit: dict, *, key: str, reply_sha: str, records: list[dict], registry: dict) -> dict:
    """records: unit fact validation dicts for the knowledge item, oldest first."""
    own = [r for r in records if r.get("unit_key") == key]
    span = unit.get("sourceTextSpan")
    stale = [r for r in records if r.get("unit_key") != key and _overlaps(r.get("source_span"), span)]
    base = {
        "unitKey": key,
        "contractVersion": UNIT_FACT_CONTRACT_VERSION,
        "applicableAspects": applicable_aspects(unit),
        "historyCount": len(own),
        "staleHistoryCount": len(stale),
    }
    if not own:
        resolution = RES_NO_RECORD
        if stale:
            resolution = RES_STALE_REPLY_CHANGED if any(r.get("reply_sha256_at_validation") != reply_sha for r in stale) else RES_STALE_UNIT_CHANGED
        return base | {"status": FACT_PENDING, "recordedStatus": None, "resolution": resolution, "latest": None}
    latest = own[-1]
    resolution = RES_APPLICABLE
    changed_entries = []
    if latest.get("fact_status") == FACT_VERIFIED:
        for e in latest.get("evidence") or []:
            source, entry = _find_entry(registry, e.get("source_id"), e.get("entry_key"))
            if (
                source is None
                or entry is None
                or entry["entry_sha256"] != e.get("entry_sha256")
                or not entry_can_verify(source, entry)
                or _applicability_withdrawn(unit, e, entry)
            ):
                changed_entries.append(e.get("entry_key"))
        if changed_entries:
            resolution = RES_SOURCE_CHANGED
    status = latest.get("fact_status") if resolution == RES_APPLICABLE else FACT_PENDING
    return base | {
        "status": status,
        "recordedStatus": latest.get("fact_status"),
        "resolution": resolution,
        "changedEvidenceEntries": changed_entries,
        "latest": {
            k: latest.get(k)
            for k in (
                "unit_fact_validation_id", "fact_status", "verified_scope", "hold_reason", "evidence", "note",
                "reviewer_email", "reviewer_uid", "reviewer_role", "created_at", "extraction_version", "generator_reference_allowed",
            )
        },
    }


def unit_fact_use(unit_fact: dict, parent_authority: str) -> dict:
    reasons = []
    if unit_fact["status"] != FACT_VERIFIED:
        reasons.append("UNIT_FACT_NOT_VERIFIED" if unit_fact["resolution"] in (RES_NO_RECORD, RES_APPLICABLE) else unit_fact["resolution"])
    elif (unit_fact.get("latest") or {}).get("generator_reference_allowed") != "yes":
        reasons.append("GENERATOR_REFERENCE_NOT_ALLOWED")
    if parent_authority not in UNIT_FACT_PARENT_ALLOWED:
        reasons.append(f"PARENT_{parent_authority}")
    return {"generatorFactEligible": not reasons, "factUseBlockedReasons": reasons}


# ---------------------------------------------------------------- generator input / output contract

GENERATION_CONTRACT_VERSION = "review_reply_generation_knowledge_contract_v1"
BUCKET_STYLE = "response_style_references"
BUCKET_FACTS = "verified_product_facts"
BUCKET_UNVERIFIED = "unverified_guidance"
BUCKET_BLOCKED = "blocked_material"
GENERATION_RULES = (
    "response_style_references: tone/empathy/structure only; numbers, ratios, sequences and efficacy inside them are not facts.",
    "verified_product_facts: the only product facts allowed, within verified_scope, product and condition/sequence as recorded.",
    "unverified_guidance: must not be stated as product fact.",
    "blocked_material: must not be used at all (revalidation required / hold / excluded / outdated / stale).",
    "durations: the standard duration and a conditional adjustment range are different facts; state the adjustment only with its condition.",
    "application mode: single, sequential (per-step) and mixed usage are separate facts; never transfer one mode's duration or ratio to another.",
    "official_evidence carries condition, qualifiers and application modes; keep them with the number when stating it.",
)
CHECK_LIMITATIONS = (
    "Efficacy claims are detected by a keyword list only; paraphrased claims may be missed.",
    "Condition and sequence omissions are detected lexically (condition words, product order), not semantically.",
    "Products are detected by the extractor's product patterns; unnamed products cannot be scoped.",
    "A result without detectable violations is not a verification of the reply text.",
)
_EFFICACY_RE = re.compile(r"효과|효능|개선|완화|치료|예방|탈모|재생|진정|강화|새치\s*커버|커버력|발색이\s*(?:좋|잘)|영양|손상\s*회복|두피\s*건강")
_GENERALIZE_RE = re.compile(r"모든\s*(?:제품|분|모발)|전\s*제품|어떤\s*제품이?든|누구나|항상|반드시|무조건|100\s*%")
_SENT_RE = re.compile(r"[^.!?\n]+[.!?]?")


def _fact_from_unit(item: dict, unit: dict) -> dict:
    fv = unit.get("factValidation") or {}
    latest = fv.get("latest") or {}
    return {
        "unit_key": fv.get("unitKey"),
        "knowledge_id": item["knowledge_id"],
        "products": unit_products(unit),
        "condition": unit.get("condition"),
        "sequence": [{"order": s.get("order"), "product": s.get("product"), "numeric": s.get("numeric")} for s in unit.get("sequence") or []],
        "numeric_tokens": sorted(f"{n}|{u}" for n, u in _unit_numeric_tokens(unit)),
        "application_mode": application_mode(unit),
        "verified_scope": latest.get("verified_scope"),
        "official_evidence": [
            {k: e.get(k) for k in ("source_id", "source_version", "authority_class", "entry_key", "entry_sha256", "excerpt", "products", "covers")}
            | {k: e[k] for k in EVIDENCE_META_FIELDS if k in e}
            for e in latest.get("evidence") or []
        ],
        "extraction_version": unit.get("extractionVersion"),
        "validated_at": latest.get("created_at"),
    }


def build_generation_knowledge_input(items: list[dict], knowledge_ids: list[str] | None = None) -> dict:
    by_id = {x["knowledge_id"]: x for x in items}
    chosen = [by_id[k] for k in (knowledge_ids or list(by_id)) if k in by_id]
    out = {BUCKET_STYLE: [], BUCKET_FACTS: [], BUCKET_UNVERIFIED: [], BUCKET_BLOCKED: []}
    for item in chosen:
        authority = item.get("current_use_authority")
        if item.get("reply_reference_eligible"):
            out[BUCKET_STYLE].append(
                {
                    "knowledge_id": item["knowledge_id"],
                    "reply_text": item["reply_text"],
                    "use": "TONE_AND_CONTEXT_ONLY",
                    "unverified_fact_tokens": sorted({f for u in item.get("knowhow_items") or [] for f in u.get("facts") or []}),
                }
            )
        for unit in item.get("knowhow_items") or []:
            if not is_fact_candidate(unit):
                continue
            fv = unit.get("factValidation") or {}
            if unit.get("generatorFactEligible"):
                out[BUCKET_FACTS].append(_fact_from_unit(item, unit))
            elif authority in UNIT_FACT_PARENT_ALLOWED and fv.get("resolution") in (RES_NO_RECORD, RES_APPLICABLE, None):
                out[BUCKET_UNVERIFIED].append(
                    {
                        "unit_key": fv.get("unitKey"),
                        "knowledge_id": item["knowledge_id"],
                        "text": unit.get("originalText"),
                        "products": unit_products(unit),
                        "numeric_tokens": sorted(f"{n}|{u}" for n, u in _unit_numeric_tokens(unit)),
                        "status": fv.get("status", FACT_PENDING),
                        "reasons": unit.get("factUseBlockedReasons") or ["UNIT_FACT_NOT_VERIFIED"],
                    }
                )
            else:
                out[BUCKET_BLOCKED].append(
                    {
                        "unit_key": fv.get("unitKey"),
                        "knowledge_id": item["knowledge_id"],
                        "parent_authority": authority,
                        "resolution": fv.get("resolution"),
                        "reasons": unit.get("factUseBlockedReasons") or [],
                    }
                )
    return {"contract_version": GENERATION_CONTRACT_VERSION, "rules": list(GENERATION_RULES), **out}


def validate_generation_input(gen_input: dict, items: list[dict]) -> dict:
    """Re-check a prepared input against the current corpus (stale validations, blocked parents)."""
    current = {}
    for item in items:
        for unit in item.get("knowhow_items") or []:
            fv = unit.get("factValidation") or {}
            if fv.get("unitKey"):
                current[fv["unitKey"]] = (item, unit)
    issues = []
    for fact in gen_input.get(BUCKET_FACTS) or []:
        hit = current.get(fact.get("unit_key"))
        if hit is None:
            issues.append({"code": "STALE_VALIDATION_IN_INPUT", "unit_key": fact.get("unit_key"), "severity": "BLOCK"})
        elif not hit[1].get("generatorFactEligible"):
            issues.append(
                {
                    "code": "FACT_NO_LONGER_ELIGIBLE",
                    "unit_key": fact.get("unit_key"),
                    "reasons": hit[1].get("factUseBlockedReasons") or [],
                    "severity": "BLOCK",
                }
            )
    return {"valid": not issues, "issues": issues}


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT_RE.findall(text or "") if s.strip()]


def _required_condition_missing(fact: dict, window: str) -> bool:
    for e in fact.get("official_evidence") or []:
        if e.get("condition_required") and not any(re.search(p, window) for p in e.get("condition_patterns") or []):
            return True
    return False


def check_generated_reply(text: str, gen_input: dict) -> dict:
    facts = gen_input.get(BUCKET_FACTS) or []
    unverified = gen_input.get(BUCKET_UNVERIFIED) or []
    issues: list[dict] = []
    sentences = _sentences(text)
    for idx, sentence in enumerate(sentences):
        products = set(_products(sentence))
        tokens = numeric_tokens(sentence)
        window = " ".join(sentences[max(0, idx - 1) : idx + 2])
        matched: list[dict] = []
        if tokens:
            token_keys = {f"{n}|{u}" for n, u in tokens}
            for fact in facts:
                if token_keys & set(fact["numeric_tokens"]):
                    matched.append(fact)
            if not matched:
                issues.append({"code": "UNSUPPORTED_NUMERIC_CLAIM", "sentence": sentence, "tokens": sorted(token_keys), "severity": "BLOCK"})
            else:
                scoped = [f for f in matched if products and products <= set(f["products"])]
                if not products:
                    issues.append({"code": "NUMERIC_PRODUCT_UNSPECIFIED", "sentence": sentence, "severity": "REVIEW"})
                elif not scoped:
                    issues.append({"code": "PRODUCT_MISMATCH", "sentence": sentence, "products": sorted(products), "severity": "BLOCK"})
                base = scoped or matched
                s_mode = text_application_mode(sentence, products)
                compatible = [f for f in base if not f.get("application_mode") or not s_mode or f["application_mode"] == s_mode]
                if base and not compatible:
                    issues.append({"code": "APPLICATION_MODE_MISMATCH", "sentence": sentence, "mode": s_mode, "severity": "BLOCK"})
                conditioned = [f for f in compatible if not _required_condition_missing(f, window)]
                if compatible and not conditioned:
                    issues.append({"code": "OFFICIAL_CONDITION_OMITTED", "sentence": sentence, "severity": "BLOCK"})
                allowed = set().union(*(set(f["numeric_tokens"]) for f in (conditioned or compatible or base)))
                extra = sorted(token_keys - allowed)
                if extra:
                    issues.append({"code": "NUMERIC_EXCEEDS_VERIFIED_SCOPE", "sentence": sentence, "tokens": extra, "severity": "BLOCK"})
                for fact in conditioned or compatible or base:
                    if fact.get("condition") not in (None, "", UNKNOWN) and not _INLINE_CONDITION_RE.search(window) and not re.search(
                        r"경우|라면|시면|으면", window
                    ):
                        issues.append({"code": "CONDITION_OMITTED", "sentence": sentence, "unit_key": fact["unit_key"], "severity": "BLOCK"})
                    order = [s["product"] for s in fact.get("sequence") or [] if s.get("product")]
                    if len(order) >= 2:
                        positions = []
                        for p in order:
                            m = re.search(p.split()[0], window)
                            positions.append(m.start() if m else -1)
                        if -1 in positions or positions != sorted(positions):
                            issues.append({"code": "SEQUENCE_OMITTED_OR_REORDERED", "sentence": sentence, "unit_key": fact["unit_key"], "severity": "BLOCK"})
            for u in unverified:
                if token_keys & set(u["numeric_tokens"]) and not matched:
                    issues.append({"code": "UNVERIFIED_GUIDANCE_USED_AS_FACT", "sentence": sentence, "unit_key": u["unit_key"], "severity": "BLOCK"})
                    break
        if _GENERALIZE_RE.search(sentence) and (tokens or _EFFICACY_RE.search(sentence) or products):
            issues.append({"code": "OVERGENERALIZED_SCOPE", "sentence": sentence, "severity": "BLOCK"})
        if _EFFICACY_RE.search(sentence):
            supported = [f for f in facts if products and products <= set(f["products"]) and any("statement" in e.get("covers", []) for e in f["official_evidence"])]
            if not supported:
                issues.append({"code": "UNSUPPORTED_EFFICACY_CLAIM", "sentence": sentence, "severity": "REVIEW"})
    verdict = "BLOCK" if any(i["severity"] == "BLOCK" for i in issues) else ("HUMAN_REVIEW_REQUIRED" if issues else "NO_DETECTABLE_VIOLATION")
    return {"contract_version": GENERATION_CONTRACT_VERSION, "verdict": verdict, "issues": issues, "limitations": list(CHECK_LIMITATIONS)}
