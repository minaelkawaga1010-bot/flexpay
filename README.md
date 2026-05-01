# FlexPay

Backend service for **FlexPay** — a fintech platform for blue-collar workers in
the UAE. Provides payroll wallet (WPS), virtual & physical cards, P2P transfers,
cashback, savings goals, credit scoring, salary advances (EWA), international
remittance, referrals, and push notifications.

## Stack

- **Node.js 18 + TypeScript** (Express, path aliases via `@config/*`, `@shared/*`, `@modules/*`, `@webhooks/*`)
- **Prisma + PostgreSQL** — Prisma `$transaction` guarantees atomicity for financial flows
- **Redis** — OTP store, rate limit counters, idempotency cache, FX rate cache, Bull queue
- **Bull + node-cron** — three named queues (payroll/notifications/webhooks) with exponential backoff; centralized cron manager (GST)
- **JWT** — separate access (15m) and refresh (7d) secrets, role-based middleware
- **Firebase Admin** — push notifications
- **Twilio** — SMS / OTP
- **NymCard / MoneyHash / FlexxPay** — card issuance, remittance, EWA (axios clients with stub fallback)
- **Zod** — environment validation, request validation, reusable schemas
- **winston** — structured logging

## Architecture

```
flexpay-backend/
├── package.json, tsconfig.json, .env.example
├── docker-compose.yml, Dockerfile (multi-stage, non-root)
├── prisma/schema.prisma
├── docs/openapi.yaml
├── src/
│   ├── app.ts                                # express app factory
│   ├── server.ts                             # HTTP server + scheduler
│   ├── routes.ts                             # /api/v1 surface
│   ├── config/
│   │   ├── env.ts                            # Zod-typed env vars
│   │   ├── prisma.ts                         # PrismaClient singleton
│   │   ├── redis.ts                          # Redis client + OTP/rate-limit ops
│   │   ├── firebase.ts                       # FCM admin init
│   │   └── bull.ts                           # Queue factory w/ exp. backoff
│   ├── shared/
│   │   ├── middleware/
│   │   │   ├── auth.ts                       # JWT + role + DB live-check
│   │   │   ├── rate-limit.ts                 # express-rate-limit + Redis API limiter
│   │   │   ├── validator.ts                  # Zod-driven req validation
│   │   │   └── error-handler.ts
│   │   ├── utils/
│   │   │   ├── jwt.ts                        # access/refresh token pair
│   │   │   ├── otp.ts                        # 6-digit OTP generator
│   │   │   ├── currency.ts                   # AED rounding/formatting
│   │   │   ├── idempotency.ts                # Idempotency-Key middleware
│   │   │   ├── logger.ts                     # winston logger
│   │   │   ├── errors.ts                     # AppError + 4xx helpers
│   │   │   ├── asyncHandler.ts
│   │   │   └── referralCode.ts
│   │   └── types/
│   │       ├── index.ts, api.ts, nymcard.ts
│   ├── modules/
│   │   ├── auth/        auth.{controller,service,routes,dto}.ts + twilio.service.ts
│   │   ├── payroll/     payroll.{controller,service,routes,dto,job}.ts
│   │   ├── wallet/      wallet.{controller,service,routes,dto}.ts
│   │   ├── cards/       cards.{controller,service,routes,dto}.ts + nymcard.service.ts
│   │   ├── cashback/    cashback.service.ts
│   │   ├── offers/      offers.{controller,service,routes}.ts
│   │   ├── savings/     savings.{controller,service,routes,job}.ts
│   │   ├── scoring/     scoring.{controller,service}.ts
│   │   ├── ewa/         ewa.controller.ts + flexxpay.service.ts
│   │   ├── remittance/  remittance.{controller,service}.ts + moneyhash.service.ts
│   │   ├── referrals/   referrals.{service,routes}.ts
│   │   └── notifications/ notification.{controller,service}.ts
│   └── webhooks/        nymcard.webhook.ts, moneyhash.webhook.ts, flexxpay.webhook.ts
└── tests/               jest unit tests (mocked prisma + redis)
```

All inter-module imports use the path aliases:

```ts
import { prisma } from '@config/prisma';
import { authenticate } from '@shared/middleware/auth';
import { walletService } from '@modules/wallet/wallet.service';
```

## Getting started

```bash
# 1. Install deps
npm install

# 2. Set environment
cp .env.example .env

# 3. Spin up Postgres + Redis
npm run docker:up

# 4. Generate Prisma client + apply migrations
npm run prisma:generate
npx prisma migrate dev --name init

# 5. Run the API (with path aliases via tsconfig-paths)
npm run dev

# 6. Run unit tests (mocked Prisma + Redis)
npm test

# 7. Run e2e tests (requires real Postgres + Redis from docker-compose)
npm run docker:up
npx prisma migrate deploy
npm run test:e2e
```

The e2e suite (`tests/e2e/*.e2e.test.ts`) drives the live app via supertest
and uses real Postgres + Redis. It boots with `E2E_MODE=1` so the
in-test no-op guards in Redis/Bull don't short-circuit. External APIs
(NymCard / Twilio / MoneyHash / FlexxPay) stay stubbed because their
keys are still absent — the suite only asserts on FlexPay state.

A health check is exposed at `GET /health`. The OpenAPI contract is at
[`docs/openapi.yaml`](docs/openapi.yaml). All API endpoints live under
`/api/v1` (configurable via `API_PREFIX`).

## Implementation phases

| Phase | Feature | Status |
| --- | --- | --- |
| **P0** | Employee OTP auth + Company email/password auth | ✅ Implemented |
| **P0** | Payroll wallet (Bull queue + atomic Prisma tx) | ✅ Implemented |
| **P0** | Virtual card via NymCard (auto-issued at signup) | ✅ Implemented |
| **P0** | P2P transfer (idempotency-key + per-user transfer limiter) | ✅ Implemented |
| **P0** | Cashback (configurable rates and caps via env) | ✅ Implemented |
| **P1** | Physical card (configurable fee, shipping webhook) | ✅ Implemented |
| **P1** | Savings goals + monthly auto-save (GST cron) | ✅ Implemented |
| **P1** | Credit scoring (rule-based, 24h cached, server-side only) | ✅ Implemented |
| **P1** | Referral program (idempotent reward on first qualifying deposit) | ✅ Implemented |
| **P1** | Push notifications (FCM, opt-out endpoint) | ✅ Implemented |
| **P2** | Apple/Google Pay tokenization (NymCard + token storage on Card) | ✅ Implemented |
| **P2** | International remittance (5-min FX cache) | ✅ Implemented |
| **P2** | EWA via FlexxPay redirect | ✅ Implemented |

## Risk mitigations baked in

- **OTP brute-force** — `authRateLimiter` (5/window) keyed on phone, plus `otpRateLimiter` (3/h)
- **P2P double-spend** — `Idempotency-Key` middleware + Prisma `$transaction` + per-user `transferRateLimiter`
- **Payroll job failure** — Bull queue with exponential backoff (5 attempts), payroll row records `failureReason`
- **Webhook spoofing** — HMAC-SHA256 verification on NymCard / MoneyHash with raw-body parsing mounted before `express.json()`
- **Credit-score manipulation** — server-side only, no client input, persisted on `Employee.creditScore`
- **Remittance FX volatility** — rates cached for 5 min; quote response carries an "estimated amount" disclaimer

## Notes

External services (NymCard, Twilio, MoneyHash, FlexxPay, Firebase) gracefully
fall back to logged stubs when their API keys are not configured, so the full
pipeline runs end-to-end in development without sandbox accounts.
