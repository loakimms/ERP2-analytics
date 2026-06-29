from __future__ import annotations

from typing import Iterable

from sqlalchemy.orm import Session

from db import AppSetting


API_PREFIX = "api:"


def _k(name: str) -> str:
    return f"{API_PREFIX}{(name or '').strip()}"


def get_api_settings(db: Session, keys: Iterable[str]) -> dict[str, str]:
    """
    지정된 keys에 대해 저장된 값을 반환한다.
    - 존재하지 않으면 ""(빈 문자열)
    """
    wanted = [str(k or "").strip() for k in keys if str(k or "").strip()]
    if not wanted:
        return {}

    db_keys = [_k(k) for k in wanted]
    rows = db.query(AppSetting).filter(AppSetting.key.in_(db_keys)).all()
    by_key = {r.key: (r.value or "") for r in rows}

    out: dict[str, str] = {}
    for k in wanted:
        out[k] = str(by_key.get(_k(k), "") or "")
    return out


def save_api_settings(db: Session, values: dict[str, str | None]) -> None:
    """
    api:* 네임스페이스로 settings를 upsert한다.
    - value가 None 또는 공백이면 해당 키는 삭제(초기화)한다.
    """
    if not values:
        return

    for k, v in (values or {}).items():
        name = str(k or "").strip()
        if not name:
            continue
        val = "" if v is None else str(v)
        val = val.strip()
        db_key = _k(name)

        if not val:
            db.query(AppSetting).filter(AppSetting.key == db_key).delete()
            continue

        row = db.query(AppSetting).filter(AppSetting.key == db_key).one_or_none()
        if row is None:
            db.add(AppSetting(key=db_key, value=val))
        else:
            row.value = val

    db.commit()

