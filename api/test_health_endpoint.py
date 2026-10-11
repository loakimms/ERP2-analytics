import unittest

from fastapi.testclient import TestClient

from main import app


class TestHealthEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def _assert_health_shape(self, data: dict):
        self.assertEqual(data.get("service"), "marketing-analytics")
        self.assertIn(data.get("status"), ("ok", "error"))
        self.assertIsInstance(data.get("environment"), str)
        self.assertIsInstance(data.get("version"), str)
        self.assertIsInstance(data.get("checkedAt"), str)
        self.assertIn(data.get("database"), ("ok", "error"))
        self.assertIn("ok", data)
        self.assertIn("db", data)
        self.assertIn("build", data)

    def test_health_root(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self._assert_health_shape(res.json())

    def test_health_api_prefix_alias(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self._assert_health_shape(res.json())


if __name__ == "__main__":
    unittest.main()

