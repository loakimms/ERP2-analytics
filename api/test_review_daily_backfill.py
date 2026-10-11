import unittest
from datetime import date

import main


class _FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)
        self.filters = []

    def filter(self, *args):
        self.filters.extend(args)
        return self

    def distinct(self):
        return self

    def order_by(self, *args):
        return self

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self, *, active_urls, page_rows):
        self.keyword_query = _FakeQuery([(url,) for url in active_urls])
        self.page_query = _FakeQuery(page_rows)

    def query(self, model):
        if model is main.TrackedProductPageDaily:
            return self.page_query
        return self.keyword_query


class ReviewDailyBackfillTest(unittest.TestCase):
    def test_backfill_skips_when_page_rows_have_no_review_metrics_source(self):
        db = _FakeSession(
            active_urls=["https://smartstore.naver.com/store/products/1"],
            page_rows=[],
        )

        out = main._backfill_review_daily_from_page_metrics(
            db,
            days=7,
            date_to=date(2026, 10, 7),
        )

        self.assertTrue(out["ok"])
        self.assertEqual(out["status"], "SKIPPED")
        self.assertEqual(out["reason"], "no_source_review_metrics")
        self.assertEqual(out["source_rows"], 0)
        self.assertEqual(out["saved"], 0)
        self.assertEqual(out["skipped"], 0)

        rendered_filters = "\n".join(str(item) for item in db.page_query.filters)
        self.assertIn("tracked_product_page_daily.rating IS NOT NULL", rendered_filters)
        self.assertIn("tracked_product_page_daily.review_count IS NOT NULL", rendered_filters)


class _MirrorQuery:
    def __init__(self, *, one=None, rows=None):
        self._one = one
        self._rows = list(rows or [])

    def filter(self, *args):
        return self

    def order_by(self, *args):
        return self

    def limit(self, *args):
        return self

    def one_or_none(self):
        return self._one

    def all(self):
        return list(self._rows)


class _MirrorSession:
    def __init__(self, *, meta, rank_row, keywords):
        self.meta = meta
        self.rank_row = rank_row
        self.keywords = keywords

    def query(self, *entities):
        first = entities[0]
        if first is main.TrackedProductMeta:
            return _MirrorQuery(one=self.meta)
        if first is main.NaverProductRankDaily.nv_mid:
            return _MirrorQuery(one=self.rank_row)
        return _MirrorQuery(rows=[(kw,) for kw in self.keywords])


class _Meta:
    product_id_catalog = None
    keyword = "fallback-keyword"
    title = "product"
    mall_name = "store"


class MirrorCatalogFallbackTest(unittest.TestCase):
    def _run_mirror(self, db):
        calls = []
        original = main.upsert_product_reviews_for_keyword
        main.upsert_product_reviews_for_keyword = lambda **kwargs: calls.append(kwargs)
        try:
            written = main._mirror_page_metrics_into_review_daily(
                db,
                target_date="2026-10-08",
                product_url="https://smartstore.naver.com/store/products/9793965623",
                rating=4.75,
                review_count=515,
            )
        finally:
            main.upsert_product_reviews_for_keyword = original
        return written, calls

    def test_uses_rank_nv_mid_when_meta_catalog_missing(self):
        meta = _Meta()
        db = _MirrorSession(meta=meta, rank_row=(87338467896,), keywords=["kw1", "kw2"])

        written, calls = self._run_mirror(db)

        self.assertEqual(written, 2)
        self.assertEqual(meta.product_id_catalog, 87338467896)
        self.assertEqual({c["product_id"] for c in calls}, {87338467896})
        self.assertEqual([c["keyword"] for c in calls], ["kw1", "kw2"])

    def test_skips_when_no_catalog_anywhere(self):
        meta = _Meta()
        db = _MirrorSession(meta=meta, rank_row=None, keywords=["kw1"])

        written, calls = self._run_mirror(db)

        self.assertEqual(written, 0)
        self.assertEqual(calls, [])
        self.assertIsNone(meta.product_id_catalog)


if __name__ == "__main__":
    unittest.main()
