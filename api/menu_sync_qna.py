from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from db import (
    CommerceQnaAnalysis,
    CommerceQnaAnalysisIssueTag,
    CommerceQnaAnalysisKeyword,
    CommerceQnaDraft,
    CommerceQnaDraftValidation,
    CommerceQnaFeedbackKnowledge,
    CommerceQnaRaw,
    CommerceQnaSubmitLog,
)
from menu_sync_common import order_by_query, replace_rows_by_scope, serialize_rows, upsert_rows
from schemas import MenuSyncMenuSummary, MenuSyncTableSummary


MENU_ID = "review_qna"
MENU_LABEL = "리뷰 Q&A"
MENU_DESCRIPTION = "Q&A 원문, 초안, 검수, 제출 로그, 분석 결과 전체"

_FILE_PREFIX = "menus/review_qna"

_EXPORT_TABLES: list[tuple[str, Any, tuple[str, ...]]] = [
    ("commerce_qna_raw", CommerceQnaRaw, ("qna_key",)),
    ("commerce_qna_draft", CommerceQnaDraft, ("draft_id",)),
    ("commerce_qna_draft_validation", CommerceQnaDraftValidation, ("draft_id",)),
    ("commerce_qna_submit_log", CommerceQnaSubmitLog, ("submit_id",)),
    ("commerce_qna_feedback_knowledge", CommerceQnaFeedbackKnowledge, ("knowledge_id",)),
    ("commerce_qna_analysis", CommerceQnaAnalysis, ("qna_key",)),
    ("commerce_qna_analysis_keyword", CommerceQnaAnalysisKeyword, ("qna_key", "keyword", "keyword_type")),
    ("commerce_qna_analysis_issue_tag", CommerceQnaAnalysisIssueTag, ("qna_key", "issue_tag", "severity")),
]


def qna_required_files() -> list[str]:
    return [f"{_FILE_PREFIX}/{table_name}.json" for table_name, _model, _keys in _EXPORT_TABLES]


def export_review_qna_bundle(db: Session) -> tuple[MenuSyncMenuSummary, dict[str, bytes]]:
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


def import_review_qna_bundle(db: Session, entries: dict[str, bytes]) -> list[MenuSyncTableSummary]:
    required = set(qna_required_files())
    missing = [name for name in required if name not in entries]
    if missing:
        raise ValueError(f"missing_required_file:{missing[0]}")

    decoded: dict[str, list[dict[str, Any]]] = {}
    for file_name in qna_required_files():
        try:
            decoded[file_name] = json.loads(entries[file_name].decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"invalid_json:{file_name}:{exc}") from exc

    draft_ids = {str(item.get("draft_id") or "").strip() for item in decoded[f"{_FILE_PREFIX}/commerce_qna_draft.json"]}
    validation_draft_ids = {
        str(item.get("draft_id") or "").strip()
        for item in decoded[f"{_FILE_PREFIX}/commerce_qna_draft_validation.json"]
    }
    submit_draft_ids = {
        str(item.get("draft_id") or "").strip()
        for item in decoded[f"{_FILE_PREFIX}/commerce_qna_submit_log.json"]
    }
    if not validation_draft_ids.issubset(draft_ids):
        raise ValueError("invalid_bundle_reference:draft_validation")
    if not submit_draft_ids.issubset(draft_ids):
        raise ValueError("invalid_bundle_reference:submit_log")

    qna_keys = {str(item.get("qna_key") or "").strip() for item in decoded[f"{_FILE_PREFIX}/commerce_qna_raw.json"]}
    analysis_qna_keys = {str(item.get("qna_key") or "").strip() for item in decoded[f"{_FILE_PREFIX}/commerce_qna_analysis.json"]}
    if analysis_qna_keys and not analysis_qna_keys.issubset(qna_keys):
        raise ValueError("invalid_bundle_reference:analysis")
    analysis_keyword_qna_keys = {
        str(item.get("qna_key") or "").strip()
        for item in decoded[f"{_FILE_PREFIX}/commerce_qna_analysis_keyword.json"]
    }
    analysis_issue_qna_keys = {
        str(item.get("qna_key") or "").strip()
        for item in decoded[f"{_FILE_PREFIX}/commerce_qna_analysis_issue_tag.json"]
    }
    if analysis_keyword_qna_keys and not analysis_keyword_qna_keys.issubset(analysis_qna_keys):
        raise ValueError("invalid_bundle_reference:analysis_keyword")
    if analysis_issue_qna_keys and not analysis_issue_qna_keys.issubset(analysis_qna_keys):
        raise ValueError("invalid_bundle_reference:analysis_issue_tag")

    summaries: list[MenuSyncTableSummary] = []
    for table_name, model, key_fields in _EXPORT_TABLES:
        file_name = f"{_FILE_PREFIX}/{table_name}.json"
        rows = decoded[file_name]
        if table_name == "commerce_qna_analysis_keyword":
            row_count = replace_rows_by_scope(
                db,
                model,
                rows,
                scope_field="qna_key",
                scope_values=sorted(analysis_qna_keys),
            )
        elif table_name == "commerce_qna_analysis_issue_tag":
            row_count = replace_rows_by_scope(
                db,
                model,
                rows,
                scope_field="qna_key",
                scope_values=sorted(analysis_qna_keys),
            )
        else:
            row_count = upsert_rows(db, model, rows, key_fields)
        summaries.append(
            MenuSyncTableSummary(
                table_name=table_name,
                file_name=file_name,
                row_count=row_count,
            )
        )
    db.commit()
    return summaries
