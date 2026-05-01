import { prisma } from '../../config/db';
import { getRedis } from '../../config/redis';
import { logger } from '../../config/logger';

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

function cacheKey(employeeId: string): string {
  return `credit-score:${employeeId}`;
}

async function readCache(employeeId: string): Promise<CreditScoreBreakdown | null> {
  if (process.env.NODE_ENV !== 'test') {
    try {
      const redis = getRedis();
      const raw = await redis.get(cacheKey(employeeId));
      if (raw) return JSON.parse(raw) as CreditScoreBreakdown;
    } catch (err) {
      logger.warn({ err }, 'credit-score: redis cache read failed');
    }
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
  if (process.env.NODE_ENV !== 'test') {
    try {
      const redis = getRedis();
      await redis.set(cacheKey(employeeId), JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
      return;
    } catch (err) {
      logger.warn({ err }, 'credit-score: redis cache write failed');
    }
  }
  memoryCache.set(cacheKey(employeeId), {
    value,
    expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
  });
}

export const creditScoreService = {
  /**
   * Compute a 0-100 credit score for an employee using a rule-based model.
   * The score is calculated server-side and cached for 24h to deter probing.
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
          type: { in: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'] },
        },
      }),
      prisma.referral.count({ where: { referrerId: employeeId } }),
      prisma.loan.count({ where: { employeeId, status: 'DEFAULTED' } }),
    ]);

    const avgBalance = employee?.walletBalance ?? 0;

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
    const maxEWAAmount = eligibleForEWA
      ? Math.min(Math.round(((employee?.salary ?? 0) * 0.5 * 100)) / 100, 5000)
      : 0;

    const breakdown: CreditScoreBreakdown = { score, components, eligibleForEWA, maxEWAAmount };
    await writeCache(employeeId, breakdown);
    return breakdown;
  },

  async invalidate(employeeId: string): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      try {
        await getRedis().del(cacheKey(employeeId));
      } catch (err) {
        logger.warn({ err }, 'credit-score: redis cache invalidate failed');
      }
    }
    memoryCache.delete(cacheKey(employeeId));
  },
};
