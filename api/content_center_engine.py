from __future__ import annotations

import json
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from sqlalchemy import or_
from sqlalchemy.orm import Session

from content_center_time import now_kst, today_kst
from content_center_window import AnalysisMode, AnalysisWindow, resolve_analysis_window
from db import (
    CommerceQnaRaw,
    ContentAppealEvidence,
    ContentAppealPoint,
    ContentClaimPolicy,
    ContentInsight,
    ContentSkuScope,
    NaverAdSearchwordDaily,
    NaverGfaDaily,
    NaverReviewRaw,
    NaverSmartstorePurchaseKeywordDaily,
)
from content_center_scope import ensure_claim_policies, list_sku_scope
from sku_identity import canonicalize_product_url


THEME_DEFS: tuple[dict[str, Any], ...] = (
    {
        "key": "repeat_gray_burden",
        "label": "반복되는 새치 관리 부담",
        "tokens": ("새치", "자주", "반복", "또 올라", "금방", "염색해야"),
        "problem": "반복되는 새치 관리가 부담스럽다",
        "desire": "지속적으로 관리하기 편한 방법을 원한다",
        "appeal": "반복되는 새치 관리의 부담을 줄이는 식물성 관리",
    },
    {
        "key": "scalp_irritation",
        "label": "두피 자극 걱정",
        "tokens": ("따갑", "자극", "두피", "화끈", "알러지", "순한"),
        "problem": "염색·관리 시 두피 자극이 걱정된다",
        "desire": "자극 부담을 줄인 관리를 원한다",
        "appeal": "두피 자극을 줄이고 싶은 사람을 위한 순한 관리",
    },
    {
        "key": "natural_color",
        "label": "자연스러운 컬러",
        "tokens": ("자연스러운", "컬러", "색이", "물빠", "얼룩"),
        "problem": "부자연스럽거나 얼룩진 색이 싫다",
        "desire": "자연스러운 색감을 원한다",
        "appeal": "자연스러운 컬러로 보이는 새치 관리",
    },
    {
        "key": "parents_care",
        "label": "부모님 새치 관리",
        "tokens": ("부모", "엄마", "아빠", "시어머니", "선물"),
        "problem": "가족을 위한 새치 관리 제품을 고르기 어렵다",
        "desire": "함께 쓰기 쉬운 관리법을 원한다",
        "appeal": "부모님과 함께 하는 새치 관리",
    },
    {
        "key": "home_easy",
        "label": "집에서 간편한 관리",
        "tokens": ("혼자", "집", "간편", "셀프", "어렵"),
        "problem": "혼자 사용하기 어렵거나 번거롭다",
        "desire": "집에서 쉽게 쓰고 싶다",
        "appeal": "집에서 혼자 하기 쉬운 관리",
    },
    {
        "key": "aftercare_pack",
        "label": "염색 후 모발·두피 관리",
        "tokens": ("염색 후", "헤어팩", "허브팩", "보습", "거칠", "푸석"),
        "problem": "염색 후 모발과 두피가 거칠어진다",
        "desire": "염색 이후에도 계속 쓸 수 있는 관리를 원한다",
        "appeal": "염색 후에도 이어가는 허브 팩 관리",
    },
)

APPEAL_SCORE_WEIGHTS = {
    "demand": 0.20,
    "purchase_intent": 0.20,
    "evidence": 0.20,
    "conversion": 0.20,
    "novelty": 0.10,
    "freshness": 0.10,
}

EVIDENCE_CLASSES = {
    "POSITIVE_REVIEW",
    "POSITIVE_QNA",
    "NEGATIVE_COMPLAINT",
    "MISUNDERSTANDING",
    "POTENTIAL_PRODUCT_ISSUE",
}

PRODUCT_ISSUE_TOKENS = ("발진", "두드러기", "상처", "오염", "파손", "하자", "불량", "부작용", "알레르기", "알러지", "통증", "가렵", "염증")
MISUNDERSTANDING_TOKENS = ("왜", "바로", "검은색", "발색", "색이", "천연", "일반 염색", "안 나오", "않나요", "물빠")
NEGATIVE_TOKENS = ("불만", "별로", "어렵", "오래", "번거", "냄새", "따갑", "밝", "안되", "안 되", "실망")
POSITIVE_TOKENS = ("좋", "만족", "부드럽", "윤기", "건강", "편", "순", "자연", "차분", "덜해")

READY_TASKS = (
    "purchase_keywords",
    "reviews_collect",
    "ads_daily",
    "gfa_performance_daily",
    "qna_collect",
)


def _now() -> datetime:
    return now_kst()


def _today() -> date:
    return today_kst()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _loads(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        obj = json.loads(raw)
        return obj if obj is not None else default
    except Exception:
        return default


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def match_theme(text: str) -> str | None:
    blob = str(text or "")
    best_key = None
    best_hits = 0
    for theme in THEME_DEFS:
        hits = sum(1 for token in theme["tokens"] if token in blob)
        if hits > best_hits:
            best_hits = hits
            best_key = str(theme["key"])
    return best_key if best_hits > 0 else None


def theme_def(theme_key: str) -> dict[str, Any]:
    return next((x for x in THEME_DEFS if x["key"] == theme_key), THEME_DEFS[0])


def claim_gate_text(db: Session, text: str) -> dict[str, Any]:
    ensure_claim_policies(db)
    blob = str(text or "")
    hits = []
    for row in db.query(ContentClaimPolicy).filter(ContentClaimPolicy.is_active.is_(True)).all():
        pattern = str(row.pattern or "").strip()
        if pattern and pattern in blob:
            hits.append({"claim_class": row.claim_class, "pattern": pattern, "note": row.note})
    prohibited = [x for x in hits if x["claim_class"] == "PROHIBITED"]
    if prohibited:
        return {"allowed": False, "legal_risk": "HIGH", "claim_class": "PROHIBITED", "hits": hits}
    if hits:
        return {"allowed": True, "legal_risk": "MEDIUM", "claim_class": "CUSTOMER_EXPERIENCE", "hits": hits}
    return {"allowed": True, "legal_risk": "LOW", "claim_class": "MARKETING_INTERPRETATION", "hits": []}


def sanitize_marketing_text(db: Session, text: str) -> str:
    out = str(text or "")
    for row in db.query(ContentClaimPolicy).filter(ContentClaimPolicy.is_active.is_(True)).all():
        if str(row.claim_class or "") != "PROHIBITED":
            continue
        pattern = str(row.pattern or "").strip()
        if pattern:
            out = out.replace(pattern, "부담")
    return out


def _sku_matchers(scope: ContentSkuScope) -> dict[str, Any]:
    url = canonicalize_product_url(scope.product_url) or str(scope.product_url or "").strip()
    pid = int(scope.product_id_catalog) if scope.product_id_catalog is not None else None
    title = str(scope.title or "").strip()
    return {"sku_id": scope.sku_id, "url": url, "pid": pid, "title": title}


def _empty_source_metrics() -> dict[str, dict[str, Any]]:
    return defaultdict(lambda: {"source": "", "rows_in_window": 0, "min_data_date": None, "max_data_date": None, "_seen_keys": set()})


def _date_key(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        return None


def _record_source_rows(
    source_metrics: dict[str, dict[str, Any]],
    source: str,
    rows: Iterable[Any],
    date_attr: str,
    key_func: Any | None = None,
) -> None:
    metric = source_metrics[source]
    metric["source"] = source
    for row in rows:
        key = key_func(row) if key_func is not None else id(row)
        if key in metric["_seen_keys"]:
            continue
        metric["_seen_keys"].add(key)
        metric["rows_in_window"] += 1
        d = _date_key(getattr(row, date_attr, None))
        if d is None:
            continue
        cur_min = _date_key(metric.get("min_data_date"))
        cur_max = _date_key(metric.get("max_data_date"))
        if cur_min is None or d < cur_min:
            metric["min_data_date"] = d
        if cur_max is None or d > cur_max:
            metric["max_data_date"] = d


def _source_metrics_to_list(source_metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for source in sorted(source_metrics.keys()):
        item = dict(source_metrics[source])
        item.pop("_seen_keys", None)
        item["min_data_date"] = item["min_data_date"].isoformat() if isinstance(item["min_data_date"], date) else None
        item["max_data_date"] = item["max_data_date"].isoformat() if isinstance(item["max_data_date"], date) else None
        out.append(item)
    return out


def _filter_date_window(q: Any, column: Any, window: AnalysisWindow) -> Any:
    return q.filter(column >= window.start_date, column < window.end_date_exclusive)


def _filter_datetime_window(q: Any, column: Any, window: AnalysisWindow) -> Any:
    return q.filter(column >= window.window_start, column < window.window_end)


def _collect_review_evidence(db: Session, matcher: dict[str, Any], window: AnalysisWindow, source_metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    q = db.query(NaverReviewRaw)
    if matcher["url"]:
        q = q.filter(NaverReviewRaw.product_url == matcher["url"])
    elif matcher["pid"] is not None:
        q = q.filter(NaverReviewRaw.product_id_catalog == matcher["pid"])
    else:
        return []
    q = _filter_date_window(q, NaverReviewRaw.review_written_at, window)
    out: list[dict[str, Any]] = []
    rows = q.order_by(NaverReviewRaw.review_written_at.desc()).all()
    _record_source_rows(source_metrics, "review", rows, "review_written_at", lambda row: row.review_key)
    for row in rows:
        text = str(row.review_text or "").strip()
        theme = match_theme(text)
        if not theme:
            continue
        out.append(
            {
                "source_type": "review",
                "source_pk": str(row.review_key),
                "snippet": text[:280],
                "theme_key": theme,
                "sku_id": matcher["sku_id"],
                "when": row.review_written_at.isoformat() if row.review_written_at else None,
                "rating": getattr(row, "rating", None),
            }
        )
    return out


def _collect_qna_evidence(db: Session, matcher: dict[str, Any], window: AnalysisWindow, source_metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    q = db.query(CommerceQnaRaw)
    clauses = []
    if matcher["pid"] is not None:
        clauses.append(CommerceQnaRaw.product_no == str(matcher["pid"]))
    if matcher["title"]:
        clauses.append(CommerceQnaRaw.product_name.contains(matcher["title"][:12]))
    if not clauses:
        return []
    from sqlalchemy import or_

    q = q.filter(or_(*clauses))
    q = _filter_datetime_window(q, CommerceQnaRaw.inquiry_registered_at, window)
    out: list[dict[str, Any]] = []
    rows = q.order_by(CommerceQnaRaw.inquiry_registered_at.desc()).all()
    _record_source_rows(source_metrics, "qna", rows, "inquiry_registered_at", lambda row: row.qna_key)
    for row in rows:
        text = f"{row.title or ''} {row.inquiry_text or ''}".strip()
        theme = match_theme(text)
        if not theme:
            continue
        out.append(
            {
                "source_type": "qna",
                "source_pk": str(row.qna_key),
                "snippet": text[:280],
                "theme_key": theme,
                "sku_id": matcher["sku_id"],
                "when": row.inquiry_registered_at.isoformat() if row.inquiry_registered_at else None,
            }
        )
    return out


def _collect_purchase_keyword_evidence(db: Session, matcher: dict[str, Any], window: AnalysisWindow, source_metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if matcher["pid"] is None:
        return []
    q = db.query(NaverSmartstorePurchaseKeywordDaily).filter(NaverSmartstorePurchaseKeywordDaily.product_id == matcher["pid"])
    q = _filter_date_window(q, NaverSmartstorePurchaseKeywordDaily.date, window)
    grouped: dict[str, dict[str, Any]] = {}
    rows = q.all()
    _record_source_rows(
        source_metrics,
        "purchase_keyword",
        rows,
        "date",
        lambda row: (row.date, row.product_id, row.channel_group, row.channel_name, row.keyword),
    )
    for row in rows:
        keyword = str(row.keyword or "").strip()
        theme = match_theme(keyword)
        if not theme or not keyword:
            continue
        cur = grouped.setdefault(
            keyword,
            {
                "source_type": "purchase_keyword",
                "source_pk": f"{matcher['pid']}:{keyword}",
                "snippet": keyword,
                "theme_key": theme,
                "sku_id": matcher["sku_id"],
                "payments": 0.0,
                "amount": 0.0,
                "dates": set(),
            },
        )
        cur["payments"] += float(row.payments or 0)
        cur["amount"] += float(row.amount or 0)
        cur["dates"].add(row.date.isoformat() if row.date else "")
        cur["when"] = max([x for x in cur["dates"] if x] or [""])
    for item in grouped.values():
        item["dates"] = sorted(x for x in item.get("dates", set()) if x)
    return list(grouped.values())


def _collect_searchword_evidence(db: Session, matcher: dict[str, Any], window: AnalysisWindow, source_metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    title = matcher["title"]
    q = db.query(NaverAdSearchwordDaily)
    q = _filter_date_window(q, NaverAdSearchwordDaily.date, window)
    grouped: dict[str, dict[str, Any]] = {}
    needles = [token for token in ("헤나", "새치", "허브팩", "헤어팩", "두피") if token]
    if title:
        needles.append(title[:8])
    rows = q.all()
    _record_source_rows(
        source_metrics,
        "ad_searchword",
        rows,
        "date",
        lambda row: (row.date, row.campaign_name, row.adgroup_name, row.searchword, row.device, row.source),
    )
    for row in rows:
        word = str(row.searchword or "").strip()
        theme = match_theme(word)
        if not theme:
            continue
        if needles and not any(n and n in word for n in needles) and not any(n and n in str(row.matched_keyword or "") for n in needles):
            continue
        cur = grouped.setdefault(
            word,
            {
                "source_type": "ad_searchword",
                "source_pk": word,
                "snippet": word,
                "theme_key": theme,
                "sku_id": matcher["sku_id"],
                "clicks": 0,
                "conversions": 0,
                "purchase_conversions": 0,
                "dates": set(),
            },
        )
        cur["clicks"] += int(row.clicks or 0)
        cur["conversions"] += int(row.conversions or 0)
        cur["purchase_conversions"] += int(row.purchase_conversions or 0)
        cur["dates"].add(row.date.isoformat() if row.date else "")
        cur["when"] = max([x for x in cur["dates"] if x] or [""])
    for item in grouped.values():
        item["dates"] = sorted(x for x in item.get("dates", set()) if x)
    return list(grouped.values())


def _collect_gfa_copy_evidence(db: Session, matcher: dict[str, Any], window: AnalysisWindow, source_metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    q = db.query(NaverGfaDaily)
    q = _filter_date_window(q, NaverGfaDaily.date, window)
    out: list[dict[str, Any]] = []
    title = matcher["title"]
    rows = q.all()
    _record_source_rows(
        source_metrics,
        "gfa_performance",
        rows,
        "date",
        lambda row: (row.date, row.campaign_id, row.adgroup_id, row.creative_id, row.placement, row.audience),
    )
    for row in rows:
        name = str(getattr(row, "creative_name", "") or getattr(row, "campaign_name", "") or "")
        if title and title[:6] not in name and "헤나" not in name and "허브" not in name:
            continue
        theme = match_theme(name)
        if not theme:
            continue
        out.append(
            {
                "source_type": "gfa_performance",
                "source_pk": f"{getattr(row, 'date', '')}:{name}",
                "snippet": name[:180],
                "theme_key": theme,
                "sku_id": matcher["sku_id"],
                "ctr": float(getattr(row, "ctr", 0) or 0),
                "conversions": int(getattr(row, "conversions", 0) or 0),
                "when": row.date.isoformat() if row.date else None,
            }
        )
    return out


def collect_evidence_for_sku(db: Session, scope: ContentSkuScope, *, window: AnalysisWindow, source_metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    matcher = _sku_matchers(scope)
    items: list[dict[str, Any]] = []
    items.extend(_collect_review_evidence(db, matcher, window, source_metrics))
    items.extend(_collect_qna_evidence(db, matcher, window, source_metrics))
    items.extend(_collect_purchase_keyword_evidence(db, matcher, window, source_metrics))
    items.extend(_collect_searchword_evidence(db, matcher, window, source_metrics))
    items.extend(_collect_gfa_copy_evidence(db, matcher, window, source_metrics))
    return items


def _score_cluster(items: list[dict[str, Any]], previous: ContentAppealPoint | None) -> dict[str, float]:
    reviews = [x for x in items if x["source_type"] == "review"]
    qna = [x for x in items if x["source_type"] == "qna"]
    purchase = [x for x in items if x["source_type"] == "purchase_keyword"]
    ads = [x for x in items if x["source_type"] == "ad_searchword"]
    gfa = [x for x in items if x["source_type"] == "gfa_performance"]
    purchase_payments = sum(float(x.get("payments") or 0) for x in purchase)
    ad_clicks = sum(int(x.get("clicks") or 0) for x in ads)
    purchase_conv = sum(int(x.get("purchase_conversions") or 0) for x in ads) + sum(int(x.get("conversions") or 0) for x in gfa)
    evidence_n = len(items)
    demand = min(100.0, 20 + ad_clicks * 0.4 + len(ads) * 8)
    purchase_intent = min(100.0, 15 + purchase_payments * 6 + len(purchase) * 10)
    evidence = min(100.0, 10 + evidence_n * 4 + len(reviews) * 2 + len(qna) * 3)
    conversion = min(100.0, 10 + purchase_conv * 8 + purchase_payments * 3)
    novelty = 72.0 if previous is None else max(20.0, 70.0 - float(previous.evidence_score or 0) * 0.2)
    freshness = 90.0 if previous is None else 65.0
    overall = (
        demand * APPEAL_SCORE_WEIGHTS["demand"]
        + purchase_intent * APPEAL_SCORE_WEIGHTS["purchase_intent"]
        + evidence * APPEAL_SCORE_WEIGHTS["evidence"]
        + conversion * APPEAL_SCORE_WEIGHTS["conversion"]
        + novelty * APPEAL_SCORE_WEIGHTS["novelty"]
        + freshness * APPEAL_SCORE_WEIGHTS["freshness"]
    )
    return {
        "demand": round(demand, 1),
        "purchase_intent": round(purchase_intent, 1),
        "evidence": round(evidence, 1),
        "conversion": round(conversion, 1),
        "novelty": round(novelty, 1),
        "freshness": round(freshness, 1),
        "overall": round(overall, 1),
    }


def _customer_language(items: list[dict[str, Any]]) -> list[str]:
    phrases: list[str] = []
    for item in items:
        snippet = re.sub(r"\s+", " ", str(item.get("snippet") or "")).strip()
        if snippet and snippet not in phrases:
            phrases.append(snippet[:80])
        if len(phrases) >= 8:
            break
    return phrases


def _classify_evidence_item(item: dict[str, Any]) -> str:
    text = str(item.get("snippet") or "")
    source = str(item.get("source_type") or "")
    if any(token in text for token in PRODUCT_ISSUE_TOKENS):
        return "POTENTIAL_PRODUCT_ISSUE"
    if any(token in text for token in MISUNDERSTANDING_TOKENS) and (source == "qna" or "?" in text or "문의" in text):
        return "MISUNDERSTANDING"
    if any(token in text for token in NEGATIVE_TOKENS):
        return "NEGATIVE_COMPLAINT"
    if source == "qna":
        return "POSITIVE_QNA" if any(token in text for token in POSITIVE_TOKENS) else "MISUNDERSTANDING"
    return "POSITIVE_REVIEW" if source == "review" else "POSITIVE_REVIEW"


def _safe_metric_payload(item: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in item.items() if k not in {"snippet", "theme_key", "sku_id"}}
    out["evidence_class"] = _classify_evidence_item(item)
    return out


def run_insight_engine(
    db: Session,
    *,
    as_of: date | None = None,
    mode: AnalysisMode | str = AnalysisMode.OPERATING,
    start_date: date | None = None,
    end_date: date | None = None,
    phase1_only: bool = True,
) -> dict[str, Any]:
    as_of = as_of or _today()
    window = resolve_analysis_window(mode=mode, as_of=as_of, start_date=start_date, end_date=end_date)
    scopes = list_sku_scope(db, phase1_only=phase1_only)
    created_insights = 0
    created_appeals = 0
    evidence_written = 0
    source_metrics = _empty_source_metrics()
    for scope in scopes:
        items = collect_evidence_for_sku(db, scope, window=window, source_metrics=source_metrics)
        by_theme: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in items:
            by_theme[str(item["theme_key"])].append(item)
        for theme_key, cluster in by_theme.items():
            spec = theme_def(theme_key)
            languages = _customer_language(cluster)
            gate = claim_gate_text(db, " ".join(languages) + " " + spec["appeal"])
            existing_insight = (
                db.query(ContentInsight)
                .filter(ContentInsight.sku_id == scope.sku_id, ContentInsight.theme_key == theme_key)
                .order_by(ContentInsight.updated_at.desc())
                .first()
            )
            trend = "new"
            if existing_insight is not None:
                prev = int(existing_insight.evidence_count or 0)
                trend = "strengthened" if len(cluster) > prev else ("weakened" if len(cluster) < prev else "strengthened")
                insight = existing_insight
            else:
                insight = ContentInsight(insight_id=_new_id("IN"), sku_id=scope.sku_id, theme_key=theme_key)
                db.add(insight)
                created_insights += 1
            insight.problem = spec["problem"]
            insight.desire = spec["desire"]
            insight.barrier = spec["problem"]
            insight.motivation = spec["desire"]
            insight.usage_situation = spec["label"]
            insight.customer_language_json = _dumps(languages)
            insight.trend = trend
            insight.evidence_count = len(cluster)
            insight.as_of_date = as_of
            insight.updated_at = _now()

            existing_appeal = _adopt_canonical_appeal(
                db,
                sku_id=scope.sku_id,
                theme_key=theme_key,
                label=str(spec.get("label") or ""),
            )
            scores = _score_cluster(cluster, existing_appeal)
            if existing_appeal is None:
                appeal = ContentAppealPoint(appeal_id=_new_id("AP"), sku_id=scope.sku_id, theme_key=theme_key)
                db.add(appeal)
                created_appeals += 1
            else:
                appeal = existing_appeal
            appeal.insight_id = insight.insight_id
            appeal.label = spec["label"]
            appeal.appeal_text = sanitize_marketing_text(db, spec["appeal"])
            appeal.target = scope.title or scope.sku_id
            appeal.demand_score = scores["demand"]
            appeal.purchase_intent_score = scores["purchase_intent"]
            appeal.evidence_score = scores["evidence"]
            appeal.conversion_score = scores["conversion"]
            appeal.novelty_score = scores["novelty"]
            appeal.freshness_score = scores["freshness"]
            appeal.overall_score = scores["overall"]
            appeal.legal_risk = str(gate["legal_risk"])
            appeal.claim_class = str(gate["claim_class"])
            appeal.status = "ACTIVE" if gate["allowed"] else "ARCHIVED"
            appeal.as_of_date = as_of
            appeal.updated_at = _now()

            db.query(ContentAppealEvidence).filter(ContentAppealEvidence.appeal_id == appeal.appeal_id).delete()
            for item in cluster[:80]:
                db.add(
                    ContentAppealEvidence(
                        evidence_id=_new_id("EV"),
                        appeal_id=appeal.appeal_id,
                        insight_id=insight.insight_id,
                        sku_id=scope.sku_id,
                        source_type=str(item["source_type"]),
                        source_pk=str(item["source_pk"]),
                        snippet=sanitize_marketing_text(db, str(item.get("snippet") or "")),
                        metric_json=_dumps(_safe_metric_payload(item)),
                    )
                )
                evidence_written += 1
    db.commit()
    return {
        "ok": True,
        "as_of": as_of.isoformat(),
        "analysis_mode": window.mode.value,
        "window_type": window.window_type,
        "window_start": window.window_start.isoformat(),
        "window_end": window.window_end.isoformat(),
        "window_end_exclusive": window.window_end.isoformat(),
        "source_windows": _source_metrics_to_list(source_metrics),
        "sku_count": len(scopes),
        "insights_upserted": created_insights,
        "appeals_upserted": created_appeals,
        "evidence_written": evidence_written,
    }


def _item_is_recent(item: dict[str, Any], since: date) -> bool:
    raw = str(item.get("when") or "")
    if not raw:
        return True
    try:
        return raw[:10] >= since.isoformat()
    except Exception:
        return True


def _metric(ev: ContentAppealEvidence) -> dict[str, Any]:
    raw = _loads(ev.metric_json, {})
    return raw if isinstance(raw, dict) else {}


def _normalize_star_rating(value: Any) -> int | None:
    try:
        if value is None:
            return None
        star = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return star if 1 <= star <= 5 else None


def _lookup_review_star_ratings(db: Session | None, evidence: list[ContentAppealEvidence]) -> dict[str, int | None]:
    if db is None:
        return {}
    keys = [
        str(ev.source_pk)
        for ev in evidence
        if str(ev.source_type or "").strip().lower() == "review" and str(ev.source_pk or "").strip()
    ]
    if not keys:
        return {}
    rows = (
        db.query(NaverReviewRaw.review_key, NaverReviewRaw.rating)
        .filter(NaverReviewRaw.review_key.in_(keys))
        .all()
    )
    return {str(key): _normalize_star_rating(rating) for key, rating in rows}


def _evidence_star_rating(ev: ContentAppealEvidence, ratings: dict[str, int | None]) -> int | None:
    if str(ev.source_type or "").strip().lower() != "review":
        return None
    star = _normalize_star_rating(_metric(ev).get("rating"))
    if star is not None:
        return star
    return ratings.get(str(ev.source_pk))


def _naive_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    return datetime.min


def _appeal_freshness_key(row: ContentAppealPoint) -> tuple[Any, ...]:
    return (
        row.as_of_date or date.min,
        _naive_dt(getattr(row, "updated_at", None)),
        _naive_dt(getattr(row, "created_at", None)),
        str(row.appeal_id or ""),
    )


def _is_archived_appeal(row: ContentAppealPoint) -> bool:
    return str(getattr(row, "status", "") or "").strip().upper() == "ARCHIVED"


def _pick_freshest_appeal(rows: Iterable[ContentAppealPoint]) -> ContentAppealPoint | None:
    picked: ContentAppealPoint | None = None
    for row in rows:
        if picked is None or _appeal_freshness_key(row) > _appeal_freshness_key(picked):
            picked = row
    return picked


def _normalized_appeal_key_part(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def _appeal_scope_key(row: ContentAppealPoint, *, collapse_across_skus: bool) -> str:
    if collapse_across_skus:
        return "all"
    return str(row.sku_id or "").strip()


def _canonical_appeals(rows: list[ContentAppealPoint], *, collapse_across_skus: bool = False) -> list[ContentAppealPoint]:
    by_theme: dict[tuple[str, str], ContentAppealPoint] = {}
    for row in rows:
        theme = str(row.theme_key or "").strip().lower()
        label = str(row.label or "").strip()
        scope = _appeal_scope_key(row, collapse_across_skus=collapse_across_skus)
        key = (scope, theme or f"label:{_normalized_appeal_key_part(label)}")
        prev = by_theme.get(key)
        if prev is None or _appeal_freshness_key(row) > _appeal_freshness_key(prev):
            by_theme[key] = row
    by_content: dict[tuple[str, str, str], ContentAppealPoint] = {}
    for row in by_theme.values():
        scope = _appeal_scope_key(row, collapse_across_skus=collapse_across_skus)
        key = (
            scope,
            _normalized_appeal_key_part(row.label),
            _normalized_appeal_key_part(row.appeal_text),
        )
        prev = by_content.get(key)
        if prev is None or _appeal_freshness_key(row) > _appeal_freshness_key(prev):
            by_content[key] = row
    return sorted(
        by_content.values(),
        key=lambda row: (float(row.overall_score or 0), _naive_dt(getattr(row, "updated_at", None))),
        reverse=True,
    )


def _visible_canonical_appeals(rows: list[ContentAppealPoint], *, collapse_across_skus: bool = False) -> list[ContentAppealPoint]:
    return _canonical_appeals([row for row in rows if not _is_archived_appeal(row)], collapse_across_skus=collapse_across_skus)


def _adopt_canonical_appeal(
    db: Session,
    *,
    sku_id: str,
    theme_key: str,
    label: str,
) -> ContentAppealPoint | None:
    rows = (
        db.query(ContentAppealPoint)
        .filter(ContentAppealPoint.sku_id == sku_id)
        .filter(
            or_(
                ContentAppealPoint.theme_key == theme_key,
                ContentAppealPoint.label == label,
            )
        )
        .all()
    )
    if not rows:
        return None
    winner = _pick_freshest_appeal(rows)
    if winner is None:
        return None
    for row in rows:
        if row.appeal_id == winner.appeal_id:
            continue
        if str(getattr(row, "admin_review_status", "") or "").strip().upper() == "CLEAR":
            winner.admin_review_status = "CLEAR"
            if getattr(row, "admin_review_note", None):
                winner.admin_review_note = row.admin_review_note
            if getattr(row, "admin_reviewed_at", None):
                winner.admin_reviewed_at = row.admin_reviewed_at
        row.status = "ARCHIVED"
        row.updated_at = _now()
    return winner


def _evidence_date(metric: dict[str, Any], source_pk: str | None = None) -> date | None:
    candidates: list[Any] = []
    dates = metric.get("dates")
    if isinstance(dates, list):
        candidates.extend(dates)
    candidates.extend([metric.get("when"), metric.get("date"), source_pk])
    parsed = [_date_key(value) for value in candidates]
    parsed = [value for value in parsed if value is not None]
    return max(parsed) if parsed else None


def _evidence_class_counts(ev_list: list[ContentAppealEvidence]) -> dict[str, int]:
    counts = {key: 0 for key in sorted(EVIDENCE_CLASSES)}
    for ev in ev_list:
        klass = str(_metric(ev).get("evidence_class") or "").strip()
        if klass in counts:
            counts[klass] += 1
    return counts


def _emerging_status(ev_list: list[ContentAppealEvidence], *, as_of: date | None) -> dict[str, Any]:
    anchor = as_of or _today()
    recent_start = anchor - timedelta(days=28)
    recent = 0
    baseline = 0
    dated = 0
    for ev in ev_list:
        d = _evidence_date(_metric(ev), ev.source_pk)
        if d is None:
            continue
        dated += 1
        if d >= recent_start:
            recent += 1
        else:
            baseline += 1
    baseline_periods = max(1.0, 5.0)
    baseline_norm = baseline / baseline_periods
    if recent > 0 and baseline == 0:
        status = "NEW"
    elif recent >= 3 and recent >= baseline_norm * 1.5 + 2:
        status = "RISING"
    elif baseline > 0 and recent <= max(1, baseline_norm * 0.4):
        status = "DECLINING"
    else:
        status = "STABLE"
    return {
        "status": status,
        "recent_days": 28,
        "recent_count": recent,
        "baseline_count": baseline,
        "dated_evidence_count": dated,
    }


def _usage_types(ev_list: list[ContentAppealEvidence], counts: dict[str, int]) -> list[str]:
    blob = " ".join(str(ev.snippet or "") for ev in ev_list)
    out: list[str] = []
    if counts.get("POSITIVE_REVIEW", 0) >= 2:
        out.append("SOCIAL_PROOF")
    if any(token in blob for token in ("부드럽", "윤기", "차분", "순", "자연", "두피", "모발")):
        out.append("PRODUCT_BENEFIT")
    if any(token in blob for token in ("집", "혼자", "부모", "엄마", "선물", "시간")):
        out.append("USE_CASE")
    if any(token in blob for token in ("자주", "매일", "반복", "루틴")):
        out.append("ROUTINE")
    if any(token in blob for token in ("부모", "엄마", "아빠", "가족", "선물")):
        out.append("EMOTIONAL_VALUE")
    if any(token in blob for token in ("두피에도", "예상", "몰랐", "새로운", "발견")):
        out.append("DISCOVERY")
    return out or ["PRODUCT_BENEFIT"]


def _recommendation(ev_list: list[ContentAppealEvidence], counts: dict[str, int], usage_types: list[str], emerging: dict[str, Any]) -> dict[str, Any]:
    if counts.get("POTENTIAL_PRODUCT_ISSUE", 0) > 0:
        return {
            "safety_gate": "HOLD",
            "ai_recommended": False,
            "badges": ["운영 검토"],
            "channel_fit": {},
            "reasons": ["잠재 품질/안전 이슈 Evidence가 있어 자동 추천을 보류합니다."],
        }
    channel_fit = {"gfa": 0, "blog": 0, "instagram": 0, "shorts": 0, "faq": 0}
    positive_review = counts.get("POSITIVE_REVIEW", 0)
    positive_qna = counts.get("POSITIVE_QNA", 0)
    negative = counts.get("NEGATIVE_COMPLAINT", 0)
    misunderstanding = counts.get("MISUNDERSTANDING", 0)
    channel_fit["gfa"] = min(100, positive_review * 18 + positive_qna * 6)
    channel_fit["instagram"] = min(100, positive_review * 14 + (20 if "EMOTIONAL_VALUE" in usage_types else 0) + (15 if "DISCOVERY" in usage_types else 0))
    channel_fit["shorts"] = min(100, positive_review * 10 + misunderstanding * 10 + (20 if emerging.get("status") in {"NEW", "RISING"} else 0))
    channel_fit["blog"] = min(100, positive_qna * 14 + negative * 12 + misunderstanding * 18 + positive_review * 5)
    channel_fit["faq"] = min(100, misunderstanding * 20 + negative * 14 + positive_qna * 10)
    badges = ["AI 추천"]
    labels = {"gfa": "GFA 추천", "blog": "Blog 추천", "instagram": "Instagram 추천", "shorts": "Shorts 추천", "faq": "FAQ 추천"}
    for channel, score in sorted(channel_fit.items(), key=lambda item: item[1], reverse=True):
        if score >= 35:
            badges.append(labels[channel])
    if positive_review:
        badges.append("긍정 리뷰 기반")
    if misunderstanding:
        badges.append("오해 해소")
    reasons = []
    if positive_review:
        reasons.append(f"긍정 리뷰 Evidence {positive_review}건이 반복 확인됩니다.")
    if positive_qna:
        reasons.append(f"긍정 Q&A Evidence {positive_qna}건이 있습니다.")
    if misunderstanding:
        reasons.append(f"오해/기대치 차이 Evidence {misunderstanding}건이 있어 교육 콘텐츠에 적합합니다.")
    if emerging.get("status") in {"NEW", "RISING"}:
        reasons.append(f"최근 28일 Evidence {emerging.get('recent_count')}건으로 {emerging.get('status')} 상태입니다.")
    return {
        "safety_gate": "CLEAR",
        "ai_recommended": len(badges) > 1,
        "badges": badges,
        "channel_fit": channel_fit,
        "reasons": reasons or ["6개월 Evidence 기반으로 자동 추천 가능한 소구입니다."],
    }


def appeal_to_dict(
    row: ContentAppealPoint,
    *,
    evidence: Iterable[ContentAppealEvidence] | None = None,
    insight: ContentInsight | None = None,
    db: Session | None = None,
) -> dict[str, Any]:
    raw_ev_list = list(evidence or [])
    ev_list = [ev for ev in raw_ev_list if not bool(getattr(ev, "is_excluded", False))]
    review_ratings = _lookup_review_star_ratings(db, ev_list)
    excluded_count = len(raw_ev_list) - len(ev_list)
    class_counts = _evidence_class_counts(ev_list)
    emerging = _emerging_status(ev_list, as_of=row.as_of_date)
    usage = _usage_types(ev_list, class_counts)
    recommendation = _recommendation(ev_list, class_counts, usage, emerging)
    admin_review_status = str(getattr(row, "admin_review_status", "") or "").strip().upper()
    if admin_review_status == "CLEAR":
        recommendation = {
            **recommendation,
            "safety_gate": "CLEAR",
            "ai_recommended": bool(recommendation.get("ai_recommended")),
            "badges": ["관리자 활성화", *[badge for badge in recommendation.get("badges", []) if badge != "운영 검토"]],
            "reasons": [
                "관리자가 Evidence를 확인하고 콘텐츠 생성 가능 소구로 활성화했습니다.",
                *list(recommendation.get("reasons", []) or []),
            ],
        }
    return {
        "appeal_id": row.appeal_id,
        "sku_id": row.sku_id,
        "insight_id": row.insight_id,
        "theme_key": row.theme_key,
        "label": row.label,
        "appeal_text": row.appeal_text,
        "target": row.target,
        "scores": {
            "demand": row.demand_score,
            "purchase_intent": row.purchase_intent_score,
            "evidence": row.evidence_score,
            "conversion": row.conversion_score,
            "novelty": row.novelty_score,
            "freshness": row.freshness_score,
            "overall": row.overall_score,
        },
        "legal_risk": row.legal_risk,
        "claim_class": row.claim_class,
        "status": row.status,
        "admin_review_status": admin_review_status or None,
        "admin_review_note": getattr(row, "admin_review_note", None),
        "admin_reviewed_at": row.admin_reviewed_at.isoformat() if getattr(row, "admin_reviewed_at", None) else None,
        "learning_verdict": row.learning_verdict,
        "evidence_count": len(ev_list),
        "excluded_evidence_count": excluded_count,
        "evidence_classification": class_counts,
        "emerging": emerging,
        "usage_types": usage,
        "recommendation": recommendation,
        "safety_gate": recommendation["safety_gate"],
        "evidence": [
            {
                "evidence_id": ev.evidence_id,
                "source_type": ev.source_type,
                "source_pk": ev.source_pk,
                "snippet": ev.snippet,
                "sku_id": ev.sku_id,
                "metric_json": ev.metric_json,
                "evidence_class": _metric(ev).get("evidence_class"),
                "is_excluded": bool(getattr(ev, "is_excluded", False)),
                "excluded_reason": getattr(ev, "excluded_reason", None),
                "rating": _evidence_star_rating(ev, review_ratings),
            }
            for ev in ev_list
        ],
        "insight": None
        if insight is None
        else {
            "insight_id": insight.insight_id,
            "problem": insight.problem,
            "desire": insight.desire,
            "barrier": insight.barrier,
            "customer_language": _loads(insight.customer_language_json, []),
            "trend": insight.trend,
            "evidence_count": insight.evidence_count,
        },
        "as_of_date": row.as_of_date.isoformat() if row.as_of_date else None,
    }


def list_appeals(db: Session, *, sku_id: str | None = None, phase1_only: bool = True) -> list[dict[str, Any]]:
    q = db.query(ContentAppealPoint)
    if sku_id:
        q = q.filter(ContentAppealPoint.sku_id == sku_id)
    elif phase1_only:
        enabled = [row.sku_id for row in list_sku_scope(db, phase1_only=True)]
        if enabled:
            q = q.filter(ContentAppealPoint.sku_id.in_(enabled))
    rows = _visible_canonical_appeals(
        q.order_by(ContentAppealPoint.overall_score.desc(), ContentAppealPoint.updated_at.desc()).all(),
        collapse_across_skus=sku_id is None,
    )
    out = []
    for row in rows:
        insight = db.query(ContentInsight).filter(ContentInsight.insight_id == row.insight_id).one_or_none() if row.insight_id else None
        evidence = (
            db.query(ContentAppealEvidence)
            .filter(ContentAppealEvidence.appeal_id == row.appeal_id)
            .order_by(ContentAppealEvidence.created_at.asc())
            .all()
        )
        out.append(appeal_to_dict(row, evidence=evidence, insight=insight, db=db))
    return out


def get_appeal(db: Session, appeal_id: str) -> dict[str, Any] | None:
    row = db.query(ContentAppealPoint).filter(ContentAppealPoint.appeal_id == appeal_id).one_or_none()
    if row is None:
        return None
    insight = db.query(ContentInsight).filter(ContentInsight.insight_id == row.insight_id).one_or_none() if row.insight_id else None
    evidence = db.query(ContentAppealEvidence).filter(ContentAppealEvidence.appeal_id == row.appeal_id).all()
    return appeal_to_dict(row, evidence=evidence, insight=insight, db=db)


def apply_appeal_to_gfa_brief(brief: dict[str, Any], appeal: dict[str, Any]) -> dict[str, Any]:
    out = dict(brief or {})
    insight = appeal.get("insight") if isinstance(appeal.get("insight"), dict) else {}
    languages = insight.get("customer_language") if isinstance(insight.get("customer_language"), list) else []
    out["generation_source"] = "appeal"
    out["appeal_point_id"] = appeal.get("appeal_id")
    out["appeal_point"] = {
        "appeal_id": appeal.get("appeal_id"),
        "label": appeal.get("label"),
        "appeal_text": appeal.get("appeal_text"),
        "problem": insight.get("problem"),
        "desire": insight.get("desire"),
        "customer_language": languages,
        "scores": appeal.get("scores"),
        "claim_class": appeal.get("claim_class"),
        "legal_risk": appeal.get("legal_risk"),
    }
    out["why_this_source"] = (
        f"고객 데이터 소구 {appeal.get('appeal_id')} — {appeal.get('label')}. "
        f"Evidence {appeal.get('evidence_count') or 0}건."
    )
    out["copy_elements"] = (
        f"소구: {appeal.get('appeal_text')}\n"
        f"문제: {insight.get('problem') or ''}\n"
        f"욕구: {insight.get('desire') or ''}\n"
        f"고객 언어: {', '.join(str(x) for x in languages[:6])}"
    )
    return out
