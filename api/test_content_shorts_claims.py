import copy
import json
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import content_shorts_claims as cc
import content_writer_service as cws
from db import ContentProductInfo, ContentSkuAsset, ContentSkuScope


def _catalog():
    appeal = {
        "appeal_id": "AP-1",
        "label": "염색 후 관리",
        "appeal_text": "염색 후에도 이어가는 허브 팩 관리",
        "insight": {"problem": "염색 후 모발과 두피가 거칠어진다"},
        "evidence": [
            {"evidence_id": "EV-r1", "source_type": "review", "snippet": "좋아요 푸석푸석한 머리에 윤기가 다시 나기 시작했어요"},
            {"evidence_id": "EV-q1", "source_type": "qna", "snippet": "가루 팩인가요?"},
        ]
        + [{"evidence_id": f"EV-x{i}", "source_type": "review", "snippet": "기타"} for i in range(12)],
    }
    product = {"items": [{"product_name": "수자타두피케어헤어팩", "full_ingredients": "시카카이열매가루, 한련초잎가루", "ingredient_note": "천연허브6종"}]}
    category = [{"ref": "CK-1", "text": "시카카이는 전통적으로 세정에 쓰였다"}]
    return cc.build_source_catalog(appeal=appeal, product_info=product, sku_id="S1", category_knowledge=category)


def _scene(text, claims, subtitle="자막"):
    return {"order": 1, "stage": "INFO", "voice_over": text, "subtitle": subtitle, "claims": claims}


class ShortsClaimContractTest(unittest.TestCase):
    def setUp(self):
        self.cat = _catalog()

    def _one(self, scene):
        return cc.validate_scene_claims(scene, self.cat)["claims"][0]

    def test_a_valid_product_ref_is_grounded(self):
        text = "시카카이열매가루, 한련초잎가루가 들어 있어요."
        claim = {"claimType": "PRODUCT_FACT", "claimText": text, "anchorTerms": ["시카카이열매가루", "한련초잎가루"], "evidenceRefs": ["PI:S1:0:full_ingredients"]}
        r = self._one(_scene(text, [claim]))
        self.assertEqual((r["groundingStatus"], r["sourceAuthority"]), ("GROUNDED", ["PRODUCT_AUTHORITY"]))

    def test_b_unknown_ref_is_invalid(self):
        text = "천연허브6종이에요."
        r = self._one(_scene(text, [{"claimType": "PRODUCT_FACT", "claimText": text, "anchorTerms": ["천연허브6종"], "evidenceRefs": ["EV-made-up"]}]))
        self.assertEqual((r["groundingStatus"], r["reasons"]), ("INVALID_REF", ["INVALID_REF:EV-made-up"]))

    def test_c_evidence_outside_writer_catalog_is_invalid(self):
        self.assertNotIn("EV-x11", self.cat["entries"])
        self.assertIn("EV-x9", self.cat["entries"])
        text = "기타 후기"
        r = self._one(_scene(text, [{"claimType": "CUSTOMER_EXPERIENCE", "claimText": text, "anchorTerms": ["기타"], "evidenceRefs": ["EV-x11"]}]))
        self.assertEqual(r["groundingStatus"], "INVALID_REF")

    def test_d_editorial_bridge_without_refs(self):
        text = "염색 뒤, 머릿결이 낯설게 느껴지죠?"
        r = self._one(_scene(text, [{"claimType": "EDITORIAL_BRIDGE", "claimText": text}]))
        self.assertEqual(r["groundingStatus"], "EDITORIAL")
        bad = "두피 개선 효과를 느껴보세요"
        r2 = self._one(_scene(bad, [{"claimType": "EDITORIAL_BRIDGE", "claimText": bad}]))
        self.assertEqual(r2["groundingStatus"], "UNSUPPORTED")
        self.assertIn("EDITORIAL_CONTAINS_FACT_PATTERN:효과", r2["reasons"])

    def test_e_product_claim_with_category_only_is_leap(self):
        text = "시카카이가 세정에 쓰여요."
        r = self._one(_scene(text, [{"claimType": "PRODUCT_FACT", "claimText": text, "anchorTerms": ["시카카이"], "evidenceRefs": ["CK-1"]}]))
        self.assertEqual((r["groundingStatus"], r["reasons"]), ("UNSUPPORTED", ["CATEGORY_TO_PRODUCT_LEAP"]))
        text2 = "가루 팩이에요."
        r2 = self._one(_scene(text2, [{"claimType": "PRODUCT_FACT", "claimText": text2, "anchorTerms": ["가루 팩"], "evidenceRefs": ["EV-q1"]}]))
        self.assertEqual(r2["reasons"], ["CUSTOMER_TO_PRODUCT_LEAP"])
        text3 = "두피가 거칠어질 때가 있어요."
        r3 = self._one(_scene(text3, [{"claimType": "CUSTOMER_EXPERIENCE", "claimText": text3, "anchorTerms": ["두피"], "evidenceRefs": ["INS:AP-1:problem"], "experienceKind": "PROBLEM_STATE"}]))
        self.assertEqual((r3["groundingStatus"], r3["reasons"]), ("UNRESOLVED", ["DERIVED_AUTHORITY_ONLY"]))

    def test_f_customer_experience_needs_review_authority_and_attribution(self):
        text = "윤기가 다시 나기 시작"
        none = self._one(_scene(text, [{"claimType": "CUSTOMER_EXPERIENCE", "claimText": text, "anchorTerms": [text], "evidenceRefs": []}]))
        self.assertEqual((none["groundingStatus"], none["reasons"]), ("UNSUPPORTED", ["NO_AUTHORITY"]))
        unattributed = self._one(_scene(text, [{"claimType": "CUSTOMER_EXPERIENCE", "claimText": text, "anchorTerms": [text], "evidenceRefs": ["EV-r1"]}]))
        self.assertEqual((unattributed["groundingStatus"], unattributed["reasons"]), ("UNRESOLVED", ["ATTRIBUTION_MISSING"]))
        said = "고객 리뷰엔 ‘윤기가 다시 나기 시작’ 같은 사용감도 남았어요."
        ok = self._one(_scene(said, [{"claimType": "CUSTOMER_EXPERIENCE", "claimText": said, "anchorTerms": ["윤기가 다시 나기 시작"], "evidenceRefs": ["EV-r1"]}]))
        self.assertEqual(ok["groundingStatus"], "GROUNDED")
        widened = self._one(_scene(said, [{"claimType": "CUSTOMER_EXPERIENCE", "claimText": said, "anchorTerms": ["윤기가 다시 나기 시작", "탈모 감소"], "evidenceRefs": ["EV-r1"]}]))
        self.assertEqual(widened["reasons"], ["ANCHOR_NOT_IN_SOURCE:탈모 감소"])

    def test_g_subset_claim_usage_is_allowed_structure(self):
        claims = [{"claimId": "CLM-a", "anchorTerms": ["시카카이열매가루"]}, {"claimId": "CLM-b", "anchorTerms": ["천연허브6종"]}]
        r = cc.compare_claim_usage(claims, ["CLM-a", "CLM-b"], original_text="시카카이열매가루 천연허브6종", proposal_text="시카카이열매가루 등 천연허브6종")
        self.assertEqual((r["status"], r["removedClaimIds"], r["preservedAnchorsMissing"]), ("STRUCTURE_OK", [], {}))
        self.assertTrue(r["humanReviewRequired"])
        self.assertEqual(r["semanticCheck"], "NOT_PROVEN_BY_ID_SUBSET")

    def test_h_new_claim_id_is_hold(self):
        claims = [{"claimId": "CLM-a"}]
        r = cc.compare_claim_usage(claims, ["CLM-a", "CLM-z"])
        self.assertEqual((r["status"], r["issues"], r["newClaimIds"]), ("HOLD", ["NEW_CLAIM_INTRODUCED"], ["CLM-z"]))
        strengthened = cc.compare_claim_usage(claims, ["CLM-a"], original_text="부드럽다는 리뷰", proposal_text="모발 개선 효과")
        self.assertEqual(strengthened["issues"], ["RESTRICTED_PATTERN_ADDED"])

    def test_i_removed_claim_is_reported(self):
        claims = [{"claimId": "CLM-a", "anchorTerms": ["A"]}, {"claimId": "CLM-b", "anchorTerms": ["B"]}, {"claimId": "CLM-c", "anchorTerms": ["C"]}]
        r = cc.compare_claim_usage(claims, ["CLM-a", "CLM-c"], proposal_text="A C")
        self.assertEqual((r["status"], r["preservedClaimIds"], r["removedClaimIds"]), ("STRUCTURE_OK", ["CLM-a", "CLM-c"], ["CLM-b"]))
        missing = cc.compare_claim_usage(claims, ["CLM-a"], proposal_text="다른 말")
        self.assertEqual(missing["preservedAnchorsMissing"], {"CLM-a": ["A"]})

    def test_j_legacy_scenes_are_backward_compatible(self):
        legacy = [{"order": 1, "stage": "HOOK", "voice_over": "문장"}, {"order": 2, "stage": "CTA", "voice_over": "문장"}]
        r = cc.artifact_claim_grounding(legacy, None)
        self.assertEqual((r["status"], r["scenesWithClaims"], r["contentGroundingStatus"]), ("LEGACY_CLAIM_GROUNDING_MISSING", 0, "NOT_EVALUATED"))
        self.assertEqual(cc.validate_scene_claims(legacy[0], self.cat)["status"], "LEGACY_CLAIM_GROUNDING_MISSING")
        mixed = cc.artifact_claim_grounding([legacy[0], _scene("문장", [{"claimType": "EDITORIAL_BRIDGE", "claimText": "문장"}])], self.cat)
        self.assertEqual((mixed["status"], mixed["contentGroundingStatus"]), ("TRACEABILITY_INCOMPLETE", "CONTENT_GROUNDING_HOLD"))

    def test_claim_text_must_appear_in_scene_and_types_are_closed(self):
        r = self._one(_scene("다른 대사", [{"claimType": "EDITORIAL_BRIDGE", "claimText": "없는 문장"}]))
        self.assertEqual((r["groundingStatus"], r["reasons"]), ("UNRESOLVED", ["CLAIM_TEXT_NOT_IN_SCENE"]))
        r2 = self._one(_scene("문장", [{"claimType": "EFFICACY", "claimText": "문장"}]))
        self.assertEqual(r2["reasons"], ["UNKNOWN_CLAIM_TYPE"])
        self.assertEqual(cc.claim_id(1, "voice_over", "a  b"), cc.claim_id(1, "voice_over", "a b"))


def _semantic_catalog():
    def ev(ref, authority, text):
        return {"ref": ref, "authority": authority, "sourceType": "review", "text": text}

    entries = [
        ev("EV-one", cc.CUSTOMER_REVIEW, "이 제품 쓰고 나서 푸석함이 느껴졌어요"),
        ev("EV-one2", cc.CUSTOMER_REVIEW, "부드러워져서 좋았어요"),
        ev("EV-pat", cc.CUSTOMER_REVIEW_PATTERN, "구매 후기 38건 중 21건이 부드러움을 언급"),
        ev("EV-hair", cc.CUSTOMER_REVIEW, "탈모가 심했는데 머리가 덜 빠지는 것 같아요"),
        ev("EV-gen", cc.CUSTOMER_REVIEW, "향이 은은해서 좋아요"),
        ev("EV-gloss", cc.CUSTOMER_REVIEW, "윤기가 좋아짐"),
        {"ref": "CK-1", "authority": cc.CATEGORY_KNOWLEDGE, "sourceType": "category", "text": "시카카이는 세정에 쓰였다"},
    ]
    return {"catalogAuthority": cc.SNAPSHOT_AUTHORITY, "entries": {e["ref"]: e for e in entries}}


def _ce(field, text, refs, anchors, kind="PRODUCT_OUTCOME"):
    return {"claimType": "CUSTOMER_EXPERIENCE", "field": field, "claimText": text, "evidenceRefs": refs, "anchorTerms": anchors, "experienceKind": kind}


class ShortsClaimSemanticGuardrailTest(unittest.TestCase):
    def setUp(self):
        self.cat = _semantic_catalog()

    def _judge(self, scene):
        return cc.validate_scene_claims(scene, self.cat)

    def test_a_individual_review_generalized_is_overreach(self):
        text = "후기에서는 푸석함 때문에 말이 많았어요"
        r = self._judge({"order": 2, "voice_over": text, "claims": [_ce("voice_over", text, ["EV-one"], ["푸석함"], "PROBLEM_STATE")]})["claims"][0]
        self.assertEqual(r["groundingStatus"], "UNRESOLVED")
        self.assertIn("REVIEW_GENERALIZATION_OVERREACH", r["reasons"])
        self.assertTrue(r["humanReviewRequired"])
        self.assertEqual(r["reviewEvidenceKinds"], ["INDIVIDUAL_REVIEW"])

    def test_b_individual_attribution_is_allowed(self):
        text = "한 고객은 이 제품 쓰고 나서 푸석함이 느껴졌다고 했어요"
        r = self._judge({"order": 1, "voice_over": text, "claims": [_ce("voice_over", text, ["EV-one"], ["푸석함"], "PROBLEM_STATE")]})["claims"][0]
        self.assertEqual((r["groundingStatus"], r["reasons"]), ("GROUNDED", []))
        counted = "두 후기에서는 푸석함과 부드러워짐을 이야기했어요"
        r2 = self._judge({"order": 1, "voice_over": counted, "claims": [_ce("voice_over", counted, ["EV-one", "EV-one2"], ["푸석함", "부드러워"])]})["claims"][0]
        self.assertEqual(r2["groundingStatus"], "GROUNDED")

    def test_c_pattern_authority_allows_prevalence(self):
        text = "구매 후기에서 부드러움이 반복적으로 언급돼요"
        r = self._judge({"order": 1, "voice_over": text, "claims": [_ce("voice_over", text, ["EV-pat"], ["부드러움"])]})["claims"][0]
        self.assertEqual((r["groundingStatus"], r["reviewEvidenceKinds"]), ("GROUNDED", ["PATTERN"]))

    def test_d_individual_review_as_majority_is_hold(self):
        text = "대부분 고객이 부드러워져서 좋았다고 해요"
        scene = self._judge({"order": 1, "voice_over": text, "claims": [_ce("voice_over", text, ["EV-one2"], ["부드러워"])]})
        self.assertEqual(scene["status"], "GROUNDING_HOLD")
        self.assertEqual(scene["claims"][0]["semanticRisk"]["generalizationTerms"], ["대부분"])
        many = "많은 리뷰에서 부드러워져서 좋았다고 해요"
        r = self._judge({"order": 1, "voice_over": many, "claims": [_ce("voice_over", many, ["EV-one2"], ["부드러워"])]})["claims"][0]
        self.assertIn("REVIEW_GENERALIZATION_OVERREACH", r["reasons"])
        bridge = "많은 분들이 머릿결 고민을 하죠"
        b = self._judge({"order": 1, "voice_over": bridge, "claims": [{"claimType": "EDITORIAL_BRIDGE", "field": "voice_over", "claimText": bridge}]})["claims"][0]
        self.assertEqual((b["groundingStatus"], b["reasons"]), ("UNRESOLVED", ["REVIEW_GENERALIZATION_OVERREACH"]))

    def test_e_efficacy_sensitive_source_softened_claim(self):
        text = "한 후기에서는 머리가 신경 쓰였다고 했어요"
        r = self._judge({"order": 1, "voice_over": text, "claims": [_ce("voice_over", text, ["EV-hair"], ["머리"], "PROBLEM_STATE")]})["claims"][0]
        self.assertEqual(r["groundingStatus"], "UNRESOLVED")
        self.assertEqual(r["reasons"], ["EFFICACY_SENSITIVE_REVIEW_REQUIRED"])
        self.assertEqual(r["semanticRisk"]["efficacySensitiveRefs"], ["EV-hair"])
        self.assertIn("EV-hair", self.cat["entries"])

    def test_f_general_review_has_no_flag(self):
        text = "한 후기에서는 향이 은은해서 좋다고 했어요"
        r = self._judge({"order": 1, "voice_over": text, "claims": [_ce("voice_over", text, ["EV-gen"], ["향이 은은"])]})["claims"][0]
        self.assertEqual((r["groundingStatus"], r["reasons"]), ("GROUNDED", []))
        self.assertNotIn("semanticRisk", r)

    def test_g_h_field_attribution_is_independent(self):
        spoken = "고객 후기에서는 윤기가 좋아졌다고 해요"
        claims = [_ce("voice_over", spoken, ["EV-gloss"], ["윤기가 좋아"]), _ce("subtitle", "윤기가 좋아짐", ["EV-gloss"], ["윤기가 좋아짐"])]
        voice, sub = self._judge({"order": 1, "voice_over": spoken, "subtitle": "윤기가 좋아짐", "claims": claims})["claims"]
        self.assertEqual(voice["groundingStatus"], "GROUNDED")
        self.assertEqual((sub["groundingStatus"], sub["reasons"]), ("UNRESOLVED", ["ATTRIBUTION_MISSING"]))
        fixed = [claims[0], _ce("subtitle", "후기: 윤기가 좋아짐", ["EV-gloss"], ["윤기가 좋아짐"])]
        scene = self._judge({"order": 1, "voice_over": spoken, "subtitle": "후기: 윤기가 좋아짐", "claims": fixed})
        self.assertEqual(scene["status"], "PRODUCTION_ELIGIBLE")
        problem = self._judge({"order": 1, "voice_over": "푸석함이 느껴졌어요", "claims": [_ce("voice_over", "푸석함이 느껴졌어요", ["EV-one"], ["푸석함"], "PROBLEM_STATE")]})["claims"][0]
        self.assertEqual(problem["reasons"], ["ATTRIBUTION_MISSING"])

    def test_i_j_product_leaps_unchanged(self):
        text = "부드러워지는 제품이에요"
        r = self._judge({"order": 1, "voice_over": text, "claims": [{"claimType": "PRODUCT_FACT", "field": "voice_over", "claimText": text, "evidenceRefs": ["EV-pat"], "anchorTerms": ["부드러"]}]})["claims"][0]
        self.assertEqual((r["groundingStatus"], r["reasons"]), ("UNSUPPORTED", ["CUSTOMER_TO_PRODUCT_LEAP"]))
        leap = "시카카이가 세정에 쓰여요"
        r2 = self._judge({"order": 1, "voice_over": leap, "claims": [{"claimType": "PRODUCT_FACT", "field": "voice_over", "claimText": leap, "evidenceRefs": ["CK-1"], "anchorTerms": ["시카카이"]}]})
        self.assertEqual((r2["status"], r2["claims"][0]["reasons"]), ("GROUNDING_HOLD", ["CATEGORY_TO_PRODUCT_LEAP"]))

    def test_writer_declared_flags_are_ignored(self):
        text = "대부분 고객이 부드러워져서 좋았다고 해요"
        claim = {**_ce("voice_over", text, ["EV-one2"], ["부드러워"]), "groundingStatus": "GROUNDED", "reviewEvidenceKind": "AGGREGATE", "safe": True, "reasons": []}
        r = self._judge({"order": 1, "voice_over": text, "claims": [claim]})["claims"][0]
        self.assertEqual(r["reviewEvidenceKinds"], ["INDIVIDUAL_REVIEW"])
        self.assertIn("REVIEW_GENERALIZATION_OVERREACH", r["reasons"])

    def _gate(self, scenes, reviews=None):
        snapshot = {"snapshotAuthority": cc.SNAPSHOT_AUTHORITY, "allowedEvidenceCatalog": self.cat}
        return cc.claim_grounding_for_scenes(scenes, snapshot, reviews)

    def test_gate_readiness_and_human_resolution(self):
        hair = "한 후기에서는 머리가 신경 쓰였다고 했어요"
        scenes = [{"order": 1, "voice_over": hair, "claims": [_ce("voice_over", hair, ["EV-hair"], ["머리"], "PROBLEM_STATE")]}]
        held = self._gate(scenes)
        self.assertEqual(held["riskCounts"], {"ATTRIBUTION_MISSING": 0, "REVIEW_GENERALIZATION_OVERREACH": 0, "EFFICACY_SENSITIVE_REVIEW_REQUIRED": 1})
        self.assertEqual((held["narrationFitGate"]["readiness"], held["narrationFitGate"]["blockers"]), ("CONTENT_GROUNDING_HOLD", ["EFFICACY_SENSITIVE_REVIEW_UNRESOLVED"]))
        cid = held["perScene"][0]["claims"][0]["claimId"]
        allow = {"claimId": cid, "decision": "ALLOW_AS_WRITTEN", "claimTextSha256": cc.claim_text_sha256(hair)}
        resolved = self._gate(scenes, [allow])["narrationFitGate"]
        self.assertEqual((resolved["readiness"], resolved["humanResolvedClaimIds"]), ("NARRATION_FIT_READY", [cid]))
        self.assertEqual(self._gate(scenes, [{**allow, "decision": "REWRITE_REQUIRED"}])["narrationFitGate"]["readiness"], "CONTENT_GROUNDING_HOLD")
        self.assertEqual(self._gate(scenes, [{**allow, "claimTextSha256": "stale"}])["narrationFitGate"]["readiness"], "CONTENT_GROUNDING_HOLD")
        many = "대부분 고객이 부드러워져서 좋았다고 해요"
        over = [{"order": 1, "voice_over": many, "claims": [_ce("voice_over", many, ["EV-one2"], ["부드러워"])]}]
        cid2 = self._gate(over)["perScene"][0]["claims"][0]["claimId"]
        not_allowable = self._gate(over, [{"claimId": cid2, "decision": "ALLOW_AS_WRITTEN", "claimTextSha256": cc.claim_text_sha256(many)}])
        self.assertEqual(not_allowable["narrationFitGate"]["blockers"], ["REVIEW_GENERALIZATION_OVERREACH_PRESENT"])
        self.assertEqual(not_allowable["perScene"][0]["claims"][0]["reviewEvidenceKinds"], ["INDIVIDUAL_REVIEW"])
        reworded = "한 후기에서는 머리가 계속 신경 쓰였대요"
        reused = [{"order": 1, "voice_over": reworded, "subtitle": hair, "claims": [{**_ce("voice_over", reworded, ["EV-hair"], ["머리"], "PROBLEM_STATE"), "claimId": cid}, {**_ce("subtitle", hair, ["EV-hair"], ["머리"], "PROBLEM_STATE"), "claimId": cid}]}]
        gate = self._gate(reused, [allow])["narrationFitGate"]
        self.assertEqual((gate["readiness"], gate["blockers"]), ("CONTENT_GROUNDING_HOLD", ["EFFICACY_SENSITIVE_REVIEW_UNRESOLVED"]))

    def test_catalog_review_metadata_is_derived_from_source(self):
        context = {"appeal_id": "AP-1", "sku_id": "S1", "evidence": [
            {"evidence_ref": "EV-1", "source_type": "review", "snippet": "탈모가 심했는데 덜 빠져요", "reviewEvidenceKind": "AGGREGATE"},
            {"evidence_ref": "EV-2", "source_type": "review", "snippet": "향이 좋아요"},
            {"evidence_ref": "EV-3", "source_type": "review_pattern", "snippet": "부드러움 언급 21건"},
        ]}
        entries = {e["ref"]: e for e in cc.writer_source_catalog(context)}
        self.assertEqual((entries["EV-1"]["reviewEvidenceKind"], entries["EV-1"]["riskFlags"], entries["EV-1"]["usagePolicy"]), ("INDIVIDUAL_REVIEW", ["EFFICACY_SENSITIVE_REVIEW"], "HUMAN_REVIEW_ONLY"))
        self.assertEqual((entries["EV-2"]["riskFlags"], entries["EV-2"]["usagePolicy"]), ([], "INDIVIDUAL_EXPERIENCE_ONLY"))
        self.assertEqual(entries["EV-3"]["reviewEvidenceKind"], "PATTERN")
        rules = " ".join(cc.writer_claim_contract()["rules"])
        self.assertIn("HUMAN_REVIEW_ONLY", rules)
        self.assertIn("Attribution is per field", rules)


SKU = "S1"
PI_ING = f"PI:{SKU}:0:full_ingredients"


def _appeal(evidence_ids=None):
    ids = evidence_ids or [f"EV-{i:02d}" for i in range(1, 15)]
    snippets = {"EV-01": "푸석한 머리에 윤기가 다시 나기 시작했어요", "EV-02": "가루 팩이라 개어 쓰기 편해요"}
    return {
        "appeal_id": "AP-T",
        "sku_id": SKU,
        "label": "염색 후 관리",
        "appeal_text": "염색 후에도 이어가는 허브 팩 관리",
        "insight": {"problem": "염색 후 두피가 거칠어진다", "customer_language": ["푸석해요"]},
        "evidence": [{"evidence_id": ev, "source_type": "review", "source_pk": f"naver_review:{ev}", "snippet": snippets.get(ev, f"후기 {ev}"), "metric_json": None} for ev in ids],
    }


def _claim(claim_type, field, text, refs=(), anchors=(), **extra):
    return {"claimType": claim_type, "field": field, "claimText": text, "evidenceRefs": list(refs), "anchorTerms": list(anchors), **extra}


def _raw_writer_output():
    def scene(no, dur, stage, spoken, subtitle, claims):
        return {"scene_no": no, "duration": dur, "stage": stage, "visual_direction": "세로형 욕실 장면", "spoken_script": spoken, "subtitle": subtitle, "on_screen_text": subtitle, "transition": "cut", "shot_prompt": "세로형 욕실 선반 위 허브팩", "claims": claims}

    return {
        "hook": "염색 뒤 머릿결 고민",
        "scenes": [
            scene(1, 4, "hook", "염색 뒤 머릿결이 낯설게 느껴질 때가 있죠?", "염색 뒤 머릿결 고민", [
                _claim("EDITORIAL_BRIDGE", "spoken_script", "염색 뒤 머릿결이 낯설게 느껴질 때가 있죠?"),
                _claim("EDITORIAL_BRIDGE", "subtitle", "염색 뒤 머릿결 고민"),
            ]),
            scene(2, 6, "info", "수자타 두피케어헤어팩에는 시카카이열매가루가 들어 있어요.", "시카카이열매가루 함유", [
                _claim("PRODUCT_FACT", "spoken_script", "시카카이열매가루가 들어 있어요", [PI_ING], ["시카카이열매가루"], claimId="writer-made", groundingStatus="GROUNDED"),
                _claim("PRODUCT_FACT", "subtitle", "시카카이열매가루 함유", [PI_ING], ["시카카이열매가루"]),
            ]),
            scene(3, 7, "experience", "고객 리뷰에는 윤기가 다시 나기 시작했다는 후기가 있어요.", "윤기가 다시 나기 시작", [
                _claim("CUSTOMER_EXPERIENCE", "spoken_script", "고객 리뷰에는 윤기가 다시 나기 시작했다는 후기가 있어요.", ["EV-01"], ["윤기가 다시 나기 시작"], experienceKind="PRODUCT_OUTCOME"),
                _claim("CUSTOMER_EXPERIENCE", "subtitle", "윤기가 다시 나기 시작", ["EV-01"], ["윤기가 다시 나기 시작"], experienceKind="PRODUCT_OUTCOME"),
            ]),
            scene(4, 7, "product", "가루 팩이라 물에 개어 쓰는 방식이라고 해요.", "가루 팩 사용 방식", [
                _claim("PRODUCT_FACT", "spoken_script", "가루 팩이라", ["EV-02"], ["가루 팩"]),
                _claim("PRODUCT_FACT", "subtitle", "가루 팩 사용 방식", ["EV-FAKE"], ["가루 팩"]),
            ]),
            scene(5, 6, "cta", "상세페이지에서 내게 맞는 구성을 확인해보세요.", "상세에서 확인하기", [
                _claim("EDITORIAL_BRIDGE", "spoken_script", "상세페이지에서 내게 맞는 구성을 확인해보세요."),
                _claim("EDITORIAL_BRIDGE", "subtitle", "상세에서 확인하기"),
            ]),
        ],
        "cta": "상세에서 확인하기",
        "caption": "수자타 두피케어헤어팩 염색 후 관리",
    }


class ShortsClaimGenerationIntegrationTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        for model in (ContentSkuScope, ContentProductInfo, ContentSkuAsset):
            model.__table__.create(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add(ContentSkuScope(sku_id=SKU, title="수자타 두피케어 헤어팩", product_group="herb_pack"))
        self.db.add(ContentProductInfo(sku_id=SKU, product_items_json=json.dumps([{"product_name": "수자타두피케어헤어팩", "full_ingredients": "시카카이열매가루, 한련초잎가루", "ingredient_note": "천연허브6종"}], ensure_ascii=False)))
        self.db.commit()
        self.writer_contexts = []
        self.raw = _raw_writer_output()
        self._saved = (cws._writer_output, cws.claim_gate_text)

        def fake_writer(db, *, channel, context):
            self.writer_contexts.append(context)
            return copy.deepcopy(self.raw)

        cws._writer_output = fake_writer
        cws.claim_gate_text = lambda db, text: {"allowed": True}

    def tearDown(self):
        cws._writer_output, cws.claim_gate_text = self._saved
        self.db.close()

    def _generate(self, appeal=None, previous=None):
        context = cws.build_generation_context(self.db, appeal=appeal or _appeal(), channel="shorts", sku_title="수자타 두피케어 헤어팩", previous_artifact=previous)
        return context, cws.write_channel_content(self.db, context=context)

    def _scene_claims(self, payload, order):
        result = cc.claim_grounding_for_scenes(payload["shorts"]["scenes"], payload["shorts_grounding"])
        return next(r for r in result["perScene"] if r["order"] == order)["claims"]

    def test_k_evidence_id_survives_context_build(self):
        appeal = _appeal()
        ctx = cws.build_generation_context(self.db, appeal=appeal, channel="shorts", sku_title="수자타 두피케어 헤어팩")
        self.assertEqual([e["evidence_ref"] for e in ctx["evidence"]], [e["evidence_id"] for e in appeal["evidence"][:12]])
        self.assertEqual(ctx["evidence"][0]["source_id"], "naver_review:EV-01")
        self.assertIn(PI_ING, [e["ref"] for e in ctx["source_catalog"]])
        other = cws.build_generation_context(self.db, appeal=appeal, channel="instagram", sku_title="수자타 두피케어 헤어팩")
        self.assertNotIn("evidence_ref", other["evidence"][0])
        self.assertNotIn("source_catalog", other)

    def test_l_snapshot_equals_actual_writer_catalog(self):
        _, payload = self._generate()
        snap = payload["shorts_grounding"]
        sent = json.loads(cws._messages_for_channel(self.writer_contexts[0])[1]["content"])["context"]
        self.assertEqual(snap["snapshotAuthority"], "GENERATION_TIME_EVIDENCE_SNAPSHOT")
        self.assertEqual(snap["sourceContextRefs"], [e["ref"] for e in sent["source_catalog"]])
        self.assertEqual(list(snap["allowedEvidenceCatalog"]["entries"].values()), sent["source_catalog"])
        self.assertEqual(snap["writerEvidenceRefs"], [e["evidence_ref"] for e in sent["evidence"]])
        self.assertEqual(snap["writerEvidenceInputCount"], 12)
        self.assertNotIn("EV-13", snap["allowedEvidenceCatalog"]["entries"])

    def test_m_valid_writer_ref_is_persisted_and_grounded(self):
        _, payload = self._generate()
        scene2 = payload["shorts"]["scenes"][1]
        self.assertEqual([c["claimId"] for c in scene2["claims"]], ["SC2-CLM1", "SC2-CLM2"])
        self.assertEqual(scene2["claims"][0]["evidenceRefs"], [PI_ING])
        self.assertNotIn("groundingStatus", scene2["claims"][0])
        self.assertEqual([c["groundingStatus"] for c in self._scene_claims(payload, 2)], ["GROUNDED", "GROUNDED"])
        self.assertNotIn("claims", payload["export_text"])

    def test_n_o_unknown_ref_invalid_and_review_only_product_claim_unsupported(self):
        _, payload = self._generate()
        spoken, subtitle = self._scene_claims(payload, 4)
        self.assertEqual((spoken["groundingStatus"], spoken["reasons"]), ("UNSUPPORTED", ["CUSTOMER_TO_PRODUCT_LEAP"]))
        self.assertEqual((subtitle["groundingStatus"], subtitle["reasons"]), ("INVALID_REF", ["INVALID_REF:EV-FAKE"]))

    def test_p_q_experience_grounded_and_subtitle_judged_separately(self):
        _, payload = self._generate()
        spoken, subtitle = self._scene_claims(payload, 3)
        self.assertEqual(spoken["groundingStatus"], "GROUNDED")
        self.assertEqual((subtitle["field"], subtitle["groundingStatus"], subtitle["reasons"]), ("subtitle", "UNRESOLVED", ["ATTRIBUTION_MISSING"]))

    def test_r_new_artifact_is_not_legacy(self):
        _, payload = self._generate()
        snap = payload["shorts_grounding"]
        self.assertEqual(snap["validation"]["status"], "TRACEABLE")
        self.assertEqual(snap["validation"]["totals"], {"GROUNDED": 3, "EDITORIAL": 4, "UNRESOLVED": 1, "INVALID_REF": 1, "UNSUPPORTED": 1})
        self.assertEqual(snap["claimGroundingStatus"], "CONTENT_GROUNDING_HOLD")
        self.assertEqual(snap["validation"]["narrationFitGate"]["blockers"], ["INVALID_REF_PRESENT", "UNSUPPORTED_PRESENT", "ATTRIBUTION_MISSING_PRESENT"])
        self.assertEqual(snap["validation"]["narrationFitGate"]["readiness"], "CONTENT_GROUNDING_HOLD")
        self.assertEqual(snap["evidenceSnapshotVersion"], "shorts_evidence_snapshot_v2")
        review = snap["allowedEvidenceCatalog"]["entries"]["EV-01"]
        self.assertEqual((review["reviewEvidenceKind"], review["riskFlags"], review["usagePolicy"]), ("INDIVIDUAL_REVIEW", [], "INDIVIDUAL_EXPERIENCE_ONLY"))
        self.raw["scenes"][0].pop("claims")
        _, partial = self._generate()
        self.assertEqual(partial["shorts_grounding"]["validation"]["status"], "TRACEABILITY_INCOMPLETE")

    def test_s_snapshot_unchanged_after_source_mutation(self):
        appeal = _appeal()
        context, payload = self._generate(appeal)
        before = json.dumps(payload["shorts_grounding"], ensure_ascii=False, sort_keys=True)
        appeal["evidence"][0]["snippet"] = "바뀐 리뷰"
        context["source_catalog"][0]["text"] = "바뀐 리뷰"
        context["evidence"][0]["snippet"] = "바뀐 리뷰"
        row = self.db.get(ContentProductInfo, SKU)
        row.product_items_json = json.dumps([{"product_name": "다른 제품", "full_ingredients": "물"}], ensure_ascii=False)
        self.db.commit()
        self.assertEqual(json.dumps(payload["shorts_grounding"], ensure_ascii=False, sort_keys=True), before)
        spoken = self._scene_claims(payload, 3)[0]
        self.assertEqual(spoken["groundingStatus"], "GROUNDED")

    def test_t_revision_gets_its_own_snapshot(self):
        _, first = self._generate()
        first_snap = json.dumps(first["shorts_grounding"], sort_keys=True)
        rotated = ["EV-01", "EV-02"] + [f"EV-{i:02d}" for i in range(20, 30)]
        context, second = self._generate(_appeal(rotated), previous={"artifact_id": "CT-parent", "body": first})
        snap = second["shorts_grounding"]
        self.assertEqual(snap["parentArtifactId"], "CT-parent")
        self.assertEqual(snap["writerEvidenceRefs"], rotated)
        self.assertNotIn("EV-03", snap["allowedEvidenceCatalog"]["entries"])
        self.assertNotIn("shorts_grounding", context["previous_artifact"]["body"])
        self.assertEqual(json.dumps(first["shorts_grounding"], sort_keys=True), first_snap)

    def test_writer_without_claims_still_generates_and_reads_legacy(self):
        cws._writer_output = self._saved[0]
        import os

        os.environ["CONTENT_WRITER_TEST_FIXTURE"] = "1"
        try:
            _, payload = self._generate()
        finally:
            os.environ.pop("CONTENT_WRITER_TEST_FIXTURE", None)
        self.assertEqual(payload["format"], "shorts_scene_timeline_v1")
        self.assertEqual(payload["shorts_grounding"]["validation"]["status"], "LEGACY_CLAIM_GROUNDING_MISSING")
        self.assertEqual(payload["shorts_grounding"]["writerEvidenceInputCount"], 12)

    def test_runtime_judgement_uses_snapshot_only(self):
        _, payload = self._generate()
        scenes = copy.deepcopy(payload["shorts"]["scenes"])
        scenes[1]["voice_over"] = "수자타 두피케어헤어팩을 소개해요."
        edited = cc.claim_grounding_for_scenes(scenes, payload["shorts_grounding"])
        self.assertEqual(edited["perScene"][1]["claims"][0]["reasons"], ["CLAIM_TEXT_NOT_IN_SCENE"])
        missing = cc.claim_grounding_for_scenes(payload["shorts"]["scenes"], None)
        self.assertEqual(missing["catalogAuthority"], "SNAPSHOT_MISSING")
        self.assertEqual(missing["perScene"][1]["claims"][0]["groundingStatus"], "INVALID_REF")
        self.assertIn("GENERATION_EVIDENCE_SNAPSHOT_MISSING", missing["narrationFitGate"]["blockers"])
        self.assertEqual(cc.claim_grounding_for_scenes([{"order": 1, "voice_over": "x"}], None)["status"], "LEGACY_CLAIM_GROUNDING_MISSING")


if __name__ == "__main__":
    unittest.main()
