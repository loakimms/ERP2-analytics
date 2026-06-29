from __future__ import annotations

import json
import uuid
from datetime import date as Date
from datetime import datetime

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from a1_trace_store import export_trace, get_blob, get_node, get_tree, list_runs, list_skus_for_run, verify_node
from db import AnalysisActionReview, TrackedProductMeta


def _parse_date(s: str | None) -> Date | None:
    if not s:
        return None
    try:
        return datetime.strptime(str(s), "%Y-%m-%d").date()
    except Exception:
        return None


class RunsResponse(BaseModel):
    ok: bool
    items: list[dict] = []


class TraceTreeResponse(BaseModel):
    ok: bool
    run_id: str
    sku_id: str
    nodes: list[dict] = []
    edges: list[dict] = []


class TraceNodeResponse(BaseModel):
    ok: bool
    node: dict
    blob: dict | None = None


class SkusResponse(BaseModel):
    ok: bool
    run_id: str
    skus: list[str] = []
    # UI 표시용 라벨(상품명). key=sku_id, value=title
    labels: dict[str, str] = Field(default_factory=dict)


class ActionReviewItem(BaseModel):
    review_id: str
    run_id: str
    sku_id: str
    action_title: str
    accepted: bool
    comment: str | None = None
    evidence_refs: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None


class VerifyRequest(BaseModel):
    node_id: str = Field(..., min_length=1)


class VerifyResponse(BaseModel):
    ok: bool
    match: bool
    message: str
    stored_hash: str | None = None
    recomputed_hash: str | None = None
    recomputed_preview: str | None = None


class ActionReviewUpsertRequest(BaseModel):
    run_id: str = Field(..., min_length=1)
    sku_id: str = Field(..., min_length=1)
    action_title: str = Field(..., min_length=1)
    accepted: bool = Field(default=False)
    comment: str | None = None
    evidence_refs: list[str] = Field(default_factory=list)


class ActionReviewListResponse(BaseModel):
    ok: bool
    run_id: str
    sku_id: str
    items: list[ActionReviewItem] = []


class ActionReviewUpsertResponse(BaseModel):
    ok: bool
    item: ActionReviewItem


def register_a1_trace_routes(app, *, get_db_dep) -> None:
    @app.get("/ai/a1/runs", response_model=RunsResponse)
    def a1_runs(
        db: Session = Depends(get_db_dep),
        from_: str | None = Query(None, alias="from"),
        to: str | None = Query(None, alias="to"),
        status: str | None = Query(None),
        limit: int = Query(30, ge=1, le=200),
    ):
        d1 = _parse_date(from_)
        d2 = _parse_date(to)
        rows = list_runs(db, analysis_type="A-1", date_from=d1, date_to=d2, status=status, limit=limit)
        items = []
        for r in rows or []:
            items.append(
                {
                    "run_id": str(getattr(r, "run_id", "") or ""),
                    "analysis_type": str(getattr(r, "analysis_type", "") or ""),
                    "run_date": str(getattr(r, "run_date", "") or ""),
                    "surface": str(getattr(r, "surface", "") or ""),
                    "action_version": str(getattr(r, "action_version", "") or ""),
                    "model": str(getattr(r, "model", "") or ""),
                    "status": str(getattr(r, "status", "") or ""),
                    "created_at": str(getattr(r, "created_at", "") or ""),
                }
            )
        return RunsResponse(ok=True, items=items)

    @app.get("/ai/a1/trace/tree", response_model=TraceTreeResponse)
    def a1_trace_tree(
        run_id: str = Query(...),
        sku_id: str = Query(...),
        db: Session = Depends(get_db_dep),
    ):
        nodes, edges = get_tree(db, run_id=run_id, sku_id=sku_id)
        out_nodes = []
        for n in nodes or []:
            out_nodes.append(
                {
                    "node_id": str(getattr(n, "node_id", "") or ""),
                    "run_id": str(getattr(n, "run_id", "") or ""),
                    "sku_id": str(getattr(n, "sku_id", "") or ""),
                    "node_type": str(getattr(n, "node_type", "") or ""),
                    "title": str(getattr(n, "title", "") or ""),
                    "severity": (str(getattr(n, "severity", "") or "") or None),
                    "sort_key": int(getattr(n, "sort_key", 0) or 0),
                }
            )
        out_edges = []
        for e in edges or []:
            out_edges.append(
                {
                    "from_node_id": str(getattr(e, "from_node_id", "") or ""),
                    "to_node_id": str(getattr(e, "to_node_id", "") or ""),
                    "edge_type": str(getattr(e, "edge_type", "") or ""),
                    "label": str(getattr(e, "label", "") or ""),
                }
            )
        return TraceTreeResponse(ok=True, run_id=str(run_id), sku_id=str(sku_id), nodes=out_nodes, edges=out_edges)

    @app.get("/ai/a1/trace/skus", response_model=SkusResponse)
    def a1_trace_skus(
        run_id: str = Query(...),
        limit: int = Query(500, ge=1, le=2000),
        db: Session = Depends(get_db_dep),
    ):
        skus = list_skus_for_run(db, run_id=run_id, limit=limit)
        labels: dict[str, str] = {}
        try:
            # best-effort: sku_id가 URL 또는 "url||keyword" 형태일 수 있다.
            for sid in skus or []:
                s = str(sid or "").strip()
                if not s or s == "__RUN__":
                    continue
                base = s.split("||")[0].strip()
                # query/hash 제거(표시용)
                base = base.split("?", 1)[0].split("#", 1)[0].strip()
                if not base:
                    continue
                meta = db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == base).limit(1).one_or_none()
                title = str(getattr(meta, "title", "") or "").strip() if meta is not None else ""
                if title:
                    labels[s] = title
        except Exception:
            labels = {}
        return SkusResponse(ok=True, run_id=str(run_id), skus=skus, labels=labels)

    @app.get("/ai/a1/trace/node", response_model=TraceNodeResponse)
    def a1_trace_node(
        node_id: str = Query(...),
        include_blob: bool = Query(False),
        db: Session = Depends(get_db_dep),
    ):
        n = get_node(db, node_id=node_id)
        if n is None:
            raise HTTPException(status_code=404, detail="node not found")
        node_obj = {
            "node_id": str(getattr(n, "node_id", "") or ""),
            "run_id": str(getattr(n, "run_id", "") or ""),
            "sku_id": str(getattr(n, "sku_id", "") or ""),
            "node_type": str(getattr(n, "node_type", "") or ""),
            "title": str(getattr(n, "title", "") or ""),
            "summary_md": str(getattr(n, "summary_md", "") or ""),
            "severity": (str(getattr(n, "severity", "") or "") or None),
            "query_sql": str(getattr(n, "query_sql", "") or "") or None,
            "query_params_json": str(getattr(n, "query_params_json", "") or "") or None,
            "formula": str(getattr(n, "formula", "") or "") or None,
            "blob_id": str(getattr(n, "blob_id", "") or "") or None,
            "content_hash": str(getattr(n, "content_hash", "") or "") or None,
            "content_type": str(getattr(n, "content_type", "") or "") or None,
            "tags_json": str(getattr(n, "tags_json", "") or "") or None,
        }
        blob_obj = None
        if include_blob and node_obj.get("blob_id"):
            b = get_blob(db, blob_id=str(node_obj.get("blob_id")))
            if b is not None:
                blob_obj = {
                    "blob_id": str(getattr(b, "blob_id", "") or ""),
                    "content_type": str(getattr(b, "content_type", "") or ""),
                    "content_hash": str(getattr(b, "content_hash", "") or ""),
                    "size": int(getattr(b, "size", 0) or 0),
                    "content_text": str(getattr(b, "content_text", "") or ""),
                }
        return TraceNodeResponse(ok=True, node=node_obj, blob=blob_obj)

    @app.get("/ai/a1/trace/export", response_model=dict)
    def a1_trace_export(
        run_id: str = Query(...),
        sku_id: str = Query(...),
        include_blobs: bool = Query(True),
        db: Session = Depends(get_db_dep),
    ):
        return export_trace(db, run_id=run_id, sku_id=sku_id, include_blobs=bool(include_blobs))

    @app.post("/ai/a1/trace/verify", response_model=VerifyResponse)
    def a1_trace_verify(req: VerifyRequest, db: Session = Depends(get_db_dep)):
        n = get_node(db, node_id=req.node_id)
        if n is None:
            raise HTTPException(status_code=404, detail="node not found")
        vr = verify_node(db, node=n)
        return VerifyResponse(
            ok=bool(vr.ok),
            match=bool(vr.match),
            message=str(vr.message),
            stored_hash=vr.stored_hash,
            recomputed_hash=vr.recomputed_hash,
            recomputed_preview=vr.recomputed_preview,
        )

    @app.get("/ai/a1/reviews/actions", response_model=ActionReviewListResponse)
    def a1_action_reviews_list(
        run_id: str = Query(...),
        sku_id: str = Query(...),
        db: Session = Depends(get_db_dep),
    ):
        rid = str(run_id or "").strip()
        sid = str(sku_id or "").strip()
        if not rid or not sid:
            raise HTTPException(status_code=400, detail="run_id and sku_id are required")
        rows = (
            db.query(AnalysisActionReview)
            .filter(AnalysisActionReview.run_id == rid, AnalysisActionReview.sku_id == sid)
            .order_by(AnalysisActionReview.updated_at.desc())
            .all()
        )
        items: list[ActionReviewItem] = []
        for r in rows or []:
            ev: list[str] = []
            try:
                raw = str(getattr(r, "evidence_refs_json", "") or "").strip()
                if raw:
                    j = json.loads(raw)
                    if isinstance(j, list):
                        ev = [str(x) for x in j if str(x).strip()]
            except Exception:
                ev = []
            items.append(
                ActionReviewItem(
                    review_id=str(getattr(r, "review_id", "") or ""),
                    run_id=str(getattr(r, "run_id", "") or ""),
                    sku_id=str(getattr(r, "sku_id", "") or ""),
                    action_title=str(getattr(r, "action_title", "") or ""),
                    accepted=bool(getattr(r, "accepted", False)),
                    comment=(str(getattr(r, "comment", "") or "") or None),
                    evidence_refs=ev,
                    created_at=(str(getattr(r, "created_at", "") or "") or None),
                    updated_at=(str(getattr(r, "updated_at", "") or "") or None),
                )
            )
        return ActionReviewListResponse(ok=True, run_id=rid, sku_id=sid, items=items)

    @app.post("/ai/a1/reviews/actions", response_model=ActionReviewUpsertResponse)
    def a1_action_reviews_upsert(req: ActionReviewUpsertRequest, db: Session = Depends(get_db_dep)):
        rid = str(req.run_id or "").strip()
        sid = str(req.sku_id or "").strip()
        title = str(req.action_title or "").strip()
        if not rid or not sid or not title:
            raise HTTPException(status_code=400, detail="run_id, sku_id, action_title are required")

        ev_json = None
        try:
            ev_json = json.dumps([str(x) for x in (req.evidence_refs or []) if str(x).strip()], ensure_ascii=False)
        except Exception:
            ev_json = None

        row = (
            db.query(AnalysisActionReview)
            .filter(AnalysisActionReview.run_id == rid, AnalysisActionReview.sku_id == sid, AnalysisActionReview.action_title == title)
            .limit(1)
            .one_or_none()
        )
        if row is None:
            row = AnalysisActionReview(review_id=str(uuid.uuid4()), run_id=rid, sku_id=sid, action_title=title)
            db.add(row)

        row.accepted = bool(req.accepted)
        row.comment = (str(req.comment or "").strip() or None)
        row.evidence_refs_json = ev_json
        try:
            # updated_at을 DB에 맡기기(표준: CURRENT_TIMESTAMP). sqlite에서는 server_default만 있으므로 수동 갱신.
            row.updated_at = datetime.utcnow()
        except Exception:
            pass

        try:
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="review save failed")

        ev_out: list[str] = []
        try:
            raw = str(getattr(row, "evidence_refs_json", "") or "").strip()
            if raw:
                j = json.loads(raw)
                if isinstance(j, list):
                    ev_out = [str(x) for x in j if str(x).strip()]
        except Exception:
            ev_out = []
        item = ActionReviewItem(
            review_id=str(getattr(row, "review_id", "") or ""),
            run_id=str(getattr(row, "run_id", "") or ""),
            sku_id=str(getattr(row, "sku_id", "") or ""),
            action_title=str(getattr(row, "action_title", "") or ""),
            accepted=bool(getattr(row, "accepted", False)),
            comment=(str(getattr(row, "comment", "") or "") or None),
            evidence_refs=ev_out,
            created_at=(str(getattr(row, "created_at", "") or "") or None),
            updated_at=(str(getattr(row, "updated_at", "") or "") or None),
        )
        return ActionReviewUpsertResponse(ok=True, item=item)

