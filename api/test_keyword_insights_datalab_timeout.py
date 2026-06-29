import unittest
from unittest.mock import patch

import requests

import main


class KeywordInsightsDataLabTimeoutTest(unittest.TestCase):
    def setUp(self) -> None:
        # 캐시 오염 방지
        try:
            main.KEYWORD_INSIGHTS_CACHE.clear()
        except Exception:
            pass

    def test_build_keyword_insights_must_not_500_on_datalab_timeout(self) -> None:
        # DataLab timeout이 발생해도 500(예외)로 터지면 안 되고,
        # trend는 빈 배열 + keywordToolError에 원인이 포함되어야 한다.

        def raise_timeout(*args, **kwargs):
            raise requests.exceptions.ReadTimeout("timeout")

        with patch("main._naver_openapi_headers", return_value={"X-Naver-Client-Id": "t", "X-Naver-Client-Secret": "t"}), patch(
            "main.requests.post", side_effect=raise_timeout
        ), patch(
            "main._shopping_search_page_info",
            return_value={
                "category": "50000002",
                "productCount": 0,
                "categoryPath": "화장품/미용>...",
                "categoryConfidencePct": None,
                "categoryTop3": [],
                "categoryIdSource": "test",
            },
        ), patch(
            "main._searchad_keywordstool",
            return_value=([], None),
        ), patch(
            "main._naver_blog_count",
            return_value=0,
        ), patch(
            # 분포 쪽도 외부 호출이므로 테스트에서 고정
            "main._datalab_shopping_keyword_click_distribution_mean",
            return_value=[],
        ), patch(
            "main._datalab_shopping_distribution",
            return_value=[],
        ), patch(
            "main._datalab_gender_share",
            return_value=[],
        ), patch(
            "main._datalab_age_share",
            return_value=[],
        ):
            out = main._build_keyword_insights(
                keyword="헤나염색약",
                date_from="2026-02-11",
                date_to="2026-02-11",
                shopping_category=None,
                force=True,
            )

        self.assertIsInstance(out, dict)
        self.assertIn("trend", out)
        trend = out.get("trend") or {}
        self.assertIsInstance(trend, dict)
        self.assertEqual(trend.get("points") or [], [])
        # 에러 문자열이 사용자/디버깅에 남아야 한다.
        err = str(out.get("keywordToolError") or "")
        self.assertIn("DataLab trend", err)
        self.assertIn("datalab_timeout", err)


if __name__ == "__main__":
    unittest.main()

