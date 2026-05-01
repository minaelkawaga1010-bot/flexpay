import { prisma } from '@config/prisma';
import redisService from '@config/redis';
import logger from '@shared/utils/logger';

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const SCORE_BASE = 50;

export interface CreditScoreBreakdown {
  score: number;
  components: {
    base: number;
    transactionRegularity: number;
    averageBalance: number;
    referrals: number;
    defaults: number;
  };
  eligibleForEWA: boolean;
  maxEWAAmount: number;
}

const memoryCache = new Map<string, { value: CreditScoreBreakdown; expiresAt: number }>();

const cacheKey = (employeeId: string) => `credit-score:${employeeId}`;

async function readCache(employeeId: string): Promise<CreditScoreBreakdown | null> {
  try {
    const raw = await redisService.get(cacheKey(employeeId));
    if (raw) return JSON.parse(raw) as CreditScoreBreakdown;
  } catch (err) {
    logger.warn('credit-score: cache read failed', { error: (err as Error).message });
  }
  const entry = memoryCache.get(cacheKey(employeeId));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryCache.delete(cacheKey(employeeId));
    return null;
  }
  return entry.value;
}

async function writeCache(employeeId: string, value: CreditScoreBreakdown): Promise<void> {
  try {
    await redisService.set(cacheKey(employeeId), JSON.stringify(value), CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn('credit-score: cache write failed', { error: (err as Error).message });
  }
  memoryCache.set(cacheKey(employeeId), { value, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

export const scoringService = {
  /**
   * Compute a 0-100 credit score for an employee using a rule-based model.
   * Server-side only — no client input — and cached for 24h to deter probing.
   */
  async compute(employeeId: string, opts: { skipCache?: boolean } = {}): Promise<CreditScoreBreakdown> {
    if (!opts.skipCache) {
      const cached = await readCache(employeeId);
      if (cached) return cached;
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [employee, transactionCount, referralCount, defaultedLoans] = await Promise.all([
      prisma.employee.findUnique({ where: { id: employeeId } }),
      prisma.employeeTransaction.count({
        where: {
          employeeId,
          createdAt: { gte: ninetyDaysAgo },
          status: 'COMPLETED',
          type: { in: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'RECEIVE'] },
        },
      }),
      prisma.referral.count({ where: { referrerId: employeeId } }),
      prisma.loan.count({ where: { employeeId, status: 'DEFAULTED' } }),
    ]);

    const avgBalance = employee?.walletBalance ?? 0;
    const salary = employee?.salary ?? 0;

    const components = {
      base: SCORE_BASE,
      transactionRegularity:
        transactionCount >= 20 ? 20 : transactionCount >= 10 ? 10 : transactionCount >= 5 ? 5 : 0,
      averageBalance: avgBalance >= 500 ? 15 : avgBalance >= 200 ? 10 : avgBalance >= 100 ? 5 : 0,
      referrals: referralCount >= 3 ? 10 : referralCount >= 1 ? 5 : 0,
      defaults: -defaultedLoans * 15,
    };

    const total = Object.values(components).reduce((a, b) => a + b, 0);
    const score = Math.min(100, Math.max(0, total));
    const eligibleForEWA = score >= 60;
    const maxEWAAmount = eligibleForEWA ? Math.min(Math.round(salary * 0.5 * 100) / 100, 5000) : 0;

    const breakdown: CreditScoreBreakdown = { score, components, eligibleForEWA, maxEWAAmount };

    if (employee) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { creditScore: score, creditScoreUpdatedAt: new Date() },
      });
    }

    await writeCache(employeeId, breakdown);
    return breakdown;
  },

  async invalidate(employeeId: string): Promise<void> {
    await redisService.del(cacheKey(employeeId));
    memoryCache.delete(cacheKey(employeeId));
  },
};
