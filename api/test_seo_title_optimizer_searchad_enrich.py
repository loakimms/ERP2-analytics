import os
import unittest
from unittest.mock import MagicMock, patch


class SeoTitleOptimizerSearchAdEnrichTest(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "NAVER_AD_API_KEY": "adkey",
            "NAVER_AD_API_SECRET": "adsec",
            "NAVER_AD_CUSTOMER_ID": "1234567",
        },
        clear=False,
    )
    @patch("main.requests.get")
    def test_searchad_enrich_pool_fills_missing_metrics_for_tokens(self, mock_get: MagicMock) -> None:
        """
        SearchAd keywordstool이 메인 키워드 기준 연관검색어로만 채워질 때,
        Top40 토큰(또는 자동완성 등) 키워드의 searchAd 지표가 누락될 수 있다.

        이 테스트는 hintKeywords 배치 조회로 pool의 누락 searchAd가 채워지는지 검증한다.
        """
        from main import _searchad_enrich_pool_with_hint_keywords

        # pool: '헤나'(메인키워드) / '천연'(Top40 토큰 가정) 모두 searchAd 누락
        pool = {
            "헤나": {"keyword": "헤나", "titleFreq": 26},
            "천연": {"keyword": "천연", "titleFreq": 17},
        }

        def get_side_effect(url: str, *args, **kwargs):
            if "api.searchad.naver.com/keywordstool" not in url:
                r = MagicMock()
                r.status_code = 404
                r.json.return_value = {}
                return r
            params = kwargs.get("params") or {}
            hint = str(params.get("hintKeywords") or "")
            r = MagicMock()
            r.status_code = 200

            # 배치 hintKeywords(콤마 포함)로 들어오면 각 키워드 지표를 내려준다.
            if "," in hint:
                r.json.return_value = {
                    "keywordList": [
                        {
                            "relKeyword": "헤나",
                            "monthlyPcQcCnt": 1000,
                            "monthlyMobileQcCnt": 2000,
                            "monthlyAvePcCtr": 0.01,  # 1%
                            "monthlyAveMobileCtr": 0.02,  # 2%
                            "compIdx": "높음",
                        },
                        {
                            "relKeyword": "천연",
                            "monthlyPcQcCnt": 300,
                            "monthlyMobileQcCnt": 700,
                            "monthlyAvePcCtr": 1.5,
                            "monthlyAveMobileCtr": 2.5,
                            "compIdx": "중간",
                        },
                    ]
                }
                return r

            # 단일 호출은 비어있다고 가정(연관검색어 목록에 없는 상황)
            r.json.return_value = {"keywordList": []}
            return r

        mock_get.side_effect = get_side_effect

        enriched_cnt, errs = _searchad_enrich_pool_with_hint_keywords(pool, max_hint_keywords=30, batch_size=5)
        self.assertEqual(errs, [])
        self.assertEqual(enriched_cnt, 2)

        self.assertIn("searchAd", pool["헤나"])
        self.assertEqual(int(pool["헤나"]["searchAd"]["totalSearchQcCnt"]), 3000)
        self.assertEqual(str(pool["헤나"]["searchAd"]["compIdx"]), "높음")
        self.assertAlmostEqual(float(pool["헤나"]["searchAd"]["avgCtr"]), 1.67, places=2)  # 가중평균(1%,2%)

        self.assertIn("searchAd", pool["천연"])
        self.assertEqual(int(pool["천연"]["searchAd"]["totalSearchQcCnt"]), 1000)
        self.assertEqual(str(pool["천연"]["searchAd"]["compIdx"]), "중간")


