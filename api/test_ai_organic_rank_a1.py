import json
import unittest
from datetime import timedelta
from unittest.mock import patch
import requests

from fastapi.testclient import TestClient

from db import AiDecisionLog, SessionLocal, TrackedProductRankDaily, AnalysisRun, AnalysisTraceNode
from main import app, _today_kst


class TestAiOrganicRankA1(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_a1_analyze_and_latest(self):
        product_url = "https://smartstore.naver.com/testmall/products/999000000010"
        keyword = "새치염색약"

        # 1) AI 세팅 저장(A-1 규칙 존재)
        res_settings = self.client.put(
            "/settings/ai",
            json={
                "format_version": "v2",
                "common_rules": "공통 규칙 예시",
                "rule_packs": [
                    {
                        "id": "A-1",
                        "enabled": True,
                        "title": "오가닉 순위 추적/변동성 분석",
                        "a1": {
                            "surfaces": {"mobile_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}}},
                            "thresholds": {
                                "stable": {"avg_rank_14d_max": 3.0, "rank_volatility_14d_max": 1.2, "down_days_14d_max": 2},
                                "unstable": {"avg_rank_14d_min": 4.0, "avg_rank_14d_max": 10.0, "rank_volatility_14d_min": 2.0, "drop_7d_min": 3, "drop_delta_min": 3},
                                "weak": {"avg_rank_14d_min": 11.0, "improve_days_7d_eq": 0},
                                "uncertain": {"min_valid_days_14d": 7, "missing_rank_value": 999},
                            },
                            "prompt_templates": {"inputs_json": "{\"a1\":\"inputs-json\"}", "outputs_template": "OUTPUT_TEMPLATE_V2"},
                        },
                    }
                ],
            },
        )
        self.assertEqual(res_settings.status_code, 200)

        # 2) 순위 데이터 30일치 삽입
        today = _today_kst()
        with SessionLocal() as db:
            db.query(TrackedProductRankDaily).filter(
                TrackedProductRankDaily.product_url == product_url,
                TrackedProductRankDaily.keyword == keyword,
            ).delete(synchronize_session=False)
            db.query(AiDecisionLog).filter(AiDecisionLog.entity_id == f"{product_url}||{keyword}").delete(
                synchronize_session=False
            )
            db.commit()

            for i in range(30):
                d = today - timedelta(days=29 - i)
                # 점진 개선(순위 숫자 ↓)
                rk = max(1, 20 - i // 2)
                db.add(
                    TrackedProductRankDaily(
                        date=d,
                        product_url=product_url,
                        keyword=keyword,
                        rank=int(rk),
                        source="excel",
                    )
                )
            db.commit()

        fake_llm = {
            "decision": "STABLE",
            "confidence": 0.82,
            "rules_triggered": ["avg_rank_14d<=3", "volatility<=1.2"],
            "trend": {"direction": "UP", "delta_7d": -2, "delta_1d": 0},
            "ad_recommendation": {"should_run_ads": False, "keywords": []},
            "recommended_actions": [
                {
                    "title": "오가닉 방어(현상 유지)",
                    "why": "최근 14일 평균 순위가 안정 구간",
                    "how": "리뷰/재고/가격 변동 모니터링",
                    "priority": "P1",
                    "evidence_refs": ["node:RankRowsQuery", "node:RulesDoc"],
                }
            ],
            "analysis_markdown": "## A-1 결과\n- STABLE\n",
        }

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": json.dumps(fake_llm, ensure_ascii=False)}}]}

        captured: dict = {}

        def fake_post(url, headers=None, json=None, timeout=None):
            captured["payload"] = json
            return FakeResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            res = self.client.post(
                "/ai/analyze/organic-rank/a1",
                json={"product_url": product_url, "keyword": keyword, "days": 30, "model": "gpt-4o-mini"},
            )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("analysis_type"), "A-1")
        self.assertEqual(data.get("decision"), "STABLE")
        self.assertTrue(str(data.get("analysis") or "").strip().startswith("## A-1 결과"))
        self.assertTrue(data.get("log_id"))
        # trace run_id가 반환되어야 한다(역추적 검증 연결)
        self.assertTrue(str(data.get("trace_run_id") or "").strip())
        self.assertTrue(str(data.get("trace_sku_id") or "").strip())
        # (중요) 단건 분석에서도 규칙 문서(inputs/outputs)가 LLM 메시지에 포함되어야 한다.
        msgs = (captured.get("payload") or {}).get("messages") or []
        joined = "\n".join([str((m or {}).get("content") or "") for m in msgs])
        self.assertIn("OUTPUT_TEMPLATE_V2", joined)
        self.assertIn("\"a1\":\"inputs-json\"", joined)

        # 3) latest 조회
        res2 = self.client.get(
            "/ai/analyze/organic-rank/a1/latest",
            params={"product_url": product_url, "keyword": keyword},
        )
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data2.get("decision"), "STABLE")

        # 4) 로그가 DB에 저장되었는지 확인
        with SessionLocal() as db:
            cnt = (
                db.query(AiDecisionLog)
                .filter(AiDecisionLog.analysis_type == "A-1", AiDecisionLog.entity_id == f"{product_url}||{keyword}")
                .count()
            )
            self.assertGreaterEqual(int(cnt or 0), 1)
            # trace 저장 확인(최소: AnalysisRun + 노드 1개 이상)
            run_id = str(data.get("trace_run_id") or "").strip()
            self.assertIsNotNone(db.query(AnalysisRun).filter(AnalysisRun.run_id == run_id).one_or_none())
            ncnt = db.query(AnalysisTraceNode).filter(AnalysisTraceNode.run_id == run_id).count()
            self.assertGreaterEqual(int(ncnt or 0), 1)

    def test_a1_portfolio_uses_rules_and_returns_items(self):
        product_url = "https://smartstore.naver.com/test/products/11043833896?NaPm=ct%3Dxxx"
        query_url = "https://smartstore.naver.com/test/products/11043833896"
        kw = "K1"

        # A-1 규칙 저장(입력/출력 텍스트도 포함)
        res_settings = self.client.put(
            "/settings/ai",
            json={
                "format_version": "v2",
                "common_rules": "공통 규칙",
                "rule_packs": [
                    {
                        "id": "A-1",
                        "enabled": True,
                        "title": "오가닉 순위 추적/변동성 분석",
                        "a1": {
                            "surfaces": {"mobile_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}}},
                            "thresholds": {
                                "stable": {"avg_rank_14d_max": 3.0, "rank_volatility_14d_max": 1.2, "down_days_14d_max": 2},
                                "unstable": {"avg_rank_14d_min": 4.0, "avg_rank_14d_max": 10.0, "rank_volatility_14d_min": 2.0, "drop_7d_min": 3, "drop_delta_min": 3},
                                "weak": {"avg_rank_14d_min": 11.0, "improve_days_7d_eq": 0},
                                "uncertain": {"min_valid_days_14d": 7, "missing_rank_value": 999},
                            },
                            "prompt_templates": {"inputs_json": "{\"a1\":\"inputs-json\"}", "outputs_template": "OUTPUT_TEMPLATE_V2"},
                        },
                    }
                ],
            },
        )
        self.assertEqual(res_settings.status_code, 200)

        today = _today_kst()
        with SessionLocal() as db:
            # 수기 키워드 meta 1개
            from db import TrackedProductManualKeyword

            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(
                synchronize_session=False
            )
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == product_url).delete(
                synchronize_session=False
            )
            db.commit()

            db.add(TrackedProductManualKeyword(product_url=product_url, keyword=kw, monthly_search_volume=1000, is_active=True))
            # rank 14일치: 상위권 안정
            for i in range(14):
                d = today - timedelta(days=13 - i)
                db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw, rank=2, source="excel"))
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": "## 요약\n- 테스트"}}]}

        captured: dict = {}

        def fake_post(url, headers=None, json=None, timeout=None):
            captured["url"] = url
            captured["payload"] = json
            return FakeResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            res = self.client.post("/ai/analyze/organic-rank/a1/portfolio", json={"days": 30, "max_items": 50})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("analysis_type"), "A-1")
        self.assertTrue(isinstance(data.get("items"), list))
        self.assertGreaterEqual(len(data.get("items") or []), 1)
        self.assertEqual(((data.get("rules_used") or {}).get("rule_id") or "").upper().replace(" ", ""), "A-1")
        self.assertEqual(((captured.get("payload") or {}).get("model") or ""), "gpt-5.2")
        # (중요) 규칙 문서(inputs/outputs)가 LLM 메시지에 명시적으로 포함되어야 한다.
        msgs = (captured.get("payload") or {}).get("messages") or []
        joined = "\n".join([str((m or {}).get("content") or "") for m in msgs])
        self.assertIn("OUTPUT_TEMPLATE_V2", joined)
        self.assertIn("\"a1\":\"inputs-json\"", joined)

    def test_a1_portfolio_thresholds_can_change(self):
        """
        규칙이 바뀌면(예: STABLE avg<=1로 강화) 판정도 즉시 바뀌어야 한다.
        """
        product_url = "https://smartstore.naver.com/test/products/11043833896?NaPm=ct%3Dxxx"
        kw = "K1"

        # STABLE 임계값을 avg<=1로 강화
        res_settings = self.client.put(
            "/settings/ai",
            json={
                "format_version": "v2",
                "common_rules": "공통 규칙",
                "rule_packs": [
                    {
                        "id": "A-1",
                        "enabled": True,
                        "title": "오가닉 순위 추적/변동성 분석",
                        "a1": {
                            "surfaces": {"mobile_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}}},
                            "thresholds": {
                                "stable": {"avg_rank_14d_max": 1.0, "rank_volatility_14d_max": 1.2, "down_days_14d_max": 2},
                                "unstable": {"avg_rank_14d_min": 4.0, "avg_rank_14d_max": 10.0, "rank_volatility_14d_min": 2.0, "drop_7d_min": 3, "drop_delta_min": 3},
                                "weak": {"avg_rank_14d_min": 11.0, "improve_days_7d_eq": 0},
                                "uncertain": {"min_valid_days_14d": 7, "missing_rank_value": 999},
                            },
                            "prompt_templates": {"inputs_json": "입력", "outputs_template": "출력"},
                        },
                    }
                ],
            },
        )
        self.assertEqual(res_settings.status_code, 200)

        today = _today_kst()
        with SessionLocal() as db:
            from db import TrackedProductManualKeyword

            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(
                synchronize_session=False
            )
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == product_url).delete(
                synchronize_session=False
            )
            db.commit()

            db.add(TrackedProductManualKeyword(product_url=product_url, keyword=kw, monthly_search_volume=1000, is_active=True))
            # avg_rank_14d = 2 (기존 STABLE이었지만, 강화 규칙에서는 STABLE 불가)
            for i in range(14):
                d = today - timedelta(days=13 - i)
                db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw, rank=2, source="excel"))
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": "## 요약\n- 테스트"}}]}

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()):
            res = self.client.post("/ai/analyze/organic-rank/a1/portfolio", json={"days": 30, "max_items": 50})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        items = data.get("items") or []
        self.assertGreaterEqual(len(items), 1)
        # avg=2가 STABLE 조건(avg<=1)을 만족하지 않으므로 STABLE이 아니어야 한다.
        self.assertNotEqual(items[0].get("decision"), "STABLE")
        parsed = (data.get("rules_used") or {}).get("parsed_thresholds") or {}
        self.assertEqual(float(((parsed.get("stable") or {}).get("avg_rank_14d_max") or 0)), 1.0)

    def test_a1_portfolio_openai_timeout_does_not_fail(self):
        """
        OpenAI가 타임아웃/네트워크 실패여도 502로 터지지 않고,
        규칙 기반 결과(items)를 반환해야 한다.
        """
        product_url = "https://smartstore.naver.com/test/products/11043833896?NaPm=ct%3Dxxx"
        kw = "K1"

        self.client.put(
            "/settings/ai",
            json={
                "common_rules": "공통 규칙",
                "analysis_rules": [{"id": "A-1", "title": "t", "overview": "", "purpose": "", "inputs": "", "rules": "STABLE\navg_rank_14d <= 3", "outputs": ""}],
            },
        )

        today = _today_kst()
        with SessionLocal() as db:
            from db import TrackedProductManualKeyword

            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == product_url).delete(synchronize_session=False)
            db.commit()

            db.add(TrackedProductManualKeyword(product_url=product_url, keyword=kw, monthly_search_volume=1000, is_active=True))
            for i in range(14):
                d = today - timedelta(days=13 - i)
                db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw, rank=2, source="excel"))
            db.commit()

        def raise_timeout(*_a, **_k):
            raise requests.exceptions.ReadTimeout("timeout")

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=raise_timeout):
            res = self.client.post("/ai/analyze/organic-rank/a1/portfolio", json={"days": 30, "max_items": 50})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(isinstance(body.get("items"), list))
        self.assertGreaterEqual(len(body.get("items") or []), 1)
        self.assertTrue(str(body.get("portfolio_error") or "").strip())

    def test_a1_products_and_product_detail(self):
        product_url = "https://smartstore.naver.com/test/products/11043833896"
        kw1 = "K1"
        kw2 = "K2"

        # AI 세팅은 없어도 기본값으로 동작해야 하지만, 테스트 안정성을 위해 v2를 저장
        res_settings = self.client.put(
            "/settings/ai",
            json={
                "format_version": "v2",
                "common_rules": "공통 규칙",
                "rule_packs": [{"id": "A-1", "enabled": True, "title": "오가닉 순위", "a1": {"thresholds": {}}}],
            },
        )
        self.assertEqual(res_settings.status_code, 200)

        today = _today_kst()
        with SessionLocal() as db:
            from db import TrackedProductManualKeyword, TrackedProductMeta, TrackedProductKeyword

            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == product_url).delete(synchronize_session=False)
            db.commit()

            db.add(TrackedProductMeta(product_url=product_url, title="상품명A"))
            # A-1 상품 리스트는 "내 상품 추적"(tracked_product_keyword) 등록 상품만 대상으로 해야 한다.
            db.add(TrackedProductKeyword(product_url=product_url, keyword=kw1, monthly_search_volume=1000, is_active=True))
            db.add(TrackedProductKeyword(product_url=product_url, keyword=kw2, monthly_search_volume=2000, is_active=True))
            db.add(TrackedProductManualKeyword(product_url=product_url, keyword=kw1, monthly_search_volume=1000, is_active=True))
            db.add(TrackedProductManualKeyword(product_url=product_url, keyword=kw2, monthly_search_volume=2000, is_active=True))

            # 14일치 rank: kw1은 하락(악화), kw2는 안정
            for i in range(14):
                d = today - timedelta(days=13 - i)
                db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw1, rank=10 + (i // 5), source="excel"))
                db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw2, rank=2, source="excel"))
            db.commit()

        # 상품 리스트
        res = self.client.post("/ai/analyze/organic-rank/a1/products", json={"days": 30, "max_products": 50})
        self.assertEqual(res.status_code, 200)
        body = res.json() or {}
        self.assertTrue(body.get("ok"))
        products = body.get("products") or []
        self.assertGreaterEqual(len(products), 1)
        titles = [str((p or {}).get("product_title") or "") for p in products if isinstance(p, dict)]
        self.assertIn("상품명A", titles)

        # 상품 상세
        res2 = self.client.get("/ai/analyze/organic-rank/a1/product/detail", params={"product_url": product_url, "days": 30})
        self.assertEqual(res2.status_code, 200)
        dbody = res2.json() or {}
        self.assertEqual(str(dbody.get("product_title") or ""), "상품명A")
        self.assertGreaterEqual(int(dbody.get("keyword_count") or 0), 2)
        kws = [str(x.get("keyword") or "") for x in (dbody.get("keywords") or []) if isinstance(x, dict)]
        self.assertIn(kw1, kws)
        self.assertIn(kw2, kws)

    def test_a1_product_gpt_creates_trace(self):
        product_url = "https://smartstore.naver.com/test/products/220000000001"
        kw1 = "K1"
        kw2 = "K2"

        today = _today_kst()
        with SessionLocal() as db:
            from db import TrackedProductManualKeyword, TrackedProductMeta

            db.query(TrackedProductManualKeyword).filter(TrackedProductManualKeyword.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == product_url).delete(synchronize_session=False)
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url == product_url).delete(synchronize_session=False)
            db.commit()

            db.add(TrackedProductMeta(product_url=product_url, title="상품명B"))
            db.add(TrackedProductManualKeyword(product_url=product_url, keyword=kw1, monthly_search_volume=1000, is_active=True))
            db.add(TrackedProductManualKeyword(product_url=product_url, keyword=kw2, monthly_search_volume=1000, is_active=True))
            for i in range(14):
                d = today - timedelta(days=13 - i)
                db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw1, rank=9, source="excel"))
                db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw2, rank=12, source="excel"))
            db.commit()

        fake_llm = {
            "decision": "UNSTABLE",
            "confidence": 0.6,
            "rules_triggered": ["sample"],
            "recommended_actions": [
                {"title": "액션A", "why": "이유", "how": "방법", "priority": "P0", "evidence_refs": ["node:RankRowsQuery", "node:RulesDoc"]}
            ],
            "analysis_markdown": "## 상품 요약\n- 테스트\n",
        }

        class FakeResp:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": json.dumps(fake_llm, ensure_ascii=False)}}]}

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()):
            res = self.client.post(
                "/ai/analyze/organic-rank/a1/product/gpt",
                json={"product_url": product_url, "days": 30, "model": "gpt-4o-mini", "keyword_mode": "specific", "keywords": [kw1, kw2]},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json() or {}
        self.assertTrue(body.get("ok"))
        self.assertTrue(str(body.get("trace_run_id") or "").strip())
        self.assertEqual(str(body.get("trace_sku_id") or ""), product_url)

        run_id = str(body.get("trace_run_id") or "").strip()
        with SessionLocal() as db:
            self.assertIsNotNone(db.query(AnalysisRun).filter(AnalysisRun.run_id == run_id).one_or_none())
            ncnt = db.query(AnalysisTraceNode).filter(AnalysisTraceNode.run_id == run_id, AnalysisTraceNode.sku_id == product_url).count()
            self.assertGreaterEqual(int(ncnt or 0), 1)


if __name__ == "__main__":
    unittest.main()

