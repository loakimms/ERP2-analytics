from __future__ import annotations

from typing import Any

from content_blog_knowledge_library import stable_id


def build_research_request_candidates(
    *,
    product: dict[str, Any],
    product_knowledge: list[dict[str, Any]],
    brand_knowledge: list[dict[str, Any]],
    category_knowledge: list[dict[str, Any]],
    usage_statements: list[dict[str, Any]],
    ingested_research_requests: list[dict[str, Any]] | None = None,
    category_scope: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Deterministic request candidates. Does not execute external research."""
    group = str(product.get("product_group") or "")
    title = str(product.get("title") or "")
    has_ingredient = any(
        item.get("knowledgeSubtype") == "PRODUCT_TECHNICAL_FACT"
        and item.get("knowledgeClass") == "APPROVED_PRODUCT_KNOWLEDGE"
        and item.get("verificationStatus") != "INFERENCE"
        for item in product_knowledge
        if isinstance(item, dict)
    )
    has_usage = bool(usage_statements)
    requests: list[dict[str, Any]] = []
    if not brand_knowledge:
        requests.append(
            _rr(
                "brand official philosophy/certification/source documents",
                "BRAND",
                "brandKnowledge is empty; do not invent organic/vegan certification from product title",
                ["BRAND_STORY", "PRODUCT_GUIDE"],
                ["OFFICIAL_BRAND_SOURCE", "OFFICIAL_CERTIFICATION"],
            )
        )
    pack_ctx = group == "herb_pack" or "헤어팩" in title
    henna_ctx = (group == "henna" or "염색약" in title) and not pack_ctx
    jojoba_ctx = ("호호바" in title or "jojoba" in title.lower()) and not pack_ctx and not henna_ctx
    scope = str((category_scope or {}).get("scope") or "")
    ingested = [item for item in (ingested_research_requests or []) if isinstance(item, dict)]
    if pack_ctx or scope == "HAIR_PACK":
        if not has_ingredient:
            requests.append(
                _rr(
                    "PRODUCT_INGREDIENT_SOURCE_MISSING",
                    "PRODUCT",
                    "ingredient/composition source is not confirmed; category research must not start from unknown ingredients",
                    ["INGREDIENT_EDUCATION", "PRODUCT_GUIDE"],
                    ["OFFICIAL_PRODUCT_SOURCE", "OFFICIAL_TEST_REPORT"],
                )
            )
        elif not category_knowledge:
            requests.append(
                _rr(
                    "hair-pack ingredient verified references after ingredient source exists",
                    "CATEGORY",
                    "ingredient source exists but verified category knowledge does not",
                    ["INGREDIENT_EDUCATION"],
                    ["PEER_REVIEWED_RESEARCH"],
                )
            )
    elif henna_ctx or jojoba_ctx or scope in {"HENNA", "JOJOBA"}:
        if ingested:
            for item in ingested:
                mapped = dict(item)
                mapped.setdefault("domain", "CATEGORY")
                mapped.setdefault("executed", False)
                mapped.setdefault("llmCalls", 0)
                mapped.setdefault("externalNetwork", 0)
                mapped.setdefault("readerFacing", False)
                mapped["currentInternalCoverage"] = mapped.get("status") or mapped.get("coverageStatus") or "MISSING"
                requests.append(mapped)
        elif not category_knowledge:
            topics = (
                (
                    "Lawsonia inermis",
                    "lawsone",
                    "henna coloring mechanism",
                    "henna composition",
                    "plant dye vs oxidative dye difference",
                )
                if henna_ctx or scope == "HENNA"
                else (
                    "jojoba composition",
                    "wax ester",
                    "oxidative stability",
                    "jojoba quality indicators",
                    "hair application evidence",
                )
            )
            for topic in topics:
                requests.append(
                    _rr(
                        topic,
                        "CATEGORY",
                        "verified category knowledge is missing; do not fill from model general knowledge",
                        ["INGREDIENT_EDUCATION", "HOW_TO", "PROBLEM_SOLUTION"] if henna_ctx or scope == "HENNA" else ["INGREDIENT_EDUCATION", "PRODUCT_GUIDE"],
                        ["PEER_REVIEWED_RESEARCH", "INSTITUTIONAL_REFERENCE"],
                    )
                )
    if not has_usage:
        requests.append(
            _rr(
                "official usage/ingredient/detail-page source",
                "PRODUCT",
                "no mapped PRODUCT_USAGE_FACT or technical fact beyond metadata",
                ["HOW_TO", "PRODUCT_GUIDE"],
                ["OFFICIAL_PRODUCT_SOURCE", "OFFICIAL_PRODUCT_GUIDE"],
            )
        )
    return requests


def _rr(topic: str, domain: str, reason: str, content_types: list[str], authority: list[str]) -> dict[str, Any]:
    return {
        "requestId": stable_id("RR", f"{domain}|{topic}"),
        "topic": topic,
        "domain": domain,
        "reason": reason,
        "requiredForContentTypes": content_types,
        "currentInternalCoverage": "MISSING",
        "preferredAuthority": authority,
        "status": "NOT_RESEARCHED",
        "readerFacing": False,
        "executed": False,
        "llmCalls": 0,
        "externalNetwork": 0,
    }
