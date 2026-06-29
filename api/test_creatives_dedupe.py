import unittest
from datetime import date


class CreativesDedupeTest(unittest.TestCase):
    def test_dedupe_creative_daily_records_merges_duplicate_pk(self) -> None:
        import db

        d = date(2026, 1, 22)
        rows = [
            {
                "date": d,
                "campaign_name": "C1",
                "adgroup_name": "G1",
                "creative_id": "X",
                "device": "ALL",
                "creative_name": "X",  # id로만 들어온 케이스
                "product_title": None,
                "image_url": None,
                "current_bid": None,
                "quality_index": None,
                "avg_rank": 5.0,
                "impressions": 10,
                "clicks": 1,
                "cost": 100,
                "conversions": 0,
                "revenue": 0,
                "ctr": 0.0,
                "cpc": 0.0,
                "cvr": 0.0,
                "roas": 0.0,
                "source": "creative_upload",
            },
            {
                "date": d,
                "campaign_name": "C1",
                "adgroup_name": "G1",
                "creative_id": "X",
                "device": "ALL",
                "creative_name": "소재명",
                "product_title": "상품명",
                "image_url": "http://img",
                "current_bid": 150,
                "quality_index": 7.0,
                "avg_rank": 2.0,
                "impressions": 20,
                "clicks": 2,
                "cost": 400,
                "conversions": 1,
                "revenue": 60000,
                "ctr": 0.0,
                "cpc": 0.0,
                "cvr": 0.0,
                "roas": 0.0,
                "source": "creative_upload",
            },
        ]

        out = db._dedupe_creative_daily_records(rows)
        self.assertEqual(len(out), 1)
        r = out[0]
        self.assertEqual(r["impressions"], 30)
        self.assertEqual(r["clicks"], 3)
        self.assertEqual(r["cost"], 500)
        self.assertEqual(r["conversions"], 1)
        self.assertEqual(r["revenue"], 60000)

        # 메타는 비어있지 않은 값으로 보강
        self.assertEqual(r["creative_name"], "소재명")
        self.assertEqual(r["product_title"], "상품명")
        self.assertEqual(r["image_url"], "http://img")
        self.assertEqual(r["current_bid"], 150)
        self.assertEqual(r["quality_index"], 7.0)

        # avg_rank는 노출수 가중 평균: (5*10 + 2*20) / 30 = 3.0
        self.assertAlmostEqual(float(r["avg_rank"]), 3.0, places=6)


if __name__ == "__main__":
    unittest.main()

