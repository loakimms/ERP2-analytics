import json
import unittest
from datetime import date


class ProductIndexLatestAndHistoryDetailedTest(unittest.TestCase):
    def test_latest_returns_most_recent_saved_and_parses_inputs(self) -> None:
        from fastapi.testclient import TestClient
        from main import app
        from db import SessionLocal, TrackedProductIndexScoreDaily

        base = "https://smartstore.naver.com/test/products/9"
        variant = base + "?NaPm=ct%3Dtest"
        d1 = date(2026, 1, 26)
        d2 = date(2026, 1, 27)

        with SessionLocal() as s:
            (
                s.query(TrackedProductIndexScoreDaily)
                .filter(TrackedProductIndexScoreDaily.product_url.in_([base, variant]))
                .delete(synchronize_session=False)
            )
            s.add(
                TrackedProductIndexScoreDaily(
                    date=d1,
                    product_url=variant,  # 변형 URL로 저장된 케이스(정규화 차이)
                    click_score=10,
                    sales_score=20,
                    review_score=30,
                    recency_score=40,
                    penalty_score=0,
                    final_score=25,
                    inputs_json=json.dumps({"weekly_views_7d": 100, "wishes": 1}, ensure_ascii=False),
                )
            )
            s.add(
                TrackedProductIndexScoreDaily(
                    date=d2,
                    product_url=variant,
                    click_score=11,
                    sales_score=21,
                    review_score=31,
                    recency_score=41,
                    penalty_score=0,
                    final_score=26,
                    inputs_json=json.dumps({"weekly_views_7d": 200, "wishes": 2}, ensure_ascii=False),
                )
            )
            s.commit()

        client = TestClient(app)
        resp = client.get("/search-rank/product-index/latest", params={"product_url": base})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["product_url"], base)  # API는 canonical(base)로 응답
        self.assertEqual(data["date"], d2.isoformat())
        self.assertEqual(int(data["scores"]["final"]), 26)
        self.assertEqual(int(data["inputs"]["wishes"]), 2)

    def test_history_detailed_returns_inputs_per_day(self) -> None:
        from fastapi.testclient import TestClient
        from main import app
        from db import SessionLocal, TrackedProductIndexScoreDaily

        url = "https://smartstore.naver.com/test/products/10"
        d1 = date(2026, 1, 26)
        d2 = date(2026, 1, 27)

        with SessionLocal() as s:
            s.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url == url).delete(
                synchronize_session=False
            )
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
                    inputs_json=json.dumps({"weekly_views_7d": 10, "wishes": 1}, ensure_ascii=False),
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
                    inputs_json=json.dumps({"weekly_views_7d": 20, "wishes": 2}, ensure_ascii=False),
                )
            )
            s.commit()

        client = TestClient(app)
        resp = client.get("/search-rank/product-index/history-detailed", params={"product_url": url, "days": 30})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["product_url"], url)
        self.assertEqual(len(data["items"]), 2)
        self.assertEqual(data["items"][0]["date"], d1.isoformat())
        self.assertEqual(int(data["items"][1]["inputs"]["wishes"]), 2)


if __name__ == "__main__":
    unittest.main()

