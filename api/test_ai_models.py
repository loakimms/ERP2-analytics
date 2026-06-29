import unittest
from unittest.mock import patch


class AiModelsApiTest(unittest.TestCase):
    def test_ai_models_returns_400_when_key_missing(self) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)
        with patch("main._get_api_setting", return_value=""):
            resp = client.get("/ai/models")
        self.assertEqual(resp.status_code, 400, msg=resp.text)
        self.assertIn("OPENAI_API_KEY", resp.text)

    def test_ai_models_returns_filtered_sorted_models(self) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "data": [
                        {"id": "text-embedding-3-small", "object": "model"},
                        {"id": "gpt-4o-mini", "object": "model"},
                        {"id": "gpt-4.1", "object": "model"},
                        {"id": "whisper-1", "object": "model"},
                        {"id": "gpt-4o", "object": "model"},
                    ]
                }

            @property
            def text(self):
                return '{"data":[{"id":"gpt-4o-mini"}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.get", return_value=FakeResp()):
            resp = client.get("/ai/models")
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        data = resp.json() or {}
        self.assertTrue(data.get("ok"))
        ids = [m.get("id") for m in (data.get("models") or [])]
        # embedding/whisper 제외, gpt 계열만 포함
        self.assertIn("gpt-4o-mini", ids)
        self.assertIn("gpt-4o", ids)
        self.assertIn("gpt-4.1", ids)
        self.assertNotIn("text-embedding-3-small", ids)
        self.assertNotIn("whisper-1", ids)
        # 정렬(문자열 오름차순) 최소 보장
        self.assertEqual(ids, sorted(ids))


if __name__ == "__main__":
    unittest.main()

