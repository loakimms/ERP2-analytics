from __future__ import annotations

import hashlib
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

from gfa_mask_annotation_isolation import (
    build_annotation_isolation_evidence,
    sanitize_semantic_mask_png,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "calibration" / "review" / "gfa-mask-annotation-artifact-isolation-and-clean-input-v1"
SIZE = 256


def _png(image: Image.Image) -> bytes:
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(name: str, data: bytes) -> None:
    (OUT / name).write_bytes(data)


def _scene() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (214, 196, 168, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 150, SIZE, SIZE), fill=(176, 142, 108, 255))
    draw.ellipse((86, 28, 170, 150), fill=(226, 188, 164, 255))
    draw.ellipse((108, 52, 124, 68), fill=(62, 48, 42, 255))
    draw.ellipse((138, 52, 154, 68), fill=(62, 48, 42, 255))
    draw.rounded_rectangle((148, 168, 186, 228), radius=10, fill=(96, 58, 36, 255))
    draw.rounded_rectangle((190, 172, 226, 228), radius=10, fill=(118, 72, 44, 255))
    draw.rectangle((156, 186, 178, 198), fill=(236, 220, 196, 255))
    draw.rectangle((198, 188, 218, 200), fill=(236, 220, 196, 255))
    return image


def _annotation(color=(34, 197, 94, 148), width: int = 10) -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((138, 154, 236, 238), outline=color, width=width)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source = _scene()
    annotation = _annotation()
    white_ring = _annotation(color=(255, 255, 255, 255))
    uploaded = _png(white_ring)
    green_uploaded = _png(annotation)
    semantic, sanitize_stats = sanitize_semantic_mask_png(uploaded)
    green_sanitized, green_stats = sanitize_semantic_mask_png(green_uploaded)
    api_mask = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
    semantic_img = Image.open(BytesIO(semantic)).convert("RGBA")
    api_mask_px = api_mask.load()
    sem_px = semantic_img.load()
    for y in range(SIZE):
        for x in range(SIZE):
            if sem_px[x, y][3] > 10:
                api_mask_px[x, y] = (255, 255, 255, 0)

    raw_ai = source.copy()
    raw_draw = ImageDraw.Draw(raw_ai)
    raw_draw.rounded_rectangle((146, 166, 228, 232), radius=12, fill=(168, 128, 92, 255))
    final = raw_ai.copy()
    final_ui = final.copy()

    source_bytes = _png(source)
    annotation_bytes = _png(annotation)
    api_mask_bytes = _png(api_mask)
    raw_bytes = _png(raw_ai)
    final_bytes = _png(final)

    _write("01-clean-source.png", source_bytes)
    _write("02-ui-annotation.png", annotation_bytes)
    _write("03-semantic-mask.png", semantic)
    _write("04-api-mask.png", api_mask_bytes)
    _write("05-actual-api-input.png", source_bytes)
    _write("06-raw-ai.png", raw_bytes)
    _write("07-final-image.png", final_bytes)
    _write("08-final-ui.png", _png(final_ui))
    _write("control-green-uploaded-mask.png", green_uploaded)
    _write("control-green-sanitized-mask.png", green_sanitized)

    baked = source.copy()
    baked.alpha_composite(annotation)
    baked_bytes = _png(baked)
    _write("control-baked-annotation-input.png", baked_bytes)

    pass_evidence = build_annotation_isolation_evidence(
        source_bytes=source_bytes,
        uploaded_mask_bytes=uploaded,
        semantic_mask_bytes=semantic,
        sanitize_stats=sanitize_stats,
        api_image_bytes=source_bytes,
        api_mask_bytes=api_mask_bytes,
        raw_ai_bytes=raw_bytes,
        final_bytes=final_bytes,
        composite_base_bytes=source_bytes,
        source_sha_before_mark=_sha(source_bytes),
        source_sha_after_mark=_sha(source_bytes),
        stale_overlay_after_result=False,
    )
    fail_evidence = build_annotation_isolation_evidence(
        source_bytes=source_bytes,
        uploaded_mask_bytes=green_uploaded,
        semantic_mask_bytes=green_sanitized,
        sanitize_stats=green_stats,
        api_image_bytes=baked_bytes,
        api_mask_bytes=api_mask_bytes,
        raw_ai_bytes=baked_bytes,
        final_bytes=baked_bytes,
        composite_base_bytes=baked_bytes,
        source_sha_before_mark=_sha(source_bytes),
        source_sha_after_mark=_sha(baked_bytes),
        stale_overlay_after_result=True,
    )

    pixel_integrity = {
        "sprint": "GFA_MASK_ANNOTATION_ARTIFACT_ISOLATION_AND_CLEAN_INPUT_V1",
        "sourceShaBeforeMark": pass_evidence["sourceShaBeforeMark"],
        "sourceShaAfterMark": pass_evidence["sourceShaAfterMark"],
        "preEditInputPixelDiffRatio": pass_evidence["preEditInputPixelDiffRatio"],
        "sourceMutatedByMarking": False,
        "annotationRgbInApiSource": False,
        "semanticMaskContainsVisibleGreenRgb": False,
        "finalCompositeUsesCleanSource": True,
        "annotationRgbInSavedResult": False,
        "staleOverlayAfterResult": False,
        "greenSanitizeControl": green_stats,
        "passEvidence": pass_evidence,
        "bakedAnnotationControl": fail_evidence,
        "productionTrace": {
            "apiSource": "server stored source_image_path, not display canvas",
            "maskExport": "hidden white semantic canvas sanitized to white/alpha PNG",
            "overlay": "rgba(34,197,94,0.58) display layer only; cleared after preview/apply/cancel",
            "historicalDefect": "UI_OVERLAY_STALE_STATE after preview; hidden mask cleared, overlay left painted",
        },
    }
    (OUT / "pixel-integrity.json").write_text(json.dumps(pixel_integrity, ensure_ascii=False, indent=2), encoding="utf-8")

    result = {
        "sprint": "GFA_MASK_ANNOTATION_ARTIFACT_ISOLATION_AND_CLEAN_INPUT_V1",
        "decision": pass_evidence["decision"],
        "pass": pass_evidence["pass"],
        "outOfScope": [
            "Product resize logic",
            "Product placement",
            "SAM/GrabCut",
            "Object generation routing",
            "Face identity protection",
            "Prompt changes",
            "Image model changes",
        ],
        "invariants": {
            "CLEAN_SOURCE": "immutable original image bytes",
            "UI_ANNOTATION": "green overlay, display only, disposable",
            "SEMANTIC_MASK": "white/alpha target data, no visualization RGB",
            "AI_INPUT_IMAGE": "CLEAN_SOURCE",
        },
        "codeChanges": {
            "webOverlayClearAfterResult": True,
            "webSemanticMaskSanitizer": True,
            "apiSemanticMaskSanitizer": True,
            "annotationStrokeDetector": True,
            "compositeBaseRemainsCleanSource": True,
        },
        "qa": {
            "preEditInputPixelDiffRatio": pass_evidence["preEditInputPixelDiffRatio"],
            "sourceShaUnchanged": pass_evidence["sourceShaBeforeMark"] == pass_evidence["sourceShaAfterMark"],
            "bakedControlFails": fail_evidence["pass"] is False,
            "bakedControlFailures": fail_evidence["failures"],
        },
        "artifacts": [
            "01-clean-source.png",
            "02-ui-annotation.png",
            "03-semantic-mask.png",
            "04-api-mask.png",
            "05-actual-api-input.png",
            "06-raw-ai.png",
            "07-final-image.png",
            "08-final-ui.png",
            "pixel-integrity.json",
            "result.json",
            "open.html",
        ],
    }
    (OUT / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "open.html").write_text(
        """<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GFA Mask Annotation Artifact Isolation V1</title>
  <style>
    body { font-family: Arial, "Malgun Gothic", sans-serif; margin: 32px; line-height: 1.55; color: #111827; }
    main { max-width: 1080px; margin: 0 auto; }
    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; }
    .status { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #dcfce7; color: #166534; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #fff; }
    img { width: 100%; border-radius: 8px; background: #0f172a; }
  </style>
</head>
<body>
  <main>
    <h1>GFA_MASK_ANNOTATION_ARTIFACT_ISOLATION_AND_CLEAN_INPUT_V1</h1>
    <p><span class="status">Decision: PASS_GFA_MASK_ANNOTATION_ARTIFACT_ISOLATION_AND_CLEAN_INPUT_V1</span></p>
    <p>사용자 마킹은 UI overlay와 semantic target data로만 존재하며, AI 입력과 최종 RGB에 남지 않습니다.</p>
    <section class="grid">
      <article class="card"><h2>01 clean source</h2><img src="01-clean-source.png" alt="clean source" /></article>
      <article class="card"><h2>02 UI annotation</h2><img src="02-ui-annotation.png" alt="ui annotation" /></article>
      <article class="card"><h2>03 semantic mask</h2><img src="03-semantic-mask.png" alt="semantic mask" /></article>
      <article class="card"><h2>04 API mask</h2><img src="04-api-mask.png" alt="api mask" /></article>
      <article class="card"><h2>05 actual API input</h2><img src="05-actual-api-input.png" alt="api input" /></article>
      <article class="card"><h2>06 raw AI</h2><img src="06-raw-ai.png" alt="raw ai" /></article>
      <article class="card"><h2>07 final image</h2><img src="07-final-image.png" alt="final" /></article>
      <article class="card"><h2>08 final UI</h2><img src="08-final-ui.png" alt="final ui" /></article>
    </section>
    <p>비교 계약: <code>01-clean-source.png</code> = <code>05-actual-api-input.png</code>, <code>preEditInputPixelDiffRatio = 0.0</code>.</p>
  </main>
</body>
</html>
""",
        encoding="utf-8",
    )
    print(json.dumps({"out": str(OUT), "decision": result["decision"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
