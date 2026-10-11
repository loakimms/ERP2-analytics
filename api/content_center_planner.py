from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import String, cast, func
from sqlalchemy.orm import Session

from content_center_channels import CONTENT_CHANNELS
from content_center_time import today_kst
from content_center_engine import _new_id, get_appeal, list_appeals
from content_center_scope import list_sku_scope, sku_scope_to_dict
from db import (
    CollectionJobRun,
    CommerceQnaRaw,
    ContentArtifact,
    ContentPlanItem,
    ContentTopic,
    NaverAdSearchwordDaily,
    NaverCommerceProductOrderRaw,
    NaverGfaDaily,
    NaverReviewRaw,
    NaverSmartstorePurchaseKeywordDaily,
)


READY_TASKS = (
    "purchase_keywords",
    "reviews_collect",
    "ads_daily",
    "gfa_performance_daily",
    "qna_collect",
    "sales_orders",
)

SOURCE_CONFIGS = (
    {
        "source": "review",
        "label": "리뷰",
        "task_id": "reviews_collect",
        "model": NaverReviewRaw,
        "date_expr": cast(NaverReviewRaw.review_written_at, String),
        "expected_lag": "same_day",
        "compare_as_text": True,
    },
    {
        "source": "qna",
        "label": "문의",
        "task_id": "qna_collect",
        "model": CommerceQnaRaw,
        "date_expr": cast(func.date(CommerceQnaRaw.inquiry_registered_at), String),
        "expected_lag": "range_may_have_no_new_rows",
        "compare_as_text": True,
    },
    {
        "source": "purchase_keyword",
        "label": "구매 키워드",
        "task_id": "purchase_keywords",
        "model": NaverSmartstorePurchaseKeywordDaily,
        "date_expr": cast(NaverSmartstorePurchaseKeywordDaily.date, String),
        "expected_lag": "previous_day",
        "compare_as_text": True,
    },
    {
        "source": "ad_searchword",
        "label": "광고 검색어",
        "task_id": "ads_daily",
        "model": NaverAdSearchwordDaily,
        "date_expr": cast(NaverAdSearchwordDaily.date, String),
        "expected_lag": "previous_day",
        "compare_as_text": True,
    },
    {
        "source": "gfa_performance",
        "label": "GFA 성과",
        "task_id": "gfa_performance_daily",
        "model": NaverGfaDaily,
        "date_expr": cast(NaverGfaDaily.date, String),
        "expected_lag": "previous_day",
        "compare_as_text": True,
    },
    {
        "source": "order_sales",
        "label": "주문/매출",
        "task_id": "sales_orders",
        "model": NaverCommerceProductOrderRaw,
        "date_expr": cast(NaverCommerceProductOrderRaw.payment_date, String),
        "expected_lag": "previous_day",
        "compare_as_text": True,
    },
)


def _today() -> date:
    return today_kst()


def _iso_date(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value)
    return text[:10] if text else None


def _latest_job(db: Session, task_id: str) -> CollectionJobRun | None:
    return (
        db.query(CollectionJobRun)
        .filter(CollectionJobRun.task_id == task_id)
        .order_by(CollectionJobRun.started_at.desc())
        .first()
    )


def _count_for_date(db: Session, model: Any, date_expr: Any, value: date | str | None, *, compare_as_text: bool = False) -> int:
    if value is None:
        return 0
    compare_value = value.isoformat() if compare_as_text and hasattr(value, "isoformat") else value
    return int(db.query(func.count()).select_from(model).filter(date_expr == compare_value).scalar() or 0)


def _source_readiness_status(*, expected_lag: str, as_of: date, latest_data_date: str | None, today_row_count: int, job: CollectionJobRun | None) -> tuple[str, str]:
    job_status = str(getattr(job, "status", "") or "")
    if not job:
        return "MISSING", "collection job 이력이 없습니다."
    if job_status not in {"SUCCESS", "PARTIAL"}:
        return "FAILED", f"최근 수집 상태가 {job_status or 'UNKNOWN'}입니다."
    if not latest_data_date:
        return "MISSING", "원천 테이블에 기준일 데이터가 없습니다."
    previous_day = (as_of - timedelta(days=1)).isoformat()
    if latest_data_date == as_of.isoformat():
        return "READY", "오늘 기준 데이터가 존재합니다."
    if expected_lag == "previous_day" and latest_data_date == previous_day:
        return "READY_PREVIOUS_DAY", "전일 기준 수집이 정상 계약입니다."
    if expected_lag == "range_may_have_no_new_rows" and today_row_count == 0:
        return "READY_NO_NEW_ROWS", "오늘 신규 원천 데이터는 없지만 수집 작업은 성공했습니다."
    return "STALE", f"최신 데이터 기준일이 {latest_data_date}입니다."


def _source_metrics(db: Session, *, as_of: date) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for cfg in SOURCE_CONFIGS:
        model = cfg["model"]
        date_expr = cfg["date_expr"]
        compare_as_text = bool(cfg.get("compare_as_text"))
        latest_value = db.query(func.max(date_expr)).select_from(model).scalar()
        latest_data_date = _iso_date(latest_value)
        latest_compare_value = latest_data_date if compare_as_text else latest_value
        latest_data_row_count = _count_for_date(
            db,
            model,
            date_expr,
            latest_compare_value,
            compare_as_text=compare_as_text,
        )
        today_row_count = _count_for_date(
            db,
            model,
            date_expr,
            as_of,
            compare_as_text=compare_as_text,
        )
        job = _latest_job(db, str(cfg["task_id"]))
        readiness_status, readiness_reason = _source_readiness_status(
            expected_lag=str(cfg["expected_lag"]),
            as_of=as_of,
            latest_data_date=latest_data_date,
            today_row_count=today_row_count,
            job=job,
        )
        out.append(
            {
                "source": cfg["source"],
                "label": cfg["label"],
                "task_id": cfg["task_id"],
                "latest_data_date": latest_data_date,
                "latest_data_row_count": latest_data_row_count,
                "today_row_count": today_row_count,
                "last_collection_at": job.finished_at.isoformat() if getattr(job, "finished_at", None) else None,
                "last_collection_status": str(getattr(job, "status", "") or "MISSING"),
                "last_job_rows_written": getattr(job, "rows_written", None),
                "expected_lag": cfg["expected_lag"],
                "readiness_status": readiness_status,
                "readiness_reason": readiness_reason,
            }
        )
    return out


def data_ready_gate(db: Session, *, as_of: date | None = None) -> dict[str, Any]:
    as_of = as_of or _today()
    tasks: list[dict[str, Any]] = []
    ready = True
    for task_id in READY_TASKS:
        row = (
            db.query(CollectionJobRun)
            .filter(CollectionJobRun.task_id == task_id)
            .order_by(CollectionJobRun.started_at.desc())
            .first()
        )
        status = str(getattr(row, "status", "") or "")
        finished = getattr(row, "finished_at", None)
        ok = status in {"SUCCESS", "PARTIAL"}
        if not ok:
            ready = False
        tasks.append(
            {
                "task_id": task_id,
                "status": status or "MISSING",
                "ok": ok,
                "finished_at": finished.isoformat() if finished else None,
            }
        )
    return {"ok": True, "ready": ready, "as_of": as_of.isoformat(), "tasks": tasks, "sources": _source_metrics(db, as_of=as_of)}


def _recent_channel_uses(db: Session, *, sku_id: str, since: date) -> set[tuple[str, str]]:
    rows = (
        db.query(ContentPlanItem)
        .filter(ContentPlanItem.sku_id == sku_id, ContentPlanItem.plan_date >= since)
        .all()
    )
    return {(str(row.appeal_id), str(row.channel)) for row in rows}


def build_today_plan(db: Session, *, as_of: date | None = None) -> dict[str, Any]:
    as_of = as_of or _today()
    gate = data_ready_gate(db, as_of=as_of)
    scopes = list_sku_scope(db, phase1_only=True)
    appeals = list_appeals(db, phase1_only=True)
    appeals_by_id = {str(item["appeal_id"]): item for item in appeals}
    by_sku: dict[str, list[dict[str, Any]]] = {}
    for item in appeals:
        if str(item.get("status")) != "ACTIVE":
            continue
        by_sku.setdefault(str(item["sku_id"]), []).append(item)

    created = 0
    items_out: list[dict[str, Any]] = []
    since = as_of - timedelta(days=7)
    for index, scope in enumerate(scopes):
        sku_appeals = by_sku.get(scope.sku_id, [])
        if not sku_appeals:
            continue
        used = _recent_channel_uses(db, sku_id=scope.sku_id, since=since)
        channel = CONTENT_CHANNELS[index % len(CONTENT_CHANNELS)]
        chosen = next((a for a in sku_appeals if (a["appeal_id"], channel) not in used), sku_appeals[0])
        existing = (
            db.query(ContentPlanItem)
            .filter(
                ContentPlanItem.plan_date == as_of,
                ContentPlanItem.sku_id == scope.sku_id,
                ContentPlanItem.channel == channel,
            )
            .one_or_none()
        )
        locked_artifact = None
        if existing is not None:
            locked_artifact = (
                db.query(ContentArtifact)
                .filter(ContentArtifact.plan_id == existing.plan_id)
                .order_by(ContentArtifact.created_at.asc())
                .first()
            )
            if locked_artifact is not None:
                existing_topic = db.query(ContentTopic).filter(ContentTopic.topic_id == existing.topic_id).one_or_none() if existing.topic_id else None
                items_out.append(
                    plan_item_to_dict(
                        existing,
                        sku=scope,
                        appeal=_appeal_for_plan(db, appeals_by_id, existing.appeal_id) or chosen,
                        topic=existing_topic,
                        artifact=locked_artifact,
                    )
                )
                continue
        topic = (
            db.query(ContentTopic)
            .filter(ContentTopic.sku_id == scope.sku_id, ContentTopic.appeal_id == chosen["appeal_id"])
            .order_by(ContentTopic.created_at.desc())
            .first()
        )
        if topic is None:
            topic = ContentTopic(
                topic_id=_new_id("TP"),
                sku_id=scope.sku_id,
                appeal_id=str(chosen["appeal_id"]),
                title=str(chosen.get("label") or ""),
                angle=str(chosen.get("appeal_text") or ""),
                as_of_date=as_of,
            )
            db.add(topic)
        if existing is None:
            existing = ContentPlanItem(
                plan_id=_new_id("PL"),
                plan_date=as_of,
                sku_id=scope.sku_id,
                appeal_id=str(chosen["appeal_id"]),
                topic_id=topic.topic_id,
                channel=channel,
                status="queued",
                reason=f"{chosen.get('label')} 소구를 {channel}에 배정. 최근 7일 중복 조합을 피함.",
            )
            db.add(existing)
            created += 1
        else:
            existing.appeal_id = str(chosen["appeal_id"])
            existing.topic_id = topic.topic_id
            existing.reason = f"{chosen.get('label')} 소구를 {channel}에 배정. 최근 7일 중복 조합을 피함."
        items_out.append(plan_item_to_dict(existing, sku=scope, appeal=chosen, topic=topic))
    db.commit()
    return {
        "ok": True,
        "as_of": as_of.isoformat(),
        "data_ready": gate,
        "created": created,
        "items": items_out,
    }


def plan_item_to_dict(
    row: ContentPlanItem,
    *,
    sku: Any = None,
    appeal: dict[str, Any] | None = None,
    topic: ContentTopic | None = None,
    artifact: ContentArtifact | None = None,
) -> dict[str, Any]:
    return {
        "plan_id": row.plan_id,
        "plan_date": row.plan_date.isoformat() if row.plan_date else None,
        "sku_id": row.sku_id,
        "sku": sku_scope_to_dict(sku) if sku is not None else None,
        "appeal_id": row.appeal_id,
        "appeal": appeal,
        "topic_id": row.topic_id,
        "topic_title": topic.title if topic is not None else None,
        "channel": row.channel,
        "status": row.status,
        "reason": row.reason,
        "artifact_id": artifact.artifact_id if artifact is not None else None,
        "reviewer_status": artifact.reviewer_status if artifact is not None else None,
    }


def _appeal_for_plan(db: Session, appeals: dict[str, dict[str, Any]], appeal_id: str | None) -> dict[str, Any] | None:
    key = str(appeal_id or "").strip()
    if not key:
        return None
    return appeals.get(key) or get_appeal(db, key)


def list_today(db: Session, *, as_of: date | None = None) -> dict[str, Any]:
    as_of = as_of or _today()
    rows = db.query(ContentPlanItem).filter(ContentPlanItem.plan_date == as_of).order_by(ContentPlanItem.created_at.asc()).all()
    scopes = {row.sku_id: row for row in list_sku_scope(db, phase1_only=False)}
    appeals = {item["appeal_id"]: item for item in list_appeals(db, phase1_only=False)}
    items = []
    for row in rows:
        topic = db.query(ContentTopic).filter(ContentTopic.topic_id == row.topic_id).one_or_none() if row.topic_id else None
        artifact = (
            db.query(ContentArtifact)
            .filter(ContentArtifact.plan_id == row.plan_id)
            .order_by(ContentArtifact.created_at.desc())
            .first()
        )
        items.append(plan_item_to_dict(row, sku=scopes.get(row.sku_id), appeal=_appeal_for_plan(db, appeals, row.appeal_id), topic=topic, artifact=artifact))
    return {"ok": True, "as_of": as_of.isoformat(), "items": items, "data_ready": data_ready_gate(db, as_of=as_of)}
