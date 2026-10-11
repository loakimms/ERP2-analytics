from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


OPEN_CONCLUSION = "INTERNAL_CANDIDATES_OPEN"
ZERO_CANDIDATE_CONCLUSIONS = {
    "INTERNAL_QUIET_EXTERNAL_UNKNOWN",
    "INTERNAL_QUIET_EXTERNAL_PARTIAL",
    "PATTERN_NOT_ANOMALY",
    "HEALTH_OR_SCOPE_FAIL",
    "BLOCKED_IDENTITY",
    "STOP",
    "UNKNOWN",
}


@dataclass(frozen=True)
class EvidenceRef:
    evidence_id: str
    kind: str
    source_kind: str
    label: str
    pointer: dict[str, Any] = field(default_factory=dict)
    link_type: str = "RAW_BUSINESS_EVIDENCE"

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "kind": self.kind,
            "source_kind": self.source_kind,
            "label": self.label,
            "pointer": dict(self.pointer or {}),
            "link_type": self.link_type,
        }


@dataclass(frozen=True)
class CauseCandidate:
    candidate_id: str
    label: str
    supporting_evidence: list[EvidenceRef] = field(default_factory=list)
    contradicting_evidence: list[EvidenceRef] = field(default_factory=list)
    missing_evidence: list[EvidenceRef] = field(default_factory=list)
    root_declared: bool = False
    relation_type: str = "CANDIDATE"
    causal_claim: str = "CANDIDATE"
    basis: list[str] = field(default_factory=list)
    recommendation: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "label": self.label,
            "supportingEvidence": [e.to_dict() for e in self.supporting_evidence],
            "contradictingEvidence": [e.to_dict() for e in self.contradicting_evidence],
            "missingEvidence": [e.to_dict() for e in self.missing_evidence],
            "rootDeclared": bool(self.root_declared),
            "relationType": self.relation_type,
            "causalClaim": self.causal_claim,
            "basis": list(self.basis or []),
            "recommendation": self.recommendation,
        }


@dataclass(frozen=True)
class EventEvidenceBundle:
    event_id: str
    why_id: str
    observation: dict[str, Any]
    conclusion_class: str
    candidates: list[CauseCandidate] = field(default_factory=list)
    source_provenance: list[EvidenceRef] = field(default_factory=list)
    next_action: dict[str, Any] = field(default_factory=dict)
    decision: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "eventId": self.event_id,
            "whyId": self.why_id,
            "observation": dict(self.observation or {}),
            "conclusionClass": self.conclusion_class,
            "candidates": [c.to_dict() for c in self.candidates],
            "sourceProvenance": [e.to_dict() for e in self.source_provenance],
            "next": dict(self.next_action or {}),
            "decision": self.decision,
        }


@dataclass(frozen=True)
class BundleValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def validate_bundle(bundle: EventEvidenceBundle) -> BundleValidationResult:
    errors: list[str] = []
    conclusion = str(bundle.conclusion_class or "").strip().upper()
    candidates = list(bundle.candidates or [])

    if not str(bundle.event_id or "").strip():
        errors.append("event_id_required")
    if not str(bundle.why_id or "").strip():
        errors.append("why_id_required")
    if not isinstance(bundle.observation, dict) or not bundle.observation:
        errors.append("observation_required")

    if conclusion == OPEN_CONCLUSION and len(candidates) == 0:
        errors.append("open_conclusion_requires_candidate")
    if conclusion in ZERO_CANDIDATE_CONCLUSIONS and len(candidates) > 0 and conclusion in {"PATTERN_NOT_ANOMALY", "HEALTH_OR_SCOPE_FAIL", "BLOCKED_IDENTITY"}:
        errors.append("stop_conclusion_must_not_include_candidate")

    for candidate in candidates:
        if candidate.supporting_evidence is None:
            errors.append(f"{candidate.candidate_id}:supporting_missing")
        if candidate.contradicting_evidence is None:
            errors.append(f"{candidate.candidate_id}:contradicting_missing")
        if candidate.missing_evidence is None:
            errors.append(f"{candidate.candidate_id}:missing_missing")

    return BundleValidationResult(ok=(len(errors) == 0), errors=errors)


def evidence_ref(
    evidence_id: str,
    *,
    kind: str,
    source_kind: str,
    label: str,
    pointer: dict[str, Any] | None = None,
    link_type: str = "RAW_BUSINESS_EVIDENCE",
) -> EvidenceRef:
    return EvidenceRef(
        evidence_id=str(evidence_id or "").strip(),
        kind=str(kind or "").strip().upper(),
        source_kind=str(source_kind or "").strip().upper(),
        label=str(label or "").strip(),
        pointer=dict(pointer or {}),
        link_type=str(link_type or "RAW_BUSINESS_EVIDENCE").strip().upper(),
    )

