import unittest
from datetime import date, timedelta
from unittest.mock import patch

import main
from db import (
    AnalyticsJobRun,
    AppSetting,
    SessionLocal,
    init_db,
    NaverCommerceProductOrderRaw,
    NaverCommerceProductSalesDaily,
)


class SalesAnalysisDailyTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        with SessionLocal() as s:
            # in-memory sqlite(StaticPool)는 프로세스 내에서 데이터가 누적될 수 있어,
            # 본 테스트가 다루는 테이블만 최소 범위로 정리한다.
            s.query(AnalyticsJobRun).delete(synchronize_session=False)
            s.query(AppSetting).delete(synchronize_session=False)
            s.query(NaverCommerceProductSalesDaily).delete(synchronize_session=False)
            s.query(NaverCommerceProductOrderRaw).delete(synchronize_session=False)
            s.commit()

    def test_aggregate_product_sales_daily_from_raw_is_idempotent(self) -> None:
        d = date(2026, 3, 8)
        with SessionLocal() as s:
            s.add_all(
                [
                    NaverCommerceProductOrderRaw(
                        product_order_id="PO1",
                        payment_date=d,
                        order_date=d,
                        product_id=111,
                        product_name="상품A",
                        quantity=2,
                        amount_paid=10000,
                    ),
                    NaverCommerceProductOrderRaw(
                        product_order_id="PO2",
                        payment_date=d,
                        order_date=d,
                        product_id=111,
                        product_name="",
                        quantity=1,
                        amount_paid=5000,
                    ),
                    NaverCommerceProductOrderRaw(
                        product_order_id="PO3",
                        payment_date=d,
                        order_date=d,
                        product_id=222,
                        product_name="상품B",
                        quantity=3,
                        amount_paid=12000,
                    ),
                ]
            )
            s.commit()

        n1 = main._aggregate_product_sales_daily_from_commerce_raw(target_date=d, source="commerce_orders")
        n2 = main._aggregate_product_sales_daily_from_commerce_raw(target_date=d, source="commerce_orders")
        self.assertEqual(int(n1 or 0), 2)
        self.assertEqual(int(n2 or 0), 2)

        with SessionLocal() as s:
            rows = (
                s.query(NaverCommerceProductSalesDaily)
                .filter(NaverCommerceProductSalesDaily.date == d, NaverCommerceProductSalesDaily.source == "commerce_orders")
                .all()
            )

        by_pid = {int(r.product_id): r for r in rows}
        self.assertEqual(set(by_pid.keys()), {111, 222})
        r111 = by_pid[111]
        self.assertEqual(str(r111.product_name), "상품A")  # 비어있지 않은 값 우선
        self.assertEqual(int(r111.order_count), 2)
        self.assertEqual(int(r111.quantity), 3)
        self.assertAlmostEqual(float(r111.amount), 15000.0, places=6)

        r222 = by_pid[222]
        self.assertEqual(int(r222.order_count), 1)
        self.assertEqual(int(r222.quantity), 3)
        self.assertAlmostEqual(float(r222.amount), 12000.0, places=6)

    def test_sales_sync_writes_raw_and_daily(self) -> None:
        d = date(2026, 3, 8)

        fake_changed_items = [
            {
                "order": {"orderId": "O1", "paymentDate": "2026-03-08T10:00:00+09:00", "orderDate": "2026-03-08T09:50:00+09:00"},
                "productOrder": {
                    "productOrderId": "PO10",
                    "productId": 999,
                    "productName": "테스트상품",
                    "quantity": 2,
                    "totalPaymentAmount": 21000,
                    "inflowPath": "검색",
                    "inflowPathAdd": "통합검색",
                },
                "lastChangedDate": "2026-03-08T10:01:00+09:00",
            }
        ]

        with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", return_value=(fake_changed_items, {"ok": True})):
            with SessionLocal() as s:
                r = main.sales_sync(main.SalesSyncRequest(date_from=d, date_to=d, lag_days=0), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        self.assertEqual(r.get("processed_dates"), [d.isoformat()])

        with SessionLocal() as s:
            raw_cnt = int(s.query(NaverCommerceProductOrderRaw).count() or 0)
            daily_cnt = int(s.query(NaverCommerceProductSalesDaily).count() or 0)
        self.assertEqual(raw_cnt, 1)
        self.assertEqual(daily_cnt, 1)

    def test_sales_sync_falls_back_to_direct_order_when_changed_order_is_empty(self) -> None:
        d = date(2026, 3, 8)
        direct_items = [
            {
                "order": {"orderId": "O-D1", "paymentDate": "2026-03-08T10:00:00+09:00", "orderDate": "2026-03-08T09:50:00+09:00"},
                "productOrder": {
                    "productOrderId": "PO-D1",
                    "productId": 777,
                    "productName": "직접조회상품",
                    "quantity": 1,
                    "totalPaymentAmount": 18000,
                },
            }
        ]

        with patch.object(main, "_today_kst", return_value=d):
            with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", return_value=([], {"ok": True, "fetched": 0})):
                with patch.object(main, "_fetch_commerce_product_orders_for_day_direct", return_value=(direct_items, {"ok": True, "supported": True, "fetched": 1})):
                    with SessionLocal() as s:
                        r = main.sales_sync(main.SalesSyncRequest(date_from=d, date_to=d, lag_days=0), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        enum0 = (r.get("enumerator_results") or {}).get(d.isoformat()) or {}
        self.assertEqual(int((((enum0.get("changed_order") or {}).get("candidate_count")) or 0)), 0)
        self.assertTrue(bool(((enum0.get("direct_order") or {}).get("checked"))))
        self.assertTrue(bool(((enum0.get("direct_order") or {}).get("supported"))))
        self.assertEqual(int((((enum0.get("direct_order") or {}).get("candidate_count")) or 0)), 1)
        self.assertEqual(int((enum0.get("deduped_candidate_count") or 0)), 1)

        with SessionLocal() as s:
            raw_cnt = int(s.query(NaverCommerceProductOrderRaw).count() or 0)
            daily_cnt = int(s.query(NaverCommerceProductSalesDaily).count() or 0)
        self.assertEqual(raw_cnt, 1)
        self.assertEqual(daily_cnt, 1)

    def test_sales_sync_checks_direct_order_for_old_missing_date_when_raw_is_missing(self) -> None:
        d = date(2026, 3, 8)
        direct_items = [
            {
                "order": {"orderId": "O-OLD-1", "paymentDate": "2026-03-08T10:00:00+09:00", "orderDate": "2026-03-08T09:50:00+09:00"},
                "productOrder": {
                    "productOrderId": "PO-OLD-1",
                    "productId": 701,
                    "productName": "과거직접조회상품",
                    "quantity": 1,
                    "totalPaymentAmount": 17000,
                },
            }
        ]

        with patch.object(main, "_today_kst", return_value=date(2026, 3, 30)):
            with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", return_value=([], {"ok": True, "fetched": 0})):
                with patch.object(main, "_fetch_commerce_product_orders_for_day_direct", return_value=(direct_items, {"ok": True, "supported": True, "fetched": 1})) as direct_mock:
                    with SessionLocal() as s:
                        r = main.sales_sync(main.SalesSyncRequest(date_from=d, date_to=d, lag_days=0), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        enum0 = (r.get("enumerator_results") or {}).get(d.isoformat()) or {}
        self.assertTrue(bool(((enum0.get("direct_order") or {}).get("checked"))))
        self.assertTrue(bool(((enum0.get("direct_order") or {}).get("supported"))))
        self.assertEqual(direct_mock.call_count, 1)

    def test_sales_sync_skips_direct_order_for_old_date_when_raw_already_exists(self) -> None:
        d = date(2026, 3, 8)

        with SessionLocal() as s:
            s.add(
                NaverCommerceProductOrderRaw(
                    product_order_id="PO-RAW-EXISTS",
                    payment_date=d,
                    order_date=d,
                    product_id=888,
                    product_name="기존로우상품",
                    quantity=1,
                    amount_paid=12000,
                )
            )
            s.commit()

        with patch.object(main, "_today_kst", return_value=date(2026, 3, 30)):
            with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", return_value=([], {"ok": True, "fetched": 0})):
                with patch.object(main, "_fetch_commerce_product_orders_for_day_direct") as direct_mock:
                    with SessionLocal() as s:
                        r = main.sales_sync(main.SalesSyncRequest(date_from=d, date_to=d, lag_days=0), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        enum0 = (r.get("enumerator_results") or {}).get(d.isoformat()) or {}
        self.assertFalse(bool(((enum0.get("direct_order") or {}).get("checked"))))
        self.assertEqual(direct_mock.call_count, 0)

    def test_fetch_commerce_product_orders_for_day_direct_uses_get_from_to_millis(self) -> None:
        d = date(2026, 3, 29)
        calls: list[tuple[str, dict]] = []

        def fake_get_json_with_params(*, path, access_token, params, timeout_sec):  # type: ignore[no-untyped-def]
            calls.append((str(path), dict(params or {})))
            return 200, {
                "data": {"contents": [
                    {
                        "productOrderId": "PO-GET-1",
                        "content": {
                            "order": {
                                "orderId": "O-GET-1",
                                "paymentDate": "2026-03-29T10:00:00+09:00",
                                "orderDate": "2026-03-29T09:50:00+09:00",
                            },
                            "productOrder": {
                                "productOrderId": "PO-GET-1",
                                "productId": 700,
                                "productName": "GET조회상품",
                                "quantity": 1,
                                "totalPaymentAmount": 15000,
                            },
                        },
                    }
                ]}
            }, None

        with patch.object(main, "_naver_commerce_require_access_token", return_value="token"):
            with patch.object(main, "_naver_commerce_get_json_with_params", side_effect=fake_get_json_with_params):
                items, meta = main._fetch_commerce_product_orders_for_day_direct(d)

        self.assertEqual(len(items), 1)
        self.assertTrue(bool(meta.get("ok")))
        self.assertTrue(bool(meta.get("supported")))
        self.assertGreaterEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "/v1/pay-order/seller/product-orders")
        params0 = calls[0][1]
        self.assertEqual(int(params0.get("limitCount") or 0), 300)
        self.assertIn("from", params0)
        self.assertIn("to", params0)
        self.assertIn(".000+09:00", str(params0.get("from") or ""))
        self.assertIn(".999+09:00", str(params0.get("to") or ""))
        self.assertEqual(str(((items[0].get("content") or {}).get("productOrder") or {}).get("productOrderId") or ""), "PO-GET-1")

    def test_sales_sync_does_not_cache_direct_order_not_found_result(self) -> None:
        today = date(2026, 3, 30)
        d = today - timedelta(days=1)
        last_error = '{"code":"GW.NOT_FOUND","message":"요청하신 리소스를 찾을 수 없습니다."}'

        with patch.object(main, "_today_kst", return_value=today):
            with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", return_value=([], {"ok": True, "fetched": 0})):
                with patch.object(
                    main,
                    "_fetch_commerce_product_orders_for_day_direct",
                    return_value=([], {"ok": True, "supported": False, "fetched": 0, "last_error": last_error}),
                ):
                    with SessionLocal() as s:
                        r = main.sales_sync(main.SalesSyncRequest(date_from=d, date_to=d, lag_days=0), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        enum0 = (r.get("enumerator_results") or {}).get(d.isoformat()) or {}
        self.assertTrue(bool(((enum0.get("direct_order") or {}).get("checked"))))
        self.assertFalse(bool(((enum0.get("direct_order") or {}).get("supported"))))

        with SessionLocal() as s:
            row = s.query(AppSetting).filter(AppSetting.key == main._DIRECT_ORDER_UNSUPPORTED_UNTIL_KEY).one_or_none()
        self.assertIsNone(row)

    def test_sales_sync_dedupes_changed_and_direct_order_candidates(self) -> None:
        d = date(2026, 3, 8)
        shared_item = {
            "order": {"orderId": "O-SHARED", "paymentDate": "2026-03-08T10:00:00+09:00", "orderDate": "2026-03-08T09:50:00+09:00"},
            "productOrder": {
                "productOrderId": "PO-SHARED",
                "productId": 333,
                "productName": "중복상품",
                "quantity": 1,
                "totalPaymentAmount": 9900,
            },
        }

        with patch.object(main, "_today_kst", return_value=d):
            with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", return_value=([shared_item], {"ok": True, "fetched": 1})):
                with patch.object(main, "_fetch_commerce_product_orders_for_day_direct", return_value=([shared_item], {"ok": True, "supported": True, "fetched": 1})):
                    with SessionLocal() as s:
                        r = main.sales_sync(main.SalesSyncRequest(date_from=d, date_to=d, lag_days=0), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        enum0 = (r.get("enumerator_results") or {}).get(d.isoformat()) or {}
        self.assertEqual(int((((enum0.get("changed_order") or {}).get("candidate_count")) or 0)), 1)
        self.assertEqual(int((((enum0.get("direct_order") or {}).get("candidate_count")) or 0)), 1)
        self.assertEqual(int((enum0.get("deduped_candidate_count") or 0)), 1)

        with SessionLocal() as s:
            raw_cnt = int(s.query(NaverCommerceProductOrderRaw).count() or 0)
            daily_cnt = int(s.query(NaverCommerceProductSalesDaily).count() or 0)
        self.assertEqual(raw_cnt, 1)
        self.assertEqual(daily_cnt, 1)

    def test_sales_sync_persists_diagnostic_job_for_coverage(self) -> None:
        d = date(2026, 3, 29)
        direct_items = [
            {
                "order": {"orderId": "O-D2", "paymentDate": "2026-03-29T10:00:00+09:00", "orderDate": "2026-03-29T09:50:00+09:00"},
                "productOrder": {
                    "productOrderId": "PO-D2",
                    "productId": 778,
                    "productName": "진단저장상품",
                    "quantity": 1,
                    "totalPaymentAmount": 19000,
                },
            }
        ]

        with patch.object(main, "_today_kst", return_value=d):
            with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", return_value=([], {"ok": True, "fetched": 0})):
                with patch.object(main, "_fetch_commerce_product_orders_for_day_direct", return_value=(direct_items, {"ok": True, "supported": True, "fetched": 1})):
                    with SessionLocal() as s:
                        r = main.sales_sync(main.SalesSyncRequest(date_from=d, date_to=d, lag_days=0), db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(r.get("ok")))
        with SessionLocal() as s:
            row = (
                s.query(AnalyticsJobRun)
                .filter(
                    AnalyticsJobRun.job_name == main._SALES_SYNC_DIAGNOSTIC_JOB_NAME,
                    AnalyticsJobRun.run_date == d,
                )
                .one_or_none()
            )

        self.assertIsNotNone(row)
        summary_map = main._extract_sales_job_detail_summary_map(str((row.detail if row else "") or ""))
        item = summary_map.get(d.isoformat()) or {}
        self.assertTrue(bool(((item.get("enumerator_results") or {}).get("direct_order") or {}).get("checked")))

    def test_sales_dashboard_rollup(self) -> None:
        d1 = date(2026, 3, 8)
        d2 = date(2026, 3, 9)
        with SessionLocal() as s:
            s.add_all(
                [
                    NaverCommerceProductSalesDaily(
                        date=d1,
                        product_id=111,
                        source="commerce_orders",
                        product_name="A",
                        category_large="대",
                        category_middle="중",
                        category_small="소",
                        order_count=2,
                        quantity=2,
                        amount=10000,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=d2,
                        product_id=111,
                        source="commerce_orders",
                        product_name="A",
                        category_large="대",
                        category_middle="중",
                        category_small="소",
                        order_count=1,
                        quantity=1,
                        amount=7000,
                        refund_amount=0,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=d2,
                        product_id=222,
                        source="commerce_orders",
                        product_name="B",
                        category_large="대",
                        category_middle="중2",
                        category_small="소2",
                        order_count=1,
                        quantity=3,
                        amount=12000,
                        refund_amount=0,
                    ),
                ]
            )
            s.commit()

        with SessionLocal() as s:
            out = main.sales_dashboard(d1, d2, source="commerce_orders", limit_products=10, db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(out.get("ok")))
        totals = out.get("totals") or {}
        self.assertAlmostEqual(float(totals.get("amount") or 0), 29000.0, places=6)
        self.assertEqual(int(totals.get("order_count") or 0), 4)
        self.assertEqual(int(totals.get("quantity") or 0), 6)
        self.assertIn("refund_amount", totals)

        daily = out.get("daily") or []
        self.assertEqual([d.get("date") for d in daily], [d1.isoformat(), d2.isoformat()])

        products = out.get("products") or []
        # B(12000) vs A(17000) → A가 1등
        self.assertEqual(int(products[0].get("product_id") or 0), 111)
        self.assertEqual(int(products[1].get("product_id") or 0), 222)

        cats = out.get("categories") or []
        self.assertTrue(len(cats) >= 1)

    def test_sales_product_series(self) -> None:
        d1 = date(2026, 3, 8)
        d2 = date(2026, 3, 9)
        with SessionLocal() as s:
            s.add_all(
                [
                    NaverCommerceProductSalesDaily(
                        date=d1,
                        product_id=111,
                        source="bizdata_product_detail",
                        product_name="A",
                        category_large="대",
                        category_middle="중",
                        category_small="소",
                        order_count=2,
                        quantity=2,
                        amount=10000,
                        refund_amount=0,
                    ),
                    NaverCommerceProductSalesDaily(
                        date=d2,
                        product_id=111,
                        source="bizdata_product_detail",
                        product_name="A",
                        category_large="대",
                        category_middle="중",
                        category_small="소",
                        order_count=1,
                        quantity=1,
                        amount=7000,
                        refund_amount=1000,
                        refund_order_count=1,
                        refund_quantity=1,
                    ),
                ]
            )
            s.commit()

        with SessionLocal() as s:
            out = main.sales_product_series(111, d1, d2, source="bizdata_product_detail", db=s)  # type: ignore[arg-type]

        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(int(out.get("product_id") or 0), 111)
        self.assertEqual(out.get("product_name"), "A")
        pts = out.get("points") or []
        self.assertEqual([p.get("date") for p in pts], [d1.isoformat(), d2.isoformat()])
        totals = out.get("totals") or {}
        self.assertAlmostEqual(float(totals.get("amount") or 0), 17000.0, places=6)
        self.assertAlmostEqual(float(totals.get("refund_amount") or 0), 1000.0, places=6)


if __name__ == "__main__":
    unittest.main()

