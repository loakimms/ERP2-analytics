"""Routes: reply integrity summary, historical knowledge corpus/queue/validation, lexical retrieval, draft lineage."""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from collections import Counter
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import Body, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from admin_users import _normalize_roles_from_claims, _primary_role, _role_rank, get_claims_from_request, require_role_level

from db import (
    ContentProductInfo,
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyBodyAudit,
    ReviewReplyDraft,
    ReviewReplyDraftRevision,
    ReviewReplyKnowledgeClaimFactValidation,
    ReviewReplyKnowledgePolicyDecision,
    ReviewReplyKnowledgeSourceApplicability,
    ReviewReplyKnowledgeUnitFactValidation,
    ReviewReplyKnowledgeValidation,
)
from review_reply_integrity import classify_recovery_eligibility, classify_reply_body
from review_reply_knowledge import (
    CONTENT_VALIDATION_STATES,
    HUMAN_REFERENCE_TIERS,
    QUEUE_FILTERS,
    RETRIEVAL_STATUS,
    build_corpus,
    build_verification_queue,
    parse_payload,
    retrieve,
)
from review_reply_knowledge_analysis_labels import label_knowhow_items
from review_reply_knowledge_unit_facts import (
    FACT_STATES,
    GATE_B_DECISIONS,
    UnitFactValidationError,
    gate_b_queue_view,
    gate_b_request_sha256,
    is_fact_candidate,
    load_official_source_registry,
    product_skus_from_rows,
    registry_view,
    unit_snapshot,
    unit_text_sha256,
    validate_gate_b_submission,
    validate_unit_fact_submission,
)
from review_reply_knowledge_claims import (
    claim_artifact,
    claim_request_sha256,
    claim_unit,
    claims_for_item,
    unit_verified_guard,
    validate_claim_submission,
)
import review_reply_knowledge_policy as policy_module
from review_reply_lineage import build_lineage_view

VALIDATION_WRITE_ENV = "REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED"
VALIDATOR_MIN_ROLE = "ops_admin"
_TRI_STATE = ("yes", "no", "unsure")
_QUESTION_FIELDS = ("reply_appropriate", "guidance_accurate", "currently_valid", "reference_worthy")
_NOTE_MIN_CHARS = 5
_CACHE_LOCK = threading.Lock()
_CACHE: dict = {"key": None, "corpus": None, "built_at": 0.0}


def validation_write_enabled() -> bool:
    return str(os.getenv(VALIDATION_WRITE_ENV) or "").strip().lower() in ("1", "true", "yes", "on")


def validator_permission(request: Request) -> dict:
    try:
        claims = get_claims_from_request(request)
    except Exception:
        return {"authenticated": False, "can_validate": False, "role": None, "required_role": VALIDATOR_MIN_ROLE}
    role = _primary_role(_normalize_roles_from_claims(claims))
    return {
        "authenticated": True,
        "can_validate": _role_rank(role) >= _role_rank(VALIDATOR_MIN_ROLE),
        "role": role,
        "required_role": VALIDATOR_MIN_ROLE,
    }


IDENTITY_PROTECTED_FIELDS = frozenset({"reviewer", "reviewer_uid", "reviewer_email", "note", "basis_reference", "basis_summary"})
_PRIVATE_RESPONSE_HEADERS = {"Cache-Control": "private, no-store", "Vary": "Authorization"}


def identity_visible(request: Request) -> bool:
    """Reviewer identity and internal notes need a verified ops_admin+ token; REQUIRE_FIREBASE_AUTH=0 grants nothing."""
    return bool(validator_permission(request)["can_validate"])


def _is_registry_source(obj: dict) -> bool:
    return "authority_class" in obj and "entries" in obj


def redact_identity(obj):
    """Independent copy with protected fields nulled at every depth. Registry source descriptors keep their static
    `note`. Never mutates the input (the shared corpus cache)."""
    if isinstance(obj, dict):
        keep_note = _is_registry_source(obj)
        return {
            k: None if k in IDENTITY_PROTECTED_FIELDS and not (keep_note and k == "note") else redact_identity(v)
            for k, v in obj.items()
        }
    if isinstance(obj, (list, tuple)):
        return [redact_identity(v) for v in obj]
    return obj


def private_view(request: Request, response: Response, payload: dict) -> dict:
    response.headers.update(_PRIVATE_RESPONSE_HEADERS)
    visible = identity_visible(request)
    return {**(payload if visible else redact_identity(payload)), "identity_redacted": not visible}


def validate_submission(content_validation: str, answers: dict, note: str | None) -> None:
    if not note or len(note) < _NOTE_MIN_CHARS:
        raise HTTPException(status_code=400, detail="validation_note_required")
    if content_validation == "APPROVED":
        if any(answers.get(field) is None for field in _QUESTION_FIELDS):
            raise HTTPException(status_code=400, detail="approval_requires_all_answers")
        if any(answers.get(field) != "yes" for field in _QUESTION_FIELDS):
            raise HTTPException(status_code=400, detail="approval_requires_all_yes")


def _cache_key(db: Session) -> tuple:
    return (
        db.query(func.count(NaverReviewRaw.review_key)).scalar(),
        str(db.query(func.max(NaverReviewRaw.updated_at)).scalar()),
        db.query(func.count(NaverReviewReplyRaw.review_key)).scalar(),
        str(db.query(func.max(NaverReviewReplyRaw.updated_at)).scalar()),
        db.query(func.count(ReviewReplyDraft.draft_id)).scalar(),
        db.query(func.count(ReviewReplyKnowledgeValidation.validation_id)).scalar(),
        db.query(func.count(ReviewReplyKnowledgeUnitFactValidation.unit_fact_validation_id)).scalar(),
        db.query(func.count(ReviewReplyKnowledgeSourceApplicability.applicability_id)).scalar(),
        db.query(func.count(ContentProductInfo.sku_id)).scalar(),
        str(db.query(func.max(ContentProductInfo.updated_at)).scalar()),
    )


_DERIVED_UNIT_KEYS = ("factValidation", "generatorFactEligible", "factUseBlockedReasons")


def _extraction_snapshot(units: list[dict]) -> list[dict]:
    return [{k: v for k, v in u.items() if k not in _DERIVED_UNIT_KEYS} for u in units]


def _parse_json(raw: str | None, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _unit_fact_dict(row: ReviewReplyKnowledgeUnitFactValidation) -> dict:
    return {
        "unit_fact_validation_id": row.unit_fact_validation_id,
        "unit_key": row.unit_key,
        "knowledge_id": row.knowledge_id,
        "review_key": row.review_key,
        "reply_sha256_at_validation": row.reply_sha256_at_validation,
        "extraction_version": row.extraction_version,
        "source_span": [row.source_span_start, row.source_span_end],
        "unit_text": row.unit_text,
        "unit_text_sha256": row.unit_text_sha256,
        "unit_snapshot": _parse_json(row.unit_snapshot_json, None),
        "fact_status": row.fact_status,
        "statement_accurate": row.statement_accurate,
        "product_applicable": row.product_applicable,
        "condition_accurate": row.condition_accurate,
        "sequence_accurate": row.sequence_accurate,
        "numeric_accurate": row.numeric_accurate,
        "generator_reference_allowed": row.generator_reference_allowed,
        "evidence": _parse_json(row.evidence_json, []),
        "source_registry_version": row.source_registry_version,
        "verified_scope": row.verified_scope,
        "hold_reason": row.hold_reason,
        "note": row.note,
        "reviewer_uid": row.reviewer_uid,
        "reviewer_email": row.reviewer_email,
        "reviewer_role": row.reviewer_role,
        "parent_authority_at_validation": row.parent_authority_at_validation,
        "corpus_version": row.corpus_version,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def load_unit_fact_records(db: Session) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    rows = (
        db.query(ReviewReplyKnowledgeUnitFactValidation)
        .order_by(ReviewReplyKnowledgeUnitFactValidation.created_at.asc(), ReviewReplyKnowledgeUnitFactValidation.unit_fact_validation_id.asc())
        .all()
    )
    for row in rows:
        out.setdefault(str(row.knowledge_id), []).append(_unit_fact_dict(row))
    return out


def _claim_dict(row: ReviewReplyKnowledgeClaimFactValidation) -> dict:
    return {
        "claim_validation_id": row.claim_validation_id,
        "request_id": row.request_id,
        "supersedes_record_id": row.supersedes_record_id,
        "claim_key": row.claim_key,
        "claim_decomposition_version": row.claim_decomposition_version,
        "claim_text": row.claim_text,
        "claim_text_sha256": row.claim_text_sha256,
        "claim_spans": _parse_json(row.claim_spans_json, None),
        "claim_snapshot": _parse_json(row.claim_snapshot_json, None),
        "parent_unit_key": row.parent_unit_key,
        "parent_unit_text_sha256": row.parent_unit_text_sha256,
        "knowledge_id": row.knowledge_id,
        "review_key": row.review_key,
        "reply_sha256_at_validation": row.reply_sha256_at_validation,
        "fact_status": row.fact_status,
        "statement_accurate": row.statement_accurate,
        "product_applicable": row.product_applicable,
        "condition_accurate": row.condition_accurate,
        "sequence_accurate": row.sequence_accurate,
        "numeric_accurate": row.numeric_accurate,
        "target_color_accurate": row.target_color_accurate,
        "official_color_label": row.official_color_label,
        "generator_reference_allowed": row.generator_reference_allowed,
        "evidence": _parse_json(row.evidence_json, []),
        "source_registry_version": row.source_registry_version,
        "verified_scope": row.verified_scope,
        "hold_reason": row.hold_reason,
        "note": row.note,
        "reviewer_uid": row.reviewer_uid,
        "reviewer_email": row.reviewer_email,
        "reviewer_role": row.reviewer_role,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def load_claim_records(db: Session, knowledge_id: str) -> list[dict]:
    rows = (
        db.query(ReviewReplyKnowledgeClaimFactValidation)
        .filter(ReviewReplyKnowledgeClaimFactValidation.knowledge_id == knowledge_id)
        .order_by(ReviewReplyKnowledgeClaimFactValidation.created_at.asc(), ReviewReplyKnowledgeClaimFactValidation.claim_validation_id.asc())
        .all()
    )
    by_id = {r.claim_validation_id: _claim_dict(r) for r in rows}
    # Chain order (supersedes links) is authoritative; timestamps can tie.
    out: list[dict] = []
    by_parent: dict[tuple[str, str], dict] = {(r["claim_key"], r["supersedes_record_id"]): r for r in by_id.values()}
    for key in sorted({r["claim_key"] for r in by_id.values()}):
        prev = "ROOT"
        while (key, prev) in by_parent:
            rec = by_parent[(key, prev)]
            out.append(rec)
            prev = rec["claim_validation_id"]
    return out


def _applicability_dict(row: ReviewReplyKnowledgeSourceApplicability) -> dict:
    return {
        "applicability_id": row.applicability_id,
        "request_id": row.request_id,
        "supersedes_record_id": row.supersedes_record_id,
        "source_id": row.source_id,
        "source_version": row.source_version,
        "source_sha256": row.source_sha256,
        "registry_version": row.registry_version,
        "registry_file_sha256": row.registry_file_sha256,
        "entry_key": row.entry_key,
        "entry_kind": row.entry_kind,
        "entry_content_sha256": row.entry_content_sha256,
        "original_text": row.original_text,
        "source_location": _parse_json(row.source_location_json, None),
        "gate_a_status": row.gate_a_status,
        "decision": row.decision,
        "products": _parse_json(row.products_json, []),
        "skus": _parse_json(row.skus_json, []),
        "application_modes": _parse_json(row.application_modes_json, []),
        "condition": row.condition,
        "numeric_tokens": _parse_json(row.numeric_tokens_json, []),
        "procedure": _parse_json(row.procedure_json, None),
        "approved_fact_scope": row.approved_fact_scope,
        "limitations_exceptions": row.limitations_exceptions,
        "product_applicable": row.product_applicable,
        "usage_accurate": row.usage_accurate,
        "exceptions_checked": row.exceptions_checked,
        "scope_clear": row.scope_clear,
        "company_standard_confirmed": row.company_standard_confirmed,
        "basis_type": row.basis_type,
        "basis_reference": row.basis_reference,
        "basis_summary": row.basis_summary,
        "note": row.note,
        "reviewer_uid": row.reviewer_uid,
        "reviewer_email": row.reviewer_email,
        "reviewer_role": row.reviewer_role,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def load_applicability_records(db: Session) -> list[dict]:
    rows = (
        db.query(ReviewReplyKnowledgeSourceApplicability)
        .order_by(ReviewReplyKnowledgeSourceApplicability.created_at.asc(), ReviewReplyKnowledgeSourceApplicability.applicability_id.asc())
        .all()
    )
    return [_applicability_dict(r) for r in rows]


def _policy_dict(row: ReviewReplyKnowledgePolicyDecision) -> dict:
    return {
        "decision_id": row.decision_id,
        "request_id": row.request_id,
        "supersedes_record_id": row.supersedes_record_id,
        "question_id": row.question_id,
        "question_version": row.question_version,
        "question_sha256": row.question_sha256,
        "decision": row.decision,
        "decision_text": row.decision_text,
        "products": _parse_json(row.products_json, []),
        "issue_ids": _parse_json(row.issue_ids_json, []),
        "condition_key": row.condition_key,
        "exception_knowledge_ids": _parse_json(row.exceptions_json, []),
        "evidence": _parse_json(row.evidence_json, []),
        "source_registry_version": row.source_registry_version,
        "linked_refs": _parse_json(row.linked_refs_json, {}),
        "note": row.note,
        "reviewer_uid": row.reviewer_uid,
        "reviewer_email": row.reviewer_email,
        "reviewer_role": row.reviewer_role,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def load_policy_records(db: Session) -> list[dict]:
    """All policy decisions, each question's records in supersedes-chain order (oldest first)."""
    by_question: dict[str, dict[str, dict]] = {}
    for row in db.query(ReviewReplyKnowledgePolicyDecision).all():
        by_question.setdefault(row.question_id, {})[row.supersedes_record_id] = _policy_dict(row)
    out = []
    for chain in by_question.values():
        cursor = policy_module.ROOT
        while cursor in chain:
            out.append(chain[cursor])
            cursor = chain[cursor]["decision_id"]
    return out


def _product_info_rows(db: Session) -> list[dict]:
    return [
        {"sku_id": r.sku_id, "product_url": r.product_url, "product_items_json": r.product_items_json}
        for r in db.query(ContentProductInfo.sku_id, ContentProductInfo.product_url, ContentProductInfo.product_items_json).all()
    ]


def load_fact_registry(db: Session, *, applicability_records: list[dict] | None = None) -> dict:
    records = load_applicability_records(db) if applicability_records is None else applicability_records
    return load_official_source_registry(product_info_rows=_product_info_rows(db), applicability_records=records)


def load_latest_validations(db: Session) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    rows = db.query(ReviewReplyKnowledgeValidation).order_by(ReviewReplyKnowledgeValidation.created_at.asc()).all()
    for row in rows:
        latest[str(row.knowledge_id)] = _validation_dict(row)
    return latest


def _parse_snapshot(raw: str | None) -> list | None:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except Exception:
        return None
    return value if isinstance(value, list) else None


def _validation_dict(row: ReviewReplyKnowledgeValidation) -> dict:
    return {
        "validation_id": row.validation_id,
        "knowledge_id": row.knowledge_id,
        "content_validation": row.content_validation,
        "reply_appropriate": row.reply_appropriate,
        "guidance_accurate": row.guidance_accurate,
        "currently_valid": row.currently_valid,
        "reference_worthy": row.reference_worthy,
        "note": row.note,
        "reviewer": row.reviewer,
        "reviewer_uid": row.reviewer_uid,
        "reviewer_email": row.reviewer_email,
        "reviewer_role": row.reviewer_role,
        "corpus_version": row.corpus_version,
        "knowhow_snapshot": _parse_snapshot(row.knowhow_snapshot_json),
        "authorship_class_at_validation": row.authorship_class_at_validation,
        "reply_sha256_at_validation": row.reply_sha256_at_validation,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def load_corpus(db: Session, *, use_cache: bool = True) -> dict:
    key = _cache_key(db)
    with _CACHE_LOCK:
        if use_cache and _CACHE["key"] == key and _CACHE["corpus"] is not None:
            return _CACHE["corpus"]
    reviews = [
        {
            "review_key": r.review_key,
            "product_url": r.product_url,
            "product_title": r.product_title,
            "review_written_at": r.review_written_at,
            "rating": r.rating,
            "review_text": r.review_text,
            "import_source": r.import_source,
            "reply_exists_flag": r.reply_exists_flag,
            "reply_collect_status": r.reply_collect_status,
            "raw_payload_json": r.raw_payload_json,
        }
        for r in db.query(NaverReviewRaw).all()
    ]
    replies = {
        str(r.review_key): {
            "reply_text": r.reply_text,
            "reply_written_at": r.reply_written_at,
            "raw_payload_json": r.raw_payload_json,
        }
        for r in db.query(NaverReviewReplyRaw).all()
    }
    drafts: dict[str, list[dict]] = {}
    for d in db.query(
        ReviewReplyDraft.draft_id,
        ReviewReplyDraft.review_key,
        ReviewReplyDraft.status,
        ReviewReplyDraft.draft_text,
        ReviewReplyDraft.original_ai_text,
        ReviewReplyDraft.model_name,
        ReviewReplyDraft.generated_at,
    ).all():
        drafts.setdefault(str(d.review_key), []).append(
            {
                "draft_id": d.draft_id,
                "status": d.status,
                "draft_text": d.draft_text,
                "original_ai_text": d.original_ai_text,
                "model_name": d.model_name,
                "generated_at": d.generated_at,
            }
        )
    corpus = build_corpus(
        reviews=reviews,
        replies=replies,
        drafts_by_review=drafts,
        latest_validations=load_latest_validations(db),
        unit_fact_records=load_unit_fact_records(db),
        fact_registry=load_fact_registry(db),
    )
    with _CACHE_LOCK:
        _CACHE.update({"key": key, "corpus": corpus, "built_at": time.time()})
    return corpus


def build_integrity_summary(db: Session) -> dict:
    reviews = {
        str(r.review_key): r
        for r in db.query(
            NaverReviewRaw.review_key,
            NaverReviewRaw.review_id_original,
            NaverReviewRaw.raw_payload_json,
            NaverReviewRaw.reply_collect_status,
        ).all()
    }
    verdicts: Counter = Counter()
    eligibility: Counter = Counter()
    eligibility_by_verdict: Counter = Counter()
    for reply in db.query(NaverReviewReplyRaw.review_key, NaverReviewReplyRaw.reply_text).all():
        review = reviews.get(str(reply.review_key))
        if review is None:
            continue
        verdict = classify_reply_body(reply.reply_text)
        verdicts[verdict] += 1
        payload = parse_payload(review.raw_payload_json)
        result = classify_recovery_eligibility(
            stored_reply_text=reply.reply_text,
            review_id_original=review.review_id_original,
            excel_reply_flag=payload.get("답글여부"),
            excel_reply_written_at=payload.get("답글등록일시"),
        )
        if result["eligibility"] != "NOT_CONTAMINATED":
            eligibility[result["eligibility"]] += 1
            eligibility_by_verdict[f"{verdict}|{result['eligibility']}"] += 1
    audit = Counter(
        f"{row.event}|{row.body_verdict}"
        for row in db.query(ReviewReplyBodyAudit.event, ReviewReplyBodyAudit.body_verdict).all()
    )
    invalid_status_rows = (
        db.query(func.count(NaverReviewRaw.review_key))
        .filter(NaverReviewRaw.reply_collect_status == "invalid_reply_body")
        .scalar()
    )
    return {
        "stored_reply_body_verdicts": dict(verdicts),
        "recovery_eligibility_dry_run": dict(eligibility),
        "recovery_eligibility_by_verdict": dict(eligibility_by_verdict),
        "body_audit_events": dict(audit),
        "reviews_with_invalid_reply_body_status": int(invalid_status_rows or 0),
        "existing_db_restoration": "NOT_RUN",
        "bulk_recollection": "NOT_RUN",
    }


def _queue_item_view(item: dict) -> dict:
    knowhow_items, analysis_labels = label_knowhow_items(item["knowhow_items"])
    return {
        "knowledge_id": item["knowledge_id"],
        "review_key": item["review_key"],
        "product_title": item.get("product_title"),
        "product_group": item["product_group"],
        "rating": item.get("rating"),
        "review_written_at": item.get("review_written_at"),
        "remote_reply_date": item.get("remote_reply_date"),
        "review_text": item["review_text"],
        "reply_text": item["reply_text"],
        "authorship": item["authorship"],
        "authorship_evidence": item["authorship_evidence"],
        "tier": item["tier"],
        "has_knowhow": item["has_knowhow"],
        "knowhow_items": knowhow_items,
        "analysis_labels": analysis_labels,
        "review_topics": item["review_topics"],
        "reply_topics": item["reply_topics"],
        "review_signals": item["review_signals"],
        "template_like": item["template_like"],
        "policy_violations": item["policy_violations"],
        "content_validation": item["content_validation"],
        "latest_validation": item.get("latest_validation"),
        "queue_priority": item.get("queue_priority"),
        "extraction_version": item.get("extraction_version"),
        "extraction_change": item.get("extraction_change"),
        "previous_extraction": item.get("previous_extraction"),
        "revalidation_required": bool(item.get("revalidation_required")),
        "current_use_authority": item.get("current_use_authority"),
        "reply_reference_eligible": bool(item.get("reply_reference_eligible")),
        "generator_fact_eligible": bool(item.get("generator_fact_eligible")),
        "approved_retrieval_boost": bool(item.get("approved_retrieval_boost")),
        "fact_ineligible_reasons": item.get("fact_ineligible_reasons") or [],
        "unit_fact_counts": item.get("unit_fact_counts"),
    }


def register_review_reply_knowledge_routes(app, *, get_db_dep) -> None:
    @app.get("/reviews/reply-integrity/summary", response_model=dict)
    def review_reply_integrity_summary(db: Session = Depends(get_db_dep)):
        return build_integrity_summary(db)

    @app.get("/reviews/reply-knowledge/summary", response_model=dict)
    def review_reply_knowledge_summary(db: Session = Depends(get_db_dep)):
        corpus = load_corpus(db)
        return {
            **corpus["summary"],
            "corpus_version": corpus["corpus_version"],
            "validation_write_enabled": validation_write_enabled(),
            "content_validation_states": list(CONTENT_VALIDATION_STATES),
            "unit_fact_states": list(FACT_STATES),
            "queue_filters": list(QUEUE_FILTERS),
        }

    @app.get("/reviews/reply-knowledge/queue", response_model=dict)
    def review_reply_knowledge_queue(
        request: Request,
        response: Response,
        queue_filter: str = Query("unknown_knowhow"),
        content_validation: str | None = Query(None),
        product_group: str | None = Query(None),
        topic: str | None = Query(None),
        limit: int = Query(30, ge=1, le=200),
        offset: int = Query(0, ge=0),
        db: Session = Depends(get_db_dep),
    ):
        if queue_filter not in QUEUE_FILTERS:
            raise HTTPException(status_code=400, detail="invalid_queue_filter")
        if content_validation and content_validation not in CONTENT_VALIDATION_STATES:
            raise HTTPException(status_code=400, detail="invalid_content_validation")
        corpus = load_corpus(db)
        rows = build_verification_queue(
            corpus["items"],
            queue_filter=queue_filter,
            content_validation=content_validation or None,
            product_group_filter=product_group or None,
            topic=topic or None,
        )
        return private_view(request, response, {
            "total": len(rows),
            "offset": offset,
            "limit": limit,
            "items": [_queue_item_view(x) for x in rows[offset : offset + limit]],
            "validation_write_enabled": validation_write_enabled(),
        })

    @app.get("/reviews/reply-knowledge/items/{knowledge_id}", response_model=dict)
    def review_reply_knowledge_item(knowledge_id: str, request: Request, response: Response, db: Session = Depends(get_db_dep)):
        corpus = load_corpus(db)
        item = next((x for x in corpus["items"] if x["knowledge_id"] == knowledge_id), None)
        if item is None:
            raise HTTPException(status_code=404, detail="knowledge_item_not_found")
        history = (
            db.query(ReviewReplyKnowledgeValidation)
            .filter(ReviewReplyKnowledgeValidation.knowledge_id == knowledge_id)
            .order_by(ReviewReplyKnowledgeValidation.created_at.desc())
            .all()
        )
        unit_history = (
            db.query(ReviewReplyKnowledgeUnitFactValidation)
            .filter(ReviewReplyKnowledgeUnitFactValidation.knowledge_id == knowledge_id)
            .order_by(ReviewReplyKnowledgeUnitFactValidation.created_at.desc())
            .all()
        )
        return private_view(request, response, {
            **_queue_item_view(item),
            "validation_history": [_validation_dict(x) for x in history],
            "unit_fact_history": [_unit_fact_dict(x) for x in unit_history],
        })

    @app.get("/reviews/reply-knowledge/official-sources", response_model=dict)
    def review_reply_knowledge_official_sources(request: Request, response: Response, db: Session = Depends(get_db_dep)):
        return private_view(request, response, registry_view(load_corpus(db)["fact_registry"]))

    @app.get("/reviews/reply-knowledge/source-applicability", response_model=dict)
    def review_reply_knowledge_source_applicability(request: Request, response: Response, db: Session = Depends(get_db_dep)):
        corpus = load_corpus(db)
        view = gate_b_queue_view(corpus["fact_registry"], load_applicability_records(db), product_skus_from_rows(_product_info_rows(db)))
        return private_view(request, response, {**view, "validation_write_enabled": validation_write_enabled()})

    @app.post("/reviews/reply-knowledge/source-applicability", response_model=dict)
    def create_review_reply_knowledge_source_applicability(
        request: Request, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)
    ):
        if not validation_write_enabled():
            raise HTTPException(status_code=409, detail="knowledge_validation_write_not_enabled")
        roles = require_role_level(request, minimum=VALIDATOR_MIN_ROLE)
        claims = get_claims_from_request(request)
        reviewer_uid = str(claims.get("sub") or claims.get("uid") or claims.get("user_id") or "").strip() or None
        reviewer_email = str(claims.get("email") or "").strip() or None
        if not reviewer_uid and not reviewer_email:
            raise HTTPException(status_code=401, detail="reviewer_identity_missing")

        def _replay(request_id: str) -> dict | None:
            existing = (
                db.query(ReviewReplyKnowledgeSourceApplicability)
                .filter(ReviewReplyKnowledgeSourceApplicability.request_id == request_id)
                .one_or_none()
            )
            if existing is None:
                return None
            same = (
                existing.request_payload_sha256 == gate_b_request_sha256(payload)
                and existing.reviewer_uid == reviewer_uid
                and existing.reviewer_email == reviewer_email
            )
            if not same:
                raise HTTPException(status_code=409, detail="GATE_B_REQUEST_ID_REUSED")
            return {"ok": True, "duplicate": True, "record": _applicability_dict(existing)}

        request_id = str(payload.get("request_id") or "").strip()
        if request_id:
            replay = _replay(request_id)
            if replay:
                return replay
        records = load_applicability_records(db)
        registry = load_fact_registry(db, applicability_records=records)
        product_skus = product_skus_from_rows(_product_info_rows(db))
        try:
            n = validate_gate_b_submission(registry, payload, product_skus=product_skus)
        except UnitFactValidationError as exc:
            raise HTTPException(status_code=exc.status, detail={"code": exc.code, "detail": exc.detail} if exc.detail else exc.code)
        row = ReviewReplyKnowledgeSourceApplicability(
            applicability_id=str(uuid.uuid4()),
            request_id=n["request_id"],
            request_payload_sha256=n["request_payload_sha256"],
            supersedes_record_id=n["supersedes_record_id"],
            source_id=n["source_id"],
            source_version=n["source_version"],
            source_sha256=n["source_sha256"],
            registry_version=n["registry_version"],
            registry_file_sha256=n["registry_file_sha256"],
            entry_key=n["entry_key"],
            entry_kind=n["entry_kind"],
            entry_content_sha256=n["entry_content_sha256"],
            original_text=n["original_text"],
            source_location_json=json.dumps(n["source_location"], ensure_ascii=False),
            gate_a_status=n["gate_a_status"],
            decision=n["decision"],
            products_json=json.dumps(n["products"], ensure_ascii=False),
            skus_json=json.dumps(n["skus"], ensure_ascii=False),
            application_modes_json=json.dumps(n["application_modes"], ensure_ascii=False),
            condition=n["condition"],
            numeric_tokens_json=json.dumps(n["numeric_tokens"], ensure_ascii=False),
            procedure_json=json.dumps(n["procedure"], ensure_ascii=False),
            approved_fact_scope=n["approved_fact_scope"],
            limitations_exceptions=n["limitations_exceptions"],
            basis_type=n["basis_type"],
            basis_reference=n["basis_reference"],
            basis_summary=n["basis_summary"],
            note=n["note"],
            reviewer_uid=reviewer_uid,
            reviewer_email=reviewer_email,
            reviewer_role=_primary_role(roles),
            created_at=datetime.now(ZoneInfo("Asia/Seoul")),
            **n["answers"],
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            replay = _replay(n["request_id"])
            if replay:
                return replay
            raise HTTPException(status_code=409, detail="GATE_B_STALE_VIEW")
        db.refresh(row)
        record = _applicability_dict(row)
        after = gate_b_queue_view(
            load_fact_registry(db, applicability_records=records + [record]), records + [record], product_skus
        )
        entry = next((x for x in after["items"] if x["source_id"] == n["source_id"] and x["entry_key"] == n["entry_key"]), None)
        return {
            "ok": True,
            "duplicate": False,
            "record": record,
            "entry": entry,
            "decisions": list(GATE_B_DECISIONS),
            "unit_fact_records_unchanged": True,
            "reply_validation_unchanged": True,
        }

    @app.post("/reviews/reply-knowledge/unit-fact-validations", response_model=dict)
    def create_review_reply_knowledge_unit_fact_validation(
        request: Request, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)
    ):
        if not validation_write_enabled():
            raise HTTPException(status_code=409, detail="knowledge_validation_write_not_enabled")
        roles = require_role_level(request, minimum=VALIDATOR_MIN_ROLE)
        claims = get_claims_from_request(request)
        reviewer_uid = str(claims.get("sub") or claims.get("uid") or claims.get("user_id") or "").strip() or None
        reviewer_email = str(claims.get("email") or "").strip() or None
        if not reviewer_uid and not reviewer_email:
            raise HTTPException(status_code=401, detail="reviewer_identity_missing")
        knowledge_id = str(payload.get("knowledge_id") or "").strip()
        key = str(payload.get("unit_key") or "").strip()
        corpus = load_corpus(db)
        item = next((x for x in corpus["items"] if x["knowledge_id"] == knowledge_id), None)
        if item is None:
            raise HTTPException(status_code=404, detail="knowledge_item_not_found")
        if item["tier"] not in HUMAN_REFERENCE_TIERS:
            raise HTTPException(status_code=409, detail="knowledge_item_not_eligible_for_human_reference_validation")
        unit = next(
            (u for u in item["knowhow_items"] if is_fact_candidate(u) and (u.get("factValidation") or {}).get("unitKey") == key),
            None,
        )
        if unit is None:
            raise HTTPException(status_code=409, detail="unit_key_not_current")
        if str(payload.get("fact_status") or "").strip().upper() == "VERIFIED":
            blocked = unit_verified_guard(item, unit, records=load_claim_records(db, knowledge_id), registry=corpus["fact_registry"])
            if blocked:
                raise HTTPException(status_code=409, detail=blocked if blocked["detail"] else blocked["code"])
        try:
            normalized = validate_unit_fact_submission(unit, payload, corpus["fact_registry"])
        except UnitFactValidationError as exc:
            raise HTTPException(status_code=exc.status, detail={"code": exc.code, "detail": exc.detail} if exc.detail else exc.code)
        span = unit.get("sourceTextSpan") or [None, None]
        row = ReviewReplyKnowledgeUnitFactValidation(
            unit_fact_validation_id=str(uuid.uuid4()),
            unit_key=key,
            knowledge_id=knowledge_id,
            review_key=item["review_key"],
            reply_sha256_at_validation=item["reply_sha256"],
            extraction_version=str(unit.get("extractionVersion") or item.get("extraction_version")),
            source_span_start=span[0],
            source_span_end=span[1],
            unit_text=str(unit.get("originalText") or ""),
            unit_text_sha256=unit_text_sha256(unit),
            unit_snapshot_json=json.dumps(unit_snapshot(unit), ensure_ascii=False),
            fact_status=normalized["fact_status"],
            evidence_json=json.dumps(normalized["evidence"], ensure_ascii=False),
            source_registry_version=normalized["source_registry_version"],
            verified_scope=normalized["verified_scope"],
            hold_reason=normalized["hold_reason"],
            note=normalized["note"],
            reviewer_uid=reviewer_uid,
            reviewer_email=reviewer_email,
            reviewer_role=_primary_role(roles),
            parent_authority_at_validation=item.get("current_use_authority"),
            corpus_version=str(corpus.get("corpus_version") or "") or None,
            created_at=datetime.now(ZoneInfo("Asia/Seoul")),
            **normalized["answers"],
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "ok": True,
            "unit_fact_validation": _unit_fact_dict(row),
            "other_units_unchanged": True,
            "reply_validation_unchanged": item["content_validation"],
            "authorship_unchanged": item["authorship"],
        }

    @app.get("/reviews/reply-knowledge/items/{knowledge_id}/claims", response_model=dict)
    def review_reply_knowledge_item_claims(knowledge_id: str, request: Request, response: Response, db: Session = Depends(get_db_dep)):
        corpus = load_corpus(db)
        item = next((x for x in corpus["items"] if x["knowledge_id"] == knowledge_id), None)
        if item is None:
            raise HTTPException(status_code=404, detail="knowledge_item_not_found")
        records = load_claim_records(db, knowledge_id)
        view = claims_for_item(item, records=records, registry=corpus["fact_registry"])
        return private_view(request, response, {
            **view,
            "knowledge_id": knowledge_id,
            "claim_history": list(reversed(records)),
            "validation_write_enabled": validation_write_enabled(),
        })

    @app.post("/reviews/reply-knowledge/claim-fact-validations", response_model=dict)
    def create_review_reply_knowledge_claim_fact_validation(
        request: Request, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)
    ):
        if not validation_write_enabled():
            raise HTTPException(status_code=409, detail="knowledge_validation_write_not_enabled")
        roles = require_role_level(request, minimum=VALIDATOR_MIN_ROLE)
        claims = get_claims_from_request(request)
        reviewer_uid = str(claims.get("sub") or claims.get("uid") or claims.get("user_id") or "").strip() or None
        reviewer_email = str(claims.get("email") or "").strip() or None
        if not reviewer_uid and not reviewer_email:
            raise HTTPException(status_code=401, detail="reviewer_identity_missing")

        def _replay(request_id: str) -> dict | None:
            existing = (
                db.query(ReviewReplyKnowledgeClaimFactValidation)
                .filter(ReviewReplyKnowledgeClaimFactValidation.request_id == request_id)
                .one_or_none()
            )
            if existing is None:
                return None
            same = (
                existing.request_payload_sha256 == claim_request_sha256(payload)
                and existing.reviewer_uid == reviewer_uid
                and existing.reviewer_email == reviewer_email
            )
            if not same:
                raise HTTPException(status_code=409, detail="CLAIM_REQUEST_ID_REUSED")
            return {"ok": True, "duplicate": True, "claim_fact_validation": _claim_dict(existing)}

        request_id = str(payload.get("request_id") or "").strip()
        if request_id:
            replay = _replay(request_id)
            if replay:
                return replay
        knowledge_id = str(payload.get("knowledge_id") or "").strip()
        claim_key = str(payload.get("claim_key") or "").strip()
        corpus = load_corpus(db)
        item = next((x for x in corpus["items"] if x["knowledge_id"] == knowledge_id), None)
        if item is None:
            raise HTTPException(status_code=404, detail="knowledge_item_not_found")
        if item["tier"] not in HUMAN_REFERENCE_TIERS:
            raise HTTPException(status_code=409, detail="knowledge_item_not_eligible_for_human_reference_validation")
        artifact = claim_artifact()
        if not artifact["available"]:
            raise HTTPException(status_code=503, detail="CLAIM_DECOMPOSITION_UNAVAILABLE")
        claim = artifact["claims_by_key"].get(claim_key)
        if claim is None or claim["knowledge_id"] != knowledge_id:
            raise HTTPException(status_code=404, detail="claim_not_found")
        registry = corpus["fact_registry"]
        view = claims_for_item(item, records=load_claim_records(db, knowledge_id), registry=registry, artifact=artifact)
        claim_view = next(c for p in view["parents"] for c in p["claims"] if c["claim_key"] == claim_key)
        parent = next(
            (u for u in item["knowhow_items"] if (u.get("factValidation") or {}).get("unitKey") == claim["parent_unit_key"]), None
        )
        cunit = claim_unit(claim, parent)
        try:
            n = validate_claim_submission(claim_view, cunit, payload, registry)
        except UnitFactValidationError as exc:
            raise HTTPException(status_code=exc.status, detail={"code": exc.code, "detail": exc.detail} if exc.detail else exc.code)
        parent_meta = artifact["parents"][claim["parent_unit_key"]]
        snapshot = {k: claim[k] for k in ("analysis_label", "canonical_key", "analysis_class", "target_product", "products", "method",
                                          "numbers", "target_color", "condition", "suggested_evidence")}
        snapshot |= {"inherited_context": claim_view["inherited_context"], "applicable_aspects": n["applicable_aspects"],
                     "target_color_match": n["target_color_match"]}
        row = ReviewReplyKnowledgeClaimFactValidation(
            claim_validation_id=str(uuid.uuid4()),
            request_id=n["request_id"],
            request_payload_sha256=claim_request_sha256(payload),
            supersedes_record_id=n["supersedes_record_id"],
            claim_key=claim_key,
            claim_decomposition_version=artifact["version"],
            claim_text=claim["quote"],
            claim_text_sha256=claim["quote_sha256"],
            claim_spans_json=json.dumps({"unit": claim["unit_spans"], "reply": claim["reply_spans"]}),
            claim_snapshot_json=json.dumps(snapshot, ensure_ascii=False),
            parent_unit_key=claim["parent_unit_key"],
            parent_unit_text_sha256=parent_meta["parent_unit_text_sha256"],
            knowledge_id=knowledge_id,
            review_key=item["review_key"],
            reply_sha256_at_validation=item["reply_sha256"],
            fact_status=n["fact_status"],
            official_color_label=n["official_color_label"],
            evidence_json=json.dumps(n["evidence"], ensure_ascii=False),
            source_registry_version=n["source_registry_version"],
            verified_scope=n["verified_scope"],
            hold_reason=n["hold_reason"],
            note=n["note"],
            reviewer_uid=reviewer_uid,
            reviewer_email=reviewer_email,
            reviewer_role=_primary_role(roles),
            created_at=datetime.now(ZoneInfo("Asia/Seoul")),
            **n["answers"],
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            replay = _replay(n["request_id"])
            if replay:
                return replay
            raise HTTPException(status_code=409, detail="CLAIM_STALE_VIEW")
        db.refresh(row)
        return {
            "ok": True,
            "duplicate": False,
            "claim_fact_validation": _claim_dict(row),
            "parent_unit_unchanged": True,
            "unit_fact_records_unchanged": True,
            "generator_reference_allowed": "no",
        }

    @app.get("/reviews/reply-knowledge/policy-questions", response_model=dict)
    def review_reply_knowledge_policy_questions(request: Request, response: Response, db: Session = Depends(get_db_dep)):
        artifact = policy_module.policy_artifact()
        if not artifact["available"]:
            raise HTTPException(status_code=503, detail="POLICY_QUESTIONS_UNAVAILABLE")
        view = policy_module.cards_view(artifact, load_policy_records(db), load_fact_registry(db))
        return private_view(request, response, {**view, "validation_write_enabled": validation_write_enabled()})

    @app.get("/reviews/reply-knowledge/policy-questions/{question_id}", response_model=dict)
    def review_reply_knowledge_policy_question(question_id: str, request: Request, response: Response, db: Session = Depends(get_db_dep)):
        artifact = policy_module.policy_artifact()
        if not artifact["available"]:
            raise HTTPException(status_code=503, detail="POLICY_QUESTIONS_UNAVAILABLE")
        question = artifact["questions"].get(question_id)
        if question is None:
            raise HTTPException(status_code=404, detail="policy_question_not_found")
        corpus = load_corpus(db)
        items = {x["knowledge_id"]: x for x in corpus["items"]}
        view = policy_module.question_detail(question, load_policy_records(db), corpus["fact_registry"], items)
        return private_view(request, response, {**view, "decisions": list(policy_module.DECISIONS),
                                                "validation_write_enabled": validation_write_enabled()})

    @app.post("/reviews/reply-knowledge/policy-decisions", response_model=dict)
    def create_review_reply_knowledge_policy_decision(
        request: Request, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)
    ):
        if not validation_write_enabled():
            raise HTTPException(status_code=409, detail="knowledge_validation_write_not_enabled")
        roles = require_role_level(request, minimum=VALIDATOR_MIN_ROLE)
        claims = get_claims_from_request(request)
        reviewer_uid = str(claims.get("sub") or claims.get("uid") or claims.get("user_id") or "").strip() or None
        reviewer_email = str(claims.get("email") or "").strip() or None
        if not reviewer_uid and not reviewer_email:
            raise HTTPException(status_code=401, detail="reviewer_identity_missing")

        def _replay(request_id: str) -> dict | None:
            existing = (
                db.query(ReviewReplyKnowledgePolicyDecision)
                .filter(ReviewReplyKnowledgePolicyDecision.request_id == request_id)
                .one_or_none()
            )
            if existing is None:
                return None
            same = (
                existing.request_payload_sha256 == policy_module.policy_request_sha256(payload)
                and existing.reviewer_uid == reviewer_uid
                and existing.reviewer_email == reviewer_email
            )
            if not same:
                raise HTTPException(status_code=409, detail="POLICY_REQUEST_ID_REUSED")
            return {"ok": True, "duplicate": True, "policy_decision": _policy_dict(existing)}

        request_id = str(payload.get("request_id") or "").strip()
        if request_id:
            replay = _replay(request_id)
            if replay:
                return replay
        artifact = policy_module.policy_artifact()
        if not artifact["available"]:
            raise HTTPException(status_code=503, detail="POLICY_QUESTIONS_UNAVAILABLE")
        question = artifact["questions"].get(str(payload.get("question_id") or "").strip())
        if question is None:
            raise HTTPException(status_code=404, detail="policy_question_not_found")
        records = load_policy_records(db)
        latest = policy_module.latest_by_question(records).get(question["question_id"])
        registry = load_fact_registry(db)
        try:
            n = policy_module.validate_policy_submission(question, latest, registry, payload)
        except UnitFactValidationError as exc:
            raise HTTPException(status_code=exc.status, detail={"code": exc.code, "detail": exc.detail} if exc.detail else exc.code)
        row = ReviewReplyKnowledgePolicyDecision(
            decision_id=str(uuid.uuid4()),
            request_id=n["request_id"],
            request_payload_sha256=policy_module.policy_request_sha256(payload),
            supersedes_record_id=n["supersedes_record_id"],
            question_id=question["question_id"],
            question_version=artifact["version"],
            question_sha256=question["question_sha256"],
            decision=n["decision"],
            decision_text=n["decision_text"],
            products_json=json.dumps(n["products"], ensure_ascii=False),
            issue_ids_json=json.dumps(n["issue_ids"], ensure_ascii=False),
            condition_key=n["condition_key"],
            exceptions_json=json.dumps(n["exception_knowledge_ids"], ensure_ascii=False),
            evidence_json=json.dumps(n["evidence"], ensure_ascii=False),
            source_registry_version=n["source_registry_version"],
            linked_refs_json=json.dumps({
                "artifact_version": artifact["version"],
                "artifact_sha256": artifact["sha256"],
                "linked_knowledge_ids": [m["knowledge_id"] for m in question["linked_replies"]],
                "analysis_refs": ["STAGE1_FINAL_SAFETY_SOURCE_AUDIT.md", "final-audit.json"],
            }, ensure_ascii=False),
            note=n["note"],
            reviewer_uid=reviewer_uid,
            reviewer_email=reviewer_email,
            reviewer_role=_primary_role(roles),
            created_at=datetime.now(ZoneInfo("Asia/Seoul")),
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            replay = _replay(n["request_id"])
            if replay:
                return replay
            raise HTTPException(status_code=409, detail="POLICY_STALE_VIEW")
        db.refresh(row)
        return {
            "ok": True,
            "duplicate": False,
            "policy_decision": _policy_dict(row),
            "auto_verified": False,
            "authorship_unchanged": True,
            "generator_connected": False,
        }

    @app.get("/reviews/reply-knowledge/permission", response_model=dict)
    def review_reply_knowledge_permission(request: Request):
        return {**validator_permission(request), "validation_write_enabled": validation_write_enabled()}

    @app.post("/reviews/reply-knowledge/validations", response_model=dict)
    def create_review_reply_knowledge_validation(
        request: Request, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)
    ):
        if not validation_write_enabled():
            raise HTTPException(status_code=409, detail="knowledge_validation_write_not_enabled")
        roles = require_role_level(request, minimum=VALIDATOR_MIN_ROLE)
        claims = get_claims_from_request(request)
        reviewer_uid = str(claims.get("sub") or claims.get("uid") or claims.get("user_id") or "").strip() or None
        reviewer_email = str(claims.get("email") or "").strip() or None
        if not reviewer_uid and not reviewer_email:
            raise HTTPException(status_code=401, detail="reviewer_identity_missing")
        knowledge_id = str(payload.get("knowledge_id") or "").strip()
        content_validation = str(payload.get("content_validation") or "").strip().upper()
        if content_validation not in CONTENT_VALIDATION_STATES or content_validation == "PENDING":
            raise HTTPException(status_code=400, detail="invalid_content_validation")
        answers = {}
        for field in _QUESTION_FIELDS:
            value = str(payload.get(field) or "").strip().lower() or None
            if value is not None and value not in _TRI_STATE:
                raise HTTPException(status_code=400, detail=f"invalid_{field}")
            answers[field] = value
        note = str(payload.get("note") or "").strip() or None
        validate_submission(content_validation, answers, note)
        corpus = load_corpus(db)
        item = next((x for x in corpus["items"] if x["knowledge_id"] == knowledge_id), None)
        if item is None:
            raise HTTPException(status_code=404, detail="knowledge_item_not_found")
        if item["tier"] not in HUMAN_REFERENCE_TIERS:
            raise HTTPException(status_code=409, detail="knowledge_item_not_eligible_for_human_reference_validation")
        row = ReviewReplyKnowledgeValidation(
            validation_id=str(uuid.uuid4()),
            knowledge_id=knowledge_id,
            review_key=item["review_key"],
            content_validation=content_validation,
            note=note,
            reviewer=reviewer_email or reviewer_uid,
            reviewer_uid=reviewer_uid,
            reviewer_email=reviewer_email,
            reviewer_role=_primary_role(roles),
            knowhow_snapshot_json=json.dumps(_extraction_snapshot(item["knowhow_items"]), ensure_ascii=False),
            corpus_version=str(corpus.get("corpus_version") or "") or None,
            authorship_class_at_validation=item["authorship"],
            reply_sha256_at_validation=item["reply_sha256"],
            created_at=datetime.now(ZoneInfo("Asia/Seoul")),
            **answers,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"ok": True, "validation": _validation_dict(row), "authorship_unchanged": item["authorship"]}

    @app.post("/reviews/reply-knowledge/retrieve", response_model=dict)
    def review_reply_knowledge_retrieve(
        request: Request, response: Response, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)
    ):
        review_text = str(payload.get("review_text") or "").strip()
        if not review_text:
            raise HTTPException(status_code=400, detail="review_text is required")
        corpus = load_corpus(db)
        exclude = {str(x) for x in (payload.get("exclude_review_keys") or []) if str(x or "").strip()}
        return private_view(request, response, retrieve(
            corpus["items"],
            review_text=review_text,
            product_title=str(payload.get("product_title") or ""),
            rating=payload.get("rating"),
            top_k=int(payload.get("top_k") or 5),
            include_ai_reference=bool(payload.get("include_ai_reference")),
            exclude_review_keys=exclude,
        ))

    @app.get("/reviews/reply-drafts/{draft_id}/lineage", response_model=dict)
    def review_reply_draft_lineage(draft_id: str, db: Session = Depends(get_db_dep)):
        row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == draft_id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="draft not found")
        revisions = db.query(ReviewReplyDraftRevision).filter(ReviewReplyDraftRevision.draft_id == draft_id).all()
        reply = db.query(NaverReviewReplyRaw).filter(NaverReviewReplyRaw.review_key == row.review_key).one_or_none()
        return build_lineage_view(row, revisions, getattr(reply, "reply_text", None))


__all__ = ["register_review_reply_knowledge_routes", "RETRIEVAL_STATUS", "load_corpus", "build_integrity_summary"]
