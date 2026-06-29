import unittest
from datetime import date

from main import build_tracked_rank_history
from schemas import ProductRankHistory


class DummyTrackedRankRow:
    def __init__(self, d: date, product_url: str, keyword: str, rank: int):
        self.date = d
        self.product_url = product_url
        self.keyword = keyword
        self.rank = rank


class RankHistoryPreferUploadedTest(unittest.TestCase):
    def test_build_tracked_rank_history_groups_by_keyword_and_date(self) -> None:
        rows = [
            DummyTrackedRankRow(date(2026, 1, 10), "u", "새치염색", 9),
            DummyTrackedRankRow(date(2026, 1, 11), "u", "새치염색", 6),
            DummyTrackedRankRow(date(2026, 1, 11), "u", "천연염색", 1),
        ]

        history: ProductRankHistory = build_tracked_rank_history(rows)  # type: ignore[arg-type]
        self.assertEqual(history.dates, [date(2026, 1, 10), date(2026, 1, 11)])
        kw = {s.keyword for s in history.series}
        self.assertEqual(kw, {"새치염색", "천연염색"})


if __name__ == "__main__":
    unittest.main()

