from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from db import (
    NaverProductRankDaily,
    TrackedProductAutoKeyword,
    TrackedProductIndexManual,
    TrackedProductIndexScoreDaily,
    TrackedProductKeyword,
    TrackedProductManualKeyword,
    TrackedProductMeta,
    TrackedProductPageDaily,
    TrackedProductRankDaily,
    TrackedProductSalesManual,
)
from menu_sync_common import coerce_value, order_by_query, serialize_rows
from schemas import (
    MenuSyncInventoryDayItem,
    MenuSyncInventoryResponse,
    MenuSyncInventoryTableItem,
    MenuSyncMenuSummary,
    MenuSyncTableSummary,
)


MENU_ID = "product_tracking"
MENU_LABEL = "내 상품 추적"
MENU_DESCRIPTION = "제품정보, 오가닉 순위, 수기 보강/메타 핵심 데이터"

_FILE_PREFIX = "menus/product_tracking"

_REFERENCE_TABLES: list[tuple[str, Any, tuple[str, ...], set[str]]] = [
    ("tracked_product_meta", TrackedProductMeta, ("product_url",), {"id"}),
    ("tracked_product_keyword", TrackedProductKeyword, ("product_url", "keyword"), {"id"}),
    ("tracked_product_manual_keyword", TrackedProductManualKeyword, ("product_url", "keyword"), set()),
    ("tracked_product_auto_keyword", TrackedProductAutoKeyword, ("product_url", "keyword"), set()),
    ("tracked_product_sales_manual", TrackedProductSalesManual, ("product_url",), set()),
    ("tracked_product_index_manual", TrackedProductIndexManual, ("product_url",), set()),
]

_DATE_TABLES: list[tuple[str, Any, tuple[str, ...]]] = [
    ("tracked_product_page_daily", TrackedProductPageDaily, ("date", "product_url")),
    ("tracked_product_rank_daily", TrackedProductRankDaily, ("date", "product_url", "keyword")),
    ("naver_product_rank_daily", NaverProductRankDaily, ("date", "keyword", "rank")),
    ("tracked_product_index_score_daily", TrackedProductIndexScoreDaily, ("date", "product_url")),
]


def tracking_required_files() -> list[str]:
    names = [name for name, _model, _keys, _ignored in _REFERENCE_TABLES]
    names.extend(name for name, _model, _keys in _DATE_TABLES)
    return [f"{_FILE_PREFIX}/{table_name}.json" for table_name in names]


def _resolve_scope(
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    target_dates: list[date] | None = None,
) -> tuple[date | None, date | None, list[date]]:
    chosen_dates = sorted({item for item in (target_dates or []) if item is not None})
    if date_from and date_to and date_to < date_from:
        raise ValueError("invalid_date_range")
    if chosen_dates:
        return None, None, chosen_dates
    return date_from, date_to, []


def _apply_date_scope(query, model: Any, *, date_from: date | None, date_to: date | None, target_dates: list[date]):
    if target_dates:
        return query.filter(model.date.in_(target_dates))
    if date_from is not None:
        query = query.filter(model.date >= date_from)
    if date_to is not None:
        query = query.filter(model.date <= date_to)
    return query


def _tracking_keywords(db: Session, *, target_dates: list[date], date_from: date | None, date_to: date | None) -> set[str]:
    keywords: set[str] = set()
    for model, field in (
        (TrackedProductKeyword, TrackedProductKeyword.keyword),
        (TrackedProductManualKeyword, TrackedProductManualKeyword.keyword),
        (TrackedProductAutoKeyword, TrackedProductAutoKeyword.keyword),
    ):
        for row in db.query(field).all():
            text = str(row[0] or "").strip()
            if text:
                keywords.add(text)

    rank_query = db.query(TrackedProductRankDaily.keyword)
    rank_query = _apply_date_scope(
        rank_query,
        TrackedProductRankDaily,
        date_from=date_from,
        date_to=date_to,
        target_dates=target_dates,
    )
    for row in rank_query.distinct().all():
        text = str(row[0] or "").strip()
        if text:
            keywords.add(text)
    return keywords


def _tracking_product_ids(db: Session) -> set[int]:
    product_ids: set[int] = set()
    for row in db.query(TrackedProductMeta.product_id_catalog).all():
        value = row[0]
        if value is None:
            continue
        try:
            product_ids.add(int(value))
        except Exception:
            continue
    return product_ids


def _serialize_key(table_name: str, row: Any) -> str:
    if table_name == "tracked_product_page_daily":
        return f"{row.product_url}"
    if table_name == "tracked_product_rank_daily":
        return f"{row.product_url}|{row.keyword}"
    if table_name == "naver_product_rank_daily":
        return f"{row.keyword}|{row.rank}|{row.product_id or ''}"
    if table_name == "tracked_product_index_score_daily":
        return f"{row.product_url}"
    raise ValueError(f"unsupported_inventory_table:{table_name}")


def build_tracking_inventory(
    db: Session,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> MenuSyncInventoryResponse:
    scope_from, scope_to, target_dates = _resolve_scope(date_from=date_from, date_to=date_to, target_dates=None)
    if scope_from is None and scope_to is None and not target_dates:
        raise ValueError("tracking_scope_required")
    keywords = _tracking_keywords(db, target_dates=target_dates, date_from=scope_from, date_to=scope_to)
    product_ids = _tracking_product_ids(db)
    tables: list[MenuSyncInventoryTableItem] = []

    for table_name, model, _key_fields in _DATE_TABLES:
        query = db.query(model)
        query = _apply_date_scope(query, model, date_from=scope_from, date_to=scope_to, target_dates=target_dates)
        if table_name == "naver_product_rank_daily":
            if not keywords or not product_ids:
                tables.append(MenuSyncInventoryTableItem(table_name=table_name, days=[]))
                continue
            query = query.filter(
                NaverProductRankDaily.keyword.in_(sorted(keywords)),
                NaverProductRankDaily.product_id.in_(sorted(product_ids)),
            )
        rows = query.order_by(model.date.asc()).all()
        grouped: dict[date, list[str]] = defaultdict(list)
        for row in rows:
            grouped[row.date].append(_serialize_key(table_name, row))
        tables.append(
            MenuSyncInventoryTableItem(
                table_name=table_name,
                days=[
                    MenuSyncInventoryDayItem(
                        date=day,
                        row_count=len(keys),
                        keys=sorted(set(keys)),
                    )
                    for day, keys in sorted(grouped.items(), key=lambda item: item[0])
                ],
            )
        )

    return MenuSyncInventoryResponse(
        ok=True,
        menu_id=MENU_ID,
        date_from=scope_from,
        date_to=scope_to,
        tables=tables,
    )


def export_product_tracking_bundle(
    db: Session,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    target_dates: list[date] | None = None,
) -> tuple[MenuSyncMenuSummary, dict[str, bytes]]:
    scope_from, scope_to, chosen_dates = _resolve_scope(date_from=date_from, date_to=date_to, target_dates=target_dates)
    if scope_from is None and scope_to is None and not chosen_dates:
        raise ValueError("tracking_scope_required")
    tables: list[MenuSyncTableSummary] = []
    files: dict[str, bytes] = {}

    for table_name, model, order_fields, _ignored in _REFERENCE_TABLES:
        rows = order_by_query(db, model, order_fields).all()
        serialized = serialize_rows(rows, model)
        file_name = f"{_FILE_PREFIX}/{table_name}.json"
        files[file_name] = json.dumps(serialized, ensure_ascii=False, indent=2).encode("utf-8")
        tables.append(MenuSyncTableSummary(table_name=table_name, file_name=file_name, row_count=len(serialized)))

    keywords = _tracking_keywords(db, target_dates=chosen_dates, date_from=scope_from, date_to=scope_to)
    product_ids = _tracking_product_ids(db)

    for table_name, model, order_fields in _DATE_TABLES:
        query = order_by_query(db, model, order_fields)
        query = _apply_date_scope(query, model, date_from=scope_from, date_to=scope_to, target_dates=chosen_dates)
        if table_name == "naver_product_rank_daily":
            if keywords and product_ids:
                query = query.filter(
                    NaverProductRankDaily.keyword.in_(sorted(keywords)),
                    NaverProductRankDaily.product_id.in_(sorted(product_ids)),
                )
            else:
                query = query.filter(NaverProductRankDaily.rank == -999999)
        rows = query.all()
        serialized = serialize_rows(rows, model)
        file_name = f"{_FILE_PREFIX}/{table_name}.json"
        files[file_name] = json.dumps(serialized, ensure_ascii=False, indent=2).encode("utf-8")
        tables.append(MenuSyncTableSummary(table_name=table_name, file_name=file_name, row_count=len(serialized)))

    return (
        MenuSyncMenuSummary(
            menu_id=MENU_ID,
            label=MENU_LABEL,
            tables=tables,
        ),
        files,
    )


def _decode_entries(entries: dict[str, bytes]) -> dict[str, list[dict[str, Any]]]:
    decoded: dict[str, list[dict[str, Any]]] = {}
    for file_name in tracking_required_files():
        try:
            decoded[file_name] = json.loads(entries[file_name].decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"invalid_json:{file_name}:{exc}") from exc
    return decoded


def _insert_missing_rows(db: Session, model: Any, rows: list[dict[str, Any]], key_fields: tuple[str, ...]) -> int:
    if not rows:
        return 0
    column_map = {column.name: column for column in model.__table__.columns}
    deduped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for item in rows:
        key = tuple(coerce_value(column_map[field], item.get(field)) for field in key_fields)
        deduped[key] = item

    query = db.query(*[getattr(model, field) for field in key_fields])
    if "date" in key_fields:
        dates = sorted(
            {
                coerce_value(column_map["date"], item.get("date"))
                for item in deduped.values()
                if item.get("date") is not None
            }
        )
        if dates:
            query = query.filter(model.date.in_(dates))
    existing_keys = {
        tuple(value for value in row)
        for row in query.all()
    }

    columns = list(model.__table__.columns)
    inserted = 0
    for key, item in deduped.items():
        if key in existing_keys:
            continue
        payload = {}
        for column in columns:
            if column.name not in item:
                continue
            payload[column.name] = coerce_value(column, item.get(column.name))
        db.add(model(**payload))
        inserted += 1
    return inserted


def _insert_missing_reference_rows(
    db: Session,
    model: Any,
    rows: list[dict[str, Any]],
    key_fields: tuple[str, ...],
    *,
    ignore_columns: set[str] | None = None,
) -> int:
    if not rows:
        return 0
    column_map = {column.name: column for column in model.__table__.columns}
    ignored = set(ignore_columns or set())
    deduped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for item in rows:
        key = tuple(coerce_value(column_map[field], item.get(field)) for field in key_fields)
        deduped[key] = item

    query = db.query(*[getattr(model, field) for field in key_fields])
    existing_keys = {tuple(value for value in row) for row in query.all()}
    inserted = 0
    for key, item in deduped.items():
        if key in existing_keys:
            continue
        payload = {}
        for column in model.__table__.columns:
            if column.name in ignored or column.name not in item:
                continue
            payload[column.name] = coerce_value(column, item.get(column.name))
        db.add(model(**payload))
        inserted += 1
    return inserted


def import_product_tracking_bundle(db: Session, entries: dict[str, bytes]) -> list[MenuSyncTableSummary]:
    required = set(tracking_required_files())
    missing = [name for name in required if name not in entries]
    if missing:
        raise ValueError(f"missing_required_file:{missing[0]}")

    decoded = _decode_entries(entries)
    summaries: list[MenuSyncTableSummary] = []

    for table_name, model, key_fields, ignored in _REFERENCE_TABLES:
        file_name = f"{_FILE_PREFIX}/{table_name}.json"
        rows = decoded[file_name]
        row_count = _insert_missing_reference_rows(db, model, rows, key_fields, ignore_columns=ignored)
        summaries.append(MenuSyncTableSummary(table_name=table_name, file_name=file_name, row_count=row_count))

    for table_name, model, key_fields in _DATE_TABLES:
        file_name = f"{_FILE_PREFIX}/{table_name}.json"
        rows = decoded[file_name]
        row_count = _insert_missing_rows(db, model, rows, key_fields)
        summaries.append(MenuSyncTableSummary(table_name=table_name, file_name=file_name, row_count=row_count))

    db.commit()
    return summaries
