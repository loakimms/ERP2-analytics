from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable


HEALTH_STATUSES = {"USABLE", "PARTIAL", "STALE", "MISSING", "BLOCKED"}


@dataclass(frozen=True)
class SourceHealth:
    source_id: str
    status: str
    as_of: date | None = None
    required: bool = True
    reason: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "status": self.status,
            "as_of": self.as_of.isoformat() if self.as_of else None,
            "required": self.required,
            "reason": self.reason,
            "details": dict(self.details or {}),
        }


@dataclass(frozen=True)
class WhyHealthGateResult:
    status: str
    usable: bool
    sources: list[SourceHealth]
    blocked_reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "usable": self.usable,
            "sources": [s.to_dict() for s in self.sources],
            "blocked_reasons": list(self.blocked_reasons or []),
        }


def collection_source_health(
    *,
    source_id: str,
    target_date: date,
    latest_success_date: date | None,
    freshness_days: int = 1,
    required: bool = True,
) -> SourceHealth:
    if latest_success_date is None:
        return SourceHealth(source_id, "MISSING", None, required, "latest_success_missing")
    stale_days = (target_date - latest_success_date).days
    if stale_days < 0:
        stale_days = 0
    if stale_days > max(0, int(freshness_days or 0)):
        return SourceHealth(
            source_id,
            "STALE",
            latest_success_date,
            required,
            "freshness_window_exceeded",
            {"stale_days": stale_days, "freshness_days": int(freshness_days or 0)},
        )
    return SourceHealth(source_id, "USABLE", latest_success_date, required, details={"stale_days": stale_days})


def evaluate_why_health(sources: Iterable[SourceHealth], *, require_all: bool = False) -> WhyHealthGateResult:
    items = list(sources or [])
    if not items:
        return WhyHealthGateResult("BLOCKED", False, [], ["no_sources"])

    blocked = [s for s in items if s.status == "BLOCKED" and s.required]
    missing = [s for s in items if s.status == "MISSING" and s.required]
    stale = [s for s in items if s.status == "STALE" and s.required]
    partial = [s for s in items if s.status == "PARTIAL"]
    usable = [s for s in items if s.status == "USABLE"]

    reasons = [f"{s.source_id}:{s.reason or s.status}" for s in [*blocked, *missing, *stale]]
    if blocked or (require_all and (missing or stale)):
        return WhyHealthGateResult("BLOCKED", False, items, reasons)
    if missing or stale:
        return WhyHealthGateResult("PARTIAL", True, items, reasons)
    if partial:
        return WhyHealthGateResult("PARTIAL", True, items, [])
    if usable:
        return WhyHealthGateResult("USABLE", True, items, [])
    return WhyHealthGateResult("BLOCKED", False, items, ["no_usable_source"])


def source_health(source_id: str, status: str, *, required: bool = True, reason: str | None = None) -> SourceHealth:
    status0 = str(status or "").strip().upper()
    if status0 not in HEALTH_STATUSES:
        raise ValueError(f"invalid health status: {status}")
    return SourceHealth(str(source_id or "").strip(), status0, required=required, reason=reason)

