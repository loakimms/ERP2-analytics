import unittest

from event_evidence_bundle import CauseCandidate, evidence_ref
from why_health_gate import evaluate_why_health, source_health
from why_registry import SKU_P01_SALES_DROP_WHY, get_why_definition, list_why_definitions
from why_runner import MinimalWhyRunner, WhyRunInput


class TestWhyRunner(unittest.TestCase):
    def test_minimal_registry_contains_only_p01_foundation_why(self) -> None:
        why = get_why_definition(SKU_P01_SALES_DROP_WHY)

        self.assertEqual(why.why_id, SKU_P01_SALES_DROP_WHY)
        self.assertEqual([item.why_id for item in list_why_definitions()], [SKU_P01_SALES_DROP_WHY])

    def test_runner_blocks_when_health_gate_fails_without_forcing_candidate(self) -> None:
        runner = MinimalWhyRunner()
        health = evaluate_why_health([source_health("sales", "MISSING")], require_all=True)

        result = runner.run(
            WhyRunInput(
                why_id=SKU_P01_SALES_DROP_WHY,
                event_id="event-health",
                observation={"metric": "sales", "direction": "down"},
                health=health,
                candidates=[],
            )
        )

        self.assertTrue(result.ok, result.to_dict())
        self.assertEqual(result.bundle.conclusion_class, "HEALTH_OR_SCOPE_FAIL")
        self.assertEqual(result.bundle.candidates, [])

    def test_runner_allows_unknown_without_candidate(self) -> None:
        runner = MinimalWhyRunner()
        health = evaluate_why_health([source_health("sales", "USABLE")])

        result = runner.run(
            WhyRunInput(
                why_id=SKU_P01_SALES_DROP_WHY,
                event_id="event-unknown",
                observation={"metric": "sales", "direction": "down"},
                health=health,
                candidates=[],
            )
        )

        self.assertTrue(result.ok, result.to_dict())
        self.assertEqual(result.bundle.conclusion_class, "INTERNAL_QUIET_EXTERNAL_UNKNOWN")
        self.assertEqual(result.bundle.candidates, [])

    def test_runner_returns_open_bundle_with_candidate_and_provenance(self) -> None:
        recorded = []
        runner = MinimalWhyRunner(trace_recorder=recorded.append)
        health = evaluate_why_health([source_health("sales", "USABLE"), source_health("organic", "USABLE")])
        candidate = CauseCandidate(
            candidate_id="organic-drop",
            label="오가닉 순위 하락",
            supporting_evidence=[
                evidence_ref(
                    "rank",
                    kind="SUPPORTING",
                    source_kind="ORGANIC_RANK",
                    label="순위 하락",
                    pointer={"path": "/analytics/rank/tracking"},
                )
            ],
            contradicting_evidence=[],
            missing_evidence=[],
        )

        result = runner.run(
            WhyRunInput(
                why_id=SKU_P01_SALES_DROP_WHY,
                event_id="event-open",
                observation={"metric": "sales", "direction": "down"},
                health=health,
                candidates=[candidate],
                source_provenance=[
                    {
                        "evidence_id": "source-rank",
                        "kind": "SOURCE",
                        "source_kind": "ORGANIC_RANK",
                        "label": "내 상품 추적",
                        "pointer": {"path": "/analytics/rank/tracking"},
                    }
                ],
            )
        )

        self.assertTrue(result.ok, result.to_dict())
        self.assertEqual(result.bundle.conclusion_class, "INTERNAL_CANDIDATES_OPEN")
        self.assertEqual(len(result.bundle.candidates), 1)
        self.assertEqual(len(result.bundle.source_provenance), 1)
        self.assertEqual(recorded[0].event_id, "event-open")


if __name__ == "__main__":
    unittest.main()

