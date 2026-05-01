import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { env } from '@config/env';
import { BadRequest, NotFound } from '@shared/utils/errors';
import { notificationService } from '@modules/notifications/notification.service';
import { referralsService } from '@modules/referrals/referrals.service';

export const walletService = {
  async getBalance(employeeId: string): Promise<number> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { walletBalance: true },
    });
    if (!employee) throw NotFound('Employee not found');
    return employee.walletBalance;
  },

  async listTransactions(employeeId: string, limit: number, offset: number) {
    return prisma.employeeTransaction.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  },

  async transfer(senderId: string, recipientPhone: string, amount: number) {
    if (amount <= 0) throw BadRequest('Amount must be positive');

    const sender = await prisma.employee.findUnique({ where: { id: senderId } });
    if (!sender) throw NotFound('Sender not found');

    const recipient = await prisma.employee.findUnique({ where: { phone: recipientPhone } });
    if (!recipient) throw NotFound('Recipient not found');
    if (recipient.id === sender.id) throw BadRequest('Cannot transfer to yourself');

    const fee = sender.plan === 'LUXURY' ? 0 : env.P2P_TRANSFER_FEE;
    const total = amount + fee;
    if (sender.walletBalance < total) throw BadRequest('Insufficient balance');

    const [updatedSender, , senderTx] = await prisma.$transaction([
      prisma.employee.update({
        where: { id: sender.id },
        data: { walletBalance: { decrement: total } },
      }),
      prisma.employee.update({
        where: { id: recipient.id },
        data: { walletBalance: { increment: amount } },
      }),
      prisma.employeeTransaction.create({
        data: {
          employeeId: sender.id,
          type: 'TRANSFER',
          amount,
          fee,
          totalAmount: total,
          status: 'COMPLETED',
          description: `Transfer to ${recipient.phone}`,
          counterpartyId: recipient.id,
          counterpartyPhone: recipient.phone,
        },
      }),
      prisma.employeeTransaction.create({
        data: {
          employeeId: recipient.id,
          type: 'RECEIVE',
          amount,
          totalAmount: amount,
          status: 'COMPLETED',
          description: `Transfer from ${sender.phone}`,
          counterpartyId: sender.id,
          counterpartyPhone: sender.phone,
        },
      }),
    ]);

    await Promise.all([
      notificationService.notifyTransferReceived(recipient.id, amount, sender.fullName),
      notificationService.notifyTransferSent(sender.id, amount, recipient.fullName),
      referralsService.maybeReward(recipient.id, amount),
    ]);

    return {
      transactionId: senderTx.id,
      balance: updatedSender.walletBalance,
      fee,
    };
  },

  async credit(
    tx: Prisma.TransactionClient,
    employeeId: string,
    amount: number,
    type: Prisma.EmployeeTransactionCreateInput['type'],
    description: string,
    reference?: string,
  ) {
    await tx.employee.update({
      where: { id: employeeId },
      data: { walletBalance: { increment: amount } },
    });
    await tx.employeeTransaction.create({
      data: {
        employeeId,
        type,
        amount,
        totalAmount: amount,
        status: 'COMPLETED',
        description,
        reference,
      },
    });
  },
};
