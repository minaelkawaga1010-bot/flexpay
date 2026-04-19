from __future__ import annotations

import enum
from datetime import datetime

import ulid
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def new_id(prefix: str) -> str:
    return f"{prefix}_{ulid.new().str}"


class KycTier(enum.IntEnum):
    TIER_0 = 0
    TIER_1 = 1
    TIER_2 = 2
    TIER_3 = 3


class WalletStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    FROZEN = "FROZEN"
    CLOSED = "CLOSED"


class TransactionType(str, enum.Enum):
    TOPUP = "TOPUP"
    P2P_OUT = "P2P_OUT"
    P2P_IN = "P2P_IN"
    REMITTANCE_OUT = "REMITTANCE_OUT"
    EWA_DRAW = "EWA_DRAW"
    LOAN_DISBURSE = "LOAN_DISBURSE"
    LOAN_REPAY = "LOAN_REPAY"
    BILL_PAY = "BILL_PAY"
    CARD_SPEND = "CARD_SPEND"
    FEE = "FEE"
    ADJUSTMENT = "ADJUSTMENT"


class TransactionStatus(str, enum.Enum):
    PENDING = "PENDING"
    SETTLED = "SETTLED"
    FAILED = "FAILED"
    REVERSED = "REVERSED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("usr"))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    emirates_id_enc: Mapped[str | None] = mapped_column(String(255), default=None)
    full_name: Mapped[str | None] = mapped_column(String(200), default=None)
    locale: Mapped[str] = mapped_column(String(8), default="en")
    kyc_tier: Mapped[int] = mapped_column(default=KycTier.TIER_0)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    wallet: Mapped[Wallet | None] = relationship(back_populates="user", uselist=False)


class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("wal"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    status: Mapped[WalletStatus] = mapped_column(Enum(WalletStatus), default=WalletStatus.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="wallet")
    balances: Mapped[list[Balance]] = relationship(back_populates="wallet", cascade="all, delete-orphan")


class Balance(Base):
    __tablename__ = "balances"
    __table_args__ = (
        UniqueConstraint("wallet_id", "currency", name="uq_balance_wallet_currency"),
        CheckConstraint("available >= 0", name="ck_balance_nonneg"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("bal"))
    wallet_id: Mapped[str] = mapped_column(ForeignKey("wallets.id"), index=True)
    currency: Mapped[str] = mapped_column(String(3))
    available: Mapped[int] = mapped_column(BigInteger, default=0)
    pending: Mapped[int] = mapped_column(BigInteger, default=0)

    wallet: Mapped[Wallet] = relationship(back_populates="balances")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_tx_wallet_created", "wallet_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tx"))
    wallet_id: Mapped[str] = mapped_column(ForeignKey("wallets.id"), index=True)
    counterparty_wallet_id: Mapped[str | None] = mapped_column(ForeignKey("wallets.id"), default=None)
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType))
    status: Mapped[TransactionStatus] = mapped_column(Enum(TransactionStatus), default=TransactionStatus.PENDING)
    amount: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    external_ref: Mapped[str | None] = mapped_column(String(100), default=None, index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), default=None, index=True, unique=True)
    note: Mapped[str | None] = mapped_column(String(200), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class OtpRequest(Base):
    __tablename__ = "otp_requests"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("otp"))
    phone: Mapped[str] = mapped_column(String(20), index=True)
    code_hash: Mapped[str] = mapped_column(String(200))
    consumed: Mapped[bool] = mapped_column(default=False)
    attempts: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("aud"))
    actor_id: Mapped[str | None] = mapped_column(String(40), default=None, index=True)
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(40), index=True)
    metadata_json: Mapped[str | None] = mapped_column(String(4000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
