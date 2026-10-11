import json
import re
from collections import Counter
from typing import Any


ONTOLOGY_VERSION = "canonical-feature-ontology-v1"
NORMALIZATION_RULE_VERSION = "canonical-feature-normalization-rules-v1"

STATUSES = {
    "EXACT",
    "NORMALIZED",
    "DERIVED",
    "PARTIAL",
    "AMBIGUOUS",
    "UNMAPPED",
    "UNKNOWN",
}

READINESS_USABLE = "USABLE"
READINESS_LIMITED = "LIMITED"
READINESS_NOT_USABLE = "NOT_USABLE"


CANONICAL_VALUE_DICTIONARY: dict[str, list[str]] = {
    "person_presence": ["present", "absent", "unknown"],
    "gender": ["female", "male", "mixed", "unknown"],
    "age_group": ["young_adult", "middle_age", "older_adult", "mixed", "unknown"],
    "age_range": ["20_39", "40_49", "50_59", "60_69", "40_69", "unknown"],
    "face_visibility": ["visible", "not_visible", "partial", "unknown"],
    "gray_hair": ["present", "absent", "unknown"],
    "hair_damage": ["present", "absent", "unknown"],
    "colored_hair": ["present", "absent", "unknown"],
    "hair_shine": ["present", "absent", "unknown"],
    "hair_dryness": ["present", "absent", "unknown"],
    "hair_condition": ["dyed", "gray_hair", "damaged", "dry", "shiny", "wet", "unknown"],
    "product_visibility": ["high", "medium", "low", "none", "unknown"],
    "product_usage_scene": ["present", "absent", "unknown"],
    "ingredient_visibility": ["present", "absent", "unknown"],
    "natural_background": ["present", "absent", "unknown"],
    "before_after": ["present", "absent", "unknown"],
    "body_part_closeup": ["present", "absent", "unknown"],
    "composition": ["split", "left_right", "centered", "portrait", "product_packshot", "unknown"],
    "background_type": ["natural", "indoor", "outdoor", "plain", "unknown"],
    "mood": ["calm", "comfortable", "trustworthy", "urgent", "unknown"],
    "color_tone": ["green", "brown", "black", "white", "beige", "warm", "cool", "unknown"],
    "closeup": ["present", "absent", "unknown"],
    "visual_focus": ["person", "hair", "product", "ingredient", "copy", "unknown"],
    "hook_type": ["problem_benefit", "question", "benefit_direct", "trust_evidence", "action_direct", "unknown"],
    "problem": ["gray_hair", "scalp_irritation", "hair_damage", "unknown"],
    "pain_point": ["gray_hair", "scalp_irritation", "hair_damage", "unknown"],
    "benefit": ["gray_coverage", "low_irritation", "natural_ingredient", "shine", "unknown"],
    "core_promise": ["natural_henna", "gray_coverage", "low_irritation", "unknown"],
    "usp": ["natural_ingredient", "organic", "low_irritation", "unknown"],
    "trust_claim": ["ingredient", "organic", "review", "expert", "unknown"],
    "ingredient_claim": ["henna", "natural", "organic", "unknown"],
    "offer": ["present", "absent", "unknown"],
    "discount": ["present", "absent", "unknown"],
    "cta": ["purchase", "detail", "weak", "unknown"],
    "urgency": ["present", "absent", "unknown"],
    "appeal_type": ["problem", "benefit", "trust", "empathy", "result", "action", "unknown"],
    "emotional_driver": ["relief", "confidence", "anxiety", "trust", "unknown"],
    "purchase_stage": ["problem_aware", "solution_aware", "product_aware", "purchase_ready", "unknown"],
    "trust_driver": ["ingredient", "result", "brand", "review", "unknown"],
    "action_trigger": ["purchase", "learn_more", "offer", "unknown"],
    "success_dna": ["problem_solution", "trust_action", "result_proof", "unknown"],
}


DISPLAY_LABELS: dict[str, str] = {
    "gray_hair": "새치",
    "product_visibility": "제품이 잘 보이는가",
    "appeal_type": "어떤 점을 강조하는 광고인가",
    "purchase_stage": "구매 단계(Purchase Stage)",
    "historical_performance_evidence": "비슷한 광고의 실제 성과",
}


COLOR_TAGS = {
    "블랙": "black",
    "검은": "black",
    "흑발": "black",
    "화이트": "white",
    "아이보리": "white",
    "베이지": "beige",
    "브라운": "brown",
    "갈색": "brown",
    "적갈색": "brown",
    "초록": "green",
    "그린": "green",
    "올리브": "green",
    "카키": "green",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _get(source: Any, field: str) -> Any:
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(field)
    return getattr(source, field, None)


def _parse_jsonish(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    s = _text(value)
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def _parse_tags(value: Any) -> list[str]:
    parsed = _parse_jsonish(value)
    if isinstance(parsed, list):
        return [_text(x) for x in parsed if _text(x)]
    s = _text(value)
    if not s:
        return []
    return [x.strip() for x in re.split(r"[,/|]", s) if x.strip()]


def _json_value(source: Any, field: str) -> Any:
    parsed = _parse_jsonish(_get(source, "analysis_json"))
    if isinstance(parsed, dict):
        return parsed.get(field)
    return None


def _record(
    *,
    creative_id: str,
    feature: str,
    value: str,
    source_table: str,
    source_field: str,
    raw_value: Any,
    status: str,
    rule: str,
    confidence: float,
) -> dict:
    if status not in STATUSES:
        raise ValueError(f"unknown normalization status: {status}")
    return {
        "creative_id": creative_id,
        "ontology_version": ONTOLOGY_VERSION,
        "normalization_rule_version": NORMALIZATION_RULE_VERSION,
        "canonical_feature": feature,
        "canonical_value": value,
        "display_label": DISPLAY_LABELS.get(feature, feature),
        "source_table": source_table,
        "source_field": source_field,
        "raw_value": raw_value,
        "normalization_status": status,
        "normalization_rule": rule,
        "confidence": float(confidence),
    }


def _unknown(creative_id: str, feature: str, source_table: str = "", source_field: str = "") -> dict:
    return _record(
        creative_id=creative_id,
        feature=feature,
        value="unknown",
        source_table=source_table,
        source_field=source_field,
        raw_value="",
        status="UNKNOWN",
        rule="no_deterministic_source",
        confidence=0.0,
    )


def _append_once(records: list[dict], record: dict) -> None:
    key = (
        record["canonical_feature"],
        record["canonical_value"],
        record["source_table"],
        record["source_field"],
        record["raw_value"],
        record["normalization_status"],
    )
    if not any(
        (
            x["canonical_feature"],
            x["canonical_value"],
            x["source_table"],
            x["source_field"],
            x["raw_value"],
            x["normalization_status"],
        )
        == key
        for x in records
    ):
        records.append(record)


def _normalize_product_visibility(value: Any, creative_id: str) -> list[dict]:
    raw = _text(value)
    if not raw or raw in {"미확인", "미분류"}:
        status = "UNKNOWN" if not raw else "PARTIAL"
        normalized = "unknown"
    elif "미노출" in raw:
        status = "EXACT"
        normalized = "none"
    elif "부분" in raw:
        status = "NORMALIZED"
        normalized = "medium"
    elif "노출" in raw:
        status = "NORMALIZED"
        normalized = "high"
    else:
        status = "UNMAPPED"
        normalized = "unknown"
    return [
        _record(
            creative_id=creative_id,
            feature="product_visibility",
            value=normalized,
            source_table="naver_gfa_creative_image_analysis",
            source_field="product_visibility",
            raw_value=raw,
            status=status,
            rule="product_visibility.ko_visibility_map",
            confidence=0.95 if status in {"EXACT", "NORMALIZED"} else 0.2,
        )
    ]


def _normalize_visual_tags(image: Any, creative_id: str) -> list[dict]:
    records: list[dict] = []
    fields = {
        "visual_subjects": _parse_tags(_get(image, "visual_subjects")),
        "hair_condition_tags": _parse_tags(_get(image, "hair_condition_tags")),
        "scene_tags": _parse_tags(_get(image, "scene_tags")),
        "emotion_tags": _parse_tags(_get(image, "emotion_tags")),
        "composition_tags": _parse_tags(_get(image, "composition_tags")),
        "color_mood_tags": _parse_tags(_get(image, "color_mood_tags")),
    }
    for source_field, tags in fields.items():
        for raw in tags:
            if raw in {"미분류", "미확인"}:
                continue
            raw_l = raw.lower()
            if "여성" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="gender", value="female", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="person.gender.female.ko_alias", confidence=0.9))
                _append_once(records, _record(creative_id=creative_id, feature="person_presence", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="DERIVED", rule="person.presence.from_person_token", confidence=0.85))
            if "남성" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="gender", value="male", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="person.gender.male.ko_alias", confidence=0.9))
                _append_once(records, _record(creative_id=creative_id, feature="person_presence", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="DERIVED", rule="person.presence.from_person_token", confidence=0.85))
            if "중년" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="age_group", value="middle_age", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="person.age_group.middle_age.ko_alias", confidence=0.85))
            if "40~60대" in raw or "40-60대" in raw or "40대~60대" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="age_range", value="40_69", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="person.age_range.40_69.explicit_range", confidence=0.9))
            elif "50대" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="age_range", value="50_59", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="person.age_range.50s.explicit_range", confidence=0.9))
            if "얼굴" in raw:
                value = "not_visible" if "없는" in raw or "미노출" in raw else "visible"
                _append_once(records, _record(creative_id=creative_id, feature="face_visibility", value=value, source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="person.face_visibility.ko_alias", confidence=0.75))
            if "새치" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="gray_hair", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="hair.gray_hair.ko_alias", confidence=0.9))
                _append_once(records, _record(creative_id=creative_id, feature="hair_condition", value="gray_hair", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="hair.condition.gray_hair.ko_alias", confidence=0.85))
            if "손상" in raw or "푸석" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="hair_damage", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="hair.damage.ko_alias", confidence=0.85))
            if "윤기" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="hair_shine", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="hair.shine.ko_alias", confidence=0.85))
            if "염색" in raw or "도포" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="colored_hair", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="hair.colored_or_dyeing.ko_alias", confidence=0.75))
            if "사용 장면" in raw or "도포" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="product_usage_scene", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="scene.product_usage.ko_alias", confidence=0.85))
            if "원료" in raw or "식물" in raw or "헤나 가루" in raw or "가루" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="ingredient_visibility", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="scene.ingredient_visibility.ko_alias", confidence=0.85))
            if "자연" in raw or "식물" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="natural_background", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="PARTIAL", rule="background.natural_visual_cue.ko_alias", confidence=0.65))
            if "before" in raw_l or "after" in raw_l or "비교" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="before_after", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="scene.before_after.compare_alias", confidence=0.85))
            if "클로즈업" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="closeup", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="visual.closeup.ko_alias", confidence=0.85))
                if "헤어" in raw or "모발" in raw or "두피" in raw:
                    _append_once(records, _record(creative_id=creative_id, feature="body_part_closeup", value="present", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="DERIVED", rule="compliance.body_part_closeup.from_hair_closeup", confidence=0.7))
            if "좌우" in raw or "중앙 분할" in raw or "2분할" in raw or "3분할" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="composition", value="split", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="composition.split.ko_alias", confidence=0.85))
            if "인물" in raw or "모델" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="visual_focus", value="person", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="PARTIAL", rule="visual_focus.person_token", confidence=0.65))
            if "제품" in raw or "파우치" in raw or "패키지" in raw:
                _append_once(records, _record(creative_id=creative_id, feature="visual_focus", value="product", source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="PARTIAL", rule="visual_focus.product_token", confidence=0.65))
            for token, color in COLOR_TAGS.items():
                if token in raw:
                    _append_once(records, _record(creative_id=creative_id, feature="color_tone", value=color, source_table="naver_gfa_creative_image_analysis", source_field=source_field, raw_value=raw, status="NORMALIZED", rule="visual.color_tone.ko_alias", confidence=0.75))
                    break
    records.extend(_normalize_product_visibility(_get(image, "product_visibility"), creative_id))
    return records


def _normalize_copy(copy: Any, creative_id: str) -> list[dict]:
    records: list[dict] = []
    hook_map = {
        "문제-혜택 압축형": "problem_benefit",
        "소비자 속마음 질문형": "question",
        "혜택 직격형": "benefit_direct",
        "신뢰 증거형": "trust_evidence",
        "행동 유도형": "action_direct",
    }
    appeal_map = {
        "문제 제시형": "problem",
        "혜택 제시형": "benefit",
        "신뢰형": "trust",
        "공감형": "empathy",
        "결과 강조형": "result",
        "행동 유도형": "action",
    }
    pain_map = {
        "새치 고민": "gray_hair",
        "두피 자극 고민": "scalp_irritation",
        "손상모 고민": "hair_damage",
    }
    cta_map = {"구매 유도": "purchase", "상세 확인": "detail"}

    hook = _text(_json_value(copy, "hook_type"))
    if hook:
        _append_once(records, _record(creative_id=creative_id, feature="hook_type", value=hook_map.get(hook, "unknown"), source_table="naver_gfa_creative_copy_analysis", source_field="analysis_json.hook_type", raw_value=hook, status="NORMALIZED" if hook in hook_map else "UNMAPPED", rule="copy.hook_type.ko_alias", confidence=0.85 if hook in hook_map else 0.2))

    buyer_stage = _text(_json_value(copy, "buyer_stage"))
    if buyer_stage:
        status = "EXACT" if buyer_stage in CANONICAL_VALUE_DICTIONARY["purchase_stage"] else "UNMAPPED"
        _append_once(records, _record(creative_id=creative_id, feature="purchase_stage", value=buyer_stage if status == "EXACT" else "unknown", source_table="naver_gfa_creative_copy_analysis", source_field="analysis_json.buyer_stage", raw_value=buyer_stage, status=status, rule="strategy.purchase_stage.exact_enum", confidence=0.95 if status == "EXACT" else 0.2))

    for raw in _parse_tags(_get(copy, "appeal_types")):
        if raw in {"미분류", "미확인"}:
            continue
        _append_once(records, _record(creative_id=creative_id, feature="appeal_type", value=appeal_map.get(raw, "unknown"), source_table="naver_gfa_creative_copy_analysis", source_field="appeal_types", raw_value=raw, status="NORMALIZED" if raw in appeal_map else "UNMAPPED", rule="strategy.appeal_type.ko_alias", confidence=0.9 if raw in appeal_map else 0.2))
        if raw == "신뢰형":
            _append_once(records, _record(creative_id=creative_id, feature="trust_driver", value="brand", source_table="naver_gfa_creative_copy_analysis", source_field="appeal_types", raw_value=raw, status="PARTIAL", rule="strategy.trust_driver.from_trust_appeal", confidence=0.55))
        if raw == "행동 유도형":
            _append_once(records, _record(creative_id=creative_id, feature="action_trigger", value="purchase", source_table="naver_gfa_creative_copy_analysis", source_field="appeal_types", raw_value=raw, status="PARTIAL", rule="strategy.action_trigger.from_action_appeal", confidence=0.55))

    for raw in _parse_tags(_get(copy, "pain_points")):
        if raw in {"미분류", "미확인"}:
            continue
        canonical = pain_map.get(raw)
        _append_once(records, _record(creative_id=creative_id, feature="pain_point", value=canonical or "unknown", source_table="naver_gfa_creative_copy_analysis", source_field="pain_points", raw_value=raw, status="NORMALIZED" if canonical else "UNMAPPED", rule="copy.pain_point.ko_alias", confidence=0.9 if canonical else 0.2))
        if canonical:
            _append_once(records, _record(creative_id=creative_id, feature="problem", value=canonical, source_table="naver_gfa_creative_copy_analysis", source_field="pain_points", raw_value=raw, status="DERIVED", rule="copy.problem.from_pain_point", confidence=0.8))

    cta_type = _text(_get(copy, "cta_type"))
    if cta_type:
        _append_once(records, _record(creative_id=creative_id, feature="cta", value=cta_map.get(cta_type, "unknown"), source_table="naver_gfa_creative_copy_analysis", source_field="cta_type", raw_value=cta_type, status="NORMALIZED" if cta_type in cta_map else "UNKNOWN" if cta_type == "미확인" else "UNMAPPED", rule="copy.cta_type.ko_alias", confidence=0.9 if cta_type in cta_map else 0.1))

    all_text = " ".join(_text(_get(copy, f)) for f in ("primary_text", "headline", "description", "cta"))
    if all_text:
        if "할인" in all_text or "%" in all_text:
            _append_once(records, _record(creative_id=creative_id, feature="discount", value="present", source_table="naver_gfa_creative_copy_analysis", source_field="copy_text", raw_value=all_text, status="DERIVED", rule="copy.discount.keyword_rule", confidence=0.75))
        if "오늘" in all_text or "지금" in all_text or "마감" in all_text:
            _append_once(records, _record(creative_id=creative_id, feature="urgency", value="present", source_table="naver_gfa_creative_copy_analysis", source_field="copy_text", raw_value=all_text, status="DERIVED", rule="copy.urgency.keyword_rule", confidence=0.65))
        if "헤나" in all_text:
            _append_once(records, _record(creative_id=creative_id, feature="ingredient_claim", value="henna", source_table="naver_gfa_creative_copy_analysis", source_field="copy_text", raw_value=all_text, status="DERIVED", rule="copy.ingredient_claim.henna_keyword", confidence=0.8))
        if "천연" in all_text or "자연" in all_text:
            _append_once(records, _record(creative_id=creative_id, feature="usp", value="natural_ingredient", source_table="naver_gfa_creative_copy_analysis", source_field="copy_text", raw_value=all_text, status="DERIVED", rule="copy.usp.natural_keyword", confidence=0.75))
    return records


def normalize_creative_features(
    *,
    creative_id: str,
    image_analysis: Any | None = None,
    copy_analysis: Any | None = None,
    strategy_analysis: Any | None = None,
) -> dict:
    records: list[dict] = []
    cid = _text(creative_id)
    if image_analysis is not None:
        records.extend(_normalize_visual_tags(image_analysis, cid))
    if copy_analysis is not None:
        records.extend(_normalize_copy(copy_analysis, cid))

    covered = {r["canonical_feature"] for r in records if r["normalization_status"] != "UNMAPPED"}
    for feature in CANONICAL_VALUE_DICTIONARY:
        if feature not in covered:
            records.append(_unknown(cid, feature))

    status_counts = Counter(r["normalization_status"] for r in records)
    feature_readiness = feature_readiness_from_records(records)
    return {
        "creative_id": cid,
        "ontology_version": ONTOLOGY_VERSION,
        "normalization_rule_version": NORMALIZATION_RULE_VERSION,
        "features": records,
        "summary": {
            "total_raw_feature_values": sum(1 for r in records if r["normalization_status"] != "UNKNOWN"),
            "mapped_values": sum(1 for r in records if r["normalization_status"] in {"EXACT", "NORMALIZED", "DERIVED"}),
            "partial_values": status_counts.get("PARTIAL", 0),
            "ambiguous_values": status_counts.get("AMBIGUOUS", 0),
            "unmapped_values": status_counts.get("UNMAPPED", 0),
            "unknown_values": status_counts.get("UNKNOWN", 0),
            "feature_readiness": feature_readiness,
        },
    }


def feature_readiness_from_records(records: list[dict]) -> dict[str, str]:
    by_feature: dict[str, list[dict]] = {}
    for record in records:
        by_feature.setdefault(record["canonical_feature"], []).append(record)

    readiness: dict[str, str] = {}
    for feature in CANONICAL_VALUE_DICTIONARY:
        items = by_feature.get(feature, [])
        statuses = {x["normalization_status"] for x in items}
        mapped = any(x["normalization_status"] in {"EXACT", "NORMALIZED", "DERIVED"} and x["canonical_value"] != "unknown" for x in items)
        if mapped and not statuses.intersection({"AMBIGUOUS", "UNMAPPED"}):
            readiness[feature] = READINESS_USABLE
        elif mapped or statuses.intersection({"PARTIAL", "UNKNOWN"}):
            readiness[feature] = READINESS_LIMITED
        else:
            readiness[feature] = READINESS_NOT_USABLE
    return readiness


def summarize_normalization_results(results: list[dict]) -> dict:
    feature_coverage: dict[str, dict[str, int]] = {
        feature: {"usable": 0, "limited": 0, "not_usable": 0}
        for feature in CANONICAL_VALUE_DICTIONARY
    }
    aggregate = Counter()
    for result in results:
        for key, value in (result.get("summary") or {}).items():
            if key.endswith("_values") and isinstance(value, int):
                aggregate[key] += value
        for feature, readiness in ((result.get("summary") or {}).get("feature_readiness") or {}).items():
            if readiness == READINESS_USABLE:
                feature_coverage.setdefault(feature, {"usable": 0, "limited": 0, "not_usable": 0})["usable"] += 1
            elif readiness == READINESS_LIMITED:
                feature_coverage.setdefault(feature, {"usable": 0, "limited": 0, "not_usable": 0})["limited"] += 1
            else:
                feature_coverage.setdefault(feature, {"usable": 0, "limited": 0, "not_usable": 0})["not_usable"] += 1
    return {
        "ontology_version": ONTOLOGY_VERSION,
        "normalization_rule_version": NORMALIZATION_RULE_VERSION,
        "total_creatives": len(results),
        "total_raw_feature_values": int(aggregate["total_raw_feature_values"]),
        "mapped_values": int(aggregate["mapped_values"]),
        "partial_values": int(aggregate["partial_values"]),
        "ambiguous_values": int(aggregate["ambiguous_values"]),
        "unmapped_values": int(aggregate["unmapped_values"]),
        "unknown_values": int(aggregate["unknown_values"]),
        "feature_coverage": feature_coverage,
    }
