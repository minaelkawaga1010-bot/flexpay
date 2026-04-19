# FlexPay Platform — Requirements Analysis

**Owner:** Product / Engineering
**Audience:** Founders, investors, lead engineers, compliance
**Version:** 1.0 (synthesized from design-phase transcripts)

---

## 1. Executive Summary

FlexPay is a UAE-licensed fintech super-wallet targeted at migrant and blue-collar workers. It bundles six normally-separate products into one app:

1. **Multi-currency wallet** (AED, USD, INR, PHP, PKR, BDT, EGP)
2. **Earned Wage Access (EWA)** — workers draw accrued salary before payday
3. **Cross-border remittance** — corridors to India, Philippines, Pakistan, Bangladesh, Egypt
4. **Alternative-data credit scoring & micro-loans**
5. **Hafiza** — digital rotating savings circles (ROSCA / jameya)
6. **Voice-first UX** — Arabic/English/Hindi/Urdu/Tagalog for low-literacy users

The wedge is that competitors (NOW Money, Rise, Edenred C3) each address 1–2 of these. FlexPay unifies them on one KYC, one ledger, one loyalty graph.

## 2. Target Users & Regulatory Frame

| Segment | Size (UAE) | Pain Point | FlexPay Solution |
|---|---|---|---|
| Blue-collar migrants | ~3.5M | No credit history, expensive remittance, cash-heavy | EWA + alt-credit + low-cost corridors |
| SME employers | ~500K | WPS compliance, payroll ops | Salary disbursement + bulk KYC |
| Domestic workers | ~750K | Paid cash, no savings tools | Hafiza + voice UX |

**Primary regulator:** Central Bank of the UAE (CBUAE), under the Stored Value Facilities (SVF) regime. Secondary: UAE PDPL (data), VARA (if any crypto rails).

## 3. Technical Architecture (final stack)

```
┌──────────────────────────────────────────────────────────────┐
│  Flutter mobile (iOS/Android) + React web admin & employer   │
└───────────────┬──────────────────────┬───────────────────────┘
                │ REST + WebSocket     │
┌───────────────▼──────────────────────▼───────────────────────┐
│  FastAPI gateway (Python 3.11)  — auth, rate limit, audit    │
├──────────────────────────────────────────────────────────────┤
│  Domain services:                                            │
│  wallet · ledger · remittance · credit · EWA · hafiza ·      │
│  voice · notifications · compliance                          │
├──────────────────────────────────────────────────────────────┤
│  PostgreSQL 15 (source of truth) · Redis 7 (cache/queues) ·  │
│  ClickHouse (analytics) · S3 (documents, KYC artefacts)      │
├──────────────────────────────────────────────────────────────┤
│  n8n workflow engine (12 flows) · H2O AutoML · OpenAI GPT-4  │
├──────────────────────────────────────────────────────────────┤
│  AWS me-central-1 (UAE) — EKS · RDS · ElastiCache · KMS      │
└──────────────────────────────────────────────────────────────┘
```

**Residency:** all PII and transaction data stay inside `me-central-1`. Backups encrypted with customer-managed KMS keys, replicated only within region.

## 4. Core Domain Model (canonical)

| Entity | Key fields | Notes |
|---|---|---|
| `User` | id, phone, emiratesId (encrypted), kycTier, locale | Tier 0/1/2/3 per CBUAE |
| `Wallet` | id, userId, status | One per user |
| `Balance` | walletId, currency, amount (decimal(20,4)) | Per-currency sub-ledger |
| `Transaction` | id, walletId, type, amount, currency, fxRate, status, externalRef | Double-entry; immutable once settled |
| `CreditProfile` | userId, score (300–850), tier, limit | H2O AutoML + rules fallback |
| `Loan` | id, userId, principal, apr, schedule, status | EWA + micro-credit |
| `Beneficiary` | id, userId, corridor, maskedAccount | Remittance recipients |
| `HafizaCircle` | id, size, contribution, rotation | Social savings |
| `AMLAlert` | userId, rule, severity, status | Structuring / velocity / rapid movement |
| `AuditLog` | actor, action, entity, diff, ts | Append-only, 7yr retention |

## 5. Feature Requirements — Must-Have for Launch

### 5.1 Onboarding & KYC
- Phone OTP (Twilio) → Emirates ID OCR (Sumsub) → liveness (Shufti Pro fallback) → passive risk scoring.
- Tiered KYC limits: Tier 1 (AED 5K/mo), Tier 2 (AED 25K/mo), Tier 3 (AED 100K/mo + remittance).
- Arabic + English RTL UI; voice prompts for illiterate users.

### 5.2 Wallet & Cards
- NymCard virtual card on KYC completion; physical card on Tier 2.
- Apple/Google Pay tokenization.
- P2P transfers (FlexPay-to-FlexPay), QR merchant pay.

### 5.3 EWA
- Employer onboards via dashboard → uploads payroll CSV.
- Worker sees accrued balance daily; can draw up to 50% with flat fee (AED 5–15).
- Settlement from employer on payday.

### 5.4 Remittance
- Wise + Ripple aggregation; best-rate routing.
- 5 corridors live at launch; target FX margin ≤ 0.5%.
- Compliance screening (sanctions, PEP) before release.

### 5.5 Credit & Micro-loans
- Alt-data features: wallet velocity, remittance consistency, employer tenure, utility-bill regularity.
- H2O AutoML model served behind a rules-based kill-switch.
- Loan amounts AED 500–10,000; tenors 1–12 mo.

### 5.6 Hafiza (social savings)
- 5–20 person circles, monthly contribution, random or bid-based rotation.
- Smart-contract-style enforcement via internal ledger (no chain required).
- Default protection fund 2% of pool.

### 5.7 Voice AI
- Whisper for STT → GPT-4 intent classifier → deterministic command router.
- Supported intents: balance, send, remit, loan-status, pay-bill.
- All voice data encrypted in transit; transcripts purged after 30 days unless flagged.

## 6. Non-Functional Requirements

| Category | Target |
|---|---|
| Availability | 99.9% monthly (core wallet 99.95%) |
| P95 API latency | < 400 ms |
| RTO / RPO | 1 hour / 15 minutes |
| Throughput | 500 TPS sustained, 2,000 TPS peak |
| Security | SOC 2 Type I within 12 mo; PCI-DSS SAQ-D via NymCard |
| Localization | AR, EN, HI, UR, TL, BN |

## 7. Compliance Posture

- **CBUAE SVF**: capital ring-fencing, customer funds in trust account at licensed UAE bank.
- **AML**: three always-on rules (structuring, velocity, rapid-in-rapid-out) + offline analyst queue; STR filing within 3 business days.
- **PDPL**: explicit consent, data-subject access API, breach notification ≤ 72 h.
- **PCI-DSS**: tokenization only — no PAN storage.

## 8. Integration Surface

| Category | Vendor | Purpose |
|---|---|---|
| Card issuing | NymCard | Virtual + physical cards |
| KYC | Sumsub (primary), Shufti Pro (fallback) | ID, liveness, AML screening |
| Remittance | Wise, Ripple | Corridor payouts |
| SMS / OTP | Twilio | 2FA, alerts |
| Push | OneSignal + FCM | Transactional + marketing |
| Speech | OpenAI Whisper, Google STT | Voice UX |
| Automation | n8n (self-hosted) | 12 workflows (onboarding, AML, collections, etc.) |
| Observability | Sentry, Prometheus, Grafana, PagerDuty | Errors, metrics, incident |

## 9. Risks & Open Items

1. **Regulatory timeline** — CBUAE sandbox entry ≥ 3 mo; production SVF license ≥ 9 mo. Launch plan assumes staged rollout within sandbox.
2. **NymCard dependency** — single point of failure for card issuing; no hot fallback identified.
3. **Credit model fairness** — alt-data features risk proxy discrimination; fairness audit required before lending go-live.
4. **Hafiza legal status** — ROSCA mechanics need explicit CBUAE no-objection.
5. **Voice privacy** — retention policy must be reviewed against PDPL before enabling background capture.

## 10. Launch Readiness Snapshot

| Area | Status |
|---|---|
| Backend services | Coded, unit + contract tests green |
| Mobile (Flutter) | Golden-path flows complete; edge cases pending |
| Infra (Terraform) | me-central-1 plan applies clean in staging |
| Compliance docs | CBUAE sandbox mapping drafted |
| Security review | Internal threat model done; external pentest **not yet scheduled** |
| Beta cohort | First 100 users identified via 3 employer partners |

**Go/No-go gate:** external pentest + CBUAE sandbox admission.
