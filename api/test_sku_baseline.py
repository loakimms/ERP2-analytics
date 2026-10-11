import unittest
from datetime import date, timedelta

from sku_baseline import four_week_baseline, weekday_baseline


class TestSkuBaseline(unittest.TestCase):
    def test_weekday_baseline_uses_same_weekday_before_target(self) -> None:
        target = date(2026, 4, 29)  # Wednesday
        points = [
            {"date": target - timedelta(days=7), "value": 100},
            {"date": target - timedelta(days=14), "value": 120},
            {"date": target - timedelta(days=1), "value": 999},
        ]

        result = weekday_baseline(points, target_date=target, min_points=2)

        self.assertEqual(result.status, "USABLE")
        self.assertEqual(result.count, 2)
        self.assertEqual(result.value, 110.0)

    def test_four_week_baseline_returns_partial_when_sparse(self) -> None:
        target = date(2026, 4, 29)
        points = [{"date": target - timedelta(days=3), "value": 90}]

        result = four_week_baseline(points, target_date=target, min_points=7)

        self.assertEqual(result.status, "PARTIAL")
        self.assertEqual(result.count, 1)
        self.assertEqual(result.value, 90.0)

    def test_baseline_missing_when_no_points(self) -> None:
        result = four_week_baseline([], target_date=date(2026, 4, 29))

        self.assertEqual(result.status, "MISSING")
        self.assertIsNone(result.value)


if __name__ == "__main__":
    unittest.main()

