from __future__ import annotations

from datetime import datetime
import hashlib
import json
from typing import Any
from zoneinfo import ZoneInfo


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _resolve_execution_adapter(action_type: str, payload: dict[str, Any]) -> str:
    action_type0 = str(action_type or "").strip().upper()
    action_bucket = str(payload.get("action_bucket") or payload.get("action_kind") or "").strip().upper()
    if action_type0 in {"QUEUE_AD_BUDGET_ACTION", "QUEUE_AD_KEYWORD_ACTION"}:
        return "naver-searchad-manual"
    if action_type0 == "QUEUE_POLICY_COMPARE_ACTION":
        return "policy-pack-switch-manual"
    if action_bucket in {"VOC_IMPROVEMENT", "FAQ_CONTENT_IMPROVEMENT"}:
        return "content-ops-manual"
    if action_type0 == "QUEUE_SALES_ACTION":
        return "commerce-priority-manual"
    return "ai-ops-manual"


def build_execution_result(
    *,
    queue_id: str,
    action_type: str,
    payload: dict[str, Any],
    actor: str,
    actor_role: str | None,
    dry_run: bool,
) -> dict[str, Any]:
    actor0 = str(actor or "").strip() or "ai-ops-worker"
    actor_role0 = str(actor_role or "").strip() or None
    adapter = _resolve_execution_adapter(action_type, payload)
    executed_at = datetime.now(ZoneInfo("Asia/Seoul")).isoformat()
    execution_key = hashlib.sha1(
        _json_dumps(
            {
                "queue_id": queue_id,
                "action_type": str(action_type or "").strip().upper(),
                "adapter": adapter,
                "title": str(payload.get("title") or "").strip(),
                "target_identifier": payload.get("target_identifier") or {},
            }
        ).encode("utf-8")
    ).hexdigest()

    effect = "dry-run simulated" if dry_run else "manual operation ticket created"
    next_status = "DONE"
    return {
        "execution_key": execution_key,
        "adapter": adapter,
        "status": next_status,
        "actor": actor0,
        "actor_role": actor_role0,
        "executed_at": executed_at,
        "dry_run": bool(dry_run),
        "external_effect": effect,
        "target_identifier": payload.get("target_identifier") or {},
        "source_screen": payload.get("source_screen"),
        "summary": f"{adapter} adapter handled {str(payload.get('title') or queue_id).strip() or queue_id}",
    }
