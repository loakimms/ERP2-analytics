"""Guide-first admin policy decisions (D01~D13): artifact, current-state view, submission guard, scoped reuse.

A policy decision records which standard applies when historical replies conflict with or go beyond the official
guide. It never verifies a reply, never changes authorship and is not connected to the generator. Reuse is limited to
the same question, product group, claim (issue) and condition, and only while the decision is current.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from review_reply_knowledge_unit_facts import GATE_B_IDENTITY_FIELDS as IDENTITY_FIELDS
from review_reply_knowledge_unit_facts import UnitFactValidationError, _find_entry

_ARTIFACT_PATH = Path(__file__).resolve().parent / "review_reply_knowledge_sources" / "policy_questions_v1.json"
ROOT = "ROOT"

DECISION_GUIDE_STANDARD = "GUIDE_STANDARD"
DECISION_HUMAN_SUPPLEMENT = "HUMAN_SUPPLEMENT"
DECISION_NEEDS_EVIDENCE = "NEEDS_EVIDENCE"
DECISION_EXCLUDE = "EXCLUDE_EXPRESSION"
DECISIONS = (DECISION_GUIDE_STANDARD, DECISION_HUMAN_SUPPLEMENT, DECISION_NEEDS_EVIDENCE, DECISION_EXCLUDE)

STATE_PENDING = "PENDING"
STATE_CURRENT = "CURRENT"
STATE_REEVALUATE = "REEVALUATION_REQUIRED"
STATE_SOURCE_MISSING = "POLICY_SOURCE_MISSING"

APPLIES = "APPLIES"
EXCEPTION = "EXCEPTION"
NO_DECISION = "NO_DECISION"
REEVALUATION = "REEVALUATION_REQUIRED"
OUT_OF_SCOPE_PRODUCT = "OUT_OF_SCOPE_PRODUCT"
OUT_OF_SCOPE_CLAIM = "OUT_OF_SCOPE_CLAIM"
OUT_OF_SCOPE_CONDITION = "OUT_OF_SCOPE_CONDITION"

_TEXT_MIN = 5


def _sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def load_policy_artifact(path: Path | None = None) -> dict:
    """{available, version, sha256, questions{id: q}, order, auto_rules, error}. Never raises; tampering fails closed."""
    try:
        raw = json.loads(Path(path or _ARTIFACT_PATH).read_text(encoding="utf-8"))
        body = {"questions": raw["questions"], "auto_rules": raw["auto_rules"]}
        if _sha(body) != raw["content_sha256"]:
            raise ValueError("content_sha256_mismatch")
        questions = {q["question_id"]: q | {"question_sha256": _sha(q)} for q in raw["questions"]}
        return {"available": True, "version": raw["version"], "sha256": raw["content_sha256"], "questions": questions,
                "order": [q["question_id"] for q in raw["questions"]], "auto_rules": raw["auto_rules"], "error": None}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "version": None, "sha256": None, "questions": {}, "order": [], "auto_rules": [],
                "error": f"{type(exc).__name__}: {exc}"}


_ARTIFACT: dict | None = None


def policy_artifact() -> dict:
    global _ARTIFACT
    if _ARTIFACT is None:
        _ARTIFACT = load_policy_artifact()
    return _ARTIFACT


def _missing_refs(question: dict, registry: dict) -> list[str]:
    return [r["entry_key"] for r in question["guide_refs"] if _find_entry(registry, r["source_id"], r["entry_key"])[1] is None]


def latest_by_question(records: list[dict]) -> dict[str, dict]:
    """records oldest first; the latest record per question is the effective one."""
    out: dict[str, dict] = {}
    for r in records:
        out[r["question_id"]] = r
    return out


def decision_state(question: dict, latest: dict | None, registry: dict) -> dict:
    """Current-state of a question's latest decision. Only CURRENT decisions may be reused."""
    missing = _missing_refs(question, registry)
    if latest is None:
        return {"state": STATE_SOURCE_MISSING if missing else STATE_PENDING, "reasons": [f"missing:{k}" for k in missing]}
    reasons = []
    if latest.get("question_sha256") != question["question_sha256"]:
        reasons.append("QUESTION_CHANGED")
    for e in latest.get("evidence") or []:
        source, entry = _find_entry(registry, e.get("source_id"), e.get("entry_key"))
        if entry is None:
            reasons.append(f"SOURCE_MISSING:{e.get('entry_key')}")
        elif entry["entry_sha256"] != e.get("entry_sha256"):
            reasons.append(f"SOURCE_CHANGED:{e.get('entry_key')}")
    return {"state": STATE_REEVALUATE if reasons else STATE_CURRENT, "reasons": reasons}


def resolve(question: dict, latest: dict | None, state: dict, *, product_group: str, issue_id: str, condition_key: str,
            knowledge_id: str | None = None) -> str:
    """Whether the question's decision applies to one statement. Never a verification."""
    if latest is None:
        return NO_DECISION
    if state["state"] != STATE_CURRENT:
        return REEVALUATION
    if knowledge_id and knowledge_id in (latest.get("exception_knowledge_ids") or []):
        return EXCEPTION
    if product_group not in (latest.get("products") or []):
        return OUT_OF_SCOPE_PRODUCT
    if issue_id not in (latest.get("issue_ids") or []):
        return OUT_OF_SCOPE_CLAIM
    if condition_key != latest.get("condition_key"):
        return OUT_OF_SCOPE_CONDITION
    return APPLIES


def reuse_for(artifact: dict, records: list[dict], registry: dict, *, issue_id: str, product_group: str,
              condition_key: str, knowledge_id: str | None = None) -> dict:
    """Policy lookup for a (possibly new) reply statement. Returns the matching decision only when it applies."""
    latest = latest_by_question(records)
    for qid in artifact["order"]:
        q = artifact["questions"][qid]
        if issue_id not in q["issue_ids"]:
            continue
        rec = latest.get(qid)
        state = decision_state(q, rec, registry)
        result = resolve(q, rec, state, product_group=product_group, issue_id=issue_id, condition_key=condition_key,
                         knowledge_id=knowledge_id)
        return {"question_id": qid, "application": result, "decision": rec["decision"] if result == APPLIES else None,
                "decision_id": rec["decision_id"] if rec else None, "auto_verified": False}
    return {"question_id": None, "application": NO_DECISION, "decision": None, "decision_id": None, "auto_verified": False}


def _card(question: dict, latest: dict | None, state: dict, history_count: int) -> dict:
    replies = question["linked_replies"]
    return {
        **{k: question[k] for k in ("question_id", "title", "question", "conflict_summary", "issue_ids", "guide_conflict",
                                    "products", "conditions", "guide_refs", "notes", "question_sha256")},
        "linked_reply_count": len(replies),
        "authorship_at_audit": {a: sum(1 for r in replies if r["authorship_at_audit"] == a)
                                for a in sorted({r["authorship_at_audit"] for r in replies})},
        "state": state["state"],
        "state_reasons": state["reasons"],
        "latest": latest,
        "latest_record_id": latest["decision_id"] if latest else ROOT,
        "history_count": history_count,
    }


def cards_view(artifact: dict, records: list[dict], registry: dict) -> dict:
    latest = latest_by_question(records)
    cards = []
    for qid in artifact["order"]:
        q = artifact["questions"][qid]
        cards.append(_card(q, latest.get(qid), decision_state(q, latest.get(qid), registry),
                           sum(1 for r in records if r["question_id"] == qid)))
    return {
        "available": artifact["available"],
        "artifact_version": artifact["version"],
        "artifact_sha256": artifact["sha256"],
        "pending_count": sum(1 for c in cards if c["state"] != STATE_CURRENT),
        "counts": {s: sum(1 for c in cards if c["state"] == s) for s in (STATE_PENDING, STATE_CURRENT, STATE_REEVALUATE, STATE_SOURCE_MISSING)},
        "decisions": list(DECISIONS),
        "cards": cards,
        "auto_rules": artifact["auto_rules"],
        "auto_verified": False,
        "generator_connected": False,
    }


def question_detail(question: dict, records: list[dict], registry: dict, corpus_items: dict[str, dict]) -> dict:
    history = [r for r in records if r["question_id"] == question["question_id"]]
    latest = history[-1] if history else None
    state = decision_state(question, latest, registry)
    refs = []
    for r in question["guide_refs"]:
        source, entry = _find_entry(registry, r["source_id"], r["entry_key"])
        refs.append({**r, "available": entry is not None, "authority_class": (source or {}).get("authority_class"),
                     "statement": entry["statement"] if entry else None, "entry_sha256": entry["entry_sha256"] if entry else None})
    members = []
    for m in question["linked_replies"]:
        item = corpus_items.get(m["knowledge_id"])
        pg = (item or {}).get("product_group") or m["product_group"]
        apps = {iid: resolve(question, latest, state, product_group=pg, issue_id=iid, condition_key=m["condition_key"],
                             knowledge_id=m["knowledge_id"]) for iid in m["issue_ids"]}
        members.append({
            **m,
            "product_group": pg,
            "authorship": (item or {}).get("authorship") or m["authorship_at_audit"],
            "review_text": (item or {}).get("review_text"),
            "reply_text": (item or {}).get("reply_text"),
            "reply_available": item is not None,
            "application": apps,
        })
    return {
        **_card(question, latest, state, len(history)),
        "guide_refs": refs,
        "history": list(reversed(history)),
        "members": members,
        "auto_verified": False,
    }


def policy_request_sha256(payload: dict) -> str:
    return _sha({k: v for k, v in payload.items()})


def _str_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def validate_policy_submission(question: dict, latest: dict | None, registry: dict, payload: dict) -> dict:
    """Normalise a policy decision or raise UnitFactValidationError. Never stores anything."""
    if any(k in payload for k in IDENTITY_FIELDS):
        raise UnitFactValidationError("reviewer_fields_not_accepted")
    request_id = str(payload.get("request_id") or "").strip()
    if not request_id:
        raise UnitFactValidationError("POLICY_REQUEST_ID_REQUIRED")
    if str(payload.get("question_sha256") or "") != question["question_sha256"]:
        raise UnitFactValidationError("POLICY_QUESTION_CHANGED", 409)
    supersedes = str(payload.get("supersedes_record_id") or "").strip()
    if supersedes != (latest["decision_id"] if latest else ROOT):
        raise UnitFactValidationError("POLICY_STALE_VIEW", 409)
    missing = _missing_refs(question, registry)
    if missing:
        raise UnitFactValidationError("POLICY_SOURCE_MISSING", 409, missing)
    decision = str(payload.get("decision") or "").strip().upper()
    if decision not in DECISIONS:
        raise UnitFactValidationError("invalid_policy_decision")
    if decision == DECISION_HUMAN_SUPPLEMENT and question["guide_conflict"]:
        raise UnitFactValidationError("POLICY_HUMAN_OVER_GUIDE_NOT_ALLOWED", 409)
    decision_text = str(payload.get("decision_text") or "").strip()
    note = str(payload.get("note") or "").strip()
    if len(decision_text) < _TEXT_MIN:
        raise UnitFactValidationError("policy_decision_text_required")
    if len(note) < _TEXT_MIN:
        raise UnitFactValidationError("policy_reason_required")
    products = sorted(set(_str_list(payload.get("products"))))
    if not products or not set(products) <= set(question["products"]):
        raise UnitFactValidationError("POLICY_PRODUCT_OUT_OF_SCOPE", 400, question["products"])
    issue_ids = sorted(set(_str_list(payload.get("issue_ids"))))
    if not issue_ids or not set(issue_ids) <= set(question["issue_ids"]):
        raise UnitFactValidationError("POLICY_CLAIM_OUT_OF_SCOPE", 400, question["issue_ids"])
    condition_key = str(payload.get("condition_key") or "").strip()
    if condition_key not in {c["key"] for c in question["conditions"]}:
        raise UnitFactValidationError("POLICY_CONDITION_OUT_OF_SCOPE")
    linked = {m["knowledge_id"] for m in question["linked_replies"]}
    exceptions = sorted(set(_str_list(payload.get("exception_knowledge_ids"))))
    if not set(exceptions) <= linked:
        raise UnitFactValidationError("POLICY_EXCEPTION_NOT_LINKED")
    allowed_refs = {(r["source_id"], r["entry_key"]) for r in question["guide_refs"]}
    evidence = []
    for e in payload.get("evidence") or []:
        sid, key = str((e or {}).get("source_id") or ""), str((e or {}).get("entry_key") or "")
        if (sid, key) not in allowed_refs:
            raise UnitFactValidationError("POLICY_EVIDENCE_NOT_LINKED", 400, key)
        source, entry = _find_entry(registry, sid, key)
        evidence.append({"source_id": sid, "source_version": source.get("version"), "source_sha256": source.get("sha256"),
                         "authority_class": source.get("authority_class"), "entry_key": key,
                         "entry_sha256": entry["entry_sha256"], "excerpt": entry["statement"]})
    if decision == DECISION_GUIDE_STANDARD and not evidence:
        raise UnitFactValidationError("POLICY_EVIDENCE_REQUIRED")
    return {
        "request_id": request_id,
        "supersedes_record_id": supersedes,
        "decision": decision,
        "decision_text": decision_text,
        "note": note,
        "products": products,
        "issue_ids": issue_ids,
        "condition_key": condition_key,
        "exception_knowledge_ids": exceptions,
        "evidence": evidence,
        "source_registry_version": registry["registry_version"],
    }
