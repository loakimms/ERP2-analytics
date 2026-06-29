from __future__ import annotations

import re
from collections import Counter


_NEGATIVE_MARKERS = (
    "아쉬워",
    "별로",
    "불편",
    "실망",
    "문제",
    "늦",
    "깨졌",
    "새서",
    "별로예요",
    "환불",
    "교환",
    "기분이별로",
    "불만",
    "냄새가 심",
)
_QUESTION_MARKERS = (
    "?",
    "문의",
    "되나요",
    "가능한가",
    "가능할까요",
    "궁금",
    "알려",
    "확인",
    "어떻게",
)
_POSITIVE_MARKERS = (
    "만족",
    "좋아요",
    "좋습니다",
    "재구매",
    "추천",
    "감사",
    "부드러",
    "순해",
    "편안",
    "마음에",
)
_COMMON_STYLE_PHRASES = (
    "안녕하세요",
    "고객님",
    "소중한 후기",
    "감사",
    "죄송",
    "불편",
    "만족",
    "좋은 하루",
    "도움",
    "재구매",
    "노력하겠습니다",
    "확인",
)

_STYLE_LEVEL_PRESETS = {
    1: {
        "id": "concise",
        "name": "간결형",
        "summary": "짧고 담백하게 핵심만 답하는 톤",
        "controls": {
            "greeting_density": 2,
            "gratitude_intensity": 2,
            "empathy_intensity": 2,
            "detail_depth": 1,
            "closing_strength": 2,
        },
    },
    2: {
        "id": "light",
        "name": "절제형",
        "summary": "공손함은 유지하되 감정 표현을 절제하는 톤",
        "controls": {
            "greeting_density": 3,
            "gratitude_intensity": 2,
            "empathy_intensity": 2,
            "detail_depth": 2,
            "closing_strength": 2,
        },
    },
    3: {
        "id": "balanced",
        "name": "균형형",
        "summary": "현재 관리자 답글과 가장 유사한 기본 균형 톤",
        "controls": {
            "greeting_density": 3,
            "gratitude_intensity": 3,
            "empathy_intensity": 3,
            "detail_depth": 3,
            "closing_strength": 3,
        },
    },
    4: {
        "id": "attentive",
        "name": "세심형",
        "summary": "공감과 안내를 조금 더 풍부하게 담는 톤",
        "controls": {
            "greeting_density": 4,
            "gratitude_intensity": 4,
            "empathy_intensity": 4,
            "detail_depth": 4,
            "closing_strength": 4,
        },
    },
    5: {
        "id": "warm",
        "name": "온화형",
        "summary": "감사와 공감을 풍부하게 담아 사람 손맛을 살리는 톤",
        "controls": {
            "greeting_density": 5,
            "gratitude_intensity": 5,
            "empathy_intensity": 5,
            "detail_depth": 4,
            "closing_strength": 5,
        },
    },
}

_PRESET_FIELD_RECOMMENDATIONS = (
    {
        "id": "greeting_density",
        "label": "인사/호칭 강도",
        "description": "안녕하세요, 고객님 같은 시작 표현의 존재감",
        "why": "관리자 손맛은 첫 문장 인사 밀도에서 가장 크게 체감된다.",
    },
    {
        "id": "gratitude_intensity",
        "label": "감사 표현 강도",
        "description": "후기 작성에 대한 감사 표현을 얼마나 선명하게 드러낼지",
        "why": "긍정 리뷰에서 브랜드 호감과 재구매 유도 톤을 좌우한다.",
    },
    {
        "id": "empathy_intensity",
        "label": "공감/사과 강도",
        "description": "불만/혼합형 리뷰에서 공감과 사과를 얼마나 먼저 강조할지",
        "why": "클레임 대응의 이질감은 공감 순서와 강도 차이에서 자주 발생한다.",
    },
    {
        "id": "detail_depth",
        "label": "안내/설명 깊이",
        "description": "원인 확인, 개선 의지, 후속 안내를 얼마나 구체적으로 쓸지",
        "why": "문의형과 불만형 리뷰에서 관리자 검수 시간을 줄여준다.",
    },
    {
        "id": "closing_strength",
        "label": "마무리 강도",
        "description": "좋은 하루/재구매 환영/개선 약속 등 종료 문장의 존재감",
        "why": "브랜드 톤의 일관성은 마무리 문장 패턴에서 안정적으로 유지된다.",
    },
)

_STYLE_CONTROL_IDS = tuple(item["id"] for item in _PRESET_FIELD_RECOMMENDATIONS)


def normalize_ws(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def split_sentences(text: object) -> list[str]:
    s = normalize_ws(text)
    if not s:
        return []
    parts = re.split(r"[.!?~]+\s*", s)
    out = [normalize_ws(x) for x in parts if normalize_ws(x)]
    if out:
        return out
    return [s]


def classify_review_type(review_text: object, rating: float | None = None) -> str:
    text = normalize_ws(review_text)
    low = text.lower()
    has_question = any(tok in text for tok in _QUESTION_MARKERS)
    negative_hits = sum(1 for tok in _NEGATIVE_MARKERS if tok in text or tok in low)
    positive_hits = sum(1 for tok in _POSITIVE_MARKERS if tok in text or tok in low)

    is_negative = negative_hits > 0 or (rating is not None and float(rating) <= 3.0)
    is_positive = positive_hits > 0 or (rating is not None and float(rating) >= 4.0)

    if has_question and (is_negative or is_positive):
        return "mixed"
    if has_question:
        return "question_or_request"
    if is_negative and is_positive:
        return "mixed"
    if is_negative:
        return "complaint"
    return "positive"


def should_include_reply_text(reply_text: object) -> bool:
    s = normalize_ws(reply_text)
    if len(s) < 12:
        return False
    if len(split_sentences(s)) == 0:
        return False
    return True


def _pick_opening(text: str) -> str | None:
    parts = split_sentences(text)
    if not parts:
        return None
    return normalize_ws(parts[0])[:40] or None


def _pick_closing(text: str) -> str | None:
    parts = split_sentences(text)
    if not parts:
        return None
    return normalize_ws(parts[-1])[:40] or None


def build_style_profile(rows: list[dict]) -> dict:
    valid_rows = [row for row in (rows or []) if should_include_reply_text(row.get("reply_text"))]
    if not valid_rows:
        return {
            "example_count": 0,
            "avg_sentence_count": 0.0,
            "avg_char_count": 0.0,
            "top_openings": [],
            "top_closings": [],
            "common_phrases": [],
        }

    sentence_counts = [len(split_sentences(row.get("reply_text"))) for row in valid_rows]
    char_counts = [len(normalize_ws(row.get("reply_text"))) for row in valid_rows]
    opening_counter: Counter[str] = Counter()
    closing_counter: Counter[str] = Counter()
    phrase_counter: Counter[str] = Counter()

    for row in valid_rows:
        reply_text = normalize_ws(row.get("reply_text"))
        opening = _pick_opening(reply_text)
        closing = _pick_closing(reply_text)
        if opening:
            opening_counter[opening] += 1
        if closing:
            closing_counter[closing] += 1
        for phrase in _COMMON_STYLE_PHRASES:
            if phrase in reply_text:
                phrase_counter[phrase] += 1

    return {
        "example_count": len(valid_rows),
        "avg_sentence_count": round(sum(sentence_counts) / max(1, len(sentence_counts)), 2),
        "avg_char_count": round(sum(char_counts) / max(1, len(char_counts)), 2),
        "top_openings": [x for x, _ in opening_counter.most_common(3)],
        "top_closings": [x for x, _ in closing_counter.most_common(3)],
        "common_phrases": [x for x, _ in phrase_counter.most_common(5)],
    }


def build_style_profiles(rows: list[dict]) -> dict:
    rows0 = [dict(row) for row in (rows or []) if should_include_reply_text(row.get("reply_text"))]
    profiles = {
        "global": build_style_profile(rows0),
        "product": {},
        "review_type": {},
        "product_review_type": {},
    }
    product_buckets: dict[str, list[dict]] = {}
    review_type_buckets: dict[str, list[dict]] = {}
    pair_buckets: dict[tuple[str, str], list[dict]] = {}

    for row in rows0:
        product_url = normalize_ws(row.get("product_url"))
        review_type = normalize_ws(row.get("review_type")) or "positive"
        if product_url:
            product_buckets.setdefault(product_url, []).append(row)
            pair_buckets.setdefault((product_url, review_type), []).append(row)
        review_type_buckets.setdefault(review_type, []).append(row)

    profiles["product"] = {k: build_style_profile(v) for k, v in product_buckets.items()}
    profiles["review_type"] = {k: build_style_profile(v) for k, v in review_type_buckets.items()}
    profiles["product_review_type"] = {f"{k[0]}::{k[1]}": build_style_profile(v) for k, v in pair_buckets.items()}
    return profiles


def choose_style_profile(profiles: dict, *, product_url: str | None, review_type: str) -> tuple[str, dict]:
    product_url0 = normalize_ws(product_url)
    review_type0 = normalize_ws(review_type) or "positive"
    key = f"{product_url0}::{review_type0}"

    pair_profile = ((profiles or {}).get("product_review_type") or {}).get(key) or {}
    if int(pair_profile.get("example_count") or 0) >= 1:
        return "product+review_type", pair_profile

    product_profile = ((profiles or {}).get("product") or {}).get(product_url0) or {}
    if int(product_profile.get("example_count") or 0) >= 1:
        return "product", product_profile

    type_profile = ((profiles or {}).get("review_type") or {}).get(review_type0) or {}
    if int(type_profile.get("example_count") or 0) >= 2:
        return "review_type", type_profile

    return "global", (profiles or {}).get("global") or {}


def render_style_guidance(*, profile_source: str, profile: dict, review_type: str, preset: dict | None = None) -> str:
    example_count = int((profile or {}).get("example_count") or 0)
    avg_sentence_count = float((profile or {}).get("avg_sentence_count") or 0.0)
    top_openings = ", ".join((profile or {}).get("top_openings") or [])
    top_closings = ", ".join((profile or {}).get("top_closings") or [])
    common_phrases = ", ".join((profile or {}).get("common_phrases") or [])
    review_type0 = normalize_ws(review_type) or "positive"
    preset0 = dict(preset or {})
    controls = dict(preset0.get("controls") or {})

    type_guide = {
        "positive": "긍정 리뷰에는 감사와 만족 유지, 재구매 환영 톤을 우선한다.",
        "complaint": "불만 리뷰에는 공감과 사과를 먼저 두고, 확인/개선 의지를 분명히 한다.",
        "question_or_request": "문의형 리뷰에는 확인/안내 중심으로 답하고 과도한 감탄을 줄인다.",
        "mixed": "혼합형 리뷰에는 감사와 공감을 함께 넣고, 불편 포인트를 먼저 짚는다.",
    }.get(review_type0, "리뷰 맥락에 맞는 공손한 관리자 톤을 유지한다.")

    lines = [
        f"- 스타일 참고: {profile_source} 프로필 사용",
        f"- 스타일 예시 수: {example_count}",
        f"- 평균 문장 수: {avg_sentence_count}",
        f"- 리뷰 유형 대응: {type_guide}",
        f"- 스타일 강도: {int(preset0.get('level') or 3)}단계 ({str(preset0.get('name') or '균형형')})",
        f"- 프리셋 요약: {str(preset0.get('summary') or '현재 관리자 톤에 맞춰 균형 있게 작성')}",
    ]
    if controls:
        control_labels = {
            "greeting_density": "인사",
            "gratitude_intensity": "감사",
            "empathy_intensity": "공감",
            "detail_depth": "설명",
            "closing_strength": "마무리",
        }
        control_text = ", ".join(
            f"{control_labels.get(control_id, control_id)} {int(score)}/5"
            for control_id, score in controls.items()
        )
        lines.append(f"- 세부 톤 강도: {control_text}")
    if int(controls.get("gratitude_intensity") or 0) >= 4 or int(controls.get("empathy_intensity") or 0) >= 4:
        lines.append("- 추가 지시: 감사/공감 표현을 더 풍부하게 넣되 과장하지 않는다.")
    if int(controls.get("detail_depth") or 0) <= 2:
        lines.append("- 추가 지시: 장황한 설명은 줄이고 핵심만 짧게 답한다.")
    elif int(controls.get("detail_depth") or 0) >= 4:
        lines.append("- 추가 지시: 후속 안내나 확인 의지를 한 문장 더 구체적으로 적는다.")
    if top_openings:
        lines.append(f"- 자주 쓰는 시작 표현: {top_openings}")
    if top_closings:
        lines.append(f"- 자주 쓰는 마무리 표현: {top_closings}")
    if common_phrases:
        lines.append(f"- 자주 쓰는 핵심 표현: {common_phrases}")
    return "\n".join(lines)


def estimate_style_similarity(draft_text: object, profile: dict) -> int:
    draft0 = normalize_ws(draft_text)
    if not draft0:
        return 0
    score = 40
    sentence_count = len(split_sentences(draft0))
    avg_sentence_count = float((profile or {}).get("avg_sentence_count") or 0.0)
    if avg_sentence_count > 0:
        diff = abs(sentence_count - avg_sentence_count)
        score += max(0, 20 - int(diff * 8))
    opening = _pick_opening(draft0)
    closing = _pick_closing(draft0)
    if opening and opening in ((profile or {}).get("top_openings") or []):
        score += 20
    if closing and closing in ((profile or {}).get("top_closings") or []):
        score += 20
    phrase_hits = 0
    for phrase in ((profile or {}).get("common_phrases") or []):
        if phrase and phrase in draft0:
            phrase_hits += 1
    score += min(20, phrase_hits * 5)
    return max(0, min(100, int(score)))


def normalize_style_controls(controls: dict | None = None, *, fallback: dict | None = None) -> dict[str, int]:
    base = dict(fallback or _STYLE_LEVEL_PRESETS[3]["controls"])
    raw = dict(controls or {})
    out: dict[str, int] = {}
    for control_id in _STYLE_CONTROL_IDS:
        value = raw.get(control_id, base.get(control_id, 3))
        try:
            value0 = int(value)
        except Exception:
            value0 = int(base.get(control_id, 3) or 3)
        out[control_id] = max(1, min(value0, 5))
    return out


def build_custom_style_preset(controls: dict | None = None) -> dict:
    preset = dict(_STYLE_LEVEL_PRESETS[3])
    preset["level"] = 6
    preset["id"] = "custom"
    preset["name"] = "사용자정의"
    preset["summary"] = "관리자가 5개 톤 항목을 직접 조절하는 커스텀 톤"
    preset["controls"] = normalize_style_controls(controls, fallback=preset.get("controls"))
    return preset


def get_style_level_preset(level: int | None, *, custom_controls: dict | None = None) -> dict:
    try:
        level0 = int(level or 3)
    except Exception:
        level0 = 3
    level0 = max(1, min(level0, 6))
    if level0 == 6:
        return build_custom_style_preset(custom_controls)
    preset = dict(_STYLE_LEVEL_PRESETS.get(level0) or _STYLE_LEVEL_PRESETS[3])
    preset["level"] = level0
    preset["controls"] = normalize_style_controls(preset.get("controls"))
    return preset


def list_style_level_presets() -> list[dict]:
    items = [get_style_level_preset(level) for level in sorted(_STYLE_LEVEL_PRESETS.keys())]
    items.append(build_custom_style_preset())
    return items


def list_preset_field_recommendations() -> list[dict]:
    return [dict(item) for item in _PRESET_FIELD_RECOMMENDATIONS]
