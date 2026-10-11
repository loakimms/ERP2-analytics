from __future__ import annotations


CONTENT_CHANNELS = ("blog", "instagram", "shorts")
LEGACY_GFA_CHANNEL = "gfa"


def normalize_channel(value: str | None) -> str:
    return str(value or "").strip().lower()


def is_content_channel(value: str | None) -> bool:
    return normalize_channel(value) in CONTENT_CHANNELS


def is_legacy_gfa_channel(value: str | None) -> bool:
    return normalize_channel(value) == LEGACY_GFA_CHANNEL
