import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from db import SessionLocal, AnalyticsJobRun, TrackedProductRankDaily, TrackedProductMeta
from main import _run_openapi_rank_job, _today_kst


class TestOpenApiRankCrawl(unittest.TestCase):
    def test_openapi_crawl_saves_rank_and_marks_success(self) -> None:
        jid = "openapi1"
        job_name = "openapi-job-1"
        d = _today_kst()
        product_url = "https://smartstore.naver.com/test/products/999000111222"

        def fake_get(url, params=None, headers=None, timeout=None):  # noqa: ARG001
            # display=40, start=1 호출
            items = []
            for i in range(40):
                link = f"https://smartstore.naver.com/other/products/{100 + i}"
                items.append({"title": f"P{i}", "link": link})
            # 5번째(인덱스 4)에 타겟 상품 링크 삽입 => rank=5
            items[4]["link"] = product_url
            return SimpleNamespace(status_code=200, json=lambda: {"items": items})

        with patch.dict("os.environ", {"NAVER_SEARCH_CLIENT_ID": "x", "NAVER_SEARCH_CLIENT_SECRET": "y"}):
            with patch("main._openapi_http_get", side_effect=fake_get):
                _run_openapi_rank_job(
                    job_id=jid,
                    job_name=job_name,
                    seed_product_url=product_url,
                    product_urls=[product_url],
                    keywords=["K1"],
                    target_date=d,
                    limit=40,
                )

        with SessionLocal() as s:
            row = s.query(AnalyticsJobRun).filter(AnalyticsJobRun.job_name == job_name, AnalyticsJobRun.run_date == d).one_or_none()
            self.assertIsNotNone(row)
            self.assertEqual(row.status, "SUCCESS")
            detail = json.loads(row.detail or "{}")
            self.assertEqual(detail.get("method"), "openapi")

            r = (
                s.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == product_url,
                    TrackedProductRankDaily.keyword == "K1",
                    TrackedProductRankDaily.source == "openapi",
                )
                .one_or_none()
            )
            self.assertIsNotNone(r)
            self.assertEqual(int(r.rank or 0), 5)

    def test_openapi_crawl_supports_paging_to_find_rank_over_100(self) -> None:
        jid = "openapi2"
        job_name = "openapi-job-2"
        d = _today_kst()
        product_url = "https://smartstore.naver.com/test/products/999000111333"

        def fake_get(url, params=None, headers=None, timeout=None):  # noqa: ARG001
            st = int((params or {}).get("start") or 1)
            dp = int((params or {}).get("display") or 100)
            items = []
            for i in range(dp):
                link = f"https://smartstore.naver.com/other/products/{st + i}"
                items.append({"title": f"P{st+i}", "link": link})
            # start=101일 때 5번째(인덱스 4)에 타겟 => global rank=105
            if st == 101:
                items[4]["link"] = product_url
            return SimpleNamespace(status_code=200, json=lambda: {"items": items})

        with patch.dict("os.environ", {"NAVER_SEARCH_CLIENT_ID": "x", "NAVER_SEARCH_CLIENT_SECRET": "y"}):
            with patch("main._openapi_http_get", side_effect=fake_get):
                _run_openapi_rank_job(
                    job_id=jid,
                    job_name=job_name,
                    seed_product_url=product_url,
                    product_urls=[product_url],
                    keywords=["K1"],
                    target_date=d,
                    limit=120,
                )

        with SessionLocal() as s:
            r = (
                s.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == product_url,
                    TrackedProductRankDaily.keyword == "K1",
                    TrackedProductRankDaily.source == "openapi",
                )
                .one_or_none()
            )
            self.assertIsNotNone(r)
            self.assertEqual(int(r.rank or 0), 105)

    def test_openapi_crawl_matches_catalog_id_when_link_is_not_smartstore(self) -> None:
        jid = "openapi3"
        job_name = "openapi-job-3"
        d = _today_kst()
        product_url = "https://smartstore.naver.com/test/products/999000111444"
        catalog_id = 1234567890

        # 메타에 catalog id 저장 (OpenAPI item.productId와 매칭)
        with SessionLocal() as s:
            # TrackedProductMeta는 product_url UNIQUE 제약이 있으므로, 테스트 간 잔존 데이터를 고려해 upsert를 수동으로 수행한다.
            existing = s.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == product_url).one_or_none()
            if existing is None:
                s.add(
                    TrackedProductMeta(
                        product_url=product_url,
                        keyword="K1",
                        title="T",
                        mall_name="M",
                        image_url=None,
                        price=None,
                        product_id_catalog=int(catalog_id),
                    )
                )
            else:
                existing.keyword = "K1"
                existing.title = "T"
                existing.mall_name = "M"
                existing.image_url = None
                existing.price = None
                existing.product_id_catalog = int(catalog_id)
            s.commit()

        def fake_get(url, params=None, headers=None, timeout=None):  # noqa: ARG001
            items = []
            for i in range(40):
                # link가 smartstore가 아니어도 productId(catalog)가 있으면 매칭되어야 한다.
                items.append({"title": f"P{i}", "link": f"https://search.shopping.naver.com/catalog/{1000+i}", "productId": 1000 + i})
            # 8번째(인덱스 7)에 타겟 catalog 삽입 => rank=8
            items[7]["productId"] = catalog_id
            return SimpleNamespace(status_code=200, json=lambda: {"items": items})

        with patch.dict("os.environ", {"NAVER_SEARCH_CLIENT_ID": "x", "NAVER_SEARCH_CLIENT_SECRET": "y"}):
            with patch("main._openapi_http_get", side_effect=fake_get):
                _run_openapi_rank_job(
                    job_id=jid,
                    job_name=job_name,
                    seed_product_url=product_url,
                    product_urls=[product_url],
                    keywords=["K1"],
                    target_date=d,
                    limit=40,
                )

        with SessionLocal() as s:
            r = (
                s.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == product_url,
                    TrackedProductRankDaily.keyword == "K1",
                    TrackedProductRankDaily.source == "openapi",
                )
                .one_or_none()
            )
            self.assertIsNotNone(r)
            self.assertEqual(int(r.rank or 0), 8)

    def test_openapi_crawl_marks_partial_when_some_keywords_hit_429(self) -> None:
        jid = "openapi-partial-429"
        job_name = "openapi-job-partial-429"
        d = _today_kst()
        product_url = "https://smartstore.naver.com/test/products/999000111555"

        def fake_get(url, params=None, headers=None, timeout=None):  # noqa: ARG001
            q = str((params or {}).get("query") or "").strip()
            if q == "K_ERR":
                # rate limit
                return SimpleNamespace(status_code=429, json=lambda: {"items": []})
            # success keyword: rank=1
            items = [{"title": "P0", "link": product_url}]
            return SimpleNamespace(status_code=200, json=lambda: {"items": items})

        # retry가 기본으로 켜져 있어도 이 테스트는 "429는 PARTIAL"을 고정해야 하므로,
        # 재시도 횟수를 1로 제한한다.
        with patch.dict(
            "os.environ",
            {
                "NAVER_SEARCH_CLIENT_ID": "x",
                "NAVER_SEARCH_CLIENT_SECRET": "y",
                "OPENAPI_RANK_RETRY_MAX": "1",
            },
        ):
            with patch("main._openapi_http_get", side_effect=fake_get):
                _run_openapi_rank_job(
                    job_id=jid,
                    job_name=job_name,
                    seed_product_url=product_url,
                    product_urls=[product_url],
                    keywords=["K_OK", "K_ERR"],
                    target_date=d,
                    limit=40,
                )

        with SessionLocal() as s:
            row = s.query(AnalyticsJobRun).filter(AnalyticsJobRun.job_name == job_name, AnalyticsJobRun.run_date == d).one_or_none()
            self.assertIsNotNone(row)
            # 일부 키워드가 429(OpenAPI error)이면 SUCCESS가 아니라 PARTIAL이어야 한다.
            self.assertEqual(row.status, "PARTIAL")
            detail = json.loads(row.detail or "{}")
            self.assertEqual(detail.get("method"), "openapi")
            self.assertEqual(int(detail.get("openapi_error_keywords") or 0), 1)

            ok_row = (
                s.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == product_url,
                    TrackedProductRankDaily.keyword == "K_OK",
                    TrackedProductRankDaily.source == "openapi",
                )
                .one_or_none()
            )
            self.assertIsNotNone(ok_row)
            self.assertEqual(int(ok_row.rank or 0), 1)

            err_row = (
                s.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.date == d,
                    TrackedProductRankDaily.product_url == product_url,
                    TrackedProductRankDaily.keyword == "K_ERR",
                    TrackedProductRankDaily.source == "openapi",
                )
                .one_or_none()
            )
            # OpenAPI error(429)로 rank==0을 저장하지 않는 정책이므로 행 자체가 없을 수 있다.
            self.assertIsNone(err_row)


if __name__ == "__main__":
    unittest.main()

