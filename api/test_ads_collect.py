import os
import unittest
from unittest.mock import MagicMock, patch


class AdsCollectTest(unittest.TestCase):
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
    @patch("main.upsert_searchword_daily_from_df")
    @patch("main.upsert_keyword_daily_from_df")
    @patch("main.requests.get")
    @patch("main.requests.post")
    def test_collect_searchad_daily_keyword_and_searchword(
        self,
        mock_post: MagicMock,
        mock_get: MagicMock,
        mock_upsert_kw: MagicMock,
        mock_upsert_sw: MagicMock,
    ) -> None:
        """
        - /stat-reports(키워드/검색어) 호출 결과를 캠페인/광고그룹/키워드명으로 매핑하고
          DB upsert 함수에 DataFrame을 전달하는지 검증한다.
        """
        from main import _collect_searchad_daily

        job_to_download: dict[str, str] = {
            "job-ad": "/download-ad",
            "job-conv": "/download-conv",
            "job-search": "/download-search",
        }

        # --- GET: /ncc/campaigns, /ncc/adgroups, /ncc/keywords, /stat-reports/{id}, downloadUrl ---
        def get_side_effect(url: str, *args, **kwargs):
            # Naver SearchAd는 base+uri 형태로 호출될 수 있음
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
            if url.endswith("/ncc/keywords"):
                # query param nccAdgroupId=grp-1
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccKeywordId": "kwd-1", "keyword": "헤나"}]
                return r

            # poll/download (단순화): status=BUILT + downloadUrl 제공
            if "/stat-reports/" in url and not url.endswith("/download-ad") and not url.endswith("/download-conv") and not url.endswith("/download-search"):
                r = MagicMock()
                r.status_code = 200
                job_id = url.rsplit("/", 1)[-1]
                r.json.return_value = {"status": "BUILT", "downloadUrl": job_to_download.get(job_id, "/download-ad")}
                return r

            if url.endswith("/download-ad"):
                # AD(14 columns): (unused), device, impressions, clicks, cost(ex VAT), (unused), (unused)
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20251210",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "kwd-1",
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
                # AD_CONVERSION(13 columns): convType 기반
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20251210",
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

            if url.endswith("/download-search"):
                # SEARCH도 내부 파서/DF 변환만 타는지 확인(단순 1행)
                r = MagicMock()
                r.status_code = 200
                r.text = "\t".join(
                    [
                        "20251210",
                        "1234567",
                        "cmp-1",
                        "grp-1",
                        "kwd-1",
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

            # unknown
            r = MagicMock()
            r.status_code = 404
            r.json.return_value = {}
            r.text = ""
            return r

        mock_get.side_effect = get_side_effect

        # --- POST: /stat-reports (키워드, 검색어 각각 1회) ---
        def post_side_effect(url: str, *args, **kwargs):
            r = MagicMock()
            if url.endswith("/stat-reports"):
                r.status_code = 200
                # downloadUrl은 없고 jobId만 주는 케이스
                body = kwargs.get("json") or {}
                tp = str(body.get("reportTp") or "")
                if tp == "AD_CONVERSION":
                    r.json.return_value = {"reportJobId": "job-conv"}
                elif tp == "SEARCH":
                    r.json.return_value = {"reportJobId": "job-search"}
                else:
                    r.json.return_value = {"reportJobId": "job-ad"}
                return r
            r.status_code = 404
            r.json.return_value = {}
            return r

        mock_post.side_effect = post_side_effect

        # upsert 함수는 "레코드 수"를 반환하도록 가정
        mock_upsert_kw.return_value = 1
        mock_upsert_sw.return_value = 1

        out = _collect_searchad_daily("2025-12-10", kinds=("keyword", "searchword"))
        self.assertTrue(out.get("ok"))
        self.assertEqual(out.get("date"), "2025-12-10")
        self.assertEqual(int(out.get("insertedKeyword", 0)), 1)
        self.assertEqual(int(out.get("insertedSearchword", 0)), 1)

        # upsert 호출 시 DF에 핵심 컬럼이 포함되는지 확인
        self.assertTrue(mock_upsert_kw.called)
        args_kw, kwargs_kw = mock_upsert_kw.call_args
        df_kw = args_kw[0]
        self.assertIn("캠페인", df_kw.columns)
        self.assertIn("광고 그룹", df_kw.columns)
        self.assertIn("키워드", df_kw.columns)
        self.assertIn("노출수", df_kw.columns)
        self.assertIn("총비용(원)", df_kw.columns)
        self.assertIn("전환매출액(원)", df_kw.columns)

        self.assertTrue(mock_upsert_sw.called)
        args_sw, kwargs_sw = mock_upsert_sw.call_args
        df_sw = args_sw[0]
        self.assertIn("검색어", df_sw.columns)
        self.assertIn("캠페인", df_sw.columns)

    def test_upload_searchword_csv_normalize(self) -> None:
        """
        UI 검색어 CSV(대표 컬럼: 캠페인/광고그룹/검색어/노출수/클릭수/총비용(VAT포함,원)/전환수/전환매출액(원))가
        API 내부 정규화로 '총비용(원)' 등을 생성하는지 검증한다.
        """
        from main import _normalize_ui_searchword_csv_to_df
        import pandas as pd

        df = pd.DataFrame(
            [
                {
                    "캠페인": "C1",
                    "캠페인유형": "쇼핑검색",
                    "광고그룹": "G1",
                    "검색어": "헤나염색",
                    "키워드": "헤나염색약",
                    "노출수": "1000",
                    "클릭수": "50",
                    "총비용(VAT포함,원)": "12,345",
                    "전환수": "3",
                    "전환매출액(원)": "55,000",
                }
            ]
        )
        out = _normalize_ui_searchword_csv_to_df(df, date_ymd="2025-12-30")
        self.assertFalse(out.empty)
        self.assertIn("검색어", out.columns)
        self.assertIn("키워드", out.columns)
        self.assertIn("캠페인유형", out.columns)
        # UI 보고서의 '키워드' 컬럼을 보존해야 한다.
        self.assertEqual(str(out.iloc[0].get("검색어")), "헤나염색")
        self.assertEqual(str(out.iloc[0].get("키워드")), "헤나염색약")
        self.assertEqual(str(out.iloc[0].get("캠페인유형")), "쇼핑검색")
        self.assertIn("총비용(원)", out.columns)
        self.assertEqual(int(out.iloc[0]["총비용(원)"]), 12345)


if __name__ == "__main__":
    unittest.main()


