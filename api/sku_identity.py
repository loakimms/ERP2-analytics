from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
import re
from typing import Any


@dataclass(frozen=True)
class CanonicalSkuIdentity:
    sku_id: str
    product_url: str | None = None
    product_id_catalog: int | None = None
    channel_product_id: str | None = None
    source: str = "manual"
    aliases: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sku_id": self.sku_id,
            "product_url": self.product_url,
            "product_id_catalog": self.product_id_catalog,
            "channel_product_id": self.channel_product_id,
            "source": self.source,
            "aliases": dict(self.aliases or {}),
        }


@dataclass(frozen=True)
class JoinGuardResult:
    allowed: bool
    code: str
    message: str
    expected: dict[str, Any] = field(default_factory=dict)
    actual: dict[str, Any] = field(default_factory=dict)


def canonicalize_product_url(value: object) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        from urllib.parse import urlsplit, urlunsplit

        parts = urlsplit(raw)
        host = str(parts.netloc or "").lower()
        if "smartstore.naver.com" in host:
            return urlunsplit((parts.scheme or "https", parts.netloc, parts.path.rstrip("/"), "", ""))
        return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), parts.query, ""))
    except Exception:
        return raw.split("#", 1)[0].strip() or None


def product_id_from_url(value: object) -> str | None:
    url = canonicalize_product_url(value)
    if not url:
        return None
    match = re.search(r"/products/(\d+)", url)
    return match.group(1) if match else None


def build_sku_identity(
    *,
    sku_id: object,
    product_url: object | None = None,
    product_id_catalog: object | None = None,
    channel_product_id: object | None = None,
    source: str = "manual",
    aliases: dict[str, str] | None = None,
) -> CanonicalSkuIdentity:
    sku0 = str(sku_id or "").strip()
    if not sku0:
        raise ValueError("sku_id is required")

    pid_catalog: int | None = None
    if product_id_catalog not in (None, ""):
        pid_catalog = int(product_id_catalog)  # fail fast on invalid ids

    return CanonicalSkuIdentity(
        sku_id=sku0,
        product_url=canonicalize_product_url(product_url),
        product_id_catalog=pid_catalog,
        channel_product_id=(str(channel_product_id).strip() if channel_product_id not in (None, "") else None),
        source=str(source or "manual").strip() or "manual",
        aliases=dict(aliases or {}),
    )


def resolve_sku_identity(db: Any, *, sku_id: str | None = None, product_url: str | None = None) -> CanonicalSkuIdentity | None:
    """
    Read-only resolver for the minimal P01 identity boundary.

    It consumes existing `A1SkuMap` and `TrackedProductMeta` rows when available,
    but never creates or updates persistence.
    """
    sku0 = str(sku_id or "").strip()
    url0 = canonicalize_product_url(product_url)
    try:
        from db import A1SkuMap, TrackedProductMeta
    except Exception:
        return build_sku_identity(sku_id=sku0 or url0, product_url=url0, source="input") if (sku0 or url0) else None

    if sku0:
        row = db.query(A1SkuMap).filter(A1SkuMap.sku_id == sku0).one_or_none()
        if row is not None:
            return build_sku_identity(
                sku_id=getattr(row, "sku_id", sku0),
                product_url=getattr(row, "product_url", None),
                product_id_catalog=getattr(row, "product_id_catalog", None),
                source="a1_sku_map",
            )

    if url0:
        row = db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == url0).one_or_none()
        if row is not None:
            return build_sku_identity(
                sku_id=sku0 or url0,
                product_url=getattr(row, "product_url", url0),
                product_id_catalog=getattr(row, "product_id_catalog", None),
                source="tracked_product_meta",
            )

    if sku0 or url0:
        return build_sku_identity(sku_id=sku0 or url0, product_url=url0, source="input")
    return None


def validate_identity_join(
    expected: CanonicalSkuIdentity,
    actual: CanonicalSkuIdentity,
    *,
    domain: str,
    date_from: date | None,
    date_to: date | None,
    lineage: str | None,
) -> JoinGuardResult:
    if date_from is not None and date_to is not None and date_from > date_to:
        return _blocked("INVALID_DATE_WINDOW", "date_from must be before or equal to date_to", expected, actual)
    if not str(lineage or "").strip():
        return _blocked("MISSING_LINEAGE", "join lineage is required", expected, actual)
    if expected.sku_id and actual.sku_id and expected.sku_id != actual.sku_id:
        return _blocked("SKU_MISMATCH", f"sku mismatch for {domain}", expected, actual)
    if expected.product_url and actual.product_url and expected.product_url != actual.product_url:
        return _blocked("URL_IDENTITY_MISMATCH", f"product_url mismatch for {domain}", expected, actual)
    if expected.product_id_catalog and actual.product_id_catalog and expected.product_id_catalog != actual.product_id_catalog:
        return _blocked("PRODUCT_ID_MISMATCH", f"catalog product id mismatch for {domain}", expected, actual)
    if expected.channel_product_id and actual.channel_product_id and expected.channel_product_id != actual.channel_product_id:
        return _blocked("CHANNEL_PRODUCT_ID_MISMATCH", f"channel product id mismatch for {domain}", expected, actual)
    return JoinGuardResult(True, "PASS", "join allowed", expected.to_dict(), actual.to_dict())


def _blocked(code: str, message: str, expected: CanonicalSkuIdentity, actual: CanonicalSkuIdentity) -> JoinGuardResult:
    return JoinGuardResult(False, code, message, expected.to_dict(), actual.to_dict())

