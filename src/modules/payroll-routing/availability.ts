/**
 * EWA availability computation — the single source of truth for "how
 * much can this worker take right now".
 *
 * Composes the three ceilings the platform applies:
 *
 *   1. DCSE limit       — the credit engine's per-worker ceiling
 *   2. Accrued wages    — Invariant I1: never exceed earned wages
 *   3. HR-lag buffer    — structural haircut (Company.hrLagBufferPercent)
 *                         absorbing the HR-sync latency window
 *
 *   grossAvailable = MIN(dcseLimit, accruedAmount) × (1 − buffer)
 *   availableLimit = MAX(0, grossAvailable − transactionFee)
 *
 * Pure + exhaustively testable. Used by:
 *   • reserveAdvance (backend enforcement, inside the locked tx)
 *   • mobile-api getBalance (the figure shown in the app)
 * and mirrored verbatim by mobile/src/store/useMobileWalletStore.ts —
 * the formula MUST stay identical across surfaces (the constants are
 * duplicated, like the canary threshold, and pinned by tests).
 */

export interface AvailabilityInput {
  /** DCSE per-worker ceiling at request time. */
  dcseLimit: number;
  /** Employer-confirmed accrued wages this cycle (Invariant I1 base). */
  accruedAmount: number;
  /** Company.hrLagBufferPercent — fraction in [0,1). 0.10 = 10% haircut. */
  hrLagBufferPercent: number;
  /** Fixed processing fee deducted from the buffered ceiling. */
  fee: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Clamp the buffer into a safe [0, 1) range. A null/undefined/NaN
 * buffer is treated as 0 (no haircut) — fail-open on the buffer is
 * acceptable because I1 (accrued ceiling) still binds; fail-CLOSED
 * (treating unknown as 100% haircut) would wrongly zero every limit.
 * A buffer ≥ 1 is clamped to 0.99 so the limit never goes fully to
 * zero from a misconfigured 100% value while still flagging via the
 * near-zero result.
 */
export function normaliseBuffer(buffer: number | null | undefined): number {
  if (buffer === null || buffer === undefined || !Number.isFinite(buffer)) return 0;
  if (buffer < 0) return 0;
  if (buffer >= 1) return 0.99;
  return buffer;
}

/**
 * Compute the buffered, fee-net available EWA limit.
 *
 *   grossAvailable = MIN(dcseLimit, accruedAmount) × (1 − buffer)
 *   availableLimit = MAX(0, grossAvailable − fee)
 */
export function computeAvailableLimit(input: AvailabilityInput): number {
  const buffer = normaliseBuffer(input.hrLagBufferPercent);
  const base = Math.min(input.dcseLimit, input.accruedAmount);
  const grossAvailable = base * (1 - buffer);
  return Math.max(0, round2(grossAvailable - input.fee));
}
