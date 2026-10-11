import unittest
from datetime import date

from sku_identity import build_sku_identity, canonicalize_product_url, product_id_from_url, validate_identity_join


class TestSkuIdentity(unittest.TestCase):
    def test_canonicalizes_smartstore_url_and_extracts_product_id(self) -> None:
        url = "https://smartstore.naver.com/test/products/11043833896?x=1#frag"

        self.assertEqual(canonicalize_product_url(url), "https://smartstore.naver.com/test/products/11043833896")
        self.assertEqual(product_id_from_url(url), "11043833896")

    def test_allows_valid_p01_bind(self) -> None:
        expected = build_sku_identity(
            sku_id="P01",
            product_url="https://smartstore.naver.com/test/products/1?x=1",
            product_id_catalog=1001,
        )
        actual = build_sku_identity(
            sku_id="P01",
            product_url="https://smartstore.naver.com/test/products/1",
            product_id_catalog=1001,
        )

        result = validate_identity_join(
            expected,
            actual,
            domain="organic",
            date_from=date(2026, 4, 1),
            date_to=date(2026, 4, 7),
            lineage="tracked_product_rank_daily",
        )

        self.assertTrue(result.allowed)
        self.assertEqual(result.code, "PASS")

    def test_rejects_mismatched_sku_and_missing_lineage(self) -> None:
        expected = build_sku_identity(sku_id="P01", product_url="https://smartstore.naver.com/test/products/1")
        actual = build_sku_identity(sku_id="P02", product_url="https://smartstore.naver.com/test/products/1")

        missing_lineage = validate_identity_join(
            expected,
            actual,
            domain="sales",
            date_from=date(2026, 4, 1),
            date_to=date(2026, 4, 7),
            lineage="",
        )
        self.assertFalse(missing_lineage.allowed)
        self.assertEqual(missing_lineage.code, "MISSING_LINEAGE")

        mismatch = validate_identity_join(
            expected,
            actual,
            domain="sales",
            date_from=date(2026, 4, 1),
            date_to=date(2026, 4, 7),
            lineage="sales_daily",
        )
        self.assertFalse(mismatch.allowed)
        self.assertEqual(mismatch.code, "SKU_MISMATCH")

    def test_rejects_invalid_date_window(self) -> None:
        identity = build_sku_identity(sku_id="P01")
        result = validate_identity_join(
            identity,
            identity,
            domain="sales",
            date_from=date(2026, 4, 8),
            date_to=date(2026, 4, 7),
            lineage="sales_daily",
        )

        self.assertFalse(result.allowed)
        self.assertEqual(result.code, "INVALID_DATE_WINDOW")


if __name__ == "__main__":
    unittest.main()

