import copy
import json
import tempfile
import unittest
from pathlib import Path

import review_reply_knowledge_analysis_labels as labels_module
from review_reply_knowledge_api import _queue_item_view

U017_KEY = "ruf:832d559563c198e3c490a1d9e7145edc"


def _item(units: list[dict]) -> dict:
    return {
        "knowledge_id": "rrk:naver_review:4881684002", "review_key": "naver_review:4881684002", "product_group": "HENNA",
        "review_text": "r", "reply_text": "a", "authorship": "HUMAN", "authorship_evidence": "", "tier": "T", "has_knowhow": True,
        "knowhow_items": units, "review_topics": [], "reply_topics": [], "review_signals": [], "template_like": False,
        "policy_violations": [], "content_validation": "PENDING",
    }


class AnalysisLabelArtifactTest(unittest.TestCase):
    def test_artifact_loads_all_labels_with_integrity(self):
        labels = labels_module.load_analysis_labels()
        self.assertEqual(len(labels), 300)
        self.assertEqual(len(set(labels.values())), 300)
        self.assertEqual(labels[U017_KEY], "U017")

    def test_artifact_matches_claim_decomposition_labels(self):
        art = json.loads((Path(labels_module.__file__).resolve().parent / "review_reply_knowledge_sources" / "claim_decomposition_v1.json").read_text(encoding="utf-8"))
        labels = labels_module.load_analysis_labels()
        for parent in art["parent_units"]:
            self.assertEqual(labels.get(parent["parent_unit_key"]), parent["analysis_label"])

    def test_tampered_or_missing_artifact_yields_no_labels(self):
        raw = json.loads(labels_module._ARTIFACT_PATH.read_text(encoding="utf-8"))
        raw["labels"][0]["analysis_label"] = "U999"
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "labels.json"
            bad.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(labels_module.load_analysis_labels(bad), {})
            self.assertEqual(labels_module.load_analysis_labels(Path(tmp) / "missing.json"), {})


class AnalysisLabelViewTest(unittest.TestCase):
    def test_labels_attached_to_copies_in_unit_order(self):
        units = [
            {"sentence": "a", "factValidation": {"unitKey": "ruf:other"}},
            {"sentence": "b", "factValidation": {"unitKey": U017_KEY, "status": "PENDING"}},
            {"sentence": "c"},
        ]
        before = copy.deepcopy(units)
        out, found = labels_module.label_knowhow_items(units, {U017_KEY: "U017"})
        self.assertEqual(found, ["U017"])
        self.assertEqual(out[1]["analysisLabel"], "U017")
        self.assertNotIn("analysisLabel", out[0])
        self.assertNotIn("analysisLabel", out[2])
        self.assertEqual(units, before)

    def test_queue_item_view_exposes_labels_without_touching_validation_fields(self):
        units = [{"sentence": "b", "factValidation": {"unitKey": U017_KEY, "status": "PENDING"}, "generatorFactEligible": False}]
        item = _item(units)
        view = _queue_item_view(item)
        self.assertEqual(view["analysis_labels"], ["U017"])
        self.assertEqual(view["knowhow_items"][0]["analysisLabel"], "U017")
        self.assertEqual(view["knowhow_items"][0]["factValidation"], units[0]["factValidation"])
        self.assertFalse(view["knowhow_items"][0]["generatorFactEligible"])
        self.assertEqual(view["content_validation"], "PENDING")
        self.assertNotIn("analysisLabel", item["knowhow_items"][0])

    def test_unlabelled_item_has_empty_labels(self):
        view = _queue_item_view(_item([{"sentence": "x", "factValidation": {"unitKey": "ruf:none"}}]))
        self.assertEqual(view["analysis_labels"], [])
        self.assertNotIn("analysisLabel", view["knowhow_items"][0])


if __name__ == "__main__":
    unittest.main()
