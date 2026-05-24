/**
 * Cohort canary failsafe — audit-fix tests (STRATEGY §C.3).
 *
 * Covers:
 *   • effectiveAccruedCap pure math (normal vs 20% failsafe)
 *   • two-person clear rule (distinct, non-empty approvers)
 *   • trip idempotency (already-active short-circuit, no double audit)
 *   • syncCohortFailsafesFromCanary trips each breaching cohort
 */

jest.mock('@config/prisma', () => {
  const tx = {
    company: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return {
    prisma: {
      company: { findUnique: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from '@config/prisma';
import {
  effectiveAccruedCap,
  FAILSAFE_ACCRUED_CAP_FRACTION,
  tripCohortFailsafe,
  clearCohortFailsafe,
  syncCohortFailsafesFromCanary,
} from '../src/modules/ops-intel/cohort-failsafe.service';
import { AppError } from '../src/shared/utils/errors';

const mocked = prisma as unknown as {
  company: { findUnique: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
  __tx: { company: { update: jest.Mock }; auditLog: { create: jest.Mock } };
};

beforeEach(() => jest.clearAllMocks());

// ───────────────────────────────────────────────────────────────────
// Pure cap math
// ───────────────────────────────────────────────────────────────────

describe('effectiveAccruedCap', () => {
  it('returns the full accrued amount when failsafe is inactive (I1 ceiling)', () => {
    expect(effectiveAccruedCap(1700, false)).toBe(1700);
  });

  it('caps at 20% of accrued when failsafe is active', () => {
    expect(effectiveAccruedCap(1700, true)).toBe(340); // 0.20 × 1700
  });

  it('uses the documented 20% constant', () => {
    expect(FAILSAFE_ACCRUED_CAP_FRACTION).toBe(0.2);
  });

  it('rounds to fils precision', () => {
    expect(effectiveAccruedCap(1001, true)).toBe(200.2);
  });
});

// ───────────────────────────────────────────────────────────────────
// Two-person clear rule
// ───────────────────────────────────────────────────────────────────

describe('clearCohortFailsafe — two-person rule', () => {
  it('rejects identical approvers', async () => {
    await expect(
      clearCohortFailsafe('co-1', { approverA: 'ops-1', approverB: 'ops-1' }),
    ).rejects.toMatchObject({ code: 'TWO_PERSON_RULE' });
  });

  it('rejects a missing second approver', async () => {
    await expect(
      clearCohortFailsafe('co-1', { approverA: 'ops-1', approverB: '' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('clears with two distinct approvers + writes audit trail', async () => {
    mocked.company.findUnique.mockResolvedValue({ ewaFailsafeActive: true });
    mocked.__tx.company.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    await clearCohortFailsafe('co-1', { approverA: 'ops-1', approverB: 'ops-2', note: 'recovered' });

    expect(mocked.__tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'co-1' },
        data: expect.objectContaining({ ewaFailsafeActive: false }),
      }),
    );
    expect(mocked.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'COHORT_FAILSAFE_CLEARED' }),
      }),
    );
  });

  it('is a no-op when the cohort is already clear', async () => {
    mocked.company.findUnique.mockResolvedValue({ ewaFailsafeActive: false });
    await clearCohortFailsafe('co-1', { approverA: 'a', approverB: 'b' });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// Trip + sync
// ───────────────────────────────────────────────────────────────────

describe('tripCohortFailsafe', () => {
  it('trips an inactive cohort and writes the audit row', async () => {
    mocked.company.findUnique.mockResolvedValue({ ewaFailsafeActive: false });
    mocked.__tx.company.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});

    const r = await tripCohortFailsafe('co-1', { reason: 'CANARY', defaultRatio: 0.021 });
    expect(r.tripped).toBe(true);
    expect(mocked.__tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ewaFailsafeActive: true }) }),
    );
  });

  it('is idempotent — an already-active cohort refreshes ratio without re-logging a trip', async () => {
    mocked.company.findUnique.mockResolvedValue({ ewaFailsafeActive: true });
    mocked.company.update.mockResolvedValue({});

    const r = await tripCohortFailsafe('co-1', { reason: 'CANARY', defaultRatio: 0.03 });
    expect(r.tripped).toBe(false);
    expect(r.alreadyActive).toBe(true);
    expect(mocked.$transaction).not.toHaveBeenCalled(); // no new audit txn
  });
});

describe('syncCohortFailsafesFromCanary', () => {
  it('trips each breaching cohort and counts newly-tripped', async () => {
    // co-1 inactive (will trip), co-2 already active (idempotent).
    mocked.company.findUnique
      .mockResolvedValueOnce({ ewaFailsafeActive: false })
      .mockResolvedValueOnce({ ewaFailsafeActive: true });
    mocked.__tx.company.update.mockResolvedValue({});
    mocked.__tx.auditLog.create.mockResolvedValue({});
    mocked.company.update.mockResolvedValue({});

    const r = await syncCohortFailsafesFromCanary([
      { companyId: 'co-1', defaultRatio: 0.02 },
      { companyId: 'co-2', defaultRatio: 0.018 },
    ]);
    expect(r.trippedCount).toBe(1);
  });
});
