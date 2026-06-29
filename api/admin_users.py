from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

from fastapi import HTTPException, Request

from firebase_auth import verify_firebase_id_token_from_headers

# ERP 호환(역할 클레임 스키마)
# - roles: ["superadmin"|"ops_admin"|"accounting"|"sales"|"marketing", ...]
# - role(legacy): "admin"|"accounting"|"sales"|"marketing"
RoleId = Literal["superadmin", "ops_admin", "accounting", "sales", "marketing"]
LegacyRole = Literal["admin", "accounting", "sales", "marketing"]


def _env_bool(name: str, default: bool = False) -> bool:
    v = str(os.getenv(name, "") or "").strip().lower()
    if not v:
        return default
    return v in ("1", "true", "yes", "y", "on")


def _is_admin_test_mode() -> bool:
    # 단위 테스트에서 Firebase Admin SDK 없이도 admin 엔드포인트를 검증할 수 있도록 하는 모드.
    # 운영에서는 절대 켜지면 안 된다.
    return _env_bool("ADMIN_TEST_MODE", default=False)


def _role_rank(level: RoleId | None) -> int:
    if level == "superadmin":
        return 50
    if level == "ops_admin":
        return 40
    if level == "accounting":
        return 30
    if level == "sales":
        return 20
    if level == "marketing":
        return 20
    return 0


def _normalize_roles_from_claims(claims: dict[str, Any] | None) -> list[RoleId]:
    if not isinstance(claims, dict):
        return []
    # 허용 입력:
    # - role(legacy): "admin"|"accounting"|"sales"|"marketing"
    # - roles: ["superadmin"|"ops_admin"|"accounting"|"sales"|"marketing", ...]
    out: list[RoleId] = []
    seen = set()

    raw_roles = claims.get("roles")
    if isinstance(raw_roles, list):
        for x in raw_roles:
            v = str(x or "").strip().lower()
            if not v:
                continue
            # legacy 'admin' in roles[]는 superadmin으로 승격(ERP와 동일)
            if v == "admin":
                v = "superadmin"
            if v not in ("superadmin", "ops_admin", "accounting", "sales", "marketing"):
                continue
            if v in seen:
                continue
            seen.add(v)
            out.append(v)  # type: ignore[arg-type]

    # ERP와 동일: roles[]가 비어있는(구버전 계정) 경우에만 legacy role을 사용한다.
    if not out:
        legacy = str(claims.get("role") or "").strip().lower()
        if legacy == "admin":
            out.append("superadmin")
        if legacy in ("accounting", "sales", "marketing"):
            out.append(legacy)  # type: ignore[arg-type]

    return out


def _derive_legacy_role(roles: list[RoleId]) -> LegacyRole | None:
    s = set(roles or [])
    if "superadmin" in s or "ops_admin" in s:
        return "admin"
    if "accounting" in s:
        return "accounting"
    if "sales" in s:
        return "sales"
    if "marketing" in s:
        return "marketing"
    return None


def _primary_role(roles: list[RoleId]) -> RoleId | None:
    # 화면/UI 판단에 쓰기 위한 primary role
    s = set(roles or [])
    if "superadmin" in s:
        return "superadmin"
    if "ops_admin" in s:
        return "ops_admin"
    if "accounting" in s:
        return "accounting"
    if "sales" in s:
        return "sales"
    if "marketing" in s:
        return "marketing"
    return None


def get_claims_from_request(request: Request) -> dict[str, Any]:
    # 1) middleware가 넣어둔 claims (REQUIRE_FIREBASE_AUTH=1)
    try:
        c = getattr(getattr(request, "state", None), "claims", None)
        if isinstance(c, dict):
            return c
    except Exception:
        pass
    # 2) middleware가 꺼져 있어도(로컬) admin 엔드포인트는 자체적으로 토큰 검증
    return verify_firebase_id_token_from_headers(dict(request.headers))


def require_role_level(request: Request, *, minimum: RoleId) -> list[RoleId]:
    try:
        claims = get_claims_from_request(request)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e) or "unauthorized")

    actual_roles = _normalize_roles_from_claims(claims)
    actual_primary = _primary_role(actual_roles)
    if _role_rank(actual_primary) < _role_rank(minimum):
        raise HTTPException(status_code=403, detail="forbidden")
    return actual_roles


class AdminUserSummary(TypedDict):
    uid: str
    email: str | None
    displayName: str | None
    role: LegacyRole | None
    roles: list[RoleId] | None
    disabled: bool


@dataclass
class _TestUser:
    uid: str
    email: str | None
    display_name: str | None
    role: LegacyRole | None
    roles: list[RoleId]
    disabled: bool


_TEST_USERS: dict[str, _TestUser] = {}
_TEST_SEQ = 0


def _test_reset_store() -> None:
    global _TEST_USERS, _TEST_SEQ
    _TEST_USERS = {}
    _TEST_SEQ = 0


def _test_list_users() -> list[AdminUserSummary]:
    out: list[AdminUserSummary] = []
    for u in _TEST_USERS.values():
        out.append(
            {
                "uid": u.uid,
                "email": u.email,
                "displayName": u.display_name,
                "role": u.role,
                "roles": u.roles,
                "disabled": bool(u.disabled),
            }
        )
    out.sort(key=lambda x: (x["email"] or "", x["uid"]))
    return out


def _test_create_user(*, email: str, password: str, display_name: str | None, roles: list[str]) -> AdminUserSummary:
    # password는 저장하지 않는다(테스트 목적).
    for u in _TEST_USERS.values():
        if (u.email or "").strip().lower() == (email or "").strip().lower():
            raise HTTPException(status_code=409, detail="email_already_exists")
    global _TEST_SEQ
    _TEST_SEQ += 1
    uid = f"u{_TEST_SEQ:03d}"
    normalized = _normalize_roles_from_claims({"roles": roles})
    legacy = _derive_legacy_role(normalized)
    u = _TestUser(uid=uid, email=email, display_name=display_name, role=legacy, roles=normalized, disabled=False)
    _TEST_USERS[uid] = u
    return {
        "uid": u.uid,
        "email": u.email,
        "displayName": u.display_name,
        "role": u.role,
        "roles": u.roles,
        "disabled": u.disabled,
    }


def _test_update_role(uid: str, roles: list[str]) -> None:
    u = _TEST_USERS.get(uid)
    if not u:
        raise HTTPException(status_code=404, detail="not_found")
    normalized = _normalize_roles_from_claims({"roles": roles})
    u.roles = normalized
    u.role = _derive_legacy_role(u.roles)


def _test_update_disabled(uid: str, disabled: bool) -> None:
    u = _TEST_USERS.get(uid)
    if not u:
        raise HTTPException(status_code=404, detail="not_found")
    u.disabled = bool(disabled)


def _test_update_password(uid: str, password: str) -> None:
    if uid not in _TEST_USERS:
        raise HTTPException(status_code=404, detail="not_found")
    # 저장하지 않음
    _ = password


def _test_delete_user(uid: str) -> None:
    if uid not in _TEST_USERS:
        raise HTTPException(status_code=404, detail="not_found")
    _TEST_USERS.pop(uid, None)


def is_firebase_admin_configured() -> bool:
    return bool(
        (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
        and (os.getenv("FIREBASE_CLIENT_EMAIL") or "").strip()
        and (os.getenv("FIREBASE_PRIVATE_KEY") or "").strip()
    )

def firebase_admin_status() -> dict[str, Any]:
    """
    Firebase Admin SDK(서비스계정) 설정 상태를 반환한다.

    - secrets 값 자체는 절대 반환하지 않는다.
    - UI에서 "왜 사용자관리 기능이 503으로 실패하는지"를 설명하기 위한 용도다.
    """
    pid = (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
    email = (os.getenv("FIREBASE_CLIENT_EMAIL") or "").strip()
    pkey = (os.getenv("FIREBASE_PRIVATE_KEY") or "").strip()

    missing: list[str] = []
    if not pid:
        missing.append("FIREBASE_PROJECT_ID")
    if not email:
        missing.append("FIREBASE_CLIENT_EMAIL")
    if not pkey:
        missing.append("FIREBASE_PRIVATE_KEY")

    return {
        "adminTestMode": bool(_is_admin_test_mode()),
        "firebaseAdminConfigured": bool(is_firebase_admin_configured()),
        "missingEnv": missing,
    }


def _import_firebase_admin():
    # firebase-admin은 운영에서 필요하지만, 테스트/일부 개발 환경에서는 설치되지 않았을 수 있어 지연 import.
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import auth, credentials  # type: ignore

        return firebase_admin, auth, credentials
    except Exception as e:  # pragma: no cover
        raise RuntimeError("firebase_admin_missing") from e


_FB_APP_READY = False


def _ensure_firebase_admin_initialized() -> Any:
    global _FB_APP_READY
    if _FB_APP_READY:
        return True
    firebase_admin, _auth, credentials = _import_firebase_admin()
    if firebase_admin._apps:  # type: ignore[attr-defined]
        _FB_APP_READY = True
        return True
    project_id = (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
    client_email = (os.getenv("FIREBASE_CLIENT_EMAIL") or "").strip()
    private_key = (os.getenv("FIREBASE_PRIVATE_KEY") or "").strip()
    private_key = private_key.replace("\\n", "\n").replace("\\\\n", "\n")
    if not (project_id and client_email and private_key):
        raise RuntimeError("firebase_admin_env_missing")
    cred = credentials.Certificate(
        {
            "type": "service_account",
            "project_id": project_id,
            "client_email": client_email,
            "private_key": private_key,
            # 아래 값은 필수는 아니지만 라이브러리가 기대하는 키여서 넣어둔다.
            "private_key_id": (os.getenv("FIREBASE_PRIVATE_KEY_ID") or "").strip() or None,
            # google-auth가 요구하는 필드(최소). 서비스 계정 JSON의 기본값과 동일.
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        }
    )
    firebase_admin.initialize_app(cred)
    _FB_APP_READY = True
    return True


def _require_firebase_admin_ready() -> None:
    """
    운영에서 Firebase Admin SDK(env 미주입)로 인해 500이 나지 않도록 503으로 명확히 반환한다.
    """
    try:
        _ensure_firebase_admin_initialized()
    except RuntimeError as e:
        msg = str(e) or ""
        if msg in ("firebase_admin_env_missing", "firebase_admin_missing"):
            raise HTTPException(status_code=503, detail=msg)
        raise


def _list_users_from_firebase() -> list[AdminUserSummary]:
    """Firebase Admin SDK에서 전체 사용자 목록을 조회한다. (iterate_all로 모든 페이지 순회)"""
    _require_firebase_admin_ready()
    _firebase_admin, auth, _credentials = _import_firebase_admin()

    out: list[AdminUserSummary] = []
    page = auth.list_users()
    for u in page.iterate_all():
        claims = dict(u.custom_claims or {})
        roles = _normalize_roles_from_claims(claims)
        raw_legacy = str(claims.get("role") or "").strip().lower()
        legacy: LegacyRole | None
        if raw_legacy in ("admin", "accounting", "sales", "marketing"):
            legacy = raw_legacy  # type: ignore[assignment]
        else:
            legacy = _derive_legacy_role(roles)
        out.append(
            {
                "uid": str(u.uid),
                "email": (str(u.email) if u.email else None),
                "displayName": (str(u.display_name) if u.display_name else None),
                "role": legacy,
                "roles": roles,
                "disabled": bool(getattr(u, "disabled", False)),
            }
        )
    out.sort(key=lambda x: (x["email"] or "", x["uid"]))
    return out


def list_users(request: Request | None = None) -> list[AdminUserSummary]:
    # Firebase Admin이 configured면 항상 Firebase에서 전체 사용자 조회 (ADMIN_TEST_MODE 무시)
    if is_firebase_admin_configured():
        return _list_users_from_firebase()
    if _is_admin_test_mode():
        out = _test_list_users()
        # 현재 요청자(JWT)를 목록에 포함해 "총 0명"이 아닌 최소 1명이 보이도록
        if request and not out:
            try:
                claims = get_claims_from_request(request)
                email = str(claims.get("email") or "").strip()
                uid = str(claims.get("sub") or claims.get("uid") or claims.get("user_id") or "").strip()
                if email or uid:
                    roles = _normalize_roles_from_claims(claims)
                    legacy = _derive_legacy_role(roles)
                    out.append(
                        {
                            "uid": uid or "current",
                            "email": email or None,
                            "displayName": str(claims.get("name") or "").strip() or None,
                            "role": legacy,
                            "roles": roles,
                            "disabled": False,
                        }
                    )
                    out.sort(key=lambda x: (x["email"] or "", x["uid"]))
            except Exception:
                pass
        return out
    raise HTTPException(status_code=503, detail="firebase_admin_env_missing")


def get_user_by_email(email: str) -> AdminUserSummary | None:
    e = str(email or "").strip()
    if not e:
        return None
    if _is_admin_test_mode():
        for u in _TEST_USERS.values():
            if (u.email or "").strip().lower() == e.lower():
                return {
                    "uid": u.uid,
                    "email": u.email,
                    "displayName": u.display_name,
                    "role": u.role,
                    "roles": u.roles,
                    "disabled": bool(u.disabled),
                }
        return None
    _require_firebase_admin_ready()
    _firebase_admin, auth, _credentials = _import_firebase_admin()
    try:
        u = auth.get_user_by_email(e)
    except Exception as ex:  # pragma: no cover
        # UserNotFoundError는 런타임 import 경로가 버전에 따라 달라질 수 있어 메시지로도 방어한다.
        name = ex.__class__.__name__
        if name == "UserNotFoundError":
            return None
        msg = str(ex) or ""
        if "USER_NOT_FOUND" in msg or "user-not-found" in msg:
            return None
        raise
    claims = dict(u.custom_claims or {})
    roles = _normalize_roles_from_claims(claims)
    return {
        "uid": str(u.uid),
        "email": (str(u.email) if u.email else None),
        "displayName": (str(u.display_name) if u.display_name else None),
        "role": (str(claims.get("role")).strip() if str(claims.get("role") or "").strip() in ("admin", "accounting", "sales", "marketing") else _derive_legacy_role(roles)),
        "roles": roles,
        "disabled": bool(getattr(u, "disabled", False)),
    }


def create_user(*, email: str, password: str, display_name: str | None, roles: list[str]) -> AdminUserSummary:
    if _is_admin_test_mode():
        return _test_create_user(email=email, password=password, display_name=display_name, roles=roles)
    _require_firebase_admin_ready()
    _firebase_admin, auth, _credentials = _import_firebase_admin()
    # 동기화 관점: email이 이미 있으면 "생성"이 아니라 "기존 사용자"로 처리되도록 명시적으로 막는다.
    # (프론트는 이 에러를 받아 목록 새로고침으로 유도)
    try:
        _ = auth.get_user_by_email(email)
        raise HTTPException(status_code=409, detail="email_already_exists")
    except Exception as ex:
        if ex.__class__.__name__ == "UserNotFoundError":
            pass
        else:
            msg = str(ex) or ""
            if "USER_NOT_FOUND" in msg or "user-not-found" in msg:
                pass
            elif isinstance(ex, HTTPException):
                raise
            else:
                # 기타 오류는 그대로 올린다.
                raise
    u = auth.create_user(email=email, password=password, display_name=display_name or None)
    set_roles(u.uid, roles=roles, merge=True)
    u2 = auth.get_user(u.uid)
    claims = dict(u2.custom_claims or {})
    normalized = _normalize_roles_from_claims(claims)
    return {
        "uid": str(u2.uid),
        "email": (str(u2.email) if u2.email else None),
        "displayName": (str(u2.display_name) if u2.display_name else None),
        "role": (str(claims.get("role")).strip() if str(claims.get("role") or "").strip() in ("admin", "accounting", "sales", "marketing") else _derive_legacy_role(normalized)),
        "roles": normalized,
        "disabled": bool(getattr(u2, "disabled", False)),
    }


def set_roles(uid: str, *, roles: list[str], merge: bool) -> None:
    if _is_admin_test_mode():
        return _test_update_role(uid, list(roles or []))
    _require_firebase_admin_ready()
    _firebase_admin, auth, _credentials = _import_firebase_admin()
    u = auth.get_user(uid)
    existing = dict(u.custom_claims or {})
    next_claims: dict[str, Any]
    if merge:
        next_claims = {**existing}
    else:
        next_claims = {}
    # 우리가 관리하는 키만 덮어쓴다.
    normalized = _normalize_roles_from_claims({"roles": roles})
    legacy = _derive_legacy_role(normalized)
    next_claims["role"] = legacy
    next_claims["roles"] = normalized
    auth.set_custom_user_claims(uid, next_claims)


def set_disabled(uid: str, *, disabled: bool) -> None:
    if _is_admin_test_mode():
        return _test_update_disabled(uid, disabled)
    _require_firebase_admin_ready()
    _firebase_admin, auth, _credentials = _import_firebase_admin()
    auth.update_user(uid, disabled=bool(disabled))


def set_password(uid: str, *, password: str) -> None:
    if _is_admin_test_mode():
        return _test_update_password(uid, password)
    _require_firebase_admin_ready()
    _firebase_admin, auth, _credentials = _import_firebase_admin()
    auth.update_user(uid, password=password)


def delete_user(uid: str) -> None:
    if _is_admin_test_mode():
        return _test_delete_user(uid)
    _require_firebase_admin_ready()
    _firebase_admin, auth, _credentials = _import_firebase_admin()
    auth.delete_user(uid)

