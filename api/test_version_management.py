import os
import unittest
import zipfile
import io

from fastapi.testclient import TestClient

from main import app


class TestVersionManagement(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["REQUIRE_FIREBASE_AUTH"] = "1"
        os.environ["AUTH_TEST_MODE"] = "1"
        os.environ["FIREBASE_PROJECT_ID"] = "test-project"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for k in ("REQUIRE_FIREBASE_AUTH", "AUTH_TEST_MODE", "FIREBASE_PROJECT_ID"):
            try:
                os.environ.pop(k, None)
            except Exception:
                pass

    def test_admin_version_requires_ops_admin(self):
        res = self.client.get("/admin/version", headers={"Authorization": "Bearer test-user"})
        self.assertEqual(res.status_code, 403)

        res2 = self.client.get("/admin/version", headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(res2.status_code, 200)
        self.assertIn("version", res2.json() or {})

    def test_admin_can_set_version_label(self):
        res = self.client.post(
            "/admin/version",
            headers={"Authorization": "Bearer test-ops_admin"},
            json={"version": "2.3.4"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.json() or {}).get("version"), "2.3.4")

    def test_backup_requires_superadmin_and_returns_zip(self):
        # 기본값(type 미지정)은 ops_code로 동작하며, 시크릿 포함 가능성이 있어 superadmin만 허용한다.
        res = self.client.post("/admin/backup", headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(res.status_code, 403)

        res2 = self.client.post("/admin/backup", headers={"Authorization": "Bearer test-superadmin"})
        self.assertEqual(res2.status_code, 200)
        self.assertTrue(str(res2.headers.get("content-type") or "").startswith("application/zip"))

        z = zipfile.ZipFile(io.BytesIO(res2.content))
        names = set(z.namelist())
        self.assertIn("meta/version_label.txt", names)
        self.assertIn("meta/api_version.json", names)
        self.assertIn("meta/backup_type.txt", names)
        self.assertIn("settings/app_settings.json", names)

    def test_db_backup_requires_ops_admin_and_returns_zip(self):
        res = self.client.post("/admin/backup?type=db", headers={"Authorization": "Bearer test-user"})
        self.assertEqual(res.status_code, 403)

        res2 = self.client.post("/admin/backup?type=db", headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(res2.status_code, 200)
        self.assertTrue(str(res2.headers.get("content-type") or "").startswith("application/zip"))

        z = zipfile.ZipFile(io.BytesIO(res2.content))
        names = set(z.namelist())
        self.assertIn("db/analytics.sql", names)

    def test_full_backup_requires_superadmin_and_includes_db_and_settings(self):
        res = self.client.post("/admin/backup?type=full", headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(res.status_code, 403)

        res2 = self.client.post("/admin/backup?type=full", headers={"Authorization": "Bearer test-superadmin"})
        self.assertEqual(res2.status_code, 200)
        z = zipfile.ZipFile(io.BytesIO(res2.content))
        names = set(z.namelist())
        self.assertIn("settings/app_settings.json", names)
        self.assertIn("db/analytics.sql", names)


if __name__ == "__main__":
    unittest.main()

