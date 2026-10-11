from __future__ import annotations

from dataclasses import dataclass, field

from event_evidence_bundle import EventEvidenceBundle


@dataclass(frozen=True)
class CausalityGuardResult:
    ok: bool
    violations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"ok": self.ok, "violations": list(self.violations or [])}


def validate_causality_guard(bundle: EventEvidenceBundle) -> CausalityGuardResult:
    violations: list[str] = []

    for candidate in bundle.candidates or []:
        cid = str(candidate.candidate_id or "candidate").strip()
        claim = str(candidate.causal_claim or "").strip().upper()
        relation = str(candidate.relation_type or "").strip().upper()
        basis = {str(item or "").strip().upper() for item in (candidate.basis or [])}

        if candidate.root_declared:
            violations.append(f"{cid}:rootDeclared_must_default_false")
        if relation == "RELATED" and claim in {"CAUSE", "ROOT"}:
            violations.append(f"{cid}:related_is_not_cause")
        if basis and basis.issubset({"TEMPORAL_OVERLAP"}) and claim in {"CAUSE", "ROOT"}:
            violations.append(f"{cid}:temporal_overlap_is_not_cause")
        if claim == "ROOT":
            violations.append(f"{cid}:candidate_is_not_root")

    has_recommendation = any(str(c.recommendation or "").strip() for c in (bundle.candidates or []))
    if has_recommendation and str(bundle.decision or "").strip():
        violations.append("recommendation_is_not_decision")

    return CausalityGuardResult(ok=(len(violations) == 0), violations=violations)

