import { createHmac, randomBytes } from 'crypto';
import express from 'express';
import request from 'supertest';
import { BillerType, type BillPayment } from '@prisma/client';
import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { acquireWorkerLockScoped, LockScope } from '@shared/utils/advisory-lock';
import { errorHandler } from '@shared/middleware/error-handler';
import { billerWebhook } from '@webhooks/biller.webhook';
import {
  payBill,
  refundFailedBill,
  refundIdempotencyKey,
  settleBillPayment,
} from '@modules/bill-payment/bill-payment.service';
import { setBillerAdapter, type BillerDispatchInput } from '@modules/bill-payment/biller-adapter.service';

/**
 * TASK-010 — a settled bill is never refunded, against a REAL PostgreSQL
 * (advisory locks, constraints, triggers) and Redis. Requires live
 * Postgres + Redis; runs only via `npm run test:e2e`.
 *
 * Every test checks the ledger itself, not just the final status or an
 * HTTP 200: per bill, COMPLETED ⇒ no REFUND row and the wallet keeps the
 * debit; FAILED ⇒ exactly one REFUND row for the bill total and the
 * wallet is whole; the BILL_PAYMENT wallet txn mirrors the bill; a
 * contradictory event leaves exactly one *_CONFLICT audit row.
 */

const START = 1000;
const AMOUNT = 200;
const employees: string[] = [];
const uid = () => randomBytes(5).toString('hex');
const phone = () => `+97152${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newEmployee(): Promise<string> {
  const e = await prisma.employee.create({
    data: { phone: phone(), fullName: 'Bill E2E', plan: 'BASIC', status: 'ACTIVE', walletBalance: START },
  });
  employees.push(e.id);
  return e.id;
}

type Submit = (input: BillerDispatchInput) => Promise<{ externalRef: string; status: 'pending' | 'completed' | 'failed'; failureReason?: string }>;

async function pay(employeeId: string, submit: Submit): Promise<BillPayment> {
  setBillerAdapter({ submit });
  return payBill({
    employeeId,
    billerType: BillerType.DEWA,
    billerAccountRef: `DEWA-${uid()}`,
    amount: AMOUNT,
    idempotencyKey: `bill-e2e-${uid()}`,
  });
}

/** A submitted bill the rail accepted as pending (its rail ref derives from the bill id). */
async function pendingBill(employeeId = '') {
  const owner = employeeId || (await newEmployee());
  const bill = await pay(owner, async (input) => ({ externalRef: `rail-${input.billPaymentId}`, status: 'pending' }));
  return { bill, externalRef: `rail-${bill.id}`, employeeId: owner };
}

/** Ledger-level view of one bill. */
async function ledger(billId: string) {
  const bill = await prisma.billPayment.findUniqueOrThrow({ where: { id: billId } });
  const walletTxn = await prisma.employeeTransaction.findUniqueOrThrow({ where: { id: bill.walletTransactionId! } });
  const refunds = await prisma.employeeTransaction.findMany({
    where: { reference: bill.id, type: 'REFUND' },
  });
  const keyed = await prisma.employeeTransaction.count({ where: { idempotencyKey: refundIdempotencyKey(bill.idempotencyKey) } });
  const wallet = (await prisma.employee.findUniqueOrThrow({ where: { id: bill.employeeId } })).walletBalance;
  const conflicts = (await prisma.auditLog.findMany({ where: { resourceId: bill.id }, orderBy: { createdAt: 'asc' } }))
    .map((a) => a.action)
    .filter((action) => action.endsWith('_CONFLICT'));
  return { status: bill.status, walletTxn: walletTxn.status, refunds: refunds.map((r) => r.amount), keyed, wallet, conflicts };
}

const SETTLED = { status: 'COMPLETED', walletTxn: 'COMPLETED', refunds: [], keyed: 0, wallet: START - AMOUNT };
const REFUNDED = { status: 'FAILED', walletTxn: 'FAILED', refunds: [AMOUNT], keyed: 1, wallet: START };

// Real signed biller webhook, mounted as in src/app.ts.
const app = express();
app.use('/webhooks/biller', express.raw({ type: 'application/json', limit: '1mb' }), billerWebhook.router);
app.use(errorHandler);
function webhook(event: Record<string, unknown>, spacing = 0) {
  // `spacing` varies the raw bytes: a provider re-sending the same event is a
  // new delivery to the replay guard, so the service-level rules are what decide.
  const raw = JSON.stringify(event, null, spacing);
  const signature = createHmac('sha256', process.env.BILLER_WEBHOOK_SECRET as string).update(raw).digest('hex');
  return request(app).post('/webhooks/biller/status').set('Content-Type', 'application/json').set('x-biller-signature', signature).send(raw);
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
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_fail_refund ON employee_transactions');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_refund()');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_fail_settle_audit ON audit_logs');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_settle_audit()');
}

describe('bill refund vs completed settlement — PostgreSQL + Redis (TASK-010)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
  });

  afterAll(async () => {
    await dropTriggers();
    const bills = await prisma.billPayment.findMany({ where: { employeeId: { in: employees } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { resourceId: { in: bills.map((b) => b.id) } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: employees } } });
    await prisma.billPayment.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.employeeTransaction.deleteMany({ where: { employeeId: { in: employees } } });
    await prisma.employee.deleteMany({ where: { id: { in: employees } } });
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('settlement before a late failure: no refund, no credit, conflict audited', async () => {
    const { bill, externalRef } = await pendingBill();
    const settled = await settleBillPayment(bill, externalRef);
    expect(settled.status).toBe('COMPLETED');

    // Late failure with a stale PENDING snapshot (adapter path) and with the fresh row (webhook path).
    await expect(refundFailedBill(bill, 'late_failure', externalRef)).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(refundFailedBill(settled, 'rail_reported_reversed', externalRef)).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(await ledger(bill.id)).toEqual({
      ...SETTLED,
      conflicts: ['BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT', 'BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT'],
    });
  });

  it('refund before a late success: the refund stands, the success is refused and audited', async () => {
    const { bill, externalRef } = await pendingBill();
    await expect(refundFailedBill(bill, 'rail_failed', externalRef)).resolves.toMatchObject({ status: 'FAILED' });
    await expect(settleBillPayment(bill, externalRef)).resolves.toMatchObject({ status: 'FAILED' });

    expect(await ledger(bill.id)).toEqual({ ...REFUNDED, conflicts: ['BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT'] });
  });

  it.each([
    ['settlement acquires the lock first', 'settle', SETTLED, 'BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT'],
    ['the refund acquires the lock first', 'refund', REFUNDED, 'BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT'],
  ] as const)('simultaneous settle and refund — %s', async (_label, first, expected, conflict) => {
    const { bill, externalRef, employeeId } = await pendingBill();
    const settle = () => settleBillPayment(bill, externalRef);
    const refund = () => refundFailedBill(bill, 'rail_failed', externalRef);

    // Both queue behind a held lock in a known order; PostgreSQL grants it FIFO.
    const holder = await holdWalletLock(employeeId);
    const a = (first === 'settle' ? settle : refund)();
    await waitForAdvisoryWaiters(1);
    const b = (first === 'settle' ? refund : settle)();
    await waitForAdvisoryWaiters(2);
    holder.release();
    await holder.done;
    const outcomes = await Promise.all([a, b]);

    expect(outcomes.map((o) => o.status)).toEqual([expected.status, expected.status]);
    expect(await ledger(bill.id)).toEqual({ ...expected, conflicts: [conflict] });
  });

  it('ten concurrent duplicate refunds credit the wallet exactly once', async () => {
    const { bill, externalRef } = await pendingBill();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => refundFailedBill(bill, `duplicate_${i}`, externalRef)),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await ledger(bill.id)).toEqual({ ...REFUNDED, conflicts: [] });
  });

  it('out-of-order signed webhooks: completed → failed / reversed leaves the settlement untouched', async () => {
    const { bill, externalRef } = await pendingBill();
    const responses = [
      await webhook({ externalRef, status: 'completed' }),
      await webhook({ externalRef, status: 'failed', failureReason: 'late_failure' }),
      await webhook({ type: 'bill.reversed', data: { externalRef } }),
      await webhook({ externalRef, status: 'failed', failureReason: 'late_failure' }, 2), // provider re-send
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await ledger(bill.id)).toEqual({
      ...SETTLED,
      conflicts: Array(3).fill('BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT'),
    });
  });

  it('out-of-order signed webhooks: failed → completed keeps exactly one refund', async () => {
    const { bill, externalRef } = await pendingBill();
    const responses = [
      await webhook({ externalRef, status: 'failed', failureReason: 'rail_failed' }),
      await webhook({ externalRef, status: 'failed', failureReason: 'rail_failed' }, 2), // provider re-send
      await webhook({ externalRef, status: 'completed' }),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await ledger(bill.id)).toEqual({ ...REFUNDED, conflicts: ['BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT'] });
  });

  it('adapter timeout after the success webhook already landed: payBill returns the settled bill, no refund', async () => {
    const employeeId = await newEmployee();
    let billId = '';
    const out = await pay(employeeId, async (input) => {
      billId = input.billPaymentId;
      const row = await prisma.billPayment.findUniqueOrThrow({ where: { id: input.billPaymentId } });
      await settleBillPayment(row, `rail-${uid()}`); // the rail confirmed via webhook first
      throw new Error('adapter timeout');
    });
    expect(out.status).toBe('COMPLETED');
    expect(await ledger(billId)).toEqual({ ...SETTLED, conflicts: ['BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT'] });
  });

  it('adapter failure racing a concurrent success webhook: one consistent outcome, matching what settlement returned', async () => {
    for (let round = 0; round < 10; round++) {
      const employeeId = await newEmployee();
      let billId = '';
      let settleCall: Promise<BillPayment> | undefined;
      const out = await pay(employeeId, async (input) => {
        billId = input.billPaymentId;
        const row = await prisma.billPayment.findUniqueOrThrow({ where: { id: input.billPaymentId } });
        settleCall = settleBillPayment(row, `rail-${uid()}`); // webhook in flight, not awaited
        throw new Error('adapter timeout');
      });
      const settleOutcome = (await settleCall!).status;
      const view = await ledger(billId);
      if (settleOutcome === 'COMPLETED') {
        expect(view).toEqual({ ...SETTLED, conflicts: ['BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT'] });
        expect(out.status).toBe('COMPLETED');
      } else {
        expect(view).toEqual({ ...REFUNDED, conflicts: ['BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT'] });
        expect(out.status).toBe('FAILED');
      }
    }
  });

  it('synchronous adapter rejection, then a late success webhook: refunded once, success audited', async () => {
    const employeeId = await newEmployee();
    const externalRef = `rail-${uid()}`;
    const bill = await pay(employeeId, async () => ({ externalRef, status: 'failed', failureReason: 'biller_rejected' }));
    expect(bill.status).toBe('FAILED');
    expect((await webhook({ externalRef, status: 'completed' })).status).toBe(200);
    expect(await ledger(bill.id)).toEqual({ ...REFUNDED, conflicts: ['BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT'] });
  });

  it('synchronous adapter completion settles through the locked path (wallet txn completed too)', async () => {
    const employeeId = await newEmployee();
    const externalRef = `rail-${uid()}`;
    const bill = await pay(employeeId, async () => ({ externalRef, status: 'completed' }));
    expect(bill.status).toBe('COMPLETED');
    expect((await webhook({ externalRef, status: 'failed', failureReason: 'late_failure' })).status).toBe(200);
    expect(await ledger(bill.id)).toEqual({ ...SETTLED, conflicts: ['BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT'] });
  });

  it('a refund that fails mid-transaction rolls back completely; the retry refunds once', async () => {
    const { bill, externalRef, employeeId } = await pendingBill();
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_fail_refund() RETURNS trigger AS $$
      BEGIN
        IF NEW."employeeId" = '${employeeId}' AND NEW.type = 'REFUND' THEN RAISE EXCEPTION 'e2e simulated refund failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER e2e_fail_refund BEFORE INSERT ON employee_transactions FOR EACH ROW EXECUTE FUNCTION e2e_fail_refund()',
    );
    try {
      // The wallet txn was already marked FAILED inside the tx when the insert fails.
      await expect(refundFailedBill(bill, 'rail_failed', externalRef)).rejects.toThrow(/e2e simulated refund failure/);
      expect(await ledger(bill.id)).toEqual({ status: 'PENDING', walletTxn: 'PENDING', refunds: [], keyed: 0, wallet: START - AMOUNT, conflicts: [] });
    } finally {
      await dropTriggers();
    }
    await expect(refundFailedBill(bill, 'rail_failed', externalRef)).resolves.toMatchObject({ status: 'FAILED' });
    await expect(refundFailedBill(bill, 'rail_failed', externalRef)).resolves.toMatchObject({ status: 'FAILED' });
    expect(await ledger(bill.id)).toEqual({ ...REFUNDED, conflicts: [] });
  });

  it('a settlement that fails mid-transaction rolls back; the retry settles and a later failure is refused', async () => {
    const { bill, externalRef } = await pendingBill();
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_fail_settle_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW."resourceId" = '${bill.id}' AND NEW.action = 'BILL_PAYMENT_COMPLETED' THEN RAISE EXCEPTION 'e2e simulated settle failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER e2e_fail_settle_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION e2e_fail_settle_audit()',
    );
    try {
      await expect(settleBillPayment(bill, externalRef)).rejects.toThrow(/e2e simulated settle failure/);
      expect(await ledger(bill.id)).toEqual({ status: 'PENDING', walletTxn: 'PENDING', refunds: [], keyed: 0, wallet: START - AMOUNT, conflicts: [] });
    } finally {
      await dropTriggers();
    }
    await expect(settleBillPayment(bill, externalRef)).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(refundFailedBill(bill, 'late_failure', externalRef)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(await ledger(bill.id)).toEqual({ ...SETTLED, conflicts: ['BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT'] });
  });

  it('a storm of concurrent contradictory events: no phantom credit, no completed-and-refunded bill, no duplicate refund', async () => {
    const employeeId = await newEmployee();
    const bills = await Promise.all(Array.from({ length: 4 }, () => pendingBill(employeeId)));
    const events = bills.flatMap(({ bill, externalRef }) => [
      { billId: bill.id, kind: 'settle', run: () => settleBillPayment(bill, externalRef) },
      { billId: bill.id, kind: 'refund', run: () => refundFailedBill(bill, 'rail_failed', externalRef) },
      { billId: bill.id, kind: 'settle', run: () => settleBillPayment(bill, externalRef) },
      { billId: bill.id, kind: 'refund', run: () => refundFailedBill(bill, 'duplicate', externalRef) },
      { billId: bill.id, kind: 'refund', run: () => refundFailedBill(bill, 'rail_reported_reversed', externalRef) },
    ]);
    for (let i = events.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [events[i], events[j]] = [events[j], events[i]];
    }
    const results = await Promise.allSettled(events.map((e) => e.run()));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    // Judge each bill by what its settlement calls RETURNED: once the rail's
    // success was recorded, the bill must stay settled — a final FAILED +
    // one refund would look consistent but is exactly the defect.
    const settledByRail = new Set(
      events
        .filter((e, i) => e.kind === 'settle' && (results[i] as PromiseFulfilledResult<BillPayment>).value.status === 'COMPLETED')
        .map((e) => e.billId),
    );
    for (const { bill } of bills) {
      const view = await ledger(bill.id);
      if (settledByRail.has(bill.id)) {
        expect([view.status, view.walletTxn, view.refunds, view.keyed]).toEqual(['COMPLETED', 'COMPLETED', [], 0]);
      } else {
        expect([view.status, view.walletTxn, view.refunds, view.keyed]).toEqual(['FAILED', 'FAILED', [AMOUNT], 1]);
      }
    }
    // The wallet keeps exactly one debit per settled bill and nothing else.
    const wallet = (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).walletBalance;
    expect(wallet).toBe(START - AMOUNT * settledByRail.size);
  });
});
