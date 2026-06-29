import unittest
from datetime import date

from main import build_product_comparison_history
from schemas import ComparisonHistory, ProductRankPoint


class DummyRow:
    def __init__(
        self,
        d: date,
        keyword: str,
        rank: int,
        is_our_brand: bool,
        product_title: str,
        mall_name: str,
    ):
        self.date = d
        self.keyword = keyword
        self.rank = rank
        self.is_our_brand = is_our_brand
        self.product_title = product_title
        self.mall_name = mall_name


class DummyCompetitor:
    def __init__(self, name: str, match_text: str):
        self.name = name
        self.match_text = match_text


class ProductComparisonHistoryTest(unittest.TestCase):
    def test_build_product_comparison_history(self) -> None:
        # given
        rows = [
            DummyRow(date(2025, 12, 9), "헤나 염색약", 3, True, "우리 헤나 염색약", "우리몰"),
            DummyRow(date(2025, 12, 10), "헤나 염색약", 1, True, "우리 헤나 염색약", "우리몰"),
            DummyRow(date(2025, 12, 9), "헤나 염색약", 5, False, "브랜드A 염색약", "브랜드A몰"),
            DummyRow(date(2025, 12, 10), "헤나 염색약", 2, False, "브랜드A 염색약", "브랜드A몰"),
            DummyRow(date(2025, 12, 10), "헤나 염색약", 4, False, "기타상품", "기타몰"),
        ]
        competitors = [DummyCompetitor("브랜드A", "브랜드A")]

        # when
        history: ComparisonHistory = build_product_comparison_history(
            rows,  # type: ignore[arg-type]
            competitors,  # type: ignore[arg-type]
            our_label="우리 상품",
        )

        # then
        self.assertEqual(history.dates, [date(2025, 12, 9), date(2025, 12, 10)])
        self.assertEqual(len(history.products), 2)

        labels = {p.label for p in history.products}
        self.assertEqual(labels, {"우리 상품", "브랜드A"})

        series_map = {p.label: p for p in history.products}
        our_series = series_map["우리 상품"]
        comp_series = series_map["브랜드A"]

        self.assertEqual(
            [(p.date, p.rank) for p in our_series.series],
            [(date(2025, 12, 9), 3), (date(2025, 12, 10), 1)],
        )
        self.assertEqual(
            [(p.date, p.rank) for p in comp_series.series],
            [(date(2025, 12, 9), 5), (date(2025, 12, 10), 2)],
        )


if __name__ == "__main__":
    unittest.main()


