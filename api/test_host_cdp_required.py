import unittest
from unittest.mock import patch


class HostCdpRequiredTest(unittest.TestCase):
    def test_scrape_returns_host_cdp_required_when_context_creation_fails(self) -> None:
        """
        REQUIRE_HOST_CDP=1 환경에서 CDP 연결 실패 시,
        컨테이너/requests로 폴백하지 않고 host_cdp_required로 즉시 반환해야 한다.
        (불필요한 추가 요청이 100% 캡차/차단을 유발하는 것을 방지)
        """
        from main import _scrape_product_page_metrics

        with patch.dict("os.environ", {"REQUIRE_HOST_CDP": "1", "USE_HOST_CHROME": "1"}), patch(
            "main._playwright_enabled", return_value=True
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context", side_effect=RuntimeError("host_cdp_required")
        ):
            r = _scrape_product_page_metrics("https://smartstore.naver.com/x/products/1")

        self.assertEqual(r.get("error"), "host_cdp_required")
        self.assertEqual(r.get("http_status"), 503)
        dbg = r.get("debug") or {}
        self.assertTrue(isinstance(dbg, dict))


if __name__ == "__main__":
    unittest.main()

