import unittest
from datetime import date, datetime

import main


class TestAdRankRetryIncomplete(unittest.TestCase):
    def test_wants_retry_from_flag_and_mode(self):
        self.assertFalse(main._collection_wants_ad_rank_retry_incomplete(None))
        self.assertFalse(main._collection_wants_ad_rank_retry_incomplete(main.CollectionRunPayload(mode="manual")))
        self.assertTrue(main._collection_wants_ad_rank_retry_incomplete(main.CollectionRunPayload(retry_incomplete=True)))
        self.assertTrue(main._collection_wants_ad_rank_retry_incomplete(main.CollectionRunPayload(mode="retry_incomplete")))
        self.assertTrue(main._collection_wants_ad_rank_retry_incomplete(main.CollectionRunPayload(mode="retry")))

    def test_expected_keys_from_plan(self):
        plan = {
            "products": [{"product_url": "https://smartstore.naver.com/a/products/1"}],
            "keywords": ["무선이어폰", "블루투스이어폰"],
            "conditions": [
                {"gender": "female", "age_band": "35-39", "placement": "mobile-shopping"},
                {"gender": "female", "age_band": "35-39", "placement": "pc-shopping"},
            ],
        }
        keys = main._ad_rank_expected_keys_from_plan(plan, date(2026, 8, 4))
        self.assertEqual(len(keys), 4)

    def test_group_incomplete_into_units(self):
        products_by_url = {
            "https://p/1": {"product_url": "https://p/1", "name": "A", "match_names": ["A"]},
            "https://p/2": {"product_url": "https://p/2", "name": "B", "match_names": ["B"]},
            "https://p/3": {"product_url": "https://p/3", "name": "C", "match_names": ["C"]},
        }
        conditions_by_key = {
            ("female", "35-39", "mobile-shopping"): {
                "condition_id": "female:35-39:mobile-shopping",
                "gender": "female",
                "age_band": "35-39",
                "placement": "mobile-shopping",
                "target_rank": 20,
            }
        }
        incomplete = [
            {
                "product_url": "https://p/1",
                "keyword": "무선이어폰",
                "gender": "female",
                "age_band": "35-39",
                "placement": "mobile-shopping",
                "reason": "failed",
            },
            {
                "product_url": "https://p/2",
                "keyword": "무선이어폰",
                "gender": "female",
                "age_band": "35-39",
                "placement": "mobile-shopping",
                "reason": "failed",
            },
            {
                "product_url": "https://p/3",
                "keyword": "블루투스이어폰",
                "gender": "female",
                "age_band": "35-39",
                "placement": "mobile-shopping",
                "reason": "missing",
            },
        ]
        units = main._ad_rank_group_incomplete_into_units(
            incomplete,
            products_by_url=products_by_url,
            conditions_by_key=conditions_by_key,
        )
        self.assertEqual(len(units), 2)
        by_keyword = {u["keyword"]: u for u in units}
        self.assertEqual(len(by_keyword["무선이어폰"]["products"]), 2)
        self.assertEqual(len(by_keyword["블루투스이어폰"]["products"]), 1)
        self.assertEqual(
            by_keyword["무선이어폰"]["condition"]["condition_id"],
            "female:35-39:mobile-shopping",
        )

    def test_ad_rank_collection_keywords_use_representative_henna_sku(self):
        products = [
            {"product_url": "https://p/henna-1", "name": "수자타 헤나 염색약 가루 1개", "match_names": []},
            {"product_url": "https://p/henna-2", "name": "수자타 헤나 염색약 가루 2개", "match_names": []},
            {"product_url": "https://p/henna-5", "name": "수자타 헤나 염색약 가루 5개", "match_names": []},
            {"product_url": "https://p/henna-11", "name": "수자타 헤나 염색약 가루 11개", "match_names": []},
            {"product_url": "https://p/oil", "name": "수자타 호호바오일", "match_names": []},
        ]
        keywords_by_url = {
            "https://p/henna-1": ["헤나", "헤나염색", "헤나염색약"],
            "https://p/henna-2": ["새치염색"],
            "https://p/henna-5": ["헤나", "천연헤나"],
            "https://p/henna-11": ["염색약"],
            "https://p/oil": ["호호바오일"],
        }
        keywords, meta = main._ad_rank_keywords_for_collection_plan(products, keywords_by_url)
        self.assertEqual(keywords, ["헤나", "헤나염색", "헤나염색약"])
        self.assertEqual(meta["representative_product_url"], "https://p/henna-1")
        self.assertEqual(meta["representative_package_count"], 1)
        self.assertEqual(meta["henna_variant_product_count"], 4)

    def test_ad_rank_representative_henna_sku_prefers_more_keywords_between_one_and_five(self):
        products = [
            {"product_url": "https://p/henna-1", "name": "수자타 헤나 염색약 가루 1개", "match_names": []},
            {"product_url": "https://p/henna-5", "name": "수자타 헤나 염색약 가루 5개", "match_names": []},
        ]
        keywords_by_url = {
            "https://p/henna-1": ["헤나"],
            "https://p/henna-5": ["헤나", "천연헤나", "헤나염색약"],
        }
        keywords, meta = main._ad_rank_keywords_for_collection_plan(products, keywords_by_url)
        self.assertEqual(keywords, ["천연헤나", "헤나", "헤나염색약"])
        self.assertEqual(meta["representative_product_url"], "https://p/henna-5")
        self.assertEqual(meta["representative_package_count"], 5)

    def test_ad_rank_default_collection_dates_use_today(self):
        payload = main.CollectionRunPayload(mode="manual")
        today = main._today_kst()
        self.assertEqual(main._collection_effective_target_for_task("ad_rank_diagnosis_cdp", payload), today)
        self.assertEqual(main._collection_effective_range_for_task("ad_rank_diagnosis_cdp", payload), (today, today))

    def test_keyword_volume_persistence_uses_kst_updated_at_date(self):
        expr = main._collection_table_date_expr("tracked_product_manual_keyword", "updated_at")
        self.assertEqual(expr, "(updated_at at time zone 'Asia/Seoul')::date")
        self.assertEqual(main._collection_table_date_expr("tracked_product_rank_daily", "date"), "date::date")

    def test_clear_ad_rank_rows_for_fresh_start_deletes_target_date_only(self):
        class DeleteQuery:
            def __init__(self):
                self.filter_called = False
                self.deleted = False

            def filter(self, *args, **kwargs):
                self.filter_called = True
                return self

            def delete(self, synchronize_session=False):
                self.deleted = True
                self.synchronize_session = synchronize_session
                return 12

        class Db:
            def __init__(self):
                self.query_obj = DeleteQuery()
                self.committed = False
                self.model = None

            def query(self, model):
                self.model = model
                return self.query_obj

            def commit(self):
                self.committed = True

        db = Db()
        deleted = main._clear_ad_rank_diagnosis_rows_for_fresh_start(db, date(2026, 9, 8))

        self.assertEqual(deleted, 12)
        self.assertIs(db.model, main.AdRankDiagnosisDaily)
        self.assertTrue(db.query_obj.filter_called)
        self.assertTrue(db.query_obj.deleted)
        self.assertFalse(db.query_obj.synchronize_session)
        self.assertTrue(db.committed)

    def test_ad_rank_default_presets_cover_full_age_bands(self):
        age_bands = {row[2] for row in main.AD_RANK_DEFAULT_PRESETS}
        self.assertEqual(age_bands, {"30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60+", "unknown"})
        expected_count = (
            len(main.AD_RANK_DIAGNOSIS_GENDERS)
            * len(main.AD_RANK_DIAGNOSIS_AGE_BANDS)
            * len(main.AD_RANK_DIAGNOSIS_PLACEMENTS)
        )
        self.assertEqual(len(main.AD_RANK_DEFAULT_PRESETS), expected_count)
        self.assertIn(("female:60+:mobile-shopping", "female", "60+", "mobile-shopping", "core"), main.AD_RANK_DEFAULT_PRESETS)
        self.assertIn(("female:unknown:mobile-shopping", "female", "unknown", "mobile-shopping", "core"), main.AD_RANK_DEFAULT_PRESETS)
        self.assertIn(("male:50-54:pc-search", "male", "50-54", "pc-search", "core"), main.AD_RANK_DEFAULT_PRESETS)
        self.assertNotIn(("female:25-29:mobile-shopping", "female", "25-29", "mobile-shopping", "core"), main.AD_RANK_DEFAULT_PRESETS)

    def test_ad_rank_completion_summary_uses_collection_plan_keywords(self):
        class EmptyQuery:
            def filter(self, *args, **kwargs):
                return self

            def all(self):
                return []

        class EmptyDb:
            def query(self, *args, **kwargs):
                return EmptyQuery()

        original = main._ad_rank_collection_plan
        try:
            main._ad_rank_collection_plan = lambda db: {
                "products": [
                    {"product_url": "https://p/1"},
                    {"product_url": "https://p/2"},
                ],
                "keywords": ["대표키워드"],
                "conditions": [
                    {"gender": "female", "age_band": "35-39", "placement": "mobile-search"},
                    {"gender": "female", "age_band": "35-39", "placement": "pc-search"},
                ],
            }
            summary = main._ad_rank_diagnosis_completion_summary(EmptyDb(), date(2026, 8, 16), date(2026, 8, 16))
        finally:
            main._ad_rank_collection_plan = original

        self.assertEqual(summary["ad_rank_expected_search_units"], 2)
        self.assertEqual(summary["ad_rank_expected_cells"], 4)
        self.assertEqual(summary["ad_rank_plan_keyword_count"], 1)
        self.assertEqual(summary["ad_rank_plan_condition_count"], 2)

    def test_ad_rank_serialized_job_refreshes_stale_persistence(self):
        class Row:
            job_id = "job-1"
            task_id = "ad_rank_diagnosis_cdp"
            run_mode = "manual"
            source_type = "host_cdp"
            status = "PARTIAL"
            target_date = date(2026, 8, 15)
            date_from = date(2026, 8, 15)
            date_to = date(2026, 8, 15)
            rows_written = 0
            detail_json = main._collection_json_dumps(
                {
                    "collector_job": {"job_id": "pmc-1", "target_date": "2026-08-16"},
                    "db_persistence": {"ad_rank_expected_search_units": 264},
                }
            )
            error = "ad_rank_search_units_incomplete=168/264,failed=0,missing=96"
            started_at = datetime(2026, 8, 16, 0, 0, 0)
            finished_at = datetime(2026, 8, 16, 0, 5, 0)

        original_summary = main._collection_persistence_summary
        original_apply = main._collection_apply_persistence_status
        try:
            main._collection_persistence_summary = lambda db, task_id, d0, d1: {
                "ad_rank_expected_search_units": 168,
                "ad_rank_ok_search_units": 72,
                "ad_rank_failed_search_units": 5,
                "ad_rank_missing_search_units": 91,
            }
            main._collection_apply_persistence_status = lambda task_id, status, rows, persisted: (
                "PARTIAL",
                "ad_rank_search_units_incomplete=72/168,failed=5,missing=91",
            )
            out = main._collection_serialize_ad_rank_job_with_current_persistence(None, Row())
        finally:
            main._collection_persistence_summary = original_summary
            main._collection_apply_persistence_status = original_apply

        self.assertEqual(out["target_date"], "2026-08-16")
        self.assertEqual(out["date_from"], "2026-08-16")
        self.assertEqual(out["error"], "ad_rank_search_units_incomplete=72/168,failed=5,missing=91")
        self.assertEqual(out["detail"]["db_persistence"]["ad_rank_expected_search_units"], 168)

    def test_ordered_search_units_match_collector_left_to_right_sequence(self):
        plan = {
            "products": [{"product_url": "https://p/1"}],
            "keywords": ["대표키워드"],
            "conditions": [
                {"gender": "female", "age_band": "40-44", "placement": "pc-shopping"},
                {"gender": "female", "age_band": "40-44", "placement": "mobile-shopping"},
                {"gender": "female", "age_band": "40-44", "placement": "pc-search"},
                {"gender": "female", "age_band": "40-44", "placement": "mobile-search"},
            ],
        }
        units = main._ad_rank_ordered_search_units_from_plan(plan)
        self.assertEqual(
            [unit["condition"]["placement"] for unit in units],
            ["mobile-search", "pc-search", "mobile-shopping", "pc-shopping"],
        )


if __name__ == "__main__":
    unittest.main()
