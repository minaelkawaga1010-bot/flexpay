import { createHmac, randomBytes } from 'crypto';
import express from 'express';
import request from 'supertest';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { acquireWorkerLockScoped, LockScope } from '@shared/utils/advisory-lock';
import { errorHandler } from '@shared/middleware/error-handler';
import { moneyHashRemittanceWebhook } from '@webhooks/moneyhash-remittance.webhook';
import {
  confirmRemittance,
  failRemittance,
  refundIdempotencyKey,
} from '@modules/remittance/remittance-lifecycle';
import { remittanceService } from '@modules/remittance/remittance.service';
import { moneyHashService } from '@modules/remittance/moneyhash.service';

/**
 * TASK-011 — a completed or externally settled MoneyHash remittance is
 * never refunded, failed, reversed, or credited back because of a
 * delayed, duplicated, conflicting, or out-of-order provider event.
 * Runs against a REAL PostgreSQL (advisory locks, constraints, triggers)
 * and a REAL Redis (webhook replay guard). `npm run test:e2e` only.
 *
 * Every assertion is on the ledger itself, never only an HTTP code or a
 * final status label — the invariants (TASK-011 §14-16):
 *   • COMPLETED  ⇒ no REFUND row, the wallet keeps the debit;
 *   • FAILED     ⇒ exactly one REFUND row for the full debit, wallet whole;
 *   • a contradictory late event changes no money and leaves exactly one
 *     *_CONFLICT audit row;
 *   • a timeout / ambiguous submission is NEVER taken as proof of failure;
 *   • no remittance is ever both COMPLETED and refunded.
 */

const START = 1000;
const AMOUNT = 200;
const employees: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97153${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newEmployee(balance = START): Promise<string> {
  const e = await prisma.employee.create({
    data: { phone: phone(), fullName: 'Remittance E2E', plan: 'BASIC', status: 'ACTIVE', walletBalance: balance },
  });
  employees.push(e.id);
  return e.id;
}

/**
 * A remittance reserved and submitted: wallet already debited `AMOUNT`,
 * one PENDING REMITTANCE row whose `reference` is the provider transferId
 * (as it is once bound), so the signed webhook can locate it.
 */
async function pendingRemittance(employeeId = '', amount = AMOUNT) {
  const owner = employeeId || (await newEmployee());
  const transferId = `tr-${uid()}`;
  const row = await prisma.employeeTransaction.create({
    data: {
      employeeId: owner,
      type: 'REMITTANCE',
      amount,
      fee: 0,
      totalAmount: amount,
      currency: 'EGP',
      status: 'PENDING',
      reference: transferId,
      merchantName: 'MoneyHash',
    },
  });
  await prisma.employee.update({ where: { id: owner }, data: { walletBalance: { decrement: amount } } });
  return { row, transferId, employeeId: owner };
}

/** Ledger-level view of one remittance — the whole financial truth. */
async function ledger(remittanceId: string) {
  const row = await prisma.employeeTransaction.findUniqueOrThrow({ where: { id: remittanceId } });
  const refunds = await prisma.employeeTransaction.findMany({
    where: { idempotencyKey: refundIdempotencyKey(row.reference ?? row.id), type: 'REFUND' },
  });
  const wallet = (await prisma.employee.findUniqueOrThrow({ where: { id: row.employeeId } })).walletBalance;
  const conflicts = (await prisma.auditLog.findMany({ where: { resourceId: remittanceId }, orderBy: { createdAt: 'asc' } }))
    .map((a) => a.action)
    .filter((action) => action.endsWith('_CONFLICT'));
  return { status: row.status, refunds: refunds.map((r) => r.amount), wallet, conflicts };
}

const COMPLETED = { status: 'COMPLETED', refunds: [], wallet: START - AMOUNT };
const REFUNDED = { status: 'FAILED', refunds: [AMOUNT], wallet: START };

// Real signed MoneyHash webhook, mounted as in src/app.ts.
const app = express();
app.use('/webhooks/moneyhash', express.raw({ type: 'application/json', limit: '1mb' }), moneyHashRemittanceWebhook.router);
app.use(errorHandler);

/**
 * `t` varies per call so each delivery is distinct to the replay guard
 * (the signature covers base64(body)+t) — the service-level lock rules,
 * not the replay guard, are what must hold the line on a re-send.
 */
function webhook(event: Record<string, unknown>, t = Math.floor(Date.now() / 1000)): request.Test {
  const raw = JSON.stringify(event);
  const v3 = createHmac('sha256', process.env.MONEYHASH_WEBHOOK_SECRET as string)
    .update(Buffer.from(raw).toString('base64') + t)
    .digest('hex');
  return request(app)
    .post('/webhooks/moneyhash/status')
    .set('Content-Type', 'application/json')
    .set('MoneyHash-Signature', `t=${t},v3=${v3}`)
    .send(raw);
}

/** Hold the employee's WALLET_DEBIT lock from another transaction until released. */
async function holdWalletLock(employeeId: string) {
  let release!: () => void;
  let held!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const ready = new Promise<void>((r) => (held = r));
  const done = prisma.$transaction(
    async (tx) => {
      await acquireWorkerLockScoped(tx, employeeId, LockScope.WALLET_DEBIT);
      held();
      await gate;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await ready;
  return { release, done };
}

async function waitForAdvisoryWaiters(n: number) {
  for (let i = 0; i < 500; i++) {
    const [{ waiting }] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
    if (waiting >= n) return;
    await sleep(10);
  }
  throw new Error(`expected ${n} transactions waiting on the advisory lock`);
}

async function dropTriggers() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_fail_remit_refund ON employee_transactions');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_remit_refund()');
}

describe('MoneyHash remittance settlement / refund integrity — PostgreSQL + Redis (TASK-011)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });

  afterAll(async () => {
    await dropTriggers();
    await prisma.auditLog.deleteMany({ where: { actorId: { in: employees } } });
    const rows = await prisma.employeeTransaction.findMany({ where: { employeeId: { in: employees } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { resourceId: { in: rows.map((r) => r.id) } } });
    await prisma.employeeTransaction.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.employee.deleteMany({ where: { id: { in: employees } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  // ─────────────────────────────────────────────────────────────────
  // Completion then a contradictory late event (the reported defect)
  // ─────────────────────────────────────────────────────────────────

  it.each(['failed', 'reversed'] as const)(
    'succeeded then a signed %s webhook: no refund, no credit, conflict audited',
    async (bad) => {
      const { row, transferId } = await pendingRemittance();

      expect((await webhook({ transferId, status: 'succeeded' })).status).toBe(200);
      expect((await webhook({ transferId, status: bad, failureReason: 'late_return' }, Math.floor(Date.now() / 1000) + 1)).status).toBe(200);

      expect(await ledger(row.id)).toEqual({ ...COMPLETED, conflicts: ['REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT'] });
    },
  );

  it('failed then a delayed success webhook: the refund stands, the success is refused and audited', async () => {
    const { row, transferId } = await pendingRemittance();

    expect((await webhook({ transferId, status: 'failed', failureReason: 'bank_rejected' })).status).toBe(200);
    expect((await webhook({ transferId, status: 'succeeded' }, Math.floor(Date.now() / 1000) + 1)).status).toBe(200);

    expect(await ledger(row.id)).toEqual({ ...REFUNDED, conflicts: ['REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT'] });
  });

  // ─────────────────────────────────────────────────────────────────
  // Concurrency — both lock acquisition orders (FIFO under a held lock)
  // ─────────────────────────────────────────────────────────────────

  it.each([
    ['confirmation acquires the lock first', 'confirm', COMPLETED, 'REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT'],
    ['the failure acquires the lock first', 'fail', REFUNDED, 'REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT'],
  ] as const)('simultaneous confirm and fail — %s', async (_label, first, expected, conflict) => {
    const { row, transferId, employeeId } = await pendingRemittance();
    const confirm = () => confirmRemittance(row.id, employeeId, { transferId, event: 'succeeded' }, 'webhook:moneyhash');
    const fail = () => failRemittance(row.id, employeeId, { transferId, event: 'failed', failureReason: 'rail_failed' }, 'webhook:moneyhash');

    // Both queue behind a held lock in a known order; PostgreSQL grants FIFO.
    const holder = await holdWalletLock(employeeId);
    const a = (first === 'confirm' ? confirm : fail)();
    await waitForAdvisoryWaiters(1);
    const b = (first === 'confirm' ? fail : confirm)();
    await waitForAdvisoryWaiters(2);
    holder.release();
    await holder.done;
    await Promise.all([a, b]);

    expect(await ledger(row.id)).toEqual({ ...expected, conflicts: [conflict] });
  });

  it('ten concurrent duplicate failures credit the wallet exactly once', async () => {
    const { row, transferId, employeeId } = await pendingRemittance();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        failRemittance(row.id, employeeId, { transferId, event: 'failed', failureReason: `dup_${i}` }, 'webhook:moneyhash'),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await ledger(row.id)).toEqual({ ...REFUNDED, conflicts: [] });
  });

  it('ten concurrent duplicate successes complete once, never refund', async () => {
    const { row, transferId, employeeId } = await pendingRemittance();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        confirmRemittance(row.id, employeeId, { transferId, event: 'succeeded' }, 'webhook:moneyhash'),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await ledger(row.id)).toEqual({ ...COMPLETED, conflicts: [] });
  });

  // ─────────────────────────────────────────────────────────────────
  // Duplicate and out-of-order signed webhooks
  // ─────────────────────────────────────────────────────────────────

  it('out-of-order signed webhooks: succeeded → failed → reversed → re-sent succeeded', async () => {
    const { row, transferId } = await pendingRemittance();
    const base = Math.floor(Date.now() / 1000);
    const responses = [
      await webhook({ transferId, status: 'succeeded' }, base),
      await webhook({ transferId, status: 'failed', failureReason: 'late' }, base + 1),
      await webhook({ type: 'transfer.reversed', data: { transferId } }, base + 2),
      await webhook({ transferId, status: 'succeeded' }, base + 3), // provider re-send
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    // One completion, two contradictory late events audited, zero refunds.
    expect(await ledger(row.id)).toEqual({
      ...COMPLETED,
      conflicts: ['REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT', 'REMITTANCE_FAILURE_AFTER_COMPLETION_CONFLICT'],
    });
  });

  it('out-of-order signed webhooks: failed re-sent twice then succeeded keeps exactly one refund', async () => {
    const { row, transferId } = await pendingRemittance();
    const base = Math.floor(Date.now() / 1000);
    const responses = [
      await webhook({ transferId, status: 'failed', failureReason: 'rail_failed' }, base),
      await webhook({ transferId, status: 'failed', failureReason: 'rail_failed' }, base + 1), // re-send
      await webhook({ transferId, status: 'succeeded' }, base + 2),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await ledger(row.id)).toEqual({ ...REFUNDED, conflicts: ['REMITTANCE_SUCCESS_AFTER_FAILURE_CONFLICT'] });
  });

  // ─────────────────────────────────────────────────────────────────
  // Submission outcomes: rejection, ambiguity, timeout-after-success
  // ─────────────────────────────────────────────────────────────────

  it('a definitive provider rejection at submission refunds in full and never leaves a debit', async () => {
    const employeeId = await newEmployee();
    const spy = jest.spyOn(moneyHashService, 'createTransfer').mockRejectedValueOnce({ response: { status: 422 } });
    try {
      await expect(remittanceService.send(employeeId, 300, 'EGP', { name: 'B', bankAccount: '00012345', swiftCode: 'ABCDAEAA' })).rejects.toMatchObject({
        status: 502,
        code: 'REMITTANCE_REJECTED',
      });
    } finally {
      spy.mockRestore();
    }
    const rows = await prisma.employeeTransaction.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });
    const remittance = rows.find((r) => r.type === 'REMITTANCE')!;
    const refunds = rows.filter((r) => r.type === 'REFUND');
    expect(remittance.status).toBe('FAILED');
    expect(refunds).toHaveLength(1);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).walletBalance).toBe(START);
  });

  it('an ambiguous submission is held PENDING and audited — a timeout is never taken as failure', async () => {
    const employeeId = await newEmployee();
    const spy = jest.spyOn(moneyHashService, 'createTransfer').mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    let result: Awaited<ReturnType<typeof remittanceService.send>>;
    try {
      result = await remittanceService.send(employeeId, 300, 'EGP', { name: 'B', bankAccount: '00012345', swiftCode: 'ABCDAEAA' });
    } finally {
      spy.mockRestore();
    }
    expect(result.status).toBe('PENDING_VERIFICATION');

    const rows = await prisma.employeeTransaction.findMany({ where: { employeeId } });
    const remittance = rows.find((r) => r.type === 'REMITTANCE')!;
    expect(remittance.status).toBe('PENDING'); // NOT failed
    expect(rows.some((r) => r.type === 'REFUND')).toBe(false); // NOT refunded
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).walletBalance).toBe(START - 301.8);
    const audits = await prisma.auditLog.findMany({ where: { resourceId: remittance.id } });
    expect(audits.map((a) => a.action)).toContain('REMITTANCE_SUBMISSION_OUTCOME_UNKNOWN');

    // Reconciliation later verifies the transfer DID settle (a timeout
    // that hid a success). Modelled by a direct confirm — MoneyHash's
    // webhook matching for an unbound client reference is NOT VERIFIED.
    await confirmRemittance(remittance.id, employeeId, { transferId: remittance.reference!, event: 'succeeded' }, 'reconciliation');
    const after = await prisma.employeeTransaction.findUniqueOrThrow({ where: { id: remittance.id } });
    expect(after.status).toBe('COMPLETED');
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).walletBalance).toBe(START - 301.8);
    expect(await prisma.employeeTransaction.count({ where: { employeeId, type: 'REFUND' } })).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Multiple concurrent remittances on one wallet
  // ─────────────────────────────────────────────────────────────────

  it('five concurrent sends on a wallet that funds three: three settle, wallet never negative', async () => {
    const employeeId = await newEmployee();
    const spy = jest.spyOn(moneyHashService, 'createTransfer').mockImplementation(async () => `mh-${uid()}`);
    let results: PromiseSettledResult<Awaited<ReturnType<typeof remittanceService.send>>>[];
    try {
      results = await Promise.allSettled(
        Array.from({ length: 5 }, () => remittanceService.send(employeeId, 300, 'EGP', { name: 'B', bankAccount: '00012345', swiftCode: 'ABCDAEAA' })),
      );
    } finally {
      spy.mockRestore();
    }
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(3); // 3 × 301.8 = 905.4 ≤ 1000; a 4th would overdraw
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => (r.reason as { status: number }).status === 400)).toBe(true);

    const wallet = (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).walletBalance;
    expect(wallet).toBeCloseTo(94.6, 2);
    expect(wallet).toBeGreaterThanOrEqual(0);
    expect(await prisma.employeeTransaction.count({ where: { employeeId, type: 'REMITTANCE', status: 'PENDING' } })).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────
  // Transaction rollback and retry
  // ─────────────────────────────────────────────────────────────────

  it('a failure that rolls back mid-transaction leaves the remittance untouched; the retry refunds once', async () => {
    const { row, transferId, employeeId } = await pendingRemittance();
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_fail_remit_refund() RETURNS trigger AS $$
      BEGIN
        IF NEW."employeeId" = '${employeeId}' AND NEW.type = 'REFUND' THEN RAISE EXCEPTION 'e2e simulated refund failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER e2e_fail_remit_refund BEFORE INSERT ON employee_transactions FOR EACH ROW EXECUTE FUNCTION e2e_fail_remit_refund()',
    );
    try {
      await expect(
        failRemittance(row.id, employeeId, { transferId, event: 'failed', failureReason: 'rail_failed' }, 'webhook:moneyhash'),
      ).rejects.toThrow(/e2e simulated refund failure/);
      // The FAILED update and the credit rolled back with the failed insert.
      expect(await ledger(row.id)).toEqual({ status: 'PENDING', refunds: [], wallet: START - AMOUNT, conflicts: [] });
    } finally {
      await dropTriggers();
    }
    await expect(failRemittance(row.id, employeeId, { transferId, event: 'failed', failureReason: 'rail_failed' }, 'webhook:moneyhash')).resolves.toMatchObject({ status: 'FAILED' });
    await expect(failRemittance(row.id, employeeId, { transferId, event: 'failed', failureReason: 'rail_failed' }, 'webhook:moneyhash')).resolves.toMatchObject({ status: 'FAILED' });
    expect(await ledger(row.id)).toEqual({ ...REFUNDED, conflicts: [] });
  });
});
