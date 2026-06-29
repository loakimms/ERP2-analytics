import os
import sys
import unittest
from datetime import date


sys.path.insert(0, os.path.dirname(__file__))


class SearchwordDailySchemaPurchaseMetricsTest(unittest.TestCase):
    def test_searchword_daily_schema_accepts_purchase_metrics(self) -> None:
        from schemas import SearchwordDaily

        row = SearchwordDaily(
            date=date(2026, 3, 8),
            campaign_name="CAMP1",
            adgroup_name="GRP1",
            searchword="헤나염색약",
            matched_keyword="헤나",
            device="ALL",
            campaign_kind="non_powerlink",
            impressions=100,
            clicks=10,
            cost=2000,
            conversions=2,
            revenue=60000,
            purchase_conversions=1,
            purchase_revenue=40000,
            ctr=10.0,
            cpc=200.0,
            cvr=20.0,
            roas=3000.0,
            source="ui_csv_upload",
        )

        self.assertEqual(int(row.purchase_conversions), 1)
        self.assertEqual(int(row.purchase_revenue), 40000)


if __name__ == "__main__":
    unittest.main()
