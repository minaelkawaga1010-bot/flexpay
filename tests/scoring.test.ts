jest.mock('@config/prisma', () => ({
  prisma: {
    employee: { findUnique: jest.fn(), update: jest.fn() },
    employeeTransaction: { count: jest.fn() },
    referral: { count: jest.fn() },
    loan: { count: jest.fn() },
  },
}));

import { creditScoringService } from '@modules/scoring/scoring.service';
import { prisma } from '@config/prisma';

const mocked = prisma as unknown as {
  employee: { findUnique: jest.Mock; update: jest.Mock };
  employeeTransaction: { count: jest.Mock };
  referral: { count: jest.Mock };
  loan: { count: jest.Mock };
};

const baseEmployee = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'emp-1',
  status: 'ACTIVE',
  walletBalance: 0,
  salary: 0,
  creditScore: null,
  creditScoreUpdatedAt: null,
  ...overrides,
});

describe('creditScoringService.computeScore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The service writes the freshly-computed score back via prisma.employee.update
    // and then passes the *returned* row to buildResponse(). We have to preserve the
    // fields that buildResponse() reads (notably `salary` for the EWA cap) by
    // chaining off whatever findUnique most recently resolved with.
    mocked.employee.update.mockImplementation(async ({ data, where }) => {
      const last =
        (mocked.employee.findUnique as jest.Mock).mock.results.at(-1)?.value ??
        baseEmployee();
      const resolved = await Promise.resolve(last);
      return { ...resolved, ...(data ?? {}), id: where.id ?? resolved.id };
    });
  });

  it('uses base 50 when there is no history', async () => {
    mocked.employee.findUnique.mockResolvedValue(baseEmployee());
    mocked.employeeTransaction.count.mockResolvedValue(0);
    mocked.referral.count.mockResolvedValue(0);
    mocked.loan.count.mockResolvedValue(0);

    const result = await creditScoringService.computeScore('emp-1', true);
    expect(result.score).toBe(50);
    expect(result.eligibleForEWA).toBe(false);
    expect(result.maxEWAAmount).toBe(0);
  });

  it('rewards transactions, balance, and referrals — gates EWA at 60', async () => {
    mocked.employee.findUnique.mockResolvedValue(baseEmployee({ walletBalance: 600, salary: 4000 }));
    mocked.employeeTransaction.count.mockResolvedValue(15); // +10
    mocked.referral.count.mockResolvedValue(2); // +5
    mocked.loan.count.mockResolvedValue(0);

    const result = await creditScoringService.computeScore('emp-1', true);
    // 50 + 10 + 15 + 5 = 80
    expect(result.score).toBe(80);
    expect(result.eligibleForEWA).toBe(true);
    // multiplier = 0.3 + 0.8 * 0.2 = 0.46; salary 4000 -> 1840 (rounded), capped at 2000
    expect(result.maxEWAAmount).toBe(1840);
  });

  it('penalises defaulted loans and clamps to 0', async () => {
    mocked.employee.findUnique.mockResolvedValue(baseEmployee({ walletBalance: 0, salary: 3000 }));
    mocked.employeeTransaction.count.mockResolvedValue(0);
    mocked.referral.count.mockResolvedValue(0);
    mocked.loan.count.mockResolvedValue(5); // -75

    const result = await creditScoringService.computeScore('emp-1', true);
    expect(result.score).toBe(0);
    expect(result.eligibleForEWA).toBe(false);
  });

  it('clamps maximum score at 100', async () => {
    mocked.employee.findUnique.mockResolvedValue(baseEmployee({ walletBalance: 1000, salary: 5000 }));
    mocked.employeeTransaction.count.mockResolvedValue(50);
    mocked.referral.count.mockResolvedValue(10);
    mocked.loan.count.mockResolvedValue(0);

    const result = await creditScoringService.computeScore('emp-1', true);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThan(90);
  });

  it('returns the cached score within the TTL window without recomputing', async () => {
    const cached = baseEmployee({
      walletBalance: 600,
      salary: 4000,
      creditScore: 80,
      creditScoreUpdatedAt: new Date(),
    });
    mocked.employee.findUnique.mockResolvedValue(cached);
    mocked.employeeTransaction.count.mockResolvedValue(0);
    mocked.referral.count.mockResolvedValue(0);
    mocked.loan.count.mockResolvedValue(0);

    const result = await creditScoringService.computeScore('emp-1');
    expect(result.score).toBe(80);
    expect(mocked.employee.update).not.toHaveBeenCalled();
  });
});
