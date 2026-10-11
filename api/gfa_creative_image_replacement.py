"""GFA Creative Editor image replacement (ACTIVE_DEFAULT).

Independent of legacy mask/native/product edit. OpenAI image calls: 0.
Uploaded bytes are FINAL_REPLACEMENT_IMAGE (new IMAGE BASE). Copy overlay is
applied only via the injected shared primitive from the caller.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime
from io import BytesIO
from typing import Any, Callable
from zoneinfo import ZoneInfo

REPLACEMENT_VERSION = "GFA_CREATIVE_IMAGE_REPLACEMENT_V1"
MAX_REPLACEMENT_BYTES = 12_000_000
ALLOWED_MIME_PREFIX = "image/"
STAGED_PREFIX = "gfa_replacement_staged_"
PREVIEW_PREFIX = "gfa_replacement_preview_"
APPLIED_BASE_PREFIX = "gfa_replacement_base_"
APPLIED_FINAL_PREFIX = "gfa_replacement_final_"
SOURCE_ORIGINAL = "ORIGINAL"
SOURCE_USER_UPLOADED_REPLACEMENT = "USER_UPLOADED_REPLACEMENT"

ComposeCopyOverlay = Callable[[bytes, dict, dict | None], tuple[bytes, str]]


class GfaCreativeImageReplacementError(Exception):
    def __init__(self, code: str, *, status_code: int = 400, detail: str | None = None):
        super().__init__(detail or code)
        self.code = str(code or "image_replacement_error")
        self.status_code = int(status_code)
        self.detail = str(detail or code)


def _now_iso() -> str:
    return datetime.now(ZoneInfo("Asia/Seoul")).isoformat()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data or b"").hexdigest()


def _loads_obj(raw: str | None) -> dict:
    try:
        obj = json.loads(raw or "{}")
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _ext_for_mime(mime: str) -> str:
    low = str(mime or "").lower()
    if "png" in low:
        return ".png"
    if "jpeg" in low or "jpg" in low:
        return ".jpg"
    if "webp" in low:
        return ".webp"
    return ".png"


def _write_bytes(image_dir: str, data: bytes, mime: str, *, prefix: str) -> str:
    os.makedirs(image_dir, exist_ok=True)
    path = os.path.join(image_dir, f"{prefix}{uuid.uuid4().hex}{_ext_for_mime(mime)}")
    with open(path, "wb") as handle:
        handle.write(data)
    return path


def inspect_replacement_bytes(data: bytes, *, declared_mime: str = "") -> dict:
    if not data:
        raise GfaCreativeImageReplacementError("empty image file", status_code=400)
    if len(data) > MAX_REPLACEMENT_BYTES:
        raise GfaCreativeImageReplacementError("image file too large", status_code=400)
    mime = str(declared_mime or "").strip() or "image/png"
    if not mime.startswith(ALLOWED_MIME_PREFIX):
        raise GfaCreativeImageReplacementError("image file only", status_code=400)
    try:
        from PIL import Image

        with Image.open(BytesIO(data)) as opened:
            opened.load()
            width, height = opened.size
            fmt = str(opened.format or "").upper()
    except Exception as exc:
        raise GfaCreativeImageReplacementError("image_decode_failed", status_code=400, detail=f"image_decode_failed:{exc}") from exc
    if width <= 0 or height <= 0:
        raise GfaCreativeImageReplacementError("image_dimensions_invalid", status_code=400)
    if fmt == "JPEG":
        mime = "image/jpeg"
    elif fmt == "PNG":
        mime = "image/png"
    elif fmt == "WEBP":
        mime = "image/webp"
    return {
        "width": int(width),
        "height": int(height),
        "mime": mime,
        "format": fmt or "PNG",
        "sha256": _sha256_bytes(data),
        "sizeBytes": int(len(data)),
    }


def inspect_image_file(path: str) -> dict:
    if not path or not os.path.exists(path):
        raise GfaCreativeImageReplacementError("current_image_missing", status_code=404)
    with open(path, "rb") as handle:
        data = handle.read()
    inspected = inspect_replacement_bytes(data, declared_mime="image/png")
    inspected["path"] = path
    return inspected


def current_base_path(explanation: dict) -> str:
    payload = explanation if isinstance(explanation, dict) else {}
    layering = payload.get("image_layering") if isinstance(payload.get("image_layering"), dict) else {}
    path = str(payload.get("base_image_path") or layering.get("base_image_path") or "").strip()
    return path


def require_case_a_base(explanation: dict) -> str:
    path = current_base_path(explanation)
    if not path or not os.path.exists(path):
        raise GfaCreativeImageReplacementError(
            "image_replacement_requires_copy_separated_base",
            status_code=409,
            detail="image_replacement_requires_copy_separated_base",
        )
    return path


def validate_same_canvas(uploaded: dict, current: dict) -> None:
    if int(uploaded.get("width") or 0) != int(current.get("width") or 0) or int(uploaded.get("height") or 0) != int(current.get("height") or 0):
        raise GfaCreativeImageReplacementError(
            "DIMENSION_MISMATCH",
            status_code=400,
            detail=(
                "DIMENSION_MISMATCH:"
                f"{int(uploaded.get('width') or 0)}x{int(uploaded.get('height') or 0)}"
                f"!={int(current.get('width') or 0)}x{int(current.get('height') or 0)}"
            ),
        )


def _record(*, version_id: str, source_type: str, path: str, inspected: dict, uploaded_at: str = "", applied_at: str = "", previous_version_id: str = "") -> dict:
    return {
        "imageVersionId": version_id,
        "sourceType": source_type,
        "artifactPath": path,
        "sha256": str(inspected.get("sha256") or ""),
        "width": int(inspected.get("width") or 0),
        "height": int(inspected.get("height") or 0),
        "mime": str(inspected.get("mime") or "image/png"),
        "uploadedAt": uploaded_at or "",
        "appliedAt": applied_at or "",
        "previousVersionId": previous_version_id or "",
    }


def replacement_state(explanation: dict) -> dict:
    payload = explanation if isinstance(explanation, dict) else {}
    state = payload.get("imageReplacement") if isinstance(payload.get("imageReplacement"), dict) else {}
    if str(state.get("version") or "") != REPLACEMENT_VERSION:
        return {
            "version": REPLACEMENT_VERSION,
            "current": None,
            "staged": None,
            "previousVersionId": "",
            "lineage": [],
        }
    lineage = state.get("lineage") if isinstance(state.get("lineage"), list) else []
    return {
        "version": REPLACEMENT_VERSION,
        "current": state.get("current") if isinstance(state.get("current"), dict) else None,
        "staged": state.get("staged") if isinstance(state.get("staged"), dict) else None,
        "previousVersionId": str(state.get("previousVersionId") or ""),
        "lineage": [item for item in lineage if isinstance(item, dict)],
    }


def _ensure_original_current(state: dict, *, base_path: str) -> dict:
    if isinstance(state.get("current"), dict) and str(state["current"].get("imageVersionId") or ""):
        return state
    inspected = inspect_image_file(base_path)
    version_id = uuid.uuid4().hex
    current = _record(version_id=version_id, source_type=SOURCE_ORIGINAL, path=base_path, inspected=inspected, applied_at=_now_iso())
    lineage = list(state.get("lineage") or [])
    if not any(str(item.get("imageVersionId") or "") == version_id for item in lineage):
        lineage = [current, *lineage]
    state["current"] = current
    state["lineage"] = lineage
    return state


def download_current_base(*, explanation: dict, creative_id: str) -> dict:
    path = require_case_a_base(explanation)
    inspected = inspect_image_file(path)
    state = _ensure_original_current(replacement_state(explanation), base_path=path)
    version = str((state.get("current") or {}).get("imageVersionId") or "current")[:12]
    ext = _ext_for_mime(str(inspected.get("mime") or "image/png"))
    safe_id = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in str(creative_id or "creative"))[:40]
    return {
        "path": path,
        "mime": str(inspected.get("mime") or "image/png"),
        "filename": f"gfa_{safe_id}_{version}{ext}",
        "width": inspected["width"],
        "height": inspected["height"],
        "authority": "IMAGE_BASE",
    }


def staged_preview_path(explanation: dict) -> str:
    staged = replacement_state(explanation).get("staged") if isinstance(replacement_state(explanation).get("staged"), dict) else None
    if not staged:
        raise GfaCreativeImageReplacementError("replacement_preview_missing", status_code=404)
    path = str(staged.get("previewPath") or "").strip()
    name = os.path.basename(path)
    if not name.startswith(PREVIEW_PREFIX) or not os.path.exists(path):
        raise GfaCreativeImageReplacementError("replacement_preview_missing", status_code=404)
    return path


def stage_replacement_image(
    *,
    explanation: dict,
    copy_result: dict,
    combination: dict | None,
    current_image_path: str,
    data: bytes,
    declared_mime: str,
    filename: str,
    image_dir: str,
    compose_copy_overlay: ComposeCopyOverlay,
) -> dict:
    previous_image_path = str(current_image_path or "")
    base_path = require_case_a_base(explanation)
    current_inspected = inspect_image_file(base_path)
    uploaded = inspect_replacement_bytes(data, declared_mime=declared_mime)
    validate_same_canvas(uploaded, current_inspected)

    staged_path = _write_bytes(image_dir, data, str(uploaded["mime"]), prefix=STAGED_PREFIX)
    try:
        preview_bytes, preview_mime = compose_copy_overlay(data, copy_result if isinstance(copy_result, dict) else {}, combination)
    except Exception as exc:
        raise GfaCreativeImageReplacementError("replacement_preview_compose_failed", status_code=502, detail=str(exc)[:500]) from exc
    preview_path = _write_bytes(image_dir, preview_bytes, preview_mime or "image/png", prefix=PREVIEW_PREFIX)

    next_explanation = dict(explanation if isinstance(explanation, dict) else {})
    state = _ensure_original_current(replacement_state(next_explanation), base_path=base_path)
    now = _now_iso()
    staged = {
        **_record(
            version_id=uuid.uuid4().hex,
            source_type=SOURCE_USER_UPLOADED_REPLACEMENT,
            path=staged_path,
            inspected=uploaded,
            uploaded_at=now,
            previous_version_id=str((state.get("current") or {}).get("imageVersionId") or ""),
        ),
        "filename": str(filename or ""),
        "previewPath": preview_path,
        "previewMime": preview_mime or "image/png",
        "currentImagePathUnchanged": previous_image_path,
    }
    state["staged"] = staged
    next_explanation["imageReplacement"] = state
    return {
        "explanation": next_explanation,
        "image_path": None,
        "image_mime": None,
        "current_unchanged": True,
        "event_type": "image_replacement_staged",
        "event_note": "수정 이미지 업로드(미리보기, 미적용)",
        "event_payload": {
            "stagedVersionId": staged["imageVersionId"],
            "sha256": uploaded["sha256"],
            "width": uploaded["width"],
            "height": uploaded["height"],
            "previous_image_path": previous_image_path,
        },
    }


def cancel_staged_replacement(*, explanation: dict, current_image_path: str) -> dict:
    next_explanation = dict(explanation if isinstance(explanation, dict) else {})
    state = replacement_state(next_explanation)
    state["staged"] = None
    next_explanation["imageReplacement"] = state
    return {
        "explanation": next_explanation,
        "image_path": None,
        "image_mime": None,
        "current_unchanged": True,
        "event_type": "image_replacement_cancelled",
        "event_note": "수정 이미지 미리보기 취소",
        "event_payload": {"previous_image_path": str(current_image_path or "")},
    }


def apply_replacement_image(
    *,
    explanation: dict,
    copy_result: dict,
    combination: dict | None,
    current_image_path: str,
    image_dir: str,
    compose_copy_overlay: ComposeCopyOverlay,
) -> dict:
    previous_image_path = str(current_image_path or "")
    base_path = require_case_a_base(explanation)
    state = replacement_state(explanation)
    staged = state.get("staged") if isinstance(state.get("staged"), dict) else None
    if not staged:
        raise GfaCreativeImageReplacementError("replacement_staged_missing", status_code=409)
    staged_path = str(staged.get("artifactPath") or "").strip()
    if not staged_path or not os.path.exists(staged_path):
        raise GfaCreativeImageReplacementError("replacement_staged_missing", status_code=409)
    with open(staged_path, "rb") as handle:
        staged_bytes = handle.read()
    inspected = inspect_replacement_bytes(staged_bytes, declared_mime=str(staged.get("mime") or "image/png"))
    validate_same_canvas(inspected, inspect_image_file(base_path))
    try:
        final_bytes, final_mime = compose_copy_overlay(
            staged_bytes,
            copy_result if isinstance(copy_result, dict) else {},
            combination,
        )
    except Exception as exc:
        raise GfaCreativeImageReplacementError("replacement_apply_compose_failed", status_code=502, detail=str(exc)[:500]) from exc

    new_base_path = _write_bytes(image_dir, staged_bytes, str(inspected["mime"]), prefix=APPLIED_BASE_PREFIX)
    new_final_path = _write_bytes(image_dir, final_bytes, final_mime or "image/png", prefix=APPLIED_FINAL_PREFIX)
    now = _now_iso()
    previous_version_id = str((state.get("current") or {}).get("imageVersionId") or "")
    applied = _record(
        version_id=str(staged.get("imageVersionId") or uuid.uuid4().hex),
        source_type=SOURCE_USER_UPLOADED_REPLACEMENT,
        path=new_base_path,
        inspected=inspected,
        uploaded_at=str(staged.get("uploadedAt") or now),
        applied_at=now,
        previous_version_id=previous_version_id,
    )
    lineage = list(state.get("lineage") or [])
    lineage.append(applied)
    next_state = {
        "version": REPLACEMENT_VERSION,
        "current": applied,
        "staged": None,
        "previousVersionId": previous_version_id,
        "lineage": lineage[-50:],
    }
    next_explanation = dict(explanation if isinstance(explanation, dict) else {})
    next_explanation["base_image_path"] = new_base_path
    next_explanation["base_image_mime_type"] = str(inspected["mime"])
    next_explanation["image_layering"] = {
        "mode": "replacement_base_plus_server_text_overlay",
        "base_image_path": new_base_path,
        "final_image_path": new_final_path,
        "image_locked": True,
        "previous_final_image_path": previous_image_path,
    }
    next_explanation["imageReplacement"] = next_state
    return {
        "explanation": next_explanation,
        "image_path": new_final_path,
        "image_mime": final_mime or "image/png",
        "current_unchanged": False,
        "event_type": "image_replacement_applied",
        "event_note": "수정 이미지 교체 적용",
        "event_payload": {
            "imageVersionId": applied["imageVersionId"],
            "sourceType": SOURCE_USER_UPLOADED_REPLACEMENT,
            "sha256": applied["sha256"],
            "width": applied["width"],
            "height": applied["height"],
            "previousVersionId": previous_version_id,
            "previous_image_path": previous_image_path,
            "base_image_path": new_base_path,
            "final_image_path": new_final_path,
        },
    }
