"""Diagnostic Existing Product object extraction for flattened GFA images.

Offline path only. Not wired to production edit routing.
User ring/brush is OBJECT_IDENTIFICATION_HINT, never PRODUCT_ALPHA.
Filled enclosed region is PRODUCT_SEARCH_ROI, never PRODUCT_ALPHA.
RGB is copied from the source raster. Segmentation writes alpha only.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

GFA_EXISTING_PRODUCT_EXTRACTION_SOURCE_TYPE = "FLATTENED_SOURCE_EXTRACTION"
GFA_EXISTING_PRODUCT_EXTRACTION_VERSION = "GFA_EXISTING_PRODUCT_OBJECT_EXTRACTION_V1"

GC_BGD = int(cv2.GC_BGD)
GC_FGD = int(cv2.GC_FGD)
GC_PR_BGD = int(cv2.GC_PR_BGD)
GC_PR_FGD = int(cv2.GC_PR_FGD)

_RING_CLOSE_KERNEL = 15
_CLEAR_DILATE_PX = 11
_SURROUND_BAND_PX = 21
_NOISE_AREA_PX = 32
_GRABCUT_ITERS = 5
_ALPHA_FEATHER_PX = 0.6


def segmentation_primitive_status() -> dict[str, Any]:
    return {
        "cv2Available": True,
        "cv2Version": str(cv2.__version__),
        "grabCutAvailable": bool(hasattr(cv2, "grabCut")),
        "newDependencyAdded": False,
        "engine": "cv2.grabCut" if hasattr(cv2, "grabCut") else None,
    }


def _to_uint8_mask(mask: np.ndarray) -> np.ndarray:
    if mask.ndim == 3:
        if mask.shape[2] == 4:
            rgb = mask[:, :, :3]
            alpha = mask[:, :, 3]
            painted = (alpha > 10) & (rgb.max(axis=2) > 10)
            return np.where(painted, 255, 0).astype(np.uint8)
        return np.where(mask.max(axis=2) > 10, 255, 0).astype(np.uint8)
    return np.where(mask > 10, 255, 0).astype(np.uint8)


def _load_bgr_rgba(path: str | Path) -> tuple[np.ndarray, np.ndarray]:
    with Image.open(path) as opened:
        rgba = opened.convert("RGBA")
        arr = np.array(rgba)
    bgr = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2BGR)
    return bgr, arr


def _load_mask(path: str | Path, size: tuple[int, int]) -> np.ndarray:
    with Image.open(path) as opened:
        arr = np.array(opened.convert("RGBA"))
    mask = _to_uint8_mask(arr)
    height, width = size[1], size[0]
    if mask.shape[0] != height or mask.shape[1] != width:
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
        mask = np.where(mask > 10, 255, 0).astype(np.uint8)
    return mask


def _close_small_ring_gaps(ring: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (_RING_CLOSE_KERNEL, _RING_CLOSE_KERNEL))
    closed = cv2.morphologyEx(ring, cv2.MORPH_CLOSE, kernel)
    return closed, {
        "method": "bounded_morphological_close",
        "kernelPx": _RING_CLOSE_KERNEL,
        "largeAutomaticExpansion": False,
        "bboxFillUsed": False,
    }


def _enclosed_search_roi(ring: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    inverted = np.where(ring > 0, 0, 255).astype(np.uint8)
    flooded = inverted.copy()
    cv2.floodFill(flooded, None, (0, 0), 128)
    enclosed = np.where(flooded == 255, 255, 0).astype(np.uint8)
    ring_px = int(np.count_nonzero(ring))
    enclosed_px = int(np.count_nonzero(enclosed))
    closed = enclosed_px > max(64, ring_px // 8)
    return enclosed, {
        "role": "PRODUCT_SEARCH_ROI",
        "isProductAlpha": False,
        "closedSelection": closed,
        "ringPixels": ring_px,
        "enclosedPixels": enclosed_px,
        "holdReason": None if closed else "PRODUCT_SELECTION_NOT_CLOSED",
    }


def _grabcut_init_mask(ring: np.ndarray, enclosed: np.ndarray, search_roi: np.ndarray) -> np.ndarray:
    gc_mask = np.full(search_roi.shape, GC_BGD, dtype=np.uint8)
    surround_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (_SURROUND_BAND_PX, _SURROUND_BAND_PX))
    surround = cv2.dilate(search_roi, surround_k)
    gc_mask[surround > 0] = GC_PR_BGD
    gc_mask[enclosed > 0] = GC_PR_FGD
    gc_mask[ring > 0] = GC_PR_BGD
    gc_mask[np.logical_and(surround == 0, search_roi == 0)] = GC_BGD
    return gc_mask


def _keep_product_group(binary: np.ndarray) -> tuple[np.ndarray, list[dict[str, Any]]]:
    num, labels, stats, _centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    kept = np.zeros_like(binary)
    components: list[dict[str, Any]] = []
    for index in range(1, num):
        area = int(stats[index, cv2.CC_STAT_AREA])
        x = int(stats[index, cv2.CC_STAT_LEFT])
        y = int(stats[index, cv2.CC_STAT_TOP])
        w = int(stats[index, cv2.CC_STAT_WIDTH])
        h = int(stats[index, cv2.CC_STAT_HEIGHT])
        if area < _NOISE_AREA_PX:
            continue
        kept[labels == index] = 255
        components.append({"index": index, "area": area, "bbox": {"x": x, "y": y, "w": w, "h": h}})
    components.sort(key=lambda item: item["area"], reverse=True)
    return kept, components


def _alpha_from_object_mask(object_mask: np.ndarray) -> np.ndarray:
    if _ALPHA_FEATHER_PX <= 0:
        return object_mask.copy()
    blurred = cv2.GaussianBlur(object_mask, (0, 0), _ALPHA_FEATHER_PX)
    return blurred


def _pixel_identity(source_rgb: np.ndarray, cutout_rgba: np.ndarray, object_mask: np.ndarray) -> dict[str, Any]:
    selected = object_mask > 10
    total = int(np.count_nonzero(selected))
    if total <= 0:
        return {"sourceProductPixelDiffRatio": None, "comparedPixels": 0, "changedPixels": 0}
    src = source_rgb[selected]
    out = cutout_rgba[:, :, :3][selected]
    changed = int(np.count_nonzero(np.any(src != out, axis=1)))
    return {
        "sourceProductPixelDiffRatio": round(changed / float(total), 8),
        "comparedPixels": total,
        "changedPixels": changed,
    }


def _bbox(mask: np.ndarray) -> dict[str, int] | None:
    ys, xs = np.where(mask > 10)
    if xs.size == 0:
        return None
    return {
        "x0": int(xs.min()),
        "y0": int(ys.min()),
        "x1": int(xs.max()),
        "y1": int(ys.max()),
        "w": int(xs.max() - xs.min() + 1),
        "h": int(ys.max() - ys.min() + 1),
    }


def _guards(roi: np.ndarray, object_mask: np.ndarray, components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    roi_px = int(np.count_nonzero(roi))
    obj_px = int(np.count_nonzero(object_mask))
    ratio = (obj_px / float(roi_px)) if roi_px else 0.0
    contour = cv2.dilate(roi, np.ones((3, 3), np.uint8))
    boundary = np.logical_and(contour > 0, roi == 0)
    boundary_px = int(np.count_nonzero(boundary))
    contact = int(np.count_nonzero(np.logical_and(object_mask > 0, boundary)))
    contact_ratio = (contact / float(boundary_px)) if boundary_px else 0.0
    guards = [
        {"id": "mask_empty", "triggered": obj_px <= 0, "value": obj_px},
        {"id": "mask_nearly_entire_roi", "triggered": ratio >= 0.92, "value": round(ratio, 6)},
        {"id": "foreground_roi_boundary_contact", "triggered": contact_ratio >= 0.45, "value": round(contact_ratio, 6)},
        {"id": "foreground_area_implausible", "triggered": (roi_px > 0 and (ratio <= 0.04 or ratio >= 0.92)), "value": round(ratio, 6)},
        {"id": "product_group_component_count", "triggered": False, "value": len(components)},
    ]
    return guards


def extract_existing_product_from_flattened_source(
    *,
    source_path: str | Path,
    user_selection_path: str | Path,
) -> dict[str, Any]:
    primitive = segmentation_primitive_status()
    if not primitive.get("grabCutAvailable"):
        return {
            "ok": False,
            "decisionHint": "HOLD_PRODUCT_OBJECT_EXTRACTION_PRIMITIVE_UNAVAILABLE",
            "primitive": primitive,
        }

    bgr, rgba = _load_bgr_rgba(source_path)
    height, width = bgr.shape[:2]
    ring_raw = _load_mask(user_selection_path, (width, height))
    ring_closed, ring_close_meta = _close_small_ring_gaps(ring_raw)
    enclosed, enclosed_meta = _enclosed_search_roi(ring_closed)
    search_roi = enclosed
    roi_meta = dict(enclosed_meta)
    roi_meta["searchRoiIncludesHintStroke"] = False
    roi_meta["searchRoiPixels"] = int(np.count_nonzero(search_roi))
    if not enclosed_meta["closedSelection"]:
        return {
            "ok": False,
            "decisionHint": "PRODUCT_SELECTION_NOT_CLOSED",
            "primitive": primitive,
            "selection": {
                "role": "OBJECT_IDENTIFICATION_HINT",
                "genericEditablePixelsUnchanged": True,
            },
            "ringClose": ring_close_meta,
            "searchRoi": roi_meta,
            "images": {
                "sourceBgr": bgr,
                "sourceRgba": rgba,
                "userRing": ring_raw,
                "searchRoi": search_roi,
            },
        }

    gc_mask = _grabcut_init_mask(ring_closed, enclosed, search_roi)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, gc_mask, None, bgd_model, fgd_model, _GRABCUT_ITERS, cv2.GC_INIT_WITH_MASK)
    probable = np.where((gc_mask == GC_FGD) | (gc_mask == GC_PR_FGD), 255, 0).astype(np.uint8)
    probable = cv2.bitwise_and(probable, search_roi)
    object_mask, components = _keep_product_group(probable)
    alpha = _alpha_from_object_mask(object_mask)
    cutout = rgba.copy()
    cutout[:, :, 3] = alpha
    identity = _pixel_identity(rgba[:, :, :3], cutout, object_mask)
    clear_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (_CLEAR_DILATE_PX, _CLEAR_DILATE_PX))
    clear_mask = cv2.dilate(object_mask, clear_k)
    guards = _guards(search_roi, object_mask, components)
    source_rgb = rgba[:, :, :3]
    overlay = source_rgb.copy()
    overlay[object_mask > 10] = (0.45 * overlay[object_mask > 10] + np.array([0, 220, 80])).astype(np.uint8)

    return {
        "ok": True,
        "primitive": primitive,
        "existingProductExtraction": {
            "version": GFA_EXISTING_PRODUCT_EXTRACTION_VERSION,
            "sourceType": GFA_EXISTING_PRODUCT_EXTRACTION_SOURCE_TYPE,
            "productLockedLayerMutated": False,
            "selectionRole": "OBJECT_IDENTIFICATION_HINT",
            "filledRegionRole": "PRODUCT_SEARCH_ROI",
            "filledRegionIsProductAlpha": False,
            "engine": "cv2.grabCut",
            "largestComponentOnly": False,
            "productGroupComponentCount": len(components),
            "components": components,
            "rgbAuthority": "ORIGINAL_SOURCE_PIXELS",
            "alphaAuthority": "GRABCUT_PLUS_OPTIONAL_ALPHA_FEATHER",
            "aiProductRgb": "PROHIBITED",
            "oldProductClearMask": {
                "basis": "productObjectMask",
                "method": "bounded_dilation",
                "dilatePx": _CLEAR_DILATE_PX,
                "userRingUsedAsClear": False,
                "promptGuessedClear": False,
            },
            "backgroundInpaintExecuted": False,
            "transformExecuted": False,
        },
        "selection": {
            "role": "OBJECT_IDENTIFICATION_HINT",
            "genericEditablePixelsUnchanged": True,
        },
        "ringClose": ring_close_meta,
        "searchRoi": roi_meta,
        "identity": identity,
        "objectBBox": _bbox(object_mask),
        "roiBBox": _bbox(search_roi),
        "enclosedBBox": _bbox(enclosed),
        "clearBBox": _bbox(clear_mask),
        "area": {
            "imagePixels": int(width * height),
            "ringPixels": int(np.count_nonzero(ring_raw)),
            "enclosedPixels": int(np.count_nonzero(enclosed)),
            "roiPixels": int(np.count_nonzero(search_roi)),
            "objectPixels": int(np.count_nonzero(object_mask)),
            "clearPixels": int(np.count_nonzero(clear_mask)),
            "objectToRoiRatio": round(int(np.count_nonzero(object_mask)) / float(max(1, np.count_nonzero(search_roi))), 6),
        },
        "grabCutInit": {
            "sureForegroundForced": False,
            "outsideSearchRoi": "GC_BGD",
            "enclosedInterior": "GC_PR_FGD",
            "hintStroke": "GC_PR_BGD",
            "surroundingBand": "GC_PR_BGD",
            "iterations": _GRABCUT_ITERS,
        },
        "guards": guards,
        "images": {
            "sourceBgr": bgr,
            "sourceRgba": rgba,
            "userRing": ring_raw,
            "searchRoi": search_roi,
            "objectMask": object_mask,
            "clearMask": clear_mask,
            "cutoutRgba": cutout,
            "overlayRgb": overlay,
            "grabCutInitMask": gc_mask,
        },
    }


def _save_png(path: Path, image: Image.Image | np.ndarray, *, mode: str | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(image, np.ndarray):
        if image.ndim == 2:
            pil = Image.fromarray(image, mode="L")
        elif image.shape[2] == 4:
            pil = Image.fromarray(image, mode="RGBA")
        else:
            pil = Image.fromarray(image, mode="RGB")
    else:
        pil = image
    if mode:
        pil = pil.convert(mode)
    pil.save(path)


def _checkerboard(size: tuple[int, int], cell: int = 16) -> Image.Image:
    width, height = size
    board = Image.new("RGB", (width, height), (210, 210, 210))
    draw = ImageDraw.Draw(board)
    for y in range(0, height, cell):
        for x in range(0, width, cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(245, 245, 245))
    return board


def save_extraction_case_artifacts(result: dict[str, Any], out_dir: str | Path) -> dict[str, str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    images = result.get("images") or {}
    source_rgba = images["sourceRgba"]
    source_rgb = source_rgba[:, :, :3]
    ring = images["userRing"]
    roi = images["searchRoi"]
    paths = {
        "source.png": source_rgb,
        "user-selection-mask.png": ring,
    }
    _save_png(out / "source.png", source_rgb)
    _save_png(out / "user-selection-mask.png", ring)
    _save_png(out / "selection-roi.png", roi)
    if not result.get("ok"):
        summary = {k: v for k, v in result.items() if k != "images"}
        (out / "debug-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"debug-summary.json": str(out / "debug-summary.json")}

    object_mask = images["objectMask"]
    clear_mask = images["clearMask"]
    cutout = images["cutoutRgba"]
    overlay = images["overlayRgb"]
    board = _checkerboard((source_rgb.shape[1], source_rgb.shape[0]))
    cutout_vis = Image.alpha_composite(board.convert("RGBA"), Image.fromarray(cutout, mode="RGBA")).convert("RGB")
    _save_png(out / "product-object-mask.png", object_mask)
    _save_png(out / "old-product-clear-mask.png", clear_mask)
    _save_png(out / "product-cutout.png", np.array(cutout_vis))
    _save_png(out / "product-mask-overlay.png", overlay)
    cutout_rgba_path = out / "product-cutout-rgba.png"
    _save_png(cutout_rgba_path, cutout)
    summary = {k: v for k, v in result.items() if k != "images"}
    (out / "debug-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "source.png": str(out / "source.png"),
        "user-selection-mask.png": str(out / "user-selection-mask.png"),
        "selection-roi.png": str(out / "selection-roi.png"),
        "product-object-mask.png": str(out / "product-object-mask.png"),
        "product-cutout.png": str(out / "product-cutout.png"),
        "product-mask-overlay.png": str(out / "product-mask-overlay.png"),
        "old-product-clear-mask.png": str(out / "old-product-clear-mask.png"),
        "debug-summary.json": str(out / "debug-summary.json"),
    }


def build_review_sheet(case_dirs: list[Path], out_path: Path) -> None:
    labels = [
        "1 Source",
        "2 User Rough Ring",
        "3 Search ROI",
        "4 Object Mask",
        "5 RGBA Cutout",
        "6 Source+Mask Overlay",
        "7 Old Clear Mask",
    ]
    files = [
        "source.png",
        "user-selection-mask.png",
        "selection-roi.png",
        "product-object-mask.png",
        "product-cutout.png",
        "product-mask-overlay.png",
        "old-product-clear-mask.png",
    ]
    tile = 280
    pad = 12
    header = 36
    rows = []
    for case_dir in case_dirs:
        row_imgs = []
        for name in files:
            path = case_dir / name
            if path.exists():
                img = Image.open(path).convert("RGB")
            else:
                img = Image.new("RGB", (tile, tile), (24, 24, 24))
            img = img.resize((tile, tile))
            row_imgs.append(img)
        rows.append(row_imgs)
    width = pad + len(files) * (tile + pad)
    height = pad + header + len(rows) * (tile + header + pad)
    sheet = Image.new("RGB", (width, height), (18, 22, 28))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    for col, label in enumerate(labels):
        draw.text((pad + col * (tile + pad), 8), label, fill=(230, 230, 230), font=font)
    for row_index, row_imgs in enumerate(rows):
        y0 = header + pad + row_index * (tile + header + pad)
        draw.text((pad, y0 - 22), f"Case {row_index + 1}: {case_dirs[row_index].name}", fill=(180, 200, 220), font=font)
        for col, img in enumerate(row_imgs):
            sheet.paste(img, (pad + col * (tile + pad), y0))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
