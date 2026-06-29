import unittest
from unittest.mock import MagicMock, patch


class CaptchaSessionReconnectTest(unittest.TestCase):
    def test_start_captcha_session_resets_context_when_host_cdp_becomes_available(self) -> None:
        """
        구조적 회귀 방지:
        - 이전에 connect_over_cdp가 실패해 PW_LAST_CDP_ERROR가 남아있으면,
          이후 Host Chrome을 켠 뒤 다시 시도해도 container_chromium 컨텍스트를 재사용해
          "창이 안 뜬다/세션 준비가 안 된다" 착시가 발생할 수 있다.
        - 따라서 start_captcha_session(사용자 명시 액션)에서
          host CDP(/json/version)가 reachable이면 컨텍스트를 리셋하고 재연결을 시도한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        # 실패 상태를 시뮬레이션
        main.PW_LAST_CDP_ERROR = "connect_over_cdp_failed"
        main.PW_LAST_CDP_ERROR_DETAIL = "TimeoutError: cdp_unreachable:192.168.0.52:9223"

        with patch("main._use_host_chrome", return_value=True), patch(
            "main._pw_cdp_url", return_value="http://192.168.65.254:9223"
        ), patch("main._as_http_url", side_effect=lambda x: x), patch(
            "main._probe_http_status", return_value=(True, 200, None)
        ), patch(
            "main._close_pw_connection_keep_runtime"
        ) as close_mock, patch(
            "main._pw_call", side_effect=lambda fn, *args, **kwargs: fn()
        ), patch(
            "main._with_pw_cdp_url_override"
        ) as with_override_mock, patch(
            "main._pw_runtime_mode", return_value="host_cdp"
        ), patch(
            "main._host_cdp_devtools_urls", return_value={"devtools_url": "http://127.0.0.1:9223/devtools/inspector.html?ws=x", "json_list_url": "http://127.0.0.1:9223/json/list"}
        ):
            res = client.post(
                "/search-rank/page-metrics/captcha-session/start",
                params={"product_url": "https://smartstore.naver.com/testmall/products/11043833896"},
            )

        self.assertEqual(res.status_code, 200, msg=res.text)
        # host가 reachable + lastError => worker 경유 connection-only reset이 호출되어야 한다.
        close_mock.assert_called()
        # 그 다음 실제 세션 준비 로직이 실행되도록 override wrapper가 호출되어야 한다.
        with_override_mock.assert_called()


if __name__ == "__main__":
    unittest.main()

