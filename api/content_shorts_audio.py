from __future__ import annotations

import base64
import copy
import difflib
import hashlib
import io
import json
import os
import re
import struct
import uuid
import wave
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import Body, Depends, HTTPException
from sqlalchemy.orm import Session

from content_center_assets import content_asset_dir
from content_center_engine import _new_id
from content_shorts import (
    ALL_VOICES,
    GEMINI_TTS_PROVIDER_CONFIG,
    MUSIC_APPROVAL_STATUSES,
    MUSIC_MOOD_PROFILES,
    MUSIC_PROVIDER_CONFIG,
    TTS_PROVIDER_CONFIG,
    VOICE_PREVIEW_TEXT,
    VOICE_PREVIEW_TONE,
    VOICE_PROFILE_ROLE_LABELS,
    VOICE_PROFILES,
    STORY_TYPES,
    gemini_generation_key,
    music_eligibility,
    music_prompt,
    narration_generation_key,
    narration_timing,
    resolved_voice,
    scene_narration_state,
    text_hash,
    tts_instructions,
    voice_provider,
)
from db import ContentArtifact, ContentSkuAsset
from settings_store import get_api_settings

# Audio assets reuse the shared content_sku_asset table (no schema change).
# Sentinel sku ids keep them out of every per-SKU product/detail asset list.
VOICE_PREVIEW_SKU, VOICE_PREVIEW_TYPE = "__shorts_voice_preview__", "shorts_voice_preview"
NARRATION_SKU, NARRATION_TYPE = "__shorts_narration__", "shorts_narration_audio"
MUSIC_SKU, MUSIC_TYPE = "__shorts_music_library__", "shorts_music_track"

_VOICE_BY_ID = {v["voiceId"]: v for v in ALL_VOICES}
TRANSCRIBE_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions"
TRANSCRIBE_MODEL = "gpt-4o-transcribe"
FIDELITY_OK_STATUSES = ("EXACT", "NORMALIZED_MATCH")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _api_setting(db: Session, name: str) -> str:
    value = str(get_api_settings(db, [name]).get(name, "") or "").strip()
    return value or str(os.getenv(name) or "").strip()


def _meta(row: ContentSkuAsset) -> dict[str, Any]:
    try:
        value = json.loads(row.analysis_json or "{}")
    except Exception:
        value = {}
    return value if isinstance(value, dict) else {}


def _file_ok(row: ContentSkuAsset | None) -> bool:
    return bool(row is not None and row.file_path and os.path.exists(row.file_path) and os.path.getsize(row.file_path) > 0)


def _store_file(data: bytes, *, prefix: str, ext: str) -> tuple[str, str, str]:
    filename = f"{prefix}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(content_asset_dir(), filename)
    with open(path, "wb") as f:
        f.write(data)
    return filename, path, f"/content/assets/files/{filename}"


def _register(db: Session, *, asset_id: str, sku: str, asset_type: str, group_key: str, category: str, keywords: str, filename: str, path: str, url: str, mime: str, status: str, meta: dict[str, Any]) -> ContentSkuAsset:
    row = ContentSkuAsset(
        asset_id=asset_id,
        sku_id=sku,
        asset_type=asset_type,
        asset_group_id=group_key or None,
        category=category or None,
        keywords=keywords or None,
        filename=filename,
        original_filename=filename,
        mime_type=mime,
        file_path=path,
        file_url=url,
        analysis_status=status,
        analysis_json=json.dumps(meta, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------- media parsing

def wav_master(data: bytes) -> tuple[bytes, int]:
    """Return a WAV with corrected RIFF/data sizes plus its real duration in ms.

    Streaming TTS WAV headers can carry placeholder sizes; durations are computed
    from the bytes actually present.
    """
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise RuntimeError("tts_output_not_wav")
    pos = 12
    fmt: tuple[int, int, int] | None = None
    data_start = -1
    while pos + 8 <= len(data):
        chunk_id = data[pos:pos + 4]
        size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = pos + 8
        if chunk_id == b"fmt ":
            channels, rate = struct.unpack("<HI", data[body + 2:body + 8])
            bits = struct.unpack("<H", data[body + 14:body + 16])[0]
            fmt = (channels, rate, bits)
        elif chunk_id == b"data":
            data_start = body
            break
        pos = body + size + (size % 2)
    if fmt is None or data_start < 0:
        raise RuntimeError("tts_output_wav_chunks_missing")
    channels, rate, bits = fmt
    frame_bytes = max(1, channels * (bits // 8))
    pcm = data[data_start:]
    pcm = pcm[: len(pcm) - (len(pcm) % frame_bytes)]
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(bits // 8)
        w.setframerate(rate)
        w.writeframes(pcm)
    fixed = out.getvalue()
    with wave.open(io.BytesIO(fixed), "rb") as r:
        duration_ms = int(round(r.getnframes() * 1000 / r.getframerate()))
    return fixed, duration_ms


_MP3_BITRATES = {
    (3, 1): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    (2, 1): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
_MP3_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def mp3_duration_ms(data: bytes) -> int | None:
    """Sum MPEG audio Layer III frame durations (stdlib only)."""
    pos = 0
    if data[:3] == b"ID3" and len(data) > 10:
        size = (data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F)
        pos = 10 + size
    total = 0.0
    frames = 0
    n = len(data)
    while pos + 4 <= n:
        if data[pos] != 0xFF or (data[pos + 1] & 0xE0) != 0xE0:
            pos += 1
            continue
        b1, b2 = data[pos + 1], data[pos + 2]
        version = (b1 >> 3) & 0x03
        layer = (b1 >> 1) & 0x03
        bitrate_idx = (b2 >> 4) & 0x0F
        rate_idx = (b2 >> 2) & 0x03
        padding = (b2 >> 1) & 0x01
        if version == 1 or layer != 1 or bitrate_idx in (0, 15) or rate_idx == 3:
            pos += 1
            continue
        table = _MP3_BITRATES[(3, 1)] if version == 3 else _MP3_BITRATES[(2, 1)]
        bitrate = table[bitrate_idx] * 1000
        rate = _MP3_RATES[version][rate_idx]
        samples = 1152 if version == 3 else 576
        length = int(samples / 8 * bitrate / rate) + padding
        if length <= 4:
            pos += 1
            continue
        total += samples / rate
        frames += 1
        pos += length
    return int(round(total * 1000)) if frames else None


# ---------------------------------------------------------------- providers

def openai_tts(db: Session, *, text: str, provider_voice: str, instructions: str, model: str) -> bytes:
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")
    resp = requests.post(
        str(TTS_PROVIDER_CONFIG["endpoint"]),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "input": text, "voice": provider_voice, "instructions": instructions, "response_format": TTS_PROVIDER_CONFIG["responseFormat"]},
        timeout=180,
    )
    if int(resp.status_code) != 200:
        raise RuntimeError(f"openai_tts_error:{resp.status_code}:{resp.text[:300]}")
    return resp.content


_MARKUP_TAG = re.compile(r"<[^<>]{1,40}>")


def gemini_tts_payload(*, text: str, provider_voice: str, model: str) -> bytes:
    body = {
        "model": model,
        "input": [{"type": "user_input", "content": [{"type": "text", "text": text}]}],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": provider_voice}]},
    }
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def script_integrity_issues(text: str, payload: bytes) -> list[str]:
    issues = []
    if not text.strip():
        issues.append("empty_text")
    if "\ufffd" in text:
        issues.append("replacement_char")
    if _MARKUP_TAG.search(text):
        issues.append("markup_tag")
    content = json.loads(payload.decode("utf-8"))["input"][0]["content"]
    if len(content) != 1:
        issues.append("not_one_turn")
    elif content[0].get("text") != text:
        issues.append("payload_text_mismatch")
    elif "annotations" in content[0]:
        issues.append("style_annotation_present")
    return issues


def gemini_tts(db: Session, *, payload: bytes) -> dict[str, Any]:
    key = _api_setting(db, "GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    resp = requests.post(
        str(GEMINI_TTS_PROVIDER_CONFIG["endpoint"]),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        data=payload,
        timeout=180,
    )
    if int(resp.status_code) != 200:
        raise RuntimeError(f"gemini_tts_error:{resp.status_code}:{resp.text[:300]}")
    body = resp.json()
    blocks = [
        block
        for step in body.get("steps") or [] if isinstance(step, dict) and step.get("type") == "model_output"
        for block in step.get("content") or [] if isinstance(block, dict) and block.get("type") == "audio" and block.get("data")
    ]
    if len(blocks) != 1:
        raise RuntimeError(f"gemini_tts_error:audio_blocks_{len(blocks)}")
    return {
        "audio": base64.b64decode(str(blocks[0]["data"])),
        "mime": str(blocks[0].get("mime_type") or blocks[0].get("mimeType") or ""),
        "interactionId": str(body.get("id") or ""),
        "usage": body.get("usage"),
    }


def _fidelity_norm(text: str) -> str:
    return re.sub(r"[\s.,!?\u00b7\u2026\"'\u201c\u201d\u2018\u2019~\-:;()]", "", text or "")


def classify_fidelity(heard: str, text: str) -> tuple[str, float]:
    if not (heard or "").strip():
        return "NO_SPEECH", 0.0
    if heard.strip() == text.strip():
        return "EXACT", 1.0
    a, b = _fidelity_norm(heard), _fidelity_norm(text)
    if a == b:
        return "NORMALIZED_MATCH", 1.0
    sm = difflib.SequenceMatcher(None, a, b)
    ratio = round(sm.ratio(), 3)
    changed = sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in sm.get_opcodes() if op != "equal")
    if ratio >= 0.9 and changed <= 3:
        return "MINOR_PRONUNCIATION_VARIATION", ratio
    if ratio >= 0.5:
        return "TEXT_MUTATION", ratio
    return "HALLUCINATED_CONTENT", ratio


def transcription_fidelity(db: Session, *, data: bytes, text: str) -> dict[str, Any]:
    """Record-only gate: never blocks, retries or rewrites the approved script."""
    out: dict[str, Any] = {"model": TRANSCRIBE_MODEL, "checkedAt": _now_iso()}
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        return {**out, "status": "TRANSCRIPTION_FAILED", "error": "OPENAI_API_KEY not configured", "reviewRequired": True}
    try:
        resp = requests.post(
            TRANSCRIBE_ENDPOINT,
            headers={"Authorization": f"Bearer {key}"},
            files={"file": ("narration.wav", data, "audio/wav")},
            data={"model": TRANSCRIBE_MODEL, "language": "ko", "response_format": "json"},
            timeout=180,
        )
    except requests.RequestException as exc:
        return {**out, "status": "TRANSCRIPTION_FAILED", "error": f"{type(exc).__name__}:{str(exc)[:200]}", "reviewRequired": True}
    if int(resp.status_code) != 200:
        return {**out, "status": "TRANSCRIPTION_FAILED", "error": f"{resp.status_code}:{resp.text[:200]}", "reviewRequired": True}
    heard = str(resp.json().get("text") or "")
    status, similarity = classify_fidelity(heard, text)
    return {**out, "status": status, "transcription": heard[:1000], "similarity": similarity, "reviewRequired": status not in FIDELITY_OK_STATUSES}


def gemini_lyria(db: Session, *, prompt: str, model: str) -> dict[str, Any]:
    key = _api_setting(db, "GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    resp = requests.post(
        str(MUSIC_PROVIDER_CONFIG["endpoint"]),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        json={"model": model, "input": prompt},
        timeout=420,
    )
    if int(resp.status_code) != 200:
        raise RuntimeError(f"gemini_lyria_error:{resp.status_code}:{resp.text[:300]}")
    body = resp.json()
    audio_b64, mime, texts = "", "", []
    for step in body.get("steps") or []:
        if not isinstance(step, dict) or step.get("type") != "model_output":
            continue
        for block in step.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "audio" and block.get("data"):
                audio_b64 = str(block["data"])
                mime = str(block.get("mime_type") or block.get("mimeType") or "")
            elif block.get("type") == "text" and block.get("text"):
                texts.append(str(block["text"]))
    if not audio_b64:
        raise RuntimeError("gemini_lyria_error:no_audio_block")
    return {"audio": base64.b64decode(audio_b64), "mime": mime or str(MUSIC_PROVIDER_CONFIG["outputMimeType"]), "text": "\n".join(texts)[:4000], "interactionId": str(body.get("id") or "")}


# ---------------------------------------------------------------- voice preview

def voice_preview_key(voice_id: str) -> str:
    if voice_provider(voice_id) == "GEMINI":
        return gemini_generation_key(text=VOICE_PREVIEW_TEXT, voice_id=voice_id)
    return narration_generation_key(text=VOICE_PREVIEW_TEXT, voice_id=voice_id, narration_tone=VOICE_PREVIEW_TONE, model=str(TTS_PROVIDER_CONFIG["model"]), profile_version=str(TTS_PROVIDER_CONFIG["instructionProfileVersion"]))


def _find_by_key(db: Session, *, asset_type: str, key: str) -> ContentSkuAsset | None:
    rows = db.query(ContentSkuAsset).filter(ContentSkuAsset.asset_type == asset_type).filter(ContentSkuAsset.asset_group_id == key).filter(ContentSkuAsset.analysis_status == "READY").order_by(ContentSkuAsset.created_at.asc()).all()
    return next((row for row in rows if _file_ok(row)), None)


def _audio_asset_from_row(row: ContentSkuAsset) -> dict[str, Any]:
    meta = _meta(row)
    meta.update({"audioAssetId": row.asset_id, "url": row.file_url, "mimeType": row.mime_type, "status": row.analysis_status})
    return meta


def voice_registry_with_previews(db: Session) -> list[dict[str, Any]]:
    out = []
    for voice in ALL_VOICES:
        row = _find_by_key(db, asset_type=VOICE_PREVIEW_TYPE, key=voice_preview_key(voice["voiceId"]))
        out.append({**voice, "previewUrl": row.file_url if row else None, "previewAudioAssetId": row.asset_id if row else None})
    return out


def _synthesize(db: Session, *, text: str, voice_id: str, tone: str) -> tuple[bytes, int, dict[str, Any]]:
    voice = _VOICE_BY_ID.get(voice_id)
    if not voice or not voice.get("active"):
        raise RuntimeError(f"voice_not_available:{voice_id}")
    if voice_provider(voice_id) == "GEMINI":
        return _synthesize_gemini(db, text=text, voice=voice, tone=tone)
    model = str(TTS_PROVIDER_CONFIG["model"])
    instructions = tts_instructions(tone, voice_id)
    raw = openai_tts(db, text=text, provider_voice=str(voice["providerVoiceId"]), instructions=instructions, model=model)
    fixed, duration_ms = wav_master(raw)
    meta = {
        "sourceType": TTS_PROVIDER_CONFIG["sourceType"],
        "provider": TTS_PROVIDER_CONFIG["provider"],
        "model": model,
        "voiceId": voice_id,
        "providerVoiceId": voice["providerVoiceId"],
        "narrationTone": tone,
        "instructionProfileVersion": TTS_PROVIDER_CONFIG["instructionProfileVersion"],
        "instructions": instructions,
        "text": text,
        "textHash": text_hash(text),
        "masterFormat": TTS_PROVIDER_CONFIG["masterFormat"],
        "durationMs": duration_ms,
        "aiGenerated": True,
        "aiGeneratedVoice": True,
        "disclosureRequired": True,
        "createdAt": _now_iso(),
    }
    return fixed, duration_ms, meta


def _synthesize_gemini(db: Session, *, text: str, voice: dict[str, Any], tone: str) -> tuple[bytes, int, dict[str, Any]]:
    cfg = GEMINI_TTS_PROVIDER_CONFIG
    model = str(cfg["model"])
    payload = gemini_tts_payload(text=text, provider_voice=str(voice["providerVoiceId"]), model=model)
    issues = script_integrity_issues(text, payload)
    if issues:
        raise RuntimeError("script_integrity_failed:" + ",".join(issues))
    result = gemini_tts(db, payload=payload)
    fixed, duration_ms = wav_master(result["audio"])
    meta = {
        "sourceType": cfg["sourceType"],
        "provider": cfg["provider"],
        "model": model,
        "voiceId": voice["voiceId"],
        "providerVoiceId": voice["providerVoiceId"],
        "requestAdapter": cfg["requestAdapter"],
        "stylePolicy": cfg["stylePolicy"],
        "generationMode": cfg["generationMode"],
        "narrationTone": tone,
        "instructionProfileVersion": cfg["stylePolicy"],
        "text": text,
        "textHash": text_hash(text),
        "requestPayloadSha256": hashlib.sha256(payload).hexdigest(),
        "scriptIntegrity": "PASS",
        "providerMimeType": result["mime"],
        "interactionId": result["interactionId"],
        "usage": result["usage"],
        "masterFormat": cfg["masterFormat"],
        "durationMs": duration_ms,
        "aiGenerated": True,
        "aiGeneratedVoice": True,
        "disclosureRequired": True,
        "createdAt": _now_iso(),
    }
    return fixed, duration_ms, meta


def ensure_voice_preview(db: Session, voice_id: str) -> tuple[dict[str, Any], bool]:
    key = voice_preview_key(voice_id)
    row = _find_by_key(db, asset_type=VOICE_PREVIEW_TYPE, key=key)
    if row is not None:
        return _audio_asset_from_row(row), True
    data, _, meta = _synthesize(db, text=VOICE_PREVIEW_TEXT, voice_id=voice_id, tone=VOICE_PREVIEW_TONE)
    asset_id = _new_id("CA")
    filename, path, url = _store_file(data, prefix=f"shorts_voice_preview_{voice_id.lower()}", ext=".wav")
    meta.update({"generationKey": key, "purpose": "VOICE_PREVIEW"})
    row = _register(db, asset_id=asset_id, sku=VOICE_PREVIEW_SKU, asset_type=VOICE_PREVIEW_TYPE, group_key=key, category=voice_id, keywords="voice_preview", filename=filename, path=path, url=url, mime="audio/wav", status="READY", meta=meta)
    return _audio_asset_from_row(row), False


# ---------------------------------------------------------------- narration

def _narration_ref(row: ContentSkuAsset, *, reused: bool) -> dict[str, Any]:
    meta = _meta(row)
    return {
        "audioAssetId": row.asset_id,
        "url": row.file_url,
        "mimeType": row.mime_type,
        "generationKey": meta.get("generationKey"),
        "textHash": meta.get("textHash"),
        "voiceId": meta.get("voiceId"),
        "narrationTone": meta.get("narrationTone"),
        "model": meta.get("model"),
        "instructionProfileVersion": meta.get("instructionProfileVersion"),
        "provider": meta.get("provider") or TTS_PROVIDER_CONFIG["provider"],
        "providerVoiceId": meta.get("providerVoiceId"),
        "stylePolicy": meta.get("stylePolicy"),
        "generationMode": meta.get("generationMode"),
        "fidelity": meta.get("fidelity"),
        "durationMs": meta.get("durationMs"),
        "status": "READY",
        "reused": reused,
        "aiGenerated": True,
        "disclosureRequired": True,
    }


def _shorts_scenes(body: dict[str, Any]) -> tuple[dict[str, Any], list[Any]]:
    container = body.get("shorts") if isinstance(body.get("shorts"), dict) else body
    scenes = container.get("scenes") if isinstance(container.get("scenes"), list) else body.get("scenes")
    return container, scenes if isinstance(scenes, list) else []


def _load_body(row: ContentArtifact) -> dict[str, Any]:
    try:
        body = json.loads(row.body_json or "{}")
    except Exception:
        body = {}
    return body if isinstance(body, dict) else {}


def _save_body(db: Session, row: ContentArtifact, body: dict[str, Any]) -> None:
    row.body_json = json.dumps(body, ensure_ascii=False)
    row.updated_at = datetime.now(row.created_at.tzinfo) if row.created_at else datetime.now()
    db.add(row)
    db.commit()
    db.refresh(row)


def generate_artifact_narration(db: Session, row: ContentArtifact, *, scene_orders: list[int] | None = None, force: bool = False) -> dict[str, Any]:
    body = _load_body(row)
    config = body.get("shorts_generation_config")
    if not isinstance(config, dict) or not isinstance(config.get("resolved"), dict):
        raise ValueError("shorts_generation_config_required")
    container, scenes = _shorts_scenes(body)
    targets = set(int(x) for x in scene_orders) if scene_orders else None
    summary: dict[str, Any] = {"planned": 0, "ttsCalls": 0, "generated": 0, "reused": 0, "readyKept": 0, "failed": 0, "skipped": 0, "transcribeCalls": 0, "fidelityReviewRequired": 0, "scenes": []}
    for idx, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            summary["skipped"] += 1
            continue
        order = int(scene.get("order") or idx)
        if targets is not None and order not in targets:
            continue
        summary["planned"] += 1
        state = scene_narration_state(scene, config)
        expected = state["expected"]
        if not expected["generationKey"]:
            summary["skipped"] += 1
            continue
        if state["status"] == "READY" and not force:
            summary["readyKept"] += 1
            summary["scenes"].append({"order": order, "result": "READY_KEPT", "audioAssetId": state["asset"]["audioAssetId"]})
            continue
        existing = None if force else _find_by_key(db, asset_type=NARRATION_TYPE, key=expected["generationKey"])
        if existing is not None:
            scene["narration_audio"] = _narration_ref(existing, reused=True)
            summary["reused"] += 1
            summary["scenes"].append({"order": order, "result": "REUSED", "audioAssetId": existing.asset_id})
            continue
        summary["ttsCalls"] += 1
        try:
            data, duration_ms, meta = _synthesize(db, text=expected["text"], voice_id=expected["voiceId"], tone=expected["narrationTone"])
        except RuntimeError as exc:
            scene["narration_audio"] = {"status": "FAILED", "generationKey": expected["generationKey"], "error": str(exc)[:500], "failedAt": _now_iso()}
            summary["failed"] += 1
            summary["scenes"].append({"order": order, "result": "FAILED", "error": str(exc)[:200]})
            continue
        if meta.get("provider") == GEMINI_TTS_PROVIDER_CONFIG["provider"]:
            summary["transcribeCalls"] += 1
            meta["fidelity"] = transcription_fidelity(db, data=data, text=expected["text"])
            if meta["fidelity"]["reviewRequired"]:
                summary["fidelityReviewRequired"] += 1
        asset_id = _new_id("CA")
        filename, path, url = _store_file(data, prefix=f"shorts_tts_{row.artifact_id}_{order}", ext=".wav")
        meta.update({"generationKey": expected["generationKey"], "artifactId": row.artifact_id, "sceneId": f"scene_{order}", "sceneOrder": order, "purpose": "SCENE_NARRATION", **narration_timing(duration_ms, scene.get("duration_sec"))})
        created = _register(db, asset_id=asset_id, sku=NARRATION_SKU, asset_type=NARRATION_TYPE, group_key=expected["generationKey"], category=row.artifact_id, keywords=f"scene_{order}", filename=filename, path=path, url=url, mime="audio/wav", status="READY", meta=meta)
        scene["narration_audio"] = _narration_ref(created, reused=False)
        summary["generated"] += 1
        summary["scenes"].append({"order": order, "result": "GENERATED", "audioAssetId": created.asset_id, "durationMs": duration_ms, "fidelity": (meta.get("fidelity") or {}).get("status")})
    container["scenes"] = scenes
    if container is not body:
        body["shorts"] = container
    body["scenes"] = scenes
    body["narration_generation_summary"] = {k: v for k, v in summary.items() if k != "scenes"} | {"at": _now_iso(), "force": bool(force), "sceneOrders": sorted(targets) if targets else None}
    _save_body(db, row, body)
    return summary


def change_artifact_voice(db: Session, row: ContentArtifact, *, voice_id: str, actor: str = "") -> ContentArtifact:
    """Voice change is a new child revision; the parent's audio, approval and lineage stay untouched."""
    from content_center_revision import save_artifact_draft

    voice = _VOICE_BY_ID.get(str(voice_id or ""))
    if not voice or not voice.get("active"):
        raise ValueError(f"voice_not_available:{voice_id}")
    body = _load_body(row)
    config = body.get("shorts_generation_config")
    if not isinstance(config, dict) or not isinstance(config.get("resolved"), dict):
        raise ValueError("shorts_generation_config_required")
    previous = dict(config["resolved"].get("voice") or {})
    if previous.get("voiceId") == voice["voiceId"]:
        raise ValueError("voice_unchanged")
    child = copy.deepcopy(body)
    child_config = child["shorts_generation_config"]
    resolved = child_config["resolved"]
    resolved["voice"] = resolved_voice(voice["voiceId"], story_type=str(resolved.get("storyType") or ""), selection_source="USER_SELECTED")
    selected = child_config.get("selected") if isinstance(child_config.get("selected"), dict) else {}
    selected["voiceId"] = voice["voiceId"]
    child_config["selected"] = selected
    child_config["aiRecommended"] = [x for x in (child_config.get("aiRecommended") or []) if x != "voiceId"]
    child.pop("narration_generation_summary", None)
    child["voice_change_lineage"] = {
        "parentArtifactId": row.artifact_id,
        "previousVoice": previous,
        "voice": resolved["voice"],
        "changedAt": _now_iso(),
        "actor": actor or "",
    }
    return save_artifact_draft(
        db,
        artifact_id=row.artifact_id,
        body_json=child,
        export_text=row.export_text,
        note=f"voice change {previous.get('voiceId')} -> {voice['voiceId']}",
        actor=actor or None,
        revision_reason="voice_change",
        source="human",
        event_type="voice_changed",
    )


# ---------------------------------------------------------------- music library

def music_asset_from_row(row: ContentSkuAsset) -> dict[str, Any]:
    meta = _meta(row)
    return {
        **meta,
        "musicId": row.asset_id,
        "url": row.file_url if _file_ok(row) else None,
        "storagePath": row.file_path,
        "mimeType": row.mime_type,
        "approvalStatus": row.analysis_status,
    }


def music_library(db: Session, *, statuses: tuple[str, ...] | None = None, required_duration_ms: int | None = None) -> list[dict[str, Any]]:
    q = db.query(ContentSkuAsset).filter(ContentSkuAsset.asset_type == MUSIC_TYPE)
    if statuses:
        q = q.filter(ContentSkuAsset.analysis_status.in_(list(statuses)))
    items = [music_asset_from_row(row) for row in q.order_by(ContentSkuAsset.created_at.asc()).all()]
    if required_duration_ms:
        for item in items:
            item["eligibility"] = music_eligibility(item, required_duration_ms=required_duration_ms)
    return items


def get_music_track(db: Session, music_id: str | None) -> dict[str, Any] | None:
    if not music_id:
        return None
    row = db.get(ContentSkuAsset, str(music_id))
    if row is None or row.asset_type != MUSIC_TYPE:
        return None
    return music_asset_from_row(row)


def music_generation_preview(mood: str, variant: int = 1) -> dict[str, Any]:
    if mood not in MUSIC_MOOD_PROFILES:
        raise ValueError(f"unsupported_music_mood:{mood}")
    return {"mood": mood, "variant": int(variant), "prompt": music_prompt(mood, variant), "model": MUSIC_PROVIDER_CONFIG["model"], "geminiCalls": 1, "expectedDurationSec": MUSIC_PROVIDER_CONFIG["clipDurationSec"]}


def generate_music_track(db: Session, *, mood: str, variant: int = 1, title: str = "", actor: str = "") -> dict[str, Any]:
    preview = music_generation_preview(mood, variant)
    profile = MUSIC_MOOD_PROFILES[mood]
    model = str(MUSIC_PROVIDER_CONFIG["model"])
    result = gemini_lyria(db, prompt=preview["prompt"], model=model)
    data = result["audio"]
    mime = result["mime"] if str(result["mime"]).startswith("audio/") else str(MUSIC_PROVIDER_CONFIG["outputMimeType"])
    ext = ".wav" if "wav" in mime else ".mp3"
    duration_ms = mp3_duration_ms(data) if ext == ".mp3" else wav_master(data)[1]
    asset_id = _new_id("CA")
    filename, path, url = _store_file(data, prefix=f"shorts_music_{mood.lower()}", ext=ext)
    now = _now_iso()
    meta = {
        "source": MUSIC_PROVIDER_CONFIG["source"],
        "provider": MUSIC_PROVIDER_CONFIG["provider"],
        "model": model,
        "title": title or f"{mood.title()} BGM {variant} · {asset_id[-4:]}",
        "prompt": preview["prompt"],
        "promptProfileVersion": MUSIC_PROVIDER_CONFIG["promptProfileVersion"],
        "moodTags": [mood],
        "genreTags": [],
        "energy": profile["energy"],
        "instrumental": True,
        "vocalsRequested": False,
        "recommendedContentTypes": [s["id"] for s in STORY_TYPES],
        "durationMs": duration_ms,
        "fileSize": len(data),
        "usageCount": 0,
        "createdAt": now,
        "generatedAt": now,
        "createdBy": actor or "",
        "providerMetadata": {"interactionId": result.get("interactionId"), "outputText": result.get("text"), "watermark": MUSIC_PROVIDER_CONFIG["watermark"]},
        "termsMetadata": {"providerTermsReference": MUSIC_PROVIDER_CONFIG["termsReference"], "providerTermsCheckedAt": None, "commercialUseStatus": "UNVERIFIED"},
        "reviewHistory": [],
    }
    row = _register(db, asset_id=asset_id, sku=MUSIC_SKU, asset_type=MUSIC_TYPE, group_key="", category=mood, keywords=mood, filename=filename, path=path, url=url, mime=mime, status="GENERATED", meta=meta)
    return music_asset_from_row(row)


def review_music_track(db: Session, music_id: str, *, status: str, note: str = "", actor: str = "") -> dict[str, Any]:
    status0 = str(status or "").upper()
    if status0 not in MUSIC_APPROVAL_STATUSES:
        raise ValueError(f"unsupported_music_status:{status}")
    row = db.get(ContentSkuAsset, str(music_id))
    if row is None or row.asset_type != MUSIC_TYPE:
        raise LookupError("music_not_found")
    meta = _meta(row)
    history = meta.get("reviewHistory") if isinstance(meta.get("reviewHistory"), list) else []
    history.append({"from": row.analysis_status, "to": status0, "note": note[:300], "actor": actor, "at": _now_iso()})
    meta["reviewHistory"] = history[-20:]
    row.analysis_status = status0
    row.analysis_json = json.dumps(meta, ensure_ascii=False)
    row.updated_at = datetime.now(row.created_at.tzinfo) if row.created_at else datetime.now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return music_asset_from_row(row)


def bump_music_usage(db: Session, music_id: str | None) -> None:
    if not music_id:
        return
    row = db.get(ContentSkuAsset, str(music_id))
    if row is None or row.asset_type != MUSIC_TYPE:
        return
    meta = _meta(row)
    meta["usageCount"] = int(meta.get("usageCount") or 0) + 1
    row.analysis_json = json.dumps(meta, ensure_ascii=False)
    db.add(row)
    db.commit()


def set_artifact_music(db: Session, row: ContentArtifact, *, music_id: str | None, disable: bool = False) -> dict[str, Any]:
    body = _load_body(row)
    config = body.get("shorts_generation_config")
    if not isinstance(config, dict) or not isinstance(config.get("resolved"), dict):
        raise ValueError("shorts_generation_config_required")
    resolved = config["resolved"]
    selected = config.get("selected") if isinstance(config.get("selected"), dict) else {}
    music = dict(resolved.get("music") or {})
    previous = music.get("trackId")
    if disable:
        music.update(enabled=False, trackId=None, mood=None)
        selected.update(musicMood="NONE", musicTrackId="AUTO")
    else:
        track = get_music_track(db, music_id)
        if not track:
            raise ValueError("music_track_not_found")
        eligibility = music_eligibility(track, required_duration_ms=int(resolved.get("duration") or 30) * 1000)
        if not eligibility["eligible"]:
            raise ValueError("music_track_not_eligible:" + ",".join(eligibility["blockedReasons"]))
        mood = (track.get("moodTags") or [music.get("mood")])[0]
        music.update(enabled=True, trackId=track["musicId"], mood=mood)
        selected.update(musicMood=mood, musicTrackId=track["musicId"])
    resolved["music"] = music
    config["resolved"] = resolved
    config["selected"] = selected
    config["aiRecommended"] = [x for x in (config.get("aiRecommended") or []) if x not in ("musicTrackId", "musicMood")]
    body["shorts_generation_config"] = config
    _save_body(db, row, body)
    if not disable and music.get("trackId") != previous:
        bump_music_usage(db, music.get("trackId"))
    return config


# ---------------------------------------------------------------- routes

def register_shorts_audio_routes(app, *, get_db_dep) -> None:
    from content_center_generate import artifact_to_dict

    def _artifact(db: Session, artifact_id: str) -> ContentArtifact:
        row = db.get(ContentArtifact, str(artifact_id or "").strip())
        if row is None or str(row.channel or "").lower() != "shorts":
            raise HTTPException(status_code=404, detail="shorts_artifact_not_found")
        return row

    @app.get("/content/shorts/voices")
    def get_shorts_voices(db: Session = Depends(get_db_dep)):
        return {
            "ok": True,
            "voices": voice_registry_with_previews(db),
            "voiceProfiles": VOICE_PROFILES,
            "voiceProfileRoleLabels": VOICE_PROFILE_ROLE_LABELS,
            "previewText": VOICE_PREVIEW_TEXT,
            "provider": {k: TTS_PROVIDER_CONFIG[k] for k in ("provider", "model", "masterFormat")},
            "geminiProvider": {k: GEMINI_TTS_PROVIDER_CONFIG[k] for k in ("provider", "model", "requestAdapter", "stylePolicy", "generationMode", "masterFormat")},
        }

    @app.post("/content/shorts/voices/{voice_id}/preview")
    def post_shorts_voice_preview(voice_id: str, db: Session = Depends(get_db_dep)):
        if voice_id not in _VOICE_BY_ID:
            raise HTTPException(status_code=404, detail="voice_not_found")
        try:
            item, reused = ensure_voice_preview(db, voice_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        gemini = voice_provider(voice_id) == "GEMINI"
        return {"ok": True, "reused": reused, "openaiCalls": 0 if reused or gemini else 1, "geminiCalls": 0 if reused or not gemini else 1, "item": item}

    @app.post("/content/shorts/artifacts/{artifact_id}/voice")
    def post_shorts_artifact_voice(artifact_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        row = _artifact(db, artifact_id)
        try:
            child = change_artifact_voice(db, row, voice_id=str(payload.get("voice_id") or ""), actor=str(payload.get("actor") or ""))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "ttsCalls": 0, "parentArtifactId": row.artifact_id, "revision": artifact_to_dict(child)}

    @app.post("/content/shorts/artifacts/{artifact_id}/narration")
    def post_shorts_narration(artifact_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        row = _artifact(db, artifact_id)
        orders = payload.get("scene_orders")
        try:
            summary = generate_artifact_narration(db, row, scene_orders=[int(x) for x in orders] if isinstance(orders, list) and orders else None, force=bool(payload.get("force")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "summary": summary, "item": artifact_to_dict(row)}

    @app.get("/content/shorts/music")
    def get_shorts_music(status: str | None = None, required_duration_sec: int = 30, db: Session = Depends(get_db_dep)):
        statuses = tuple(s.strip().upper() for s in str(status or "").split(",") if s.strip()) or None
        required_ms = max(1, int(required_duration_sec)) * 1000
        return {"ok": True, "items": music_library(db, statuses=statuses, required_duration_ms=required_ms), "requiredDurationMs": required_ms, "moods": list(MUSIC_MOOD_PROFILES.keys())}

    @app.post("/content/shorts/music/prompt-preview")
    def post_shorts_music_prompt_preview(payload: dict = Body(default_factory=dict)):
        try:
            return {"ok": True, "preview": music_generation_preview(str(payload.get("mood") or "").upper(), int(payload.get("variant") or 1))}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/content/shorts/music/generate")
    def post_shorts_music_generate(payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        try:
            item = generate_music_track(db, mood=str(payload.get("mood") or "").upper(), variant=int(payload.get("variant") or 1), title=str(payload.get("title") or ""), actor=str(payload.get("actor") or ""))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {"ok": True, "geminiCalls": 1, "item": item}

    @app.post("/content/shorts/music/{music_id}/review")
    def post_shorts_music_review(music_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        try:
            item = review_music_track(db, music_id, status=str(payload.get("status") or ""), note=str(payload.get("note") or ""), actor=str(payload.get("actor") or ""))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "item": item}

    @app.post("/content/shorts/artifacts/{artifact_id}/music")
    def post_shorts_artifact_music(artifact_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        row = _artifact(db, artifact_id)
        try:
            config = set_artifact_music(db, row, music_id=payload.get("music_id"), disable=bool(payload.get("disable")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "config": config, "item": artifact_to_dict(row)}
