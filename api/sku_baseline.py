from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import mean
from typing import Any, Iterable


@dataclass(frozen=True)
class BaselineResult:
    kind: str
    status: str
    value: float | None
    count: int
    date_from: date | None
    date_to: date | None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "status": self.status,
            "value": self.value,
            "count": self.count,
            "date_from": self.date_from.isoformat() if self.date_from else None,
            "date_to": self.date_to.isoformat() if self.date_to else None,
            "details": dict(self.details or {}),
        }


def weekday_baseline(
    points: Iterable[dict[str, Any]],
    *,
    target_date: date,
    date_key: str = "date",
    value_key: str = "value",
    min_points: int = 2,
) -> BaselineResult:
    values = []
    dates = []
    for item in points or []:
        d = _as_date(item.get(date_key))
        if d is None or d >= target_date or d.weekday() != target_date.weekday():
            continue
        value = _as_float(item.get(value_key))
        if value is None:
            continue
        values.append(value)
        dates.append(d)
    return _result("weekday", values, dates, min_points=min_points, details={"target_weekday": target_date.weekday()})


def four_week_baseline(
    points: Iterable[dict[str, Any]],
    *,
    target_date: date,
    date_key: str = "date",
    value_key: str = "value",
    min_points: int = 7,
) -> BaselineResult:
    start = target_date - timedelta(days=28)
    end = target_date - timedelta(days=1)
    values = []
    dates = []
    for item in points or []:
        d = _as_date(item.get(date_key))
        if d is None or d < start or d > end:
            continue
        value = _as_float(item.get(value_key))
        if value is None:
            continue
        values.append(value)
        dates.append(d)
    return _result("four_week", values, dates, min_points=min_points, details={"window_days": 28})


def _result(kind: str, values: list[float], dates: list[date], *, min_points: int, details: dict[str, Any]) -> BaselineResult:
    if not values:
        return BaselineResult(kind, "MISSING", None, 0, None, None, details)
    status = "USABLE" if len(values) >= max(1, int(min_points or 1)) else "PARTIAL"
    return BaselineResult(kind, status, float(mean(values)), len(values), min(dates), max(dates), details)


def _as_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "").strip()[:10])
    except Exception:
        return None


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None

