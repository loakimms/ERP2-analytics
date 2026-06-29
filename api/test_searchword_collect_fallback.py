import unittest
from unittest.mock import MagicMock, patch


class SearchwordCollectFallbackTest(unittest.TestCase):
    @patch("main.upsert_searchword_daily_from_df")
    @patch("main._searchad_fetch_report_rows")
    @patch("main._searchad_build_meta")
    def test_searchword_collect_falls_back_to_expkeyword_on_11001(
        self,
        mock_meta: MagicMock,
        mock_fetch: MagicMock,
        mock_upsert: MagicMock,
    ) -> None:
        import main
        from fastapi import HTTPException

        # minimal meta maps
        mock_meta.return_value = (
            {"cmp1": "CAMP1"},  # campaign_name_map
            {"grp1": "GRP1"},  # adgroup_name_map
            {},  # keyword_meta_map
            {},  # campaign_status_by_name
            {},  # adgroup_status_by_name
        )

        # 1) SEARCH fails with 11001
        # 2) EXPKEYWORD succeeds and returns rows without query but with keywordId(string)
        mock_fetch.side_effect = [
            HTTPException(status_code=502, detail='SearchAd stat-reports failed: 400 / {"code":11001,"message":"잘못된 파라미터 형식입니다."}'),
            [
                {
                    "statDt": "20260116",
                    "campaignId": "cmp1",
                    "adgroupId": "grp1",
                    "keywordId": "헤나염색약",
                    "impCnt": 10,
                    "clkCnt": 1,
                    "salesAmt": 1000,
                    "convCnt": 0,
                    "convAmt": 0,
                }
            ],
        ]
        mock_upsert.return_value = 1

        r = main._collect_searchad_daily("2026-01-16", kinds=("searchword",))
        self.assertTrue(r.get("ok"))
        self.assertEqual(r.get("insertedSearchword"), 1)
        self.assertEqual(mock_fetch.call_count, 2)
        self.assertTrue(mock_upsert.called)


if __name__ == "__main__":
    unittest.main()

