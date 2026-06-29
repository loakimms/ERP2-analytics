from __future__ import annotations

import csv
import io
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path


API_ROOT = os.environ.get("ANALYTICS_API_ROOT", "/app")
if API_ROOT not in sys.path:
    sys.path.insert(0, API_ROOT)

import main  # type: ignore  # noqa: E402
from db import upsert_gfa_daily_records  # type: ignore  # noqa: E402


ROOT = Path(os.environ.get("GFA_LOW_DATA_ROOT", "/tmp/gfa_low_data"))


def _headers_from_csv(data: bytes) -> list[str]:
    text = main._gfa_decode_csv_bytes(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096])
    except Exception:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    return [str(h or "").strip() for h in (reader.fieldnames or [])]


def _classify_unit(headers: list[str]) -> str:
    joined = "|".join(headers)
    creative_aliases = (
        "광고 소재 ID",
        "광고소재ID",
        "소재 ID",
        "소재ID",
        "creative_id",
        "creativeId",
        "Creative ID",
    )
    asset_group_aliases = (
        "광고그룹 ID",
        "광고 그룹 ID",
        "광고그룹ID",
        "에셋 그룹 ID",
        "에셋그룹ID",
        "애셋 그룹 ID",
        "애셋그룹ID",
        "소재 그룹 ID",
        "소재그룹 ID",
        "소재그룹ID",
        "asset_group_id",
        "adgroup_id",
        "adSetNo",
        "Ad Group ID",
    )
    if any(alias in joined for alias in creative_aliases):
        return "CREATIVE"
    if any(alias in joined for alias in asset_group_aliases):
        return "ASSET_GROUP"
    return "CAMPAIGN"


def _file_unit(path: Path) -> tuple[str, int, list[str]]:
    data = path.read_bytes()
    csv_files = main._gfa_extract_csv_files(path.name, data)
    row_count = 0
    first_headers: list[str] = []
    unit = "CAMPAIGN"
    for _, body in csv_files:
        headers = _headers_from_csv(body)
        if not first_headers:
            first_headers = headers
        unit = _classify_unit(headers)
        parsed = main._gfa_parse_report_csv(body, filename=path.name, ad_unit=unit)
        row_count += len(parsed)
        if unit != "CAMPAIGN":
            break
    return unit, row_count, first_headers


def _record_key(record: dict) -> tuple[str, str, str, str, str, str]:
    return (
        str(record.get("date") or ""),
        str(record.get("campaign_id") or "").strip(),
        str(record.get("adgroup_id") or "").strip(),
        str(record.get("creative_id") or "").strip(),
        str(record.get("placement") or "").strip() or "전체",
        str(record.get("audience") or "").strip() or "전체",
    )


def main_import() -> int:
    if not ROOT.exists():
        raise SystemExit(f"GFA_LOW_DATA_ROOT not found: {ROOT}")

    files = sorted(p for p in ROOT.rglob("*.zip") if p.is_file())
    if not files:
        raise SystemExit(f"No zip files found: {ROOT}")

    grouped: dict[str, dict[tuple[str, str, str, str, str, str], dict]] = defaultdict(dict)
    file_summaries: list[dict] = []
    errors: list[dict] = []

    for path in files:
        try:
            data = path.read_bytes()
            csv_files = main._gfa_extract_csv_files(path.name, data)
            first_headers: list[str] = []
            parsed_total = 0
            unit = "CAMPAIGN"
            for inner_name, body in csv_files:
                headers = _headers_from_csv(body)
                if not first_headers:
                    first_headers = headers
                unit = _classify_unit(headers)
                records = main._gfa_parse_report_csv(body, filename=inner_name or path.name, ad_unit=unit)
                parsed_total += len(records)
                for record in records:
                    grouped[unit][_record_key(record)] = record
            file_summaries.append(
                {
                    "file": str(path),
                    "unit": unit,
                    "parsed_rows": parsed_total,
                    "headers": first_headers,
                }
            )
        except Exception as exc:
            errors.append({"file": str(path), "error": f"{type(exc).__name__}: {exc}"})

    inserted_by_unit: dict[str, int] = {}
    unique_by_unit: dict[str, int] = {}
    dates_by_unit: dict[str, list[str]] = {}
    for unit in ("CREATIVE", "CAMPAIGN", "ASSET_GROUP"):
        records = list(grouped.get(unit, {}).values())
        unique_by_unit[unit] = len(records)
        dates_by_unit[unit] = sorted({str(r.get("date") or "") for r in records if str(r.get("date") or "")})
        if not records:
            inserted_by_unit[unit] = 0
            continue
        source = main._gfa_source_for_ad_unit(unit, fallback=main.GFA_CONVERSION_COMPLETE_SOURCE)
        inserted_by_unit[unit] = upsert_gfa_daily_records(records, source=source)

    summary = {
        "ok": not errors,
        "root": str(ROOT),
        "files": len(files),
        "files_by_unit": dict(Counter(item["unit"] for item in file_summaries)),
        "parsed_rows_by_unit": dict(
            (unit, sum(int(item["parsed_rows"] or 0) for item in file_summaries if item["unit"] == unit))
            for unit in ("CREATIVE", "CAMPAIGN", "ASSET_GROUP")
        ),
        "unique_rows_by_unit": unique_by_unit,
        "inserted_by_unit": inserted_by_unit,
        "dates_by_unit": dates_by_unit,
        "errors": errors[:20],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main_import())
