import os
import sys


def main() -> int:
    """
    SearchAd stat-reports(AD, level=ad)에서 '평균노출순위'에 해당하는 필드명이 무엇인지 확인하기 위한 도구.
    - 여러 후보 필드를 붙여서 1일치 호출을 시도하고, 성공/실패를 출력한다.
    """
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from main import _searchad_fetch_report_rows  # type: ignore

    date_ymd = (sys.argv[1] if len(sys.argv) > 1 else "2026-01-10").strip()
    base_fields = ["impCnt", "clkCnt", "salesAmt"]

    candidates = [
        "avgRnk",
        "avgRank",
        "avgRnkPc",
        "avgRnkMobile",
        "avgExposureRank",
        "averageRank",
        "avgPos",
        "avgPosition",
        "avgExpRnk",
        "avgExpRank",
    ]

    for cand in candidates:
        try:
            rows = _searchad_fetch_report_rows(
                report_tp="AD",
                date_ymd=date_ymd,
                levels=["ad"],
                fields=base_fields + [cand],
            )
            keys = sorted(list((rows[0] or {}).keys())) if rows and isinstance(rows[0], dict) else []
            has = cand in keys
            print(f"OK  {cand:16s} rows={len(rows):4d} key_present={has} keys_head={keys[:12]}")
        except Exception as e:
            print(f"ERR {cand:16s} {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

