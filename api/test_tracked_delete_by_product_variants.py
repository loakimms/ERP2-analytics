import unittest

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductKeyword
from main import app


class TrackedDeleteByProductVariantsTest(unittest.TestCase):
    def test_delete_by_product_deactivates_variant_urls(self) -> None:
        client = TestClient(app)
        db = SessionLocal()
        pid = "991234567891"
        base = f"https://smartstore.naver.com/test/products/{pid}"
        variant = f"{base}?NaPm=ct%3Dxxx&originUrl=https%3A%2F%2Fsmartstore.naver.com%2Fother%2Fproducts%2F777000111222"
        try:
            # 동일 상품(동일 path pid)인데 URL 문자열이 다른 케이스를 동시에 저장
            db.add(TrackedProductKeyword(product_url=base, keyword="K1", is_active=True))
            db.add(TrackedProductKeyword(product_url=variant, keyword="K2", is_active=True))
            db.commit()

            resp = client.delete("/search-rank/tracked/by-product", params={"product_url": base})
            self.assertEqual(resp.status_code, 200)
            self.assertGreaterEqual(int(resp.json().get("deleted") or 0), 1)

            # 두 row 모두 비활성화되어야 한다.
            rows = (
                db.query(TrackedProductKeyword)
                .filter(TrackedProductKeyword.product_url.in_([base, variant]))
                .all()
            )
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(not bool(r.is_active) for r in rows))
        finally:
            try:
                db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url.in_([base, variant])).delete()
                db.commit()
            except Exception:
                pass
            db.close()


if __name__ == "__main__":
    unittest.main()

