import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { notificationService } from '../../services/notificationService';

const RATES: Record<'BASIC' | 'LUXURY', { rate: number; cap: number }> = {
  BASIC: { rate: 0.01, cap: 100 },
  LUXURY: { rate: 0.025, cap: 300 },
};

export const cashbackService = {
  /**
   * Credit cashback for an employee given a card transaction amount.
   * Honours the per-month plan cap.
   */
  async credit(employeeId: string, amount: number, merchantCategory: string): Promise<number> {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return 0;
    const config = RATES[employee.plan];

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const aggregated = await prisma.employeeTransaction.aggregate({
      where: {
        employeeId,
        type: 'CASHBACK',
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });
    const earnedThisMonth = aggregated._sum.amount ?? 0;
    const remainingCap = Math.max(0, config.cap - earnedThisMonth);
    if (remainingCap <= 0) return 0;

    let cashbackAmount = Math.round(amount * config.rate * 100) / 100;
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
        },
      });
    });

    await notificationService.notifyCashback(employeeId, cashbackAmount);
    return cashbackAmount;
  },
};
