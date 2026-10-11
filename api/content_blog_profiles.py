from __future__ import annotations

import re
from typing import Any


PROFILE_VERSION = "blog_quality_profile_v1"
AUTHORITY_REFERENCE = "REFERENCE_GUIDELINE"
AUTHORITY_PROJECT = "PROJECT_GUIDELINE"

FAKE_EXPERIENCE_PHRASES = (
    "직접 써보니",
    "직접 사용해 보니",
    "직접 사용해보니",
    "제가 써봤",
    "제가 사용해",
    "제가 사용했을 때",
    "며칠 사용했더니",
    "실제로 해봤",
    "실제로 사용해 봤",
    "써봤더니",
    "고객들이 대부분",
    "많은 분들이 효과를",
    "후기가 매우 좋",
)

CLICHE_PHRASES = (
    "알아보도록 하겠습니다",
    "현대 사회에서",
    "중요한 역할을 합니다",
    "결론적으로 말하자면",
    "요약하건대",
    "매우 중요합니다",
    "귀중한 시간",
    "반드시 명심해야 합니다",
)

OVER_PROMOTIONAL_CTA_PHRASES = (
    "지금 바로 구매",
    "무조건",
    "놓치면 손해",
    "반드시 구매",
    "무조건 써보",
)

FORBIDDEN_SCORE_KEYS = (
    "overall_score",
    "seo_score",
    "naver_score",
    "c_rank_score",
    "dia_score",
    "smartblock_score",
    "overallScore",
    "seoScore",
    "naverScore",
    "cRankScore",
    "diaScore",
    "smartblockScore",
)

_SENTENCE_SPLIT = re.compile(
    r"(?<=습니다)\s+|(?<=입니다)\s+|(?<=됩니다)\s+|(?<=해요)\s+|(?<=예요)\s+|(?<=어요)\s+|(?<=아요)\s+|(?<=[.?!])\s+"
)
_ENDING_PATTERN = re.compile(r"(습니다|입니다|됩니다|해요|이에요|예요|어요|아요|죠|까요|니까)$")


def _base_guideline() -> dict[str, Any]:
    return {
        "title": {
            "preferredMin": 23,
            "preferredMax": 28,
            "excessiveSpecialCharCount": 3,
            "authority": AUTHORITY_REFERENCE,
        },
        "body": {
            "preferredMin": 2200,
            "preferredMax": 2600,
            "authority": AUTHORITY_REFERENCE,
        },
        "paragraph": {
            "preferredTarget": 120,
            "warningMax": 180,
            "minPerSection": 2,
            "authority": AUTHORITY_REFERENCE,
        },
        "keyword": {
            "preferredMinCount": 4,
            "preferredMaxCount": 6,
            "densityMax": 0.02,
            "mechanicalConsecutiveRepeatFail": 4,
            "authority": AUTHORITY_REFERENCE,
        },
        "sections": {
            "preferredMin": 3,
            "preferredMax": 6,
            "authority": AUTHORITY_REFERENCE,
        },
        "faq": {
            "preferredMin": 1,
            "preferredMax": 6,
            "authority": AUTHORITY_REFERENCE,
        },
        "sentenceEnding": {
            "consecutiveRepeatWarning": 3,
            "authority": AUTHORITY_PROJECT,
        },
        "repetition": {
            "duplicateSentenceWarning": 2,
            "mechanicalDuplicateFail": 4,
            "authority": AUTHORITY_PROJECT,
        },
        "cliches": {
            "phrases": list(CLICHE_PHRASES),
            "authority": AUTHORITY_PROJECT,
        },
        "cta": {
            "overPromotionalPhrases": list(OVER_PROMOTIONAL_CTA_PHRASES),
            "authority": AUTHORITY_PROJECT,
        },
        "fakeExperience": {
            "phrases": list(FAKE_EXPERIENCE_PHRASES),
            "authority": AUTHORITY_PROJECT,
        },
    }


def default_blog_quality_profile() -> dict[str, Any]:
    return {
        "profileVersion": PROFILE_VERSION,
        "profileId": "DEFAULT",
        "authority": AUTHORITY_REFERENCE,
        "category": "DEFAULT",
        "source": "reference_blog_spec_soft_guideline",
        "fallbackFrom": None,
        **_base_guideline(),
    }


def product_review_blog_quality_profile() -> dict[str, Any]:
    profile = default_blog_quality_profile()
    profile["profileId"] = "PRODUCT_REVIEW"
    profile["category"] = "PRODUCT_REVIEW"
    profile["source"] = "same_reference_guideline_as_default_no_distinct_project_thresholds"
    return profile


QUALITY_PROFILES = {
    "DEFAULT": default_blog_quality_profile,
    "PRODUCT_REVIEW": product_review_blog_quality_profile,
}


def resolve_blog_quality_profile(intent_analysis: dict[str, Any] | None = None, *, category: str | None = None) -> dict[str, Any]:
    hypothesis = {}
    if isinstance(intent_analysis, dict) and isinstance(intent_analysis.get("categoryHypothesis"), dict):
        hypothesis = intent_analysis["categoryHypothesis"]
    requested = str(category or hypothesis.get("category") or "DEFAULT").strip().upper() or "DEFAULT"
    builder = QUALITY_PROFILES.get(requested)
    if builder is None:
        profile = default_blog_quality_profile()
        profile["fallbackFrom"] = requested
        profile["categoryClassification"] = "PLANNING_INFERENCE"
        return profile
    profile = builder()
    profile["categoryClassification"] = "PLANNING_INFERENCE"
    return profile


def find_phrase_hits(text: str, phrases: tuple[str, ...] | list[str]) -> list[str]:
    blob = str(text or "")
    hits: list[str] = []
    for phrase in phrases:
        if phrase and phrase in blob and phrase not in hits:
            hits.append(phrase)
    return hits


def split_visible_sentences(text: str) -> list[str]:
    parts = [item.strip() for item in _SENTENCE_SPLIT.split(str(text or "")) if item and item.strip()]
    return parts


def sentence_ending_token(sentence: str) -> str | None:
    compact = re.sub(r"[.?!…\s]+$", "", str(sentence or "").strip())
    match = _ENDING_PATTERN.search(compact)
    return match.group(1) if match else None


def consecutive_gram_repeat_count(text: str, gram_size: int) -> int:
    tokens = str(text or "").split()
    if gram_size < 1 or len(tokens) < gram_size * 2:
        return 1
    best = 1
    start = 0
    while start + gram_size * 2 <= len(tokens):
        gram = tuple(tokens[start : start + gram_size])
        run = 1
        cursor = start + gram_size
        while cursor + gram_size <= len(tokens) and tuple(tokens[cursor : cursor + gram_size]) == gram:
            run += 1
            cursor += gram_size
        best = max(best, run)
        start += 1
    return best


def max_consecutive_phrase_repeats(text: str) -> int:
    return max(consecutive_gram_repeat_count(text, size) for size in (1, 2, 3))
