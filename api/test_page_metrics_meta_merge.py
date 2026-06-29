import unittest
from datetime import date


class PageMetricsMetaMergeTest(unittest.TestCase):
    def test_upsert_allows_meta_update_even_when_scrape_failed_after_success(self) -> None:
        """
        요구사항(구조적):
        - 같은 날짜/URL에서 이미 '성공' row가 있으면, 이후 캡차/차단 같은 실패 결과로 덮어쓰지 않는다.
        - 하지만 커머스 API 등으로 얻는 '상품 메타(title/price/delivery/registered_date)'는
          실패 상황에서도 보강/갱신할 수 있어야 한다.
        """
        from db import SessionLocal, TrackedProductPageDaily, upsert_tracked_product_page_daily

        url = "https://smartstore.naver.com/a/products/11043833896"
        today = date(2026, 2, 25)

        # 1) 기존 성공 데이터 저장(리뷰/평점 존재)
        with SessionLocal() as s:
            s.add(
                TrackedProductPageDaily(
                    date=today,
                    product_url=url,
                    title="OLD",
                    price=1000,
                    review_count=10,
                    rating=4.5,
                    delivery="OLD_DELIVERY",
                    http_status=200,
                    error=None,
                )
            )
            s.commit()

        # 2) 이후 수집은 캡차로 실패했지만, 메타는 커머스 API로 새 값이 들어온 상태를 가정
        upsert_tracked_product_page_daily(
            target_date=today.strftime("%Y-%m-%d"),
            product_url=url,
            title="NEW",
            price=1200,
            review_count=None,
            rating=None,
            delivery="무료배송",
            buy_count=None,
            wish_count=None,
            registered_date=date(2024, 1, 2),
            http_status=490,
            error="captcha_detected",
        )

        # 3) 성공 핵심값은 유지 + 메타는 업데이트되었는지 확인
        with SessionLocal() as s:
            row = (
                s.query(TrackedProductPageDaily)
                .filter(TrackedProductPageDaily.date == today, TrackedProductPageDaily.product_url == url)
                .one()
            )
            self.assertEqual(row.review_count, 10)
            self.assertAlmostEqual(float(row.rating or 0), 4.5, places=2)
            self.assertEqual(int(row.http_status or 0), 200)
            self.assertIsNone(row.error)

            self.assertEqual(row.title, "NEW")
            self.assertEqual(int(row.price or 0), 1200)
            self.assertEqual(row.delivery, "무료배송")
            self.assertEqual(str(row.registered_date), "2024-01-02")


if __name__ == "__main__":
    unittest.main()

