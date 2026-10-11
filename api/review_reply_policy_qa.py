"""Review reply policy QA: AI signature phrases, purchase-pressure closings, repurchase overemphasis.

The word 재구매 itself is allowed. It is flagged only when it is a known AI signature,
a pressure closing, repeated, or mentioned although the customer never mentioned repurchasing.
"""

from __future__ import annotations

import re

RULE_AI_SIGNATURE_PHRASE = "AI_SIGNATURE_PHRASE"
RULE_PURCHASE_PRESSURE_CLOSING = "PURCHASE_PRESSURE_CLOSING"
RULE_REPURCHASE_OVEREMPHASIS = "REPURCHASE_OVEREMPHASIS"

AI_SIGNATURE_VARIANTS: dict[str, re.Pattern] = {
    "재구매_언제든_환영": re.compile(r"재구매\s*(도|는)?\s*(언제든|언제나)\s*(지)?\s*환영"),
    "다음_구매도_언제든_환영": re.compile(r"다음\s*구매\s*(도|는)?\s*(언제든|언제나)\s*(지)?\s*환영"),
    "재구매_환영_기타": re.compile(r"재구매\s*\S{0,6}\s*환영"),
}

_PRESSURE_RE = re.compile(
    r"(다음에도|앞으로도|또)\s*(꼭\s*)?(구매|이용|찾아|재구매)\S*\s*(부탁|바랍|주세요|주시길|기다리)"
    r"|재구매\s*부탁|많은\s*이용\s*부탁|많이\s*찾아\s*주|계속\s*찾아\s*주|꾸준한\s*(이용|사랑)\s*부탁"
    r"|또\s*찾아\s*주|애용\s*부탁|재구매(도)?\s*(언제든\s*)?환영"
)
_REPURCHASE_REVIEW_RE = re.compile(
    r"재구매|재주문|또\s*구매|다시\s*구매|두\s*번째|세\s*번째|[2-9]\s*번째|몇\s*번째|계속\s*(사용|쓰|구매)|꾸준히"
    r"|늘\s*(사용|쓰)|항상\s*(사용|쓰)|매번|여러\s*번|번째\s*구매|정착"
)
_REPURCHASE_REPLY_RE = re.compile(
    r"재구매|다시\s*찾아|또\s*찾아|꾸준히|변함없이|계속\s*(이용|찾아|사용|구매|함께)|다시\s*구매|재주문|믿고\s*찾아"
    r"|오랫동안|늘\s*찾아|항상\s*찾아"
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?^~])\s+")


def _collapse(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def ai_signature_variants(reply_text: object) -> list[str]:
    body = _collapse(reply_text)
    return [name for name, pattern in AI_SIGNATURE_VARIANTS.items() if pattern.search(body)]


def check_reply_policy(reply_text: object, review_text: object = "") -> dict:
    reply = _collapse(reply_text)
    review = _collapse(review_text)
    violations: list[dict] = []
    variants = ai_signature_variants(reply)
    if variants:
        violations.append({"rule": RULE_AI_SIGNATURE_PHRASE, "detail": variants})
    sentences = [s for s in _SENTENCE_SPLIT_RE.split(reply) if s]
    closing = " ".join(sentences[-2:])
    if closing and _PRESSURE_RE.search(closing):
        violations.append({"rule": RULE_PURCHASE_PRESSURE_CLOSING, "detail": _PRESSURE_RE.search(closing).group(0)})
    mentions = _REPURCHASE_REPLY_RE.findall(reply)
    mention_count = len(mentions)
    review_mentions_repurchase = bool(_REPURCHASE_REVIEW_RE.search(review))
    reasons: list[str] = []
    if mention_count >= 2:
        reasons.append("REPURCHASE_MULTI_MENTION")
    if mention_count >= 1 and review and not review_mentions_repurchase:
        reasons.append("REPURCHASE_NOT_IN_REVIEW")
    if reasons:
        violations.append({"rule": RULE_REPURCHASE_OVEREMPHASIS, "detail": reasons})
    return {
        "ok": not violations,
        "violations": violations,
        "repurchase_mention_count": mention_count,
        "review_mentions_repurchase": review_mentions_repurchase,
    }


def count_ai_signature_variants(texts: list[str]) -> dict:
    """Per-variant counts plus the de-duplicated union (variants overlap; never sum them)."""
    per_variant = {name: 0 for name in AI_SIGNATURE_VARIANTS}
    union = 0
    for text in texts:
        hits = ai_signature_variants(text)
        for name in hits:
            per_variant[name] += 1
        if hits:
            union += 1
    return {"per_variant": per_variant, "deduplicated_union": union}
