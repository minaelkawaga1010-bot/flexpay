from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import (
    Balance,
    Transaction,
    TransactionStatus,
    TransactionType,
    User,
    Wallet,
    WalletStatus,
)


def ensure_wallet(db: Session, user: User) -> Wallet:
    wallet = db.scalar(select(Wallet).where(Wallet.user_id == user.id))
    if wallet is None:
        wallet = Wallet(user_id=user.id, status=WalletStatus.ACTIVE)
        db.add(wallet)
        db.flush()
    return wallet


def _get_or_create_balance(db: Session, wallet: Wallet, currency: str) -> Balance:
    bal = db.scalar(
        select(Balance).where(Balance.wallet_id == wallet.id, Balance.currency == currency).with_for_update()
    )
    if bal is None:
        bal = Balance(wallet_id=wallet.id, currency=currency, available=0, pending=0)
        db.add(bal)
        db.flush()
    return bal


def _check_idempotency(db: Session, key: str | None) -> Transaction | None:
    if not key:
        return None
    return db.scalar(select(Transaction).where(Transaction.idempotency_key == key))


def top_up(db: Session, user: User, amount: int, currency: str, idempotency_key: str | None) -> Transaction:
    if amount <= 0:
        raise HTTPException(status_code=422, detail="amount_must_be_positive")

    if existing := _check_idempotency(db, idempotency_key):
        return existing

    wallet = ensure_wallet(db, user)
    if wallet.status != WalletStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="wallet_not_active")

    bal = _get_or_create_balance(db, wallet, currency)
    bal.available += amount

    tx = Transaction(
        wallet_id=wallet.id,
        type=TransactionType.TOPUP,
        status=TransactionStatus.SETTLED,
        amount=amount,
        currency=currency,
        idempotency_key=idempotency_key,
        settled_at=datetime.now(tz=timezone.utc),
    )
    db.add(tx)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="idempotency_conflict") from exc
    db.refresh(tx)
    return tx


def p2p_transfer(
    db: Session,
    sender: User,
    recipient_phone: str,
    amount: int,
    currency: str,
    note: str | None,
    idempotency_key: str | None,
) -> Transaction:
    if amount <= 0:
        raise HTTPException(status_code=422, detail="amount_must_be_positive")
    if sender.phone == recipient_phone:
        raise HTTPException(status_code=422, detail="cannot_send_to_self")

    if existing := _check_idempotency(db, idempotency_key):
        return existing

    recipient = db.scalar(select(User).where(User.phone == recipient_phone))
    if recipient is None or not recipient.is_active:
        raise HTTPException(status_code=404, detail="recipient_not_found")

    sender_wallet = ensure_wallet(db, sender)
    recipient_wallet = ensure_wallet(db, recipient)

    if sender_wallet.status != WalletStatus.ACTIVE or recipient_wallet.status != WalletStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="wallet_not_active")

    sender_bal = _get_or_create_balance(db, sender_wallet, currency)
    if sender_bal.available < amount:
        raise HTTPException(status_code=402, detail="insufficient_funds")

    recipient_bal = _get_or_create_balance(db, recipient_wallet, currency)

    sender_bal.available -= amount
    recipient_bal.available += amount

    now = datetime.now(tz=timezone.utc)
    out_tx = Transaction(
        wallet_id=sender_wallet.id,
        counterparty_wallet_id=recipient_wallet.id,
        type=TransactionType.P2P_OUT,
        status=TransactionStatus.SETTLED,
        amount=-amount,
        currency=currency,
        note=note,
        idempotency_key=idempotency_key,
        settled_at=now,
    )
    in_tx = Transaction(
        wallet_id=recipient_wallet.id,
        counterparty_wallet_id=sender_wallet.id,
        type=TransactionType.P2P_IN,
        status=TransactionStatus.SETTLED,
        amount=amount,
        currency=currency,
        note=note,
        settled_at=now,
    )
    db.add_all([out_tx, in_tx])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="idempotency_conflict") from exc
    db.refresh(out_tx)
    return out_tx
