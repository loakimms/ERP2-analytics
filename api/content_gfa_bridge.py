from __future__ import annotations

import json
import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from content_center_learn import record_performance
from content_center_time import today_kst, now_kst
from db import ContentArtifact, ContentGfaCreativeBinding, ContentPerformanceDaily, NaverGfaDaily


BRIDGE_SOURCE = "gfa_performance_attribution_v1"


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _loads(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _sum_rows(rows: list[NaverGfaDaily]) -> dict[str, float]:
    impressions = sum(float(row.impressions or 0) for row in rows)
    clicks = sum(float(row.clicks or 0) for row in rows)
    conversions = sum(float(row.conversions or 0) for row in rows)
    purchase_conversions = sum(float(row.purchase_conversions or 0) for row in rows)
    revenue = sum(float(row.revenue or row.purchase_revenue or 0) for row in rows)
    cost = sum(float(row.cost or 0) for row in rows)
    ctr = (clicks / impressions * 100.0) if impressions else 0.0
    cvr = (conversions / clicks * 100.0) if clicks else 0.0
    roas = (revenue / cost * 100.0) if cost else 0.0
    return {
        "impressions": impressions,
        "clicks": clicks,
        "conversions": conversions,
        "purchase_conversions": purchase_conversions,
        "revenue": revenue,
        "cost": cost,
        "ctr": ctr,
        "cvr": cvr,
        "roas": roas,
    }


def _active_binding(db: Session, artifact_id: str) -> ContentGfaCreativeBinding | None:
    return (
        db.query(ContentGfaCreativeBinding)
        .filter(
            ContentGfaCreativeBinding.artifact_id == artifact_id,
            ContentGfaCreativeBinding.is_active.is_(True),
        )
        .order_by(ContentGfaCreativeBinding.updated_at.desc(), ContentGfaCreativeBinding.created_at.desc())
        .first()
    )


def bind_gfa_creative(
    db: Session,
    *,
    artifact_id: str,
    creative_id: str,
    campaign_id: str | None = None,
    campaign_name: str | None = None,
    adgroup_id: str | None = None,
    adgroup_name: str | None = None,
    creative_name: str | None = None,
    bound_by: str | None = None,
    note: str | None = None,
) -> ContentGfaCreativeBinding:
    artifact = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
    if artifact is None:
        raise ValueError("artifact_not_found")
    if str(artifact.channel or "").lower() != "gfa":
        raise ValueError("artifact_channel_not_gfa")
    if not bool(artifact.is_published_version):
        raise ValueError("artifact_not_published_revision")
    creative_id0 = str(creative_id or "").strip()
    if not creative_id0:
        raise ValueError("creative_id_required")

    existing = _active_binding(db, artifact_id)
    if existing is None:
        existing = ContentGfaCreativeBinding(binding_id=_new_id("GFB"), artifact_id=artifact_id)
        db.add(existing)
    existing.gfa_run_id = artifact.gfa_run_id
    existing.creative_id = creative_id0
    existing.campaign_id = str(campaign_id or "").strip() or None
    existing.campaign_name = str(campaign_name or "").strip() or None
    existing.adgroup_id = str(adgroup_id or "").strip() or None
    existing.adgroup_name = str(adgroup_name or "").strip() or None
    existing.creative_name = str(creative_name or "").strip() or None
    existing.bound_by = bound_by
    existing.note = note
    existing.is_active = True
    existing.updated_at = now_kst()
    db.commit()
    db.refresh(existing)
    return existing


def binding_to_dict(row: ContentGfaCreativeBinding | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "binding_id": row.binding_id,
        "artifact_id": row.artifact_id,
        "gfa_run_id": row.gfa_run_id,
        "campaign_id": row.campaign_id,
        "campaign_name": row.campaign_name,
        "adgroup_id": row.adgroup_id,
        "adgroup_name": row.adgroup_name,
        "creative_id": row.creative_id,
        "creative_name": row.creative_name,
        "bound_by": row.bound_by,
        "note": row.note,
        "is_active": bool(row.is_active),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _performance_rows(db: Session, *, creative_id: str, start: date, end: date) -> list[NaverGfaDaily]:
    return (
        db.query(NaverGfaDaily)
        .filter(
            NaverGfaDaily.creative_id == creative_id,
            NaverGfaDaily.date >= start,
            NaverGfaDaily.date <= end,
        )
        .all()
    )


def _existing_bridge_performance(
    db: Session,
    *,
    artifact_id: str,
    metric_date: date,
    observation_start: date,
    observation_end: date,
    baseline_start: date,
    baseline_end: date,
) -> ContentPerformanceDaily | None:
    rows = (
        db.query(ContentPerformanceDaily)
        .filter(
            ContentPerformanceDaily.artifact_id == artifact_id,
            ContentPerformanceDaily.channel == "gfa",
            ContentPerformanceDaily.metric_date == metric_date,
        )
        .order_by(ContentPerformanceDaily.created_at.desc())
        .all()
    )
    for row in rows:
        extra = _loads(row.extra_json)
        if (
            extra.get("source") == BRIDGE_SOURCE
            and extra.get("observation_start") == observation_start.isoformat()
            and extra.get("observation_end") == observation_end.isoformat()
            and extra.get("baseline_start") == baseline_start.isoformat()
            and extra.get("baseline_end") == baseline_end.isoformat()
        ):
            return row
    return None


def _record_unknown(
    db: Session,
    *,
    artifact: ContentArtifact,
    metric_date: date,
    reason: str,
    observation_start: date,
    observation_end: date,
    baseline_start: date,
    baseline_end: date,
) -> dict[str, Any]:
    out = record_performance(
        db,
        artifact_id=artifact.artifact_id,
        metric_date=metric_date,
        extra_json={
            "source": BRIDGE_SOURCE,
            "attribution_level": "UNKNOWN",
            "primary_metric": "ctr",
            "sample": 0,
            "confidence": "LOW",
            "observation_complete": True,
            "notes": reason,
            "observation_start": observation_start.isoformat(),
            "observation_end": observation_end.isoformat(),
            "baseline_start": baseline_start.isoformat(),
            "baseline_end": baseline_end.isoformat(),
        },
    )
    out["reason"] = reason
    return out


def attribute_gfa_performance(
    db: Session,
    *,
    artifact_id: str,
    as_of: date | None = None,
    observation_days: int = 3,
    baseline_days: int = 7,
    force: bool = False,
) -> dict[str, Any]:
    as_of = as_of or today_kst()
    observation_days = max(1, int(observation_days or 1))
    baseline_days = max(1, int(baseline_days or 1))
    observation_end = as_of
    observation_start = observation_end - timedelta(days=observation_days - 1)
    baseline_end = observation_start - timedelta(days=1)
    baseline_start = baseline_end - timedelta(days=baseline_days - 1)

    artifact = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
    if artifact is None:
        raise ValueError("artifact_not_found")
    if str(artifact.channel or "").lower() != "gfa":
        raise ValueError("artifact_channel_not_gfa")
    if not bool(artifact.is_published_version):
        raise ValueError("artifact_not_published_revision")

    existing = _existing_bridge_performance(
        db,
        artifact_id=artifact_id,
        metric_date=as_of,
        observation_start=observation_start,
        observation_end=observation_end,
        baseline_start=baseline_start,
        baseline_end=baseline_end,
    )
    if existing is not None and not force:
        return {
            "ok": True,
            "created": False,
            "reused": True,
            "perf_id": existing.perf_id,
            "verdict": _loads(existing.extra_json).get("verdict") or None,
            "extra_json": _loads(existing.extra_json),
        }

    binding = _active_binding(db, artifact_id)
    if binding is None:
        out = _record_unknown(
            db,
            artifact=artifact,
            metric_date=as_of,
            reason="gfa_creative_binding_missing",
            observation_start=observation_start,
            observation_end=observation_end,
            baseline_start=baseline_start,
            baseline_end=baseline_end,
        )
        return {"ok": True, "created": True, "reused": False, "binding": None, **out}

    obs_rows = _performance_rows(db, creative_id=binding.creative_id, start=observation_start, end=observation_end)
    baseline_rows = _performance_rows(db, creative_id=binding.creative_id, start=baseline_start, end=baseline_end)
    obs = _sum_rows(obs_rows)
    baseline = _sum_rows(baseline_rows)
    observed_dates = {row.date for row in obs_rows}
    observation_complete = len(observed_dates) >= observation_days
    attribution_level = "DIRECT" if obs_rows and baseline_rows else "UNKNOWN"
    confidence = "HIGH" if attribution_level == "DIRECT" else "LOW"
    out = record_performance(
        db,
        artifact_id=artifact.artifact_id,
        metric_date=as_of,
        impressions=obs["impressions"],
        clicks=obs["clicks"],
        ctr=obs["ctr"],
        cvr=obs["cvr"],
        purchases=obs["purchase_conversions"],
        extra_json={
            "source": BRIDGE_SOURCE,
            "source_external_id": binding.creative_id,
            "attribution_level": attribution_level,
            "primary_metric": "ctr",
            "primary_value": obs["ctr"],
            "baseline_value": baseline["ctr"] if baseline_rows else None,
            "sample": obs["impressions"],
            "confidence": confidence,
            "observation_complete": observation_complete,
            "observation_start": observation_start.isoformat(),
            "observation_end": observation_end.isoformat(),
            "baseline_start": baseline_start.isoformat(),
            "baseline_end": baseline_end.isoformat(),
            "observation_rows": len(obs_rows),
            "baseline_rows": len(baseline_rows),
            "creative_id": binding.creative_id,
            "campaign_id": binding.campaign_id,
            "adgroup_id": binding.adgroup_id,
            "notes": "DIRECT only when creative_id-level GFA performance rows are matched.",
        },
    )
    extra = _loads(db.query(ContentPerformanceDaily).filter(ContentPerformanceDaily.perf_id == out["perf_id"]).one().extra_json)
    extra["verdict"] = out["verdict"]
    return {"ok": True, "created": True, "reused": False, "binding": binding_to_dict(binding), **out, "extra_json": extra}
