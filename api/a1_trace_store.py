from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

from db import AnalysisBlob, AnalysisRun, AnalysisTraceEdge, AnalysisTraceNode


def _utc_now_iso() -> str:
    try:
        return datetime.utcnow().isoformat() + "Z"
    except Exception:
        return ""


def _json_default(v: Any) -> Any:
    """
    JSON 직렬화 안전장치.
    - Date/Datetime 등은 isoformat으로 직렬화한다.
    - 그 외 타입은 명시적으로 실패시켜 '조용한 누락'을 막는다.
    """
    try:
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, Date):
            return v.isoformat()
    except Exception:
        pass
    raise TypeError(f"Object of type {type(v).__name__} is not JSON serializable")


def canonical_json_dumps(obj: Any) -> str:
    """
    해시/스냅샷 안정성을 위한 canonical JSON 문자열.
    - key 정렬, 공백 최소화
    """
    # NOTE: query_params/row snapshots에 Date 타입이 들어올 수 있어 default를 제공한다.
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)


def sha256_hex(text_value: str) -> str:
    b = (text_value or "").encode("utf-8", errors="replace")
    return hashlib.sha256(b).hexdigest()


def upsert_blob(db: Session, *, content_type: str, content_text: str) -> AnalysisBlob:
    """
    content_hash 기반 dedupe.
    """
    ct = str(content_type or "json").strip() or "json"
    txt = str(content_text or "")
    h = sha256_hex(txt)
    size = len(txt.encode("utf-8", errors="replace"))

    row = db.query(AnalysisBlob).filter(AnalysisBlob.content_hash == h).one_or_none()
    if row is not None:
        return row

    blob = AnalysisBlob(
        blob_id=str(uuid.uuid4()),
        content_type=ct,
        content_text=txt,
        content_hash=h,
        size=int(size),
    )
    db.add(blob)
    db.commit()
    db.refresh(blob)
    return blob


def create_run(
    db: Session,
    *,
    analysis_type: str,
    run_date: Date,
    surface: str,
    action_version: str,
    model: str | None,
    status: str,
    actor: str | None = None,
    code_version: str | None = None,
) -> AnalysisRun:
    run = AnalysisRun(
        run_id=str(uuid.uuid4()),
        analysis_type=str(analysis_type or "A-1"),
        run_date=run_date,
        surface=str(surface or "mobile_integrated"),
        action_version=str(action_version or "A1_V1"),
        model=(str(model).strip() if model else None),
        status=str(status or "SUCCESS"),
        actor=(str(actor).strip() if actor else None),
        code_version=(str(code_version).strip() if code_version else None),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def create_node(
    db: Session,
    *,
    run_id: str,
    sku_id: str,
    node_type: str,
    title: str,
    summary_md: str,
    severity: str | None = None,
    sort_key: int = 0,
    tags: dict | list | None = None,
    query_sql: str | None = None,
    query_params: dict | None = None,
    formula: str | None = None,
    blob: AnalysisBlob | None = None,
) -> AnalysisTraceNode:
    node = AnalysisTraceNode(
        node_id=str(uuid.uuid4()),
        run_id=str(run_id or ""),
        sku_id=str(sku_id or ""),
        node_type=str(node_type or "UNKNOWN"),
        title=str(title or ""),
        summary_md=str(summary_md or ""),
        severity=(str(severity).strip() if severity else None),
        query_sql=(str(query_sql) if query_sql else None),
        query_params_json=(canonical_json_dumps(query_params) if query_params else None),
        formula=(str(formula) if formula else None),
        blob_id=(str(blob.blob_id) if blob is not None else None),
        content_hash=(str(blob.content_hash) if blob is not None else None),
        content_type=(str(blob.content_type) if blob is not None else None),
        sort_key=int(sort_key or 0),
        tags_json=(canonical_json_dumps(tags) if tags is not None else None),
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


def create_edge(
    db: Session,
    *,
    run_id: str,
    from_node_id: str,
    to_node_id: str,
    edge_type: str,
    label: str | None = None,
) -> None:
    row = AnalysisTraceEdge(
        run_id=str(run_id or ""),
        from_node_id=str(from_node_id or ""),
        to_node_id=str(to_node_id or ""),
        edge_type=str(edge_type or "derives_from"),
        label=(str(label) if label is not None else None),
    )
    db.add(row)
    db.commit()


def list_runs(
    db: Session,
    *,
    analysis_type: str = "A-1",
    date_from: Date | None = None,
    date_to: Date | None = None,
    status: str | None = None,
    limit: int = 30,
) -> list[AnalysisRun]:
    q = db.query(AnalysisRun).filter(AnalysisRun.analysis_type == str(analysis_type or "A-1"))
    if date_from is not None:
        q = q.filter(AnalysisRun.run_date >= date_from)
    if date_to is not None:
        q = q.filter(AnalysisRun.run_date <= date_to)
    if status:
        q = q.filter(AnalysisRun.status == str(status))
    q = q.order_by(AnalysisRun.run_date.desc(), AnalysisRun.created_at.desc(), AnalysisRun.run_id.desc())
    return q.limit(max(1, min(200, int(limit or 30)))).all()


def get_tree(
    db: Session,
    *,
    run_id: str,
    sku_id: str,
) -> tuple[list[AnalysisTraceNode], list[AnalysisTraceEdge]]:
    rid = str(run_id or "").strip()
    sid = str(sku_id or "").strip()
    nodes = (
        db.query(AnalysisTraceNode)
        .filter(AnalysisTraceNode.run_id == rid, AnalysisTraceNode.sku_id == sid)
        .order_by(AnalysisTraceNode.sort_key.asc(), AnalysisTraceNode.created_at.asc(), AnalysisTraceNode.node_id.asc())
        .all()
    )
    edges = db.query(AnalysisTraceEdge).filter(AnalysisTraceEdge.run_id == rid).all()
    return (nodes, edges)


def list_skus_for_run(db: Session, *, run_id: str, limit: int = 500) -> list[str]:
    rid = str(run_id or "").strip()
    if not rid:
        return []
    rows = (
        db.query(AnalysisTraceNode.sku_id)
        .filter(AnalysisTraceNode.run_id == rid)
        .distinct()
        .limit(max(1, min(2000, int(limit or 500))))
        .all()
    )
    out: list[str] = []
    for (sid,) in rows or []:
        s = str(sid or "").strip()
        if s:
            out.append(s)
    return sorted(set(out))


def get_run(db: Session, *, run_id: str) -> AnalysisRun | None:
    rid = str(run_id or "").strip()
    if not rid:
        return None
    return db.query(AnalysisRun).filter(AnalysisRun.run_id == rid).one_or_none()


def export_trace(db: Session, *, run_id: str, sku_id: str, include_blobs: bool = True) -> dict[str, Any]:
    """
    감사를 위한 단일 JSON export.
    - UI/다운로드에서 사용 가능
    """
    rid = str(run_id or "").strip()
    sid = str(sku_id or "").strip()
    run = get_run(db, run_id=rid)
    nodes, edges = get_tree(db, run_id=rid, sku_id=sid)

    node_objs: list[dict] = []
    blob_ids: set[str] = set()
    for n in nodes or []:
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
            "sort_key": int(getattr(n, "sort_key", 0) or 0),
            "tags_json": str(getattr(n, "tags_json", "") or "") or None,
        }
        if node_obj.get("blob_id"):
            blob_ids.add(str(node_obj["blob_id"]))
        node_objs.append(node_obj)

    edge_objs: list[dict] = []
    for e in edges or []:
        edge_objs.append(
            {
                "from_node_id": str(getattr(e, "from_node_id", "") or ""),
                "to_node_id": str(getattr(e, "to_node_id", "") or ""),
                "edge_type": str(getattr(e, "edge_type", "") or ""),
                "label": str(getattr(e, "label", "") or ""),
            }
        )

    blobs_obj: list[dict] = []
    if include_blobs and blob_ids:
        rows = db.query(AnalysisBlob).filter(AnalysisBlob.blob_id.in_(sorted(blob_ids))).all()
        for b in rows or []:
            blobs_obj.append(
                {
                    "blob_id": str(getattr(b, "blob_id", "") or ""),
                    "content_type": str(getattr(b, "content_type", "") or ""),
                    "content_hash": str(getattr(b, "content_hash", "") or ""),
                    "size": int(getattr(b, "size", 0) or 0),
                    "content_text": str(getattr(b, "content_text", "") or ""),
                }
            )

    run_obj = None
    if run is not None:
        run_obj = {
            "run_id": str(getattr(run, "run_id", "") or ""),
            "analysis_type": str(getattr(run, "analysis_type", "") or ""),
            "run_date": str(getattr(run, "run_date", "") or ""),
            "surface": str(getattr(run, "surface", "") or ""),
            "action_version": str(getattr(run, "action_version", "") or ""),
            "model": str(getattr(run, "model", "") or ""),
            "status": str(getattr(run, "status", "") or ""),
            "created_at": str(getattr(run, "created_at", "") or ""),
        }

    return {
        "ok": True,
        "run": run_obj,
        "sku_id": sid,
        "nodes": node_objs,
        "edges": edge_objs,
        "blobs": blobs_obj if include_blobs else [],
    }


def get_node(db: Session, *, node_id: str) -> AnalysisTraceNode | None:
    nid = str(node_id or "").strip()
    if not nid:
        return None
    return db.query(AnalysisTraceNode).filter(AnalysisTraceNode.node_id == nid).one_or_none()


def get_blob(db: Session, *, blob_id: str) -> AnalysisBlob | None:
    bid = str(blob_id or "").strip()
    if not bid:
        return None
    return db.query(AnalysisBlob).filter(AnalysisBlob.blob_id == bid).one_or_none()


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    match: bool
    message: str
    stored_hash: str | None
    recomputed_hash: str | None
    recomputed_preview: str | None = None


def verify_node(db: Session, *, node: AnalysisTraceNode, limit_preview: int = 4000) -> VerifyResult:
    """
    node.query_sql/query_params_json 이 존재할 때만 재계산 가능.
    - query는 반드시 서버가 저장한 템플릿(화이트리스트)이어야 한다는 전제하에 실행한다.
    """
    qsql = str(getattr(node, "query_sql", "") or "").strip()
    qparams_raw = str(getattr(node, "query_params_json", "") or "").strip()
    stored_hash = str(getattr(node, "content_hash", "") or "") or None
    if not qsql or not qparams_raw:
        return VerifyResult(ok=True, match=False, message="NO_QUERY", stored_hash=stored_hash, recomputed_hash=None)

    # 안전장치(최소):
    # - 임의 SQL 실행을 막기 위해 SELECT 단일 statement만 허용한다.
    # - 세미콜론/쓰기 키워드가 있으면 거부한다.
    qsql_low = qsql.lower().strip()
    if not qsql_low.startswith("select "):
        return VerifyResult(ok=False, match=False, message="QUERY_NOT_ALLOWED", stored_hash=stored_hash, recomputed_hash=None)
    if ";" in qsql_low:
        return VerifyResult(ok=False, match=False, message="QUERY_NOT_ALLOWED", stored_hash=stored_hash, recomputed_hash=None)
    for bad in ("insert ", "update ", "delete ", "drop ", "alter ", "create ", "truncate "):
        if bad in qsql_low:
            return VerifyResult(ok=False, match=False, message="QUERY_NOT_ALLOWED", stored_hash=stored_hash, recomputed_hash=None)

    try:
        params = json.loads(qparams_raw)
        if not isinstance(params, dict):
            params = {}
    except Exception:
        params = {}

    try:
        res = db.execute(text(qsql), params)
        # row 형태를 JSON화(결정론적): list[dict]
        rows = []
        for r in res.mappings().all():
            rows.append({k: r.get(k) for k in sorted(r.keys())})
        txt = canonical_json_dumps(rows)
        rh = sha256_hex(txt)
        preview = txt[:limit_preview] + ("…" if len(txt) > limit_preview else "")
        return VerifyResult(
            ok=True,
            match=(stored_hash == rh) if stored_hash else False,
            message="OK",
            stored_hash=stored_hash,
            recomputed_hash=rh,
            recomputed_preview=preview,
        )
    except Exception as e:
        return VerifyResult(ok=False, match=False, message=f"VERIFY_FAILED:{e}", stored_hash=stored_hash, recomputed_hash=None)

