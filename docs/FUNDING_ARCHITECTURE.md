# FlexPay — Wallet & Funding Core: Production Architecture

> Principal-architect reference for the payroll-first, IBAN-centered financial
> ecosystem. Stack: **Node.js + TypeScript (free functions / modular), PostgreSQL,
> Redis, Kafka (or SQS) event bus, NymCard issuing, UAE WPS funding.**
>
> Foundational invariants (non-negotiable, day zero):
> - **Money is `BIGINT` minor units (fils).** Never `float`/`double`. Associative under addition; zero IEEE-754 drift.
> - **The dedicated virtual IBAN is the routing primitive.** The card is a spend access layer over the wallet; it is never the source of truth.
> - **The double-entry ledger is the single source of truth.** Every balance is a *projection* of the ledger, reconciled continuously. No code mutates a balance without an offsetting ledger pair in the same transaction.
> - **Every state-mutating boundary is HMAC-verified, idempotent on the provider reference, and atomic.**

---

## 0. SYSTEM TOPOLOGY (bird's eye)

```
                          ┌──────────────────────────── EXTERNAL ───────────────────────────┐
  Corporate HR ──SIF──▶   │  CBUAE WPS / Clearing Bank   NymCard (issuer+processor)   MoneyHash│
                          │        │ inbound credit            │ JIT auth / settlement    │ FX  │
                          └────────┼───────────────────────────┼──────────────────────────┼─────┘
                                   ▼                            ▼                          ▼
  ┌────────────────────────────────────────────────────────────────────────────────────────────┐
  │  EDGE / API GATEWAY  (ALB → Lambda authorizer → private ALB)  TLS1.3, WAF, per-IP+JWT rate-limit│
  └───────────────┬──────────────────────────────┬──────────────────────────┬────────────────────┘
                  ▼                              ▼                          ▼
        ┌───────────────────┐        ┌─────────────────────┐     ┌────────────────────────┐
        │ Webhook Ingestion  │        │  Core API (BFF)      │     │  JIT Auth Hot Path      │
        │  Engine (verify+    │        │  wallet/funding/card │     │  (<90ms, dedicated pool)│
        │  idempotent insert) │        │  free-fn services    │     │                        │
        └─────────┬─────────┘        └──────────┬──────────┘     └───────────┬────────────┘
                  │ publish                        │ publish                     │ sync read
                  ▼                                ▼                            ▼
  ┌────────────────────────────── KAFKA / SQS EVENT BUS ──────────────────────────────────────────┐
  │ topics: funding.received  funding.posted  card.authorized  card.settled  ledger.posted          │
  │         compliance.flagged  reconciliation.drift  dlq.*                                          │
  └───────┬───────────────┬────────────────┬─────────────────┬───────────────────┬────────────────┘
          ▼               ▼                ▼                 ▼                   ▼
  ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ ┌────────────────┐ ┌──────────────────┐
  │ Ledger Daemon │ │ Reconciler   │ │ Fraud/Compliance│ │ Ops-Intel /     │ │ Credit Data      │
  │ (per-wallet   │ │ Cron Workers │ │ Boundary Guard │ │ Liquidity Fcast │ │ Stream → Lake    │
  │ advisory lock)│ │ (drift scan) │ │ (AML/velocity) │ │                 │ │ (feature store)  │
  └──────┬───────┘ └──────┬───────┘ └───────┬────────┘ └───────┬────────┘ └────────┬─────────┘
         ▼                ▼                 ▼                  ▼                   ▼
  ┌──────────────────────────────── PostgreSQL (RDS, Multi-AZ, ap-southeast-3) ───────────────────┐
  │  ledger_entries (partitioned)  ledger_accounts  wallets  virtual_ibans  cards                  │
  │  incoming_transfers  card_transactions  webhook_events  reconciliation_jobs  audit_logs        │
  │  via PgBouncer (transaction mode)                                                              │
  └────────────────────────────────────────────────────────────────────────────────────────────┘
                  ▲ Redis (ElastiCache cluster): idempotency pre-flight, JIT balance cache (30s),
                    velocity sliding-windows, sanctions cache (24h), wallet-lock fast path
```

**Service-boundary rule:** the **JIT Auth Hot Path** runs on a *dedicated* process pool and connection sub-pool, isolated from the Core API, so a slow payroll batch can never starve the Visa 90 ms authorization window.

---

## 1. NYMCARD RESPONSIBILITIES & LIFECYCLE MANAGEMENT

NymCard owns the PAN/secure element and the card rails; **FlexPay owns the money** (ledger + balance). The boundary: NymCard never holds the authoritative balance — it *asks* us at authorization time.

### 1.1 Card issuing & lifecycle (outbound calls to NymCard)

| Operation | NymCard endpoint | FlexPay action | Retry policy |
|---|---|---|---|
| Issue virtual card on wallet creation | `POST /cards/virtual/issue` | store `cards.processor_card_id`, link `wallet_id` | 3× exp backoff (250ms→1s→4s), idempotent on `wallet_id` |
| Order physical card | `POST /cards/physical/order` | store shipping ref; status `ORDERED` | 3× on 5xx, 0× on 4xx |
| Activate | `POST /cards/{id}/activate` | status `ACTIVE`; emit `card.activated` | 2× |
| Set/Change PIN | `POST /cards/{id}/pin` (PIN block, never plaintext) | no PIN stored; audit-log event only | 1× |
| Freeze / Block | `POST /cards/{id}/block` | status `BLOCKED`; **synchronous** (security action) | 2× then alert |
| Replace (lost/stolen) | `POST /cards/{id}/replace` | new `processor_card_id`, old → `REPLACED`, re-tokenize | 3× |
| Tokenize (Apple/Google Pay) | `POST /cards/{id}/tokenize` | store `token_reference`, provisioning-pass status | 2× |

**Lifecycle FSM** (enforced in code; illegal transitions throw):
```
ISSUED → ACTIVE → {FROZEN ⇄ ACTIVE} → {BLOCKED|EXPIRED|REPLACED}
                                          (terminal)
```
All outbound issuing calls go through a single `nymcardClient` free-function module with: bearer-auth from AWS Secrets Manager (runtime fetch, never hardcoded), capped exponential backoff, and an idempotency header so a retried issue never double-creates.

### 1.2 Core authorization — JIT / Collaborative Auth (the sub-90 ms hot path)

NymCard calls FlexPay inside Visa's ~90 ms window. We must verify HMAC, evaluate fraud, check the **available** balance against the ledger projection, and return `APPROVE`/`DECLINE`. Budget: p95 < 35 ms, p99 < 50 ms.

```
POST /webhooks/nymcard/authorize        (express.raw — HMAC over exact bytes)
  │
  ├─ 1. verifyHMAC(rawBody, X-NymCard-Signature)  [crypto.timingSafeEqual]   ~0.2ms
  │       fail → 401 (never scored, never logged with PAN)
  ├─ 2. Zod-parse {card_id, amount_minor, mcc, country, device_fp, geo}      ~0.1ms
  ├─ 3. fraud score (in-process LightGBM/heuristic, NO network)   target <12ms
  │       reads Redis velocity sliding-window  card_velocity:{card_id} (60s)
  │       score > 0.82 → {decision: DECLINE, reason: FRAUD_RISK}
  ├─ 4. available balance:  Redis  nymcard_balance:{card_id} (TTL 30s)
  │       miss → read wallets.available_minor (PgBouncer hot sub-pool), warm cache
  │       available < amount → {decision: DECLINE, reason: INSUFFICIENT_FUNDS}
  ├─ 5. place an AUTH HOLD:  publish card.authorized  (async ledger pending entry)
  │       respond IMMEDIATELY with {decision: APPROVE}  — do NOT wait on the ledger write
  └─ Promise.race([pipeline, deadline(50ms)]) → on timeout: DECLINE (fail-safe)
```

**Critical design choice:** at authorization we **respond before** the durable ledger write. The hold is recorded asynchronously off `card.authorized`, and `available_minor` is decremented optimistically in the same Redis read that served the balance (atomic `DECRBY` guarded by the wallet key). The authoritative pending ledger entry is posted by the Ledger Daemon. If the async post fails, the reconciler detects the orphaned hold and the auth auto-expires (NymCard reverses unmatched auths after the issuer hold window).

### 1.3 Settlement & clearing

- **Daily clearing file** (`/transactions/settle` webhook per txn + a batch file): each settled txn maps an earlier hold → settled. Status mapping: `AUTHORIZED → CLEARED → SETTLED` (or `→ REVERSED/EXPIRED`).
- **Interchange split audit:** on settlement, NymCard reports the interchange component. We post it to `Revenue:Interchange` and write an `audit_logs` line (`INTERCHANGE_BOOKED`) with the network, MCC, and gross. This is booked revenue, not the modelled estimate.
- **Fee deduction:** scheme/processor fees post to `Expenses:Card_Scheme_Fees`.
- **Tokenization passes:** provisioning events (`token.activated`, `token.suspended`) update `cards.token_status`; no balance effect.
- **Reconciliation:** the daily clearing file is three-way matched (clearing line ↔ `card_transactions` ↔ `ledger_entries`); drift → `reconciliation.drift` event → cycle/wallet freeze.

---

## 2. FUNDING ARCHITECTURE & TRANSACTION FLOWS

All inbound funding converges on one pipeline:
```
verify HMAC → INSERT incoming_transfers (UNIQUE provider_ref, status=RECEIVED) [idempotent]
  → publish funding.received → [async] resolve IBAN→wallet → AML screen
  → Ledger Daemon: $transaction{ advisory-lock wallet → post double-entry → upsert wallet txn → bump projection } → status=POSTED
  → publish funding.posted → notification + credit-data stream
```
The webhook does the **minimum** (verify + idempotent insert) and returns 200 in <10 ms; posting is async-but-exactly-once via a transactional outbox.

### 2.A Salary via UAE WPS
```
Employer ──SIF file──▶ FlexPay ingestion (parse, 3-tier checksum, anomaly Stages 2-6)
                          │ creates PayrollCycle + PayrollIntent[]  (status INTENTS_READY)
CBUAE/Clearing bank ──credits each worker's virtual IBAN──▶ NymCard/bank inbound webhook
                          ▼
  POST /webhooks/bank/credit  → incoming_transfers{source_type=WPS_SALARY, provider_ref=CBUAE_TRN}
                          ▼ Ledger Daemon (per-cycle, advisory-locked per worker)
   T: DEBIT  Assets:Settlement_Pool         CREDIT Liabilities:Employee_Wallet:{id}
      (if outstanding EWA) DEBIT Liabilities:Employee_Wallet CREDIT Assets:EWA_Receivable  [recovery, FIFO, ≤70% gross, ≥AED300 floor]
                          ▼ publish funding.posted → FCM "salary received" + FlexScore WPS_SALARY_CREDITED
```
Multi-tenant: every entry carries `employer_id` in metadata; cohort ledgers roll up per `employer_id` for the canary/liquidity views. Auto-reconciliation keys on `CBUAE_TRN`.

### 2.B Inbound external bank transfer (local / cross-border)
```
POST /webhooks/bank/credit  → incoming_transfers{source_type=EXTERNAL_BANK, remitter_name, remitter_iban}
  → AML: screen REMITTER (source of funds) + structuring/velocity on the wallet
  → unmatched IBAN → status=UNMATCHED (ops queue; NEVER auto-credit a guess)
  → matched + cleared → ledger: DEBIT Assets:Settlement_Pool CREDIT Liabilities:Employee_Wallet
```
Idempotency: `UNIQUE(provider, provider_ref)`. Cross-border adds a `correspondent_ref` and an FX leg (DEBIT `Expenses:FX_Cost` as needed). Immediate `available_minor` bump only after the bank confirms *settled* (not advised).

### 2.C Debit-card top-up (future, high fraud surface)
```
User initiates → PSP gateway → 3DS/SCA challenge (mandatory) → PSP auth
  → POST /webhooks/psp/topup  → velocity check (per-card, per-device, per-user caps)
  → anti-fraud (stolen-card/cash-out pattern, BIN risk, geo mismatch)
  → ledger: DEBIT Assets:Settlement_Pool CREDIT Liabilities:Employee_Wallet
            BUT credit to PENDING; available_minor unchanged until CLEARING WINDOW elapses
  → on chargeback webhook: REVERSE (DEBIT wallet, CREDIT Settlement_Pool); if wallet drained → Liabilities:Topup_Loss
```
**Hard rule:** card top-up funds are *not instantly spendable* — they land in `pending_minor`, clear to `available_minor` after the configurable hold (absorbs chargeback risk). 3DS is mandatory; sub-threshold instant availability optional only for low-risk, KYC-full users.

### 2.D Employer bulk payouts (bonus / reimbursement)
```
Employer batch (CSV/API) → employer_payroll_batches{type=BONUS|REIMBURSEMENT, total_minor, count}
  → atomic: single $transaction posting N credits OR none (batch is all-or-nothing per the ledger txn group)
  → each line: DEBIT Assets:Settlement_Pool CREDIT Liabilities:Employee_Wallet:{id}, metadata{batch_id}
  → batch status DRAFT→FUNDED→POSTING→COMPLETED|FAILED; reconcile batch total == Σ lines
```
Employer must pre-fund (`Assets:Settlement_Pool` debit requires the employer's funding credit first), preventing fronting bonus money we don't hold.

### 2.E P2P internal transfer (single-phase, no external rail)
```
POST /wallet/transfer  → idempotency-key required
  → $transaction { advisory-lock BOTH wallets in deterministic id order (deadlock-free)
       sender available_minor >= amount + fee ?
       DEBIT Liabilities:Employee_Wallet:{sender}  CREDIT Liabilities:Employee_Wallet:{receiver}
       DEBIT Liabilities:Employee_Wallet:{sender}  CREDIT Revenue:P2P_Fee  (if fee)
       bump both projections }
```
Internal P2P never touches `Settlement_Pool` (no money enters/leaves the platform — it's a liability transfer between two wallet sub-accounts). Lock ordering by ascending `wallet_id` prevents the classic two-lock deadlock.

---

## 3. FINTECH-GRADE DOUBLE-ENTRY LEDGER

### 3.1 Chart of accounts
```
ASSETS (debit-normal)
  Assets:Settlement_Pool          — pooled cash held at partner bank (omnibus)
  Assets:EWA_Receivable           — advances outstanding, owed back at WPS settle
  Assets:Card_Scheme_Receivable   — in-flight card settlement
LIABILITIES (credit-normal)
  Liabilities:Employee_Wallet:{id}— each worker's spendable balance (sub-account)
  Liabilities:Pending_Holds:{id}  — authorized-not-settled card holds
  Liabilities:Unapplied_Funds     — received but unmatched inbound credits
REVENUE (credit-normal)
  Revenue:Interchange  Revenue:EWA_Fee  Revenue:P2P_Fee  Revenue:Remittance_Margin
EXPENSES (debit-normal)
  Expenses:Card_Scheme_Fees  Expenses:FX_Cost  Expenses:Topup_Loss  Expenses:Provision_Uncollectible
```
**Invariant per transaction group:** `Σ debits == Σ credits` (enforced in code before commit; a non-balancing group throws `LEDGER_IMBALANCE` and rolls back).

### 3.2 Pending vs settled
- `available_minor` = settled wallet balance − pending holds. Spending checks read **available**.
- `pending_minor` = sum of `Liabilities:Pending_Holds` (card auths, clearing-window top-ups).
- Authorization creates a hold (moves available→pending, no settled change). Settlement converts the hold to a settled debit. Expiry/reversal releases the hold back to available.

### 3.3 State transitions
```
AUTH:     available −X, pending +X                (hold created)
SETTLE:   pending −X, settled −X                  (hold → real debit)
EXPIRE:   pending −X, available +X                (hold released, no settle)
REVERSAL: settled +X, (post-settle refund)        (new offsetting group)
PARTIAL:  settle Y<X → settle −Y, release (X−Y) hold
FAIL:     no-op (group never written; failed auth writes only an audit row)
```
Reversals and refunds are **never** mutations of the original group — they are *new* balancing groups referencing the original (immutability). Daily multilateral reconciliation: per account, `Σ ledger == external statement`; per wallet, `projection == Σ(credits−debits)`; drift > 1 fil → freeze + `reconciliation.drift`.

### 3.4 T-account examples (amounts in fils; AED 100.00 = 10000)

**(1) Salary deposit — AED 3,000 gross, AED 500 EWA outstanding, AED 10 fee already in advance**
```
DEBIT  Assets:Settlement_Pool              300000
  CREDIT Liabilities:Employee_Wallet:W1      300000
-- EWA recovery (FIFO, within 70% cap, ≥AED300 floor preserved → recover 500)
DEBIT  Liabilities:Employee_Wallet:W1       50000
  CREDIT Assets:EWA_Receivable               50000
-- net spendable to worker = 250000 (AED 2,500)
```

**(2a) Card purchase — AUTHORIZATION AED 120**
```
DEBIT  Liabilities:Employee_Wallet:W1       12000   (available −120)
  CREDIT Liabilities:Pending_Holds:W1        12000   (pending +120)
```
**(2b) Card purchase — SETTLEMENT AED 120 (interchange AED 1.30 revenue)**
```
DEBIT  Liabilities:Pending_Holds:W1         12000   (release hold)
  CREDIT Assets:Settlement_Pool              12000   (cash leaves pool to scheme)
DEBIT  Assets:Settlement_Pool                 130    (interchange inbound)
  CREDIT Revenue:Interchange                    130
```

**(3) ATM withdrawal — AED 200 + AED 5 network fee**
```
DEBIT  Liabilities:Employee_Wallet:W1       20500
  CREDIT Assets:Settlement_Pool              20000   (cash dispensed)
  CREDIT Revenue:Interchange OR Expenses     ...     (fee handling per scheme)
DEBIT  Expenses:Card_Scheme_Fees              500    (network fee cost, if borne)
  CREDIT Assets:Settlement_Pool                500
```

**(4) Refund — merchant reverses AED 120**
```
DEBIT  Assets:Settlement_Pool               12000
  CREDIT Liabilities:Employee_Wallet:W1      12000   (available +120)
```

**(5) Transfer reversal — failed inbound routing (credit clawed back)**
```
DEBIT  Liabilities:Employee_Wallet:W1       <amt>
  CREDIT Assets:Settlement_Pool             <amt>
-- if already spent: shortfall → Expenses:Topup_Loss, wallet may go to a tracked negative-clamped state
```

**(6) Failed authorization (insufficient funds / risk)** — **no ledger group**; write only:
```
audit_logs: { action: AUTH_DECLINED, reason: INSUFFICIENT_FUNDS|FRAUD_RISK, card_id, amount_minor }
```

---

## 4. PRODUCTION DATABASE SCHEMA (PostgreSQL)

```sql
-- USERS (regulatory metadata; PII encrypted/hashed at rest)
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash         TEXT NOT NULL UNIQUE,             -- SHA-256(phone)
  emirates_id_hash   TEXT UNIQUE,                      -- SHA-256(EID), equality only
  full_name_enc      TEXT,                             -- AES-256-GCM envelope
  salary_enc         TEXT,                             -- AES-256-GCM envelope
  nationality        CHAR(3),                          -- ISO-3166 alpha-3
  kyb_employer_id    UUID REFERENCES employers(id),
  kyc_status         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|VERIFIED|REJECTED|EXPIRED
  status             TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,        -- 'Liabilities:Employee_Wallet:{wallet}' | 'Assets:Settlement_Pool'
  kind          TEXT NOT NULL,               -- ASSET|LIABILITY|REVENUE|EXPENSE
  normal_side   TEXT NOT NULL CHECK (normal_side IN ('DEBIT','CREDIT')),
  owner_wallet  UUID,                        -- nullable; set for per-wallet sub-accounts
  currency      CHAR(3) NOT NULL DEFAULT 'AED',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  currency        CHAR(3) NOT NULL DEFAULT 'AED',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

-- balances segregated; projection of the ledger, reconciled continuously
CREATE TABLE wallet_balances (
  wallet_id       UUID PRIMARY KEY REFERENCES wallets(id),
  settled_minor   BIGINT NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),
  pending_minor   BIGINT NOT NULL DEFAULT 0 CHECK (pending_minor >= 0),
  blocked_minor   BIGINT NOT NULL DEFAULT 0 CHECK (blocked_minor >= 0),
  available_minor BIGINT GENERATED ALWAYS AS (settled_minor - pending_minor - blocked_minor) STORED,
  version         BIGINT NOT NULL DEFAULT 0,    -- optimistic-lock guard
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE virtual_ibans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES wallets(id),
  iban          TEXT NOT NULL UNIQUE,            -- the routing key
  bank_routing  TEXT NOT NULL,                   -- CBUAE/partner routing code
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX virtual_ibans_iban_idx ON virtual_ibans (iban);

CREATE TABLE cards (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id          UUID NOT NULL REFERENCES wallets(id),
  processor_card_id  TEXT NOT NULL UNIQUE,        -- NymCard token ref; NO PAN
  type               TEXT NOT NULL,               -- VIRTUAL|PHYSICAL
  last4              CHAR(4) NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ISSUED',
  token_status       TEXT,                        -- apple/google provisioning
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cards_processor_idx ON cards (processor_card_id);

CREATE TABLE incoming_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,
  provider_ref    TEXT NOT NULL,                  -- CBUAE TRN / e2e id
  credited_iban   TEXT,
  remitter_name   TEXT, remitter_iban TEXT,
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        CHAR(3) NOT NULL DEFAULT 'AED',
  source_type     TEXT NOT NULL,                  -- WPS_SALARY|EXTERNAL_BANK|EMPLOYER_BONUS|CARD_TOPUP|P2P
  status          TEXT NOT NULL DEFAULT 'RECEIVED',
  wallet_id       UUID REFERENCES wallets(id),
  ledger_group_id UUID,
  raw_payload     JSONB NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at       TIMESTAMPTZ,
  UNIQUE (provider, provider_ref)
);

CREATE TABLE card_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         UUID NOT NULL REFERENCES cards(id),
  processor_txn_id TEXT NOT NULL,
  phase           TEXT NOT NULL,                  -- AUTHORIZED|CLEARED|SETTLED|REVERSED|EXPIRED
  amount_minor    BIGINT NOT NULL,
  mcc             TEXT, merchant_country CHAR(2),
  interchange_minor BIGINT,
  ledger_group_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (processor_txn_id, phase)                -- one row per phase, idempotent
);

-- LEDGER: append-only, partitioned by month. No UPDATE/DELETE grant.
CREATE TABLE ledger_entries (
  id               BIGINT GENERATED ALWAYS AS IDENTITY,
  group_id         UUID NOT NULL,                 -- the balanced transaction group
  account_id       UUID NOT NULL REFERENCES ledger_accounts(id),
  direction        TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_minor     BIGINT NOT NULL CHECK (amount_minor > 0),
  currency         CHAR(3) NOT NULL DEFAULT 'AED',
  entry_type       TEXT NOT NULL,
  reference_id     TEXT,
  idempotency_key  TEXT NOT NULL,
  integrity_hash   CHAR(64) NOT NULL,             -- keyed HMAC over canonical tuple
  created_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE UNIQUE INDEX ledger_idem_idx ON ledger_entries (idempotency_key, created_at);
CREATE INDEX ledger_account_time_idx ON ledger_entries (account_id, created_at DESC);
CREATE INDEX ledger_group_idx ON ledger_entries (group_id);
-- monthly partitions, e.g.:
CREATE TABLE ledger_entries_2026_06 PARTITION OF ledger_entries
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  provider_ref  TEXT NOT NULL,
  signature_ok  BOOLEAN NOT NULL,
  status        TEXT NOT NULL DEFAULT 'RECEIVED', -- RECEIVED|PROCESSED|DLQ
  attempts      INT NOT NULL DEFAULT 0,
  raw_payload   JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref, event_type)
);

CREATE TABLE transaction_events (   -- domain event audit (outbox mirror)
  id           BIGINT GENERATED ALWAYS AS IDENTITY,
  topic        TEXT NOT NULL, key TEXT NOT NULL,
  payload      JSONB NOT NULL,
  published    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE employer_payroll_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id  UUID NOT NULL, type TEXT NOT NULL,
  total_minor  BIGINT NOT NULL, line_count INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'DRAFT',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        TEXT NOT NULL,                     -- LEDGER_BALANCE|BANK_STATEMENT|CARD_CLEARING
  window_start TIMESTAMPTZ NOT NULL, window_end TIMESTAMPTZ NOT NULL,
  drift_minor  BIGINT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'RUNNING',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (            -- immutable forensic trail
  id           BIGINT GENERATED ALWAYS AS IDENTITY,
  actor_type   TEXT NOT NULL, actor_id TEXT,
  action       TEXT NOT NULL, resource_type TEXT, resource_id TEXT,
  metadata     JSONB, ip INET, created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

### 4.1 Indexing matrix & scale notes
| Query | Index |
|---|---|
| IBAN → wallet (every inbound credit) | `virtual_ibans(iban)` UNIQUE |
| card → wallet (every auth) | `cards(processor_card_id)` UNIQUE |
| balance projection check (auth/spend) | `wallet_balances` PK (`wallet_id`) |
| per-account ledger scan (recon, statements) | `ledger_entries(account_id, created_at DESC)` |
| duplicate-webhook dedupe | `webhook_events(provider, provider_ref, event_type)` UNIQUE; `ledger_entries(idempotency_key)` UNIQUE |
| group fetch (reversal lookup) | `ledger_entries(group_id)` |

- **Partitioning:** `ledger_entries`, `transaction_events`, `audit_logs` by month (range on `created_at`). Old partitions detach → cold storage; recon queries hit only the live partition.
- **PgBouncer:** all locks are `pg_advisory_xact_lock` (transaction-scoped) → **transaction-mode safe**. Set `pgbouncer=true` (disables prepared statements). Two pools: hot (auth/funding, short txns) and analytics (recon/ops-intel — or a **read replica**) so a heavy aggregate never starves the auth pool.
- **Hot-row contention:** `wallet_balances` row under concurrent credits is serialized by the per-wallet advisory lock + `version` optimistic guard; at extreme scale, switch to append-only ledger with async projection.

---

## 5. WEBHOOK INFRASTRUCTURE & FAULT TOLERANCE

```ts
// free-function ingestion core — every provider webhook routes through this
export async function ingestWebhook(args: {
  provider: string; rawBody: Buffer; signature: string | undefined;
  verify: (b: Buffer, s: string | undefined) => boolean;        // provider HMAC
  extractRef: (p: unknown) => { ref: string; eventType: string };
  publishTopic: string;
}): Promise<{ status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' }> {
  if (!args.verify(args.rawBody, args.signature)) return { status: 'REJECTED' }; // 401
  let payload: unknown;
  try { payload = JSON.parse(args.rawBody.toString('utf8')); }
  catch { return { status: 'REJECTED' }; }                                       // 400
  const { ref, eventType } = args.extractRef(payload);

  // Layer 1 — Redis pre-flight (fast dedupe, 24h TTL)
  const seen = await redis.set(`wh:${args.provider}:${ref}:${eventType}`, '1', 'NX', 'EX', 86400);
  if (seen === null) return { status: 'DUPLICATE' };                             // 200 no-op

  // Layer 2 — durable UNIQUE gate + outbox publish in ONE tx
  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({ data: { provider: args.provider, providerRef: ref,
        eventType, signatureOk: true, rawPayload: payload as Prisma.InputJsonValue } });
      await tx.transactionEvent.create({ data: { topic: args.publishTopic, key: ref,
        payload: payload as Prisma.InputJsonValue, createdAt: new Date() } });   // outbox
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { status: 'DUPLICATE' };                    // 200 no-op
    throw e;
  }
  return { status: 'ACCEPTED' };                                                 // 200
}
```
- **HMAC:** `crypto.timingSafeEqual` over equal-length hex buffers; production with absent secret = hard 401.
- **Idempotency:** dual-layer (Redis `SET NX` pre-flight + SQL `UNIQUE`) — replay storms collapse to no-ops.
- **Outbox → bus:** a relay worker polls `transaction_events WHERE published=false`, publishes to Kafka, marks published — **exactly-once** delivery decoupled from the webhook 200.
- **Resilience:** consumer failures → retry with exp backoff (1s→2s→4s→8s, max 5) → **DLQ topic** `dlq.<topic>`. A **replay worker** drains the DLQ, re-resolves out-of-order events (e.g. settlement arriving before auth) against the ledger, and either posts or escalates to ops.
- **Out-of-order handling:** `card_transactions` keyed `(processor_txn_id, phase)` — a settlement for an unseen auth creates the auth-phase row lazily, so ordering is irrelevant.

---

## 6. SECURITY, COMPLIANCE & RISK (CBUAE / FATF)

### 6.1 KYC/AML pipeline
```
onboarding → EID OCR + Luhn(784-…) structural check → liveness/selfie
  → sanctions/PEP screen (UN/OFAC/UAE/EU/UK) at KYC + nightly rescreen of all ACTIVE users
  → on inbound funding: screen the REMITTER (source of funds) + structuring/velocity
  → real-time velocity gate inside auth + transfer paths (Redis sliding windows)
```

### 6.2 Silent AML flagging — "Anti-Tipping-Off"
A confirmed sanctions/AML hit must **never** reveal itself to the subject (UAE/FATF tipping-off offence).
```ts
// the boundary throws a GENERIC, transient-looking error for sensitive types
function complianceBlock(incident: { id: string; type: IncidentType; severity: number }) {
  openComplianceIncident(incident);                 // internal STR/SAR queue
  audit('STR_FILED', { ref: incident.id, type: incident.type });   // server-side truth
  if (SENSITIVE.has(incident.type)) {               // SANCTIONS_HIT|PEP_HIT|AML_PATTERN
    throw new AppError(503, 'SERVICE_UNAVAILABLE',  // looks like an outage on the wire
      'This action is temporarily unavailable. Please try again later.', { ref: incident.id });
  }
  throw new AppError(451, 'COMPLIANCE_BLOCK', /* informative for KYC etc. */);
}
```
The subject sees a generic 503 indistinguishable from a transient failure; the STR is filed internally; classification (`type`, `severity`) is logged server-side, never serialized to the client.

### 6.3 Infrastructure defense
- **PCI-DSS scope separation:** PAN never enters FlexPay — NymCard tokenizes; we store only `processor_card_id` + `last4`. FlexPay is SAQ-D merchant scope, not a card processor.
- **RBAC:** `worker` / `employer_admin` / `mlro` / `engineering` scoped permissions; ledger write authority restricted to the Ledger Daemon's role; `REVOKE UPDATE,DELETE ON ledger_entries`.
- **Encryption:** AES-256-GCM (app-layer envelope) for names/salary; SHA-256 hash for EID/phone (equality only); DEK unwrapped from **AWS KMS at boot** (fail-fast crash if it can't bind), held in memory, never on the hot path.
- **Secrets:** AWS Secrets Manager, runtime fetch, no hardcoded keys; HMAC webhook secrets rotated per provider.

### 6.4 GCC-specific operational risks
| Risk | Mitigation in architecture |
|---|---|
| **Salary flight** (worker leaves UAE mid-cycle, owes EWA) | I1 (advance ≤ accrued) caps exposure to earned wages only — never lend beyond accrued |
| **High-turnover blue-collar cohorts** | HR-lag buffer (structural haircut) + cohort canary (1.5% uncollectible → 20% cap) |
| **Off-cycle sudden terminations** | HR-webhook `employee.terminated` → immediate EWA suspension + the HR-lag buffer absorbs sync latency |
| **Chargeback-after-drain (top-up)** | clearing-window hold on card top-ups; funds spendable only after settlement |
| **Weekend/holiday WPS delay → float squeeze** | settlement-calendar-aware liquidity forecaster + global liquidity ceiling on advances |

---

## 7. CREDIT ENGINE & DATA PIPELINES (day-zero capture)

**Capture from day zero** (immutable, replayable) — the ledger *is* the feature store:
- Per inbound: `source_type`, employer-sourced vs other, amount, cadence, day-of-month, remitter identity.
- Per outbound: MCC, essential vs discretionary, ATM cash-out events, P2P graph, bill-payment recurrence.
- Per advance: request→settle timing, on-time recovery rate, partial repayment.
- Per session: login cadence, device/geo, attendance feed (A_i).

**Streaming pipeline:**
```
ledger.posted / card.settled / funding.posted  →  Kafka  →  feature-extractor consumer
  → feature_store (point-in-time correct, versioned)  →  nightly Airflow retrain (XGBoost + Cox)
  → FlexScoreEngine.recalculate(workerId, trigger)  →  Redis flexscore:{worker} (300s)
```
**Behavioral signals that matter** (the 37-feature contract): salary stability index (WPS amount/cadence variance), disposable-income depletion velocity (days-to-zero after salary), immediate cash-out ratio (ATM/transfer within 24h of credit), recurring-utility-payment consistency, EWA on-time-repayment rate, essential-spend ratio, merchant diversity, attendance reliability index A_i, employer payroll-health score. Composite first feature: `S_base × P_t × A_i × V_w`. EWA limit = `MIN(model_raw, S_base × P_t × 0.50)`, AED-300 floor, cohort-failsafe-capped.

---

## 8. HIGH-AVAILABILITY MICROSERVICES

```
┌─ Webhook Ingestion Engine ──────────────────────────────────────────┐
│ stateless, horizontally scaled behind ALB. verify+idempotent-insert  │
│ +outbox. p99 < 10ms. No business logic. → publishes to Kafka.        │
└──────────────────────────────────────────────────────────────────────┘
┌─ Core Ledger Daemon ────────────────────────────────────────────────┐
│ consumes funding.* / card.* . The ONLY writer to ledger_entries.     │
│ per-wallet pg_advisory_xact_lock; balances-as-projection; enforces   │
│ Σdebits==Σcredits + integrity HMAC. Partitioned consumers keyed by   │
│ wallet_id hash (ordered per wallet, parallel across wallets).         │
└──────────────────────────────────────────────────────────────────────┘
┌─ JIT Auth Hot Path ─────────────────────────────────────────────────┐
│ dedicated pool + Redis balance/velocity cache. <50ms p99. fail-safe  │
│ DECLINE on budget breach. Emits card.authorized (async hold post).   │
└──────────────────────────────────────────────────────────────────────┘
┌─ Anti-Fraud & Compliance Boundary Guard ────────────────────────────┐
│ in-process scorer for auth; consumer for funding AML; sanctions/PEP   │
│ rescreen cron; silent-flag → STR + generic 503.                      │
└──────────────────────────────────────────────────────────────────────┘
┌─ Reconciliation Cron Workers ───────────────────────────────────────┐
│ 14:00/22:00 (WPS windows) + hourly canary sweep + daily clearing     │
│ 3-way match. drift>1fil → freeze + reconciliation.drift event.       │
└──────────────────────────────────────────────────────────────────────┘
┌─ Ops-Intel / Liquidity Forecaster ──────────────────────────────────┐
│ read-replica only. 7/15/30-day runway, cohort default ratios, canary │
│ detection → trips per-cohort failsafe. B2B payroll-health scoring.   │
└──────────────────────────────────────────────────────────────────────┘
```
**Deployment:** AWS ap-southeast-3 (UAE, PDPL), private subnets, RDS Multi-AZ, ElastiCache cluster, MSK (Kafka) or SQS+SNS, ECS Fargate per service, Terraform IaC, no public endpoints (API Gateway → Lambda authorizer → private ALB).

**Consistency model:** the Ledger Daemon is the single writer (serialized per wallet via advisory lock, parallel across wallets via partitioned Kafka consumers keyed on `wallet_id`) — giving strict per-wallet ordering without a global single-threaded bottleneck.
