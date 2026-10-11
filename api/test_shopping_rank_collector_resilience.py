import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from datetime import datetime
from zoneinfo import ZoneInfo

import main


class TestShoppingRankCollectorResilience(unittest.TestCase):
    def test_page_metrics_task_id_maps_shopping_rank_cdp(self):
        self.assertEqual(main._page_metrics_task_id_for_mode("shopping_rank_cdp"), "rank_openapi")
        self.assertEqual(main._page_metrics_task_id_for_mode("shopping_rank_mobile_organic_cdp"), "rank_openapi")
        self.assertEqual(main._page_metrics_task_id_for_mode("page_metrics"), "page_metrics_cdp")
        self.assertEqual(main._page_metrics_task_id_for_mode("ad_rank_diagnosis_cdp"), "ad_rank_diagnosis_cdp")

    def test_mobile_organic_collector_uses_msearch_lexical_item_id(self):
        host_agent = Path(main.__file__).resolve().parent.parent / "tools" / "host-agent.ps1"
        source = host_agent.read_text(encoding="utf-8-sig", errors="ignore")
        self.assertIn("https://msearch.shopping.naver.com/search", source)
        self.assertIn("https://msearch.shopping.naver.com/search/all?query=", source)
        self.assertIn("String(item.themeSource || '') === 'lexical'", source)
        self.assertIn("&& !item.adId", source)
        self.assertIn("targetItemIds.has(String(item.id || ''))", source)
        self.assertIn("$expression = @'\n(async () => {", source.replace("\r\n", "\n"))
        self.assertIn("naver_msearch_lexical_product_top40", source)
        self.assertIn("product_id: target.trackedId", source)
        self.assertIn("matched_item_id: itemId", source)
        self.assertIn("matched_item_id", source)
        self.assertIn("naver_msearch_lexical_item_id", source)

    def test_mobile_organic_keyword_failure_does_not_terminalize_collector_job(self):
        source = Path(main.__file__).read_text(encoding="utf-8-sig", errors="ignore")
        self.assertIn('status == "FAILED" and mode == "shopping_rank_mobile_organic_cdp"', source)
        self.assertIn('job["keyword_failed_count"]', source)
        self.assertIn('job["status"] = "SCRAPING"', source)

    def test_prototype_events_are_persisted_for_diagnosis(self):
        source = Path(main.__file__).read_text(encoding="utf-8-sig", errors="ignore")
        self.assertIn("collector browser event: {status}", source)
        self.assertIn("\"collector_event\": event", source)

    def test_collection_job_awaits_collector_pc(self):
        row = SimpleNamespace(
            detail_json=main._collection_json_dumps(
                {
                    "collector_job": {
                        "job_id": "pmc_test",
                        "mode": "shopping_rank_cdp",
                        "urls": ["https://search.shopping.naver.com/home"],
                    }
                }
            )
        )
        self.assertTrue(main._collection_job_awaits_collector_pc(row))
        row2 = SimpleNamespace(detail_json=main._collection_json_dumps({"result": {"ok": True}}))
        self.assertFalse(main._collection_job_awaits_collector_pc(row2))

    def test_claimed_shopping_rank_survives_daily_reset(self):
        claimed = SimpleNamespace(
            status="CLAIMED",
            detail_json=main._collection_json_dumps(
                {
                    "collector_job": {
                        "job_id": "pmc_live",
                        "mode": "shopping_rank_cdp",
                        "urls": ["https://search.shopping.naver.com/home"],
                    }
                }
            ),
        )
        queued = SimpleNamespace(
            status="QUEUED",
            detail_json=main._collection_json_dumps(
                {
                    "collector_job": {
                        "job_id": "pmc_queued",
                        "mode": "shopping_rank_cdp",
                        "urls": ["https://search.shopping.naver.com/home"],
                    }
                }
            ),
        )
        self.assertTrue(main._collection_job_should_survive_daily_reset(claimed))
        self.assertFalse(main._collection_job_should_survive_daily_reset(queued))

    def test_reset_stale_daily_jobs_keeps_claimed_cdp(self):
        now_kst = datetime(2026, 8, 6, 0, 1, 0)
        yesterday = datetime(2026, 8, 5, 14, 50, 0)
        claimed = SimpleNamespace(
            status="CLAIMED",
            error=None,
            finished_at=None,
            started_at=yesterday,
            detail_json=main._collection_json_dumps(
                {
                    "collector_job": {
                        "job_id": "pmc_keep",
                        "mode": "shopping_rank_cdp",
                        "urls": ["https://search.shopping.naver.com/home"],
                        "status": "CLAIMED",
                    }
                }
            ),
        )
        queued = SimpleNamespace(
            status="QUEUED",
            error=None,
            finished_at=None,
            started_at=yesterday,
            detail_json=main._collection_json_dumps(
                {
                    "collector_job": {
                        "job_id": "pmc_drop",
                        "mode": "shopping_rank_cdp",
                        "urls": ["https://search.shopping.naver.com/home"],
                        "status": "QUEUED",
                    }
                }
            ),
        )
        query = MagicMock()
        query.filter.return_value = query
        query.all.return_value = [claimed, queued]
        db = MagicMock()
        db.query.return_value = query
        with main.PAGE_METRICS_COLLECTOR_JOB_LOCK:
            main.PAGE_METRICS_COLLECTOR_JOBS["pmc_drop"] = {"job_id": "pmc_drop", "status": "QUEUED"}
            main.PAGE_METRICS_COLLECTOR_JOBS["pmc_keep"] = {"job_id": "pmc_keep", "status": "CLAIMED"}
        try:
            updated = main._collection_reset_stale_daily_jobs(db, now_kst=now_kst)
            self.assertEqual(updated, 1)
            self.assertEqual(queued.status, "CANCELLED")
            self.assertEqual(queued.error, "daily_reset")
            self.assertEqual(claimed.status, "CLAIMED")
            self.assertIsNone(claimed.error)
            self.assertNotIn("pmc_drop", main.PAGE_METRICS_COLLECTOR_JOBS)
            self.assertIn("pmc_keep", main.PAGE_METRICS_COLLECTOR_JOBS)
        finally:
            with main.PAGE_METRICS_COLLECTOR_JOB_LOCK:
                main.PAGE_METRICS_COLLECTOR_JOBS.pop("pmc_drop", None)
                main.PAGE_METRICS_COLLECTOR_JOBS.pop("pmc_keep", None)

    def test_orchestration_reopenable_for_api_restart_failures(self):
        active = SimpleNamespace(status="CLAIMED", error=None, detail_json="{}")
        self.assertTrue(main._collector_orchestration_is_reopenable(active))
        failed = SimpleNamespace(status="FAILED", error="no_db_rows_saved", detail_json="{}")
        self.assertTrue(main._collector_orchestration_is_reopenable(failed))
        cancelled = SimpleNamespace(status="CANCELLED", error="user_cancelled", detail_json="{}")
        self.assertFalse(main._collector_orchestration_is_reopenable(cancelled))
        daily_reset = SimpleNamespace(status="CANCELLED", error="daily_reset", detail_json="{}")
        self.assertTrue(main._collector_orchestration_is_reopenable(daily_reset))
        success = SimpleNamespace(status="SUCCESS", error=None, detail_json="{}")
        self.assertFalse(main._collector_orchestration_is_reopenable(success))

    def test_materialize_collector_job_from_public(self):
        public = {
            "job_id": "pmc_abc",
            "urls": ["https://search.shopping.naver.com/home"],
            "mode": "shopping_rank_cdp",
            "status": "DONE",
            "params": {"replace_existing_on_save": True},
            "target_date": "2026-08-05",
        }
        job = main._materialize_collector_job_from_public(public, fallback_status="CLAIMED")
        self.assertIsNotNone(job)
        assert job is not None
        self.assertEqual(job["job_id"], "pmc_abc")
        self.assertEqual(job["status"], "CLAIMED")
        self.assertEqual(job["mode"], "shopping_rank_cdp")
        self.assertTrue(job["params"]["replace_existing_on_save"])

    def test_collector_results_diagnostics_classifies_login_and_persistence(self):
        results = [
            main.PageMetricsCollectorResultItem(
                url="https://accounts.commerce.naver.com/login",
                ok=False,
                metrics={"error": "login_wait_timeout"},
                error="login_wait_timeout",
            )
        ]
        diagnostics = main._collector_results_diagnostics(
            results,
            saved=0,
            failed=1,
            persisted={"verification_reason": "no_db_rows_saved"},
            job_error="no_db_rows_saved",
        )
        self.assertEqual(diagnostics["items_total"], 1)
        self.assertEqual(diagnostics["category_counts"]["login_timeout"], 1)
        self.assertEqual(diagnostics["category_counts"]["persistence_empty"], 1)
        self.assertEqual(diagnostics["stage_counts"]["login"], 1)
        self.assertEqual(diagnostics["stage_counts"]["persist"], 1)
        self.assertEqual(diagnostics["primary_category"], "login_timeout")

    def test_shopping_rank_empty_serp_rows_are_blocked(self):
        metrics = {
            "rows": [
                {
                    "keyword": "???",
                    "product_url": "https://smartstore.naver.com/main/products/123",
                    "rank": 0,
                }
            ],
            "ranked_items": [],
            "ranked_items_count": 0,
            "ranked_id_count": 0,
        }

        self.assertEqual(main._shopping_rank_result_block_reason(metrics), "shopping_rank_no_ranked_items")

    def test_blocked_mobile_organic_final_save_does_not_write_zero_ranks(self):
        db = MagicMock()
        job = {
            "job_id": "pmc_blocked",
            "target_date": "2026-09-14",
            "params": {
                "keywords": [
                    {
                        "keyword": "HENNA",
                        "product_urls": ["https://smartstore.naver.com/thesujata/products/5897739461"],
                    }
                ],
                "replace_existing_on_save": False,
            },
        }
        results = [
            main.PageMetricsCollectorResultItem(
                url="https://msearch.shopping.naver.com/search/all?query=HENNA",
                ok=False,
                metrics={"fatal": True, "error": "mobile_search_restricted_or_captcha"},
                error="mobile_search_restricted_or_captcha",
            )
        ]

        with patch.object(main, "_write_keyword_result_impl", return_value=1) as write_keyword:
            saved, saved_serp, failed, saved_keywords = main._persist_shopping_rank_collector_results(
                db,
                job_id="pmc_blocked",
                job=job,
                results=results,
                partial=False,
            )

        self.assertEqual(saved, 0)
        self.assertEqual(saved_serp, 0)
        self.assertEqual(failed, 1)
        self.assertEqual(saved_keywords, [])
        write_keyword.assert_not_called()

    def test_rank_openapi_cooldown_ignores_zero_exposure_without_block_signature(self):
        row = SimpleNamespace(
            job_id="rank_zero_exposure",
            status="SUCCESS",
            error=None,
            finished_at=datetime(2026, 8, 10, 11, 0, 0, tzinfo=ZoneInfo("Asia/Seoul")),
            detail_json=main._collection_json_dumps(
                {
                    "db_persistence": {
                        "expected_keyword_count": 100,
                        "rows_total": 100,
                        "exposed_keyword_count": 0,
                        "verification_reason": "rank_keywords_verified",
                    }
                }
            ),
        )
        query = MagicMock()
        query.filter.return_value = query
        query.order_by.return_value = query
        query.limit.return_value = query
        query.all.return_value = [row]
        db = MagicMock()
        db.query.return_value = query

        state = main._rank_openapi_cooldown_state(
            db,
            now_kst=datetime(2026, 8, 10, 12, 0, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )

        self.assertIsNone(state)

    def test_rank_openapi_cooldown_detects_explicit_block_signature(self):
        row = SimpleNamespace(
            job_id="rank_blocked",
            status="FAILED",
            error="mobile_search_restricted_or_captcha",
            finished_at=datetime(2026, 8, 10, 11, 0, 0, tzinfo=ZoneInfo("Asia/Seoul")),
            detail_json=main._collection_json_dumps(
                {
                    "collector_diagnostics": {
                        "primary_category": "mobile_search_restricted_or_captcha",
                    }
                }
            ),
        )
        query = MagicMock()
        query.filter.return_value = query
        query.order_by.return_value = query
        query.limit.return_value = query
        query.all.return_value = [row]
        db = MagicMock()
        db.query.return_value = query

        state = main._rank_openapi_cooldown_state(
            db,
            now_kst=datetime(2026, 8, 10, 12, 0, 0, tzinfo=ZoneInfo("Asia/Seoul")),
        )

        self.assertIsNotNone(state)
        assert state is not None
        self.assertEqual(state["error"], "shopping_rank_cooldown_active")
        self.assertEqual(state["reason"], "shopping_rank_blocked_or_unreadable")
        self.assertGreater(state["remaining_seconds"], 0)
        self.assertIn("운영 PC", state["cache_guidance"])

    def test_collection_finish_uses_recent_baseline_anomaly(self):
        persisted = {
            "expected_keyword_count": 100,
            "missing_keyword_count": 0,
            "incomplete_product_count": 0,
            "rows_total": 100,
            "exposed_keyword_count": 0,
            "previous_exposed_count": 0,
            "baseline_exposed_count": 75,
            "baseline_date": "2026-08-07",
            "exposure_drop_ratio": 1.0,
            "rank_exposure_anomaly": True,
        }

        status, error = main._collection_apply_persistence_status(
            "rank_openapi",
            "SUCCESS",
            rows_written=100,
            persisted=persisted,
        )

        self.assertEqual(status, "PARTIAL")
        self.assertIn("baseline=75", error or "")
        self.assertEqual(persisted["verification_reason"], "rank_exposure_anomaly")

    def test_host_agent_contains_empty_serp_fail_closed_stop(self):
        script = Path(__file__).resolve().parents[1] / "tools" / "host-agent.ps1"
        text = script.read_text(encoding="utf-8-sig", errors="ignore")
        main_text = (Path(__file__).resolve().parent / "main.py").read_text(encoding="utf-8-sig", errors="ignore")

        self.assertIn("2026.09.14-msearch-block-evidence", text)
        self.assertIn("shopping_service_restricted_after_search", text)
        self.assertIn("shopping_rank_mobile_organic_cdp", text)
        self.assertIn("Submit-CollectorPartialResults", text)
        self.assertIn("mobile_organic_partial_saved", text)
        self.assertIn("msearch.shopping.naver.com/search", text)
        self.assertIn("shopping_rank_mobile_sas_shopping_cdp", main_text)
        self.assertIn("TrackedProductRankDaily.source.in_(rank_sources)", main_text)
        self.assertIn('"shopping_rank_mobile_sas_shopping_cdp", "excel"', main_text)
        self.assertIn("TrackedProductRankDaily.keyword == kw0", main_text)
        self.assertIn("TrackedProductRankDaily.keyword == kw_clean", main_text)
        self.assertIn("Do not pre-fill every planned", main_text)
        self.assertIn("rank=0 is valid only", main_text)
        self.assertIn("LEXICAL_PRODUCT", text)
        self.assertIn("themeSource", text)
        self.assertIn("purchaseConditionInfos", text)
        self.assertIn("targetItemIds", text)
        self.assertIn("allowedProductSpecs", text)
        self.assertIn("rankedByProductId", text)
        self.assertIn("rankValue", text)
        self.assertIn("rankValue > rankLimit", text)
        self.assertIn("extractBalancedObjectAt", text)
        self.assertIn("collectLexicalItemsFromObject", text)
        self.assertIn("matched_item_id", text)
        self.assertIn("naver_msearch_lexical_item_id", text)
        self.assertNotIn("match.index + 9000", text)
        self.assertIn("card_json", text)
        self.assertIn("naver_msearch_lexical_product_top40", text)
        self.assertIn("original_mall_product_id: target.trackedId", text)
        self.assertIn("current_rank < previous_rank", main_text)
        self.assertIn("cdp_profile_in_use_by_regular_chrome", text)
        self.assertIn("Get-RegularChromeUserDataDirConflict", text)
        self.assertIn("Normalize-PathForCompare", text)
        self.assertIn("shopping_rank_no_ranked_items", text)
        self.assertIn("shopping_rank_empty_serp_fatal", text)
        self.assertIn("shopping_rank_shopping_home_start", text)
        self.assertIn("WorkerHostChromeUserDataDir", text)
        self.assertIn("WorkerChromeProfileDir", text)
        self.assertIn("chromeProfileLabel", text)
        self.assertIn("Test-HostChromeMatchesProfile", text)
        self.assertIn("CDP Chrome profile mismatch", text)
        self.assertIn("ExpandEnvironmentVariables", text)
        self.assertIn("shopping_rank_input_ready", text)
        self.assertIn("Get-LocalChromeProfiles", text)
        self.assertIn("/chrome/profiles", text)
        self.assertIn("ConvertTo-ProcessArgumentLine", text)
        self.assertIn("ConvertTo-ProcessArgumentLine $psArgs", text)
        self.assertIn("shopping_rank_safety_keyword_limit", text)
        self.assertIn("shopping_rank_browser_token_keys", text)
        self.assertIn("naver_search_input_found", text)
        self.assertIn("naver_search_submit_button_found", text)
        self.assertIn("naver_main_search_submit_failed", text)
        self.assertIn("ad_rank_rate_limited", text)
        self.assertIn("ad_rank_rate_limited_stop", text)
        self.assertIn("mobile_search_restricted_or_captcha|shopping_service_restricted", text)
        self.assertIn("mobile_organic_result_wait_failed {0}/{1}: {2} {3}{4}", text)
        self.assertIn("naver_price_compare_more_found", text)
        self.assertIn("shopping_rank_human_verification_required", text)
        self.assertIn("Wait-HostChromeHumanActionOrCancel", text)
        self.assertIn("naver_price_compare_more_not_found", text)
        self.assertNotIn("action: 'naver_search_submit'", text)
        self.assertIn("$shoppingRankDelayMinSec = 6", text)
        self.assertIn("shopping_rank_batch_pause_after_", text)
        self.assertNotIn("shopping_rank_smartstore_preflight_start", text)
        self.assertNotIn("fetch(apiUrl.toString()", text)

    def test_rank_openapi_registry_exposes_resume_and_top40(self):
        registry = main.COLLECTION_TASK_REGISTRY["rank_openapi"]

        self.assertTrue(registry["supports_retry_incomplete"])
        self.assertIn("40위", registry["description"])
        self.assertIn("새로 시작", registry["description"])
        self.assertIn("이어서 시작", registry["description"])

    def test_rank_openapi_plan_deletes_on_fresh_start_and_resumes_by_product_row(self):
        source = Path(main.__file__).read_text(encoding="utf-8-sig", errors="ignore")

        self.assertIn("if force:", source)
        self.assertIn("NaverProductRankDaily.date == target", source)
        self.assertIn("TrackedProductRankDaily.date == target", source)
        self.assertIn("deleted_existing_serp_rows", source)
        self.assertIn('rank_sources = ("openapi", "shopping_rank_mobile_sas_shopping_cdp", SHOPPING_RANK_MOBILE_CDP_SOURCE)', source)
        self.assertIn('"expected_search_keyword_count"', source)
        self.assertIn('"collected_search_keyword_count"', source)
        self.assertIn("rank_summary = _rank_openapi_completion_summary(db, target)", source)
        self.assertIn("out.update(rank_summary)", source)
        self.assertIn('out["has_pending"] = True', source)
        self.assertIn("existing_rows = (", source)
        self.assertIn("TrackedProductRankDaily.product_url.in_(clean_urls)", source)
        self.assertIn("clean_urls = [u for u in clean_urls if u not in existing_urls]", source)
        self.assertIn("_rank_openapi_latest_unreadable_keywords", source)
        self.assertIn("mobile_organic_result_wait_failed", source)
        self.assertIn("if kw in unreadable_keywords:", source)
        self.assertIn('"resume_skipped_pairs"', source)
        self.assertIn('"pending_plan_pairs"', source)
        self.assertNotIn("existing_count >= len(set(clean_urls))", source)

    def test_data_collection_view_splits_rank_openapi_start_buttons(self):
        ui = Path(main.__file__).resolve().parent.parent / "web" / "src" / "modules" / "settings" / "DataCollectionView.tsx"
        source = ui.read_text(encoding="utf-8-sig", errors="ignore")

        self.assertIn("const forceRecollect = task.task_id === 'rank_openapi' && !retryIncomplete;", source)
        self.assertIn("const isOrganicRankTask = task.task_id === 'rank_openapi';", source)
        self.assertIn("collectionProgressFromTaskSavedRows", source)
        self.assertIn("combinedOrganicRankProgressCount", source)
        self.assertIn("resume_skipped_keywords", source)
        self.assertIn("'수집진행'", source)
        self.assertIn("'수집완료'", source)
        self.assertIn("'새로 시작'", source)
        self.assertIn("'이어서 시작'", source)
        self.assertIn("저장된 당일 오가닉 순위 데이터를 유지", source)
        self.assertIn("당일 오가닉 순위 데이터를 삭제", source)

    def test_host_agent_mobile_organic_scrolls_and_targets_seven_seconds(self):
        script = Path(__file__).resolve().parents[1] / "tools" / "host-agent.ps1"
        text = script.read_text(encoding="utf-8-sig", errors="ignore")
        release = (Path(__file__).resolve().parents[1] / "web" / "src" / "modules" / "hostAgentRelease.ts").read_text(encoding="utf-8-sig", errors="ignore")

        self.assertIn('2026.09.14-msearch-block-evidence', text)
        self.assertIn('20260914-0114', text)
        self.assertIn("smoothScrollSearchResults", text)
        self.assertIn("window.scrollBy({ top: 420", text)
        self.assertIn("window.scrollBy({ top: 760", text)
        self.assertIn("Start-Sleep -Milliseconds 800", text)
        self.assertIn("for ($waitTry = 0; $waitTry -lt 12; $waitTry++)", text)
        self.assertIn("Start-Sleep -Milliseconds 350", text)
        self.assertIn("Get-Random -Minimum 6500 -Maximum 7501", text)
        self.assertIn('$status["agentVersion"] = $AgentVersion', text)
        self.assertIn('$status["agentManageNo"] = $AgentManageNo', text)
        self.assertIn("2026.09.14-msearch-block-evidence", release)
        self.assertIn("20260914-0114", release)


if __name__ == "__main__":
    unittest.main()























