from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import uuid
from datetime import datetime
from typing import Any

import requests
from sqlalchemy import or_
from sqlalchemy.orm import Session

from content_center_engine import _new_id
from db import ContentProductInfo, ContentSkuAsset, ContentSkuScope, TrackedProductMeta
from settings_store import get_api_settings


ASSET_TYPES = {"product_image", "detail_page", "reference_media", "ingredient_document"}
IMAGE_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/mpeg",
    "video/webm",
    "video/quicktime",
    "video/x-m4v",
    "video/x-msvideo",
    "video/avi",
    "video/x-ms-wmv",
    "video/x-matroska",
    "video/3gpp",
}
UPLOAD_MIME_TYPES = IMAGE_MIME_TYPES | VIDEO_MIME_TYPES | {"application/pdf"}
EXTENSION_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".mkv": "video/x-matroska",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".3gp": "video/3gpp",
}


def content_asset_dir() -> str:
    base = os.getenv("CONTENT_ASSET_DIR") or "/data/content_assets"
    os.makedirs(base, exist_ok=True)
    return base


def content_asset_path(filename: str) -> str:
    safe = os.path.basename(str(filename or "").strip())
    return os.path.join(content_asset_dir(), safe)


def _api_setting(db: Session, name: str) -> str:
    value = str(get_api_settings(db, [name]).get(name, "") or "").strip()
    return value or str(os.getenv(name) or "").strip()


def _safe_ext(filename: str, mime_type: str, *, allow_any_ext: bool = False) -> str:
    ext = os.path.splitext(os.path.basename(str(filename or "")))[1].lower()
    if allow_any_ext and re.fullmatch(r"\.[a-z0-9][a-z0-9._-]{0,31}", ext or ""):
        return ext
    if ext in EXTENSION_MIME_TYPES:
        return ext
    guessed = mimetypes.guess_extension(mime_type or "") or ""
    return guessed if guessed in EXTENSION_MIME_TYPES else ".bin"


def _upload_mime_type(filename: str | None, content_type: str | None) -> str:
    ext = os.path.splitext(str(filename or ""))[1].lower()
    guessed = EXTENSION_MIME_TYPES.get(ext) or mimetypes.guess_type(filename or "")[0]
    raw = str(content_type or "").split(";")[0].strip().lower()
    if raw in {"", "application/octet-stream", "binary/octet-stream", "application/x-msdownload"} and guessed:
        return str(guessed).lower()
    if raw:
        return raw
    return str(guessed or "application/octet-stream").lower()


def _resolve_product_url(db: Session, *, sku_id: str, product_url: str | None) -> str:
    if product_url:
        return str(product_url or "").strip()
    if sku_id.lower().startswith(("http://", "https://")):
        return sku_id
    scope = db.get(ContentSkuScope, sku_id)
    if scope and scope.product_url:
        return str(scope.product_url or "").strip()
    if sku_id.isdigit():
        meta = db.query(TrackedProductMeta).filter(TrackedProductMeta.product_id_catalog == int(sku_id)).first()
        if meta and meta.product_url:
            return str(meta.product_url or "").strip()
    return ""


def asset_to_dict(row: ContentSkuAsset) -> dict[str, Any]:
    analysis = None
    if row.analysis_json:
        try:
            analysis = json.loads(row.analysis_json or "{}")
        except Exception:
            analysis = {"raw": row.analysis_json}
    if isinstance(analysis, dict) and isinstance(analysis.get("summary"), str) and "{" in str(analysis.get("summary") or ""):
        parsed_summary = _parse_openai_json_or_summary(str(analysis.get("summary") or ""))
        if isinstance(parsed_summary, dict) and not (set(parsed_summary.keys()) == {"summary"}):
            for key in ("model", "sampled_frame_count", "source_mime_type"):
                if key in analysis and key not in parsed_summary:
                    parsed_summary[key] = analysis.get(key)
            analysis = parsed_summary
    return {
        "asset_id": row.asset_id,
        "sku_id": row.sku_id,
        "product_url": row.product_url,
        "asset_type": row.asset_type,
        "asset_group_id": row.asset_group_id,
        "group_name": row.group_name,
        "category": row.category,
        "keywords": row.keywords,
        "sku_ids": row.sku_ids,
        "filename": row.filename,
        "original_filename": row.original_filename,
        "mime_type": row.mime_type,
        "file_url": row.file_url,
        "sort_order": row.sort_order,
        "is_primary": bool(row.is_primary),
        "analysis_status": row.analysis_status,
        "analysis": analysis,
        "error_message": row.error_message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _normalize_product_info_items(value: Any) -> list[dict[str, str]]:
    raw_items = value if isinstance(value, list) else []
    out: list[dict[str, str]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        product_key = str(item.get("product_key") or item.get("productKey") or "").strip()
        product_name = str(item.get("product_name") or item.get("productName") or item.get("name") or "").strip()
        full_ingredients = str(item.get("full_ingredients") or item.get("fullIngredients") or item.get("ingredients") or "").strip()
        note = str(item.get("note") or "").strip()
        ingredient_note = str(item.get("ingredient_note") or item.get("ingredientNote") or "").strip()
        source_note = str(item.get("source_note") or item.get("sourceNote") or "").strip()
        if not product_name and not full_ingredients and not note and not ingredient_note and not source_note:
            continue
        out.append({
            "product_key": product_key or f"product-{len(out) + 1}",
            "product_name": product_name,
            "full_ingredients": full_ingredients,
            "note": note,
            "ingredient_note": ingredient_note,
            "source_note": source_note,
        })
    return out


def _product_info_items_from_row(row: ContentProductInfo | None) -> list[dict[str, str]]:
    if not row:
        return []
    parsed: Any = []
    if row.product_items_json:
        try:
            parsed = json.loads(row.product_items_json or "[]")
        except Exception:
            parsed = []
    items = _normalize_product_info_items(parsed)
    if not items and str(row.full_ingredients or "").strip():
        items = [{
            "product_key": "product-1",
            "product_name": "",
            "full_ingredients": str(row.full_ingredients or "").strip(),
            "note": "",
            "ingredient_note": str(row.ingredient_note or "").strip(),
            "source_note": str(row.source_note or "").strip(),
        }]
    return items


def product_info_to_dict(row: ContentProductInfo | None, *, sku_id: str, product_url: str = "") -> dict[str, Any]:
    product_items = _product_info_items_from_row(row)
    return {
        "sku_id": sku_id,
        "product_url": row.product_url if row and row.product_url else (product_url or None),
        "full_ingredients": row.full_ingredients if row else "",
        "product_items": product_items,
        "ingredient_note": row.ingredient_note if row else "",
        "source_note": row.source_note if row else "",
        "created_at": row.created_at.isoformat() if row and row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def _asset_query(db: Session, *, sku_id: str, asset_type: str):
    product_url = _resolve_product_url(db, sku_id=sku_id, product_url=None)
    filters = [ContentSkuAsset.sku_id == sku_id]
    if product_url:
        filters.append(ContentSkuAsset.product_url == product_url)
    return db.query(ContentSkuAsset).filter(ContentSkuAsset.asset_type == asset_type).filter(or_(*filters))


def _reference_group_key(group_name: str, category: str, keywords: str) -> str:
    basis = "|".join([str(group_name or "").strip(), str(category or "").strip(), str(keywords or "").strip()])
    if not basis.strip("|"):
        return _new_id("RMG")
    import hashlib

    return "RMG_" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def _reference_terms(text: str) -> list[str]:
    raw = str(text or "").replace(",", " ").replace("#", " ")
    return [x.strip().lower() for x in raw.split() if len(x.strip()) >= 2]


def _reference_media_match_haystack(db: Session, sku_id: str | None) -> str:
    sku = str(sku_id or "").strip()
    if not sku:
        return ""
    scope = db.get(ContentSkuScope, sku)
    parts = [sku]
    if scope:
        parts.extend([scope.title or "", scope.product_url or "", scope.product_group or ""])
    if sku.isdigit():
        meta = db.query(TrackedProductMeta).filter(TrackedProductMeta.product_id_catalog == int(sku)).first()
        if meta:
            parts.extend([getattr(meta, "name", "") or "", getattr(meta, "product_url", "") or ""])
    return " ".join(str(x or "") for x in parts).lower()


def primary_product_asset_reference(db: Session, sku_id: str | None) -> dict[str, str]:
    sku = str(sku_id or "").strip()
    if not sku:
        return {}
    row = (
        _asset_query(db, sku_id=sku, asset_type="product_image")
        .order_by(ContentSkuAsset.is_primary.desc(), ContentSkuAsset.sort_order.asc(), ContentSkuAsset.created_at.desc())
        .first()
    )
    if row is None:
        return {}
    scope = db.get(ContentSkuScope, row.sku_id)
    try:
        analysis = json.loads(row.analysis_json or "{}") if row.analysis_json else None
    except Exception:
        analysis = {"raw": row.analysis_json}
    return {
        "product_image_url": row.file_url,
        "product_image_path": row.file_path,
        "product_url": row.product_url or "",
        "product_title": str(getattr(scope, "title", "") or "").strip(),
        "source": "content_sku_asset",
        "asset_id": row.asset_id,
        "analysis": analysis,
    }


def detail_page_context_for_sku(db: Session, sku_id: str | None, *, limit: int = 3) -> list[dict[str, Any]]:
    sku = str(sku_id or "").strip()
    if not sku:
        return []
    rows = (
        _asset_query(db, sku_id=sku, asset_type="detail_page")
        .filter(ContentSkuAsset.analysis_status == "ANALYZED")
        .order_by(ContentSkuAsset.sort_order.asc(), ContentSkuAsset.updated_at.desc())
        .limit(limit)
        .all()
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            analysis = json.loads(row.analysis_json or "{}")
        except Exception:
            analysis = {"raw": row.analysis_json}
        out.append({"asset_id": row.asset_id, "file_url": row.file_url, "analysis": analysis})
    return out


def _asset_image_reference(row: ContentSkuAsset, *, source: str) -> dict[str, Any] | None:
    if row.mime_type not in IMAGE_MIME_TYPES:
        return None
    try:
        with open(row.file_path, "rb") as f:
            data = f.read()
    except Exception:
        return None
    if not data:
        return None
    return {
        "filename": row.original_filename or row.filename,
        "mime_type": row.mime_type or "image/png",
        "data_base64": base64.b64encode(data).decode("ascii"),
        "size": len(data),
        "source": source,
        "asset_id": row.asset_id,
        "file_url": row.file_url,
    }


def _asset_video_frame_references(row: ContentSkuAsset, *, source: str, limit: int = 2) -> list[dict[str, Any]]:
    if row.mime_type not in VIDEO_MIME_TYPES:
        return []
    try:
        import cv2  # type: ignore
    except Exception:
        return []
    cap = cv2.VideoCapture(row.file_path)
    if not cap.isOpened():
        return []
    frames: list[dict[str, Any]] = []
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        targets = [0]
        if total > 8:
            targets = [max(0, int(total * 0.25)), max(0, int(total * 0.65))]
        for idx, frame_no in enumerate(targets[: max(1, limit)]):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            ok2, buf = cv2.imencode(".png", frame)
            if not ok2:
                continue
            raw = bytes(buf)
            frames.append(
                {
                    "filename": f"{os.path.splitext(row.original_filename or row.filename)[0]}_frame_{idx + 1}.png",
                    "mime_type": "image/png",
                    "data_base64": base64.b64encode(raw).decode("ascii"),
                    "size": len(raw),
                    "source": source,
                    "asset_id": row.asset_id,
                    "file_url": row.file_url,
                    "frame_no": frame_no,
                }
            )
    finally:
        cap.release()
    return frames


def _parse_openai_json_or_summary(content: str) -> dict[str, Any]:
    text = str(content or "").strip()
    candidates = [text]
    if text.startswith("```"):
        fenced = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE).strip()
        fenced = re.sub(r"\s*```$", "", fenced).strip()
        candidates.append(fenced)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
            return {"items": parsed}
        except Exception:
            continue
    return {"summary": text}


def reference_media_context_for_sku(db: Session, sku_id: str | None, *, limit: int = 6) -> list[dict[str, Any]]:
    rows = (
        db.query(ContentSkuAsset)
        .filter(ContentSkuAsset.asset_type == "reference_media")
        .filter(ContentSkuAsset.analysis_status == "ANALYZED")
        .order_by(ContentSkuAsset.sort_order.asc(), ContentSkuAsset.updated_at.desc())
        .all()
    )
    haystack = _reference_media_match_haystack(db, sku_id)
    scored: list[tuple[int, ContentSkuAsset]] = []
    for row in rows:
        terms = _reference_terms(" ".join([row.category or "", row.keywords or "", row.group_name or ""]))
        score = sum(1 for term in terms if term in haystack)
        linked_skus = {x.strip() for x in str(row.sku_ids or "").replace("\n", ",").split(",") if x.strip()}
        if str(sku_id or "").strip() in linked_skus:
            score += 100
        if score > 0:
            scored.append((score, row))
    ranked = [row for _, row in sorted(scored, key=lambda item: (item[0], item[1].updated_at or item[1].created_at), reverse=True)]
    if not ranked:
        ranked = rows[:limit]
    out: list[dict[str, Any]] = []
    for row in ranked[:limit]:
        try:
            analysis = json.loads(row.analysis_json or "{}")
        except Exception:
            analysis = {"raw": row.analysis_json}
        out.append(
            {
                "asset_id": row.asset_id,
                "asset_group_id": row.asset_group_id,
                "group_name": row.group_name,
                "category": row.category,
                "keywords": row.keywords,
                "sku_ids": row.sku_ids,
                "file_url": row.file_url,
                "mime_type": row.mime_type,
                "analysis": analysis,
            }
        )
    return out


def reference_media_image_references_for_sku(db: Session, sku_id: str | None, *, limit: int = 2) -> list[dict[str, Any]]:
    context = reference_media_context_for_sku(db, sku_id, limit=limit)
    ids = [str(x.get("asset_id") or "") for x in context if isinstance(x, dict) and x.get("asset_id")]
    rows = db.query(ContentSkuAsset).filter(ContentSkuAsset.asset_id.in_(ids)).all() if ids else []
    order = {asset_id: idx for idx, asset_id in enumerate(ids)}
    rows = sorted(rows, key=lambda row: order.get(row.asset_id, 9999))
    refs: list[dict[str, Any]] = []
    for row in rows:
        if row.mime_type in IMAGE_MIME_TYPES:
            ref = _asset_image_reference(row, source="content_center_reference_media")
            if ref:
                refs.append(ref)
        elif row.mime_type in VIDEO_MIME_TYPES:
            refs.extend(_asset_video_frame_references(row, source="content_center_reference_media_frame", limit=1))
        if len(refs) >= limit:
            break
    return refs[:limit]


def _analyze_detail_page_asset(db: Session, row: ContentSkuAsset) -> dict[str, Any]:
    if row.mime_type not in IMAGE_MIME_TYPES:
        raise RuntimeError("detail_page_analysis_only_supports_image_uploads")
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    with open(row.file_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    model = str(os.getenv("CONTENT_DETAIL_PAGE_ANALYSIS_MODEL") or os.getenv("CONTENT_WRITER_MODEL") or "gpt-4o-mini").strip()
    prompt = (
        "Analyze this Korean ecommerce product detail page image for content production. "
        "Return compact JSON with keys: usp, ingredients_or_components, usage_steps, proof_points, tone_keywords, image_scene_hints, compliance_risks, copy_constraints. "
        "Focus only on facts visible in the uploaded detail page. Do not invent claims."
    )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{row.mime_type};base64,{b64}"}},
                ],
            }
        ],
        "temperature": 0.2,
        "max_tokens": 900,
    }
    resp = requests.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=payload, timeout=90)
    if int(resp.status_code) != 200:
        raise RuntimeError(f"openai_detail_page_analysis_failed:{resp.status_code}:{str(resp.text or '')[:600]}")
    content = str(((resp.json() or {}).get("choices") or [{}])[0].get("message", {}).get("content") or "").strip()
    parsed = _parse_openai_json_or_summary(content)
    parsed["model"] = model
    return parsed


def _analyze_product_image_asset(db: Session, row: ContentSkuAsset) -> dict[str, Any]:
    if row.mime_type not in IMAGE_MIME_TYPES:
        raise RuntimeError("product_image_analysis_only_supports_image_uploads")
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    with open(row.file_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    model = str(os.getenv("CONTENT_PRODUCT_IMAGE_ANALYSIS_MODEL") or os.getenv("CONTENT_WRITER_MODEL") or "gpt-4o-mini").strip()
    prompt = (
        "Analyze this ecommerce product/package image for future ad creative generation. "
        "Return compact JSON with keys: product_identity, package_visuals, readable_labels, product_angles, color_palette, texture_or_material_cues, usable_banner_roles, recognition_risks, do_not_invent_rules. "
        "Focus only on visible product/package facts. Do not invent claims, certifications, effects, or ingredients."
    )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{row.mime_type};base64,{b64}", "detail": "high"}},
                ],
            }
        ],
        "temperature": 0.2,
        "max_tokens": 900,
    }
    resp = requests.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=payload, timeout=90)
    if int(resp.status_code) != 200:
        raise RuntimeError(f"openai_product_image_analysis_failed:{resp.status_code}:{str(resp.text or '')[:600]}")
    content = str(((resp.json() or {}).get("choices") or [{}])[0].get("message", {}).get("content") or "").strip()
    parsed = _parse_openai_json_or_summary(content)
    parsed["model"] = model
    return parsed


def _analyze_reference_media_asset(db: Session, row: ContentSkuAsset) -> dict[str, Any]:
    if row.mime_type not in IMAGE_MIME_TYPES and row.mime_type not in VIDEO_MIME_TYPES:
        raise RuntimeError("reference_media_analysis_only_supports_image_or_video")
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    refs = []
    if row.mime_type in IMAGE_MIME_TYPES:
        ref = _asset_image_reference(row, source="content_center_reference_media")
        if ref:
            refs.append(ref)
    else:
        refs.extend(_asset_video_frame_references(row, source="content_center_reference_media_frame", limit=3))
    if not refs:
        raise RuntimeError("reference_media_frame_extract_failed")
    model = str(os.getenv("CONTENT_REFERENCE_MEDIA_ANALYSIS_MODEL") or os.getenv("CONTENT_WRITER_MODEL") or "gpt-4o-mini").strip()
    prompt = (
        "Analyze these Korean ecommerce shooting reference images or sampled video frames for future ad/banner generation. "
        "Return compact JSON with keys: scene_types, product_angles, human_or_hand_actions, texture_or_material_cues, background_props, color_palette, mood_keywords, motion_cues, banner_generation_uses, avoid_copying_risks. "
        "Focus on reusable visual ingredients and composition options. Do not invent product claims, text, certifications, or results."
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for ref in refs[:4]:
        content.append({"type": "image_url", "image_url": {"url": f"data:{ref['mime_type']};base64,{ref['data_base64']}", "detail": "high"}})
    payload = {"model": model, "messages": [{"role": "user", "content": content}], "temperature": 0.2, "max_tokens": 900}
    resp = requests.post("https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=payload, timeout=90)
    if int(resp.status_code) != 200:
        raise RuntimeError(f"openai_reference_media_analysis_failed:{resp.status_code}:{str(resp.text or '')[:600]}")
    raw = str(((resp.json() or {}).get("choices" ) or [{}])[0].get("message", {}).get("content") or "").strip()
    parsed = _parse_openai_json_or_summary(raw)
    parsed["model"] = model
    parsed["sampled_frame_count"] = len(refs)
    parsed["source_mime_type"] = row.mime_type
    return parsed


def register_content_asset_routes(app, *, get_db_dep) -> None:
    from fastapi import Body, Depends, File, Form, HTTPException
    from fastapi.responses import FileResponse

    @app.get("/content/assets")
    def get_content_assets(sku_id: str | None = None, asset_type: str | None = None, db: Session = Depends(get_db_dep)):
        q = db.query(ContentSkuAsset)
        if sku_id:
            product_url = _resolve_product_url(db, sku_id=str(sku_id), product_url=None)
            filters = [ContentSkuAsset.sku_id == str(sku_id)]
            if product_url:
                filters.append(ContentSkuAsset.product_url == product_url)
            q = q.filter(or_(*filters))
        if asset_type:
            q = q.filter(ContentSkuAsset.asset_type == str(asset_type))
        rows = q.order_by(ContentSkuAsset.asset_type.asc(), ContentSkuAsset.is_primary.desc(), ContentSkuAsset.sort_order.asc(), ContentSkuAsset.created_at.desc()).all()
        return {"ok": True, "items": [asset_to_dict(row) for row in rows]}

    @app.get("/content/product-info")
    def get_content_product_info(sku_id: str | None = None, db: Session = Depends(get_db_dep)):
        q = db.query(ContentProductInfo)
        if sku_id:
            q = q.filter(ContentProductInfo.sku_id == str(sku_id))
        rows = q.order_by(ContentProductInfo.updated_at.desc()).all()
        return {"ok": True, "items": [product_info_to_dict(row, sku_id=row.sku_id, product_url=row.product_url or "") for row in rows]}

    @app.put("/content/product-info/{sku_id}")
    def put_content_product_info(sku_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        sku = str(sku_id or "").strip()
        if not sku:
            raise HTTPException(status_code=400, detail="sku_id_required")
        product_url0 = _resolve_product_url(db, sku_id=sku, product_url=str(payload.get("product_url") or "").strip() or None)
        product_items = _normalize_product_info_items(payload.get("product_items") if "product_items" in payload else payload.get("productItems"))
        full_ingredients = str(payload.get("full_ingredients") or payload.get("fullIngredients") or "").strip()
        if not full_ingredients and product_items:
            full_ingredients = "\n\n".join(
                f"{item.get('product_name') or '제품'}: {item.get('full_ingredients') or ''}".strip()
                for item in product_items
                if str(item.get("full_ingredients") or "").strip()
            ).strip()
        ingredient_note = str(payload.get("ingredient_note") or payload.get("ingredientNote") or "").strip()
        source_note = str(payload.get("source_note") or payload.get("sourceNote") or "").strip()
        row = db.get(ContentProductInfo, sku)
        if row is None:
            row = ContentProductInfo(sku_id=sku, created_at=datetime.now())
        row.product_url = product_url0 or None
        row.full_ingredients = full_ingredients or None
        row.product_items_json = json.dumps(product_items, ensure_ascii=False) if product_items else None
        row.ingredient_note = ingredient_note or None
        row.source_note = source_note or None
        row.updated_at = datetime.now(row.created_at.tzinfo) if row.created_at else datetime.now()
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"ok": True, "item": product_info_to_dict(row, sku_id=sku, product_url=product_url0)}

    @app.post("/content/assets/upload")
    async def post_content_asset_upload(
        sku_id: str = Form(...),
        asset_type: str = Form("product_image"),
        product_url: str | None = Form(None),
        asset_group_id: str | None = Form(None),
        group_name: str | None = Form(None),
        category: str | None = Form(None),
        keywords: str | None = Form(None),
        sku_ids: str | None = Form(None),
        is_primary: bool = Form(False),
        sort_order: int = Form(0),
        file = File(...),
        db: Session = Depends(get_db_dep),
    ):
        asset_type0 = str(asset_type or "").strip()
        if asset_type0 not in ASSET_TYPES:
            raise HTTPException(status_code=400, detail="unsupported_content_asset_type")
        mime = _upload_mime_type(file.filename, file.content_type)
        if asset_type0 != "ingredient_document" and mime not in UPLOAD_MIME_TYPES:
            raise HTTPException(status_code=400, detail="unsupported_content_asset_mime")
        sku = str(sku_id or "").strip()
        group_name0 = str(group_name or "").strip()
        category0 = str(category or "").strip()
        keywords0 = str(keywords or "").strip()
        sku_ids0 = ",".join(x.strip() for x in str(sku_ids or "").replace("\n", ",").split(",") if x.strip())
        asset_group_id0 = str(asset_group_id or "").strip()
        if asset_type0 == "reference_media":
            if not asset_group_id0:
                asset_group_id0 = _reference_group_key(group_name0, category0, keywords0)
            if not sku:
                sku = f"GROUP:{asset_group_id0}"
            if not group_name0:
                group_name0 = category0 or keywords0 or asset_group_id0
            if not category0 and not keywords0:
                raise HTTPException(status_code=400, detail="reference_media_category_or_keywords_required")
        elif not sku:
            raise HTTPException(status_code=400, detail="sku_id_required")
        asset_id = _new_id("CA")
        ext = _safe_ext(file.filename or "", mime, allow_any_ext=asset_type0 == "ingredient_document")
        filename = f"content_asset_{asset_type0}_{asset_id}_{uuid.uuid4().hex}{ext}"
        path = content_asset_path(filename)
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="empty_upload_file")
        with open(path, "wb") as f:
            f.write(data)
        product_url0 = _resolve_product_url(db, sku_id=sku, product_url=product_url)
        primary = bool(is_primary)
        if asset_type0 == "product_image" and not primary:
            existing = _asset_query(db, sku_id=sku, asset_type="product_image").first()
            primary = existing is None
        if primary:
            _asset_query(db, sku_id=sku, asset_type=asset_type0).update({"is_primary": False}, synchronize_session=False)
        row = ContentSkuAsset(
            asset_id=asset_id,
            sku_id=sku,
            product_url=product_url0 or None,
            asset_type=asset_type0,
            asset_group_id=asset_group_id0 or None,
            group_name=group_name0 or None,
            category=category0 or None,
            keywords=keywords0 or None,
            sku_ids=sku_ids0 or None,
            filename=filename,
            original_filename=file.filename,
            mime_type=mime,
            file_path=path,
            file_url=f"/content/assets/files/{filename}",
            sort_order=int(sort_order or 0),
            is_primary=primary,
            analysis_status="READY" if asset_type0 == "product_image" else "PENDING",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"ok": True, "item": asset_to_dict(row)}

    @app.patch("/content/assets/reference-media-groups/{asset_group_id}")
    def patch_reference_media_group(asset_group_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        group_id = str(asset_group_id or "").strip()
        if not group_id:
            raise HTTPException(status_code=400, detail="asset_group_id_required")
        rows = (
            db.query(ContentSkuAsset)
            .filter(ContentSkuAsset.asset_type == "reference_media")
            .filter(ContentSkuAsset.asset_group_id == group_id)
            .all()
        )
        if not rows:
            raise HTTPException(status_code=404, detail="reference_media_group_not_found")
        group_name0 = str(payload.get("group_name") or "").strip()
        category0 = str(payload.get("category") or "").strip()
        keywords0 = str(payload.get("keywords") or "").strip()
        sku_ids_raw = payload.get("sku_ids") if "sku_ids" in payload else payload.get("skuIds")
        if isinstance(sku_ids_raw, list):
            sku_ids0 = ",".join(str(x).strip() for x in sku_ids_raw if str(x).strip())
        else:
            sku_ids0 = ",".join(x.strip() for x in str(sku_ids_raw or "").replace("\n", ",").split(",") if x.strip())
        for row in rows:
            if group_name0:
                row.group_name = group_name0
            if category0:
                row.category = category0
            row.keywords = keywords0 or None
            row.sku_ids = sku_ids0 or None
            row.updated_at = datetime.now(row.created_at.tzinfo) if row.created_at else datetime.now()
            db.add(row)
        db.commit()
        return {"ok": True, "asset_group_id": group_id, "updated_count": len(rows), "items": [asset_to_dict(row) for row in rows]}

    @app.post("/content/assets/{asset_id}/primary")
    def post_content_asset_primary(asset_id: str, db: Session = Depends(get_db_dep)):
        row = db.get(ContentSkuAsset, asset_id)
        if row is None:
            raise HTTPException(status_code=404, detail="content_asset_not_found")
        _asset_query(db, sku_id=row.sku_id, asset_type=row.asset_type).update({"is_primary": False}, synchronize_session=False)
        row.is_primary = True
        row.updated_at = datetime.now(row.created_at.tzinfo) if row.created_at else datetime.now()
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"ok": True, "item": asset_to_dict(row)}

    @app.post("/content/assets/{asset_id}/analyze")
    def post_content_asset_analyze(asset_id: str, db: Session = Depends(get_db_dep)):
        row = db.get(ContentSkuAsset, asset_id)
        if row is None:
            raise HTTPException(status_code=404, detail="content_asset_not_found")
        if row.asset_type not in {"product_image", "detail_page", "reference_media"}:
            raise HTTPException(status_code=400, detail="unsupported_asset_analysis_type")
        try:
            if row.asset_type == "product_image":
                analysis = _analyze_product_image_asset(db, row)
            elif row.asset_type == "detail_page":
                analysis = _analyze_detail_page_asset(db, row)
            else:
                analysis = _analyze_reference_media_asset(db, row)
        except RuntimeError as exc:
            row.analysis_status = "PENDING" if "OPENAI_API_KEY not configured" in str(exc) else "FAILED"
            row.error_message = str(exc)[:800]
            row.updated_at = datetime.now(row.created_at.tzinfo) if row.created_at else datetime.now()
            db.add(row)
            db.commit()
            db.refresh(row)
            return {"ok": False, "item": asset_to_dict(row), "detail": str(exc)}
        row.analysis_status = "ANALYZED"
        row.analysis_json = json.dumps(analysis, ensure_ascii=False)
        row.error_message = None
        row.updated_at = datetime.now(row.created_at.tzinfo) if row.created_at else datetime.now()
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"ok": True, "item": asset_to_dict(row)}

    @app.delete("/content/assets/{asset_id}")
    def delete_content_asset(asset_id: str, db: Session = Depends(get_db_dep)):
        row = db.get(ContentSkuAsset, asset_id)
        if row is None:
            raise HTTPException(status_code=404, detail="content_asset_not_found")
        path = row.file_path
        db.delete(row)
        db.commit()
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
        return {"ok": True, "asset_id": asset_id}

    @app.get("/content/assets/files/{filename}")
    def get_content_asset_file(filename: str):
        path = content_asset_path(filename)
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=404, detail="content_asset_file_not_found")
        return FileResponse(path)
