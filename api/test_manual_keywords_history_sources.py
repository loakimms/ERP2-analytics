import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductRankDaily, TrackedProductManualKeyword
from main import app, _today_kst


class ManualKeywordsHistorySourcesTest(unittest.TestCase):
    def test_manual_keywords_history_includes_excel_and_crawl_category(self) -> None:
        client = TestClient(app)
        db = SessionLocal()

        today = _today_kst()
        yesterday = today - timedelta(days=1)

        pid = "991234567890"
        saved_url = f"https://smartstore.naver.com/test/products/{pid}?NaPm=ct%3Dxxx"
        query_url = f"https://smartstore.naver.com/test/products/{pid}"
        try:
            # 후보 키워드 1개 활성
            db.merge(
                TrackedProductManualKeyword(
                    product_url=saved_url,
                    keyword="K",
                    monthly_search_volume=100,
                    is_active=True,
                )
            )
            db.commit()

            # 서로 다른 날짜에 서로 다른 source로 저장(충돌/우선순위 이슈 회피)
            db.merge(TrackedProductRankDaily(date=yesterday, product_url=saved_url, keyword="K", rank=10, source="excel"))
            db.merge(TrackedProductRankDaily(date=today, product_url=saved_url, keyword="K", rank=5, source="crawl_category"))
            db.commit()

            resp = client.get("/search-rank/history/manual-keywords", params={"days": 7, "product_url": query_url})
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            series = body.get("series") or []
            s0 = next((s for s in series if s.get("keyword") == "K"), None)
            self.assertIsNotNone(s0)
            pts = s0.get("series") or []
            ranks_by_date = {p.get("date"): p.get("rank") for p in pts}
            self.assertEqual(ranks_by_date.get(str(yesterday)), 10)
            self.assertEqual(ranks_by_date.get(str(today)), 5)
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

