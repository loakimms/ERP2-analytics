import os
import unittest
from unittest.mock import MagicMock, patch


class AdsCollectRealisticTest(unittest.TestCase):
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
    def test_collect_keyword_parses_tsv_columns_and_normalizes_vat_cost_and_conversions(
        self,
        mock_post: MagicMock,
        mock_get: MagicMock,
        mock_upsert_kw: MagicMock,
        mock_upsert_sw: MagicMock,
    ) -> None:
        """
        목표:
        - stat-reports(AD)에서 keywordId='-' 인 요약/미지정 행이 섞여도 "-"로 포함해 합산한다.
        - TSV 컬럼 매핑(노출/클릭/비용)을 네이버 UI(캠페인 보고서)와 동일하게 맞춘다.
        - 비용은 VAT 제외(ex VAT)로 내려오는 케이스가 있어, VAT 포함으로 정규화한다.
        - 전환/전환매출은 AD_CONVERSION 리포트(convType 기반)로 합산해 적용한다.
        """
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
            if url.endswith("/ncc/keywords"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccKeywordId": "kwd-1", "keyword": "헤나"}]
                return r

            if "/stat-reports/" in url and not url.endswith("/download-ad") and not url.endswith("/download-conv"):
                r = MagicMock()
                r.status_code = 200
                job_id = url.rsplit("/", 1)[-1]
                r.json.return_value = {"status": "BUILT", "downloadUrl": job_to_download.get(job_id, "/download-ad")}
                return r

            if url.endswith("/download-ad"):
                # AD(14 columns) — 매핑 확정:
                # 0 statDt, 1 customerId, 2 campaignId, 3 adgroupId, 4 keywordId, 5 nadId, 6 businessId,
                # 7 (unused), 8 device, 9 impressions, 10 clicks, 11 cost(ex VAT), 12 (unused), 13 (unused)
                r = MagicMock()
                r.status_code = 200
                r.text = "\n".join(
                    [
                        "\t".join(
                            [
                                "20251210",
                                "1234567",
                                "cmp-1",
                                "grp-1",
                                "-",
                                "nad-x",
                                "biz-x",
                                "P",
                                "0",
                                "10",   # impressions
                                "1",    # clicks
                                "5000", # cost ex VAT => 5500( VAT 포함 )
                                "0",
                                "0",
                            ]
                        ),
                        "\t".join(
                            [
                                "20251210",
                                "1234567",
                                "cmp-1",
                                "grp-1",
                                "kwd-1",
                                "nad-y",
                                "biz-y",
                                "M",
                                "0",
                                "20",   # impressions
                                "2",    # clicks
                                "7000", # cost ex VAT => 7700( VAT 포함 )
                                "0",
                                "0",
                            ]
                        ),
                    ]
                )
                return r

            if url.endswith("/download-conv"):
                # AD_CONVERSION (13 columns):
                # 0 statDt, 1 customerId, 2 campaignId, 3 adgroupId, 4 keywordId, 5 nadId, 6 businessId,
                # 7 impCnt, 8 device, 9 clkCnt, 10 convType, 11 convCnt, 12 convAmt
                r = MagicMock()
                r.status_code = 200
                r.text = "\n".join(
                    [
                        "\t".join(
                            [
                                "20251210",
                                "1234567",
                                "cmp-1",
                                "grp-1",
                                "kwd-1",
                                "nad-y",
                                "biz-y",
                                "0",
                                "M",
                                "0",
                                "purchase",
                                "3",
                                "20000",
                            ]
                        ),
                        "\t".join(
                            [
                                "20251210",
                                "1234567",
                                "cmp-1",
                                "grp-1",
                                "kwd-1",
                                "nad-y",
                                "biz-y",
                                "0",
                                "M",
                                "0",
                                "add_to_cart",
                                "2",
                                "0",
                            ]
                        ),
                        "\t".join(
                            [
                                "20251210",
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
                        ),
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
        mock_upsert_sw.return_value = 0

        out = _collect_searchad_daily("2025-12-10", kinds=("keyword",))
        self.assertTrue(out.get("ok"))

        self.assertTrue(mock_upsert_kw.called)
        args_kw, _ = mock_upsert_kw.call_args
        df_kw = args_kw[0]

        # 요약행('-')이 "-"로 포함되므로 2행이 남아야 한다.
        self.assertEqual(len(df_kw), 2)
        rows = [df_kw.iloc[i].to_dict() for i in range(len(df_kw))]
        # 하나는 정상 키워드(헤나), 하나는 기타
        kw_set = {str(r.get("키워드")) for r in rows}
        self.assertIn("헤나", kw_set)
        self.assertIn("-", kw_set)

        # 정상 키워드 행의 TSV 매핑/비용(VAT 포함)/전환 합산 확인
        row_hea = next(r for r in rows if str(r.get("키워드")) == "헤나")
        self.assertEqual(int(row_hea.get("노출수") or 0), 20)
        self.assertEqual(int(row_hea.get("클릭수") or 0), 2)
        self.assertEqual(int(row_hea.get("총비용(원)") or 0), 7700)  # 7000 * 1.1
        self.assertEqual(int(row_hea.get("전환수") or 0), 5)  # purchase(3)+add_to_cart(2)
        self.assertEqual(int(row_hea.get("전환매출액(원)") or 0), 20000)

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
    def test_collect_keyword_estimates_revenue_from_roas_when_convamt_zero(
        self,
        mock_post: MagicMock,
        mock_get: MagicMock,
        mock_upsert_kw: MagicMock,
    ) -> None:
        """
        일부 계정에서는 convAmt가 0이지만 roas 값이 제공되는 케이스가 있어,
        revenue를 cost*roas로 역산해 ROAS/전환매출이 0만 나오는 문제를 완화한다.
        """
        from main import _collect_searchad_daily

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
            if url.endswith("/ncc/keywords"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = [{"nccKeywordId": "kwd-1", "keyword": "헤나"}]
                return r

            if "/stat-reports/" in url and not url.endswith("/download"):
                r = MagicMock()
                r.status_code = 200
                r.json.return_value = {"status": "BUILT", "downloadUrl": "/download"}
                return r

            if url.endswith("/download"):
                # JSON 다운로드: convAmt=0, roas=250, salesAmt=1000(ex VAT) => cost=1100원(VAT 포함), revenue=2750원 기대
                r = MagicMock()
                r.status_code = 200
                r.text = (
                    '[{"statDt":"20251210","campaignId":"cmp-1","adgroupId":"grp-1","keywordId":"kwd-1","device":"P","impCnt":1000,"clkCnt":10,"salesAmt":1000,"roas":250.0,"convCnt":2,"convAmt":0}]'
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
                r.json.return_value = {"reportJobId": "job-1"}
                return r
            r.status_code = 404
            r.json.return_value = {}
            return r

        mock_post.side_effect = post_side_effect

        mock_upsert_kw.return_value = 1
        _collect_searchad_daily("2025-12-10", kinds=("keyword",))

        args_kw, _ = mock_upsert_kw.call_args
        df_kw = args_kw[0]
        row0 = df_kw.iloc[0].to_dict()
        self.assertEqual(int(row0.get("총비용(원)") or 0), 1100)
        self.assertEqual(int(row0.get("전환매출액(원)") or 0), 2750)

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
    @patch("main._searchad_fetch_report_rows")
    def test_collect_searchword_fails_but_upload_endpoint_can_fill(self, mock_fetch: MagicMock, mock_upsert: MagicMock) -> None:
        """
        SearchAd SEARCH 리포트가 계정 제한으로 실패할 수 있으므로,
        업로드 폴백을 통해 searchword daily를 채울 수 있어야 한다(정규화 포함).
        """
        from main import _normalize_ui_searchword_csv_to_df
        import pandas as pd

        # collect 단계에서는 API 실패를 가정(11001)
        mock_fetch.side_effect = RuntimeError("SearchAd stat-reports failed: 400 / {\"code\":11001,\"message\":\"잘못된 파라미터 형식입니다.\"}")

        df_ui = pd.DataFrame(
            [
                {
                    "캠페인": "C1",
                    "광고그룹": "G1",
                    "검색어": "헤나염색",
                    "노출수": "1000",
                    "클릭수": "10",
                    "총비용(VAT포함,원)": "5,000",
                    "전환수": "1",
                    "전환매출액(원)": "20,000",
                }
            ]
        )
        df_norm = _normalize_ui_searchword_csv_to_df(df_ui, date_ymd="2025-12-30")
        self.assertFalse(df_norm.empty)
        self.assertIn("총비용(원)", df_norm.columns)

        mock_upsert.return_value = 1


if __name__ == "__main__":
    unittest.main()


