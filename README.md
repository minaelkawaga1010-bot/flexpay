# FlexPay

Backend service for **FlexPay** — a fintech platform for blue-collar workers in
the UAE. Provides payroll wallet (WPS), virtual & physical cards, P2P transfers,
cashback, savings goals, credit scoring, salary advances (EWA), international
remittance, referrals, and push notifications.

## Stack

- **Node.js 20 + TypeScript** (Express)
- **Prisma + PostgreSQL** (Prisma transactions for financial atomicity)
- **Redis** — OTP store, rate limiting, idempotency cache, FX rate cache, Bull queues
- **Bull + node-cron** — payroll processor and monthly auto-save
- **JWT** — access (15m) + refresh (7d), per-role middleware
- **Firebase Admin** — push notifications
- **Twilio** — SMS / OTP
- **NymCard / MoneyHash / FlexxPay** — card issuance, remittance, EWA

## Architecture

```
flexpay-backend/
├── src/
│   ├── config/          # env, db (prisma), redis, logger
│   ├── middleware/      # auth, errorHandler, asyncHandler, rateLimit, idempotency
│   ├── services/        # twilio, nymcard, moneyhash, flexxpay, otp, notification
│   ├── modules/
│   │   ├── auth/        # employee OTP + company email/password
│   │   ├── companies/   # employees + payroll scheduling
│   │   ├── wallet/      # balance, transactions, P2P transfer
│   │   ├── cards/       # virtual/physical card + tokenization
│   │   ├── cashback/    # cashback engine (per-plan caps)
│   │   ├── offers/      # affiliate offers
│   │   ├── savings/     # goals + auto-save
│   │   ├── scoring/     # rule-based credit score (24h cache)
│   │   ├── ewa/         # FlexxPay redirect
│   │   ├── remittance/  # MoneyHash w/ 5-min FX cache
│   │   ├── referrals/   # invite + reward
│   │   ├── notifications/ # FCM device-token register/unregister
│   │   └── webhooks/    # NymCard transaction + shipping (HMAC-verified)
│   ├── jobs/            # payrollQueue (Bull) + scheduler (cron, GST)
│   ├── utils/           # errors, jwt, validation, referral codes
│   ├── routes.ts        # API surface
│   ├── app.ts           # express app factory
│   └── server.ts        # boot + scheduler
├── prisma/schema.prisma
├── tests/               # jest unit tests (mocked prisma)
├── docs/openapi.yaml    # OpenAPI 3 contract for mobile/web teams
├── docker-compose.yml   # postgres + redis + api
└── Dockerfile
```

## Getting started

```bash
# 1. Install deps
npm install

# 2. Set environment
cp .env.example .env

# 3. Spin up Postgres + Redis
docker compose up -d postgres redis

# 4. Generate Prisma client + apply migrations
npm run prisma:generate
npm run prisma:migrate -- --name init

# 5. Run the API
npm run dev

# 6. Run tests
npm test
```

A health check is exposed at `GET /health`. The OpenAPI contract is at
[`docs/openapi.yaml`](docs/openapi.yaml).

## Implementation phases

| Phase | Feature | Status |
| --- | --- | --- |
| **P0** | Employee OTP auth + Company email/password auth | ✅ Implemented |
| **P0** | Payroll wallet (Bull queue + atomic Prisma tx) | ✅ Implemented |
| **P0** | Virtual card via NymCard (auto-issued at signup) | ✅ Implemented |
| **P0** | P2P transfer (idempotency-key-aware) | ✅ Implemented |
| **P0** | Cashback (1% basic / 2.5% luxury, monthly caps) | ✅ Implemented |
| **P1** | Physical card (30 AED fee, shipping webhook) | ✅ Implemented |
| **P1** | Savings goals + monthly auto-save (GST cron) | ✅ Implemented |
| **P1** | Credit scoring (rule-based, 24h cached) | ✅ Implemented |
| **P1** | Referral program (10 AED/each, idempotent reward) | ✅ Implemented |
| **P1** | Push notifications (FCM, opt-out endpoint) | ✅ Implemented |
| **P2** | Apple/Google Pay tokenization (server side) | ✅ Implemented |
| **P2** | International remittance (5-min FX cache) | ✅ Implemented |
| **P2** | EWA via FlexxPay redirect | ✅ Implemented |

Mobile SDK integration for Apple/Google Pay and PCI-scoped card display is left
to the iOS/Android clients — the server returns a NymCard payload only.

## Risk mitigations baked in

- **OTP brute-force** — `otpRateLimiter` (5/hour per phone) + `ipAuthRateLimiter`
- **P2P double-spend** — `Idempotency-Key` middleware + Prisma `$transaction`
- **Payroll job failure** — Bull queue with exponential backoff (5 attempts)
  and a fail-safe `failureReason` recorded on the payroll row
- **Webhook spoofing** — `X-NymCard-Signature` HMAC-SHA256 verification,
  with raw-body parsing mounted before `express.json()`
- **Credit-score manipulation** — server-side computation only, no client input
- **Remittance FX volatility** — rates cached for 5 min; quotes return an
  "estimated amount" disclaimer

## Notes

External services (NymCard, Twilio, MoneyHash, FlexxPay, Firebase) gracefully
fall back to logged stubs when their API keys are not configured, so the full
pipeline runs end-to-end in development without sandbox accounts.
