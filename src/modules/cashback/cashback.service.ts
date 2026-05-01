import { Prisma, PlanType } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { roundCurrency } from '@shared/utils/currency';
import logger from '@shared/utils/logger';
import { enqueueNotification } from '@modules/notifications/notification.job';

interface ProcessCashbackInput {
  employeeId: string;
  amount: number;
  merchantCategory?: string;
  plan: PlanType;
}

interface CashbackResult {
  awarded: number;
  remainingCap: number;
}

export class CashbackService {
  /** Plan-aware (rate, cap) tuple. */
  private config(plan: PlanType): { rate: number; cap: number } {
    return plan === PlanType.LUXURY
      ? { rate: env.CASHBACK_LUXURY_RATE, cap: env.CASHBACK_LUXURY_CAP }
      : { rate: env.CASHBACK_BASIC_RATE, cap: env.CASHBACK_BASIC_CAP };
  }

  /**
   * Award cashback for a settled card transaction. Honours the per-month
   * cap for the employee's plan and ignores sub-cent amounts.
   */
  async processCashback(input: ProcessCashbackInput): Promise<CashbackResult | null> {
    const { employeeId, amount, plan, merchantCategory } = input;
    const { rate, cap } = this.config(plan);

    const potential = roundCurrency(amount * rate);
    if (potential < 0.01) return null;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const aggregate = await prisma.employeeTransaction.aggregate({
      where: {
        employeeId,
        type: 'CASHBACK',
        status: 'COMPLETED',
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });

    const earned = aggregate._sum.amount ?? 0;
    const remainingCap = cap - earned;
    if (remainingCap <= 0) {
      logger.info('Cashback cap reached', { employeeId, plan });
      return { awarded: 0, remainingCap: 0 };
    }

    const cashback = Math.min(potential, remainingCap);
    if (cashback <= 0) return { awarded: 0, remainingCap };

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { walletBalance: { increment: cashback } },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId,
          type: 'CASHBACK',
          amount: cashback,
          totalAmount: cashback,
          status: 'COMPLETED',
          description: `Cashback: ${merchantCategory ?? 'Purchase'}`,
          merchantCategory: merchantCategory ?? null,
        },
      });
    });

    await enqueueNotification({ kind: 'cashback', employeeId, amount: cashback });
    logger.info('Cashback awarded', { employeeId, amount: cashback, merchantCategory });

    return { awarded: cashback, remainingCap: remainingCap - cashback };
  }

  /**
   * Monthly summary for the in-app dashboard. Returns earned/remaining/cap
   * plus the most recent 10 cashback transactions.
   */
  async getCashbackSummary(employeeId: string, month?: Date) {
    const target = month ?? new Date();
    const monthStart = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1));
    const monthEnd = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 23, 59, 59),
    );

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { plan: true },
    });
    const { rate, cap } = this.config(employee?.plan ?? PlanType.BASIC);

    const [transactions, totalAgg] = await Promise.all([
      prisma.employeeTransaction.findMany({
        where: {
          employeeId,
          type: 'CASHBACK',
          status: 'COMPLETED',
          createdAt: { gte: monthStart, lte: monthEnd },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { createdAt: true, amount: true, merchantCategory: true, description: true },
      }),
      prisma.employeeTransaction.aggregate({
        where: {
          employeeId,
          type: 'CASHBACK',
          status: 'COMPLETED',
          createdAt: { gte: monthStart, lte: monthEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const earned = totalAgg._sum.amount ?? 0;
    return {
      month: target.toISOString().slice(0, 7),
      plan: employee?.plan ?? PlanType.BASIC,
      ratePercent: rate * 100,
      cap,
      earned,
      remaining: Math.max(0, cap - earned),
      progress: cap === 0 ? 0 : Math.min(100, (earned / cap) * 100),
      recent: transactions.map((t) => ({
        date: t.createdAt,
        amount: t.amount,
        merchantCategory: t.merchantCategory,
        description: t.description,
      })),
    };
  }
}

export const cashbackService = new CashbackService();
