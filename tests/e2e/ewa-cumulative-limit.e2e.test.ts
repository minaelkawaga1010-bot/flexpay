import { randomBytes, randomUUID } from 'crypto';
import { PayrollCycleStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import {
  EWA_FIXED_FEE,
  getEmployeeBalance,
  reserveAdvance,
  settleCycle,
} from '@modules/payroll-routing/payroll-routing.service';

// The DCSE score is an input to the limit, not part of the invariant
// under test; pin it so the balance view is deterministic.
jest.mock('@modules/scoring/scoring.service', () => ({
  creditScoringService: {
    computeScore: jest.fn().mockResolvedValue({ score: 80, maxEWAAmount: 2000, eligibleForEWA: true, nextReviewAt: null }),
  },
}));

/**
 * TASK-009 — cumulative EWA advance limits against a REAL PostgreSQL
 * (advisory + row locks, constraints) and Redis. Requires live Postgres +
 * Redis; runs only via `npm run test:e2e`.
 *
 * Invariant under test: whatever the request pattern — concurrent,
 * sequential, repeated, same or different Idempotency-Keys, failing and
 * retried, across cycles or racing settlement — the advances a worker
 * draws against one payroll cycle never exceed that cycle's ceiling,
 * Σ(amount + fee) ≤ MIN(DCSE, accrued) × (1 − HR-lag buffer), and every
 * advance is recovered by its own cycle's settlement.
 */

const FEE = EWA_FIXED_FEE;
const createdCompanies: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97150${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function newCompany(hrLagBufferPercent = 0) {
  const t = uid();
  const company = await prisma.company.create({
    data: {
      name: `EWA E2E ${t}`,
      tradeLicense: `TL-E2E-${t}`,
      adminName: 'EWA E2E',
      adminEmail: `ewa-e2e-${t}@example.invalid`,
      adminPhone: phone(),
      passwordHash: 'not-a-real-hash',
      hrLagBufferPercent,
      ewaFailsafeActive: false,
    },
  });
  createdCompanies.push(company.id);
  return company;
}

async function newCycle(companyId: string, monthIndex: number) {
  return prisma.payrollCycle.create({
    data: {
      companyId,
      periodStart: new Date(Date.UTC(2026, monthIndex, 1)),
      periodEnd: new Date(Date.UTC(2026, monthIndex + 1, 0)),
      status: PayrollCycleStatus.INTENTS_READY,
    },
  });
}

async function newEmployee(companyId: string) {
  return prisma.employee.create({
    data: { phone: phone(), fullName: 'EWA E2E Worker', plan: 'BASIC', status: 'ACTIVE', walletBalance: 0, companyId },
  });
}

async function newIntent(cycleId: string, employeeId: string, accrued: number, gross = accrued) {
  return prisma.payrollIntent.create({
    data: { cycleId, employeeId, grossAmount: gross, accruedAmount: accrued, fileLineHash: `e2e-${uid()}` },
  });
}

/** One worker with one live cycle holding `accrued` wages. */
async function worker(accrued = 1000, hrLagBufferPercent = 0) {
  const company = await newCompany(hrLagBufferPercent);
  const cycle = await newCycle(company.id, 0);
  const employee = await newEmployee(company.id);
  await newIntent(cycle.id, employee.id, accrued);
  return { companyId: company.id, cycleId: cycle.id, employeeId: employee.id };
}

type Worker = { cycleId: string; employeeId: string };

const reserve = (w: Worker, amount: number, idempotencyKey?: string) =>
  reserveAdvance({
    employeeId: w.employeeId,
    cycleId: w.cycleId,
    amount,
    fee: FEE,
    dcseModelVersion: 'e2e',
    dcseLimitAtReq: 100_000,
    dcseRiskScoreAtReq: 0.5,
    idempotencyKey,
  });

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'reserved' : String((r.reason as { code?: string; message?: string })?.code ?? (r.reason as Error)?.message);

async function drawn(w: Worker) {
  const advances = await prisma.advance.findMany({ where: { employeeId: w.employeeId, cycleId: w.cycleId } });
  const ledger = await prisma.ledgerEntry.aggregate({
    where: { employeeId: w.employeeId, cycleId: w.cycleId, type: 'ADVANCE_RESERVE' },
    _sum: { delta: true },
  });
  const wallet = (await prisma.employee.findUniqueOrThrow({ where: { id: w.employeeId } })).walletBalance;
  const fils = (n: number) => Math.round(n * 100);
  const amountFils = advances.reduce((s, a) => s + fils(a.amount), 0);
  const feeFils = advances.reduce((s, a) => s + fils(a.fee), 0);
  return {
    count: advances.length,
    amount: amountFils / 100,
    drawnTotal: (amountFils + feeFils) / 100,
    reservedLedger: ledger._sum.delta ?? 0,
    wallet,
  };
}

async function cleanup() {
  const employees = await prisma.employee.findMany({ where: { companyId: { in: createdCompanies } }, select: { id: true } });
  const ids = employees.map((e) => e.id);
  await prisma.ledgerEntry.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.advance.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.payrollIntent.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.payrollCycle.deleteMany({ where: { companyId: { in: createdCompanies } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: createdCompanies } } });
}

describe('EWA cumulative advance limit — PostgreSQL + Redis (TASK-009)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_fail_ledger ON ledger_entries');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_ledger()');
    await cleanup();
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('accrued 1000: five concurrent requests of 600 reserve exactly one', async () => {
    const w = await worker(1000);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserve(w, 600)));

    expect(results.map(outcome).filter((o) => o === 'reserved')).toHaveLength(1);
    expect(results.map(outcome).filter((o) => o !== 'reserved')).toEqual(Array(4).fill('AMOUNT_EXCEEDS_ACCRUED'));
    expect(await drawn(w)).toEqual({ count: 1, amount: 600, drawnTotal: 610, reservedLedger: 600, wallet: 600 });
  });

  it('two sequential requests of 600: the second is refused', async () => {
    const w = await worker(1000);
    await expect(reserve(w, 600)).resolves.toMatchObject({ amount: 600 });
    await expect(reserve(w, 600)).rejects.toMatchObject({
      code: 'AMOUNT_EXCEEDS_ACCRUED',
      details: expect.objectContaining({ alreadyAdvanced: 600, requested: 600 }),
    });
    expect(await drawn(w)).toMatchObject({ count: 1, amount: 600, wallet: 600 });
  });

  it('the same Idempotency-Key submitted concurrently reserves one advance', async () => {
    const w = await worker(1000);
    const key = `idem-${uid()}`;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserve(w, 300, key)));

    const ids = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
    for (const o of results.map(outcome).filter((x) => x !== 'reserved')) expect(o).toBe('ADVANCE_REQUEST_IN_PROGRESS');
    // A later replay returns the same advance; nothing new is reserved.
    const replay = await reserve(w, 300, key);
    expect(ids.has(replay.id)).toBe(true);
    expect(await drawn(w)).toEqual({ count: 1, amount: 300, drawnTotal: 310, reservedLedger: 300, wallet: 300 });
  });

  it('different Idempotency-Keys concurrently: each 300 is far below the per-request maximum, the sum is still capped', async () => {
    const w = await worker(1000);
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => reserve(w, 300, `idem-${uid()}-${i}`)));

    // 3 × (300 + 10) = 930 ≤ 1000; a 4th would make 1240.
    expect(results.map(outcome).filter((o) => o === 'reserved')).toHaveLength(3);
    expect(await drawn(w)).toEqual({ count: 3, amount: 900, drawnTotal: 930, reservedLedger: 900, wallet: 900 });
  });

  it('boundaries: exactly the eligible limit is allowed, one fil more is refused', async () => {
    const flat = await worker(1000, 0);
    await expect(reserve(flat, 990)).resolves.toMatchObject({ amount: 990 }); // 990 + 10 = 1000
    await expect(reserve(flat, 0.01)).rejects.toMatchObject({ code: 'EXCEEDS_AVAILABLE_LIMIT' });

    const buffered = await worker(1000, 0.1);
    await expect(reserve(buffered, 890.01)).rejects.toMatchObject({ code: 'EXCEEDS_AVAILABLE_LIMIT' });
    await expect(reserve(buffered, 890)).resolves.toMatchObject({ amount: 890 }); // 900 ceiling

    const stepwise = await worker(1000, 0);
    await reserve(stepwise, 600);
    expect((await getEmployeeBalance(stepwise.employeeId)).availableLimit).toBe(380);
    await expect(reserve(stepwise, 380.01)).rejects.toMatchObject({ code: 'EXCEEDS_AVAILABLE_LIMIT' });
    await expect(reserve(stepwise, 380)).resolves.toMatchObject({ amount: 380 });
    expect((await getEmployeeBalance(stepwise.employeeId)).availableLimit).toBe(0);
    await expect(reserve(stepwise, 0.01)).rejects.toMatchObject({ code: 'EXCEEDS_AVAILABLE_LIMIT' });
    expect(await drawn(stepwise)).toMatchObject({ count: 2, drawnTotal: 1000, wallet: 980 });
  });

  it('a reservation that fails after writing its advance rolls back completely; the retry gets the full limit', async () => {
    const w = await worker(1000);
    // Make the ledger insert (after the advance row is written) fail for this worker only.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_fail_ledger() RETURNS trigger AS $$
      BEGIN
        IF NEW."employeeId" = '${w.employeeId}' THEN RAISE EXCEPTION 'e2e simulated ledger failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER e2e_fail_ledger BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION e2e_fail_ledger()',
    );
    const key = `idem-${uid()}`;
    try {
      await expect(reserve(w, 990, key)).rejects.toThrow(/e2e simulated ledger failure/);
      expect(await drawn(w)).toEqual({ count: 0, amount: 0, drawnTotal: 0, reservedLedger: 0, wallet: 0 });
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_fail_ledger ON ledger_entries');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_ledger()');
    }
    // Same key: the failed attempt released it and consumed nothing.
    await expect(reserve(w, 990, key)).resolves.toMatchObject({ amount: 990 });
    expect(await drawn(w)).toEqual({ count: 1, amount: 990, drawnTotal: 1000, reservedLedger: 990, wallet: 990 });
  });

  it('cross-cycle: each cycle has its own capacity, and settlement neither releases nor double-counts it', async () => {
    const company = await newCompany(0);
    const employee = await newEmployee(company.id);
    const september = await newCycle(company.id, 8);
    const october = await newCycle(company.id, 9);
    await newIntent(september.id, employee.id, 1000);
    await newIntent(october.id, employee.id, 1000);
    const sep = { cycleId: september.id, employeeId: employee.id };
    const oct = { cycleId: october.id, employeeId: employee.id };

    await expect(reserve(sep, 990)).resolves.toBeDefined();
    await expect(reserve(sep, 0.01)).rejects.toMatchObject({ code: 'EXCEEDS_AVAILABLE_LIMIT' });
    await expect(reserve(oct, 990)).resolves.toBeDefined(); // September's advance is not counted here

    await settleCycle(september.id);
    await expect(reserve(sep, 0.01)).rejects.toMatchObject({ status: 400 }); // cycle settled
    await expect(reserve(oct, 0.01)).rejects.toMatchObject({ code: 'EXCEEDS_AVAILABLE_LIMIT' }); // still full, not released

    const sepAdvances = await prisma.advance.findMany({ where: { cycleId: september.id } });
    expect(sepAdvances.map((a) => a.status)).toEqual(['SETTLED']);
    const sepLedger = await prisma.ledgerEntry.groupBy({ by: ['type'], where: { cycleId: september.id }, _sum: { delta: true } });
    expect(Object.fromEntries(sepLedger.map((l) => [l.type, l._sum.delta]))).toEqual({
      ADVANCE_RESERVE: 990,
      ADVANCE_SETTLE: -990,
      PAYROLL_RESIDUAL: 10,
    });
    // September: 990 advance + 10 residual = its 1000 salary; October: its own 990 advance.
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).walletBalance).toBe(1990);
  });

  it(
    'a reservation racing settlement is either settled with the cycle or refused — never stranded',
    async () => {
      for (const delayMs of [0, 60, 250]) {
        const company = await newCompany(0);
        const cycle = await newCycle(company.id, 11);
        const ids = Array.from({ length: 150 }, () => randomUUID());
        await prisma.employee.createMany({
          data: ids.map((id) => ({ id, phone: phone(), fullName: 'EWA E2E Worker', plan: 'BASIC' as const, status: 'ACTIVE' as const, walletBalance: 0, companyId: company.id })),
        });
        for (const id of ids) await newIntent(cycle.id, id, 1000); // ids[0] is settled first
        const target = { cycleId: cycle.id, employeeId: ids[0] };

        const settling = settleCycle(cycle.id);
        await new Promise((r) => setTimeout(r, delayMs));
        const [settled, reserved] = await Promise.allSettled([settling, reserve(target, 500)]);
        expect(settled.status).toBe('fulfilled');

        const advances = await prisma.advance.findMany({ where: { employeeId: target.employeeId } });
        const wallet = (await prisma.employee.findUniqueOrThrow({ where: { id: target.employeeId } })).walletBalance;
        expect(advances.filter((a) => a.status === 'RESERVED')).toEqual([]);
        if (reserved.status === 'fulfilled') {
          expect(advances.map((a) => a.status)).toEqual(['SETTLED']);
        } else {
          expect(advances).toEqual([]);
        }
        expect(wallet).toBe(1000); // the salary, never salary + an unrecovered advance
      }
    },
    120_000,
  );
});
