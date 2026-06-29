import unittest
from unittest.mock import MagicMock, patch


class HostCdpDevtoolsUrlsTest(unittest.TestCase):
    def test_host_cdp_devtools_urls_builds_inspector_url_from_ws(self) -> None:
        import main

        # PW_CONTEXT_CDP_URL은 "실제 연결된 CDP 주소"로, NAS override 등도 반영될 수 있다.
        main.PW_CONTEXT_CDP_URL = "http://192.168.0.23:9223"

        # 서버(컨테이너)가 json/list를 읽으면 websocket host가 192.168.*로 보일 수 있다.
        # 하지만 사용자는 호스트에서 127.0.0.1:9223로 devtools를 여는 것이 가장 안정적이므로,
        # ws param은 127.0.0.1로 치환되어야 한다.
        targets = [
            {
                "url": "https://smartstore.naver.com/foo/products/123",
                "webSocketDebuggerUrl": "ws://192.168.0.23:9223/devtools/page/ABC",
            }
        ]

        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = targets

        with patch("main._host_cdp_http_base", return_value="http://127.0.0.1:9223"), patch(
            "main.requests.get", return_value=resp
        ):
            out = main._host_cdp_devtools_urls(match_url_contains="smartstore.naver.com")

        self.assertTrue(out.get("running"))
        self.assertEqual(out.get("json_list_url"), "http://127.0.0.1:9223/json/list")
        self.assertEqual(out.get("picked_target_url"), "https://smartstore.naver.com/foo/products/123")
        self.assertEqual(
            out.get("devtools_url"),
            "http://127.0.0.1:9223/devtools/inspector.html?ws=127.0.0.1:9223/devtools/page/ABC",
        )

    def test_host_cdp_devtools_urls_falls_back_to_json_list_when_unreachable(self) -> None:
        import main

        main.PW_CONTEXT_CDP_URL = "http://192.168.0.23:9223"

        with patch("main._host_cdp_http_base", return_value="http://127.0.0.1:9223"), patch(
            "main.requests.get", side_effect=RuntimeError("connect failed")
        ):
            out = main._host_cdp_devtools_urls(match_url_contains="smartstore.naver.com")

        self.assertTrue(out.get("running"))
        self.assertEqual(out.get("json_list_url"), "http://127.0.0.1:9223/json/list")
        self.assertIsNone(out.get("devtools_url"))
        # 힌트/에러는 best-effort로 담긴다.
        self.assertIn("host_cdp", str(out.get("hint")))


if __name__ == "__main__":
    unittest.main()

