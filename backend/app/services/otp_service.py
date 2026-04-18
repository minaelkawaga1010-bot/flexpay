from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import OtpRequest, User, Wallet
from ..security import hash_otp, mint_access_token, mint_refresh_token, verify_otp

settings = get_settings()


def request_otp(db: Session, phone: str) -> OtpRequest:
    code = settings.otp_dev_fixed_code or _random_code()
    now = datetime.now(tz=timezone.utc)
    otp = OtpRequest(
        phone=phone,
        code_hash=hash_otp(code),
        expires_at=now + timedelta(seconds=settings.otp_ttl_seconds),
    )
    db.add(otp)
    db.commit()
    db.refresh(otp)
    # In production, send via Twilio here. Dev prints to logs.
    if settings.env == "dev":
        print(f"[dev] OTP for {phone}: {code}")
    return otp


def _random_code() -> str:
    import secrets

    return f"{secrets.randbelow(1_000_000):06d}"


def verify_and_issue(
    db: Session, request_id: str, code: str, device_id: str
) -> tuple[User, str, str]:
    otp = db.get(OtpRequest, request_id)
    now = datetime.now(tz=timezone.utc)
    if otp is None or otp.consumed:
        raise HTTPException(status_code=401, detail="otp_invalid_or_expired")
    expires_at = otp.expires_at if otp.expires_at.tzinfo else otp.expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        raise HTTPException(status_code=401, detail="otp_invalid_or_expired")
    otp.attempts += 1
    if otp.attempts > 5:
        otp.consumed = True
        db.commit()
        raise HTTPException(status_code=429, detail="otp_too_many_attempts")
    if not verify_otp(code, otp.code_hash):
        db.commit()
        raise HTTPException(status_code=401, detail="otp_wrong_code")

    otp.consumed = True
    user = db.scalar(select(User).where(User.phone == otp.phone))
    if user is None:
        user = User(phone=otp.phone)
        db.add(user)
        db.flush()
        db.add(Wallet(user_id=user.id))
    db.commit()
    db.refresh(user)

    access = mint_access_token(user.id)
    refresh, _jti = mint_refresh_token(user.id)
    return user, access, refresh
