import unittest
from datetime import date, timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductRankDaily
from main import app


class ManualKeywordDeleteApiTest(unittest.TestCase):
    def test_delete_manual_keywords_deletes_only_source_text_for_selected_keywords(self) -> None:
        client = TestClient(app)
        db = SessionLocal()

        d0 = date.today()
        d1 = d0 - timedelta(days=1)
        pid = "11043833896"
        saved_url = f"https://smartstore.naver.com/test/products/{pid}?NaPm=ct%3Dxxx"
        query_url = f"https://smartstore.naver.com/test/products/{pid}"
        try:
            # text: A(2일), B(1일)
            db.merge(TrackedProductRankDaily(date=d0, product_url=saved_url, keyword="수기키워드A", rank=1, source="text"))
            db.merge(TrackedProductRankDaily(date=d1, product_url=saved_url, keyword="수기키워드A", rank=2, source="text"))
            db.merge(TrackedProductRankDaily(date=d0, product_url=saved_url, keyword="수기키워드B", rank=9, source="text"))

            # excel: 다른 키워드(삭제되면 안 됨)
            # NOTE: tracked_product_rank_daily의 PK는 (date, product_url, keyword)라서 동일 키워드/일자에는 source가 달라도 공존할 수 없다.
            db.merge(TrackedProductRankDaily(date=d0, product_url=saved_url, keyword="엑셀키워드", rank=3, source="excel"))
            db.commit()

            del_resp = client.post(
                "/search-rank/manual-keywords/delete",
                json={"product_url": query_url, "keywords": ["수기키워드A"]},
            )
            self.assertEqual(del_resp.status_code, 200)
            self.assertGreaterEqual(int(del_resp.json().get("deleted") or 0), 1)

            # manual history에는 A가 없어야 함, B는 남아야 함
            hist = client.get("/search-rank/history/manual", params={"days": 30, "product_url": query_url})
            self.assertEqual(hist.status_code, 200)
            kws = [s["keyword"] for s in (hist.json().get("series") or [])]
            self.assertNotIn("수기키워드A", kws)
            self.assertIn("수기키워드B", kws)

            # excel A는 남아야 함(테이블 직접 확인)
            excel_a = (
                db.query(TrackedProductRankDaily)
                .filter(
                    TrackedProductRankDaily.product_url == saved_url,
                    TrackedProductRankDaily.keyword == "엑셀키워드",
                    TrackedProductRankDaily.source == "excel",
                )
                .count()
            )
            self.assertEqual(excel_a, 1)
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == saved_url).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

