import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { BadRequest, Forbidden, NotFound } from '@shared/utils/errors';

export const savingsService = {
  async list(employeeId: string) {
    const goals = await prisma.savingsGoal.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return goals.map((g) => ({
      ...g,
      progress: g.targetAmount === 0 ? 0 : g.savedAmount / g.targetAmount,
    }));
  },

  async create(
    employeeId: string,
    input: { name: string; targetAmount: number; monthlyAuto?: number; deadline?: Date; autoSaveDay?: number },
  ) {
    if (input.targetAmount <= 0) throw BadRequest('targetAmount must be positive');
    return prisma.savingsGoal.create({
      data: {
        employeeId,
        name: input.name,
        targetAmount: input.targetAmount,
        monthlyAuto: input.monthlyAuto,
        autoSaveDay: input.autoSaveDay,
        deadline: input.deadline,
      },
    });
  },

  async deposit(employeeId: string, goalId: string, amount: number) {
    if (amount <= 0) throw BadRequest('Amount must be positive');
    const goal = await prisma.savingsGoal.findUnique({ where: { id: goalId } });
    if (!goal) throw NotFound('Savings goal not found');
    if (goal.employeeId !== employeeId) throw Forbidden();

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.walletBalance < amount) throw BadRequest('Insufficient balance');

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { walletBalance: { decrement: amount } },
      });
      const updated = await tx.savingsGoal.update({
        where: { id: goalId },
        data: { savedAmount: { increment: amount } },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId,
          type: 'SAVINGS_TRANSFER',
          amount,
          totalAmount: amount,
          status: 'COMPLETED',
          description: `Deposit to savings: ${goal.name}`,
          reference: goalId,
        },
      });
      if (updated.savedAmount >= updated.targetAmount && updated.status === 'ACTIVE') {
        await tx.savingsGoal.update({ where: { id: goalId }, data: { status: 'COMPLETED' } });
      }
      return updated;
    });
  },

  async withdraw(employeeId: string, goalId: string, amount: number) {
    if (amount <= 0) throw BadRequest('Amount must be positive');
    const goal = await prisma.savingsGoal.findUnique({ where: { id: goalId } });
    if (!goal) throw NotFound('Savings goal not found');
    if (goal.employeeId !== employeeId) throw Forbidden();
    if (goal.savedAmount < amount) throw BadRequest('Withdrawal exceeds saved amount');

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { walletBalance: { increment: amount } },
      });
      const updated = await tx.savingsGoal.update({
        where: { id: goalId },
        data: { savedAmount: { decrement: amount } },
      });
      await tx.employeeTransaction.create({
        data: {
          employeeId,
          type: 'SAVINGS_TRANSFER',
          amount,
          totalAmount: amount,
          status: 'COMPLETED',
          description: `Withdrawal from savings: ${goal.name}`,
          reference: goalId,
        },
      });
      return updated;
    });
  },

  /** Cron entrypoint — auto-debit each ACTIVE goal that has monthlyAuto set. */
  async runMonthlyAutoSave() {
    const goals = await prisma.savingsGoal.findMany({
      where: { status: 'ACTIVE', monthlyAuto: { not: null } },
    });
    const results: { goalId: string; debited: boolean; reason?: string }[] = [];
    for (const goal of goals) {
      try {
        await savingsService.deposit(goal.employeeId, goal.id, goal.monthlyAuto!);
        results.push({ goalId: goal.id, debited: true });
      } catch (err) {
        results.push({
          goalId: goal.id,
          debited: false,
          reason: err instanceof Error ? err.message : 'unknown',
        });
      }
    }
    return results;
  },
};
