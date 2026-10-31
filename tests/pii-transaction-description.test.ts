/**
 * TASK-018.0 — no PII in NEW financial transaction descriptions (unit).
 *
 * The P2P writers embedded the counterparty's phone in the free-text
 * `description`; the history API returned the counterparty's full phone.
 * These assert a CANARY identity (Arabic + Unicode + punctuation) never
 * lands in a persisted description, and that the history response masks the
 * counterparty phone. The same checks reproduce the exposure on pre-fix.
 */

jest.mock('@config/prisma', () => {
  const tx = {
    employee: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    employeeTransaction: { create: jest.fn() },
  };
  return {
    prisma: {
      employee: { findUnique: jest.fn(), findFirst: jest.fn() },
      employeeTransaction: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});
jest.mock('@shared/utils/advisory-lock', () => ({
  acquireWorkerLockScoped: jest.fn().mockResolvedValue(undefined),
  LockScope: { EWA_RESERVATION: 1, EWA_RECOVERY: 2, WALLET_DEBIT: 3, COMPLIANCE_REVIEW: 4 },
}));
jest.mock('@modules/notifications/notification.job', () => ({ enqueueNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@modules/referrals/referrals.service', () => ({ referralsService: { maybeReward: jest.fn().mockResolvedValue(undefined) } }));

import { walletService } from '@modules/wallet/wallet.service';
import { prisma } from '@config/prisma';

const mocked = prisma as unknown as {
  employeeTransaction: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  __tx: {
    employee: { findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    employeeTransaction: { create: jest.Mock };
  };
};

// Arabic script + Latin + Unicode + punctuation, plus a canary phone.
const CANARY_NAME = 'عبدﷲ <Jörg-O’Neill>';
const CANARY_SENDER_PHONE = '+97150SENDER9911';
const CANARY_RECIPIENT_PHONE = '+97150RECIP8822';

beforeEach(() => {
  jest.clearAllMocks();
  mocked.employeeTransaction.findUnique.mockResolvedValue(null);
  mocked.__tx.employee.updateMany.mockResolvedValue({ count: 1 });
  mocked.__tx.employee.update.mockResolvedValue({});
  mocked.__tx.employeeTransaction.create.mockResolvedValue({ id: 'txn' });
});

describe('P2P transfer descriptions never persist PII (TASK-018.0)', () => {
  it('neither the sender nor the recipient row stores a phone or name in its description', async () => {
    mocked.__tx.employee.findFirst
      .mockResolvedValueOnce({ id: 'sender', status: 'ACTIVE', plan: 'BASIC', walletBalance: 1000, phone: CANARY_SENDER_PHONE, fullName: CANARY_NAME })
      .mockResolvedValueOnce({ id: 'recipient', status: 'ACTIVE', plan: 'BASIC', walletBalance: 0, phone: CANARY_RECIPIENT_PHONE, fullName: CANARY_NAME });

    await walletService.transfer({ senderId: 'sender', recipientPhone: CANARY_RECIPIENT_PHONE, amount: 100 });

    const descriptions = mocked.__tx.employeeTransaction.create.mock.calls.map((c) => c[0].data.description as string);
    expect(descriptions).toHaveLength(2);
    for (const d of descriptions) {
      expect(d).not.toContain(CANARY_SENDER_PHONE);
      expect(d).not.toContain(CANARY_RECIPIENT_PHONE);
      expect(d).not.toContain(CANARY_NAME);
    }
    // Neutral, structured, and still distinguishes direction.
    expect(descriptions).toEqual(['P2P transfer sent', 'P2P transfer received']);
    // Traceability preserved via structured counterparty id (not free text).
    const data = mocked.__tx.employeeTransaction.create.mock.calls.map((c) => c[0].data);
    expect(data[0].counterpartyId).toBe('recipient');
    expect(data[1].counterpartyId).toBe('sender');
  });
});

describe('transaction history masks the counterparty phone (TASK-018.0 §8)', () => {
  it('returns a masked counterparty phone, never the full number', async () => {
    mocked.employeeTransaction.findMany.mockResolvedValue([
      { id: 't1', type: 'RECEIVE', amount: 100, fee: 0, totalAmount: 100, currency: 'AED', status: 'COMPLETED', description: 'P2P transfer received', merchantName: null, counterpartyPhone: '+971500001234', createdAt: new Date() },
    ]);
    mocked.employeeTransaction.count.mockResolvedValue(1);

    const res = await walletService.getTransactions('me', {});
    expect(res.transactions[0].counterpartyPhone).toBe('••••1234');
    expect(res.transactions[0].counterpartyPhone).not.toContain('500001234');
  });

  it('null counterparty phone stays null (non-P2P rows)', async () => {
    mocked.employeeTransaction.findMany.mockResolvedValue([
      { id: 't2', type: 'PAYROLL', amount: 5000, fee: 0, totalAmount: 5000, currency: 'AED', status: 'COMPLETED', description: 'Salary', merchantName: null, counterpartyPhone: null, createdAt: new Date() },
    ]);
    mocked.employeeTransaction.count.mockResolvedValue(1);
    const res = await walletService.getTransactions('me', {});
    expect(res.transactions[0].counterpartyPhone).toBeNull();
  });
});
