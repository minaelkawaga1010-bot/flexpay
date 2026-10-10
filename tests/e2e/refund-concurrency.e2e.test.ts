import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { refundFailedBill, refundIdempotencyKey } from '@modules/bill-payment/bill-payment.service';

/**
 * TASK-003 — real-PostgreSQL proof that concurrent refunds of the same
 * failed bill credit the wallet EXACTLY once and never 500. Requires a
 * live Postgres + Redis; runs only via `npm run test:e2e`.
 *
 * Two simultaneous refundFailedBill() calls on one PENDING bill (the
 * sync adapter-failure path racing the async biller webhook) must:
 *   - both resolve (no unhandled P2002 / 500),
 *   - produce exactly ONE bill:refund:<key> ledger row,
 *   - credit the wallet exactly once,
 *   - leave the bill FAILED.
 */

const PHONE = '+971509900301';

async function wipe() {
  const e = await prisma.employee.findUnique({ where: { phone: PHONE } });
  if (!e) return;
  await prisma.billPayment.deleteMany({ where: { employeeId: e.id } });
  await prisma.employeeTransaction.deleteMany({ where: { employeeId: e.id } });
  await prisma.employee.delete({ where: { id: e.id } });
}

describe('refundFailedBill — PostgreSQL concurrency (TASK-003)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('two simultaneous refunds credit the wallet exactly once and never throw', async () => {
    const employee = await prisma.employee.create({
      data: { phone: PHONE, fullName: 'Refund Race', plan: 'BASIC', status: 'ACTIVE', walletBalance: 0 },
    });

    // Original debit txn (PENDING) for the bill.
    const walletTxn = await prisma.employeeTransaction.create({
      data: {
        employeeId: employee.id,
        type: 'BILL_PAYMENT',
        amount: -200,
        fee: 0,
        totalAmount: -200,
        currency: 'AED',
        status: 'PENDING',
        reference: 'bill-race',
        idempotencyKey: 'bill:race-key',
      },
    });

    const bill = await prisma.billPayment.create({
      data: {
        employeeId: employee.id,
        billerType: 'DEWA',
        billerAccountRef: 'DEWA-RACE',
        amount: 200,
        fee: 0,
        totalAmount: 200,
        currency: 'AED',
        status: 'PENDING',
        idempotencyKey: 'race-key',
        walletTransactionId: walletTxn.id,
      },
    });

    const results = await Promise.allSettled([
      refundFailedBill(bill, 'adapter_failed'),
      refundFailedBill(bill, 'webhook_failed'),
    ]);

    // Neither call throws — the loser resolves as an idempotent no-op.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // Exactly ONE refund ledger row under the namespaced key.
    const refunds = await prisma.employeeTransaction.count({
      where: { idempotencyKey: refundIdempotencyKey('race-key'), type: 'REFUND' },
    });
    expect(refunds).toBe(1);

    // Wallet credited exactly once (0 + 200).
    const after = await prisma.employee.findUnique({ where: { id: employee.id } });
    expect(after?.walletBalance).toBe(200);

    const billAfter = await prisma.billPayment.findUnique({ where: { id: bill.id } });
    expect(billAfter?.status).toBe('FAILED');
  });
});
