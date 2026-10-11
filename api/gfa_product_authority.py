from __future__ import annotations

import hashlib
import os
import re
from collections import deque
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Callable

PRODUCT_AUTHORITY_VERSION = "GFA_PRODUCT_AUTHORITY_V1"
PRODUCT_AUTHORITY_AVAILABLE = "AVAILABLE"
PRODUCT_AUTHORITY_UNAVAILABLE = "UNAVAILABLE"
PRODUCT_AUTHORITY_UNAVAILABLE_CODE = "PRODUCT_AUTHORITY_UNAVAILABLE"
SOURCE_CONTENT_CENTER = "content_center_product_image"
SOURCE_TRACKED = "tracked_product_image"
SOURCE_PERSISTED = "persisted_artifact"
RESOLVE_ON_EDIT = "RESOLVE_ON_EDIT"
RESOLVE_GENERATION = "GENERATION"
RESOLVE_PERSISTED = "PERSISTED_ARTIFACT"
INTENT_SCALE_UP = "PRODUCT_SCALE_UP"
INTENT_SCALE_DOWN = "PRODUCT_SCALE_DOWN"
INTENT_MOVE = "PRODUCT_MOVE"
ROUTE_MARKED_PRODUCT_ASSET_EDIT = "MARKED_PRODUCT_ASSET_EDIT"
JOKUM_DEFAULT_SCALE = 1.22
BOTTOM_GROUND_CONTACT = "BOTTOM_GROUND_CONTACT"
USER_MARK = "TARGET_OBJECT_HINT"
OBJECT_WORKSPACE = "OBJECT_WORKSPACE"
DEFAULT_MOVE_RATIO = 0.08
SCENE_REPAIR_PROMPT = (
    "Remove the existing product packages inside the transparent mask. "
    "Restore the table surface and background as if those packages were never there. "
    "Do not generate a new product, pouch, bottle, box, label, or package. "
    "Do not change the person, hair, face, or unmasked pixels."
)

_PRODUCT_TERMS = ["제품", "상품", "패키지", "파우치", "pack", "package", "pouch", "product"]
_SCALE_UP_TERMS = ["크게", "키워", "확대", "사이즈가 너무 작", "크기를 키", "bigger", "larger", "scale up"]
_SCALE_DOWN_TERMS = ["작게", "줄여", "축소", "smaller", "scale down"]
_MOVE_TERMS = ["이동", "옮겨", "오른쪽으로", "왼쪽으로", "위로", "아래로", "올려", "move"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data or b"").hexdigest()


def _text(value: Any) -> str:
    return str(value or "").strip()


def inspect_image_bytes(data: bytes) -> dict:
    from PIL import Image

    if not data:
        raise RuntimeError("product_authority_image_empty")
    with Image.open(BytesIO(data)) as opened:
        width, height = opened.size
        mode = str(opened.mode or "")
        fmt = str(opened.format or "").lower()
    mime = "image/png"
    if fmt in {"jpeg", "jpg"}:
        mime = "image/jpeg"
    elif fmt == "webp":
        mime = "image/webp"
    elif fmt == "png":
        mime = "image/png"
    return {"width": int(width), "height": int(height), "mode": mode, "mime": mime, "format": fmt}


def public_authority_record(record: dict | None) -> dict:
    row = dict(record or {})
    row.pop("bytes", None)
    row["version"] = PRODUCT_AUTHORITY_VERSION
    row["productLockedLayerIsNotAuthority"] = True
    return row


def sku_id_from_generation_payloads(*, explanation: dict | None = None, brief: dict | None = None, snapshot: dict | None = None) -> str:
    explanation = explanation if isinstance(explanation, dict) else {}
    brief = brief if isinstance(brief, dict) else {}
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    authority = explanation.get("productAuthority") if isinstance(explanation.get("productAuthority"), dict) else {}
    analysis = snapshot.get("analysis") if isinstance(snapshot.get("analysis"), dict) else {}
    content_context = (
        analysis.get("content_context_v1")
        if isinstance(analysis.get("content_context_v1"), dict)
        else brief.get("content_context_v1")
        if isinstance(brief.get("content_context_v1"), dict)
        else {}
    )
    product_context = (
        brief.get("product_context")
        if isinstance(brief.get("product_context"), dict)
        else snapshot.get("product_context")
        if isinstance(snapshot.get("product_context"), dict)
        else {}
    )
    for candidate in (
        authority.get("skuId"),
        content_context.get("sku_id"),
        product_context.get("product_id"),
        snapshot.get("sku_id"),
        brief.get("sku_id"),
    ):
        sku = _text(candidate)
        if sku:
            return sku
    return ""


def parse_marked_product_intent(prompt: str) -> dict:
    raw = str(prompt or "")
    text = raw.lower()
    product = any(token in raw or token in text for token in _PRODUCT_TERMS)
    move = any(token in raw or token in text for token in _MOVE_TERMS)
    scale_down = any(token in raw or token in text for token in _SCALE_DOWN_TERMS)
    scale_up = any(token in raw or token in text for token in _SCALE_UP_TERMS)
    percent_match = re.search(r"(\d+(?:\.\d+)?)\s*%", raw)
    jokum = "조금" in raw or "jogeum" in text
    factor = JOKUM_DEFAULT_SCALE
    if percent_match:
        pct = float(percent_match.group(1))
        factor = pct / 100.0 if pct > 100 else 1.0 + (pct / 100.0)
    op = None
    move_dx_ratio = 0.0
    move_dy_ratio = 0.0
    if product and move:
        op = INTENT_MOVE
        if "오른쪽" in raw or "right" in text:
            move_dx_ratio = DEFAULT_MOVE_RATIO
        elif "왼쪽" in raw or "left" in text:
            move_dx_ratio = -DEFAULT_MOVE_RATIO
        if "위로" in raw or "올려" in raw or "up" in text:
            move_dy_ratio = -DEFAULT_MOVE_RATIO
        elif "아래로" in raw or "down" in text:
            move_dy_ratio = DEFAULT_MOVE_RATIO
        if move_dx_ratio == 0.0 and move_dy_ratio == 0.0:
            move_dx_ratio = DEFAULT_MOVE_RATIO
    elif product and scale_down:
        op = INTENT_SCALE_DOWN
    elif product and scale_up:
        op = INTENT_SCALE_UP
    matched = bool(product and op)
    if op in {INTENT_SCALE_UP, INTENT_SCALE_DOWN} and not percent_match:
        factor = JOKUM_DEFAULT_SCALE
    return {
        "matched": matched,
        "op": op,
        "factor": round(float(factor), 6) if op else None,
        "jokumDefault": bool(jokum and not percent_match and op in {INTENT_SCALE_UP, INTENT_SCALE_DOWN}),
        "contact": BOTTOM_GROUND_CONTACT,
        "moveDxRatio": round(move_dx_ratio, 6),
        "moveDyRatio": round(move_dy_ratio, 6),
        "route": ROUTE_MARKED_PRODUCT_ASSET_EDIT if matched else None,
        "userMark": USER_MARK,
        "productInstanceCount": 1,
    }


def l_mask_from_bbox(bbox: dict, canvas: tuple[int, int]) -> bytes:
    from PIL import Image

    width, height = canvas
    image = Image.new("L", (width, height), 0)
    x_min = max(0, int(bbox["xMin"]))
    y_min = max(0, int(bbox["yMin"]))
    x_max = min(width - 1, int(bbox["xMax"]))
    y_max = min(height - 1, int(bbox["yMax"]))
    if x_max < x_min or y_max < y_min:
        raise RuntimeError("product_authority_bbox_empty")
    pixels = image.load()
    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            pixels[x, y] = 255
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _bbox_from_mask(image) -> dict | None:
    width, height = image.size
    pixels = image.load()
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y] > 0:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return {
        "x": x_min,
        "y": y_min,
        "w": x_max - x_min + 1,
        "h": y_max - y_min + 1,
        "xMin": x_min,
        "yMin": y_min,
        "xMax": x_max,
        "yMax": y_max,
    }


def object_workspace_from_user_mark(mask_bytes: bytes, *, target_size: tuple[int, int], close_px: int = 15) -> dict:
    from PIL import Image
    from PIL import ImageFilter

    if not mask_bytes:
        raise RuntimeError("image_edit_mask_missing")
    mask = Image.open(BytesIO(mask_bytes)).convert("RGBA")
    if mask.size != target_size:
        mask = mask.resize(target_size, Image.Resampling.NEAREST)
    width, height = mask.size
    painted = Image.new("L", (width, height), 0)
    src = mask.load()
    dst = painted.load()
    painted_pixels = 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = src[x, y]
            if a > 10 and (r > 10 or g > 10 or b > 10):
                dst[x, y] = 255
                painted_pixels += 1
    if painted_pixels <= 0:
        raise RuntimeError("image_edit_mask_empty")
    closed = painted.filter(ImageFilter.MaxFilter(max(3, int(close_px) | 1))).point(lambda value: 255 if value > 0 else 0)
    binary = closed.load()
    reachable = [[False] * width for _ in range(height)]
    queue: deque[tuple[int, int]] = deque()

    def try_seed(x: int, y: int) -> None:
        if binary[x, y] == 0 and not reachable[y][x]:
            reachable[y][x] = True
            queue.append((x, y))

    for x in range(width):
        try_seed(x, 0)
        try_seed(x, height - 1)
    for y in range(height):
        try_seed(0, y)
        try_seed(width - 1, y)
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not reachable[ny][nx] and binary[nx, ny] == 0:
                reachable[ny][nx] = True
                queue.append((nx, ny))
    workspace = Image.new("L", (width, height), 0)
    out = workspace.load()
    enclosed_pixels = 0
    workspace_pixels = 0
    for y in range(height):
        for x in range(width):
            stroke = binary[x, y] > 0
            hole = (not reachable[y][x]) and not stroke
            if stroke or hole:
                out[x, y] = 255
                workspace_pixels += 1
                if hole:
                    enclosed_pixels += 1
    bbox = _bbox_from_mask(workspace)
    if bbox is None:
        raise RuntimeError("object_workspace_empty")
    canvas_pixels = max(1, width * height)
    buf = BytesIO()
    workspace.save(buf, format="PNG")
    return {
        "maskPng": buf.getvalue(),
        "bbox": bbox,
        "paintedPixels": painted_pixels,
        "enclosedPixels": enclosed_pixels,
        "workspacePixels": workspace_pixels,
        "workspaceRatio": round(workspace_pixels / float(canvas_pixels), 6),
        "closedRing": enclosed_pixels > 0,
        "fillsWholeCanvas": workspace_pixels >= canvas_pixels,
        "userMark": USER_MARK,
        "workspaceRole": OBJECT_WORKSPACE,
        "productInstanceCount": 1,
    }


def placement_bbox_from_workspace(
    bbox: dict,
    *,
    op: str,
    factor: float,
    canvas: tuple[int, int],
    move_dx_ratio: float = 0.0,
    move_dy_ratio: float = 0.0,
    contact: str = BOTTOM_GROUND_CONTACT,
) -> dict:
    canvas_w, canvas_h = canvas
    src_w = max(1, int(bbox["w"]))
    src_h = max(1, int(bbox["h"]))
    center_x = float(bbox["xMin"] + bbox["xMax"] + 1) / 2.0
    if op == INTENT_MOVE:
        dx = int(round(float(move_dx_ratio) * canvas_w))
        dy = int(round(float(move_dy_ratio) * canvas_h))
        new_w, new_h = src_w, src_h
        x_min = int(bbox["xMin"]) + dx
        y_min = int(bbox["yMin"]) + dy
        y_max = y_min + new_h - 1
    else:
        scale = float(factor) if op == INTENT_SCALE_UP else (1.0 / float(factor) if float(factor) >= 1.0 else float(factor))
        new_w = max(1, min(canvas_w, int(round(src_w * scale))))
        new_h = max(1, min(canvas_h, int(round(src_h * scale))))
        x_min = int(round(center_x - (new_w / 2.0)))
        if contact == BOTTOM_GROUND_CONTACT:
            y_max = int(bbox["yMax"])
            y_min = y_max - new_h + 1
        else:
            y_min = int(bbox["yMin"])
            y_max = y_min + new_h - 1
    x_min = max(0, min(x_min, canvas_w - new_w))
    x_max = x_min + new_w - 1
    if contact == BOTTOM_GROUND_CONTACT and op != INTENT_MOVE:
        y_max = min(int(bbox["yMax"]), canvas_h - 1)
        y_min = y_max - new_h + 1
        if y_min < 0:
            y_min = 0
            new_h = y_max - y_min + 1
            y_max = y_min + new_h - 1
    else:
        y_min = max(0, min(y_min, canvas_h - new_h))
        y_max = y_min + new_h - 1
    return {
        "x": x_min,
        "y": y_min,
        "w": x_max - x_min + 1,
        "h": y_max - y_min + 1,
        "xMin": x_min,
        "yMin": y_min,
        "xMax": x_max,
        "yMax": y_max,
        "op": op,
        "factor": round(float(factor), 6),
        "contact": contact,
        "productInstanceCount": 1,
        "bottomGroundContact": contact == BOTTOM_GROUND_CONTACT and int(y_max) == min(int(bbox["yMax"]), canvas_h - 1) if op != INTENT_MOVE else False,
    }


def fetch_image_url(url: str, *, timeout: int = 20, max_bytes: int = 6_000_000) -> dict | None:
    import requests

    raw_url = _text(url)
    if not raw_url.startswith("http://") and not raw_url.startswith("https://"):
        return None
    try:
        resp = requests.get(raw_url, timeout=timeout, stream=True)
        if int(resp.status_code) != 200:
            return None
        mime = str(resp.headers.get("content-type") or "image/jpeg").split(";")[0].strip() or "image/jpeg"
        if not mime.startswith("image/"):
            return None
        chunks: list[bytes] = []
        total = 0
        for chunk in resp.iter_content(chunk_size=65536):
            if not chunk:
                continue
            chunks.append(chunk)
            total += len(chunk)
            if total > max_bytes:
                return None
        data = b"".join(chunks)
        if not data:
            return None
        info = inspect_image_bytes(data)
        return {
            "bytes": data,
            "mime": info["mime"] if mime == "image/jpeg" else mime,
            "url": raw_url,
            "width": info["width"],
            "height": info["height"],
            "sha256": _sha256_bytes(data),
            "size": len(data),
        }
    except Exception:
        return None


def _unavailable(sku: str, reason: str, *, resolve_mode: str = RESOLVE_ON_EDIT) -> dict:
    return public_authority_record(
        {
            "status": PRODUCT_AUTHORITY_UNAVAILABLE,
            "reason": reason,
            "skuId": _text(sku),
            "resolveMode": resolve_mode,
            "resolvedAt": _now_iso(),
            "code": PRODUCT_AUTHORITY_UNAVAILABLE_CODE,
        }
    )


def _available(*, sku: str, source_type: str, data: bytes, mime: str, url: str = "", path: str = "", resolve_mode: str, extra: dict | None = None) -> dict:
    info = inspect_image_bytes(data)
    record = {
        "status": PRODUCT_AUTHORITY_AVAILABLE,
        "sourceType": source_type,
        "skuId": _text(sku),
        "sourceUrl": _text(url),
        "sourcePath": _text(path),
        "sourceWidth": info["width"],
        "sourceHeight": info["height"],
        "sourceMime": mime or info["mime"],
        "sourceSha256": _sha256_bytes(data),
        "sourceSize": len(data),
        "resolveMode": resolve_mode,
        "resolvedAt": _now_iso(),
        "bytes": data,
        "productInstanceCount": 1,
    }
    if extra:
        record.update(extra)
    return record


def _read_file(path: str) -> bytes:
    with open(path, "rb") as handle:
        return handle.read()


def _lookup_tracked_product_meta(db, sku: str):
    from db import A1SkuMap, TrackedProductMeta

    sku = _text(sku)
    if not sku:
        return None
    row = None
    if sku.isdigit():
        try:
            row = (
                db.query(TrackedProductMeta)
                .filter(TrackedProductMeta.product_id_catalog == int(sku))
                .order_by(TrackedProductMeta.updated_at.desc(), TrackedProductMeta.id.desc())
                .limit(1)
                .one_or_none()
            )
        except Exception:
            row = None
    if row is None:
        try:
            row = (
                db.query(TrackedProductMeta)
                .filter(TrackedProductMeta.product_url.like(f"%/products/{sku}%"))
                .order_by(TrackedProductMeta.updated_at.desc(), TrackedProductMeta.id.desc())
                .limit(1)
                .one_or_none()
            )
        except Exception:
            row = None
    if row is None:
        try:
            mapped = db.query(A1SkuMap).filter(A1SkuMap.sku_id == sku).one_or_none()
            product_url = _text(getattr(mapped, "product_url", "") if mapped is not None else "")
            if product_url:
                row = (
                    db.query(TrackedProductMeta)
                    .filter(TrackedProductMeta.product_url == product_url)
                    .order_by(TrackedProductMeta.updated_at.desc(), TrackedProductMeta.id.desc())
                    .limit(1)
                    .one_or_none()
                )
        except Exception:
            row = None
    return row


def resolve_product_authority(
    db,
    sku: str,
    *,
    persisted: dict | None = None,
    fetch_url: Callable[[str], dict | None] | None = None,
    path_exists: Callable[[str], bool] = os.path.exists,
    read_file: Callable[[str], bytes] = _read_file,
    resolve_mode: str = RESOLVE_GENERATION,
) -> dict:
    sku = _text(sku)
    persisted = persisted if isinstance(persisted, dict) else {}
    fetcher = fetch_url or fetch_image_url
    persisted_path = _text(persisted.get("sourcePath"))
    if _text(persisted.get("status")) == PRODUCT_AUTHORITY_AVAILABLE and persisted_path and path_exists(persisted_path):
        try:
            data = read_file(persisted_path)
            if data:
                record = _available(
                    sku=sku or _text(persisted.get("skuId")),
                    source_type=SOURCE_PERSISTED,
                    data=data,
                    mime=_text(persisted.get("sourceMime")) or "image/png",
                    url=_text(persisted.get("sourceUrl")),
                    path=persisted_path,
                    resolve_mode=RESOLVE_PERSISTED,
                    extra={
                        "originalSourceType": _text(persisted.get("sourceType") or persisted.get("originalSourceType")),
                        "foregroundPath": _text(persisted.get("foregroundPath")),
                    },
                )
                return record
        except Exception:
            pass
    if sku:
        try:
            from content_center_assets import primary_product_asset_reference

            asset = primary_product_asset_reference(db, sku)
        except Exception:
            asset = {}
        asset = asset if isinstance(asset, dict) else {}
        asset_path = _text(asset.get("product_image_path"))
        if asset_path and path_exists(asset_path):
            try:
                data = read_file(asset_path)
            except Exception:
                data = b""
            if data:
                return _available(
                    sku=sku,
                    source_type=SOURCE_CONTENT_CENTER,
                    data=data,
                    mime="image/png",
                    url=_text(asset.get("product_image_url") or asset.get("product_url")),
                    path=asset_path,
                    resolve_mode=resolve_mode,
                    extra={"assetId": _text(asset.get("asset_id")), "productTitle": _text(asset.get("product_title"))},
                )
        meta = _lookup_tracked_product_meta(db, sku)
        image_url = _text(getattr(meta, "image_url", "") if meta is not None else "")
        if image_url:
            fetched = fetcher(image_url)
            if fetched and fetched.get("bytes"):
                return _available(
                    sku=sku,
                    source_type=SOURCE_TRACKED,
                    data=fetched["bytes"],
                    mime=_text(fetched.get("mime")) or "image/jpeg",
                    url=image_url,
                    resolve_mode=resolve_mode,
                    extra={
                        "productTitle": _text(getattr(meta, "title", "")),
                        "productUrl": _text(getattr(meta, "product_url", "")),
                        "trackedProductMetaId": getattr(meta, "id", None),
                    },
                )
            return _unavailable(sku, "tracked_product_image_fetch_failed", resolve_mode=RESOLVE_ON_EDIT)
    if not sku:
        return _unavailable(sku, "sku_id_missing", resolve_mode=RESOLVE_ON_EDIT)
    return _unavailable(sku, "product_authority_sources_missing", resolve_mode=RESOLVE_ON_EDIT)
