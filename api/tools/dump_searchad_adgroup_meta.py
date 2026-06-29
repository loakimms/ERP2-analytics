import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python tools/dump_searchad_adgroup_meta.py <adgroup_id>")
        return 2

    gid = sys.argv[1].strip()
    if not gid:
        print("adgroup_id is required")
        return 2

    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from main import _searchad_get  # type: ignore

    resp = _searchad_get(f"/ncc/adgroups/{gid}", timeout=25.0)
    print("status", resp.status_code)
    j = resp.json()
    if isinstance(j, dict):
        print("top_keys", sorted(list(j.keys()))[:120])
    try:
        s = json.dumps(j, ensure_ascii=False, indent=2)
        if len(s) > 5000:
            s = s[:5000] + "\n... (truncated)"
        print(s)
    except Exception:
        print(j)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

