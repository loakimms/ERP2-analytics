import os
import unittest

from fastapi.testclient import TestClient

from main import app


class TestAuthMiddleware(unittest.TestCase):
    def setUp(self) -> None:
        # 강제 인증 ON + 테스트 전용 토큰 모드
        os.environ["REQUIRE_FIREBASE_AUTH"] = "1"
        os.environ["AUTH_TEST_MODE"] = "1"
        # project id는 test mode에서는 필요 없지만, 실수로 로직이 바뀌어도 안전하게 둔다.
        os.environ["FIREBASE_PROJECT_ID"] = "test-project"
        self.client = TestClient(app)

    def tearDown(self) -> None:
        for k in ("REQUIRE_FIREBASE_AUTH", "AUTH_TEST_MODE", "FIREBASE_PROJECT_ID"):
            try:
                os.environ.pop(k, None)
            except Exception:
                pass

    def test_allowlist_health_is_public(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertIn((res.json() or {}).get("status"), ("ok", "error"))

    def test_allowlist_api_health_is_public(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertIn((res.json() or {}).get("status"), ("ok", "error"))

    def test_protected_requires_bearer(self):
        # allowlist가 아닌 경로는 401
        res = self.client.get("/settings/ai")
        self.assertEqual(res.status_code, 401)
        body = res.json() or {}
        self.assertEqual(body.get("error"), "unauthorized")

    def test_protected_accepts_test_token(self):
        res = self.client.get("/settings/ai", headers={"Authorization": "Bearer test"})
        self.assertEqual(res.status_code, 200)


if __name__ == "__main__":
    unittest.main()

