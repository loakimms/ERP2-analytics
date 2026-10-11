from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from content_blog_marketing_knowledge import build_blog_marketing_knowledge
from content_center_engine import claim_gate_text
from content_center_scope import ensure_claim_policies
from content_writer_service import build_generation_context
from db import ContentClaimPolicy


BLOG_GENERATION_CONTEXT_VERSION = "blog_generation_context_v1"
BLOG_V2_GENERATION_VERSION = "blog_v2"

STATUS_UNKNOWN = "UNKNOWN"
STATUS_SOURCE_NOT_AVAILABLE = "SOURCE_NOT_AVAILABLE"
STATUS_NOT_APPLICABLE = "NOT_APPLICABLE"
STATUS_PENDING_ANALYSIS = "PENDING_ANALYSIS"

FACT_CLASS_FACT_SOURCE = "FACT_SOURCE"
FACT_CLASS_BRAND_SOURCE = "BRAND_SOURCE"
FACT_CLASS_PRODUCT_SOURCE = "PRODUCT_SOURCE"
FACT_CLASS_GENERAL_KNOWLEDGE = "GENERAL_KNOWLEDGE"
FACT_CLASS_INFERENCE = "INFERENCE"
FACT_CLASS_UNKNOWN = "UNKNOWN"

SOURCE_PRODUCT = "PRODUCT_SOURCE"
SOURCE_BRAND = "BRAND_SOURCE"
SOURCE_DETAIL_PAGE = "DETAIL_PAGE_SOURCE"
SOURCE_APPEAL = "APPEAL_SOURCE"
SOURCE_INSIGHT = "INSIGHT_SOURCE"
SOURCE_EVIDENCE = "EVIDENCE_SOURCE"
SOURCE_REVIEW = "REVIEW_SOURCE"
SOURCE_EXTERNAL = "EXTERNAL_SOURCE"
SOURCE_GENERAL_KNOWLEDGE = "GENERAL_KNOWLEDGE"
SOURCE_UNKNOWN = "UNKNOWN"

FACT_TYPE_PRODUCT = "PRODUCT_FACT"
FACT_TYPE_BRAND = "BRAND_FACT"
FACT_TYPE_INSIGHT = "INSIGHT_FACT"

CLAIM_STATUS_SUPPORTED = "SUPPORTED"
CLAIM_STATUS_FORBIDDEN = "FORBIDDEN"
CLAIM_STATUS_REVIEW_REQUIRED = "REVIEW_REQUIRED"

BLOG_CATEGORY_VALUES = (
    "PRODUCT_GUIDE",
    "PRODUCT_REVIEW",
    "HAIR_CARE",
    "SCALP_CARE",
    "INGREDIENT_EDUCATION",
    "BEAUTY_KNOWLEDGE",
    "HOW_TO",
    "BRAND_STORY",
    "COMPANY_NEWS",
    "UNKNOWN",
)

DEFAULT_GENERATION_POLICY = {
    "factAccuracyPriority": True,
    "searchIntentPriority": True,
    "unsupportedExperienceForbidden": True,
    "unsupportedClaimForbidden": True,
    "inventedEvidenceForbidden": True,
    "inventedSourceForbidden": True,
    "seoCannotOverrideFact": True,
    "allowGeneralKnowledge": False,
    "marketingDefinesTheStory": True,
    "complianceDefinesTheBoundary": True,
    "unverifiedGeneralKnowledge": "FORBIDDEN",
}

BLOG_V2_KNOWN_BLOCKERS = (
    {
        "id": "MOBILE_PARAGRAPH_BREAK_COLLAPSE_BY_CLEAN_TEXT",
        "ledger": "BLOG_V2_KNOWN_BLOCKER",
        "targetPhase": "PHASE_4",
        "status": "RESOLVED_IN_BLOG_V2",
        "summary": "V1 _clean_text() still collapses newlines for Instagram/Shorts/Blog V1. Blog V2 uses paragraph arrays and clean_blog_v2_paragraph().",
        "resolvedIn": "PHASE_4",
    },
    {
        "id": "TITLE_CANDIDATES_DROPPED_DURING_NORMALIZATION",
        "ledger": "BLOG_V2_KNOWN_BLOCKER",
        "targetPhase": "PHASE_4",
        "status": "RESOLVED_IN_BLOG_V2",
        "summary": "V1 _normalize_blog() still drops title_candidates. Blog V2 preserves titleCandidates and selectedTitle in BlogProfessionalDraft.",
        "resolvedIn": "PHASE_4",
    },
    {
        "id": "BLOG_V1_HARD_LENGTH_VALIDATION_INCOMPATIBLE_WITH_V2",
        "ledger": "BLOG_V2_KNOWN_BLOCKER",
        "targetPhase": "PHASE_5",
        "status": "RESOLVED_IN_BLOG_V2_VALIDATOR",
        "resolvedIn": "PHASE_5",
        "summary": "V1 hard length validation is unchanged. Blog V2 uses BlogQualityValidator configurable REFERENCE_GUIDELINE warnings instead of hard fail.",
    },
    {
        "id": "LIVE_BLOG_V2_PLANNER_WRITER_END_TO_END_NOT_YET_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_BLOCKER",
        "targetPhase": "PHASE_8",
        "status": "PRODUCTION_ACTIVATION_BLOCKER",
        "summary": "Planner and Writer contract tests use deterministic fixtures. Live OpenAI Planner → Writer → Validator end-to-end is not yet verified. Production default must stay V1 until PHASE 8 acceptance.",
    },
    {
        "id": "BLOG_V2_HITL_END_TO_END_REAL_SAMPLE_NOT_YET_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_BLOCKER",
        "targetPhase": "PHASE_8",
        "status": "PRODUCTION_ACTIVATION_BLOCKER",
        "summary": "PHASE 7 implements the HITL path, but real live samples have not been human-reviewed. Production default must stay V1 until PHASE 8.",
    },
    {
        "id": "HUMAN_EDIT_REVALIDATION_PATH_MISSING",
        "ledger": "BLOG_V2_KNOWN_BLOCKER",
        "targetPhase": "PHASE_8",
        "status": "RESOLVED_IN_BLOG_V2_HUMAN_EDIT_REVALIDATION_ADAPTER_V1",
        "audit": "HUMAN_EDIT_REVALIDATION_PATH = RESOLVED_IN_BLOG_V2_HUMAN_EDIT_REVALIDATION_ADAPTER_V1",
        "summary": "Human Edit overlay + Effective Draft adapter re-runs Human Revised contract and existing Blog V2 quality checks, then returns validationFreshness to CURRENT. Original AI Draft and initial QualityReport stay immutable. Production activation is not approved by this resolution.",
        "resolvedIn": "BLOG_V2_HUMAN_EDIT_REVALIDATION_ADAPTER_IMPLEMENTATION_V1",
        "qaArtifactId": "CT-dfb36b68a5",
        "sourceArtifactId": "CT-f41a1d18ea",
    },
)

BLOG_V2_KNOWN_LIMITATIONS = (
    {
        "id": "SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_LIMITATION",
        "status": "KNOWN_LIMITATION",
        "hitlPath": "HITL_PATH_IMPLEMENTED",
        "finalVerificationTarget": "PHASE_8",
        "targetPhase": "PHASE_8_HUMAN_REVIEW",
        "summary": "Section-level provenance is checked. Sentence-level semantic entailment of every sentence against source statements is outside the deterministic validator.",
    },
    {
        "id": "SEMANTIC_GENERAL_KNOWLEDGE_EXCLUSION_NOT_FULLY_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_LIMITATION",
        "status": "KNOWN_LIMITATION",
        "hitlPath": "HITL_PATH_IMPLEMENTED",
        "finalVerificationTarget": "PHASE_8",
        "targetPhase": "PHASE_8_HUMAN_REVIEW",
        "summary": "Structural general-knowledge sentinels are checked. Full semantic exclusion of unsourced knowledge is not fully evaluable by rule-based validation.",
    },
    {
        "id": "LIVE_BLOG_V2_PLANNER_WRITER_END_TO_END_NOT_YET_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_LIMITATION",
        "status": "PRODUCTION_ACTIVATION_BLOCKER",
        "targetPhase": "PHASE_8",
        "summary": "Live OpenAI Planner → Writer → Validator has not been verified. This is a production activation blocker, not a PHASE 5 implementation failure.",
    },
    {
        "id": "IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_LIMITATION",
        "status": "KNOWN_LIMITATION",
        "hitlPath": "HITL_PATH_IMPLEMENTED",
        "finalVerificationTarget": "PHASE_8",
        "targetPhase": "PHASE_8_HUMAN_REVIEW",
        "summary": "Assigned ALT is CONTEXT_GROUNDED_METADATA from section/asset context. Pixel-to-ALT semantic match is not verified in PHASE 6.",
    },
    {
        "id": "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_LIMITATION",
        "status": "KNOWN_LIMITATION",
        "hitlPath": "HITL_PATH_IMPLEMENTED",
        "finalVerificationTarget": "PHASE_8",
        "targetPhase": "PHASE_7_OR_8_HITL",
        "summary": "availableImages currently lack reliable ownership/copyright metadata. Ownership is recorded as UNKNOWN unless the source explicitly provides it.",
    },
    {
        "id": "BLOG_V2_HITL_END_TO_END_REAL_SAMPLE_NOT_YET_VERIFIED",
        "ledger": "BLOG_V2_KNOWN_LIMITATION",
        "status": "PRODUCTION_ACTIVATION_BLOCKER",
        "targetPhase": "PHASE_8",
        "summary": "HITL UI/contract is implemented, but real live samples have not been reviewed. This is a production activation blocker.",
    },
)

_EVIDENCE_SOURCE_TYPE_MAP = {
    "review": SOURCE_REVIEW,
    "qna": SOURCE_EVIDENCE,
    "purchase_keyword": SOURCE_EVIDENCE,
    "ad_searchword": SOURCE_EVIDENCE,
    "gfa_performance": SOURCE_EVIDENCE,
    "order_sales": SOURCE_EVIDENCE,
}

_DETAIL_PAGE_PRODUCT_FIELDS = (
    "ingredients_or_components",
    "usage_steps",
)
_DETAIL_PAGE_INFERENCE_FIELDS = (
    "usp",
    "proof_points",
)
_DETAIL_PAGE_RESTRICTED_FIELDS = (
    "copy_constraints",
    "compliance_risks",
)


def blog_v2_known_blockers() -> list[dict[str, Any]]:
    return [dict(item) for item in BLOG_V2_KNOWN_BLOCKERS]


def blog_v2_known_limitations() -> list[dict[str, Any]]:
    return [dict(item) for item in BLOG_V2_KNOWN_LIMITATIONS]


def serialize_blog_generation_context(context: dict[str, Any]) -> str:
    return json.dumps(context, ensure_ascii=False, sort_keys=True)


def build_blog_generation_context(
    db: Session,
    *,
    base_context: dict[str, Any] | None = None,
    appeal: dict[str, Any] | None = None,
    sku_title: str = "",
    regenerate_instruction: str | None = None,
    previous_artifact: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize existing generation context into Blog V2 input. Does not invent facts."""
    if base_context is None:
        if not isinstance(appeal, dict):
            raise ValueError("blog_generation_context_requires_base_context_or_appeal")
        base_context = build_generation_context(
            db,
            appeal=appeal,
            channel="blog",
            sku_title=sku_title,
            regenerate_instruction=regenerate_instruction,
            previous_artifact=previous_artifact,
        )
    context = copy.deepcopy(base_context)
    appeal0 = appeal if isinstance(appeal, dict) else {}
    product = context.get("product") if isinstance(context.get("product"), dict) else {}
    appeal_ctx = context.get("appeal") if isinstance(context.get("appeal"), dict) else {}
    insight = context.get("insight") if isinstance(context.get("insight"), dict) else {}
    evidence_rows = context.get("evidence") if isinstance(context.get("evidence"), list) else []
    detail_pages = context.get("detail_page_reference") if isinstance(context.get("detail_page_reference"), list) else []

    unknowns: list[dict[str, Any]] = []
    source_facts: list[dict[str, Any]] = []
    product_facts: list[dict[str, Any]] = []
    brand_facts: list[dict[str, Any]] = []
    source_ids: list[str] = []

    def remember_source_id(value: Any) -> str | None:
        text = _text(value)
        if not text:
            return None
        if text not in source_ids:
            source_ids.append(text)
        return text

    sku_id = remember_source_id(product.get("sku_id") or appeal0.get("sku_id"))
    appeal_id = remember_source_id(appeal_ctx.get("appeal_id") or appeal0.get("appeal_id"))
    insight_id = remember_source_id(
        (appeal0.get("insight") or {}).get("insight_id") if isinstance(appeal0.get("insight"), dict) else None
    )

    for key, statement in (
        ("title", _prefixed("상품명", product.get("title"))),
        ("product_group", _prefixed("제품군", product.get("product_group"))),
        ("product_url", _prefixed("상품URL", product.get("product_url"))),
    ):
        if not statement:
            continue
        fact = _fact(
            fact_id=f"sf_product_{key}",
            fact_type=FACT_TYPE_PRODUCT,
            statement=statement,
            source_type=SOURCE_PRODUCT,
            classification=FACT_CLASS_PRODUCT_SOURCE,
            source_id=sku_id,
            source_field=key,
            source_path=f"product.{key}",
            confidence="HIGH",
            derived=False,
            allowed=True,
        )
        source_facts.append(fact)
        product_facts.append(fact)

    confirmed = product.get("confirmed_facts") if isinstance(product.get("confirmed_facts"), list) else []
    for idx, item in enumerate(confirmed):
        statement = _text(item)
        if not statement or any(statement == existing["statement"] for existing in product_facts):
            continue
        fact = _fact(
            fact_id=f"sf_product_confirmed_{idx + 1}",
            fact_type=FACT_TYPE_PRODUCT,
            statement=statement,
            source_type=SOURCE_PRODUCT,
            classification=FACT_CLASS_PRODUCT_SOURCE,
            source_id=sku_id,
            source_field="confirmed_facts",
            source_path=f"product.confirmed_facts[{idx}]",
            confidence="HIGH",
            derived=False,
            allowed=True,
        )
        source_facts.append(fact)
        product_facts.append(fact)

    for page_idx, page in enumerate(detail_pages):
        if not isinstance(page, dict):
            continue
        asset_id = remember_source_id(page.get("asset_id"))
        analysis = page.get("analysis") if isinstance(page.get("analysis"), dict) else {}
        for field in _DETAIL_PAGE_PRODUCT_FIELDS:
            for value_idx, statement in enumerate(_statements(analysis.get(field))):
                fact = _fact(
                    fact_id=f"sf_detail_{asset_id or page_idx}_{field}_{value_idx + 1}",
                    fact_type=FACT_TYPE_PRODUCT,
                    statement=statement,
                    source_type=SOURCE_DETAIL_PAGE,
                    classification=FACT_CLASS_INFERENCE,
                    source_id=asset_id,
                    source_field=field,
                    source_path=f"detail_page_reference[{page_idx}].analysis.{field}[{value_idx}]",
                    confidence="MEDIUM",
                    derived=True,
                    allowed=True,
                )
                source_facts.append(fact)
                product_facts.append(fact)
        for field in _DETAIL_PAGE_INFERENCE_FIELDS:
            for value_idx, statement in enumerate(_statements(analysis.get(field))):
                fact = _fact(
                    fact_id=f"sf_detail_{asset_id or page_idx}_{field}_{value_idx + 1}",
                    fact_type=FACT_TYPE_PRODUCT,
                    statement=statement,
                    source_type=SOURCE_DETAIL_PAGE,
                    classification=FACT_CLASS_INFERENCE,
                    source_id=asset_id,
                    source_field=field,
                    source_path=f"detail_page_reference[{page_idx}].analysis.{field}[{value_idx}]",
                    confidence="MEDIUM",
                    derived=True,
                    allowed=True,
                )
                source_facts.append(fact)

    audience_problem = _text(insight.get("problem"))
    if audience_problem:
        source_facts.append(
            _fact(
                fact_id="sf_insight_problem",
                fact_type=FACT_TYPE_INSIGHT,
                statement=audience_problem,
                source_type=SOURCE_INSIGHT,
                classification=FACT_CLASS_FACT_SOURCE,
                source_id=insight_id,
                source_field="problem",
                source_path="insight.problem",
                confidence="HIGH",
                derived=False,
                allowed=True,
            )
        )
    else:
        _add_unknown(unknowns, "audienceProblem", STATUS_SOURCE_NOT_AVAILABLE)

    topic = _text(appeal_ctx.get("label")) or _text(product.get("title"))
    if not topic:
        topic = None
        _add_unknown(unknowns, "topic", STATUS_SOURCE_NOT_AVAILABLE)

    category = STATUS_UNKNOWN
    _add_unknown(unknowns, "category", STATUS_UNKNOWN)

    target_audience = {
        "primary": None,
        "secondary": None,
        "status": STATUS_UNKNOWN,
    }
    _add_unknown(unknowns, "targetAudience.primary", STATUS_UNKNOWN)
    _add_unknown(unknowns, "targetAudience.secondary", STATUS_UNKNOWN)

    search_context = {
        "primaryKeyword": None,
        "relatedKeywords": [],
        "knownUserIntent": None,
        "intentStatus": STATUS_PENDING_ANALYSIS,
    }
    _add_unknown(unknowns, "searchContext.primaryKeyword", STATUS_SOURCE_NOT_AVAILABLE)
    _add_unknown(unknowns, "searchContext.relatedKeywords", STATUS_SOURCE_NOT_AVAILABLE)
    _add_unknown(unknowns, "searchContext.knownUserIntent", STATUS_PENDING_ANALYSIS)

    selected_appeals = _selected_appeal_points(appeal_ctx, appeal0, appeal_id)
    evidence = _normalize_evidence(evidence_rows, appeal0, remember_source_id)
    available_images = _available_images(db, product, detail_pages, remember_source_id)
    allowed_claims, restricted_claims = _claim_maps(
        db,
        product_facts=product_facts,
        source_facts=source_facts,
        evidence=evidence,
        appeal_ctx=appeal_ctx,
        detail_pages=detail_pages,
    )

    if not brand_facts:
        _add_unknown(unknowns, "brandFacts", STATUS_SOURCE_NOT_AVAILABLE)
    if not available_images:
        _add_unknown(unknowns, "availableImages", STATUS_SOURCE_NOT_AVAILABLE)
    _add_unknown(unknowns, "internalLinkCandidates", STATUS_NOT_APPLICABLE)
    _add_unknown(unknowns, "commercialDisclosure", STATUS_UNKNOWN)
    if not any(item.get("sourceType") == SOURCE_EXTERNAL for item in source_facts + evidence):
        _add_unknown(unknowns, "sourceFacts.EXTERNAL_SOURCE", STATUS_SOURCE_NOT_AVAILABLE)
    if not any(item.get("classification") == FACT_CLASS_GENERAL_KNOWLEDGE for item in source_facts):
        _add_unknown(unknowns, "sourceFacts.GENERAL_KNOWLEDGE", STATUS_NOT_APPLICABLE)

    payload = {
        "version": BLOG_GENERATION_CONTEXT_VERSION,
        "topic": topic,
        "category": category,
        "targetAudience": target_audience,
        "audienceProblem": audience_problem or None,
        "searchContext": search_context,
        "selectedAppealPoints": selected_appeals,
        "productFacts": product_facts,
        "brandFacts": brand_facts,
        "sourceFacts": source_facts,
        "evidence": evidence,
        "allowedClaims": allowed_claims,
        "restrictedClaims": restricted_claims,
        "internalLinkCandidates": [],
        "availableImages": available_images,
        "commercialDisclosure": {
            "required": None,
            "source": None,
            "status": STATUS_UNKNOWN,
        },
        "generationPolicy": dict(DEFAULT_GENERATION_POLICY),
        "unknowns": unknowns,
        "provenance": {
            "builderVersion": BLOG_GENERATION_CONTEXT_VERSION,
            "generationVersion": BLOG_V2_GENERATION_VERSION,
            "baseWriterVersion": context.get("writer_version"),
            "baseWriterModel": context.get("writer_model"),
            "baseChannel": context.get("channel"),
            "sourceIds": source_ids,
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "derived": False,
            "allowGeneralKnowledge": False,
        },
    }
    payload["marketingKnowledge"] = build_blog_marketing_knowledge(
        blog_context=payload,
        base_context=context,
        appeal=appeal0,
        db=db,
    )
    return payload


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _prefixed(label: str, value: Any) -> str:
    text = _text(value)
    return f"{label}: {text}" if text else ""


def _statements(value: Any) -> list[str]:
    if isinstance(value, list):
        items = value
    elif value is None or value == "":
        items = []
    else:
        items = [value]
    out: list[str] = []
    for item in items:
        text = _text(item)
        if text and text not in out:
            out.append(text)
    return out


def _fact(
    *,
    fact_id: str,
    fact_type: str,
    statement: str,
    source_type: str,
    classification: str,
    source_id: str | None,
    source_field: str,
    source_path: str,
    confidence: str,
    derived: bool,
    allowed: bool,
) -> dict[str, Any]:
    return {
        "factId": fact_id,
        "factType": fact_type,
        "statement": statement,
        "sourceType": source_type,
        "sourceRef": source_path,
        "classification": classification,
        "confidence": confidence,
        "allowedForGeneration": bool(allowed),
        "provenance": {
            "sourceType": source_type,
            "sourceId": source_id,
            "sourceField": source_field,
            "sourcePath": source_path,
            "confidence": confidence,
            "derived": bool(derived),
        },
    }


def _add_unknown(unknowns: list[dict[str, Any]], field: str, reason: str) -> None:
    item = {"field": field, "reason": reason, "status": reason}
    if item not in unknowns:
        unknowns.append(item)


def _selected_appeal_points(appeal_ctx: dict[str, Any], appeal0: dict[str, Any], appeal_id: str | None) -> list[dict[str, Any]]:
    label = _text(appeal_ctx.get("label") or appeal0.get("label"))
    appeal_text = _text(appeal_ctx.get("appeal_text") or appeal0.get("appeal_text"))
    if not label and not appeal_text and not appeal_id:
        return []
    return [
        {
            "appealId": appeal_id,
            "label": label or None,
            "appealText": appeal_text or None,
            "claimClass": appeal_ctx.get("claim_class") or appeal0.get("claim_class"),
            "legalRisk": appeal_ctx.get("legal_risk") or appeal0.get("legal_risk"),
            "safetyGate": appeal_ctx.get("safety_gate") or appeal0.get("safety_gate"),
            "sourceType": SOURCE_APPEAL,
            "sourceId": appeal_id,
            "provenance": {
                "sourceType": SOURCE_APPEAL,
                "sourceId": appeal_id,
                "sourceField": "appeal",
                "sourcePath": "appeal",
                "confidence": "HIGH" if appeal_id else "MEDIUM",
                "derived": False,
            },
        }
    ]


def _normalize_evidence(
    evidence_rows: list[Any],
    appeal0: dict[str, Any],
    remember_source_id,
) -> list[dict[str, Any]]:
    original = appeal0.get("evidence") if isinstance(appeal0.get("evidence"), list) else []
    by_snippet: dict[str, dict[str, Any]] = {}
    for item in original:
        if not isinstance(item, dict):
            continue
        snippet = _text(item.get("snippet"))
        if snippet:
            by_snippet[snippet] = item
    out: list[dict[str, Any]] = []
    for idx, item in enumerate(evidence_rows):
        if not isinstance(item, dict):
            continue
        snippet = _text(item.get("snippet"))
        if not snippet:
            continue
        matched = by_snippet.get(snippet, {})
        original_type = _text(item.get("source_type") or matched.get("source_type"))
        source_type = _EVIDENCE_SOURCE_TYPE_MAP.get(original_type, SOURCE_EVIDENCE if original_type else SOURCE_UNKNOWN)
        source_id = remember_source_id(matched.get("evidence_id") or matched.get("source_pk") or item.get("evidence_id") or item.get("source_pk"))
        metric = item.get("metric")
        if metric is None and matched.get("metric_json"):
            try:
                metric = json.loads(matched.get("metric_json") or "")
            except Exception:
                metric = None
        out.append(
            {
                "evidenceId": matched.get("evidence_id") or item.get("evidence_id") or None,
                "statement": snippet,
                "sourceType": source_type,
                "originalSourceType": original_type or None,
                "sourcePk": matched.get("source_pk") or item.get("source_pk") or None,
                "metric": metric if isinstance(metric, (dict, list, str, int, float, bool)) or metric is None else None,
                "allowedForGeneration": not bool(matched.get("is_excluded")),
                "classification": SOURCE_EVIDENCE,
                "provenance": {
                    "sourceType": source_type,
                    "sourceId": source_id,
                    "sourceField": "snippet",
                    "sourcePath": f"evidence[{idx}]",
                    "confidence": "HIGH" if source_id else "MEDIUM",
                    "derived": False,
                },
            }
        )
    return out


def _available_images(db: Session, product: dict[str, Any], detail_pages: list[Any], remember_source_id) -> list[dict[str, Any]]:
    images: list[dict[str, Any]] = []
    seen: set[str] = set()
    for page in detail_pages:
        if not isinstance(page, dict):
            continue
        asset_id = _text(page.get("asset_id"))
        file_url = _text(page.get("file_url"))
        if not asset_id or asset_id in seen:
            continue
        seen.add(asset_id)
        remember_source_id(asset_id)
        images.append(
            {
                "assetId": asset_id,
                "assetType": "detail_page",
                "source": "detail_page_reference",
                "status": "ANALYZED",
                "fileUrl": file_url or None,
            }
        )
    sku_id = _text(product.get("sku_id"))
    if not sku_id:
        return images
    try:
        from content_center_assets import primary_product_asset_reference

        reference = primary_product_asset_reference(db, sku_id)
    except Exception:
        reference = {}
    asset_id = _text(reference.get("asset_id"))
    file_url = _text(reference.get("product_image_url"))
    if asset_id and asset_id not in seen and file_url:
        seen.add(asset_id)
        remember_source_id(asset_id)
        images.append(
            {
                "assetId": asset_id,
                "assetType": "product_image",
                "source": _text(reference.get("source")) or "content_sku_asset",
                "status": "READY",
                "fileUrl": file_url,
            }
        )
    return images


def _claim_maps(
    db: Session,
    *,
    product_facts: list[dict[str, Any]],
    source_facts: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    appeal_ctx: dict[str, Any],
    detail_pages: list[Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    ensure_claim_policies(db)
    policies = db.query(ContentClaimPolicy).filter(ContentClaimPolicy.is_active.is_(True)).all()
    source_blob = "\n".join(
        [
            *[str(item.get("statement") or "") for item in source_facts],
            *[str(item.get("statement") or "") for item in evidence],
            _text(appeal_ctx.get("label")),
            _text(appeal_ctx.get("appeal_text")),
        ]
    )
    restricted: list[dict[str, Any]] = []
    seen_terms: set[str] = set()
    for row in policies:
        term = _text(row.pattern)
        if not term or term in seen_terms:
            continue
        seen_terms.add(term)
        matched = term in source_blob
        claim_class = _text(row.claim_class) or "RESTRICTED"
        restricted.append(
            {
                "term": term,
                "reason": _text(row.note) or claim_class,
                "policySource": "existing_claim_gate",
                "policyId": row.policy_id,
                "claimClass": claim_class,
                "status": CLAIM_STATUS_FORBIDDEN if claim_class == "PROHIBITED" else CLAIM_STATUS_REVIEW_REQUIRED,
                "matchedInSource": matched,
            }
        )
    for page_idx, page in enumerate(detail_pages):
        if not isinstance(page, dict):
            continue
        analysis = page.get("analysis") if isinstance(page.get("analysis"), dict) else {}
        asset_id = _text(page.get("asset_id")) or None
        for field in _DETAIL_PAGE_RESTRICTED_FIELDS:
            for statement in _statements(analysis.get(field)):
                key = statement
                if key in seen_terms:
                    continue
                seen_terms.add(key)
                restricted.append(
                    {
                        "term": statement,
                        "reason": "detail page analysis constraint",
                        "policySource": "detail_page_analysis",
                        "policyId": None,
                        "claimClass": "RESTRICTED",
                        "status": CLAIM_STATUS_REVIEW_REQUIRED,
                        "matchedInSource": True,
                        "sourceId": asset_id,
                        "sourcePath": f"detail_page_reference[{page_idx}].analysis.{field}",
                    }
                )

    restricted_terms = [item["term"] for item in restricted if item.get("claimClass") == "PROHIBITED" or item.get("status") == CLAIM_STATUS_FORBIDDEN]
    allowed: list[dict[str, Any]] = []
    for fact in product_facts:
        if fact.get("classification") != FACT_CLASS_PRODUCT_SOURCE:
            continue
        if fact.get("provenance", {}).get("derived"):
            continue
        statement = _text(fact.get("statement"))
        if not statement:
            continue
        if any(term and term in statement for term in restricted_terms):
            continue
        allowed.append(
            {
                "claim": statement,
                "sourceRefs": [fact.get("sourceRef") or fact.get("factId")],
                "status": CLAIM_STATUS_SUPPORTED,
                "factId": fact.get("factId"),
            }
        )
    gate = claim_gate_text(db, source_blob)
    if not gate.get("allowed"):
        for hit in gate.get("hits") or []:
            if not isinstance(hit, dict):
                continue
            term = _text(hit.get("pattern"))
            if term and term not in seen_terms:
                restricted.append(
                    {
                        "term": term,
                        "reason": _text(hit.get("note")) or "claim_gate_text",
                        "policySource": "existing_claim_gate",
                        "policyId": None,
                        "claimClass": _text(hit.get("claim_class")) or "PROHIBITED",
                        "status": CLAIM_STATUS_FORBIDDEN,
                        "matchedInSource": True,
                    }
                )
    return allowed, restricted
