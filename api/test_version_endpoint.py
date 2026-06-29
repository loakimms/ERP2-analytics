import unittest

from fastapi.testclient import TestClient

from main import app


class TestVersionEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def _assert_version_shape(self, data: dict):
        # 최소 계약: status=ok + 주요 필드는 존재(값은 없을 수도 있음: 빌드 주입 전/테스트 환경)
        self.assertEqual(str(data.get("status") or ""), "ok")
        self.assertIn("imageTag", data)
        self.assertIn("gitSha", data)
        self.assertIn("buildTime", data)

    def test_version_root(self):
        res = self.client.get("/version")
        self.assertEqual(res.status_code, 200)
        self._assert_version_shape(res.json())

    def test_version_api_prefix_alias(self):
        res = self.client.get("/api/version")
        self.assertEqual(res.status_code, 200)
        self._assert_version_shape(res.json())


if __name__ == "__main__":
    unittest.main()

