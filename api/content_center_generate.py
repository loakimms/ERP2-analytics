from __future__ import annotations

import json
import os
from datetime import date
from html import escape
from typing import Any
from urllib.parse import quote

from sqlalchemy.orm import Session

from content_center_channels import is_content_channel
from content_center_time import now_kst
from content_center_engine import _new_id, get_appeal, sanitize_marketing_text
from content_center_scope import list_sku_scope
from content_image_generation import content_image_prompt_for_channel, content_image_size_for_channel, generate_content_image
from content_product_image_reference import append_product_reference_instruction, item_product_image_reference, sku_product_image_reference
from content_shorts import (
    SHORTS_SCENE_VISUAL_CONTRACT,
    build_visual_asset,
    normalize_scene_visual,
    scene_requires_generated_visual,
    scene_visual_asset_state,
    scene_visual_prompt,
)
from content_writer_service import ContentWriterError, build_generation_context, write_channel_content
from db import ContentArtifact, ContentPlanItem, ContentReviewEvent


def _now():
    return now_kst()


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _clean_lines(values: list[Any], limit: int = 5) -> list[str]:
    out: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _evidence_snippets(appeal: dict[str, Any], limit: int = 5) -> list[str]:
    evidence = appeal.get("evidence") if isinstance(appeal.get("evidence"), list) else []
    return _clean_lines([item.get("snippet") for item in evidence if isinstance(item, dict)], limit)


def _recommendation_reasons(appeal: dict[str, Any]) -> list[str]:
    rec = appeal.get("recommendation") if isinstance(appeal.get("recommendation"), dict) else {}
    reasons = rec.get("reasons") if isinstance(rec.get("reasons"), list) else []
    return _clean_lines(reasons, 4)


def _paragraph(*parts: str) -> str:
    text = " ".join(str(part or "").strip() for part in parts if str(part or "").strip())
    return sanitize_marketing_text(None, text) if False else text


def _short_text(value: str, limit: int = 48) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _instagram_post_title(problem: str, appeal_text: str, product: str) -> str:
    source = f"{problem} {appeal_text}"
    if any(token in source for token in ["모발", "두피", "거칠", "푸석"]):
        return "염색 후에도 부드럽게 마무리"
    if "새치" in source:
        return "새치 관리, 더 편하게 이어가기"
    if any(token in source for token in ["혼자", "쉽", "번거"]):
        return "집에서도 부담 없는 관리 루틴"
    if any(token in source for token in ["부모", "가족"]):
        return "가족과 함께 챙기는 관리 시간"
    return _short_text(appeal_text or problem or product or "오늘의 관리 루틴", 28)


def _instagram_svg_image(headline: str, subtitle: str, index: int) -> str:
    palettes = [
        ("#fff7ed", "#fce7f3", "#dbeafe", "#1f2937"),
        ("#ecfdf5", "#fef3c7", "#fee2e2", "#14532d"),
        ("#fdf2f8", "#e0f2fe", "#fef9c3", "#7f1d1d"),
        ("#f8fafc", "#ede9fe", "#dcfce7", "#312e81"),
        ("#fff1f2", "#ffedd5", "#e0f2fe", "#7c2d12"),
    ]
    c1, c2, c3, ink = palettes[(index - 1) % len(palettes)]
    safe_headline = escape(_short_text(headline, 34))
    safe_subtitle = escape(_short_text(subtitle, 56))
    svg = f"""
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="52%" stop-color="{c2}"/>
      <stop offset="100%" stop-color="{c3}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#64748b" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="1080" height="1080" rx="64" fill="url(#bg)"/>
  <circle cx="870" cy="180" r="160" fill="#ffffff" opacity="0.42"/>
  <circle cx="160" cy="880" r="210" fill="#ffffff" opacity="0.30"/>
  <path d="M725 635c92-88 199-68 235 38-96 12-183 5-235-38Z" fill="#86efac" opacity="0.55"/>
  <path d="M780 720c68-66 148-50 176 28-72 9-138 4-176-28Z" fill="#22c55e" opacity="0.38"/>
  <rect x="86" y="96" width="908" height="888" rx="54" fill="#ffffff" opacity="0.34" filter="url(#shadow)"/>
  <text x="108" y="158" fill="{ink}" font-family="Arial, sans-serif" font-size="30" font-weight="700" opacity="0.62">INSTAGRAM POST DRAFT</text>
  <text x="108" y="860" fill="{ink}" font-family="Arial, sans-serif" font-size="48" font-weight="800">{safe_headline}</text>
  <text x="108" y="922" fill="{ink}" font-family="Arial, sans-serif" font-size="30" font-weight="500" opacity="0.78">{safe_subtitle}</text>
</svg>
"""
    return "data:image/svg+xml;charset=UTF-8," + quote(svg)


def _blog_section_svg_image(heading: str, prompt: str, index: int) -> str:
    palettes = [
        ("#f8fafc", "#dcfce7", "#bbf7d0", "#14532d"),
        ("#fff7ed", "#fed7aa", "#fef3c7", "#7c2d12"),
        ("#eff6ff", "#dbeafe", "#ede9fe", "#1e3a8a"),
        ("#fdf2f8", "#fbcfe8", "#e0f2fe", "#831843"),
        ("#f0fdfa", "#ccfbf1", "#ecfccb", "#134e4a"),
    ]
    c1, c2, c3, ink = palettes[(index - 1) % len(palettes)]
    svg = f"""
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="55%" stop-color="{c2}"/>
      <stop offset="100%" stop-color="{c3}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#475569" flood-opacity="0.20"/>
    </filter>
  </defs>
  <rect width="1200" height="675" rx="48" fill="url(#bg)"/>
  <circle cx="1050" cy="110" r="170" fill="#ffffff" opacity="0.38"/>
  <circle cx="130" cy="610" r="230" fill="#ffffff" opacity="0.28"/>
  <path d="M790 415c116-106 260-82 318 50-126 20-247 13-318-50Z" fill="#22c55e" opacity="0.36"/>
  <path d="M850 508c86-74 192-57 232 36-94 14-180 9-232-36Z" fill="#16a34a" opacity="0.30"/>
  <rect x="92" y="88" width="420" height="500" rx="56" fill="#ffffff" opacity="0.58" filter="url(#shadow)"/>
  <rect x="152" y="148" width="300" height="280" rx="150" fill="{c2}" opacity="0.74"/>
  <path d="M208 438c48-74 135-94 222-30 10 8 10 24 0 32-80 66-176 65-222 0Z" fill="#14532d" opacity="0.38"/>
  <path d="M264 206c76 26 126 86 138 166-86 14-164-16-214-84 18-42 44-68 76-82Z" fill="#f59e0b" opacity="0.30"/>
  <path d="M548 186c90 12 156 66 198 162-108 40-212 22-304-54 22-56 58-92 106-108Z" fill="#ffffff" opacity="0.32"/>
  <path d="M580 486c122-88 258-74 350 42-130 58-264 44-350-42Z" fill="#ffffff" opacity="0.28"/>
</svg>
"""
    return "data:image/svg+xml;charset=UTF-8," + quote(svg)


def _auto_generate_images_enabled() -> bool:
    return str(os.getenv("CONTENT_AUTO_GENERATE_IMAGES") or "1").strip().lower() not in {"0", "false", "no", "off"}


def _content_image_items(payload: dict[str, Any], *, channel: str) -> tuple[dict[str, Any], list[Any], str] | None:
    if channel == "blog":
        container = payload.get("blog") if isinstance(payload.get("blog"), dict) else {}
        items = container.get("sections") if isinstance(container.get("sections"), list) else payload.get("sections")
        return (container, items, "blog_section") if isinstance(items, list) else None
    if channel == "instagram":
        items = payload.get("slides") if isinstance(payload.get("slides"), list) else []
        return (payload, items, "instagram_slide") if isinstance(items, list) else None
    if channel == "shorts":
        container = payload.get("shorts") if isinstance(payload.get("shorts"), dict) else payload
        items = container.get("scenes") if isinstance(container.get("scenes"), list) else payload.get("scenes")
        return (container, items, "shorts_scene") if isinstance(items, list) else None
    return None


def _image_prompt_from_item(item: dict[str, Any], *, channel: str, fallback_title: str) -> str:
    layers = item.get("layers") if isinstance(item.get("layers"), list) else []
    layer_text = ""
    for layer in layers:
        if isinstance(layer, dict) and str(layer.get("type") or "") == "headline":
            layer_text = str(layer.get("text") or "").strip()
            break
    return str(
        item.get("image_prompt")
        or item.get("visual_brief")
        or item.get("visual_direction")
        or (item.get("visual_asset") if channel != "shorts" else "")
        or item.get("heading")
        or item.get("caption")
        or layer_text
        or fallback_title
        or ""
    ).strip()


def _canonical_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _image_signature(item: dict[str, Any], *, channel: str) -> str:
    if channel == "blog":
        return "\n".join([_canonical_text(item.get("heading")), _canonical_text(item.get("body"))])
    if channel == "instagram":
        layers = item.get("layers") if isinstance(item.get("layers"), list) else []
        layer_text = " ".join(_canonical_text(layer.get("text")) for layer in layers if isinstance(layer, dict))
        return "\n".join([_canonical_text(item.get("headline")), _canonical_text(item.get("body")), _canonical_text(item.get("proof")), layer_text])
    if channel == "shorts":
        return "\n".join([_canonical_text(item.get("spoken_script") or item.get("voice_over")), _canonical_text(scene_visual_prompt(item)), _canonical_text(item.get("subtitle"))])
    return _canonical_text(item)


def _item_image_value(item: dict[str, Any], *, channel: str) -> str:
    if channel == "shorts":
        state = scene_visual_asset_state(item)
        return str(state["asset"]["url"]) if state["status"] == "VALID" else ""
    return str(item.get("image") or item.get("image_url") or "").strip()


def _copy_image_fields(target: dict[str, Any], source: dict[str, Any], *, channel: str) -> None:
    if channel == "shorts":
        state = scene_visual_asset_state(source)
        if state["status"] != "VALID":
            return
        for key in ["image_prompt", "image_generation_model", "image_generation_prompt", "product_image_reference_url", "product_image_reference_source"]:
            if source.get(key):
                target[key] = source.get(key)
        target["visual_asset"] = state["asset"]
        target["visual_status"] = "REUSED"
        target["image_reused"] = True
        return
    for key in [
        "image",
        "image_url",
        "image_status",
        "generated_image",
        "visual_asset",
        "visual_status",
        "image_generation_model",
        "image_generation_prompt",
        "image_prompt",
        "product_image_reference_url",
        "product_image_reference_source",
    ]:
        if source.get(key):
            target[key] = source.get(key)
    if channel == "shorts" and source.get("generated_image"):
        target["visual_asset"] = source.get("generated_image")
        target["visual_status"] = source.get("visual_status") or "GENERATED"
    elif channel != "shorts" and source.get("image"):
        target["image_status"] = source.get("image_status") or "GENERATED"
    target["image_reused"] = True


def reuse_unchanged_channel_images(payload: dict[str, Any], *, channel: str, previous_artifact: dict[str, Any] | None = None) -> None:
    """Reuse generated images for unchanged sections/slides/scenes before minimum regeneration."""
    if not previous_artifact or not isinstance(previous_artifact.get("body"), dict):
        return
    current_info = _content_image_items(payload, channel=channel)
    previous_info = _content_image_items(previous_artifact.get("body") or {}, channel=channel)
    if current_info is None or previous_info is None:
        return
    container, items, _ = current_info
    _, previous_items, _ = previous_info
    previous_by_signature: dict[str, dict[str, Any]] = {}
    for previous in previous_items:
        if not isinstance(previous, dict) or not _item_image_value(previous, channel=channel):
            continue
        signature = _image_signature(previous, channel=channel)
        if signature:
            previous_by_signature.setdefault(signature, previous)
    reused = 0
    for item in items:
        if not isinstance(item, dict) or _item_image_value(item, channel=channel):
            continue
        previous = previous_by_signature.get(_image_signature(item, channel=channel))
        if not previous:
            continue
        _copy_image_fields(item, previous, channel=channel)
        reused += 1
    if reused:
        _sync_generated_items(payload, channel=channel, container=container, items=items)
    payload["image_reuse_summary"] = {
        "enabled": True,
        "channel": channel,
        "reused": reused,
        "strategy": "reuse_when_content_signature_unchanged",
    }


def _attach_generated_image(item: dict[str, Any], generated: dict[str, str], *, channel: str, prompt: str, product_reference: dict[str, str] | None = None) -> None:
    item["image_prompt"] = prompt
    item["image_generation_model"] = generated["model"]
    item["image_generation_prompt"] = generated["prompt"]
    if generated.get("reference_image_url"):
        item["product_image_reference_url"] = generated["reference_image_url"]
        if product_reference and product_reference.get("source"):
            item["product_image_reference_source"] = product_reference["source"]
    if channel == "shorts":
        item["visual_prompt"] = prompt
        item["visual_asset"] = build_visual_asset(generated["image_url"], source="AI_GENERATED", prompt=prompt, model=generated.get("model") or "", asset_id=f"content_image:{generated.get('filename') or ''}" if generated.get("filename") else "")
        item.pop("generated_image", None)
        item.pop("image_generation_error", None)
        item["visual_status"] = "GENERATED"
    else:
        item["image"] = generated["image_url"]
        item["image_status"] = "GENERATED"


def _mark_image_generation_failure(item: dict[str, Any], *, channel: str, error: str) -> None:
    status = "PENDING" if "OPENAI_API_KEY not configured" in error else "FAILED"
    if channel == "shorts":
        item["visual_status"] = status
    else:
        item["image_status"] = status
    item["image_generation_error"] = error[:500]


def _sync_generated_items(payload: dict[str, Any], *, channel: str, container: dict[str, Any], items: list[Any]) -> None:
    if channel == "blog":
        container["sections"] = items
        payload["blog"] = container
        payload["sections"] = items
    elif channel == "instagram":
        payload["slides"] = items
        image_slots = payload.get("image_slots") if isinstance(payload.get("image_slots"), list) else []
        for idx, item in enumerate(items):
            if idx >= len(image_slots) or not isinstance(image_slots[idx], dict) or not isinstance(item, dict):
                continue
            image_slots[idx]["image_status"] = item.get("image_status")
            image_slots[idx]["image"] = item.get("image")
            image_slots[idx]["visual_brief"] = item.get("visual_brief") or item.get("image_prompt")
        payload["image_slots"] = image_slots
    elif channel == "shorts":
        container["scenes"] = items
        payload["shorts"] = container
        payload["scenes"] = items


def _try_generate_channel_images(db: Session, payload: dict[str, Any], *, artifact_id: str, channel: str, sku_id: str) -> None:
    """Attach real generated images to content image slots when image generation is configured."""
    item_info = _content_image_items(payload, channel=channel)
    if item_info is None:
        return
    container, items, item_label = item_info
    if channel == "shorts":
        _try_generate_shorts_scene_images(db, payload, artifact_id=artifact_id, sku_id=sku_id, container=container, items=items)
        return
    sku_product_reference = sku_product_image_reference(db, sku_id)
    summary = {
        "enabled": _auto_generate_images_enabled(),
        "channel": channel,
        "unit": item_label,
        "attempted": 0,
        "generated": 0,
        "reused": 0,
        "failed": 0,
        "product_reference_available": bool(sku_product_reference.get("product_image_url")),
        "product_reference_source": sku_product_reference.get("source") or "",
        "product_reference_used": 0,
    }
    if not summary["enabled"]:
        payload["image_generation_summary"] = summary
        return
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        if _item_image_value(item, channel=channel):
            summary["reused"] += 1
            continue
        prompt = _image_prompt_from_item(item, channel=channel, fallback_title=str(payload.get("title") or ""))
        if not prompt:
            _mark_image_generation_failure(item, channel=channel, error="image_prompt_missing")
            continue
        summary["attempted"] += 1
        product_reference = item_product_image_reference(item) or sku_product_reference
        if product_reference.get("product_image_url"):
            summary["product_reference_available"] = True
            summary["product_reference_source"] = product_reference.get("source") or summary["product_reference_source"]
        final_prompt = content_image_prompt_for_channel(channel=channel, prompt=prompt)
        if not product_reference.get("product_image_url") and not product_reference.get("product_image_path"):
            _mark_image_generation_failure(item, channel=channel, error="product_image_reference_required")
            summary["failed"] += 1
            continue
        final_prompt = append_product_reference_instruction(final_prompt, product_reference=product_reference)
        summary["product_reference_used"] += 1
        try:
            generated = generate_content_image(
                db,
                prompt=final_prompt,
                prefix=f"content_{channel}_auto_{artifact_id}_{idx}",
                size=content_image_size_for_channel(channel=channel),
                reference_image_url=product_reference.get("product_image_url") or None,
                reference_image_path=product_reference.get("product_image_path") or None,
            )
        except RuntimeError as exc:
            _mark_image_generation_failure(item, channel=channel, error=str(exc))
            summary["failed"] += 1
            continue
        _attach_generated_image(item, generated, channel=channel, prompt=prompt, product_reference=product_reference)
        summary["generated"] += 1
    _sync_generated_items(payload, channel=channel, container=container, items=items)
    payload["image_generation_summary"] = summary


def _try_generate_shorts_scene_images(db: Session, payload: dict[str, Any], *, artifact_id: str, sku_id: str, container: dict[str, Any], items: list[Any]) -> None:
    sku_product_reference = sku_product_image_reference(db, sku_id)
    summary: dict[str, Any] = {
        "enabled": _auto_generate_images_enabled(),
        "channel": "shorts",
        "unit": "shorts_scene",
        "contract": SHORTS_SCENE_VISUAL_CONTRACT,
        "planned": 0,
        "attempted": 0,
        "generated": 0,
        "reused": 0,
        "failed": 0,
        "skipped": 0,
        "invalid": 0,
        "stale": 0,
        "product_reference_available": bool(sku_product_reference.get("product_image_url")),
        "product_reference_source": sku_product_reference.get("source") or "",
        "product_reference_used": 0,
    }
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict) or not scene_requires_generated_visual(item):
            summary["skipped"] += 1
            continue
        summary["planned"] += 1
        state = normalize_scene_visual(item)
        if state["status"] == "VALID":
            summary["reused"] += 1
            continue
        if state["status"] == "INVALID_VISUAL_ASSET":
            summary["invalid"] += 1
            item["visual_asset_error"] = state["reason"]
            item["visual_asset"] = None
        elif state["status"] == "STALE":
            summary["stale"] += 1
            item["visual_asset"] = None
        if not summary["enabled"]:
            item["visual_status"] = "PENDING"
            continue
        prompt = state["prompt"] or str(item.get("caption") or payload.get("title") or "").strip()
        if not prompt:
            _mark_image_generation_failure(item, channel="shorts", error="image_prompt_missing")
            summary["failed"] += 1
            continue
        summary["attempted"] += 1
        product_reference = item_product_image_reference(item) or sku_product_reference
        if product_reference.get("product_image_url"):
            summary["product_reference_available"] = True
            summary["product_reference_source"] = product_reference.get("source") or summary["product_reference_source"]
        if not product_reference.get("product_image_url") and not product_reference.get("product_image_path"):
            _mark_image_generation_failure(item, channel="shorts", error="product_image_reference_required")
            summary["failed"] += 1
            continue
        final_prompt = append_product_reference_instruction(content_image_prompt_for_channel(channel="shorts", prompt=prompt), product_reference=product_reference)
        summary["product_reference_used"] += 1
        try:
            generated = generate_content_image(
                db,
                prompt=final_prompt,
                prefix=f"content_shorts_auto_{artifact_id}_{idx}",
                size=content_image_size_for_channel(channel="shorts"),
                reference_image_url=product_reference.get("product_image_url") or None,
                reference_image_path=product_reference.get("product_image_path") or None,
            )
        except RuntimeError as exc:
            _mark_image_generation_failure(item, channel="shorts", error=str(exc))
            summary["failed"] += 1
            continue
        _attach_generated_image(item, generated, channel="shorts", prompt=prompt, product_reference=product_reference)
        summary["generated"] += 1
    _sync_generated_items(payload, channel="shorts", container=container, items=items)
    payload["image_generation_summary"] = summary


def generate_channel_payload(
    db: Session,
    *,
    appeal: dict[str, Any],
    channel: str,
    sku_title: str,
    regenerate_instruction: str | None = None,
    previous_artifact: dict[str, Any] | None = None,
    shorts_config: dict[str, Any] | None = None,
    source_content: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not is_content_channel(channel):
        raise ValueError("unsupported_content_channel")
    context = build_generation_context(
        db,
        appeal=appeal,
        channel=channel,
        sku_title=sku_title,
        regenerate_instruction=regenerate_instruction,
        previous_artifact=previous_artifact,
        shorts_config=shorts_config,
        source_content=source_content,
    )
    try:
        return write_channel_content(db, context=context)
    except ContentWriterError as exc:
        raise ValueError(f"content_writer_failed:{exc}") from exc


def generate_artifact(
    db: Session,
    *,
    plan: ContentPlanItem | None,
    sku_id: str,
    appeal_id: str,
    channel: str,
    sku_title: str = "",
    topic_id: str | None = None,
    generation_version: str = "v1",
) -> ContentArtifact:
    appeal = get_appeal(db, appeal_id)
    if appeal is None:
        raise ValueError("appeal_not_found")
    payload = generate_channel_payload(db, appeal=appeal, channel=channel, sku_title=sku_title)
    artifact_id = _new_id("CT")
    _try_generate_channel_images(db, payload, artifact_id=artifact_id, channel=channel, sku_id=sku_id)
    payload["generation_version"] = generation_version
    payload["lineage"] = {
        "plan_id": plan.plan_id if plan is not None else None,
        "sku_id": sku_id,
        "appeal_id": appeal_id,
        "insight_id": appeal.get("insight_id"),
        "channel": channel,
    }
    artifact = ContentArtifact(
        artifact_id=artifact_id,
        original_artifact_id=artifact_id,
        revision_no=1,
        revision_reason="system_generate",
        source="ai_original",
        is_published_version=False,
        plan_id=plan.plan_id if plan is not None else None,
        sku_id=sku_id,
        appeal_id=appeal_id,
        topic_id=topic_id or (plan.topic_id if plan is not None else None),
        channel=channel,
        title=str(payload.get("title") or ""),
        body_json=_dumps(payload),
        export_text=str(payload.get("export_text") or ""),
        reviewer_status="pending",
    )
    db.add(artifact)
    db.add(
        ContentReviewEvent(
            event_id=_new_id("CE"),
            artifact_id=artifact.artifact_id,
            event_type="generated",
            payload_json=_dumps({"channel": channel, "appeal_id": appeal_id, "generation_version": generation_version}),
        )
    )
    if plan is not None:
        plan.status = "generated"
    db.commit()
    db.refresh(artifact)
    return artifact


def generate_manual_artifact(
    db: Session,
    *,
    sku_id: str,
    channel: str,
    appeal_title: str,
    additional_context: str = "",
    attachment_contexts: list[dict[str, Any]] | None = None,
    sku_title: str = "",
    actor: str | None = None,
    generation_version: str = "manual_v1",
) -> ContentArtifact:
    sku = str(sku_id or "").strip()
    channel0 = str(channel or "").strip().lower()
    title0 = str(appeal_title or "").strip()
    extra0 = str(additional_context or "").strip()
    if not sku:
        raise ValueError("sku_id_required")
    if not title0:
        raise ValueError("appeal_title_required")
    if not is_content_channel(channel0):
        raise ValueError("unsupported_content_channel")
    artifact_id = _new_id("CT")
    manual_appeal_id = f"manual:{artifact_id}"
    attachments = [item for item in (attachment_contexts or []) if isinstance(item, dict)]
    manual_appeal = _build_manual_appeal(
        appeal_id=manual_appeal_id,
        sku_id=sku,
        channel=channel0,
        title=title0,
        additional_context=extra0,
        attachments=attachments,
        sku_title=sku_title,
    )
    payload = generate_channel_payload(db, appeal=manual_appeal, channel=channel0, sku_title=sku_title)
    _try_generate_channel_images(db, payload, artifact_id=artifact_id, channel=channel0, sku_id=sku)
    payload["generation_version"] = generation_version
    payload["lineage"] = {
        "plan_id": None,
        "sku_id": sku,
        "appeal_id": manual_appeal_id,
        "insight_id": None,
        "channel": channel0,
        "manual": True,
        "manual_appeal": manual_appeal,
        "manual_attachments": attachments,
    }
    artifact = ContentArtifact(
        artifact_id=artifact_id,
        original_artifact_id=artifact_id,
        revision_no=1,
        revision_reason="manual_generate",
        source="ai_original",
        is_published_version=False,
        plan_id=None,
        sku_id=sku,
        appeal_id=manual_appeal_id,
        topic_id=None,
        channel=channel0,
        title=str(payload.get("title") or ""),
        body_json=_dumps(payload),
        export_text=str(payload.get("export_text") or ""),
        reviewer_status="pending",
    )
    db.add(artifact)
    db.add(
        ContentReviewEvent(
            event_id=_new_id("CE"),
            artifact_id=artifact.artifact_id,
            event_type="manual_generated",
            actor=actor,
            payload_json=_dumps({"channel": channel0, "appeal_id": manual_appeal_id, "generation_version": generation_version}),
        )
    )
    db.commit()
    db.refresh(artifact)
    return artifact


def _build_manual_appeal(
    *,
    appeal_id: str,
    sku_id: str,
    channel: str,
    title: str,
    additional_context: str,
    attachments: list[dict[str, Any]],
    sku_title: str,
) -> dict[str, Any]:
    sku = sku_id
    channel0 = channel
    title0 = title
    extra0 = additional_context
    manual_appeal_id = appeal_id
    attachment_lines = []
    for item in attachments:
        name = str(item.get("original_filename") or item.get("filename") or "").strip()
        snippet = str(item.get("snippet") or "").strip()
        if name and snippet:
            attachment_lines.append(f"{name}: {snippet}")
        elif name:
            attachment_lines.append(f"{name}: 업로드된 참고자료")
    combined_context = "\n".join([x for x in [extra0, *attachment_lines] if x]).strip()
    manual_appeal = {
        "appeal_id": manual_appeal_id,
        "sku_id": sku,
        "label": title0,
        "appeal_text": combined_context or title0,
        "target": sku_title or sku,
        "claim_class": "manual",
        "legal_risk": "manual_review_required",
        "safety_gate": "CLEAR",
        "recommendation": {"channels": [channel0], "source": "manual_generation"},
        "usage_types": ["manual_content_generation"],
        "emerging": False,
        "insight": {
            "problem": title0,
            "desire": combined_context,
            "barrier": "",
            "motivation": combined_context or title0,
            "usage_situation": combined_context,
            "customer_language": [combined_context] if combined_context else [],
        },
        "evidence": (
            ([{"source_type": "manual_input", "snippet": extra0[:600]}] if extra0 else [])
            + [
                {
                    "source_type": "manual_attachment",
                    "source_pk": str(item.get("asset_id") or ""),
                    "snippet": str(item.get("snippet") or item.get("original_filename") or item.get("filename") or "")[:900],
                }
                for item in attachments
            ]
        ),
    }
    return manual_appeal


def _artifact_appeal(db: Session, artifact: ContentArtifact) -> dict[str, Any] | None:
    appeal = get_appeal(db, artifact.appeal_id) if artifact.appeal_id else None
    if appeal is not None:
        return appeal
    try:
        body = json.loads(artifact.body_json or "{}")
    except Exception:
        body = {}
    lineage = body.get("lineage") if isinstance(body, dict) and isinstance(body.get("lineage"), dict) else {}
    manual = lineage.get("manual_appeal")
    return manual if isinstance(manual, dict) else None


def generate_shorts_artifact(
    db: Session,
    *,
    source_type: str,
    sku_id: str,
    config: dict[str, Any],
    appeal_id: str | None = None,
    source_artifact_id: str | None = None,
    topic_title: str = "",
    additional_context: str = "",
    attachment_contexts: list[dict[str, Any]] | None = None,
    sku_title: str = "",
    actor: str | None = None,
    generation_version: str = "shorts_generator_v1",
) -> ContentArtifact:
    from content_shorts import resolve_shorts_config
    from content_shorts_audio import bump_music_usage, music_library

    source0 = str(source_type or "").strip().upper()
    sku = str(sku_id or "").strip()
    if not sku:
        raise ValueError("sku_id_required")
    artifact_id = _new_id("CT")
    attachments = [item for item in (attachment_contexts or []) if isinstance(item, dict)]
    source_content: dict[str, Any] | None = None
    manual_appeal: dict[str, Any] | None = None
    if source0 == "APPEAL":
        appeal = get_appeal(db, str(appeal_id or ""))
        if appeal is None:
            raise ValueError("appeal_not_found")
        appeal_key = str(appeal.get("appeal_id") or appeal_id)
    elif source0 == "ARTIFACT":
        source_row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == str(source_artifact_id or "")).one_or_none()
        if source_row is None:
            raise ValueError("source_artifact_not_found")
        source_content = {"channel": source_row.channel, "title": source_row.title, "excerpt": str(source_row.export_text or "")[:3500], "artifact_id": source_row.artifact_id}
        appeal = _artifact_appeal(db, source_row)
        if appeal is None or str(appeal.get("appeal_id") or "").startswith("manual:"):
            appeal_key = f"manual:{artifact_id}"
            manual_appeal = _build_manual_appeal(
                appeal_id=appeal_key,
                sku_id=sku,
                channel="shorts",
                title=str(source_row.title or topic_title or "기존 콘텐츠 숏츠 변환"),
                additional_context="\n".join(x for x in [additional_context, str(source_row.export_text or "")[:1500]] if x),
                attachments=attachments,
                sku_title=sku_title,
            )
            appeal = manual_appeal
        else:
            appeal_key = str(appeal.get("appeal_id"))
    elif source0 == "TOPIC":
        title0 = str(topic_title or "").strip()
        if not title0:
            raise ValueError("topic_title_required")
        appeal_key = f"manual:{artifact_id}"
        manual_appeal = _build_manual_appeal(
            appeal_id=appeal_key,
            sku_id=sku,
            channel="shorts",
            title=title0,
            additional_context=str(additional_context or "").strip(),
            attachments=attachments,
            sku_title=sku_title,
        )
        appeal = manual_appeal
    else:
        raise ValueError("unsupported_shorts_source")
    review_evidence = [e for e in (appeal.get("evidence") or []) if isinstance(e, dict) and "review" in str(e.get("source_type") or "")]
    hint = {
        "title": appeal.get("label") or topic_title,
        "appeal_text": appeal.get("appeal_text"),
        "source_channel": (source_content or {}).get("channel"),
        "source_title": (source_content or {}).get("title"),
        "review_evidence_count": len(review_evidence),
    }
    shorts_config = resolve_shorts_config(config, hint=hint, music_library=music_library(db))
    payload = generate_channel_payload(
        db,
        appeal=appeal,
        channel="shorts",
        sku_title=sku_title,
        shorts_config=shorts_config,
        source_content=source_content,
    )
    _try_generate_channel_images(db, payload, artifact_id=artifact_id, channel="shorts", sku_id=sku)
    payload["generation_version"] = generation_version
    payload["shorts_generation_config"] = shorts_config
    lineage: dict[str, Any] = {
        "plan_id": None,
        "sku_id": sku,
        "appeal_id": appeal_key,
        "insight_id": appeal.get("insight_id"),
        "channel": "shorts",
        "shorts_source": {"type": source0, "artifact_id": (source_content or {}).get("artifact_id"), "appeal_id": appeal_id},
    }
    if manual_appeal is not None:
        lineage.update({"manual": True, "manual_appeal": manual_appeal, "manual_attachments": attachments})
    payload["lineage"] = lineage
    artifact = ContentArtifact(
        artifact_id=artifact_id,
        original_artifact_id=artifact_id,
        revision_no=1,
        revision_reason="shorts_generate",
        source="ai_original",
        is_published_version=False,
        plan_id=None,
        sku_id=sku,
        appeal_id=appeal_key,
        topic_id=None,
        channel="shorts",
        title=str(payload.get("title") or ""),
        body_json=_dumps(payload),
        export_text=str(payload.get("export_text") or ""),
        reviewer_status="pending",
    )
    db.add(artifact)
    db.add(
        ContentReviewEvent(
            event_id=_new_id("CE"),
            artifact_id=artifact.artifact_id,
            event_type="shorts_generated",
            actor=actor,
            payload_json=_dumps({"source": source0, "appeal_id": appeal_key, "config": shorts_config.get("resolved"), "generation_version": generation_version}),
        )
    )
    db.commit()
    db.refresh(artifact)
    bump_music_usage(db, ((shorts_config.get("resolved") or {}).get("music") or {}).get("trackId"))
    return artifact


def find_existing_plan_artifact(db: Session, plan: ContentPlanItem, *, generation_version: str = "v1") -> ContentArtifact | None:
    """Return an existing auto-generated artifact for this plan.

    Plan id is the idempotency key because the plan already binds date, SKU,
    appeal, channel, and topic. Generation version is stored in body_json so
    future generator revisions can explicitly opt into regeneration.
    """
    rows = (
        db.query(ContentArtifact)
        .filter(
            ContentArtifact.plan_id == plan.plan_id,
            ContentArtifact.sku_id == plan.sku_id,
            ContentArtifact.appeal_id == plan.appeal_id,
            ContentArtifact.channel == plan.channel,
        )
        .order_by(ContentArtifact.created_at.asc())
        .all()
    )
    for row in rows:
        try:
            body = json.loads(row.body_json or "{}")
        except Exception:
            body = {}
        if str(body.get("generation_version") or "v1") == generation_version:
            return row
    return None


def get_or_generate_artifact_for_plan(
    db: Session,
    *,
    plan: ContentPlanItem,
    sku_title: str = "",
    generation_version: str = "v1",
) -> tuple[ContentArtifact, bool]:
    existing = find_existing_plan_artifact(db, plan, generation_version=generation_version)
    if existing is not None:
        if plan.status == "queued":
            plan.status = "generated"
            db.commit()
        return existing, False
    artifact = generate_artifact(
        db,
        plan=plan,
        sku_id=plan.sku_id,
        appeal_id=plan.appeal_id,
        channel=plan.channel,
        sku_title=sku_title,
        topic_id=plan.topic_id,
        generation_version=generation_version,
    )
    return artifact, True


def materialize_plan_artifacts(
    db: Session,
    *,
    as_of: date | None = None,
    generation_version: str = "v1",
) -> dict[str, Any]:
    q = db.query(ContentPlanItem)
    if as_of is not None:
        q = q.filter(ContentPlanItem.plan_date == as_of)
    plans = q.order_by(ContentPlanItem.created_at.asc()).all()
    scopes = {row.sku_id: row for row in list_sku_scope(db, phase1_only=False)}
    items: list[dict[str, Any]] = []
    created = 0
    reused = 0
    failed = 0
    for plan in plans:
        scope = scopes.get(plan.sku_id)
        try:
            artifact, was_created = get_or_generate_artifact_for_plan(
                db,
                plan=plan,
                sku_title=str(getattr(scope, "title", "") or ""),
                generation_version=generation_version,
            )
            created += 1 if was_created else 0
            reused += 0 if was_created else 1
            items.append(
                {
                    "plan_id": plan.plan_id,
                    "artifact_id": artifact.artifact_id,
                    "channel": artifact.channel,
                    "reviewer_status": artifact.reviewer_status,
                    "created": was_created,
                    "ok": True,
                }
            )
        except Exception as exc:
            failed += 1
            plan.status = "generation_failed"
            plan.reason = f"{plan.reason or ''} auto_generation_error={type(exc).__name__}:{exc}"[:1000]
            db.commit()
            items.append(
                {
                    "plan_id": plan.plan_id,
                    "channel": plan.channel,
                    "ok": False,
                    "error": str(exc),
                }
            )
    return {
        "ok": failed == 0,
        "attempted": len(plans),
        "created": created,
        "reused": reused,
        "failed": failed,
        "items": items,
    }


def artifact_to_dict(row: ContentArtifact) -> dict[str, Any]:
    try:
        body = json.loads(row.body_json or "{}")
    except Exception:
        body = {}
    return {
        "artifact_id": row.artifact_id,
        "parent_artifact_id": row.parent_artifact_id,
        "original_artifact_id": row.original_artifact_id or row.artifact_id,
        "revision_no": row.revision_no or 1,
        "revision_reason": row.revision_reason,
        "source": row.source,
        "is_published_version": bool(row.is_published_version),
        "plan_id": row.plan_id,
        "sku_id": row.sku_id,
        "appeal_id": row.appeal_id,
        "topic_id": row.topic_id,
        "channel": row.channel,
        "title": row.title,
        "body": body,
        "export_text": row.export_text,
        "gfa_run_id": row.gfa_run_id,
        "reviewer_status": row.reviewer_status,
        "reviewer_note": row.reviewer_note,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def review_artifact(db: Session, artifact_id: str, *, status: str, note: str | None = None, actor: str | None = None) -> ContentArtifact:
    row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
    if row is None:
        raise ValueError("artifact_not_found")
    if status not in {"pending", "draft", "review_pending", "accepted", "published", "hold", "rejected", "revised"}:
        raise ValueError("invalid_review_status")
    row.reviewer_status = status
    row.reviewer_note = note
    row.updated_at = _now()
    db.add(
        ContentReviewEvent(
            event_id=_new_id("CE"),
            artifact_id=row.artifact_id,
            event_type=f"review_{status}",
            actor=actor,
            note=note,
        )
    )
    if row.plan_id:
        plan = db.query(ContentPlanItem).filter(ContentPlanItem.plan_id == row.plan_id).one_or_none()
        if plan is not None:
            plan.status = status
    db.commit()
    db.refresh(row)
    return row
