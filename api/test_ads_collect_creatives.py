import os
import unittest
from unittest.mock import MagicMock, patch


class AdsCollectCreativesTest(unittest.TestCase):
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
    @patch("main.upsert_creative_daily_from_df")
    @patch("main.requests.get")
    @patch("main.requests.post")
    def test_collect_searchad_daily_creatives_merges_conversions_by_nad_id(
        self,
        mock_post: MagicMock,
        mock_get: MagicMock,
        mock_upsert_cr: MagicMock,
    ) -> None:
        from main import _collect_searchad_daily

        job_to_download: dict[str, str] = {
            "job-ad": "/download-ad",
            "job-conv": "/download-conv",
        }

        def get_side_effect(url: str, *args, **kwargs):
            if url.endswith("/ncc/campaigns"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccCampaignId": "cmp-1", "name": "CAMP1"}]
                return r
            if url.endswith("/ncc/adgroups"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccAdgroupId": "grp-1", "nccCampaignId": "cmp-1", "name": "GRP1"}]
                return r
            if url.endswith("/ncc/ads"):
                r = MagicMock()
                r.status_code = 200
                # 소재 메타(best-effort)
                r.json.return_value = [{
                    "nccAdId": "nad-x",
                    "name": "ADNAME_X",
                    "productName": "상품A",
                    "thumbnailUrl": "http://img.test/a.png",
                    # 쇼핑소재 케이스: bid/qiGrade는 /ncc/ads 응답 구조에 있을 수 있다.
                    "adAttr": {"bidAmt": 1200},
                    "nccQi": {"qiGrade": 7},
                }]
                return r
            if url.endswith("/ncc/keywords"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [
                    {"nccAdgroupId": "grp-1", "bidAmt": 1500, "adRelevanceScore": 9, "expectedClickScore": 10},
                    {"nccAdgroupId": "grp-1", "bidAmt": 1000, "adRelevanceScore": 8, "expectedClickScore": 9},
                ]
                return r

            if "/stat-reports/" in url and not url.endswith("/download-ad") and not url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                job_id = url.rsplit("/", 1)[-1]
                r.json.return_value = {"status": "BUILT", "downloadUrl": job_to_download.get(job_id, "/download-ad")}
                return r

            if url.endswith("/download-ad"):
                # AD(14 columns) — nadId 포함
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20260110",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "-",
                        "nad-x",
                        "biz-x",
                        "0",
                        "P",
                        "100",
                        "10",
                        "1000",
                        "0",
                        "0",
                    ]
                )
                return r

            if url.endswith("/download-conv"):
                # AD_CONVERSION(13 columns): nadId + convType + convCnt/convAmt
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20260110",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "-",
                        "nad-x",
                        "biz-x",
                        "0",
                        "P",
                        "0",
                        "purchase",
                        "2",
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

        mock_upsert_cr.return_value = 1

        out = _collect_searchad_daily("2026-01-10", kinds=("creative",))
        self.assertTrue(out.get("ok"))
        self.assertEqual(int(out.get("insertedCreative", 0)), 1)

        self.assertTrue(mock_upsert_cr.called)
        args_cr, kwargs_cr = mock_upsert_cr.call_args
        df_cr = args_cr[0]
        self.assertIn("캠페인", df_cr.columns)
        self.assertIn("광고 그룹", df_cr.columns)
        self.assertIn("현재입찰가", df_cr.columns)
        self.assertIn("품질지수", df_cr.columns)
        self.assertIn("평균노출순위", df_cr.columns)


class AdsCollectCreativesVerifyMissingTest(unittest.TestCase):
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
    @patch("main.upsert_creative_daily_from_df")
    @patch("main.requests.get")
    @patch("main.requests.post")
    def test_collect_searchad_daily_creatives_verifies_and_fills_missing_ads_with_zero_metrics(
        self,
        mock_post: MagicMock,
        mock_get: MagicMock,
        mock_upsert_cr: MagicMock,
    ) -> None:
        import main
        from main import _collect_searchad_daily

        # 글로벌 캐시가 테스트 간에 공유되므로, 이 테스트는 항상 깨끗한 상태에서 시작한다.
        try:
            main._SEARCHAD_ADS_BY_ADGROUP_CACHE.clear()
        except Exception:
            pass
        try:
            main._SEARCHAD_META_CACHE["ts"] = 0.0
            main._SEARCHAD_META_CACHE["value"] = None
            main._SEARCHAD_META_LIGHT_CACHE["ts"] = 0.0
            main._SEARCHAD_META_LIGHT_CACHE["value"] = None
        except Exception:
            pass

        job_to_download: dict[str, str] = {"job-ad": "/download-ad", "job-conv": "/download-conv"}

        def get_side_effect(url: str, *args, **kwargs):
            if url.endswith("/ncc/campaigns"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccCampaignId": "cmp-1", "name": "CAMP1"}]
                return r
            if url.endswith("/ncc/adgroups"):
                r = MagicMock()
                r.status_code = 200
                # adgroups 목록(사전 expected 구성에 사용)
                r.json.return_value = [{"nccAdgroupId": "grp-1", "nccCampaignId": "cmp-1", "name": "GRP1"}]
                return r
            if url.endswith("/ncc/ads"):
                r = MagicMock()
                r.status_code = 200
                params = kwargs.get("params") or {}
                offset = int(params.get("offset") or 0)
                # offset=0 에서만 3개 반환(페이지네이션 best-effort)
                if offset == 0:
                    r.json.return_value = [
                        {"nccAdId": "nad-a001-02-1", "nccAdgroupId": "grp-1", "nccCampaignId": "cmp-1", "name": "AD1"},
                        {"nccAdId": "nad-a001-02-2", "nccAdgroupId": "grp-1", "nccCampaignId": "cmp-1", "name": "AD2"},
                        {"nccAdId": "nad-a001-02-3", "nccAdgroupId": "grp-1", "nccCampaignId": "cmp-1", "name": "AD3"},
                    ]
                else:
                    r.json.return_value = []
                return r

            if "/stat-reports/" in url and not url.endswith("/download-ad") and not url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                job_id = url.rsplit("/", 1)[-1]
                r.json.return_value = {"status": "BUILT", "downloadUrl": job_to_download.get(job_id, "/download-ad")}
                return r

            if url.endswith("/download-ad"):
                # 통계에는 AD1만 등장(AD2/AD3는 0지표로 누락되는 케이스)
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20260110",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "-",
                        "nad-a001-02-1",
                        "biz-x",
                        "0",
                        "P",
                        "10",
                        "1",
                        "100",
                        "0",
                        "0",
                    ]
                )
                return r
            if url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20260110",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "-",
                        "nad-a001-02-1",
                        "biz-x",
                        "0",
                        "P",
                        "0",
                        "purchase",
                        "0",
                        "0",
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
        mock_upsert_cr.return_value = 3

        out = _collect_searchad_daily(
            "2026-01-10",
            kinds=("creative",),
            scope_adgroups=["GRP1"],
            verify_missing=True,
            max_retries=0,
        )
        self.assertTrue(out.get("ok"))
        self.assertEqual(int(out.get("insertedCreative", 0)), 3)

        args_cr, _kwargs_cr = mock_upsert_cr.call_args
        df_cr = args_cr[0]
        ids = sorted([str(x) for x in df_cr["소재ID"].tolist()])
        self.assertEqual(ids, ["nad-a001-02-1", "nad-a001-02-2", "nad-a001-02-3"])
        # 누락 보강된 소재는 0지표로 저장된다.
        zero_rows = df_cr[df_cr["소재ID"].isin(["nad-a001-02-2", "nad-a001-02-3"])]
        self.assertTrue(all(int(x) == 0 for x in zero_rows["노출수"].tolist()))


class AdsCollectCreativesMetaFallbackTest(unittest.TestCase):
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
    @patch("main.upsert_creative_daily_from_df")
    @patch("main.requests.get")
    @patch("main.requests.post")
    def test_collect_searchad_daily_creatives_falls_back_to_single_ad_lookup_when_list_missing(
        self,
        mock_post: MagicMock,
        mock_get: MagicMock,
        mock_upsert_cr: MagicMock,
    ) -> None:
        from main import _collect_searchad_daily

        job_to_download: dict[str, str] = {"job-ad": "/download-ad", "job-conv": "/download-conv"}

        def get_side_effect(url: str, *args, **kwargs):
            if url.endswith("/ncc/campaigns"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccCampaignId": "cmp-1", "name": "CAMP1"}]
                return r
            if url.endswith("/ncc/adgroups"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccAdgroupId": "grp-1", "nccCampaignId": "cmp-1", "name": "GRP1"}]
                return r
            if url.endswith("/ncc/ads"):
                r = MagicMock()
                r.status_code = 200
                # 리스트 조회가 비어 있는 케이스(누락)
                r.json.return_value = []
                return r
            if url.endswith("/ncc/ads/nad-x"):
                r = MagicMock()
                r.status_code = 200
                # 단건 조회로 메타 보강
                r.json.return_value = {"nccAdId": "nad-x", "name": "ADNAME_X", "productName": "상품A", "thumbnailUrl": "http://img.test/a.png"}
                return r

            if "/stat-reports/" in url and not url.endswith("/download-ad") and not url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                job_id = url.rsplit("/", 1)[-1]
                r.json.return_value = {"status": "BUILT", "downloadUrl": job_to_download.get(job_id, "/download-ad")}
                return r

            if url.endswith("/download-ad"):
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20260110",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "-",
                        "nad-x",
                        "biz-x",
                        "0",
                        "P",
                        "100",
                        "10",
                        "1000",
                        "0",
                        "0",
                    ]
                )
                return r

            if url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20260110",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "-",
                        "nad-x",
                        "biz-x",
                        "0",
                        "P",
                        "0",
                        "purchase",
                        "1",
                        "1000",
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

        mock_upsert_cr.return_value = 1
        out = _collect_searchad_daily("2026-01-10", kinds=("creative",))
        self.assertTrue(out.get("ok"))
        self.assertEqual(int(out.get("insertedCreative", 0)), 1)

        args_cr, _kwargs_cr = mock_upsert_cr.call_args
        df_cr = args_cr[0]
        self.assertIn("상품명", df_cr.columns)
        self.assertIn("이미지URL", df_cr.columns)
        # 단건 조회 메타가 반영되어야 한다
        self.assertEqual(str(df_cr.iloc[0].get("상품명") or ""), "상품A")
        self.assertEqual(str(df_cr.iloc[0].get("이미지URL") or ""), "http://img.test/a.png")
        self.assertIn("소재ID", df_cr.columns)
        self.assertIn("소재명", df_cr.columns)
        self.assertIn("전환수", df_cr.columns)
        self.assertIn("전환매출액(원)", df_cr.columns)


if __name__ == "__main__":
    unittest.main()

