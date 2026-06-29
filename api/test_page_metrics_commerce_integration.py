import unittest
from unittest.mock import MagicMock, patch
from datetime import date


class PageMetricsCommerceIntegrationTest(unittest.TestCase):
    def test_collect_now_fills_title_price_from_commerce_when_scrape_blocked(self) -> None:
        from main import collect_page_metrics_now
        from schemas import ProductPageMetricsBatchRequest

        url = "https://smartstore.naver.com/a/products/11043833896"
        fake_db = MagicMock()

        captured = {}

        def fake_upsert(**kwargs):
            captured.update(kwargs)
            return None

        def fake_scrape(*args, **kwargs):  # noqa: ARG001
            # 크롤링은 캡차/차단으로 실패(핵심값 없음)
            return {"http_status": 490, "error": "captcha_detected", "title": None, "price": None, "review_count": None, "rating": None, "via": "pw"}

        with patch.dict("os.environ", {"DISABLE_PLAYWRIGHT": "1"}):
            with patch("main._scrape_product_page_metrics", side_effect=fake_scrape):
                with patch("main._get_page_metrics_seeds", return_value={}):
                    with patch("main._naver_commerce_fetch_product_page_meta", return_value={"title": "API_TITLE", "price": 12345, "registered_date": date(2024, 1, 2), "delivery": "무료배송"}):
                        with patch("main.upsert_tracked_product_page_daily", side_effect=fake_upsert):
                            with patch("main.get_page_metrics_batch", return_value=[]):
                                with patch("main.time.sleep", return_value=None):
                                    from starlette.requests import Request as StarletteRequest

                                    scope = {
                                        "type": "http",
                                        "method": "POST",
                                        "path": "/search-rank/page-metrics/collect-now",
                                        "headers": [],
                                        "client": ("192.168.0.10", 12345),
                                        "server": ("testserver", 80),
                                        "scheme": "http",
                                        "query_string": b"",
                                    }
                                    req = StarletteRequest(scope)
                                    collect_page_metrics_now(req=req, payload=ProductPageMetricsBatchRequest(urls=[url]), db=fake_db)

        self.assertEqual(captured.get("product_url"), url)
        self.assertEqual(captured.get("title"), "API_TITLE")
        self.assertEqual(int(captured.get("price") or 0), 12345)
        self.assertEqual(str(captured.get("registered_date")), "2024-01-02")
        self.assertEqual(captured.get("delivery"), "무료배송")


if __name__ == "__main__":
    unittest.main()

