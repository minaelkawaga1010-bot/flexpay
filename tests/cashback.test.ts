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

jest.mock('@modules/notifications/notification.service', () => ({
  notificationService: { notifyCashback: jest.fn().mockResolvedValue(undefined) },
}));

import { cashbackService } from '@modules/cashback/cashback.service';
import { prisma } from '@config/prisma';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  employeeTransaction: { aggregate: jest.Mock };
  $transaction: jest.Mock;
  __tx: { employee: { update: jest.Mock }; employeeTransaction: { create: jest.Mock } };
};

describe('cashbackService.credit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('credits 1% for BASIC plan and respects the 100 AED monthly cap', async () => {
    mocked.employee.findUnique.mockResolvedValue({ id: 'e1', plan: 'BASIC' });
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    const credited = await cashbackService.credit('e1', 200, 'GROCERY');
    expect(credited).toBe(2);
    expect(mocked.__tx.employeeTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 2, type: 'CASHBACK' }) }),
    );
  });

  it('caps cashback at remaining monthly headroom for BASIC plan', async () => {
    mocked.employee.findUnique.mockResolvedValue({ id: 'e1', plan: 'BASIC' });
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 99 } });
    const credited = await cashbackService.credit('e1', 500, 'RESTAURANT');
    expect(credited).toBe(1);
  });

  it('returns 0 once cap is exhausted', async () => {
    mocked.employee.findUnique.mockResolvedValue({ id: 'e1', plan: 'BASIC' });
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
    const credited = await cashbackService.credit('e1', 500, 'RESTAURANT');
    expect(credited).toBe(0);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it('credits 2.5% for LUXURY plan up to 300 AED cap', async () => {
    mocked.employee.findUnique.mockResolvedValue({ id: 'e1', plan: 'LUXURY' });
    mocked.employeeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    const credited = await cashbackService.credit('e1', 1000, 'TRAVEL');
    expect(credited).toBe(25);
  });

  it('returns 0 when employee is missing', async () => {
    mocked.employee.findUnique.mockResolvedValue(null);
    const credited = await cashbackService.credit('missing', 100, 'X');
    expect(credited).toBe(0);
  });
});
