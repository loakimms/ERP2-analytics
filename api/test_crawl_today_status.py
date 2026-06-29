import unittest

from fastapi.testclient import TestClient

from main import app
from db import SessionLocal, TrackedProductRankDaily
from datetime import datetime
from zoneinfo import ZoneInfo


class TestCrawlTodayStatus(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_today_status_uses_manual_keywords_and_reports_missing(self):
        product_url = "https://smartstore.naver.com/testmall/products/999000000001"
        today = datetime.now(ZoneInfo("Asia/Seoul")).date()

        # 테스트 격리: 기존 실행에서 같은 URL로 저장된 crawl_category 결과가 남아있을 수 있어 제거
        with SessionLocal() as db:
            db.query(TrackedProductRankDaily).filter(
                TrackedProductRankDaily.date == today,
                TrackedProductRankDaily.product_url == product_url,
                TrackedProductRankDaily.source == "openapi",
            ).delete(synchronize_session=False)
            db.commit()

        # 1) 수기 키워드(월검색량) 저장
        res0 = self.client.post(
            "/search-rank/manual-keywords/import",
            json={
                "product_url": product_url,
                "mode": "replace",
                "items": [
                    {"keyword": "키워드A", "monthly_search_volume": 10},
                    {"keyword": "키워드B", "monthly_search_volume": 20},
                ],
            },
        )
        self.assertEqual(res0.status_code, 200)

        # 2) 아직 openapi 저장이 없으므로 missing 2개
        res1 = self.client.post("/search-rank/crawl/today-status", json={"product_urls": [product_url]})
        self.assertEqual(res1.status_code, 200)
        rows = res1.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(int(rows[0]["total_keywords"]), 2)
        self.assertEqual(int(rows[0]["covered_keywords"]), 0)
        self.assertEqual(int(rows[0].get("exposed_keywords") or 0), 0)
        self.assertEqual(int(rows[0].get("no_exposure_keywords") or 0), 0)
        self.assertEqual(sorted(rows[0]["missing_keywords"]), ["키워드A", "키워드B"])

        # 3) 오늘 openapi 결과를 하나만 저장하면 covered=1, missing=1
        with SessionLocal() as db:
            db.merge(
                TrackedProductRankDaily(
                    date=today,
                    product_url=product_url,
                    keyword="키워드A",
                    # rank==0도 수집 결과로 간주해야 하므로 테스트에서 0으로 저장해도 covered가 올라가야 한다.
                    rank=0,
                    source="openapi",
                )
            )
            db.commit()

        res2 = self.client.post("/search-rank/crawl/today-status", json={"product_urls": [product_url]})
        self.assertEqual(res2.status_code, 200)
        rows2 = res2.json()
        self.assertEqual(int(rows2[0]["covered_keywords"]), 1)
        self.assertEqual(int(rows2[0].get("exposed_keywords") or 0), 0)
        self.assertEqual(int(rows2[0].get("no_exposure_keywords") or 0), 1)
        self.assertEqual(rows2[0]["missing_keywords"], ["키워드B"])

    def test_today_status_marks_incomplete_when_no_manual_keywords(self):
        product_url = "https://smartstore.naver.com/testmall/products/999000000002"
        today = datetime.now(ZoneInfo("Asia/Seoul")).date()

        # 수기 키워드가 없으면 total=0 이고 is_complete는 False 여야 한다.
        res = self.client.post("/search-rank/crawl/today-status", json={"product_urls": [product_url]})
        self.assertEqual(res.status_code, 200)
        rows = res.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(int(rows[0]["total_keywords"]), 0)
        self.assertEqual(bool(rows[0]["is_complete"]), False)

