import json
import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import main


class TestTodayOnlySnapshotBackfill(unittest.TestCase):
    def test_today_only_range_forces_today_even_with_explicit_past_date(self):
        today = date(2026, 9, 28)
        payload = main.CollectionRunPayload(date=date(2026, 9, 27), date_from=date(2026, 9, 20), date_to=date(2026, 9, 21))
        with patch.object(main, "_today_kst", return_value=today):
            for task_id in main.TODAY_ONLY_SNAPSHOT_TASKS:
                with self.subTest(task_id=task_id):
                    self.assertEqual(main._collection_effective_target_for_task(task_id, payload), today)
                    self.assertEqual(main._collection_effective_range_for_task(task_id, payload), (today, today))

    def test_today_only_pending_tasks_include_ad_rank(self):
        self.assertIn("ad_rank_diagnosis_cdp", main.TODAY_ONLY_SNAPSHOT_TASKS)
        self.assertIn("ad_rank_diagnosis_cdp", main.TODAY_CLONE_BACKFILL_TASKS)

    def test_clone_missing_dates_walks_back_until_existing_date(self):
        source = date(2026, 9, 28)
        existing = source - timedelta(days=3)

        def fake_count(_db, _table, d):
            if d == source:
                return 10
            if d == existing:
                return 5
            return 0

        with patch.object(main, "_collection_count_rows_for_date", side_effect=fake_count):
            out = main._collection_today_clone_missing_dates(MagicMock(), primary_table="tracked_product_rank_daily", source_date=source)

        self.assertEqual(out, [date(2026, 9, 26), date(2026, 9, 27)])

    def test_page_metrics_missing_dates_include_rows_without_review_metrics(self):
        source = date(2026, 10, 8)
        last_with_metrics = date(2026, 10, 3)

        def fake_metric_count(_db, d):
            if d == source or d == last_with_metrics:
                return 7
            return 0

        with patch.object(main, "_collection_count_page_metric_rows_for_date", side_effect=fake_metric_count):
            out = main._collection_page_metrics_missing_metric_dates(MagicMock(), source_date=source)

        self.assertEqual(out, [date(2026, 10, 4), date(2026, 10, 5), date(2026, 10, 6), date(2026, 10, 7)])

    def test_page_metrics_clone_skips_when_today_has_no_review_metrics(self):
        today = date(2026, 10, 8)
        db = MagicMock()
        with patch.object(main, "_today_kst", return_value=today), patch.object(main, "_collection_count_page_metric_rows_for_date", return_value=0), patch.object(main, "_collection_clone_page_metrics_today_rows") as clone_rows:
            out = main._collection_clone_today_snapshot_backfill(db, task_id="page_metrics_cdp", source_date=today)

        self.assertTrue(out["skipped"])
        self.assertEqual(out["reason"], "source_has_no_review_metrics")
        clone_rows.assert_not_called()

    def test_page_metrics_clone_fills_only_empty_values_on_existing_rows(self):
        db = MagicMock()
        db.execute.return_value.rowcount = 7
        main._collection_clone_page_metrics_today_rows(db, source_date=date(2026, 10, 8), target_date=date(2026, 10, 7))

        page_sql = str(db.execute.call_args_list[0].args[0])
        self.assertIn("on conflict (date, product_url) do update set", page_sql)
        self.assertIn("rating = coalesce(tracked_product_page_daily.rating, excluded.rating)", page_sql)
        self.assertIn("review_count = coalesce(tracked_product_page_daily.review_count, excluded.review_count)", page_sql)
        self.assertIn("price = coalesce(tracked_product_page_daily.price, excluded.price)", page_sql)

    def test_finish_job_attaches_today_clone_backfill_detail(self):
        db = MagicMock()
        job = MagicMock()
        job.task_id = "ad_rank_diagnosis_cdp"
        job.target_date = date(2026, 9, 27)
        job.detail_json = None

        backfill = {"ok": True, "filled_dates": ["2026-09-27"], "rows_written": 384}
        with patch.object(main, "_today_kst", return_value=date(2026, 9, 28)), patch.object(main, "_collection_clone_today_snapshot_backfill", return_value=backfill) as clone:
            out = main._collection_finish_job(db, job, status="SUCCESS", rows_written=384, detail={"collector_job": {"job_id": "x"}})

        clone.assert_called_once_with(db, task_id="ad_rank_diagnosis_cdp", source_date=date(2026, 9, 28))
        saved_detail = json.loads(job.detail_json)
        self.assertEqual(saved_detail["today_clone_backfill"], backfill)
        self.assertIs(out, job)

    def test_collector_result_target_for_current_snapshot_modes_ignores_stale_target(self):
        today = date(2026, 9, 28)
        stale = date(2026, 9, 27)
        with patch.object(main, "_today_kst", return_value=today):
            for mode in ("shopping_rank_cdp", "shopping_rank_mobile_organic_cdp", "ad_rank_diagnosis_cdp", "page_metrics"):
                with self.subTest(mode=mode):
                    self.assertEqual(main._collection_collector_result_target_for_mode(mode, stale), today)

    def test_collector_result_target_for_report_modes_keeps_requested_date(self):
        target = date(2026, 9, 27)
        with patch.object(main, "_today_kst", return_value=date(2026, 9, 28)):
            self.assertEqual(main._collection_collector_result_target_for_mode("ads_searchword_report_cdp", target), target)

    def test_rank_source_priority_includes_current_shopping_snapshot_source(self):
        self.assertEqual(main._rank_source_priority("naver_msearch_lexical_product_top40"), 20)


if __name__ == "__main__":
    unittest.main()
