from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from db import (
    NaverGfaAdgroupInventory,
    NaverGfaCampaignInventory,
    NaverGfaCreativeMeta,
    NaverGfaDaily,
    NaverAdCreativeDaily,
    NaverAdKeywordDaily,
    NaverAdSearchwordDaily,
    NaverCommerceProductOrderRaw,
    NaverCommerceProductSalesDaily,
    NaverProductRankDaily,
    NaverProductReviewDaily,
    NaverSmartstorePurchaseKeywordDaily,
    TrackedProductPageDaily,
    TrackedProductRankDaily,
)
from menu_sync_common import coerce_value, serialize_rows
from schemas import (
    MenuSyncInventoryDayItem,
    MenuSyncInventoryResponse,
    MenuSyncInventoryTableItem,
    MenuSyncMenuSummary,
    MenuSyncTableSummary,
)


@dataclass(frozen=True)
class CollectionSyncTable:
    table_name: str
    model: Any
    date_field: str | None
    order_fields: tuple[str, ...]


@dataclass(frozen=True)
class CollectionSyncMenu:
    menu_id: str
    label: str
    description: str
    tables: tuple[CollectionSyncTable, ...]


COLLECTION_SYNC_MENUS: tuple[CollectionSyncMenu, ...] = (
    CollectionSyncMenu(
        menu_id="ads_performance",
        label="광고 성과",
        description="SearchAd 키워드/검색어/소재 일간 성과 데이터",
        tables=(
            CollectionSyncTable("naver_ad_keyword_daily", NaverAdKeywordDaily, "date", ("date", "campaign_name", "adgroup_name", "keyword", "device")),
            CollectionSyncTable("naver_ad_searchword_daily", NaverAdSearchwordDaily, "date", ("date", "campaign_name", "adgroup_name", "searchword", "device")),
            CollectionSyncTable("naver_ad_creative_daily", NaverAdCreativeDaily, "date", ("date", "campaign_name", "adgroup_name", "creative_id", "device")),
        ),
    ),
    CollectionSyncMenu(
        menu_id="sales_purchase",
        label="판매/구매 데이터",
        description="Commerce 주문/상품별 매출과 SmartStore 구매 키워드 데이터",
        tables=(
            CollectionSyncTable("naver_commerce_product_order_raw", NaverCommerceProductOrderRaw, "payment_date", ("payment_date", "product_order_id")),
            CollectionSyncTable("naver_commerce_product_sales_daily", NaverCommerceProductSalesDaily, "date", ("date", "product_id", "source")),
            CollectionSyncTable("naver_smartstore_purchase_keyword_daily", NaverSmartstorePurchaseKeywordDaily, "date", ("date", "product_id", "channel_group", "channel_name", "keyword")),
        ),
    ),
    CollectionSyncMenu(
        menu_id="search_rank",
        label="검색/쇼핑 순위",
        description="OpenAPI/수기/업로드 기반 상품 순위 스냅샷",
        tables=(
            CollectionSyncTable("tracked_product_rank_daily", TrackedProductRankDaily, "date", ("date", "product_url", "keyword")),
            CollectionSyncTable("naver_product_rank_daily", NaverProductRankDaily, "date", ("date", "keyword", "rank")),
        ),
    ),
    CollectionSyncMenu(
        menu_id="product_metrics",
        label="상품 상세 메트릭",
        description="상품 상세 CDP 메트릭과 리뷰/평점 일간 스냅샷",
        tables=(
            CollectionSyncTable("tracked_product_page_daily", TrackedProductPageDaily, "date", ("date", "product_url")),
            CollectionSyncTable("naver_product_review_daily", NaverProductReviewDaily, "date", ("date", "keyword", "product_id")),
        ),
    ),
    CollectionSyncMenu(
        menu_id="gfa_performance",
        label="GFA 성과",
        description="GFA 성과보고서 일간 원천 데이터",
        tables=(
            CollectionSyncTable(
                "naver_gfa_performance_daily",
                NaverGfaDaily,
                "date",
                ("date", "source", "campaign_name", "adgroup_name", "creative_id", "placement", "audience"),
            ),
        ),
    ),
    CollectionSyncMenu(
        menu_id="gfa_inventory",
        label="GFA 목록/소재 메타",
        description="GFA 캠페인/광고그룹 목록과 소재 분석용 사용자 메타",
        tables=(
            CollectionSyncTable("naver_gfa_campaign_inventory", NaverGfaCampaignInventory, None, ("ad_account_no", "campaign_type", "campaign_key")),
            CollectionSyncTable("naver_gfa_adgroup_inventory", NaverGfaAdgroupInventory, None, ("ad_account_no", "campaign_type", "adgroup_key")),
            CollectionSyncTable("naver_gfa_creative_meta", NaverGfaCreativeMeta, None, ("creative_id",)),
        ),
    ),
)

COLLECTION_SYNC_MENU_BY_ID = {item.menu_id: item for item in COLLECTION_SYNC_MENUS}


def collection_sync_required_files(menu_id: str) -> list[str]:
    menu = _get_menu(menu_id)
    return [f"menus/{menu.menu_id}/{table.table_name}.json" for table in menu.tables]


def export_collection_sync_bundle(
    db: Session,
    menu_id: str,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    target_dates: list[date] | None = None,
) -> tuple[MenuSyncMenuSummary, dict[str, bytes]]:
    menu = _get_menu(menu_id)
    scope_from, scope_to, chosen_dates = _resolve_scope(
        date_from=date_from,
        date_to=date_to,
        target_dates=target_dates,
        require_scope=_menu_requires_date_scope(menu),
    )
    tables: list[MenuSyncTableSummary] = []
    files: dict[str, bytes] = {}

    for table in menu.tables:
        query = db.query(table.model)
        query = _apply_date_scope(query, table, date_from=scope_from, date_to=scope_to, target_dates=chosen_dates)
        order_columns = [getattr(table.model, field) for field in table.order_fields if hasattr(table.model, field)]
        if order_columns:
            query = query.order_by(*order_columns)
        rows = query.all()
        serialized = serialize_rows(rows, table.model)
        file_name = f"menus/{menu.menu_id}/{table.table_name}.json"
        files[file_name] = json.dumps(serialized, ensure_ascii=False, indent=2).encode("utf-8")
        tables.append(MenuSyncTableSummary(table_name=table.table_name, file_name=file_name, row_count=len(serialized)))

    return MenuSyncMenuSummary(menu_id=menu.menu_id, label=menu.label, tables=tables), files


def import_collection_sync_bundle(db: Session, menu_id: str, entries: dict[str, bytes]) -> list[MenuSyncTableSummary]:
    menu = _get_menu(menu_id)
    summaries: list[MenuSyncTableSummary] = []
    for table in menu.tables:
        file_name = f"menus/{menu.menu_id}/{table.table_name}.json"
        try:
            rows = json.loads(entries[file_name].decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"invalid_json:{file_name}:{exc}") from exc
        if not isinstance(rows, list):
            raise ValueError(f"invalid_json_rows:{file_name}")
        row_count = _insert_missing_rows(db, table.model, rows, _primary_key_fields(table.model))
        summaries.append(MenuSyncTableSummary(table_name=table.table_name, file_name=file_name, row_count=row_count))
    db.commit()
    return summaries


def build_collection_sync_inventory(
    db: Session,
    *,
    menu_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> MenuSyncInventoryResponse:
    menu = _get_menu(menu_id)
    scope_from, scope_to, chosen_dates = _resolve_scope(
        date_from=date_from,
        date_to=date_to,
        target_dates=None,
        require_scope=_menu_requires_date_scope(menu),
    )
    tables: list[MenuSyncInventoryTableItem] = []
    for table in menu.tables:
        query = db.query(table.model)
        query = _apply_date_scope(query, table, date_from=scope_from, date_to=scope_to, target_dates=chosen_dates)
        rows = query.all()
        if not table.date_field:
            tables.append(
                MenuSyncInventoryTableItem(
                    table_name=table.table_name,
                    days=[],
                )
            )
            continue
        grouped: dict[date, list[str]] = defaultdict(list)
        for row in rows:
            day = getattr(row, table.date_field, None)
            if day is None:
                continue
            grouped[day].append(_row_key(table.model, row))
        tables.append(
            MenuSyncInventoryTableItem(
                table_name=table.table_name,
                days=[
                    MenuSyncInventoryDayItem(date=day, row_count=len(keys), keys=sorted(set(keys)))
                    for day, keys in sorted(grouped.items(), key=lambda item: item[0])
                ],
            )
        )
    return MenuSyncInventoryResponse(ok=True, menu_id=menu_id, date_from=scope_from, date_to=scope_to, tables=tables)


def _get_menu(menu_id: str) -> CollectionSyncMenu:
    menu = COLLECTION_SYNC_MENU_BY_ID.get(str(menu_id or "").strip())
    if not menu:
        raise ValueError(f"unsupported_collection_sync_menu:{menu_id}")
    return menu


def _resolve_scope(
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    target_dates: list[date] | None = None,
    require_scope: bool = True,
) -> tuple[date | None, date | None, list[date]]:
    chosen_dates = sorted({item for item in (target_dates or []) if item is not None})
    if date_from and date_to and date_to < date_from:
        raise ValueError("invalid_date_range")
    if chosen_dates:
        return None, None, chosen_dates
    if not require_scope:
        return None, None, []
    if date_from is None or date_to is None:
        raise ValueError("date_scope_required")
    return date_from, date_to, []


def _menu_requires_date_scope(menu: CollectionSyncMenu) -> bool:
    return any(bool(table.date_field) for table in menu.tables)


def _apply_date_scope(
    query,
    table: CollectionSyncTable,
    *,
    date_from: date | None,
    date_to: date | None,
    target_dates: list[date],
):
    if not table.date_field:
        return query
    column = getattr(table.model, table.date_field)
    if target_dates:
        return query.filter(column.in_(target_dates))
    if date_from is not None:
        query = query.filter(column >= date_from)
    if date_to is not None:
        query = query.filter(column <= date_to)
    return query


def _primary_key_fields(model: Any) -> tuple[str, ...]:
    return tuple(column.name for column in model.__table__.primary_key.columns)


def _row_key(model: Any, row: Any) -> str:
    return "|".join(str(getattr(row, field, "") or "") for field in _primary_key_fields(model))


def _insert_missing_rows(db: Session, model: Any, rows: list[dict[str, Any]], key_fields: tuple[str, ...]) -> int:
    if not rows:
        return 0
    column_map = {column.name: column for column in model.__table__.columns}
    deduped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for item in rows:
        if not isinstance(item, dict):
            continue
        key = tuple(coerce_value(column_map[field], item.get(field)) for field in key_fields)
        if any(value is None for value in key):
            continue
        deduped[key] = item
    if not deduped:
        return 0

    query = db.query(*[getattr(model, field) for field in key_fields])
    if "date" in column_map:
        dates = sorted(
            {
                coerce_value(column_map["date"], item.get("date"))
                for item in deduped.values()
                if item.get("date") is not None
            }
        )
        if dates:
            query = query.filter(getattr(model, "date").in_(dates))
    elif "payment_date" in column_map:
        dates = sorted(
            {
                coerce_value(column_map["payment_date"], item.get("payment_date"))
                for item in deduped.values()
                if item.get("payment_date") is not None
            }
        )
        if dates:
            query = query.filter(getattr(model, "payment_date").in_(dates))
    existing_keys = {tuple(value for value in row) for row in query.all()}

    inserted = 0
    for key, item in deduped.items():
        if key in existing_keys:
            continue
        payload = {}
        for column in model.__table__.columns:
            if column.name not in item:
                continue
            payload[column.name] = coerce_value(column, item.get(column.name))
        db.add(model(**payload))
        inserted += 1
    return inserted
