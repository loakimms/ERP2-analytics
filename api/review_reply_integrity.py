"""Seller reply body integrity rules shared by every remote reply ingest path.

A remote reply body is stored only when it is VALID. Counter values ("500"),
character counters ("0 / 1000"), empty editors and Seller Center UI chrome are
never accepted as a seller reply.
"""

from __future__ import annotations

import re

REPLY_BODY_VALID = "VALID"
REPLY_BODY_EMPTY = "INVALID_EMPTY"
REPLY_BODY_NUMERIC_COUNTER = "INVALID_NUMERIC_COUNTER"
REPLY_BODY_CHAR_COUNTER = "INVALID_CHAR_COUNTER"
REPLY_BODY_SELLER_CENTER_UI = "INVALID_SELLER_CENTER_UI"
REPLY_BODY_TOO_SHORT = "INVALID_TOO_SHORT"

INVALID_REPLY_COLLECT_STATUS = "invalid_reply_body"

_NUMERIC_ONLY_RE = re.compile(r"^[\d\s,./:%-]+$")
_CHAR_COUNTER_RE = re.compile(r"\b\d{1,4}\s*/\s*[1-9],?\d{3}\b")
_UI_STRONG_MARKERS = (
    "최소 5자",
    "리뷰 신고",
    "베스트리뷰여부",
    "리뷰전시여부",
    "IE환경",
    "재구매 여부 툴팁",
    "리뷰 도움수",
    "이전 리뷰 다음 리뷰",
    "[신고하기]",
    "답글을 입력",
    "답글을 작성해",
)
_UI_WEAK_MARKERS = (
    "답글 등록",
    "답글 수정",
    "답글 삭제",
    "등록하기",
    "리뷰 정보",
    "리뷰타입",
    "구독유형",
    "판매자 답글",
)
# Shortest genuine replies observed in the corpus ("감사합니다", "즐거운 하루 되세요~").
_MIN_VALID_LENGTH = 2


def _collapse(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def classify_reply_body(text: object) -> str:
    body = _collapse(text)
    if not body:
        return REPLY_BODY_EMPTY
    if _NUMERIC_ONLY_RE.fullmatch(body):
        return REPLY_BODY_NUMERIC_COUNTER
    if any(marker in body for marker in _UI_STRONG_MARKERS):
        return REPLY_BODY_SELLER_CENTER_UI
    if _CHAR_COUNTER_RE.search(body):
        stripped = _CHAR_COUNTER_RE.sub(" ", body)
        for marker in _UI_WEAK_MARKERS:
            stripped = stripped.replace(marker, " ")
        if len(_collapse(stripped)) < 5:
            return REPLY_BODY_CHAR_COUNTER
        return REPLY_BODY_SELLER_CENTER_UI
    weak_hits = sum(1 for marker in _UI_WEAK_MARKERS if marker in body)
    if weak_hits >= 2:
        return REPLY_BODY_SELLER_CENTER_UI
    if weak_hits == 1:
        remainder = body
        for marker in _UI_WEAK_MARKERS:
            remainder = remainder.replace(marker, " ")
        if len(_collapse(remainder)) < 5:
            return REPLY_BODY_SELLER_CENTER_UI
    if len(body) < _MIN_VALID_LENGTH:
        return REPLY_BODY_TOO_SHORT
    return REPLY_BODY_VALID


def is_valid_reply_body(text: object) -> bool:
    return classify_reply_body(text) == REPLY_BODY_VALID


def reply_body_rejection_reason(text: object) -> str | None:
    verdict = classify_reply_body(text)
    if verdict == REPLY_BODY_VALID:
        return None
    return f"reply_text_rejected_{verdict.lower()}"


def classify_recovery_eligibility(
    *,
    stored_reply_text: object,
    review_id_original: object,
    excel_reply_flag: object,
    excel_reply_written_at: object,
) -> dict:
    """Dry-run recovery eligibility for one stored reply row (no remote call, no write)."""
    verdict = classify_reply_body(stored_reply_text)
    if verdict == REPLY_BODY_VALID:
        return {"body_verdict": verdict, "eligibility": "NOT_CONTAMINATED"}
    rid = _collapse(review_id_original)
    flag = _collapse(excel_reply_flag).upper()
    if not rid:
        eligibility = "UNRECOVERABLE_NO_REMOTE_ID"
    elif flag == "Y" and _collapse(excel_reply_written_at):
        eligibility = "RECOLLECT_CANDIDATE_REMOTE_REPLY_EXPECTED"
    elif flag == "N":
        eligibility = "REVERIFY_REMOTE_REPLY_LIKELY_ABSENT"
    else:
        eligibility = "REVERIFY_REMOTE_STATE_UNKNOWN"
    return {"body_verdict": verdict, "eligibility": eligibility}


RECOVERY_OUTCOMES = (
    "RECOVERED_REMOTE_VERIFIED",
    "REMOTE_REPLY_ABSENT",
    "REMOTE_CHECK_FAILED_RETRY",
    "REMOTE_BODY_STILL_INVALID_HOLD",
    "REMOTE_ID_MISMATCH_HOLD",
)


def decide_recovery_outcome(
    *,
    target_review_id_original: object,
    remote_review_id_original: object,
    remote_check_ok: bool,
    remote_reply_present: bool | None,
    remote_reply_text: object,
) -> str:
    if not remote_check_ok:
        return "REMOTE_CHECK_FAILED_RETRY"
    if _collapse(target_review_id_original) != _collapse(remote_review_id_original):
        return "REMOTE_ID_MISMATCH_HOLD"
    if remote_reply_present is False:
        return "REMOTE_REPLY_ABSENT"
    if not is_valid_reply_body(remote_reply_text):
        return "REMOTE_BODY_STILL_INVALID_HOLD"
    return "RECOVERED_REMOTE_VERIFIED"
