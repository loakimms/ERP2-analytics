import unittest
from datetime import date

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductIndexScoreDaily
from main import app


class TestProductIndexLatestBatchSignal(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def _seed_scores(self, base: str, days: list[date], finals: list[int]) -> None:
        with SessionLocal() as db:
            db.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url == base).delete(synchronize_session=False)
            for d0, s0 in zip(days, finals):
                db.add(
                    TrackedProductIndexScoreDaily(
                        date=d0,
                        product_url=base,
                        click_score=0,
                        sales_score=0,
                        review_score=0,
                        recency_score=0,
                        penalty_score=0,
                        final_score=int(s0),
                        inputs_json="{}",
                    )
                )
            db.commit()

    def test_latest_batch_signal_dead_when_negative_in_last_two_deltas(self) -> None:
        base = "https://smartstore.naver.com/test/products/101"
        # 4일치 점수: 70 -> 73 (+3) -> 73 (0) -> 63 (-10)  => 마지막 2일 중 음수 존재 => DEAD
        days = [date(2026, 1, 28), date(2026, 1, 29), date(2026, 1, 30), date(2026, 1, 31)]
        finals = [70, 73, 73, 63]
        self._seed_scores(base, days, finals)

        res = self.client.post("/search-rank/product-index/latest/batch", json={"urls": [base]})
        self.assertEqual(res.status_code, 200)
        item = res.json()[0]
        self.assertEqual(item["date"], "2026-01-31")
        self.assertEqual(item.get("signal"), "DEAD")

    def test_latest_batch_signal_trap_when_three_consecutive_zero_deltas(self) -> None:
        base = "https://smartstore.naver.com/test/products/102"
        # 4일치 점수: 50 -> 50 (0) -> 50 (0) -> 50 (0) => TRAP
        days = [date(2026, 1, 28), date(2026, 1, 29), date(2026, 1, 30), date(2026, 1, 31)]
        finals = [50, 50, 50, 50]
        self._seed_scores(base, days, finals)

        res = self.client.post("/search-rank/product-index/latest/batch", json={"urls": [base]})
        self.assertEqual(res.status_code, 200)
        item = res.json()[0]
        self.assertEqual(item["date"], "2026-01-31")
        self.assertEqual(item.get("signal"), "TRAP")


if __name__ == "__main__":
    unittest.main()

