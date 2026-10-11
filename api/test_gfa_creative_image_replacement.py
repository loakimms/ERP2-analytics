import inspect
import os
import tempfile
import unittest
from PIL import Image
from io import BytesIO

import gfa_creative_image_replacement as replacement


def _png(size: tuple[int, int] = (64, 64), color=(20, 80, 40, 255)) -> bytes:
    buf = BytesIO()
    Image.new("RGBA", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _overlay(img_bytes: bytes, copy_result: dict, combination: dict | None) -> tuple[bytes, str]:
    image = Image.open(BytesIO(img_bytes)).convert("RGBA")
    image.putpixel((0, 0), (255, 0, 0, 255))
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue(), "image/png"


class GfaCreativeImageReplacementTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.image_dir = self.tmpdir.name
        self.base_path = os.path.join(self.image_dir, "current-base.png")
        with open(self.base_path, "wb") as handle:
            handle.write(_png())
        self.current_final = os.path.join(self.image_dir, "current-final.png")
        with open(self.current_final, "wb") as handle:
            handle.write(_png(color=(9, 9, 9, 255)))
        self.explanation = {
            "base_image_path": self.base_path,
            "image_layering": {"mode": "base_image_plus_server_text_overlay", "base_image_path": self.base_path},
        }

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def test_module_does_not_call_legacy_edit_or_openai(self) -> None:
        src = inspect.getsource(replacement)
        self.assertNotIn("edit-mask", src)
        self.assertNotIn("edit_image_only", src)
        self.assertNotIn("apply-preview", src)
        self.assertNotIn("openai.com", src)
        self.assertNotIn("hair_native", src)

    def test_dimension_mismatch_rejected(self) -> None:
        with self.assertRaises(replacement.GfaCreativeImageReplacementError) as caught:
            replacement.stage_replacement_image(
                explanation=self.explanation,
                copy_result={"headline": "A"},
                combination={},
                current_image_path=self.current_final,
                data=_png((32, 32)),
                declared_mime="image/png",
                filename="small.png",
                image_dir=self.image_dir,
                compose_copy_overlay=_overlay,
            )
        self.assertEqual(caught.exception.code, "DIMENSION_MISMATCH")
        self.assertEqual(self.explanation.get("imageReplacement"), None)

    def test_missing_base_is_case_a_required(self) -> None:
        with self.assertRaises(replacement.GfaCreativeImageReplacementError) as caught:
            replacement.stage_replacement_image(
                explanation={},
                copy_result={},
                combination={},
                current_image_path=self.current_final,
                data=_png(),
                declared_mime="image/png",
                filename="x.png",
                image_dir=self.image_dir,
                compose_copy_overlay=_overlay,
            )
        self.assertEqual(caught.exception.code, "image_replacement_requires_copy_separated_base")
        self.assertEqual(caught.exception.status_code, 409)

    def test_stage_does_not_mutate_current_path(self) -> None:
        result = replacement.stage_replacement_image(
            explanation=self.explanation,
            copy_result={"headline": "A"},
            combination={},
            current_image_path=self.current_final,
            data=_png(color=(1, 2, 3, 255)),
            declared_mime="image/png",
            filename="next.png",
            image_dir=self.image_dir,
            compose_copy_overlay=_overlay,
        )
        self.assertTrue(result["current_unchanged"])
        self.assertIsNone(result["image_path"])
        staged = result["explanation"]["imageReplacement"]["staged"]
        self.assertTrue(os.path.exists(staged["artifactPath"]))
        self.assertTrue(os.path.exists(staged["previewPath"]))
        self.assertEqual(staged["currentImagePathUnchanged"], self.current_final)
        self.assertEqual(result["explanation"]["base_image_path"], self.base_path)

    def test_overlay_failure_on_stage_leaves_explanation_unassigned(self) -> None:
        def boom(img_bytes, copy_result, combination):
            raise RuntimeError("overlay_fail")

        with self.assertRaises(replacement.GfaCreativeImageReplacementError):
            replacement.stage_replacement_image(
                explanation=self.explanation,
                copy_result={},
                combination={},
                current_image_path=self.current_final,
                data=_png(),
                declared_mime="image/png",
                filename="x.png",
                image_dir=self.image_dir,
                compose_copy_overlay=boom,
            )
        self.assertNotIn("imageReplacement", self.explanation)

    def test_apply_then_cancel_semantics(self) -> None:
        staged = replacement.stage_replacement_image(
            explanation=self.explanation,
            copy_result={"headline": "A"},
            combination={},
            current_image_path=self.current_final,
            data=_png(color=(11, 12, 13, 255)),
            declared_mime="image/png",
            filename="next.png",
            image_dir=self.image_dir,
            compose_copy_overlay=_overlay,
        )
        cancelled = replacement.cancel_staged_replacement(
            explanation=staged["explanation"],
            current_image_path=self.current_final,
        )
        self.assertTrue(cancelled["current_unchanged"])
        self.assertIsNone(cancelled["explanation"]["imageReplacement"]["staged"])

        staged = replacement.stage_replacement_image(
            explanation=cancelled["explanation"],
            copy_result={"headline": "A"},
            combination={},
            current_image_path=self.current_final,
            data=_png(color=(21, 22, 23, 255)),
            declared_mime="image/png",
            filename="next2.png",
            image_dir=self.image_dir,
            compose_copy_overlay=_overlay,
        )
        applied = replacement.apply_replacement_image(
            explanation=staged["explanation"],
            copy_result={"headline": "A"},
            combination={},
            current_image_path=self.current_final,
            image_dir=self.image_dir,
            compose_copy_overlay=_overlay,
        )
        self.assertFalse(applied["current_unchanged"])
        self.assertTrue(os.path.exists(applied["image_path"]))
        self.assertNotEqual(applied["image_path"], self.current_final)
        self.assertEqual(applied["explanation"]["image_layering"]["mode"], "replacement_base_plus_server_text_overlay")
        self.assertEqual(applied["explanation"]["imageReplacement"]["current"]["sourceType"], replacement.SOURCE_USER_UPLOADED_REPLACEMENT)
        self.assertIsNone(applied["explanation"]["imageReplacement"]["staged"])
        self.assertNotEqual(applied["explanation"]["base_image_path"], self.base_path)

    def test_apply_compose_failure_does_not_return_new_current(self) -> None:
        staged = replacement.stage_replacement_image(
            explanation=self.explanation,
            copy_result={},
            combination={},
            current_image_path=self.current_final,
            data=_png(),
            declared_mime="image/png",
            filename="next.png",
            image_dir=self.image_dir,
            compose_copy_overlay=_overlay,
        )

        def boom(img_bytes, copy_result, combination):
            raise RuntimeError("apply_overlay_fail")

        with self.assertRaises(replacement.GfaCreativeImageReplacementError) as caught:
            replacement.apply_replacement_image(
                explanation=staged["explanation"],
                copy_result={},
                combination={},
                current_image_path=self.current_final,
                image_dir=self.image_dir,
                compose_copy_overlay=boom,
            )
        self.assertEqual(caught.exception.code, "replacement_apply_compose_failed")

    def test_download_uses_image_base(self) -> None:
        artifact = replacement.download_current_base(explanation=self.explanation, creative_id="run-1")
        self.assertEqual(artifact["path"], self.base_path)
        self.assertEqual(artifact["authority"], "IMAGE_BASE")
        self.assertTrue(artifact["filename"].startswith("gfa_run-1_"))


class GfaLegacyImageEditPreservationRegressionTest(unittest.TestCase):
    def test_legacy_routes_still_present_in_main_source(self) -> None:
        root = os.path.dirname(os.path.abspath(__file__))
        main_path = os.path.join(root, "main.py")
        with open(main_path, encoding="utf-8") as handle:
            text = handle.read()
        self.assertIn('/gfa/creative-generator/runs/{run_id}/image/edit-mask', text)
        self.assertIn('/gfa/creative-generator/runs/{run_id}/image/edit"', text)
        self.assertIn('/gfa/creative-generator/runs/{run_id}/image/apply-preview', text)

    def test_legacy_modules_still_import(self) -> None:
        import gfa_mask_annotation_isolation
        import gfa_product_authority
        import gfa_existing_product_object_extraction

        self.assertTrue(callable(gfa_mask_annotation_isolation.sanitize_semantic_mask_png))
        self.assertTrue(callable(gfa_product_authority.resolve_product_authority))
        self.assertTrue(callable(gfa_existing_product_object_extraction.extract_existing_product_from_flattened_source))


if __name__ == "__main__":
    unittest.main()
