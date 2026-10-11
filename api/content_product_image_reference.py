from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session


PRODUCT_REFERENCE_TOKENS = (
    "제품",
    "상품",
    "패키지",
    "브랜드",
    "상세",
    "구매",
    "사용",
    "사용법",
    "준비",
    "루틴",
    "데모",
    "브러시",
    "장갑",
    "선반",
    "플랫레이",
    "클로즈업",
    "노출",
    "cta",
)

PRODUCT_REFERENCE_PROMPT_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    (r"\bno\s+packaging\s+text\s+emphasis\b", "natural visible package presence"),
    (r"\bno\s+typography\b", "no added overlay typography"),
    (r"\bno\s+text\s+overlay\b", "no added text overlay"),
    (r"\bno\s+labels\b", "no fake labels"),
    (r"텍스트\s*없이", "추가 텍스트 오버레이 없이"),
    (r"라벨\s*없이", "가짜 라벨 없이"),
)


def sku_product_image_reference(db: Session, sku_id: str | None) -> dict[str, str]:
    sku = str(sku_id or "").strip()
    if not sku:
        return {}
    try:
        from content_center_assets import primary_product_asset_reference

        uploaded = primary_product_asset_reference(db, sku)
        if uploaded.get("product_image_url"):
            return uploaded
    except Exception:
        pass
    return {}


def uploaded_product_image_reference(value: str | None, *, source: str = "manual_content_asset_reference") -> dict[str, str]:
    raw = str(value or "").strip()
    if not raw.startswith("/content/assets/files/"):
        return {}
    try:
        from content_center_assets import content_asset_path
        import os
    except Exception:
        return {}
    filename = os.path.basename(raw)
    if not filename:
        return {}
    return {
        "product_image_url": raw,
        "product_image_path": content_asset_path(filename),
        "source": source,
    }


def item_product_image_reference(item: dict[str, Any] | None, *, source: str = "content_item_product_reference") -> dict[str, str]:
    if not isinstance(item, dict):
        return {}
    return uploaded_product_image_reference(
        str(item.get("product_image_reference_url") or item.get("reference_image_url") or ""),
        source=source,
    )


def should_use_product_image_reference(*, channel: str, index: int, total: int, item: dict[str, Any], prompt: str) -> bool:
    stage = str(item.get("stage") or "").strip().lower()
    text = " ".join(
        [
            str(channel or ""),
            str(prompt or ""),
            str(item.get("heading") or ""),
            str(item.get("caption") or ""),
            str(item.get("visual_brief") or ""),
            str(item.get("visual_direction") or ""),
            str(item.get("visual_asset") or ""),
            stage,
        ]
    ).lower()
    if any(token in text for token in PRODUCT_REFERENCE_TOKENS):
        return True
    if channel == "instagram" and index in {1, total}:
        return True
    if channel == "shorts" and (index in {1, total} or stage in {"hook", "demo", "routine", "cta"}):
        return True
    return False


def normalize_prompt_for_product_reference(prompt: str) -> str:
    cleaned = str(prompt or "").strip()
    for pattern, replacement in PRODUCT_REFERENCE_PROMPT_REPLACEMENTS:
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def append_product_reference_instruction(prompt: str, *, product_reference: dict[str, str]) -> str:
    image_url = str(product_reference.get("product_image_url") or "").strip()
    title = str(product_reference.get("product_title") or "").strip()
    if not image_url:
        return prompt
    product_label = f" for {title}" if title else ""
    cleaned_prompt = normalize_prompt_for_product_reference(prompt)
    return (
        f"{cleaned_prompt}\n\n"
        f"A visible SKU product/package from the provided product reference image{product_label} should appear naturally in this scene. "
        "Preserve the recognizable package/product identity from the reference image, including its existing printed package text, logo, label, color, shape, and product-facing side where possible. "
        "Do not replace it with a blank pouch or generic unlabeled container. "
        "Do not add new readable text, fake labels, UI, or infographic elements."
    )
