import unittest
import io
from unittest.mock import MagicMock, patch


class CreativesUploadTest(unittest.TestCase):
    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_splits_by_date_and_maps_columns(self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        # 네이버 "소재 보고서" CSV는 첫 줄에 제목이 들어오고, 2번째 줄이 헤더인 케이스가 흔하다.
        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.01.16.~2026.01.17.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"총비용(VAT포함,원)\",전환수,평균노출순위,전환율(%),전환매출액(원),전환당비용(원),광고수익률(%)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.01.16.,10,1,10,100,100,0,5.4,0,0,0,0",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.01.17.,20,2,10,200,400,1,2.1,5,60000,400,15000",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1, 1]
        mock_recompute.return_value = {"2026-01-16": 10, "2026-01-17": 20}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("dates"), ["2026-01-16", "2026-01-17"])
        self.assertEqual(j.get("processed_dates"), ["2026-01-16", "2026-01-17"])
        self.assertEqual(j.get("skipped_dates"), [])
        self.assertEqual(j.get("derived_recomputed_dates"), ["2026-01-16", "2026-01-17"])

        # 날짜별로 2회 호출되어야 한다.
        self.assertEqual(mock_upsert.call_count, 2)
        args0, kwargs0 = mock_upsert.call_args_list[0]
        args1, kwargs1 = mock_upsert.call_args_list[1]

        df0 = args0[0]
        df1 = args1[0]
        self.assertIn("총비용(원)", df0.columns)
        self.assertIn("CPC(원)", df0.columns)
        self.assertIn("ROAS(%)", df0.columns)
        self.assertIn("평균노출순위", df0.columns)
        self.assertIn("소재ID", df0.columns)

        # target_date는 ymd로 들어간다.
        self.assertEqual(args0[1], "2026-01-16")
        self.assertEqual(args1[1], "2026-01-17")

        # 업로드 소스가 명시된다.
        self.assertEqual(kwargs0.get("source"), "creative_upload")
        self.assertEqual(kwargs0.get("delete_mode"), "none")

        # 처리된 날짜만 파생 재계산이 호출된다.
        mock_recompute.assert_called_once_with(["2026-01-16", "2026-01-17"])

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_skips_existing_dates(self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.01.16.~2026.01.17.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"총비용(VAT포함,원)\",전환수,평균노출순위,전환율(%),전환매출액(원),전환당비용(원),광고수익률(%)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.01.16.,10,1,10,100,100,0,5.4,0,0,0,0",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.01.17.,20,2,10,200,400,1,2.1,5,60000,400,15000",
            ]
        )

        mock_existing.return_value = {"2026-01-16"}
        mock_upsert.side_effect = [3]
        mock_recompute.return_value = {"2026-01-17": 30}

        res = client.post(
            "/ads/creatives/upload?skip_existing_dates=1",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("dates"), ["2026-01-16", "2026-01-17"])
        self.assertEqual(j.get("processed_dates"), ["2026-01-17"])
        self.assertEqual(j.get("skipped_dates"), ["2026-01-16"])
        self.assertEqual(j.get("derived_recomputed_dates"), ["2026-01-17"])

        # 스킵된 날짜는 upsert가 호출되지 않는다.
        self.assertEqual(mock_upsert.call_count, 1)
        args0, _kwargs0 = mock_upsert.call_args_list[0]
        self.assertEqual(args0[1], "2026-01-17")

        # 파생 재계산도 처리된 날짜만 호출된다.
        mock_recompute.assert_called_once_with(["2026-01-17"])

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_processes_existing_dates_by_default(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        """
        평균노출순위 보강 목적의 업로드는 "이미 그 날짜에 데이터가 존재"하더라도
        다시 업서트하여 누락 필드를 채울 수 있어야 한다.
        (기본값: skip_existing_dates=false)
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.01.16.~2026.01.17.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"총비용(VAT포함,원)\",전환수,평균노출순위,전환율(%),전환매출액(원),전환당비용(원),광고수익률(%)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.01.16.,10,1,10,100,100,0,5.4,0,0,0,0",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.01.17.,20,2,10,200,400,1,2.1,5,60000,400,15000",
            ]
        )

        # 기존 날짜가 있어도(예: SearchAd API로 일부 수집됨) 업로드는 처리되어야 한다.
        mock_existing.return_value = {"2026-01-16"}
        mock_upsert.side_effect = [1, 1]
        mock_recompute.return_value = {"2026-01-16": 10, "2026-01-17": 20}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("dates"), ["2026-01-16", "2026-01-17"])
        self.assertEqual(j.get("processed_dates"), ["2026-01-16", "2026-01-17"])
        self.assertEqual(j.get("skipped_dates"), [])
        self.assertEqual(j.get("derived_recomputed_dates"), ["2026-01-16", "2026-01-17"])
        self.assertEqual(mock_upsert.call_count, 2)
        mock_recompute.assert_called_once_with(["2026-01-16", "2026-01-17"])

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_accepts_avg_rank_header_variants(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        """
        사용자 업로드(엑셀/CSV)에서 평균노출순위 헤더가 공백/괄호 등으로 변형된 경우에도
        표준 컬럼명("평균노출순위")으로 매핑되어야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.01.16.~2026.01.16.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"평균 노출 순위(미제공)\",\"총비용(VAT포함,원)\",전환수,전환율(%),전환매출액(원),전환당비용(원),광고수익률(%)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.01.16.,10,1,10,100,1.7,100,0,0,0,0,0",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-01-16": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        # upsert로 전달되는 DF는 표준 헤더를 가져야 한다.
        args0, _kwargs0 = mock_upsert.call_args_list[0]
        df0 = args0[0]
        self.assertIn("평균노출순위", df0.columns)
        self.assertEqual(float(df0["평균노출순위"].iloc[0]), 1.7)

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_accepts_current_bid_header_variants(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        """
        광고센터 소재 목록/소재 보고서의 "현재 입찰가(VAT미포함)" 헤더를
        일자별 소재 스냅샷(current_bid)으로 저장할 수 있어야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.01.16.~2026.01.16.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,\"현재 입찰가(VAT미포함)\",노출수,클릭수,\"평균 CPC\",\"총비용(VAT포함,원)\",총전환수,구매전환수,총전환매출액(원),구매전환매출액(원),광고수익률(%)",
                "CAMP1,GRP1,nad-a001-02-1,쇼핑검색,2026.01.16.,2500,10,1,100,100,0,0,0,0,0",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-01-16": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        args0, _kwargs0 = mock_upsert.call_args_list[0]
        df0 = args0[0]
        self.assertIn("현재입찰가", df0.columns)
        self.assertIn("CPC(원)", df0.columns)
        self.assertEqual(int(df0["현재입찰가"].iloc[0]), 2500)
        self.assertEqual(int(df0["CPC(원)"].iloc[0]), 100)

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_rejects_post_cutover_file_without_purchase_headers(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.03.09.~2026.03.09.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"총비용(VAT포함,원)\",총전환수,평균노출순위,전환율(%),총전환매출액(원),전환당비용(원),광고수익률(%)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.03.09.,10,1,10,100,100,2,5.4,20,60000,50,60000",
            ]
        )

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 400, msg=res.text)
        self.assertIn("구매전환수", res.text)
        self.assertIn("구매전환매출액(원)", res.text)
        self.assertEqual(mock_upsert.call_count, 0)
        mock_recompute.assert_not_called()
        mock_existing.assert_not_called()

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_accepts_post_cutover_excel_header_variants_without_won_suffix(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.03.09.~2026.03.09.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"총비용(VAT포함,원)\",총 전환수,구매전환 전환수,평균노출순위,전환율(%),총 전환매출액(원),구매전환 전환매출액(원),총 광고수익률(%)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.03.09.,10,1,10,100,100,9,4,5.4,20,120000,70000,2400",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-03-09": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        args0, kwargs0 = mock_upsert.call_args_list[0]
        df0 = args0[0]
        self.assertEqual(kwargs0.get("source"), "creative_upload")
        self.assertEqual(int(df0["전환수"].iloc[0]), 9)
        self.assertEqual(int(df0["구매전환수"].iloc[0]), 4)
        self.assertEqual(int(df0["전환매출액(원)"].iloc[0]), 120000)
        self.assertEqual(int(df0["구매전환매출액(원)"].iloc[0]), 70000)

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_accepts_post_cutover_headers_with_hidden_spaces(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.03.09.~2026.03.09.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"총비용(VAT포함,원)\",총 전환수,구매전환\u00a0 전환수,평균노출순위,전환율(%),총 전환매출액(원),구매전환  전환매출액(원),총 광고수익률(%)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.03.09.,10,1,10,100,100,9,4,5.4,20,120000,70000,2400",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-03-09": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_accepts_purchase_complete_headers(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"소재 보고서(2026.03.09.~2026.03.09.),example:naver\"",
                "캠페인,광고그룹,소재,소재 유형,일별,노출수,클릭수,클릭률(%),\"평균클릭비용(VAT포함,원)\",\"총비용(VAT포함,원)\",총 전환수,평균노출순위,전환율(%),총 전환매출액(원),총 광고수익률(%),구매완료 전환수,구매완료 전환매출액(원)",
                "CAMP1,GRP1,nad-a001-01-1,파워링크-단일형,2026.03.09.,10,1,10,100,100,9,5.4,20,120000,2400,4,70000",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-03-09": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("creatives.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_xlsx_detects_header_row_after_title_line(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        """
        XLSX 업로드에서 1행이 "소재 보고서(...)" 같은 제목행인 경우,
        header=0으로 읽으면 컬럼이 깨져 '필수 컬럼 없음'으로 오인한다.
        따라서 헤더 행을 자동 탐지해서 정상 업로드되어야 한다.
        """
        from fastapi.testclient import TestClient
        from openpyxl import Workbook
        import main

        client = TestClient(main.app)

        # 0행: 제목 / 1행: 헤더 / 2행~: 데이터
        title_row = ["소재 보고서(2026.01.22.~2026.01.22.),loa1991:naver"]
        header_row = [
            "캠페인",
            "광고그룹",
            "소재",
            "소재 유형",
            "일별",
            "노출수",
            "클릭수",
            "클릭률(%)",
            "평균클릭비용(VAT포함,원)",
            "총비용(VAT포함,원)",
            "전환수",
            "평균노출순위(미제공)",
            "전환율(%)",
            "전환매출액(원)",
            "전환당비용(원)",
            "광고수익률(%)",
        ]
        data_row = [
            "CAMP1",
            "GRP1",
            "nad-a001-01-1",
            "파워링크-단일형",
            "2026.01.22.",
            30,
            2,
            6.67,
            913,
            1826,
            1,
            1.2,
            0,
            50000,
            1826,
            1423.88,
        ]

        # openpyxl로 "제목행 + 헤더행 + 데이터행"을 명시적으로 생성
        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        ws.append(title_row + [""] * (len(header_row) - 1))
        ws.append(header_row)
        ws.append(data_row)
        bio = io.BytesIO()
        wb.save(bio)
        xlsx_bytes = bio.getvalue()

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-01-22": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={
                "file": (
                    "creatives.xlsx",
                    xlsx_bytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        # upsert로 전달되는 DF는 표준 헤더를 가져야 한다.
        args0, _kwargs0 = mock_upsert.call_args_list[0]
        df0 = args0[0]
        self.assertIn("캠페인", df0.columns)
        self.assertIn("광고그룹", df0.columns)
        self.assertIn("소재", df0.columns)
        self.assertIn("일별", df0.columns)
        self.assertIn("평균노출순위", df0.columns)

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_csv_title_line_autodetects_header_row(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        """
        CSV 파일에서 1행이 리포트 제목(일소재별평균노출순위_... 같은 형식)이고
        2행이 실제 헤더인 경우에도 자동으로 헤더를 탐지해야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"일소재별평균노출순위_김명수(2026.01.22.~2026.01.22.),loa1991:naver\"",
                "광고 캠페인,광고 그룹,소재,일별,평균노출순위",
                "CAMP1,GRP1,nad-a001-01-1,2026.01.22.,1.2",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-01-22": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("일소재별평균노출순위_김명수(2026.01.22.~2026.01.22.),loa1991:naver.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

    @patch("main._recompute_creative_organic_derived_dates")
    @patch("main._existing_creative_dates")
    @patch("main.upsert_creative_daily_from_df")
    def test_upload_creatives_report_accepts_missing_day_column_with_filename_date(
        self, mock_upsert: MagicMock, mock_existing: MagicMock, mock_recompute: MagicMock
    ) -> None:
        """
        일부 리포트는 일별 컬럼이 없을 수 있다.
        이 경우 파일명에서 날짜를 추출해 전체 행에 적용하여 업로드되어야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "광고 캠페인,광고 그룹,소재,평균노출순위",
                "CAMP1,GRP1,nad-a001-01-1,1.2",
            ]
        )

        mock_existing.return_value = set()
        mock_upsert.side_effect = [1]
        mock_recompute.return_value = {"2026-01-22": 10}

        res = client.post(
            "/ads/creatives/upload",
            files={"file": ("일소재별평균노출순위_김명수(2026.01.22.~2026.01.22.),loa1991:naver.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)


if __name__ == "__main__":
    unittest.main()

