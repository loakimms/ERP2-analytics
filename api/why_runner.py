from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable
import uuid

from causality_guard import CausalityGuardResult, validate_causality_guard
from event_evidence_bundle import (
    CauseCandidate,
    EventEvidenceBundle,
    BundleValidationResult,
    evidence_ref,
    validate_bundle,
)
from why_health_gate import WhyHealthGateResult
from why_registry import get_why_definition


@dataclass(frozen=True)
class WhyRunInput:
    why_id: str
    event_id: str | None
    observation: dict[str, Any]
    health: WhyHealthGateResult
    candidates: list[CauseCandidate] = field(default_factory=list)
    source_provenance: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class WhyRunResult:
    ok: bool
    bundle: EventEvidenceBundle
    bundle_validation: BundleValidationResult
    causality_guard: CausalityGuardResult

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "bundle": self.bundle.to_dict(),
            "bundle_validation": {
                "ok": self.bundle_validation.ok,
                "errors": list(self.bundle_validation.errors or []),
            },
            "causality_guard": self.causality_guard.to_dict(),
        }


TraceRecorder = Callable[[EventEvidenceBundle], None]


class MinimalWhyRunner:
    def __init__(self, *, trace_recorder: TraceRecorder | None = None):
        self._trace_recorder = trace_recorder

    def run(self, payload: WhyRunInput) -> WhyRunResult:
        why = get_why_definition(payload.why_id)
        event_id = str(payload.event_id or "").strip() or f"event-{uuid.uuid4()}"
        provenance = [
            evidence_ref(
                str(item.get("evidence_id") or f"source-{idx + 1}"),
                kind=str(item.get("kind") or "SOURCE"),
                source_kind=str(item.get("source_kind") or "UNKNOWN"),
                label=str(item.get("label") or item.get("source_kind") or "source"),
                pointer=item.get("pointer") if isinstance(item.get("pointer"), dict) else {},
                link_type=str(item.get("link_type") or "RAW_BUSINESS_EVIDENCE"),
            )
            for idx, item in enumerate(payload.source_provenance or [])
        ]

        if not payload.health.usable:
            bundle = EventEvidenceBundle(
                event_id=event_id,
                why_id=why.why_id,
                observation=dict(payload.observation or {"status": "blocked"}),
                conclusion_class="HEALTH_OR_SCOPE_FAIL",
                candidates=[],
                source_provenance=provenance,
                next_action={"type": "STOP", "reason": payload.health.status},
            )
        elif payload.candidates:
            bundle = EventEvidenceBundle(
                event_id=event_id,
                why_id=why.why_id,
                observation=dict(payload.observation or {}),
                conclusion_class="INTERNAL_CANDIDATES_OPEN",
                candidates=list(payload.candidates or []),
                source_provenance=provenance,
                next_action={"type": "NEXT_WHY_OR_HUMAN_REVIEW"},
            )
        else:
            bundle = EventEvidenceBundle(
                event_id=event_id,
                why_id=why.why_id,
                observation=dict(payload.observation or {}),
                conclusion_class="INTERNAL_QUIET_EXTERNAL_UNKNOWN",
                candidates=[],
                source_provenance=provenance,
                next_action={"type": "EXTERNAL_STOP", "reason": "no_internal_candidate"},
            )

        validation = validate_bundle(bundle)
        guard = validate_causality_guard(bundle)
        if self._trace_recorder is not None:
            self._trace_recorder(bundle)
        return WhyRunResult(ok=bool(validation.ok and guard.ok), bundle=bundle, bundle_validation=validation, causality_guard=guard)

