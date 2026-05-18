/**
 * Invariants that must hold for the WPS routing plane.
 *
 * These are the legal/regulatory framing of "this is wage routing, not
 * lending" encoded as runtime checks. They MUST be enforced inside the
 * settlement Prisma `$transaction`. Property-based tests at
 * `tests/payroll-routing.invariants.test.ts` exercise them.
 *
 *   I1 — advance.amount <= intent.accruedAmount
 *        The user can never receive (or owe) more than they have
 *        already earned. Without this, the product is consumer
 *        credit, not earned-wage access.
 *
 *   I2 — advance.cycleId === intent.cycleId
 *        Settlement always lands inside the same payroll cycle the
 *        advance was bound to. Cross-cycle settlement re-introduces
 *        balance-sheet risk and breaks the regulatory framing.
 *
 *   I3 — Σ LedgerEntry.delta per (employee, cycle) === 0
 *        After a cycle is settled, the ledger nets to zero for every
 *        employee. Any non-zero residual is drift — surfaced by the
 *        reconciliation worker, which trips the circuit breaker.
 *
 *   I4 — advance.currency === intent.currency
 *        Cross-currency settlement is out of scope at the routing
 *        layer. Remittance lives in a separate plane.
 *
 *   I5 — advance.status transitions follow the FSM
 *        REQUESTED → APPROVED → RESERVED → SETTLED
 *                     ↘ REJECTED         ↘ FAILED
 *        No back-transitions; FAILED/SETTLED are terminal.
 */

import type { Advance, PayrollIntent, AdvanceStatus } from '@prisma/client';

/** Thrown when any invariant check fails. Always trips the circuit breaker. */
export class InvariantViolation extends Error {
  constructor(
    public readonly invariant: 'I1' | 'I2' | 'I3' | 'I4' | 'I5',
    public readonly context: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? `Invariant ${invariant} violated`);
    this.name = 'InvariantViolation';
  }
}

export function checkAdvanceAgainstIntent(advance: Advance, intent: PayrollIntent): void {
  // I2 first — checking I1 against the wrong intent is meaningless.
  if (advance.cycleId !== intent.cycleId) {
    throw new InvariantViolation('I2', { advanceId: advance.id, intentId: intent.id });
  }
  if (advance.currency !== intent.currency) {
    throw new InvariantViolation('I4', {
      advanceId: advance.id,
      advanceCurrency: advance.currency,
      intentCurrency: intent.currency,
    });
  }
  if (advance.amount > intent.accruedAmount) {
    throw new InvariantViolation('I1', {
      advanceId: advance.id,
      advanceAmount: advance.amount,
      accruedAmount: intent.accruedAmount,
    });
  }
}

const VALID_FORWARD: Record<AdvanceStatus, AdvanceStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['RESERVED', 'REJECTED', 'FAILED'],
  RESERVED: ['SETTLED', 'FAILED'],
  SETTLED: [],
  REJECTED: [],
  FAILED: [],
};

export function checkAdvanceFSM(from: AdvanceStatus, to: AdvanceStatus): void {
  if (!VALID_FORWARD[from].includes(to)) {
    throw new InvariantViolation('I5', { from, to });
  }
}
