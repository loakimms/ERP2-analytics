import unittest
from unittest.mock import MagicMock, patch


class NaverCommerceReviewsProbeTest(unittest.TestCase):
    def test_probe_builds_report_without_token_leak(self) -> None:
        import main

        # token 발급 성공 + 리뷰 endpoint는 404/405 등 다양한 케이스 가능하므로
        # "호출/집계" 자체가 되는지만 검증한다.
        with patch("main._get_api_setting") as mock_get, patch(
            "main._naver_commerce_client_secret_sign"
        ) as mock_sign, patch("main.requests.post") as mock_post, patch(
            "main.requests.request"
        ) as mock_req:
            mock_get.side_effect = lambda k: {
                "NAVER_COMMERCE_CLIENT_ID": "cid",
                "NAVER_COMMERCE_CLIENT_SECRET": "$2a$10$abcdefghijklmnopqrstuv",
            }.get(k, "")
            mock_sign.return_value = "SIG"

            tok = MagicMock()
            tok.status_code = 200
            tok.text = '{"access_token":"t"}'
            tok.json.return_value = {"access_token": "t"}
            mock_post.return_value = tok

            r = MagicMock()
            r.status_code = 404
            r.text = "not found"
            r.json.return_value = {"code": "NOT_FOUND"}
            mock_req.return_value = r

            out = main.probe_naver_commerce_reviews_endpoints()
            self.assertIn("token", out)
            self.assertIn("calls", out)
            self.assertIsInstance(out["calls"], list)
            # 토큰 자체는 응답에 포함되면 안 된다.
            self.assertNotIn("access_token", str(out))


if __name__ == "__main__":
    unittest.main()

