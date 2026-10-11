import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch
import json

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from db import (
    AnalyticsJobRun,
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyDraft,
    ReviewReplyFeedbackKnowledge,
    TrackedProductKeyword,
    TrackedProductMeta,
    SessionLocal,
    init_db,
)


class ReviewReplyDraftApiTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        seller_center_states = iter(
            [{"state": "not_replied", "reason": "test_precheck"}]
        )
        seller_center_patch = patch(
            "main._seller_center_review_comment_state",
            side_effect=lambda *args, **kwargs: next(
                seller_center_states, {"state": "replied", "reason": "test_post_verify"}
            ),
        )
        seller_center_patch.start()
        self.addCleanup(seller_center_patch.stop)
        with SessionLocal() as db:
            db.query(AnalyticsJobRun).delete(synchronize_session=False)
            db.query(ReviewReplyFeedbackKnowledge).delete(synchronize_session=False)
            db.query(NaverReviewReplyRaw).delete(synchronize_session=False)
            db.query(ReviewReplyDraft).delete(synchronize_session=False)
            db.query(TrackedProductKeyword).delete(synchronize_session=False)
            db.query(TrackedProductMeta).delete(synchronize_session=False)
            db.query(NaverReviewRaw).delete(synchronize_session=False)
            db.commit()

    def _insert_review(
        self,
        *,
        review_key: str = "naver_review:rv-1",
        product_url: str = "https://smartstore.naver.com/testmall/products/1000",
        review_text: str = "향이 좋고 두피가 편안해요.",
        option_text: str | None = "라벤더",
        rating: float | None = 5.0,
        reply_text: str | None = None,
    ) -> str:
        with SessionLocal() as db:
            db.add(
                NaverReviewRaw(
                    review_key=review_key,
                    product_url=product_url,
                    review_id_original="rv-1",
                    review_written_at=date(2024, 3, 15),
                    rating=rating,
                    option_text=option_text,
                    review_text=review_text,
                    reviewer_masked_id="user****",
                    text_hash="hash-1",
                )
            )
            if reply_text:
                db.add(
                    NaverReviewReplyRaw(
                        review_key=review_key,
                        reply_text=reply_text,
                        reply_written_at=date(2024, 3, 16),
                    )
                )
            db.commit()
        return review_key

    def _insert_draft(
        self,
        *,
        draft_id: str,
        review_key: str,
        status: str,
        draft_text: str,
        model_name: str = "gpt-test",
        prompt_version: str = "review_reply_v1",
    ) -> None:
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id=draft_id,
                    review_key=review_key,
                    status=status,
                    draft_text=draft_text,
                    model_name=model_name,
                    prompt_version=prompt_version,
                )
            )
            db.commit()

    def _insert_tracked_product(
        self,
        *,
        product_url: str,
        keyword: str,
        title: str,
    ) -> None:
        with SessionLocal() as db:
            db.add(
                TrackedProductKeyword(
                    product_url=product_url,
                    keyword=keyword,
                    is_active=True,
                )
            )
            db.add(
                TrackedProductMeta(
                    product_url=product_url,
                    title=title,
                    keyword=keyword,
                )
            )
            db.commit()

    def _mark_auto_post_ready(self, *review_keys: str) -> None:
        with SessionLocal() as db:
            for review_key in review_keys:
                row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
                row.review_written_at = main._today_kst() - timedelta(days=1)
                for draft in db.query(ReviewReplyDraft).filter(ReviewReplyDraft.review_key == review_key).all():
                    draft.prompt_version = main.REVIEW_REPLY_PROMPT_VERSION
                    draft.generated_at = datetime.now(timezone.utc)
            db.commit()

    def _set_review_reply_flags(
        self,
        *,
        review_key: str,
        reply_exists_flag: bool | None = None,
        reply_collect_status: str | None = None,
    ) -> None:
        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            if reply_exists_flag is not None:
                row.reply_exists_flag = reply_exists_flag
            row.reply_collect_status = reply_collect_status
            db.commit()

    def test_generate_review_reply_draft_reuses_existing_draft(self) -> None:
        review_key = self._insert_review()
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-1",
                    review_key=review_key,
                    status="generated",
                    draft_text="기존 초안입니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        with patch("main.requests.post") as mp:
            resp = self.client.post("/reviews/reply-drafts/generate", json={"review_key": review_key})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertFalse(body["generated_now"])
        self.assertEqual(body["draft_text"], "기존 초안입니다.")
        self.assertFalse(mp.called)

    def test_generate_review_reply_draft_rejects_already_replied_review(self) -> None:
        review_key = self._insert_review(reply_text="이미 판매자 답글이 등록되었습니다.")

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post") as mp:
            resp = self.client.post("/reviews/reply-drafts/generate", json={"review_key": review_key})

        self.assertEqual(resp.status_code, 409, msg=resp.text)
        self.assertIn("이미 판매자 답글", resp.text)
        self.assertFalse(mp.called)

    def test_generate_review_reply_draft_calls_openai_and_saves_row(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:rv-2",
            review_text="두피 자극이 거의 없고 향도 좋아서 만족했습니다.",
            option_text="브라운",
            rating=4.0,
        )

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 소중한 후기 감사합니다. 만족하셨다니 정말 기쁩니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                    "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()) as mp:
            resp = self.client.post(
                "/reviews/reply-drafts/generate",
                json={"review_key": review_key, "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["generated_now"])
        self.assertEqual(body["review_key"], review_key)
        self.assertEqual(body["model_name"], "gpt-test")
        self.assertIn("소중한 후기", body["draft_text"])
        self.assertTrue(mp.called)

        with SessionLocal() as db:
            rows = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.review_key == review_key).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].status, "generated")
            self.assertIn("소중한 후기", rows[0].draft_text)

    def test_generate_review_reply_draft_uses_max_completion_tokens_for_gpt5_family(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:gpt5-1",
            review_text="부드럽고 만족스럽습니다.",
            rating=5.0,
        )
        captured_payloads: list[dict] = []

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 소중한 후기 감사합니다.",
                            }
                        }
                    ],
                    "model": "gpt-5.2",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        def fake_post(*args, **kwargs):
            captured_payloads.append(dict(kwargs.get("json") or {}))
            return FakeResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            resp = self.client.post("/reviews/reply-drafts/generate", json={"review_key": review_key, "model": "gpt-5.2"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertTrue(captured_payloads)
        payload = captured_payloads[0]
        self.assertEqual(payload.get("model"), "gpt-5.2")
        self.assertEqual(payload.get("max_completion_tokens"), 220)
        self.assertNotIn("max_tokens", payload)

    def test_generate_review_reply_draft_retries_when_max_tokens_is_rejected(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:compat-retry",
            review_text="은은한 향이라 만족합니다.",
            rating=5.0,
        )
        captured_payloads: list[dict] = []

        class FailResp:
            status_code = 400

            def json(self):
                return {
                    "error": {
                        "message": 'Unsupported parameter: "max_tokens" is not supported with this model. Use "max_completion_tokens" instead.',
                        "type": "invalid_request_error",
                        "param": "max_tokens",
                        "code": "unsupported_parameter",
                    }
                }

            @property
            def text(self):
                return '{"error":{"message":"Unsupported parameter: max_tokens","param":"max_tokens","code":"unsupported_parameter"}}'

        class OkResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 소중한 후기 감사합니다.",
                            }
                        }
                    ],
                    "model": "legacy-model",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        def fake_post(*args, **kwargs):
            payload = dict(kwargs.get("json") or {})
            captured_payloads.append(payload)
            if len(captured_payloads) == 1:
                self.assertEqual(payload.get("max_tokens"), 220)
                return FailResp()
            self.assertEqual(payload.get("max_completion_tokens"), 220)
            self.assertNotIn("max_tokens", payload)
            return OkResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            resp = self.client.post("/reviews/reply-drafts/generate", json={"review_key": review_key, "model": "legacy-model"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertEqual(len(captured_payloads), 2)

    def test_generate_review_reply_draft_returns_friendly_openai_error_message(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:friendly-error",
            review_text="향이 만족스럽습니다.",
            rating=5.0,
        )

        class FailResp:
            status_code = 400

            def json(self):
                return {
                    "error": {
                        "message": 'Unsupported parameter: "max_tokens" is not supported with this model. Use "max_completion_tokens" instead.',
                        "type": "invalid_request_error",
                        "param": "max_tokens",
                        "code": "unsupported_parameter",
                    }
                }

            @property
            def text(self):
                return '{"error":{"message":"Unsupported parameter","param":"max_tokens","code":"unsupported_parameter"}}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FailResp()):
            resp = self.client.post("/reviews/reply-drafts/generate", json={"review_key": review_key, "model": "legacy-model"})

        self.assertEqual(resp.status_code, 502, msg=resp.text)
        self.assertIn("모델 토큰 파라미터 호환", resp.text)

    def test_reply_style_corpus_summary_counts_actual_and_approved_only(self) -> None:
        review_key_1 = self._insert_review(
            review_key="naver_review:style-1",
            product_url="https://smartstore.naver.com/testmall/products/7001",
            review_text="향이 좋고 만족합니다.",
            rating=5.0,
            reply_text="안녕하세요 고객님, 소중한 후기 감사합니다.",
        )
        review_key_2 = self._insert_review(
            review_key="naver_review:style-2",
            product_url="https://smartstore.naver.com/testmall/products/7001",
            review_text="배송은 빠른데 향은 조금 아쉬워요.",
            rating=3.0,
        )
        review_key_3 = self._insert_review(
            review_key="naver_review:style-3",
            product_url="https://smartstore.naver.com/testmall/products/7001",
            review_text="재구매 의사 있어요.",
            rating=5.0,
        )
        self._insert_draft(
            draft_id="draft-approved-style",
            review_key=review_key_2,
            status="approved",
            draft_text="안녕하세요 고객님, 향 부분은 더 만족하실 수 있도록 계속 개선하겠습니다.",
        )
        self._insert_draft(
            draft_id="draft-generated-style",
            review_key=review_key_3,
            status="generated",
            draft_text="학습에 포함되면 안 되는 draft",
        )

        resp = self.client.get(
            "/reviews/reply-style/corpus-summary",
            params={"product_url": "https://smartstore.naver.com/testmall/products/7001", "limit": 20},
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["total_examples"], 2)
        self.assertEqual((body.get("source_counts") or {}).get("actual_reply"), 1)
        self.assertEqual((body.get("source_counts") or {}).get("approved_draft"), 1)
        self.assertEqual((body.get("source_counts") or {}).get("generated"), None)
        self.assertIn("positive", body.get("review_type_counts") or {})

    def test_generate_review_reply_draft_uses_style_profile_and_v3_prompt(self) -> None:
        history_key = self._insert_review(
            review_key="naver_review:style-history",
            product_url="https://smartstore.naver.com/testmall/products/7101",
            review_text="정말 만족스러워요.",
            rating=5.0,
            reply_text="안녕하세요 고객님, 소중한 후기 감사합니다. 앞으로도 만족하실 수 있도록 노력하겠습니다.",
        )
        self.assertEqual(history_key, "naver_review:style-history")
        target_key = self._insert_review(
            review_key="naver_review:style-target",
            product_url="https://smartstore.naver.com/testmall/products/7101",
            review_text="향이 좋고 재구매 의사 있어요.",
            rating=5.0,
        )

        captured_payloads: list[dict] = []

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 소중한 후기 감사합니다. 앞으로도 만족하실 수 있도록 최선을 다하겠습니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        def fake_post(*args, **kwargs):
            captured_payloads.append(kwargs.get("json") or {})
            return FakeResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            resp = self.client.post(
                "/reviews/reply-drafts/generate",
                json={"review_key": target_key, "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["prompt_version"], "review_reply_v2")
        self.assertEqual(body["review_type"], "positive")
        self.assertGreaterEqual(int(body["style_examples_count"]), 1)
        self.assertTrue(str(body["style_profile_source"]).startswith("product"))
        self.assertTrue(captured_payloads)
        messages = captured_payloads[0].get("messages") or []
        joined = "\n".join(str(m.get("content") or "") for m in messages if isinstance(m, dict))
        self.assertIn("스타일 참고", joined)
        self.assertIn("상품별", joined)
        self.assertEqual(body["style_level"], 3)
        self.assertEqual(body["style_preset_id"], "balanced")

    def test_generate_review_reply_draft_accepts_style_level_preset(self) -> None:
        self._insert_review(
            review_key="naver_review:preset-history",
            product_url="https://smartstore.naver.com/testmall/products/7151",
            review_text="배송이 빠르고 만족합니다.",
            rating=5.0,
            reply_text="안녕하세요 고객님, 소중한 후기 감사합니다. 앞으로도 만족하실 수 있도록 노력하겠습니다.",
        )
        target_key = self._insert_review(
            review_key="naver_review:preset-target",
            product_url="https://smartstore.naver.com/testmall/products/7151",
            review_text="향이 정말 좋고 선물용으로도 괜찮아요.",
            rating=5.0,
        )

        captured_payloads: list[dict] = []

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 정성스러운 후기 남겨주셔서 진심으로 감사합니다. 선물용으로도 만족하셨다니 더욱 기쁩니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        def fake_post(*args, **kwargs):
            captured_payloads.append(kwargs.get("json") or {})
            return FakeResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            resp = self.client.post(
                "/reviews/reply-drafts/generate",
                json={"review_key": target_key, "model": "gpt-4o-mini", "style_level": 5},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["style_level"], 5)
        self.assertEqual(body["style_preset_id"], "warm")
        self.assertTrue(captured_payloads)
        messages = captured_payloads[0].get("messages") or []
        joined = "\n".join(str(m.get("content") or "") for m in messages if isinstance(m, dict))
        self.assertIn("스타일 강도: 5단계", joined)
        self.assertIn("감사/공감 표현을 더 풍부하게", joined)

    def test_generate_review_reply_draft_regenerates_when_style_level_changes(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:preset-regenerate",
            product_url="https://smartstore.naver.com/testmall/products/7152",
            review_text="향이 깔끔해서 만족합니다.",
            rating=5.0,
        )
        self._insert_draft(
            draft_id="draft-style-old",
            review_key=review_key,
            status="generated",
            draft_text="기존 3단계 초안",
            prompt_version="review_reply_v2",
        )
        with SessionLocal() as db:
            row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == "draft-style-old").one()
            row.style_level = 3
            row.style_preset_id = "balanced"
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 만족스러운 사용감 남겨주셔서 진심으로 감사합니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()) as mp:
            resp = self.client.post(
                "/reviews/reply-drafts/generate",
                json={"review_key": review_key, "style_level": 5},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["generated_now"])
        self.assertEqual(body["style_level"], 5)
        self.assertTrue(mp.called)

    def test_reply_style_preset_recommendations_returns_adjustable_fields(self) -> None:
        self._insert_review(
            review_key="naver_review:preset-rec-1",
            product_url="https://smartstore.naver.com/testmall/products/7201",
            review_text="만족합니다.",
            rating=5.0,
            reply_text="안녕하세요 고객님, 소중한 후기 감사합니다.",
        )

        resp = self.client.get(
            "/reviews/reply-style/preset-recommendations",
            params={"product_url": "https://smartstore.naver.com/testmall/products/7201"},
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        presets = body.get("presets") or []
        self.assertEqual(len(presets), 6)
        self.assertEqual(presets[0]["level"], 1)
        self.assertEqual(presets[-1]["id"], "custom")
        self.assertEqual(presets[-1]["name"], "사용자정의")
        item_ids = {item["id"] for item in (body.get("recommended_fields") or [])}
        self.assertIn("greeting_density", item_ids)
        self.assertIn("gratitude_intensity", item_ids)
        self.assertIn("empathy_intensity", item_ids)
        self.assertIn("detail_depth", item_ids)
        self.assertIn("closing_strength", item_ids)

    def test_generate_review_reply_draft_accepts_custom_style_controls(self) -> None:
        self._insert_review(
            review_key="naver_review:custom-style-history",
            product_url="https://smartstore.naver.com/testmall/products/7210",
            review_text="만족스럽습니다.",
            rating=5.0,
            reply_text="안녕하세요 고객님, 소중한 후기 감사합니다.",
        )
        target_key = self._insert_review(
            review_key="naver_review:custom-style-target",
            product_url="https://smartstore.naver.com/testmall/products/7210",
            review_text="향이 좋아서 재구매하고 싶어요.",
            rating=5.0,
        )
        captured_payloads: list[dict] = []

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 후기 남겨주셔서 감사합니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        def fake_post(*args, **kwargs):
            captured_payloads.append(kwargs.get("json") or {})
            return FakeResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            resp = self.client.post(
                "/reviews/reply-drafts/generate",
                json={
                    "review_key": target_key,
                    "model": "gpt-4o-mini",
                    "style_level": 6,
                    "style_controls": {
                        "greeting_density": 5,
                        "gratitude_intensity": 4,
                        "empathy_intensity": 2,
                        "detail_depth": 3,
                        "closing_strength": 1,
                    },
                },
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["style_level"], 6)
        self.assertEqual(body["style_preset_id"], "custom")
        self.assertEqual(body["style_preset_name"], "사용자정의")
        messages = captured_payloads[0].get("messages") or []
        joined = "\n".join(str(m.get("content") or "") for m in messages if isinstance(m, dict))
        self.assertIn("사용자정의", joined)
        self.assertIn("인사", joined)

    def test_review_workbench_returns_latest_reviews_and_completion_states(self) -> None:
        review_key_1 = self._insert_review(
            review_key="naver_review:workbench-1",
            product_url="https://smartstore.naver.com/testmall/products/7301",
            review_text="최근 작성된 리뷰입니다.",
            rating=5.0,
        )
        review_key_2 = self._insert_review(
            review_key="naver_review:workbench-2",
            product_url="https://smartstore.naver.com/testmall/products/7301",
            review_text="답글 존재만 확인된 리뷰입니다.",
            rating=4.0,
        )
        review_key_3 = self._insert_review(
            review_key="naver_review:workbench-3",
            product_url="https://smartstore.naver.com/testmall/products/7301",
            review_text="승인된 초안이 있는 리뷰입니다.",
            rating=5.0,
        )
        with SessionLocal() as db:
            row1 = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key_1).one()
            row2 = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key_2).one()
            row3 = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key_3).one()
            row1.review_written_at = date(2024, 3, 20)
            row2.review_written_at = date(2024, 3, 18)
            row3.review_written_at = date(2024, 3, 19)
            row2.reply_exists_flag = True
            row2.reply_collect_status = "pending"
            db.add(
                TrackedProductMeta(
                    product_url="https://smartstore.naver.com/testmall/products/7301",
                    title="테스트 상품명 7301",
                )
            )
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-workbench-approved",
                    review_key=review_key_3,
                    status="approved",
                    draft_text="관리자가 승인한 답글",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    style_level=3,
                    style_preset_id="balanced",
                )
            )
            db.commit()

        resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/7301",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["dashboard"]["total_reviews"], 3)
        self.assertEqual(body["dashboard"]["completed_count"], 0)
        self.assertEqual(body["dashboard"]["enrichment_target_count"], 1)
        self.assertEqual(body["dashboard"]["approved_count"], 1)
        self.assertEqual(body["dashboard"]["draft_pending_count"], 0)
        self.assertEqual(body["dashboard"]["rejected_count"], 0)
        self.assertEqual(body["dashboard"]["unreplied_count"], 2)
        items = body["items"]
        self.assertEqual([item["review_key"] for item in items], [review_key_1, review_key_3, review_key_2])
        by_key = {item["review_key"]: item for item in items}
        self.assertEqual(by_key[review_key_2]["reply_status"], "enrichment_target")
        self.assertEqual(by_key[review_key_2]["reply_status_label"], "보강 대상")
        self.assertEqual(by_key[review_key_1]["product_title"], "테스트 상품명 7301")
        self.assertEqual(by_key[review_key_3]["draft_status"], "approved")
        self.assertTrue(by_key[review_key_3]["can_copy"])
        self.assertFalse(by_key[review_key_1]["can_copy"])

    def test_review_workbench_dashboard_counts_use_full_filtered_set_beyond_item_limit(self) -> None:
        with SessionLocal() as db:
            rows = []
            for idx in range(2001):
                review_key = f"naver_review:bulk-{idx:04d}"
                rows.append(
                    NaverReviewRaw(
                        review_key=review_key,
                        product_url="https://smartstore.naver.com/testmall/products/7301",
                        product_title="대량 테스트 상품",
                        review_id_original=f"bulk-rv-{idx:04d}",
                        review_written_at=date(2024, 3, 31),
                        rating=5.0,
                        review_text=f"리뷰 {idx}",
                        reviewer_masked_id="user****",
                        text_hash=f"hash-{idx}",
                        reply_exists_flag=(idx == 0),
                        reply_collect_status=("pending" if idx == 0 else "not_needed"),
                    )
                )
            db.bulk_save_objects(rows)
            db.commit()

        resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/7301",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
                "limit": 2000,
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(len(body["items"]), 2000)
        self.assertEqual(body["dashboard"]["total_reviews"], 2001)
        self.assertEqual(body["dashboard"]["enrichment_target_count"], 1)

    def test_resolve_review_reply_status_requires_reply_flag_and_text_for_completed(self) -> None:
        status, label = main._resolve_review_reply_status(
            reply_exists_flag=True,
            reply_text="실제 판매자 답글",
            reply_collect_status=None,
            draft_status=None,
        )
        self.assertEqual((status, label), ("completed", "완료"))

        status, label = main._resolve_review_reply_status(
            reply_exists_flag=True,
            reply_text="",
            reply_collect_status=None,
            draft_status=None,
        )
        self.assertEqual((status, label), ("enrichment_target", "보강 대상"))

        status, label = main._resolve_review_reply_status(
            reply_exists_flag=False,
            reply_text="본문만 수집된 상태",
            reply_collect_status=None,
            draft_status=None,
        )
        self.assertEqual((status, label), ("enrichment_target", "보강 대상"))

        status, label = main._resolve_review_reply_status(
            reply_exists_flag=False,
            reply_text=None,
            reply_collect_status="seller_deleted",
            draft_status="approved",
        )
        self.assertEqual((status, label), ("completed", "완료"))

        status, label = main._resolve_review_reply_status(
            reply_exists_flag=False,
            reply_text=None,
            reply_collect_status="seller_blocked",
            draft_status="approved",
        )
        self.assertEqual((status, label), ("completed", "완료"))

    def test_review_id_matches_exact_numeric_token_without_dynamic_regex(self) -> None:
        self.assertTrue(main._review_id_matches_text_boundary("리뷰글번호 4941257154", "4941257154"))
        self.assertTrue(main._review_id_matches_text_boundary("review_id=4941257154 / 처리대상", "4941257154"))
        self.assertFalse(main._review_id_matches_text_boundary("리뷰글번호 14941257154", "4941257154"))
        self.assertFalse(main._review_id_matches_text_boundary("리뷰글번호 없음", "4941257154"))

    def test_review_workbench_dashboard_includes_rejected_count_from_full_db_set(self) -> None:
        review_key_new = self._insert_review(
            review_key="naver_review:dashboard-new",
            product_url="https://smartstore.naver.com/testmall/products/7302",
            review_text="아직 초안이 없는 리뷰입니다.",
            rating=5.0,
        )
        review_key_rejected = self._insert_review(
            review_key="naver_review:dashboard-rejected",
            product_url="https://smartstore.naver.com/testmall/products/7302",
            review_text="반려된 초안이 있는 리뷰입니다.",
            rating=3.0,
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-dashboard-rejected",
                    review_key=review_key_rejected,
                    status="rejected",
                    draft_text="반려된 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                )
            )
            db.commit()

        resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/7302",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
                "limit": 1,
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["dashboard"]["total_reviews"], 2)
        self.assertEqual(body["dashboard"]["new_reviews"], 1)
        self.assertEqual(body["dashboard"]["rejected_count"], 1)
        self.assertEqual(body["dashboard"]["unreplied_count"], 2)

    def test_review_workbench_separates_rejection_history_from_current_status(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:dashboard-rewrite-history",
            product_url="https://smartstore.naver.com/testmall/products/7303",
            review_text="반려 후 재작성된 리뷰입니다.",
            rating=2.0,
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-history-rejected",
                    review_key=review_key,
                    status="rejected",
                    draft_text="감사만 반복한 반려 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    rejection_comment="고객 불만에 대한 공감이 없습니다.",
                )
            )
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-history-generated",
                    review_key=review_key,
                    status="generated",
                    draft_text="불편을 드려 죄송합니다. 배송 지연을 확인하겠습니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    rejection_comment="고객 불만에 대한 공감이 없습니다.",
                )
            )
            db.commit()

        resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/7303",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["dashboard"]["total_reviews"], 1)
        self.assertEqual(body["dashboard"]["draft_pending_count"], 1)
        self.assertEqual(body["dashboard"]["rejected_count"], 0)
        self.assertEqual(body["dashboard"]["rejection_history_count"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["reply_status"], "pending")
        self.assertTrue(body["items"][0]["has_rejection_history"])
        self.assertEqual(body["items"][0]["rejection_history_count"], 1)

        filtered_resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/7303",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
                "has_rejection_history_only": "true",
            },
        )
        self.assertEqual(filtered_resp.status_code, 200, msg=filtered_resp.text)
        filtered_body = filtered_resp.json()
        self.assertEqual([item["review_key"] for item in filtered_body["items"]], [review_key])
        self.assertEqual(filtered_body["dashboard"]["rejection_history_count"], 1)

    def test_review_workbench_applies_rating_filters_to_dashboard_and_items(self) -> None:
        review_key_5 = self._insert_review(
            review_key="naver_review:dashboard-rating-5",
            product_url="https://smartstore.naver.com/testmall/products/7305",
            review_text="5점 신규 리뷰",
            rating=5.0,
        )
        review_key_4 = self._insert_review(
            review_key="naver_review:dashboard-rating-4",
            product_url="https://smartstore.naver.com/testmall/products/7305",
            review_text="4점 검토대기 리뷰",
            rating=4.0,
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-dashboard-rating-4",
                    review_key=review_key_4,
                    status="generated",
                    draft_text="4점 검토대기 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                )
            )
            db.commit()

        resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/7305",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
                "rating_filters": ["5"],
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["dashboard"]["total_reviews"], 1)
        self.assertEqual(body["dashboard"]["new_reviews"], 1)
        self.assertEqual(body["dashboard"]["draft_pending_count"], 0)
        self.assertEqual([item["review_key"] for item in body["items"]], [review_key_5])

    def test_review_workbench_status_filter_returns_matching_items_beyond_default_window(self) -> None:
        review_key_new = self._insert_review(
            review_key="naver_review:workbench-status-new",
            product_url="https://smartstore.naver.com/testmall/products/7306",
            review_text="최신 미작성 리뷰",
            rating=5.0,
        )
        review_key_pending = self._insert_review(
            review_key="naver_review:workbench-status-pending",
            product_url="https://smartstore.naver.com/testmall/products/7306",
            review_text="오래된 검토대기 리뷰",
            rating=5.0,
        )
        with SessionLocal() as db:
            newer = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key_new).one()
            older = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key_pending).one()
            newer.review_written_at = date(2024, 3, 31)
            older.review_written_at = date(2024, 3, 1)
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-workbench-status-pending",
                    review_key=review_key_pending,
                    status="generated",
                    draft_text="검토대기 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                )
            )
            db.commit()

        resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/7306",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
                "status_filter": "pending",
                "limit": 1,
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["dashboard"]["total_reviews"], 2)
        self.assertEqual(body["dashboard"]["new_reviews"], 1)
        self.assertEqual(body["dashboard"]["draft_pending_count"], 1)
        self.assertEqual([item["review_key"] for item in body["items"]], [review_key_pending])

    def test_review_workbench_excludes_incomplete_product_page_stub_rows(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/7303"
        with SessionLocal() as db:
            db.add(
                NaverReviewRaw(
                    review_key="naver_review:rich-7303",
                    product_url=product_url,
                    product_title="테스트 상품명 7303",
                    review_id_original="rv-rich-7303",
                    review_written_at=date(2024, 3, 31),
                    rating=5.0,
                    option_text="브라운",
                    review_text="한달사용 진심 그렇게 오랜시간 염색약 바르고 있었던적은 처음이라 걱정했는데 얼마나 순하고 두피에 안전하면 그럴까 생각하니 좋더라고요",
                    reviewer_masked_id="ppol****",
                    text_hash="hash-rich-7303",
                    import_source="smartstore_product_page",
                )
            )
            db.add(
                NaverReviewRaw(
                    review_key="naver_review_hash:stub-7303",
                    product_url=product_url,
                    product_title="테스트 상품명 7303",
                    review_id_original=None,
                    review_written_at=date(2024, 3, 31),
                    rating=None,
                    option_text=None,
                    review_text="진심 그렇게 오랜시간 염색약 바르고 있었던적은 처음이라 걱정했는데 얼마나 순하고 두피에 안전하면 그럴까 생각하니 좋더라고요",
                    reviewer_masked_id=None,
                    text_hash="hash-stub-7303",
                    import_source="smartstore_product_page",
                )
            )
            db.commit()

        resp = self.client.get(
            "/reviews/workbench",
            params={
                "product_url": product_url,
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["dashboard"]["total_reviews"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["review_key"], "naver_review:rich-7303")

    def test_cleanup_incomplete_product_page_stubs_deletes_only_safe_matches(self) -> None:
        product_url = "https://smartstore.naver.com/testmall/products/7304"
        with SessionLocal() as db:
            rich_row = NaverReviewRaw(
                review_key="naver_review:rich-7304",
                product_url=product_url,
                product_title="테스트 상품명 7304",
                review_id_original="rv-rich-7304",
                review_written_at=date(2024, 3, 31),
                rating=5.0,
                option_text="레드",
                review_text="한달사용 진심 그렇게 오랜시간 염색약 바르고 있었던적은 처음이라 걱정했는데 얼마나 순하고 두피에 안전하면 그럴까 생각하니 좋더라고요",
                reviewer_masked_id="ppol****",
                text_hash="hash-rich-7304",
                import_source="smartstore_product_page",
            )
            stub_row = NaverReviewRaw(
                review_key="naver_review_hash:stub-7304",
                product_url=product_url,
                product_title="테스트 상품명 7304",
                review_id_original=None,
                review_written_at=date(2024, 3, 31),
                rating=None,
                option_text=None,
                review_text="진심 그렇게 오랜시간 염색약 바르고 있었던적은 처음이라 걱정했는데 얼마나 순하고 두피에 안전하면 그럴까 생각하니 좋더라고요",
                reviewer_masked_id=None,
                text_hash="hash-stub-7304",
                import_source="smartstore_product_page",
            )
            unmatched_stub = NaverReviewRaw(
                review_key="naver_review_hash:stub-7304-unmatched",
                product_url=product_url,
                product_title="테스트 상품명 7304",
                review_id_original=None,
                review_written_at=date(2024, 3, 30),
                rating=None,
                option_text=None,
                review_text="전혀 다른 본문이라서 안전하게 매칭되면 안 됩니다.",
                reviewer_masked_id=None,
                text_hash="hash-stub-7304-unmatched",
                import_source="smartstore_product_page",
            )
            db.add_all([rich_row, stub_row, unmatched_stub])
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-stub-7304",
                    review_key="naver_review_hash:stub-7304",
                    status="generated",
                    draft_text="스텁에 걸린 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                )
            )
            db.add(
                NaverReviewReplyRaw(
                    review_key="naver_review_hash:stub-7304",
                    reply_text="스텁에 잘못 걸린 답글",
                    reply_written_at=date(2024, 4, 1),
                )
            )
            db.commit()

        with SessionLocal() as db:
            result = main._cleanup_incomplete_product_page_review_stubs(db)

        self.assertEqual(result["scanned"], 2)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["migrated_drafts"], 1)
        self.assertEqual(result["migrated_replies"], 1)
        self.assertEqual(result["skipped_no_match"], 1)

        with SessionLocal() as db:
            self.assertIsNone(
                db.query(NaverReviewRaw)
                .filter(NaverReviewRaw.review_key == "naver_review_hash:stub-7304")
                .one_or_none()
            )
            self.assertIsNotNone(
                db.query(NaverReviewRaw)
                .filter(NaverReviewRaw.review_key == "naver_review_hash:stub-7304-unmatched")
                .one_or_none()
            )
            moved_draft = (
                db.query(ReviewReplyDraft)
                .filter(ReviewReplyDraft.draft_id == "draft-stub-7304")
                .one()
            )
            self.assertEqual(moved_draft.review_key, "naver_review:rich-7304")
            moved_reply = (
                db.query(NaverReviewReplyRaw)
                .filter(NaverReviewReplyRaw.review_key == "naver_review:rich-7304")
                .one()
            )
            self.assertEqual(moved_reply.reply_text, "스텁에 잘못 걸린 답글")

    def test_reply_backfill_start_and_status_returns_background_job_state(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:backfill-start-1",
            product_url="smartstore-review-upload://product/4743750201",
            review_text="답글 보강 시작 대상",
        )
        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            row.review_id_original = "4943500001"
            row.reply_exists_flag = True
            row.reply_collect_status = "pending"
            row.import_source = "smartstore_review_upload"
            db.commit()

        with patch("main._run_review_reply_backfill_job", return_value=None):
            start_resp = self.client.post("/reviews/reply-backfill/start", json={"limit": 0, "max_pages": 30})

        self.assertEqual(start_resp.status_code, 200, msg=start_resp.text)
        start_body = start_resp.json()
        self.assertTrue(start_body["ok"])
        self.assertTrue(start_body["scheduled"])
        self.assertEqual(start_body["status"], "STARTED")
        self.assertEqual(start_body["pending_targets"], 1)
        self.assertTrue(start_body["job_id"])

        status_resp = self.client.get("/reviews/reply-backfill/status", params={"job_id": start_body["job_id"]})
        self.assertEqual(status_resp.status_code, 200, msg=status_resp.text)
        status_body = status_resp.json()
        self.assertEqual(status_body["job_id"], start_body["job_id"])
        self.assertEqual(status_body["status"], "STARTED")
        self.assertEqual(status_body["pending_targets"], 1)

    def test_collect_tracked_reviews_uses_all_active_products_and_passes_date_range(self) -> None:
        product_url_1 = "https://smartstore.naver.com/testmall/products/8101"
        product_url_2 = "https://smartstore.naver.com/testmall/products/8102"
        self._insert_tracked_product(product_url=product_url_1, keyword="헤나샴푸", title="헤나 샴푸 1")
        self._insert_tracked_product(product_url=product_url_2, keyword="헤나오일", title="헤나 오일 2")

        captured_calls: list[dict] = []

        def fake_collect(*, product_url: str, max_pages: int = 3, max_items: int = 100, date_from=None, date_to=None):
            captured_calls.append(
                {
                    "product_url": product_url,
                    "max_pages": max_pages,
                    "max_items": max_items,
                    "date_from": date_from.isoformat() if date_from is not None else None,
                    "date_to": date_to.isoformat() if date_to is not None else None,
                }
            )
            if product_url == product_url_1:
                return [
                    {
                        "review_id_original": "rv-in-range",
                        "review_written_at": date(2024, 3, 15),
                        "rating": 5.0,
                        "option_text": "브라운",
                        "review_text": "기간 내 신규 리뷰입니다.",
                        "reviewer_masked_id": "user****",
                        "reply_text": None,
                    }
                ]
            return []

        with patch("main._collect_smartstore_reviews_text", side_effect=fake_collect):
            resp = self.client.post(
                "/reviews/collect-tracked",
                json={
                    "date_from": "2024-03-10",
                    "date_to": "2024-03-20",
                    "max_targets": 50,
                    "max_pages": 4,
                    "max_items": 120,
                },
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["total_targets"], 2)
        self.assertEqual(body["processed_targets"], 2)
        self.assertEqual(body["saved_reviews"], 1)
        self.assertEqual(body["date_from"], "2024-03-10")
        self.assertEqual(body["date_to"], "2024-03-20")
        self.assertEqual(len(captured_calls), 2)
        self.assertEqual({call["product_url"] for call in captured_calls}, {product_url_1, product_url_2})
        self.assertTrue(all(call["date_from"] == "2024-03-10" for call in captured_calls))
        self.assertTrue(all(call["date_to"] == "2024-03-20" for call in captured_calls))

        items = {item["product_url"]: item for item in body["items"]}
        self.assertEqual(items[product_url_1]["product_title"], "헤나 샴푸 1")
        self.assertEqual(items[product_url_1]["status"], "done")
        self.assertEqual(items[product_url_1]["saved_reviews"], 1)
        self.assertEqual(items[product_url_2]["product_title"], "헤나 오일 2")
        self.assertEqual(items[product_url_2]["status"], "skipped")
        self.assertEqual(items[product_url_2]["saved_reviews"], 0)

    def test_generate_review_reply_draft_batch_generates_only_eligible_reviews(self) -> None:
        review_key_1 = self._insert_review(
            review_key="naver_review:batch-1",
            product_url="https://smartstore.naver.com/testmall/products/1001",
            review_text="향이 좋아서 만족합니다.",
        )
        review_key_2 = self._insert_review(
            review_key="naver_review:batch-2",
            product_url="https://smartstore.naver.com/testmall/products/1002",
            review_text="재구매 의사 있어요.",
            reply_text="이미 답글이 있습니다.",
        )
        review_key_3 = self._insert_review(
            review_key="naver_review:batch-3",
            product_url="https://smartstore.naver.com/testmall/products/1003",
            review_text="사용감이 편안합니다.",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-existing",
                    review_key=review_key_3,
                    status="generated",
                    draft_text="기존 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 소중한 후기 감사합니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()) as mp:
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={"max_items": 10, "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["requested"], 10)
        self.assertEqual(body["processed"], 1)
        self.assertEqual(body["generated"], 1)
        self.assertEqual(body["reused"], 0)
        self.assertEqual(body["skipped_replied"], 1)
        self.assertEqual(body["skipped_existing"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["review_key"], review_key_1)
        self.assertTrue(body["items"][0]["generated_now"])
        self.assertTrue(mp.called)

    def test_generate_review_reply_draft_batch_can_reuse_existing_draft(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:batch-reuse",
            product_url="https://smartstore.naver.com/testmall/products/2001",
            review_text="꾸준히 쓰고 있어요.",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-reuse",
                    review_key=review_key,
                    status="generated",
                    draft_text="재사용할 기존 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        with patch("main.requests.post") as mp:
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={"max_items": 5, "force_regenerate": False, "include_existing": True},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["processed"], 1)
        self.assertEqual(body["generated"], 0)
        self.assertEqual(body["reused"], 1)
        self.assertEqual(body["items"][0]["review_key"], review_key)
        self.assertFalse(body["items"][0]["generated_now"])
        self.assertFalse(mp.called)

    def test_generate_review_reply_draft_batch_skips_reviews_with_existing_active_drafts(self) -> None:
        review_key_approved = self._insert_review(
            review_key="naver_review:batch-approved-existing",
            product_url="https://smartstore.naver.com/testmall/products/2002",
            review_text="승인 초안이 이미 있는 리뷰",
        )
        review_key_rejected = self._insert_review(
            review_key="naver_review:batch-rejected-existing",
            product_url="https://smartstore.naver.com/testmall/products/2003",
            review_text="반려 초안이 이미 있는 리뷰",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-approved-existing",
                    review_key=review_key_approved,
                    status="approved",
                    draft_text="승인된 기존 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-rejected-existing",
                    review_key=review_key_rejected,
                    status="rejected",
                    draft_text="반려된 기존 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        with patch("main.requests.post") as mp:
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={"max_items": 10, "force_regenerate": False, "include_existing": False},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["processed"], 0)
        self.assertEqual(body["generated"], 0)
        self.assertEqual(body["reused"], 0)
        self.assertEqual(body["skipped_existing"], 2)
        self.assertTrue(body["exhausted"])
        self.assertFalse(mp.called)

    def test_generate_review_reply_draft_batch_builds_style_corpus_once_per_batch(self) -> None:
        self._insert_review(
            review_key="naver_review:batch-corpus-1",
            product_url="https://smartstore.naver.com/testmall/products/2101",
            review_text="첫 번째 리뷰입니다.",
        )
        self._insert_review(
            review_key="naver_review:batch-corpus-2",
            product_url="https://smartstore.naver.com/testmall/products/2102",
            review_text="두 번째 리뷰입니다.",
        )

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 소중한 후기 감사합니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch(
            "main._build_review_reply_style_corpus",
            return_value=[],
        ) as corpus_mock, patch("main.requests.post", return_value=FakeResp()):
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={"max_items": 2, "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["processed"], 2)
        self.assertEqual(corpus_mock.call_count, 1)

    def test_generate_review_reply_draft_batch_respects_date_range_filters(self) -> None:
        review_key_in = self._insert_review(
            review_key="naver_review:batch-date-in",
            product_url="https://smartstore.naver.com/testmall/products/2201",
            review_text="기간 안쪽 리뷰입니다.",
        )
        review_key_out = self._insert_review(
            review_key="naver_review:batch-date-out",
            product_url="https://smartstore.naver.com/testmall/products/2201",
            review_text="기간 바깥 리뷰입니다.",
        )
        with SessionLocal() as db:
            row_in = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key_in).one()
            row_out = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key_out).one()
            row_in.review_written_at = date(2024, 3, 15)
            row_out.review_written_at = date(2024, 2, 20)
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 기간 조건에 맞는 초안입니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()):
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={
                    "max_items": 10,
                    "model": "gpt-4o-mini",
                    "date_from": "2024-03-01",
                    "date_to": "2024-03-31",
                },
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["processed"], 1)
        self.assertEqual(body["generated"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["review_key"], review_key_in)

    def test_generate_review_reply_draft_batch_scans_beyond_initial_skipped_prefix(self) -> None:
        skipped_keys: list[str] = []
        for idx in range(12):
            review_key = self._insert_review(
                review_key=f"naver_review:batch-skip-prefix-{idx:02d}",
                product_url="https://smartstore.naver.com/testmall/products/2202",
                review_text=f"스킵 대상 리뷰 {idx}",
            )
            skipped_keys.append(review_key)
        target_key = self._insert_review(
            review_key="naver_review:batch-skip-prefix-target",
            product_url="https://smartstore.naver.com/testmall/products/2202",
            review_text="뒤쪽에 있는 생성 대상 리뷰",
        )
        with SessionLocal() as db:
            for idx, review_key in enumerate(skipped_keys):
                row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
                row.review_written_at = date(2024, 3, 31)
                row.reply_exists_flag = True
            target_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == target_key).one()
            target_row.review_written_at = date(2024, 3, 30)
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 뒤쪽 대상에도 초안을 생성했습니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()):
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={"max_items": 1, "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["processed"], 1)
        self.assertEqual(body["generated"], 1)
        self.assertEqual(body["skipped_replied"], 12)
        self.assertTrue(body["exhausted"])
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["review_key"], target_key)

    def test_generate_review_reply_draft_batch_marks_exhausted_false_when_more_targets_remain(self) -> None:
        for idx in range(12):
            self._insert_review(
                review_key=f"naver_review:batch-exhausted-{idx:02d}",
                product_url="https://smartstore.naver.com/testmall/products/2203",
                review_text=f"추가 생성 대상 리뷰 {idx}",
            )

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 생성 대상 초안입니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()):
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={"max_items": 10, "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["processed"], 10)
        self.assertEqual(body["generated"], 10)
        self.assertFalse(body["exhausted"])

    def test_generate_review_reply_draft_batch_scans_beyond_initial_query_window(self) -> None:
        base_ts = datetime(2024, 4, 1, 12, 0, 0, tzinfo=timezone.utc)
        with SessionLocal() as db:
            for idx in range(5001):
                db.add(
                    NaverReviewRaw(
                        review_key=f"naver_review:batch-window-skip-{idx:04d}",
                        product_url="https://smartstore.naver.com/testmall/products/2204",
                        review_id_original=f"window-skip-{idx:04d}",
                        review_written_at=date(2024, 3, 31),
                        rating=5.0,
                        option_text="기본",
                        review_text=f"윈도우 앞쪽 스킵 리뷰 {idx}",
                        reviewer_masked_id="skip****",
                        text_hash=f"window-skip-hash-{idx:04d}",
                        reply_exists_flag=True,
                        collected_at=base_ts - timedelta(seconds=idx),
                    )
                )
            db.add(
                NaverReviewRaw(
                    review_key="naver_review:batch-window-target",
                    product_url="https://smartstore.naver.com/testmall/products/2204",
                    review_id_original="window-target",
                    review_written_at=date(2024, 3, 30),
                    rating=5.0,
                    option_text="기본",
                    review_text="초기 조회 윈도우 뒤쪽의 실제 생성 대상 리뷰",
                    reviewer_masked_id="target****",
                    text_hash="window-target-hash",
                    reply_exists_flag=False,
                    collected_at=base_ts - timedelta(seconds=6000),
                )
            )
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "안녕하세요 고객님, 뒤쪽 윈도우에서도 초안을 생성했습니다.",
                            }
                        }
                    ],
                    "model": "gpt-test",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()):
            resp = self.client.post(
                "/reviews/reply-drafts/generate-batch",
                json={"max_items": 1, "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["processed"], 1)
        self.assertEqual(body["generated"], 1)
        self.assertEqual(body["items"][0]["review_key"], "naver_review:batch-window-target")

    def test_list_review_reply_drafts_returns_latest_by_review_key(self) -> None:
        review_key_1 = self._insert_review(
            review_key="naver_review:list-1",
            product_url="https://smartstore.naver.com/testmall/products/3001",
            review_text="첫 번째 리뷰입니다.",
        )
        review_key_2 = self._insert_review(
            review_key="naver_review:list-2",
            product_url="https://smartstore.naver.com/testmall/products/3002",
            review_text="두 번째 리뷰입니다.",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-old",
                    review_key=review_key_1,
                    status="superseded",
                    draft_text="오래된 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-new",
                    review_key=review_key_1,
                    status="generated",
                    draft_text="최신 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-2",
                    review_key=review_key_2,
                    status="approved",
                    draft_text="승인된 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        resp = self.client.get("/reviews/reply-drafts", params={"limit": 10})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        items = resp.json() or []
        self.assertEqual(len(items), 2)
        by_review_key = {item["review_key"]: item for item in items}
        self.assertEqual(set(by_review_key.keys()), {review_key_1, review_key_2})
        self.assertEqual(by_review_key[review_key_2]["status"], "approved")
        self.assertEqual(by_review_key[review_key_1]["draft_id"], "draft-new")
        self.assertEqual(by_review_key[review_key_1]["draft_text"], "최신 초안")

    def test_update_review_reply_draft_status_changes_status(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:status-1",
            product_url="https://smartstore.naver.com/testmall/products/4001",
            review_text="상태 변경 테스트 리뷰",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-status",
                    review_key=review_key,
                    status="generated",
                    draft_text="검토할 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        resp = self.client.post(
            "/reviews/reply-drafts/status",
            json={"draft_id": "draft-status", "status": "approved"},
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["draft_id"], "draft-status")
        self.assertEqual(body["status"], "approved")

        with SessionLocal() as db:
            row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == "draft-status").one()
            self.assertEqual(row.status, "approved")

    def test_update_review_reply_draft_status_requires_rejection_comment(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:reject-required",
            product_url="https://smartstore.naver.com/testmall/products/4002",
            review_text="반려 코멘트 필수 테스트",
        )
        self._insert_draft(
            draft_id="draft-reject-required",
            review_key=review_key,
            status="generated",
            draft_text="문제가 있는 초안입니다.",
        )

        resp = self.client.post(
            "/reviews/reply-drafts/status",
            json={"draft_id": "draft-reject-required", "status": "rejected"},
        )
        self.assertEqual(resp.status_code, 400, msg=resp.text)
        self.assertIn("rejection_comment is required", resp.text)

    def test_update_review_reply_draft_status_saves_rejection_feedback_and_knowledge(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:reject-feedback",
            product_url="https://smartstore.naver.com/testmall/products/4003",
            review_text="사과가 부족하고 원인 설명이 없는 답글은 별로입니다.",
            option_text="허브",
            rating=2.0,
        )
        self._insert_draft(
            draft_id="draft-reject-feedback",
            review_key=review_key,
            status="generated",
            draft_text="안녕하세요 고객님. 구매 감사합니다. 다음에도 잘 부탁드립니다.",
        )

        fake_analysis = {
            "problem_types": ["tone_mismatch", "missing_empathy"],
            "root_cause": "불만 리뷰인데 감사 위주로만 작성되어 공감과 사과가 부족합니다.",
            "must_avoid": ["감사만 반복", "문제 원인 확인 의지 없음"],
            "rewrite_guidance": ["불편에 대한 공감 문장을 먼저 배치", "확인 및 개선 의지를 포함"],
            "global_rule_candidate": {
                "problem_type": "missing_empathy",
                "problem_summary": "불만 리뷰에 공감/사과 없이 감사만 반복하는 패턴",
                "bad_pattern": "감사만 강조하고 불편 언급이 없음",
                "prevention_rule": "낮은 평점이나 불만 키워드가 있으면 첫 문장에 공감 또는 사과를 포함한다.",
                "example_fix": "불편을 드려 죄송하며 남겨주신 내용을 바로 확인하겠습니다.",
            },
        }

        with patch("main._analyze_review_reply_rejection_feedback", return_value=fake_analysis):
            resp = self.client.post(
                "/reviews/reply-drafts/status",
                json={
                    "draft_id": "draft-reject-feedback",
                    "status": "rejected",
                    "rejection_comment": "고객 불만 리뷰인데 사과와 공감이 전혀 없고 감사만 반복합니다.",
                },
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["status"], "rejected")
        self.assertEqual(body["rejection_comment"], "고객 불만 리뷰인데 사과와 공감이 전혀 없고 감사만 반복합니다.")
        self.assertEqual(body["rejection_problem_summary"], "불만 리뷰에 공감/사과 없이 감사만 반복하는 패턴")

        with SessionLocal() as db:
            draft_row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == "draft-reject-feedback").one()
            self.assertEqual(draft_row.status, "rejected")
            self.assertEqual(draft_row.rejection_comment, "고객 불만 리뷰인데 사과와 공감이 전혀 없고 감사만 반복합니다.")
            self.assertTrue(str(draft_row.rejection_analysis_json or "").strip())

            knowledge_rows = db.query(ReviewReplyFeedbackKnowledge).filter(
                ReviewReplyFeedbackKnowledge.source_draft_id == "draft-reject-feedback"
            ).all()
            self.assertEqual(len(knowledge_rows), 1)
            self.assertEqual(knowledge_rows[0].problem_type, "missing_empathy")
            self.assertIn("첫 문장에 공감", str(knowledge_rows[0].prevention_rule or ""))

        workbench = self.client.get("/reviews/workbench", params={"date_from": "2024-03-01", "date_to": "2024-03-31"})
        self.assertEqual(workbench.status_code, 200, msg=workbench.text)
        items = workbench.json().get("items") or []
        row = next(item for item in items if item["review_key"] == review_key)
        self.assertEqual(row["rejection_comment"], "고객 불만 리뷰인데 사과와 공감이 전혀 없고 감사만 반복합니다.")
        self.assertEqual(row["rejection_problem_summary"], "불만 리뷰에 공감/사과 없이 감사만 반복하는 패턴")
        self.assertTrue(row["can_rewrite_from_rejection"])

    def test_rewrite_from_rejection_generates_new_draft_with_feedback_guidance(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:reject-rewrite",
            product_url="https://smartstore.naver.com/testmall/products/4004",
            review_text="배송이 너무 늦어 실망했습니다.",
            option_text="기본",
            rating=1.0,
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-reject-rewrite",
                    review_key=review_key,
                    status="rejected",
                    draft_text="안녕하세요 고객님. 주문해 주셔서 감사합니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    rejection_comment="배송 지연 불만인데 감사만 있고 사과와 확인 의지가 없습니다.",
                    rejection_analysis_json=json.dumps(
                        {
                            "problem_types": ["missing_empathy"],
                            "root_cause": "불만 맥락을 반영하지 못함",
                            "must_avoid": ["감사만 반복"],
                            "rewrite_guidance": ["첫 문장에 사과", "배송 지연 확인 의지 명시"],
                            "global_rule_candidate": {
                                "problem_type": "missing_empathy",
                                "problem_summary": "불만 리뷰에 사과가 빠짐",
                                "bad_pattern": "감사만 강조",
                                "prevention_rule": "낮은 평점 리뷰는 사과/공감 문장을 먼저 둔다.",
                                "example_fix": "불편을 드려 죄송하며 배송 지연 원인을 확인하겠습니다.",
                            },
                        },
                        ensure_ascii=False,
                    ),
                )
            )
            db.add(
                ReviewReplyFeedbackKnowledge(
                    knowledge_id="knowledge-global-1",
                    source_draft_id="draft-reject-rewrite",
                    status="active",
                    problem_type="missing_empathy",
                    problem_summary="불만 리뷰에 사과가 빠짐",
                    bad_pattern="감사만 강조",
                    prevention_rule="낮은 평점 리뷰는 사과/공감 문장을 먼저 둔다.",
                    example_fix="불편을 드려 죄송하며 배송 지연 원인을 확인하겠습니다.",
                )
            )
            db.commit()

        captured_payloads: list[dict] = []

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "불편을 드려 죄송합니다. 남겨주신 배송 지연 내용은 바로 확인하겠습니다.",
                            }
                        }
                    ],
                    "model": "gpt-4o-mini",
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        def fake_post(*args, **kwargs):
            captured_payloads.append(dict(kwargs.get("json") or {}))
            return FakeResp()

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            resp = self.client.post(
                "/reviews/reply-drafts/rewrite-from-rejection",
                json={"draft_id": "draft-reject-rewrite", "model": "gpt-4o-mini"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["generated_now"])
        self.assertEqual(body["status"], "generated")
        self.assertIn("죄송", body["draft_text"])
        self.assertTrue(captured_payloads)
        message_blob = json.dumps(captured_payloads[0].get("messages") or [], ensure_ascii=False)
        self.assertIn("배송 지연 불만인데 감사만 있고 사과와 확인 의지가 없습니다.", message_blob)
        self.assertIn("낮은 평점 리뷰는 사과/공감 문장을 먼저 둔다.", message_blob)

        with SessionLocal() as db:
            rows = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.review_key == review_key).all()
            self.assertEqual(len(rows), 2)
            statuses = {str(row.draft_id): str(row.status) for row in rows}
            self.assertEqual(statuses["draft-reject-rewrite"], "rejected")
            generated_rows = [row for row in rows if str(row.draft_id) != "draft-reject-rewrite"]
            self.assertEqual(len(generated_rows), 1)
            self.assertEqual(str(generated_rows[0].status), "generated")

    def test_update_review_reply_draft_text_saves_manual_edit(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:edit-1",
            product_url="https://smartstore.naver.com/testmall/products/4011",
            review_text="답글 수정 테스트 리뷰",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-edit",
                    review_key=review_key,
                    status="generated",
                    draft_text="초기 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                )
            )
            db.commit()

        resp = self.client.post(
            "/reviews/reply-drafts/update",
            json={"draft_id": "draft-edit", "draft_text": "관리자가 다듬은 최종 초안"},
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["draft_id"], "draft-edit")
        self.assertEqual(body["draft_text"], "관리자가 다듬은 최종 초안")

        with SessionLocal() as db:
            row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == "draft-edit").one()
            self.assertEqual(row.draft_text, "관리자가 다듬은 최종 초안")

    def test_list_review_reply_rejection_history_returns_only_actual_rejected_events(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:rejection-history-1",
            product_url="https://smartstore.naver.com/testmall/products/4012",
            review_text="배송이 늦었습니다.",
            rating=2.0,
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-history-rejected-1",
                    review_key=review_key,
                    status="rejected",
                    draft_text="감사만 드립니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    rejection_comment="사과가 빠져 있습니다.",
                    rejection_analysis_json=json.dumps({"rewrite_guidance": ["첫 문장에 사과"]}, ensure_ascii=False),
                )
            )
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-history-generated-1",
                    review_key=review_key,
                    status="generated",
                    draft_text="불편을 드려 죄송합니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    rejection_comment="사과가 빠져 있습니다.",
                    rejection_analysis_json=json.dumps({"rewrite_guidance": ["첫 문장에 사과"]}, ensure_ascii=False),
                )
            )
            db.commit()

        resp = self.client.get(
            "/reviews/reply-drafts/rejection-history",
            params={
                "product_url": "https://smartstore.naver.com/testmall/products/4012",
                "date_from": "2024-03-01",
                "date_to": "2024-03-31",
                "rating_filters": ["2"],
            },
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["draft_id"], "draft-history-rejected-1")
        self.assertEqual(body[0]["status"], "rejected")
        self.assertEqual(body[0]["rejection_comment"], "사과가 빠져 있습니다.")

    def test_update_review_reply_rejection_comment_reanalyzes_and_replaces_knowledge(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:rejection-comment-update",
            product_url="https://smartstore.naver.com/testmall/products/4013",
            review_text="응답이 늦어서 불편했습니다.",
            rating=2.0,
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-rejection-comment-update",
                    review_key=review_key,
                    status="rejected",
                    draft_text="감사합니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    rejection_comment="감사만 있습니다.",
                    rejection_analysis_json=json.dumps({"global_rule_candidate": {"problem_summary": "이전 규칙"}}, ensure_ascii=False),
                )
            )
            db.add(
                ReviewReplyFeedbackKnowledge(
                    knowledge_id="knowledge-old-rejection-comment-update",
                    source_draft_id="draft-rejection-comment-update",
                    status="active",
                    problem_summary="이전 규칙",
                )
            )
            db.commit()

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": json.dumps(
                                    {
                                        "problem_types": ["missing_empathy"],
                                        "root_cause": "불만 맥락 미반영",
                                        "must_avoid": ["감사만 반복"],
                                        "rewrite_guidance": ["첫 문장에 사과"],
                                        "global_rule_candidate": {
                                            "problem_type": "missing_empathy",
                                            "problem_summary": "불만 리뷰에 사과가 빠짐",
                                            "bad_pattern": "감사만 반복",
                                            "prevention_rule": "낮은 평점 리뷰는 사과 문장을 먼저 둔다.",
                                            "example_fix": "불편을 드려 죄송합니다.",
                                        },
                                    },
                                    ensure_ascii=False,
                                ),
                            }
                        }
                    ]
                }

            @property
            def text(self):
                return '{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", return_value=FakeResp()):
            resp = self.client.post(
                "/reviews/reply-drafts/rejection-comment/update",
                json={
                    "draft_id": "draft-rejection-comment-update",
                    "rejection_comment": "고객 불만에 대한 사과와 확인 의지가 없습니다.",
                    "analyze_rejection": True,
                },
            )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["rejection_comment"], "고객 불만에 대한 사과와 확인 의지가 없습니다.")
        self.assertEqual(body["status"], "rejected")
        self.assertIn("첫 문장에 사과", json.dumps(body["rejection_analysis"], ensure_ascii=False))

        with SessionLocal() as db:
            row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == "draft-rejection-comment-update").one()
            self.assertEqual(row.rejection_comment, "고객 불만에 대한 사과와 확인 의지가 없습니다.")
            self.assertIsNotNone(row.rejection_analysis_json)
            knowledge_rows = (
                db.query(ReviewReplyFeedbackKnowledge)
                .filter(ReviewReplyFeedbackKnowledge.source_draft_id == "draft-rejection-comment-update")
                .order_by(ReviewReplyFeedbackKnowledge.knowledge_id.asc())
                .all()
            )
            self.assertEqual(len(knowledge_rows), 2)
            statuses = sorted(str(one.status) for one in knowledge_rows)
            self.assertEqual(statuses, ["active", "archived"])

    def test_delete_review_reply_rejection_comment_clears_analysis(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:rejection-comment-delete",
            product_url="https://smartstore.naver.com/testmall/products/4014",
            review_text="불편합니다.",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-rejection-comment-delete",
                    review_key=review_key,
                    status="rejected",
                    draft_text="감사합니다.",
                    model_name="gpt-test",
                    prompt_version="review_reply_v2",
                    rejection_comment="사과가 없습니다.",
                    rejection_analysis_json=json.dumps({"rewrite_guidance": ["사과 먼저"]}, ensure_ascii=False),
                )
            )
            db.add(
                ReviewReplyFeedbackKnowledge(
                    knowledge_id="knowledge-delete-rejection-comment",
                    source_draft_id="draft-rejection-comment-delete",
                    status="active",
                    problem_summary="사과가 없음",
                )
            )
            db.commit()

        resp = self.client.post(
            "/reviews/reply-drafts/rejection-comment/delete",
            json={"draft_id": "draft-rejection-comment-delete"},
        )
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["draft_id"], "draft-rejection-comment-delete")

        history_resp = self.client.get(
            "/reviews/reply-drafts/rejection-history",
            params={"product_url": "https://smartstore.naver.com/testmall/products/4014"},
        )
        self.assertEqual(history_resp.status_code, 200, msg=history_resp.text)
        self.assertEqual(history_resp.json(), [])

        with SessionLocal() as db:
            row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == "draft-rejection-comment-delete").one()
            self.assertIsNone(row.rejection_comment)
            self.assertIsNone(row.rejection_analysis_json)
            knowledge_rows = db.query(ReviewReplyFeedbackKnowledge).filter(
                ReviewReplyFeedbackKnowledge.source_draft_id == "draft-rejection-comment-delete"
            ).all()
            self.assertEqual([str(one.status) for one in knowledge_rows], ["archived"])

    def test_list_review_reply_drafts_can_filter_status(self) -> None:
        review_key_1 = self._insert_review(
            review_key="naver_review:filter-1",
            product_url="https://smartstore.naver.com/testmall/products/4021",
            review_text="승인 초안 필터 테스트",
        )
        review_key_2 = self._insert_review(
            review_key="naver_review:filter-2",
            product_url="https://smartstore.naver.com/testmall/products/4021",
            review_text="검토대기 초안 필터 테스트",
        )
        self._insert_draft(
            draft_id="draft-approved-filter",
            review_key=review_key_1,
            status="approved",
            draft_text="승인 초안",
        )
        self._insert_draft(
            draft_id="draft-generated-filter",
            review_key=review_key_2,
            status="generated",
            draft_text="생성 초안",
        )

        resp = self.client.get("/reviews/reply-drafts", params={"limit": 10, "status": "approved"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        items = resp.json() or []
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["review_key"], review_key_1)
        self.assertEqual(items[0]["status"], "approved")

    def test_review_reply_draft_submit_readiness_requires_approved_status(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:ready-1",
            product_url="https://smartstore.naver.com/testmall/products/5001",
            review_text="등록 readiness 테스트",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-ready-1",
                    review_key=review_key,
                    status="generated",
                    draft_text="초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        resp = self.client.get("/reviews/reply-drafts/submit-readiness", params={"draft_id": "draft-ready-1"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertFalse(body["can_submit"])
        self.assertIn("draft_status_not_approved", body["blockers"])

    def test_review_reply_draft_submit_readiness_reports_channel_blockers(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:ready-2",
            product_url="https://smartstore.naver.com/testmall/products/5002",
            review_text="등록 readiness 채널 테스트",
        )
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-ready-2",
                    review_key=review_key,
                    status="approved",
                    draft_text="승인 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_ip_not_allowed"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": False, "reason": "browser_reply_ui_not_visible"},
        ):
            resp = self.client.get("/reviews/reply-drafts/submit-readiness", params={"draft_id": "draft-ready-2"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertFalse(body["can_submit"])
        self.assertIn("commerce_ip_not_allowed", body["blockers"])
        self.assertIn("browser_reply_ui_not_visible", body["blockers"])
        self.assertEqual((body.get("channels") or {}).get("commerce_api", {}).get("ready"), False)
        self.assertEqual((body.get("channels") or {}).get("browser_cdp", {}).get("ready"), False)

    def test_review_reply_draft_submit_readiness_requires_review_collection_first(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:ready-collect-first",
            product_url="https://smartstore.naver.com/testmall/products/5003",
            review_text="리뷰 수집 선행 필요 테스트",
        )
        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            row.review_id_original = None
            db.add(
                ReviewReplyDraft(
                    draft_id="draft-ready-collect-first",
                    review_key=review_key,
                    status="approved",
                    draft_text="승인 초안",
                    model_name="gpt-test",
                    prompt_version="review_reply_v1",
                )
            )
            db.commit()

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": True, "reason": None},
        ):
            resp = self.client.get("/reviews/reply-drafts/submit-readiness", params={"draft_id": "draft-ready-collect-first"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertFalse(body["can_submit"])
        self.assertIn("review_collection_required", body["blockers"])

    def test_review_reply_draft_submit_creates_actual_reply_on_success(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-1",
            product_url="https://smartstore.naver.com/testmall/products/5101",
            review_text="자동 게시 성공 테스트",
        )
        self._insert_draft(
            draft_id="draft-submit-1",
            review_key=review_key,
            status="approved",
            draft_text="정성스러운 리뷰 감사합니다. 다음에도 만족 드리겠습니다.",
        )

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._submit_review_reply_via_browser",
            return_value={
                "reply_text": "정성스러운 리뷰 감사합니다. 다음에도 만족 드리겠습니다.",
                "reply_written_at": date(2026, 4, 1),
                "detail": "판매자센터에 답글을 등록했습니다.",
            },
        ):
            resp = self.client.post("/reviews/reply-drafts/submit", json={"draft_id": "draft-submit-1"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["draft_id"], "draft-submit-1")
        self.assertEqual(body["review_key"], review_key)
        self.assertEqual(body["status"], "completed")

        with SessionLocal() as db:
            reply_row = db.query(NaverReviewReplyRaw).filter(NaverReviewReplyRaw.review_key == review_key).one()
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertEqual(reply_row.reply_text, "정성스러운 리뷰 감사합니다. 다음에도 만족 드리겠습니다.")
            self.assertEqual(reply_row.reply_written_at, date(2026, 4, 1))
            self.assertTrue(bool(review_row.reply_exists_flag))
            self.assertEqual(review_row.reply_collect_status, "collected")

    def test_review_reply_draft_submit_marks_completed_when_seller_center_already_has_reply(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-already-replied",
            product_url="https://smartstore.naver.com/testmall/products/5101",
            review_text="이미 판매자 답글이 등록된 경우",
        )
        self._insert_draft(
            draft_id="draft-submit-already-replied",
            review_key=review_key,
            status="approved",
            draft_text="기존 답글과 무관한 승인 초안",
        )

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._submit_review_reply_via_browser",
            return_value={
                "already_replied": True,
                "reply_text": "이미 판매자 답글이 등록되어 있습니다.",
                "reply_written_at": date(2026, 4, 2),
                "detail": "판매자센터 조회 결과 이미 답글이 등록되어 있어 완료 상태로 동기화했습니다.",
            },
        ):
            resp = self.client.post("/reviews/reply-drafts/submit", json={"draft_id": "draft-submit-already-replied"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["status"], "completed")
        self.assertIn("완료 상태로 동기화", str(body.get("detail") or ""))

        with SessionLocal() as db:
            reply_row = db.query(NaverReviewReplyRaw).filter(NaverReviewReplyRaw.review_key == review_key).one()
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertEqual(reply_row.reply_text, "이미 판매자 답글이 등록되어 있습니다.")
            self.assertEqual(reply_row.reply_written_at, date(2026, 4, 2))
            self.assertTrue(bool(review_row.reply_exists_flag))
            self.assertEqual(review_row.reply_collect_status, "collected")

    def test_review_reply_draft_submit_auto_progresses_reply_exists_flag_only_to_enrichment_target(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-flag-only-existing",
            product_url="https://smartstore.naver.com/testmall/products/5101",
            review_text="답글 존재 flag만 먼저 동기화된 경우",
        )
        self._set_review_reply_flags(
            review_key=review_key,
            reply_exists_flag=True,
            reply_collect_status="pending",
        )
        self._insert_draft(
            draft_id="draft-submit-flag-only-existing",
            review_key=review_key,
            status="approved",
            draft_text="승인 초안",
        )

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": False, "reason": "browser_host_cdp_not_enabled"},
        ), patch("main._submit_review_reply_via_browser") as submit_mock:
            resp = self.client.post("/reviews/reply-drafts/submit", json={"draft_id": "draft-submit-flag-only-existing"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["status"], "enrichment_target")
        self.assertEqual(body["result_type"], "existing_reply_enrichment")
        self.assertIn("보강 대상으로", str(body.get("detail") or ""))
        self.assertFalse(submit_mock.called)

        with SessionLocal() as db:
            reply_row = db.query(NaverReviewReplyRaw).filter(NaverReviewReplyRaw.review_key == review_key).one_or_none()
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertIsNone(reply_row)
            self.assertTrue(bool(review_row.reply_exists_flag))
            self.assertEqual(review_row.reply_collect_status, "pending")

    def test_submit_review_reply_via_browser_requires_success_popup_before_marking_success(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-popup-fail",
            product_url="https://smartstore.naver.com/testmall/products/5104",
            review_text="자동 게시 팝업 실패 테스트",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        class FakePage:
            def __init__(self):
                self.eval_calls = 0

            def bring_to_front(self):
                return None

            def wait_for_timeout(self, _ms):
                return None

            def evaluate(self, _script, _payload=None):
                self.eval_calls += 1
                if self.eval_calls == 1:
                    return {"ok": True, "review_id_original": "rv-1", "reply_text": "초안 본문"}
                return {
                    "state": "error",
                    "reason": "reply_submit_validation_failed",
                    "detail": "리뷰 클립번호 항목을 입력해 주세요.",
                }

        fake_page = FakePage()
        with patch("main._playwright_enabled", return_value=True), patch(
            "main._use_host_chrome",
            return_value=True,
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal",
            return_value=True,
        ):
            with self.assertRaises(HTTPException) as cm:
                main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(cm.exception.status_code, 409)
        self.assertIn("reply_submit_validation_failed", str(cm.exception.detail))

    def test_submit_review_reply_via_browser_keeps_detail_modal_open_on_failure(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-keep-open-fail",
            product_url="https://smartstore.naver.com/testmall/products/5109",
            review_text="자동 게시 실패 시 모달 유지 테스트",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        class FakePage:
            def __init__(self):
                self.eval_calls = 0

            def bring_to_front(self):
                return None

            def wait_for_timeout(self, _ms):
                return None

            def evaluate(self, _script, _payload=None):
                self.eval_calls += 1
                if self.eval_calls == 1:
                    return {"ok": True, "review_id_original": "rv-1", "reply_text": "초안 본문"}
                return {
                    "state": "error",
                    "reason": "reply_submit_validation_failed",
                    "detail": "필수 정보입니다",
                }

        fake_page = FakePage()
        with patch("main._playwright_enabled", return_value=True), patch(
            "main._use_host_chrome",
            return_value=True,
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal",
            return_value=True,
        ), patch("main._close_existing_seller_center_review_detail_modal", return_value=True) as close_mock:
            with self.assertRaises(HTTPException) as cm:
                main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(cm.exception.status_code, 409)
        close_mock.assert_not_called()

    def test_submit_review_reply_via_browser_rejects_modal_with_existing_reply_text(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-modal-existing-reply",
            product_url="https://smartstore.naver.com/testmall/products/5114",
            review_text="상세 모달에 기존 답글이 있는 경우",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        class FakePage:
            def bring_to_front(self):
                return None

            def evaluate(self, _script, _payload=None):
                return {"ok": False, "reason": "review_already_replied"}

        fake_page = FakePage()
        with patch("main._playwright_enabled", return_value=True), patch(
            "main._use_host_chrome",
            return_value=True,
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal",
            return_value=True,
        ):
            with self.assertRaises(HTTPException) as cm:
                main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(str(cm.exception.detail), "review_already_replied")

    def test_submit_review_reply_via_browser_collects_existing_reply_when_search_row_is_already_replied(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-search-existing-reply",
            product_url="https://smartstore.naver.com/testmall/products/5115",
            review_text="검색 결과 행에서 답글 여부 Y인 경우",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        class FakePage:
            def bring_to_front(self):
                return None

        fake_page = FakePage()

        with patch("main._playwright_enabled", return_value=True), patch(
            "main._use_host_chrome",
            return_value=True,
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal",
            side_effect=HTTPException(status_code=409, detail="review_already_replied"),
        ), patch(
            "main._collect_smartstore_admin_reply_candidates_resilient",
            return_value=(
                [
                    {
                        "review_id_original": str(getattr(review_row, "review_id_original", "") or "").strip(),
                        "reply_text": "기존 판매자 답글 본문",
                        "reply_written_at": "2026-04-02",
                    }
                ],
                set(),
            ),
        ):
            out = main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertTrue(bool(out.get("already_replied")))
        self.assertEqual(out.get("reply_text"), "기존 판매자 답글 본문")
        self.assertEqual(out.get("reply_written_at"), date(2026, 4, 2))

    def test_submit_review_reply_via_browser_returns_success_after_success_popup(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-popup-success",
            product_url="https://smartstore.naver.com/testmall/products/5105",
            review_text="자동 게시 팝업 성공 테스트",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        class FakePage:
            def __init__(self):
                self.eval_calls = 0

            def bring_to_front(self):
                return None

            def wait_for_timeout(self, _ms):
                return None

            def evaluate(self, _script, _payload=None):
                self.eval_calls += 1
                if self.eval_calls == 1:
                    return {"ok": True, "review_id_original": "rv-1", "reply_text": "초안 본문"}
                return {
                    "state": "success",
                    "detail": "댓글이 등록되었습니다.",
                }

        fake_page = FakePage()
        with patch("main._playwright_enabled", return_value=True), patch(
            "main._use_host_chrome",
            return_value=True,
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal",
            return_value=True,
        ):
            out = main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(out["detail"], "댓글이 등록되었습니다.")
        self.assertEqual(out["reply_text"], "초안 본문")

    def test_open_seller_center_review_detail_modal_retries_when_stale_modal_is_visible(self) -> None:
        class FakePage:
            def __init__(self):
                self.open_clicks = 0
                self.waits = 0

            def evaluate(self, script, payload=None):
                text = str(script or "")
                if "closeBtn.click" in text:
                    return {"visible": self.open_clicks > 0, "closed": self.open_clicks == 1}
                if "openReviewDetailModal" in text:
                    self.open_clicks += 1
                    return True
                if "matches" in text and payload == "4941261082":
                    if self.open_clicks == 1:
                        return {"visible": True, "matches": False}
                    return {"visible": True, "matches": True}
                return False

            def wait_for_timeout(self, _ms):
                self.waits += 1
                return None

        fake_page = FakePage()
        with patch("main._seller_center_search_review_id", return_value=True):
            ok = main._open_seller_center_review_detail_modal(fake_page, "4941261082")

        self.assertTrue(ok)
        self.assertGreaterEqual(fake_page.open_clicks, 2)

    def test_open_seller_center_review_detail_modal_accepts_ready_modal_without_review_id_text(self) -> None:
        class FakePage:
            def __init__(self):
                self.open_clicks = 0

            def evaluate(self, script, payload=None):
                text = str(script or "")
                if "openReviewDetailModal" in text:
                    self.open_clicks += 1
                    return {"opened": True, "already_replied": False}
                if "reply_ready" in text and payload == "4941261082":
                    return {"visible": True, "matches": False, "reply_ready": True}
                return False

            def wait_for_timeout(self, _ms):
                return None

        fake_page = FakePage()
        with patch("main._seller_center_search_review_id", return_value=True), patch(
            "main._close_existing_seller_center_review_detail_modal",
            return_value=True,
        ):
            ok = main._open_seller_center_review_detail_modal(fake_page, "4941261082")

        self.assertTrue(ok)
        self.assertEqual(fake_page.open_clicks, 1)

    def test_seller_center_search_review_id_resets_filters_before_search(self) -> None:
        class FakePage:
            def __init__(self):
                self.reset_clicked = False
                self.search_clicked = False
                self.waits = 0

            def evaluate(self, script, payload=None):
                text = str(script or "")
                if "return txt === '초기화'" in text:
                    self.reset_clicked = True
                    return True
                if "return txt === '검색하기' || txt === '검색'" in text and payload == "4941261082":
                    self.search_clicked = True
                    return True
                return False

            def wait_for_timeout(self, _ms):
                self.waits += 1
                return None

        fake_page = FakePage()
        ok = main._seller_center_search_review_id(fake_page, "4941261082")
        self.assertTrue(ok)
        self.assertTrue(fake_page.reset_clicked)
        self.assertTrue(fake_page.search_clicked)
        self.assertGreaterEqual(fake_page.waits, 1)

    def test_open_seller_center_review_detail_modal_rejects_rows_with_existing_reply(self) -> None:
        class FakePage:
            def evaluate(self, _script, payload=None):
                if payload == "4941261082":
                    return {"opened": False, "already_replied": True}
                return False

            def wait_for_timeout(self, _ms):
                return None

        fake_page = FakePage()
        with patch("main._seller_center_search_review_id", return_value=True), patch(
            "main._close_existing_seller_center_review_detail_modal",
            return_value=True,
        ):
            with self.assertRaises(HTTPException) as cm:
                main._open_seller_center_review_detail_modal(fake_page, "4941261082")

        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(str(cm.exception.detail), "review_already_replied")

    def test_seller_center_review_management_url_rejects_review_event_page(self) -> None:
        self.assertFalse(main._seller_center_url_is_review_management("https://sell.smartstore.naver.com/#/event/REVIEW_EVENT/search"))
        self.assertTrue(main._seller_center_url_is_review_management("https://sell.smartstore.naver.com/#/review/search"))

    def test_submit_review_reply_via_browser_closes_detail_modal_after_success(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-close-success",
            product_url="https://smartstore.naver.com/testmall/products/5107",
            review_text="자동 게시 후 모달 정리 테스트",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        class FakePage:
            def __init__(self):
                self.eval_calls = 0

            def bring_to_front(self):
                return None

            def wait_for_timeout(self, _ms):
                return None

            def evaluate(self, _script, _payload=None):
                self.eval_calls += 1
                if self.eval_calls == 1:
                    return {"ok": True, "review_id_original": "rv-1", "reply_text": "초안 본문"}
                return {
                    "state": "success",
                    "detail": "댓글이 등록되었습니다.",
                }

        fake_page = FakePage()
        with patch("main._playwright_enabled", return_value=True), patch(
            "main._use_host_chrome",
            return_value=True,
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal",
            return_value=True,
        ), patch("main._close_existing_seller_center_review_detail_modal", return_value=True) as close_mock:
            out = main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(out["detail"], "댓글이 등록되었습니다.")
        close_mock.assert_called()

    def test_collect_smartstore_admin_reply_candidates_keeps_existing_seller_review_page_open(self) -> None:
        class FakePage:
            def __init__(self):
                self.closed = False

            @property
            def url(self):
                return "https://sell.smartstore.naver.com/#/review/search"

            def evaluate(self, script, payload=None):
                text = str(script or "")
                if "ids.join('\\n')" in text:
                    return True
                if "review_id_original" in text and "has_reply" in text:
                    return []
                if "movedPage" in text and "scrollTop" in text:
                    return {"scrolled": False, "movedPage": False, "scrollTop": 0, "maxScroll": 0}
                return False

            def wait_for_timeout(self, _ms):
                return None

            def close(self):
                self.closed = True

        fake_page = FakePage()
        with patch("main._playwright_enabled", return_value=True), patch(
            "main._pw_in_worker_thread",
            return_value=True,
        ), patch("main._use_host_chrome", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._find_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._get_captcha_shared_page", return_value=None), patch(
            "main._get_shared_page_metrics_page",
            return_value=None,
        ), patch("main._pw_new_page", side_effect=AssertionError("새 탭을 만들면 안 됩니다")), patch(
            "main._ensure_smartstore_review_management_page",
            return_value=None,
        ):
            items = main._collect_smartstore_admin_reply_candidates(
                max_pages=1,
                max_items=5,
                target_review_ids=["4941257154"],
            )

        self.assertEqual(items, [])
        self.assertFalse(fake_page.closed)

    def test_require_existing_seller_review_page_rejects_blank_tab_fallback(self) -> None:
        fake_ctx = object()

        with patch("main._find_existing_seller_review_page", return_value=None):
            with self.assertRaises(HTTPException) as cm:
                main._require_existing_seller_review_page(fake_ctx)

        self.assertEqual(cm.exception.status_code, 503)
        self.assertEqual(str(cm.exception.detail), "seller_review_page_not_open")

    def test_review_reply_draft_submit_does_not_persist_reply_when_browser_submission_fails(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-rollback-1",
            product_url="https://smartstore.naver.com/testmall/products/5106",
            review_text="자동 게시 실패 시 상태 유지 테스트",
        )
        self._insert_draft(
            draft_id="draft-submit-rollback-1",
            review_key=review_key,
            status="approved",
            draft_text="실패 팝업이 뜨는 초안",
        )

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._submit_review_reply_via_browser",
            side_effect=HTTPException(
                status_code=409,
                detail="reply_submit_validation_failed: 리뷰 클립번호 항목을 입력해 주세요.",
            ),
        ):
            resp = self.client.post("/reviews/reply-drafts/submit", json={"draft_id": "draft-submit-rollback-1"})

        self.assertEqual(resp.status_code, 409, msg=resp.text)
        self.assertIn("reply_submit_validation_failed", resp.text)

        with SessionLocal() as db:
            reply_row = db.query(NaverReviewReplyRaw).filter(NaverReviewReplyRaw.review_key == review_key).one_or_none()
            self.assertIsNone(reply_row)
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertFalse(bool(review_row.reply_exists_flag))
            draft_row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.draft_id == "draft-submit-rollback-1").one()
            self.assertEqual(draft_row.status, "approved")

    def test_review_reply_draft_submit_marks_deleted_review_as_terminal_state(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-deleted-terminal",
            product_url="https://smartstore.naver.com/testmall/products/5106",
            review_text="판매자센터에서 삭제된 리뷰",
        )
        self._insert_draft(
            draft_id="draft-submit-deleted-terminal",
            review_key=review_key,
            status="approved",
            draft_text="삭제 리뷰 승인 초안",
        )

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._submit_review_reply_via_browser",
            side_effect=HTTPException(status_code=404, detail="seller_review_not_found"),
        ):
            resp = self.client.post("/reviews/reply-drafts/submit", json={"draft_id": "draft-submit-deleted-terminal"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["status"], "completed")

        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertFalse(bool(review_row.reply_exists_flag))
            self.assertEqual(review_row.reply_collect_status, "seller_deleted")

    def test_review_reply_draft_submit_marks_blocked_review_as_terminal_state(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-blocked-terminal",
            product_url="https://smartstore.naver.com/testmall/products/5106",
            review_text="판매자센터 블라인드 리뷰",
        )
        self._insert_draft(
            draft_id="draft-submit-blocked-terminal",
            review_key=review_key,
            status="approved",
            draft_text="블라인드 리뷰 승인 초안",
        )

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._submit_review_reply_via_browser",
            side_effect=HTTPException(status_code=409, detail="reply_submit_validation_failed: 삭제 또는 블라인드 처리된 리뷰입니다."),
        ):
            resp = self.client.post("/reviews/reply-drafts/submit", json={"draft_id": "draft-submit-blocked-terminal"})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertEqual(body["status"], "completed")

        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertFalse(bool(review_row.reply_exists_flag))
            self.assertEqual(review_row.reply_collect_status, "seller_blocked")

    def test_submit_review_reply_via_browser_unwraps_worker_404_runtime_error(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-worker-404",
            product_url="https://smartstore.naver.com/testmall/products/5108",
            review_text="워커 404 언래핑 테스트",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        with patch("main._pw_in_worker_thread", return_value=False), patch(
            "main._pw_call",
            side_effect=RuntimeError(
                "Playwright worker task failed: 404: seller_review_not_found\nTraceback..."
            ),
        ):
            with self.assertRaises(HTTPException) as cm:
                main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(cm.exception.status_code, 404)
        self.assertEqual(str(cm.exception.detail), "seller_review_not_found")

    def test_submit_review_reply_via_browser_uses_extended_worker_timeout(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-worker-timeout",
            product_url="https://smartstore.naver.com/testmall/products/5112",
            review_text="장시간 자동 게시 timeout 완화 테스트",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        expected = {
            "reply_text": "초안 본문",
            "reply_written_at": date(2026, 4, 2),
            "detail": "댓글이 등록되었습니다.",
        }
        with patch("main._pw_in_worker_thread", return_value=False), patch(
            "main._pw_call",
            return_value=expected,
        ) as pw_call_mock:
            out = main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(out, expected)
        self.assertEqual(pw_call_mock.call_args.kwargs.get("timeout"), main.REVIEW_REPLY_SUBMIT_WORKER_TIMEOUT_SEC)

    def test_submit_review_reply_via_browser_uses_extended_confirmation_timeout(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-confirm-timeout",
            product_url="https://smartstore.naver.com/testmall/products/5113",
            review_text="등록 확인 대기시간 확장 테스트",
        )
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()

        class FakePage:
            def bring_to_front(self):
                return None

            def evaluate(self, _script, _payload=None):
                return {
                    "ok": True,
                    "review_id_original": "rv-1",
                    "editor_selector": "",
                    "submit_selector": "",
                }

        fake_page = FakePage()
        with patch("main._playwright_enabled", return_value=True), patch(
            "main._use_host_chrome",
            return_value=True,
        ), patch("main._pw_in_worker_thread", return_value=True), patch(
            "main._ensure_pw_context",
            return_value=object(),
        ), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page",
            return_value=fake_page,
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal",
            return_value=True,
        ), patch(
            "main._wait_for_review_reply_submit_confirmation",
            return_value={"state": "success", "detail": "댓글이 등록되었습니다."},
        ) as confirm_mock:
            out = main._submit_review_reply_via_browser(review_row, "초안 본문")

        self.assertEqual(out["detail"], "댓글이 등록되었습니다.")
        self.assertEqual(
            confirm_mock.call_args.kwargs.get("timeout_ms"),
            main.REVIEW_REPLY_SUBMIT_CONFIRM_TIMEOUT_MS,
        )

    def test_sanitize_review_reply_submit_detail_reduces_large_validation_text(self) -> None:
        raw = (
            "리뷰 상세보기 리뷰 글번호 4940642964 상품구분번호 20260313... "
            "판매자답글 본문 전체가 길게 붙어 있습니다. "
            "필수 정보입니다. 추가 문장과 화면 전체 텍스트가 이어집니다."
        )
        out = main._sanitize_review_reply_submit_detail("reply_submit_validation_failed", raw)
        self.assertEqual(out, "필수 정보입니다")

    def test_type_reply_text_into_editor_prefers_fill_without_waiting(self) -> None:
        class FakeEditor:
            def __init__(self):
                self.fill_calls: list[tuple[str, int | None]] = []
                self.type_calls: list[tuple[str, int | None, int | None]] = []

            def fill(self, text, timeout=None):
                self.fill_calls.append((text, timeout))

            def type(self, text, delay=None, timeout=None):
                self.type_calls.append((text, delay, timeout))

        class FakePage:
            def __init__(self):
                self.waits: list[int] = []

            def wait_for_timeout(self, ms):
                self.waits.append(ms)
                return None

        editor = FakeEditor()
        page = FakePage()
        text = (
            "안녕하세요 고객님. 소중한 리뷰 감사합니다. "
            "정성껏 남겨주신 의견을 참고하여 더 만족하실 수 있도록 꼼꼼하게 관리하겠습니다. "
            "다음 주문에서도 좋은 경험이 되실 수 있게 최선을 다하겠습니다."
        )

        count = main._type_reply_text_into_editor(editor, page, text)

        self.assertEqual(count, 1)
        self.assertEqual(editor.fill_calls, [(text, 5000)])
        self.assertEqual(editor.type_calls, [])
        self.assertEqual(page.waits, [])

    def test_wait_for_reply_text_applied_waits_one_second_after_confirmed(self) -> None:
        class FakePage:
            def __init__(self):
                self.waits: list[int] = []
                self.results = [
                    {"ok": False, "value": "", "counter": 0},
                    {"ok": False, "value": "안녕하세요 고객님", "counter": 0},
                    {"ok": True, "value": "안녕하세요 고객님. 리뷰 감사합니다.", "counter": 15},
                ]

            def evaluate(self, _script, _payload):
                return self.results.pop(0)

            def wait_for_timeout(self, ms):
                self.waits.append(ms)
                return None

        page = FakePage()

        out = main._wait_for_reply_text_applied(
            page,
            selector='[data-erp2-reply-editor="1"]',
            expected="안녕하세요 고객님. 리뷰 감사합니다.",
            max_attempts=4,
            poll_interval_ms=150,
            settle_delay_ms=1000,
        )

        self.assertTrue(out["ok"])
        self.assertEqual(page.waits, [150, 150, 1000])

    def test_review_reply_draft_submit_rejects_unapproved_draft(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-2",
            product_url="https://smartstore.naver.com/testmall/products/5102",
            review_text="자동 게시 차단 테스트",
        )
        self._insert_draft(
            draft_id="draft-submit-2",
            review_key=review_key,
            status="generated",
            draft_text="아직 승인되지 않은 초안",
        )

        with patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_api_unavailable"},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": True, "reason": None},
        ):
            resp = self.client.post("/reviews/reply-drafts/submit", json={"draft_id": "draft-submit-2"})

        self.assertEqual(resp.status_code, 409, msg=resp.text)
        self.assertIn("draft_status_not_approved", resp.text)

    def test_review_reply_draft_bulk_submit_start_and_status_returns_background_job_state(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:bulk-submit-1",
            product_url="https://smartstore.naver.com/testmall/products/5103",
            review_text="일괄 자동 게시 시작 대상",
        )
        self._insert_draft(
            draft_id="draft-bulk-submit-1",
            review_key=review_key,
            status="approved",
            draft_text="일괄 자동 게시 승인 초안",
        )

        with patch("main.require_role_level", return_value=["ops_admin"]) as role_mock, patch(
            "main._check_review_reply_commerce_api_ready",
        self._mark_auto_post_ready(review_key)
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._check_review_reply_bulk_browser_ready",
            return_value={"ready": False, "reason": "browser_host_cdp_not_enabled"},
        ), patch(
            "main._run_review_reply_bulk_submit_job",
            return_value=None,
        ):
            start_resp = self.client.post("/reviews/reply-drafts/bulk-submit/start", json={"limit": 0})

        self.assertEqual(start_resp.status_code, 200, msg=start_resp.text)
        start_body = start_resp.json()
        self.assertTrue(start_body["ok"])
        self.assertTrue(start_body["scheduled"])
        self.assertEqual(start_body["status"], "STARTED")
        self.assertEqual(start_body["pending_targets"], 1)
        self.assertTrue(start_body["job_id"])
        role_mock.assert_called()

        with patch("main.require_role_level", return_value=["ops_admin"]):
            status_resp = self.client.get("/reviews/reply-drafts/bulk-submit/status", params={"job_id": start_body["job_id"]})
        self.assertEqual(status_resp.status_code, 200, msg=status_resp.text)
        status_body = status_resp.json()
        self.assertEqual(status_body["job_id"], start_body["job_id"])
        self.assertEqual(status_body["status"], "STARTED")
        self.assertEqual(status_body["pending_targets"], 1)

    def test_review_reply_draft_bulk_submit_start_returns_blocked_when_no_submit_channel_ready(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:bulk-submit-blocked-1",
            product_url="https://smartstore.naver.com/testmall/products/5104",
            review_text="자동 게시 차단 대상",
        )
        self._insert_draft(
            draft_id="draft-bulk-submit-blocked-1",
            review_key=review_key,
            status="approved",
            draft_text="자동 게시 차단 승인 초안",
        )

        with patch("main.require_role_level", return_value=["ops_admin"]), patch(
            "main._check_review_reply_commerce_api_ready",
        self._mark_auto_post_ready(review_key)

        with patch("main.require_role_level", return_value=["ops_admin"]), patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": False, "reason": "commerce_ip_not_allowed"},
        ), patch(
            "main._check_review_reply_bulk_browser_ready",
            return_value={"ready": False, "reason": "browser_host_cdp_not_enabled"},
        ):
            start_resp = self.client.post("/reviews/reply-drafts/bulk-submit/start", json={"limit": 0})

        self.assertEqual(start_resp.status_code, 200, msg=start_resp.text)
        body = start_resp.json()
        self.assertTrue(body["ok"])
        self.assertFalse(body["scheduled"])
        self.assertEqual(body["status"], "BLOCKED")
        self.assertEqual(body["pending_targets"], 0)
        self.assertIn("commerce_ip_not_allowed", str(body["detail"]))

    def test_review_reply_draft_bulk_submit_stop_requests_cancellation(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:bulk-submit-stop-1",
            product_url="https://smartstore.naver.com/testmall/products/5105",
            review_text="자동 게시 중지 대상",
        )
        self._insert_draft(
            draft_id="draft-bulk-submit-stop-1",
            review_key=review_key,
            status="approved",
            draft_text="자동 게시 중지 승인 초안",
        )
        self._mark_auto_post_ready(review_key)
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._check_review_reply_bulk_browser_ready",
            return_value={"ready": False, "reason": "browser_host_cdp_not_enabled"},
        ), patch(
            "main._run_review_reply_bulk_submit_job",
            return_value=None,
        ):
            start_resp = self.client.post("/reviews/reply-drafts/bulk-submit/start", json={"limit": 0})
            self.assertEqual(start_resp.status_code, 200, msg=start_resp.text)
            job_id = start_resp.json()["job_id"]
            stop_resp = self.client.post("/reviews/reply-drafts/bulk-submit/stop", json={"job_id": job_id})

        self.assertEqual(stop_resp.status_code, 200, msg=stop_resp.text)
        stop_body = stop_resp.json()
        self.assertTrue(stop_body["ok"])
        self.assertFalse(stop_body["scheduled"])
        self.assertEqual(stop_body["job_id"], job_id)
        self.assertEqual(stop_body["status"], "CANCELLED")
        self.assertTrue(stop_body["cancel_requested"])
        role_mock.assert_called()

    def test_build_review_reply_submit_context_allows_auto_progress_for_reply_exists_flag_without_reply_text(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:submit-block-flag-only",
            product_url="https://smartstore.naver.com/testmall/products/5110",
            review_text="이미 답글이 있는 리뷰",
        )
        self._set_review_reply_flags(
            review_key=review_key,
            reply_exists_flag=True,
            reply_collect_status="pending",
        )
        self._insert_draft(
            draft_id="draft-submit-block-flag-only",
            review_key=review_key,
            status="approved",
            draft_text="승인 초안",
        )

        with SessionLocal() as db, patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._check_review_reply_browser_ready",
            return_value={"ready": False, "reason": "browser_host_cdp_not_enabled"},
        ):
            ctx = main._build_review_reply_submit_context(db, draft_id="draft-submit-block-flag-only")

        self.assertTrue(bool(ctx["can_submit"]))
        self.assertIn("review_already_replied", list(ctx["blockers"] or []))

    def test_scan_review_reply_bulk_submit_targets_includes_reply_exists_flag_without_reply_text_for_auto_progress(self) -> None:
        reply_exists_key = self._insert_review(
            review_key="naver_review:bulk-submit-flag-only",
    def test_scan_review_reply_bulk_submit_targets_excludes_reply_exists_flag_without_reply_text(self) -> None:
            review_text="답글여부만 있는 리뷰",
        )
        eligible_key = self._insert_review(
            review_key="naver_review:bulk-submit-eligible",
            product_url="https://smartstore.naver.com/testmall/products/5111",
            review_text="정상 자동 게시 대상",
        )
        self._set_review_reply_flags(
            review_key=reply_exists_key,
            reply_exists_flag=True,
            reply_collect_status="pending",
        )
        self._insert_draft(
            draft_id="draft-bulk-submit-flag-only",
            review_key=reply_exists_key,
            status="approved",
            draft_text="답글 존재 초안",
        )
        self._insert_draft(
            draft_id="draft-bulk-submit-eligible",
            review_key=eligible_key,
            status="approved",
            draft_text="정상 초안",
        )

        with SessionLocal() as db, patch(
            "main._check_review_reply_commerce_api_ready",
        self._mark_auto_post_ready(reply_exists_key, eligible_key)

        with SessionLocal() as db, patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._check_review_reply_bulk_browser_ready",
            return_value={"ready": True, "reason": None},
        ):
            snapshot = main._scan_review_reply_bulk_submit_targets(db)

        draft_ids = [str(getattr(row, "draft_id", "") or "") for row in list(snapshot.get("eligible_draft_rows") or [])]
        self.assertEqual(snapshot["eligible_count"], 1)
        self.assertEqual(draft_ids, ["draft-bulk-submit-eligible"])
        self.assertEqual(snapshot["blocker_counts"]["review_already_replied"], 1)

    def test_scan_review_reply_bulk_submit_targets_excludes_terminal_unavailable_reviews(self) -> None:
        deleted_key = self._insert_review(
            review_key="naver_review:bulk-submit-deleted-terminal",
            product_url="https://smartstore.naver.com/testmall/products/5111",
            review_text="삭제되어 자동 게시 불가한 리뷰",
        )
        blocked_key = self._insert_review(
            review_key="naver_review:bulk-submit-blocked-terminal",
            product_url="https://smartstore.naver.com/testmall/products/5111",
            review_text="블라인드되어 자동 게시 불가한 리뷰",
        )
        eligible_key = self._insert_review(
            review_key="naver_review:bulk-submit-eligible-terminal-check",
            product_url="https://smartstore.naver.com/testmall/products/5111",
            review_text="정상 자동 게시 대상",
        )
        self._set_review_reply_flags(review_key=deleted_key, reply_collect_status="seller_deleted")
        self._set_review_reply_flags(review_key=blocked_key, reply_collect_status="seller_blocked")
        self._insert_draft(
            draft_id="draft-bulk-submit-deleted-terminal",
            review_key=deleted_key,
            status="approved",
            draft_text="삭제 terminal 초안",
        )
        self._insert_draft(
            draft_id="draft-bulk-submit-blocked-terminal",
            review_key=blocked_key,
            status="approved",
            draft_text="blocked terminal 초안",
        )
        self._insert_draft(
            draft_id="draft-bulk-submit-eligible-terminal-check",
            review_key=eligible_key,
            status="approved",
            draft_text="정상 초안",
        )
        self._mark_auto_post_ready(deleted_key, blocked_key, eligible_key)
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._check_review_reply_bulk_browser_ready",
            return_value={"ready": True, "reason": None},
        ):
            snapshot = main._scan_review_reply_bulk_submit_targets(db)

        draft_ids = [str(getattr(row, "draft_id", "") or "") for row in list(snapshot.get("eligible_draft_rows") or [])]
        self.assertEqual(snapshot["eligible_count"], 1)
        self.assertEqual(draft_ids, ["draft-bulk-submit-eligible-terminal-check"])
        self.assertEqual(snapshot["blocker_counts"]["seller_review_deleted"], 1)
        self.assertEqual(snapshot["blocker_counts"]["seller_review_blocked"], 1)

    def test_review_reply_bulk_stage_preview_counts_current_filtered_scope(self) -> None:
        new_key = self._insert_review(
            review_key="naver_review:bulk-stage-new",
            product_url="https://smartstore.naver.com/testmall/products/8801",
            review_text="미작성 대상",
            rating=5.0,
        )
        pending_key = self._insert_review(
            review_key="naver_review:bulk-stage-pending",
            product_url="https://smartstore.naver.com/testmall/products/8801",
            review_text="검토대기 대상",
            rating=5.0,
        )
        approved_key = self._insert_review(
            review_key="naver_review:bulk-stage-approved",
            product_url="https://smartstore.naver.com/testmall/products/8801",
            review_text="승인 대상",
            rating=5.0,
        )
        backfill_key = self._insert_review(
            review_key="naver_review:bulk-stage-backfill",
            product_url="https://smartstore.naver.com/testmall/products/8801",
            review_text="보강 대상",
            rating=5.0,
        )
        self._insert_draft(
            draft_id="draft-bulk-stage-pending",
            review_key=pending_key,
            status="generated",
            draft_text="검토대기 초안",
        )
        self._insert_draft(
            draft_id="draft-bulk-stage-approved",
            review_key=approved_key,
            status="approved",
            draft_text="승인 초안",
        )
        self._set_review_reply_flags(
            review_key=backfill_key,
            reply_exists_flag=True,
            reply_collect_status="pending",
        )
        self.assertEqual(new_key, "naver_review:bulk-stage-new")

        with patch("main.require_role_level", return_value=["superadmin"]), patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._check_review_reply_bulk_browser_ready",
            return_value={"ready": False, "reason": "browser_host_cdp_not_enabled"},
        ):
            resp = self.client.get(
                "/reviews/reply-bulk-stage/preview",
                params={
                    "product_url": "https://smartstore.naver.com/testmall/products/8801",
                    "status_filter": "all",
                    "rating_filters": ["5"],
                },
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["filtered_total"], 4)
        self.assertEqual(body["generate_count"], 1)
        self.assertEqual(body["approve_count"], 1)
        self.assertEqual(body["reject_count"], 1)
        self.assertEqual(body["submit_count"], 1)
        self.assertEqual(body["backfill_count"], 2)

    def test_review_reply_bulk_stage_start_and_status_returns_background_job_state(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:bulk-stage-start",
            product_url="https://smartstore.naver.com/testmall/products/8802",
            review_text="검토대기 일괄 승인 대상",
            rating=5.0,
        )
        self._insert_draft(
            draft_id="draft-bulk-stage-start",
            review_key=review_key,
            status="generated",
            draft_text="검토대기 초안",
        )

        with patch("main.require_role_level", return_value=["superadmin"]) as role_mock, patch(
            "main._run_review_reply_bulk_stage_job",
            return_value=None,
        ):
            start_resp = self.client.post(
                "/reviews/reply-bulk-stage/start",
                json={
                    "stage": "approve",
                    "product_url": "https://smartstore.naver.com/testmall/products/8802",
                    "rating_filters": ["5"],
                    "status_filter": "all",
                },
            )

        self.assertEqual(start_resp.status_code, 200, msg=start_resp.text)
        start_body = start_resp.json()
        self.assertTrue(start_body["ok"])
        self.assertTrue(start_body["scheduled"])
        self.assertEqual(start_body["stage"], "approve")
        self.assertEqual(start_body["status"], "STARTED")
        self.assertEqual(start_body["pending_targets"], 1)
        self.assertTrue(start_body["job_id"])
        role_mock.assert_called()

        with patch("main.require_role_level", return_value=["superadmin"]):
            status_resp = self.client.get("/reviews/reply-bulk-stage/status", params={"job_id": start_body["job_id"]})
        self.assertEqual(status_resp.status_code, 200, msg=status_resp.text)
        status_body = status_resp.json()
        self.assertEqual(status_body["job_id"], start_body["job_id"])
        self.assertEqual(status_body["stage"], "approve")
        self.assertEqual(status_body["status"], "STARTED")

    def test_review_reply_bulk_stage_stop_requests_cancellation(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:bulk-stage-stop",
            product_url="https://smartstore.naver.com/testmall/products/8804",
            review_text="승인 답글 자동 게시 중지 대상",
            rating=5.0,
        )
        self._insert_draft(
            draft_id="draft-bulk-stage-stop",
            review_key=review_key,
            status="approved",
            draft_text="승인된 초안",
        )

        with patch("main.require_role_level", return_value=["superadmin"]), patch(
            "main._check_review_reply_commerce_api_ready",
            return_value={"ready": True, "reason": None},
        ), patch(
            "main._check_review_reply_bulk_browser_ready",
            return_value={"ready": False, "reason": "browser_host_cdp_not_enabled"},
        ), patch(
            "main._run_review_reply_bulk_stage_job",
            return_value=None,
        ):
            start_resp = self.client.post(
                "/reviews/reply-bulk-stage/start",
                json={
                    "stage": "submit",
                    "product_url": "https://smartstore.naver.com/testmall/products/8804",
                    "rating_filters": ["5"],
                    "status_filter": "all",
                },
            )
            self.assertEqual(start_resp.status_code, 200, msg=start_resp.text)
            job_id = start_resp.json()["job_id"]
            stop_resp = self.client.post("/reviews/reply-bulk-stage/stop", json={"job_id": job_id})

        self.assertEqual(stop_resp.status_code, 200, msg=stop_resp.text)
        stop_body = stop_resp.json()
        self.assertTrue(stop_body["ok"])
        self.assertEqual(stop_body["job_id"], job_id)
        self.assertEqual(stop_body["status"], "CANCELLED")
        self.assertTrue(stop_body["cancel_requested"])

    def test_review_reply_bulk_stage_preview_supports_no_rating_filter(self) -> None:
        pending_key = self._insert_review(
            review_key="naver_review:bulk-stage-no-rating",
            product_url="https://smartstore.naver.com/testmall/products/8803",
            review_text="평점 없는 검토대기 대상",
            rating=None,
        )
        self._insert_draft(
            draft_id="draft-bulk-stage-no-rating",
            review_key=pending_key,
            status="generated",
            draft_text="평점 없는 검토대기 초안",
        )

        with patch("main.require_role_level", return_value=["superadmin"]):
            resp = self.client.get(
                "/reviews/reply-bulk-stage/preview",
                params={
                    "product_url": "https://smartstore.naver.com/testmall/products/8803",
                    "status_filter": "pending",
                    "rating_filters": ["none"],
                },
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["filtered_total"], 1)
        self.assertEqual(body["approve_count"], 1)
        self.assertEqual(body["reject_count"], 1)
        self.assertIn("평점 없음", body["filter_summary"])

    def test_manual_complete_marks_existing_reply_enrichment_target_as_completed(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:manual-complete-existing-reply",
            product_url="https://smartstore.naver.com/testmall/products/8810",
            review_text="관리자가 수동 완료 처리할 리뷰",
        )
        self._set_review_reply_flags(
            review_key=review_key,
            reply_exists_flag=True,
            reply_collect_status="pending",
        )
        self._insert_draft(
            draft_id="draft-manual-complete-existing-reply",
            review_key=review_key,
            status="approved",
            draft_text="수동 완료 처리 대상 초안",
        )

        with patch("main.require_role_level", return_value=["ops_admin"]):
            resp = self.client.post(
                "/reviews/reply-drafts/manual-complete",
                json={"draft_id": "draft-manual-complete-existing-reply"},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["result_type"], "manual_completed")
        self.assertIn("관리자가", str(body.get("detail") or ""))

        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertTrue(bool(review_row.reply_exists_flag))
            self.assertEqual(review_row.reply_collect_status, "manual_completed")

    def test_review_reply_draft_status_rejects_invalid_transition(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:transition-1",
            product_url="https://smartstore.naver.com/testmall/products/8803",
            review_text="전이 검증 대상",
            rating=5.0,
        )
        self._insert_draft(
            draft_id="draft-transition-1",
            review_key=review_key,
            status="failed",
            draft_text="실패 초안",
        )

        resp = self.client.post(
            "/reviews/reply-drafts/status",
            json={"draft_id": "draft-transition-1", "status": "approved"},
        )

        self.assertEqual(resp.status_code, 409, msg=resp.text)
        self.assertIn("draft_status_transition_not_allowed", resp.text)

    def test_import_smartstore_review_file_marks_reply_backfill_targets(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,새치 헤나 염색약,일반,5,,만족합니다,,tester****,2026.03.30. 15:34:18,,4942028965,,,정상,Y,2026.03.30. 16:02:53\n"
            "4743750201,새치 헤나 염색약,일반,4,,재구매 예정입니다,,tester2****,2026.03.31. 09:38:32,,4943320816,,,정상,N,\n"
        ).encode("utf-8-sig")

        resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["processed_rows"], 2)
        self.assertEqual(body["saved_reviews"], 2)
        self.assertEqual(body["reply_exists_rows"], 1)
        self.assertEqual(body["reply_backfill_targets"], 1)
        self.assertEqual(body["imported_date_from"], "2026-03-30")
        self.assertEqual(body["imported_date_to"], "2026-03-31")

        with SessionLocal() as db:
            imported = (
                db.query(NaverReviewRaw)
                .filter(NaverReviewRaw.review_id_original == "4942028965")
                .one()
            )
            self.assertEqual(imported.product_title, "새치 헤나 염색약")
            self.assertEqual(imported.import_source, "smartstore_review_upload")
            self.assertEqual(imported.reply_exists_flag, True)
            self.assertEqual(imported.reply_collect_status, "pending")

    def test_import_smartstore_review_file_keeps_uploaded_reply_flag_when_text_exists(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시,답글내용\n"
            "4743750201,새치 헤나 염색약,일반,5,,본문만 있는 업로드,,tester****,2026.03.30. 15:34:18,,4942029999,,,정상,N,2026.03.30. 16:02:53,이미 등록된 듯 보이는 답글\n"
        ).encode("utf-8-sig")

        resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["reply_exists_rows"], 0)
        self.assertEqual(body["reply_backfill_targets"], 0)

        with SessionLocal() as db:
            imported = (
                db.query(NaverReviewRaw)
                .filter(NaverReviewRaw.review_id_original == "4942029999")
                .one()
            )
            reply = (
                db.query(NaverReviewReplyRaw)
                .filter(NaverReviewReplyRaw.review_key == imported.review_key)
                .one()
            )
            self.assertFalse(bool(imported.reply_exists_flag))
            self.assertEqual(imported.reply_collect_status, "pending")
            self.assertEqual(reply.reply_text, "이미 등록된 듯 보이는 답글")

    def test_reply_backfill_enrich_updates_only_reply_flagged_reviews(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,새치 헤나 염색약,일반,5,,만족합니다,,tester****,2026.03.30. 15:34:18,,4942028965,,,정상,Y,2026.03.30. 16:02:53\n"
            "4743750201,새치 헤나 염색약,일반,4,,재구매 예정입니다,,tester2****,2026.03.31. 09:38:32,,4943320816,,,정상,N,\n"
        ).encode("utf-8-sig")
        upload_resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )
        self.assertEqual(upload_resp.status_code, 200, msg=upload_resp.text)

        with patch(
            "main._collect_smartstore_admin_reply_candidates",
            return_value=[
                {
                    "review_id_original": "4942028965",
                    "reply_text": "소중한 리뷰 감사합니다. 계속 만족드리겠습니다.",
                    "reply_written_at": date(2026, 3, 30),
                }
            ],
        ):
            resp = self.client.post(
                "/reviews/reply-backfill/enrich",
                json={"limit": 10, "max_pages": 2},
            )

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["requested"], 1)
        self.assertEqual(body["collected"], 1)
        self.assertEqual(body["failed"], 0)
        self.assertEqual(body["skipped"], 0)
        self.assertEqual(body["items"][0]["status"], "collected")

        with SessionLocal() as db:
            target = (
                db.query(NaverReviewRaw)
                .filter(NaverReviewRaw.review_id_original == "4942028965")
                .one()
            )
            untouched = (
                db.query(NaverReviewRaw)
                .filter(NaverReviewRaw.review_id_original == "4943320816")
                .one()
            )
            reply = (
                db.query(NaverReviewReplyRaw)
                .filter(NaverReviewReplyRaw.review_key == target.review_key)
                .one()
            )
            self.assertEqual(target.reply_collect_status, "collected")
            self.assertEqual(reply.reply_text, "소중한 리뷰 감사합니다. 계속 만족드리겠습니다.")
            self.assertEqual(untouched.reply_exists_flag, False)
            self.assertIsNone(
                db.query(NaverReviewReplyRaw)
                .filter(NaverReviewReplyRaw.review_key == untouched.review_key)
                .one_or_none()
            )

    def test_reply_backfill_enrich_passes_only_pending_review_ids_to_collector(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,새치 헤나 염색약,일반,5,,만족합니다,,tester****,2026.03.30. 15:34:18,,4942028965,,,정상,Y,2026.03.30. 16:02:53\n"
            "4743750201,새치 헤나 염색약,일반,5,,두번째 대상입니다,,tester2****,2026.03.31. 15:34:18,,4942397954,,,정상,Y,2026.03.31. 16:02:53\n"
            "4743750201,새치 헤나 염색약,일반,4,,답글 없는 리뷰입니다,,tester3****,2026.03.31. 09:38:32,,4943320816,,,정상,N,\n"
        ).encode("utf-8-sig")
        upload_resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )
        self.assertEqual(upload_resp.status_code, 200, msg=upload_resp.text)

        with SessionLocal() as db:
            already_collected = (
                db.query(NaverReviewRaw)
                .filter(NaverReviewRaw.review_id_original == "4942028965")
                .one()
            )
            already_collected.reply_collect_status = "collected"
            db.add(
                NaverReviewReplyRaw(
                    review_key=already_collected.review_key,
                    reply_text="이미 수집된 답글입니다.",
                    reply_written_at=date(2026, 3, 30),
                )
            )
            db.commit()

        captured_kwargs: dict = {}

        def fake_collect(**kwargs):
            captured_kwargs.update(kwargs)
            return [
                {
                    "review_id_original": "4942397954",
                    "reply_text": "판매자센터 검색으로 찾은 답글입니다.",
                    "reply_written_at": date(2026, 3, 31),
                }
            ]

        with patch("main._collect_smartstore_admin_reply_candidates", side_effect=fake_collect):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 10, "max_pages": 5})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertEqual(captured_kwargs.get("max_pages"), 5)
        self.assertEqual(captured_kwargs.get("target_review_ids"), ["4942397954"])
        self.assertGreaterEqual(int(captured_kwargs.get("max_items") or 0), 20)

        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["requested"], 1)
        self.assertEqual(body["collected"], 1)
        self.assertEqual(body["items"][0]["review_id_original"], "4942397954")
        self.assertEqual(body["items"][0]["status"], "collected")

    def test_reply_backfill_enrich_fills_limit_after_excluding_existing_reply_rows(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,상품A,일반,5,,리뷰A,,tester1****,2026.04.01. 10:00:00,,4943000001,,,정상,Y,2026.04.01. 11:00:00\n"
            "4743750201,상품B,일반,5,,리뷰B,,tester2****,2026.04.01. 09:50:00,,4943000002,,,정상,Y,2026.04.01. 11:10:00\n"
            "4743750201,상품C,일반,5,,리뷰C,,tester3****,2026.04.01. 09:40:00,,4943000003,,,정상,Y,2026.04.01. 11:20:00\n"
            "4743750201,상품D,일반,5,,리뷰D,,tester4****,2026.04.01. 09:30:00,,4943000004,,,정상,Y,2026.04.01. 11:30:00\n"
        ).encode("utf-8-sig")
        upload_resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )
        self.assertEqual(upload_resp.status_code, 200, msg=upload_resp.text)

        with SessionLocal() as db:
            for review_id in ("4943000001", "4943000002"):
                row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_id_original == review_id).one()
                db.add(
                    NaverReviewReplyRaw(
                        review_key=row.review_key,
                        reply_text=f"이미 저장된 답글 {review_id}",
                        reply_written_at=date(2026, 4, 1),
                    )
                )
            db.commit()

        captured_kwargs: dict = {}

        def fake_collect(**kwargs):
            captured_kwargs.update(kwargs)
            return [
                {
                    "review_id_original": "4943000003",
                    "reply_text": "상품C 답글",
                    "reply_written_at": date(2026, 4, 1),
                },
                {
                    "review_id_original": "4943000004",
                    "reply_text": "상품D 답글",
                    "reply_written_at": date(2026, 4, 1),
                },
            ]

        with patch("main._collect_smartstore_admin_reply_candidates", side_effect=fake_collect):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 2, "max_pages": 3})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertEqual(sorted(captured_kwargs.get("target_review_ids") or []), ["4943000003", "4943000004"])

        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["requested"], 2)
        self.assertEqual(body["collected"], 2)
        self.assertEqual(sorted(item["review_id_original"] for item in body["items"]), ["4943000003", "4943000004"])

    def test_reply_backfill_enrich_drains_all_targets_across_multiple_batches(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,상품A,일반,5,,리뷰A,,tester1****,2026.04.01. 10:00:00,,4943100001,,,정상,Y,2026.04.01. 11:00:00\n"
            "4743750201,상품B,일반,5,,리뷰B,,tester2****,2026.04.01. 09:50:00,,4943100002,,,정상,Y,2026.04.01. 11:10:00\n"
            "4743750201,상품C,일반,5,,리뷰C,,tester3****,2026.04.01. 09:40:00,,4943100003,,,정상,Y,2026.04.01. 11:20:00\n"
        ).encode("utf-8-sig")
        upload_resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )
        self.assertEqual(upload_resp.status_code, 200, msg=upload_resp.text)

        collector_calls: list[list[str]] = []

        def fake_collect(**kwargs):
            review_ids = list(kwargs.get("target_review_ids") or [])
            collector_calls.append(review_ids)
            return [
                {
                    "review_id_original": review_id,
                    "reply_text": f"{review_id} 답글",
                    "reply_written_at": date(2026, 4, 1),
                }
                for review_id in review_ids
            ]

        with patch("main._collect_smartstore_admin_reply_candidates", side_effect=fake_collect):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 1, "max_pages": 3})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertEqual(sorted(call[0] for call in collector_calls), ["4943100001", "4943100002", "4943100003"])

        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["requested"], 3)
        self.assertEqual(body["processed"], 3)
        self.assertEqual(body["collected"], 3)
        self.assertEqual(body["failed"], 0)
        self.assertEqual(body["skipped"], 0)

    def test_reply_backfill_enrich_marks_unmatched_rows_as_not_found(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,상품A,일반,5,,리뷰A,,tester1****,2026.04.01. 10:00:00,,4943200001,,,정상,Y,2026.04.01. 11:00:00\n"
        ).encode("utf-8-sig")
        upload_resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )
        self.assertEqual(upload_resp.status_code, 200, msg=upload_resp.text)

        with patch("main._collect_smartstore_admin_reply_candidates", return_value=[]):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 1, "max_pages": 1})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["skipped"], 1)
        self.assertEqual(body["items"][0]["status"], "not_found")

        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_id_original == "4943200001").one()
            self.assertEqual(row.reply_collect_status, "not_found")

    def test_reply_backfill_enrich_rechecks_approved_rows_without_reply_and_marks_verified_absent(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:backfill-approved-recheck",
            product_url="https://smartstore.naver.com/testmall/products/9901",
            review_text="승인 초안이 있지만 실제 답글 없는 리뷰",
        )
        self._insert_draft(
            draft_id="draft-backfill-approved-recheck",
            review_key=review_key,
            status="approved",
            draft_text="승인 초안",
        )

        with patch("main._collect_smartstore_admin_reply_candidates", return_value=[]):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 5, "max_pages": 1})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["requested"], 1)
        self.assertEqual(body["skipped"], 1)
        self.assertEqual(body["items"][0]["status"], "verified_absent")

        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            self.assertFalse(bool(row.reply_exists_flag))
            self.assertEqual(row.reply_collect_status, "verified_absent")

        second_resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 5, "max_pages": 1})
        self.assertEqual(second_resp.status_code, 200, msg=second_resp.text)
        second_body = second_resp.json()
        self.assertTrue(second_body["ok"])
        self.assertEqual(second_body["requested"], 0)

    def test_reply_backfill_enrich_rechecks_approved_rows_and_promotes_found_reply(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:backfill-approved-found",
            product_url="https://smartstore.naver.com/testmall/products/9902",
            review_text="승인 초안이 있지만 실제 답글 있는 리뷰",
        )
        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            row.review_id_original = "4943900999"
            db.commit()
        self._insert_draft(
            draft_id="draft-backfill-approved-found",
            review_key=review_key,
            status="approved",
            draft_text="승인 초안",
        )

        with patch(
            "main._collect_smartstore_admin_reply_candidates",
            return_value=[
                {
                    "review_id_original": "4943900999",
                    "reply_text": "판매자센터에 이미 등록된 답글입니다.",
                    "reply_written_at": date(2026, 4, 2),
                }
            ],
        ):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 5, "max_pages": 1})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["requested"], 1)
        self.assertEqual(body["collected"], 1)
        self.assertEqual(body["items"][0]["status"], "collected")

        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            reply = db.query(NaverReviewReplyRaw).filter(NaverReviewReplyRaw.review_key == review_key).one()
            self.assertTrue(bool(row.reply_exists_flag))
            self.assertEqual(row.reply_collect_status, "collected")
            self.assertEqual(reply.reply_text, "판매자센터에 이미 등록된 답글입니다.")

    def test_reply_backfill_enrich_splits_timeout_batches_and_continues(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,상품A,일반,5,,리뷰A,,tester1****,2026.04.01. 10:00:00,,4943300001,,,정상,Y,2026.04.01. 11:00:00\n"
            "4743750201,상품B,일반,5,,리뷰B,,tester2****,2026.04.01. 09:50:00,,4943300002,,,정상,Y,2026.04.01. 11:10:00\n"
            "4743750201,상품C,일반,5,,리뷰C,,tester3****,2026.04.01. 09:40:00,,4943300003,,,정상,Y,2026.04.01. 11:20:00\n"
            "4743750201,상품D,일반,5,,리뷰D,,tester4****,2026.04.01. 09:30:00,,4943300004,,,정상,Y,2026.04.01. 11:30:00\n"
        ).encode("utf-8-sig")
        upload_resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )
        self.assertEqual(upload_resp.status_code, 200, msg=upload_resp.text)

        collector_batch_sizes: list[int] = []

        def fake_collect(**kwargs):
            review_ids = list(kwargs.get("target_review_ids") or [])
            collector_batch_sizes.append(len(review_ids))
            if len(review_ids) > 2:
                raise TimeoutError("Playwright worker task timed out")
            return [
                {
                    "review_id_original": review_id,
                    "reply_text": f"{review_id} 답글",
                    "reply_written_at": date(2026, 4, 1),
                }
                for review_id in review_ids
            ]

        with patch("main._collect_smartstore_admin_reply_candidates", side_effect=fake_collect):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 4, "max_pages": 3})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertEqual(collector_batch_sizes, [4, 2, 2])

        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["collected"], 4)
        self.assertEqual(body["failed"], 0)
        self.assertEqual(body["skipped"], 0)

    def test_reply_backfill_enrich_marks_single_timeout_rows_as_failed_without_500(self) -> None:
        csv_bytes = (
            "상품번호,상품명,리뷰구분,구매자평점,포토/영상,리뷰상세내용,리뷰도움수,등록자,리뷰등록일,최종수정일,리뷰글번호,관련리뷰글번호,관련리뷰상세내용,전시상태,답글여부,답글등록일시\n"
            "4743750201,상품A,일반,5,,리뷰A,,tester1****,2026.04.01. 10:00:00,,4943400001,,,정상,Y,2026.04.01. 11:00:00\n"
        ).encode("utf-8-sig")
        upload_resp = self.client.post(
            "/reviews/import-smartstore-file",
            files={"file": ("review_upload.csv", csv_bytes, "text/csv")},
        )
        self.assertEqual(upload_resp.status_code, 200, msg=upload_resp.text)

        with patch("main._collect_smartstore_admin_reply_candidates", side_effect=TimeoutError("Playwright worker task timed out")):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 1, "max_pages": 1})

        self.assertEqual(resp.status_code, 200, msg=resp.text)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["failed"], 1)
        self.assertEqual(body["items"][0]["status"], "failed")
        self.assertIn("timeout", str(body["items"][0]["detail"]).lower())

        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_id_original == "4943400001").one()
            self.assertEqual(row.reply_collect_status, "failed")

    def test_reply_backfill_enrich_returns_503_when_host_cdp_is_not_available(self) -> None:
        review_key = self._insert_review(
            review_key="naver_review:backfill-hostcdp",
            product_url="smartstore-review-upload://product/4743750201",
            review_text="답글 보강 대상 리뷰",
        )
        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == review_key).one()
            row.review_id_original = "4942028965"
            row.import_source = "smartstore_review_upload"
            row.reply_exists_flag = True
            row.reply_collect_status = "pending"
            db.commit()

        with patch(
            "main._pw_call",
            side_effect=RuntimeError(
                "Playwright worker task failed: 503: browser_host_cdp_not_enabled: connect_over_cdp_failed"
            ),
        ):
            resp = self.client.post("/reviews/reply-backfill/enrich", json={"limit": 1, "max_pages": 1})

        self.assertEqual(resp.status_code, 503, msg=resp.text)
        self.assertIn("browser_host_cdp_not_enabled", resp.text)

    def test_seller_center_review_management_url_guard(self) -> None:
        self.assertTrue(main._seller_center_url_is_review_management("https://sell.smartstore.naver.com/#/customer/review"))
        self.assertTrue(main._seller_center_url_is_review_management("https://sell.smartstore.naver.com/#/review/manage"))
        self.assertFalse(main._seller_center_url_is_review_management("https://sell.smartstore.naver.com/#/naverpay/sale/unpayment"))
        self.assertFalse(main._seller_center_url_is_review_management("https://example.com"))

    def test_ensure_smartstore_review_management_page_navigates_when_customer_review_root_is_event_dom(self) -> None:
        class FakePage:
            def __init__(self):
                self.url = "https://sell.smartstore.naver.com/#/customer/review"
                self.goto_calls = []
                self.evaluate_calls = 0

            def goto(self, url, wait_until=None, timeout=None):
                self.goto_calls.append(
                    {
                        "url": url,
                        "wait_until": wait_until,
                        "timeout": timeout,
                    }
                )
                self.url = url
                return None

            def wait_for_timeout(self, _ms):
                return None

            def evaluate(self, _script):
                self.evaluate_calls += 1
                if self.evaluate_calls == 1:
                    return {
                        "hasReviewMenu": True,
                        "hasReviewColumns": False,
                        "hasReviewSearchForm": False,
                        "currentUrl": self.url,
                    }
                return {
                    "hasReviewMenu": True,
                    "hasReviewColumns": True,
                    "hasReviewSearchForm": True,
                    "currentUrl": self.url,
                }

        fake_page = FakePage()

        main._ensure_smartstore_review_management_page(fake_page)

        self.assertEqual(
            fake_page.goto_calls,
            [
                {
                    "url": "https://sell.smartstore.naver.com/#/review/search",
                    "wait_until": "domcontentloaded",
                    "timeout": 60000,
                }
            ],
        )

    def test_rewrite_cdp_websocket_url_replaces_loopback_host(self) -> None:
        out = main._rewrite_cdp_websocket_url(
            "http://192.168.65.254:9223",
            "ws://127.0.0.1:9223/devtools/browser/test-id",
        )
        self.assertEqual(out, "ws://192.168.65.254:9223/devtools/browser/test-id")

    def test_pw_cdp_connect_url_uses_json_version_websocket_url(self) -> None:
        class _FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return json.dumps(
                    {
                        "webSocketDebuggerUrl": "ws://127.0.0.1:9223/devtools/browser/test-id",
                    }
                ).encode("utf-8")

        with patch("main.PW_CDP_URL_OVERRIDE", "http://192.168.65.254:9223"):
            with patch("main.urllib.request.urlopen", return_value=_FakeResponse()):
                out = main._pw_cdp_connect_url()

        self.assertEqual(out, "ws://192.168.65.254:9223/devtools/browser/test-id")


if __name__ == "__main__":
    unittest.main()
