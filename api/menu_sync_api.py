from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime

from fastapi import Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from admin_users import require_role_level
from menu_sync_registry import (
    build_menu_sync_inventory,
    build_bundle_readme,
    build_menu_sync_bundle,
    import_menu_sync_bundle,
    list_menu_sync_items,
    parse_and_validate_bundle,
)
from menu_sync_collection_status import reconcile_collection_jobs_after_menu_sync_import
from schemas import (
    MenuSyncExportRequest,
    MenuSyncInventoryRequest,
    MenuSyncInventoryResponse,
    MenuSyncImportResponse,
    MenuSyncMenusResponse,
    MenuSyncPreviewResponse,
)


def _filename_for_bundle(menu_ids: list[str]) -> str:
    safe_ids = "_".join(menu_ids)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"menu_sync_{safe_ids}_{ts}.zip"


def _build_zip_bytes(manifest, files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", manifest.model_dump_json(indent=2))
        zf.writestr("README.txt", build_bundle_readme(manifest))
        for file_name, data in files.items():
            zf.writestr(file_name, data)
    return buf.getvalue()


def _read_zip_entries(raw: bytes) -> dict[str, bytes]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
            return {name: zf.read(name) for name in zf.namelist()}
    except Exception as exc:
        raise ValueError(f"invalid_zip:{exc}") from exc


def register_menu_sync_routes(app, *, get_db_dep) -> None:
    @app.get("/menu-sync/menus", response_model=MenuSyncMenusResponse)
    def menu_sync_menus(request: Request):
        require_role_level(request, minimum="ops_admin")
        return MenuSyncMenusResponse(ok=True, menus=list_menu_sync_items())

    @app.post("/menu-sync/preview", response_model=MenuSyncPreviewResponse)
    def menu_sync_preview(
        payload: MenuSyncExportRequest,
        request: Request,
        db: Session = Depends(get_db_dep),
    ):
        require_role_level(request, minimum="ops_admin")
        try:
            manifest, _files = build_menu_sync_bundle(db, payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return MenuSyncPreviewResponse(ok=True, manifest=manifest)

    @app.post("/menu-sync/inventory", response_model=MenuSyncInventoryResponse)
    def menu_sync_inventory(
        payload: MenuSyncInventoryRequest,
        request: Request,
        db: Session = Depends(get_db_dep),
    ):
        require_role_level(request, minimum="ops_admin")
        try:
            return build_menu_sync_inventory(
                db,
                menu_id=payload.menu_id,
                date_from=payload.date_from,
                date_to=payload.date_to,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/menu-sync/export")
    def menu_sync_export(
        payload: MenuSyncExportRequest,
        request: Request,
        db: Session = Depends(get_db_dep),
    ):
        require_role_level(request, minimum="ops_admin")
        try:
            manifest, files = build_menu_sync_bundle(db, payload)
            body = _build_zip_bytes(manifest, files)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        filename = _filename_for_bundle(manifest.menus)
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        return StreamingResponse(io.BytesIO(body), media_type="application/zip", headers=headers)

    @app.post("/menu-sync/import", response_model=MenuSyncImportResponse)
    async def menu_sync_import(
        request: Request,
        file: UploadFile = File(...),
        db: Session = Depends(get_db_dep),
    ):
        require_role_level(request, minimum="ops_admin")
        try:
            raw = await file.read()
            entries = _read_zip_entries(raw)
            manifest, validated_entries = parse_and_validate_bundle(entries)
            imported_tables = import_menu_sync_bundle(db, manifest, validated_entries)
            collection_reconciled = reconcile_collection_jobs_after_menu_sync_import(
                db,
                manifest=manifest,
                imported_tables=imported_tables,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return MenuSyncImportResponse(
            ok=True,
            menus=manifest.menus,
            imported_tables=imported_tables,
            detail=json.dumps(
                {
                    "generated_at": manifest.generated_at.isoformat(),
                    "menus": manifest.menus,
                    "collection_reconciled": collection_reconciled,
                },
                ensure_ascii=False,
            ),
        )
