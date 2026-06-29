import unittest

from fastapi.testclient import TestClient

from db import SessionLocal, SeoCategoryDictionaryEntry, SeoCategoryDictionaryUploadBatch, SeoCategoryDictionaryUploadEntry, init_db
from main import app


class SeoCategoryDictionaryApiTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(app)
        with SessionLocal() as db:
            db.query(SeoCategoryDictionaryUploadEntry).delete()
            db.query(SeoCategoryDictionaryUploadBatch).delete()
            db.query(SeoCategoryDictionaryEntry).delete()
            db.commit()

    def tearDown(self) -> None:
        with SessionLocal() as db:
            db.query(SeoCategoryDictionaryUploadEntry).delete()
            db.query(SeoCategoryDictionaryUploadBatch).delete()
            db.query(SeoCategoryDictionaryEntry).delete()
            db.commit()

    def test_import_creates_upload_file_and_active_entries(self) -> None:
        resp = self.client.post(
            "/seo/category-dictionary/import",
            json={
                "filename": "category_test.csv",
                "items": [
                    {"id": "50000002", "path": "화장품/미용>헤어스타일링>염색약"},
                    {"id": "50000004", "path": "가구/인테리어>DIY자재/용품>바닥재>장판"},
                ],
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body.get("parsed"), 2)
        self.assertEqual(body.get("inserted"), 2)
        self.assertEqual(body.get("skipped"), 0)
        self.assertEqual(body.get("total_active"), 2)

        lst = self.client.get("/seo/category-dictionary")
        self.assertEqual(lst.status_code, 200)
        data = lst.json()
        self.assertEqual(int(data.get("total") or 0), 2)
        items = data.get("items") or []
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["source_filename"], "category_test.csv")
        files = data.get("files") or []
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["filename"], "category_test.csv")
        self.assertEqual(files[0]["parsed_rows"], 2)
        self.assertTrue(bool(files[0]["is_active"]))
        ids = {str(item.get("id")) for item in items}
        self.assertEqual(ids, {"50000002", "50000004"})

    def test_apply_switches_active_dictionary_by_uploaded_file(self) -> None:
        first = self.client.post(
            "/seo/category-dictionary/import",
            json={
                "filename": "category_first.csv",
                "items": [
                    {"id": "50000002", "path": "화장품/미용>헤어스타일링>염색약"},
                    {"id": "50000004", "path": "가구/인테리어>DIY자재/용품>바닥재>장판"},
                ],
            },
        )
        self.assertEqual(first.status_code, 200)
        first_batch_id = str(first.json().get("batch_id") or "")

        second = self.client.post(
            "/seo/category-dictionary/import",
            json={
                "filename": "category_second.csv",
                "items": [
                    {"id": "50000002", "path": "화장품/미용>헤어스타일링>염색약"},
                    {"id": "50000005", "path": "패션의류>여성의류>티셔츠"},
                ],
            },
        )
        self.assertEqual(second.status_code, 200)
        body = second.json()
        self.assertEqual(body.get("parsed"), 2)
        self.assertEqual(body.get("inserted"), 2)
        self.assertEqual(body.get("skipped"), 0)
        self.assertEqual(body.get("total_active"), 2)

        current = self.client.get("/seo/category-dictionary")
        self.assertEqual(current.status_code, 200)
        current_ids = {str(item.get("id")) for item in (current.json().get("items") or [])}
        self.assertEqual(current_ids, {"50000002", "50000005"})

        apply_resp = self.client.post("/seo/category-dictionary/apply", json={"batch_id": first_batch_id})
        self.assertEqual(apply_resp.status_code, 200)
        self.assertEqual(apply_resp.json().get("batch_id"), first_batch_id)

        lst = self.client.get("/seo/category-dictionary")
        self.assertEqual(lst.status_code, 200)
        ids = {str(item.get("id")) for item in (lst.json().get("items") or [])}
        self.assertEqual(ids, {"50000002", "50000004"})
        files = lst.json().get("files") or []
        active = [item for item in files if item.get("is_active")]
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["batch_id"], first_batch_id)

    def test_delete_removes_uploaded_file_batch_and_falls_back_to_latest_remaining(self) -> None:
        seed = self.client.post(
            "/seo/category-dictionary/import",
            json={
                "filename": "category_seed.csv",
                "items": [{"id": "50000002", "path": "화장품/미용>헤어스타일링>염색약"}],
            },
        )
        self.assertEqual(seed.status_code, 200)
        seed_batch_id = str(seed.json().get("batch_id") or "")

        second = self.client.post(
            "/seo/category-dictionary/import",
            json={
                "filename": "category_second.csv",
                "items": [{"id": "50000005", "path": "패션의류>여성의류>티셔츠"}],
            },
        )
        self.assertEqual(second.status_code, 200)
        second_batch_id = str(second.json().get("batch_id") or "")

        delete_resp = self.client.post("/seo/category-dictionary/delete", json={"batch_id": second_batch_id})
        self.assertEqual(delete_resp.status_code, 200)
        self.assertEqual(delete_resp.json().get("deleted"), 1)
        self.assertEqual(delete_resp.json().get("active_batch_id"), seed_batch_id)

        lst = self.client.get("/seo/category-dictionary")
        self.assertEqual(lst.status_code, 200)
        items = lst.json().get("items") or []
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "50000002")
        files = lst.json().get("files") or []
        self.assertEqual(len(files), 1)

    def test_failed_import_does_not_delete_existing_active_batch(self) -> None:
        seed = self.client.post(
            "/seo/category-dictionary/import",
            json={
                "filename": "category_seed.csv",
                "items": [{"id": "50000002", "path": "화장품/미용>헤어스타일링>염색약"}],
            },
        )
        self.assertEqual(seed.status_code, 200)

        bad = self.client.post(
            "/seo/category-dictionary/import",
            json={
                "filename": "category_bad.csv",
                "items": [
                    {"id": "50000003", "path": ""},
                    {"id": "abc", "path": "가구/인테리어>DIY자재/용품>바닥재>장판"},
                ],
            },
        )
        self.assertEqual(bad.status_code, 400)

        lst = self.client.get("/seo/category-dictionary")
        self.assertEqual(lst.status_code, 200)
        items = lst.json().get("items") or []
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "50000002")


if __name__ == "__main__":
    unittest.main()
