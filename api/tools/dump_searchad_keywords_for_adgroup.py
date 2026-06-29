import json
import os
import re
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python tools/dump_searchad_keywords_for_adgroup.py <adgroup_id>")
        return 2

    gid = sys.argv[1].strip()
    if not gid:
        print("adgroup_id is required")
        return 2

    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from main import _searchad_get  # type: ignore

    resp = _searchad_get("/ncc/keywords", params={"nccAdgroupId": gid}, timeout=25.0)
    print("status", resp.status_code)
    data = resp.json()
    if not isinstance(data, list):
        print("type", type(data).__name__)
        print(str(data)[:2000])
        return 0

    print("count", len(data))
    sample = data[:10]
    print("top_keys", sorted(list(sample[0].keys()))[:120] if sample and isinstance(sample[0], dict) else None)

    needles = ("rel", "relev", "expect", "exp", "click", "idx", "index", "qi", "qlty", "score", "rank", "rnk")
    print("\n--- candidate scalar fields in first 10 keywords ---")
    for i, kw in enumerate(sample):
        if not isinstance(kw, dict):
            continue
        for k, v in kw.items():
            kl = str(k).lower()
            if any(n in kl for n in needles) and isinstance(v, (str, int, float, bool)) and str(v).strip():
                print(f"[{i}] {k} = {v}")

    try:
        s = json.dumps(sample, ensure_ascii=False, indent=2)
        if len(s) > 5000:
            s = s[:5000] + "\n... (truncated)"
        print("\n--- sample(10) ---\n" + s)
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

