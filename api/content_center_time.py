from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def kst_tz():
    try:
        return ZoneInfo("Asia/Seoul")
    except ZoneInfoNotFoundError:
        return timezone(timedelta(hours=9), name="KST")


def now_kst() -> datetime:
    return datetime.now(kst_tz())


def today_kst() -> date:
    return now_kst().date()
