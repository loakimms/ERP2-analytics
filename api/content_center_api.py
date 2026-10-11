from __future__ import annotations

import json
import os
from datetime import date, datetime
from typing import Any

from fastapi import Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from content_center_engine import get_appeal, list_appeals, run_insight_engine
from content_center_assets import register_content_asset_routes
from content_shorts_audio import get_music_track, music_library, register_shorts_audio_routes
from content_shorts_claims import claim_grounding_for_scenes
from content_shorts_narration_fit import register_shorts_narration_fit_routes
from content_center_generate import artifact_to_dict, generate_artifact, generate_manual_artifact, generate_shorts_artifact, review_artifact
from content_shorts import build_render_plan, build_scene_plan, build_visual_asset, estimate as shorts_estimate, music_eligibility, rank_music_tracks, resolve_shorts_config, scene_visual_prompt, shorts_registry
from content_image_generation import content_image_path, content_image_prompt_for_channel, content_image_size_for_channel, generate_content_image
from content_product_image_reference import append_product_reference_instruction, item_product_image_reference, sku_product_image_reference, uploaded_product_image_reference
from content_gfa_bridge import attribute_gfa_performance, bind_gfa_creative, binding_to_dict
from content_center_learn import (
    PERFORMANCE_METRIC_FIELDS,
    add_publish_link,
    build_manual_performance_extra,
    learning_summary,
    list_publish_management_items,
    record_performance,
)
from content_center_planner import build_today_plan, data_ready_gate, list_today
from content_blog_revalidate import (
    BlogRevalidateAcceptError,
    BlogRevalidateError,
    assert_blog_v2_accept_allowed,
    revalidate_blog_v2_artifact,
)
from content_center_revision import regenerate_artifact_revision, save_artifact_draft
from content_center_scope import list_sku_scope, set_sku_phase1, sku_scope_to_dict, sync_content_sku_scope
from content_center_window import AnalysisMode
from db import ContentAppealEvidence, ContentAppealPoint, ContentArtifact, ContentInsight, ContentPerformanceDaily, ContentPlanItem, ContentSkuAsset, ContentSkuScope


class ContentInsightRunRequest(BaseModel):
    mode: AnalysisMode = AnalysisMode.OPERATING
    phase1_only: bool = True
    as_of: date | None = None
    start_date: date | None = None
    end_date: date | None = None


class ContentPlanRequest(BaseModel):
    as_of: date | None = None


class ContentGenerateRequest(BaseModel):
    plan_id: str | None = None
    sku_id: str | None = None
    appeal_id: str | None = None
    channel: str = Field(default="blog")


class ContentManualGenerateRequest(BaseModel):
    sku_id: str
    channel: str = Field(default="blog")
    appeal_title: str
    additional_context: str | None = None
    attachment_asset_ids: list[str] = Field(default_factory=list)
    actor: str | None = None


class ContentShortsPlanRequest(BaseModel):
    sku_id: str | None = None
    source_type: str | None = None
    appeal_id: str | None = None
    source_artifact_id: str | None = None
    topic_title: str | None = None
    config: dict = Field(default_factory=dict)
    scenes: list[dict] | None = None
    artifact_id: str | None = None


class ContentShortsGenerateRequest(BaseModel):
    source_type: str
    sku_id: str
    appeal_id: str | None = None
    source_artifact_id: str | None = None
    topic_title: str | None = None
    additional_context: str | None = None
    attachment_asset_ids: list[str] = Field(default_factory=list)
    config: dict = Field(default_factory=dict)
    actor: str | None = None


class ContentReviewRequest(BaseModel):
    status: str
    note: str | None = None
    actor: str | None = None


def _manual_attachment_contexts(db: Session, *, sku_id: str, asset_ids: list[str]) -> list[dict]:
    ids = [str(x or "").strip() for x in (asset_ids or []) if str(x or "").strip()]
    if not ids:
        return []
    rows = (
        db.query(ContentSkuAsset)
        .filter(ContentSkuAsset.asset_id.in_(ids))
        .filter(ContentSkuAsset.sku_id == sku_id)
        .all()
    )
    row_by_id = {str(row.asset_id): row for row in rows}
    contexts: list[dict] = []
    text_exts = {".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml", ".log"}
    for asset_id in ids:
        row = row_by_id.get(asset_id)
        if row is None:
            continue
        snippet = ""
        filename = str(row.original_filename or row.filename or "")
        ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
        mime = str(row.mime_type or "").lower()
        if mime.startswith("text/") or ext in text_exts:
            try:
                with open(str(row.file_path or ""), "rb") as f:
                    raw = f.read(12000)
                snippet = raw.decode("utf-8", errors="replace").strip()[:4000]
            except Exception:
                snippet = ""
        contexts.append(
            {
                "asset_id": row.asset_id,
                "original_filename": row.original_filename,
                "filename": row.filename,
                "mime_type": row.mime_type,
                "file_url": row.file_url,
                "snippet": snippet or f"업로드 자료: {filename or row.asset_id}",
            }
        )
    return contexts


class ContentDraftSaveRequest(BaseModel):
    title: str | None = None
    body_json: dict[str, Any] | None = None
    export_text: str | None = None
    note: str | None = None
    actor: str | None = None


class ContentRegenerateRequest(BaseModel):
    prompt_context: str | None = None
    note: str | None = None
    actor: str | None = None


class ContentImageGenerateRequest(BaseModel):
    artifact_id: str
    target: str = Field(default="blog_section")
    section_index: int = Field(default=0, ge=0, le=50)
    prompt: str | None = None
    model: str | None = None
    size: str | None = None
    reference_image_url: str | None = None


class ContentPublishRequest(BaseModel):
    artifact_id: str
    published_url: str
    published_external_id: str | None = None


class ContentPerformanceRequest(BaseModel):
    artifact_id: str
    metric_date: date
    impressions: float | None = None
    clicks: float | None = None
    ctr: float | None = None
    cvr: float | None = None
    saves: float | None = None
    shares: float | None = None
    completion_rate: float | None = None
    purchases: float | None = None
    extra_json: dict[str, Any] | None = None


def _model_fields_set(payload: BaseModel) -> set[str]:
    raw = getattr(payload, "model_fields_set", None)
    if raw is None:
        raw = getattr(payload, "__fields_set__", set())
    return set(raw or set())


def _manual_performance_extra(payload: ContentPerformanceRequest) -> dict[str, Any]:
    fields_set = _model_fields_set(payload)
    metric_values = {key: getattr(payload, key) for key in PERFORMANCE_METRIC_FIELDS}
    return build_manual_performance_extra(metric_values=metric_values, fields_set=fields_set, extra_json=payload.extra_json)


def _performance_to_dict(row: ContentPerformanceDaily) -> dict[str, Any]:
    try:
        extra = json.loads(row.extra_json or "{}")
    except Exception:
        extra = {}
    return {
        "perf_id": row.perf_id,
        "artifact_id": row.artifact_id,
        "appeal_id": row.appeal_id,
        "sku_id": row.sku_id,
        "channel": row.channel,
        "metric_date": row.metric_date.isoformat() if row.metric_date else None,
        "impressions": row.impressions,
        "clicks": row.clicks,
        "ctr": row.ctr,
        "cvr": row.cvr,
        "saves": row.saves,
        "shares": row.shares,
        "completion_rate": row.completion_rate,
        "purchases": row.purchases,
        "extra_json": extra,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


class ContentGfaBindRequest(BaseModel):
    artifact_id: str
    creative_id: str
    campaign_id: str | None = None
    campaign_name: str | None = None
    adgroup_id: str | None = None
    adgroup_name: str | None = None
    creative_name: str | None = None
    bound_by: str | None = None
    note: str | None = None


class ContentGfaAttributeRequest(BaseModel):
    artifact_id: str
    as_of: date | None = None
    observation_days: int = Field(default=3, ge=1, le=30)
    baseline_days: int = Field(default=7, ge=1, le=90)
    force: bool = False


class ContentSkuPhaseRequest(BaseModel):
    sku_id: str
    phase1_enabled: bool


class ContentAppealAdminReviewRequest(BaseModel):
    status: str = Field(default="CLEAR")
    note: str | None = None


class ContentAppealEvidenceExcludeRequest(BaseModel):
    evidence_ids: list[str] = Field(default_factory=list)
    reason: str | None = None


def _content_image_prompt(*, channel: str, prompt: str) -> str:
    return content_image_prompt_for_channel(channel=channel, prompt=prompt)


def _content_image_size(*, channel: str, requested: str | None) -> str | None:
    return content_image_size_for_channel(channel=channel, requested=requested)


def _manual_product_image_reference(value: str | None) -> dict[str, str]:
    return uploaded_product_image_reference(value, source="manual_content_asset_reference")


def _require_product_image_reference(product_reference: dict[str, str]) -> None:
    if str(product_reference.get("product_image_url") or "").strip() or str(product_reference.get("product_image_path") or "").strip():
        return
    raise HTTPException(
        status_code=400,
        detail="product_image_reference_required: 제품 이미지 생성에는 업로드된 제품 사진(asset_type=product_image 또는 /content/assets/files/... 참조)이 필요합니다.",
    )


def register_content_center_routes(app, *, get_db_dep) -> None:
    register_content_asset_routes(app, get_db_dep=get_db_dep)
    register_shorts_audio_routes(app, get_db_dep=get_db_dep)
    register_shorts_narration_fit_routes(app, get_db_dep=get_db_dep)

    @app.post("/content/sku-scope/sync")
    def sync_sku_scope(db: Session = Depends(get_db_dep)):
        return sync_content_sku_scope(db)

    @app.get("/content/sku-scope")
    def get_sku_scope(phase1_only: bool = False, db: Session = Depends(get_db_dep)):
        rows = list_sku_scope(db, phase1_only=phase1_only)
        return {"ok": True, "items": [sku_scope_to_dict(row) for row in rows]}

    @app.patch("/content/sku-scope/phase1")
    def patch_sku_phase1(payload: ContentSkuPhaseRequest, db: Session = Depends(get_db_dep)):
        try:
            row = set_sku_phase1(db, payload.sku_id, payload.phase1_enabled)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "item": sku_scope_to_dict(row)}

    @app.get("/content/data-ready")
    def get_data_ready(db: Session = Depends(get_db_dep)):
        return data_ready_gate(db)

    @app.post("/content/insights/run")
    def run_insights(payload: ContentInsightRunRequest, db: Session = Depends(get_db_dep)):
        if not list_sku_scope(db, phase1_only=False):
            sync_content_sku_scope(db)
        try:
            return run_insight_engine(
                db,
                as_of=payload.as_of,
                mode=payload.mode,
                start_date=payload.start_date,
                end_date=payload.end_date,
                phase1_only=payload.phase1_only,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/content/insights")
    def get_insights(sku_id: str | None = None, db: Session = Depends(get_db_dep)):
        q = db.query(ContentInsight)
        if sku_id:
            q = q.filter(ContentInsight.sku_id == sku_id)
        rows = q.order_by(ContentInsight.updated_at.desc()).all()
        return {
            "ok": True,
            "items": [
                {
                    "insight_id": row.insight_id,
                    "sku_id": row.sku_id,
                    "theme_key": row.theme_key,
                    "problem": row.problem,
                    "desire": row.desire,
                    "barrier": row.barrier,
                    "trend": row.trend,
                    "evidence_count": row.evidence_count,
                    "as_of_date": row.as_of_date.isoformat() if row.as_of_date else None,
                }
                for row in rows
            ],
        }

    @app.get("/content/appeals")
    def get_appeals(sku_id: str | None = None, phase1_only: bool = True, db: Session = Depends(get_db_dep)):
        return {"ok": True, "items": list_appeals(db, sku_id=sku_id, phase1_only=phase1_only)}

    @app.get("/content/appeals/{appeal_id}")
    def get_appeal_detail(appeal_id: str, db: Session = Depends(get_db_dep)):
        item = get_appeal(db, appeal_id)
        if item is None:
            raise HTTPException(status_code=404, detail="appeal_not_found")
        return {"ok": True, "item": item}

    @app.patch("/content/appeals/{appeal_id}/admin-review")
    def patch_appeal_admin_review(appeal_id: str, payload: ContentAppealAdminReviewRequest, db: Session = Depends(get_db_dep)):
        row = db.query(ContentAppealPoint).filter(ContentAppealPoint.appeal_id == appeal_id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="appeal_not_found")
        status = str(payload.status or "").strip().upper()
        if status not in {"CLEAR", "RESET"}:
            raise HTTPException(status_code=400, detail="unsupported_admin_review_status")
        if status == "RESET":
            row.admin_review_status = None
            row.admin_review_note = None
            row.admin_reviewed_at = None
        else:
            row.admin_review_status = "CLEAR"
            row.admin_review_note = payload.note
            row.admin_reviewed_at = datetime.now(row.created_at.tzinfo) if getattr(row, "created_at", None) else datetime.now()
        db.add(row)
        db.commit()
        return {"ok": True, "item": get_appeal(db, appeal_id)}

    @app.post("/content/appeals/{appeal_id}/evidence/exclude")
    def post_appeal_evidence_exclude(appeal_id: str, payload: ContentAppealEvidenceExcludeRequest, db: Session = Depends(get_db_dep)):
        ids = [str(value or "").strip() for value in payload.evidence_ids if str(value or "").strip()]
        if not ids:
            raise HTTPException(status_code=400, detail="evidence_ids_required")
        rows = (
            db.query(ContentAppealEvidence)
            .filter(ContentAppealEvidence.appeal_id == appeal_id, ContentAppealEvidence.evidence_id.in_(ids))
            .all()
        )
        review_rows = [row for row in rows if str(row.source_type or "").strip().lower() == "review"]
        if not review_rows:
            raise HTTPException(status_code=400, detail="review_evidence_not_found")
        now = datetime.now(review_rows[0].created_at.tzinfo) if getattr(review_rows[0], "created_at", None) else datetime.now()
        for row in review_rows:
            row.is_excluded = True
            row.excluded_reason = payload.reason or "관리자가 Evidence 모달에서 review 제외 처리"
            row.excluded_at = now
            db.add(row)
        db.commit()
        return {"ok": True, "excluded": len(review_rows), "item": get_appeal(db, appeal_id)}

    @app.post("/content/plan/today")
    def post_today_plan(payload: ContentPlanRequest | None = None, db: Session = Depends(get_db_dep)):
        return build_today_plan(db, as_of=(payload.as_of if payload else None))

    @app.get("/content/today")
    def get_today(as_of: date | None = Query(default=None), db: Session = Depends(get_db_dep)):
        return list_today(db, as_of=as_of)

    @app.post("/content/artifacts/generate")
    def post_generate(payload: ContentGenerateRequest, db: Session = Depends(get_db_dep)):
        plan = None
        sku_id = payload.sku_id
        appeal_id = payload.appeal_id
        topic_id = None
        sku_title = ""
        if payload.plan_id:
            plan = db.query(ContentPlanItem).filter(ContentPlanItem.plan_id == payload.plan_id).one_or_none()
            if plan is None:
                raise HTTPException(status_code=404, detail="plan_not_found")
            sku_id = plan.sku_id
            appeal_id = plan.appeal_id
            topic_id = plan.topic_id
            payload.channel = plan.channel
        if not sku_id or not appeal_id:
            raise HTTPException(status_code=400, detail="sku_id and appeal_id are required")
        scope = db.query(ContentSkuScope).filter(ContentSkuScope.sku_id == sku_id).one_or_none()
        sku_title = str(getattr(scope, "title", "") or "")
        try:
            artifact = generate_artifact(
                db,
                plan=plan,
                sku_id=sku_id,
                appeal_id=appeal_id,
                channel=payload.channel,
                sku_title=sku_title,
                topic_id=topic_id,
            )
        except ValueError as exc:
            if str(exc).startswith("content_writer_failed:"):
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "item": artifact_to_dict(artifact)}

    @app.post("/content/artifacts/generate-manual")
    def post_generate_manual(payload: ContentManualGenerateRequest, db: Session = Depends(get_db_dep)):
        sku_id = str(payload.sku_id or "").strip()
        if not sku_id:
            raise HTTPException(status_code=400, detail="sku_id_required")
        scope = db.query(ContentSkuScope).filter(ContentSkuScope.sku_id == sku_id).one_or_none()
        sku_title = str(getattr(scope, "title", "") or "")
        attachment_contexts = _manual_attachment_contexts(db, sku_id=sku_id, asset_ids=payload.attachment_asset_ids)
        try:
            artifact = generate_manual_artifact(
                db,
                sku_id=sku_id,
                channel=payload.channel,
                appeal_title=payload.appeal_title,
                additional_context=payload.additional_context or "",
                attachment_contexts=attachment_contexts,
                sku_title=sku_title,
                actor=payload.actor,
            )
        except ValueError as exc:
            if str(exc).startswith("content_writer_failed:"):
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "item": artifact_to_dict(artifact)}

    @app.get("/content/shorts/registry")
    def get_shorts_registry():
        return {"ok": True, "registry": shorts_registry()}

    @app.post("/content/shorts/plan")
    def post_shorts_plan(payload: ContentShortsPlanRequest, db: Session = Depends(get_db_dep)):
        config = payload.config or {}
        hint: dict = {"title": payload.topic_title or ""}
        sku_id = str(payload.sku_id or "").strip()
        library = music_library(db)
        grounding_snapshot = None
        grounding_reviews = None
        grounding_scenes = payload.scenes
        if payload.artifact_id:
            row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == payload.artifact_id).one_or_none()
            body = json.loads(row.body_json or "{}") if row is not None and row.body_json else {}
            grounding_snapshot = body.get("shorts_grounding") if isinstance(body, dict) else None
            grounding_reviews = body.get("shorts_claim_reviews") if isinstance(body, dict) else None
            if payload.scenes is None and isinstance(body, dict):
                stored_shorts = body.get("shorts") if isinstance(body.get("shorts"), dict) else body
                grounding_scenes = stored_shorts.get("scenes") if isinstance(stored_shorts.get("scenes"), list) else None
            stored = body.get("shorts_generation_config") if isinstance(body, dict) else None
            if isinstance(stored, dict) and isinstance(stored.get("resolved"), dict) and not payload.config:
                resolved = stored
            else:
                hint["title"] = getattr(row, "title", "") or ""
                resolved = resolve_shorts_config(config, hint=hint, music_library=library)
            sku_id = sku_id or str(getattr(row, "sku_id", "") or "")
        else:
            source = str(payload.source_type or "").upper()
            if source == "APPEAL" and payload.appeal_id:
                appeal = get_appeal(db, payload.appeal_id) or {}
                hint.update({"title": appeal.get("label") or "", "appeal_text": appeal.get("appeal_text") or "", "review_evidence_count": len([e for e in (appeal.get("evidence") or []) if isinstance(e, dict) and "review" in str(e.get("source_type") or "")])})
            elif source == "ARTIFACT" and payload.source_artifact_id:
                row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == payload.source_artifact_id).one_or_none()
                if row is not None:
                    hint.update({"source_channel": row.channel, "source_title": row.title})
            resolved = resolve_shorts_config(config, hint=hint, music_library=library)
        product_reference = sku_product_image_reference(db, sku_id) if sku_id else {}
        resolved_values = resolved.get("resolved") or {}
        music_values = resolved_values.get("music") or {}
        track_id = music_values.get("trackId")
        track = next((t for t in library if t.get("musicId") == track_id), None) if track_id else None
        required_ms = int(resolved_values.get("duration") or 30) * 1000
        ranked = rank_music_tracks(library, mood=str(music_values.get("mood") or ""), story_type=str(resolved_values.get("storyType") or ""), pace=str(resolved_values.get("pace") or "NORMAL"), required_duration_ms=required_ms) if music_values.get("enabled") and music_values.get("mood") else []
        eligibility = [music_eligibility(t, required_duration_ms=required_ms) for t in library]
        return {
            "ok": True,
            "config": resolved,
            "scene_plan": build_scene_plan(resolved),
            "render_plan": build_render_plan(resolved, payload.scenes, product_reference=product_reference, music_track=track),
            "estimate": shorts_estimate(resolved, scenes=payload.scenes, music_track=track),
            "music_track": track,
            "music_recommendation": ranked[0] if ranked else None,
            "music_library_summary": {
                "total": len(library),
                "humanApproved": sum(1 for e in eligibility if e["humanReviewStatus"] == "APPROVED"),
                "commercialVerifiedAllowed": sum(1 for e in eligibility if e["commercialUseStatus"] == "VERIFIED_ALLOWED"),
                "durationLongEnough": sum(1 for e in eligibility if e["durationStatus"] in ("MUSIC_DURATION_FIT", "MUSIC_LONG_ENOUGH")),
                "eligible": sum(1 for e in eligibility if e["eligible"]),
                "requiredDurationMs": required_ms,
            },
            "claim_grounding": claim_grounding_for_scenes(grounding_scenes, grounding_snapshot, grounding_reviews),
        }

    @app.post("/content/shorts/generate")
    def post_shorts_generate(payload: ContentShortsGenerateRequest, db: Session = Depends(get_db_dep)):
        sku_id = str(payload.sku_id or "").strip()
        if not sku_id:
            raise HTTPException(status_code=400, detail="sku_id_required")
        scope = db.query(ContentSkuScope).filter(ContentSkuScope.sku_id == sku_id).one_or_none()
        sku_title = str(getattr(scope, "title", "") or "")
        attachment_contexts = _manual_attachment_contexts(db, sku_id=sku_id, asset_ids=payload.attachment_asset_ids)
        try:
            artifact = generate_shorts_artifact(
                db,
                source_type=payload.source_type,
                sku_id=sku_id,
                config=payload.config or {},
                appeal_id=payload.appeal_id,
                source_artifact_id=payload.source_artifact_id,
                topic_title=payload.topic_title or "",
                additional_context=payload.additional_context or "",
                attachment_contexts=attachment_contexts,
                sku_title=sku_title,
                actor=payload.actor,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "item": artifact_to_dict(artifact)}

    @app.get("/content/artifacts")
    def get_artifacts(channel: str | None = None, db: Session = Depends(get_db_dep)):
        q = db.query(ContentArtifact)
        if channel:
            q = q.filter(ContentArtifact.channel == channel)
        rows = q.order_by(ContentArtifact.created_at.desc()).limit(80).all()
        return {"ok": True, "items": [artifact_to_dict(row) for row in rows]}

    @app.post("/content/images/generate")
    def post_content_image_generate(payload: ContentImageGenerateRequest, db: Session = Depends(get_db_dep)):
        artifact = db.get(ContentArtifact, str(payload.artifact_id or "").strip())
        if artifact is None:
            raise HTTPException(status_code=404, detail="artifact_not_found")
        channel = str(artifact.channel or "").lower()
        target = str(payload.target or "").strip().lower()
        if (channel, target) not in {("blog", "blog_section"), ("instagram", "instagram_slide"), ("shorts", "shorts_scene")}:
            raise HTTPException(status_code=400, detail="unsupported_content_image_target")
        try:
            body = json.loads(artifact.body_json or "{}")
            if not isinstance(body, dict):
                body = {}
        except Exception:
            body = {}

        container: dict[str, Any]
        items: list[Any]
        item_label: str
        if channel == "blog":
            container = body.get("blog") if isinstance(body.get("blog"), dict) else {}
            items = container.get("sections") if isinstance(container.get("sections"), list) else body.get("sections")
            item_label = "blog_section"
        elif channel == "instagram":
            container = body
            items = body.get("slides") if isinstance(body.get("slides"), list) else []
            item_label = "instagram_slide"
        else:
            container = body.get("shorts") if isinstance(body.get("shorts"), dict) else body
            items = container.get("scenes") if isinstance(container.get("scenes"), list) else body.get("scenes")
            item_label = "shorts_scene"

        if not isinstance(items, list) or payload.section_index >= len(items):
            raise HTTPException(status_code=404, detail=f"{item_label}_not_found")
        item = items[payload.section_index] if isinstance(items[payload.section_index], dict) else {}
        if channel == "shorts":
            prompt = str(payload.prompt or scene_visual_prompt(item) or item.get("caption") or artifact.title or "").strip()
        else:
            prompt = str(
                payload.prompt
                or item.get("image_prompt")
                or item.get("visual_brief")
                or item.get("visual_direction")
                or item.get("visual_asset")
                or item.get("heading")
                or artifact.title
                or ""
            ).strip()
        product_reference = (
            _manual_product_image_reference(payload.reference_image_url)
            or item_product_image_reference(item)
            or sku_product_image_reference(db, artifact.sku_id)
        )
        _require_product_image_reference(product_reference)
        final_prompt = _content_image_prompt(channel=channel, prompt=prompt)
        reference_url = product_reference.get("product_image_url") or ""
        final_prompt = append_product_reference_instruction(final_prompt, product_reference=product_reference)
        try:
            generated = generate_content_image(
                db,
                prompt=final_prompt,
                prefix=f"content_{channel}_{artifact.artifact_id}_{payload.section_index + 1}",
                model=payload.model,
                size=_content_image_size(channel=channel, requested=payload.size),
                reference_image_url=reference_url or None,
                reference_image_path=product_reference.get("product_image_path") or None,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        item["image_prompt"] = prompt
        item["image_generation_model"] = generated["model"]
        item["product_image_reference_url"] = product_reference.get("product_image_url") or generated.get("reference_image_url") or ""
        item["product_image_reference_path"] = product_reference.get("product_image_path") or generated.get("reference_image_path") or ""
        if product_reference.get("source"):
            item["product_image_reference_source"] = product_reference["source"]
        if channel == "shorts":
            item["visual_prompt"] = prompt
            item["visual_asset"] = build_visual_asset(generated["image_url"], source="AI_GENERATED", prompt=prompt, model=generated.get("model") or "", asset_id=f"content_image:{generated['filename']}" if generated.get("filename") else "")
            item.pop("generated_image", None)
            item.pop("visual_asset_error", None)
            item["visual_status"] = "GENERATED"
        else:
            item["image"] = generated["image_url"]
            item["image_status"] = "GENERATED"
        items[payload.section_index] = item

        if channel == "blog":
            container["sections"] = items
            body["blog"] = container
            body["sections"] = items
        elif channel == "instagram":
            body["slides"] = items
            image_slots = body.get("image_slots") if isinstance(body.get("image_slots"), list) else []
            if payload.section_index < len(image_slots) and isinstance(image_slots[payload.section_index], dict):
                image_slots[payload.section_index]["image_status"] = "GENERATED"
                image_slots[payload.section_index]["image"] = generated["image_url"]
            body["image_slots"] = image_slots
        else:
            container["scenes"] = items
            body["shorts"] = container
            body["scenes"] = items
        artifact.body_json = json.dumps(body, ensure_ascii=False)
        artifact.updated_at = datetime.now(artifact.created_at.tzinfo) if artifact.created_at else datetime.now()
        db.add(artifact)
        db.commit()
        db.refresh(artifact)
        return {"ok": True, "image": generated, "item": artifact_to_dict(artifact)}

    @app.get("/content/images/{filename}")
    def get_content_image(filename: str):
        path = content_image_path(filename)
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=404, detail="content_image_not_found")
        return FileResponse(path)

    @app.get("/content/artifacts/{artifact_id}/export")
    def export_artifact(artifact_id: str, db: Session = Depends(get_db_dep)):
        row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="artifact_not_found")
        try:
            body = json.loads(row.body_json or "{}")
            if not isinstance(body, dict):
                body = {}
        except Exception:
            body = {}
        return {"ok": True, "artifact_id": row.artifact_id, "channel": row.channel, "title": row.title, "body": body, "export_text": row.export_text or ""}

    @app.patch("/content/artifacts/{artifact_id}/review")
    def patch_review(artifact_id: str, payload: ContentReviewRequest, db: Session = Depends(get_db_dep)):
        try:
            if str(payload.status or "").lower() == "accepted":
                row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
                if row is None:
                    raise HTTPException(status_code=404, detail="artifact_not_found")
                try:
                    body = json.loads(row.body_json or "{}")
                except Exception:
                    body = {}
                if isinstance(body, dict):
                    assert_blog_v2_accept_allowed(body)
            row = review_artifact(db, artifact_id, status=payload.status, note=payload.note, actor=payload.actor)
        except BlogRevalidateAcceptError as exc:
            raise HTTPException(status_code=409, detail=str(exc.detail)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "item": artifact_to_dict(row)}

    @app.post("/content/artifacts/{artifact_id}/blog-v2/revalidate")
    def post_blog_v2_revalidate(artifact_id: str, db: Session = Depends(get_db_dep)):
        try:
            result = revalidate_blog_v2_artifact(db, artifact_id)
        except BlogRevalidateError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        row = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="artifact_not_found")
        return {
            "ok": True,
            "item": artifact_to_dict(row),
            "validationRunId": result.get("validationRunId"),
            "status": result.get("status"),
            "validationFreshness": result.get("validationFreshness"),
        }

    @app.post("/content/artifacts/{artifact_id}/drafts")
    def post_save_draft(artifact_id: str, payload: ContentDraftSaveRequest, db: Session = Depends(get_db_dep)):
        try:
            row = save_artifact_draft(
                db,
                artifact_id=artifact_id,
                title=payload.title,
                body_json=payload.body_json,
                export_text=payload.export_text,
                note=payload.note,
                actor=payload.actor,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "item": artifact_to_dict(row)}

    @app.post("/content/artifacts/{artifact_id}/regenerate")
    def post_regenerate(artifact_id: str, payload: ContentRegenerateRequest, db: Session = Depends(get_db_dep)):
        try:
            row = regenerate_artifact_revision(
                db,
                artifact_id=artifact_id,
                prompt_context=payload.prompt_context,
                note=payload.note,
                actor=payload.actor,
            )
        except ValueError as exc:
            if str(exc).startswith("content_writer_failed:"):
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "item": artifact_to_dict(row)}

    @app.post("/content/publish-links")
    def post_publish_link(payload: ContentPublishRequest, db: Session = Depends(get_db_dep)):
        try:
            row = add_publish_link(
                db,
                artifact_id=payload.artifact_id,
                published_url=payload.published_url,
                published_external_id=payload.published_external_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {
            "ok": True,
            "item": {
                "link_id": row.link_id,
                "artifact_id": row.artifact_id,
                "published_url": row.published_url,
                "posted_at": row.posted_at.isoformat() if row.posted_at else None,
            },
        }

    @app.get("/content/publish-links")
    def get_publish_links(
        channel: str | None = None,
        management_status: str | None = None,
        artifact_id: str | None = None,
        db: Session = Depends(get_db_dep),
    ):
        return list_publish_management_items(
            db,
            channel=channel,
            management_status=management_status,
            artifact_id=artifact_id,
        )

    @app.post("/content/performance")
    def post_performance(payload: ContentPerformanceRequest, db: Session = Depends(get_db_dep)):
        try:
            return record_performance(
                db,
                artifact_id=payload.artifact_id,
                metric_date=payload.metric_date,
                impressions=payload.impressions,
                clicks=payload.clicks,
                ctr=payload.ctr,
                cvr=payload.cvr,
                saves=payload.saves,
                shares=payload.shares,
                completion_rate=payload.completion_rate,
                purchases=payload.purchases,
                extra_json=_manual_performance_extra(payload),
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/content/performance")
    def get_performance(
        artifact_id: str | None = None,
        appeal_id: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
        db: Session = Depends(get_db_dep),
    ):
        q = db.query(ContentPerformanceDaily)
        if artifact_id:
            q = q.filter(ContentPerformanceDaily.artifact_id == artifact_id)
        if appeal_id:
            q = q.filter(ContentPerformanceDaily.appeal_id == appeal_id)
        rows = q.order_by(ContentPerformanceDaily.metric_date.desc(), ContentPerformanceDaily.created_at.desc()).limit(limit).all()
        return {"ok": True, "items": [_performance_to_dict(row) for row in rows]}

    @app.post("/content/gfa/bindings")
    def post_gfa_binding(payload: ContentGfaBindRequest, db: Session = Depends(get_db_dep)):
        try:
            row = bind_gfa_creative(
                db,
                artifact_id=payload.artifact_id,
                creative_id=payload.creative_id,
                campaign_id=payload.campaign_id,
                campaign_name=payload.campaign_name,
                adgroup_id=payload.adgroup_id,
                adgroup_name=payload.adgroup_name,
                creative_name=payload.creative_name,
                bound_by=payload.bound_by,
                note=payload.note,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "item": binding_to_dict(row)}

    @app.post("/content/gfa/attribute")
    def post_gfa_attribute(payload: ContentGfaAttributeRequest, db: Session = Depends(get_db_dep)):
        try:
            return attribute_gfa_performance(
                db,
                artifact_id=payload.artifact_id,
                as_of=payload.as_of,
                observation_days=payload.observation_days,
                baseline_days=payload.baseline_days,
                force=payload.force,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/content/learning")
    def get_learning(db: Session = Depends(get_db_dep)):
        return learning_summary(db)
