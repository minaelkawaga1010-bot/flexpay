# FlexPay — Launch Readiness & Next Steps

**Version:** 1.0
**Horizon:** Next 90 days (sandbox → closed beta → CBUAE production review)

---

## 1. Readiness Scorecard

Legend: ✅ ready · 🟡 partial · ❌ gap

| Area | Status | Blocker |
|---|---|---|
| Core wallet ledger | ✅ | — |
| Multi-currency balances | ✅ | — |
| Onboarding + KYC (Sumsub) | ✅ | Shufti fallback contract |
| Card issuing (NymCard) | 🟡 | BIN sponsor sign-off |
| Remittance (Wise/Ripple) | 🟡 | Ripple go-live KYC pending |
| EWA | 🟡 | Employer portal UAT |
| Credit model (H2O) | 🟡 | Fairness audit not started |
| Hafiza | 🟡 | CBUAE no-objection requested |
| Voice AI | 🟡 | Privacy review under PDPL |
| Infra (Terraform me-central-1) | ✅ | — |
| Observability (Sentry/Grafana/PagerDuty) | ✅ | — |
| Runbooks / DR drill | 🟡 | First drill scheduled, not executed |
| Compliance package (CBUAE sandbox) | 🟡 | Final mapping + legal sign-off |
| External pentest | ❌ | Vendor not selected |
| Privacy policy / ToS (AR + EN) | 🟡 | Legal review |
| Support staffing | 🟡 | 3 of 5 agents hired |

## 2. 90-Day Path to Closed Beta

### Days 0–30 — Harden

- Close all 🟡 engineering items above.
- Lock app version, feature-freeze.
- Execute first DR drill; capture RTO/RPO evidence.
- Engage pentest vendor (CREST or equivalent).
- Fairness audit on credit model; sign off or reduce scope to rules-only lending for beta.

### Days 30–60 — Sandbox entry

- Submit CBUAE sandbox application with full compliance package.
- Onboard 3 employer partners for closed beta (100 users total).
- Train 5 support agents on handbook.
- Turn on production observability + 24/7 on-call rota.

### Days 60–90 — Closed beta

- Roll out to 100 users across 3 employers.
- Daily KPI review: onboarding conversion, EWA uptake, support CSAT, error rate.
- Weekly regulator touchpoint.
- End of window: decide go/no-go on open beta (1,000 users).

## 3. KPIs & Guardrails

| Metric | Target | Alert threshold |
|---|---|---|
| Onboarding completion | ≥ 70% | < 50% |
| KYC first-pass approval | ≥ 80% | < 65% |
| EWA success rate | ≥ 95% | < 90% |
| Remittance settlement < 1 h | ≥ 90% | < 80% |
| Support P1 first response | ≤ 15 min | > 30 min |
| CSAT | ≥ 4.2 / 5 | < 3.8 |
| App crash-free sessions | ≥ 99.5% | < 99.0% |
| AML alerts cleared < 24 h | ≥ 95% | < 85% |

## 4. Team Asks

- **Engineering:** sign off on feature freeze; assign owner to each 🟡/❌ item.
- **Compliance:** finalize CBUAE sandbox package; confirm Hafiza no-objection path.
- **Finance:** trust-account with UAE bank opened and funded.
- **Legal:** privacy policy + ToS in AR/EN reviewed and posted.
- **People Ops:** close remaining 2 support hires, run handbook training.
- **Founders:** weekly regulator update, employer-partner comms.

## 5. Post-Beta Roadmap (teaser)

- Additional corridors (Nepal, Sri Lanka, Ethiopia)
- Merchant acquiring (QR payments to grocers, transport)
- Savings products beyond Hafiza (goal-based, Shariah-compliant)
- Islamic-finance-compliant credit product (Murabaha)
- Open banking integrations once CBUAE OB framework is live

## 6. Decisions Still Needed

1. **Lending at launch?** Full model or rules-only? (Fairness audit is the gating input.)
2. **Voice AI at launch?** Ship in beta or behind flag? (PDPL review pending.)
3. **Hafiza at launch?** Depends on regulator no-objection timing.
4. **Pentest vendor:** pick within 2 weeks — scoping starts after selection.
5. **24/7 support** in beta, or 08:00–24:00 with on-call? Current plan assumes the latter.

These five decisions unblock the next planning cycle.
