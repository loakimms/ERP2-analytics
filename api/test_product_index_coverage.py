import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductIndexScoreDaily, TrackedProductPageDaily
from main import app, _today_kst


class TestProductIndexCoverage(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_coverage_reports_missing_days(self) -> None:
        url = "https://smartstore.naver.com/testmall/products/999000000080?x=1"
        base = "https://smartstore.naver.com/testmall/products/999000000080"
        today = _today_kst()
        d0 = today - timedelta(days=2)
        d1 = today - timedelta(days=1)
        d2 = today

        with SessionLocal() as db:
            db.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url.in_([url, base])).delete(
                synchronize_session=False
            )
            db.query(TrackedProductPageDaily).filter(TrackedProductPageDaily.product_url.in_([url, base])).delete(
                synchronize_session=False
            )
            # score: 2일만 존재
            db.add(TrackedProductIndexScoreDaily(date=d0, product_url=base, click_score=0, sales_score=0, review_score=0, recency_score=0, penalty_score=0, final_score=10, inputs_json="{}"))
            db.add(TrackedProductIndexScoreDaily(date=d2, product_url=base, click_score=0, sales_score=0, review_score=0, recency_score=0, penalty_score=0, final_score=20, inputs_json="{}"))
            # page: 1일만 존재
            db.add(TrackedProductPageDaily(date=d2, product_url=base, title="T", http_status=200, error=None))
            db.commit()

        res = self.client.get("/search-rank/product-index/coverage", params={"product_url": url, "days": 3, "date_to": str(today)})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["product_url"], base)
        self.assertEqual(int(data["score_days_count"]), 2)
        self.assertEqual(int(data["page_days_count"]), 1)
        # score missing only d1
        self.assertEqual([str(x) for x in data["missing_score_days"]], [str(d1)])
        # page missing d0,d1
        self.assertEqual(set([str(x) for x in data["missing_page_days"]]), set([str(d0), str(d1)]))


if __name__ == "__main__":
    unittest.main()

