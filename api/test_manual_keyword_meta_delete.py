import unittest

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductManualKeyword
from main import app


class ManualKeywordMetaDeleteApiTest(unittest.TestCase):
    def test_delete_meta_marks_inactive(self) -> None:
        client = TestClient(app)
        db = SessionLocal()
        pid = "11043833896"
        saved_url = f"https://smartstore.naver.com/test/products/{pid}?NaPm=ct%3Dxxx"
        query_url = f"https://smartstore.naver.com/test/products/{pid}"
        try:
            db.merge(TrackedProductManualKeyword(product_url=saved_url, keyword="염색약", monthly_search_volume=51000, is_active=True))
            db.merge(TrackedProductManualKeyword(product_url=saved_url, keyword="헤나", monthly_search_volume=7440, is_active=True))
            db.commit()

            resp = client.post(
                "/search-rank/manual-keywords/delete-meta",
                json={"product_url": query_url, "keywords": ["헤나"]},
            )
            self.assertEqual(resp.status_code, 200)
            self.assertGreaterEqual(int(resp.json().get("deleted") or 0), 1)

            lst = client.get("/search-rank/manual-keywords", params={"product_url": query_url})
            self.assertEqual(lst.status_code, 200)
            kws = [x.get("keyword") for x in (lst.json() or [])]
            self.assertIn("염색약", kws)
            self.assertNotIn("헤나", kws)
        finally:
            try:
                db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == saved_url).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

