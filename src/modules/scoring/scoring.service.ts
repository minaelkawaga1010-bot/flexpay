import { Employee, EmployeeStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import logger from '@shared/utils/logger';
import { NotFound } from '@shared/utils/errors';

export interface CreditScoreResponse {
  score: number;
  breakdown: {
    base: number;
    transactions: number;
    balance: number;
    referrals: number;
    defaults: number;
  };
  eligibleForEWA: boolean;
  maxEWAAmount: number;
  computedAt: Date;
  nextReviewAt: Date;
}

interface ComputeFactors {
  transactionCount: number;
  successfulReferrals: number;
  defaultedLoans: number;
  balance: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class CreditScoringService {
  private readonly config = {
    baseScore: 50,
    transactionThresholds: [
      { count: 20, points: 20 },
      { count: 10, points: 10 },
      { count: 5, points: 5 },
    ],
    balanceThresholds: [
      { amount: 500, points: 15 },
      { amount: 200, points: 10 },
      { amount: 100, points: 5 },
    ],
    referralThresholds: [
      { count: 3, points: 10 },
      { count: 1, points: 5 },
    ],
    defaultPenalty: 15,
  };

  /**
   * Compute the credit score for an employee. Cached for 24h on the
   * Employee row itself (`creditScore` + `creditScoreUpdatedAt`) — server
   * authoritative, no client input.
   */
  async computeScore(employeeId: string, forceRefresh = false): Promise<CreditScoreResponse> {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('EMPLOYEE_NOT_FOUND');

    if (!forceRefresh && employee.creditScore !== null && employee.creditScoreUpdatedAt) {
      const age = Date.now() - employee.creditScoreUpdatedAt.getTime();
      if (age < CACHE_TTL_MS) {
        const factors = await this.collectFactors(employeeId, employee.walletBalance);
        const breakdown = this.deriveBreakdown(factors);
        return this.buildResponse(employee, employee.creditScore, breakdown, employee.creditScoreUpdatedAt);
      }
    }

    const factors = await this.collectFactors(employeeId, employee.walletBalance);
    const breakdown = this.deriveBreakdown(factors);
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    const score = Math.min(100, Math.max(0, total));

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: { creditScore: score, creditScoreUpdatedAt: new Date() },
    });

    return this.buildResponse(updated, score, breakdown, updated.creditScoreUpdatedAt!);
  }

  async invalidate(employeeId: string): Promise<void> {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { creditScoreUpdatedAt: null },
    });
  }

  /** Refresh stale scores in the background — runs on a daily cron. */
  async batchUpdateScores(): Promise<{ refreshed: number; failed: number }> {
    const stale = await prisma.employee.findMany({
      where: {
        status: EmployeeStatus.ACTIVE,
        OR: [
          { creditScoreUpdatedAt: null },
          { creditScoreUpdatedAt: { lte: new Date(Date.now() - CACHE_TTL_MS) } },
        ],
      },
      select: { id: true },
    });

    logger.info('Batch updating credit scores', { count: stale.length });

    let refreshed = 0;
    let failed = 0;
    for (const { id } of stale) {
      try {
        await this.computeScore(id, true);
        refreshed++;
      } catch (err) {
        failed++;
        logger.error('credit score refresh failed', {
          employeeId: id,
          error: (err as Error).message,
        });
      }
      // Light pacing so we don't saturate Postgres on huge tables.
      await new Promise((r) => setTimeout(r, 50));
    }

    return { refreshed, failed };
  }

  // --------------------------------------------------------- internals

  private async collectFactors(employeeId: string, balance: number): Promise<ComputeFactors> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [transactionCount, successfulReferrals, defaultedLoans] = await Promise.all([
      prisma.employeeTransaction.count({
        where: {
          employeeId,
          createdAt: { gte: ninetyDaysAgo },
          status: 'COMPLETED',
          type: { in: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'RECEIVE', 'CARD_PURCHASE'] },
        },
      }),
      prisma.referral.count({ where: { referrerId: employeeId, rewardGiven: true } }),
      prisma.loan.count({ where: { employeeId, status: 'DEFAULTED' } }),
    ]);

    return { transactionCount, successfulReferrals, defaultedLoans, balance };
  }

  private deriveBreakdown(f: ComputeFactors): CreditScoreResponse['breakdown'] {
    const find = <T extends { points: number }>(rules: T[], pred: (r: T) => boolean) =>
      rules.find(pred)?.points ?? 0;

    return {
      base: this.config.baseScore,
      transactions: find(this.config.transactionThresholds, (t) => f.transactionCount >= t.count),
      balance: find(this.config.balanceThresholds, (t) => f.balance >= t.amount),
      referrals: find(this.config.referralThresholds, (t) => f.successfulReferrals >= t.count),
      defaults: -f.defaultedLoans * this.config.defaultPenalty,
    };
  }

  private buildResponse(
    employee: Employee,
    score: number,
    breakdown: CreditScoreResponse['breakdown'],
    computedAt: Date,
  ): CreditScoreResponse {
    const eligibleForEWA = score >= 60 && employee.status === EmployeeStatus.ACTIVE;

    // Max EWA = (30% + (score / 100) * 20%) of salary, capped at 2000 AED.
    const salary = employee.salary ?? 0;
    const multiplier = 0.3 + (score / 100) * 0.2;
    const maxEWAAmount = eligibleForEWA ? Math.min(Math.round(salary * multiplier), 2000) : 0;

    return {
      score,
      breakdown,
      eligibleForEWA,
      maxEWAAmount,
      computedAt,
      nextReviewAt: new Date(computedAt.getTime() + CACHE_TTL_MS),
    };
  }
}

export const creditScoringService = new CreditScoringService();
