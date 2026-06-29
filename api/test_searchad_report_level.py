import unittest
from unittest.mock import MagicMock, patch


class SearchAdReportLevelFormatTest(unittest.TestCase):
    def test_searchad_create_report_sends_single_level_string(self) -> None:
        """
        SearchAd stat-reports는 level을 단일 문자열로 받는 케이스가 있어,
        list를 그대로 보내면 level이 무시될 수 있다.
        """
        from main import _searchad_create_report

        captured = {}

        def fake_post(uri: str, *, body: dict | None = None, timeout: float = 18.0):
            captured["uri"] = uri
            captured["body"] = body or {}
            r = MagicMock()
            r.status_code = 200
            r.json.return_value = {"reportJobId": "job-1"}
            r.text = ""
            return r

        with patch("main._searchad_post", new=fake_post):
            out = _searchad_create_report(
                report_tp="AD",
                stat_dt="20260110",
                levels=["campaign", "adgroup"],
                fields=["impCnt", "clkCnt"],
            )

        self.assertEqual(captured.get("uri"), "/stat-reports")
        body = captured.get("body") or {}
        self.assertEqual(body.get("level"), "campaign")
        self.assertIsInstance(body.get("level"), str)
        self.assertEqual(out.get("reportJobId"), "job-1")


if __name__ == "__main__":
    unittest.main()

