import unittest
from unittest.mock import MagicMock, patch


class ApiSettingsValidateTest(unittest.TestCase):
    def test_validate_openapi_ok(self) -> None:
        import main

        # credentials 존재하도록 주입
        with patch("main._get_api_setting") as mock_get, patch("main.requests.get") as mock_req:
            def _fake_get(name: str) -> str:
                if name in ("NAVER_SEARCH_CLIENT_ID", "NAVER_KEY", "NAVER_CLIENT_ID"):
                    return "id"
                if name in ("NAVER_SEARCH_CLIENT_SECRET", "NAVER_SECRET", "NAVER_CLIENT_SECRET"):
                    return "sec"
                return ""

            mock_get.side_effect = _fake_get

            resp = MagicMock()
            resp.status_code = 200
            resp.text = "{}"
            resp.json.return_value = {"items": []}
            mock_req.return_value = resp

            out = main.validate_naver_openapi()
            self.assertTrue(bool(getattr(out, "ok", False)))

    def test_validate_searchad_fail_when_missing(self) -> None:
        import main
        with patch("main._get_api_setting") as mock_get:
            mock_get.return_value = ""
            out = main.validate_searchad()
            self.assertFalse(bool(getattr(out, "ok", True)))


if __name__ == "__main__":
    unittest.main()

