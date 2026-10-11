"""Shorts narration fit: one constrained reduction proposal -> machine validation -> human decision -> revision.

Before a human APPROVED decision nothing in the artifact's scenes changes; the proposal lives only under
body["shorts_narration_fit"]. Durations here are pre-TTS estimates (provisional); the measured TTS duration
after apply stays the final timing authority.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import Body, Depends, HTTPException
from sqlalchemy.orm import Session

from content_center_engine import _new_id
from content_shorts import STAGES, NARRATION_ESTIMATOR, classify_narration_duration, narration_budget, narration_speech_chars, narration_text, scene_narration_state
from content_shorts_claims import SNAPSHOT_AUTHORITY, claim_grounding_for_scenes, compare_claim_usage
from db import ContentArtifact, ContentReviewEvent

CONTRACT_VERSION = "shorts_narration_fit_v1"
FIT_KEY = "shorts_narration_fit"
LINEAGE_KEY = "shorts_narration_fit_lineage"
DECISIONS = ("PENDING", "APPROVED", "REJECTED", "REVISION_REQUIRED")
PROPOSAL_READY = "PROPOSAL_READY"
PROPOSAL_HOLD = "HOLD_NARRATION_FIT_PROPOSAL"
ESTIMATOR_AUTHORITY = "PROVISIONAL_CONSERVATIVE_ESTIMATOR"
REDUCER_ROLE = "CONSTRAINED_NARRATION_REDUCER"
REDUCER_MAX_TOKENS = 8000
WRITER_ATTEMPTS = 1
# Connective particles left after removing every claimText (e.g. "또", "요") may stay uncovered.
UNCOVERED_TEXT_MAX_CHARS = 4
REALLOCATION = {"stepSec": 0.5, "maxShiftSec": 2.0, "minSceneSec": 2.5, "minHookCtaSec": 3.0}

# Marketing role is a separate axis from the stage name; the stage contract (content_shorts.STAGES) decides it.
STAGE_MARKETING_ROLE = {
    "HOOK": "HOOK_INTENT",
    "PROBLEM": "CONSUMER_PROBLEM",
    "BEFORE": "CONSUMER_PROBLEM",
    "INFO": "INFORMATIVE_VALUE",
    "MYTH": "INFORMATIVE_VALUE",
    "CRITERIA_1": "INFORMATIVE_VALUE",
    "CRITERIA_2": "INFORMATIVE_VALUE",
    "STEP_1": "INFORMATIVE_VALUE",
    "STEP_2": "INFORMATIVE_VALUE",
    "STEP_3": "INFORMATIVE_VALUE",
    "PRODUCT": "PRODUCT_VALUE",
    "PRODUCT_POINT_1": "PRODUCT_VALUE",
    "PRODUCT_POINT_2": "PRODUCT_VALUE",
    "PRODUCT_POINT_3": "PRODUCT_VALUE",
    "EXPERIENCE": "CUSTOMER_EXPERIENCE",
    "PROOF": "CUSTOMER_EXPERIENCE",
    "CTA": "CTA",
}
MARKETING_ROLES = ("HOOK_INTENT", "CONSUMER_PROBLEM", "INFORMATIVE_VALUE", "PRODUCT_VALUE", "CUSTOMER_EXPERIENCE", "CTA")
# These two roles are carried by claim types, wherever the scene sits.
ROLE_CLAIM_TYPES = {"PRODUCT_VALUE": ("PRODUCT_FACT", "USAGE_FACT"), "CUSTOMER_EXPERIENCE": ("CUSTOMER_EXPERIENCE",)}
GATE_HOLD_REASON = {
    "INVALID_REF_PRESENT": "INVALID_REF",
    "UNSUPPORTED_PRESENT": "UNSUPPORTED",
    "ATTRIBUTION_MISSING_PRESENT": "ATTRIBUTION_MISSING",
    "REVIEW_GENERALIZATION_OVERREACH_PRESENT": "REVIEW_GENERALIZATION_OVERREACH",
    "EFFICACY_SENSITIVE_REVIEW_UNRESOLVED": "EFFICACY_SENSITIVE_REVIEW_REQUIRED",
}

REDUCER_RULES = [
    "Shorten each scene's narration (proposedNarration) so the whole video can be spoken within the target. You are a reducer, not a writer.",
    "Return every scene in the same order, even if its narration stays the same. Scene count is fixed.",
    "Use only claimIds from that scene's allowedClaims. Never invent facts, numbers, ingredients, product names, effects or review content, and never move content between scenes.",
    "For every claim you keep, claims[].claimText must be copied exactly from proposedNarration, and every anchorTerm of that claim must stay verbatim in proposedNarration.",
    "Every part of proposedNarration must belong to one of its claims (EDITORIAL_BRIDGE claims cover connective sentences). Do not add uncovered sentences.",
    "You may drop claims to save time. Removing information is allowed; changing or strengthening it is not. Never go beyond the claim's claimText or canonicalStatement.",
    "CUSTOMER_EXPERIENCE narration must keep its review attribution (e.g. 한 후기는, 한 고객은, 후기에는) inside the same narration. Never drop attribution to save characters.",
    "An INDIVIDUAL_REVIEW stays one person's experience. Never turn it into prevalence (많은, 대부분, 자주, 반복적으로, 여러 후기, 다들).",
    "Never add efficacy or medical wording (효과, 개선, 치료, 완화, 재생, 탈모, 예방, 보장, 100%, 즉시, 완벽) unless it is already in that claim's original claimText.",
    "Keep each scene's marketingRole: HOOK_INTENT grabs attention, CONSUMER_PROBLEM states the customer's situation, PRODUCT_VALUE keeps the product value, CUSTOMER_EXPERIENCE keeps an attributed experience, CTA invites the next action.",
    "Aim for budget.preferredTotalSpeechChars in total and never exceed budget.hardTotalSpeechChars. suggestedSpeechChars per scene is guidance only: the system may re-split the video duration between scenes afterwards. Do not output durations.",
    "speechChars = characters excluding spaces and punctuation. Write natural spoken Korean; never cut a word or sentence mid-way.",
    "Leave proposedSubtitle and proposedOnScreenText null unless the shortened narration would contradict them. If you change one, give its claims under the same rules.",
    "Do not output statuses, flags or estimates; the system computes them.",
]

REVISION_RULES = [
    "A human reviewer sent the previous proposal back (REVISION_REQUIRED) for spoken-Korean quality, not grounding. Follow humanRevision for every scene.",
    "exampleDirection is a direction, not required text. Every grounding rule above still wins: anchorTerms verbatim, claimText an exact substring, no new claims.",
    "Every sentence must be a complete spoken Korean sentence ending in a predicate (…요, …다, …죠, …까) or a question. Never end on a bare noun or a noun list.",
    "Consecutive scenes must not open with the same words. Vary individual review attribution (e.g. 한 후기에서는 / 다른 후기에는 / 또 다른 후기에서는) while each stays one individual review.",
    "Keep every term in a scene's preserve list, and do not cut CTA context the reviewer asked to keep.",
    "Natural wording may be slightly longer than the previous proposal; stay within budget.hardTotalSpeechChars.",
    "verdict KEEP: return keepText (or previousProposedNarration when keepText is empty) verbatim as proposedNarration, and use every requiredClaimIds entry with claimText equal to that text.",
    "If previousEstimatedSec exceeded previousSceneSec, shorten that scene minimally without breaking the sentence. Keep the total near budget.preferredTotalSpeechChars so the system can fit every scene when it re-splits the 30 seconds.",
]
REVISION_VERDICTS = ("KEEP", "MINOR_EDIT", "REWRITE_REQUIRED")
PREDICATE_ENDINGS = ("요", "다", "죠", "까", "네")
QA_AUTHORITY = "DETERMINISTIC_HEURISTIC_HUMAN_REVIEW_STILL_REQUIRED"


class NarrationFitError(ValueError):
    """Contract violation; the message is a stable code for the API."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sha(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _clean(value: Any, limit: int = 260) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _sec(units: int, step: float) -> float | int:
    value = round(units * step, 3)
    return int(value) if float(value).is_integer() else value


def _load_body(row: ContentArtifact) -> dict[str, Any]:
    try:
        body = json.loads(row.body_json or "{}")
    except Exception:
        body = {}
    return body if isinstance(body, dict) else {}


def _save_body(db: Session, row: ContentArtifact, body: dict[str, Any]) -> None:
    row.body_json = json.dumps(body, ensure_ascii=False)
    db.add(row)
    db.commit()
    db.refresh(row)


def shorts_scenes(body: dict[str, Any]) -> list[dict[str, Any]]:
    container = body.get("shorts") if isinstance(body.get("shorts"), dict) else body
    scenes = container.get("scenes") if isinstance(container.get("scenes"), list) else body.get("scenes")
    return [s for s in scenes or [] if isinstance(s, dict)]


def scenes_fingerprint(scenes: list[dict[str, Any]]) -> str:
    keys = ("order", "stage", "duration_sec", "voice_over", "spoken_script", "subtitle", "on_screen_text", "claims")
    return _sha([{k: s.get(k) for k in keys} for s in scenes])


def _video_sec(body: dict[str, Any], scenes: list[dict[str, Any]]) -> float:
    resolved = ((body.get("shorts_generation_config") or {}).get("resolved") or {}) if isinstance(body.get("shorts_generation_config"), dict) else {}
    try:
        return float(resolved.get("duration") or sum(float(s.get("duration_sec") or 0) for s in scenes))
    except (TypeError, ValueError):
        return 0.0


def _field_claims(scene: dict[str, Any], field: str) -> list[dict[str, Any]]:
    return [c for c in scene.get("claims") or [] if isinstance(c, dict) and c.get("field") == field]


def _estimate_ms(text: str) -> int | None:
    return narration_budget(1, text)["estimatedDurationMs"]


# ------------------------------------------------------------------ budget / roles / reallocation

def narration_budget_plan(scenes: list[dict[str, Any]], video_sec: float) -> dict[str, Any]:
    """Guidance for the reducer only. Derived from the provisional estimator, never a hard writer rule."""
    n = len(scenes)
    overhead, per_char = float(NARRATION_ESTIMATOR["overheadSec"]), float(NARRATION_ESTIMATOR["secPerSpeechChar"])
    hard = max(0, int((video_sec - n * overhead) / per_char))
    # Half a reallocation step per scene is lost on average when durations snap to the grid.
    preferred = max(0, int((video_sec - n * (overhead + REALLOCATION["stepSec"] / 2)) / per_char))
    chars = [narration_speech_chars(narration_text(s)) for s in scenes]
    total = sum(chars) or 1
    return {
        "estimatorVersion": NARRATION_ESTIMATOR["estimatorVersion"],
        "estimatorAuthority": ESTIMATOR_AUTHORITY,
        "formula": f"sceneSec = {overhead} + {per_char} * speechChars",
        "videoTargetSec": video_sec,
        "originalTotalSpeechChars": sum(chars),
        "hardTotalSpeechChars": hard,
        "preferredTotalSpeechChars": preferred,
        "suggestedSpeechChars": {str(s.get("order")): max(1, int(c * preferred / total)) for s, c in zip(scenes, chars)},
    }


def marketing_roles(scenes: list[dict[str, Any]]) -> list[str]:
    roles: set[str] = set()
    for scene in scenes:
        claims = _field_claims(scene, "voice_over")
        if not narration_text(scene) or not claims:
            continue
        role = STAGE_MARKETING_ROLE.get(str(scene.get("stage") or "").upper())
        if role and role not in ROLE_CLAIM_TYPES:
            roles.add(role)
        for claim_role, types in ROLE_CLAIM_TYPES.items():
            if any(str(c.get("claimType") or "").upper() in types for c in claims):
                roles.add(claim_role)
    return [r for r in MARKETING_ROLES if r in roles]


def reallocate_scene_durations(items: list[dict[str, Any]], *, total_sec: float, constraints: dict[str, Any] | None = None) -> dict[str, Any]:
    """Deterministic grid search inside fixed total and scene count.

    Objective (lexicographic): estimated overflow, overflow scene count, total shift, largest shift.
    items: [{"order", "stage", "currentSec", "estimatedMs"}]
    """
    c = {**REALLOCATION, **(constraints or {})}
    step = float(c["stepSec"])
    total_u = int(round(total_sec / step))
    shift_u = int(round(float(c["maxShiftSec"]) / step))
    cur_u = [int(round(float(i["currentSec"]) / step)) for i in items]
    bounds = []
    for item, cu in zip(items, cur_u):
        floor_sec = c["minHookCtaSec"] if str(item.get("stage") or "").upper() in ("HOOK", "CTA") else c["minSceneSec"]
        lo = max(int(round(float(floor_sec) / step)), cu - shift_u)
        bounds.append((lo, max(lo, cu + shift_u)))
    est = [int(i["estimatedMs"]) if i.get("estimatedMs") is not None else 0 for i in items]
    suffix_lo = [sum(b[0] for b in bounds[k:]) for k in range(len(bounds) + 1)]
    suffix_hi = [sum(b[1] for b in bounds[k:]) for k in range(len(bounds) + 1)]
    best: tuple | None = None
    best_alloc: list[int] | None = None

    def visit(k: int, remaining: int, alloc: list[int]) -> None:
        nonlocal best, best_alloc
        if k == len(items):
            if remaining != 0:
                return
            overflow = [max(0, e - int(round(u * step * 1000))) for e, u in zip(est, alloc)]
            shifts = [abs(u - cu) for u, cu in zip(alloc, cur_u)]
            score = (sum(overflow), sum(1 for o in overflow if o), sum(shifts), max(shifts or [0]), tuple(alloc))
            if best is None or score < best:
                best, best_alloc = score, list(alloc)
            return
        lo, hi = bounds[k]
        for u in range(lo, hi + 1):
            rest = remaining - u
            if suffix_lo[k + 1] <= rest <= suffix_hi[k + 1]:
                alloc.append(u)
                visit(k + 1, rest, alloc)
                alloc.pop()

    if items and suffix_lo[0] <= total_u <= suffix_hi[0]:
        visit(0, total_u, [])
    feasible = best_alloc is not None
    alloc_u = best_alloc if feasible else cur_u
    allocation = [_sec(u, step) for u in alloc_u]
    overflow_ms = [max(0, e - int(round(u * step * 1000))) for e, u in zip(est, alloc_u)]
    return {
        "method": "DETERMINISTIC_GRID_SEARCH",
        "constraints": {**c, "totalSec": total_sec, "sceneCount": len(items), "sceneDeletion": "NOT_ALLOWED", "sceneAddition": "NOT_ALLOWED"},
        "objectiveOrder": ["estimatedOverflowMs", "overflowScenes", "totalShiftSec", "maxShiftSec"],
        "feasible": feasible,
        "currentSec": [_sec(u, step) for u in cur_u],
        "allocationSec": allocation,
        "totalSec": _sec(sum(alloc_u), step),
        "changedSceneOrders": [i.get("order") for i, u, cu in zip(items, alloc_u, cur_u) if u != cu],
        "estimatedOverflowMs": sum(overflow_ms),
        "overflowSceneOrders": [i.get("order") for i, o in zip(items, overflow_ms) if o],
        "status": "ALL_SCENES_ESTIMATED_FIT" if feasible and not any(overflow_ms) else "ESTIMATED_OVERFLOW_REMAINS",
        "authority": ESTIMATOR_AUTHORITY,
    }


# ------------------------------------------------------------------ reducer input / output

def _catalog_entries(snapshot: dict[str, Any] | None) -> dict[str, Any]:
    catalog = (snapshot or {}).get("allowedEvidenceCatalog") if isinstance(snapshot, dict) else None
    return catalog.get("entries") if isinstance(catalog, dict) and isinstance(catalog.get("entries"), dict) else {}


def reducer_messages(body: dict[str, Any], revision: dict[str, Any] | None = None) -> list[dict[str, str]]:
    scenes = shorts_scenes(body)
    entries = _catalog_entries(body.get("shorts_grounding"))
    budget = narration_budget_plan(scenes, _video_sec(body, scenes))
    scene_inputs = []
    for s in scenes:
        stage = str(s.get("stage") or "").upper()
        allowed = []
        for c in s.get("claims") or []:
            refs = [entries.get(r) or {} for r in c.get("evidenceRefs") or []]
            allowed.append({
                "claimId": c.get("claimId"),
                "claimType": c.get("claimType"),
                "field": c.get("field"),
                "claimText": c.get("claimText"),
                "canonicalStatement": c.get("canonicalStatement") or "",
                "anchorTerms": c.get("anchorTerms") or [],
                "experienceKind": c.get("experienceKind"),
                "evidenceAuthority": sorted({str(e.get("authority")) for e in refs if e.get("authority")}),
                "reviewEvidenceKind": sorted({str(e.get("reviewEvidenceKind")) for e in refs if e.get("reviewEvidenceKind")}),
                "usagePolicy": sorted({str(e.get("usagePolicy")) for e in refs if e.get("usagePolicy")}),
            })
        text = narration_text(s)
        scene_inputs.append({
            "order": s.get("order"),
            "stage": stage,
            "stagePurpose": (STAGES.get(stage) or {}).get("purpose", ""),
            "marketingRole": STAGE_MARKETING_ROLE.get(stage),
            "currentSceneDurationSec": s.get("duration_sec"),
            "originalNarration": text,
            "speechChars": narration_speech_chars(text),
            "estimatedSec": round((_estimate_ms(text) or 0) / 1000, 2),
            "suggestedSpeechChars": budget["suggestedSpeechChars"].get(str(s.get("order"))),
            "subtitle": s.get("subtitle") or "",
            "onScreenText": s.get("on_screen_text") or "",
            "allowedClaims": allowed,
        })
    user = {
        "task": "Reduce the narration of this Korean short-form video. Keep evidence scope, claim meaning, stage purpose and marketing role.",
        "role": REDUCER_ROLE,
        "rules": REDUCER_RULES,
        "budget": budget,
        "scenes": scene_inputs,
        "outputSchema": {
            "scenes": [{
                "order": "int (same as input)",
                "proposedNarration": "string",
                "claims": [{"claimId": "one of allowedClaims", "claimText": "exact substring of proposedNarration"}],
                "editorialPurpose": "short Korean note on what this scene keeps",
                "proposedSubtitle": "string or null",
                "subtitleClaims": [{"claimId": "...", "claimText": "..."}],
                "proposedOnScreenText": "string or null",
                "onScreenTextClaims": [{"claimId": "...", "claimText": "..."}],
            }]
        },
    }
    if revision:
        instructions = revision.get("instructions") or {}
        notes = {str(i.get("order")): i for i in instructions.get("scenes") or []}
        previous = {str(s.get("order")): s for s in revision.get("previousScenes") or []}
        user["task"] = "Revise the previous narration reduction of this Korean short-form video following the human reviewer. Keep evidence scope, claim meaning, stage purpose and marketing role."
        user["rules"] = REDUCER_RULES + REVISION_RULES
        user["humanRevision"] = {
            "round": revision.get("round"),
            "previousProposalId": revision.get("previousProposalId"),
            "reviewerDecision": "REVISION_REQUIRED",
            "general": instructions.get("general") or [],
            "forbidden": instructions.get("forbidden") or [],
            "scenes": [{
                "order": s.get("order"),
                "previousProposedNarration": (previous.get(str(s.get("order"))) or {}).get("proposedNarration"),
                "previousEstimatedSec": round(((previous.get(str(s.get("order"))) or {}).get("estimatedDurationMs") or 0) / 1000, 2),
                "previousSceneSec": (previous.get(str(s.get("order"))) or {}).get("proposedSceneDurationSec"),
                **{k: v for k, v in (notes.get(str(s.get("order"))) or {"verdict": "KEEP"}).items() if k != "order"},
            } for s in scenes],
        }
    return [
        {"role": "system", "content": "You are a CONSTRAINED NARRATION REDUCER for Korean short-form video narration. You only shorten existing, already-grounded narration and never create new claims. Respond with one JSON object only."},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]


def _ledger(raw: Any, allowed: dict[str, dict[str, Any]], field: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Writer may only point at existing claim ids; claim type, refs and anchors always come from the original ledger."""
    out: list[dict[str, Any]] = []
    new: list[str] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        cid = _clean(item.get("claimId"), 80)
        text = _clean(item.get("claimText"), 240)
        if not cid or cid in seen:
            continue
        seen.add(cid)
        if cid not in allowed:
            new.append(cid)
            continue
        base = allowed[cid]
        claim = {k: copy.deepcopy(base[k]) for k in ("claimId", "claimType", "canonicalStatement", "anchorTerms", "evidenceRefs", "experienceKind") if k in base}
        claim.update(field=field, claimText=text)
        out.append(claim)
    return out, new


def _uncovered_chars(text: str, claims: list[dict[str, Any]]) -> int:
    rest = text
    for c in sorted(claims, key=lambda x: -len(x.get("claimText") or "")):
        t = c.get("claimText") or ""
        if t and t in rest:
            rest = rest.replace(t, " ", 1)
    return narration_speech_chars(rest)


def _export_text(scenes: list[dict[str, Any]]) -> str:
    return "\n\n".join(
        f"[Scene {s.get('order')} | {s.get('duration_sec')}s]\nOn-screen: {s.get('on_screen_text') or ''}\nSubtitle: {s.get('subtitle') or ''}\nVoice-over: {s.get('voice_over') or ''}\nVisual: {s.get('visual_direction') or ''}\nTransition: {s.get('transition') or ''}\nCTA: {s.get('cta') or ''}"
        for s in scenes
    )


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", str(text or ""))


def _sentence_complete(text: str) -> bool:
    for segment in re.findall(r"[^.!?]+[.!?]*", text):
        segment = segment.strip()
        if not segment or segment[-1] in "?!":
            continue
        core = segment.rstrip(".…\"'” )")
        if core and not core.endswith(PREDICATE_ENDINGS):
            return False
    return True


def _opener(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", text).split()[:2])


def natural_language_qa(rows: list[dict[str, Any]], instructions: dict[str, Any] | None = None, previous_scenes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Cheap spoken-Korean checks for known failure shapes; passing them does not replace human listening.

    Only explicit scene-level instructions are enforced (KEEP text, preserve terms, required claim ids); free-text notes are not interpreted.
    """
    issues: list[dict[str, Any]] = []
    for r in rows:
        text = str(r.get("proposedNarration") or "").strip()
        if text and not _sentence_complete(text):
            issues.append({"order": r.get("order"), "code": "NARRATION_SENTENCE_INCOMPLETE"})
    for prev, cur in zip(rows, rows[1:]):
        opener = _opener(str(cur.get("proposedNarration") or ""))
        if opener and opener == _opener(str(prev.get("proposedNarration") or "")):
            issues.append({"order": cur.get("order"), "code": "NARRATION_OPENER_REPEATED", "detail": opener})
    by_order = {str(r.get("order")): r for r in rows}
    previous = {str(s.get("order")): str(s.get("proposedNarration") or "") for s in previous_scenes or []}
    for item in (instructions or {}).get("scenes") or []:
        order = str(item.get("order"))
        row = by_order.get(order) or {}
        text = str(row.get("proposedNarration") or "")
        missing = [t for t in item.get("preserve") or [] if _squash(t) not in _squash(text)]
        if missing:
            issues.append({"order": item.get("order"), "code": "HUMAN_REVISION_PRESERVE_TERM_MISSING", "detail": missing})
        unmet = {}
        if item.get("verdict") == "KEEP":
            expected = item.get("keepText") or previous.get(order)
            if expected and _clean(text) != _clean(expected):
                unmet["expectedText"] = expected
        absent = [c for c in item.get("requiredClaimIds") or [] if c not in (row.get("claimIdsUsed") or [])]
        if absent:
            unmet["missingClaimIds"] = absent
        if unmet:
            issues.append({"order": item.get("order"), "code": "HUMAN_REVISION_INSTRUCTION_NOT_SATISFIED", "detail": unmet})
    return {
        "checks": ["NARRATION_SENTENCE_INCOMPLETE", "NARRATION_OPENER_REPEATED", "HUMAN_REVISION_PRESERVE_TERM_MISSING", "HUMAN_REVISION_INSTRUCTION_NOT_SATISFIED"],
        "issues": issues,
        "issueCount": len(issues),
        "status": "PASS" if not issues else "HOLD",
        "authority": QA_AUTHORITY,
    }


def sanitize_revision_instructions(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    texts = lambda v, n=12, size=240: [_clean(x, size) for x in (v if isinstance(v, list) else [])[:n] if _clean(x, size)]  # noqa: E731
    scenes = []
    for item in raw.get("scenes") if isinstance(raw.get("scenes"), list) else []:
        if not isinstance(item, dict) or item.get("order") is None:
            continue
        verdict = str(item.get("verdict") or "").upper()
        scenes.append({
            "order": item.get("order"),
            "verdict": verdict if verdict in REVISION_VERDICTS else "MINOR_EDIT",
            "issues": texts(item.get("issues")),
            "preserve": texts(item.get("preserve"), 12, 60),
            "direction": _clean(item.get("direction"), 400),
            "exampleDirection": _clean(item.get("exampleDirection") or item.get("example"), 240),
            "keepText": _clean(item.get("keepText"), 240),
            "requiredClaimIds": texts(item.get("requiredClaimIds"), 12, 80),
        })
    out = {"general": texts(raw.get("general")), "forbidden": texts(raw.get("forbidden")), "scenes": scenes}
    return out if out["general"] or out["forbidden"] or scenes else None


def _proposal_digest(proposal: dict[str, Any], decision: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "proposalId": proposal.get("proposalId"),
        "proposalSha256": proposal.get("proposalSha256"),
        "status": proposal.get("status"),
        "holdReasons": proposal.get("holdReasons"),
        "revision": proposal.get("revision"),
        "totals": proposal.get("totals"),
        "proposedSceneAllocation": proposal.get("proposedSceneAllocation"),
        "claimComparison": {k: (proposal.get("claimComparison") or {}).get(k) for k in ("preserved", "removed", "new")},
        "naturalLanguageQa": proposal.get("naturalLanguageQa") or natural_language_qa(proposal.get("scenes") or []),
        "scenes": [{k: s.get(k) for k in ("order", "proposedNarration", "proposedChars", "estimatedDurationMs", "proposedSceneDurationSec", "claimIdsRemoved")} for s in proposal.get("scenes") or []],
        "humanDecision": decision,
    }


def proposal_sha256(proposal: dict[str, Any]) -> str:
    payload = {
        "proposalId": proposal.get("proposalId"),
        "scenes": [{k: s.get(k) for k in ("order", "proposedNarration", "proposedSubtitle", "proposedOnScreenText", "claims", "proposedSceneDurationSec")} for s in proposal.get("scenes") or []],
        "allocation": proposal.get("proposedSceneAllocation"),
    }
    if proposal.get("revision"):
        payload["revision"] = proposal["revision"]
    return _sha(payload)


def build_proposal(
    body: dict[str, Any],
    writer_output: dict[str, Any],
    *,
    proposal_id: str,
    created_at: str,
    writer_meta: dict[str, Any] | None = None,
    compliance: dict[str, Any] | None = None,
    revision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Pure: validates a reducer output against the artifact's own ledger and generation-time snapshot."""
    scenes = shorts_scenes(body)
    snapshot = body.get("shorts_grounding") if isinstance(body.get("shorts_grounding"), dict) else None
    video_sec = _video_sec(body, scenes)
    raw_scenes = writer_output.get("scenes") if isinstance(writer_output, dict) and isinstance(writer_output.get("scenes"), list) else []
    by_order: dict[str, dict[str, Any]] = {}
    for item in raw_scenes:
        if isinstance(item, dict) and str(item.get("order")) not in by_order:
            by_order[str(item.get("order"))] = item
    hold: list[str] = []
    warnings: list[str] = []
    source_orders = [str(s.get("order")) for s in scenes]
    if set(by_order) - set(source_orders):
        hold.append("WRITER_OUTPUT_UNKNOWN_SCENE")

    proposed_scenes: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for s in scenes:
        order = str(s.get("order"))
        out = by_order.get(order)
        issues: list[str] = []
        if out is None:
            issues.append("WRITER_OUTPUT_SCENE_MISSING")
            out = {}
        allowed = {c["claimId"]: c for c in s.get("claims") or [] if isinstance(c, dict) and c.get("claimId")}
        original_text = narration_text(s)
        text = _clean(out.get("proposedNarration")) if out else original_text
        narr_claims, new_ids = _ledger(out.get("claims"), allowed, "voice_over")
        proposed = copy.deepcopy(s)
        proposed["voice_over"] = text
        proposed["spoken_script"] = text
        field_claims = {"voice_over": narr_claims}
        changed_fields = {}
        for field, key, claims_key in (("subtitle", "proposedSubtitle", "subtitleClaims"), ("on_screen_text", "proposedOnScreenText", "onScreenTextClaims")):
            value = _clean(out.get(key), 90) if out.get(key) else ""
            if value and value != _clean(s.get(field), 90):
                claims, extra_new = _ledger(out.get(claims_key), allowed, field)
                new_ids += extra_new
                proposed[field] = value
                if field == "subtitle":
                    proposed["caption"] = value
                field_claims[field] = claims
                changed_fields[field] = value
            else:
                field_claims[field] = copy.deepcopy(_field_claims(s, field))
        others = [copy.deepcopy(c) for c in s.get("claims") or [] if isinstance(c, dict) and c.get("field") not in ("voice_over", "subtitle", "on_screen_text")]
        proposed["claims"] = field_claims["voice_over"] + field_claims["subtitle"] + field_claims["on_screen_text"] + others
        proposed_scenes.append(proposed)

        original_narr = _field_claims(s, "voice_over")
        original_ids = [c["claimId"] for c in original_narr]
        used = [c["claimId"] for c in narr_claims]
        basis = original_narr + [allowed[c] for c in used if c not in original_ids]
        usage = compare_claim_usage(basis, used + new_ids, original_text=original_text, proposal_text=text)
        if new_ids:
            issues.append("NEW_CLAIM_INTRODUCED")
        if not text:
            issues.append("NARRATION_EMPTY")
        if usage["preservedAnchorsMissing"]:
            issues.append("PRESERVED_CLAIM_ANCHOR_MISSING")
        if usage["restrictedPatternsAdded"]:
            issues.append("RESTRICTED_PATTERN_ADDED")
        if text and _uncovered_chars(text, narr_claims) > UNCOVERED_TEXT_MAX_CHARS:
            issues.append("NARRATION_TEXT_NOT_COVERED_BY_CLAIMS")
        if changed_fields:
            warnings.append(f"SUPPORTING_TEXT_CHANGED:{order}")
        hold += issues
        rows.append({
            "sceneId": f"scene_{order}",
            "order": s.get("order"),
            "stage": s.get("stage"),
            "marketingRole": STAGE_MARKETING_ROLE.get(str(s.get("stage") or "").upper()),
            "originalNarration": original_text,
            "proposedNarration": text,
            "originalChars": len(original_text),
            "proposedChars": len(text),
            "originalSpeechChars": narration_speech_chars(original_text),
            "proposedSpeechChars": narration_speech_chars(text),
            "originalEstimatedMs": _estimate_ms(original_text),
            "estimatedDurationMs": _estimate_ms(text),
            "currentSceneDurationSec": s.get("duration_sec"),
            "claimIdsUsed": used,
            "claimIdsRemoved": usage["removedClaimIds"],
            "claimIdsNew": new_ids,
            "claimIdsReusedFromOtherField": [c for c in used if c not in original_ids],
            "removedClaims": [{k: c.get(k) for k in ("claimId", "claimType", "claimText", "canonicalStatement", "evidenceRefs")} for c in original_narr if c["claimId"] in usage["removedClaimIds"]],
            "preservedAnchorsMissing": usage["preservedAnchorsMissing"],
            "restrictedPatternsAdded": usage["restrictedPatternsAdded"],
            "editorialPurpose": _clean(out.get("editorialPurpose"), 160),
            "originalSubtitle": s.get("subtitle") or "",
            "proposedSubtitle": changed_fields.get("subtitle"),
            "originalOnScreenText": s.get("on_screen_text") or "",
            "proposedOnScreenText": changed_fields.get("on_screen_text"),
            "claims": proposed["claims"],
            "issues": issues,
        })

    # Hash-bound human reviews stay valid only for claims whose exact text is unchanged.
    grounding = claim_grounding_for_scenes(proposed_scenes, snapshot, body.get("shorts_claim_reviews"))
    gate = grounding.get("narrationFitGate") or {}
    totals = grounding.get("totals") or {}
    if grounding.get("status") != "TRACEABLE":
        hold.append("SCENE_CLAIM_LEDGER_INCOMPLETE")
    hold += [GATE_HOLD_REASON.get(b, b) for b in gate.get("blockers") or []]

    original_roles = marketing_roles(scenes)
    proposal_roles = marketing_roles(proposed_scenes)
    lost = [r for r in original_roles if r not in proposal_roles]
    if lost:
        hold.append("MARKETING_ROLE_LOST")

    reallocation = reallocate_scene_durations(
        [{"order": r["order"], "stage": r["stage"], "currentSec": r["currentSceneDurationSec"], "estimatedMs": r["estimatedDurationMs"]} for r in rows],
        total_sec=video_sec,
    )
    for r, sec in zip(rows, reallocation["allocationSec"]):
        r["proposedSceneDurationSec"] = sec
        r["originalEstimatedStatus"] = classify_narration_duration(r["originalEstimatedMs"], int(round(float(r["currentSceneDurationSec"] or 0) * 1000)))
        r["proposedEstimatedStatus"] = classify_narration_duration(r["estimatedDurationMs"], int(round(float(sec) * 1000)))
    original_total = sum(r["originalEstimatedMs"] or 0 for r in rows)
    proposed_total = sum(r["estimatedDurationMs"] or 0 for r in rows)
    video_ms = int(round(video_sec * 1000))
    if proposed_total >= original_total:
        hold.append("ESTIMATED_TIMING_NOT_IMPROVED")
    if proposed_total > video_ms:
        hold.append("ESTIMATED_TOTAL_OVERFLOW")
    if reallocation["overflowSceneOrders"]:
        warnings.append("ESTIMATED_SCENE_OVERFLOW_AFTER_REALLOCATION")
    if compliance is not None and not compliance.get("allowed", False):
        hold.append("COMPLIANCE_GATE_FAILED")
    qa = natural_language_qa(rows, (revision or {}).get("instructions"), (revision or {}).get("previousScenes"))
    for issue in qa["issues"]:
        hold.append(issue["code"])
        for r in rows:
            if str(r["order"]) == str(issue["order"]) and issue["code"] not in r["issues"]:
                r["issues"].append(issue["code"])
    if revision:
        qa["previousIssueCount"] = natural_language_qa(revision.get("previousScenes") or [])["issueCount"]

    preserved = [c for r in rows for c in r["claimIdsUsed"]]
    removed = [c for r in rows for c in r["claimIdsRemoved"]]
    new = [c for r in rows for c in r["claimIdsNew"]]
    hold_reasons = sorted(set(hold), key=hold.index)
    proposal = {
        "proposalId": proposal_id,
        "status": PROPOSAL_HOLD if hold_reasons else PROPOSAL_READY,
        "holdReasons": hold_reasons,
        "warnings": sorted(set(warnings), key=warnings.index),
        "scenes": rows,
        "currentSceneAllocation": reallocation["currentSec"],
        "proposedSceneAllocation": reallocation["allocationSec"],
        "reallocation": reallocation,
        "estimatedDurationMs": proposed_total,
        "estimatedSceneOverflowCount": len(reallocation["overflowSceneOrders"]),
        "totals": {
            "videoTargetMs": video_ms,
            "originalEstimatedMs": original_total,
            "proposedEstimatedMs": proposed_total,
            "originalChars": sum(r["originalChars"] for r in rows),
            "proposedChars": sum(r["proposedChars"] for r in rows),
            "originalSpeechChars": sum(r["originalSpeechChars"] for r in rows),
            "proposedSpeechChars": sum(r["proposedSpeechChars"] for r in rows),
            "estimatorAuthority": ESTIMATOR_AUTHORITY,
        },
        "claimComparison": {"preserved": len(preserved), "removed": len(removed), "new": len(new), "preservedClaimIds": preserved, "removedClaimIds": removed, "newClaimIds": new},
        "semanticValidation": {
            "totals": totals,
            "riskCounts": grounding.get("riskCounts"),
            "readiness": gate.get("readiness"),
            "blockers": gate.get("blockers"),
            "claims": [{"order": sc.get("order"), **{k: c.get(k) for k in ("claimId", "claimType", "field", "groundingStatus", "reasons", "sourceAuthority")}} for sc in grounding.get("perScene") or [] for c in sc["claims"]],
        },
        "marketingRoles": {"original": original_roles, "proposal": proposal_roles, "lost": lost, "notInOriginal": [r for r in MARKETING_ROLES if r not in original_roles]},
        "compliance": compliance,
        "naturalLanguageQa": qa,
        "writer": {"role": REDUCER_ROLE, "attempts": WRITER_ATTEMPTS, "calls": 1, "autoRetry": False, **(writer_meta or {})},
        "createdAt": created_at,
    }
    if revision:
        proposal["revision"] = {
            "round": revision.get("round"),
            "previousProposalId": revision.get("previousProposalId"),
            "previousProposalSha256": revision.get("previousProposalSha256"),
            "instructionsSha256": _sha(revision.get("instructions") or {}),
        }
    proposal["proposalSha256"] = proposal_sha256(proposal)
    return proposal


# ------------------------------------------------------------------ DB-facing contract

def source_readiness(body: dict[str, Any]) -> dict[str, Any]:
    scenes = shorts_scenes(body)
    snapshot = body.get("shorts_grounding") if isinstance(body.get("shorts_grounding"), dict) else None
    grounding = claim_grounding_for_scenes(scenes, snapshot, body.get("shorts_claim_reviews"))
    gate = grounding.get("narrationFitGate") or {}
    return {"readiness": gate.get("readiness") or grounding.get("contentGroundingStatus") or grounding.get("status"), "blockers": gate.get("blockers") or [], "estimatedTotalMs": sum(_estimate_ms(narration_text(s)) or 0 for s in scenes), "allocation": [s.get("duration_sec") for s in scenes]}


def _proposal_open(fit: dict[str, Any] | None) -> bool:
    if not isinstance(fit, dict) or not isinstance(fit.get("proposal"), dict):
        return False
    if fit.get("applied"):
        return True
    decision = (fit.get("humanDecision") or {}).get("status")
    return decision == "APPROVED" or (decision == "PENDING" and fit["proposal"].get("status") == PROPOSAL_READY)


def create_narration_fit_proposal(
    db: Session,
    row: ContentArtifact,
    *,
    writer: Callable[[list[dict[str, str]]], dict[str, Any]] | None = None,
    gate: Callable[[str], dict[str, Any]] | None = None,
    actor: str = "",
) -> dict[str, Any]:
    body = _load_body(row)
    scenes = shorts_scenes(body)
    if not scenes or not isinstance((body.get("shorts_generation_config") or {}).get("resolved"), dict):
        raise NarrationFitError("shorts_generation_config_required")
    readiness = source_readiness(body)
    if readiness["readiness"] != "NARRATION_FIT_READY":
        raise NarrationFitError("narration_fit_source_not_ready:" + ",".join(readiness["blockers"] or [str(readiness["readiness"])]))
    previous = body.get(FIT_KEY) if isinstance(body.get(FIT_KEY), dict) else None
    if _proposal_open(previous):
        raise NarrationFitError("narration_fit_proposal_open")
    from content_writer_service import _active_writer_model, _contains_blocked_text, call_writer_json

    revision = None
    previous_decision = (previous or {}).get("humanDecision") or {}
    if previous and previous_decision.get("status") == "REVISION_REQUIRED":
        prev = previous["proposal"]
        revision = {
            "round": int(((prev.get("revision") or {}).get("round")) or 1) + 1,
            "previousProposalId": prev.get("proposalId"),
            "previousProposalSha256": prev.get("proposalSha256"),
            "instructions": previous_decision.get("revisionInstructions") or {"general": [previous_decision["note"]] if previous_decision.get("note") else [], "forbidden": [], "scenes": []},
            "previousScenes": [{k: s.get(k) for k in ("order", "proposedNarration", "estimatedDurationMs", "proposedSceneDurationSec")} for s in prev.get("scenes") or []],
        }
    messages = reducer_messages(body, revision)
    call = writer or (lambda m: call_writer_json(db, messages=m, max_tokens=REDUCER_MAX_TOKENS))
    output = call(messages)
    proposal_id = _new_id("NFP")
    draft = build_proposal(body, output, proposal_id=proposal_id, created_at=_now(), writer_meta={"model": _active_writer_model(), "maxTokens": REDUCER_MAX_TOKENS}, revision=revision)
    preview = [dict(s, voice_over=r["proposedNarration"], subtitle=r["proposedSubtitle"] or s.get("subtitle"), on_screen_text=r["proposedOnScreenText"] or s.get("on_screen_text")) for s, r in zip(scenes, draft["scenes"])]
    export = _export_text(preview)
    blocked = _contains_blocked_text([{k: s.get(k) for k in ("voice_over", "subtitle", "on_screen_text")} for s in preview])
    if gate is None:
        from content_center_engine import claim_gate_text

        gate = lambda text: claim_gate_text(db, text)  # noqa: E731
    result = gate(export) or {}
    compliance = {"allowed": bool(result.get("allowed")) and not blocked, "blockedToken": blocked, "claimGate": {k: result.get(k) for k in ("allowed", "legal_risk", "claim_class", "hits") if k in result}}
    proposal = build_proposal(body, output, proposal_id=proposal_id, created_at=draft["createdAt"], writer_meta=draft["writer"], compliance=compliance, revision=revision)
    history = list((previous or {}).get("history") or [])
    if previous and isinstance(previous.get("proposal"), dict):
        history.append(_proposal_digest(previous["proposal"], previous.get("humanDecision")))
    body[FIT_KEY] = {
        "contractVersion": CONTRACT_VERSION,
        "sourceArtifactId": row.artifact_id,
        "sourceRevision": row.revision_no,
        "sourceScenesSha256": scenes_fingerprint(scenes),
        "parentSnapshotSha256": (body.get("shorts_grounding") or {}).get("snapshotSha256"),
        "videoTargetDurationSec": _video_sec(body, scenes),
        "estimatorVersion": NARRATION_ESTIMATOR["estimatorVersion"],
        "estimatorAuthority": ESTIMATOR_AUTHORITY,
        "originalSceneAllocation": [s.get("duration_sec") for s in scenes],
        "originalEstimatedDurationMs": proposal["totals"]["originalEstimatedMs"],
        "budget": narration_budget_plan(scenes, _video_sec(body, scenes)),
        "reallocationAllowed": True,
        "proposal": proposal,
        "humanDecision": {"status": "PENDING", "decidedAt": None, "actor": None, "note": "", "proposalId": proposal_id, "approvedProposalSha256": None},
        "applied": None,
        "requestedBy": actor or None,
        "history": history[-10:],
    }
    _save_body(db, row, body)
    return body[FIT_KEY]


def decide_narration_fit(db: Session, row: ContentArtifact, *, decision: str, proposal_id: str, proposal_hash: str = "", actor: str = "", note: str = "", revision_instructions: Any = None) -> dict[str, Any]:
    body = _load_body(row)
    fit = body.get(FIT_KEY)
    if not isinstance(fit, dict) or not isinstance(fit.get("proposal"), dict):
        raise NarrationFitError("narration_fit_proposal_not_found")
    proposal = fit["proposal"]
    decision0 = str(decision or "").upper()
    if decision0 not in DECISIONS or decision0 == "PENDING":
        raise NarrationFitError(f"unsupported_narration_fit_decision:{decision}")
    if proposal.get("proposalId") != proposal_id:
        raise NarrationFitError("narration_fit_proposal_id_mismatch")
    if (fit.get("humanDecision") or {}).get("status") != "PENDING":
        raise NarrationFitError("narration_fit_already_decided")
    approved_hash = None
    if decision0 == "APPROVED":
        if proposal.get("status") != PROPOSAL_READY:
            raise NarrationFitError("narration_fit_proposal_not_ready")
        current = proposal_sha256(proposal)
        if proposal_hash != current or proposal.get("proposalSha256") != current:
            raise NarrationFitError("narration_fit_proposal_hash_mismatch")
        approved_hash = current
    instructions = sanitize_revision_instructions(revision_instructions)
    if revision_instructions is not None and decision0 != "REVISION_REQUIRED":
        raise NarrationFitError("revision_instructions_only_for_revision_required")
    fit["humanDecision"] = {"status": decision0, "decidedAt": _now(), "actor": actor or None, "note": _clean(note, 500), "proposalId": proposal_id, "approvedProposalSha256": approved_hash}
    if decision0 == "REVISION_REQUIRED":
        fit["humanDecision"].update(revisionInstructions=instructions, revisionInstructionsSha256=_sha(instructions or {}), reviewedProposalSha256=proposal.get("proposalSha256"))
    body[FIT_KEY] = fit
    row.body_json = json.dumps(body, ensure_ascii=False)
    db.add(row)
    payload = {"proposalId": proposal_id, "decision": decision0, "proposalSha256": approved_hash, "revisionInstructionsSha256": fit["humanDecision"].get("revisionInstructionsSha256")}
    db.add(ContentReviewEvent(event_id=_new_id("CE"), artifact_id=row.artifact_id, event_type="narration_fit_decision", actor=actor or None, note=_clean(note, 500), payload_json=json.dumps(payload, ensure_ascii=False)))
    db.commit()
    db.refresh(row)
    return fit


def apply_check(body: dict[str, Any]) -> list[str]:
    fit = body.get(FIT_KEY)
    if not isinstance(fit, dict) or not isinstance(fit.get("proposal"), dict):
        return ["NARRATION_FIT_PROPOSAL_NOT_FOUND"]
    proposal = fit["proposal"]
    decision = fit.get("humanDecision") or {}
    issues = []
    if decision.get("status") != "APPROVED":
        issues.append(f"HUMAN_DECISION_{decision.get('status') or 'MISSING'}")
    elif decision.get("approvedProposalSha256") != proposal_sha256(proposal):
        issues.append("APPROVAL_INVALIDATED_PROPOSAL_CHANGED")
    if proposal.get("status") != PROPOSAL_READY:
        issues.append("PROPOSAL_NOT_READY")
    if fit.get("applied"):
        issues.append("ALREADY_APPLIED")
    if fit.get("sourceScenesSha256") != scenes_fingerprint(shorts_scenes(body)):
        issues.append("SOURCE_CHANGED_SINCE_PROPOSAL")
    return issues


def build_revision_body(body: dict[str, Any], *, parent_artifact_id: str, parent_revision_no: Any) -> dict[str, Any]:
    fit = body[FIT_KEY]
    proposal = fit["proposal"]
    config = body.get("shorts_generation_config")
    child = copy.deepcopy({k: v for k, v in body.items() if k != FIT_KEY})
    container = child.get("shorts") if isinstance(child.get("shorts"), dict) else child
    rows = {str(r["order"]): r for r in proposal["scenes"]}
    scenes = []
    for scene in shorts_scenes(child):
        r = rows[str(scene.get("order"))]
        scene["voice_over"] = r["proposedNarration"]
        scene["spoken_script"] = r["proposedNarration"]
        if r.get("proposedSubtitle"):
            scene["subtitle"] = r["proposedSubtitle"]
            scene["caption"] = r["proposedSubtitle"]
        if r.get("proposedOnScreenText"):
            scene["on_screen_text"] = r["proposedOnScreenText"]
        scene["claims"] = copy.deepcopy(r["claims"])
        scene["duration_sec"] = r["proposedSceneDurationSec"]
        if isinstance(scene.get("narration_audio"), dict) and scene_narration_state(scene, config)["status"] != "READY":
            scene.pop("narration_audio")
        scenes.append(scene)
    container["scenes"] = scenes
    child["scenes"] = scenes
    if container is not child:
        child["shorts"] = container
        container["estimated_duration"] = fit.get("videoTargetDurationSec")
    child["export_text"] = _export_text(scenes)
    snapshot = child.get("shorts_grounding")
    if isinstance(snapshot, dict):
        result = claim_grounding_for_scenes(scenes, snapshot, child.get("shorts_claim_reviews"))
        snapshot["validation"] = {k: v for k, v in result.items() if k != "perScene"}
        snapshot["claimGroundingStatus"] = result.get("contentGroundingStatus")
    child.pop("narration_generation_summary", None)
    child[LINEAGE_KEY] = {
        "contractVersion": CONTRACT_VERSION,
        "parentArtifactId": parent_artifact_id,
        "parentRevisionNo": parent_revision_no,
        "fitProposalId": proposal.get("proposalId"),
        "proposalSha256": proposal.get("proposalSha256"),
        "parentSnapshotSha256": fit.get("parentSnapshotSha256"),
        "snapshotAuthority": "INHERITED_PARENT_GENERATION_TIME_SNAPSHOT",
        "newExternalSources": 0,
        "humanDecision": fit.get("humanDecision"),
        "sceneAllocation": {"parent": fit.get("originalSceneAllocation"), "revision": proposal.get("proposedSceneAllocation")},
    }
    return child


def apply_narration_fit_proposal(db: Session, row: ContentArtifact, *, actor: str = "") -> ContentArtifact:
    from content_center_revision import save_artifact_draft

    body = _load_body(row)
    issues = apply_check(body)
    if issues:
        raise NarrationFitError("narration_fit_apply_blocked:" + ",".join(issues))
    child_body = build_revision_body(body, parent_artifact_id=row.artifact_id, parent_revision_no=row.revision_no)
    grounding = claim_grounding_for_scenes(shorts_scenes(child_body), child_body.get("shorts_grounding"), child_body.get("shorts_claim_reviews"))
    if (grounding.get("narrationFitGate") or {}).get("readiness") != "NARRATION_FIT_READY" or (child_body.get("shorts_grounding") or {}).get("snapshotAuthority") != SNAPSHOT_AUTHORITY:
        raise NarrationFitError("narration_fit_revision_grounding_failed:" + ",".join((grounding.get("narrationFitGate") or {}).get("blockers") or []))
    child = save_artifact_draft(
        db,
        artifact_id=row.artifact_id,
        body_json=child_body,
        export_text=child_body["export_text"],
        note=f"narration fit {body[FIT_KEY]['proposal'].get('proposalId')}",
        actor=actor or None,
        revision_reason="narration_fit",
        source="human_approved_ai_proposal",
        event_type="narration_fit_applied",
    )
    body = _load_body(row)
    body[FIT_KEY]["applied"] = {"revisionArtifactId": child.artifact_id, "appliedAt": _now(), "actor": actor or None}
    _save_body(db, row, body)
    return child


# ------------------------------------------------------------------ routes

def register_shorts_narration_fit_routes(app, *, get_db_dep) -> None:
    from content_center_generate import artifact_to_dict
    from content_writer_service import ContentWriterError

    def _artifact(db: Session, artifact_id: str) -> ContentArtifact:
        row = db.get(ContentArtifact, str(artifact_id or "").strip())
        if row is None or str(row.channel or "").lower() != "shorts":
            raise HTTPException(status_code=404, detail="shorts_artifact_not_found")
        return row

    def _state(row: ContentArtifact) -> dict[str, Any]:
        body = _load_body(row)
        fit = body.get(FIT_KEY) if isinstance(body.get(FIT_KEY), dict) else None
        decision = ((fit or {}).get("humanDecision") or {}).get("status")
        return {
            "ok": True,
            "artifactId": row.artifact_id,
            "source": source_readiness(body),
            "fit": fit,
            "lineage": body.get(LINEAGE_KEY),
            "canPropose": not _proposal_open(fit),
            "canDecide": bool(fit and decision == "PENDING"),
            "applyBlockers": apply_check(body) if fit else ["NARRATION_FIT_PROPOSAL_NOT_FOUND"],
        }

    @app.get("/content/shorts/artifacts/{artifact_id}/narration-fit")
    def get_shorts_narration_fit(artifact_id: str, db: Session = Depends(get_db_dep)):
        return _state(_artifact(db, artifact_id))

    @app.post("/content/shorts/artifacts/{artifact_id}/narration-fit/proposal")
    def post_shorts_narration_fit_proposal(artifact_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        row = _artifact(db, artifact_id)
        try:
            create_narration_fit_proposal(db, row, actor=str(payload.get("actor") or ""))
        except NarrationFitError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ContentWriterError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {**_state(row), "writerCalls": 1, "ttsCalls": 0, "imageCalls": 0}

    @app.post("/content/shorts/artifacts/{artifact_id}/narration-fit/decision")
    def post_shorts_narration_fit_decision(artifact_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        row = _artifact(db, artifact_id)
        try:
            decide_narration_fit(db, row, decision=str(payload.get("decision") or ""), proposal_id=str(payload.get("proposal_id") or ""), proposal_hash=str(payload.get("proposal_sha256") or ""), actor=str(payload.get("actor") or ""), note=str(payload.get("note") or ""), revision_instructions=payload.get("revision_instructions"))
        except NarrationFitError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return _state(row)

    @app.post("/content/shorts/artifacts/{artifact_id}/narration-fit/apply")
    def post_shorts_narration_fit_apply(artifact_id: str, payload: dict = Body(default_factory=dict), db: Session = Depends(get_db_dep)):
        row = _artifact(db, artifact_id)
        try:
            child = apply_narration_fit_proposal(db, row, actor=str(payload.get("actor") or ""))
        except NarrationFitError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {**_state(row), "revision": artifact_to_dict(child), "ttsCalls": 0, "imageCalls": 0}
