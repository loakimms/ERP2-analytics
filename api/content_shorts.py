from __future__ import annotations

import hashlib
import os
import re
from typing import Any

SHORTS_CONFIG_VERSION = "shorts_generation_config_v1"
SHORTS_SCENE_VISUAL_CONTRACT = "shorts_scene_visual_v1"
SHORTS_SCENE_PLAN_VERSION = "shorts_scene_plan_v1"
SHORTS_RENDER_PLAN_VERSION = "shorts_render_plan_v1"
AUTO = "AUTO"

STAGES: dict[str, dict[str, Any]] = {
    "HOOK": {"label": "후킹", "purpose": "첫 3초 안에 시청자의 고민/호기심을 붙잡는다", "weight": 0.6, "product": False},
    "PROBLEM": {"label": "문제 공감", "purpose": "고객이 실제로 겪는 불편을 구체적인 장면으로 보여준다", "weight": 1.0, "product": False},
    "INFO": {"label": "전문 정보", "purpose": "원리/성분/선택 기준 등 제공된 사실로 신뢰를 만든다", "weight": 1.2, "product": False},
    "MYTH": {"label": "오해 짚기", "purpose": "흔한 오해나 몰랐던 사실을 꺼낸다", "weight": 1.0, "product": False},
    "PRODUCT": {"label": "제품", "purpose": "제품을 화면에 분명히 보여주고 핵심 가치를 연결한다", "weight": 1.2, "product": True},
    "PRODUCT_POINT_1": {"label": "핵심 포인트 1", "purpose": "제품 특징 1을 장면 하나로 보여준다", "weight": 1.0, "product": True},
    "PRODUCT_POINT_2": {"label": "핵심 포인트 2", "purpose": "제품 특징 2를 장면 하나로 보여준다", "weight": 1.0, "product": True},
    "PRODUCT_POINT_3": {"label": "핵심 포인트 3", "purpose": "제품 특징 3을 장면 하나로 보여준다", "weight": 1.0, "product": True},
    "BEFORE": {"label": "사용 전 고민", "purpose": "후기 작성자가 사용 전에 겪던 상황", "weight": 0.9, "product": False},
    "EXPERIENCE": {"label": "고객 경험", "purpose": "실제 고객 표현을 바탕으로 사용 경험을 전한다", "weight": 1.1, "product": False},
    "PROOF": {"label": "근거", "purpose": "리뷰/수치 등 제공된 근거를 한 장면으로 보여준다", "weight": 1.0, "product": False},
    "STEP_1": {"label": "사용 1단계", "purpose": "사용 순서 1단계", "weight": 1.0, "product": True},
    "STEP_2": {"label": "사용 2단계", "purpose": "사용 순서 2단계", "weight": 1.0, "product": True},
    "STEP_3": {"label": "사용 3단계", "purpose": "사용 순서 3단계", "weight": 1.0, "product": True},
    "CRITERIA_1": {"label": "선택 기준 1", "purpose": "구매 전에 확인할 기준 1", "weight": 1.0, "product": False},
    "CRITERIA_2": {"label": "선택 기준 2", "purpose": "구매 전에 확인할 기준 2", "weight": 1.0, "product": False},
    "CTA": {"label": "CTA", "purpose": "다음 행동(상세 확인/저장/구매)을 자연스럽게 안내한다", "weight": 0.6, "product": True},
}

STORY_TYPES: list[dict[str, Any]] = [
    {"id": "PRODUCT_TOP3", "label": "제품 핵심 3가지", "purpose": "제품 특징 소개", "stages": ["HOOK", "PRODUCT_POINT_1", "PRODUCT_POINT_2", "PRODUCT_POINT_3", "CTA"]},
    {"id": "CUSTOMER_PROBLEM_SOLUTION", "label": "고객 고민 → 제품", "purpose": "문제 해결형", "stages": ["HOOK", "PROBLEM", "INFO", "PRODUCT", "EXPERIENCE", "CTA"]},
    {"id": "REAL_REVIEW", "label": "실제 후기", "purpose": "리뷰/경험 중심", "stages": ["HOOK", "BEFORE", "EXPERIENCE", "PROOF", "PRODUCT", "CTA"]},
    {"id": "DID_YOU_KNOW", "label": "이것 알고 계셨나요?", "purpose": "전문 정보", "stages": ["HOOK", "MYTH", "INFO", "PRODUCT", "CTA"]},
    {"id": "HOWTO_3STEP", "label": "사용법 3단계", "purpose": "How-to", "stages": ["HOOK", "STEP_1", "STEP_2", "STEP_3", "CTA"]},
    {"id": "BUYING_GUIDE", "label": "제품 선택 기준", "purpose": "구매 고려형", "stages": ["HOOK", "CRITERIA_1", "CRITERIA_2", "PRODUCT", "CTA"]},
]

VISUAL_TEMPLATES: list[dict[str, Any]] = [
    {"id": "DYNAMIC_CUT_V1", "label": "Dynamic Cut", "description": "빠른 컷 전환과 줌으로 리듬감 있게", "motion": ["zoom_in", "pan_left", "zoom_out", "pan_right"], "transition": "cut", "subtitlePosition": "center", "preview": "dynamic"},
    {"id": "MAGAZINE_V1", "label": "Magazine", "description": "여백과 큰 타이틀, 잡지 화보 느낌", "motion": ["pan_up", "zoom_in"], "transition": "fade", "subtitlePosition": "top", "preview": "magazine"},
    {"id": "CLEAN_PRODUCT_V1", "label": "Clean Product", "description": "제품 컷 중심, 깔끔한 배경과 천천히 확대", "motion": ["zoom_in", "zoom_in_slow"], "transition": "crossfade", "subtitlePosition": "bottom", "preview": "clean"},
    {"id": "REVIEW_CARD_V1", "label": "Review Card", "description": "후기 카드가 차례로 올라오는 리뷰형", "motion": ["slide_up", "zoom_in_slow"], "transition": "slide", "subtitlePosition": "card", "preview": "review"},
]

PACES: list[dict[str, Any]] = [
    {"id": "NORMAL", "label": "보통", "charsPerSec": 6.5, "cutsPerScene": 1},
    {"id": "FAST", "label": "속도감 있게", "charsPerSec": 7.5, "cutsPerScene": 2},
]

DURATIONS = [15, 30, 45]

NARRATION_TONES: list[dict[str, Any]] = [
    {"id": "INFORMATIVE", "label": "정보 전달형", "sample": "알고 계셨나요?"},
    {"id": "EMPATHY", "label": "공감형", "sample": "저도 처음에는 이것 때문에 고민했어요."},
    {"id": "DISCOVERY", "label": "발견형", "sample": "이걸 왜 이제 알았지?"},
    {"id": "REVIEW", "label": "후기형", "sample": "직접 써본 사람들은 이런 얘기를 합니다."},
    {"id": "EXPERT", "label": "전문가 설명형", "sample": "헤나가 색을 내는 원리부터 보면..."},
    {"id": "PROBLEM_RAISING", "label": "문제 제기형", "sample": "새치가 금방 다시 올라와 고민이라면..."},
    {"id": "RECOMMEND", "label": "추천형", "sample": "이런 분이라면 한번 살펴볼 만합니다."},
    {"id": "HOWTO", "label": "사용법형", "sample": "처음 사용한다면 이 순서만 기억하세요."},
]

TTS_PROVIDER_CONFIG: dict[str, Any] = {
    "provider": "OPENAI",
    "sourceType": "OPENAI_TTS",
    "model": os.getenv("CONTENT_TTS_MODEL") or "gpt-4o-mini-tts",
    "endpoint": "https://api.openai.com/v1/audio/speech",
    "responseFormat": "wav",
    "masterFormat": "WAV_MASTER",
    "mimeType": "audio/wav",
    "instructionProfileVersion": "shorts_tts_instr_v1",
    "language": "ko",
}
VOICE_PROVIDER = {"provider": "openai", "model": TTS_PROVIDER_CONFIG["model"], "status": "CONNECTED", "note": "선택한 목소리에 따라 OpenAI 또는 Gemini TTS로 장면별 음성을 만들고 재사용합니다. 실패 시 다른 목소리로 자동 전환하지 않습니다. AI 생성 음성이므로 게시 시 고지가 필요합니다."}
VOICE_PREVIEW_TEXT = "안녕하세요. 자연스럽고 편안한 목소리로 콘텐츠를 소개해 드릴게요."
VOICE_PREVIEW_TONE = "PREVIEW"
VOICES: list[dict[str, Any]] = [
    {"voiceId": "VOICE_F_BRIGHT", "styleKey": "BRIGHT_FEMALE", "displayName": "아린", "gender": "female", "ageStyle": "20~30대", "tone": "밝음", "provider": "openai", "providerVoice": "nova"},
    {"voiceId": "VOICE_F_CALM", "styleKey": "CALM_FEMALE", "displayName": "서윤", "gender": "female", "ageStyle": "30~40대", "tone": "차분함", "provider": "openai", "providerVoice": "shimmer"},
    {"voiceId": "VOICE_F_WARM", "styleKey": "WARM_FEMALE", "displayName": "하은", "gender": "female", "ageStyle": "30대", "tone": "따뜻함", "provider": "openai", "providerVoice": "coral"},
    {"voiceId": "VOICE_M_PRO", "styleKey": "EXPERT_MALE", "displayName": "영준", "gender": "male", "ageStyle": "30~40대", "tone": "전문적", "provider": "openai", "providerVoice": "onyx"},
    {"voiceId": "VOICE_M_TRUST", "styleKey": "TRUST_MALE", "displayName": "가온", "gender": "male", "ageStyle": "40대", "tone": "신뢰감", "provider": "openai", "providerVoice": "echo"},
    {"voiceId": "VOICE_M_FRIENDLY", "styleKey": "FRIENDLY_MALE", "displayName": "도현", "gender": "male", "ageStyle": "20~30대", "tone": "친근함", "provider": "openai", "providerVoice": "ash"},
]
for _voice in VOICES:
    _voice.update(
        {
            "language": "ko-KR",
            "supportedLanguage": ["ko"],
            "providerVoiceId": _voice["providerVoice"],
            "uiGenderStyle": _voice["gender"],
            "uiAgeStyle": _voice["ageStyle"],
            "toneTags": [_voice["tone"]],
            "styleMetadataNote": "성별/연령은 UI 선택용 스타일 정보이며 실제 화자 정보가 아닙니다.",
            "active": True,
            "previewUrl": None,
            "previewAudioAssetId": None,
            "cost": "미리듣기는 최초 1회 생성 후 저장본 재사용",
            "commercialUse": "AI_VOICE_DISCLOSURE_REQUIRED",
        }
    )

# Gemini Structured TTS: request contract validated in calibration (one turn, no style annotation).
GEMINI_TTS_PROVIDER_CONFIG: dict[str, Any] = {
    "provider": "GEMINI",
    "sourceType": "GEMINI_TTS",
    "model": os.getenv("CONTENT_GEMINI_TTS_MODEL") or "gemini-3.8-flash-tts",
    "endpoint": "https://generativelanguage.googleapis.com/v1beta/interactions",
    "requestAdapter": "INTERACTIONS_SPEECH_CONFIG_V1",
    "stylePolicy": "NO_STYLE_V1",
    "generationMode": "ONE_TURN",
    "masterFormat": "WAV_MASTER",
    "mimeType": "audio/wav",
    "language": "ko",
}
GEMINI_VOICES: list[dict[str, Any]] = [
    {"voiceId": "GEMINI_KO_ASSISTANT_7", "styleKey": "GEMINI_ASSISTANT_7", "displayName": "어시스턴트 7", "gender": "female", "ageStyle": "40대", "tone": "친근함", "provider": "gemini", "providerVoice": "ko-kr-assistant-7"},
    {"voiceId": "GEMINI_KO_STORYTELLER_4", "styleKey": "GEMINI_STORYTELLER_4", "displayName": "스토리텔러 4", "gender": "female", "ageStyle": "20대", "tone": "따뜻함", "provider": "gemini", "providerVoice": "ko-kr-storyteller-4"},
    {"voiceId": "GEMINI_KORE", "styleKey": "GEMINI_KORE", "displayName": "Kore", "gender": "female", "ageStyle": "-", "tone": "또렷함", "provider": "gemini", "providerVoice": "Kore"},
    {"voiceId": "GEMINI_KO_TRAINING_4", "styleKey": "GEMINI_TRAINING_4", "displayName": "트레이닝 4", "gender": "male", "ageStyle": "40대", "tone": "자신감·명료", "provider": "gemini", "providerVoice": "ko-kr-training-4"},
    {"voiceId": "GEMINI_KO_CONCIERGE_5", "styleKey": "GEMINI_CONCIERGE_5", "displayName": "컨시어지 5", "gender": "female", "ageStyle": "50대", "tone": "자연스러움·명료", "provider": "gemini", "providerVoice": "ko-kr-concierge-5"},
    {"voiceId": "GEMINI_KO_TECHAGENT_7", "styleKey": "GEMINI_TECHAGENT_7", "displayName": "테크 어드바이저 7", "gender": "female", "ageStyle": "40대", "tone": "자연스러움·명료", "provider": "gemini", "providerVoice": "ko-kr-techagent-7"},
]
for _voice in GEMINI_VOICES:
    _voice.update(
        {
            "language": "ko-KR",
            "supportedLanguage": ["ko"],
            "providerVoiceId": _voice["providerVoice"],
            "model": GEMINI_TTS_PROVIDER_CONFIG["model"],
            "uiGenderStyle": _voice["gender"],
            "uiAgeStyle": _voice["ageStyle"],
            "toneTags": [_voice["tone"]],
            "styleMetadataNote": "성별/연령은 Gemini 목소리 설명 기반 UI 정보이며 실제 화자 정보가 아닙니다.",
            "active": True,
            "previewUrl": None,
            "previewAudioAssetId": None,
            "cost": "미리듣기는 최초 1회 생성 후 저장본 재사용",
            "commercialUse": "AI_VOICE_DISCLOSURE_REQUIRED",
        }
    )
ALL_VOICES: list[dict[str, Any]] = VOICES + GEMINI_VOICES

# Human-selected in CONTENT_TYPE_VOICE_PROFILE_BAKEOFF_V1 (full-video review). Only story types with
# real-video evidence are mapped; every other story type keeps the existing OpenAI recommendation.
VOICE_PROFILE_ROLE_LABELS = {"PRIMARY": "기본 추천", "SECONDARY": "대체", "RESERVE": "예비"}
VOICE_PROFILES: list[dict[str, Any]] = [
    {
        "id": "REVIEW_PROFILE", "label": "후기·경험형", "contentType": "REVIEW_EXPERIENCE", "status": "HUMAN_SELECTED_VOICE_PROFILE",
        "storyTypes": ["REAL_REVIEW"], "primary": "GEMINI_KO_ASSISTANT_7", "secondary": "GEMINI_KO_STORYTELLER_4", "reserve": ["GEMINI_KORE"],
        "stylePolicy": "NO_STYLE_V1", "evidence": "CONTENT_TYPE_VOICE_PROFILE_BAKEOFF_V1 · CT-33d607f330",
    },
    {
        "id": "INFORMATION_PROFILE", "label": "정보·설명형", "contentType": "INFORMATION", "status": "HUMAN_SELECTED_VOICE_PROFILE",
        "storyTypes": ["CUSTOMER_PROBLEM_SOLUTION"], "primary": "GEMINI_KO_TRAINING_4", "secondary": "GEMINI_KO_CONCIERGE_5", "reserve": ["GEMINI_KO_TECHAGENT_7"],
        "stylePolicy": "NO_STYLE_V1", "evidence": "CONTENT_TYPE_VOICE_PROFILE_BAKEOFF_V1 · CT-3a4690dd08",
    },
    {
        "id": "TECHNICAL_PROFILE", "label": "기술·전문형", "contentType": "TECHNICAL", "status": "DEFERRED",
        "storyTypes": [], "primary": None, "secondary": None, "reserve": [], "stylePolicy": "NO_STYLE_V1", "evidence": None,
    },
]
_PROFILE_BY_ID = {p["id"]: p for p in VOICE_PROFILES}
_PROFILE_FOR_STORY = {story: p for p in VOICE_PROFILES if p["status"] == "HUMAN_SELECTED_VOICE_PROFILE" for story in p["storyTypes"]}


def voice_profile_for_story(story_type: str) -> dict[str, Any] | None:
    return _PROFILE_FOR_STORY.get(str(story_type or ""))


def voice_profile_role(profile: dict[str, Any] | None, voice_id: str) -> str | None:
    if not profile:
        return None
    if voice_id == profile.get("primary"):
        return "PRIMARY"
    if voice_id == profile.get("secondary"):
        return "SECONDARY"
    if voice_id in (profile.get("reserve") or []):
        return "RESERVE"
    return None


def resolved_voice(voice_id: str, *, story_type: str, selection_source: str) -> dict[str, Any]:
    voice = _VOICE_BY_ID[voice_id]
    profile = voice_profile_for_story(story_type)
    return {
        "voiceId": voice_id,
        "style": voice["styleKey"],
        "provider": str(voice["provider"]).upper(),
        "profileId": profile["id"] if profile else None,
        "profileRole": voice_profile_role(profile, voice_id),
        "selectionSource": selection_source,
    }


TTS_TONE_INSTRUCTIONS: dict[str, str] = {
    "INFORMATIVE": "clear, calm and trustworthy",
    "EMPATHY": "warm, gentle and conversational",
    "DISCOVERY": "curious and lively, with light surprise",
    "REVIEW": "honest and friendly, like sharing a personal experience",
    "EXPERT": "confident, precise and measured",
    "PROBLEM_RAISING": "concerned but composed, drawing attention to the problem",
    "RECOMMEND": "friendly and reassuring, like a sincere recommendation",
    "HOWTO": "clear and steady, like guiding someone step by step",
    VOICE_PREVIEW_TONE: "natural, relaxed and pleasant",
}

MUSIC_PROVIDER_CONFIG: dict[str, Any] = {
    "source": "GEMINI_LYRIA",
    "provider": "GOOGLE",
    "model": os.getenv("CONTENT_MUSIC_MODEL") or "lyria-3-clip-preview",
    "endpoint": "https://generativelanguage.googleapis.com/v1beta/interactions",
    "outputMimeType": "audio/mpeg",
    "clipDurationSec": 30,
    "promptProfileVersion": "shorts_bgm_prompt_v1",
    "termsReference": "https://ai.google.dev/gemini-api/terms",
    "watermark": "SynthID",
}
MUSIC_PROVIDER = {"provider": "gemini", "model": MUSIC_PROVIDER_CONFIG["model"], "status": "CONNECTED", "note": "Gemini Lyria로 만든 BGM을 공용 음악 라이브러리에 저장해 여러 숏츠에서 재사용합니다. 상업적 이용 조건은 검수 후 기록합니다."}
MUSIC_APPROVAL_STATUSES = ("GENERATED", "APPROVED", "REJECTED", "DISABLED")
# Human approval only means "good enough as BGM"; commercial use is a separate authority.
MUSIC_COMMERCIAL_USE_STATUSES = ("UNVERIFIED", "VERIFIED_ALLOWED", "VERIFIED_RESTRICTED", "NOT_ALLOWED")
MUSIC_DURATION_STATUSES = ("MUSIC_DURATION_FIT", "MUSIC_LONG_ENOUGH", "MUSIC_EXTENSION_REQUIRED", "MUSIC_DURATION_UNKNOWN")
# No loop/extension renderer exists yet, so a track shorter than the video timeline cannot be used.
MUSIC_EXTENSION_SUPPORTED = False
MUSIC_MOOD_PROFILES: dict[str, dict[str, str]] = {
    "CALM": {"energy": "LOW", "feel": "calm, gentle and clean", "instruments": "soft piano, warm pads and light acoustic guitar", "tempo": "around 75 BPM"},
    "BRIGHT": {"energy": "MEDIUM", "feel": "bright, cheerful and fresh", "instruments": "ukulele, plucked guitar, soft claps and glockenspiel", "tempo": "around 105 BPM"},
    "EMOTIONAL": {"energy": "LOW", "feel": "emotional, tender and heartfelt", "instruments": "felt piano, soft strings and subtle cello", "tempo": "around 70 BPM"},
    "UPBEAT": {"energy": "HIGH", "feel": "upbeat, energetic and playful", "instruments": "clean funky electric guitar, bass and light drums", "tempo": "around 120 BPM"},
    "PREMIUM": {"energy": "MEDIUM", "feel": "premium, sophisticated and elegant", "instruments": "elegant piano, soft strings, deep minimal bass and light percussion", "tempo": "around 90 BPM"},
    "TRENDY": {"energy": "HIGH", "feel": "trendy, modern and stylish", "instruments": "modern pop synths with a crisp lo-fi hip hop beat", "tempo": "around 100 BPM"},
}
MUSIC_PROMPT_VARIANTS = ["", "Use a different arrangement, key and melodic motif from other takes in this mood."]
MUSIC_MOODS: list[dict[str, Any]] = [
    {"id": "CALM", "label": "차분함"},
    {"id": "BRIGHT", "label": "밝음"},
    {"id": "EMOTIONAL", "label": "감성"},
    {"id": "UPBEAT", "label": "경쾌"},
    {"id": "PREMIUM", "label": "고급"},
    {"id": "TRENDY", "label": "트렌디"},
]
MUSIC_TRACK_FIELDS = [
    "musicId", "title", "mood", "bpm", "durationSec", "fileUrl", "previewUrl",
    "licenseSource", "commercialUseAllowed", "platformUsage", "licenseExpiry", "attributionRequired",
    "generatedPrompt", "createdAt",
]
MUSIC_TRACKS: list[dict[str, Any]] = []

SUBTITLE_STYLES: list[dict[str, Any]] = [
    {"id": "SUB_BASIC", "label": "기본", "color": "#ffffff", "stroke": "none", "background": "rgba(15,23,42,0.55)", "highlightColor": "#facc15", "fontWeight": 800},
    {"id": "SUB_BOLD", "label": "강조형", "color": "#ffffff", "stroke": "#000000", "background": "none", "highlightColor": "#f43f5e", "fontWeight": 950},
    {"id": "SUB_OUTLINE", "label": "흰색+검정 테두리", "color": "#ffffff", "stroke": "#000000", "background": "none", "highlightColor": "#ffffff", "fontWeight": 900},
    {"id": "SUB_YELLOW", "label": "노랑 강조", "color": "#facc15", "stroke": "#000000", "background": "none", "highlightColor": "#ffffff", "fontWeight": 950},
    {"id": "SUB_KEYWORD", "label": "키워드 강조", "color": "#ffffff", "stroke": "#000000", "background": "none", "highlightColor": "#22d3ee", "fontWeight": 900},
    {"id": "SUB_NEWS", "label": "뉴스형", "color": "#ffffff", "stroke": "none", "background": "#1d4ed8", "highlightColor": "#facc15", "fontWeight": 900},
    {"id": "SUB_EMOTION", "label": "감성형", "color": "#fff7ed", "stroke": "none", "background": "rgba(120,53,15,0.35)", "highlightColor": "#fdba74", "fontWeight": 700},
]
HIGHLIGHT_MODES: list[dict[str, Any]] = [
    {"id": "NORMAL", "label": "강조 없음"},
    {"id": "KEYWORD_HIGHLIGHT", "label": "핵심 키워드 강조"},
    {"id": "HOOK_HIGHLIGHT", "label": "후킹 문구 강조"},
    {"id": "PRODUCT_HIGHLIGHT", "label": "제품 가치 강조"},
]

CONTENT_SOURCES: list[dict[str, Any]] = [
    {"id": "ARTIFACT", "label": "기존 콘텐츠에서 만들기", "enabled": True},
    {"id": "APPEAL", "label": "제품·소구에서 만들기", "enabled": True},
    {"id": "TOPIC", "label": "새 주제로 만들기", "enabled": True},
    {"id": "URL", "label": "URL 가져오기", "enabled": False, "note": "준비 중"},
]

_STORY_BY_ID = {item["id"]: item for item in STORY_TYPES}
_TEMPLATE_BY_ID = {item["id"]: item for item in VISUAL_TEMPLATES}
_PACE_BY_ID = {item["id"]: item for item in PACES}
_TONE_BY_ID = {item["id"]: item for item in NARRATION_TONES}
_VOICE_BY_ID = {item["voiceId"]: item for item in ALL_VOICES}
_MOOD_BY_ID = {item["id"]: item for item in MUSIC_MOODS}
_SUBTITLE_BY_ID = {item["id"]: item for item in SUBTITLE_STYLES}
_HIGHLIGHT_BY_ID = {item["id"]: item for item in HIGHLIGHT_MODES}
_TRACK_BY_ID = {str(item.get("musicId")): item for item in MUSIC_TRACKS}

_TEMPLATE_FOR_STORY = {
    "PRODUCT_TOP3": "CLEAN_PRODUCT_V1",
    "CUSTOMER_PROBLEM_SOLUTION": "DYNAMIC_CUT_V1",
    "REAL_REVIEW": "REVIEW_CARD_V1",
    "DID_YOU_KNOW": "MAGAZINE_V1",
    "HOWTO_3STEP": "DYNAMIC_CUT_V1",
    "BUYING_GUIDE": "MAGAZINE_V1",
}
_TONE_FOR_STORY = {
    "PRODUCT_TOP3": "DISCOVERY",
    "CUSTOMER_PROBLEM_SOLUTION": "EMPATHY",
    "REAL_REVIEW": "REVIEW",
    "DID_YOU_KNOW": "INFORMATIVE",
    "HOWTO_3STEP": "HOWTO",
    "BUYING_GUIDE": "RECOMMEND",
}
_VOICE_FOR_TONE = {
    "INFORMATIVE": "VOICE_F_CALM",
    "EMPATHY": "VOICE_F_WARM",
    "DISCOVERY": "VOICE_F_BRIGHT",
    "REVIEW": "VOICE_F_BRIGHT",
    "EXPERT": "VOICE_M_PRO",
    "PROBLEM_RAISING": "VOICE_M_TRUST",
    "RECOMMEND": "VOICE_F_CALM",
    "HOWTO": "VOICE_M_FRIENDLY",
}
_MOOD_FOR_TONE = {
    "INFORMATIVE": "CALM",
    "EMPATHY": "EMOTIONAL",
    "DISCOVERY": "BRIGHT",
    "REVIEW": "BRIGHT",
    "EXPERT": "PREMIUM",
    "PROBLEM_RAISING": "CALM",
    "RECOMMEND": "PREMIUM",
    "HOWTO": "UPBEAT",
}
_SUBTITLE_FOR_TEMPLATE = {
    "DYNAMIC_CUT_V1": "SUB_BOLD",
    "MAGAZINE_V1": "SUB_NEWS",
    "CLEAN_PRODUCT_V1": "SUB_BASIC",
    "REVIEW_CARD_V1": "SUB_EMOTION",
}


def shorts_registry() -> dict[str, Any]:
    return {
        "version": SHORTS_CONFIG_VERSION,
        "contentSources": CONTENT_SOURCES,
        "durations": DURATIONS,
        "storyTypes": [{**item, "stageDetails": [{"id": stage, **STAGES[stage]} for stage in item["stages"]]} for item in STORY_TYPES],
        "visualTemplates": VISUAL_TEMPLATES,
        "paces": PACES,
        "narrationTones": NARRATION_TONES,
        "voiceProvider": VOICE_PROVIDER,
        "voices": ALL_VOICES,
        "voiceProfiles": VOICE_PROFILES,
        "voiceProfileRoleLabels": VOICE_PROFILE_ROLE_LABELS,
        "musicProvider": MUSIC_PROVIDER,
        "ttsProvider": {k: TTS_PROVIDER_CONFIG[k] for k in ("provider", "model", "masterFormat", "instructionProfileVersion", "language")},
        "geminiTtsProvider": {k: GEMINI_TTS_PROVIDER_CONFIG[k] for k in ("provider", "model", "requestAdapter", "stylePolicy", "generationMode", "masterFormat", "language")},
        "musicProviderConfig": {k: MUSIC_PROVIDER_CONFIG[k] for k in ("source", "provider", "model", "outputMimeType", "clipDurationSec", "promptProfileVersion")},
        "musicApprovalStatuses": list(MUSIC_APPROVAL_STATUSES),
        "voicePreviewText": VOICE_PREVIEW_TEXT,
        "musicMoods": MUSIC_MOODS,
        "musicTrackFields": MUSIC_TRACK_FIELDS,
        "musicTracks": MUSIC_TRACKS,
        "subtitleStyles": SUBTITLE_STYLES,
        "highlightModes": HIGHLIGHT_MODES,
    }


def _pick(value: Any, allowed: dict[str, Any]) -> str:
    text = str(value or "").strip().upper()
    return text if text in allowed else AUTO


def _infer_story_type(hint: dict[str, Any]) -> str:
    text = " ".join(str(hint.get(key) or "") for key in ("title", "appeal_text", "source_channel", "source_title"))
    if re.search(r"사용법|방법|순서|루틴|하는 법|단계", text):
        return "HOWTO_3STEP"
    if re.search(r"선택|고르|비교|차이|기준", text):
        return "BUYING_GUIDE"
    if re.search(r"후기|리뷰|써보|재구매|만족", text):
        return "REAL_REVIEW"
    if re.search(r"원리|성분|알고|이유|왜|사실", text) or str(hint.get("source_channel") or "") == "blog":
        return "DID_YOU_KNOW"
    if int(hint.get("review_evidence_count") or 0) >= 3:
        return "REAL_REVIEW"
    return "CUSTOMER_PROBLEM_SOLUTION"


_ENERGY_PREFERENCE = {"FAST": ["HIGH", "MEDIUM", "LOW"], "NORMAL": ["MEDIUM", "LOW", "HIGH"]}


def music_commercial_status(track: dict[str, Any] | None) -> str:
    terms = (track or {}).get("termsMetadata") if isinstance((track or {}).get("termsMetadata"), dict) else {}
    status = str(terms.get("commercialUseStatus") or "").strip().upper()
    return status if status in MUSIC_COMMERCIAL_USE_STATUSES else "UNVERIFIED"


def music_duration_status(duration_ms: Any, required_duration_ms: int) -> dict[str, Any]:
    """Classify a track against the video timeline. Nothing is trimmed or looped here."""
    try:
        actual = int(duration_ms)
    except (TypeError, ValueError):
        return {"durationStatus": "MUSIC_DURATION_UNKNOWN", "requiredDurationMs": required_duration_ms, "excessMs": None, "shortfallMs": None}
    if actual == required_duration_ms:
        status = "MUSIC_DURATION_FIT"
    elif actual > required_duration_ms:
        status = "MUSIC_LONG_ENOUGH"
    else:
        status = "MUSIC_EXTENSION_REQUIRED"
    return {
        "durationStatus": status,
        "requiredDurationMs": required_duration_ms,
        "excessMs": max(0, actual - required_duration_ms),
        "shortfallMs": max(0, required_duration_ms - actual),
    }


def music_eligibility(track: dict[str, Any] | None, *, required_duration_ms: int) -> dict[str, Any]:
    """Production use (auto recommendation and assignment) needs APPROVED + VERIFIED_ALLOWED + a usable file and length."""
    track0 = track if isinstance(track, dict) else {}
    approval = str(track0.get("approvalStatus") or "")
    commercial = music_commercial_status(track0)
    duration = music_duration_status(track0.get("durationMs"), required_duration_ms)
    reasons: list[str] = []
    if approval != "APPROVED":
        reasons.append(f"HUMAN_REVIEW_{approval or 'MISSING'}")
    if commercial != "VERIFIED_ALLOWED":
        reasons.append(f"COMMERCIAL_USE_{commercial}")
    if not track0.get("url"):
        reasons.append("FILE_MISSING")
    if duration["durationStatus"] == "MUSIC_DURATION_UNKNOWN" or (duration["durationStatus"] == "MUSIC_EXTENSION_REQUIRED" and not MUSIC_EXTENSION_SUPPORTED):
        reasons.append(duration["durationStatus"])
    return {"humanReviewStatus": approval, "commercialUseStatus": commercial, **duration, "eligible": not reasons, "blockedReasons": reasons}


def rank_music_tracks(library: list[dict[str, Any]] | None, *, mood: str, story_type: str = "", pace: str = "NORMAL", required_duration_ms: int = 30000) -> list[dict[str, Any]]:
    """Deterministic AI recommendation: production-eligible only, exact mood, then content type, energy, low usage."""
    energy_order = _ENERGY_PREFERENCE.get(pace, _ENERGY_PREFERENCE["NORMAL"])
    candidates = [
        t for t in (library or [])
        if isinstance(t, dict) and mood in (t.get("moodTags") or []) and music_eligibility(t, required_duration_ms=required_duration_ms)["eligible"]
    ]

    def key(track: dict[str, Any]) -> tuple[Any, ...]:
        types = track.get("recommendedContentTypes") or []
        energy = str(track.get("energy") or "")
        return (
            0 if story_type and story_type in types else 1,
            energy_order.index(energy) if energy in energy_order else len(energy_order),
            int(track.get("usageCount") or 0),
            str(track.get("createdAt") or ""),
            str(track.get("musicId") or ""),
        )

    return sorted(candidates, key=key)


def resolve_shorts_config(raw: dict[str, Any] | None, *, hint: dict[str, Any] | None = None, music_library: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Normalize user selection and fill every AUTO field with an AI recommendation.

    `selected` keeps what the user chose (AUTO allowed) so regeneration can re-run
    recommendations, `resolved` is the concrete value used for writing/rendering.
    """
    src = raw if isinstance(raw, dict) else {}
    hint0 = hint if isinstance(hint, dict) else {}
    voice_raw = src.get("voice") if isinstance(src.get("voice"), dict) else {}
    music_raw = src.get("music") if isinstance(src.get("music"), dict) else {}
    subtitle_raw = src.get("subtitle") if isinstance(src.get("subtitle"), dict) else {}
    mode = "CUSTOM" if str(src.get("mode") or "").strip().upper() == "CUSTOM" else "QUICK"
    try:
        duration_raw = int(src.get("duration") or 0)
    except (TypeError, ValueError):
        duration_raw = 0
    music_required_ms = (duration_raw if duration_raw in DURATIONS else 30) * 1000
    selectable_tracks = {str(t.get("musicId")): t for t in (music_library or []) if isinstance(t, dict) and music_eligibility(t, required_duration_ms=music_required_ms)["eligible"]}
    requested_track = str(music_raw.get("trackId") or "").strip()
    selected = {
        "duration": duration_raw if duration_raw in DURATIONS else AUTO,
        "storyType": _pick(src.get("storyType"), _STORY_BY_ID),
        "templateId": _pick(src.get("templateId"), _TEMPLATE_BY_ID),
        "pace": _pick(src.get("pace"), _PACE_BY_ID),
        "voiceId": _pick(voice_raw.get("voiceId"), _VOICE_BY_ID),
        "narrationTone": _pick(src.get("narrationTone"), _TONE_BY_ID),
        "musicMood": "NONE" if str(music_raw.get("mood") or "").strip().upper() == "NONE" else _pick(music_raw.get("mood"), _MOOD_BY_ID),
        "musicTrackId": requested_track if requested_track in selectable_tracks else AUTO,
        "subtitleEnabled": subtitle_raw.get("enabled") is not False,
        "subtitleStyleId": _pick(subtitle_raw.get("styleId"), _SUBTITLE_BY_ID),
        "highlightMode": _pick(subtitle_raw.get("highlightMode"), _HIGHLIGHT_BY_ID),
    }
    if mode == "QUICK":
        for key in ("storyType", "templateId", "pace", "voiceId", "narrationTone", "subtitleStyleId", "highlightMode"):
            selected[key] = AUTO
        if selected["musicMood"] != "NONE":
            selected["musicMood"] = AUTO
        selected["musicTrackId"] = AUTO
    ai: list[str] = []
    story = selected["storyType"]
    if story == AUTO:
        story = _infer_story_type(hint0)
        ai.append("storyType")
    template = selected["templateId"]
    if template == AUTO:
        template = _TEMPLATE_FOR_STORY.get(story, "DYNAMIC_CUT_V1")
        ai.append("templateId")
    duration = selected["duration"]
    if duration == AUTO:
        duration = 30
        ai.append("duration")
    pace = selected["pace"]
    if pace == AUTO:
        pace = "FAST" if template == "DYNAMIC_CUT_V1" and int(duration) <= 15 else "NORMAL"
        ai.append("pace")
    tone = selected["narrationTone"]
    if tone == AUTO:
        tone = _TONE_FOR_STORY.get(story, "INFORMATIVE")
        ai.append("narrationTone")
    voice_id = selected["voiceId"]
    voice_source = "USER_SELECTED"
    if voice_id == AUTO:
        profile = voice_profile_for_story(story)
        voice_id = profile["primary"] if profile else _VOICE_FOR_TONE.get(tone, "VOICE_F_CALM")
        voice_source = "AI_RECOMMENDED"
        ai.append("voiceId")
    mood = selected["musicMood"]
    if mood == AUTO:
        mood = _MOOD_FOR_TONE.get(tone, "CALM")
        ai.append("musicMood")
    track_id = selected["musicTrackId"]
    if mood == "NONE":
        track_id = None
    elif track_id == AUTO:
        ranked = rank_music_tracks(music_library, mood=mood, story_type=story, pace=pace, required_duration_ms=int(duration) * 1000)
        track_id = str(ranked[0]["musicId"]) if ranked else None
        ai.append("musicTrackId")
    elif mood not in (selectable_tracks[track_id].get("moodTags") or []):
        mood = (selectable_tracks[track_id].get("moodTags") or [mood])[0]
    style_id = selected["subtitleStyleId"]
    if style_id == AUTO:
        style_id = _SUBTITLE_FOR_TEMPLATE.get(template, "SUB_BASIC")
        ai.append("subtitleStyleId")
    highlight = selected["highlightMode"]
    if highlight == AUTO:
        highlight = "HOOK_HIGHLIGHT" if story in {"CUSTOMER_PROBLEM_SOLUTION", "DID_YOU_KNOW"} else "KEYWORD_HIGHLIGHT"
        ai.append("highlightMode")
    try:
        volume = float(music_raw.get("volume"))
    except (TypeError, ValueError):
        volume = 0.18
    resolved = {
        "mode": mode,
        "duration": int(duration),
        "aspectRatio": "9:16",
        "storyType": story,
        "templateId": template,
        "pace": pace,
        "voice": resolved_voice(voice_id, story_type=story, selection_source=voice_source),
        "narrationTone": tone,
        "music": {"enabled": mood != "NONE", "mood": None if mood == "NONE" else mood, "trackId": track_id, "volume": max(0.0, min(1.0, volume)), "ducking": music_raw.get("ducking") is not False},
        "subtitle": {"enabled": bool(selected["subtitleEnabled"]), "styleId": style_id, "highlightMode": highlight, "keywordHighlight": highlight != "NORMAL"},
    }
    out = {"version": SHORTS_CONFIG_VERSION, "selected": selected, "resolved": resolved, "aiRecommended": ai}
    if mode == "CUSTOM" and requested_track and requested_track not in selectable_tracks and mood != "NONE":
        requested = next((t for t in (music_library or []) if isinstance(t, dict) and str(t.get("musicId")) == requested_track), None)
        out["musicSelectionBlocked"] = {"trackId": requested_track, "blockedReasons": music_eligibility(requested, required_duration_ms=int(duration) * 1000)["blockedReasons"] if requested else ["TRACK_NOT_FOUND"]}
    return out


def build_scene_plan(config: dict[str, Any]) -> dict[str, Any]:
    resolved = config.get("resolved") if isinstance(config.get("resolved"), dict) else config
    story = _STORY_BY_ID.get(str(resolved.get("storyType") or ""), STORY_TYPES[1])
    pace = _PACE_BY_ID.get(str(resolved.get("pace") or ""), PACES[0])
    duration = int(resolved.get("duration") or 30)
    stages = list(story["stages"])
    weights = [float(STAGES[s]["weight"]) for s in stages]
    total_weight = sum(weights) or 1.0
    raw = [max(2.0, duration * w / total_weight) for w in weights]
    secs = [max(2, int(round(x))) for x in raw]
    diff = duration - sum(secs)
    idx = max(range(len(secs)), key=lambda i: weights[i])
    secs[idx] = max(2, secs[idx] + diff)
    scenes = []
    cursor = 0
    for order, (stage, sec) in enumerate(zip(stages, secs), start=1):
        meta = STAGES[stage]
        scenes.append(
            {
                "order": order,
                "stage": stage,
                "stageLabel": meta["label"],
                "purpose": meta["purpose"],
                "startSec": cursor,
                "endSec": cursor + sec,
                "durationSec": sec,
                "productLocked": bool(meta["product"]),
                "spokenCharsTarget": int(sec * float(pace["charsPerSec"])),
            }
        )
        cursor += sec
    return {"version": SHORTS_SCENE_PLAN_VERSION, "storyType": story["id"], "storyLabel": story["label"], "totalDurationSec": cursor, "scenes": scenes}


def writer_directives(config: dict[str, Any]) -> dict[str, Any]:
    resolved = config.get("resolved") if isinstance(config.get("resolved"), dict) else {}
    plan = build_scene_plan(config)
    tone = _TONE_BY_ID.get(str(resolved.get("narrationTone") or ""), NARRATION_TONES[0])
    pace = _PACE_BY_ID.get(str(resolved.get("pace") or ""), PACES[0])
    subtitle = resolved.get("subtitle") if isinstance(resolved.get("subtitle"), dict) else {}
    return {
        "story_type": plan["storyLabel"],
        "target_total_duration_sec": plan["totalDurationSec"],
        "scene_plan": [
            {"scene_no": s["order"], "stage": s["stage"], "stage_label": s["stageLabel"], "purpose": s["purpose"], "duration": s["durationSec"], "spoken_script_target_chars": s["spokenCharsTarget"]}
            for s in plan["scenes"]
        ],
        "narration_tone": {"label": tone["label"], "sample_opening": tone["sample"], "rule": "Tone changes wording and rhythm only. Never change, add, or exaggerate facts."},
        "pace": {"label": pace["label"], "rule": "short punchy sentences, one idea per line" if pace["id"] == "FAST" else "natural conversational sentences"},
        "subtitle_highlight": {
            "mode": subtitle.get("highlightMode") or "NORMAL",
            "rule": "For each scene put 0-2 short phrases copied exactly from that scene's subtitle into highlight_keywords.",
        },
    }


def production_standard_for(config: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    plan = build_scene_plan(config)
    count = len(plan["scenes"])
    total = int(plan["totalDurationSec"])
    standard = dict(base or {})
    standard["scene_count"] = {"min": max(4, count - 1), "max": min(8, count + 1)}
    standard["total_duration_sec"] = {"min": max(10, int(total * 0.75)), "max": int(total * 1.25) + 1}
    if total <= 15:
        standard["total_export_chars"] = {"min": 300, "max": 1400}
        standard["spoken_script_chars"] = {"min": 10, "max": 80}
    elif total >= 45:
        standard["total_export_chars"] = {"min": 600, "max": 2600}
        standard["spoken_script_chars"] = {"min": 18, "max": 160}
    return standard


def normalize_highlights(subtitle: str, raw: Any) -> list[str]:
    values = raw if isinstance(raw, list) else []
    out: list[str] = []
    for item in values:
        text = " ".join(str(item or "").split())
        if text and text in subtitle and text not in out and len(text) <= 20:
            out.append(text)
        if len(out) >= 2:
            break
    return out


# Scene visual contract:
#   visual_prompt = instruction for what the scene image must show (text only)
#   visual_asset  = real image asset object or None; never instruction text
# Legacy artifacts stored instruction text (or a bare URL) in visual_asset; the
# readers below interpret those without rewriting stored rows.
VISUAL_ASSET_SOURCES = ("AI_GENERATED", "EXISTING")
_ASSET_URL_PREFIXES = ("/content/images/", "/content/assets/files/")


def _plain(value: Any) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def is_asset_reference(value: Any) -> bool:
    text = _plain(value)
    return any(text.startswith(prefix) and len(text) > len(prefix) for prefix in _ASSET_URL_PREFIXES) and " " not in text


def visual_prompt_hash(prompt: Any) -> str:
    text = _plain(prompt)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16] if text else ""


def scene_visual_prompt(scene: Any) -> str:
    if not isinstance(scene, dict):
        return ""
    explicit = _plain(scene.get("visual_prompt"))
    if explicit:
        return explicit
    direction = _plain(scene.get("visual_direction"))
    legacy = scene.get("visual_asset")
    legacy_text = _plain(legacy) if isinstance(legacy, str) and not is_asset_reference(legacy) else ""
    if legacy_text and legacy_text != direction:
        return legacy_text
    return _plain(scene.get("image_prompt")) or direction or legacy_text


def build_visual_asset(url: str, *, source: str, prompt: str = "", model: str = "", asset_id: str = "") -> dict[str, Any]:
    clean_url = _plain(url)
    return {
        "assetId": asset_id or f"content_image:{clean_url.rsplit('/', 1)[-1]}",
        "url": clean_url,
        "source": source,
        "generatedFromPromptHash": visual_prompt_hash(prompt) if source == "AI_GENERATED" else "",
        "model": model,
        "contract": SHORTS_SCENE_VISUAL_CONTRACT,
    }


def _legacy_visual_asset(url: str) -> dict[str, Any]:
    asset = build_visual_asset(url, source="EXISTING", asset_id=f"legacy:{_plain(url).rsplit('/', 1)[-1]}")
    asset["legacy"] = True
    return asset


def scene_visual_asset_state(scene: Any) -> dict[str, Any]:
    """Single authority for whether a scene already has a usable real image asset."""
    prompt = scene_visual_prompt(scene)
    state: dict[str, Any] = {"status": "NONE", "asset": None, "prompt": prompt, "promptHash": visual_prompt_hash(prompt), "legacy": False, "reason": ""}
    if not isinstance(scene, dict):
        state["reason"] = "scene_not_object"
        return state
    raw = scene.get("visual_asset")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        if is_asset_reference(scene.get("generated_image")):
            state.update(status="VALID", asset=_legacy_visual_asset(scene["generated_image"]), legacy=True, reason="legacy_generated_image_url")
        return state
    if isinstance(raw, str):
        if is_asset_reference(raw):
            state.update(status="VALID", asset=_legacy_visual_asset(raw), legacy=True, reason="legacy_url_string")
        else:
            state.update(legacy=True, reason="legacy_instruction_text")
        return state
    if not isinstance(raw, dict):
        state.update(status="INVALID_VISUAL_ASSET", reason="unsupported_visual_asset_type")
        return state
    url = raw.get("url")
    asset_id = _plain(raw.get("assetId"))
    source = str(raw.get("source") or "")
    if not is_asset_reference(url):
        state.update(status="INVALID_VISUAL_ASSET", reason="visual_asset_url_missing_or_invalid")
        return state
    if not asset_id:
        state.update(status="INVALID_VISUAL_ASSET", reason="visual_asset_id_missing")
        return state
    if source not in VISUAL_ASSET_SOURCES:
        state.update(status="INVALID_VISUAL_ASSET", reason="visual_asset_source_invalid")
        return state
    asset = dict(raw)
    asset["url"] = _plain(url)
    state["asset"] = asset
    from_hash = _plain(raw.get("generatedFromPromptHash"))
    if from_hash and state["promptHash"] and from_hash != state["promptHash"]:
        state.update(status="STALE", reason="visual_prompt_changed")
        return state
    state["status"] = "VALID"
    return state


def normalize_scene_visual(scene: dict[str, Any]) -> dict[str, Any]:
    """Rewrite one scene in memory to the visual contract (used on generate/regenerate, not as a DB migration)."""
    state = scene_visual_asset_state(scene)
    if state["prompt"] and not _plain(scene.get("visual_prompt")):
        scene["visual_prompt"] = state["prompt"]
    if state["status"] == "VALID":
        scene["visual_asset"] = state["asset"]
    elif state["status"] == "NONE":
        scene["visual_asset"] = None
    return state


def scene_requires_generated_visual(scene: Any) -> bool:
    """Every scene needs its own background visual; PRODUCT_LOCKED_ASSET is a separate overlay layer."""
    return isinstance(scene, dict)


def planned_scene_image_count(scenes: list[Any]) -> int:
    return sum(1 for scene in scenes if scene_requires_generated_visual(scene))


# Narration audio contract: one asset per scene. The reference lives in
# scene["narration_audio"]; the binary + full metadata live in the shared asset store.
NARRATION_STATUSES = ("PENDING_TTS", "READY", "STALE", "FAILED")


def narration_text(scene: Any) -> str:
    if not isinstance(scene, dict):
        return ""
    return _plain(scene.get("voice_over")) or _plain(scene.get("spoken_script"))


def text_hash(text: str) -> str:
    return hashlib.sha256(_plain(text).encode("utf-8")).hexdigest()[:16]


def narration_generation_key(*, text: str, voice_id: str, narration_tone: str, model: str, profile_version: str) -> str:
    raw = "\n".join([_plain(text), voice_id, narration_tone, model, profile_version])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def gemini_generation_key(*, text: str, voice_id: str) -> str:
    cfg = GEMINI_TTS_PROVIDER_CONFIG
    raw = "\n".join([
        f"provider={cfg['provider']}", f"model={cfg['model']}", f"voiceId={voice_id}", f"adapter={cfg['requestAdapter']}",
        f"text={_plain(text)}", f"stylePolicy={cfg['stylePolicy']}", f"mode={cfg['generationMode']}",
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def voice_provider(voice_id: str) -> str:
    return str((_VOICE_BY_ID.get(voice_id) or {}).get("provider") or "openai").upper()


def tts_instructions(narration_tone: str, voice_id: str = "") -> str:
    tone = TTS_TONE_INSTRUCTIONS.get(narration_tone, TTS_TONE_INSTRUCTIONS["INFORMATIVE"])
    voice = _VOICE_BY_ID.get(voice_id) or {}
    voice_hint = f" Voice character: {voice.get('styleKey', '').replace('_', ' ').lower()}." if voice else ""
    return (
        "Speak natural, fluent Korean for a short-form vertical video narration. "
        "Read the input text exactly as written; never add, drop, reorder or change any words. "
        f"Delivery: {tone}.{voice_hint}"
    )


def narration_expectation(config: dict[str, Any] | None, scene: Any) -> dict[str, Any]:
    resolved = (config or {}).get("resolved") if isinstance((config or {}).get("resolved"), dict) else {}
    voice = resolved.get("voice") if isinstance(resolved.get("voice"), dict) else {}
    text = narration_text(scene)
    voice_id = str(voice.get("voiceId") or "")
    tone = str(resolved.get("narrationTone") or "")
    provider = voice_provider(voice_id)
    if provider == "GEMINI":
        model = str(GEMINI_TTS_PROVIDER_CONFIG["model"])
        profile = str(GEMINI_TTS_PROVIDER_CONFIG["stylePolicy"])
        key = gemini_generation_key(text=text, voice_id=voice_id) if text and voice_id else ""
    else:
        model = str(TTS_PROVIDER_CONFIG["model"])
        profile = str(TTS_PROVIDER_CONFIG["instructionProfileVersion"])
        key = narration_generation_key(text=text, voice_id=voice_id, narration_tone=tone, model=model, profile_version=profile) if text and voice_id else ""
    return {
        "text": text,
        "textHash": text_hash(text) if text else "",
        "voiceId": voice_id,
        "provider": provider,
        "narrationTone": tone,
        "model": model,
        "instructionProfileVersion": profile,
        "generationKey": key,
    }


def scene_narration_state(scene: Any, config: dict[str, Any] | None) -> dict[str, Any]:
    expected = narration_expectation(config, scene)
    state: dict[str, Any] = {"status": "PENDING_TTS", "asset": None, "expected": expected, "reason": "", "changed": []}
    if not expected["generationKey"]:
        state["reason"] = "narration_text_or_voice_missing"
        return state
    ref = scene.get("narration_audio") if isinstance(scene, dict) else None
    if not isinstance(ref, dict):
        return state
    if str(ref.get("status") or "") == "FAILED":
        if ref.get("generationKey") == expected["generationKey"]:
            state.update(status="FAILED", reason=str(ref.get("error") or "tts_failed"))
        return state
    if not is_asset_reference(ref.get("url")) or not _plain(ref.get("audioAssetId")):
        state["reason"] = "narration_audio_ref_invalid"
        return state
    state["asset"] = ref
    if ref.get("generationKey") != expected["generationKey"]:
        mapping = {"textHash": "text", "voiceId": "voice", "narrationTone": "tone", "model": "model", "instructionProfileVersion": "instructionProfile"}
        changed = [label for field, label in mapping.items() if ref.get(field) != expected[field]]
        if str(ref.get("provider") or "OPENAI").upper() != expected["provider"]:
            changed.append("provider")
        if expected["provider"] == "GEMINI" and "tone" in changed:
            changed.remove("tone")
        state.update(status="STALE", reason="narration_inputs_changed", changed=changed)
        return state
    state["status"] = "READY"
    return state


NARRATION_TIMING_STATUSES = ("PENDING_MEASUREMENT", "FIT", "SHORT", "OVERFLOW")
# SHORT is informational only (never review-required); the ratio is an initial policy, not a measurement.
NARRATION_SHORT_RATIO = 0.5
# Least-squares fit of actualSec = overheadSec + secPerSpeechChar * speechChars over the stored
# CT-fd1dcac89d scene WAVs (6 scenes, one voice, one tone). Edge silence averaged only ~0.27s,
# so the overhead is mostly delivery, not trimmable silence. Re-fit when more voices/tones are measured.
NARRATION_ESTIMATOR: dict[str, Any] = {
    "estimatorVersion": "shorts_narration_estimator_v1",
    "profileId": "GLOBAL_CONSERVATIVE_PROFILE",
    "overheadSec": 1.33,
    "secPerSpeechChar": 0.18,
    "conservativeMarginSec": 0.67,
    "speechCharRule": "non-whitespace characters minus punctuation",
    "voiceSpecificRate": "NOT_APPLIED",
    "toneSpecificRate": "UNKNOWN",
    "evidence": {
        "artifactId": "CT-fd1dcac89d",
        "scenes": 6,
        "voiceId": "VOICE_F_CALM",
        "narrationTone": "EMPATHY",
        "model": "gpt-4o-mini-tts",
        "maxPositiveResidualSec": 0.666,
        "voicePreviewUse": "VOICE_RELATIVE_REFERENCE_ONLY",
    },
}
NARRATION_RESERVED_NON_SPEECH = {"reservedNonSpeechDurationMs": 0, "policy": "INITIAL_ZERO_NOT_MEASURED"}
_SPEECH_PUNCT = re.compile(r"[.,!?…·~:;\"'()\[\]“”‘’\-]")


def narration_speech_chars(text: str) -> int:
    plain = _plain(text)
    return max(0, len(re.sub(r"\s", "", plain)) - len(_SPEECH_PUNCT.findall(plain)))


def classify_narration_duration(duration_ms: int | None, target_ms: int | None) -> str:
    if duration_ms is None or not target_ms:
        return "PENDING_MEASUREMENT"
    if duration_ms > target_ms:
        return "OVERFLOW"
    if duration_ms < target_ms * NARRATION_SHORT_RATIO:
        return "SHORT"
    return "FIT"


def _target_ms(scene_duration_sec: Any) -> int | None:
    try:
        return int(round(float(scene_duration_sec) * 1000))
    except (TypeError, ValueError):
        return None


def narration_timing(duration_ms: Any, scene_duration_sec: Any) -> dict[str, Any]:
    """Classify a measured narration against the scene's storyboard duration."""
    target = _target_ms(scene_duration_sec)
    try:
        actual = int(duration_ms)
    except (TypeError, ValueError):
        return {"timingStatus": "PENDING_MEASUREMENT", "reviewRequired": False, "targetDurationMs": target, "gapMs": None}
    status = classify_narration_duration(actual, target)
    out = {"timingStatus": status, "reviewRequired": status == "OVERFLOW", "targetDurationMs": target, "gapMs": target - actual if target is not None else None}
    if status == "OVERFLOW":
        out["reviewCode"] = "TIMING_REVIEW_REQUIRED"
    return out


def narration_budget(scene_duration_sec: Any, text: str, voice_id: str = "") -> dict[str, Any]:
    """Deterministic pre-TTS estimate. Detects only: no rewrite, retry or scene re-allocation."""
    profile = NARRATION_ESTIMATOR
    target = _target_ms(scene_duration_sec)
    chars = narration_speech_chars(text)
    overhead, per_char, margin = float(profile["overheadSec"]), float(profile["secPerSpeechChar"]), float(profile["conservativeMarginSec"])
    target_sec = (target or 0) / 1000
    estimated = int(round((overhead + per_char * chars) * 1000)) if chars else None
    hard = max(0, int((target_sec - overhead) / per_char)) if target else None
    preferred = max(0, int((target_sec - overhead - margin) / per_char)) if target else None
    if not chars:
        budget_status = "NO_TEXT"
    elif hard is not None and chars > hard:
        budget_status = "NARRATION_BUDGET_EXCEEDED"
    else:
        budget_status = "PASS"
    return {
        "estimatorVersion": profile["estimatorVersion"],
        "profileId": profile["profileId"],
        "voiceId": voice_id,
        "targetDurationSec": target_sec if target else None,
        "speechChars": chars,
        "preferredTextBudget": preferred,
        "hardTextBudget": hard,
        "budgetStatus": budget_status,
        "estimatedDurationMs": estimated,
        "estimatedTimingStatus": classify_narration_duration(estimated, target),
    }


def scene_narration_timing(scene: Any, config: dict[str, Any] | None, scene_duration_sec: Any, *, state: dict[str, Any] | None = None) -> dict[str, Any]:
    """actualNarrationDuration (READY audio for the current inputs) is the authority; otherwise the estimate is used."""
    state0 = state or scene_narration_state(scene, config)
    expected = state0["expected"]
    target = _target_ms(scene_duration_sec)
    budget = narration_budget(scene_duration_sec, expected["text"], expected["voiceId"])
    actual = None
    if state0["status"] == "READY" and isinstance(state0.get("asset"), dict):
        try:
            actual = int(state0["asset"].get("durationMs"))
        except (TypeError, ValueError):
            actual = None
    estimated = budget["estimatedDurationMs"]
    authority = "ACTUAL" if actual is not None else "ESTIMATED" if estimated is not None else "NONE"
    authority_ms = actual if actual is not None else estimated
    status = classify_narration_duration(authority_ms, target)
    out: dict[str, Any] = {
        "targetSceneDurationMs": target,
        "estimatedNarrationDurationMs": estimated,
        "actualNarrationDurationMs": actual,
        "timingAuthority": authority,
        "timingStatus": status,
        "actualTimingStatus": classify_narration_duration(actual, target),
        "estimatedTimingStatus": budget["estimatedTimingStatus"],
        "reviewRequired": status == "OVERFLOW",
        "gapMs": target - authority_ms if target is not None and authority_ms is not None else None,
        "estimationErrorMs": estimated - actual if actual is not None and estimated is not None else None,
        "estimationErrorRatio": round((estimated - actual) / actual, 4) if actual and estimated is not None else None,
        "budget": budget,
    }
    if status == "OVERFLOW":
        out["reviewCode"] = "TIMING_REVIEW_REQUIRED" if authority == "ACTUAL" else "NARRATION_BUDGET_EXCEEDED"
    return out


def narration_timeline(entries: list[dict[str, Any]], video_duration_sec: Any) -> dict[str, Any]:
    """Whole-video check; scene FIT alone is not enough."""
    video_target = _target_ms(video_duration_sec)
    reserved = int(NARRATION_RESERVED_NON_SPEECH["reservedNonSpeechDurationMs"])
    available = video_target - reserved if video_target is not None else None
    actuals = [e.get("actualNarrationDurationMs") for e in entries]
    estimates = [e.get("estimatedNarrationDurationMs") for e in entries]
    measured = [a for a in actuals if a is not None]
    authority_vals = [a if a is not None else s for a, s in zip(actuals, estimates)]
    if entries and len(measured) == len(entries):
        authority = "ACTUAL"
    elif measured:
        authority = "MIXED"
    elif any(s is not None for s in estimates):
        authority = "ESTIMATED"
    else:
        authority = "NONE"
    authority_total = sum(v for v in authority_vals if v is not None) if authority != "NONE" else None
    actual_total = sum(measured) if entries and len(measured) == len(entries) else None
    return {
        "videoTargetDurationMs": video_target,
        "sceneTargetTotalMs": sum(e.get("targetSceneDurationMs") or 0 for e in entries),
        **NARRATION_RESERVED_NON_SPEECH,
        "availableNarrationDurationMs": available,
        "narrationActualTotalMs": actual_total,
        "narrationActualMeasuredMs": sum(measured),
        "measuredScenes": len(measured),
        "narrationEstimatedTotalMs": sum(s for s in estimates if s is not None) if any(s is not None for s in estimates) else None,
        "narrationAuthorityTotalMs": authority_total,
        "totalTimingAuthority": authority,
        "totalTimingStatus": classify_narration_duration(authority_total, available),
        "totalActualTimingStatus": classify_narration_duration(actual_total, available),
        "automaticTimingMutation": "NONE",
    }


def carry_over_narration(scenes: list[Any], previous_scenes: list[Any], config: dict[str, Any] | None) -> int:
    """On regeneration, keep audio for scenes whose text/voice/tone/model/profile did not change."""
    by_key: dict[str, dict[str, Any]] = {}
    for prev in previous_scenes or []:
        state = scene_narration_state(prev, config)
        if state["status"] == "READY":
            by_key.setdefault(state["expected"]["generationKey"], state["asset"])
    carried = 0
    for scene in scenes or []:
        if not isinstance(scene, dict) or scene_narration_state(scene, config)["status"] == "READY":
            continue
        ref = by_key.get(narration_expectation(config, scene)["generationKey"])
        if ref:
            scene["narration_audio"] = dict(ref)
            carried += 1
    return carried


def music_prompt(mood: str, variant: int = 1) -> str:
    profile = MUSIC_MOOD_PROFILES.get(mood) or MUSIC_MOOD_PROFILES["CALM"]
    extra = MUSIC_PROMPT_VARIANTS[(max(1, int(variant)) - 1) % len(MUSIC_PROMPT_VARIANTS)]
    return " ".join(
        part for part in [
            "Instrumental background music for a 30-second Korean beauty and hair-care short-form video that has spoken voice-over narration.",
            f"Mood: {profile['feel']}. Energy: {profile['energy'].lower()}. Instruments: {profile['instruments']}. Tempo: {profile['tempo']}.",
            "Keep the melody simple and steady at a background level so the narration stays clear.",
            "Instrumental only: no vocals, no singing, no humming, no spoken words, no lyrics.",
            "Original composition; do not imitate any specific artist or existing song.",
            extra,
        ] if part
    )


def music_status_for(config: dict[str, Any] | None, track: dict[str, Any] | None) -> str:
    resolved = (config or {}).get("resolved") if isinstance((config or {}).get("resolved"), dict) else {}
    music = resolved.get("music") if isinstance(resolved.get("music"), dict) else {}
    if not music.get("enabled"):
        return "DISABLED"
    if not music.get("trackId"):
        return "PENDING_TRACK"
    if not isinstance(track, dict):
        return "TRACK_UNAVAILABLE"
    if not music_eligibility(track, required_duration_ms=int(resolved.get("duration") or 30) * 1000)["eligible"]:
        return "TRACK_NOT_ELIGIBLE"
    return "READY"


def estimate(config: dict[str, Any], *, scenes: list[Any] | None = None, music_track: dict[str, Any] | None = None) -> dict[str, Any]:
    plan = build_scene_plan(config)
    source = scenes if isinstance(scenes, list) and scenes else plan["scenes"]
    states = [scene_narration_state(s, config)["status"] for s in source] if scenes else ["PENDING_TTS"] * len(source)
    music_state = music_status_for(config, music_track)
    return {
        "writerCalls": 1,
        "imageCalls": planned_scene_image_count(plan["scenes"]),
        "ttsCalls": 0,
        "musicCalls": 0,
        "renderJobs": 0,
        "audio": {
            "stage": "AFTER_SCRIPT_REVIEW",
            "narrationCalls": sum(1 for s in states if s != "READY"),
            "narrationReused": sum(1 for s in states if s == "READY"),
            "musicStatus": music_state,
            "musicCalls": 0,
            "newBgmCalls": 1,
            "timingAnalysisCalls": 0,
            "note": "음성은 대본 확인 후 [음성 만들기]에서 장면별로 만듭니다(이미 만든 동일 음성은 0회). 라이브러리 곡 선택은 0회, 새 BGM 만들기는 1회 호출입니다.",
        },
        "note": "1단계: 대본 1회 + 장면 이미지 생성. 음성·음악은 대본 확인 후 별도 단계, 영상 렌더링은 아직 연결되지 않았습니다.",
    }


def voice_plan(voice: dict[str, Any], story_type: str) -> dict[str, Any]:
    voice_id = str(voice.get("voiceId") or "")
    item = _VOICE_BY_ID.get(voice_id) or {}
    provider = voice_provider(voice_id)
    profile = voice_profile_for_story(story_type)
    return {
        "voiceId": voice_id,
        "displayName": item.get("displayName"),
        "provider": provider,
        "model": item.get("model") or (TTS_PROVIDER_CONFIG["model"] if provider == "OPENAI" else None),
        "providerVoiceId": item.get("providerVoiceId"),
        "profileId": profile["id"] if profile else None,
        "profileLabel": profile["label"] if profile else None,
        "profileRole": voice_profile_role(profile, voice_id),
        "selectionSource": voice.get("selectionSource") or "UNKNOWN",
        "stylePolicy": GEMINI_TTS_PROVIDER_CONFIG["stylePolicy"] if provider == "GEMINI" else None,
        "estimatorApplies": provider == "OPENAI",
        "estimatorNote": None if provider == "OPENAI" else "예상 길이는 OpenAI 음성 기준 추정치입니다. Gemini 음성은 실제 생성 길이로만 판정합니다.",
    }


def build_render_plan(config: dict[str, Any], scenes: list[dict[str, Any]] | None, *, product_reference: dict[str, Any] | None = None, music_track: dict[str, Any] | None = None) -> dict[str, Any]:
    """Derived (not persisted) plan for the V1 image-motion renderer."""
    resolved = config.get("resolved") if isinstance(config.get("resolved"), dict) else {}
    template = _TEMPLATE_BY_ID.get(str(resolved.get("templateId") or ""), VISUAL_TEMPLATES[0])
    subtitle = resolved.get("subtitle") if isinstance(resolved.get("subtitle"), dict) else {}
    music = resolved.get("music") if isinstance(resolved.get("music"), dict) else {}
    voice = resolved.get("voice") if isinstance(resolved.get("voice"), dict) else {}
    product_url = str((product_reference or {}).get("product_image_url") or "")
    skeleton = build_scene_plan(config)["scenes"]
    source = scenes if isinstance(scenes, list) and scenes else skeleton
    motions = template["motion"]
    items = []
    narration_plan: list[dict[str, Any]] = []
    image_counts: dict[str, int] = {}
    cursor = 0.0
    for idx, scene in enumerate(source):
        if not isinstance(scene, dict):
            continue
        stage = str(scene.get("stage") or (skeleton[idx]["stage"] if idx < len(skeleton) else "")).upper()
        meta = STAGES.get(stage, {"label": stage or f"Scene {idx + 1}", "product": False})
        try:
            sec = float(scene.get("duration_sec") or scene.get("durationSec") or 4)
        except (TypeError, ValueError):
            sec = 4.0
        sub_text = str(scene.get("caption") or scene.get("subtitle") or "")
        visual = scene_visual_asset_state(scene)
        status = visual["status"]
        image_counts[status] = image_counts.get(status, 0) + 1
        locked = bool(meta.get("product")) and bool(product_url)
        if status == "VALID":
            background = {"type": "background", "source": "scene_image", "url": visual["asset"]["url"], "assetId": visual["asset"].get("assetId"), "assetSource": visual["asset"].get("source")}
        elif status == "STALE":
            background = {"type": "background", "source": "STALE_SCENE_IMAGE", "url": None, "staleAssetId": visual["asset"].get("assetId")}
        elif status == "INVALID_VISUAL_ASSET":
            background = {"type": "background", "source": "INVALID_VISUAL_ASSET", "url": None, "reason": visual["reason"]}
        else:
            background = {"type": "background", "source": "PENDING_SCENE_IMAGE", "url": None}
        background["visualPromptHash"] = visual["promptHash"]
        layers = [background]
        narration = scene_narration_state(scene, config)
        audio_ref = narration["asset"] if narration["status"] in ("READY", "STALE") else None
        timing = scene_narration_timing(scene, config, sec, state=narration)
        timing["targetDurationMs"] = timing["targetSceneDurationMs"]
        order = int(scene.get("order") or idx + 1)
        narration_plan.append(
            {
                "sceneOrder": order,
                "sceneId": f"scene_{order}",
                "status": narration["status"],
                "audioAssetId": audio_ref.get("audioAssetId") if audio_ref and narration["status"] == "READY" else None,
                "url": audio_ref.get("url") if audio_ref and narration["status"] == "READY" else None,
                "staleAudioAssetId": audio_ref.get("audioAssetId") if audio_ref and narration["status"] == "STALE" else None,
                "staleReasons": narration.get("changed") or [],
                "durationMs": audio_ref.get("durationMs") if audio_ref and narration["status"] == "READY" else None,
                "provider": narration["expected"]["provider"],
                "fidelity": audio_ref.get("fidelity") if audio_ref and narration["status"] == "READY" else None,
                "aiGenerated": True,
                "disclosureRequired": True,
                **timing,
            }
        )
        if locked:
            layers.append({"type": "product", "source": "PRODUCT_LOCKED_ASSET", "url": product_url, "locked": True, "aiGenerated": False})
        items.append(
            {
                "order": int(scene.get("order") or idx + 1),
                "stage": stage,
                "stageLabel": meta.get("label"),
                "startSec": round(cursor, 2),
                "endSec": round(cursor + sec, 2),
                "durationSec": sec,
                "motion": motions[idx % len(motions)],
                "transitionIn": "none" if idx == 0 else template["transition"],
                "layers": layers,
                "subtitle": {
                    "enabled": subtitle.get("enabled") is not False,
                    "text": sub_text,
                    "styleId": subtitle.get("styleId"),
                    "highlightMode": subtitle.get("highlightMode"),
                    "highlights": normalize_highlights(sub_text, scene.get("highlight_keywords")),
                    "position": template["subtitlePosition"],
                },
                "voice": {"voiceId": voice.get("voiceId"), "text": str(scene.get("voice_over") or scene.get("spoken_script") or ""), "status": narration["status"], "url": narration_plan[-1]["url"]},
            }
        )
        cursor += sec
    music_state = music_status_for(config, music_track)
    track_ready = music_state == "READY" and isinstance(music_track, dict)
    return {
        "version": SHORTS_RENDER_PLAN_VERSION,
        "status": "PLANNED_NOT_RENDERED",
        "renderer": "image_motion_v1",
        "aspectRatio": "9:16",
        "resolution": {"width": 1080, "height": 1920},
        "fps": 30,
        "templateId": template["id"],
        "totalDurationSec": round(cursor, 2),
        "scenes": items,
        "sceneImages": {
            "planned": planned_scene_image_count(source),
            "ready": image_counts.get("VALID", 0),
            "pending": image_counts.get("NONE", 0),
            "stale": image_counts.get("STALE", 0),
            "invalid": image_counts.get("INVALID_VISUAL_ASSET", 0),
        },
        "music": {"enabled": bool(music.get("enabled")), "mood": music.get("mood"), "trackId": music.get("trackId"), "volume": music.get("volume"), "ducking": music.get("ducking"), "status": music_state},
        "audioPlan": {
            "narration": narration_plan,
            "narrationSummary": {
                "scenes": len(narration_plan),
                "ready": sum(1 for n in narration_plan if n["status"] == "READY"),
                "stale": sum(1 for n in narration_plan if n["status"] == "STALE"),
                "pending": sum(1 for n in narration_plan if n["status"] == "PENDING_TTS"),
                "failed": sum(1 for n in narration_plan if n["status"] == "FAILED"),
                "timingReviewRequired": sum(1 for n in narration_plan if n.get("reviewRequired")),
                "fidelityReviewRequired": sum(1 for n in narration_plan if (n.get("fidelity") or {}).get("reviewRequired")),
            },
            "voice": voice_plan(voice, str(resolved.get("storyType") or "")),
            "timeline": narration_timeline(narration_plan, resolved.get("duration") or round(cursor, 2)),
            "estimator": {k: v for k, v in NARRATION_ESTIMATOR.items() if k != "evidence"},
            "music": {
                "musicId": music.get("trackId"),
                "status": music_state,
                "url": music_track.get("url") if track_ready else None,
                "title": music_track.get("title") if isinstance(music_track, dict) else None,
                "durationMs": music_track.get("durationMs") if track_ready else None,
                "approvalStatus": music_track.get("approvalStatus") if isinstance(music_track, dict) else None,
                "eligibility": music_eligibility(music_track, required_duration_ms=int(resolved.get("duration") or 30) * 1000) if isinstance(music_track, dict) else None,
            },
            "mix": "NOT_RENDERED",
            "layers": ["narration", "bgm"],
            "aiVoiceDisclosure": {"aiGenerated": True, "disclosureRequired": True},
        },
        "productLockedAsset": {"url": product_url or None, "rule": "실제 제품 PNG는 AI 생성하지 않고 마지막 합성 단계에서 결합합니다."},
    }
