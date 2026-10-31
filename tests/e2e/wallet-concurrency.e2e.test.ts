import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import { closeAllQueues } from '@config/bull';
import { walletService } from '@modules/wallet/wallet.service';

/**
 * TASK-002 — real-PostgreSQL concurrency proof for the legacy wallet
 * transfer. Requires a live Postgres (see docker-compose) + Redis; this
 * suite runs only via `npm run test:e2e`, never in the default unit run.
 *
 * Invariant under test: two simultaneous transfers whose COMBINED amount
 * exceeds the available balance must NOT both succeed, and the sender's
 * balance must never go negative. The guarded `updateMany ... where
 * walletBalance >= total` (+ WALLET_DEBIT advisory lock) is what makes
 * this hold under true row-level concurrency — something a mocked unit
 * test cannot prove.
 */

const SENDER_PHONE = '+971509900101';
const RECIPIENT_PHONE = '+971509900102';

async function wipe(phone: string) {
  const e = await prisma.employee.findUnique({ where: { phone } });
  if (!e) return;
  await prisma.employeeTransaction.deleteMany({ where: { employeeId: e.id } });
  await prisma.employee.delete({ where: { id: e.id } });
}

describe('Wallet transfer — PostgreSQL concurrency (TASK-002)', () => {
  let senderId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await redisService.connect();
    await wipe(SENDER_PHONE);
    await wipe(RECIPIENT_PHONE);

    // LUXURY ⇒ zero P2P fee, so a 100 transfer debits exactly 100 and
    // the "combined > balance" arithmetic is clean.
    const sender = await prisma.employee.create({
      data: {
        phone: SENDER_PHONE,
        fullName: 'Concurrency Sender',
        plan: 'LUXURY',
        status: 'ACTIVE',
        walletBalance: 100,
      },
    });
    senderId = sender.id;
    await prisma.employee.create({
      data: {
        phone: RECIPIENT_PHONE,
        fullName: 'Concurrency Recipient',
        plan: 'BASIC',
        status: 'ACTIVE',
        walletBalance: 0,
      },
    });
  });

  afterAll(async () => {
    await wipe(SENDER_PHONE);
    await wipe(RECIPIENT_PHONE);
    await closeAllQueues();
    await redisService.disconnect();
    await prisma.$disconnect();
  });

  it('two simultaneous 100 transfers from a 100 balance: exactly one succeeds, no negative balance', async () => {
    const fire = () =>
      walletService.transfer({ senderId, recipientPhone: RECIPIENT_PHONE, amount: 100 });

    const results = await Promise.allSettled([fire(), fire()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one wins, one loses with INSUFFICIENT_BALANCE.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason?.message ?? '')).toMatch(
      /INSUFFICIENT_BALANCE/,
    );

    // The core invariant: balance settled at exactly 0, never negative.
    const senderAfter = await prisma.employee.findUnique({ where: { id: senderId } });
    expect(senderAfter?.walletBalance).toBe(0);
    expect(senderAfter?.walletBalance ?? -1).toBeGreaterThanOrEqual(0);

    const recipientAfter = await prisma.employee.findUnique({ where: { phone: RECIPIENT_PHONE } });
    expect(recipientAfter?.walletBalance).toBe(100);

    // Exactly one debit ledger row for the sender (no duplicate posting).
    const senderDebits = await prisma.employeeTransaction.count({
      where: { employeeId: senderId, type: 'TRANSFER' },
    });
    expect(senderDebits).toBe(1);
  });
});
