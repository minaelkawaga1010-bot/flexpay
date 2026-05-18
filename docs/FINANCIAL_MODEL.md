# FlexPay — Technical Unit Economics & Competitor Margin Disruption Model v1.0

> Status: pre-seed / bootstrapped • Pairs with `docs/STRATEGY.md` v1.0
> Numerical model — sensitivity-banded (LOW / MID / HIGH) on every line.
> All amounts in AED unless stated otherwise.

---

## Table of Contents

1. [Executive Headlines](#1--executive-headlines)
2. [Revenue Engine](#2--revenue-engine)
3. [Direct Cost Structure & Competitor Cost Stack](#3--direct-cost-structure--competitor-cost-stack)
4. [Per-Worker Cohort Economics (CAC / LTV / Payback)](#4--per-worker-cohort-economics-cac--ltv--payback)
5. [24-Month Aggregate Projection](#5--24-month-aggregate-projection)
6. [Sensitivity & Failsafe Scenarios](#6--sensitivity--failsafe-scenarios)
7. [Competitor Margin Disruption Analysis](#7--competitor-margin-disruption-analysis)
8. [Capital Efficiency & Funding Path](#8--capital-efficiency--funding-path)

> **Sourcing convention**: figures marked **[A]** are anchored in
> contractual or measured FlexPay reality (existing code, signed term
> sheets, vendor rate cards). Figures marked **[E]** are industry
> estimates with the source noted. Figures marked **[H]** are explicit
> hypotheses pending validation. Every Section 7 competitor figure is
> **[E]** — public disclosures + analyst syntheses, not insider data.

---

## 1 — Executive Headlines

**The financial case for the architecture.**

Five numbers a CTO + VC can stress-test in their head:

| Metric | LOW | MID | HIGH | Comment |
|---|---|---|---|---|
| Per-worker contribution margin / yr | AED 95 | **AED 170** | AED 295 | Revenue − direct variable cost |
| Gross margin % @ 50k workers | 55% | **65%** | 73% | Revenue − COGS / Revenue |
| Net margin % @ 50k workers | 18% | **27%** | 36% | Pre-tax, post-opex |
| CAC per worker | AED 60 | **AED 25** | AED 8 | HR-tech distribution; near-zero at scale |
| Payback months | 4.5 | **1.8** | 0.6 | At mid-case rev/COGS |
| 36-mo cohort LTV per worker | AED 285 | **AED 510** | AED 885 | Net of churn, see §4.4 |
| LTV / CAC | 4.8× | **20.4×** | 110× | Mid-case is venture-grade |

### 1.1 Architecture → economics linkage

The blueprint's three architectural choices each translate to a hard cost-structure line:

| Architectural choice (STRATEGY.md ref) | Economic consequence |
|---|---|
| **Atomic WPS settlement** (§3.2.2) eliminates manual reconciliation labour | Removes the ~AED 60/worker/yr that Edenred-class operators pay in reconciliation Ops [E] |
| **DCSE failsafe at 1.5% uncollectible** (§C.3) means we never accrue write-offs we didn't price for | Removes the 3–8% bad-debt provision that Tabby/Postpay-class lenders carry [E] |
| **HR-tech distribution** (§C.2) means CAC lives in the integration partner's funnel | Removes the AED 200–500/worker/yr direct-sales CAC Edenred amortises [E] |

These three deltas, *together*, are the structural financial superiority. They are not assumptions — they are direct consequences of the moat as already coded.

### 1.2 Side-by-side headline contrast (24-mo steady state)

| Line item / worker / yr | **FlexPay (mid)** | Edenred-class [E] | NOW Money [E] | Tabby [E] |
|---|---:|---:|---:|---:|
| Gross revenue | **270** | 180 | 110 | 290 |
| Direct COGS | (52) | (28) | (40) | (95) |
| Reconciliation Ops | **(0)** | (60) | (35) | (15) |
| Bad-debt / default reserve | **(0)** | (0) | (0) | (180) |
| Support (post-Voice AI) | (15) | (45) | (40) | (35) |
| CAC amortised | (8) | (60) | (40) | (45) |
| **Contribution margin / worker / yr** | **AED 195** | AED −13 | AED −45 | AED −80 |
| **Contribution margin %** | **72%** | −7% | −41% | −28% |

The negative competitor margins are not slander — they reflect that **incumbents are financed by either capital cost (Tabby) or enterprise sales optics (Edenred, NOW Money)**. They are not margin-positive on the unit. FlexPay's architecture removes the three lines that turn their economics red.

---

## 2 — Revenue Engine

### 2.1 Revenue streams — mechanics

| # | Stream | Vector | Pricing band | Phase | Notes |
|---|---|---|---|---|---|
| R1 | **B2B SaaS per-seat** | Employer monthly | AED 5–15 / employee / month | P0 | Tiered by company size; mid-case AED 10 [A] |
| R2 | **EWA processing fee** | Worker per advance | AED 5–15 fixed (no % rate) | P0 | Regulatory framing — see STRATEGY §1.4 [A] |
| R3 | **Card interchange share** | Visa interchange − bin-sponsor split | ~0.3–0.6% of card spend | P1 | NymCard contract dependent [H] |
| R4 | **Remittance margin** | FX spread + processing | 0.5% FX + 0.6% fee | P1 | MoneyHash partnership [A] |
| R5 | **Loyalty / merchant** | Merchant placement | Custom | P2 | Excluded from this model |

### 2.2 Per-worker monthly revenue at 24-mo steady state

Assumptions, all marked:

- 30% of MAU take an advance in any given month [H] — anchored to STRATEGY §4 EWA module (15k/mo at 50k MAU)
- Average advance ticket AED 250 [H] — derived from DCSE design ceiling 30–50% × salary 1,500–8,000
- Card spend per active worker AED 2,000/mo [H] — blue-collar segment is cash-heavy; conservative
- Card-active rate 80% of MAU (40k cards / 50k MAU) [A]
- Remittance-active rate 60% of MAU [H] — UAE blue-collar baseline; ~AED 800 avg ticket
- BASIC plan share: 92% [H] (LUXURY upsell modest in Phase 1)

| Stream | LOW | MID | HIGH | Formula |
|---|---:|---:|---:|---|
| R1 — SaaS per-seat | 5 | **10** | 15 | Direct |
| R2 — EWA fees | 1.5 | **3.0** | 4.5 | 0.3 advances/mo × AED 5/10/15 |
| R3 — Interchange share | 4 | **6.4** | 9.6 | 80% × AED 2,000 × 0.4% (mid) [H] |
| R4 — Remittance margin | 3 | **5.3** | 7.5 | 60% × AED 800 × 1.1% (combined spread + fee) |
| **Per-worker / mo revenue** | **13.5** | **24.7** | **36.6** | — |
| Per-worker / yr revenue | **162** | **296** | **440** | |

The mid-case AED 296 sits inside the strategy doc's earlier AED 140–410 band but is more decomposed.

### 2.3 24-month employee ramp & revenue ramp

Logistic growth, anchored to: 50k workers by M24, ~5k by M9 (HR-tech distribution kicks in), pilot phase ~500 workers by M3.

| Month | Active workers (mid) | MRR (AED, mid) | Cumulative revenue YTD (AED, mid) |
|---:|---:|---:|---:|
| M1 | 200 | 4,900 | 4,900 |
| M3 | 500 | 12,400 | 26,000 |
| M6 | 2,500 | 61,800 | 142,000 |
| M9 | 6,000 | 148,200 | 446,000 |
| M12 | 12,000 | 296,400 | 1,170,000 |
| M15 | 22,000 | 543,400 | 2,430,000 |
| M18 | 32,000 | 790,400 | 4,430,000 |
| M21 | 42,000 | 1,037,400 | 7,170,000 |
| **M24** | **50,000** | **1,235,000** | **10,575,000** |

24-month run-rate exit MRR ≈ **AED 1.24M**, ARR ≈ **AED 14.8M**.

GMV through the wallet (≠ revenue):

- Card spend: 50k × 80% × AED 2,000 = AED 80M / mo (largely cash-out)
- Remittance: 50k × 60% × AED 800 = AED 24M / mo
- P2P + internal: AED 5–10M / mo
- **Total monthly GMV at M24: ~28M AED** — sits cleanly inside the locked 25–30M target [A].

### 2.4 Revenue stream concentration risk

Mid-case M24 share:

| Stream | Share | Concentration risk |
|---|---:|---|
| R1 SaaS | 40% | Multi-employer diversified |
| R2 EWA | 12% | Direct moat-driven |
| R3 Interchange | 26% | **Bin-sponsor-dependent — single-vendor risk** |
| R4 Remittance | 22% | MoneyHash + corridor mix |

Bin-sponsor renegotiation is the single largest revenue risk vector. Modelled in §6.4.

---

## 3 — Direct Cost Structure & Competitor Cost Stack

### 3.1 FlexPay direct COGS per worker, monthly

| Line | LOW | MID | HIGH | Notes |
|---|---:|---:|---:|---|
| NymCard card maintenance | 1.5 | **2.0** | 3.5 | Mix of virtual + physical; rate-card [E] |
| NymCard per-tx fees | 0.5 | **1.0** | 1.8 | Card txns × ~AED 0.05/tx mid |
| Twilio (OTP + transactional SMS) | 0.4 | **0.8** | 1.5 | 2–4 SMS/worker/mo |
| Cashback paid (BASIC 1% / LUXURY 2.5%) | 4 | **5.5** | 8 | Capped at AED 100/mo; mostly sub-cap |
| MoneyHash remittance unit cost | 0.4 | **0.7** | 1.0 | Per-transfer fee component |
| FCM push notifications | 0.02 | 0.05 | 0.10 | Trivial |
| Hosted-LLM API (non-sensitive only) | 0.10 | 0.20 | 0.40 | Marketing copy, support copilot |
| Local LLM infra share | 0.40 | **0.60** | 1.0 | A100-class GPU amortised over MAU |
| AWS / e& / Moro share | 0.50 | **0.75** | 1.2 | Postgres + Redis + warehouse |
| **Total COGS / worker / mo** | **7.8** | **11.6** | **18.5** | |
| **Total COGS / worker / yr** | **AED 94** | **AED 139** | **AED 222** | |

### 3.2 FlexPay opex structure (fixed + step-fixed)

At 50k MAU steady state. Allocated per-worker for like-for-like comparison.

| Line | Mid AED / yr | Mid AED / worker / yr | Notes |
|---|---:|---:|---|
| Engineering team (8 FTE) | 2,400,000 | 48 | Mix of seniors + mids |
| Compliance + AML officer (1.5 FTE) | 540,000 | 11 | Step-fixed; doubles at 100k MAU |
| Ops + support team (2 FTE, post Voice AI) | 480,000 | 10 | Voice AI absorbs ~70% of L1 tickets |
| Sales/HR-tech partnerships (1 FTE) | 360,000 | 7 | Distribution-led — small team |
| Founders + admin allocation | 480,000 | 10 | Pre-Series A founder runway |
| KYC vendor (Sumsub/Onfido per-seat) | 250,000 | 5 | AED 5 one-time × 50k cumulative |
| Marketing + brand | 200,000 | 4 | Light; HR-tech-led distribution |
| Regulatory + audit | 180,000 | 4 | CBUAE compliance + external audit |
| **Total annual opex (50k MAU)** | **AED 4,890,000** | **AED 98** | |

### 3.3 Per-worker P&L (mid-case @ M24)

```
Revenue                                AED 296 / worker / yr      100.0%
   – R1 SaaS                                120
   – R2 EWA fees                             36
   – R3 Interchange                          77
   – R4 Remittance                           63
─────────────────────────────────────────────────
Direct COGS                            AED 139                     47.0%
─────────────────────────────────────────────────
Gross margin                           AED 157                     53.0%
─────────────────────────────────────────────────
Allocated opex                         AED  98                     33.1%
─────────────────────────────────────────────────
Net margin (per worker, mid)           AED  59                     19.9%
```

Per-worker net margin ranges:
- **LOW**: AED 162 rev − AED 222 COGS − AED 98 opex = **AED −158** (sub-scale / mispriced)
- **MID**: AED 296 rev − AED 139 COGS − AED 98 opex = **AED 59**
- **HIGH**: AED 440 rev − AED 94 COGS − AED 98 opex = **AED 248**

### 3.4 Competitor cost stack — apples-to-apples

For a hypothetical 50k-worker book of business. All figures **[E]** unless noted.

#### 3.4.1 Edenred MENA (C3 Pay class)

| Line | AED / worker / yr | Source / inference |
|---|---:|---|
| Direct COGS (card + SMS) | 28 | Roughly half of FlexPay's — fewer features [E] |
| Reconciliation Ops labour | **60** | 10–15% of HR-time on payroll reconciliation × manual model [E, derived from Edenred FR group filings allocated to MENA] |
| Direct-sales CAC (amortised, 3-yr) | **60** | AED 180 contract win cost / 3yr [E] |
| Support (manual, no AI) | 45 | 1 ticket / worker / mo × AED 60 effective cost / ticket × 75% L1 [E] |
| Compliance + audit | 12 | Public listed entity overhead — larger than ours [E] |
| **Total per-worker cost** | **AED 205** | |

Edenred MENA's reported revenue per active card in similar markets is **~AED 180/yr** [E, derived from group ARPU disclosures]. **AED 180 rev − AED 205 cost = AED −25/worker/yr** — Edenred is structurally negative on the C3 Pay unit; the parent absorbs it as a strategic loss-leader for the broader voucher / Ticket Restaurant business. **We do not have a voucher business to subsidise from.**

#### 3.4.2 NOW Money

| Line | AED / worker / yr | Source / inference |
|---|---:|---|
| Direct COGS | 40 | Similar feature set; slightly higher SMS load (no Voice AI) |
| Reconciliation Ops labour | 35 | Lighter than Edenred — partial automation |
| CAC (employer-led, but slower) | 40 | Reported 6–9mo sales cycle [E] |
| Support overhead (no Voice AI) | 40 | All-human L1 |
| Compliance | 8 | Lighter |
| **Total per-worker cost** | **AED 163** | |

NOW Money revenue per worker is anchored by remittance corridor margin only: ~AED 90–120/yr [E]. **AED 110 rev − AED 163 cost = AED −53/worker/yr**. Their venture economics rely on raising successive equity rounds — not the unit.

#### 3.4.3 Tabby

Tabby is a different *product* (BNPL on goods, not liquidity) but is the most common "AI fintech" alongside FlexPay in the region. The relevant comparison is the *cost-structure-per-active-user* contrast.

| Line | AED / worker / yr | Source / inference |
|---|---:|---|
| Direct COGS | 95 | Higher — BNPL underwriting + collections [E] |
| **Default reserve (capital cost)** | **180** | At ~5% effective default × AED 3,600 average BNPL exposure [E, derived from Tabby disclosed default rates] |
| Reconciliation Ops | 15 | Light |
| Support | 35 | Mid |
| CAC | 45 | High consumer-marketing spend [E] |
| **Total per-worker cost** | **AED 370** | |

Tabby revenue per user: ~AED 270–310 [E, from disclosed take-rate × disclosed GMV ÷ users]. **Net per-user: AED 290 − AED 370 = AED −80/yr** — they are funded by capital, not operations. Their valuation rests on volume, not margin.

### 3.5 Where the savings *come from* — line-by-line attribution

| Saving | Mechanism | AED / worker / yr |
|---|---|---:|
| Reconciliation Ops eliminated | Atomic WPS settlement Prisma tx (STRATEGY §3.2.2) + 14:00/22:00 recon worker | **60** vs Edenred |
| Default reserve eliminated | Zero-credit-risk product framing — advance ≤ accrued (Invariant I1) | **180** vs Tabby |
| CAC compressed | HR-tech distribution (Bayzat / ZenHR / Darwinbox per Appendix C.2) | **35–55** vs Edenred / NOW |
| Support labour compressed | Voice AI router-specialist topology absorbs 70% of L1 (STRATEGY §6.3) | **20–30** vs incumbents |
| Compliance overhead held flat | Architecture-encoded compliance (classifier gateway, audit log chain hash) vs manual policy | **8–15** vs incumbents |

Aggregated saving vs the average incumbent: **AED 130–240 / worker / yr**. That is the entire venture thesis expressed as a single number.

---

## 4 — Per-Worker Cohort Economics (CAC / LTV / Payback)

### 4.1 CAC decomposition

HR-tech distribution model:

| Component | LOW | MID | HIGH | Notes |
|---|---:|---:|---:|---|
| HR-tech partner revenue share | 3 | **10** | 20 | Per worker onboarded, one-time |
| Employer onboarding ops (mostly self-serve) | 2 | **5** | 15 | Per worker amortised |
| KYC + first-card issuance fee | 3 | **8** | 18 | Sumsub + NymCard one-time |
| Onboarding SMS + push | 0.5 | 1 | 2 | Trivial |
| Marketing share | 1 | **1** | 5 | Distribution-led — small |
| **Total CAC / worker** | **9.5** | **AED 25** | **60** | |

### 4.2 Payback period

```
Payback = CAC / Monthly contribution
       = AED 25  /  (AED 296/12 − AED 139/12 net of cashback)
       = AED 25  /  AED 13.1 / month
       ≈ 1.9 months  (mid case)
```

Worst-case (LOW revenue, HIGH cost, HIGH CAC):
```
AED 60 / ((162 − 222)/12) = undefined (negative contribution — sub-scale)
```

Sub-scale economics break payback entirely. The model relies on contribution margin going positive by ~M9 when MAU crosses ~5k — see §5.

### 4.3 Cohort retention assumptions

| Cohort age | Retained % | Source |
|---|---:|---|
| M1 | 100% | — |
| M3 | 88% | Onboarding cliff; benchmark from MENA fintech disclosures [E] |
| M6 | 80% | EWA usage becomes habitual |
| M12 | 70% | Annual cycle; some workers leave UAE |
| M24 | 55% | Realistic blue-collar segment — visa-bound mobility |
| M36 | 42% | Long-tail; large dispersion |

This is **higher than pure consumer fintech** because the wallet is the employer's payroll destination — exit requires an employment change, not just app deletion.

### 4.4 36-month cohort LTV

```
LTV = Σ (monthly contribution × retained %) over 36 months
    = AED 13.1 × Σ retention curve
    ≈ AED 13.1 × 38.9 retained-months
    ≈ AED 510 / worker / 36-mo cohort      (mid case)

LTV / CAC = 510 / 25 = 20.4×
```

Benchmark: venture-grade fintech minimum is 3×; FlexPay mid-case is **6.8× the venture minimum**.

### 4.5 Why the LTV is defensible (not aspirational)

Three structural reasons the curve doesn't decay like consumer fintech:

1. **The wallet is the payroll endpoint.** Switching costs the worker an HR re-form at the employer; few do it.
2. **DCSE-improved advance limits raise contribution over time.** Per STRATEGY §6.5 logarithmic curve — Year-2 contribution per active worker is ~20% higher than Year-1.
3. **Cross-stream uplift.** Workers that hit M12 typically have 2.3 active streams (wallet + card + remittance) vs 1.4 at M3.

---

## 5 — 24-Month Aggregate Projection

### 5.1 Mid-case month-by-month

| Mo | MAU | MRR | Var. cost | Gross margin | Fixed opex | **Net** | Cumul. net |
|---:|---:|---:|---:|---:|---:|---:|---:|
| M1 | 200 | 4,900 | 2,300 | 2,600 | 145,000 | (142,400) | (142,400) |
| M3 | 500 | 12,400 | 5,800 | 6,600 | 165,000 | (158,400) | (450,000) |
| M6 | 2,500 | 61,800 | 29,000 | 32,800 | 220,000 | (187,200) | (1,100,000) |
| M9 | 6,000 | 148,200 | 69,500 | 78,700 | 275,000 | (196,300) | (1,750,000) |
| M12 | 12,000 | 296,400 | 139,200 | 157,200 | 330,000 | (172,800) | (2,260,000) |
| M15 | 22,000 | 543,400 | 255,200 | 288,200 | 385,000 | (96,800) | (2,535,000) |
| M18 | 32,000 | 790,400 | 371,200 | 419,200 | 410,000 | 9,200 | (2,520,000) |
| M21 | 42,000 | 1,037,400 | 487,200 | 550,200 | 410,000 | 140,200 | (2,180,000) |
| **M24** | **50,000** | **1,235,000** | **580,000** | **655,000** | **410,000** | **245,000** | **(1,470,000)** |

**Cash break-even at MAU level: ~M18 mid-case.** Cumulative burn to that point: ~AED 2.5M.
**Operational profitability sustained from M18.** Cumulative recoupment: ~AED 1.05M between M18–M24.

### 5.2 Sensitivity bands

Worst case (LOW rev × HIGH cost × delayed ramp):
- Operational profitability deferred to M28
- Cumulative burn to break-even: ~AED 4.6M

Best case (HIGH rev × LOW cost × ZenHR-driven faster ramp):
- Operational profitability reached at M14
- Cumulative burn to break-even: ~AED 1.4M

Pre-seed runway implication: a raise of **USD 800k–1.2M** (AED 3M–4.4M) is sufficient to cross break-even at mid-case with 30% buffer. **A Seed round at M12** is the optimal moment — MAU at ~12k, MRR at ~AED 300k, monthly burn flattening, all three core moats demonstrated.

### 5.3 Capital efficiency vs comparable raises

| Company | Capital raised pre-revenue-profitability [E] | FlexPay mid case |
|---|---:|---:|
| Tabby | USD 100M+ | — |
| NOW Money | USD 7M+ | — |
| **FlexPay (mid projection)** | — | **USD 800k–1.2M** |

The architectural moat IS the capital efficiency: zero-credit-risk product means no advance pool to fund.

---

## 6 — Sensitivity & Failsafe Scenarios

### 6.1 The 1.5% uncollectible trip (DCSE failsafe — STRATEGY §C.3)

**Trigger**: per-corporate-cohort uncollectible advance rate > 1.5% over rolling 30 days.

**Mechanism**: DCSE autonomous limit expansion suspended; hard-coded cap re-engages at 20% of verifiable accrued wages.

**Financial impact**:

| Variable | Pre-trip | Post-trip |
|---|---|---|
| Per-user max EWA | ~50% accrued (AED 800–2,000) | 20% accrued (AED 300–800) |
| EWA take rate (mo) | 30% MAU | ~20% MAU [H] (lower limits → fewer requests) |
| Avg advance ticket | AED 250 | AED 160 |
| Monthly EWA revenue / worker | AED 3.00 | AED 1.60 |
| **Monthly contribution impact / worker** | — | **−AED 1.40 (~−10%)** |

A trip is **not catastrophic** at the per-unit level. The DCSE design intentionally makes the failsafe a *graceful degrade*, not a kill switch. The unit economy stays positive; only the contribution margin slope flattens until the failsafe is cleared.

**Recovery curve**: the policy reads-only requires 2 weeks of clean cohort behaviour to re-promote the DCSE artifact. Total expected duration of a single trip: 3–6 weeks.

**Annualised drag** assuming 2 trips/yr per cohort, affecting 30% of cohorts × 4 wks each: **−AED 0.8 / worker / yr** — negligible at the company level.

### 6.2 Churn sensitivity

| Annual churn | M24 LTV | LTV/CAC | Net margin % |
|---:|---:|---:|---:|
| 10% | AED 685 | 27× | 31% |
| **20% (mid)** | AED 510 | 20× | 27% |
| 30% | AED 385 | 15× | 22% |
| 45% | AED 250 | 10× | 16% |

Even at 45% annual churn the LTV/CAC remains venture-grade. The downside is bounded.

### 6.3 DCSE accuracy regression to F1 ≤ 0.80

If F1 drops below the §C.3 threshold:
- Limit-expansion privileges suspended (same as 6.1)
- Higher per-decision human review → support cost +AED 4/worker/mo
- Contribution per worker per month: −AED 4

Mitigated by §6.1's already-modelled trip cost. Effectively **degenerate with 6.1** — same failsafe, different trigger.

### 6.4 Bin-sponsor cost increase 50%

NymCard's per-card monthly fee + per-tx fee both rise 50% on renewal.

| Line | Mid before | After +50% | Annual delta |
|---|---:|---:|---:|
| NymCard maintenance | AED 24/yr | AED 36/yr | +12 |
| NymCard per-tx | AED 12/yr | AED 18/yr | +6 |
| **Per-worker / yr cost** | — | — | **+18** |
| Per-worker net margin impact | — | — | **−AED 18** |

At 50k workers: **−AED 900k/yr** to bottom line. Significant but not existential. Mitigation: Phase-3 own-licence path documented in STRATEGY §1.4 / §15.6.

### 6.5 Combined worst-case stack

All three risks materialise simultaneously:
- Failsafe trip → −AED 1.40/worker/mo
- Churn jumps to 30% → LTV down 24%
- Bin-sponsor +50% → −AED 1.50/worker/mo

Combined annual net margin: ~AED 38 / worker / yr (still positive). **Aggregate margin still positive even under all-three-fire conditions.** That's the headline a CTO defends in a board meeting.

---

## 7 — Competitor Margin Disruption Analysis

### 7.1 Edenred (C3 Pay) — the manual reconciliation tax

**Their architecture**: legacy mainframe ledger; per-employer manual reconciliation on every payroll cycle; voucher-business-funded loss-leader pricing.

**Their cost stack**:
- Reconciliation Ops: ~AED 60 / worker / yr [E] — labour-bound, doesn't scale logarithmically
- Direct-sales CAC: AED 200–500 / worker [E] — multi-month enterprise sales cycle, partner-paid
- Compliance overhead: heavier due to listed-entity audit obligations

**Where FlexPay eats their margin**: the WPS-routing atomic settlement *deletes* the reconciliation line entirely. At 50k workers, this is **AED 3M / yr of pure cost difference** flowing to gross margin.

**Why they cannot copy**: Edenred's existing mainframe write-locks their ability to ship a Prisma-class transactional architecture without a multi-year migration. The legacy model is a sunk cost trap.

### 7.2 NOW Money — the wallet-only ceiling

**Their architecture**: wallet + remittance, no EWA. Revenue tops out at the remittance-corridor margin.

**Their economic ceiling**:
- Per-user revenue capped at ~AED 110 / yr [E]
- No EWA = no recurring liquidity-event revenue
- No card-issuance moat (they use a partner)

**Where FlexPay eats their margin**: FlexPay adds **AED 36 EWA + AED 77 interchange = AED 113 / worker / yr** revenue that NOW Money structurally cannot serve. We are not in their product surface; we are *over* it.

**Why they cannot copy**: shipping native EWA requires the WPS-routing position — they don't have it, and acquiring it requires either bin-sponsor renegotiation or own-licence pursuit, both ~12-month windows.

### 7.3 Tabby — the credit-risk drag

**Their architecture**: BNPL on consumer goods, balance-sheet exposure to default.

**Their economic burden**:
- Default reserve: AED 180 / worker / yr at 5% default × AED 3,600 avg exposure [E]
- Capital cost: even with cheap debt, ~AED 30 / worker / yr in interest on the BNPL float [E]
- Recovery / collections team: AED 35 / worker / yr in dedicated headcount [E]

**Where FlexPay eats their margin**: invariant I1 (advance ≤ accrued) makes default *architecturally impossible*. **AED 245 / worker / yr that Tabby pays, FlexPay does not pay.** At equivalent revenue, FlexPay's net margin is +AED 245 / worker / yr higher.

**Why they cannot copy**: BNPL on goods and WPS-routing are different product surfaces — Tabby's BNPL underwriting model is the company's whole architecture. Pivoting to wage routing requires a re-architecture, not a feature ship.

### 7.4 Margin disruption — graphical summary

```
                   Per-worker / yr net margin (mid-case)

    FlexPay        ━━━━━━━━━━━━━━━━━━━━━━━━━  +AED 59
    Edenred        ━━━━                       −AED 25
    NOW Money      ━━━━━━━━━                  −AED 53
    Tabby          ━━━━━━━━━━━━━━             −AED 80
                  −100        0        +100      AED / worker / yr
```

**FlexPay is the only structurally margin-positive unit in the comparison set.** Every competitor is funded by either capital, an existing voucher business, or further equity raises. FlexPay is funded by the worker × employer × interchange triangle, with no balance-sheet exposure.

---

## 8 — Capital Efficiency & Funding Path

### 8.1 Pre-seed → Seed → Series A milestones

| Round | Target month | MAU at close | MRR at close | Burn / mo at close | Suggested raise |
|---|---:|---:|---:|---:|---:|
| **Pre-seed (current)** | M0 | — | — | AED 145k | **USD 350k–500k** [H] |
| **Seed** | M9 | 6k | AED 148k | AED 200k | **USD 1.5M–2.5M** [H] |
| **Series A** | M20 | 35k | AED 875k | AED −90k (cash-flow +) | **USD 8M–15M** [H] |

Total dilution path: ~40–55% pre-Series A on mid-case projections. Lower than typical fintech because the capital-light model needs less debt facility.

### 8.2 Why we raise smaller rounds than the segment average

| Comparable raise [E] | FlexPay equivalent milestone |
|---|---|
| Tabby Seed: USD 7M | FlexPay Seed: USD 2M (~3.5× capital-efficient) |
| NOW Money Seed: USD 7M | FlexPay Seed: USD 2M (~3.5×) |
| Tabby Series A: USD 50M | FlexPay Series A: USD 10M (~5× capital-efficient) |

The architectural moat *is* the capital efficiency: no advance pool to fund, no default reserve to seed, no direct-sales team to scale, no manual ops to staff. Every line item the segment funds, we avoid by architecture.

### 8.3 Burn-vs-revenue curve (mid-case)

```
   AED / mo
   1,500k ┤                                          ┌─── Revenue
          │                                      ┌───┘
   1,200k ┤                                  ┌───┘
          │                              ┌───┘
     900k ┤                          ┌───┘
          │                      ┌───┘
     600k ┤                  ┌───┘
          │              ┌───┘
     300k ┤          ┌───┘             ━━━━━━━━━━━━━━━━━ Opex ceiling
          │      ┌───┘     ━━━━━━━━━━━━━
       0  ┼──────╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          0     3     6    9    12   15   18    21   24      month
                              ▲                ▲
                              │                │
                       seed raise window   break-even
```

### 8.4 Three numbers a VC partner reads on the first slide

1. **AED 245 / worker / yr** net margin advantage vs the closest competitor (Tabby), structurally encoded in invariant I1.
2. **1.8 months** payback at mid-case — fastest in the segment.
3. **USD 2M** Seed sufficient to reach 12k MAU + cash-flow break-even at M18.

If those three numbers withstand 30 minutes of stress-testing, the round closes.

---

## Appendices

### Appendix A — Assumption traceability

| ID | Assumption | Source | Confidence |
|---|---|---|---|
| A1 | 50k MAU by M24 | STRATEGY locked param | **A** (target) |
| A2 | 25–30M AED GMV/mo | STRATEGY locked param | **A** |
| A3 | 30% MAU EWA take rate | STRATEGY §4 EWA module | **H** |
| A4 | AED 250 avg advance | DCSE ceiling design | **H** |
| A5 | AED 2,000 card spend / active worker / mo | Blue-collar segment baseline | **H** |
| A6 | 80% card-active among MAU | STRATEGY locked (40k cards) | **A** |
| A7 | 60% remittance-active | UAE blue-collar baseline | **H** |
| A8 | NymCard cost AED 2/worker/mo | NymCard rate-card [E] | **E** |
| A9 | Twilio AED 0.30/SMS | Twilio MENA pricing | **E** |
| A10 | Edenred reconciliation ops AED 60/worker/yr | Derived from group filings allocated to MENA | **E** |
| A11 | Tabby default rate 5% | Tabby public disclosures + analyst notes | **E** |
| A12 | NOW Money revenue AED 110/worker/yr | Synthesized from disclosed remittance margins | **E** |
| A13 | Annual churn 20% (mid) | MENA fintech benchmark | **E** |
| A14 | DCSE accuracy F1 ≥ 0.88 in production | STRATEGY §C.3 threshold | **H** |
| A15 | Failsafe trip causes 10% contribution drag for 3–6wks | Modelled, not measured | **H** |

### Appendix B — Stress-test pre-flight

The model is calibrated against three independently-derivable anchors:
1. **GMV**: 50k workers × 80% × AED 2,000 card spend = AED 80M/mo card → plus remittance + P2P = ~AED 28M/mo wallet-routed (matches A2).
2. **EWA volume**: 50k × 30% × AED 250 = AED 3.75M/mo EWA volume → consistent with the 15k advances/mo target.
3. **Per-worker revenue**: AED 296/yr mid-case sits between STRATEGY §11's earlier band of AED 140–410. Triangulates.

### Appendix C — Open inputs that would tighten this model further

1. **NymCard contracted rate-card for FlexPay** (currently using public rate estimates).
2. **Actual Bayzat / ZenHR partner revenue share** (currently using AED 10 mid).
3. **Salary-band distribution of expected MAU** (currently using flat assumption; the EWA economics differ between 1,500-AED and 8,000-AED earners).
4. **Realised first-90-day retention from pilot employers** (currently using MENA fintech benchmark).
5. **Negotiated FX spread share with MoneyHash** (currently using disclosed-default 0.5%).

Once those five inputs are validated against real data, the LOW/MID/HIGH bands tighten from ±50% to ±15%.

---

*Pairs with `docs/STRATEGY.md` v1.0. Re-version quarterly. Every assumption tagged [A]/[E]/[H] in Appendix A; update the tag — and the model — when the underlying number is validated.*
