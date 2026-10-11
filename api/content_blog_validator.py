from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from content_blog_context import blog_v2_known_limitations
from content_blog_planner import CTA_TYPES, RESTRICTED_BYPASS_HINTS, STATUS_PASS, _catalogs
from content_blog_profiles import (
    AUTHORITY_PROJECT,
    AUTHORITY_REFERENCE,
    FORBIDDEN_SCORE_KEYS,
    PROFILE_VERSION,
    find_phrase_hits,
    max_consecutive_phrase_repeats,
    resolve_blog_quality_profile,
    sentence_ending_token,
    split_visible_sentences,
)
from content_blog_writer import (
    CODE_FAKE_EXPERIENCE,
    CODE_GENERAL_KNOWLEDGE_LEAKAGE,
    CODE_INVALID_SOURCE_REFERENCE,
    CODE_PLANNER_STRUCTURE_VIOLATION,
    CODE_RESTRICTED_CLAIM_LEAKAGE,
    STATUS_HOLD,
    validate_blog_professional_draft,
    visible_blog_draft_text,
)
from content_center_engine import claim_gate_text


VALIDATOR_VERSION = "blog_quality_validator_v1"
REPORT_VERSION = "blog_quality_report_v1"
VALIDATION_MODE = "DETERMINISTIC_RULE_BASED"

STATUS_WARNING = "WARNING"
STATUS_FAIL = "FAIL"
STATUS_NOT_APPLICABLE = "NOT_APPLICABLE"

OUTCOME_PASS = "QUALITY_VALIDATION_PASS"
OUTCOME_HOLD = "QUALITY_VALIDATION_HOLD"
OUTCOME_WRITER_CONTRACT_HOLD = "WRITER_CONTRACT_HOLD"

CHECK_KEYS = (
    "writerContractIntegrity",
    "factIntegrity",
    "sourceCoverage",
    "claimSafety",
    "experienceIntegrity",
    "intentCoverage",
    "contentStructure",
    "readability",
    "languageNaturalness",
    "clicheDetection",
    "repetitionDetection",
    "keywordNaturalness",
    "titleGuideline",
    "bodyGuideline",
    "faqQuality",
    "ctaQuality",
    "imageReadiness",
    "internalLinkReadiness",
    "commercialDisclosure",
)

SPECIAL_CHAR_RE = re.compile(r"[!@#$%^&*_=+|\\/<>~`]")


def serialize_blog_quality_report(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, sort_keys=True)


def validate_blog_quality(
    db: Session | None = None,
    *,
    blog_context: dict[str, Any],
    intent_analysis: dict[str, Any] | None = None,
    content_plan: dict[str, Any] | None = None,
    planner_result: dict[str, Any] | None = None,
    draft: dict[str, Any] | None = None,
    writer_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    intent, plan = _resolve_inputs(intent_analysis, content_plan, planner_result)
    source_draft = draft if isinstance(draft, dict) else (writer_result or {}).get("draft")
    if not isinstance(source_draft, dict):
        raise ValueError("BlogProfessionalDraft is required")
    snapshot = copy.deepcopy(source_draft)
    profile = resolve_blog_quality_profile(intent)
    catalogs = _catalogs(blog_context)
    contract = writer_result if _usable_writer_result(writer_result, snapshot) else validate_blog_professional_draft(
        blog_context,
        intent,
        plan,
        copy.deepcopy(snapshot),
        catalogs=catalogs,
    )
    limitations = [dict(item) for item in blog_v2_known_limitations()]
    if contract.get("status") != STATUS_PASS:
        report = _contract_hold_report(snapshot, contract, intent, profile, limitations)
        _assert_no_scores(report)
        return report
    report = _quality_report(db, snapshot, blog_context, intent, plan, catalogs, profile, limitations)
    _assert_no_scores(report)
    if snapshot != source_draft:
        raise RuntimeError("quality validator mutated the input draft")
    return report


def _usable_writer_result(writer_result: dict[str, Any] | None, snapshot: dict[str, Any]) -> bool:
    if not isinstance(writer_result, dict) or writer_result.get("status") != STATUS_PASS:
        return False
    accepted = writer_result.get("draft")
    return isinstance(accepted, dict) and accepted == snapshot


def _resolve_inputs(
    intent_analysis: dict[str, Any] | None,
    content_plan: dict[str, Any] | None,
    planner_result: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if isinstance(planner_result, dict):
        intent_analysis = planner_result.get("intentAnalysis") if isinstance(planner_result.get("intentAnalysis"), dict) else intent_analysis
        content_plan = planner_result.get("contentPlan") if isinstance(planner_result.get("contentPlan"), dict) else content_plan
    if not isinstance(intent_analysis, dict) or not isinstance(content_plan, dict):
        raise ValueError("BlogIntentAnalysis and BlogContentPlan are required")
    return intent_analysis, content_plan


def _quality_report(
    db: Session | None,
    draft: dict[str, Any],
    blog_context: dict[str, Any],
    intent: dict[str, Any],
    plan: dict[str, Any],
    catalogs: dict[str, Any],
    profile: dict[str, Any],
    limitations: list[dict[str, Any]],
) -> dict[str, Any]:
    public = visible_blog_draft_text(draft)
    metrics = _metrics(draft, public, intent, profile)
    issues: list[dict[str, Any]] = []
    checks = {key: _check(STATUS_PASS) for key in CHECK_KEYS}
    checks["writerContractIntegrity"] = _check(STATUS_PASS, detail="PHASE_4_CONTRACT_REUSED")
    _apply_fact_integrity(checks, issues, draft, catalogs)
    _apply_source_coverage(checks, issues, draft, plan)
    _apply_claim_safety(checks, issues, db, public, catalogs)
    _apply_experience_integrity(checks, issues, public, profile)
    _apply_intent_coverage(checks, issues, draft, plan)
    _apply_content_structure(checks, issues, draft, plan, profile)
    _apply_readability(checks, issues, draft, profile)
    _apply_language_naturalness(checks, issues, public, profile)
    _apply_cliche(checks, issues, public, profile)
    _apply_repetition(checks, issues, draft, public, profile)
    _apply_keyword(checks, issues, public, intent, profile, metrics)
    _apply_title(checks, issues, draft, profile, metrics)
    _apply_body(checks, issues, draft, catalogs, profile, metrics)
    _apply_faq(checks, issues, draft, plan)
    _apply_cta(checks, issues, draft, plan, profile)
    _apply_image(checks, issues, draft, plan)
    _apply_internal_links(checks, issues, blog_context)
    _apply_disclosure(checks, issues, draft, blog_context, public)
    return _finalize(draft, checks, issues, metrics, profile, limitations, writer_contract_status=STATUS_PASS, outcome=None)


def _contract_hold_report(
    draft: dict[str, Any],
    contract: dict[str, Any],
    intent: dict[str, Any],
    profile: dict[str, Any],
    limitations: list[dict[str, Any]],
) -> dict[str, Any]:
    issues = [_contract_issue(item) for item in _as_list(contract.get("issues"))]
    checks = {key: _check(STATUS_NOT_APPLICABLE, detail="SKIPPED_WRITER_CONTRACT_HOLD") for key in CHECK_KEYS}
    checks["writerContractIntegrity"] = _check(STATUS_FAIL, codes=[str(contract.get("code") or "WRITER_OUTPUT_REJECTED")])
    codes = {str(item.get("code") or "") for item in issues}
    if CODE_RESTRICTED_CLAIM_LEAKAGE in codes:
        checks["claimSafety"] = _check(STATUS_FAIL, codes=[CODE_RESTRICTED_CLAIM_LEAKAGE])
    if CODE_FAKE_EXPERIENCE in codes:
        checks["experienceIntegrity"] = _check(STATUS_FAIL, codes=[CODE_FAKE_EXPERIENCE])
    if CODE_INVALID_SOURCE_REFERENCE in codes or CODE_GENERAL_KNOWLEDGE_LEAKAGE in codes:
        mapped = [code for code in (CODE_INVALID_SOURCE_REFERENCE, CODE_GENERAL_KNOWLEDGE_LEAKAGE) if code in codes]
        checks["factIntegrity"] = _check(STATUS_FAIL, codes=mapped)
    if CODE_PLANNER_STRUCTURE_VIOLATION in codes:
        checks["contentStructure"] = _check(STATUS_FAIL, codes=[CODE_PLANNER_STRUCTURE_VIOLATION])
    public = visible_blog_draft_text(draft)
    metrics = _metrics(draft, public, intent, profile)
    return _finalize(
        draft,
        checks,
        issues,
        metrics,
        profile,
        limitations,
        writer_contract_status=STATUS_HOLD,
        outcome=OUTCOME_WRITER_CONTRACT_HOLD,
    )


def _finalize(
    draft: dict[str, Any],
    checks: dict[str, Any],
    issues: list[dict[str, Any]],
    metrics: dict[str, Any],
    profile: dict[str, Any],
    limitations: list[dict[str, Any]],
    *,
    writer_contract_status: str,
    outcome: str | None,
) -> dict[str, Any]:
    fail = any(item.get("status") == STATUS_FAIL for item in checks.values()) or any(item.get("status") == STATUS_FAIL for item in issues)
    warn = (not fail) and (
        any(item.get("status") == STATUS_WARNING for item in checks.values())
        or any(item.get("status") == STATUS_WARNING for item in issues)
    )
    quality_status = STATUS_FAIL if fail else (STATUS_WARNING if warn else STATUS_PASS)
    gate = STATUS_HOLD if fail else STATUS_PASS
    if outcome is None:
        outcome = OUTCOME_HOLD if gate == STATUS_HOLD else OUTCOME_PASS
    return {
        "version": REPORT_VERSION,
        "gateDecision": gate,
        "qualityStatus": quality_status,
        "outcome": outcome,
        "writerContractStatus": writer_contract_status,
        "checks": checks,
        "metrics": metrics,
        "issues": issues,
        "limitations": limitations,
        "guidelineProfile": {
            "profileVersion": profile.get("profileVersion") or PROFILE_VERSION,
            "profileId": profile.get("profileId"),
            "authority": profile.get("authority") or AUTHORITY_REFERENCE,
            "category": profile.get("category"),
            "categoryClassification": profile.get("categoryClassification") or "PLANNING_INFERENCE",
            "fallbackFrom": profile.get("fallbackFrom"),
            "title": profile.get("title"),
            "body": profile.get("body"),
            "paragraph": profile.get("paragraph"),
            "keyword": profile.get("keyword"),
            "sections": profile.get("sections"),
            "faq": profile.get("faq"),
        },
        "validatorProvenance": {
            "validatorVersion": VALIDATOR_VERSION,
            "generationVersion": "blog_v2",
            "contextVersion": "blog_generation_context_v1",
            "plannerVersion": "blog_content_plan_v1",
            "writerVersion": str((draft.get("writerProvenance") or {}).get("writerVersion") or "blog_professional_writer_v1"),
            "profileVersion": PROFILE_VERSION,
            "validationMode": VALIDATION_MODE,
            "validatedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


def _check(status: str, *, codes: list[str] | None = None, detail: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"status": status}
    if codes:
        item["codes"] = codes
    if detail:
        item["detail"] = detail
    return item


def _set_check(checks: dict[str, Any], name: str, status: str, code: str | None = None) -> None:
    current = checks[name]
    rank = {STATUS_PASS: 0, STATUS_NOT_APPLICABLE: 0, STATUS_WARNING: 1, STATUS_FAIL: 2}
    if rank.get(status, 0) < rank.get(current.get("status"), 0):
        return
    codes = list(current.get("codes") or [])
    if code and code not in codes:
        codes.append(code)
    checks[name] = _check(status, codes=codes or None, detail=current.get("detail"))


def _issue(
    code: str,
    status: str,
    message: str,
    *,
    scope: str = "DRAFT",
    observed: Any = None,
    reference: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {"code": code, "status": status, "scope": scope, "message": message}
    if observed is not None:
        item["observed"] = observed
    if reference:
        item["reference"] = reference
    return item


def _contract_issue(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": str(item.get("code") or "WRITER_OUTPUT_REJECTED"),
        "status": STATUS_FAIL,
        "scope": str(item.get("sectionId") or item.get("scope") or "DRAFT"),
        "message": str(item.get("message") or "Writer contract failed."),
        "observed": item.get("ref") or item.get("term") or item.get("phrase"),
    }


def _guideline_ref(section: dict[str, Any]) -> dict[str, Any]:
    return {
        "preferredMin": section.get("preferredMin") or section.get("preferredMinCount") or section.get("preferredTarget"),
        "preferredMax": section.get("preferredMax") or section.get("preferredMaxCount") or section.get("warningMax") or section.get("densityMax"),
        "authority": section.get("authority") or AUTHORITY_REFERENCE,
    }


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split()).strip()


def _visible_char_count(text: str) -> int:
    return len("".join(str(text or "").split()))


def _metrics(draft: dict[str, Any], public: str, intent: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    keyword = _primary_keyword(intent)
    paragraphs = [paragraph for section in _as_list(draft.get("sections")) for paragraph in _as_list(section.get("paragraphs"))]
    exact = public.count(keyword) if keyword else 0
    visible = _visible_char_count(public)
    density = (exact * len(keyword) / visible) if keyword and visible else 0.0
    heading_blob = " ".join(_text(section.get("heading")) for section in _as_list(draft.get("sections")))
    return {
        "visibleCharacterCount": visible,
        "titleCharacterCount": len(_text(draft.get("selectedTitle"))),
        "sectionCount": len(_as_list(draft.get("sections"))),
        "paragraphCount": len(paragraphs),
        "faqCount": len(_as_list(draft.get("faq"))),
        "primaryKeywordExactCount": exact,
        "primaryKeywordDensity": round(density, 4),
        "headingKeywordCount": heading_blob.count(keyword) if keyword else 0,
        "longestParagraphCharacters": max((_visible_char_count(item) for item in paragraphs), default=0),
        "clicheCount": len(find_phrase_hits(public, profile.get("cliches", {}).get("phrases") or [])),
        "duplicateSentenceCount": _duplicate_sentence_count(public),
    }


def _primary_keyword(intent: dict[str, Any]) -> str:
    plan = intent.get("keywordPlan") if isinstance(intent.get("keywordPlan"), dict) else {}
    return _text(plan.get("primaryKeyword"))


def _duplicate_sentence_count(public: str) -> int:
    counts: dict[str, int] = {}
    for sentence in split_visible_sentences(public):
        key = _text(sentence)
        if key:
            counts[key] = counts.get(key, 0) + 1
    return sum(value - 1 for value in counts.values() if value > 1)


def _apply_fact_integrity(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], catalogs: dict[str, Any]) -> None:
    usage = draft.get("sourceUsage") if isinstance(draft.get("sourceUsage"), dict) else {}
    if usage.get("unsupportedFactGenerated") is True:
        issues.append(_issue("UNSUPPORTED_FACT_GENERATED", STATUS_FAIL, "Writer marked unsupported fact generation.", scope="SOURCE"))
        _set_check(checks, "factIntegrity", STATUS_FAIL, "UNSUPPORTED_FACT_GENERATED")
        return
    valid_facts = set(catalogs["factById"].keys()) | set(catalogs["sourceRefs"])
    valid_evidence = set(catalogs["evidenceIds"]) | set(catalogs["sourceRefs"])
    for ref in _as_list(usage.get("factsUsed")):
        if ref not in valid_facts:
            issues.append(_issue("INVALID_SOURCE_REFERENCE", STATUS_FAIL, "factsUsed contains an unknown source fact.", scope="SOURCE", observed=ref))
            _set_check(checks, "factIntegrity", STATUS_FAIL, CODE_INVALID_SOURCE_REFERENCE)
            return
    for ref in _as_list(usage.get("evidenceUsed")):
        if ref not in valid_evidence:
            issues.append(_issue("INVALID_SOURCE_REFERENCE", STATUS_FAIL, "evidenceUsed contains unknown evidence.", scope="SOURCE", observed=ref))
            _set_check(checks, "factIntegrity", STATUS_FAIL, CODE_INVALID_SOURCE_REFERENCE)
            return
    _set_check(checks, "factIntegrity", STATUS_PASS)


def _apply_source_coverage(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], plan: dict[str, Any]) -> None:
    usage = draft.get("sourceUsage") if isinstance(draft.get("sourceUsage"), dict) else {}
    unused = [_text(item) for item in _as_list(usage.get("unusedPlannedFacts")) if _text(item)]
    planned = []
    for section in _as_list(plan.get("sections")):
        for item in _as_list(section.get("factsToUse")):
            fact_id = _text(item.get("factId") if isinstance(item, dict) else item)
            if fact_id and fact_id not in planned:
                planned.append(fact_id)
    if not planned:
        checks["sourceCoverage"] = _check(STATUS_NOT_APPLICABLE, detail="NO_PLANNED_FACTS")
        return
    if unused:
        issues.append(
            _issue(
                "UNUSED_PLANNED_FACTS",
                STATUS_WARNING,
                "Planner가 배치한 Fact 중 일부가 Writer에서 사용되지 않았습니다.",
                scope="SOURCE",
                observed=unused,
            )
        )
        _set_check(checks, "sourceCoverage", STATUS_WARNING, "UNUSED_PLANNED_FACTS")
        return
    _set_check(checks, "sourceCoverage", STATUS_PASS)


def _apply_claim_safety(
    checks: dict[str, Any],
    issues: list[dict[str, Any]],
    db: Session | None,
    public: str,
    catalogs: dict[str, Any],
) -> None:
    hits = []
    for term in catalogs["restrictedTerms"]:
        if term and term in public:
            hits.append(term)
    for hint in RESTRICTED_BYPASS_HINTS:
        if hint in public and hint not in hits:
            hits.append(hint)
    if db is not None:
        gate = claim_gate_text(db, public)
        if not gate.get("allowed"):
            for hit in _as_list(gate.get("hits")):
                pattern = _text(hit.get("pattern"))
                if pattern and pattern not in hits:
                    hits.append(pattern)
    if hits:
        issues.append(
            _issue(
                CODE_RESTRICTED_CLAIM_LEAKAGE,
                STATUS_FAIL,
                "기존 claim policy에서 금지한 표현이 생성 결과에 포함되었습니다.",
                scope="BODY",
                observed=hits,
            )
        )
        _set_check(checks, "claimSafety", STATUS_FAIL, CODE_RESTRICTED_CLAIM_LEAKAGE)
        return
    _set_check(checks, "claimSafety", STATUS_PASS)


def _apply_experience_integrity(checks: dict[str, Any], issues: list[dict[str, Any]], public: str, profile: dict[str, Any]) -> None:
    phrases = tuple(profile.get("fakeExperience", {}).get("phrases") or [])
    hits = find_phrase_hits(public, phrases)
    if hits:
        issues.append(
            _issue(
                CODE_FAKE_EXPERIENCE,
                STATUS_FAIL,
                "확인된 경험 source 없이 1인칭 사용 경험이 생성되었습니다.",
                scope="BODY",
                observed=hits,
            )
        )
        _set_check(checks, "experienceIntegrity", STATUS_FAIL, CODE_FAKE_EXPERIENCE)
        return
    _set_check(checks, "experienceIntegrity", STATUS_PASS)


def _apply_intent_coverage(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], plan: dict[str, Any]) -> None:
    coverage = plan.get("coverage") if isinstance(plan.get("coverage"), dict) else {}
    questions = [item for item in _as_list(coverage.get("readerQuestions")) if isinstance(item, dict)]
    if not questions:
        checks["intentCoverage"] = _check(STATUS_NOT_APPLICABLE, detail="NO_READER_QUESTIONS")
        return
    sections = {str(item.get("sectionId")): item for item in _as_list(draft.get("sections")) if isinstance(item, dict)}
    missing = False
    empty = False
    for item in questions:
        if _text(item.get("status")).upper() != "COVERED":
            continue
        covered_by = [_text(section_id) for section_id in _as_list(item.get("coveredBy")) if _text(section_id)]
        if not covered_by:
            missing = True
            continue
        for section_id in covered_by:
            section = sections.get(section_id)
            if section is None:
                missing = True
                continue
            if not _as_list(section.get("paragraphs")):
                empty = True
    if empty:
        issues.append(_issue("PLANNED_INTENT_CONTENT_MISSING", STATUS_FAIL, "Planner가 COVERED로 표시한 섹션 본문이 비어 있습니다.", scope="STRUCTURE"))
        _set_check(checks, "intentCoverage", STATUS_FAIL, "PLANNED_INTENT_CONTENT_MISSING")
        return
    if missing:
        issues.append(_issue("INTENT_COVERAGE_GAP", STATUS_WARNING, "Planner coverage의 일부 질문이 Writer 결과에 약하게 반영되었습니다.", scope="STRUCTURE"))
        _set_check(checks, "intentCoverage", STATUS_WARNING, "INTENT_COVERAGE_GAP")
        return
    _set_check(checks, "intentCoverage", STATUS_PASS)


def _apply_content_structure(
    checks: dict[str, Any],
    issues: list[dict[str, Any]],
    draft: dict[str, Any],
    plan: dict[str, Any],
    profile: dict[str, Any],
) -> None:
    lead = draft.get("lead") if isinstance(draft.get("lead"), dict) else {}
    if not any(_text(lead.get(key)) for key in ("problemHook", "coreSummary", "readerBenefit")):
        issues.append(_issue("LEAD_MISSING", STATUS_WARNING, "도입부 lead가 비어 있습니다.", scope="LEAD"))
        _set_check(checks, "contentStructure", STATUS_WARNING, "LEAD_MISSING")
    planned_ids = [_text(item.get("sectionId")) for item in _as_list(plan.get("sections")) if isinstance(item, dict)]
    written_ids = [_text(item.get("sectionId")) for item in _as_list(draft.get("sections")) if isinstance(item, dict)]
    if planned_ids and written_ids != planned_ids:
        issues.append(_issue("PLANNER_STRUCTURE_VIOLATION", STATUS_FAIL, "Writer section 순서가 Planner와 다릅니다.", scope="STRUCTURE", observed=written_ids))
        _set_check(checks, "contentStructure", STATUS_FAIL, CODE_PLANNER_STRUCTURE_VIOLATION)
        return
    for section in _as_list(draft.get("sections")):
        section_id = _text(section.get("sectionId"))
        if not _text(section.get("heading")):
            issues.append(_issue("HEADING_MISSING", STATUS_WARNING, "섹션 제목이 비어 있습니다.", scope=f"SECTION:{section_id}"))
            _set_check(checks, "contentStructure", STATUS_WARNING, "HEADING_MISSING")
        paragraphs = _as_list(section.get("paragraphs"))
        if not paragraphs:
            issues.append(_issue("EMPTY_SECTION", STATUS_WARNING, "섹션 본문이 비어 있습니다.", scope=f"SECTION:{section_id}"))
            _set_check(checks, "contentStructure", STATUS_WARNING, "EMPTY_SECTION")
        elif len(paragraphs) == 1 and _visible_char_count(paragraphs[0]) > int((profile.get("paragraph") or {}).get("warningMax") or 180):
            issues.append(_issue("SINGLE_HUGE_PARAGRAPH", STATUS_WARNING, "한 섹션이 하나의 긴 문단으로만 작성되었습니다.", scope=f"SECTION:{section_id}"))
            _set_check(checks, "contentStructure", STATUS_WARNING, "SINGLE_HUGE_PARAGRAPH")
    conclusion = draft.get("conclusion") if isinstance(draft.get("conclusion"), dict) else {}
    if not any(_text(conclusion.get(key)) for key in ("actionGuidance", "closingQuestion")) and not _as_list(conclusion.get("summaryPoints")):
        issues.append(_issue("CONCLUSION_MISSING", STATUS_WARNING, "맺음말이 비어 있습니다.", scope="CONCLUSION"))
        _set_check(checks, "contentStructure", STATUS_WARNING, "CONCLUSION_MISSING")


def _apply_readability(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], profile: dict[str, Any]) -> None:
    paragraph_spec = profile.get("paragraph") or {}
    warning_max = int(paragraph_spec.get("warningMax") or 180)
    min_per_section = int(paragraph_spec.get("minPerSection") or 2)
    for section in _as_list(draft.get("sections")):
        section_id = _text(section.get("sectionId"))
        paragraphs = _as_list(section.get("paragraphs"))
        if len(paragraphs) < min_per_section:
            issues.append(
                _issue(
                    "FEW_PARAGRAPHS_IN_SECTION",
                    STATUS_WARNING,
                    "섹션 문단 수가 참고 규격보다 적습니다.",
                    scope=f"SECTION:{section_id}",
                    observed=len(paragraphs),
                    reference=_guideline_ref(paragraph_spec),
                )
            )
            _set_check(checks, "readability", STATUS_WARNING, "FEW_PARAGRAPHS_IN_SECTION")
        for paragraph in paragraphs:
            count = _visible_char_count(paragraph)
            if count > warning_max:
                issues.append(
                    _issue(
                        "LONG_PARAGRAPH",
                        STATUS_WARNING,
                        "문단 길이가 현재 참고 규격보다 깁니다.",
                        scope=f"SECTION:{section_id}",
                        observed=count,
                        reference=_guideline_ref(paragraph_spec),
                    )
                )
                _set_check(checks, "readability", STATUS_WARNING, "LONG_PARAGRAPH")


def _apply_language_naturalness(checks: dict[str, Any], issues: list[dict[str, Any]], public: str, profile: dict[str, Any]) -> None:
    spec = profile.get("sentenceEnding") or {}
    threshold = int(spec.get("consecutiveRepeatWarning") or 3)
    endings = [sentence_ending_token(item) for item in split_visible_sentences(public)]
    current = 0
    prev = None
    longest = 0
    token = None
    for ending in endings:
        if ending and ending == prev:
            current += 1
        else:
            current = 1 if ending else 0
            prev = ending
        if current > longest:
            longest = current
            token = ending
    if longest >= threshold and token:
        issues.append(
            _issue(
                "REPEATED_SENTENCE_ENDING",
                STATUS_WARNING,
                "동일한 종결 어미가 연속으로 반복됩니다.",
                scope="BODY",
                observed={"ending": token, "consecutive": longest},
                reference={"preferredMax": threshold - 1, "authority": spec.get("authority") or AUTHORITY_PROJECT},
            )
        )
        _set_check(checks, "languageNaturalness", STATUS_WARNING, "REPEATED_SENTENCE_ENDING")


def _apply_cliche(checks: dict[str, Any], issues: list[dict[str, Any]], public: str, profile: dict[str, Any]) -> None:
    phrases = tuple(profile.get("cliches", {}).get("phrases") or [])
    hits = find_phrase_hits(public, phrases)
    if hits:
        issues.append(_issue("AI_CLICHE_DETECTED", STATUS_WARNING, "AI 상투 표현이 본문에 포함되어 있습니다.", scope="BODY", observed=hits))
        _set_check(checks, "clicheDetection", STATUS_WARNING, "AI_CLICHE_DETECTED")


def _apply_repetition(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], public: str, profile: dict[str, Any]) -> None:
    spec = profile.get("repetition") or {}
    warn_at = int(spec.get("duplicateSentenceWarning") or 2)
    fail_at = int(spec.get("mechanicalDuplicateFail") or 4)
    counts: dict[str, int] = {}
    for sentence in split_visible_sentences(public):
        key = _text(sentence)
        if key:
            counts[key] = counts.get(key, 0) + 1
    if counts and max(counts.values()) >= fail_at:
        issues.append(
            _issue(
                "MECHANICAL_CONTENT_REPETITION",
                STATUS_FAIL,
                "동일 문장이 기계적으로 대량 반복되었습니다.",
                scope="BODY",
                observed=max(counts.values()),
                reference={"preferredMax": fail_at - 1, "authority": spec.get("authority") or AUTHORITY_PROJECT},
            )
        )
        _set_check(checks, "repetitionDetection", STATUS_FAIL, "MECHANICAL_CONTENT_REPETITION")
        return
    headings = [_text(section.get("heading")) for section in _as_list(draft.get("sections"))]
    heading_counts: dict[str, int] = {}
    for heading in headings:
        if heading:
            heading_counts[heading] = heading_counts.get(heading, 0) + 1
    if heading_counts and max(heading_counts.values()) >= warn_at:
        issues.append(_issue("DUPLICATE_HEADING", STATUS_WARNING, "동일한 소제목이 반복됩니다.", scope="STRUCTURE"))
        _set_check(checks, "repetitionDetection", STATUS_WARNING, "DUPLICATE_HEADING")
    if counts and max(counts.values()) >= warn_at:
        issues.append(_issue("DUPLICATE_SENTENCE", STATUS_WARNING, "동일 문장이 반복됩니다.", scope="BODY", observed=max(counts.values())))
        _set_check(checks, "repetitionDetection", STATUS_WARNING, "DUPLICATE_SENTENCE")


def _apply_keyword(
    checks: dict[str, Any],
    issues: list[dict[str, Any]],
    public: str,
    intent: dict[str, Any],
    profile: dict[str, Any],
    metrics: dict[str, Any],
) -> None:
    spec = profile.get("keyword") or {}
    keyword = _primary_keyword(intent)
    if not keyword:
        checks["keywordNaturalness"] = _check(STATUS_NOT_APPLICABLE, detail="NO_PRIMARY_KEYWORD")
        return
    fail_at = int(spec.get("mechanicalConsecutiveRepeatFail") or 4)
    repeats = max_consecutive_phrase_repeats(public)
    exact = int(metrics.get("primaryKeywordExactCount") or 0)
    if repeats >= fail_at:
        issues.append(
            _issue(
                "MECHANICAL_KEYWORD_STUFFING",
                STATUS_FAIL,
                "동일 키워드 구가 기계적으로 연속 반복되었습니다.",
                scope="BODY",
                observed={"consecutiveRepeats": repeats, "keyword": keyword},
                reference={"preferredMax": fail_at - 1, "authority": spec.get("authority") or AUTHORITY_REFERENCE},
            )
        )
        _set_check(checks, "keywordNaturalness", STATUS_FAIL, "MECHANICAL_KEYWORD_STUFFING")
        return
    preferred_min = int(spec.get("preferredMinCount") or 4)
    preferred_max = int(spec.get("preferredMaxCount") or 6)
    density_max = float(spec.get("densityMax") or 0.02)
    reference = _guideline_ref(spec)
    if exact < preferred_min:
        issues.append(_issue("KEYWORD_USAGE_BELOW_REFERENCE", STATUS_WARNING, "기본 키워드 사용량이 현재 참고 규격보다 적습니다.", scope="BODY", observed=exact, reference=reference))
        _set_check(checks, "keywordNaturalness", STATUS_WARNING, "KEYWORD_USAGE_BELOW_REFERENCE")
    elif exact > preferred_max or float(metrics.get("primaryKeywordDensity") or 0) > density_max:
        issues.append(_issue("KEYWORD_USAGE_ABOVE_REFERENCE", STATUS_WARNING, "기본 키워드 사용량이 현재 참고 규격보다 많습니다.", scope="BODY", observed=exact, reference=reference))
        _set_check(checks, "keywordNaturalness", STATUS_WARNING, "KEYWORD_USAGE_ABOVE_REFERENCE")


def _apply_title(
    checks: dict[str, Any],
    issues: list[dict[str, Any]],
    draft: dict[str, Any],
    profile: dict[str, Any],
    metrics: dict[str, Any],
) -> None:
    spec = profile.get("title") or {}
    title = _text(draft.get("selectedTitle"))
    if not title:
        issues.append(_issue("TITLE_MISSING", STATUS_FAIL, "selectedTitle이 없습니다.", scope="TITLE"))
        _set_check(checks, "titleGuideline", STATUS_FAIL, "TITLE_MISSING")
        return
    count = int(metrics.get("titleCharacterCount") or 0)
    preferred_min = int(spec.get("preferredMin") or 23)
    preferred_max = int(spec.get("preferredMax") or 28)
    if count < preferred_min or count > preferred_max:
        code = "TITLE_LENGTH_BELOW_REFERENCE" if count < preferred_min else "TITLE_LENGTH_ABOVE_REFERENCE"
        issues.append(
            _issue(
                code,
                STATUS_WARNING,
                "제목 길이가 현재 참고 규격 범위를 벗어났습니다.",
                scope="TITLE",
                observed=count,
                reference=_guideline_ref(spec),
            )
        )
        _set_check(checks, "titleGuideline", STATUS_WARNING, code)
    if len(SPECIAL_CHAR_RE.findall(title)) >= int(spec.get("excessiveSpecialCharCount") or 3):
        issues.append(_issue("TITLE_SPECIAL_CHAR_EXCESS", STATUS_WARNING, "제목에 특수문자가 과도합니다.", scope="TITLE"))
        _set_check(checks, "titleGuideline", STATUS_WARNING, "TITLE_SPECIAL_CHAR_EXCESS")
    candidates = [_text(item.get("title") if isinstance(item, dict) else item) for item in _as_list(draft.get("titleCandidates"))]
    if title not in candidates:
        issues.append(_issue("SELECTED_TITLE_NOT_IN_CANDIDATES", STATUS_WARNING, "selectedTitle이 titleCandidates에 없습니다.", scope="TITLE"))
        _set_check(checks, "titleGuideline", STATUS_WARNING, "SELECTED_TITLE_NOT_IN_CANDIDATES")


def _apply_body(
    checks: dict[str, Any],
    issues: list[dict[str, Any]],
    draft: dict[str, Any],
    catalogs: dict[str, Any],
    profile: dict[str, Any],
    metrics: dict[str, Any],
) -> None:
    spec = profile.get("body") or {}
    count = int(metrics.get("visibleCharacterCount") or 0)
    preferred_min = int(spec.get("preferredMin") or 2200)
    preferred_max = int(spec.get("preferredMax") or 2600)
    if count < preferred_min:
        issues.append(
            _issue(
                "BODY_LENGTH_BELOW_REFERENCE",
                STATUS_WARNING,
                "본문 분량이 현재 참고 규격보다 짧습니다.",
                scope="BODY",
                observed=count,
                reference=_guideline_ref(spec),
            )
        )
        _set_check(checks, "bodyGuideline", STATUS_WARNING, "BODY_LENGTH_BELOW_REFERENCE")
        usable_facts = [item for item in catalogs["facts"] if _text(item.get("statement")) not in {"", "상품명: 제품"}]
        if len(usable_facts) <= 1 or "SPARSE_SOURCE" in _as_list(draft.get("draftWarnings")):
            issues.append(_issue("SOURCE_LIMITED_DRAFT", STATUS_WARNING, "source가 부족해 분량을 일반지식으로 채우지 않은 초안입니다.", scope="SOURCE", observed=len(usable_facts)))
            _set_check(checks, "bodyGuideline", STATUS_WARNING, "SOURCE_LIMITED_DRAFT")
    elif count > preferred_max:
        issues.append(
            _issue(
                "BODY_LENGTH_ABOVE_REFERENCE",
                STATUS_WARNING,
                "본문 분량이 현재 참고 규격보다 깁니다.",
                scope="BODY",
                observed=count,
                reference=_guideline_ref(spec),
            )
        )
        _set_check(checks, "bodyGuideline", STATUS_WARNING, "BODY_LENGTH_ABOVE_REFERENCE")


def _apply_faq(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], plan: dict[str, Any]) -> None:
    faq_plan = [item for item in _as_list(plan.get("faqPlan")) if isinstance(item, dict)]
    supported = [_text(item.get("question")) for item in faq_plan if _text(item.get("status")).upper() == "SUPPORTED"]
    if not faq_plan:
        checks["faqQuality"] = _check(STATUS_NOT_APPLICABLE, detail="NO_FAQ_PLAN")
        return
    if not supported:
        checks["faqQuality"] = _check(STATUS_NOT_APPLICABLE, detail="NO_SUPPORTED_FAQ")
        return
    faq = [item for item in _as_list(draft.get("faq")) if isinstance(item, dict)]
    if not faq:
        issues.append(_issue("FAQ_MISSING", STATUS_WARNING, "SUPPORTED FAQ가 초안에 없습니다.", scope="FAQ"))
        _set_check(checks, "faqQuality", STATUS_WARNING, "FAQ_MISSING")
        return
    for item in faq:
        if not _text(item.get("answer")):
            issues.append(_issue("FAQ_ANSWER_EMPTY", STATUS_WARNING, "FAQ 답변이 비어 있습니다.", scope="FAQ", observed=item.get("question")))
            _set_check(checks, "faqQuality", STATUS_WARNING, "FAQ_ANSWER_EMPTY")


def _apply_cta(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], plan: dict[str, Any], profile: dict[str, Any]) -> None:
    planned = plan.get("ctaPlan") if isinstance(plan.get("ctaPlan"), dict) else {}
    actual = draft.get("cta") if isinstance(draft.get("cta"), dict) else {}
    planned_type = _text(planned.get("type")).upper() or "NONE"
    actual_type = _text(actual.get("type")).upper() or "NONE"
    if planned_type in CTA_TYPES and actual_type != planned_type:
        issues.append(_issue("CTA_TYPE_MISMATCH", STATUS_WARNING, "Draft CTA 유형이 Planner ctaPlan과 다릅니다.", scope="CTA", observed=actual_type))
        _set_check(checks, "ctaQuality", STATUS_WARNING, "CTA_TYPE_MISMATCH")
    text = _text(actual.get("text"))
    hits = find_phrase_hits(text, tuple(profile.get("cta", {}).get("overPromotionalPhrases") or []))
    if hits:
        issues.append(_issue("OVER_PROMOTIONAL_CTA", STATUS_WARNING, "과도한 판매 CTA 표현이 있습니다.", scope="CTA", observed=hits))
        _set_check(checks, "ctaQuality", STATUS_WARNING, "OVER_PROMOTIONAL_CTA")


def _apply_image(checks: dict[str, Any], issues: list[dict[str, Any]], draft: dict[str, Any], plan: dict[str, Any]) -> None:
    needs = [item for item in _as_list(plan.get("imageNeeds")) if isinstance(item, dict)]
    pending = [item for item in _as_list(draft.get("sections")) if _text(item.get("imageStatus")).upper() == "PENDING"]
    needed = [item for item in needs if _text(item.get("status")).upper() in {"NEEDED", "OPTIONAL"}]
    if not needed and not pending:
        checks["imageReadiness"] = _check(STATUS_NOT_APPLICABLE, detail="NO_IMAGE_NEEDS")
        return
    if pending:
        issues.append(_issue("IMAGE_ASSETS_PENDING", STATUS_WARNING, "이미지 자산이 아직 PENDING 상태입니다.", scope="IMAGE", observed=len(pending)))
        _set_check(checks, "imageReadiness", STATUS_WARNING, "IMAGE_ASSETS_PENDING")


def _apply_internal_links(checks: dict[str, Any], issues: list[dict[str, Any]], blog_context: dict[str, Any]) -> None:
    candidates = _as_list(blog_context.get("internalLinkCandidates"))
    if not candidates:
        checks["internalLinkReadiness"] = _check(STATUS_NOT_APPLICABLE, detail="INTERNAL_LINK_CANDIDATES_EMPTY")
        return
    issues.append(_issue("INTERNAL_LINK_NOT_USED", STATUS_WARNING, "사용 가능한 내부 링크가 본문에 연결되지 않았습니다.", scope="LINKS"))
    _set_check(checks, "internalLinkReadiness", STATUS_WARNING, "INTERNAL_LINK_NOT_USED")


def _apply_disclosure(
    checks: dict[str, Any],
    issues: list[dict[str, Any]],
    draft: dict[str, Any],
    blog_context: dict[str, Any],
    public: str,
) -> None:
    disclosure = blog_context.get("commercialDisclosure") if isinstance(blog_context.get("commercialDisclosure"), dict) else {}
    required = disclosure.get("required")
    status = _text(disclosure.get("status")).upper() or "UNKNOWN"
    present = bool(_text((draft.get("commercialDisclosure") or {}).get("text") if isinstance(draft.get("commercialDisclosure"), dict) else None))
    source = _text(disclosure.get("source"))
    if source and source in public:
        present = True
    if required is True and not present:
        issues.append(_issue("REQUIRED_DISCLOSURE_MISSING", STATUS_FAIL, "발행에 필요한 상업적 고지가 초안에 없습니다.", scope="DISCLOSURE"))
        _set_check(checks, "commercialDisclosure", STATUS_FAIL, "REQUIRED_DISCLOSURE_MISSING")
        return
    if required is not True and status in {"", "UNKNOWN"}:
        issues.append(_issue("COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN", STATUS_WARNING, "상업적 고지 필요 여부가 아직 UNKNOWN입니다.", scope="DISCLOSURE"))
        _set_check(checks, "commercialDisclosure", STATUS_WARNING, "COMMERCIAL_DISCLOSURE_STATUS_UNKNOWN")
        return
    if required is False:
        checks["commercialDisclosure"] = _check(STATUS_PASS, detail="NOT_REQUIRED")
        return
    _set_check(checks, "commercialDisclosure", STATUS_PASS)


def _assert_no_scores(report: dict[str, Any]) -> None:
    blob = json.dumps(report, ensure_ascii=False)
    for key in FORBIDDEN_SCORE_KEYS:
        if f'"{key}"' in blob:
            raise RuntimeError(f"quality score key is not allowed: {key}")
