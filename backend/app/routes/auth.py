from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..schemas import OtpRequestIn, OtpRequestOut, OtpVerifyIn, TokenBundle, UserOut
from ..services import otp_service

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/otp/request", response_model=OtpRequestOut, status_code=202)
def otp_request(body: OtpRequestIn, db: Session = Depends(get_db)) -> OtpRequestOut:
    otp = otp_service.request_otp(db, body.phone)
    return OtpRequestOut(request_id=otp.id, expires_in=settings.otp_ttl_seconds)


@router.post("/otp/verify", response_model=TokenBundle)
def otp_verify(body: OtpVerifyIn, db: Session = Depends(get_db)) -> TokenBundle:
    user, access, refresh = otp_service.verify_and_issue(db, body.request_id, body.code, body.device_id)
    return TokenBundle(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_seconds,
        user=UserOut.model_validate(user),
    )
