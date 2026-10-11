import time
import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

import main
from db import SessionLocal, TrackedProductKeyword, TrackedProductRankDaily


class TrackedKeywordRankLookupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def test_keyword_rank_lookup_returns_recent_ranks_by_registered_product(self) -> None:
        suffix = str(int(time.time()))
        url_a = f"https://smartstore.naver.com/testmall/products/997{suffix}001"
        url_b = f"https://smartstore.naver.com/testmall/products/997{suffix}002"
        keyword = "헤나염색약"
        today = main._today_kst()
        prev = today - timedelta(days=1)

        with SessionLocal() as db:
            for url in (url_a, url_b):
                db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == url).delete(synchronize_session=False)
                db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == url).delete(synchronize_session=False)
            db.commit()
            db.add(TrackedProductKeyword(product_url=url_a, keyword="기존키워드A", is_active=True))
            db.add(TrackedProductKeyword(product_url=url_b, keyword="기존키워드B", is_active=True))
            db.add(TrackedProductRankDaily(product_url=url_a, keyword=keyword, date=prev, rank=7, source="openapi"))
            db.add(TrackedProductRankDaily(product_url=url_a, keyword=keyword, date=today, rank=3, source="excel"))
            db.add(TrackedProductRankDaily(product_url=url_b, keyword=keyword, date=today, rank=11, source="openapi"))
            db.commit()

        res = self.client.get("/search-rank/tracked/keyword-ranks", params={"keyword": keyword, "days": 7})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["keyword"], keyword)
        by_url = {row["product_url"]: row for row in data["items"]}
        self.assertIn(url_a, by_url)
        self.assertIn(url_b, by_url)
        ranks_a = {row["date"]: row["rank"] for row in by_url[url_a]["ranks"]}
        ranks_b = {row["date"]: row["rank"] for row in by_url[url_b]["ranks"]}
        self.assertEqual(ranks_a[today.isoformat()], 3)
        self.assertEqual(ranks_a[prev.isoformat()], 7)
        self.assertEqual(ranks_b[today.isoformat()], 11)

