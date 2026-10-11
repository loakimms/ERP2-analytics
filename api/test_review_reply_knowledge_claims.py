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
import review_reply_knowledge_claims as claims_module
import review_reply_knowledge_unit_facts as unit_facts_module
from db import (
    NaverReviewRaw,
    NaverReviewReplyRaw,
    ReviewReplyKnowledgeClaimFactValidation,
    ReviewReplyKnowledgeSourceApplicability,
    ReviewReplyKnowledgeUnitFactValidation,
    ReviewReplyKnowledgeValidation,
    SessionLocal,
    init_db,
)
from review_reply_knowledge_unit_facts import ANSWER_FIELDS, load_official_source_registry

HTML = "sujata_usage_guide_html"
OPC = "operator_confirmed_usage_guidance"
ASPECT_FIELDS = {a: f for f, a in ANSWER_FIELDS.items()}
PRODUCT_INFO_ROWS = [
    {"sku_id": sku, "product_url": f"https://smartstore.naver.com/t/products/{sku}", "product_items_json": json.dumps(
        [{"product_key": f"p{i}", "product_name": name, "full_ingredients": "테스트 성분"} for i, name in enumerate(names)], ensure_ascii=False)}
    for sku, names in (
        ("s1", ["수자타헤나레드", "수자타헤나브라운"]),
        ("s6", ["수자타두피케어헤어팩", "수자타딥클린헤어팩", "수자타볼륨업헤어팩", "수자타손상케어헤어팩"]),
    )
]
APPROVE = ((HTML, "html:ratio:natural_brown"), (HTML, "html:ratio:red_brown"), (HTML, "html:ratio:orange"), (HTML, "html:sequence:dark_brown"),
           (HTML, "html:faq:gray_or_dark_brown_sequence"), (HTML, "html:caution:current-color"), (HTML, "html:duration:pack"),
           (OPC, "opc:standard:sequential"), (OPC, "opc:standard:red-single"))

# Historical replies (company-written text) whose units are decomposed in claim_decomposition_v1.
REPLIES = {
    "4875000316": (  # template color chart, 13 claims
        "전체 염색을 했는데 뿌리새치가 전혀 염색이 되지 않았어요. 2팩을 샀으니 힌번더 해보려고 합니다",
        "안녕하세요~~고객님!! 브라운 제품의 식물의 특성이 레드가 적절히 받쳐줘야 자기의 색을 잘 냅니다. 레드와 함께 사용하시는 염색법 권해드립니다. "
        "레드(오렌지빛을 내는 식물)와 브라운(쪽빛을 내는 식물)을 혼합하여 고객님께서 원하시는 색상으로 염색하시면 되시는데요 \"진한갈색\"으로 염색되시길 "
        "원하신다면 ★레드 2시간 후에 당일 또는 다음날 브라운 2시간 염색하시면 되고 자연스러운 갈색 이나 밝은 갈색을 원하신다면 ★레드 2 : 브라운 8 비율로 "
        "염색하시면 붉은기 거의 없는 자연스러운 갈색 ★레드 3 : 브라운 7 비율로 염색하시면 붉은기 살짝있는 자연스러운 갈색 ★레드 5 : 브라운 5 비율이면 "
        "붉은기가 다소 있는 밝은 갈색 ★브라운 단독 : 아주 연한 갈색 ★레드 단독 : 오렌지색으로 염색됩니다. 단, 현재의 모발 색상에 따라 모발 특성에 따라 "
        "색상은 다르게 염색되므로 참고 부탁드립니다. 즐거운 명절 보내세요^^",
    ),
    "4894769417": (  # sequential steps split into separate claims
        "레드믹스해서8시간 후 도포 2시간방치 후 샴푸하고 머리 드라이후 브라운 믹스 바로 도포후2시간방치 결과 대 대 만족",
        "안녕하세요 고객님~ 😊 오랜 염색으로 두피도 아프고 머릿결이 많이 상해서 4달이나 쉬셨다니 그동안 얼마나 고민이 많으셨을지 느껴집니다. 💚 "
        "흰머리 때문에 속는 셈 치고 도전하셨다고 했는데 결과가 완벽 염색이라니 저희도 감동입니다. 🌿✨ 레드 반죽 8시간 숙성 후 모발 도포 후 2시간 방치, "
        "드라이 후 브라운까지 2시간… 정말 정성 가득 제대로 해주셨습니다. 👍 그 노력 덕분에 색도 깊고 안정적으로 나온 거 같습니다. 🎨 천연 염색은 두피에 "
        "묻을 수록 유효성분이 두피를 건강하게 만드는 효과 있습니다. 마음 편하게 두피에 듬뿍듬뿍 올려주세요 🌱 두피 편안하고 결과까지 만족이라니 저희도 "
        "정말 기쁩니다 🙏 소중한 경험 나눠주셔서 감사드리고 앞으로도 건강한 염색 이어가겠습니다. 💕 즐거운 명절 되세요^^",
    ),
    "4966498321": (  # contains the CONFLICT claim
        "염색은 항상 헤나만 사용하였는데 지지난번부터 두피 트러블이 있어 피부과에 다녀오기도하고 고민하다가 다시 한 번 주문해 보았습니다",
        "안녕하세요~~고객님!! 수자타 제품은 100% 천연 성분이지만, 땅콩, 복숭아, 토마토등 처럼 사람마다 체질과 피부 반응이 다르기 때문에 간혹 헤나의 특정 "
        "성분에 민감하게 반응하실 수 있습니다.🌿 혹시 가려움, 붉어짐, 따가움 등의 일시적인 것이 아니라고 판단되신다면 즉시 사용을 중단해주셔야 하십니다. "
        "패치테스트로 확인해보시는 것이 더 안전한 방법이십니다. 고객님의 건강과 안전이 가장 최우선입니다.💚 즐거운 연휴되세요!!",
    ),
    "4879643967": (  # A-class unit (not decomposed)
        "아직 사용전인데 헤어팩사용법도 같이넣어주셨으면 좋겠어요",
        "안녕하세요~~고객님!! 고객님의 소중한 고견 반영하도록 하겠습니다. 본 헤어팩 트리트먼트이기에 1시간만 헤어팩 해주셔도 되십니다. 즐거운 명절 되세요^^",
    ),
}
TEMPLATE = "rrk:naver_review:4875000316"
SEQUENTIAL = "rrk:naver_review:4894769417"
CONFLICT = "rrk:naver_review:4966498321"
A_CLASS = "rrk:naver_review:4879643967"


def _records(keys, decision: str = "APPROVED", start: int = 0) -> list:
    base = load_official_source_registry(product_info_rows=PRODUCT_INFO_ROWS)
    out = []
    for i, (sid, key) in enumerate(keys, start):
        entry = next(e for e in base["sources"][sid]["entries"] if e["entry_key"] == key)
        out.append({"applicability_id": f"cl-{i}", "source_id": sid, "entry_key": key, "decision": decision, "products": entry["products"],
                    "entry_content_sha256": entry["entry_sha256"], "source_sha256": base["sources"][sid]["sha256"],
                    "created_at": f"2026-10-10T00:00:{i:02d}"})
    return out


class ClaimArtifactTest(unittest.TestCase):
    def test_artifact_integrity_and_counts(self) -> None:
        art = claims_module.load_claim_artifact()
        self.assertTrue(art["available"], art["error"])
        self.assertEqual((len(art["claims_by_key"]), len(art["parents"])), (898, 119))
        classes = {}
        for c in art["claims_by_key"].values():
            classes[c["analysis_class"]] = classes.get(c["analysis_class"], 0) + 1
            self.assertIn(c["parent_unit_key"], art["parents"])
            self.assertEqual(c["knowledge_id"], art["parents"][c["parent_unit_key"]]["knowledge_id"])
            self.assertEqual(claims_module._sha(c["quote"]), c["quote_sha256"])
            self.assertEqual(len(c["unit_spans"]), len(c["reply_spans"]))
        self.assertEqual(classes, {"VERIFY_CANDIDATE": 306, "PARTIAL": 306, "PENDING": 285, "CONFLICT": 1})
        self.assertEqual(sum(len(v) for v in art["claims_by_parent"].values()), 898)

    def test_tampered_or_missing_artifact_fails_closed(self) -> None:
        raw = json.loads(claims_module._ARTIFACT_PATH.read_text(encoding="utf-8"))
        raw["claims"][0]["analysis_class"] = "VERIFY_CANDIDATE" if raw["claims"][0]["analysis_class"] != "VERIFY_CANDIDATE" else "PENDING"
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "x.json"
            bad.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            self.assertFalse(claims_module.load_claim_artifact(bad)["available"])
            self.assertFalse(claims_module.load_claim_artifact(Path(tmp) / "missing.json")["available"])
        unavailable = claims_module.load_claim_artifact(Path("/nonexistent/claims.json"))
        guard = claims_module.unit_verified_guard({"knowledge_id": A_CLASS}, {}, records=[], registry={}, artifact=unavailable)
        self.assertEqual(guard["code"], "CLAIM_DECOMPOSITION_UNAVAILABLE")

    def test_target_color_condition_is_separated_only_when_it_is_just_the_wanted_color(self) -> None:
        self.assertTrue(claims_module.target_color_only_condition("\"진한갈색\"으로 염색되시길 원하신다면", "진한갈색"))
        self.assertFalse(claims_module.target_color_only_condition("흰머리가 많고 진한갈색을 원하신다면", "진한갈색"))
        self.assertFalse(claims_module.target_color_only_condition("UNKNOWN", "진한갈색"))
        self.assertEqual(claims_module.color_match("진한갈색", ["진한 흑갈색"]), claims_module.COLOR_NEEDS_HUMAN)
        self.assertEqual(claims_module.color_match("붉은 갈색", ["붉은 갈색"]), claims_module.COLOR_LITERAL)


class ClaimApiTest(unittest.TestCase):
    _WRITE_ENV = {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": "1", "AUTH_TEST_MODE": "1"}
    URL = "/reviews/reply-knowledge/claim-fact-validations"

    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            for model in (ReviewReplyKnowledgeClaimFactValidation, ReviewReplyKnowledgeSourceApplicability, ReviewReplyKnowledgeUnitFactValidation,
                          ReviewReplyKnowledgeValidation, NaverReviewReplyRaw, NaverReviewRaw):
                db.query(model).delete(synchronize_session=False)
            for rid, (review_text, reply_text) in REPLIES.items():
                db.add(NaverReviewRaw(
                    review_key=f"naver_review:{rid}", product_url=f"https://smartstore.naver.com/t/products/{rid}", product_title="수자타 헤나",
                    review_id_original=rid, review_written_at=date(2026, 9, 1), rating=5.0, review_text=review_text, text_hash=rid,
                    import_source="smartstore_review_upload", reply_exists_flag=True, reply_collect_status="collected", raw_payload_json="{}",
                ))
                db.add(NaverReviewReplyRaw(review_key=f"naver_review:{rid}", reply_text=reply_text))
            db.commit()
        self.gate_b = _records(APPROVE)
        for target, value in (("_product_info_rows", lambda db: PRODUCT_INFO_ROWS), ("load_applicability_records", lambda db: list(self.gate_b))):
            p = patch.object(review_reply_knowledge_api, target, value)
            p.start()
            self.addCleanup(p.stop)
        self._reset_cache()
        self.registry = load_official_source_registry(product_info_rows=PRODUCT_INFO_ROWS, applicability_records=self.gate_b)

    def _reset_cache(self) -> None:
        review_reply_knowledge_api._CACHE.update({"key": None, "corpus": None})

    def _claims(self, kid: str, token: str | None = "test-ops_admin") -> dict:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        resp = self.client.get(f"/reviews/reply-knowledge/items/{kid}/claims", headers=headers)
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def _claim(self, kid: str, label: str) -> dict:
        return next(c for p in self._claims(kid)["parents"] for c in p["claims"] if c["analysis_label"] == label)

    def _body(self, kid: str, view: dict, keys: list, status: str = "VERIFIED", **extra) -> dict:
        aspects = view["applicable_aspects"]
        evidence = []
        for key in keys:
            sid = OPC if key.startswith("opc:") else HTML
            entry = next(e for e in self.registry["sources"][sid]["entries"] if e["entry_key"] == key)
            evidence.append({"source_id": sid, "entry_key": key, "covers": [a for a in entry["aspects"] if a in aspects]})
        body = {"knowledge_id": kid, "claim_key": view["claim_key"], "fact_status": status, "evidence": evidence,
                "request_id": f"clt-{os.urandom(8).hex()}", "supersedes_record_id": view["factValidation"]["latestRecordId"] or "ROOT",
                "note": "공식 근거 원문과 대조"}
        if status == "VERIFIED":
            body |= {"verified_scope": "공식 근거가 말하는 범위", **{ASPECT_FIELDS[a]: "yes" for a in aspects if a in ASPECT_FIELDS}}
            if "target_color" in aspects:
                body["target_color_accurate"] = "yes"
        body.update(extra)
        return body

    def _post(self, body: dict, token: str | None = "test-ops_admin"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post(self.URL, json=body, headers=headers)

    def _code(self, resp) -> str:
        detail = resp.json()["detail"]
        return detail["code"] if isinstance(detail, dict) else detail

    def _corpus(self) -> dict:
        with SessionLocal() as db:
            return review_reply_knowledge_api.load_corpus(db)

    def _unit_post(self, kid: str, unit_key: str, keys: list, status: str = "VERIFIED"):
        unit = next(u for u in self._corpus()["items"] if u["knowledge_id"] == kid)
        u = next(x for x in unit["knowhow_items"] if (x.get("factValidation") or {}).get("unitKey") == unit_key)
        aspects = u["factValidation"]["applicableAspects"]
        evidence = [{"source_id": HTML, "entry_key": k, "covers": [a for a in next(e for e in self.registry["sources"][HTML]["entries"]
                                                                                   if e["entry_key"] == k)["aspects"] if a in aspects]} for k in keys]
        body = {"knowledge_id": kid, "unit_key": unit_key, "fact_status": status, "evidence": evidence, "note": "Unit 전체 판단 기록",
                "verified_scope": "Unit 전체 범위", "generator_reference_allowed": "no", **{ASPECT_FIELDS[a]: "yes" for a in aspects}}
        if status != "VERIFIED":
            body = {k: v for k, v in body.items() if k not in ("verified_scope",)} | {f: None for f in ASPECT_FIELDS.values()}
        return self.client.post("/reviews/reply-knowledge/unit-fact-validations", json=body, headers={"Authorization": "Bearer test-ops_admin"})

    def test_claim_views_preserve_parent_links_and_context(self) -> None:
        view = self._claims(TEMPLATE)
        self.assertTrue(view["available"])
        (parent,) = view["parents"]
        self.assertEqual((parent["claim_count"], parent["verified_claim_count"], parent["unit_verified_blocked"]), (13, 0, True))
        self.assertTrue(all(c["integrity"] == "OK" for c in parent["claims"]))
        self.assertTrue(all(c["factValidation"]["status"] == "PENDING" for c in parent["claims"]))
        reply = REPLIES["4875000316"][1]
        for c in parent["claims"]:
            self.assertEqual(" … ".join(reply[a:b] for a, b in c["reply_spans"]), c["quote"])
        dark = next(c for c in parent["claims"] if c["canonical_key"] == "SEQ_RED2H_BROWN2H_DARK")
        self.assertIn("target_color", dark["applicable_aspects"])
        self.assertNotIn("condition", dark["applicable_aspects"])
        self.assertEqual((dark["official_color_labels"], dark["target_color_match"]), (["진한 흑갈색"], "NEEDS_HUMAN_EQUIVALENCE"))
        step = self._claim(SEQUENTIAL, "U036-C02")
        self.assertEqual(step["inherited_context"], {"mode": "sequential", "order": ["레드 헤나", "브라운 헤나"]})
        self.assertIn("sequence", step["applicable_aspects"])
        self.assertEqual(self._claims(A_CLASS)["parents"], [])

    def test_write_gates_permissions_and_identity(self) -> None:
        view = self._claim(TEMPLATE, "U003-C06")
        body = self._body(TEMPLATE, view, ["html:ratio:natural_brown"])
        with patch.dict(os.environ, {"REVIEW_KNOWLEDGE_VALIDATION_WRITE_ENABLED": ""}):
            self.assertEqual(self._post(body).status_code, 409)
        with patch.dict(os.environ, self._WRITE_ENV):
            self.assertEqual(self._post(body, token=None).status_code, 401)
            self.assertEqual(self._post(body, token="test-marketing").status_code, 403)
            resp = self._post({**body, "reviewer_email": "spoof@example.com"})
            self.assertEqual((resp.status_code, self._code(resp)), (400, "reviewer_fields_not_accepted"))
            resp = self._post({**body, "generator_reference_allowed": "yes"})
            self.assertEqual(self._code(resp), "CLAIM_GENERATOR_USE_NOT_ENABLED")
            resp = self._post(body)
            self.assertEqual(resp.status_code, 200, resp.text)
            rec = resp.json()["claim_fact_validation"]
            self.assertEqual((rec["reviewer_email"], rec["reviewer_role"], rec["generator_reference_allowed"]), ("ops_admin@example.com", "ops_admin", "no"))
        anon = self._claims(TEMPLATE, token=None)
        self.assertTrue(anon["identity_redacted"])
        self.assertIsNone(anon["claim_history"][0]["reviewer_email"])
        self.assertIsNone(anon["claim_history"][0]["note"])

    def test_unconfirmed_and_conflicting_claims_cannot_be_verified(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            pending = self._claim(TEMPLATE, "U003-C08")  # 3:7
            resp = self._post(self._body(TEMPLATE, pending, ["html:ratio:natural_brown"]))
            self.assertEqual((resp.status_code, self._code(resp)), (409, "CLAIM_ANALYSIS_NOT_VERIFIABLE"))
            conflict = self._claim(CONFLICT, "U172-C01")
            self.assertEqual(conflict["analysis_class"], "CONFLICT")
            resp = self._post(self._body(CONFLICT, conflict, []))
            self.assertEqual(self._code(resp), "CLAIM_ANALYSIS_NOT_VERIFIABLE")
            resp = self._post(self._body(TEMPLATE, pending, [], status="HOLD", hold_reason="FACT_VALIDATION_SOURCE_MISSING"))
            self.assertEqual(resp.status_code, 200, resp.text)
            view = self._claims(TEMPLATE)["parents"][0]["claims"]
            partials = [c for c in view if c["analysis_class"] == "PARTIAL"]
            self.assertTrue(partials)
            for partial in partials:
                # Every answer "yes", the suggested official evidence and its own official color label: still not VERIFIED.
                self.assertFalse(partial["verifiable"])
                extra = {"official_color_label": partial["official_color_labels"][0]} if partial["official_color_labels"] else {}
                keys = [e["entry_key"] for e in partial["suggested_evidence"] if e["source_id"]]
                resp = self._post(self._body(TEMPLATE, partial, keys, **extra))
                self.assertEqual((resp.status_code, resp.json()["detail"]), (409, {"code": "CLAIM_ANALYSIS_NOT_VERIFIABLE", "detail": "PARTIAL"}))
            resp = self._post(self._body(TEMPLATE, partials[0], [], status="HOLD", hold_reason="PARTIAL_OFFICIAL_EVIDENCE"))
            self.assertEqual(resp.status_code, 200, resp.text)
            self.assertTrue(all(c["verifiable"] for c in view if c["analysis_class"] == "VERIFY_CANDIDATE"))
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeClaimFactValidation).filter_by(fact_status="VERIFIED").count(), 0)

    def test_target_color_requires_official_label_from_selected_evidence(self) -> None:
        dark = self._claim(TEMPLATE, "U003-C04")
        keys = ["opc:standard:sequential", "html:sequence:dark_brown"]
        with patch.dict(os.environ, self._WRITE_ENV):
            resp = self._post(self._body(TEMPLATE, dark, keys))
            self.assertEqual(self._code(resp), "TARGET_COLOR_LABEL_REQUIRED")
            resp = self._post(self._body(TEMPLATE, dark, keys, official_color_label="연한 갈색"))
            self.assertEqual(self._code(resp), "TARGET_COLOR_NOT_IN_SELECTED_EVIDENCE")
            resp = self._post(self._body(TEMPLATE, dark, keys, official_color_label="진한 흑갈색", target_color_accurate="unsure"))
            self.assertEqual(self._code(resp), "verified_requires_all_applicable_yes")
            resp = self._post(self._body(TEMPLATE, dark, ["opc:standard:sequential"], official_color_label="진한 흑갈색"))
            self.assertEqual(self._code(resp), "TARGET_COLOR_NOT_IN_SELECTED_EVIDENCE")
            resp = self._post(self._body(TEMPLATE, dark, keys, official_color_label="진한 흑갈색"))
            self.assertEqual(resp.status_code, 200, resp.text)
            rec = resp.json()["claim_fact_validation"]
            self.assertEqual((rec["official_color_label"], rec["target_color_accurate"]), ("진한 흑갈색", "yes"))
            self.assertEqual(rec["claim_snapshot"]["target_color_match"], "NEEDS_HUMAN_EQUIVALENCE")
            orange = self._claim(TEMPLATE, "U003-C12")
            resp = self._post(self._body(TEMPLATE, orange, ["html:ratio:orange"], official_color_label="오렌지 레드"))
            self.assertEqual(resp.status_code, 200, resp.text)

    def test_sequential_step_keeps_parent_context(self) -> None:
        step = self._claim(SEQUENTIAL, "U036-C02")
        with patch.dict(os.environ, self._WRITE_ENV):
            resp = self._post(self._body(SEQUENTIAL, step, ["opc:standard:red-single"]))
            self.assertEqual(resp.json()["detail"], {"code": "FACT_VALIDATION_SOURCE_MISSING", "detail": {"missing_aspects": ["sequence"]}})
            resp = self._post(self._body(SEQUENTIAL, step, ["opc:standard:sequential"]))
            self.assertEqual(resp.status_code, 200, resp.text)
            self.assertEqual(resp.json()["claim_fact_validation"]["claim_snapshot"]["inherited_context"]["order"], ["레드 헤나", "브라운 헤나"])

    def test_concurrent_and_duplicate_submissions(self) -> None:
        view = self._claim(TEMPLATE, "U003-C09")
        with patch.dict(os.environ, self._WRITE_ENV):
            first = self._body(TEMPLATE, view, ["html:ratio:red_brown"])
            second = self._body(TEMPLATE, view, [], status="HOLD", hold_reason="OTHER")
            self.assertEqual(self._post(first).status_code, 200)
            resp = self._post(second)  # same view (ROOT) after another admin stored the first record
            self.assertEqual((resp.status_code, self._code(resp)), (409, "CLAIM_STALE_VIEW"))
            replay = self._post(first)
            self.assertEqual((replay.status_code, replay.json()["duplicate"]), (200, True))
            reused = self._post({**first, "note": "다른 내용으로 같은 요청 재사용"})
            self.assertEqual(self._code(reused), "CLAIM_REQUEST_ID_REUSED")
            latest = self._claim(TEMPLATE, "U003-C09")
            followup = self._body(TEMPLATE, latest, [], status="HOLD", hold_reason="OTHER")
            stale = self._body(TEMPLATE, latest, [], status="REJECTED")
            self.assertEqual(self._post(followup).status_code, 200)
            self.assertEqual(self._code(self._post(stale)), "CLAIM_STALE_VIEW")
        with SessionLocal() as db:
            rows = db.query(ReviewReplyKnowledgeClaimFactValidation).filter_by(claim_key=view["claim_key"]).all()
            self.assertEqual(len(rows), 2)
            first_row = next(r for r in rows if r.supersedes_record_id == "ROOT")
            for supersedes in ("ROOT", first_row.claim_validation_id):  # storage-level chain uniqueness, first and follow-up
                dup = ReviewReplyKnowledgeClaimFactValidation(**{
                    c.name: getattr(first_row, c.name) for c in ReviewReplyKnowledgeClaimFactValidation.__table__.columns
                } | {"claim_validation_id": f"dup-{supersedes[:8]}", "request_id": f"dup-req-{supersedes[:8]}", "supersedes_record_id": supersedes})
                db.add(dup)
                with self.assertRaises(IntegrityError):
                    db.commit()
                db.rollback()
        self.assertEqual(self._claim(TEMPLATE, "U003-C09")["factValidation"]["status"], "HOLD")

    def test_parent_unit_verified_is_blocked_while_any_claim_is_unverified(self) -> None:
        parent_key = self._claims(TEMPLATE)["parents"][0]["parent_unit_key"]
        with patch.dict(os.environ, self._WRITE_ENV):
            for label, keys in (("U003-C06", ["html:ratio:natural_brown"]), ("U003-C09", ["html:ratio:red_brown"])):
                self.assertEqual(self._post(self._body(TEMPLATE, self._claim(TEMPLATE, label), keys)).status_code, 200)
            resp = self._unit_post(TEMPLATE, parent_key, ["html:ratio:natural_brown"])
            self.assertEqual((resp.status_code, self._code(resp)), (409, "UNIT_HAS_UNVERIFIED_CLAIMS"))
            detail = resp.json()["detail"]["detail"]
            self.assertEqual((detail["claim_count"], detail["verified_claim_count"]), (13, 2))
            self.assertIn("PENDING", detail["unverified_by_analysis_class"])
            self.assertEqual(self._unit_post(TEMPLATE, parent_key, [], status="HOLD").status_code, 200)
            a_unit = next(u for u in self._corpus()["items"] if u["knowledge_id"] == A_CLASS)
            a_key = next(u["factValidation"]["unitKey"] for u in a_unit["knowhow_items"] if u.get("factValidation"))
            resp = self._unit_post(A_CLASS, a_key, ["html:duration:pack"])
            self.assertEqual(resp.status_code, 200, resp.text)
            with patch.object(claims_module, "_ARTIFACT_CACHE", {"artifact": claims_module.load_claim_artifact(Path("/nonexistent.json"))}):
                resp = self._unit_post(A_CLASS, a_key, ["html:duration:pack"])
                self.assertEqual(self._code(resp), "CLAIM_DECOMPOSITION_UNAVAILABLE")
                resp = self._post({"knowledge_id": TEMPLATE, "claim_key": "rcl:any", "fact_status": "HOLD", "note": "자료 없음 확인",
                                   "request_id": "clt-unavailable-1", "supersedes_record_id": "ROOT"})
                self.assertEqual((resp.status_code, self._code(resp)), (503, "CLAIM_DECOMPOSITION_UNAVAILABLE"))
        self.assertEqual(self._claims(TEMPLATE)["parents"][0]["verified_claim_count"], 2)
        with SessionLocal() as db:
            units = db.query(ReviewReplyKnowledgeUnitFactValidation).all()
            self.assertEqual(sorted(u.fact_status for u in units), ["HOLD", "VERIFIED"])
            self.assertEqual({u.knowledge_id for u in units if u.fact_status == "VERIFIED"}, {A_CLASS})

    def test_gate_b_revocation_and_reply_change_withdraw_claim_use(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            dark = self._claim(TEMPLATE, "U003-C04")
            body = self._body(TEMPLATE, dark, ["opc:standard:sequential", "html:sequence:dark_brown"], official_color_label="진한 흑갈색")
            self.assertEqual(self._post(body).status_code, 200)
            self.assertEqual(self._claim(TEMPLATE, "U003-C04")["factValidation"]["status"], "VERIFIED")
            self.gate_b.extend(_records([(HTML, "html:sequence:dark_brown")], decision="REVOKED", start=50))
            self._reset_cache()
            fv = self._claim(TEMPLATE, "U003-C04")["factValidation"]
            self.assertEqual((fv["status"], fv["resolution"], fv["changedEvidenceEntries"]), ("PENDING", "OFFICIAL_SOURCE_CHANGED", ["html:sequence:dark_brown"]))
            with SessionLocal() as db:
                db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:4875000316").update(
                    {"reply_text": REPLIES["4875000316"][1].replace("진한갈색", "진한 갈색")})
                db.commit()
            self._reset_cache()
            view = self._claims(TEMPLATE)
            claim = next(c for c in view["parents"][0]["claims"] if c["analysis_label"] == "U003-C06")
            self.assertEqual((claim["integrity"], claim["verifiable"]), ("REPLY_CHANGED", False))
            resp = self._post(self._body(TEMPLATE, claim, ["html:ratio:natural_brown"]))
            self.assertEqual(self._code(resp), "CLAIM_NOT_CURRENT")
            corpus = self._corpus()
            item = next(x for x in corpus["items"] if x["knowledge_id"] == TEMPLATE)
            new_unit = max((u for u in item["knowhow_items"] if u.get("factValidation")), key=lambda u: len(u["originalText"]))
            resp = self._unit_post(TEMPLATE, new_unit["factValidation"]["unitKey"], ["html:ratio:natural_brown"])
            self.assertEqual(self._code(resp), "UNIT_HAS_UNVERIFIED_CLAIMS")

    def test_claim_writes_leave_units_d1_and_replies_unchanged(self) -> None:
        with patch.dict(os.environ, self._WRITE_ENV):
            for label, keys in (("U003-C06", ["html:ratio:natural_brown"]), ("U003-C13", ["html:caution:current-color"])):
                resp = self._post(self._body(TEMPLATE, self._claim(TEMPLATE, label), keys))
                self.assertEqual(resp.status_code, 200, resp.text)
                self.assertTrue(resp.json()["parent_unit_unchanged"])
        with SessionLocal() as db:
            self.assertEqual(db.query(ReviewReplyKnowledgeUnitFactValidation).count(), 0)
            self.assertEqual(db.query(ReviewReplyKnowledgeValidation).count(), 0)
            self.assertEqual(db.query(NaverReviewReplyRaw).filter_by(review_key="naver_review:4875000316").one().reply_text, REPLIES["4875000316"][1])
        parent = self._claims(TEMPLATE)["parents"][0]
        self.assertEqual((parent["verified_claim_count"], parent["unit_verified_blocked"]), (2, True))
        corpus = self._corpus()
        unit = next(u for x in corpus["items"] if x["knowledge_id"] == TEMPLATE for u in x["knowhow_items"]
                    if (u.get("factValidation") or {}).get("unitKey") == parent["parent_unit_key"])
        self.assertEqual(unit["factValidation"]["status"], "PENDING")
        self.assertFalse(unit["generatorFactEligible"])


if __name__ == "__main__":
    unittest.main()
