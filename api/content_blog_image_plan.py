from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timezone
from typing import Any

from content_blog_context import blog_v2_known_limitations
from content_blog_planner import STATUS_PASS
from content_blog_profiles import max_consecutive_phrase_repeats


PLAN_VERSION = "blog_image_plan_v1"
PLANNER_VERSION = "blog_image_plan_v1"
PLANNING_MODE = "DETERMINISTIC_RULE_BASED"
ALT_GROUNDING = "CONTEXT_GROUNDED_METADATA"

STATUS_READY = "READY"
STATUS_PARTIAL = "PARTIAL"
STATUS_PENDING_ASSETS = "PENDING_ASSETS"
STATUS_HOLD = "HOLD"

ITEM_ASSIGNED = "ASSIGNED"
ITEM_PENDING_ASSET = "PENDING_ASSET"
ITEM_PENDING_GENERATION = "PENDING_GENERATION_REVIEW"
ITEM_NOT_REQUIRED = "NOT_REQUIRED"

SRC_USER = "USER_PROVIDED_IMAGE"
SRC_USAGE = "REAL_USAGE_IMAGE"
SRC_PRODUCT = "REAL_PRODUCT_IMAGE"
SRC_BRAND = "REAL_BRAND_ASSET"
SRC_DETAIL = "DETAIL_PAGE_IMAGE"
SRC_INFOGRAPHIC = "INFOGRAPHIC_CANDIDATE"
SRC_AI = "AI_GENERATION_CANDIDATE"
SRC_UNKNOWN = "UNKNOWN"

ROLE_PRODUCT = "PRODUCT"
ROLE_PROCESS = "PROCESS"
ROLE_EVIDENCE = "EVIDENCE"
ROLE_INFOGRAPHIC = "SUMMARY"
ROLE_DECORATIVE = "DECORATIVE"
ROLE_INFORMATIONAL = "INFORMATIONAL"

PLACEMENTS = ("BEFORE_SECTION", "AFTER_HEADING", "AFTER_PARAGRAPH", "AFTER_SECTION", "LEAD", "CONCLUSION")
RESERVED_SECTIONS = {"LEAD", "CONCLUSION"}
SOURCE_RANK = {
    SRC_USER: 1,
    SRC_USAGE: 2,
    SRC_PRODUCT: 3,
    SRC_BRAND: 4,
    SRC_DETAIL: 5,
    SRC_INFOGRAPHIC: 6,
    SRC_AI: 7,
    SRC_UNKNOWN: 8,
}

CODE_INVALID_ASSET = "INVALID_IMAGE_ASSET_REFERENCE"
CODE_INVALID_PLACEMENT = "INVALID_IMAGE_PLACEMENT_REFERENCE"
CODE_UNSUPPORTED_FACT = "UNSUPPORTED_IMAGE_METADATA_FACT"
CODE_ALT_STUFFING = "ALT_KEYWORD_STUFFING"
CODE_DUPLICATE = "DUPLICATE_IMAGE_ASSIGNMENT"

UNSAFE_FILENAME = re.compile(r'[\\/:*?"<>|]')
DURATION_CLAIM = re.compile(r"\d+\s*(분|시간|일)")
EFFECT_HINTS = ("숙성", "발색이 더", "더 진해", "전후", "before/after", "효과 비교")


def serialize_blog_image_plan(plan: dict[str, Any]) -> str:
    return json.dumps(plan, ensure_ascii=False, sort_keys=True)


def plan_blog_images(
    *,
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any] | None = None,
    content_plan: dict[str, Any] | None = None,
    planner_result: dict[str, Any] | None = None,
    draft: dict[str, Any],
    quality_report: dict[str, Any] | None = None,
    raw_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    originals = {
        "context": blog_context,
        "intent": intent_analysis,
        "plan": content_plan,
        "planner": planner_result,
        "draft": draft,
        "quality": quality_report,
    }
    snapshots = {key: copy.deepcopy(value) if isinstance(value, dict) else value for key, value in originals.items()}
    intent, plan = _resolve_inputs(intent_analysis, content_plan, planner_result)
    working_draft = copy.deepcopy(draft)
    working_context = copy.deepcopy(blog_context)
    if isinstance(raw_plan, dict) and _as_list(raw_plan.get("items")):
        built = copy.deepcopy(raw_plan)
    else:
        built = _build_plan(working_context, intent, plan, working_draft, quality_report)
        if isinstance(raw_plan, dict):
            built.update({key: raw_plan[key] for key in raw_plan if key != "items"})
    result = _validate_plan(built, working_context, intent, plan, working_draft, quality_report)
    for key, original in originals.items():
        if isinstance(original, dict) and original != snapshots[key]:
            raise RuntimeError(f"image planner mutated upstream {key}")
    return result


def _resolve_inputs(
    intent_analysis: dict[str, Any] | None,
    content_plan: dict[str, Any] | None,
    planner_result: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if isinstance(planner_result, dict):
        if planner_result.get("status") not in {None, STATUS_PASS}:
            raise ValueError("planner_result_not_pass")
        intent_analysis = planner_result.get("intentAnalysis") if isinstance(planner_result.get("intentAnalysis"), dict) else intent_analysis
        content_plan = planner_result.get("contentPlan") if isinstance(planner_result.get("contentPlan"), dict) else content_plan
    if not isinstance(intent_analysis, dict) or not isinstance(content_plan, dict):
        raise ValueError("BlogIntentAnalysis and BlogContentPlan are required")
    return intent_analysis, content_plan


def _build_plan(
    blog_context: dict[str, Any],
    intent: dict[str, Any],
    plan: dict[str, Any],
    draft: dict[str, Any],
    quality_report: dict[str, Any] | None,
) -> dict[str, Any]:
    needs = _collect_needs(plan)
    assets = [_normalize_asset(item) for item in _as_list(blog_context.get("availableImages")) if isinstance(item, dict)]
    used: set[str] = set()
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    for index, need in enumerate(needs, start=1):
        items.append(_plan_need(need, index, assets, used, draft, plan, intent, blog_context, warnings))
    unassigned = []
    for asset in assets:
        if asset["assetRef"] not in used:
            unassigned.append(
                {"assetRef": asset["assetRef"], "reason": "NO_MATCHING_SECTION_NEED", "assetSourceType": asset["sourceType"]}
            )
    return {
        "version": PLAN_VERSION,
        "items": items,
        "unassignedAssets": unassigned,
        "warnings": warnings,
        "_qualityVersion": str((quality_report or {}).get("version") or "blog_quality_report_v1"),
    }


def _collect_needs(plan: dict[str, Any]) -> list[dict[str, Any]]:
    needs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in _as_list(plan.get("imageNeeds")):
        if not isinstance(item, dict):
            continue
        section_id = _text(item.get("sectionId"))
        if not section_id or section_id in seen:
            continue
        seen.add(section_id)
        needs.append(_need_from(item, section_id))
    for section in _as_list(plan.get("sections")):
        if not isinstance(section, dict) or not isinstance(section.get("imageNeed"), dict):
            continue
        section_id = _text(section.get("sectionId"))
        if not section_id or section_id in seen:
            continue
        seen.add(section_id)
        payload = dict(section["imageNeed"])
        payload["sectionId"] = section_id
        needs.append(_need_from(payload, section_id))
    return needs


def _need_from(item: dict[str, Any], section_id: str) -> dict[str, Any]:
    status = _text(item.get("status")).upper() or "NEEDED"
    if status not in {"NEEDED", "OPTIONAL", "NOT_NEEDED"}:
        status = "NEEDED"
    purpose = _text(item.get("visualPurpose") or item.get("purpose")) or "시각 자료"
    preferred = _normalize_preferred(_text(item.get("preferredSource")))
    return {
        "sectionId": section_id,
        "visualPurpose": purpose,
        "preferredSource": preferred,
        "status": status,
        "role": _role_for(purpose, preferred),
    }


def _normalize_preferred(value: str) -> str:
    raw = value.upper().replace("-", "_")
    mapping = {
        "REAL_PRODUCT_PHOTO": SRC_PRODUCT,
        "REAL_PRODUCT_IMAGE": SRC_PRODUCT,
        "REAL_USAGE_PHOTO": SRC_USAGE,
        "REAL_USAGE_IMAGE": SRC_USAGE,
        "USER_PROVIDED_IMAGE": SRC_USER,
        "REAL_BRAND_ASSET": SRC_BRAND,
        "DETAIL_PAGE_IMAGE": SRC_DETAIL,
        "INFOGRAPHIC": SRC_INFOGRAPHIC,
        "INFOGRAPHIC_CANDIDATE": SRC_INFOGRAPHIC,
        "AI_GENERATION_CANDIDATE": SRC_AI,
    }
    return mapping.get(raw, raw if raw in SOURCE_RANK else SRC_PRODUCT)


def _role_for(purpose: str, preferred: str) -> str:
    blob = f"{purpose} {preferred}"
    if any(token in blob for token in ("후기", "전후", "효과", "결과", "고객", "evidence", "EVIDENCE")):
        return ROLE_EVIDENCE
    if any(token in blob for token in ("도식", "요약", "비교표", "인포그래픽", "INFOGRAPHIC")):
        return ROLE_INFOGRAPHIC
    if any(token in blob for token in ("사용", "순서", "과정", "혼합", "준비", "도포")):
        return ROLE_PROCESS
    if any(token in blob for token in ("제품", "패키지", "상품", "소개")):
        return ROLE_PRODUCT
    if "장식" in blob:
        return ROLE_DECORATIVE
    return ROLE_INFORMATIONAL


def _normalize_asset(item: dict[str, Any]) -> dict[str, Any]:
    asset_ref = _text(item.get("assetId") or item.get("assetRef") or item.get("id"))
    asset_type = _text(item.get("assetType") or item.get("type")).lower()
    source = _text(item.get("source")).lower()
    filename = _text(item.get("filename") or item.get("original_filename") or item.get("fileUrl"))
    source_type = SRC_UNKNOWN
    if "upload" in source or "user" in source:
        source_type = SRC_USER
    elif asset_type in {"product_image", "product"}:
        source_type = SRC_USER if "upload" in filename or "uploaded" in filename else SRC_PRODUCT
    elif asset_type in {"usage", "usage_image"}:
        source_type = SRC_USAGE
    elif asset_type in {"brand", "brand_asset"}:
        source_type = SRC_BRAND
    elif asset_type in {"detail_page", "detail"}:
        source_type = SRC_DETAIL
    ownership = _text(item.get("ownership") or item.get("copyrightStatus")).upper() or "UNKNOWN"
    if ownership not in {"OWNED", "LICENSED", "USER_PROVIDED", "UNKNOWN"}:
        ownership = "UNKNOWN"
    exif = item.get("exifPresent")
    if exif is True:
        exif_status: Any = True
    elif exif is False:
        exif_status = False
    else:
        exif_status = "unknown"
    return {
        "assetRef": asset_ref,
        "sourceType": source_type,
        "filename": filename,
        "ownership": ownership,
        "exifPresent": exif_status,
        "raw": item,
    }


def _plan_need(
    need: dict[str, Any],
    index: int,
    assets: list[dict[str, Any]],
    used: set[str],
    draft: dict[str, Any],
    plan: dict[str, Any],
    intent: dict[str, Any],
    blog_context: dict[str, Any],
    warnings: list[str],
) -> dict[str, Any]:
    role = need["role"]
    required = need["status"] == "NEEDED"
    placement = _placement_for(need, draft)
    visual = need["visualPurpose"] or "해당 섹션 이해를 돕는 시각 자료"
    risk: list[str] = ["PIXEL_CONTENT_NOT_VERIFIED", "ALT_PIXEL_MATCH_NOT_VERIFIED"]
    generation: dict[str, Any] = {"allowed": False, "reason": None}
    if need["status"] == "NOT_NEEDED":
        return _item(index, need, placement, visual, None, None, ITEM_NOT_REQUIRED, generation, risk, draft, plan, intent, blog_context)
    if need["status"] == "OPTIONAL" and role != ROLE_PRODUCT:
        return _item(index, need, placement, visual, None, None, ITEM_NOT_REQUIRED, generation, risk, draft, plan, intent, blog_context)
    if role == ROLE_EVIDENCE:
        match = _best_asset(assets, used, allowed={SRC_USAGE})
        if match is None:
            risk.append("EVIDENCE_IMAGE_REQUIRES_REAL_SOURCE")
            generation = {"allowed": False, "reason": "EVIDENCE_REPRESENTATION_REQUIRES_REAL_SOURCE"}
            return _item(index, need, placement, visual, None, None, ITEM_PENDING_ASSET, generation, risk, draft, plan, intent, blog_context)
        used.add(match["assetRef"])
        return _item(index, need, placement, visual, match["assetRef"], match["sourceType"], ITEM_ASSIGNED, generation, risk, draft, plan, intent, blog_context, asset=match)
    if _is_before_after(need["visualPurpose"]) and not _has_verified_comparison(plan):
        warnings.append("BEFORE_AFTER_VISUAL_REQUIRES_VERIFIED_SOURCE")
        risk.append("BEFORE_AFTER_REQUIRES_VERIFIED_SOURCE")
        generation = {"allowed": False, "reason": "BEFORE_AFTER_VISUAL_REQUIRES_VERIFIED_SOURCE"}
        return _item(index, need, placement, visual, None, None, ITEM_PENDING_ASSET, generation, risk, draft, plan, intent, blog_context)
    if role == ROLE_INFOGRAPHIC or need["preferredSource"] in {SRC_INFOGRAPHIC, SRC_AI}:
        match = _best_asset(assets, used, allowed={SRC_INFOGRAPHIC})
        if match is None:
            generation = {"allowed": True, "reason": "No suitable real source asset available"}
            return _item(index, need, placement, visual, None, SRC_INFOGRAPHIC, ITEM_PENDING_GENERATION, generation, risk, draft, plan, intent, blog_context)
        used.add(match["assetRef"])
        return _item(index, need, placement, visual, match["assetRef"], match["sourceType"], ITEM_ASSIGNED, generation, risk, draft, plan, intent, blog_context, asset=match)
    if role == ROLE_PROCESS:
        match = _best_asset(assets, used, allowed={SRC_USAGE})
        if match is None:
            generation = {"allowed": False, "reason": "Process visual requires a real usage source"}
            risk.append("ASSET_NOT_AVAILABLE")
            return _item(index, need, placement, visual, None, None, ITEM_PENDING_ASSET, generation, risk, draft, plan, intent, blog_context)
        used.add(match["assetRef"])
        return _item(index, need, placement, visual, match["assetRef"], match["sourceType"], ITEM_ASSIGNED, generation, risk, draft, plan, intent, blog_context, asset=match)
    match = _best_asset(assets, used, allowed={SRC_USER, SRC_PRODUCT, SRC_BRAND, SRC_DETAIL})
    if match is None:
        if not required:
            return _item(index, need, placement, visual, None, None, ITEM_NOT_REQUIRED, generation, risk, draft, plan, intent, blog_context)
        risk.append("ASSET_NOT_AVAILABLE")
        return _item(index, need, placement, visual, None, None, ITEM_PENDING_ASSET, generation, risk, draft, plan, intent, blog_context)
    used.add(match["assetRef"])
    if match["ownership"] == "UNKNOWN":
        risk.append("OWNERSHIP_UNKNOWN")
    return _item(index, need, placement, visual, match["assetRef"], match["sourceType"], ITEM_ASSIGNED, generation, risk, draft, plan, intent, blog_context, asset=match)


def _best_asset(assets: list[dict[str, Any]], used: set[str], *, allowed: set[str]) -> dict[str, Any] | None:
    ranked = sorted(
        [item for item in assets if item["assetRef"] and item["assetRef"] not in used and item["sourceType"] in allowed],
        key=lambda item: SOURCE_RANK.get(item["sourceType"], 9),
    )
    return ranked[0] if ranked else None


def _placement_for(need: dict[str, Any], draft: dict[str, Any]) -> dict[str, Any]:
    if need["role"] == ROLE_PRODUCT:
        return {"position": "AFTER_HEADING", "paragraphIndex": None}
    section = _section(draft, need["sectionId"])
    paragraphs = _as_list((section or {}).get("paragraphs"))
    if paragraphs:
        return {"position": "AFTER_PARAGRAPH", "paragraphIndex": 1 if len(paragraphs) > 1 else 0}
    return {"position": "AFTER_SECTION", "paragraphIndex": None}


def _item(
    index: int,
    need: dict[str, Any],
    placement: dict[str, Any],
    visual: str,
    asset_ref: str | None,
    source_type: str | None,
    status: str,
    generation: dict[str, Any],
    risk: list[str],
    draft: dict[str, Any],
    plan: dict[str, Any],
    intent: dict[str, Any],
    blog_context: dict[str, Any],
    *,
    asset: dict[str, Any] | None = None,
) -> dict[str, Any]:
    section = _section(draft, need["sectionId"]) or {}
    alt, caption = _metadata(need, visual, section, plan, intent, blog_context, asset)
    filename = _filename(intent, blog_context, need, index, asset)
    source_refs = [_text(ref) for ref in _as_list(section.get("sourceRefs")) if _text(ref)]
    return {
        "imagePlanId": f"IMG_PLAN_{index:03d}",
        "sectionId": need["sectionId"],
        "placement": placement,
        "purpose": need["role"],
        "visualDescription": visual,
        "sourcePreference": need["preferredSource"],
        "assetRef": asset_ref,
        "assetSourceType": source_type,
        "status": status,
        "altText": alt,
        "altGrounding": ALT_GROUNDING,
        "caption": caption,
        "filenameSuggestion": filename,
        "generationCandidate": generation,
        "sourceRefs": source_refs,
        "riskNotes": list(dict.fromkeys(risk)),
        "ownership": (asset or {}).get("ownership") or "UNKNOWN",
        "exifPresent": (asset or {}).get("exifPresent", "unknown"),
        "needStatus": need["status"],
    }


def _metadata(
    need: dict[str, Any],
    visual: str,
    section: dict[str, Any],
    plan: dict[str, Any],
    intent: dict[str, Any],
    blog_context: dict[str, Any],
    asset: dict[str, Any] | None,
) -> tuple[str, str]:
    title = _text(blog_context.get("topic")) or _primary_keyword(intent) or "제품"
    heading = _text(section.get("heading"))
    if need["role"] == ROLE_PRODUCT:
        alt = f"{title} 제품 확인용 사진"
        caption = f"{title} 실제 제품 모습을 확인하는 단계"
    elif need["role"] == ROLE_PROCESS:
        statement = _first_statement(section, plan, need["sectionId"])
        alt = f"{title} {visual}"
        caption = _process_caption(statement)
    elif need["role"] == ROLE_INFOGRAPHIC:
        alt = f"{title} {visual}"
        caption = f"{visual}을 확인된 정보 범위에서 정리한 설명 그림"
    elif need["role"] == ROLE_EVIDENCE:
        alt = f"{title} 관련 실제 자료 사진"
        caption = "실제 자료가 있을 때만 배치하는 근거 시각자료"
    else:
        alt = f"{title} {visual}" if visual else f"{title} 시각 자료"
        caption = heading or visual or f"{title} 관련 설명"
    if asset is None and need["role"] not in {ROLE_PRODUCT, ROLE_INFOGRAPHIC}:
        caption = f"{visual}에 사용할 실제 자료가 아직 없습니다"
    return _clean_meta(alt), _clean_meta(caption)


def _process_caption(statement: str) -> str:
    if "섞" in statement:
        return "사용 전 분말과 물을 섞어 준비하는 단계"
    if statement:
        return f"확인된 내용 범위: {statement}"
    return "사용 전 준비 과정을 확인하는 단계"


def _first_statement(section: dict[str, Any], plan: dict[str, Any], section_id: str) -> str:
    for planned in _as_list(plan.get("sections")):
        if _text(planned.get("sectionId")) != section_id:
            continue
        for fact in _as_list(planned.get("factsToUse")):
            statement = _text(fact.get("statement") if isinstance(fact, dict) else fact)
            if statement:
                return statement
    for item in _as_list(section.get("paragraphs")):
        text = _text(item)
        if text:
            return text
    return ""


def _filename(intent: dict[str, Any], blog_context: dict[str, Any], need: dict[str, Any], index: int, asset: dict[str, Any] | None) -> str:
    topic = _slug(_primary_keyword(intent) or _text(blog_context.get("topic")) or "blog")
    purpose = _slug(need["visualPurpose"] or need["role"] or "visual")
    ext = _extension((asset or {}).get("filename")) if asset else "jpg"
    return f"{topic}-{purpose}-{index:02d}.{ext}"


def _slug(value: str) -> str:
    text = re.sub(r"[\\/:*?\"<>|\s]+", "-", _text(value))
    text = re.sub(r"[^0-9A-Za-z가-힣\-]+", "", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:32] or "image"


def _extension(filename: str | None) -> str:
    name = _text(filename).rsplit(".", 1)
    if len(name) == 2 and name[1].lower() in {"jpg", "jpeg", "png", "webp", "gif"}:
        return "jpg" if name[1].lower() == "jpeg" else name[1].lower()
    return "jpg"


def _validate_plan(
    raw: dict[str, Any],
    blog_context: dict[str, Any],
    intent: dict[str, Any],
    plan: dict[str, Any],
    draft: dict[str, Any],
    quality_report: dict[str, Any] | None,
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    warnings = [_text(item) for item in _as_list(raw.get("warnings")) if _text(item)]
    items = [item for item in _as_list(raw.get("items")) if isinstance(item, dict)]
    valid_assets = {
        _text(item.get("assetId") or item.get("assetRef") or item.get("id"))
        for item in _as_list(blog_context.get("availableImages"))
        if isinstance(item, dict)
    }
    valid_sections = {_text(item.get("sectionId")) for item in _as_list(draft.get("sections")) if isinstance(item, dict)}
    valid_sections.update(RESERVED_SECTIONS)
    assigned_refs: dict[str, int] = {}
    filenames: set[str] = set()
    allowed_blob = _allowed_metadata_blob(blog_context, intent, plan, draft)
    for item in items:
        _ensure_unique_filename(item, filenames)
        asset_ref = _text(item.get("assetRef")) or None
        item["assetRef"] = asset_ref
        if asset_ref:
            if asset_ref not in valid_assets:
                issues.append(_issue(CODE_INVALID_ASSET, f"unknown assetRef: {asset_ref}", scope=item.get("sectionId")))
            else:
                assigned_refs[asset_ref] = assigned_refs.get(asset_ref, 0) + 1
        section_id = _text(item.get("sectionId"))
        if section_id and section_id not in valid_sections:
            issues.append(_issue(CODE_INVALID_PLACEMENT, f"unknown sectionId: {section_id}", scope=section_id))
        placement = item.get("placement") if isinstance(item.get("placement"), dict) else {}
        position = _text(placement.get("position")).upper() or "AFTER_SECTION"
        if position not in PLACEMENTS:
            issues.append(_issue(CODE_INVALID_PLACEMENT, f"unknown placement: {position}", scope=section_id))
        if position == "AFTER_PARAGRAPH" and not _valid_paragraph_index(draft, section_id, placement.get("paragraphIndex")):
            issues.append(_issue(CODE_INVALID_PLACEMENT, "paragraphIndex is outside the section paragraphs range", scope=section_id))
        alt = _text(item.get("altText"))
        caption = _text(item.get("caption"))
        if _alt_stuffed(alt, intent):
            issues.append(_issue(CODE_ALT_STUFFING, "ALT contains keyword stuffing", scope=section_id, status="WARNING"))
            warnings.append(CODE_ALT_STUFFING)
        if _unsupported_metadata(caption, allowed_blob) or _unsupported_metadata(alt, allowed_blob):
            issues.append(_issue(CODE_UNSUPPORTED_FACT, "ALT/Caption introduces a fact that is not in source context", scope=section_id))
        if UNSAFE_FILENAME.search(_text(item.get("filenameSuggestion"))):
            issues.append(_issue(CODE_INVALID_PLACEMENT, "filenameSuggestion contains a path separator or unsafe character", scope=section_id))
        packed = json.dumps(item, ensure_ascii=False)
        if any(marker in packed for marker in ("data:image/", "generated_image_url", "fake_asset_url")):
            issues.append(_issue("FAKE_IMAGE_ASSET_CREATED", "plan contains a generated/fake image payload", scope=section_id))
        if item.get("ownership") in {None, ""}:
            item["ownership"] = "UNKNOWN"
        item["altGrounding"] = item.get("altGrounding") or ALT_GROUNDING
        item["generationCandidate"] = item.get("generationCandidate") if isinstance(item.get("generationCandidate"), dict) else {"allowed": False, "reason": None}
    for asset_ref, count in assigned_refs.items():
        if count >= 2:
            warnings.append(CODE_DUPLICATE)
            issues.append(_issue(CODE_DUPLICATE, "same assetRef is assigned more than once", scope="PLAN", status="WARNING", observed=asset_ref))
            for item in items:
                if item.get("assetRef") == asset_ref and CODE_DUPLICATE not in _as_list(item.get("riskNotes")):
                    item.setdefault("riskNotes", []).append(CODE_DUPLICATE)
    required_items = [item for item in items if _text(item.get("needStatus")).upper() == "NEEDED"]
    if not required_items:
        required_items = [item for item in items if item.get("status") != ITEM_NOT_REQUIRED]
    assigned = [item for item in required_items if item.get("status") == ITEM_ASSIGNED]
    pending = [item for item in required_items if item.get("status") in {ITEM_PENDING_ASSET, ITEM_PENDING_GENERATION}]
    missing = [
        {"sectionId": item.get("sectionId"), "visualDescription": item.get("visualDescription"), "status": item.get("status")}
        for item in items
        if item.get("status") in {ITEM_PENDING_ASSET, ITEM_PENDING_GENERATION}
    ]
    hold_codes = {item["code"] for item in issues if item.get("status") != "WARNING"}
    if hold_codes:
        plan_status = STATUS_HOLD
    elif required_items and len(assigned) == len(required_items):
        plan_status = STATUS_READY
    elif assigned and pending:
        plan_status = STATUS_PARTIAL
    elif pending and not assigned:
        plan_status = STATUS_PENDING_ASSETS
    else:
        plan_status = STATUS_READY
    limitations = [dict(item) for item in blog_v2_known_limitations()]
    image_plan = {
        "version": PLAN_VERSION,
        "planStatus": plan_status,
        "summary": {
            "requiredCount": len(required_items),
            "assignedCount": len(assigned),
            "pendingCount": len(pending),
            "availableAssetCount": len(valid_assets),
        },
        "coverage": {
            "plannedImageNeeds": len(items),
            "resolved": len([item for item in items if item.get("status") == ITEM_ASSIGNED]),
            "pending": len(missing),
        },
        "items": [{key: value for key, value in item.items() if not str(key).startswith("_")} for item in items],
        "unassignedAssets": [item for item in _as_list(raw.get("unassignedAssets")) if isinstance(item, dict)],
        "missingVisuals": missing,
        "warnings": list(dict.fromkeys(warnings)),
        "limitations": limitations,
        "imagePlanProvenance": {
            "plannerVersion": PLANNER_VERSION,
            "generationVersion": "blog_v2",
            "contextVersion": str(blog_context.get("version") or "blog_generation_context_v1"),
            "contentPlanVersion": str(plan.get("version") or "blog_content_plan_v1"),
            "writerVersion": str((draft.get("writerProvenance") or {}).get("writerVersion") or "blog_professional_writer_v1"),
            "qualityReportVersion": str((quality_report or {}).get("version") or raw.get("_qualityVersion") or "blog_quality_report_v1"),
            "planningMode": PLANNING_MODE,
            "plannedAt": datetime.now(timezone.utc).isoformat(),
        },
    }
    return {
        "status": STATUS_HOLD if plan_status == STATUS_HOLD else STATUS_PASS,
        "code": next((item["code"] for item in issues if item.get("status") != "WARNING"), None),
        "issues": issues,
        "imagePlan": image_plan,
    }


def _ensure_unique_filename(item: dict[str, Any], filenames: set[str]) -> None:
    name = _text(item.get("filenameSuggestion")) or "image-01.jpg"
    if name not in filenames:
        filenames.add(name)
        item["filenameSuggestion"] = name
        return
    stem, ext = (name.rsplit(".", 1) + ["jpg"])[:2]
    sequence = 2
    candidate = f"{stem}-{sequence:02d}.{ext}"
    while candidate in filenames:
        sequence += 1
        candidate = f"{stem}-{sequence:02d}.{ext}"
    filenames.add(candidate)
    item["filenameSuggestion"] = candidate


def _valid_paragraph_index(draft: dict[str, Any], section_id: str, index: Any) -> bool:
    section = _section(draft, section_id)
    if section is None:
        return False
    paragraphs = _as_list(section.get("paragraphs"))
    try:
        value = int(index)
    except (TypeError, ValueError):
        return False
    return value in set(range(len(paragraphs))) | set(range(1, len(paragraphs) + 1))


def _alt_stuffed(alt: str, intent: dict[str, Any]) -> bool:
    if not alt:
        return False
    if max_consecutive_phrase_repeats(alt) >= 3:
        return True
    tokens = re.findall(r"[가-힣A-Za-z0-9]{2,}", alt)
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    if counts and max(counts.values()) >= 3:
        return True
    keyword = _primary_keyword(intent)
    return bool(keyword and alt.count(keyword) >= 3)


def _unsupported_metadata(text: str, allowed_blob: str) -> bool:
    blob = _text(text)
    if not blob:
        return False
    for hint in EFFECT_HINTS:
        if hint in blob and hint not in allowed_blob:
            return True
    if DURATION_CLAIM.search(blob) and not DURATION_CLAIM.search(allowed_blob):
        return True
    return False


def _allowed_metadata_blob(blog_context: dict[str, Any], intent: dict[str, Any], plan: dict[str, Any], draft: dict[str, Any]) -> str:
    parts = [
        _text(blog_context.get("topic")),
        _primary_keyword(intent),
        json.dumps(blog_context.get("sourceFacts") or [], ensure_ascii=False),
        json.dumps(blog_context.get("evidence") or [], ensure_ascii=False),
        json.dumps(plan.get("imageNeeds") or [], ensure_ascii=False),
        json.dumps(draft.get("sections") or [], ensure_ascii=False),
        json.dumps(draft.get("lead") or {}, ensure_ascii=False),
    ]
    return " ".join(parts)


def _is_before_after(purpose: str) -> bool:
    return any(token in purpose for token in ("전/후", "전후", "before", "after", "효과 비교", "사용 전후"))


def _has_verified_comparison(plan: dict[str, Any]) -> bool:
    return bool(_as_list(plan.get("comparisonPlan")))


def _section(draft: dict[str, Any], section_id: str) -> dict[str, Any] | None:
    for item in _as_list(draft.get("sections")):
        if isinstance(item, dict) and _text(item.get("sectionId")) == section_id:
            return item
    return None


def _primary_keyword(intent: dict[str, Any]) -> str:
    plan = intent.get("keywordPlan") if isinstance(intent.get("keywordPlan"), dict) else {}
    return _text(plan.get("primaryKeyword"))


def _clean_meta(value: str) -> str:
    return " ".join(_text(value).split())


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _issue(code: str, message: str, *, scope: Any = "PLAN", status: str = "FAIL", observed: Any = None) -> dict[str, Any]:
    item = {"code": code, "status": status, "scope": str(scope or "PLAN"), "message": message}
    if observed is not None:
        item["observed"] = observed
    return item
