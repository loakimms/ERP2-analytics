from __future__ import annotations

import base64
import os
import uuid
from typing import Any

import requests
from sqlalchemy.orm import Session

from settings_store import get_api_settings


def _api_setting(db: Session, name: str) -> str:
    value = str(get_api_settings(db, [name]).get(name, "") or "").strip()
    return value or str(os.getenv(name) or "").strip()


def content_image_dir() -> str:
    base = os.getenv("CONTENT_GENERATED_IMAGE_DIR") or "/data/content_generated_images"
    os.makedirs(base, exist_ok=True)
    return base


def _image_ext(mime: str) -> str:
    m = str(mime or "").lower()
    if "jpeg" in m or "jpg" in m:
        return ".jpg"
    if "webp" in m:
        return ".webp"
    return ".png"


def content_image_path(filename: str) -> str:
    safe = os.path.basename(str(filename or "").strip())
    return os.path.join(content_image_dir(), safe)


def content_image_prompt_for_channel(*, channel: str, prompt: str) -> str:
    scene = str(prompt or "").strip()
    if channel == "instagram":
        return (
            "Create a realistic 4:5 portrait ecommerce lifestyle image for a Korean beauty/natural hair-care Instagram carousel. "
            "Use warm premium lighting, clean composition, and enough negative space for later text overlays. "
            "No added typography, no fake labels, no UI, no infographic, no before-after medical claim. "
            f"Scene: {scene}"
        )
    if channel == "shorts":
        return (
            "Create a realistic vertical 9:16 ecommerce video frame for a Korean beauty/natural hair-care short-form scene. "
            "It should look shootable, commercial, and natural. No added typography, no subtitles, no UI, no infographic, no medical claim. "
            f"Scene: {scene}"
        )
    return (
        "Create a realistic editorial ecommerce blog image for a Korean beauty/natural hair-care article. "
        "The image must look like a premium product/lifestyle photo, not a graphic template. "
        "No added text, no fake labels, no UI, no infographic, no medical before-after claim. "
        f"Scene: {scene}"
    )


def content_image_size_for_channel(*, channel: str, requested: str | None = None) -> str | None:
    if requested:
        return requested
    if channel == "instagram":
        return os.getenv("CONTENT_INSTAGRAM_IMAGE_SIZE") or "1024x1536"
    if channel == "shorts":
        return os.getenv("CONTENT_SHORTS_IMAGE_SIZE") or "1024x1792"
    if channel == "blog":
        return os.getenv("CONTENT_BLOG_IMAGE_SIZE") or "1536x1024"
    return None


def _extract_openai_image(body: dict[str, Any]) -> tuple[bytes, str]:
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list) or not data:
        raise RuntimeError("openai_image_error:no_image_data")
    first = data[0] if isinstance(data[0], dict) else {}
    b64 = str(first.get("b64_json") or first.get("b64") or "")
    if b64:
        return base64.b64decode(b64), "image/png"
    url = str(first.get("url") or "")
    if url:
        resp = requests.get(url, timeout=45)
        if int(resp.status_code) != 200:
            raise RuntimeError(f"openai_image_error:download_failed:{resp.status_code}")
        mime = str(resp.headers.get("content-type") or "image/png").split(";")[0].strip() or "image/png"
        return resp.content, mime
    raise RuntimeError("openai_image_error:no_image_data")


def _download_reference_image(url: str) -> tuple[bytes, str, str]:
    image_url = str(url or "").strip()
    if not image_url.lower().startswith(("http://", "https://")):
        raise RuntimeError("product_reference_image_url_invalid")
    resp = requests.get(
        image_url,
        headers={"User-Agent": "ERP2-Analytics/1.0 (+content-image-reference)"},
        timeout=45,
    )
    if int(resp.status_code) != 200:
        raise RuntimeError(f"product_reference_image_download_failed:{resp.status_code}")
    mime = str(resp.headers.get("content-type") or "image/png").split(";")[0].strip().lower() or "image/png"
    if not mime.startswith("image/"):
        raise RuntimeError(f"product_reference_image_not_image:{mime}")
    ext = _image_ext(mime)
    return resp.content, mime, f"product-reference{ext}"


def _read_reference_image_path(path: str) -> tuple[bytes, str, str]:
    image_path = str(path or "").strip()
    if not image_path or not os.path.exists(image_path):
        raise RuntimeError("product_reference_image_file_missing")
    with open(image_path, "rb") as f:
        data = f.read()
    if not data:
        raise RuntimeError("product_reference_image_file_empty")
    ext = os.path.splitext(image_path)[1].lower()
    if ext in {".jpg", ".jpeg"}:
        mime = "image/jpeg"
    elif ext == ".webp":
        mime = "image/webp"
    else:
        mime = "image/png"
    return data, mime, f"product-reference{ext or _image_ext(mime)}"


def generate_content_image(
    db: Session,
    *,
    prompt: str,
    prefix: str = "content",
    model: str | None = None,
    size: str | None = None,
    reference_image_url: str | None = None,
    reference_image_path: str | None = None,
) -> dict[str, str]:
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    model_name = str(model or os.getenv("CONTENT_IMAGE_MODEL") or os.getenv("GFA_CREATIVE_IMAGE_MODEL") or "gpt-image-2").strip()
    image_size = str(size or os.getenv("CONTENT_IMAGE_SIZE") or os.getenv("GFA_CREATIVE_IMAGE_SIZE") or "1024x1024").strip()
    final_prompt = str(prompt or "").strip()
    if not final_prompt:
        raise RuntimeError("content_image_prompt_required")

    reference_url = str(reference_image_url or "").strip()
    reference_path = str(reference_image_path or "").strip()
    if reference_path or reference_url:
        if reference_path:
            ref_bytes, ref_mime, ref_name = _read_reference_image_path(reference_path)
        else:
            ref_bytes, ref_mime, ref_name = _download_reference_image(reference_url)
        resp = requests.post(
            "https://api.openai.com/v1/images/edits",
            headers={"Authorization": f"Bearer {key}"},
            data={"model": model_name, "prompt": final_prompt, "size": image_size, "n": "1"},
            files={"image": (ref_name, ref_bytes, ref_mime)},
            timeout=180,
        )
    else:
        resp = requests.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model_name, "prompt": final_prompt, "size": image_size, "n": 1},
            timeout=180,
        )
    if int(resp.status_code) != 200:
        text = str(getattr(resp, "text", "") or "")[:1200]
        raise RuntimeError(f"openai_image_error:{resp.status_code}:{text}")
    img_bytes, mime = _extract_openai_image(resp.json() or {})
    filename = f"{prefix}_{uuid.uuid4().hex}{_image_ext(mime)}"
    path = content_image_path(filename)
    with open(path, "wb") as f:
        f.write(img_bytes)
    return {
        "filename": filename,
        "image_url": f"/content/images/{filename}",
        "mime_type": mime,
        "prompt": final_prompt,
        "model": f"openai:{model_name}",
        "reference_image_url": reference_url,
        "reference_image_path": reference_path,
    }
