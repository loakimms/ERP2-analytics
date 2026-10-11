"""Shorts scene claim <-> source grounding contract.

A scene may carry ``claims``: factual propositions (or editorial bridges) that appear in one of its
text fields, each pointing at refs from the artifact's allowed source catalog. Grounding status is
always recomputed here from the catalog; a stored or model-declared status is never trusted.
Scenes without ``claims`` are legacy and read as LEGACY_CLAIM_GROUNDING_MISSING.
New artifacts are judged only against ``body.shorts_grounding`` (the catalog the writer actually received);
``build_source_catalog`` reconstructs from upstream and is for legacy audits only.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

CLAIM_CONTRACT_VERSION = "shorts_scene_claim_contract_v1"

CLAIM_TYPES = ("PRODUCT_FACT", "USAGE_FACT", "CATEGORY_FACT", "CUSTOMER_EXPERIENCE", "EDITORIAL_BRIDGE")
GROUNDING_STATUSES = ("GROUNDED", "EDITORIAL", "UNRESOLVED", "INVALID_REF", "UNSUPPORTED")
PRODUCTION_ALLOWED_STATUSES = ("GROUNDED", "EDITORIAL")
LEGACY_STATUS = "LEGACY_CLAIM_GROUNDING_MISSING"
CLAIM_FIELDS = ("voice_over", "subtitle", "on_screen_text", "cta")
REQUIRED_CLAIM_FIELDS = ("voice_over", "subtitle")
WRITER_FIELD_ALIASES = {"spoken_script": "voice_over", "voice_over": "voice_over", "narration": "voice_over", "subtitle": "subtitle", "on_screen_text": "on_screen_text", "cta": "cta"}
SNAPSHOT_VERSION = "shorts_evidence_snapshot_v2"
SEMANTIC_GUARDRAIL_VERSION = "shorts_claim_semantic_guardrail_v1"
SNAPSHOT_AUTHORITY = "GENERATION_TIME_EVIDENCE_SNAPSHOT"
SNAPSHOT_MISSING = "SNAPSHOT_MISSING"
MAX_CLAIMS_PER_SCENE = 12
EXPERIENCE_KINDS = ("PRODUCT_OUTCOME", "PROBLEM_STATE")

# Authority classes of catalog entries.
PRODUCT_AUTHORITY = "PRODUCT_AUTHORITY"
CATEGORY_KNOWLEDGE = "CATEGORY_KNOWLEDGE"
CUSTOMER_REVIEW = "CUSTOMER_REVIEW"
CUSTOMER_REVIEW_PATTERN = "CUSTOMER_REVIEW_PATTERN"
CUSTOMER_REVIEW_AGGREGATE = "CUSTOMER_REVIEW_AGGREGATE"
REVIEW_CLASSES = (CUSTOMER_REVIEW, CUSTOMER_REVIEW_PATTERN, CUSTOMER_REVIEW_AGGREGATE)
CUSTOMER_QUESTION = "CUSTOMER_QUESTION"
SEARCH_DEMAND = "SEARCH_DEMAND"
DERIVED_INSIGHT = "DERIVED_INSIGHT"
APPEAL_INTERPRETATION = "APPEAL_INTERPRETATION"
SOURCE_CONTENT = "SOURCE_CONTENT"
DERIVED_CLASSES = (DERIVED_INSIGHT, APPEAL_INTERPRETATION, SOURCE_CONTENT)

CLAIM_AUTHORITY = {
    "PRODUCT_FACT": (PRODUCT_AUTHORITY,),
    "USAGE_FACT": (PRODUCT_AUTHORITY,),
    "CATEGORY_FACT": (CATEGORY_KNOWLEDGE,),
    "CUSTOMER_EXPERIENCE": REVIEW_CLASSES,
}
REVIEW_EVIDENCE_KIND = {CUSTOMER_REVIEW: "INDIVIDUAL_REVIEW", CUSTOMER_REVIEW_PATTERN: "PATTERN", CUSTOMER_REVIEW_AGGREGATE: "AGGREGATE"}
EVIDENCE_SOURCE_AUTHORITY = {
    "review": CUSTOMER_REVIEW,
    "review_pattern": CUSTOMER_REVIEW_PATTERN,
    "review_aggregate": CUSTOMER_REVIEW_AGGREGATE,
    "qna": CUSTOMER_QUESTION,
    "ad_searchword": SEARCH_DEMAND,
}
# Writer receives the first 12 appeal evidence rows (content_writer_service.build_generation_context).
WRITER_EVIDENCE_LIMIT = 12

ATTRIBUTION_MARKERS = ("리뷰", "후기", "고객", "사용자", "구매자")
RESTRICTED_PATTERNS = ("효과", "개선", "치료", "완화", "예방", "회복", "재생", "탈모", "보장", "임상", "인증", "100%", "즉시", "완벽")
# Prevalence / frequency wording. An individual review never supports these; exact counts ("두 리뷰에서는") are not listed.
GENERALIZATION_PATTERNS = (
    "많았", "많은 고객", "많은 분", "많은 리뷰", "많은 후기", "많은 사람", "많이들", "대부분", "대체로", "자주", "반복적으로", "반복해서",
    "여러 고객", "여러 후기", "여러 리뷰", "후기에서 많이", "평이 많", "말이 많", "다들", "흔히", "공통적으로", "하나같이", "입을 모아", "많이 언급",
)
# Review text with efficacy / hair-loss meaning. Matched on whitespace-free text.
EFFICACY_SENSITIVE_PATTERNS = (
    "탈모", "발모", "치료", "개선", "완화", "재생", "질환", "효능",
    "머리가빠", "머리빠", "머리카락이빠", "모발이빠", "머리가많이빠", "덜빠", "빠짐감소", "빠짐이줄",
)
SEMANTIC_REASONS = ("ATTRIBUTION_MISSING", "REVIEW_GENERALIZATION_OVERREACH", "EFFICACY_SENSITIVE_REVIEW_REQUIRED")
HUMAN_DECISIONS = ("ALLOW_AS_WRITTEN", "REWRITE_REQUIRED", "REMOVE_CLAIM")
# Only these reasons may be cleared by ALLOW_AS_WRITTEN; attribution and generalization must be rewritten.
HUMAN_ALLOWABLE_REASONS = ("EFFICACY_SENSITIVE_REVIEW_REQUIRED", "DERIVED_AUTHORITY_ONLY")


def efficacy_risk_flags(text: Any) -> list[str]:
    squashed = re.sub(r"\s+", "", str(text or ""))
    return ["EFFICACY_SENSITIVE_REVIEW"] if any(p in squashed for p in EFFICACY_SENSITIVE_PATTERNS) else []


def review_evidence_kind(entry: dict[str, Any]) -> str | None:
    return REVIEW_EVIDENCE_KIND.get(str(entry.get("authority") or ""))


def _review_semantic_risks(field_text: str, review_entries: list[dict[str, Any]]) -> tuple[list[str], dict[str, Any]]:
    """Known high-risk transformations of review evidence. Detection only; it never proves semantic equality."""
    reasons: list[str] = []
    detail: dict[str, Any] = {}
    kinds = {review_evidence_kind(e) for e in review_entries}
    if not kinds & {"PATTERN", "AGGREGATE"}:
        source = " ".join(_squash(e.get("text")) for e in review_entries)
        hits = [p for p in GENERALIZATION_PATTERNS if _squash(p) in _squash(field_text) and _squash(p) not in source]
        if hits:
            reasons.append("REVIEW_GENERALIZATION_OVERREACH")
            detail["generalizationTerms"] = hits
    sensitive = [e["ref"] for e in review_entries if efficacy_risk_flags(e.get("text"))]
    if sensitive:
        reasons.append("EFFICACY_SENSITIVE_REVIEW_REQUIRED")
        detail["efficacySensitiveRefs"] = sensitive
    return reasons, detail


def _norm(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _squash(text: Any) -> str:
    return re.sub(r"\s+", "", str(text or ""))


def claim_id(scene_order: Any, field: str, claim_text: str) -> str:
    raw = f"{scene_order}|{field}|{_norm(claim_text)}"
    return "CLM-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10]


# ------------------------------------------------------------------ catalog

def build_source_catalog(
    *,
    appeal: dict[str, Any] | None,
    product_info: dict[str, Any] | None,
    sku_id: str = "",
    detail_pages: list[dict[str, Any]] | None = None,
    category_knowledge: list[dict[str, Any]] | None = None,
    evidence_limit: int = WRITER_EVIDENCE_LIMIT,
    catalog_authority: str = "GENERATION_SNAPSHOT",
) -> dict[str, Any]:
    """Allowed refs = exactly what the writer could see for this artifact."""
    entries: dict[str, dict[str, Any]] = {}
    appeal0 = appeal if isinstance(appeal, dict) else {}
    evidence = [e for e in (appeal0.get("evidence") or []) if isinstance(e, dict)][: max(0, int(evidence_limit))]
    for e in evidence:
        ref = _norm(e.get("evidence_id"))
        if not ref or e.get("is_excluded"):
            continue
        source_type = _norm(e.get("source_type")).lower()
        entries[ref] = {"ref": ref, "authority": EVIDENCE_SOURCE_AUTHORITY.get(source_type, "OTHER_EVIDENCE"), "sourceType": source_type, "sourcePk": e.get("source_pk"), "text": _norm(e.get("snippet"))}
    appeal_id = _norm(appeal0.get("appeal_id"))
    if appeal_id:
        for field in ("label", "appeal_text"):
            if _norm(appeal0.get(field)):
                entries[f"AP:{appeal_id}:{field}"] = {"ref": f"AP:{appeal_id}:{field}", "authority": APPEAL_INTERPRETATION, "sourceType": "appeal", "claimClass": appeal0.get("claim_class"), "text": _norm(appeal0.get(field))}
        insight = appeal0.get("insight") if isinstance(appeal0.get("insight"), dict) else {}
        for field in ("problem", "desire", "barrier", "motivation", "usage_situation"):
            if _norm(insight.get(field)):
                ref = f"INS:{appeal_id}:{field}"
                entries[ref] = {"ref": ref, "authority": DERIVED_INSIGHT, "sourceType": "insight", "text": _norm(insight.get(field))}
    info = product_info if isinstance(product_info, dict) else {}
    for idx, item in enumerate(info.get("items") or []):
        if not isinstance(item, dict):
            continue
        for field in ("product_name", "full_ingredients", "note", "ingredient_note", "source_note"):
            if _norm(item.get(field)):
                ref = f"PI:{sku_id}:{idx}:{field}"
                entries[ref] = {"ref": ref, "authority": PRODUCT_AUTHORITY, "sourceType": "product_info", "productName": _norm(item.get("product_name")), "text": _norm(item.get(field))}
    for idx, page in enumerate(detail_pages or []):
        if isinstance(page, dict) and _norm(page.get("text") or page.get("excerpt")):
            ref = _norm(page.get("asset_id")) or f"DP:{sku_id}:{idx}"
            entries[ref] = {"ref": ref, "authority": PRODUCT_AUTHORITY, "sourceType": "detail_page", "text": _norm(page.get("text") or page.get("excerpt"))}
    for item in category_knowledge or []:
        if isinstance(item, dict) and _norm(item.get("ref")) and _norm(item.get("text")):
            entries[_norm(item["ref"])] = {"ref": _norm(item["ref"]), "authority": CATEGORY_KNOWLEDGE, "sourceType": "category_knowledge", "text": _norm(item["text"])}
    return {"version": CLAIM_CONTRACT_VERSION, "catalogAuthority": catalog_authority, "appealId": appeal_id, "skuId": sku_id, "evidenceLimit": evidence_limit, "entries": entries}


# ------------------------------------------------------------------ validation

def _scene_field_text(scene: dict[str, Any], field: str) -> str:
    if field == "voice_over":
        return _norm(scene.get("voice_over") or scene.get("spoken_script"))
    return _norm(scene.get(field))


def validate_claim(claim: dict[str, Any], scene: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    entries = catalog.get("entries") or {}
    claim_type = _norm(claim.get("claimType"))
    field = _norm(claim.get("field")) or "voice_over"
    text = _norm(claim.get("claimText"))
    refs = [_norm(r) for r in (claim.get("evidenceRefs") or []) if _norm(r)]
    anchors = [_norm(a) for a in (claim.get("anchorTerms") or []) if _norm(a)]
    reasons: list[str] = []
    out: dict[str, Any] = {"claimId": claim.get("claimId") or claim_id(scene.get("order"), field, text), "claimType": claim_type, "field": field, "claimText": text, "evidenceRefs": refs}

    if claim_type not in CLAIM_TYPES:
        return {**out, "groundingStatus": "UNRESOLVED", "reasons": ["UNKNOWN_CLAIM_TYPE"], "sourceAuthority": []}
    invalid = [r for r in refs if r not in entries]
    authorities = sorted({entries[r]["authority"] for r in refs if r in entries})
    out["sourceAuthority"] = authorities
    if invalid:
        return {**out, "groundingStatus": "INVALID_REF", "reasons": [f"INVALID_REF:{r}" for r in invalid]}
    if not text or _squash(text) not in _squash(_scene_field_text(scene, field)):
        reasons.append("CLAIM_TEXT_NOT_IN_SCENE")

    if claim_type == "EDITORIAL_BRIDGE":
        hits = [p for p in RESTRICTED_PATTERNS if p in text]
        if hits:
            return {**out, "groundingStatus": "UNSUPPORTED", "reasons": reasons + [f"EDITORIAL_CONTAINS_FACT_PATTERN:{p}" for p in hits]}
        prevalence = [p for p in GENERALIZATION_PATTERNS if _squash(p) in _squash(text)]
        if prevalence:
            return {**out, "groundingStatus": "UNRESOLVED", "reasons": reasons + ["REVIEW_GENERALIZATION_OVERREACH"], "semanticRisk": {"generalizationTerms": prevalence}, "humanReviewRequired": True}
        return {**out, "groundingStatus": "UNRESOLVED" if reasons else "EDITORIAL", "reasons": reasons}

    allowed = CLAIM_AUTHORITY[claim_type]
    allowed_refs = [r for r in refs if entries[r]["authority"] in allowed]
    if not refs:
        return {**out, "groundingStatus": "UNSUPPORTED", "reasons": reasons + ["NO_AUTHORITY"]}
    if not allowed_refs:
        classes = {entries[r]["authority"] for r in refs}
        if claim_type in ("PRODUCT_FACT", "USAGE_FACT") and CATEGORY_KNOWLEDGE in classes:
            return {**out, "groundingStatus": "UNSUPPORTED", "reasons": reasons + ["CATEGORY_TO_PRODUCT_LEAP"]}
        if claim_type in ("PRODUCT_FACT", "USAGE_FACT") and classes & {*REVIEW_CLASSES, CUSTOMER_QUESTION}:
            return {**out, "groundingStatus": "UNSUPPORTED", "reasons": reasons + ["CUSTOMER_TO_PRODUCT_LEAP"]}
        if classes <= set(DERIVED_CLASSES):
            return {**out, "groundingStatus": "UNRESOLVED", "reasons": reasons + ["DERIVED_AUTHORITY_ONLY"]}
        return {**out, "groundingStatus": "UNSUPPORTED", "reasons": reasons + ["AUTHORITY_CLASS_MISMATCH"]}
    if not anchors:
        reasons.append("ANCHOR_TERMS_MISSING")
    source_text = " ".join(_squash(entries[r]["text"]) for r in allowed_refs)
    missing = [a for a in anchors if _squash(a) not in source_text]
    if missing:
        return {**out, "groundingStatus": "UNSUPPORTED", "reasons": reasons + [f"ANCHOR_NOT_IN_SOURCE:{a}" for a in missing]}
    if claim_type == "CUSTOMER_EXPERIENCE":
        # Every field that states review-derived content attributes it itself, whatever the experienceKind.
        field_text = _scene_field_text(scene, field)
        if not any(m in field_text for m in ATTRIBUTION_MARKERS):
            reasons.append("ATTRIBUTION_MISSING")
        risks, detail = _review_semantic_risks(field_text, [entries[r] for r in allowed_refs])
        reasons += risks
        if detail:
            out["semanticRisk"] = detail
        out["reviewEvidenceKinds"] = sorted({review_evidence_kind(entries[r]) or "" for r in allowed_refs})
    if any(r in SEMANTIC_REASONS for r in reasons):
        out["humanReviewRequired"] = True
    return {**out, "groundingStatus": "UNRESOLVED" if reasons else "GROUNDED", "reasons": reasons}


def validate_scene_claims(scene: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    claims = scene.get("claims") if isinstance(scene, dict) else None
    if not isinstance(claims, list):
        return {"order": (scene or {}).get("order"), "stage": (scene or {}).get("stage"), "status": LEGACY_STATUS, "claims": [], "counts": {}}
    results = [validate_claim(c, scene, catalog) for c in claims if isinstance(c, dict)]
    counts = {s: sum(1 for r in results if r["groundingStatus"] == s) for s in GROUNDING_STATUSES}
    counts["factual"] = sum(1 for r in results if r["claimType"] != "EDITORIAL_BRIDGE")
    counts["editorialBridge"] = sum(1 for r in results if r["claimType"] == "EDITORIAL_BRIDGE")
    # Narration and subtitle are judged separately: a grounded narration never covers its subtitle.
    uncovered = [f for f in REQUIRED_CLAIM_FIELDS if _scene_field_text(scene, f) and not any(r["field"] == f for r in results)]
    ok = bool(results) and not uncovered and all(r["groundingStatus"] in PRODUCTION_ALLOWED_STATUSES for r in results)
    return {"order": scene.get("order"), "stage": scene.get("stage"), "status": "PRODUCTION_ELIGIBLE" if ok else "GROUNDING_HOLD", "claims": results, "counts": counts, "uncoveredFields": uncovered}


def artifact_claim_grounding(scenes: list[Any], catalog: dict[str, Any] | None) -> dict[str, Any]:
    scene_list = [s for s in (scenes or []) if isinstance(s, dict)]
    if not any(isinstance(s.get("claims"), list) for s in scene_list):
        return {"version": CLAIM_CONTRACT_VERSION, "status": LEGACY_STATUS, "scenesWithClaims": 0, "scenes": len(scene_list), "contentGroundingStatus": "NOT_EVALUATED"}
    cat = catalog or {"entries": {}}
    per_scene = [validate_scene_claims(s, cat) for s in scene_list]
    totals = {s: sum(r["counts"].get(s, 0) for r in per_scene) for s in GROUNDING_STATUSES}
    legacy = sum(1 for r in per_scene if r["status"] == LEGACY_STATUS)
    hold = legacy or any(r["status"] == "GROUNDING_HOLD" for r in per_scene)
    claims = [c for r in per_scene for c in r["claims"]]
    return {
        "version": CLAIM_CONTRACT_VERSION,
        "semanticGuardrailVersion": SEMANTIC_GUARDRAIL_VERSION,
        "status": "TRACEABLE" if not legacy else "TRACEABILITY_INCOMPLETE",
        "catalogAuthority": cat.get("catalogAuthority"),
        "scenesWithClaims": len(per_scene) - legacy,
        "scenes": len(per_scene),
        "totals": totals,
        "claimCount": len(claims),
        "riskCounts": {reason: sum(1 for c in claims if reason in c["reasons"]) for reason in SEMANTIC_REASONS},
        "uncoveredFieldCount": sum(len(r.get("uncoveredFields") or []) for r in per_scene),
        "contentGroundingStatus": "CONTENT_GROUNDING_HOLD" if hold else "CONTENT_GROUNDING_PASS",
        "perScene": per_scene,
    }


def claim_text_sha256(claim_text: Any) -> str:
    return hashlib.sha256(_norm(claim_text).encode("utf-8")).hexdigest()


def human_resolved_claim_ids(claims: list[dict[str, Any]], reviews: list[Any] | None) -> set[str]:
    """ALLOW_AS_WRITTEN approves one exact sentence; it never upgrades source authority (an individual review stays individual)."""
    allowed = _allow_keys(reviews)
    return {c["claimId"] for c in claims if _human_resolved(c, allowed)}


def _allow_keys(reviews: list[Any] | None) -> set[tuple[str, str]]:
    return {(str(r.get("claimId")), str(r.get("claimTextSha256"))) for r in reviews or [] if isinstance(r, dict) and r.get("decision") == "ALLOW_AS_WRITTEN"}


def _human_resolved(claim: dict[str, Any], allowed: set[tuple[str, str]]) -> bool:
    # Keyed by (claimId, exact text): the same claimId reused in another field with new wording is not covered.
    return (claim["claimId"], claim_text_sha256(claim["claimText"])) in allowed and bool(claim["reasons"]) and all(r in HUMAN_ALLOWABLE_REASONS for r in claim["reasons"])


def narration_fit_gate(result: dict[str, Any], snapshot: dict[str, Any] | None, reviews: list[Any] | None = None) -> dict[str, Any]:
    totals = result.get("totals") or {}
    claims = [c for r in result.get("perScene") or [] for c in r["claims"]]
    resolved = human_resolved_claim_ids(claims, reviews)
    allowed = _allow_keys(reviews)
    pending = [c for c in claims if c["groundingStatus"] == "UNRESOLVED" and not _human_resolved(c, allowed)]
    blockers = []
    if result.get("status") != "TRACEABLE":
        blockers.append("SCENE_CLAIM_LEDGER_INCOMPLETE")
    if result.get("uncoveredFieldCount"):
        blockers.append("FIELD_WITHOUT_CLAIMS")
    if not isinstance(snapshot, dict) or snapshot.get("snapshotAuthority") != SNAPSHOT_AUTHORITY:
        blockers.append("GENERATION_EVIDENCE_SNAPSHOT_MISSING")
    if totals.get("INVALID_REF"):
        blockers.append("INVALID_REF_PRESENT")
    if totals.get("UNSUPPORTED"):
        blockers.append("UNSUPPORTED_PRESENT")
    for reason, code in (("ATTRIBUTION_MISSING", "ATTRIBUTION_MISSING_PRESENT"), ("REVIEW_GENERALIZATION_OVERREACH", "REVIEW_GENERALIZATION_OVERREACH_PRESENT"), ("EFFICACY_SENSITIVE_REVIEW_REQUIRED", "EFFICACY_SENSITIVE_REVIEW_UNRESOLVED")):
        if any(reason in c["reasons"] for c in pending):
            blockers.append(code)
    if any(not set(c["reasons"]) & set(SEMANTIC_REASONS) for c in pending):
        blockers.append("UNRESOLVED_CLAIM_PRESENT")
    return {
        "eligible": not blockers,
        "readiness": "NARRATION_FIT_READY" if not blockers else "CONTENT_GROUNDING_HOLD",
        "blockers": blockers,
        "unresolved": int(totals.get("UNRESOLVED") or 0),
        "humanResolvedClaimIds": sorted(resolved),
        "pendingHumanReviewClaimIds": [c["claimId"] for c in pending],
        "unresolvedPolicy": "HUMAN_REVIEW_REQUIRED",
    }


def claim_grounding_for_scenes(scenes: list[Any] | None, snapshot: dict[str, Any] | None, reviews: list[Any] | None = None) -> dict[str, Any]:
    """Judge (possibly edited) scenes against the artifact's own generation-time snapshot. Never re-reads upstream."""
    scene_list = [s for s in (scenes or []) if isinstance(s, dict)]
    if not any(isinstance(s.get("claims"), list) for s in scene_list):
        return artifact_claim_grounding(scene_list, None)
    catalog = snapshot.get("allowedEvidenceCatalog") if isinstance(snapshot, dict) else None
    if not isinstance(catalog, dict) or not isinstance(catalog.get("entries"), dict):
        catalog = {"catalogAuthority": SNAPSHOT_MISSING, "entries": {}}
    result = artifact_claim_grounding(scene_list, catalog)
    result["narrationFitGate"] = narration_fit_gate(result, snapshot, reviews)
    return result


# ------------------------------------------------------------------ generation-time snapshot (writer input only)

def _catalog_entry(ref: str, authority: str, source_type: str, text: Any, **extra: Any) -> dict[str, Any]:
    return {"ref": ref, "authority": authority, "sourceType": source_type, "text": _norm(text), **{k: v for k, v in extra.items() if v not in (None, "")}}


def writer_source_catalog(context: dict[str, Any]) -> list[dict[str, Any]]:
    """Every ref the writer may cite, derived only from values already present in the writer context."""
    appeal = context.get("appeal") if isinstance(context.get("appeal"), dict) else {}
    product = context.get("product") if isinstance(context.get("product"), dict) else {}
    insight = context.get("insight") if isinstance(context.get("insight"), dict) else {}
    appeal_id = _norm(appeal.get("appeal_id"))
    sku = _norm(product.get("sku_id"))
    out: list[dict[str, Any]] = []
    for e in context.get("evidence") or []:
        if isinstance(e, dict) and _norm(e.get("evidence_ref")):
            source_type = _norm(e.get("source_type")).lower()
            authority = EVIDENCE_SOURCE_AUTHORITY.get(source_type, "OTHER_EVIDENCE")
            entry = _catalog_entry(_norm(e["evidence_ref"]), authority, source_type, e.get("snippet"), sourceId=e.get("source_id"))
            if authority in REVIEW_CLASSES:
                flags = efficacy_risk_flags(entry["text"])
                entry.update({"reviewEvidenceKind": REVIEW_EVIDENCE_KIND[authority], "riskFlags": flags, "usagePolicy": "HUMAN_REVIEW_ONLY" if flags else "INDIVIDUAL_EXPERIENCE_ONLY"})
            out.append(entry)
    if appeal_id:
        for field in ("label", "appeal_text"):
            if _norm(appeal.get(field)):
                out.append(_catalog_entry(f"AP:{appeal_id}:{field}", APPEAL_INTERPRETATION, "appeal", appeal.get(field)))
        for field in ("problem", "desire", "barrier", "motivation", "usage_situation"):
            if _norm(insight.get(field)):
                out.append(_catalog_entry(f"INS:{appeal_id}:{field}", DERIVED_INSIGHT, "insight", insight.get(field)))
        for idx, phrase in enumerate(context.get("customer_language") or []):
            if _norm(phrase):
                out.append(_catalog_entry(f"INS:{appeal_id}:customer_language:{idx}", DERIVED_INSIGHT, "insight_customer_language", phrase))
    if sku and _norm(product.get("title")):
        out.append(_catalog_entry(f"PRD:{sku}:title", PRODUCT_AUTHORITY, "sku_scope", product.get("title")))
    for idx, item in enumerate(product.get("component_products") or []):
        if not isinstance(item, dict):
            continue
        for field in ("product_name", "full_ingredients", "note", "ingredient_note", "source_note"):
            if _norm(item.get(field)):
                out.append(_catalog_entry(f"PI:{sku}:{idx}:{field}", PRODUCT_AUTHORITY, "product_info", item.get(field), productName=_norm(item.get("product_name"))))
    for idx, page in enumerate(context.get("detail_page_reference") or []):
        if isinstance(page, dict) and page.get("analysis"):
            ref = f"DP:{_norm(page.get('asset_id')) or f'{sku}:{idx}'}"
            text = page["analysis"] if isinstance(page["analysis"], str) else json.dumps(page["analysis"], ensure_ascii=False, sort_keys=True)
            out.append(_catalog_entry(ref, PRODUCT_AUTHORITY, "detail_page", text[:4000]))
    source = context.get("source_content") if isinstance(context.get("source_content"), dict) else None
    if source and _norm(source.get("excerpt")):
        out.append(_catalog_entry(f"SRC:{_norm(source.get('artifact_id')) or 'source'}", SOURCE_CONTENT, "source_content", source.get("excerpt")))
    seen: set[str] = set()
    return [e for e in out if not (e["ref"] in seen or seen.add(e["ref"]))]


def writer_claim_contract() -> dict[str, Any]:
    return {
        "version": CLAIM_CONTRACT_VERSION,
        "rules": [
            "Every scene must include claims that cover its spoken_script and its subtitle separately (field = spoken_script | subtitle | on_screen_text).",
            "claimText must be copied exactly from that field. Split a sentence into several claims when it mixes facts and bridges.",
            "Factual claims (PRODUCT_FACT, USAGE_FACT, CATEGORY_FACT, CUSTOMER_EXPERIENCE) need evidenceRefs copied exactly from source_catalog[].ref. Never invent, guess or modify a ref.",
            "PRODUCT_FACT and USAGE_FACT may cite only PRODUCT_AUTHORITY refs. Reviews, questions, insights and appeal text never prove a product fact.",
            "CUSTOMER_EXPERIENCE needs a CUSTOMER_REVIEW ref. experienceKind is PRODUCT_OUTCOME or PROBLEM_STATE.",
            "Attribution is per field: every spoken_script, subtitle or on_screen_text that states a review-derived experience must itself say it comes from a review (e.g. 한 후기에서는, 고객 리뷰에는, 한 고객은). Attribution in the narration does not cover the subtitle.",
            "reviewEvidenceKind INDIVIDUAL_REVIEW is one customer's experience: say 한 고객은 / 한 후기에서는. Never turn it into prevalence (많았, 많은 고객, 대부분, 자주, 반복적으로, 여러 후기, 말이 많). Exact counts of the cited refs (두 후기에서는) are fine.",
            "Sources with usagePolicy HUMAN_REVIEW_ONLY (efficacy or hair-loss meaning) must not be reworded into a general consumer problem or experience. Prefer not to use them.",
            "Do not output safety, risk or generalization flags; they are computed by the system.",
            "CATEGORY_FACT may cite only CATEGORY_KNOWLEDGE refs and never supports a product claim.",
            "DERIVED_INSIGHT, APPEAL_INTERPRETATION and SOURCE_CONTENT refs are interpretations, not proof.",
            "EDITORIAL_BRIDGE is a question, empathy line, transition or CTA with no new fact and no efficacy wording; it needs no refs. A CTA that names product attributes must put that part in a separate PRODUCT_FACT claim.",
            "anchorTerms: 1-4 exact key terms of the claim that also appear in the cited source text.",
            "If no allowed ref supports a statement, do not write the statement.",
            "Do not output grounding status; it is computed by the system.",
        ],
    }


def build_grounding_snapshot(context: dict[str, Any], *, generated_at: str) -> dict[str, Any]:
    entries = context.get("source_catalog") if isinstance(context.get("source_catalog"), list) else writer_source_catalog(context)
    entries = json.loads(json.dumps(entries, ensure_ascii=False))
    previous = context.get("previous_artifact") if isinstance(context.get("previous_artifact"), dict) else {}
    catalog = {"version": CLAIM_CONTRACT_VERSION, "catalogAuthority": SNAPSHOT_AUTHORITY, "entries": {e["ref"]: e for e in entries}}
    digest = hashlib.sha256(json.dumps(entries, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    evidence_refs = [_norm(e.get("evidence_ref")) for e in context.get("evidence") or [] if isinstance(e, dict) and _norm(e.get("evidence_ref"))]
    return {
        "contractVersion": CLAIM_CONTRACT_VERSION,
        "evidenceSnapshotVersion": SNAPSHOT_VERSION,
        "snapshotAuthority": SNAPSHOT_AUTHORITY,
        "snapshotSha256": digest,
        "generatedAt": generated_at,
        "appealId": _norm((context.get("appeal") or {}).get("appeal_id")),
        "skuId": _norm((context.get("product") or {}).get("sku_id")),
        "parentArtifactId": _norm(previous.get("artifact_id")) or None,
        "writerEvidenceInputCount": len(context.get("evidence") or []),
        "writerEvidenceRefs": evidence_refs,
        "sourceContextRefs": [e["ref"] for e in entries],
        "allowedEvidenceCatalog": catalog,
    }


def normalize_writer_claims(raw_claims: Any, scene_order: Any) -> list[dict[str, Any]]:
    """Keep only contract fields. Claim ids are assigned here (SC<order>-CLM<n>); writer ids and statuses are ignored."""
    out: list[dict[str, Any]] = []
    for raw in raw_claims if isinstance(raw_claims, list) else []:
        if not isinstance(raw, dict) or len(out) >= MAX_CLAIMS_PER_SCENE:
            continue
        field = _norm(raw.get("field")).lower()
        claim = {
            "claimId": f"SC{scene_order}-CLM{len(out) + 1}",
            "claimType": _norm(raw.get("claimType")).upper(),
            "field": WRITER_FIELD_ALIASES.get(field, field or "voice_over"),
            "claimText": _norm(raw.get("claimText"))[:240],
            "canonicalStatement": _norm(raw.get("canonicalStatement"))[:240],
            "anchorTerms": [_norm(a)[:60] for a in (raw.get("anchorTerms") or []) if isinstance(a, str) and _norm(a)][:6],
            "evidenceRefs": [_norm(r)[:120] for r in (raw.get("evidenceRefs") or []) if isinstance(r, str) and _norm(r)][:8],
        }
        if _norm(raw.get("experienceKind")).upper() in EXPERIENCE_KINDS:
            claim["experienceKind"] = _norm(raw.get("experienceKind")).upper()
        out.append(claim)
    return out


def attach_shorts_grounding(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    snapshot = build_grounding_snapshot(context, generated_at=str(payload.get("generated_at") or ""))
    shorts = payload.get("shorts") if isinstance(payload.get("shorts"), dict) else payload
    result = claim_grounding_for_scenes(shorts.get("scenes") or [], snapshot)
    snapshot["validation"] = {k: v for k, v in result.items() if k != "perScene"}
    snapshot["claimGroundingStatus"] = result.get("contentGroundingStatus")
    payload["shorts_grounding"] = snapshot
    return snapshot


# ------------------------------------------------------------------ rewrite comparison

def compare_claim_usage(original_claims: list[dict[str, Any]], claim_ids_used: list[str], *, original_text: str = "", proposal_text: str = "") -> dict[str, Any]:
    """Structural check for a shortened scene. Passing here is necessary, not sufficient (meaning may still widen)."""
    original_ids = [c.get("claimId") for c in original_claims if isinstance(c, dict) and c.get("claimId")]
    used = [_norm(x) for x in (claim_ids_used or []) if _norm(x)]
    new = [x for x in used if x not in original_ids]
    preserved = [x for x in original_ids if x in used]
    removed = [x for x in original_ids if x not in used]
    by_id = {c.get("claimId"): c for c in original_claims if isinstance(c, dict)}
    anchors_missing = {cid: [a for a in (by_id[cid].get("anchorTerms") or []) if _squash(a) not in _squash(proposal_text)] for cid in preserved}
    anchors_missing = {k: v for k, v in anchors_missing.items() if v}
    strengthened = [p for p in RESTRICTED_PATTERNS if p in proposal_text and p not in original_text]
    issues = (["NEW_CLAIM_INTRODUCED"] if new else []) + (["RESTRICTED_PATTERN_ADDED"] if strengthened else [])
    return {
        "status": "HOLD" if issues else "STRUCTURE_OK",
        "issues": issues,
        "preservedClaimIds": preserved,
        "removedClaimIds": removed,
        "newClaimIds": new,
        "preservedAnchorsMissing": anchors_missing,
        "restrictedPatternsAdded": strengthened,
        "humanReviewRequired": True,
        "semanticCheck": "NOT_PROVEN_BY_ID_SUBSET",
    }
