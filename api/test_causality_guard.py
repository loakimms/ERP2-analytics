import unittest

from causality_guard import validate_causality_guard
from event_evidence_bundle import CauseCandidate, EventEvidenceBundle, evidence_ref


class TestCausalityGuard(unittest.TestCase):
    def _bundle(self, candidate: CauseCandidate, *, decision: str | None = None) -> EventEvidenceBundle:
        return EventEvidenceBundle(
            event_id="event-p01",
            why_id="SKU_P01_SALES_DROP_WHY",
            observation={"metric": "sales", "direction": "down"},
            conclusion_class="INTERNAL_CANDIDATES_OPEN",
            candidates=[candidate],
            decision=decision,
        )

    def test_default_candidate_passes_without_root(self) -> None:
        candidate = CauseCandidate(
            candidate_id="organic-drop",
            label="오가닉 순위 하락",
            supporting_evidence=[evidence_ref("rank", kind="SUPPORTING", source_kind="ORGANIC_RANK", label="순위")],
        )

        result = validate_causality_guard(self._bundle(candidate))

        self.assertTrue(result.ok, result.violations)

    def test_root_declared_and_root_claim_are_rejected(self) -> None:
        candidate = CauseCandidate(
            candidate_id="organic-drop",
            label="오가닉 순위 하락",
            root_declared=True,
            causal_claim="ROOT",
        )

        result = validate_causality_guard(self._bundle(candidate))

        self.assertFalse(result.ok)
        self.assertIn("organic-drop:rootDeclared_must_default_false", result.violations)
        self.assertIn("organic-drop:candidate_is_not_root", result.violations)

    def test_related_and_temporal_only_cannot_be_cause(self) -> None:
        related = CauseCandidate(
            candidate_id="related",
            label="관련 지표",
            relation_type="RELATED",
            causal_claim="CAUSE",
        )
        temporal = CauseCandidate(
            candidate_id="temporal",
            label="동시 발생",
            causal_claim="CAUSE",
            basis=["TEMPORAL_OVERLAP"],
        )

        self.assertIn("related:related_is_not_cause", validate_causality_guard(self._bundle(related)).violations)
        self.assertIn("temporal:temporal_overlap_is_not_cause", validate_causality_guard(self._bundle(temporal)).violations)

    def test_recommendation_is_not_decision(self) -> None:
        candidate = CauseCandidate(
            candidate_id="recommendation",
            label="권장 액션",
            recommendation="상세 확인",
        )

        result = validate_causality_guard(self._bundle(candidate, decision="APPROVED"))

        self.assertFalse(result.ok)
        self.assertIn("recommendation_is_not_decision", result.violations)


if __name__ == "__main__":
    unittest.main()

