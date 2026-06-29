import unittest
from unittest.mock import MagicMock, patch


class SeoTitleOptimizerFallbackHostCdpTest(unittest.TestCase):
    @patch("main._searchad_keywordstool")
    @patch("main._pw_call")
    @patch("main._pw_in_worker_thread")
    @patch("main._playwright_enabled")
    @patch("main._fetch_naver_shop_top_products")
    def test_title_optimizer_falls_back_to_shop_json_when_host_cdp_required(
        self,
        mock_shop: MagicMock,
        mock_pw_enabled: MagicMock,
        mock_in_worker: MagicMock,
        mock_pw_call: MagicMock,
        mock_searchad: MagicMock,
    ) -> None:
        """
        REQUIRE_HOST_CDP=1 환경에서 Playwright가 host Chrome(CDP)에 연결 실패하면
        이전에는 500으로 터져 UI에서 'Network Error'로 보일 수 있었다.

        이 테스트는 Playwright 예외가 발생해도 shop.json(OpenAPI) fallback으로
        정상 200 응답이 생성되는지 검증한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        mock_pw_enabled.return_value = True
        mock_in_worker.return_value = False
        mock_pw_call.side_effect = RuntimeError("Playwright worker task failed: host_cdp_required")

        mock_shop.return_value = {"items": [{"title": "A"}, {"title": "B"}]}
        mock_searchad.return_value = ([], None)

        res = client.post(
            "/research/seo/title-optimizer",
            params={
                "product_name": "수자타 파우더",
                "category_id": "5000311",
                "category_path": "화장품/미용>헤어스타일링>염색약",
                "main_keyword": "헤나염색약",
                "date_from": "2025-12-21",
                "date_to": "2026-01-20",
                "limit_titles": 40,
                "candidate_count": 20,
                "combo_count": 10,
                "max_tokens_total": 8,
                "include_autocomplete": False,
            },
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        body = res.json() or {}
        shopping = body.get("shopping") or {}
        titles = (shopping.get("titles") or [])
        self.assertGreaterEqual(len(titles), 1)
        self.assertIn("A", titles)
        # fallback이 적용되면 needsCaptcha는 false(또는 최소 에러 없이 동작)여야 한다.
        self.assertFalse(bool(shopping.get("needsCaptcha")))


if __name__ == "__main__":
    unittest.main()

