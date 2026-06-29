import unittest
from datetime import date


class ProductIndexHistoryAndBatchTest(unittest.TestCase):
    def test_history_endpoint_returns_items(self) -> None:
        from fastapi.testclient import TestClient
        from main import app
        from db import SessionLocal, TrackedProductIndexScoreDaily

        url = "https://smartstore.naver.com/test/products/2"
        d1 = date(2026, 1, 26)
        d2 = date(2026, 1, 27)

        with SessionLocal() as s:
            s.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url == url).delete(synchronize_session=False)
            s.add(
                TrackedProductIndexScoreDaily(
                    date=d1,
                    product_url=url,
                    click_score=10,
                    sales_score=10,
                    review_score=10,
                    recency_score=10,
                    penalty_score=0,
                    final_score=10,
                    inputs_json="{}",
                )
            )
            s.add(
                TrackedProductIndexScoreDaily(
                    date=d2,
                    product_url=url,
                    click_score=20,
                    sales_score=20,
                    review_score=20,
                    recency_score=20,
                    penalty_score=0,
                    final_score=20,
                    inputs_json="{}",
                )
            )
            s.commit()

        client = TestClient(app)
        resp = client.get("/search-rank/product-index/history", params={"product_url": url, "days": 30})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["product_url"], url)
        self.assertEqual(len(data["items"]), 2)
        self.assertEqual(data["items"][0]["date"], d1.isoformat())
        self.assertEqual(data["items"][1]["scores"]["final"], 20)


if __name__ == "__main__":
    unittest.main()

