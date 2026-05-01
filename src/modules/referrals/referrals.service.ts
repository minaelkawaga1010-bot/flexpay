import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';

const FIRST_DEPOSIT_THRESHOLD = 100;

export const referralsService = {
  /** Link a new employee to a referrer (called during registration). */
  async link(referralCode: string | null | undefined, refereeId: string): Promise<void> {
    if (!referralCode) return;
    const referrer = await prisma.employee.findUnique({ where: { referralCode } });
    if (!referrer || referrer.id === refereeId) return;
    const existing = await prisma.referral.findUnique({ where: { refereeId } });
    if (existing) return;
    await prisma.referral.create({ data: { referrerId: referrer.id, refereeId } });
  },

  /**
   * Trigger reward when referee's first deposit clears the threshold.
   * Idempotent: rewardGiven flag prevents double-credit.
   */
  async maybeReward(refereeId: string, depositAmount: number): Promise<void> {
    if (depositAmount < FIRST_DEPOSIT_THRESHOLD) return;
    const referral = await prisma.referral.findFirst({
      where: { refereeId, rewardGiven: false },
    });
    if (!referral) return;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.employee.update({
        where: { id: referral.referrerId },
        data: { walletBalance: { increment: referral.rewardAmount } },
      });
      await tx.employee.update({
        where: { id: referral.refereeId },
        data: { walletBalance: { increment: referral.rewardAmount } },
      });
      await tx.employeeTransaction.createMany({
        data: [
          {
            employeeId: referral.referrerId,
            type: 'REFERRAL_REWARD',
            amount: referral.rewardAmount,
            totalAmount: referral.rewardAmount,
            status: 'COMPLETED',
            description: 'Referral reward',
            reference: referral.id,
          },
          {
            employeeId: referral.refereeId,
            type: 'REFERRAL_REWARD',
            amount: referral.rewardAmount,
            totalAmount: referral.rewardAmount,
            status: 'COMPLETED',
            description: 'Referral signup bonus',
            reference: referral.id,
          },
        ],
      });
      await tx.referral.update({
        where: { id: referral.id },
        data: {
          rewardGiven: true,
          status: 'REWARDED',
          rewardedAt: new Date(),
          refereeFirstDepositAt: new Date(),
          refereeFirstDepositAmount: depositAmount,
        },
      });
    });
  },

  async getMyCode(employeeId: string): Promise<string> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { referralCode: true },
    });
    return employee?.referralCode ?? '';
  },

  async history(referrerId: string) {
    return prisma.referral.findMany({
      where: { referrerId },
      orderBy: { createdAt: 'desc' },
      include: { referee: { select: { fullName: true, phone: true, createdAt: true } } },
    });
  },
};
