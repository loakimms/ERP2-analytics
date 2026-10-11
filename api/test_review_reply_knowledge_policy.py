import copy
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

import main
import review_reply_knowledge_api
import review_reply_knowledge_policy as policy
from db import (
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyKnowledgeClaimFactValidation,
    ReviewReplyKnowledgePolicyDecision,
    ReviewReplyKnowledgeSourceApplicability,
    ReviewReplyKnowledgeUnitFactValidation,
    ReviewReplyKnowledgeValidation,
    SessionLocal,
    init_db,
)
from review_reply_knowledge_unit_facts import load_official_source_registry

HTML = "sujata_usage_guide_html"
OPC = "operator_confirmed_usage_guidance"
ADMIN = {"Authorization": "Bearer test-ops_admin"}
D01_KID = "rrk:naver_review:4877886386"
D02_KID = "rrk:naver_review:4875316192"
REPLIES = {
    "4877886386": ("브라운만 써봤는데 색이 연해요", "안녕하세요 고객님~ 레드와 브라운 반드시 함께 사용해주셔야 합니다. 브라운 단독은 권해드리지 않습니다. 감사합니다."),
    "4875316192": ("헤나 염색 잘 됐어요", "안녕하세요 고객님~ 항상 최상위 유기농 제품으로 품질 유지하고 있습니다. 즐거운 하루 되세요."),
}
UNCHANGED_MODELS = (ReviewReplyKnowledgeClaimFactValidation, ReviewReplyKnowledgeSourceApplicability,
                    ReviewReplyKnowledgeUnitFactValidation, ReviewReplyKnowledgeValidation)


class PolicyArtifactTest(unittest.TestCase):
    def test_artifact_matches_final_audit_and_registry(self) -> None:
        art = policy.load_policy_artifact()
        self.assertTrue(art["available"], art["error"])
        self.assertEqual(art["order"], [f"D{i:02d}" for i in range(1, 14)])
        replies = {m["knowledge_id"] for q in art["questions"].values() for m in q["linked_replies"]}
        self.assertEqual(len(replies), 217)
        self.assertEqual({r["rule_id"] for r in art["auto_rules"]}, {"R1", "R2", "R3"})
        registry = load_official_source_registry(product_info_rows=[])
        for q in art["questions"].values():
            self.assertTrue(q["guide_refs"])
            self.assertEqual(policy._missing_refs(q, registry), [], q["question_id"])
            self.assertTrue(set(q["products"]) >= {m["product_group"] for m in q["linked_replies"]})
        self.assertEqual([q["question_id"] for q in art["questions"].values() if q["guide_conflict"]], ["D01"])

    def test_tampered_or_missing_artifact_fails_closed(self) -> None:
        raw = json.loads(policy._ARTIFACT_PATH.read_text(encoding="utf-8"))
        raw["questions"][0]["products"].append("SHAMPOO")
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "x.json"
            bad.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            self.assertFalse(policy.load_policy_artifact(bad)["available"])
            self.assertFalse(policy.load_policy_artifact(Path(tmp) / "missing.json")["available"])


class PolicyApiTest(unittest.TestCase):
    _WRITE_ENV = {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": "1", "AUTH_TEST_MODE": "1"}
    URL = "/reviews/reply-knowledge/policy-decisions"

    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            for model in (ReviewReplyKnowledgePolicyDecision, *UNCHANGED_MODELS, NaverReviewReplyRaw, NaverReviewRaw):
                db.query(model).delete(synchronize_session=False)
            for rid, (review_text, reply_text) in REPLIES.items():
                db.add(NaverReviewRaw(
                    review_key=f"naver_review:{rid}", product_url=f"https://smartstore.naver.com/t/products/{rid}", product_title="수자타 헤나",
                    review_id_original=rid, review_written_at=date(2026, 9, 1), rating=5.0, review_text=review_text, text_hash=rid,
                    import_source="smartstore_review_upload", reply_exists_flag=True, reply_collect_status="collected", raw_payload_json="{}",
                ))
                db.add(NaverReviewReplyRaw(review_key=f"naver_review:{rid}", reply_text=reply_text))
            db.commit()
        for target, value in (("_product_info_rows", lambda db: []), ("load_applicability_records", lambda db: [])):
            p = patch.object(review_reply_knowledge_api, target, value)
            p.start()
            self.addCleanup(p.stop)
        review_reply_knowledge_api._CACHE.update({"key": None, "corpus": None})

    def _cards(self, headers=ADMIN) -> dict:
        resp = self.client.get("/reviews/reply-knowledge/policy-questions", headers=headers)
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def _detail(self, qid: str, headers=ADMIN) -> dict:
        resp = self.client.get(f"/reviews/reply-knowledge/policy-questions/{qid}", headers=headers)
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def _body(self, qid: str = "D01", **over) -> dict:
        card = next(c for c in self._cards()["cards"] if c["question_id"] == qid)
        body = {
            "request_id": f"pol-{qid}-{len(over)}-{os.urandom(4).hex()}",
            "question_id": qid,
            "question_sha256": card["question_sha256"],
            "supersedes_record_id": card["latest_record_id"],
            "decision": "GUIDE_STANDARD",
            "decision_text": "운영자 확인 기준(브라운 단독 2시간)을 적용합니다.",
            "products": ["HENNA"],
            "issue_ids": card["issue_ids"],
            "condition_key": card["conditions"][0]["key"],
            "evidence": [card["guide_refs"][0]],
            "exception_knowledge_ids": [],
            "note": "공식 가이드 우선 원칙에 따른 결정",
        }
        body.update(over)
        return body

    def _post(self, body: dict, token: str | None = "test-ops_admin"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post(self.URL, json=body, headers=headers)

    def _code(self, resp) -> str:
        detail = resp.json().get("detail")
        return detail["code"] if isinstance(detail, dict) else detail

    def _unchanged_counts(self) -> dict:
        with SessionLocal() as db:
            return {m.__tablename__: db.query(m).count() for m in UNCHANGED_MODELS}

    def test_cards_and_detail_before_any_decision(self) -> None:
        view = self._cards()
        self.assertEqual(len(view["cards"]), 13)
        self.assertEqual(view["pending_count"], 13)
        self.assertEqual(view["counts"]["PENDING"], 13)
        self.assertFalse(view["auto_verified"])
        self.assertFalse(view["generator_connected"])
        self.assertEqual(sum(c["linked_reply_count"] for c in view["cards"]), 394)
        detail = self._detail("D01")
        self.assertEqual(len(detail["members"]), 13)
        self.assertTrue(all(r["available"] and r["statement"] for r in detail["guide_refs"]))
        member = next(m for m in detail["members"] if m["knowledge_id"] == D01_KID)
        self.assertTrue(member["reply_available"])
        self.assertIn("반드시 함께", member["reply_text"])
        self.assertEqual(member["application"], {"I02": policy.NO_DECISION})
        self.assertEqual(self.client.get("/reviews/reply-knowledge/policy-questions/D99", headers=ADMIN).status_code, 404)

    def test_write_requires_switch_and_admin(self) -> None:
        body = self._body()
        self.assertEqual(self._code(self._post(body)), "knowledge_validation_write_not_enabled")
        with patch.dict(os.environ, self._WRITE_ENV):
            self.assertEqual(self._post(body, token=None).status_code, 401)
            self.assertEqual(self._post(body, token="test-marketing").status_code, 403)
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgePolicyDecision).count(), 0)

    def test_save_append_only_history_duplicate_and_stale(self) -> None:
        before = self._unchanged_counts()
        with patch.dict(os.environ, self._WRITE_ENV):
            first_body = self._body()
            first = self._post(first_body)
            self.assertEqual(first.status_code, 200, first.text)
            rec1 = first.json()["policy_decision"]
            self.assertEqual(rec1["supersedes_record_id"], policy.ROOT)
            self.assertFalse(first.json()["auto_verified"])
            self.assertEqual(rec1["evidence"][0]["entry_key"], "opc:standard:brown-single")
            self.assertTrue(rec1["evidence"][0]["entry_sha256"])
            self.assertEqual(len(rec1["linked_refs"]["linked_knowledge_ids"]), 13)

            dup = self._post(first_body)
            self.assertTrue(dup.json()["duplicate"])
            self.assertEqual(self._code(self._post({**first_body, "note": "다른 내용의 요청 재사용"})), "POLICY_REQUEST_ID_REUSED")

            stale = self._post({**first_body, "request_id": "pol-stale-1"})
            self.assertEqual((stale.status_code, self._code(stale)), (409, "POLICY_STALE_VIEW"))

            second = self._post(self._body(decision="NEEDS_EVIDENCE", decision_text="상세페이지 원문 확인 후 다시 판단합니다."))
            self.assertEqual(second.status_code, 200, second.text)
            rec2 = second.json()["policy_decision"]
            self.assertEqual(rec2["supersedes_record_id"], rec1["decision_id"])

        detail = self._detail("D01")
        self.assertEqual([h["decision_id"] for h in detail["history"]], [rec2["decision_id"], rec1["decision_id"]])
        self.assertEqual(detail["latest"]["decision"], "NEEDS_EVIDENCE")
        self.assertEqual(detail["history"][1]["decision"], "GUIDE_STANDARD")
        self.assertEqual(detail["state"], policy.STATE_CURRENT)
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgePolicyDecision).count(), 2)
        self.assertEqual(self._unchanged_counts(), before)
        self.assertEqual(self._cards()["pending_count"], 12)

    def test_identity_is_redacted_for_non_admin(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            self.assertEqual(self._post(self._body()).status_code, 200)
        anon = self._detail("D01", headers={})
        self.assertTrue(anon["identity_redacted"])
        self.assertIsNone(anon["latest"]["note"])
        self.assertIsNone(anon["latest"]["reviewer_email"])
        self.assertEqual(anon["latest"]["decision"], "GUIDE_STANDARD")

    def test_guards(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            cases = [
                (self._body(decision="HUMAN_SUPPLEMENT"), "POLICY_HUMAN_OVER_GUIDE_NOT_ALLOWED"),
                (self._body(products=["SHAMPOO"]), "POLICY_PRODUCT_OUT_OF_SCOPE"),
                (self._body(products=[]), "POLICY_PRODUCT_OUT_OF_SCOPE"),
                (self._body(issue_ids=["I05"]), "POLICY_CLAIM_OUT_OF_SCOPE"),
                (self._body(condition_key="gray_hair"), "POLICY_CONDITION_OUT_OF_SCOPE"),
                (self._body(evidence=[{"source_id": HTML, "entry_key": "html:step:06"}]), "POLICY_EVIDENCE_NOT_LINKED"),
                (self._body(evidence=[]), "POLICY_EVIDENCE_REQUIRED"),
                (self._body(exception_knowledge_ids=[D02_KID]), "POLICY_EXCEPTION_NOT_LINKED"),
                (self._body(question_sha256="0" * 64), "POLICY_QUESTION_CHANGED"),
                (self._body(reviewer_email="x@example.com"), "reviewer_fields_not_accepted"),
                (self._body(note=""), "policy_reason_required"),
                (self._body(decision="VERIFIED"), "invalid_policy_decision"),
                (self._body(question_id="D99"), "policy_question_not_found"),
            ]
            for body, code in cases:
                self.assertEqual(self._code(self._post(body)), code, code)
            ok = self._post(self._body("D02", decision="HUMAN_SUPPLEMENT", products=["HENNA"], evidence=[],
                                       decision_text="헤나 성분 설명 범위의 표현만 보충으로 인정합니다."))
            self.assertEqual(ok.status_code, 200, ok.text)
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgePolicyDecision).count(), 1)

    def test_source_missing_holds_question(self) -> None:
        registry = load_official_source_registry(product_info_rows=[])
        broken = copy.deepcopy(registry)
        opc = broken["sources"][OPC]
        opc["entries"] = [e for e in opc["entries"] if e["entry_key"] != "opc:standard:brown-single"]
        with patch.object(review_reply_knowledge_api, "load_fact_registry", lambda db, **kw: broken):
            card = next(c for c in self._cards()["cards"] if c["question_id"] == "D01")
            self.assertEqual(card["state"], policy.STATE_SOURCE_MISSING)
            with patch.dict(os.environ, self._WRITE_ENV):
                resp = self._post(self._body())
        self.assertEqual((resp.status_code, self._code(resp)), (409, "POLICY_SOURCE_MISSING"))

    def test_reuse_is_scoped_to_same_product_claim_condition(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            resp = self._post(self._body("D02", decision="EXCLUDE_EXPRESSION", products=["HENNA"], issue_ids=["I05"],
                                         evidence=[], exception_knowledge_ids=[D02_KID],
                                         decision_text="인증 근거가 없으므로 유기농 단정 표현은 쓰지 않습니다."))
            self.assertEqual(resp.status_code, 200, resp.text)
        art = policy.policy_artifact()
        with SessionLocal() as db:
            records = review_reply_knowledge_api.load_policy_records(db)
        registry = load_official_source_registry(product_info_rows=[])

        def reuse(**kw):
            base = {"issue_id": "I05", "product_group": "HENNA", "condition_key": "as_stated"}
            return policy.reuse_for(art, records, registry, **(base | kw))

        hit = reuse(knowledge_id="rrk:naver_review:new-reply")
        self.assertEqual((hit["question_id"], hit["application"], hit["decision"]), ("D02", policy.APPLIES, "EXCLUDE_EXPRESSION"))
        self.assertFalse(hit["auto_verified"])
        self.assertEqual(reuse(product_group="SHAMPOO")["application"], policy.OUT_OF_SCOPE_PRODUCT)
        self.assertEqual(reuse(issue_id="I11")["application"], policy.OUT_OF_SCOPE_CLAIM)
        self.assertEqual(reuse(condition_key="gray_hair")["application"], policy.OUT_OF_SCOPE_CONDITION)
        self.assertEqual(reuse(knowledge_id=D02_KID)["application"], policy.EXCEPTION)
        self.assertEqual(reuse(issue_id="I03")["application"], policy.NO_DECISION)
        self.assertIsNone(reuse(product_group="SHAMPOO")["decision"])

        detail = self._detail("D02")
        apps = {m["knowledge_id"]: m["application"] for m in detail["members"]}
        self.assertEqual(apps[D02_KID]["I05"], policy.EXCEPTION)
        self.assertTrue(all(m["authorship"] == m["authorship_at_audit"] or m["reply_available"] for m in detail["members"]))
        shampoo = [m for m in detail["members"] if m["product_group"] == "SHAMPOO"]
        self.assertTrue(shampoo and all(set(m["application"].values()) <= {policy.OUT_OF_SCOPE_PRODUCT, policy.OUT_OF_SCOPE_CLAIM} for m in shampoo))

    def test_guide_or_question_change_requires_reevaluation(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            self.assertEqual(self._post(self._body()).status_code, 200)
        art = policy.policy_artifact()
        with SessionLocal() as db:
            records = review_reply_knowledge_api.load_policy_records(db)
        registry = load_official_source_registry(product_info_rows=[])
        q = art["questions"]["D01"]
        latest = policy.latest_by_question(records)["D01"]
        self.assertEqual(policy.decision_state(q, latest, registry)["state"], policy.STATE_CURRENT)

        changed = copy.deepcopy(registry)
        entry = next(e for e in changed["sources"][OPC]["entries"] if e["entry_key"] == "opc:standard:brown-single")
        entry["entry_sha256"] = "changed"
        state = policy.decision_state(q, latest, changed)
        self.assertEqual((state["state"], state["reasons"]), (policy.STATE_REEVALUATE, ["SOURCE_CHANGED:opc:standard:brown-single"]))
        hit = policy.reuse_for(art, records, changed, issue_id="I02", product_group="HENNA", condition_key="unconditional")
        self.assertEqual(hit["application"], policy.REEVALUATION)

        q2 = q | {"question_sha256": "other"}
        self.assertEqual(policy.decision_state(q2, latest, registry)["reasons"], ["QUESTION_CHANGED"])
        with patch.object(review_reply_knowledge_api, "load_fact_registry", lambda db, **kw: changed):
            card = next(c for c in self._cards()["cards"] if c["question_id"] == "D01")
        self.assertEqual(card["state"], policy.STATE_REEVALUATE)

    def test_chain_unique_index_blocks_concurrent_first_records(self) -> None:
        def row(request_id: str) -> ReviewReplyKnowledgePolicyDecision:
            return ReviewReplyKnowledgePolicyDecision(
                decision_id=request_id, request_id=request_id, request_payload_sha256="0" * 64, supersedes_record_id=policy.ROOT,
                question_id="D05", question_version="qa", question_sha256="0" * 64, decision="NEEDS_EVIDENCE", decision_text="qa",
                products_json="[]", issue_ids_json="[]", condition_key="as_stated", exceptions_json="[]", evidence_json="[]",
                linked_refs_json="{}", note="qa", reviewer_uid="qa", reviewer_email=None, reviewer_role="ops_admin",
            )

        with SessionLocal() as db:
            db.add(row("qa-1"))
            db.commit()
            db.add(row("qa-2"))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()
            self.assertEqual(db.query(ReviewReplyKnowledgePolicyDecision).count(), 1)


if __name__ == "__main__":
    unittest.main()
