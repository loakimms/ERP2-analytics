import copy
import inspect
import json
import os
import tempfile
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import content_shorts as cs
import content_shorts_audio as audio
import content_shorts_claims as cc
import content_shorts_narration_fit as nf
from db import ContentArtifact, ContentReviewEvent, ContentSkuAsset
from test_content_shorts_audio import _Providers

SKU = "S1"


def _entry(ref, authority, text, **extra):
    return {"ref": ref, "authority": authority, "sourceType": "review" if authority == cc.CUSTOMER_REVIEW else "product_info", "text": text, **extra}


def _snapshot():
    entries = [
        _entry("EV-a", cc.CUSTOMER_REVIEW, "헤나하고 마음에 들어서 머릿결 관리도 함께하려고 헤어팩을 골랐어요", reviewEvidenceKind="INDIVIDUAL_REVIEW", riskFlags=[], usagePolicy="INDIVIDUAL_EXPERIENCE_ONLY"),
        _entry("EV-b", cc.CUSTOMER_REVIEW, "좋아요 푸석푸석한 머리에 윤기가 다시 나기 시작했어요", reviewEvidenceKind="INDIVIDUAL_REVIEW", riskFlags=[], usagePolicy="INDIVIDUAL_EXPERIENCE_ONLY"),
        _entry("EV-c", cc.CUSTOMER_REVIEW, "파마로 상한 머리에 수자타헤어팩 사용 후 많이 부드러워져 만족", reviewEvidenceKind="INDIVIDUAL_REVIEW", riskFlags=[], usagePolicy="INDIVIDUAL_EXPERIENCE_ONLY"),
        _entry("EV-hair", cc.CUSTOMER_REVIEW, "탈모가 심했는데 머릿결 관리도 함께 되고 덜 빠져요", reviewEvidenceKind="INDIVIDUAL_REVIEW", riskFlags=["EFFICACY_SENSITIVE_REVIEW"], usagePolicy="HUMAN_REVIEW_ONLY"),
        _entry(f"PI:{SKU}:0:product_name", cc.PRODUCT_AUTHORITY, "수자타두피케어헤어팩"),
        _entry(f"PI:{SKU}:1:product_name", cc.PRODUCT_AUTHORITY, "딥클린"),
    ]
    return {
        "contractVersion": cc.CLAIM_CONTRACT_VERSION,
        "evidenceSnapshotVersion": cc.SNAPSHOT_VERSION,
        "snapshotAuthority": cc.SNAPSHOT_AUTHORITY,
        "snapshotSha256": "parent-snapshot-sha",
        "allowedEvidenceCatalog": {"catalogAuthority": cc.SNAPSHOT_AUTHORITY, "entries": {e["ref"]: e for e in entries}},
    }


def _c(cid, ctype, field, text, refs=(), anchors=(), kind=None):
    claim = {"claimId": cid, "claimType": ctype, "field": field, "claimText": text, "canonicalStatement": "", "anchorTerms": list(anchors), "evidenceRefs": list(refs)}
    if kind:
        claim["experienceKind"] = kind
    return claim


def _scene(order, stage, sec, vo, sub, claims):
    return {
        "order": order, "stage": stage, "duration_sec": sec, "voice_over": vo, "spoken_script": vo, "subtitle": sub, "caption": sub,
        "visual_prompt": f"연출 {order}", "visual_direction": f"연출 {order}", "transition": "cut", "cta": "",
        "visual_asset": {"assetId": f"img-{order}", "url": f"/content/images/s{order}.png", "source": "AI_GENERATED", "generatedFromPromptHash": cs.visual_prompt_hash(f"연출 {order}"), "contract": cs.SHORTS_SCENE_VISUAL_CONTRACT},
        "claims": claims,
    }


def _scenes():
    pi0, pi1 = f"PI:{SKU}:0:product_name", f"PI:{SKU}:1:product_name"
    return [
        _scene(1, "HOOK", 3, "염색 후 머릿결, 괜히 더 신경 쓰였나요?", "염색 후 머릿결 고민", [
            _c("SC1-CLM1", "EDITORIAL_BRIDGE", "voice_over", "염색 후 머릿결,"),
            _c("SC1-CLM2", "EDITORIAL_BRIDGE", "voice_over", "괜히 더 신경 쓰였나요?"),
            _c("SC1-CLM3", "EDITORIAL_BRIDGE", "subtitle", "염색 후 머릿결 고민"),
        ]),
        _scene(2, "BEFORE", 5, "한 후기는 헤나하고 마음에 들어서 머릿결 관리도 함께하려고 헤어팩을 골랐대요.", "한 후기: 머릿결 관리도 함께", [
            _c("SC2-CLM1", "CUSTOMER_EXPERIENCE", "voice_over", "한 후기는 헤나하고 마음에 들어서 머릿결 관리도 함께하려고 헤어팩을 골랐대요.", ["EV-a"], ["머릿결 관리도 함께"], "PROBLEM_STATE"),
            _c("SC2-CLM2", "CUSTOMER_EXPERIENCE", "subtitle", "한 후기: 머릿결 관리도 함께", ["EV-a"], ["머릿결 관리도 함께"], "PROBLEM_STATE"),
        ]),
        _scene(3, "EXPERIENCE", 6, "또 한 후기는 푸석푸석한 머리에 윤기가 다시 나기 시작했다고 해요.", "한 후기: 윤기가 다시 나기 시작", [
            _c("SC3-CLM1", "CUSTOMER_EXPERIENCE", "voice_over", "또 한 후기는 푸석푸석한 머리에 윤기가 다시 나기 시작했다고 해요.", ["EV-b"], ["윤기가 다시 나기 시작"], "PRODUCT_OUTCOME"),
            _c("SC3-CLM2", "CUSTOMER_EXPERIENCE", "subtitle", "한 후기: 윤기가 다시 나기 시작", ["EV-b"], ["윤기가 다시 나기 시작"], "PRODUCT_OUTCOME"),
        ]),
        _scene(4, "PROOF", 6, "파마로 상한 머리에 수자타헤어팩 사용 후 많이 부드러워져 만족했다는 후기도 있어요.", "한 후기: 많이 부드러워져 만족", [
            _c("SC4-CLM1", "CUSTOMER_EXPERIENCE", "voice_over", "파마로 상한 머리에 수자타헤어팩 사용 후 많이 부드러워져 만족했다는 후기도 있어요.", ["EV-c"], ["많이 부드러워져 만족"], "PRODUCT_OUTCOME"),
            _c("SC4-CLM2", "CUSTOMER_EXPERIENCE", "subtitle", "한 후기: 많이 부드러워져 만족", ["EV-c"], ["많이 부드러워져 만족"], "PRODUCT_OUTCOME"),
        ]),
        _scene(5, "PRODUCT", 7, "수자타두피케어헤어팩부터 딥클린까지 고를 수 있어요.", "두피케어·딥클린", [
            _c("SC5-CLM1", "PRODUCT_FACT", "voice_over", "수자타두피케어헤어팩부터 딥클린까지", [pi0, pi1], ["수자타두피케어헤어팩", "딥클린"]),
            _c("SC5-CLM2", "EDITORIAL_BRIDGE", "voice_over", "고를 수 있어요."),
            _c("SC5-CLM3", "PRODUCT_FACT", "subtitle", "두피케어·딥클린", [pi1], ["딥클린"]),
        ]),
        _scene(6, "CTA", 3, "염색 후 관리가 필요했다면, 지금 상세에서 확인해보세요.", "지금 상세에서 확인해보세요", [
            _c("SC6-CLM1", "EDITORIAL_BRIDGE", "voice_over", "염색 후 관리가 필요했다면,"),
            _c("SC6-CLM2", "EDITORIAL_BRIDGE", "voice_over", "지금 상세에서 확인해보세요."),
            _c("SC6-CLM3", "EDITORIAL_BRIDGE", "subtitle", "지금 상세에서 확인해보세요"),
        ]),
    ]


def _config():
    raw = {"mode": "CUSTOM", "duration": 30, "storyType": "REAL_REVIEW", "voice": {"voiceId": "VOICE_F_BRIGHT"}, "narrationTone": "REVIEW", "music": {"mood": "CALM"}}
    return cs.resolve_shorts_config(raw, hint={}, music_library=[])


def _body():
    scenes = _scenes()
    return {"shorts": {"scenes": scenes, "estimated_duration": 30}, "scenes": scenes, "shorts_generation_config": _config(), "shorts_grounding": _snapshot(), "export_text": "x"}


def _out(order, text, claims, **extra):
    return {"order": order, "proposedNarration": text, "claims": [{"claimId": cid, "claimText": t} for cid, t in claims], "editorialPurpose": "유지", **extra}


def _good_output():
    return {"scenes": [
        _out(1, "염색 후 머릿결, 신경 쓰였나요?", [("SC1-CLM1", "염색 후 머릿결,"), ("SC1-CLM2", "신경 쓰였나요?")]),
        _out(2, "한 후기는 머릿결 관리도 함께하려고 골랐대요.", [("SC2-CLM1", "한 후기는 머릿결 관리도 함께하려고 골랐대요.")]),
        _out(3, "다른 후기는 푸석한 머리에 윤기가 다시 나기 시작했대요.", [("SC3-CLM1", "다른 후기는 푸석한 머리에 윤기가 다시 나기 시작했대요.")]),
        _out(4, "수자타헤어팩 사용 후 많이 부드러워져 만족했다는 후기도 있어요.", [("SC4-CLM1", "수자타헤어팩 사용 후 많이 부드러워져 만족했다는 후기도 있어요.")]),
        _out(5, "수자타두피케어헤어팩부터 딥클린까지 있어요.", [("SC5-CLM1", "수자타두피케어헤어팩부터 딥클린까지"), ("SC5-CLM2", "있어요.")]),
        _out(6, "지금 상세에서 확인해보세요.", [("SC6-CLM2", "지금 상세에서 확인해보세요.")]),
    ]}


def _with(output, order, scene):
    out = copy.deepcopy(output)
    out["scenes"][order - 1] = scene
    return out


def _build(body, output):
    return nf.build_proposal(body, output, proposal_id="NFP-test", created_at="2026-10-06T00:00:00+00:00", compliance={"allowed": True})


class NarrationFitProposalTest(unittest.TestCase):
    def setUp(self):
        self.body = _body()

    def test_source_fixture_is_ready(self):
        self.assertEqual(nf.source_readiness(self.body)["readiness"], "NARRATION_FIT_READY")

    def test_good_proposal_is_ready(self):
        p = _build(self.body, _good_output())
        self.assertEqual((p["status"], p["holdReasons"]), ("PROPOSAL_READY", []))
        self.assertLess(p["totals"]["proposedEstimatedMs"], p["totals"]["originalEstimatedMs"])
        self.assertLessEqual(p["totals"]["proposedEstimatedMs"], 30000)
        self.assertEqual(p["claimComparison"]["new"], 0)
        self.assertEqual(p["marketingRoles"]["lost"], [])
        self.assertEqual(p["marketingRoles"]["notInOriginal"], ["INFORMATIVE_VALUE"])
        self.assertEqual(p["semanticValidation"]["readiness"], "NARRATION_FIT_READY")

    def test_a_new_claim_is_hold(self):
        out = _with(_good_output(), 5, _out(5, "수자타두피케어헤어팩부터 딥클린까지 있어요.", [("SC5-CLM1", "수자타두피케어헤어팩부터 딥클린까지"), ("SC5-CLM9", "있어요.")]))
        p = _build(self.body, out)
        self.assertEqual(p["status"], "HOLD_NARRATION_FIT_PROPOSAL")
        self.assertIn("NEW_CLAIM_INTRODUCED", p["holdReasons"])
        self.assertEqual(p["claimComparison"]["newClaimIds"], ["SC5-CLM9"])
        cross = _with(_good_output(), 6, _out(6, "지금 상세에서 확인해보세요.", [("SC5-CLM2", "지금 상세에서 확인해보세요.")]))
        self.assertIn("NEW_CLAIM_INTRODUCED", _build(self.body, cross)["holdReasons"])

    def test_b_removed_claim_is_allowed_and_reported(self):
        p = _build(self.body, _good_output())
        self.assertEqual(p["status"], "PROPOSAL_READY")
        self.assertEqual(p["claimComparison"]["removedClaimIds"], ["SC6-CLM1"])
        cta = p["scenes"][5]
        self.assertEqual((cta["claimIdsRemoved"], cta["removedClaims"][0]["claimText"]), (["SC6-CLM1"], "염색 후 관리가 필요했다면,"))

    def test_c_attribution_removed_is_hold(self):
        out = _with(_good_output(), 3, _out(3, "푸석한 머리에 윤기가 다시 나기 시작했대요.", [("SC3-CLM1", "푸석한 머리에 윤기가 다시 나기 시작했대요.")]))
        self.assertIn("ATTRIBUTION_MISSING", _build(self.body, out)["holdReasons"])

    def test_d_generalization_is_hold(self):
        text = "많은 후기에서 수자타헤어팩 사용 후 많이 부드러워져 만족했대요."
        p = _build(self.body, _with(_good_output(), 4, _out(4, text, [("SC4-CLM1", text)])))
        self.assertIn("REVIEW_GENERALIZATION_OVERREACH", p["holdReasons"])

    def test_e_efficacy_sensitive_source_is_hold(self):
        body = _body()
        sub = body["shorts"]["scenes"][1]["claims"][1]
        sub["evidenceRefs"] = ["EV-hair"]
        body["shorts_claim_reviews"] = [{"claimId": "SC2-CLM2", "decision": "ALLOW_AS_WRITTEN", "claimTextSha256": cc.claim_text_sha256(sub["claimText"])}]
        self.assertEqual(nf.source_readiness(body)["readiness"], "NARRATION_FIT_READY")
        self.assertEqual(_build(body, _good_output())["status"], "PROPOSAL_READY")
        text = "한 후기는 머릿결 관리도 함께 신경 썼대요."
        p = _build(body, _with(_good_output(), 2, _out(2, text, [("SC2-CLM2", text)])))
        self.assertIn("EFFICACY_SENSITIVE_REVIEW_REQUIRED", p["holdReasons"])
        strengthened = "한 후기는 탈모 걱정에 머릿결 관리도 함께하려고 골랐대요."
        p2 = _build(self.body, _with(_good_output(), 2, _out(2, strengthened, [("SC2-CLM1", strengthened)])))
        self.assertIn("RESTRICTED_PATTERN_ADDED", p2["holdReasons"])

    def test_f_product_claim_authority_preserved(self):
        p = _build(self.body, _good_output())
        claim = next(c for c in p["semanticValidation"]["claims"] if c["claimId"] == "SC5-CLM1" and c["field"] == "voice_over")
        self.assertEqual(claim["groundingStatus"], "GROUNDED")
        ledger = next(c for c in p["scenes"][4]["claims"] if c["claimId"] == "SC5-CLM1")
        self.assertEqual(ledger["evidenceRefs"], [f"PI:{SKU}:0:product_name", f"PI:{SKU}:1:product_name"])
        dropped_anchor = _with(_good_output(), 5, _out(5, "수자타두피케어헤어팩도 있어요.", [("SC5-CLM1", "수자타두피케어헤어팩도"), ("SC5-CLM2", "있어요.")]))
        self.assertIn("PRESERVED_CLAIM_ANCHOR_MISSING", _build(self.body, dropped_anchor)["holdReasons"])

    def test_g_marketing_role_lost_is_hold(self):
        p = _build(self.body, _with(_good_output(), 5, _out(5, "고를 수 있어요.", [("SC5-CLM2", "고를 수 있어요.")])))
        self.assertIn("MARKETING_ROLE_LOST", p["holdReasons"])
        self.assertEqual(p["marketingRoles"]["lost"], ["PRODUCT_VALUE"])
        empty_cta = _with(_good_output(), 6, _out(6, "", []))
        self.assertTrue({"MARKETING_ROLE_LOST", "NARRATION_EMPTY"} <= set(_build(self.body, empty_cta)["holdReasons"]))

    def test_uncovered_text_and_timing_guards(self):
        text = "한 후기는 머릿결 관리도 함께하려고 골랐대요. 천연 성분이라 순해요."
        p = _build(self.body, _with(_good_output(), 2, _out(2, text, [("SC2-CLM1", "한 후기는 머릿결 관리도 함께하려고 골랐대요.")])))
        self.assertIn("NARRATION_TEXT_NOT_COVERED_BY_CLAIMS", p["holdReasons"])
        same = {"scenes": [_out(s["order"], s["voice_over"], [(c["claimId"], c["claimText"]) for c in s["claims"] if c["field"] == "voice_over"]) for s in _scenes()]}
        unchanged = _build(self.body, same)
        self.assertTrue({"ESTIMATED_TIMING_NOT_IMPROVED", "ESTIMATED_TOTAL_OVERFLOW"} <= set(unchanged["holdReasons"]))
        self.assertIn("COMPLIANCE_GATE_FAILED", nf.build_proposal(self.body, _good_output(), proposal_id="x", created_at="t", compliance={"allowed": False})["holdReasons"])

    def test_natural_language_qa_holds_known_failure_shapes(self):
        text4 = "한 후기는 수자타헤어팩 사용 후 많이 부드러워져 만족."
        text5 = "수자타두피케어헤어팩부터 딥클린까지"
        out = _with(_with(_good_output(), 3, _out(3, "한 후기는 푸석한 머리에 윤기가 다시 나기 시작했대요.", [("SC3-CLM1", "한 후기는 푸석한 머리에 윤기가 다시 나기 시작했대요.")])), 4, _out(4, text4, [("SC4-CLM1", text4)]))
        out = _with(out, 5, _out(5, text5, [("SC5-CLM1", text5)]))
        p = _build(self.body, out)
        codes = {(i["order"], i["code"]) for i in p["naturalLanguageQa"]["issues"]}
        self.assertEqual(codes, {(3, "NARRATION_OPENER_REPEATED"), (4, "NARRATION_OPENER_REPEATED"), (4, "NARRATION_SENTENCE_INCOMPLETE"), (5, "NARRATION_SENTENCE_INCOMPLETE")})
        self.assertEqual(p["status"], "HOLD_NARRATION_FIT_PROPOSAL")
        self.assertIn("NARRATION_SENTENCE_INCOMPLETE", p["scenes"][4]["issues"])
        good = _build(self.body, _good_output())["naturalLanguageQa"]
        self.assertEqual((good["status"], good["issueCount"]), ("PASS", 0))
        self.assertTrue(nf._sentence_complete("염색 후 머릿결 고민?"))
        self.assertTrue(nf._sentence_complete("두피케어·딥클린·볼륨업·손상케어, 네 가지가 있어요."))
        self.assertFalse(nf._sentence_complete("상세에서 확인. 지금 바로요."))

    def test_writer_declared_status_and_refs_are_ignored(self):
        out = _good_output()
        out["scenes"][4]["claims"][0].update(evidenceRefs=["EV-made-up"], groundingStatus="GROUNDED", claimType="EDITORIAL_BRIDGE")
        ledger = next(c for c in _build(self.body, out)["scenes"][4]["claims"] if c["claimId"] == "SC5-CLM1")
        self.assertEqual((ledger["claimType"], ledger["evidenceRefs"][0]), ("PRODUCT_FACT", f"PI:{SKU}:0:product_name"))

    def test_reducer_messages_carry_ledger_budget_and_no_hard_rule(self):
        msgs = nf.reducer_messages(self.body)
        payload = json.loads(msgs[1]["content"])
        self.assertEqual(payload["role"], "CONSTRAINED_NARRATION_REDUCER")
        self.assertEqual(len(payload["scenes"]), 6)
        self.assertEqual([c["claimId"] for c in payload["scenes"][4]["allowedClaims"]], ["SC5-CLM1", "SC5-CLM2", "SC5-CLM3"])
        self.assertEqual(payload["scenes"][4]["allowedClaims"][0]["evidenceAuthority"], ["PRODUCT_AUTHORITY"])
        self.assertEqual(payload["budget"]["estimatorAuthority"], "PROVISIONAL_CONSERVATIVE_ESTIMATOR")
        self.assertLess(payload["budget"]["preferredTotalSpeechChars"], payload["budget"]["hardTotalSpeechChars"])


class NarrationFitReallocationTest(unittest.TestCase):
    def _items(self, est, cur=(3, 5, 6, 6, 7, 3)):
        stages = ["HOOK", "BEFORE", "EXPERIENCE", "PROOF", "PRODUCT", "CTA"]
        return [{"order": i + 1, "stage": stages[i], "currentSec": cur[i], "estimatedMs": e} for i, e in enumerate(est)]

    def test_i_j_k_l_constraints(self):
        for est in ([4030, 7270, 6190, 7630, 6730, 5470], [3500, 4800, 5100, 6100, 5200, 3700], [2000] * 6, [9000] * 6):
            r = nf.reallocate_scene_durations(self._items(est), total_sec=30)
            alloc = r["allocationSec"]
            self.assertEqual(sum(alloc), 30)
            self.assertEqual(len(alloc), 6)
            self.assertEqual(r["constraints"]["sceneDeletion"], "NOT_ALLOWED")
            for a, cur, stage in zip(alloc, (3, 5, 6, 6, 7, 3), ["HOOK", "BEFORE", "EXPERIENCE", "PROOF", "PRODUCT", "CTA"]):
                self.assertLessEqual(abs(a - cur), 2.0)
                self.assertEqual(round(a * 2), a * 2)
                self.assertGreaterEqual(a, 3.0 if stage in ("HOOK", "CTA") else 2.5)

    def test_m_no_hard_coded_previous_allocation(self):
        fit = nf.reallocate_scene_durations(self._items([2500, 4000, 5000, 5000, 6000, 2500]), total_sec=30)
        self.assertEqual((fit["allocationSec"], fit["changedSceneOrders"], fit["status"]), ([3, 5, 6, 6, 7, 3], [], "ALL_SCENES_ESTIMATED_FIT"))
        a = nf.reallocate_scene_durations(self._items([3500, 4800, 5100, 6100, 5200, 3700]), total_sec=30)["allocationSec"]
        b = nf.reallocate_scene_durations(self._items([3200, 5900, 5100, 5100, 5200, 3200]), total_sec=30)["allocationSec"]
        self.assertNotEqual(a, b)
        source = inspect.getsource(nf)
        for literal in ("3.5, 5, 6.5", "3.5, 5.0, 6.5", "3 / 5 / 7 / 6 / 6 / 3"):
            self.assertNotIn(literal, source)


class NarrationFitLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._old_dir = os.environ.get("CONTENT_ASSET_DIR")
        os.environ["CONTENT_ASSET_DIR"] = self.tmp.name
        engine = create_engine("sqlite://")
        for model in (ContentArtifact, ContentReviewEvent, ContentSkuAsset):
            model.__table__.create(engine)
        self.db = sessionmaker(bind=engine)()
        self.providers = _Providers()
        self.providers.install()
        self.writer_calls = []
        self.output = _good_output()
        self.row = ContentArtifact(artifact_id="CT-parent", original_artifact_id="CT-parent", sku_id=SKU, appeal_id="AP-1", channel="shorts", title="t", body_json=json.dumps(_body(), ensure_ascii=False), revision_no=1, source="ai_original", reviewer_status="pending")
        self.db.add(self.row)
        self.db.commit()

    def tearDown(self):
        self.providers.restore()
        self.db.close()
        if self._old_dir is None:
            os.environ.pop("CONTENT_ASSET_DIR", None)
        else:
            os.environ["CONTENT_ASSET_DIR"] = self._old_dir
        self.tmp.cleanup()

    def _writer(self, messages):
        self.writer_calls.append(messages)
        return copy.deepcopy(self.output)

    def _propose(self):
        return nf.create_narration_fit_proposal(self.db, self.row, writer=self._writer, gate=lambda text: {"allowed": True}, actor="qa")

    def _decide(self, decision, fit=None):
        fit = fit or json.loads(self.row.body_json)[nf.FIT_KEY]
        return nf.decide_narration_fit(self.db, self.row, decision=decision, proposal_id=fit["proposal"]["proposalId"], proposal_hash=fit["proposal"]["proposalSha256"], actor="human")

    def _body(self, row=None):
        return json.loads((row or self.row).body_json)

    def test_h_original_unchanged_before_approval(self):
        before = self._body()
        fit = self._propose()
        self.assertEqual(len(self.writer_calls), 1)
        self.assertEqual((fit["proposal"]["status"], fit["humanDecision"]["status"]), ("PROPOSAL_READY", "PENDING"))
        after = self._body()
        self.assertEqual({k: v for k, v in after.items() if k != nf.FIT_KEY}, before)
        self.assertEqual(self.providers.tts, [])
        with self.assertRaisesRegex(ValueError, "narration_fit_proposal_open"):
            self._propose()
        self.assertEqual(len(self.writer_calls), 1)
        self._decide("REVISION_REQUIRED")
        self.assertEqual({k: v for k, v in self._body().items() if k != nf.FIT_KEY}, before)
        self.assertEqual(self.db.query(ContentArtifact).count(), 1)

    def test_revision_required_round_two(self):
        before = self._body()
        v1 = self._propose()["proposal"]
        instructions = {
            "general": ["자연스러운 한국어 숏츠 narration"],
            "forbidden": ["명사 나열로 종료"],
            "scenes": [{"order": 6, "verdict": "REWRITE_REQUIRED", "issues": ["CTA 맥락 삭제"], "preserve": ["염색 후 관리"], "exampleDirection": "염색 후 관리가 고민이라면 상세에서 확인해보세요."}, {"order": 99, "verdict": "bogus"}],
        }
        with self.assertRaisesRegex(ValueError, "revision_instructions_only_for_revision_required"):
            nf.decide_narration_fit(self.db, self.row, decision="REJECTED", proposal_id=v1["proposalId"], revision_instructions=instructions)
        nf.decide_narration_fit(self.db, self.row, decision="REVISION_REQUIRED", proposal_id=v1["proposalId"], actor="human", note="품질 수정", revision_instructions=instructions)
        decision = self._body()[nf.FIT_KEY]["humanDecision"]
        self.assertEqual((decision["status"], decision["reviewedProposalSha256"], decision["revisionInstructions"]["scenes"][1]["verdict"]), ("REVISION_REQUIRED", v1["proposalSha256"], "MINOR_EDIT"))

        self.output = _good_output()
        v2_fail = self._propose()["proposal"]
        self.assertEqual(len(self.writer_calls), 2)
        payload = json.loads(self.writer_calls[1][1]["content"])
        rev = payload["humanRevision"]
        self.assertEqual((rev["previousProposalId"], rev["round"]), (v1["proposalId"], 2))
        self.assertEqual(rev["scenes"][5]["previousProposedNarration"], "지금 상세에서 확인해보세요.")
        self.assertEqual((rev["scenes"][5]["verdict"], rev["scenes"][0]["verdict"]), ("REWRITE_REQUIRED", "KEEP"))
        self.assertTrue(set(nf.REVISION_RULES) <= set(payload["rules"]))
        self.assertEqual(v2_fail["status"], "HOLD_NARRATION_FIT_PROPOSAL")
        self.assertIn("HUMAN_REVISION_PRESERVE_TERM_MISSING", v2_fail["holdReasons"])
        self.assertEqual(v2_fail["revision"]["previousProposalId"], v1["proposalId"])
        fit = self._body()[nf.FIT_KEY]
        self.assertEqual([h["proposalId"] for h in fit["history"]], [v1["proposalId"]])
        self.assertEqual(fit["history"][0]["humanDecision"]["status"], "REVISION_REQUIRED")
        self.assertEqual(fit["history"][0]["scenes"][5]["proposedNarration"], "지금 상세에서 확인해보세요.")
        self.assertEqual({k: v for k, v in self._body().items() if k != nf.FIT_KEY}, before)
        self.assertEqual(self.providers.tts, [])

    def test_revision_ready_keeps_previous_hash_and_lineage(self):
        v1 = self._propose()["proposal"]
        instructions = {"scenes": [{"order": 6, "verdict": "REWRITE_REQUIRED", "preserve": ["염색 후 관리"]}]}
        nf.decide_narration_fit(self.db, self.row, decision="REVISION_REQUIRED", proposal_id=v1["proposalId"], revision_instructions=instructions)
        cta = "염색 후 관리가 필요했다면, 상세에서 확인해보세요."
        self.output = _with(_good_output(), 6, _out(6, cta, [("SC6-CLM1", "염색 후 관리가 필요했다면,"), ("SC6-CLM2", "상세에서 확인해보세요.")]))
        v2 = self._propose()["proposal"]
        self.assertEqual((v2["status"], v2["holdReasons"]), ("PROPOSAL_READY", []))
        self.assertEqual(v2["naturalLanguageQa"]["previousIssueCount"], 0)
        self.assertNotEqual(v2["proposalId"], v1["proposalId"])
        self.assertEqual(v2["proposalSha256"], nf.proposal_sha256(v2))
        self._decide("APPROVED")
        child = nf.apply_narration_fit_proposal(self.db, self.row)
        self.assertEqual(self._body(child)[nf.LINEAGE_KEY]["fitProposalId"], v2["proposalId"])

    def test_keep_instruction_compliance(self):
        v1 = self._propose()["proposal"]
        hook = "염색 후 머릿결, 신경 쓰였나요?"
        instructions = {"scenes": [
            {"order": 1, "verdict": "KEEP", "keepText": hook, "requiredClaimIds": ["SC1-CLM1", "SC1-CLM2"]},
            {"order": 3, "verdict": "KEEP"},
        ]}
        nf.decide_narration_fit(self.db, self.row, decision="REVISION_REQUIRED", proposal_id=v1["proposalId"], revision_instructions=instructions)
        changed = _with(_good_output(), 1, _out(1, "염색 후 관리 고민돼요?", [("SC1-CLM3", "염색 후 관리 고민돼요?")]))
        self.output = _with(changed, 3, _out(3, "다른 후기는 푸석한 머리에 윤기가 났대요.", [("SC3-CLM1", "다른 후기는 푸석한 머리에 윤기가 났대요.")]))
        v2 = self._propose()["proposal"]
        payload = json.loads(self.writer_calls[1][1]["content"])
        self.assertEqual((payload["humanRevision"]["scenes"][0]["keepText"], payload["humanRevision"]["scenes"][0]["requiredClaimIds"]), (hook, ["SC1-CLM1", "SC1-CLM2"]))
        self.assertIn("previousEstimatedSec", payload["humanRevision"]["scenes"][3])
        unmet = {i["order"]: i["detail"] for i in v2["naturalLanguageQa"]["issues"] if i["code"] == "HUMAN_REVISION_INSTRUCTION_NOT_SATISFIED"}
        self.assertEqual(unmet[1], {"expectedText": hook, "missingClaimIds": ["SC1-CLM1", "SC1-CLM2"]})
        self.assertEqual(unmet[3], {"expectedText": v1["scenes"][2]["proposedNarration"]})
        self.assertEqual(v2["status"], "HOLD_NARRATION_FIT_PROPOSAL")
        self.assertIn("HUMAN_REVISION_INSTRUCTION_NOT_SATISFIED", v2["holdReasons"])
        self.assertIsInstance(v2["estimatedSceneOverflowCount"], int)

    def test_keep_instruction_satisfied(self):
        v1 = self._propose()["proposal"]
        nf.decide_narration_fit(self.db, self.row, decision="REVISION_REQUIRED", proposal_id=v1["proposalId"], revision_instructions={"scenes": [{"order": 1, "verdict": "KEEP", "requiredClaimIds": ["SC1-CLM1"]}, {"order": 3, "verdict": "KEEP"}]})
        v2 = self._propose()["proposal"]
        self.assertEqual((v2["status"], v2["naturalLanguageQa"]["issues"]), ("PROPOSAL_READY", []))

    def test_n_o_pending_or_rejected_cannot_apply(self):
        self._propose()
        with self.assertRaisesRegex(ValueError, "HUMAN_DECISION_PENDING"):
            nf.apply_narration_fit_proposal(self.db, self.row)
        self._decide("REJECTED")
        with self.assertRaisesRegex(ValueError, "HUMAN_DECISION_REJECTED"):
            nf.apply_narration_fit_proposal(self.db, self.row)
        with self.assertRaisesRegex(ValueError, "narration_fit_already_decided"):
            self._decide("APPROVED")

    def test_hold_proposal_cannot_be_approved(self):
        self.output = _with(_good_output(), 5, _out(5, "고를 수 있어요.", [("SC5-CLM2", "고를 수 있어요.")]))
        fit = self._propose()
        self.assertEqual(fit["proposal"]["status"], "HOLD_NARRATION_FIT_PROPOSAL")
        with self.assertRaisesRegex(ValueError, "narration_fit_proposal_not_ready"):
            self._decide("APPROVED")
        self.output = _good_output()
        self.assertEqual(self._propose()["proposal"]["status"], "PROPOSAL_READY")
        self.assertEqual(len(self.writer_calls), 2)

    def test_p_q_approval_hash_binding(self):
        fit = self._propose()
        with self.assertRaisesRegex(ValueError, "hash_mismatch"):
            nf.decide_narration_fit(self.db, self.row, decision="APPROVED", proposal_id=fit["proposal"]["proposalId"], proposal_hash="stale")
        self._decide("APPROVED")
        self.assertEqual(nf.apply_check(self._body()), [])
        body = self._body()
        body[nf.FIT_KEY]["proposal"]["scenes"][0]["proposedNarration"] = "바뀐 문장"
        self.row.body_json = json.dumps(body, ensure_ascii=False)
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "APPROVAL_INVALIDATED_PROPOSAL_CHANGED"):
            nf.apply_narration_fit_proposal(self.db, self.row)

    def _approved_child(self):
        self._propose()
        self._decide("APPROVED")
        return nf.apply_narration_fit_proposal(self.db, self.row, actor="human")

    def test_r_s_t_u_revision(self):
        parent_scenes = copy.deepcopy(nf.shorts_scenes(self._body()))
        child = self._approved_child()
        cbody = self._body(child)
        proposal = self._body()[nf.FIT_KEY]["proposal"]
        self.assertEqual((child.parent_artifact_id, child.original_artifact_id, child.revision_no, child.revision_reason), ("CT-parent", "CT-parent", 2, "narration_fit"))
        self.assertEqual(nf.shorts_scenes(self._body()), parent_scenes)
        self.assertEqual(self._body()[nf.FIT_KEY]["applied"]["revisionArtifactId"], child.artifact_id)
        lineage = cbody[nf.LINEAGE_KEY]
        self.assertEqual((lineage["parentArtifactId"], lineage["parentSnapshotSha256"], lineage["fitProposalId"]), ("CT-parent", "parent-snapshot-sha", proposal["proposalId"]))
        self.assertEqual(cbody["shorts_grounding"]["snapshotSha256"], "parent-snapshot-sha")
        self.assertEqual(cbody["shorts_grounding"]["allowedEvidenceCatalog"], _snapshot()["allowedEvidenceCatalog"])
        scenes = nf.shorts_scenes(cbody)
        self.assertEqual([s["duration_sec"] for s in scenes], proposal["proposedSceneAllocation"])
        self.assertEqual(sum(s["duration_sec"] for s in scenes), 30)
        self.assertEqual([s["voice_over"] for s in scenes], [r["proposedNarration"] for r in proposal["scenes"]])
        self.assertEqual(cbody["scenes"], cbody["shorts"]["scenes"])
        for parent, scene in zip(parent_scenes, scenes):
            self.assertLessEqual({c["claimId"] for c in scene["claims"]}, {c["claimId"] for c in parent["claims"]})
            self.assertEqual(scene["visual_asset"], parent["visual_asset"])
        self.assertNotIn("SC6-CLM1", [c["claimId"] for c in scenes[5]["claims"]])
        self.assertEqual(cc.claim_grounding_for_scenes(scenes, cbody["shorts_grounding"])["narrationFitGate"]["readiness"], "NARRATION_FIT_READY")
        self.assertNotIn(nf.FIT_KEY, cbody)
        self.assertEqual(self.providers.tts, [])
        with self.assertRaisesRegex(ValueError, "ALREADY_APPLIED"):
            nf.apply_narration_fit_proposal(self.db, self.row)

    def test_source_change_after_proposal_blocks_apply(self):
        self._propose()
        self._decide("APPROVED")
        body = self._body()
        body["shorts"]["scenes"][0]["voice_over"] = "사람이 고친 문장"
        self.row.body_json = json.dumps(body, ensure_ascii=False)
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "SOURCE_CHANGED_SINCE_PROPOSAL"):
            nf.apply_narration_fit_proposal(self.db, self.row)

    def test_v_w_x_y_audio_after_apply(self):
        child = self._approved_child()
        cbody = self._body(child)
        config = cbody["shorts_generation_config"]
        scenes = nf.shorts_scenes(cbody)
        self.assertEqual({cs.scene_narration_state(s, config)["status"] for s in scenes}, {"PENDING_TTS"})
        key = cs.scene_narration_state(scenes[0], config)["expected"]["generationKey"]
        self.providers.tts_seconds = 2.0
        path = os.path.join(self.tmp.name, "pre.wav")
        from test_content_shorts_audio import fake_wav

        with open(path, "wb") as f:
            f.write(fake_wav(2.0, streaming_header=False))
        audio._register(self.db, asset_id="CA-pre", sku=audio.NARRATION_SKU, asset_type=audio.NARRATION_TYPE, group_key=key, category="other", keywords="scene_1", filename="pre.wav", path=path, url="/content/assets/files/pre.wav", mime="audio/wav", status="READY", meta={"generationKey": key, "durationMs": 2000, "voiceId": "VOICE_F_BRIGHT"})
        self.providers.tts_seconds = 9.0
        summary = audio.generate_artifact_narration(self.db, child)
        self.assertEqual((summary["reused"], summary["ttsCalls"], summary["generated"]), (1, 5, 5))
        self.assertEqual(len(self.providers.tts), 5)
        cbody = self._body(child)
        scenes = nf.shorts_scenes(cbody)
        entries = [cs.scene_narration_timing(s, config, s.get("duration_sec")) for s in scenes]
        self.assertEqual({e["timingAuthority"] for e in entries}, {"ACTUAL"})
        self.assertEqual(entries[0]["actualNarrationDurationMs"], 2000)
        self.assertEqual(entries[1]["timingStatus"], "OVERFLOW")
        timeline = cs.narration_timeline(entries, 30)
        self.assertEqual((timeline["totalActualTimingStatus"], timeline["automaticTimingMutation"]), ("OVERFLOW", "NONE"))
        self.assertEqual([s["voice_over"] for s in scenes], [r["proposedNarration"] for r in self._body()[nf.FIT_KEY]["proposal"]["scenes"]])
        self.assertEqual(len(self.providers.tts), 5)
        self.assertEqual(len(self.writer_calls), 1)


if __name__ == "__main__":
    unittest.main()
