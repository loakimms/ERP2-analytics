from __future__ import annotations

import copy
import hashlib
from datetime import datetime, timezone
from typing import Any

from content_blog_experience_patterns import build_review_corpus_profile, planner_pattern_payload
from content_blog_knowledge_library import (
    DOMAIN_EXPERIENCE,
    DOMAIN_INSIGHT,
    FUTURE_INTERNAL_SOURCE,
    LIBRARY_VERSION,
    SUBTYPE_MARKETING,
    SUBTYPE_METADATA,
    SUBTYPE_TECHNICAL,
    SUBTYPE_USAGE,
)
from content_blog_research_requests import build_research_request_candidates
from content_blog_usage_guide import ingest_usage_guide
from content_blog_verified_category_ingest import (
    load_category_knowledge_for_product,
    product_from_contexts,
)


MARKETING_KNOWLEDGE_VERSION = "blog_marketing_knowledge_v1"
KNOWLEDGE_REQUIREMENT_GAP_VERSION = "BLOG_KNOWLEDGE_REQUIREMENT_GAP_V1"

CLASS_APPROVED_BRAND = "APPROVED_BRAND_KNOWLEDGE"
CLASS_APPROVED_PRODUCT = "APPROVED_PRODUCT_KNOWLEDGE"
CLASS_VERIFIED_CATEGORY = "VERIFIED_CATEGORY_KNOWLEDGE"
CLASS_SOURCE_DERIVED_INFERENCE = "SOURCE_DERIVED_INFERENCE"
CLASS_UNVERIFIED_GENERAL = "UNVERIFIED_GENERAL_KNOWLEDGE"

STATUS_SOURCE_GROUNDED = "SOURCE_GROUNDED"
STATUS_PARTIAL = "PARTIAL"
STATUS_UNKNOWN = "UNKNOWN"
STATUS_AVAILABLE = "AVAILABLE"
STATUS_MISSING = "MISSING"
STATUS_INFERENCE = "INFERENCE"
STATUS_VERIFIED = "VERIFIED"
STATUS_SOURCE_CONFIRMED = "SOURCE_CONFIRMED"

OBJECTIVE_TYPE = "BRAND_PRODUCT_MARKETING"

PLANNING_PRIORITY = (
    "CUSTOMER_PROBLEM_DESIRE",
    "SEARCH_INTENT",
    "MARKETING_OBJECTIVE",
    "PRODUCT_BRAND_APPEAL",
    "PROFESSIONAL_INFORMATION_VALUE",
    "DIFFERENTIATION",
    "CUSTOMER_EXPERIENCE_SOCIAL_PROOF",
    "PERSUASIVE_CONTENT_FLOW",
    "CTA_DESIRED_ACTION",
)

GUARDRAILS = (
    "FACT_INTEGRITY",
    "SOURCE_TRACEABILITY",
    "CLAIM_SAFETY",
    "COMPLIANCE",
    "NO_FABRICATED_EXPERIENCE",
    "NO_UNSUPPORTED_SUPERIORITY",
)


def build_blog_marketing_knowledge(
    *,
    blog_context: dict[str, Any],
    base_context: dict[str, Any] | None = None,
    appeal: dict[str, Any] | None = None,
    db: Any = None,
) -> dict[str, Any]:
    """Deterministic marketing knowledge from existing sources. Does not invent facts or call LLMs."""
    base = base_context if isinstance(base_context, dict) else {}
    appeal0 = appeal if isinstance(appeal, dict) else {}
    insight = _as_dict(base.get("insight")) or _as_dict(appeal0.get("insight"))
    appeal_ctx = _as_dict(base.get("appeal")) or _as_dict(blog_context.get("selectedAppealPoints")[0] if _as_list(blog_context.get("selectedAppealPoints")) else {})
    commercial_brief_raw = base.get("commercial_brief") if isinstance(base.get("commercial_brief"), dict) else None
    product = _as_dict(base.get("product"))
    product_facts = [item for item in _as_list(blog_context.get("productFacts")) if isinstance(item, dict)]
    brand_facts = [item for item in _as_list(blog_context.get("brandFacts")) if isinstance(item, dict)]
    source_facts = [item for item in _as_list(blog_context.get("sourceFacts")) if isinstance(item, dict)]
    evidence = [item for item in _as_list(blog_context.get("evidence")) if isinstance(item, dict)]
    selected_appeals = [item for item in _as_list(blog_context.get("selectedAppealPoints")) if isinstance(item, dict)]

    brand_knowledge = [_brand_item(item) for item in brand_facts if _text(item.get("statement"))]
    customer_insight = _customer_insight_items(blog_context, insight, source_facts)
    product_knowledge: list[dict[str, Any]] = []
    seen_pk: set[str] = set()
    for item in product_facts + source_facts:
        mapped = _product_item(item)
        if mapped and mapped["knowledgeId"] not in seen_pk:
            seen_pk.add(mapped["knowledgeId"])
            product_knowledge.append(mapped)

    usage = ingest_usage_guide(product=product)
    usage_statements = []
    for item in _as_list(usage.get("statements")):
        if not isinstance(item, dict):
            continue
        pk_item = _usage_to_product_knowledge(item)
        if pk_item["knowledgeId"] not in seen_pk:
            seen_pk.add(pk_item["knowledgeId"])
            product_knowledge.append(pk_item)
            usage_statements.append(pk_item)

    product_for_scope = product or product_from_contexts(blog_context, base)
    ingested = load_category_knowledge_for_product(product_for_scope)
    category_knowledge = [_runtime_category_item(item) for item in _as_list(ingested.get("statements")) if isinstance(item, dict)]
    category_knowledge.extend(
        _category_item(item) for item in _as_list(base.get("verifiedCategoryKnowledge")) if isinstance(item, dict)
    )
    category_knowledge.extend(
        _category_from_fact(item)
        for item in source_facts
        if str(item.get("sourceType") or "") == "EXTERNAL_SOURCE" and _text(item.get("statement"))
    )
    seen_ck: set[str] = set()
    unique_category: list[dict[str, Any]] = []
    for item in category_knowledge:
        if not item:
            continue
        kid = _text(item.get("knowledgeId"))
        if not kid or kid in seen_ck:
            continue
        seen_ck.add(kid)
        unique_category.append(item)
    category_knowledge = unique_category

    customer_experience = [_experience_item(item) for item in evidence if _text(item.get("evidenceId") or item.get("sourcePk"))]
    corpus = build_review_corpus_profile(db, product=product, evidence=evidence) if db is not None else {
        "reviewCorpusProfile": {
            "rawRows": 0,
            "sourceCorpusCount": 0,
            "uniqueReviews": 0,
            "duplicateRows": 0,
            "processedCount": 0,
            "excludedCount": 0,
            "accountingOk": True,
            "llmCalls": 0,
            "skipped": "db_not_provided",
        },
        "experiencePatterns": [],
    }
    experience_patterns = _as_list(corpus.get("experiencePatterns"))
    customer_context = _customer_context(blog_context, insight, commercial_brief_raw, selected_appeals, appeal_ctx, appeal0)
    marketing_objective = _marketing_objective(blog_context, commercial_brief_raw, selected_appeals, appeal_ctx, customer_context)
    qna_audit = _qna_audit(db, product)
    asset_inventory = _asset_inventory(db, product)
    research_requests = build_research_request_candidates(
        product=product_for_scope,
        product_knowledge=product_knowledge,
        brand_knowledge=brand_knowledge,
        category_knowledge=category_knowledge,
        usage_statements=usage_statements,
        ingested_research_requests=_as_list(ingested.get("researchRequests")),
        category_scope=ingested.get("scope") if isinstance(ingested.get("scope"), dict) else None,
    )
    requirements, gaps = _requirements_and_gaps(
        brand_knowledge=brand_knowledge,
        product_knowledge=product_knowledge,
        category_knowledge=category_knowledge,
        customer_experience=customer_experience,
        customer_context=customer_context,
        commercial_brief_raw=commercial_brief_raw,
        experience_patterns=experience_patterns,
        usage_statements=usage_statements,
        category_scope=ingested.get("scope") if isinstance(ingested.get("scope"), dict) else None,
        question_coverage=ingested.get("questionCoverage") if isinstance(ingested.get("questionCoverage"), dict) else {},
    )
    library = {
        "version": LIBRARY_VERSION,
        "persistence": "JSON_ARTIFACT",
        "path": "api/content_blog_knowledge_artifacts/",
        "statements": usage_statements,
        "unresolved": usage.get("unresolved") or [],
        "usageGuide": {
            "source": usage.get("source"),
            "authorityClass": usage.get("authorityClass"),
            "statementCount": len(usage_statements),
            "excludedCount": usage.get("excludedCount") or 0,
            "excludedReasons": usage.get("excludedReasons") or [],
        },
        "qnaAudit": qna_audit,
        "assetInventory": asset_inventory,
        "llmCalls": 0,
        "externalNetwork": 0,
    }
    return {
        "version": MARKETING_KNOWLEDGE_VERSION,
        "marketingObjective": marketing_objective,
        "customerContext": customer_context,
        "customerInsight": customer_insight,
        "brandKnowledge": brand_knowledge,
        "productKnowledge": product_knowledge,
        "categoryKnowledge": category_knowledge,
        "customerExperienceEvidence": customer_experience,
        "experiencePatterns": experience_patterns,
        "reviewCorpusProfile": corpus.get("reviewCorpusProfile") or {},
        "knowledgeRequirements": requirements,
        "knowledgeGaps": gaps,
        "researchRequestCandidates": research_requests,
        "internalKnowledgeLibrary": library,
        "knowledgeDomains": [
            "BRAND_KNOWLEDGE",
            "PRODUCT_KNOWLEDGE",
            "CATEGORY_KNOWLEDGE",
            "CUSTOMER_INSIGHT",
            "CUSTOMER_EXPERIENCE",
        ],
        "productKnowledgeSubtypes": [
            SUBTYPE_METADATA,
            SUBTYPE_MARKETING,
            SUBTYPE_USAGE,
            SUBTYPE_TECHNICAL,
            "PRODUCT_EVIDENCE",
        ],
        "complianceBoundary": {
            "unverifiedGeneralKnowledge": "FORBIDDEN",
            "allowGeneralKnowledge": False,
            "approvedBrandKnowledge": "ALLOWED",
            "approvedProductKnowledge": "ALLOWED",
            "verifiedCategoryKnowledge": "ALLOWED",
            "categoryKnowledgeIsNotProductClaim": True,
            "usageGuideIsNotCategoryKnowledge": True,
            "corpusPatternIsNotProductFact": True,
            "corpusPatternIsNotEfficacyRate": True,
            "readerFacingDefensiveMetaForbidden": True,
            "unsupportedSuperiorityForbidden": True,
            "guardrails": list(GUARDRAILS),
            "planningPriority": list(PLANNING_PRIORITY),
            "knowledgeGapsReaderFacing": False,
            "unsupportedTopicsReaderFacing": False,
            "restrictedClaimsReaderFacing": False,
            "planningWarningsReaderFacing": False,
            "researchRequestsExecuted": False,
        },
        "provenance": {
            "builderVersion": MARKETING_KNOWLEDGE_VERSION,
            "gapVersion": KNOWLEDGE_REQUIREMENT_GAP_VERSION,
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "derived": False,
            "llmCalls": 0,
            "inventedFacts": False,
            "externalNetwork": 0,
            "writerInvoked": False,
            "categoryIngestLlmCalls": 0,
            "categoryScope": ingested.get("scope") if isinstance(ingested.get("scope"), dict) else {},
        },
    }


def attach_blog_marketing_knowledge(
    blog_context: dict[str, Any],
    *,
    base_context: dict[str, Any] | None = None,
    appeal: dict[str, Any] | None = None,
    db: Any = None,
) -> dict[str, Any]:
    payload = copy.deepcopy(blog_context) if isinstance(blog_context, dict) else {}
    if not isinstance(payload.get("marketingKnowledge"), dict):
        payload["marketingKnowledge"] = build_blog_marketing_knowledge(
            blog_context=payload,
            base_context=base_context,
            appeal=appeal,
            db=db,
        )
    return payload


def marketing_catalog(blog_context: dict[str, Any]) -> dict[str, Any]:
    knowledge = blog_context.get("marketingKnowledge") if isinstance(blog_context.get("marketingKnowledge"), dict) else {}
    brand = [item for item in _as_list(knowledge.get("brandKnowledge")) if isinstance(item, dict) and _text(item.get("knowledgeId"))]
    product = [item for item in _as_list(knowledge.get("productKnowledge")) if isinstance(item, dict) and _text(item.get("knowledgeId"))]
    category = [item for item in _as_list(knowledge.get("categoryKnowledge")) if isinstance(item, dict) and _text(item.get("knowledgeId"))]
    experience = [item for item in _as_list(knowledge.get("customerExperienceEvidence")) if isinstance(item, dict)]
    patterns = [item for item in _as_list(knowledge.get("experiencePatterns")) if isinstance(item, dict) and _text(item.get("patternId"))]
    brand_ids = [_text(item.get("knowledgeId")) for item in brand]
    product_ids = [_text(item.get("knowledgeId")) for item in product]
    category_ids = [_text(item.get("knowledgeId")) for item in category]
    pattern_ids = [_text(item.get("patternId")) for item in patterns]
    return {
        "marketingKnowledge": knowledge,
        "brandKnowledge": brand,
        "productKnowledge": product,
        "categoryKnowledge": category,
        "customerExperienceEvidence": experience,
        "experiencePatterns": patterns,
        "experiencePatternCatalog": planner_pattern_payload(patterns),
        "brandById": {item["knowledgeId"]: item for item in brand},
        "productById": {item["knowledgeId"]: item for item in product},
        "categoryById": {item["knowledgeId"]: item for item in category},
        "experiencePatternById": {item["patternId"]: item for item in patterns},
        "allowedBrandKnowledgeIds": brand_ids,
        "allowedProductKnowledgeIds": product_ids,
        "allowedCategoryKnowledgeIds": category_ids,
        "allowedExperiencePatternIds": pattern_ids,
        "categoryKnowledgeCatalog": [
            {
                "knowledgeId": item.get("knowledgeId"),
                "statement": item.get("statement"),
                "topic": item.get("topic"),
                "allowedMarketingUses": item.get("allowedMarketingUses") or [],
                "claimBoundary": item.get("claimBoundary") or {},
                "limitations": item.get("limitations") or [],
                "knowledgeUsePolicy": item.get("knowledgeUsePolicy") or "DIRECT_EDUCATION_ALLOWED",
                "qualificationRequired": bool(item.get("qualificationRequired")),
                "usableForCategoryEducation": bool(item.get("usableForCategoryEducation", True)),
                "usableForProductClaim": False,
            }
            for item in category
        ],
        "knowledgeIds": set(brand_ids + product_ids + category_ids),
        "reviewCorpusProfile": knowledge.get("reviewCorpusProfile") if isinstance(knowledge.get("reviewCorpusProfile"), dict) else {},
        "researchRequestCandidates": _as_list(knowledge.get("researchRequestCandidates")),
        "statements": {
            _text(item.get("statement"))
            for item in brand + product + category
            if _text(item.get("statement"))
        },
    }


def _marketing_objective(
    blog_context: dict[str, Any],
    commercial_brief_raw: dict[str, Any] | None,
    selected_appeals: list[dict[str, Any]],
    appeal_ctx: dict[str, Any],
    customer_context: dict[str, Any],
) -> dict[str, Any]:
    appeal_ids = [_text(item.get("appealId") or item.get("appeal_id")) for item in selected_appeals if _text(item.get("appealId") or item.get("appeal_id"))]
    core_appeal = _text(appeal_ctx.get("appealText") or appeal_ctx.get("appeal_text") or (selected_appeals[0].get("appealText") if selected_appeals else None))
    source_refs: list[str] = []
    status = STATUS_UNKNOWN
    commercial: dict[str, Any]
    if commercial_brief_raw and _brief_has_source_content(commercial_brief_raw):
        commercial = {
            "rawValue": copy.deepcopy(commercial_brief_raw),
            "source": "generation_context.commercial_brief",
            "sourceRefs": ["commercial_brief"],
            "status": STATUS_SOURCE_GROUNDED,
            "readerFacing": False,
        }
        source_refs.append("commercial_brief")
        status = STATUS_SOURCE_GROUNDED
    else:
        commercial = {
            "rawValue": None,
            "source": None,
            "sourceRefs": [],
            "status": STATUS_UNKNOWN,
            "readerFacing": False,
        }
    if selected_appeals:
        source_refs.extend(appeal_ids)
        if status == STATUS_UNKNOWN:
            status = STATUS_PARTIAL
        elif _brief_has_source_content(commercial_brief_raw):
            status = STATUS_SOURCE_GROUNDED
    product_focus = None
    for item in _as_list(blog_context.get("productFacts")):
        if isinstance(item, dict) and str(item.get("provenance", {}).get("sourceField") or "") == "title":
            product_focus = _text(item.get("statement"))
            source_refs.append(_text(item.get("factId")))
            break
    desired_action = None
    if commercial_brief_raw and _text(commercial_brief_raw.get("desired_outcome")):
        desired_action = "CHECK_PRODUCT_INFO"
        status = STATUS_SOURCE_GROUNDED if status != STATUS_UNKNOWN else STATUS_PARTIAL
    return {
        "objectiveType": OBJECTIVE_TYPE,
        "topic": _text(blog_context.get("topic")) or None,
        "productFocus": product_focus,
        "selectedAppealIds": [item for item in appeal_ids if item],
        "coreAppeal": core_appeal or None,
        "desiredReaderResponse": _text(commercial_brief_raw.get("desired_outcome") if commercial_brief_raw else None)
        or _text((customer_context.get("desires") or [{}])[0].get("rawValue") if customer_context.get("desires") else None)
        or None,
        "desiredAction": desired_action,
        "commercialBrief": commercial,
        "sourceRefs": [item for item in source_refs if item],
        "status": status,
        "classification": "CONTEXT_SOURCE",
    }


def _brief_has_source_content(brief: dict[str, Any] | None) -> bool:
    if not isinstance(brief, dict):
        return False
    return any(_text(brief.get(key)) for key in ("primary_problem", "desired_outcome", "purchase_barrier", "usage_situation", "creative_angle"))


def _customer_context(
    blog_context: dict[str, Any],
    insight: dict[str, Any],
    commercial_brief_raw: dict[str, Any] | None,
    selected_appeals: list[dict[str, Any]],
    appeal_ctx: dict[str, Any],
    appeal0: dict[str, Any],
) -> dict[str, Any]:
    problem = _sourced_text(
        _text(insight.get("problem"))
        or _text(blog_context.get("audienceProblem"))
        or _text((commercial_brief_raw or {}).get("primary_problem")),
        source="insight.problem" if _text(insight.get("problem")) or _text(blog_context.get("audienceProblem")) else "commercial_brief.primary_problem",
    )
    desires = _optional_list(
        [
            (_text(insight.get("desire")), "insight.desire"),
            (_text((commercial_brief_raw or {}).get("desired_outcome")), "commercial_brief.desired_outcome"),
        ]
    )
    barriers = _optional_list(
        [
            (_text(insight.get("barrier")), "insight.barrier"),
            (_text((commercial_brief_raw or {}).get("purchase_barrier")), "commercial_brief.purchase_barrier"),
        ]
    )
    usage = _optional_list(
        [
            (_text(insight.get("usage_situation")), "insight.usage_situation"),
            (_text((commercial_brief_raw or {}).get("usage_situation")), "commercial_brief.usage_situation"),
        ]
    )
    questions: list[dict[str, Any]] = []
    for snippet in _as_list(base_customer_language(insight, appeal0)):
        if _text(snippet):
            questions.append({"rawValue": _text(snippet), "source": "insight.customer_language", "status": STATUS_SOURCE_GROUNDED})
    source_refs = []
    for item in [problem, *desires, *barriers, *usage, *questions]:
        if isinstance(item, dict) and item.get("source"):
            source_refs.append(str(item["source"]))
    if selected_appeals:
        source_refs.append("selectedAppealPoints")
    return {
        "problem": problem if problem["rawValue"] else {"rawValue": None, "source": None, "status": STATUS_UNKNOWN},
        "desires": desires,
        "barriers": barriers,
        "purchaseQuestions": questions,
        "usageSituations": usage,
        "sourceRefs": list(dict.fromkeys(source_refs)),
    }


def base_customer_language(insight: dict[str, Any], appeal0: dict[str, Any]) -> list[Any]:
    if isinstance(insight.get("customer_language"), list):
        return insight.get("customer_language") or []
    nested = appeal0.get("insight") if isinstance(appeal0.get("insight"), dict) else {}
    if isinstance(nested.get("customer_language"), list):
        return nested.get("customer_language") or []
    return []


def _optional_list(pairs: list[tuple[str, str]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for value, source in pairs:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append({"rawValue": value, "source": source, "status": STATUS_SOURCE_GROUNDED})
    return out


def _sourced_text(value: str, *, source: str) -> dict[str, Any]:
    if not value:
        return {"rawValue": None, "source": None, "status": STATUS_UNKNOWN}
    return {"rawValue": value, "source": source, "status": STATUS_SOURCE_GROUNDED}


def _brand_item(fact: dict[str, Any]) -> dict[str, Any]:
    fact_id = _text(fact.get("factId"))
    return {
        "knowledgeId": f"BK-{fact_id}" if fact_id else _stable_id("BK", _text(fact.get("statement"))),
        "knowledgeClass": CLASS_APPROVED_BRAND,
        "statement": _text(fact.get("statement")),
        "sourceRefs": [item for item in [fact_id, _text(fact.get("sourceRef"))] if item],
        "factRefs": [fact_id] if fact_id else [],
        "sourceType": _text(fact.get("sourceType")) or "BRAND_SOURCE",
        "verificationStatus": STATUS_SOURCE_CONFIRMED,
        "allowedMarketingUses": ["BRAND_STORY", "PRODUCT_RELEVANCE", "DIFFERENTIATION"],
        "claimBoundary": {"canStateAsFact": True, "canClaimSuperiority": False, "requiresQualifier": False},
        "readerFacing": True,
    }


def _is_customer_insight_fact(fact: dict[str, Any]) -> bool:
    fact_id = _text(fact.get("factId"))
    if fact_id == "sf_insight_problem":
        return True
    source_type = str(fact.get("sourceType") or "").upper()
    fact_type = str(fact.get("factType") or "").upper()
    if source_type in {"INSIGHT_SOURCE"} or fact_type in {"INSIGHT_FACT"}:
        return True
    field = str((fact.get("provenance") or {}).get("sourceField") or "").lower().replace(" ", "_")
    return field in {"problem", "desire", "barrier", "customer_language", "usage_situation"}


def _product_subtype(fact: dict[str, Any]) -> str:
    field = str((fact.get("provenance") or {}).get("sourceField") or "").lower()
    if field in {"title", "product_group", "product_url"} or str(fact.get("factId") or "").startswith("sf_product_") and field in {"title", "product_group", "product_url"}:
        return SUBTYPE_METADATA
    if field in {"usage_steps", "how_to", "usage"}:
        return SUBTYPE_USAGE
    if field in {"ingredients_or_components", "ingredients", "composition"}:
        return SUBTYPE_TECHNICAL
    if field in {"usp", "proof_points", "confirmed_facts"}:
        return SUBTYPE_MARKETING
    return SUBTYPE_MARKETING


def _product_item(fact: dict[str, Any]) -> dict[str, Any] | None:
    if _is_customer_insight_fact(fact):
        return None
    fact_id = _text(fact.get("factId"))
    statement = _text(fact.get("statement"))
    if not fact_id or not statement:
        return None
    classification = str(fact.get("classification") or "").upper()
    source_type = str(fact.get("sourceType") or "").upper()
    inference = classification == "INFERENCE" or source_type == "DETAIL_PAGE_SOURCE"
    knowledge_class = CLASS_SOURCE_DERIVED_INFERENCE if inference else CLASS_APPROVED_PRODUCT
    verification = STATUS_INFERENCE if inference else STATUS_SOURCE_CONFIRMED
    subtype = _product_subtype(fact)
    return {
        "knowledgeId": f"PK-{fact_id}",
        "knowledgeClass": knowledge_class,
        "sourceDomain": "PRODUCT_KNOWLEDGE",
        "knowledgeSubtype": subtype,
        "statement": statement,
        "sourceRefs": [item for item in [fact_id, _text(fact.get("sourceRef"))] if item],
        "factRefs": [fact_id],
        "sourceType": source_type or "PRODUCT_SOURCE",
        "verificationStatus": verification,
        "allowedMarketingUses": ["PRODUCT_EDUCATION", "PRODUCT_RELEVANCE", "DIFFERENTIATION", "CTA_SUPPORT"],
        "claimBoundary": {
            "canStateAsFact": not inference,
            "canClaimSuperiority": False,
            "requiresQualifier": inference,
            "canApplyDirectlyToProduct": not inference,
            "metadataIsNotEfficacy": subtype == SUBTYPE_METADATA,
        },
        "readerFacing": True,
    }


def _usage_to_product_knowledge(item: dict[str, Any]) -> dict[str, Any]:
    knowledge_id = _text(item.get("knowledgeId"))
    return {
        "knowledgeId": knowledge_id,
        "knowledgeClass": CLASS_APPROVED_PRODUCT,
        "sourceDomain": "PRODUCT_KNOWLEDGE",
        "knowledgeSubtype": SUBTYPE_USAGE,
        "statement": _text(item.get("statement")),
        "sourceRefs": [_text(item.get("sourceId")), _text(item.get("sourcePath"))],
        "factRefs": [knowledge_id],
        "sourceType": "USAGE_GUIDE_SOURCE",
        "authorityClass": _text(item.get("authorityClass")),
        "verificationStatus": STATUS_SOURCE_CONFIRMED,
        "usableAsFact": True,
        "usableForMarketingInterpretation": True,
        "usableForProductClaim": False,
        "usableForCategoryEducation": False,
        "allowedMarketingUses": ["PRODUCT_EDUCATION", "HOW_TO"],
        "claimBoundary": item.get("claimBoundary") if isinstance(item.get("claimBoundary"), dict) else {"canStateAsFact": True, "canClaimSuperiority": False, "canClaimEfficacy": False},
        "scope": item.get("scope") if isinstance(item.get("scope"), dict) else {},
        "readerFacing": True,
    }


def _customer_insight_items(
    blog_context: dict[str, Any],
    insight: dict[str, Any],
    source_facts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for fact in source_facts:
        if not _is_customer_insight_fact(fact):
            continue
        fact_id = _text(fact.get("factId"))
        statement = _text(fact.get("statement"))
        if not statement:
            continue
        out.append(
            {
                "knowledgeId": f"CI-{fact_id}" if fact_id else _stable_id("CI", statement),
                "sourceDomain": DOMAIN_INSIGHT,
                "knowledgeSubtype": _text((fact.get("provenance") or {}).get("sourceField")) or "problem",
                "knowledgeClass": DOMAIN_INSIGHT,
                "statement": statement,
                "sourceRefs": [item for item in [fact_id, _text(fact.get("sourceRef"))] if item],
                "factRefs": [fact_id] if fact_id else [],
                "verificationStatus": STATUS_SOURCE_GROUNDED,
                "readerFacing": True,
            }
        )
    for key, source in (
        ("desire", "insight.desire"),
        ("barrier", "insight.barrier"),
        ("usage_situation", "insight.usage_situation"),
    ):
        value = _text(insight.get(key))
        if not value:
            continue
        if any(item.get("statement") == value for item in out):
            continue
        out.append(
            {
                "knowledgeId": _stable_id("CI", f"{key}|{value}"),
                "sourceDomain": DOMAIN_INSIGHT,
                "knowledgeSubtype": key,
                "knowledgeClass": DOMAIN_INSIGHT,
                "statement": value,
                "sourceRefs": [source],
                "factRefs": [],
                "verificationStatus": STATUS_SOURCE_GROUNDED,
                "readerFacing": True,
            }
        )
    for snippet in base_customer_language(insight, {}):
        value = _text(snippet)
        if not value:
            continue
        out.append(
            {
                "knowledgeId": _stable_id("CI", f"customer_language|{value}"),
                "sourceDomain": DOMAIN_INSIGHT,
                "knowledgeSubtype": "customer_language",
                "knowledgeClass": DOMAIN_INSIGHT,
                "statement": value,
                "sourceRefs": ["insight.customer_language"],
                "factRefs": [],
                "verificationStatus": STATUS_SOURCE_GROUNDED,
                "readerFacing": True,
            }
        )
    return out


def _qna_audit(db: Any, product: dict[str, Any]) -> dict[str, Any]:
    empty = {
        "sourceCount": 0,
        "productMappedCount": 0,
        "answeredCount": 0,
        "sellerAnswerPresent": False,
        "answerAuthority": "UNKNOWN_INTERNAL_SOURCE",
        "status": FUTURE_INTERNAL_SOURCE,
        "connectedAsFact": False,
        "reason": "QnA seller-answer authority is not an official product-spec flag",
    }
    if db is None:
        empty["reason"] = "db_not_provided"
        return empty
    try:
        from db import CommerceQnaRaw
        from sqlalchemy import func

        total = int(db.query(func.count(CommerceQnaRaw.qna_key)).scalar() or 0)
        answered = int(db.query(func.count(CommerceQnaRaw.qna_key)).filter(CommerceQnaRaw.answered.is_(True)).scalar() or 0)
        title = _text(product.get("title"))
        mapped = 0
        if title:
            mapped = int(
                db.query(func.count(CommerceQnaRaw.qna_key))
                .filter(CommerceQnaRaw.product_name.isnot(None), CommerceQnaRaw.product_name.contains(title[:8] if len(title) >= 8 else title))
                .scalar()
                or 0
            )
        empty.update(
            {
                "sourceCount": total,
                "productMappedCount": mapped,
                "answeredCount": answered,
                "sellerAnswerPresent": answered > 0,
            }
        )
    except Exception as exc:
        empty["reason"] = f"qna_audit_unavailable:{exc.__class__.__name__}"
    return empty


def _asset_inventory(db: Any, product: dict[str, Any]) -> dict[str, Any]:
    payload = {"skuAssetCount": 0, "status": "MISSING", "connectedAsFact": False}
    if db is None:
        payload["reason"] = "db_not_provided"
        return payload
    try:
        from db import ContentSkuAsset

        sku = _text(product.get("sku_id"))
        q = db.query(ContentSkuAsset)
        if sku:
            q = q.filter(ContentSkuAsset.sku_id == sku)
        count = int(q.count() or 0)
        payload["skuAssetCount"] = count
        payload["status"] = "AVAILABLE" if count else "MISSING"
    except Exception as exc:
        payload["reason"] = f"asset_inventory_unavailable:{exc.__class__.__name__}"
    return payload


def _runtime_category_item(item: dict[str, Any]) -> dict[str, Any] | None:
    knowledge_id = _text(item.get("knowledgeId"))
    statement = _text(item.get("statement"))
    source_refs = [_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)]
    if not knowledge_id or not statement or not source_refs:
        return None
    boundary = dict(_as_dict(item.get("claimBoundary")))
    boundary["canApplyDirectlyToProduct"] = False
    boundary["canClaimProductSuperiority"] = False
    boundary["canClaimConsumerEfficacy"] = False
    boundary["canClaimSafetySuperiority"] = False
    return {
        "knowledgeId": knowledge_id,
        "knowledgeClass": CLASS_VERIFIED_CATEGORY,
        "topic": _text(item.get("topic")),
        "statement": statement,
        "sourceRefs": source_refs,
        "sourceLocation": dict(_as_dict(item.get("sourceLocation"))),
        "authorityClass": _text(item.get("authorityClass")),
        "verificationStatus": STATUS_VERIFIED,
        "allowedMarketingUses": [_text(value) for value in _as_list(item.get("allowedMarketingUses")) if _text(value)]
        or ["EDUCATION", "EXPLANATION", "PRODUCT_CONTEXT"],
        "claimBoundary": boundary,
        "limitations": [_text(value) for value in _as_list(item.get("limitations")) if _text(value)],
        "usableForCategoryEducation": bool(item.get("usableForCategoryEducation", True)),
        "usableForProductClaim": False,
        "scientificStatement": _text(item.get("scientificStatement") or statement),
        "marketingInterpretation": item.get("marketingInterpretation") if isinstance(item.get("marketingInterpretation"), dict) else None,
        "knowledgeUsePolicy": _text(item.get("knowledgeUsePolicy")) or "DIRECT_EDUCATION_ALLOWED",
        "qualificationRequired": bool(item.get("qualificationRequired")),
        "sourceDomain": "CATEGORY_KNOWLEDGE",
        "readerFacing": True,
        "readerFacingDefensiveMeta": False,
    }


def _category_item(item: dict[str, Any]) -> dict[str, Any] | None:
    statement = _text(item.get("statement"))
    source_refs = [_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)]
    if not statement or not source_refs:
        return None
    topic = _text(item.get("topic")) or statement[:80]
    knowledge_id = _text(item.get("knowledgeId")) or _stable_id("CK", "|".join(source_refs + [statement]))
    if not knowledge_id.startswith("CK-"):
        knowledge_id = f"CK-{knowledge_id}" if not knowledge_id.startswith("CK") else knowledge_id
    return {
        "knowledgeId": knowledge_id,
        "knowledgeClass": CLASS_VERIFIED_CATEGORY,
        "topic": topic,
        "statement": statement,
        "sourceRefs": source_refs,
        "sourceAuthority": _text(item.get("sourceAuthority")) or "EXISTING_INTERNAL_SOURCE",
        "verificationStatus": STATUS_VERIFIED,
        "allowedMarketingUses": ["EDUCATION", "EXPLANATION", "PRODUCT_CONTEXT", "DIFFERENTIATION_CONTEXT"],
        "claimBoundary": {
            "canStateAsFact": True,
            "canApplyDirectlyToProduct": False,
            "canClaimProductSuperiority": False,
        },
        "readerFacing": True,
    }


def _category_from_fact(fact: dict[str, Any]) -> dict[str, Any] | None:
    return _category_item(
        {
            "statement": fact.get("statement"),
            "topic": fact.get("factType") or "EXTERNAL_SOURCE",
            "sourceRefs": [item for item in [_text(fact.get("factId")), _text(fact.get("sourceRef"))] if item],
            "sourceAuthority": "EXTERNAL_SOURCE",
            "knowledgeId": f"CK-{_text(fact.get('factId'))}" if _text(fact.get("factId")) else None,
        }
    )


def _experience_item(item: dict[str, Any]) -> dict[str, Any]:
    evidence_id = _text(item.get("evidenceId") or item.get("sourcePk"))
    metric = item.get("metric") if isinstance(item.get("metric"), dict) else {}
    evidence_class = _text(metric.get("evidence_class"))
    sentiment = STATUS_UNKNOWN
    if "POSITIVE" in evidence_class.upper():
        sentiment = "POSITIVE"
    elif "NEGATIVE" in evidence_class.upper() or "COMPLAINT" in evidence_class.upper():
        sentiment = "NEGATIVE"
    return {
        "evidenceRef": evidence_id,
        "rawText": _text(item.get("statement")),
        "sourceType": "CUSTOMER_REVIEW" if "REVIEW" in str(item.get("sourceType") or "").upper() else _text(item.get("sourceType")) or "EVIDENCE",
        "sentiment": sentiment,
        "usageContext": STATUS_UNKNOWN,
        "productExperience": STATUS_UNKNOWN,
        "claimBoundary": "INDIVIDUAL_EXPERIENCE",
        "readerFacing": True,
        "sourceRefs": [evidence_id] if evidence_id else [],
    }


def _requirements_and_gaps(
    *,
    brand_knowledge: list[dict[str, Any]],
    product_knowledge: list[dict[str, Any]],
    category_knowledge: list[dict[str, Any]],
    customer_experience: list[dict[str, Any]],
    customer_context: dict[str, Any],
    commercial_brief_raw: dict[str, Any] | None,
    experience_patterns: list[dict[str, Any]] | None = None,
    usage_statements: list[dict[str, Any]] | None = None,
    category_scope: dict[str, Any] | None = None,
    question_coverage: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    approved_product = [item for item in product_knowledge if item.get("knowledgeClass") == CLASS_APPROVED_PRODUCT]
    non_metadata = [item for item in approved_product if item.get("knowledgeSubtype") != SUBTYPE_METADATA]
    qualified = [item for item in category_knowledge if item.get("knowledgeUsePolicy") == "QUALIFIED_EDUCATION_ONLY"]
    if category_knowledge and qualified:
        category_status = STATUS_PARTIAL
    elif category_knowledge:
        category_status = STATUS_AVAILABLE
    else:
        category_status = STATUS_MISSING
    specs = [
        ("KR-brand", "BRAND", "approved brand knowledge", brand_knowledge, "REQUIRED", None),
        ("KR-product", "PRODUCT", "approved product knowledge", approved_product, "REQUIRED", None),
        ("KR-product-beyond-metadata", "PRODUCT", "product knowledge beyond metadata", non_metadata, "REQUIRED", None),
        ("KR-category", "CATEGORY", "verified category knowledge", category_knowledge, "USEFUL", category_status),
        ("KR-experience", DOMAIN_EXPERIENCE, "customer experience evidence", customer_experience, "REQUIRED", None),
        ("KR-experience-pattern", DOMAIN_EXPERIENCE, "corpus experience patterns", experience_patterns or [], "USEFUL", None),
        ("KR-usage", "PRODUCT", "mapped product usage facts", usage_statements or [], "USEFUL", None),
        ("KR-brief", "BRAND", "commercial brief", [commercial_brief_raw] if _brief_has_source_content(commercial_brief_raw) else [], "USEFUL", None),
        ("KR-desire", DOMAIN_INSIGHT, "customer desire", customer_context.get("desires") or [], "USEFUL", None),
        ("KR-barrier", DOMAIN_INSIGHT, "customer barrier", customer_context.get("barriers") or [], "USEFUL", None),
    ]
    coverage = question_coverage or {}
    scope = (category_scope or {}).get("scope")
    if scope == "HENNA":
        specs.append(("KR-category-henna-mechanism", "CATEGORY", "henna coloring mechanism", category_knowledge, "USEFUL", _coverage_status(coverage.get("Q3_coloring_mechanism"))))
        specs.append(("KR-category-henna-keratin", "CATEGORY", "henna keratin exact interaction", qualified or [], "USEFUL", _coverage_status(coverage.get("Q4_keratin_interaction"), default=STATUS_PARTIAL if qualified else STATUS_MISSING)))
    elif scope == "JOJOBA":
        specs.append(("KR-category-jojoba-composition", "CATEGORY", "jojoba wax ester composition", category_knowledge, "USEFUL", _coverage_status(coverage.get("Q1_chemical_composition"))))
        specs.append(("KR-category-jojoba-hair", "CATEGORY", "jojoba hair application evidence", qualified or [], "USEFUL", _coverage_status(coverage.get("Q7_hair_or_skin_use"), default=STATUS_PARTIAL if qualified else STATUS_MISSING)))
    elif scope == "HAIR_PACK":
        specs.append(("KR-category-hair-pack", "CATEGORY", "hair-pack ingredient category knowledge", [], "USEFUL", STATUS_MISSING))
    requirements: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    for req_id, domain, topic, items, priority, forced_status in specs:
        present = [item for item in items if item]
        if forced_status:
            status = forced_status
        elif not present:
            status = STATUS_MISSING
        elif domain == "PRODUCT" and len(present) <= 3:
            status = STATUS_PARTIAL
        else:
            status = STATUS_AVAILABLE
        refs = []
        for item in present:
            if isinstance(item, dict):
                refs.extend([_text(item.get("knowledgeId")), _text(item.get("evidenceRef")), _text(item.get("factId"))])
        refs = [item for item in dict.fromkeys(refs) if item]
        requirements.append(
            {
                "requirementId": req_id,
                "domain": domain,
                "topic": topic,
                "reason": "marketing planning input",
                "priority": priority,
                "status": status,
                "knowledgeRefs": refs,
                "readerFacing": False,
            }
        )
        if status in {STATUS_MISSING, STATUS_PARTIAL}:
            gaps.append(
                {
                    "gapId": req_id.replace("KR-", "KG-"),
                    "domain": domain,
                    "topic": topic,
                    "status": status,
                    "impact": "Do not invent this knowledge. Build the plan from remaining available sources.",
                    "recommendedFutureSource": "Approved internal knowledge library or verified research ingest",
                    "readerFacing": False,
                }
            )
    return requirements, gaps


def _coverage_status(value: Any, *, default: str | None = None) -> str:
    text = _text(value).upper()
    if text in {"SUPPORTED", "AVAILABLE"}:
        return STATUS_AVAILABLE
    if text in {"PARTIALLY_SUPPORTED", "PARTIAL"}:
        return STATUS_PARTIAL
    if text in {"MISSING", "NOT_SUPPORTED", "SOURCE_NOT_FOUND"}:
        return STATUS_MISSING
    return default or STATUS_MISSING


def _stable_id(prefix: str, key: str) -> str:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}
