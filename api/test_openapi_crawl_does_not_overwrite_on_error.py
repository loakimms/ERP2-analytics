import os
import unittest
from datetime import date

from db import SessionLocal, TrackedProductRankDaily
import main


class OpenApiCrawlErrorDoesNotOverwriteTest(unittest.TestCase):
    def test_openapi_error_must_not_overwrite_existing_positive_rank_with_zero(self) -> None:
        # Arrange
        old_id = os.environ.get("NAVER_SEARCH_CLIENT_ID")
        old_secret = os.environ.get("NAVER_SEARCH_CLIENT_SECRET")
        os.environ["NAVER_SEARCH_CLIENT_ID"] = "test"
        os.environ["NAVER_SEARCH_CLIENT_SECRET"] = "test"

        db = SessionLocal()
        d = date.today()
        u = "https://smartstore.naver.com/test/products/11043833896"
        kw = "HENNA"
        try:
            # 기존에 양수 rank가 저장되어 있는 상황을 만든다.
            db.merge(TrackedProductRankDaily(date=d, product_url=u, keyword=kw, rank=9, source="openapi"))
            db.commit()

            # OpenAPI fetch가 실패(예: 네트워크/타임아웃)하는 상황을 강제로 재현한다.
            old_fetch = main._openapi_fetch_shop_items
            main._openapi_fetch_shop_items = lambda **kwargs: (None, [])  # type: ignore[assignment]
            try:
                main._run_openapi_rank_job(
                    job_id="testjob",
                    job_name="category-crawl:testjob",
                    seed_product_url=u,
                    product_urls=[u],
                    keywords=[kw],
                    target_date=d,
                    limit=120,
                )
            finally:
                main._openapi_fetch_shop_items = old_fetch  # type: ignore[assignment]

            # Assert: 기존 rank=9가 0으로 덮여쓰이면 안 된다.
            row = (
                db.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u,
                    TrackedProductRankDaily.keyword == kw,
                )
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertEqual(int(row.rank), 9)
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u,
                    TrackedProductRankDaily.keyword == kw,
                ).delete()
                db.commit()
            except Exception:
                pass
            db.close()
            # env 복원
            if old_id is None:
                os.environ.pop("NAVER_SEARCH_CLIENT_ID", None)
            else:
                os.environ["NAVER_SEARCH_CLIENT_ID"] = old_id
            if old_secret is None:
                os.environ.pop("NAVER_SEARCH_CLIENT_SECRET", None)
            else:
                os.environ["NAVER_SEARCH_CLIENT_SECRET"] = old_secret

    def test_openapi_success_must_not_overwrite_existing_excel_rank(self) -> None:
        db = SessionLocal()
        d = date.today()
        u = "https://smartstore.naver.com/test/products/11043833896"
        kw = "HENNA_EXCEL_PRIORITY"
        try:
            db.merge(TrackedProductRankDaily(date=d, product_url=u, keyword=kw, rank=12, source="excel"))
            db.commit()

            saved = main._write_keyword_result_impl(
                kw0=kw,
                found_rank_by_url={u: 3},
                had_openapi_error=False,
                product_urls=[u],
                target_date=d,
            )
            self.assertEqual(saved, 1)

            row = (
                db.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u,
                    TrackedProductRankDaily.keyword == kw,
                )
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertEqual(int(row.rank), 12)
            self.assertEqual(str(row.source), "excel")
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u,
                    TrackedProductRankDaily.keyword == kw,
                ).delete()
                db.commit()
            except Exception:
                pass
            db.close()

    def test_openapi_success_must_not_overwrite_excel_zero_rank(self) -> None:
        db = SessionLocal()
        d = date.today()
        u = "https://smartstore.naver.com/test/products/11043833896"
        kw = "HENNA_EXCEL_OUT_OF_RANK_PRIORITY"
        try:
            db.merge(TrackedProductRankDaily(date=d, product_url=u, keyword=kw, rank=0, source="excel"))
            db.commit()

            saved = main._write_keyword_result_impl(
                kw0=kw,
                found_rank_by_url={u: 3},
                had_openapi_error=False,
                product_urls=[u],
                target_date=d,
            )
            self.assertEqual(saved, 1)

            row = (
                db.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u,
                    TrackedProductRankDaily.keyword == kw,
                )
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertEqual(int(row.rank), 0)
            self.assertEqual(str(row.source), "excel")
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == u,
                    TrackedProductRankDaily.keyword == kw,
                ).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

