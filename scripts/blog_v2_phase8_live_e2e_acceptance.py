"""PHASE 8 Gate A live runner. Does not change production blog routing."""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "api"
sys.path.insert(0, str(API))

for key in ("CONTENT_WRITER_TEST_FIXTURE", "CONTENT_BLOG_PLANNER_TEST_FIXTURE", "CONTENT_BLOG_WRITER_TEST_FIXTURE"):
    os.environ.pop(key, None)
os.environ.setdefault("ANALYTICS_DB_URL", "postgresql://analytics:analytics_pw@localhost:5442/analytics")

import requests
from sqlalchemy.orm import Session

from content_blog_context import BLOG_GENERATION_CONTEXT_VERSION, build_blog_generation_context
from content_blog_image_plan import plan_blog_images
from content_blog_planner import BlogPlannerError, PLANNER_PROMPT_VERSION, PLANNER_VERSION, plan_blog_content
from content_blog_review import build_blog_v2_review_bundle
from content_blog_validator import validate_blog_quality
from content_blog_writer import BlogWriterError, WRITER_PROMPT_VERSION, WRITER_VERSION, to_legacy_blog_preview, write_blog_professional_draft
from content_center_engine import get_appeal
from content_center_generate import generate_channel_payload
from db import ContentAppealEvidence, ContentArtifact, ContentSkuAsset, ContentSkuScope, SessionLocal
from content_center_engine import _new_id

OUT = ROOT / "calibration" / "review" / "blog-v2-phase8-live-e2e-acceptance-v1"
CASES = (
    {
        "caseId": "case-a",
        "theme": "헤나 염색을 처음 사용하는 사람이 알아야 할 준비와 사용 방법",
        "purpose": ["HOW_TO", "PRODUCT_GUIDE"],
        "sku_id": "82288271914",
        "appeal_id": "AP-3dc06c788f",
    },
    {
        "caseId": "case-b",
        "theme": "호호바오일의 특징과 헤어케어에서 사용하는 방법",
        "purpose": ["INGREDIENT_EDUCATION", "PRODUCT_GUIDE"],
        "sku_id": "https://smartstore.naver.com/thesujata/products/5787615984",
        "appeal_id": "AP-bd9435d10f",
    },
    {
        "caseId": "case-c",
        "theme": "겨울철 건조한 모발을 관리할 때 확인해야 할 것",
        "purpose": ["PROBLEM_SOLUTION", "HAIR_CARE"],
        "sku_id": "https://smartstore.naver.com/thesujata/products/12874366496",
        "appeal_id": "AP-0fb3c6c792",
    },
)

CASE_FILTER = [item.strip() for item in os.getenv("PHASE8_CASES", "").split(",") if item.strip()]
ATTEMPT_DIR = str(os.getenv("PHASE8_ATTEMPT_DIR") or "").strip()
CALL_DIR = OUT / ATTEMPT_DIR / "openai-calls" if ATTEMPT_DIR else OUT / "openai-calls"

CALLS: list[dict] = []
ACTIVE = {"caseId": None, "stage": "V2"}
_ORIG_POST = requests.post


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def _fixture_state() -> dict:
    return {
        "executionMode": "LIVE_OPENAI",
        "fixtureMode": False,
        "CONTENT_WRITER_TEST_FIXTURE": os.getenv("CONTENT_WRITER_TEST_FIXTURE"),
        "CONTENT_BLOG_PLANNER_TEST_FIXTURE": os.getenv("CONTENT_BLOG_PLANNER_TEST_FIXTURE"),
        "CONTENT_BLOG_WRITER_TEST_FIXTURE": os.getenv("CONTENT_BLOG_WRITER_TEST_FIXTURE"),
        "raw_plan_injection": False,
        "raw_draft_injection": False,
    }


def _classify(payload: dict) -> str:
    blob = json.dumps(payload.get("messages") or [], ensure_ascii=False)
    if "블로그 본문을 작성하는 전문 에디터" in blob:
        return "WRITER_V2"
    if "글을 작성하는 것이 아니라 글의 구조를 설계하는 것이다" in blob:
        return "PLANNER_V2"
    if ACTIVE["stage"] == "V1":
        return "WRITER_V1"
    return "UNKNOWN_LLM"


def _logged_post(*args, **kwargs):
    url = str(args[0] if args else kwargs.get("url") or "")
    if "api.openai.com" not in url:
        return _ORIG_POST(*args, **kwargs)
    payload = kwargs.get("json") or {}
    call_type = _classify(payload)
    retries = 0
    last_error = None
    started = time.time()
    started_at = _now()
    for attempt in range(3):
        try:
            resp = _ORIG_POST(*args, **kwargs)
            transient = int(resp.status_code) in {429, 500, 502, 503}
            if transient and attempt < 2:
                retries += 1
                time.sleep(2 * (attempt + 1))
                continue
            body = {}
            try:
                body = resp.json() if resp.content else {}
            except Exception:
                body = {}
            usage = body.get("usage") if isinstance(body, dict) else None
            choice = (body.get("choices") or [{}])[0] if isinstance(body, dict) else {}
            message = choice.get("message") if isinstance(choice, dict) else {}
            content = (message or {}).get("content") if isinstance(message, dict) else None
            meta = {
                "caseId": ACTIVE["caseId"],
                "callType": call_type,
                "model": payload.get("model"),
                "promptVersion": PLANNER_PROMPT_VERSION if call_type.startswith("PLANNER") else WRITER_PROMPT_VERSION,
                "startedAt": started_at,
                "completedAt": _now(),
                "success": int(resp.status_code) == 200 and bool(str(content or "").strip()),
                "httpStatus": int(resp.status_code),
                "retryCount": retries,
                "retryReason": "transient_http" if retries else None,
                "latencyMs": int((time.time() - started) * 1000),
                "usage": usage if isinstance(usage, dict) else None,
                "finishReason": choice.get("finish_reason") if isinstance(choice, dict) else None,
                "contentLen": len(str(content or "")),
                "messageKeys": list(message.keys()) if isinstance(message, dict) else [],
                "refusal": (message or {}).get("refusal") if isinstance(message, dict) else None,
            }
            CALLS.append(meta)
            dump_name = f"{ACTIVE['caseId'] or 'unknown'}-{len(CALLS):02d}-{call_type}.json"
            _dump(
                CALL_DIR / dump_name,
                {
                    **meta,
                    "contentPreview": str(content or "")[:400],
                    "error": body.get("error") if isinstance(body, dict) else None,
                },
            )
            return resp
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_error = str(exc)
            if attempt < 2:
                retries += 1
                time.sleep(2 * (attempt + 1))
                continue
            CALLS.append(
                {
                    "caseId": ACTIVE["caseId"],
                    "callType": call_type,
                    "model": payload.get("model"),
                    "startedAt": started_at,
                    "completedAt": _now(),
                    "success": False,
                    "retryCount": retries,
                    "retryReason": last_error,
                    "latencyMs": int((time.time() - started) * 1000),
                    "usage": None,
                }
            )
            raise
    raise RuntimeError("openai_post_exhausted")


requests.post = _logged_post


def _snapshot(db: Session, spec: dict, appeal: dict) -> dict:
    evidence = (
        db.query(ContentAppealEvidence)
        .filter(ContentAppealEvidence.appeal_id == spec["appeal_id"])
        .all()
    )
    assets = db.query(ContentSkuAsset).filter(ContentSkuAsset.sku_id == spec["sku_id"]).all()
    scope = db.query(ContentSkuScope).filter(ContentSkuScope.sku_id == spec["sku_id"]).one_or_none()
    return {
        "caseId": spec["caseId"],
        "theme": spec["theme"],
        "purpose": spec["purpose"],
        "snapshotAt": _now(),
        "contextBuilderVersion": BLOG_GENERATION_CONTEXT_VERSION,
        "sku_id": spec["sku_id"],
        "product_url": getattr(scope, "product_url", None),
        "product_title": getattr(scope, "title", None),
        "product_group": getattr(scope, "product_group", None),
        "appeal_id": spec["appeal_id"],
        "appeal_label": appeal.get("label"),
        "insight_id": appeal.get("insight_id"),
        "evidence_ids": [row.evidence_id for row in evidence],
        "evidence_count": len(evidence),
        "detail_page_asset_ids": [row.asset_id for row in assets if row.asset_type == "detail_page"],
        "available_image_ids": [row.asset_id for row in assets if row.asset_type == "product_image"],
        "asset_ids": [row.asset_id for row in assets],
    }


def _public_text(draft: dict) -> str:
    parts = [str(draft.get("selectedTitle") or "")]
    lead = draft.get("lead") if isinstance(draft.get("lead"), dict) else {}
    parts.extend(str(lead.get(key) or "") for key in ("problemHook", "coreSummary", "readerBenefit"))
    for section in draft.get("sections") or []:
        if not isinstance(section, dict):
            continue
        parts.append(str(section.get("heading") or ""))
        parts.extend(str(item) for item in (section.get("paragraphs") or []))
    for item in draft.get("faq") or []:
        if isinstance(item, dict):
            parts.extend([str(item.get("question") or ""), str(item.get("answer") or "")])
    cta = draft.get("cta") if isinstance(draft.get("cta"), dict) else {}
    parts.append(str(cta.get("text") or ""))
    return "\n".join(part for part in parts if part)


def _count_issues(report: dict, status: str) -> int:
    return len([item for item in report.get("issues") or [] if isinstance(item, dict) and str(item.get("status") or "").upper() == status])


def _auto_compare(v1: dict, v2_draft: dict, quality: dict, image: dict, bundle: dict, plan: dict) -> dict:
    v1_text = str(v1.get("export_text") or v1.get("body") or "")
    v2_text = _public_text(v2_draft)
    v2_sections = [item for item in v2_draft.get("sections") or [] if isinstance(item, dict)]
    v2_paragraphs = [p for s in v2_sections for p in (s.get("paragraphs") or [])]
    usage = v2_draft.get("sourceUsage") if isinstance(v2_draft.get("sourceUsage"), dict) else {}
    plan_facts = []
    for section in (plan.get("contentPlan") or {}).get("sections") or []:
        if isinstance(section, dict):
            plan_facts.extend(section.get("factsToUse") or [])
    image_plan = image.get("imagePlan") if isinstance(image.get("imagePlan"), dict) else image
    summary = image_plan.get("summary") if isinstance(image_plan.get("summary"), dict) else {}
    items = bundle.get("reviewItems") or []
    v1_blog = v1.get("blog") if isinstance(v1.get("blog"), dict) else v1
    v1_sections = v1_blog.get("sections") if isinstance(v1_blog.get("sections"), list) else []
    return {
        "characterCount": {"v1": len(v1_text), "v2": len(v2_text)},
        "sectionCount": {"v1": len(v1_sections), "v2": len(v2_sections)},
        "paragraphCount": {"v1": None, "v2": len(v2_paragraphs)},
        "faqCount": {"v1": len(v1_blog.get("faq") or []) if isinstance(v1_blog, dict) else None, "v2": len(v2_draft.get("faq") or [])},
        "titleCandidateCount": {"v1": len(v1.get("title_candidates") or v1_blog.get("title_candidates") or []) if isinstance(v1, dict) else 0, "v2": len(v2_draft.get("titleCandidates") or [])},
        "sourceFactsPlanned": len(plan_facts),
        "sourceFactsUsed": len(usage.get("factsUsed") or []),
        "evidencePlanned": None,
        "evidenceUsed": len(usage.get("evidenceUsed") or []),
        "unsupportedFactGenerated": usage.get("unsupportedFactGenerated"),
        "qualityFailCount": _count_issues(quality, "FAIL"),
        "qualityWarningCount": _count_issues(quality, "WARNING"),
        "qualityGate": quality.get("gateDecision"),
        "imageRequired": summary.get("requiredCount"),
        "imageAssigned": summary.get("assignedCount"),
        "imagePending": summary.get("pendingCount"),
        "requiredHitlCount": len([item for item in items if item.get("required")]),
        "optionalHitlCount": len([item for item in items if not item.get("required")]),
        "sourceRefsPresent": any(s.get("sourceRefs") for s in v2_sections),
        "titleCandidatesPresent": bool(v2_draft.get("titleCandidates")),
        "imagePlanPresent": bool(image_plan.get("items")),
        "objective": {
            "sourceTraceability": "V2_BETTER" if any(s.get("sourceRefs") for s in v2_sections) else "NOT_EVALUABLE",
            "titleChoice": "V2_BETTER" if v2_draft.get("titleCandidates") else "V1_BETTER",
            "imagePlan": "V2_BETTER" if image_plan.get("items") else "NOT_EVALUABLE",
            "hitlReviewability": "V2_BETTER" if items else "NOT_EVALUABLE",
            "claimSafety": "NOT_EVALUABLE",
            "naturalKorean": "HUMAN_REVIEW",
            "professionalValue": "HUMAN_REVIEW",
            "searchIntentFit": "HUMAN_REVIEW",
        },
        "humanQuestions": [
            "어느 글이 실제 질문에 더 잘 답하는가?",
            "어느 글이 일반적인 AI 글보다 전문적으로 느껴지는가?",
            "V2에 불필요한 일반론이 줄었는가?",
            "V2가 확인 가능한 근거 안에서 설명하고 있는가?",
            "읽으면서 기계적으로 생성된 느낌이 강한 부분은 없는가?",
            "실제 네이버 블로그에 발행할 수준인가?",
            "사람이 수정해야 하는 양이 V1보다 줄었는가?",
        ],
    }


def _insert_review_artifact(db: Session, spec: dict, bundle: dict, draft: dict, title: str) -> str:
    preview = to_legacy_blog_preview(draft)
    body = {
        "generation_version": "blog_v2",
        "generation_engine": "BLOG_V2_PHASE8_ACCEPTANCE",
        "phase8": True,
        "caseId": spec["caseId"],
        "blog_v2_review_bundle": bundle,
        "humanReview": bundle.get("humanReview"),
        "title": title,
        "format": "blog",
        "blog": preview,
        "sections": preview.get("sections"),
        "export_text": "\n\n".join(
            [title]
            + [preview.get("intro") or ""]
            + [f"## {s.get('heading')}\n{s.get('body')}" for s in preview.get("sections") or []]
        ),
    }
    artifact_id = _new_id("CT")
    row = ContentArtifact(
        artifact_id=artifact_id,
        original_artifact_id=artifact_id,
        revision_no=1,
        revision_reason="phase8_acceptance",
        source="phase8_acceptance",
        is_published_version=False,
        sku_id=spec["sku_id"],
        appeal_id=spec["appeal_id"],
        channel="blog",
        title=f"{'[PHASE8-ATTEMPT-2]' if ATTEMPT_DIR else '[PHASE8-ACCEPTANCE]'} {spec['caseId'].upper()} {title}"[:180],
        body_json=json.dumps(body, ensure_ascii=False),
        export_text=str(body["export_text"]),
        reviewer_status="pending",
    )
    db.add(row)
    db.commit()
    return artifact_id


def _run_case(db: Session, spec: dict) -> dict:
    ACTIVE["caseId"] = spec["caseId"]
    folder = OUT / spec["caseId"]
    if ATTEMPT_DIR:
        folder = folder / ATTEMPT_DIR
    folder.mkdir(parents=True, exist_ok=True)
    appeal = get_appeal(db, spec["appeal_id"])
    if appeal is None:
        result = {"caseId": spec["caseId"], "status": "CASE_SOURCE_UNAVAILABLE", "reason": "appeal_not_found"}
        _dump(folder / "runtime.json", result)
        return result
    snapshot = _snapshot(db, spec, appeal)
    _dump(folder / "source-snapshot.json", snapshot)
    ACTIVE["stage"] = "V2"
    context = build_blog_generation_context(db, appeal=appeal, sku_title=str(snapshot.get("product_title") or ""))
    _dump(folder / "context.json", context)
    try:
        planner = plan_blog_content(db, blog_context=context)
    except (BlogPlannerError, BlogWriterError) as exc:
        runtime = {
            "caseId": spec["caseId"],
            "status": "LIVE_CASE_HOLD",
            "stage": "planner",
            "error": str(exc),
            "completedAt": _now(),
            "fixture": _fixture_state(),
        }
        _dump(folder / "runtime.json", runtime)
        return runtime
    _dump(folder / "intent-plan.json", planner)
    runtime = {
        "caseId": spec["caseId"],
        "startedAt": _now(),
        "fixture": _fixture_state(),
        "plannerStatus": planner.get("status"),
        "plannerCode": planner.get("code"),
    }
    if planner.get("status") != "PASS":
        runtime.update({"status": "LIVE_CASE_HOLD", "stage": "planner", "issues": planner.get("issues")})
        _dump(folder / "runtime.json", runtime)
        return runtime
    try:
        writer = write_blog_professional_draft(db, blog_context=context, planner_result=planner)
    except (BlogPlannerError, BlogWriterError) as exc:
        runtime.update({"status": "LIVE_CASE_HOLD", "stage": "writer", "error": str(exc), "completedAt": _now()})
        _dump(folder / "runtime.json", runtime)
        return runtime
    draft = writer.get("draft") or {}
    _dump(folder / "draft.json", writer)
    runtime["writerStatus"] = writer.get("status")
    runtime["writerCode"] = writer.get("code")
    if writer.get("status") != "PASS":
        runtime.update({"status": "LIVE_CASE_HOLD", "stage": "writer", "issues": writer.get("issues")})
        _dump(folder / "runtime.json", runtime)
        quality = validate_blog_quality(db, blog_context=context, planner_result=planner, draft=draft, writer_result=writer)
        image = plan_blog_images(blog_context=context, planner_result=planner, draft=draft, quality_report=quality)
        bundle = build_blog_v2_review_bundle(blog_context=context, planner_result=planner, draft=draft, quality_report=quality, image_plan=image)
        _dump(folder / "quality-report.json", quality)
        _dump(folder / "image-plan.json", image)
        _dump(folder / "review-bundle.json", bundle)
        return runtime
    quality = validate_blog_quality(db, blog_context=context, planner_result=planner, draft=draft, writer_result=writer)
    image = plan_blog_images(blog_context=context, planner_result=planner, draft=draft, quality_report=quality)
    bundle = build_blog_v2_review_bundle(blog_context=context, planner_result=planner, draft=draft, quality_report=quality, image_plan=image)
    _dump(folder / "quality-report.json", quality)
    _dump(folder / "image-plan.json", image)
    _dump(folder / "review-bundle.json", bundle)
    _dump(folder / "v2-output.json", {"draft": draft, "preview": to_legacy_blog_preview(draft)})
    ACTIVE["stage"] = "V1"
    v1 = generate_channel_payload(db, appeal=appeal, channel="blog", sku_title=str(snapshot.get("product_title") or ""))
    _dump(folder / "v1-output.json", v1)
    compare = _auto_compare(v1, draft, quality, image, bundle, planner)
    _dump(folder / "comparison.json", compare)
    artifact_id = _insert_review_artifact(db, spec, bundle, draft, str(draft.get("selectedTitle") or spec["theme"]))
    runtime.update(
        {
            "status": "LIVE_CASE_HOLD" if quality.get("gateDecision") == "HOLD" else "LIVE_OK",
            "completedAt": _now(),
            "qualityGate": quality.get("gateDecision"),
            "qualityStatus": quality.get("qualityStatus"),
            "imagePlanStatus": (image.get("imagePlan") or image).get("planStatus"),
            "reviewReadiness": (bundle.get("reviewSummary") or {}).get("reviewReadiness"),
            "reviewSummary": bundle.get("reviewSummary"),
            "selectedTitle": draft.get("selectedTitle"),
            "titleCandidates": [item.get("title") for item in draft.get("titleCandidates") or [] if isinstance(item, dict)],
            "uiArtifactId": artifact_id,
            "humanDecisionsPending": all(item.get("humanDecision") == "PENDING" for item in bundle.get("reviewItems") or []),
        }
    )
    _dump(folder / "runtime.json", runtime)
    return runtime


def _write_html(summary: dict) -> None:
    rows = []
    for item in summary.get("cases") or []:
        rows.append(
            f"<tr><td>{item.get('caseId')}</td><td>{item.get('status')}</td><td>{item.get('selectedTitle') or ''}</td>"
            f"<td>{item.get('qualityGate')}</td><td>{item.get('reviewReadiness')}</td><td>{item.get('uiArtifactId') or ''}</td></tr>"
        )
    html = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/><title>BLOG_V2_PHASE8_LIVE_E2E_ACCEPTANCE_V1</title>
<style>body{{font-family:Arial,sans-serif;margin:32px;line-height:1.55;color:#222}} table{{border-collapse:collapse;width:100%}} td,th{{border:1px solid #ddd;padding:8px;text-align:left}} .box{{border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}}</style>
</head><body>
<h1>BLOG_V2_PHASE8_LIVE_E2E_ACCEPTANCE_V1</h1>
<p><strong>Decision:</strong> {summary.get("decision")}</p>
<p><strong>Production Activation:</strong> {summary.get("productionActivationDecision")}</p>
<div class="box"><h2>Runtime</h2>
<p>startedAt {summary.get("startedAt")} / completedAt {summary.get("completedAt")}</p>
<p>fixtureMode={summary.get("fixture", {}).get("fixtureMode")} executionMode={summary.get("fixture", {}).get("executionMode")}</p>
<p>V2 planner calls={summary.get("openai", {}).get("plannerV2")} writer calls={summary.get("openai", {}).get("writerV2")} V1 writer calls={summary.get("openai", {}).get("writerV1")} retries={summary.get("openai", {}).get("retries")}</p>
</div>
<div class="box"><h2>Cases</h2>
<table><thead><tr><th>Case</th><th>Status</th><th>Title</th><th>Quality</th><th>HITL</th><th>UI artifact</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<p>Human Review 위치: Analytics Web → 콘텐츠 센터 → 수정·편집/최종 검수에서 제목 <code>[PHASE8-ACCEPTANCE]</code> 항목을 선택하세요.</p>
</div>
<div class="box"><h2>Human Review</h2>
<p>상태: PENDING. Cursor가 승인 값을 넣지 않았습니다.</p>
<p>필수 확인: 사실 의미 / 자료 밖 정보 / 광고·협찬 / 이미지 권리 / ALT 일치. 전문성 평가와 V1/V2 비교는 사람이 기록합니다.</p>
</div>
</body></html>"""
    (OUT / "open.html").write_text(html, encoding="utf-8")


def _run_v1_only(db: Session, spec: dict) -> dict:
    folder = OUT / spec["caseId"]
    runtime_path = folder / "runtime.json"
    runtime = json.loads(runtime_path.read_text(encoding="utf-8")) if runtime_path.exists() else {"caseId": spec["caseId"]}
    if (folder / "v1-output.json").exists():
        runtime["v1AlreadyPresent"] = True
        return runtime
    appeal = get_appeal(db, spec["appeal_id"])
    snapshot = json.loads((folder / "source-snapshot.json").read_text(encoding="utf-8"))
    ACTIVE["caseId"] = spec["caseId"]
    ACTIVE["stage"] = "V1"
    v1 = generate_channel_payload(db, appeal=appeal, channel="blog", sku_title=str(snapshot.get("product_title") or ""))
    _dump(folder / "v1-output.json", v1)
    runtime["v1GeneratedAfterHold"] = True
    runtime["v1Title"] = v1.get("title") if isinstance(v1, dict) else None
    _dump(runtime_path, runtime)
    return runtime


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    started = _now()
    fixture = _fixture_state()
    if any(fixture[key] == "1" for key in ("CONTENT_WRITER_TEST_FIXTURE", "CONTENT_BLOG_PLANNER_TEST_FIXTURE", "CONTENT_BLOG_WRITER_TEST_FIXTURE")):
        raise SystemExit("fixture_mode_must_be_false")
    db = SessionLocal()
    cases = []
    v1_only = os.getenv("PHASE8_V1_ONLY") == "1"
    try:
        selected = [spec for spec in CASES if not CASE_FILTER or spec["caseId"] in CASE_FILTER]
        for spec in selected:
            print(f"RUN {spec['caseId']}{' V1_ONLY' if v1_only else ''}", flush=True)
            cases.append(_run_v1_only(db, spec) if v1_only else _run_case(db, spec))
    finally:
        db.close()
        _dump(CALL_DIR / "calls.json", CALLS)
    openai = {
        "total": len(CALLS),
        "plannerV2": len([c for c in CALLS if c.get("callType") == "PLANNER_V2"]),
        "writerV2": len([c for c in CALLS if c.get("callType") == "WRITER_V2"]),
        "writerV1": len([c for c in CALLS if c.get("callType") == "WRITER_V1"]),
        "retries": sum(int(c.get("retryCount") or 0) for c in CALLS),
        "calls": CALLS,
    }
    hold = any(item.get("status") not in {"LIVE_OK"} for item in cases)
    v1_runs = {item.get("caseId"): item for item in cases}
    if v1_only and (OUT / "second-attempt-result.json").exists():
        prior = json.loads((OUT / "second-attempt-result.json").read_text(encoding="utf-8"))
        prior_calls = list((prior.get("openai") or {}).get("calls") or [])
        openai["calls"] = prior_calls + CALLS
        openai["total"] = len(openai["calls"])
        openai["plannerV2"] = len([c for c in openai["calls"] if c.get("callType") == "PLANNER_V2"])
        openai["writerV2"] = len([c for c in openai["calls"] if c.get("callType") == "WRITER_V2"])
        openai["writerV1"] = len([c for c in openai["calls"] if c.get("callType") == "WRITER_V1"])
        openai["retries"] = sum(int(c.get("retryCount") or 0) for c in openai["calls"])
        started = prior.get("startedAt") or started
        cases = prior.get("cases") or cases
        hold = any(item.get("status") not in {"LIVE_OK"} for item in cases)
        for item in cases:
            extra = v1_runs.get(item.get("caseId")) or {}
            if extra.get("v1GeneratedAfterHold"):
                item["v1GeneratedAfterHold"] = True
                item["v1Title"] = extra.get("v1Title")
    summary = {
        "artifact": "BLOG_V2_PHASE8_LIVE_E2E_ACCEPTANCE_V1",
        "gate": "A",
        "decision": "HOLD_PHASE8_GATE_A" if hold else "PHASE8_GATE_A_RUNTIME_READY",
        "productionActivationDecision": "PENDING_HUMAN_REVIEW",
        "startedAt": started,
        "completedAt": _now(),
        "fixture": fixture,
        "cases": cases,
        "openai": openai,
        "revalidationPath": "MISSING",
        "productionRouting": "v1",
        "attemptDir": ATTEMPT_DIR or None,
        "caseFilter": CASE_FILTER,
    }
    summary_path = OUT / ATTEMPT_DIR / "result.json" if ATTEMPT_DIR else OUT / "result.json"
    _dump(summary_path, summary)
    if not ATTEMPT_DIR:
        _write_html(summary)
    print(json.dumps({"decision": summary["decision"], "cases": [{k: c.get(k) for k in ('caseId', 'status', 'qualityGate', 'uiArtifactId')} for c in cases], "openai": {k: openai[k] for k in ("total", "plannerV2", "writerV2", "writerV1", "retries")}}, ensure_ascii=False, indent=2), flush=True)
    return 0 if not hold else 2


if __name__ == "__main__":
    raise SystemExit(main())
