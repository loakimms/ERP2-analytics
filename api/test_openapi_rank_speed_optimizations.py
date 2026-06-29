import unittest
from datetime import date


class TestOpenApiRankSpeedOptimizations(unittest.TestCase):
    def test_prefetch_catalog_id_maps_base_url_variants(self) -> None:
        from db import SessionLocal, TrackedProductMeta, init_db
        from main import _prefetch_catalog_id_by_url

        init_db()

        u_base = "https://smartstore.naver.com/test/products/999000222333"
        u_with_query = u_base + "?NaPm=ct%3Dabc%7Cci%3D0"
        u_scheme_less = "smartstore.naver.com/test/products/999000222333"

        with SessionLocal() as s:
            # TrackedProductMeta.product_url is UNIQUE. Upsert defensively.
            row = s.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == u_base).one_or_none()
            if row is None:
                s.add(TrackedProductMeta(product_url=u_base, product_id_catalog=12345))
            else:
                row.product_id_catalog = 12345
            s.commit()

        m = _prefetch_catalog_id_by_url([u_with_query, u_scheme_less, u_base])
        self.assertEqual(m.get(u_base), "12345")
        self.assertEqual(m.get(u_with_query), "12345")
        self.assertEqual(m.get(u_scheme_less), "12345")

    def test_write_keyword_result_impl_uses_upsert_and_preserves_policies(self) -> None:
        import json

        from db import SessionLocal, TrackedProductRankDaily, init_db
        from main import _write_keyword_result_impl

        init_db()
        d = date(2026, 3, 17)
        u1 = "https://smartstore.naver.com/test/products/999000333444"

        # success: rank=0 should be written
        _write_keyword_result_impl(
            "K1",
            found_rank_by_url={u1: 0},
            had_openapi_error=False,
            product_urls=[u1],
            target_date=d,
        )

        with SessionLocal() as s:
            r = (
                s.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u1,
                    TrackedProductRankDaily.keyword == "K1",
                )
                .one_or_none()
            )
            self.assertIsNotNone(r)
            self.assertEqual(int(r.rank or 0), 0)
            self.assertEqual(str(r.source or ""), "openapi")

        # error: rank=0 should NOT overwrite/create (policy)
        _write_keyword_result_impl(
            "K2",
            found_rank_by_url={u1: 0},
            had_openapi_error=True,
            product_urls=[u1],
            target_date=d,
        )
        with SessionLocal() as s:
            r2 = (
                s.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u1,
                    TrackedProductRankDaily.keyword == "K2",
                )
                .one_or_none()
            )
            self.assertIsNone(r2)


if __name__ == "__main__":
    unittest.main()

