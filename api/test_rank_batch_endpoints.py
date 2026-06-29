import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app, get_db
from schemas import ProductRankHistory, ProductRankSeries, ProductRankPoint, ProductSummary, ProductMetadata


class RankBatchEndpointsTest(unittest.TestCase):
    def test_history_batch_returns_id_map(self) -> None:
        def override_get_db():
            yield MagicMock()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with patch("main.get_product_rank_history") as mocked:
                mocked.return_value = ProductRankHistory(
                    dates=[date(2026, 1, 1)],
                    series=[ProductRankSeries(keyword="k", series=[ProductRankPoint(date=date(2026, 1, 1), rank=3)])],
                )
                client = TestClient(app)
                resp = client.post(
                    "/search-rank/history/batch",
                    params={"days": 7},
                    json={"items": [{"id": "g1", "product_url": "u1"}, {"id": "g2", "product_url": None}]},
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.json()
                self.assertIn("g1", data)
                self.assertIn("g2", data)
                self.assertIsNotNone(data["g1"])
                self.assertIsNone(data["g2"])
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_product_summary_batch_returns_id_map(self) -> None:
        def override_get_db():
            yield MagicMock()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with patch("main.get_product_summary") as mocked:
                mocked.return_value = ProductSummary(
                    keyword="헤어팩",
                    product_title="헤어팩",
                    mall_name="thesujata",
                    price=0,
                    purchase_cnt=0,
                    product_id=None,
                    image_url=None,
                    category_path=None,
                    brand=None,
                    maker=None,
                )
                client = TestClient(app)
                resp = client.post(
                    "/search-rank/product-summary/batch",
                    json={"items": [{"id": "g1", "keyword": "헤어팩", "product_url": "u1"}]},
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.json()
                self.assertIn("g1", data)
                self.assertEqual(data["g1"]["keyword"], "헤어팩")
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_product_metadata_batch_uses_db_only(self) -> None:
        # smartstore URL + DB row 존재 + mall_name 일치 → title/image/price 반환
        normalized = "https://smartstore.naver.com/thesujata/products/1"

        class FakeQuery:
            def filter(self, *args, **kwargs):
                return self

            def one_or_none(self):
                return SimpleNamespace(
                    title="T",
                    image_url="I",
                    mall_name="thesujata",
                    price=123,
                    product_id_catalog=999,
                )

        class FakeSession:
            def query(self, *args, **kwargs):
                return FakeQuery()

        def override_get_db():
            yield FakeSession()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with patch("main._canonicalize_smartstore_base_url", return_value=normalized), patch(
                "main._infer_smartstore_mall_name", return_value="thesujata"
            ):
                client = TestClient(app)
                resp = client.post(
                    "/search-rank/product-metadata/batch",
                    json={"items": [{"id": "g1", "keyword": "k", "product_url": normalized}]},
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.json()
                self.assertIn("g1", data)
                self.assertIsNotNone(data["g1"])
                self.assertEqual(data["g1"]["title"], "T")
                self.assertEqual(data["g1"]["image_url"], "I")
                self.assertEqual(data["g1"]["site_name"], "thesujata")
                self.assertEqual(int(data["g1"]["price"]), 123)
                self.assertEqual(int(data["g1"]["product_id"]), 999)
        finally:
            app.dependency_overrides.pop(get_db, None)


if __name__ == "__main__":
    unittest.main()

