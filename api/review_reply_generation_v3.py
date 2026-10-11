"""Review reply generation v3 and the server-side auto-post gate.

- Prompt: official usage guide (product facts) + up to 3 similar past review/reply pairs
  written by people (style and response structure only, never product facts).
- Post-generation QA: existing check_reply_policy + sentiment misread, glyph, efficacy and
  compensation checks.
- Auto-post gate: 4~5 stars, non-sensitive, recent review, recent approved v3 draft, QA PASS.
  The seller-center reply check happens at submit time (see interpret_seller_center_probe).

Pure functions only: no DB access and no network calls. Callers persist results.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from review_reply_knowledge import AUTHORSHIP_HUMAN_CONFIRMED, AUTHORSHIP_LIKELY_HUMAN, retrieve
from review_reply_policy_qa import (
    RULE_AI_SIGNATURE_PHRASE,
    RULE_PURCHASE_PRESSURE_CLOSING,
    check_reply_policy,
)

PROMPT_VERSION = "review_reply_v3"
GUIDE_PATH = Path(__file__).resolve().parent / "review_reply_knowledge_sources" / "official_usage_guide_v2.json"

MAX_HUMAN_EXAMPLES = 3
RETRIEVE_TOP_K = 40
EXAMPLE_AUTHORSHIP_ORDER = (AUTHORSHIP_HUMAN_CONFIRMED, AUTHORSHIP_LIKELY_HUMAN)
EXAMPLE_EXCLUDED_POLICY_RULES = {RULE_AI_SIGNATURE_PHRASE, RULE_PURCHASE_PRESSURE_CLOSING}

AUTO_POST_MIN_RATING = 4.0
AUTO_POST_MAX_REVIEW_AGE_DAYS = 30
AUTO_POST_MAX_DRAFT_AGE_DAYS = 7
DAILY_DRAFT_LOOKBACK_DAYS = 3

ROUTE_AUTO_POST_CANDIDATE = "AUTO_POST_CANDIDATE"
ROUTE_ADMIN_REVIEW = "ADMIN_REVIEW"
ROUTE_ADMIN_DIRECT = "ADMIN_DIRECT"

SELLER_CENTER_REPLIED = "replied"
SELLER_CENTER_NOT_REPLIED = "not_replied"
SELLER_CENTER_UNKNOWN = "unknown"

AUTO_POST_BLOCKER_LABELS: dict[str, str] = {
    "rating_requires_admin_review": "3점 리뷰는 관리자 검토 후 개별 게시 대상입니다.",
    "rating_requires_admin_direct": "1~2점 또는 평점 미상 리뷰는 관리자가 직접 처리합니다.",
    "sensitive_review": "피부 이상·알레르기·환불·분쟁·심각한 불만 리뷰는 자동 게시에서 제외합니다.",
    "review_older_than_30d": "최근 30일 이내 리뷰만 자동 게시 대상입니다.",
    "draft_not_v3": "v3 경로로 생성한 초안만 자동 게시 대상입니다(기존 초안 제외).",
    "draft_older_than_7d": "최근 7일 이내에 생성한 초안만 자동 게시 대상입니다.",
    "draft_not_approved": "승인된 초안만 게시할 수 있습니다.",
    "draft_already_published": "이미 게시 기록이 있는 초안입니다.",
    "quality_check_failed": "답글 품질 검사를 통과하지 못했습니다.",
    "review_already_replied": "판매자센터에 이미 답글이 있습니다.",
    "seller_center_reply_check_failed": "판매자센터 답글 존재 여부를 확인하지 못해 게시하지 않았습니다.",
}

GUIDE_PRODUCT_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("헤나", ("레드 헤나", "브라운 헤나")),
    ("헤어팩", ("헤어팩",)),
    ("허브팩", ("헤어팩",)),
    ("호호바", ("호호바 오일",)),
    ("샴푸", ("맥주효모 샴푸",)),
)

SYSTEM_PROMPT = (
    "너는 수자타 스마트스토어의 리뷰 답글 담당자다. 실제 사람 담당자가 쓰듯 자연스럽고 정중한 한국어로 답글 본문만 작성한다.\n"
    "작성 원칙:\n"
    "1) 먼저 고객의 감정(만족·불만·중립)과 핵심 내용을 정확히 파악한다. 불만이나 아쉬움(예: 색이 너무 진하다, 너무 오렌지색이다, 효과를 모르겠다)을 만족이나 칭찬으로 바꿔 읽지 않는다.\n"
    "2) 리뷰에 실제로 적힌 경험·고민·질문에만 답한다. 리뷰에 없는 경험이나 사실을 지어내지 않는다.\n"
    "3) 질문이나 사용법 문제가 있을 때만 [공식 사용가이드]로 정확히 안내한다. 가이드의 제품·조건·시간·비율을 바꾸지 않고, 가이드에 없는 사용법·수치·효능은 쓰지 않는다. 다른 제품의 사용법을 섞지 않는다.\n"
    "4) [과거 답글 사례]는 인사·공감·설명 순서와 말투만 참고한다. 사례 속 제품 설명·효능·수치는 확인된 사실이 아니므로 사용하지 않고, 문장을 그대로 복사하지 않는다.\n"
    "5) 고객이 재구매를 말하지 않았다면 재구매·다음 구매를 권하지 않는다. '재구매 언제든 환영' 같은 상투 문구를 쓰지 않는다.\n"
    "6) '궁금한 점이 있으면 언제든 문의' 같은 안내는 고객이 질문했거나 문제가 해결되지 않았을 때만 한 번 쓴다. 만족 후기에는 쓰지 않는다.\n"
    "7) 피부 이상·가려움·따가움·알레르기·부작용은 사용 중단과 피부 상태 확인(필요하면 전문의 상담)을 먼저 안내하고 원인을 단정하지 않는다. 테스트를 하지 않았다거나 사용법이 틀렸다는 식으로 고객 탓을 하지 않고, 보상·환불·교환 약속을 하지 않는다.\n"
    "8) 탈모 개선 같은 의학적 효능을 단정하지 않는다.\n"
    "9) 첫인사와 끝인사를 포함해 전체 3~5문장으로 쓴다. 구성은 인사와 감사 1문장, 리뷰 내용에 대한 공감·답변 1~2문장, 필요할 때만 안내 1문장, 끝인사 1문장이다. "
    "끝인사에 '감사합니다'와 '좋은 하루 되세요'를 함께 쓰지 않는다. 과장된 감탄이나 같은 표현의 반복을 피한다."
)


class GenerationV3Error(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def _collapse(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


# ---------------------------------------------------------------- official guide

_GUIDE_CACHE: dict[str, object] = {"key": None, "units": None}


def load_guide_units(path: Path = GUIDE_PATH) -> list[dict]:
    try:
        stat = path.stat()
    except FileNotFoundError as exc:
        raise GenerationV3Error("guide_source_missing", path.name) from exc
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if _GUIDE_CACHE["key"] == key and _GUIDE_CACHE["units"] is not None:
        return list(_GUIDE_CACHE["units"])  # type: ignore[arg-type]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise GenerationV3Error("guide_source_invalid", "json_parse_failed") from exc
    sources = data.get("sources") if isinstance(data, dict) else None
    if not isinstance(sources, list) or not sources:
        raise GenerationV3Error("guide_source_invalid", "sources_missing")
    units: list[dict] = []
    for source in sources:
        for unit in (source or {}).get("units") or []:
            text = _collapse((unit or {}).get("originalText"))
            products = [str(p) for p in ((unit or {}).get("products") or []) if str(p or "").strip()]
            if not text or not products:
                continue
            units.append(
                {
                    "unit_key": str(unit.get("unitKey") or ""),
                    "fact_type": str(unit.get("factType") or ""),
                    "products": products,
                    "text": text,
                    "official": str(unit.get("sourceFidelityStatus") or "") == "PASS",
                    "source_id": str((source or {}).get("sourceId") or ""),
                }
            )
    if not units:
        raise GenerationV3Error("guide_source_invalid", "no_usable_units")
    _GUIDE_CACHE["key"] = key
    _GUIDE_CACHE["units"] = units
    return list(units)


def guide_products_for(product_title: object, option_text: object = "") -> list[str]:
    text = f"{_collapse(product_title)} {_collapse(option_text)}"
    out: list[str] = []
    for keyword, products in GUIDE_PRODUCT_KEYWORDS:
        if keyword in text:
            for product in products:
                if product not in out:
                    out.append(product)
    return out


MAX_GUIDE_UNITS = 8

# (topic, review cue, fact types, unit text cue). A unit is relevant when the review raises the topic and the
# unit either has one of the fact types or mentions the topic in its own text.
GUIDE_TOPICS: tuple[tuple[str, re.Pattern, frozenset, re.Pattern | None], ...] = (
    ("gray", re.compile(r"새치|흰\s*머리|커버"), frozenset({"SEQUENTIAL_APPLICATION", "CONDITIONAL_DURATION_ADJUSTMENT"}), re.compile(r"흰머리|새치")),
    ("color", re.compile(r"색상|색깔|색이|컬러|오렌지|주황|붉|빨갛|빨간|브라운|갈색|레드|검정|검게|까맣|진하|연하|톤"),
     frozenset({"RATIO", "SEQUENTIAL_APPLICATION", "MIXED_APPLICATION", "PRODUCT_DESCRIPTION", "RESTRICTION"}), re.compile(r"현재\s*색|컬러")),
    ("time", re.compile(r"시간|방치|오래\s*(?:두|둬|놔)|몇\s*분"), frozenset({"STANDARD_DURATION", "CONDITIONAL_DURATION_ADJUSTMENT"}), None),
    ("amount", re.compile(r"몇\s*(?:개|봉|포|팩)|양이|양을|부족|모자라|길이"), frozenset({"USAGE_AMOUNT"}), None),
    ("procedure", re.compile(r"반죽|바르|발라|도포|섞|물\s*(?:을|양)|마요|캡|랩|어떻게|방법|사용법|순서"),
     frozenset({"PROCEDURE_ORDER", "PROCEDURE_STEP", "APPLICATION_TIP", "MIXING_RULE"}), None),
    ("rinse", re.compile(r"샴푸|헹|물\s*빠|(?<!나)빠져|(?<!나)빠지|씻"), frozenset({"RINSE"}), re.compile(r"샴푸|헹")),
    ("bleach", re.compile(r"탈색|염색모|하이라이트|브릿지"), frozenset(), re.compile(r"탈색|하이라이트")),
    ("skin", re.compile(r"두피|피부|민감|가려|따가|자극|알러지|알레르기|트러블|패치"), frozenset(), re.compile(r"민감|불편감|중단")),
    ("first", re.compile(r"처음|첫\s*(?:사용|구매)|입문"), frozenset(), re.compile(r"처음|패치")),
)


_GUIDE_NEED_RE = re.compile(
    r"안\s*(?:되|돼|됩|됐|됨|나|납|났|들|먹)|않|못|덜|(?<!나)빠져|(?<!나)빠지|부족|모자라|어렵|어려|헷갈|걱정|아쉽|아쉬|별로|실망"
    r"|생각보다|다르|이상|부작용|강해|강하|진해|ㅜ|ㅠ"
)


def guide_topics_for(review_text: object) -> list[str]:
    """Usage guidance only when the review raises a problem, a worry or a question."""
    text = _collapse(review_text)
    sensitive_skin = "skin_or_allergy" in detect_sensitive(text)
    if not (sensitive_skin or _GUIDE_NEED_RE.search(text) or _QUESTION_RE.search(text) or _COMPLAINT_RE.search(text)):
        return []
    topics = []
    for name, cue, _types, _unit_cue in GUIDE_TOPICS:
        if name == "skin":
            if sensitive_skin:
                topics.append(name)
        elif name == "first" and sensitive_skin:
            continue
        elif cue.search(text):
            topics.append(name)
    return topics


def select_guide(units: list[dict], *, product_title: object, option_text: object = "", review_text: object = "") -> dict:
    products = guide_products_for(product_title, option_text)
    wanted = set(products)
    topics = guide_topics_for(review_text)
    topic_defs = [t for t in GUIDE_TOPICS if t[0] in topics]
    scored: list[tuple[int, int, dict]] = []
    for order, unit in enumerate(units):
        if not (wanted & set(unit["products"])):
            continue
        score = sum(
            1 for _name, _cue, types, unit_cue in topic_defs
            if unit["fact_type"] in types or (unit_cue is not None and unit_cue.search(unit["text"]))
        )
        if score:
            scored.append((score, order, unit))
    scored.sort(key=lambda x: (-x[0], x[1]))
    relevant = [unit for _score, _order, unit in scored]
    facts = [u for u in relevant if u["official"]][:MAX_GUIDE_UNITS]
    rules = [u for u in relevant if not u["official"]][:2]
    return {"products": products, "topics": topics, "facts": facts, "rules": rules}


# ---------------------------------------------------------------- human examples


def select_human_examples(
    items: list[dict],
    *,
    review_key: str,
    review_text: str,
    product_title: str,
    rating: object,
    k: int = MAX_HUMAN_EXAMPLES,
) -> tuple[list[dict], dict]:
    res = retrieve(
        items,
        review_text=review_text or "",
        product_title=product_title or "",
        rating=rating,
        top_k=RETRIEVE_TOP_K,
        include_ai_reference=False,
        exclude_review_keys={review_key} if review_key else None,
    )
    by_authorship: dict[str, list[dict]] = {a: [] for a in EXAMPLE_AUTHORSHIP_ORDER}
    skipped: Counter[str] = Counter()
    for one in res.get("results") or []:
        authorship = str(one.get("authorship") or "")
        if authorship not in by_authorship:
            skipped[authorship or "NONE"] += 1
            continue
        if EXAMPLE_EXCLUDED_POLICY_RULES & set(one.get("policy_violations") or []):
            skipped["POLICY_VIOLATION"] += 1
            continue
        if not _collapse(one.get("past_review_text")) or not _collapse(one.get("past_reply_text")):
            skipped["EMPTY_TEXT"] += 1
            continue
        by_authorship[authorship].append(one)
    picked = [one for a in EXAMPLE_AUTHORSHIP_ORDER for one in by_authorship[a]][: max(0, int(k))]
    meta = {
        "retrieved": len(res.get("results") or []),
        "human_confirmed_available": len(by_authorship[AUTHORSHIP_HUMAN_CONFIRMED]),
        "likely_human_available": len(by_authorship[AUTHORSHIP_LIKELY_HUMAN]),
        "picked": len(picked),
        "picked_authorship": [str(one.get("authorship")) for one in picked],
        "picked_knowledge_ids": [one.get("knowledge_id") for one in picked],
        "skipped": dict(skipped),
        "product_group": (res.get("query_analysis") or {}).get("product_group"),
    }
    return picked, meta


# ---------------------------------------------------------------- prompt


_TONE_CONTROL_LABELS = {
    "greeting_density": "인사",
    "gratitude_intensity": "감사",
    "empathy_intensity": "공감",
    "detail_depth": "설명",
    "closing_strength": "마무리",
}


def render_tone_preset(preset: dict | None) -> str:
    """Admin-selected tone strength only; v2 style corpus phrases and type guides are not carried over."""
    preset0 = dict(preset or {})
    if not preset0:
        return ""
    lines = [f"- 스타일 강도: {int(preset0.get('level') or 3)}단계 ({_collapse(preset0.get('name')) or '균형형'})"]
    controls = {k: v for k, v in dict(preset0.get("controls") or {}).items() if k in _TONE_CONTROL_LABELS}
    if controls:
        lines.append(
            "- 세부 톤 강도: "
            + ", ".join(f"{_TONE_CONTROL_LABELS[k]} {int(v)}/5" for k, v in controls.items())
        )
    if int(controls.get("gratitude_intensity") or 0) >= 4 or int(controls.get("empathy_intensity") or 0) >= 4:
        lines.append("- 감사/공감 표현을 더 풍부하게 넣되 과장하지 않는다.")
    detail = int(controls.get("detail_depth") or 0)
    if detail and detail <= 2:
        lines.append("- 장황한 설명은 줄이고 핵심만 짧게 답한다.")
    if int(controls.get("closing_strength") or 0) >= 4:
        lines.append("- 마무리 인사는 한 문장으로 하되, 요청하지 않은 재구매 권유는 넣지 않는다.")
    return "\n".join(lines)


def build_messages(
    *,
    product_title: str | None,
    rating: object,
    option_text: str | None,
    review_text: str,
    guide: dict,
    examples: list[dict],
    feedback_rules: list[str] | None = None,
    rejection_comment: str | None = None,
    rejection_summary: str | None = None,
    rewrite_guidance: list[str] | None = None,
    tone_preset: dict | None = None,
) -> list[dict]:
    try:
        rating0 = f"{float(rating):.1f}" if rating is not None else "-"
    except (TypeError, ValueError):
        rating0 = "-"
    tone_text = render_tone_preset(tone_preset)
    tone_text = f"\n\n[말투 강도] (작성 원칙이 우선)\n{tone_text}" if tone_text else ""
    guide_lines = [f"- {u['text']}" for u in guide.get("facts") or []]
    guide_lines += [f"- (운영 원칙) {u['text']}" for u in guide.get("rules") or []]
    if guide_lines:
        guide_text = "\n".join(guide_lines)
    elif guide.get("products"):
        guide_text = "- 이 리뷰에는 사용법 안내가 필요하지 않습니다. 사용법·시간·비율·효능 안내를 하지 마세요."
    else:
        guide_text = "- 이 상품에 해당하는 공식 가이드 항목이 없습니다. 사용법·시간·비율·효능 안내를 하지 마세요."
    example_blocks = []
    for i, ex in enumerate(examples, 1):
        label = "사람 작성 확인" if ex.get("authorship") == AUTHORSHIP_HUMAN_CONFIRMED else "사람 작성 추정, 말투·응대 참고용"
        example_blocks.append(
            f"[사례 {i}] ({label})\n고객 리뷰: {_collapse(ex.get('past_review_text'))}\n담당자 답글: {_collapse(ex.get('past_reply_text'))}"
        )
    example_text = "\n\n".join(example_blocks) if example_blocks else "(비슷한 사람 답글 사례 없음)"
    feedback = [str(x or "").strip() for x in (feedback_rules or []) if str(x or "").strip()]
    feedback_text = (
        "\n\n[운영자 피드백 규칙] (공식 가이드와 작성 원칙이 우선)\n" + "\n".join(feedback) if feedback else ""
    )
    rejection_lines = []
    if _collapse(rejection_comment):
        rejection_lines.append(f"- 관리자 반려 사유: {_collapse(rejection_comment)}")
    if _collapse(rejection_summary):
        rejection_lines.append(f"- 핵심 문제: {_collapse(rejection_summary)}")
    guidance = [str(x or "").strip() for x in (rewrite_guidance or []) if str(x or "").strip()]
    if guidance:
        rejection_lines.append(f"- 재작성 지침: {' / '.join(guidance[:3])}")
    rejection_text = "\n\n[직전 반려 피드백]\n" + "\n".join(rejection_lines) if rejection_lines else ""
    safety_text = (
        "\n\n[피부 이상 리뷰]\n- 공감 다음 문장에서 바로 사용 중단과 피부 상태 확인(증상이 계속되면 전문의 상담)을 안내하세요."
        "\n- 테스트 여부나 사용 방법을 지적하지 말고, 원인을 단정하지 마세요."
        if "skin_or_allergy" in detect_sensitive(review_text)
        else ""
    )
    user = (
        "아래 리뷰에 대한 판매자 답글을 작성해줘.\n"
        f"- 상품명: {_collapse(product_title) or '상품명 미상'}\n"
        f"- 평점: {rating0}\n"
        f"- 옵션: {_collapse(option_text) or '-'}\n"
        f"- 리뷰 본문: {_collapse(review_text)}\n\n"
        f"[공식 사용가이드]\n{guide_text}\n\n"
        f"[과거 답글 사례]\n{example_text}"
        f"{safety_text}{tone_text}{feedback_text}{rejection_text}\n\n"
        "출력은 답글 본문만 작성해줘."
    )
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]


# ---------------------------------------------------------------- sensitive reviews

_SKIN_RE = re.compile(
    r"가려|가렵|따가|따갑|따끔|화끈|쓰라|쓰리|붉어|빨개|발진|두드러기|뾰루지|트러블|진물|부어|부었|붓기|염증"
    r"|알러지|알레르기|알르레기|자극|화상|부작용|피부\s*(?:가|이)?\s*(?:뒤집|올라|일어)|두피\s*(?:가|에)?\s*(?:아프|아파|통증|상처)"
)
_DISPUTE_RE = re.compile(r"환불|반품|교환|신고|소비자\s*원|고발|고소|사기|보상|배상|클레임")
_SEVERE_RE = re.compile(
    r"최악|불량|하자|이물|곰팡|벌레|썩|다시는\s*안|절대\s*(?:안|사지)|속았|거짓말|어이없|화가\s*나|짜증|실망\s*(?:스럽|이에|했)"
)
_NEG_SUFFIX = r"(?:움증|움|거림|감|적|반응|증상|증|같은\s*(?:거|건|것))?\s*(?:이지|이|가|은|는|도|지|지도|지는|지가)?"
_NEG_AFTER_RE = re.compile(
    r"^" + _NEG_SUFFIX + r"\s*(?:전혀|하나도|하나|1도|일도|거의|별로|아예|딱히|훨씬|많이|좀|조금)?\s*"
    r"(?:없|않|덜|적(?:어|고|은|게|다|었|네|음|더)|안\s*(?:나|생|느껴|일어|올라|되|돼))"
)
_NEG_BEFORE_RE = re.compile(r"(?:(?:^|\s)(?:전혀\s*|하나도\s*)?안\s*|저\s*)$")


def _skin_mention_negated(text: str, match: re.Match) -> bool:
    if _NEG_AFTER_RE.search(text[match.end() : match.end() + 16]):
        return True
    return bool(_NEG_BEFORE_RE.search(text[max(0, match.start() - 8) : match.start()]))


def detect_sensitive(review_text: object) -> list[str]:
    text = _collapse(review_text)
    found: list[str] = []
    if any(not _skin_mention_negated(text, m) for m in _SKIN_RE.finditer(text)):
        found.append("skin_or_allergy")
    if _DISPUTE_RE.search(text):
        found.append("refund_or_dispute")
    if _SEVERE_RE.search(text):
        found.append("severe_complaint")
    return found


# ---------------------------------------------------------------- post-generation QA

_COMPLAINT_RE = re.compile(
    r"너무\s*(?:진|어둡|검|까맣|빨갛|붉|오렌지|주황|밝|노랗|연하)|색(?:이|깔이|상이)?\s*(?:이상|안\s*나|별로|다르)"
    r"|별로|실망|아쉽|아쉬|불만|안\s*(?:돼|되|됩|됐|됨)|효과(?:가|를|는)?\s*(?:없|못|모르)|모르겠|못\s*느끼|최악|후회"
    r"|(?:오렌지|주황|붉은|빨간|레드)\s*(?:빛|색|기)?\s*(?:이|가)?\s*(?:강|너무)"
)
_SAFETY_GUIDANCE_RE = re.compile(r"중단|멈추|멈춰|전문의|피부과|병원|진료|상담")
_ASSUMED_SATISFACTION_RE = re.compile(
    r"마음에\s*(?:드셨|드신|드셔|들어\s*하|드시)|만족(?:하셨|스러우셨|해\s*주셔|하신다니|하셨다니)|좋아해\s*주셔|좋으셨다니|흡족"
)
_ACKNOWLEDGE_RE = re.compile(
    r"아쉬|불편|죄송|속상|안타깝|진하게\s*느끼|원하시던|기대와\s*다르|기대에\s*미치지|만족스럽지\s*못|마음에\s*(?:들지|드시지)\s*않"
)
_SAFETY_BLAME_RE = re.compile(
    r"(?:다음\s*(?:번|에)|앞으로(?:는)?)[^.!?]{0,30}테스트|테스트[^.!?]{0,15}(?:없이|안\s*하|하지\s*않|하셨어야|하셨더라면|후\s*사용)"
    r"|사용\s*방법[^.!?]{0,10}(?:잘못|틀리)"
)
_NON_KOREAN_GLYPH_RE = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]")
_EFFICACY_RE = re.compile(
    r"탈모\s*(?:가|를)?\s*(?:개선|치료|예방|완화)|발모|치료\s*효과|완치|효과\s*(?:를|가)?\s*보장|100\s*%\s*(?:효과|만족)|부작용\s*(?:이|은)?\s*(?:전혀\s*)?없"
)
_COMPENSATION_RE = re.compile(
    r"(?:환불|교환|보상|재발송)\s*(?:을|를)?\s*(?:해\s*)?드리|(?:환불|교환|보상)\s*처리\s*(?:해\s*)?드리|무상\s*(?:교환|지급)"
)
_CS_CLOSING_RE = re.compile(r"궁금(?:한|하신)\s*(?:점|사항)|문의\s*(?:주|해\s*주|하여\s*주|를\s*남겨)")
_QUESTION_RE = re.compile(r"\?|궁금|어떻게|되나요|될까요|할까요|하나요|인가요|맞나요|문의|알려\s*주")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?~^])\s+")
_GREETING_ONLY_RE = re.compile(r"^안녕하세요[,\s]*(?:고객님)?\s*[!.~]?$")
MAX_SENTENCES = 5


def check_reply_quality(reply_text: object, review_text: object, rating: object = None) -> dict:
    reply = _collapse(reply_text)
    review = _collapse(review_text)
    blocking: list[str] = []
    warnings: list[str] = []
    if not reply:
        blocking.append("EMPTY_REPLY")
    policy = check_reply_policy(reply, review)
    for violation in policy.get("violations") or []:
        blocking.append(f"POLICY_{violation.get('rule')}")
    if _COMPLAINT_RE.search(review) and _ASSUMED_SATISFACTION_RE.search(reply) and not _ACKNOWLEDGE_RE.search(reply):
        blocking.append("SENTIMENT_MISREAD")
    if _NON_KOREAN_GLYPH_RE.search(reply):
        blocking.append("NON_KOREAN_GLYPH")
    if _EFFICACY_RE.search(reply):
        blocking.append("UNVERIFIED_EFFICACY")
    if _COMPENSATION_RE.search(reply):
        blocking.append("COMPENSATION_PROMISE")
    if "skin_or_allergy" in detect_sensitive(review):
        if _SAFETY_BLAME_RE.search(reply):
            blocking.append("SAFETY_BLAME")
        if reply and not _SAFETY_GUIDANCE_RE.search(reply):
            blocking.append("SAFETY_GUIDANCE_MISSING")
    if _CS_CLOSING_RE.search(reply) and not _QUESTION_RE.search(review) and not _COMPLAINT_RE.search(review):
        warnings.append("UNNEEDED_CS_CLOSING")
    sentences = [s for s in _SENTENCE_SPLIT_RE.split(reply) if s.strip() and not _GREETING_ONLY_RE.match(s.strip())]
    if len(sentences) > MAX_SENTENCES:
        warnings.append("TOO_LONG")
    return {"ok": not blocking, "blocking": blocking, "warnings": warnings, "policy": policy}


def summarize_generation_qa(quality: dict, *, guide: dict, example_meta: dict) -> str:
    warnings = list(quality.get("warnings") or [])
    if not int(example_meta.get("picked") or 0):
        warnings.append("NO_HUMAN_EXAMPLE")
    if not guide.get("products"):
        warnings.append("NO_GUIDE_PRODUCT")
    elif guide.get("topics") and not guide.get("facts"):
        warnings.append("NO_GUIDE_UNIT")
    parts = [
        f"{PROMPT_VERSION}_qa={'PASS' if quality.get('ok') else 'HOLD'}",
        "blocking=" + (",".join(quality.get("blocking") or []) or "-"),
        "warnings=" + (",".join(warnings) or "-"),
        f"guide_units={len(guide.get('facts') or [])}",
        "guide_topics=" + (",".join(guide.get("topics") or []) or "-"),
        "examples=" + (",".join(example_meta.get("picked_authorship") or []) or "0"),
    ]
    return "; ".join(parts)


# ---------------------------------------------------------------- auto-post gate


def _as_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def _as_utc_naive(value: object) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    return None


def evaluate_auto_post(
    *,
    rating: object,
    review_text: object,
    review_written_at: object,
    draft_status: object,
    prompt_version: object,
    draft_generated_at: object,
    draft_text: object,
    draft_published_at: object = None,
    reply_exists: bool = False,
    today: date,
    now_utc: datetime,
) -> dict:
    reasons: list[str] = []
    try:
        rating0 = float(rating) if rating is not None else None
    except (TypeError, ValueError):
        rating0 = None
    route = ROUTE_AUTO_POST_CANDIDATE
    if rating0 is None or rating0 < 3:
        route = ROUTE_ADMIN_DIRECT
        reasons.append("rating_requires_admin_direct")
    elif rating0 < AUTO_POST_MIN_RATING:
        route = ROUTE_ADMIN_REVIEW
        reasons.append("rating_requires_admin_review")
    sensitive = detect_sensitive(review_text)
    if sensitive:
        route = ROUTE_ADMIN_DIRECT
        reasons.append("sensitive_review")
    if reply_exists:
        reasons.append("review_already_replied")
    written = _as_date(review_written_at)
    if written is None or (today - written).days > AUTO_POST_MAX_REVIEW_AGE_DAYS:
        reasons.append("review_older_than_30d")
    if str(prompt_version or "") != PROMPT_VERSION:
        reasons.append("draft_not_v3")
    generated = _as_utc_naive(draft_generated_at)
    if generated is None or now_utc - generated > timedelta(days=AUTO_POST_MAX_DRAFT_AGE_DAYS):
        reasons.append("draft_older_than_7d")
    if str(draft_status or "") != "approved":
        reasons.append("draft_not_approved")
    if draft_published_at:
        reasons.append("draft_already_published")
    quality = check_reply_quality(draft_text, review_text, rating0)
    if not quality["ok"]:
        reasons.append("quality_check_failed")
        if route == ROUTE_AUTO_POST_CANDIDATE:
            route = ROUTE_ADMIN_REVIEW
    return {
        "eligible": route == ROUTE_AUTO_POST_CANDIDATE and not reasons,
        "route": route,
        "reasons": reasons,
        "sensitive": sensitive,
        "quality": quality,
    }


def daily_draft_window(today: date) -> tuple[date, date]:
    return today - timedelta(days=DAILY_DRAFT_LOOKBACK_DAYS - 1), today


# ---------------------------------------------------------------- seller-center reply check

SELLER_CENTER_SEARCH_JS = r"""
async (req) => {
  const out = { ok: false, found: false, has_comment: null, pages: 0, status: null };
  try {
    for (let page = 0; page < req.maxPages; page += 1) {
      const body = {
        reviewSearchSortType: 'REVIEW_CREATE_DATE_DESC', searchKeywordType: 'IDS', searchKeyword: '',
        fromDate: req.fromDate, toDate: req.toDate, useSelectedDate: false, reviewTypes: [],
        reviewContentClassTypes: [], storeTypes: [], reviewScores: [], benefitKindTypeStringList: [],
        contentsStatusTypes: [], page, size: 500, sort: [],
      };
      const r = await fetch('/api/v3/contents/reviews/search', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json;charset=UTF-8' }, body: JSON.stringify(body),
      });
      out.status = r.status;
      out.pages = page + 1;
      if (r.status !== 200) return out;
      const j = await r.json();
      const rows = j.contents || [];
      const hit = rows.find((c) => String(c.id) === String(req.reviewId));
      if (hit) {
        out.ok = true; out.found = true;
        out.has_comment = String(hit.hasComment).toLowerCase() === 'true';
        return out;
      }
      if (j.last || !rows.length) { out.ok = true; return out; }
    }
    out.ok = true; out.truncated = true;
    return out;
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 200);
    return out;
  }
}
"""
SELLER_CENTER_SEARCH_MAX_PAGES = 6


def seller_center_search_request(review_id: object, review_written_at: object, today: date) -> dict | None:
    review_id0 = str(review_id or "").strip()
    written = _as_date(review_written_at)
    if not review_id0 or written is None:
        return None
    start = written - timedelta(days=1)
    end = min(written + timedelta(days=1), today)
    if end < start:
        end = start
    return {
        "reviewId": review_id0,
        "fromDate": f"{start.isoformat()}T00:00:00.000+09:00",
        "toDate": f"{end.isoformat()}T23:59:59.999+09:00",
        "maxPages": SELLER_CENTER_SEARCH_MAX_PAGES,
    }


def interpret_seller_center_probe(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {"state": SELLER_CENTER_UNKNOWN, "reason": "probe_result_invalid"}
    if not raw.get("ok"):
        reason = str(raw.get("error") or (f"http_{raw.get('status')}" if raw.get("status") else "probe_failed"))
        return {"state": SELLER_CENTER_UNKNOWN, "reason": reason[:120]}
    if not raw.get("found"):
        return {"state": SELLER_CENTER_UNKNOWN, "reason": "review_not_found_in_search"}
    if raw.get("has_comment") is True:
        return {"state": SELLER_CENTER_REPLIED, "reason": "has_comment_true"}
    if raw.get("has_comment") is False:
        return {"state": SELLER_CENTER_NOT_REPLIED, "reason": "has_comment_false"}
    return {"state": SELLER_CENTER_UNKNOWN, "reason": "has_comment_missing"}
