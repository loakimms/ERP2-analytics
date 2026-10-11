from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from enum import Enum

from content_center_time import kst_tz, today_kst


OPERATING_ANALYSIS_WINDOW = "ROLLING_6_MONTHS_INCLUDING_TODAY"


class AnalysisMode(str, Enum):
    OPERATING = "OPERATING"
    DEBUG_PARTIAL = "DEBUG_PARTIAL"
    VALIDATION_PARTIAL = "VALIDATION_PARTIAL"


@dataclass(frozen=True)
class AnalysisWindow:
    mode: AnalysisMode
    as_of: date
    window_start: datetime
    window_end: datetime
    window_type: str

    @property
    def start_date(self) -> date:
        return self.window_start.date()

    @property
    def end_date_exclusive(self) -> date:
        return self.window_end.date()


def _subtract_calendar_months(value: date, months: int) -> date:
    year = value.year
    month = value.month - months
    while month <= 0:
        month += 12
        year -= 1
    days_by_month = (31, 29 if _is_leap_year(year) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    return date(year, month, min(value.day, days_by_month[month - 1]))


def _is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _at_kst_start(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=kst_tz())


def resolve_analysis_window(
    *,
    mode: AnalysisMode | str = AnalysisMode.OPERATING,
    as_of: date | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> AnalysisWindow:
    mode_value = mode.value if isinstance(mode, AnalysisMode) else str(mode or AnalysisMode.OPERATING.value)
    resolved_mode = AnalysisMode(mode_value.upper())
    resolved_as_of = as_of or today_kst()
    if resolved_mode == AnalysisMode.OPERATING:
        start = _subtract_calendar_months(resolved_as_of, 6)
        end_exclusive = resolved_as_of + timedelta(days=1)
        return AnalysisWindow(
            mode=resolved_mode,
            as_of=resolved_as_of,
            window_start=_at_kst_start(start),
            window_end=_at_kst_start(end_exclusive),
            window_type=OPERATING_ANALYSIS_WINDOW,
        )
    if start_date is None or end_date is None:
        raise ValueError("partial_analysis_requires_explicit_start_end")
    if end_date < start_date:
        raise ValueError("partial_analysis_end_before_start")
    return AnalysisWindow(
        mode=resolved_mode,
        as_of=resolved_as_of,
        window_start=_at_kst_start(start_date),
        window_end=_at_kst_start(end_date + timedelta(days=1)),
        window_type=resolved_mode.value,
    )
