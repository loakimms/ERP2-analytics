import unittest
from unittest.mock import patch


class PwCdpOverrideRuntimeReuseTest(unittest.TestCase):
    def test_with_pw_cdp_url_override_reuses_runtime_and_resets_connection_only(self) -> None:
        """
        회귀 방지:
        - host CDP 대상이 바뀌면 기존 컨텍스트/브라우저는 닫아야 한다.
        - 하지만 Playwright 런타임(PW)까지 stop/start 하면
          일부 런타임에서 sync_playwright 재시작이 asyncio loop 오류로 이어질 수 있다.
        - 따라서 override 전환 시에는 "연결만" 리셋해야 한다.
        """
        import main

        old_ctx = main.PW_CONTEXT
        old_browser = main.PW_BROWSER
        old_cdp_url = main.PW_CONTEXT_CDP_URL
        try:
            main.PW_CONTEXT = object()
            main.PW_BROWSER = object()
            main.PW_CONTEXT_CDP_URL = "http://old-target:9223"

            with patch("main._pw_in_worker_thread", return_value=True), patch(
                "main._close_pw_connection_keep_runtime"
            ) as keep_runtime_close, patch("main._close_pw_context") as full_close:
                out = main._with_pw_cdp_url_override("http://new-target:9223", lambda: "ok")

            self.assertEqual(out, "ok")
            keep_runtime_close.assert_called_once()
            full_close.assert_not_called()
        finally:
            main.PW_CONTEXT = old_ctx
            main.PW_BROWSER = old_browser
            main.PW_CONTEXT_CDP_URL = old_cdp_url


if __name__ == "__main__":
    unittest.main()
