import unittest
from datetime import date

from fastapi.testclient import TestClient

from db import TrackedProductKeyword, TrackedProductManualKeyword
from main import app, get_db


class RankExcelImportApiTest(unittest.TestCase):
    def test_import_saves_new_keywords_to_manual_pool_without_409(self) -> None:
        class FakeQuery:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def count(self):
                return len(self._rows)

            def all(self):
                return self._rows

        class FakeSession:
            def __init__(self):
                # existing tracked keywords for this product_url
                self.tracked = [type("TK", (), {"keyword": "새치염색"})()]
                self.added = []
                self.executed = 0
                self.commits = 0

            def query(self, model):
                # TrackedProductKeyword 만 조회한다고 가정
                return FakeQuery(self.tracked)

            def add(self, obj):
                self.added.append(obj)

            def merge(self, obj):
                self.added.append(obj)
                return obj

            def execute(self, stmt):
                self.executed += 1
                return None

            def commit(self):
                self.commits += 1

        fake = FakeSession()

        def override_get_db():
            yield fake

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.post(
                "/search-rank/ranks/import",
                json={
                    "product_url": "https://smartstore.naver.com/x/products/1",
                    "allow_add_missing_keywords": False,
                    "keyword_meta": [{"keyword": "천연염색", "monthly_search_volume": 4950}],
                    "items": [
                        {"keyword": "새치염색", "date": "2026-01-11", "rank": 6},
                        {"keyword": "천연염색", "date": "2026-01-11", "rank": 1},
                    ],
                },
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["saved"], 2)
            self.assertIn("천연염색", data["added_keywords"])
            self.assertEqual(fake.executed, 1)
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_import_allows_missing_keywords_when_allowed(self) -> None:
        class FakeQuery:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def count(self):
                return len(self._rows)

            def all(self):
                return self._rows

        class FakeSession:
            def __init__(self):
                self.tracked = [type("TK", (), {"keyword": "새치염색"})()]
                self.added = []
                self.executed = 0
                self.commits = 0
                self.merged = 0

            def query(self, model):
                return FakeQuery(self.tracked)

            def add(self, obj):
                self.added.append(obj)

            def merge(self, obj):
                self.merged += 1
                return obj

            def execute(self, stmt):
                self.executed += 1
                return None

            def commit(self):
                self.commits += 1

        def override_get_db():
            yield FakeSession()

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.post(
                "/search-rank/ranks/import",
                json={
                    "product_url": "https://smartstore.naver.com/x/products/1",
                    "allow_add_missing_keywords": True,
                    "keyword_meta": [{"keyword": "천연염색", "monthly_search_volume": 4950}],
                    "items": [
                        {"keyword": "새치염색", "date": "2026-01-11", "rank": 6},
                        {"keyword": "천연염색", "date": "2026-01-11", "rank": 1},
                    ],
                },
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["saved"], 2)
            self.assertEqual(set(data["added_keywords"]), {"새치염색", "천연염색"})
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_import_persists_zero_rank_items_from_excel(self) -> None:
        class FakeQuery:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def all(self):
                return self._rows

        class FakeSession:
            def __init__(self):
                self.tracked = [type("TK", (), {"keyword": "새치염색"})()]
                self.added = []
                self.executed = 0
                self.commits = 0

            def query(self, model):
                return FakeQuery(self.tracked)

            def add(self, obj):
                self.added.append(obj)

            def merge(self, obj):
                self.added.append(obj)
                return obj

            def execute(self, stmt):
                self.executed += 1
                return None

            def commit(self):
                self.commits += 1

        fake = FakeSession()

        def override_get_db():
            yield fake

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.post(
                "/search-rank/ranks/import",
                json={
                    "product_url": "https://smartstore.naver.com/x/products/1",
                    "allow_add_missing_keywords": False,
                    "items": [
                        {"keyword": "새치염색", "date": "2026-01-11", "rank": 0},
                    ],
                },
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["saved"], 1)
            self.assertEqual(fake.executed, 1)
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_import_dedupes_duplicate_rank_cells_before_upsert(self) -> None:
        class FakeQuery:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def all(self):
                return self._rows

        class FakeSession:
            def __init__(self):
                self.tracked = [type("TK", (), {"keyword": "유기농염색약"})()]
                self.executed = 0
                self.commits = 0

            def query(self, model):
                return FakeQuery(self.tracked)

            def add(self, obj):
                return None

            def merge(self, obj):
                return obj

            def execute(self, stmt):
                self.executed += 1
                return None

            def commit(self):
                self.commits += 1

        fake = FakeSession()

        def override_get_db():
            yield fake

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.post(
                "/search-rank/ranks/import",
                json={
                    "product_url": "https://smartstore.naver.com/x/products/1",
                    "allow_add_missing_keywords": False,
                    "items": [
                        {"keyword": "유기농염색약", "date": "2026-06-15", "rank": 1},
                        {"keyword": "유기농염색약", "date": "2026-06-15", "rank": 2},
                    ],
                },
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["saved"], 1)
            self.assertEqual(fake.executed, 1)
        finally:
            app.dependency_overrides.pop(get_db, None)

    def test_import_treats_manual_keywords_as_existing(self) -> None:
        class FakeQuery:
            def __init__(self, rows):
                self._rows = rows

            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def all(self):
                return self._rows

        class FakeSession:
            def __init__(self):
                self.tracked = [type("TK", (), {"keyword": "새치염색"})()]
                self.manual = [type("MK", (), {"keyword": "유기농염색약"})()]
                self.executed = 0
                self.commits = 0

            def query(self, model):
                if model is TrackedProductKeyword:
                    return FakeQuery(self.tracked)
                if model is TrackedProductManualKeyword:
                    return FakeQuery(self.manual)
                return FakeQuery([])

            def add(self, obj):
                return None

            def merge(self, obj):
                return obj

            def execute(self, stmt):
                self.executed += 1
                return None

            def commit(self):
                self.commits += 1

        fake = FakeSession()

        def override_get_db():
            yield fake

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            resp = client.post(
                "/search-rank/ranks/import",
                json={
                    "product_url": "https://smartstore.naver.com/x/products/1?nt_source=test",
                    "allow_add_missing_keywords": False,
                    "items": [
                        {"keyword": "유기농염색약", "date": "2026-06-15", "rank": 1},
                    ],
                },
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["saved"], 1)
            self.assertEqual(fake.executed, 1)
        finally:
            app.dependency_overrides.pop(get_db, None)


if __name__ == "__main__":
    unittest.main()

