/**
 * Property-based invariant tests for the WPS routing plane.
 *
 * These tests do NOT touch a real Prisma client. They exercise the
 * pure invariant functions in `src/modules/payroll-routing/invariants.ts`
 * against fuzzed inputs from fast-check.
 *
 * The Prisma-integration tests (settling against a real Postgres) live
 * under tests/e2e or are deferred to the CI smoke phase — they require
 * the full docker-compose stack.
 */

import * as fc from 'fast-check';
import {
  InvariantViolation,
  checkAdvanceAgainstIntent,
  checkAdvanceFSM,
} from '../src/modules/payroll-routing/invariants';
import { AdvanceStatus } from '@prisma/client';

const advanceArb = (overrides: Partial<{ cycleId: string; amount: number; currency: string }> = {}) =>
  fc
    .record({
      id: fc.uuid(),
      employeeId: fc.uuid(),
      cycleId: fc.uuid(),
      amount: fc.float({ noNaN: true, min: Math.fround(0), max: Math.fround(10000) }),
      fee: fc.float({ noNaN: true, min: Math.fround(0), max: Math.fround(50) }),
      currency: fc.constant('AED'),
      status: fc.constant<AdvanceStatus>(AdvanceStatus.RESERVED),
      failureReason: fc.constant(null),
      requestedAt: fc.constant(new Date()),
      approvedAt: fc.constant(new Date()),
      reservedAt: fc.constant(new Date()),
      settledAt: fc.constant(null),
      dcseModelVersion: fc.constant('v1.0.0'),
      dcseLimitAtReq: fc.float({ noNaN: true, min: Math.fround(0), max: Math.fround(10000) }),
      dcseRiskScoreAtReq: fc.float({ noNaN: true, min: Math.fround(0), max: Math.fround(1) }),
    })
    // Force overrides at the end so caller can pin any field.
    .map((a) => ({ ...a, ...overrides }) as Parameters<typeof checkAdvanceAgainstIntent>[0]);

const intentArb = (overrides: Partial<{ cycleId: string; accruedAmount: number; currency: string }> = {}) =>
  fc
    .record({
      id: fc.uuid(),
      cycleId: fc.uuid(),
      employeeId: fc.uuid(),
      grossAmount: fc.float({ noNaN: true, min: Math.fround(0), max: Math.fround(20000) }),
      accruedAmount: fc.float({ noNaN: true, min: Math.fround(0), max: Math.fround(20000) }),
      currency: fc.constant('AED'),
      status: fc.constant<'PENDING'>('PENDING'),
      fileLineHash: fc.string({ minLength: 8, maxLength: 8 }),
      routedAt: fc.constant(null),
      createdAt: fc.constant(new Date()),
    })
    .map((i) => ({ ...i, ...overrides }) as Parameters<typeof checkAdvanceAgainstIntent>[1]);

describe('checkAdvanceAgainstIntent', () => {
  it('I1 — passes when advance.amount ≤ intent.accruedAmount and cycles match', () => {
    fc.assert(
      fc.property(fc.float({ noNaN: true, min: Math.fround(0), max: Math.fround(1000) }), (amount) => {
        const cycleId = 'cycle-A';
        // Generate one of each pinned to the same cycle, with accrued > amount.
        const advance = fc.sample(advanceArb({ cycleId, amount, currency: 'AED' }), 1)[0];
        const intent = fc.sample(intentArb({ cycleId, accruedAmount: amount + 1, currency: 'AED' }), 1)[0];
        expect(() => checkAdvanceAgainstIntent(advance, intent)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('I1 — throws when advance.amount > intent.accruedAmount', () => {
    fc.assert(
      fc.property(
        // fast-check v4 requires 32-bit float bounds via Math.fround.
        fc.float({ noNaN: true, min: Math.fround(1), max: Math.fround(1000) }),
        fc.float({ noNaN: true, min: Math.fround(0.01), max: Math.fround(0.99) }),
        (amount, ratio) => {
          const cycleId = 'cycle-A';
          const advance = fc.sample(advanceArb({ cycleId, amount, currency: 'AED' }), 1)[0];
          const intent = fc.sample(
            intentArb({ cycleId, accruedAmount: amount * ratio, currency: 'AED' }),
            1,
          )[0];
          let caught: unknown;
          try {
            checkAdvanceAgainstIntent(advance, intent);
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(InvariantViolation);
          expect((caught as InvariantViolation).invariant).toBe('I1');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('I2 — throws when advance.cycleId !== intent.cycleId', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (c1, c2) => {
        fc.pre(c1 !== c2);
        const advance = fc.sample(advanceArb({ cycleId: c1, amount: 0, currency: 'AED' }), 1)[0];
        const intent = fc.sample(intentArb({ cycleId: c2, accruedAmount: 9999, currency: 'AED' }), 1)[0];
        let caught: unknown;
        try {
          checkAdvanceAgainstIntent(advance, intent);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(InvariantViolation);
        expect((caught as InvariantViolation).invariant).toBe('I2');
      }),
      { numRuns: 50 },
    );
  });

  it('I4 — throws on currency mismatch', () => {
    const advance = fc.sample(advanceArb({ cycleId: 'X', amount: 100, currency: 'AED' }), 1)[0];
    const intent = fc.sample(intentArb({ cycleId: 'X', accruedAmount: 999, currency: 'SAR' }), 1)[0];
    expect(() => checkAdvanceAgainstIntent(advance, intent)).toThrow(InvariantViolation);
  });
});

describe('checkAdvanceFSM', () => {
  it('allows the canonical forward path', () => {
    const path: AdvanceStatus[] = [
      AdvanceStatus.REQUESTED,
      AdvanceStatus.APPROVED,
      AdvanceStatus.RESERVED,
      AdvanceStatus.SETTLED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => checkAdvanceFSM(path[i], path[i + 1])).not.toThrow();
    }
  });

  it('blocks backward transitions and terminal-state mutations', () => {
    expect(() => checkAdvanceFSM(AdvanceStatus.SETTLED, AdvanceStatus.RESERVED)).toThrow(
      InvariantViolation,
    );
    expect(() => checkAdvanceFSM(AdvanceStatus.SETTLED, AdvanceStatus.APPROVED)).toThrow(
      InvariantViolation,
    );
    expect(() => checkAdvanceFSM(AdvanceStatus.REJECTED, AdvanceStatus.SETTLED)).toThrow(
      InvariantViolation,
    );
    expect(() => checkAdvanceFSM(AdvanceStatus.FAILED, AdvanceStatus.SETTLED)).toThrow(
      InvariantViolation,
    );
  });

  it('allows REQUESTED → REJECTED', () => {
    expect(() => checkAdvanceFSM(AdvanceStatus.REQUESTED, AdvanceStatus.REJECTED)).not.toThrow();
  });

  it('allows RESERVED → FAILED (post-cycle invariant violation)', () => {
    expect(() => checkAdvanceFSM(AdvanceStatus.RESERVED, AdvanceStatus.FAILED)).not.toThrow();
  });
});
