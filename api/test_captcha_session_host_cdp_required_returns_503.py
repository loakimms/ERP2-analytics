import unittest
from unittest.mock import MagicMock, patch


class CaptchaSessionHostCdpRequiredTest(unittest.TestCase):
    @patch("main._pw_call")
    def test_start_captcha_session_returns_503_when_host_cdp_required(self, mock_pw_call: MagicMock) -> None:
        """
        회귀 방지:
        - REQUIRE_HOST_CDP=1 환경에서 CDP 연결이 안 되면 RuntimeError("host_cdp_required")가 날 수 있다.
        - 이 때 500으로 터지면 UI는 원인/해결책을 알기 어렵다.
        - 따라서 503 + detail=host_cdp_required 로 명확히 반환해야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        # _pw_call 내부에서 실제 worker를 돌리지 않고, host_cdp_required를 던지는 상황을 시뮬레이션한다.
        def side_effect(fn, *args, **kwargs):
            raise RuntimeError("host_cdp_required")

        mock_pw_call.side_effect = side_effect

        url = "https://smartstore.naver.com/testmall/products/11043833896"
        res = client.post("/search-rank/page-metrics/captcha-session/start", params={"product_url": url})
        self.assertEqual(res.status_code, 503, msg=res.text)
        body = res.json() or {}
        # 구현은 lastErrorDetail을 함께 붙여 더 친절한 힌트를 줄 수 있다.
        self.assertTrue(str(body.get("detail") or "").startswith("host_cdp_required"))


if __name__ == "__main__":
    unittest.main()

