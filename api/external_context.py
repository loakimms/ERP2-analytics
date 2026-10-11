from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable


EXTERNAL_CONTEXT_KEYS: tuple[str, ...] = (
    "MARKET_DEMAND",
    "COMPETITOR",
    "POLICY",
    "NEWS",
    "WEATHER",
    "HOLIDAY",
)

SOURCE_TYPES: dict[str, list[str]] = {
    "MARKET_DEMAND": ["Market Demand"],
    "COMPETITOR": ["Competitor"],
    "POLICY": ["Government / Regulation / Policy", "Commerce Platform / Naver Ecosystem Change"],
    "NEWS": ["News / Social Issue"],
    "WEATHER": ["Weather / Environment"],
    "HOLIDAY": ["Calendar / Holiday / Seasonality"],
}

DEFAULT_AVAILABILITY: dict[str, str] = {
    "MARKET_DEMAND": "PARTIAL",
    "COMPETITOR": "PARTIAL",
    "POLICY": "NOT_AVAILABLE",
    "NEWS": "NOT_AVAILABLE",
    "WEATHER": "NOT_AVAILABLE",
    "HOLIDAY": "NOT_AVAILABLE",
}

ALLOWED_AVAILABILITY = {"AVAILABLE", "PARTIAL", "NOT_AVAILABLE", "UNKNOWN", "DESIGN_REQUIRED"}
ALLOWED_SIGNAL_STATUS = {"NO_SIGNAL", "SIGNAL_OBSERVED", "SIGNAL_RELEVANT", "SIGNAL_CONFLICTING", "UNKNOWN", "NOT_CHECKED"}
ALLOWED_EVIDENCE_STATUS = {"NONE", "PARTIAL", "SUPPORTING", "CONTRADICTING", "MISSING", "INSUFFICIENT", "UNKNOWN"}
LINKED_EVIDENCE_STATUS = {"SUPPORTING", "CONTRADICTING"}


@dataclass(frozen=True)
class ExternalContextItem:
    key: str
    source_type: list[str]
    availability: str
    signal_status: str
    observed_at: str | None
    scope: dict[str, Any]
    evidence_status: str
    limitation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "sourceType": list(self.source_type),
            "availability": self.availability,
            "signalStatus": self.signal_status,
            "observedAt": self.observed_at,
            "scope": dict(self.scope or {}),
            "evidenceStatus": self.evidence_status,
            "limitation": self.limitation,
        }


@dataclass(frozen=True)
class ExternalContextValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def build_external_context_items(
    *,
    scope: dict[str, Any] | None = None,
    observed_at: datetime | str | None = None,
    observations: dict[str, dict[str, Any]] | None = None,
) -> list[ExternalContextItem]:
    """
    Build the Block 3 6-key boundary without collecting new external sources.

    `observations` is caller-provided. Availability alone never creates a signal.
    """
    scope0 = dict(scope or {})
    observed_text = _observed_at_text(observed_at)
    obs_by_key = {str(k or "").strip().upper(): dict(v or {}) for k, v in (observations or {}).items()}
    items: list[ExternalContextItem] = []

    for key in EXTERNAL_CONTEXT_KEYS:
        obs = obs_by_key.get(key) or {}
        availability = _normalize_availability(obs.get("availability") or DEFAULT_AVAILABILITY[key])
        signal_status = _signal_status_for(availability=availability, raw=obs.get("signalStatus"))
        evidence_status = _evidence_status_for(
            availability=availability,
            raw=obs.get("evidenceStatus"),
            scope=scope0,
        )
        item_observed_at = _observed_at_text(obs.get("observedAt")) or (observed_text if signal_status != "NOT_CHECKED" else None)
        limitation = str(obs.get("limitation") or _default_limitation(key, availability)).strip()
        items.append(
            ExternalContextItem(
                key=key,
                source_type=list(SOURCE_TYPES[key]),
                availability=availability,
                signal_status=signal_status,
                observed_at=item_observed_at,
                scope=dict(scope0),
                evidence_status=evidence_status,
                limitation=limitation,
            )
        )

    return items


def serialize_external_context(items: Iterable[ExternalContextItem]) -> list[dict[str, Any]]:
    result = validate_external_context_items(items)
    if not result.ok:
        raise ValueError(";".join(result.errors))
    return [item.to_dict() for item in items]


def validate_external_context_items(items: Iterable[ExternalContextItem]) -> ExternalContextValidationResult:
    rows = list(items or [])
    errors: list[str] = []
    keys = [str(getattr(item, "key", "") or "").strip().upper() for item in rows]
    if len(keys) != len(EXTERNAL_CONTEXT_KEYS):
        errors.append("external_context_must_have_exactly_6_keys")
    if set(keys) != set(EXTERNAL_CONTEXT_KEYS):
        errors.append("external_context_key_set_mismatch")
    if len(keys) != len(set(keys)):
        errors.append("external_context_duplicate_key")

    for item in rows:
        key = str(item.key or "").strip().upper()
        if key not in EXTERNAL_CONTEXT_KEYS:
            errors.append(f"{key}:unknown_external_context_key")
        if not isinstance(item.source_type, list) or not all(isinstance(value, str) for value in item.source_type):
            errors.append(f"{key}:sourceType_must_be_list_string")
        if item.availability not in ALLOWED_AVAILABILITY:
            errors.append(f"{key}:invalid_availability")
        if item.signal_status not in ALLOWED_SIGNAL_STATUS:
            errors.append(f"{key}:invalid_signalStatus")
        if item.evidence_status not in ALLOWED_EVIDENCE_STATUS:
            errors.append(f"{key}:invalid_evidenceStatus")
        if item.availability == "NOT_AVAILABLE" and item.signal_status not in {"NOT_CHECKED", "UNKNOWN"}:
            errors.append(f"{key}:not_available_cannot_emit_signal")
        if item.availability == "PARTIAL" and item.signal_status == "SIGNAL_OBSERVED" and item.observed_at is None:
            errors.append(f"{key}:partial_signal_requires_observation")
        if item.evidence_status in LINKED_EVIDENCE_STATUS and not _has_candidate_linkage(item.scope):
            errors.append(f"{key}:candidate_linkage_required_for_supporting_or_contradicting")
    return ExternalContextValidationResult(ok=(len(errors) == 0), errors=errors)


def _signal_status_for(*, availability: str, raw: Any) -> str:
    value = str(raw or "").strip().upper()
    if not value:
        return "NOT_CHECKED"
    if availability == "NOT_AVAILABLE" and value not in {"NOT_CHECKED", "UNKNOWN"}:
        return "NOT_CHECKED"
    if value not in ALLOWED_SIGNAL_STATUS:
        raise ValueError(f"invalid signalStatus: {raw}")
    return value


def _evidence_status_for(*, availability: str, raw: Any, scope: dict[str, Any]) -> str:
    value = str(raw or "").strip().upper()
    if not value:
        return "MISSING" if availability == "NOT_AVAILABLE" else "PARTIAL"
    if value not in ALLOWED_EVIDENCE_STATUS:
        raise ValueError(f"invalid evidenceStatus: {raw}")
    if value in LINKED_EVIDENCE_STATUS and not _has_candidate_linkage(scope):
        return "INSUFFICIENT"
    return value


def _normalize_availability(value: Any) -> str:
    text = str(value or "").strip().upper()
    if text not in ALLOWED_AVAILABILITY:
        raise ValueError(f"invalid availability: {value}")
    return text


def _observed_at_text(value: datetime | str | Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value).strip() or None


def _has_candidate_linkage(scope: dict[str, Any]) -> bool:
    return bool(str((scope or {}).get("candidate_id") or (scope or {}).get("candidateId") or "").strip())


def _default_limitation(key: str, availability: str) -> str:
    if availability == "NOT_AVAILABLE":
        return f"{key} source is not available in current runtime boundary"
    if availability == "PARTIAL":
        return f"{key} source is partial and must not be treated as candidate/root by itself"
    return f"{key} external context boundary"

