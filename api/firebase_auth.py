from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import jwt
import requests
from cryptography.x509 import load_pem_x509_certificate


GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"


def _env_bool(name: str, default: bool = False) -> bool:
    v = str(os.getenv(name, "") or "").strip().lower()
    if not v:
        return default
    return v in ("1", "true", "yes", "y", "on")


def _env_int(name: str, default: int) -> int:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def is_firebase_auth_required() -> bool:
    # 운영(NAS)에서만 강제하려면 compose에서 REQUIRE_FIREBASE_AUTH=1로 켠다.
    return _env_bool("REQUIRE_FIREBASE_AUTH", default=False)


def get_firebase_project_id() -> str:
    # NAS 운영에서는 반드시 지정해야 한다.
    # - ERP2-dev env.web.local의 VITE_FIREBASE_PROJECT_ID와 동일 값 사용 권장
    # - API는 VITE_*가 아니라 FIREBASE_PROJECT_ID로 받는다.
    return str(os.getenv("FIREBASE_PROJECT_ID", "") or "").strip()


def _clock_skew_seconds() -> int:
    # Docker/WSL 시간 오차 등으로 방금 발급한 토큰이 "not yet valid"로 보일 수 있어 leeway를 둔다.
    return max(0, min(600, _env_int("FIREBASE_AUTH_CLOCK_SKEW_SECONDS", default=120)))


def _is_test_mode() -> bool:
    # 테스트에서는 실제 Firebase 토큰을 만들기 어렵다.
    # - 단, 운영/배포에서는 이 값이 절대 켜지면 안 된다.
    return _env_bool("AUTH_TEST_MODE", default=False)


# ----------------------------
# Firebase Admin SDK verify (ERP 방식)
# ----------------------------

_FB_ADMIN_READY = False


def _should_use_firebase_admin_verify() -> bool:
    # 기본 ON. 필요 시 빠르게 비교/롤백 가능하도록 토글만 둔다.
    return _env_bool("USE_FIREBASE_ADMIN_VERIFY", default=True)


def _is_firebase_admin_env_configured() -> bool:
    return bool(
        (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
        and (os.getenv("FIREBASE_CLIENT_EMAIL") or "").strip()
        and (os.getenv("FIREBASE_PRIVATE_KEY") or "").strip()
    )


def _ensure_firebase_admin_initialized() -> None:
    global _FB_ADMIN_READY
    if _FB_ADMIN_READY:
        return
    if not _is_firebase_admin_env_configured():
        return
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import credentials  # type: ignore
    except Exception:
        return

    # already initialized
    try:
        if getattr(firebase_admin, "_apps", None):
            _FB_ADMIN_READY = True
            return
    except Exception:
        pass

    project_id = (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
    client_email = (os.getenv("FIREBASE_CLIENT_EMAIL") or "").strip()
    private_key = (os.getenv("FIREBASE_PRIVATE_KEY") or "").strip()
    private_key = private_key.replace("\\n", "\n").replace("\\\\n", "\n")
    private_key_id = (os.getenv("FIREBASE_PRIVATE_KEY_ID") or "").strip() or None
    try:
        cred = credentials.Certificate(
            {
                "type": "service_account",
                "project_id": project_id,
                "client_email": client_email,
                "private_key": private_key,
                "private_key_id": private_key_id,
                # google-auth가 요구하는 필드(최소). 서비스 계정 JSON의 기본값과 동일.
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            }
        )
        firebase_admin.initialize_app(cred)
        _FB_ADMIN_READY = True
    except Exception:
        _FB_ADMIN_READY = False


def _verify_with_firebase_admin(token: str, project_id: str) -> dict[str, Any]:
    _ensure_firebase_admin_initialized()
    if not _FB_ADMIN_READY:
        raise ValueError("firebase_admin_not_configured")
    try:
        from firebase_admin import auth  # type: ignore
    except Exception:
        raise ValueError("firebase_admin_missing")

    try:
        claims = auth.verify_id_token(token, check_revoked=False)
        if not isinstance(claims, dict):
            raise ValueError("invalid_claims")
        return claims
    except Exception as e:
        msg = str(e) or ""
        m = msg.lower()
        name = ""
        try:
            name = e.__class__.__name__
        except Exception:
            name = ""

        if "expired" in m:
            raise ValueError("token_expired")
        if "too early" in m or "not yet valid" in m:
            raise ValueError("token_not_yet_valid")
        if "iat" in m and ("future" in m or "invalid" in m):
            raise ValueError("token_iat_invalid")
        if "audience" in m or "aud" in m:
            raise ValueError(f"token_audience_mismatch expected={project_id}")
        if "issuer" in m or "iss" in m:
            raise ValueError(f"token_issuer_mismatch expected=https://securetoken.google.com/{project_id}")
        if name:
            raise ValueError(f"token_verification_failed:{name}")
        raise ValueError("token_verification_failed")


# ----------------------------
# PyJWT verify (fallback)
# ----------------------------


def _now() -> float:
    return time.time()


@dataclass
class _CertCache:
    fetched_at: float
    expires_at: float
    certs_by_kid: dict[str, str]


_CERT_CACHE: _CertCache | None = None


def _cache_ttl_from_headers(headers: dict[str, str]) -> int:
    cc = str(headers.get("Cache-Control", "") or "")
    for part in cc.split(","):
        p = part.strip().lower()
        if p.startswith("max-age="):
            try:
                return max(60, min(24 * 3600, int(p.split("=", 1)[1].strip())))
            except Exception:
                pass
    return 600


def _get_google_certs() -> dict[str, str]:
    global _CERT_CACHE
    now = _now()
    if _CERT_CACHE and _CERT_CACHE.expires_at > now and _CERT_CACHE.certs_by_kid:
        return _CERT_CACHE.certs_by_kid

    res = requests.get(GOOGLE_CERTS_URL, timeout=10)
    res.raise_for_status()
    data = res.json()
    if not isinstance(data, dict):
        raise RuntimeError("invalid certs response")
    certs_by_kid = {str(k): str(v) for k, v in data.items() if k and v}
    ttl = _cache_ttl_from_headers(dict(res.headers))
    _CERT_CACHE = _CertCache(fetched_at=now, expires_at=now + ttl, certs_by_kid=certs_by_kid)
    return certs_by_kid


def _bearer_token_from_headers(headers: dict[str, Any]) -> str | None:
    raw = headers.get("authorization") or headers.get("Authorization")
    if not raw:
        return None
    s = str(raw).strip()
    if not s.lower().startswith("bearer "):
        return None
    t = s.split(" ", 1)[1].strip()
    return t or None


def _verify_with_pyjwt(token: str, project_id: str) -> dict[str, Any]:
    try:
        unverified_header = jwt.get_unverified_header(token)
    except Exception:
        raise ValueError("invalid_token_header")

    kid = str(unverified_header.get("kid") or "").strip()
    if not kid:
        raise ValueError("missing_kid")

    certs = _get_google_certs()
    cert = certs.get(kid)
    if not cert:
        global _CERT_CACHE
        _CERT_CACHE = None
        certs = _get_google_certs()
        cert = certs.get(kid)
    if not cert:
        raise ValueError("unknown_kid")

    issuer = f"https://securetoken.google.com/{project_id}"
    key_obj: Any = cert
    try:
        if isinstance(cert, str) and "BEGIN CERTIFICATE" in cert:
            key_obj = load_pem_x509_certificate(cert.encode("utf-8")).public_key()
    except Exception:
        key_obj = cert

    leeway = _clock_skew_seconds()
    try:
        claims = jwt.decode(
            token,
            key=key_obj,
            algorithms=["RS256"],
            audience=project_id,
            issuer=issuer,
            leeway=leeway,
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except Exception as e:
        try:
            unverified = jwt.decode(token, options={"verify_signature": False})
        except Exception:
            unverified = {}

        actual_aud = ""
        actual_iss = ""
        try:
            actual_aud = str(unverified.get("aud") or "").strip()
        except Exception:
            actual_aud = ""
        try:
            actual_iss = str(unverified.get("iss") or "").strip()
        except Exception:
            actual_iss = ""

        if isinstance(e, jwt.ExpiredSignatureError):
            raise ValueError("token_expired")
        if isinstance(e, jwt.MissingRequiredClaimError):
            claim = ""
            try:
                claim = str(getattr(e, "claim", "") or "").strip()
            except Exception:
                claim = ""
            raise ValueError(f"token_missing_claim:{claim or 'unknown'}")
        if isinstance(e, jwt.InvalidAudienceError):
            msg = f"token_audience_mismatch expected={project_id}"
            if actual_aud:
                msg += f" actual={actual_aud}"
            raise ValueError(msg)
        if isinstance(e, jwt.InvalidIssuerError):
            msg = f"token_issuer_mismatch expected={issuer}"
            if actual_iss:
                msg += f" actual={actual_iss}"
            raise ValueError(msg)
        if isinstance(e, jwt.ImmatureSignatureError):
            raise ValueError("token_not_yet_valid")
        if isinstance(e, jwt.InvalidIssuedAtError):
            raise ValueError("token_iat_invalid")
        if isinstance(e, jwt.InvalidSignatureError):
            raise ValueError("token_signature_invalid")

        name = ""
        try:
            name = e.__class__.__name__
        except Exception:
            name = ""
        if name:
            raise ValueError(f"token_verification_failed:{name}")
        raise ValueError("token_verification_failed")

    if not isinstance(claims, dict):
        raise ValueError("invalid_claims")
    return claims


# ----------------------------
# Public API
# ----------------------------


def verify_firebase_id_token_from_headers(headers: dict[str, Any]) -> dict[str, Any]:
    """
    Returns decoded claims if valid, otherwise raises ValueError.
    """
    if _is_test_mode():
        t = _bearer_token_from_headers(headers)
        if t == "test":
            return {"sub": "test", "email": "test@example.com", "aud": "test", "iss": "test"}
        # ERP 호환 roles/role 스키마 테스트 토큰들
        # - role: legacy 단일 역할(admin/accounting/sales/marketing)
        # - roles: 신형 멀티 역할(superadmin/ops_admin/accounting/sales/marketing)
        if t in (
            "test-superadmin",
            "test-ops_admin",
            "test-accounting",
            "test-sales",
            "test-marketing",
            "test-user",
        ):
            sub = t
            email = f"{t.replace('test-','')}@example.com"
            if t == "test-superadmin":
                return {"sub": sub, "email": email, "aud": "test", "iss": "test", "role": "admin", "roles": ["superadmin"]}
            if t == "test-ops_admin":
                return {"sub": sub, "email": email, "aud": "test", "iss": "test", "role": "admin", "roles": ["ops_admin"]}
            if t == "test-accounting":
                return {"sub": sub, "email": email, "aud": "test", "iss": "test", "role": "accounting", "roles": ["accounting"]}
            if t == "test-sales":
                return {"sub": sub, "email": email, "aud": "test", "iss": "test", "role": "sales", "roles": ["sales"]}
            if t == "test-marketing":
                return {"sub": sub, "email": email, "aud": "test", "iss": "test", "role": "marketing", "roles": ["marketing"]}
            # "일반 사용자": auth는 성공하지만 권한(roles)이 없다 → admin API에서 403이 나야 한다.
            return {"sub": sub, "email": email, "aud": "test", "iss": "test"}
        raise ValueError("unauthorized")

    project_id = get_firebase_project_id()
    if not project_id:
        raise ValueError("firebase_project_id_missing")

    token = _bearer_token_from_headers(headers)
    if not token:
        raise ValueError("missing_bearer_token")

    # firebase-admin 우선(ERP 방식). 단, clock skew로 not_yet_valid가 뜨는 경우엔 PyJWT+leeway로 폴백한다.
    if _should_use_firebase_admin_verify() and _is_firebase_admin_env_configured():
        try:
            return _verify_with_firebase_admin(token, project_id)
        except ValueError as e:
            msg = str(e) or ""
            if "token_not_yet_valid" in msg or "token_iat_invalid" in msg:
                return _verify_with_pyjwt(token, project_id)
            raise

    return _verify_with_pyjwt(token, project_id)

