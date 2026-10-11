import unittest
from io import BytesIO

from PIL import Image, ImageDraw

from gfa_mask_annotation_isolation import (
    annotation_contamination_on_stroke,
    build_annotation_isolation_evidence,
    evaluate_annotation_isolation,
    pixel_diff_ratio_from_png,
    sanitize_semantic_mask_png,
)


def _png(image: Image.Image) -> bytes:
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _scene(size: int = 64) -> bytes:
    image = Image.new("RGBA", (size, size), (196, 168, 132, 255))
    draw = ImageDraw.Draw(image)
    draw.ellipse((8, 8, 28, 36), fill=(214, 176, 150, 255))
    draw.rounded_rectangle((34, 30, 46, 54), radius=4, fill=(92, 58, 36, 255))
    draw.rounded_rectangle((48, 32, 58, 54), radius=4, fill=(110, 70, 42, 255))
    return _png(image)


def _ring_mask(size: int = 64, color=(255, 255, 255, 255), width: int = 4) -> bytes:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((30, 26, 60, 58), outline=color, width=width)
    return _png(image)


class GfaMaskAnnotationIsolationTest(unittest.TestCase):
    def test_sanitize_strips_green_annotation_rgb(self) -> None:
        green = _ring_mask(color=(34, 197, 94, 148))
        sanitized, stats = sanitize_semantic_mask_png(green)
        self.assertGreater(stats["visibleGreenRgbBefore"], 0)
        self.assertEqual(stats["visibleGreenRgbAfter"], 0)
        self.assertFalse(stats["semanticMaskContainsVisibleGreenRgb"])
        after = Image.open(BytesIO(sanitized)).convert("RGBA")
        painted = 0
        green_left = 0
        pixels = after.load()
        width, height = after.size
        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]
                if a > 10:
                    painted += 1
                    self.assertEqual((r, g, b), (255, 255, 255))
                    if abs(g - 197) <= 18:
                        green_left += 1
        self.assertGreater(painted, 0)
        self.assertEqual(green_left, 0)

    def test_clean_source_equals_api_input_and_ignores_ui_overlay(self) -> None:
        source = _scene()
        overlay = _ring_mask(color=(34, 197, 94, 148))
        merged = Image.open(BytesIO(source)).convert("RGBA")
        overlay_img = Image.open(BytesIO(overlay)).convert("RGBA")
        merged.alpha_composite(overlay_img)
        merged_bytes = _png(merged)
        white_mask, stats = sanitize_semantic_mask_png(overlay)
        evidence = build_annotation_isolation_evidence(
            source_bytes=source,
            uploaded_mask_bytes=overlay,
            semantic_mask_bytes=white_mask,
            sanitize_stats=stats,
            api_image_bytes=source,
            api_mask_bytes=white_mask,
            raw_ai_bytes=source,
            final_bytes=source,
            composite_base_bytes=source,
            source_sha_before_mark="abc",
            source_sha_after_mark="abc",
            stale_overlay_after_result=False,
        )
        self.assertEqual(evidence["preEditInputPixelDiffRatio"], 0.0)
        self.assertTrue(evidence["pass"])
        self.assertEqual(evidence["decision"], "PASS_GFA_MASK_ANNOTATION_ARTIFACT_ISOLATION_AND_CLEAN_INPUT_V1")
        baked = build_annotation_isolation_evidence(
            source_bytes=source,
            uploaded_mask_bytes=overlay,
            semantic_mask_bytes=white_mask,
            sanitize_stats=stats,
            api_image_bytes=merged_bytes,
            api_mask_bytes=white_mask,
            raw_ai_bytes=merged_bytes,
            final_bytes=merged_bytes,
            composite_base_bytes=merged_bytes,
        )
        self.assertFalse(baked["pass"])
        self.assertIn("FAIL_GFA_API_INPUT_CONTAINS_ANNOTATION", baked["failures"])

    def test_stroke_detector_does_not_use_global_green_counts(self) -> None:
        source = Image.new("RGBA", (32, 32), (10, 80, 20, 255))
        source.putpixel((2, 2), (34, 197, 94, 255))
        mask = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        mask.putpixel((20, 20), (255, 255, 255, 255))
        stats = annotation_contamination_on_stroke(_png(source), _png(mask))
        self.assertEqual(stats["strokePixels"], 1)
        self.assertFalse(stats["contaminated"])

    def test_failure_types_are_distinct(self) -> None:
        decision = evaluate_annotation_isolation(
            {
                "sourceMutatedByMarking": True,
                "annotationRgbInApiSource": False,
                "semanticMaskContainsVisibleGreenRgb": False,
                "finalCompositeReintroducesAnnotation": False,
                "staleOverlayAfterResult": True,
                "exportedResultContainsAnnotation": False,
                "preEditInputPixelDiffRatio": 0.0,
            }
        )
        self.assertEqual(
            decision["failures"],
            ["FAIL_GFA_UI_ANNOTATION_MUTATES_SOURCE", "FAIL_GFA_RESULT_UI_STALE_ANNOTATION_OVERLAY"],
        )

    def test_pixel_diff_ratio_zero_for_identical_png(self) -> None:
        source = _scene()
        self.assertEqual(pixel_diff_ratio_from_png(source, source), 0.0)


if __name__ == "__main__":
    unittest.main()
