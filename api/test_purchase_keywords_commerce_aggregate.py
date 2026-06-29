import unittest
from datetime import date

import pandas as pd

import main
from db import SessionLocal, NaverSmartstorePurchaseKeywordDaily, upsert_naver_commerce_product_order_raw


class PurchaseKeywordsCommerceAggregateTest(unittest.TestCase):
    def test_aggregate_from_raw_writes_fact_rows_with_commerce_source(self) -> None:
        d = date(2026, 3, 8)

        upsert_naver_commerce_product_order_raw(
            [
                {
                    "product_order_id": "PO-10",
                    "payment_date": d,
                    "order_date": d,
                    "product_id": 111,
                    "product_name": "A",
                    "quantity": 2,
                    "amount_paid": 10000.0,
                    "inflow_path": "SEARCH",
                    "inflow_path_add": "헤나",
                    "raw_json": "{}",
                },
                {
                    "product_order_id": "PO-11",
                    "payment_date": d,
                    "order_date": d,
                    "product_id": 111,
                    "product_name": "A",
                    "quantity": 1,
                    "amount_paid": 5000.0,
                    "inflow_path": "SEARCH",
                    "inflow_path_add": "",
                    "raw_json": "{}",
                },
            ]
        )

        n = main._aggregate_purchase_keywords_from_commerce_raw(target_date=d)  # type: ignore[attr-defined]
        self.assertGreaterEqual(int(n), 1)

        with SessionLocal() as s:
            rows = (
                s.query(NaverSmartstorePurchaseKeywordDaily)
                .filter(NaverSmartstorePurchaseKeywordDaily.date == d, NaverSmartstorePurchaseKeywordDaily.source == "purchase_commerce_api")
                .all()
            )
            self.assertTrue(rows)
            # 키워드(유입상세) placeholder가 들어간 행이 있어야 함
            kws = sorted({str(getattr(r, "keyword", "") or "") for r in rows})
            self.assertIn("(유입상세없음)", kws)

    def test_source_auto_prefers_commerce_when_exists(self) -> None:
        d = date(2026, 3, 7)

        # 업로드(source=purchase_upload) 데이터 1건
        df_up = pd.DataFrame.from_records(
            [
                {
                    "상품ID": 1,
                    "상품명": "U",
                    "채널그룹": "UPLOAD",
                    "채널명": "",
                    "키워드": "K",
                    "결제수": 1,
                    "결제금액": 100,
                }
            ]
        )
        from db import replace_purchase_keyword_daily_from_df

        replace_purchase_keyword_daily_from_df(df_up, d.isoformat(), source="purchase_upload")

        # 커머스(source=purchase_commerce_api) 데이터 1건
        df_c = pd.DataFrame.from_records(
            [
                {
                    "상품ID": 2,
                    "상품명": "C",
                    "채널그룹": "SEARCH",
                    "채널명": "X",
                    "키워드": "X",
                    "결제수": 1,
                    "결제금액": 200,
                }
            ]
        )
        replace_purchase_keyword_daily_from_df(df_c, d.isoformat(), source="purchase_commerce_api")

        with SessionLocal() as s:
            out = main.list_purchase_keywords_daily(date_from=d, date_to=d, source="auto", limit=50, offset=0, db=s)  # type: ignore[arg-type]
            self.assertTrue(out)
            # auto는 commerce를 우선 사용하므로 product_id=2가 나와야 한다.
            self.assertEqual(int(out[0]["product_id"]), 2)


if __name__ == "__main__":
    unittest.main()

