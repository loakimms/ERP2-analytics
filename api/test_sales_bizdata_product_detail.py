import unittest
from datetime import date
from unittest.mock import patch

import main
from db import SessionLocal, init_db, NaverCommerceProductSalesDaily


class SalesBizdataProductDetailTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        with SessionLocal() as s:
            s.query(NaverCommerceProductSalesDaily).delete(synchronize_session=False)
            s.commit()

    def test_sales_sync_bizdata_product_detail_writes_daily(self) -> None:
        d = date(2026, 3, 8)

        fake_resp = {
            "data": [
                {
                    "productId": "111",
                    "productName": "A",
                    "numPurchases": 3,
                    "payAmount": 17000,
                    "productQuantity": 4,
                },
                {
                    "productId": "222",
                    "productName": "B",
                    "numPurchases": 1,
                    "payAmount": 12000,
                    "productQuantity": 3,
                },
            ]
        }

        def fake_get_json_with_params(*, path: str, access_token: str, params: dict, timeout_sec: float = 12.0):  # noqa: ARG001
            # _bizdata_fetch는 다양한 date param 후보로 여러 번 호출할 수 있다.
            if "/sales/product/detail" in path:
                return 200, fake_resp, None
            return 404, None, "not_found"

        with patch.object(main, "_naver_commerce_get_access_token_cached", return_value="tok"):
            with patch.object(main, "_naver_commerce_get_json_with_params", side_effect=fake_get_json_with_params):
                with SessionLocal() as s:
                    r = main.sales_sync_bizdata_product_detail(
                        main.SalesBizdataSyncRequest(date_from=d, date_to=d, channel_no=500122550, sort="payAmount"),
                        db=s,  # type: ignore[arg-type]
                    )

        self.assertTrue(bool(r.get("ok")))
        self.assertEqual(r.get("processed_dates"), [d.isoformat()])
        self.assertEqual(r.get("source"), "bizdata_product_detail")

        with SessionLocal() as s:
            rows = (
                s.query(NaverCommerceProductSalesDaily)
                .filter(
                    NaverCommerceProductSalesDaily.date == d,
                    NaverCommerceProductSalesDaily.source == "bizdata_product_detail",
                )
                .all()
            )

        by_pid = {int(x.product_id): x for x in rows}
        self.assertEqual(set(by_pid.keys()), {111, 222})
        self.assertEqual(int(by_pid[111].order_count), 3)
        self.assertEqual(int(by_pid[111].quantity), 4)
        self.assertAlmostEqual(float(by_pid[111].amount), 17000.0, places=6)


if __name__ == "__main__":
    unittest.main()

