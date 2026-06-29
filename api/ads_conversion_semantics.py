from __future__ import annotations

from datetime import date


ADS_TOTAL_PURCHASE_CUTOVER = date(2026, 3, 9)

LEGACY_PURCHASE_ONLY = "legacy_purchase_only"
TOTAL_PLUS_PURCHASE = "total_plus_purchase"


def conversion_semantics_for_date(target_date: date) -> str:
    if target_date < ADS_TOTAL_PURCHASE_CUTOVER:
        return LEGACY_PURCHASE_ONLY
    return TOTAL_PLUS_PURCHASE


def normalize_conversion_metrics(
    *,
    target_date: date,
    conversions: int,
    revenue: int,
    purchase_conversions: int,
    purchase_revenue: int,
) -> dict[str, int | str]:
    semantics = conversion_semantics_for_date(target_date)
    total_conv = int(conversions or 0)
    total_rev = int(revenue or 0)
    purchase_conv = int(purchase_conversions or 0)
    purchase_rev = int(purchase_revenue or 0)

    if semantics == LEGACY_PURCHASE_ONLY:
        if purchase_conv <= 0 and total_conv > 0:
            purchase_conv = total_conv
        if purchase_rev <= 0 and total_rev > 0:
            purchase_rev = total_rev
        total_conv = 0
        total_rev = 0

    return {
        "conversion_semantics": semantics,
        "conversions": int(total_conv),
        "revenue": int(total_rev),
        "purchase_conversions": int(purchase_conv),
        "purchase_revenue": int(purchase_rev),
    }
