"""Draft lineage recording: the original AI draft is never overwritten.

ORIGINAL_AI_DRAFT -> HUMAN_EDITED_FINAL -> APPROVED_REPLY -> PUBLISHED_REPLY -> REMOTE_VERIFIED_REPLY
"""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from db import ReviewReplyDraft, ReviewReplyDraftRevision

STAGE_ORIGINAL_AI_DRAFT = "ORIGINAL_AI_DRAFT"
STAGE_HUMAN_EDITED_FINAL = "HUMAN_EDITED_FINAL"
STAGE_APPROVED_REPLY = "APPROVED_REPLY"
STAGE_PUBLISHED_REPLY = "PUBLISHED_REPLY"
STAGE_REMOTE_VERIFIED_REPLY = "REMOTE_VERIFIED_REPLY"

_STAGE_ORDER = {
    STAGE_ORIGINAL_AI_DRAFT: 0,
    STAGE_HUMAN_EDITED_FINAL: 1,
    STAGE_APPROVED_REPLY: 2,
    STAGE_PUBLISHED_REPLY: 3,
    STAGE_REMOTE_VERIFIED_REPLY: 4,
}

LINEAGE_ORIGIN_RECORDED_AT_GENERATION = "RECORDED_AT_GENERATION"
# Drafts created before lineage existed: the text at first edit is the best available original.
LINEAGE_ORIGIN_LEGACY_PRE_LINEAGE = "LEGACY_PRE_LINEAGE"


def _now() -> datetime:
    return datetime.now(ZoneInfo("Asia/Seoul"))


def _collapse(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _sha256(text: object) -> str:
    return hashlib.sha256(_collapse(text).encode("utf-8")).hexdigest()


def _add_revision(db: Session, row: ReviewReplyDraft, stage: str, text_value: str, source: str) -> None:
    db.add(
        ReviewReplyDraftRevision(
            revision_id=str(uuid.uuid4()),
            draft_id=str(row.draft_id or ""),
            review_key=str(row.review_key or ""),
            stage=stage,
            revision_text=str(text_value or ""),
            text_sha256=_sha256(text_value),
            source=source,
            created_at=_now(),
        )
    )


def record_original_ai_draft(db: Session, row: ReviewReplyDraft) -> None:
    text0 = str(row.draft_text or "")
    if not _collapse(text0) or getattr(row, "original_ai_text", None):
        return
    row.original_ai_text = text0
    row.lineage_origin = LINEAGE_ORIGIN_RECORDED_AT_GENERATION
    _add_revision(db, row, STAGE_ORIGINAL_AI_DRAFT, text0, "generation")


def _ensure_original_before_change(db: Session, row: ReviewReplyDraft) -> None:
    if getattr(row, "original_ai_text", None):
        return
    current = str(row.draft_text or "")
    if not _collapse(current):
        return
    row.original_ai_text = current
    row.lineage_origin = LINEAGE_ORIGIN_LEGACY_PRE_LINEAGE
    _add_revision(db, row, STAGE_ORIGINAL_AI_DRAFT, current, "legacy_backfill_at_first_change")


def record_human_edit(db: Session, row: ReviewReplyDraft, new_text: str) -> bool:
    """Call before assigning draft_text. Returns True when the text actually changed."""
    _ensure_original_before_change(db, row)
    if _collapse(new_text) == _collapse(row.draft_text):
        return False
    row.human_edit_count = int(getattr(row, "human_edit_count", 0) or 0) + 1
    row.human_edited_at = _now()
    _add_revision(db, row, STAGE_HUMAN_EDITED_FINAL, new_text, "manual_edit")
    return True


def record_approval(db: Session, row: ReviewReplyDraft) -> None:
    _ensure_original_before_change(db, row)
    row.approved_text = str(row.draft_text or "")
    row.approved_at = _now()
    _add_revision(db, row, STAGE_APPROVED_REPLY, row.approved_text, "approve")


def record_publication(db: Session, row: ReviewReplyDraft, published_text: str) -> None:
    _ensure_original_before_change(db, row)
    row.published_text = str(published_text or "")
    row.published_at = _now()
    _add_revision(db, row, STAGE_PUBLISHED_REPLY, row.published_text, "seller_center_submit")


def build_lineage_view(
    row: ReviewReplyDraft,
    revisions: list[ReviewReplyDraftRevision],
    remote_reply_text: str | None,
) -> dict:
    original = getattr(row, "original_ai_text", None)
    published = getattr(row, "published_text", None)
    remote = _collapse(remote_reply_text)
    remote_verified = None
    if published and remote:
        remote_verified = _collapse(published) == remote
    return {
        "draft_id": str(row.draft_id or ""),
        "review_key": str(row.review_key or ""),
        "lineage_origin": getattr(row, "lineage_origin", None),
        "stages": {
            STAGE_ORIGINAL_AI_DRAFT: original,
            STAGE_HUMAN_EDITED_FINAL: str(row.draft_text or "") if int(getattr(row, "human_edit_count", 0) or 0) > 0 else None,
            STAGE_APPROVED_REPLY: getattr(row, "approved_text", None),
            STAGE_PUBLISHED_REPLY: published,
            STAGE_REMOTE_VERIFIED_REPLY: remote or None,
        },
        "human_edit_count": int(getattr(row, "human_edit_count", 0) or 0),
        "human_edited": bool(original) and _collapse(original) != _collapse(row.draft_text),
        "remote_matches_published": remote_verified,
        "revisions": [
            {
                "stage": rev.stage,
                "text": rev.revision_text,
                "source": rev.source,
                "created_at": rev.created_at.isoformat() if getattr(rev, "created_at", None) else None,
            }
            for rev in sorted(
                revisions,
                key=lambda r: (str(getattr(r, "created_at", "") or ""), _STAGE_ORDER.get(str(r.stage or ""), 99)),
            )
        ],
    }
