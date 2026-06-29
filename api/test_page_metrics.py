import unittest
from unittest.mock import MagicMock, patch
from datetime import date


SAMPLE_HTML = """
<html>
  <head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "테스트 상품명",
      "offers": { "@type": "Offer", "price": "14000" },
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.68", "reviewCount": "31810" }
    }
    </script>
  </head>
  <body>ok</body>
</html>
""".strip()

SAMPLE_HTML_WITH_WISH = """
<html>
  <head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "테스트 상품명",
      "offers": { "@type": "Offer", "price": "14000" },
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.68", "reviewCount": "31810" }
    }
    </script>
    <script>
      window.__TEST__ = { "likeCount": "1,234" };
    </script>
  </head>
  <body>
    <div>찜 1,234</div>
  </body>
</html>
""".strip()

SAMPLE_HTML_WITH_REGISTER_DATE = """
<html>
  <head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "테스트 상품명",
      "offers": { "@type": "Offer", "price": "14000" },
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.68", "reviewCount": "31810" }
    }
    </script>
  </head>
  <body>
    <div>등록일 2024.01.02</div>
  </body>
</html>
""".strip()

SAMPLE_HTML_WITH_REGISTER_MONTH_ONLY = """
<html>
  <body>
    <div>등록일 2019.11.</div>
  </body>
</html>
""".strip()

class PageMetricsScrapeTest(unittest.TestCase):
    @patch.dict("os.environ", {"DISABLE_PLAYWRIGHT": "1"})
    @patch("main.requests.get")
    def test_scrape_product_page_metrics_parses_jsonld(self, mock_get: MagicMock) -> None:
        from main import _scrape_product_page_metrics

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = SAMPLE_HTML
        mock_get.return_value = mock_resp

        r = _scrape_product_page_metrics("https://smartstore.naver.com/a/products/1")
        self.assertEqual(r["title"], "테스트 상품명")
        self.assertEqual(r["price"], 14000)
        self.assertEqual(r["review_count"], 31810)
        self.assertAlmostEqual(r["rating"], 4.68, places=2)
        self.assertIsNone(r["error"])

    @patch.dict("os.environ", {"DISABLE_PLAYWRIGHT": "1"})
    @patch("main.requests.get")
    def test_scrape_product_page_metrics_parses_wish_count(self, mock_get: MagicMock) -> None:
        from main import _scrape_product_page_metrics

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = SAMPLE_HTML_WITH_WISH
        mock_get.return_value = mock_resp

        r = _scrape_product_page_metrics("https://smartstore.naver.com/a/products/1")
        self.assertEqual(int(r.get("wish_count") or 0), 1234)

    @patch.dict("os.environ", {"DISABLE_PLAYWRIGHT": "1"})
    @patch("main.requests.get")
    def test_scrape_product_page_metrics_parses_registered_date(self, mock_get: MagicMock) -> None:
        from main import _scrape_product_page_metrics

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = SAMPLE_HTML_WITH_REGISTER_DATE
        mock_get.return_value = mock_resp

        r = _scrape_product_page_metrics("https://smartstore.naver.com/a/products/1")
        self.assertEqual(str(r.get("registered_date")), "2024-01-02")

    @patch.dict("os.environ", {"DISABLE_PLAYWRIGHT": "1"})
    @patch("main.requests.get")
    def test_scrape_product_page_metrics_parses_registered_date_month_only(self, mock_get: MagicMock) -> None:
        from main import _scrape_product_page_metrics

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = SAMPLE_HTML_WITH_REGISTER_MONTH_ONLY
        mock_get.return_value = mock_resp

        r = _scrape_product_page_metrics("https://smartstore.naver.com/a/products/1")
        # month-only는 1일로 정규화한다.
        self.assertEqual(str(r.get("registered_date")), "2019-11-01")

    @patch.dict("os.environ", {"DISABLE_PLAYWRIGHT": "1"})
    @patch("main.requests.get")
    def test_scrape_product_page_metrics_marks_parse_failed_when_all_empty(
        self, mock_get: MagicMock
    ) -> None:
        from main import _scrape_product_page_metrics

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "<html><body>ok</body></html>"
        mock_get.return_value = mock_resp

        r = _scrape_product_page_metrics("https://smartstore.naver.com/a/products/1")
        self.assertEqual(r["http_status"], 200)
        self.assertEqual(r["error"], "parse_failed")
        self.assertIsNone(r["title"])
        self.assertIsNone(r["price"])
        self.assertIsNone(r["review_count"])
        self.assertIsNone(r["rating"])


class PageMetricsRecentBadgeParseTest(unittest.TestCase):
    def test_parse_recent_purchase_badges_week_and_month(self) -> None:
        from main import _parse_recent_purchase_badges

        text = "최근 1주간 109명 구매  최근 3개월간 95명 재구매"
        out = _parse_recent_purchase_badges(text)
        self.assertEqual(out["purchase_count"], 109)
        self.assertEqual(out["purchase_window"], "7d")
        self.assertEqual(out["repurchase_count"], 95)
        self.assertEqual(out["repurchase_window"], "3m")
        self.assertTrue("최근 1주간 109명 구매" in (out["matched_texts"] or []))
        self.assertTrue("최근 3개월간 95명 재구매" in (out["matched_texts"] or []))
        # 후보 리스트도 함께 유지(다중 윈도우 대비)
        self.assertTrue(isinstance(out.get("purchase_candidates"), list))
        self.assertTrue(isinstance(out.get("repurchase_candidates"), list))

    def test_parse_recent_purchase_badges_handles_commas(self) -> None:
        from main import _parse_recent_purchase_badges

        text = "최근 1주간 1,209명 구매"
        out = _parse_recent_purchase_badges(text)
        self.assertEqual(out["purchase_count"], 1209)
        self.assertEqual(out["purchase_window"], "7d")

    def test_parse_recent_purchase_badges_does_not_treat_repurchase_as_purchase(self) -> None:
        from main import _parse_recent_purchase_badges

        text = "최근 3개월간 95명 재구매"
        out = _parse_recent_purchase_badges(text)
        self.assertIsNone(out["purchase_count"])
        self.assertIsNone(out["purchase_window"])
        self.assertEqual(out["repurchase_count"], 95)
        self.assertEqual(out["repurchase_window"], "3m")

    def test_parse_recent_purchase_badges_picks_shortest_purchase_window(self) -> None:
        from main import _parse_recent_purchase_badges

        # 여러 구매 윈도우가 동시에 들어오면, '연산용' 구매는 짧은 기간(1주)을 우선 채택해야 한다.
        text = "최근 3개월간 200명 구매  최근 1주간 10명 구매"
        out = _parse_recent_purchase_badges(text)
        self.assertEqual(out["purchase_count"], 10)
        self.assertEqual(out["purchase_window"], "7d")

    def test_parse_recent_purchase_badges_parses_itemscout_expected_sales_7d(self) -> None:
        """
        ItemScout 확장프로그램이 상품 상세 상단에서 보여주는 형태를 파싱한다.
        예: "예상판매량(7일) 233건"
        """
        from main import _parse_recent_purchase_badges

        text = "예상판매량(7일) 233건  예상매출액(7일) 326만원"
        out = _parse_recent_purchase_badges(text)
        self.assertEqual(out["purchase_count"], 233)
        self.assertEqual(out["purchase_window"], "7d")


class PageMetricsRateLimitTest(unittest.TestCase):
    def test_captcha_errors_are_rate_limited(self) -> None:
        from main import _is_page_metrics_rate_limited

        self.assertTrue(
            _is_page_metrics_rate_limited(
                {"error": "captcha_detected", "http_status": 490}
            )
        )
        self.assertTrue(
            _is_page_metrics_rate_limited(
                {"error": "service_blocked", "http_status": 490}
            )
        )
        self.assertTrue(
            _is_page_metrics_rate_limited(
                {"error": "captcha_or_rate_limited", "http_status": 429}
            )
        )

    def test_non_blocking_errors_are_not_rate_limited(self) -> None:
        from main import _is_page_metrics_rate_limited

        self.assertFalse(
            _is_page_metrics_rate_limited(
                {"error": "parse_failed", "http_status": 200}
            )
        )
        self.assertFalse(
            _is_page_metrics_rate_limited(
                {"error": "blocked_after_search_title", "http_status": 403}
            )
        )
        self.assertFalse(
            _is_page_metrics_rate_limited(
                {"error": "status=500", "http_status": 500}
            )
        )


class PageMetricsPageSelectionTest(unittest.TestCase):
    def test_select_metrics_page_source_priority(self) -> None:
        from main import _select_metrics_page_source

        self.assertEqual(
            _select_metrics_page_source(
                has_existing=True, has_captcha_shared=False, has_shared=False
            ),
            "existing",
        )
        self.assertEqual(
            _select_metrics_page_source(
                has_existing=False, has_captcha_shared=True, has_shared=True
            ),
            "captcha_shared",
        )
        self.assertEqual(
            _select_metrics_page_source(
                has_existing=False, has_captcha_shared=False, has_shared=True
            ),
            "shared",
        )
        self.assertEqual(
            _select_metrics_page_source(
                has_existing=False, has_captcha_shared=False, has_shared=False
            ),
            "new",
        )


class PageMetricsValidityTest(unittest.TestCase):
    def test_has_useful_metrics_accepts_partial(self) -> None:
        from main import _has_useful_page_metrics_result

        self.assertTrue(
            _has_useful_page_metrics_result(
                {"title": "상품", "price": None, "review_count": None, "rating": None}
            )
        )
        self.assertTrue(
            _has_useful_page_metrics_result(
                {"title": None, "price": 12000, "review_count": None, "rating": None}
            )
        )
        self.assertFalse(
            _has_useful_page_metrics_result(
                {"title": None, "price": None, "review_count": None, "rating": None}
            )
        )


class PageMetricsNoBadgeDecisionTest(unittest.TestCase):
    def test_collect_now_does_not_retry_when_no_badge(self) -> None:
        """
        요구사항:
        - 배지가 원래 없는 상품(no_badge)이라면 여러 번 시도하지 않는다.
        - 이 경우 수동 입력(별도 API/UI)로 보강 가능하므로, collect-now는 빠르게 저장/종료한다.
        """
        from main import collect_page_metrics_now
        from schemas import ProductPageMetricsBatchRequest

        # collect-now는 url마다 최대 2회 재시도를 할 수 있는데,
        # recent_purchase_status=no_badge 로 판단되면 첫 시도에서 중단되어야 한다.
        url = "https://smartstore.naver.com/a/products/1"
        fake_db = MagicMock()

        calls = {"n": 0}

        def fake_scrape(_url: str, *, search_title=None, search_catalog_id=None):  # noqa: ARG001
            calls["n"] += 1
            return {
                "http_status": 200,
                "error": None,
                "title": "T",
                "price": 100,
                "review_count": 10,
                "rating": 4.5,
                "wish_count": 1,
                "registered_date": date(2024, 1, 1),
                # 판매 배지 자체가 없는 상품이라고 판단된 상태
                "recent_purchase_status": "no_badge",
                "recent_purchase_7d_count": None,
                "recent_repurchase_3m_count": None,
                "via": "direct",
                # 판단 근거는 내부에서 sales_keys로 내려오지만,
                # 이 테스트는 "no_badge면 재시도 중단"만 검증한다.
                "sales_badge_expected": False,
            }

        with patch.dict("os.environ", {"DISABLE_PLAYWRIGHT": "1"}):
            with patch("main._scrape_product_page_metrics", side_effect=fake_scrape):
                with patch("main._get_page_metrics_seeds", return_value={}):
                    with patch("main.upsert_tracked_product_page_daily", return_value=None):
                        with patch("main.get_page_metrics_batch", return_value=[]):
                            with patch("main.time.sleep", return_value=None):
                                # endpoint signature now includes Request first
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
                                collect_page_metrics_now(
                                    req=req,
                                    payload=ProductPageMetricsBatchRequest(urls=[url]),
                                    db=fake_db,
                                )

        self.assertEqual(calls["n"], 1)

    def test_is_valid_metrics_allows_partial_but_requires_no_error(self) -> None:
        from main import _is_valid_page_metrics_result

        self.assertTrue(
            _is_valid_page_metrics_result(
                {"http_status": 200, "error": None, "title": "상품", "price": None}
            )
        )
        self.assertFalse(
            _is_valid_page_metrics_result(
                {"http_status": 200, "error": "captcha_detected", "title": "상품"}
            )
        )
        self.assertFalse(
            _is_valid_page_metrics_result(
                {"http_status": 403, "error": None, "title": "상품"}
            )
        )


if __name__ == "__main__":
    unittest.main()


class PageMetricsCompareApiTest(unittest.TestCase):
    def test_compare_endpoint_serializes_models(self) -> None:
        """
        /search-rank/page-metrics/compare 가 ORM 객체를 그대로 반환하면
        PydanticSerializationError로 500이 나고, 브라우저에서는 CORS 에러처럼 보인다.
        - 최신/이전 스냅샷을 Pydantic 모델로 변환해 정상 JSON으로 내려야 한다.
        """
        from fastapi.testclient import TestClient
        from main import app, get_db

        class Row:
            def __init__(self, d: date, url: str, title: str):
                self.date = d
                self.product_url = url
                self.title = title
                self.price = 1000
                self.review_count = 10
                self.rating = 4.5
                self.delivery = None
                self.buy_count = None
                self.http_status = 200
                self.error = None

        class FakeQuery:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def limit(self, *args, **kwargs):
                return self

            def all(self):
                return self._rows

        class FakeSession:
            def __init__(self, rows):
                self._rows = rows

            def query(self, *args, **kwargs):
                return FakeQuery(self._rows)

        url = "https://smartstore.naver.com/thesujata/products/11043833896"
        rows = [
            Row(date(2026, 1, 1), url, "latest"),
            Row(date(2025, 12, 31), url, "prev"),
        ]

        def override_get_db():
            yield FakeSession(rows)

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.get("/search-rank/page-metrics/compare", params={"product_url": url})
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["product_url"], url)
            self.assertEqual(data["latest"]["title"], "latest")
            self.assertEqual(data["prev"]["title"], "prev")
        finally:
            app.dependency_overrides.pop(get_db, None)



