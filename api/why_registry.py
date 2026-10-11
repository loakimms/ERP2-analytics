from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class WhyDefinition:
    why_id: str
    title: str
    scope: str
    required_gates: tuple[str, ...] = field(default_factory=tuple)
    evidence_domains: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "why_id": self.why_id,
            "title": self.title,
            "scope": self.scope,
            "required_gates": list(self.required_gates),
            "evidence_domains": list(self.evidence_domains),
        }


SKU_P01_SALES_DROP_WHY = "SKU_P01_SALES_DROP_WHY"

_REGISTRY: dict[str, WhyDefinition] = {
    SKU_P01_SALES_DROP_WHY: WhyDefinition(
        why_id=SKU_P01_SALES_DROP_WHY,
        title="P01 - 왜 이 SKU 매출이 떨어졌나?",
        scope="sku",
        required_gates=(
            "IDENTITY_GATE",
            "JOIN_GUARD",
            "BASELINE_GATE",
            "DATA_HEALTH_GATE",
            "EVENT_BUNDLE_MIN",
            "CAUSALITY_GUARD_MIN",
        ),
        evidence_domains=("sales", "organic", "purchase", "sa", "review", "qna", "index"),
    )
}


def get_why_definition(why_id: str) -> WhyDefinition:
    key = str(why_id or "").strip().upper()
    if key not in _REGISTRY:
        raise KeyError(f"unknown WHY id: {why_id}")
    return _REGISTRY[key]


def list_why_definitions() -> list[WhyDefinition]:
    return [_REGISTRY[key] for key in sorted(_REGISTRY.keys())]


def is_supported_why(why_id: str) -> bool:
    return str(why_id or "").strip().upper() in _REGISTRY

