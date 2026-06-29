import unittest
from datetime import date

import pandas as pd

import main
from db import NaverAdCreativeDaily, SessionLocal, init_db, upsert_creative_daily_from_df


class CreativesPurchaseMetricsTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        with SessionLocal() as s:
            s.query(NaverAdCreativeDaily).delete(synchronize_session=False)
            s.commit()

    def test_list_creative_daily_returns_purchase_metrics(self) -> None:
        target = date(2026, 3, 29)
        with SessionLocal() as s:
            s.add(
                NaverAdCreativeDaily(
                    date=target,
                    campaign_name="CAMP1",
                    adgroup_name="GRP1",
                    creative_id="nad-a001-02-000000000000001",
                    device="ALL",
                    creative_name="CREATIVE1",
                    product_title="상품1",
                    image_url="http://img.test/1.png",
                    impressions=100,
                    clicks=10,
                    cost=11000,
                    conversions=5,
                    revenue=35000,
                    purchase_conversions=3,
                    purchase_revenue=21000,
                    ctr=10.0,
                    cpc=1100.0,
                    cvr=50.0,
                    roas=318.18,
                    source="searchad_api",
                )
            )
            s.commit()

        with SessionLocal() as s:
            rows = main.list_creative_daily(
                date_from=target,
                date_to=target,
                include_meta_only=False,
                limit=100,
                offset=0,
                db=s,
            )

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(str(row.get("creative_id")), "nad-a001-02-000000000000001")
        self.assertEqual(int(row.get("conversions") or 0), 5)
        self.assertEqual(int(row.get("revenue") or 0), 35000)
        self.assertEqual(int(row.get("purchase_conversions") or 0), 3)
        self.assertEqual(int(row.get("purchase_revenue") or 0), 21000)

    def test_upsert_creative_daily_persists_purchase_metrics(self) -> None:
        target = "2026-03-29"
        df = pd.DataFrame(
            [
                {
                    "캠페인": "CAMP1",
                    "광고 그룹": "GRP1",
                    "소재ID": "nad-a001-02-000000000000009",
                    "소재명": "CREATIVE9",
                    "디바이스": "ALL",
                    "노출수": 10,
                    "클릭수": 2,
                    "총비용(원)": 2200,
                    "전환수": 4,
                    "구매전환수": 3,
                    "전환매출액(원)": 18000,
                    "구매전환매출액(원)": 12000,
                    "클릭률(%)": 20.0,
                    "CPC(원)": 1100.0,
                    "전환율(%)": 200.0,
                    "ROAS(%)": 818.18,
                }
            ]
        )

        upsert_creative_daily_from_df(df, target, source="creative_upload", delete_mode="none")

        with SessionLocal() as s:
            row = (
                s.query(NaverAdCreativeDaily)
                .filter(
                    NaverAdCreativeDaily.date == date(2026, 3, 29),
                    NaverAdCreativeDaily.creative_id == "nad-a001-02-000000000000009",
                )
                .one()
            )

        self.assertEqual(int(row.conversions or 0), 4)
        self.assertEqual(int(row.revenue or 0), 18000)
        self.assertEqual(int(row.purchase_conversions or 0), 3)
        self.assertEqual(int(row.purchase_revenue or 0), 12000)


if __name__ == "__main__":
    unittest.main()
