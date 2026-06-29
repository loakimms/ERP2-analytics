import os
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from db import (
    AnalyticsJobRun,
    NaverCommerceProductOrderRaw,
    NaverCommerceProductSalesDaily,
    SessionLocal,
    init_db,
)


class TestSalesCoverageAndBackfill(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            db.query(AnalyticsJobRun).delete(synchronize_session=False)
            db.query(NaverCommerceProductSalesDaily).delete(synchronize_session=False)
            db.query(NaverCommerceProductOrderRaw).delete(synchronize_session=False)
            db.commit()

    def test_sales_coverage_reports_structural_statuses(self) -> None:
        today = date(2026, 3, 30)
        d0 = date(2026, 3, 25)
        d1 = d0 + timedelta(days=1)
        d2 = d0 + timedelta(days=2)
        d3 = d0 + timedelta(days=3)
        d4 = d0 + timedelta(days=4)
        d5 = d0 + timedelta(days=5)

        with SessionLocal() as db:
            db.add(
                NaverCommerceProductOrderRaw(
                    product_order_id="PO-COVERED",
                    payment_date=d0,
                    order_date=d0,
                    product_id=101,
                    product_name="커버드 상품",
                    quantity=1,
                    amount_paid=10000,
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=d0,
                    product_id=101,
                    source="commerce_orders",
                    product_name="커버드 상품",
                    order_count=1,
                    quantity=1,
                    amount=10000,
                )
            )
            db.add(AnalyticsJobRun(job_name="sales:commerce:yesterday", run_date=d1 + timedelta(days=1), status="SUCCESS", detail="{}"))
            db.add(AnalyticsJobRun(job_name="sales:commerce:yesterday", run_date=d2 + timedelta(days=1), status="FAILED", detail="boom"))
            db.add(AnalyticsJobRun(job_name="sales:commerce:yesterday", run_date=d4 + timedelta(days=1), status="SUCCESS", detail="{}"))
            db.add(
                NaverCommerceProductOrderRaw(
                    product_order_id="PO-RAW-ONLY",
                    payment_date=d3,
                    order_date=d3,
                    product_id=202,
                    product_name="로우 전용 상품",
                    quantity=2,
                    amount_paid=22000,
                )
            )
            db.add(
                NaverCommerceProductSalesDaily(
                    date=d2,
                    product_id=404,
                    source="commerce_orders",
                    product_name="실패했지만 집계가 남은 상품",
                    order_count=1,
                    quantity=1,
                    amount=33000,
                )
            )
            db.commit()

        with patch.dict(os.environ, {"SALES_SYNC_LAG_DAYS": "2"}):
            with patch.object(main, "_today_kst", return_value=today):
                res = self.client.get(
                    "/sales/coverage",
                    params={
                        "date_from": str(d0),
                        "date_to": str(d5),
                        "source": "commerce_orders",
                    },
                )
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(int(data["raw_days_count"]), 2)
        self.assertEqual(int(data["aggregate_days_count"]), 2)
        self.assertEqual([str(x) for x in data["confirmed_empty_days"]], [str(d1)])
        self.assertEqual([str(x) for x in data["pending_empty_days"]], [str(d4)])
        self.assertEqual([str(x) for x in data["failed_days"]], [str(d2)])
        self.assertEqual([str(x) for x in data["raw_only_days"]], [str(d3)])
        self.assertEqual([str(x) for x in data["missing_days"]], [str(d5)])

        by_date = {str(x["date"]): x for x in data["items"]}
        self.assertEqual(by_date[str(d0)]["coverage_status"], "covered")
        self.assertEqual(by_date[str(d1)]["coverage_status"], "confirmed_empty")
        self.assertEqual(by_date[str(d2)]["coverage_status"], "failed")
        self.assertEqual(by_date[str(d2)]["failure_reason"], "boom")
        self.assertEqual(by_date[str(d3)]["coverage_status"], "raw_only")
        self.assertEqual(by_date[str(d4)]["coverage_status"], "pending_empty")
        self.assertEqual(by_date[str(d5)]["coverage_status"], "missing")

    def test_sales_sync_yesterday_backfills_recent_unsettled_days(self) -> None:
        today = date(2026, 3, 30)
        d0 = today - timedelta(days=3)  # pending_empty -> 포함
        d1 = today - timedelta(days=2)  # failed -> 포함
        d2 = today - timedelta(days=1)  # raw_only -> 포함 + yesterday

        with SessionLocal() as db:
            db.add(AnalyticsJobRun(job_name="sales:commerce:yesterday", run_date=d0 + timedelta(days=1), status="SUCCESS", detail="{}"))
            db.add(AnalyticsJobRun(job_name="sales:commerce:yesterday", run_date=d1 + timedelta(days=1), status="FAILED", detail="boom"))
            db.add(
                NaverCommerceProductOrderRaw(
                    product_order_id="PO-BACKFILL",
                    payment_date=d2,
                    order_date=d2,
                    product_id=303,
                    product_name="백필 대상 상품",
                    quantity=1,
                    amount_paid=33000,
                )
            )
            db.commit()

        called_dates: list[str] = []

        def fake_sales_sync(req, db):  # type: ignore[no-untyped-def]
            ymd = req.date_from.isoformat()
            called_dates.append(ymd)
            return {
                "ok": True,
                "processed_dates": [ymd],
                "fetched_changed_days": [ymd],
                "raw_upserted_by_changed_day": {ymd: 1},
                "sales_rows_by_date": {ymd: 1},
                "errors": {},
            }

        with patch.dict(os.environ, {"SALES_SYNC_LOOKBACK_DAYS": "3", "SALES_SYNC_LAG_DAYS": "3"}):
            with patch.object(main, "_today_kst", return_value=today):
                with patch.object(main, "sales_sync", side_effect=fake_sales_sync):
                    with SessionLocal() as db:
                        out = main.sales_sync_yesterday(db=db)  # type: ignore[arg-type]

        self.assertTrue(bool(out.get("ok")))
        self.assertEqual(out.get("status"), "SUCCESS")
        result = out.get("result") or {}
        self.assertEqual(result.get("attempted_dates"), [d0.isoformat(), d1.isoformat(), d2.isoformat()])
        self.assertEqual(called_dates, [d0.isoformat(), d1.isoformat(), d2.isoformat()])

    def test_sales_sync_does_not_store_out_of_target_changed_orders(self) -> None:
        target = date(2026, 3, 29)
        next_day = target + timedelta(days=1)

        def fake_changed(day):  # type: ignore[no-untyped-def]
            return ([{"changed_day": day.isoformat()}], {})

        def fake_direct(day):  # type: ignore[no-untyped-def]
            return ([{"direct_day": day.isoformat()}], {"supported": True})

        def fake_rows(items):  # type: ignore[no-untyped-def]
            marker = items[0] if items else {}
            if "direct_day" in marker:
                return [
                    {
                        "product_order_id": "PO-TARGET-DIRECT",
                        "payment_date": target,
                        "order_date": target,
                        "product_id": 1001,
                        "product_name": "대상일 전체 주문",
                        "quantity": 1,
                        "amount_paid": 10000,
                    }
                ]
            day = date.fromisoformat(str(marker.get("changed_day")))
            if day == target:
                return [
                    {
                        "product_order_id": "PO-TARGET-CHANGED",
                        "payment_date": target,
                        "order_date": target,
                        "product_id": 1001,
                        "product_name": "대상일 변경 주문",
                        "quantity": 1,
                        "amount_paid": 10000,
                    },
                    {
                        "product_order_id": "PO-NEXT-PARTIAL",
                        "payment_date": next_day,
                        "order_date": next_day,
                        "product_id": 2002,
                        "product_name": "다음날 오전 부분 주문",
                        "quantity": 1,
                        "amount_paid": 20000,
                    },
                ]
            return [
                {
                    "product_order_id": "PO-NEXT-CHANGED",
                    "payment_date": next_day,
                    "order_date": next_day,
                    "product_id": 2002,
                    "product_name": "다음날 변경 주문",
                    "quantity": 1,
                    "amount_paid": 20000,
                }
            ]

        with patch.object(main, "_today_kst", return_value=next_day):
            with patch.object(main, "_fetch_commerce_changed_product_orders_for_day", side_effect=fake_changed):
                with patch.object(main, "_fetch_commerce_product_orders_for_day_direct", side_effect=fake_direct):
                    with patch.object(main, "_commerce_resolve_items_with_detail", side_effect=lambda items: items):
                        with patch.object(main, "_commerce_rows_from_items", side_effect=fake_rows):
                            with SessionLocal() as db:
                                out = main.sales_sync(main.SalesSyncRequest(date_from=target, date_to=target, lag_days=1), db=db)  # type: ignore[arg-type]

        self.assertTrue(bool(out.get("ok")))
        self.assertEqual((out.get("raw_skipped_out_of_target_by_changed_day") or {}).get(target.isoformat()), 1)
        self.assertEqual((out.get("raw_skipped_out_of_target_by_changed_day") or {}).get(next_day.isoformat()), 1)
        with SessionLocal() as db:
            target_count = (
                db.query(NaverCommerceProductOrderRaw)
                .filter(NaverCommerceProductOrderRaw.payment_date == target)
                .count()
            )
            next_count = (
                db.query(NaverCommerceProductOrderRaw)
                .filter(NaverCommerceProductOrderRaw.payment_date == next_day)
                .count()
            )
        self.assertEqual(int(target_count), 2)
        self.assertEqual(int(next_count), 0)

    def test_sales_sync_preserves_ip_not_allowed_error_from_token_fetch(self) -> None:
        target = date(2026, 3, 29)

        def fake_fetch_access_token(**kwargs):  # type: ignore[no-untyped-def]
            return None, {
                "ok": False,
                "status_code": 403,
                "message": 'token_failed(403) {"code":"GW.IP_NOT_ALLOWED","message":"허용되지 않은 IP입니다."}',
            }

        with patch.object(main, "_get_api_setting", side_effect=lambda name: "x" if "NAVER_COMMERCE_CLIENT_" in str(name) else ""):
            with patch.object(main, "_naver_commerce_fetch_access_token", side_effect=fake_fetch_access_token):
                with SessionLocal() as db:
                    out = main.sales_sync(main.SalesSyncRequest(date_from=target, date_to=target, lag_days=0), db=db)  # type: ignore[arg-type]

        self.assertFalse(bool(out.get("ok")))
        errors = out.get("errors") or {}
        err = str(errors.get(target.isoformat()) or "")
        self.assertIn("GW.IP_NOT_ALLOWED", err)
        self.assertNotIn("not configured", err.lower())

    def test_sales_coverage_includes_direct_order_diagnostics_from_job_detail(self) -> None:
        today = date(2026, 3, 30)
        target = today - timedelta(days=1)
        detail = {
            "coverage_summary": {
                "results_by_date": {
                    target.isoformat(): {
                        "enumerator_results": {
                            "changed_order": {"candidate_count": 0},
                            "direct_order": {"checked": True, "supported": True, "candidate_count": 0},
                            "deduped_candidate_count": 0,
                        }
                    }
                }
            }
        }

        with SessionLocal() as db:
            db.add(
                AnalyticsJobRun(
                    job_name="sales:commerce:yesterday",
                    run_date=today,
                    status="SUCCESS",
                    detail=main.json.dumps(detail, ensure_ascii=False),
                )
            )
            db.commit()

        with patch.dict(os.environ, {"SALES_SYNC_LAG_DAYS": "7"}):
            with patch.object(main, "_today_kst", return_value=today):
                res = self.client.get(
                    "/sales/coverage",
                    params={
                        "date_from": str(target),
                        "date_to": str(target),
                        "source": "commerce_orders",
                    },
                )

        self.assertEqual(res.status_code, 200)
        item = (res.json().get("items") or [])[0]
        self.assertEqual(item.get("coverage_status"), "pending_empty")
        self.assertTrue(bool(item.get("direct_order_checked")))
        self.assertTrue(bool(item.get("direct_order_supported")))
        self.assertEqual(int(item.get("direct_order_candidate_count") or 0), 0)

    def test_sales_coverage_uses_manual_sync_diagnostics_when_yesterday_summary_is_stale(self) -> None:
        today = date(2026, 3, 30)
        target = today - timedelta(days=1)
        manual_detail = {
            "coverage_summary": {
                "results_by_date": {
                    target.isoformat(): {
                        "ok": True,
                        "sales_row_count": 0,
                        "enumerator_results": {
                            "changed_order": {"candidate_count": 0},
                            "direct_order": {"checked": True, "supported": False, "candidate_count": 0, "raw_upserted": 0},
                            "deduped_candidate_count": 0,
                        },
                    }
                }
            }
        }

        with SessionLocal() as db:
            db.add(
                AnalyticsJobRun(
                    job_name="sales:commerce:yesterday",
                    run_date=today,
                    status="SUCCESS",
                    detail="{}",
                )
            )
            db.add(
                AnalyticsJobRun(
                    job_name=main._SALES_SYNC_DIAGNOSTIC_JOB_NAME,
                    run_date=target,
                    status="SUCCESS",
                    detail=main.json.dumps(manual_detail, ensure_ascii=False),
                )
            )
            db.commit()

        with patch.dict(os.environ, {"SALES_SYNC_LAG_DAYS": "7"}):
            with patch.object(main, "_today_kst", return_value=today):
                res = self.client.get(
                    "/sales/coverage",
                    params={
                        "date_from": str(target),
                        "date_to": str(target),
                        "source": "commerce_orders",
                    },
                )

        self.assertEqual(res.status_code, 200)
        item = (res.json().get("items") or [])[0]
        self.assertEqual(item.get("coverage_status"), "pending_empty")
        self.assertTrue(bool(item.get("direct_order_checked")))
        self.assertFalse(bool(item.get("direct_order_supported")))
        self.assertEqual(int(item.get("direct_order_candidate_count") or 0), 0)


if __name__ == "__main__":
    unittest.main()
