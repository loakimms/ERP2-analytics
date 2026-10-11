from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from content_center_time import now_kst
from db import A1SkuMap, ContentClaimPolicy, ContentSkuScope, TrackedProductMeta
from sku_identity import build_sku_identity, canonicalize_product_url


PHASE1_HENNA_LIMIT = 1
PHASE1_HERB_PACK_LIMIT = 4
UNIVERSE_LIMIT = 7

DEFAULT_CLAIM_POLICIES = (
    ("PROHIBITED", "탈모", "의학적 탈모 효능 표현 금지"),
    ("PROHIBITED", "치료", "질병 치료 표현 금지"),
    ("PROHIBITED", "두피염", "질환 개선 표현 금지"),
    ("PROHIBITED", "아토피", "질환 효능 표현 금지"),
    ("PROHIBITED", "암 예방", "질병 예방 표현 금지"),
    ("RESTRICTED", "좋아졌다", "고객 경험은 광고 단정으로 쓰지 않음"),
    ("RESTRICTED", "줄었다", "고객 경험은 광고 단정으로 쓰지 않음"),
)


def classify_product_group(title: object, keyword: object = None) -> str:
    text = f"{title or ''} {keyword or ''}"
    if any(token in text for token in ("허브팩", "헤어팩", "헤나팩")):
        return "herb_pack"
    if "팩" in text and any(token in text for token in ("헤나", "허브")):
        return "herb_pack"
    if "헤나" in text and not any(token in text for token in ("샴푸", "오일", "호호바")):
        return "henna"
    return "other"


def _now():
    return now_kst()


def ensure_claim_policies(db: Session) -> int:
    existing = {str(row.pattern or "") for row in db.query(ContentClaimPolicy).all()}
    added = 0
    for claim_class, pattern, note in DEFAULT_CLAIM_POLICIES:
        if pattern in existing:
            continue
        db.add(
            ContentClaimPolicy(
                policy_id=f"claim-{claim_class.lower()}-{len(existing) + added + 1:03d}",
                claim_class=claim_class,
                pattern=pattern,
                note=note,
                is_active=True,
            )
        )
        added += 1
    if added:
        db.commit()
    return added


def _upsert_a1_map(db: Session, *, sku_id: str, product_url: str | None, product_id_catalog: int | None) -> None:
    row = db.query(A1SkuMap).filter(A1SkuMap.sku_id == sku_id).one_or_none()
    if row is None:
        db.add(
            A1SkuMap(
                sku_id=sku_id,
                product_url=product_url,
                product_id_catalog=product_id_catalog,
                note="content_center_scope",
            )
        )
        return
    row.product_url = product_url or row.product_url
    if product_id_catalog is not None:
        row.product_id_catalog = product_id_catalog
    row.updated_at = _now()


def sync_content_sku_scope(db: Session) -> dict[str, Any]:
    """Pin the ads-analysis product universe and mark phase-1 SKUs."""
    ensure_claim_policies(db)
    metas = (
        db.query(TrackedProductMeta)
        .order_by(TrackedProductMeta.updated_at.desc(), TrackedProductMeta.id.asc())
        .all()
    )
    classified: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for meta in metas:
        url = canonicalize_product_url(getattr(meta, "product_url", None)) or str(getattr(meta, "product_url", "") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        pid = getattr(meta, "product_id_catalog", None)
        sku_id = str(int(pid)) if pid not in (None, "") else url
        identity = build_sku_identity(
            sku_id=sku_id,
            product_url=url,
            product_id_catalog=pid,
            source="tracked_product_meta",
        )
        classified.append(
            {
                "sku_id": identity.sku_id,
                "product_url": identity.product_url,
                "product_id_catalog": identity.product_id_catalog,
                "title": str(getattr(meta, "title", "") or "").strip(),
                "keyword": str(getattr(meta, "keyword", "") or "").strip(),
                "product_group": classify_product_group(getattr(meta, "title", None), getattr(meta, "keyword", None)),
            }
        )
        if len(classified) >= UNIVERSE_LIMIT:
            break

    henna_kept = 0
    herb_kept = 0
    rows_out: list[ContentSkuScope] = []
    for item in classified:
        phase1 = False
        if item["product_group"] == "henna" and henna_kept < PHASE1_HENNA_LIMIT:
            phase1 = True
            henna_kept += 1
        elif item["product_group"] == "herb_pack" and herb_kept < PHASE1_HERB_PACK_LIMIT:
            phase1 = True
            herb_kept += 1
        row = db.query(ContentSkuScope).filter(ContentSkuScope.sku_id == item["sku_id"]).one_or_none()
        if row is None:
            row = ContentSkuScope(sku_id=item["sku_id"])
            db.add(row)
        row.product_url = item["product_url"]
        row.product_id_catalog = item["product_id_catalog"]
        row.title = item["title"]
        row.product_group = item["product_group"]
        row.phase1_enabled = phase1
        row.is_active = True
        row.updated_at = _now()
        _upsert_a1_map(
            db,
            sku_id=item["sku_id"],
            product_url=item["product_url"],
            product_id_catalog=item["product_id_catalog"],
        )
        rows_out.append(row)

    db.commit()
    return {
        "ok": True,
        "universe_count": len(rows_out),
        "phase1_count": sum(1 for row in rows_out if row.phase1_enabled),
        "henna_enabled": henna_kept,
        "herb_pack_enabled": herb_kept,
        "items": [sku_scope_to_dict(row) for row in rows_out],
    }


def sku_scope_to_dict(row: ContentSkuScope) -> dict[str, Any]:
    return {
        "sku_id": row.sku_id,
        "product_url": row.product_url,
        "product_id_catalog": int(row.product_id_catalog) if row.product_id_catalog is not None else None,
        "title": row.title,
        "product_group": row.product_group,
        "phase1_enabled": bool(row.phase1_enabled),
        "is_active": bool(row.is_active),
    }


def list_sku_scope(db: Session, *, phase1_only: bool = False) -> list[ContentSkuScope]:
    q = db.query(ContentSkuScope).filter(ContentSkuScope.is_active.is_(True))
    if phase1_only:
        q = q.filter(ContentSkuScope.phase1_enabled.is_(True))
    return q.order_by(ContentSkuScope.product_group.asc(), ContentSkuScope.sku_id.asc()).all()


def set_sku_phase1(db: Session, sku_id: str, enabled: bool) -> ContentSkuScope:
    row = db.query(ContentSkuScope).filter(ContentSkuScope.sku_id == str(sku_id or "").strip()).one_or_none()
    if row is None:
        raise ValueError("sku_not_found")
    row.phase1_enabled = bool(enabled)
    row.updated_at = _now()
    db.commit()
    return row
