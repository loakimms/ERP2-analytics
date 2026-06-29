import unittest

from fastapi.testclient import TestClient

from main import app


class TrackingModeApiTest(unittest.TestCase):
    def test_tracking_mode_is_per_product(self):
        client = TestClient(app)

        # default: focus
        r0 = client.get("/search-rank/tracking-mode", params={"product_url": "p_a"})
        self.assertEqual(r0.status_code, 200)
        self.assertEqual(r0.json().get("tracking_mode"), "focus")

        # set product A to initial
        r1 = client.put(
            "/search-rank/tracking-mode",
            json={"product_url": "p_a", "tracking_mode": "initial"},
        )
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json().get("tracking_mode"), "initial")

        # product B remains default focus
        r2 = client.get("/search-rank/tracking-mode", params={"product_url": "p_b"})
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json().get("tracking_mode"), "focus")

        # product A stays initial
        r3 = client.get("/search-rank/tracking-mode", params={"product_url": "p_a"})
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.json().get("tracking_mode"), "initial")

