from __future__ import annotations

import json
import os
import re
import copy
from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy.orm import Session

from content_blog_context import BLOG_CATEGORY_VALUES, DEFAULT_GENERATION_POLICY
from content_blog_experience_patterns import OVERCLAIM_TERMS
from content_blog_marketing_knowledge import (
    CLASS_UNVERIFIED_GENERAL,
    attach_blog_marketing_knowledge,
    marketing_catalog,
)
from settings_store import get_api_settings


PLANNER_VERSION = "blog_intent_and_content_plan_v1"
INTENT_ANALYSIS_VERSION = "blog_intent_analysis_v1"
CONTENT_PLAN_VERSION = "blog_content_plan_v1"
PLANNER_PROMPT_VERSION = "blog_planner_prompt_v5"
PLANNER_MODEL_DEFAULT = "gpt-5.5"

STATUS_PASS = "PASS"
STATUS_HOLD = "HOLD"
STATUS_PLANNER_FAILED = "PLANNER_FAILED"

CODE_INVALID_REFERENCE = "INVALID_REFERENCE"
CODE_PLANNER_FAILED = "PLANNER_FAILED"
CODE_SCHEMA_INVALID = "PLANNER_SCHEMA_INVALID"
CODE_RESTRICTED_CLAIM_LEAKAGE = "RESTRICTED_CLAIM_LEAKAGE"
CODE_GENERAL_KNOWLEDGE_LEAKAGE = "GENERAL_KNOWLEDGE_LEAKAGE"
CODE_FACT_BOUNDARY_VIOLATION = "PLANNER_FACT_BOUNDARY_VIOLATION"
CODE_DEFENSIVE_META_SECTION = "DEFENSIVE_META_SECTION_DETECTED"
CODE_UNSUPPORTED_SUPERIORITY = "UNSUPPORTED_SUPERIORITY_CLAIM"
CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP = "CATEGORY_TO_PRODUCT_CLAIM_LEAP"
CODE_CATEGORY_KNOWLEDGE_USED_AS_PRODUCT_STRENGTH = "CATEGORY_KNOWLEDGE_USED_AS_PRODUCT_STRENGTH"
CODE_PARTIAL_EVIDENCE_QUALIFIER_LOST = "HOLD_PARTIAL_EVIDENCE_QUALIFIER_LOST"
CODE_MARKETING_OBJECTIVE_INVALID = "HOLD_MARKETING_OBJECTIVE_NOT_GROUNDED"
CODE_EXPERIENCE_PATTERN_INVALID = "HOLD_EXPERIENCE_PATTERN_INVALID_REFERENCE"
CODE_PRODUCT_STRENGTH_WITHOUT_SOURCE = "HOLD_PRODUCT_STRENGTH_WITHOUT_SOURCE"

CLASSIFICATION_PLANNING_INFERENCE = "PLANNING_INFERENCE"
CLASSIFICATION_SOURCE_CONFIRMED = "SOURCE_CONFIRMED"
CLASSIFICATION_MODEL_DERIVED = "MODEL_DERIVED"

ORIGIN_MODEL_DERIVED = "MODEL_DERIVED"
ORIGIN_CONTEXT_PROVIDED = "CONTEXT_PROVIDED"

INTENT_VALUES = (
    "INFORMATION",
    "HOW_TO",
    "PROBLEM_SOLUTION",
    "PRODUCT_REVIEW",
    "PRODUCT_COMPARISON",
    "PURCHASE_CONSIDERATION",
    "EXPERT_GUIDE",
    "FAQ",
    "TREND",
    "CASE_STUDY",
    "BRAND_INFORMATION",
    "UNKNOWN",
)

CTA_TYPES = ("READ_MORE", "CHECK_PRODUCT_INFO", "APPLY_GUIDE", "ASK_EXPERIENCE", "NONE")
COVERAGE_STATUSES = ("COVERED", "PARTIALLY_COVERED", "SOURCE_INSUFFICIENT", "OUT_OF_SCOPE")
FAQ_STATUSES = ("SUPPORTED", "SOURCE_INSUFFICIENT")
IMAGE_NEED_STATUSES = ("NEEDED", "OPTIONAL", "NOT_NEEDED")
COMPARISON_INTENTS = {"PRODUCT_COMPARISON", "PURCHASE_CONSIDERATION"}
PAS_INTENTS = {"PROBLEM_SOLUTION", "PURCHASE_CONSIDERATION", "HOW_TO"}
MARKETING_ROLES = (
    "EMPATHY",
    "EDUCATION",
    "PRODUCT_RELEVANCE",
    "BRAND_DIFFERENTIATION",
    "SOCIAL_PROOF",
    "EXPECTATION_SETTING",
    "HOW_TO",
    "CTA_BRIDGE",
)
CONTENT_TYPE_PROFILES = (
    "HOW_TO",
    "PRODUCT_GUIDE",
    "INGREDIENT_EDUCATION",
    "PROBLEM_SOLUTION",
    "SEASONAL",
    "BRAND_STORY",
)
DEFENSIVE_META_PATTERNS = (
    "말할 수 있는 것",
    "말할 수 없는 것",
    "확인이 필요한 것",
    "제품 정보의 범위",
    "다루는 제품 정보의 범위",
    "현재 제공된 정보로 확인할 수 있는 것",
    "제공된 자료만",
    "제공된 정보만",
    "답할 수 없는 범위",
    "확인할 수 없는 범위",
    "자료가 부족해서",
    "이 글에서 다룰 수 있는",
)
DEFENSIVE_META_EXCEPTIONS = {"PRODUCT_INFO_HOW_TO", "LEGAL_NOTICE", "SAFETY_NOTICE", "COMMERCIAL_DISCLOSURE"}
UNSUPPORTED_SUPERIORITY_TERMS = (
    "시중 최고",
    "최고 헤나",
    "가장 우수",
    "타사보다 뛰어",
    "압도적",
    "유일한",
    "무조건 최고",
)
CATEGORY_PRODUCT_LEAP_HINTS = (
    "함량이 높아",
    "염색력이 우수",
    "우리 제품은 반드시",
    "동일 결과를 보장",
)

RESTRICTED_BYPASS_HINTS = (
    "덜 빠지",
    "탈모 예방",
    "탈모 개선",
    "육모",
    "발모",
    "완치",
    "부작용 없음",
    "100% 효과",
    "머리가 자라",
)

FACT_CLASS_LABELS = {
    "FACT_SOURCE",
    "BRAND_SOURCE",
    "PRODUCT_SOURCE",
    "GENERAL_KNOWLEDGE",
}


class BlogPlannerError(RuntimeError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}:{message}" if message else code)
        self.code = code
        self.detail = message


def serialize_blog_intent_analysis(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def serialize_blog_content_plan(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def plan_blog_content(
    db: Session | None = None,
    *,
    blog_context: dict[str, Any],
    raw_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Design intent + content plan from BlogGenerationContext only. Does not write the article."""
    if not isinstance(blog_context, dict) or blog_context.get("version") != "blog_generation_context_v1":
        raise BlogPlannerError(CODE_PLANNER_FAILED, "blog_generation_context_required")
    blog_context = attach_blog_marketing_knowledge(blog_context, db=db)
    catalogs = _catalogs(blog_context)
    try:
        raw = raw_plan if isinstance(raw_plan, dict) else _planner_raw_output(db, blog_context, catalogs)
    except BlogPlannerError:
        raise
    except Exception as exc:
        raise BlogPlannerError(CODE_PLANNER_FAILED, str(exc)[:800]) from exc
    if not isinstance(raw, dict):
        raise BlogPlannerError(CODE_PLANNER_FAILED, "planner_json_not_object")
    return validate_blog_intent_and_content_plan(blog_context, raw, catalogs=catalogs)


def validate_blog_intent_and_content_plan(
    blog_context: dict[str, Any],
    raw: dict[str, Any],
    *,
    catalogs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    catalogs = catalogs or _catalogs(blog_context)
    issues: list[dict[str, Any]] = []
    intent_raw = raw.get("intentAnalysis") if isinstance(raw.get("intentAnalysis"), dict) else raw.get("intent_analysis")
    plan_raw = raw.get("contentPlan") if isinstance(raw.get("contentPlan"), dict) else raw.get("content_plan")
    if not isinstance(intent_raw, dict) or not isinstance(plan_raw, dict):
        issues.append(_issue(CODE_SCHEMA_INVALID, "intentAnalysis and contentPlan objects are required"))
        return _result(STATUS_HOLD, CODE_SCHEMA_INVALID, issues, None, None, raw, catalogs=catalogs)
    intent = _normalize_intent_analysis(blog_context, intent_raw, catalogs, issues)
    plan = _normalize_content_plan(blog_context, plan_raw, intent, catalogs, issues)
    _check_reference_integrity(plan, catalogs, issues)
    _check_knowledge_references(plan, catalogs, issues)
    _check_experience_patterns(plan, catalogs, issues)
    _check_marketing_objective_fields(intent, plan, issues)
    _check_product_strength_grounding(plan, catalogs, issues)
    _check_unsupported_superiority(intent, plan, issues)
    _check_category_to_product_leap(plan, catalogs, issues)
    _check_category_used_as_product_strength(plan, catalogs, issues)
    _check_qualified_category_knowledge(plan, catalogs, issues)
    _check_defensive_meta_sections(plan, issues)
    _check_restricted_leakage(intent, plan, catalogs, issues)
    _check_general_knowledge_boundary(blog_context, plan, catalogs, issues)
    _check_not_finished_article(plan, issues)

    code = _primary_issue_code(issues)
    status = STATUS_HOLD if code else STATUS_PASS
    return _result(status, code, issues, intent, plan, raw, catalogs=catalogs)


def _result(
    status: str,
    code: str | None,
    issues: list[dict[str, Any]],
    intent: dict[str, Any] | None,
    plan: dict[str, Any] | None,
    raw: dict[str, Any],
    catalogs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "status": status,
        "code": code,
        "issues": issues,
        "intentAnalysis": intent,
        "contentPlan": plan,
        "plannerVersion": PLANNER_VERSION,
        "promptVersion": PLANNER_PROMPT_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "rawAccepted": status == STATUS_PASS,
    }
    if catalogs:
        payload["plannerReferenceCatalog"] = catalogs.get("plannerReferenceCatalog") or {}
    return payload


def _issue(code: str, message: str, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    item = {"code": code, "message": message}
    if extra:
        item.update(extra)
    return item


def _primary_issue_code(issues: list[dict[str, Any]]) -> str | None:
    if not issues:
        return None
    priority = (
        CODE_INVALID_REFERENCE,
        CODE_EXPERIENCE_PATTERN_INVALID,
        CODE_RESTRICTED_CLAIM_LEAKAGE,
        CODE_GENERAL_KNOWLEDGE_LEAKAGE,
        CODE_UNSUPPORTED_SUPERIORITY,
        CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP,
        CODE_CATEGORY_KNOWLEDGE_USED_AS_PRODUCT_STRENGTH,
        CODE_PARTIAL_EVIDENCE_QUALIFIER_LOST,
        CODE_PRODUCT_STRENGTH_WITHOUT_SOURCE,
        CODE_DEFENSIVE_META_SECTION,
        CODE_MARKETING_OBJECTIVE_INVALID,
        CODE_FACT_BOUNDARY_VIOLATION,
        CODE_SCHEMA_INVALID,
    )
    codes = [str(item.get("code") or "") for item in issues]
    for code in priority:
        if code in codes:
            return code
    return codes[0]


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _planner_safe_context(blog_context: dict[str, Any]) -> dict[str, Any]:
    """Planner prompt must not receive the raw review corpus."""
    payload = copy.deepcopy(blog_context) if isinstance(blog_context, dict) else {}
    knowledge = payload.get("marketingKnowledge")
    if isinstance(knowledge, dict):
        knowledge.pop("processedReviews", None)
        library = knowledge.get("internalKnowledgeLibrary")
        if isinstance(library, dict):
            library.pop("processedReviews", None)
        patterns = []
        for item in _as_list(knowledge.get("experiencePatterns")):
            if not isinstance(item, dict):
                continue
            compact = dict(item)
            compact.pop("matchedReviews", None)
            compact.pop("reviewTexts", None)
            patterns.append(compact)
        knowledge["experiencePatterns"] = patterns
    payload.pop("processedReviews", None)
    return payload


def _catalogs(blog_context: dict[str, Any]) -> dict[str, Any]:
    facts = [item for item in _as_list(blog_context.get("sourceFacts")) if isinstance(item, dict) and _text(item.get("factId"))]
    evidence = [item for item in _as_list(blog_context.get("evidence")) if isinstance(item, dict)]
    fact_by_id = {str(item["factId"]): item for item in facts}
    evidence_ids = {
        _text(item.get("evidenceId")) or _text(item.get("sourcePk"))
        for item in evidence
        if _text(item.get("evidenceId")) or _text(item.get("sourcePk"))
    }
    source_refs = set()
    for item in facts:
        for key in ("factId", "sourceRef"):
            if _text(item.get(key)):
                source_refs.add(_text(item.get(key)))
        path = _text((item.get("provenance") or {}).get("sourcePath")) if isinstance(item.get("provenance"), dict) else ""
        if path:
            source_refs.add(path)
    for item in evidence:
        for key in ("evidenceId", "sourcePk"):
            if _text(item.get(key)):
                source_refs.add(_text(item.get(key)))
    restricted = [item for item in _as_list(blog_context.get("restrictedClaims")) if isinstance(item, dict)]
    restricted_terms = [_text(item.get("term")) for item in restricted if _text(item.get("term"))]
    policy = blog_context.get("generationPolicy") if isinstance(blog_context.get("generationPolicy"), dict) else dict(DEFAULT_GENERATION_POLICY)
    audience = blog_context.get("targetAudience") if isinstance(blog_context.get("targetAudience"), dict) else {}
    search = blog_context.get("searchContext") if isinstance(blog_context.get("searchContext"), dict) else {}
    knowledge = marketing_catalog(blog_context)
    planner_reference_catalog = {
        "allowedFactIds": sorted(fact_by_id.keys()),
        "allowedEvidenceIds": sorted(evidence_ids),
        "allowedBrandKnowledgeIds": list(knowledge["allowedBrandKnowledgeIds"]),
        "allowedProductKnowledgeIds": list(knowledge["allowedProductKnowledgeIds"]),
        "allowedCategoryKnowledgeIds": list(knowledge["allowedCategoryKnowledgeIds"]),
        "allowedExperiencePatternIds": list(knowledge.get("allowedExperiencePatternIds") or []),
    }
    return {
        "facts": facts,
        "factById": fact_by_id,
        "evidence": evidence,
        "evidenceIds": evidence_ids,
        "sourceRefs": source_refs,
        "restricted": restricted,
        "restrictedTerms": restricted_terms,
        "allowedClaims": [item for item in _as_list(blog_context.get("allowedClaims")) if isinstance(item, dict)],
        "policy": policy,
        "audience": audience,
        "search": search,
        "category": _text(blog_context.get("category")) or "UNKNOWN",
        "topic": _text(blog_context.get("topic")),
        "audienceProblem": _text(blog_context.get("audienceProblem")),
        "allowGeneralKnowledge": bool(policy.get("allowGeneralKnowledge")),
        "allowedFactIds": sorted(fact_by_id.keys()),
        "allowedEvidenceIds": sorted(evidence_ids),
        "plannerReferenceCatalog": planner_reference_catalog,
        "canonicalIds": set(fact_by_id.keys()) | set(evidence_ids),
        "knowledgeIds": set(knowledge["knowledgeIds"]),
        "brandById": knowledge["brandById"],
        "productById": knowledge["productById"],
        "categoryById": knowledge["categoryById"],
        "experiencePatternById": knowledge.get("experiencePatternById") or {},
        "allowedExperiencePatternIds": set(knowledge.get("allowedExperiencePatternIds") or []),
        "experiencePatternCatalog": knowledge.get("experiencePatternCatalog") or [],
        "categoryKnowledgeCatalog": knowledge.get("categoryKnowledgeCatalog") or [],
        "reviewCorpusProfile": knowledge.get("reviewCorpusProfile") or {},
        "researchRequestCandidates": knowledge.get("researchRequestCandidates") or [],
        "knowledgeStatements": knowledge["statements"],
        "marketingKnowledge": knowledge["marketingKnowledge"],
        "customerExperienceEvidence": knowledge["customerExperienceEvidence"],
    }


def _planner_raw_output(db: Session | None, blog_context: dict[str, Any], catalogs: dict[str, Any]) -> dict[str, Any]:
    if os.getenv("CONTENT_BLOG_PLANNER_TEST_FIXTURE") == "1" or os.getenv("CONTENT_WRITER_TEST_FIXTURE") == "1":
        return _fixture_planner_output(blog_context, catalogs)
    if db is None:
        raise BlogPlannerError(CODE_PLANNER_FAILED, "planner_db_required_for_llm")
    return _call_planner_llm(db, blog_context, catalogs)


def _api_setting(db: Session, name: str) -> str:
    value = str(get_api_settings(db, [name]).get(name, "") or "").strip()
    return value or str(os.getenv(name) or "").strip()


def _active_planner_model() -> str:
    return str(os.getenv("CONTENT_BLOG_PLANNER_MODEL") or os.getenv("CONTENT_WRITER_MODEL") or PLANNER_MODEL_DEFAULT).strip()


def _call_planner_llm(db: Session, blog_context: dict[str, Any], catalogs: dict[str, Any]) -> dict[str, Any]:
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise BlogPlannerError(CODE_PLANNER_FAILED, "OPENAI_API_KEY not configured")
    model = _active_planner_model()
    payload: dict[str, Any] = {
        "model": model,
        "messages": _planner_messages(blog_context, catalogs),
        "response_format": {"type": "json_object"},
    }
    if model.startswith("gpt-5"):
        # gpt-5.5 can spend the entire completion budget on reasoning_tokens.
        # PHASE 8 live evidence: max=4000 → finish_reason=length, content empty.
        payload["max_completion_tokens"] = 16000
    else:
        payload["temperature"] = 0.2
        payload["max_tokens"] = 4000
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=300,
    )
    if int(resp.status_code) != 200:
        raise BlogPlannerError(CODE_PLANNER_FAILED, f"openai_planner_error:{resp.status_code}:{str(resp.text or '')[:800]}")
    content = (((resp.json() or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    try:
        parsed = json.loads(str(content).strip())
    except Exception as exc:
        raise BlogPlannerError(CODE_PLANNER_FAILED, "openai_planner_invalid_json") from exc
    if not isinstance(parsed, dict):
        raise BlogPlannerError(CODE_PLANNER_FAILED, "openai_planner_json_not_object")
    return parsed


def _planner_messages(blog_context: dict[str, Any], catalogs: dict[str, Any]) -> list[dict[str, str]]:
    schema = {
        "intentAnalysis": {
            "primaryIntent": "HOW_TO",
            "secondaryIntents": ["INFORMATION"],
            "searchGoal": "string",
            "readerQuestions": ["string"],
            "audienceHypothesis": {"primary": "string", "secondary": None, "basis": ["string"], "confidence": "MEDIUM"},
            "categoryHypothesis": {"category": "HOW_TO", "confidence": "MEDIUM"},
            "keywordPlan": {"primaryKeyword": "string", "relatedKeywords": ["string"], "subIntentKeywords": ["string"]},
            "contentObjective": "string",
            "uncertainties": ["string"],
            "marketingIntent": {
                "customerProblem": "string",
                "customerDesire": "string",
                "customerBarrier": "string or null",
                "readerStateBefore": "string",
                "readerStateAfter": "string",
                "coreMarketingMessage": "string",
                "selectedAppeals": ["string"],
                "brandRole": "string",
                "productRole": "string",
                "desiredAction": "string",
                "planningSourceRefs": ["sf_...", "EV-...", "PK-..."],
                "classification": "MODEL_DERIVED_PLANNING_INFERENCE",
            },
        },
        "contentPlan": {
            "workingTitleCandidates": [{"title": "string", "angle": "HOW_TO", "primaryIntent": "HOW_TO"}],
            "coreQuestion": "string",
            "coreAnswer": "2-4 sentence plan summary or null",
            "readerBenefit": "string",
            "contentTypeProfile": "HOW_TO",
            "marketingStrategy": {
                "objective": "string",
                "coreCustomerProblem": "string",
                "coreMarketingMessage": "string",
                "selectedProductStrengths": [{"message": "string", "knowledgeRefs": ["PK-..."], "evidenceRefs": []}],
                "selectedBrandStrengths": [{"message": "string", "knowledgeRefs": ["BK-..."]}],
                "educationValue": "string",
                "differentiationApproach": "string",
                "socialProofApproach": "string",
                "expectationManagement": "string",
                "ctaIntent": "string",
            },
            "experiencePatterns": [
                {
                    "patternId": "XP-1",
                    "label": "string",
                    "interpretation": "string",
                    "evidenceRefs": ["EV-..."],
                    "supportCount": 1,
                    "patternType": "MODEL_DERIVED_FROM_EVIDENCE",
                    "marketingUse": "string",
                }
            ],
            "knowledgeUsePlan": [{"knowledgeRef": "PK-...", "use": "PRODUCT_RELEVANCE"}],
            "brandUsePlan": [],
            "productValuePlan": [],
            "persuasionFlow": ["CUSTOMER_PROBLEM", "EMPATHY", "USEFUL_KNOWLEDGE", "PRODUCT_BRAND_RELEVANCE", "CUSTOMER_EXPERIENCE", "EXPECTATION_SETTING", "CTA"],
            "sections": [
                {
                    "sectionId": "S1",
                    "headingIntent": "string",
                    "userQuestion": "string",
                    "purpose": "string",
                    "contentType": "HOW_TO",
                    "marketingRole": "EMPATHY",
                    "factsToUse": ["sf_..."],
                    "evidenceToUse": [{"evidenceRef": "EV-...", "purpose": "string"}],
                    "sourceRefs": ["sf_...", "EV-..."],
                    "brandKnowledgeRefs": [],
                    "productKnowledgeRefs": [],
                    "categoryKnowledgeRefs": [],
                    "experiencePatternRefs": [],
                    "qualificationRequired": False,
                    "customerValue": "string",
                    "productConnection": "string or null",
                    "inferencesAllowed": ["string"],
                    "claimsToAvoid": ["string"],
                    "imageNeed": {"visualPurpose": "string", "preferredSource": "REAL_PRODUCT_PHOTO", "status": "NEEDED"},
                    "riskNotes": ["string"],
                }
            ],
            "faqPlan": [{"question": "string", "answerIntent": "string", "sourceRefs": ["sf_..."], "status": "SUPPORTED"}],
            "comparisonPlan": [],
            "imageNeeds": [{"sectionId": "S1", "visualPurpose": "string", "preferredSource": "REAL_PRODUCT_PHOTO", "status": "NEEDED"}],
            "conclusionPlan": {"summaryIntent": "string", "judgmentCriteria": "string", "closingQuestion": "string"},
            "ctaPlan": {"type": "CHECK_PRODUCT_INFO", "intent": "string"},
            "coverage": {"readerQuestions": [{"question": "string", "coveredBy": ["S1"], "status": "COVERED"}]},
            "unsupportedTopics": [{"topic": "string", "reason": "SOURCE_NOT_AVAILABLE", "action": "OMIT_OR_REQUEST_SOURCE"}],
            "knowledgeGaps": [{"gapId": "KG-...", "domain": "CATEGORY", "topic": "string", "status": "MISSING", "readerFacing": False}],
            "planningWarnings": ["string"],
        },
    }
    return [
        {
            "role": "system",
            "content": (
                "당신의 역할은 compliance report를 만드는 것이 아니다. "
                "검증된 Knowledge와 Evidence를 사용하여 독자에게 실제로 도움이 되는 전문적인 정보를 제공하고, "
                "고객의 고민과 제품/브랜드의 확인된 가치를 자연스럽게 연결하는 Marketing Content Plan을 설계한다. "
                "MARKETING DEFINES THE STORY. COMPLIANCE DEFINES THE BOUNDARY. "
                "Planning priority: CUSTOMER PROBLEM/DESIRE, SEARCH INTENT, MARKETING OBJECTIVE, PRODUCT/BRAND APPEAL, "
                "PROFESSIONAL INFORMATION VALUE, DIFFERENTIATION, CUSTOMER EXPERIENCE, PERSUASIVE FLOW, CTA. "
                "FACT INTEGRITY, SOURCE TRACEABILITY, CLAIM SAFETY, COMPLIANCE, NO FABRICATED EXPERIENCE, "
                "NO UNSUPPORTED SUPERIORITY는 목적가 아니라 guardrail이다. "
                "입력 Context에 존재하지 않는 제품 사실, 브랜드 사실, 성분 정보, 효능, 수치, 고객 경험을 만들지 않는다. "
                "UNVERIFIED_GENERAL_KNOWLEDGE는 금지. VERIFIED_CATEGORY_KNOWLEDGE, APPROVED_BRAND_KNOWLEDGE, APPROVED_PRODUCT_KNOWLEDGE만 사용한다. "
                "Audience, Search Intent, Keyword, Category, marketingIntent는 PLANNING_INFERENCE이며 Source Fact가 아니다. "
                "모든 핵심 Section은 가능한 경우 sourceFacts와 evidence를 명시적으로 참조한다. "
                "근거가 부족한 주제는 본문 섹션으로 설명하지 말고 knowledgeGaps와 unsupportedTopics 내부 control로만 보낸다. "
                "unsupportedTopics는 INTERNAL CONTROL ONLY이다. 독자에게 말할 수 없는 것/확인해야 하는 것 섹션을 만들지 않는다. "
                "정보 부족 자체를 reader-facing section의 주제로 만들지 않는다. "
                "이 글에서 말할 수 있는 것, 제품 정보의 범위, 제공된 자료만으로는, 상세페이지에서 직접 확인하십시오 같은 meta section을 만들지 않는다. "
                "제품 장점을 적극적으로 사용할 수 있지만 source가 없는 효능·우월성·경험은 만들지 않는다. "
                "최고, 가장 우수, 타사보다 뛰어남, 압도적, 유일한 표현은 근거 없이 금지. "
                "Category knowledge를 특정 제품 효능/우수성으로 자동 전환하지 않는다. "
                "selectedProductStrengths는 Product Knowledge, Brand Knowledge, Product Evidence만 사용한다. Category Knowledge 단독으로 제품 강점을 만들지 않는다. "
                "Category Knowledge는 EDUCATION, EXPLANATION, SELECTION_CRITERIA, PRODUCT_CONTEXT에 사용한다. "
                "QUALIFIED_EDUCATION_ONLY 지식은 '연구에서 제안됨/특정 실험 조건에서 관찰됨'처럼 조건을 보존하고 qualificationRequired=true를 유지한다. "
                "헤나가 keratin과 반드시 특정 방식으로 결합한다, 호호바가 모발 손상을 개선한다처럼 확정 변환하지 않는다. "
                "학술 리뷰 목차(Chemical Structure, Experimental Method, Study Result, Literature Review)를 만들지 않는다. "
                "독자 글에 James 1986, SCCS 2013 같은 논문 인용을 문단마다 강제하지 않는다. provenance는 내부 categoryKnowledgeRefs로 유지한다. "
                "experiencePatterns의 MODEL_DERIVED_FROM_EVIDENCE는 evidenceRefs exact ID만 쓰고 supportCount는 그 개수와 같아야 한다. "
                "CORPUS_DERIVED_PATTERN은 plannerReferenceCatalog.allowedExperiencePatternIds의 exact ID만 사용한다. "
                "CORPUS_DERIVED_PATTERN은 리뷰 텍스트 출현 패턴이며 제품 효능 Fact가 아니다. matchedReviewCount를 효능 비율이나 인구 통계로 바꾸지 않는다. "
                "대표 Evidence 개수를 matchedReviewCount로 표시하지 않는다. 대부분/압도적/많은 고객/거의 모든 고객 같은 인구 과장을 만들지 않는다. "
                "존재하지 않는 XP ID는 INVALID_REFERENCE HOLD이다. 존재하지 않는 리뷰를 만들지 않는다. 개별 후기를 모든 고객으로 일반화하지 않는다. "
                "restrictedClaims를 우회 표현으로 재작성하지 않는다. "
                "완성된 블로그 본문을 작성하지 않는다. "
                "SOURCE CONTENT는 의미가 무엇인지를 설명하고, REFERENCE CATALOG는 출력 가능한 ID만 나열한다. "
                "factsToUse, evidenceToUse.evidenceRef, sourceRefs, knowledgeRefs에는 plannerReferenceCatalog의 값을 exact string으로만 복사한다. "
                "prefix/suffix/category label을 붙이지 않는다. review:EV-, evidence:EV-, brand:BK-, category:CK-, evidence[0], sourcePk, sourcePath는 출력 ID가 아니다. "
                "존재하지 않는 ID를 만들지 않는다. "
                "CONTROL_FIELD(claimsToAvoid, unsupportedTopics, planningWarnings, riskNotes, knowledgeGaps, claimBoundary)에는 restricted term을 기록할 수 있다. "
                "CONTENT_FIELD(searchGoal, readerQuestions, titles, coreQuestion, coreAnswer, readerBenefit, headingIntent, userQuestion, purpose, inferencesAllowed, faq, cta, conclusion, marketingStrategy prose, experiencePatterns.interpretation)에는 restricted term을 쓰지 않는다. "
                "금지 대상을 설명하려고 CONTENT_FIELD에 치료 같은 단어를 넣지 말고 claimsToAvoid에만 넣는다. "
                "keywordPlan은 본문 설계용 의미 키워드 후보이며 네이버 검색량/인기/스마트블록 데이터가 아니다. "
                "JSON 객체만 반환한다."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "task": "Create one BlogIntentAnalysis and one BlogContentPlan from the given BlogGenerationContext.",
                    "sourceContent": {
                        "facts": [{"factId": item.get("factId"), "statement": item.get("statement")} for item in catalogs["facts"]],
                        "evidence": [
                            {
                                "evidenceId": _text(item.get("evidenceId") or item.get("sourcePk")),
                                "statement": item.get("statement"),
                            }
                            for item in catalogs["evidence"]
                            if _text(item.get("evidenceId") or item.get("sourcePk"))
                        ],
                    },
                    "plannerReferenceCatalog": catalogs["plannerReferenceCatalog"],
                    "referenceRules": [
                        "Copy catalog IDs exactly.",
                        "Do not emit evidence[0], review:EV-, evidence:EV-, brand:BK-, category:CK-, or sourcePk as a reference.",
                        "factsToUse and sourceRefs use allowedFactIds or allowedEvidenceIds only.",
                        "evidenceToUse uses {evidenceRef, purpose} with allowedEvidenceIds only.",
                        "brand/product/category knowledgeRefs use allowedBrandKnowledgeIds, allowedProductKnowledgeIds, allowedCategoryKnowledgeIds only.",
                        "experiencePatternRefs use allowedExperiencePatternIds or plan-emitted MODEL_DERIVED pattern IDs only.",
                    ],
                    "experiencePatternCatalog": catalogs.get("experiencePatternCatalog") or [],
                    "categoryKnowledgeCatalog": catalogs.get("categoryKnowledgeCatalog") or [],
                    "reviewCorpusProfile": catalogs.get("reviewCorpusProfile") or {},
                    "blogGenerationContext": _planner_safe_context(blog_context),
                    "restrictedTerms": catalogs["restrictedTerms"],
                    "allowGeneralKnowledge": catalogs["allowGeneralKnowledge"],
                    "intentEnum": list(INTENT_VALUES),
                    "categoryEnum": list(BLOG_CATEGORY_VALUES),
                    "ctaEnum": list(CTA_TYPES),
                    "coverageStatusEnum": list(COVERAGE_STATUSES),
                    "required_output_schema": schema,
                },
                ensure_ascii=False,
            ),
        },
    ]


def _normalize_intent_analysis(
    blog_context: dict[str, Any],
    raw: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
) -> dict[str, Any]:
    primary = _text(raw.get("primaryIntent") or raw.get("primary_intent")).upper() or "UNKNOWN"
    if primary not in INTENT_VALUES:
        issues.append(_issue(CODE_SCHEMA_INVALID, f"primaryIntent is not a valid enum: {primary}"))
        primary = "UNKNOWN"
    secondary: list[str] = []
    for item in _as_list(raw.get("secondaryIntents") or raw.get("secondary_intents")):
        value = _text(item).upper()
        if value in INTENT_VALUES and value not in secondary and value != primary:
            secondary.append(value)
        elif value and value not in INTENT_VALUES:
            issues.append(_issue(CODE_SCHEMA_INVALID, f"secondaryIntent is not a valid enum: {value}"))

    audience_raw = raw.get("audienceHypothesis") if isinstance(raw.get("audienceHypothesis"), dict) else raw.get("audience_hypothesis")
    audience_raw = audience_raw if isinstance(audience_raw, dict) else {}
    source_audience = catalogs["audience"]
    source_primary = _text(source_audience.get("primary"))
    source_confirmed = _text(source_audience.get("status")).upper() == CLASSIFICATION_SOURCE_CONFIRMED and bool(source_primary)
    if source_confirmed:
        audience = {
            "primary": source_primary,
            "secondary": _text(source_audience.get("secondary")) or None,
            "basis": ["SOURCE_CONFIRMED"],
            "classification": CLASSIFICATION_SOURCE_CONFIRMED,
            "confidence": "HIGH",
        }
    else:
        classification = _text(audience_raw.get("classification")).upper() or CLASSIFICATION_PLANNING_INFERENCE
        if classification in FACT_CLASS_LABELS:
            issues.append(_issue(CODE_FACT_BOUNDARY_VIOLATION, "audienceHypothesis cannot be stored as a source fact class"))
            classification = CLASSIFICATION_PLANNING_INFERENCE
        if classification != CLASSIFICATION_SOURCE_CONFIRMED:
            classification = CLASSIFICATION_PLANNING_INFERENCE
        audience = {
            "primary": _text(audience_raw.get("primary")) or None,
            "secondary": _text(audience_raw.get("secondary")) or None,
            "basis": [_text(item) for item in _as_list(audience_raw.get("basis")) if _text(item)]
            or ([catalogs["audienceProblem"]] if catalogs["audienceProblem"] else ["TOPIC_DERIVED"]),
            "classification": classification,
            "confidence": _text(audience_raw.get("confidence")).upper() or "MEDIUM",
        }

    category_raw = raw.get("categoryHypothesis") if isinstance(raw.get("categoryHypothesis"), dict) else raw.get("category_hypothesis")
    category_raw = category_raw if isinstance(category_raw, dict) else {}
    source_category = catalogs["category"]
    if source_category and source_category != "UNKNOWN":
        category = {
            "category": source_category,
            "classification": CLASSIFICATION_SOURCE_CONFIRMED,
            "confidence": "HIGH",
        }
    else:
        proposed = _text(category_raw.get("category")).upper() or "UNKNOWN"
        if proposed not in BLOG_CATEGORY_VALUES:
            issues.append(_issue(CODE_SCHEMA_INVALID, f"categoryHypothesis is not a valid enum: {proposed}"))
            proposed = "UNKNOWN"
        classification = _text(category_raw.get("classification")).upper() or CLASSIFICATION_PLANNING_INFERENCE
        if classification in FACT_CLASS_LABELS:
            issues.append(_issue(CODE_FACT_BOUNDARY_VIOLATION, "categoryHypothesis cannot be stored as a source fact class"))
            classification = CLASSIFICATION_PLANNING_INFERENCE
        category = {
            "category": proposed,
            "classification": CLASSIFICATION_PLANNING_INFERENCE,
            "confidence": _text(category_raw.get("confidence")).upper() or "MEDIUM",
        }

    keyword_raw = raw.get("keywordPlan") if isinstance(raw.get("keywordPlan"), dict) else raw.get("keyword_plan")
    keyword_raw = keyword_raw if isinstance(keyword_raw, dict) else {}
    context_keyword = _text(catalogs["search"].get("primaryKeyword"))
    if context_keyword:
        primary_keyword = context_keyword
        origin = ORIGIN_CONTEXT_PROVIDED
    else:
        primary_keyword = _text(keyword_raw.get("primaryKeyword") or keyword_raw.get("primary_keyword")) or None
        origin = ORIGIN_MODEL_DERIVED
    if _text(keyword_raw.get("origin")).upper() in {"NAVER_POPULAR", "SEARCH_VOLUME", "SMARTBLOCK", "RELATED_SEARCH_CRAWL"}:
        issues.append(_issue(CODE_FACT_BOUNDARY_VIOLATION, "keywordPlan origin cannot claim unverified search data"))
    if keyword_raw.get("verifiedSearchData") is True:
        issues.append(_issue(CODE_FACT_BOUNDARY_VIOLATION, "verifiedSearchData cannot be true without search source"))
    keyword_plan = {
        "primaryKeyword": primary_keyword,
        "relatedKeywords": [_text(item) for item in _as_list(keyword_raw.get("relatedKeywords") or keyword_raw.get("related_keywords")) if _text(item)][:8],
        "subIntentKeywords": [_text(item) for item in _as_list(keyword_raw.get("subIntentKeywords") or keyword_raw.get("sub_intent_keywords")) if _text(item)][:8],
        "origin": origin,
        "verifiedSearchData": False,
        "classification": CLASSIFICATION_PLANNING_INFERENCE if origin == ORIGIN_MODEL_DERIVED else CLASSIFICATION_MODEL_DERIVED,
    }
    if origin == ORIGIN_CONTEXT_PROVIDED:
        keyword_plan["classification"] = CLASSIFICATION_PLANNING_INFERENCE

    reader_questions = [_text(item) for item in _as_list(raw.get("readerQuestions") or raw.get("reader_questions")) if _text(item)][:8]
    return {
        "version": INTENT_ANALYSIS_VERSION,
        "primaryIntent": primary,
        "secondaryIntents": secondary[:4],
        "searchGoal": _text(raw.get("searchGoal") or raw.get("search_goal")) or None,
        "readerQuestions": reader_questions,
        "audienceHypothesis": audience,
        "categoryHypothesis": category,
        "keywordPlan": keyword_plan,
        "contentObjective": _text(raw.get("contentObjective") or raw.get("content_objective")) or None,
        "uncertainties": [_text(item) for item in _as_list(raw.get("uncertainties")) if _text(item)][:8],
        "marketingIntent": _normalize_marketing_intent(raw, catalogs),
    }


def _normalize_marketing_intent(raw: dict[str, Any], catalogs: dict[str, Any]) -> dict[str, Any]:
    source = raw.get("marketingIntent") if isinstance(raw.get("marketingIntent"), dict) else raw.get("marketing_intent")
    source = source if isinstance(source, dict) else {}
    knowledge = catalogs.get("marketingKnowledge") if isinstance(catalogs.get("marketingKnowledge"), dict) else {}
    customer = knowledge.get("customerContext") if isinstance(knowledge.get("customerContext"), dict) else {}
    problem = _text(source.get("customerProblem")) or _text((customer.get("problem") or {}).get("rawValue"))
    desire_raw = source.get("customerDesire")
    desire = _text(desire_raw) if desire_raw is not None else _text(((customer.get("desires") or [{}])[0] or {}).get("rawValue"))
    barrier = _text(source.get("customerBarrier")) or _text(((customer.get("barriers") or [{}])[0] or {}).get("rawValue"))
    refs = [_text(item) for item in _as_list(source.get("planningSourceRefs") or source.get("sourceRefs")) if _text(item)]
    return {
        "customerProblem": problem or None,
        "customerDesire": desire or None,
        "customerBarrier": barrier or None,
        "readerStateBefore": _text(source.get("readerStateBefore")) or None,
        "readerStateAfter": _text(source.get("readerStateAfter")) or None,
        "coreMarketingMessage": _text(source.get("coreMarketingMessage")) or None,
        "selectedAppeals": [_text(item) for item in _as_list(source.get("selectedAppeals")) if _text(item)],
        "brandRole": _text(source.get("brandRole")) or None,
        "productRole": _text(source.get("productRole")) or None,
        "desiredAction": _text(source.get("desiredAction")) or None,
        "planningSourceRefs": refs,
        "classification": "MODEL_DERIVED_PLANNING_INFERENCE",
        "readerFacing": False,
    }


def _normalize_content_plan(
    blog_context: dict[str, Any],
    raw: dict[str, Any],
    intent: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
) -> dict[str, Any]:
    titles = []
    for item in _as_list(raw.get("workingTitleCandidates") or raw.get("working_title_candidates"))[:3]:
        if not isinstance(item, dict):
            continue
        title = _text(item.get("title"))
        if not title:
            continue
        angle = _text(item.get("angle") or item.get("primaryIntent")).upper() or intent["primaryIntent"]
        titles.append(
            {
                "title": title,
                "angle": angle if angle in INTENT_VALUES else intent["primaryIntent"],
                "primaryIntent": _text(item.get("primaryIntent")).upper() if _text(item.get("primaryIntent")).upper() in INTENT_VALUES else intent["primaryIntent"],
            }
        )
    sections = _normalize_sections(raw, intent, catalogs, issues)
    faq_plan = _normalize_faq_plan(raw, catalogs, issues)
    comparison_plan = _as_list(raw.get("comparisonPlan") or raw.get("comparison_plan"))
    if intent["primaryIntent"] not in COMPARISON_INTENTS and not any(value in COMPARISON_INTENTS for value in intent["secondaryIntents"]):
        if comparison_plan:
            issues.append(_issue(CODE_SCHEMA_INVALID, "comparisonPlan is only allowed for comparison intents"))
        comparison_plan = []
    elif not catalogs["facts"]:
        comparison_plan = []
    normalized_comparison = []
    for item in comparison_plan:
        if isinstance(item, dict) and _text(item.get("axis") or item.get("topic")):
            refs = [_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)]
            if any(not _is_canonical_ref(ref, catalogs) for ref in refs):
                issues.append(_issue(CODE_INVALID_REFERENCE, "comparisonPlan has unknown sourceRefs", extra={"refs": refs}))
                continue
            if not refs:
                continue
            normalized_comparison.append(
                {
                    "axis": _text(item.get("axis") or item.get("topic")),
                    "sourceRefs": refs,
                    "status": "SUPPORTED",
                }
            )
    if intent["primaryIntent"] in COMPARISON_INTENTS and not normalized_comparison:
        # keep empty with warning in planningWarnings rather than inventing comparison facts
        pass

    image_needs = []
    for item in _as_list(raw.get("imageNeeds") or raw.get("image_needs")):
        if not isinstance(item, dict):
            continue
        section_id = _text(item.get("sectionId") or item.get("section_id"))
        if not section_id:
            continue
        image_needs.append(
            {
                "sectionId": section_id,
                "visualPurpose": _text(item.get("visualPurpose") or item.get("purpose")) or None,
                "preferredSource": _text(item.get("preferredSource")) or "REAL_PRODUCT_PHOTO",
                "status": _text(item.get("status")).upper() if _text(item.get("status")).upper() in IMAGE_NEED_STATUSES else "NEEDED",
            }
        )
    if not image_needs:
        image_needs = [
            {
                "sectionId": section["sectionId"],
                "visualPurpose": (section.get("imageNeed") or {}).get("visualPurpose"),
                "preferredSource": (section.get("imageNeed") or {}).get("preferredSource") or "REAL_PRODUCT_PHOTO",
                "status": (section.get("imageNeed") or {}).get("status") or "NEEDED",
            }
            for section in sections
            if isinstance(section.get("imageNeed"), dict)
        ]

    coverage = _normalize_coverage(raw, intent, sections, catalogs)
    core_answer = _text(raw.get("coreAnswer") or raw.get("core_answer")) or None
    if core_answer and _sentence_count(core_answer) > 4:
        issues.append(_issue(CODE_SCHEMA_INVALID, "coreAnswer must stay a 2-4 sentence planning summary"))
    if not catalogs["facts"] and not catalogs["allowedClaims"]:
        core_answer = None

    conclusion_raw = raw.get("conclusionPlan") if isinstance(raw.get("conclusionPlan"), dict) else raw.get("conclusion_plan")
    conclusion_raw = conclusion_raw if isinstance(conclusion_raw, dict) else {}
    cta_raw = raw.get("ctaPlan") if isinstance(raw.get("ctaPlan"), dict) else raw.get("cta_plan")
    cta_raw = cta_raw if isinstance(cta_raw, dict) else {}
    cta_type = _text(cta_raw.get("type")).upper() or "CHECK_PRODUCT_INFO"
    if cta_type not in CTA_TYPES:
        cta_type = "NONE"
    if not catalogs["facts"] and cta_type not in {"NONE", "READ_MORE"}:
        cta_type = "NONE"

    warnings = [_text(item) for item in _as_list(raw.get("planningWarnings") or raw.get("planning_warnings")) if _text(item)]
    if intent["primaryIntent"] in COMPARISON_INTENTS and not normalized_comparison:
        warnings.append("SOURCE_NOT_AVAILABLE_FOR_COMPARISON")
    if not catalogs["allowGeneralKnowledge"]:
        warnings.append("GENERAL_KNOWLEDGE_DISABLED")
    deduped_warnings: list[str] = []
    for item in warnings:
        if item not in deduped_warnings:
            deduped_warnings.append(item)
    warnings = deduped_warnings

    unsupported = []
    for item in _as_list(raw.get("unsupportedTopics") or raw.get("unsupported_topics")):
        if isinstance(item, dict) and _text(item.get("topic")):
            unsupported.append(
                {
                    "topic": _text(item.get("topic")),
                    "reason": _text(item.get("reason")) or "SOURCE_NOT_AVAILABLE",
                    "action": _text(item.get("action")) or "OMIT_OR_REQUEST_SOURCE",
                }
            )
    for term in catalogs["restrictedTerms"]:
        if term and not any(term in item["topic"] or term in item["reason"] for item in unsupported):
            unsupported.append(
                {
                    "topic": term,
                    "reason": "RESTRICTED_CLAIM_AND_NO_SUPPORTED_SOURCE",
                    "action": "DO_NOT_GENERATE_AS_FACT",
                }
            )
    if not catalogs["allowGeneralKnowledge"]:
        if not any("원료" in item["topic"] or "과학" in item["topic"] or "GENERAL_KNOWLEDGE" in item["reason"] for item in unsupported):
            unsupported.append(
                {
                    "topic": "source 밖 원료/효능/수치의 일반지식 보강",
                    "reason": "GENERAL_KNOWLEDGE_DISABLED",
                    "action": "OMIT_OR_REQUEST_SOURCE",
                }
            )

    return {
        "version": CONTENT_PLAN_VERSION,
        "workingTitleCandidates": titles,
        "coreQuestion": _text(raw.get("coreQuestion") or raw.get("core_question")) or None,
        "coreAnswer": core_answer,
        "readerBenefit": _text(raw.get("readerBenefit") or raw.get("reader_benefit")) or None,
        "sections": sections,
        "faqPlan": faq_plan,
        "comparisonPlan": normalized_comparison,
        "imageNeeds": image_needs,
        "conclusionPlan": {
            "summaryIntent": _text(conclusion_raw.get("summaryIntent") or conclusion_raw.get("summary")) or None,
            "judgmentCriteria": _text(conclusion_raw.get("judgmentCriteria") or conclusion_raw.get("criteria")) or None,
            "closingQuestion": _text(conclusion_raw.get("closingQuestion") or conclusion_raw.get("question")) or None,
        },
        "ctaPlan": {"type": cta_type, "intent": _text(cta_raw.get("intent")) or None},
        "coverage": coverage,
            "unsupportedTopics": unsupported,
            "planningWarnings": warnings,
            "contentTypeProfile": _normalize_content_type_profile(raw, intent),
            "marketingStrategy": _normalize_marketing_strategy(raw),
            "experiencePatterns": _normalize_experience_patterns(raw, catalogs, issues),
            "knowledgeUsePlan": _normalize_knowledge_use(raw.get("knowledgeUsePlan") or raw.get("knowledge_use_plan"), catalogs, issues),
            "brandUsePlan": _normalize_knowledge_use(raw.get("brandUsePlan") or raw.get("brand_use_plan"), catalogs, issues),
            "productValuePlan": _normalize_knowledge_use(raw.get("productValuePlan") or raw.get("product_value_plan"), catalogs, issues),
            "persuasionFlow": [_text(item) for item in _as_list(raw.get("persuasionFlow") or raw.get("persuasion_flow")) if _text(item)],
            "knowledgeGaps": _normalize_plan_knowledge_gaps(raw, catalogs),
        }


def _normalize_sections(
    raw: dict[str, Any],
    intent: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sections = []
    seen_ids: set[str] = set()
    for idx, item in enumerate(_as_list(raw.get("sections")), start=1):
        if not isinstance(item, dict):
            continue
        section_id = _text(item.get("sectionId") or item.get("section_id")) or f"S{idx}"
        if section_id in seen_ids:
            issues.append(_issue(CODE_SCHEMA_INVALID, f"duplicate sectionId: {section_id}"))
            section_id = f"S{idx}"
        seen_ids.add(section_id)
        facts_to_use = _normalize_fact_refs(item.get("factsToUse") or item.get("facts_to_use"), catalogs, issues)
        evidence_to_use = _normalize_evidence_refs(item.get("evidenceToUse") or item.get("evidence_to_use"), catalogs, issues)
        source_refs = [_text(ref) for ref in _as_list(item.get("sourceRefs") or item.get("source_refs")) if _text(ref)]
        image_raw = item.get("imageNeed") if isinstance(item.get("imageNeed"), dict) else item.get("image_need")
        image_raw = image_raw if isinstance(image_raw, dict) else {}
        avoid = [_text(value) for value in _as_list(item.get("claimsToAvoid") or item.get("claims_to_avoid")) if _text(value)]
        for term in catalogs["restrictedTerms"][:8]:
            if term and term not in avoid:
                avoid.append(term)
        brand_refs = _normalize_knowledge_id_list(item.get("brandKnowledgeRefs"), catalogs, issues, "brand")
        product_refs = _normalize_knowledge_id_list(item.get("productKnowledgeRefs"), catalogs, issues, "product")
        category_refs = _normalize_knowledge_id_list(item.get("categoryKnowledgeRefs"), catalogs, issues, "category")
        qualified_ids = {
            _text(entry.get("knowledgeId"))
            for entry in catalogs.get("categoryKnowledgeCatalog") or []
            if isinstance(entry, dict) and entry.get("knowledgeUsePolicy") == "QUALIFIED_EDUCATION_ONLY"
        }
        qualification_required = bool(item.get("qualificationRequired")) or any(ref in qualified_ids for ref in category_refs)
        sections.append(
            {
                "sectionId": section_id,
                "headingIntent": _text(item.get("headingIntent") or item.get("heading")) or None,
                "userQuestion": _text(item.get("userQuestion") or item.get("user_question")) or None,
                "purpose": _text(item.get("purpose")) or None,
                "contentType": _text(item.get("contentType") or item.get("content_type") or intent["primaryIntent"]) or intent["primaryIntent"],
                "factsToUse": facts_to_use,
                "evidenceToUse": evidence_to_use,
                "sourceRefs": source_refs,
                "marketingRole": _text(item.get("marketingRole") or item.get("marketing_role")).upper() or None,
                "brandKnowledgeRefs": brand_refs,
                "productKnowledgeRefs": product_refs,
                "categoryKnowledgeRefs": category_refs,
                "experiencePatternRefs": [_text(ref) for ref in _as_list(item.get("experiencePatternRefs")) if _text(ref)],
                "qualificationRequired": qualification_required,
                "customerValue": _text(item.get("customerValue")) or None,
                "productConnection": _text(item.get("productConnection")) or None,
                "claimBoundary": [_text(value) for value in _as_list(item.get("claimBoundary")) if _text(value)],
                "defensiveMetaExceptionReason": _text(item.get("defensiveMetaExceptionReason")).upper() or None,
                "inferencesAllowed": [_text(value) for value in _as_list(item.get("inferencesAllowed") or item.get("inferences_allowed")) if _text(value)],
                "claimsToAvoid": avoid,
                "imageNeed": {
                    "visualPurpose": _text(image_raw.get("visualPurpose") or image_raw.get("purpose")) or None,
                    "preferredSource": _text(image_raw.get("preferredSource")) or "REAL_PRODUCT_PHOTO",
                    "status": _text(image_raw.get("status")).upper() if _text(image_raw.get("status")).upper() in IMAGE_NEED_STATUSES else "NEEDED",
                },
                "riskNotes": [_text(value) for value in _as_list(item.get("riskNotes") or item.get("risk_notes")) if _text(value)],
                "narrativeFrame": "PAS" if intent["primaryIntent"] in PAS_INTENTS and idx == 1 else "EVIDENCE_FIRST",
            }
        )
    return sections


def _normalize_fact_refs(value: Any, catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(value):
        if isinstance(item, dict):
            fact_id = _text(item.get("factId") or item.get("fact_id") or item.get("id"))
        else:
            fact_id = _text(item)
        if not fact_id:
            continue
        if fact_id not in catalogs["factById"]:
            issues.append(_issue(CODE_INVALID_REFERENCE, "factsToUse references unknown factId", extra={"factId": fact_id}))
            continue
        fact = catalogs["factById"][fact_id]
        out.append({"factId": fact_id, "statement": fact.get("statement"), "sourceRef": fact.get("sourceRef")})
    return out


def _normalize_evidence_refs(value: Any, catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(value):
        if isinstance(item, dict):
            ref = _text(item.get("evidenceRef") or item.get("evidenceId") or item.get("id"))
            purpose = _text(item.get("purpose")) or None
            extra_keys = {key for key in item.keys() if key not in {"evidenceRef", "evidenceId", "id", "purpose"}}
            if extra_keys and not ref:
                issues.append(_issue(CODE_INVALID_REFERENCE, "evidenceToUse requires exact evidenceRef string", extra={"keys": sorted(extra_keys)}))
                continue
            if not ref:
                issues.append(_issue(CODE_INVALID_REFERENCE, "evidenceToUse requires exact evidenceRef string"))
                continue
        else:
            ref = _text(item)
            purpose = None
            if not ref:
                continue
        if ref not in catalogs["evidenceIds"]:
            issues.append(_issue(CODE_INVALID_REFERENCE, "evidenceToUse references unknown evidenceId", extra={"evidenceRef": ref}))
            continue
        out.append({"evidenceRef": ref, "purpose": purpose})
    return out


def _normalize_faq_plan(raw: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(raw.get("faqPlan") or raw.get("faq_plan"))[:5]:
        if not isinstance(item, dict):
            continue
        question = _text(item.get("question"))
        if not question:
            continue
        refs = [_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)]
        unknown = [ref for ref in refs if not _is_canonical_ref(ref, catalogs)]
        if unknown:
            issues.append(_issue(CODE_INVALID_REFERENCE, "faqPlan has unknown sourceRefs", extra={"refs": unknown}))
            status = "SOURCE_INSUFFICIENT"
            refs = [ref for ref in refs if _is_canonical_ref(ref, catalogs)]
        else:
            status = _text(item.get("status")).upper() if _text(item.get("status")).upper() in FAQ_STATUSES else ("SUPPORTED" if refs else "SOURCE_INSUFFICIENT")
        if not refs:
            status = "SOURCE_INSUFFICIENT"
        out.append(
            {
                "question": question,
                "answerIntent": _text(item.get("answerIntent") or item.get("answer_intent")) or None,
                "sourceRefs": refs,
                "status": status,
            }
        )
    return out


def _normalize_coverage(raw: dict[str, Any], intent: dict[str, Any], sections: list[dict[str, Any]], catalogs: dict[str, Any]) -> dict[str, Any]:
    coverage_raw = raw.get("coverage") if isinstance(raw.get("coverage"), dict) else {}
    questions = _as_list(coverage_raw.get("readerQuestions") or intent.get("readerQuestions"))
    section_ids = {section["sectionId"] for section in sections}
    out = []
    for item in questions:
        if isinstance(item, dict):
            question = _text(item.get("question"))
            covered_by = [_text(ref) for ref in _as_list(item.get("coveredBy")) if _text(ref)]
            status = _text(item.get("status")).upper()
        else:
            question = _text(item)
            covered_by = [section["sectionId"] for section in sections if question and question == _text(section.get("userQuestion"))]
            status = ""
        if not question:
            continue
        covered_by = [ref for ref in covered_by if ref in section_ids]
        if status not in COVERAGE_STATUSES:
            if covered_by and (catalogs["facts"] or catalogs["evidence"]):
                status = "COVERED"
            elif covered_by:
                status = "PARTIALLY_COVERED"
            elif not catalogs["facts"]:
                status = "SOURCE_INSUFFICIENT"
            else:
                status = "SOURCE_INSUFFICIENT"
        out.append({"question": question, "coveredBy": covered_by, "status": status})
    return {"readerQuestions": out}


def _is_canonical_ref(ref: str, catalogs: dict[str, Any]) -> bool:
    return bool(ref) and ref in catalogs.get("canonicalIds", set())


def _is_prefixed_or_labeled(ref: str) -> bool:
    return bool(re.match(r"^(review|evidence|brand|product|category|knowledge):", ref, flags=re.I)) or ref.endswith("-extra")


def _normalize_content_type_profile(raw: dict[str, Any], intent: dict[str, Any]) -> dict[str, Any]:
    value = _text(raw.get("contentTypeProfile") or raw.get("content_type_profile")).upper()
    if value in CONTENT_TYPE_PROFILES:
        return {"profile": value, "classification": "MODEL_DERIVED_PLANNING_INFERENCE"}
    mapped = {
        "HOW_TO": "HOW_TO",
        "BRAND_INFORMATION": "BRAND_STORY",
        "PROBLEM_SOLUTION": "PROBLEM_SOLUTION",
        "PRODUCT_REVIEW": "PRODUCT_GUIDE",
        "EXPERT_GUIDE": "INGREDIENT_EDUCATION",
        "TREND": "SEASONAL",
    }.get(intent.get("primaryIntent") or "")
    return {"profile": mapped or "PRODUCT_GUIDE", "classification": "MODEL_DERIVED_PLANNING_INFERENCE"}


def _normalize_marketing_strategy(raw: dict[str, Any]) -> dict[str, Any]:
    source = raw.get("marketingStrategy") if isinstance(raw.get("marketingStrategy"), dict) else raw.get("marketing_strategy")
    source = source if isinstance(source, dict) else {}
    return {
        "objective": _text(source.get("objective")) or None,
        "coreCustomerProblem": _text(source.get("coreCustomerProblem")) or None,
        "coreMarketingMessage": _text(source.get("coreMarketingMessage")) or None,
        "selectedProductStrengths": _normalize_strengths(source.get("selectedProductStrengths")),
        "selectedBrandStrengths": _normalize_strengths(source.get("selectedBrandStrengths")),
        "educationValue": _text(source.get("educationValue")) or None,
        "differentiationApproach": _text(source.get("differentiationApproach")) or None,
        "socialProofApproach": _text(source.get("socialProofApproach")) or None,
        "expectationManagement": _text(source.get("expectationManagement")) or None,
        "ctaIntent": _text(source.get("ctaIntent")) or None,
    }


def _normalize_strengths(value: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(value):
        if isinstance(item, dict) and _text(item.get("message")):
            out.append(
                {
                    "message": _text(item.get("message")),
                    "knowledgeRefs": [_text(ref) for ref in _as_list(item.get("knowledgeRefs")) if _text(ref)],
                    "factRefs": [_text(ref) for ref in _as_list(item.get("factRefs")) if _text(ref)],
                    "evidenceRefs": [_text(ref) for ref in _as_list(item.get("evidenceRefs")) if _text(ref)],
                }
            )
        elif _text(item):
            out.append({"message": _text(item), "knowledgeRefs": [], "factRefs": [], "evidenceRefs": []})
    return out


def _normalize_experience_patterns(raw: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    allowed_xp = catalogs.get("allowedExperiencePatternIds") or set()
    by_id = catalogs.get("experiencePatternById") or {}
    for idx, item in enumerate(_as_list(raw.get("experiencePatterns") or raw.get("experience_patterns")), start=1):
        if not isinstance(item, dict):
            continue
        pattern_id = _text(item.get("patternId")) or f"XP-{idx}"
        pattern_type = _text(item.get("patternType")) or "MODEL_DERIVED_FROM_EVIDENCE"
        is_corpus = pattern_type == "CORPUS_DERIVED_PATTERN" or pattern_id in allowed_xp
        if is_corpus:
            catalog_item = by_id.get(pattern_id)
            if not catalog_item:
                issues.append(_issue(CODE_INVALID_REFERENCE, "unknown experience pattern id", extra={"patternId": pattern_id}))
                continue
            catalog_support = catalog_item.get("support") if isinstance(catalog_item.get("support"), dict) else {}
            reps = [
                _text(ref)
                for ref in _as_list(
                    item.get("representativeEvidenceRefs")
                    or item.get("evidenceRefs")
                    or catalog_support.get("representativeEvidenceRefs")
                )
                if _text(ref)
            ]
            unknown = [ref for ref in reps if ref not in catalogs["evidenceIds"]]
            if unknown:
                issues.append(_issue(CODE_EXPERIENCE_PATTERN_INVALID, "experiencePattern references unknown evidence", extra={"refs": unknown}))
                continue
            matched = catalog_support.get("matchedReviewCount")
            if item.get("supportCount") is not None:
                try:
                    support_int = int(item.get("supportCount"))
                except (TypeError, ValueError):
                    support_int = -1
                if support_int == len(reps) and matched not in (None, support_int) and len(reps) != matched:
                    issues.append(
                        _issue(
                            CODE_EXPERIENCE_PATTERN_INVALID,
                            "representative evidence count must not replace matchedReviewCount",
                            extra={"supportCount": support_int, "matchedReviewCount": matched, "representativeCount": len(reps)},
                        )
                    )
                    continue
            out.append(
                {
                    "patternId": pattern_id,
                    "label": _text(item.get("label")) or _text(catalog_item.get("label")),
                    "interpretation": _text(item.get("interpretation")) or _text(catalog_item.get("interpretation")),
                    "evidenceRefs": reps,
                    "representativeEvidenceRefs": reps,
                    "support": {
                        "matchedReviewCount": matched,
                        "corpusReviewCount": catalog_support.get("corpusReviewCount"),
                        "representativeEvidenceRefs": reps,
                    },
                    "supportCount": matched,
                    "patternType": "CORPUS_DERIVED_PATTERN",
                    "claimBoundary": "CUSTOMER_EXPERIENCE_PATTERN",
                    "marketingUse": _text(item.get("marketingUse")) or None,
                }
            )
            continue
        refs = [_text(ref) for ref in _as_list(item.get("evidenceRefs")) if _text(ref)]
        unknown = [ref for ref in refs if ref not in catalogs["evidenceIds"]]
        if unknown:
            issues.append(_issue(CODE_EXPERIENCE_PATTERN_INVALID, "experiencePattern references unknown evidence", extra={"refs": unknown}))
            continue
        support = item.get("supportCount")
        if support is None:
            support = len(refs)
        try:
            support_int = int(support)
        except (TypeError, ValueError):
            support_int = -1
        if support_int != len(refs):
            issues.append(_issue(CODE_EXPERIENCE_PATTERN_INVALID, "supportCount must equal evidenceRefs count", extra={"supportCount": support, "evidenceRefs": refs}))
            continue
        out.append(
            {
                "patternId": pattern_id,
                "label": _text(item.get("label")) or None,
                "interpretation": _text(item.get("interpretation")) or None,
                "evidenceRefs": refs,
                "supportCount": support_int,
                "patternType": pattern_type or "MODEL_DERIVED_FROM_EVIDENCE",
                "marketingUse": _text(item.get("marketingUse")) or None,
            }
        )
    return out


def _normalize_knowledge_use(value: Any, catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(value):
        if isinstance(item, dict):
            ref = _text(item.get("knowledgeRef") or item.get("knowledgeId") or item.get("id"))
            use = _text(item.get("use") or item.get("purpose")) or None
        else:
            ref = _text(item)
            use = None
        if not ref:
            continue
        if _is_prefixed_or_labeled(ref) or ref not in catalogs.get("knowledgeIds", set()):
            issues.append(_issue(CODE_INVALID_REFERENCE, "unknown or labeled knowledgeRef", extra={"knowledgeRef": ref}))
            continue
        out.append({"knowledgeRef": ref, "use": use})
    return out


def _normalize_knowledge_id_list(value: Any, catalogs: dict[str, Any], issues: list[dict[str, Any]], kind: str) -> list[str]:
    allowed = {
        "brand": catalogs.get("brandById", {}),
        "product": catalogs.get("productById", {}),
        "category": catalogs.get("categoryById", {}),
    }.get(kind, {})
    out: list[str] = []
    for item in _as_list(value):
        ref = _text(item)
        if not ref:
            continue
        if _is_prefixed_or_labeled(ref) or ref not in allowed:
            issues.append(_issue(CODE_INVALID_REFERENCE, f"unknown {kind} knowledge id", extra={"ref": ref}))
            continue
        out.append(ref)
    return out


def _normalize_plan_knowledge_gaps(raw: dict[str, Any], catalogs: dict[str, Any]) -> list[dict[str, Any]]:
    existing = []
    knowledge = catalogs.get("marketingKnowledge") if isinstance(catalogs.get("marketingKnowledge"), dict) else {}
    for item in _as_list(knowledge.get("knowledgeGaps")):
        if isinstance(item, dict):
            copied = dict(item)
            copied["readerFacing"] = False
            existing.append(copied)
    seen = {_text(item.get("gapId") or item.get("topic")) for item in existing}
    for item in _as_list(raw.get("knowledgeGaps") or raw.get("knowledge_gaps")):
        if not isinstance(item, dict):
            continue
        key = _text(item.get("gapId") or item.get("topic"))
        if not key or key in seen:
            continue
        seen.add(key)
        existing.append(
            {
                "gapId": _text(item.get("gapId")) or key,
                "domain": _text(item.get("domain")) or "CATEGORY",
                "topic": _text(item.get("topic")) or key,
                "status": _text(item.get("status")) or "MISSING",
                "impact": _text(item.get("impact")) or None,
                "recommendedFutureSource": _text(item.get("recommendedFutureSource")) or None,
                "readerFacing": False,
            }
        )
    return existing


def _check_reference_integrity(plan: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    for section in _as_list(plan.get("sections")):
        for ref in _as_list(section.get("sourceRefs")):
            if not _is_canonical_ref(_text(ref), catalogs):
                issues.append(_issue(CODE_INVALID_REFERENCE, "section sourceRefs contains unknown reference", extra={"sectionId": section.get("sectionId"), "ref": ref}))


def _check_knowledge_references(plan: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    for item in _as_list(plan.get("knowledgeUsePlan")) + _as_list(plan.get("brandUsePlan")) + _as_list(plan.get("productValuePlan")):
        ref = _text(item.get("knowledgeRef") if isinstance(item, dict) else item)
        if ref and (ref.startswith("GK-") or CLASS_UNVERIFIED_GENERAL in ref):
            issues.append(_issue(CODE_GENERAL_KNOWLEDGE_LEAKAGE, "unverified general knowledge reference", extra={"ref": ref}))


def _check_experience_patterns(plan: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    known = {_text(item.get("patternId")) for item in _as_list(plan.get("experiencePatterns")) if isinstance(item, dict)}
    allowed_xp = catalogs.get("allowedExperiencePatternIds") or set()
    for section in _as_list(plan.get("sections")):
        for ref in _as_list(section.get("experiencePatternRefs")):
            value = _text(ref)
            if value not in known and value not in allowed_xp:
                issues.append(_issue(CODE_INVALID_REFERENCE, "unknown experience pattern id", extra={"ref": value}))
    for item in _as_list(plan.get("experiencePatterns")):
        if not isinstance(item, dict):
            continue
        interpretation = _text(item.get("interpretation") or item.get("label"))
        if any(term in interpretation for term in OVERCLAIM_TERMS) or interpretation.startswith("많은 고객들이 모두") or "모든 고객" in interpretation:
            issues.append(_issue(CODE_EXPERIENCE_PATTERN_INVALID, "experience pattern over-generalized", extra={"text": interpretation[:180]}))
        if item.get("patternType") == "CORPUS_DERIVED_PATTERN":
            support = item.get("support") if isinstance(item.get("support"), dict) else {}
            reps = _as_list(support.get("representativeEvidenceRefs") or item.get("representativeEvidenceRefs") or item.get("evidenceRefs"))
            matched = support.get("matchedReviewCount")
            if matched is not None and len(reps) == matched and matched not in (0, 1) and len(reps) <= 3 and matched > 3:
                issues.append(_issue(CODE_EXPERIENCE_PATTERN_INVALID, "representative count used as matchedReviewCount", extra={"matchedReviewCount": matched}))
            blob = f"{interpretation} {item.get('marketingUse') or ''}"
            if "효능" in blob and ("가진다" in blob or "효과가 있었다" in blob):
                issues.append(_issue(CODE_EXPERIENCE_PATTERN_INVALID, "corpus pattern used as product efficacy fact", extra={"text": blob[:180]}))


def _check_marketing_objective_fields(intent: dict[str, Any], plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    marketing = intent.get("marketingIntent") if isinstance(intent.get("marketingIntent"), dict) else {}
    strategy = plan.get("marketingStrategy") if isinstance(plan.get("marketingStrategy"), dict) else {}
    problem = _text(marketing.get("customerProblem") or strategy.get("coreCustomerProblem"))
    message = _text(marketing.get("coreMarketingMessage") or strategy.get("coreMarketingMessage"))
    action = _text(marketing.get("desiredAction") or strategy.get("ctaIntent") or (plan.get("ctaPlan") or {}).get("intent"))
    if not problem or not message or not action:
        issues.append(
            _issue(
                CODE_MARKETING_OBJECTIVE_INVALID,
                "marketingIntent requires customerProblem, coreMarketingMessage, and desiredAction",
                extra={"customerProblem": problem or None, "coreMarketingMessage": message or None, "desiredAction": action or None},
            )
        )


def _check_product_strength_grounding(plan: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    strategy = plan.get("marketingStrategy") if isinstance(plan.get("marketingStrategy"), dict) else {}
    for item in _as_list(strategy.get("selectedProductStrengths")) + _as_list(strategy.get("selectedBrandStrengths")):
        if not isinstance(item, dict):
            continue
        knowledge_ok = [ref for ref in _as_list(item.get("knowledgeRefs")) if ref in catalogs.get("knowledgeIds", set())]
        fact_ok = [ref for ref in _as_list(item.get("factRefs")) if ref in catalogs.get("canonicalIds", set())]
        evidence_ok = [ref for ref in _as_list(item.get("evidenceRefs")) if ref in catalogs.get("evidenceIds", set())]
        if _text(item.get("message")) and not (knowledge_ok or fact_ok or evidence_ok):
            issues.append(_issue(CODE_PRODUCT_STRENGTH_WITHOUT_SOURCE, "selected strength has no source", extra={"message": item.get("message")}))


def _check_unsupported_superiority(intent: dict[str, Any], plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    blobs = _collect_content_field_texts(intent, plan)
    strategy = plan.get("marketingStrategy") if isinstance(plan.get("marketingStrategy"), dict) else {}
    for item in _as_list(strategy.get("selectedProductStrengths")) + _as_list(strategy.get("selectedBrandStrengths")):
        if isinstance(item, dict):
            blobs.append(_text(item.get("message")))
    for blob in blobs:
        if any(term in blob for term in UNSUPPORTED_SUPERIORITY_TERMS):
            issues.append(_issue(CODE_UNSUPPORTED_SUPERIORITY, "unsupported superiority claim in planner prose", extra={"text": blob[:180]}))
            return


def _check_category_to_product_leap(plan: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    strategy = plan.get("marketingStrategy") if isinstance(plan.get("marketingStrategy"), dict) else {}
    category_ids = set(catalogs.get("categoryById", {}).keys())
    product_ids = set(catalogs.get("productById", {}).keys())
    brand_ids = set(catalogs.get("brandById", {}).keys())
    for item in _as_list(strategy.get("selectedProductStrengths")):
        if not isinstance(item, dict):
            continue
        krefs = [_text(ref) for ref in _as_list(item.get("knowledgeRefs")) if _text(ref)]
        facts = [_text(ref) for ref in _as_list(item.get("factRefs")) if _text(ref)]
        evidence = [_text(ref) for ref in _as_list(item.get("evidenceRefs")) if _text(ref)]
        only_category = bool(krefs) and all(ref in category_ids for ref in krefs) and not facts and not evidence and not any(ref in product_ids or ref in brand_ids for ref in krefs)
        message = _text(item.get("message"))
        if only_category and any(hint in message for hint in CATEGORY_PRODUCT_LEAP_HINTS):
            issues.append(_issue(CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP, "category knowledge used as product superiority", extra={"message": message[:180]}))
    for section in _as_list(plan.get("sections")):
        connection = _text(section.get("productConnection"))
        if connection and any(hint in connection for hint in CATEGORY_PRODUCT_LEAP_HINTS):
            cats = [_text(ref) for ref in _as_list(section.get("categoryKnowledgeRefs")) if _text(ref)]
            products = [_text(ref) for ref in _as_list(section.get("productKnowledgeRefs")) if _text(ref)]
            if cats and not products:
                issues.append(_issue(CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP, "category knowledge connected as product result guarantee", extra={"sectionId": section.get("sectionId")}))


def _check_category_used_as_product_strength(plan: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    strategy = plan.get("marketingStrategy") if isinstance(plan.get("marketingStrategy"), dict) else {}
    category_ids = set(catalogs.get("categoryById", {}).keys())
    product_ids = set(catalogs.get("productById", {}).keys())
    brand_ids = set(catalogs.get("brandById", {}).keys())
    for item in _as_list(strategy.get("selectedProductStrengths")):
        if not isinstance(item, dict):
            continue
        krefs = [_text(ref) for ref in _as_list(item.get("knowledgeRefs")) if _text(ref)]
        facts = [_text(ref) for ref in _as_list(item.get("factRefs")) if _text(ref)]
        evidence = [_text(ref) for ref in _as_list(item.get("evidenceRefs")) if _text(ref)]
        only_category = bool(krefs) and all(ref in category_ids for ref in krefs) and not facts and not evidence and not any(ref in product_ids or ref in brand_ids for ref in krefs)
        if only_category:
            issues.append(
                _issue(
                    CODE_CATEGORY_KNOWLEDGE_USED_AS_PRODUCT_STRENGTH,
                    "category knowledge cannot be the sole source of selectedProductStrengths",
                    extra={"message": _text(item.get("message"))[:180], "knowledgeRefs": krefs},
                )
            )


def _check_qualified_category_knowledge(plan: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    qualified_ids = {
        _text(item.get("knowledgeId"))
        for item in catalogs.get("categoryKnowledgeCatalog") or []
        if isinstance(item, dict) and (item.get("knowledgeUsePolicy") == "QUALIFIED_EDUCATION_ONLY" or item.get("qualificationRequired"))
    }
    if not qualified_ids:
        return
    unqualified_hints = (
        "반드시 특정 방식으로 결합",
        "모발 손상을 개선",
        "손상 모발을 치료",
        "발모에 좋",
        "임상적으로 더 오래",
        "무조건 덜 손상",
    )
    strategy = plan.get("marketingStrategy") if isinstance(plan.get("marketingStrategy"), dict) else {}
    for item in _as_list(strategy.get("selectedProductStrengths")):
        if not isinstance(item, dict):
            continue
        krefs = [_text(ref) for ref in _as_list(item.get("knowledgeRefs")) if _text(ref)]
        if any(ref in qualified_ids for ref in krefs):
            issues.append(
                _issue(
                    CODE_PARTIAL_EVIDENCE_QUALIFIER_LOST,
                    "qualified category knowledge used as unqualified product claim",
                    extra={"knowledgeRefs": krefs},
                )
            )
    for section in _as_list(plan.get("sections")):
        cats = [_text(ref) for ref in _as_list(section.get("categoryKnowledgeRefs")) if _text(ref)]
        if not any(ref in qualified_ids for ref in cats):
            continue
        blob = " ".join(
            [
                _text(section.get("headingIntent")),
                _text(section.get("purpose")),
                _text(section.get("productConnection")),
                _text(section.get("customerValue")),
            ]
        )
        if any(hint in blob for hint in unqualified_hints):
            issues.append(
                _issue(
                    CODE_PARTIAL_EVIDENCE_QUALIFIER_LOST,
                    "qualified category knowledge converted to unqualified consumer outcome",
                    extra={"sectionId": section.get("sectionId"), "text": blob[:180]},
                )
            )


def _check_defensive_meta_sections(plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    for section in _as_list(plan.get("sections")):
        if not isinstance(section, dict):
            continue
        reason = _text(section.get("defensiveMetaExceptionReason")).upper()
        blob = " ".join(
            [
                _text(section.get("headingIntent")),
                _text(section.get("userQuestion")),
                _text(section.get("purpose")),
                _text(section.get("customerValue")),
            ]
        )
        if any(pattern in blob for pattern in DEFENSIVE_META_PATTERNS):
            if reason in DEFENSIVE_META_EXCEPTIONS:
                continue
            issues.append(
                _issue(
                    CODE_DEFENSIVE_META_SECTION,
                    "reader-facing defensive meta section is not allowed",
                    extra={"sectionId": section.get("sectionId"), "text": blob[:180]},
                )
            )


def _contains_restricted(text: str, catalogs: dict[str, Any]) -> list[str]:
    blob = _text(text)
    hits = [term for term in catalogs["restrictedTerms"] if term and term in blob]
    hits.extend(hint for hint in RESTRICTED_BYPASS_HINTS if hint in blob and hint not in hits)
    return hits


def _collect_content_field_texts(intent: dict[str, Any], plan: dict[str, Any]) -> list[str]:
    texts: list[str] = [
        intent.get("searchGoal"),
        intent.get("contentObjective"),
        (intent.get("keywordPlan") or {}).get("primaryKeyword"),
        plan.get("coreAnswer"),
        plan.get("coreQuestion"),
        plan.get("readerBenefit"),
        (plan.get("ctaPlan") or {}).get("intent") if isinstance(plan.get("ctaPlan"), dict) else None,
    ]
    texts.extend(_as_list(intent.get("readerQuestions")))
    audience = intent.get("audienceHypothesis") if isinstance(intent.get("audienceHypothesis"), dict) else {}
    texts.extend([audience.get("primary"), audience.get("secondary")])
    keyword = intent.get("keywordPlan") if isinstance(intent.get("keywordPlan"), dict) else {}
    texts.extend(_as_list(keyword.get("relatedKeywords")))
    texts.extend(_as_list(keyword.get("subIntentKeywords")))
    texts.extend(item.get("title") for item in _as_list(plan.get("workingTitleCandidates")) if isinstance(item, dict))
    for section in _as_list(plan.get("sections")):
        if not isinstance(section, dict):
            continue
        texts.extend(
            [
                section.get("headingIntent"),
                section.get("userQuestion"),
                section.get("purpose"),
                section.get("customerValue"),
                section.get("productConnection"),
            ]
        )
        texts.extend(_as_list(section.get("inferencesAllowed")))
    marketing = intent.get("marketingIntent") if isinstance(intent.get("marketingIntent"), dict) else {}
    texts.extend(
        [
            marketing.get("customerProblem"),
            marketing.get("coreMarketingMessage"),
            marketing.get("readerStateBefore"),
            marketing.get("readerStateAfter"),
            marketing.get("brandRole"),
            marketing.get("productRole"),
        ]
    )
    strategy = plan.get("marketingStrategy") if isinstance(plan.get("marketingStrategy"), dict) else {}
    texts.extend(
        [
            strategy.get("objective"),
            strategy.get("coreMarketingMessage"),
            strategy.get("educationValue"),
            strategy.get("differentiationApproach"),
            strategy.get("socialProofApproach"),
            strategy.get("expectationManagement"),
            strategy.get("ctaIntent"),
        ]
    )
    for item in _as_list(plan.get("experiencePatterns")):
        if isinstance(item, dict):
            texts.extend([item.get("label"), item.get("interpretation"), item.get("marketingUse")])
    for item in _as_list(plan.get("faqPlan")):
        if isinstance(item, dict):
            texts.extend([item.get("question"), item.get("answerIntent")])
    conclusion = plan.get("conclusionPlan") if isinstance(plan.get("conclusionPlan"), dict) else {}
    texts.extend([conclusion.get("summaryIntent"), conclusion.get("judgmentCriteria"), conclusion.get("closingQuestion")])
    for item in _as_list(plan.get("comparisonPlan")):
        if isinstance(item, dict):
            texts.extend([item.get("axis"), item.get("topic")])
    return [_text(item) for item in texts if _text(item)]


def _check_restricted_leakage(
    intent: dict[str, Any],
    plan: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
) -> None:
    for blob in _collect_content_field_texts(intent, plan):
        hits = _contains_restricted(blob, catalogs)
        if hits:
            issues.append(_issue(CODE_RESTRICTED_CLAIM_LEAKAGE, "restricted claim leaked into planner prose", extra={"terms": hits, "text": blob[:180]}))


def _check_general_knowledge_boundary(
    blog_context: dict[str, Any],
    plan: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
) -> None:
    if catalogs["allowGeneralKnowledge"]:
        return
    known_statements = {_text(item.get("statement")) for item in catalogs["facts"]}
    known_statements.update(_text(item.get("claim")) for item in catalogs["allowedClaims"])
    known_statements.update(_text(item.get("statement")) for item in catalogs["evidence"])
    known_statements.update(catalogs.get("knowledgeStatements") or set())
    for item in catalogs.get("categoryKnowledgeCatalog") or []:
        if not isinstance(item, dict):
            continue
        known_statements.add(_text(item.get("statement")))
        known_statements.add(_text(item.get("topic")))
        known_statements.add(_text(item.get("scientificStatement")))
        interp = item.get("marketingInterpretation") if isinstance(item.get("marketingInterpretation"), dict) else {}
        known_statements.add(_text(interp.get("example")))
    category_blob = " ".join(sorted(item.lower() for item in known_statements if item))
    category_blob = category_blob.replace("wax esters", "wax ester").replace("왁스에스터", "왁스 에스터")
    token_aliases = {
        "로소니아": ("lawsonia", "로소니아"),
        "왁스 에스터": ("wax ester", "wax-ester", "왁스 에스터"),
        "lawsone": ("lawsone",),
    }
    invented = []
    for section in _as_list(plan.get("sections")):
        for inference in _as_list(section.get("inferencesAllowed")):
            text = _text(inference)
            if not text:
                continue
            if not any(token in text for token in ("로소니아", "왁스 에스터", "임상", "시험 성적", "%", "mg")):
                continue
            if any(text in known or known in text for known in known_statements if known):
                continue
            grounded = False
            for token, aliases in token_aliases.items():
                if token in text and any(alias in category_blob for alias in aliases):
                    grounded = True
                    break
            if grounded:
                continue
            invented.append(text)
    if invented:
        issues.append(_issue(CODE_GENERAL_KNOWLEDGE_LEAKAGE, "planner added source-external scientific claims", extra={"items": invented[:5]}))


def _check_not_finished_article(plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    blob = json.dumps(plan, ensure_ascii=False)
    if "## " in blob or "```" in blob or _sentence_count(str(plan.get("coreAnswer") or "")) > 6:
        issues.append(_issue(CODE_SCHEMA_INVALID, "planner output looks like a finished article"))
    for section in _as_list(plan.get("sections")):
        if _text(section.get("body") or section.get("draft") or section.get("paragraphs")):
            issues.append(_issue(CODE_SCHEMA_INVALID, "sections must not contain finished body copy"))


def _sentence_count(text: str) -> int:
    parts = [part.strip() for part in re.split(r"(?<=[\.。!?])\s+|\n+", _text(text)) if part.strip()]
    return len(parts) if parts else 0


def _fixture_planner_output(blog_context: dict[str, Any], catalogs: dict[str, Any]) -> dict[str, Any]:
    topic = catalogs["topic"] or "제품 사용 안내"
    problem = catalogs["audienceProblem"] or topic
    usable_fact_ids = [
        fact_id
        for fact_id, fact in catalogs["factById"].items()
        if _text(fact.get("statement")) not in {"상품명: 제품"}
    ]
    evidence_ids = sorted(catalogs["evidenceIds"])
    has_source = bool(usable_fact_ids)
    primary_intent = "HOW_TO" if has_source else "INFORMATION"
    audience_primary = "제품 사용 방법을 찾는 사람" if "사용" in f"{topic}{problem}" or has_source else "해당 주제를 검색한 사람"
    if "처음" in f"{topic}{problem}":
        audience_primary = "처음 사용하는 사람"
    if "건조" in f"{topic}{problem}":
        audience_primary = "건조한 모발 관리 방법을 찾는 사람"
    keyword = _text(catalogs["search"].get("primaryKeyword")) or (f"{topic} 방법" if topic else None)
    questions = [
        problem if problem else "무엇을 확인해야 하나?",
        "사용 전 무엇을 준비해야 하나?" if has_source else "확인 가능한 정보는 무엇인가?",
    ]
    if has_source:
        questions.append("사용 중 주의할 점은 무엇인가?")
    product_facts = [fid for fid, fact in catalogs["factById"].items() if fact.get("sourceType") == "PRODUCT_SOURCE" and fid in usable_fact_ids]
    detail_facts = [fid for fid, fact in catalogs["factById"].items() if fact.get("sourceType") == "DETAIL_PAGE_SOURCE"]
    insight_facts = [fid for fid, fact in catalogs["factById"].items() if fact.get("sourceType") == "INSIGHT_SOURCE"]
    section1_facts = insight_facts[:1] or product_facts[:1] or usable_fact_ids[:1]
    section2_facts = detail_facts[:2] or product_facts[1:3] or usable_fact_ids[:2]
    section3_facts = detail_facts[-1:] or product_facts[-1:] or usable_fact_ids[:1]
    unsupported = [
        {
            "topic": "source 밖 원료/효능/수치의 일반지식 보강",
            "reason": "GENERAL_KNOWLEDGE_DISABLED",
            "action": "OMIT_OR_REQUEST_SOURCE",
        }
    ]
    for term in catalogs["restrictedTerms"][:4]:
        unsupported.append(
            {
                "topic": term,
                "reason": "RESTRICTED_CLAIM_AND_NO_SUPPORTED_SOURCE",
                "action": "DO_NOT_GENERATE_AS_FACT",
            }
        )
    if not has_source:
        unsupported.insert(
            0,
            {
                "topic": "구체적인 사용 시간/효과/비교 정보",
                "reason": "SOURCE_NOT_AVAILABLE",
                "action": "OMIT_OR_REQUEST_SOURCE",
            },
        )
    core_answer = None
    if catalogs["allowedClaims"] and has_source:
        core_answer = (
            f"{catalogs['allowedClaims'][0]['claim']} 기준으로 확인할 수 있는 제품 특성과 고객 경험을 연결한다. "
            "source에 없는 효능이나 경험은 단정하지 않는다."
        )
    product_strengths = []
    if product_facts:
        first = catalogs["factById"].get(product_facts[0]) or {}
        pk = f"PK-{product_facts[0]}"
        product_strengths.append(
            {
                "message": _text(first.get("statement")) or "확인된 제품 정보",
                "knowledgeRefs": [pk] if pk in catalogs.get("knowledgeIds", set()) else [],
                "factRefs": [product_facts[0]],
                "evidenceRefs": [],
            }
        )
    education_ck_ids = [
        _text(item.get("knowledgeId"))
        for item in catalogs.get("categoryKnowledgeCatalog") or []
        if isinstance(item, dict)
        and _text(item.get("knowledgeId"))
        and item.get("knowledgeUsePolicy") != "QUALIFIED_EDUCATION_ONLY"
        and item.get("usableForProductClaim") is not True
    ][:3]
    experience_patterns = []
    if evidence_ids:
        experience_patterns.append(
            {
                "patternId": "XP-1",
                "label": "반복 관리와 사용 경험",
                "interpretation": "제공된 후기는 개별 사용 경험이며, 같은 고민을 가진 독자에게 참고가 될 수 있다.",
                "evidenceRefs": evidence_ids[:3],
                "supportCount": min(3, len(evidence_ids)),
                "patternType": "MODEL_DERIVED_FROM_EVIDENCE",
                "marketingUse": "SOCIAL_PROOF",
            }
        )
        experience_patterns[0]["supportCount"] = len(experience_patterns[0]["evidenceRefs"])
    corpus_patterns = catalogs.get("experiencePatternCatalog") or []
    corpus_refs: list[str] = []
    for item in corpus_patterns[:2]:
        if not isinstance(item, dict) or not _text(item.get("patternId")):
            continue
        reps = [_text(ref) for ref in _as_list(item.get("representativeEvidenceRefs")) if _text(ref)]
        experience_patterns.append(
            {
                "patternId": _text(item.get("patternId")),
                "label": _text(item.get("label")),
                "interpretation": _text(item.get("interpretation")),
                "evidenceRefs": reps,
                "representativeEvidenceRefs": reps,
                "support": {
                    "matchedReviewCount": item.get("matchedReviewCount"),
                    "corpusReviewCount": item.get("corpusReviewCount"),
                    "representativeEvidenceRefs": reps,
                },
                "patternType": "CORPUS_DERIVED_PATTERN",
                "marketingUse": "SOCIAL_PROOF",
            }
        )
        corpus_refs.append(_text(item.get("patternId")))
    knowledge = catalogs.get("marketingKnowledge") if isinstance(catalogs.get("marketingKnowledge"), dict) else {}
    customer = knowledge.get("customerContext") if isinstance(knowledge.get("customerContext"), dict) else {}
    problem_text = _text((customer.get("problem") or {}).get("rawValue")) or problem or topic
    desire_text = _text(((customer.get("desires") or [{}])[0] or {}).get("rawValue"))
    marketing_intent = {
        "customerProblem": problem_text,
        "customerDesire": desire_text or None,
        "customerBarrier": _text(((customer.get("barriers") or [{}])[0] or {}).get("rawValue")) or None,
        "readerStateBefore": f"{problem_text}에 대해 어떤 선택이 맞는지 확신이 부족하다" if problem_text else "제품 선택이 불확실하다",
        "readerStateAfter": "확인된 제품 특성과 실제 사용 경험을 이해하고 상세 정보를 볼 이유를 갖는다",
        "coreMarketingMessage": f"{problem_text}를 출발점으로, 확인된 제품 특성과 고객 경험을 연결한다" if problem_text else "확인된 정보로 선택 기준을 돕는다",
        "selectedAppeals": [_text(item.get("appealId")) for item in _as_list(blog_context.get("selectedAppealPoints")) if _text(item.get("appealId"))][:3],
        "brandRole": "확인된 브랜드 지식이 있을 때만 연결한다",
        "productRole": "확인된 제품 특성을 고객 고민과 연결한다",
        "desiredAction": "CHECK_PRODUCT_INFO" if has_source else "READ_MORE",
        "planningSourceRefs": (section1_facts + evidence_ids)[:6],
        "classification": "MODEL_DERIVED_PLANNING_INFERENCE",
    }
    sections = [
        {
            "sectionId": "S1",
            "headingIntent": "반복되는 고민이 생기는 이유",
            "userQuestion": questions[0],
            "purpose": "독자의 현재 고민에 공감하고 글이 도울 질문을 정한다",
            "contentType": primary_intent,
            "marketingRole": "EMPATHY",
            "factsToUse": section1_facts,
            "evidenceToUse": [{"evidenceRef": evidence_ids[0], "purpose": "독자 고민 보조"}] if evidence_ids else [],
            "sourceRefs": section1_facts,
            "productKnowledgeRefs": [f"PK-{fid}" for fid in section1_facts if f"PK-{fid}" in catalogs.get("knowledgeIds", set())],
            "experiencePatternRefs": ["XP-1"] if evidence_ids else [],
            "customerValue": "내 고민이 글의 출발점이라는 점을 이해한다",
            "productConnection": None,
            "inferencesAllowed": ["독자가 사용 방법을 확인하려는 상황으로 설계한다"],
            "claimsToAvoid": catalogs["restrictedTerms"][:6],
            "imageNeed": {"visualPurpose": "제품 확인", "preferredSource": "REAL_PRODUCT_PHOTO", "status": "NEEDED" if has_source else "OPTIONAL"},
            "riskNotes": ["source 밖 일반론으로 질문을 채우지 않는다"],
        },
        {
            "sectionId": "S2",
            "headingIntent": "확인된 제품 특성과 선택 기준",
            "userQuestion": questions[1],
            "purpose": "확인된 제품 지식과 필요한 범주 설명을 고객 고민과 연결한다",
            "contentType": "HOW_TO" if has_source else "INFORMATION",
            "marketingRole": "EDUCATION",
            "factsToUse": section2_facts if has_source else [],
            "evidenceToUse": [],
            "sourceRefs": section2_facts if has_source else [],
            "productKnowledgeRefs": [f"PK-{fid}" for fid in (section2_facts if has_source else []) if f"PK-{fid}" in catalogs.get("knowledgeIds", set())],
            "categoryKnowledgeRefs": education_ck_ids,
            "experiencePatternRefs": [],
            "qualificationRequired": False,
            "customerValue": "어떤 제품 특성과 범주 정보를 기준으로 보면 되는지 정리한다",
            "productConnection": "확인된 제품 특성을 선택 기준으로 연결한다" if has_source else None,
            "inferencesAllowed": [],
            "claimsToAvoid": catalogs["restrictedTerms"][:6],
            "imageNeed": {"visualPurpose": "사용 순서 설명", "preferredSource": "REAL_PRODUCT_PHOTO", "status": "NEEDED" if has_source else "NOT_NEEDED"},
            "riskNotes": ["확인되지 않은 시간/수치를 넣지 않는다"],
        },
        {
            "sectionId": "S3",
            "headingIntent": "실제 사용 경험에서 반복되는 포인트",
            "userQuestion": questions[-1],
            "purpose": "후기 패턴으로 기대치를 조정하고 다음 행동을 안내한다",
            "contentType": "INFORMATION",
            "marketingRole": "SOCIAL_PROOF",
            "factsToUse": section3_facts if has_source else [],
            "evidenceToUse": [],
            "sourceRefs": section3_facts if has_source else [],
            "experiencePatternRefs": (["XP-1"] if evidence_ids else []) + corpus_refs,
            "customerValue": "나와 비슷한 사용 맥락이 있는지 가늠한다",
            "productConnection": None,
            "inferencesAllowed": [],
            "claimsToAvoid": catalogs["restrictedTerms"][:6],
            "imageNeed": {"visualPurpose": "사용 경험 시각 자료", "preferredSource": "REAL_PRODUCT_PHOTO", "status": "OPTIONAL"},
            "riskNotes": ["restricted claim 우회 표현 금지"],
        },
    ]
    coverage_status = "COVERED" if has_source else "SOURCE_INSUFFICIENT"
    return {
        "intentAnalysis": {
            "primaryIntent": primary_intent,
            "secondaryIntents": ["INFORMATION", "PROBLEM_SOLUTION"] if has_source else ["UNKNOWN"],
            "searchGoal": f"{topic}에 대해 확인 가능한 정보를 찾는 것" if topic else "확인 가능한 정보 범위 파악",
            "readerQuestions": questions,
            "audienceHypothesis": {
                "primary": audience_primary,
                "secondary": None,
                "basis": [problem] if problem else ["TOPIC_DERIVED"],
                "classification": CLASSIFICATION_PLANNING_INFERENCE,
                "confidence": "MEDIUM",
            },
            "categoryHypothesis": {
                "category": "HOW_TO" if has_source else "BEAUTY_KNOWLEDGE",
                "classification": CLASSIFICATION_PLANNING_INFERENCE,
                "confidence": "MEDIUM",
            },
            "keywordPlan": {
                "primaryKeyword": keyword,
                "relatedKeywords": [item for item in [topic, "사용 방법", "주의사항"] if item][:4],
                "subIntentKeywords": ["준비", "사용 순서", "주의점"] if has_source else ["확인 범위"],
                "origin": ORIGIN_MODEL_DERIVED,
                "verifiedSearchData": False,
            },
            "contentObjective": "고객 고민과 확인된 제품 가치, 사용 경험을 연결하는 마케팅 콘텐츠 구조를 설계한다",
            "uncertainties": [item["field"] for item in _as_list(blog_context.get("unknowns"))][:6],
            "marketingIntent": marketing_intent,
        },
        "contentPlan": {
            "workingTitleCandidates": [
                {"title": f"{topic}이 부담될 때 먼저 볼 기준", "angle": "HOW_TO", "primaryIntent": primary_intent},
                {"title": f"{topic} 전 알아두면 좋은 선택 포인트", "angle": "EXPERT_GUIDE", "primaryIntent": "INFORMATION"},
                {"title": f"{problem[:18]} 때 확인하면 좋은 점" if problem else f"{topic} 선택 가이드", "angle": "PROBLEM_SOLUTION", "primaryIntent": "PROBLEM_SOLUTION"},
            ],
            "coreQuestion": questions[0],
            "coreAnswer": core_answer,
            "readerBenefit": "고민에 맞는 제품 특성과 실제 사용 경험을 구분해 볼 수 있다",
            "sections": sections,
            "faqPlan": [
                {
                    "question": questions[1],
                    "answerIntent": "확인된 사용/제품 지식을 기준으로 설명" if has_source else "확인된 정보가 부족하면 단정하지 않음",
                    "sourceRefs": section2_facts if has_source else [],
                    "status": "SUPPORTED" if has_source else "SOURCE_INSUFFICIENT",
                }
            ],
            "comparisonPlan": [],
            "imageNeeds": [
                {"sectionId": "S1", "visualPurpose": "제품 확인", "preferredSource": "REAL_PRODUCT_PHOTO", "status": "NEEDED" if has_source else "OPTIONAL"},
                {"sectionId": "S2", "visualPurpose": "사용 순서 설명", "preferredSource": "REAL_PRODUCT_PHOTO", "status": "NEEDED" if has_source else "NOT_NEEDED"},
            ],
            "conclusionPlan": {
                "summaryIntent": "고객 고민, 확인된 제품 특성, 사용 경험을 짧게 연결한다",
                "judgmentCriteria": "확인된 특성과 내 사용 상황이 맞는지 본다",
                "closingQuestion": "지금 가장 궁금한 사용 포인트는 무엇인가?",
            },
            "ctaPlan": {"type": "CHECK_PRODUCT_INFO" if has_source else "NONE", "intent": "공식 제품 정보 확인" if has_source else "READ_MORE"},
            "coverage": {
                "readerQuestions": [
                    {"question": questions[0], "coveredBy": ["S1"], "status": coverage_status},
                    {"question": questions[1], "coveredBy": ["S2"], "status": coverage_status},
                    {"question": questions[-1], "coveredBy": ["S3"], "status": coverage_status},
                ]
            },
            "unsupportedTopics": unsupported,
            "planningWarnings": ["GENERAL_KNOWLEDGE_DISABLED"] + ([] if has_source else ["SPARSE_SOURCE"]),
            "contentTypeProfile": "HOW_TO" if has_source else "PRODUCT_GUIDE",
            "marketingStrategy": {
                "objective": marketing_intent["coreMarketingMessage"],
                "coreCustomerProblem": problem_text,
                "coreMarketingMessage": marketing_intent["coreMarketingMessage"],
                "selectedProductStrengths": product_strengths,
                "selectedBrandStrengths": [],
                "educationValue": (
                    "확인된 범주 지식으로 제품 이해를 돕고, 제품 사용 정보는 별도 Product Knowledge로 연결한다"
                    if education_ck_ids
                    else "확인된 제품 지식 범위에서 선택 기준을 정리한다"
                ),
                "differentiationApproach": "Evidence-led product characteristics, not superiority claims",
                "socialProofApproach": (
                    "리뷰 코퍼스에서 확인된 언급 패턴을 개별 경험으로 연결한다"
                    if corpus_refs
                    else ("개별 후기를 사용 경험 패턴으로 묶는다" if experience_patterns else "후기가 없으면 경험을 만들지 않는다")
                ),
                "expectationManagement": "확인되지 않은 결과는 약속하지 않는다",
                "ctaIntent": marketing_intent["desiredAction"],
            },
            "experiencePatterns": experience_patterns,
            "knowledgeUsePlan": (
                [{"knowledgeRef": item, "use": "PRODUCT_RELEVANCE"} for item in catalogs.get("plannerReferenceCatalog", {}).get("allowedProductKnowledgeIds", [])[:3]]
                + [{"knowledgeRef": item, "use": "EDUCATION"} for item in education_ck_ids]
            ),
            "brandUsePlan": [],
            "productValuePlan": [{"knowledgeRef": item, "use": "DIFFERENTIATION"} for item in catalogs.get("plannerReferenceCatalog", {}).get("allowedProductKnowledgeIds", [])[:2]],
            "persuasionFlow": ["CUSTOMER_PROBLEM", "EMPATHY", "USEFUL_KNOWLEDGE", "PRODUCT_BRAND_RELEVANCE", "CUSTOMER_EXPERIENCE", "CTA"],
        },
    }
