import unittest

from canonical_creative_features import (
    ONTOLOGY_VERSION,
    normalize_creative_features,
    summarize_normalization_results,
)


def _values(result: dict, feature: str) -> list[dict]:
    return [x for x in result["features"] if x["canonical_feature"] == feature]


class CanonicalCreativeFeaturesTest(unittest.TestCase):
    def test_person_terms_preserve_unknown_and_explicit_range(self) -> None:
        base_copy = {
            "cta_type": "구매 유도",
            "appeal_types": '["행동 유도형"]',
            "pain_points": '["미분류"]',
            "analysis_json": '{"buyer_stage":"purchase_ready"}',
        }

        female_model = normalize_creative_features(
            creative_id="c1",
            image_analysis={
                "visual_subjects": '["여성 모델"]',
                "hair_condition_tags": "[]",
                "scene_tags": "[]",
                "emotion_tags": "[]",
                "composition_tags": "[]",
                "color_mood_tags": "[]",
                "product_visibility": "제품 미노출",
            },
            copy_analysis=base_copy,
        )
        self.assertTrue(any(x["canonical_value"] == "female" for x in _values(female_model, "gender")))
        self.assertTrue(all(x["canonical_value"] != "middle_age" for x in _values(female_model, "age_group")))

        age_range = normalize_creative_features(
            creative_id="c2",
            image_analysis={
                "visual_subjects": '["40~60대 여성"]',
                "hair_condition_tags": "[]",
                "scene_tags": "[]",
                "emotion_tags": "[]",
                "composition_tags": "[]",
                "color_mood_tags": "[]",
                "product_visibility": "제품 미노출",
            },
            copy_analysis=base_copy,
        )
        self.assertTrue(any(x["canonical_value"] == "female" for x in _values(age_range, "gender")))
        self.assertTrue(any(x["canonical_value"] == "40_69" for x in _values(age_range, "age_range")))
        self.assertTrue(all(x["canonical_value"] != "middle_age" for x in _values(age_range, "age_group")))

        middle_age = normalize_creative_features(
            creative_id="c3",
            image_analysis={
                "visual_subjects": '["중년 여성"]',
                "hair_condition_tags": "[]",
                "scene_tags": "[]",
                "emotion_tags": "[]",
                "composition_tags": "[]",
                "color_mood_tags": "[]",
                "product_visibility": "제품 미노출",
            },
            copy_analysis=base_copy,
        )
        self.assertTrue(any(x["canonical_value"] == "middle_age" for x in _values(middle_age, "age_group")))
        self.assertFalse(any(x["canonical_value"] == "40_69" for x in _values(middle_age, "age_range")))

    def test_mixed_field_routing_preserves_lineage(self) -> None:
        result = normalize_creative_features(
            creative_id="c4",
            image_analysis={
                "visual_subjects": '["헤어 클로즈업"]',
                "hair_condition_tags": '["푸석함","갈색","베이지 배경"]',
                "scene_tags": '["자연 배경","헤나 사용 장면"]',
                "emotion_tags": "[]",
                "composition_tags": '["좌우 비교"]',
                "color_mood_tags": "[]",
                "product_visibility": "부분 노출",
            },
            copy_analysis={
                "cta_type": "상세 확인",
                "appeal_types": '["문제 제시형","신뢰형"]',
                "pain_points": '["새치 고민"]',
                "primary_text": "천연 헤나로 새치 고민 확인",
                "headline": "",
                "description": "",
                "cta": "자세히 보기",
                "analysis_json": '{"hook_type":"문제-혜택 압축형","buyer_stage":"solution_aware"}',
            },
        )

        self.assertTrue(any(x["canonical_value"] == "present" for x in _values(result, "hair_damage")))
        self.assertTrue(any(x["canonical_value"] == "brown" for x in _values(result, "color_tone")))
        self.assertTrue(any(x["canonical_value"] == "present" for x in _values(result, "natural_background")))
        self.assertTrue(any(x["canonical_value"] == "present" for x in _values(result, "before_after")))
        self.assertTrue(any(x["canonical_value"] == "medium" for x in _values(result, "product_visibility")))

        lineage = [x for x in _values(result, "color_tone") if x["canonical_value"] == "brown"][0]
        self.assertEqual(lineage["source_field"], "hair_condition_tags")
        self.assertEqual(lineage["raw_value"], "갈색")
        self.assertIn(lineage["normalization_status"], {"NORMALIZED", "PARTIAL"})

    def test_summary_is_deterministic_and_preserves_versions(self) -> None:
        image = {
            "visual_subjects": '["중년 여성","헤어 클로즈업"]',
            "hair_condition_tags": '["새치 고민","윤기"]',
            "scene_tags": '["식물성 질감","BeforeAfter"]',
            "emotion_tags": "[]",
            "composition_tags": '["중앙 분할"]',
            "color_mood_tags": '["그린톤"]',
            "product_visibility": "제품 노출",
        }
        copy = {
            "cta_type": "구매 유도",
            "appeal_types": '["문제 제시형","행동 유도형"]',
            "pain_points": '["새치 고민"]',
            "primary_text": "지금 천연 헤나 구매",
            "headline": "",
            "description": "",
            "cta": "구매하기",
            "analysis_json": '{"hook_type":"행동 유도형","buyer_stage":"purchase_ready"}',
        }

        first = normalize_creative_features(creative_id="c5", image_analysis=image, copy_analysis=copy)
        second = normalize_creative_features(creative_id="c5", image_analysis=image, copy_analysis=copy)

        self.assertEqual(first, second)
        self.assertEqual(first["ontology_version"], ONTOLOGY_VERSION)
        self.assertGreater(first["summary"]["mapped_values"], 0)
        self.assertGreaterEqual(first["summary"]["unknown_values"], 0)

        summary = summarize_normalization_results([first, second])
        self.assertEqual(summary["total_creatives"], 2)
        self.assertGreater(summary["mapped_values"], 0)
        self.assertIn("gender", summary["feature_coverage"])


if __name__ == "__main__":
    unittest.main()
