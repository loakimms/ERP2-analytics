"""Meaning-preserving extraction of guidance units from historical review replies.

A unit keeps numeric ranges, ordered steps, the condition it applies to and any limitation
together, and always points back to an exact span of the reply text. Nothing is generated:
originalText is always reply_text[start:end]. Missing information stays "UNKNOWN".
Units are extraction results, not verified product facts.
"""

from __future__ import annotations

import re

EXTRACTION_VERSION = "knowhow_semantic_v2"
LEGACY_EXTRACTION_VERSION = "knowhow_sentence_v1"
UNKNOWN = "UNKNOWN"

TYPE_PROCEDURE = "ORDERED_PROCEDURE"
TYPE_CONDITIONAL = "CONDITIONAL_GUIDANCE"
TYPE_NUMERIC = "NUMERIC_GUIDANCE"
TYPE_CAUTION = "CAUTION"
TYPE_QUESTION = "QUESTION_OR_CONFIRMATION"
TYPE_PRODUCT_USAGE = "PRODUCT_USAGE"
TYPE_EXPLANATION = "EXPLANATION"

UNIT_UNVERIFIED = "UNVERIFIED"
UNIT_REPLY_APPROVED_NOT_INDIVIDUALLY_VERIFIED = "REPLY_APPROVED_UNIT_NOT_INDIVIDUALLY_VERIFIED"
UNIT_REVALIDATION_REQUIRED = "REVALIDATION_REQUIRED"

CHANGE_NONE = "NO_CHANGE"
CHANGE_BOUNDARY_ONLY = "BOUNDARY_OR_DISPLAY_ONLY"
CHANGE_CONDITION_RESTORED = "CONDITION_RESTORED"
CHANGE_SEQUENCE_RESTORED = "SEQUENCE_RESTORED"
CHANGE_NUMERIC_RANGE_RESTORED = "NUMERIC_RANGE_RESTORED"
CHANGE_PRODUCT_TARGET_CHANGED = "PRODUCT_TARGET_CHANGED"
CHANGE_QUESTION_RECLASSIFIED = "QUESTION_RECLASSIFIED"
CHANGE_GUIDANCE_ADDED = "GUIDANCE_ADDED"
CHANGE_GUIDANCE_REMOVED = "GUIDANCE_REMOVED"
MEANING_CHANGES = (
    CHANGE_CONDITION_RESTORED,
    CHANGE_SEQUENCE_RESTORED,
    CHANGE_NUMERIC_RANGE_RESTORED,
    CHANGE_PRODUCT_TARGET_CHANGED,
    CHANGE_GUIDANCE_ADDED,
)

KNOWHOW_RE = re.compile(
    r"비율|[0-9]\s*[:：대]\s*[0-9]|레드\s*\d|브라운\s*\d|암라|방치|도포|딥클린|발색|장갑|헹굼|세척|산화|물\s*온도|물양|패치\s*테스트|[0-9]\s*시간|선염색|후염색|맥주효모"
)
_UNIT_WORD = r"(?:시간|분|회|번|일|주|개월|%|ml|g)"
# "2시간~3시간", "2~3시간", "2시간~길게는 3시간", "2시간30분~3시간"
_RANGE_RE = re.compile(
    rf"\d+(?:\.\d+)?\s*{_UNIT_WORD}?(?:\s*\d+\s*분)?\s*[~〜\-]\s*(?:길게는|많게는|최대|짧게는)?\s*\d+(?:\.\d+)?\s*{_UNIT_WORD}(?:\s*\d+\s*분)?"
)
_RANGE_TILDE_RE = re.compile(rf"(?<=\d)(\s*{_UNIT_WORD}?(?:\s*\d+\s*분)?\s*)[~〜](?=\s*(?:길게는|많게는|최대|짧게는)?\s*\d)")
_DECIMAL_DOT_RE = re.compile(r"(?<=\d)\.(?=\d)")
_TERMINATOR_RE = re.compile(r"[.!?\n]+|[~^]+")
_PROTECT = {"~": "\u0001", ".": "\u0002"}

_CONTINUATION_RE = re.compile(r"^(길게는|짧게는|많게는|최대|그\s*후에?|그후에?|이후에?|이어서|그\s*다음|다음으로|그리고|또는|혹은\s+\d|단,|다만|\d)")
_SEQUENCE_MARKER_RE = re.compile(r"그\s*후에?|그후에?|이후에?|이어서|그\s*다음에?|다음으로|마지막으로|(?<=시간)\s*후에?|(?<=분)\s*후에?")
_CONDITION_RE = re.compile(
    r"^(만약|혹시|혹은|다만|단[, ]|주의할\s*점은|특히)|(경우(에는|라면|에|엔)?|이라면|시라면|아니시라면|원하시면|않으시면|느끼시면|불편하시면|싫으시면|드시면)(?=\s|,|$)"
)
_LIMITATION_RE = re.compile(
    r"안\s*됩니다|하지\s*마|사용하지|금지|피해\s*주|피하|다를\s*수|다르게\s*나타|차이가\s*있|개인차|개인의|모든\s*분|동일하지|어려울\s*수|않을\s*수|주의|컨디션에\s*따라|모발\s*상태"
)
_CAUTION_RE = re.compile(r"주의|하지\s*마|사용하지|금지|피해\s*주|피하|패치\s*테스트")
_QUESTION_RE = re.compile(r"\?$|어떠셨|하셨나요|하셨을까요|셨는지|궁금|여쭤|확인\s*부탁|알려\s*주시|모르겠습니다")
_PRODUCT_PATTERNS = (
    ("레드 헤나", re.compile(r"레드(?!빛|기)")),
    ("브라운 헤나", re.compile(r"브라운")),
    ("인디고", re.compile(r"인디고")),
    ("암라", re.compile(r"암라")),
    ("카시아", re.compile(r"카시아")),
    ("맥주효모 샴푸", re.compile(r"맥주효모")),
    ("헤어팩", re.compile(r"헤어\s*팩|트리트먼트")),
    ("호호바 오일", re.compile(r"호호바")),
)
_RATIO_RE = re.compile(r"(?:레드|브라운)?\s*\d+\s*(?:[:：]|대)\s*(?:레드|브라운)?\s*\d+")
_DURATION_RE = re.compile(rf"{_RANGE_RE.pattern}|\d+(?:\.\d+)?\s*(?:시간|분)(?:\s*\d+\s*분)?")
_NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def _segments(text: str) -> list[tuple[int, int]]:
    """Split into (start, end) spans; range tildes and decimal dots never terminate."""
    shielded = _RANGE_TILDE_RE.sub(lambda m: m.group(1) + _PROTECT["~"], text)
    shielded = _DECIMAL_DOT_RE.sub(_PROTECT["."], shielded)
    spans: list[tuple[int, int]] = []
    start = 0
    for m in _TERMINATOR_RE.finditer(shielded):
        end = m.end()
        if shielded[start:end].strip(" .!?~^\n"):
            spans.append((start, end))
        elif spans:
            spans[-1] = (spans[-1][0], end)
        start = end
    if start < len(text) and text[start:].strip():
        spans.append((start, len(text)))
    out = []
    for s, e in spans:
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if s < e:
            out.append((s, e))
    return out


def _merge_continuations(text: str, spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for s, e in spans:
        body = text[s:e]
        if merged and _CONTINUATION_RE.search(body) and not body.startswith("다음번"):
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def _products(text: str) -> list[str]:
    return [name for name, pattern in _PRODUCT_PATTERNS if pattern.search(text)]


def _numeric_ranges(text: str) -> list[dict]:
    out = []
    for m in _DURATION_RE.finditer(text):
        raw = m.group(0).strip()
        nums = [float(x) for x in _NUM_RE.findall(raw)]
        units = re.findall(r"시간|분|회|번|일|주|개월|%|ml|g", raw)
        is_range = bool(re.search(r"[~〜\-]", raw))
        out.append({"text": raw, "min": nums[0] if nums else None, "max": nums[-1] if (is_range and nums) else (nums[0] if nums else None),
                    "unit": units[-1] if units else UNKNOWN, "isRange": is_range})
    for m in _RATIO_RE.finditer(text):
        out.append({"text": m.group(0).strip(), "min": None, "max": None, "unit": "RATIO", "isRange": False})
    return out


def _inside_parentheses(text: str, pos: int) -> bool:
    prefix = text[:pos]
    return prefix.count("(") > prefix.count(")")


def _last_product_mention(text: str, before: int) -> tuple[int, str] | None:
    best: tuple[int, str] | None = None
    for name, pattern in _PRODUCT_PATTERNS:
        for m in pattern.finditer(text, 0, before):
            if _inside_parentheses(text, m.start()):
                continue
            if best is None or m.start() > best[0]:
                best = (m.start(), name)
    return best


def _sequence(text: str) -> list[dict]:
    markers = list(_SEQUENCE_MARKER_RE.finditer(text))
    if not markers:
        return []
    bounds = [0] + [m.end() for m in markers]
    ends = [m.start() for m in markers] + [len(text)]
    steps = []
    for i, (ps, pe) in enumerate(zip(bounds, ends)):
        part = text[ps:pe]
        first = next(iter(_DURATION_RE.finditer(part)), None) or next(iter(_RATIO_RE.finditer(part)), None)
        if first is None:
            continue
        mention = _last_product_mention(part, first.start())
        if mention is None:
            continue
        step_end = first.end()
        step_start = 0 if (i > 0 and step_end <= 40) else mention[0]
        step_text = part[step_start:step_end].strip(" ,★")
        steps.append(
            {
                "order": len(steps) + 1,
                "text": step_text,
                "product": mention[1],
                "numeric": [r["text"] for r in _numeric_ranges(step_text)] or UNKNOWN,
                "connector": markers[i - 1].group(0).strip() if i > 0 else UNKNOWN,
            }
        )
    return steps if len(steps) >= 2 else []


_INLINE_CONDITION_RE = re.compile(
    r"(원하신다면|원하시면|이라면|시라면|신다면|경우(?:에는|라면|엔)?|않으시면|느끼시면|불편하시면|싫으시면|드시면)(?=[\s,]|$)"
)
_CLAUSE_BOUNDARY_RE = re.compile(r"★|,|되고\s|는데요\s*|[.!?]\s|\n")
_LEADING_SYMBOLS_RE = re.compile(r"^[^0-9A-Za-z가-힣]+")
_REFERENCE_RE = re.compile(r"(이|그|이런|그런|이럴|그럴)\s*경우|위\s*(제품|방법|내용)|해당\s*(제품|방법)")
_ATTACHABLE_CONDITION_RE = re.compile(r"^(만약|혹시|혹은|다만|단[, ]|주의할\s*점은)|^(이|이럴|그럴|그)\s*경우")


def _inline_conditions(text: str) -> list[str]:
    out = []
    for m in _INLINE_CONDITION_RE.finditer(text):
        prefix = text[: m.end()]
        cut = 0
        for b in _CLAUSE_BOUNDARY_RE.finditer(prefix):
            cut = b.end()
        clause = prefix[cut:].strip(" ,★\"'")
        if len(clause) > 80:
            clause = clause[-80:]
        if clause and clause not in out:
            out.append(clause)
    return out


def _condition_clause(text: str) -> str | None:
    """Leading conditional connective only; mid-sentence conditions go through _inline_conditions."""
    m = _CONDITION_RE.search(text)
    if not m or m.start() != 0 or not m.group(1):
        return None
    cut = re.search(r"(경우(에는|라면|에|엔)?|라면|으시면|시면|면)(\s|,)", text)
    return text[: cut.end()].strip(" ,") if cut else text


def _facts(text: str) -> list[str]:
    facts = [f"RATIO:{r['text']}" for r in _numeric_ranges(text) if r["unit"] == "RATIO"]
    facts += [f"DURATION:{r['text']}" for r in _numeric_ranges(text) if r["unit"] != "RATIO" and r["unit"] in ("시간", "분", UNKNOWN)]
    facts += [f"PRODUCT:{p}" for p in _products(text)]
    return facts


def extract_units(reply_text: object, *, source_id: str | None = None, detect_topics=None) -> list[dict]:
    text = str(reply_text or "")
    spans = _merge_continuations(text, _segments(text))
    units: list[dict] = []
    pending_condition: tuple[int, int, bool] | None = None
    for s, e in spans:
        body = text[s:e]
        is_question = bool(_QUESTION_RE.search(body.rstrip(" ~^.!"))) or body.rstrip(" ~^").endswith("?")
        has_knowhow = bool(KNOWHOW_RE.search(body))
        lead = _LEADING_SYMBOLS_RE.sub("", body)
        condition_here = None if is_question else _condition_clause(lead)
        if not has_knowhow:
            conditional = (condition_here or _inline_conditions(body)) and not is_question
            pending_condition = (s, e, bool(_ATTACHABLE_CONDITION_RE.search(lead))) if conditional else None
            continue
        start = s
        condition_text = condition_here
        if pending_condition is not None and not condition_here and not is_question and (
            pending_condition[2] or set(_products(text[pending_condition[0]:pending_condition[1]])) & set(_products(body))
        ):
            start = pending_condition[0]
            condition_text = text[pending_condition[0]:pending_condition[1]]
        pending_condition = None
        context_before = UNKNOWN
        earlier = [sp for sp in spans if sp[1] <= start]
        if condition_text and _REFERENCE_RE.search(condition_text) and earlier:
            context_before = text[earlier[-1][0]:earlier[-1][1]]
        inline = [] if is_question else [c for c in _inline_conditions(body) if not (condition_text and c in condition_text)]
        if inline:
            condition_text = " | ".join(([condition_text] if condition_text else []) + inline)
        original = text[start:e]
        steps = _sequence(body)
        ranges = _numeric_ranges(body)
        limitation = sorted({m.group(0) for m in _LIMITATION_RE.finditer(original)})
        if is_question:
            ktype = TYPE_QUESTION
        elif steps:
            ktype = TYPE_PROCEDURE
        elif condition_text:
            ktype = TYPE_CONDITIONAL
        elif _CAUTION_RE.search(body):
            ktype = TYPE_CAUTION
        elif ranges:
            ktype = TYPE_NUMERIC
        elif _products(body):
            ktype = TYPE_PRODUCT_USAGE
        else:
            ktype = TYPE_EXPLANATION
        action = body
        if condition_here and condition_here in body:
            action = body[body.index(condition_here) + len(condition_here):].strip(" ,") or body
        facts = _facts(original)
        units.append(
            {
                "sourceReplyId": source_id or UNKNOWN,
                "originalText": original,
                "sourceTextSpan": [start, e],
                "knowledgeType": ktype,
                "isKnowledgeCandidate": ktype != TYPE_QUESTION,
                "product": _products(original) or UNKNOWN,
                "condition": condition_text or UNKNOWN,
                "conditionReference": "UNRESOLVED_REFERENCE" if context_before != UNKNOWN else UNKNOWN,
                "contextBefore": context_before,
                "action": action,
                "sequence": steps,
                "numericRange": ranges,
                "unit": sorted({r["unit"] for r in ranges}) or UNKNOWN,
                "limitation": limitation,
                "extractionVersion": EXTRACTION_VERSION,
                "validationStatus": UNIT_UNVERIFIED,
                # compatibility fields used by retrieval / UI / stored snapshots
                "sentence": original,
                "topics": detect_topics(original) if detect_topics else [],
                "facts": facts,
                "requires_current_fact_verification": bool(facts) and ktype != TYPE_QUESTION,
            }
        )
    return units


def _norm(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text or "")


def _range_texts(units: list[dict]) -> set[str]:
    out = set()
    for u in units:
        for m in _RANGE_RE.finditer(u.get("sentence") or u.get("originalText") or ""):
            out.add(_norm(m.group(0)))
    return out


def _product_number_pairs(units: list[dict]) -> set[tuple[str, str]]:
    """(product, number) pairs where a duration is attributable to exactly one product."""
    pairs = set()
    for u in units:
        body = u.get("sentence") or u.get("originalText") or ""
        steps = u.get("sequence") or []
        chunks = [(st.get("text") or "") for st in steps] if steps else [body]
        for chunk in chunks:
            prods = _products(chunk)
            if len(prods) != 1:
                continue
            for r in _numeric_ranges(chunk):
                if r["unit"] == "RATIO":
                    continue
                for n in _NUM_RE.findall(r["text"]):
                    pairs.add((prods[0], n))
    return pairs


def _question_units(units: list[dict]) -> int:
    return sum(1 for u in units if u.get("knowledgeType") == TYPE_QUESTION)


def compare_extractions(old_units: list[dict] | None, new_units: list[dict], reply_text: str) -> dict:
    """Classify how the new extraction differs from an old snapshot/legacy extraction."""
    old_units = old_units or []
    old_text = [_norm(u.get("sentence") or u.get("originalText") or "") for u in old_units]
    new_text = [_norm(u.get("sentence") or u.get("originalText") or "") for u in new_units]
    changes: list[str] = []
    question_reclassified = _question_units(new_units) > _question_units(old_units)
    if old_text == new_text:
        return {
            "changes": [CHANGE_QUESTION_RECLASSIFIED] if question_reclassified else [CHANGE_NONE],
            "meaningChanged": False,
            "oldVersion": _version(old_units),
            "newVersion": EXTRACTION_VERSION,
        }
    old_cover, new_cover = "".join(old_text), "".join(new_text)
    new_conditions = [u for u in new_units if u.get("condition") not in (None, UNKNOWN) and u.get("knowledgeType") != TYPE_QUESTION]
    for u in new_conditions:
        parts = [_norm(p) for p in str(u["condition"]).split(" | ")]
        if any(p and not any(p in o for o in old_text) for p in parts):
            changes.append(CHANGE_CONDITION_RESTORED)
            break
    for u in new_units:
        steps = [_norm(st.get("text") or "") for st in (u.get("sequence") or [])]
        if steps and not any(all(st in o for st in steps) for o in old_text):
            changes.append(CHANGE_SEQUENCE_RESTORED)
            break
    new_ranges = _range_texts(new_units)
    old_ranges = _range_texts(old_units)
    if new_ranges - old_ranges:
        changes.append(CHANGE_NUMERIC_RANGE_RESTORED)
    old_pairs, new_pairs = _product_number_pairs(old_units), _product_number_pairs(new_units)
    if old_pairs - new_pairs:
        changes.append(CHANGE_PRODUCT_TARGET_CHANGED)
    if question_reclassified:
        changes.append(CHANGE_QUESTION_RECLASSIFIED)
    added_guidance = [t for t in new_text if t and t not in old_cover and not any(t in o or o in t for o in old_text if o)]
    removed = [t for t in old_text if t and t not in new_cover]
    if added_guidance and CHANGE_CONDITION_RESTORED not in changes:
        changes.append(CHANGE_GUIDANCE_ADDED)
    if removed:
        changes.append(CHANGE_GUIDANCE_REMOVED)
    if not changes:
        changes.append(CHANGE_BOUNDARY_ONLY)
    return {
        "changes": changes,
        "meaningChanged": any(c in MEANING_CHANGES for c in changes),
        "oldVersion": _version(old_units),
        "newVersion": EXTRACTION_VERSION,
    }


def _version(units: list[dict]) -> str:
    for u in units:
        if u.get("extractionVersion"):
            return str(u["extractionVersion"])
    return LEGACY_EXTRACTION_VERSION


__all__ = [
    "EXTRACTION_VERSION",
    "LEGACY_EXTRACTION_VERSION",
    "extract_units",
    "compare_extractions",
]
