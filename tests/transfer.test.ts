jest.mock('../src/config/db', () => ({
  prisma: {
    employee: { findUnique: jest.fn(), update: jest.fn() },
    employeeTransaction: { create: jest.fn() },
    referral: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../src/services/notificationService', () => ({
  notificationService: {
    notifyTransferReceived: jest.fn().mockResolvedValue(undefined),
    notifyTransferSent: jest.fn().mockResolvedValue(undefined),
    notifyCashback: jest.fn().mockResolvedValue(undefined),
    notifyTrackingNumber: jest.fn().mockResolvedValue(undefined),
    notifySalaryCredited: jest.fn().mockResolvedValue(undefined),
  },
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/modules/referrals/referralService', () => ({
  referralService: { maybeReward: jest.fn().mockResolvedValue(undefined) },
}));

import { walletService } from '../src/modules/wallet/walletService';
import { prisma } from '../src/config/db';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

describe('walletService.transfer', () => {
  beforeEach(() => jest.resetAllMocks());

  it('rejects when sender has insufficient balance', async () => {
    mocked.employee.findUnique
      .mockResolvedValueOnce({
        id: 'sender',
        plan: 'BASIC',
        walletBalance: 50,
        phone: '+971500000001',
        fullName: 'Sender',
      })
      .mockResolvedValueOnce({
        id: 'receiver',
        plan: 'BASIC',
        walletBalance: 0,
        phone: '+971500000002',
        fullName: 'Receiver',
      });

    await expect(
      walletService.transfer('sender', '+971500000002', 100),
    ).rejects.toThrow(/Insufficient balance/);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('rejects self-transfers', async () => {
    mocked.employee.findUnique
      .mockResolvedValueOnce({
        id: 'sender',
        plan: 'BASIC',
        walletBalance: 1000,
        phone: '+971500000001',
        fullName: 'Sender',
      })
      .mockResolvedValueOnce({
        id: 'sender',
        plan: 'BASIC',
        walletBalance: 1000,
        phone: '+971500000001',
        fullName: 'Sender',
      });
    await expect(
      walletService.transfer('sender', '+971500000001', 100),
    ).rejects.toThrow(/yourself/);
  });

  it('charges 2 AED fee for BASIC and 0 for LUXURY', async () => {
    mocked.employee.findUnique
      .mockResolvedValueOnce({
        id: 'sender',
        plan: 'BASIC',
        walletBalance: 1000,
        phone: '+971500000001',
        fullName: 'Sender',
      })
      .mockResolvedValueOnce({
        id: 'receiver',
        plan: 'BASIC',
        walletBalance: 0,
        phone: '+971500000002',
        fullName: 'Receiver',
      });
    mocked.$transaction.mockResolvedValue([
      { walletBalance: 1000 - 200 - 2 },
      {},
      { id: 'tx-1' },
      {},
    ]);

    const result = await walletService.transfer('sender', '+971500000002', 200);
    expect(result.fee).toBe(2);
    expect(result.balance).toBe(798);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);

    mocked.employee.findUnique
      .mockResolvedValueOnce({
        id: 'sender',
        plan: 'LUXURY',
        walletBalance: 1000,
        phone: '+971500000001',
        fullName: 'Sender',
      })
      .mockResolvedValueOnce({
        id: 'receiver',
        plan: 'BASIC',
        walletBalance: 0,
        phone: '+971500000002',
        fullName: 'Receiver',
      });
    mocked.$transaction.mockResolvedValue([
      { walletBalance: 1000 - 200 },
      {},
      { id: 'tx-2' },
      {},
    ]);

    const luxuryResult = await walletService.transfer('sender', '+971500000002', 200);
    expect(luxuryResult.fee).toBe(0);
    expect(luxuryResult.balance).toBe(800);
  });

  it('rejects non-positive amounts', async () => {
    await expect(walletService.transfer('s', '+971500000002', 0)).rejects.toThrow(/positive/);
    await expect(walletService.transfer('s', '+971500000002', -10)).rejects.toThrow(/positive/);
  });
});
