from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session
from sqlalchemy import text

from db import AiDecisionLog, AppSetting


AI_SETTINGS_KEY = "ai:settings"
AI_SETTINGS_BACKUP_PREFIX = "ai:settings:backup:"

_A1_DEFAULT_SURFACES = {
    "mobile_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}},
    "pc_integrated": {"page1": {"organic_slots": 10, "ad_slots": 4}},
}


def _is_a1_id(rule_id: object) -> bool:
    rid = str(rule_id or "").strip().upper().replace(" ", "").replace("_", "").replace("-", "")
    return rid == "A1"


def _a1_default_thresholds() -> dict:
    return {
        "uncertain": {"min_valid_days_14d": 7, "missing_rank_value": 999},
        "stable": {"avg_rank_14d_max": 3.0, "rank_volatility_14d_max": 1.2, "down_days_14d_max": 2},
        "unstable": {
            "avg_rank_14d_min": 4.0,
            "avg_rank_14d_max": 10.0,
            "rank_volatility_14d_min": 2.0,
            "drop_7d_min": 3,
            "drop_delta_min": 3,
        },
        "weak": {"avg_rank_14d_min": 11.0, "improve_days_7d_eq": 0},
    }


def _a1_parse_thresholds_from_rules_text(raw_rules: object) -> dict:
    """
    v1 호환: A-1 rules(문자열)에서 thresholds를 추출한다.
    - 우선순위:
      1) JSON({thresholds:{...}})이면 그 값을 사용
      2) 실패하면 기본값
    (설정 마이그레이션 용도이므로, 여기서는 "안전하게" 기본값 폴백이 최우선이다.)
    """
    cfg = _a1_default_thresholds()
    raw = str(raw_rules or "").strip()
    if not raw:
        return cfg
    if "{" in raw and "}" in raw:
        try:
            j = json.loads(raw)
            th = j.get("thresholds") if isinstance(j, dict) else None
            if isinstance(th, dict):
                out = json.loads(json.dumps(cfg))
                for k in ("uncertain", "stable", "unstable", "weak"):
                    if isinstance(th.get(k), dict):
                        out[k].update(th[k])
                return out
        except Exception:
            pass
    return cfg


def normalize_ai_settings_v2(data: dict | None) -> dict:
    """
    저장 포맷을 v2로 정규화한다.
    - v2: {format_version:"v2", common_rules:"", rule_packs:[...]}
    - v1(legacy): {common_rules:"", analysis_rules:[{id,title,inputs,rules,outputs,...}]}
    """
    obj = data or {}
    # v2
    if str(obj.get("format_version") or "").strip().lower() == "v2":
        packs = obj.get("rule_packs")
        if not isinstance(packs, list):
            packs = []
        return {"format_version": "v2", "common_rules": str(obj.get("common_rules") or ""), "rule_packs": packs}

    # v1 -> v2
    common = str(obj.get("common_rules") or "")
    rules = obj.get("analysis_rules")
    if not isinstance(rules, list):
        rules = []
    packs: list[dict] = []
    for r in rules:
        if not isinstance(r, dict):
            continue
        rid = str(r.get("id") or "").strip() or ""
        if not rid:
            continue
        pack: dict = {"id": rid, "enabled": True, "title": str(r.get("title") or "")}
        if _is_a1_id(rid):
            pack["a1"] = {
                "surfaces": json.loads(json.dumps(_A1_DEFAULT_SURFACES)),
                "thresholds": _a1_parse_thresholds_from_rules_text(r.get("rules")),
                "prompt_templates": {"inputs_json": str(r.get("inputs") or ""), "outputs_template": str(r.get("outputs") or "")},
            }
        packs.append(pack)
    # 기본: A-1 pack이 없으면 UX를 위해 기본 pack을 넣어준다.
    if not any(_is_a1_id(p.get("id")) for p in packs):
        packs.insert(
            0,
            {
                "id": "A-1",
                "enabled": True,
                "title": "A-1 오가닉 자동화(규칙 v2)",
                "a1": {"surfaces": json.loads(json.dumps(_A1_DEFAULT_SURFACES)), "thresholds": _a1_default_thresholds(), "prompt_templates": {"inputs_json": "", "outputs_template": ""}},
            },
        )
    return {"format_version": "v2", "common_rules": common, "rule_packs": packs}


def _is_empty_settings(data: dict) -> bool:
    try:
        common = str((data or {}).get("common_rules") or "").strip()
    except Exception:
        common = ""
    packs = (data or {}).get("rule_packs")
    if packs is None:
        packs = (data or {}).get("analysis_rules")
    if not isinstance(packs, list):
        packs = []
    return (not common) and (len(packs) == 0)


def _extract_a1_rule_item(ai_settings: dict) -> dict | None:
    """
    UI/백엔드에서 사용하는 스키마(AiSettingsPayload)에 맞춰 A-1 항목을 1개로 정규화한다.
    - id는 A-1로 고정(혹은 기존 값 유지)
    """
    # v2에서는 a1 config만 추출하면 되므로, 여기서는 사용하지 않는다(legacy 호환용으로만 유지).
    rules = (ai_settings or {}).get("analysis_rules") or []
    if not isinstance(rules, list):
        rules = []
    picked = None
    for r in rules:
        rid = str((r or {}).get("id") or "").strip()
        if _is_a1_id(rid):
            picked = r
            break
    if not isinstance(picked, dict):
        return None
    return {"id": str(picked.get("id") or "A-1"), "title": str(picked.get("title") or ""), "inputs": str(picked.get("inputs") or ""), "rules": str(picked.get("rules") or ""), "outputs": str(picked.get("outputs") or "")}


def restore_ai_settings_from_latest_log(db: Session) -> bool:
    """
    최근 AI 로그(A-1)에서 rules 스냅샷을 추출해 AI 세팅을 복구한다.
    - 사용자 입장에서 "사라졌다"를 즉시 복구하는 안전장치
    """
    # 구조적 안정성:
    # - SQLite(CURRENT_TIMESTAMP)는 초 단위 해상도라, 짧은 시간에 로그가 여러 개 생성되면 created_at이 동일해질 수 있다.
    # - 그 경우 "가장 마지막에 삽입된 행"을 선택하도록 2차 정렬 키를 추가한다.
    q = db.query(AiDecisionLog).filter(AiDecisionLog.analysis_type == "A-1").order_by(AiDecisionLog.created_at.desc())
    try:
        dialect = db.get_bind().dialect.name  # type: ignore[attr-defined]
    except Exception:
        dialect = None
    if str(dialect or "").lower() == "sqlite":
        q = q.order_by(text("rowid DESC"))
    else:
        # Postgres 등에서는 rowid가 없으므로, (유니크)log_id로 tie-break
        q = q.order_by(AiDecisionLog.log_id.desc())
    row = q.limit(1).one_or_none()
    if row is None:
        return False
    try:
        snap = json.loads(str(getattr(row, "inputs_json", "") or "") or "{}")
    except Exception:
        return False
    rules_pack = (snap or {}).get("rules") or {}
    if not isinstance(rules_pack, dict):
        return False
    # v1 로그 스냅샷 -> v2 pack으로 승격 후 "병합"한다.
    cur = normalize_ai_settings_v2(get_ai_settings(db))
    cur_common = str((cur or {}).get("common_rules") or "")
    cur_packs = (cur or {}).get("rule_packs") or []
    if not isinstance(cur_packs, list):
        cur_packs = []

    # 공통 규칙은 기존이 비어있을 때만 복구본을 채운다(덮어쓰기 방지).
    next_common = cur_common if str(cur_common or "").strip() else str(rules_pack.get("common_rules") or "")

    a1_pack = {
        "id": str((rules_pack.get("rule_id") or "A-1")),
        "enabled": True,
        "title": str(rules_pack.get("title") or "A-1"),
        "a1": {
            "surfaces": json.loads(json.dumps(_A1_DEFAULT_SURFACES)),
            "thresholds": _a1_parse_thresholds_from_rules_text(rules_pack.get("rules")),
            "prompt_templates": {"inputs_json": str(rules_pack.get("inputs") or ""), "outputs_template": str(rules_pack.get("outputs") or "")},
        },
    }

    def _rid(x: dict) -> str:
        return str((x or {}).get("id") or "").strip()

    next_packs = [p for p in cur_packs if not _is_a1_id(_rid(p))]
    next_packs.append(a1_pack)

    restored = {"format_version": "v2", "common_rules": next_common, "rule_packs": next_packs}
    save_ai_settings(db, restored, allow_empty=True)
    return True


def get_ai_settings(db: Session) -> dict:
    """
    AI 세팅(규칙)을 app_settings에 JSON 문자열로 저장/조회한다.

    저장 스키마(최소):
    - format_version: "v2"
    - common_rules: str
    - rule_packs: list[dict]
    """
    row = db.query(AppSetting).filter(AppSetting.key == AI_SETTINGS_KEY).one_or_none()
    if row is None:
        return normalize_ai_settings_v2({})

    raw = str(getattr(row, "value", "") or "").strip()
    if not raw:
        return normalize_ai_settings_v2({})

    try:
        obj = json.loads(raw)
    except Exception:
        # 기존 값이 깨졌어도 "사라진 것처럼" 보이지 않도록,
        # 1) 최신 백업(ai:settings:backup:*)을 시도하고,
        # 2) 그래도 안 되면 기본값으로 폴백한다.
        try:
            backups = (
                db.query(AppSetting)
                .filter(AppSetting.key.like(f"{AI_SETTINGS_BACKUP_PREFIX}%"))
                .order_by(AppSetting.updated_at.desc())
                .limit(5)
                .all()
            )
            for b in backups or []:
                try:
                    obj2 = json.loads(str(getattr(b, "value", "") or "") or "{}")
                    return normalize_ai_settings_v2(obj2 if isinstance(obj2, dict) else {})
                except Exception:
                    continue
        except Exception:
            pass
        return normalize_ai_settings_v2({})

    return normalize_ai_settings_v2(obj if isinstance(obj, dict) else {})


def list_ai_settings_backups(db: Session, *, limit: int = 30) -> list[dict]:
    rows = (
        db.query(AppSetting)
        .filter(AppSetting.key.like(f"{AI_SETTINGS_BACKUP_PREFIX}%"))
        .order_by(AppSetting.updated_at.desc())
        .limit(max(1, min(200, int(limit or 30))))
        .all()
    )
    out: list[dict] = []
    for r in rows or []:
        try:
            k = str(getattr(r, "key", "") or "")
            v = str(getattr(r, "value", "") or "")
            out.append({"key": k, "updated_at": str(getattr(r, "updated_at", "") or ""), "len": len(v)})
        except Exception:
            continue
    return out


def restore_ai_settings_from_backup_key(db: Session, key: str) -> bool:
    k = str(key or "").strip()
    if not k or not k.startswith(AI_SETTINGS_BACKUP_PREFIX):
        return False
    row = db.query(AppSetting).filter(AppSetting.key == k).one_or_none()
    if row is None:
        return False
    raw = str(getattr(row, "value", "") or "").strip()
    if not raw:
        return False
    try:
        obj = json.loads(raw)
    except Exception:
        return False
    restored = normalize_ai_settings_v2(obj if isinstance(obj, dict) else {})
    save_ai_settings(db, restored, allow_empty=True)
    return True


def _new_backup_key() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    return f"{AI_SETTINGS_BACKUP_PREFIX}{ts}:{uuid.uuid4()}"


def save_ai_settings(db: Session, data: dict, *, allow_empty: bool = False) -> None:
    """
    AI 세팅을 JSON 문자열로 upsert한다.
    """
    payload = data or {}

    # 구조적 안전장치: 기존 값이 있는데 빈 값으로 덮어쓰는 것을 기본적으로 차단한다.
    if not allow_empty and _is_empty_settings(payload):
        prev = get_ai_settings(db)
        if not _is_empty_settings(prev):
            raise ValueError("REFUSE_EMPTY_OVERWRITE")

    # 최신값을 백업으로 남긴다(복구용). (항상 유니크 키)
    try:
        cur = db.query(AppSetting).filter(AppSetting.key == AI_SETTINGS_KEY).one_or_none()
        if cur is not None and str(getattr(cur, "value", "") or "").strip():
            bk_key = _new_backup_key()
            db.add(AppSetting(key=bk_key, value=str(getattr(cur, "value", "") or "")))
            db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    s = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    row = db.query(AppSetting).filter(AppSetting.key == AI_SETTINGS_KEY).one_or_none()
    if row is None:
        db.add(AppSetting(key=AI_SETTINGS_KEY, value=s))
    else:
        row.value = s
    db.commit()

