from __future__ import annotations

import copy
import unittest
from typing import Any

import content_center_generate as gen
from content_shorts import (
    build_render_plan,
    build_scene_plan,
    build_visual_asset,
    estimate,
    planned_scene_image_count,
    resolve_shorts_config,
    scene_visual_asset_state,
    scene_visual_prompt,
)
from content_writer_service import _normalize_shorts

PRODUCT_REF = {"product_image_url": "/content/assets/files/product.png", "product_image_path": "", "source": "content_sku_asset"}


def _scene(order: int, *, stage: str = "HOOK", prompt: str = "따뜻한 욕실 선반 위 헤나 제품", asset: Any = None) -> dict[str, Any]:
    return {
        "order": order,
        "duration_sec": 5,
        "stage": stage,
        "caption": f"자막 {order}",
        "subtitle": f"자막 {order}",
        "voice_over": f"내레이션 {order}",
        "spoken_script": f"내레이션 {order}",
        "visual_prompt": prompt,
        "visual_direction": prompt,
        "image_prompt": prompt,
        "visual_asset": asset,
    }


def _generated(prompt: str, name: str = "content_shorts_auto_x_1.png") -> dict[str, Any]:
    return build_visual_asset(f"/content/images/{name}", source="AI_GENERATED", prompt=prompt, model="openai:test", asset_id=f"content_image:{name}")


class _GenHarness:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def __enter__(self) -> "_GenHarness":
        self._saved = (gen.sku_product_image_reference, gen.generate_content_image, gen._auto_generate_images_enabled)

        def fake_generate(db: Any, *, prompt: str, prefix: str, **_: Any) -> dict[str, str]:
            self.calls.append(prompt)
            return {"filename": f"{prefix}.png", "image_url": f"/content/images/{prefix}.png", "prompt": prompt, "model": "openai:test", "reference_image_url": "", "reference_image_path": ""}

        gen.sku_product_image_reference = lambda db, sku_id: dict(PRODUCT_REF)
        gen.generate_content_image = fake_generate
        gen._auto_generate_images_enabled = lambda: True
        return self

    def __exit__(self, *exc: Any) -> None:
        gen.sku_product_image_reference, gen.generate_content_image, gen._auto_generate_images_enabled = self._saved


def _run(scenes: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    payload = {"title": "t", "shorts": {"scenes": scenes}, "scenes": scenes}
    with _GenHarness() as harness:
        gen._try_generate_channel_images(None, payload, artifact_id="CT-test", channel="shorts", sku_id="SKU")  # type: ignore[arg-type]
    return payload["image_generation_summary"], payload["shorts"]["scenes"], len(harness.calls)


class ShortsSceneVisualContractTest(unittest.TestCase):
    def test_a_new_scene_prompt_without_asset_is_generation_candidate(self) -> None:
        summary, scenes, calls = _run([_scene(1)])
        self.assertEqual(scene_visual_asset_state(_scene(1))["status"], "NONE")
        self.assertEqual((summary["planned"], summary["attempted"], summary["generated"], summary["reused"]), (1, 1, 1, 0))
        self.assertEqual(calls, 1)
        asset = scenes[0]["visual_asset"]
        self.assertEqual(asset["source"], "AI_GENERATED")
        self.assertTrue(asset["url"].startswith("/content/images/content_shorts_auto_CT-test_1"))
        self.assertTrue(asset["assetId"].startswith("content_image:"))
        self.assertEqual(scene_visual_asset_state(scenes[0])["status"], "VALID")

    def test_b_valid_existing_asset_is_reused_without_generation(self) -> None:
        prompt = "따뜻한 욕실 선반 위 헤나 제품"
        summary, scenes, calls = _run([_scene(1, prompt=prompt, asset=_generated(prompt))])
        self.assertEqual((summary["attempted"], summary["generated"], summary["reused"]), (0, 0, 1))
        self.assertEqual(calls, 0)
        self.assertEqual(scenes[0]["visual_asset"]["assetId"], "content_image:content_shorts_auto_x_1.png")

    def test_c_legacy_instruction_string_is_not_an_asset(self) -> None:
        legacy = {"order": 1, "caption": "자막", "visual_asset": "따뜻한 자연광 속 제품", "visual_direction": "따뜻한 자연광 속 제품", "image_prompt": "세로형 욕실 컷"}
        state = scene_visual_asset_state(legacy)
        self.assertEqual(state["status"], "NONE")
        self.assertEqual(state["reason"], "legacy_instruction_text")
        self.assertEqual(scene_visual_prompt(legacy), "세로형 욕실 컷")
        edited = dict(legacy, visual_asset="편집된 연출 지시")
        self.assertEqual(scene_visual_prompt(edited), "편집된 연출 지시")
        summary, scenes, calls = _run([copy.deepcopy(legacy)])
        self.assertEqual((summary["attempted"], summary["generated"], summary["reused"]), (1, 1, 0))
        self.assertEqual(scenes[0]["visual_prompt"], "세로형 욕실 컷")
        self.assertEqual(scenes[0]["visual_asset"]["source"], "AI_GENERATED")

    def test_c2_legacy_real_url_string_still_counts_as_existing_asset(self) -> None:
        legacy = {"order": 1, "visual_asset": "/content/images/content_shorts_auto_old_1.png", "image_prompt": "세로형 욕실 컷"}
        state = scene_visual_asset_state(legacy)
        self.assertEqual(state["status"], "VALID")
        self.assertEqual(state["asset"]["source"], "EXISTING")
        self.assertTrue(state["legacy"])

    def test_d_invalid_pseudo_assets_are_flagged_and_regenerated(self) -> None:
        bad_values = [
            {"url": "따뜻한 욕실", "assetId": "x", "source": "AI_GENERATED"},
            {"url": "/content/images/a.png", "source": "AI_GENERATED"},
            {"url": "/content/images/a.png", "assetId": "x", "source": "MADE_UP"},
            ["/content/images/a.png"],
        ]
        for bad in bad_values:
            self.assertEqual(scene_visual_asset_state(_scene(1, asset=bad))["status"], "INVALID_VISUAL_ASSET", bad)
        summary, scenes, calls = _run([_scene(1, asset=bad_values[0])])
        self.assertEqual((summary["invalid"], summary["reused"], summary["attempted"], summary["generated"]), (1, 0, 1, 1))
        self.assertEqual(scenes[0]["visual_asset_error"], "visual_asset_url_missing_or_invalid")

    def test_e_product_locked_asset_does_not_block_scene_image_and_layers_coexist(self) -> None:
        summary, scenes, _ = _run([_scene(1, stage="PRODUCT")])
        self.assertEqual(summary["generated"], 1)
        config = resolve_shorts_config({"mode": "CUSTOM", "storyType": "CUSTOMER_PROBLEM_SOLUTION", "duration": 30}, hint={})
        plan = build_render_plan(config, scenes, product_reference=PRODUCT_REF)
        layers = plan["scenes"][0]["layers"]
        self.assertEqual([layer["type"] for layer in layers], ["background", "product"])
        self.assertEqual(layers[0]["source"], "scene_image")
        self.assertEqual(layers[0]["url"], scenes[0]["visual_asset"]["url"])
        self.assertEqual(layers[1]["source"], "PRODUCT_LOCKED_ASSET")
        self.assertEqual(layers[1]["url"], PRODUCT_REF["product_image_url"])
        self.assertNotEqual(layers[0]["url"], layers[1]["url"])

        pending = build_render_plan(config, [_scene(1, stage="PRODUCT")], product_reference=PRODUCT_REF)["scenes"][0]["layers"]
        self.assertEqual([layer["source"] for layer in pending], ["PENDING_SCENE_IMAGE", "PRODUCT_LOCKED_ASSET"])

    def test_f_visual_prompt_edit_marks_asset_stale(self) -> None:
        scene = _scene(1, prompt="원래 연출", asset=_generated("원래 연출"))
        scene["visual_prompt"] = "새 연출 지시"
        state = scene_visual_asset_state(scene)
        self.assertEqual(state["status"], "STALE")
        summary, scenes, calls = _run([scene])
        self.assertEqual((summary["stale"], summary["reused"], summary["attempted"], summary["generated"]), (1, 0, 1, 1))
        self.assertEqual(scene_visual_asset_state(scenes[0])["status"], "VALID")
        config = resolve_shorts_config({"mode": "QUICK", "duration": 30}, hint={})
        stale_layer = build_render_plan(config, [_scene(1, prompt="새 연출 지시", asset=_generated("원래 연출"))])["scenes"][0]["layers"][0]
        self.assertEqual(stale_layer["source"], "STALE_SCENE_IMAGE")
        self.assertIsNone(stale_layer["url"])

    def test_g_narration_or_subtitle_edit_keeps_asset(self) -> None:
        scene = _scene(1, prompt="원래 연출", asset=_generated("원래 연출"))
        scene.update(caption="바뀐 자막", subtitle="바뀐 자막", voice_over="바뀐 내레이션", spoken_script="바뀐 내레이션")
        self.assertEqual(scene_visual_asset_state(scene)["status"], "VALID")
        summary, _, calls = _run([scene])
        self.assertEqual((summary["reused"], summary["attempted"]), (1, 0))
        self.assertEqual(calls, 0)

    def test_h_summary_counts_match_real_asset_state(self) -> None:
        keep = "유지 장면"
        scenes = [
            _scene(1),
            _scene(2, prompt=keep, asset=_generated(keep, "kept.png")),
            _scene(3, asset="따뜻한 자연광 속 제품"),
            _scene(4, asset={"url": "텍스트", "assetId": "a", "source": "AI_GENERATED"}),
            _scene(5, prompt="새 지시", asset=_generated("옛 지시", "old.png")),
        ]
        summary, out, calls = _run(scenes)
        self.assertEqual(summary["planned"], 5)
        self.assertEqual(summary["reused"], 1)
        self.assertEqual(summary["attempted"], 4)
        self.assertEqual(summary["generated"], 4)
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(summary["planned"], summary["reused"] + summary["attempted"])
        self.assertEqual(calls, summary["attempted"])
        real = [scene_visual_asset_state(s) for s in out]
        self.assertTrue(all(state["status"] == "VALID" for state in real))
        self.assertEqual(sum(1 for state in real if state["status"] == "VALID"), summary["reused"] + summary["generated"])

    def test_h2_failures_and_disabled_generation_never_count_as_reused(self) -> None:
        payload = {"title": "t", "shorts": {"scenes": [_scene(1)]}}
        with _GenHarness():
            gen._auto_generate_images_enabled = lambda: False
            gen._try_generate_channel_images(None, payload, artifact_id="CT-off", channel="shorts", sku_id="SKU")  # type: ignore[arg-type]
        summary = payload["image_generation_summary"]
        self.assertEqual((summary["planned"], summary["attempted"], summary["reused"]), (1, 0, 0))
        self.assertIsNone(payload["shorts"]["scenes"][0]["visual_asset"])

        payload = {"title": "t", "shorts": {"scenes": [_scene(1)]}}
        with _GenHarness():
            gen.sku_product_image_reference = lambda db, sku_id: {}
            gen._try_generate_channel_images(None, payload, artifact_id="CT-noref", channel="shorts", sku_id="SKU")  # type: ignore[arg-type]
        summary = payload["image_generation_summary"]
        self.assertEqual((summary["attempted"], summary["failed"], summary["reused"]), (1, 1, 0))

    def test_i_cost_preview_and_planner_share_policy(self) -> None:
        for duration in (15, 30, 45):
            for story in ("PRODUCT_TOP3", "CUSTOMER_PROBLEM_SOLUTION", "REAL_REVIEW", "DID_YOU_KNOW", "HOWTO_3STEP", "BUYING_GUIDE"):
                config = resolve_shorts_config({"mode": "CUSTOM", "storyType": story, "duration": duration}, hint={})
                skeleton = build_scene_plan(config)["scenes"]
                scenes = [_scene(s["order"], stage=s["stage"]) for s in skeleton]
                self.assertEqual(estimate(config)["imageCalls"], planned_scene_image_count(skeleton))
                summary, _, _ = _run(scenes)
                self.assertEqual(estimate(config)["imageCalls"], summary["planned"])
                self.assertEqual(build_render_plan(config, scenes)["sceneImages"]["planned"], summary["planned"])

    def test_j_writer_output_and_legacy_editor_payload(self) -> None:
        raw = {"scenes": [
            {"scene_no": i, "duration": 5, "stage": "HOOK", "spoken_script": f"내레이션 {i} 입니다", "subtitle": f"자막 {i}", "visual_direction": f"연출 {i}", "shot_prompt": f"세로형 컷 {i}"}
            for i in range(1, 7)
        ]}
        out = _normalize_shorts(raw, target_total=30)
        for scene in out["shorts"]["scenes"]:
            self.assertIsNone(scene["visual_asset"])
            self.assertTrue(scene["visual_prompt"].startswith("세로형 컷"))
            self.assertEqual(scene_visual_asset_state(scene)["status"], "NONE")

        legacy_scenes = [
            {"order": 1, "duration_sec": 5, "caption": "자막", "visual_asset": "욕실 장면", "image_prompt": "세로형 욕실 장면"},
            {"order": 2, "duration_sec": 5, "caption": "자막2", "visual_asset": "/content/images/content_shorts_auto_old_2.png", "generated_image": "/content/images/content_shorts_auto_old_2.png", "visual_status": "GENERATED"},
        ]
        config = resolve_shorts_config({"mode": "QUICK", "duration": 30}, hint={})
        plan = build_render_plan(config, legacy_scenes)
        self.assertEqual([s["layers"][0]["source"] for s in plan["scenes"]], ["PENDING_SCENE_IMAGE", "scene_image"])
        self.assertEqual(plan["sceneImages"]["ready"], 1)

    def test_regeneration_reuses_only_real_assets_with_same_visual_prompt(self) -> None:
        same = "같은 장면"
        previous = {"body": {"shorts": {"scenes": [
            _scene(1, prompt=same, asset=_generated(same, "prev1.png")),
            _scene(2, prompt="이전 장면", asset=_generated("이전 장면", "prev2.png")),
            _scene(3, asset="텍스트 지시만 있음"),
        ]}}}
        current = {"shorts": {"scenes": [_scene(1, prompt=same), _scene(2, prompt="바뀐 장면"), _scene(3, asset=None)]}}
        current["shorts"]["scenes"][2]["visual_prompt"] = scene_visual_prompt(previous["body"]["shorts"]["scenes"][2])
        gen.reuse_unchanged_channel_images(current, channel="shorts", previous_artifact=previous)
        self.assertEqual(current["image_reuse_summary"]["reused"], 1)
        scenes = current["shorts"]["scenes"]
        self.assertEqual(scenes[0]["visual_asset"]["assetId"], "content_image:prev1.png")
        self.assertIsNone(scenes[1]["visual_asset"])
        self.assertIsNone(scenes[2]["visual_asset"])


if __name__ == "__main__":
    unittest.main()
