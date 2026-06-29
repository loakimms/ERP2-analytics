import json
import unittest
import uuid

from fastapi.testclient import TestClient

from db import AiDecisionLog, AppSetting, SessionLocal
from main import app


class TestAiSettingsRecovery(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_put_refuses_empty_overwrite_by_default(self):
        # 1) 저장(정상)
        payload = {
            "format_version": "v2",
            "common_rules": "공통 규칙 예시",
            "rule_packs": [
                {
                    "id": "A-1",
                    "enabled": True,
                    "title": "t",
                    "a1": {
                        "surfaces": {"mobile_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}}},
                        "thresholds": {"stable": {"avg_rank_14d_max": 3.0}},
                        "prompt_templates": {"inputs_json": "{}", "outputs_template": "out"},
                    },
                }
            ],
        }
        res = self.client.put("/settings/ai", json=payload)
        self.assertEqual(res.status_code, 200)

        # 2) 실수로 빈 값 저장 시도 -> 차단되어야 한다.
        res2 = self.client.put("/settings/ai", json={"format_version": "v2", "common_rules": "", "rule_packs": []})
        self.assertEqual(res2.status_code, 409)

        # 3) 기존 값이 유지되는지 확인
        res3 = self.client.get("/settings/ai")
        self.assertEqual(res3.status_code, 200)
        data = res3.json()
        self.assertEqual(data.get("common_rules"), "공통 규칙 예시")
        self.assertEqual(((data.get("rule_packs") or [])[0] or {}).get("id"), "A-1")

    def test_restore_from_latest_ai_log(self):
        # 기존에 다른 규칙(A2 등)이 저장되어 있어도, restore-latest가 A-1만으로 "덮어쓰기"하면 안 된다(병합).
        res_seed = self.client.put(
            "/settings/ai",
            json={
                "format_version": "v2",
                "common_rules": "기존 공통",
                "rule_packs": [
                    {"id": "A2", "enabled": True, "title": "t2"},
                ],
            },
        )
        self.assertEqual(res_seed.status_code, 200)

        # 최신 ai_decision_log에 규칙 스냅샷이 남아있는 상황을 만든다.
        rules_pack = {
            "common_rules": "복구용 공통 규칙",
            "rule_id": "A-1",
            "title": "복구용 제목",
            "overview": "복구용 개요",
            "purpose": "복구용 목적",
            "inputs": "{\"a\":1}",
            "rules": "{\"thresholds\":{}}",
            "outputs": "복구용 출력 템플릿",
        }
        inputs_snapshot = {"analysis_type": "A-1", "rules": rules_pack, "data": {}, "requested_at": "2026-01-01T00:00:00Z"}
        with SessionLocal() as db:
            # 이전 실행의 잔재가 있어도 테스트가 안정적으로 동작하도록 정리
            db.query(AiDecisionLog).filter(AiDecisionLog.entity_id == "x||y").delete(synchronize_session=False)
            db.commit()
            log_id = f"test-log-restore-{uuid.uuid4()}"
            db.add(
                AiDecisionLog(
                    log_id=log_id,
                    analysis_type="A-1",
                    entity_type="SKU",
                    entity_id="x||y",
                    inputs_hash="h",
                    inputs_json=json.dumps(inputs_snapshot, ensure_ascii=False),
                    decision=None,
                    rules_triggered=None,
                    confidence=None,
                    recommended_actions=None,
                    analysis_text="",
                )
            )
            db.commit()

        # 복구 API 호출
        res = self.client.post("/settings/ai/restore-latest")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(bool((res.json() or {}).get("ok")))
        self.assertTrue(bool((res.json() or {}).get("restored")))

        # 복구 결과 확인
        res2 = self.client.get("/settings/ai")
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(str(data2.get("format_version") or ""), "v2")
        # 병합 정책:
        # - 기존 공통 규칙이 있으면 유지(빈 값일 때만 복구본 사용)
        self.assertEqual(data2.get("common_rules"), "기존 공통")
        packs = data2.get("rule_packs") or []
        ids = sorted([str(x.get("id") or "") for x in packs])
        self.assertIn("A2", ids)
        self.assertIn("A-1", ids)
        a1 = [x for x in packs if str(x.get("id") or "").upper().replace(" ", "") in ("A-1", "A1")]
        self.assertTrue(len(a1) >= 1)
        # restore-latest는 v1 로그를 v2로 승격하며, 출력 템플릿을 보존해야 한다.
        self.assertIn("복구용 출력 템플릿", json.dumps(a1[0], ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()

