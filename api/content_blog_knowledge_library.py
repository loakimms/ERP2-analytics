from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LIBRARY_VERSION = "blog_internal_knowledge_library_v1"
LIBRARY_PATH = Path(__file__).resolve().parent / "content_blog_knowledge_artifacts" / "internal_knowledge_library_v1.json"

DOMAIN_BRAND = "BRAND_KNOWLEDGE"
DOMAIN_PRODUCT = "PRODUCT_KNOWLEDGE"
DOMAIN_CATEGORY = "CATEGORY_KNOWLEDGE"
DOMAIN_INSIGHT = "CUSTOMER_INSIGHT"
DOMAIN_EXPERIENCE = "CUSTOMER_EXPERIENCE"

SUBTYPE_METADATA = "PRODUCT_METADATA"
SUBTYPE_MARKETING = "PRODUCT_MARKETING_FACT"
SUBTYPE_USAGE = "PRODUCT_USAGE_FACT"
SUBTYPE_TECHNICAL = "PRODUCT_TECHNICAL_FACT"
SUBTYPE_EVIDENCE = "PRODUCT_EVIDENCE"

AUTHORITY_OFFICIAL_GUIDE = "OFFICIAL_PRODUCT_GUIDE"
AUTHORITY_INTERNAL_GUIDE = "INTERNAL_PRODUCT_GUIDE"
AUTHORITY_OPERATIONAL_GUIDE = "INTERNAL_OPERATIONAL_GUIDE"
AUTHORITY_UNKNOWN_INTERNAL = "UNKNOWN_INTERNAL_SOURCE"
AUTHORITY_OFFICIAL_PRODUCT = "OFFICIAL_PRODUCT_SOURCE"
AUTHORITY_REVIEW_CORPUS = "CUSTOMER_REVIEW_CORPUS"
AUTHORITY_DETAIL_PAGE = "DETAIL_PAGE_DERIVED"
AUTHORITY_MODEL = "MODEL_DERIVED"

SCOPE_UNRESOLVED = "UNRESOLVED_PRODUCT_SCOPE"
FUTURE_INTERNAL_SOURCE = "FUTURE_INTERNAL_SOURCE"


def knowledge_statement(
    *,
    knowledge_id: str,
    source_domain: str,
    knowledge_subtype: str,
    statement: str,
    source_id: str,
    source_path: str,
    verification_status: str,
    authority_class: str,
    usable_as_fact: bool,
    usable_for_marketing: bool,
    usable_for_product_claim: bool,
    usable_for_category_education: bool,
    claim_boundary: dict[str, Any],
    scope: dict[str, Any],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "knowledgeId": knowledge_id,
        "sourceDomain": source_domain,
        "knowledgeSubtype": knowledge_subtype,
        "statement": statement,
        "sourceId": source_id,
        "sourcePath": source_path,
        "verificationStatus": verification_status,
        "authorityClass": authority_class,
        "usableAsFact": usable_as_fact,
        "usableForMarketingInterpretation": usable_for_marketing,
        "usableForProductClaim": usable_for_product_claim,
        "usableForCategoryEducation": usable_for_category_education,
        "claimBoundary": claim_boundary,
        "scope": scope,
        "version": LIBRARY_VERSION,
        "provenance": {
            "derived": False,
            "llmCalls": 0,
            "originalSourceIsAuthority": True,
            "builtAt": datetime.now(timezone.utc).isoformat(),
        },
    }
    if extra:
        payload.update(extra)
    return payload


def stable_id(prefix: str, key: str) -> str:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def load_library() -> dict[str, Any]:
    if not LIBRARY_PATH.exists():
        return empty_library()
    try:
        payload = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return empty_library()
    return payload if isinstance(payload, dict) else empty_library()


def empty_library() -> dict[str, Any]:
    return {
        "version": LIBRARY_VERSION,
        "statements": [],
        "unresolved": [],
        "qnaAudit": {},
        "assetInventory": {},
        "llmCalls": 0,
        "externalNetwork": 0,
    }


def load_verified_category_library() -> dict[str, Any]:
    """Runtime library view of ingested category knowledge. Does not read calibration packs."""
    from content_blog_verified_category_ingest import load_runtime_index, load_runtime_manifest

    index = load_runtime_index()
    manifest = load_runtime_manifest()
    statements = []
    for pack_key in ("henna", "jojoba"):
        pack = index.get(pack_key) if isinstance(index.get(pack_key), dict) else {}
        statements.extend(pack.get("statements") or [])
    return {
        "version": LIBRARY_VERSION,
        "path": str((Path(__file__).resolve().parent / "content_blog_knowledge_artifacts" / "research")),
        "statements": statements,
        "manifest": manifest,
        "llmCalls": 0,
        "externalNetwork": 0,
        "silentAutoSync": False,
    }


def dump_library(payload: dict[str, Any]) -> None:
    LIBRARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    LIBRARY_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
