import unittest


class PurchaseKeywordsStoreDecimalTest(unittest.TestCase):
    def test_replace_purchase_keyword_daily_stores_decimal_payments(self) -> None:
        """
        구매키워드 '기여도추정' 결제수/금액은 소수일 수 있어,
        저장 단계에서 int()로 잘리면 합계가 깨진다.

        - replace_purchase_keyword_daily_from_df가 소수 payments/amount를 그대로 적재하는지 확인한다.
        """
        import pandas as pd

        from db import SessionLocal, NaverSmartstorePurchaseKeywordDaily, replace_purchase_keyword_daily_from_df

        df = pd.DataFrame(
            [
                {
                    "상품ID": "5897739461",
                    "키워드": "천연염색약",
                    "채널그룹": "검색광고",
                    "채널명": "네이버 쇼핑검색광고",
                    "결제수": 1.51465,
                    "결제금액": 90879.0,
                },
                {
                    "상품ID": "4743750201",
                    "키워드": "헤나",
                    "채널그룹": "검색광고",
                    "채널명": "네이버 사이트검색광고",
                    "결제수": 1.0,
                    "결제금액": 70000.0,
                },
            ]
        )

        n = replace_purchase_keyword_daily_from_df(df, "2026-01-30", source="purchase_upload")
        self.assertEqual(n, 2)

        with SessionLocal() as s:
            rows = (
                s.query(NaverSmartstorePurchaseKeywordDaily)
                .filter(
                    NaverSmartstorePurchaseKeywordDaily.date == "2026-01-30",
                    NaverSmartstorePurchaseKeywordDaily.source == "purchase_upload",
                )
                .all()
            )
            self.assertEqual(len(rows), 2)
            pay_sum = float(sum(float(r.payments or 0) for r in rows))
            amt_sum = float(sum(float(r.amount or 0) for r in rows))

        self.assertAlmostEqual(pay_sum, 2.51465, places=6)
        self.assertAlmostEqual(amt_sum, 160879.0, places=6)


if __name__ == "__main__":
    unittest.main()

