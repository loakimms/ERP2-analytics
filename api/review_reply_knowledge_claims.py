"""Claim-level fact validation inside composite historical guidance units.

A composite unit can mix accurate and unconfirmed statements. The fixed decomposition artifact splits such a parent unit
into claims; each claim is validated on its own with the unit fact validator and stored append-only in a table separate
from unit fact records. Analysis classes in the artifact are review candidates, never human verification.

Parent protection: while a decomposed parent unit has any claim that is not currently VERIFIED, the parent unit itself
cannot be recorded VERIFIED. If the artifact cannot be loaded, unit VERIFIED is refused everywhere (fail closed).
Claims never verify their parent automatically.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from review_reply_knowledge_extraction import TYPE_CAUTION, UNKNOWN, extract_units
from review_reply_knowledge_unit_facts import (
    ANSWER_FIELDS,
    ANSWER_VALUES,
    DYE_PRODUCTS,
    FACT_PENDING,
    FACT_STORED_STATES,
    FACT_VERIFIED,
    GENERATOR_REFERENCE_FIELD,
    MODE_SEQUENTIAL,
    RES_APPLICABLE,
    RES_NO_RECORD,
    RES_SOURCE_CHANGED,
    RES_STALE_REPLY_CHANGED,
    RES_STALE_UNIT_CHANGED,
    UnitFactValidationError,
    _DYE_SEQUENCE_RE,
    _applicability_withdrawn,
    _find_entry,
    _overlaps,
    applicable_aspects,
    entry_can_verify,
    text_application_mode,
    validate_unit_fact_submission,
)

CLAIM_CONTRACT_VERSION = "claim_fact_validation_v1"
_ARTIFACT_PATH = Path(__file__).resolve().parent / "review_reply_knowledge_sources" / "claim_decomposition_v1.json"
QUOTE_SEPARATOR = " … "
ROOT = "ROOT"

ANALYSIS_VERIFY_CANDIDATE = "VERIFY_CANDIDATE"
ANALYSIS_PARTIAL = "PARTIAL"
ANALYSIS_CONFLICT = "CONFLICT"
ANALYSIS_PENDING = "PENDING"
# Only a claim the official evidence supports as a whole may reach human VERIFIED. PARTIAL (part unconfirmed), CONFLICT and
# PENDING stay non-verifiable whatever the reviewer answers; they become verifiable only through a new decomposition version
# (new claim keys, hashes and audit trail) that re-scopes the claim or adds evidence.
ANALYSIS_VERIFIABLE = (ANALYSIS_VERIFY_CANDIDATE,)

ASPECT_TARGET_COLOR = "target_color"
TARGET_COLOR_FIELD = "target_color_accurate"
OFFICIAL_COLOR_LABEL_FIELD = "official_color_label"
# Color labels exactly as written in the registered official guide. Equivalence of a reply's wording to one of these is a
# human judgement recorded per claim; the server only checks that the chosen label is stated by the selected evidence.
OFFICIAL_COLOR_LABELS = ("오렌지 레드", "붉은 갈색", "연한 갈색", "진한 흑갈색")
COLOR_LITERAL = "OFFICIAL_LITERAL"
COLOR_NEEDS_HUMAN = "NEEDS_HUMAN_EQUIVALENCE"

INTEGRITY_OK = "OK"
INTEGRITY_PARENT_NOT_CURRENT = "PARENT_UNIT_NOT_CURRENT"
INTEGRITY_REPLY_CHANGED = "REPLY_CHANGED"
INTEGRITY_TEXT_MISMATCH = "CLAIM_TEXT_MISMATCH"

UNIT_GUARD_CODE = "UNIT_HAS_UNVERIFIED_CLAIMS"
UNIT_GUARD_UNAVAILABLE = "CLAIM_DECOMPOSITION_UNAVAILABLE"

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,80}$")
IDENTITY_FIELDS = ("reviewer", "reviewer_uid", "reviewer_email", "reviewer_role")
_DESIRE_RE = re.compile(r"원하|으로|로|염색|되시길|되길|신다면|시면|하면|을|를|때|\s|[\"'“”‘’()]")
_SOURCE_PREFIX = {"opc": "operator_confirmed_usage_guidance", "html": "sujata_usage_guide_html"}


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _norm(text: object) -> str:
    return re.sub(r"\s+", "", str(text or ""))


# ---------------------------------------------------------------- artifact

def load_claim_artifact(path: Path | None = None) -> dict:
    """{available, version, claims_by_key, claims_by_parent, parents, protected_by_knowledge, error}. Never raises."""
    try:
        raw = json.loads((path or _ARTIFACT_PATH).read_text(encoding="utf-8"))
        body = {"claims": raw["claims"], "parent_units": raw["parent_units"]}
        if _sha(json.dumps(body, ensure_ascii=False, sort_keys=True)) != raw["content_sha256"]:
            raise ValueError("content_sha256 mismatch")
        claims_by_key = {c["claim_key"]: c for c in raw["claims"]}
        if len(claims_by_key) != len(raw["claims"]):
            raise ValueError("duplicate claim key")
        parents = {p["parent_unit_key"]: p for p in raw["parent_units"]}
        claims_by_parent: dict[str, list[dict]] = {}
        for c in raw["claims"]:
            if c["parent_unit_key"] not in parents:
                raise ValueError("claim without parent")
            claims_by_parent.setdefault(c["parent_unit_key"], []).append(c)
        protected: dict[str, list[dict]] = {}
        for p in parents.values():
            protected.setdefault(p["knowledge_id"], []).append(p)
        return {
            "available": True, "version": raw["version"], "content_sha256": raw["content_sha256"], "claims_by_key": claims_by_key,
            "claims_by_parent": claims_by_parent, "parents": parents, "protected_by_knowledge": protected, "error": None,
        }
    except Exception as exc:  # fail closed: callers refuse unit VERIFIED when unavailable
        return {"available": False, "version": None, "content_sha256": None, "claims_by_key": {}, "claims_by_parent": {},
                "parents": {}, "protected_by_knowledge": {}, "error": f"{type(exc).__name__}: {exc}"}


_ARTIFACT_CACHE: dict = {}


def claim_artifact() -> dict:
    if "artifact" not in _ARTIFACT_CACHE:
        _ARTIFACT_CACHE["artifact"] = load_claim_artifact()
    return _ARTIFACT_CACHE["artifact"]


def entry_source_id(registry: dict, entry_key: str) -> str | None:
    preferred = _SOURCE_PREFIX.get(entry_key.split(":", 1)[0])
    if preferred and _find_entry(registry, preferred, entry_key)[1] is not None:
        return preferred
    for sid in registry["sources"]:
        if _find_entry(registry, sid, entry_key)[1] is not None:
            return sid
    return None


# ---------------------------------------------------------------- claim as a unit

def _parent_dye_order(parent: dict) -> list[str]:
    """Dye order the parent states explicitly (its sequence, or "레드 … 후 … 브라운"); empty when not stated."""
    steps = [s.get("product") for s in parent.get("sequence") or [] if s.get("product") in DYE_PRODUCTS]
    if len(set(steps)) == 2:
        return steps
    m = next((m for m in _DYE_SEQUENCE_RE.finditer(str(parent.get("originalText") or "")) if m.group(1) != m.group(2)), None)
    return [f"{m.group(1)} 헤나", f"{m.group(2)} 헤나"] if m else []


def target_color_only_condition(condition: object, target_color: object) -> bool:
    """True when the extracted condition only expresses the wanted color ("진한갈색으로 원하신다면")."""
    if not target_color or condition in (None, "", UNKNOWN):
        return False
    cond = str(condition)
    if _norm(target_color) not in _norm(cond):
        return False
    return not _DESIRE_RE.sub("", cond.replace(str(target_color), ""))


def claim_unit(claim: dict, parent: dict | None) -> dict:
    """The claim as a unit for the unit fact validator, carrying the parent's sequential context and source context."""
    text = claim["quote"].replace(QUOTE_SEPARATOR, " ")
    units = [u for u in extract_units(text) if u.get("originalText")]
    u = dict(max(units, key=lambda x: len(x["originalText"]))) if units else {}
    u["originalText"] = text
    u.setdefault("knowledgeType", "PRODUCT_USAGE")
    u["isKnowledgeCandidate"] = True
    u["product"] = list(claim["products"])
    u.setdefault("numericRange", [])
    u.setdefault("sequence", [])
    condition = u.get("condition") or UNKNOWN
    if target_color_only_condition(condition, claim.get("target_color")):
        condition = UNKNOWN
    u["condition"] = condition
    u["conditionReference"] = UNKNOWN
    u["contextBefore"] = str((parent or {}).get("originalText") or UNKNOWN)
    if any(k in claim["canonical_key"] for k in ("PATCH", "STOP_ON")):
        u["knowledgeType"] = TYPE_CAUTION
    inherited = None
    if (
        claim.get("method") == "sequential"
        and not u["sequence"]
        and parent is not None
        and text_application_mode(text, u["product"]) != MODE_SEQUENTIAL
    ):
        order = _parent_dye_order(parent)
        if order:
            u["sequence"] = [{"order": i + 1, "product": p, "text": "원래 Unit의 순차 사용 문맥", "numeric": UNKNOWN}
                             for i, p in enumerate(order)]
            inherited = {"mode": "sequential", "order": order}
    u["_inheritedContext"] = inherited
    return u


def claim_aspects(claim: dict, cunit: dict) -> list[str]:
    out = applicable_aspects(cunit)
    if claim.get("target_color"):
        out.append(ASPECT_TARGET_COLOR)
    return out


def color_labels_in(excerpts: list[str]) -> list[str]:
    joined = " ".join(excerpts)
    return [label for label in OFFICIAL_COLOR_LABELS if label in joined]


def color_match(target_color: object, labels: list[str]) -> str | None:
    if not target_color:
        return None
    return COLOR_LITERAL if any(_norm(label) == _norm(target_color) for label in labels) else COLOR_NEEDS_HUMAN


# ---------------------------------------------------------------- integrity / resolution

def claim_integrity(claim: dict, *, item: dict | None, parent_meta: dict, current_unit_keys: set[str]) -> str:
    if item is None or item.get("reply_sha256") != parent_meta["reply_sha256"]:
        return INTEGRITY_REPLY_CHANGED
    if claim["parent_unit_key"] not in current_unit_keys:
        return INTEGRITY_PARENT_NOT_CURRENT
    reply_text = str(item.get("reply_text") or "")
    if QUOTE_SEPARATOR.join(reply_text[a:b] for a, b in claim["reply_spans"]) != claim["quote"]:
        return INTEGRITY_TEXT_MISMATCH
    if _sha(claim["quote"]) != claim["quote_sha256"]:
        return INTEGRITY_TEXT_MISMATCH
    return INTEGRITY_OK


def resolve_claim(claim: dict, cunit: dict, *, integrity: str, records: list[dict], registry: dict) -> dict:
    """records: claim validation dicts for the knowledge item, oldest first."""
    own = [r for r in records if r.get("claim_key") == claim["claim_key"]]
    base = {"claimKey": claim["claim_key"], "contractVersion": CLAIM_CONTRACT_VERSION, "historyCount": len(own),
            "latestRecordId": own[-1]["claim_validation_id"] if own else None}
    if not own:
        return base | {"status": FACT_PENDING, "recordedStatus": None, "resolution": RES_NO_RECORD, "latest": None, "changedEvidenceEntries": []}
    latest = own[-1]
    resolution = RES_APPLICABLE
    changed: list[str] = []
    if integrity == INTEGRITY_REPLY_CHANGED:
        resolution = RES_STALE_REPLY_CHANGED
    elif integrity != INTEGRITY_OK:
        resolution = RES_STALE_UNIT_CHANGED
    elif latest.get("fact_status") == FACT_VERIFIED:
        for e in latest.get("evidence") or []:
            source, entry = _find_entry(registry, e.get("source_id"), e.get("entry_key"))
            if (
                source is None
                or entry is None
                or entry["entry_sha256"] != e.get("entry_sha256")
                or not entry_can_verify(source, entry)
                or _applicability_withdrawn(cunit, e, entry)
            ):
                changed.append(e.get("entry_key"))
        if changed:
            resolution = RES_SOURCE_CHANGED
    status = latest.get("fact_status") if resolution == RES_APPLICABLE else FACT_PENDING
    return base | {
        "status": status,
        "recordedStatus": latest.get("fact_status"),
        "resolution": resolution,
        "changedEvidenceEntries": changed,
        "latest": {
            k: latest.get(k)
            for k in ("claim_validation_id", "fact_status", "verified_scope", "hold_reason", "evidence", "note", "official_color_label",
                      "reviewer_email", "reviewer_uid", "reviewer_role", "created_at", "generator_reference_allowed")
        },
    }


def claims_for_item(item: dict, *, records: list[dict], registry: dict, artifact: dict | None = None) -> dict:
    """Claim views for one knowledge item, grouped by parent unit, with the parent protection state."""
    art = artifact or claim_artifact()
    if not art["available"]:
        return {"available": False, "error": UNIT_GUARD_UNAVAILABLE, "version": None, "parents": []}
    units_by_key = {
        (u.get("factValidation") or {}).get("unitKey"): u for u in item.get("knowhow_items") or [] if u.get("factValidation")
    }
    current_keys = {k for k in units_by_key if k}
    parents_out = []
    for meta in art["protected_by_knowledge"].get(item["knowledge_id"], []):
        parent = units_by_key.get(meta["parent_unit_key"])
        views = []
        for claim in art["claims_by_parent"][meta["parent_unit_key"]]:
            integrity = claim_integrity(claim, item=item, parent_meta=meta, current_unit_keys=current_keys)
            cunit = claim_unit(claim, parent)
            labels = color_labels_in([str((_find_entry(registry, entry_source_id(registry, k) or "", k)[1] or {}).get("statement") or "")
                                      for k in claim["suggested_evidence"]])
            views.append({
                **{k: claim[k] for k in ("claim_key", "analysis_label", "parent_unit_key", "quote", "unit_spans", "reply_spans",
                                         "canonical_key", "analysis_class", "content_class", "downgrade_reasons", "target_product",
                                         "products", "method", "numbers", "target_color", "condition", "analysis_note")},
                "suggested_evidence": [{"source_id": entry_source_id(registry, k), "entry_key": k} for k in claim["suggested_evidence"]],
                "applicable_aspects": claim_aspects(claim, cunit),
                "inherited_context": cunit["_inheritedContext"],
                "official_color_labels": labels,
                "target_color_match": color_match(claim.get("target_color"), labels),
                "integrity": integrity,
                "verifiable": integrity == INTEGRITY_OK and claim["analysis_class"] in ANALYSIS_VERIFIABLE,
                "factValidation": resolve_claim(claim, cunit, integrity=integrity, records=records, registry=registry),
            })
        verified = sum(1 for v in views if v["factValidation"]["status"] == FACT_VERIFIED)
        parents_out.append({
            "parent_unit_key": meta["parent_unit_key"],
            "parent_current": parent is not None,
            "parent_span": meta["parent_span"],
            "claim_count": len(views),
            "verified_claim_count": verified,
            "unit_verified_blocked": verified < len(views),
            "claims": views,
        })
    return {"available": True, "version": art["version"], "content_sha256": art["content_sha256"], "parents": parents_out}


# ---------------------------------------------------------------- parent protection

def unit_verified_guard(item: dict, unit: dict, *, records: list[dict], registry: dict, artifact: dict | None = None) -> dict | None:
    """None when unit VERIFIED may proceed; otherwise {code, detail}. Applies to any unit overlapping a decomposed parent."""
    art = artifact or claim_artifact()
    if not art["available"]:
        return {"code": UNIT_GUARD_UNAVAILABLE, "detail": None}
    span = unit.get("sourceTextSpan")
    key = (unit.get("factValidation") or {}).get("unitKey")
    metas = [m for m in art["protected_by_knowledge"].get(item["knowledge_id"], [])
             if m["parent_unit_key"] == key or _overlaps(m.get("parent_span"), span)]
    if not metas:
        return None
    view = claims_for_item(item, records=records, registry=registry, artifact=art)
    for p in view["parents"]:
        if p["parent_unit_key"] not in {m["parent_unit_key"] for m in metas}:
            continue
        if p["parent_unit_key"] != key or p["unit_verified_blocked"]:
            classes: dict[str, int] = {}
            for c in p["claims"]:
                if c["factValidation"]["status"] != FACT_VERIFIED:
                    classes[c["analysis_class"]] = classes.get(c["analysis_class"], 0) + 1
            return {"code": UNIT_GUARD_CODE, "detail": {"parent_unit_key": p["parent_unit_key"], "claim_count": p["claim_count"],
                                                        "verified_claim_count": p["verified_claim_count"],
                                                        "unverified_by_analysis_class": classes}}
    return None


# ---------------------------------------------------------------- submission

def validate_claim_submission(claim_view: dict, cunit: dict, payload: dict, registry: dict) -> dict:
    """Normalise a claim submission or raise UnitFactValidationError. Never stores anything."""
    if any(k in payload for k in IDENTITY_FIELDS):
        raise UnitFactValidationError("reviewer_fields_not_accepted")
    request_id = str(payload.get("request_id") or "").strip()
    if not REQUEST_ID_RE.match(request_id):
        raise UnitFactValidationError("request_id_required")
    supersedes = str(payload.get("supersedes_record_id") or "").strip()
    latest_id = claim_view["factValidation"]["latestRecordId"] or ROOT
    if supersedes != latest_id:
        raise UnitFactValidationError("CLAIM_STALE_VIEW", 409)
    if claim_view["integrity"] != INTEGRITY_OK:
        raise UnitFactValidationError("CLAIM_NOT_CURRENT", 409, claim_view["integrity"])
    status = str(payload.get("fact_status") or "").strip().upper()
    if status not in FACT_STORED_STATES:
        raise UnitFactValidationError("invalid_fact_status")
    gen = str(payload.get(GENERATOR_REFERENCE_FIELD) or "no").strip().lower()
    if gen != "no":
        raise UnitFactValidationError("CLAIM_GENERATOR_USE_NOT_ENABLED")
    if status == FACT_VERIFIED and claim_view["analysis_class"] not in ANALYSIS_VERIFIABLE:
        raise UnitFactValidationError("CLAIM_ANALYSIS_NOT_VERIFIABLE", 409, claim_view["analysis_class"])
    has_color = ASPECT_TARGET_COLOR in claim_view["applicable_aspects"]
    color_answer = str(payload.get(TARGET_COLOR_FIELD) or "").strip().lower() or None
    if color_answer is not None and color_answer not in ANSWER_VALUES:
        raise UnitFactValidationError(f"invalid_{TARGET_COLOR_FIELD}")
    if not has_color and color_answer not in (None, "na"):
        raise UnitFactValidationError("answer_for_non_applicable_aspect", 400, TARGET_COLOR_FIELD)
    if has_color and color_answer == "na":
        raise UnitFactValidationError("na_not_allowed_for_applicable_aspect", 400, TARGET_COLOR_FIELD)
    color_label = str(payload.get(OFFICIAL_COLOR_LABEL_FIELD) or "").strip() or None
    unit_payload = {k: v for k, v in payload.items() if k not in (TARGET_COLOR_FIELD, OFFICIAL_COLOR_LABEL_FIELD, "request_id",
                                                                   "supersedes_record_id", "claim_key", "knowledge_id")}
    unit_payload[GENERATOR_REFERENCE_FIELD] = "no"
    normalized = validate_unit_fact_submission(cunit, unit_payload, registry)
    if status == FACT_VERIFIED and has_color:
        if color_answer != "yes":
            raise UnitFactValidationError("verified_requires_all_applicable_yes")
        labels = color_labels_in([str(e.get("excerpt") or "") for e in normalized["evidence"]])
        if not color_label:
            raise UnitFactValidationError("TARGET_COLOR_LABEL_REQUIRED", 400, labels)
        if color_label not in labels:
            raise UnitFactValidationError("TARGET_COLOR_NOT_IN_SELECTED_EVIDENCE", 409, {"chosen": color_label, "evidence_labels": labels})
        literal = [lab for lab in OFFICIAL_COLOR_LABELS if _norm(lab) == _norm(claim_view["target_color"])]
        if literal and literal[0] != color_label:
            raise UnitFactValidationError("TARGET_COLOR_LABEL_CONFLICT", 409, {"claim_color": claim_view["target_color"], "chosen": color_label})
    elif color_label and status != FACT_VERIFIED:
        color_label = None
    answers = dict(normalized["answers"])
    answers[TARGET_COLOR_FIELD] = color_answer if has_color else "na"
    return normalized | {
        "answers": answers,
        "request_id": request_id,
        "supersedes_record_id": supersedes,
        "official_color_label": color_label,
        "target_color_match": claim_view["target_color_match"],
        "applicable_aspects": claim_view["applicable_aspects"],
    }


def claim_request_sha256(payload: dict) -> str:
    return _sha(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str))
