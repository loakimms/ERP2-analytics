from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


INGEST_VERSION = "approved_category_knowledge_manifest_v1"
REQUIRED_DECISION = "PASS_BLOG_V2_EXTERNAL_CATEGORY_RESEARCH_AND_SOURCE_APPROVAL_V1"
REQUIRED_NEXT = "PASS_EXTERNAL_CATEGORY_RESEARCH_READY_FOR_INGESTION"
REQUIRED_PACK_STATUS = "APPROVED_FOR_KNOWLEDGE_INGESTION"

POLICY_DIRECT = "DIRECT_EDUCATION_ALLOWED"
POLICY_QUALIFIED = "QUALIFIED_EDUCATION_ONLY"

SCOPE_HENNA = "HENNA"
SCOPE_JOJOBA = "JOJOBA"
SCOPE_HAIR_PACK = "HAIR_PACK"
SCOPE_NONE = "NONE"

QUALIFIED_TOPICS = {
    "hair keratin interaction",
    "hair / cosmetic application evidence",
}

PACK_STATUS_TO_RR = {
    "RESEARCHED": "APPROVED_KNOWLEDGE_AVAILABLE",
    "PARTIALLY_RESEARCHED": "PARTIALLY_SUPPORTED",
    "RESEARCHED_NOT_SUPPORTED": "NOT_SUPPORTED",
}

API_DIR = Path(__file__).resolve().parent
REPO_DIR = API_DIR.parent
DEFAULT_SOURCE_DIR = REPO_DIR / "calibration" / "review" / "blog-v2-external-category-research-and-source-approval-v1"
DEFAULT_RUNTIME_DIR = API_DIR / "content_blog_knowledge_artifacts" / "research"

SOURCE_FILES = {
    "decision": "DECISION.json",
    "qa": "RESEARCH_PACK_QA.json",
    "registry": "RESEARCH_SOURCE_REGISTRY_V1.json",
    "henna": "HENNA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1.json",
    "jojoba": "JOJOBA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1.json",
    "hairPack": "HAIR_PACK_STATUS.json",
}


class CategoryIngestError(RuntimeError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}:{message}" if message else code)
        self.code = code
        self.detail = message


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compute_source_hashes(source_dir: Path | None = None) -> dict[str, str]:
    source_dir = source_dir or DEFAULT_SOURCE_DIR
    return {
        "registry": sha256_file(source_dir / SOURCE_FILES["registry"]),
        "henna": sha256_file(source_dir / SOURCE_FILES["henna"]),
        "jojoba": sha256_file(source_dir / SOURCE_FILES["jojoba"]),
        "qa": sha256_file(source_dir / SOURCE_FILES["qa"]),
        "decision": sha256_file(source_dir / SOURCE_FILES["decision"]),
        "hairPack": sha256_file(source_dir / SOURCE_FILES["hairPack"]),
    }


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def validate_approval_gate(source_dir: Path | None = None) -> dict[str, Any]:
    source_dir = source_dir or DEFAULT_SOURCE_DIR
    decision = _load_json(source_dir / SOURCE_FILES["decision"])
    qa = _load_json(source_dir / SOURCE_FILES["qa"])
    henna = _load_json(source_dir / SOURCE_FILES["henna"])
    jojoba = _load_json(source_dir / SOURCE_FILES["jojoba"])
    if _text(decision.get("decision")) != REQUIRED_DECISION:
        raise CategoryIngestError("HOLD_RESEARCH_PACK_NOT_APPROVED", f"decision={decision.get('decision')}")
    next_value = _text(decision.get("next"))
    if REQUIRED_NEXT not in next_value:
        raise CategoryIngestError("HOLD_RESEARCH_PACK_NOT_APPROVED", f"next={decision.get('next')}")
    if qa.get("pass") is not True:
        raise CategoryIngestError("HOLD_RESEARCH_PACK_NOT_APPROVED", "RESEARCH_PACK_QA.pass is not true")
    if _text(henna.get("approvalStatus")) != REQUIRED_PACK_STATUS or _text(jojoba.get("approvalStatus")) != REQUIRED_PACK_STATUS:
        raise CategoryIngestError("HOLD_RESEARCH_PACK_NOT_APPROVED", "pack approvalStatus is not APPROVED_FOR_KNOWLEDGE_INGESTION")
    return {"decision": decision, "qa": qa, "henna": henna, "jojoba": jojoba}


def validate_source_integrity(registry: dict[str, Any], statements: list[dict[str, Any]]) -> None:
    sources = {
        _text(item.get("sourceId"))
        for item in _as_list(registry.get("sources"))
        if isinstance(item, dict) and _text(item.get("sourceId"))
    }
    errors: list[str] = []
    seen: set[str] = set()
    for item in statements:
        kid = _text(item.get("knowledgeId"))
        if not kid:
            errors.append("missing knowledgeId")
            continue
        if kid in seen:
            errors.append(f"duplicate {kid}")
        seen.add(kid)
        refs = [_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)]
        if not refs:
            errors.append(f"{kid} empty sourceRefs")
        for ref in refs:
            if ref not in sources:
                errors.append(f"{kid} unknown sourceRef {ref}")
        locator = item.get("sourceLocation") if isinstance(item.get("sourceLocation"), dict) else {}
        if not any(_text(locator.get(key)) or locator.get(key) not in (None, "", []) for key in ("page", "section", "table", "figure", "paragraph", "locator")):
            if not any(_text(value) for value in locator.values()):
                errors.append(f"{kid} missing sourceLocation")
        boundary = item.get("claimBoundary") if isinstance(item.get("claimBoundary"), dict) else {}
        if boundary.get("canApplyDirectlyToProduct") is True or item.get("usableForProductClaim") is True:
            errors.append(f"{kid} product claim boundary not preserved")
    if errors:
        raise CategoryIngestError("HOLD_SOURCE_REGISTRY_INTEGRITY", "; ".join(errors[:12]))


def resolve_category_scope(product: dict[str, Any] | None = None) -> dict[str, Any]:
    """Canonical product_group first; title fallback is explicit and never uses 헤나 substring for hair-pack."""
    product = product if isinstance(product, dict) else {}
    group = _text(product.get("product_group"))
    title = _text(product.get("title"))
    pack_ctx = group == "herb_pack" or "헤어팩" in title
    if pack_ctx:
        fallback = None if group == "herb_pack" else "title:헤어팩"
        return {
            "scope": SCOPE_HAIR_PACK,
            "packId": None,
            "idPrefix": None,
            "reason": "PRODUCT_INGREDIENT_SOURCE_MISSING",
            "authority": "canonical_product_group" if group == "herb_pack" else "title_fallback",
            "fallback": fallback,
        }
    if group == "henna":
        return {
            "scope": SCOPE_HENNA,
            "packId": "HENNA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1",
            "idPrefix": "CK-HENNA-",
            "reason": "canonical_product_group",
            "authority": "canonical_product_group",
            "fallback": None,
        }
    if "염색약" in title:
        return {
            "scope": SCOPE_HENNA,
            "packId": "HENNA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1",
            "idPrefix": "CK-HENNA-",
            "reason": "title_fallback:염색약",
            "authority": "title_fallback",
            "fallback": "title:염색약",
        }
    if "jojoba" in group.lower() or "호호바" in group:
        return {
            "scope": SCOPE_JOJOBA,
            "packId": "JOJOBA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1",
            "idPrefix": "CK-JOJOBA-",
            "reason": "canonical_product_group",
            "authority": "canonical_product_group",
            "fallback": None,
        }
    if "호호바" in title or "jojoba" in title.lower():
        return {
            "scope": SCOPE_JOJOBA,
            "packId": "JOJOBA_VERIFIED_CATEGORY_KNOWLEDGE_PACK_V1",
            "idPrefix": "CK-JOJOBA-",
            "reason": "title_fallback:호호바/jojoba",
            "authority": "title_fallback",
            "fallback": "title:호호바|jojoba",
        }
    return {
        "scope": SCOPE_NONE,
        "packId": None,
        "idPrefix": None,
        "reason": "NO_CATEGORY_PACK_FOR_PRODUCT",
        "authority": "none",
        "fallback": None,
    }


def product_from_contexts(
    blog_context: dict[str, Any] | None = None,
    base_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    product = dict(_as_dict((base_context or {}).get("product")))
    blog_context = blog_context if isinstance(blog_context, dict) else {}
    for item in _as_list(blog_context.get("productFacts")) + _as_list(blog_context.get("sourceFacts")):
        if not isinstance(item, dict):
            continue
        field = _text((_as_dict(item.get("provenance"))).get("sourceField"))
        statement = _text(item.get("statement"))
        if field == "title" and statement:
            product.setdefault("title", statement.split(":", 1)[-1].strip() if ":" in statement else statement)
        elif field == "product_group" and statement:
            product.setdefault("product_group", statement.split(":", 1)[-1].strip() if ":" in statement else statement)
        elif field == "product_url" and statement:
            product.setdefault("product_url", statement.split(":", 1)[-1].strip() if ":" in statement else statement)
    return product


def knowledge_use_policy_for(item: dict[str, Any]) -> str:
    topic = _text(item.get("topic")).lower()
    if topic in QUALIFIED_TOPICS:
        return POLICY_QUALIFIED
    return POLICY_DIRECT


def normalize_runtime_ck(item: dict[str, Any]) -> dict[str, Any]:
    boundary = dict(_as_dict(item.get("claimBoundary")))
    boundary["canApplyDirectlyToProduct"] = False
    boundary["canClaimProductSuperiority"] = False
    boundary["canClaimConsumerEfficacy"] = False
    boundary["canClaimSafetySuperiority"] = False
    policy = knowledge_use_policy_for(item)
    payload = {
        "knowledgeId": _text(item.get("knowledgeId")),
        "knowledgeClass": "VERIFIED_CATEGORY_KNOWLEDGE",
        "topic": _text(item.get("topic")),
        "statement": _text(item.get("statement")),
        "sourceRefs": [_text(ref) for ref in _as_list(item.get("sourceRefs")) if _text(ref)],
        "sourceLocation": dict(_as_dict(item.get("sourceLocation"))),
        "authorityClass": _text(item.get("authorityClass")),
        "verificationStatus": "VERIFIED",
        "allowedMarketingUses": [_text(item) for item in _as_list(item.get("allowedMarketingUses")) if _text(item)]
        or ["EDUCATION", "EXPLANATION", "PRODUCT_CONTEXT"],
        "claimBoundary": boundary,
        "limitations": [_text(item) for item in _as_list(item.get("limitations")) if _text(item)],
        "usableForCategoryEducation": bool(item.get("usableForCategoryEducation", True)),
        "usableForProductClaim": False,
        "scientificStatement": _text(item.get("scientificStatement") or item.get("statement")),
        "marketingInterpretation": item.get("marketingInterpretation") if isinstance(item.get("marketingInterpretation"), dict) else None,
        "knowledgeUsePolicy": policy,
        "qualificationRequired": policy == POLICY_QUALIFIED,
        "sourceDomain": "CATEGORY_KNOWLEDGE",
        "readerFacing": True,
        "readerFacingDefensiveMeta": False,
    }
    return payload


def _map_research_requests(pack: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in _as_list(pack.get("researchRequests")):
        if not isinstance(item, dict):
            continue
        pack_status = _text(item.get("status") or item.get("coverage"))
        out.append(
            {
                "requestId": _text(item.get("requestId")),
                "topic": _text(item.get("topic")),
                "domain": "CATEGORY",
                "status": PACK_STATUS_TO_RR.get(pack_status, pack_status or "NOT_RESEARCHED"),
                "coverageStatus": pack_status,
                "knowledgeRefs": [_text(ref) for ref in _as_list(item.get("knowledgeIds") or item.get("knowledgeRefs")) if _text(ref)],
                "notes": _text(item.get("notes")),
                "executed": False,
                "llmCalls": 0,
                "externalNetwork": 0,
                "readerFacing": False,
            }
        )
    return out


def ingest_approved_category_knowledge(
    *,
    source_dir: Path | None = None,
    runtime_dir: Path | None = None,
    expected_hashes: dict[str, str] | None = None,
    allow_repromote: bool = False,
) -> dict[str, Any]:
    """Deterministic promotion. Does not read calibration at blog-generation time."""
    source_dir = Path(source_dir or DEFAULT_SOURCE_DIR)
    runtime_dir = Path(runtime_dir or DEFAULT_RUNTIME_DIR)
    gate = validate_approval_gate(source_dir)
    hashes = compute_source_hashes(source_dir)
    if expected_hashes:
        for key, expected in expected_hashes.items():
            if hashes.get(key) != expected:
                raise CategoryIngestError("SOURCE_PACK_HASH_MISMATCH", f"{key} hash mismatch")
    existing_manifest_path = runtime_dir / "APPROVED_CATEGORY_KNOWLEDGE_MANIFEST_V1.json"
    if existing_manifest_path.exists() and not allow_repromote:
        existing = _load_json(existing_manifest_path)
        previous = _as_dict(existing.get("sourceHashes"))
        comparable = {key: hashes.get(key) for key in ("registry", "henna", "jojoba", "qa")}
        previous_cmp = {key: previous.get(key) for key in ("registry", "henna", "jojoba", "qa")}
        if previous_cmp != comparable and any(previous_cmp.values()):
            raise CategoryIngestError("SOURCE_PACK_HASH_MISMATCH", "runtime knowledge does not auto-sync from changed research packs")

    registry = _load_json(source_dir / SOURCE_FILES["registry"])
    henna = gate["henna"]
    jojoba = gate["jojoba"]
    henna_ck = [normalize_runtime_ck(item) for item in _as_list(henna.get("knowledgeStatements")) if isinstance(item, dict)]
    jojoba_ck = [normalize_runtime_ck(item) for item in _as_list(jojoba.get("knowledgeStatements")) if isinstance(item, dict)]
    all_ck = henna_ck + jojoba_ck
    validate_source_integrity(registry, all_ck)
    for item in henna_ck:
        if not item["knowledgeId"].startswith("CK-HENNA-"):
            raise CategoryIngestError("HOLD_SOURCE_REGISTRY_INTEGRITY", f"henna id rewritten {item['knowledgeId']}")
    for item in jojoba_ck:
        if not item["knowledgeId"].startswith("CK-JOJOBA-"):
            raise CategoryIngestError("HOLD_SOURCE_REGISTRY_INTEGRITY", f"jojoba id rewritten {item['knowledgeId']}")

    runtime_dir.mkdir(parents=True, exist_ok=True)
    for key in ("registry", "henna", "jojoba", "hairPack"):
        shutil.copyfile(source_dir / SOURCE_FILES[key], runtime_dir / SOURCE_FILES[key])

    index = {
        "version": "runtime_category_knowledge_index_v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "llmCalls": 0,
        "externalNetwork": 0,
        "silentAutoSync": False,
        "henna": {
            "packId": henna.get("packId"),
            "statements": henna_ck,
            "researchRequests": _map_research_requests(henna),
            "questionCoverage": henna.get("questionCoverage") or {},
            "conflictingEvidence": henna.get("conflictingEvidence") or [],
            "unsupportedQuestions": henna.get("unsupportedQuestions") or [],
            "knownLimitations": _as_list(_as_dict(henna.get("sections")).get("Known Limitations")),
        },
        "jojoba": {
            "packId": jojoba.get("packId"),
            "statements": jojoba_ck,
            "researchRequests": _map_research_requests(jojoba),
            "questionCoverage": jojoba.get("questionCoverage") or {},
            "conflictingEvidence": jojoba.get("conflictingEvidence") or [],
            "unsupportedQuestions": jojoba.get("unsupportedQuestions") or [],
            "knownLimitations": _as_list(_as_dict(jojoba.get("sections")).get("Known Limitations")),
        },
        "hairPack": _load_json(source_dir / SOURCE_FILES["hairPack"]),
    }
    manifest = {
        "version": INGEST_VERSION,
        "sourceDecision": REQUIRED_DECISION,
        "sourceNext": _text(gate["decision"].get("next")),
        "sourcePack": str(source_dir.as_posix()),
        "sourceHashes": hashes,
        "ingestedKnowledgeIds": [item["knowledgeId"] for item in all_ck],
        "ingestedSourceIds": [
            _text(item.get("sourceId")) for item in _as_list(registry.get("sources")) if _text(item.get("sourceId"))
        ],
        "hennaCount": len(henna_ck),
        "jojobaCount": len(jojoba_ck),
        "sourceCount": len(_as_list(registry.get("sources"))),
        "directEducationIds": [item["knowledgeId"] for item in all_ck if item["knowledgeUsePolicy"] == POLICY_DIRECT],
        "qualifiedEducationIds": [item["knowledgeId"] for item in all_ck if item["knowledgeUsePolicy"] == POLICY_QUALIFIED],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "llmCalls": 0,
        "externalNetwork": 0,
        "silentAutoSync": False,
        "ingestedToRuntime": True,
        "calibrationPathNotReadAtGeneration": True,
    }
    _dump_json(runtime_dir / "RUNTIME_CATEGORY_KNOWLEDGE_INDEX_V1.json", index)
    _dump_json(runtime_dir / "APPROVED_CATEGORY_KNOWLEDGE_MANIFEST_V1.json", manifest)
    return manifest


def load_runtime_index(runtime_dir: Path | None = None) -> dict[str, Any]:
    runtime_dir = Path(runtime_dir or DEFAULT_RUNTIME_DIR)
    path = runtime_dir / "RUNTIME_CATEGORY_KNOWLEDGE_INDEX_V1.json"
    if not path.exists():
        return {}
    payload = _load_json(path)
    return payload if isinstance(payload, dict) else {}


def load_runtime_manifest(runtime_dir: Path | None = None) -> dict[str, Any]:
    runtime_dir = Path(runtime_dir or DEFAULT_RUNTIME_DIR)
    path = runtime_dir / "APPROVED_CATEGORY_KNOWLEDGE_MANIFEST_V1.json"
    if not path.exists():
        return {}
    payload = _load_json(path)
    return payload if isinstance(payload, dict) else {}


def load_category_knowledge_for_product(
    product: dict[str, Any] | None = None,
    *,
    runtime_dir: Path | None = None,
) -> dict[str, Any]:
    """Generation-time loader. Reads runtime artifacts only. LLM = 0. Network = 0."""
    scope = resolve_category_scope(product)
    empty = {
        "scope": scope,
        "statements": [],
        "researchRequests": [],
        "questionCoverage": {},
        "conflictingEvidence": [],
        "unsupportedQuestions": [],
        "knownLimitations": [],
        "llmCalls": 0,
        "externalNetwork": 0,
    }
    if scope["scope"] in {SCOPE_HAIR_PACK, SCOPE_NONE}:
        return empty
    index = load_runtime_index(runtime_dir)
    pack_key = "henna" if scope["scope"] == SCOPE_HENNA else "jojoba"
    pack = _as_dict(index.get(pack_key))
    statements = [dict(item) for item in _as_list(pack.get("statements")) if isinstance(item, dict)]
    prefix = scope.get("idPrefix")
    if prefix:
        leaked = [item for item in statements if not _text(item.get("knowledgeId")).startswith(str(prefix))]
        statements = [item for item in statements if _text(item.get("knowledgeId")).startswith(str(prefix))]
        if leaked:
            empty["crossPackLeakBlocked"] = [item.get("knowledgeId") for item in leaked]
    return {
        "scope": scope,
        "statements": statements,
        "researchRequests": [dict(item) for item in _as_list(pack.get("researchRequests")) if isinstance(item, dict)],
        "questionCoverage": dict(_as_dict(pack.get("questionCoverage"))),
        "conflictingEvidence": list(_as_list(pack.get("conflictingEvidence"))),
        "unsupportedQuestions": list(_as_list(pack.get("unsupportedQuestions"))),
        "knownLimitations": list(_as_list(pack.get("knownLimitations"))),
        "llmCalls": 0,
        "externalNetwork": 0,
    }


def planner_category_catalog(statements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in statements:
        if not isinstance(item, dict) or not _text(item.get("knowledgeId")):
            continue
        out.append(
            {
                "knowledgeId": item.get("knowledgeId"),
                "statement": item.get("statement"),
                "topic": item.get("topic"),
                "allowedMarketingUses": item.get("allowedMarketingUses") or [],
                "claimBoundary": item.get("claimBoundary") or {},
                "limitations": item.get("limitations") or [],
                "knowledgeUsePolicy": item.get("knowledgeUsePolicy") or POLICY_DIRECT,
                "qualificationRequired": bool(item.get("qualificationRequired")),
                "usableForCategoryEducation": bool(item.get("usableForCategoryEducation", True)),
                "usableForProductClaim": False,
            }
        )
    return out


if __name__ == "__main__":
    result = ingest_approved_category_knowledge(allow_repromote=True)
    print(json.dumps({"ingested": True, "hennaCount": result["hennaCount"], "jojobaCount": result["jojobaCount"], "sourceCount": result["sourceCount"]}, ensure_ascii=False))
