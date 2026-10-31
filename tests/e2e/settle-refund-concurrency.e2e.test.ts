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
 * Nondeterministic winner, deterministic INVARIANT — judged by what the
 * settlement call RETURNED, not by a final status that can look
 * consistent after a settled bill was refunded (TASK-010):
 *   - settle returned COMPLETED (the rail's success was recorded first)
 *     ⇒ bill stays COMPLETED, no REFUND row, wallet NOT credited, the
 *       wallet txn is COMPLETED and the late failure is audited; or
 *   - settle returned FAILED (the refund was recorded first)
 *     ⇒ exactly one REFUND row, wallet credited once, wallet txn FAILED
 *       and the late success is audited.
 *   - neither call throws.
 */

const PHONE = '+971509900401';

async function wipe() {
  const e = await prisma.employee.findUnique({ where: { phone: PHONE } });
  if (!e) return;
  const bills = await prisma.billPayment.findMany({ where: { employeeId: e.id }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { resourceId: { in: bills.map((b) => b.id) } } });
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

    for (let round = 0; round < 10; round++) {
      const key = `settle-race-key-${round}`;
      const before = (await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).walletBalance;
      // The wallet was already debited 200 when this bill was submitted.
      const walletTxn = await prisma.employeeTransaction.create({
        data: {
          employeeId: employee.id,
          type: 'BILL_PAYMENT',
          amount: -200,
          fee: 0,
          totalAmount: -200,
          currency: 'AED',
          status: 'PENDING',
          reference: `bill-settle-race-${round}`,
          idempotencyKey: `bill:${key}`,
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
          idempotencyKey: key,
          walletTransactionId: walletTxn.id,
        },
      });

      const [settled, refunded] = await Promise.allSettled([
        settleBillPayment(bill, 'rail-ok'),
        refundFailedBill(bill, 'rail_failed'),
      ]);
      expect(settled.status).toBe('fulfilled');
      expect(refunded.status).toBe('fulfilled');
      const settleOutcome = (settled as PromiseFulfilledResult<{ status: string }>).value.status;

      const billAfter = await prisma.billPayment.findUniqueOrThrow({ where: { id: bill.id } });
      const txnAfter = await prisma.employeeTransaction.findUniqueOrThrow({ where: { id: walletTxn.id } });
      const refunds = await prisma.employeeTransaction.findMany({
        where: { idempotencyKey: refundIdempotencyKey(key), type: 'REFUND' },
      });
      const credited = (await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } })).walletBalance - before;
      const conflicts = (await prisma.auditLog.findMany({ where: { resourceId: bill.id } }))
        .map((a) => a.action)
        .filter((action) => action.endsWith('_CONFLICT'));

      if (settleOutcome === 'COMPLETED') {
        // The rail's success was recorded: the late failure must change nothing.
        expect(billAfter.status).toBe('COMPLETED');
        expect(txnAfter.status).toBe('COMPLETED');
        expect(refunds).toHaveLength(0);
        expect(credited).toBe(0);
        expect(conflicts).toEqual(['BILL_PAYMENT_FAILURE_AFTER_SETTLEMENT_CONFLICT']);
      } else {
        expect(settleOutcome).toBe('FAILED');
        expect(billAfter.status).toBe('FAILED');
        expect(txnAfter.status).toBe('FAILED');
        expect(refunds.map((r) => r.amount)).toEqual([200]);
        expect(credited).toBe(200);
        expect(conflicts).toEqual(['BILL_PAYMENT_SUCCESS_AFTER_FAILURE_CONFLICT']);
      }
      // Never both settled and refunded, never double-credited.
      expect(billAfter.status === 'COMPLETED' && refunds.length > 0).toBe(false);
    }
  });
});
