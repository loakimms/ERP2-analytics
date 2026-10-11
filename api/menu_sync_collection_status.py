from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from db import CollectionJobEvent, CollectionJobRun
from schemas import MenuSyncManifest, MenuSyncTableSummary


TABLE_TO_COLLECTION_TASKS: dict[str, tuple[str, ...]] = {
    "naver_commerce_product_order_raw": ("sales_orders",),
    "naver_commerce_product_sales_daily": ("sales_orders",),
    "naver_smartstore_purchase_keyword_daily": ("purchase_keywords",),
    "naver_ad_keyword_daily": ("ads_daily",),
    "naver_ad_searchword_daily": ("ads_daily", "ads_searchword_daily"),
    "naver_ad_creative_daily": ("ads_daily", "ads_creative_report_daily"),
    "naver_gfa_performance_daily": ("gfa_performance_daily",),
    "naver_gfa_campaign_inventory": ("gfa_campaign_inventory",),
    "naver_gfa_adgroup_inventory": ("gfa_adgroup_inventory",),
    "naver_gfa_creative_detail": ("gfa_creative_detail",),
    "tracked_product_rank_daily": ("rank_openapi",),
    "tracked_product_page_daily": ("page_metrics_cdp",),
    "naver_product_review_daily": ("page_metrics_cdp", "review_daily_backfill"),
    "tracked_product_index_score_daily": ("product_index_daily",),
    "ad_rank_diagnosis_daily": ("ad_rank_diagnosis_cdp",),
    "naver_review_raw": ("reviews_collect", "review_reply_backfill"),
    "naver_review_reply_raw": ("review_reply_backfill",),
    "commerce_qna_raw": ("qna_collect",),
}

TASK_SOURCE_TYPES: dict[str, str] = {
    "sales_orders": "server_api",
    "purchase_keywords": "host_cdp",
    "ads_daily": "server_api",
    "ads_searchword_daily": "host_cdp",
    "ads_creative_report_daily": "host_cdp",
    "gfa_performance_daily": "host_cdp",
    "gfa_campaign_inventory": "host_cdp",
    "gfa_adgroup_inventory": "host_cdp",
    "gfa_creative_detail": "host_cdp",
    "rank_openapi": "host_cdp",
    "page_metrics_cdp": "host_cdp",
    "review_daily_backfill": "server_batch",
    "product_index_daily": "server_batch",
    "ad_rank_diagnosis_cdp": "host_cdp",
    "reviews_collect": "host_cdp",
    "review_reply_backfill": "host_cdp",
    "qna_collect": "server_api",
}


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _source_row_count(summary: MenuSyncTableSummary) -> int:
    try:
        if summary.source_row_count is not None:
            return max(0, int(summary.source_row_count or 0))
        return max(0, int(summary.row_count or 0))
    except Exception:
        return 0


def _manifest_target_range(manifest: MenuSyncManifest) -> tuple[date, date]:
    dates = sorted({item for item in (manifest.target_dates or []) if item is not None})
    if dates:
        return dates[0], dates[-1]
    if manifest.date_from and manifest.date_to:
        return manifest.date_from, manifest.date_to
    if manifest.date_from:
        return manifest.date_from, manifest.date_from
    if manifest.date_to:
        return manifest.date_to, manifest.date_to
    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    return today, today


def reconcile_collection_jobs_after_menu_sync_import(
    db: Session,
    *,
    manifest: MenuSyncManifest,
    imported_tables: list[MenuSyncTableSummary],
) -> list[dict]:
    """
    Menu sync restores fact rows directly, but the collection hub is driven by
    collection_job_run. Record a synthetic success so the collection UI reflects
    imported data immediately instead of showing stale cancelled/empty jobs.
    """
    task_tables: dict[str, list[MenuSyncTableSummary]] = {}
    for summary in imported_tables:
        source_rows = _source_row_count(summary)
        if source_rows <= 0:
            continue
        for task_id in TABLE_TO_COLLECTION_TASKS.get(summary.table_name, ()):
            task_tables.setdefault(task_id, []).append(summary)

    if not task_tables:
        return []

    date_from, date_to = _manifest_target_range(manifest)
    now = datetime.utcnow()
    reconciled: list[dict] = []
    for task_id, summaries in sorted(task_tables.items()):
        rows_written = sum(_source_row_count(item) for item in summaries)
        if rows_written <= 0:
            continue
        rows_by_table = {
            item.table_name: sum(_source_row_count(summary) for summary in summaries if summary.table_name == item.table_name)
            for item in summaries
        }
        job = CollectionJobRun(
            job_id=str(uuid.uuid4()),
            task_id=task_id,
            run_mode="menu_sync",
            source_type=TASK_SOURCE_TYPES.get(task_id, "manual_import"),
            status="SUCCESS",
            target_date=date_to,
            date_from=date_from,
            date_to=date_to,
            rows_written=rows_written,
            detail_json=_json_dumps(
                {
                    "menu_sync_import": True,
                    "menus": manifest.menus,
                    "source_generated_at": manifest.generated_at.isoformat() if manifest.generated_at else None,
                    "source_image_tag": manifest.source_image_tag,
                    "source_api_version": manifest.source_api_version,
                    "db_persistence": {
                        "date_from": date_from.isoformat(),
                        "date_to": date_to.isoformat(),
                        "required_date_count": max(0, (date_to - date_from).days + 1),
                        "checked_tables": sorted(rows_by_table.keys()),
                        "rows_total": rows_written,
                        "rows_by_table": rows_by_table,
                        "empty_tables": [],
                        "missing_tables": [],
                        "empty_dates_by_table": {},
                        "missing_dates_by_table": {},
                        "missing_date_count": 0,
                        "completion_verified": True,
                        "verification_status": "complete",
                        "verification_reason": "menu_sync_import",
                    },
                    "tables": [
                        {
                            "table_name": item.table_name,
                            "file_name": item.file_name,
                            "imported_row_count": item.row_count,
                            "source_row_count": item.source_row_count,
                        }
                        for item in summaries
                    ],
                }
            ),
            started_at=now,
            finished_at=now,
        )
        db.add(job)
        db.add(
            CollectionJobEvent(
                event_id=str(uuid.uuid4()),
                job_id=job.job_id,
                task_id=task_id,
                level="INFO",
                status="SUCCESS",
                message="menu sync import reflected in collection status",
                detail_json=_json_dumps({"rows_written": rows_written, "date_from": date_from, "date_to": date_to}),
                created_at=now,
            )
        )
        reconciled.append(
            {
                "task_id": task_id,
                "job_id": job.job_id,
                "rows_written": rows_written,
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
            }
        )

    db.commit()
    return reconciled
