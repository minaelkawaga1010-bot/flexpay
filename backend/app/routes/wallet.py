from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Transaction, User
from ..schemas import BalanceOut, P2PIn, TopUpIn, TransactionOut, WalletOut
from ..security import require_user
from ..services import wallet_service

router = APIRouter(tags=["wallet"])


@router.get("/wallet", response_model=WalletOut)
def get_wallet(user: User = Depends(require_user), db: Session = Depends(get_db)) -> WalletOut:
    wallet = wallet_service.ensure_wallet(db, user)
    db.commit()
    balances = [BalanceOut.model_validate(b) for b in wallet.balances]
    return WalletOut(id=wallet.id, status=wallet.status.value, balances=balances)


@router.post("/wallet/top-up", response_model=TransactionOut, status_code=201)
def wallet_top_up(
    body: TopUpIn, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> TransactionOut:
    tx = wallet_service.top_up(db, user, body.amount, body.currency, body.idempotency_key)
    return TransactionOut.model_validate(tx)


@router.post("/wallet/p2p", response_model=TransactionOut, status_code=201)
def wallet_p2p(
    body: P2PIn, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> TransactionOut:
    tx = wallet_service.p2p_transfer(
        db, user, body.recipient_phone, body.amount, body.currency, body.note, body.idempotency_key
    )
    return TransactionOut.model_validate(tx)


@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=25, ge=1, le=100),
) -> list[TransactionOut]:
    wallet = wallet_service.ensure_wallet(db, user)
    db.commit()
    txs = db.scalars(
        select(Transaction).where(Transaction.wallet_id == wallet.id).order_by(desc(Transaction.created_at)).limit(limit)
    ).all()
    return [TransactionOut.model_validate(t) for t in txs]
