import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { roundCurrency } from '@shared/utils/currency';
import { enqueueNotification } from '@modules/notifications/notification.job';

export const cashbackService = {
  /**
   * Credit cashback for an employee given a card transaction. Honours the
   * per-month plan cap (Basic: 100 AED, Luxury: 300 AED).
   */
  async credit(employeeId: string, amount: number, merchantCategory: string): Promise<number> {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return 0;

    const rate = employee.plan === 'LUXURY' ? env.CASHBACK_LUXURY_RATE : env.CASHBACK_BASIC_RATE;
    const cap = employee.plan === 'LUXURY' ? env.CASHBACK_LUXURY_CAP : env.CASHBACK_BASIC_CAP;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const aggregated = await prisma.employeeTransaction.aggregate({
      where: { employeeId, type: 'CASHBACK', createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    const earnedThisMonth = aggregated._sum.amount ?? 0;
    const remainingCap = Math.max(0, cap - earnedThisMonth);
    if (remainingCap <= 0) return 0;

    let cashbackAmount = roundCurrency(amount * rate);
    if (cashbackAmount > remainingCap) cashbackAmount = remainingCap;
    if (cashbackAmount <= 0) return 0;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { walletBalance: { increment: cashbackAmount } },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId,
          type: 'CASHBACK',
          amount: cashbackAmount,
          totalAmount: cashbackAmount,
          status: 'COMPLETED',
          description: `Cashback from ${merchantCategory} purchase`,
          merchantCategory,
        },
      });
    });

    await enqueueNotification({ kind: 'cashback', employeeId, amount: cashbackAmount });
    return cashbackAmount;
  },
};
