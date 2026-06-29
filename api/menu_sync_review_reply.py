from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from db import NaverReviewRaw, NaverReviewReplyRaw, ReviewReplyDraft, ReviewReplyFeedbackKnowledge
from menu_sync_common import order_by_query, replace_rows_by_scope, serialize_rows, upsert_rows
from schemas import MenuSyncMenuSummary, MenuSyncTableSummary


MENU_ID = "review_reply"
MENU_LABEL = "리뷰 관리"
MENU_DESCRIPTION = "리뷰 원문, 판매자 답글 원문, 답글 초안, 피드백 지식 전체"

_FILE_PREFIX = "menus/review_reply"

_EXPORT_TABLES: list[tuple[str, Any, tuple[str, ...]]] = [
    ("naver_review_raw", NaverReviewRaw, ("review_key",)),
    ("naver_review_reply_raw", NaverReviewReplyRaw, ("review_key",)),
    ("review_reply_draft", ReviewReplyDraft, ("generated_at", "draft_id")),
    ("review_reply_feedback_knowledge", ReviewReplyFeedbackKnowledge, ("created_at", "knowledge_id")),
]


def review_reply_required_files() -> list[str]:
    return [f"{_FILE_PREFIX}/{table_name}.json" for table_name, _model, _keys in _EXPORT_TABLES]


def export_review_reply_bundle(db: Session) -> tuple[MenuSyncMenuSummary, dict[str, bytes]]:
    tables: list[MenuSyncTableSummary] = []
    files: dict[str, bytes] = {}
    for table_name, model, order_fields in _EXPORT_TABLES:
        rows = order_by_query(db, model, order_fields).all()
        serialized = serialize_rows(rows, model)
        file_name = f"{_FILE_PREFIX}/{table_name}.json"
        files[file_name] = json.dumps(serialized, ensure_ascii=False, indent=2).encode("utf-8")
        tables.append(
            MenuSyncTableSummary(
                table_name=table_name,
                file_name=file_name,
                row_count=len(serialized),
            )
        )
    return (
        MenuSyncMenuSummary(
            menu_id=MENU_ID,
            label=MENU_LABEL,
            tables=tables,
        ),
        files,
    )


def import_review_reply_bundle(db: Session, entries: dict[str, bytes]) -> list[MenuSyncTableSummary]:
    required = set(review_reply_required_files())
    missing = [name for name in required if name not in entries]
    if missing:
        raise ValueError(f"missing_required_file:{missing[0]}")

    decoded: dict[str, list[dict[str, Any]]] = {}
    for file_name in review_reply_required_files():
        try:
            decoded[file_name] = json.loads(entries[file_name].decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"invalid_json:{file_name}:{exc}") from exc

    raw_file = f"{_FILE_PREFIX}/naver_review_raw.json"
    reply_file = f"{_FILE_PREFIX}/naver_review_reply_raw.json"
    draft_file = f"{_FILE_PREFIX}/review_reply_draft.json"
    knowledge_file = f"{_FILE_PREFIX}/review_reply_feedback_knowledge.json"

    review_keys = {str(item.get("review_key") or "").strip() for item in decoded[raw_file]}
    reply_review_keys = {str(item.get("review_key") or "").strip() for item in decoded[reply_file]}
    draft_review_keys = {str(item.get("review_key") or "").strip() for item in decoded[draft_file]}
    if reply_review_keys and not reply_review_keys.issubset(review_keys):
        raise ValueError("invalid_bundle_reference:review_reply_raw")
    if draft_review_keys and not draft_review_keys.issubset(review_keys):
        raise ValueError("invalid_bundle_reference:review_reply_draft")

    draft_ids = {str(item.get("draft_id") or "").strip() for item in decoded[draft_file]}
    knowledge_draft_ids = {str(item.get("source_draft_id") or "").strip() for item in decoded[knowledge_file]}
    if knowledge_draft_ids and not knowledge_draft_ids.issubset(draft_ids):
        raise ValueError("invalid_bundle_reference:review_reply_feedback_knowledge")

    summaries: list[MenuSyncTableSummary] = []

    raw_rows = decoded[raw_file]
    raw_count = upsert_rows(db, NaverReviewRaw, raw_rows, ("review_key",))
    summaries.append(
        MenuSyncTableSummary(
            table_name="naver_review_raw",
            file_name=raw_file,
            row_count=raw_count,
        )
    )

    reply_rows = decoded[reply_file]
    reply_count = replace_rows_by_scope(
        db,
        NaverReviewReplyRaw,
        reply_rows,
        scope_field="review_key",
        scope_values=sorted(review_keys),
    )
    summaries.append(
        MenuSyncTableSummary(
            table_name="naver_review_reply_raw",
            file_name=reply_file,
            row_count=reply_count,
        )
    )

    scoped_review_keys = sorted(review_keys)
    existing_draft_ids: list[str] = []
    if scoped_review_keys:
        existing_draft_ids = [
            str(item[0] or "").strip()
            for item in db.query(ReviewReplyDraft.draft_id)
            .filter(ReviewReplyDraft.review_key.in_(scoped_review_keys))
            .all()
        ]

    knowledge_scope_ids = sorted(
        {
            *[draft_id for draft_id in existing_draft_ids if draft_id],
            *[draft_id for draft_id in draft_ids if draft_id],
        }
    )
    if knowledge_scope_ids:
        db.query(ReviewReplyFeedbackKnowledge).filter(
            ReviewReplyFeedbackKnowledge.source_draft_id.in_(knowledge_scope_ids)
        ).delete(synchronize_session=False)
    if scoped_review_keys:
        db.query(ReviewReplyDraft).filter(ReviewReplyDraft.review_key.in_(scoped_review_keys)).delete(
            synchronize_session=False
        )

    draft_rows = decoded[draft_file]
    draft_count = upsert_rows(db, ReviewReplyDraft, draft_rows, ("draft_id",))
    summaries.append(
        MenuSyncTableSummary(
            table_name="review_reply_draft",
            file_name=draft_file,
            row_count=draft_count,
        )
    )

    knowledge_rows = decoded[knowledge_file]
    knowledge_count = upsert_rows(db, ReviewReplyFeedbackKnowledge, knowledge_rows, ("knowledge_id",))
    summaries.append(
        MenuSyncTableSummary(
            table_name="review_reply_feedback_knowledge",
            file_name=knowledge_file,
            row_count=knowledge_count,
        )
    )

    db.commit()
    return summaries
