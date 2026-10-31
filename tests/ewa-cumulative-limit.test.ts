/**
 * TASK-009 — cumulative EWA advance limits (unit level).
 *
 * The per-cycle ceiling must bind across EVERY advance a worker draws,
 * not per request. Covers the pure eligibility math (integer fils), the
 * consumption rule, reserveAdvance's cumulative gates and lock order, the
 * per-key idempotency guard, settleCycle's cycle lock and the balance
 * view. Real-PostgreSQL concurrency lives in
 * tests/e2e/ewa-cumulative-limit.e2e.test.ts.
 */

jest.mock('@config/prisma', () => {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    employee: { findUnique: jest.fn(), update: jest.fn() },
    complianceIncident: { findFirst: jest.fn().mockResolvedValue(null) },
    payrollCycle: { findUnique: jest.fn(), update: jest.fn() },
    payrollIntent: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    company: { findUnique: jest.fn() },
    advance: { create: jest.fn(), findMany: jest.fn() },
    ledgerEntry: { create: jest.fn() },
  };
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      advance: { findFirst: jest.fn(), findMany: jest.fn() },
      employee: { findUnique: jest.fn() },
      payrollCycle: { findUnique: jest.fn() },
      payrollIntent: { findFirst: jest.fn() },
      __tx: tx,
    },
  };
});

jest.mock('@config/redis', () => {
  const store = new Map<string, string>();
  const redisService = {
    setIfAbsent: jest.fn(async (key: string, value: string) => {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
  return { __esModule: true, default: redisService, redisService };
});

jest.mock('@modules/scoring/scoring.service', () => ({
  creditScoringService: { computeScore: jest.fn() },
}));

import { AdvanceStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { creditScoringService } from '@modules/scoring/scoring.service';
import {
  CONSUMING_ADVANCE_WHERE,
  computeAvailableLimit,
  computeEligibility,
  consumesEligibility,
} from '../src/modules/payroll-routing/availability';
import {
  EWA_FIXED_FEE,
  getEmployeeBalance,
  reserveAdvance,
  settleCycle,
} from '../src/modules/payroll-routing/payroll-routing.service';

const db = prisma as any;
const tx = db.__tx;
const store = (redisService as unknown as { __store: Map<string, string> }).__store;

const baseArgs = {
  employeeId: 'emp-1',
  cycleId: 'cyc-1',
  fee: EWA_FIXED_FEE,
  dcseModelVersion: 'v1',
  dcseLimitAtReq: 100_000,
  dcseRiskScoreAtReq: 0.7,
};

/** Seed the locked-transaction reads; `prior` = advances already drawn this cycle. */
function seed(opts: {
  accrued?: number;
  prior?: Array<{ amount: number; fee: number }>;
  failsafeActive?: boolean;
  buffer?: number;
  intentStatus?: string;
}) {
  tx.employee.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  tx.payrollCycle.findUnique.mockResolvedValue({ id: 'cyc-1', companyId: 'co-1', status: 'INTENTS_READY' });
  tx.payrollIntent.findUnique.mockResolvedValue({
    id: 'intent-1',
    cycleId: 'cyc-1',
    employeeId: 'emp-1',
    accruedAmount: opts.accrued ?? 1000,
    currency: 'AED',
    status: opts.intentStatus ?? 'PENDING',
  });
  tx.advance.findMany.mockResolvedValue(opts.prior ?? []);
  tx.company.findUnique.mockResolvedValue({
    ewaFailsafeActive: opts.failsafeActive ?? false,
    hrLagBufferPercent: opts.buffer ?? 0,
  });
  tx.advance.create.mockImplementation(async ({ data }: any) => ({ id: 'adv-new', ...data }));
  tx.ledgerEntry.create.mockResolvedValue({});
  tx.employee.update.mockResolvedValue({});
}

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
});

// ═══════════════════════════════════════════════════════════════════
// Pure eligibility math
// ═══════════════════════════════════════════════════════════════════

describe('computeEligibility — cumulative per-cycle ceiling', () => {
  const base = { dcseLimit: 100_000, accruedAmount: 1000, accruedCapFraction: 1, hrLagBufferPercent: 0, fee: 10 };

  it('with nothing drawn, matches the single-advance formula (never above it)', () => {
    for (const accruedAmount of [0, 1, 999.99, 1000, 1234.56, 5000]) {
      for (const dcseLimit of [0, 500, 2000, 100_000]) {
        for (const hrLagBufferPercent of [0, 0.1, 0.15, 0.333]) {
          for (const fee of [0, 10]) {
            const single = computeAvailableLimit({ dcseLimit, accruedAmount, hrLagBufferPercent, fee });
            const { remaining } = computeEligibility({ dcseLimit, accruedAmount, accruedCapFraction: 1, hrLagBufferPercent, fee, consumed: [] });
            expect(remaining).toBeLessThanOrEqual(single);
            expect(single - remaining).toBeLessThanOrEqual(0.0100001);
          }
        }
      }
    }
  });

  it('subtracts every prior advance AND its fee: 1000 accrued, one 600 drawn → 380 left', () => {
    const e = computeEligibility({ ...base, consumed: [{ amount: 600, fee: 10 }] });
    expect(e).toMatchObject({ ceiling: 1000, advancedAmount: 600, drawnTotal: 610, remaining: 380 });
  });

  it('reaches exactly zero at the boundary and never goes negative', () => {
    expect(computeEligibility({ ...base, consumed: [{ amount: 600, fee: 10 }, { amount: 380, fee: 10 }] }).remaining).toBe(0);
    expect(computeEligibility({ ...base, consumed: [{ amount: 990, fee: 10 }, { amount: 990, fee: 10 }] }).remaining).toBe(0);
  });

  it('the DCSE limit is cumulative, not per request', () => {
    const e = computeEligibility({ ...base, dcseLimit: 700, accruedAmount: 5000, consumed: [{ amount: 400, fee: 10 }] });
    expect(e.remaining).toBe(280); // 700 − 410 − 10
  });

  it('the failsafe share and HR-lag buffer are cumulative too', () => {
    const failsafe = computeEligibility({ ...base, accruedCapFraction: 0.2, consumed: [{ amount: 95, fee: 10 }] });
    expect(failsafe).toMatchObject({ accruedCap: 200, ceiling: 200, remaining: 85 });
    const buffered = computeEligibility({ ...base, hrLagBufferPercent: 0.1, consumed: [{ amount: 500, fee: 10 }] });
    expect(buffered.remaining).toBe(380); // 900 − 510 − 10
  });

  it('sums in integer fils: a hundred 0.10 advances are exactly 10.00', () => {
    const consumed = Array.from({ length: 100 }, () => ({ amount: 0.1, fee: 0 }));
    let floatSum = 0;
    for (const c of consumed) floatSum += c.amount;
    expect(floatSum).not.toBe(10); // the Float drift this avoids
    const e = computeEligibility({ ...base, accruedAmount: 20, fee: 0, consumed });
    expect(e.advancedAmount).toBe(10);
    expect(e.remaining).toBe(10);
  });

  it('clamps nonsense inputs to the safe side', () => {
    expect(computeEligibility({ ...base, accruedAmount: -50, consumed: [] }).remaining).toBe(0);
    expect(computeEligibility({ ...base, dcseLimit: -1, consumed: [] }).remaining).toBe(0);
    expect(computeEligibility({ ...base, accruedCapFraction: 5, consumed: [] }).accruedCap).toBe(1000);
    expect(computeEligibility({ ...base, hrLagBufferPercent: 1, fee: 0, consumed: [] }).remaining).toBe(10);
  });
});

describe('which advances consume the cycle capacity', () => {
  const cases: Array<[AdvanceStatus, Date | null, boolean]> = [
    [AdvanceStatus.REQUESTED, null, true],
    [AdvanceStatus.APPROVED, null, true],
    [AdvanceStatus.RESERVED, new Date(), true],
    [AdvanceStatus.SETTLED, new Date(), true],
    [AdvanceStatus.FAILED, new Date(), true], // credited, no clawback exists
    [AdvanceStatus.FAILED, null, false], // never credited
    [AdvanceStatus.REJECTED, null, false],
  ];

  /** Evaluate CONSUMING_ADVANCE_WHERE the way Postgres would for this shape. */
  function matchesWhere(status: AdvanceStatus, reservedAt: Date | null): boolean {
    return (CONSUMING_ADVANCE_WHERE.OR as any[]).some((clause) => {
      const statusOk = typeof clause.status === 'string' ? clause.status === status : clause.status.in.includes(status);
      const reservedOk = clause.reservedAt ? reservedAt !== null : true;
      return statusOk && reservedOk;
    });
  }

  it.each(cases)('%s (reservedAt %p) consumes: %s', (status, reservedAt, expected) => {
    expect(consumesEligibility({ status, reservedAt })).toBe(expected);
    expect(matchesWhere(status, reservedAt)).toBe(expected);
  });

  it('every AdvanceStatus is classified', () => {
    expect(new Set(cases.map(([s]) => s))).toEqual(new Set(Object.values(AdvanceStatus)));
  });
});

// ═══════════════════════════════════════════════════════════════════
// reserveAdvance — cumulative gates inside the locked transaction
// ═══════════════════════════════════════════════════════════════════

describe('reserveAdvance — cumulative enforcement', () => {
  it('counts the advance already drawn: a second 600 against 1000 accrued is refused', async () => {
    seed({ prior: [{ amount: 600, fee: 10 }] });
    await expect(reserveAdvance({ ...baseArgs, amount: 600 })).rejects.toMatchObject({
      status: 409,
      code: 'AMOUNT_EXCEEDS_ACCRUED',
      details: expect.objectContaining({ alreadyAdvanced: 600, requested: 600, accruedAmount: 1000 }),
    });
    expect(tx.advance.create).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('allows exactly the remaining amount and nothing more (380 after 600, fee 10)', async () => {
    seed({ prior: [{ amount: 600, fee: 10 }] });
    await expect(reserveAdvance({ ...baseArgs, amount: 380.01 })).rejects.toMatchObject({
      code: 'EXCEEDS_AVAILABLE_LIMIT',
      details: expect.objectContaining({ availableLimit: 380, alreadyDrawn: 610, ceiling: 1000 }),
    });
    seed({ prior: [{ amount: 600, fee: 10 }] });
    await expect(reserveAdvance({ ...baseArgs, amount: 380 })).resolves.toMatchObject({ amount: 380 });
  });

  it('refuses even when every request is far below the per-request maximum', async () => {
    // Four prior 240s (+10 fee each) = 1000 drawn of a 1000 ceiling.
    seed({ prior: Array.from({ length: 4 }, () => ({ amount: 240, fee: 10 })) });
    await expect(reserveAdvance({ ...baseArgs, amount: 1 })).rejects.toMatchObject({ code: 'EXCEEDS_AVAILABLE_LIMIT' });
  });

  it('applies the DCSE limit cumulatively', async () => {
    seed({ accrued: 5000, prior: [{ amount: 400, fee: 10 }] });
    await expect(reserveAdvance({ ...baseArgs, dcseLimitAtReq: 700, amount: 400 })).rejects.toMatchObject({
      code: 'EXCEEDS_AVAILABLE_LIMIT',
      details: expect.objectContaining({ availableLimit: 280 }),
    });
  });

  it('applies the cohort failsafe cumulatively', async () => {
    seed({ failsafeActive: true, prior: [{ amount: 150, fee: 10 }] });
    await expect(reserveAdvance({ ...baseArgs, amount: 100 })).rejects.toMatchObject({
      code: 'COHORT_FAILSAFE_CAP',
      details: expect.objectContaining({ failsafeCap: 200, alreadyAdvanced: 150 }),
    });
  });

  it('reads prior advances for this worker AND cycle with the consumption filter', async () => {
    seed({});
    await reserveAdvance({ ...baseArgs, amount: 100 });
    expect(tx.advance.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1', cycleId: 'cyc-1', ...CONSUMING_ADVANCE_WHERE },
      select: { amount: true, fee: true },
    });
  });

  it('takes the worker lock, then share-locks the cycle row, before reading it', async () => {
    seed({});
    await reserveAdvance({ ...baseArgs, amount: 100 });
    const sql = tx.$queryRaw.mock.calls.map((call: any[]) => (call[0] as string[]).join('?'));
    expect(sql[0]).toContain('pg_advisory_xact_lock');
    expect(sql[1]).toMatch(/FROM payroll_cycles WHERE id = \? FOR SHARE/);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.payrollCycle.findUnique.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.advance.findMany.mock.invocationCallOrder[0]);
  });

  it('refuses an intent whose wages were already routed', async () => {
    seed({ intentStatus: 'ROUTED' });
    await expect(reserveAdvance({ ...baseArgs, amount: 100 })).rejects.toMatchObject({ code: 'WAGES_ALREADY_ROUTED' });
    expect(tx.advance.create).not.toHaveBeenCalled();
  });

  it.each<[string, { amount: number; fee?: number; dcseLimitAtReq?: number }]>([
    ['sub-fil amount', { amount: 600.005 }],
    ['NaN amount', { amount: Number.NaN }],
    ['zero amount', { amount: 0 }],
    ['negative fee', { amount: 100, fee: -10 }],
    ['non-finite DCSE limit', { amount: 100, dcseLimitAtReq: Number.POSITIVE_INFINITY }],
  ])('rejects a %s before opening a transaction', async (_label, override) => {
    await expect(reserveAdvance({ ...baseArgs, ...override })).rejects.toMatchObject({ status: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Idempotency-Key guard
// ═══════════════════════════════════════════════════════════════════

describe('reserveAdvance — one advance per Idempotency-Key', () => {
  it('a replay returns the original advance without reserving again', async () => {
    seed({});
    const first = await reserveAdvance({ ...baseArgs, amount: 100, idempotencyKey: 'key-1' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect([...store.values()]).toEqual([`done:${first.id}`]);

    db.advance.findFirst.mockResolvedValue(first);
    const replay = await reserveAdvance({ ...baseArgs, amount: 100, idempotencyKey: 'key-1' });
    expect(replay).toBe(first);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.advance.findFirst).toHaveBeenCalledWith({ where: { id: first.id, employeeId: 'emp-1' } });
  });

  it('a concurrent duplicate gets 409 while the first is in flight', async () => {
    seed({});
    let release!: () => void;
    tx.advance.create.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ id: 'adv-slow', amount: 100 }))),
    );
    const first = reserveAdvance({ ...baseArgs, amount: 100, idempotencyKey: 'key-2' });
    await new Promise((r) => setImmediate(r));
    await expect(reserveAdvance({ ...baseArgs, amount: 100, idempotencyKey: 'key-2' })).rejects.toMatchObject({
      status: 409,
      code: 'ADVANCE_REQUEST_IN_PROGRESS',
    });
    release();
    await expect(first).resolves.toMatchObject({ id: 'adv-slow' });
  });

  it('a failed reservation releases the key so a retry is processed', async () => {
    seed({ prior: [{ amount: 990, fee: 10 }] });
    await expect(reserveAdvance({ ...baseArgs, amount: 100, idempotencyKey: 'key-3' })).rejects.toMatchObject({
      code: 'AMOUNT_EXCEEDS_ACCRUED',
    });
    expect(store.size).toBe(0);
    seed({});
    await expect(reserveAdvance({ ...baseArgs, amount: 100, idempotencyKey: 'key-3' })).resolves.toMatchObject({ amount: 100 });
  });

  it('keys are scoped per worker', async () => {
    seed({});
    await reserveAdvance({ ...baseArgs, amount: 100, idempotencyKey: 'shared' });
    seed({});
    await reserveAdvance({ ...baseArgs, employeeId: 'emp-2', amount: 100, idempotencyKey: 'shared' });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(2);
  });

  it('different keys are separate requests — each still bound by the cumulative limit', async () => {
    seed({ prior: [{ amount: 600, fee: 10 }] });
    await expect(reserveAdvance({ ...baseArgs, amount: 600, idempotencyKey: 'other-key' })).rejects.toMatchObject({
      code: 'AMOUNT_EXCEEDS_ACCRUED',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Settlement locks the cycle; the balance view is cumulative
// ═══════════════════════════════════════════════════════════════════

describe('settleCycle — serialized with reservations', () => {
  it('locks the cycle row FOR UPDATE before reading intents, and re-checks its status', async () => {
    db.payrollCycle.findUnique.mockResolvedValue({ id: 'cyc-1', status: 'INTENTS_READY' });
    tx.payrollCycle.findUnique.mockResolvedValue({ status: 'INTENTS_READY' });
    tx.payrollIntent.findMany.mockResolvedValue([]);
    tx.payrollCycle.update.mockResolvedValue({});
    await settleCycle('cyc-1');
    const lockSql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(lockSql).toMatch(/FROM payroll_cycles WHERE id = \? FOR UPDATE/);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.payrollIntent.findMany.mock.invocationCallOrder[0]);
  });

  it('aborts if the cycle settled while it waited for the lock', async () => {
    db.payrollCycle.findUnique.mockResolvedValue({ id: 'cyc-1', status: 'INTENTS_READY' });
    tx.payrollCycle.findUnique.mockResolvedValue({ status: 'SETTLED' });
    await expect(settleCycle('cyc-1')).rejects.toMatchObject({ status: 400 });
    expect(tx.payrollIntent.findMany).not.toHaveBeenCalled();
  });
});

describe('getEmployeeBalance — shows the cumulative remaining', () => {
  it('subtracts the advances already drawn in the active cycle', async () => {
    db.employee.findUnique.mockResolvedValue({
      walletBalance: 600,
      companyId: 'co-1',
      plan: 'BASIC',
      company: { hrLagBufferPercent: 0, ewaFailsafeActive: false },
    });
    db.payrollIntent.findFirst.mockResolvedValue({ cycleId: 'cyc-1', accruedAmount: 1000 });
    db.advance.findMany.mockResolvedValue([{ amount: 600, fee: 10 }]);
    (creditScoringService.computeScore as jest.Mock).mockResolvedValue({ score: 80, maxEWAAmount: 2000, eligibleForEWA: true });

    const view = await getEmployeeBalance('emp-1');
    expect(view.availableLimit).toBe(380);
    expect(db.advance.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1', cycleId: 'cyc-1', ...CONSUMING_ADVANCE_WHERE },
      select: { amount: true, fee: true },
    });
  });
});
