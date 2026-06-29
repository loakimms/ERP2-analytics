import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from main import app, get_db


class ProductSummaryApiTest(unittest.TestCase):
    def test_when_product_url_given_but_not_found_does_not_fallback_to_other_product(self) -> None:
        """
        product_url 이 주어졌는데 DB에서 매칭 실패하면,
        키워드 상위 1개(다른 상품)로 대체하지 않고 기본값을 반환해야 한다.
        """

        class FakeQuery:
            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def limit(self, *args, **kwargs):
                return self

            def one_or_none(self):
                return None

        class FakeSession:
            def query(self, *args, **kwargs):
                return FakeQuery()

        def override_get_db():
            yield FakeSession()

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.get(
                "/search-rank/product-summary",
                params={
                    "keyword": "헤어팩",
                    "product_url": "https://smartstore.naver.com/thesujata/products/12874366496",
                },
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["keyword"], "헤어팩")
            # 다른 상품명이나 대표 키워드로 대체되면 안 됨
            self.assertIsNone(data["product_title"])
            # URL에서 유추한 mall 이 들어가야 함(최소한 오염 방지)
            self.assertEqual(data["mall_name"], "thesujata")
            self.assertIsNone(data["image_url"])
        finally:
            app.dependency_overrides.pop(get_db, None)


if __name__ == "__main__":
    unittest.main()


