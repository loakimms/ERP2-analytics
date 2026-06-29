from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session


def json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def serialize_rows(rows: list[Any], model: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        item: dict[str, Any] = {}
        for column in model.__table__.columns:
            item[column.name] = json_value(getattr(row, column.name))
        out.append(item)
    return out


def order_by_query(db: Session, model: Any, order_fields: tuple[str, ...]):
    query = db.query(model)
    order_columns = [getattr(model, field_name) for field_name in order_fields]
    return query.order_by(*order_columns)


def coerce_value(column: Any, value: Any) -> Any:
    if value is None:
        return None
    python_type = getattr(column.type, "python_type", None)
    if python_type in (datetime, date) and isinstance(value, str):
        try:
            return python_type.fromisoformat(value)
        except Exception:
            return value
    if python_type is Decimal and not isinstance(value, Decimal):
        try:
            return Decimal(str(value))
        except Exception:
            return value
    return value


def upsert_rows(
    db: Session,
    model: Any,
    rows: list[dict[str, Any]],
    key_fields: tuple[str, ...],
    *,
    ignore_columns: set[str] | None = None,
) -> int:
    count = 0
    columns = list(model.__table__.columns)
    ignored = set(ignore_columns or set())
    for item in rows:
        query = db.query(model)
        for key in key_fields:
            query = query.filter(getattr(model, key) == item.get(key))
        row = query.one_or_none()
        if row is None:
            init_values = {}
            for key in key_fields:
                column = model.__table__.columns[key]
                init_values[key] = coerce_value(column, item.get(key))
            row = model(**init_values)
            db.add(row)
        for column in columns:
            if column.name in ignored or column.name not in item:
                continue
            setattr(row, column.name, coerce_value(column, item.get(column.name)))
        count += 1
    return count


def replace_rows_by_scope(
    db: Session,
    model: Any,
    rows: list[dict[str, Any]],
    *,
    scope_field: str,
    scope_values: list[str] | None = None,
) -> int:
    values = sorted(
        {
            str(item.get(scope_field) or "").strip()
            for item in rows
            if str(item.get(scope_field) or "").strip()
        }
    )
    if scope_values:
        values = sorted({*values, *[str(item or "").strip() for item in scope_values if str(item or "").strip()]})
    if values:
        db.query(model).filter(getattr(model, scope_field).in_(values)).delete(synchronize_session=False)
    columns = list(model.__table__.columns)
    auto_names = {
        column.name
        for column in columns
        if getattr(column, "autoincrement", None) is True and bool(getattr(column, "primary_key", False))
    }
    count = 0
    for item in rows:
        payload = {}
        for column in columns:
            if column.name in auto_names or column.name not in item:
                continue
            payload[column.name] = coerce_value(column, item.get(column.name))
        db.add(model(**payload))
        count += 1
    return count
