import unittest
from datetime import date

from main import build_merged_rank_history


class _TrackedRow:
    def __init__(self, d: date, keyword: str, rank: int):
        self.date = d
        self.keyword = keyword
        self.rank = rank


class _OpenApiRow:
    def __init__(self, d: date, keyword: str, rank: int):
        self.date = d
        self.keyword = keyword
        self.rank = rank


class RankHistoryMergeTest(unittest.TestCase):
    def test_merge_prefers_tracked_but_fills_missing_dates_from_openapi(self) -> None:
        # given
        # - OpenAPI: 01/11, 01/12 데이터가 존재
        # - Tracked(엑셀): 01/10, 01/11만 존재(01/12 없음) + 01/11은 공식값으로 override
        openapi = [
            _OpenApiRow(date(2026, 1, 11), "새치염색", 10),
            _OpenApiRow(date(2026, 1, 12), "새치염색", 9),
        ]
        tracked = [
            _TrackedRow(date(2026, 1, 10), "새치염색", 8),
            _TrackedRow(date(2026, 1, 11), "새치염색", 6),
        ]

        # when
        history = build_merged_rank_history(tracked_rows=tracked, openapi_rows=openapi)  # type: ignore[arg-type]

        # then: 날짜는 합집합(오름차순)
        self.assertEqual(history.dates, [date(2026, 1, 10), date(2026, 1, 11), date(2026, 1, 12)])
        self.assertEqual(len(history.series), 1)
        s = history.series[0]
        self.assertEqual(s.keyword, "새치염색")
        # 01/11은 tracked 값(6)이 우선, 01/12는 openapi 값(9)로 채워짐
        self.assertEqual([(p.date, p.rank) for p in s.series], [(date(2026, 1, 10), 8), (date(2026, 1, 11), 6), (date(2026, 1, 12), 9)])


if __name__ == "__main__":
    unittest.main()

