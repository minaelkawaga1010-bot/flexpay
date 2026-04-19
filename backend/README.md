# FlexPay Backend

FastAPI + SQLAlchemy 2 + Alembic, PostgreSQL 15, Redis 7.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload
```

Open http://localhost:8000/docs for interactive OpenAPI.

## Tests

```bash
pytest -q
```

Tests run against SQLite in-memory and do not require a running database.

## Layout

```
app/
  config.py          # pydantic-settings
  db.py              # SQLAlchemy engine + Base
  models.py          # User, Wallet, Balance, Transaction, OtpRequest, AuditLog
  schemas.py         # pydantic request/response models
  security.py        # JWT mint/verify, OTP hashing, HMAC webhook verify
  routes/            # FastAPI routers
  services/          # business logic (wallet, OTP)
alembic/             # DB migrations
tests/               # pytest suite
```

## Production notes

- JWT uses RS256 when `keys/jwt_private.pem` and `keys/jwt_public.pem` exist; falls back to HS256 dev-secret otherwise.
- Idempotency keys are enforced at the DB level via a unique index on `transactions.idempotency_key`.
- All writes to `balances` use `SELECT ... FOR UPDATE` to prevent races.
- CBUAE residency: deploy to `me-central-1`. See `infra/terraform/`.
