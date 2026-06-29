import unittest
from datetime import datetime
from typing import Any
from unittest.mock import patch

import main


class PurchaseKeywordsCommerceMappingTest(unittest.TestCase):
    def _row(self, item: dict[str, Any]) -> dict[str, Any]:
        return main._commerce_purchase_row_from_changed_item(item)  # type: ignore[attr-defined]

    def test_mapping_supports_nested_order_and_productOrder_shape(self) -> None:
        item = {
            "order": {
                "orderId": "O-1",
                "orderDate": "2026-03-08T01:02:03+09:00",
                "paymentDate": "2026-03-08T10:11:12+09:00",
            },
            "productOrder": {
                "productOrderId": "PO-1",
                "productId": 123456789,
                "productName": "테스트상품",
                "quantity": 2,
                "totalPaymentAmount": 10000,
                "inflowPath": "SEARCH",
                "inflowPathAdd": "헤나",
            },
            "lastChangedDate": "2026-03-08T11:22:33+09:00",
        }

        row = self._row(item)
        self.assertEqual(row["product_order_id"], "PO-1")
        self.assertEqual(int(row["product_id"]), 123456789)
        self.assertEqual(row["product_name"], "테스트상품")
        self.assertEqual(int(row["quantity"]), 2)
        self.assertEqual(float(row["amount_paid"]), 10000.0)
        self.assertEqual(row["inflow_path"], "SEARCH")
        self.assertEqual(row["inflow_path_add"], "헤나")
        # 결제일 우선
        self.assertEqual(str(row["payment_date"]), "2026-03-08")
        self.assertEqual(str(row["order_date"]), "2026-03-08")

    def test_mapping_supports_flat_product_order_shape(self) -> None:
        item = {
            "productOrderId": "PO-2",
            "productId": "987654321",
            "productName": "상품2",
            "quantity": "1",
            "totalPaymentAmount": "9,900",
            "inflowPath": "SHOPPING",
            "inflowPathAdd": "",
            "paymentDate": "2026-03-07T00:00:01+09:00",
        }
        row = self._row(item)
        self.assertEqual(row["product_order_id"], "PO-2")
        self.assertEqual(int(row["product_id"]), 987654321)
        self.assertEqual(row["product_name"], "상품2")
        self.assertEqual(int(row["quantity"]), 1)
        self.assertEqual(float(row["amount_paid"]), 9900.0)
        self.assertEqual(row["inflow_path"], "SHOPPING")
        self.assertEqual(row["inflow_path_add"], "")
        self.assertEqual(str(row["payment_date"]), "2026-03-07")

    def test_mapping_falls_back_to_order_date_when_payment_date_missing(self) -> None:
        item = {
            "order": {"orderDate": "2026-03-06T01:02:03+09:00"},
            "productOrder": {"productOrderId": "PO-3", "productId": 1, "productName": "X", "quantity": 1, "totalPaymentAmount": 1},
        }
        row = self._row(item)
        self.assertEqual(str(row["payment_date"]), "2026-03-06")
        self.assertEqual(str(row["order_date"]), "2026-03-06")

    def test_mapping_strips_pii_from_raw_snapshot(self) -> None:
        item = {
            "order": {
                "orderId": "O-PII",
                "ordererName": "홍길동",
                "shippingAddress": {"address": "서울 어딘가"},
                "paymentDate": "2026-03-08T00:00:00+09:00",
            },
            "productOrder": {
                "productOrderId": "PO-PII",
                "productId": 9,
                "productName": "P",
                "quantity": 1,
                "totalPaymentAmount": 100,
                "inflowPath": "SEARCH",
                "inflowPathAdd": "키워드",
            },
        }
        row = self._row(item)
        raw = str(row.get("raw_json") or "")
        self.assertNotIn("ordererName", raw)
        self.assertNotIn("shippingAddress", raw)


if __name__ == "__main__":
    unittest.main()

