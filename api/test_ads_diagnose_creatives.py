import unittest


class DiagnoseCreativesCoreTest(unittest.TestCase):
    def test_stage_detects_ncc_ads_incomplete(self) -> None:
        from main import _diagnose_creatives_stage

        st = _diagnose_creatives_stage(expected_cnt=0, stored_cnt=10, served_cnt=10, limit=5000)
        self.assertEqual(st["stage"], "ncc_ads_incomplete_or_unavailable")

    def test_stage_detects_collector_missing(self) -> None:
        from main import _diagnose_creatives_stage

        st = _diagnose_creatives_stage(expected_cnt=10, stored_cnt=6, served_cnt=6, limit=5000)
        self.assertEqual(st["stage"], "collector_or_upsert_missing")

    def test_stage_detects_api_truncation(self) -> None:
        from main import _diagnose_creatives_stage

        st = _diagnose_creatives_stage(expected_cnt=2000, stored_cnt=2000, served_cnt=1000, limit=1000)
        self.assertEqual(st["stage"], "api_limit_truncation_possible")

    def test_stage_detects_ok(self) -> None:
        from main import _diagnose_creatives_stage

        st = _diagnose_creatives_stage(expected_cnt=4, stored_cnt=4, served_cnt=4, limit=5000)
        self.assertEqual(st["stage"], "ok")

