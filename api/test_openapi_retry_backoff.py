import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch


class TestOpenApiRetryBackoff(unittest.TestCase):
    def test_openapi_fetch_shop_items_retries_429_then_succeeds(self) -> None:
        """
        구조적 재발 방지:
        - 429가 일시적으로 발생해도(순간 제한) 짧은 백오프로 재시도해 최종 성공할 수 있어야 한다.
        - 이 동작이 있어야 delay를 낮추면서도 PARTIAL 빈도를 낮출 수 있다.
        """
        from main import _openapi_fetch_shop_items

        calls: dict[str, int] = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):  # noqa: ARG001
            calls["n"] += 1
            if calls["n"] <= 2:
                return SimpleNamespace(status_code=429, json=lambda: {"items": []}, headers={})
            return SimpleNamespace(status_code=200, json=lambda: {"items": [{"link": "https://smartstore.naver.com/test/products/1"}]}, headers={})

        env = {
            "NAVER_SEARCH_CLIENT_ID": "x",
            "NAVER_SEARCH_CLIENT_SECRET": "y",
            # 429 → 2회까지 재시도 후 성공해야 한다.
            "OPENAPI_RANK_RETRY_MAX": "4",
            "OPENAPI_RANK_RETRY_BASE_SEC": "0.01",
            "OPENAPI_RANK_RETRY_MAX_SEC": "0.02",
        }
        with patch.dict(os.environ, env):
            with patch("main._openapi_http_get", side_effect=fake_get):
                with patch("main.time.sleep", side_effect=lambda *_args, **_kwargs: None):
                    st, items = _openapi_fetch_shop_items(keyword="K1", start=1, display=10)

        self.assertEqual(int(st or 0), 200)
        self.assertTrue(isinstance(items, list))
        self.assertGreaterEqual(len(items), 1)
        self.assertGreaterEqual(calls["n"], 3)


if __name__ == "__main__":
    unittest.main()

