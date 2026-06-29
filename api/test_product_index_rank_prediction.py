import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductIndexScoreDaily, TrackedProductRankDaily, TrackedProductManualKeyword
from main import app, _today_kst


class TestProductIndexRankPrediction(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_rank_prediction_signal_golden(self) -> None:
        """
        최근 3일 연속 +Δ 이면 GOLDEN 신호가 나와야 한다.
        """
        url = "https://smartstore.naver.com/testmall/products/999000000050?NaPm=ct%3Dxxx"
        base = "https://smartstore.naver.com/testmall/products/999000000050"
        today = _today_kst()
        # 4일치: 10, 11(+1), 13(+2), 14(+1) -> 마지막 3일(+1,+2,+1)=GOLDEN
        scores = [10, 11, 13, 14]
        ranks = [10, 10, 9, 8]  # 개선(숫자 감소)

        with SessionLocal() as db:
            db.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url.in_([url, base])).delete(
                synchronize_session=False
            )
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url.in_([url, base])).delete(
                synchronize_session=False
            )
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url.in_([url, base])).delete(
                synchronize_session=False
            )
            db.commit()

            for i in range(4):
                d = today - timedelta(days=3 - i)
                db.add(
                    TrackedProductIndexScoreDaily(
                        date=d,
                        product_url=url,
                        click_score=0,
                        sales_score=0,
                        review_score=0,
                        recency_score=0,
                        penalty_score=0,
                        final_score=scores[i],
                        inputs_json="{}",
                    )
                )
                db.add(
                    TrackedProductRankDaily(
                        date=d,
                        product_url=url,
                        keyword="K1",
                        rank=ranks[i],
                        source="excel",
                    )
                )
            db.commit()

        res = self.client.get("/search-rank/product-index/rank-prediction", params={"product_url": base, "days": 4})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        items = data.get("items") or []
        self.assertEqual(len(items), 4)
        last = items[-1]
        self.assertEqual(int(last["score_final"]), 14)
        self.assertEqual(int(last["delta_score_final"]), 1)
        self.assertEqual(int(last["best_rank"]), 8)
        # rank delta: 8 - 9 = -1
        self.assertEqual(int(last["delta_best_rank"]), -1)
        self.assertEqual(str(last["signal"]), "GOLDEN")

    def test_rank_prediction_gap_vs_benchmark(self) -> None:
        """
        benchmark_product_url을 주면 benchmark_best_rank/gap_best_rank가 계산되어야 한다.
        """
        my_url = "https://smartstore.naver.com/testmall/products/999000000051"
        bench_url = "https://smartstore.naver.com/testmall/products/999000000052?x=1"
        today = _today_kst()

        my_ranks = [7, 6, 5]
        bench_ranks = [3, 3, 4]

        with SessionLocal() as db:
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url.in_([my_url, bench_url])).delete(
                synchronize_session=False
            )
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url.in_([my_url, bench_url])).delete(
                synchronize_session=False
            )
            db.commit()
            for i in range(3):
                d = today - timedelta(days=2 - i)
                db.add(TrackedProductRankDaily(date=d, product_url=my_url, keyword="K1", rank=my_ranks[i], source="excel"))
                db.add(TrackedProductRankDaily(date=d, product_url=bench_url, keyword="K1", rank=bench_ranks[i], source="excel"))
            db.commit()

        res = self.client.get(
            "/search-rank/product-index/rank-prediction",
            params={"product_url": my_url, "benchmark_product_url": bench_url, "days": 3},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        items = data.get("items") or []
        self.assertEqual(len(items), 3)
        last = items[-1]
        self.assertEqual(int(last["best_rank"]), 5)
        self.assertEqual(int(last["benchmark_best_rank"]), 4)
        self.assertEqual(int(last["gap_best_rank"]), 1)

    def test_rank_prediction_weighted_rank_uses_monthly_volume(self) -> None:
        """
        월검색량이 큰 키워드의 순위가 더 크게 반영되어야 한다.
        """
        url = "https://smartstore.naver.com/testmall/products/999000000053"
        today = _today_kst()
        d0 = today

        with SessionLocal() as db:
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == url).delete(synchronize_session=False)
            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == url).delete(synchronize_session=False)
            # 키워드 메타(가중치)
            db.add(TrackedProductManualKeyword(product_url=url, keyword="K_BIG", monthly_search_volume=1000, monthly_search_volume_label=None, is_active=True))
            db.add(TrackedProductManualKeyword(product_url=url, keyword="K_SMALL", monthly_search_volume=1, monthly_search_volume_label=None, is_active=True))
            # 같은 날 2개 키워드 순위
            db.add(TrackedProductRankDaily(date=d0, product_url=url, keyword="K_BIG", rank=1, source="excel"))
            db.add(TrackedProductRankDaily(date=d0, product_url=url, keyword="K_SMALL", rank=10, source="excel"))
            db.commit()

        res = self.client.get("/search-rank/product-index/rank-prediction", params={"product_url": url, "days": 3})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        items = data.get("items") or []
        # 마지막 날짜(오늘)
        last = items[-1]
        self.assertEqual(int(last["best_rank"]), 1)
        wr = float(last["weighted_rank"])
        # (1*1000 + 10*1) / 1001 = 1.008991...
        self.assertTrue(1.0 <= wr <= 1.5)


if __name__ == "__main__":
    unittest.main()

