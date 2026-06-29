import unittest
from datetime import date
from unittest.mock import patch


class CaptchaReuseRefreshTest(unittest.TestCase):
    def test_reused_tab_refreshes_when_captcha_detected(self) -> None:
        """
        재사용 탭(existing)이 캡차 페이지에 머물러 있으면,
        같은 탭에서 goto(url)로 리프레시를 시도해야 한다.
        """
        from main import _scrape_product_page_metrics

        class FakePage:
            def __init__(self):
                self._step = 0
                self.goto_calls = 0
                self.url = "https://smartstore.naver.com/thesujata/products/1"

            def content(self):
                # 0회차: 캡차 신호 포함
                if self._step == 0:
                    return "<html><body>보안문자 captcha.naver.com</body></html>"
                # 리프레시 후: 정상 jsonld 포함
                return (
                    '<html><head><script type="application/ld+json">'
                    '{"@context":"https://schema.org","@type":"Product","name":"OK","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","reviewCount":"10"}}'
                    "</script></head><body>ok</body></html>"
                )

            def goto(self, url, wait_until=None, timeout=None):
                self.goto_calls += 1
                self._step = 1
                self.url = url

            def wait_for_load_state(self, *args, **kwargs):
                return None

            def wait_for_timeout(self, *args, **kwargs):
                return None

            def evaluate(self, *args, **kwargs):
                return "ok"

        class FakeCtx:
            pass

        fake_page = FakePage()

        with patch("main._playwright_enabled", return_value=True), patch(
            "main._pw_in_worker_thread", return_value=True
        ), patch("main._ensure_pw_context", return_value=FakeCtx()), patch(
            "main._find_existing_product_page", return_value=fake_page
        ):
            r = _scrape_product_page_metrics("https://smartstore.naver.com/thesujata/products/1")

        self.assertGreaterEqual(fake_page.goto_calls, 1)
        self.assertEqual(r.get("error"), None)
        self.assertEqual(r.get("title"), "OK")


if __name__ == "__main__":
    unittest.main()


