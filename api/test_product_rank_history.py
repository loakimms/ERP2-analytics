import unittest
from datetime import date

from schemas import ProductRankHistory, ProductRankPoint, ProductRankSeries
from main import build_product_rank_history


class DummyRankRow:
    """
    DB 없이 순수 함수만 테스트하기 위해 사용하는 단순 행 객체.
    """

    def __init__(self, d: date, keyword: str, rank: int, is_our_brand: bool = True):
        self.date = d
        self.keyword = keyword
        self.rank = rank
        self.is_our_brand = is_our_brand


class ProductRankHistoryTest(unittest.TestCase):
    def test_build_product_rank_history_aggregates_by_keyword_and_date(self):
        # given: 서로 다른 키워드/날짜/순위가 섞여 있고, 일부는 자사 브랜드가 아니다.
        rows = [
            DummyRankRow(date(2025, 12, 9), "헤나 염색약", 3, True),
            DummyRankRow(date(2025, 12, 9), "헤나 염색약", 5, True),  # 같은 날 더 나쁜 순위 → 무시
            DummyRankRow(date(2025, 12, 10), "헤나 염색약", 1, True),
            DummyRankRow(date(2025, 12, 9), "헤나 샴푸", 8, True),
            DummyRankRow(date(2025, 12, 10), "헤나 샴푸", 6, True),
            DummyRankRow(date(2025, 12, 10), "타사키워드", 2, False),  # 자사 브랜드 아님 → 제외
        ]

        # when
        history: ProductRankHistory = build_product_rank_history(rows)

        # then: 날짜 축은 오름차순 정렬, 2일만 포함
        self.assertEqual(history.dates, [date(2025, 12, 9), date(2025, 12, 10)])

        # 키워드별로 시리즈 2개가 있어야 한다.
        self.assertEqual(len(history.series), 2)
        keywords = {s.keyword for s in history.series}
        self.assertEqual(keywords, {"헤나 염색약", "헤나 샴푸"})

        # '헤나 염색약' 시리즈는 각 날짜별 최솟값 순위(3, 1)를 가져야 한다.
        series_map = {s.keyword: s for s in history.series}
        henna_series: ProductRankSeries = series_map["헤나 염색약"]
        self.assertEqual(
            [(p.date, p.rank) for p in henna_series.series],
            [(date(2025, 12, 9), 3), (date(2025, 12, 10), 1)],
        )

        # '헤나 샴푸' 시리즈도 동일 패턴으로 검증
        shampoo_series: ProductRankSeries = series_map["헤나 샴푸"]
        self.assertEqual(
            [(p.date, p.rank) for p in shampoo_series.series],
            [(date(2025, 12, 9), 8), (date(2025, 12, 10), 6)],
        )


if __name__ == "__main__":
    unittest.main()


