import base64
import os
import unittest


class GfaCreativeGeneratorTest(unittest.TestCase):
    def test_combination_strategy_and_explanation_use_analysis_sources(self) -> None:
        import main

        brief = {
            "template_type": "problem_direct",
            "template_label": "문제 직격형",
            "template_structure": ["좌상단 문제", "중앙 감정 자극 이미지", "우측 해결/혜택", "하단 행동 이유 CTA"],
            "image_elements": "20대 여성, 헤어 클로즈업 / 손상모",
            "copy_elements": "키워드: 천연 헤나\n고민/욕구: 두피 자극",
            "opencv_elements": "밝음 / 텍스트 적정 / 얼굴 큼",
        }
        combo = main._gfa_generator_combination_strategy(brief=brief, candidate_index=2, candidate_count=3)
        self.assertEqual(combo["candidate_index"], 2)
        self.assertIn("OpenCV", "OpenCV")
        self.assertIn("두피 자극", combo["source_analysis_used"]["copy"])

        explanation = main._gfa_generator_explanation(
            brief=brief,
            combination=combo,
            copy_result={"cta": "두피 자극 줄이기"},
        )
        self.assertIn("두피 자극 줄이기", " ".join(explanation["why_copy"]))
        self.assertTrue(any("메시지 1개" in x for x in explanation["guide_checklist"]))

    def test_combination_strategy_respects_selected_template_structure(self) -> None:
        import main

        brief = {
            "template_type": "before_after",
            "template_label": "비포/애프터 비교형",
            "template_structure": ["좌측 문제 상태", "우측 해결 후 모습", "중앙 변화 메시지", "하단 변화 확인 CTA"],
            "image_elements": "천연 헤나, 새치 커버",
            "copy_elements": "자극 걱정 없이 자연스럽게",
            "opencv_elements": "좌우 비교에 적합한 밝은 이미지",
        }
        combo = main._gfa_generator_combination_strategy(brief=brief, candidate_index=1, candidate_count=3)
        self.assertEqual(combo["template_type"], "before_after")
        self.assertIn("비포/애프터", combo["selected_template_must_follow"])
        self.assertIn("좌측 문제 상태", combo["selected_template_structure"])
        self.assertIn("좌측", combo["visual_combination"]["composition"])
        self.assertIn("우측", combo["visual_combination"]["composition"])

    def test_extract_gemini_image_from_inline_data(self) -> None:
        import main

        raw = b"fake-png"
        body = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": base64.b64encode(raw).decode("ascii"),
                                }
                            }
                        ]
                    }
                }
            ]
        }
        data, mime = main._gfa_generator_extract_gemini_image(body)
        self.assertEqual(data, raw)
        self.assertEqual(mime, "image/png")

    def test_generation_event_to_dict(self) -> None:
        import main
        from db import NaverGfaCreativeGenerationEvent

        ev = NaverGfaCreativeGenerationEvent(
            event_id="ev1",
            run_id="run1",
            batch_id="batch1",
            event_type="ad_used",
            note="테스트 광고 소재로 사용",
            payload_json='{"used_creative_name":"A안"}',
        )
        out = main._gfa_generation_event_to_dict(ev)
        self.assertEqual(out["event_type"], "ad_used")
        self.assertEqual(out["payload"]["used_creative_name"], "A안")

    def test_banner_analysis_endpoint_uses_existing_gfa_criteria(self) -> None:
        os.environ["GFA_BANNER_ANALYSIS_TEST_FIXTURE"] = "1"
        try:
            import main
            from fastapi.testclient import TestClient

            client = TestClient(main.app)
            res = client.post(
                "/gfa/banner-analysis/analyze",
                files={"file": ("banner.png", b"not-a-real-image-but-fixture-mode", "image/png")},
                data={"note": "구매 전환 목적"},
            )
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertEqual(body["criteria"]["source"], "existing_gfa_creative_analysis_criteria")
            self.assertIn("alignment", body["criteria"]["score_targets"])
            self.assertTrue(any(x["key"] == "cta" for x in body["factor_scores"]))
            self.assertGreater(body["overall_score"], 0)
        finally:
            os.environ.pop("GFA_BANNER_ANALYSIS_TEST_FIXTURE", None)


if __name__ == "__main__":
    unittest.main()
