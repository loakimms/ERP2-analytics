from __future__ import annotations

import hashlib
import os
from datetime import datetime

from sqlalchemy.orm import Session

from menu_sync_collection import (
    COLLECTION_SYNC_MENUS,
    build_collection_sync_inventory,
    collection_sync_required_files,
    export_collection_sync_bundle,
    import_collection_sync_bundle,
)
from menu_sync_qna import (
    MENU_DESCRIPTION as REVIEW_QNA_DESCRIPTION,
    MENU_ID as REVIEW_QNA_MENU_ID,
    MENU_LABEL as REVIEW_QNA_LABEL,
    export_review_qna_bundle,
    import_review_qna_bundle,
    qna_required_files,
)
from menu_sync_review_reply import (
    MENU_DESCRIPTION as REVIEW_REPLY_DESCRIPTION,
    MENU_ID as REVIEW_REPLY_MENU_ID,
    MENU_LABEL as REVIEW_REPLY_LABEL,
    export_review_reply_bundle,
    import_review_reply_bundle,
    review_reply_required_files,
)
from menu_sync_tracking import (
    MENU_DESCRIPTION as PRODUCT_TRACKING_DESCRIPTION,
    MENU_ID as PRODUCT_TRACKING_MENU_ID,
    MENU_LABEL as PRODUCT_TRACKING_LABEL,
    build_tracking_inventory,
    export_product_tracking_bundle,
    import_product_tracking_bundle,
    tracking_required_files,
)
from schemas import (
    MenuSyncExportRequest,
    MenuSyncInventoryResponse,
    MenuSyncManifest,
    MenuSyncMenuItem,
    MenuSyncMenuSummary,
    MenuSyncTableSummary,
)

MENU_SYNC_SCHEMA_VERSION = "menu_sync_bundle_v1"

_BASE_MENU_ITEMS: list[MenuSyncMenuItem] = [
    MenuSyncMenuItem(
        id=REVIEW_QNA_MENU_ID,
        label=REVIEW_QNA_LABEL,
        description=REVIEW_QNA_DESCRIPTION,
        status="active",
    ),
    MenuSyncMenuItem(
        id=REVIEW_REPLY_MENU_ID,
        label=REVIEW_REPLY_LABEL,
        description=REVIEW_REPLY_DESCRIPTION,
        status="active",
    ),
    MenuSyncMenuItem(
        id=PRODUCT_TRACKING_MENU_ID,
        label=PRODUCT_TRACKING_LABEL,
        description=PRODUCT_TRACKING_DESCRIPTION,
        status="active",
    ),
]
_COLLECTION_MENU_IDS = {item.menu_id for item in COLLECTION_SYNC_MENUS}
_MENU_ITEMS: list[MenuSyncMenuItem] = [
    *_BASE_MENU_ITEMS,
    *[
        MenuSyncMenuItem(id=item.menu_id, label=item.label, description=item.description, status="active")
        for item in COLLECTION_SYNC_MENUS
    ],
]


def list_menu_sync_items() -> list[MenuSyncMenuItem]:
    return list(_MENU_ITEMS)


def _menu_item_map() -> dict[str, MenuSyncMenuItem]:
    return {item.id: item for item in _MENU_ITEMS}


def validate_requested_menu_ids(menu_ids: list[str]) -> list[str]:
    requested = [str(item or "").strip() for item in (menu_ids or []) if str(item or "").strip()]
    if not requested:
        raise ValueError("menu_ids_required")
    item_map = _menu_item_map()
    active_ids = {item.id for item in _MENU_ITEMS if item.status == "active"}
    invalid = [item for item in requested if item not in item_map]
    if invalid:
        raise ValueError(f"unknown_menu:{invalid[0]}")
    inactive = [item for item in requested if item not in active_ids]
    if inactive:
        raise ValueError(f"inactive_menu:{inactive[0]}")
    deduped: list[str] = []
    seen = set()
    for item in requested:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_menu_sync_bundle(db: Session, payload: MenuSyncExportRequest) -> tuple[MenuSyncManifest, dict[str, bytes]]:
    valid_menu_ids = validate_requested_menu_ids(payload.menu_ids)
    files: dict[str, bytes] = {}
    menu_summaries: list[MenuSyncMenuSummary] = []
    for menu_id in valid_menu_ids:
        if menu_id == REVIEW_QNA_MENU_ID:
            summary, menu_files = export_review_qna_bundle(db)
        elif menu_id == REVIEW_REPLY_MENU_ID:
            summary, menu_files = export_review_reply_bundle(db)
        elif menu_id == PRODUCT_TRACKING_MENU_ID:
            summary, menu_files = export_product_tracking_bundle(
                db,
                date_from=payload.date_from,
                date_to=payload.date_to,
                target_dates=payload.target_dates,
            )
        elif menu_id in _COLLECTION_MENU_IDS:
            summary, menu_files = export_collection_sync_bundle(
                db,
                menu_id,
                date_from=payload.date_from,
                date_to=payload.date_to,
                target_dates=payload.target_dates,
            )
        else:
            raise ValueError(f"unsupported_menu:{menu_id}")
        menu_summaries.append(summary)
        files.update(menu_files)
    manifest = MenuSyncManifest(
        schema_version=MENU_SYNC_SCHEMA_VERSION,
        generated_at=datetime.utcnow(),
        menus=valid_menu_ids,
        menu_summaries=menu_summaries,
        checksums={name: _sha256_hex(data) for name, data in files.items()},
        date_from=payload.date_from,
        date_to=payload.date_to,
        target_dates=payload.target_dates,
        source_image_tag=(str(os.getenv("ANALYTICS_IMAGE_TAG") or "").strip() or None),
        source_api_version=(str(os.getenv("ANALYTICS_GIT_SHA") or "").strip() or None),
    )
    return manifest, files


def build_bundle_readme(manifest: MenuSyncManifest) -> str:
    lines = [
        "Analytics 메뉴 동기화 번들",
        "",
        f"- 스키마 버전: {manifest.schema_version}",
        f"- 생성 시각: {manifest.generated_at.isoformat()}",
        f"- 포함 메뉴: {', '.join(manifest.menus)}",
    ]
    if manifest.source_image_tag:
        lines.append(f"- source image tag: {manifest.source_image_tag}")
    if manifest.source_api_version:
        lines.append(f"- source api version: {manifest.source_api_version}")
    lines.extend(
        [
            "",
            "구성:",
            "- manifest.json: 번들 메타데이터, row count, checksum",
            "- menus/<menu_id>/*.json: 메뉴별 데이터 파일",
        ]
    )
    return "\n".join(lines) + "\n"


def _attach_source_row_counts(
    imported_tables: list[MenuSyncTableSummary],
    manifest: MenuSyncManifest,
) -> list[MenuSyncTableSummary]:
    source_count_by_file: dict[str, int] = {}
    source_count_by_name: dict[str, int] = {}
    for menu in manifest.menu_summaries:
        for table in menu.tables:
            source_count_by_file[table.file_name] = table.row_count
            source_count_by_name[table.table_name] = table.row_count

    summarized: list[MenuSyncTableSummary] = []
    for table in imported_tables:
        source_row_count = source_count_by_file.get(table.file_name)
        if source_row_count is None:
            source_row_count = source_count_by_name.get(table.table_name)
        summarized.append(
            MenuSyncTableSummary(
                table_name=table.table_name,
                file_name=table.file_name,
                row_count=table.row_count,
                source_row_count=source_row_count,
            )
        )
    return summarized


def parse_and_validate_bundle(entries: dict[str, bytes]) -> tuple[MenuSyncManifest, dict[str, bytes]]:
    if "manifest.json" not in entries:
        raise ValueError("missing_manifest")
    try:
        manifest = MenuSyncManifest.model_validate_json(entries["manifest.json"].decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"invalid_manifest:{exc}") from exc
    if manifest.schema_version != MENU_SYNC_SCHEMA_VERSION:
        raise ValueError(f"unsupported_schema_version:{manifest.schema_version}")
    for file_name, expected_checksum in manifest.checksums.items():
        actual = entries.get(file_name)
        if actual is None:
            raise ValueError(f"missing_required_file:{file_name}")
        if _sha256_hex(actual) != expected_checksum:
            raise ValueError(f"checksum_mismatch:{file_name}")
    return manifest, entries


def build_menu_sync_inventory(
    db: Session,
    *,
    menu_id: str,
    date_from=None,
    date_to=None,
) -> MenuSyncInventoryResponse:
    if menu_id in _COLLECTION_MENU_IDS:
        return build_collection_sync_inventory(db, menu_id=menu_id, date_from=date_from, date_to=date_to)
    if menu_id != PRODUCT_TRACKING_MENU_ID:
        raise ValueError(f"unsupported_inventory_menu:{menu_id}")
    return build_tracking_inventory(db, date_from=date_from, date_to=date_to)


def import_menu_sync_bundle(
    db: Session,
    manifest: MenuSyncManifest,
    entries: dict[str, bytes],
) -> list[MenuSyncTableSummary]:
    imported_tables: list[MenuSyncTableSummary] = []
    for menu_id in manifest.menus:
        if menu_id == REVIEW_QNA_MENU_ID:
            missing = [name for name in qna_required_files() if name not in entries]
            if missing:
                raise ValueError(f"missing_required_file:{missing[0]}")
            imported_tables.extend(import_review_qna_bundle(db, entries))
        elif menu_id == REVIEW_REPLY_MENU_ID:
            missing = [name for name in review_reply_required_files() if name not in entries]
            if missing:
                raise ValueError(f"missing_required_file:{missing[0]}")
            imported_tables.extend(import_review_reply_bundle(db, entries))
        elif menu_id == PRODUCT_TRACKING_MENU_ID:
            missing = [name for name in tracking_required_files() if name not in entries]
            if missing:
                raise ValueError(f"missing_required_file:{missing[0]}")
            imported_tables.extend(import_product_tracking_bundle(db, entries))
        elif menu_id in _COLLECTION_MENU_IDS:
            missing = [name for name in collection_sync_required_files(menu_id) if name not in entries]
            if missing:
                raise ValueError(f"missing_required_file:{missing[0]}")
            imported_tables.extend(import_collection_sync_bundle(db, menu_id, entries))
        else:
            raise ValueError(f"unsupported_menu:{menu_id}")
    return _attach_source_row_counts(imported_tables, manifest)
