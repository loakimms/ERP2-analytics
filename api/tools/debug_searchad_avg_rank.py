import sys
import os
from typing import Any


def _get(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    return None


def main() -> int:
    """
    SearchAd stat-reports(AD, level=ad)에서 avgRnk 제공 여부를 점검한다.

    Usage:
      python tools/debug_searchad_avg_rank.py YYYY-MM-DD [nadId] [mode]
        mode:
          - default: fields=["impCnt","clkCnt","salesAmt","avgRnk","qltyIdx","bidAmt"]
          - pcmobile: fields+=["avgRnkPc","avgRnkMobile"]
    """
    if len(sys.argv) < 2:
        print("usage: python tools/debug_searchad_avg_rank.py YYYY-MM-DD [nadId]")
        return 2

    date_ymd = sys.argv[1].strip()
    target_adid = sys.argv[2].strip() if len(sys.argv) >= 3 else ""
    mode = sys.argv[3].strip().lower() if len(sys.argv) >= 4 else "default"

    # 컨테이너에서 tools/ 아래에서 실행하면 sys.path에 /app 이 포함되지 않아 main import가 실패할 수 있다.
    here = os.path.dirname(os.path.abspath(__file__))
    app_root = os.path.dirname(here)
    if app_root not in sys.path:
        sys.path.insert(0, app_root)

    import main as app  # type: ignore

    fields = ["impCnt", "clkCnt", "salesAmt", "avgRnk", "qltyIdx", "bidAmt"]
    if mode == "pcmobile":
        fields = fields + ["avgRnkPc", "avgRnkMobile"]

    rows = app._searchad_fetch_report_rows(  # noqa: SLF001
        report_tp="AD",
        date_ymd=date_ymd,
        levels=["ad"],
        fields=fields,
    )

    def adid_of(r: dict) -> str:
        return str(r.get("nadId") or r.get("nccAdId") or "").strip()

    def is_non_null_avg(v: Any) -> bool:
        if v is None:
            return False
        s = str(v).strip()
        return s != "" and s.lower() != "null"

    total = sum(1 for r in rows if isinstance(r, dict))
    non = sum(1 for r in rows if isinstance(r, dict) and is_non_null_avg(r.get("avgRnk")))
    non_pc = sum(1 for r in rows if isinstance(r, dict) and is_non_null_avg(r.get("avgRnkPc")))
    non_m = sum(1 for r in rows if isinstance(r, dict) and is_non_null_avg(r.get("avgRnkMobile")))

    has_pc_key = sum(1 for r in rows if isinstance(r, dict) and ("avgRnkPc" in r))
    has_m_key = sum(1 for r in rows if isinstance(r, dict) and ("avgRnkMobile" in r))

    by_prefix = {"-01-": 0, "-02-": 0, "-04-": 0, "other": 0}
    by_prefix_non = {"-01-": 0, "-02-": 0, "-04-": 0, "other": 0}
    by_dev = {}
    by_dev_non = {}

    examples = []
    match_rows = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        adid = adid_of(r)
        dev = str(r.get("device") or "").strip() or "?"
        by_dev[dev] = by_dev.get(dev, 0) + 1
        if is_non_null_avg(r.get("avgRnk")):
            by_dev_non[dev] = by_dev_non.get(dev, 0) + 1

        key = "other"
        if "-01-" in adid:
            key = "-01-"
        elif "-02-" in adid:
            key = "-02-"
        elif "-04-" in adid:
            key = "-04-"
        by_prefix[key] += 1
        if is_non_null_avg(r.get("avgRnk")):
            by_prefix_non[key] += 1
            if len(examples) < 8:
                examples.append(
                    {
                        "nadId": adid,
                        "avgRnk": r.get("avgRnk"),
                        "device": r.get("device"),
                        "impCnt": r.get("impCnt"),
                        "clkCnt": r.get("clkCnt"),
                        "campaignId": r.get("campaignId"),
                        "adgroupId": r.get("adgroupId"),
                    }
                )

        if target_adid and adid == target_adid:
            match_rows.append(
                {
                    "nadId": adid,
                    "avgRnk": r.get("avgRnk"),
                    "device": r.get("device"),
                    "impCnt": r.get("impCnt"),
                    "clkCnt": r.get("clkCnt"),
                    "campaignId": r.get("campaignId"),
                    "adgroupId": r.get("adgroupId"),
                }
            )

    print(f"date={date_ymd}")
    print(f"mode={mode}")
    print(f"fields={fields}")
    print(f"rows_total={total}")
    print(f"avgRnk_non_null={non}")
    print(f"avgRnkPc_key_present={has_pc_key} avgRnkPc_non_null={non_pc}")
    print(f"avgRnkMobile_key_present={has_m_key} avgRnkMobile_non_null={non_m}")
    print(f"by_prefix_total={by_prefix}")
    print(f"by_prefix_non_null={by_prefix_non}")
    print(f"by_device_total={by_dev}")
    print(f"by_device_non_null={by_dev_non}")
    if target_adid:
        print(f"target_nadId={target_adid}")
        print(f"target_rows={match_rows}")
    print(f"examples_non_null={examples}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

