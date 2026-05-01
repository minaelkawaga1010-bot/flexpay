jest.mock('../src/config/db', () => ({
  prisma: {
    employee: { findUnique: jest.fn() },
    employeeTransaction: { count: jest.fn() },
    referral: { count: jest.fn() },
    loan: { count: jest.fn() },
  },
}));

import { creditScoreService } from '../src/modules/scoring/creditScoreService';
import { prisma } from '../src/config/db';

const mockedPrisma = prisma as unknown as {
  employee: { findUnique: jest.Mock };
  employeeTransaction: { count: jest.Mock };
  referral: { count: jest.Mock };
  loan: { count: jest.Mock };
};

describe('creditScoreService.compute', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    await creditScoreService.invalidate('emp-1');
  });

  it('uses base 50 when there is no history', async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ walletBalance: 0, salary: 0 });
    mockedPrisma.employeeTransaction.count.mockResolvedValue(0);
    mockedPrisma.referral.count.mockResolvedValue(0);
    mockedPrisma.loan.count.mockResolvedValue(0);

    const result = await creditScoreService.compute('emp-1', { skipCache: true });
    expect(result.score).toBe(50);
    expect(result.eligibleForEWA).toBe(false);
    expect(result.maxEWAAmount).toBe(0);
  });

  it('rewards transactions, balance, and referrals — and gates EWA at 60', async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ walletBalance: 600, salary: 4000 });
    mockedPrisma.employeeTransaction.count.mockResolvedValue(15); // +10
    mockedPrisma.referral.count.mockResolvedValue(2); // +5
    mockedPrisma.loan.count.mockResolvedValue(0);

    const result = await creditScoreService.compute('emp-1', { skipCache: true });
    // 50 base + 10 tx + 15 balance + 5 referrals = 80
    expect(result.score).toBe(80);
    expect(result.eligibleForEWA).toBe(true);
    expect(result.maxEWAAmount).toBe(2000);
  });

  it('penalises defaulted loans and clamps to 0', async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ walletBalance: 0, salary: 3000 });
    mockedPrisma.employeeTransaction.count.mockResolvedValue(0);
    mockedPrisma.referral.count.mockResolvedValue(0);
    mockedPrisma.loan.count.mockResolvedValue(5); // -75

    const result = await creditScoreService.compute('emp-1', { skipCache: true });
    expect(result.score).toBe(0);
    expect(result.eligibleForEWA).toBe(false);
  });

  it('clamps maximum score at 100', async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ walletBalance: 1000, salary: 5000 });
    mockedPrisma.employeeTransaction.count.mockResolvedValue(50);
    mockedPrisma.referral.count.mockResolvedValue(10);
    mockedPrisma.loan.count.mockResolvedValue(0);

    const result = await creditScoreService.compute('emp-1', { skipCache: true });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThan(90);
  });
});
