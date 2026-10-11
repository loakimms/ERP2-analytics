from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from content_blog_knowledge_library import (
    AUTHORITY_OFFICIAL_GUIDE,
    DOMAIN_PRODUCT,
    SCOPE_UNRESOLVED,
    SUBTYPE_USAGE,
    knowledge_statement,
    stable_id,
)

GUIDE_FILENAME = "수자타헤나 사용가이드_자사몰배포용.html"
GUIDE_RELATIVE = Path("The sujata product used guide") / GUIDE_FILENAME
COMMITTED_SOURCE = Path(__file__).resolve().parent / "content_blog_knowledge_artifacts" / "usage_guide_source_v1.json"


def usage_guide_path() -> Path | None:
    here = Path(__file__).resolve()
    repo = here.parents[1]
    candidates = [
        repo.parent / GUIDE_RELATIVE,
        repo / GUIDE_RELATIVE,
        Path(r"d:\dev") / GUIDE_RELATIVE,
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def ingest_usage_guide(*, product: dict[str, Any] | None = None) -> dict[str, Any]:
    """Deterministic usage-guide ingest. LLM = 0. Does not invent category science."""
    product = product if isinstance(product, dict) else {}
    path = usage_guide_path()
    source_path = str(path) if path is not None else str(COMMITTED_SOURCE)
    entries = _load_entries(path)
    if not entries:
        return {
            "source": None,
            "authorityClass": "UNKNOWN_INTERNAL_SOURCE",
            "statements": [],
            "unresolved": [],
            "excludedCount": 0,
            "excludedReasons": ["USAGE_GUIDE_SOURCE_NOT_FOUND"],
            "llmCalls": 0,
        }
    authority = AUTHORITY_OFFICIAL_GUIDE
    mapped: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    group = str(product.get("product_group") or "")
    title = str(product.get("title") or "")
    url = str(product.get("product_url") or "")
    for entry in entries:
        scope = _map_scope(entry, group=group, title=title, url=url)
        statement = knowledge_statement(
            knowledge_id=stable_id("PK-UG", f"{GUIDE_FILENAME}|{entry['key']}|{entry['statement']}"),
            source_domain=DOMAIN_PRODUCT,
            knowledge_subtype=SUBTYPE_USAGE,
            statement=entry["statement"],
            source_id=GUIDE_FILENAME,
            source_path=f"{source_path}#{entry['key']}",
            verification_status="SOURCE_GROUNDED",
            authority_class=authority,
            usable_as_fact=scope["status"] != SCOPE_UNRESOLVED,
            usable_for_marketing=scope["status"] != SCOPE_UNRESOLVED,
            usable_for_product_claim=False,
            usable_for_category_education=False,
            claim_boundary={
                "canStateAsFact": scope["status"] != SCOPE_UNRESOLVED,
                "canClaimSuperiority": False,
                "canClaimEfficacy": False,
                "requiresProductScope": True,
            },
            scope=scope,
            extra={"knowledgeClass": "APPROVED_PRODUCT_KNOWLEDGE" if scope["status"] != SCOPE_UNRESOLVED else SCOPE_UNRESOLVED},
        )
        if scope["status"] == SCOPE_UNRESOLVED:
            unresolved.append(statement)
        else:
            mapped.append(statement)
    return {
        "source": source_path,
        "authorityClass": authority,
        "statements": mapped,
        "unresolved": unresolved,
        "excludedCount": len(unresolved),
        "excludedReasons": [SCOPE_UNRESOLVED] if unresolved else [],
        "llmCalls": 0,
    }


def _load_entries(path: Path | None) -> list[dict[str, str]]:
    if path is not None:
        html = path.read_text(encoding="utf-8", errors="ignore")
        extracted = _extract_entries(html)
        if extracted:
            return extracted
    if COMMITTED_SOURCE.is_file():
        payload = json.loads(COMMITTED_SOURCE.read_text(encoding="utf-8"))
        return [item for item in payload.get("entries") or [] if isinstance(item, dict)]
    return []


def _extract_entries(html: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    block = re.search(r"const productLabel = \{([\s\S]*?)\};", html)
    if block:
        for key, value in re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', block.group(1)):
            entries.append({"key": f"variant:{key}", "variant": key, "kind": "variant", "statement": f"{key}: {value}"})
    if "염색약 - 2시간" in html:
        entries.append({"key": "duration:dye", "variant": "염색약", "kind": "duration", "statement": "염색약 사용 시간: 2시간"})
    if "헤어팩 - 1시간" in html:
        entries.append({"key": "duration:pack", "variant": "헤어팩", "kind": "duration", "statement": "헤어팩 사용 시간: 1시간"})
    if "팔 안쪽" in html:
        entries.append(
            {
                "key": "caution:patch",
                "variant": "염색약",
                "kind": "caution",
                "statement": "사용 전 팔 안쪽에 소량을 발라 피부 반응을 먼저 확인하세요. 따가움, 붉어짐, 가려움 등 불편감이 있으면 사용하지 않는 것이 좋습니다.",
            }
        )
    if "추천 배합" in html:
        entries.append(
            {
                "key": "mix:quiz-dependent",
                "variant": "",
                "kind": "mix",
                "statement": "추천 배합 비율은 사용가이드 진단 답변에 따라 달라지며, 특정 제품에 일반화하지 않는다.",
            }
        )
    return entries


def _map_scope(entry: dict[str, str], *, group: str, title: str, url: str) -> dict[str, Any]:
    kind = entry.get("kind")
    variant = entry.get("variant") or ""
    pack_ctx = group == "herb_pack" or "헤어팩" in title or "허브팩" in title
    henna_ctx = (group == "henna" or "염색약" in title) and not pack_ctx
    jojoba_ctx = ("호호바" in title or "jojoba" in title.lower() or "5787615984" in url) and not pack_ctx and not henna_ctx
    natural_ctx = "내추럴" in title
    shampoo_ctx = "샴푸" in title or "맥주효모" in title
    if kind in {"duration", "caution"} and variant == "염색약":
        if henna_ctx:
            return {"status": "MAPPED", "productGroup": "henna", "variant": "염색약", "field": kind}
        return {"status": SCOPE_UNRESOLVED, "reason": "dye_statement_without_henna_product"}
    if kind == "duration" and variant == "헤어팩":
        if pack_ctx:
            return {"status": "MAPPED", "productGroup": "herb_pack", "variant": "헤어팩", "field": "usage_duration"}
        return {"status": SCOPE_UNRESOLVED, "reason": "duration_pack_without_hair_pack_product"}
    if variant == "호호바 오일":
        if jojoba_ctx:
            return {"status": "MAPPED", "productGroup": "other", "variant": variant, "field": "usage_role"}
        return {"status": SCOPE_UNRESOLVED, "reason": "jojoba_variant_without_jojoba_product"}
    if variant in {"두피 케어 헤어팩", "딥클린 헤어팩", "볼륨업 헤어팩", "손상케어 헤어팩"}:
        if pack_ctx:
            return {"status": "MAPPED", "productGroup": "herb_pack", "variant": variant, "field": "variant"}
        return {"status": SCOPE_UNRESOLVED, "reason": "hair_pack_variant_without_hair_pack_product"}
    if variant in {"수자타 레드", "수자타 브라운"}:
        if henna_ctx:
            return {"status": "MAPPED", "productGroup": "henna", "variant": variant, "field": "color_variant"}
        return {"status": SCOPE_UNRESOLVED, "reason": "henna_color_without_henna_product"}
    if variant == "수자타 내추럴":
        if natural_ctx:
            return {"status": "MAPPED", "productGroup": group or "other", "variant": variant, "field": "variant"}
        return {"status": SCOPE_UNRESOLVED, "reason": "natural_care_variant_ambiguous"}
    if variant == "맥주효모 샴푸":
        if shampoo_ctx:
            return {"status": "MAPPED", "productGroup": group or "other", "variant": variant, "field": "variant"}
        return {"status": SCOPE_UNRESOLVED, "reason": "shampoo_variant_without_shampoo_product"}
    return {"status": SCOPE_UNRESOLVED, "reason": "ambiguous_product_scope", "variant": variant}
