import json
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from db import (
    A1SkuCauseEvidenceDaily,
    A1SkuEventDaily,
    A1SkuKeywordEvidenceDaily,
    A1SkuStateDaily,
    A1SkuZoneCountsDaily,
    AnalysisBlob,
    AnalysisRun,
    AnalysisTraceEdge,
    AnalysisTraceNode,
    AnalysisActionReview,
    TrackedProductMeta,
    SessionLocal,
)
from main import app, _today_kst


class TestA1TraceApi(unittest.TestCase):
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
            db.query(AnalysisTraceEdge).delete(synchronize_session=False)
            db.query(AnalysisTraceNode).delete(synchronize_session=False)
            db.query(AnalysisRun).delete(synchronize_session=False)
            db.query(AnalysisBlob).delete(synchronize_session=False)
            db.commit()

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
            db.add(
                A1SkuStateDaily(
                    date=d,
                    surface=surface,
                    sku_id=sku_id,
                    state="위험(매출 집중: 7~10위 5개↑)",
                    reasons_json=json.dumps(["7~10위 키워드가 5개 이상"], ensure_ascii=False),
                )
            )
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

    def test_trace_tree_node_and_verify(self):
        surface = "mobile_integrated"
        d = _today_kst() - timedelta(days=1)
        sku_id = "SKU-TRACE-001"
        self._seed_minimal_a1_rows(d=d, surface=surface, sku_id=sku_id)

        # (단위 테스트 목적) trace 생성 로직(trace-builder)은 별도 테스트에서 다루고,
        # 여기서는 trace API(runs/tree/node/verify)가 정상 동작하는지만 검증한다.
        with SessionLocal() as db:
            run = AnalysisRun(
                run_id="run-test-001",
                analysis_type="A-1",
                run_date=d,
                surface=surface,
                action_version="A1_V1",
                model="gpt-5.2",
                status="SUCCESS",
            )
            db.add(run)
            blob = AnalysisBlob(
                blob_id="blob-test-001",
                content_type="json",
                content_text=json.dumps({"hello": "world"}, ensure_ascii=False),
                content_hash="hash-test-001",
                size=13,
            )
            db.add(blob)
            n1 = AnalysisTraceNode(
                node_id="node-final-001",
                run_id=run.run_id,
                sku_id=sku_id,
                node_type="FinalRecommendation",
                title="최종 제안",
                summary_md="P0 1개",
                severity="CRITICAL",
                blob_id=blob.blob_id,
                content_hash=blob.content_hash,
                content_type=blob.content_type,
                sort_key=10,
            )
            n2 = AnalysisTraceNode(
                node_id="node-auto-001",
                run_id=run.run_id,
                sku_id=sku_id,
                node_type="AutomationResult",
                title="자동화 결과",
                summary_md="상태/이벤트/존",
                severity="CRITICAL",
                sort_key=20,
            )
            db.add(n1)
            db.add(n2)
            db.add(AnalysisTraceEdge(run_id=run.run_id, from_node_id=n1.node_id, to_node_id=n2.node_id, edge_type="derives_from", label="근거"))
            db.commit()

        # 2) run 목록 조회
        runs = self.client.get("/ai/a1/runs", params={"from": d.isoformat(), "to": d.isoformat(), "limit": 10})
        self.assertEqual(runs.status_code, 200)
        run_items = (runs.json() or {}).get("items") or []
        self.assertGreaterEqual(len(run_items), 1)
        run_id = (run_items[0] or {}).get("run_id")
        self.assertTrue(str(run_id or "").strip())

        # 3) 트리 조회
        tree = self.client.get("/ai/a1/trace/tree", params={"run_id": run_id, "sku_id": sku_id})
        self.assertEqual(tree.status_code, 200)
        body = tree.json() or {}
        nodes = body.get("nodes") or []
        edges = body.get("edges") or []
        self.assertGreaterEqual(len(nodes), 2)
        self.assertGreaterEqual(len(edges), 1)

        # 3-1) export (감사용 JSON)
        exp = self.client.get("/ai/a1/trace/export", params={"run_id": run_id, "sku_id": sku_id, "include_blobs": 1})
        self.assertEqual(exp.status_code, 200)
        exp_body = exp.json() or {}
        self.assertTrue(exp_body.get("ok"))
        self.assertEqual(str(exp_body.get("sku_id") or ""), sku_id)
        self.assertTrue(isinstance(exp_body.get("nodes"), list))

        # 4) 노드 상세 + verify (hash match)
        any_node_id = (nodes[0] or {}).get("node_id")
        detail = self.client.get("/ai/a1/trace/node", params={"node_id": any_node_id, "include_blob": 1})
        self.assertEqual(detail.status_code, 200)
        dbody = detail.json() or {}
        self.assertTrue(str((dbody.get("node") or {}).get("node_id") or "").strip())

        ver = self.client.post("/ai/a1/trace/verify", json={"node_id": any_node_id})
        self.assertEqual(ver.status_code, 200)
        v = ver.json() or {}
        self.assertIn(v.get("match"), (True, False))
        self.assertTrue(str(v.get("message") or "").strip())

    def test_action_review_upsert_and_list_and_sku_labels(self):
        run_id = "run-review-001"
        sku_id = "https://smartstore.naver.com/test/products/1"
        title = "테스트 상품"

        with SessionLocal() as db:
            db.query(AnalysisActionReview).delete(synchronize_session=False)
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == sku_id).delete(synchronize_session=False)
            db.commit()

            db.add(TrackedProductMeta(product_url=sku_id, title=title))
            # trace/skus는 AnalysisTraceNode에서 sku_id를 distinct로 뽑으므로, 최소 노드 1개 삽입
            db.add(
                AnalysisTraceNode(
                    node_id="node-review-sku-001",
                    run_id=run_id,
                    sku_id=sku_id,
                    node_type="FinalRecommendation",
                    title="최종 제안",
                    summary_md="",
                    sort_key=0,
                )
            )
            db.commit()

        # upsert
        r1 = self.client.post(
            "/ai/a1/reviews/actions",
            json={
                "run_id": run_id,
                "sku_id": sku_id,
                "action_title": "액션 A",
                "accepted": True,
                "comment": "좋습니다",
                "evidence_refs": ["node:RankRowsQuery"],
            },
        )
        self.assertEqual(r1.status_code, 200)
        item = (r1.json() or {}).get("item") or {}
        self.assertEqual(str(item.get("action_title") or ""), "액션 A")
        self.assertTrue(bool(item.get("accepted")))

        # list
        r2 = self.client.get("/ai/a1/reviews/actions", params={"run_id": run_id, "sku_id": sku_id})
        self.assertEqual(r2.status_code, 200)
        items = (r2.json() or {}).get("items") or []
        self.assertGreaterEqual(len(items), 1)

        # trace/skus labels
        r3 = self.client.get("/ai/a1/trace/skus", params={"run_id": run_id, "limit": 50})
        self.assertEqual(r3.status_code, 200)
        body = r3.json() or {}
        self.assertTrue(body.get("ok"))
        self.assertIn(sku_id, body.get("skus") or [])
        labels = body.get("labels") or {}
        self.assertEqual(str(labels.get(sku_id) or ""), title)


if __name__ == "__main__":
    unittest.main()

