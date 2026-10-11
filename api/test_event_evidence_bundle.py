import unittest

from event_evidence_bundle import CauseCandidate, EventEvidenceBundle, evidence_ref, validate_bundle


class TestEventEvidenceBundle(unittest.TestCase):
    def test_open_bundle_accepts_candidate_with_three_evidence_arrays(self) -> None:
        candidate = CauseCandidate(
            candidate_id="organic-drop",
            label="오가닉 순위 하락",
            supporting_evidence=[evidence_ref("rank-1", kind="SUPPORTING", source_kind="ORGANIC_RANK", label="순위 하락")],
            contradicting_evidence=[],
            missing_evidence=[evidence_ref("market-1", kind="MISSING", source_kind="MARKET_DEMAND", label="시장 수요 없음")],
        )
        bundle = EventEvidenceBundle(
            event_id="event-p01",
            why_id="SKU_P01_SALES_DROP_WHY",
            observation={"metric": "sales", "direction": "down"},
            conclusion_class="INTERNAL_CANDIDATES_OPEN",
            candidates=[candidate],
        )

        result = validate_bundle(bundle)

        self.assertTrue(result.ok, result.errors)
        self.assertFalse(bundle.to_dict()["candidates"][0]["rootDeclared"])
        self.assertIn("supportingEvidence", bundle.to_dict()["candidates"][0])
        self.assertIn("contradictingEvidence", bundle.to_dict()["candidates"][0])
        self.assertIn("missingEvidence", bundle.to_dict()["candidates"][0])

    def test_stop_unknown_allows_candidate_zero(self) -> None:
        bundle = EventEvidenceBundle(
            event_id="event-stop",
            why_id="SKU_P01_SALES_DROP_WHY",
            observation={"metric": "sales", "direction": "flat"},
            conclusion_class="HEALTH_OR_SCOPE_FAIL",
            candidates=[],
        )

        self.assertTrue(validate_bundle(bundle).ok)

    def test_open_requires_candidate(self) -> None:
        bundle = EventEvidenceBundle(
            event_id="event-open",
            why_id="SKU_P01_SALES_DROP_WHY",
            observation={"metric": "sales", "direction": "down"},
            conclusion_class="INTERNAL_CANDIDATES_OPEN",
            candidates=[],
        )

        result = validate_bundle(bundle)

        self.assertFalse(result.ok)
        self.assertIn("open_conclusion_requires_candidate", result.errors)

    def test_l4_evidence_link_types_are_explicit(self) -> None:
        raw = evidence_ref(
            "raw-rank",
            kind="SUPPORTING",
            source_kind="ORGANIC_RANK",
            label="원본 순위",
            pointer={"path": "/analytics/rank/tracking"},
        )
        trace = evidence_ref(
            "trace-rank",
            kind="SUPPORTING",
            source_kind="A1_TRACE",
            label="분석 추적",
            pointer={"path": "/analytics/ai/organic-rank/trace"},
            link_type="ANALYSIS_TRACE",
        )

        self.assertEqual(raw.link_type, "RAW_BUSINESS_EVIDENCE")
        self.assertEqual(trace.link_type, "ANALYSIS_TRACE")


if __name__ == "__main__":
    unittest.main()

