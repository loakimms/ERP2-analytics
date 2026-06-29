import os
import unittest
from unittest.mock import MagicMock, patch


class AdsCollectMetaAutoRefreshTest(unittest.TestCase):
    """
    목표:
    - 리포트에 등장한 campaignId/adgroupId가 현재 메타 캐시에 없으면
      LIGHT 메타(force_refresh)를 자동으로 1회 수행해 이름 매핑 누락(=표시 누락)을 방지한다.
    """

    @patch.dict(
        os.environ,
        {
            "NAVER_AD_API_KEY": "adkey",
            "NAVER_AD_API_SECRET": "adsec",
            "NAVER_AD_CUSTOMER_ID": "1234567",
            "NAVER_AD_API_BASE": "https://api.searchad.naver.com",
        },
        clear=False,
    )
    @patch("main.upsert_keyword_daily_from_df")
    @patch("main._searchad_build_meta")
    @patch("main._searchad_fetch_report_rows")
    @patch("main._searchad_build_keyword_meta_map_for_adgroups")
    def test_collect_keyword_refreshes_light_meta_when_unknown_ids_present(
        self,
        mock_kw_meta: MagicMock,
        mock_fetch: MagicMock,
        mock_meta: MagicMock,
        mock_upsert: MagicMock,
    ) -> None:
        import main

        # 1) initial meta (stale): cmp-old/grp-old only
        # 2) refresh meta: cmp-new/grp-new 포함
        mock_meta.side_effect = [
            ({"cmp-old": "CAMP_OLD"}, {"grp-old": "GRP_OLD"}, {}, {}, {}),
            ({"cmp-new": "CAMP_NEW"}, {"grp-new": "GRP_NEW"}, {}, {}, {}),
        ]

        # stat-reports rows includes unknown ids
        mock_fetch.side_effect = [
            [
                {"campaignId": "cmp-new", "adgroupId": "grp-new", "keywordId": "kwd-1", "device": "P", "impCnt": 10, "clkCnt": 1, "salesAmt": 1000},
            ],
            [
                {"campaignId": "cmp-new", "adgroupId": "grp-new", "keywordId": "kwd-1", "device": "P", "convType": "purchase", "convCnt": 1, "convAmt": 5000},
            ],
        ]

        mock_kw_meta.return_value = {"kwd-1": {"keyword": "헤나", "adgroupId": "grp-new"}}
        mock_upsert.return_value = 1

        out = main._collect_searchad_daily("2026-01-16", kinds=("keyword",))
        self.assertTrue(out.get("ok"))
        self.assertEqual(int(out.get("insertedKeyword") or 0), 1)

        # meta는 2회 호출되어야 한다: initial + refresh(force_refresh)
        self.assertGreaterEqual(mock_meta.call_count, 2)

        # refresh가 일어난 경우 timings에 meta_refresh_sec가 들어간다
        timings = out.get("_timings") or {}
        self.assertTrue("meta_refresh_sec" in timings)


if __name__ == "__main__":
    unittest.main()

