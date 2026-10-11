from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from content_center_channels import is_content_channel, is_legacy_gfa_channel
from content_center_time import now_kst
from content_center_engine import _new_id
from db import ContentAppealPoint, ContentArtifact, ContentGfaCreativeBinding, ContentPerformanceDaily, ContentPublishLink


def _now() -> datetime:
    return now_kst()


MIN_SAMPLE_BY_CHANNEL = {
    "gfa": 1000.0,
    "blog": 30.0,
    "instagram": 300.0,
    "shorts": 500.0,
}
PROMOTE_DELTA_PCT = 10.0
REVISE_DELTA_PCT = -10.0
MAINTAIN_DELTA_ABS_PCT = 5.0
PERFORMANCE_METRIC_FIELDS = ("impressions", "clicks", "ctr", "cvr", "saves", "shares", "completion_rate", "purchases")
MANUAL_PERFORMANCE_EXTRA_ALLOWLIST = {
    "source_type",
    "source_reference",
    "source_url",
    "source_external_id",
    "measured_at",
    "platform",
    "notes",
}


def build_manual_performance_extra(
    *,
    metric_values: dict[str, Any],
    fields_set: set[str],
    extra_json: dict[str, Any] | None,
) -> dict[str, Any]:
    raw_extra = extra_json or {}
    extra = {key: raw_extra.get(key) for key in MANUAL_PERFORMANCE_EXTRA_ALLOWLIST if key in raw_extra}
    extra["source_type"] = str(extra.get("source_type") or "MANUAL").strip().upper() or "MANUAL"

    provided = {key: metric_values.get(key) for key in PERFORMANCE_METRIC_FIELDS if key in fields_set}
    available = {key: value for key, value in provided.items() if value is not None}
    unavailable = [key for key in PERFORMANCE_METRIC_FIELDS if key not in fields_set or metric_values.get(key) is None]
    extra["raw_metrics"] = available
    extra["metric_presence"] = {
        key: "OBSERVED" if key in available else "UNKNOWN"
        for key in PERFORMANCE_METRIC_FIELDS
    }
    extra["unavailable_metrics"] = unavailable
    return extra


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def _loads_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if not raw:
        return {}
    try:
        obj = json.loads(str(raw))
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _bool_contract(value: Any, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "complete", "completed"}


def _min_sample(channel: str) -> float:
    return MIN_SAMPLE_BY_CHANNEL.get(str(channel or "").strip().lower(), 30.0)


def add_publish_link(
    db: Session,
    *,
    artifact_id: str,
    published_url: str,
    published_external_id: str | None = None,
    posted_at: datetime | None = None,
) -> ContentPublishLink:
    artifact = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
    if artifact is None:
        raise ValueError("artifact_not_found")
    original_id = str(artifact.original_artifact_id or artifact.artifact_id)
    db.query(ContentArtifact).filter(ContentArtifact.original_artifact_id == original_id).update(
        {ContentArtifact.is_published_version: False},
        synchronize_session=False,
    )
    artifact.original_artifact_id = original_id
    artifact.is_published_version = True
    artifact.reviewer_status = "published"
    row = ContentPublishLink(
        link_id=_new_id("PB"),
        artifact_id=artifact_id,
        channel=artifact.channel,
        published_url=str(published_url or "").strip(),
        published_external_id=published_external_id,
        posted_at=posted_at or _now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _latest_publish_link(db: Session, artifact_id: str) -> ContentPublishLink | None:
    return (
        db.query(ContentPublishLink)
        .filter(ContentPublishLink.artifact_id == artifact_id)
        .order_by(ContentPublishLink.posted_at.desc(), ContentPublishLink.created_at.desc())
        .first()
    )


def _active_gfa_binding(db: Session, artifact_id: str) -> ContentGfaCreativeBinding | None:
    return (
        db.query(ContentGfaCreativeBinding)
        .filter(ContentGfaCreativeBinding.artifact_id == artifact_id, ContentGfaCreativeBinding.is_active.is_(True))
        .order_by(ContentGfaCreativeBinding.updated_at.desc(), ContentGfaCreativeBinding.created_at.desc())
        .first()
    )


def _latest_performance(db: Session, artifact_id: str) -> ContentPerformanceDaily | None:
    return (
        db.query(ContentPerformanceDaily)
        .filter(ContentPerformanceDaily.artifact_id == artifact_id)
        .order_by(ContentPerformanceDaily.metric_date.desc(), ContentPerformanceDaily.created_at.desc())
        .first()
    )


def _artifact_publish_item(db: Session, artifact: ContentArtifact) -> dict[str, Any] | None:
    publish_link = _latest_publish_link(db, artifact.artifact_id)
    is_ready_to_publish = str(artifact.reviewer_status or "") == "accepted" and publish_link is None
    is_published = publish_link is not None
    if not is_ready_to_publish and not is_published:
        return None

    binding = _active_gfa_binding(db, artifact.artifact_id) if str(artifact.channel or "").lower() == "gfa" else None
    performance = _latest_performance(db, artifact.artifact_id)
    performance_extra = _loads_dict(performance.extra_json if performance else None)
    publish_status = "PUBLISHED" if publish_link is not None else "READY_TO_PUBLISH"
    performance_status = "TRACKING" if performance is not None else ("WAITING" if publish_link is not None else "NOT_STARTED")
    if publish_link is None:
        management_status = "READY_TO_PUBLISH"
    elif performance is not None:
        management_status = "TRACKING"
    elif str(artifact.channel or "").lower() == "gfa" and binding is None:
        management_status = "GFA_WAITING_CREATIVE_ID"
    elif str(artifact.channel or "").lower() == "gfa" and binding is not None:
        management_status = "ATTRIBUTION_READY"
    else:
        management_status = "WAITING_PERFORMANCE"

    return {
        "artifact_id": artifact.artifact_id,
        "original_artifact_id": artifact.original_artifact_id or artifact.artifact_id,
        "revision_no": artifact.revision_no or 1,
        "channel": artifact.channel,
        "sku_id": artifact.sku_id,
        "title": artifact.title,
        "reviewer_status": artifact.reviewer_status,
        "artifact_status": artifact.reviewer_status,
        "is_published_version": bool(artifact.is_published_version),
        "publish_status": publish_status,
        "publish_link_id": publish_link.link_id if publish_link else None,
        "publish_url": publish_link.published_url if publish_link else None,
        "external_id": publish_link.published_external_id if publish_link else None,
        "published_at": publish_link.posted_at.isoformat() if publish_link and publish_link.posted_at else None,
        "gfa_creative_id": binding.creative_id if binding else None,
        "attribution_level": performance_extra.get("attribution_level") if performance_extra else None,
        "performance_status": performance_status,
        "latest_performance_date": performance.metric_date.isoformat() if performance else None,
        "management_status": management_status,
        "status": management_status,
        "legacy_gfa": is_legacy_gfa_channel(artifact.channel),
    }


def list_publish_management_items(
    db: Session,
    *,
    channel: str | None = None,
    management_status: str | None = None,
    artifact_id: str | None = None,
) -> dict[str, Any]:
    q = db.query(ContentArtifact)
    if artifact_id:
        q = q.filter(ContentArtifact.artifact_id == artifact_id)
    if channel:
        q = q.filter(ContentArtifact.channel == channel)
    rows = q.order_by(ContentArtifact.created_at.desc()).limit(200).all()
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    legacy_gfa_count = 0
    for artifact in rows:
        if is_legacy_gfa_channel(artifact.channel):
            legacy_gfa_count += 1
            if not channel:
                continue
        elif not is_content_channel(artifact.channel):
            continue
        item = _artifact_publish_item(db, artifact)
        if item is None:
            continue
        if item["artifact_id"] in seen:
            continue
        seen.add(str(item["artifact_id"]))
        if management_status and str(item.get("management_status")) != management_status:
            continue
        items.append(item)

    counts: dict[str, int] = {
        "READY_TO_PUBLISH": 0,
        "PUBLISHED": 0,
        "GFA_WAITING_CREATIVE_ID": 0,
        "ATTRIBUTION_READY": 0,
        "WAITING_PERFORMANCE": 0,
        "TRACKING": 0,
        "LEGACY_GFA": legacy_gfa_count if not channel else 0,
    }
    for item in items:
        status = str(item.get("management_status") or "")
        if status in counts:
            counts[status] += 1
        if item.get("publish_status") == "PUBLISHED":
            counts["PUBLISHED"] += 1
    return {"ok": True, "items": items, "counts": counts, "legacy_gfa_count": legacy_gfa_count}


def normalize_performance_contract(
    *,
    channel: str,
    impressions: float = 0,
    clicks: float = 0,
    ctr: float = 0,
    cvr: float = 0,
    saves: float = 0,
    shares: float = 0,
    completion_rate: float = 0,
    purchases: float = 0,
    extra_json: dict[str, Any] | str | None = None,
) -> dict[str, Any]:
    extra = _loads_dict(extra_json)
    channel0 = str(channel or extra.get("channel") or "").strip().lower()
    primary_metric = str(extra.get("primary_metric") or "").strip()
    primary_value = _float_or_none(extra.get("primary_value"))
    if primary_value is None and primary_metric:
        metric_values = {
            "impressions": impressions,
            "clicks": clicks,
            "ctr": ctr,
            "cvr": cvr,
            "saves": saves,
            "shares": shares,
            "completion_rate": completion_rate,
            "purchases": purchases,
        }
        primary_value = _float_or_none(metric_values.get(primary_metric))
    baseline_value = _float_or_none(extra.get("baseline_value"))
    delta_pct = _float_or_none(extra.get("delta_pct"))
    if delta_pct is None and primary_value is not None and baseline_value not in (None, 0):
        delta_pct = (primary_value - float(baseline_value)) / abs(float(baseline_value)) * 100.0
    sample = _float_or_none(extra.get("sample"))
    if sample is None:
        sample = float(impressions or clicks or saves or shares or purchases or 0)
    attribution_level = str(extra.get("attribution_level") or "UNKNOWN").strip().upper() or "UNKNOWN"
    confidence = str(extra.get("confidence") or "LOW").strip().upper() or "LOW"
    observation_complete = _bool_contract(
        extra.get("observation_complete", extra.get("observation_window_complete")),
        default=False,
    )
    contract = dict(extra)
    contract.update(
        {
            "channel": channel0,
            "attribution_level": attribution_level,
            "primary_metric": primary_metric,
            "primary_value": primary_value,
            "baseline_value": baseline_value,
            "delta_pct": round(delta_pct, 4) if delta_pct is not None else None,
            "sample": sample,
            "min_sample": _min_sample(channel0),
            "confidence": confidence,
            "observation_complete": observation_complete,
        }
    )
    return contract


def diagnose_performance(
    *,
    ctr: float = 0,
    cvr: float = 0,
    sample: float = 0,
    channel: str = "",
    extra_json: dict[str, Any] | str | None = None,
) -> str:
    contract = normalize_performance_contract(
        channel=channel,
        impressions=sample,
        ctr=ctr,
        cvr=cvr,
        extra_json=extra_json,
    )
    if not contract["observation_complete"]:
        return "OBSERVE"
    attribution = str(contract["attribution_level"])
    if attribution in {"UNKNOWN", "CORRELATION"}:
        return "OBSERVE"
    if float(contract["sample"] or 0) < float(contract["min_sample"] or 0):
        return "OBSERVE"
    if str(contract.get("claim_risk") or "").strip().upper() == "HIGH":
        return "REVISE"
    delta = _float_or_none(contract.get("delta_pct"))
    if delta is None:
        return "OBSERVE"
    if abs(delta) <= MAINTAIN_DELTA_ABS_PCT:
        return "MAINTAIN"
    if delta >= PROMOTE_DELTA_PCT and attribution in {"DIRECT", "ASSISTED"} and str(contract["confidence"]) in {"MEDIUM", "HIGH"}:
        return "PROMOTE"
    if delta <= REVISE_DELTA_PCT:
        return "REVISE"
    return "MAINTAIN"


def record_performance(
    db: Session,
    *,
    artifact_id: str,
    metric_date: date,
    impressions: float = 0,
    clicks: float = 0,
    ctr: float | None = None,
    cvr: float | None = None,
    saves: float = 0,
    shares: float = 0,
    completion_rate: float = 0,
    purchases: float = 0,
    extra_json: dict[str, Any] | str | None = None,
) -> dict[str, Any]:
    artifact = db.query(ContentArtifact).filter(ContentArtifact.artifact_id == artifact_id).one_or_none()
    if artifact is None:
        raise ValueError("artifact_not_found")
    ctr_v = float(ctr) if ctr is not None else (float(clicks) / float(impressions) * 100.0 if impressions else 0.0)
    cvr_v = float(cvr) if cvr is not None else (float(purchases) / float(clicks) * 100.0 if clicks else 0.0)
    contract = normalize_performance_contract(
        channel=artifact.channel,
        impressions=float(impressions or 0),
        clicks=float(clicks or 0),
        ctr=ctr_v,
        cvr=cvr_v,
        saves=float(saves or 0),
        shares=float(shares or 0),
        completion_rate=float(completion_rate or 0),
        purchases=float(purchases or 0),
        extra_json=extra_json,
    )
    verdict = diagnose_performance(
        ctr=ctr_v,
        cvr=cvr_v,
        sample=float(contract.get("sample") or 0),
        channel=artifact.channel,
        extra_json=contract,
    )
    contract["verdict"] = verdict
    row = ContentPerformanceDaily(
        perf_id=_new_id("PF"),
        artifact_id=artifact.artifact_id,
        appeal_id=artifact.appeal_id,
        sku_id=artifact.sku_id,
        channel=artifact.channel,
        metric_date=metric_date,
        impressions=float(impressions or 0),
        clicks=float(clicks or 0),
        ctr=ctr_v,
        cvr=cvr_v,
        saves=float(saves or 0),
        shares=float(shares or 0),
        completion_rate=float(completion_rate or 0),
        purchases=float(purchases or 0),
        extra_json=_dumps(contract),
    )
    db.add(row)
    appeal = db.query(ContentAppealPoint).filter(ContentAppealPoint.appeal_id == artifact.appeal_id).one_or_none()
    if appeal is not None:
        appeal.learning_verdict = verdict
        if verdict == "PROMOTE":
            appeal.freshness_score = min(100.0, float(appeal.freshness_score or 0) + 8)
            appeal.overall_score = min(100.0, float(appeal.overall_score or 0) + 4)
            appeal.status = "ACTIVE"
        elif verdict == "REVISE":
            appeal.freshness_score = max(0.0, float(appeal.freshness_score or 0) - 6)
            appeal.status = "WEAKENING"
        appeal.updated_at = _now()
    db.commit()
    return {
        "ok": True,
        "perf_id": row.perf_id,
        "verdict": verdict,
        "appeal_id": artifact.appeal_id,
        "ctr": ctr_v,
        "cvr": cvr_v,
        "attribution_level": contract.get("attribution_level"),
        "delta_pct": contract.get("delta_pct"),
    }


def learning_summary(db: Session) -> dict[str, Any]:
    rows = db.query(ContentAppealPoint).order_by(ContentAppealPoint.overall_score.desc()).all()
    grouped: dict[str, int] = {"PROMOTE": 0, "MAINTAIN": 0, "REVISE": 0, "OBSERVE": 0}
    items = []
    for row in rows:
        verdict = str(row.learning_verdict or "OBSERVE")
        grouped[verdict] = grouped.get(verdict, 0) + 1
        items.append(
            {
                "appeal_id": row.appeal_id,
                "sku_id": row.sku_id,
                "label": row.label,
                "overall_score": row.overall_score,
                "status": row.status,
                "learning_verdict": verdict,
            }
        )
    return {"ok": True, "counts": grouped, "items": items}
