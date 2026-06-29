import unittest
from unittest.mock import patch


class DevtoolsUrlsHostCdpTest(unittest.TestCase):
    def test_current_devtools_urls_returns_host_json_list_when_host_cdp(self) -> None:
        """
        USE_HOST_CHROME(CDP) 모드에서는 컨테이너 DevTools(9222/포워딩)가 아니라
        호스트 Chrome(Remote Debugging) 쪽 json/list를 안내해야 한다.
        """
        from main import _current_devtools_urls

        with patch.dict("os.environ", {"PW_CDP_URL": "http://host.docker.internal:9333"}), patch(
            "main._pw_runtime_mode", return_value="host_cdp"
        ):
            out = _current_devtools_urls(match_url_contains="smartstore.naver.com")

        self.assertEqual(out.get("running"), True)
        self.assertEqual(out.get("json_list_url"), "http://127.0.0.1:9333/json/list")
        self.assertIn("host_cdp", str(out.get("hint") or ""))

    def test_start_captcha_session_returns_host_urls_when_host_cdp(self) -> None:
        """
        /search-rank/page-metrics/captcha-session/start 가 host_cdp 모드에서
        컨테이너 DevTools 링크를 만들면 사용자가 '다른 세션'에서 캡차를 풀어 실패할 수 있다.
        따라서 host Chrome json/list 를 반환해야 한다.
        """
        from fastapi.testclient import TestClient
        from main import app

        class FakePage:
            def __init__(self):
                self.url = "about:blank"

            def goto(self, *args, **kwargs):
                self.url = str(args[0]) if args else self.url

            def wait_for_timeout(self, *args, **kwargs):
                return None

            def bring_to_front(self, *args, **kwargs):
                return None

            def evaluate(self, *args, **kwargs):
                return ""

            def content(self, *args, **kwargs):
                return ""

        class FakeCtx:
            def __init__(self):
                self.pages = []

            def new_page(self):
                return FakePage()

        def direct_pw_call(fn):
            fn()

        with patch.dict("os.environ", {"PW_CDP_URL": "http://host.docker.internal:9444"}), patch(
            "main._pw_runtime_mode", return_value="host_cdp"
        ), patch("main._pw_call", side_effect=direct_pw_call), patch(
            "main._ensure_pw_context", return_value=FakeCtx()
        ), patch("main._find_existing_product_page", return_value=None), patch(
            "main._get_captcha_shared_page", return_value=None
        ), patch("main._get_shared_page_metrics_page", return_value=None), patch(
            "main._pw_new_page", side_effect=lambda ctx: ctx.new_page()
        ):
            client = TestClient(app)
            resp = client.post(
                "/search-rank/page-metrics/captcha-session/start",
                params={"product_url": "https://smartstore.naver.com/x/products/1"},
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("json_list_url"), "http://127.0.0.1:9444/json/list")
        self.assertIn("host_cdp", str(data.get("hint") or ""))

    def test_start_captcha_session_sets_service_blocked_hint_when_page_blocked(self) -> None:
        from fastapi.testclient import TestClient
        from main import app

        class FakePage:
            def __init__(self):
                self.url = "about:blank"

            def goto(self, *args, **kwargs):
                self.url = str(args[0]) if args else self.url

            def wait_for_timeout(self, *args, **kwargs):
                return None

            def bring_to_front(self, *args, **kwargs):
                return None

            def evaluate(self, *args, **kwargs):
                return "현재 서비스 접속이 불가능합니다.\n새로고침을 눌러주세요."

            def content(self, *args, **kwargs):
                return "<html><body>현재 서비스 접속이 불가능합니다</body></html>"

        class FakeCtx:
            def __init__(self):
                self.pages = []

            def new_page(self):
                return FakePage()

        def direct_pw_call(fn):
            return fn()

        with patch.dict("os.environ", {"PW_CDP_URL": "http://host.docker.internal:9444"}), patch(
            "main._pw_runtime_mode", return_value="host_cdp"
        ), patch("main._pw_call", side_effect=direct_pw_call), patch(
            "main._ensure_pw_context", return_value=FakeCtx()
        ), patch("main._find_existing_product_page", return_value=None), patch(
            "main._get_captcha_shared_page", return_value=None
        ), patch("main._get_shared_page_metrics_page", return_value=None), patch(
            "main._pw_new_page", side_effect=lambda ctx: ctx.new_page()
        ):
            client = TestClient(app)
            resp = client.post(
                "/search-rank/page-metrics/captcha-session/start",
                params={"product_url": "https://smartstore.naver.com/x/products/1"},
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("page_block"), "service_blocked")
        self.assertIn("서비스 접속이 불가능", str(data.get("hint") or ""))

    def test_host_cdp_devtools_urls_can_use_user_ip_when_provided(self) -> None:
        """
        NAS 모드에서는 9223이 127.0.0.1이 아닌 PC 사설 IP에만 바인딩된 환경이 있어,
        user_host_ip가 주어지면 json_list_url/devtools base도 그 IP를 사용해야 한다.
        """
        from main import _host_cdp_devtools_urls

        class FakeResp:
            status_code = 200

            def json(self):
                return []

        with patch.dict("os.environ", {"PW_CDP_URL": "http://host.docker.internal:9333"}), patch(
            "main.requests.get", return_value=FakeResp()
        ):
            out = _host_cdp_devtools_urls(match_url_contains="smartstore.naver.com", user_host_ip="192.168.0.52")

        self.assertEqual(out.get("running"), True)
        self.assertEqual(out.get("json_list_url"), "http://192.168.0.52:9333/json/list")

    def test_debug_captcha_session_exposes_mode_and_cdp_status(self) -> None:
        """
        UI가 사용자가 '어느 DevTools(호스트/컨테이너)를 열어야 하는지' 혼동하지 않도록,
        debug 응답에 mode/cdp 상태가 포함되어야 한다.
        """
        from fastapi.testclient import TestClient
        from main import app

        class FakeCtx:
            pages = []

        def direct_pw_call(fn):
            return fn()

        with patch.dict("os.environ", {"PW_CDP_URL": "http://host.docker.internal:9555"}), patch(
            "main._pw_runtime_mode", return_value="host_cdp"
        ), patch("main._use_host_chrome", return_value=True), patch(
            "main._ensure_pw_context", return_value=FakeCtx()
        ), patch("main._probe_http_status", return_value=(True, 200, None)), patch(
            "main._pw_call", side_effect=direct_pw_call
        ):
            client = TestClient(app)
            resp = client.get("/search-rank/page-metrics/captcha-session/debug")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("mode"), "host_cdp")
        self.assertTrue(bool((data.get("cdp") or {}).get("enabled")))
        self.assertEqual((data.get("cdp") or {}).get("host_http"), "http://127.0.0.1:9555")
        self.assertTrue("lastErrorDetail" in (data.get("cdp") or {}))
        container_http = str((data.get("cdp") or {}).get("container_http") or "")
        # 환경에 따라 host.docker.internal이 IP로 치환될 수 있어(host gateway),
        # 포트/스킴이 유지되는지만 확인한다.
        self.assertTrue(container_http.startswith("http://"))
        self.assertTrue(container_http.endswith(":9555"))
        self.assertEqual((data.get("cdp") or {}).get("container_http_reachable"), True)


if __name__ == "__main__":
    unittest.main()

