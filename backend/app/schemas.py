from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PHONE_RE = r"^\+\d{8,15}$"
CURRENCY_RE = r"^[A-Z]{3}$"


class OtpRequestIn(BaseModel):
    phone: str = Field(pattern=PHONE_RE)
    channel: Literal["sms", "whatsapp"] = "sms"


class OtpRequestOut(BaseModel):
    request_id: str
    expires_in: int


class OtpVerifyIn(BaseModel):
    request_id: str
    code: str = Field(min_length=4, max_length=8)
    device_id: str = Field(min_length=1, max_length=80)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    phone: str
    full_name: str | None
    locale: str
    kyc_tier: int


class TokenBundle(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_in: int
    user: UserOut


class RefreshIn(BaseModel):
    refresh_token: str


class BalanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    currency: str
    available: int
    pending: int


class WalletOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    balances: list[BalanceOut]


class TopUpIn(BaseModel):
    amount: int = Field(gt=0, le=100_000_00)  # AED 100K in minor units
    currency: str = Field(pattern=CURRENCY_RE)
    idempotency_key: str | None = None


class P2PIn(BaseModel):
    recipient_phone: str = Field(pattern=PHONE_RE)
    amount: int = Field(gt=0)
    currency: str = Field(pattern=CURRENCY_RE)
    note: str | None = Field(default=None, max_length=200)
    idempotency_key: str | None = None

    @field_validator("amount")
    @classmethod
    def sane(cls, v: int) -> int:
        if v > 100_000_00:
            raise ValueError("amount exceeds per-txn cap")
        return v


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: str
    status: str
    amount: int
    currency: str
    note: str | None
    created_at: datetime
    settled_at: datetime | None


class Problem(BaseModel):
    type: str
    title: str
    status: int
    detail: str | None = None
    code: str | None = None
