import unittest

from fastapi.testclient import TestClient

from main import app


class TestAiSettings(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_get_returns_default(self):
        res = self.client.get("/settings/ai")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(str(data.get("format_version") or ""), "v2")
        self.assertIn("common_rules", data)
        self.assertIn("rule_packs", data)
        self.assertIsInstance(data.get("rule_packs"), list)

    def test_put_then_get_roundtrip(self):
        payload = {
            "format_version": "v2",
            "common_rules": "공통 규칙 예시",
            "rule_packs": [
                {
                    "id": "A-1",
                    "enabled": True,
                    "title": "오가닉 순위 추적 / 변동성 분석 (키워드·SKU)",
                    "a1": {
                        "surfaces": {
                            "mobile_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}},
                            "pc_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}},
                        },
                        "thresholds": {
                            "uncertain": {"min_valid_days_14d": 7, "missing_rank_value": 999},
                            "stable": {"avg_rank_14d_max": 3.0, "rank_volatility_14d_max": 1.2, "down_days_14d_max": 2},
                            "unstable": {
                                "avg_rank_14d_min": 4.0,
                                "avg_rank_14d_max": 10.0,
                                "rank_volatility_14d_min": 2.0,
                                "drop_7d_min": 3,
                                "drop_delta_min": 3,
                            },
                            "weak": {"avg_rank_14d_min": 11.0, "improve_days_7d_eq": 0},
                        },
                        "prompt_templates": {"inputs_json": "{\"a1\":\"inputs-json\"}", "outputs_template": "OUTPUT_TEMPLATE_V2"},
                    },
                }
            ],
        }
        res = self.client.put("/settings/ai", json=payload)
        self.assertEqual(res.status_code, 200)

        res2 = self.client.get("/settings/ai")
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(str(data2.get("format_version") or ""), "v2")
        self.assertEqual(data2.get("common_rules"), "공통 규칙 예시")
        arr = data2.get("rule_packs") or []
        self.assertEqual(len(arr), 1)
        self.assertEqual(arr[0].get("id"), "A-1")
        self.assertEqual(arr[0].get("title"), payload["rule_packs"][0]["title"])


if __name__ == "__main__":
    unittest.main()

