import unittest
from unittest.mock import patch


class AiChatApiTest(unittest.TestCase):
    def test_ai_chat_returns_400_when_key_missing(self) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)
        with patch("main._get_api_setting", return_value=""):
            resp = client.post("/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(resp.status_code, 400, msg=resp.text)
        self.assertIn("OPENAI_API_KEY", resp.text)

    def test_ai_chat_proxies_openai_chat_completions(self) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "pong"},
                        }
                    ],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"pong"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()) as mp:
            resp = client.post(
                "/ai/chat",
                json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "ping"}]},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        data = resp.json() or {}
        self.assertEqual((data.get("message") or {}).get("role"), "assistant")
        self.assertEqual((data.get("message") or {}).get("content"), "pong")
        self.assertEqual((data.get("usage") or {}).get("total_tokens"), 2)
        # proxy 호출이 발생했는지 최소 확인
        self.assertTrue(mp.called)


if __name__ == "__main__":
    unittest.main()

