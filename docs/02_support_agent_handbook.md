# FlexPay Support Agent Handbook

**Version:** 1.0 — Beta (first 100 users)
**Languages supported:** Arabic, English, Hindi, Urdu, Tagalog
**Coverage:** 08:00–24:00 GST, 7 days (beta); on-call rotation for P1 outside hours

---

## 1. Mission

Resolve the user's problem on the first contact, without breaking compliance or exposing data. Every ticket either closes with a fix, escalates to the right queue, or opens a root-cause task. Nothing sits silent.

## 2. Service Levels (beta)

| Priority | Example | First response | Resolution target |
|---|---|---|---|
| **P1** | App down, money missing, card blocked mid-transaction, suspected fraud | 15 min | 4 h |
| **P2** | Failed remittance, EWA draw stuck, KYC rejected | 1 h | 24 h |
| **P3** | UI confusion, feature request, cosmetic bug | 4 h | 3 business days |
| **P4** | General question, doc request | 8 h | 5 business days |

## 3. Agent Toolkit

| Tool | Purpose | Access control |
|---|---|---|
| Zendesk (or Freshdesk) | Ticket master | All agents |
| FlexPay Admin (read) | User profile, transaction history | Tier-1 agents |
| FlexPay Admin (write) | Unlock account, reset PIN | Tier-2 agents only |
| Ledger viewer | Double-entry trace | Tier-2 + finance |
| Sentry / Grafana | Error and latency context | Tier-2 + on-call |
| n8n | Workflow status (onboarding, AML) | Tier-2 + ops |

**Rule:** never query production DB directly; every read goes through Admin with audit logging.

## 4. Identity & Authentication

Before any account action:

1. Ask user to state registered phone + full name.
2. Send in-app verification prompt (push → 6-digit code).
3. If push unavailable, fall back to SMS OTP to registered number only.
4. For high-risk actions (PIN reset, beneficiary change), require **two factors**: OTP + last transaction amount.

Never accept:
- Emirates ID number alone as verification
- DOB as verification
- Third-party callers ("my husband's account")

## 5. Top 20 Playbooks

### 5.1 "My balance is wrong"
1. Pull ledger for last 48 h.
2. Reconcile wallet → balance events vs. transaction events.
3. If drift: create P1 ticket, tag `ledger-drift`, escalate to finance on-call.
4. If user misread UI: walk through pending vs. available balance.

### 5.2 "I sent money and recipient didn't receive"
- Remittance: check `Transaction.status`, then partner webhook log.
  - `PENDING_PARTNER` > 2 h → escalate to remittance ops.
  - `FAILED_COMPLIANCE` → request source-of-funds doc, hand to compliance.
  - `SETTLED` → ask recipient to check bank; provide UTR/MTCN from transaction detail.

### 5.3 "KYC was rejected"
- Read Sumsub verdict in Admin.
- Common reasons + scripted fixes:
  - Blurry ID → guide to retake in daylight
  - Expired EID → direct to ICA renewal
  - Liveness fail → retry with glasses off, good lighting
- After 2 rejections, route to compliance queue — do not keep retrying.

### 5.4 "I can't log in / biometric fails"
- Check `auth.failed_logins`; if ≥ 5 in 15 min, account auto-locked.
- Verify identity per §4, then unlock via Admin.
- If repeat, escalate: possible credential-stuffing.

### 5.5 "My card is declined"
Decision tree:
1. NymCard status active? If blocked → reason code tells you.
2. Balance sufficient in card currency?
3. Merchant category blocked? (gambling, crypto)
4. Geo-block tripped? (first txn abroad)
5. None of the above → open P2, tag `card-mystery-decline`.

### 5.6 "I want to cancel a remittance"
Only possible while status is `PENDING_PARTNER_SUBMIT`. After that, it's one-way. Be clear, don't promise a refund you can't deliver.

### 5.7 "Someone used my account"
P1. Immediately:
1. Lock wallet via Admin.
2. Freeze card via NymCard.
3. Open fraud ticket, attach last 30 days of transactions.
4. Tell user: we'll call back within 1 hour.
5. Never discuss investigation details on first call.

### 5.8 "I forgot my PIN"
Two-factor verification per §4, then trigger PIN reset flow in-app. Never share a PIN over any channel.

### 5.9 "My employer hasn't paid salary"
Not a FlexPay issue by default, but:
1. Check if employer is on our EWA program.
2. If yes, show expected disbursement date.
3. If salary is overdue, log and escalate to B2B CS — do not involve worker in dispute.

### 5.10 "EWA draw failed"
- Check eligibility flags: accrual > 0, no outstanding prior draw, employer active.
- If employer suspended, explain politely and offer loan option if eligible.

### 5.11 "Loan application denied"
Never give the model's features. Use approved language:
> "Our system evaluated several factors and couldn't approve this time. You can reapply in 30 days. Keeping your wallet active and paying bills on time helps."

Offer: savings via Hafiza as alternative.

### 5.12 "Hafiza circle member not paying"
- Flag to default-protection workflow.
- Pool covers missed payment to next-in-line.
- Delinquent member's wallet is frozen pending collection.

### 5.13 "I want to close my account"
Confirm via OTP. Run closure workflow:
1. Block new transactions.
2. Wait 30 days for chargebacks.
3. Refund residual balance to verified bank.
4. Retain records per CBUAE retention (7 y), then purge PII.

### 5.14 "Voice command didn't understand me"
- Confirm language setting.
- Ask to retry in quieter environment.
- Log transcript ID; if repeated misrecognition, tag `voice-model-quality`.

### 5.15 "Notification not received"
- Check OneSignal delivery status.
- Confirm device token fresh (user reinstalled?).
- Offer SMS fallback.

### 5.16 "Bill payment marked paid but utility says unpaid"
P2. Pull integration log. If we settled, give reference and direct user to utility with reference. If we didn't, refund and apologize.

### 5.17 "Referral reward not credited"
Check referral state machine. Rewards release only after referee's first qualifying transaction. If stuck > 72 h, escalate to growth ops.

### 5.18 "Exchange rate is worse than Google's"
Educate: Google shows mid-market. We charge corridor margin (disclosed pre-confirmation). If rate shown pre-confirmation ≠ rate charged, that's a P1 — escalate to FX ops.

### 5.19 "I'm being harassed about a loan I didn't take"
Treat as potential identity theft. P1. Lock account, open fraud case, inform compliance.

### 5.20 "App crashed"
- Capture OS, app version, feature used.
- Pull Sentry trace if possible.
- Offer workaround; ticket → mobile team.

## 6. Compliance Red Flags (stop-and-escalate)

Escalate immediately, do not coach:
- User mentions cash deposit > AED 10K
- Requests to transfer to a different name "for tax reasons"
- Questions about how structuring rules work
- Third parties offering to "sell" their account
- Screenshots of law enforcement letters
- Claims of political or diplomatic status

Channel: `#compliance-hotline` (Slack) + email `compliance@flexpay.ae`.

## 7. Tone Guide

- **Language:** match the user's. If unsure, ask.
- **Form of address:** first name + respectful honorific in Arabic/Urdu.
- **Do not** say "calm down", "as I said", "unfortunately that's policy".
- **Do** say "I hear you", "let me check that now", "here's exactly what we'll do".

## 8. Data Handling

- Never paste raw Emirates ID numbers, full PAN, CVV, OTPs in tickets.
- Mask in ticket notes: `784-****-*******-*`.
- Screen-share only when the agent's local recording is off.
- All calls recorded and stored in `me-central-1`; retained 12 months.

## 9. Escalation Matrix

| Issue | Primary owner | Backup |
|---|---|---|
| Ledger drift, missing funds | Finance on-call | CFO |
| Fraud / account takeover | Fraud ops | Head of Risk |
| Card issues | NymCard liaison | Product |
| Remittance partner failure | Remittance ops | Product |
| Outage / errors spiking | SRE on-call | CTO |
| CBUAE / regulator inquiry | Compliance Officer | CEO |

## 10. Shift Checklist

**Start of shift**
- Read overnight handoff note.
- Scan Sentry for new top issues.
- Review P1/P2 backlog, take ownership.

**End of shift**
- Write handoff: open P1/P2, pending escalations, anything unusual.
- Close any resolved tickets with root-cause tag.
- Drop KPIs in `#support-metrics`: AHT, CSAT, backlog.

## 11. Quick Reference — Key Numbers

| Limit | Value |
|---|---|
| Tier 1 monthly in/out | AED 5,000 |
| Tier 2 monthly in/out | AED 25,000 |
| Tier 3 monthly in/out | AED 100,000 |
| EWA max draw | 50% of accrued |
| Remittance per-txn cap (Tier 3) | AED 50,000 |
| Hafiza max circle size | 20 |
| Loan range | AED 500 – 10,000 |
| AML structuring threshold | AED 9,000 in 24 h over 3+ txns |

## 12. Glossary

- **EWA** — Earned Wage Access
- **Hafiza** — Rotating savings circle
- **WPS** — UAE Wage Protection System
- **SVF** — Stored Value Facility (CBUAE license class)
- **STR** — Suspicious Transaction Report
- **Tier** — KYC verification level (0–3)
- **UTR / MTCN** — Remittance reference numbers
