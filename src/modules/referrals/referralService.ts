import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';

const REFERRAL_REWARD = 10;
const FIRST_DEPOSIT_THRESHOLD = 100;

export const referralService = {
  /** Link a new employee to a referrer (called during registration). */
  async link(referralCode: string | null | undefined, refereeId: string): Promise<void> {
    if (!referralCode) return;
    const referrer = await prisma.employee.findUnique({ where: { referralCode } });
    if (!referrer || referrer.id === refereeId) return;
    const existing = await prisma.referral.findUnique({ where: { refereeId } });
    if (existing) return;
    await prisma.referral.create({
      data: { referrerId: referrer.id, refereeId },
    });
    await prisma.employee.update({
      where: { id: refereeId },
      data: { referredById: referrer.id },
    });
  },

  /**
   * Trigger reward when referee makes a qualifying first deposit.
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
        data: { walletBalance: { increment: REFERRAL_REWARD } },
      });
      await tx.employee.update({
        where: { id: referral.refereeId },
        data: { walletBalance: { increment: REFERRAL_REWARD } },
      });
      await tx.employeeTransaction.createMany({
        data: [
          {
            employeeId: referral.referrerId,
            type: 'REFERRAL_REWARD',
            amount: REFERRAL_REWARD,
            totalAmount: REFERRAL_REWARD,
            status: 'COMPLETED',
            description: 'Referral reward',
            reference: referral.id,
          },
          {
            employeeId: referral.refereeId,
            type: 'REFERRAL_REWARD',
            amount: REFERRAL_REWARD,
            totalAmount: REFERRAL_REWARD,
            status: 'COMPLETED',
            description: 'Referral signup bonus',
            reference: referral.id,
          },
        ],
      });
      await tx.referral.update({
        where: { id: referral.id },
        data: { rewardGiven: true },
      });
    });
  },
};
