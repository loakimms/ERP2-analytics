import os
import unittest

from fastapi.testclient import TestClient

from main import app
import admin_users as admin_mod


class TestAdminUsers(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["REQUIRE_FIREBASE_AUTH"] = "1"
        os.environ["AUTH_TEST_MODE"] = "1"
        os.environ["FIREBASE_PROJECT_ID"] = "test-project"
        os.environ["ADMIN_TEST_MODE"] = "1"
        admin_mod._test_reset_store()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for k in ("REQUIRE_FIREBASE_AUTH", "AUTH_TEST_MODE", "FIREBASE_PROJECT_ID", "ADMIN_TEST_MODE"):
            try:
                os.environ.pop(k, None)
            except Exception:
                pass

    def test_admin_users_requires_auth(self):
        res = self.client.get("/admin/users")
        self.assertEqual(res.status_code, 401)

    def test_admin_users_forbidden_for_user_level(self):
        res = self.client.get("/admin/users", headers={"Authorization": "Bearer test-user"})
        self.assertEqual(res.status_code, 403)

    def test_firebase_admin_status_endpoint(self):
        # user level forbidden
        res = self.client.get("/admin/firebase-admin/status", headers={"Authorization": "Bearer test-user"})
        self.assertEqual(res.status_code, 403)

        # ops_admin can read status (no secrets)
        res2 = self.client.get("/admin/firebase-admin/status", headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(res2.status_code, 200)
        body = res2.json() or {}
        self.assertIn("adminTestMode", body)
        self.assertIn("firebaseAdminConfigured", body)
        self.assertIn("missingEnv", body)
        self.assertIsInstance(body.get("missingEnv"), list)

    def test_ops_admin_can_list_and_create_non_super_roles(self):
        # list ok (ADMIN_TEST_MODE: 빈 목록이면 현재 로그인 사용자 포함)
        res = self.client.get("/admin/users", headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(res.status_code, 200)
        body = res.json() or []
        self.assertIsInstance(body, list)
        # ADMIN_TEST_MODE에서 _TEST_USERS가 비어있으면 현재 요청자가 목록에 포함됨
        self.assertGreaterEqual(len(body), 1)
        self.assertEqual(body[0].get("email"), "ops_admin@example.com")

        # create user(roles=marketing) ok
        res2 = self.client.post(
            "/admin/users",
            headers={"Authorization": "Bearer test-ops_admin"},
            json={"email": "a@example.com", "password": "password123", "displayName": "A", "roles": ["marketing"]},
        )
        self.assertEqual(res2.status_code, 200)
        body = res2.json() or {}
        self.assertEqual(body.get("email"), "a@example.com")
        self.assertEqual(body.get("role"), "marketing")
        self.assertEqual(body.get("roles"), ["marketing"])

        # ops_admin cannot grant superadmin
        res3 = self.client.post(
            "/admin/users",
            headers={"Authorization": "Bearer test-ops_admin"},
            json={"email": "b@example.com", "password": "password123", "roles": ["superadmin"]},
        )
        self.assertEqual(res3.status_code, 403)

    def test_superadmin_can_create_superadmin_and_delete(self):
        # create superadmin user
        res = self.client.post(
            "/admin/users",
            headers={"Authorization": "Bearer test-superadmin"},
            json={"email": "x@example.com", "password": "password123", "roles": ["superadmin"]},
        )
        self.assertEqual(res.status_code, 200)
        uid = str((res.json() or {}).get("uid") or "")
        self.assertTrue(uid)

        # delete requires superadmin
        res2 = self.client.delete(f"/admin/users/{uid}", headers={"Authorization": "Bearer test-ops_admin"})
        self.assertEqual(res2.status_code, 403)

        res3 = self.client.delete(f"/admin/users/{uid}", headers={"Authorization": "Bearer test-superadmin"})
        self.assertEqual(res3.status_code, 200)

    def test_password_min_length(self):
        # create a user first
        res = self.client.post(
            "/admin/users",
            headers={"Authorization": "Bearer test-ops_admin"},
            json={"email": "p@example.com", "password": "password123", "roles": ["sales"]},
        )
        uid = str((res.json() or {}).get("uid") or "")
        self.assertTrue(uid)

        # too short
        res2 = self.client.post(
            f"/admin/users/{uid}/password",
            headers={"Authorization": "Bearer test-ops_admin"},
            json={"password": "123"},
        )
        self.assertEqual(res2.status_code, 400)

    def test_create_user_duplicate_email_returns_409(self):
        res1 = self.client.post(
            "/admin/users",
            headers={"Authorization": "Bearer test-ops_admin"},
            json={"email": "dup@example.com", "password": "password123", "roles": ["sales"]},
        )
        self.assertEqual(res1.status_code, 200)

        res2 = self.client.post(
            "/admin/users",
            headers={"Authorization": "Bearer test-ops_admin"},
            json={"email": "dup@example.com", "password": "password123", "roles": ["sales"]},
        )
        self.assertEqual(res2.status_code, 409)


if __name__ == "__main__":
    unittest.main()

