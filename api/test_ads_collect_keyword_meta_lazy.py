import os
import unittest
from unittest.mock import MagicMock, patch


class AdsCollectKeywordMetaLazyTest(unittest.TestCase):
    """
    목표:
    - /ads/collect(keyword)에서 FULL 메타(=모든 광고그룹에 대해 /ncc/keywords 반복 호출)를 하지 않는다.
    - stat-reports(AD)에 실제로 등장한 광고그룹만 대상으로 /ncc/keywords를 호출한다.
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
    @patch("main.requests.get")
    @patch("main.requests.post")
    def test_collect_keyword_fetches_keywords_only_for_used_adgroups(
        self,
        mock_post: MagicMock,
        mock_get: MagicMock,
        mock_upsert_kw: MagicMock,
    ) -> None:
        import main
        from main import _collect_searchad_daily

        # 글로벌 캐시가 테스트 간에 공유되므로, 이 테스트는 항상 깨끗한 상태에서 시작한다.
        try:
            main._SEARCHAD_KEYWORDS_BY_ADGROUP_CACHE.clear()
        except Exception:
            pass
        try:
            main._SEARCHAD_META_LIGHT_CACHE["ts"] = 0.0
            main._SEARCHAD_META_LIGHT_CACHE["value"] = None
        except Exception:
            pass

        keywords_called_for: list[str] = []

        def get_side_effect(url: str, *args, **kwargs):
            if url.endswith("/ncc/campaigns"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccCampaignId": "cmp-1", "name": "CAMP1"}]
                return r

            if url.endswith("/ncc/adgroups"):
                r = MagicMock()
                r.status_code = 200
                # 광고그룹은 3개지만, 리포트에는 grp-1만 등장시킨다.
                r.json.return_value = [
                    {"nccAdgroupId": "grp-1", "nccCampaignId": "cmp-1", "name": "GRP1"},
                    {"nccAdgroupId": "grp-2", "nccCampaignId": "cmp-1", "name": "GRP2"},
                    {"nccAdgroupId": "grp-3", "nccCampaignId": "cmp-1", "name": "GRP3"},
                ]
                return r

            if url.endswith("/ncc/keywords"):
                params = kwargs.get("params") or {}
                gid = str(params.get("nccAdgroupId") or "")
                keywords_called_for.append(gid)
                r = MagicMock()
                r.status_code = 200
                if gid == "grp-1":
                    r.json.return_value = [{"nccKeywordId": "kwd-1", "keyword": "헤나"}]
                else:
                    # 호출되면 실패로 간주(테스트가 잡아야 함)
                    r.json.return_value = [{"nccKeywordId": "kwd-x", "keyword": "SHOULD_NOT_BE_FETCHED"}]
                return r

            # poll(downloadUrl)
            if "/stat-reports/" in url and not url.endswith("/download-ad") and not url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                job_id = url.rsplit("/", 1)[-1]
                dl = "/download-conv" if job_id == "job-conv" else "/download-ad"
                r.json.return_value = {"status": "BUILT", "downloadUrl": dl}
                return r

            if url.endswith("/download-ad"):
                r = MagicMock()
                r.status_code = 200
                # AD(14 columns) — adgroupId=grp-1만 포함
                r.text = "\t".join(
                    [
                        "20260116",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "kwd-1",
                        "nad-x",
                        "biz-x",
                        "0",
                        "P",
                        "10",
                        "1",
                        "1000",
                        "0",
                        "0",
                    ]
                )
                return r

            if url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                # AD_CONVERSION(13 columns)
                r.text = "\t".join(
                    [
                        "20260116",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "kwd-1",
                        "nad-x",
                        "biz-x",
                        "0",
                        "P",
                        "0",
                        "purchase",
                        "1",
                        "5000",
                    ]
                )
                return r

            r = MagicMock()
            r.status_code = 404
            r.json.return_value = {}
            r.text = ""
            return r

        mock_get.side_effect = get_side_effect

        def post_side_effect(url: str, *args, **kwargs):
            r = MagicMock()
            if url.endswith("/stat-reports"):
                r.status_code = 200
                body = kwargs.get("json") or {}
                tp = str(body.get("reportTp") or "")
                if tp == "AD_CONVERSION":
                    r.json.return_value = {"reportJobId": "job-conv"}
                else:
                    r.json.return_value = {"reportJobId": "job-ad"}
                return r
            r.status_code = 404
            r.json.return_value = {}
            return r

        mock_post.side_effect = post_side_effect
        mock_upsert_kw.return_value = 1

        out = _collect_searchad_daily("2026-01-16", kinds=("keyword",))
        self.assertTrue(out.get("ok"))
        self.assertEqual(int(out.get("insertedKeyword") or 0), 1)

        # 핵심 검증: /ncc/keywords는 grp-1에 대해서만 호출되어야 한다.
        self.assertEqual(sorted(set(keywords_called_for)), ["grp-1"])


if __name__ == "__main__":
    unittest.main()

