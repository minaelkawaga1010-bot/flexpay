jest.mock('@config/prisma', () => {
  const tx = {
    employee: { findFirst: jest.fn(), update: jest.fn() },
    employeeTransaction: { create: jest.fn() },
  };
  return {
    prisma: {
      employee: { findUnique: jest.fn(), findFirst: jest.fn() },
      employeeTransaction: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock('@modules/notifications/notification.job', () => ({
  enqueueNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@modules/referrals/referrals.service', () => ({
  referralsService: { maybeReward: jest.fn().mockResolvedValue(undefined) },
}));

import { walletService } from '@modules/wallet/wallet.service';
import { prisma } from '@config/prisma';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  employeeTransaction: { findUnique: jest.Mock };
  $transaction: jest.Mock;
  __tx: {
    employee: { findFirst: jest.Mock; update: jest.Mock };
    employeeTransaction: { create: jest.Mock };
  };
};

const mockSender = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'sender',
  status: 'ACTIVE',
  plan: 'BASIC',
  walletBalance: 1000,
  phone: '+971500000001',
  fullName: 'Sender',
  ...overrides,
});
const mockReceiver = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'receiver',
  status: 'ACTIVE',
  plan: 'BASIC',
  walletBalance: 0,
  phone: '+971500000002',
  fullName: 'Receiver',
  ...overrides,
});

describe('walletService.transfer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.employeeTransaction.findUnique.mockResolvedValue(null);
  });

  it('rejects when sender has insufficient balance', async () => {
    mocked.__tx.employee.findFirst
      .mockResolvedValueOnce(mockSender({ walletBalance: 50 }))
      .mockResolvedValueOnce(mockReceiver());

    await expect(
      walletService.transfer({
        senderId: 'sender',
        recipientPhone: '+971500000002',
        amount: 100,
      }),
    ).rejects.toThrow(/INSUFFICIENT_BALANCE/);
  });

  it('rejects self-transfers', async () => {
    mocked.__tx.employee.findFirst
      .mockResolvedValueOnce(mockSender())
      .mockResolvedValueOnce(mockSender({ id: 'sender', phone: '+971500000001' }));

    await expect(
      walletService.transfer({
        senderId: 'sender',
        recipientPhone: '+971500000001',
        amount: 100,
      }),
    ).rejects.toThrow(/CANNOT_TRANSFER_TO_SELF/);
  });

  it('charges 2 AED fee for BASIC and 0 for LUXURY, with signed sender amount', async () => {
    mocked.__tx.employee.findFirst
      .mockResolvedValueOnce(mockSender())
      .mockResolvedValueOnce(mockReceiver());
    mocked.__tx.employeeTransaction.create
      .mockResolvedValueOnce({ id: 'tx-1', fee: 2 })
      .mockResolvedValueOnce({ id: 'tx-2-credit' });

    const basic = await walletService.transfer({
      senderId: 'sender',
      recipientPhone: '+971500000002',
      amount: 200,
    });
    expect(basic.fee).toBe(2);
    expect(basic.balance).toBe(798);
    expect(mocked.__tx.employeeTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: -200, totalAmount: -202, type: 'TRANSFER' }),
      }),
    );

    mocked.__tx.employee.findFirst
      .mockResolvedValueOnce(mockSender({ plan: 'LUXURY' }))
      .mockResolvedValueOnce(mockReceiver());
    mocked.__tx.employeeTransaction.create
      .mockResolvedValueOnce({ id: 'tx-3', fee: 0 })
      .mockResolvedValueOnce({ id: 'tx-4' });

    const luxury = await walletService.transfer({
      senderId: 'sender',
      recipientPhone: '+971500000002',
      amount: 200,
    });
    expect(luxury.fee).toBe(0);
    expect(luxury.balance).toBe(800);
  });

  it('rejects non-positive amounts', async () => {
    await expect(
      walletService.transfer({ senderId: 's', recipientPhone: '+971500000002', amount: 0 }),
    ).rejects.toThrow(/positive/);
    await expect(
      walletService.transfer({ senderId: 's', recipientPhone: '+971500000002', amount: -10 }),
    ).rejects.toThrow(/positive/);
  });

  it('replays a prior transaction when the same Idempotency-Key is supplied', async () => {
    mocked.employeeTransaction.findUnique.mockResolvedValueOnce({
      id: 'tx-replay',
      fee: 2,
    });
    mocked.employee.findUnique = jest.fn().mockResolvedValue({ walletBalance: 798 });

    const result = await walletService.transfer({
      senderId: 'sender',
      recipientPhone: '+971500000002',
      amount: 200,
      idempotencyKey: 'idem-1',
    });

    expect(result).toMatchObject({ replay: true, transactionId: 'tx-replay', balance: 798, fee: 2 });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});
