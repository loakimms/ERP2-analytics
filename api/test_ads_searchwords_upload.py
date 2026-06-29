import unittest
import os
import sys
import io
from unittest.mock import MagicMock, patch

# 다른 테스트들과 동일하게 `import main`(= api/main.py) 패턴을 유지하되,
# 실행 위치(cwd)에 따라 모듈 탐색이 실패하지 않도록 api 디렉토리를 PYTHONPATH에 추가한다.
sys.path.insert(0, os.path.dirname(__file__))


class AdsSearchwordsUploadTest(unittest.TestCase):
    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_csv_maps_total_conversion_headers(self, mock_upsert: MagicMock) -> None:
        """
        광고센터 UI에서 내려받은 '검색어 보고서'는 컬럼명이 변형될 수 있다.
        특히 전환 지표가 '총 전환수/총 전환매출액(원)' 형태로 내려오는 경우에도
        표준 컬럼('전환수', '전환매출액(원)')으로 정규화되어 upsert로 전달되어야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                '"검색어 보고서(2026.03.08.),example:naver"',
                "캠페인,광고그룹,검색어,노출수,클릭수,총비용(VAT포함원),총 전환수,총 전환매출액(원)",
                "CAMP1,GRP1,헤나염색약,100,10,2000,2,60000",
            ]
        )

        mock_upsert.return_value = 1

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-08",
            files={"file": ("searchwords.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("date"), "2026-03-08")
        self.assertEqual(j.get("insertedSearchword"), 1)

        self.assertEqual(mock_upsert.call_count, 1)
        args0, kwargs0 = mock_upsert.call_args_list[0]
        df0 = args0[0]
        self.assertEqual(args0[1], "2026-03-08")
        self.assertEqual(kwargs0.get("source"), "ui_csv_upload")

        # 2026-03-08은 컷오버 이전이므로, 단일 전환 값은 구매전환으로 해석되어야 한다.
        self.assertIn("전환수", df0.columns)
        self.assertIn("전환매출액(원)", df0.columns)
        self.assertIn("구매전환수", df0.columns)
        self.assertIn("구매전환매출액(원)", df0.columns)
        self.assertIn("총비용(원)", df0.columns)
        self.assertIn("ROAS(%)", df0.columns)
        self.assertIn("구매전환수익율(%)", df0.columns)

        self.assertEqual(int(df0["전환수"].iloc[0]), 0)
        self.assertEqual(int(df0["전환매출액(원)"].iloc[0]), 0)
        self.assertEqual(int(df0["구매전환수"].iloc[0]), 2)
        self.assertEqual(int(df0["구매전환매출액(원)"].iloc[0]), 60000)
        self.assertEqual(int(df0["총비용(원)"].iloc[0]), 2000)
        self.assertAlmostEqual(float(df0["ROAS(%)"].iloc[0]), 0.0, places=2)
        self.assertAlmostEqual(float(df0["구매전환수익율(%)"].iloc[0]), 3000.0, places=2)

    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_csv_rejects_post_cutover_file_without_purchase_headers(self, mock_upsert: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                '"검색어 보고서(2026.03.09.),example:naver"',
                "캠페인,광고그룹,검색어,노출수,클릭수,총비용(VAT포함원),총전환수,총전환매출액(원)",
                "CAMP1,GRP1,헤나염색약,100,10,2000,2,60000",
            ]
        )

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-09",
            files={"file": ("searchwords.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 400, msg=res.text)
        self.assertIn("구매전환수", res.text)
        self.assertIn("구매전환매출액(원)", res.text)
        self.assertEqual(mock_upsert.call_count, 0)

    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_csv_accepts_post_cutover_excel_header_variants_without_won_suffix(
        self, mock_upsert: MagicMock
    ) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                '"검색어 보고서(2026.03.09.),example:naver"',
                "캠페인,광고그룹,검색어,노출수,클릭수,총비용(VAT포함원),총 전환수,구매전환 전환수,총 전환매출액(원),구매전환 전환매출액(원),총 광고수익률(%)",
                "CAMP1,GRP1,헤나염색약,100,10,2000,7,2,140000,50000,7000",
            ]
        )

        mock_upsert.return_value = 1

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-09",
            files={"file": ("searchwords.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        args0, kwargs0 = mock_upsert.call_args_list[0]
        df0 = args0[0]
        self.assertEqual(kwargs0.get("source"), "ui_csv_upload")
        self.assertEqual(int(df0["전환수"].iloc[0]), 7)
        self.assertEqual(int(df0["구매전환수"].iloc[0]), 2)
        self.assertEqual(int(df0["전환매출액(원)"].iloc[0]), 140000)
        self.assertEqual(int(df0["구매전환매출액(원)"].iloc[0]), 50000)

    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_csv_accepts_post_cutover_headers_with_hidden_spaces(self, mock_upsert: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                '"검색어 보고서(2026.03.09.),example:naver"',
                "캠페인,광고그룹,검색어,노출수,클릭수,총비용(VAT포함원),총 전환수,구매전환\u00a0 전환수,총 전환매출액(원),구매전환  전환매출액(원),총 광고수익률(%)",
                "CAMP1,GRP1,헤나염색약,100,10,2000,7,2,140000,50000,7000",
            ]
        )

        mock_upsert.return_value = 1

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-09",
            files={"file": ("searchwords.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_csv_detects_tab_separated_header_after_title_line(self, mock_upsert: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                '"검색어 보고서(2026.03.09.~2026.03.09.),gold1004"',
                "\t".join(
                    [
                        "캠페인",
                        "광고그룹",
                        "검색어",
                        "검색어 구분",
                        "일별",
                        "노출수",
                        "클릭수",
                        "클릭률(%)",
                        "평균 CPC",
                        "총비용",
                        "총 전환수",
                        "총 전환율(%)",
                        "총 전환매출액(원)",
                        "총 광고수익률(%)",
                        "구매전환 전환수",
                        "구매전환 전환매출액(원)",
                    ]
                ),
                "\t".join(
                    [
                        "#SS01",
                        "광고그룹1",
                        "테스트검색어",
                        "일치",
                        "2026.03.09.",
                        "82",
                        "29",
                        "35.37",
                        "59000",
                        "13882",
                        "11",
                        "37.93",
                        "509000",
                        "0",
                        "8",
                        "509000",
                    ]
                ),
            ]
        )

        mock_upsert.return_value = 1

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-09",
            files={"file": ("searchwords.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_xlsx_detects_header_row_after_title_line(self, mock_upsert: MagicMock) -> None:
        from fastapi.testclient import TestClient
        from openpyxl import Workbook
        import main

        client = TestClient(main.app)

        title_row = ["검색어 보고서(2026.03.09.~2026.03.09.),gold1004"]
        header_row = [
            "캠페인",
            "광고그룹",
            "검색어",
            "검색어 구분",
            "일별",
            "노출수",
            "클릭수",
            "클릭률(%)",
            "평균 CPC",
            "총비용",
            "총 전환수",
            "총 전환율(%)",
            "총 전환매출액(원)",
            "총 광고수익률(%)",
            "구매전환 전환수",
            "구매전환 전환매출액(원)",
        ]
        data_row = [
            "#SS01",
            "광고그룹1",
            "테스트검색어",
            "일치",
            "2026.03.09.",
            82,
            29,
            35.37,
            59000,
            13882,
            11,
            37.93,
            509000,
            0,
            8,
            509000,
        ]

        wb = Workbook()
        ws = wb.active
        ws.append(title_row + [""] * (len(header_row) - 1))
        ws.append(header_row)
        ws.append(data_row)
        bio = io.BytesIO()
        wb.save(bio)
        xlsx_bytes = bio.getvalue()

        mock_upsert.return_value = 1

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-09",
            files={"file": ("searchwords.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_accepts_purchase_complete_headers(self, mock_upsert: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                '"검색어 보고서(2026.03.09.),gold1004"',
                "캠페인,광고그룹,검색어,일별,노출수,클릭수,총비용,총 전환수,총 전환매출액(원),총 광고수익률(%),구매완료 전환수,구매완료 전환매출액(원)",
                "#SS01,광고그룹1,테스트검색어,2026.03.09.,82,29,13882,11,509000,0,8,509000",
            ]
        )

        mock_upsert.return_value = 1

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-09",
            files={"file": ("searchwords.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)

        args0, kwargs0 = mock_upsert.call_args_list[0]
        df0 = args0[0]
        self.assertEqual(kwargs0.get("source"), "ui_csv_upload")
        self.assertEqual(int(df0["구매전환수"].iloc[0]), 8)
        self.assertEqual(int(df0["구매전환매출액(원)"].iloc[0]), 509000)

    @patch("main.upsert_searchword_daily_from_df")
    def test_upload_searchwords_uses_file_day_instead_of_requested_screen_day(self, mock_upsert: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                '"검색어 보고서(2026.03.10.),gold1004"',
                "캠페인,광고그룹,검색어,일별,노출수,클릭수,총비용,총 전환수,총 전환매출액(원),총 광고수익률(%),구매완료 전환수,구매완료 전환매출액(원)",
                "#SS01,광고그룹1,테스트검색어,2026.03.10.,82,29,13882,11,509000,0,8,509000",
            ]
        )

        mock_upsert.return_value = 1

        res = client.post(
            "/ads/searchwords/upload?date=2026-03-09",
            files={"file": ("searchwords.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertEqual(j.get("requested_date"), "2026-03-09")
        self.assertEqual(j.get("processed_dates"), ["2026-03-10"])
        self.assertEqual(j.get("inserted_by_date"), {"2026-03-10": 1})

        self.assertEqual(mock_upsert.call_count, 1)
        args0, kwargs0 = mock_upsert.call_args_list[0]
        self.assertEqual(args0[1], "2026-03-10")
        self.assertEqual(kwargs0.get("source"), "ui_csv_upload")

    def test_upsert_searchword_daily_reads_purchase_columns(self) -> None:
        import db as dbmod

        captured: dict[str, object] = {}

        class FakeQuery:
            def filter(self, *_args, **_kwargs):
                return self

            def delete(self, synchronize_session=False):
                captured["deleted"] = bool(synchronize_session is False)
                return 0

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def query(self, _model):
                return FakeQuery()

            def execute(self, stmt):
                captured["stmt"] = stmt
                return MagicMock(rowcount=1)

            def commit(self):
                return None

        df = __import__("pandas").DataFrame(
            [
                {
                    "캠페인": "C1",
                    "광고 그룹": "G1",
                    "검색어": "헤나염색",
                    "총비용(원)": 1000,
                    "전환수": 9,
                    "구매전환수": 4,
                    "전환매출액(원)": 50000,
                    "구매전환매출액(원)": 30000,
                    "ROAS(%)": 5000.0,
                    "구매전환수익율(%)": 3000.0,
                }
            ]
        )

        original_session_local = dbmod.SessionLocal
        try:
            dbmod.SessionLocal = lambda: FakeSession()
            inserted = dbmod.upsert_searchword_daily_from_df(df, "2026-03-09", source="ui_csv_upload")
        finally:
            dbmod.SessionLocal = original_session_local

        self.assertEqual(inserted, 1)
        stmt = captured.get("stmt")
        self.assertIsNotNone(stmt)
        params = stmt.compile().params
        self.assertEqual(int(params.get("conversions_m0") or 0), 9)
        self.assertEqual(int(params.get("purchase_conversions_m0") or 0), 4)
        self.assertEqual(int(params.get("revenue_m0") or 0), 50000)
        self.assertEqual(int(params.get("purchase_revenue_m0") or 0), 30000)

    def test_upsert_searchword_daily_aggregates_duplicate_unique_keys_before_insert(self) -> None:
        import db as dbmod

        captured: dict[str, object] = {}

        class FakeQuery:
            def filter(self, *_args, **_kwargs):
                return self

            def delete(self, synchronize_session=False):
                captured["deleted"] = bool(synchronize_session is False)
                return 0

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def query(self, _model):
                return FakeQuery()

            def execute(self, stmt):
                captured["stmt"] = stmt
                return MagicMock(rowcount=1)

            def commit(self):
                return None

        df = __import__("pandas").DataFrame(
            [
                {
                    "캠페인": "C1",
                    "광고 그룹": "G1",
                    "검색어": "중복검색어",
                    "키워드": "키워드A",
                    "총비용(원)": 1000,
                    "노출수": 100,
                    "클릭수": 10,
                    "전환수": 2,
                    "구매전환수": 1,
                    "전환매출액(원)": 30000,
                    "구매전환매출액(원)": 20000,
                },
                {
                    "캠페인": "C1",
                    "광고 그룹": "G1",
                    "검색어": "중복검색어",
                    "키워드": "키워드B",
                    "총비용(원)": 500,
                    "노출수": 50,
                    "클릭수": 5,
                    "전환수": 1,
                    "구매전환수": 1,
                    "전환매출액(원)": 10000,
                    "구매전환매출액(원)": 5000,
                },
            ]
        )

        original_session_local = dbmod.SessionLocal
        try:
            dbmod.SessionLocal = lambda: FakeSession()
            inserted = dbmod.upsert_searchword_daily_from_df(df, "2026-04-01", source="ui_csv_upload")
        finally:
            dbmod.SessionLocal = original_session_local

        self.assertEqual(inserted, 1)
        stmt = captured.get("stmt")
        self.assertIsNotNone(stmt)
        params = stmt.compile().params
        self.assertEqual(int(params.get("impressions_m0") or 0), 150)
        self.assertEqual(int(params.get("clicks_m0") or 0), 15)
        self.assertEqual(int(params.get("cost_m0") or 0), 1500)
        self.assertEqual(int(params.get("conversions_m0") or 0), 3)
        self.assertEqual(int(params.get("purchase_conversions_m0") or 0), 2)
        self.assertEqual(int(params.get("revenue_m0") or 0), 40000)
        self.assertEqual(int(params.get("purchase_revenue_m0") or 0), 25000)
        self.assertEqual(params.get("matched_keyword_m0"), None)


if __name__ == "__main__":
    unittest.main()

