import unittest

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductManualKeyword
from main import app


class ManualKeywordImportApiTest(unittest.TestCase):
    def test_import_and_list_manual_keywords_replace(self) -> None:
        client = TestClient(app)
        db = SessionLocal()
        product_url = "https://smartstore.naver.com/test/products/11043833896"
        try:
            # 기존 1건(활성)
            db.merge(
                TrackedProductManualKeyword(
                    product_url=product_url,
                    keyword="기존키워드",
                    monthly_search_volume=123,
                    is_active=True,
                )
            )
            db.commit()

            # replace로 2건 저장
            resp = client.post(
                "/search-rank/manual-keywords/import",
                json={
                    "product_url": product_url,
                    "mode": "replace",
                    "items": [
                        {"keyword": "염색약", "monthly_search_volume": 51000},
                        {"keyword": "헤어팩", "monthly_search_volume": 7400},
                    ],
                },
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body.get("saved"), 2)

            # list에는 2건만 보여야 함
            lst = client.get("/search-rank/manual-keywords", params={"product_url": product_url})
            self.assertEqual(lst.status_code, 200)
            arr = lst.json()
            kws = [x.get("keyword") for x in (arr or [])]
            self.assertIn("염색약", kws)
            self.assertIn("헤어팩", kws)
            self.assertNotIn("기존키워드", kws)
        finally:
            try:
                db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

