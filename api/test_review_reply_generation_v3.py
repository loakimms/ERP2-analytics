import json
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import review_reply_generation_v3 as v3
from db import (
    AnalyticsJobRun,
    CollectionTaskConfig,
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyDraft,
    ReviewReplyFeedbackKnowledge,
    SessionLocal,
    init_db,
)
from review_reply_knowledge import (
    AUTHORSHIP_AI_CONFIRMED,
    AUTHORSHIP_HUMAN_CONFIRMED,
    AUTHORSHIP_LIKELY_AI,
    AUTHORSHIP_LIKELY_HUMAN,
    AUTHORSHIP_UNKNOWN,
)

TODAY = date(2026, 10, 11)
NOW_UTC = datetime(2026, 10, 11, 3, 0, 0)
HUMAN_STYLE_REPLY = "안녕하세요 고객님, 소중한 후기 남겨주셔서 감사합니다. 사용하시면서 불편한 점은 없으셨는지 늘 살피겠습니다."


def _gate(**overrides) -> dict:
    kwargs = dict(
        rating=5.0,
        review_text="향이 은은하고 머릿결이 부드러워졌어요.",
        review_written_at=TODAY - timedelta(days=2),
        draft_status="approved",
        prompt_version=v3.PROMPT_VERSION,
        draft_generated_at=NOW_UTC - timedelta(hours=5),
        draft_text="안녕하세요 고객님, 머릿결이 부드러워지셨다니 저희도 기쁩니다. 은은한 향까지 좋게 봐주셔서 감사합니다.",
        draft_published_at=None,
        reply_exists=False,
        today=TODAY,
        now_utc=NOW_UTC,
    )
    kwargs.update(overrides)
    return v3.evaluate_auto_post(**kwargs)


class AutoPostGateTest(unittest.TestCase):
    def test_recent_positive_v3_draft_is_auto_post_candidate(self) -> None:
        res = _gate()
        self.assertTrue(res["eligible"], msg=res)
        self.assertEqual(res["route"], v3.ROUTE_AUTO_POST_CANDIDATE)

    def test_one_to_three_stars_are_never_auto_post(self) -> None:
        for rating, route in ((1.0, v3.ROUTE_ADMIN_DIRECT), (2.0, v3.ROUTE_ADMIN_DIRECT), (3.0, v3.ROUTE_ADMIN_REVIEW), (None, v3.ROUTE_ADMIN_DIRECT)):
            res = _gate(rating=rating)
            self.assertFalse(res["eligible"], msg=rating)
            self.assertEqual(res["route"], route, msg=rating)

    def test_sensitive_reviews_are_routed_to_admin(self) -> None:
        for text in (
            "쓰고 나서 두피가 따가워요.",
            "알레르기 반응이 올라왔어요.",
            "환불 요청합니다.",
            "최악이에요 다시는 안 삽니다.",
        ):
            res = _gate(review_text=text)
            self.assertFalse(res["eligible"], msg=text)
            self.assertEqual(res["route"], v3.ROUTE_ADMIN_DIRECT, msg=text)
            self.assertIn("sensitive_review", res["reasons"], msg=text)

    def test_negated_skin_words_are_not_sensitive(self) -> None:
        for text in (
            "자극 없어요. 향도 좋아요.",
            "따가움 전혀 없고 순해요.",
            "가려움이 하나도 없어요.",
            "트러블 안 나고 좋네요.",
            "두피 자극이 없어서 재구매했어요.",
            "피부에 자극도 덜한것같아 계속 구매해요.",
            "두피자극이 적고 모발손상이 없어요.",
            "저자극 염색에 좋아요.",
            "가려움증이 없어 신기했어요.",
        ):
            self.assertEqual(v3.detect_sensitive(text), [], msg=text)

    def test_real_irritation_wording_stays_sensitive(self) -> None:
        for text in (
            "향은 좋은데 좀 자극적이에요.",
            "3일 후부터 목과 턱 부분에 가려움증 심해서 안타깝네요.",
            "얼굴에 두드러기와 빨간 반점이 생겼어요.",
            "자극이 심해요.",
        ):
            self.assertIn("skin_or_allergy", v3.detect_sensitive(text), msg=text)

    def test_old_v1_v2_drafts_and_old_reviews_are_excluded(self) -> None:
        self.assertIn("draft_not_v3", _gate(prompt_version="review_reply_v2")["reasons"])
        self.assertIn("draft_not_v3", _gate(prompt_version="review_reply_v1")["reasons"])
        self.assertIn("draft_older_than_7d", _gate(draft_generated_at=NOW_UTC - timedelta(days=8))["reasons"])
        self.assertIn("review_older_than_30d", _gate(review_written_at=TODAY - timedelta(days=31))["reasons"])
        self.assertIn("review_older_than_30d", _gate(review_written_at=None)["reasons"])

    def test_tz_aware_generated_at_is_compared_in_utc(self) -> None:
        aware = datetime(2026, 10, 4, 4, 0, 0, tzinfo=timezone(timedelta(hours=9)))
        self.assertIn("draft_older_than_7d", _gate(draft_generated_at=aware)["reasons"])

    def test_replied_published_unapproved_and_failed_quality_are_blocked(self) -> None:
        self.assertIn("review_already_replied", _gate(reply_exists=True)["reasons"])
        self.assertIn("draft_already_published", _gate(draft_published_at=NOW_UTC)["reasons"])
        self.assertIn("draft_not_approved", _gate(draft_status="generated")["reasons"])
        res = _gate(draft_text="안녕하세요 고객님, 탈모 개선 효과를 보장합니다.")
        self.assertIn("quality_check_failed", res["reasons"])
        self.assertEqual(res["route"], v3.ROUTE_ADMIN_REVIEW)

    def test_seller_center_probe_interpretation_blocks_unknown(self) -> None:
        self.assertEqual(v3.interpret_seller_center_probe({"ok": True, "found": True, "has_comment": True})["state"], v3.SELLER_CENTER_REPLIED)
        self.assertEqual(v3.interpret_seller_center_probe({"ok": True, "found": True, "has_comment": False})["state"], v3.SELLER_CENTER_NOT_REPLIED)
        for raw in (
            {"ok": True, "found": False},
            {"ok": True, "found": False, "truncated": True},
            {"ok": False, "status": 401},
            {"ok": False, "error": "TypeError"},
            {"ok": True, "found": True, "has_comment": None},
            None,
        ):
            self.assertEqual(v3.interpret_seller_center_probe(raw)["state"], v3.SELLER_CENTER_UNKNOWN, msg=raw)

    def test_seller_center_search_request_window(self) -> None:
        self.assertIsNone(v3.seller_center_search_request("", TODAY, TODAY))
        self.assertIsNone(v3.seller_center_search_request("123", None, TODAY))
        req = v3.seller_center_search_request("123", TODAY, TODAY)
        self.assertEqual(req["fromDate"], "2026-10-10T00:00:00.000+09:00")
        self.assertEqual(req["toDate"], "2026-10-11T23:59:59.999+09:00")

    def test_daily_draft_window_is_three_days(self) -> None:
        self.assertEqual(v3.daily_draft_window(TODAY), (date(2026, 10, 9), TODAY))


class ReplyQualityTest(unittest.TestCase):
    def test_orange_complaint_misread_is_blocked(self) -> None:
        review = "색이 너무 오렌지색이에요. 생각보다 밝게 나왔어요."
        bad = v3.check_reply_quality("안녕하세요 고객님, 색상이 마음에 드셨다니 정말 기쁩니다.", review, 4)
        self.assertIn("SENTIMENT_MISREAD", bad["blocking"])
        good = v3.check_reply_quality(
            "안녕하세요 고객님, 생각보다 밝은 오렌지빛으로 나와 아쉬우셨을 것 같습니다. 남겨주신 의견 잘 살펴보겠습니다.",
            review,
            4,
        )
        self.assertNotIn("SENTIMENT_MISREAD", good["blocking"])

    def test_negated_satisfaction_acknowledgement_is_not_misread(self) -> None:
        res = v3.check_reply_quality("안녕하세요 고객님, 오렌지 색상이 마음에 드시지 않으셨군요.", "너무 오렌지이긴 한데요", 4)
        self.assertNotIn("SENTIMENT_MISREAD", res["blocking"])

    def test_blaming_customer_for_skin_reaction_is_blocked(self) -> None:
        review = "이 제품 사용하고 부작용이 처음 생겼어요. 테스트 없이 바로 사용해서 속상하네요."
        self.assertIn("skin_or_allergy", v3.detect_sensitive(review))
        bad = v3.check_reply_quality("불편을 드려 죄송합니다. 다음 번에는 패치 테스트를 통해 안전하게 사용하시길 바랍니다.", review, 1)
        self.assertIn("SAFETY_BLAME", bad["blocking"])
        good = v3.check_reply_quality(
            "불편을 드려 죄송합니다. 우선 사용을 중단하시고 증상이 계속되면 전문의 상담을 받아보시길 권해드립니다.", review, 1
        )
        self.assertNotIn("SAFETY_BLAME", good["blocking"])
        self.assertNotIn("SAFETY_GUIDANCE_MISSING", good["blocking"])
        later = v3.check_reply_quality("죄송합니다. 앞으로는 꼭 테스트 후 사용하시기를 권장드립니다. 사용을 중단해 주세요.", review, 1)
        self.assertIn("SAFETY_BLAME", later["blocking"])
        missing = v3.check_reply_quality("불편을 드려 죄송합니다. 건강한 피부 상태를 되찾으시길 바랍니다.", review, 1)
        self.assertIn("SAFETY_GUIDANCE_MISSING", missing["blocking"])
        msgs = v3.build_messages(
            product_title="수자타 레드 헤나", rating=1, option_text=None, review_text=review, guide={"facts": [], "rules": []}, examples=[]
        )
        self.assertIn("[피부 이상 리뷰]", msgs[1]["content"])

    def test_non_skin_review_has_no_safety_requirement(self) -> None:
        res = v3.check_reply_quality("후기 감사합니다. 머릿결이 좋아지셨다니 기쁩니다.", "자극 없고 머릿결 좋아요", 5)
        self.assertNotIn("SAFETY_GUIDANCE_MISSING", res["blocking"])

    def test_topic_cues_for_negated_wear_and_strong_orange(self) -> None:
        self.assertEqual(v3.guide_topics_for("머릿결이 나빠지지는 않네요"), [])
        self.assertIn("color", v3.guide_topics_for("두시간씩 네시간 동안 방치한거에 비해 오렌지빛이 강해요ㅜ"))
        self.assertNotIn(
            "SENTIMENT_MISREAD", v3.check_reply_quality("마음에 드셨다니 기쁩니다.", "레드가 진하게 잘 나와서 좋아요", 5)["blocking"]
        )

    def test_dwaemnida_form_counts_as_problem(self) -> None:
        self.assertIn("gray", v3.guide_topics_for("새치커버는 전혀 안됩니다"))
        self.assertIn("SENTIMENT_MISREAD", v3.check_reply_quality("새치 커버가 마음에 드셨다니 기쁩니다.", "새치커버는 전혀 안됩니다", 2)["blocking"])

    def test_efficacy_compensation_and_glyph_are_blocked(self) -> None:
        self.assertIn("UNVERIFIED_EFFICACY", v3.check_reply_quality("탈모 개선에 도움 드릴게요.", "좋아요", 5)["blocking"])
        self.assertIn("COMPENSATION_PROMISE", v3.check_reply_quality("바로 환불해 드리겠습니다.", "별로예요", 2)["blocking"])
        self.assertIn("NON_KOREAN_GLYPH", v3.check_reply_quality("감사합니다 顾客님.", "좋아요", 5)["blocking"])

    def test_cs_closing_without_question_is_warning(self) -> None:
        res = v3.check_reply_quality("감사합니다. 궁금한 점이 있으시면 언제든 문의 주세요.", "향이 좋아요.", 5)
        self.assertIn("UNNEEDED_CS_CLOSING", res["warnings"])

    def test_summary_records_missing_examples_and_guide(self) -> None:
        q = v3.check_reply_quality("감사합니다.", "좋아요", 5)
        text = v3.summarize_generation_qa(q, guide={"facts": []}, example_meta={"picked": 0, "picked_authorship": []})
        self.assertIn("review_reply_v3_qa=PASS", text)
        self.assertIn("NO_HUMAN_EXAMPLE", text)
        self.assertIn("NO_GUIDE_PRODUCT", text)
        text2 = v3.summarize_generation_qa(
            q, guide={"products": ["레드 헤나"], "topics": ["time"], "facts": []}, example_meta={"picked": 1, "picked_authorship": ["LIKELY_HUMAN"]}
        )
        self.assertIn("NO_GUIDE_UNIT", text2)
        self.assertIn("guide_topics=time", text2)


class GuideAndExampleTest(unittest.TestCase):
    def test_guide_units_load_and_select_only_matching_products(self) -> None:
        units = v3.load_guide_units()
        self.assertTrue(units)
        guide = v3.select_guide(
            units, product_title="수자타 레드 헤나 염색약 100g", review_text="새치커버가 전혀 안 됩니다. 시간을 더 둬야 하나요?"
        )
        self.assertIn("gray", guide["topics"])
        self.assertIn("time", guide["topics"])
        self.assertTrue(guide["facts"])
        self.assertLessEqual(len(guide["facts"]), v3.MAX_GUIDE_UNITS)
        for unit in guide["facts"] + guide["rules"]:
            self.assertTrue({"레드 헤나", "브라운 헤나"} & set(unit["products"]), msg=unit["unit_key"])
        joined = "\n".join(u["text"] for u in guide["facts"])
        self.assertNotIn("호호바", joined)
        self.assertIn("시간", joined)

    def test_satisfied_review_gets_no_usage_guide(self) -> None:
        units = v3.load_guide_units()
        for text in ("색상도 맘에 들고 자극 없어요. 계속 쓰고 있어요.", "배송도 빠르고 좋아요", "아직 사용 전이라 한달 뒤 후기"):
            guide = v3.select_guide(units, product_title="수자타 레드 헤나", review_text=text)
            self.assertEqual(guide["facts"], [], msg=text)
            msgs = v3.build_messages(
                product_title="수자타 레드 헤나", rating=5, option_text=None, review_text=text, guide=guide, examples=[]
            )
            self.assertIn("사용법 안내가 필요하지 않습니다", msgs[1]["content"], msg=text)

    def test_skin_problem_selects_caution_units(self) -> None:
        guide = v3.select_guide(v3.load_guide_units(), product_title="수자타 브라운 헤나", review_text="사용 후 두피가 가렵고 따가워요")
        self.assertIn("skin", guide["topics"])
        self.assertTrue(any(u["fact_type"] == "CAUTION" for u in guide["facts"]))
        side_effect = v3.select_guide(
            v3.load_guide_units(), product_title="수자타 레드 헤나", review_text="이 제품 사용하고 부작용이 처음 생겼어요."
        )
        self.assertIn("skin", side_effect["topics"])
        self.assertNotIn("first", side_effect["topics"])

    def test_greeting_fragment_is_not_counted_as_sentence(self) -> None:
        reply = "안녕하세요, 고객님! 후기 감사합니다. 머릿결이 좋아지셨다니 기쁩니다. 향도 좋게 봐주셔서 감사합니다. 앞으로도 정성껏 만들겠습니다. 좋은 하루 되세요!"
        self.assertNotIn("TOO_LONG", v3.check_reply_quality(reply, "머릿결 좋아요", 5)["warnings"])

    def test_unknown_product_gets_no_guide_and_explicit_instruction(self) -> None:
        guide = v3.select_guide(v3.load_guide_units(), product_title="알 수 없는 상품")
        self.assertEqual(guide["facts"], [])
        msgs = v3.build_messages(
            product_title="알 수 없는 상품", rating=5, option_text=None, review_text="좋아요",
            guide=guide, examples=[],
        )
        self.assertIn("공식 가이드 항목이 없습니다", msgs[1]["content"])
        self.assertIn("(비슷한 사람 답글 사례 없음)", msgs[1]["content"])
        self.assertNotIn("재구매 환영", msgs[0]["content"] + msgs[1]["content"])

    def test_missing_guide_file_raises_explicit_error(self) -> None:
        with self.assertRaises(v3.GenerationV3Error) as cm:
            v3.load_guide_units(v3.GUIDE_PATH.with_name("missing_guide.json"))
        self.assertEqual(cm.exception.code, "guide_source_missing")

    def _result(self, kid: str, authorship: str, *, violations: list[str] | None = None) -> dict:
        return {
            "knowledge_id": kid,
            "authorship": authorship,
            "past_review_text": f"리뷰 {kid}",
            "past_reply_text": f"답글 {kid}",
            "policy_violations": violations or [],
        }

    def test_examples_prefer_confirmed_human_and_exclude_ai_and_unknown(self) -> None:
        fake = {
            "results": [
                self._result("ai", AUTHORSHIP_AI_CONFIRMED),
                self._result("likely-ai", AUTHORSHIP_LIKELY_AI),
                self._result("unknown", AUTHORSHIP_UNKNOWN),
                self._result("lh1", AUTHORSHIP_LIKELY_HUMAN),
                self._result("hc1", AUTHORSHIP_HUMAN_CONFIRMED),
                self._result("lh-bad", AUTHORSHIP_LIKELY_HUMAN, violations=[v3.RULE_PURCHASE_PRESSURE_CLOSING]),
                self._result("lh2", AUTHORSHIP_LIKELY_HUMAN),
                self._result("lh3", AUTHORSHIP_LIKELY_HUMAN),
            ],
            "query_analysis": {"product_group": "henna"},
        }
        with patch.object(v3, "retrieve", return_value=fake) as mock_retrieve:
            picked, meta = v3.select_human_examples([], review_key="rk", review_text="좋아요", product_title="헤나", rating=5)
        self.assertEqual([p["knowledge_id"] for p in picked], ["hc1", "lh1", "lh2"])
        self.assertEqual(meta["picked"], 3)
        self.assertFalse(mock_retrieve.call_args.kwargs["include_ai_reference"])
        self.assertEqual(mock_retrieve.call_args.kwargs["exclude_review_keys"], {"rk"})
        msgs = v3.build_messages(
            product_title="헤나", rating=5, option_text=None, review_text="좋아요",
            guide={"facts": [], "rules": []}, examples=picked,
        )
        self.assertIn("(사람 작성 확인)", msgs[1]["content"])
        self.assertIn("(사람 작성 추정, 말투·응대 참고용)", msgs[1]["content"])
        self.assertNotIn("리뷰 ai", msgs[1]["content"])

    def test_tone_preset_carries_strength_without_repurchase_push(self) -> None:
        text = v3.render_tone_preset({"level": 6, "name": "사용자정의", "controls": {"closing_strength": 5, "gratitude_intensity": 4}})
        self.assertIn("6단계", text)
        self.assertIn("마무리 5/5", text)
        self.assertIn("재구매 권유는 넣지 않는다", text)
        self.assertEqual(v3.render_tone_preset(None), "")


class _DbTestBase(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            db.query(AnalyticsJobRun).delete(synchronize_session=False)
            db.query(ReviewReplyFeedbackKnowledge).delete(synchronize_session=False)
            db.query(NaverReviewReplyRaw).delete(synchronize_session=False)
            db.query(ReviewReplyDraft).delete(synchronize_session=False)
            db.query(NaverReviewRaw).delete(synchronize_session=False)
            db.query(CollectionTaskConfig).filter(
                CollectionTaskConfig.task_id.in_(["reviews_collect", "review_reply_daily_draft"])
            ).delete(synchronize_session=False)
            db.commit()

    def _review(
        self,
        key: str,
        *,
        days_ago: int = 1,
        rating: float = 5.0,
        text: str = "향이 은은하고 좋아요.",
        reply_exists_flag: bool = False,
        reply_collect_status: str | None = None,
        reply_text: str | None = None,
    ) -> str:
        review_key = f"naver_review:{key}"
        with SessionLocal() as db:
            db.add(
                NaverReviewRaw(
                    review_key=review_key,
                    product_url="https://smartstore.naver.com/testmall/products/9001",
                    review_id_original=key,
                    review_written_at=main._today_kst() - timedelta(days=days_ago),
                    rating=rating,
                    review_text=text,
                    text_hash=f"hash-{key}",
                    reply_exists_flag=reply_exists_flag,
                    reply_collect_status=reply_collect_status,
                )
            )
            if reply_text:
                db.add(NaverReviewReplyRaw(review_key=review_key, reply_text=reply_text, reply_written_at=main._today_kst()))
            db.commit()
        return review_key

    def _draft(
        self,
        draft_id: str,
        review_key: str,
        *,
        status: str = "approved",
        prompt_version: str = v3.PROMPT_VERSION,
        generated_days_ago: float = 0.1,
        text: str = "안녕하세요 고객님, 은은한 향을 좋게 봐주셔서 감사합니다.",
        published: bool = False,
    ) -> None:
        with SessionLocal() as db:
            db.add(
                ReviewReplyDraft(
                    draft_id=draft_id,
                    review_key=review_key,
                    status=status,
                    draft_text=text,
                    model_name="gpt-test",
                    prompt_version=prompt_version,
                    generated_at=datetime.now(timezone.utc) - timedelta(days=generated_days_ago),
                    published_at=datetime.now(timezone.utc) if published else None,
                )
            )
            db.commit()

    def _ready_patches(self):
        return (
            patch("main._check_review_reply_commerce_api_ready", return_value={"ready": True, "reason": None}),
            patch("main._check_review_reply_bulk_browser_ready", return_value={"ready": True, "reason": None}),
            patch("main._check_review_reply_browser_ready", return_value={"ready": True, "reason": None}),
        )


class BulkSubmitGateDbTest(_DbTestBase):
    def _scan(self) -> dict:
        p1, p2, p3 = self._ready_patches()
        with SessionLocal() as db, p1, p2, p3:
            return main._scan_review_reply_bulk_submit_targets(db)

    def test_legacy_approved_drafts_produce_zero_bulk_targets(self) -> None:
        for i in range(25):
            key = self._review(f"legacy-{i}", days_ago=40 + i)
            self._draft(f"legacy-draft-{i}", key, prompt_version="review_reply_v2" if i % 2 else "review_reply_v1", generated_days_ago=30)
        snapshot = self._scan()
        self.assertEqual(snapshot["eligible_count"], 0)
        self.assertEqual(snapshot["policy_excluded_count"], 25)
        self.assertIn("자동 게시 기준", snapshot["detail"])

    def test_bulk_scan_keeps_only_policy_targets(self) -> None:
        ok_key = self._review("ok")
        self._draft("d-ok", ok_key)
        self._draft("d-low", self._review("low", rating=3.0))
        self._draft("d-sensitive", self._review("sens", text="두피가 따갑고 가려워요."))
        self._draft("d-v2", self._review("v2"), prompt_version="review_reply_v2")
        self._draft("d-old", self._review("old", days_ago=45))
        self._draft("d-replied", self._review("replied", reply_exists_flag=True, reply_collect_status="pending"))
        self._draft("d-generated", self._review("gen"), status="generated")
        self._draft("d-published", self._review("pub"), published=True)
        snapshot = self._scan()
        ids = [row.draft_id for row in snapshot["eligible_draft_rows"]]
        self.assertEqual(ids, ["d-ok"])
        self.assertEqual(snapshot["blocker_counts"].get("sensitive_review"), 1)
        self.assertEqual(snapshot["blocker_counts"].get("review_already_replied"), 1)

    def test_admin_single_path_still_allows_low_rating_legacy_draft(self) -> None:
        key = self._review("admin-2star", rating=2.0, text="생각보다 별로였어요.", days_ago=60)
        self._draft("d-admin", key, prompt_version="review_reply_v1", generated_days_ago=60)
        p1, p2, p3 = self._ready_patches()
        with SessionLocal() as db, p1, p2, p3:
            ctx = main._build_review_reply_submit_context(db, draft_id="d-admin")
            gate = main._review_reply_auto_post_gate(
                draft_row=ctx["draft_row"],
                rating=ctx["review_row"].rating,
                review_text=ctx["review_row"].review_text,
                review_written_at=ctx["review_row"].review_written_at,
                reply_exists=False,
            )
        self.assertTrue(bool(ctx["can_submit"]))
        self.assertFalse(gate["eligible"])
        self.assertEqual(gate["route"], v3.ROUTE_ADMIN_DIRECT)

    def test_published_draft_cannot_be_submitted_again(self) -> None:
        key = self._review("dup")
        self._draft("d-dup", key, published=True)
        p1, p2, p3 = self._ready_patches()
        with SessionLocal() as db, p1, p2, p3:
            ctx = main._build_review_reply_submit_context(db, draft_id="d-dup")
        self.assertFalse(bool(ctx["can_submit"]))
        self.assertIn("draft_already_published", ctx["blockers"])

    def test_bulk_stage_submit_skips_ineligible_drafts(self) -> None:
        self._draft("d-stage-ok", self._review("stage-ok"))
        self._draft("d-stage-low", self._review("stage-low", rating=1.0, text="별로예요"))
        submitted: list[str] = []

        def fake_submit(db, *, draft_row, review_row):
            submitted.append(draft_row.draft_id)
            return main.ReviewReplyDraftSubmitResponse.model_construct(ok=True)

        p1, p2, p3 = self._ready_patches()
        run_date = main._today_kst()
        with p1, p2, p3, patch("main._submit_review_reply_and_sync", side_effect=fake_submit), patch(
            "main._save_review_reply_bulk_stage_job_state", return_value=None
        ), patch("main._is_review_reply_bulk_stage_cancel_requested", return_value=False):
            main._run_review_reply_bulk_stage_job(
                job_id="stage-test",
                run_date=run_date,
                stage="submit",
                filtered_total=2,
                target_ids=["d-stage-ok", "d-stage-low"],
                product_url=None,
                model=None,
                style_level=3,
                style_controls=None,
                max_pages=1,
            )
        self.assertEqual(submitted, ["d-stage-ok"])


class FakeSubmitPage:
    def __init__(self, probe_result=None, raise_on_probe: bool = False):
        self.probe_result = probe_result
        self.raise_on_probe = raise_on_probe
        self.eval_scripts: list[str] = []

    def bring_to_front(self):
        return None

    def wait_for_timeout(self, _ms):
        return None

    def evaluate(self, script, _payload=None):
        self.eval_scripts.append(script)
        if script == v3.SELLER_CENTER_SEARCH_JS:
            if self.raise_on_probe:
                raise RuntimeError("probe failed")
            return self.probe_result
        raise AssertionError("submit flow must not reach the reply editor")


class SellerCenterPrecheckTest(_DbTestBase):
    def _submit(self, page: FakeSubmitPage, key_suffix: str = "0"):
        key = self._review(f"precheck-{key_suffix}")
        with SessionLocal() as db:
            review_row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == key).one()
        with patch("main._playwright_enabled", return_value=True), patch("main._use_host_chrome", return_value=True), patch(
            "main._pw_in_worker_thread", return_value=True
        ), patch("main._ensure_pw_context", return_value=object()), patch("main._pw_runtime_mode", return_value="host_cdp"), patch(
            "main._require_existing_seller_review_page", return_value=page
        ), patch("main._ensure_smartstore_review_management_page", return_value=None), patch(
            "main._open_seller_center_review_detail_modal", return_value=True
        ) as modal:
            try:
                return main._submit_review_reply_via_browser(review_row, "초안 본문"), modal
            except HTTPException as exc:
                return exc, modal

    def test_existing_seller_center_reply_returns_sync_without_posting(self) -> None:
        with patch("main._collect_smartstore_admin_reply_candidates_resilient", return_value=([], set())):
            result, modal = self._submit(FakeSubmitPage({"ok": True, "found": True, "has_comment": True, "pages": 1}))
        self.assertIsInstance(result, dict)
        self.assertTrue(result["already_replied"])
        modal.assert_not_called()

    def test_unknown_seller_center_state_blocks_posting(self) -> None:
        for idx, page in enumerate((
            FakeSubmitPage({"ok": False, "status": 401}),
            FakeSubmitPage({"ok": True, "found": False, "truncated": True}),
            FakeSubmitPage(raise_on_probe=True),
        )):
            result, modal = self._submit(page, key_suffix=str(idx))
            self.assertIsInstance(result, HTTPException)
            self.assertEqual(result.status_code, 409)
            self.assertIn("seller_center_reply_check_failed", str(result.detail))
            modal.assert_not_called()
            self.assertIsNone(main._classify_review_reply_terminal_failure(result))


class GenerationV3EndpointTest(_DbTestBase):
    class _FakeResp:
        status_code = 200

        def __init__(self, content: str):
            self._content = content

        def json(self):
            return {"choices": [{"message": {"role": "assistant", "content": self._content}}], "model": "gpt-test"}

        @property
        def text(self):
            return "{}"

    def test_guide_failure_saves_failed_v3_draft_without_v2_fallback(self) -> None:
        key = self._review("guide-fail")
        with patch("main._get_api_setting", return_value="sk-test"), patch(
            "main.review_reply_v3.load_guide_units", side_effect=v3.GenerationV3Error("guide_source_missing")
        ), patch("main.requests.post") as mock_post, patch("main._post_openai_chat_completion_compatible") as mock_chat:
            resp = self.client.post("/reviews/reply-drafts/generate", json={"review_key": key})
        self.assertEqual(resp.status_code, 502, msg=resp.text)
        self.assertIn("guide_source_missing", resp.text)
        mock_post.assert_not_called()
        mock_chat.assert_not_called()
        with SessionLocal() as db:
            row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.review_key == key).one()
        self.assertEqual(row.status, "failed")
        self.assertEqual(row.prompt_version, v3.PROMPT_VERSION)
        self.assertIn("v2 프롬프트로 대체하지 않았습니다", row.error_message)

    def test_misread_draft_is_saved_with_hold_qa_and_never_auto_posted(self) -> None:
        key = self._review("orange", rating=4.0, text="색이 너무 오렌지색이에요.")
        captured: list[dict] = []

        def fake_post(*args, **kwargs):
            captured.append(kwargs.get("json") or {})
            return self._FakeResp("안녕하세요 고객님, 색상이 마음에 드셨다니 기쁩니다.")

        with patch("main._get_api_setting", return_value="sk-test"), patch("main.requests.post", side_effect=fake_post):
            resp = self.client.post("/reviews/reply-drafts/generate", json={"review_key": key})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        self.assertEqual(resp.json()["prompt_version"], v3.PROMPT_VERSION)
        joined = "\n".join(str(m.get("content") or "") for m in captured[0].get("messages") or [])
        self.assertIn("[공식 사용가이드]", joined)
        self.assertIn("너무 오렌지색이다", joined)
        with SessionLocal() as db:
            row = db.query(ReviewReplyDraft).filter(ReviewReplyDraft.review_key == key).one()
            self.assertEqual(row.status, "generated")
            self.assertIn("review_reply_v3_qa=HOLD", row.error_message)
            self.assertIn("SENTIMENT_MISREAD", row.error_message)
            row.status = "approved"
            db.commit()
        snapshot = BulkSubmitGateDbTest._scan(self)  # type: ignore[arg-type]
        self.assertEqual(snapshot["eligible_count"], 0)
        self.assertEqual(snapshot["blocker_counts"].get("quality_check_failed"), 1)


class DailyDraftTaskTest(_DbTestBase):
    def test_registry_entry_is_schedule_off_by_default(self) -> None:
        meta = main.COLLECTION_TASK_REGISTRY["review_reply_daily_draft"]
        self.assertEqual(meta["default_schedule_time"], "06:40")
        self.assertFalse(meta["default_schedule_enabled"])
        self.assertEqual(meta["target_tables"], [])
        with SessionLocal() as db:
            cfg = main._collection_task_config(db, "review_reply_daily_draft")
            self.assertFalse(bool(cfg.schedule_enabled))

    def test_targets_only_unreplied_recent_reviews_without_drafts(self) -> None:
        target = self._review("t-new", days_ago=0, rating=2.0, text="별로예요")
        self._review("t-old", days_ago=5)
        self._review("t-flag", reply_exists_flag=True, reply_collect_status="pending")
        self._review("t-text", reply_text=HUMAN_STYLE_REPLY)
        self._review("t-deleted", reply_collect_status="seller_deleted")
        self._draft("t-gen-d", self._review("t-gen"), status="generated")
        self._draft("t-pub-d", self._review("t-pub"), published=True)
        self._draft("t-rej-d", self._review("t-rej"), status="rejected")
        retry = self._review("t-failed")
        self._draft("t-failed-d", retry, status="failed", text="")
        calls: list[str] = []

        def fake_generate(db, *, review_row, **kwargs):
            calls.append(review_row.review_key)
            return main.ReviewReplyDraftResponse.model_construct(generated_now=True)

        with patch("main._generate_review_reply_draft_for_row", side_effect=fake_generate):
            result = main._run_review_reply_daily_draft(run_mode="schedule")
        self.assertEqual(sorted(calls), sorted([target, retry]))
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(result["rows_written"], 2)
        self.assertEqual(result["skipped_existing_draft"], 3)
        self.assertEqual(result["auto_post"], "OFF")

    def test_second_run_does_not_duplicate(self) -> None:
        key = self._review("t-once", days_ago=0)

        def fake_generate(db, *, review_row, **kwargs):
            db.add(
                ReviewReplyDraft(
                    draft_id=f"auto-{review_row.review_key}",
                    review_key=review_row.review_key,
                    status="generated",
                    draft_text="안녕하세요 고객님, 감사합니다.",
                    model_name="gpt-test",
                    prompt_version=v3.PROMPT_VERSION,
                )
            )
            db.commit()
            return main.ReviewReplyDraftResponse.model_construct(generated_now=True)

        with patch("main._generate_review_reply_draft_for_row", side_effect=fake_generate) as gen:
            first = main._run_review_reply_daily_draft(run_mode="schedule")
            second = main._run_review_reply_daily_draft(run_mode="schedule")
        self.assertEqual(gen.call_count, 1)
        self.assertEqual(first["rows_written"], 1)
        self.assertEqual(second["status"], "SKIPPED")
        self.assertEqual(second["skipped_existing_draft"], 1)
        self.assertTrue(key)

    def test_failures_are_recorded_not_hidden(self) -> None:
        self._review("t-fail-1", days_ago=0)
        self._review("t-fail-2", days_ago=0)

        def fail_generate(db, *, review_row, **kwargs):
            raise HTTPException(status_code=502, detail="review_reply_v3 생성 준비 실패(guide_source_missing)")

        with patch("main._generate_review_reply_draft_for_row", side_effect=fail_generate):
            result = main._run_review_reply_daily_draft(run_mode="schedule")
        self.assertEqual(result["status"], "FAILED")
        self.assertFalse(result["ok"])
        self.assertEqual(result["failed"], 2)
        self.assertTrue(result["errors"])
        self.assertEqual(main._collection_result_status(result), "FAILED")

    def test_run_all_and_empty_window_are_skipped(self) -> None:
        self._review("t-runall", days_ago=0)
        with patch("main._generate_review_reply_draft_for_row") as gen:
            run_all = main._collection_execute_task(
                "review_reply_daily_draft", main.CollectionRunPayload(), run_mode="run_all_manual"
            )
            gen.assert_not_called()
        self.assertEqual(run_all["status"], "SKIPPED")
        with SessionLocal() as db:
            db.query(NaverReviewRaw).delete(synchronize_session=False)
            db.commit()
        empty = main._run_review_reply_daily_draft(run_mode="schedule")
        self.assertEqual(empty["status"], "SKIPPED")
        self.assertEqual(empty["rows_written"], 0)


class ReplySyncWindowTest(_DbTestBase):
    def test_window_days_are_clamped(self) -> None:
        self.assertEqual(main._review_reply_sync_window_days({"reply_sync_window_days": 30}), 30)
        self.assertEqual(main._review_reply_sync_window_days({"reply_sync_window_days": 999}), 60)
        self.assertEqual(main._review_reply_sync_window_days({"reply_sync_window_days": "x"}), 0)
        self.assertEqual(main._review_reply_sync_window_days({}), 0)
        self.assertEqual(main._review_reply_sync_window_days(None), 0)

    def _run_reviews_collect(self) -> dict:
        today = main._today_kst()
        captured: list = []

        def fake_create(job):
            captured.append(job)
            return {"job_id": "fake"}

        with patch("main.create_page_metrics_collector_job", side_effect=fake_create):
            result = main._collection_execute_task(
                "reviews_collect", main.CollectionRunPayload(date_from=today, date_to=today), run_mode="manual"
            )
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].date_from, result["date_from"])
        return result

    def test_default_keeps_existing_range(self) -> None:
        result = self._run_reviews_collect()
        self.assertEqual(result["date_from"], main._today_kst().isoformat())

    def test_configured_window_extends_excel_range(self) -> None:
        with SessionLocal() as db:
            cfg = main._collection_task_config(db, "reviews_collect")
            cfg.config_json = json.dumps({"reply_sync_window_days": 30})
            db.commit()
        result = self._run_reviews_collect()
        self.assertEqual(result["date_from"], (main._today_kst() - timedelta(days=29)).isoformat())
        self.assertEqual(result["date_to"], main._today_kst().isoformat())

    def _upsert(self, **item) -> None:
        base = {
            "review_id_original": "sync-1",
            "review_written_at": (main._today_kst() - timedelta(days=20)).isoformat(),
            "rating": 5,
            "review_text": "향이 좋아요 오래 쓰고 있어요",
            "import_source": "smartstore_review_excel",
        }
        base.update(item)
        with SessionLocal() as db:
            main._upsert_review_raw_items(db, product_url="https://smartstore.naver.com/testmall/products/9001", items=[base])
            db.commit()

    def _row(self) -> tuple[NaverReviewRaw, NaverReviewReplyRaw | None]:
        with SessionLocal() as db:
            row = db.query(NaverReviewRaw).filter(NaverReviewRaw.review_id_original == "sync-1").one()
            reply = db.query(NaverReviewReplyRaw).filter(NaverReviewReplyRaw.review_key == row.review_key).one_or_none()
            db.expunge_all()
            return row, reply

    def test_resync_never_erases_confirmed_reply(self) -> None:
        self._upsert(reply_exists_flag=True, reply_text=HUMAN_STYLE_REPLY)
        row, reply = self._row()
        self.assertTrue(row.reply_exists_flag)
        self.assertIsNotNone(reply)
        self._upsert(reply_exists_flag=False)
        row, reply = self._row()
        self.assertTrue(row.reply_exists_flag)
        self.assertEqual(row.reply_collect_status, "collected")
        self.assertEqual(reply.reply_text, HUMAN_STYLE_REPLY)

    def test_resync_preserves_terminal_and_manual_status(self) -> None:
        self._upsert(reply_exists_flag=False)
        row, _ = self._row()
        with SessionLocal() as db:
            db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == row.review_key).update(
                {"reply_collect_status": "seller_deleted"}, synchronize_session=False
            )
            db.commit()
        self._upsert(reply_exists_flag=False)
        self.assertEqual(self._row()[0].reply_collect_status, "seller_deleted")
        with SessionLocal() as db:
            db.query(NaverReviewRaw).filter(NaverReviewRaw.review_key == row.review_key).update(
                {"reply_collect_status": "manual_completed"}, synchronize_session=False
            )
            db.commit()
        self._upsert(reply_exists_flag=False)
        row2, _ = self._row()
        self.assertEqual(row2.reply_collect_status, "manual_completed")
        self.assertTrue(row2.reply_exists_flag)

    def test_resync_adds_new_reply_signal(self) -> None:
        self._upsert(reply_exists_flag=False)
        self.assertFalse(self._row()[0].reply_exists_flag)
        self._upsert(reply_exists_flag=True)
        row, _ = self._row()
        self.assertTrue(row.reply_exists_flag)
        self.assertEqual(row.reply_collect_status, "pending")


if __name__ == "__main__":
    unittest.main()
