import unittest

from canonical_creative_features import normalize_creative_features
from historical_creative_evidence import (
    aggregate_performance_rows,
    build_historical_creative_evidence,
    compare_creative_features,
)


def _normalized(
    creative_id: str,
    *,
    product_visibility: str = "제품 노출",
    appeal_types: str = '["문제 제시형","행동 유도형"]',
    cta_type: str = "구매 유도",
    pain_points: str = '["새치 고민"]',
    buyer_stage: str = "purchase_ready",
) -> dict:
    return normalize_creative_features(
        creative_id=creative_id,
        image_analysis={
            "visual_subjects": '["여성 모델"]',
            "hair_condition_tags": '["새치 고민"]',
            "scene_tags": '["제품 사용 장면"]',
            "emotion_tags": "[]",
            "composition_tags": "[]",
            "color_mood_tags": "[]",
            "product_visibility": product_visibility,
        },
        copy_analysis={
            "primary_text": "지금 천연 헤나 구매",
            "headline": "",
            "description": "",
            "cta": "구매하기",
            "pain_points": pain_points,
            "appeal_types": appeal_types,
            "message_tone": "정보 전달형",
            "cta_type": cta_type,
            "analysis_json": f'{{"hook_type":"행동 유도형","buyer_stage":"{buyer_stage}"}}',
        },
    )


class HistoricalCreativeEvidenceTest(unittest.TestCase):
    def test_aggregation_recalculates_from_sums_not_ratio_average(self) -> None:
        rows = [
            {"creative_id": "a", "date": "2026-01-01", "impressions": 100, "clicks": 10, "cost": 1000, "purchase_conversions": 1, "purchase_revenue": 3000},
            {"creative_id": "a", "date": "2026-01-02", "impressions": 900, "clicks": 9, "cost": 9000, "purchase_conversions": 0, "purchase_revenue": 0},
        ]
        metrics = aggregate_performance_rows(rows)

        self.assertAlmostEqual(metrics["ctr"], 1.9)
        self.assertNotAlmostEqual(metrics["ctr"], 5.5)
        self.assertAlmostEqual(metrics["purchase_cvr"], 100 / 19)
        self.assertAlmostEqual(metrics["purchase_roas"], 30.0)
        self.assertEqual(metrics["raw_daily_row_count"], 2)
        self.assertEqual(metrics["creative_count"], 1)

    def test_similarity_excludes_campaign_and_explains_features(self) -> None:
        new_creative = _normalized("new")
        same_features = _normalized("old-a")
        different_campaign_same_features = {**same_features, "campaign_id": "campaign-a", "adgroup_id": "adgroup-a"}
        same_campaign_different_features = {
            **_normalized("old-b", product_visibility="제품 미노출", appeal_types='["공감형"]', cta_type="상세 확인", pain_points='["두피 자극 고민"]'),
            "campaign_id": "campaign-a",
            "adgroup_id": "adgroup-a",
        }

        strong = compare_creative_features(new_creative, different_campaign_same_features)
        weak = compare_creative_features(new_creative, same_campaign_different_features)

        self.assertGreater(strong["overall_similarity"], weak["overall_similarity"])
        self.assertIn("Campaign/adgroup identifiers are excluded", strong["selection_note"])
        self.assertGreater(len(strong["matched_features"]), 0)
        self.assertGreater(len(weak["unmatched_features"]), 0)

    def test_engine_returns_guardrails_and_concentration(self) -> None:
        new_creative = _normalized("new")
        history = [
            {
                "creative_id": "old-a",
                "normalized": _normalized("old-a"),
                "performance": aggregate_performance_rows([
                    {"creative_id": "old-a", "date": "2026-01-01", "impressions": 1000, "clicks": 20, "cost": 10000, "purchase_conversions": 2, "purchase_revenue": 20000}
                ]),
            },
            {
                "creative_id": "old-b",
                "normalized": _normalized("old-b", product_visibility="제품 미노출", cta_type="상세 확인"),
                "performance": aggregate_performance_rows([
                    {"creative_id": "old-b", "date": "2026-01-01", "impressions": 9000, "clicks": 90, "cost": 90000, "purchase_conversions": 4, "purchase_revenue": 40000}
                ]),
            },
        ]

        evidence = build_historical_creative_evidence(new_normalized=new_creative, historical_creatives=history, top_k=2)

        self.assertIsNone(evidence["forbidden_outputs"]["predicted_ctr"])
        self.assertIsNone(evidence["forbidden_outputs"]["causal_claim"])
        self.assertTrue(evidence["unknown_metric_semantics"]["mapped_partial_unknown_are_not_ui_coverage_ratio"])
        self.assertIn("top_creative_impression_share", evidence["similar_creative_evidence"]["concentration"])
        self.assertGreaterEqual(evidence["similar_creative_evidence"]["comparable_creative_count"], 1)
        self.assertGreater(len(evidence["feature_performance_evidence"]["features"]), 0)


if __name__ == "__main__":
    unittest.main()
