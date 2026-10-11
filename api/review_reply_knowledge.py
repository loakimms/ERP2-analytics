"""Historical review-reply knowledge corpus, verification queue and lexical retrieval baseline.

Authorship (who wrote the past reply) and content validation (is the guidance correct and
still valid) are independent. Content approval never changes authorship.
Retrieval here is LEXICAL_RETRIEVAL_BASELINE (product / topic / signal / keyword); it is not
semantic retrieval.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import date, datetime
from difflib import SequenceMatcher

from review_reply_integrity import REPLY_BODY_VALID, classify_reply_body
from review_reply_knowledge_extraction import (
    EXTRACTION_VERSION,
    UNIT_REPLY_APPROVED_NOT_INDIVIDUALLY_VERIFIED,
    UNIT_REVALIDATION_REQUIRED,
    UNIT_UNVERIFIED,
    compare_extractions,
    extract_units,
)
from review_reply_knowledge_unit_facts import (
    FACT_STATES,
    FACT_VERIFIED,
    RESOLUTIONS,
    SOURCE_REGISTRY_VERSION,
    UNIT_FACT_CONTRACT_VERSION,
    UNIT_FACT_PARENT_ALLOWED,
    is_fact_candidate,
    load_official_source_registry,
    resolve_unit_fact,
    unit_fact_use,
    unit_key,
    unit_products,
)
from review_reply_policy_qa import (
    RULE_AI_SIGNATURE_PHRASE,
    RULE_PURCHASE_PRESSURE_CLOSING,
    check_reply_policy,
    count_ai_signature_variants,
)

RETRIEVAL_STATUS = "LEXICAL_RETRIEVAL_BASELINE"
CORPUS_VERSION = f"review_reply_knowledge_v1+{EXTRACTION_VERSION}"

AUTHORSHIP_HUMAN_CONFIRMED = "HUMAN_CONFIRMED"
AUTHORSHIP_AI_CONFIRMED = "AI_CONFIRMED"
AUTHORSHIP_AI_HUMAN_EDITED = "AI_HUMAN_EDITED"
AUTHORSHIP_LIKELY_HUMAN = "LIKELY_HUMAN"
AUTHORSHIP_LIKELY_AI = "LIKELY_AI"
AUTHORSHIP_UNKNOWN = "UNKNOWN"
AUTHORSHIP_INVALID = "INVALID"

TIER_PRIMARY_VERIFIED_HUMAN = "PRIMARY_VERIFIED_HUMAN"
TIER_PROVISIONAL_HUMAN_REFERENCE = "PROVISIONAL_HUMAN_REFERENCE"
TIER_MANUAL_VERIFICATION_CANDIDATE = "MANUAL_VERIFICATION_CANDIDATE"
TIER_UNKNOWN_NO_KNOWHOW = "UNKNOWN_NO_KNOWHOW"
TIER_AI_ORIGIN_REFERENCE = "AI_ORIGIN_REFERENCE"
TIER_EXCLUDED_INVALID = "EXCLUDED_INVALID"

CONTENT_PENDING = "PENDING"
CONTENT_APPROVED = "APPROVED"
CONTENT_HOLD = "HOLD"
CONTENT_EXCLUDED = "EXCLUDED"
CONTENT_OUTDATED = "OUTDATED"
CONTENT_VALIDATION_STATES = (CONTENT_PENDING, CONTENT_APPROVED, CONTENT_HOLD, CONTENT_EXCLUDED, CONTENT_OUTDATED)

HUMAN_REFERENCE_TIERS = (
    TIER_PRIMARY_VERIFIED_HUMAN,
    TIER_PROVISIONAL_HUMAN_REFERENCE,
    TIER_MANUAL_VERIFICATION_CANDIDATE,
)

# --- authorship rules (ported 1:1 from the authorship attribution ledger audit) ---
_LEDGER_UI_RE = re.compile(r"리뷰 신고|답글 등록|최소 5자|베스트리뷰여부|리뷰전시여부|IE환경|0 / 1000|재구매 여부 툴팁")
_PLACEHOLDER_RE = re.compile(r"^(답글|답변|-+|\.+|없음|null|none|n/?a)$", re.I)
_NORM_RE = re.compile(r"[^0-9A-Za-z가-힣]+")
_HUMAN_HALLMARK_RE = re.compile(
    r"고객님\s*!{2,}|~~\s*고객님|안녕하세요~~|항상 고객님들의 건강을 위해|새해 복 많이 받으세요\^\^|즐거운 명절"
)
_LLM_EMOJI_RE = re.compile(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]")
_LLM_PHRASE_RE = re.compile(r"진심으로 감사드립니다|큰 의미|뿌듯|더할 나위|마음이 먹먹|큰 응원|와닿|전해집니다|소중한 경험")
_AI_SYSTEM_SIGNATURE_RE = re.compile(
    r"^안녕하세요,?\s*고객님[,.]\s*(소중한\s*(리뷰|후기)|기대하신|불편을)|재구매도 언제든 환영합니다|고객센터\(02-455-1991\) 또는 Q&A, 톡톡"
)
_OPERATOR_AI_PHRASE_RE = re.compile(r"재구매\s*(도|는)?\s*(언제든|언제나)\s*(지)?\s*환영")
KNOWHOW_RE = re.compile(
    r"비율|[0-9]\s*[:：대]\s*[0-9]|레드\s*\d|브라운\s*\d|암라|방치|도포|딥클린|발색|장갑|헹굼|세척|산화|물\s*온도|물양|패치\s*테스트|[0-9]\s*시간|선염색|후염색|맥주효모"
)

# --- topic / signal vocabulary ---
TOPIC_PATTERNS: dict[str, re.Pattern] = {
    "HENNA_COLOR": re.compile(r"발색|색이|색상|컬러|색감|물들|착색|색깔|진하|연하|블랙|흑색|검정|다크|내추럴|자연갈색"),
    "RED_BROWN": re.compile(r"레드|빨갛|빨간|붉|브라운|갈색|주황|오렌지"),
    "TIME": re.compile(r"방치|\d+\s*시간|\d+\s*분|시간이|오래\s*(두|걸|놔)|기다리"),
    "RATIO": re.compile(r"비율|\d\s*[:：]\s*\d|\d\s*대\s*\d|섞|혼합|물\s*양|물양|농도|배합|반죽|되직|묽"),
    "GRAY_COVERAGE": re.compile(r"새치|흰머리|백모|흰\s*머리|커버"),
    "HAIR_CONDITION": re.compile(r"손상|푸석|윤기|부드럽|뻣뻣|건조|두피|탈모|가렵|모발|머릿결|머리결|볼륨|빠지"),
    "HAIR_PACK": re.compile(r"헤어팩|트리트먼트|헤어\s*팩"),
    "JOJOBA": re.compile(r"호호바"),
    "SHAMPOO": re.compile(r"샴푸|거품|세정|린스"),
    "USAGE": re.compile(r"사용법|사용\s*방법|바르|발라|도포|헹|감고|감은|장갑|랩|비닐캡|캡을|드라이|말리|선염색|후염색|딥클린|세척|패치\s*테스트"),
    "DELIVERY_PACKAGING": re.compile(r"배송|포장|파손|택배|박스|도착|배달|누수|새서|샜"),
    "SKIN_REACTION": re.compile(r"따갑|따끔|가려|알레르기|알러지|두드러기|트러블|자극|붉어|부작용|뾰루지|피부\s*반응|화끈"),
    "SMELL": re.compile(r"냄새|향이|향기|향도"),
    "PRICE_VALUE": re.compile(r"가격|저렴|비싸|가성비|할인"),
}
# Topics that are about logistics rather than the product; cross-product matches are fine.
PRODUCT_AGNOSTIC_TOPICS = {"DELIVERY_PACKAGING", "PRICE_VALUE"}

_EXPERIENCE_RE = re.compile(r"사용해|써보|써 보|발라보|해봤|해보니|했더니|했는데|써봤|사용했|사용중|쓰고\s*있|염색했|감아")
_POSITIVE_RE = re.compile(r"좋아|좋네|좋고|좋습니다|좋았|만족|최고|추천|예뻐|예쁘|이뻐|잘\s*(돼|되|나|들)|짱|대박|굿|훌륭")
_NEGATIVE_RE = re.compile(
    r"불편|별로|아쉽|실망|안\s*(돼|되|나와|들어)|어렵|힘들|불만|문제|아파|따갑|가려|최악|환불|반품|교환|안좋|안 좋"
)
_QUESTION_RE = re.compile(r"\?|궁금|어떻게|되나요|될까요|할까요|하나요|인가요|문의|알려\s*주|가능한가|맞나요")
_FACT_RATIO_RE = re.compile(r"\d+\s*[:：대]\s*\d+")
_FACT_DURATION_RE = re.compile(r"\d+\s*(시간|분)")
_FACT_INGREDIENT_RE = re.compile(r"암라|맥주효모|인디고|카시아|레드\s*\d|브라운\s*\d")
_SENTENCE_RE = re.compile(r"[^.!?~^\n]+[.!?~^]*")
_TOKEN_RE = re.compile(r"[가-힣A-Za-z0-9]{2,}")
_STOPWORDS = {
    "고객님", "감사", "감사합니다", "감사드립니다", "정말", "너무", "진짜", "사용", "제품", "구매", "리뷰", "후기",
    "합니다", "있어요", "있습니다", "같아요", "그리고", "그런데", "하지만", "이번", "다음", "항상", "아주", "많이",
    "좋아요", "좋습니다", "안녕하세요", "주셔서", "남겨", "남겨주셔서", "하루", "되세요",
}


def _collapse(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _norm(text: object) -> str:
    return _NORM_RE.sub("", str(text or ""))


def _sim(a: object, b: object) -> float:
    a0, b0 = _norm(a), _norm(b)
    if not a0 or not b0:
        return 0.0
    return SequenceMatcher(None, a0, b0, autojunk=False).ratio()


def _parse_payload(raw: object) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(str(raw))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


parse_payload = _parse_payload


def _parse_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    match = re.match(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", str(value or "").strip())
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except Exception:
        return None


def _as_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return _parse_date(value)


def reply_sha256(text: object) -> str:
    return hashlib.sha256(_collapse(text).encode("utf-8")).hexdigest()


def product_group(title: object, url: object = "") -> str:
    text = f"{title or ''} {url or ''}"
    if "헤어팩" in text or "트리트먼트" in text:
        return "HAIR_PACK"
    if "호호바" in text and "염색" not in text:
        return "JOJOBA"
    if "샴푸" in text:
        return "SHAMPOO"
    if "헤나" in text or "염색" in text:
        return "HENNA"
    return "UNMAPPED"


def is_ledger_invalid(reply_text: object) -> bool:
    body = _collapse(reply_text)
    if not body:
        return True
    if re.fullmatch(r"\d{1,4}", body):
        return True
    if _LEDGER_UI_RE.search(body):
        return True
    if _PLACEHOLDER_RE.fullmatch(body) or len(_norm(body)) < 2:
        return True
    return classify_reply_body(body) != REPLY_BODY_VALID


def classify_authorship(
    *,
    reply_text: str,
    reply_payload: dict,
    remote_reply_date: date | None,
    drafts: list[dict],
    first_ai_draft_date: date | None,
) -> tuple[str, str]:
    text = _collapse(reply_text)
    if is_ledger_invalid(text):
        return AUTHORSHIP_INVALID, f"INVALID_{classify_reply_body(text)}"
    source = str(reply_payload.get("source") or "")
    linked = None
    if reply_payload.get("draft_id"):
        linked = next((d for d in drafts if d.get("draft_id") == reply_payload.get("draft_id")), None)
    best, best_sim = None, 0.0
    for draft in drafts:
        value = _sim(text, draft.get("draft_text"))
        if value > best_sim:
            best, best_sim = draft, value
    if linked is not None:
        link_sim = _sim(text, linked.get("draft_text"))
    else:
        linked, link_sim = best, best_sim
    generated_dates = [d for d in (_as_date(x.get("generated_at")) for x in drafts) if d]
    first_gen = min(generated_dates) if generated_dates else None
    reply_before_draft = bool(remote_reply_date and first_gen and remote_reply_date < first_gen)
    llm_score = (
        (1 if _LLM_EMOJI_RE.search(text) else 0)
        + (1 if ("…" in text or "“" in text or "”" in text) else 0)
        + (1 if len(text) >= 220 else 0)
        + (1 if _LLM_PHRASE_RE.search(text) else 0)
    )
    human_mark = bool(_HUMAN_HALLMARK_RE.search(text))
    linked_equal = linked is not None and _norm(text) == _norm(linked.get("draft_text"))
    if source == "smartstore_seller_center_submit" and linked_equal:
        return AUTHORSHIP_AI_CONFIRMED, "SYSTEM_REGISTRATION_PAYLOAD_DRAFT_ID_TEXT_EQUAL"
    if linked_equal and str(linked.get("status") or "") in ("approved", "generated", "superseded"):
        return AUTHORSHIP_AI_CONFIRMED, f"REMOTE_TEXT_EQUALS_AI_DRAFT({linked.get('status')})"
    if linked is not None and link_sim >= 0.6 and not reply_before_draft:
        return AUTHORSHIP_AI_HUMAN_EDITED, f"SAME_REVIEW_DRAFT_SIM_{link_sim:.2f}_TEXT_DIFFERS"
    if source == "smartstore_seller_center_submit":
        return AUTHORSHIP_LIKELY_AI, "SYSTEM_REGISTRATION_WITHOUT_MATCHING_DRAFT"
    if _OPERATOR_AI_PHRASE_RE.search(text):
        return AUTHORSHIP_AI_CONFIRMED, "OPERATOR_ATTESTED_AI_PHRASE"
    if drafts and reply_before_draft:
        cls = AUTHORSHIP_LIKELY_HUMAN if not (llm_score >= 2 and not human_mark) else AUTHORSHIP_UNKNOWN
        return cls, "REMOTE_REPLY_PREDATES_AI_DRAFT"
    if drafts:
        cls = AUTHORSHIP_LIKELY_HUMAN if (human_mark or llm_score <= 1) else AUTHORSHIP_UNKNOWN
        return cls, "AI_DRAFT_EXISTS_BUT_FINAL_UNRELATED"
    if _AI_SYSTEM_SIGNATURE_RE.search(text) and not human_mark:
        return AUTHORSHIP_LIKELY_AI, "SYSTEM_AI_STYLE_SIGNATURE_NO_DRAFT"
    if llm_score >= 3 and not human_mark:
        return AUTHORSHIP_LIKELY_AI, "EXTERNAL_LLM_STYLE_SCORE_GE3"
    if human_mark and llm_score <= 1:
        return AUTHORSHIP_LIKELY_HUMAN, "HUMAN_TEMPLATE_HALLMARK"
    if remote_reply_date and first_ai_draft_date and remote_reply_date < first_ai_draft_date and llm_score <= 1:
        return AUTHORSHIP_LIKELY_HUMAN, "REMOTE_REPLY_BEFORE_FIRST_SYSTEM_AI_DRAFT"
    return AUTHORSHIP_UNKNOWN, f"NO_DRAFT_NO_DIRECT_EVIDENCE_llm{llm_score}_hm{int(human_mark)}"


def detect_topics(text: object) -> list[str]:
    body = _collapse(text)
    return [name for name, pattern in TOPIC_PATTERNS.items() if pattern.search(body)]


def review_signals(review_text: object) -> dict:
    body = _collapse(review_text)
    return {
        "experience": bool(_EXPERIENCE_RE.search(body)),
        "positive": bool(_POSITIVE_RE.search(body)),
        "negative": bool(_NEGATIVE_RE.search(body)),
        "question": bool(_QUESTION_RE.search(body)),
    }


def extract_knowhow_items(reply_text: object) -> list[dict]:
    """Legacy sentence splitter (knowhow_sentence_v1); kept only as the comparison baseline."""
    items: list[dict] = []
    for match in _SENTENCE_RE.finditer(str(reply_text or "")):
        sentence = _collapse(match.group(0))
        if not sentence or not KNOWHOW_RE.search(sentence):
            continue
        facts = (
            [f"RATIO:{x}" for x in _FACT_RATIO_RE.findall(sentence)]
            + [f"DURATION:{m.group(0)}" for m in _FACT_DURATION_RE.finditer(sentence)]
            + [f"INGREDIENT:{x}" for x in _FACT_INGREDIENT_RE.findall(sentence)]
        )
        items.append(
            {
                "sentence": sentence,
                "topics": detect_topics(sentence),
                "facts": facts,
                "requires_current_fact_verification": bool(facts),
            }
        )
    return items


def _content_terms(text: object) -> set[str]:
    out: set[str] = set()
    for token in _TOKEN_RE.findall(_collapse(text)):
        if token in _STOPWORDS:
            continue
        out.add(token[:3])
    return out


def _rating_band(rating: object) -> str:
    try:
        value = int(round(float(rating)))
    except Exception:
        return "unknown"
    if value >= 4:
        return "positive"
    if value == 3:
        return "neutral"
    return "negative"


def assign_tier(authorship: str, has_knowhow: bool) -> str:
    if authorship == AUTHORSHIP_INVALID:
        return TIER_EXCLUDED_INVALID
    if authorship in (AUTHORSHIP_AI_CONFIRMED, AUTHORSHIP_AI_HUMAN_EDITED, AUTHORSHIP_LIKELY_AI):
        return TIER_AI_ORIGIN_REFERENCE
    if authorship == AUTHORSHIP_HUMAN_CONFIRMED:
        return TIER_PRIMARY_VERIFIED_HUMAN
    if authorship == AUTHORSHIP_LIKELY_HUMAN:
        return TIER_PROVISIONAL_HUMAN_REFERENCE
    return TIER_MANUAL_VERIFICATION_CANDIDATE if has_knowhow else TIER_UNKNOWN_NO_KNOWHOW


AUTH_EXCLUDED_INVALID_REPLY = "EXCLUDED_INVALID_REPLY"
AUTH_AI_ORIGIN_REFERENCE = "AI_ORIGIN_REFERENCE"
AUTH_HISTORICAL_REPLY_ORIGINAL = "HISTORICAL_REPLY_ORIGINAL"
AUTH_EXTRACTED_KNOWLEDGE = "EXTRACTED_KNOWLEDGE"
AUTH_VALIDATION_STALE_REPLY_CHANGED = "VALIDATION_STALE_REPLY_CHANGED"
AUTH_APPROVED_HISTORICAL_REFERENCE = "APPROVED_HISTORICAL_REFERENCE"
AUTH_APPROVED_NOT_CURRENTLY_VALID = "APPROVED_NOT_CURRENTLY_VALID"
AUTH_REVALIDATION_REQUIRED = "REVALIDATION_REQUIRED"
AUTH_VALIDATION_HOLD = "VALIDATION_HOLD"
AUTH_VALIDATION_EXCLUDED = "VALIDATION_EXCLUDED"
AUTH_VALIDATION_OUTDATED = "VALIDATION_OUTDATED"
AUTH_VALIDATED_KNOWLEDGE = "VALIDATED_KNOWLEDGE"
USE_AUTHORITY_STATES = (
    AUTH_EXCLUDED_INVALID_REPLY,
    AUTH_AI_ORIGIN_REFERENCE,
    AUTH_HISTORICAL_REPLY_ORIGINAL,
    AUTH_EXTRACTED_KNOWLEDGE,
    AUTH_VALIDATION_STALE_REPLY_CHANGED,
    AUTH_APPROVED_HISTORICAL_REFERENCE,
    AUTH_APPROVED_NOT_CURRENTLY_VALID,
    AUTH_REVALIDATION_REQUIRED,
    AUTH_VALIDATION_HOLD,
    AUTH_VALIDATION_EXCLUDED,
    AUTH_VALIDATION_OUTDATED,
    AUTH_VALIDATED_KNOWLEDGE,
)
REPLY_REFERENCE_AUTHORITIES = (AUTH_APPROVED_HISTORICAL_REFERENCE, AUTH_VALIDATED_KNOWLEDGE)
USE_AUTHORITY_SCOPE = "HUMAN_REFERENCE_TIERS_WITH_KNOWHOW"
USE_AUTHORITY_FORMULA = {
    "scope": "tier in HUMAN_REFERENCE_TIERS and has_knowhow (= Knowledge 검증 대기열 all_candidates)",
    "reply_reference_eligible": "latest validation APPROVED and currently_valid=yes and reply_sha256 matches "
    "and revalidation_required=false",
    "generator_fact_eligible": "reply_reference_eligible and every knowledge unit has an applicable VERIFIED unit fact "
    "validation (registered official evidence covering product/condition/numeric/sequence; unit key = reply hash + "
    "extraction version + span + unit text)",
    "revalidation_required": "latest validation APPROVED and stored validation snapshot vs current extraction "
    "has a meaning change (condition/sequence/numeric range/product target/guidance added)",
    "approved_retrieval_boost": "reply_reference_eligible",
}
UNIT_FACT_VALIDATION_UNAVAILABLE = "NO_UNIT_FACT_VALIDATION_RECORD"
UNIT_FACT_PARTIAL = "UNIT_FACT_PARTIALLY_VERIFIED"
UNIT_FACT_FORMULA = {
    "scope": "fact-candidate units (non-question) of USE_AUTHORITY_SCOPE replies",
    "unit_key": "sha256(knowledge_id | reply_sha256 | extraction_version | span start | span end | unit text sha256)",
    "status": "latest append-only record for the unit key; no record = PENDING; record whose evidence entry hash "
    "changed = PENDING (OFFICIAL_SOURCE_CHANGED); record for another key overlapping the span = PENDING (STALE_*)",
    "unit_generator_fact_eligible": "status VERIFIED and generator_reference_allowed=yes and parent reply authority in "
    + ", ".join(UNIT_FACT_PARENT_ALLOWED),
    "verified_requires": "all applicable aspects answered yes, verified scope, note, and registered ACTIVE "
    "OFFICIAL_PRODUCT_GUIDE / CURRENT_PRODUCT_INFO entries matching the unit products and covering every applicable "
    "aspect; numbers must not exceed the official entry numbers",
}


def _unit_fact_validation_evidence(item: dict) -> list[dict]:
    """Fact-candidate units whose applicable latest unit fact validation is VERIFIED."""
    return [
        u for u in item["knowhow_items"]
        if is_fact_candidate(u) and (u.get("factValidation") or {}).get("status") == FACT_VERIFIED
    ]


def compute_use_authority(item: dict) -> dict:
    validation = item.get("latest_validation") or {}
    content_validation = item["content_validation"]
    stored_sha = validation.get("reply_sha256_at_validation") if validation else None
    hash_mismatch = bool(validation) and stored_sha not in (None, "") and stored_sha != item["reply_sha256"]
    currently_valid = validation.get("currently_valid") if validation else None
    revalidation = bool(item.get("revalidation_required"))
    meaning_changed = bool((item.get("extraction_change") or {}).get("meaningChanged"))
    evidence = _unit_fact_validation_evidence(item)

    if item["authorship"] == AUTHORSHIP_INVALID:
        state = AUTH_EXCLUDED_INVALID_REPLY
    elif item["tier"] == TIER_AI_ORIGIN_REFERENCE:
        state = AUTH_AI_ORIGIN_REFERENCE
    elif hash_mismatch:
        state = AUTH_VALIDATION_STALE_REPLY_CHANGED
    elif content_validation == CONTENT_APPROVED:
        if revalidation:
            state = AUTH_REVALIDATION_REQUIRED
        elif currently_valid != "yes":
            state = AUTH_APPROVED_NOT_CURRENTLY_VALID
        elif evidence and len(evidence) == len([u for u in item["knowhow_items"] if is_fact_candidate(u)]):
            state = AUTH_VALIDATED_KNOWLEDGE
        else:
            state = AUTH_APPROVED_HISTORICAL_REFERENCE
    elif content_validation == CONTENT_HOLD:
        state = AUTH_VALIDATION_HOLD
    elif content_validation == CONTENT_EXCLUDED:
        state = AUTH_VALIDATION_EXCLUDED
    elif content_validation == CONTENT_OUTDATED:
        state = AUTH_VALIDATION_OUTDATED
    else:
        state = AUTH_EXTRACTED_KNOWLEDGE if item["has_knowhow"] else AUTH_HISTORICAL_REPLY_ORIGINAL

    reply_reference_eligible = state in REPLY_REFERENCE_AUTHORITIES
    generator_fact_eligible = state == AUTH_VALIDATED_KNOWLEDGE
    reasons: list[str] = []
    if not generator_fact_eligible:
        if content_validation != CONTENT_APPROVED:
            reasons.append("REPLY_NOT_APPROVED")
        if hash_mismatch:
            reasons.append("REPLY_HASH_MISMATCH")
        if revalidation:
            reasons.append("REVALIDATION_REQUIRED")
        elif meaning_changed and content_validation == CONTENT_APPROVED:
            reasons.append("EXTRACTION_MEANING_CHANGED")
        if content_validation == CONTENT_APPROVED and currently_valid != "yes":
            reasons.append("NOT_CURRENTLY_VALID")
        if state in (AUTH_AI_ORIGIN_REFERENCE, AUTH_EXCLUDED_INVALID_REPLY):
            reasons.append(state)
        if not evidence:
            reasons.append(UNIT_FACT_VALIDATION_UNAVAILABLE)
        elif state != AUTH_VALIDATED_KNOWLEDGE:
            reasons.append(UNIT_FACT_PARTIAL)
    return {
        "current_use_authority": state,
        "reply_reference_eligible": reply_reference_eligible,
        "generator_fact_eligible": generator_fact_eligible,
        "approved_retrieval_boost": reply_reference_eligible,
        "fact_ineligible_reasons": reasons,
        "unit_fact_validation_count": len(evidence),
    }


def _guidance_validity(content_validation: str, currently_valid: str | None, requires_fact_check: bool) -> str:
    if content_validation == CONTENT_OUTDATED or currently_valid == "no":
        return "OUTDATED"
    if content_validation == CONTENT_APPROVED and currently_valid == "yes":
        return "REPLY_APPROVED_UNIT_FACT_UNVERIFIED"
    if requires_fact_check:
        return "UNVERIFIED_REQUIRES_CURRENT_FACT_CHECK"
    return "UNVERIFIED"


def _queue_priority(item: dict) -> float:
    score = 0.0
    if item["tier"] == TIER_MANUAL_VERIFICATION_CANDIDATE:
        score += 3.0
    elif item["tier"] == TIER_PROVISIONAL_HUMAN_REFERENCE and item["has_knowhow"]:
        score += 2.0
    score += min(3, len(item["knowhow_items"]))
    if any(k["requires_current_fact_verification"] for k in item["knowhow_items"]):
        score += 1.0
    if not item["template_like"]:
        score += 1.0
    if item["review_signals"]["negative"]:
        score += 0.5
    if item["review_signals"]["question"]:
        score += 0.5
    if item["policy_violations"]:
        score -= 1.0
    return round(score, 3)


def build_corpus(
    *,
    reviews: list[dict],
    replies: dict[str, dict],
    drafts_by_review: dict[str, list[dict]],
    latest_validations: dict[str, dict] | None = None,
    unit_fact_records: dict[str, list[dict]] | None = None,
    fact_registry: dict | None = None,
) -> dict:
    latest_validations = latest_validations or {}
    unit_fact_records = unit_fact_records or {}
    fact_registry = fact_registry or load_official_source_registry()
    review_by_key = {str(r["review_key"]): r for r in reviews}
    title_by_url: dict[str, str] = {}
    for r in reviews:
        if r.get("product_title") and r.get("product_url"):
            title_by_url.setdefault(str(r["product_url"]), str(r["product_title"]))
    all_generated = [
        d for d in (_as_date(x.get("generated_at")) for rows in drafts_by_review.values() for x in rows) if d
    ]
    first_ai_draft_date = min(all_generated) if all_generated else None

    staged: list[dict] = []
    for review_key, reply in replies.items():
        review = review_by_key.get(review_key)
        if review is None:
            continue
        reply_text = _collapse(reply.get("reply_text"))
        payload = _parse_payload(reply.get("raw_payload_json"))
        review_payload = _parse_payload(review.get("raw_payload_json"))
        remote_reply_date = _parse_date(review_payload.get("답글등록일시")) or _as_date(reply.get("reply_written_at"))
        authorship, evidence = classify_authorship(
            reply_text=reply_text,
            reply_payload=payload,
            remote_reply_date=remote_reply_date,
            drafts=drafts_by_review.get(review_key, []),
            first_ai_draft_date=first_ai_draft_date,
        )
        staged.append(
            {
                "review_key": review_key,
                "review": review,
                "reply_text": reply_text,
                "remote_reply_date": remote_reply_date,
                "authorship": authorship,
                "authorship_evidence": evidence,
            }
        )

    template_counts = Counter(_norm(x["reply_text"]) for x in staged if x["authorship"] != AUTHORSHIP_INVALID)
    items: list[dict] = []
    for row in staged:
        review = row["review"]
        reply_text = row["reply_text"]
        authorship = row["authorship"]
        knowledge_id = f"rrk:{row['review_key']}"
        has_knowhow = authorship != AUTHORSHIP_INVALID and bool(KNOWHOW_RE.search(reply_text))
        knowhow_items = (
            extract_units(reply_text, source_id=knowledge_id, detect_topics=detect_topics)
            if authorship != AUTHORSHIP_INVALID
            else []
        )
        tier = assign_tier(authorship, has_knowhow)
        validation = latest_validations.get(knowledge_id) or {}
        content_validation = str(validation.get("content_validation") or CONTENT_PENDING)
        if validation and validation.get("reply_sha256_at_validation") not in (None, "", reply_sha256(reply_text)):
            content_validation = CONTENT_PENDING
        currently_valid = validation.get("currently_valid")
        snapshot = validation.get("knowhow_snapshot") if validation else None
        baseline_units = snapshot if isinstance(snapshot, list) else (extract_knowhow_items(reply_text) if has_knowhow else [])
        extraction_change = compare_extractions(baseline_units, knowhow_items, reply_text)
        extraction_change["comparedWith"] = "VALIDATION_SNAPSHOT" if isinstance(snapshot, list) else "LEGACY_EXTRACTION"
        revalidation_required = content_validation == CONTENT_APPROVED and extraction_change["meaningChanged"]
        current_reply_sha = reply_sha256(reply_text)
        item_fact_records = unit_fact_records.get(knowledge_id) or []
        for one in knowhow_items:
            one["factValidation"] = (
                resolve_unit_fact(
                    one,
                    key=unit_key(knowledge_id, current_reply_sha, one),
                    reply_sha=current_reply_sha,
                    records=item_fact_records,
                    registry=fact_registry,
                )
                if is_fact_candidate(one)
                else None
            )
            one["current_validity"] = _guidance_validity(
                content_validation, currently_valid, one["requires_current_fact_verification"]
            )
            one["useAuthority"] = AUTH_EXTRACTED_KNOWLEDGE
            one["generatorFactEligible"] = False
            if revalidation_required:
                one["validationStatus"] = UNIT_REVALIDATION_REQUIRED
                one["current_validity"] = AUTH_REVALIDATION_REQUIRED
            elif content_validation == CONTENT_APPROVED:
                one["validationStatus"] = UNIT_REPLY_APPROVED_NOT_INDIVIDUALLY_VERIFIED
            else:
                one["validationStatus"] = UNIT_UNVERIFIED
        review_text = _collapse(review.get("review_text"))
        policy = check_reply_policy(reply_text, review_text) if authorship != AUTHORSHIP_INVALID else {"violations": []}
        resolved_title = (
            review.get("product_title")
            or _collapse(_parse_payload(review.get("raw_payload_json")).get("상품명"))
            or title_by_url.get(str(review.get("product_url") or ""))
            or None
        )
        item = {
            "knowledge_id": knowledge_id,
            "review_key": row["review_key"],
            "product_title": resolved_title,
            "product_group": product_group(resolved_title, review.get("product_url")),
            "rating": review.get("rating"),
            "review_written_at": str(_as_date(review.get("review_written_at")) or "") or None,
            "remote_reply_date": str(row["remote_reply_date"]) if row["remote_reply_date"] else None,
            "review_text": review_text,
            "reply_text": reply_text,
            "reply_sha256": reply_sha256(reply_text),
            "authorship": authorship,
            "authorship_evidence": row["authorship_evidence"],
            "tier": tier,
            "has_knowhow": has_knowhow,
            "knowhow_items": knowhow_items,
            "review_topics": detect_topics(review_text),
            "reply_topics": detect_topics(reply_text),
            "review_signals": review_signals(review_text),
            "template_like": template_counts.get(_norm(reply_text), 0) >= 3,
            "policy_violations": [v["rule"] for v in policy["violations"]],
            "content_validation": content_validation,
            "latest_validation": validation or None,
            "extraction_version": EXTRACTION_VERSION,
            "extraction_change": extraction_change,
            "previous_extraction": baseline_units,
            "revalidation_required": revalidation_required,
        }
        item["queue_priority"] = _queue_priority(item) if tier in HUMAN_REFERENCE_TIERS else None
        item.update(compute_use_authority(item))
        unit_status: Counter = Counter()
        for one in knowhow_items:
            if one["factValidation"] is None:
                one.update({"generatorFactEligible": False, "factUseBlockedReasons": ["NOT_A_FACT_CANDIDATE"]})
                continue
            one.update(unit_fact_use(one["factValidation"], item["current_use_authority"]))
            unit_status[one["factValidation"]["status"]] += 1
        item["unit_fact_counts"] = {
            "candidates": sum(unit_status.values()),
            "status": {s: unit_status.get(s, 0) for s in FACT_STATES},
            "generator_fact_eligible": sum(1 for u in knowhow_items if u.get("generatorFactEligible")),
            "history_records": len(item_fact_records),
        }
        items.append(item)

    summary = summarize_corpus(items)
    summary["official_source_registry_version"] = fact_registry["registry_version"]
    return {"corpus_version": CORPUS_VERSION, "items": items, "summary": summary, "fact_registry": fact_registry}


def summarize_corpus(items: list[dict]) -> dict:
    authorship = Counter(x["authorship"] for x in items)
    tiers = Counter(x["tier"] for x in items)
    validation = Counter(x["content_validation"] for x in items if x["tier"] in HUMAN_REFERENCE_TIERS)
    knowhow = Counter(x["authorship"] for x in items if x["has_knowhow"])
    valid_texts = [x["reply_text"] for x in items if x["authorship"] != AUTHORSHIP_INVALID]
    scope = [x for x in items if x["tier"] in HUMAN_REFERENCE_TIERS and x["has_knowhow"]]
    scope_authority = Counter(x["current_use_authority"] for x in scope)
    units = [u for x in scope for u in x["knowhow_items"] if is_fact_candidate(u)]
    unit_status = Counter((u.get("factValidation") or {}).get("status") for u in units)
    unit_resolution = Counter((u.get("factValidation") or {}).get("resolution") for u in units)
    product_tags = Counter(p for u in units for p in unit_products(u))
    return {
        "total": len(items),
        "invalid": authorship.get(AUTHORSHIP_INVALID, 0),
        "valid": len(items) - authorship.get(AUTHORSHIP_INVALID, 0),
        "authorship": dict(authorship),
        "tiers": dict(tiers),
        "content_validation_of_human_reference_tiers": dict(validation),
        "knowhow_by_authorship": dict(knowhow),
        "unknown_with_knowhow": tiers.get(TIER_MANUAL_VERIFICATION_CANDIDATE, 0),
        "revalidation_required": sum(1 for x in items if x.get("revalidation_required")),
        "extraction_version": EXTRACTION_VERSION,
        "use_authority_scope": USE_AUTHORITY_SCOPE,
        "use_authority_scope_total": len(scope),
        "use_authority_counts": {state: scope_authority.get(state, 0) for state in USE_AUTHORITY_STATES},
        "reply_reference_eligible": sum(1 for x in scope if x["reply_reference_eligible"]),
        "generator_fact_eligible": sum(1 for x in scope if x["generator_fact_eligible"]),
        "use_authority_formula": USE_AUTHORITY_FORMULA,
        "unit_fact_contract_version": UNIT_FACT_CONTRACT_VERSION,
        "unit_fact_scope_units": len(units),
        "unit_fact_unique_keys": len({(u.get("factValidation") or {}).get("unitKey") for u in units}),
        "unit_fact_status_counts": {s: unit_status.get(s, 0) for s in FACT_STATES},
        "unit_fact_resolution_counts": {r: unit_resolution.get(r, 0) for r in RESOLUTIONS},
        "unit_generator_fact_eligible": sum(1 for u in units if u.get("generatorFactEligible")),
        "unit_product_tag_counts": dict(product_tags.most_common()),
        "unit_product_tag_total": sum(product_tags.values()),
        "unit_product_unknown": sum(1 for u in units if not unit_products(u)),
        "unit_fact_formula": UNIT_FACT_FORMULA,
        "official_source_registry_version": SOURCE_REGISTRY_VERSION,
        "ai_signature_variants": count_ai_signature_variants(valid_texts),
        "retrieval_status": RETRIEVAL_STATUS,
    }


QUEUE_FILTERS = ("unknown_knowhow", "provisional_knowhow", "provisional_all", "all_candidates", "revalidation_required")


def build_verification_queue(
    items: list[dict],
    *,
    queue_filter: str = "all_candidates",
    content_validation: str | None = None,
    product_group_filter: str | None = None,
    topic: str | None = None,
) -> list[dict]:
    out: list[dict] = []
    for item in items:
        if item["tier"] not in HUMAN_REFERENCE_TIERS:
            continue
        if queue_filter == "unknown_knowhow" and item["tier"] != TIER_MANUAL_VERIFICATION_CANDIDATE:
            continue
        if queue_filter == "provisional_knowhow" and not (
            item["tier"] == TIER_PROVISIONAL_HUMAN_REFERENCE and item["has_knowhow"]
        ):
            continue
        if queue_filter == "provisional_all" and item["tier"] != TIER_PROVISIONAL_HUMAN_REFERENCE:
            continue
        if queue_filter == "all_candidates" and not item["has_knowhow"]:
            continue
        if queue_filter == "revalidation_required" and not item.get("revalidation_required"):
            continue
        if content_validation and item["content_validation"] != content_validation:
            continue
        if product_group_filter and item["product_group"] != product_group_filter:
            continue
        if topic and topic not in item["reply_topics"] and topic not in item["review_topics"]:
            continue
        out.append(item)
    out.sort(key=lambda x: (-(x["queue_priority"] or 0), str(x.get("remote_reply_date") or ""), x["knowledge_id"]))
    return out


def analyze_query(review_text: object, product_title: object = "", rating: object = None) -> dict:
    body = _collapse(review_text)
    return {
        "product_group": product_group(product_title),
        "product_title": _collapse(product_title) or None,
        "topics": detect_topics(body),
        "signals": review_signals(body),
        "rating_band": _rating_band(rating),
        "terms": sorted(_content_terms(body)),
    }


def retrieve(
    items: list[dict],
    *,
    review_text: str,
    product_title: str = "",
    rating: object = None,
    top_k: int = 5,
    include_ai_reference: bool = False,
    exclude_review_keys: set[str] | None = None,
) -> dict:
    query = analyze_query(review_text, product_title, rating)
    query_topics = set(query["topics"])
    query_terms = set(query["terms"])
    excluded = set(exclude_review_keys or set())
    scored: list[dict] = []
    for item in items:
        if item["review_key"] in excluded:
            continue
        if item["tier"] == TIER_EXCLUDED_INVALID or item["tier"] == TIER_UNKNOWN_NO_KNOWHOW:
            continue
        if item["tier"] == TIER_AI_ORIGIN_REFERENCE and not include_ai_reference:
            continue
        if item["content_validation"] in (CONTENT_EXCLUDED, CONTENT_OUTDATED):
            continue
        reasons: list[str] = []
        score = 0.0
        cand_topics = set(item["review_topics"]) | set(item["reply_topics"])
        overlap = sorted(query_topics & cand_topics)
        product_specific_overlap = [t for t in overlap if t not in PRODUCT_AGNOSTIC_TOPICS]
        same_group = query["product_group"] != "UNMAPPED" and item["product_group"] == query["product_group"]
        if same_group:
            score += 3.0
            reasons.append(f"PRODUCT_GROUP_MATCH:{item['product_group']}")
            if query["product_title"] and item.get("product_title") == query["product_title"]:
                score += 0.5
                reasons.append("SAME_PRODUCT")
        elif query["product_group"] != "UNMAPPED" and product_specific_overlap:
            score -= 2.0
            reasons.append(f"PRODUCT_GROUP_MISMATCH:{item['product_group']}")
        for topic_name in overlap[:3]:
            score += 2.0
            reasons.append(f"TOPIC_MATCH:{topic_name}")
        cand_signals = item["review_signals"]
        signal_match = False
        if query["signals"]["question"] and cand_signals["question"]:
            score += 1.0
            signal_match = True
            reasons.append("BOTH_ASK_QUESTION")
        if query["signals"]["negative"] and cand_signals["negative"]:
            score += 1.5
            signal_match = True
            reasons.append("BOTH_REPORT_INCONVENIENCE")
        if (
            query["signals"]["positive"]
            and not query["signals"]["negative"]
            and cand_signals["positive"]
            and not cand_signals["negative"]
        ):
            score += 0.5
            signal_match = True
            reasons.append("BOTH_POSITIVE_EXPERIENCE")
        if query["rating_band"] != "unknown" and _rating_band(item.get("rating")) == query["rating_band"]:
            score += 0.5
            reasons.append(f"RATING_BAND:{query['rating_band']}")
        guidance_topics = sorted(
            {t for k in item["knowhow_items"] if k.get("isKnowledgeCandidate", True) for t in k["topics"]} & query_topics
        )
        if guidance_topics:
            score += 2.0
            reasons.append("REPLY_GUIDANCE_ON:" + ",".join(guidance_topics))
        cand_terms = _content_terms(item["review_text"])
        if query_terms and cand_terms:
            jaccard = len(query_terms & cand_terms) / len(query_terms | cand_terms)
            if jaccard > 0:
                score += min(1.0, jaccard * 2)
                reasons.append(f"KEYWORD_OVERLAP:{jaccard:.2f}")
        if item.get("approved_retrieval_boost"):
            score += 1.5
            reasons.append(AUTH_APPROVED_HISTORICAL_REFERENCE)
        elif item.get("revalidation_required"):
            reasons.append("REVALIDATION_REQUIRED_NO_APPROVAL_BOOST")
        elif item["content_validation"] == CONTENT_HOLD:
            score -= 0.5
        if item["tier"] == TIER_PRIMARY_VERIFIED_HUMAN:
            score += 1.0
        if item["template_like"]:
            score -= 1.0
            reasons.append("TEMPLATE_LIKE_PENALTY")
        if RULE_AI_SIGNATURE_PHRASE in item["policy_violations"] or RULE_PURCHASE_PRESSURE_CLOSING in item["policy_violations"]:
            score -= 1.5
            reasons.append("POLICY_VIOLATION_PENALTY")
        # Word overlap alone never qualifies a reference.
        relevant = bool(overlap) or (same_group and signal_match)
        if not relevant or score < 3.0:
            continue
        scored.append({"score": round(score, 3), "reasons": reasons, "item": item})
    scored.sort(key=lambda x: (-x["score"], x["item"]["knowledge_id"]))
    results = []
    for one in scored[: max(1, int(top_k or 5))]:
        item = one["item"]
        results.append(
            {
                "knowledge_id": item["knowledge_id"],
                "score": one["score"],
                "retrieval_reasons": one["reasons"],
                "past_review_text": item["review_text"],
                "past_reply_text": item["reply_text"],
                "authorship": item["authorship"],
                "authorship_evidence": item["authorship_evidence"],
                "tier": item["tier"],
                "product_title": item.get("product_title"),
                "product_group": item["product_group"],
                "topics": sorted(set(item["review_topics"]) | set(item["reply_topics"])),
                "rating": item.get("rating"),
                "remote_reply_date": item.get("remote_reply_date"),
                "knowhow_items": [k for k in item["knowhow_items"] if k.get("isKnowledgeCandidate", True)],
                "guidance_current_validity": sorted(
                    {k["current_validity"] for k in item["knowhow_items"] if k.get("isKnowledgeCandidate", True)}
                ) or ["NO_GUIDANCE"],
                "content_validation": item["content_validation"],
                "revalidation_required": bool(item.get("revalidation_required")),
                "current_use_authority": item["current_use_authority"],
                "reply_reference_eligible": item["reply_reference_eligible"],
                "generator_fact_eligible": item["generator_fact_eligible"],
                "approved_retrieval_boost": item["approved_retrieval_boost"],
                "fact_ineligible_reasons": item["fact_ineligible_reasons"],
                "unit_fact_counts": item.get("unit_fact_counts"),
                "extraction_version": item.get("extraction_version"),
                "use_warning": USE_WARNINGS.get(item["current_use_authority"]),
                "policy_violations": item["policy_violations"],
            }
        )
    return {
        "retrieval_status": RETRIEVAL_STATUS,
        "use_contract": RETRIEVAL_USE_CONTRACT,
        "query_analysis": query,
        "results": results,
    }


RETRIEVAL_USE_CONTRACT = (
    "Results are past-reply references. Only generator_fact_eligible=true may be used as a confirmed product fact; "
    "reply_reference_eligible=true allows tone/context reference only; everything else is context, not fact."
)
USE_WARNINGS = {
    AUTH_REVALIDATION_REQUIRED: "재검증 필요: 승인 당시 추출과 의미가 달라져 승인 가산점과 사실 사용이 차단됩니다.",
    AUTH_APPROVED_HISTORICAL_REFERENCE: "승인된 과거 응대: 응대 방식·맥락 참고용이며 개별 제품 사실은 미검증입니다.",
    AUTH_EXTRACTED_KNOWLEDGE: "미검증 추출: 사람 검증 전이므로 사실로 사용하지 않습니다.",
    AUTH_VALIDATION_STALE_REPLY_CHANGED: "답글 원문이 검증 당시와 달라 기존 검증을 적용하지 않습니다.",
    AUTH_VALIDATION_HOLD: "보류: 참고 가산점과 사실 사용이 차단됩니다.",
    AUTH_AI_ORIGIN_REFERENCE: "AI 출처 답글: 사람 지식으로 사용하지 않습니다.",
}


PROVENANCE_FIELDS = (
    "past_review_text",
    "past_reply_text",
    "authorship",
    "product_group",
    "topics",
    "retrieval_reasons",
    "guidance_current_validity",
    "content_validation",
    "current_use_authority",
)


def provenance_complete(result: dict) -> bool:
    for field in PROVENANCE_FIELDS:
        value = result.get(field)
        if value is None or value == "" or value == []:
            if field == "topics":
                continue
            return False
    return True
