from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import uuid
import re

from sqlalchemy.orm import Session
from sqlalchemy import func

from db import (
    CommerceQnaAnalysis,
    CommerceQnaAnalysisIssueTag,
    CommerceQnaAnalysisKeyword,
    CommerceQnaRaw,
)
from schemas import (
    QnaAnalysisActionGuideItem,
    QnaAnalysisItemDetail,
    QnaAnalysisItemRecord,
    QnaAnalysisItemsResponse,
    QnaAnalysisProductSummaryItem,
    QnaAnalysisRunRequest,
    QnaAnalysisRunResponse,
    QnaAnalysisSummaryMetrics,
    QnaAnalysisSummaryResponse,
    QnaAnalysisTrendPoint,
    QnaAnalysisTrendsResponse,
    QnaConversionBarrierItem,
    QnaConversionBarriersResponse,
    QnaFaqCandidateItem,
    QnaFaqCandidatesResponse,
    QnaMarketingCopyCandidateItem,
    QnaMarketingInsightsResponse,
    QnaMarketingKeywordItem,
    QnaQualityIssueItem,
    QnaQualityIssuesResponse,
)


ANALYSIS_PIPELINE_VERSION = "qna_expert_analysis_v1"
_KST = ZoneInfo("Asia/Seoul")
ISSUE_TAG_DISPLAY_LABELS: dict[str, str] = {
    "ODOR": "냄새",
    "IRRITATION": "자극",
    "COLOR_DIFF": "색상",
    "SAFETY_CHECK": "안전성",
    "SHIPPING_DELAY": "배송",
    "DURATION": "지속력",
}
QUALITY_ISSUE_PRIORITY: dict[str, int] = {
    "ODOR": 120,
    "IRRITATION": 110,
    "COLOR_DIFF": 100,
    "SAFETY_CHECK": 90,
    "SHIPPING_DELAY": 80,
    "DURATION": 70,
}


def _now_kst() -> datetime:
    return datetime.now(_KST)


def _collapse_text(value: object, limit: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) > limit:
        return text[:limit].rstrip()
    return text


def _normalize_range(from_date: date | None, to_date: date | None, *, default_days: int = 30) -> tuple[date, date]:
    if from_date is None and to_date is None:
        to0 = date.today()
        from0 = to0 - timedelta(days=max(0, default_days - 1))
        return from0, to0
    if from_date is None and to_date is not None:
        return to_date - timedelta(days=max(0, default_days - 1)), to_date
    if from_date is not None and to_date is None:
        return from_date, from_date + timedelta(days=max(0, default_days - 1))
    assert from_date is not None and to_date is not None
    return (to_date, from_date) if from_date > to_date else (from_date, to_date)


def _filter_raw_rows(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    limit: int | None = None,
) -> list[CommerceQnaRaw]:
    from0, to0 = _normalize_range(from_date, to_date)
    query = db.query(CommerceQnaRaw).filter(func.date(CommerceQnaRaw.inquiry_registered_at) >= from0).filter(
        func.date(CommerceQnaRaw.inquiry_registered_at) <= to0
    )
    qna_kind0 = str(qna_kind or "all").strip()
    if qna_kind0 in ("customer", "product"):
        query = query.filter(CommerceQnaRaw.qna_kind == qna_kind0)
    query = query.order_by(CommerceQnaRaw.inquiry_registered_at.asc(), CommerceQnaRaw.qna_key.asc())
    if limit:
        query = query.limit(int(limit))
    return query.all()


def _build_keyword_catalog(text: str) -> list[str]:
    candidates = [
        ("민감성 두피", ["민감", "두피"]),
        ("안전성", ["안전", "성분", "부작용"]),
        ("지속력", ["지속", "오래가"]),
        ("효과", ["효과", "효능"]),
        ("냄새", ["냄새", "향"]),
        ("색상", ["색상", "컬러"]),
        ("배송", ["배송", "출고", "도착"]),
        ("사용법", ["사용법", "어떻게", "방법"]),
        ("가격", ["가격", "할인", "쿠폰", "혜택"]),
        ("비교", ["비교", "차이", "다른 제품", "경쟁"]),
    ]
    hits: list[str] = []
    for keyword, tokens in candidates:
        if any(token in text for token in tokens):
            hits.append(keyword)
    return hits


def _build_issue_tags(text: str) -> list[tuple[str, str]]:
    rules = [
        ("ODOR", "HIGH", ["냄새", "향이 강"]),
        ("IRRITATION", "HIGH", ["자극", "따갑", "민감"]),
        ("COLOR_DIFF", "MEDIUM", ["색상", "컬러"]),
        ("SAFETY_CHECK", "MEDIUM", ["안전", "성분", "부작용"]),
        ("SHIPPING_DELAY", "MEDIUM", ["배송", "출고", "도착"]),
        ("DURATION", "MEDIUM", ["지속", "오래가"]),
    ]
    out: list[tuple[str, str]] = []
    for issue_tag, severity, tokens in rules:
        if any(token in text for token in tokens):
            out.append((issue_tag, severity))
    return out


def _infer_inquiry_type(text: str) -> tuple[str, str]:
    if any(token in text for token in ["불만", "환불", "반품", "교환", "따갑", "문제", "이상", "냄새가 심", "색상이 달"]):
        if "냄새" in text:
            return "불만문의", "냄새"
        if "색상" in text:
            return "불만문의", "색상"
        return "불만문의", "클레임"
    if any(token in text for token in ["민감", "안전", "성분", "부작용", "자극"]):
        return "안전성문의", "안전성"
    if any(token in text for token in ["지속", "효과", "효능", "오래가"]):
        return "효과문의", "지속력"
    if any(token in text for token in ["비교", "차이", "다른 제품", "경쟁"]):
        return "비교문의", "비교"
    if any(token in text for token in ["가격", "할인", "쿠폰", "혜택"]):
        return "가격문의", "가격"
    if any(token in text for token in ["배송", "출고", "도착", "택배"]):
        return "배송문의", "배송"
    if any(token in text for token in ["사용법", "어떻게", "방법"]):
        return "사용법문의", "사용법"
    return "제품정보문의", "제품정보"


def _infer_purchase_stage(text: str, inquiry_type: str) -> str:
    if any(token in text for token in ["비교", "차이", "다른 제품", "경쟁"]):
        return "비교검토"
    if any(token in text for token in ["환불", "반품", "교환", "불만"]):
        return "클레임"
    if "사용 후" in text or any(token in text for token in ["따갑", "문제", "불편", "냄새가", "색상이 달"]):
        return "구매후사용"
    if any(token in text for token in ["구매 전", "구매전에", "구매 전에", "구매 직전", "주문 전", "결제 전"]):
        return "구매직전"
    if inquiry_type in ("효과문의", "가격문의", "안전성문의"):
        return "구매직전"
    return "탐색"


def _infer_sentiment(text: str) -> str:
    if any(token in text for token in ["불만", "문제", "심하", "따갑", "이상", "걱정"]):
        return "NEGATIVE"
    if any(token in text for token in ["좋", "만족", "추천"]):
        return "POSITIVE"
    return "NEUTRAL"


def _infer_urgency(text: str, purchase_stage: str, sentiment: str) -> str:
    if any(token in text for token in ["급", "빨리", "당장", "즉시"]) or purchase_stage == "구매직전":
        return "HIGH"
    if sentiment == "NEGATIVE" or purchase_stage in ("비교검토", "구매후사용"):
        return "MEDIUM"
    return "LOW"


def _primary_need(inquiry_type: str, keywords: list[str]) -> str:
    if inquiry_type == "안전성문의":
        return "안전성"
    if inquiry_type == "효과문의":
        return "효과"
    if inquiry_type == "배송문의":
        return "배송"
    if inquiry_type == "가격문의":
        return "가격"
    if "사용법" in keywords:
        return "사용편의성"
    if inquiry_type == "비교문의":
        return "비교판단"
    if inquiry_type == "불만문의":
        return "문제해결"
    return "기타"


def _conversion_score(text: str, inquiry_type: str, purchase_stage: str) -> float:
    base = {
        "탐색": 25.0,
        "비교검토": 55.0,
        "구매직전": 80.0,
        "구매후사용": 20.0,
        "클레임": 10.0,
    }.get(purchase_stage, 20.0)
    type_bonus = {
        "효과문의": 10.0,
        "안전성문의": 10.0,
        "비교문의": 8.0,
        "가격문의": 5.0,
        "배송문의": -10.0,
        "불만문의": -5.0,
    }.get(inquiry_type, 0.0)
    keyword_bonus = 0.0
    for token in ["구매", "지속", "효과", "안전", "민감", "비교"]:
        if token in text:
            keyword_bonus += 4.0
    return max(0.0, min(100.0, base + type_bonus + keyword_bonus))


def _conversion_level(score: float) -> str:
    if score >= 70:
        return "HIGH"
    if score >= 45:
        return "MEDIUM"
    return "LOW"


def _recommended_action(*, quality_issue_flag: bool, faq_candidate_flag: bool, marketing_signal_flag: bool, inquiry_type: str, issue_tags: list[str]) -> str:
    if quality_issue_flag or issue_tags:
        return "품질 검토와 사용 가이드 보강이 필요합니다."
    if faq_candidate_flag and inquiry_type in ("효과문의", "안전성문의", "비교문의", "제품정보문의"):
        return "FAQ와 상세페이지 관련 섹션을 강화하세요."
    if marketing_signal_flag:
        return "광고/상세페이지 카피 후보로 검토하세요."
    return "운영 FAQ 후보로 우선 검토하세요."


def _analyze_row(row: CommerceQnaRaw) -> dict[str, object]:
    text = _collapse_text(getattr(row, "inquiry_text", ""))
    inquiry_type, inquiry_subtype = _infer_inquiry_type(text)
    purchase_stage = _infer_purchase_stage(text, inquiry_type)
    sentiment = _infer_sentiment(text)
    urgency_level = _infer_urgency(text, purchase_stage, sentiment)
    keyword_hits = _build_keyword_catalog(text)
    issue_tags_with_severity = _build_issue_tags(text)
    issue_tags = [tag for tag, _severity in issue_tags_with_severity]
    score = _conversion_score(text, inquiry_type, purchase_stage)
    conversion_level = _conversion_level(score)
    complaint_flag = inquiry_type == "불만문의" or sentiment == "NEGATIVE"
    quality_issue_flag = any(tag in issue_tags for tag in ["ODOR", "IRRITATION", "COLOR_DIFF", "SAFETY_CHECK"]) or complaint_flag
    marketing_signal_flag = sentiment != "NEGATIVE" and inquiry_type in ("효과문의", "안전성문의", "비교문의", "제품정보문의")
    faq_candidate_flag = score >= 60 or inquiry_type in ("효과문의", "안전성문의", "비교문의")
    summary_text = (
        f"{purchase_stage} 단계의 {inquiry_type}로, "
        f"{', '.join(keyword_hits[:2]) or inquiry_subtype} 중심 문의"
    )
    recommended_action = _recommended_action(
        quality_issue_flag=quality_issue_flag,
        faq_candidate_flag=faq_candidate_flag,
        marketing_signal_flag=marketing_signal_flag,
        inquiry_type=inquiry_type,
        issue_tags=issue_tags,
    )
    return {
        "qna_key": str(getattr(row, "qna_key", "") or ""),
        "qna_kind": str(getattr(row, "qna_kind", "") or ""),
        "inquiry_type": inquiry_type,
        "inquiry_subtype": inquiry_subtype,
        "purchase_stage": purchase_stage,
        "sentiment": sentiment,
        "urgency_level": urgency_level,
        "conversion_impact_level": conversion_level,
        "conversion_impact_score": score,
        "complaint_flag": complaint_flag,
        "quality_issue_flag": quality_issue_flag,
        "marketing_signal_flag": marketing_signal_flag,
        "faq_candidate_flag": faq_candidate_flag,
        "competitor_mentioned_flag": "경쟁" in text or "다른 제품" in text,
        "competitor_name": "경쟁사" if ("경쟁" in text or "다른 제품" in text) else None,
        "primary_need": _primary_need(inquiry_type, keyword_hits),
        "summary_text": summary_text,
        "recommended_action": recommended_action,
        "confidence_score": 82.0,
        "model_name": "rules-only",
        "pipeline_version": ANALYSIS_PIPELINE_VERSION,
        "llm_used": False,
        "keywords": keyword_hits,
        "issue_tags_with_severity": issue_tags_with_severity,
    }


def _keyword_map(db: Session, qna_keys: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    if not qna_keys:
        return {}
    rows = db.query(CommerceQnaAnalysisKeyword).filter(CommerceQnaAnalysisKeyword.qna_key.in_(qna_keys)).all()
    for row in rows:
        key = str(getattr(row, "qna_key", "") or "")
        keyword = str(getattr(row, "keyword", "") or "").strip()
        if key and keyword:
            out[key].append(keyword)
    return dict(out)


def _issue_tag_map(db: Session, qna_keys: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    if not qna_keys:
        return {}
    rows = db.query(CommerceQnaAnalysisIssueTag).filter(CommerceQnaAnalysisIssueTag.qna_key.in_(qna_keys)).all()
    for row in rows:
        key = str(getattr(row, "qna_key", "") or "")
        issue_tag = str(getattr(row, "issue_tag", "") or "").strip()
        if key and issue_tag:
            out[key].append(issue_tag)
    return dict(out)


def _display_issue_tag(value: str) -> str:
    key = str(value or "").strip().upper()
    if not key:
        return ""
    return ISSUE_TAG_DISPLAY_LABELS.get(key, key)


def _display_issue_tags(values: list[str] | tuple[str, ...]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        label = _display_issue_tag(str(value or ""))
        if label and label not in seen:
            out.append(label)
            seen.add(label)
    return out


def _quality_issue_rank_key(*, qna_kind: str, sentiment: str | None, issue_tags: list[str]) -> tuple[int, int, int]:
    severity_score = 2 if any(tag in issue_tags for tag in ["ODOR", "IRRITATION"]) else 1
    complaint_score = 1 if str(sentiment or "").upper() == "NEGATIVE" else 0
    kind_score = 1 if str(qna_kind or "").strip() == "product" else 0
    tag_priority = max((QUALITY_ISSUE_PRIORITY.get(str(tag or "").strip().upper(), 0) for tag in issue_tags), default=0)
    return (severity_score, complaint_score + kind_score, tag_priority)


def _analysis_map(db: Session, qna_keys: list[str]) -> dict[str, CommerceQnaAnalysis]:
    if not qna_keys:
        return {}
    rows = db.query(CommerceQnaAnalysis).filter(CommerceQnaAnalysis.qna_key.in_(qna_keys)).all()
    return {str(getattr(row, "qna_key", "") or ""): row for row in rows}


def run_qna_analysis(db: Session, payload: QnaAnalysisRunRequest) -> QnaAnalysisRunResponse:
    rows = _filter_raw_rows(
        db,
        from_date=payload.from_date,
        to_date=payload.to_date,
        qna_kind=payload.qna_kind,
        limit=payload.limit,
    )
    analyzed_count = 0
    skipped_count = 0
    llm_used_count = 0
    now = _now_kst()
    for row in rows:
        qna_key = str(getattr(row, "qna_key", "") or "")
        existing = db.query(CommerceQnaAnalysis).filter(CommerceQnaAnalysis.qna_key == qna_key).one_or_none()
        if existing is not None and not bool(payload.force_reanalyze):
            skipped_count += 1
            continue
        result = _analyze_row(row)
        if existing is None:
            existing = CommerceQnaAnalysis(analysis_id=str(uuid.uuid4()), qna_key=qna_key)
            db.add(existing)
        existing.qna_kind = str(result["qna_kind"])
        existing.inquiry_type = str(result["inquiry_type"])
        existing.inquiry_subtype = str(result["inquiry_subtype"])
        existing.purchase_stage = str(result["purchase_stage"])
        existing.sentiment = str(result["sentiment"])
        existing.urgency_level = str(result["urgency_level"])
        existing.conversion_impact_level = str(result["conversion_impact_level"])
        existing.conversion_impact_score = float(result["conversion_impact_score"])
        existing.complaint_flag = bool(result["complaint_flag"])
        existing.quality_issue_flag = bool(result["quality_issue_flag"])
        existing.marketing_signal_flag = bool(result["marketing_signal_flag"])
        existing.faq_candidate_flag = bool(result["faq_candidate_flag"])
        existing.competitor_mentioned_flag = bool(result["competitor_mentioned_flag"])
        existing.competitor_name = result["competitor_name"]
        existing.primary_need = result["primary_need"]
        existing.summary_text = result["summary_text"]
        existing.recommended_action = result["recommended_action"]
        existing.confidence_score = float(result["confidence_score"])
        existing.model_name = str(result["model_name"])
        existing.pipeline_version = str(result["pipeline_version"])
        existing.llm_used = bool(result["llm_used"])
        existing.analyzed_at = now
        existing.updated_at = now
        db.flush()

        db.query(CommerceQnaAnalysisKeyword).filter(CommerceQnaAnalysisKeyword.qna_key == qna_key).delete(synchronize_session=False)
        db.query(CommerceQnaAnalysisIssueTag).filter(CommerceQnaAnalysisIssueTag.qna_key == qna_key).delete(synchronize_session=False)
        for keyword in result["keywords"]:
            db.add(
                CommerceQnaAnalysisKeyword(
                    qna_key=qna_key,
                    keyword=str(keyword),
                    keyword_type="general",
                    weight=1.0,
                )
            )
        for issue_tag, severity in result["issue_tags_with_severity"]:
            db.add(
                CommerceQnaAnalysisIssueTag(
                    qna_key=qna_key,
                    issue_tag=str(issue_tag),
                    severity=str(severity),
                )
            )
        if bool(result["llm_used"]):
            llm_used_count += 1
        analyzed_count += 1
    db.commit()
    return QnaAnalysisRunResponse(
        ok=True,
        requested_count=len(rows),
        analyzed_count=analyzed_count,
        skipped_count=skipped_count,
        llm_used_count=llm_used_count,
    )


def _filtered_pairs(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> list[tuple[CommerceQnaRaw, CommerceQnaAnalysis | None]]:
    rows = _filter_raw_rows(db, from_date=from_date, to_date=to_date, qna_kind=qna_kind)
    qna_keys = [str(getattr(row, "qna_key", "") or "") for row in rows]
    analysis_map = _analysis_map(db, qna_keys)
    product_name0 = str(product_name or "").strip().lower()
    category0 = str(category or "").strip().lower()
    inquiry_type0 = str(inquiry_type or "").strip()
    conversion_level0 = str(conversion_level or "").strip().upper()
    purchase_stage0 = str(purchase_stage or "").strip()
    sentiment0 = str(sentiment or "").strip().upper()
    search0 = str(search or "").strip().lower()
    out: list[tuple[CommerceQnaRaw, CommerceQnaAnalysis | None]] = []
    for row in rows:
        analysis = analysis_map.get(str(getattr(row, "qna_key", "") or ""))
        row_product_name = str(getattr(row, "product_name", "") or "")
        row_category = str(getattr(row, "category", "") or "")
        row_inquiry_text = str(getattr(row, "inquiry_text", "") or "")
        if product_name0 and product_name0 not in row_product_name.lower():
            continue
        if category0 and category0 not in row_category.lower():
            continue
        if search0 and search0 not in row_product_name.lower() and search0 not in row_inquiry_text.lower():
            continue
        if inquiry_type0:
            if analysis is None or str(getattr(analysis, "inquiry_type", "") or "") != inquiry_type0:
                continue
        if conversion_level0:
            if analysis is None or str(getattr(analysis, "conversion_impact_level", "") or "").upper() != conversion_level0:
                continue
        if purchase_stage0:
            if analysis is None or str(getattr(analysis, "purchase_stage", "") or "") != purchase_stage0:
                continue
        if sentiment0:
            if analysis is None or str(getattr(analysis, "sentiment", "") or "").upper() != sentiment0:
                continue
        out.append((row, analysis))
    return out


def build_qna_analysis_summary(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> QnaAnalysisSummaryResponse:
    pairs = _filtered_pairs(
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
    total_items = len(pairs)
    analyzed_pairs = [(row, analysis) for row, analysis in pairs if analysis is not None]
    inquiry_type_counts: Counter[str] = Counter()
    purchase_stage_counts: Counter[str] = Counter()
    sentiment_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()
    product_rollup: dict[str, dict[str, int]] = defaultdict(lambda: {
        "total_items": 0,
        "high_conversion_count": 0,
        "negative_count": 0,
        "faq_candidate_count": 0,
    })
    purchase_ready_count = 0
    negative_count = 0
    high_conversion_count = 0
    faq_candidate_count = 0
    customer_count = 0
    product_count = 0
    answered_count = 0
    for row, analysis in pairs:
        if bool(getattr(row, "answered", False)):
            answered_count += 1
        if str(getattr(row, "qna_kind", "") or "") == "customer":
            customer_count += 1
        elif str(getattr(row, "qna_kind", "") or "") == "product":
            product_count += 1
        category = str(getattr(row, "category", "") or "").strip() or "미분류"
        category_counts[category] += 1
        product_name = str(getattr(row, "product_name", "") or "").strip() or "미확인 상품"
        product_rollup[product_name]["total_items"] += 1
        if analysis is None:
            continue
        inquiry_type = str(getattr(analysis, "inquiry_type", "") or "").strip() or "미분류"
        stage = str(getattr(analysis, "purchase_stage", "") or "").strip() or "미분류"
        sentiment = str(getattr(analysis, "sentiment", "") or "").strip() or "UNKNOWN"
        inquiry_type_counts[inquiry_type] += 1
        purchase_stage_counts[stage] += 1
        sentiment_counts[sentiment] += 1
        if stage == "구매직전":
            purchase_ready_count += 1
        if sentiment == "NEGATIVE":
            negative_count += 1
            product_rollup[product_name]["negative_count"] += 1
        if float(getattr(analysis, "conversion_impact_score", 0.0) or 0.0) >= 70.0:
            high_conversion_count += 1
            product_rollup[product_name]["high_conversion_count"] += 1
        if bool(getattr(analysis, "faq_candidate_flag", False)):
            faq_candidate_count += 1
            product_rollup[product_name]["faq_candidate_count"] += 1
    top_products = sorted(
        [
            QnaAnalysisProductSummaryItem(
                product_name=product_name,
                total_items=metrics["total_items"],
                high_conversion_count=metrics["high_conversion_count"],
                negative_count=metrics["negative_count"],
                faq_candidate_count=metrics["faq_candidate_count"],
            )
            for product_name, metrics in product_rollup.items()
        ],
        key=lambda item: (-item.total_items, -item.high_conversion_count, item.product_name),
    )[:10]
    action_guides: list[QnaAnalysisActionGuideItem] = []
    if faq_candidate_count > 0 or purchase_ready_count > 0:
        action_guides.append(
            QnaAnalysisActionGuideItem(
                title="FAQ 먼저 보강",
                why=f"구매직전 문의 {purchase_ready_count}건, FAQ 후보 {faq_candidate_count}건이 확인됩니다.",
                what_to_do="반복되는 구매 전 질문을 FAQ와 상세페이지 상단 핵심 문구로 먼저 반영하세요.",
                target_area="FAQ/상세페이지",
                priority="high" if purchase_ready_count > 0 else "medium",
            )
        )
    if negative_count > 0:
        action_guides.append(
            QnaAnalysisActionGuideItem(
                title="부정 문의 원인 점검",
                why=f"부정 문의가 {negative_count}건 발생해 품질/설명/운영 이슈 가능성이 있습니다.",
                what_to_do="부정 문의 원문을 검토해 품질 이슈, 설명 부족, 오해 유발 문구를 분리하고 우선순위를 정하세요.",
                target_area="상품 개선",
                priority="high",
            )
        )
    if high_conversion_count > 0:
        action_guides.append(
            QnaAnalysisActionGuideItem(
                title="전환 장애 문구 개선",
                why=f"고전환 영향 문의가 {high_conversion_count}건 있어 구매 직전 장벽이 드러납니다.",
                what_to_do="전환장애 TOP 질문을 상세페이지 비교표, 구매 전 안내, 광고 랜딩 메시지에 바로 반영하세요.",
                target_area="상세페이지/랜딩",
                priority="high",
            )
        )
    if inquiry_type_counts:
        top_inquiry_type = max(inquiry_type_counts.items(), key=lambda item: item[1])
        action_guides.append(
            QnaAnalysisActionGuideItem(
                title="가장 많이 들어오는 질문부터 표준화",
                why=f"현재 가장 많은 문의 유형은 `{top_inquiry_type[0]}` ({top_inquiry_type[1]}건) 입니다.",
                what_to_do="이 유형에 대한 표준 답변, FAQ 문안, 운영 가이드를 먼저 만들어 반복 대응 비용을 줄이세요.",
                target_area="운영 표준화",
                priority="medium",
            )
        )
    action_guides = action_guides[:4]
    return QnaAnalysisSummaryResponse(
        ok=True,
        summary=QnaAnalysisSummaryMetrics(
            total_items=total_items,
            purchase_ready_count=purchase_ready_count,
            negative_count=negative_count,
            high_conversion_count=high_conversion_count,
            faq_candidate_count=faq_candidate_count,
            customer_count=customer_count,
            product_count=product_count,
            answered_count=answered_count,
            unanswered_count=max(0, total_items - answered_count),
            analysis_coverage_rate=round((len(analyzed_pairs) / total_items) * 100.0, 2) if total_items else 0.0,
        ),
        inquiry_type_counts=dict(inquiry_type_counts),
        purchase_stage_counts=dict(purchase_stage_counts),
        sentiment_counts=dict(sentiment_counts),
        category_counts=dict(category_counts),
        top_products=top_products,
        action_guides=action_guides,
    )


def build_qna_analysis_trends(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> QnaAnalysisTrendsResponse:
    pairs = _filtered_pairs(
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
    by_day: dict[str, dict[str, int]] = defaultdict(lambda: {
        "total_items": 0,
        "negative_count": 0,
        "faq_candidate_count": 0,
        "high_conversion_count": 0,
    })
    for row, analysis in pairs:
        registered_at = getattr(row, "inquiry_registered_at", None)
        if registered_at is None:
            continue
        key = registered_at.astimezone(_KST).date().isoformat() if hasattr(registered_at, "astimezone") else str(registered_at)[:10]
        by_day[key]["total_items"] += 1
        if analysis is None:
            continue
        if str(getattr(analysis, "sentiment", "") or "") == "NEGATIVE":
            by_day[key]["negative_count"] += 1
        if bool(getattr(analysis, "faq_candidate_flag", False)):
            by_day[key]["faq_candidate_count"] += 1
        if float(getattr(analysis, "conversion_impact_score", 0.0) or 0.0) >= 70.0:
            by_day[key]["high_conversion_count"] += 1
    points = [
        QnaAnalysisTrendPoint(
            date=day,
            total_items=metrics["total_items"],
            negative_count=metrics["negative_count"],
            faq_candidate_count=metrics["faq_candidate_count"],
            high_conversion_count=metrics["high_conversion_count"],
        )
        for day, metrics in sorted(by_day.items(), key=lambda item: item[0])
    ]
    return QnaAnalysisTrendsResponse(ok=True, points=points)


def build_qna_conversion_barriers(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> QnaConversionBarriersResponse:
    pairs = _filtered_pairs(
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
    items: list[QnaConversionBarrierItem] = []
    for row, analysis in pairs:
        if analysis is None:
            continue
        stage = str(getattr(analysis, "purchase_stage", "") or "")
        score = float(getattr(analysis, "conversion_impact_score", 0.0) or 0.0)
        if stage not in ("비교검토", "구매직전") and score < 70.0:
            continue
        items.append(
            QnaConversionBarrierItem(
                qna_key=str(getattr(row, "qna_key", "") or ""),
                product_name=getattr(row, "product_name", None),
                inquiry_text=str(getattr(row, "inquiry_text", "") or ""),
                inquiry_type=getattr(analysis, "inquiry_type", None),
                purchase_stage=stage or None,
                conversion_impact_score=score,
                faq_candidate=bool(getattr(analysis, "faq_candidate_flag", False)),
                recommended_action=getattr(analysis, "recommended_action", None),
            )
        )
    items.sort(key=lambda item: (-item.conversion_impact_score, item.qna_key))
    return QnaConversionBarriersResponse(ok=True, items=items[:20])


def build_qna_quality_issues(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> QnaQualityIssuesResponse:
    pairs = _filtered_pairs(
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
    qna_keys = [str(getattr(row, "qna_key", "") or "") for row, _analysis in pairs]
    issue_map = _issue_tag_map(db, qna_keys)
    ranked_items: list[tuple[tuple[int, int, int], QnaQualityIssueItem]] = []
    for row, analysis in pairs:
        if analysis is None:
            continue
        qna_key = str(getattr(row, "qna_key", "") or "")
        if not bool(getattr(analysis, "quality_issue_flag", False)) and str(getattr(analysis, "sentiment", "") or "") != "NEGATIVE":
            continue
        issue_tags = issue_map.get(qna_key, [])
        severity = "HIGH" if any(tag in issue_tags for tag in ["ODOR", "IRRITATION"]) else "MEDIUM"
        ranked_items.append(
            (
                _quality_issue_rank_key(
                    qna_kind=str(getattr(row, "qna_kind", "") or ""),
                    sentiment=getattr(analysis, "sentiment", None),
                    issue_tags=issue_tags,
                ),
                QnaQualityIssueItem(
                    qna_key=qna_key,
                    product_name=getattr(row, "product_name", None),
                    inquiry_text=str(getattr(row, "inquiry_text", "") or ""),
                    issue_tags=_display_issue_tags(issue_tags),
                    sentiment=getattr(analysis, "sentiment", None),
                    severity=severity,
                    recommended_action=getattr(analysis, "recommended_action", None),
                ),
            )
        )
    ranked_items.sort(key=lambda entry: (-entry[0][0], -entry[0][1], -entry[0][2], entry[1].qna_key))
    items = [item for _rank_key, item in ranked_items]
    return QnaQualityIssuesResponse(ok=True, items=items[:20])


def build_qna_faq_candidates(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> QnaFaqCandidatesResponse:
    pairs = _filtered_pairs(
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
    items: list[QnaFaqCandidateItem] = []
    for row, analysis in pairs:
        if analysis is None or not bool(getattr(analysis, "faq_candidate_flag", False)):
            continue
        section = "FAQ > 안전성" if str(getattr(analysis, "inquiry_type", "") or "") == "안전성문의" else "FAQ > 구매 전환"
        items.append(
            QnaFaqCandidateItem(
                qna_key=str(getattr(row, "qna_key", "") or ""),
                product_name=getattr(row, "product_name", None),
                inquiry_text=str(getattr(row, "inquiry_text", "") or ""),
                faq_candidate=True,
                conversion_impact_score=float(getattr(analysis, "conversion_impact_score", 0.0) or 0.0),
                recommended_answer=str(getattr(analysis, "summary_text", "") or ""),
                recommended_section=section,
            )
        )
    items.sort(key=lambda item: (-item.conversion_impact_score, item.qna_key))
    return QnaFaqCandidatesResponse(ok=True, items=items[:20])


def build_qna_marketing_insights(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> QnaMarketingInsightsResponse:
    pairs = _filtered_pairs(
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
    qna_keys = [str(getattr(row, "qna_key", "") or "") for row, _analysis in pairs]
    keyword_map = _keyword_map(db, qna_keys)
    keyword_counter: Counter[str] = Counter()
    keyword_sentiment: dict[str, str] = {}
    copy_counter: Counter[str] = Counter()
    for row, analysis in pairs:
        if analysis is None:
            continue
        qna_key = str(getattr(row, "qna_key", "") or "")
        sentiment = str(getattr(analysis, "sentiment", "") or "")
        if bool(getattr(analysis, "marketing_signal_flag", False)):
            inquiry_text = _collapse_text(getattr(row, "inquiry_text", ""), 80)
            copy_counter[inquiry_text] += 1
        for keyword in keyword_map.get(qna_key, []):
            keyword_counter[keyword] += 1
            keyword_sentiment[keyword] = sentiment or keyword_sentiment.get(keyword, "NEUTRAL")
    top_keywords = [
        QnaMarketingKeywordItem(
            keyword=keyword,
            count=count,
            sentiment=keyword_sentiment.get(keyword, "NEUTRAL"),
            recommended_usage=f"{keyword} 중심 상세페이지/광고 카피",
        )
        for keyword, count in keyword_counter.most_common(20)
    ]
    copy_candidates = [
        QnaMarketingCopyCandidateItem(
            phrase=phrase,
            source_count=count,
            recommended_channel="상세페이지 첫 화면",
        )
        for phrase, count in copy_counter.most_common(10)
    ]
    return QnaMarketingInsightsResponse(ok=True, top_keywords=top_keywords, copy_candidates=copy_candidates)


def build_qna_analysis_items(
    db: Session,
    *,
    from_date: date | None,
    to_date: date | None,
    qna_kind: str = "all",
    product_name: str | None = None,
    category: str | None = None,
    inquiry_type: str | None = None,
    conversion_level: str | None = None,
    purchase_stage: str | None = None,
    sentiment: str | None = None,
    search: str | None = None,
) -> QnaAnalysisItemsResponse:
    pairs = _filtered_pairs(
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
    qna_keys = [str(getattr(row, "qna_key", "") or "") for row, _analysis in pairs]
    keyword_map = _keyword_map(db, qna_keys)
    issue_map = _issue_tag_map(db, qna_keys)
    items: list[QnaAnalysisItemRecord] = []
    for row, analysis in pairs:
        if analysis is None:
            continue
        qna_key = str(getattr(row, "qna_key", "") or "")
        inquiry_text = str(getattr(row, "inquiry_text", "") or "")
        items.append(
            QnaAnalysisItemRecord(
                qna_key=qna_key,
                qna_kind=str(getattr(row, "qna_kind", "") or ""),
                product_name=getattr(row, "product_name", None),
                inquiry_text=inquiry_text,
                inquiry_registered_at=getattr(row, "inquiry_registered_at", None),
                analysis=QnaAnalysisItemDetail(
                    inquiry_type=getattr(analysis, "inquiry_type", None),
                    purchase_stage=getattr(analysis, "purchase_stage", None),
                    sentiment=getattr(analysis, "sentiment", None),
                    conversion_impact_score=float(getattr(analysis, "conversion_impact_score", 0.0) or 0.0),
                    keywords=keyword_map.get(qna_key, []),
                    issue_tags=_display_issue_tags(issue_map.get(qna_key, [])),
                    summary_text=getattr(analysis, "summary_text", None),
                ),
                recommended_action=getattr(analysis, "recommended_action", None),
            )
        )
    return QnaAnalysisItemsResponse(ok=True, total_items=len(items), items=items)
