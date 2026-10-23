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
 * Pure + exhaustively testable. `computeAvailableLimit` is the single-
 * advance form; `computeEligibility` (below) is the cumulative form that
 * reserveAdvance (inside the locked tx) and the balance view both use.
 * The mobile app binds to the server-computed figure.
 */

import { AdvanceStatus, type Prisma } from '@prisma/client';

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

// ───────────────────────────────────────────────────────────────────
// Cumulative eligibility (TASK-009)
// ───────────────────────────────────────────────────────────────────

/**
 * Advances that draw on a cycle's capacity: every advance that was, or
 * may still be, credited to the wallet. REQUESTED / APPROVED are pending
 * reservations, RESERVED is outstanding, SETTLED was recovered from this
 * cycle's wages, and a FAILED advance that had been reserved was credited
 * with no clawback in the codebase. Only REJECTED — and FAILED without a
 * reservation — never paid out.
 */
export function consumesEligibility(advance: { status: AdvanceStatus; reservedAt: Date | null }): boolean {
  if (advance.status === AdvanceStatus.REJECTED) return false;
  if (advance.status === AdvanceStatus.FAILED) return advance.reservedAt !== null;
  return true;
}

/** Prisma filter selecting exactly the advances `consumesEligibility` counts. */
export const CONSUMING_ADVANCE_WHERE: Prisma.AdvanceWhereInput = {
  OR: [
    {
      status: {
        in: [AdvanceStatus.REQUESTED, AdvanceStatus.APPROVED, AdvanceStatus.RESERVED, AdvanceStatus.SETTLED],
      },
    },
    { status: AdvanceStatus.FAILED, reservedAt: { not: null } },
  ],
};

/** An advance already drawn against the cycle. */
export interface ConsumedAdvance {
  amount: number;
  fee: number;
}

export interface EligibilityInput {
  /** DCSE per-worker ceiling — a cumulative cap per cycle, not per request. */
  dcseLimit: number;
  /** Server-side accrued wages for the cycle (PayrollIntent). */
  accruedAmount: number;
  /** 1 normally; FAILSAFE_ACCRUED_CAP_FRACTION while the cohort failsafe is tripped. */
  accruedCapFraction: number;
  hrLagBufferPercent: number;
  /** Fee the new advance would carry. */
  fee: number;
  /** Every consuming advance already in the cycle. */
  consumed: readonly ConsumedAdvance[];
}

export interface Eligibility {
  /** Σ amount may never exceed this: accrued wages, or the failsafe share. */
  accruedCap: number;
  /** Σ (amount + fee) may never exceed this buffered ceiling. */
  ceiling: number;
  /** Σ amount already advanced in the cycle. */
  advancedAmount: number;
  /** Σ (amount + fee) already drawn in the cycle. */
  drawnTotal: number;
  /** Largest amount one more advance may take now. */
  remaining: number;
}

const BPS = 10_000;

/** AED → integer fils. Advance amounts are validated to 2 decimals, so this is exact. */
export function toFils(aed: number): number {
  return Math.round(aed * 100);
}

/**
 * How much more this worker may draw in this cycle, over ALL consuming
 * advances — never a per-request figure:
 *
 *   accruedCap = accrued × accruedCapFraction             (I1 / failsafe)
 *   ceiling    = MIN(dcseLimit, accruedCap) × (1 − buffer)
 *   Σ amount ≤ accruedCap  and  Σ (amount + fee) ≤ ceiling
 *   remaining  = MAX(0, ceiling − Σ(amount + fee) − fee)
 *
 * With nothing drawn yet this matches computeAvailableLimit over the
 * failsafe-capped base, except that caps round down to the fil instead of
 * to the nearest. Integer fils throughout, so repeated Float additions
 * can never step past a boundary.
 */
export function computeEligibility(input: EligibilityInput): Eligibility {
  const nonNegative = (aed: number) => Math.max(0, toFils(aed));
  const accruedFils = nonNegative(input.accruedAmount);
  const capBps = Math.min(BPS, Math.max(0, Math.round(input.accruedCapFraction * BPS)));
  const accruedCapFils = Math.floor((accruedFils * capBps) / BPS);
  const baseFils = Math.min(nonNegative(input.dcseLimit), accruedCapFils);
  const bufferBps = Math.round(normaliseBuffer(input.hrLagBufferPercent) * BPS);
  const ceilingFils = Math.floor((baseFils * (BPS - bufferBps)) / BPS);

  let advancedFils = 0;
  let feesFils = 0;
  for (const advance of input.consumed) {
    advancedFils += nonNegative(advance.amount);
    feesFils += nonNegative(advance.fee);
  }
  const drawnFils = advancedFils + feesFils;
  const remainingFils = Math.max(
    0,
    Math.min(ceilingFils - drawnFils - nonNegative(input.fee), accruedCapFils - advancedFils),
  );

  return {
    accruedCap: accruedCapFils / 100,
    ceiling: ceilingFils / 100,
    advancedAmount: advancedFils / 100,
    drawnTotal: drawnFils / 100,
    remaining: remainingFils / 100,
  };
}
