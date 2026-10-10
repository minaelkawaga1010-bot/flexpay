import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import {
  refundFailedBill,
  settleBillPayment,
  refundIdempotencyKey,
} from '@modules/bill-payment/bill-payment.service';

/**
 * TASK-004 — real-PostgreSQL proof that a settle racing a refund on the
 * same PENDING bill resolves to ONE consistent terminal state, never a
 * phantom credit (COMPLETED bill whose wallet was also refunded).
 * Requires a live Postgres + Redis; runs only via `npm run test:e2e`.
 *
 * Nondeterministic winner, deterministic INVARIANT:
 *   - bill ends COMPLETED  ⇒ no REFUND row, wallet NOT credited; or
 *   - bill ends FAILED     ⇒ exactly one REFUND row, wallet credited once.
 *   - neither call throws.
 */

const PHONE = '+971509900401';

async function wipe() {
  const e = await prisma.employee.findUnique({ where: { phone: PHONE } });
  if (!e) return;
  await prisma.billPayment.deleteMany({ where: { employeeId: e.id } });
  await prisma.employeeTransaction.deleteMany({ where: { employeeId: e.id } });
  await prisma.employee.delete({ where: { id: e.id } });
}

describe('settle vs refund — PostgreSQL concurrency (TASK-004)', () => {
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

  it('a settle racing a refund yields one consistent terminal state (no phantom credit)', async () => {
    const employee = await prisma.employee.create({
      data: { phone: PHONE, fullName: 'Settle Race', plan: 'BASIC', status: 'ACTIVE', walletBalance: 0 },
    });
    const walletTxn = await prisma.employeeTransaction.create({
      data: {
        employeeId: employee.id,
        type: 'BILL_PAYMENT',
        amount: -200,
        fee: 0,
        totalAmount: -200,
        currency: 'AED',
        status: 'PENDING',
        reference: 'bill-settle-race',
        idempotencyKey: 'bill:settle-race-key',
      },
    });
    const bill = await prisma.billPayment.create({
      data: {
        employeeId: employee.id,
        billerType: 'DEWA',
        billerAccountRef: 'DEWA-SETTLE-RACE',
        amount: 200,
        fee: 0,
        totalAmount: 200,
        currency: 'AED',
        status: 'PENDING',
        idempotencyKey: 'settle-race-key',
        walletTransactionId: walletTxn.id,
      },
    });

    const results = await Promise.allSettled([
      settleBillPayment(bill, 'rail-ok'),
      refundFailedBill(bill, 'rail_failed'),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const billAfter = await prisma.billPayment.findUnique({ where: { id: bill.id } });
    const employeeAfter = await prisma.employee.findUnique({ where: { id: employee.id } });
    const refundCount = await prisma.employeeTransaction.count({
      where: { idempotencyKey: refundIdempotencyKey('settle-race-key'), type: 'REFUND' },
    });

    // The consistency invariant — whichever path won, the wallet matches.
    if (billAfter?.status === 'COMPLETED') {
      expect(refundCount).toBe(0);
      expect(employeeAfter?.walletBalance).toBe(0);
    } else {
      expect(billAfter?.status).toBe('FAILED');
      expect(refundCount).toBe(1);
      expect(employeeAfter?.walletBalance).toBe(200);
    }
    // Never negative, never double-credited.
    expect(employeeAfter?.walletBalance ?? -1).toBeGreaterThanOrEqual(0);
    expect(employeeAfter?.walletBalance ?? 999).toBeLessThanOrEqual(200);
  });
});
