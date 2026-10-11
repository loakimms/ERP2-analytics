"""Display-only analysis numbers (U###) for historical guidance units.

The numbers were assigned during claim-decomposition analysis so reviewers can locate a unit named in review material.
They are labels only: they carry no validation state, never change eligibility, and an unloadable artifact simply
yields no labels.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

_ARTIFACT_PATH = Path(__file__).resolve().parent / "review_reply_knowledge_sources" / "analysis_labels_v1.json"
_CACHE: dict = {}


def load_analysis_labels(path: Path | None = None) -> dict[str, str]:
    """unit_key -> analysis label. Returns {} when the artifact is missing or fails its integrity check. Never raises."""
    try:
        raw = json.loads((path or _ARTIFACT_PATH).read_text(encoding="utf-8"))
        body = {"labels": raw["labels"]}
        digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        if digest != raw["content_sha256"]:
            return {}
        return {str(x["unit_key"]): str(x["analysis_label"]) for x in raw["labels"]}
    except Exception:
        return {}


def analysis_labels() -> dict[str, str]:
    if "labels" not in _CACHE:
        _CACHE["labels"] = load_analysis_labels()
    return _CACHE["labels"]


def _unit_key(unit: dict) -> str | None:
    fv = unit.get("factValidation")
    return fv.get("unitKey") if isinstance(fv, dict) else None


def label_knowhow_items(units: list[dict], labels: dict[str, str] | None = None) -> tuple[list[dict], list[str]]:
    """Copies of units with `analysisLabel` added where known, plus the item's labels in unit order."""
    labels = analysis_labels() if labels is None else labels
    out: list[dict] = []
    found: list[str] = []
    for unit in units or []:
        lab = labels.get(_unit_key(unit) or "")
        if lab:
            out.append({**unit, "analysisLabel": lab})
            found.append(lab)
        else:
            out.append(unit)
    return out, found
