import json
import os
import re
import sys


def _walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            ks = str(k)
            p = f"{path}.{ks}" if path else ks
            yield p, v
            yield from _walk(v, p)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:50]):
            p = f"{path}[{i}]"
            yield p, v
            yield from _walk(v, p)


def main() -> int:
    # Usage:
    #   python tools/dump_searchad_ad_meta.py nad-xxxx
    if len(sys.argv) < 2:
        print("Usage: python tools/dump_searchad_ad_meta.py <ad_id>")
        return 2

    adid = sys.argv[1].strip()
    if not adid:
        print("ad_id is required")
        return 2

    # Ensure main.py is importable
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from main import _searchad_get  # type: ignore

    resp = _searchad_get(f"/ncc/ads/{adid}", timeout=25.0)
    print("status", resp.status_code)
    data = resp.json()

    if isinstance(data, dict):
        print("top_keys", sorted(list(data.keys()))[:120])
    else:
        print("type", type(data).__name__, "len", (len(data) if hasattr(data, "__len__") else None))

    # Print candidate fields that may map to bid/quality/rank/relevance/expected click
    needles = (
        "bid",
        "cpc",
        "qlty",
        "qual",
        "rank",
        "rnk",
        "rel",
        "relev",
        "expect",
        "exp",
        "click",
        "idx",
        "index",
        "score",
        "pos",
    )

    hits = []
    for p, v in _walk(data):
        key = p.split(".")[-1].lower()
        if any(n in key for n in needles) and isinstance(v, (str, int, float, bool)) and str(v).strip():
            hits.append((p, v))

    print("\n--- candidate scalar fields (path=value) ---")
    for p, v in hits[:200]:
        print(p, "=", v)

    # Print a small subset for manual inspection (usually enough to map bid/quality/rank indexes)
    def _print_section(name: str, obj: object):
        try:
            s = json.dumps(obj, ensure_ascii=False, indent=2)
            if len(s) > 4000:
                s = s[:4000] + "\n... (truncated)"
            print(f"\n--- {name} ---\n{s}")
        except Exception:
            print(f"\n--- {name} ---\n{obj}")

    if isinstance(data, dict):
        for k in ("type", "status", "inspectStatus", "enable", "nccQi"):
            if k in data:
                print(f"\n{ k } =", data.get(k))
        for k in ("nccAdId", "nccAdgroupId"):
            if k in data:
                print(f"\n{ k } =", data.get(k))
        if "adAttr" in data:
            _print_section("adAttr", data.get("adAttr"))
        if "userLock" in data:
            _print_section("userLock", data.get("userLock"))
        if "assets" in data:
            _print_section("assets", data.get("assets"))
        if "referenceData" in data:
            _print_section("referenceData", data.get("referenceData"))
        if "ad" in data:
            _print_section("ad", data.get("ad"))

    # Also print JSON (redacted-ish) size only; avoid dumping full payload by default
    try:
        s = json.dumps(data, ensure_ascii=False)
        print("\njson_len", len(s))
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

