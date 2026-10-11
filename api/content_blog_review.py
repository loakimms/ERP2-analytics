from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

from content_blog_planner import STATUS_PASS


BUNDLE_VERSION = "blog_v2_review_bundle_v1"
HUMAN_REVIEW_VERSION = "blog_human_review_v1"
REVIEW_BUILDER_VERSION = "blog_v2_review_builder_v1"

DECISION_PENDING = "PENDING"
DECISION_CONFIRMED = "CONFIRMED"
DECISION_RESOLVED = "RESOLVED"
DECISION_ACCEPTED = "ACCEPTED_AS_IS"
DECISION_REJECTED = "REJECTED"
DECISION_NA = "NOT_APPLICABLE"
DONE_DECISIONS = {DECISION_CONFIRMED, DECISION_RESOLVED, DECISION_ACCEPTED, DECISION_NA}

READINESS_BLOCKED = "BLOCKED"
READINESS_REVIEW_REQUIRED = "REVIEW_REQUIRED"
READINESS_READY = "READY_FOR_FINAL_REVIEW"
READINESS_APPROVED = "HUMAN_APPROVED"

FRESH_CURRENT = "CURRENT"
FRESH_STALE = "STALE_AFTER_HUMAN_EDIT"

BLOCK_CONTENT = "CONTENT"
BLOCK_FACTS = "FACTS"
BLOCK_SAFETY = "SAFETY"
BLOCK_READABILITY = "READABILITY"
BLOCK_IMAGES = "IMAGES"
BLOCK_FINAL = "FINAL"

REQUIRED_LIMITATION_CODES = {
    "SEMANTIC_FACT_ENTAILMENT_NOT_FULLY_VERIFIED": {
        "category": "FACT_ACCURACY",
        "block": BLOCK_FACTS,
        "title": "본문 표현이 원본 자료 의미와 일치합니까?",
        "description": "자동 점검은 문장마다 원본과 의미를 비교했다고 보장하지 않습니다. 사람이 최종 확인해야 합니다.",
        "reviewItemId": "RV_FACT_MEANING",
    },
    "SEMANTIC_GENERAL_KNOWLEDGE_EXCLUSION_NOT_FULLY_VERIFIED": {
        "category": "GENERAL_KNOWLEDGE",
        "block": BLOCK_FACTS,
        "title": "자료에 없는 전문 정보가 추가되지 않았는지 확인",
        "description": "확인된 자료 밖의 전문 지식이나 효능을 넣지 않았는지 검토하세요.",
        "reviewItemId": "RV_GENERAL_KNOWLEDGE",
    },
}

OPTIONAL_QUALITY_CODES = {
    "BODY_LENGTH_BELOW_REFERENCE",
    "BODY_LENGTH_ABOVE_REFERENCE",
    "TITLE_LENGTH_BELOW_REFERENCE",
    "TITLE_LENGTH_ABOVE_REFERENCE",
    "IMAGE_ASSETS_PENDING",
    "AI_CLICHE_DETECTED",
    "REPEATED_SENTENCE_ENDING",
    "KEYWORD_USAGE_BELOW_REFERENCE",
    "KEYWORD_USAGE_ABOVE_REFERENCE",
    "LONG_PARAGRAPH",
    "DUPLICATE_SENTENCE",
    "SOURCE_LIMITED_DRAFT",
}

QUALITY_COPY = {
    "BODY_LENGTH_BELOW_REFERENCE": ("본문 분량이 참고 범위보다 짧습니다.", "자료가 부족한 경우 억지로 분량을 늘리지 않는 것이 우선입니다."),
    "COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN": ("광고·협찬 표시 여부를 확인해 주세요.", "자사 자체 콘텐츠인지, 협찬/대가성인지 사람이 판단합니다."),
    "RESTRICTED_CLAIM_LEAKAGE": ("발행 전에 반드시 수정해야 할 표현이 있습니다.", "금지·주의 표현은 사람이 승인해서 넘어갈 수 없습니다."),
    "FAKE_EXPERIENCE_GENERATION": ("확인되지 않은 사용 경험이 포함되어 있습니다.", "허위 경험 표현은 수정 전까지 발행할 수 없습니다."),
    "MECHANICAL_KEYWORD_STUFFING": ("키워드가 기계적으로 반복되어 있습니다.", "수정 전까지 발행할 수 없습니다."),
    "REQUIRED_DISCLOSURE_MISSING": ("필요한 광고·협찬 고지가 없습니다.", "고지를 보완하기 전까지 발행할 수 없습니다."),
    "IMAGE_ASSETS_PENDING": ("실제 이미지가 더 필요합니다.", "이미지가 없다고 해서 실패한 것은 아닙니다."),
    "IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED": ("이 이미지를 사용할 권리가 확인되었습니까?", "사람 확인은 검수 기록으로만 남습니다."),
    "EVIDENCE_IMAGE_REQUIRES_REAL_SOURCE": ("실제 증빙 이미지가 필요합니다.", "AI 생성 이미지로 대체할 수 없습니다."),
    "PENDING_ASSET": ("이미지 필요", "실제 과정/제품 사진이 아직 없습니다. 오류가 아니라 미완료 상태입니다."),
    "FACT_REVIEW_REQUIRED_AFTER_HUMAN_EDIT": ("수정된 섹션의 본문 의미가 원본 자료와 맞는지 확인", "사람이 수정한 문장은 기존 sourceRefs가 의미를 보증하지 않습니다."),
    "GENERAL_KNOWLEDGE_REVIEW_REQUIRED_AFTER_HUMAN_EDIT": ("수정된 섹션에 자료 밖 전문 정보가 없는지 확인", "시스템은 사람 추가 문장을 자동으로 근거 있는 사실로 승인하지 않습니다."),
    "HUMAN_ADDED_FACT_REQUIRES_SOURCE_CONFIRMATION": ("추가된 내용의 근거를 확인해 주세요", "새로 넣은 문장은 자동으로 source grounded로 인정하지 않습니다."),
    "HUMAN_REVISED_STRUCTURE_MAPPING_UNSAFE": ("섹션 구조가 바뀌어 다시 점검할 수 없습니다", "섹션 추가/삭제를 원래 구조로 되돌린 뒤 다시 점검해야 합니다."),
    "IMAGE_METADATA_REVIEW_REQUIRED_AFTER_CONTENT_EDIT": ("본문 수정 후 ALT 설명이 이미지와 맞는지 확인", "이미지는 그대로이지만 연결된 본문 의미가 바뀌었습니다."),
    "IMAGE_PLACEMENT_INVALID_AFTER_STRUCTURE_EDIT": ("섹션 구조 변경으로 이미지 배치를 확인할 수 없습니다", "원래 섹션 구조로 되돌린 뒤 다시 점검해야 합니다."),
}


def serialize_blog_v2_review_bundle(bundle: dict[str, Any]) -> str:
    return json.dumps(bundle, ensure_ascii=False, sort_keys=True)


def serialize_blog_human_review(review: dict[str, Any]) -> str:
    return json.dumps(review, ensure_ascii=False, sort_keys=True)


def build_blog_v2_review_bundle(
    *,
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any] | None = None,
    content_plan: dict[str, Any] | None = None,
    planner_result: dict[str, Any] | None = None,
    draft: dict[str, Any],
    quality_report: dict[str, Any],
    image_plan: dict[str, Any],
    human_review: dict[str, Any] | None = None,
    reviewer_status: str | None = None,
) -> dict[str, Any]:
    intent, plan = _resolve_inputs(intent_analysis, content_plan, planner_result)
    context = copy.deepcopy(blog_context)
    intent = copy.deepcopy(intent)
    plan = copy.deepcopy(plan)
    draft_copy = copy.deepcopy(draft)
    quality = copy.deepcopy(_quality_payload(quality_report))
    images = copy.deepcopy(_image_payload(image_plan))
    review = copy.deepcopy(human_review) if isinstance(human_review, dict) else _empty_human_review()
    items = build_blog_review_items(context=context, intent=intent, content_plan=plan, draft=draft_copy, quality_report=quality, image_plan=images)
    review = _sync_review(review, items)
    readiness = calculate_blog_review_readiness(quality_report=quality, review_items=items, human_review=review, reviewer_status=reviewer_status)
    review["reviewStatus"] = readiness
    review["summary"] = _decision_summary(items)
    bundle = {
        "version": BUNDLE_VERSION,
        "context": context,
        "intentAnalysis": intent,
        "contentPlan": plan,
        "draft": draft_copy,
        "qualityReport": quality,
        "imagePlan": images,
        "reviewItems": items,
        "humanReview": review,
        "reviewSummary": _bundle_summary(items, images, readiness, review),
        "reviewProvenance": {
            "builderVersion": REVIEW_BUILDER_VERSION,
            "generationVersion": "blog_v2",
            "planningMode": "DETERMINISTIC_RULE_BASED",
            "builtAt": datetime.now(timezone.utc).isoformat(),
        },
    }
    return bundle


def build_blog_review_items(
    *,
    context: dict[str, Any],
    intent: dict[str, Any],
    content_plan: dict[str, Any],
    draft: dict[str, Any],
    quality_report: dict[str, Any],
    image_plan: dict[str, Any],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    quality = _quality_payload(quality_report)
    images = _image_payload(image_plan)
    for issue in _as_list(quality.get("issues")):
        if not isinstance(issue, dict):
            continue
        code = _text(issue.get("code"))
        status = _text(issue.get("status")).upper()
        if not code:
            continue
        required = status == "FAIL"
        if status == "WARNING" and code == "COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN":
            required = True
        optional = code in OPTIONAL_QUALITY_CODES and not required
        if not required and not optional and status != "FAIL":
            if status == "WARNING":
                optional = True
            else:
                continue
        title, description = QUALITY_COPY.get(code, (_human_title(code), _text(issue.get("message"))))
        item_id = f"RV_Q_{code}"
        items.append(
            _item(
                item_id,
                category="CLAIM_SAFETY" if required and code not in OPTIONAL_QUALITY_CODES else _category_for_code(code),
                severity="FAIL" if status == "FAIL" else "WARNING",
                machine_code=code,
                title=title,
                description=description,
                scope=_text(issue.get("scope")) or "DRAFT",
                required=required,
                block=BLOCK_SAFETY if status == "FAIL" or code == "COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN" else BLOCK_READABILITY,
                source_refs=[],
            )
        )
        seen.add(item_id)
    for code, spec in REQUIRED_LIMITATION_CODES.items():
        items.append(
            _item(
                spec["reviewItemId"],
                category=spec["category"],
                severity="WARNING",
                machine_code=code,
                title=spec["title"],
                description=spec["description"],
                scope="DRAFT",
                required=True,
                block=spec["block"],
                source_refs=[],
            )
        )
    disclosure = context.get("commercialDisclosure") if isinstance(context.get("commercialDisclosure"), dict) else {}
    if _text(disclosure.get("status")).upper() in {"", "UNKNOWN"} and "RV_Q_COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN" not in {item["reviewItemId"] for item in items}:
        items.append(
            _item(
                "RV_DISCLOSURE",
                category="CLAIM_SAFETY",
                severity="WARNING",
                machine_code="COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN",
                title="광고·협찬 표시 여부를 확인해 주세요.",
                description="이 선택은 원본 자료의 고지 상태를 바꾸지 않고, 사람 판단으로만 저장됩니다.",
                scope="DISCLOSURE",
                required=True,
                block=BLOCK_SAFETY,
                source_refs=[],
            )
        )
    for image in _as_list(images.get("items")):
        if not isinstance(image, dict):
            continue
        section_id = _text(image.get("sectionId")) or "IMAGE"
        status = _text(image.get("status")).upper()
        asset_ref = _text(image.get("assetRef"))
        risks = {_text(item) for item in _as_list(image.get("riskNotes"))}
        if "EVIDENCE_IMAGE_REQUIRES_REAL_SOURCE" in risks:
            items.append(
                _item(
                    f"RV_EVIDENCE_IMAGE_{section_id}",
                    category="IMAGE",
                    severity="WARNING",
                    machine_code="EVIDENCE_IMAGE_REQUIRES_REAL_SOURCE",
                    title="실제 증빙 이미지가 필요합니다.",
                    description="AI 생성 이미지로 대체할 수 없습니다.",
                    scope=f"SECTION:{section_id}",
                    required=True,
                    block=BLOCK_IMAGES,
                    source_refs=[asset_ref] if asset_ref else [],
                )
            )
        if status == "ASSIGNED" and asset_ref and _text(image.get("ownership")).upper() in {"", "UNKNOWN"}:
            items.append(
                _item(
                    f"RV_IMAGE_OWNERSHIP_{asset_ref}",
                    category="IMAGE",
                    severity="WARNING",
                    machine_code="IMAGE_OWNERSHIP_NOT_FULLY_VERIFIED",
                    title="이 이미지를 사용할 권리가 확인되었습니까?",
                    description="사람 확인은 검수 기록으로만 남습니다. 원본 이미지 권리 정보는 바꾸지 않습니다.",
                    scope=f"SECTION:{section_id}",
                    required=True,
                    block=BLOCK_IMAGES,
                    source_refs=[asset_ref],
                )
            )
        if status == "ASSIGNED" and asset_ref:
            items.append(
                _item(
                    f"RV_ALT_MATCH_{section_id}",
                    category="IMAGE",
                    severity="WARNING",
                    machine_code="IMAGE_PIXEL_TO_ALT_SEMANTIC_MATCH_NOT_VERIFIED",
                    title="ALT 설명이 실제 이미지 내용과 일치하는지 확인",
                    description="실제 미리보기가 가능한 사진에 한해 사람이 확인합니다.",
                    scope=f"SECTION:{section_id}",
                    required=True,
                    block=BLOCK_IMAGES,
                    source_refs=[asset_ref],
                )
            )
        elif status == "PENDING_ASSET":
            items.append(
                _item(
                    f"RV_IMAGE_PENDING_{section_id}",
                    category="IMAGE",
                    severity="WARNING",
                    machine_code="PENDING_ASSET",
                    title="이미지 필요",
                    description="실제 과정/제품 사진이 아직 없습니다. 오류가 아니라 미완료 상태입니다.",
                    scope=f"SECTION:{section_id}",
                    required=False,
                    block=BLOCK_IMAGES,
                    source_refs=[],
                )
            )
    deduped: list[dict[str, Any]] = []
    used: set[str] = set()
    for item in items:
        if item["reviewItemId"] in used:
            continue
        used.add(item["reviewItemId"])
        deduped.append(item)
    return deduped


def calculate_blog_review_readiness(
    *,
    quality_report: dict[str, Any],
    review_items: list[dict[str, Any]],
    human_review: dict[str, Any] | None = None,
    reviewer_status: str | None = None,
) -> str:
    quality = _quality_payload(quality_report)
    if _text(quality.get("gateDecision")).upper() == "HOLD":
        return READINESS_BLOCKED
    decisions = _decision_map(human_review)
    rejected = 0
    required_pending = 0
    for item in review_items:
        decision = decisions.get(item["reviewItemId"]) or item.get("humanDecision") or DECISION_PENDING
        if decision == DECISION_REJECTED:
            rejected += 1
        if item.get("required") and decision not in DONE_DECISIONS:
            required_pending += 1
    if rejected:
        return READINESS_BLOCKED
    if required_pending:
        return READINESS_REVIEW_REQUIRED
    if _text(reviewer_status).lower() == "accepted":
        return READINESS_APPROVED
    return READINESS_READY


def apply_blog_human_review_decision(
    bundle: dict[str, Any],
    *,
    review_item_id: str,
    decision: str,
    note: str | None = None,
    reviewed_by: str | None = None,
) -> dict[str, Any]:
    snapshot = copy.deepcopy(bundle)
    out = copy.deepcopy(bundle)
    review = out.get("humanReview") if isinstance(out.get("humanReview"), dict) else _empty_human_review()
    decisions = [item for item in _as_list(review.get("decisions")) if isinstance(item, dict)]
    payload = {
        "reviewItemId": review_item_id,
        "decision": decision,
        "note": note,
        "reviewedAt": datetime.now(timezone.utc).isoformat(),
        "reviewedBy": reviewed_by,
    }
    replaced = False
    for index, item in enumerate(decisions):
        if item.get("reviewItemId") == review_item_id:
            decisions[index] = payload
            replaced = True
            break
    if not replaced:
        decisions.append(payload)
    review["decisions"] = decisions
    for item in _as_list(out.get("reviewItems")):
        if isinstance(item, dict) and item.get("reviewItemId") == review_item_id:
            item["humanDecision"] = decision
            item["reviewerNote"] = note
    review["validationFreshness"] = review.get("validationFreshness") or FRESH_CURRENT
    out["humanReview"] = _sync_review(review, out.get("reviewItems") or [])
    out["humanReview"]["reviewStatus"] = calculate_blog_review_readiness(
        quality_report=out.get("qualityReport") or {},
        review_items=out.get("reviewItems") or [],
        human_review=out["humanReview"],
    )
    out["reviewSummary"] = _bundle_summary(out.get("reviewItems") or [], out.get("imagePlan") or {}, out["humanReview"]["reviewStatus"], out["humanReview"])
    for key in ("context", "intentAnalysis", "contentPlan", "draft", "qualityReport", "imagePlan"):
        if out.get(key) != snapshot.get(key):
            raise RuntimeError("human decision mutated machine result")
    return out


def apply_blog_human_edit(
    bundle: dict[str, Any],
    *,
    selected_title: str | None = None,
    draft_text: str | None = None,
) -> dict[str, Any]:
    out = copy.deepcopy(bundle)
    review = out.get("humanReview") if isinstance(out.get("humanReview"), dict) else _empty_human_review()
    edits = review.get("humanEdits") if isinstance(review.get("humanEdits"), dict) else {}
    if selected_title is not None:
        edits["selectedTitle"] = selected_title
        review["validationFreshness"] = FRESH_STALE
    if draft_text is not None:
        edits["draftText"] = draft_text
        review["validationFreshness"] = FRESH_STALE
    review["humanEdits"] = edits
    out["humanReview"] = review
    out["reviewSummary"] = _bundle_summary(out.get("reviewItems") or [], out.get("imagePlan") or {}, review.get("reviewStatus") or READINESS_REVIEW_REQUIRED, review)
    return out


def is_blog_v2_payload(body: dict[str, Any] | None) -> bool:
    payload = body if isinstance(body, dict) else {}
    if _text(payload.get("generation_version")) == "blog_v2":
        return True
    if isinstance(payload.get("blog_generation"), dict) and payload["blog_generation"].get("version"):
        return True
    if isinstance(payload.get("blog_v2_review_bundle"), dict):
        return True
    draft = payload.get("draft") if isinstance(payload.get("draft"), dict) else {}
    return _text(draft.get("version")) == "blog_professional_draft_v1"


def _resolve_inputs(intent_analysis, content_plan, planner_result) -> tuple[dict[str, Any], dict[str, Any]]:
    if isinstance(planner_result, dict):
        if planner_result.get("status") not in {None, STATUS_PASS}:
            raise ValueError("planner_result_not_pass")
        intent_analysis = planner_result.get("intentAnalysis") if isinstance(planner_result.get("intentAnalysis"), dict) else intent_analysis
        content_plan = planner_result.get("contentPlan") if isinstance(planner_result.get("contentPlan"), dict) else content_plan
    if not isinstance(intent_analysis, dict) or not isinstance(content_plan, dict):
        raise ValueError("intent_and_plan_required")
    return intent_analysis, content_plan


def _quality_payload(value: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value.get("qualityReport"), dict) and value.get("gateDecision") is None:
        return value["qualityReport"]
    return value


def _image_payload(value: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value.get("imagePlan"), dict) and value.get("planStatus") is None:
        return value["imagePlan"]
    return value


def _empty_human_review() -> dict[str, Any]:
    return {
        "version": HUMAN_REVIEW_VERSION,
        "reviewStatus": READINESS_REVIEW_REQUIRED,
        "decisions": [],
        "humanEdits": {},
        "summary": {"requiredCount": 0, "completedCount": 0, "pendingCount": 0, "rejectedCount": 0},
        "reviewer": {"reviewedBy": None},
        "validationFreshness": FRESH_CURRENT,
        "reviewProvenance": {"reviewVersion": HUMAN_REVIEW_VERSION, "generationVersion": "blog_v2"},
    }


def _item(review_item_id: str, *, category: str, severity: str, machine_code: str, title: str, description: str, scope: str, required: bool, block: str, source_refs: list[str]) -> dict[str, Any]:
    return {
        "reviewItemId": review_item_id,
        "category": category,
        "severity": severity,
        "machineCode": machine_code,
        "title": title,
        "description": description,
        "scope": scope,
        "sourceRefs": [item for item in source_refs if item],
        "required": required,
        "block": block,
        "humanDecision": DECISION_PENDING,
        "reviewerNote": None,
    }


def _category_for_code(code: str) -> str:
    if "IMAGE" in code or code == "PENDING_ASSET":
        return "IMAGE"
    if "DISCLOSURE" in code or "CLAIM" in code or "EXPERIENCE" in code or "STUFFING" in code:
        return "CLAIM_SAFETY"
    if code in OPTIONAL_QUALITY_CODES:
        return "READABILITY"
    return "FACT_ACCURACY"


def _human_title(code: str) -> str:
    return QUALITY_COPY.get(code, (code.replace("_", " ").lower(), ""))[0]


def _decision_map(human_review: dict[str, Any] | None) -> dict[str, str]:
    review = human_review if isinstance(human_review, dict) else {}
    out: dict[str, str] = {}
    for item in _as_list(review.get("decisions")):
        if isinstance(item, dict) and item.get("reviewItemId"):
            out[str(item["reviewItemId"])] = _text(item.get("decision")).upper() or DECISION_PENDING
    return out


def _sync_review(review: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    decisions = _decision_map(review)
    for item in items:
        item["humanDecision"] = decisions.get(item["reviewItemId"], item.get("humanDecision") or DECISION_PENDING)
    review["version"] = HUMAN_REVIEW_VERSION
    review["summary"] = _decision_summary(items)
    review["validationFreshness"] = review.get("validationFreshness") or FRESH_CURRENT
    review.setdefault("humanEdits", {})
    review.setdefault("reviewer", {"reviewedBy": None})
    review.setdefault("decisions", [])
    return review


def _decision_summary(items: list[dict[str, Any]]) -> dict[str, int]:
    required = [item for item in items if item.get("required")]
    completed = [item for item in required if item.get("humanDecision") in DONE_DECISIONS]
    pending = [item for item in required if item.get("humanDecision") not in DONE_DECISIONS]
    rejected = [item for item in items if item.get("humanDecision") == DECISION_REJECTED]
    return {
        "requiredCount": len(required),
        "completedCount": len(completed),
        "pendingCount": len(pending),
        "rejectedCount": len(rejected),
    }


def _bundle_summary(items: list[dict[str, Any]], image_plan: dict[str, Any], readiness: str, review: dict[str, Any]) -> dict[str, Any]:
    counts = _decision_summary(items)
    blocked = len([item for item in items if item.get("severity") == "FAIL" or item.get("humanDecision") == DECISION_REJECTED])
    summary = image_plan.get("summary") if isinstance(image_plan.get("summary"), dict) else {}
    assigned = int(summary.get("assignedCount") or 0)
    required_images = int(summary.get("requiredCount") or 0)
    return {
        "reviewReadiness": readiness,
        "blockedCount": blocked,
        "pendingCount": counts["pendingCount"],
        "completedCount": counts["completedCount"],
        "requiredCount": counts["requiredCount"],
        "imageAssignedCount": assigned,
        "imageRequiredCount": required_images,
        "validationFreshness": review.get("validationFreshness") or FRESH_CURRENT,
    }


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()
