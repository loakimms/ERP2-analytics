from pathlib import Path
import shutil, json, hashlib, re, datetime

root = Path(r'D:/dev/ERP2-analytics')
base = root / 'releases/analytics_20260921_005100'
base_manifest_sha = '27dece8d1427a83c32cd55d204a017880331858b3ab5e8a0047d2beb77be4e97'
base_tag = 'analytics_20260921_005100'
tag = 'analytics_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
cand = root / 'releases/_candidates' / tag
if cand.exists():
    raise SystemExit(f'candidate exists: {cand}')
cand.mkdir(parents=True)
shutil.copytree(base / 'source', cand / 'source')
shutil.copytree(base / 'docker', cand / 'docker')
(cand / 'manifests').mkdir()

shutil.copy2(root / 'calibration/review/gfa-creative-editor-image-upload-replacement-isolated-promotion-v1/_isolated-evidence/overlay/gfa_creative_image_replacement.py', cand / 'source/api/gfa_creative_image_replacement.py')
shutil.copy2(root / 'calibration/review/gfa-creative-editor-image-upload-replacement-isolated-promotion-v1/_isolated-evidence/overlay/GfaCreativeImageReplacementPanel.tsx', cand / 'source/web/src/modules/ads/GfaCreativeImageReplacementPanel.tsx')

(cand / 'source/api/test_gfa_creative_image_replacement.py').write_text('''import inspect
import os
import tempfile
import unittest
from io import BytesIO

from PIL import Image

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
        cancelled = replacement.cancel_staged_replacement(explanation=staged["explanation"], current_image_path=self.current_final)
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


if __name__ == "__main__":
    unittest.main()
''', encoding='utf-8')

cur_main = (root / 'api/main.py').read_text(encoding='utf-8')
block_start = cur_main.index('def _gfa_replacement_compose_copy_overlay')
block_end = cur_main.index('def _gfa_generator_preview_path_from_url', block_start)
replacement_block = cur_main[block_start:block_end]
main_path = cand / 'source/api/main.py'
main_text = main_path.read_text(encoding='utf-8')
insert_after = '    return FileResponse(base_image_path, media_type=str(explanation.get("base_image_mime_type") or "image/png"))\n\n\n'
if insert_after not in main_text:
    raise SystemExit('main.py insertion anchor not found')
main_path.write_text(main_text.replace(insert_after, insert_after + replacement_block, 1), encoding='utf-8')

cur_ads = (root / 'web/src/modules/ads/adsApi.ts').read_text(encoding='utf-8')
ads_start = cur_ads.index('export async function stageGfaCreativeImageReplacement')
ads_end = cur_ads.index('export async function updateGfaCreativeGeneratorRunCopy', ads_start)
ads_block = cur_ads[ads_start:ads_end]
ads_path = cand / 'source/web/src/modules/ads/adsApi.ts'
ads_text = ads_path.read_text(encoding='utf-8')
ads_path.write_text(ads_text.replace('export async function updateGfaCreativeGeneratorRunCopy', ads_block + 'export async function updateGfaCreativeGeneratorRunCopy', 1), encoding='utf-8')

view_path = cand / 'source/web/src/modules/ads/GfaCreativeGeneratorView.tsx'
view = view_path.read_text(encoding='utf-8')
view = view.replace('\teditGfaCreativeGeneratorRunImageOnly,\n', '')
view = view.replace('\treplaceGfaCreativeGeneratorRunImage,\n', '')
view = view.replace("import { GfaCanvasEditor, LayerPropertyPanel, overlayFromValue, type OverlayItem, type OverlayKey, type OverlayLayout } from './GfaCanvasEditor';\n", "import { GfaCanvasEditor, LayerPropertyPanel, overlayFromValue, type OverlayItem, type OverlayKey, type OverlayLayout } from './GfaCanvasEditor';\nimport { GfaCreativeImageReplacementPanel } from './GfaCreativeImageReplacementPanel';\n")
for line in [
    "\tconst [replacingImage, setReplacingImage] = useState<string>('');\n",
    "\tconst [editingImage, setEditingImage] = useState<string>('');\n",
    "\tconst [imageEditPrompts, setImageEditPrompts] = useState<Record<string, string>>({});\n",
    "\tconst [editorRunId, setEditorRunId] = useState<string>('');\n",
    "\tconst [maskEditPrompt, setMaskEditPrompt] = useState('');\n",
    "\tconst [maskEditMode, setMaskEditMode] = useState<'default' | 'hair_native_transform'>('default');\n",
    "\tconst [maskEditingImage, setMaskEditingImage] = useState('');\n",
    "\tconst [hasEditMask, setHasEditMask] = useState(false);\n",
    "\tconst [maskReferenceImages, setMaskReferenceImages] = useState<File[]>([]);\n",
    "\tconst [maskEditPreview, setMaskEditPreview] = useState<ProfessionalEditorMaskPreview | null>(null);\n",
    "\tconst maskCanvasRef = useRef<HTMLCanvasElement | null>(null);\n",
]:
    view = view.replace(line, '')
view = re.sub(r"\n\tuseEffect\(\(\) => \{\n\t\tsetHasEditMask\(false\);\n\t\tsetMaskEditPreview\(null\);\n\t\tsetMaskEditPrompt\(''\);\n\t\tsetMaskReferenceImages\(\[\]\);\n\t\tsetMaskEditMode\('default'\);\n\t\}, \[editorRunId\]\);\n", "\n", view)
view = re.sub(r"\n\tconst replaceRunImage = async \(run: GfaCreativeGeneratorRun, file\?: File\) => \{.*?\n\t\};\n\n\tconst copyDraftFor", "\n\tconst copyDraftFor", view, flags=re.S)
view = re.sub(r"\n\tconst editRunImageOnly = async \(run: GfaCreativeGeneratorRun\) => \{.*?\n\t\};\n\n\tconst regenerateRunImageFromCopy", "\n\tconst regenerateRunImageFromCopy", view, flags=re.S)
view = re.sub(r"\n\tconst regenerateCopyOnlyFromEditor = async \(run: GfaCreativeGeneratorRun\) => \{.*?\n\t\};\n\n\tconst updateReview", "\n\tconst updateReview", view, flags=re.S)
view = re.sub(r"\n\tconst renderEditorModal = \(\): JSX.Element \| null => \{.*?\n\t\};\n\n\tconst renderRunPreview", "\n\tconst renderRunPreview", view, flags=re.S)
old_start = "\t\treturn (\n\t\t\t<div style={{ display: 'grid', gap: 12 }}>\n\t\t\t\t{renderEditableCanvas(run, { maxWidth: 360 })}\n\t\t\t\t<button type=\"button\" className=\"btn-primary\" onClick={() => setEditorRunId(run.id)}>"
old_idx = view.find(old_start)
if old_idx < 0:
    raise SystemExit('default editor block start not found')
end_marker = "\t\t\t\t<div style={{ display: 'grid', gap: 8, border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 10, background: 'rgba(15,23,42,0.42)' }}>"
end_idx = view.find(end_marker, old_idx)
if end_idx < 0:
    raise SystemExit('default editor block end marker not found')
new_start = "\t\treturn (\n\t\t\t<div style={{ display: 'grid', gap: 12 }}>\n\t\t\t\t{renderEditableCanvas(run, { maxWidth: 360 })}\n\t\t\t\t<GfaCreativeImageReplacementPanel\n\t\t\t\t\tapiBaseUrl={props.apiBaseUrl}\n\t\t\t\t\trun={run}\n\t\t\t\t\tonRunUpdated={upsertRun}\n\t\t\t\t\tonMessage={setMessage}\n\t\t\t\t/>\n"
view = view[:old_idx] + new_start + view[end_idx:]
view = view.replace('\n\t\t\t{renderEditorModal()}\n', '\n')
first_part = view.split('function scoreColor', 1)[0]
for forbidden in ['setEditorRunId', 'renderEditorModal', 'replaceRunImage', 'editRunImageOnly', 'imageEditPrompts', 'replacingImage', 'editingImage', 'maskEditPrompt', 'maskEditPreview', 'maskCanvasRef']:
    if forbidden in first_part:
        raise SystemExit(f'forbidden default editor token remains: {forbidden}')
view_path.write_text(view, encoding='utf-8')

def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

files = []
for rel in ['api/gfa_creative_image_replacement.py','api/test_gfa_creative_image_replacement.py','web/src/modules/ads/GfaCreativeImageReplacementPanel.tsx']:
    files.append({'relativePath':'source/'+rel,'classification':'APPROVED_NEW','sha256':sha(cand/'source'/rel)})
for rel in ['api/main.py','web/src/modules/ads/adsApi.ts','web/src/modules/ads/GfaCreativeGeneratorView.tsx']:
    files.append({'relativePath':'source/'+rel,'classification':'APPROVED_MODIFIED','baseSha256':sha(base/'source'/rel),'sha256':sha(cand/'source'/rel)})
approved = {'sprint':'GFA_CREATIVE_EDITOR_IMAGE_UPLOAD_REPLACEMENT_ISOLATED_PROMOTION_RETRY_V1','baseRuntimeTag':base_tag,'baseSourceManifestSha256':base_manifest_sha,'candidateTag':tag,'summary':{'APPROVED_NEW':3,'APPROVED_MODIFIED':3,'UNEXPECTED':0},'files':files}
app_path = cand/'manifests/approved-change-manifest.json'
app_path.write_text(json.dumps(approved, ensure_ascii=False, indent=2), encoding='utf-8')
app_sha = sha(app_path)
identity = {'sprint':'GFA_CREATIVE_EDITOR_IMAGE_UPLOAD_REPLACEMENT_ISOLATED_PROMOTION_RETRY_V1','candidateTag':tag,'baseRuntimeTag':base_tag,'baseSourceManifestSha256':base_manifest_sha,'approvedChangeManifest':'manifests/approved-change-manifest.json','approvedChangeManifestSha256':app_sha}
(cand/'manifests/candidate-identity.json').write_text(json.dumps(identity, ensure_ascii=False, indent=2), encoding='utf-8')
manifest_files = []
for p in sorted(x for x in cand.rglob('*') if x.is_file()):
    rel = p.relative_to(cand).as_posix()
    if rel in {'manifests/source-manifest.json','manifests/source-manifest.sha256'}:
        continue
    manifest_files.append({'relativePath':rel,'size':p.stat().st_size,'sha256':sha(p)})
manifest = {'runtimeTag':tag,'baseRuntimeTag':base_tag,'baseManifestSha256':base_manifest_sha,'approvedChangeManifestSha256':app_sha,'fileCount':len(manifest_files),'files':manifest_files}
manifest_path = cand/'manifests/source-manifest.json'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
manifest_sha = sha(manifest_path)
(cand/'manifests/source-manifest.sha256').write_text(manifest_sha, encoding='ascii')
identity['candidateManifestSha256'] = manifest_sha
(cand/'manifests/candidate-identity.json').write_text(json.dumps(identity, ensure_ascii=False, indent=2), encoding='utf-8')
approved['candidateManifestSha256'] = manifest_sha
app_path.write_text(json.dumps(approved, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'candidateTag':tag,'candidateSnapshot':str(cand),'approvedChangeManifestSha256':sha(app_path),'candidateManifestSha256':manifest_sha}, indent=2))
