from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy.orm import Session

from content_center_engine import claim_gate_text
from content_shorts import normalize_highlights
from db import ContentProductInfo, ContentSkuScope
from settings_store import get_api_settings


WRITER_ENGINE = "LLM_WRITER_V1"
WRITER_VERSION = "content_auto_writer_v1"
CONTENT_WRITER_MODEL = "gpt-5.5"
CHANNEL_STRATEGY: dict[str, dict[str, Any]] = {
    "blog": {
        "role": "search-informed commerce article",
        "goal": "Blend customer concerns with concrete product composition, ingredient context, and purchase guidance.",
        "structure": "SEO title candidates, persuasive lead, 4-6 natural H2 sections, conclusion, FAQ, CTA, SEO keywords, tags.",
        "tone": "warm Korean ecommerce editorial; practical and readable, never like a report or thesis",
        "image_style": "realistic Korean ecommerce/lifestyle photography; no typography or UI",
    },
    "instagram": {
        "role": "save-worthy carousel",
        "goal": "Stop the scroll, make one problem memorable, and drive profile/product-detail action.",
        "structure": "hook, 7-10 slides in 4:5 portrait with one buyer question or idea per slide, proof-oriented caption, CTA, hashtags.",
        "tone": "commercial, concrete, benefit-led Korean social copy without exaggeration",
        "image_style": "clean square product/lifestyle scene with negative space for text overlays",
    },
    "shorts": {
        "role": "short-form video script",
        "goal": "Deliver a watchable 15-35 second sequence with a first-3-second hook, early product presence, one proof/demo, and CTA.",
        "structure": "hook, 4-6 scenes with duration, shootable visual direction, spoken script, subtitle, transition, CTA.",
        "tone": "natural spoken Korean, fast but credible, production-ready",
        "image_style": "vertical 9:16 realistic shot direction suitable for short-form video frames",
    },
}
CHANNEL_PRODUCTION_STANDARDS: dict[str, dict[str, Any]] = {
    "blog": {
        "required_structure": ["title_candidates", "selected_title", "lead", "sections", "faq", "cta", "seo_keywords", "tags"],
        "section_count": {"min": 4, "max": 6},
        "faq_count": {"min": 3},
        "seo_keyword_count": {"min": 5},
        "tag_count": {"min": 4},
        "lead_chars": {"min": 140, "max": 420},
        "section_body_chars": {"min": 240, "max": 950},
        "conclusion_chars": {"min": 120, "max": 520},
        "cta_chars": {"min": 50, "max": 320},
        "total_export_chars": {"min": 1800, "max": 5200},
        "required_image_count": "one image prompt per section",
    },
    "instagram": {
        "required_structure": ["hook", "slides", "caption", "cta", "hashtags"],
        "aspect_ratio": "4:5",
        "slide_count": {"min": 7, "max": 10},
        "headline_chars": {"min": 6, "max": 34},
        "body_chars": {"min": 18, "max": 90},
        "caption_chars": {"min": 120, "max": 700},
        "hashtag_count": {"min": 4, "max": 14},
        "total_export_chars": {"min": 700, "max": 2200},
        "required_image_count": "one image prompt per slide",
    },
    "shorts": {
        "required_structure": ["hook", "scenes", "cta", "caption"],
        "scene_count": {"min": 4, "max": 6},
        "total_duration_sec": {"min": 15, "max": 35},
        "spoken_script_chars": {"min": 18, "max": 120},
        "subtitle_chars": {"min": 4, "max": 40},
        "total_export_chars": {"min": 430, "max": 1800},
        "required_image_count": "one vertical frame prompt per scene",
    },
}
SYSTEM_VOCABULARY_BLOCKLIST = (
    "Evidence",
    "evidence",
    "최근 6개월 Evidence",
    "고객이 반복해서 표현한",
    "고객이 실제로 남긴 표현",
    "이 글에서 다루는 고민",
    "작성합니다",
    "설명합니다",
    "BLOG SECTION IMAGE",
    "INSTAGRAM POST DRAFT",
    "data:image/svg+xml",
    "placeholder",
    "샘플",
)


class ContentWriterError(RuntimeError):
    pass


def _api_setting(db: Session, name: str) -> str:
    value = str(get_api_settings(db, [name]).get(name, "") or "").strip()
    return value or str(os.getenv(name) or "").strip()


def _clean_text(value: Any, limit: int = 1000) -> str:
    text = " ".join(str(value or "").replace("\x00", " ").split())
    return text[:limit].strip()


def _json_loads(value: str | None) -> Any:
    try:
        return json.loads(value or "")
    except Exception:
        return None


def _as_list(value: Any, limit: int = 12) -> list[Any]:
    if not isinstance(value, list):
        return []
    return value[:limit]


def _active_writer_model() -> str:
    return str(os.getenv("CONTENT_WRITER_MODEL") or CONTENT_WRITER_MODEL).strip()


def _compact_evidence_snippets(evidence: list[Any], limit: int = 6) -> list[str]:
    out: list[str] = []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        snippet = _clean_text(item.get("snippet"), 180)
        if snippet and snippet not in out:
            out.append(snippet)
        if len(out) >= limit:
            break
    return out


def _normalize_product_info_items(value: Any) -> list[dict[str, str]]:
    raw_items = value if isinstance(value, list) else []
    out: list[dict[str, str]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        product_name = _clean_text(item.get("product_name") or item.get("productName") or item.get("name"), 120)
        full_ingredients = _clean_text(item.get("full_ingredients") or item.get("fullIngredients") or item.get("ingredients"), 700)
        note = _clean_text(item.get("note"), 240)
        ingredient_note = _clean_text(item.get("ingredient_note") or item.get("ingredientNote"), 360)
        source_note = _clean_text(item.get("source_note") or item.get("sourceNote"), 360)
        if not product_name and not full_ingredients and not note and not ingredient_note and not source_note:
            continue
        out.append(
            {
                "product_name": product_name,
                "full_ingredients": full_ingredients,
                "note": note,
                "ingredient_note": ingredient_note,
                "source_note": source_note,
            }
        )
        if len(out) >= 6:
            break
    return out


def _product_info_context(db: Session, sku_id: str) -> dict[str, Any]:
    sku = str(sku_id or "").strip()
    if not sku:
        return {"available": False, "items": [], "full_ingredients": "", "ingredient_note": "", "source_note": ""}
    row = db.get(ContentProductInfo, sku)
    if row is None:
        return {"available": False, "items": [], "full_ingredients": "", "ingredient_note": "", "source_note": ""}
    parsed: Any = []
    if row.product_items_json:
        try:
            parsed = json.loads(row.product_items_json or "[]")
        except Exception:
            parsed = []
    items = _normalize_product_info_items(parsed)
    if not items and str(row.full_ingredients or "").strip():
        items = [
            {
                "product_name": "",
                "full_ingredients": _clean_text(row.full_ingredients, 700),
                "note": "",
                "ingredient_note": _clean_text(row.ingredient_note, 360),
                "source_note": _clean_text(row.source_note, 360),
            }
        ]
    return {
        "available": bool(items or row.full_ingredients or row.ingredient_note or row.source_note),
        "items": items,
        "full_ingredients": _clean_text(row.full_ingredients, 900),
        "ingredient_note": _clean_text(row.ingredient_note, 500),
        "source_note": _clean_text(row.source_note, 500),
    }


def build_generation_context(
    db: Session,
    *,
    appeal: dict[str, Any],
    channel: str,
    sku_title: str,
    regenerate_instruction: str | None = None,
    previous_artifact: dict[str, Any] | None = None,
    shorts_config: dict[str, Any] | None = None,
    source_content: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sku_id = str(appeal.get("sku_id") or "").strip()
    scope = db.query(ContentSkuScope).filter(ContentSkuScope.sku_id == sku_id).one_or_none() if sku_id else None
    insight = appeal.get("insight") if isinstance(appeal.get("insight"), dict) else {}
    evidence = _as_list(appeal.get("evidence"), 12)
    customer_language = insight.get("customer_language") if isinstance(insight.get("customer_language"), list) else []
    product_title = _clean_text(sku_title or getattr(scope, "title", "") or appeal.get("target") or "제품", 160)
    channel0 = str(channel or "").strip().lower()
    evidence_snippets = _compact_evidence_snippets(evidence)
    product_info = _product_info_context(db, sku_id)
    component_names = [
        item.get("product_name") or item.get("note") or f"구성 제품 {idx + 1}"
        for idx, item in enumerate(product_info.get("items") or [])
        if isinstance(item, dict)
    ]
    detail_page_context: list[dict[str, Any]] = []
    try:
        from content_center_assets import detail_page_context_for_sku

        detail_page_context = detail_page_context_for_sku(db, sku_id, limit=3)
    except Exception:
        detail_page_context = []
    production_standard = CHANNEL_PRODUCTION_STANDARDS.get(channel0, {})
    shorts_extra: dict[str, Any] = {}
    if channel0 == "shorts" and isinstance(shorts_config, dict) and shorts_config.get("resolved"):
        from content_shorts import production_standard_for, writer_directives

        production_standard = production_standard_for(shorts_config, production_standard)
        shorts_extra = {"shorts_generation_config": shorts_config.get("resolved"), "shorts_directives": writer_directives(shorts_config)}
    if isinstance(source_content, dict) and source_content.get("excerpt"):
        shorts_extra["source_content"] = {
            "channel": _clean_text(source_content.get("channel"), 40),
            "title": _clean_text(source_content.get("title"), 240),
            "excerpt": str(source_content.get("excerpt") or "")[:3500],
            "rule": "Convert this existing approved content into the target channel. Keep its facts; do not add new claims.",
        }
        if channel0 == "shorts" and source_content.get("artifact_id"):
            shorts_extra["source_content"]["artifact_id"] = _clean_text(source_content.get("artifact_id"), 80)
    if channel0 == "shorts" and isinstance(previous_artifact, dict) and isinstance(previous_artifact.get("body"), dict):
        previous_artifact = {**previous_artifact, "body": {k: v for k, v in previous_artifact["body"].items() if k != "shorts_grounding"}}
    context = {
        **shorts_extra,
        "writer_version": WRITER_VERSION,
        "writer_model": _active_writer_model(),
        "channel": channel0,
        "channel_strategy": CHANNEL_STRATEGY.get(channel0, {}),
        "production_standard": production_standard,
        "product": {
            "sku_id": sku_id,
            "title": product_title,
            "product_group": getattr(scope, "product_group", None),
            "product_url": getattr(scope, "product_url", None),
            "component_products": product_info.get("items") or [],
            "ingredient_reference_available": bool(product_info.get("available")),
            "ingredient_reference_note": product_info.get("ingredient_note") or "",
            "ingredient_source_note": product_info.get("source_note") or "",
            "confirmed_facts": [
                item for item in [
                    f"상품명: {product_title}" if product_title else "",
                    f"제품군: {getattr(scope, 'product_group', '')}" if getattr(scope, "product_group", None) else "",
                    f"SKU 구성 제품: {', '.join(component_names)}" if component_names else "",
                    f"원료/성분 메모: {product_info.get('ingredient_note')}" if product_info.get("ingredient_note") else "",
                    f"자료 출처 메모: {product_info.get('source_note')}" if product_info.get("source_note") else "",
                ] if item
            ],
        },
        "appeal": {
            "appeal_id": appeal.get("appeal_id"),
            "label": _clean_text(appeal.get("label"), 240),
            "appeal_text": _clean_text(appeal.get("appeal_text"), 500),
            "claim_class": appeal.get("claim_class"),
            "legal_risk": appeal.get("legal_risk"),
            "safety_gate": appeal.get("safety_gate"),
            "recommendation": appeal.get("recommendation"),
            "usage_types": appeal.get("usage_types"),
            "emerging": appeal.get("emerging"),
        },
        "insight": {
            "problem": _clean_text(insight.get("problem") or appeal.get("label"), 500),
            "desire": _clean_text(insight.get("desire"), 500),
            "barrier": _clean_text(insight.get("barrier"), 500),
            "motivation": _clean_text(insight.get("motivation"), 500),
            "usage_situation": _clean_text(insight.get("usage_situation"), 500),
        },
        "evidence": [
            {
                "source_type": item.get("source_type"),
                "snippet": _clean_text(item.get("snippet"), 450),
                "metric": _json_loads(item.get("metric_json")) if isinstance(item, dict) else None,
                **({"evidence_ref": _clean_text(item.get("evidence_id"), 80), "source_id": _clean_text(item.get("source_pk"), 160)} if channel0 == "shorts" and _clean_text(item.get("evidence_id"), 80) else {}),
            }
            for item in evidence
            if isinstance(item, dict) and _clean_text(item.get("snippet"), 450)
        ],
        "customer_language": [_clean_text(item, 160) for item in _as_list(customer_language, 10)],
        "commercial_brief": {
            "primary_problem": _clean_text(insight.get("problem") or appeal.get("label"), 220),
            "desired_outcome": _clean_text(insight.get("desire") or appeal.get("appeal_text"), 220),
            "purchase_barrier": _clean_text(insight.get("barrier"), 220),
            "usage_situation": _clean_text(insight.get("usage_situation"), 220),
            "proof_snippets": evidence_snippets,
            "creative_angle": _clean_text(appeal.get("appeal_text") or insight.get("motivation") or appeal.get("label"), 260),
            "product_ingredient_reference": product_info,
            "must_sound_like": [
                "실제 고객이 바로 읽고 저장하거나 클릭할 수 있는 완성 문안",
                "근거 기반이지만 내부 분석 용어가 보이지 않는 커머스 콘텐츠",
                "해당 SKU의 구성 제품과 전성분을 반영한 구체적 설명",
                "고객 리뷰만 요약하지 않고 제품 특징, 구성, 원료 맥락, 사용 장면을 함께 풀어낸 글",
                "헤나/허브팩/두피·모발 관리 카테고리에 맞는 전문가 톤",
            ],
            "must_avoid": [
                "샘플, 예시, placeholder, 내부 지시문",
                "의학적 치료/개선 보장, 과장된 효능, 제공되지 않은 성분/인증 주장",
                "제품정보에 없는 원료, 성분 효능, 인증, 임상 결과를 새로 만들어내는 표현",
                "본문과 무관한 범용 루틴 반복",
            ],
        },
        "detail_page_reference": detail_page_context,
        "rules": {
            "hard_constraints": [
                "Write consumer-facing content, not an internal brief.",
                "Do not mention Evidence, 6-month analysis, data pipeline, AI, system, or writer instructions.",
                "Do not claim medical treatment, cure, guaranteed effects, or facts not provided in product.confirmed_facts.",
                "Use product.component_products and commercial_brief.product_ingredient_reference when explaining ingredients; if no ingredient reference is available, do not invent ingredient names.",
                "Ingredient roles and efficacy wording must be cautious commerce/category language, not medical or guaranteed effect claims.",
                "For blog drafts, do not let review snippets dominate the whole article; balance customer voice with product facts, ingredient/full-ingredient context, product characteristics, conclusion, and CTA.",
                "For blog drafts, H2 headings must sound natural and helpful to shoppers, not like academic/report section titles.",
                "Do not output placeholder/sample text or data:image/svg+xml.",
                "Keep image fields pending unless a real generated image URL is provided by a separate image generation step.",
                "Every paragraph or scene must be tied to the selected appeal, customer problem, or proof snippets.",
                "Make image prompts concrete enough for image generation: setting, subject, lighting, composition, and product/lifestyle context.",
            ],
            "image_contract": {
                "initial_status": "PENDING",
                "image_must_be_null_until_generated": True,
            },
        },
        "regenerate_instruction": _clean_text(regenerate_instruction, 1000),
        "previous_artifact": previous_artifact or None,
    }
    if channel0 == "shorts":
        from content_shorts_claims import writer_claim_contract, writer_source_catalog

        context["source_catalog"] = writer_source_catalog(context)
        context["claim_contract"] = writer_claim_contract()
    return context


def _messages_for_channel(context: dict[str, Any]) -> list[dict[str, str]]:
    channel = context["channel"]
    if channel == "blog":
        schema = {
            "title_candidates": ["string", "string", "string"],
            "selected_title": "string",
            "creative_brief": "one sentence commercial angle",
            "lead": "consumer-facing paragraph",
            "sections": [{"heading": "natural H2, question/situation style, not report style", "body": "2-4 complete paragraphs mixing customer need, product info, ingredients, usage, and purchase guidance", "proof_point": "string", "image_prompt": "concrete visual scene, no text overlay"}],
            "conclusion": "closing paragraph that summarizes choice criteria and leads naturally to CTA",
            "faq": [{"question": "string", "answer": "string"}],
            "cta": "string",
            "seo_keywords": ["string"],
            "tags": ["string"],
            "compliance_notes": ["claim-safe note"],
        }
    elif channel == "instagram":
        schema = {
            "content_type": "carousel",
            "aspect_ratio": "4:5",
            "hook": "string",
            "slides": [{"slide_no": 1, "headline": "string", "body": "string", "proof": "short proof or benefit", "visual_brief": "concrete visual scene, no text overlay"}],
            "caption": "string",
            "cta": "string",
            "hashtags": ["#tag"],
            "compliance_notes": ["claim-safe note"],
        }
    elif channel == "shorts":
        schema = {
            "hook": "string",
            "estimated_duration": 25,
            "scenes": [
                {
                    "scene_no": 1,
                    "duration": 4,
                    "visual_direction": "shootable visual direction",
                    "spoken_script": "actual spoken words",
                    "subtitle": "actual subtitle",
                    "on_screen_text": "actual screen text",
                    "transition": "string",
                    "shot_prompt": "single vertical frame image prompt, no text overlay",
                    "stage": "use shorts_directives.scene_plan[].stage when provided, else hook|problem_product|demo_proof|routine|cta",
                    "highlight_keywords": ["0-2 short phrases copied exactly from subtitle"],
                    "claims": [
                        {
                            "claimType": "PRODUCT_FACT|USAGE_FACT|CATEGORY_FACT|CUSTOMER_EXPERIENCE|EDITORIAL_BRIDGE",
                            "field": "spoken_script|subtitle|on_screen_text",
                            "claimText": "exact substring of that field",
                            "canonicalStatement": "the proposition as one plain sentence",
                            "anchorTerms": ["exact key term also present in the cited source text"],
                            "evidenceRefs": ["exact source_catalog[].ref; empty only for EDITORIAL_BRIDGE"],
                            "experienceKind": "PRODUCT_OUTCOME|PROBLEM_STATE (CUSTOMER_EXPERIENCE only)",
                        }
                    ],
                }
            ],
            "cta": "string",
            "caption": "string",
            "compliance_notes": ["claim-safe note"],
        }
    else:
        raise ContentWriterError(f"unsupported_writer_channel:{channel}")
    return [
        {
            "role": "system",
            "content": (
                "You are a senior Korean ecommerce content director for beauty and natural hair-care products. "
                "Return only valid JSON matching the requested schema. Write finished publishable content, not instructions. "
                "Use provided facts, selected appeal, customer language, and proof snippets only. "
                "Make the output commercial, concrete, channel-native, and safe for manual review."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "task": "Generate a publishable Korean commerce content draft and concrete image-generation briefs for the selected channel.",
                    "quality_bar": [
                        "not a sample",
                        "not a generic routine",
                        "specific to the product, appeal point, customer problem, and evidence snippets",
                        "for blog, include product composition, stored ingredient/full-ingredient context, product characteristics, and cautious benefit language in at least 1-2 sections",
                        "for blog, write natural H2 headings like a shopping guide, not report/thesis headings",
                        "for blog, include a real conclusion before the CTA",
                        "for shorts with shorts_directives, follow scene_plan order, stage, and durations; narration_tone changes wording only, never facts",
                        "for shorts, every scene lists claims that follow context.claim_contract and cite only context.source_catalog refs",
                        "when source_content is provided, rebuild it for the target channel while keeping its facts",
                        "ready for human review, editing, publishing, and performance tracking",
                        "meets the channel production standard for structure, text length, and image count",
                    ],
                    "context": context,
                    "production_standard": context.get("production_standard"),
                    "required_output_schema": schema,
                },
                ensure_ascii=False,
            ),
        },
    ]


def _call_openai_json(db: Session, *, channel: str, context: dict[str, Any]) -> dict[str, Any]:
    # Shorts carry per-scene claim ledgers, so they need a larger output budget.
    return call_writer_json(db, messages=_messages_for_channel(context), max_tokens=12000 if channel == "shorts" else 5000)


def call_writer_json(db: Session, *, messages: list[dict[str, str]], max_tokens: int) -> dict[str, Any]:
    """One chat completion with the active writer model; no retry."""
    key = _api_setting(db, "OPENAI_API_KEY")
    if not key:
        raise ContentWriterError("OPENAI_API_KEY not configured")
    model = _active_writer_model()
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "response_format": {"type": "json_object"},
    }
    if model.startswith("gpt-5"):
        payload["max_completion_tokens"] = max_tokens
    else:
        payload["temperature"] = 0.35
        payload["max_tokens"] = max_tokens
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=180,
    )
    if int(resp.status_code) != 200:
        raise ContentWriterError(f"openai_writer_error:{resp.status_code}:{str(resp.text or '')[:1200]}")
    body = resp.json() or {}
    content = (((body.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    try:
        out = json.loads(content)
    except Exception as exc:
        raise ContentWriterError("openai_writer_invalid_json") from exc
    if not isinstance(out, dict):
        raise ContentWriterError("openai_writer_json_not_object")
    return out


def _fixture_writer_output(channel: str, context: dict[str, Any]) -> dict[str, Any]:
    product = context["product"]["title"]
    problem = context["insight"]["problem"] or context["appeal"]["label"]
    appeal_text = context["appeal"]["appeal_text"] or problem
    if channel == "blog":
        return {
            "title_candidates": [f"{product} 사용 전후 관리 루틴", f"{problem}를 줄이는 사용 전 체크", f"{product} 선택 전 확인할 관리법"],
            "selected_title": f"{product} 사용 전후 관리 루틴",
            "creative_brief": f"{problem}를 겪는 고객에게 {product} 사용 전후 루틴을 전문적으로 안내합니다.",
            "lead": f"{product}을 사용할 때는 원하는 색감뿐 아니라 사용 전후의 관리 흐름까지 함께 챙기는 것이 중요합니다. {problem}가 걱정된다면 준비, 사용, 마무리 단계를 나누어 확인해야 만족도가 높아집니다. 아래 기준은 처음 구매를 고민하는 고객이 바로 따라볼 수 있는 실전 체크리스트입니다.",
            "sections": [
                {"heading": "사용 전 상태를 먼저 확인하세요", "body": f"사용 전에는 모발과 두피 상태를 먼저 살펴보고, 사용 시간을 무리하게 늘리지 않는 것이 좋습니다. {appeal_text}를 기대한다면 안내된 사용법과 본인의 컨디션을 함께 기준으로 삼아야 합니다. 특히 반복 관리가 필요한 고객은 사용 전 빗질, 보호 준비, 대기 시간 계획을 정해두면 과정이 훨씬 안정적으로 느껴집니다. 구매를 고민하는 단계에서는 이 준비 과정이 복잡하지 않은지 확인하는 것만으로도 실제 사용 부담을 줄일 수 있습니다.", "proof_point": "사용 전 체크가 사용 만족도를 좌우합니다.", "image_prompt": "자연광이 들어오는 욕실 선반 위에 놓인 헤나 제품, 브러시, 수건, 장갑을 차분하게 배치한 프리미엄 라이프스타일 사진"},
                {"heading": "염색 후에는 헹굼과 보습이 중요합니다", "body": "사용 후에는 잔여물이 남지 않도록 충분히 헹구고 모발 끝 중심으로 보습 관리를 더해보세요. 색감 확인만큼 마무리 루틴이 사용 만족도에 영향을 줄 수 있습니다. 허브팩이나 보습 케어를 함께 계획하면 염색 직후의 뻣뻣함 걱정을 줄이고 다음 관리 시점까지 루틴을 이어가기 쉽습니다. 이 단계는 제품을 한 번 쓰고 끝내는 것이 아니라 반복 관리 습관으로 이어주는 핵심 구간입니다. 사용 후 관리법을 미리 알고 구매한 고객은 제품을 받았을 때 바로 실행할 수 있어 이탈 가능성도 낮아집니다.", "proof_point": "마무리 루틴은 재구매와 반복 사용 경험에 영향을 줍니다.", "image_prompt": "밝은 욕실에서 모발 끝에 헤어팩을 부드럽게 바르는 손 동작, 제품 패키지가 자연스럽게 보이는 클로즈업"},
                {"heading": "처음이라면 작은 루틴부터 시작하세요", "body": "처음 사용하는 제품은 한 번에 많은 변화를 기대하기보다 사용법에 맞춰 천천히 적응하는 편이 좋습니다. 사용 후 느낌을 확인하며 본인에게 맞는 간격을 찾아보세요. 제품 상세의 사용법, 준비물, 사용 후 관리법을 함께 확인하면 구매 전 불안이 줄고 실제 사용 장면을 더 쉽게 떠올릴 수 있습니다. 처음 고객에게는 과장된 결과보다 내가 바로 따라 할 수 있는 순서가 더 설득력 있게 작동합니다. 그래서 콘텐츠는 사용 전 체크, 사용 중 주의, 사용 후 관리까지 하나의 흐름으로 보여줘야 합니다.", "proof_point": "첫 사용자는 작고 명확한 루틴을 선호합니다.", "image_prompt": "수건, 빗, 헤나 제품, 관리 도구가 정돈된 세면대 플랫레이, 따뜻한 조명과 깨끗한 배경"},
                {"heading": "구매 전에는 내 관리 목적과 맞춰보세요", "body": "구매 전에는 단순히 가격이나 용량만 보기보다 내가 원하는 관리 목적과 사용 빈도를 함께 비교하는 것이 좋습니다. 새치 관리, 자연스러운 색감, 염색 후 케어처럼 고객마다 우선순위가 다르기 때문입니다. 제품 상세페이지에서 구성, 사용 순서, 함께 쓰기 좋은 관리 제품을 확인하면 실제 루틴을 더 구체적으로 계획할 수 있습니다. 특히 처음 구매하는 고객에게는 준비물과 사용 후 케어까지 한 번에 보이는 안내가 전환을 돕는 핵심 정보가 됩니다.", "proof_point": "구매 전 목적 정리는 전환 장벽을 줄입니다.", "image_prompt": "노트에 관리 체크리스트를 적고 제품 구성과 빗, 수건을 함께 놓은 따뜻한 홈케어 테이블 사진"},
            ],
            "faq": [
                {"question": "사용 전 무엇을 확인해야 하나요?", "answer": "두피와 모발 상태, 안내된 사용 시간, 헹굼 방법을 먼저 확인하는 것이 좋습니다."},
                {"question": "사용 후 관리는 어떻게 하나요?", "answer": "충분히 헹군 뒤 모발 끝 중심으로 보습 루틴을 더해보세요."},
                {"question": "처음 구매할 때 무엇을 비교하면 좋나요?", "answer": "내가 원하는 관리 목적, 사용 빈도, 준비물, 사용 후 케어 방법을 함께 확인해보는 것이 좋습니다."},
            ],
            "conclusion": f"{product}을 선택할 때는 리뷰에서 보이는 고민만 볼 것이 아니라 구성 제품, 전성분, 사용 전후 관리 흐름을 함께 확인하는 것이 좋습니다. 내 모발 상태와 관리 목적에 맞는지 차분히 비교하면 구매 후 실제 사용 루틴까지 더 쉽게 이어갈 수 있습니다.",
            "cta": f"{product}의 구성과 사용법을 확인하고 본인에게 맞는 관리 루틴을 선택해보세요. 구매 전에는 사용 시간, 준비물, 헹굼, 사용 후 보습 관리까지 함께 체크하면 실제 사용 장면을 더 쉽게 판단할 수 있습니다.",
            "seo_keywords": [product, "헤나 염색", "새치 관리", "두피 관리", "염색 후 관리"],
            "tags": ["헤나", "새치관리", "염색루틴", "두피케어"],
        }
    if channel == "instagram":
        return {
            "content_type": "carousel",
            "hook": f"{problem}, 사용 전후 루틴이 중요합니다",
            "slides": [
                {"slide_no": 1, "headline": "염색 전 먼저 체크", "body": "두피와 모발 상태를 확인하고 사용 시간을 미리 정해두세요.", "proof": "준비가 쉬우면 반복 관리도 편해집니다.", "visual_brief": "욕실 선반 위 제품, 브러시, 장갑을 정돈한 프리미엄 플랫레이"},
                {"slide_no": 2, "headline": "내 상태에 맞게 준비", "body": "푸석함이나 두피 민감도가 걱정된다면 사용 전 컨디션을 먼저 확인하세요.", "proof": "상태 확인이 루틴의 시작입니다.", "visual_brief": "거울 앞에서 모발 상태를 살피는 손동작과 제품 패키지"},
                {"slide_no": 3, "headline": "사용 시간은 무리 없이", "body": "처음부터 욕심내기보다 안내된 사용법 안에서 내 루틴을 잡는 편이 좋습니다.", "proof": "과한 기대보다 반복 가능한 관리가 중요합니다.", "visual_brief": "타이머와 제품, 장갑이 함께 놓인 깨끗한 욕실 장면"},
                {"slide_no": 4, "headline": "헹굼은 충분하게", "body": "사용 후 잔여물이 남지 않도록 꼼꼼히 헹구는 루틴이 중요합니다.", "proof": "마무리 경험이 만족도를 좌우합니다.", "visual_brief": "밝은 욕실에서 머리를 부드럽게 헹구는 자연스러운 라이프스타일 장면"},
                {"slide_no": 5, "headline": "마무리는 보습 관리", "body": "모발 끝 중심으로 관리 루틴을 더하면 사용 후 느낌을 정돈할 수 있습니다.", "proof": "염색 후 케어까지 함께 제안합니다.", "visual_brief": "모발 끝에 케어 제품을 바르는 손과 깨끗한 수건이 보이는 클로즈업"},
                {"slide_no": 6, "headline": "반복 관리가 쉬워야 해요", "body": "새치 관리는 한 번보다 다음 관리까지 이어지는 흐름이 더 중요합니다.", "proof": "반복 가능한 루틴이 구매 장벽을 낮춥니다.", "visual_brief": "제품과 캘린더, 관리 도구가 함께 놓인 홈케어 테이블"},
                {"slide_no": 7, "headline": "구매 전 확인할 것", "body": "제품 구성, 준비물, 사용 후 케어 방법을 상세페이지에서 함께 확인하세요.", "proof": "구매 전 불안을 줄이는 체크포인트입니다.", "visual_brief": "제품 상세를 확인하는 스마트폰 옆에 놓인 헤나 제품과 빗"},
                {"slide_no": 8, "headline": "저장해두고 확인", "body": f"{product} 사용 전후에 다시 볼 체크리스트로 루틴을 정리해보세요.", "proof": "실행 가능한 루틴을 한 번에 정리합니다.", "visual_brief": "정돈된 제품과 수건, 빗이 놓인 따뜻한 톤의 욕실 플랫레이"},
            ],
            "caption": f"{product}을 사용할 때는 {appeal_text}를 기준으로 사용 전후 루틴을 함께 확인해보세요. 준비, 사용 시간, 헹굼, 보습 관리까지 한 번에 정리해두면 처음 쓰는 고객도 더 편하게 시작할 수 있습니다.",
            "cta": "상세 사용법 확인하기",
            "hashtags": ["#헤나", "#새치관리", "#염색루틴", "#두피관리"],
            "compliance_notes": ["효능 보장 대신 사용 전후 루틴과 고객 경험 중심으로 표현"],
        }
    return {
        "hook": f"{problem}가 걱정된다면 사용 전후 루틴부터 확인하세요.",
        "estimated_duration": 30,
        "scenes": [
            {"scene_no": 1, "duration": 4, "stage": "hook", "visual_direction": "첫 프레임부터 제품과 관리 도구를 보여주는 세로형 오프닝", "spoken_script": f"{product}을 쓰기 전, 먼저 확인할 루틴이 있습니다.", "subtitle": "사용 전 먼저 체크", "on_screen_text": "염색 전 체크", "transition": "cut", "shot_prompt": "세로형 화면, 욕실 선반 위 헤나 제품과 브러시, 장갑을 따뜻한 자연광으로 촬영한 오프닝 컷"},
            {"scene_no": 2, "duration": 6, "stage": "problem_product", "visual_direction": "거울 앞에서 두피와 모발 상태를 확인하고 제품을 손에 드는 장면", "spoken_script": "두피와 모발 상태를 보고 사용 시간과 준비물을 먼저 정해두세요.", "subtitle": "내 상태에 맞게", "on_screen_text": "두피·모발 상태", "transition": "soft cut", "shot_prompt": "세로형 화면, 거울 앞에서 모발 상태를 확인하는 손동작과 정돈된 제품 패키지"},
            {"scene_no": 3, "duration": 7, "stage": "demo_proof", "visual_direction": "사용 전 준비물과 제품을 순서대로 보여주는 짧은 데모", "spoken_script": "장갑, 빗, 수건을 미리 준비하면 사용 과정이 더 안정적으로 이어집니다.", "subtitle": "준비물 먼저", "on_screen_text": "준비물 체크", "transition": "cut", "shot_prompt": "세로형 화면, 장갑과 빗, 수건, 헤나 제품을 순서대로 보여주는 손동작 클로즈업"},
            {"scene_no": 4, "duration": 7, "stage": "routine", "visual_direction": "헹굼과 모발 끝 보습 관리 장면", "spoken_script": "사용 후에는 충분히 헹구고 모발 끝 중심으로 보습 루틴을 더해보세요.", "subtitle": "헹굼과 보습", "on_screen_text": "마무리 관리", "transition": "wipe", "shot_prompt": "세로형 화면, 밝은 욕실에서 모발 끝에 케어 제품을 바르는 클로즈업"},
            {"scene_no": 5, "duration": 6, "stage": "cta", "visual_direction": "제품과 체크리스트를 떠올리게 하는 CTA 엔딩", "spoken_script": "상세 사용법을 확인하고 나에게 맞는 관리 루틴을 선택해보세요.", "subtitle": "사용법 확인하기", "on_screen_text": "자세히 보기", "transition": "fade", "shot_prompt": "세로형 화면, 제품과 수건, 빗이 정돈된 프리미엄 욕실 플랫레이 엔딩 컷"},
        ],
        "cta": "자세히 보기",
        "caption": f"{product} 사용 전후 관리 루틴을 짧게 정리했습니다. 준비물, 사용 시간, 헹굼, 마무리 케어를 저장해두고 상세 사용법과 함께 확인해보세요.",
        "compliance_notes": ["사용 루틴 중심으로 표현하고 효과 보장 표현은 제외"],
    }


def _writer_output(db: Session, *, channel: str, context: dict[str, Any]) -> dict[str, Any]:
    if os.getenv("CONTENT_WRITER_TEST_FIXTURE") == "1":
        return _fixture_writer_output(channel, context)
    return _call_openai_json(db, channel=channel, context=context)


def _should_retry_writer_error(exc: ContentWriterError) -> bool:
    text = str(exc)
    return text.startswith("writer_output_standard_failed:") or text in {
        "writer_output_too_short",
        "blog_writer_sections_too_few",
        "instagram_writer_slides_too_few",
        "shorts_writer_scenes_too_few",
        "blog_writer_missing_title_or_lead",
        "writer_output_missing_product_info",
    }


def _contains_blocked_text(value: Any) -> str | None:
    blob = json.dumps(value, ensure_ascii=False)
    for token in SYSTEM_VOCABULARY_BLOCKLIST:
        if token and token in blob:
            return token
    return None


def _char_len(value: Any) -> int:
    return len(_clean_text(value, 10000))


def _assert_range(name: str, value: int, *, min_value: int | None = None, max_value: int | None = None) -> None:
    if min_value is not None and value < min_value:
        raise ContentWriterError(f"writer_output_standard_failed:{name}_too_short:{value}<{min_value}")
    if max_value is not None and value > max_value:
        raise ContentWriterError(f"writer_output_standard_failed:{name}_too_long:{value}>{max_value}")


def _standard_min(standard: dict[str, Any], key: str, default: int = 0) -> int:
    spec = standard.get(key) if isinstance(standard.get(key), dict) else {}
    return int(spec.get("min") or default)


def _standard_max(standard: dict[str, Any], key: str, default: int = 999999) -> int:
    spec = standard.get(key) if isinstance(standard.get(key), dict) else {}
    return int(spec.get("max") or default)


def _validate_blog_standard(payload: dict[str, Any], standard: dict[str, Any]) -> None:
    blog = payload.get("blog") if isinstance(payload.get("blog"), dict) else {}
    sections = blog.get("sections") if isinstance(blog.get("sections"), list) else []
    _assert_range("blog_sections", len(sections), min_value=_standard_min(standard, "section_count", 3), max_value=_standard_max(standard, "section_count", 5))
    _assert_range("blog_lead", _char_len(blog.get("lead") or blog.get("intro")), min_value=_standard_min(standard, "lead_chars", 90), max_value=_standard_max(standard, "lead_chars", 320))
    for idx, section in enumerate(sections, start=1):
        if not isinstance(section, dict):
            raise ContentWriterError(f"writer_output_standard_failed:blog_section_{idx}_invalid")
        _assert_range(f"blog_section_{idx}_body", _char_len(section.get("body")), min_value=_standard_min(standard, "section_body_chars", 160), max_value=_standard_max(standard, "section_body_chars", 900))
        if not _clean_text(section.get("image_prompt"), 300):
            raise ContentWriterError(f"writer_output_standard_failed:blog_section_{idx}_image_prompt_missing")
    faq = blog.get("faq") if isinstance(blog.get("faq"), list) else []
    seo = blog.get("seo_keywords") if isinstance(blog.get("seo_keywords"), list) else []
    tags = blog.get("tags") if isinstance(blog.get("tags"), list) else []
    _assert_range("blog_conclusion", _char_len(blog.get("conclusion")), min_value=_standard_min(standard, "conclusion_chars", 100), max_value=_standard_max(standard, "conclusion_chars", 500))
    _assert_range("blog_cta", _char_len(blog.get("cta")), min_value=_standard_min(standard, "cta_chars", 40), max_value=_standard_max(standard, "cta_chars", 320))
    _assert_range("blog_faq", len(faq), min_value=_standard_min(standard, "faq_count", 2))
    _assert_range("blog_seo_keywords", len(seo), min_value=_standard_min(standard, "seo_keyword_count", 4))
    _assert_range("blog_tags", len(tags), min_value=_standard_min(standard, "tag_count", 3))


def _validate_instagram_standard(payload: dict[str, Any], standard: dict[str, Any]) -> None:
    expected_aspect = str(standard.get("aspect_ratio") or "").strip()
    if expected_aspect and str(payload.get("aspect_ratio") or "").strip() != expected_aspect:
        raise ContentWriterError(f"writer_output_standard_failed:instagram_aspect_ratio:{payload.get('aspect_ratio')}!={expected_aspect}")
    slides = payload.get("slides") if isinstance(payload.get("slides"), list) else []
    _assert_range("instagram_slides", len(slides), min_value=_standard_min(standard, "slide_count", 4), max_value=_standard_max(standard, "slide_count", 6))
    proof_count = 0
    for idx, slide in enumerate(slides, start=1):
        if not isinstance(slide, dict):
            raise ContentWriterError(f"writer_output_standard_failed:instagram_slide_{idx}_invalid")
        layers = slide.get("layers") if isinstance(slide.get("layers"), list) else []
        by_type = {str(layer.get("type") or ""): str(layer.get("text") or "") for layer in layers if isinstance(layer, dict)}
        _assert_range(f"instagram_slide_{idx}_headline", _char_len(by_type.get("headline")), min_value=_standard_min(standard, "headline_chars", 6), max_value=_standard_max(standard, "headline_chars", 34))
        _assert_range(f"instagram_slide_{idx}_body", _char_len(by_type.get("subcopy")), min_value=_standard_min(standard, "body_chars", 18), max_value=_standard_max(standard, "body_chars", 90))
        if _clean_text(by_type.get("proof"), 120):
            proof_count += 1
        if not _clean_text(slide.get("image_prompt") or slide.get("visual_brief"), 300):
            raise ContentWriterError(f"writer_output_standard_failed:instagram_slide_{idx}_image_prompt_missing")
    _assert_range("instagram_caption", _char_len(payload.get("caption")), min_value=_standard_min(standard, "caption_chars", 100), max_value=_standard_max(standard, "caption_chars", 700))
    hashtags = payload.get("hashtags") if isinstance(payload.get("hashtags"), list) else []
    _assert_range("instagram_hashtags", len(hashtags), min_value=_standard_min(standard, "hashtag_count", 4), max_value=_standard_max(standard, "hashtag_count", 14))
    _assert_range("instagram_proof_layers", proof_count, min_value=2)


def _validate_shorts_standard(payload: dict[str, Any], standard: dict[str, Any]) -> None:
    shorts = payload.get("shorts") if isinstance(payload.get("shorts"), dict) else {}
    scenes = shorts.get("scenes") if isinstance(shorts.get("scenes"), list) else payload.get("scenes")
    scenes = scenes if isinstance(scenes, list) else []
    _assert_range("shorts_scenes", len(scenes), min_value=_standard_min(standard, "scene_count", 4), max_value=_standard_max(standard, "scene_count", 6))
    total_duration = 0
    for idx, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            raise ContentWriterError(f"writer_output_standard_failed:shorts_scene_{idx}_invalid")
        total_duration += int(scene.get("duration_sec") or 0)
        _assert_range(f"shorts_scene_{idx}_spoken_script", _char_len(scene.get("voice_over") or scene.get("spoken_script")), min_value=_standard_min(standard, "spoken_script_chars", 18), max_value=_standard_max(standard, "spoken_script_chars", 120))
        _assert_range(f"shorts_scene_{idx}_subtitle", _char_len(scene.get("subtitle") or scene.get("on_screen_text") or scene.get("caption")), min_value=_standard_min(standard, "subtitle_chars", 4), max_value=_standard_max(standard, "subtitle_chars", 40))
        if not _clean_text(scene.get("visual_prompt") or scene.get("image_prompt") or scene.get("visual_direction"), 300):
            raise ContentWriterError(f"writer_output_standard_failed:shorts_scene_{idx}_image_prompt_missing")
    _assert_range("shorts_total_duration", total_duration, min_value=_standard_min(standard, "total_duration_sec", 20), max_value=_standard_max(standard, "total_duration_sec", 35))


def _validate_channel_standard(*, channel: str, payload: dict[str, Any], context: dict[str, Any], export_text: str) -> None:
    standard = context.get("production_standard") if isinstance(context.get("production_standard"), dict) else CHANNEL_PRODUCTION_STANDARDS.get(channel, {})
    if not standard:
        return
    _assert_range(
        f"{channel}_total_export",
        _char_len(export_text),
        min_value=_standard_min(standard, "total_export_chars", 180),
        max_value=_standard_max(standard, "total_export_chars", 10000),
    )
    if channel == "blog":
        _validate_blog_standard(payload, standard)
    elif channel == "instagram":
        _validate_instagram_standard(payload, standard)
    elif channel == "shorts":
        _validate_shorts_standard(payload, standard)


def _validate_common(db: Session, *, channel: str, payload: dict[str, Any], context: dict[str, Any], export_text: str) -> None:
    public_payload = {k: v for k, v in payload.items() if k not in {"generation_context_summary", "lineage", "revision", "shorts_grounding"}}
    if channel == "shorts":
        public_payload = json.loads(json.dumps(public_payload, ensure_ascii=False))
        containers = [public_payload] + ([public_payload["shorts"]] if isinstance(public_payload.get("shorts"), dict) else [])
        for container in containers:
            for scene in container.get("scenes") or []:
                if isinstance(scene, dict):
                    scene.pop("claims", None)
    blocked = _contains_blocked_text(public_payload) or _contains_blocked_text(export_text)
    if blocked:
        raise ContentWriterError(f"writer_output_blocked_token:{blocked}")
    if not export_text or len(export_text.strip()) < 180:
        raise ContentWriterError("writer_output_too_short")
    gate = claim_gate_text(db, export_text)
    if not gate.get("allowed"):
        raise ContentWriterError("writer_output_claim_gate_failed")
    product_title = _clean_text(context["product"]["title"], 160)
    product_tokens = [
        token.strip()
        for token in product_title.replace("/", " ").replace("·", " ").replace("-", " ").split()
        if len(token.strip()) >= 2
    ]
    product_tokens = product_tokens[:6]
    if product_tokens and not any(token in export_text for token in product_tokens):
        raise ContentWriterError("writer_output_missing_product")
    if channel == "blog":
        product_info = ((context.get("commercial_brief") or {}).get("product_ingredient_reference") or {}) if isinstance(context.get("commercial_brief"), dict) else {}
        if isinstance(product_info, dict) and product_info.get("available"):
            ingredient_terms = ["전성분", "성분", "원료", "함유", "구성 제품", "제품 구성"]
            if not any(term in export_text for term in ingredient_terms):
                raise ContentWriterError("writer_output_missing_product_info")
    _validate_channel_standard(channel=channel, payload=payload, context=context, export_text=export_text)


def _normalize_blog(raw: dict[str, Any]) -> dict[str, Any]:
    sections = []
    for idx, section in enumerate(_as_list(raw.get("sections"), 8), start=1):
        if not isinstance(section, dict):
            continue
        heading = _clean_text(section.get("heading"), 120)
        body = _clean_text(section.get("body"), 1600)
        if not heading or len(body) < 80:
            continue
        sections.append(
            {
                "heading": heading,
                "body": body,
                "proof_point": _clean_text(section.get("proof_point") or section.get("proof"), 240),
                "image": None,
                "image_status": "PENDING",
                "image_prompt": _clean_text(section.get("image_prompt") or section.get("visual_brief") or heading, 300),
                "visual_brief": _clean_text(section.get("visual_brief") or section.get("image_prompt") or heading, 300),
            }
        )
    if len(sections) < 3:
        raise ContentWriterError("blog_writer_sections_too_few")
    title = _clean_text(raw.get("selected_title") or (_as_list(raw.get("title_candidates"), 1)[0] if _as_list(raw.get("title_candidates"), 1) else ""), 160)
    lead = _clean_text(raw.get("lead") or raw.get("intro"), 800)
    if not title or len(lead) < 60:
        raise ContentWriterError("blog_writer_missing_title_or_lead")
    conclusion = _clean_text(raw.get("conclusion") or raw.get("closing") or raw.get("summary"), 700)
    tags = [_clean_text(x, 30).lstrip("#") for x in _as_list(raw.get("tags"), 12) if _clean_text(x, 30)]
    seo = [_clean_text(x, 80) for x in _as_list(raw.get("seo_keywords"), 12) if _clean_text(x, 80)]
    faq = []
    for item in _as_list(raw.get("faq"), 8):
        if not isinstance(item, dict):
            continue
        question = _clean_text(item.get("question") or item.get("q"), 160)
        answer = _clean_text(item.get("answer") or item.get("a"), 500)
        if question and answer:
            faq.append({"question": question, "answer": answer})
    cta = _clean_text(raw.get("cta"), 300)
    export = "\n\n".join(
        [title, lead]
        + [f"## {s['heading']}\n{s['body']}\n[Image pending: {s['image_prompt']}]" for s in sections]
        + ([f"## 마무리\n{conclusion}"] if conclusion else [])
        + (["## FAQ"] + [f"Q. {item['question']}\nA. {item['answer']}" for item in faq] if faq else [])
        + ([f"## CTA\n{cta}"] if cta else [])
        + ([f"SEO Keywords: {', '.join(seo)}"] if seo else [])
        + ([f"Tags: {' '.join('#' + tag for tag in tags)}"] if tags else [])
    ).strip()
    blog = {
        "title": title,
        "lead": lead,
        "intro": lead,
        "creative_brief": _clean_text(raw.get("creative_brief"), 300),
        "sections": sections,
        "conclusion": conclusion,
        "faq": faq,
        "cta": cta,
        "seo_keywords": seo,
        "tags": tags,
        "image_plan": {"required_count": len(sections), "unit": "blog_section", "aspect_ratio": "landscape"},
        "compliance_notes": [_clean_text(x, 160) for x in _as_list(raw.get("compliance_notes"), 6) if _clean_text(x, 160)],
    }
    return {"title": title, "format": "blog", "blog": blog, "sections": sections, "image_plan": blog["image_plan"], "export_text": export}


def _normalize_instagram(raw: dict[str, Any]) -> dict[str, Any]:
    slides = []
    for idx, slide in enumerate(_as_list(raw.get("slides"), 10), start=1):
        if not isinstance(slide, dict):
            continue
        headline = _clean_text(slide.get("headline"), 54)
        body = _clean_text(slide.get("body") or slide.get("subcopy"), 120)
        if not headline or not body:
            continue
        visual = _clean_text(slide.get("visual_brief") or slide.get("image_prompt") or headline, 220)
        slides.append(
            {
                "order": int(slide.get("slide_no") or idx),
                "image": None,
                "image_status": "PENDING",
                "image_prompt": visual,
                "visual_brief": visual,
                "layers": [
                    {"type": "headline", "text": headline, "x": 0.08, "y": 0.12, "w": 0.84, "h": 0.22},
                    {"type": "subcopy", "text": body, "x": 0.10, "y": 0.42, "w": 0.80, "h": 0.20},
                    {"type": "proof", "text": _clean_text(slide.get("proof"), 80), "x": 0.10, "y": 0.64, "w": 0.80, "h": 0.14},
                    {"type": "cta", "text": _clean_text(raw.get("cta"), 40), "x": 0.18, "y": 0.82, "w": 0.64, "h": 0.10},
                ],
            }
        )
    if len(slides) < 4:
        raise ContentWriterError("instagram_writer_slides_too_few")
    hook = _clean_text(raw.get("hook") or slides[0]["layers"][0]["text"], 100)
    caption = _clean_text(raw.get("caption"), 800)
    hashtags = [_clean_text(x, 30) for x in _as_list(raw.get("hashtags"), 16) if _clean_text(x, 30)]
    export = "\n\n".join([f"[Slide {s['order']}]\n" + "\n".join(layer["text"] for layer in s["layers"] if layer.get("text")) for s in slides] + [caption, " ".join(hashtags)]).strip()
    return {
        "title": hook,
        "format": "instagram_carousel_v1",
        "content_type": raw.get("content_type") or "carousel",
        "aspect_ratio": "4:5",
        "hook": hook,
        "slides": slides,
        "caption": caption,
        "cta": _clean_text(raw.get("cta"), 80),
        "hashtags": hashtags,
        "image_slots": [{"slide_no": s["order"], "image_status": "PENDING", "visual_brief": s["visual_brief"]} for s in slides],
        "image_plan": {"required_count": len(slides), "unit": "instagram_slide", "aspect_ratio": "4:5"},
        "compliance_notes": [_clean_text(x, 160) for x in _as_list(raw.get("compliance_notes"), 6) if _clean_text(x, 160)],
        "export_text": export,
    }


def _fit_scene_durations(scenes: list[dict[str, Any]], target_total: int) -> None:
    current = sum(int(s["duration_sec"]) for s in scenes)
    if not scenes or target_total <= 0 or current == target_total:
        return
    scaled = [max(2, int(round(int(s["duration_sec"]) * target_total / max(1, current)))) for s in scenes]
    longest = max(range(len(scaled)), key=lambda i: scaled[i])
    scaled[longest] = max(2, scaled[longest] + target_total - sum(scaled))
    for scene, sec in zip(scenes, scaled):
        scene["duration_sec"] = sec


def _normalize_shorts(raw: dict[str, Any], target_total: int | None = None) -> dict[str, Any]:
    scenes = []
    for idx, scene in enumerate(_as_list(raw.get("scenes"), 12), start=1):
        if not isinstance(scene, dict):
            continue
        spoken = _clean_text(scene.get("spoken_script") or scene.get("voice_over"), 260)
        subtitle = _clean_text(scene.get("subtitle") or scene.get("on_screen_text"), 90)
        legacy_visual = scene.get("visual_asset") if isinstance(scene.get("visual_asset"), str) else ""
        visual = _clean_text(scene.get("visual_direction") or legacy_visual, 240)
        if not spoken or not subtitle or not visual:
            continue
        visual_prompt = _clean_text(scene.get("visual_prompt") or scene.get("shot_prompt") or scene.get("image_prompt") or visual, 260)
        scenes.append(
            {
                "order": int(scene.get("scene_no") or idx),
                "duration_sec": max(2, min(12, int(float(scene.get("duration") or scene.get("duration_sec") or 4)))),
                "caption": subtitle,
                "subtitle": subtitle,
                "on_screen_text": _clean_text(scene.get("on_screen_text") or subtitle, 90),
                "voice_over": spoken,
                "spoken_script": spoken,
                "visual_prompt": visual_prompt,
                "visual_asset": None,
                "visual_direction": visual,
                "image_prompt": visual_prompt,
                "visual_status": "PENDING",
                "transition": _clean_text(scene.get("transition") or "cut", 40),
                "cta": _clean_text(scene.get("cta"), 80),
                "stage": _clean_text(scene.get("stage"), 40),
                "highlight_keywords": normalize_highlights(subtitle, scene.get("highlight_keywords")),
            }
        )
        if isinstance(scene.get("claims"), list):
            from content_shorts_claims import normalize_writer_claims

            scenes[-1]["claims"] = normalize_writer_claims(scene["claims"], scenes[-1]["order"])
    if len(scenes) < 3:
        raise ContentWriterError("shorts_writer_scenes_too_few")
    if target_total:
        _fit_scene_durations(scenes, int(target_total))
    hook = _clean_text(raw.get("hook") or scenes[0]["caption"], 120)
    cta = _clean_text(raw.get("cta") or scenes[-1].get("cta"), 120)
    caption = _clean_text(raw.get("caption"), 500)
    total = sum(int(s["duration_sec"]) for s in scenes)
    shorts = {
        "title": hook,
        "format": "shorts_scene_timeline_v1",
        "aspect_ratio": "9:16",
        "estimated_duration": int(total if target_total else (raw.get("estimated_duration") or total)),
        "scenes": scenes,
        "cta": cta,
        "caption": caption,
        "image_plan": {"required_count": len(scenes), "unit": "shorts_scene", "aspect_ratio": "9:16"},
        "compliance_notes": [_clean_text(x, 160) for x in _as_list(raw.get("compliance_notes"), 6) if _clean_text(x, 160)],
    }
    export = "\n\n".join(
        f"[Scene {scene['order']} | {scene['duration_sec']}s]\nOn-screen: {scene['on_screen_text']}\nSubtitle: {scene['subtitle']}\nVoice-over: {scene['voice_over']}\nVisual: {scene['visual_direction']}\nTransition: {scene['transition']}\nCTA: {scene['cta']}"
        for scene in scenes
    )
    return {"title": hook, "format": "shorts_scene_timeline_v1", "aspect_ratio": "9:16", "shorts": shorts, "scenes": scenes, "caption": caption, "cta": cta, "image_plan": shorts["image_plan"], "export_text": export}


def write_channel_content(
    db: Session,
    *,
    context: dict[str, Any],
) -> dict[str, Any]:
    channel = str(context.get("channel") or "").strip().lower()
    fixture_mode = os.getenv("CONTENT_WRITER_TEST_FIXTURE") == "1"
    attempts = 1 if fixture_mode else 3
    attempt_context = dict(context)
    last_error: ContentWriterError | None = None
    for attempt_no in range(1, attempts + 1):
        raw = _writer_output(db, channel=channel, context=attempt_context)
        if channel == "blog":
            payload = _normalize_blog(raw)
        elif channel == "instagram":
            payload = _normalize_instagram(raw)
        elif channel == "shorts":
            directives = context.get("shorts_directives") if isinstance(context.get("shorts_directives"), dict) else {}
            payload = _normalize_shorts(raw, target_total=directives.get("target_total_duration_sec"))
        else:
            raise ContentWriterError(f"unsupported_writer_channel:{channel}")
        payload["generation_engine"] = WRITER_ENGINE
        payload["writer_version"] = WRITER_VERSION
        payload["generated_at"] = datetime.now(timezone.utc).isoformat()
        payload["generation_context_summary"] = {
            "channel": channel,
            "writer_model": context.get("writer_model") or _active_writer_model(),
            "channel_strategy": context.get("channel_strategy") or {},
            "production_standard": context.get("production_standard") or {},
            "appeal_id": context.get("appeal", {}).get("appeal_id"),
            "sku_id": context.get("product", {}).get("sku_id"),
            "evidence_count": len(context.get("evidence") or []),
            "regenerate_instruction": context.get("regenerate_instruction") or None,
            "attempt_no": attempt_no,
        }
        try:
            _validate_common(db, channel=channel, payload=payload, context=context, export_text=str(payload.get("export_text") or ""))
            if channel == "shorts":
                from content_shorts_claims import attach_shorts_grounding

                attach_shorts_grounding(payload, context)
            return payload
        except ContentWriterError as exc:
            last_error = exc
            if attempt_no >= attempts or fixture_mode or not _should_retry_writer_error(exc):
                raise
            attempt_context = dict(context)
            attempt_context["quality_repair_instruction"] = (
                f"Previous output failed production validation: {exc}. "
                "Regenerate from scratch and satisfy every production_standard count, length, image prompt, and channel structure requirement."
            )
    raise last_error or ContentWriterError("writer_output_failed")
