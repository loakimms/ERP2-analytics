import unittest
from unittest.mock import MagicMock, patch


class CaptchaSessionHostCdpOpenTabTest(unittest.TestCase):
    @patch("main._canonical_product_id", return_value="pid-1")
    @patch("main._pw_runtime_mode", return_value="host_cdp")
    @patch("main._pw_new_page")
    @patch("main._find_existing_product_page")
    @patch("main._ensure_pw_context")
    @patch("main._pw_call")
    def test_start_captcha_session_force_new_opens_new_tab_and_brings_to_front(
        self,
        mock_pw_call: MagicMock,
        mock_ensure_ctx: MagicMock,
        mock_find_existing: MagicMock,
        mock_new_page: MagicMock,
        mock_runtime_mode: MagicMock,
        mock_pid: MagicMock,
    ) -> None:
        """
        회귀 방지:
        - host_cdp 모드에서 기존 탭을 재사용하면 사용자는 "탭이 안 열린다"고 느낄 수 있다.
        - force_new=true 또는 host_cdp 모드에서는 새 탭을 열고(가능하면) bring_to_front를 시도해야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        # _pw_call은 thread/worker wrapper인데, 테스트에서는 즉시 실행되도록 한다.
        def _call(fn, *args, **kwargs):
            return fn()

        mock_pw_call.side_effect = _call

        ctx = MagicMock()
        mock_ensure_ctx.return_value = ctx

        existing = MagicMock()
        existing.goto = MagicMock()
        existing.bring_to_front = MagicMock()
        mock_find_existing.return_value = existing

        created = MagicMock()
        created.goto = MagicMock()
        created.bring_to_front = MagicMock()
        mock_new_page.return_value = created

        url = "https://smartstore.naver.com/testmall/products/11043833896"
        res = client.post(
            "/search-rank/page-metrics/captcha-session/start",
            params={"product_url": url, "force_new": True},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        # host_cdp + force_new => 기존 탭을 무시하고 새 탭을 열어야 한다.
        mock_new_page.assert_called_once()
        mock_find_existing.assert_not_called()
        created.goto.assert_called()
        created.bring_to_front.assert_called()


if __name__ == "__main__":
    unittest.main()

