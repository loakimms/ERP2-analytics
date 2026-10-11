import json
import os
import unittest
from datetime import date, datetime
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import review_reply_knowledge_api
from db import (
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyBodyAudit,
    ReviewReplyDraft,
    ReviewReplyDraftRevision,
    ReviewReplyKnowledgeValidation,
    SessionLocal,
    init_db,
)
from review_reply_integrity import (
    INVALID_REPLY_COLLECT_STATUS,
    REPLY_BODY_CHAR_COUNTER,
    REPLY_BODY_EMPTY,
    REPLY_BODY_NUMERIC_COUNTER,
    REPLY_BODY_SELLER_CENTER_UI,
    REPLY_BODY_VALID,
    classify_recovery_eligibility,
    classify_reply_body,
    decide_recovery_outcome,
)
from review_reply_knowledge import (
    AUTH_APPROVED_HISTORICAL_REFERENCE,
    AUTH_EXTRACTED_KNOWLEDGE,
    AUTH_REVALIDATION_REQUIRED,
    AUTH_VALIDATED_KNOWLEDGE,
    AUTH_VALIDATION_EXCLUDED,
    AUTH_VALIDATION_HOLD,
    AUTH_VALIDATION_OUTDATED,
    AUTH_VALIDATION_STALE_REPLY_CHANGED,
    USE_AUTHORITY_STATES,
    AUTHORSHIP_AI_CONFIRMED,
    AUTHORSHIP_INVALID,
    AUTHORSHIP_LIKELY_HUMAN,
    AUTHORSHIP_UNKNOWN,
    RETRIEVAL_STATUS,
    TIER_AI_ORIGIN_REFERENCE,
    TIER_EXCLUDED_INVALID,
    TIER_MANUAL_VERIFICATION_CANDIDATE,
    TIER_PROVISIONAL_HUMAN_REFERENCE,
    build_corpus,
    build_verification_queue,
    extract_knowhow_items,
    provenance_complete,
    reply_sha256,
    retrieve,
)
from review_reply_knowledge_extraction import (
    EXTRACTION_VERSION,
    TYPE_NUMERIC,
    TYPE_PROCEDURE,
    TYPE_QUESTION,
    UNIT_REPLY_APPROVED_NOT_INDIVIDUALLY_VERIFIED,
    UNIT_REVALIDATION_REQUIRED,
    compare_extractions,
    extract_units,
)
from review_reply_policy_qa import (
    RULE_AI_SIGNATURE_PHRASE,
    RULE_PURCHASE_PRESSURE_CLOSING,
    RULE_REPURCHASE_OVEREMPHASIS,
    check_reply_policy,
    count_ai_signature_variants,
)

UI_TEXT = (
    "0 / 1000 (최소 5자) 리뷰 신고 답글 등록 2/5 이전 리뷰 다음 리뷰 리뷰 정보 리뷰 도움수 0 "
    "베스트리뷰여부 N 리뷰전시여부 Y 리뷰타입 한달사용리뷰 재구매 여부 툴팁 N 구독유형 -"
)


class ReplyBodyClassificationTest(unittest.TestCase):
    def test_rejects_counter_ui_and_empty_values(self) -> None:
        self.assertEqual(classify_reply_body("500"), REPLY_BODY_NUMERIC_COUNTER)
        self.assertEqual(classify_reply_body(" 1,000 "), REPLY_BODY_NUMERIC_COUNTER)
        self.assertEqual(classify_reply_body("0 / 1000"), REPLY_BODY_NUMERIC_COUNTER)
        self.assertEqual(classify_reply_body("0 / 1000 답글 등록"), REPLY_BODY_CHAR_COUNTER)
        self.assertEqual(classify_reply_body(UI_TEXT), REPLY_BODY_SELLER_CENTER_UI)
        self.assertEqual(classify_reply_body("답글 등록 등록하기"), REPLY_BODY_SELLER_CENTER_UI)
        self.assertEqual(classify_reply_body(""), REPLY_BODY_EMPTY)
        self.assertEqual(classify_reply_body("   "), REPLY_BODY_EMPTY)

    def test_accepts_real_short_and_contextual_replies(self) -> None:
        for text in (
            "즐거운 하루 되세요~",
            "감사합니다. 고객님~",
            "감사합니다",
            "답글 등록이 늦어 죄송합니다. 헤나는 2시간 정도 방치해 주세요.",
            "고객님~~ 8:2 비율로 섞어 주시면 됩니다.",
            "재구매 감사합니다! 500ml 대용량도 준비되어 있어요.",
        ):
            self.assertEqual(classify_reply_body(text), REPLY_BODY_VALID, msg=text)

    def test_recovery_eligibility_and_outcomes_do_not_assume_recovery(self) -> None:
        self.assertEqual(
            classify_recovery_eligibility(
                stored_reply_text="500", review_id_original="123", excel_reply_flag="Y", excel_reply_written_at="2026.09.01"
            )["eligibility"],
            "RECOLLECT_CANDIDATE_REMOTE_REPLY_EXPECTED",
        )
        self.assertEqual(
            classify_recovery_eligibility(
                stored_reply_text=UI_TEXT, review_id_original="123", excel_reply_flag="N", excel_reply_written_at=""
            )["eligibility"],
            "REVERIFY_REMOTE_REPLY_LIKELY_ABSENT",
        )
        self.assertEqual(
            classify_recovery_eligibility(
                stored_reply_text="500", review_id_original="", excel_reply_flag="Y", excel_reply_written_at="x"
            )["eligibility"],
            "UNRECOVERABLE_NO_REMOTE_ID",
        )
        base = {"target_review_id_original": "1", "remote_review_id_original": "1", "remote_reply_present": True}
        self.assertEqual(decide_recovery_outcome(**base, remote_check_ok=False, remote_reply_text="좋은 답글"), "REMOTE_CHECK_FAILED_RETRY")
        self.assertEqual(decide_recovery_outcome(**base, remote_check_ok=True, remote_reply_text="500"), "REMOTE_BODY_STILL_INVALID_HOLD")
        self.assertEqual(
            decide_recovery_outcome(
                target_review_id_original="1", remote_review_id_original="2", remote_reply_present=True,
                remote_check_ok=True, remote_reply_text="좋은 답글",
            ),
            "REMOTE_ID_MISMATCH_HOLD",
        )
        self.assertEqual(
            decide_recovery_outcome(**{**base, "remote_reply_present": False}, remote_check_ok=True, remote_reply_text=""),
            "REMOTE_REPLY_ABSENT",
        )
        self.assertEqual(decide_recovery_outcome(**base, remote_check_ok=True, remote_reply_text="감사합니다 고객님"), "RECOVERED_REMOTE_VERIFIED")


class _DbTestBase(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            for model in (
                ReviewReplyBodyAudit,
                ReviewReplyDraftRevision,
                ReviewReplyKnowledgeValidation,
                NaverReviewReplyRaw,
                ReviewReplyDraft,
                NaverReviewRaw,
            ):
                db.query(model).delete(synchronize_session=False)
            db.commit()
        review_reply_knowledge_api._CACHE.update({"key": None, "corpus": None})

    def _insert_review(self, review_key: str, review_id: str, *, flag: bool = True, status: str | None = "pending",
                       reply_text: str | None = None, review_text: str = "색이 잘 나와요", title: str = "헤나 염색약",
                       payload: dict | None = None, rating: float = 5.0) -> None:
        with SessionLocal() as db:
            db.add(
                NaverReviewRaw(
                    review_key=review_key,
                    product_url=f"https://smartstore.naver.com/t/products/{review_id}",
                    product_title=title,
                    review_id_original=review_id,
                    review_written_at=date(2026, 9, 1),
                    rating=rating,
                    review_text=review_text,
                    text_hash=review_id,
                    import_source="smartstore_review_upload",
                    reply_exists_flag=flag,
                    reply_collect_status=status,
                    raw_payload_json=json.dumps(payload or {}, ensure_ascii=False),
                )
            )
            if reply_text is not None:
                db.add(NaverReviewReplyRaw(review_key=review_key, reply_text=reply_text))
            db.commit()


class ReplyBackfillPersistenceTest(_DbTestBase):
    def _register_job(self, job_id: str) -> None:
        with main.PAGE_METRICS_COLLECTOR_JOB_LOCK:
            main.PAGE_METRICS_COLLECTOR_JOBS[job_id] = {
                "job_id": job_id,
                "mode": "review_reply_backfill_cdp",
                "status": "SCRAPING",
                "urls": ["https://sell.smartstore.naver.com/#/review/search?ids=111"],
                "params": {"total_targets": 1, "selected_targets": 1},
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            }

    def _result(self, items: list[dict]) -> dict:
        return {
            "results": [
                {
                    "url": "https://sell.smartstore.naver.com/#/review/search?ids=111",
                    "ok": True,
                    "metrics": {"items": items, "target_count": len(items), "row_count": 1, "matched_rows": 1, "opened_count": 1},
                }
            ]
        }

    def test_partial_then_final_submission_never_stores_counter_value(self) -> None:
        self._insert_review("naver_review:111", "111")
        self._register_job("job-500")
        payload = self._result([{"review_id_original": "111", "reply_text": "500", "reply_written_at": "2026.09.18"}])
        partial = self.client.post("/search-rank/page-metrics/local-collector/jobs/job-500/partial-results", json=payload)
        self.assertEqual(partial.status_code, 200, msg=partial.text)
        final = self.client.post("/search-rank/page-metrics/local-collector/jobs/job-500/results", json=payload)
        self.assertEqual(final.status_code, 200, msg=final.text)
        self.assertEqual(final.json()["collected"], 0)
        with SessionLocal() as db:
            self.assertIsNone(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:111").one_or_none())
            review = db.query(NaverReviewRaw).filter_by(review_key="naver_review:111").one()
            self.assertEqual(review.reply_collect_status, INVALID_REPLY_COLLECT_STATUS)
            audits = db.query(ReviewReplyBodyAudit).filter_by(review_key="naver_review:111").all()
            self.assertGreaterEqual(len(audits), 2)
            self.assertTrue(all(a.event == "rejected_incoming_invalid_body" for a in audits))
            self.assertTrue(all(a.body_verdict == REPLY_BODY_NUMERIC_COUNTER for a in audits))

    def test_final_submission_rejects_seller_center_ui_text(self) -> None:
        self._insert_review("naver_review:112", "112")
        self._register_job("job-ui")
        payload = self._result([{"review_id_original": "112", "reply_text": UI_TEXT}])
        final = self.client.post("/search-rank/page-metrics/local-collector/jobs/job-ui/results", json=payload)
        self.assertEqual(final.status_code, 200, msg=final.text)
        with SessionLocal() as db:
            self.assertIsNone(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:112").one_or_none())
            self.assertEqual(
                db.query(NaverReviewRaw).filter_by(review_key="naver_review:112").one().reply_collect_status,
                INVALID_REPLY_COLLECT_STATUS,
            )

    def test_host_agent_extraction_status_is_held_without_storing(self) -> None:
        self._insert_review("naver_review:113", "113")
        items = [{"review_id_original": "113", "reply_text": "", "extraction_status": "EMPTY_REPLY_EDITOR", "rejected_sample": "0 / 1000"}]
        summary = main._persist_review_reply_backfill_collector_results(
            SessionLocal(), [main.PageMetricsCollectorResultItem(**self._result(items)["results"][0])]
        )
        self.assertEqual(summary["collected"], 0)
        self.assertIn("reply_extraction_empty_reply_editor", summary["errors"])
        with SessionLocal() as db:
            self.assertEqual(
                db.query(NaverReviewRaw).filter_by(review_key="naver_review:113").one().reply_collect_status,
                INVALID_REPLY_COLLECT_STATUS,
            )

    def test_valid_remote_reply_replaces_contaminated_body_with_audit(self) -> None:
        self._insert_review("naver_review:114", "114", status="collected", reply_text="500")
        items = [{"review_id_original": "114", "reply_text": "고객님 감사합니다. 2시간 방치해 주세요.", "extraction_status": "VALID_REPLY"}]
        summary = main._persist_review_reply_backfill_collector_results(
            SessionLocal(), [main.PageMetricsCollectorResultItem(**self._result(items)["results"][0])]
        )
        self.assertEqual(summary["collected"], 1)
        with SessionLocal() as db:
            reply = db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:114").one()
            self.assertEqual(reply.reply_text, "고객님 감사합니다. 2시간 방치해 주세요.")
            audit = db.query(ReviewReplyBodyAudit).filter_by(review_key="naver_review:114").one()
            self.assertEqual(audit.event, "contaminated_body_replaced_by_remote_valid")
            self.assertEqual(audit.invalid_text, "500")

    def test_invalid_reply_does_not_overwrite_existing_valid_reply_or_status(self) -> None:
        self._insert_review("naver_review:115", "115", status="collected", reply_text="기존 정상 답글입니다")
        items = [{"review_id_original": "115", "reply_text": "500"}]
        main._persist_review_reply_backfill_collector_results(
            SessionLocal(), [main.PageMetricsCollectorResultItem(**self._result(items)["results"][0])]
        )
        with SessionLocal() as db:
            self.assertEqual(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:115").one().reply_text, "기존 정상 답글입니다")
            self.assertEqual(db.query(NaverReviewRaw).filter_by(review_key="naver_review:115").one().reply_collect_status, "collected")

    def test_held_and_existing_contaminated_rows_are_not_auto_retargeted(self) -> None:
        self._insert_review("naver_review:120", "120", status=INVALID_REPLY_COLLECT_STATUS)
        self._insert_review("naver_review:121", "121", status="collected", reply_text="500")
        self._insert_review("naver_review:122", "122", status="pending")
        with SessionLocal() as db:
            keys = [r.review_key for r in main._list_reply_backfill_target_rows(db, limit=50)]
        self.assertEqual(keys, ["naver_review:122"])


class DraftLineageTest(_DbTestBase):
    def test_original_ai_draft_survives_edit_approve_and_publish(self) -> None:
        self._insert_review("naver_review:200", "200", flag=False, status="not_needed")
        with SessionLocal() as db:
            row = main._save_review_reply_draft_row(
                db, review_key="naver_review:200", status="generated", draft_text="AI가 만든 원본 초안",
                model_name="gpt-test", prompt_version="review_reply_v2",
            )
            draft_id = row.draft_id
            self.assertEqual(row.original_ai_text, "AI가 만든 원본 초안")

        resp = self.client.post("/reviews/reply-drafts/update", json={"draft_id": draft_id, "draft_text": "사람이 다듬은 최종본"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        resp = self.client.post("/reviews/reply-drafts/update", json={"draft_id": draft_id, "draft_text": "사람이 두 번째로 다듬은 최종본"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        resp = self.client.post("/reviews/reply-drafts/status", json={"draft_id": draft_id, "status": "approved"})
        self.assertEqual(resp.status_code, 200, msg=resp.text)
        with SessionLocal() as db:
            draft = db.query(ReviewReplyDraft).filter_by(draft_id=draft_id).one()
            review = db.query(NaverReviewRaw).filter_by(review_key="naver_review:200").one()
            main._persist_review_reply_submission(
                db, draft_row=draft, review_row=review, reply_text=draft.draft_text,
                reply_written_at=date(2026, 10, 8), detail=None,
            )
        with SessionLocal() as db:
            draft = db.query(ReviewReplyDraft).filter_by(draft_id=draft_id).one()
            self.assertEqual(draft.original_ai_text, "AI가 만든 원본 초안")
            self.assertEqual(draft.draft_text, "사람이 두 번째로 다듬은 최종본")
            self.assertEqual(draft.human_edit_count, 2)
            self.assertEqual(draft.approved_text, "사람이 두 번째로 다듬은 최종본")
            self.assertEqual(draft.published_text, "사람이 두 번째로 다듬은 최종본")
        lineage = self.client.get(f"/reviews/reply-drafts/{draft_id}/lineage").json()
        self.assertEqual(lineage["stages"]["ORIGINAL_AI_DRAFT"], "AI가 만든 원본 초안")
        self.assertEqual(lineage["stages"]["HUMAN_EDITED_FINAL"], "사람이 두 번째로 다듬은 최종본")
        self.assertTrue(lineage["human_edited"])
        self.assertTrue(lineage["remote_matches_published"])
        stages = [r["stage"] for r in lineage["revisions"]]
        self.assertEqual(stages.count("HUMAN_EDITED_FINAL"), 2)
        self.assertEqual(stages[0], "ORIGINAL_AI_DRAFT")
        self.assertIn("APPROVED_REPLY", stages)
        self.assertIn("PUBLISHED_REPLY", stages)
        texts = [r["text"] for r in lineage["revisions"] if r["stage"] == "HUMAN_EDITED_FINAL"]
        self.assertEqual(texts, ["사람이 다듬은 최종본", "사람이 두 번째로 다듬은 최종본"])

    def test_legacy_draft_without_lineage_keeps_pre_edit_text_as_original(self) -> None:
        self._insert_review("naver_review:201", "201", flag=False, status="not_needed")
        with SessionLocal() as db:
            db.add(ReviewReplyDraft(draft_id="legacy-1", review_key="naver_review:201", status="generated",
                                    draft_text="레거시 AI 초안", model_name="gpt-test"))
            db.commit()
        self.client.post("/reviews/reply-drafts/update", json={"draft_id": "legacy-1", "draft_text": "수정본"})
        with SessionLocal() as db:
            draft = db.query(ReviewReplyDraft).filter_by(draft_id="legacy-1").one()
            self.assertEqual(draft.original_ai_text, "레거시 AI 초안")
            self.assertEqual(draft.lineage_origin, "LEGACY_PRE_LINEAGE")
            self.assertEqual(draft.draft_text, "수정본")


def _review(key: str, text: str, title: str = "헤나 염색약", rating: float = 5.0, payload: dict | None = None) -> dict:
    return {
        "review_key": key, "product_url": "", "product_title": title, "review_written_at": date(2026, 2, 1),
        "rating": rating, "review_text": text, "import_source": "smartstore_review_upload",
        "raw_payload_json": json.dumps(payload or {}, ensure_ascii=False),
    }


class KnowledgeCorpusTest(unittest.TestCase):
    def _corpus(self, validations: dict | None = None) -> dict:
        reviews = [
            _review("k-ai", "색이 예뻐요"),
            _review("k-human", "새치가 잘 가려져요 방치 시간이 궁금해요", payload={"답글등록일시": "2025.12.01"}),
            _review("k-unknown", "물 비율을 어떻게 맞추나요? 색이 연하게 나왔어요"),
            _review("k-bad", "좋아요"),
            _review("k-delivery", "배송이 빨라요", title="호호바 오일"),
        ]
        replies = {
            "k-ai": {"reply_text": "안녕하세요, 고객님. 소중한 리뷰 감사합니다. 재구매도 언제든 환영합니다.",
                     "raw_payload_json": json.dumps({"source": "smartstore_seller_center_submit", "draft_id": "d1"})},
            "k-human": {"reply_text": "고객님!! 헤나는 2시간 정도 방치해 주시면 새치 커버가 좋아요~~", "raw_payload_json": None},
            "k-unknown": {"reply_text": "물은 8:2 비율로 섞고 따뜻한 물 온도로 반죽해 주세요.", "raw_payload_json": None},
            "k-bad": {"reply_text": "500", "raw_payload_json": None},
            "k-delivery": {"reply_text": "빠른 배송으로 만족하셨다니 다행입니다", "raw_payload_json": None},
        }
        drafts = {"k-ai": [{"draft_id": "d1", "status": "approved", "draft_text": replies["k-ai"]["reply_text"],
                            "generated_at": datetime(2026, 4, 1)}]}
        return build_corpus(reviews=reviews, replies=replies, drafts_by_review=drafts, latest_validations=validations)

    def test_authorship_tiers_and_invalid_exclusion(self) -> None:
        items = {x["review_key"]: x for x in self._corpus()["items"]}
        self.assertEqual(items["k-ai"]["authorship"], AUTHORSHIP_AI_CONFIRMED)
        self.assertEqual(items["k-ai"]["tier"], TIER_AI_ORIGIN_REFERENCE)
        self.assertEqual(items["k-human"]["authorship"], AUTHORSHIP_LIKELY_HUMAN)
        self.assertEqual(items["k-human"]["tier"], TIER_PROVISIONAL_HUMAN_REFERENCE)
        self.assertEqual(items["k-unknown"]["authorship"], AUTHORSHIP_UNKNOWN)
        self.assertEqual(items["k-unknown"]["tier"], TIER_MANUAL_VERIFICATION_CANDIDATE)
        self.assertEqual(items["k-bad"]["authorship"], AUTHORSHIP_INVALID)
        self.assertEqual(items["k-bad"]["tier"], TIER_EXCLUDED_INVALID)
        facts = [f for k in items["k-unknown"]["knowhow_items"] for f in k["facts"]]
        self.assertIn("RATIO:8:2", facts)
        self.assertTrue(all(k["current_validity"] == "UNVERIFIED_REQUIRES_CURRENT_FACT_CHECK"
                            for k in items["k-unknown"]["knowhow_items"] if k["facts"]))

    def test_queue_excludes_ai_and_prioritizes_unknown_knowhow(self) -> None:
        items = self._corpus()["items"]
        queue = build_verification_queue(items, queue_filter="all_candidates")
        keys = [x["review_key"] for x in queue]
        self.assertNotIn("k-ai", keys)
        self.assertNotIn("k-bad", keys)
        self.assertEqual(keys[0], "k-unknown")
        unknown = build_verification_queue(items, queue_filter="unknown_knowhow")
        self.assertEqual([x["review_key"] for x in unknown], ["k-unknown"])

    def test_content_approval_never_changes_authorship_and_resets_on_text_change(self) -> None:
        human_text = "고객님!! 헤나는 2시간 정도 방치해 주시면 새치 커버가 좋아요~~"
        approved = {"rrk:k-human": {"content_validation": "APPROVED", "currently_valid": "yes",
                                    "reply_sha256_at_validation": reply_sha256(human_text)}}
        item = next(x for x in self._corpus(approved)["items"] if x["review_key"] == "k-human")
        self.assertEqual(item["content_validation"], "APPROVED")
        self.assertEqual(item["authorship"], AUTHORSHIP_LIKELY_HUMAN)
        self.assertEqual(item["knowhow_items"][0]["current_validity"], "REPLY_APPROVED_UNIT_FACT_UNVERIFIED")
        stale = {"rrk:k-human": {"content_validation": "APPROVED", "reply_sha256_at_validation": "other"}}
        item = next(x for x in self._corpus(stale)["items"] if x["review_key"] == "k-human")
        self.assertEqual(item["content_validation"], "PENDING")

    def test_retrieval_excludes_ai_reports_reasons_and_rejects_word_only_matches(self) -> None:
        items = self._corpus()["items"]
        out = retrieve(items, review_text="헤나 방치 시간을 얼마나 해야 새치가 가려지나요?", product_title="헤나 염색약")
        self.assertEqual(out["retrieval_status"], RETRIEVAL_STATUS)
        keys = [r["knowledge_id"] for r in out["results"]]
        self.assertEqual(keys[0], "rrk:k-human")
        self.assertNotIn("rrk:k-ai", keys)
        self.assertNotIn("rrk:k-bad", keys)
        top = out["results"][0]
        self.assertTrue(any(r.startswith("TOPIC_MATCH:") for r in top["retrieval_reasons"]))
        self.assertTrue(provenance_complete(top))
        word_only = retrieve(items, review_text="고객 응대 감사합니다", product_title="")
        self.assertEqual(word_only["results"], [])
        with_ai = retrieve(items, review_text="색이 예뻐요 발색 좋아요", product_title="헤나 염색약", include_ai_reference=True)
        self.assertIn("rrk:k-ai", [r["knowledge_id"] for r in with_ai["results"]])


SCREENSHOT_REPLY = (
    "평소에 린스, 트리트먼트 사용은 하시는 편인지 참 모르겠습니다. 만약에 이 경우시라면 위 제품을 사용을 중단하시고 염색을 지속해주시면 "
    "그때부터 염색이 더 잘되실 거 같습니다. 혹은 이경우가 아니시라면 진한 갈색 염색법으로 변경하셔는 것도 좋으실 거 같습니다. "
    "레드 2시간~길게는 3시간까지 그 후에 브라운 2시간~길게는 3시간까지 해주시는 방법이 고객님 모발에 맞는 방법이실 수 있습니다. 감사합니다.^^"
)


class KnowledgeSemanticExtractionTest(unittest.TestCase):
    def _units(self, text: str) -> list[dict]:
        units = extract_units(text, source_id="rrk:t")
        for u in units:
            s, e = u["sourceTextSpan"]
            self.assertEqual(text[s:e], u["originalText"])
            self.assertEqual(u["extractionVersion"], EXTRACTION_VERSION)
        return units

    def test_range_sequence_and_condition_stay_in_one_unit(self) -> None:
        units = [u for u in self._units(SCREENSHOT_REPLY) if u["knowledgeType"] != TYPE_QUESTION]
        self.assertEqual(len(units), 1)
        unit = units[0]
        self.assertEqual(unit["knowledgeType"], TYPE_PROCEDURE)
        self.assertEqual([s["text"] for s in unit["sequence"]], ["레드 2시간~길게는 3시간", "브라운 2시간~길게는 3시간"])
        self.assertEqual([s["product"] for s in unit["sequence"]], ["레드 헤나", "브라운 헤나"])
        self.assertTrue(unit["condition"].startswith("혹은 이경우가 아니시라면"))
        self.assertEqual(unit["conditionReference"], "UNRESOLVED_REFERENCE")
        self.assertIn("만약에 이 경우시라면", unit["contextBefore"])
        self.assertTrue(all(r["min"] == 2.0 and r["max"] == 3.0 and r["isRange"] for r in unit["numericRange"]))

    def test_tilde_range_is_not_split(self) -> None:
        units = self._units("고객님~~ 염색시간은 레드와 브라운 각각 2시간~ 3시간 권장드립니다. 감사합니다^^")
        self.assertEqual([u["originalText"] for u in units], ["염색시간은 레드와 브라운 각각 2시간~ 3시간 권장드립니다."])
        self.assertEqual(units[0]["numericRange"][0]["text"], "2시간~ 3시간")

    def test_question_is_not_knowledge(self) -> None:
        units = self._units("💦 패치테스트 하셨을 때는 어떠셨나 모르겠습니다.~~ 헤나는 2시간 정도 방치해 주세요.")
        self.assertEqual(units[0]["knowledgeType"], TYPE_QUESTION)
        self.assertFalse(units[0]["isKnowledgeCandidate"])
        self.assertEqual(units[0]["condition"], "UNKNOWN")
        self.assertEqual(units[1]["knowledgeType"], TYPE_NUMERIC)

    def test_inline_conditions_and_parenthesized_product(self) -> None:
        text = ('"진한갈색"으로 염색되시길 원하신다면 ★레드(+암라) 2시간 후에 다음날 브라운(+암라) 2시간 염색하시면 되고 '
                "자연스러운 갈색을 원하신다면 ★레드 2 : 브라운 8 비율로 염색하시면 됩니다.")
        unit = self._units(text)[0]
        self.assertIn("자연스러운 갈색을 원하신다면", unit["condition"])
        self.assertEqual([s["product"] for s in unit["sequence"]], ["레드 헤나", "브라운 헤나"])
        self.assertIn("RATIO:레드 2 : 브라운 8", unit["facts"])

    def test_missing_values_are_unknown_and_unrelated_condition_not_attached(self) -> None:
        units = self._units("긴 모발의 경우 짧은 모발보다 조금 더 정성이 들어가긴 합니다. 헤나는 2시간 정도 방치해 주세요.")
        self.assertEqual(len(units), 1)
        self.assertEqual(units[0]["condition"], "UNKNOWN")
        self.assertEqual(units[0]["sequence"], [])

    def test_comparison_classifies_meaning_changes(self) -> None:
        legacy = extract_knowhow_items(SCREENSHOT_REPLY)
        change = compare_extractions(legacy, extract_units(SCREENSHOT_REPLY), SCREENSHOT_REPLY)
        self.assertTrue(change["meaningChanged"])
        for code in ("CONDITION_RESTORED", "SEQUENCE_RESTORED", "NUMERIC_RANGE_RESTORED"):
            self.assertIn(code, change["changes"])
        same = "헤나는 2시간 정도 방치해 주세요."
        self.assertEqual(compare_extractions(extract_knowhow_items(same), extract_units(same), same)["changes"], ["NO_CHANGE"])

    def test_approved_snapshot_meaning_change_flags_revalidation_without_cancelling(self) -> None:
        key = "k-split"
        text = "염색시간은 레드와 브라운 각각 2시간~ 3시간 권장드립니다."
        snapshot = [{"sentence": "염색시간은 레드와 브라운 각각 2시간~"}, {"sentence": "3시간 권장드립니다."}]
        validation = {f"rrk:{key}": {"content_validation": "APPROVED", "currently_valid": "yes",
                                    "reply_sha256_at_validation": reply_sha256(text), "knowhow_snapshot": snapshot}}
        corpus = build_corpus(
            reviews=[_review(key, "염색 시간이 궁금해요")],
            replies={key: {"reply_text": text, "raw_payload_json": None}},
            drafts_by_review={},
            latest_validations=validation,
        )
        item = corpus["items"][0]
        self.assertEqual(item["content_validation"], "APPROVED")
        self.assertTrue(item["revalidation_required"])
        self.assertEqual(item["extraction_change"]["comparedWith"], "VALIDATION_SNAPSHOT")
        self.assertEqual(item["previous_extraction"], snapshot)
        self.assertTrue(all(u["validationStatus"] == UNIT_REVALIDATION_REQUIRED for u in item["knowhow_items"]))
        self.assertEqual(corpus["summary"]["revalidation_required"], 1)
        queue = build_verification_queue(corpus["items"], queue_filter="revalidation_required")
        self.assertEqual([x["review_key"] for x in queue], [key])

        unchanged = {f"rrk:{key}": dict(validation[f"rrk:{key}"], knowhow_snapshot=extract_units(text))}
        item = build_corpus(reviews=[_review(key, "염색 시간이 궁금해요")], replies={key: {"reply_text": text, "raw_payload_json": None}},
                            drafts_by_review={}, latest_validations=unchanged)["items"][0]
        self.assertFalse(item["revalidation_required"])
        self.assertTrue(all(u["validationStatus"] == UNIT_REPLY_APPROVED_NOT_INDIVIDUALLY_VERIFIED for u in item["knowhow_items"]))


AUTH_REPLY = "고객님!! 헤나는 레드와 브라운 각각 2시간~ 3시간 방치해 주시면 새치 커버가 좋아요~~"
AUTH_SPLIT_SNAPSHOT = [{"sentence": "헤나는 레드와 브라운 각각 2시간~"}, {"sentence": "3시간 방치해 주시면 새치 커버가 좋아요~~"}]


class KnowledgeUseAuthorityTest(unittest.TestCase):
    key = "k-auth"

    def _item(self, validation: dict | None, reply_text: str = AUTH_REPLY) -> tuple[dict, dict]:
        corpus = build_corpus(
            reviews=[_review(self.key, "새치가 잘 가려져요 방치 시간이 궁금해요", payload={"답글등록일시": "2025.12.01"})],
            replies={self.key: {"reply_text": reply_text, "raw_payload_json": None}},
            drafts_by_review={},
            latest_validations={f"rrk:{self.key}": validation} if validation else None,
        )
        return corpus["items"][0], corpus

    def _validation(self, content: str = "APPROVED", snapshot: list | None = None, sha: str | None = None, valid: str = "yes") -> dict:
        return {
            "content_validation": content,
            "currently_valid": valid,
            "reply_sha256_at_validation": sha or reply_sha256(AUTH_REPLY),
            "knowhow_snapshot": snapshot if snapshot is not None else extract_units(AUTH_REPLY),
        }

    def test_approved_reply_is_reference_only_never_fact(self) -> None:
        item, corpus = self._item(self._validation())
        self.assertEqual(item["current_use_authority"], AUTH_APPROVED_HISTORICAL_REFERENCE)
        self.assertTrue(item["reply_reference_eligible"])
        self.assertTrue(item["approved_retrieval_boost"])
        self.assertFalse(item["generator_fact_eligible"])
        self.assertIn("NO_UNIT_FACT_VALIDATION_RECORD", item["fact_ineligible_reasons"])
        self.assertTrue(all(u["generatorFactEligible"] is False and u["useAuthority"] == "EXTRACTED_KNOWLEDGE" for u in item["knowhow_items"]))
        self.assertEqual(corpus["summary"]["reply_reference_eligible"], 1)
        self.assertEqual(corpus["summary"]["generator_fact_eligible"], 0)
        self.assertEqual(item["authorship"], AUTHORSHIP_LIKELY_HUMAN)

    def test_revalidation_blocks_boost_and_fact_and_is_lifted_after_reapproval(self) -> None:
        item, corpus = self._item(self._validation(snapshot=AUTH_SPLIT_SNAPSHOT))
        self.assertEqual(item["content_validation"], "APPROVED")
        self.assertEqual(item["current_use_authority"], AUTH_REVALIDATION_REQUIRED)
        self.assertFalse(item["reply_reference_eligible"])
        self.assertFalse(item["approved_retrieval_boost"])
        self.assertFalse(item["generator_fact_eligible"])
        self.assertIn("REVALIDATION_REQUIRED", item["fact_ineligible_reasons"])
        self.assertTrue(all(u["current_validity"] == "REVALIDATION_REQUIRED" for u in item["knowhow_items"]))
        self.assertEqual(corpus["summary"]["use_authority_counts"][AUTH_REVALIDATION_REQUIRED], 1)
        reapproved, _ = self._item(self._validation(snapshot=extract_units(AUTH_REPLY)))
        self.assertEqual(reapproved["current_use_authority"], AUTH_APPROVED_HISTORICAL_REFERENCE)
        self.assertFalse(reapproved["revalidation_required"])

    def test_retrieval_boost_only_for_reference_eligible_and_warning_returned(self) -> None:
        query = {"review_text": "헤나 방치 시간을 얼마나 해야 새치가 가려지나요?", "product_title": "헤나 염색약"}
        approved, _ = self._item(self._validation())
        blocked, _ = self._item(self._validation(snapshot=AUTH_SPLIT_SNAPSHOT))
        hold, _ = self._item(self._validation(content="HOLD"))
        a = retrieve([approved], **query)
        b = retrieve([blocked], **query)
        h = retrieve([hold], **query)
        self.assertIn("generator_fact_eligible=true", a["use_contract"])
        ra, rb, rh = a["results"][0], b["results"][0], h["results"][0]
        self.assertIn(AUTH_APPROVED_HISTORICAL_REFERENCE, ra["retrieval_reasons"])
        self.assertIn("REVALIDATION_REQUIRED_NO_APPROVAL_BOOST", rb["retrieval_reasons"])
        self.assertAlmostEqual(ra["score"] - rb["score"], 1.5)
        self.assertNotIn(AUTH_APPROVED_HISTORICAL_REFERENCE, rh["retrieval_reasons"])
        self.assertIn("재검증 필요", rb["use_warning"])
        for r in (ra, rb, rh):
            self.assertFalse(r["generator_fact_eligible"])
            self.assertTrue(provenance_complete(r))

    def test_hash_mismatch_and_non_approved_states_block_reference_and_fact(self) -> None:
        stale, _ = self._item(self._validation(sha="other-sha"))
        self.assertEqual(stale["current_use_authority"], AUTH_VALIDATION_STALE_REPLY_CHANGED)
        self.assertIn("REPLY_HASH_MISMATCH", stale["fact_ineligible_reasons"])
        expected = {"HOLD": AUTH_VALIDATION_HOLD, "EXCLUDED": AUTH_VALIDATION_EXCLUDED, "OUTDATED": AUTH_VALIDATION_OUTDATED}
        for content, state in expected.items():
            item, _ = self._item(self._validation(content=content))
            self.assertEqual(item["current_use_authority"], state)
            self.assertFalse(item["reply_reference_eligible"])
            self.assertFalse(item["generator_fact_eligible"])
        for item in (stale,):
            self.assertFalse(item["reply_reference_eligible"])
            self.assertFalse(item["generator_fact_eligible"])
        pending, _ = self._item(None)
        self.assertEqual(pending["current_use_authority"], AUTH_EXTRACTED_KNOWLEDGE)

    def test_summary_counts_every_authority_state_explicitly(self) -> None:
        _, corpus = self._item(self._validation(snapshot=AUTH_SPLIT_SNAPSHOT))
        counts = corpus["summary"]["use_authority_counts"]
        self.assertEqual(set(counts), set(USE_AUTHORITY_STATES))
        self.assertEqual(sum(counts.values()), corpus["summary"]["use_authority_scope_total"])
        self.assertEqual(counts[AUTH_VALIDATED_KNOWLEDGE], 0)
        self.assertIn("generator_fact_eligible", corpus["summary"]["use_authority_formula"])


class ReplyPolicyQaTest(unittest.TestCase):
    def test_ai_signature_and_pressure_closing_detected(self) -> None:
        result = check_reply_policy("감사합니다. 재구매도 언제든 환영합니다.", "색이 좋아요")
        rules = {v["rule"] for v in result["violations"]}
        self.assertIn(RULE_AI_SIGNATURE_PHRASE, rules)
        self.assertIn(RULE_PURCHASE_PRESSURE_CLOSING, rules)
        self.assertIn(RULE_REPURCHASE_OVEREMPHASIS, rules)
        self.assertIn(RULE_AI_SIGNATURE_PHRASE, {v["rule"] for v in check_reply_policy("다음 구매도 언제든 환영해요", "")["violations"]})

    def test_repurchase_word_itself_is_allowed_when_customer_mentions_it(self) -> None:
        result = check_reply_policy("재구매해 주셔서 감사합니다. 늘 건강하세요.", "벌써 세 번째 재구매예요")
        self.assertTrue(result["ok"], msg=result)

    def test_repurchase_not_in_review_and_multi_mention_flagged(self) -> None:
        result = check_reply_policy("재구매 감사합니다. 꾸준히 이용해 주세요.", "색이 좋아요")
        detail = next(v["detail"] for v in result["violations"] if v["rule"] == RULE_REPURCHASE_OVEREMPHASIS)
        self.assertIn("REPURCHASE_MULTI_MENTION", detail)
        self.assertIn("REPURCHASE_NOT_IN_REVIEW", detail)

    def test_variant_counts_are_deduplicated(self) -> None:
        counts = count_ai_signature_variants(["재구매 언제든 환영합니다", "재구매 늘 환영", "좋은 하루 되세요"])
        self.assertEqual(counts["per_variant"]["재구매_언제든_환영"], 1)
        self.assertEqual(counts["per_variant"]["재구매_환영_기타"], 2)
        self.assertEqual(counts["deduplicated_union"], 2)


class KnowledgeValidationApiTest(_DbTestBase):
    def setUp(self) -> None:
        super().setUp()
        self._insert_review("naver_review:300", "300", status="collected",
                            reply_text="물은 8:2 비율로 섞고 2시간 방치해 주세요.",
                            review_text="물 비율이 궁금해요")
        self._insert_review("naver_review:301", "301", status="collected", reply_text="500")

    def test_validation_write_is_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": ""}):
            resp = self.client.post("/reviews/reply-knowledge/validations",
                                    json={"knowledge_id": "rrk:naver_review:300", "content_validation": "APPROVED"})
        self.assertEqual(resp.status_code, 409)
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 0)

    _ALL_YES = {"reply_appropriate": "yes", "guidance_accurate": "yes", "currently_valid": "yes", "reference_worthy": "yes"}
    _WRITE_ENV = {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": "1", "AUTH_TEST_MODE": "1"}

    def _post(self, body: dict, token: str | None = "test-ops_admin"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post("/reviews/reply-knowledge/validations", json=body, headers=headers)

    def test_validation_requires_ops_admin_or_higher(self) -> None:
        body = {"knowledge_id": "rrk:naver_review:300", "content_validation": "HOLD", "note": "현재 기준 확인 필요"}
        with patch.dict(os.environ, self._WRITE_ENV):
            self.assertEqual(self._post(body, token=None).status_code, 401)
            self.assertEqual(self._post(body, token="test-marketing").status_code, 403)
            self.assertEqual(self._post(body, token="test-sales").status_code, 403)
            self.assertEqual(self._post(body, token="test-user").status_code, 403)
            perm = self.client.get("/reviews/reply-knowledge/permission", headers={"Authorization": "Bearer test-marketing"}).json()
            self.assertFalse(perm["can_validate"])
            perm = self.client.get("/reviews/reply-knowledge/permission", headers={"Authorization": "Bearer test-ops_admin"}).json()
            self.assertTrue(perm["can_validate"])
            self.assertTrue(self.client.get("/reviews/reply-knowledge/permission").json()["authenticated"] is False)
            self.assertEqual(self._post(body, token="test-superadmin").status_code, 200)
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 1)

    def test_approval_requires_all_four_yes_and_note(self) -> None:
        base = {"knowledge_id": "rrk:naver_review:300", "content_validation": "APPROVED"}
        with patch.dict(os.environ, self._WRITE_ENV):
            resp = self._post({**base, **self._ALL_YES})
            self.assertEqual((resp.status_code, resp.json()["detail"]), (400, "validation_note_required"))
            resp = self._post({**base, **self._ALL_YES, "note": "짧음"})
            self.assertEqual(resp.json()["detail"], "validation_note_required")
            resp = self._post({**base, "guidance_accurate": "yes", "currently_valid": "yes", "note": "공식 안내 8:2 확인"})
            self.assertEqual((resp.status_code, resp.json()["detail"]), (400, "approval_requires_all_answers"))
            for field in self._ALL_YES:
                for value in ("no", "unsure"):
                    resp = self._post({**base, **self._ALL_YES, field: value, "note": "공식 안내 8:2 확인"})
                    self.assertEqual((resp.status_code, resp.json()["detail"]), (400, "approval_requires_all_yes"), msg=f"{field}={value}")
            for state in ("HOLD", "EXCLUDED", "OUTDATED"):
                resp = self._post({"knowledge_id": "rrk:naver_review:300", "content_validation": state})
                self.assertEqual((resp.status_code, resp.json()["detail"]), (400, "validation_note_required"), msg=state)
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 0)

    def test_validation_is_appended_with_reviewer_and_authorship_unchanged(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            summary = self.client.get("/reviews/reply-knowledge/summary").json()
            self.assertTrue(summary["validation_write_enabled"])
            self.assertEqual(summary["invalid"], 1)
            queue = self.client.get("/reviews/reply-knowledge/queue", params={"queue_filter": "unknown_knowhow"}).json()
            self.assertEqual([x["knowledge_id"] for x in queue["items"]], ["rrk:naver_review:300"])
            before = queue["items"][0]["authorship"]
            self.assertEqual(before, AUTHORSHIP_UNKNOWN)
            resp = self._post({
                "knowledge_id": "rrk:naver_review:300", "content_validation": "HOLD",
                "guidance_accurate": "unsure", "currently_valid": "unsure", "note": "8:2 비율 현재 기준 확인 필요",
                "reviewer": "spoofed@example.com",
            })
            self.assertEqual(resp.status_code, 200, msg=resp.text)
            self.assertEqual(resp.json()["authorship_unchanged"], before)
            resp = self._post({"knowledge_id": "rrk:naver_review:300", "content_validation": "EXCLUDED", "note": "표현이 오래됨, 재검토"},
                              token="test-superadmin")
            self.assertEqual(resp.status_code, 200, msg=resp.text)
            resp = self._post({
                "knowledge_id": "rrk:naver_review:300", "content_validation": "APPROVED", **self._ALL_YES,
                "note": "현재 상세페이지 사용법(8:2, 2시간)과 대조 확인",
            })
            self.assertEqual(resp.status_code, 200, msg=resp.text)
            detail = self.client.get("/reviews/reply-knowledge/items/rrk:naver_review:300", headers={"Authorization": "Bearer test-ops_admin"}).json()
            self.assertEqual(detail["content_validation"], "APPROVED")
            self.assertEqual(detail["authorship"], AUTHORSHIP_UNKNOWN)
            history = detail["validation_history"]
            self.assertEqual([h["content_validation"] for h in history], ["APPROVED", "EXCLUDED", "HOLD"])
            self.assertEqual([h["reviewer_email"] for h in history],
                             ["ops_admin@example.com", "superadmin@example.com", "ops_admin@example.com"])
            self.assertEqual([h["reviewer_role"] for h in history], ["ops_admin", "superadmin", "ops_admin"])
            self.assertTrue(all(h["reviewer_uid"] for h in history))
            self.assertNotIn("spoofed@example.com", [h["reviewer"] for h in history])
            self.assertTrue(all(h["authorship_class_at_validation"] == AUTHORSHIP_UNKNOWN for h in history))
            invalid = self._post({"knowledge_id": "rrk:naver_review:301", "content_validation": "APPROVED", **self._ALL_YES,
                                  "note": "오염 답글 승인 시도"})
            self.assertEqual(invalid.status_code, 409)
        with SessionLocal() as db:
            self.assertEqual(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:300").one().reply_text,
                             "물은 8:2 비율로 섞고 2시간 방치해 주세요.")
            rows = db.query(ReviewReplyKnowledgeValidation).all()
            self.assertEqual(len(rows), 3)
            self.assertTrue(all(json.loads(r.knowhow_snapshot_json) for r in rows))
            self.assertTrue(all(r.corpus_version for r in rows))
        init_db()
        review_reply_knowledge_api._CACHE.update({"key": None, "corpus": None})
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 3)

    def test_integrity_summary_is_dry_run(self) -> None:
        body = self.client.get("/reviews/reply-integrity/summary").json()
        self.assertEqual(body["stored_reply_body_verdicts"].get(REPLY_BODY_NUMERIC_COUNTER), 1)
        self.assertEqual(body["existing_db_restoration"], "NOT_RUN")
        with SessionLocal() as db:
            self.assertEqual(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:301").one().reply_text, "500")


if __name__ == "__main__":
    unittest.main()
