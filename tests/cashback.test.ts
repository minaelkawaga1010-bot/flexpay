jest.mock('@config/prisma', () => {
  const tx = {
    employee: { update: jest.fn() },
    employeeTransaction: { create: jest.fn() },
  };
  return {
    prisma: {
      employee: { findUnique: jest.fn() },
      employeeTransaction: { aggregate: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock('@modules/notifications/notification.job', () => ({
  enqueueNotification: jest.fn().mockResolvedValue(undefined),
}));

import { cashbackService } from '@modules/cashback/cashback.service';
import { prisma } from '@config/prisma';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  employeeTransaction: { aggregate: jest.Mock };
  $transaction: jest.Mock;
  __tx: { employee: { update: jest.Mock }; employeeTransaction: { create: jest.Mock } };
};

describe('cashbackService.processCashback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('credits 1% for BASIC plan and respects the 100 AED monthly cap', async () => {
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    const result = await cashbackService.processCashback({
      employeeId: 'e1',
      amount: 200,
      plan: 'BASIC',
      merchantCategory: 'GROCERY',
    });
    expect(result?.awarded).toBe(2);
    expect(mocked.__tx.employeeTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 2, type: 'CASHBACK' }) }),
    );
  });

  it('caps cashback at remaining monthly headroom for BASIC plan', async () => {
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 99 } });
    const result = await cashbackService.processCashback({
      employeeId: 'e1',
      amount: 500,
      plan: 'BASIC',
      merchantCategory: 'RESTAURANT',
    });
    expect(result?.awarded).toBe(1);
  });

  it('returns 0 awarded once cap is exhausted (no DB write)', async () => {
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
    const result = await cashbackService.processCashback({
      employeeId: 'e1',
      amount: 500,
      plan: 'BASIC',
      merchantCategory: 'RESTAURANT',
    });
    expect(result?.awarded).toBe(0);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('credits 2.5% for LUXURY plan up to 300 AED cap', async () => {
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    const result = await cashbackService.processCashback({
      employeeId: 'e1',
      amount: 1000,
      plan: 'LUXURY',
      merchantCategory: 'TRAVEL',
    });
    expect(result?.awarded).toBe(25);
  });

  it('returns null for sub-cent potential cashback', async () => {
    const result = await cashbackService.processCashback({
      employeeId: 'e1',
      amount: 0.5,
      plan: 'BASIC',
    });
    expect(result).toBeNull();
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});
