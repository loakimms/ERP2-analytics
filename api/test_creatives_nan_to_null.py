import unittest
from datetime import date

import pandas as pd

from db import SessionLocal, NaverAdCreativeDaily, upsert_creative_daily_from_df


class CreativesNaNToNullTest(unittest.TestCase):
    def test_upsert_creatives_converts_nan_to_null(self) -> None:
        """
        Pandas가 숫자 컬럼의 결측을 NaN(float('nan'))로 들고오는 경우가 있어도,
        DB에는 NaN이 저장되지 않고 NULL로 저장되어야 한다.
        """
        ymd = "2026-01-17"
        cid = "nad-a001-02-__nan_test__"
        campaign = "#SS01_통합검색지면_MO"
        adgroup = "#MO_염색약_개인화지면"

        df = pd.DataFrame(
            [
                {
                    "캠페인": campaign,
                    "광고그룹": adgroup,
                    "소재ID": cid,
                    "소재명": "TEST",
                    "노출수": 0,
                    "클릭수": 0,
                    "총비용(원)": 0,
                    "전환수": 0,
                    "전환매출액(원)": 0,
                    "클릭률(%)": 0.0,
                    "CPC(원)": 0.0,
                    "전환율(%)": 0.0,
                    "ROAS(%)": 0.0,
                    "평균노출순위": float("nan"),
                    "품질지수": float("nan"),
                }
            ]
        )

        upsert_creative_daily_from_df(df, ymd, source="creative_upload", delete_mode="none")

        db = SessionLocal()
        try:
            d0 = date.fromisoformat(ymd)
            row = (
                db.query(NaverAdCreativeDaily)
                .filter(
                    NaverAdCreativeDaily.date == d0,
                    NaverAdCreativeDaily.campaign_name == campaign,
                    NaverAdCreativeDaily.adgroup_name == adgroup,
                    NaverAdCreativeDaily.creative_id == cid,
                    NaverAdCreativeDaily.device == "ALL",
                )
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertIsNone(row.avg_rank)
            self.assertIsNone(row.quality_index)
        finally:
            try:
                d0 = date.fromisoformat(ymd)
                db.query(NaverAdCreativeDaily).filter(
                    NaverAdCreativeDaily.date == d0,
                    NaverAdCreativeDaily.creative_id == cid,
                ).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

