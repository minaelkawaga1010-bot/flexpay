# FlexPay — USD 2M Seed Round

> **Pitch deck outline · Nova Star Management Services FZE · 2026**
>
> Every number in this deck is sourced from a line in `STRATEGY.md` or
> `FINANCIAL_MODEL.md`. Tag conventions match the financial model:
> **[A]** assumption-locked target · **[E]** externally derivable
> evidence · **[H]** hypothesis pending production data.

---

## Slide 1 — The Vision

**AI-first Wage Protection & Remittance infrastructure for the GCC, built under Nova Star Management Services FZE.**

We are not building "another EWA app." We are building the **programmatic intercept layer between the corporate WPS file and the worker's wallet** — a regulator-aligned, AI-underwritten, atomically-settled rail.

The thesis in one sentence:

> *Every UAE WPS payroll file flows employer → bank → worker as a write-only batch. We turn that batch into an addressable event stream, and the dataset that emerges is the moat.*

**Brand structure**: FlexPay (fintech) and Nova Star Luxury (cosmetics & apparel e-commerce) operate as **uncorrelated revenue lanes under a single AI R&D investment**. PDPL-isolated data planes, shared model ops. This is venture-grade capital efficiency at the holding level — not just at the product level.

**Phase-1 today**: UAE-only, architecturally GCC-ready. KSA Mudad/SAFI ingestion is an interface implementation, not a rewrite.

**[Source: STRATEGY §1.1, §1.3]**

---

## Slide 2 — The Problem

**The blue-collar liquidity gap is structural — and every existing fix actively makes it worse.**

Four converging pain points:

1. **WPS is write-only.** UAE WPS (MT940 / SIF / CSV) flows employer → bank → worker as a one-way batch. There is no programmatic intercept layer. No third party can act on the file before bank disbursement. **[STRATEGY §2.1.1]**

2. **~60% of UAE blue-collar workers run out of cash by day 20** of the month. Today's emergency-cash channels are: informal cheque-discounting at **30–70% effective APR** (haram + grey-market legal risk), employer-side manual advances (consume 10–15% of HR-ops time, often denied, never auditable), or family-side remittance reversals. **[STRATEGY §2.1.2]**

3. **Bureau-based credit fails the segment.** Al Etihad Credit Bureau has thin or empty files on **70%+ of expatriate blue-collar workers**. Traditional banks won't underwrite under AED 8,000/month income. **[STRATEGY §2.1.3]**

4. **Legacy fintech is structurally negative on the unit.** This is the slide that wakes a partner up:

| Operator | Revenue / worker / yr | Cost / worker / yr | **Net** | Why |
|---|---:|---:|---:|---|
| **Edenred MENA** (C3 Pay class) | AED 180 [E] | AED 205 | **−25** | Manual reconciliation labour AED 60/worker/yr |
| **NOW Money** | AED 110 [E] | AED 163 | **−53** | Direct-sales CAC AED 200+ / worker |
| **Tabby** (BNPL adjacent) | AED 290 [E] | AED 370 | **−80** | Default reserve AED 180/worker/yr at ~5% effective default × AED 3,600 BNPL exposure |

Tabby and NOW Money are **venture-financed losses on the unit**. Edenred's MENA card is a loss-leader subsidised by their European voucher business. **None of them have a path to operating-cash positive on the worker.** **[FINANCIAL_MODEL §3.4]**

---

## Slide 3 — The Solution

**FlexPay is programmatic WPS-intercept with atomic settlement. Wage routing, not credit.**

**How it actually works** (the engineering, not the marketing):

1. **HR-tech feed** (Bayzat / ZenHR / Darwinbox) streams attendance → we materialise a per-worker `PayrollIntent` row with `accruedAmount` updated daily.
2. **Worker requests an advance** in the mobile app. Backend runs DCSE → returns a per-user limit. The advance is reserved inside a Prisma `$transaction` that enforces five invariants (see Slide 4).
3. **Corporate WPS file arrives.** We ingest, match each line to its intent, settle every reserved advance atomically, and emit the residual to the worker's wallet via the bin-sponsor's payroll rail.
4. **Reconciliation worker** runs **twice daily at 14:00 + 22:00 Asia/Dubai** — bracketing CBUAE SIF settlement windows. Any drift > 0.01 AED flips the cycle to FAILED and audit-logs the diff.

The frame that matters to regulators and capital markets: **the worker never owes us anything they have not already earned**. The product is a routing primitive, not a loan. That framing is **encoded in code, not just policy** (Invariant I1, next slide).

**Mobile UX**: Four-factor auth on every transactional surface — JWT × Keychain-bound device fingerprint × ≤55s biometric attestation × purpose-partitioned single-use OTP. **HTTP 451** ComplianceBlockError surfaces compliance freezes to the UI as a distinct error class — no silent failures, no error-soup. **[STRATEGY §3, §15.4]**

---

## Slide 4 — The Core Moat

**Default is not "minimised" — it is architecturally prevented.**

### Five invariants live in production code (`src/modules/payroll-routing/invariants.ts`):

| # | Invariant | What it prevents |
|---|---|---|
| **I1** | `advance.amount ≤ intent.accruedAmount` | The worker can never owe more than they have already earned. This is what makes us not a lender. |
| **I2** | `advance.cycleId === intent.cycleId` | Cross-cycle settlement is impossible. No balance-sheet risk carries over. |
| **I3** | `Σ ledgerEntry.delta per (employee, cycle) === 0` | Every cycle nets to zero in the ledger. Any drift is detected within 8 hours by the recon worker. |
| **I4** | `advance.currency === intent.currency` | No FX risk leaks from remittance into the routing plane. |
| **I5** | Advance state-machine: `REQUESTED → APPROVED → RESERVED → SETTLED` (no back-transitions) | The FSM cannot be coerced into an inconsistent state by a malformed retry or partial failure. |

**These are property-tested in CI with fast-check.** They cannot regress without breaking the build. **[STRATEGY §1.4, payroll-routing.invariants.test.ts]**

### Three additional moat layers

| Layer | Mechanism | Replication barrier |
|---|---|---|
| **Regulatory** | Bin-sponsor + WPS-file routing access; payroll-side primary escrow | **12–24 month** CBUAE / bin-sponsor onboarding cycle |
| **Distribution** | HR-tech embedded integrations — Bayzat, ZenHR, Darwinbox, Zenefits MENA, Edenred WPS | HR vendors **do not multi-integrate cheaply**. Pre-signed contracts are high-friction-to-switch. CAC lives in the partner's funnel, not ours. |
| **Data** | Proprietary blue-collar spend-vector corpus — frequency, micro-merchant utilisation, remittance cadence, cash-out timing | **Cold-start impossible** without payroll-routed wallets at scale. The DCSE compounds: every advance event refines limits → expands dataset → improves the next decision. |

A competitor with capital and engineering talent replicates the **surface UX** in 6 months. They cannot replicate **regulatory routing + the dataset + the HR-tech distribution graph in under 24 months.** That window is the entire venture thesis. **[STRATEGY §1.4]**

### Operational failsafes (live in production)

- **DCSE Canary Rollback**: cohort-level default rate `≥ 1.5%` strips autonomous limit-raising privileges. The constant is in `src/modules/ops-intel/metrics.service.ts` and gated at the `GET /admin/reports/metrics` endpoint. Boundary-tested. **[STRATEGY §F, FINANCIAL_MODEL §6.1]**
- **Compliance plane**: Emirates ID extraction with Luhn checksum; UN/OFAC/UAE/EU/UK sanctions screening (KYC-time synchronous + nightly 03:00 Asia/Dubai rescreen); open-incident gate inside the `reserveAdvance` transaction. HTTP 451 ComplianceBlockError on hit.
- **15-minute fraud sweep**: per-worker velocity spikes (≥ 4× 30-day baseline) + per-company attendance-drop anomalies (≥ 35% drop vs 7-day mean).

---

## Slide 5 — Market Opportunity & TAM

**UAE is the wedge; GCC is the prize.**

### Phase 1 — UAE SAM

- **~3.2M expatriate workers on WPS** in salary bands AED 1,500–8,000/month
- **~85%** have no bureau-scored credit history
- **Monthly payroll volume on UAE WPS-eligible workers: AED 18B+ / month**
- Single-digit basis-point capture is venture-grade. We target **AED 25–30M GMV/month at M24**, which is **<2 bps** of the addressable wallet GMV.

### Phase 2 — GCC expansion (architected from day 1)

**KSA's Mudad/SAFI system has the same architectural shape as UAE WPS.** The WPS-file ingestion is built behind a polymorphic `PayrollFileSource` interface with at least UAE-MT940 + UAE-SIF + KSA-Mudad implementations — **GCC expansion is an interface implementation, not a rewrite**.

Per-region data plane: UAE in `me-south-1` / e&; KSA on NCA-compliant Saudi local cloud. Bin-sponsorship per-region: NymCard (UAE), Geidea / HyperPay (KSA target).

**[STRATEGY §1.2, §15.3]**

### Penetration milestones

| Phase | MAU target | Geography | Rev / mo |
|---|---:|---|---:|
| **M9 (Seed close)** | 6,000 | UAE only | AED 148k |
| **M18 (cash-flow break-even)** | ~24,000 | UAE only | ~AED 600k |
| **M24 (Series A trigger)** | 50,000 | UAE only | AED 1.23M |
| **M36 (post-A)** | 100,000+ | UAE + KSA | — |

**[FINANCIAL_MODEL §5.1, §8.1]**

---

## Slide 6 — Technical Unit Economics & Competitor Disruption

**Where the AED 245/worker/yr advantage actually comes from.**

### Per-worker P&L, mid-case, M24 steady state — annualised AED

```
Revenue / worker / yr                  AED 296
  - Advance fees + interchange + FX margin + HR-tech share

Variable cost                          AED  41
  - NymCard + Twilio + SMS + LLM inference share

Fixed opex (50k MAU allocation)        AED  98
  - Engineers + compliance/AML + bin-sponsor + dashboard

───────────────────────────────────────────────
Net margin / worker / yr               AED  59       (19.9%)
```

### The line-by-line attribution: why we win where they lose

| Line item | FlexPay (mid) | Edenred-class | NOW Money | Tabby | Saved by |
|---|---:|---:|---:|---:|---|
| Reconciliation Ops labour | **0** | 60 | 35 | 25 | **Atomic WPS settlement** (`reserveAdvance` Prisma `$transaction` + 14:00/22:00 recon worker) |
| Default reserve / capital cost | **0** | 0 | 0 | 180 | **Invariant I1** — advance ≤ accrued. Not a lender. |
| Direct-sales CAC | **35** | 90 | 75 | 45 | **HR-tech distribution** — Bayzat / ZenHR / Darwinbox absorb the funnel cost |
| **Total cost / worker / yr** | **AED 139** | AED 205 | AED 163 | AED 370 | |
| **Net / worker / yr** | **+59** | −25 | −53 | **−80** | |

### The headline that closes the round

**FlexPay is +AED 59 / worker / yr. Tabby is −AED 80 / worker / yr.**

**That AED 245 advantage is not pricing — it is architecture.** It comes from three lines of code:

1. The `reserveAdvance` Prisma `$transaction` eliminates the AED 60/worker/yr reconciliation labour Edenred carries.
2. Invariant I1 inside that transaction eliminates the AED 180/worker/yr default reserve Tabby carries.
3. The HR-tech distribution partnerships eliminate the AED 35-55/worker/yr direct-sales CAC the segment carries.

**[FINANCIAL_MODEL §1.2, §3.5, §3.4]**

### Payback period

**1.8 months.** Fastest in the segment. Sub-2-month payback means **the contribution margin from a single quarter funds the next quarter's CAC** — the model doesn't need successive equity raises to scale. **[FINANCIAL_MODEL §4.2]**

---

## Slide 7 — Product-First Traction

**The product is the demo. The repository is the proof.**

We are not pre-product. **The core backend is built, typechecked, fuzzed, and merged to `main`.** Five end-to-end production commits closed in the last sprint:

| Command | Surface | Status |
|---|---|---|
| 1–3 | WPS routing core + mobile API gateway + strategy + finance model | PR #2 merged |
| 4 | KYC + AML compliance engine with `reserveAdvance` gate | PR #3 merged |
| 5 | Board-deck metrics + liquidity forecaster + fraud monitor | PR #4 merged |
| — | React Native four-factor gateway client + step-up OTP flow | PR #5 merged |

### Backend (`src/`, 78 TypeScript files, 16 modules)

- **20 Prisma models, 21 enums** spanning core wallet, WPS routing, mobile API, compliance, ops-intel
- **44/44 unit + property-based tests green** under Jest + fast-check
- **`tsc --noEmit` clean**
- **8 cron jobs** registered on a centralised `CronManager` (Asia/Dubai), including the 14:00/22:00 reconciliation, the 03:00 sanctions rescreen, and the 15-minute fraud sweep
- **Atomic WPS settlement** with five property-tested invariants
- **HTTP 451 ComplianceBlockError** on regulator-flagged accounts
- **Cohort-scoped 1.5% canary** wired into `/admin/reports/metrics`

### Mobile (`mobile/`, React Native 0.73, 68 files)

- **Four-factor auth stack** at the client boundary: JWT × device-bound Keychain fingerprint × 55s biometric assertion × purpose-partitioned step-up OTP
- **Reactive step-up flow**: HTTP 403 "Step-up OTP required" → global modal → user enters code → request retried with `X-Step-Up-OTP` injected and **the same Idempotency-Key preserved** across the round-trip
- **Single in-flight challenge invariant** in `useStepUpStore` — overlapping enqueues reject the first with `STEP_UP_REPLACED`
- **End-to-end Zod validation** on every gateway response — schema drift fails loud
- **i18n with RTL Arabic** + Detox e2e profiles + EAS build profiles ready
- **19/19 mobile tests green**

### Dashboard (`dashboard/`, Next.js 15, 138 files)

- Admin console with auth, payroll batch upload, employee directory, ops-intel views
- `tsc --noEmit` clean
- Will surface the new `/admin/reports/{metrics,liquidity,fraud-scan}` endpoints in the next sprint

**This is the slide the technical partner forwards to the rest of the LP committee.**

---

## Slide 8 — The Ask & Capital Allocation

### USD 2M Seed — at ~3.5× the capital efficiency of the comparable cohort.

| Comparable [E] | FlexPay equivalent | Multiple |
|---|---|---|
| Tabby Seed: USD 7M | **FlexPay Seed: USD 2M** | **3.5× capital-efficient** |
| NOW Money Seed: USD 7M | **FlexPay Seed: USD 2M** | **3.5×** |
| Tabby Series A: USD 50M | FlexPay Series A: USD 10M | **5×** |

**Why we raise smaller than the segment**: the architectural moat *is* the capital efficiency. **No advance pool to fund** (Invariant I1 → wage routing, not credit). **No default reserve to seed** (the canary failsafe is reserve-free by design). **No direct-sales team to scale** (HR-tech distribution). **No manual ops to staff** (atomic settlement + automated recon). Every line item the segment funds, we avoid by architecture. **[FINANCIAL_MODEL §8.2]**

### Use of funds — USD 2M (≈ AED 7.34M)

| Category | Allocation | Rationale |
|---|---:|---|
| **Engineering (4 FTE, 18mo)** | 38% | Hold the moat. Phase-2 KSA Mudad adapter. Continued DCSE training. PR-grade ops dashboard. |
| **Compliance & AML (1.5 FTE)** | 18% | Step-fixed cost; doubles only at 100k MAU. CBUAE-grade audit posture from day 1. |
| **HR-tech BD + partnership ops** | 14% | Lock Bayzat / ZenHR / Darwinbox before competitors close the same channel. |
| **AI infrastructure (local LLM tier)** | 12% | PDPL-mandated UAE-local Llama 3 / Qwen on e& or Moro infra for financial-core inference. |
| **Regulatory & licensing** | 8% | Bin-sponsor primary escrow, CBUAE relationship management, KSA NCA readiness. |
| **Contingency / opportunistic spend** | 10% | Reserve for HR-tech bidding war or fast-track regulatory upgrades. |

### Milestones the USD 2M underwrites

| Month | Milestone | Numeric anchor |
|---|---|---|
| **M9** | Seed close · MVP at scale | 6,000 MAU · AED 148k MRR · monthly burn AED 200k |
| **M12** | DCSE Phase-1 calibrated to F1 ≥ 0.88 / ROC-AUC ≥ 0.85 | First 5,000-worker dataset → next-7-day liquidity prediction in production |
| **M14** | KSA Mudad adapter shipped | Polymorphism proven before any GCC pilot |
| **M18** | **Cash-flow break-even** | ~24,000 MAU · ~AED 600k MRR · monthly burn flat-to-positive |
| **M20** | Series A trigger | 35,000 MAU · AED 875k MRR · cash-flow + AED 90k/mo |
| **M24** | 50k MAU UAE saturation milestone | AED 1.23M MRR · ready for KSA pilot |

### The three numbers a VC partner reads on the first slide

1. **AED 245 / worker / yr** net margin advantage vs Tabby — encoded in Invariant I1, not in pricing strategy.
2. **1.8 months** payback at mid-case — fastest in the segment.
3. **USD 2M Seed sufficient to reach 12k MAU and cash-flow break-even at M18 without funding an advance pool.**

If those three numbers withstand 30 minutes of stress-testing, the round closes.

---

## Appendix — What we'd answer in due diligence before being asked

| Concern | Response | Evidence |
|---|---|---|
| "How is this not a loan?" | Invariant I1 enforced inside the atomic Prisma `$transaction`. Property-tested in CI. | `src/modules/payroll-routing/invariants.ts`, `tests/payroll-routing.invariants.test.ts` |
| "How do you detect runaway default?" | Cohort-level 1.5% canary at `/admin/reports/metrics`. Strips autonomous limits the moment it trips. | `src/modules/ops-intel/metrics.service.ts`, `tests/ops-intel.test.ts` boundary tests |
| "How fast is reconciliation?" | Twice daily at 14:00 + 22:00 Asia/Dubai bracketing CBUAE SIF windows. Drift > 0.01 AED → cycle FAILED + AuditLog. | `src/modules/payroll-routing/reconciliation.worker.ts` |
| "What about sanctions?" | UN/OFAC/UAE/EU/UK ingest with checksum-idempotent snapshots; 03:00 nightly rescreen + KYC-time synchronous block. HTTP 451 ComplianceBlockError. | `src/modules/compliance/sanctions.service.ts` |
| "PDPL exposure?" | Financial-core inference on UAE-local Llama 3 / Qwen tier. Hybrid LLM gateway classifies before any egress. | `STRATEGY.md §6.2` |
| "Why are your raise rounds smaller?" | Architecturally no advance pool, no default reserve, no direct-sales team, no manual ops to staff. | `FINANCIAL_MODEL.md §8.2` |
| "Why won't a bank just build this?" | They cannot operate at the per-user nightly limit-re-pricing loop speed. They underwrite to bureau, not behaviour. | `STRATEGY §2.3` |
| "What if HR-tech vendors compete?" | Bayzat / ZenHR / Darwinbox know who works where, but cannot move money. We are their natural financial partner, not their competitor. | `STRATEGY §2.1.5, §13` |

---

*Closing line for the partner meeting:*

> *"The architectural moat is the capital efficiency. The unit economics are not a forecast — they are a property test."*
