import unittest
from unittest.mock import MagicMock, patch


class ApiSettingsValidateCommerceTest(unittest.TestCase):
    def test_validate_naver_commerce_ok(self) -> None:
        import main

        with patch("main._get_api_setting") as mock_get, patch(
            "main._naver_commerce_client_secret_sign"
        ) as mock_sign, patch("main.requests.post") as mock_post:
            mock_get.side_effect = lambda k: {
                "NAVER_COMMERCE_CLIENT_ID": "cid",
                "NAVER_COMMERCE_CLIENT_SECRET": "$2a$10$abcdefghijklmnopqrstuv",
            }.get(k, "")
            mock_sign.return_value = "SIG"

            resp = MagicMock()
            resp.status_code = 200
            resp.text = '{"access_token":"t","token_type":"Bearer"}'
            resp.json.return_value = {"access_token": "t", "token_type": "Bearer"}
            mock_post.return_value = resp

            out = main.validate_naver_commerce()
            self.assertTrue(bool(getattr(out, "ok", False)))
            self.assertEqual(getattr(out, "service", None), "naver-commerce")

    def test_validate_naver_commerce_missing_creds(self) -> None:
        import main

        with patch("main._get_api_setting") as mock_get:
            mock_get.return_value = ""
            out = main.validate_naver_commerce()
            self.assertFalse(bool(getattr(out, "ok", True)))
            self.assertEqual(getattr(out, "status_code", None), 400)

    def test_validate_naver_commerce_http_error(self) -> None:
        import main

        with patch("main._get_api_setting") as mock_get, patch(
            "main._naver_commerce_client_secret_sign"
        ) as mock_sign, patch("main.requests.post") as mock_post:
            mock_get.side_effect = lambda k: {
                "NAVER_COMMERCE_CLIENT_ID": "cid",
                "NAVER_COMMERCE_CLIENT_SECRET": "$2a$10$abcdefghijklmnopqrstuv",
            }.get(k, "")
            mock_sign.return_value = "SIG"

            resp = MagicMock()
            resp.status_code = 403
            resp.text = "forbidden"
            resp.json.return_value = {"code": "GW.AUTHZ"}
            mock_post.return_value = resp

            out = main.validate_naver_commerce()
            self.assertFalse(bool(getattr(out, "ok", True)))
            self.assertEqual(getattr(out, "status_code", None), 403)


if __name__ == "__main__":
    unittest.main()

