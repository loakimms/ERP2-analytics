import json
import math
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, timedelta
from typing import Any, Literal

import requests
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import (
    A1GptActionDaily,
    A1SkuCauseEvidenceDaily,
    A1SkuEventDaily,
    A1SkuKeywordEvidenceDaily,
    A1SkuStateDaily,
    A1SkuZoneCountsDaily,
    A1SkuMap,
    CreativeOrganicDerived,
    NaverAdCreativeDaily,
    NaverProductReviewDaily,
    TrackedProductMeta,
)
from ai_settings_store import get_ai_settings as _get_ai_settings
from a1_trace_store import canonical_json_dumps, create_edge, create_node, create_run, sha256_hex, upsert_blob


Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class A1BatchRunRequest(BaseModel):
    """
    A-1 전일 배치 실행 요청.

    - date 미입력 시: 서버 기준 전일(Asia/Seoul)로 처리하는 것을 권장하지만,
      Analytics API는 timezone을 main.py에서 관리하고 있어, date 기본값은 main에서 주입한다.
    """

    date: Date | None = None
    surface: str = Field(default="mobile_integrated", description="지면(예: mobile_integrated)")
    severities: list[Severity] = Field(default_factory=lambda: ["HIGH", "CRITICAL"])
    max_items: int = Field(default=50, ge=1, le=500)
    action_version: str = Field(default="A1_V1")
    model: str = Field(default="gpt-5.2")
    dry_run: bool = Field(default=False, description="true면 DB 저장 없이 payload/대상만 반환")


class A1BatchRunItem(BaseModel):
    sku_id: str
    status: str
    error: str | None = None


class A1BatchRunResponse(BaseModel):
    ok: bool
    date: str
    surface: str
    target_skus: int
    processed: int
    saved: int
    failed: int
    items: list[A1BatchRunItem] = []
    # (옵션) 이번 배치가 생성한 trace run_id (UI가 즉시 열람할 수 있게)
    trace_run_id: str | None = None


def _json_dumps(obj: Any, *, limit: int | None = 12000) -> str:
    try:
        s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        s = json.dumps({"error": "json_dumps_failed"}, ensure_ascii=False)
    if limit is not None and limit > 0 and len(s) > limit:
        return s[:limit] + "…"
    return s


def _pick_a1_rule_pack(db: Session) -> dict[str, Any]:
    """
    AI 세팅에서 A-1 규칙 문서를 추출한다.
    - main.py의 A-1 단건/포트폴리오와 동일한 의도를 유지하되, 순환 import를 피하기 위해 여기서 재구현한다.
    """
    ai_settings = _get_ai_settings(db) or {}
    common = str((ai_settings or {}).get("common_rules") or "")

    # v2 우선: rule_packs
    fmt = str((ai_settings or {}).get("format_version") or "").strip().lower()
    if fmt == "v2":
        packs = (ai_settings or {}).get("rule_packs") or []
        if not isinstance(packs, list):
            packs = []
        picked_pack: dict | None = None
        for p in packs:
            rid = str((p or {}).get("id") or "").strip().upper().replace(" ", "").replace("_", "").replace("-", "")
            if rid == "A1":
                if isinstance(p, dict):
                    picked_pack = p
                break
        picked_pack = picked_pack or {}
        a1 = (picked_pack.get("a1") if isinstance(picked_pack, dict) else None) or {}
        tmpl = (a1.get("prompt_templates") if isinstance(a1, dict) else None) or {}
        th = (a1.get("thresholds") if isinstance(a1, dict) else None) or {}
        try:
            rules_text = json.dumps({"thresholds": th}, ensure_ascii=False, indent=2)
        except Exception:
            rules_text = "{}"
        return {
            "common_rules": common,
            "rule_id": str(picked_pack.get("id") or "A-1"),
            "title": str(picked_pack.get("title") or ""),
            "overview": "",
            "purpose": "",
            "inputs": str((tmpl or {}).get("inputs_json") or ""),
            "rules": rules_text,
            "outputs": str((tmpl or {}).get("outputs_template") or ""),
            "config_v2": a1 if isinstance(a1, dict) else {},
        }

    # v1(legacy)
    rules = (ai_settings or {}).get("analysis_rules") or []
    if not isinstance(rules, list):
        rules = []
    picked: dict | None = None
    for r in rules:
        rid = str((r or {}).get("id") or "").strip().upper().replace(" ", "")
        if rid in ("A-1", "A1"):
            if isinstance(r, dict):
                picked = r
            break
    picked = picked or {}
    return {
        "common_rules": common,
        "rule_id": str(picked.get("id") or "A-1"),
        "title": str(picked.get("title") or ""),
        "overview": str(picked.get("overview") or ""),
        "purpose": str(picked.get("purpose") or ""),
        "inputs": str(picked.get("inputs") or ""),
        "rules": str(picked.get("rules") or ""),
        "outputs": str(picked.get("outputs") or ""),
    }


def _safe_int(v: Any) -> int | None:
    try:
        if v is None:
            return None
        if isinstance(v, bool):
            return int(v)
        return int(v)
    except Exception:
        return None


def _safe_float(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except Exception:
        return None


def _yesterday(d: Date) -> Date:
    return d - timedelta(days=1)

def _safe_num(v: Any, *, default: float = 0.0) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else float(default)
    except Exception:
        return float(default)


def _safe_int0(v: Any, *, default: int = 0) -> int:
    try:
        if v is None:
            return int(default)
        if isinstance(v, bool):
            return int(v)
        return int(v)
    except Exception:
        return int(default)


def _compute_sku_strategy_from_zones(*, zone_today: dict[str, Any] | None, rules_pack: dict[str, Any]) -> dict[str, Any]:
    """
    v2 확장값(sku_strategy)을 실제 payload에 반영하기 위한 결정론 계산.
    - 현재는 zone_counts(today) 기반으로 '브랜드 오가닉 제품'을 우선 판단한다.
    - 광고 매출/품질지수 등은 데이터 소스가 준비되면 동일 패턴으로 확장한다.
    """
    cfg2 = (rules_pack or {}).get("config_v2") or {}
    sku_cfg = (cfg2.get("sku_strategy") if isinstance(cfg2, dict) else None) or {}
    thresholds = (sku_cfg.get("sku_strategy") if isinstance(sku_cfg, dict) else None) or {}
    rank_targets_by_state = (sku_cfg.get("rank_targets_by_state") if isinstance(sku_cfg, dict) else None) or {}

    out: dict[str, Any] = {
        "strategy_type": "unknown",
        "confidence": 0.0,
        "reason": "",
        "inputs": {"zone_today": zone_today},
        "thresholds_used": thresholds,
        "rank_targets_by_state": rank_targets_by_state,
        "candidates": [],
        # Trace 점프용 기본 근거
        "evidence_refs": ["node:SkuZoneCountsDaily", "node:RulesDoc"],
    }

    if not isinstance(zone_today, dict) or not zone_today:
        out["reason"] = "zone_counts(today)가 없어 전략 분류를 계산할 수 없습니다."
        return out

    t13 = _safe_int0(zone_today.get("top1_3_kw_cnt"))
    t710 = _safe_int0(zone_today.get("top7_10_kw_cnt"))

    brand_cfg = thresholds.get("brand_organic_product") if isinstance(thresholds, dict) else None
    if isinstance(brand_cfg, dict):
        min13 = _safe_int0(brand_cfg.get("min_top1_3_kw_cnt"), default=2)
        min710 = _safe_int0(brand_cfg.get("min_top7_10_kw_cnt"), default=0)
        ok_brand = (t13 >= min13) and (t710 >= min710)
        out["candidates"].append(
            {
                "type": "brand_organic_product",
                "ok": bool(ok_brand),
                "why": f"top1~3={t13} (>= {min13}), top7~10={t710} (>= {min710})",
            }
        )
        if ok_brand:
            out["strategy_type"] = "brand_organic_product"
            out["confidence"] = 0.7
            out["reason"] = "상위 오가닉(Top1~3) 키워드 비중이 기준 이상"
            return out

    # 광고 매출 기반 전략은 현재 payload에 데이터가 없어 계산 불가(확장 예정)
    out["candidates"].append(
        {
            "type": "main_ad_revenue_product",
            "ok": False,
            "why": "광고매출 데이터가 payload에 없어 계산 불가",
        }
    )
    out["candidates"].append(
        {
            "type": "sub_ad_revenue_product",
            "ok": False,
            "why": "광고매출 데이터가 payload에 없어 계산 불가",
        }
    )
    out["reason"] = "현재 수집 데이터로는 브랜드 오가닉 조건을 만족하지 않아 unknown 처리"
    return out


def _resolve_product_url_for_sku(db: Session, *, sku_id: str) -> dict[str, Any]:
    """
    sku_id → product_url 매핑(best-effort).
    - 1) sku_id가 URL이면 그대로 사용
    - 2) a1_sku_map 조회
    - 3) sku_id가 숫자면 catalog productId로 보고 tracked_product_meta에서 조회
    """
    sid = str(sku_id or "").strip()
    out: dict[str, Any] = {"ok": False, "sku_id": sid, "product_url": None, "product_id_catalog": None, "source": "none"}
    if not sid:
        return out
    if sid.startswith("http://") or sid.startswith("https://"):
        out.update({"ok": True, "product_url": sid, "source": "sku_id_is_url"})
        return out

    # explicit map
    try:
        row = db.query(A1SkuMap).filter(A1SkuMap.sku_id == sid).one_or_none()
        if row is not None:
            pu = str(getattr(row, "product_url", "") or "").strip() or None
            pid = getattr(row, "product_id_catalog", None)
            out.update({"product_url": pu, "product_id_catalog": (int(pid) if pid is not None else None), "source": "a1_sku_map"})
            if pu:
                out["ok"] = True
                # product_id_catalog 보강
                try:
                    if out.get("product_id_catalog") is None:
                        meta = db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == pu).order_by(TrackedProductMeta.updated_at.desc()).limit(1).one_or_none()
                        if meta is not None:
                            pid2 = getattr(meta, "product_id_catalog", None)
                            if pid2 is not None:
                                out["product_id_catalog"] = int(pid2)
                except Exception:
                    pass
                return out
    except Exception:
        pass

    # numeric sku_id -> catalog id
    if sid.isdigit():
        try:
            pid = int(sid)
            meta = db.query(TrackedProductMeta).filter(TrackedProductMeta.product_id_catalog == pid).order_by(TrackedProductMeta.updated_at.desc()).limit(1).one_or_none()
            if meta is not None:
                pu = str(getattr(meta, "product_url", "") or "").strip() or None
                out.update({"ok": bool(pu), "product_url": pu, "product_id_catalog": pid, "source": "tracked_product_meta"})
                return out
        except Exception:
            pass

    return out


def _compute_quality_trends_14d(
    db: Session,
    *,
    product_url: str | None,
    product_id_catalog: int | None,
    target_date: Date,
) -> dict[str, Any]:
    """
    품질지수 “상승”을 결정론으로 계산한다.
    - 광고 품질지수: naver_ad_creative_daily.quality_index (impressions 가중평균)
      - 최근 7일 vs 직전 7일
    - 오가닉 품질지수: naver_product_review_daily.rating_avg (rating_count 가중평균)
      - 최근 7일 vs 직전 7일
    """
    out: dict[str, Any] = {"ok": True, "as_of": target_date.isoformat(), "ad": None, "organic": None}

    # --- ad quality index trend (needs product_url) ---
    pu = str(product_url or "").strip()
    if pu:
        try:
            sql = (
                "SELECT "
                "SUM(CASE WHEN ad.date BETWEEN :cur_from AND :cur_to AND ad.quality_index IS NOT NULL THEN ad.quality_index * ad.impressions ELSE 0 END) AS cur_wsum, "
                "SUM(CASE WHEN ad.date BETWEEN :cur_from AND :cur_to AND ad.quality_index IS NOT NULL THEN ad.impressions ELSE 0 END) AS cur_w, "
                "SUM(CASE WHEN ad.date BETWEEN :prev_from AND :prev_to AND ad.quality_index IS NOT NULL THEN ad.quality_index * ad.impressions ELSE 0 END) AS prev_wsum, "
                "SUM(CASE WHEN ad.date BETWEEN :prev_from AND :prev_to AND ad.quality_index IS NOT NULL THEN ad.impressions ELSE 0 END) AS prev_w "
                "FROM naver_ad_creative_daily ad "
                "JOIN creative_organic_rank_daily_derived d "
                "  ON ad.date = d.date "
                " AND ad.campaign_name = d.campaign_name "
                " AND ad.adgroup_name = d.adgroup_name "
                " AND ad.creative_id = d.creative_id "
                " AND ad.device = d.device "
                "WHERE ad.date BETWEEN :prev_from AND :cur_to "
                "  AND d.matched_product_url = :product_url"
            )
            cur_to = target_date
            cur_from = target_date - timedelta(days=6)
            prev_to = target_date - timedelta(days=7)
            prev_from = target_date - timedelta(days=13)
            r = db.execute(
                text(sql),
                {
                    "cur_from": cur_from,
                    "cur_to": cur_to,
                    "prev_from": prev_from,
                    "prev_to": prev_to,
                    "product_url": pu,
                },
            ).mappings().one_or_none()
            if r:
                cur_w = float(r.get("cur_w") or 0)
                prev_w = float(r.get("prev_w") or 0)
                cur = (float(r.get("cur_wsum") or 0) / cur_w) if cur_w > 0 else None
                prev = (float(r.get("prev_wsum") or 0) / prev_w) if prev_w > 0 else None
                out["ad"] = {
                    "metric": "quality_index_wavg",
                    "cur_7d": cur,
                    "prev_7d": prev,
                    "delta": (cur - prev) if (cur is not None and prev is not None) else None,
                    "cur_weight": int(cur_w),
                    "prev_weight": int(prev_w),
                }
            else:
                out["ad"] = {"metric": "quality_index_wavg", "cur_7d": None, "prev_7d": None, "delta": None}
        except Exception as e:
            out["ad"] = {"metric": "quality_index_wavg", "error": f"QUERY_FAILED:{e}"}

    # --- organic quality index trend (uses product_id_catalog) ---
    pid = int(product_id_catalog) if product_id_catalog is not None else None
    if pid is not None:
        try:
            sql = (
                "SELECT "
                "SUM(CASE WHEN date BETWEEN :cur_from AND :cur_to THEN rating_avg * rating_count ELSE 0 END) AS cur_wsum, "
                "SUM(CASE WHEN date BETWEEN :cur_from AND :cur_to THEN rating_count ELSE 0 END) AS cur_w, "
                "SUM(CASE WHEN date BETWEEN :prev_from AND :prev_to THEN rating_avg * rating_count ELSE 0 END) AS prev_wsum, "
                "SUM(CASE WHEN date BETWEEN :prev_from AND :prev_to THEN rating_count ELSE 0 END) AS prev_w "
                "FROM naver_product_review_daily "
                "WHERE date BETWEEN :prev_from AND :cur_to AND product_id = :pid"
            )
            cur_to = target_date
            cur_from = target_date - timedelta(days=6)
            prev_to = target_date - timedelta(days=7)
            prev_from = target_date - timedelta(days=13)
            r = db.execute(text(sql), {"cur_from": cur_from, "cur_to": cur_to, "prev_from": prev_from, "prev_to": prev_to, "pid": pid}).mappings().one_or_none()
            if r:
                cur_w = float(r.get("cur_w") or 0)
                prev_w = float(r.get("prev_w") or 0)
                cur = (float(r.get("cur_wsum") or 0) / cur_w) if cur_w > 0 else None
                prev = (float(r.get("prev_wsum") or 0) / prev_w) if prev_w > 0 else None
                out["organic"] = {
                    "metric": "rating_avg_wavg",
                    "cur_7d": cur,
                    "prev_7d": prev,
                    "delta": (cur - prev) if (cur is not None and prev is not None) else None,
                    "cur_weight": int(cur_w),
                    "prev_weight": int(prev_w),
                }
            else:
                out["organic"] = {"metric": "rating_avg_wavg", "cur_7d": None, "prev_7d": None, "delta": None}
        except Exception as e:
            out["organic"] = {"metric": "rating_avg_wavg", "error": f"QUERY_FAILED:{e}"}

    return out


def _compute_action_hints(*, derived: dict[str, Any], rules_doc: dict[str, Any]) -> list[dict[str, Any]]:
    """
    결정론 액션 템플릿.
    - 운영자가 설정한 기준 숫자(config_v2) + derived(전략/광고지표/품질지수Δ)에 기반해
      "우선 액션 후보"를 구조화로 생성한다.
    - GPT는 이를 우선순위/설명 보강 용도로 사용한다.
    """
    cfg2 = (rules_doc.get("config_v2") if isinstance(rules_doc, dict) else None) or {}
    qt_cfg = (cfg2.get("quality_targets") if isinstance(cfg2, dict) else None) or {}

    out: list[dict[str, Any]] = []

    def _add(title: str, why: str, how: str, priority: str, refs: list[str]) -> None:
        out.append({"title": title, "why": why, "how": how, "priority": priority, "evidence_refs": refs})

    strategy = (derived.get("sku_strategy") if isinstance(derived, dict) else None) or {}
    adm = (derived.get("ad_metrics_30d") if isinstance(derived, dict) else None) or {}
    qtrend = (derived.get("quality_trends_14d") if isinstance(derived, dict) else None) or {}

    stype = str((strategy.get("strategy_type") if isinstance(strategy, dict) else "") or "").strip()

    # quality thresholds
    ad_min = _safe_num(qt_cfg.get("ad_quality_index_min") if isinstance(qt_cfg, dict) else None, default=0.0)
    ad_inc_min = _safe_num(qt_cfg.get("ad_quality_index_increase_min") if isinstance(qt_cfg, dict) else None, default=0.0)
    org_min = _safe_num(qt_cfg.get("organic_quality_index_min") if isinstance(qt_cfg, dict) else None, default=0.0)
    org_inc_min = _safe_num(qt_cfg.get("organic_quality_index_increase_min") if isinstance(qt_cfg, dict) else None, default=0.0)

    # ad quality signals
    q30 = None
    try:
        q30 = float(adm.get("quality_index_wavg_30d")) if isinstance(adm, dict) and adm.get("quality_index_wavg_30d") is not None else None
    except Exception:
        q30 = None
    ad_delta = None
    if isinstance(qtrend, dict) and isinstance(qtrend.get("ad"), dict):
        try:
            ad_delta = (float((qtrend.get("ad") or {}).get("delta")) if (qtrend.get("ad") or {}).get("delta") is not None else None)
        except Exception:
            ad_delta = None

    if (q30 is not None and ad_min > 0 and q30 < ad_min) or (ad_delta is not None and ad_inc_min > 0 and ad_delta < ad_inc_min):
        _add(
            "광고 품질지수 개선",
            "광고 품질지수(노출 가중평균)가 목표 기준에 미달",
            "소재/키워드/랜딩(상품정보·이미지·가격·리뷰) 정합성 개선, CTR/CVR 개선 테스트",
            "P0",
            ["node:AdMetrics30d", "node:QualityTrends14d", "node:RulesDoc"],
        )

    # organic quality signals (review rating)
    org_delta = None
    org_cur = None
    if isinstance(qtrend, dict) and isinstance(qtrend.get("organic"), dict):
        try:
            org_delta = (float((qtrend.get("organic") or {}).get("delta")) if (qtrend.get("organic") or {}).get("delta") is not None else None)
        except Exception:
            org_delta = None
        try:
            org_cur = (float((qtrend.get("organic") or {}).get("cur_7d")) if (qtrend.get("organic") or {}).get("cur_7d") is not None else None)
        except Exception:
            org_cur = None

    if (org_cur is not None and org_min > 0 and org_cur < org_min) or (org_delta is not None and org_inc_min > 0 and org_delta < org_inc_min):
        _add(
            "리뷰/평점 개선",
            "오가닉 품질지수(리뷰/평점)가 목표 기준에 미달",
            "리뷰 확보(구매자 메시지/혜택), CS/배송 품질 개선, 상세페이지 신뢰 요소 강화",
            "P0",
            ["node:QualityTrends14d", "node:RulesDoc"],
        )

    # strategy actions
    if stype == "main_ad_revenue_product":
        _add(
            "주력 광고 상품 방어/확대",
            "광고매출 기여도가 큰 SKU로 분류됨",
            "성과 하락 방지(입찰/소재/키워드) + 확장 실험(신규 키워드·소재 A/B)",
            "P0",
            ["node:SkuStrategy", "node:AdMetrics30d", "node:RulesDoc"],
        )
    elif stype == "sub_ad_revenue_product":
        _add(
            "보조 광고 상품 효율 개선",
            "보조 매출 SKU로 분류됨(확대 여지)",
            "비효율 키워드 정리 + 고효율 키워드 확장 + 소재 개선",
            "P1",
            ["node:SkuStrategy", "node:AdMetrics30d", "node:RulesDoc"],
        )
    elif stype == "brand_organic_product":
        _add(
            "브랜드 오가닉 상위권 방어",
            "상위 오가닉 키워드 비중이 높아 방어 가치가 큼",
            "상위 키워드 유지(리뷰/가격/재고/카테고리) + 경쟁 모니터링",
            "P1",
            ["node:SkuStrategy", "node:SkuZoneCountsDaily", "node:RulesDoc"],
        )

    if not out:
        _add(
            "상품정보/키워드 정합성 점검",
            "명확한 전략/품질 신호가 부족해 기본 점검을 권장",
            "대표키워드·카테고리·속성·이미지·가격·리뷰 기본 품질 점검",
            "P1",
            ["node:AutomationResult", "node:RulesDoc"],
        )

    return out[:5]


def _compute_ad_metrics_for_product_url(
    db: Session,
    *,
    product_url: str,
    date_from: Date,
    date_to: Date,
) -> dict[str, Any]:
    """
    광고 지표(30일) 집계.
    - naver_ad_creative_daily + creative_organic_rank_daily_derived 를 조인해
      matched_product_url 기준으로 해당 상품의 광고 매출/비용/노출/품질지수(가중평균)를 계산한다.
    """
    pu = str(product_url or "").strip()
    if not pu:
        return {"ok": False, "reason": "NO_PRODUCT_URL"}

    sql = (
        "SELECT "
        "COALESCE(SUM(ad.revenue), 0) AS revenue_sum, "
        "COALESCE(SUM(ad.cost), 0) AS cost_sum, "
        "COALESCE(SUM(ad.impressions), 0) AS impressions_sum, "
        "COALESCE(SUM(ad.clicks), 0) AS clicks_sum, "
        "CASE "
        "WHEN SUM(CASE WHEN ad.quality_index IS NOT NULL THEN ad.impressions ELSE 0 END) > 0 "
        "THEN (SUM(CASE WHEN ad.quality_index IS NOT NULL THEN ad.quality_index * ad.impressions ELSE 0 END) * 1.0) "
        "     / SUM(CASE WHEN ad.quality_index IS NOT NULL THEN ad.impressions ELSE 0 END) "
        "ELSE NULL "
        "END AS quality_index_wavg "
        "FROM naver_ad_creative_daily ad "
        "JOIN creative_organic_rank_daily_derived d "
        "  ON ad.date = d.date "
        " AND ad.campaign_name = d.campaign_name "
        " AND ad.adgroup_name = d.adgroup_name "
        " AND ad.creative_id = d.creative_id "
        " AND ad.device = d.device "
        "WHERE ad.date BETWEEN :date_from AND :date_to "
        "  AND d.matched_product_url = :product_url"
    )
    try:
        r = db.execute(text(sql), {"date_from": date_from, "date_to": date_to, "product_url": pu}).mappings().one_or_none()
        if not r:
            return {"ok": True, "product_url": pu, "date_from": str(date_from), "date_to": str(date_to), "revenue_30d": 0, "cost_30d": 0, "impressions_30d": 0, "clicks_30d": 0, "quality_index_wavg_30d": None}
        return {
            "ok": True,
            "product_url": pu,
            "date_from": str(date_from),
            "date_to": str(date_to),
            "revenue_30d": int(r.get("revenue_sum") or 0),
            "cost_30d": int(r.get("cost_sum") or 0),
            "impressions_30d": int(r.get("impressions_sum") or 0),
            "clicks_30d": int(r.get("clicks_sum") or 0),
            "quality_index_wavg_30d": (float(r.get("quality_index_wavg")) if r.get("quality_index_wavg") is not None else None),
        }
    except Exception as e:
        return {"ok": False, "product_url": pu, "reason": f"QUERY_FAILED:{e}"}

def pick_target_skus(
    db: Session,
    *,
    target_date: Date,
    surface: str,
    severities: list[Severity],
    max_items: int,
) -> list[str]:
    """
    오늘(=target_date) 발생한 HIGH/CRITICAL 이벤트가 있는 SKU만 대상으로 선택한다.
    """
    sev_set = {str(s or "").strip().upper() for s in (severities or []) if str(s or "").strip()}
    if not sev_set:
        sev_set = {"HIGH", "CRITICAL"}

    rows = (
        db.query(A1SkuEventDaily.sku_id, A1SkuEventDaily.severity)
        .filter(
            A1SkuEventDaily.date == target_date,
            A1SkuEventDaily.surface == surface,
            A1SkuEventDaily.severity.in_(sorted(sev_set)),
        )
        .all()
    )
    if not rows:
        return []

    severity_rank = {"CRITICAL": 2, "HIGH": 1, "MEDIUM": 0, "LOW": 0}
    best: dict[str, int] = {}
    for sku_id, sev in rows:
        sid = str(sku_id or "").strip()
        if not sid:
            continue
        r = severity_rank.get(str(sev or "").strip().upper(), 0)
        best[sid] = max(best.get(sid, 0), r)

    ordered = sorted(best.items(), key=lambda x: (-x[1], x[0]))
    return [sku for sku, _r in ordered][: int(max_items or 50)]


def _a1_trace_build_for_no_data_run(
    db: Session,
    *,
    run_id: str,
    target_date: Date,
    surface: str,
    req: A1BatchRunRequest,
) -> None:
    """
    NO_DATA(run-level) trace.
    - 후보 SKU가 0개일 때도 사용자가 "무엇이 없어서 비었는지"를 검증할 수 있게,
      최소한의 트리(원본조회/규칙문서/요약)를 남긴다.
    """
    rid = str(run_id or "").strip()
    if not rid:
        return
    sid = "__RUN__"

    # 1) rules doc snapshot (검증은 아니지만, 기준 숫자 확인용)
    try:
        rules_doc = _pick_a1_rule_pack(db) or {}
    except Exception:
        rules_doc = {}
    rules_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(rules_doc))
    n_rules = create_node(
        db,
        run_id=rid,
        sku_id=sid,
        node_type="RulesDoc",
        title="규칙 문서(A-1)",
        summary_md="AI 세팅 기반 규칙/임계값 스냅샷",
        sort_key=20,
        tags={"alias": "RulesDoc"},
        blob=rules_blob,
    )

    # 2) raw events query (verify 가능)
    qsql = "SELECT date, surface, sku_id, severity, event_type FROM sku_event_daily WHERE date = :date AND surface = :surface"
    qparams = {"date": target_date, "surface": surface}
    rows: list[dict[str, Any]] = []
    try:
        res = db.execute(text(qsql), qparams)
        for r in res.mappings().all():
            rows.append({k: r.get(k) for k in sorted(r.keys())})
    except Exception:
        rows = []
    ev_txt = canonical_json_dumps(rows)
    ev_blob = upsert_blob(db, content_type="json", content_text=ev_txt)
    n_ev = create_node(
        db,
        run_id=rid,
        sku_id=sid,
        node_type="TargetEventsQuery",
        title="대상 이벤트 조회(원본)",
        summary_md="sku_event_daily에서 대상 이벤트(원본)를 조회",
        sort_key=10,
        tags={"alias": "TargetEventsQuery"},
        query_sql=qsql,
        query_params=qparams,
        blob=ev_blob,
    )

    # 3) summary (actionable)
    summary = {
        "status": "NO_DATA",
        "reason": "NO_TARGET_EVENTS",
        "target_date": target_date.isoformat(),
        "surface": surface,
        "severities": list(req.severities or []),
        "max_items": int(req.max_items or 0),
        "event_rows": len(rows),
        "target_skus": [],
        "what_to_do": [
            "내 상품 추적에 상품을 등록하고(또는 수집 파이프라인을 실행해) sku_event_daily가 생성되는지 확인",
            "대상 날짜/지면(surface)을 바꿔 재시도",
            "severities(HIGH/CRITICAL) 기준이 너무 강하면 완화(추후 UI에서 제공 가능)",
        ],
    }
    s_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(summary))
    n_sum = create_node(
        db,
        run_id=rid,
        sku_id=sid,
        node_type="NoDataSummary",
        title="NO_DATA: 대상 SKU 없음",
        summary_md="대상 이벤트가 없어 배치 대상이 0개입니다. 원본 조회 노드를 검증(재계산)할 수 있습니다.",
        sort_key=0,
        tags={"alias": "NoDataSummary"},
        blob=s_blob,
    )

    create_edge(db, run_id=rid, from_node_id=n_sum.node_id, to_node_id=n_ev.node_id, edge_type="uses", label="원본조회")
    create_edge(db, run_id=rid, from_node_id=n_sum.node_id, to_node_id=n_rules.node_id, edge_type="uses", label="규칙")

def build_gpt_payload(
    db: Session,
    *,
    target_date: Date,
    surface: str,
    sku_id: str,
    action_version: str,
    max_keywords: int = 12,
) -> dict[str, Any]:
    """
    자동화(결정론)에서 만든 결과만으로 GPT 입력 payload_json을 구성한다.
    - GPT는 '판정/재분류'가 아니라 '원인 후보 + 실행 전략 + 설명'만 수행한다.
    """
    sid = str(sku_id or "").strip()
    if not sid:
        raise ValueError("sku_id is required")

    state = (
        db.query(A1SkuStateDaily)
        .filter(A1SkuStateDaily.date == target_date, A1SkuStateDaily.surface == surface, A1SkuStateDaily.sku_id == sid)
        .one_or_none()
    )
    zones_today = (
        db.query(A1SkuZoneCountsDaily)
        .filter(A1SkuZoneCountsDaily.date == target_date, A1SkuZoneCountsDaily.surface == surface, A1SkuZoneCountsDaily.sku_id == sid)
        .one_or_none()
    )
    zones_yday = (
        db.query(A1SkuZoneCountsDaily)
        .filter(A1SkuZoneCountsDaily.date == _yesterday(target_date), A1SkuZoneCountsDaily.surface == surface, A1SkuZoneCountsDaily.sku_id == sid)
        .one_or_none()
    )
    cause = (
        db.query(A1SkuCauseEvidenceDaily)
        .filter(A1SkuCauseEvidenceDaily.date == target_date, A1SkuCauseEvidenceDaily.surface == surface, A1SkuCauseEvidenceDaily.sku_id == sid)
        .one_or_none()
    )
    events = (
        db.query(A1SkuEventDaily)
        .filter(A1SkuEventDaily.date == target_date, A1SkuEventDaily.surface == surface, A1SkuEventDaily.sku_id == sid)
        .order_by(A1SkuEventDaily.severity.desc(), A1SkuEventDaily.event_type.asc())
        .all()
    )

    kw_rows = (
        db.query(A1SkuKeywordEvidenceDaily)
        .filter(A1SkuKeywordEvidenceDaily.date == target_date, A1SkuKeywordEvidenceDaily.surface == surface, A1SkuKeywordEvidenceDaily.sku_id == sid)
        .order_by(
            A1SkuKeywordEvidenceDaily.is_consecutive_drop_3d.desc(),
            A1SkuKeywordEvidenceDaily.rank_delta_1d.desc().nullslast(),
            A1SkuKeywordEvidenceDaily.rank_today.asc().nullslast(),
        )
        .limit(int(max_keywords))
        .all()
    )

    def _zones_row(z: A1SkuZoneCountsDaily | None) -> dict[str, Any] | None:
        if z is None:
            return None
        return {
            "decision_kw_total": int(getattr(z, "decision_kw_total", 0) or 0),
            "top1_3_kw_cnt": int(getattr(z, "top1_3_kw_cnt", 0) or 0),
            "top4_6_kw_cnt": int(getattr(z, "top4_6_kw_cnt", 0) or 0),
            "top7_10_kw_cnt": int(getattr(z, "top7_10_kw_cnt", 0) or 0),
            "top11_15_kw_cnt": int(getattr(z, "top11_15_kw_cnt", 0) or 0),
            "below16_kw_cnt": int(getattr(z, "below16_kw_cnt", 0) or 0),
            "avg_rank_decision_kw": _safe_float(getattr(z, "avg_rank_decision_kw", None)),
        }

    zt = _zones_row(zones_today)
    zy = _zones_row(zones_yday)
    delta: dict[str, int] = {}
    if zt and zy:
        for k in ("top1_3_kw_cnt", "top4_6_kw_cnt", "top7_10_kw_cnt", "top11_15_kw_cnt", "below16_kw_cnt", "decision_kw_total"):
            delta[k] = int(zt.get(k, 0) or 0) - int(zy.get(k, 0) or 0)

    # 규칙 문서(A-1)도 함께 포함(재현/설명/검증용)
    rules_pack = _pick_a1_rule_pack(db)

    derived_strategy = _compute_sku_strategy_from_zones(zone_today=zt, rules_pack=rules_pack)
    sku_map = _resolve_product_url_for_sku(db, sku_id=sid)
    ad_metrics_30d: dict[str, Any] | None = None
    try:
        if bool(sku_map.get("ok")) and str(sku_map.get("product_url") or "").strip():
            ad_metrics_30d = _compute_ad_metrics_for_product_url(
                db,
                product_url=str(sku_map.get("product_url") or ""),
                date_from=(target_date - timedelta(days=29)),
                date_to=target_date,
            )
    except Exception:
        ad_metrics_30d = None

    # 광고 매출 기반 전략(주력/보조) 반영 (데이터가 있을 때만)
    try:
        cfg2 = (rules_pack or {}).get("config_v2") or {}
        sku_cfg = (cfg2.get("sku_strategy") if isinstance(cfg2, dict) else None) or {}
        ths = (sku_cfg.get("sku_strategy") if isinstance(sku_cfg, dict) else None) or {}
        main_th = (ths.get("main_ad_revenue_product") if isinstance(ths, dict) else None) or {}
        sub_th = (ths.get("sub_ad_revenue_product") if isinstance(ths, dict) else None) or {}
        rev = int(((ad_metrics_30d or {}).get("revenue_30d") or 0)) if isinstance(ad_metrics_30d, dict) else 0
        min_main = _safe_int0(main_th.get("min_ad_revenue_30d"), default=1000000) if isinstance(main_th, dict) else 1000000
        min_sub = _safe_int0(sub_th.get("min_ad_revenue_30d"), default=300000) if isinstance(sub_th, dict) else 300000
        if rev >= min_main:
            derived_strategy = {
                **derived_strategy,
                "strategy_type": "main_ad_revenue_product",
                "confidence": max(float(derived_strategy.get("confidence") or 0.0), 0.8),
                "reason": f"30일 광고매출 {rev:,}원 (>= {min_main:,}원) 기준 충족",
                "evidence_refs": ["node:AdMetrics30d", "node:RulesDoc"],
            }
        elif rev >= min_sub:
            derived_strategy = {
                **derived_strategy,
                "strategy_type": "sub_ad_revenue_product",
                "confidence": max(float(derived_strategy.get("confidence") or 0.0), 0.6),
                "reason": f"30일 광고매출 {rev:,}원 (>= {min_sub:,}원) 기준 충족",
                "evidence_refs": ["node:AdMetrics30d", "node:RulesDoc"],
            }
    except Exception:
        cfg2 = (rules_pack or {}).get("config_v2") or {}

    quality_trends_14d: dict[str, Any] | None = None
    try:
        quality_trends_14d = _compute_quality_trends_14d(
            db,
            product_url=(str(sku_map.get("product_url") or "") if isinstance(sku_map, dict) else None),
            product_id_catalog=(int(sku_map.get("product_id_catalog")) if isinstance(sku_map, dict) and sku_map.get("product_id_catalog") is not None else None),
            target_date=target_date,
        )
    except Exception:
        quality_trends_14d = None

    # 품질지수 “상승” 목표를 전략 근거로 반영(참조)
    try:
        qt = ((cfg2 or {}).get("quality_targets") if isinstance(cfg2, dict) else None) or {}
        if isinstance(qt, dict) and isinstance(quality_trends_14d, dict):
            ad_delta = ((quality_trends_14d.get("ad") or {}).get("delta") if isinstance(quality_trends_14d.get("ad"), dict) else None)
            org_delta = ((quality_trends_14d.get("organic") or {}).get("delta") if isinstance(quality_trends_14d.get("organic"), dict) else None)
            ad_min = float(qt.get("ad_quality_index_increase_min") or 0.0)
            org_min = float(qt.get("organic_quality_index_increase_min") or 0.0)
            if (ad_delta is not None and float(ad_delta) >= ad_min) or (org_delta is not None and float(org_delta) >= org_min):
                # 전략 정보는 유지하되, “품질 개선 신호”를 메모로 추가
                derived_strategy = {
                    **derived_strategy,
                    "quality_signal": {
                        "ad_delta": ad_delta,
                        "organic_delta": org_delta,
                        "thresholds": {"ad_quality_index_increase_min": ad_min, "organic_quality_index_increase_min": org_min},
                    },
                    "evidence_refs": sorted(set(list(derived_strategy.get("evidence_refs") or []) + ["node:QualityTrends14d", "node:RulesDoc"])),
                }
    except Exception:
        pass

    derived = {
        "sku_strategy": derived_strategy,
        "sku_map": sku_map,
        "ad_metrics_30d": ad_metrics_30d,
        "quality_trends_14d": quality_trends_14d,
        "quality_targets": ((cfg2 or {}).get("quality_targets") if isinstance(cfg2, dict) else None),
        "surfaces": ((cfg2 or {}).get("surfaces") if isinstance(cfg2, dict) else None),
    }
    # 결정론 액션 템플릿(LLM fallback + Trace)
    try:
        derived["action_hints"] = _compute_action_hints(derived=derived, rules_doc=rules_pack)
    except Exception:
        derived["action_hints"] = []

    payload = {
        "analysis_type": "A-1",
        "date": target_date.isoformat(),
        "surface": surface,
        "sku_id": sid,
        "action_version": str(action_version or "A1_V1"),
        "rules_doc": rules_pack,
        "derived": derived,
        "automation_result": {
            "current_state": str(getattr(state, "state", "") or ""),
            "state_reasons": (json.loads(getattr(state, "reasons_json", "") or "null") if getattr(state, "reasons_json", None) else None),
            "zone_counts": {
                "today": zt,
                "yesterday": zy,
                "delta": delta if delta else None,
            },
            "events": [
                {
                    "event_type": str(getattr(e, "event_type", "") or ""),
                    "severity": str(getattr(e, "severity", "") or ""),
                    "payload": (json.loads(getattr(e, "payload_json", "") or "null") if getattr(e, "payload_json", None) else None),
                }
                for e in (events or [])
            ],
        },
        "numeric_evidence": {
            "sku": {
                "decision_kw_total": int(getattr(cause, "decision_kw_total", 0) or 0) if cause is not None else None,
                "drop_kw_cnt_1d": int(getattr(cause, "drop_kw_cnt_1d", 0) or 0) if cause is not None else None,
                "avg_drop_1d": _safe_float(getattr(cause, "avg_drop_1d", None)) if cause is not None else None,
                "consecutive_drop_3d_kw_cnt": int(getattr(cause, "consecutive_drop_3d_kw_cnt", 0) or 0) if cause is not None else None,
                "cannibal_kw_cnt": int(getattr(cause, "cannibal_kw_cnt", 0) or 0) if cause is not None else None,
                "cannibal_kw_drop_cnt": int(getattr(cause, "cannibal_kw_drop_cnt", 0) or 0) if cause is not None else None,
                "evidence": (json.loads(getattr(cause, "evidence_json", "") or "null") if cause is not None and getattr(cause, "evidence_json", None) else None),
            },
            "keywords": [
                {
                    "keyword": str(getattr(k, "keyword", "") or ""),
                    "rank_today": _safe_int(getattr(k, "rank_today", None)),
                    "rank_yesterday": _safe_int(getattr(k, "rank_yesterday", None)),
                    "rank_7d_ago": _safe_int(getattr(k, "rank_7d_ago", None)),
                    "rank_delta_1d": _safe_int(getattr(k, "rank_delta_1d", None)),
                    "rank_delta_7d": _safe_int(getattr(k, "rank_delta_7d", None)),
                    "is_consecutive_drop_3d": bool(getattr(k, "is_consecutive_drop_3d", False) or False),
                    "monthly_search_volume": _safe_int(getattr(k, "monthly_search_volume", None)),
                    "is_cannibal": bool(getattr(k, "is_cannibal", False) or False),
                    "cannibal_evidence": (json.loads(getattr(k, "cannibal_evidence_json", "") or "null") if getattr(k, "cannibal_evidence_json", None) else None),
                }
                for k in (kw_rows or [])
                if str(getattr(k, "keyword", "") or "").strip()
            ],
        },
        "role_boundary": {
            "automation_role": "상태/이벤트/근거수치 생성(결정론, 재현 가능)",
            "gpt_role": "근거 수치 기반 원인 후보/우선 액션/설명서 생성(단정 금지, 규칙 재판정 금지)",
        },
        "requested_at": datetime.utcnow().isoformat() + "Z",
    }

    return payload


def call_openai_for_a1(
    *,
    api_key: str,
    model: str,
    payload_json: dict[str, Any],
    timeout_sec: int = 60,
) -> dict[str, Any]:
    """
    OpenAI chat.completions 호출.
    - 출력은 반드시 JSON 한 덩어리(문자열)로 오도록 강제하고, 파싱 실패 시 예외를 던진다.
    """
    key = str(api_key or "").strip()
    if not key:
        raise ValueError("OPENAI_API_KEY is required")

    sys = (
        "너는 오가닉 순위 운영 분석가다.\n"
        "반드시 입력 payload_json의 숫자 근거만 사용하고, 없는 사실을 단정하지 마라.\n"
        "상태/이벤트를 재판정하지 말고(권한 없음), 가능한 원인 후보(가능성)와 실행 전략만 제시하라.\n"
        "특히 payload_json.derived.sku_strategy(결정론 계산 결과)와 payload_json.rules_doc.config_v2(운영자가 조정한 기준 숫자)를 최우선으로 반영하라.\n"
        "품질지수(광고/오가닉) 개선 신호는 payload_json.derived.quality_trends_14d를 참고하고, 목표 임계값은 payload_json.rules_doc.config_v2.quality_targets를 참고하라.\n"
        "가능하면 payload_json.derived.action_hints(서버가 생성한 우선 액션 템플릿)를 그대로 채택/보강하라.\n"
        "각 주장/액션은 반드시 evidence_refs(근거 참조)를 포함해야 한다.\n"
        "출력은 JSON 한 덩어리로만 반환한다(설명 텍스트 금지).\n"
        "출력 스키마(필수 키):\n"
        "{"
        "\"current_state\":string,"
        "\"events\":array,"
        "\"cause_analysis\":{"
        "\"primary_cause\":string,"
        "\"hypotheses\":[{\"hypothesis\":string,\"evidence\":[string],\"confidence\":0~1,\"evidence_refs\":[string]}],"
        "\"notes\":[string]"
        "},"
        "\"recommended_actions\":[{\"title\":string,\"why\":string,\"how\":string,\"priority\":\"P0|P1|P2\",\"evidence_refs\":[string]}],"
        "\"confidence\":0~1"
        "}\n"
        "evidence_refs 규칙:\n"
        "- 노드 참조: \"node:<alias>\" (예: node:AutomationResult, node:SkuEventDaily)\n"
        "- 키워드 참조: \"kw:<keyword>\" (예: kw:새치염색약)\n"
        "- 전략 참조: \"node:SkuStrategy\" (derived.sku_strategy)\n"
        "- 품질지수 참조: \"node:QualityTrends14d\" (derived.quality_trends_14d)\n"
        "용어는 한글+괄호 보조설명으로 설명하라(예: 카니발(광고·오가닉 겹침))."
    )

    req = {
        "model": (str(model or "").strip() or "gpt-5.2"),
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": "다음 payload_json을 근거로 결과 JSON만 반환해줘.\n" + _json_dumps(payload_json, limit=20000)},
        ],
    }

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=req,
        timeout=int(timeout_sec),
    )
    if int(getattr(resp, "status_code", 0) or 0) != 200:
        raise RuntimeError(f"openai_failed:{getattr(resp,'status_code',None)}:{str(getattr(resp,'text','') or '')[:300]}")

    body = resp.json()
    content = (((body or {}).get("choices") or [{}])[0].get("message") or {}).get("content")
    txt = str(content or "").strip()
    if not txt:
        raise RuntimeError("openai_empty_content")

    try:
        out = json.loads(txt)
        if not isinstance(out, dict):
            return {"error": "openai_output_not_object", "raw": out}
        return normalize_a1_result_with_evidence_refs(out, payload_json)
    except Exception as e:
        raise RuntimeError(f"openai_json_parse_failed:{e}:{txt[:200]}")


def normalize_a1_result_with_evidence_refs(result: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """
    구조적 안전장치(장기 안정):
    - 모델 출력이 규격을 어겨 evidence_refs가 누락되더라도 UI '왜?'가 깨지지 않게 보정한다.
    - 단정/조작이 아니라 '참조 링크'만 최소 보강한다.
    """
    out = dict(result or {})
    keywords = []
    try:
        keywords = [str(x.get("keyword") or "").strip() for x in ((payload.get("numeric_evidence") or {}).get("keywords") or []) if str(x.get("keyword") or "").strip()]
    except Exception:
        keywords = []
    first_kw = keywords[0] if keywords else ""

    def _norm_refs(v: Any, *, default: list[str]) -> list[str]:
        if isinstance(v, list):
            refs = [str(x).strip() for x in v if str(x).strip()]
            return refs if refs else default
        return default

    # hypotheses
    ca = out.get("cause_analysis")
    if not isinstance(ca, dict):
        ca = {}
        out["cause_analysis"] = ca
    hyps = ca.get("hypotheses")
    if not isinstance(hyps, list):
        hyps = []
        ca["hypotheses"] = hyps
    for h in hyps:
        if not isinstance(h, dict):
            continue
        h["evidence_refs"] = _norm_refs(h.get("evidence_refs"), default=([f"kw:{first_kw}"] if first_kw else ["node:SkuKeywordEvidenceDaily"]))

    # actions
    acts = out.get("recommended_actions")
    if not isinstance(acts, list):
        acts = []
        out["recommended_actions"] = acts
    for a in acts:
        if not isinstance(a, dict):
            continue
        a["evidence_refs"] = _norm_refs(a.get("evidence_refs"), default=["node:AutomationResult"])

    # 모델이 액션을 비워도 UX/운영이 끊기지 않도록, 서버의 결정론 action_hints로 최소 보강한다.
    try:
        cur_acts = out.get("recommended_actions")
        if isinstance(cur_acts, list) and len(cur_acts) == 0:
            hints = (((payload.get("derived") or {}).get("action_hints")) if isinstance(payload.get("derived"), dict) else None) or []
            if isinstance(hints, list) and hints:
                out["recommended_actions"] = [x for x in hints if isinstance(x, dict)][:3]
    except Exception:
        pass

    return out


def upsert_gpt_action_daily(
    db: Session,
    *,
    target_date: Date,
    surface: str,
    sku_id: str,
    action_version: str,
    payload_json: dict[str, Any],
    result_json: dict[str, Any] | None,
    model: str,
    status: str,
    error: str | None,
) -> None:
    """
    gpt_action_daily 저장(동일 PK면 overwrite).
    - SQLite/테스트에서도 안전하게 동작하도록 text upsert를 사용한다.
    """
    sid = str(sku_id or "").strip()
    if not sid:
        raise ValueError("sku_id is required")

    record = {
        "date": target_date,
        "surface": surface,
        "sku_id": sid,
        "action_version": str(action_version or "A1_V1"),
        "payload_json": _json_dumps(payload_json, limit=None),
        "result_json": (_json_dumps(result_json, limit=None) if result_json is not None else None),
        "model": str(model or "").strip() or None,
        "status": str(status or "").strip() or "PENDING",
        "error": (str(error or "").strip()[:1000] if error else None),
        "updated_at": datetime.utcnow(),
    }

    dialect = None
    try:
        dialect = db.get_bind().dialect.name  # type: ignore[attr-defined]
    except Exception:
        dialect = None

    if dialect == "postgresql":
        stmt = text(
            "INSERT INTO gpt_action_daily(date, surface, sku_id, action_version, payload_json, result_json, model, status, error, updated_at) "
            "VALUES (:date, :surface, :sku_id, :action_version, :payload_json, :result_json, :model, :status, :error, :updated_at) "
            "ON CONFLICT (date, surface, sku_id, action_version) DO UPDATE SET "
            "payload_json = EXCLUDED.payload_json, "
            "result_json = EXCLUDED.result_json, "
            "model = EXCLUDED.model, "
            "status = EXCLUDED.status, "
            "error = EXCLUDED.error, "
            "updated_at = EXCLUDED.updated_at"
        )
        db.execute(stmt, record)
        db.commit()
        return

    # SQLite(테스트) 폴백: ORM merge
    row = (
        db.query(A1GptActionDaily)
        .filter(
            A1GptActionDaily.date == target_date,
            A1GptActionDaily.surface == surface,
            A1GptActionDaily.sku_id == sid,
            A1GptActionDaily.action_version == str(action_version or "A1_V1"),
        )
        .one_or_none()
    )
    if row is None:
        row = A1GptActionDaily(date=target_date, surface=surface, sku_id=sid, action_version=str(action_version or "A1_V1"))
        db.add(row)
    row.payload_json = record["payload_json"]
    row.result_json = record["result_json"]
    row.model = record["model"]
    row.status = record["status"]
    row.error = record["error"]
    try:
        row.updated_at = datetime.utcnow()
    except Exception:
        pass
    db.commit()


@dataclass(frozen=True)
class A1BatchResult:
    target_skus: list[str]
    processed: int
    saved: int
    failed: int
    items: list[dict[str, Any]]
    trace_run_id: str | None = None


def _a1_trace_build_for_sku(
    db: Session,
    *,
    run_id: str,
    target_date: Date,
    surface: str,
    sku_id: str,
    payload: dict[str, Any],
    result: dict[str, Any] | None,
    error: str | None,
) -> None:
    """
    한 SKU에 대한 Trace DAG를 저장한다.
    - alias(tags_json)를 넣어 GPT evidence_refs(\"node:<alias>\", \"kw:<keyword>\")로 점프 가능하게 만든다.
    """
    sid = str(sku_id or "").strip()
    if not sid:
        return

    # blobs(dedupe)
    payload_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(payload))
    result_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(result or {"error": error or "no_result"}))

    rules_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(payload.get("rules_doc") or {}))

    auto_snapshot = {
        "date": payload.get("date"),
        "surface": payload.get("surface"),
        "sku_id": payload.get("sku_id"),
        "automation_result": payload.get("automation_result"),
        "numeric_evidence": payload.get("numeric_evidence"),
        "derived": payload.get("derived"),
    }
    auto_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(auto_snapshot))

    # --- core nodes ---
    final_summary = ""
    try:
        actions = (result or {}).get("recommended_actions") or []
        p0 = [a for a in actions if str((a or {}).get("priority") or "").strip().upper() == "P0"]
        final_summary = f"P0 {len(p0)}개 / 전체 액션 {len(actions)}개"
    except Exception:
        final_summary = ""

    n_final = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="FinalRecommendation",
        title="최종 제안",
        summary_md=final_summary,
        sort_key=10,
        tags={"alias": "FinalRecommendation"},
        blob=result_blob,
    )
    n_gpt_out = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="GptOutput",
        title="GPT 결과(JSON)",
        summary_md="최종 제안 원문",
        sort_key=20,
        tags={"alias": "GptOutput"},
        blob=result_blob,
    )
    n_gpt_in = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="GptInput",
        title="GPT 입력(payload_json)",
        summary_md="자동화 근거 + 규칙 문서 + 숫자 근거",
        sort_key=30,
        tags={"alias": "GptInput"},
        blob=payload_blob,
    )
    n_rules = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="RulesDoc",
        title="적용 규칙 문서(A-1)",
        summary_md="AI 세팅 스냅샷",
        sort_key=35,
        tags={"alias": "RulesDoc"},
        blob=rules_blob,
    )
    n_auto = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="AutomationResult",
        title="자동화 결과(상태/이벤트/근거)",
        summary_md="상태/존/이벤트/근거 수치",
        sort_key=40,
        tags={"alias": "AutomationResult"},
        blob=auto_blob,
    )

    create_edge(db, run_id=run_id, from_node_id=n_final.node_id, to_node_id=n_gpt_out.node_id, edge_type="uses", label="결과")
    create_edge(db, run_id=run_id, from_node_id=n_gpt_out.node_id, to_node_id=n_gpt_in.node_id, edge_type="uses", label="입력")
    create_edge(db, run_id=run_id, from_node_id=n_gpt_in.node_id, to_node_id=n_rules.node_id, edge_type="uses", label="규칙")
    create_edge(db, run_id=run_id, from_node_id=n_gpt_in.node_id, to_node_id=n_auto.node_id, edge_type="uses", label="자동화")

    # --- derived: sku strategy (결정론) ---
    try:
        derived = payload.get("derived") or {}
        sku_strategy = (derived.get("sku_strategy") if isinstance(derived, dict) else None) or {}
        if isinstance(sku_strategy, dict) and sku_strategy:
            strategy_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(sku_strategy))
            title = f"SKU 전략 분류: {str(sku_strategy.get('strategy_type') or 'unknown')}"
            reason = str(sku_strategy.get("reason") or "").strip()
            n_strategy = create_node(
                db,
                run_id=run_id,
                sku_id=sid,
                node_type="SkuStrategy",
                title=title,
                summary_md=(reason if reason else "SKU 전략(결정론)"),
                sort_key=55,
                tags={"alias": "SkuStrategy"},
                blob=strategy_blob,
            )
            create_edge(db, run_id=run_id, from_node_id=n_gpt_in.node_id, to_node_id=n_strategy.node_id, edge_type="uses", label="전략")
            create_edge(db, run_id=run_id, from_node_id=n_strategy.node_id, to_node_id=n_rules.node_id, edge_type="derives_from", label="규칙")
            create_edge(db, run_id=run_id, from_node_id=n_strategy.node_id, to_node_id=n_auto.node_id, edge_type="derives_from", label="근거")
    except Exception:
        pass

    # --- derived: ad metrics 30d ---
    try:
        derived = payload.get("derived") or {}
        adm = (derived.get("ad_metrics_30d") if isinstance(derived, dict) else None) or {}
        if isinstance(adm, dict) and bool(adm.get("ok")) and ("revenue_30d" in adm or "product_url" in adm):
            adm_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(adm))
            pu = str(adm.get("product_url") or "").strip()
            title = "광고 지표(최근 30일)"
            summary = ""
            try:
                summary = f"매출 {int(adm.get('revenue_30d') or 0):,}원 · 품질지수 {adm.get('quality_index_wavg_30d')}"
            except Exception:
                summary = ""
            n_adm = create_node(
                db,
                run_id=run_id,
                sku_id=sid,
                node_type="AdMetrics30d",
                title=title,
                summary_md=(summary if summary else (pu if pu else "광고 지표 스냅샷")),
                sort_key=57,
                tags={"alias": "AdMetrics30d"},
                blob=adm_blob,
            )
            create_edge(db, run_id=run_id, from_node_id=n_gpt_in.node_id, to_node_id=n_adm.node_id, edge_type="uses", label="광고지표")
            create_edge(db, run_id=run_id, from_node_id=n_adm.node_id, to_node_id=n_rules.node_id, edge_type="derives_from", label="규칙")
    except Exception:
        pass

    # --- derived: quality trends 14d ---
    try:
        derived = payload.get("derived") or {}
        qt = (derived.get("quality_trends_14d") if isinstance(derived, dict) else None) or {}
        if isinstance(qt, dict) and qt:
            qt_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(qt))
            n_qt = create_node(
                db,
                run_id=run_id,
                sku_id=sid,
                node_type="QualityTrends14d",
                title="품질지수 추세(최근7일 vs 전7일)",
                summary_md="광고/오가닉 품질지수 변화량(Δ)",
                sort_key=58,
                tags={"alias": "QualityTrends14d"},
                blob=qt_blob,
            )
            create_edge(db, run_id=run_id, from_node_id=n_gpt_in.node_id, to_node_id=n_qt.node_id, edge_type="uses", label="품질지수")
            create_edge(db, run_id=run_id, from_node_id=n_qt.node_id, to_node_id=n_rules.node_id, edge_type="derives_from", label="규칙")
    except Exception:
        pass

    # --- derived: action hints ---
    try:
        derived = payload.get("derived") or {}
        hints = (derived.get("action_hints") if isinstance(derived, dict) else None) or []
        if isinstance(hints, list) and hints:
            hb = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(hints))
            n_h = create_node(
                db,
                run_id=run_id,
                sku_id=sid,
                node_type="ActionHints",
                title="결정론 액션 템플릿",
                summary_md="설정(기준 숫자) 기반 우선 액션 후보",
                sort_key=59,
                tags={"alias": "ActionHints"},
                blob=hb,
            )
            create_edge(db, run_id=run_id, from_node_id=n_gpt_in.node_id, to_node_id=n_h.node_id, edge_type="uses", label="액션템플릿")
            create_edge(db, run_id=run_id, from_node_id=n_h.node_id, to_node_id=n_rules.node_id, edge_type="derives_from", label="규칙")
    except Exception:
        pass

    # --- table snapshots + source queries (verify 가능) ---
    params_today = {"date": target_date, "surface": surface, "sku_id": sid}
    params_yday = {"date": (target_date - timedelta(days=1)), "surface": surface, "sku_id": sid}

    def _query_rows(sql: str, params: dict) -> tuple[list[dict[str, Any]], str]:
        res = db.execute(text(sql), params)
        rows: list[dict[str, Any]] = []
        for r in res.mappings().all():
            rows.append({k: r.get(k) for k in sorted(r.keys())})
        # 해시 입력은 canonical list[dict]
        txt = canonical_json_dumps(rows)
        return (rows, sha256_hex(txt))

    # Raw bottom node(원본 묶음)
    n_raw = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="RawTablesAndInputs",
        title="원본 데이터(스냅샷)",
        summary_md="검증용 원본 테이블/입력 스냅샷",
        sort_key=200,
        tags={"alias": "RawTablesAndInputs"},
        blob=upsert_blob(db, content_type="json", content_text=canonical_json_dumps({"date": target_date.isoformat(), "surface": surface, "sku_id": sid})),
    )

    # State
    q_state = "SELECT date, surface, sku_id, state, reasons_json FROM sku_state_daily WHERE date = :date AND surface = :surface AND sku_id = :sku_id"
    try:
        state_rows, state_hash = _query_rows(q_state, params_today)
    except Exception:
        state_rows, state_hash = ([], "")
    state_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(state_rows))
    n_state_src = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SourceQuery",
        title="쿼리: 상태(sku_state_daily)",
        summary_md="상태 원본 조회",
        sort_key=70,
        tags={"alias": "SourceQuery_State"},
        query_sql=q_state,
        query_params=params_today,
        blob=state_blob,
    )
    if state_hash:
        try:
            n_state_src.content_hash = state_hash
            db.commit()
        except Exception:
            pass
    n_state = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SkuStateDaily",
        title="상태 판정",
        summary_md="현재 상태/사유",
        sort_key=60,
        tags={"alias": "SkuStateDaily"},
        blob=state_blob,
    )
    create_edge(db, run_id=run_id, from_node_id=n_auto.node_id, to_node_id=n_state.node_id, edge_type="uses", label="상태")
    create_edge(db, run_id=run_id, from_node_id=n_state.node_id, to_node_id=n_state_src.node_id, edge_type="derives_from", label="쿼리")
    create_edge(db, run_id=run_id, from_node_id=n_state_src.node_id, to_node_id=n_raw.node_id, edge_type="uses", label="원본")

    # Events
    q_events = (
        "SELECT date, surface, sku_id, event_type, severity, payload_json "
        "FROM sku_event_daily WHERE date = :date AND surface = :surface AND sku_id = :sku_id "
        "ORDER BY severity DESC, event_type ASC"
    )
    try:
        ev_rows, ev_hash = _query_rows(q_events, params_today)
    except Exception:
        ev_rows, ev_hash = ([], "")
    ev_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(ev_rows))
    n_ev_src = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SourceQuery",
        title="쿼리: 이벤트(sku_event_daily)",
        summary_md="이벤트 원본 조회",
        sort_key=90,
        tags={"alias": "SourceQuery_Events"},
        query_sql=q_events,
        query_params=params_today,
        blob=ev_blob,
    )
    if ev_hash:
        try:
            n_ev_src.content_hash = ev_hash
            db.commit()
        except Exception:
            pass
    n_ev = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SkuEventDaily",
        title="이벤트(경보)",
        summary_md="발생 이벤트 목록",
        sort_key=80,
        tags={"alias": "SkuEventDaily"},
        blob=ev_blob,
    )
    create_edge(db, run_id=run_id, from_node_id=n_auto.node_id, to_node_id=n_ev.node_id, edge_type="uses", label="이벤트")
    create_edge(db, run_id=run_id, from_node_id=n_ev.node_id, to_node_id=n_ev_src.node_id, edge_type="derives_from", label="쿼리")
    create_edge(db, run_id=run_id, from_node_id=n_ev_src.node_id, to_node_id=n_raw.node_id, edge_type="uses", label="원본")

    # Zones(today+yesterday)
    q_zones = (
        "SELECT date, surface, sku_id, decision_kw_total, top1_3_kw_cnt, top4_6_kw_cnt, top7_10_kw_cnt, top11_15_kw_cnt, below16_kw_cnt, avg_rank_decision_kw "
        "FROM sku_zone_counts_daily WHERE surface = :surface AND sku_id = :sku_id AND (date = :date OR date = :yday) "
        "ORDER BY date ASC"
    )
    params_zones = {"date": target_date, "yday": (target_date - timedelta(days=1)), "surface": surface, "sku_id": sid}
    try:
        z_rows, z_hash = _query_rows(q_zones, params_zones)
    except Exception:
        z_rows, z_hash = ([], "")
    z_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(z_rows))
    n_z_src = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SourceQuery",
        title="쿼리: 존 집계(sku_zone_counts_daily)",
        summary_md="오늘/전일 존 집계",
        sort_key=110,
        tags={"alias": "SourceQuery_Zones"},
        query_sql=q_zones,
        query_params=params_zones,
        blob=z_blob,
    )
    if z_hash:
        try:
            n_z_src.content_hash = z_hash
            db.commit()
        except Exception:
            pass
    n_z = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SkuZoneCountsDaily",
        title="존(순위 구간) 집계",
        summary_md="1~3/4~6/7~10/11~15/16+",
        sort_key=100,
        tags={"alias": "SkuZoneCountsDaily"},
        blob=z_blob,
    )
    create_edge(db, run_id=run_id, from_node_id=n_auto.node_id, to_node_id=n_z.node_id, edge_type="uses", label="존 집계")
    create_edge(db, run_id=run_id, from_node_id=n_z.node_id, to_node_id=n_z_src.node_id, edge_type="derives_from", label="쿼리")
    create_edge(db, run_id=run_id, from_node_id=n_z_src.node_id, to_node_id=n_raw.node_id, edge_type="uses", label="원본")

    # Cause evidence
    q_cause = (
        "SELECT date, surface, sku_id, decision_kw_total, drop_kw_cnt_1d, avg_drop_1d, consecutive_drop_3d_kw_cnt, cannibal_kw_cnt, cannibal_kw_drop_cnt, evidence_json "
        "FROM sku_cause_evidence_daily WHERE date = :date AND surface = :surface AND sku_id = :sku_id"
    )
    try:
        c_rows, c_hash = _query_rows(q_cause, params_today)
    except Exception:
        c_rows, c_hash = ([], "")
    c_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(c_rows))
    n_c_src = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SourceQuery",
        title="쿼리: 원인 근거(sku_cause_evidence_daily)",
        summary_md="SKU 단위 원인 근거 수치",
        sort_key=130,
        tags={"alias": "SourceQuery_Cause"},
        query_sql=q_cause,
        query_params=params_today,
        blob=c_blob,
    )
    if c_hash:
        try:
            n_c_src.content_hash = c_hash
            db.commit()
        except Exception:
            pass
    n_c = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SkuCauseEvidenceDaily",
        title="원인 근거(요약)",
        summary_md="하락 키워드/연속하락/카니발",
        sort_key=120,
        tags={"alias": "SkuCauseEvidenceDaily"},
        blob=c_blob,
    )
    create_edge(db, run_id=run_id, from_node_id=n_auto.node_id, to_node_id=n_c.node_id, edge_type="uses", label="원인 근거")
    create_edge(db, run_id=run_id, from_node_id=n_c.node_id, to_node_id=n_c_src.node_id, edge_type="derives_from", label="쿼리")
    create_edge(db, run_id=run_id, from_node_id=n_c_src.node_id, to_node_id=n_raw.node_id, edge_type="uses", label="원본")

    # Keyword evidence list
    q_kw = (
        "SELECT date, surface, sku_id, keyword, rank_today, rank_yesterday, rank_7d_ago, rank_delta_1d, rank_delta_7d, "
        "is_consecutive_drop_3d, monthly_search_volume, is_cannibal, cannibal_evidence_json "
        "FROM sku_keyword_evidence_daily WHERE date = :date AND surface = :surface AND sku_id = :sku_id "
        "ORDER BY is_consecutive_drop_3d DESC, rank_delta_1d DESC, rank_today ASC LIMIT 50"
    )
    try:
        kw_rows, kw_hash = _query_rows(q_kw, params_today)
    except Exception:
        kw_rows, kw_hash = ([], "")
    kw_blob = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(kw_rows))
    n_kw_src = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SourceQuery",
        title="쿼리: 키워드 근거(sku_keyword_evidence_daily)",
        summary_md="키워드별 순위/증감/카니발",
        sort_key=160,
        tags={"alias": "SourceQuery_KeywordEvidence"},
        query_sql=q_kw,
        query_params=params_today,
        blob=kw_blob,
    )
    if kw_hash:
        try:
            n_kw_src.content_hash = kw_hash
            db.commit()
        except Exception:
            pass
    n_kw_list = create_node(
        db,
        run_id=run_id,
        sku_id=sid,
        node_type="SkuKeywordEvidenceDailyTopN",
        title="키워드 근거(TopN)",
        summary_md="상위 키워드 근거 리스트",
        sort_key=150,
        tags={"alias": "SkuKeywordEvidenceDaily"},
        blob=kw_blob,
    )
    create_edge(db, run_id=run_id, from_node_id=n_auto.node_id, to_node_id=n_kw_list.node_id, edge_type="uses", label="키워드 근거")
    create_edge(db, run_id=run_id, from_node_id=n_kw_list.node_id, to_node_id=n_kw_src.node_id, edge_type="derives_from", label="쿼리")
    create_edge(db, run_id=run_id, from_node_id=n_kw_src.node_id, to_node_id=n_raw.node_id, edge_type="uses", label="원본")

    # --- keyword alias nodes (evidence_refs용) ---
    try:
        for row in kw_rows[:12]:
            k = str((row or {}).get("keyword") or "").strip()
            if not k:
                continue
            kb = upsert_blob(db, content_type="json", content_text=canonical_json_dumps(row))
            n_kw = create_node(
                db,
                run_id=run_id,
                sku_id=sid,
                node_type="KeywordEvidence",
                title=f"키워드: {k}",
                summary_md="개별 키워드 근거",
                sort_key=151,
                tags={"alias": f"kw:{k}"},
                blob=kb,
            )
            create_edge(db, run_id=run_id, from_node_id=n_kw_list.node_id, to_node_id=n_kw.node_id, edge_type="explains", label="키워드")
    except Exception:
        pass


def run_a1_batch(
    db: Session,
    *,
    api_key: str,
    req: A1BatchRunRequest,
    target_date: Date,
) -> A1BatchResult:
    """
    전일 배치 실행(핵심 로직).
    - 대상 sku를 먼저 고르고, 각 sku마다 payload 구성 → GPT 호출 → gpt_action_daily 저장.
    - OpenAI 장애/JSON 파싱 실패가 있어도 "전체 배치"가 500으로 터지지 않도록 개별 SKU 실패로 격리한다.
    """
    surface = str(req.surface or "").strip() or "mobile_integrated"
    action_version = str(req.action_version or "").strip() or "A1_V1"
    model = str(req.model or "").strip() or "gpt-5.2"

    skus = pick_target_skus(
        db,
        target_date=target_date,
        surface=surface,
        severities=req.severities,
        max_items=req.max_items,
    )
    items: list[dict[str, Any]] = []
    saved = 0
    failed = 0
    trace_run_id: str | None = None

    if not req.dry_run:
        try:
            status = "NO_DATA" if not skus else "SUCCESS"
            run = create_run(
                db,
                analysis_type="A-1",
                run_date=target_date,
                surface=surface,
                action_version=action_version,
                model=model,
                status=status,
            )
            trace_run_id = str(getattr(run, "run_id", "") or "") or None
            if status == "NO_DATA" and trace_run_id:
                try:
                    _a1_trace_build_for_no_data_run(db, run_id=trace_run_id, target_date=target_date, surface=surface, req=req)
                except Exception:
                    pass
        except Exception:
            trace_run_id = None

    for sid in skus:
        status = "PENDING"
        err: str | None = None
        try:
            payload = build_gpt_payload(db, target_date=target_date, surface=surface, sku_id=sid, action_version=action_version)
            result: dict[str, Any] | None = None
            if not req.dry_run:
                result = call_openai_for_a1(api_key=api_key, model=model, payload_json=payload)
                status = "SUCCESS"
            else:
                status = "DRY_RUN"

            if not req.dry_run:
                upsert_gpt_action_daily(
                    db,
                    target_date=target_date,
                    surface=surface,
                    sku_id=sid,
                    action_version=action_version,
                    payload_json=payload,
                    result_json=result,
                    model=model,
                    status=status,
                    error=None,
                )
                saved += 1
                if trace_run_id:
                    try:
                        _a1_trace_build_for_sku(
                            db,
                            run_id=trace_run_id,
                            target_date=target_date,
                            surface=surface,
                            sku_id=sid,
                            payload=payload,
                            result=result,
                            error=None,
                        )
                    except Exception:
                        pass
        except Exception as e:
            status = "FAILED"
            failed += 1
            err = str(e)[:800]
            try:
                if not req.dry_run:
                    payload_best_effort = None
                    try:
                        payload_best_effort = build_gpt_payload(
                            db,
                            target_date=target_date,
                            surface=surface,
                            sku_id=sid,
                            action_version=action_version,
                        )
                    except Exception:
                        payload_best_effort = {
                            "analysis_type": "A-1",
                            "date": target_date.isoformat(),
                            "surface": surface,
                            "sku_id": sid,
                            "action_version": action_version,
                            "payload_build_failed": True,
                        }
                    upsert_gpt_action_daily(
                        db,
                        target_date=target_date,
                        surface=surface,
                        sku_id=sid,
                        action_version=action_version,
                        payload_json=payload_best_effort,
                        result_json=None,
                        model=model,
                        status="FAILED",
                        error=err,
                    )
                    saved += 1
                    if trace_run_id:
                        try:
                            _a1_trace_build_for_sku(
                                db,
                                run_id=trace_run_id,
                                target_date=target_date,
                                surface=surface,
                                sku_id=sid,
                                payload=payload_best_effort,
                                result=None,
                                error=err,
                            )
                        except Exception:
                            pass
            except Exception:
                # 저장 자체가 실패하면(예: 테이블 미존재)라도 배치는 계속 진행
                pass

        items.append({"sku_id": sid, "status": status, "error": err})

    return A1BatchResult(
        target_skus=skus,
        processed=len(skus),
        saved=saved,
        failed=failed,
        items=items,
        trace_run_id=trace_run_id,
    )

