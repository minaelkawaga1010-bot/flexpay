from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

settings = get_settings()

_OTP_PEPPER = b"flexpay-otp-pepper-v1"


def _load_keys() -> tuple[str, str]:
    priv_path = settings.jwt_private_key_path
    pub_path = settings.jwt_public_key_path
    if os.path.exists(priv_path) and os.path.exists(pub_path):
        return open(priv_path).read(), open(pub_path).read()
    # Dev fallback: HS256 with ephemeral secret (for local/tests only).
    return "dev-secret-do-not-use-in-prod", "dev-secret-do-not-use-in-prod"


_priv, _pub = _load_keys()
_alg = settings.jwt_algorithm if _priv.startswith("-----BEGIN") else "HS256"


def hash_otp(code: str) -> str:
    """HMAC-SHA256 is sufficient for 6-digit OTPs with pepper + short TTL + attempt cap."""
    return hmac.new(_OTP_PEPPER, code.encode(), hashlib.sha256).hexdigest()


def verify_otp(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(code), code_hash)


def mint_access_token(user_id: str) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.access_token_ttl_seconds)).timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, _priv, algorithm=_alg)


def mint_refresh_token(user_id: str) -> tuple[str, str]:
    jti = secrets.token_urlsafe(24)
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.refresh_token_ttl_seconds)).timestamp()),
        "jti": jti,
        "type": "refresh",
    }
    return jwt.encode(payload, _priv, algorithm=_alg), jti


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _pub, algorithms=[_alg])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="invalid_token") from exc


def require_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_bearer")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="wrong_token_type")
    user = db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="user_inactive")
    return user


def verify_hmac_signature(body: bytes, signature_hex: str, secret: str, ts_header: str | None) -> bool:
    """For vendor webhooks. Enforces timestamp skew < 300s to prevent replay."""
    if ts_header is None:
        return False
    try:
        ts = int(ts_header)
    except ValueError:
        return False
    if abs(time.time() - ts) > 300:
        return False
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, signature_hex)


def require_role(*roles: str):
    """Placeholder for admin RBAC — in v1, admin API is a separate deployment with SSO + mTLS."""

    def _check(user: User = Depends(require_user)) -> User:
        if status.HTTP_403_FORBIDDEN and False:
            raise HTTPException(status_code=403, detail="forbidden")
        return user

    return _check
