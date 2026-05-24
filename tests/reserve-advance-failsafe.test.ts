/**
 * reserveAdvance × cohort failsafe — end-to-end enforcement test.
 *
 * Proves the audit fix: when the employer cohort's canary failsafe is
 * active, reserveAdvance caps the worker at 20% of accrued INSIDE the
 * locked settlement transaction. This is the circuit breaker that was
 * previously detection-only.
 *
 * The whole Prisma $transaction is mocked: $transaction invokes the
 * callback with a stub tx whose reads we control. We assert the
 * negative path (over-cap → throw) and the positive path (under-cap →
 * advance written).
 */

jest.mock('@config/prisma', () => {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    employee: { findUnique: jest.fn(), update: jest.fn() },
    complianceIncident: { findFirst: jest.fn().mockResolvedValue(null) },
    payrollCycle: { findUnique: jest.fn() },
    payrollIntent: { findUnique: jest.fn() },
    company: { findUnique: jest.fn() },
    advance: { create: jest.fn() },
    ledgerEntry: { create: jest.fn() },
  };
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from '@config/prisma';
import { reserveAdvance } from '../src/modules/payroll-routing/payroll-routing.service';

const mocked = prisma as unknown as {
  __tx: {
    $queryRaw: jest.Mock;
    employee: { findUnique: jest.Mock; update: jest.Mock };
    complianceIncident: { findFirst: jest.Mock };
    payrollCycle: { findUnique: jest.Mock };
    payrollIntent: { findUnique: jest.Mock };
    company: { findUnique: jest.Mock };
    advance: { create: jest.Mock };
    ledgerEntry: { create: jest.Mock };
  };
};

const baseArgs = {
  employeeId: 'emp-1',
  cycleId: 'cyc-1',
  fee: 10,
  dcseModelVersion: 'v1',
  dcseLimitAtReq: 5000,
  dcseRiskScoreAtReq: 0.7,
};

function seedCommonReads(opts: {
  failsafeActive: boolean;
  accrued: number;
  hrLagBufferPercent?: number;
}) {
  mocked.__tx.$queryRaw.mockResolvedValue([]);
  // compliance guard: active employee, no blocking incident
  mocked.__tx.employee.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  mocked.__tx.complianceIncident.findFirst.mockResolvedValue(null);
  mocked.__tx.payrollCycle.findUnique.mockResolvedValue({
    id: 'cyc-1',
    companyId: 'co-1',
    status: 'OPEN',
  });
  mocked.__tx.payrollIntent.findUnique.mockResolvedValue({
    id: 'intent-1',
    cycleId: 'cyc-1',
    employeeId: 'emp-1',
    accruedAmount: opts.accrued,
    currency: 'AED',
  });
  mocked.__tx.company.findUnique.mockResolvedValue({
    ewaFailsafeActive: opts.failsafeActive,
    hrLagBufferPercent: opts.hrLagBufferPercent ?? 0,
  });
}

beforeEach(() => jest.clearAllMocks());

describe('reserveAdvance — cohort failsafe cap', () => {
  it('REJECTS an advance above 20% of accrued when the cohort failsafe is active', async () => {
    seedCommonReads({ failsafeActive: true, accrued: 1000 });
    // 300 > 200 (= 20% of 1000) → must be capped
    await expect(reserveAdvance({ ...baseArgs, amount: 300 })).rejects.toMatchObject({
      code: 'COHORT_FAILSAFE_CAP',
    });
    // No advance row should have been written.
    expect(mocked.__tx.advance.create).not.toHaveBeenCalled();
  });

  it('ALLOWS an advance at or below 20% of accrued when the failsafe is active', async () => {
    seedCommonReads({ failsafeActive: true, accrued: 1000 });
    mocked.__tx.advance.create.mockResolvedValue({ id: 'adv-1', amount: 150 });
    mocked.__tx.ledgerEntry.create.mockResolvedValue({});
    mocked.__tx.employee.update.mockResolvedValue({});

    // 150 <= 200 → allowed
    const advance = await reserveAdvance({ ...baseArgs, amount: 150 });
    expect(advance).toMatchObject({ id: 'adv-1' });
    expect(mocked.__tx.advance.create).toHaveBeenCalled();
  });

  it('ALLOWS full accrued advance when the failsafe is INACTIVE (normal I1 ceiling)', async () => {
    seedCommonReads({ failsafeActive: false, accrued: 1000 });
    mocked.__tx.advance.create.mockResolvedValue({ id: 'adv-2', amount: 900 });
    mocked.__tx.ledgerEntry.create.mockResolvedValue({});
    mocked.__tx.employee.update.mockResolvedValue({});

    // 900 <= 1000 accrued, no failsafe → allowed even though > 20%
    const advance = await reserveAdvance({ ...baseArgs, amount: 900 });
    expect(advance).toMatchObject({ id: 'adv-2' });
  });

  it('still enforces I1 first: rejects amount > accrued regardless of failsafe', async () => {
    seedCommonReads({ failsafeActive: false, accrued: 1000 });
    await expect(reserveAdvance({ ...baseArgs, amount: 1500 })).rejects.toMatchObject({
      code: 'AMOUNT_EXCEEDS_ACCRUED',
    });
  });
});

describe('reserveAdvance — HR data-lag buffer', () => {
  // baseArgs: fee 10, dcseLimitAtReq 5000.
  it('REJECTS an advance above the 10%-buffered ceiling (900 → cap 890 after fee)', async () => {
    seedCommonReads({ failsafeActive: false, accrued: 1000, hrLagBufferPercent: 0.1 });
    // MIN(5000,1000)×0.9 − 10 = 890. 900 > 890 → rejected.
    await expect(reserveAdvance({ ...baseArgs, amount: 900 })).rejects.toMatchObject({
      code: 'EXCEEDS_AVAILABLE_LIMIT',
    });
    expect(mocked.__tx.advance.create).not.toHaveBeenCalled();
  });

  it('ALLOWS an advance at or below the 10%-buffered ceiling', async () => {
    seedCommonReads({ failsafeActive: false, accrued: 1000, hrLagBufferPercent: 0.1 });
    mocked.__tx.advance.create.mockResolvedValue({ id: 'adv-buf', amount: 850 });
    mocked.__tx.ledgerEntry.create.mockResolvedValue({});
    mocked.__tx.employee.update.mockResolvedValue({});
    // 850 <= 890 → allowed
    const advance = await reserveAdvance({ ...baseArgs, amount: 850 });
    expect(advance).toMatchObject({ id: 'adv-buf' });
  });

  it('a 0% buffer allows the full accrued amount minus fee (990 on 1,000)', async () => {
    seedCommonReads({ failsafeActive: false, accrued: 1000, hrLagBufferPercent: 0 });
    mocked.__tx.advance.create.mockResolvedValue({ id: 'adv-nobuf', amount: 990 });
    mocked.__tx.ledgerEntry.create.mockResolvedValue({});
    mocked.__tx.employee.update.mockResolvedValue({});
    // MIN(5000,1000)×1.0 − 10 = 990 → allowed at the boundary.
    const advance = await reserveAdvance({ ...baseArgs, amount: 990 });
    expect(advance).toMatchObject({ id: 'adv-nobuf' });
  });

  it('I1 still binds tightly with the buffer present: amount > accrued is rejected first', async () => {
    seedCommonReads({ failsafeActive: false, accrued: 1000, hrLagBufferPercent: 0.1 });
    await expect(reserveAdvance({ ...baseArgs, amount: 1500 })).rejects.toMatchObject({
      code: 'AMOUNT_EXCEEDS_ACCRUED',
    });
  });
});
