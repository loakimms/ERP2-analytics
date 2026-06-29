import os
import sys
import unittest

import pandas as pd


sys.path.insert(0, os.path.dirname(__file__))


class AdsConversionCutoverTest(unittest.TestCase):
    def test_searchword_normalize_before_cutover_maps_single_conversion_to_purchase_only(self) -> None:
        from main import _normalize_ui_searchword_csv_to_df

        df = pd.DataFrame(
            [
                {
                    "캠페인": "C1",
                    "광고그룹": "G1",
                    "검색어": "헤나염색",
                    "키워드": "헤나염색약",
                    "노출수": "1000",
                    "클릭수": "50",
                    "총비용(VAT포함,원)": "12,345",
                    "전환수": "3",
                    "전환매출액(원)": "55,000",
                    "광고수익률(%)": "445.5",
                }
            ]
        )

        out = _normalize_ui_searchword_csv_to_df(df, date_ymd="2026-03-08")
        self.assertFalse(out.empty)
        row = out.iloc[0]
        self.assertEqual(int(row["전환수"]), 0)
        self.assertEqual(int(row["전환매출액(원)"]), 0)
        self.assertEqual(int(row["구매전환수"]), 3)
        self.assertEqual(int(row["구매전환매출액(원)"]), 55000)
        self.assertAlmostEqual(float(row["ROAS(%)"]), 0.0, places=2)
        self.assertAlmostEqual(float(row["구매전환수익율(%)"]), 445.52, places=1)

    def test_searchword_normalize_after_cutover_keeps_total_and_purchase_separate(self) -> None:
        from main import _normalize_ui_searchword_csv_to_df

        df = pd.DataFrame(
            [
                {
                    "캠페인": "C1",
                    "광고그룹": "G1",
                    "검색어": "헤나염색",
                    "키워드": "헤나염색약",
                    "노출수": "1000",
                    "클릭수": "50",
                    "총비용(VAT포함,원)": "12,345",
                    "총전환수": "8",
                    "구매전환수": "3",
                    "총전환매출액(원)": "99,000",
                    "구매전환매출액(원)": "55,000",
                    "광고수익률(%)": "801.9",
                }
            ]
        )

        out = _normalize_ui_searchword_csv_to_df(df, date_ymd="2026-03-09")
        self.assertFalse(out.empty)
        row = out.iloc[0]
        self.assertEqual(int(row["전환수"]), 8)
        self.assertEqual(int(row["구매전환수"]), 3)
        self.assertEqual(int(row["전환매출액(원)"]), 99000)
        self.assertEqual(int(row["구매전환매출액(원)"]), 55000)
        self.assertAlmostEqual(float(row["ROAS(%)"]), 801.94, places=1)
        self.assertAlmostEqual(float(row["구매전환수익율(%)"]), 445.52, places=1)

    def test_creatives_normalize_after_cutover_accepts_new_total_and_purchase_headers(self) -> None:
        from main import _normalize_creatives_upload_df

        df = pd.DataFrame(
            [
                {
                    "캠페인": "C1",
                    "광고그룹": "G1",
                    "소재": "nad-a001-01-1",
                    "일별": "2026.03.09.",
                    "노출수": "100",
                    "클릭수": "10",
                    "총비용(VAT포함,원)": "5000",
                    "총전환수": "9",
                    "구매전환수": "4",
                    "총전환매출액(원)": "120000",
                    "구매전환매출액(원)": "70000",
                    "광고수익률(%)": "2400",
                }
            ]
        )

        out, errs = _normalize_creatives_upload_df(df)
        self.assertEqual(errs, [])
        self.assertFalse(out.empty)
        row = out.iloc[0]
        self.assertEqual(int(row["전환수"]), 9)
        self.assertEqual(int(row["구매전환수"]), 4)
        self.assertEqual(int(row["전환매출액(원)"]), 120000)
        self.assertEqual(int(row["구매전환매출액(원)"]), 70000)
        self.assertAlmostEqual(float(row["ROAS(%)"]), 2400.0, places=2)


if __name__ == "__main__":
    unittest.main()
