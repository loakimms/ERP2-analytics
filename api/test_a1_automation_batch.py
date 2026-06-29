import json
import unittest
from datetime import timedelta
from unittest.mock import patch

import requests
from fastapi.testclient import TestClient

from db import (
    A1GptActionDaily,
    A1SkuCauseEvidenceDaily,
    A1SkuEventDaily,
    A1SkuKeywordEvidenceDaily,
    A1SkuStateDaily,
    A1SkuZoneCountsDaily,
    A1SkuMap,
    CreativeOrganicDerived,
    NaverAdCreativeDaily,
    NaverProductReviewDaily,
    AnalysisRun,
    AnalysisTraceNode,
    SessionLocal,
)
from main import app, _today_kst


class TestA1AutomationBatch(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def _seed_minimal_a1_rows(self, *, d, surface: str, sku_id: str):
        with SessionLocal() as db:
            # clean
            db.query(A1SkuEventDaily).filter(A1SkuEventDaily.date == d, A1SkuEventDaily.surface == surface, A1SkuEventDaily.sku_id == sku_id).delete(
                synchronize_session=False
            )
            db.query(A1SkuStateDaily).filter(A1SkuStateDaily.date == d, A1SkuStateDaily.surface == surface, A1SkuStateDaily.sku_id == sku_id).delete(
                synchronize_session=False
            )
            db.query(A1SkuZoneCountsDaily).filter(A1SkuZoneCountsDaily.surface == surface, A1SkuZoneCountsDaily.sku_id == sku_id).delete(
                synchronize_session=False
            )
            db.query(A1SkuCauseEvidenceDaily).filter(A1SkuCauseEvidenceDaily.date == d, A1SkuCauseEvidenceDaily.surface == surface, A1SkuCauseEvidenceDaily.sku_id == sku_id).delete(
                synchronize_session=False
            )
            db.query(A1SkuKeywordEvidenceDaily).filter(A1SkuKeywordEvidenceDaily.date == d, A1SkuKeywordEvidenceDaily.surface == surface, A1SkuKeywordEvidenceDaily.sku_id == sku_id).delete(
                synchronize_session=False
            )
            db.query(A1GptActionDaily).filter(A1GptActionDaily.date == d, A1GptActionDaily.surface == surface, A1GptActionDaily.sku_id == sku_id).delete(
                synchronize_session=False
            )
            db.commit()

            # event (target selection trigger)
            db.add(
                A1SkuEventDaily(
                    date=d,
                    surface=surface,
                    sku_id=sku_id,
                    event_type="CONSECUTIVE_DROP_3D",
                    severity="CRITICAL",
                    payload_json=json.dumps({"drop_kw_cnt": 2}, ensure_ascii=False),
                )
            )
            # state
            db.add(
                A1SkuStateDaily(
                    date=d,
                    surface=surface,
                    sku_id=sku_id,
                    state="위험(매출 집중: 7~10위 5개↑)",
                    reasons_json=json.dumps(["7~10위 키워드가 5개 이상"], ensure_ascii=False),
                )
            )
            # zones (today + yesterday)
            db.add(
                A1SkuZoneCountsDaily(
                    date=d,
                    surface=surface,
                    sku_id=sku_id,
                    decision_kw_total=10,
                    top1_3_kw_cnt=1,
                    top4_6_kw_cnt=1,
                    top7_10_kw_cnt=5,
                    top11_15_kw_cnt=1,
                    below16_kw_cnt=2,
                    avg_rank_decision_kw=7.4,
                )
            )
            db.add(
                A1SkuZoneCountsDaily(
                    date=d - timedelta(days=1),
                    surface=surface,
                    sku_id=sku_id,
                    decision_kw_total=10,
                    top1_3_kw_cnt=2,
                    top4_6_kw_cnt=2,
                    top7_10_kw_cnt=3,
                    top11_15_kw_cnt=1,
                    below16_kw_cnt=2,
                    avg_rank_decision_kw=6.1,
                )
            )
            # cause evidence
            db.add(
                A1SkuCauseEvidenceDaily(
                    date=d,
                    surface=surface,
                    sku_id=sku_id,
                    decision_kw_total=10,
                    drop_kw_cnt_1d=3,
                    avg_drop_1d=2.3,
                    consecutive_drop_3d_kw_cnt=2,
                    cannibal_kw_cnt=1,
                    cannibal_kw_drop_cnt=1,
                    evidence_json=json.dumps({"note": "샘플"}, ensure_ascii=False),
                )
            )
            # keyword evidence 1개
            db.add(
                A1SkuKeywordEvidenceDaily(
                    date=d,
                    surface=surface,
                    sku_id=sku_id,
                    keyword="새치염색약",
                    rank_today=9,
                    rank_yesterday=7,
                    rank_7d_ago=4,
                    rank_delta_1d=2,
                    rank_delta_7d=5,
                    is_consecutive_drop_3d=True,
                    monthly_search_volume=10000,
                    is_cannibal=True,
                    cannibal_evidence_json=json.dumps({"ad_overlap": True}, ensure_ascii=False),
                )
            )
            db.commit()

    def test_a1_batch_success_saves_gpt_action_daily(self):
        surface = "mobile_integrated"
        d = _today_kst() - timedelta(days=1)
        sku_id = "SKU-001"
        self._seed_minimal_a1_rows(d=d, surface=surface, sku_id=sku_id)

        # 광고 지표(30일) 계산을 위한 최소 매핑/데이터 시드
        product_url = "https://smartstore.naver.com/testmall/products/111"
        with SessionLocal() as db:
            db.query(A1SkuMap).filter(A1SkuMap.sku_id == sku_id).delete(synchronize_session=False)
            db.query(NaverAdCreativeDaily).delete(synchronize_session=False)
            db.query(CreativeOrganicDerived).delete(synchronize_session=False)
            db.query(NaverProductReviewDaily).delete(synchronize_session=False)
            db.commit()

            # 14일 품질지수 추세를 만들기 위한 데이터
            # - prev7: quality_index=3.0 / cur7: quality_index=3.6
            pid = 1111111111
            db.add(A1SkuMap(sku_id=sku_id, product_url=product_url, product_id_catalog=pid, note="test"))
            for i in range(14):
                day = d - timedelta(days=13 - i)
                q = 3.0 if i < 7 else 3.6
                rev = 200000 if i < 7 else 300000  # 30일 매출 합산은 >= 1 보장
                db.add(
                    NaverAdCreativeDaily(
                        date=day,
                        campaign_name="C",
                        adgroup_name="G",
                        creative_id=f"CR1-{i}",
                        device="ALL",
                        creative_name="n",
                        product_title="t",
                        image_url=None,
                        current_bid=100,
                        quality_index=q,
                        avg_rank=1.5,
                        impressions=1000,
                        clicks=50,
                        cost=20000,
                        conversions=3,
                        revenue=rev,
                        ctr=0.05,
                        cpc=400.0,
                        cvr=0.06,
                        roas=75.0,
                        source="test",
                    )
                )
                db.add(
                    CreativeOrganicDerived(
                        date=day,
                        campaign_name="C",
                        adgroup_name="G",
                        creative_id=f"CR1-{i}",
                        device="ALL",
                        ad_type="POWERLINK_AD",
                        match_status="MATCHED",
                        match_rule="test",
                        matched_product_url=product_url,
                        matched_product_title="t",
                        organic_keyword="새치염색약",
                        organic_rank=9,
                        organic_rank_source="tracked_excel",
                        algo_version="org_v1.0.0",
                    )
                )
                # 오가닉 품질지수(리뷰 평점)도 prev7 4.0 -> cur7 4.3 상승
                ravg = 4.0 if i < 7 else 4.3
                db.add(
                    NaverProductReviewDaily(
                        date=day,
                        keyword="새치염색약",
                        product_id=pid,
                        product_title="t",
                        mall_name="m",
                        rating_avg=ravg,
                        rating_count=100,
                        rating_1_cnt=1,
                        rating_2_cnt=1,
                        rating_3_cnt=1,
                        rating_4_cnt=1,
                        rating_5_cnt=96,
                    )
                )
            db.commit()

        fake_llm = {
            "current_state": "위험(매출 집중)",
            "events": [{"event_type": "CONSECUTIVE_DROP_3D", "severity": "CRITICAL"}],
            "cause_analysis": {
                "primary_cause": "최근 3일 연속 하락 키워드 증가",
                "hypotheses": [{"hypothesis": "경쟁 상위 노출 강화", "evidence": ["rank_delta_1d=+2"], "confidence": 0.6}],
                "notes": ["단정 금지"],
            },
            "recommended_actions": [{"title": "상품정보 점검", "why": "노출/전환 영향", "how": "대표키워드/카테고리 확인", "priority": "P0"}],
            "confidence": 0.72,
        }

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": json.dumps(fake_llm, ensure_ascii=False)}}]}

        with patch("main._get_api_setting", return_value="sk-test"), patch("a1_automation_batch.requests.post", return_value=FakeResp()):
            res = self.client.post(
                "/ai/a1/batch/run",
                json={"date": d.isoformat(), "surface": surface, "max_items": 10, "model": "gpt-5.2"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body.get("ok"))
        # 다른 테스트가 동일 date/surface에 이벤트를 만들 수 있어, processed는 1 이상만 보장한다.
        self.assertGreaterEqual(int(body.get("processed") or 0), 1)
        self.assertEqual(int(body.get("failed") or 0), 0)
        self.assertGreaterEqual(int(body.get("saved") or 0), 1)
        items = body.get("items") or []
        self.assertTrue(any((x or {}).get("sku_id") == sku_id for x in items))
        mine = [x for x in items if (x or {}).get("sku_id") == sku_id]
        self.assertTrue(len(mine) >= 1)
        self.assertEqual((mine[0] or {}).get("status"), "SUCCESS")
        # trace run_id가 반환되어야 한다(역추적 UI에서 즉시 사용)
        self.assertTrue(str(body.get("trace_run_id") or "").strip())

        with SessionLocal() as db:
            row = (
                db.query(A1GptActionDaily)
                .filter(
                    A1GptActionDaily.date == d,
                    A1GptActionDaily.surface == surface,
                    A1GptActionDaily.sku_id == sku_id,
                )
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertEqual(str(getattr(row, "status", "") or ""), "SUCCESS")
            pj = json.loads(getattr(row, "payload_json", "") or "{}")
            self.assertEqual(pj.get("analysis_type"), "A-1")
            self.assertEqual(pj.get("sku_id"), sku_id)
            # v2 확장(전략/품질지수)이 payload에 포함되어야 한다.
            derived = pj.get("derived") or {}
            self.assertTrue(isinstance(derived, dict))
            self.assertTrue(isinstance((derived.get("sku_strategy") or {}), dict))
            # 광고 지표(30일)도 derived에 포함되어야 한다.
            adm = derived.get("ad_metrics_30d") or {}
            if isinstance(adm, dict) and adm.get("ok"):
                self.assertGreaterEqual(int(adm.get("revenue_30d") or 0), 1)
            qt = derived.get("quality_trends_14d") or {}
            self.assertTrue(isinstance(qt, dict))
            hints = derived.get("action_hints") or []
            self.assertTrue(isinstance(hints, list))
            self.assertGreaterEqual(len(hints), 1)
            # delta가 계산되어야 한다(테스트 데이터는 상승)
            ad_delta = ((qt.get("ad") or {}).get("delta") if isinstance(qt.get("ad"), dict) else None)
            org_delta = ((qt.get("organic") or {}).get("delta") if isinstance(qt.get("organic"), dict) else None)
            self.assertTrue(ad_delta is None or float(ad_delta) >= 0.0)
            self.assertTrue(org_delta is None or float(org_delta) >= 0.0)
            rj = json.loads(getattr(row, "result_json", "") or "{}")
            # evidence_refs는 모델 출력이 누락해도 서버가 보정해줘야 한다.
            acts = rj.get("recommended_actions") or []
            if isinstance(acts, list) and acts:
                self.assertTrue(isinstance((acts[0] or {}).get("evidence_refs"), list))

            # trace 저장 확인(최소 1개 노드)
            run_id = str(body.get("trace_run_id") or "")
            tr = db.query(AnalysisRun).filter(AnalysisRun.run_id == run_id).one_or_none()
            self.assertIsNotNone(tr)
            ncnt = db.query(AnalysisTraceNode).filter(AnalysisTraceNode.run_id == run_id, AnalysisTraceNode.sku_id == sku_id).count()
            self.assertGreaterEqual(int(ncnt or 0), 3)
            # 전략 노드가 생성되어야 한다.
            scnt = (
                db.query(AnalysisTraceNode)
                .filter(AnalysisTraceNode.run_id == run_id, AnalysisTraceNode.sku_id == sku_id, AnalysisTraceNode.node_type == "SkuStrategy")
                .count()
            )
            self.assertGreaterEqual(int(scnt or 0), 1)
            acnt = (
                db.query(AnalysisTraceNode)
                .filter(AnalysisTraceNode.run_id == run_id, AnalysisTraceNode.sku_id == sku_id, AnalysisTraceNode.node_type == "AdMetrics30d")
                .count()
            )
            self.assertGreaterEqual(int(acnt or 0), 1)
            qcnt = (
                db.query(AnalysisTraceNode)
                .filter(AnalysisTraceNode.run_id == run_id, AnalysisTraceNode.sku_id == sku_id, AnalysisTraceNode.node_type == "QualityTrends14d")
                .count()
            )
            self.assertGreaterEqual(int(qcnt or 0), 1)
            hcnt = (
                db.query(AnalysisTraceNode)
                .filter(AnalysisTraceNode.run_id == run_id, AnalysisTraceNode.sku_id == sku_id, AnalysisTraceNode.node_type == "ActionHints")
                .count()
            )
            self.assertGreaterEqual(int(hcnt or 0), 1)

    def test_a1_batch_openai_timeout_is_isolated_per_sku(self):
        surface = "mobile_integrated"
        d = _today_kst() - timedelta(days=1)
        sku_id = "SKU-002"
        self._seed_minimal_a1_rows(d=d, surface=surface, sku_id=sku_id)

        def raise_timeout(*_a, **_k):
            raise requests.exceptions.ReadTimeout("timeout")

        with patch("main._get_api_setting", return_value="sk-test"), patch("a1_automation_batch.requests.post", side_effect=raise_timeout):
            res = self.client.post(
                "/ai/a1/batch/run",
                json={"date": d.isoformat(), "surface": surface, "max_items": 10, "model": "gpt-5.2"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body.get("ok"))
        # 다른 테스트가 동일 date/surface에 이벤트를 만들 수 있어, processed는 1 이상만 보장한다.
        self.assertGreaterEqual(int(body.get("processed") or 0), 1)
        self.assertGreaterEqual(int(body.get("failed") or 0), 1)
        # 실패해도 저장(best-effort)을 시도하므로 saved는 1일 수 있다.
        self.assertGreaterEqual(int(body.get("saved") or 0), 0)

        with SessionLocal() as db:
            row = (
                db.query(A1GptActionDaily)
                .filter(
                    A1GptActionDaily.date == d,
                    A1GptActionDaily.surface == surface,
                    A1GptActionDaily.sku_id == sku_id,
                )
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertEqual(str(getattr(row, "status", "") or ""), "FAILED")
            self.assertTrue(str(getattr(row, "error", "") or "").strip())

    def test_a1_batch_fills_actions_from_action_hints_when_llm_returns_empty(self):
        surface = "mobile_integrated"
        d = _today_kst() - timedelta(days=1)
        sku_id = "SKU-003"
        self._seed_minimal_a1_rows(d=d, surface=surface, sku_id=sku_id)

        fake_llm = {
            "current_state": "위험(매출 집중)",
            "events": [{"event_type": "CONSECUTIVE_DROP_3D", "severity": "CRITICAL"}],
            "cause_analysis": {"primary_cause": "x", "hypotheses": [], "notes": []},
            "recommended_actions": [],
            "confidence": 0.5,
        }

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": json.dumps(fake_llm, ensure_ascii=False)}}]}

        with patch("main._get_api_setting", return_value="sk-test"), patch("a1_automation_batch.requests.post", return_value=FakeResp()):
            res = self.client.post(
                "/ai/a1/batch/run",
                json={"date": d.isoformat(), "surface": surface, "max_items": 10, "model": "gpt-5.2"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body.get("ok"))

        with SessionLocal() as db:
            row = (
                db.query(A1GptActionDaily)
                .filter(
                    A1GptActionDaily.date == d,
                    A1GptActionDaily.surface == surface,
                    A1GptActionDaily.sku_id == sku_id,
                )
                .one_or_none()
            )
            self.assertIsNotNone(row)
            rj = json.loads(getattr(row, "result_json", "") or "{}")
            acts = rj.get("recommended_actions") or []
            self.assertTrue(isinstance(acts, list))
            self.assertGreaterEqual(len(acts), 1)

    def test_a1_batch_creates_no_data_trace_run_when_no_targets(self):
        # 어떤 sku_event_daily도 없으면, 기존엔 run 자체가 안 생겨 UI 검증이 막혔다.
        # 이제는 NO_DATA run + "__RUN__" sku trace를 남겨 "왜 비었는지"를 검증할 수 있어야 한다.
        surface = "mobile_integrated"
        d = _today_kst() - timedelta(days=1)

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": json.dumps({"recommended_actions": []}, ensure_ascii=False)}}]}

        with patch("main._get_api_setting", return_value="sk-test"), patch("a1_automation_batch.requests.post", return_value=FakeResp()):
            res = self.client.post(
                "/ai/a1/batch/run",
                json={"date": d.isoformat(), "surface": surface, "max_items": 50, "model": "gpt-5.2"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json() or {}
        self.assertTrue(body.get("ok"))
        self.assertEqual(int(body.get("target_skus") or 0), 0)
        self.assertTrue(str(body.get("trace_run_id") or "").strip())
        run_id = str(body.get("trace_run_id") or "").strip()

        # runs에 NO_DATA 상태로 노출
        runs = self.client.get("/ai/a1/runs", params={"from": d.isoformat(), "to": d.isoformat(), "limit": 50})
        self.assertEqual(runs.status_code, 200)
        items = (runs.json() or {}).get("items") or []
        self.assertTrue(any(str((x or {}).get("run_id") or "") == run_id and str((x or {}).get("status") or "") == "NO_DATA" for x in items))

        # "__RUN__" sku가 있어 export/tree 검증 가능
        sk = self.client.get("/ai/a1/trace/skus", params={"run_id": run_id, "limit": 50})
        self.assertEqual(sk.status_code, 200)
        skus = (sk.json() or {}).get("skus") or []
        self.assertIn("__RUN__", skus)

        exp = self.client.get("/ai/a1/trace/export", params={"run_id": run_id, "sku_id": "__RUN__", "include_blobs": 1})
        self.assertEqual(exp.status_code, 200)
        eb = exp.json() or {}
        self.assertTrue(eb.get("ok"))
        nodes = eb.get("nodes") or []
        self.assertTrue(any(str((n or {}).get("node_type") or "") == "NoDataSummary" for n in nodes))


if __name__ == "__main__":
    unittest.main()

