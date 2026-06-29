import unittest
from datetime import date

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductRankDaily
from main import app


class ManualHistoryApiTest(unittest.TestCase):
    def test_manual_history_returns_only_source_text_rows(self) -> None:
        client = TestClient(app)
        db = SessionLocal()

        d = date.today()
        pid = "11043833896"
        saved_url = f"https://smartstore.naver.com/test/products/{pid}?NaPm=ct%3Dxxx"
        query_url = f"https://smartstore.naver.com/test/products/{pid}"
        try:
            # text 2건
            db.merge(
                TrackedProductRankDaily(
                    date=d,
                    product_url=saved_url,
                    keyword="수기키워드A",
                    rank=1,
                    source="text",
                )
            )
            db.merge(
                TrackedProductRankDaily(
                    date=d,
                    product_url=saved_url,
                    keyword="수기키워드B",
                    rank=9,
                    source="text",
                )
            )
            # excel 1건(같은 productUrl) - manual endpoint에 포함되면 안 됨
            db.merge(
                TrackedProductRankDaily(
                    date=d,
                    product_url=saved_url,
                    keyword="엑셀키워드",
                    rank=3,
                    source="excel",
                )
            )
            db.commit()

            resp = client.get("/search-rank/history/manual", params={"days": 7, "product_url": query_url})
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            kws = [s["keyword"] for s in (body.get("series") or [])]
            self.assertIn("수기키워드A", kws)
            self.assertIn("수기키워드B", kws)
            self.assertNotIn("엑셀키워드", kws)
        finally:
            try:
                db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == saved_url).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

