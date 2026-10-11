from __future__ import annotations

from io import BytesIO

GFA_UI_ANNOTATION_RGB = (34, 197, 94)
GFA_UI_ANNOTATION_TOLERANCE = 18


def is_ui_annotation_rgb(r: int, g: int, b: int, *, tolerance: int = GFA_UI_ANNOTATION_TOLERANCE) -> bool:
    return (
        abs(int(r) - GFA_UI_ANNOTATION_RGB[0]) <= tolerance
        and abs(int(g) - GFA_UI_ANNOTATION_RGB[1]) <= tolerance
        and abs(int(b) - GFA_UI_ANNOTATION_RGB[2]) <= tolerance
        and int(g) > int(r)
        and int(g) > int(b)
    )


def is_painted_semantic_pixel(r: int, g: int, b: int, a: int) -> bool:
    return int(a) > 10 and (int(r) > 10 or int(g) > 10 or int(b) > 10)


def _open_rgba(image_bytes: bytes):
    from PIL import Image

    if not image_bytes:
        raise RuntimeError("image_bytes_missing")
    with Image.open(BytesIO(image_bytes)) as opened:
        return opened.convert("RGBA")


def sanitize_semantic_mask_png(mask_bytes: bytes) -> tuple[bytes, dict]:
    from PIL import Image

    if not mask_bytes:
        raise RuntimeError("image_edit_mask_missing")
    mask = _open_rgba(mask_bytes)
    width, height = mask.size
    pixels = mask.load()
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    out_pixels = out.load()
    painted = 0
    visible_green_before = 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a > 10 and is_ui_annotation_rgb(r, g, b):
                visible_green_before += 1
            if is_painted_semantic_pixel(r, g, b, a):
                painted += 1
                out_pixels[x, y] = (255, 255, 255, 255)
    buf = BytesIO()
    out.save(buf, format="PNG")
    sanitized = buf.getvalue()
    after = _open_rgba(sanitized)
    after_pixels = after.load()
    visible_green_after = 0
    for y in range(height):
        for x in range(width):
            r, g, b, a = after_pixels[x, y]
            if a > 10 and is_ui_annotation_rgb(r, g, b):
                visible_green_after += 1
    return sanitized, {
        "width": width,
        "height": height,
        "paintedPixels": painted,
        "visibleGreenRgbBefore": visible_green_before,
        "visibleGreenRgbAfter": visible_green_after,
        "semanticMaskContainsVisibleGreenRgb": visible_green_after > 0,
    }


def pixel_diff_ratio_from_png(left_bytes: bytes, right_bytes: bytes) -> float:
    if left_bytes == right_bytes:
        return 0.0
    left = _open_rgba(left_bytes)
    right = _open_rgba(right_bytes)
    if right.size != left.size:
        right = right.resize(left.size)
    width, height = left.size
    total = max(1, width * height)
    left_px = left.load()
    right_px = right.load()
    changed = 0
    for y in range(height):
        for x in range(width):
            lr, lg, lb, _la = left_px[x, y]
            rr, rg, rb, _ra = right_px[x, y]
            if lr != rr or lg != rg or lb != rb:
                changed += 1
    return round(changed / float(total), 8)


def annotation_contamination_on_stroke(image_bytes: bytes, mask_bytes: bytes) -> dict:
    image = _open_rgba(image_bytes)
    mask = _open_rgba(mask_bytes)
    if mask.size != image.size:
        mask = mask.resize(image.size)
    width, height = image.size
    image_px = image.load()
    mask_px = mask.load()
    stroke_pixels = 0
    contaminated_pixels = 0
    for y in range(height):
        for x in range(width):
            mr, mg, mb, ma = mask_px[x, y]
            if not is_painted_semantic_pixel(mr, mg, mb, ma):
                continue
            stroke_pixels += 1
            ir, ig, ib, ia = image_px[x, y]
            if ia > 10 and is_ui_annotation_rgb(ir, ig, ib):
                contaminated_pixels += 1
    ratio = round(contaminated_pixels / float(max(1, stroke_pixels)), 8)
    return {
        "strokePixels": stroke_pixels,
        "contaminatedPixels": contaminated_pixels,
        "ratio": ratio,
        "contaminated": contaminated_pixels > 0,
    }


def build_annotation_isolation_evidence(
    *,
    source_bytes: bytes,
    uploaded_mask_bytes: bytes,
    semantic_mask_bytes: bytes,
    sanitize_stats: dict | None,
    api_image_bytes: bytes,
    api_mask_bytes: bytes | None = None,
    raw_ai_bytes: bytes | None = None,
    final_bytes: bytes | None = None,
    composite_base_bytes: bytes | None = None,
    intentional_source_clear: bool = False,
    source_sha_before_mark: str | None = None,
    source_sha_after_mark: str | None = None,
    stale_overlay_after_result: bool = False,
) -> dict:
    import hashlib

    def sha(data: bytes) -> str:
        return hashlib.sha256(data or b"").hexdigest()

    isolation_compare_bytes = source_bytes if intentional_source_clear else api_image_bytes
    pre_edit = pixel_diff_ratio_from_png(source_bytes, isolation_compare_bytes)
    source_stroke = (
        annotation_contamination_on_stroke(source_bytes, semantic_mask_bytes)
        if source_bytes and semantic_mask_bytes
        else {"strokePixels": 0, "contaminatedPixels": 0, "ratio": 0.0, "contaminated": False}
    )
    api_stroke = (
        annotation_contamination_on_stroke(api_image_bytes, semantic_mask_bytes)
        if api_image_bytes and semantic_mask_bytes
        else {"strokePixels": 0, "contaminatedPixels": 0, "ratio": 0.0, "contaminated": False}
    )
    raw_stroke = (
        annotation_contamination_on_stroke(raw_ai_bytes, semantic_mask_bytes)
        if raw_ai_bytes and semantic_mask_bytes
        else None
    )
    final_stroke = (
        annotation_contamination_on_stroke(final_bytes, semantic_mask_bytes)
        if final_bytes and semantic_mask_bytes
        else None
    )
    sanitize_stats = sanitize_stats if isinstance(sanitize_stats, dict) else {}
    source_mutated = bool(
        source_sha_before_mark
        and source_sha_after_mark
        and source_sha_before_mark != source_sha_after_mark
    )
    composite_base = composite_base_bytes if composite_base_bytes is not None else source_bytes
    integrity = {
        "sourceMutatedByMarking": source_mutated,
        "annotationRgbInApiSource": bool(api_stroke.get("contaminated")),
        "semanticMaskContainsVisibleGreenRgb": bool(sanitize_stats.get("semanticMaskContainsVisibleGreenRgb")),
        "finalCompositeUsesCleanSource": composite_base == source_bytes or bool(intentional_source_clear),
        "finalCompositeReintroducesAnnotation": bool((final_stroke or {}).get("contaminated")),
        "staleOverlayAfterResult": bool(stale_overlay_after_result),
        "exportedResultContainsAnnotation": bool((final_stroke or {}).get("contaminated")),
        "preEditInputPixelDiffRatio": pre_edit,
    }
    decision = evaluate_annotation_isolation(integrity)
    return {
        "cleanSourceSha": sha(source_bytes),
        "uploadedMaskSha": sha(uploaded_mask_bytes),
        "semanticMaskSha": sha(semantic_mask_bytes),
        "apiImageInputSha": sha(api_image_bytes),
        "apiMaskSha": sha(api_mask_bytes or b""),
        "sourceShaBeforeMark": source_sha_before_mark or sha(source_bytes),
        "sourceShaAfterMark": source_sha_after_mark or sha(source_bytes),
        "apiImageInputEqualsCleanSource": api_image_bytes == source_bytes,
        "intentionalSourceClearApplied": bool(intentional_source_clear),
        "preEditInputPixelDiffRatio": pre_edit,
        "preApiSendPixelDiffRatio": pixel_diff_ratio_from_png(source_bytes, api_image_bytes),
        "semanticMaskSanitize": sanitize_stats,
        "sourceAnnotationContaminationOnStroke": source_stroke,
        "apiInputAnnotationContaminationOnStroke": api_stroke,
        "rawAiAnnotationContaminationOnStroke": raw_stroke,
        "finalAnnotationContaminationOnStroke": final_stroke,
        "compositeBaseIsCleanSource": composite_base == source_bytes,
        "integrity": integrity,
        **decision,
    }


def evaluate_annotation_isolation(integrity: dict) -> dict:
    failures: list[str] = []
    if integrity.get("sourceMutatedByMarking"):
        failures.append("FAIL_GFA_UI_ANNOTATION_MUTATES_SOURCE")
    if integrity.get("annotationRgbInApiSource"):
        failures.append("FAIL_GFA_API_INPUT_CONTAINS_ANNOTATION")
    if integrity.get("semanticMaskContainsVisibleGreenRgb"):
        failures.append("FAIL_GFA_API_INPUT_CONTAINS_ANNOTATION")
    if integrity.get("finalCompositeReintroducesAnnotation"):
        failures.append("FAIL_GFA_FINAL_COMPOSITE_REINTRODUCES_ANNOTATION")
    if integrity.get("staleOverlayAfterResult"):
        failures.append("FAIL_GFA_RESULT_UI_STALE_ANNOTATION_OVERLAY")
    if integrity.get("exportedResultContainsAnnotation"):
        failures.append("FAIL_GFA_EXPORTED_RESULT_CONTAINS_ANNOTATION")
    pre_edit = float(integrity.get("preEditInputPixelDiffRatio") or 0)
    if pre_edit != 0.0:
        failures.append("FAIL_GFA_API_INPUT_CONTAINS_ANNOTATION")
    unique = []
    for item in failures:
        if item not in unique:
            unique.append(item)
    passed = not unique
    return {
        "pass": passed,
        "failures": unique,
        "decision": (
            "PASS_GFA_MASK_ANNOTATION_ARTIFACT_ISOLATION_AND_CLEAN_INPUT_V1"
            if passed
            else unique[0]
        ),
    }
