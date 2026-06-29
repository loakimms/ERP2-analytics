import unittest
from unittest.mock import MagicMock, patch


class CreativesOrganicRecomputeTest(unittest.TestCase):
    @patch("main.list_creative_daily")
    def test_recompute_creatives_organic_derived_returns_summary(self, mock_list: MagicMock) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)
        mock_list.return_value = [{"k": 1}, {"k": 2}]

        res = client.post(
            "/creatives/organic/recompute?date_from=2026-01-16&date_to=2026-01-17&include_meta_only=true&limit=10&offset=0"
        )
        self.assertEqual(res.status_code, 200, msg=res.text)
        j = res.json() or {}
        self.assertTrue(j.get("ok"))
        self.assertEqual(j.get("date_from"), "2026-01-16")
        self.assertEqual(j.get("date_to"), "2026-01-17")
        self.assertEqual(j.get("count"), 2)

        # list_creative_daily가 동일 인자로 호출되는지 확인(best-effort)
        self.assertEqual(mock_list.call_count, 1)


if __name__ == "__main__":
    unittest.main()

