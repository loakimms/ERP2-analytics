import unittest
from unittest.mock import MagicMock, patch


class PurchaseKeywordsUploadApiTest(unittest.TestCase):
    @patch("main.replace_purchase_keyword_daily_from_df")
    def test_upload_purchase_keywords_csv_splits_by_date(self, mock_replace: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "일자,상품카테고리(대),상품카테고리(중),상품카테고리(소),상품카테고리(세),상품명,상품ID,채널그룹,채널명,키워드,결제수,결제금액",
                "2026-01-20,화장품/미용,헤어스타일링,염색약,-,수자타 헤나 염색약,4743750201,쇼핑,네이버가격비교-통합검색,헤나염색약,1,51200",
                "2026-01-20,화장품/미용,헤어케어,트리트먼트/헤어팩,-,수자타 헤나 헤어팩,12874366496,검색광고,네이버 사이트검색광고,천연헤나염색,2,28000",
                "2026-01-21,화장품/미용,헤어케어,페이스오일,-,수자타 호호바오일,5787615984,쇼핑,네이버가격비교-통합검색,수자타헤나,3,21992",
            ]
        )

        mock_replace.side_effect = [2, 1]

        res = client.post(
            "/purchase/keywords/upload",
            files={"file": ("purchase.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("dates"), ["2026-01-20", "2026-01-21"])
        self.assertEqual(j.get("processed_dates"), ["2026-01-20", "2026-01-21"])
        self.assertEqual(j.get("inserted_by_date"), {"2026-01-20": 2, "2026-01-21": 1})

        self.assertEqual(mock_replace.call_count, 2)
        args0, kwargs0 = mock_replace.call_args_list[0]
        args1, kwargs1 = mock_replace.call_args_list[1]
        self.assertEqual(args0[1], "2026-01-20")
        self.assertEqual(args1[1], "2026-01-21")
        self.assertEqual(kwargs0.get("source"), "purchase_upload")
        self.assertEqual(kwargs1.get("source"), "purchase_upload")

        # 날짜별로 잘 분리되어 전달되는지(행 수) 확인
        df0 = args0[0]
        df1 = args1[0]
        self.assertEqual(len(df0.index), 2)
        self.assertEqual(len(df1.index), 1)
        self.assertIn("상품ID", df0.columns)
        self.assertIn("키워드", df0.columns)
        self.assertIn("결제금액", df0.columns)

    @patch("main.replace_purchase_keyword_daily_from_df")
    def test_upload_purchase_keywords_csv_skips_title_row(self, mock_replace: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "\"스마트스토어 구매 키워드 리포트(2026.01.21),example\"",
                "상품명,상품ID,채널그룹,채널명,키워드,결제수,결제금액",
                "수자타 헤나 염색약,4743750201,쇼핑,네이버가격비교-통합검색,헤나염색약,1,51200",
            ]
        )

        mock_replace.return_value = 1
        res = client.post(
            "/purchase/keywords/upload?target_date=2026-01-21",
            files={"file": ("purchase.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("dates"), ["2026-01-21"])
        self.assertEqual(mock_replace.call_count, 1)

    @patch("main.replace_purchase_keyword_daily_from_df")
    def test_upload_purchase_keywords_infers_date_from_filename_when_no_date_column(self, mock_replace: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "상품명,상품ID,채널그룹,채널명,키워드,결제수(과거 14일간 기여도추정),결제금액(과거 14일간 기여도추정)",
                "수자타 헤나 염색약,4743750201,쇼핑,네이버가격비교-통합검색,헤나염색약,1,51200",
            ]
        )

        mock_replace.return_value = 1
        res = client.post(
            "/purchase/keywords/upload",
            files={"file": ("smartstore_purchase_keywords_20260121.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("dates"), ["2026-01-21"])

    @patch("main.replace_purchase_keyword_daily_from_df")
    def test_upload_purchase_keywords_requires_date_when_no_date_column(self, mock_replace: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "\n".join(
            [
                "상품명,상품ID,채널그룹,채널명,키워드,결제수,결제금액",
                "수자타 헤나 염색약,4743750201,쇼핑,네이버가격비교-통합검색,헤나염색약,1,51200",
            ]
        )

        # target_date 미지정이면 400
        res0 = client.post(
            "/purchase/keywords/upload",
            files={"file": ("purchase.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res0.status_code, 400, msg=res0.text)

        # target_date 지정 시 성공
        mock_replace.return_value = 1
        res1 = client.post(
            "/purchase/keywords/upload?target_date=2026-01-22",
            files={"file": ("purchase.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res1.status_code, 200, msg=res1.text)
        j = res1.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("dates"), ["2026-01-22"])
        self.assertEqual(j.get("processed_dates"), ["2026-01-22"])
        self.assertEqual(j.get("inserted_total"), 1)

    @patch("main.replace_purchase_keyword_daily_from_df")
    def test_upload_purchase_keywords_accepts_empty_smartstore_report(self, mock_replace: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        csv_text = "상품카테고리(대),상품카테고리(중),상품카테고리(소),상품카테고리(세),상품명,상품ID,채널그룹,채널명,키워드,결제수(과거 14일간 기여도추정),결제금액(과거 14일간 기여도추정)\n"

        mock_replace.return_value = 0
        res = client.post(
            "/purchase/keywords/upload?target_date=2026-06-01&source=smartstore_cdp",
            files={"file": ("상품_검색채널_2026-06-01_2026-06-01.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertTrue(j.get("no_data_report"))
        self.assertEqual(j.get("dates"), ["2026-06-01"])
        self.assertEqual(j.get("processed_dates"), ["2026-06-01"])
        self.assertEqual(j.get("inserted_total"), 0)
        self.assertEqual(mock_replace.call_count, 1)


if __name__ == "__main__":
    unittest.main()

