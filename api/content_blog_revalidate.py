from __future__ import annotations

import copy
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from content_blog_planner import RESTRICTED_BYPASS_HINTS, _catalogs
from content_blog_profiles import FAKE_EXPERIENCE_PHRASES, find_phrase_hits, resolve_blog_quality_profile
from content_blog_review import (
    BLOCK_FACTS,
    DECISION_PENDING,
    FRESH_CURRENT,
    READINESS_READY,
    build_blog_review_items,
    calculate_blog_review_readiness,
    is_blog_v2_payload,
)
from content_blog_review import _bundle_summary, _item, _sync_review
from content_blog_validator import (
    STATUS_FAIL,
    STATUS_HOLD,
    STATUS_NOT_APPLICABLE,
    STATUS_PASS,
    STATUS_WARNING,
    _assert_no_scores,
    _quality_report,
    _resolve_inputs,
)
from content_blog_writer import (
    CODE_FAKE_EXPERIENCE,
    CODE_RESTRICTED_CLAIM_LEAKAGE,
    to_legacy_blog_preview,
    visible_blog_draft_text,
)
from content_center_engine import _new_id
from db import ContentArtifact, ContentReviewEvent


REVALIDATOR_VERSION = "blog_human_edit_revalidator_v1"
RESULT_VERSION = "blog_revalidation_result_v1"
VALIDATION_MODE = "HUMAN_REVISED_CONTENT_SAFETY_AND_QUALITY"
REVISION_MODE = "HUMAN_REVISED"
TRIGGER_INITIAL = "INITIAL_AI_DRAFT"
TRIGGER_AFTER_EDIT = "AFTER_HUMAN_EDIT"

CODE_STRUCTURE_UNSAFE = "HUMAN_REVISED_STRUCTURE_MAPPING_UNSAFE"
CODE_FAQ_MAPPING_CHANGED = "HUMAN_REVISED_FAQ_MAPPING_CHANGED"
CODE_FACT_REVIEW_AFTER_EDIT = "FACT_REVIEW_REQUIRED_AFTER_HUMAN_EDIT"
CODE_GK_REVIEW_AFTER_EDIT = "GENERAL_KNOWLEDGE_REVIEW_REQUIRED_AFTER_HUMAN_EDIT"
CODE_IMAGE_META_AFTER_EDIT = "IMAGE_METADATA_REVIEW_REQUIRED_AFTER_CONTENT_EDIT"
CODE_IMAGE_PLACEMENT_INVALID = "IMAGE_PLACEMENT_INVALID_AFTER_STRUCTURE_EDIT"
CODE_HUMAN_ADDED_FACT = "HUMAN_ADDED_FACT_REQUIRES_SOURCE_CONFIRMATION"
CODE_TITLE_REQUIRED = "HUMAN_REVISED_TITLE_REQUIRED"
CODE_SECTION_REQUIRED = "HUMAN_REVISED_SECTION_REQUIRED"

GROUND_UNCHANGED = "UNCHANGED"
GROUND_RECONFIRM = "REQUIRES_HUMAN_RECONFIRMATION"
IMG_UNCHANGED = "UNCHANGED"
IMG_REVIEW = "REVIEW_REQUIRED"
IMG_INVALID = "INVALID"
IMG_NA = "NOT_APPLICABLE"

DRAFT_SENTINEL = "human-revised"


class BlogRevalidateError(ValueError):
    pass


class BlogRevalidateAcceptError(ValueError):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


def build_effective_blog_draft(
    original_draft: dict[str, Any],
    saved_body_json: dict[str, Any] | None = None,
    human_review: dict[str, Any] | None = None,
) -> dict[str, Any]:
    original = copy.deepcopy(original_draft if isinstance(original_draft, dict) else {})
    original_snapshot = copy.deepcopy(original)
    body = saved_body_json if isinstance(saved_body_json, dict) else {}
    review = human_review if isinstance(human_review, dict) else {}
    edits = review.get("humanEdits") if isinstance(review.get("humanEdits"), dict) else {}
    editor = _editor_overlay(body)
    preview = to_legacy_blog_preview(original)
    changed_fields: list[str] = []
    changed_section_ids: list[str] = []
    grounding: dict[str, str] = {}
    structure_changed = False
    faq_mapping_changed = False

    selected_title = _overlay_title(edits, editor, original)
    if selected_title != _text(original.get("selectedTitle")):
        changed_fields.append("selectedTitle")
    effective = copy.deepcopy(original)
    effective["selectedTitle"] = selected_title

    original_intro = _text(preview.get("intro"))
    editor_intro = _raw_text(editor.get("intro"))
    if editor_intro and _text(editor_intro) != original_intro:
        lead = effective.get("lead") if isinstance(effective.get("lead"), dict) else {}
        lead = dict(lead)
        lead["problemHook"] = editor_intro
        effective["lead"] = lead
        changed_fields.append("lead")

    original_sections = [item for item in _as_list(original.get("sections")) if isinstance(item, dict)]
    editor_sections = [item for item in _as_list(editor.get("sections")) if isinstance(item, dict)]
    if editor_sections:
        if len(editor_sections) != len(original_sections):
            structure_changed = True
        else:
            merged_sections = []
            for index, original_section in enumerate(original_sections):
                edited = editor_sections[index]
                section = copy.deepcopy(original_section)
                section_id = _text(section.get("sectionId")) or f"S{index + 1}"
                section["sectionId"] = section_id
                new_heading = _raw_text(edited.get("heading") or edited.get("title")) or _raw_text(section.get("heading"))
                new_body = _section_body_text(edited)
                old_heading = _raw_text(section.get("heading"))
                old_body = "\n\n".join(_raw_text(item) for item in _as_list(section.get("paragraphs")) if _raw_text(item))
                content_changed = _text(new_heading) != _text(old_heading) or _text(new_body) != _text(old_body)
                if content_changed:
                    section["heading"] = new_heading
                    section["paragraphs"] = _split_paragraphs(new_body) or ([new_body] if new_body else [])
                    changed_section_ids.append(section_id)
                    grounding[section_id] = GROUND_RECONFIRM
                    if "sections" not in changed_fields:
                        changed_fields.append("sections")
                else:
                    grounding[section_id] = GROUND_UNCHANGED
                merged_sections.append(section)
            effective["sections"] = merged_sections
    else:
        for section in original_sections:
            section_id = _text(section.get("sectionId"))
            if section_id:
                grounding[section_id] = GROUND_UNCHANGED

    original_faq = [item for item in _as_list(original.get("faq")) if isinstance(item, dict)]
    editor_faq = [item for item in _as_list(editor.get("faq")) if isinstance(item, dict)]
    if editor_faq:
        if len(editor_faq) != len(original_faq):
            faq_mapping_changed = True
            merged_faq = []
            for item in editor_faq:
                merged_faq.append(
                    {
                        "question": _text(item.get("question")),
                        "answer": _text(item.get("answer")),
                        "sourceRefs": [],
                    }
                )
            effective["faq"] = merged_faq
            changed_fields.append("faq")
        else:
            merged_faq = []
            faq_changed = False
            for index, original_item in enumerate(original_faq):
                edited = editor_faq[index]
                item = copy.deepcopy(original_item)
                question = _text(edited.get("question")) or _text(item.get("question"))
                answer = _text(edited.get("answer")) or _text(item.get("answer"))
                if question != _text(item.get("question")) or answer != _text(item.get("answer")):
                    faq_changed = True
                    item["question"] = question
                    item["answer"] = answer
                merged_faq.append(item)
            effective["faq"] = merged_faq
            if faq_changed:
                changed_fields.append("faq")

    editor_cta = editor.get("cta")
    if editor_cta not in (None, ""):
        cta_text = editor_cta if isinstance(editor_cta, str) else _text((editor_cta or {}).get("text"))
        original_cta = original.get("cta") if isinstance(original.get("cta"), dict) else {}
        if cta_text and cta_text != _text(original_cta.get("text")):
            cta = dict(original_cta)
            cta["text"] = cta_text
            effective["cta"] = cta
            changed_fields.append("cta")

    if original_snapshot != original_draft:
        raise RuntimeError("original draft mutated during effective draft build")

    return {
        "draft": effective,
        "revisionMode": REVISION_MODE,
        "changedFields": changed_fields,
        "changedSectionIds": changed_section_ids,
        "structureChanged": structure_changed,
        "faqMappingChanged": faq_mapping_changed,
        "sourceGroundingStatus": grounding,
        "originalDraft": original_snapshot,
    }


def validate_human_revised_blog_contract(
    effective: dict[str, Any],
    *,
    blog_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    draft = effective.get("draft") if isinstance(effective.get("draft"), dict) else {}
    issues: list[dict[str, Any]] = []
    if not _text(draft.get("selectedTitle")):
        issues.append(_issue(CODE_TITLE_REQUIRED, "title is required"))
    lead = draft.get("lead") if isinstance(draft.get("lead"), dict) else {}
    sections = [item for item in _as_list(draft.get("sections")) if isinstance(item, dict)]
    if not sections:
        issues.append(_issue(CODE_SECTION_REQUIRED, "at least one section is required"))
    for section in sections:
        if not _text(section.get("heading")) and not any(_text(item) for item in _as_list(section.get("paragraphs"))):
            issues.append(_issue(CODE_SECTION_REQUIRED, "section heading or paragraph text is required", extra={"sectionId": section.get("sectionId")}))
    if not any(_text(lead.get(key)) for key in ("problemHook", "coreSummary", "readerBenefit")) and not _text(draft.get("selectedTitle")):
        issues.append(_issue("HUMAN_REVISED_LEAD_REQUIRED", "lead/intro structure is empty"))
    faq = [item for item in _as_list(draft.get("faq")) if isinstance(item, dict)]
    for item in faq:
        if not _text(item.get("question")) and not _text(item.get("answer")):
            issues.append(_issue("HUMAN_REVISED_FAQ_INVALID", "FAQ item is empty"))
    cta = draft.get("cta")
    if cta not in (None, "", {}) and not isinstance(cta, (dict, str)):
        issues.append(_issue("HUMAN_REVISED_CTA_INVALID", "CTA structure is invalid"))

    if effective.get("structureChanged"):
        issues.append(_issue(CODE_STRUCTURE_UNSAFE, "section add/delete/reorder cannot be mapped safely"))
    if effective.get("faqMappingChanged"):
        issues.append(_issue(CODE_FAQ_MAPPING_CHANGED, "FAQ add/delete changed original mapping"))

    catalogs = _catalogs(blog_context or {})
    valid_ids = set(catalogs.get("canonicalIds") or set()) | set(catalogs.get("factById") or {}) | set(catalogs.get("evidenceIds") or set())
    if not valid_ids:
        valid_ids = set((catalogs.get("factById") or {}).keys()) | set(catalogs.get("evidenceIds") or set()) | set(catalogs.get("sourceRefs") or set())
    for section in sections:
        for ref in _as_list(section.get("sourceRefs")) + _as_list(section.get("evidenceRefs")):
            if _text(ref) and valid_ids and _text(ref) not in valid_ids:
                issues.append(_issue("INVALID_SOURCE_REFERENCE", "unknown source reference on revised draft", extra={"ref": ref, "sectionId": section.get("sectionId")}))

    public = visible_blog_draft_text(draft)
    for term in catalogs.get("restrictedTerms") or []:
        if term and term in public:
            issues.append(_issue(CODE_RESTRICTED_CLAIM_LEAKAGE, "restricted claim leaked into human revised draft", extra={"term": term}))
    for hint in RESTRICTED_BYPASS_HINTS:
        if hint in public:
            issues.append(_issue(CODE_RESTRICTED_CLAIM_LEAKAGE, "restricted claim bypass leaked into human revised draft", extra={"term": hint}))
    for phrase in find_phrase_hits(public, FAKE_EXPERIENCE_PHRASES):
        issues.append(_issue(CODE_FAKE_EXPERIENCE, "unsupported personal experience in human revised draft", extra={"phrase": phrase}))

    blocking = {CODE_STRUCTURE_UNSAFE, CODE_TITLE_REQUIRED, CODE_SECTION_REQUIRED, CODE_RESTRICTED_CLAIM_LEAKAGE, CODE_FAKE_EXPERIENCE, "INVALID_SOURCE_REFERENCE"}
    status = STATUS_HOLD if any(item["code"] in blocking for item in issues) else STATUS_PASS
    return {
        "version": "blog_human_revised_contract_v1",
        "mode": VALIDATION_MODE,
        "status": status,
        "code": next((item["code"] for item in issues if item["code"] in blocking), None),
        "issues": issues,
    }


def check_revised_image_consistency(
    image_plan: dict[str, Any] | None,
    *,
    changed_section_ids: list[str],
    structure_changed: bool,
    title_only: bool,
) -> dict[str, Any]:
    plan = image_plan if isinstance(image_plan, dict) else {}
    items = [item for item in _as_list(plan.get("items")) if isinstance(item, dict)]
    if not items:
        return {"status": IMG_NA, "code": None, "items": []}
    if structure_changed:
        return {
            "status": IMG_INVALID,
            "code": CODE_IMAGE_PLACEMENT_INVALID,
            "items": [{"sectionId": _text(item.get("sectionId")), "status": IMG_INVALID, "code": CODE_IMAGE_PLACEMENT_INVALID} for item in items],
        }
    if title_only or not changed_section_ids:
        return {"status": IMG_UNCHANGED, "code": None, "items": [{"sectionId": _text(item.get("sectionId")), "status": IMG_UNCHANGED} for item in items]}
    out_items = []
    review_needed = False
    for item in items:
        section_id = _text(item.get("sectionId"))
        assigned = _text(item.get("status")).upper() == "ASSIGNED" and _text(item.get("assetRef"))
        if section_id in changed_section_ids and assigned:
            review_needed = True
            out_items.append({"sectionId": section_id, "status": IMG_REVIEW, "code": CODE_IMAGE_META_AFTER_EDIT, "assetRef": _text(item.get("assetRef"))})
        else:
            out_items.append({"sectionId": section_id, "status": IMG_UNCHANGED, "assetRef": _text(item.get("assetRef"))})
    return {
        "status": IMG_REVIEW if review_needed else IMG_UNCHANGED,
        "code": CODE_IMAGE_META_AFTER_EDIT if review_needed else None,
        "items": out_items,
    }


def revalidate_blog_v2_human_revision(
    bundle: dict[str, Any],
    saved_body_json: dict[str, Any] | None = None,
    *,
    db: Session | None = None,
    reviewer_status: str | None = None,
) -> dict[str, Any]:
    original_bundle = copy.deepcopy(bundle)
    original_draft = copy.deepcopy(bundle.get("draft") or {})
    initial_quality = copy.deepcopy(_quality_payload(bundle.get("qualityReport") or {}))
    original_image = copy.deepcopy(_image_payload(bundle.get("imagePlan") or {}))
    human_review = copy.deepcopy(bundle.get("humanReview") if isinstance(bundle.get("humanReview"), dict) else {})
    if isinstance(saved_body_json, dict):
        nested_bundle = _bundle_from_body(saved_body_json) or {}
        nested_review = nested_bundle.get("humanReview") if isinstance(nested_bundle.get("humanReview"), dict) else saved_body_json.get("humanReview")
        if isinstance(nested_review, dict) and nested_review.get("humanEdits"):
            human_review = copy.deepcopy(nested_review)
    context = bundle.get("context") if isinstance(bundle.get("context"), dict) else {}
    intent = bundle.get("intentAnalysis") if isinstance(bundle.get("intentAnalysis"), dict) else {}
    plan = bundle.get("contentPlan") if isinstance(bundle.get("contentPlan"), dict) else {}
    previous_items = [copy.deepcopy(item) for item in _as_list(bundle.get("reviewItems")) if isinstance(item, dict)]

    effective = build_effective_blog_draft(original_draft, saved_body_json, human_review)
    if effective["originalDraft"] != original_draft:
        raise RuntimeError("original draft mutated")
    contract = validate_human_revised_blog_contract(effective, blog_context=context)
    image_consistency = check_revised_image_consistency(
        original_image,
        changed_section_ids=effective["changedSectionIds"],
        structure_changed=bool(effective["structureChanged"]),
        title_only=_title_only(effective),
    )
    quality = _run_human_revised_quality(db, context, intent, plan, effective["draft"], contract)
    if image_consistency.get("status") == IMG_INVALID:
        quality = _force_hold(quality, CODE_IMAGE_PLACEMENT_INVALID, "Image placement mapping is invalid after structure edit")
        contract["status"] = STATUS_HOLD
        contract["code"] = contract.get("code") or CODE_STRUCTURE_UNSAFE
        contract["issues"] = list(contract.get("issues") or []) + [_issue(CODE_IMAGE_PLACEMENT_INVALID, "image placement mapping is invalid")]

    run_id = f"VR-{uuid.uuid4().hex[:12]}"
    validated_at = datetime.now(timezone.utc).isoformat()
    freshness = FRESH_CURRENT
    reconciled = _reconcile_reviews(
        previous_items=previous_items,
        human_review=human_review,
        context=context,
        intent=intent,
        plan=plan,
        draft=effective["draft"],
        quality=quality,
        image_plan=original_image,
        effective=effective,
        image_consistency=image_consistency,
        contract=contract,
    )
    readiness = calculate_blog_review_readiness(
        quality_report=quality,
        review_items=reconciled["reviewItems"],
        human_review=reconciled["humanReview"],
        reviewer_status=reviewer_status,
    )
    reconciled["humanReview"]["reviewStatus"] = readiness
    reconciled["humanReview"]["validationFreshness"] = freshness
    result = {
        "version": RESULT_VERSION,
        "validationRunId": run_id,
        "trigger": TRIGGER_AFTER_EDIT,
        "status": STATUS_HOLD if quality.get("gateDecision") == STATUS_HOLD or contract.get("status") == STATUS_HOLD else STATUS_PASS,
        "effectiveDraft": effective["draft"],
        "humanRevisedContract": contract,
        "qualityReport": quality,
        "imageConsistency": image_consistency,
        "changedFields": effective["changedFields"],
        "changedSectionIds": effective["changedSectionIds"],
        "requiredReviewResets": reconciled["requiredReviewResets"],
        "validationFreshness": freshness,
        "reviewItems": reconciled["reviewItems"],
        "humanReview": reconciled["humanReview"],
        "reviewSummary": _bundle_summary(reconciled["reviewItems"], original_image, readiness, reconciled["humanReview"]),
        "provenance": {
            "revalidatorVersion": REVALIDATOR_VERSION,
            "generationVersion": "blog_v2",
            "trigger": TRIGGER_AFTER_EDIT,
            "validatedAt": validated_at,
            "validationMode": VALIDATION_MODE,
        },
    }
    updated_bundle = _persist_into_bundle(original_bundle, result, initial_quality, original_draft, original_image)
    result["bundle"] = updated_bundle
    if updated_bundle.get("draft") != original_draft:
        raise RuntimeError("original bundle.draft mutated")
    if updated_bundle.get("qualityReport") != initial_quality:
        raise RuntimeError("initial qualityReport mutated")
    if updated_bundle.get("imagePlan") != original_image:
        raise RuntimeError("imagePlan mutated")
    return result


def revalidate_blog_v2_artifact(db: Session, artifact_id: str, *, actor: str | None = None) -> dict[str, Any]:
    row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
    if row is None:
        raise BlogRevalidateError("artifact_not_found")
    try:
        body = json.loads(row.body_json or "{}")
    except Exception as exc:
        raise BlogRevalidateError("artifact_body_invalid") from exc
    if not isinstance(body, dict) or not is_blog_v2_payload(body):
        raise BlogRevalidateError("not_blog_v2_artifact")
    bundle = _bundle_from_body(body)
    if not bundle:
        raise BlogRevalidateError("blog_v2_review_bundle_missing")
    result = revalidate_blog_v2_human_revision(bundle, body, db=db, reviewer_status=row.reviewer_status)
    result["provenance"]["sourceArtifactId"] = row.artifact_id
    result["provenance"]["inputRevisionReason"] = row.revision_reason or "human_edit"
    updated = result["bundle"]
    body = copy.deepcopy(body)
    body["blog_v2_review_bundle"] = updated
    body["humanReview"] = updated.get("humanReview")
    body["currentValidationRunId"] = updated.get("currentValidationRunId")
    row.body_json = json.dumps(body, ensure_ascii=False)
    db.add(row)
    db.add(
        ContentReviewEvent(
            event_id=_new_id("CE"),
            artifact_id=row.artifact_id,
            event_type="blog_v2_revalidated",
            actor=actor,
            payload_json=json.dumps({"validationRunId": result["validationRunId"], "status": result["status"]}, ensure_ascii=False),
        )
    )
    db.commit()
    db.refresh(row)
    result["artifact_id"] = row.artifact_id
    return result


def assert_blog_v2_accept_allowed(body: dict[str, Any] | None) -> None:
    if not is_blog_v2_payload(body if isinstance(body, dict) else {}):
        return
    bundle = _bundle_from_body(body if isinstance(body, dict) else {})
    if not bundle:
        raise BlogRevalidateAcceptError("blog_v2_review_bundle_missing")
    freshness = _text((bundle.get("humanReview") or {}).get("validationFreshness")) or FRESH_CURRENT
    if freshness != FRESH_CURRENT:
        raise BlogRevalidateAcceptError("blog_v2_validation_stale")
    quality = _current_quality(bundle)
    if _text(quality.get("gateDecision")).upper() == STATUS_HOLD:
        raise BlogRevalidateAcceptError("blog_v2_quality_hold")
    readiness = _text((bundle.get("reviewSummary") or {}).get("reviewReadiness")) or calculate_blog_review_readiness(
        quality_report=quality,
        review_items=bundle.get("reviewItems") or [],
        human_review=bundle.get("humanReview"),
    )
    if readiness != READINESS_READY and readiness != "HUMAN_APPROVED":
        raise BlogRevalidateAcceptError("blog_v2_review_not_ready")


def serialize_blog_revalidation_result(result: dict[str, Any]) -> str:
    payload = {key: value for key, value in result.items() if key != "bundle"}
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _run_human_revised_quality(
    db: Session | None,
    context: dict[str, Any],
    intent: dict[str, Any],
    plan: dict[str, Any],
    draft: dict[str, Any],
    contract: dict[str, Any],
) -> dict[str, Any]:
    snapshot = copy.deepcopy(draft)
    profile = resolve_blog_quality_profile(intent)
    catalogs = _catalogs(context)
    from content_blog_context import blog_v2_known_limitations

    limitations = [dict(item) for item in blog_v2_known_limitations()]
    if contract.get("code") == CODE_STRUCTURE_UNSAFE:
        report = {
            "version": "blog_quality_report_v1",
            "gateDecision": STATUS_HOLD,
            "qualityStatus": STATUS_FAIL,
            "outcome": "HUMAN_REVISED_CONTRACT_HOLD",
            "writerContractStatus": STATUS_NOT_APPLICABLE,
            "checks": {},
            "metrics": {},
            "issues": [
                {
                    "code": CODE_STRUCTURE_UNSAFE,
                    "status": STATUS_FAIL,
                    "message": "Section add/delete cannot be mapped to the original AI draft. Restore the original section structure and run 다시 점검 again.",
                    "scope": "STRUCTURE",
                }
            ],
            "limitations": limitations,
            "guidelineProfile": {"profileId": profile.get("profileId"), "authority": profile.get("authority")},
            "validatorProvenance": {
                "validatorVersion": REVALIDATOR_VERSION,
                "generationVersion": "blog_v2",
                "validationMode": VALIDATION_MODE,
            },
        }
        _assert_no_scores(report)
        return report
    report = _quality_report(db, snapshot, context, intent, plan, catalogs, profile, limitations)
    report["writerContractStatus"] = STATUS_NOT_APPLICABLE
    if isinstance(report.get("checks"), dict):
        report["checks"]["writerContractIntegrity"] = {
            "status": STATUS_NOT_APPLICABLE,
            "detail": "HUMAN_REVISED_CONTRACT",
            "codes": [],
        }
    if contract.get("status") == STATUS_HOLD:
        for item in contract.get("issues") or []:
            code = _text(item.get("code"))
            if code in {CODE_RESTRICTED_CLAIM_LEAKAGE, CODE_FAKE_EXPERIENCE, CODE_STRUCTURE_UNSAFE}:
                if not any(_text(existing.get("code")) == code for existing in report.get("issues") or []):
                    report.setdefault("issues", []).append(
                        {"code": code, "status": STATUS_FAIL, "message": item.get("message"), "scope": "BODY"}
                    )
        report["gateDecision"] = STATUS_HOLD
        report["qualityStatus"] = STATUS_FAIL
        report["outcome"] = "HUMAN_REVISED_CONTRACT_HOLD"
    _assert_no_scores(report)
    if snapshot != draft:
        raise RuntimeError("quality helper mutated human revised draft")
    return report


def _force_hold(quality: dict[str, Any], code: str, message: str) -> dict[str, Any]:
    report = copy.deepcopy(quality)
    report["gateDecision"] = STATUS_HOLD
    report["qualityStatus"] = STATUS_FAIL
    report.setdefault("issues", []).append({"code": code, "status": STATUS_FAIL, "message": message, "scope": "IMAGE"})
    return report


def _reconcile_reviews(
    *,
    previous_items: list[dict[str, Any]],
    human_review: dict[str, Any],
    context: dict[str, Any],
    intent: dict[str, Any],
    plan: dict[str, Any],
    draft: dict[str, Any],
    quality: dict[str, Any],
    image_plan: dict[str, Any],
    effective: dict[str, Any],
    image_consistency: dict[str, Any],
    contract: dict[str, Any],
) -> dict[str, Any]:
    items = build_blog_review_items(
        context=context,
        intent=intent,
        content_plan=plan,
        draft=draft,
        quality_report=quality,
        image_plan=image_plan,
    )
    previous_by_id = {str(item.get("reviewItemId")): item for item in previous_items}
    resets: list[str] = []
    changed_ids = set(effective.get("changedSectionIds") or [])
    title_changed = "selectedTitle" in (effective.get("changedFields") or [])
    faq_changed = bool(effective.get("faqMappingChanged")) or "faq" in (effective.get("changedFields") or [])

    for section_id in changed_ids:
        fact_id = f"RV_FACT_MEANING_{section_id}"
        gk_id = f"RV_GENERAL_KNOWLEDGE_{section_id}"
        items.append(
            _item(
                fact_id,
                category="FACT_ACCURACY",
                severity="WARNING",
                machine_code=CODE_FACT_REVIEW_AFTER_EDIT,
                title="수정된 섹션의 본문 의미가 원본 자료와 맞는지 확인",
                description="사람이 수정한 문장은 기존 sourceRefs가 의미를 보증하지 않습니다.",
                scope=f"SECTION:{section_id}",
                required=True,
                block=BLOCK_FACTS,
                source_refs=[],
            )
        )
        items.append(
            _item(
                gk_id,
                category="GENERAL_KNOWLEDGE",
                severity="WARNING",
                machine_code=CODE_GK_REVIEW_AFTER_EDIT,
                title="수정된 섹션에 자료 밖 전문 정보가 없는지 확인",
                description="시스템은 사람 추가 문장을 자동으로 근거 있는 사실로 승인하지 않습니다.",
                scope=f"SECTION:{section_id}",
                required=True,
                block=BLOCK_FACTS,
                source_refs=[],
            )
        )
        resets.extend([fact_id, gk_id])
        if image_consistency.get("status") == IMG_REVIEW:
            alt_id = f"RV_ALT_MATCH_{section_id}"
            resets.append(alt_id)

    if faq_changed:
        items.append(
            _item(
                "RV_HUMAN_ADDED_FAQ",
                category="FACT_ACCURACY",
                severity="WARNING",
                machine_code=CODE_HUMAN_ADDED_FACT,
                title="추가/삭제된 FAQ의 근거를 확인해 주세요",
                description="새로 넣은 FAQ는 자동으로 source grounded로 인정하지 않습니다.",
                scope="FAQ",
                required=True,
                block=BLOCK_FACTS,
                source_refs=[],
            )
        )
        resets.append("RV_HUMAN_ADDED_FAQ")

    seen_ids = {str(item.get("reviewItemId")) for item in items}
    for previous in previous_items:
        item_id = str(previous.get("reviewItemId") or "")
        if not item_id or item_id in seen_ids:
            continue
        if item_id.startswith("RV_FACT_MEANING_") or item_id.startswith("RV_GENERAL_KNOWLEDGE_"):
            section_id = item_id.rsplit("_", 1)[-1]
            if section_id and section_id not in changed_ids and not section_id.startswith("RV"):
                items.append(copy.deepcopy(previous))
                seen_ids.add(item_id)

    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for item in items:
        item_id = str(item.get("reviewItemId"))
        if item_id in seen:
            continue
        seen.add(item_id)
        previous = previous_by_id.get(item_id)
        if previous and item_id not in resets and not _should_reset_item(item, changed_ids, title_changed):
            item["humanDecision"] = previous.get("humanDecision") or DECISION_PENDING
            item["reviewerNote"] = previous.get("reviewerNote")
        elif item_id in resets:
            item["humanDecision"] = DECISION_PENDING
        deduped.append(item)

    decisions = []
    for item in deduped:
        item_id = str(item.get("reviewItemId"))
        previous = previous_by_id.get(item_id)
        if item_id in resets or _should_reset_item(item, changed_ids, title_changed):
            decisions.append({"reviewItemId": item_id, "decision": DECISION_PENDING, "note": None, "reviewedBy": None})
        elif previous:
            decisions.append(
                {
                    "reviewItemId": item_id,
                    "decision": previous.get("humanDecision") or DECISION_PENDING,
                    "note": previous.get("reviewerNote"),
                    "reviewedBy": None,
                }
            )
    review = copy.deepcopy(human_review)
    review["decisions"] = decisions
    review = _sync_review(review, deduped)
    return {"reviewItems": deduped, "humanReview": review, "requiredReviewResets": sorted(set(resets))}


def _should_reset_item(item: dict[str, Any], changed_ids: set[str], title_changed: bool) -> bool:
    item_id = str(item.get("reviewItemId") or "")
    code = _text(item.get("machineCode"))
    scope = _text(item.get("scope"))
    if code == "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED" or item_id.startswith("RV_IMAGE_OWNERSHIP_"):
        return False
    if code == "COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN":
        return False
    if title_changed and code in {"TITLE_LENGTH_BELOW_REFERENCE", "TITLE_LENGTH_ABOVE_REFERENCE", "TITLE_SPECIAL_CHAR_EXCESS", "SELECTED_TITLE_NOT_IN_CANDIDATES"}:
        return True
    for section_id in changed_ids:
        if item_id.endswith(f"_{section_id}") and "OWNERSHIP" not in item_id:
            return True
        if scope == f"SECTION:{section_id}" and code == "IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED":
            return True
    return False


def _persist_into_bundle(
    original_bundle: dict[str, Any],
    result: dict[str, Any],
    initial_quality: dict[str, Any],
    original_draft: dict[str, Any],
    original_image: dict[str, Any],
) -> dict[str, Any]:
    out = copy.deepcopy(original_bundle)
    history = [copy.deepcopy(item) for item in _as_list(out.get("validationHistory")) if isinstance(item, dict)]
    if not any(_text(item.get("trigger")) == TRIGGER_INITIAL for item in history):
        history.append(
            {
                "validationRunId": _text(out.get("currentValidationRunId")) or "VR-INITIAL-AI-DRAFT",
                "trigger": TRIGGER_INITIAL,
                "qualityReport": copy.deepcopy(initial_quality),
                "validatedAt": ((initial_quality.get("validatorProvenance") or {}).get("validatedAt")),
            }
        )
    history.append(
        {
            "validationRunId": result["validationRunId"],
            "trigger": TRIGGER_AFTER_EDIT,
            "qualityReport": copy.deepcopy(result["qualityReport"]),
            "humanRevisedContract": copy.deepcopy(result["humanRevisedContract"]),
            "imageConsistency": copy.deepcopy(result["imageConsistency"]),
            "changedFields": list(result.get("changedFields") or []),
            "changedSectionIds": list(result.get("changedSectionIds") or []),
            "validatedAt": result["provenance"]["validatedAt"],
        }
    )
    out["draft"] = copy.deepcopy(original_draft)
    out["qualityReport"] = copy.deepcopy(initial_quality)
    out["imagePlan"] = copy.deepcopy(original_image)
    out["validationHistory"] = history
    out["currentValidationRunId"] = result["validationRunId"]
    out["currentQualityReport"] = copy.deepcopy(result["qualityReport"])
    out["currentValidation"] = {
        "validationRunId": result["validationRunId"],
        "trigger": TRIGGER_AFTER_EDIT,
        "status": result["status"],
        "validationFreshness": FRESH_CURRENT,
    }
    out["reviewItems"] = copy.deepcopy(result["reviewItems"])
    out["humanReview"] = copy.deepcopy(result["humanReview"])
    out["reviewSummary"] = copy.deepcopy(result["reviewSummary"])
    return out


def _bundle_from_body(body: dict[str, Any]) -> dict[str, Any] | None:
    from content_blog_review import is_blog_v2_payload

    if isinstance(body.get("blog_v2_review_bundle"), dict):
        return body["blog_v2_review_bundle"]
    generation = body.get("blog_generation") if isinstance(body.get("blog_generation"), dict) else {}
    if isinstance(generation.get("blog_v2_review_bundle"), dict):
        return generation["blog_v2_review_bundle"]
    if body.get("version") == "blog_v2_review_bundle_v1" and isinstance(body.get("draft"), dict):
        return body
    return None if not is_blog_v2_payload(body) else None


def _current_quality(bundle: dict[str, Any]) -> dict[str, Any]:
    current = bundle.get("currentQualityReport")
    if isinstance(current, dict) and current.get("gateDecision"):
        return current
    return _quality_payload(bundle.get("qualityReport") or {})


def _quality_payload(value: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value.get("qualityReport"), dict) and value.get("gateDecision") is None:
        return value["qualityReport"]
    return value if isinstance(value, dict) else {}


def _image_payload(value: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value.get("imagePlan"), dict) and value.get("planStatus") is None:
        return value["imagePlan"]
    return value if isinstance(value, dict) else {}


def _editor_overlay(body: dict[str, Any]) -> dict[str, Any]:
    blog = body.get("blog") if isinstance(body.get("blog"), dict) else {}
    return {
        "title": blog.get("title") or body.get("title"),
        "intro": blog.get("intro") if blog.get("intro") is not None else body.get("intro"),
        "sections": blog.get("sections") if isinstance(blog.get("sections"), list) else body.get("sections"),
        "faq": blog.get("faq") if isinstance(blog.get("faq"), list) else body.get("faq"),
        "cta": blog.get("cta") if blog.get("cta") is not None else body.get("cta"),
    }


def _overlay_title(edits: dict[str, Any], editor: dict[str, Any], original: dict[str, Any]) -> str:
    selected = _text(edits.get("selectedTitle"))
    if selected:
        return selected
    editor_title = _text(editor.get("title"))
    if editor_title:
        return editor_title
    return _text(original.get("selectedTitle"))


def _section_body_text(section: dict[str, Any]) -> str:
    body = _raw_text(section.get("body") or section.get("content") or section.get("text"))
    if body:
        return body
    return "\n\n".join(_raw_text(item) for item in _as_list(section.get("paragraphs")) if _raw_text(item))


def _split_paragraphs(text: str) -> list[str]:
    parts = [item.strip() for item in str(text or "").split("\n\n")]
    return [item for item in parts if item]


def _title_only(effective: dict[str, Any]) -> bool:
    fields = [item for item in (effective.get("changedFields") or []) if item != "selectedTitle"]
    return bool(effective.get("changedFields")) and not fields and not effective.get("changedSectionIds") and not effective.get("structureChanged")


def _issue(code: str, message: str, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    item = {"code": code, "message": message}
    if extra:
        item.update(extra)
    return item


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _raw_text(value: Any) -> str:
    return str(value or "").replace("\x00", "").strip()
