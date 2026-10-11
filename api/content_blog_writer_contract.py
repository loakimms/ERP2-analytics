from __future__ import annotations

from typing import Any

from content_blog_experience_patterns import OVERCLAIM_TERMS
from content_blog_planner import CATEGORY_PRODUCT_LEAP_HINTS, DEFENSIVE_META_PATTERNS, UNSUPPORTED_SUPERIORITY_TERMS


CODE_QUALIFIED_KNOWLEDGE_USED_WITHOUT_QUALIFIER = "QUALIFIED_KNOWLEDGE_USED_WITHOUT_QUALIFIER"
CODE_DEFENSIVE_META_LANGUAGE_LEAKAGE = "DEFENSIVE_META_LANGUAGE_LEAKAGE"
CODE_MARKETING_OBJECTIVE_NOT_EXECUTED = "MARKETING_OBJECTIVE_NOT_EXECUTED"
CODE_PRODUCT_VALUE_NOT_COMMUNICATED = "PRODUCT_VALUE_NOT_COMMUNICATED"
CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP = "CATEGORY_TO_PRODUCT_CLAIM_LEAP"
CODE_UNSUPPORTED_SUPERIORITY = "UNSUPPORTED_SUPERIORITY_CLAIM"
CODE_REVIEW_PATTERN_OVERCLAIM = "HOLD_REVIEW_PATTERN_OVERCLAIM"
CODE_BRAND_FACT_FABRICATION = "HOLD_BRAND_FACT_FABRICATION"
CODE_INVALID_REFERENCE = "INVALID_REFERENCE"

WRITER_MODE = "EVIDENCE_BASED_MARKETING_V1"
WRITER_IDENTITY = "PROFESSIONAL_EVIDENCE_BASED_BRAND_WRITER"

QUALIFIER_HINTS = (
    "일부 실험",
    "관련 연구",
    "특정 제형",
    "특정 실험",
    "가능성이 제시",
    "해석의 차이",
    "조건에서는",
    "확정하기에는",
    "단정하지",
    "일반 효능으로",
    "제형과 방법",
    "시험 조건",
    "제형에 따라",
    "참고 정보로만",
)

DEFENSIVE_READER_PATTERNS = DEFENSIVE_META_PATTERNS + (
    "현재 제공된 정보로 말할 수 있는 범위",
    "이 글에서 다룰 수 있는 정보는",
    "현재 자료에는",
    "제공된 정보 기준으로",
    "근거가 충분하지 않아 설명하지",
    "상품URL에서 직접 확인하는 것이 적절",
    "이 글에서는 확대 해석하지",
    "현재 자료에서 확인되는 내용은",
    "확인된 자료 기준으로만",
    "확인할 수 있는 것과 없는 것",
    "말할 수 있는 것과 없는 것",
    "제품 정보의 범위",
)

BRAND_FABRICATION_HINTS = (
    "자연주의 철학",
    "엄격한 품질 기준을 지킵",
    "유기농 원료만",
    "비건 인증",
    "USDA",
    "철학을 고수",
)

PASSIVE_CTA_HINTS = (
    "제품 정보는 URL에서 확인할 수 있습니다",
    "상품URL에서 직접 확인",
)

HARD_SELL_EXTRA = (
    "지금 바로 구매하세요",
    "놓치면 후회합니다",
    "반드시 사용해보세요",
    "최고의 선택입니다",
)


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _issue(code: str, message: str, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    item = {"code": code, "message": message}
    if extra:
        item.update(extra)
    return item


def planned_knowledge_ids(content_plan: dict[str, Any]) -> dict[str, set[str]]:
    product: set[str] = set()
    brand: set[str] = set()
    category: set[str] = set()
    experience: set[str] = set()
    for section in _as_list(content_plan.get("sections")):
        if not isinstance(section, dict):
            continue
        product.update(_text(ref) for ref in _as_list(section.get("productKnowledgeRefs")) if _text(ref))
        brand.update(_text(ref) for ref in _as_list(section.get("brandKnowledgeRefs")) if _text(ref))
        category.update(_text(ref) for ref in _as_list(section.get("categoryKnowledgeRefs")) if _text(ref))
        experience.update(_text(ref) for ref in _as_list(section.get("experiencePatternRefs")) if _text(ref))
    for item in _as_list(content_plan.get("knowledgeUsePlan")) + _as_list(content_plan.get("productValuePlan")) + _as_list(content_plan.get("brandUsePlan")):
        if not isinstance(item, dict):
            continue
        ref = _text(item.get("knowledgeRef") or item.get("knowledgeId"))
        if ref.startswith("PK-"):
            product.add(ref)
        elif ref.startswith("BK-"):
            brand.add(ref)
        elif ref.startswith("CK-"):
            category.add(ref)
        elif ref.startswith("XP-"):
            experience.add(ref)
    for item in _as_list(content_plan.get("experiencePatterns")):
        if isinstance(item, dict) and _text(item.get("patternId")):
            experience.add(_text(item.get("patternId")))
    return {"product": product, "brand": brand, "category": category, "experience": experience}


def catalog_knowledge_ids(catalogs: dict[str, Any]) -> dict[str, set[str]]:
    catalog = catalogs.get("plannerReferenceCatalog") if isinstance(catalogs.get("plannerReferenceCatalog"), dict) else {}
    return {
        "product": set(catalog.get("allowedProductKnowledgeIds") or []) | set((catalogs.get("productById") or {}).keys()),
        "brand": set(catalog.get("allowedBrandKnowledgeIds") or []) | set((catalogs.get("brandById") or {}).keys()),
        "category": set(catalog.get("allowedCategoryKnowledgeIds") or []) | set((catalogs.get("categoryById") or {}).keys()),
        "experience": set(catalog.get("allowedExperiencePatternIds") or []) | set((catalogs.get("experiencePatternById") or {}).keys()),
    }


def qualified_category_ids(catalogs: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for item in catalogs.get("categoryKnowledgeCatalog") or []:
        if isinstance(item, dict) and (item.get("knowledgeUsePolicy") == "QUALIFIED_EDUCATION_ONLY" or item.get("qualificationRequired")):
            if _text(item.get("knowledgeId")):
                out.add(_text(item.get("knowledgeId")))
    for item in (catalogs.get("categoryById") or {}).values():
        if isinstance(item, dict) and (item.get("knowledgeUsePolicy") == "QUALIFIED_EDUCATION_ONLY" or item.get("qualificationRequired")):
            if _text(item.get("knowledgeId")):
                out.add(_text(item.get("knowledgeId")))
    return out


def known_knowledge_blob(catalogs: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in catalogs.get("facts") or []:
        if isinstance(item, dict):
            parts.append(_text(item.get("statement")))
    for item in catalogs.get("evidence") or []:
        if isinstance(item, dict):
            parts.append(_text(item.get("statement")))
    for item in catalogs.get("categoryKnowledgeCatalog") or []:
        if not isinstance(item, dict):
            continue
        parts.append(_text(item.get("statement")))
        parts.append(_text(item.get("topic")))
        interp = item.get("marketingInterpretation") if isinstance(item.get("marketingInterpretation"), dict) else {}
        parts.append(_text(interp.get("example")))
    for item in (catalogs.get("categoryById") or {}).values():
        if isinstance(item, dict):
            parts.append(_text(item.get("statement")))
            parts.append(_text(item.get("topic")))
    for item in (catalogs.get("productById") or {}).values():
        if isinstance(item, dict):
            parts.append(_text(item.get("statement")))
    for item in catalogs.get("knowledgeStatements") or []:
        if isinstance(item, dict):
            parts.append(_text(item.get("statement")))
            parts.append(_text(item.get("topic")))
    blob = " ".join(parts).lower()
    blob = blob.replace("wax esters", "wax ester").replace("왁스에스터", "왁스 에스터")
    aliases: list[str] = []
    if "lawsonia" in blob or "inermis" in blob:
        aliases.extend(["로소니아", "로손", "lawsone", "lawsonia"])
    if "lawsone" in blob:
        aliases.extend(["로손", "lawsone"])
    if "wax ester" in blob:
        aliases.extend(["왁스 에스터", "wax ester"])
    if "triglyceride" in blob:
        aliases.extend(["트리글리세라이드", "triglyceride"])
    if aliases:
        blob = blob + " " + " ".join(aliases)
    return blob


def collect_used_knowledge(draft: dict[str, Any]) -> dict[str, list[str]]:
    used = {"product": [], "brand": [], "category": [], "experience": [], "evidence": [], "facts": []}
    for section in _as_list(draft.get("sections")):
        usage = section.get("knowledgeUsage") if isinstance(section.get("knowledgeUsage"), dict) else {}
        for key, bucket in (
            ("productKnowledgeRefs", "product"),
            ("brandKnowledgeRefs", "brand"),
            ("categoryKnowledgeRefs", "category"),
            ("experiencePatternRefs", "experience"),
        ):
            for ref in _as_list(usage.get(key)) + _as_list(section.get(key)):
                value = _text(ref)
                if value and value not in used[bucket]:
                    used[bucket].append(value)
        for ref in _as_list(section.get("evidenceRefs")):
            value = _text(ref)
            if value and value not in used["evidence"]:
                used["evidence"].append(value)
        for ref in _as_list(section.get("sourceRefs")):
            value = _text(ref)
            if value and value not in used["facts"]:
                used["facts"].append(value)
    return used


def check_writer_marketing_contract(
    *,
    draft: dict[str, Any],
    public_text: str,
    content_plan: dict[str, Any],
    intent_analysis: dict[str, Any],
    catalogs: dict[str, Any],
    issues: list[dict[str, Any]],
) -> None:
    _check_invented_ids(draft, catalogs, content_plan, issues)
    _check_qualified_knowledge(draft, public_text, catalogs, issues)
    _check_category_product_leap(public_text, draft, issues)
    _check_unsupported_superiority(public_text, issues)
    _check_defensive_language(public_text, issues)
    _check_review_overclaim(public_text, draft, catalogs, issues)
    _check_brand_fabrication(public_text, catalogs, issues)
    _check_marketing_objective(public_text, intent_analysis, content_plan, issues)
    _check_product_value(public_text, draft, catalogs, content_plan, issues)
    _check_hard_sell(public_text, issues)


def _all_allowed_ids(catalogs: dict[str, Any], content_plan: dict[str, Any]) -> set[str]:
    catalog_ids = catalog_knowledge_ids(catalogs)
    planned = planned_knowledge_ids(content_plan)
    allowed = set(catalogs.get("factById", {}).keys()) | set(catalogs.get("evidenceIds") or set()) | set(catalogs.get("sourceRefs") or set())
    for bucket in ("product", "brand", "category", "experience"):
        allowed |= catalog_ids[bucket] | planned[bucket]
    return {item for item in allowed if item}


def _check_invented_ids(draft: dict[str, Any], catalogs: dict[str, Any], content_plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    allowed = _all_allowed_ids(catalogs, content_plan)
    used = collect_used_knowledge(draft)
    for bucket in ("product", "brand", "category", "experience", "evidence"):
        for ref in used[bucket]:
            if ref not in allowed:
                issues.append(_issue(CODE_INVALID_REFERENCE, "writer invented a knowledge or evidence id", extra={"ref": ref}))


def _check_qualified_knowledge(draft: dict[str, Any], public_text: str, catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    qualified = qualified_category_ids(catalogs)
    if not qualified:
        return
    for section in _as_list(draft.get("sections")):
        usage = section.get("knowledgeUsage") if isinstance(section.get("knowledgeUsage"), dict) else {}
        refs = [_text(ref) for ref in _as_list(usage.get("categoryKnowledgeRefs")) + _as_list(section.get("categoryKnowledgeRefs")) if _text(ref)]
        body = " ".join(_as_list(section.get("paragraphs")) + _as_list(section.get("bullets")))
        records = section.get("qualifiedKnowledgeUsage") if isinstance(section.get("qualifiedKnowledgeUsage"), list) else usage.get("qualifiedKnowledge")
        records = records if isinstance(records, list) else []
        by_ref = {_text(item.get("knowledgeRef")): item for item in records if isinstance(item, dict)}
        for ref in refs:
            if ref not in qualified:
                continue
            record = by_ref.get(ref) if isinstance(by_ref.get(ref), dict) else {}
            applied = bool(record.get("qualificationApplied"))
            qtext = _text(record.get("qualificationText"))
            body_has_qualifier = any(hint in body for hint in QUALIFIER_HINTS) or (qtext and qtext in body)
            if not applied or not qtext or not body_has_qualifier:
                issues.append(
                    _issue(
                        CODE_QUALIFIED_KNOWLEDGE_USED_WITHOUT_QUALIFIER,
                        "qualified category knowledge used without a real qualifier in the section body",
                        extra={"knowledgeRef": ref, "sectionId": section.get("sectionId")},
                    )
                )


def _check_category_product_leap(public_text: str, draft: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    used = collect_used_knowledge(draft)
    extra_hints = (
        "수자타 제품이 더 잘 염색",
        "수자타 헤나는 염색력이 우수",
        "lawsone 함량이 높은 수자타",
        "냉압착이므로 더 우수",
        "수자타 호호바는 산화에 강",
    )
    if any(hint in public_text for hint in CATEGORY_PRODUCT_LEAP_HINTS + extra_hints):
        issues.append(_issue(CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP, "category knowledge converted into a product superiority claim"))
        return
    if used["category"] and not used["product"] and ("더 잘 염색" in public_text or "염색력이 우수" in public_text):
        issues.append(_issue(CODE_CATEGORY_TO_PRODUCT_CLAIM_LEAP, "category knowledge converted into a product superiority claim"))


def _check_unsupported_superiority(public_text: str, issues: list[dict[str, Any]]) -> None:
    extra = ("헤나가 더 안전", "헤나는 산화염모보다 안전", "모든 사람에게 흡수가 잘", "발모 효과", "모발 손상을 치료")
    if any(term in public_text for term in UNSUPPORTED_SUPERIORITY_TERMS + extra):
        issues.append(_issue(CODE_UNSUPPORTED_SUPERIORITY, "unsupported superiority claim in writer copy"))


def _check_defensive_language(public_text: str, issues: list[dict[str, Any]]) -> None:
    hits = [pattern for pattern in DEFENSIVE_READER_PATTERNS if pattern and pattern in public_text]
    if any(len(pattern) >= 8 for pattern in hits):
        issues.append(_issue(CODE_DEFENSIVE_META_LANGUAGE_LEAKAGE, "reader-facing defensive meta language leaked", extra={"patterns": hits[:6]}))


REVIEW_OVERCLAIM_PHRASES = (
    "대부분 고객",
    "대부분의 고객",
    "대부분의 사용자",
    "압도적으로 좋은",
    "많은 고객에게 효과",
    "많은 고객이 만족",
    "거의 모든 고객",
    "사용자의 80%",
    "80%",
    "90%",
    "대부분 고객이 만족",
)


def _check_review_overclaim(public_text: str, draft: dict[str, Any], catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    used = collect_used_knowledge(draft)
    if not used["experience"] and "리뷰" not in public_text:
        return
    if any(term in public_text for term in REVIEW_OVERCLAIM_PHRASES) or any(term in public_text for term in OVERCLAIM_TERMS if term not in {"대부분", "효과가 있었다"}):
        issues.append(_issue(CODE_REVIEW_PATTERN_OVERCLAIM, "experience pattern overclaimed as population efficacy"))


def _check_brand_fabrication(public_text: str, catalogs: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    brand_ids = catalog_knowledge_ids(catalogs)["brand"]
    if brand_ids:
        return
    if any(hint in public_text for hint in BRAND_FABRICATION_HINTS):
        issues.append(_issue(CODE_BRAND_FACT_FABRICATION, "brand philosophy or certification fabricated without brand knowledge"))


def _check_marketing_objective(public_text: str, intent_analysis: dict[str, Any], content_plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    marketing = intent_analysis.get("marketingIntent") if isinstance(intent_analysis.get("marketingIntent"), dict) else {}
    strategy = content_plan.get("marketingStrategy") if isinstance(content_plan.get("marketingStrategy"), dict) else {}
    problem = _text(marketing.get("customerProblem") or strategy.get("coreCustomerProblem"))
    if not problem:
        return
    compact = problem.replace(" ", "")
    public_compact = public_text.replace(" ", "")
    if compact[:6] not in public_compact and not any(token in public_text for token in ("새치", "염색", "모발", "관리", "고민") if token in problem):
        issues.append(_issue(CODE_MARKETING_OBJECTIVE_NOT_EXECUTED, "planner customer problem is not reflected in the draft"))


def _check_product_value(public_text: str, draft: dict[str, Any], catalogs: dict[str, Any], content_plan: dict[str, Any], issues: list[dict[str, Any]]) -> None:
    product_items = [item for item in (catalogs.get("productById") or {}).values() if isinstance(item, dict)]
    usable = [
        item
        for item in product_items
        if item.get("knowledgeSubtype") in {"PRODUCT_USAGE_FACT", "PRODUCT_MARKETING_FACT"} or str(item.get("knowledgeId") or "").startswith("PK-UG")
    ]
    if not usable:
        return
    used = collect_used_knowledge(draft)
    cta = _text((draft.get("cta") or {}).get("text"))
    statements = [_text(item.get("statement")) for item in usable if _text(item.get("statement"))]
    mentioned = bool(used["product"]) or any(statement[:10] in public_text for statement in statements if len(statement) >= 10)
    if not mentioned and (not cta or any(hint in cta for hint in PASSIVE_CTA_HINTS)):
        issues.append(_issue(CODE_PRODUCT_VALUE_NOT_COMMUNICATED, "approved product knowledge was avoided in favor of a passive CTA"))


def _check_hard_sell(public_text: str, issues: list[dict[str, Any]]) -> None:
    if any(term in public_text for term in HARD_SELL_EXTRA):
        issues.append(_issue(CODE_UNSUPPORTED_SUPERIORITY, "hard-sell or absolute CTA is not allowed"))
