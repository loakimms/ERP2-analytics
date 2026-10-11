from __future__ import annotations

import hashlib
from typing import Any

from content_center_engine import _classify_evidence_item, match_theme, theme_def
from content_blog_knowledge_library import AUTHORITY_REVIEW_CORPUS, stable_id
from db import NaverReviewRaw

PATTERN_LIBRARY_VERSION = "BLOG_CUSTOMER_EXPERIENCE_PATTERN_LIBRARY_V1"
OVERCLAIM_TERMS = ("대부분", "압도적", "많은 고객", "거의 모든 고객", "90%", "효과가 있었다")


def product_url_aliases(product: dict[str, Any]) -> list[str]:
    url = str(product.get("product_url") or product.get("sku_id") or "").strip()
    sku = str(product.get("sku_id") or "").strip()
    aliases = {item for item in (url, sku) if item}
    for item in list(aliases):
        digits = "".join(ch for ch in item.split("/")[-1] if ch.isdigit())
        if digits:
            aliases.add(f"https://smartstore.naver.com/thesujata/products/{digits}")
            aliases.add(f"smartstore-review-upload://product/{digits}")
    pid = product.get("product_id_catalog")
    if pid not in (None, ""):
        aliases.add(f"https://smartstore.naver.com/thesujata/products/{pid}")
        aliases.add(f"smartstore-review-upload://product/{pid}")
    return sorted(aliases)


def canonical_review_identity(row: NaverReviewRaw) -> str:
    original = str(row.review_id_original or "").strip()
    if original:
        return f"orig:{original}"
    text_hash = str(row.text_hash or "").strip()
    if text_hash:
        return f"hash:{text_hash}"
    return f"key:{row.review_key}"


def build_review_corpus_profile(db: Any, *, product: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
    """Full-corpus accounting. Does not put raw reviews into the Planner prompt."""
    aliases = product_url_aliases(product)
    rows: list[NaverReviewRaw] = []
    if db is not None and aliases:
        rows = db.query(NaverReviewRaw).filter(NaverReviewRaw.product_url.in_(aliases)).all()
    raw_rows = len(rows)
    by_identity: dict[str, NaverReviewRaw] = {}
    duplicate_rows = 0
    empty_excluded = 0
    for row in sorted(rows, key=lambda item: str(item.review_key)):
        identity = canonical_review_identity(row)
        if identity in by_identity:
            duplicate_rows += 1
            continue
        by_identity[identity] = row
    unique_reviews = []
    for identity, row in by_identity.items():
        text = " ".join(str(row.review_text or "").split()).strip()
        if not text:
            empty_excluded += 1
            continue
        unique_reviews.append({"identity": identity, "review_key": row.review_key, "text": text, "option_text": row.option_text, "rating": row.rating})
    processed = len(unique_reviews)
    excluded = duplicate_rows + empty_excluded
    profile = {
        "version": PATTERN_LIBRARY_VERSION,
        "productRef": aliases[0] if aliases else str(product.get("sku_id") or ""),
        "urlAliases": aliases,
        "identityFields": ["review_id_original", "text_hash", "review_key"],
        "rawRows": raw_rows,
        "sourceCorpusCount": raw_rows,
        "uniqueReviews": processed + empty_excluded,
        "duplicateRows": duplicate_rows,
        "processedCount": processed,
        "excludedCount": excluded,
        "accountingOk": processed + excluded == raw_rows,
        "llmCalls": 0,
    }
    patterns = _build_patterns(unique_reviews, evidence=evidence, product_ref=profile["productRef"])
    return {"reviewCorpusProfile": profile, "experiencePatterns": patterns, "processedReviews": unique_reviews}


def _build_patterns(reviews: list[dict[str, Any]], *, evidence: list[dict[str, Any]], product_ref: str) -> list[dict[str, Any]]:
    corpus_n = len(reviews)
    buckets: dict[str, list[dict[str, Any]]] = {}
    for item in reviews:
        theme = match_theme(item["text"]) or "unthemed"
        klass = _classify_evidence_item({"snippet": item["text"], "source_type": "review"})
        key = f"{theme}|{klass}"
        buckets.setdefault(key, []).append(item)
    evidence_by_pk: dict[str, str] = {}
    evidence_by_snippet: dict[str, str] = {}
    for item in evidence:
        if not isinstance(item, dict):
            continue
        ev_id = str(item.get("evidenceId") or item.get("sourcePk") or "")
        pk = str(item.get("sourcePk") or "")
        snippet = str(item.get("statement") or "")
        if pk and ev_id:
            evidence_by_pk[pk] = ev_id
        if snippet and ev_id:
            evidence_by_snippet[snippet[:80]] = ev_id
    out: list[dict[str, Any]] = []
    for key, matched in sorted(buckets.items()):
        theme_key, klass = key.split("|", 1)
        theme = theme_def(theme_key) if theme_key != "unthemed" else {"key": "unthemed", "label": "unthemed_review_text"}
        reps = []
        for item in sorted(matched, key=lambda row: str(row["review_key"])):
            ev_id = evidence_by_pk.get(str(item["review_key"]))
            if not ev_id:
                ev_id = evidence_by_snippet.get(str(item["text"])[:80])
            if ev_id and ev_id not in reps:
                reps.append(ev_id)
            if len(reps) >= 3:
                break
        pattern_id = stable_id("XP", f"{product_ref}|{key}")
        label = f"{theme.get('label')}:{klass}"
        interpretation = (
            f"리뷰 원문 텍스트에서 '{label}' 분류에 해당하는 언급이 {len(matched)}건 있다. "
            "이는 리뷰 텍스트 출현 횟수이며 효능 비율이 아니다."
        )
        out.append(
            {
                "patternId": pattern_id,
                "productRef": product_ref,
                "label": label,
                "themeKey": theme.get("key"),
                "evidenceClass": klass,
                "interpretation": interpretation,
                "support": {
                    "matchedReviewCount": len(matched),
                    "corpusReviewCount": corpus_n,
                    "representativeEvidenceRefs": reps,
                },
                "sourceAuthority": AUTHORITY_REVIEW_CORPUS,
                "claimBoundary": "CUSTOMER_EXPERIENCE_PATTERN",
                "patternType": "CORPUS_DERIVED_PATTERN",
                "readerFacing": False,
                "provenance": {
                    "libraryVersion": PATTERN_LIBRARY_VERSION,
                    "llmCalls": 0,
                    "notEfficacyRate": True,
                    "notPopulationClaim": True,
                },
            }
        )
    return out


def planner_pattern_payload(patterns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compact catalog for Planner. No raw corpus texts."""
    out = []
    for item in patterns:
        support = item.get("support") if isinstance(item.get("support"), dict) else {}
        out.append(
            {
                "patternId": item.get("patternId"),
                "label": item.get("label"),
                "interpretation": item.get("interpretation"),
                "matchedReviewCount": support.get("matchedReviewCount"),
                "corpusReviewCount": support.get("corpusReviewCount"),
                "representativeEvidenceRefs": support.get("representativeEvidenceRefs") or [],
                "claimBoundary": item.get("claimBoundary"),
                "patternType": item.get("patternType"),
            }
        )
    return out


def pattern_has_overclaim(text: str) -> bool:
    blob = str(text or "")
    return any(term in blob for term in OVERCLAIM_TERMS)


def pattern_id_digest(pattern_id: str) -> str:
    return hashlib.sha1(pattern_id.encode("utf-8")).hexdigest()
