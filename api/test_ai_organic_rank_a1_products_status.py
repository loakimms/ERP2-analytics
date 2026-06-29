import unittest
from datetime import timedelta

from fastapi.testclient import TestClient

from db import SessionLocal, TrackedProductKeyword, TrackedProductRankDaily
from main import app, _today_kst


class TestAiOrganicRankA1ProductsStatus(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_products_includes_status_tier_and_prev_tier(self) -> None:
        """
        요구사항 기반 상품 상태:
        - 전주(7d ago): rank 1~3 키워드 >= 5 => VERY_STABLE
        - 오늘: rank 4~6 키워드 >= 5 => STABLE
        => status_change = DOWN
        """
        product_url = "https://smartstore.naver.com/testmall/products/999000000020?NaPm=ct%3Dxxx"
        product_url_base = "https://smartstore.naver.com/testmall/products/999000000020"
        keywords = [f"K{i}" for i in range(1, 6)]  # 5개

        # A-1 규칙 저장(기본 thresholds)
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
                            "prompt_templates": {"inputs_json": "입력", "outputs_template": "출력"},
                        },
                    }
                ],
            },
        )
        self.assertEqual(res_settings.status_code, 200)

        today = _today_kst()
        with SessionLocal() as db:
            # tracked 키워드 등록(상품 리스트 노출 조건)
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url.in_([product_url, product_url_base])).delete(
                synchronize_session=False
            )
            db.query(TrackedProductRankDaily).filter(TrackedProductRankDaily.product_url.in_([product_url, product_url_base])).delete(
                synchronize_session=False
            )
            db.commit()

            for kw in keywords:
                db.add(TrackedProductKeyword(product_url=product_url, keyword=kw, is_active=True))

            # 14일치: 전주(7d ago) rank=2, 오늘 rank=5 (delta +3)
            for i in range(14):
                d = today - timedelta(days=13 - i)
                rk = 2 if i < 7 else 5
                for kw in keywords:
                    db.add(TrackedProductRankDaily(date=d, product_url=product_url, keyword=kw, rank=int(rk), source="excel"))
            db.commit()

        res = self.client.post(
            "/ai/analyze/organic-rank/a1/products",
            json={"days": 30, "max_products": 10, "max_keywords_per_product": 30},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        items = data.get("products") or []
        self.assertGreaterEqual(len(items), 1)
        p0 = items[0]
        self.assertEqual(p0.get("product_url"), product_url_base)  # smartstore base 정규화
        self.assertEqual(p0.get("status_tier"), "STABLE")
        self.assertEqual(p0.get("status_prev_tier"), "VERY_STABLE")
        self.assertEqual(p0.get("status_change"), "DOWN")
        self.assertEqual(int((p0.get("band_counts") or {}).get("top_4_6") or 0), 5)
        self.assertEqual(int((p0.get("band_counts_prev") or {}).get("top_1_3") or 0), 5)


if __name__ == "__main__":
    unittest.main()

