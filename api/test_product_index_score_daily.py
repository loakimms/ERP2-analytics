import unittest
from datetime import date, timedelta


class ProductIndexScoreDailyApiTest(unittest.TestCase):
    def test_analyze_saves_daily_and_returns_deltas(self) -> None:
        from fastapi.testclient import TestClient
        from main import app
        from db import (
            SessionLocal,
            TrackedProductMeta,
            TrackedProductPageDaily,
            TrackedProductIndexManual,
            TrackedProductIndexScoreDaily,
        )

        url = "https://smartstore.naver.com/test/products/1"
        today = date(2026, 1, 27)
        yday = today - timedelta(days=1)

        # DB 준비(격리)
        with SessionLocal() as s:
            s.query(TrackedProductIndexScoreDaily).filter(TrackedProductIndexScoreDaily.product_url == url).delete(synchronize_session=False)
            s.query(TrackedProductIndexManual).filter(TrackedProductIndexManual.product_url == url).delete(synchronize_session=False)
            s.query(TrackedProductPageDaily).filter(TrackedProductPageDaily.product_url == url).delete(synchronize_session=False)
            s.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == url).delete(synchronize_session=False)
            s.commit()

            s.add(
                TrackedProductMeta(
                    product_url=url,
                    title="테스트 상품",
                    image_url="http://example.com/img.png",
                    price=10000,
                )
            )
            # 전일: 리뷰/평점 낮고 판매도 낮게
            s.add(
                TrackedProductPageDaily(
                    date=yday,
                    product_url=url,
                    title="테스트 상품",
                    price=10000,
                    review_count=10,
                    rating=3.5,
                    recent_purchase_7d_count=5,
                    recent_purchase_status="collected",
                    http_status=200,
                    error=None,
                )
            )
            # 오늘: 리뷰/평점/판매 상승
            s.add(
                TrackedProductPageDaily(
                    date=today,
                    product_url=url,
                    title="테스트 상품",
                    price=10000,
                    review_count=100,
                    rating=4.6,
                    recent_purchase_7d_count=20,
                    recent_purchase_status="collected",
                    http_status=200,
                    error=None,
                )
            )
            # 수기 입력(클릭/최신성/패널티)
            s.add(
                TrackedProductIndexManual(
                    product_url=url,
                    weekly_views_7d=2000,
                    wishes=1,  # click 점수 상한에 못 닿게 해서 변화 검증이 쉬움
                    sales_30d=40,
                    days_since_reg=200,
                    delay_count=0,
                    sold_out_days=0,
                )
            )
            s.commit()

        client = TestClient(app)

        # 전일 분석 저장
        r1 = client.post("/search-rank/product-index/analyze", json={"product_url": url, "date": yday.isoformat()})
        self.assertEqual(r1.status_code, 200)
        j1 = r1.json()
        self.assertEqual(j1["product_url"], url)
        self.assertEqual(j1["date"], yday.isoformat())
        self.assertIsNone(j1["deltas"]["final"])  # 첫 스냅샷은 delta 없음

        # 오늘 분석 저장 + 전일 대비 delta 존재
        r2 = client.post("/search-rank/product-index/analyze", json={"product_url": url, "date": today.isoformat()})
        self.assertEqual(r2.status_code, 200)
        j2 = r2.json()
        self.assertEqual(j2["date"], today.isoformat())

        # 최소한 리뷰/판매/최종은 증가해야 한다(전일 대비)
        self.assertTrue(isinstance(j2["deltas"]["sales"], int))
        self.assertTrue(isinstance(j2["deltas"]["review"], int))
        self.assertTrue(isinstance(j2["deltas"]["final"], int))
        self.assertGreaterEqual(j2["deltas"]["sales"], 0)
        self.assertGreaterEqual(j2["deltas"]["review"], 0)

        # DB에 오늘 스냅샷이 저장되어야 한다.
        with SessionLocal() as s:
            row = (
                s.query(TrackedProductIndexScoreDaily)
                .filter(TrackedProductIndexScoreDaily.product_url == url, TrackedProductIndexScoreDaily.date == today)
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertTrue(isinstance(row.final_score, int))


if __name__ == "__main__":
    unittest.main()

