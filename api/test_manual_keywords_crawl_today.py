import unittest
from datetime import date
import time

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductRankDaily, TrackedProductManualKeyword
from main import app, _today_kst


class ManualKeywordsCrawlTodayApiTest(unittest.TestCase):
    def test_crawl_today_returns_rank_0_and_missing(self) -> None:
        client = TestClient(app)
        db = SessionLocal()

        # API는 KST 기준으로 '오늘'을 계산하므로 테스트도 동일 기준을 사용한다.
        d = _today_kst()
        # 기존 운영 데이터와 충돌하지 않도록 충분히 희귀한 productId를 사용한다.
        pid = f"991{int(time.time())}111222"
        saved_url = f"https://smartstore.naver.com/test/products/{pid}?NaPm=ct%3Dxxx"
        query_url = f"https://smartstore.naver.com/test/products/{pid}"
        try:
            # 후보 키워드 3개
            db.merge(TrackedProductManualKeyword(product_url=saved_url, keyword="K1", monthly_search_volume=100, is_active=True))
            db.merge(TrackedProductManualKeyword(product_url=saved_url, keyword="K2", monthly_search_volume=100, is_active=True))
            db.merge(TrackedProductManualKeyword(product_url=saved_url, keyword="K3", monthly_search_volume=100, is_active=True))
            db.commit()

            # K1: rank>0 (openapi), K2: rank=0 (openapi), K3: row 없음
            db.merge(TrackedProductRankDaily(date=d, product_url=saved_url, keyword="K1", rank=7, source="openapi"))
            db.merge(TrackedProductRankDaily(date=d, product_url=saved_url, keyword="K2", rank=0, source="openapi"))
            db.commit()

            resp = client.get("/search-rank/manual-keywords/crawl-today", params={"product_url": query_url})
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body.get("total_keywords"), 3)
            self.assertEqual(body.get("crawled_keywords"), 2)
            self.assertEqual(body.get("found_keywords"), 1)
            self.assertEqual(body.get("missing_keywords"), 2)

            items = {it["keyword"]: it for it in (body.get("items") or [])}
            self.assertEqual(items["K1"]["rank"], 7)
            self.assertEqual(items["K2"]["rank"], 0)
            self.assertTrue(items["K3"]["rank"] is None)
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == saved_url).delete()
                db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == saved_url).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

