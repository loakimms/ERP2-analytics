from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from content_center_engine import _new_id, get_appeal
from content_center_generate import _try_generate_channel_images, generate_channel_payload, reuse_unchanged_channel_images
from content_shorts import carry_over_narration
from db import ContentArtifact, ContentReviewEvent


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _shorts_scene_list(body: dict[str, Any]) -> list[Any]:
    container = body.get("shorts") if isinstance(body.get("shorts"), dict) else body
    scenes = container.get("scenes") if isinstance(container.get("scenes"), list) else body.get("scenes")
    return scenes if isinstance(scenes, list) else []


def _loads(value: str | None) -> dict[str, Any]:
    try:
        data = json.loads(value or "{}")
    except Exception:
        data = {}
    return data if isinstance(data, dict) else {}


def _base_original_id(artifact: ContentArtifact) -> str:
    return str(artifact.original_artifact_id or artifact.artifact_id)


def _next_revision_no(db: Session, original_artifact_id: str) -> int:
    max_revision = (
        db.query(func.max(ContentArtifact.revision_no))
        .filter(ContentArtifact.original_artifact_id == original_artifact_id)
        .scalar()
    )
    return int(max_revision or 1) + 1


def _load_artifact(db: Session, artifact_id: str) -> ContentArtifact:
    artifact = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
    if artifact is None:
        raise ValueError("artifact_not_found")
    if not artifact.original_artifact_id:
        artifact.original_artifact_id = artifact.artifact_id
        artifact.revision_no = artifact.revision_no or 1
    return artifact


def _copy_lineage_fields(source: ContentArtifact, target: ContentArtifact) -> None:
    target.plan_id = source.plan_id
    target.sku_id = source.sku_id
    target.appeal_id = source.appeal_id
    target.topic_id = source.topic_id
    target.channel = source.channel
    target.gfa_run_id = source.gfa_run_id


def save_artifact_draft(
    db: Session,
    *,
    artifact_id: str,
    title: str | None = None,
    body_json: dict[str, Any] | None = None,
    export_text: str | None = None,
    note: str | None = None,
    actor: str | None = None,
    revision_reason: str = "human_edit",
    source: str = "human",
    event_type: str = "draft_saved",
) -> ContentArtifact:
    current = _load_artifact(db, artifact_id)
    original_id = _base_original_id(current)
    current_body = _loads(current.body_json)
    next_body = body_json if body_json is not None else current_body
    next_body.setdefault("revision", {})
    next_body["revision"].update(
        {
            "parent_artifact_id": current.artifact_id,
            "original_artifact_id": original_id,
            "revision_reason": revision_reason,
            "source": source,
        }
    )
    draft = ContentArtifact(
        artifact_id=_new_id("CT"),
        parent_artifact_id=current.artifact_id,
        original_artifact_id=original_id,
        revision_no=_next_revision_no(db, original_id),
        revision_reason=revision_reason,
        source=source,
        is_published_version=False,
        title=str(title if title is not None else current.title or ""),
        body_json=_dumps(next_body),
        export_text=str(export_text if export_text is not None else current.export_text or ""),
        reviewer_status="draft",
    )
    _copy_lineage_fields(current, draft)
    db.add(draft)
    db.add(
        ContentReviewEvent(
            event_id=_new_id("CE"),
            artifact_id=draft.artifact_id,
            event_type=event_type,
            actor=actor,
            note=note,
            payload_json=_dumps({"parent_artifact_id": current.artifact_id, "original_artifact_id": original_id}),
        )
    )
    db.commit()
    db.refresh(draft)
    return draft


def regenerate_artifact_revision(
    db: Session,
    *,
    artifact_id: str,
    prompt_context: str | None = None,
    note: str | None = None,
    actor: str | None = None,
) -> ContentArtifact:
    current = _load_artifact(db, artifact_id)
    original_id = _base_original_id(current)
    current_body = _loads(current.body_json)
    appeal = get_appeal(db, current.appeal_id)
    if appeal is None:
        lineage = current_body.get("lineage") if isinstance(current_body.get("lineage"), dict) else {}
        manual_appeal = lineage.get("manual_appeal") if isinstance(lineage, dict) else None
        if isinstance(manual_appeal, dict):
            appeal = manual_appeal
        else:
            raise ValueError("appeal_not_found")
    previous_artifact = {
        "artifact_id": current.artifact_id,
        "title": current.title,
        "body": current_body,
        "export_text": current.export_text,
        "revision_no": current.revision_no,
    }
    shorts_config = current_body.get("shorts_generation_config") if isinstance(current_body.get("shorts_generation_config"), dict) else None
    payload = generate_channel_payload(
        db,
        appeal=appeal,
        channel=current.channel,
        sku_title="",
        regenerate_instruction=prompt_context,
        previous_artifact=previous_artifact,
        shorts_config=shorts_config,
    )
    if isinstance(current_body.get("lineage"), dict):
        payload["lineage"] = current_body["lineage"]
    if shorts_config is not None:
        payload["shorts_generation_config"] = shorts_config
    artifact_id = _new_id("CT")
    reuse_unchanged_channel_images(payload, channel=current.channel, previous_artifact=previous_artifact)
    if shorts_config is not None:
        carry_over_narration(_shorts_scene_list(payload), _shorts_scene_list(current_body), shorts_config)
    _try_generate_channel_images(db, payload, artifact_id=artifact_id, channel=current.channel, sku_id=current.sku_id)
    payload["revision"] = {
        "parent_artifact_id": current.artifact_id,
        "original_artifact_id": original_id,
        "revision_reason": "user_regenerate",
        "source": "ai",
        "prompt_context": prompt_context,
    }
    regenerated = ContentArtifact(
        artifact_id=artifact_id,
        parent_artifact_id=current.artifact_id,
        original_artifact_id=original_id,
        revision_no=_next_revision_no(db, original_id),
        revision_reason="user_regenerate",
        source="ai",
        is_published_version=False,
        title=str(payload.get("title") or current.title or ""),
        body_json=_dumps(payload),
        export_text=str(payload.get("export_text") or current.export_text or ""),
        reviewer_status="draft",
    )
    _copy_lineage_fields(current, regenerated)
    db.add(regenerated)
    db.add(
        ContentReviewEvent(
            event_id=_new_id("CE"),
            artifact_id=regenerated.artifact_id,
            event_type="regenerated",
            actor=actor,
            note=note,
            payload_json=_dumps({"parent_artifact_id": current.artifact_id, "original_artifact_id": original_id}),
        )
    )
    db.commit()
    db.refresh(regenerated)
    return regenerated
