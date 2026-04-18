# FlexPay API Specification

**Version:** v1 (beta)
**Base URL:** `https://api.flexpay.ae/v1`
**Auth:** Bearer JWT (RS256). Refresh tokens rotate on every use.
**Content type:** `application/json; charset=utf-8`
**Idempotency:** any state-changing endpoint accepts `Idempotency-Key` header (UUID v4). Keys cached 24 h.

---

## 1. Conventions

- All monetary amounts are **minor units** as integers (e.g., 12345 = AED 123.45). `currency` is ISO 4217.
- Timestamps are RFC 3339 UTC.
- List endpoints paginate with `?limit=&cursor=`. Max `limit` = 100; default 25.
- Errors follow RFC 7807 `application/problem+json`:

```json
{
  "type": "https://errors.flexpay.ae/insufficient-funds",
  "title": "Insufficient funds",
  "status": 402,
  "detail": "Wallet balance 1200 AED cannot cover 1500 AED transfer",
  "instance": "/v1/transactions/tx_01H...",
  "code": "WALLET_INSUFFICIENT_FUNDS",
  "traceId": "abc123"
}
```

- Rate limits: 60 req/min per user; 600 req/min per IP; remittance-create: 10/min per user.

## 2. Authentication

### `POST /auth/otp/request`
Body:
```json
{ "phone": "+971501234567", "channel": "sms" }
```
Response `202`:
```json
{ "requestId": "otp_01H...", "expiresIn": 300 }
```

### `POST /auth/otp/verify`
Body:
```json
{ "requestId": "otp_01H...", "code": "123456", "deviceId": "ios-abcd" }
```
Response `200`:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": { "id": "usr_...", "kycTier": 0, "locale": "en" }
}
```

### `POST /auth/refresh`
Body: `{ "refreshToken": "..." }` — returns new pair. Old refresh token invalidated.

### `POST /auth/logout`
Revokes the presented refresh token.

## 3. KYC

### `POST /kyc/sessions`
Creates a Sumsub applicant and returns a one-time signed URL.
```json
{ "tier": 2, "redirectUrl": "flexpay://kyc/done" }
```
Response: `{ "sessionId": "...", "url": "...", "expiresAt": "..." }`

### `GET /kyc/status`
```json
{
  "tier": 1,
  "status": "APPROVED",
  "evidence": ["EID", "SELFIE"],
  "nextTier": { "tier": 2, "requiredDocs": ["PROOF_OF_ADDRESS"] }
}
```

### `POST /kyc/webhook` (Sumsub → us)
HMAC-signed via `X-Payload-Digest`. Rejects if signature invalid or timestamp skew > 5 min.

## 4. Wallet & Balances

### `GET /wallet`
```json
{
  "id": "wal_...",
  "status": "ACTIVE",
  "balances": [
    { "currency": "AED", "available": 125000, "pending": 500 },
    { "currency": "INR", "available": 150000, "pending": 0 }
  ],
  "limits": { "monthlyOut": 2500000, "monthlyUsed": 450000 }
}
```

### `POST /wallet/top-up`
Initiate a top-up from linked card / bank.
```json
{ "amount": 50000, "currency": "AED", "source": "card_01H..." }
```

### `POST /wallet/p2p`
Send money to another FlexPay user.
```json
{ "recipient": "usr_01H...", "amount": 10000, "currency": "AED", "note": "Coffee" }
```

## 5. Transactions

### `GET /transactions`
Query: `?from=&to=&type=&status=&limit=&cursor=`
```json
{
  "items": [
    {
      "id": "tx_01H...",
      "type": "P2P_OUT",
      "amount": -10000,
      "currency": "AED",
      "status": "SETTLED",
      "counterparty": { "id": "usr_...", "name": "Ahmed K." },
      "createdAt": "2026-04-17T09:00:00Z",
      "settledAt": "2026-04-17T09:00:02Z"
    }
  ],
  "nextCursor": "..."
}
```

### `GET /transactions/{id}`
Full detail including ledger entries for reconciliation.

## 6. Cards

### `GET /cards`
### `POST /cards` — request new virtual card (Tier ≥ 1)
### `POST /cards/{id}/freeze` / `POST /cards/{id}/unfreeze`
### `POST /cards/{id}/pin/change` — requires fresh OTP in last 5 min
### `GET /cards/{id}/secure` — returns NymCard one-time URL for PAN reveal (iframe)

## 7. Remittance

### `GET /remittance/corridors`
```json
[
  { "code": "AE-IN", "country": "IN", "currencies": ["INR"], "minAmount": 50000, "maxAmount": 5000000, "estimatedMinutes": 15 }
]
```

### `GET /remittance/quotes?corridor=AE-IN&amount=100000&currency=AED`
Returns a time-bound quote (valid 60 s).
```json
{
  "quoteId": "qt_...",
  "sendAmount": 100000,
  "sendCurrency": "AED",
  "receiveAmount": 2238000,
  "receiveCurrency": "INR",
  "fxRate": 22.38,
  "fee": 500,
  "expiresAt": "2026-04-17T09:01:00Z"
}
```

### `POST /remittance/transfers`
```json
{
  "quoteId": "qt_...",
  "beneficiaryId": "ben_...",
  "purpose": "FAMILY_SUPPORT",
  "idempotencyKey": "..."
}
```
Response `201` — transfer in `PENDING_COMPLIANCE` then `PENDING_PARTNER_SUBMIT` → `SETTLED` or `FAILED`.

### `GET /remittance/transfers/{id}`

### `POST /remittance/beneficiaries`
### `GET /remittance/beneficiaries`
### `DELETE /remittance/beneficiaries/{id}`

## 8. Earned Wage Access

### `GET /ewa/eligibility`
```json
{ "eligible": true, "accruedAmount": 180000, "maxDrawable": 90000, "drawFee": 1000, "nextPayrollDate": "2026-04-30" }
```

### `POST /ewa/draws`
```json
{ "amount": 50000, "idempotencyKey": "..." }
```

### `GET /ewa/draws` — history

## 9. Credit & Loans

### `GET /credit/profile`
```json
{ "score": 642, "tier": "B", "limit": 500000, "model": "v0.3.2", "updatedAt": "..." }
```
(The `score` is not shown in the mobile app; only a qualitative tier.)

### `POST /loans/apply`
```json
{ "amount": 300000, "tenureMonths": 6, "purpose": "HOME_APPLIANCE" }
```
Response: `{ "loanId": "...", "status": "PENDING_REVIEW" }`

### `GET /loans` / `GET /loans/{id}` / `POST /loans/{id}/accept`

## 10. Hafiza (Savings Circles)

### `GET /hafiza/circles` — user's memberships
### `POST /hafiza/circles` — create
```json
{ "size": 10, "contribution": 50000, "currency": "AED", "rotation": "RANDOM" }
```
### `POST /hafiza/circles/{id}/join`
### `POST /hafiza/circles/{id}/contribute`
### `GET /hafiza/circles/{id}/schedule`

## 11. Bills & Merchant Pay

### `GET /bills/billers?category=UTILITY`
### `POST /bills/lookup` — retrieve outstanding amount by consumer number
### `POST /bills/pay`
### `POST /merchant/qr/pay`

## 12. Notifications

### `GET /notifications?unread=true`
### `POST /notifications/{id}/read`
### `PUT /notifications/preferences`

## 13. Voice

### `POST /voice/commands`
Multipart: `audio` (audio/ogg or audio/webm, ≤ 15 s), `locale`.
Response:
```json
{
  "transcript": "Send 200 dirhams to Ravi",
  "intent": "P2P_SEND",
  "confidence": 0.94,
  "entities": { "amount": 20000, "currency": "AED", "recipientName": "Ravi" },
  "actionUrl": "/v1/wallet/p2p?prefill=..."
}
```

## 14. Admin / Support (internal)

Separate base `https://admin-api.flexpay.ae/v1`, tighter IP allowlist, mutual TLS + SSO.

- `GET /admin/users/{id}` — full profile + KYC artefacts (permissioned)
- `POST /admin/users/{id}/freeze` — reason required
- `POST /admin/transactions/{id}/reverse` — dual approval
- `GET /admin/aml/alerts` — queue
- `POST /admin/aml/alerts/{id}/decision`
- `POST /admin/cases/{id}/str` — file STR to CBUAE (dry-run in sandbox)

All admin actions emit AuditLog rows. Reads of PII beyond masking are also logged.

## 15. Webhooks (outbound)

We notify employer systems of payroll disbursements:

`POST {employer.webhook_url}`
Headers: `X-FlexPay-Timestamp`, `X-FlexPay-Signature` (HMAC-SHA256 over timestamp + body).
Replay protection: reject timestamps older than 5 minutes.
Retry: exponential, up to 24 h, then dead-letter.

## 16. Error Codes (abridged)

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_INVALID_OTP` | 401 | OTP wrong or expired |
| `AUTH_DEVICE_UNKNOWN` | 401 | New device; requires full re-auth |
| `KYC_TIER_INSUFFICIENT` | 403 | Action requires higher tier |
| `WALLET_INSUFFICIENT_FUNDS` | 402 | Balance cannot cover |
| `LIMIT_EXCEEDED_DAILY` | 429 | Daily cap hit |
| `RATE_LIMIT` | 429 | Throttled |
| `REMITTANCE_QUOTE_EXPIRED` | 409 | Re-quote required |
| `REMITTANCE_COMPLIANCE_HOLD` | 202 | Under review; will settle or fail |
| `LOAN_INELIGIBLE` | 422 | Does not meet policy |
| `IDEMPOTENCY_MISMATCH` | 409 | Same key, different body |
| `COMPLIANCE_BLOCKED` | 451 | Action blocked for compliance |

## 17. Versioning

- Path versioning (`/v1`). Breaking changes require a new major.
- Non-breaking additions (new optional fields, new endpoints) do not bump.
- Deprecations announced ≥ 6 months in advance via `Deprecation` and `Sunset` headers.
