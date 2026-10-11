from __future__ import annotations

import json
import os
import re
import copy
from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy.orm import Session

from content_blog_planner import CTA_TYPES, RESTRICTED_BYPASS_HINTS, STATUS_PASS, _catalogs
from content_blog_profiles import FAKE_EXPERIENCE_PHRASES, find_phrase_hits
from content_blog_writer_contract import (
    CODE_BRAND_FACT_FABRICATION,
    CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP,
    CODE_DEFENSIVE_META_LANGUAGE_LEAKAGE,
    CODE_INVALID_REFERENCE,
    CODE_MARKETING_OBJECTIVE_NOT_EXECUTED,
    CODE_PRODUCT_VALUE_NOT_COMMUNICATED,
    CODE_QUALIFIED_KNOWLEDGE_USED_WITHOUT_QUALIFIER,
    CODE_REVIEW_PATTERN_OVERCLAIM,
    CODE_UNSUPPORTED_SUPERIORITY,
    QUALIFIER_HINTS,
    WRITER_IDENTITY,
    WRITER_MODE,
    check_writer_marketing_contract,
    collect_used_knowledge,
    known_knowledge_blob,
    planned_knowledge_ids,
    qualified_category_ids,
)
from settings_store import get_api_settings


WRITER_VERSION = "blog_professional_writer_v1"
DRAFT_VERSION = "blog_professional_draft_v1"
WRITER_PROMPT_VERSION = "blog_professional_writer_prompt_v2"
WRITER_MODEL_DEFAULT = "gpt-5.5"
GENERATION_VERSION = "blog_v2"
SEO_KEYWORD_ORIGIN = "MODEL_DERIVED_CONTENT_KEYWORDS"

STATUS_HOLD = "HOLD"
STATUS_WRITER_FAILED = "WRITER_FAILED"

CODE_WRITER_FAILED = "WRITER_FAILED"
CODE_WRITER_OUTPUT_REJECTED = "WRITER_OUTPUT_REJECTED"
CODE_INVALID_SOURCE_REFERENCE = "INVALID_SOURCE_REFERENCE"
CODE_PLANNER_STRUCTURE_VIOLATION = "PLANNER_STRUCTURE_VIOLATION"
CODE_FAQ_BOUNDARY = "FAQ_BOUNDARY_VIOLATION"
CODE_FAKE_EXPERIENCE = "FAKE_EXPERIENCE_GENERATION"
CODE_RESTRICTED_CLAIM_LEAKAGE = "RESTRICTED_CLAIM_LEAKAGE"
CODE_GENERAL_KNOWLEDGE_LEAKAGE = "GENERAL_KNOWLEDGE_LEAKAGE"
CODE_SCHEMA_INVALID = "WRITER_SCHEMA_INVALID"

INTERNAL_TOKENS = (
    "PLANNING_INFERENCE",
    "MODEL_DERIVED",
    "FACT_SOURCE",
    "GENERAL_KNOWLEDGE",
    "sf_product_",
    "sf_detail_",
    "sf_insight_",
    "EV-full",
    "AP-full",
    "IN-full",
)

SCIENCE_LEAK_HINTS = ("로소니아", "로손", "lawsonia", "lawsone", "왁스 에스터", "wax ester", "임상 시험", "시험 성적", "단백질 공급")

HARD_SELL_CTA = ("지금 바로 구매", "놓치면 손해", "무조건 써보")


class BlogWriterError(RuntimeError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}:{message}" if message else code)
        self.code = code
        self.detail = message


def serialize_blog_professional_draft(draft: dict[str, Any]) -> str:
    return json.dumps(draft, ensure_ascii=False, sort_keys=True)


def visible_blog_draft_text(draft: dict[str, Any]) -> str:
    return _public_text(draft)


def clean_blog_v2_paragraph(value: Any) -> str:
    """Collapse intra-paragraph whitespace without joining separate paragraphs."""
    text = str(value or "").replace("\x00", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(line.split()) for line in text.split("\n")]
    return " ".join(line for line in lines if line).strip()


def preserve_blog_v2_paragraphs(value: Any) -> list[str]:
    if isinstance(value, list):
        items = value
    elif value is None:
        items = []
    else:
        items = re.split(r"\n\s*\n", str(value).replace("\r\n", "\n"))
    out: list[str] = []
    for item in items:
        paragraph = clean_blog_v2_paragraph(item)
        if paragraph:
            out.append(paragraph)
    return out


def to_legacy_blog_preview(draft: dict[str, Any]) -> dict[str, Any]:
    """Optional adapter for future editor display. Not used by production generate."""
    lead = draft.get("lead") if isinstance(draft.get("lead"), dict) else {}
    intro = "\n\n".join(
        preserve_blog_v2_paragraphs(
            [lead.get("problemHook"), lead.get("coreSummary"), lead.get("readerBenefit")]
        )
    )
    sections = []
    for section in draft.get("sections") or []:
        if not isinstance(section, dict):
            continue
        paragraphs = preserve_blog_v2_paragraphs(section.get("paragraphs"))
        sections.append(
            {
                "heading": section.get("heading"),
                "body": "\n\n".join(paragraphs),
                "paragraphs": paragraphs,
                "image": None,
                "image_status": section.get("imageStatus") or "PENDING",
            }
        )
    return {
        "title": draft.get("selectedTitle"),
        "title_candidates": [item.get("title") for item in draft.get("titleCandidates") or [] if isinstance(item, dict)],
        "intro": intro,
        "sections": sections,
        "faq": draft.get("faq") or [],
        "cta": (draft.get("cta") or {}).get("text"),
        "seo_keywords": draft.get("seoKeywords") or [],
    }


def write_blog_professional_draft(
    db: Session | None = None,
    *,
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any] | None = None,
    content_plan: dict[str, Any] | None = None,
    planner_result: dict[str, Any] | None = None,
    raw_draft: dict[str, Any] | None = None,
) -> dict[str, Any]:
    intent_analysis, content_plan = _resolve_plan_inputs(intent_analysis, content_plan, planner_result)
    catalogs = _catalogs(blog_context)
    try:
        raw = raw_draft if isinstance(raw_draft, dict) else _writer_raw_output(db, blog_context, intent_analysis, content_plan, catalogs)
    except BlogWriterError:
        raise
    except Exception as exc:
        raise BlogWriterError(CODE_WRITER_FAILED, str(exc)[:800]) from exc
    if not isinstance(raw, dict):
        raise BlogWriterError(CODE_WRITER_FAILED, "writer_json_not_object")
    return validate_blog_professional_draft(
        blog_context,
        intent_analysis,
        content_plan,
        raw,
        catalogs=catalogs,
        model=_active_writer_model(),
    )


def validate_blog_professional_draft(
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any],
    content_plan: dict[str, Any],
    raw: dict[str, Any],
    *,
    catalogs: dict[str, Any] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    catalogs = catalogs or _catalogs(blog_context)
    issues: list[dict[str, Any]] = []
    warnings: list[str] = [_text(item) for item in _as_list(raw.get("draftWarnings")) if _text(item)]
    draft = _normalize_draft(raw, intent_analysis, content_plan, catalogs, issues, warnings)
    public_text = _public_text(draft)
    _check_section_integrity(draft, content_plan, issues)
    _check_faq_boundary(draft, content_plan, issues)
    _check_source_references(draft, content_plan, catalogs, issues)
    _check_restricted_and_experience(public_text, catalogs, issues)
    _check_general_knowledge(public_text, catalogs, issues)
    _check_internal_tokens(public_text, issues)
    _check_title_preservation(draft, issues)
    check_writer_marketing_contract(
        draft=draft,
        public_text=public_text,
        content_plan=content_plan,
        intent_analysis=intent_analysis,
        catalogs=catalogs,
        issues=issues,
    )
    source_usage = _source_usage(draft, content_plan)
    draft["sourceUsage"] = source_usage
    draft["writerMode"] = WRITER_MODE
    draft["marketingExecution"] = _marketing_execution(draft, intent_analysis, content_plan, source_usage)
    draft["seoKeywordOrigin"] = SEO_KEYWORD_ORIGIN
    draft["writerProvenance"] = {
        "writerVersion": WRITER_VERSION,
        "generationVersion": GENERATION_VERSION,
        "plannerVersion": str(content_plan.get("version") or "blog_content_plan_v1"),
        "contextVersion": str(blog_context.get("version") or "blog_generation_context_v1"),
        "writerIdentity": WRITER_IDENTITY,
        "model": model or _active_writer_model(),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if source_usage.get("unusedPlannedFacts"):
        warnings.append("UNUSED_PLANNED_FACTS")
    if not catalogs["facts"]:
        warnings.append("SPARSE_SOURCE")
    if not content_plan.get("coreAnswer"):
        warnings.append("LIMITED_CORE_ANSWER")
    deduped: list[str] = []
    for item in warnings:
        if item and item not in deduped:
            deduped.append(item)
    draft["draftWarnings"] = deduped
    code = _primary_issue_code(issues)
    return {
        "status": STATUS_HOLD if code else STATUS_PASS,
        "code": code,
        "issues": issues,
        "draft": draft,
        "rawAccepted": code is None,
    }


def _resolve_plan_inputs(
    intent_analysis: dict[str, Any] | None,
    content_plan: dict[str, Any] | None,
    planner_result: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if isinstance(planner_result, dict):
        if planner_result.get("status") != STATUS_PASS:
            raise BlogWriterError(CODE_WRITER_FAILED, "planner_result_not_pass")
        intent_analysis = planner_result.get("intentAnalysis") if isinstance(planner_result.get("intentAnalysis"), dict) else intent_analysis
        content_plan = planner_result.get("contentPlan") if isinstance(planner_result.get("contentPlan"), dict) else content_plan
    if not isinstance(intent_analysis, dict) or not isinstance(content_plan, dict):
        raise BlogWriterError(CODE_WRITER_FAILED, "intent_analysis_and_content_plan_required")
    return intent_analysis, content_plan


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _issue(code: str, message: str, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    item = {"code": code, "message": message}
    if extra:
        item.update(extra)
    return item


def _primary_issue_code(issues: list[dict[str, Any]]) -> str | None:
    if not issues:
        return None
    priority = (
        CODE_INVALID_SOURCE_REFERENCE,
        CODE_INVALID_REFERENCE,
        CODE_PLANNER_STRUCTURE_VIOLATION,
        CODE_FAQ_BOUNDARY,
        CODE_FAKE_EXPERIENCE,
        CODE_RESTRICTED_CLAIM_LEAKAGE,
        CODE_GENERAL_KNOWLEDGE_LEAKAGE,
        CODE_QUALIFIED_KNOWLEDGE_USED_WITHOUT_QUALIFIER,
        CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP,
        CODE_UNSUPPORTED_SUPERIORITY,
        CODE_REVIEW_PATTERN_OVERCLAIM,
        CODE_BRAND_FACT_FABRICATION,
        CODE_DEFENSIVE_META_LANGUAGE_LEAKAGE,
        CODE_PRODUCT_VALUE_NOT_COMMUNICATED,
        CODE_MARKETING_OBJECTIVE_NOT_EXECUTED,
        CODE_WRITER_OUTPUT_REJECTED,
        CODE_SCHEMA_INVALID,
    )
    codes = [str(item.get("code") or "") for item in issues]
    for code in priority:
        if code in codes:
            return code
    return codes[0]


def _api_setting(db: Session, name: str) -> str:
    value = str(get_api_settings(db, [name]).get(name, "") or "").strip()
    return value or str(os.getenv(name) or "").strip()


def _active_writer_model() -> str:
    return str(os.getenv("CONTENT_WRITER_MODEL") or WRITER_MODEL_DEFAULT).strip()


def _writer_raw_output(
    db: Session | None,
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any],
    content_plan: dict[str, Any],
    catalogs: dict[str, Any],
) -> dict[str, Any]:
    if os.getenv("CONTENT_BLOG_WRITER_TEST_FIXTURE") == "1" or os.getenv("CONTENT_WRITER_TEST_FIXTURE") == "1":
        return _fixture_writer_output(blog_context, intent_analysis, content_plan, catalogs)
    if db is None:
        raise BlogWriterError(CODE_WRITER_FAILED, "writer_db_required_for_llm")
    return _call_writer_llm(db, blog_context, intent_analysis, content_plan, catalogs)


def _call_writer_llm(
    db: Session,
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any],
    content_plan: dict[str, Any],
    catalogs: dict[str, Any],
) -> dict[str, Any]:
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise BlogWriterError(CODE_WRITER_FAILED, "OPENAI_API_KEY not configured")
    model = _active_writer_model()
    payload: dict[str, Any] = {
        "model": model,
        "messages": _writer_messages(blog_context, intent_analysis, content_plan, catalogs),
        "response_format": {"type": "json_object"},
    }
    if model.startswith("gpt-5"):
        # Keep writer budget above planner; gpt-5.5 reasoning can consume several thousand tokens first.
        payload["max_completion_tokens"] = 16000
    else:
        payload["temperature"] = 0.3
        payload["max_tokens"] = 5000
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=300,
    )
    if int(resp.status_code) != 200:
        raise BlogWriterError(CODE_WRITER_FAILED, f"openai_writer_error:{resp.status_code}:{str(resp.text or '')[:800]}")
    content = (((resp.json() or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    try:
        parsed = json.loads(str(content).strip())
    except Exception as exc:
        raise BlogWriterError(CODE_WRITER_FAILED, "openai_writer_invalid_json") from exc
    if not isinstance(parsed, dict):
        raise BlogWriterError(CODE_WRITER_FAILED, "openai_writer_json_not_object")
    return parsed


def _writer_messages(
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any],
    content_plan: dict[str, Any],
    catalogs: dict[str, Any],
) -> list[dict[str, str]]:
    schema = {
        "titleCandidates": [{"title": "string", "angle": "HOW_TO"}],
        "selectedTitle": "string",
        "lead": {"problemHook": "string", "coreSummary": "string", "readerBenefit": "string"},
        "sections": [
            {
                "sectionId": "S1",
                "heading": "string",
                "paragraphs": ["string", "string"],
                "bullets": [],
                "sourceRefs": ["sf_..."],
                "evidenceRefs": [],
                "knowledgeUsage": {
                    "productKnowledgeRefs": [],
                    "brandKnowledgeRefs": [],
                    "categoryKnowledgeRefs": [],
                    "experiencePatternRefs": [],
                },
                "qualifiedKnowledgeUsage": [
                    {
                        "knowledgeRef": "CK-...",
                        "qualificationRequired": True,
                        "qualificationApplied": True,
                        "qualificationText": "일부 실험 조건에서는...",
                    }
                ],
                "imageStatus": "PENDING",
            }
        ],
        "faq": [{"question": "string", "answer": "string", "sourceRefs": []}],
        "conclusion": {"summaryPoints": ["string"], "actionGuidance": "string", "closingQuestion": "string"},
        "cta": {"type": "CHECK_PRODUCT_INFO", "text": "string"},
        "seoKeywords": ["string"],
        "draftWarnings": [],
        "writerMode": WRITER_MODE,
        "marketingExecution": {
            "coreMarketingMessage": "string",
            "customerProblemAddressed": "string",
            "productValueCommunicated": "string",
            "educationValueDelivered": "string",
            "socialProofUsed": "string",
            "ctaIntent": "string",
        },
    }
    knowledge = catalogs.get("marketingKnowledge") if isinstance(catalogs.get("marketingKnowledge"), dict) else {}
    return [
        {
            "role": "system",
            "content": (
                f"당신은 {WRITER_IDENTITY}다. 학술 논문 작성자도, 근거 없는 광고 카피라이터도 아니다. "
                "검증된 전문 Knowledge, 실제 제품 정보, 대규모 고객 경험, 소비자 Insight를 이용해 "
                "독자가 정보를 이해하고 공감하며 제품의 확인된 가치를 자연스럽게 이해하도록 쓴다. "
                "MARKETING DEFINES THE STORY. KNOWLEDGE PROVIDES THE SUBSTANCE. COMPLIANCE DEFINES THE BOUNDARY. "
                "흐름: 고객 고민/공감 → 유용한 전문 정보 → 제품 relevance → 고객 경험/소셜프루프 → 기대치 조정 → 자연스러운 설득 → CTA. "
                "FACTUAL CLAIM과 EDITORIAL/RHETORICAL BRIDGE를 구분한다. 공감, 전환, 질문, 요약, 독자 안내는 새 사실이 아니다. "
                "UNVERIFIED_GENERAL_KNOWLEDGE는 금지. 새 scientific/product/usage/인증 fact를 만들지 않는다. "
                "Category Knowledge는 원리와 선택 기준 교육에만 쓰고 수자타 고유 효능으로 바꾸지 않는다. "
                "DIRECT CK는 일반 교육에 사용할 수 있다. QUALIFIED CK는 본문에 실제 조건/해석 차이 qualifier를 넣어야 한다. "
                "논문명을 문단마다 나열하지 말고, 관련 연구에서는/주요 착색 성분으로 같이 쉽게 설명한다. "
                "내부 knowledgeGaps, unsupportedTopics, claimBoundary, planningWarnings를 독자에게 설명하지 않는다. "
                "현재 제공된 정보로 말할 수 있는 범위, 이 글에서 다룰 수 있는 정보, 제공된 정보 기준, 상품URL에서 직접 확인 같은 defensive meta를 본문에 쓰지 않는다. "
                "승인된 Product Knowledge가 있으면 회피하지 말고 적극적으로 설명한다. Brand Knowledge가 없으면 브랜드 철학/인증/역사를 만들지 않는다. 제품명에 수자타를 쓰는 것은 가능하다. "
                "Corpus pattern은 리뷰에서 반복적으로 언급됩니다 계열로 쓰고, 대부분/압도적/80% 같은 인구 과장을 하지 않는다. 가상 후기를 만들지 않는다. "
                "Planner heading/purpose를 그대로 복사하지 말고 독자 문장으로 다시 쓴다. FAQ는 내부 데이터 설명이 아니라 독자 질문이어야 한다. "
                "CTA는 확인된 제품 특성과 사용 경험으로 안내하되 지금 바로 구매/놓치면 후회 같은 강매를 쓰지 않는다. "
                "sectionId는 Planner와 동일해야 한다. 본문에 sf_, EV-, PK-, CK-, XP-, AP- 식별자를 쓰지 않는다. "
                "JSON만 반환한다."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "task": "Write one Evidence-Based Marketing blog draft from the approved plan and verified knowledge.",
                    "writerMode": WRITER_MODE,
                    "blogGenerationContext": _writer_safe_context(blog_context),
                    "intentAnalysis": intent_analysis,
                    "contentPlan": content_plan,
                    "categoryKnowledgeCatalog": catalogs.get("categoryKnowledgeCatalog") or [],
                    "productKnowledge": list((catalogs.get("productById") or {}).values())[:20],
                    "experiencePatternCatalog": catalogs.get("experiencePatternCatalog") or [],
                    "validFactIds": list(catalogs["factById"].keys()),
                    "validEvidenceIds": sorted(catalogs["evidenceIds"]),
                    "allowedProductKnowledgeIds": list((catalogs.get("plannerReferenceCatalog") or {}).get("allowedProductKnowledgeIds") or []),
                    "allowedCategoryKnowledgeIds": list((catalogs.get("plannerReferenceCatalog") or {}).get("allowedCategoryKnowledgeIds") or []),
                    "allowedExperiencePatternIds": list((catalogs.get("plannerReferenceCatalog") or {}).get("allowedExperiencePatternIds") or []),
                    "restrictedTerms": catalogs["restrictedTerms"],
                    "allowGeneralKnowledge": False,
                    "brandKnowledgePresent": bool((knowledge.get("brandKnowledge") or [])),
                    "required_output_schema": schema,
                },
                ensure_ascii=False,
            ),
        },
    ]


def _writer_safe_context(blog_context: dict[str, Any]) -> dict[str, Any]:
    safe = copy.deepcopy(blog_context)
    knowledge = safe.get("marketingKnowledge") if isinstance(safe.get("marketingKnowledge"), dict) else {}
    # Keep claim boundaries for compliance. Strip only process-facing dump fields that models copy into prose.
    for key in ("planningWarnings",):
        knowledge.pop(key, None)
    return safe


def _marketing_execution(
    draft: dict[str, Any],
    intent_analysis: dict[str, Any],
    content_plan: dict[str, Any],
    source_usage: dict[str, Any],
) -> dict[str, Any]:
    existing = draft.get("marketingExecution") if isinstance(draft.get("marketingExecution"), dict) else {}
    marketing = intent_analysis.get("marketingIntent") if isinstance(intent_analysis.get("marketingIntent"), dict) else {}
    strategy = content_plan.get("marketingStrategy") if isinstance(content_plan.get("marketingStrategy"), dict) else {}
    used = collect_used_knowledge(draft)

    def pick(key: str, fallback: str) -> str | None:
        return _text(existing.get(key)) or fallback or None

    return {
        "coreMarketingMessage": pick("coreMarketingMessage", _text(marketing.get("coreMarketingMessage") or strategy.get("coreMarketingMessage"))),
        "customerProblemAddressed": pick("customerProblemAddressed", _text(marketing.get("customerProblem") or strategy.get("coreCustomerProblem"))),
        "productValueCommunicated": pick("productValueCommunicated", ", ".join(used["product"][:8]) or _text(source_usage.get("productKnowledgeUsed"))),
        "educationValueDelivered": pick("educationValueDelivered", ", ".join(used["category"][:8])),
        "socialProofUsed": pick("socialProofUsed", ", ".join(used["experience"][:8])),
        "ctaIntent": pick("ctaIntent", _text((draft.get("cta") or {}).get("type") or (content_plan.get("ctaPlan") or {}).get("type"))),
    }


def _knowledge_bucket(ref: str) -> str | None:
    if ref.startswith("PK-"):
        return "productKnowledgeRefs"
    if ref.startswith("BK-"):
        return "brandKnowledgeRefs"
    if ref.startswith("CK-"):
        return "categoryKnowledgeRefs"
    if ref.startswith("XP-"):
        return "experiencePatternRefs"
    return None


def _split_refs(refs: list[str]) -> tuple[list[str], list[str], dict[str, list[str]]]:
    source_refs: list[str] = []
    evidence_refs: list[str] = []
    usage: dict[str, list[str]] = {
        "productKnowledgeRefs": [],
        "brandKnowledgeRefs": [],
        "categoryKnowledgeRefs": [],
        "experiencePatternRefs": [],
    }
    for ref in refs:
        value = _text(ref)
        if not value:
            continue
        bucket = _knowledge_bucket(value)
        if bucket:
            if value not in usage[bucket]:
                usage[bucket].append(value)
            continue
        if value.startswith("EV-") or value.startswith("AP-"):
            if value not in evidence_refs:
                evidence_refs.append(value)
            continue
        if value not in source_refs:
            source_refs.append(value)
    return source_refs, evidence_refs, usage


def _merge_usage(base: dict[str, list[str]], extra: dict[str, list[str]]) -> dict[str, list[str]]:
    out = {
        "productKnowledgeRefs": list(base.get("productKnowledgeRefs") or []),
        "brandKnowledgeRefs": list(base.get("brandKnowledgeRefs") or []),
        "categoryKnowledgeRefs": list(base.get("categoryKnowledgeRefs") or []),
        "experiencePatternRefs": list(base.get("experiencePatternRefs") or []),
    }
    for key, values in extra.items():
        for ref in values:
            if ref and ref not in out[key]:
                out[key].append(ref)
    return out


def _knowledge_ref_list(value: Any) -> list[str]:
    out: list[str] = []
    for item in _as_list(value):
        ref = _text(item.get("knowledgeRef") or item.get("knowledgeId") or item.get("patternId") if isinstance(item, dict) else item)
        if ref and ref not in out:
            out.append(ref)
    return out


def _normalize_knowledge_usage(item: dict[str, Any], planned: dict[str, Any]) -> dict[str, Any]:
    usage_raw = item.get("knowledgeUsage") if isinstance(item.get("knowledgeUsage"), dict) else {}

    def merge(key: str) -> list[str]:
        values = _knowledge_ref_list(usage_raw.get(key)) + _knowledge_ref_list(item.get(key))
        out: list[str] = []
        for ref in values:
            if ref and ref not in out:
                out.append(ref)
        return out

    return {
        "productKnowledgeRefs": merge("productKnowledgeRefs"),
        "brandKnowledgeRefs": merge("brandKnowledgeRefs"),
        "categoryKnowledgeRefs": merge("categoryKnowledgeRefs"),
        "experiencePatternRefs": merge("experiencePatternRefs"),
    }


def _normalize_qualified_usage(item: dict[str, Any]) -> list[dict[str, Any]]:
    raw = item.get("qualifiedKnowledgeUsage")
    if not isinstance(raw, list):
        usage = item.get("knowledgeUsage") if isinstance(item.get("knowledgeUsage"), dict) else {}
        raw = usage.get("qualifiedKnowledge") if isinstance(usage.get("qualifiedKnowledge"), list) else []
    out: list[dict[str, Any]] = []
    for record in raw:
        if not isinstance(record, dict):
            continue
        ref = _text(record.get("knowledgeRef"))
        if not ref:
            continue
        out.append(
            {
                "knowledgeRef": ref,
                "qualificationRequired": bool(record.get("qualificationRequired", True)),
                "qualificationApplied": bool(record.get("qualificationApplied")),
                "qualificationText": _text(record.get("qualificationText")) or None,
            }
        )
    return out


def _normalize_draft(
    raw: dict[str, Any],
    intent_analysis: dict[str, Any],
    content_plan: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    planned_titles = content_plan.get("workingTitleCandidates") if isinstance(content_plan.get("workingTitleCandidates"), list) else []
    title_candidates = []
    for item in _as_list(raw.get("titleCandidates") or raw.get("title_candidates")):
        if isinstance(item, dict) and _text(item.get("title")):
            title_candidates.append(
                {
                    "title": _text(item.get("title")),
                    "angle": _text(item.get("angle")) or None,
                    "primaryIntent": _text(item.get("primaryIntent") or intent_analysis.get("primaryIntent")) or None,
                }
            )
        elif _text(item):
            title_candidates.append({"title": _text(item), "angle": None, "primaryIntent": intent_analysis.get("primaryIntent")})
    if not title_candidates:
        for item in planned_titles:
            if isinstance(item, dict) and _text(item.get("title")):
                title_candidates.append(
                    {
                        "title": _text(item.get("title")),
                        "angle": _text(item.get("angle")) or None,
                        "primaryIntent": _text(item.get("primaryIntent")) or intent_analysis.get("primaryIntent"),
                    }
                )
                warnings.append("TITLE_CANDIDATES_FALLBACK_TO_PLAN")
    selected = _text(raw.get("selectedTitle") or raw.get("selected_title"))
    if not selected and title_candidates:
        selected = title_candidates[0]["title"]
    lead_raw = raw.get("lead") if isinstance(raw.get("lead"), dict) else {}
    core_answer = _text(content_plan.get("coreAnswer"))
    lead = {
        "problemHook": clean_blog_v2_paragraph(lead_raw.get("problemHook") or content_plan.get("coreQuestion")),
        "coreSummary": clean_blog_v2_paragraph(lead_raw.get("coreSummary") or core_answer or "확인된 제품 특성과 실제 사용 경험을 함께 살펴보면 선택 기준이 더 분명해집니다."),
        "readerBenefit": clean_blog_v2_paragraph(lead_raw.get("readerBenefit") or content_plan.get("readerBenefit")),
    }
    planned_sections = {str(item.get("sectionId")): item for item in _as_list(content_plan.get("sections")) if isinstance(item, dict)}
    sections = []
    for item in _as_list(raw.get("sections")):
        if not isinstance(item, dict):
            continue
        section_id = _text(item.get("sectionId") or item.get("section_id"))
        if not section_id:
            issues.append(_issue(CODE_SCHEMA_INVALID, "sectionId is required"))
            continue
        if section_id not in planned_sections:
            issues.append(_issue(CODE_PLANNER_STRUCTURE_VIOLATION, "writer created a section not in the plan", extra={"sectionId": section_id}))
            continue
        planned = planned_sections[section_id]
        paragraphs = preserve_blog_v2_paragraphs(item.get("paragraphs") or item.get("body"))
        if not paragraphs:
            issues.append(_issue(CODE_SCHEMA_INVALID, "section paragraphs are required", extra={"sectionId": section_id}))
        usage = _normalize_knowledge_usage(item, planned)
        source_refs, evidence_from_source, usage_from_source = _split_refs(
            [_text(ref) for ref in _as_list(item.get("sourceRefs") or item.get("source_refs")) if _text(ref)]
            + [_text(ref) for ref in _as_list(item.get("evidenceRefs") or item.get("evidence_refs")) if _text(ref)]
        )
        usage = _merge_usage(usage, usage_from_source)
        evidence_refs = list(evidence_from_source)
        sections.append(
            {
                "sectionId": section_id,
                "heading": _text(item.get("heading") or planned.get("headingIntent") or planned.get("userQuestion")),
                "paragraphs": paragraphs,
                "bullets": [clean_blog_v2_paragraph(value) for value in _as_list(item.get("bullets")) if clean_blog_v2_paragraph(value)],
                "sourceRefs": source_refs,
                "evidenceRefs": evidence_refs,
                "knowledgeUsage": usage,
                "qualifiedKnowledgeUsage": _normalize_qualified_usage(item),
                "imageStatus": "PENDING",
            }
        )
    conclusion_raw = raw.get("conclusion") if isinstance(raw.get("conclusion"), dict) else {}
    cta_raw = raw.get("cta") if isinstance(raw.get("cta"), dict) else {}
    planned_cta = content_plan.get("ctaPlan") if isinstance(content_plan.get("ctaPlan"), dict) else {}
    cta_type = _text(cta_raw.get("type") or planned_cta.get("type")).upper() or "NONE"
    if cta_type not in CTA_TYPES:
        cta_type = "NONE"
    cta_text = _text(cta_raw.get("text"))
    if any(token in cta_text for token in HARD_SELL_CTA):
        issues.append(_issue(CODE_WRITER_OUTPUT_REJECTED, "hard-sell CTA is not allowed"))
        cta_text = _text(planned_cta.get("intent"))
    faq = _normalize_faq(raw, content_plan, issues)
    seo = [_text(item) for item in _as_list(raw.get("seoKeywords") or raw.get("seo_keywords")) if _text(item)]
    if not seo:
        keyword_plan = intent_analysis.get("keywordPlan") if isinstance(intent_analysis.get("keywordPlan"), dict) else {}
        seo = [_text(keyword_plan.get("primaryKeyword"))] if _text(keyword_plan.get("primaryKeyword")) else []
        seo.extend(_text(item) for item in _as_list(keyword_plan.get("relatedKeywords")) if _text(item))
    return {
        "version": DRAFT_VERSION,
        "titleCandidates": title_candidates,
        "selectedTitle": selected,
        "lead": lead,
        "sections": sections,
        "faq": faq,
        "conclusion": {
            "summaryPoints": [clean_blog_v2_paragraph(item) for item in _as_list(conclusion_raw.get("summaryPoints")) if clean_blog_v2_paragraph(item)],
            "actionGuidance": clean_blog_v2_paragraph(conclusion_raw.get("actionGuidance") or (content_plan.get("conclusionPlan") or {}).get("judgmentCriteria")),
            "closingQuestion": clean_blog_v2_paragraph(conclusion_raw.get("closingQuestion") or (content_plan.get("conclusionPlan") or {}).get("closingQuestion")),
        },
        "cta": {"type": cta_type, "text": cta_text or None},
        "seoKeywords": seo[:8],
    }


def _normalize_faq(raw: dict[str, Any], content_plan: dict[str, Any], issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = {
        _text(item.get("question")): item
        for item in _as_list(content_plan.get("faqPlan"))
        if isinstance(item, dict) and _text(item.get("question")) and _text(item.get("status")).upper() == "SUPPORTED"
    }
    max_count = len(allowed)
    out = []
    for item in _as_list(raw.get("faq")):
        if not isinstance(item, dict):
            continue
        question = _text(item.get("question"))
        if not question:
            continue
        exact = question in allowed
        rephrase_ok = (not exact) and max_count > 0 and len(out) < max_count
        if not exact and not rephrase_ok:
            issues.append(_issue(CODE_FAQ_BOUNDARY, "FAQ is outside faqPlan", extra={"question": question}))
            continue
        source_refs, evidence_refs, _usage = _split_refs([_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)])
        out.append(
            {
                "question": question,
                "answer": clean_blog_v2_paragraph(item.get("answer")),
                "sourceRefs": source_refs + evidence_refs,
            }
        )
    return out


def _check_section_integrity(draft: dict[str, Any], content_plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    planned_ids = [str(item.get("sectionId")) for item in _as_list(content_plan.get("sections")) if isinstance(item, dict)]
    written_ids = [str(item.get("sectionId")) for item in _as_list(draft.get("sections"))]
    extra = [section_id for section_id in written_ids if section_id not in planned_ids]
    if extra:
        issues.append(_issue(CODE_PLANNER_STRUCTURE_VIOLATION, "writer added unplanned sections", extra={"sectionIds": extra}))
    if len(written_ids) != len(set(written_ids)):
        issues.append(_issue(CODE_SCHEMA_INVALID, "duplicate sectionId in writer output"))


def _check_faq_boundary(draft: dict[str, Any], content_plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    allowed = {
        _text(item.get("question"))
        for item in _as_list(content_plan.get("faqPlan"))
        if isinstance(item, dict) and _text(item.get("status")).upper() == "SUPPORTED"
    }
    faq = [item for item in _as_list(draft.get("faq")) if _text(item.get("question"))]
    extra = [item for item in faq if _text(item.get("question")) not in allowed]
    if extra and len(faq) > len(allowed):
        issues.append(_issue(CODE_FAQ_BOUNDARY, "FAQ question is not in supported faqPlan"))


def _section_allowed_refs(planned: dict[str, Any]) -> set[str]:
    allowed = set()
    for item in _as_list(planned.get("factsToUse")):
        if isinstance(item, dict):
            allowed.update(filter(None, [_text(item.get("factId")), _text(item.get("sourceRef"))]))
        else:
            allowed.add(_text(item))
    for item in _as_list(planned.get("evidenceToUse")):
        if isinstance(item, dict):
            allowed.add(_text(item.get("evidenceRef") or item.get("evidenceId")))
        else:
            allowed.add(_text(item))
    allowed.update(_text(ref) for ref in _as_list(planned.get("sourceRefs")))
    allowed.update(_knowledge_ref_list(planned.get("productKnowledgeRefs")))
    allowed.update(_knowledge_ref_list(planned.get("categoryKnowledgeRefs")))
    allowed.update(_knowledge_ref_list(planned.get("brandKnowledgeRefs")))
    allowed.update(_knowledge_ref_list(planned.get("experiencePatternRefs")))
    return {item for item in allowed if item}


def _check_source_references(
    draft: dict[str, Any],
    content_plan: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
) -> None:
    planned_by_id = {str(item.get("sectionId")): item for item in _as_list(content_plan.get("sections")) if isinstance(item, dict)}
    valid = set(catalogs["sourceRefs"]) | set(catalogs["factById"].keys()) | set(catalogs["evidenceIds"])
    for section in _as_list(draft.get("sections")):
        planned = planned_by_id.get(str(section.get("sectionId"))) or {}
        allowed = _section_allowed_refs(planned)
        for ref in _as_list(section.get("sourceRefs")) + _as_list(section.get("evidenceRefs")):
            if ref not in valid:
                issues.append(_issue(CODE_INVALID_SOURCE_REFERENCE, "unknown source reference", extra={"ref": ref, "sectionId": section.get("sectionId")}))
            elif allowed and ref not in allowed and ref not in catalogs["factById"] and ref not in catalogs["evidenceIds"]:
                issues.append(_issue(CODE_INVALID_SOURCE_REFERENCE, "source reference is not allocated to this section", extra={"ref": ref, "sectionId": section.get("sectionId")}))
            elif allowed and ref not in allowed:
                # Fact/evidence exists globally but was not allocated to this section.
                issues.append(_issue(CODE_INVALID_SOURCE_REFERENCE, "source reference is not allocated to this section", extra={"ref": ref, "sectionId": section.get("sectionId")}))
    for item in _as_list(draft.get("faq")):
        for ref in _as_list(item.get("sourceRefs")):
            if ref not in valid:
                issues.append(_issue(CODE_INVALID_SOURCE_REFERENCE, "FAQ unknown source reference", extra={"ref": ref}))


def _public_text(draft: dict[str, Any]) -> str:
    parts: list[Any] = [
        draft.get("selectedTitle"),
        *[item.get("title") for item in _as_list(draft.get("titleCandidates"))],
        *list((draft.get("lead") or {}).values()),
        *[section.get("heading") for section in _as_list(draft.get("sections"))],
        *[paragraph for section in _as_list(draft.get("sections")) for paragraph in _as_list(section.get("paragraphs"))],
        *[bullet for section in _as_list(draft.get("sections")) for bullet in _as_list(section.get("bullets"))],
        *[item.get("question") for item in _as_list(draft.get("faq"))],
        *[item.get("answer") for item in _as_list(draft.get("faq"))],
        *list((draft.get("conclusion") or {}).get("summaryPoints") or []),
        (draft.get("conclusion") or {}).get("actionGuidance"),
        (draft.get("conclusion") or {}).get("closingQuestion"),
        (draft.get("cta") or {}).get("text"),
    ]
    return "\n".join(_text(part) for part in parts if part)


def _check_restricted_and_experience(public_text: str, catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    for term in catalogs["restrictedTerms"]:
        if term and term in public_text:
            issues.append(_issue(CODE_RESTRICTED_CLAIM_LEAKAGE, "restricted claim leaked into draft", extra={"term": term}))
    for hint in RESTRICTED_BYPASS_HINTS:
        if hint in public_text:
            issues.append(_issue(CODE_RESTRICTED_CLAIM_LEAKAGE, "restricted claim bypass leaked into draft", extra={"term": hint}))
    for phrase in find_phrase_hits(public_text, FAKE_EXPERIENCE_PHRASES):
        issues.append(_issue(CODE_FAKE_EXPERIENCE, "unsupported personal experience generated", extra={"phrase": phrase}))


def _check_general_knowledge(public_text: str, catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    if catalogs["allowGeneralKnowledge"]:
        return
    known = known_knowledge_blob(catalogs)
    for hint in SCIENCE_LEAK_HINTS:
        if hint in public_text and hint.lower() not in known:
            issues.append(_issue(CODE_GENERAL_KNOWLEDGE_LEAKAGE, "source-external scientific claim generated", extra={"term": hint}))


def _check_internal_tokens(public_text: str, issues: list[dict[str, Any]]) -> None:
    for token in INTERNAL_TOKENS:
        if token in public_text:
            issues.append(_issue(CODE_WRITER_OUTPUT_REJECTED, "internal metadata leaked into public copy", extra={"token": token}))
    if (
        re.search(r"\bEV-[A-Za-z0-9-]+", public_text)
        or re.search(r"\bAP-[A-Za-z0-9-]+", public_text)
        or re.search(r"\bCK-[A-Za-z0-9-]+", public_text)
        or re.search(r"\bPK-[A-Za-z0-9-]+", public_text)
        or re.search(r"\bXP-[A-Za-z0-9-]+", public_text)
    ):
        issues.append(_issue(CODE_WRITER_OUTPUT_REJECTED, "internal evidence/appeal id leaked into public copy"))


def _check_title_preservation(draft: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    if not draft.get("selectedTitle"):
        issues.append(_issue(CODE_SCHEMA_INVALID, "selectedTitle is required"))
    if not draft.get("titleCandidates"):
        issues.append(_issue(CODE_SCHEMA_INVALID, "titleCandidates must be preserved"))


def _source_usage(draft: dict[str, Any], content_plan: dict[str, Any]) -> dict[str, Any]:
    used = collect_used_knowledge(draft)
    facts_used: list[str] = list(used["facts"])
    evidence_used: list[str] = list(used["evidence"])
    planned_facts: list[str] = []
    for section in _as_list(content_plan.get("sections")):
        for item in _as_list(section.get("factsToUse")):
            fact_id = _text(item.get("factId") if isinstance(item, dict) else item)
            if fact_id and fact_id not in planned_facts:
                planned_facts.append(fact_id)
    unused = [fact_id for fact_id in planned_facts if fact_id not in facts_used]
    return {
        "factsUsed": facts_used,
        "evidenceUsed": evidence_used,
        "unusedPlannedFacts": unused,
        "unsupportedFactGenerated": False,
        "productKnowledgeUsed": list(used["product"]),
        "brandKnowledgeUsed": list(used["brand"]),
        "categoryKnowledgeUsed": list(used["category"]),
        "experiencePatternsUsed": list(used["experience"]),
    }


def _planned_fact_ids(planned: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for item in _as_list(planned.get("factsToUse")) + _as_list(planned.get("sourceRefs")):
        fact_id = _text(item.get("factId") or item.get("sourceRef") if isinstance(item, dict) else item)
        if fact_id and fact_id not in ids:
            ids.append(fact_id)
    return ids


def _safe_statement(text: str, restricted: list[str]) -> str:
    value = _text(text)
    if not value:
        return ""
    blocked = list(restricted) + [
        "함량이 높아",
        "염색력이 우수",
        "시중 최고",
        "압도적",
        "대부분 고객",
        "임상 시험",
        "시험 성적",
        "단백질 공급",
        "자연주의 철학",
        "유기농 원료만",
    ]
    if any(term and term in value for term in blocked):
        return ""
    if len(value) > 180:
        value = value[:180].rstrip()
    return value.replace(".", " ").replace(";", " ").strip()


def _fixture_writer_output(
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any],
    content_plan: dict[str, Any],
    catalogs: dict[str, Any],
) -> dict[str, Any]:
    has_source = bool([item for item in catalogs["facts"] if _text(item.get("statement")) not in {"상품명: 제품"}])
    titles = []
    for item in _as_list(content_plan.get("workingTitleCandidates"))[:3]:
        if isinstance(item, dict) and _text(item.get("title")):
            title = _text(item.get("title"))
            if any(token in title for token in ("말할 수 있는", "확인할 수 있는 범위", "보기 전 체크할 점")):
                title = f"{_text(blog_context.get('topic')) or '제품'} 고민과 확인된 사용 기준"
            titles.append({"title": title, "angle": item.get("angle"), "primaryIntent": item.get("primaryIntent")})
    if not titles:
        titles = [{"title": _text(blog_context.get("topic")) or "반복되는 관리 고민과 제품 선택 기준", "angle": intent_analysis.get("primaryIntent"), "primaryIntent": intent_analysis.get("primaryIntent")}]
    marketing = intent_analysis.get("marketingIntent") if isinstance(intent_analysis.get("marketingIntent"), dict) else {}
    problem = _text(
        marketing.get("customerProblem")
        or content_plan.get("coreQuestion")
        or blog_context.get("audienceProblem")
        or "반복되는 관리가 신경 쓰일 수 있습니다."
    )
    core = _text(content_plan.get("coreAnswer") or marketing.get("coreMarketingMessage"))
    if not core:
        core = (
            "확인된 제품 특성과 실제 사용 경험을 함께 보면, 지금 필요한 선택 기준이 더 분명해집니다."
            if has_source
            else "지금은 확인된 사용 맥락을 중심으로 다음 선택에 도움이 되는 질문만 정리합니다."
        )
    benefit = _text(content_plan.get("readerBenefit") or "이 글을 읽으면 고민과 제품 특성, 실제 사용 경험을 연결해 볼 수 있습니다.")
    qualified_ids = qualified_category_ids(catalogs)
    sections = []
    for planned in _as_list(content_plan.get("sections")):
        if not isinstance(planned, dict):
            continue
        fact_ids = _planned_fact_ids(planned)
        fact_lines = []
        for fact_id in fact_ids:
            statement = _safe_statement((catalogs["factById"].get(fact_id) or {}).get("statement"), catalogs["restrictedTerms"])
            if statement:
                fact_lines.append(statement)
        evidence_note = ""
        evidence_refs = []
        for item in _as_list(planned.get("evidenceToUse")):
            ref = _text(item.get("evidenceRef") if isinstance(item, dict) else item)
            if ref:
                evidence_refs.append(ref)
        if evidence_refs and catalogs["evidence"]:
            snippet = _safe_statement(catalogs["evidence"][0].get("statement"), catalogs["restrictedTerms"])
            if snippet:
                evidence_note = f"실제 사용자 경험 중에는 '{snippet}'와 같은 반응이 확인됩니다."
        product_refs = _knowledge_ref_list(planned.get("productKnowledgeRefs"))
        brand_refs = _knowledge_ref_list(planned.get("brandKnowledgeRefs"))
        category_refs = _knowledge_ref_list(planned.get("categoryKnowledgeRefs"))
        experience_refs = _knowledge_ref_list(planned.get("experiencePatternRefs"))
        role = _text(planned.get("marketingRole")).upper()
        heading = {
            "EMPATHY": "반복되는 고민, 어디서부터 보면 좋을까",
            "EDUCATION": "선택 전에 알아두면 좋은 기본 원리",
            "PRODUCT_RELEVANCE": "실제 제품을 볼 때 확인할 점",
            "SOCIAL_PROOF": "실제 사용자들이 자주 말한 경험",
            "EXPECTATION_SETTING": "기대치를 어떻게 맞출까",
            "CTA": "다음으로 비교해 보면 좋은 포인트",
        }.get(role) or _text(planned.get("userQuestion") or planned.get("headingIntent") or "선택 기준을 정리하면")
        used_qualified = [ref for ref in category_refs if ref in qualified_ids]
        qualifier = "일부 실험 조건에서는 해석의 차이가 있어 일반 효능으로 단정하지 않습니다."
        if role == "EMPATHY" or (not has_source and role != "SOCIAL_PROOF"):
            paragraphs = [
                "반복되는 관리 고민이 생기면 색만 고르기 전에 기준을 먼저 살펴볼 수 있습니다.",
                "제품 특성과 실제 사용 경험을 함께 보면 선택 기준을 이해할 수 있습니다.",
            ]
            if has_source:
                paragraphs.append("확인된 제품 정보와 후기를 연결하면 다음 선택을 준비할 수 있습니다.")
        elif role == "EDUCATION":
            paragraphs = [
                "제품을 고를 때 색이나 향만 보면 기준이 흔들릴 수 있습니다.",
                "카테고리의 작동 방식을 먼저 정리하면 제품 비교가 더 분명해질 수 있습니다.",
            ]
            for ref in category_refs[:1]:
                item = (catalogs.get("categoryById") or {}).get(ref) or {}
                statement = _safe_statement(item.get("statement") or item.get("topic"), catalogs["restrictedTerms"])
                if statement:
                    if ref in qualified_ids:
                        paragraphs.append(f"{qualifier} {statement}")
                    else:
                        paragraphs.append(f"관련 연구에서는 {statement} 점을 참고할 수 있습니다.")
            if fact_lines and len(paragraphs) < 3:
                paragraphs.append(f"실제 제품을 볼 때는 {fact_lines[0]}를 확인할 수 있습니다.")
        elif role in {"PRODUCT_RELEVANCE", "CTA"} or (has_source and not category_refs and fact_lines and role != "SOCIAL_PROOF"):
            paragraphs = ["그렇다면 실제 제품을 볼 때 확인할 점을 정리할 수 있습니다."]
            if fact_lines:
                paragraphs.append(f"{fact_lines[0]}를 공식 안내에서 확인할 수 있습니다.")
            first_pk = (catalogs.get("productById") or {}).get(product_refs[0]) if product_refs else {}
            pk_statement = _safe_statement((first_pk or {}).get("statement"), catalogs["restrictedTerms"])
            if pk_statement and len(paragraphs) < 3:
                paragraphs.append(f"{pk_statement} 점도 함께 볼 수 있습니다.")
            elif len(paragraphs) < 3:
                paragraphs.append("확인된 제품 특성과 공식 사용 안내를 기준으로 비교할 수 있습니다.")
        else:
            paragraphs = [
                "실제 사용자들이 반복해서 말하는 경험을 함께 볼 수 있습니다.",
                "리뷰에서 반복적으로 언급되는 반응이 있습니다.",
            ]
            if evidence_note:
                paragraphs.append(evidence_note if evidence_note.endswith("습니다.") or evidence_note.endswith("습니다") else evidence_note.rstrip(".") + " 점이 있습니다.")
            elif fact_lines:
                paragraphs.append(f"{fact_lines[0]}와 함께 보면 기대치를 조정할 수 있습니다.")
        target_len = 3 if has_source else 2
        if used_qualified and not any(hint in " ".join(paragraphs) for hint in QUALIFIER_HINTS):
            if len(paragraphs) >= target_len:
                paragraphs[target_len - 1] = qualifier
            else:
                paragraphs.append(qualifier)
        if len(paragraphs) > target_len:
            paragraphs = paragraphs[:target_len]
        while len(paragraphs) < target_len:
            paragraphs.append("확인된 특성과 사용 경험을 함께 보면 다음 선택이 더 분명해질 수 있습니다.")
        qualified_usage = [
            {
                "knowledgeRef": ref,
                "qualificationRequired": True,
                "qualificationApplied": True,
                "qualificationText": "일부 실험 조건에서는",
            }
            for ref in used_qualified
        ]
        sections.append(
            {
                "sectionId": planned.get("sectionId"),
                "heading": heading,
                "paragraphs": paragraphs,
                "bullets": fact_lines[2:3],
                "sourceRefs": fact_ids,
                "evidenceRefs": evidence_refs,
                "knowledgeUsage": {
                    "productKnowledgeRefs": product_refs,
                    "brandKnowledgeRefs": brand_refs,
                    "categoryKnowledgeRefs": category_refs,
                    "experiencePatternRefs": experience_refs,
                },
                "qualifiedKnowledgeUsage": qualified_usage,
                "imageStatus": "PENDING",
            }
        )
    faq = []
    for item in _as_list(content_plan.get("faqPlan")):
        if not isinstance(item, dict) or _text(item.get("status")).upper() != "SUPPORTED":
            continue
        refs = [_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)]
        statements = []
        for ref in refs:
            fact = catalogs["factById"].get(ref)
            if fact:
                statements.append(_text(fact.get("statement")))
        answer = "처음 사용할 때는 공식 사용 안내와 실제 후기에서 반복되는 포인트를 함께 보면 됩니다."
        if statements:
            answer = f"{statements[0]}를 기준으로 공식 사용 안내와 후기를 비교할 수 있습니다."
        faq.append({"question": _text(item.get("question")), "answer": answer, "sourceRefs": refs})
    cta_type = _text((content_plan.get("ctaPlan") or {}).get("type")).upper() or "NONE"
    product_name = _text(blog_context.get("topic")) or "이 제품"
    cta_text = {
        "CHECK_PRODUCT_INFO": f"관리 방식과 사용 경험이 맞는지 보고 있다면, {product_name}의 공식 사용법과 실제 구매자 후기를 비교해 보세요.",
        "APPLY_GUIDE": "확인된 사용 순서와 본인 상황을 맞춰 본 뒤 공식 안내를 다시 살펴보세요.",
        "READ_MORE": "비슷한 고민을 가진 사용 경험과 공식 안내를 더 살펴보세요.",
        "ASK_EXPERIENCE": "사용 전 궁금한 점은 공식 안내와 반복되는 후기 포인트를 기준으로 확인해 보세요.",
        "NONE": None,
    }.get(cta_type)
    keyword_plan = intent_analysis.get("keywordPlan") if isinstance(intent_analysis.get("keywordPlan"), dict) else {}
    return {
        "titleCandidates": titles,
        "selectedTitle": titles[0]["title"],
        "lead": {"problemHook": problem, "coreSummary": core, "readerBenefit": benefit},
        "sections": sections,
        "faq": faq,
        "conclusion": {
            "summaryPoints": [
                "고객 고민과 확인된 제품 특성, 실제 사용 경험을 함께 보면 선택 기준을 이해할 수 있습니다.",
                "확인되지 않은 효과는 약속하지 않고 본인 상황에 맞는지를 기준으로 볼 수 있습니다.",
            ],
            "actionGuidance": _text((content_plan.get("conclusionPlan") or {}).get("judgmentCriteria")) or "공식 사용 안내와 반복되는 후기 포인트를 기준으로 비교할 수 있습니다.",
            "closingQuestion": _text((content_plan.get("conclusionPlan") or {}).get("closingQuestion")) or "지금 가장 중요한 기준은 무엇인가요?",
        },
        "cta": {"type": cta_type, "text": cta_text},
        "seoKeywords": [_text(keyword_plan.get("primaryKeyword"))] + [_text(item) for item in _as_list(keyword_plan.get("relatedKeywords")) if _text(item)],
        "draftWarnings": [] if has_source else ["SPARSE_SOURCE"],
        "writerMode": WRITER_MODE,
        "marketingExecution": {
            "coreMarketingMessage": _text(marketing.get("coreMarketingMessage")),
            "customerProblemAddressed": problem,
            "productValueCommunicated": "confirmed product characteristics" if has_source else "",
            "educationValueDelivered": "category education when verified knowledge exists",
            "socialProofUsed": "corpus or review patterns when planned",
            "ctaIntent": cta_type,
        },
    }
