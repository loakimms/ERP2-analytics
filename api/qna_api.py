from __future__ import annotations

import base64
import json
import re
import time
import urllib.parse
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from fastapi import Depends, HTTPException, Query
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from db import (
    CommerceQnaAnalysisIssueTag,
    CommerceQnaDraft,
    CommerceQnaDraftValidation,
    CommerceQnaFeedbackKnowledge,
    CommerceQnaRaw,
    CommerceQnaSubmitLog,
)
from schemas import (
    QnaAnalysisResponse,
    QnaAnalysisItemsResponse,
    QnaAnalysisRunRequest,
    QnaAnalysisRunResponse,
    QnaAnalysisSummaryResponse,
    QnaAnalysisTrendsResponse,
    QnaConversionBarriersResponse,
    QnaDraftBatchGenerateRequest,
    QnaDraftBatchGenerateResponse,
    QnaDraftGenerateRequest,
    QnaDraftResponse,
    QnaDraftStatusUpdateRequest,
    QnaDraftStatusUpdateResponse,
    QnaDraftSubmitRequest,
    QnaDraftSubmitResponse,
    QnaDraftValidateRequest,
    QnaDraftValidateResponse,
    QnaDraftUpdateRequest,
    QnaDraftUpdateResponse,
    QnaDraftValidationResult,
    QnaFaqCandidatesResponse,
    QnaMarketingInsightsResponse,
    QnaQualityIssuesResponse,
    QnaSyncRequest,
    QnaSyncResponse,
    QnaWorkbenchDashboard,
    QnaWorkbenchItem,
    QnaWorkbenchResponse,
)
from qna_expert_analysis import (
    build_qna_analysis_items,
    build_qna_analysis_summary,
    build_qna_analysis_trends,
    build_qna_conversion_barriers,
    build_qna_faq_candidates,
    build_qna_marketing_insights,
    build_qna_quality_issues,
    run_qna_analysis,
)
from settings_store import get_api_settings


OPENAI_DEFAULT_MODEL = "gpt-5.2"
QNA_PROMPT_VERSION = "commerce_qna_v1"
NAVER_COMMERCE_TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token"
NAVER_COMMERCE_API_BASE = "https://api.commerce.naver.com/external"
_NAVER_COMMERCE_TOKEN_CACHE: dict[str, object] = {"token": None, "fetched_at": 0.0}
QNA_WORKBENCH_ISSUE_TAG_ALIASES: dict[str, str] = {
    "ODOR": "ODOR",
    "냄새": "ODOR",
    "향": "ODOR",
    "IRRITATION": "IRRITATION",
    "자극": "IRRITATION",
    "따가움": "IRRITATION",
    "COLOR_DIFF": "COLOR_DIFF",
    "색상": "COLOR_DIFF",
    "SAFETY_CHECK": "SAFETY_CHECK",
    "안전성": "SAFETY_CHECK",
    "성분": "SAFETY_CHECK",
    "SHIPPING_DELAY": "SHIPPING_DELAY",
    "배송": "SHIPPING_DELAY",
    "DURATION": "DURATION",
    "지속력": "DURATION",
}
QNA_WORKBENCH_ISSUE_TAG_TOKENS: dict[str, tuple[str, ...]] = {
    "ODOR": ("냄새", "향", "향이 강"),
    "IRRITATION": ("자극", "따갑", "민감"),
    "COLOR_DIFF": ("색상", "컬러", "사진과 다"),
    "SAFETY_CHECK": ("안전", "성분", "부작용"),
    "SHIPPING_DELAY": ("배송", "출고", "도착", "지연"),
    "DURATION": ("지속", "오래가"),
}


def _now_kst() -> datetime:
    return datetime.now(ZoneInfo("Asia/Seoul"))


def _collapse_ws_text(value: object, limit: int = 4000) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) > limit:
        return text[:limit]
    return text


def _normalize_date_range(
    start_date: date | None,
    end_date: date | None,
    *,
    default_days: int | None = None,
) -> tuple[date | None, date | None]:
    start0 = start_date
    end0 = end_date
    if start0 is None and end0 is None:
        if default_days is None:
            return None, None
        end0 = date.today()
        start0 = end0 - timedelta(days=max(1, int(default_days)))
    elif start0 is None and end0 is not None:
        start0 = end0 - timedelta(days=max(1, int(default_days or 14)))
    elif start0 is not None and end0 is None:
        end0 = start0 + timedelta(days=max(1, int(default_days or 14)))
    if start0 is not None and end0 is not None and start0 > end0:
        start0, end0 = end0, start0
    return start0, end0


def _normalize_qna_workbench_issue_tag(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return QNA_WORKBENCH_ISSUE_TAG_ALIASES.get(raw.upper(), QNA_WORKBENCH_ISSUE_TAG_ALIASES.get(raw, raw.upper()))


def _qna_workbench_issue_tag_tokens(value: str | None) -> tuple[str, ...]:
    normalized = _normalize_qna_workbench_issue_tag(value)
    if not normalized:
        return tuple()
    tokens = QNA_WORKBENCH_ISSUE_TAG_TOKENS.get(normalized)
    if tokens:
        return tokens
    raw = str(value or "").strip()
    return (raw,) if raw else tuple()


def _display_qna_workbench_issue_tag(value: str | None) -> str:
    normalized = _normalize_qna_workbench_issue_tag(value)
    labels = {
        "ODOR": "냄새",
        "IRRITATION": "자극",
        "COLOR_DIFF": "색상",
        "SAFETY_CHECK": "안전성",
        "SHIPPING_DELAY": "배송",
        "DURATION": "지속력",
    }
    return labels.get(normalized, str(value or "").strip())


def _get_qna_issue_tag_display_map(db: Session, qna_keys: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    qna_keys0 = [str(item or "").strip() for item in qna_keys if str(item or "").strip()]
    if not qna_keys0:
        return out
    rows = (
        db.query(CommerceQnaAnalysisIssueTag)
        .filter(CommerceQnaAnalysisIssueTag.qna_key.in_(qna_keys0))
        .all()
    )
    for row in rows:
        qna_key = str(getattr(row, "qna_key", "") or "").strip()
        label = _display_qna_workbench_issue_tag(str(getattr(row, "issue_tag", "") or ""))
        if not qna_key or not label:
            continue
        current = out.setdefault(qna_key, [])
        if label not in current:
            current.append(label)
    return out


def _qna_issue_tag_counts(issue_tag_map: dict[str, list[str]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for labels in issue_tag_map.values():
        for label in labels:
            if not label:
                continue
            counts[label] = int(counts.get(label, 0) + 1)
    return dict(sorted(counts.items(), key=lambda item: (-int(item[1] or 0), str(item[0] or ""))))


def _qna_row_matches_issue_tag_text(row: CommerceQnaRaw, issue_tag: str | None) -> bool:
    tokens = _qna_workbench_issue_tag_tokens(issue_tag)
    if not tokens:
        return False
    text = " ".join(
        [
            str(getattr(row, "title", "") or ""),
            str(getattr(row, "category", "") or ""),
            str(getattr(row, "inquiry_text", "") or ""),
            str(getattr(row, "product_name", "") or ""),
        ]
    ).lower()
    return any(str(token or "").lower() in text for token in tokens)


def _filter_qna_rows_by_issue_tag(db: Session, rows: list[CommerceQnaRaw], issue_tag: str | None) -> list[CommerceQnaRaw]:
    normalized = _normalize_qna_workbench_issue_tag(issue_tag)
    if not normalized or not rows:
        return rows
    qna_keys = [str(getattr(row, "qna_key", "") or "").strip() for row in rows if str(getattr(row, "qna_key", "") or "").strip()]
    matched_qna_keys: set[str] = set()
    if qna_keys:
        analysis_rows = (
            db.query(CommerceQnaAnalysisIssueTag)
            .filter(CommerceQnaAnalysisIssueTag.qna_key.in_(qna_keys))
            .all()
        )
        for row in analysis_rows:
            issue_tag0 = _normalize_qna_workbench_issue_tag(str(getattr(row, "issue_tag", "") or ""))
            if issue_tag0 == normalized:
                matched_qna_keys.add(str(getattr(row, "qna_key", "") or "").strip())
    return [
        row
        for row in rows
        if str(getattr(row, "qna_key", "") or "").strip() in matched_qna_keys or _qna_row_matches_issue_tag_text(row, issue_tag)
    ]


def _iter_date_windows(start_date: date, end_date: date, *, max_days: int) -> list[tuple[date, date]]:
    if max_days <= 0:
        raise ValueError("max_days must be positive")
    windows: list[tuple[date, date]] = []
    current_start = start_date
    while current_start <= end_date:
        current_end = min(end_date, current_start + timedelta(days=max_days - 1))
        windows.append((current_start, current_end))
        current_start = current_end + timedelta(days=1)
    return windows


def _is_naver_commerce_rate_limited(status_code: int | None, error: str | None) -> bool:
    code = int(status_code or 0)
    text = str(error or "").upper()
    return code in (429, 500, 502, 503, 504) and ("GW.RATE_LIMIT" in text or "RATE_LIMIT" in text or "요청이 많아" in str(error or ""))


def _safe_err_text(resp: requests.Response, limit: int = 500) -> str:
    try:
        text = str(resp.text or "")
    except Exception:
        return ""
    text = text.replace("\n", " ").replace("\r", " ").strip()
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _parse_iso_datetime(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    candidates = [text]
    if text.endswith("Z"):
        candidates.append(text[:-1] + "+00:00")
    for candidate in candidates:
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            continue
    return None


def _unwrap_list_from_commerce_response(payload: object) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    keys = ("data", "items", "content", "contents", "inquiries", "qnas")
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = _unwrap_list_from_commerce_response(value)
            if nested:
                return nested
    return []


def _looks_like_ip_not_allowed(err: str | None) -> bool:
    text = str(err or "")
    return ("GW.IP_NOT_ALLOWED" in text) or ("IP_NOT_ALLOWED" in text) or ("허용" in text and "IP" in text)


def _kind_label(kind: str) -> str:
    return "고객 문의" if str(kind or "").strip() == "customer" else "상품 문의"


def _qna_key(kind: str, external_inquiry_id: object) -> str:
    return f"{str(kind or '').strip()}:{str(external_inquiry_id or '').strip()}"


def _openai_prefers_max_completion_tokens(model_name: str | None) -> bool:
    model0 = str(model_name or "").strip().lower()
    return model0.startswith(("gpt-5", "o1", "o3", "o4"))


def _build_openai_chat_payload(
    *,
    model_name: str,
    messages: list[dict],
    temperature: float = 0.2,
    max_output_tokens: int = 280,
) -> dict:
    payload = {
        "model": str(model_name or "").strip(),
        "messages": list(messages or []),
        "temperature": float(temperature),
    }
    token_key = "max_completion_tokens" if _openai_prefers_max_completion_tokens(model_name) else "max_tokens"
    payload[token_key] = max(1, int(max_output_tokens or 280))
    return payload


def _is_openai_unsupported_max_tokens_response(resp: requests.Response) -> bool:
    try:
        if int(getattr(resp, "status_code", 0) or 0) != 400:
            return False
    except Exception:
        return False
    try:
        body = resp.json() or {}
    except Exception:
        body = {}
    err = body.get("error") if isinstance(body, dict) else {}
    if not isinstance(err, dict):
        err = {}
    param = str(err.get("param") or "").strip().lower()
    code = str(err.get("code") or "").strip().lower()
    message = str(err.get("message") or getattr(resp, "text", "") or "").strip().lower()
    return param == "max_tokens" or ("max_tokens" in message and ("unsupported" in code or "not supported" in message))


def _post_openai_chat_completion_compatible(*, api_key: str, payload: dict, timeout: int = 30) -> requests.Response:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers=headers,
        json=payload,
        timeout=timeout,
    )
    if _is_openai_unsupported_max_tokens_response(resp) and "max_tokens" in payload and "max_completion_tokens" not in payload:
        retry_payload = dict(payload)
        retry_payload["max_completion_tokens"] = retry_payload.pop("max_tokens")
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=retry_payload,
            timeout=timeout,
        )
    return resp


def _get_api_setting(db: Session, name: str) -> str:
    data = get_api_settings(db, [name])
    return str(data.get(name, "") or "").strip()


def _naver_commerce_client_secret_sign(*, client_id: str, client_secret: str, timestamp_ms: int) -> str:
    cid = str(client_id or "").strip()
    csec = str(client_secret or "").strip()
    ts = int(timestamp_ms)
    if not cid or not csec:
        raise ValueError("client_id/client_secret required")
    if ts <= 0:
        raise ValueError("timestamp_ms must be > 0")
    try:
        ok_salt = bool(re.match(r"^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{22}$", csec))
    except Exception:
        ok_salt = False
    if not ok_salt:
        raise ValueError("client_secret must be bcrypt salt like '$2a$10$abcdefghijklmnopqrstuv' (29 chars)")
    try:
        import bcrypt  # type: ignore
    except Exception as exc:
        raise ValueError(f"bcrypt_not_available: {exc}")
    password = f"{cid}_{ts}".encode("utf-8")
    salt = csec.encode("utf-8")
    hashed = bcrypt.hashpw(password, salt)
    return base64.b64encode(hashed).decode("utf-8")


def _naver_commerce_fetch_access_token(*, client_id: str, client_secret: str) -> tuple[str | None, dict]:
    timestamp_ms = int(time.time() * 1000)
    try:
        client_secret_sign = _naver_commerce_client_secret_sign(
            client_id=client_id,
            client_secret=client_secret,
            timestamp_ms=timestamp_ms,
        )
    except Exception as exc:
        return None, {"status_code": 400, "message": f"signature_error: {exc}"}
    body = {
        "client_id": client_id,
        "timestamp": str(timestamp_ms),
        "grant_type": "client_credentials",
        "type": "SELF",
        "client_secret_sign": client_secret_sign,
    }
    try:
        resp = requests.post(
            NAVER_COMMERCE_TOKEN_URL,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
    except Exception as exc:
        return None, {"message": f"token_request_failed: {type(exc).__name__}: {exc}"}
    try:
        status_code = int(resp.status_code)
    except Exception:
        status_code = 502
    if status_code != 200:
        return None, {"status_code": status_code, "message": _safe_err_text(resp)}
    try:
        payload = resp.json() or {}
    except Exception:
        payload = {}
    token = str(payload.get("access_token") or "").strip()
    if not token:
        return None, {"status_code": status_code, "message": "access_token missing"}
    return token, {"status_code": status_code}


def _naver_commerce_require_access_token(db: Session, *, force_refresh: bool = False) -> str:
    client_id = _get_api_setting(db, "NAVER_COMMERCE_CLIENT_ID")
    client_secret = _get_api_setting(db, "NAVER_COMMERCE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="NAVER_COMMERCE_CLIENT_ID/SECRET not configured")
    now = float(time.time())
    token = str(_NAVER_COMMERCE_TOKEN_CACHE.get("token") or "").strip()
    fetched_at = float(_NAVER_COMMERCE_TOKEN_CACHE.get("fetched_at") or 0.0)
    if (not force_refresh) and token and (now - fetched_at) < 15 * 60:
        return token
    token, meta = _naver_commerce_fetch_access_token(client_id=client_id, client_secret=client_secret)
    if token:
        _NAVER_COMMERCE_TOKEN_CACHE["token"] = token
        _NAVER_COMMERCE_TOKEN_CACHE["fetched_at"] = now
        return token
    detail = str((meta or {}).get("message") or "naver_commerce_token_failed").strip()
    if _looks_like_ip_not_allowed(detail):
        raise HTTPException(status_code=403, detail="GW.IP_NOT_ALLOWED: 커머스 API 허용 IP를 먼저 설정해야 합니다.")
    raise HTTPException(status_code=max(400, min(599, int((meta or {}).get("status_code") or 502))), detail=detail)


def _naver_commerce_request_json(
    *,
    method: str,
    path: str,
    access_token: str,
    params: dict[str, object] | None = None,
    body: dict[str, object] | None = None,
    expected_statuses: tuple[int, ...] = (200,),
    timeout_sec: float = 12.0,
) -> tuple[int | None, dict | None, str | None]:
    route = str(path or "").strip()
    if not route.startswith("/"):
        route = "/" + route
    url = NAVER_COMMERCE_API_BASE.rstrip("/") + route
    kwargs: dict[str, object] = {
        "headers": {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
        "timeout": float(timeout_sec),
    }
    if params:
        kwargs["params"] = params
    if body is not None:
        kwargs["headers"] = {
            **dict(kwargs["headers"]),
            "Content-Type": "application/json",
        }
        kwargs["json"] = body
    try:
        resp = requests.request(str(method or "GET").upper(), url, **kwargs)
    except Exception as exc:
        return None, None, f"request_failed: {type(exc).__name__}: {exc}"
    try:
        status_code = int(resp.status_code)
    except Exception:
        status_code = None
    if status_code not in expected_statuses:
        return status_code, None, _safe_err_text(resp)
    try:
        payload = resp.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        return status_code, payload, None
    if payload is not None:
        return status_code, {"_raw": payload}, None
    return status_code, {}, None


def _naver_commerce_get_json_with_params(
    *,
    path: str,
    access_token: str,
    params: dict[str, object],
    timeout_sec: float = 12.0,
) -> tuple[int | None, dict | None, str | None]:
    query = {key: value for key, value in (params or {}).items() if value is not None and str(value).strip() != ""}
    qs = urllib.parse.urlencode(query, doseq=True)
    route = str(path or "").strip()
    if qs:
        route = route + ("&" if "?" in route else "?") + qs
    return _naver_commerce_request_json(
        method="GET",
        path=route,
        access_token=access_token,
        expected_statuses=(200,),
        timeout_sec=float(timeout_sec),
    )


def _naver_commerce_post_json(
    *,
    path: str,
    access_token: str,
    body: dict[str, object],
    expected_statuses: tuple[int, ...] = (200,),
    timeout_sec: float = 12.0,
) -> tuple[int | None, dict | None, str | None]:
    return _naver_commerce_request_json(
        method="POST",
        path=path,
        access_token=access_token,
        body=body,
        expected_statuses=expected_statuses,
        timeout_sec=float(timeout_sec),
    )


def _naver_commerce_put_json(
    *,
    path: str,
    access_token: str,
    body: dict[str, object],
    expected_statuses: tuple[int, ...] = (200,),
    timeout_sec: float = 12.0,
) -> tuple[int | None, dict | None, str | None]:
    return _naver_commerce_request_json(
        method="PUT",
        path=path,
        access_token=access_token,
        body=body,
        expected_statuses=expected_statuses,
        timeout_sec=float(timeout_sec),
    )


def _commerce_call_json(
    db: Session,
    *,
    method: str,
    path: str,
    params: dict[str, object] | None = None,
    body: dict[str, object] | None = None,
    expected_statuses: tuple[int, ...] = (200,),
    timeout_sec: float = 12.0,
) -> tuple[int | None, dict | None, str | None]:
    token = _naver_commerce_require_access_token(db)
    method0 = str(method or "GET").upper()
    max_rate_limit_retries = 3

    def _call(access_token: str) -> tuple[int | None, dict | None, str | None]:
        if method0 == "GET":
            return _naver_commerce_get_json_with_params(
                path=path,
                access_token=access_token,
                params=dict(params or {}),
                timeout_sec=float(timeout_sec),
            )
        if method0 == "POST":
            return _naver_commerce_post_json(
                path=path,
                access_token=access_token,
                body=dict(body or {}),
                expected_statuses=expected_statuses,
                timeout_sec=float(timeout_sec),
            )
        if method0 == "PUT":
            return _naver_commerce_put_json(
                path=path,
                access_token=access_token,
                body=dict(body or {}),
                expected_statuses=expected_statuses,
                timeout_sec=float(timeout_sec),
            )
        return _naver_commerce_request_json(
            method=method0,
            path=path,
            access_token=access_token,
            params=params,
            body=body,
            expected_statuses=expected_statuses,
            timeout_sec=float(timeout_sec),
        )

    status_code, payload, error = _call(token)
    if status_code == 401 and ("GW.AUTHN" in str(error or "") or not str(error or "").strip()):
        token = _naver_commerce_require_access_token(db, force_refresh=True)
        status_code, payload, error = _call(token)
    if _is_naver_commerce_rate_limited(status_code, error):
        for retry_idx in range(max_rate_limit_retries):
            time.sleep(float(1 + retry_idx))
            status_code, payload, error = _call(token)
            if status_code == 401 and ("GW.AUTHN" in str(error or "") or not str(error or "").strip()):
                token = _naver_commerce_require_access_token(db, force_refresh=True)
                status_code, payload, error = _call(token)
            if not _is_naver_commerce_rate_limited(status_code, error):
                break
    return status_code, payload, error


def _map_customer_inquiry(item: dict) -> dict:
    external_id = str(item.get("inquiryNo") or "").strip()
    return {
        "qna_key": _qna_key("customer", external_id),
        "qna_kind": "customer",
        "external_inquiry_id": external_id,
        "title": _collapse_ws_text(item.get("title")),
        "category": _collapse_ws_text(item.get("category")),
        "inquiry_text": _collapse_ws_text(item.get("inquiryContent")),
        "inquiry_registered_at": _parse_iso_datetime(item.get("inquiryRegistrationDateTime")),
        "answer_content_id": (str(item.get("answerContentId") or "").strip() or None),
        "answer_template_no": (str(item.get("answerTemplateNo") or "").strip() or None),
        "answer_text": (_collapse_ws_text(item.get("answerContent")) or None),
        "answer_registered_at": _parse_iso_datetime(item.get("answerRegistrationDateTime")),
        "answered": bool(item.get("answered")),
        "order_id": (str(item.get("orderId") or "").strip() or None),
        "product_no": (str(item.get("productNo") or "").strip() or None),
        "product_order_id_list": (str(item.get("productOrderIdList") or "").strip() or None),
        "product_name": (_collapse_ws_text(item.get("productName")) or None),
        "product_order_option": (_collapse_ws_text(item.get("productOrderOption")) or None),
        "customer_id": (str(item.get("customerId") or "").strip() or None),
        "customer_name": (_collapse_ws_text(item.get("customerName")) or None),
        "masked_writer_id": None,
        "raw_payload_json": json.dumps(item, ensure_ascii=False, sort_keys=True),
    }


def _map_product_qna(item: dict) -> dict:
    external_id = str(item.get("questionId") or "").strip()
    return {
        "qna_key": _qna_key("product", external_id),
        "qna_kind": "product",
        "external_inquiry_id": external_id,
        "title": None,
        "category": "상품",
        "inquiry_text": _collapse_ws_text(item.get("question")),
        "inquiry_registered_at": _parse_iso_datetime(item.get("createDate")),
        "answer_content_id": None,
        "answer_template_no": None,
        "answer_text": (_collapse_ws_text(item.get("answer")) or None),
        "answer_registered_at": None,
        "answered": bool(item.get("answered")),
        "order_id": None,
        "product_no": (str(item.get("productId") or "").strip() or None),
        "product_order_id_list": None,
        "product_name": (_collapse_ws_text(item.get("productName")) or None),
        "product_order_option": None,
        "customer_id": None,
        "customer_name": None,
        "masked_writer_id": (str(item.get("maskedWriterId") or "").strip() or None),
        "raw_payload_json": json.dumps(item, ensure_ascii=False, sort_keys=True),
    }


def _upsert_qna_rows(db: Session, rows: list[dict]) -> tuple[int, int]:
    saved = 0
    updated = 0
    now = _now_kst()
    for item in rows:
        qna_key = str(item.get("qna_key") or "").strip()
        if not qna_key:
            continue
        row = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.qna_key == qna_key).one_or_none()
        if row is None:
            row = CommerceQnaRaw(
                qna_key=qna_key,
                qna_kind=str(item.get("qna_kind") or "").strip(),
                external_inquiry_id=str(item.get("external_inquiry_id") or "").strip(),
            )
            db.add(row)
            saved += 1
        else:
            updated += 1
        row.title = item.get("title")
        row.category = item.get("category")
        row.inquiry_text = str(item.get("inquiry_text") or "")
        row.inquiry_registered_at = item.get("inquiry_registered_at")
        row.answer_content_id = item.get("answer_content_id")
        row.answer_template_no = item.get("answer_template_no")
        row.answer_text = item.get("answer_text")
        row.answer_registered_at = item.get("answer_registered_at")
        row.answered = bool(item.get("answered"))
        row.order_id = item.get("order_id")
        row.product_no = item.get("product_no")
        row.product_order_id_list = item.get("product_order_id_list")
        row.product_name = item.get("product_name")
        row.product_order_option = item.get("product_order_option")
        row.customer_id = item.get("customer_id")
        row.customer_name = item.get("customer_name")
        row.masked_writer_id = item.get("masked_writer_id")
        row.raw_payload_json = item.get("raw_payload_json")
        row.updated_at = now
    db.commit()
    return saved, updated


def sync_qna_data(db: Session, payload: QnaSyncRequest) -> QnaSyncResponse:
    customer_items = [_map_customer_inquiry(item) for item in _fetch_customer_inquiries(db, payload)]
    product_items = [_map_product_qna(item) for item in _fetch_product_qnas(db, payload)]
    saved, updated = _upsert_qna_rows(db, customer_items + product_items)
    return QnaSyncResponse(
        ok=True,
        customer_fetched=len(customer_items),
        product_fetched=len(product_items),
        saved=saved,
        updated=updated,
    )


def _fetch_customer_inquiries(db: Session, req: QnaSyncRequest) -> list[dict]:
    collected: list[dict] = []
    start_date, end_date = _normalize_date_range(req.start_date, req.end_date, default_days=int(req.days or 14))
    if start_date is None or end_date is None:
        raise HTTPException(status_code=400, detail="invalid qna sync date range")
    answered_value: str | None = None if req.include_answered else "false"
    for window_start, window_end in _iter_date_windows(start_date, end_date, max_days=90):
        candidate_params_list: list[dict[str, object]] = [
            {
                "page": 1,
                "size": int(req.customer_page_size or 50),
                "startSearchDate": window_start.isoformat(),
                "endSearchDate": window_end.isoformat(),
                "answered": answered_value,
            },
            {
                "page": 1,
                "size": int(req.customer_page_size or 50),
                "startSearchedDate": window_start.isoformat(),
                "endSearchedDate": window_end.isoformat(),
                "answered": answered_value,
            },
        ]
        for page in range(1, int(req.customer_pages or 1) + 1):
            payload = None
            error = None
            status_code = None
            for base_params in candidate_params_list:
                params = dict(base_params)
                params["page"] = page
                status_code, payload, error = _commerce_call_json(
                    db,
                    method="GET",
                    path="/v1/pay-user/inquiries",
                    params=params,
                    expected_statuses=(200,),
                    timeout_sec=10.0,
                )
                if status_code == 200 and isinstance(payload, dict):
                    break
                if int(status_code or 0) == 400:
                    continue
                break
            if status_code != 200 or not isinstance(payload, dict):
                raise HTTPException(status_code=502, detail=f"customer_inquiries_fetch_failed: {error}")
            items = _unwrap_list_from_commerce_response(payload or {})
            if not items:
                break
            collected.extend(items)
            if len(items) < int(req.customer_page_size or 50):
                break
    return collected


def _fetch_product_qnas(db: Session, req: QnaSyncRequest) -> list[dict]:
    collected: list[dict] = []
    start_date, end_date = _normalize_date_range(req.start_date, req.end_date, default_days=int(req.days or 14))
    if start_date is None or end_date is None:
        raise HTTPException(status_code=400, detail="invalid qna sync date range")
    tzinfo = _now_kst().tzinfo
    answered_value: bool | str | None = None if req.include_answered else False
    for window_start, window_end in _iter_date_windows(start_date, end_date, max_days=90):
        start_dt = datetime(window_start.year, window_start.month, window_start.day, 0, 0, 0, tzinfo=tzinfo)
        end_dt = datetime(window_end.year, window_end.month, window_end.day, 23, 59, 59, tzinfo=tzinfo)
        candidate_params_list: list[dict[str, object]] = [
            {
                "page": 1,
                "size": int(req.product_page_size or 50),
                "fromDate": start_dt.isoformat(timespec="seconds"),
                "toDate": end_dt.isoformat(timespec="seconds"),
                "answered": answered_value,
            },
            {
                "page": 1,
                "size": int(req.product_page_size or 50),
                "startDate": start_dt.isoformat(timespec="seconds"),
                "endDate": end_dt.isoformat(timespec="seconds"),
                "answered": answered_value,
            },
        ]
        for page in range(1, int(req.product_pages or 1) + 1):
            payload = None
            error = None
            status_code = None
            for base_params in candidate_params_list:
                params = dict(base_params)
                params["page"] = page
                status_code, payload, error = _commerce_call_json(
                    db,
                    method="GET",
                    path="/v1/contents/qnas",
                    params=params,
                    expected_statuses=(200,),
                    timeout_sec=10.0,
                )
                if status_code == 200 and isinstance(payload, dict):
                    break
                if int(status_code or 0) == 400:
                    continue
                break
            if status_code != 200 or not isinstance(payload, dict):
                raise HTTPException(status_code=502, detail=f"product_qnas_fetch_failed: {error}")
            items = _unwrap_list_from_commerce_response(payload or {})
            if not items:
                break
            collected.extend(items)
            if len(items) < int(req.product_page_size or 50):
                break
    return collected


def _status_priority_expr():
    return case(
        (CommerceQnaDraft.status == "submitted", 0),
        (CommerceQnaDraft.status == "approved", 1),
        (CommerceQnaDraft.status == "generated", 2),
        (CommerceQnaDraft.status == "rejected", 3),
        (CommerceQnaDraft.status == "failed", 4),
        (CommerceQnaDraft.status == "superseded", 5),
        else_=9,
    )


def _get_latest_qna_draft(db: Session, *, qna_key: str) -> CommerceQnaDraft | None:
    qna_key0 = str(qna_key or "").strip()
    if not qna_key0:
        return None
    return (
        db.query(CommerceQnaDraft)
        .filter(CommerceQnaDraft.qna_key == qna_key0)
        .order_by(
            _status_priority_expr().asc(),
            CommerceQnaDraft.generated_at.desc(),
            CommerceQnaDraft.updated_at.desc(),
            CommerceQnaDraft.draft_id.desc(),
        )
        .limit(1)
        .one_or_none()
    )


def _get_latest_qna_draft_map(db: Session, qna_keys: list[str]) -> dict[str, CommerceQnaDraft]:
    out: dict[str, CommerceQnaDraft] = {}
    if not qna_keys:
        return out
    rows = (
        db.query(CommerceQnaDraft)
        .filter(CommerceQnaDraft.qna_key.in_(qna_keys))
        .order_by(
            _status_priority_expr().asc(),
            CommerceQnaDraft.generated_at.desc(),
            CommerceQnaDraft.updated_at.desc(),
            CommerceQnaDraft.draft_id.desc(),
        )
        .all()
    )
    for row in rows:
        key = str(getattr(row, "qna_key", "") or "").strip()
        if key and key not in out:
            out[key] = row
    return out


def _get_qna_draft_validation_map(db: Session, draft_ids: list[str]) -> dict[str, CommerceQnaDraftValidation]:
    out: dict[str, CommerceQnaDraftValidation] = {}
    draft_ids0 = [str(item or "").strip() for item in draft_ids if str(item or "").strip()]
    if not draft_ids0:
        return out
    rows = db.query(CommerceQnaDraftValidation).filter(CommerceQnaDraftValidation.draft_id.in_(draft_ids0)).all()
    for row in rows:
        draft_id = str(getattr(row, "draft_id", "") or "").strip()
        if draft_id:
            out[draft_id] = row
    return out


def _get_latest_submit_log_map(db: Session, qna_keys: list[str]) -> dict[str, CommerceQnaSubmitLog]:
    out: dict[str, CommerceQnaSubmitLog] = {}
    if not qna_keys:
        return out
    rows = (
        db.query(CommerceQnaSubmitLog)
        .filter(CommerceQnaSubmitLog.qna_key.in_(qna_keys))
        .order_by(
            CommerceQnaSubmitLog.submitted_at.desc(),
            CommerceQnaSubmitLog.submit_id.desc(),
        )
        .all()
    )
    for row in rows:
        key = str(getattr(row, "qna_key", "") or "").strip()
        if key and key not in out:
            out[key] = row
    return out


def _parse_rejection_analysis(raw: object) -> dict:
    if isinstance(raw, dict):
        return dict(raw)
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except Exception:
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


def _parse_json_string_list(raw: object) -> list[str]:
    if isinstance(raw, list):
        return [str(item or "").strip() for item in raw if str(item or "").strip()]
    text = str(raw or "").strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item or "").strip() for item in parsed if str(item or "").strip()]


def _build_qna_validation_result(
    *,
    initial_issues: list[str] | None = None,
    final_issues: list[str] | None = None,
    rewrite_attempted: bool = False,
    rewrite_succeeded: bool = False,
) -> QnaDraftValidationResult:
    initial_issues0 = [str(item or "").strip() for item in (initial_issues or []) if str(item or "").strip()]
    final_issues0 = [str(item or "").strip() for item in (final_issues or []) if str(item or "").strip()]
    if final_issues0:
        status = "failed"
    elif rewrite_attempted and rewrite_succeeded:
        status = "rewritten_passed"
    elif initial_issues0:
        status = "passed_with_warnings"
    else:
        status = "passed"
    return QnaDraftValidationResult(
        status=status,
        initial_issues=initial_issues0,
        final_issues=final_issues0,
        rewrite_attempted=bool(rewrite_attempted),
        rewrite_succeeded=bool(rewrite_succeeded),
    )


def _save_qna_draft_validation_result(
    db: Session,
    *,
    draft_id: str,
    qna_key: str,
    validation_result: QnaDraftValidationResult,
) -> CommerceQnaDraftValidation:
    draft_id0 = str(draft_id or "").strip()
    row = db.query(CommerceQnaDraftValidation).filter(CommerceQnaDraftValidation.draft_id == draft_id0).one_or_none()
    if row is None:
        row = CommerceQnaDraftValidation(draft_id=draft_id0)
        db.add(row)
    row.qna_key = str(qna_key or "").strip()
    row.check_status = str(validation_result.status or "").strip() or "not_checked"
    row.initial_issues_json = (
        json.dumps(list(validation_result.initial_issues or []), ensure_ascii=False, sort_keys=False)
        if list(validation_result.initial_issues or [])
        else None
    )
    row.final_issues_json = (
        json.dumps(list(validation_result.final_issues or []), ensure_ascii=False, sort_keys=False)
        if list(validation_result.final_issues or [])
        else None
    )
    row.rewrite_attempted = bool(validation_result.rewrite_attempted)
    row.rewrite_succeeded = bool(validation_result.rewrite_succeeded)
    row.updated_at = _now_kst()
    db.commit()
    db.refresh(row)
    return row


def _to_qna_validation_result(row: CommerceQnaDraftValidation | None) -> QnaDraftValidationResult:
    if row is None:
        return QnaDraftValidationResult()
    return QnaDraftValidationResult(
        status=(str(getattr(row, "check_status", "") or "").strip() or "not_checked"),
        initial_issues=_parse_json_string_list(getattr(row, "initial_issues_json", None)),
        final_issues=_parse_json_string_list(getattr(row, "final_issues_json", None)),
        rewrite_attempted=bool(getattr(row, "rewrite_attempted", False)),
        rewrite_succeeded=bool(getattr(row, "rewrite_succeeded", False)),
    )


def _mark_qna_draft_validation_needs_recheck(
    db: Session,
    *,
    draft_id: str,
    qna_key: str,
) -> CommerceQnaDraftValidation:
    return _save_qna_draft_validation_result(
        db,
        draft_id=draft_id,
        qna_key=qna_key,
        validation_result=QnaDraftValidationResult(
            status="needs_recheck",
            initial_issues=[],
            final_issues=[],
            rewrite_attempted=False,
            rewrite_succeeded=False,
        ),
    )


def _validate_existing_qna_draft(db: Session, *, draft_row: CommerceQnaDraft, qna_row: CommerceQnaRaw) -> QnaDraftValidateResponse:
    draft_text0 = _collapse_ws_text(getattr(draft_row, "draft_text", None), 4000)
    if not draft_text0:
        raise HTTPException(status_code=400, detail="draft_text empty")
    issues = _validate_qna_generated_text(qna_row, draft_text0)
    validation_row = _save_qna_draft_validation_result(
        db,
        draft_id=str(getattr(draft_row, "draft_id", "") or ""),
        qna_key=str(getattr(qna_row, "qna_key", "") or ""),
        validation_result=QnaDraftValidationResult(
            status="passed" if not issues else "failed",
            initial_issues=[],
            final_issues=issues,
            rewrite_attempted=False,
            rewrite_succeeded=False,
        ),
    )
    return QnaDraftValidateResponse(
        ok=True,
        draft_id=str(getattr(draft_row, "draft_id", "") or ""),
        qna_key=str(getattr(qna_row, "qna_key", "") or ""),
        status=str(getattr(draft_row, "status", "") or ""),
        validation_result=_to_qna_validation_result(validation_row),
    )


def _is_qna_validation_approval_ready(validation_row: CommerceQnaDraftValidation | None) -> bool:
    status = str(getattr(validation_row, "check_status", "") or "").strip()
    return status in ("passed", "rewritten_passed", "passed_with_warnings")


def _fallback_rejection_analysis(comment: str) -> dict:
    comment0 = _collapse_ws_text(comment, 600)
    return {
        "problem_summary": comment0 or None,
        "bad_pattern": comment0 or None,
        "prevention_rule": comment0 or None,
        "example_fix": None,
    }


def _save_qna_feedback_knowledge(
    db: Session,
    *,
    qna_row: CommerceQnaRaw,
    draft_row: CommerceQnaDraft,
    analysis: dict,
) -> None:
    analysis0 = _parse_rejection_analysis(analysis)
    if not any(analysis0.values()):
        return
    db.add(
        CommerceQnaFeedbackKnowledge(
            knowledge_id=str(uuid.uuid4()),
            source_draft_id=str(getattr(draft_row, "draft_id", "") or ""),
            qna_kind=str(getattr(qna_row, "qna_kind", "") or ""),
            category=str(getattr(qna_row, "category", "") or "").strip() or None,
            problem_summary=_collapse_ws_text(analysis0.get("problem_summary")) or None,
            bad_pattern=_collapse_ws_text(analysis0.get("bad_pattern")) or None,
            prevention_rule=_collapse_ws_text(analysis0.get("prevention_rule")) or None,
            example_fix=_collapse_ws_text(analysis0.get("example_fix")) or None,
        )
    )


def _build_qna_feedback_rules(db: Session, *, qna_row: CommerceQnaRaw, limit: int = 6) -> list[str]:
    query = (
        db.query(CommerceQnaFeedbackKnowledge)
        .filter(
            CommerceQnaFeedbackKnowledge.status == "active",
            CommerceQnaFeedbackKnowledge.qna_kind == str(getattr(qna_row, "qna_kind", "") or ""),
        )
        .order_by(
            CommerceQnaFeedbackKnowledge.updated_at.desc(),
            CommerceQnaFeedbackKnowledge.created_at.desc(),
        )
    )
    category0 = str(getattr(qna_row, "category", "") or "").strip()
    if category0:
        query = query.filter(
            or_(
                CommerceQnaFeedbackKnowledge.category == category0,
                CommerceQnaFeedbackKnowledge.category.is_(None),
            )
        )
    rows = query.limit(max(1, min(int(limit or 6), 20))).all()
    out: list[str] = []
    seen: set[str] = set()
    for row in rows:
        line = f"- 문제: {_collapse_ws_text(getattr(row, 'problem_summary', None), 180) or '운영 반려'} / 재발 방지: {_collapse_ws_text(getattr(row, 'prevention_rule', None), 180) or _collapse_ws_text(getattr(row, 'bad_pattern', None), 180) or '문의 맥락에 맞는 사실만 답변'}"
        normalized = _collapse_ws_text(line, 300)
        if normalized and normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


def _normalize_qna_match_text(value: object) -> str:
    return _collapse_ws_text(value, 300).lower()


def _tokenize_qna_match_text(value: object) -> set[str]:
    text = _normalize_qna_match_text(value)
    return {token for token in re.split(r"[^0-9a-zA-Z가-힣]+", text) if len(token) >= 2}


def _qna_product_similarity_score(target_product: object, candidate_product: object) -> int:
    target0 = _normalize_qna_match_text(target_product)
    candidate0 = _normalize_qna_match_text(candidate_product)
    if not target0 or not candidate0:
        return 0
    if target0 == candidate0:
        return 80
    if target0 in candidate0 or candidate0 in target0:
        return 55
    overlap = _tokenize_qna_match_text(target0) & _tokenize_qna_match_text(candidate0)
    return min(40, len(overlap) * 12)


def _infer_qna_topic(qna_row: CommerceQnaRaw) -> str:
    text = " ".join(
        [
            _normalize_qna_match_text(getattr(qna_row, "category", None)),
            _normalize_qna_match_text(getattr(qna_row, "title", None)),
            _normalize_qna_match_text(getattr(qna_row, "inquiry_text", None)),
        ]
    )
    topic_keywords = [
        ("환불", ("환불", "취소", "반품")),
        ("교환", ("교환", "불량", "오배송")),
        ("배송", ("배송", "출고", "도착", "송장")),
        ("성분", ("성분", "알레르기", "민감", "두피", "피부", "임산부")),
        ("사용법", ("사용", "사용법", "횟수", "방법")),
        ("재입고", ("재입고", "품절", "언제 들어오")),
        ("상품", ("향", "색상", "사이즈", "호환", "효과")),
    ]
    for topic, keywords in topic_keywords:
        if any(keyword in text for keyword in keywords):
            return topic
    return "일반"


def _build_qna_category_guidance(qna_row: CommerceQnaRaw) -> list[str]:
    topic = _infer_qna_topic(qna_row)
    guidance_map = {
        "배송": [
            "배송 문의는 출고/도착 시점을 단정하지 말고 주문 정보를 확인한 뒤 안내하는 표현을 우선한다.",
            "지연 불만은 먼저 공감하고 확인 후 안내 문장을 포함한다.",
        ],
        "교환": [
            "교환 문의는 가능 여부를 단정하지 말고 주문/상품 상태 확인 후 절차를 안내한다.",
            "불량/오배송은 불편에 대한 사과와 확인 의지를 먼저 둔다.",
        ],
        "환불": [
            "환불 문의는 즉시 승인처럼 단정하지 말고 주문 상태 및 기준 확인 후 안내한다.",
            "수거/회수/검수 절차가 있을 수 있음을 자연스럽게 설명한다.",
        ],
        "성분": [
            "성분/피부 문의는 개인차 가능성을 함께 안내하고, 의료적 효능이나 안전을 단정하지 않는다.",
            "민감성/임산부 관련 문의는 사용 전 성분 확인 또는 전문가 상담 권장 표현을 우선한다.",
        ],
        "사용법": [
            "사용법 문의는 제품 정보 범위 내에서만 안내하고, 문의에 없는 효능을 추가하지 않는다.",
        ],
        "재입고": [
            "재입고 문의는 정확한 시점을 단정하지 말고 확인 후 안내 또는 재입고 알림 활용을 권한다.",
        ],
        "상품": [
            "상품 문의는 향/색상/사용감처럼 개인차가 큰 표현을 단정하지 않는다.",
        ],
        "일반": [
            "확인이 필요한 사안은 확인 후 안내 형태로 답변하고, 문의에 없는 사실은 추가하지 않는다.",
        ],
    }
    return guidance_map.get(topic, guidance_map["일반"])


def _validate_qna_generated_text(qna_row: CommerceQnaRaw, draft_text: str) -> list[str]:
    text0 = _collapse_ws_text(draft_text, 2000)
    lowered = text0.lower()
    issues: list[str] = []
    banned_patterns = [
        ("100%", "근거 없는 100% 확정 표현을 쓰지 마세요."),
        ("무조건", "근거 없는 단정 표현(무조건)을 쓰지 마세요."),
        ("절대", "절대/전혀 같은 과도한 단정 표현을 쓰지 마세요."),
        ("확실히", "확실히 같은 과도한 확정 표현을 쓰지 마세요."),
        ("전혀 문제", "안전/문제없음을 단정하지 마세요."),
    ]
    for needle, message in banned_patterns:
        if needle.lower() in lowered:
            issues.append(message)
    topic = _infer_qna_topic(qna_row)
    if topic in ("배송", "교환", "환불"):
        if not any(keyword in text0 for keyword in ("확인", "안내", "도와드", "살펴")):
            issues.append(f"{topic} 문의는 확인 후 안내 또는 절차 안내 문구를 포함하세요.")
    if topic == "성분":
        if "개인차" not in text0 and any(keyword in lowered for keyword in ("사용 가능", "문제 없", "안전합")):
            issues.append("성분/민감성 문의는 개인차 가능성 또는 사전 확인 안내를 포함하세요.")
    deduped: list[str] = []
    seen: set[str] = set()
    for issue in issues:
        if issue not in seen:
            seen.add(issue)
            deduped.append(issue)
    return deduped


def _build_qna_validation_rewrite_messages(
    *,
    qna_row: CommerceQnaRaw,
    draft_text: str,
    issues: list[str],
    category_guidance: list[str],
) -> list[dict]:
    guidance_block = "\n".join(f"- {line}" for line in category_guidance) if category_guidance else "- 추가 가이드 없음"
    issue_block = "\n".join(f"- {line}" for line in issues) if issues else "- 수정 이슈 없음"
    return [
        {
            "role": "system",
            "content": (
                "너는 판매자 문의 답변 초안을 교정하는 검수 도우미다. "
                "항상 한국어로, 사실에 기반해 공손하고 간결하게 다시 작성한다. "
                "문의에 없는 사실을 추가하지 말고, 검수 이슈를 모두 반영한 답변 본문만 출력한다."
            ),
        },
        {
            "role": "user",
            "content": (
                f"[문의 본문]\n{_collapse_ws_text(getattr(qna_row, 'inquiry_text', None), 1200)}\n\n"
                f"[초안]\n{_collapse_ws_text(draft_text, 2000)}\n\n"
                f"[카테고리 가이드]\n{guidance_block}\n\n"
                f"[검수 이슈]\n{issue_block}\n\n"
                "초안을 아래 규칙에 맞게 다시 써줘."
            ),
        },
    ]


def _build_qna_example_corpus(db: Session, *, qna_row: CommerceQnaRaw, limit: int = 6) -> list[str]:
    candidates: list[tuple[int, datetime, str]] = []
    seen: set[str] = set()
    kind0 = str(getattr(qna_row, "qna_kind", "") or "")
    category0 = str(getattr(qna_row, "category", "") or "").strip()
    target_product_name0 = getattr(qna_row, "product_name", None)
    raw_query = (
        db.query(CommerceQnaRaw)
        .filter(
            CommerceQnaRaw.qna_kind == kind0,
            CommerceQnaRaw.answered.is_(True),
            CommerceQnaRaw.answer_text.isnot(None),
            CommerceQnaRaw.qna_key != str(getattr(qna_row, "qna_key", "") or ""),
        )
        .order_by(CommerceQnaRaw.answer_registered_at.desc(), CommerceQnaRaw.updated_at.desc())
    )
    for row in raw_query.limit(limit * 4).all():
        inquiry = _collapse_ws_text(getattr(row, "inquiry_text", None), 200)
        answer = _collapse_ws_text(getattr(row, "answer_text", None), 220)
        if not inquiry or not answer:
            continue
        line = f"- 문의: {inquiry}\n  답변: {answer}"
        if line in seen:
            continue
        seen.add(line)
        score = 10
        if category0 and str(getattr(row, "category", "") or "").strip() == category0:
            score += 100
        score += _qna_product_similarity_score(target_product_name0, getattr(row, "product_name", None))
        score += 8
        sort_dt = getattr(row, "answer_registered_at", None) or getattr(row, "updated_at", None) or _now_kst()
        candidates.append((score, sort_dt, line))
    draft_query = (
        db.query(CommerceQnaRaw, CommerceQnaDraft)
        .join(CommerceQnaDraft, CommerceQnaDraft.qna_key == CommerceQnaRaw.qna_key)
        .filter(
            CommerceQnaRaw.qna_kind == kind0,
            CommerceQnaDraft.status.in_(("approved", "submitted")),
            CommerceQnaRaw.qna_key != str(getattr(qna_row, "qna_key", "") or ""),
        )
        .order_by(CommerceQnaDraft.updated_at.desc(), CommerceQnaDraft.generated_at.desc())
    )
    for raw_row, draft_row in draft_query.limit(limit * 2).all():
        inquiry = _collapse_ws_text(getattr(raw_row, "inquiry_text", None), 200)
        answer = _collapse_ws_text(getattr(draft_row, "draft_text", None), 220)
        if not inquiry or not answer:
            continue
        line = f"- 문의: {inquiry}\n  답변: {answer}"
        if line in seen:
            continue
        seen.add(line)
        score = 20
        if category0 and str(getattr(raw_row, "category", "") or "").strip() == category0:
            score += 100
        score += _qna_product_similarity_score(target_product_name0, getattr(raw_row, "product_name", None))
        sort_dt = getattr(draft_row, "updated_at", None) or getattr(draft_row, "generated_at", None) or _now_kst()
        candidates.append((score, sort_dt, line))
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [line for _, _, line in candidates[:limit]]


def _build_qna_messages(
    *,
    qna_row: CommerceQnaRaw,
    feedback_rules: list[str],
    examples: list[str],
    category_guidance: list[str],
) -> list[dict]:
    kind_label = _kind_label(getattr(qna_row, "qna_kind", ""))
    title0 = _collapse_ws_text(getattr(qna_row, "title", None), 120) or "-"
    category0 = _collapse_ws_text(getattr(qna_row, "category", None), 60) or "-"
    inquiry0 = _collapse_ws_text(getattr(qna_row, "inquiry_text", None), 1200)
    product_name0 = _collapse_ws_text(getattr(qna_row, "product_name", None), 120) or "-"
    option0 = _collapse_ws_text(getattr(qna_row, "product_order_option", None), 120) or "-"
    customer_name0 = _collapse_ws_text(getattr(qna_row, "customer_name", None), 60) or "-"
    feedback_block = "\n".join(feedback_rules) if feedback_rules else "- 반려 재발방지 규칙 없음"
    example_block = "\n".join(examples) if examples else "- 참고할 과거 답변 예시 없음"
    category_guidance_block = "\n".join(f"- {line}" for line in category_guidance) if category_guidance else "- 카테고리 가이드 없음"
    return [
        {
            "role": "system",
            "content": (
                "너는 네이버 커머스 판매자 문의 답변 초안을 작성하는 도우미다. "
                "반드시 한국어로, 사실에 기반해 간결하고 공손하게 작성한다. "
                "문의에 없는 사실을 만들지 말고, 배송/교환/환불처럼 운영 확인이 필요한 사안은 확인 후 안내 형태로 답한다. "
                "답변은 2~5문장으로 작성하고, 불필요한 과장/감정적 표현/확정 약속을 피한다."
            ),
        },
        {
            "role": "user",
            "content": (
                f"[문의 종류]\n{kind_label}\n\n"
                f"[문의 메타]\n- 제목: {title0}\n- 분류: {category0}\n- 상품명: {product_name0}\n- 옵션: {option0}\n- 고객명: {customer_name0}\n\n"
                f"[문의 본문]\n{inquiry0}\n\n"
                f"[카테고리별 답변 가이드]\n{category_guidance_block}\n\n"
                f"[운영 반려 재발방지 규칙]\n{feedback_block}\n\n"
                f"[과거 승인/등록 답변 예시]\n{example_block}\n\n"
                "위 정보를 바탕으로 판매자 답변 초안만 작성해줘."
            ),
        },
    ]


def _save_qna_draft_row(
    db: Session,
    *,
    qna_key: str,
    status: str,
    draft_text: str,
    model_name: str | None,
    prompt_version: str | None,
    error_message: str | None = None,
    rejection_comment: str | None = None,
    rejection_analysis: dict | None = None,
) -> CommerceQnaDraft:
    row = CommerceQnaDraft(
        draft_id=str(uuid.uuid4()),
        qna_key=str(qna_key or "").strip(),
        status=str(status or "").strip() or "generated",
        draft_text=str(draft_text or ""),
        model_name=(str(model_name or "").strip() or None),
        prompt_version=(str(prompt_version or "").strip() or None),
        error_message=(str(error_message or "").strip() or None),
        rejection_comment=(str(rejection_comment or "").strip() or None),
        rejection_analysis_json=(json.dumps(rejection_analysis, ensure_ascii=False, sort_keys=True) if rejection_analysis else None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _to_qna_draft_response(
    draft_row: CommerceQnaDraft,
    *,
    qna_row: CommerceQnaRaw,
    generated_now: bool,
    validation_row: CommerceQnaDraftValidation | None = None,
) -> QnaDraftResponse:
    return QnaDraftResponse(
        ok=True,
        qna_key=str(getattr(qna_row, "qna_key", "") or ""),
        draft_id=str(getattr(draft_row, "draft_id", "") or ""),
        status=str(getattr(draft_row, "status", "") or ""),
        draft_text=str(getattr(draft_row, "draft_text", "") or ""),
        model_name=(str(getattr(draft_row, "model_name", "") or "").strip() or None),
        prompt_version=(str(getattr(draft_row, "prompt_version", "") or "").strip() or None),
        generated_now=bool(generated_now),
        inquiry_text=str(getattr(qna_row, "inquiry_text", "") or ""),
        answer_text=(str(getattr(qna_row, "answer_text", "") or "").strip() or None),
        qna_kind=str(getattr(qna_row, "qna_kind", "") or ""),
        qna_kind_label=_kind_label(getattr(qna_row, "qna_kind", "")),
        title=(str(getattr(qna_row, "title", "") or "").strip() or None),
        category=(str(getattr(qna_row, "category", "") or "").strip() or None),
        error_message=(str(getattr(draft_row, "error_message", "") or "").strip() or None),
        generated_at=getattr(draft_row, "generated_at", None),
        rejection_comment=(str(getattr(draft_row, "rejection_comment", "") or "").strip() or None),
        rejection_analysis=_parse_rejection_analysis(getattr(draft_row, "rejection_analysis_json", None)),
        validation_result=_to_qna_validation_result(validation_row),
    )


def _generate_qna_draft_for_row(
    db: Session,
    *,
    qna_row: CommerceQnaRaw,
    model: str | None = None,
    force_regenerate: bool = False,
) -> QnaDraftResponse:
    if bool(getattr(qna_row, "answered", False)) and not force_regenerate:
        raise HTTPException(status_code=409, detail="이미 답변된 문의입니다.")
    latest = _get_latest_qna_draft(db, qna_key=str(getattr(qna_row, "qna_key", "") or ""))
    if latest is not None and not force_regenerate and str(getattr(latest, "status", "") or "") in ("generated", "approved", "submitted"):
        validation_map = _get_qna_draft_validation_map(db, [str(getattr(latest, "draft_id", "") or "")])
        return _to_qna_draft_response(
            latest,
            qna_row=qna_row,
            generated_now=False,
            validation_row=validation_map.get(str(getattr(latest, "draft_id", "") or "").strip()),
        )
    if latest is not None and force_regenerate and str(getattr(latest, "status", "") or "") in ("generated", "approved"):
        latest.status = "superseded"
        latest.updated_at = _now_kst()
        db.commit()

    api_key = _get_api_setting(db, "OPENAI_API_KEY")
    model_name = str(model or "").strip() or OPENAI_DEFAULT_MODEL
    if not api_key:
        failed = _save_qna_draft_row(
            db,
            qna_key=str(getattr(qna_row, "qna_key", "") or ""),
            status="failed",
            draft_text="",
            model_name=model_name,
            prompt_version=QNA_PROMPT_VERSION,
            error_message="OPENAI_API_KEY not configured",
        )
        return _to_qna_draft_response(failed, qna_row=qna_row, generated_now=True)

    feedback_rules = _build_qna_feedback_rules(db, qna_row=qna_row)
    examples = _build_qna_example_corpus(db, qna_row=qna_row)
    category_guidance = _build_qna_category_guidance(qna_row)
    payload = _build_openai_chat_payload(
        model_name=model_name,
        messages=_build_qna_messages(qna_row=qna_row, feedback_rules=feedback_rules, examples=examples, category_guidance=category_guidance),
        temperature=0.2,
        max_output_tokens=280,
    )
    try:
        resp = _post_openai_chat_completion_compatible(api_key=api_key, payload=payload, timeout=30)
    except Exception as exc:
        failed = _save_qna_draft_row(
            db,
            qna_key=str(getattr(qna_row, "qna_key", "") or ""),
            status="failed",
            draft_text="",
            model_name=model_name,
            prompt_version=QNA_PROMPT_VERSION,
            error_message=f"openai_request_failed: {type(exc).__name__}: {exc}",
        )
        return _to_qna_draft_response(failed, qna_row=qna_row, generated_now=True)
    if int(getattr(resp, "status_code", 0) or 0) != 200:
        failed = _save_qna_draft_row(
            db,
            qna_key=str(getattr(qna_row, "qna_key", "") or ""),
            status="failed",
            draft_text="",
            model_name=model_name,
            prompt_version=QNA_PROMPT_VERSION,
            error_message=_safe_err_text(resp),
        )
        return _to_qna_draft_response(failed, qna_row=qna_row, generated_now=True)
    try:
        data = resp.json() or {}
    except Exception:
        data = {}
    choices = data.get("choices") or []
    message = (choices[0] or {}).get("message") if isinstance(choices, list) and choices else {}
    content = _collapse_ws_text((message or {}).get("content"), 2000)
    if not content:
        failed = _save_qna_draft_row(
            db,
            qna_key=str(getattr(qna_row, "qna_key", "") or ""),
            status="failed",
            draft_text="",
            model_name=(str(data.get("model") or model_name).strip() or model_name),
            prompt_version=QNA_PROMPT_VERSION,
            error_message="openai_empty_content",
        )
        return _to_qna_draft_response(failed, qna_row=qna_row, generated_now=True)
    initial_validation_issues = _validate_qna_generated_text(qna_row, content)
    validation_issues = list(initial_validation_issues)
    rewrite_attempted = False
    rewrite_succeeded = False
    if validation_issues:
        rewrite_attempted = True
        rewrite_payload = _build_openai_chat_payload(
            model_name=model_name,
            messages=_build_qna_validation_rewrite_messages(
                qna_row=qna_row,
                draft_text=content,
                issues=validation_issues,
                category_guidance=category_guidance,
            ),
            temperature=0.1,
            max_output_tokens=280,
        )
        try:
            rewrite_resp = _post_openai_chat_completion_compatible(api_key=api_key, payload=rewrite_payload, timeout=30)
            if int(getattr(rewrite_resp, "status_code", 0) or 0) == 200:
                rewrite_data = rewrite_resp.json() or {}
                rewrite_choices = rewrite_data.get("choices") or []
                rewrite_message = (rewrite_choices[0] or {}).get("message") if isinstance(rewrite_choices, list) and rewrite_choices else {}
                rewritten = _collapse_ws_text((rewrite_message or {}).get("content"), 2000)
                if rewritten:
                    content = rewritten
                    model_name = str(rewrite_data.get("model") or model_name).strip() or model_name
                    validation_issues = _validate_qna_generated_text(qna_row, content)
                    rewrite_succeeded = not validation_issues
        except Exception:
            pass
    if validation_issues:
        failed = _save_qna_draft_row(
            db,
            qna_key=str(getattr(qna_row, "qna_key", "") or ""),
            status="failed",
            draft_text="",
            model_name=model_name,
            prompt_version=QNA_PROMPT_VERSION,
            error_message="validation_failed: " + "; ".join(validation_issues[:3]),
        )
        validation_row = _save_qna_draft_validation_result(
            db,
            draft_id=str(getattr(failed, "draft_id", "") or ""),
            qna_key=str(getattr(qna_row, "qna_key", "") or ""),
            validation_result=_build_qna_validation_result(
                initial_issues=initial_validation_issues,
                final_issues=validation_issues,
                rewrite_attempted=rewrite_attempted,
                rewrite_succeeded=False,
            ),
        )
        return _to_qna_draft_response(failed, qna_row=qna_row, generated_now=True, validation_row=validation_row)
    generated = _save_qna_draft_row(
        db,
        qna_key=str(getattr(qna_row, "qna_key", "") or ""),
        status="generated",
        draft_text=content,
        model_name=(str(data.get("model") or model_name).strip() or model_name),
        prompt_version=QNA_PROMPT_VERSION,
    )
    validation_row = _save_qna_draft_validation_result(
        db,
        draft_id=str(getattr(generated, "draft_id", "") or ""),
        qna_key=str(getattr(qna_row, "qna_key", "") or ""),
        validation_result=_build_qna_validation_result(
            initial_issues=initial_validation_issues,
            final_issues=[],
            rewrite_attempted=rewrite_attempted,
            rewrite_succeeded=rewrite_succeeded,
        ),
    )
    return _to_qna_draft_response(generated, qna_row=qna_row, generated_now=True, validation_row=validation_row)


def _apply_qna_draft_status_change(
    db: Session,
    *,
    draft_id: str,
    status: str,
    rejection_comment: str | None = None,
) -> QnaDraftStatusUpdateResponse:
    row = db.query(CommerceQnaDraft).filter(CommerceQnaDraft.draft_id == str(draft_id or "").strip()).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="draft not found")
    validation_row = (
        db.query(CommerceQnaDraftValidation)
        .filter(CommerceQnaDraftValidation.draft_id == str(getattr(row, "draft_id", "") or "").strip())
        .one_or_none()
    )
    qna_row = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.qna_key == str(getattr(row, "qna_key", "") or "")).one_or_none()
    if qna_row is None:
        raise HTTPException(status_code=404, detail="qna not found")
    next_status = str(status or "").strip()
    current_status = str(getattr(row, "status", "") or "")
    allowed = {
        "generated": {"approved", "rejected", "failed", "superseded"},
        "approved": {"generated", "superseded"},
        "rejected": {"generated", "superseded"},
        "failed": {"generated", "superseded"},
        "submitted": set(),
        "superseded": {"generated"},
    }
    if next_status != current_status and next_status not in allowed.get(current_status, set()):
        raise HTTPException(status_code=409, detail=f"status transition not allowed: {current_status} -> {next_status}")
    analysis: dict = {}
    if next_status == "rejected":
        comment0 = _collapse_ws_text(rejection_comment, 600)
        if not comment0:
            raise HTTPException(status_code=400, detail="rejection_comment required")
        analysis = _fallback_rejection_analysis(comment0)
        row.rejection_comment = comment0
        row.rejection_analysis_json = json.dumps(analysis, ensure_ascii=False, sort_keys=True)
        _save_qna_feedback_knowledge(db, qna_row=qna_row, draft_row=row, analysis=analysis)
    elif next_status == "approved":
        if not _is_qna_validation_approval_ready(validation_row):
            validation_status = str(getattr(validation_row, "check_status", "") or "").strip() or "not_checked"
            raise HTTPException(status_code=409, detail=f"draft_validation_blocked: {validation_status}")
        row.rejection_comment = None
        row.rejection_analysis_json = None
    row.status = next_status
    row.updated_at = _now_kst()
    db.commit()
    return QnaDraftStatusUpdateResponse(
        ok=True,
        draft_id=str(getattr(row, "draft_id", "") or ""),
        qna_key=str(getattr(row, "qna_key", "") or ""),
        status=str(getattr(row, "status", "") or ""),
        rejection_comment=(str(getattr(row, "rejection_comment", "") or "").strip() or None),
        rejection_analysis=_parse_rejection_analysis(getattr(row, "rejection_analysis_json", None)),
    )


def _derive_response_state(
    qna_row: CommerceQnaRaw,
    draft_row: CommerceQnaDraft | None,
    submit_row: CommerceQnaSubmitLog | None,
) -> str:
    if submit_row is not None and bool(getattr(submit_row, "success", False)):
        return "submitted"
    if submit_row is not None and bool(getattr(submit_row, "success", None)) is False:
        return "failed"
    if draft_row is not None:
        draft_status = str(getattr(draft_row, "status", "") or "")
        if draft_status in ("generated", "approved", "submitted", "failed", "rejected"):
            return draft_status
    if bool(getattr(qna_row, "answered", False)):
        return "answered"
    return "unanswered"


def _to_qna_workbench_item(
    qna_row: CommerceQnaRaw,
    draft_row: CommerceQnaDraft | None,
    submit_row: CommerceQnaSubmitLog | None,
    validation_row: CommerceQnaDraftValidation | None,
    issue_tags: list[str] | None = None,
) -> QnaWorkbenchItem:
    draft_status = str(getattr(draft_row, "status", "") or "").strip() or None
    answered = bool(getattr(qna_row, "answered", False))
    can_generate = not answered
    can_approve = draft_status == "generated" and _is_qna_validation_approval_ready(validation_row)
    can_reject = draft_status in ("generated", "approved")
    can_submit = draft_status == "approved"
    return QnaWorkbenchItem(
        qna_key=str(getattr(qna_row, "qna_key", "") or ""),
        qna_kind=str(getattr(qna_row, "qna_kind", "") or ""),
        qna_kind_label=_kind_label(getattr(qna_row, "qna_kind", "")),
        external_inquiry_id=str(getattr(qna_row, "external_inquiry_id", "") or ""),
        title=(str(getattr(qna_row, "title", "") or "").strip() or None),
        category=(str(getattr(qna_row, "category", "") or "").strip() or None),
        inquiry_text=str(getattr(qna_row, "inquiry_text", "") or ""),
        inquiry_registered_at=getattr(qna_row, "inquiry_registered_at", None),
        answered=answered,
        answer_content_id=(str(getattr(qna_row, "answer_content_id", "") or "").strip() or None),
        answer_text=(str(getattr(qna_row, "answer_text", "") or "").strip() or None),
        answer_registered_at=getattr(qna_row, "answer_registered_at", None),
        order_id=(str(getattr(qna_row, "order_id", "") or "").strip() or None),
        product_no=(str(getattr(qna_row, "product_no", "") or "").strip() or None),
        product_order_id_list=(str(getattr(qna_row, "product_order_id_list", "") or "").strip() or None),
        product_name=(str(getattr(qna_row, "product_name", "") or "").strip() or None),
        product_order_option=(str(getattr(qna_row, "product_order_option", "") or "").strip() or None),
        customer_id=(str(getattr(qna_row, "customer_id", "") or "").strip() or None),
        customer_name=(str(getattr(qna_row, "customer_name", "") or "").strip() or None),
        masked_writer_id=(str(getattr(qna_row, "masked_writer_id", "") or "").strip() or None),
        draft_id=(str(getattr(draft_row, "draft_id", "") or "").strip() or None),
        draft_status=draft_status,
        draft_text=(str(getattr(draft_row, "draft_text", "") or "").strip() or None),
        model_name=(str(getattr(draft_row, "model_name", "") or "").strip() or None),
        rejection_comment=(str(getattr(draft_row, "rejection_comment", "") or "").strip() or None),
        rejection_analysis=_parse_rejection_analysis(getattr(draft_row, "rejection_analysis_json", None)),
        validation_result=_to_qna_validation_result(validation_row),
        issue_tags=list(issue_tags or []),
        last_submit_success=(bool(getattr(submit_row, "success", False)) if submit_row is not None else None),
        last_submit_status_code=(int(getattr(submit_row, "response_status_code", 0)) if getattr(submit_row, "response_status_code", None) is not None else None),
        last_submit_error=(str(getattr(submit_row, "error_message", "") or "").strip() or None),
        last_submit_at=getattr(submit_row, "submitted_at", None),
        can_generate=can_generate,
        can_approve=can_approve,
        can_reject=can_reject,
        can_submit=can_submit,
    )


def _list_qna_workbench_items(
    db: Session,
    *,
    qna_kind: str = "all",
    response_state: str = "all",
    search: str | None = None,
    issue_tag: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> tuple[QnaWorkbenchDashboard, list[QnaWorkbenchItem]]:
    query = db.query(CommerceQnaRaw)
    qna_kind0 = str(qna_kind or "all").strip()
    if qna_kind0 in ("customer", "product"):
        query = query.filter(CommerceQnaRaw.qna_kind == qna_kind0)
    from_date0, to_date0 = _normalize_date_range(from_date, to_date)
    if from_date0 is not None:
        query = query.filter(func.date(CommerceQnaRaw.inquiry_registered_at) >= from_date0)
    if to_date0 is not None:
        query = query.filter(func.date(CommerceQnaRaw.inquiry_registered_at) <= to_date0)
    search0 = _collapse_ws_text(search, 120).lower()
    if search0:
        like = f"%{search0}%"
        query = query.filter(
            or_(
                func.lower(func.coalesce(CommerceQnaRaw.title, "")).like(like),
                func.lower(func.coalesce(CommerceQnaRaw.inquiry_text, "")).like(like),
                func.lower(func.coalesce(CommerceQnaRaw.product_name, "")).like(like),
                func.lower(func.coalesce(CommerceQnaRaw.customer_name, "")).like(like),
                func.lower(func.coalesce(CommerceQnaRaw.external_inquiry_id, "")).like(like),
            )
        )
    rows = query.order_by(
        CommerceQnaRaw.inquiry_registered_at.desc(),
        CommerceQnaRaw.updated_at.desc(),
        CommerceQnaRaw.qna_key.desc(),
    ).all()
    all_qna_keys = [str(getattr(row, "qna_key", "") or "") for row in rows]
    issue_tag_map = _get_qna_issue_tag_display_map(db, all_qna_keys)
    issue_tag_counts = _qna_issue_tag_counts(issue_tag_map)
    rows = _filter_qna_rows_by_issue_tag(db, rows, issue_tag)
    qna_keys = [str(getattr(row, "qna_key", "") or "") for row in rows]
    draft_map = _get_latest_qna_draft_map(db, qna_keys)
    validation_map = _get_qna_draft_validation_map(
        db,
        [str(getattr(row, "draft_id", "") or "") for row in draft_map.values()],
    )
    submit_map = _get_latest_submit_log_map(db, qna_keys)
    items: list[QnaWorkbenchItem] = []
    state_counts: dict[str, int] = {}
    customer_count = 0
    product_count = 0
    last_collected_at: datetime | None = None
    for row in rows:
        if str(getattr(row, "qna_kind", "") or "") == "customer":
            customer_count += 1
        elif str(getattr(row, "qna_kind", "") or "") == "product":
            product_count += 1
        collected_at = getattr(row, "collected_at", None)
        if collected_at is not None and (last_collected_at is None or collected_at > last_collected_at):
            last_collected_at = collected_at
        qna_key = str(getattr(row, "qna_key", "") or "")
        draft_row = draft_map.get(qna_key)
        validation_row = validation_map.get(str(getattr(draft_row, "draft_id", "") or "").strip()) if draft_row is not None else None
        submit_row = submit_map.get(qna_key)
        derived_state = _derive_response_state(row, draft_row, submit_row)
        state_counts[derived_state] = int(state_counts.get(derived_state, 0) + 1)
        if str(response_state or "all").strip() not in ("", "all") and derived_state != str(response_state):
            continue
        items.append(_to_qna_workbench_item(row, draft_row, submit_row, validation_row, issue_tag_map.get(qna_key, [])))
    dashboard = QnaWorkbenchDashboard(
        total_items=len(rows),
        unanswered_count=int(state_counts.get("unanswered", 0)),
        generated_count=int(state_counts.get("generated", 0)),
        approved_count=int(state_counts.get("approved", 0)),
        submitted_count=int(state_counts.get("submitted", 0)),
        failed_submit_count=int(state_counts.get("failed", 0)),
        customer_count=customer_count,
        product_count=product_count,
        last_collected_at=last_collected_at,
        issue_tag_counts=issue_tag_counts,
    )
    return dashboard, items


def _build_qna_analysis(db: Session) -> QnaAnalysisResponse:
    rows = db.query(CommerceQnaRaw).all()
    qna_keys = [str(getattr(row, "qna_key", "") or "") for row in rows]
    draft_map = _get_latest_qna_draft_map(db, qna_keys)
    submit_map = _get_latest_submit_log_map(db, qna_keys)
    category_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    answered_count = 0
    customer_count = 0
    product_count = 0
    approved_draft_count = 0
    submitted_draft_count = 0
    failed_submit_count = 0
    for row in rows:
        if bool(getattr(row, "answered", False)):
            answered_count += 1
        if str(getattr(row, "qna_kind", "") or "") == "customer":
            customer_count += 1
        elif str(getattr(row, "qna_kind", "") or "") == "product":
            product_count += 1
        category = str(getattr(row, "category", "") or "").strip() or "미분류"
        category_counts[category] = int(category_counts.get(category, 0) + 1)
        state = _derive_response_state(row, draft_map.get(str(getattr(row, "qna_key", "") or "")), submit_map.get(str(getattr(row, "qna_key", "") or "")))
        status_counts[state] = int(status_counts.get(state, 0) + 1)
        draft_row = draft_map.get(str(getattr(row, "qna_key", "") or ""))
        if draft_row is not None and str(getattr(draft_row, "status", "") or "") == "approved":
            approved_draft_count += 1
        if draft_row is not None and str(getattr(draft_row, "status", "") or "") == "submitted":
            submitted_draft_count += 1
        submit_row = submit_map.get(str(getattr(row, "qna_key", "") or ""))
        if submit_row is not None and bool(getattr(submit_row, "success", None)) is False:
            failed_submit_count += 1
    return QnaAnalysisResponse(
        ok=True,
        total_items=len(rows),
        answered_count=answered_count,
        unanswered_count=max(0, len(rows) - answered_count),
        customer_count=customer_count,
        product_count=product_count,
        approved_draft_count=approved_draft_count,
        submitted_draft_count=submitted_draft_count,
        failed_submit_count=failed_submit_count,
        category_counts=category_counts,
        status_counts=status_counts,
    )


def _submit_qna_draft(db: Session, *, draft_id: str) -> QnaDraftSubmitResponse:
    draft_row = db.query(CommerceQnaDraft).filter(CommerceQnaDraft.draft_id == str(draft_id or "").strip()).one_or_none()
    if draft_row is None:
        raise HTTPException(status_code=404, detail="draft not found")
    if str(getattr(draft_row, "status", "") or "") != "approved":
        raise HTTPException(status_code=409, detail="approved 상태의 초안만 등록할 수 있습니다.")
    qna_row = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.qna_key == str(getattr(draft_row, "qna_key", "") or "")).one_or_none()
    if qna_row is None:
        raise HTTPException(status_code=404, detail="qna not found")
    kind = str(getattr(qna_row, "qna_kind", "") or "")
    external_id = str(getattr(qna_row, "external_inquiry_id", "") or "")
    draft_text = _collapse_ws_text(getattr(draft_row, "draft_text", None), 4000)
    if not draft_text:
        raise HTTPException(status_code=400, detail="draft_text empty")

    if kind == "customer":
        answer_content_id = str(getattr(qna_row, "answer_content_id", "") or "").strip()
        if answer_content_id:
            method = "PUT"
            path = f"/v1/pay-merchant/inquiries/{external_id}/answer/{answer_content_id}"
        else:
            method = "POST"
            path = f"/v1/pay-merchant/inquiries/{external_id}/answer"
        body: dict[str, object] = {"answerComment": draft_text}
        template_id0 = str(getattr(qna_row, "answer_template_no", "") or "").strip()
        if template_id0.isdigit():
            body["answerTemplateId"] = int(template_id0)
        expected = (200,)
    else:
        method = "PUT"
        path = f"/v1/contents/qnas/{external_id}"
        body = {"commentContent": draft_text}
        expected = (200, 204)

    status_code, payload, error = _commerce_call_json(
        db,
        method=method,
        path=path,
        body=body,
        expected_statuses=expected,
        timeout_sec=12.0,
    )
    response_body_json = json.dumps(payload or {}, ensure_ascii=False, sort_keys=True) if payload is not None else None
    remote_answer_content_id = None
    if payload:
        remote_answer_content_id = (
            str(payload.get("answerContentId") or payload.get("id") or "").strip() or None
        )
    submit_log = CommerceQnaSubmitLog(
        submit_id=str(uuid.uuid4()),
        qna_key=str(getattr(qna_row, "qna_key", "") or ""),
        draft_id=str(getattr(draft_row, "draft_id", "") or ""),
        qna_kind=kind,
        request_method=method,
        request_path=path,
        request_body_json=json.dumps(body, ensure_ascii=False, sort_keys=True),
        response_status_code=status_code,
        response_body_json=response_body_json,
        remote_answer_content_id=remote_answer_content_id,
        success=bool(error is None and status_code in expected),
        error_message=(str(error or "").strip() or None),
    )
    db.add(submit_log)
    if error or status_code not in expected:
        db.commit()
        raise HTTPException(status_code=502, detail=f"qna_submit_failed: status={status_code} err={error}".strip())

    now = _now_kst()
    qna_row.answered = True
    qna_row.answer_text = draft_text
    qna_row.answer_registered_at = now
    if remote_answer_content_id:
        qna_row.answer_content_id = remote_answer_content_id
    draft_row.status = "submitted"
    draft_row.updated_at = now
    db.commit()
    return QnaDraftSubmitResponse(
        ok=True,
        draft_id=str(getattr(draft_row, "draft_id", "") or ""),
        qna_key=str(getattr(draft_row, "qna_key", "") or ""),
        status=str(getattr(draft_row, "status", "") or ""),
        detail="커머스 API 등록 완료",
        remote_answer_content_id=remote_answer_content_id,
    )


def register_qna_routes(app, *, get_db_dep) -> None:
    @app.post("/qna/sync", response_model=QnaSyncResponse)
    def sync_qna(payload: QnaSyncRequest, db: Session = Depends(get_db_dep)):
        return sync_qna_data(db, payload)

    @app.get("/qna/summary", response_model=QnaWorkbenchDashboard)
    def qna_summary(db: Session = Depends(get_db_dep)):
        dashboard, _ = _list_qna_workbench_items(db)
        return dashboard

    @app.get("/qna/workbench", response_model=QnaWorkbenchResponse)
    def qna_workbench(
        qna_kind: str = Query("all"),
        response_state: str = Query("all"),
        search: str | None = Query(None),
        issue_tag: str | None = Query(None),
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        dashboard, items = _list_qna_workbench_items(
            db,
            qna_kind=qna_kind,
            response_state=response_state,
            search=search,
            issue_tag=issue_tag,
            from_date=from_date,
            to_date=to_date,
        )
        return QnaWorkbenchResponse(
            ok=True,
            qna_kind=str(qna_kind or "all"),
            response_state=str(response_state or "all"),
            search=(str(search or "").strip() or None),
            dashboard=dashboard,
            items=items,
        )

    @app.get("/qna/analysis", response_model=QnaAnalysisResponse)
    def qna_analysis(db: Session = Depends(get_db_dep)):
        return _build_qna_analysis(db)

    @app.post("/qna/analysis/run", response_model=QnaAnalysisRunResponse)
    def qna_analysis_run(payload: QnaAnalysisRunRequest, db: Session = Depends(get_db_dep)):
        return run_qna_analysis(db, payload)

    @app.get("/qna/analysis/summary", response_model=QnaAnalysisSummaryResponse)
    def qna_analysis_summary(
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        qna_kind: str = Query("all"),
        product_name: str | None = Query(None),
        category: str | None = Query(None),
        inquiry_type: str | None = Query(None),
        conversion_level: str | None = Query(None),
        purchase_stage: str | None = Query(None),
        sentiment: str | None = Query(None),
        search: str | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        return build_qna_analysis_summary(
            db,
            from_date=from_date,
            to_date=to_date,
            qna_kind=qna_kind,
            product_name=product_name,
            category=category,
            inquiry_type=inquiry_type,
            conversion_level=conversion_level,
            purchase_stage=purchase_stage,
            sentiment=sentiment,
            search=search,
        )

    @app.get("/qna/analysis/trends", response_model=QnaAnalysisTrendsResponse)
    def qna_analysis_trends(
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        qna_kind: str = Query("all"),
        product_name: str | None = Query(None),
        category: str | None = Query(None),
        inquiry_type: str | None = Query(None),
        conversion_level: str | None = Query(None),
        purchase_stage: str | None = Query(None),
        sentiment: str | None = Query(None),
        search: str | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        return build_qna_analysis_trends(
            db,
            from_date=from_date,
            to_date=to_date,
            qna_kind=qna_kind,
            product_name=product_name,
            category=category,
            inquiry_type=inquiry_type,
            conversion_level=conversion_level,
            purchase_stage=purchase_stage,
            sentiment=sentiment,
            search=search,
        )

    @app.get("/qna/analysis/conversion-barriers", response_model=QnaConversionBarriersResponse)
    def qna_analysis_conversion_barriers(
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        qna_kind: str = Query("all"),
        product_name: str | None = Query(None),
        category: str | None = Query(None),
        inquiry_type: str | None = Query(None),
        conversion_level: str | None = Query(None),
        purchase_stage: str | None = Query(None),
        sentiment: str | None = Query(None),
        search: str | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        return build_qna_conversion_barriers(
            db,
            from_date=from_date,
            to_date=to_date,
            qna_kind=qna_kind,
            product_name=product_name,
            category=category,
            inquiry_type=inquiry_type,
            conversion_level=conversion_level,
            purchase_stage=purchase_stage,
            sentiment=sentiment,
            search=search,
        )

    @app.get("/qna/analysis/quality-issues", response_model=QnaQualityIssuesResponse)
    def qna_analysis_quality_issues(
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        qna_kind: str = Query("all"),
        product_name: str | None = Query(None),
        category: str | None = Query(None),
        inquiry_type: str | None = Query(None),
        conversion_level: str | None = Query(None),
        purchase_stage: str | None = Query(None),
        sentiment: str | None = Query(None),
        search: str | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        return build_qna_quality_issues(
            db,
            from_date=from_date,
            to_date=to_date,
            qna_kind=qna_kind,
            product_name=product_name,
            category=category,
            inquiry_type=inquiry_type,
            conversion_level=conversion_level,
            purchase_stage=purchase_stage,
            sentiment=sentiment,
            search=search,
        )

    @app.get("/qna/analysis/faq-candidates", response_model=QnaFaqCandidatesResponse)
    def qna_analysis_faq_candidates(
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        qna_kind: str = Query("all"),
        product_name: str | None = Query(None),
        category: str | None = Query(None),
        inquiry_type: str | None = Query(None),
        conversion_level: str | None = Query(None),
        purchase_stage: str | None = Query(None),
        sentiment: str | None = Query(None),
        search: str | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        return build_qna_faq_candidates(
            db,
            from_date=from_date,
            to_date=to_date,
            qna_kind=qna_kind,
            product_name=product_name,
            category=category,
            inquiry_type=inquiry_type,
            conversion_level=conversion_level,
            purchase_stage=purchase_stage,
            sentiment=sentiment,
            search=search,
        )

    @app.get("/qna/analysis/marketing-insights", response_model=QnaMarketingInsightsResponse)
    def qna_analysis_marketing_insights(
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        qna_kind: str = Query("all"),
        product_name: str | None = Query(None),
        category: str | None = Query(None),
        inquiry_type: str | None = Query(None),
        conversion_level: str | None = Query(None),
        purchase_stage: str | None = Query(None),
        sentiment: str | None = Query(None),
        search: str | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        return build_qna_marketing_insights(
            db,
            from_date=from_date,
            to_date=to_date,
            qna_kind=qna_kind,
            product_name=product_name,
            category=category,
            inquiry_type=inquiry_type,
            conversion_level=conversion_level,
            purchase_stage=purchase_stage,
            sentiment=sentiment,
            search=search,
        )

    @app.get("/qna/analysis/items", response_model=QnaAnalysisItemsResponse)
    def qna_analysis_items(
        from_date: date | None = Query(None),
        to_date: date | None = Query(None),
        qna_kind: str = Query("all"),
        product_name: str | None = Query(None),
        category: str | None = Query(None),
        inquiry_type: str | None = Query(None),
        conversion_level: str | None = Query(None),
        purchase_stage: str | None = Query(None),
        sentiment: str | None = Query(None),
        search: str | None = Query(None),
        db: Session = Depends(get_db_dep),
    ):
        return build_qna_analysis_items(
            db,
            from_date=from_date,
            to_date=to_date,
            qna_kind=qna_kind,
            product_name=product_name,
            category=category,
            inquiry_type=inquiry_type,
            conversion_level=conversion_level,
            purchase_stage=purchase_stage,
            sentiment=sentiment,
            search=search,
        )

    @app.post("/qna/drafts/generate", response_model=QnaDraftResponse)
    def generate_qna_draft(payload: QnaDraftGenerateRequest, db: Session = Depends(get_db_dep)):
        qna_row = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.qna_key == str(payload.qna_key or "").strip()).one_or_none()
        if qna_row is None:
            raise HTTPException(status_code=404, detail="qna not found")
        return _generate_qna_draft_for_row(
            db,
            qna_row=qna_row,
            model=payload.model,
            force_regenerate=bool(payload.force_regenerate),
        )

    @app.post("/qna/drafts/generate-batch", response_model=QnaDraftBatchGenerateResponse)
    def generate_qna_draft_batch(payload: QnaDraftBatchGenerateRequest, db: Session = Depends(get_db_dep)):
        query = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.answered.is_(False))
        qna_kind0 = str(payload.qna_kind or "all").strip()
        if qna_kind0 in ("customer", "product"):
            query = query.filter(CommerceQnaRaw.qna_kind == qna_kind0)
        from_date0, to_date0 = _normalize_date_range(payload.from_date, payload.to_date)
        if from_date0 is not None:
            query = query.filter(func.date(CommerceQnaRaw.inquiry_registered_at) >= from_date0)
        if to_date0 is not None:
            query = query.filter(func.date(CommerceQnaRaw.inquiry_registered_at) <= to_date0)
        rows = query.order_by(CommerceQnaRaw.inquiry_registered_at.desc(), CommerceQnaRaw.updated_at.desc()).limit(int(payload.max_items or 10) * 3).all()
        items: list[QnaDraftResponse] = []
        generated = 0
        reused = 0
        skipped_answered = 0
        for row in rows:
            if bool(getattr(row, "answered", False)):
                skipped_answered += 1
                continue
            if len(items) >= int(payload.max_items or 10):
                break
            resp = _generate_qna_draft_for_row(
                db,
                qna_row=row,
                model=(str(payload.model or "").strip() or None),
                force_regenerate=bool(payload.force_regenerate),
            )
            if bool(resp.generated_now):
                if str(resp.status or "") == "generated":
                    generated += 1
                else:
                    generated += 1
            else:
                reused += 1
            items.append(resp)
        return QnaDraftBatchGenerateResponse(
            ok=True,
            requested=int(payload.max_items or 10),
            processed=len(items),
            generated=generated,
            reused=reused,
            skipped_answered=skipped_answered,
            items=items,
        )

    @app.post("/qna/drafts/update", response_model=QnaDraftUpdateResponse)
    def update_qna_draft(payload: QnaDraftUpdateRequest, db: Session = Depends(get_db_dep)):
        row = db.query(CommerceQnaDraft).filter(CommerceQnaDraft.draft_id == str(payload.draft_id or "").strip()).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="draft not found")
        row.draft_text = str(payload.draft_text or "")
        row.updated_at = _now_kst()
        db.commit()
        validation_row = _mark_qna_draft_validation_needs_recheck(
            db,
            draft_id=str(getattr(row, "draft_id", "") or ""),
            qna_key=str(getattr(row, "qna_key", "") or ""),
        )
        return QnaDraftUpdateResponse(
            ok=True,
            draft_id=str(getattr(row, "draft_id", "") or ""),
            qna_key=str(getattr(row, "qna_key", "") or ""),
            status=str(getattr(row, "status", "") or ""),
            draft_text=str(getattr(row, "draft_text", "") or ""),
            validation_result=_to_qna_validation_result(validation_row),
        )

    @app.post("/qna/drafts/validate", response_model=QnaDraftValidateResponse)
    def validate_qna_draft(payload: QnaDraftValidateRequest, db: Session = Depends(get_db_dep)):
        draft_row = db.query(CommerceQnaDraft).filter(CommerceQnaDraft.draft_id == str(payload.draft_id or "").strip()).one_or_none()
        if draft_row is None:
            raise HTTPException(status_code=404, detail="draft not found")
        qna_row = db.query(CommerceQnaRaw).filter(CommerceQnaRaw.qna_key == str(getattr(draft_row, "qna_key", "") or "")).one_or_none()
        if qna_row is None:
            raise HTTPException(status_code=404, detail="qna not found")
        return _validate_existing_qna_draft(db, draft_row=draft_row, qna_row=qna_row)

    @app.post("/qna/drafts/status", response_model=QnaDraftStatusUpdateResponse)
    def update_qna_draft_status(payload: QnaDraftStatusUpdateRequest, db: Session = Depends(get_db_dep)):
        return _apply_qna_draft_status_change(
            db,
            draft_id=payload.draft_id,
            status=payload.status,
            rejection_comment=payload.rejection_comment,
        )

    @app.post("/qna/drafts/submit", response_model=QnaDraftSubmitResponse)
    def submit_qna_draft(payload: QnaDraftSubmitRequest, db: Session = Depends(get_db_dep)):
        return _submit_qna_draft(db, draft_id=payload.draft_id)
