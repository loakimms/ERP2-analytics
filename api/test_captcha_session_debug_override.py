import unittest
from unittest.mock import MagicMock, patch


class CaptchaSessionDebugOverrideTest(unittest.TestCase):
    def test_debug_endpoint_uses_override_url_when_client_ip_given(self) -> None:
        import main

        # pretend we're in NAS/NAT environment
        req = MagicMock()
        req.headers.get.side_effect = lambda k, default=None: {"x-erp2-client-ip": "192.168.0.23"}.get(k, default)
        req.client = MagicMock()
        req.client.host = "172.20.0.1"

        captured: dict[str, str | None] = {"override": None}

        def fake_with_override(override_url, fn, *args, **kwargs):
            captured["override"] = override_url
            # don't execute the real fn (it would start playwright); return stub
            return {"running": True, "mode": "host_cdp", "cdp": {"enabled": True}}

        with patch("main._use_host_chrome", return_value=True), patch(
            "main._pick_client_ip_from_request", return_value="192.168.0.23"
        ), patch("main._with_pw_cdp_url_override", side_effect=fake_with_override):
            out = main.debug_captcha_session(req=req, client_ip="192.168.0.23")

        self.assertTrue(out.get("running"))
        self.assertEqual(captured["override"], "http://192.168.0.23:9223")


if __name__ == "__main__":
    unittest.main()

