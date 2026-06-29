import unittest
from datetime import date
from unittest.mock import patch


class AiAnalyzeAdsTest(unittest.TestCase):
    def test_ai_analyze_ads_campaign_uses_db_data_and_returns_analysis(self) -> None:
        from fastapi.testclient import TestClient
        import main
        from schemas import CampaignDailyAgg

        client = TestClient(main.app)

        fake_rows = [
            CampaignDailyAgg(
                date=date(2026, 1, 22),
                campaign_name="CAMP_A",
                campaign_status="ELIGIBLE",
                is_active=True,
                impressions=1000,
                clicks=50,
                cost=10000,
                conversions=5,
                revenue=30000,
                ctr=5.0,
                cpc=200.0,
                cvr=10.0,
                roas=300.0,
            )
        ]

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"role": "assistant", "content": "분석 결과"}}], "model": "gpt-4o-mini"}

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"분석 결과"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.list_campaign_daily", return_value=fake_rows), patch(
            "main.list_adgroup_daily", return_value=[]
        ), patch("main.requests.post", return_value=FakeResp()):
            resp = client.post(
                "/ai/analyze/ads",
                json={
                    "level": "campaign",
                    "date_from": "2026-01-22",
                    "date_to": "2026-01-22",
                    "source": "creative",
                    "question": "요약해줘",
                    "model": "gpt-4o-mini",
                },
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        data = resp.json() or {}
        self.assertTrue(data.get("ok"))
        self.assertIn("analysis", data)
        self.assertIn("분석 결과", data.get("analysis", ""))
        self.assertEqual(data.get("meta", {}).get("level"), "campaign")

    def test_ai_analyze_ads_returns_400_when_key_missing(self) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)
        with patch("main._get_api_setting", return_value=""):
            resp = client.post("/ai/analyze/ads", json={"level": "campaign", "date_from": "2026-01-22"})
        self.assertEqual(resp.status_code, 400, msg=resp.text)
        self.assertIn("OPENAI_API_KEY", resp.text)

    def test_ai_analyze_ads_accepts_thread_for_followup(self) -> None:
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"role": "assistant", "content": "후속 답변"}}], "model": "gpt-4o-mini"}

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"후속 답변"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.list_campaign_daily", return_value=[]), patch(
            "main.list_adgroup_daily", return_value=[]
        ), patch("main.requests.post", return_value=FakeResp()):
            resp = client.post(
                "/ai/analyze/ads",
                json={
                    "level": "campaign",
                    "date_from": "2026-01-22",
                    "date_to": "2026-01-22",
                    "source": "creative",
                    "thread": [
                        {"role": "user", "content": "첫 질문"},
                        {"role": "assistant", "content": "첫 답변"},
                    ],
                    "question": "추가 질문",
                    "model": "gpt-4o-mini",
                },
            )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertIn("후속 답변", (resp.json() or {}).get("analysis", ""))


if __name__ == "__main__":
    unittest.main()

