import inspect
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

import main


class TestGfaStrategySourceCompletionAlignment(unittest.TestCase):
    def test_normalize_trigger_source(self):
        self.assertEqual(main._gfa_normalize_strategy_trigger_source({"trigger_source": "COLLECTION_SUCCESS"}), "COLLECTION_SUCCESS")
        self.assertEqual(main._gfa_normalize_strategy_trigger_source({"triggerSource": "SCHEDULED"}), "SCHEDULED")
        self.assertEqual(main._gfa_normalize_strategy_trigger_source({}), "MANUAL")
        self.assertEqual(main._gfa_normalize_strategy_trigger_source({"trigger_source": "HTTP"}), "MANUAL")
        self.assertEqual(main._gfa_normalize_strategy_trigger_source(None), "MANUAL")

    def test_run_mode_maps_to_scheduled_or_manual(self):
        self.assertEqual(main._gfa_strategy_trigger_source_from_collection_run_mode("schedule"), "SCHEDULED")
        self.assertEqual(main._gfa_strategy_trigger_source_from_collection_run_mode("scheduled"), "SCHEDULED")
        self.assertEqual(main._gfa_strategy_trigger_source_from_collection_run_mode("manual"), "MANUAL")
        self.assertEqual(main._gfa_strategy_trigger_source_from_collection_run_mode("force"), "MANUAL")

    def test_unrelated_collector_success_does_not_trigger(self):
        with patch.object(main, "_gfa_run_strategy_daily_batch_guarded") as guarded:
            out = main._gfa_maybe_trigger_strategy_after_performance_success(task_id="ads_daily", final_status="SUCCESS")
            guarded.assert_not_called()
            self.assertFalse(out["triggered"])
            self.assertEqual(out["reason"], "not_gfa_performance_daily")

    def test_non_success_gfa_collection_does_not_trigger(self):
        with patch.object(main, "_gfa_run_strategy_daily_batch_guarded") as guarded:
            for status in ("FAILED", "PARTIAL", "CANCELLED", "IN_PROGRESS", "QUEUED"):
                with self.subTest(status=status):
                    guarded.reset_mock()
                    out = main._gfa_maybe_trigger_strategy_after_performance_success(
                        task_id="gfa_performance_daily",
                        final_status=status,
                    )
                    guarded.assert_not_called()
                    self.assertFalse(out["triggered"])
                    self.assertEqual(out["reason"], "gfa_performance_status_not_success")

    def test_success_calls_shared_guarded_helper_with_collection_success(self):
        session = MagicMock()
        with patch.object(main, "SessionLocal") as session_local:
            session_local.return_value.__enter__.return_value = session
            session_local.return_value.__exit__.return_value = False
            with patch.object(
                main,
                "_gfa_run_strategy_daily_batch_guarded",
                return_value={"status": "NO_NEW_STRATEGY_SOURCE_DATA", "trigger_source": "COLLECTION_SUCCESS"},
            ) as guarded:
                out = main._gfa_maybe_trigger_strategy_after_performance_success(
                    task_id="gfa_performance_daily",
                    final_status="SUCCESS",
                )
        guarded.assert_called_once_with(session, {"trigger_source": "COLLECTION_SUCCESS"})
        self.assertTrue(out["triggered"])
        self.assertTrue(out["ok"])
        self.assertEqual(out["reason"], "NO_NEW_STRATEGY_SOURCE_DATA")

    def test_strategy_waits_for_active_performance_source_range(self):
        self.assertTrue(
            main._gfa_strategy_should_wait_for_performance_source(
                latest_as_of_date=date(2026, 9, 22),
                source_max_date=date(2026, 9, 22),
                active_source_to=date(2026, 9, 27),
            )
        )
        self.assertFalse(
            main._gfa_strategy_should_wait_for_performance_source(
                latest_as_of_date=date(2026, 9, 22),
                source_max_date=date(2026, 9, 27),
                active_source_to=date(2026, 9, 27),
            )
        )
        self.assertFalse(
            main._gfa_strategy_should_wait_for_performance_source(
                latest_as_of_date=date(2026, 9, 22),
                source_max_date=date(2026, 9, 22),
                active_source_to=date(2026, 9, 22),
            )
        )

    def test_strategy_collection_task_has_source_dependency_skip_contract(self):
        src = inspect.getsource(main._collection_execute_task)
        strategy_at = src.find('if task_id == "gfa_strategy_daily_snapshot"')
        dependency_at = src.find("_gfa_strategy_source_collection_dependency_state", strategy_at)
        guarded_at = src.find("_gfa_run_strategy_daily_batch_guarded", strategy_at)
        skipped_at = src.find('"status": "SKIPPED"', strategy_at)
        no_new_at = src.find("NO_NEW_STRATEGY_SOURCE_DATA", strategy_at)
        self.assertGreater(strategy_at, -1)
        self.assertGreater(dependency_at, strategy_at)
        self.assertGreater(guarded_at, dependency_at)
        self.assertGreater(skipped_at, dependency_at)
        self.assertGreater(no_new_at, guarded_at)

    def test_daily_batch_bootstraps_missing_published_baseline(self):
        latest = MagicMock()
        latest.as_of_date = date(2026, 9, 1)
        latest.snapshot_id = "baseline_snapshot"
        latest.snapshot_origin = main.GFA_STRATEGY_SNAPSHOT_ORIGIN_BASELINE
        latest.source_result_id = "saved_strategy_result"
        session = MagicMock()
        with patch.object(main, "_gfa_strategy_latest_published_snapshot", side_effect=[None, latest]):
            with patch.object(main, "_gfa_promote_baseline_strategy_snapshot", return_value={"ok": True}) as promote:
                with patch.object(main, "_gfa_strategy_latest_source_date", return_value=date(2026, 9, 1)):
                    out = main._gfa_run_strategy_daily_batch(session, {"trigger_source": "MANUAL"})
        promote.assert_called_once_with(session)
        self.assertEqual(out["status"], "NO_NEW_STRATEGY_SOURCE_DATA")
        self.assertEqual(out["latest_published_as_of_date"], "2026-09-01")
        self.assertEqual(out["baseline_bootstrap"]["status"], "PROMOTED")
        self.assertEqual(out["baseline_bootstrap"]["source_result_id"], "saved_strategy_result")

    def test_strategy_collection_task_skips_when_baseline_source_missing(self):
        session = MagicMock()
        with patch.object(main, "SessionLocal") as session_local:
            session_local.return_value.__enter__.return_value = session
            session_local.return_value.__exit__.return_value = False
            with patch.object(main, "_gfa_strategy_latest_published_snapshot", return_value=None):
                with patch.object(
                    main,
                    "_gfa_strategy_source_collection_dependency_state",
                    return_value={"ready": True, "sourceMaxDate": "2026-09-27"},
                ):
                    with patch.object(
                        main,
                        "_gfa_run_strategy_daily_batch_guarded",
                        side_effect=RuntimeError("HOLD_GFA_STRATEGY_BASELINE_SOURCE_INVALID"),
                    ):
                        out = main._collection_execute_task(
                            "gfa_strategy_daily_snapshot",
                            main.CollectionRunPayload(date=date(2026, 9, 27), mode="manual"),
                            run_mode="manual",
                        )
        self.assertEqual(out["status"], "SKIPPED")
        self.assertEqual(out["reason"], "gfa_strategy_baseline_source_not_ready")
        self.assertEqual(out["rows_written"], 0)

    def test_strategy_failure_is_isolated_from_caller(self):
        session = MagicMock()
        with patch.object(main, "SessionLocal") as session_local:
            session_local.return_value.__enter__.return_value = session
            session_local.return_value.__exit__.return_value = False
            with patch.object(main, "_gfa_run_strategy_daily_batch_guarded", side_effect=RuntimeError("boom")):
                out = main._gfa_maybe_trigger_strategy_after_performance_success(
                    task_id="gfa_performance_daily",
                    final_status="SUCCESS",
                )
        self.assertTrue(out["triggered"])
        self.assertFalse(out["ok"])
        self.assertIn("boom", out["error"] or "")
        self.assertEqual(out["reason"], "gfa_strategy_post_success_failed_isolated")

    def test_finish_orchestration_hooks_after_collection_commit(self):
        src = inspect.getsource(main._finish_orchestration_from_collector)
        finish_at = src.find("_collection_finish_job")
        event_at = src.find("_collection_event")
        hook_at = src.find("_gfa_maybe_trigger_strategy_after_performance_success")
        self.assertGreater(finish_at, -1)
        self.assertGreater(event_at, -1)
        self.assertGreater(hook_at, event_at)
        self.assertGreater(hook_at, finish_at)

    def test_strategy_job_keeps_shared_guard(self):
        src = inspect.getsource(main._collection_execute_task)
        self.assertIn("_gfa_run_strategy_daily_batch_guarded", src)
        self.assertIn("_gfa_strategy_trigger_source_from_collection_run_mode", src)
        self.assertIn("gfa_performance_daily", inspect.getsource(main._gfa_maybe_trigger_strategy_after_performance_success))


if __name__ == "__main__":
    unittest.main()
