import unittest
from datetime import date

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductIndexScoreDaily
from main import app


class TestProductIndexLatestBatch(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_latest_batch_returns_latest_scores(self) -> None:
        url = "https://smartstore.naver.com/test/products/99?x=1"
        base = "https://smartstore.naver.com/test/products/99"
        d1 = date(2026, 1, 26)
        d2 = date(2026, 1, 27)

        with SessionLocal() as db:
            db.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url.in_([url, base])).delete(synchronize_session=False)
            db.add(TrackedProductIndexScoreDaily(date=d1, product_url=base, click_score=10, sales_score=10, review_score=10, recency_score=10, penalty_score=0, final_score=10, inputs_json="{}"))
            db.add(TrackedProductIndexScoreDaily(date=d2, product_url=base, click_score=20, sales_score=20, review_score=20, recency_score=20, penalty_score=0, final_score=20, inputs_json="{}"))
            db.commit()

        res = self.client.post("/search-rank/product-index/latest/batch", json={"urls": [url]})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        item = data[0]
        self.assertEqual(item["requested_url"], url)
        self.assertEqual(item["product_url"], base)
        self.assertEqual(item["date"], d2.isoformat())
        self.assertEqual(int(item["scores"]["final"]), 20)
        self.assertEqual(int(item["deltas"]["final"]), 10)
        self.assertEqual(item.get("signal"), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()

