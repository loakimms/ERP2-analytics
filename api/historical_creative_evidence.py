from collections import Counter
from datetime import date
from typing import Any


ENGINE_VERSION = "historical-creative-evidence-engine-v1"

PRIMARY_FEATURES = {
    "appeal_type",
    "pain_point",
    "problem",
    "gray_hair",
    "hair_condition",
    "product_visibility",
    "before_after",
}
SECONDARY_FEATURES = {
    "purchase_stage",
    "benefit",
    "core_promise",
    "usp",
    "cta",
    "visual_focus",
    "product_usage_scene",
    "ingredient_visibility",
    "natural_background",
    "body_part_closeup",
    "composition",
}
LIMITED_FEATURES = {"gender", "age_group", "age_range", "face_visibility", "color_tone", "mood", "closeup"}
VISUAL_SIGNATURE_FEATURES = {
    "gray_hair",
    "hair_condition",
    "before_after",
    "body_part_closeup",
    "visual_focus",
    "product_usage_scene",
    "composition",
}
MESSAGE_SIGNATURE_FEATURES = {"appeal_type", "pain_point", "problem", "benefit", "core_promise", "usp", "cta"}
STRICT_REQUIRED_MATCH_FEATURES = {"pain_point", "problem", "gray_hair", "hair_condition", "before_after"}
MATCHABLE_STATUSES = {"EXACT", "NORMALIZED", "DERIVED"}

EVIDENCE_LABELS = {
    "HIGH": "근거 충분",
    "MEDIUM": "참고 가능",
    "LOW": "근거 적음",
    "INSUFFICIENT": "판단하기 어려움",
}


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _int(value: Any) -> int:
    return int(_num(value))


def _text(value: Any) -> str:
    return str(value or "").strip()


def _get(source: Any, field: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(field, default)
    return getattr(source, field, default)


def empty_metric_bucket() -> dict:
    return {
        "raw_daily_row_count": 0,
        "creative_count": 0,
        "impressions": 0,
        "clicks": 0,
        "cost": 0,
        "conversions": 0,
        "revenue": 0,
        "cart_conversions": 0,
        "cart_revenue": 0,
        "purchase_conversions": 0,
        "purchase_revenue": 0,
        "active_days": 0,
    }


def finalize_performance_metrics(bucket: dict) -> dict:
    impressions = _int(bucket.get("impressions"))
    clicks = _int(bucket.get("clicks"))
    cost = _int(bucket.get("cost"))
    conversions = _int(bucket.get("conversions"))
    revenue = _int(bucket.get("revenue"))
    cart_conversions = _int(bucket.get("cart_conversions"))
    cart_revenue = _int(bucket.get("cart_revenue"))
    purchase_conversions = _int(bucket.get("purchase_conversions"))
    purchase_revenue = _int(bucket.get("purchase_revenue"))

    composed_conversions = cart_conversions + purchase_conversions
    composed_revenue = cart_revenue + purchase_revenue
    if composed_conversions > 0:
        conversions = composed_conversions
    if composed_revenue > 0:
        revenue = composed_revenue

    return {
        **bucket,
        "conversions": conversions,
        "revenue": revenue,
        "ctr": (clicks / impressions * 100.0) if impressions > 0 else 0.0,
        "cpc": (cost / clicks) if clicks > 0 else 0.0,
        "cvr": (conversions / clicks * 100.0) if clicks > 0 else 0.0,
        "roas": (revenue / cost * 100.0) if cost > 0 else 0.0,
        "cart_cvr": (cart_conversions / clicks * 100.0) if clicks > 0 else 0.0,
        "cart_roas": (cart_revenue / cost * 100.0) if cost > 0 else 0.0,
        "purchase_cvr": (purchase_conversions / clicks * 100.0) if clicks > 0 else 0.0,
        "purchase_roas": (purchase_revenue / cost * 100.0) if cost > 0 else 0.0,
    }


def aggregate_performance_rows(rows: list[Any], *, creative_count: int | None = None) -> dict:
    bucket = empty_metric_bucket()
    dates = set()
    creative_ids = set()
    for row in rows:
        bucket["raw_daily_row_count"] += 1
        creative_id = _text(_get(row, "creative_id"))
        if creative_id:
            creative_ids.add(creative_id)
        row_date = _get(row, "date")
        if row_date:
            dates.add(row_date)
        for key in (
            "impressions",
            "clicks",
            "cost",
            "conversions",
            "revenue",
            "cart_conversions",
            "cart_revenue",
            "purchase_conversions",
            "purchase_revenue",
        ):
            bucket[key] += _int(_get(row, key))
    bucket["creative_count"] = creative_count if creative_count is not None else len(creative_ids)
    bucket["active_days"] = len(dates)
    return finalize_performance_metrics(bucket)


def _feature_tier(feature: str) -> str:
    if feature in PRIMARY_FEATURES:
        return "PRIMARY"
    if feature in SECONDARY_FEATURES:
        return "SECONDARY"
    if feature in LIMITED_FEATURES:
        return "LIMITED"
    return "IGNORED"


def _feature_pairs(normalized: dict, *, include_limited: bool = False) -> dict[tuple[str, str], dict]:
    pairs: dict[tuple[str, str], dict] = {}
    for item in normalized.get("features") or []:
        feature = _text(item.get("canonical_feature"))
        value = _text(item.get("canonical_value"))
        status = _text(item.get("normalization_status"))
        tier = _feature_tier(feature)
        if not feature or not value or value == "unknown":
            continue
        if status not in MATCHABLE_STATUSES:
            continue
        if tier == "IGNORED":
            continue
        if tier == "LIMITED" and not include_limited:
            continue
        pairs.setdefault((feature, value), {**item, "feature_tier": tier})
    return pairs


def compare_creative_features(new_normalized: dict, historical_normalized: dict) -> dict:
    new_pairs = _feature_pairs(new_normalized)
    old_pairs = _feature_pairs(historical_normalized)
    new_limited = _feature_pairs(new_normalized, include_limited=True)
    old_limited = _feature_pairs(historical_normalized, include_limited=True)

    matched_keys = sorted(set(new_pairs).intersection(old_pairs))
    unmatched_keys = sorted(set(new_pairs).difference(old_pairs))
    limited_matches = sorted((set(new_limited).intersection(old_limited)).difference(matched_keys))
    unavailable_keys = sorted(
        (feature, "unknown")
        for feature in PRIMARY_FEATURES.union(SECONDARY_FEATURES)
        if not any(k[0] == feature for k in new_pairs)
    )

    possible_score = sum(3 if _feature_tier(k[0]) == "PRIMARY" else 1 for k in new_pairs)
    matched_score = sum(3 if _feature_tier(k[0]) == "PRIMARY" else 1 for k in matched_keys)
    similarity = (matched_score / possible_score) if possible_score > 0 else 0.0
    visual_match_count = sum(1 for k in matched_keys if k[0] in VISUAL_SIGNATURE_FEATURES)
    message_match_count = sum(1 for k in matched_keys if k[0] in MESSAGE_SIGNATURE_FEATURES)
    return {
        "creative_id": historical_normalized.get("creative_id"),
        "overall_similarity": similarity,
        "matched_feature_count": len(matched_keys),
        "visual_match_count": visual_match_count,
        "message_match_count": message_match_count,
        "matched_features": [{"feature": k[0], "value": k[1], "tier": _feature_tier(k[0])} for k in matched_keys],
        "unmatched_features": [{"feature": k[0], "value": k[1], "tier": _feature_tier(k[0])} for k in unmatched_keys],
        "unavailable_features": [{"feature": k[0], "value": k[1], "tier": _feature_tier(k[0])} for k in unavailable_keys],
        "limited_matches_not_scored": [{"feature": k[0], "value": k[1], "tier": "LIMITED"} for k in limited_matches],
        "selection_note": "Campaign/adgroup identifiers are excluded from similarity.",
    }


def _passes_strict_similarity_gate(comparison: dict) -> bool:
    matched = comparison.get("matched_features") or []
    unmatched = comparison.get("unmatched_features") or []
    matched_primary = sum(1 for item in matched if item.get("tier") == "PRIMARY")
    similarity = float(comparison.get("overall_similarity") or 0.0)
    visual_match_count = int(comparison.get("visual_match_count") or 0)
    message_match_count = int(comparison.get("message_match_count") or 0)
    required_signature_missed = any(item.get("feature") in STRICT_REQUIRED_MATCH_FEATURES for item in unmatched)

    # Do not surface "similar creatives" unless both the visual shape and the selling message overlap.
    # This intentionally prefers fewer examples over misleading examples.
    return (
        not required_signature_missed
        and
        similarity >= 0.45
        and matched_primary >= 2
        and visual_match_count >= 1
        and message_match_count >= 1
    )


def _bucket_sum(performance_items: list[dict]) -> dict:
    bucket = empty_metric_bucket()
    creative_ids = set()
    for item in performance_items:
        metrics = item.get("performance") or {}
        creative_id = _text(item.get("creative_id"))
        if creative_id:
            creative_ids.add(creative_id)
        for key in bucket:
            if key in {"creative_count"}:
                continue
            bucket[key] += _int(metrics.get(key))
    bucket["creative_count"] = len(creative_ids)
    return finalize_performance_metrics(bucket)


def concentration_metrics(performance_items: list[dict]) -> dict:
    total_impressions = sum(_int((x.get("performance") or {}).get("impressions")) for x in performance_items)
    total_cost = sum(_int((x.get("performance") or {}).get("cost")) for x in performance_items)
    top_impressions = max([_int((x.get("performance") or {}).get("impressions")) for x in performance_items] or [0])
    top_cost = max([_int((x.get("performance") or {}).get("cost")) for x in performance_items] or [0])
    return {
        "top_creative_impression_share": (top_impressions / total_impressions) if total_impressions > 0 else 0.0,
        "top_creative_spend_share": (top_cost / total_cost) if total_cost > 0 else 0.0,
    }


def _dedupe_similar_creatives(scored: list[dict], *, top_k: int) -> list[dict]:
    selected: list[dict] = []
    seen_images: set[str] = set()
    seen_campaigns: set[str] = set()
    for item in scored:
        display = item.get("display") if isinstance(item.get("display"), dict) else {}
        image_key = _text(display.get("image_url")).lower()
        campaign_key = _text(display.get("campaign_name")).lower()
        if image_key and image_key in seen_images:
            continue
        if campaign_key and campaign_key in seen_campaigns and len(selected) < 3:
            continue
        selected.append(item)
        if image_key:
            seen_images.add(image_key)
        if campaign_key:
            seen_campaigns.add(campaign_key)
        if len(selected) >= top_k:
            return selected
    return selected


def evidence_strength(metrics: dict, *, feature_coverage: str = "usable", concentration: dict | None = None) -> dict:
    creative_count = _int(metrics.get("creative_count"))
    impressions = _int(metrics.get("impressions"))
    clicks = _int(metrics.get("clicks"))
    purchases = _int(metrics.get("purchase_conversions"))
    cost = _int(metrics.get("cost"))
    concentration = concentration or {}
    top_impression_share = float(concentration.get("top_creative_impression_share") or 0.0)
    top_spend_share = float(concentration.get("top_creative_spend_share") or 0.0)
    concentrated = top_impression_share >= 0.5 or top_spend_share >= 0.5

    if creative_count < 2 or impressions < 1000 or clicks < 20:
        level = "INSUFFICIENT"
    elif feature_coverage != "usable" or concentrated:
        level = "LOW"
    elif creative_count >= 8 and impressions >= 100000 and clicks >= 500 and (purchases >= 20 or cost > 0):
        level = "HIGH"
    elif creative_count >= 4 and impressions >= 30000 and clicks >= 150:
        level = "MEDIUM"
    else:
        level = "LOW"

    return {
        "level": level,
        "display_label": EVIDENCE_LABELS[level],
        "basis": {
            "creative_count": creative_count,
            "impressions": impressions,
            "clicks": clicks,
            "purchases": purchases,
            "cost": cost,
            "feature_coverage": feature_coverage,
            "top_creative_impression_share": top_impression_share,
            "top_creative_spend_share": top_spend_share,
        },
    }


def build_similar_creative_evidence(
    *,
    new_normalized: dict,
    historical_creatives: list[dict],
    top_k: int = 12,
) -> dict:
    scored = []
    for item in historical_creatives:
        comparison = compare_creative_features(new_normalized, item["normalized"])
        scored.append({**item, "similarity": comparison})
    scored.sort(
        key=lambda x: (
            x["similarity"]["overall_similarity"],
            x["similarity"]["matched_feature_count"],
            _int((x.get("performance") or {}).get("impressions")),
        ),
        reverse=True,
    )
    comparable = [x for x in scored if _passes_strict_similarity_gate(x["similarity"])]
    selected = _dedupe_similar_creatives(comparable, top_k=top_k)
    metrics = _bucket_sum(selected)
    concentration = concentration_metrics(selected)
    return {
        "engine_version": ENGINE_VERSION,
        "title": "비슷한 광고의 실제 성과",
        "selection_rule": "strict_visual_message_feature_match_no_campaign_similarity_v2",
        "candidate_count": len(scored),
        "strict_comparable_candidate_count": len(comparable),
        "rejected_by_similarity_gate_count": len(scored) - len(comparable),
        "comparable_creative_count": len(selected),
        "performance": metrics,
        "concentration": concentration,
        "evidence_strength": evidence_strength(metrics, concentration=concentration),
        "top_similar_creatives": [
            {
                "creative_id": x.get("creative_id"),
                "creative_name": (x.get("display") or {}).get("creative_name"),
                "campaign_name": (x.get("display") or {}).get("campaign_name"),
                "adgroup_name": (x.get("display") or {}).get("adgroup_name"),
                "image_url": (x.get("display") or {}).get("image_url"),
                "overall_similarity": x["similarity"]["overall_similarity"],
                "matched_features": x["similarity"]["matched_features"],
                "unmatched_features": x["similarity"]["unmatched_features"],
                "unavailable_features": x["similarity"]["unavailable_features"],
                "limited_matches_not_scored": x["similarity"]["limited_matches_not_scored"],
                "performance": x.get("performance"),
            }
            for x in selected
        ],
        "interpretation_guardrail": "These are historical outcomes of similar ads, not predicted KPIs for the new creative.",
    }


def build_feature_performance_evidence(
    *,
    new_normalized: dict,
    historical_creatives: list[dict],
) -> dict:
    baseline = _bucket_sum(historical_creatives)
    features = _feature_pairs(new_normalized)
    rows = []
    for (feature, value), source in sorted(features.items()):
        matching = [x for x in historical_creatives if (feature, value) in _feature_pairs(x["normalized"])]
        metrics = _bucket_sum(matching)
        concentration = concentration_metrics(matching)
        rows.append(
            {
                "feature": feature,
                "value": value,
                "display_label": source.get("display_label", feature),
                "tier": source.get("feature_tier", _feature_tier(feature)),
                "creative_count": len(matching),
                "performance": metrics,
                "baseline": baseline,
                "comparison_to_baseline": {
                    "ctr_delta_pct_point": metrics.get("ctr", 0.0) - baseline.get("ctr", 0.0),
                    "purchase_cvr_delta_pct_point": metrics.get("purchase_cvr", 0.0) - baseline.get("purchase_cvr", 0.0),
                    "purchase_roas_delta_pct_point": metrics.get("purchase_roas", 0.0) - baseline.get("purchase_roas", 0.0),
                },
                "concentration": concentration,
                "evidence_strength": evidence_strength(metrics, concentration=concentration),
                "source_lineage": {
                    "source_table": source.get("source_table"),
                    "source_field": source.get("source_field"),
                    "raw_value": source.get("raw_value"),
                    "normalization_rule": source.get("normalization_rule"),
                },
                "interpretation_guardrail": "Historical association only; not a causal effect statement.",
            }
        )
    return {
        "engine_version": ENGINE_VERSION,
        "title": "이 광고 요소들의 과거 성과",
        "baseline": baseline,
        "features": rows,
    }


def build_feature_level_similar_creative_evidence(
    *,
    new_normalized: dict,
    historical_creatives: list[dict],
    top_k_per_feature: int = 3,
) -> dict:
    features = _feature_pairs(new_normalized)
    rows = []
    for (feature, value), source in sorted(features.items()):
        tier = _feature_tier(feature)
        if tier not in {"PRIMARY", "SECONDARY"}:
            continue
        matching = [x for x in historical_creatives if (feature, value) in _feature_pairs(x["normalized"])]
        if not matching:
            continue
        matching.sort(key=lambda x: _int((x.get("performance") or {}).get("impressions")), reverse=True)
        metrics = _bucket_sum(matching)
        concentration = concentration_metrics(matching)
        rows.append(
            {
                "feature": feature,
                "value": value,
                "display_label": source.get("display_label", feature),
                "tier": tier,
                "creative_count": len(matching),
                "performance": metrics,
                "concentration": concentration,
                "evidence_strength": evidence_strength(metrics, concentration=concentration),
                "top_creatives": [
                    {
                        "creative_id": x.get("creative_id"),
                        "creative_name": (x.get("display") or {}).get("creative_name"),
                        "image_url": (x.get("display") or {}).get("image_url"),
                        "performance": x.get("performance"),
                    }
                    for x in matching[:top_k_per_feature]
                ],
                "interpretation_guardrail": "Single-feature historical association only; not whole-creative similarity or a causal effect statement.",
            }
        )
    rows.sort(
        key=lambda x: (
            1 if x["tier"] == "PRIMARY" else 0,
            _int((x.get("performance") or {}).get("impressions")),
            x.get("creative_count") or 0,
        ),
        reverse=True,
    )
    return {
        "engine_version": ENGINE_VERSION,
        "title": "항목별 유사 소재 근거",
        "selection_rule": "per_feature_match_visual_copy_appeal_v1",
        "features": rows,
    }


def build_historical_creative_evidence(
    *,
    new_normalized: dict,
    historical_creatives: list[dict],
    top_k: int = 12,
) -> dict:
    similar = build_similar_creative_evidence(
        new_normalized=new_normalized,
        historical_creatives=historical_creatives,
        top_k=top_k,
    )
    feature = build_feature_performance_evidence(
        new_normalized=new_normalized,
        historical_creatives=historical_creatives,
    )
    feature_similar = build_feature_level_similar_creative_evidence(
        new_normalized=new_normalized,
        historical_creatives=historical_creatives,
        top_k_per_feature=3,
    )
    distribution = Counter(round(compare_creative_features(new_normalized, x["normalized"])["overall_similarity"], 2) for x in historical_creatives)
    return {
        "engine_version": ENGINE_VERSION,
        "new_creative_id": new_normalized.get("creative_id"),
        "similar_creative_evidence": similar,
        "feature_performance_evidence": feature,
        "feature_similar_creative_evidence": feature_similar,
        "similarity_distribution": dict(sorted(distribution.items())),
        "unknown_metric_semantics": {
            "mapped_partial_unknown_are_not_ui_coverage_ratio": True,
            "reason": "Normalization can emit multiple canonical records from one raw value and UNKNOWN placeholders for missing canonical fields.",
        },
        "forbidden_outputs": {
            "predicted_ctr": None,
            "predicted_cvr": None,
            "predicted_roas": None,
            "causal_claim": None,
            "campaign_similarity": None,
        },
    }
