import unittest
from datetime import date

from why_health_gate import collection_source_health, evaluate_why_health, source_health


class TestWhyHealthGate(unittest.TestCase):
    def test_collection_source_health_marks_stale_and_usable(self) -> None:
        target = date(2026, 4, 10)

        usable = collection_source_health(
            source_id="sales",
            target_date=target,
            latest_success_date=date(2026, 4, 10),
            freshness_days=1,
        )
        stale = collection_source_health(
            source_id="organic",
            target_date=target,
            latest_success_date=date(2026, 4, 1),
            freshness_days=1,
        )

        self.assertEqual(usable.status, "USABLE")
        self.assertEqual(stale.status, "STALE")

    def test_evaluate_health_allows_partial_but_blocks_required_missing_when_strict(self) -> None:
        result = evaluate_why_health(
            [
                source_health("sales", "USABLE"),
                source_health("review", "MISSING"),
            ],
            require_all=False,
        )
        self.assertTrue(result.usable)
        self.assertEqual(result.status, "PARTIAL")

        strict = evaluate_why_health(
            [
                source_health("sales", "USABLE"),
                source_health("review", "MISSING"),
            ],
            require_all=True,
        )
        self.assertFalse(strict.usable)
        self.assertEqual(strict.status, "BLOCKED")

    def test_no_sources_blocks_why(self) -> None:
        result = evaluate_why_health([])

        self.assertFalse(result.usable)
        self.assertEqual(result.status, "BLOCKED")


if __name__ == "__main__":
    unittest.main()

