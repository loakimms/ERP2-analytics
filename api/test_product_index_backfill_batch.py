import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductIndexScoreDaily, TrackedProductMeta, TrackedProductPageDaily
from main import app, _today_kst


class TestProductIndexBackfillBatch(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_backfill_fills_last_n_days_for_product(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/999000000070?x=1"
        base_url = "https://smartstore.naver.com/testmall/products/999000000070"
        today = _today_kst()

        with SessionLocal() as db:
            db.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url.in_([product_url, base_url])).delete(synchronize_session=False)
            db.query(TrackedProductPageDaily).filter(TrackedProductPageDaily.product_url.in_([product_url, base_url])).delete(
                synchronize_session=False
            )
            db.add(TrackedProductMeta(product_url=base_url, title="백필 테스트 상품", category1="C1", category2="C2", category3="C3"))
            # 3일치 page-metrics만 넣어도 analyze는 동작(나머지는 0/None 처리)
            for i in range(3):
                d = today - timedelta(days=2 - i)
                db.add(
                    TrackedProductPageDaily(
                        date=d,
                        product_url=base_url,
                        title="백필 테스트 상품",
                        wish_count=10 + i,
                        registered_date=today - timedelta(days=100),
                        recent_purchase_7d_count=5,
                        recent_purchase_status="collected",
                        http_status=200,
                        error=None,
                    )
                )
            db.commit()

        res = self.client.post("/search-rank/product-index/backfill-batch", json={"product_url": product_url, "days": 3, "date": str(today)})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(int(data["days"]), 3)
        # 3일 * 1상품 = 3회
        self.assertEqual(int(data["analyzed"]), 3)

        with SessionLocal() as db:
            rows = (
                db.query(TrackedProductIndexScoreDaily)
                .filter(TrackedProductIndexScoreDaily.product_url == base_url)
                .order_by(TrackedProductIndexScoreDaily.date.asc())
                .all()
            )
            self.assertEqual(len(rows), 3)
            self.assertEqual(str(rows[0].date), str(today - timedelta(days=2)))
            self.assertEqual(str(rows[-1].date), str(today))


if __name__ == "__main__":
    unittest.main()

