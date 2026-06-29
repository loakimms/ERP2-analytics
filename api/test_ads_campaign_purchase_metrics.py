import unittest
from datetime import date

import main
from db import NaverAdKeywordDaily, SessionLocal, init_db


class AdsCampaignPurchaseMetricsTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        with SessionLocal() as s:
            s.query(NaverAdKeywordDaily).delete(synchronize_session=False)
            s.commit()

    def test_list_campaign_daily_aggregates_total_and_purchase_metrics(self) -> None:
        target = date(2026, 3, 29)
        with SessionLocal() as s:
            s.add_all(
                [
                    NaverAdKeywordDaily(
                        date=target,
                        campaign_name="CAMP1",
                        adgroup_name="GRP1",
                        keyword="kw-1",
                        device="ALL",
                        impressions=100,
                        clicks=10,
                        cost=11000,
                        conversions=3,
                        revenue=30000,
                        purchase_conversions=2,
                        purchase_revenue=20000,
                        ctr=10.0,
                        cpc=1100.0,
                        cvr=30.0,
                        roas=272.7,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target,
                        campaign_name="CAMP1",
                        adgroup_name="GRP2",
                        keyword="kw-2",
                        device="ALL",
                        impressions=50,
                        clicks=5,
                        cost=5500,
                        conversions=1,
                        revenue=0,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=10.0,
                        cpc=1100.0,
                        cvr=20.0,
                        roas=0.0,
                        source="searchad_api",
                    ),
                ]
            )
            s.commit()

        with SessionLocal() as s:
            rows = main.list_campaign_daily(date_from=target, date_to=target, source="keyword", db=s)

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row.campaign_name, "CAMP1")
        self.assertEqual(int(row.impressions or 0), 150)
        self.assertEqual(int(row.clicks or 0), 15)
        self.assertEqual(int(row.cost or 0), 16500)
        self.assertEqual(int(row.conversions or 0), 4)
        self.assertEqual(int(row.revenue or 0), 30000)
        self.assertEqual(int(row.purchase_conversions or 0), 2)
        self.assertEqual(int(row.purchase_revenue or 0), 20000)

    def test_list_adgroup_daily_keeps_purchase_metrics_per_group(self) -> None:
        target = date(2026, 3, 29)
        with SessionLocal() as s:
            s.add_all(
                [
                    NaverAdKeywordDaily(
                        date=target,
                        campaign_name="CAMP1",
                        adgroup_name="GRP1",
                        keyword="kw-1",
                        device="ALL",
                        impressions=100,
                        clicks=10,
                        cost=11000,
                        conversions=3,
                        revenue=30000,
                        purchase_conversions=2,
                        purchase_revenue=20000,
                        ctr=10.0,
                        cpc=1100.0,
                        cvr=30.0,
                        roas=272.7,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target,
                        campaign_name="CAMP1",
                        adgroup_name="GRP1",
                        keyword="kw-2",
                        device="ALL",
                        impressions=20,
                        clicks=2,
                        cost=2200,
                        conversions=1,
                        revenue=5000,
                        purchase_conversions=1,
                        purchase_revenue=5000,
                        ctr=10.0,
                        cpc=1100.0,
                        cvr=50.0,
                        roas=227.3,
                        source="searchad_api",
                    ),
                    NaverAdKeywordDaily(
                        date=target,
                        campaign_name="CAMP1",
                        adgroup_name="GRP2",
                        keyword="kw-3",
                        device="ALL",
                        impressions=10,
                        clicks=1,
                        cost=1100,
                        conversions=1,
                        revenue=0,
                        purchase_conversions=0,
                        purchase_revenue=0,
                        ctr=10.0,
                        cpc=1100.0,
                        cvr=100.0,
                        roas=0.0,
                        source="searchad_api",
                    ),
                ]
            )
            s.commit()

        with SessionLocal() as s:
            rows = main.list_adgroup_daily(date_from=target, date_to=target, campaign="CAMP1", source="keyword", db=s)

        by_group = {str(r.adgroup_name): r for r in rows}
        self.assertEqual(set(by_group.keys()), {"GRP1", "GRP2"})
        grp1 = by_group["GRP1"]
        self.assertEqual(int(grp1.conversions or 0), 4)
        self.assertEqual(int(grp1.revenue or 0), 35000)
        self.assertEqual(int(grp1.purchase_conversions or 0), 3)
        self.assertEqual(int(grp1.purchase_revenue or 0), 25000)
        grp2 = by_group["GRP2"]
        self.assertEqual(int(grp2.purchase_conversions or 0), 0)
        self.assertEqual(int(grp2.purchase_revenue or 0), 0)


if __name__ == "__main__":
    unittest.main()
