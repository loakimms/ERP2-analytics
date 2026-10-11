from __future__ import annotations

import io
import json
import os
import struct
import tempfile
import unittest
import wave
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import content_shorts as cs
import content_shorts_audio as audio
from db import ContentArtifact, ContentSkuAsset

OPENAI_VOICES = {"alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"}


def fake_wav(seconds: float, *, streaming_header: bool = True) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x01\x00" * int(24000 * seconds))
    data = bytearray(out.getvalue())
    if streaming_header:
        data[4:8] = struct.pack("<I", 0xFFFFFFFF)
        data[40:44] = struct.pack("<I", 0xFFFFFFFF)
    return bytes(data)


def fake_mp3(seconds: float) -> bytes:
    frame = b"\xff\xfb\x90\x64" + b"\x00" * 413
    return b"ID3\x03\x00\x00\x00\x00\x00\x00" + frame * int(round(seconds * 44100 / 1152))


class _Providers:
    def __init__(self) -> None:
        self.tts: list[dict[str, Any]] = []
        self.lyria: list[str] = []
        self.tts_seconds = 3.0
        self.music_seconds = 30.8
        self.tts_error: str | None = None

    def install(self) -> None:
        self._saved = (audio.openai_tts, audio.gemini_lyria)

        def tts(db: Any, *, text: str, provider_voice: str, instructions: str, model: str) -> bytes:
            self.tts.append({"text": text, "voice": provider_voice, "instructions": instructions, "model": model})
            if self.tts_error:
                raise RuntimeError(self.tts_error)
            return fake_wav(self.tts_seconds)

        def lyria(db: Any, *, prompt: str, model: str) -> dict[str, Any]:
            self.lyria.append(prompt)
            return {"audio": fake_mp3(self.music_seconds), "mime": "audio/mpeg", "text": "[0:00] Intro", "interactionId": f"int-{len(self.lyria)}"}

        audio.openai_tts = tts
        audio.gemini_lyria = lyria

    def restore(self) -> None:
        audio.openai_tts, audio.gemini_lyria = self._saved


def _scene(order: int, *, sec: int = 5, text: str | None = None, subtitle: str | None = None) -> dict[str, Any]:
    return {
        "order": order,
        "duration_sec": sec,
        "stage": "HOOK",
        "caption": subtitle or f"자막 {order}",
        "subtitle": subtitle or f"자막 {order}",
        "voice_over": text or f"장면 {order} 내레이션입니다.",
        "spoken_script": text or f"장면 {order} 내레이션입니다.",
        "visual_prompt": f"연출 {order}",
        "visual_asset": None,
    }


class ShortsAudioFoundationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self._old_dir = os.environ.get("CONTENT_ASSET_DIR")
        os.environ["CONTENT_ASSET_DIR"] = self.tmp.name
        engine = create_engine("sqlite://")
        ContentSkuAsset.__table__.create(engine)
        ContentArtifact.__table__.create(engine)
        self.db = sessionmaker(bind=engine)()
        self.providers = _Providers()
        self.providers.install()

    def tearDown(self) -> None:
        self.providers.restore()
        self.db.close()
        if self._old_dir is None:
            os.environ.pop("CONTENT_ASSET_DIR", None)
        else:
            os.environ["CONTENT_ASSET_DIR"] = self._old_dir
        self.tmp.cleanup()

    def _config(self, *, voice: str = "VOICE_F_CALM", tone: str = "EMPATHY", track: str | None = None, mood: str = "CALM") -> dict[str, Any]:
        raw = {"mode": "CUSTOM", "duration": 30, "storyType": "CUSTOMER_PROBLEM_SOLUTION", "voice": {"voiceId": voice}, "narrationTone": tone, "music": {"mood": mood, "trackId": track}}
        return cs.resolve_shorts_config(raw, hint={}, music_library=audio.music_library(self.db))

    def _artifact(self, artifact_id: str, scenes: list[dict[str, Any]], config: dict[str, Any]) -> ContentArtifact:
        body = {"shorts": {"scenes": scenes}, "scenes": scenes, "shorts_generation_config": config}
        row = ContentArtifact(artifact_id=artifact_id, sku_id="SKU1", appeal_id="AP1", channel="shorts", title="t", body_json=json.dumps(body, ensure_ascii=False), revision_no=1, source="ai_original", reviewer_status="pending")
        self.db.add(row)
        self.db.commit()
        return row

    def _scenes(self, row: ContentArtifact) -> list[dict[str, Any]]:
        self.db.refresh(row)
        return json.loads(row.body_json)["shorts"]["scenes"]

    def _set_commercial(self, music_id: str, status: str) -> None:
        row = self.db.get(ContentSkuAsset, music_id)
        meta = json.loads(row.analysis_json)
        meta["termsMetadata"]["commercialUseStatus"] = status
        row.analysis_json = json.dumps(meta)
        self.db.commit()

    def _eligible_track(self, mood: str = "CALM", variant: int = 1) -> dict[str, Any]:
        track = audio.generate_music_track(self.db, mood=mood, variant=variant)
        audio.review_music_track(self.db, track["musicId"], status="APPROVED")
        self._set_commercial(track["musicId"], "VERIFIED_ALLOWED")
        return audio.get_music_track(self.db, track["musicId"])

    # --- Voice registry / preview ---------------------------------------
    def test_a_registry_has_six_voices_with_valid_provider_ids(self) -> None:
        self.assertEqual(len(cs.VOICES), 6)
        for voice in cs.VOICES:
            self.assertEqual(voice["provider"], "openai")
            self.assertIn(voice["providerVoiceId"], OPENAI_VOICES)
            self.assertEqual(voice["supportedLanguage"], ["ko"])
            self.assertTrue(voice["active"])
            self.assertIn("uiGenderStyle", voice)
            self.assertIn("uiAgeStyle", voice)

    def test_b_c_d_voice_preview_generated_once_then_reused(self) -> None:
        listed = audio.voice_registry_with_previews(self.db)
        self.assertTrue(all(v["previewUrl"] is None for v in listed))
        self.assertEqual(len(self.providers.tts), 0)
        item, reused = audio.ensure_voice_preview(self.db, "VOICE_F_CALM")
        self.assertFalse(reused)
        self.assertEqual(len(self.providers.tts), 1)
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, item["url"].rsplit("/", 1)[-1])))
        self.assertEqual(self.providers.tts[0]["text"], cs.VOICE_PREVIEW_TEXT)
        again, reused2 = audio.ensure_voice_preview(self.db, "VOICE_F_CALM")
        self.assertTrue(reused2)
        self.assertEqual(again["audioAssetId"], item["audioAssetId"])
        self.assertEqual(len(self.providers.tts), 1)
        listed = {v["voiceId"]: v for v in audio.voice_registry_with_previews(self.db)}
        self.assertEqual(listed["VOICE_F_CALM"]["previewUrl"], item["url"])
        self.assertEqual(len(self.providers.tts), 1)

    # --- Narration -------------------------------------------------------
    def test_e_f_new_scene_pending_then_ready_asset(self) -> None:
        config = self._config()
        scenes = [_scene(1), _scene(2)]
        self.assertEqual(cs.scene_narration_state(scenes[0], config)["status"], "PENDING_TTS")
        row = self._artifact("CT-a", scenes, config)
        summary = audio.generate_artifact_narration(self.db, row)
        self.assertEqual((summary["ttsCalls"], summary["generated"], summary["reused"], summary["failed"]), (2, 2, 0, 0))
        out = self._scenes(row)
        for scene in out:
            ref = scene["narration_audio"]
            self.assertEqual(cs.scene_narration_state(scene, config)["status"], "READY")
            self.assertTrue(ref["url"].startswith("/content/assets/files/shorts_tts_CT-a_"))
            self.assertEqual(ref["durationMs"], 3000)
            self.assertTrue(ref["aiGenerated"] and ref["disclosureRequired"])
            asset = self.db.get(ContentSkuAsset, ref["audioAssetId"])
            meta = json.loads(asset.analysis_json)
            self.assertEqual(asset.sku_id, audio.NARRATION_SKU)
            self.assertEqual(meta["textHash"], cs.text_hash(scene["voice_over"]))
            self.assertEqual(meta["generationKey"], ref["generationKey"])
            self.assertEqual(meta["artifactId"], "CT-a")
            self.assertEqual(meta["sceneOrder"], scene["order"])
            self.assertTrue(meta["aiGeneratedVoice"])
            with wave.open(asset.file_path, "rb") as w:
                self.assertEqual(round(w.getnframes() / w.getframerate(), 2), 3.0)
        self.assertIn("Read the input text exactly as written", self.providers.tts[0]["instructions"])
        self.assertEqual(self.providers.tts[0]["voice"], "shimmer")

    def test_g_same_text_voice_tone_reuses_across_artifacts(self) -> None:
        config = self._config()
        audio.generate_artifact_narration(self.db, self._artifact("CT-a", [_scene(1)], config))
        calls = len(self.providers.tts)
        second = self._artifact("CT-b", [_scene(1, subtitle="다른 자막")], config)
        summary = audio.generate_artifact_narration(self.db, second)
        self.assertEqual((summary["ttsCalls"], summary["reused"]), (0, 1))
        self.assertEqual(len(self.providers.tts), calls)
        again = audio.generate_artifact_narration(self.db, second)
        self.assertEqual((again["ttsCalls"], again["readyKept"]), (0, 1))

    def test_h_i_text_voice_tone_model_profile_changes_make_stale(self) -> None:
        config = self._config()
        row = self._artifact("CT-a", [_scene(1)], config)
        audio.generate_artifact_narration(self.db, row)
        scene = self._scenes(row)[0]
        edited = dict(scene, voice_over="바뀐 내레이션입니다.", spoken_script="바뀐 내레이션입니다.")
        state = cs.scene_narration_state(edited, config)
        self.assertEqual(state["status"], "STALE")
        self.assertEqual(state["changed"], ["text"])
        self.assertEqual(cs.scene_narration_state(scene, self._config(voice="VOICE_M_PRO"))["changed"], ["voice"])
        self.assertEqual(cs.scene_narration_state(scene, self._config(tone="EXPERT"))["changed"], ["tone"])
        for field, value in (("model", "gpt-tts-next"), ("instructionProfileVersion", "shorts_tts_instr_v2")):
            saved = cs.TTS_PROVIDER_CONFIG[field]
            cs.TTS_PROVIDER_CONFIG[field] = value
            try:
                self.assertEqual(cs.scene_narration_state(scene, config)["status"], "STALE")
            finally:
                cs.TTS_PROVIDER_CONFIG[field] = saved

    def test_j_k_subtitle_highlight_visual_music_edits_keep_ready(self) -> None:
        config = self._config()
        row = self._artifact("CT-a", [_scene(1)], config)
        audio.generate_artifact_narration(self.db, row)
        scene = self._scenes(row)[0]
        for patch in ({"caption": "새 자막", "subtitle": "새 자막"}, {"highlight_keywords": ["새"]}, {"visual_prompt": "새 연출", "visual_asset": {"assetId": "x", "url": "/content/images/x.png", "source": "AI_GENERATED"}}):
            self.assertEqual(cs.scene_narration_state(dict(scene, **patch), config)["status"], "READY", patch)
        music_config = self._config(mood="UPBEAT")
        self.assertEqual(cs.scene_narration_state(scene, music_config)["status"], "READY")

    def test_single_scene_force_regenerate_and_failure_without_retry(self) -> None:
        config = self._config()
        row = self._artifact("CT-a", [_scene(1), _scene(2)], config)
        audio.generate_artifact_narration(self.db, row)
        before = self._scenes(row)
        summary = audio.generate_artifact_narration(self.db, row, scene_orders=[2], force=True)
        self.assertEqual((summary["planned"], summary["ttsCalls"], summary["generated"]), (1, 1, 1))
        after = self._scenes(row)
        self.assertEqual(after[0]["narration_audio"]["audioAssetId"], before[0]["narration_audio"]["audioAssetId"])
        self.assertNotEqual(after[1]["narration_audio"]["audioAssetId"], before[1]["narration_audio"]["audioAssetId"])

        self.providers.tts_error = "openai_tts_error:500:boom"
        failing = self._artifact("CT-f", [_scene(9, text="실패할 문장입니다.")], config)
        calls = len(self.providers.tts)
        result = audio.generate_artifact_narration(self.db, failing)
        self.assertEqual((result["ttsCalls"], result["failed"]), (1, 1))
        self.assertEqual(len(self.providers.tts), calls + 1)
        self.assertEqual(cs.scene_narration_state(self._scenes(failing)[0], config)["status"], "FAILED")

    def test_timing_fit_and_overflow(self) -> None:
        self.assertEqual(cs.narration_timing(4300, 5)["timingStatus"], "FIT")
        self.assertEqual(cs.narration_timing(5000, 5)["timingStatus"], "FIT")
        overflow = cs.narration_timing(6700, 5)
        self.assertEqual((overflow["timingStatus"], overflow["reviewCode"], overflow["gapMs"]), ("OVERFLOW", "TIMING_REVIEW_REQUIRED", -1700))
        self.providers.tts_seconds = 6.7
        config = self._config()
        row = self._artifact("CT-long", [_scene(1, sec=5)], config)
        audio.generate_artifact_narration(self.db, row)
        plan = cs.build_render_plan(config, self._scenes(row))
        entry = plan["audioPlan"]["narration"][0]
        self.assertEqual((entry["timingStatus"], entry["reviewRequired"], entry["durationMs"]), ("OVERFLOW", True, 6700))
        self.assertEqual(plan["audioPlan"]["narrationSummary"]["timingReviewRequired"], 1)

    def test_regeneration_carries_unchanged_narration(self) -> None:
        config = self._config()
        row = self._artifact("CT-a", [_scene(1), _scene(2)], config)
        audio.generate_artifact_narration(self.db, row)
        previous = self._scenes(row)
        regenerated = [_scene(1), _scene(2, text="재생성된 다른 문장입니다.")]
        self.assertEqual(cs.carry_over_narration(regenerated, previous, config), 1)
        self.assertEqual(cs.scene_narration_state(regenerated[0], config)["status"], "READY")
        self.assertEqual(cs.scene_narration_state(regenerated[1], config)["status"], "PENDING_TTS")

    # --- Music -----------------------------------------------------------
    def test_music_generation_persists_mp3_with_metadata(self) -> None:
        preview = audio.music_generation_preview("CALM")
        self.assertIn("no vocals", preview["prompt"])
        self.assertNotIn("in the style of", preview["prompt"].lower())
        self.assertEqual(len(self.providers.lyria), 0)
        item = audio.generate_music_track(self.db, mood="CALM")
        self.assertEqual(len(self.providers.lyria), 1)
        self.assertEqual(item["approvalStatus"], "GENERATED")
        self.assertEqual(item["source"], "GEMINI_LYRIA")
        self.assertEqual(item["model"], "lyria-3-clip-preview")
        self.assertTrue(item["instrumental"])
        self.assertAlmostEqual(item["durationMs"], 30800, delta=60)
        self.assertEqual(item["termsMetadata"]["commercialUseStatus"], "UNVERIFIED")
        self.assertIsNone(item["termsMetadata"]["providerTermsCheckedAt"])
        self.assertTrue(os.path.exists(item["storagePath"]))
        with self.assertRaises(ValueError):
            audio.review_music_track(self.db, item["musicId"], status="FREE_TO_USE")

    def test_l_m_only_production_eligible_tracks_are_used(self) -> None:
        generated = audio.generate_music_track(self.db, mood="CALM")
        self.assertIsNone(self._config()["resolved"]["music"]["trackId"])
        explicit = self._config(track=generated["musicId"])
        self.assertIsNone(explicit["resolved"]["music"]["trackId"])
        self.assertIn("HUMAN_REVIEW_GENERATED", explicit["musicSelectionBlocked"]["blockedReasons"])
        audio.review_music_track(self.db, generated["musicId"], status="APPROVED")
        self.assertIsNone(self._config()["resolved"]["music"]["trackId"])
        self._set_commercial(generated["musicId"], "VERIFIED_ALLOWED")
        self.assertEqual(self._config()["resolved"]["music"]["trackId"], generated["musicId"])
        self.assertEqual(self._config(track=generated["musicId"])["resolved"]["music"]["trackId"], generated["musicId"])
        audio.review_music_track(self.db, generated["musicId"], status="REJECTED")
        self.assertIsNone(self._config()["resolved"]["music"]["trackId"])
        self.assertIsNone(self._config(track=generated["musicId"])["resolved"]["music"]["trackId"])
        self._eligible_track(mood="UPBEAT")
        self.assertIsNone(self._config(mood="CALM")["resolved"]["music"]["trackId"])

    def test_i_to_n_music_eligibility_matrix(self) -> None:
        def track(approval: str, commercial: str, duration_ms: int = 30800, url: str | None = "/content/assets/files/x.mp3") -> dict[str, Any]:
            return {"musicId": "m", "approvalStatus": approval, "url": url, "durationMs": duration_ms, "termsMetadata": {"commercialUseStatus": commercial}}

        def eligible(t: dict[str, Any]) -> bool:
            return cs.music_eligibility(t, required_duration_ms=30000)["eligible"]

        self.assertFalse(eligible(track("APPROVED", "UNVERIFIED")))
        self.assertTrue(eligible(track("APPROVED", "VERIFIED_ALLOWED")))
        self.assertFalse(eligible(track("GENERATED", "VERIFIED_ALLOWED")))
        self.assertFalse(eligible(track("REJECTED", "VERIFIED_ALLOWED")))
        self.assertFalse(eligible(track("DISABLED", "VERIFIED_ALLOWED")))
        self.assertFalse(eligible(track("APPROVED", "NOT_ALLOWED")))
        self.assertFalse(eligible(track("APPROVED", "VERIFIED_RESTRICTED")))
        self.assertFalse(eligible(track("APPROVED", "VERIFIED_ALLOWED", url=None)))
        short = cs.music_eligibility(track("APPROVED", "VERIFIED_ALLOWED", duration_ms=25365), required_duration_ms=30000)
        self.assertEqual((short["eligible"], short["durationStatus"], short["shortfallMs"]), (False, "MUSIC_EXTENSION_REQUIRED", 4635))
        self.assertIn("MUSIC_EXTENSION_REQUIRED", short["blockedReasons"])
        self.assertTrue(cs.music_eligibility(track("APPROVED", "VERIFIED_ALLOWED", duration_ms=25365), required_duration_ms=15000)["eligible"])
        self.assertEqual(cs.music_duration_status(30772, 30000)["durationStatus"], "MUSIC_LONG_ENOUGH")
        self.assertEqual(cs.music_duration_status(30000, 30000)["durationStatus"], "MUSIC_DURATION_FIT")
        self.assertEqual(cs.music_duration_status(None, 30000)["durationStatus"], "MUSIC_DURATION_UNKNOWN")
        self.assertEqual(cs.music_commercial_status({"termsMetadata": {}}), "UNVERIFIED")
        both = track("APPROVED", "UNVERIFIED")
        status = cs.music_eligibility(both, required_duration_ms=30000)
        self.assertEqual((status["humanReviewStatus"], status["commercialUseStatus"]), ("APPROVED", "UNVERIFIED"))
        self.assertEqual(cs.rank_music_tracks([dict(both, moodTags=["CALM"])], mood="CALM"), [])

    def test_short_track_excluded_from_30s_recommendation(self) -> None:
        self.providers.music_seconds = 25.4
        short = self._eligible_track(mood="CALM")
        self.assertIsNone(self._config()["resolved"]["music"]["trackId"])
        raw = {"mode": "CUSTOM", "duration": 15, "music": {"mood": "CALM"}}
        fifteen = cs.resolve_shorts_config(raw, hint={}, music_library=audio.music_library(self.db))
        self.assertEqual(fifteen["resolved"]["music"]["trackId"], short["musicId"])

    def test_unverified_track_cannot_be_assigned_to_shorts(self) -> None:
        track = audio.generate_music_track(self.db, mood="CALM")
        audio.review_music_track(self.db, track["musicId"], status="APPROVED")
        row = self._artifact("CT-u", [_scene(1)], self._config())
        with self.assertRaises(ValueError) as ctx:
            audio.set_artifact_music(self.db, row, music_id=track["musicId"])
        self.assertIn("COMMERCIAL_USE_UNVERIFIED", str(ctx.exception))
        self.db.refresh(row)
        self.assertIsNone(json.loads(row.body_json)["shorts_generation_config"]["resolved"]["music"]["trackId"])
        self.assertEqual(audio.get_music_track(self.db, track["musicId"])["usageCount"], 0)
        listed = audio.music_library(self.db, required_duration_ms=30000)[0]
        self.assertEqual(listed["eligibility"]["blockedReasons"], ["COMMERCIAL_USE_UNVERIFIED"])
        self.assertEqual(listed["approvalStatus"], "APPROVED")
        self.assertEqual(listed["termsMetadata"]["commercialUseStatus"], "UNVERIFIED")

    def test_ranking_is_deterministic_and_balances_usage(self) -> None:
        self._eligible_track(mood="CALM", variant=1)
        self._eligible_track(mood="CALM", variant=2)
        first = self._config()["resolved"]["music"]["trackId"]
        self.assertEqual(first, self._config()["resolved"]["music"]["trackId"])
        audio.bump_music_usage(self.db, first)
        second = self._config()["resolved"]["music"]["trackId"]
        self.assertNotEqual(first, second)
        self.assertEqual(len(self.providers.lyria), 2)

    def test_n_o_p_preview_reuse_across_shorts_and_no_tts_impact(self) -> None:
        track = self._eligible_track(mood="PREMIUM")
        lyria_calls = len(self.providers.lyria)
        listed = audio.music_library(self.db)
        self.assertEqual(listed[0]["url"], track["url"])
        self.assertEqual(len(self.providers.lyria), lyria_calls)

        config = self._config(mood="CALM")
        row1 = self._artifact("CT-1", [_scene(1)], config)
        row2 = self._artifact("CT-2", [_scene(1)], config)
        audio.generate_artifact_narration(self.db, row1)
        tts_calls = len(self.providers.tts)
        for row in (row1, row2):
            audio.set_artifact_music(self.db, row, music_id=track["musicId"])
        for row in (row1, row2):
            self.db.refresh(row)
            stored = json.loads(row.body_json)["shorts_generation_config"]
            self.assertEqual(stored["resolved"]["music"]["trackId"], track["musicId"])
        self.assertEqual(audio.get_music_track(self.db, track["musicId"])["usageCount"], 2)
        self.assertEqual(len(self.providers.lyria), lyria_calls)
        self.db.refresh(row1)
        body1 = json.loads(row1.body_json)
        self.assertEqual(cs.scene_narration_state(body1["shorts"]["scenes"][0], body1["shorts_generation_config"])["status"], "READY")
        self.assertEqual(len(self.providers.tts), tts_calls)

        plan = cs.build_render_plan(body1["shorts_generation_config"], body1["shorts"]["scenes"], music_track=audio.get_music_track(self.db, track["musicId"]))
        self.assertEqual(plan["audioPlan"]["music"]["status"], "READY")
        self.assertEqual(plan["audioPlan"]["music"]["url"], track["url"])
        self.assertEqual(plan["audioPlan"]["narration"][0]["status"], "READY")
        self.assertTrue(plan["audioPlan"]["narration"][0]["url"].startswith("/content/assets/files/"))
        self.assertEqual(plan["audioPlan"]["mix"], "NOT_RENDERED")
        self.assertNotIn("narration_audio", json.dumps(body1["shorts_generation_config"]))

        audio.set_artifact_music(self.db, row1, music_id=None, disable=True)
        self.db.refresh(row1)
        self.assertFalse(json.loads(row1.body_json)["shorts_generation_config"]["resolved"]["music"]["enabled"])

    def test_estimate_separates_narration_and_music_calls(self) -> None:
        config = self._config()
        row = self._artifact("CT-a", [_scene(1), _scene(2), _scene(3)], config)
        audio.generate_artifact_narration(self.db, row, scene_orders=[1])
        scenes = self._scenes(row)
        scenes[2]["voice_over"] = scenes[2]["spoken_script"] = "고친 문장입니다."
        est = cs.estimate(config, scenes=scenes)["audio"]
        self.assertEqual((est["narrationReused"], est["narrationCalls"], est["musicCalls"], est["newBgmCalls"], est["musicStatus"]), (1, 2, 0, 1, "PENDING_TRACK"))
        self.assertEqual(cs.estimate(config)["ttsCalls"], 0)

    def test_wav_master_fixes_streaming_header_and_mp3_duration(self) -> None:
        fixed, ms = audio.wav_master(fake_wav(2.5))
        self.assertEqual(ms, 2500)
        with wave.open(io.BytesIO(fixed), "rb") as w:
            self.assertEqual(w.getnframes(), 60000)
        self.assertAlmostEqual(audio.mp3_duration_ms(fake_mp3(30.0)) or 0, 30000, delta=60)
        with self.assertRaises(RuntimeError):
            audio.wav_master(b"not audio" * 10)

    # --- Narration timing contract ---------------------------------------
    def test_a_actual_duration_is_authority(self) -> None:
        self.providers.tts_seconds = 4.3
        config = self._config()
        row = self._artifact("CT-t", [_scene(1, sec=3, text="염색 뒤, 머릿결이 낯설게 느껴지죠?")], config)
        audio.generate_artifact_narration(self.db, row)
        scene = self._scenes(row)[0]
        timing = cs.scene_narration_timing(scene, config, 3)
        self.assertEqual((timing["timingAuthority"], timing["actualNarrationDurationMs"], timing["timingStatus"], timing["reviewCode"]), ("ACTUAL", 4300, "OVERFLOW", "TIMING_REVIEW_REQUIRED"))
        self.assertEqual(timing["budget"]["speechChars"], 14)
        self.assertEqual(timing["estimatedNarrationDurationMs"], 3850)
        self.assertEqual((timing["estimationErrorMs"], timing["estimationErrorRatio"]), (-450, round(-450 / 4300, 4)))

    def test_b_no_audio_uses_estimator_only(self) -> None:
        config = self._config()
        timing = cs.scene_narration_timing(_scene(1, sec=7, text="수자타 두피케어는 시카카이열매가루, 한련초잎가루 등 천연허브6종 구성의 가루 팩이에요."), config, 7)
        self.assertEqual((timing["timingAuthority"], timing["actualNarrationDurationMs"], timing["actualTimingStatus"]), ("ESTIMATED", None, "PENDING_MEASUREMENT"))
        self.assertEqual(timing["budget"]["speechChars"], 38)
        self.assertEqual((timing["estimatedNarrationDurationMs"], timing["timingStatus"], timing["reviewCode"]), (8170, "OVERFLOW", "NARRATION_BUDGET_EXCEEDED"))
        self.assertEqual((timing["budget"]["hardTextBudget"], timing["budget"]["preferredTextBudget"], timing["budget"]["budgetStatus"]), (31, 27, "NARRATION_BUDGET_EXCEEDED"))
        self.assertIsNone(timing["estimationErrorMs"])
        empty = cs.scene_narration_timing({"order": 1, "duration_sec": 3}, config, 3)
        self.assertEqual((empty["timingAuthority"], empty["timingStatus"], empty["budget"]["budgetStatus"]), ("NONE", "PENDING_MEASUREMENT", "NO_TEXT"))

    def test_c_d_scene_classification(self) -> None:
        self.assertEqual(cs.classify_narration_duration(3001, 3000), "OVERFLOW")
        self.assertEqual(cs.classify_narration_duration(3000, 3000), "FIT")
        self.assertEqual(cs.classify_narration_duration(1500, 3000), "FIT")
        self.assertEqual(cs.classify_narration_duration(1499, 3000), "SHORT")
        self.assertEqual(cs.classify_narration_duration(None, 3000), "PENDING_MEASUREMENT")
        self.assertFalse(cs.narration_timing(1000, 3)["reviewRequired"])
        self.assertEqual(cs.narration_timing(1000, 3)["timingStatus"], "SHORT")

    def test_e_total_overflow_and_no_timing_mutation(self) -> None:
        durations = [(3, 4.3), (5, 5.6), (7, 8.15), (6, 7.75), (6, 6.8), (3, 4.15)]
        config = self._config()
        scenes = []
        for order, (sec, actual) in enumerate(durations, start=1):
            self.providers.tts_seconds = actual
            row = self._artifact(f"CT-{order}", [_scene(order, sec=sec)], config)
            audio.generate_artifact_narration(self.db, row)
            scenes.append(self._scenes(row)[0])
        before = json.dumps(scenes, sort_keys=True)
        plan = cs.build_render_plan(config, scenes)
        timeline = plan["audioPlan"]["timeline"]
        self.assertEqual((timeline["videoTargetDurationMs"], timeline["narrationActualTotalMs"], timeline["totalTimingAuthority"], timeline["totalTimingStatus"]), (30000, 36750, "ACTUAL", "OVERFLOW"))
        self.assertEqual((timeline["reservedNonSpeechDurationMs"], timeline["policy"], timeline["automaticTimingMutation"]), (0, "INITIAL_ZERO_NOT_MEASURED", "NONE"))
        self.assertEqual([s["durationSec"] for s in plan["scenes"]], [3, 5, 7, 6, 6, 3])
        self.assertEqual(plan["totalDurationSec"], 30)
        self.assertEqual(json.dumps(scenes, sort_keys=True), before)
        self.assertEqual(sum(1 for n in plan["audioPlan"]["narration"] if n["timingStatus"] == "OVERFLOW"), 6)
        mixed = cs.narration_timeline([{"targetSceneDurationMs": 3000, "actualNarrationDurationMs": 2000, "estimatedNarrationDurationMs": 2100}, {"targetSceneDurationMs": 3000, "actualNarrationDurationMs": None, "estimatedNarrationDurationMs": 2500}], 6)
        self.assertEqual((mixed["totalTimingAuthority"], mixed["narrationAuthorityTotalMs"], mixed["narrationActualTotalMs"], mixed["totalActualTimingStatus"]), ("MIXED", 4500, None, "PENDING_MEASUREMENT"))

    def test_f_g_h_edits_and_estimator_recompute(self) -> None:
        config = self._config()
        row = self._artifact("CT-e", [_scene(1, sec=5)], config)
        audio.generate_artifact_narration(self.db, row)
        scene = self._scenes(row)[0]
        base = cs.scene_narration_timing(scene, config, 5)
        sub = cs.scene_narration_timing(dict(scene, caption="자막만 수정", subtitle="자막만 수정"), config, 5)
        self.assertEqual({k: sub[k] for k in ("timingAuthority", "actualNarrationDurationMs", "estimatedNarrationDurationMs", "timingStatus")}, {k: base[k] for k in ("timingAuthority", "actualNarrationDurationMs", "estimatedNarrationDurationMs", "timingStatus")})
        edited = dict(scene, voice_over="대사를 훨씬 더 길게 바꾸면 예상 길이도 다시 계산되어야 합니다.", spoken_script="")
        changed = cs.scene_narration_timing(edited, config, 5)
        self.assertEqual(cs.scene_narration_state(edited, config)["status"], "STALE")
        self.assertEqual((changed["timingAuthority"], changed["actualNarrationDurationMs"]), ("ESTIMATED", None))
        self.assertGreater(changed["estimatedNarrationDurationMs"], base["estimatedNarrationDurationMs"])
        other_voice = self._config(voice="VOICE_M_PRO")
        voiced = cs.scene_narration_timing(scene, other_voice, 5)
        self.assertEqual(cs.scene_narration_state(scene, other_voice)["status"], "STALE")
        self.assertEqual((voiced["budget"]["voiceId"], voiced["budget"]["profileId"], voiced["timingAuthority"]), ("VOICE_M_PRO", "GLOBAL_CONSERVATIVE_PROFILE", "ESTIMATED"))
        self.assertEqual(cs.NARRATION_ESTIMATOR["toneSpecificRate"], "UNKNOWN")


class _FakeResponse:
    def __init__(self, status: int, payload: dict[str, Any]) -> None:
        self.status_code = status
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


class ShortsGeminiVoiceProfileTest(unittest.TestCase):
    def setUp(self) -> None:
        from db import ContentReviewEvent

        self.tmp = tempfile.TemporaryDirectory()
        self._old_dir = os.environ.get("CONTENT_ASSET_DIR")
        os.environ["CONTENT_ASSET_DIR"] = self.tmp.name
        engine = create_engine("sqlite://")
        for table in (ContentSkuAsset.__table__, ContentArtifact.__table__, ContentReviewEvent.__table__):
            table.create(engine)
        self.db = sessionmaker(bind=engine)()
        self.providers = _Providers()
        self.providers.install()
        self.gemini_calls: list[dict[str, Any]] = []
        self.transcribe_calls = 0
        self.heard: str | None = None
        self.gemini_status = 200
        self._saved = (audio.requests.post, audio._api_setting)
        audio._api_setting = lambda db, name: "test-key"
        audio.requests.post = self._post

    def tearDown(self) -> None:
        audio.requests.post, audio._api_setting = self._saved
        self.providers.restore()
        self.db.close()
        if self._old_dir is None:
            os.environ.pop("CONTENT_ASSET_DIR", None)
        else:
            os.environ["CONTENT_ASSET_DIR"] = self._old_dir
        self.tmp.cleanup()

    def _post(self, url: str, **kwargs: Any) -> _FakeResponse:
        if url == cs.GEMINI_TTS_PROVIDER_CONFIG["endpoint"]:
            body = json.loads(kwargs["data"].decode("utf-8"))
            self.gemini_calls.append(body)
            if self.gemini_status != 200:
                return _FakeResponse(self.gemini_status, {"error": {"message": "boom"}})
            data = __import__("base64").b64encode(fake_wav(4.0, streaming_header=False)).decode()
            return _FakeResponse(200, {"id": "int-1", "steps": [{"type": "model_output", "content": [{"type": "audio", "mime_type": "audio/wav", "data": data}]}]})
        if url == audio.TRANSCRIBE_ENDPOINT:
            self.transcribe_calls += 1
            return _FakeResponse(200, {"text": self.heard if self.heard is not None else self._last_text()})
        raise AssertionError(f"unexpected url {url}")

    def _last_text(self) -> str:
        return self.gemini_calls[-1]["input"][0]["content"][0]["text"]

    def _config(self, story: str, voice: str = "AUTO") -> dict[str, Any]:
        return cs.resolve_shorts_config({"mode": "CUSTOM", "duration": 30, "storyType": story, "voice": {"voiceId": voice}, "narrationTone": "REVIEW"}, hint={}, music_library=[])

    def _artifact(self, artifact_id: str, scenes: list[dict[str, Any]], config: dict[str, Any]) -> ContentArtifact:
        body = {"shorts": {"scenes": scenes}, "scenes": scenes, "shorts_generation_config": config}
        row = ContentArtifact(artifact_id=artifact_id, original_artifact_id=artifact_id, sku_id="SKU1", appeal_id="AP1", channel="shorts", title="t", body_json=json.dumps(body, ensure_ascii=False), revision_no=1, source="ai_original", reviewer_status="pending")
        self.db.add(row)
        self.db.commit()
        return row

    def _body(self, row: ContentArtifact) -> dict[str, Any]:
        self.db.refresh(row)
        return json.loads(row.body_json)

    def test_profiles_recommend_primary_only_for_evidence_story_types(self) -> None:
        review = self._config("REAL_REVIEW")["resolved"]["voice"]
        info = self._config("CUSTOMER_PROBLEM_SOLUTION")["resolved"]["voice"]
        self.assertEqual((review["voiceId"], review["profileId"], review["profileRole"], review["selectionSource"]), ("GEMINI_KO_ASSISTANT_7", "REVIEW_PROFILE", "PRIMARY", "AI_RECOMMENDED"))
        self.assertEqual((info["voiceId"], info["profileId"], info["provider"]), ("GEMINI_KO_TRAINING_4", "INFORMATION_PROFILE", "GEMINI"))
        for story in ("PRODUCT_TOP3", "DID_YOU_KNOW", "HOWTO_3STEP", "BUYING_GUIDE"):
            voice = self._config(story)["resolved"]["voice"]
            self.assertEqual((voice["provider"], voice["profileId"]), ("OPENAI", None), story)
        user = self._config("REAL_REVIEW", "GEMINI_KO_STORYTELLER_4")["resolved"]["voice"]
        self.assertEqual((user["profileRole"], user["selectionSource"]), ("SECONDARY", "USER_SELECTED"))
        technical = next(p for p in cs.VOICE_PROFILES if p["id"] == "TECHNICAL_PROFILE")
        self.assertEqual((technical["status"], technical["primary"]), ("DEFERRED", None))
        self.assertEqual(len(cs.VOICES), 6)

    def test_openai_generation_key_unchanged_by_gemini_support(self) -> None:
        config = self._config("CUSTOMER_PROBLEM_SOLUTION", "VOICE_F_CALM")
        scene = _scene(1)
        expected = cs.narration_expectation(config, scene)
        legacy = cs.narration_generation_key(text=scene["voice_over"], voice_id="VOICE_F_CALM", narration_tone="REVIEW", model=cs.TTS_PROVIDER_CONFIG["model"], profile_version=cs.TTS_PROVIDER_CONFIG["instructionProfileVersion"])
        self.assertEqual((expected["provider"], expected["generationKey"]), ("OPENAI", legacy))

    def test_gemini_narration_one_turn_no_style_fidelity_and_reuse(self) -> None:
        config = self._config("REAL_REVIEW")
        row = self._artifact("CT-g", [_scene(1, sec=3), _scene(2, sec=5)], config)
        summary = audio.generate_artifact_narration(self.db, row)
        self.assertEqual((summary["ttsCalls"], summary["generated"], summary["transcribeCalls"], summary["fidelityReviewRequired"]), (2, 2, 2, 0))
        self.assertEqual(len(self.providers.tts), 0)
        sent = self.gemini_calls[0]
        self.assertEqual(sent["model"], "gemini-3.8-flash-tts")
        self.assertEqual(sent["generation_config"]["speech_config"], [{"voice": "ko-kr-assistant-7"}])
        self.assertEqual(len(sent["input"][0]["content"]), 1)
        self.assertNotIn("annotations", sent["input"][0]["content"][0])
        self.assertEqual(sent["input"][0]["content"][0]["text"], "장면 1 내레이션입니다.")
        scenes = self._body(row)["shorts"]["scenes"]
        ref = scenes[0]["narration_audio"]
        self.assertEqual((ref["provider"], ref["providerVoiceId"], ref["stylePolicy"], ref["generationMode"], ref["fidelity"]["status"]), ("GEMINI", "ko-kr-assistant-7", "NO_STYLE_V1", "ONE_TURN", "EXACT"))
        self.assertEqual(cs.scene_narration_state(scenes[0], config)["status"], "READY")
        plan = cs.build_render_plan(config, scenes)
        self.assertEqual(plan["audioPlan"]["narration"][0]["timingStatus"], "OVERFLOW")
        self.assertEqual(plan["audioPlan"]["timeline"]["automaticTimingMutation"], "NONE")
        self.assertEqual((plan["audioPlan"]["voice"]["profileId"], plan["audioPlan"]["voice"]["estimatorApplies"]), ("REVIEW_PROFILE", False))
        other = self._artifact("CT-h", [_scene(1, sec=3)], config)
        again = audio.generate_artifact_narration(self.db, other)
        self.assertEqual((again["ttsCalls"], again["reused"], self.transcribe_calls), (0, 1, 2))

    def test_gemini_key_separates_provider_voice_and_ignores_tone(self) -> None:
        scene = _scene(1)
        a = cs.narration_expectation(self._config("REAL_REVIEW"), scene)
        b = cs.narration_expectation(self._config("REAL_REVIEW", "GEMINI_KO_STORYTELLER_4"), scene)
        tone = self._config("REAL_REVIEW")
        tone["resolved"]["narrationTone"] = "EMPATHY"
        self.assertNotEqual(a["generationKey"], b["generationKey"])
        self.assertEqual(a["generationKey"], cs.narration_expectation(tone, scene)["generationKey"])
        self.assertNotEqual(a["generationKey"], cs.narration_expectation(self._config("REAL_REVIEW", "VOICE_F_BRIGHT"), scene)["generationKey"])

    def test_gemini_failure_is_explicit_without_fallback(self) -> None:
        self.gemini_status = 500
        row = self._artifact("CT-f", [_scene(1)], self._config("REAL_REVIEW"))
        summary = audio.generate_artifact_narration(self.db, row)
        self.assertEqual((summary["failed"], summary["ttsCalls"], len(self.gemini_calls), len(self.providers.tts), self.transcribe_calls), (1, 1, 1, 0, 0))
        self.assertTrue(self._body(row)["shorts"]["scenes"][0]["narration_audio"]["error"].startswith("gemini_tts_error:500"))

    def test_script_integrity_blocks_call_and_fidelity_flags_mutation(self) -> None:
        row = self._artifact("CT-i", [_scene(1, text="태그 <break> 포함 문장")], self._config("REAL_REVIEW"))
        summary = audio.generate_artifact_narration(self.db, row)
        self.assertEqual((summary["failed"], len(self.gemini_calls)), (1, 0))
        self.assertIn("script_integrity_failed:markup_tag", self._body(row)["shorts"]["scenes"][0]["narration_audio"]["error"])
        self.heard = "전혀 다른 내용을 읽었습니다"
        row2 = self._artifact("CT-j", [_scene(1)], self._config("REAL_REVIEW"))
        summary2 = audio.generate_artifact_narration(self.db, row2)
        ref = self._body(row2)["shorts"]["scenes"][0]["narration_audio"]
        self.assertEqual((summary2["generated"], summary2["fidelityReviewRequired"], ref["status"], ref["fidelity"]["reviewRequired"]), (1, 1, "READY", True))
        self.assertEqual(audio.classify_fidelity("헤나 후 머릿결", "헤나 후 머릿결.")[0], "NORMALIZED_MATCH")

    def test_voice_change_creates_child_revision_and_keeps_parent(self) -> None:
        config = self._config("REAL_REVIEW", "VOICE_F_BRIGHT")
        parent = self._artifact("CT-p", [_scene(1)], config)
        audio.generate_artifact_narration(self.db, parent)
        parent_body = self._body(parent)
        child = audio.change_artifact_voice(self.db, parent, voice_id="GEMINI_KO_ASSISTANT_7", actor="tester")
        self.assertNotEqual(child.artifact_id, parent.artifact_id)
        self.assertEqual((child.parent_artifact_id, child.revision_reason, child.reviewer_status), ("CT-p", "voice_change", "draft"))
        self.assertEqual(self._body(parent), parent_body)
        self.assertEqual(parent.reviewer_status, "pending")
        cbody = json.loads(child.body_json)
        voice = cbody["shorts_generation_config"]["resolved"]["voice"]
        self.assertEqual((voice["voiceId"], voice["selectionSource"], voice["profileRole"]), ("GEMINI_KO_ASSISTANT_7", "USER_SELECTED", "PRIMARY"))
        self.assertEqual(cbody["voice_change_lineage"]["previousVoice"]["voiceId"], "VOICE_F_BRIGHT")
        state = cs.scene_narration_state(cbody["shorts"]["scenes"][0], cbody["shorts_generation_config"])
        self.assertEqual(state["status"], "STALE")
        self.assertIn("provider", state["changed"])
        self.assertEqual(len(self.gemini_calls), 0)
        with self.assertRaises(ValueError):
            audio.change_artifact_voice(self.db, child, voice_id="GEMINI_KO_ASSISTANT_7")
        with self.assertRaises(ValueError):
            audio.change_artifact_voice(self.db, child, voice_id="NOT_A_VOICE")

    def test_gemini_voice_preview_generated_once(self) -> None:
        item, reused = audio.ensure_voice_preview(self.db, "GEMINI_KO_TRAINING_4")
        again, reused2 = audio.ensure_voice_preview(self.db, "GEMINI_KO_TRAINING_4")
        self.assertEqual((reused, reused2, len(self.gemini_calls), len(self.providers.tts), self.transcribe_calls), (False, True, 1, 0, 0))
        self.assertEqual(item["audioAssetId"], again["audioAssetId"])
        self.assertEqual(item["provider"], "GEMINI")


if __name__ == "__main__":
    unittest.main()
