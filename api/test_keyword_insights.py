import os
import unittest
from unittest.mock import MagicMock, patch


class KeywordInsightsTest(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "NAVER_SEARCH_CLIENT_ID": "cid",
            "NAVER_SEARCH_CLIENT_SECRET": "csec",
            "NAVER_AD_API_KEY": "adkey",
            "NAVER_AD_API_SECRET": "adsec",
            "NAVER_AD_CUSTOMER_ID": "1234567",
        },
        clear=False,
    )
    @patch("main.requests.get")
    @patch("main.requests.post")
    def test_keyword_insights_happy_path(self, mock_post: MagicMock, mock_get: MagicMock) -> None:
        """
        - DataLab 트렌드/분포 + SearchAd keywordstool + 쇼핑 카테고리/상품수 파싱이
          하나의 응답으로 조합되는지 검증한다.
        """
        # NOTE: analytics-api 컨테이너는 /app 을 모듈 루트로 실행하므로 `main` 으로 import 한다.
        from main import _build_keyword_insights

        # GET: Naver shop.json (productCount) + shopping page (category)
        mock_shop_json = MagicMock()
        mock_shop_json.status_code = 200
        mock_shop_json.json.return_value = {
            "total": 12345,
            "items": [
                {"category1": "화장품/미용", "category2": "헤어스타일링", "category3": "염색약"},
                {"category1": "화장품/미용", "category2": "헤어스타일링", "category3": "염색약"},
                {"category1": "화장품/미용", "category2": "헤어스타일링", "category3": "염색약"},
                {"category1": "화장품/미용", "category2": "헤어스타일링", "category3": "헤어케어"},
            ],
        }

        mock_shopping_page = MagicMock()
        mock_shopping_page.status_code = 200
        mock_shopping_page.text = (
            '<html><body>{"mainFilters":[{"value":"50000000"}],"subFilters":{"productCount":999}}</body></html>'
        )

        # POST: datalab search + shopping keyword click distributions (3 calls)
        def post_side_effect(url: str, *args, **kwargs):
            resp = MagicMock()
            resp.status_code = 200
            if url.endswith("/v1/datalab/search"):
                resp.json.return_value = {
                    "results": [
                        {"title": "헤나", "data": [{"period": "2025-01-01", "ratio": 10}, {"period": "2025-01-02", "ratio": 20}]}
                    ]
                }
                return resp
            # shopping keyword click dist
            if url.endswith("/keyword/gender"):
                # period 두 개를 주고 mean+정규화가 적용되는지 확인
                resp.json.return_value = {
                    "results": [
                        {
                            "data": [
                                {"period": "2025-01-01", "group": "m", "ratio": 8},
                                {"period": "2025-01-01", "group": "f", "ratio": 24},
                                {"period": "2025-01-02", "group": "m", "ratio": 10},
                                {"period": "2025-01-02", "group": "f", "ratio": 26},
                            ]
                        }
                    ]
                }
                return resp
            if url.endswith("/keyword/device"):
                resp.json.return_value = {
                    "results": [
                        {
                            "data": [
                                {"period": "2025-01-01", "group": "pc", "ratio": 9},
                                {"period": "2025-01-01", "group": "mo", "ratio": 29},
                                {"period": "2025-01-02", "group": "pc", "ratio": 8},
                                {"period": "2025-01-02", "group": "mo", "ratio": 31},
                            ]
                        }
                    ]
                }
                return resp
            if url.endswith("/keyword/age"):
                resp.json.return_value = {
                    "results": [
                        {
                            "data": [
                                {"period": "2025-01-01", "group": "10", "ratio": 1},
                                {"period": "2025-01-01", "group": "50", "ratio": 5},
                                {"period": "2025-01-02", "group": "10", "ratio": 1},
                                {"period": "2025-01-02", "group": "50", "ratio": 7},
                            ]
                        }
                    ]
                }
                return resp
            resp.json.return_value = {}
            return resp

        mock_post.side_effect = post_side_effect

        # SearchAd keywordstool: use GET via requests.get (second call) in our impl
        def get_side_effect(url: str, *args, **kwargs):
            if "openapi.naver.com/v1/search/shop.json" in url:
                return mock_shop_json
            if "search.shopping.naver.com/search/all" in url:
                return mock_shopping_page
            if "api.searchad.naver.com/keywordstool" in url:
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = {
                    "keywordList": [
                        {
                            "relKeyword": "헤나",
                            "monthlyPcQcCnt": 1000,
                            "monthlyMobileQcCnt": 2000,
                            "monthlyAvePcClkCnt": 10,
                            "monthlyAveMobileClkCnt": 20,
                            "monthlyAvePcCtr": 0.01,
                            "monthlyAveMobileCtr": 0.02,
                            "plAvgDepth": 15,
                            "compIdx": "중간",
                        },
                        {"relKeyword": "헤나염색", "monthlyPcQcCnt": 500, "monthlyMobileQcCnt": 600, "compIdx": "낮음"},
                    ]
                }
                return r
            return mock_shopping_page

        mock_get.side_effect = get_side_effect

        out = _build_keyword_insights(keyword="헤나", date_from="2025-01-01", date_to="2025-01-31")
        self.assertEqual(out["keyword"], "헤나")
        self.assertEqual(out["shopping"]["category"], "50000000")
        self.assertEqual(out["shopping"]["productCount"], 12345)
        self.assertTrue(isinstance(out["shopping"].get("categoryPath"), (str, type(None))))
        self.assertTrue(isinstance(out["shopping"].get("categoryConfidencePct"), (float, int, type(None))))
        top3 = out["shopping"].get("categoryTop3") or []
        self.assertTrue(isinstance(top3, list))
        if top3:
            self.assertTrue("path" in top3[0])
            self.assertTrue("confidencePct" in top3[0])
        self.assertEqual(len(out["trend"]["points"]), 2)
        self.assertTrue(len(out["relatedKeywords"]) >= 1)
        self.assertTrue(len(out["distributions"]["gender"]) >= 1)
        # 분포는 '검색 비율'로 고정: ratio(%)로 내려가야 함
        self.assertAlmostEqual(out["distributions"]["gender"][0]["ratio"] + out["distributions"]["gender"][1]["ratio"], 100.0, places=1)


if __name__ == "__main__":
    unittest.main()


