# FlexPay Threat Model (STRIDE)

**Scope:** production system, all surfaces (mobile, web admin, public API, admin API, n8n, data stores, integrations).
**Method:** STRIDE per trust boundary; risks rated Likelihood × Impact on 1–5 scale; anything ≥ 15 is tracked as a blocker.
**Owner:** Head of Security. Reviewed quarterly and on any material architecture change.

---

## 1. Trust Boundaries

```
  ┌──── Internet ────┐      ┌── Third parties ──┐
  │ Mobile  Web Admin│      │ NymCard Sumsub ...│
  └─────┬──────┬─────┘      └────────┬──────────┘
        │      │                     │
   ─────▼──────▼─────────────────────▼────── TB1: Edge (WAF, API GW)
        │
   ─────▼────────────── TB2: App plane (FastAPI, services)
        │
   ─────▼────────────── TB3: Data plane (Postgres, Redis, S3, KMS)
        │
   ─────▼────────────── TB4: Ops plane (CI/CD, bastion, observability)
```

## 2. Key Assets

1. Customer funds (ledger integrity)
2. PII (Emirates ID, phone, address)
3. Card data (tokenized at NymCard; we hold references only)
4. Authentication secrets (JWT signing key, refresh tokens)
5. Credit model and training data
6. Audit log (regulator-grade evidence)

## 3. STRIDE by Component

### 3.1 Mobile app (TB1 → TB2)

| Threat | Description | Mitigation | Residual risk |
|---|---|---|---|
| **S** Spoofing | Attacker forges device / bypasses biometric | Device attestation (Play Integrity / DeviceCheck), binding refresh token to device pubkey, biometric unlock for sensitive ops | Low |
| **T** Tampering | Repackaged APK injects code | Integrity check on startup; refuse if signature differs; RASP (root/jailbreak detection) | Medium |
| **R** Repudiation | User denies a transaction | Every action signed with device key + server-side audit log | Low |
| **I** Info disclosure | Screen recording in background | `FLAG_SECURE` / `isCaptured`; mask PAN/balance on app switch | Medium |
| **D** DoS | OTP flood to exhaust SMS budget | Per-phone rate limit (3/hour), exponential backoff, captcha after N | Low |
| **E** Elevation | JWT tampering | RS256 with HSM-stored private key; jwks rotation quarterly | Low |

### 3.2 Public API / gateway

| Threat | Mitigation |
|---|---|
| Credential stuffing | Per-account lockout, breached-password check (HIBP-k-anon), adaptive MFA |
| Parameter tampering | Server-side policy enforcement; never trust client amounts or limits |
| Enumeration (user, beneficiary) | Opaque IDs (ULIDs), no "user not found" leakage — constant-time response |
| Replay | Idempotency keys for writes; timestamp + nonce for webhooks |
| SSRF via user-provided URLs (e.g., employer webhook) | Egress via proxy that resolves and rejects private ranges |

### 3.3 Services & ledger (TB2)

| Threat | Mitigation |
|---|---|
| Race on balance | Postgres row-level locks + serializable isolation for ledger writes; idempotency cache |
| Partial failure in remittance | Saga pattern with compensation; reconciliation job every 5 min |
| Credit model manipulation | Input feature clipping, outlier detection, audit of feature drift; shadow model |
| Prompt injection in voice | Strict intent schema; deterministic dispatcher — LLM never executes actions directly |

### 3.4 Data plane (TB3)

| Threat | Mitigation |
|---|---|
| Insider DB dump | Principle of least privilege; DB access via bastion + session recording; column-level encryption on EID |
| Key exposure | Envelope encryption with KMS CMKs; no plaintext DEKs at rest; rotate CMKs annually |
| Backup exfiltration | Backups encrypted with separate KMS key; S3 bucket access denied except to restore role |
| Lateral via Redis | Redis on private subnet, ACL per service, TLS in transit, no `FLUSHALL`-capable user on app role |

### 3.5 Ops plane (TB4)

| Threat | Mitigation |
|---|---|
| CI/CD compromise (supply chain) | Signed commits; OIDC-based cloud auth from GH Actions; branch protection + required reviews; Cosign on container images |
| Dependency poisoning | Pinned versions + lockfiles; Dependabot; `pip-audit` and `npm audit` in CI |
| Stolen admin session | SSO with FIDO2, short session TTL, IP allowlist, per-action re-auth for high-risk actions |
| Logs leaking PII | Structured logging with field-level redaction; reviewed per release |

### 3.6 Third-party integrations

| Vendor | Threat | Mitigation |
|---|---|---|
| NymCard | Forged webhook | HMAC signature verification + replay window |
| Sumsub | Fake verdict | Signed webhook; re-fetch verdict via pull API before acting |
| Wise/Ripple | Credential theft on our side | Secrets in AWS Secrets Manager; rotation every 90 days; mTLS where offered |
| OpenAI/Whisper | Data leakage in prompts | Redact PII before sending; contractual DPA; default to on-prem Whisper for audio |

## 4. High-Impact Scenarios (top 5)

### T-1: Ledger drift from double processing
- **Vector:** partner webhook re-delivered; we credit twice.
- **Mitigation:** idempotency on (externalRef, eventType); reconciliation job catches within 5 min.
- **Detection:** daily trial balance; alerts at > AED 100 drift.

### T-2: Credit model bias
- **Vector:** alt-data features correlate with protected attributes.
- **Mitigation:** fairness audit pre-launch; continuous monitoring (demographic parity, equalized odds) via shadow model.
- **Detection:** monthly audit report; auto-freeze new approvals if drift > threshold.

### T-3: Account takeover via SIM swap
- **Vector:** attacker convinces telco to port number; intercepts OTP.
- **Mitigation:** secondary device binding, high-risk action requires second factor, bank-name verification for new device.
- **Detection:** anomaly on device change + new high-value transfer.

### T-4: Insider exfiltrates KYC documents
- **Vector:** support agent downloads batch of EID images from Admin.
- **Mitigation:** bulk download disabled; single-item view only; watermarking; DLP on egress.
- **Detection:** alert on > N EID views per agent per hour.

### T-5: Remittance partner outage
- **Vector:** Wise down during high-volume day; funds stuck.
- **Mitigation:** Ripple as secondary; auto-failover for corridors both support; cash-buffered trust account.
- **Detection:** synthetic transaction every 5 min per corridor.

## 5. Assumptions & Out-of-Scope

- PCI DSS scope reduction via full tokenization at NymCard (no PAN on FlexPay servers).
- Users' own device security is their responsibility; we defend against common mobile malware but do not claim hardened-device protection.
- Physical security of AWS data centers inherited from AWS SoC 2.
- Quantum-resistant crypto is not in scope for v1.

## 6. Open Items

1. External pentest — scope + vendor TBD.
2. Bug bounty — launch with HackerOne after first production quarter.
3. Red-team exercise against admin plane — planned Q3 after beta.
4. Supply-chain SBOM signing — in roadmap.

## 7. Change Log

| Date | Author | Change |
|---|---|---|
| 2026-04-18 | Security | Initial draft |
