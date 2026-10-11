import unittest
from datetime import datetime

from external_context import (
    EXTERNAL_CONTEXT_KEYS,
    build_external_context_items,
    serialize_external_context,
    validate_external_context_items,
)


class TestExternalContextBoundary(unittest.TestCase):
    def test_builds_exactly_six_keys_with_default_availability(self) -> None:
        items = build_external_context_items(scope={"why_id": "SKU_P01_SALES_DROP_WHY"})
        serialized = serialize_external_context(items)

        self.assertEqual([item["key"] for item in serialized], list(EXTERNAL_CONTEXT_KEYS))
        self.assertEqual(len(serialized), 6)
        self.assertEqual(serialized[0]["availability"], "PARTIAL")
        self.assertEqual(serialized[1]["availability"], "PARTIAL")
        self.assertEqual(serialized[2]["availability"], "NOT_AVAILABLE")
        self.assertEqual(serialized[3]["availability"], "NOT_AVAILABLE")
        self.assertEqual(serialized[4]["availability"], "NOT_AVAILABLE")
        self.assertEqual(serialized[5]["availability"], "NOT_AVAILABLE")

    def test_source_type_is_always_list_string_and_taxonomy_is_not_availability(self) -> None:
        serialized = serialize_external_context(build_external_context_items())
        policy = next(item for item in serialized if item["key"] == "POLICY")

        self.assertIsInstance(policy["sourceType"], list)
        self.assertEqual(
            policy["sourceType"],
            ["Government / Regulation / Policy", "Commerce Platform / Naver Ecosystem Change"],
        )
        self.assertEqual(policy["availability"], "NOT_AVAILABLE")

    def test_partial_availability_does_not_create_signal_observed(self) -> None:
        market = serialize_external_context(build_external_context_items())[0]

        self.assertEqual(market["key"], "MARKET_DEMAND")
        self.assertEqual(market["availability"], "PARTIAL")
        self.assertEqual(market["signalStatus"], "NOT_CHECKED")

    def test_not_available_does_not_fabricate_signal(self) -> None:
        items = build_external_context_items(observations={"WEATHER": {"signalStatus": "SIGNAL_OBSERVED"}})
        weather = next(item for item in serialize_external_context(items) if item["key"] == "WEATHER")

        self.assertEqual(weather["availability"], "NOT_AVAILABLE")
        self.assertEqual(weather["signalStatus"], "NOT_CHECKED")

    def test_actual_observation_can_emit_signal_with_observed_at(self) -> None:
        observed = "2026-08-20T15:00:00"
        items = build_external_context_items(
            observed_at=observed,
            observations={"MARKET_DEMAND": {"signalStatus": "SIGNAL_OBSERVED"}},
        )
        market = next(item for item in serialize_external_context(items) if item["key"] == "MARKET_DEMAND")

        self.assertEqual(market["signalStatus"], "SIGNAL_OBSERVED")
        self.assertEqual(market["observedAt"], observed)

    def test_supporting_and_contradicting_require_candidate_linkage(self) -> None:
        no_linkage = build_external_context_items(observations={"COMPETITOR": {"evidenceStatus": "SUPPORTING"}})
        competitor = next(item for item in serialize_external_context(no_linkage) if item["key"] == "COMPETITOR")
        self.assertEqual(competitor["evidenceStatus"], "INSUFFICIENT")

        linked = build_external_context_items(
            scope={"candidate_id": "candidate-1"},
            observations={"COMPETITOR": {"evidenceStatus": "SUPPORTING"}},
        )
        linked_competitor = next(item for item in serialize_external_context(linked) if item["key"] == "COMPETITOR")
        self.assertEqual(linked_competitor["evidenceStatus"], "SUPPORTING")

    def test_rejects_missing_duplicate_and_unknown_keys(self) -> None:
        items = build_external_context_items()

        missing = validate_external_context_items(items[:-1])
        self.assertFalse(missing.ok)
        self.assertIn("external_context_must_have_exactly_6_keys", missing.errors)

        duplicate = validate_external_context_items([items[0], *items])
        self.assertFalse(duplicate.ok)
        self.assertIn("external_context_duplicate_key", duplicate.errors)

    def test_deterministic_output_for_same_input(self) -> None:
        observed_at = datetime(2026, 8, 20, 15, 0, 0)
        kwargs = {
            "scope": {"why_id": "SKU_P01_SALES_DROP_WHY", "event_id": "event-1"},
            "observed_at": observed_at,
            "observations": {"MARKET_DEMAND": {"signalStatus": "NO_SIGNAL"}},
        }

        self.assertEqual(
            serialize_external_context(build_external_context_items(**kwargs)),
            serialize_external_context(build_external_context_items(**kwargs)),
        )

    def test_external_context_never_serializes_candidate_or_root(self) -> None:
        serialized = serialize_external_context(
            build_external_context_items(
                observed_at="2026-08-20T15:00:00",
                observations={"MARKET_DEMAND": {"signalStatus": "SIGNAL_OBSERVED"}},
            )
        )

        for item in serialized:
            self.assertNotIn("candidate", item)
            self.assertNotIn("rootDeclared", item)
            self.assertNotIn("decision", item)


if __name__ == "__main__":
    unittest.main()

